"""Step 2 of ingestion (fast, local): embeddings/ + BM25 sparse vectors -> Qdrant.

Usage: python backend/load.py [embeddings_dir]     (default: embeddings/)
Idempotent: point ids are content hashes, so re-running just overwrites.
"""
import json, logging, os, sys, time
from pathlib import Path
import numpy as np

os.environ.setdefault("FASTEMBED_CACHE_PATH", str(Path(__file__).resolve().parent.parent / "models"))
from fastembed import SparseTextEmbedding
from qdrant_client import QdrantClient, models
from chunking import point_id, text_to_embed

COLLECTION = "opsrag"
ROOT = Path(__file__).resolve().parent.parent
(ROOT / "logs").mkdir(exist_ok=True)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s",
                    handlers=[logging.FileHandler(ROOT / "logs" / "load.log", encoding="utf-8"), logging.StreamHandler()])
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("load")


def main(src):
    cs = [json.loads(line) for line in open(src / "chunks.jsonl", encoding="utf-8")]
    vecs = np.load(src / "vectors.npy")
    assert len(cs) == len(vecs), f"{len(cs)} chunks vs {len(vecs)} vectors: re-run embed.py"
    client = QdrantClient("localhost", port=6333)
    if not client.collection_exists(COLLECTION):
        client.create_collection(
            COLLECTION,
            vectors_config={"dense": models.VectorParams(size=vecs.shape[1], distance=models.Distance.COSINE)},
            sparse_vectors_config={"bm25": models.SparseVectorParams(modifier=models.Modifier.IDF)},
        )
    sparse = SparseTextEmbedding("Qdrant/bm25")
    t0 = time.time()
    for i in range(0, len(cs), 256):
        part = cs[i:i + 256]
        client.upsert(COLLECTION, [
            models.PointStruct(id=point_id(c), payload=c,
                               vector={"dense": v.tolist(),
                                       "bm25": models.SparseVector(indices=s.indices.tolist(), values=s.values.tolist())})
            for c, v, s in zip(part, vecs[i:i + 256], sparse.embed([text_to_embed(c) for c in part]))])
        log.info("%d/%d loaded", i + len(part), len(cs))
    log.info("DONE collection has %d points, %.0fs", client.count(COLLECTION).count, time.time() - t0)


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "embeddings")
