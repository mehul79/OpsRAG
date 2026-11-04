"""Online RAG pipeline: semantic cache -> query transform -> hybrid retrieval -> rerank -> CRAG grade -> generate.

Each stage is a plain function wrapped in a Langfuse span (tracing is a no-op without LANGFUSE_* keys).
Try one query: `python backend/pipeline.py "my pod keeps restarting"`
"""
import os, sys, time, uuid
from functools import cache
import httpx
from dotenv import load_dotenv

load_dotenv()
os.environ.setdefault("FASTEMBED_CACHE_PATH", os.path.join(os.path.dirname(__file__), "..", "models"))
if not os.getenv("LANGFUSE_PUBLIC_KEY"):
    os.environ["LANGFUSE_TRACING_ENABLED"] = "false"  # no keys: skip tracing instead of 401-ing on every export
from fastembed import SparseTextEmbedding, TextEmbedding
from langchain_openai import ChatOpenAI
from langfuse import get_client, observe
from langfuse.langchain import CallbackHandler
from qdrant_client import QdrantClient, models
from chunking import text_to_embed
from router import reply, route

COLLECTION, CACHE = "opsrag", "opsrag_cache"
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "  # bge-small query instruction
CANDIDATES, TOP_K = 20, 5
RERANKER = os.getenv("RERANKER", "local")  # "local" (ms-marco MiniLM) or "cohere"
RERANK_MODEL = os.getenv("COHERE_RERANK_MODEL", "rerank-v5.0-fast")
# ponytail: cut-off for "weak" retrieval, calibrate on the eval set. Scales differ per reranker.
RELEVANCE_MIN = 0.0 if RERANKER == "local" else 0.1
CACHE_MIN = 0.95     # cosine cut-off for a cache hit; evals/cache_calibrate.py: lowest value with zero false hits on hard negatives (max 0.941)
CACHE_TTL = 7 * 24 * 3600

qdrant = QdrantClient(url=os.getenv("QDRANT_URL", "http://localhost:6333"), api_key=os.getenv("QDRANT_API_KEY") or None)
dense = TextEmbedding("BAAI/bge-small-en-v1.5")
sparse = SparseTextEmbedding("Qdrant/bm25")


@cache
def local_reranker():
    from fastembed.rerank.cross_encoder import TextCrossEncoder
    return TextCrossEncoder("Xenova/ms-marco-MiniLM-L-6-v2")


@cache
def llm(model):
    # Any OpenAI-compatible endpoint: set LLM_BASE_URL, LLM_API_KEY, LLM_MODEL in .env
    base = os.getenv("LLM_BASE_URL") or ""
    # DeepSeek et al. spend most of their output on hidden "thinking" tokens (slow and costly for RAG).
    # OpenRouter lets us switch that off; LLM_REASONING=on re-enables it.
    extra = {"reasoning": {"enabled": False}} if "openrouter" in base and os.getenv("LLM_REASONING") != "on" else {}
    return ChatOpenAI(model=model, base_url=base or None, api_key=os.getenv("LLM_API_KEY"),
                      temperature=0, extra_body=extra, stream_usage=True)  # stream_usage: token counts reach Langfuse


def chat():
    return llm(os.environ["LLM_MODEL"])


def judge_llm():  # used by evals/run.py --judge; a different model from the generator avoids self-preference
    return llm(os.environ["JUDGE_MODEL"])


def traced():
    return {"callbacks": [CallbackHandler()]}  # LLM calls show up as generations (tokens, cost) in the trace


def embed_query(q):
    return next(dense.embed([QUERY_PREFIX + q])).tolist()


# --- semantic cache (second Qdrant collection; no TTL index in Qdrant, so filter on write time)
def _cache_collection():
    if not qdrant.collection_exists(CACHE):
        qdrant.create_collection(CACHE, vectors_config=models.VectorParams(size=384, distance=models.Distance.COSINE))
        qdrant.create_payload_index(CACHE, "at", models.PayloadSchemaType.FLOAT)  # Qdrant Cloud (strict mode) rejects filters on unindexed fields


