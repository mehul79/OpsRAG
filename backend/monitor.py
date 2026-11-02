"""Observability store: one SQLite row per answered query (latency, cache, weak, route), online LLM-judge scores,
user feedback, and the bad-answer queue. Traces and per-call cost stay in Langfuse; each row keeps its trace_id so the
queue and dashboard can link to it. (Langfuse's read API is being deprecated, hence the local store.)
"""
import json, logging, os, re, sqlite3, threading, time, uuid
from pathlib import Path

DB = Path(os.getenv("MONITOR_DB", Path(__file__).resolve().parent.parent / "logs" / "opsrag.db"))
# ponytail: thresholds are uncalibrated guesses; tune them against the queue once there are real flagged answers
FAITH_MIN, RELEVANCY_MIN = 0.7, 0.5
log = logging.getLogger("monitor")
_lock = threading.Lock()  # sqlite writers from request threads + judge threads

SCHEMA = """CREATE TABLE IF NOT EXISTS q (
  id TEXT PRIMARY KEY, ts REAL, question TEXT, answer TEXT, route TEXT, cached INT, weak INT, latency_ms INT,
  top_score REAL, trace_id TEXT, faithfulness REAL, answer_relevancy REAL, context_relevancy REAL,
  thumbs INT, comment TEXT, resolved INT DEFAULT 0)"""


def conn():
    DB.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    c.execute(SCHEMA)
    return c


def run(sql, args=()):
    with _lock:
        c = conn()
        try:
            with c:  # commit
                return [dict(r) for r in c.execute(sql, args).fetchall()]
        finally:
            c.close()


def log_query(question, answer, route, cached, weak, latency_ms, top_score, trace_id):
    qid = uuid.uuid4().hex
    run("INSERT INTO q (id, ts, question, answer, route, cached, weak, latency_ms, top_score, trace_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (qid, time.time(), question, answer, route, int(cached), int(weak), int(latency_ms), top_score, trace_id))
    return qid


def _langfuse_score(trace_id, name, value, comment=None):
    try:
        from langfuse import get_client
        get_client().create_score(trace_id=trace_id, name=name, value=value, comment=comment)
    except Exception:
        log.exception("langfuse score failed")


def set_scores(qid, **scores):
    """Store judge scores (None values skipped) and mirror them onto the Langfuse trace."""
    scores = {k: v for k, v in scores.items() if v is not None}
    if not scores:
        return
    cols = ", ".join(f"{k}=?" for k in scores)  # keys come from our own code, never from a request
    run(f"UPDATE q SET {cols} WHERE id=?", (*scores.values(), qid))
    row = run("SELECT trace_id FROM q WHERE id=?", (qid,))
    if row and row[0]["trace_id"]:
        for k, v in scores.items():
            _langfuse_score(row[0]["trace_id"], k, v)


def feedback(qid, good, comment=None):
    """Thumbs up/down. Returns False if the id is unknown."""
    if not run("SELECT 1 FROM q WHERE id=?", (qid,)):
        return False
    run("UPDATE q SET thumbs=?, comment=?, resolved=0 WHERE id=?", (1 if good else -1, (comment or "")[:1000], qid))
    row = run("SELECT trace_id FROM q WHERE id=?", (qid,))[0]
    if row["trace_id"]:
        _langfuse_score(row["trace_id"], "user_feedback", 1 if good else 0, comment)
    return True


def resolve(qid):
    run("UPDATE q SET resolved=1 WHERE id=?", (qid,))


def reasons(r):
    out = []
    if r["thumbs"] == -1: out.append("thumbs down")
    if r["weak"]: out.append("weak retrieval")
    if r["faithfulness"] is not None and r["faithfulness"] < FAITH_MIN: out.append(f"low faithfulness ({r['faithfulness']:.2f})")
    if r["answer_relevancy"] is not None and r["answer_relevancy"] < RELEVANCY_MIN: out.append(f"low relevancy ({r['answer_relevancy']:.2f})")
    return out


def queue(limit=50):
    """Unresolved bad answers, newest first, each with why it is queued. The caller adds the trace link."""
    rows = run("SELECT * FROM q WHERE resolved=0 AND (thumbs=-1 OR weak=1 OR faithfulness<? OR answer_relevancy<?) ORDER BY ts DESC LIMIT ?",
               (FAITH_MIN, RELEVANCY_MIN, limit))
    return [{**r, "reasons": reasons(r)} for r in rows]


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(p * len(xs)))] if xs else None


def mean(xs):
    xs = [x for x in xs if x is not None]
    return round(sum(xs) / len(xs), 3) if xs else None


def stats(since=0.0):
    rows = run("SELECT * FROM q WHERE ts>=?", (since,))
    n = len(rows)
    retrieved = [r for r in rows if r["route"] == "retrieve"]
    fresh = [r for r in retrieved if not r["cached"]]  # cache hits would hide pipeline latency
    lat = [r["latency_ms"] for r in fresh]
    routes = {}
    for r in rows:
        routes[r["route"]] = routes.get(r["route"], 0) + 1
    return {
        "total": n,
        "cache_hit_rate": round(sum(r["cached"] for r in retrieved) / len(retrieved), 3) if retrieved else None,
        "weak_rate": round(sum(r["weak"] for r in retrieved) / len(retrieved), 3) if retrieved else None,
        "routes": routes,
        "latency_ms": {"p50": pct(lat, 0.5), "p95": pct(lat, 0.95), "cached_p50": pct([r["latency_ms"] for r in retrieved if r["cached"]], 0.5)},
        "scores": {k: mean(r[k] for r in rows) for k in ("faithfulness", "answer_relevancy", "context_relevancy")},
        "judged": sum(r["faithfulness"] is not None for r in rows),
        "thumbs": {"up": sum(r["thumbs"] == 1 for r in rows), "down": sum(r["thumbs"] == -1 for r in rows)},
        "queue_open": len(queue(10_000)),
    }


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


def judge_async(qid, question, used, answer, llm_factory):
    """Fire-and-forget: a judge failure must never touch the user's request, so it is only logged."""
    def work():
        try:
            set_scores(qid, **judge(llm_factory(), question, used, answer))
        except Exception:
            log.exception("online eval failed for %s", qid)
    threading.Thread(target=work, daemon=True).start()
