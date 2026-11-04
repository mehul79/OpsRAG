import json, sys, time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
import monitor

T = lambda n: f"{n:032x}"  # trace ids
NOW = time.time()
ts = lambda off=0: monitor.iso(NOW + off)


class FakeLangfuse:
    """Stands in for Langfuse's v2 observations and v3 scores endpoints."""
    def __init__(self):
        self.asks, self.gens, self.scores, self.spans = [], [], [], []

    def ask(self, n, q="q", route="retrieve", cached=False, weak=False, ms=1000, top=3.0, off=-60):
        self.asks.append({"traceId": T(n), "startTime": ts(off), "input": q, "output": f"answer {n}", "latency": ms / 1000,
                          "metadata": {"route": route, "cached": cached, "weak": weak, "top_score": top}})

    def score(self, n, name, value, off=0, comment=None):
        self.scores.append({"name": name, "value": value, "dataType": "NUMERIC", "timestamp": ts(off), "comment": comment,
                            "subject": {"kind": "trace", "id": T(n)}})

    def __call__(self, path, **params):
        if path.endswith("/observations"):
            data = self.asks if params.get("name") == "ask" else self.gens
            if "traceId" in params:
                data = [o for o in self.asks + self.gens + self.spans if o["traceId"] == params["traceId"]]
        else:
            data = self.scores
            if "traceId" in params:
                data = [x for x in data if x["subject"]["id"] == params["traceId"]]
        return {"data": data, "meta": {}}


@pytest.fixture
def lf(monkeypatch):
    fake = FakeLangfuse()
    monkeypatch.setattr(monitor, "lf", fake)
    monitor._cache.clear()
    return fake


SINCE = NOW - 3600


def test_queue_rules_and_reasons(lf):
    for n, q, w in [(1, "ok", False), (2, "weak", True), (3, "faith", False), (4, "rel", False), (5, "down", False), (6, "unjudged", False)]:
        lf.ask(n, q, weak=w)
    lf.score(1, "faithfulness", 0.9); lf.score(1, "answer_relevancy", 1.0)
    lf.score(3, "faithfulness", 0.4); lf.score(3, "answer_relevancy", 1.0)
    lf.score(4, "faithfulness", 1.0); lf.score(4, "answer_relevancy", 0.0)
    lf.score(5, "user_feedback", 0, comment="wrong flag")
    queued = {r["question"]: r["reasons"] for r in monitor.queue(SINCE)}
    assert set(queued) == {"weak", "faith", "rel", "down"}  # good and not-yet-judged answers are not queued
    assert queued["weak"] == ["weak retrieval"] and queued["down"] == ["thumbs down"]
    assert queued["faith"] == ["low faithfulness (0.40)"]
    assert next(r for r in monitor.fetch(SINCE) if r["question"] == "down")["comment"] == "wrong flag"


def test_resolve_and_reopen(lf):
    lf.ask(1, weak=True)
    lf.score(1, "resolved", 1, off=-10)
    assert monitor.queue(SINCE) == []
    lf.score(1, "user_feedback", 0, off=-5)  # a thumbs-down newer than the resolve reopens it
    monitor._cache.clear()
    assert len(monitor.queue(SINCE)) == 1


def test_latest_score_per_name_wins(lf):
    lf.ask(1)
    lf.score(1, "faithfulness", 0.2, off=-30)
    lf.score(1, "faithfulness", 0.9, off=-10)
    assert monitor.fetch(SINCE)[0]["faithfulness"] == 0.9


def test_stats_aggregation(lf):
    for i, ms in enumerate((100, 200, 300, 400), 1):
        lf.ask(i, ms=ms)
    lf.ask(5, cached=True, ms=5)
    lf.ask(6, weak=True, ms=500)
    lf.ask(7, route="chitchat", ms=2)
    lf.gens += [{"traceId": T(1), "totalUsage": 1000, "totalCost": 0.001}, {"traceId": T(1), "totalUsage": 500, "totalCost": None},
                {"traceId": T(2), "totalUsage": 500, "totalCost": 0.002}]
    lf.score(5, "user_feedback", 1)
    s = monitor.stats(SINCE)
    assert s["total"] == 7 and s["routes"] == {"retrieve": 6, "chitchat": 1}
    assert s["cache_hit_rate"] == round(1 / 6, 3) and s["weak_rate"] == round(1 / 6, 3)
    assert s["latency_ms"]["p50"] == 300 and s["latency_ms"]["p95"] == 500  # fresh retrievals only
    assert s["latency_ms"]["cached_p50"] == 5
    assert s["tokens"] == {"total": 2000, "per_answer": 1000} and s["cost_usd"] == 0.003
    assert s["thumbs"] == {"up": 1, "down": 0}


