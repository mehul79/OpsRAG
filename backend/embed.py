"""Step 1 of ingestion (the slow, GPU-friendly step): chunk docs and embed them with bge-small.

Usage: python backend/embed.py [source ...]       e.g. `docker aws-eks`  (default: everything)
Output: embeddings/chunks.jsonl + embeddings/vectors.npy (row i of vectors = line i of chunks).
Runs on a laptop CPU or a Colab GPU unchanged (sentence-transformers picks the device). Then run load.py.
"""
import json, logging, sys, time
from pathlib import Path
import numpy as np
from sentence_transformers import SentenceTransformer
from chunking import all_chunks, text_to_embed

OUT = Path(__file__).resolve().parent.parent / "embeddings"
OUT.mkdir(exist_ok=True)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s",
                    handlers=[logging.FileHandler(OUT / "embed.log", encoding="utf-8"), logging.StreamHandler()])
log = logging.getLogger("embed")


def main(wanted):
    cs = list(all_chunks(wanted))
    log.info("%d chunks to embed", len(cs))
    model = SentenceTransformer("BAAI/bge-small-en-v1.5")  # cuda if available, else cpu
    log.info("device: %s", model.device)
    vecs, t0 = [], time.time()
    for i in range(0, len(cs), 1024):
        part = cs[i:i + 1024]
        vecs.append(model.encode([text_to_embed(c) for c in part], batch_size=64, normalize_embeddings=True))
        log.info("%d/%d, %.1f chunks/s", i + len(part), len(cs), (i + len(part)) / (time.time() - t0))
    np.save(OUT / "vectors.npy", np.vstack(vecs).astype("float32"))
    with open(OUT / "chunks.jsonl", "w", encoding="utf-8") as f:
        f.writelines(json.dumps(c) + "\n" for c in cs)
    log.info("DONE %d chunks in %.0fs -> %s", len(cs), time.time() - t0, OUT)


if __name__ == "__main__":
    main(set(sys.argv[1:]))
