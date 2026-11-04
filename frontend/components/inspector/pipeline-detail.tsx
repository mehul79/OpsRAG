"use client";

import { CheckIcon, XIcon } from "lucide-react";
import { STAGES, fmtMs } from "@/lib/stages";
import type { Stage, Turn } from "@/lib/types";
import { cn } from "@/lib/utils";

const ROUTE_LABEL: Record<string, string> = { retrieve: "retrieve", chitchat: "small talk", about_bot: "about this assistant", out_of_scope: "outside the docs" };

/** One short line per stage, built only from the persisted stage events so it works after a reload. */
function meta(s: Stage): string[] {
  const m = s.meta ?? {};
  const out: string[] = [];
  switch (s.name) {
    case "route":
      out.push(`${ROUTE_LABEL[String(m.label)] ?? m.label}${typeof m.confidence === "number" ? `, ${Math.round(m.confidence * 100)}% confident` : ""}`);
      break;
    case "cache":
      out.push(m.hit ? "Cache hit" : "Cache miss");
      break;
    case "transform":
      if (Array.isArray(m.queries)) out.push(...(m.queries as string[]).map((q) => `“${q}”`));
      break;
    case "retrieve":
      out.push(`${m.candidates} candidates from ${m.queries} ${m.queries === 1 ? "query" : "queries"}`);
      break;
    case "rerank":
      out.push(`Kept ${m.kept}${typeof m.top_score === "number" ? `, top score ${m.top_score.toFixed(2)}` : ""}`);
      break;
    case "grade":
      out.push(m.weak ? `Weak: no chunk cleared the threshold, kept ${m.kept}` : `Confident, kept ${m.kept}`);
      break;
    case "generate":
      if (typeof m.ttft_ms === "number") out.push(`First token after ${fmtMs(m.ttft_ms)}`);
      break;
  }
  return out;
}

export function PipelineDetail({ turn }: { turn: Turn }) {
  const stages = STAGES.map(({ key, label }) => ({ key, label, s: turn.stages.find((x) => x.name === key) }));
  const sum = turn.stages.reduce((n, s) => n + (s.ms ?? 0), 0);
  const total = Math.max(1, sum);
  return (
    <div className="flex flex-col p-3">
      <ol className="flex flex-col gap-3">
        {stages.map(({ key, label, s }) => {
          const status = s?.status ?? "pending";
          const lines = s ? meta(s) : [];
          return (
            <li key={key} className={cn("flex flex-col gap-1", status === "skipped" && "opacity-40")}>
              <div className="flex items-center gap-2 text-[13px]">
                <span className="flex size-4 items-center justify-center">
                  {status === "done" && <CheckIcon className="size-3" aria-hidden />}
                  {status === "failed" && <XIcon className="size-3 text-destructive" aria-hidden />}
                  {status === "running" && <span className="size-1.5 rounded-full bg-signal" aria-hidden />}
                  {(status === "pending" || status === "skipped") && <span className="size-1.5 rounded-full border border-muted-foreground" aria-hidden />}
                </span>
                <span className={cn(status === "skipped" && "line-through", status === "failed" && "text-destructive")}>{label}</span>
                <span className="ml-auto font-mono text-[12px] text-muted-foreground tabular-nums">{status === "skipped" ? "skipped" : fmtMs(s?.ms)}</span>
              </div>
              {s?.ms != null && (
                <div className="ml-6 h-0.5 rounded-full bg-foreground/50" style={{ width: `${Math.max(1, Math.round((s.ms / total) * 100))}%` }} aria-hidden />
              )}
              {lines.map((l, i) => (
                <p key={i} className={cn("ml-6 text-[12px] text-muted-foreground", s?.name === "grade" && s.meta?.weak === true && "text-warn-foreground")}>{l}</p>
              ))}
            </li>
          );
        })}
      </ol>
      <p className="mt-4 border-t pt-3 text-[12px] text-muted-foreground">
        Stages total <span className="font-mono tabular-nums">{fmtMs(sum)}</span>. Bars show each stage's share of that total.
      </p>
    </div>
  );
}
