# OpsRAG

A RAG copilot that answers questions about infrastructure docs (Kubernetes, Docker, Terraform, AWS) and traces every answer, so a weak answer can be tied to the stage that caused it.

Hybrid retrieval (dense + BM25 with rank fusion), a cross-encoder reranker, query rewriting, a weak-retrieval check, a semantic cache, per-stage tracing, and an eval harness with a regression gate. The focus is retrieval quality and observability, not document parsing.

> **Status:** working end to end on a laptop, not production-ready. See [Status](#status).

## Results

Measured on 37 questions over 48,572 chunks (details, definitions and caveats in [BENCHMARK.md](BENCHMARK.md)):

| Metric | Score |
| --- | --- |
| recall@20 / recall@5 | **1.000** / **0.971** |
| MRR@5 | 0.736 |
| precision@5 / NDCG@5 | 0.514 / 0.543 |
| weak-retrieval flag accuracy | 1.000 |
| context relevancy / answer relevancy | 0.857 / 0.971 |
| faithfulness | 0.967 |

Small question set, LLM-judged quality metrics, one run: treat these as a baseline for comparing changes, not a general quality claim.

## How it works

```
question -> semantic cache -> query rewrite -> hybrid retrieval -> rerank -> weak check -> LLM answer (streamed, cited)
                                                (BM25 + dense, RRF)  (top 20 -> 5)
```

1. **Semantic cache:** a similar earlier question returns its stored answer immediately.
2. **Query rewrite:** an LLM turns the question into up to 3 search queries (can be switched off).
3. **Hybrid retrieval:** BM25 and dense vectors are searched in one Qdrant call and fused with reciprocal rank fusion, top 20.
4. **Rerank:** a cross-encoder reorders the 20 and keeps 5.
5. **Weak check:** if every reranker score is below a threshold, the answer is flagged as low-confidence and is not cached.
6. **Generate:** the LLM answers from the 5 chunks and cites them as `[1]`, `[2]`. The API streams `sources`, `token` and `done` events.

Every stage is a Langfuse span. The diagram is in [`.claude/system-design.md`](.claude/system-design.md).

The UI shows the answer with clickable citations, and a right sidebar with every retrieved chunk, its source, heading and relevance score.

## Corpus

About 5,200 clean Markdown files, chunked by heading into 48,572 chunks.

| Source | Content |
| --- | --- |
| Kubernetes | concepts, tasks, tutorials, setup, glossary (generated API reference dropped) |
| Docker | Engine, Build, Compose, Desktop, Hub, Scout, guides |
| Terraform | language and CLI docs (v1.17), AWS provider resource pages for the services below |
| AWS | EC2, ECS, EKS, IAM, CloudFront, RDS (operational sections), ELB, from `docs.aws.amazon.com` Markdown pages |

Each chunk keeps its source path, heading path and (for AWS) the original URL, so answers cite where they came from. The corpus is not in this repo (`data/` is gitignored). It comes from the upstream projects' public docs; check each project's license before redistributing any of it.

## Stack

| Part | Tool |
| --- | --- |
| API | FastAPI, server-sent events |
| Frontend | Next.js 16 (App Router), Tailwind CSS 4 |
| Vector store | Qdrant (dense + BM25 sparse vectors in one collection, also holds the semantic cache) |
| Embeddings | `BAAI/bge-small-en-v1.5` via fastembed (ONNX, CPU) |
| Reranker | `Xenova/ms-marco-MiniLM-L-6-v2` local, or Cohere Rerank (`RERANKER=cohere`) |
| LLM | Any OpenAI-compatible endpoint through `langchain-openai` (developed against OpenRouter) |
| Tracing | Langfuse Cloud |
| Tooling | uv, pytest |

## Run it

Prerequisites: [uv](https://docs.astral.sh/uv/) (installs the pinned Python 3.14), Docker, a recent Node.js, an OpenRouter (or other OpenAI-compatible) key, and free Langfuse keys if you want traces.

```bash
uv sync
cp .env.example .env            # fill in LLM_API_KEY, LLM_MODEL, and optionally the LANGFUSE_* keys
docker compose up -d qdrant
```

**Get the data.** `data/` must contain `k8s/`, `docker/`, `terraform/core/`, `terraform/aws/` and `aws/<service>/` with Markdown files. The AWS pages can be downloaded with `uv run python scripts/download_aws.py`. The other four are sparse clones of their upstream repos filtered by `scripts/clean_corpus.py`; the paths used are listed in [CLAUDE.md](CLAUDE.md). A packaged dataset is planned.

**Build the index** in two steps:

```bash
uv run python backend/embed.py       # chunk + embed; slow on CPU (~2 chunks/s on a 4-core laptop)
uv run python backend/load.py        # add BM25 vectors and load Qdrant (about a minute)
```

On CPU, embedding the full corpus takes hours. Run `notebooks/embed_colab.ipynb` on a free Colab GPU instead and drop its `embeddings/` output into the project, or pass source names to `embed.py` (for example `docker aws-eks`) to build a slice.

**Start it:**

```bash
uv run python backend/pipeline.py "my pod keeps restarting after deploy"   # one question in the terminal
uv run uvicorn app:app --app-dir backend --port 8000                      # API: POST /ask
cd frontend && npm install && npm run dev -- --port 3001                  # UI
```

### Configuration

All in `.env` (see `.env.example`): `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `JUDGE_MODEL`, `RERANKER` (`local` or `cohere`), `ROUTER=off` to disable the prompt router, `ONLINE_EVAL=off` to skip background answer grading, `QUERY_TRANSFORM=off` to skip the query rewrite (about 2 s faster), `LLM_REASONING=on` to enable the model's hidden reasoning (off by default on OpenRouter, it added about 10 s per call), and the `LANGFUSE_*` keys. Tracing switches itself off when no Langfuse key is set.

## Evals

```bash
uv run python evals/run.py --no-transform           # retrieval metrics, no LLM calls
uv run python evals/run.py --no-transform --judge   # adds generated answers and LLM-judged metrics
uv run python evals/run.py --no-transform --check   # regression check against evals/baseline.json
uv run pytest tests                                 # gate, NDCG, router and observability logic
```

How the questions, labels and metrics work is in [BENCHMARK.md](BENCHMARK.md).

## Project layout

```
backend/    chunking.py, embed.py, load.py (ingestion) · pipeline.py (online stages) · router.py (prompt router) · monitor.py (online evals, queue, metrics) · app.py (API)
frontend/   Next.js UI
evals/      dataset, runner, baseline, results
scripts/    data download and cleaning
notebooks/  Colab embedding notebook
tests/      gate, router and monitor tests
```

## Status

Built and tested: ingestion, the pipeline stages above, the prompt router (on by default), the streaming API, Langfuse tracing, online evals (LLM-judged faithfulness and relevance on live answers), user feedback, a bad-answer queue and a metrics dashboard at `/dashboard`, and the eval harness with a local regression check.

Known gaps:
- **No web-search fallback.** Weak retrieval is flagged and the answer says the docs may not cover it.
- **Queue thresholds** (faithfulness < 0.7, answer relevancy < 0.5) are uncalibrated, and the LLM judge is noisy on "the docs don't cover this" answers. The dashboard reads everything from Langfuse, so it lags a few seconds and shows cost only if Langfuse has a price for the model (otherwise tokens only).
- **Latency** is about 10 s for an uncached answer on a 4-core laptop, most of it the two LLM calls and CPU reranking. Cached answers return in well under a second.
- **Retrieval misses** are known: for example the Docker volumes reference page ranks 11th before reranking and the reranker drops it.
- **Cache threshold** (0.95 cosine) is calibrated for zero wrong hits (`evals/cache_calibrate.py`) but only 57% of paraphrases hit; bge-small separates near-duplicate questions poorly.
- **No auth or rate limiting** on the API, and no deployment setup.
- **No CI.** The eval check (`--check`) runs locally only.
