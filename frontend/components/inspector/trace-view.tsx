"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLinkIcon, RotateCwIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getTrace } from "@/lib/api";
import { SPAN_TO_STAGE, fmtMs, stageLabel } from "@/lib/stages";
import type { Span, Trace } from "@/lib/types";

const RETRY_S = [2, 4, 8, 8, 8]; // Langfuse ingests asynchronously: poll a few times, then hand over to a button
const SCORE_MIN: Record<string, number> = { faithfulness: 0.7, answer_relevancy: 0.5 }; // same cut-offs as monitor.py
const JUDGE = ["faithfulness", "answer_relevancy", "context_relevancy"];

type View = { kind: "loading" } | { kind: "waiting"; n: number } | { kind: "stalled" } | { kind: "error"; msg: string } | { kind: "ok"; trace: Trace };

function order(spans: Span[]): { span: Span; depth: number }[] {
  const ids = new Set(spans.map((s) => s.id));
  const kids = new Map<string | null, Span[]>();
  for (const s of spans) {
    const p = s.parent_id && ids.has(s.parent_id) ? s.parent_id : null;
    kids.set(p, [...(kids.get(p) ?? []), s]);
  }
  const out: { span: Span; depth: number }[] = [];
  const walk = (p: string | null, depth: number) => {
    for (const s of (kids.get(p) ?? []).sort((a, b) => a.start_ms - b.start_ms)) {
      out.push({ span: s, depth });
      walk(s.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function Waterfall({ trace }: { trace: Trace }) {
  const total = Math.max(1, trace.latency_ms, ...trace.spans.map((s) => s.start_ms + s.duration_ms));
  return (
    <ol className="flex flex-col gap-1.5" aria-label="Span waterfall">
      {order(trace.spans).map(({ span, depth }, i) => {
        const stage = SPAN_TO_STAGE[span.name];
        const gen = span.type === "GENERATION";
        return (
          <li key={span.id} className="grid grid-cols-[minmax(0,9rem)_1fr_3.5rem] items-center gap-2 text-[12px]" style={{ ["--i" as string]: i }}>
            <div className="min-w-0" style={{ paddingLeft: depth * 10 }}>
              <p className="truncate">{stage ? stageLabel(stage) : span.name}</p>
              {gen && (
                <p className="truncate font-mono text-[11px] text-muted-foreground tabular-nums">
                  {span.model ?? "model"}{span.tokens ? `, ${span.tokens.toLocaleString()} tok` : ""}
                </p>
              )}
            </div>
            <div className="relative h-3" aria-hidden>
              <div
                className="reveal-bar absolute inset-y-0.5 rounded-sm bg-foreground/60"
                style={{ left: `${(span.start_ms / total) * 100}%`, width: `max(2px, ${(span.duration_ms / total) * 100}%)`, ["--i" as string]: i }}
              />
            </div>
            <span className="text-right font-mono text-muted-foreground tabular-nums">{fmtMs(span.duration_ms)}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function TraceView({ traceId, expectScores }: { traceId: string; expectScores: boolean }) {
  const [view, setView] = useState<View>({ kind: "loading" });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const alive = useRef(true);

  const load = useCallback(
    async (n: number) => {
      clearTimeout(timer.current);
      try {
        const trace = await getTrace(traceId);
        if (!alive.current) return;
        if (trace) return setView({ kind: "ok", trace });
        if (n < RETRY_S.length) {
          setView({ kind: "waiting", n });
          timer.current = setTimeout(() => load(n + 1), RETRY_S[n] * 1000);
        } else setView({ kind: "stalled" });
      } catch (e) {
        if (alive.current) setView({ kind: "error", msg: e instanceof Error ? e.message : "Couldn't load the trace." });
      }
    },
    [traceId],
  );

  useEffect(() => {
    alive.current = true;
    load(0);
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, [load]);

  const retry = () => { setView({ kind: "loading" }); load(0); };

  if (view.kind === "loading") {
    return (
      <div className="flex flex-col gap-2 p-3" aria-busy>
        <Skeleton className="h-4 w-1/2" />
        {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-3 w-full" />)}
      </div>
    );
  }
  if (view.kind === "waiting") {
    return <p role="status" className="p-3 text-[13px] text-muted-foreground">Waiting for Langfuse to ingest the trace…</p>;
  }
  if (view.kind === "stalled" || view.kind === "error") {
    return (
      <div className="flex flex-col gap-3 p-3">
        <Alert variant={view.kind === "error" ? "destructive" : "default"}>
          <AlertTitle>{view.kind === "error" ? "Couldn't read the trace" : "Trace not available yet"}</AlertTitle>
          <AlertDescription>{view.kind === "error" ? view.msg : "Langfuse hasn't ingested it yet. Try again in a moment."}</AlertDescription>
        </Alert>
        <Button variant="outline" size="sm" className="self-start" onClick={retry}>
          <RotateCwIcon data-icon="inline-start" />
          Retry
        </Button>
      </div>
    );
  }

  const { trace } = view;
  const pending = expectScores && !JUDGE.some((k) => k in trace.scores);
  const scored = Object.entries(trace.scores);
  return (
    <div className="flex flex-col gap-4 p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
        <span>Latency <span className="font-mono text-foreground tabular-nums">{fmtMs(trace.latency_ms)}</span></span>
        <span>Tokens <span className="font-mono text-foreground tabular-nums">{trace.tokens?.toLocaleString() ?? "–"}</span></span>
        <span>Cost <span className="font-mono text-foreground tabular-nums">{trace.cost == null ? "–" : `$${trace.cost.toFixed(4)}`}</span></span>
        {trace.url && (
          <a href={trace.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-signal underline underline-offset-2">
            Open in Langfuse <ExternalLinkIcon className="size-3" aria-hidden />
          </a>
        )}
      </div>

      {(scored.length > 0 || pending) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {scored.map(([k, v]) => (
            <Badge key={k} variant={k in SCORE_MIN && v < SCORE_MIN[k] ? "warn" : "secondary"} className="font-mono tabular-nums">
              {k} {v.toFixed(2)}
            </Badge>
          ))}
          {pending && (
            <>
              <span className="text-[12px] text-muted-foreground">Judge scores pending</span>
              <Button variant="ghost" size="xs" onClick={retry}>Refresh</Button>
            </>
          )}
        </div>
      )}

      <Waterfall trace={trace} />
    </div>
  );
}
