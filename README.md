# OpsRAG

A RAG copilot for infrastructure docs (Kubernetes, Docker, Terraform, AWS) that traces every answer back to the stage that produced it.

**Problem.** RAG demos answer well until they don't, and when an answer is bad you can't tell whether retrieval missed, the reranker dropped the right chunk, or the LLM made something up. Infra docs make this worse: questions mix exact identifiers (`aws_iam_role_policy_attachment`) with vague symptoms ("my pod keeps restarting").

**Solution.** Hybrid retrieval (BM25 + dense, fused with RRF), a cross-encoder reranker, a weak-retrieval check instead of guessing, and a semantic cache. Every stage is a Langfuse span, and every fresh answer is graded in the background. A bad answer lands in a queue with its trace one click away.

**What I learned.**
- Measure before adding stages. The LLM query rewrite and HyDE both looked like wins on paper, but on the eval set the rewrite lowered recall@5 (0.943 vs 0.971) and added about 2 s. It is off in the benchmark, and HyDE was never built.
- Thresholds need data. The reranker's top-1 scores split answerable (≥ 1.89) from unanswerable (≤ −9.64) questions with a wide gap, so the weak flag is reliable. The cache cut-off was the opposite: 0.95 cosine is the lowest value with zero wrong hits, and it only catches 57% of paraphrases.
- The biggest latency cost was hidden reasoning tokens. Turning reasoning off on OpenRouter saved about 10 s per LLM call.
- Eval failures are often label bugs. Two "misses" in the first run were wrong labels, not retrieval errors.
- Coverage beats tuning. "What are the AWS Support plans?" failed because the page wasn't in the corpus (AWS's own `llms.txt` index leaves it out), not because of ranking.

## System design

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/system-design-dark.png">
  <img alt="OpsRAG system design: Next.js chat calls FastAPI, which runs router, semantic cache, query rewrite, hybrid retrieval on Qdrant Cloud, rerank, CRAG grade and generation via OpenRouter; every stage is traced to Langfuse, an online judge scores answers, and the dashboard reads metrics back from Langfuse." src="docs/system-design.png">
</picture>

For each question, the prompt router first skips chitchat. A semantic-cache hit returns right away. On a miss the pipeline rewrites the query, runs dense and BM25 search in one Qdrant call (fused, top 20), reranks to 5, flags weak retrieval, and streams a cited answer. Offline, docs are chunked by heading, embedded on a Colab GPU and upserted with BM25 vectors.

## Evals and benchmark

The eval set has 37 questions: 35 answerable and 2 unanswerable. They are spread over Kubernetes, Docker, Terraform and AWS, and cover how-to, concept, exact-identifier, compare and vague questions. Each answerable question is labelled with a regex over the expected doc path. `evals/run.py` runs the real pipeline over the live index and scores retrieval; `--judge` also generates answers and grades them with a separate LLM (`openai/gpt-6-luna`).

| Metric | Score | Meaning |
| --- | --- | --- |
| recall@20 | **1.000** | The right doc reached the 20 fused candidates for every question |
| recall@5 | **0.971** | The right doc survived reranking into the top 5 (34 of 35) |
| MRR@5 | 0.736 | The first right doc is usually rank 1 or 2 |
| precision@5 / NDCG@5 | 0.514 / 0.543 | Low by construction: one path label per question, so a correct chunk from another page counts as wrong |
| weak-flag accuracy | **1.000** | Unanswerable questions flagged weak, answerable ones not |
| context relevancy | 0.857 | Share of top-5 chunks the judge found useful |
| answer relevancy | 0.971 | The answer addresses the question |
| faithfulness | 0.967 | Share of answer claims supported by the retrieved chunks |

| Component | Result |
| --- | --- |
| Prompt router (logistic regression on bge-small, test n = 230) | retrieve recall 1.0 (0 false skips), skip coverage 0.613, macro-F1 0.797, 7 ms p50 |
| Semantic cache (30 paraphrase / 34 near-miss pairs) | 0.95 cosine: 0 wrong hits, 57% paraphrase hits (0.90 would hit 80% but serve 4 wrong answers) |

The retrieval metrics were re-run on 2026-11-04 against the current Qdrant Cloud index (51,082 chunks), and they match the baseline. The judged metrics come from the 2026-11-02 run on 48,572 chunks.

These are small-sample numbers from one run, so read them as a regression baseline, not a general quality claim. `--check` fails if recall@20, recall@5, precision@5, NDCG@5 or weak-flag accuracy drops more than 3 points below `evals/baseline.json`. Labels, definitions, per-kind results and limitations are in [BENCHMARK.md](BENCHMARK.md).

```bash
uv run python evals/run.py --no-transform --check   # retrieval metrics + regression gate (~2 min, no LLM calls)
uv run python evals/run.py --no-transform --judge   # adds LLM-judged answer quality (~10 min, a few cents)
uv run python evals/router_eval.py --check          # router
uv run python evals/cache_calibrate.py              # cache threshold
```

