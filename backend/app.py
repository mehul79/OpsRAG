"""FastAPI: POST /ask streams the answer as server-sent events (sources, token..., done | error).
Observability endpoints: GET /metrics, GET /queue, POST /feedback, POST /resolve.

Run: uv run uvicorn app:app --app-dir backend --reload
ONLINE_EVAL=on|off (default on) grades each fresh answer with JUDGE_MODEL in the background; ONLINE_EVAL_RATE samples (0..1).
"""
import json, logging, os, random, time
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from langfuse import get_client
from pydantic import BaseModel, Field
import monitor
from pipeline import ask, judge_llm

app = FastAPI(title="OpsRAG")
app.add_middleware(CORSMiddleware, allow_origin_regex=r"http://localhost:\d+", allow_methods=["GET", "POST"], allow_headers=["Content-Type"])
log = logging.getLogger("opsrag")
ID = r"^[0-9a-f]{32}$"
WINDOWS = {"1h": 3600, "24h": 86400, "7d": 7 * 86400, "all": None}


class Question(BaseModel):
    question: str = Field(min_length=1, max_length=2000)


class Feedback(BaseModel):
    id: str = Field(pattern=ID)
    good: bool
    comment: str | None = Field(default=None, max_length=1000)


class Resolve(BaseModel):
    id: str = Field(pattern=ID)


def online_eval_on():
    return os.getenv("ONLINE_EVAL", "on") == "on" and random.random() < float(os.getenv("ONLINE_EVAL_RATE", "1"))


@app.post("/ask")
def ask_route(body: Question):
    def events():
        t0, sources, answer = time.time(), [], ""
        trace_id = get_client().create_trace_id()  # minted here so the id is known before the stream starts
        try:
            for kind, data in ask(body.question, langfuse_trace_id=trace_id):
                if kind == "sources":
                    sources = data
                elif kind == "token":
                    answer += data
                elif kind == "done":
                    qid = monitor.log_query(body.question, answer, data["route"], data["cached"], data["weak"],
                                            (time.time() - t0) * 1000, data.get("top_score"), trace_id)
                    if data["route"] == "retrieve" and not data["cached"] and online_eval_on():
                        monitor.judge_async(qid, body.question, sources, answer, judge_llm)  # before the last yield: survives a client disconnect
                    data = {**data, "id": qid, "trace_id": trace_id}
                yield f"event: {kind}\ndata: {json.dumps(data)}\n\n"
        except Exception:
            log.exception("ask failed")
            yield f"event: error\ndata: {json.dumps('Something went wrong answering that question.')}\n\n"
    return StreamingResponse(events(), media_type="text/event-stream")


def trace_url(trace_id):
    try:
        return get_client().get_trace_url(trace_id=trace_id) if trace_id else None
    except Exception:
        return None


@app.get("/metrics")
def metrics(window: str = "24h"):
    if window not in WINDOWS:
        raise HTTPException(422, f"window must be one of {list(WINDOWS)}")
    return {**monitor.stats(time.time() - WINDOWS[window] if WINDOWS[window] else 0.0), "window": window}


@app.get("/queue")
def queue():
    return [{**r, "trace_url": trace_url(r["trace_id"])} for r in monitor.queue()]


@app.post("/feedback")
def feedback(body: Feedback):
    if not monitor.feedback(body.id, body.good, body.comment):
        raise HTTPException(404, "unknown answer id")
    return {"ok": True}


@app.post("/resolve")
def resolve(body: Resolve):
    monitor.resolve(body.id)
    return {"ok": True}
