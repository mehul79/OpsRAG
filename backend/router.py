"""Prompt router: skip retrieval for chitchat / about_bot / out_of_scope prompts. Logistic regression on bge-small embeddings.

Train once (train split only, so val and test stay held out):  python backend/router.py train
That writes backend/router_weights.npz (a few KB, committed); serving and evals/router_eval.py only load it.
Safety rule: the router only skips retrieval when the top non-retrieve class has probability >= ROUTER_MIN;
anything else, and any router failure, retrieves. ROUTER=on|off (default on; evals/router_eval.py --check passes with zero false skips).
"""
import json, logging, os, sys
from functools import cache
from pathlib import Path
import numpy as np

HERE = Path(__file__).resolve().parent
os.environ.setdefault("FASTEMBED_CACHE_PATH", str(HERE.parent / "models"))
from langfuse import get_client, observe

WEIGHTS = HERE / "router_weights.npz"
DATASET = HERE.parent / "evals" / "router_dataset.jsonl"
ROUTER = os.getenv("ROUTER", "on")
ROUTER_MIN = float(os.getenv("ROUTER_MIN", "0.8"))  # chosen by evals/router_eval.py: lowest zero-false-skip threshold on val + one step
C = 30.0  # inverse regularisation strength: val accuracy was flat for C=1..100, 30 marginally best
log = logging.getLogger("router")

CHITCHAT = ("Hi! I answer questions about Kubernetes, Docker, Terraform and AWS from their official docs, with citations. "
            "Try: *How do I roll back a Deployment?*")
OUT_OF_SCOPE = ("That's outside what I can help with. I only answer from the Kubernetes, Docker, Terraform (core and AWS provider) "
                "and AWS (EC2, ECS, EKS, IAM, CloudFront, RDS, ELB) docs. Ask me something about those.")
ABOUT = """I'm OpsRAG, a docs copilot for Kubernetes, Docker, Terraform and AWS.

- **Answers** are written by an LLM (`{llm}`, through an OpenAI-compatible API) using only the doc chunks retrieved for your question, and cited as [n]. The chunks are listed in the sidebar with their relevance scores.
- **Search:** hybrid BM25 + dense search (`BAAI/bge-small-en-v1.5`) in Qdrant, fused with reciprocal rank fusion, then reranked ({reranker}).
- **Sources:** official Kubernetes, Docker and Terraform docs, the Terraform AWS provider, and AWS service guides (EC2, ECS, EKS, IAM, CloudFront, RDS, ELB).
- **Deployment:** I'm not a public hosted service; I run wherever my operator runs me.
- **Memory:** each question is answered on its own; I don't keep a conversation history."""


@cache
def _embedder():
    from fastembed import TextEmbedding
    return TextEmbedding("BAAI/bge-small-en-v1.5")


def embed(texts):
    """Plain (no query-instruction prefix) normalised embeddings. Train and serve both use this, so there is no skew."""
    x = np.array(list(_embedder().embed(list(texts))))
    return x / np.linalg.norm(x, axis=1, keepdims=True)


def fit(texts, labels, c=C):
    from sklearn.linear_model import LogisticRegression  # training-time only; serving is numpy
    m = LogisticRegression(C=c, class_weight="balanced", max_iter=2000).fit(embed(texts), labels)
    return {"coef": m.coef_, "intercept": m.intercept_, "classes": np.array(m.classes_)}


def predict_proba(w, texts):
    z = embed(texts) @ w["coef"].T + w["intercept"]
    p = np.exp(z - z.max(axis=1, keepdims=True))
    p /= p.sum(axis=1, keepdims=True)
    return [dict(zip(map(str, w["classes"]), map(float, row))) for row in p]


def decide(probs, threshold):
    """Skip retrieval only for a confident non-retrieve class; everything else retrieves."""
    label = max(probs, key=probs.get)
    if label != "retrieve" and probs[label] >= threshold:
        return label, probs[label]
    return "retrieve", probs.get("retrieve", 0.0)


@cache
def _weights():
    with np.load(WEIGHTS) as f:
        return {k: f[k] for k in f.files}


@observe(name="router")
def route(question):
    """Returns (label, confidence). Any failure, or ROUTER=off, means retrieve."""
    if ROUTER == "off":
        return "retrieve", 0.0
    try:
        label, p = decide(predict_proba(_weights(), [question])[0], ROUTER_MIN)
    except Exception:
        log.exception("router failed, retrieving")
        return "retrieve", 0.0
    get_client().update_current_span(metadata={"threshold": ROUTER_MIN})
    return label, p


def reply(label):
    if label == "chitchat":
        return CHITCHAT
    if label == "about_bot":
        reranker = ("Cohere " + os.getenv("COHERE_RERANK_MODEL", "rerank-v5.0-fast")) if os.getenv("RERANKER") == "cohere" \
            else "`ms-marco-MiniLM-L-6-v2` cross-encoder"
        return ABOUT.format(llm=os.getenv("LLM_MODEL") or "a configurable model", reranker=reranker)
    return OUT_OF_SCOPE


if __name__ == "__main__" and sys.argv[1:] == ["train"]:
    rows = [json.loads(l) for l in open(DATASET, encoding="utf-8")]
    tr = [r for r in rows if r["split"] == "train"]
    w = fit([r["text"] for r in tr], [r["label"] for r in tr])
    np.savez(WEIGHTS, **w)
    print(f"trained on {len(tr)} train rows -> {WEIGHTS.name} ({WEIGHTS.stat().st_size // 1024} KB)")
