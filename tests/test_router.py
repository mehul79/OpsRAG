import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
import router


def test_decide_skips_only_when_confident():
    probs = {"retrieve": 0.3, "chitchat": 0.7}
    assert router.decide(probs, 0.9) == ("retrieve", 0.3)  # not confident enough: retrieve
    assert router.decide(probs, 0.6) == ("chitchat", 0.7)
    assert router.decide({"retrieve": 0.9, "chitchat": 0.1}, 0.5)[0] == "retrieve"  # retrieve argmax always retrieves


def test_route_fails_open(monkeypatch):
    monkeypatch.setattr(router, "ROUTER", "off")
    assert router.route("hello") == ("retrieve", 0.0)
    monkeypatch.setattr(router, "ROUTER", "on")
    monkeypatch.setattr(router, "_weights", lambda: (_ for _ in ()).throw(FileNotFoundError("no weights")))
    assert router.route("hello") == ("retrieve", 0.0)  # a broken router must never block retrieval


def test_reply_never_leaks_env(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "sk-secret-123")
    monkeypatch.setenv("LLM_MODEL", "some/model")
    for label in ("chitchat", "about_bot", "out_of_scope"):
        assert "sk-secret" not in router.reply(label)
    assert "some/model" in router.reply("about_bot")


def norm(t):
    return re.sub(r"\W+", " ", t.lower()).strip()


def test_dataset_has_no_leakage_between_splits():
    rows = [json.loads(l) for l in open(ROOT / "evals" / "router_dataset.jsonl", encoding="utf-8")]
    owner = {}
    for r in rows:  # one normalised text never appears in two different groups (so never in two splits or with two labels)
        assert owner.setdefault(norm(r["text"]), r["group"]) == r["group"], r["text"]
    for lab in {r["label"] for r in rows}:
        assert all(any(r["label"] == lab and r["split"] == s for r in rows) for s in ("train", "val", "test"))
    ev = {norm(json.loads(l)["question"]) for l in open(ROOT / "evals" / "dataset.jsonl", encoding="utf-8")}
    assert not [r["text"] for r in rows if norm(r["text"]) in ev]  # the retrieval-eval questions are a separate hard check
