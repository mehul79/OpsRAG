"""Eval: retrieval quality (deterministic) and, with --judge, answer quality (LLM-graded by JUDGE_MODEL).

Usage: python evals/run.py [--no-transform] [--judge] [--check]
  --no-transform  skip the LLM query rewrite
  --judge         also generate answers and grade context relevancy, answer relevancy, faithfulness (LLM calls, ~10 min)
  --check         CI gate: exit 1 if a deterministic metric drops below evals/baseline.json
Deterministic metrics (labels = expected-path regex per question):
  recall@20 / recall@5   right doc in the candidates / in the final top 5
  precision@5            share of the top 5 that come from an expected doc (reads low: one pattern per question)
  ndcg@5                 binary NDCG of the reranked top 5; ideal = all relevant candidates ranked first
  mrr@5                  1 / rank of the first right doc
  weak_flag_acc          weak-retrieval flag right on answerable and unanswerable questions
Writes evals/results/latest.json. Refresh the baseline only on purpose: see CLAUDE.md.
"""
import json, math, os, re, sys, time
from pathlib import Path

os.environ.setdefault("LANGFUSE_TRACING_ENABLED", "false")  # don't flood Langfuse with eval runs
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

HERE = Path(__file__).resolve().parent
from monitor import judge  # the LLM judge is shared with the online evals (backend/monitor.py)
TOLERANCE = 0.03  # allowed drop vs baseline before the gate fails
GATED = ("recall@20", "recall@5", "precision@5", "ndcg@5", "weak_flag_acc")


def hit_rank(hits, rx):
    for i, h in enumerate(hits, 1):
        if re.search(rx, h["path"]):
            return i
    return None


def ndcg(top, cands, rx):
    """Binary NDCG@5 of the reranked list; ideal puts every relevant candidate (up to 5) first."""
    rel = [bool(re.search(rx, h["path"])) for h in top]
    ideal = min(sum(bool(re.search(rx, h["path"])) for h in cands), len(top))
    dcg = sum(r / math.log2(i + 2) for i, r in enumerate(rel))
    idcg = sum(1 / math.log2(i + 2) for i in range(ideal))
    return dcg / idcg if idcg else 0.0


def gate(m, base):
    """Gated metrics that dropped more than TOLERANCE below the baseline (metrics missing from the baseline are skipped)."""
    return [f"{k} {m[k]} < {base[k]}" for k in GATED if k in base and m[k] < base[k] - TOLERANCE]


def mean(xs):
    xs = [x for x in xs if x is not None]
    return round(sum(xs) / len(xs), 3) if xs else None


def main(transform, check, judge):
    import pipeline as p  # heavy import (models, LLM client), so only when actually running
    rows = [json.loads(l) for l in open(HERE / "dataset.jsonl", encoding="utf-8")]
    out, t0, judge_errors = [], time.time(), 0
    for r in rows:
        q = r["question"]
        queries = p.transform(q) if transform else [q]
        cands = p.retrieve(queries)
        top = p.rerank(q, cands)
        used, weak = p.grade(top)
        rx = r["expect"]
        row = {**r, "rank20": hit_rank(cands, rx) if rx else None, "rank5": hit_rank(top, rx) if rx else None, "weak": weak,
               "precision@5": sum(bool(re.search(rx, h["path"])) for h in top) / len(top) if rx else None,
               "ndcg@5": ndcg(top, cands, rx) if rx else None,
               "top1": top[0]["score"], "top_paths": [h["path"] for h in top]}
        if judge and rx:
            row["answer"] = "".join(p.generate(q, used, weak))
            try:
                row.update(judge(p.judge_llm(), q, used, row["answer"]))
            except Exception as e:  # a malformed judge reply shouldn't sink the run
                judge_errors += 1; print("  judge error:", type(e).__name__, e)
        out.append(row)
        extra = f" ctx={row.get('context_relevancy')} faith={row.get('faithfulness')} ans={row.get('answer_relevancy')}" if judge and rx else ""
        print(f"{'ok ' if (row['rank5'] if rx else weak) else 'MISS'} {r['kind']:8} r5={row['rank5']} top1={top[0]['score']:6.2f} weak={weak}{extra} | {q[:55]}", flush=True)
    ans = [o for o in out if o["expect"]]
    none = [o for o in out if not o["expect"]]
    m = {
        "n": len(ans), "transform": transform,
        "recall@20": round(sum(o["rank20"] is not None for o in ans) / len(ans), 3),
        "recall@5": round(sum(o["rank5"] is not None for o in ans) / len(ans), 3),
        "precision@5": mean(o["precision@5"] for o in ans),
        "ndcg@5": mean(o["ndcg@5"] for o in ans),
        "mrr@5": round(sum(1 / o["rank5"] for o in ans if o["rank5"]) / len(ans), 3),
        "weak_flag_acc": round((sum(o["weak"] for o in none) + sum(not o["weak"] for o in ans)) / len(out), 3),
        "min_top1_answerable": round(min(o["top1"] for o in ans), 2),
        "max_top1_unanswerable": round(max(o["top1"] for o in none), 2) if none else None,
    }
    if judge:
        m.update({k: mean(o.get(k) for o in ans) for k in ("context_relevancy", "answer_relevancy", "faithfulness")})
        m.update({"judge_model": os.environ["JUDGE_MODEL"], "judge_errors": judge_errors})
    m["seconds"] = round(time.time() - t0)
    by_kind = {k: round(sum(o["rank5"] is not None for o in ans if o["kind"] == k) / sum(o["kind"] == k for o in ans), 2)
               for k in sorted({o["kind"] for o in ans})}
    print("\n", json.dumps(m, indent=1), "\n recall@5 by kind:", by_kind)
    (HERE / "results").mkdir(exist_ok=True)
    (HERE / "results" / "latest.json").write_text(json.dumps({"metrics": m, "by_kind": by_kind, "rows": out}, indent=1), encoding="utf-8")
    if check:
        base = json.load(open(HERE / "baseline.json", encoding="utf-8"))["metrics"]
        fails = gate(m, base)
        print("GATE:", "FAIL " + ", ".join(fails) if fails else "pass")
        sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main("--no-transform" not in sys.argv, "--check" in sys.argv, "--judge" in sys.argv)