def test_stats_without_cost_or_data(lf):
    assert monitor.stats(SINCE)["total"] == 0
    lf.ask(1)
    monitor._cache.clear()
    assert monitor.stats(SINCE)["cost_usd"] is None  # unpriced model: show nothing, not $0


def test_legacy_span_format_is_unwrapped():
    raw_in = '{"args": ["why?"], "kwargs": {}}'
    raw_out = json.dumps([["sources", []], ["token", "Hello "], ["token", "there"], ["done", {}]])
    assert monitor.plain(raw_in, raw_out) == ("why?", "Hello there")
    assert monitor.plain("plain q", "plain a") == ("plain q", "plain a")
    assert monitor.plain('{"args": ', "[[") == ('{"args": ', "[[")  # malformed: left alone, never raises


def test_paged_follows_cursor(monkeypatch):
    pages = {None: {"data": [1] * monitor.PAGE, "meta": {"cursor": "c1"}}, "c1": {"data": [2], "meta": {}}}
    monkeypatch.setattr(monitor, "lf", lambda path, **p: pages[p.get("cursor")])
    assert monitor.paged("/x") == [1] * monitor.PAGE + [2]


def test_feedback_and_resolve_write_scores(monkeypatch):
    calls = []
    monkeypatch.setattr(monitor, "score", lambda *a, **k: calls.append((a, k)))
    monitor.feedback(T(1), False, "bad")
    monitor.feedback(T(2), True)
    monitor.resolve(T(3))
    assert calls[0][0] == (T(1), "user_feedback", 0, "bad") and calls[1][0] == (T(2), "user_feedback", 1, None)
    assert calls[2][0] == (T(3), "resolved", 1)


class FakeLLM:
    def __init__(self, replies):
        self.replies = iter(replies)

    def invoke(self, _messages):
        return type("R", (), {"content": next(self.replies)})


def test_judge_scores_and_tolerates_wrapped_json():
    llm = FakeLLM(['{"relevant": [1, 0]}',
                   'Sure:\n{"claims": [{"claim": "a", "supported": true}, {"claim": "b", "supported": false}]}',
                   '{"score": 0.5}'])
    r = monitor.judge(llm, "q", [{"text": "x"}, {"text": "y"}], "answer")
    assert r == {"context_relevancy": 0.5, "faithfulness": 0.5, "answer_relevancy": 0.5}


def test_judge_async_failure_is_swallowed_and_success_is_scored(monkeypatch):
    written = []
    monkeypatch.setattr(monitor, "score", lambda t, n, v, c=None: written.append((t, n, v)))
    def boom():
        raise RuntimeError("judge down")
    monitor.judge_async(T(1), "q", [], "a", boom)
    llm = FakeLLM(['{"relevant": [1]}', '{"claims": [{"claim": "a", "supported": true}]}', '{"score": 1}'])
    monitor.judge_async(T(2), "q", [{"text": "x"}], "a", lambda: llm)
    for _ in range(50):
        if len(written) == 3:
            break
        time.sleep(0.1)
    assert sorted(written) == [(T(2), "answer_relevancy", 1.0), (T(2), "context_relevancy", 1.0), (T(2), "faithfulness", 1.0)]


