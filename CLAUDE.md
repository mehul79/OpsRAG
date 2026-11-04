# OpsRAG

A RAG copilot that answers questions about infrastructure docs and traces every answer, so a weak answer can be tied to the stage that caused it. It is a portfolio project: the focus is retrieval quality and observability, not document parsing.

Built: data scripts, ingestion, the online pipeline (`backend/pipeline.py`), a FastAPI streaming endpoint (`backend/app.py`), a retrieval eval (`evals/`), the prompt router (`backend/router.py`), the observability layer (`backend/monitor.py`: online evals, feedback, bad-answer queue, metrics) and the Next.js frontend with a `/dashboard` page (`frontend/`). Dropped from the plan: CRAG web search and the CI eval gate. Diagrams: `docs/system-design.png`, `docs/observability.png`; benchmark write-up: `docs/BENCHMARK.md`.

## Scope

Included: hybrid retrieval (BM25 + dense), a reranker, query transformation, corrective RAG (CRAG), semantic caching, and observability (traces, metrics, evals).

Skipped: PDFs, images, tables, messy or scanned data. Little time goes into ingestion beyond a clean corpus.

## Corpus

Kubernetes, Terraform, Docker and AWS docs. All public markdown, so no PDF or image handling. Everything lives in `data/` (gitignored, re-creatable).

| Source | Where it comes from | Path |
| --- | --- | --- |
| Kubernetes | `kubernetes/website`, `content/en/docs` (sparse clone) | `data/k8s` |
| Docker | `docker/docs`, `content/` (sparse clone) | `data/docker` |
| Terraform core | `hashicorp/web-unified-docs`, `content/terraform/v1.17.x` (latest only) | `data/terraform/core` |
| Terraform AWS provider | `hashicorp/terraform-provider-aws`, `website/docs` (`.markdown`) | `data/terraform/aws` |
| AWS services | `docs.aws.amazon.com` `.md` pages via each guide's `llms.txt` (EC2, ECS, EKS, IAM, CloudFront, RDS trimmed to operational sections, ELB, Billing, Support; `aws-support-plans.md` was fetched by hand because the Support `llms.txt` omits it) | `data/aws/<service>` |

Cleanup status: done. All sources are pruned (no `auto_generated` pages, Hugo fragments, partials or repo-root junk; `tf-aws` keeps only core-service `r/` pages) and ingested: 51,082 points in Qdrant Cloud (48,572 original + 2,510 from Billing and Support) across k8s, docker, terraform-core, terraform-aws and the nine AWS guides. `data/aws` files start with a `<!-- source: URL -->` line, usable as the citation.

Heads up when ingesting: strip front matter and Hugo `{{< >}}` shortcodes, don't split on `#` inside code fences, and tag each chunk with its source (and `doc_type` for Terraform core vs AWS resources).

## Stack

| Part | Tool |
| --- | --- |
| Frontend and API | Next.js and FastAPI |
| Hybrid index | Qdrant, dense vectors plus BM25 |
| Semantic cache | Second Qdrant collection `opsrag_cache` (Redis dropped: Qdrant already does vector search) |
| Fusion | Reciprocal rank fusion (RRF) |
| Reranker | Local cross-encoder `Xenova/ms-marco-MiniLM-L-6-v2` via fastembed (default, `RERANKER=local`) or Cohere Rerank API (`RERANKER=cohere`), top 20 to 5 |
| Embeddings | `BAAI/bge-small-en-v1.5` dense (384) + `Qdrant/bm25` sparse |
| LLM | OpenRouter (OpenAI-compatible) via `langchain-openai`; default `deepseek/deepseek-v4.1-flash`. Config: `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` |
| Observability | Langfuse Cloud (`@observe` span per stage, LangChain callback for LLM calls) |

## Pipeline

Offline (runs once): collect docs, chunk each page by heading, embed, store in the hybrid index.

Online (every query):
1. Query arrives via Next.js + FastAPI.
2. Semantic cache lookup. A hit returns the cached answer right away.
3. Query transform: rewrite and decomposition into up to 3 queries (HyDE was considered and deliberately skipped: recall is already high and the LLM rewrite showed no gain; revisit only if evals on more vague questions show dense misses).
4. Hybrid retrieval with RRF fusion of BM25 and dense results.
5. Cross-encoder reranks top 20 down to 5.
6. CRAG grader checks reranker scores. Weak retrieval is flagged (no web search fallback: dropped).
7. LLM writes a grounded answer with citations.
8. Response streams back and is written to the cache.

## Observability loop

Flag a weak answer, open its trace, find the failing stage (retrieval, reranking or generation), fix it, re-test. The layer holds traces, metrics (latency, cache hits), online evals (faithfulness, relevance), a bad-answer queue and a dashboard.

