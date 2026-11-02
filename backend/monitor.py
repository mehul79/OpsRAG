"""Observability on Langfuse only. Each /ask is one trace whose root span `ask` carries the question, answer and
route/cached/weak/top_score metadata. Judge scores, user feedback and "resolved" marks are Langfuse scores on that trace.
The dashboard reads them back through the v2 observations and v3 scores endpoints (the older trace endpoints are being removed).
There is no local store: the trace id is the answer id. Langfuse ingests asynchronously, so new data lags by a few seconds.
"""
import json, logging, os, re, threading, time
from datetime import datetime, timezone

import httpx

# ponytail: thresholds are uncalibrated guesses; tune them against the queue once there are real flagged answers
FAITH_MIN, RELEVANCY_MIN = 0.7, 0.5
SCORES = ("faithfulness", "answer_relevancy", "context_relevancy")
MAX_PAGES, PAGE = 20, 100  # Langfuse's scores endpoint allows at most 100 per page. ponytail: caps one load at 2000 answers per window; add date-slicing if traffic grows
CACHE_S = 10  # the dashboard polls every 15 s and Langfuse is a network call: reuse the last fetch briefly
log = logging.getLogger("monitor")
_cache = {}


def lf(path, **params):
    base = os.getenv("LANGFUSE_BASE_URL") or os.getenv("LANGFUSE_HOST") or "https://cloud.langfuse.com"
    r = httpx.get(base.rstrip("/") + path, params=params, timeout=30,
                  auth=(os.environ["LANGFUSE_PUBLIC_KEY"], os.environ["LANGFUSE_SECRET_KEY"]))
    if r.is_error:
        log.error("langfuse %s -> %s %s", path, r.status_code, r.text[:300])
    r.raise_for_status()
    return r.json()


def paged(path, **params):
    out, cursor = [], None
    for _ in range(MAX_PAGES):
        body = lf(path, limit=PAGE, **params, **({"cursor": cursor} if cursor else {}))
        out += body["data"]
        cursor = body.get("meta", {}).get("cursor")
        if not cursor or len(body["data"]) < PAGE:
            break
    return out


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def epoch(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def plain(inp, out):
    """Spans written before ask() set its own input/output hold the raw call args and every yielded event; unwrap those."""
    try:
        if inp.startswith('{"args"'):
            inp = json.loads(inp)["args"][0]
        if out.startswith('[["sources"'):
            out = "".join(v for k, v in json.loads(out) if k == "token")
    except (ValueError, KeyError, IndexError, TypeError):
        pass
    return inp, out


def fetch(since):
    """One dict per answer in the window, newest first: the ask span joined with its generation tokens and its scores."""
    key = int(since // 60)
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_S:
        return hit[1]
    start = iso(since)
    asks = paged("/api/public/v2/observations", name="ask", fromStartTime=start, fields="core,basic,io,metadata")
    gens = paged("/api/public/v2/observations", type="GENERATION", fromStartTime=start, fields="core,basic,usage")
    scores = paged("/api/public/v3/scores", fromTimestamp=start, fields="details,subject")
    tokens, cost = {}, {}
    for g in gens:
        tokens[g["traceId"]] = tokens.get(g["traceId"], 0) + (g.get("totalUsage") or 0)
        if g.get("totalCost") is not None:
            cost[g["traceId"]] = cost.get(g["traceId"], 0) + g["totalCost"]
    by_trace = {}
    for s in scores:  # latest score per (trace, name) wins
        if s.get("subject", {}).get("kind") == "trace" and s.get("dataType") == "NUMERIC":
            cur = by_trace.setdefault(s["subject"]["id"], {}).get(s["name"])
            if not cur or s["timestamp"] > cur["timestamp"]:
                by_trace[s["subject"]["id"]][s["name"]] = s
    rows = []
    for a in asks:
        t, sc, md = a["traceId"], by_trace.get(a["traceId"], {}), a.get("metadata") or {}
        fb, done = sc.get("user_feedback"), sc.get("resolved")
        question, answer = plain(a.get("input") or "", a.get("output") or "")
        rows.append({
            "id": t, "ts": epoch(a["startTime"]), "question": question, "answer": answer,
            "route": md.get("route", "retrieve"), "cached": bool(md.get("cached")), "weak": bool(md.get("weak")),
            "latency_ms": round((a.get("latency") or 0) * 1000), "top_score": md.get("top_score"),
            "tokens": tokens.get(t), "cost": cost.get(t),
            **{k: sc[k]["value"] if k in sc else None for k in SCORES},
            "thumbs": None if not fb else (1 if fb["value"] >= 0.5 else -1), "comment": fb and fb.get("comment"),
            "resolved": bool(done and (not fb or done["timestamp"] > fb["timestamp"])),  # a newer thumbs-down reopens it
        })
    rows.sort(key=lambda r: -r["ts"])
    _cache[key] = (time.time(), rows)
    return rows


def reasons(r):
    out = []
    if r["thumbs"] == -1: out.append("thumbs down")
    if r["weak"]: out.append("weak retrieval")
    if r["faithfulness"] is not None and r["faithfulness"] < FAITH_MIN: out.append(f"low faithfulness ({r['faithfulness']:.2f})")
    if r["answer_relevancy"] is not None and r["answer_relevancy"] < RELEVANCY_MIN: out.append(f"low relevancy ({r['answer_relevancy']:.2f})")
    return out


def queue(since, limit=50):
    """Unresolved bad answers, newest first, each with why it is queued. The caller adds the trace link."""
    items = [{**r, "reasons": reasons(r)} for r in fetch(since) if not r["resolved"]]
    return [r for r in items if r["reasons"]][:limit]


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(p * len(xs)))] if xs else None


