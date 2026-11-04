"use client";

import { ThemeToggle } from "@/components/theme-toggle";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeftIcon, CircleCheckIcon, ExternalLinkIcon } from "lucide-react";
import { TraceView } from "@/components/inspector/trace-view";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getMetrics, getQueue, resolveItem } from "@/lib/api";
import type { Item, Metrics } from "@/lib/types";

const WINDOWS = ["1h", "24h", "7d", "30d"] as const;
type Win = (typeof WINDOWS)[number];

const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);
const ms = (v: number | null) => (v === null ? "–" : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`);

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-card p-4">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-xl font-medium tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-[12px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function Dashboard() {
  const [win, setWin] = useState<Win>("24h");
  const [m, setM] = useState<Metrics | null>(null);
  const [queue, setQueue] = useState<Item[]>([]);
  const [error, setError] = useState("");
  const [resolved, setResolved] = useState<Set<string>>(new Set()); // Langfuse ingests the resolve mark a few seconds late, so hide it locally meanwhile
  const [inspect, setInspect] = useState<Item | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([getMetrics(win), getQueue(win)]);
      setM(a);
      setQueue(b);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach the API.");
    }
  }, [win]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const shown = queue.filter((x) => !resolved.has(x.id));

  async function resolve(id: string) {
    try {
      await resolveItem(id);
      setResolved((s) => new Set(s).add(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't resolve that item.");
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <Link href="/chat" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-3.5" aria-hidden /> Back to chat
      </Link>
      <header className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-light tracking-tight">Dashboard</h1>
          <p className="text-[13px] text-muted-foreground">Flag a weak answer, open its trace, find the failing stage.</p>
        </div>
        <div className="flex items-center gap-2">
        <ToggleGroup
          aria-label="Time window"
          value={[win]}
          onValueChange={(v) => v[0] && setWin(v[0] as Win)}
          variant="outline"
          spacing={0}
        >
          {WINDOWS.map((w) => (
            <ToggleGroupItem key={w} value={w} className="font-mono text-[12px]">{w}</ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ThemeToggle />
        </div>
      </header>

      {error && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!m && !error && (
        <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-4" aria-busy>
          {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-[84px] rounded-none" />)}
        </div>
      )}

      {m && (
        <>
          <section aria-label="Metrics" className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-4">
            <Stat label="Questions" value={String(m.total)} hint={Object.entries(m.routes).map(([k, v]) => `${k} ${v}`).join(", ") || undefined} />
            <Stat label="Cache hit rate" value={pct(m.cache_hit_rate)} hint={m.latency_ms.cached_p50 !== null ? `hits answer in ${ms(m.latency_ms.cached_p50)}` : undefined} />
            <Stat label="Latency p50 / p95" value={`${ms(m.latency_ms.p50)} / ${ms(m.latency_ms.p95)}`} hint="uncached retrieval answers" />
            <Stat label="Weak retrieval" value={pct(m.weak_rate)} />
            <Stat label="Faithfulness" value={pct(m.scores.faithfulness)} hint={`LLM-judged, ${m.judged} answers`} />
            <Stat label="Answer relevancy" value={pct(m.scores.answer_relevancy)} />
            <Stat label="Context relevancy" value={pct(m.scores.context_relevancy)} />
            <Stat label="Feedback" value={`${m.thumbs.up} up / ${m.thumbs.down} down`} />
            <Stat label="Tokens" value={m.tokens.total.toLocaleString()} hint={m.tokens.per_answer ? `${m.tokens.per_answer.toLocaleString()} per answer` : undefined} />
            <Stat label="Cost" value={m.cost_usd === null ? "–" : `$${m.cost_usd.toFixed(4)}`} hint={m.cost_usd === null ? "Langfuse has no price for this model" : undefined} />
            <div className="hidden bg-card md:col-span-2 md:block" aria-hidden />{/* fills the last row so the grid has no gap showing */}
          </section>
          <p className="mt-2 text-[12px] text-muted-foreground">All numbers come from Langfuse and lag a few seconds behind. Open a trace for per-stage latency and calls.</p>
        </>
      )}

      <section aria-label="Bad-answer queue" className="mt-8">
        <h2 className="text-[13px] font-semibold">
          Bad-answer queue {m && <span className="font-mono tabular-nums">({Math.max(0, m.queue_open - resolved.size)})</span>}
        </h2>
        <p className="text-[12px] text-muted-foreground">Thumbs-down, weak retrieval, or low judge scores. Open the trace to see which stage failed.</p>
        {shown.length === 0 && m && (
          <Empty className="mt-4 border">
            <EmptyHeader>
              <EmptyMedia variant="icon"><CircleCheckIcon /></EmptyMedia>
              <EmptyTitle className="text-[13px]">Nothing to review</EmptyTitle>
              <EmptyDescription className="text-[12px]">No unresolved bad answers in this window.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        <ul className="mt-3 flex flex-col gap-2">
          {shown.map((q) => (
            <li key={q.id} className="rounded-lg border bg-card p-4 text-[13px]">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 flex-1 font-medium">{q.question}</p>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="outline" size="xs" onClick={() => setInspect(q)}>Inspect</Button>
                  {q.trace_url && (
                    <Button variant="ghost" size="xs" nativeButton={false} render={<a href={q.trace_url} target="_blank" rel="noreferrer" />}>
                      Langfuse <ExternalLinkIcon data-icon="inline-end" />
                    </Button>
                  )}
                  <Button variant="outline" size="xs" onClick={() => resolve(q.id)}>Resolve</Button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {q.reasons.map((r) => <Badge key={r} variant="warn">{r}</Badge>)}
              </div>
              {q.comment && <p className="mt-2 text-[12px] text-muted-foreground">User note: {q.comment}</p>}
              <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-muted-foreground">{q.answer}</p>
            </li>
          ))}
        </ul>
      </section>

      <Sheet open={!!inspect} onOpenChange={(o) => !o && setInspect(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Trace</SheetTitle>
            <SheetDescription className="line-clamp-2">{inspect?.question}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {inspect && <TraceView key={inspect.id} traceId={inspect.id} expectScores />}
          </div>
        </SheetContent>
      </Sheet>
    </main>
  );
}