How it is built (Langfuse only, no local store): `app.py` mints a Langfuse trace id per `/ask` (passed to `ask` as `langfuse_trace_id`) and returns it in `done`; the trace id is the answer id. The root `ask` span carries the question, answer and `route`/`cached`/`weak`/`top_score` metadata, with a child span per stage. Online evals: after each fresh retrieval answer a background thread runs the same LLM judge as `evals/run.py --judge` (shared code in `backend/monitor.py`) with `JUDGE_MODEL` and writes `faithfulness`, `answer_relevancy` and `context_relevancy` as scores on the trace; `ONLINE_EVAL=off` disables it, `ONLINE_EVAL_RATE` samples it. User feedback is a `user_feedback` score (0 or 1, with the comment) and "resolved" is a `resolved` score; a thumbs-down newer than the resolve mark reopens the item. The dashboard endpoints read the root spans, generation spans (tokens, cost) and scores back through Langfuse's v2 observations and v3 scores endpoints (the older trace endpoints are being removed 2026-11-16), cached for 10 s, so data lags a few seconds. A load reads at most 2000 answers per window, 100 per request. The bad-answer queue holds unresolved answers with a thumbs-down, weak retrieval, faithfulness < 0.7 or answer relevancy < 0.5 (thresholds uncalibrated, `monitor.py`); each links to its trace. Cost shows only if Langfuse has a price for the model (it has none for the OpenRouter DeepSeek model, so the dashboard shows tokens and `–` for cost). If Langfuse can't be read the endpoints return 502. `uv run pytest tests/test_monitor.py` covers it with a fake Langfuse.

## Running things

- `docker compose up -d qdrant` starts Qdrant (6333) for local dev. The live index is on Qdrant Cloud (`QDRANT_URL` + `QDRANT_API_KEY`); free clusters suspend after a week idle and are deleted after four.
- `python util_scripts/download_aws.py [service ...]` downloads the AWS docs into `data/aws`. Re-runs skip existing files. `util_scripts/clean_corpus.py` is the one-off pruning that built `data/`.
- Ingestion is two steps. `python backend/embed.py [source ...]` chunks and embeds with bge-small (slow on CPU, about 2 chunks/s; on a Colab T4 about 135 chunks/s: zip `backend/chunking.py`, `backend/embed.py` and the `data/` folders you need, run embed.py there). It overwrites `embeddings/chunks.jsonl` + `vectors.npy`, so embed new sources into a separate folder. Then `python backend/load.py [dir]` adds BM25 vectors and upserts into Qdrant (idempotent, content-hash ids). The local `embeddings/` was deleted after the cloud load; rebuilding means re-embedding from `data/` (~7 min on a T4 for all 51k chunks). `backend/chunking.py` is the shared stdlib-only chunker (`python backend/chunking.py` self-checks it). Sources: `k8s`, `docker`, `terraform-core`, `terraform-aws`, `aws-<service>`.
- Dependencies are managed with `uv` (Python 3.14, `pyproject.toml` + `uv.lock`): `uv sync`, `uv add <pkg>`, `uv run ...`.
- Secrets go in `.env` (gitignored); copy `.env.example`. Optional switches: `QUERY_TRANSFORM=off` skips the LLM rewrite (saves ~2s), `LLM_REASONING=on` re-enables the model's hidden reasoning (off by default on OpenRouter: it cost ~10s per call), `RERANKER=cohere`, `ROUTER=on|off` (default on; see Prompt router), `ONLINE_EVAL=on|off` (default on), `ONLINE_EVAL_RATE`.
- Frontend: `cd frontend && npm run dev -- --port 3001` (port 3000 is taken on the dev machine; the API allows any `localhost` origin). Set `NEXT_PUBLIC_API_URL` if the API isn't on `localhost:8000`.
- Evals: `python evals/run.py --no-transform` runs 37 retrieval questions (`evals/dataset.jsonl`, rebuilt by `evals/make_dataset.py`) and prints recall@20/@5, precision@5, NDCG@5, MRR@5 and weak-flag accuracy (labels are an expected-path regex per question, so precision/NDCG read low). `--judge` also generates answers and grades context relevancy, answer relevancy and faithfulness with `JUDGE_MODEL` (default `openai/gpt-6-luna`, ~10 min, costs a few cents); those are LLM-graded, so they stay out of `--check`. `--check` is a regression check against `evals/baseline.json` (3-point tolerance); refresh the baseline from `evals/results/latest.json` only when a change is intended. `uv run pytest tests` tests the gate logic.
- `uv run python backend/pipeline.py "question"` runs one query end to end. `uv run uvicorn app:app --app-dir backend --reload` serves `POST /ask` (server-sent events: `sources`, `token`..., `done` or `error`).
- The pipeline is plain functions (`backend/pipeline.py`), no LangGraph. LangChain is used only as the OpenAI-compatible LLM client (`langchain-openai`).

