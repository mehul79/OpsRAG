import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "evals"))
from run import gate, ndcg

BASE = {"recall@20": 0.97, "recall@5": 0.91, "precision@5": 0.4, "ndcg@5": 0.8, "weak_flag_acc": 1.0}


def test_gate_passes_within_tolerance():
    assert gate({**BASE, "recall@5": 0.89}, BASE) == []


def test_gate_fails_on_regression():
    fails = gate({**BASE, "recall@5": 0.80, "weak_flag_acc": 0.9}, BASE)
    assert len(fails) == 2 and fails[0].startswith("recall@5")


def test_gate_skips_metrics_missing_from_baseline():
    assert gate({**BASE, "ndcg@5": 0.1}, {"recall@5": 0.91}) == []


def H(*paths):
    return [{"path": p} for p in paths]


def test_ndcg_perfect_and_ranked_lower():
    cands = H("a/x", "b/y", "a/z")  # two relevant candidates for rx "a/"
    assert ndcg(H("a/x", "a/z", "b/y"), cands, "a/") == 1.0
    assert 0 < ndcg(H("b/y", "a/x", "a/z"), cands, "a/") < 1.0
    assert ndcg(H("b/y"), H("b/y"), "a/") == 0.0
