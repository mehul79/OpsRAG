"""Router eval: loads the trained weights (no retraining), picks a threshold on val, reports test metrics.

Usage: python evals/router_eval.py [--check]
Key number: retrieve_recall = 1 - false-skip rate (real doc questions that still reach retrieval). Skipping one wrongly has no recovery,
so the threshold is the lowest one with zero false skips on val. skip_coverage is what the router buys.
Hard rule: all 35 answerable retrieval-eval questions must still retrieve. `--check` is the CI gate vs evals/router_baseline.json.
"""
import json, os, sys, time
from collections import Counter
from pathlib import Path

os.environ.setdefault("LANGFUSE_TRACING_ENABLED", "false")
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "backend"))
import numpy as np
import router

LABELS = ["retrieve", "chitchat", "about_bot", "out_of_scope"]
SWEEP = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99]
GATED = ("retrieve_recall", "macro_f1", "skip_coverage")
TOLERANCE = 0.03
MIN_RETRIEVE_RECALL = 0.98  # hard floor on test, independent of the baseline


def metrics(gold, pred):
    cm = [[sum(g == a and p == b for g, p in zip(gold, pred)) for b in LABELS] for a in LABELS]
    per, f1s = {}, []
    for i, lab in enumerate(LABELS):
        tp = cm[i][i]; fp = sum(cm[j][i] for j in range(4)) - tp; fn = sum(cm[i]) - tp
        pr = tp / (tp + fp) if tp + fp else 0.0; rc = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * pr * rc / (pr + rc) if pr + rc else 0.0
        per[lab] = {"precision": round(pr, 3), "recall": round(rc, 3), "f1": round(f1, 3), "n": sum(cm[i])}; f1s.append(f1)
    ret = [(g, p) for g, p in zip(gold, pred) if g == "retrieve"]
    non = [(g, p) for g, p in zip(gold, pred) if g != "retrieve"]
    return {"confusion": cm, "per_class": per, "macro_f1": round(float(np.mean(f1s)), 3),
            "retrieve_recall": round(sum(p == "retrieve" for _, p in ret) / len(ret), 3),
            "skip_coverage": round(sum(g == p for g, p in non) / len(non), 3),
            "accuracy": round(sum(g == p for g, p in zip(gold, pred)) / len(gold), 3)}


def decisions(probs, t):
    return [router.decide(p, t)[0] for p in probs]


def main(check):
    rows = [json.loads(l) for l in open(HERE / "router_dataset.jsonl", encoding="utf-8")]
    w = router._weights()
    split = {s: [r for r in rows if r["split"] == s] for s in ("train", "val", "test")}
    P = {s: router.predict_proba(w, [r["text"] for r in rs]) for s, rs in split.items()}
    gold = {s: [r["label"] for r in rs] for s, rs in split.items()}

    print("val sweep (threshold | false-skip | skip coverage):")
    sweep, lowest = [], None
    for t in SWEEP:
        m = metrics(gold["val"], decisions(P["val"], t))
        sweep.append({"t": t, "false_skip": round(1 - m["retrieve_recall"], 3), "skip_coverage": m["skip_coverage"]})
        print(f"  {t:4}  {sweep[-1]['false_skip']:6}  {m['skip_coverage']:6}")
        if lowest is None and m["retrieve_recall"] == 1.0: lowest = t
    if lowest is None:
        chosen = SWEEP[-1]; print("  no threshold reached 0 false skips on val; using", chosen)
    else:  # one step above the lowest zero-false-skip threshold: a wrong skip has no recovery, so keep a margin
        chosen = SWEEP[min(SWEEP.index(lowest) + 1, len(SWEEP) - 1)]
    print(f"lowest zero-false-skip threshold on val: {lowest}; chosen with one step of margin: {chosen}")

    pred_test = decisions(P["test"], chosen)
    m = metrics(gold["test"], pred_test)
    train_m = metrics(gold["train"], decisions(P["train"], chosen))
    skipped = [(r, p) for r, p, g in zip(split["test"], pred_test, gold["test"]) if g == "retrieve" and p != "retrieve"]
    m["false_skip_by_kind"] = dict(Counter(r["kind"].split("+")[0] for r, _ in skipped))
    m["train_macro_f1"] = train_m["macro_f1"]

    # hard check: every answerable retrieval-eval question must retrieve
    ev = [json.loads(l) for l in open(HERE / "dataset.jsonl", encoding="utf-8")]
    EP = router.predict_proba(w, [e["question"] for e in ev])
    ev_pred = decisions(EP, chosen)
    answerable_skips = [(e["question"], p) for e, p in zip(ev, ev_pred) if e["expect"] and p != "retrieve"]
    unanswerable = [(e["question"], p) for e, p in zip(ev, ev_pred) if not e["expect"]]

    lat = []
    for q in [r["text"] for r in split["test"][:60]]:
        t0 = time.perf_counter(); router.decide(router.predict_proba(w, [q])[0], chosen); lat.append((time.perf_counter() - t0) * 1000)

    out = {"threshold": chosen, "n_test": len(gold["test"]), **m, "answerable_skips": len(answerable_skips),
           "latency_ms_p50": round(float(np.percentile(lat, 50)), 1), "latency_ms_p95": round(float(np.percentile(lat, 95)), 1)}
    print(f"\ntest (n={out['n_test']}): retrieve_recall {m['retrieve_recall']}  skip_coverage {m['skip_coverage']}  macro_f1 {m['macro_f1']}  "
          f"accuracy {m['accuracy']}  (train macro_f1 {m['train_macro_f1']})")
    print("confusion (rows=gold, cols=pred)", LABELS)
    for lab, row in zip(LABELS, m["confusion"]): print(f"  {lab:13}", row)
    for lab, v in m["per_class"].items(): print(f"  {lab:13} P {v['precision']}  R {v['recall']}  F1 {v['f1']}  n={v['n']}")
    print("false skips by kind:", m["false_skip_by_kind"] or "none")
    for r, p in skipped: print(f"  FALSE SKIP -> {p}: {r['text']!r}")
    print(f"retrieval-eval questions: {len(answerable_skips)} of 35 answerable wrongly skipped", answerable_skips or "",
          "| unanswerable routed:", [(q[:30], p) for q, p in unanswerable])
    print(f"latency per prompt: p50 {out['latency_ms_p50']} ms, p95 {out['latency_ms_p95']} ms")
    misrouted = [{"text": r["text"], "gold": g, "pred": p} for r, g, p in zip(split["test"], gold["test"], pred_test) if g != p]
    (HERE / "results").mkdir(exist_ok=True)
    (HERE / "results" / "router_latest.json").write_text(json.dumps({"metrics": out, "sweep": sweep, "misrouted_test": misrouted}, indent=1), encoding="utf-8")

    if check:
        base = json.load(open(HERE / "router_baseline.json", encoding="utf-8"))["metrics"]
        fails = [f"{k} {out[k]} < {base[k]}" for k in GATED if out[k] < base[k] - TOLERANCE]
        if out["answerable_skips"]: fails.append(f"{out['answerable_skips']} answerable retrieval-eval questions skipped")
        if out["retrieve_recall"] < MIN_RETRIEVE_RECALL: fails.append(f"retrieve_recall {out['retrieve_recall']} < {MIN_RETRIEVE_RECALL}")
        print("GATE:", "FAIL " + "; ".join(fails) if fails else "pass")
        sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main("--check" in sys.argv)
