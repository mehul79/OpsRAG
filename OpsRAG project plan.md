# OpsRAG: project plan

Nov 1, 2026 · @mehul

## Project

OpsRAG is a RAG copilot that answers questions about infrastructure docs and keeps a trace of every answer. When an answer is weak, the trace shows which stage caused it.

The project is for a portfolio and resume. It is meant to show retrieval quality work and observability, not document parsing.

Resume tagline: hybrid retrieval, reranking, corrective RAG and semantic caching over four doc sets, with per-query tracing.

## Scope

Included:

- Hybrid retrieval, combining keyword (BM25) and dense vector search
- A reranker
- Query transformation
- A corrective RAG setup
- Semantic caching
- Observability, with traces, metrics and evals

Skipped:

- Ingesting PDFs, images, tables, messy data and blurry scans
- Heavy time on the ingestion side in general. A large corpus is fine as long as it is clean.

## Corpus

The corpus is the Kubernetes, Terraform, Docker and AWS docs. They are public, written in markdown, and need no PDF or image handling. Ingestion is a short script that clones the repos and splits each page by heading.

The corpus also fits the features:

- Hybrid retrieval matters because queries contain exact terms such as `CrashLoopBackOff` or `aws_iam_role_policy_attachment`, where keyword search beats embeddings.
- A reranker helps because the same concept appears across several tools and versions.
- Query transformation helps with vague questions like "my pod keeps restarting after deploy".
- Corrective RAG flags questions the docs do not answer, so the answer can say so.
- Semantic caching pays off because people ask the same thing in different words.

## How it works

The offline ingestion job runs once:

1. Collect the docs from the four sources.
2. Chunk each page by heading and embed the chunks.
3. Store them in a hybrid index that supports both dense and BM25 search.

The online path runs on every query:

1. The user sends a query through the web app and API.
2. The semantic cache checks for a similar earlier query. On a hit, the cached answer returns immediately.
3. On a miss, query transformation rewrites the query, using HyDE or decomposition where needed.
4. Hybrid retrieval searches the index and fuses the keyword and dense results with reciprocal rank fusion.
5. A cross-encoder reranker narrows the top 20 chunks to 5.
6. The corrective RAG grader scores how relevant the chunks are. If they are weak, the answer is flagged as possibly not covered by the docs.
7. The LLM writes a grounded answer with citations.
8. The response streams back and is written to the cache.

## Observability loop

Every stage of the online path writes a span to the observability layer. The working loop is:

1. A weak answer is flagged.
2. Open its trace.
3. Find the stage that failed: retrieval, reranking or generation.
4. Fix it.
5. Test again.

The observability layer holds five pieces: traces, metrics (latency, cost, cache hits), online evals (faithfulness and relevance), a bad-answer queue, and a dashboard.

## Stack

These are the tools shown in the system design diagram.

| Part | Tool |
| --- | --- |
| Frontend and API | Next.js and FastAPI |
| Hybrid index | Qdrant, dense vectors plus BM25 |
| Semantic cache | Second Qdrant collection (`opsrag_cache`) |
| Fusion | Reciprocal rank fusion |
| Reranker | Cross-encoder |
| Observability | Langfuse Cloud (traces, scores) plus a local SQLite store for the dashboard |