def cache_get(qvec):
    _cache_collection()
    fresh = models.Filter(must=[models.FieldCondition(key="at", range=models.Range(gte=time.time() - CACHE_TTL))])
    hits = qdrant.query_points(CACHE, query=qvec, limit=1, score_threshold=CACHE_MIN, query_filter=fresh).points
    return hits[0].payload if hits else None


@observe(name="semantic-cache")
def cache_lookup(question):
    qvec = embed_query(question)  # embedding is part of the cache span: it is the cost of the lookup
    return qvec, cache_get(qvec)


@observe(name="route")
def route_prompt(question):
    return route(question)


@observe(name="cache-write")
def cache_put(qvec, question, answer, sources):
    qdrant.upsert(CACHE, [models.PointStruct(id=str(uuid.uuid4()), vector=qvec, payload={
        "question": question, "answer": answer, "sources": sources, "at": time.time()})])


# --- stages
REWRITE = """Rewrite the user's question as 1-3 standalone search queries over Kubernetes, Docker, Terraform and AWS docs.
Split it only if it asks about several distinct things. Replace vague wording with the technical terms the docs use.
Return one query per line and nothing else."""


@observe(name="query-transform")
def transform(question):
    out = chat().invoke([("system", REWRITE), ("human", question)], config=traced()).content
    rewrites = [l.strip(" -*0123456789.\"").strip() for l in out.splitlines() if l.strip()][:3]
    # HyDE deliberately skipped (see CLAUDE.md)
    return [question] + [q for q in rewrites if q and q.lower() != question.lower()]


@observe(name="hybrid-retrieval", as_type="retriever")
def retrieve(queries):
    prefetch = []
    for q, d, s in zip(queries, dense.embed([QUERY_PREFIX + q for q in queries]), sparse.query_embed(queries)):
        prefetch += [
            models.Prefetch(query=d.tolist(), using="dense", limit=CANDIDATES),
            models.Prefetch(query=models.SparseVector(indices=s.indices.tolist(), values=s.values.tolist()),
                            using="bm25", limit=CANDIDATES),
        ]
    points = qdrant.query_points(COLLECTION, prefetch=prefetch, query=models.FusionQuery(fusion=models.Fusion.RRF),
                                 limit=CANDIDATES * 2, with_payload=True).points
    seen, hits = set(), []
    for p in points:  # same text can live in two files; keep one copy
        if p.payload["text"] not in seen:
            seen.add(p.payload["text"]); hits.append({**p.payload, "rrf": p.score})
    return hits[:CANDIDATES]


@observe(name="rerank")
def rerank(question, hits):
    docs = [text_to_embed(h) for h in hits]
    if RERANKER == "local":  # ms-marco MiniLM cross-encoder on CPU, scores are logits (~-11..+11)
        ranked = sorted(zip(local_reranker().rerank(question, docs), hits), key=lambda x: -x[0])[:TOP_K]
        return [{**h, "score": float(s)} for s, h in ranked]
    r = httpx.post("https://api.cohere.com/v2/rerank", timeout=30,
                   headers={"Authorization": f"Bearer {os.environ['COHERE_API_KEY']}"},
                   json={"model": RERANK_MODEL, "query": question, "top_n": TOP_K,
                         "documents": docs})
    r.raise_for_status()
    return [{**hits[x["index"]], "score": x["relevance_score"]} for x in r.json()["results"]]  # sorted, 0..1


@observe(name="crag-grade")
def grade(hits):
    good = [h for h in hits if h["score"] >= RELEVANCE_MIN]
    # ponytail: no web-search fallback yet; weak retrieval is flagged and the answer is told to say so
    return (good or hits[:2]), not good


ANSWER = """You answer questions about Kubernetes, Docker, Terraform and AWS using ONLY the numbered context.
Cite sources inline like [1] or [2][3]. If the context does not answer the question, say so plainly; never guess.
Be concise. Use code blocks for commands and config."""
WEAK = "\nRetrieval confidence is LOW for this question: say the docs may not cover it, then share only what the context supports."


@observe(name="generate")
def generate(question, hits, weak):
    context = "\n\n".join(f"[{i}] {h['source']} | {h['heading']}\n{h['text']}" for i, h in enumerate(hits, 1))
    messages = [("system", ANSWER + (WEAK if weak else "")), ("human", f"Context:\n{context}\n\nQuestion: {question}")]
    for chunk in chat().stream(messages, config=traced()):
        if chunk.content:
            yield chunk.content