## API contract and frontend

`POST /ask {"question": str}` streams server-sent events:
- `sources`: list of the chunks the answer is grounded on, in citation order (`sources[0]` is `[1]`). Each has `source`, `heading`, `path`, `url` (AWS only, else null), `position`, `score` (reranker relevance) and `text`.
- `token`: answer text pieces. The answer cites chunks inline as `[n]`.
- `done`: `{"cached": bool, "weak": bool, "route": str, "trace_id": str}` (plus `top_score` on fresh answers and `route_confidence` on routed ones). `weak` means retrieval was low-confidence. `route` is `retrieve` or a skip label (`chitchat`, `about_bot`, `out_of_scope`). `trace_id` is the Langfuse trace and identifies the answer for feedback.
- `error`: a message string.

Other endpoints: `GET /metrics?window=1h|24h|7d|30d` (counts, cache-hit and weak rates, route mix, latency p50/p95 for uncached answers, mean judge scores, thumbs, tokens, cost when priced, open queue size), `GET /queue?window=...` (unresolved bad answers; `id` is the trace id; with `reasons` and `trace_url`), `POST /feedback {trace_id, good, comment?}` (`trace_id` is the 32-char hex from `done`), `POST /resolve {trace_id}`.

Frontend (Next.js, built): `/` is a landing page (`app/page.tsx`, `components/landing/`) whose hero embeds the isometric figure from `frontend/anatomy` (`node frontend/anatomy/build.mjs` writes `frontend/public/anatomy/opsrag.html`); the chat lives at `/chat`. Chat and dashboard share the landing palette (tokens in `app/globals.css`) and have a light, dark and system theme toggle (`components/theme-toggle.tsx`, stored as `opsrag-theme` in localStorage and applied before paint by the script in `app/layout.tsx`); the landing page stays light. Chat: answer in the main pane with `[n]` citations and Yes/No feedback buttons; a right sidebar lists every retrieved chunk with its source, heading, relevance score and text. Clicking `[n]` highlights chunk n in the sidebar. A notice shows when `weak` is true, and routed prompts show the route instead of chunks. `/dashboard` shows the metrics, the bad-answer queue (open trace, resolve) and refreshes every 15 s.

## Conventions

- Keep ingestion minimal: clean files, split by heading, embed. Write the splitter by hand, no LangChain. Support a per-source flag so dev can ingest a small slice.
- Every online pipeline stage emits a trace span.
- Prompt router (`backend/router.py`): logistic regression on bge-small embeddings routes each prompt to `retrieve`, `chitchat`, `about_bot` or `out_of_scope`; the last three skip retrieval and return a canned reply. It only skips when the top non-retrieve probability is >= `ROUTER_MIN` (0.8); any failure retrieves. Weights in `backend/router_weights.npz`; retrain with `python backend/router.py train`; data from `evals/make_router_dataset.py`. `python evals/router_eval.py [--check]` evaluates it. Last run (test n=230): retrieve_recall 1.0 (zero false skips, 0/35 retrieval-eval questions skipped), skip_coverage 0.613, macro_f1 0.797, ~7 ms; `--check` passes. `ROUTER` defaults to `on`; set `ROUTER=off` to disable.
- No web search for CRAG: weak retrieval (all reranker scores below `RELEVANCE_MIN`) is flagged and the answer says the docs may not cover it. Weak answers are never cached.
- `RELEVANCE_MIN` (0.0 for the local reranker) is validated by the eval: answerable questions score >= 1.9 at top-1 and unanswerable ones <= -9.6. `CACHE_MIN` (0.95) is calibrated by `python evals/cache_calibrate.py` (pairs in `evals/cache_pairs.py`: 30 paraphrases, 34 same-topic different questions, e.g. EKS vs ECS). 0.95 is the lowest threshold with zero false hits (hardest negative scores 0.941), and it hits 57% of paraphrases; lowering it to 0.90 hits 80% but gives 4 false hits (wrong cached answers), so it stays at 0.95. bge-small is weak at separating near-duplicate questions (abbreviations like ALB/NLB, PVC score 0.54-0.57); a better cache embedder or a rerank check is the next lever.
- Current eval baseline (no rewrite): recall@20 1.00, recall@5 0.971, precision@5 0.514, NDCG@5 0.543, MRR@5 0.736, weak-flag accuracy 1.00. The LLM rewrite scored slightly lower (0.943 recall@5, one question) on this small set.
