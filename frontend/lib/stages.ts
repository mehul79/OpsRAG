import type { Stage, StageName } from "./types";

export const STAGES: { key: StageName; label: string; span: string }[] = [
  { key: "route", label: "Route", span: "route" },
  { key: "cache", label: "Cache", span: "semantic-cache" },
  { key: "transform", label: "Rewrite", span: "query-transform" },
  { key: "retrieve", label: "Retrieve", span: "hybrid-retrieval" },
  { key: "rerank", label: "Rerank", span: "rerank" },
  { key: "grade", label: "Grade", span: "crag-grade" },
  { key: "generate", label: "Generate", span: "generate" },
  { key: "cache_write", label: "Cache write", span: "cache-write" },
];

export const SPAN_TO_STAGE: Record<string, StageName> = Object.fromEntries(STAGES.map((s) => [s.span, s.key]));
export const stageLabel = (k: string) => STAGES.find((s) => s.key === k)?.label ?? k;

type Ev = { name: string; status: "start" | "done"; ms?: number; meta?: Record<string, unknown> };

/** Upsert by name; "start" means running. */
export function applyStage(stages: Stage[], ev: Ev): Stage[] {
  const next: Stage = { name: ev.name as StageName, status: ev.status === "start" ? "running" : "done", ms: ev.ms, meta: ev.meta };
  return stages.some((s) => s.name === next.name) ? stages.map((s) => (s.name === next.name ? next : s)) : [...stages, next];
}

/** Settle a finished turn so every stage has a final status. After `done`, stages that never started were skipped;
 *  after an error, a running stage failed and the rest were skipped. */
export function finalize(stages: Stage[], outcome: "done" | "error"): Stage[] {
  return STAGES.map(({ key }): Stage => {
    const s = stages.find((x) => x.name === key);
    if (!s) return { name: key, status: "skipped" };
    if (s.status === "running") return { ...s, status: outcome === "error" ? "failed" : "done" };
    return s;
  });
}

export const fmtMs = (v: number | null | undefined) => (v == null ? "–" : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`);

// Reranker logits run roughly -11..+11 (local); Cohere scores are already 0..1.
export const relevance = (s: number) => (s >= 0 && s <= 1 ? s : 1 / (1 + Math.exp(-s)));

// Self-check, runs once in dev: cache-hit and error sequences.
if (process.env.NODE_ENV !== "production") {
  const run = (evs: [string, "start" | "done"][]) => evs.reduce<Stage[]>((acc, [name, status]) => applyStage(acc, { name, status }), []);
  const str = (s: Stage[]) => s.map((x) => `${x.name}:${x.status}`).join(",");
  const hit = run([["route", "start"], ["route", "done"], ["cache", "start"], ["cache", "done"]]);
  console.assert(str(finalize(hit, "done")) === "route:done,cache:done,transform:skipped,retrieve:skipped,rerank:skipped,grade:skipped,generate:skipped,cache_write:skipped", "finalize: cache hit");
  const err = run([["route", "start"], ["route", "done"], ["cache", "start"], ["cache", "done"], ["retrieve", "start"]]);
  console.assert(str(finalize(err, "error")) === "route:done,cache:done,transform:skipped,retrieve:failed,rerank:skipped,grade:skipped,generate:skipped,cache_write:skipped", "finalize: error");
}