def test_api_endpoints(monkeypatch, lf):
    from fastapi.testclient import TestClient
    import app as appmod
    monkeypatch.setattr(appmod, "online_eval_on", lambda: False)
    monkeypatch.setattr(appmod, "trace_url", lambda t: f"https://lf/{t}")
    sent = []
    monkeypatch.setattr(monitor, "score", lambda *a, **k: sent.append(a))

    def fake_ask(q, **kw):
        yield "sources", [{"text": "x", "score": 4.2}]
        yield "token", "hello "
        yield "token", "world"
        yield "done", {"cached": False, "weak": True, "route": "retrieve", "top_score": 4.2}
    monkeypatch.setattr(appmod, "ask", fake_ask)
    c = TestClient(appmod.app)
    body = c.post("/ask", json={"question": "why?"}).text
    done = json.loads(body.split("event: done\ndata: ")[1].split("\n")[0])
    assert done["weak"] and len(done["trace_id"]) == 32 and "id" not in done
    lf.ask(9, "weak one", weak=True)
    q = c.get("/queue").json()
    assert q[0]["id"] == T(9) and q[0]["reasons"] == ["weak retrieval"] and q[0]["trace_url"] == f"https://lf/{T(9)}"
    assert c.post("/feedback", json={"trace_id": "nothex", "good": False}).status_code == 422  # id is validated
    assert c.post("/feedback", json={"trace_id": T(9), "good": False, "comment": "x"}).json() == {"ok": True}
    assert c.post("/resolve", json={"trace_id": T(9)}).json() == {"ok": True}
    assert sent == [(T(9), "user_feedback", 0, "x"), (T(9), "resolved", 1)]
    assert c.get("/metrics?window=nope").status_code == 422
    assert c.get("/metrics?window=1h").json()["total"] == 1


def test_langfuse_outage_is_a_502_not_a_crash(monkeypatch):
    import httpx
    from fastapi.testclient import TestClient
    import app as appmod
    def down(*a, **k):
        raise httpx.ConnectError("no network")
    monkeypatch.setattr(monitor, "lf", down)
    monitor._cache.clear()
    c = TestClient(appmod.app)
    assert c.get("/metrics").status_code == 502 and c.get("/queue").status_code == 502


def test_trace(lf):
    base = NOW - 30
    at = lambda off: monitor.iso(base + off)
    lf.asks.append({"id": "root", "traceId": T(1), "name": "ask", "type": "SPAN", "startTime": at(0), "endTime": at(8)})
    lf.spans += [
        {"id": "a", "traceId": T(1), "parentObservationId": "root", "name": "rerank", "type": "SPAN", "startTime": at(1), "endTime": at(2)},
        {"id": "g", "traceId": T(1), "parentObservationId": "root", "name": "ChatOpenAI", "type": "GENERATION", "model": "m",
         "startTime": at(3), "endTime": at(4), "usageDetails": {"input": 100, "output": 20, "total": 120}, "calculatedTotalCost": 0.01},
        {"id": "g2", "traceId": T(1), "parentObservationId": "root", "name": "ChatOpenAI", "type": "GENERATION",
         "startTime": at(5), "endTime": at(6), "usageDetails": {"input": 5, "output": 5}},
    ]
    lf.score(1, "faithfulness", 0.2, off=-20); lf.score(1, "faithfulness", 0.9, off=-10)
    lf.score(1, "resolved", 1); lf.score(2, "faithfulness", 0.1)
    t = monitor.trace(T(1))
    assert t["latency_ms"] == 8000 and t["tokens"] == 130 and t["cost"] == 0.01
    assert t["scores"] == {"faithfulness": 0.9}  # latest wins, resolved hidden, other traces ignored
    by = {s["id"]: s for s in t["spans"]}
    assert by["a"]["start_ms"] == 1000 and by["a"]["duration_ms"] == 1000 and by["a"]["parent_id"] == "root"
    assert by["g"]["model"] == "m" and by["g"]["tokens"] == 120 and by["g2"]["tokens"] == 10
    assert monitor.trace(T(3)) is None


def test_trace_endpoint(monkeypatch, lf):
    from fastapi.testclient import TestClient
    import app as appmod
    monkeypatch.setattr(appmod, "trace_url", lambda t: "https://lf/x")
    c = TestClient(appmod.app)
    assert c.get(f"/trace/{T(5)}").status_code == 404
    assert c.get("/trace/nothex").status_code == 422
    lf.asks.append({"id": "r", "traceId": T(5), "name": "ask", "type": "SPAN", "startTime": ts(), "endTime": ts(1)})
    assert c.get(f"/trace/{T(5)}").json()["url"] == "https://lf/x"
