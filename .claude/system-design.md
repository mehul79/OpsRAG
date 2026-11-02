# OpsRAG system design

```mermaid
flowchart TB
    subgraph offline["Offline (runs once)"]
        direction LR
        corpus["Docs corpus<br/>K8s, TF, Docker, AWS"] --> chunk["Chunk + embed<br/>split by heading"] --> index[("Hybrid index<br/>Qdrant dense + BM25")]
    end

    subgraph online["Online (every query)"]
        direction TB
        query["User query<br/>Next.js + FastAPI"] --> cache{"Semantic cache<br/>Qdrant collection"}
        cache -- miss --> transform["Query transform<br/>rewrite, decompose"]
        transform --> retrieval["Hybrid retrieval<br/>BM25 + dense, RRF fusion"]
        retrieval --> rerank["Reranker<br/>cross-encoder, top 20 to 5"]
        rerank --> grader{"CRAG grader<br/>score relevance"}
        grader -- chunks weak --> web["Web search<br/>if chunks weak"]
        grader -- chunks ok --> llm["LLM generation<br/>grounded answer + citations"]
        web --> llm
        llm --> response["Response<br/>streamed, written to cache"]
    end

    cache -- hit, return early --> response
    index -.-> retrieval
    response -. write .-> cache

    subgraph obs["Observability (Langfuse)"]
        direction TB
        traces["Traces<br/>span per stage"]
        metrics["Metrics<br/>latency, cost, hits"]
        evals["Online evals<br/>faithfulness, recall"]
        bad["Bad answers<br/>flagged + traced"]
        gate["CI eval gate<br/>blocks regressions"]
        dash["Dashboard<br/>fix, retest loop"]
    end

    llm -.-> obs
```

Notes:
- Offline ingestion is a short script: gather the four doc sets (git clones plus AWS `.md` pages), clean them, split pages by heading, embed, load into Qdrant (dense + BM25).
- A semantic cache hit skips the whole pipeline. A miss runs transform, retrieval, rerank, grading and generation, and the final response is written back to the cache.
- The CRAG grader sends weak chunk sets to web search before generation. Strong sets go straight to the LLM.
- Every online stage emits a trace span. The dashed edge into the observability panel stands for that telemetry. Weak answers are flagged, traced to the failing stage, fixed, and re-tested behind the CI eval gate.