## Tracing, monitoring and observability

The loop is: flag a weak answer, open its trace, find the failing stage, fix it, re-test. Everything lives in Langfuse, so there is no local database.

- **Traces.** Each `/ask` gets a Langfuse trace id, which is also the answer id. The root `ask` span carries the question, the answer and `route` / `cached` / `weak` / `top_score`. A child span covers each stage (`router`, `semantic-cache`, `query-transform`, `hybrid-retrieval`, `rerank`, `crag-grade`, `generate`, `cache-write`), and LLM calls come in as generations with token counts.
- **Live stages.** The API streams a `stage` event as each step starts and finishes, with its timing and metadata. The chat shows the pipeline running, and the inspector shows the sources, per-stage detail and the span tree from `GET /trace/{id}`.
- **Online evals.** After each fresh answer, a background thread runs the same judge as the offline eval and writes `faithfulness`, `answer_relevancy` and `context_relevancy` as scores on the trace. `ONLINE_EVAL=off` disables it and `ONLINE_EVAL_RATE` samples it.
- **Feedback.** Yes/No in the UI becomes a `user_feedback` score with an optional comment.
- **Bad-answer queue.** It collects unresolved answers with a thumbs-down, weak retrieval, faithfulness below 0.7 or answer relevancy below 0.5. Each item links to its trace. Resolving one writes a `resolved` score, and a newer thumbs-down reopens it.
- **Dashboard** (`/dashboard`). It shows answer counts, cache-hit and weak rates, route mix, p50/p95 latency, mean judge scores, thumbs and tokens. The endpoints are `GET /metrics` and `GET /queue`, which read back through Langfuse's observations and scores APIs with a 10 s cache, so the dashboard lags a few seconds.

## Setup

**Prerequisites:** [uv](https://docs.astral.sh/uv/) (installs Python 3.14), Node.js, an OpenRouter or other OpenAI-compatible API key, a free [Qdrant Cloud](https://cloud.qdrant.io) cluster or Docker, and free [Langfuse](https://cloud.langfuse.com) keys for tracing.

**1. Install and configure**

```bash
uv sync
cp .env.example .env    # LLM_API_KEY, QDRANT_URL + QDRANT_API_KEY, LANGFUSE_* (each variable is commented)
```

For a local Qdrant instead of the cloud, run `docker compose up -d qdrant` and keep `QDRANT_URL=http://localhost:6333` with an empty key. Tracing switches itself off when no Langfuse key is set.

**2. Get the docs.** `data/` is gitignored. AWS pages come from each guide's `llms.txt`:

```bash
uv run python util_scripts/download_aws.py               # or name services: ec2 eks billing ...
```

Kubernetes, Docker and Terraform are sparse clones of their upstream repos, pruned by `util_scripts/clean_corpus.py`. The repos and paths are listed in [CLAUDE.md](CLAUDE.md).

**3. Build the index**

```bash
uv run python backend/embed.py [source ...]   # chunk + embed into embeddings/
uv run python backend/load.py [dir]           # add BM25 vectors, upsert into Qdrant
```

Embedding runs at about 2 chunks/s on a laptop CPU and about 135 chunks/s on a free Colab T4. For Colab, zip `backend/chunking.py`, `backend/embed.py` and the `data/` folders you need, run `embed.py` there, and bring `embeddings/` back. `embed.py` overwrites its output, so embed a new source into a separate folder and `load.py` that folder. Loading is idempotent.

**4. Run**

```bash
uv run uvicorn app:app --app-dir backend --port 8000   # API
cd frontend && npm install && npm run dev               # UI on :3000, dashboard at /dashboard
uv run python backend/pipeline.py "my pod keeps restarting after deploy"   # one question in the terminal
uv run pytest tests                                     # gate, router and observability tests
```

Optional switches in `.env`: `QUERY_TRANSFORM=off` (skip the rewrite), `ROUTER=off`, `RERANKER=cohere`, `ONLINE_EVAL=off`, `LLM_REASONING=on`. Set `NEXT_PUBLIC_API_URL` if the API isn't on `localhost:8000`.

## Project layout

```
backend/        app.py (API) · pipeline.py (online stages) · router.py · monitor.py (online evals, queue, metrics, traces)
                chunking.py · embed.py · load.py (ingestion)
frontend/       Next.js chat, inspector and /dashboard
evals/          datasets, runners, baselines
util_scripts/   AWS download and corpus cleanup
tests/          gate, router and monitor tests
docs/           system design diagram
```

## Known gaps

- No web-search fallback: weak retrieval is flagged and the answer says the docs may not cover it.
- Queue thresholds are uncalibrated, and the judge is noisy on "the docs don't cover this" answers.
- An uncached answer takes about 10 s on a 4-core laptop, mostly LLM calls and CPU reranking. Cached answers return in under a second.
- bge-small separates near-duplicate questions poorly, which caps the cache hit rate.
- There is no auth, rate limiting, CI or deployment. Qdrant Cloud's free cluster suspends after a week without use.
