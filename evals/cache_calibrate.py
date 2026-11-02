"""Calibrate CACHE_MIN: cosine of two bge-small query embeddings, same prefix the cache uses.
Positives = paraphrases (should hit), negatives = same-topic different questions (must NOT hit: a wrong hit serves a wrong answer).
Pairs live in evals/cache_pairs.py. Usage: python evals/cache_calibrate.py   (no Qdrant or LLM needed)"""
import os
from pathlib import Path
HERE = Path(__file__).resolve().parent
os.environ.setdefault("FASTEMBED_CACHE_PATH", str(HERE.parent / "models"))
import numpy as np
from fastembed import TextEmbedding
from cache_pairs import NEGATIVE, POSITIVE

PREFIX = "Represent this sentence for searching relevant passages: "  # keep in sync with backend/pipeline.py QUERY_PREFIX
pairs = [(a, b, True) for a, b in POSITIVE] + [(a, b, False) for a, b in NEGATIVE]
m = TextEmbedding("BAAI/bge-small-en-v1.5")
emb = lambda xs: np.array(list(m.embed([PREFIX + x for x in xs])))
A, B = emb([p[0] for p in pairs]), emb([p[1] for p in pairs])
sim = (A * B).sum(1) / (np.linalg.norm(A, axis=1) * np.linalg.norm(B, axis=1))
same = np.array([p[2] for p in pairs])
pos, neg = sim[same], sim[~same]
print(f"paraphrase  n={len(pos)} min {pos.min():.3f} p10 {np.percentile(pos,10):.3f} median {np.median(pos):.3f}")
print(f"different   n={len(neg)} median {np.median(neg):.3f} p90 {np.percentile(neg,90):.3f} max {neg.max():.3f}")
print("threshold | hit rate on paraphrases | false hits on different")
for t in [0.80, 0.85, 0.88, 0.90, 0.92, 0.93, 0.94, 0.95, 0.96, 0.97, 0.98]:
    print(f"  {t:.2f}   {(pos >= t).mean():6.1%}   {(neg >= t).sum()}")
print("\nhardest negatives:")
for i in np.argsort(-np.where(same, -9, sim))[:5]: print(f"  {sim[i]:.3f}  {pairs[i][0]}  |  {pairs[i][1]}")
print("weakest paraphrases:")
for i in np.argsort(np.where(same, sim, 9))[:5]: print(f"  {sim[i]:.3f}  {pairs[i][0]}  |  {pairs[i][1]}")