def _done(name, t0, **meta):
    return {"name": name, "status": "done", "ms": round((time.perf_counter() - t0) * 1000), "meta": meta}


def _start(name):
    return "stage", {"name": name, "status": "start"}


@observe(name="ask", capture_input=False, capture_output=False)  # input/output set by hand: small and readable on the dashboard
def ask(question):
    """Yields ("stage", {...}) progress events, ("sources", [...]), ("token", str) pieces, then ("done", {...})."""
    get_client().update_current_span(input=question)
    yield _start("route")
    t0 = time.perf_counter()
    label, conf = route_prompt(question)  # chitchat / about_bot / out_of_scope get a fixed reply: no embedding, cache, LLM or search
    yield "stage", _done("route", t0, label=label, confidence=round(conf, 3))
    if label != "retrieve":
        yield "sources", []
        yield "token", reply(label)
        get_client().update_current_span(output=reply(label), metadata={"route": label, "cached": False, "weak": False})
        yield "done", {"cached": False, "weak": False, "route": label, "route_confidence": round(conf, 3)}
        return  # never cached: returns before cache_put
    yield _start("cache")
    t0 = time.perf_counter()
    qvec, hit = cache_lookup(question)
    yield "stage", _done("cache", t0, hit=bool(hit))
    if hit:
        yield "sources", hit["sources"]
        yield "token", hit["answer"]
        get_client().update_current_span(output=hit["answer"], metadata={"route": "retrieve", "cached": True, "weak": False})
        yield "done", {"cached": True, "weak": False, "route": "retrieve"}
        return
    queries = [question]
    if os.getenv("QUERY_TRANSFORM") != "off":
        yield _start("transform")
        t0 = time.perf_counter()
        queries = transform(question)
        yield "stage", _done("transform", t0, queries=queries)
    yield _start("retrieve")
    t0 = time.perf_counter()
    cands = retrieve(queries)
    yield "stage", _done("retrieve", t0, candidates=len(cands), queries=len(queries))
    yield _start("rerank")
    t0 = time.perf_counter()
    ranked = rerank(question, cands)
    yield "stage", _done("rerank", t0, kept=len(ranked), top_score=ranked[0]["score"] if ranked else None)
    yield _start("grade")
    t0 = time.perf_counter()
    hits, weak = grade(ranked)
    yield "stage", _done("grade", t0, weak=weak, kept=len(hits))
    # sources[i] is citation [i+1]; the frontend sidebar shows each chunk with its relevance score
    sources = [{k: h.get(k) for k in ("source", "heading", "path", "url", "position", "score", "text")} for h in hits]
    yield "sources", sources
    yield _start("generate")
    t0 = time.perf_counter()
    answer, ttft = "", None
    for token in generate(question, hits, weak):
        if ttft is None:
            ttft = round((time.perf_counter() - t0) * 1000)
        answer += token
        yield "token", token
    yield "stage", _done("generate", t0, ttft_ms=ttft)
    if not weak:  # never cache an answer we weren't confident in
        yield _start("cache_write")
        t0 = time.perf_counter()
        cache_put(qvec, question, answer, sources)
        yield "stage", _done("cache_write", t0)
    get_client().update_current_span(output=answer, metadata={"route": "retrieve", "cached": False, "weak": weak, "top_score": sources[0]["score"]})
    yield "done", {"cached": False, "weak": weak, "route": "retrieve", "top_score": sources[0]["score"]}


if __name__ == "__main__":
    for kind, value in ask(" ".join(sys.argv[1:]) or "my pod keeps restarting after deploy"):
        if kind == "sources":
            for i, s in enumerate(value, 1):
                print(f"[{i}] {s['score']:.2f} {s['source']} | {s['heading']}")
            print()
        elif kind == "token":
            print(value, end="", flush=True)
        elif kind == "stage":
            if value["status"] == "done":
                print(f"  [stage] {value['name']} {value['ms']}ms {value['meta']}", flush=True)
        else:
            print(f"\n\n{value}")
    get_client().flush()
