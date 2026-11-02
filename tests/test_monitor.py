import json, sys, time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
import monitor


@pytest.fixture(autouse=True)
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(monitor, "DB", tmp_path / "t.db")
    monkeypatch.setattr(monitor, "_langfuse_score", lambda *a, **k: None)


def add(question="q", route="retrieve", cached=False, weak=False, ms=1000, trace="t" * 32):
    return monitor.log_query(question, "a", route, cached, weak, ms, 3.0, trace)


def test_queue_rules_and_reasons():
    ok, weak, bad_faith, bad_rel, down = add("ok"), add("weak", weak=True), add("faith"), add("rel"), add("down")
    monitor.set_scores(ok, faithfulness=0.9, answer_relevancy=1.0)
    monitor.set_scores(bad_faith, faithfulness=0.4, answer_relevancy=1.0)
    monitor.set_scores(bad_rel, faithfulness=1.0, answer_relevancy=0.0)
    monitor.feedback(down, good=False, comment="wrong flag")
    queued = {r["question"]: r["reasons"] for r in monitor.queue()}
    assert set(queued) == {"weak", "faith", "rel", "down"}  # the good answer is not queued
    assert queued["weak"] == ["weak retrieval"] and "thumbs down" in queued["down"]
    assert "low faithfulness (0.40)" in queued["faith"]


def test_unjudged_answer_is_not_queued_and_resolve_removes():
    add("plain")
    assert monitor.queue() == []  # NULL scores must not count as failures
    w = add("weak", weak=True)
    monitor.resolve(w)
    assert monitor.queue() == []
    monitor.feedback(w, good=False)  # a new thumbs-down reopens it
    assert len(monitor.queue()) == 1


def test_feedback_unknown_id_and_thumbs_up():
    assert monitor.feedback("0" * 32, True) is False
    i = add("fine")
    assert monitor.feedback(i, True) is True
    assert monitor.queue() == [] and monitor.stats()["thumbs"] == {"up": 1, "down": 0}


def test_stats_aggregation():
    for ms in (100, 200, 300, 400):
        add(ms=ms)
    add(cached=True, ms=5)
    add(weak=True, ms=500)
    add(route="chitchat", ms=2)
    s = monitor.stats()
    assert s["total"] == 7 and s["routes"] == {"retrieve": 6, "chitchat": 1}
    assert s["cache_hit_rate"] == round(1 / 6, 3) and s["weak_rate"] == round(1 / 6, 3)
    assert s["latency_ms"]["p50"] == 300 and s["latency_ms"]["p95"] == 500  # fresh retrievals only; cached and routed excluded
    assert s["latency_ms"]["cached_p50"] == 5
    assert monitor.stats(since=time.time() + 10)["total"] == 0


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


def test_judge_async_failure_is_swallowed_and_success_is_stored():
    i = add()
    def boom():
        raise RuntimeError("judge down")
    monitor.judge_async(i, "q", [], "a", boom)
    llm = FakeLLM(['{"relevant": [1]}', '{"claims": [{"claim": "a", "supported": true}]}', '{"score": 1}'])
    monitor.judge_async(i, "q", [{"text": "x"}], "a", lambda: llm)
    for _ in range(50):
        if monitor.stats()["judged"]:
            break
        time.sleep(0.1)
    assert monitor.stats()["scores"]["faithfulness"] == 1.0


def test_api_endpoints(monkeypatch):
    from fastapi.testclient import TestClient
    import app as appmod
    monkeypatch.setattr(appmod, "online_eval_on", lambda: False)
    monkeypatch.setattr(appmod, "trace_url", lambda t: f"https://lf/{t}")

    def fake_ask(q, **kw):
        yield "sources", [{"text": "x", "score": 4.2}]
        yield "token", "hello "
        yield "token", "world"
        yield "done", {"cached": False, "weak": True, "route": "retrieve", "top_score": 4.2}
    monkeypatch.setattr(appmod, "ask", fake_ask)
    c = TestClient(appmod.app)
    body = c.post("/ask", json={"question": "why?"}).text
    done = json.loads(body.split("event: done\ndata: ")[1].split("\n")[0])
    assert done["weak"] and len(done["id"]) == 32 and len(done["trace_id"]) == 32
    q = c.get("/queue").json()
    assert q[0]["answer"] == "hello world" and q[0]["reasons"] == ["weak retrieval"] and q[0]["trace_url"].startswith("https://lf/")
    assert c.post("/feedback", json={"id": "nothex", "good": False}).status_code == 422  # id is validated
    assert c.post("/feedback", json={"id": "0" * 32, "good": False}).status_code == 404
    assert c.post("/feedback", json={"id": done["id"], "good": True}).json() == {"ok": True}
    assert c.get("/metrics?window=nope").status_code == 422
    assert c.get("/metrics?window=1h").json()["total"] == 1
    assert c.post("/resolve", json={"id": done["id"]}).json() == {"ok": True}
    assert c.get("/queue").json() == []