def mean(xs):
    xs = [x for x in xs if x is not None]
    return round(sum(xs) / len(xs), 3) if xs else None


def stats(since):
    rows = fetch(since)
    retrieved = [r for r in rows if r["route"] == "retrieve"]
    fresh = [r for r in retrieved if not r["cached"]]  # cache hits would hide pipeline latency
    lat = [r["latency_ms"] for r in fresh]
    routes = {}
    for r in rows:
        routes[r["route"]] = routes.get(r["route"], 0) + 1
    tokens = [r["tokens"] for r in rows if r["tokens"]]
    costs = [r["cost"] for r in rows if r["cost"] is not None]
    return {
        "total": len(rows),
        "cache_hit_rate": round(sum(r["cached"] for r in retrieved) / len(retrieved), 3) if retrieved else None,
        "weak_rate": round(sum(r["weak"] for r in retrieved) / len(retrieved), 3) if retrieved else None,
        "routes": routes,
        "latency_ms": {"p50": pct(lat, 0.5), "p95": pct(lat, 0.95), "cached_p50": pct([r["latency_ms"] for r in retrieved if r["cached"]], 0.5)},
        "scores": {k: mean(r[k] for r in rows) for k in SCORES},
        "judged": sum(r["faithfulness"] is not None for r in rows),
        "thumbs": {"up": sum(r["thumbs"] == 1 for r in rows), "down": sum(r["thumbs"] == -1 for r in rows)},
        "tokens": {"total": sum(tokens), "per_answer": round(sum(tokens) / len(tokens)) if tokens else None},
        "cost_usd": round(sum(costs), 4) if costs else None,  # None when Langfuse has no price for the model
        "queue_open": len(queue(since, 10_000)),
    }


def score(trace_id, name, value, comment=None):
    """Write a score onto a trace (the SDK batches and sends it in the background)."""
    from langfuse import get_client
    get_client().create_score(trace_id=trace_id, name=name, value=value, comment=comment)
    _cache.clear()


def feedback(trace_id, good, comment=None):
    score(trace_id, "user_feedback", 1 if good else 0, (comment or "")[:1000] or None)


def resolve(trace_id):
    score(trace_id, "resolved", 1)


# --- online LLM judge (prompts shared with evals/run.py --judge) ---
CTX = """You grade retrieval for a documentation Q&A system. For each numbered passage, decide whether it contains
information that helps answer the question (1) or not (0). Return JSON only: {"relevant": [one 0 or 1 per passage, in order]}"""
FAITH = """Break the answer into its factual claims. Ignore citation markers like [1] and statements that the docs do not
cover something. For each claim decide whether the context directly supports it.
Return JSON only: {"claims": [{"claim": "...", "supported": true or false}]}"""
RELEVANCY = """Rate how directly the answer addresses the question: 1 = fully addresses it, 0.5 = only partly,
0 = does not address it (including only saying the docs do not cover it). Return JSON only: {"score": 0 or 0.5 or 1}"""


def ask_judge(llm, system, user):
    out = llm.invoke([("system", system), ("human", user)]).content
    return json.loads(re.search(r"\{.*\}", out, re.S).group(0))


def judge(llm, question, used, answer):
    """Context relevancy, faithfulness and answer relevancy, each 0..1 (None when there is nothing to score)."""
    context = "\n\n".join(f"[{i}] {h['text']}" for i, h in enumerate(used, 1))
    rel = ask_judge(llm, CTX, f"Question: {question}\n\nPassages:\n{context}")["relevant"]
    claims = ask_judge(llm, FAITH, f"Context:\n{context}\n\nAnswer:\n{answer}")["claims"]
    return {
        "context_relevancy": sum(rel) / len(rel) if rel else None,
        "faithfulness": sum(c["supported"] for c in claims) / len(claims) if claims else None,
        "answer_relevancy": float(ask_judge(llm, RELEVANCY, f"Question: {question}\n\nAnswer:\n{answer}")["score"]),
    }


def judge_async(trace_id, question, used, answer, llm_factory):
    """Fire-and-forget: a judge failure must never touch the user's request, so it is only logged."""
    def work():
        try:
            for name, value in judge(llm_factory(), question, used, answer).items():
                if value is not None:
                    score(trace_id, name, value)
        except Exception:
            log.exception("online eval failed for %s", trace_id)
    threading.Thread(target=work, daemon=True).start()
