"""FastAPI: POST /ask streams the answer as server-sent events (sources, token..., done | error).
Observability endpoints (all read from or write to Langfuse): GET /metrics, GET /queue, GET /trace/{id}, POST /feedback, POST /resolve.

Run: uv run uvicorn app:app --app-dir backend --reload
ONLINE_EVAL=on|off (default on) grades each fresh answer with JUDGE_MODEL in the background; ONLINE_EVAL_RATE samples (0..1).
"""
import json, logging, os, random, time
import httpx
from fastapi import FastAPI, HTTPException, Path
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from langfuse import get_client
from pydantic import BaseModel, Field
import monitor
from pipeline import ask, judge_llm

app = FastAPI(title="OpsRAG")
app.add_middleware(CORSMiddleware, allow_origin_regex=r"http://localhost:\d+", allow_origins=[o for o in os.getenv("CORS_ORIGINS", "").split(",") if o], allow_methods=["GET", "POST"], allow_headers=["Content-Type"])
log = logging.getLogger("opsrag")
ID = r"^[0-9a-f]{32}$"
WINDOWS = {"1h": 3600, "24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400}


class Question(BaseModel):
    question: str = Field(min_length=1, max_length=2000)


class Feedback(BaseModel):
    trace_id: str = Field(pattern=ID)
    good: bool
    comment: str | None = Field(default=None, max_length=1000)


class Resolve(BaseModel):
    trace_id: str = Field(pattern=ID)


def online_eval_on():
    return os.getenv("ONLINE_EVAL", "on") == "on" and random.random() < float(os.getenv("ONLINE_EVAL_RATE", "1"))


@app.post("/ask")
def ask_route(body: Question):
    def events():
        sources, answer = [], ""
        trace_id = get_client().create_trace_id()  # minted here so the id is known before the stream starts
        try:
            for kind, data in ask(body.question, langfuse_trace_id=trace_id):
                if kind == "sources":
                    sources = data
                elif kind == "token":
                    answer += data
                elif kind == "done":
                    if data["route"] == "retrieve" and not data["cached"] and online_eval_on():
                        monitor.judge_async(trace_id, body.question, sources, answer, judge_llm)  # before the last yield: survives a client disconnect
                    data = {**data, "trace_id": trace_id}
                yield f"event: {kind}\ndata: {json.dumps(data)}\n\n"
        except Exception:
            log.exception("ask failed")
            yield f"event: error\ndata: {json.dumps('Something went wrong answering that question.')}\n\n"
    return StreamingResponse(events(), media_type="text/event-stream")


def trace_url(trace_id):
    try:
        return get_client().get_trace_url(trace_id=trace_id)
    except Exception:
        return None


def since(window):
    if window not in WINDOWS:
        raise HTTPException(422, f"window must be one of {list(WINDOWS)}")
    return time.time() - WINDOWS[window]


def langfuse_down(e):
    log.exception("langfuse read failed")
    return HTTPException(502, "Couldn't read from Langfuse.")


@app.get("/metrics")
def metrics(window: str = "24h"):
    try:
        return {**monitor.stats(since(window)), "window": window}
    except httpx.HTTPError as e:
        raise langfuse_down(e)


@app.get("/queue")
def queue(window: str = "7d"):
    try:
        return [{**r, "trace_url": trace_url(r["id"])} for r in monitor.queue(since(window))]
    except httpx.HTTPError as e:
        raise langfuse_down(e)


@app.get("/trace/{trace_id}")
def trace(trace_id: str = Path(pattern=ID)):
    try:
        t = monitor.trace(trace_id)
    except httpx.HTTPError as e:
        raise langfuse_down(e)
    if t is None:
        raise HTTPException(404, "Trace not ingested yet.")
    return {**t, "url": trace_url(trace_id)}


@app.post("/feedback")
def feedback(body: Feedback):
    monitor.feedback(body.trace_id, body.good, body.comment)
    return {"ok": True}


@app.post("/resolve")
def resolve(body: Resolve):
    monitor.resolve(body.trace_id)
    return {"ok": True}
