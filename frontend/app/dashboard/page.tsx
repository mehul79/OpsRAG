"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const WINDOWS = ["1h", "24h", "7d", "30d"] as const;

type Metrics = {
  total: number;
  cache_hit_rate: number | null;
  weak_rate: number | null;
  routes: Record<string, number>;
  latency_ms: { p50: number | null; p95: number | null; cached_p50: number | null };
  scores: { faithfulness: number | null; answer_relevancy: number | null; context_relevancy: number | null };
  judged: number;
  thumbs: { up: number; down: number };
  tokens: { total: number; per_answer: number | null };
  cost_usd: number | null;
  queue_open: number;
};
type Item = {
  id: string;
  ts: number;
  question: string;
  answer: string;
  reasons: string[];
  trace_url: string | null;
  comment: string | null;
};

const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);
const ms = (v: number | null) => (v === null ? "–" : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`);

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-black/10 p-4 dark:border-white/15">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}

export default function Dashboard() {
  const [win, setWin] = useState<(typeof WINDOWS)[number]>("24h");
  const [m, setM] = useState<Metrics | null>(null);
  const [queue, setQueue] = useState<Item[]>([]);
  const [error, setError] = useState("");
  const [resolved, setResolved] = useState<Set<string>>(new Set()); // Langfuse ingests the resolve mark a few seconds late, so hide it locally meanwhile

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([fetch(`${API}/metrics?window=${win}`), fetch(`${API}/queue?window=${win}`)]);
      if (!a.ok || !b.ok) throw new Error(`Request failed (${a.status}/${b.status})`);
      setM(await a.json());
      setQueue(await b.json());
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
    const r = await fetch(`${API}/resolve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trace_id: id }) });
    if (r.ok) setResolved((s) => new Set(s).add(id));
    else setError("Couldn't resolve that item.");
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">OpsRAG dashboard</h1>
          <p className="text-sm text-neutral-500">Flag a weak answer, open its trace, find the failing stage.</p>
        </div>
        <div className="flex items-center gap-3">
          <div role="group" aria-label="Time window" className="flex overflow-hidden rounded-md border border-black/15 text-sm dark:border-white/20">
            {WINDOWS.map((w) => (
              <button key={w} type="button" onClick={() => setWin(w)} aria-pressed={win === w}
                className={`px-3 py-1 ${win === w ? "bg-blue-600 text-white" : "hover:bg-black/5 dark:hover:bg-white/10"}`}>{w}</button>
            ))}
          </div>
          <Link href="/" className="text-sm text-neutral-500 underline-offset-4 hover:underline">Back to chat</Link>
        </div>
      </header>

      {error && <p role="alert" className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">{error}</p>}
      {!m && !error && <p className="mt-6 text-sm text-neutral-500">Loading…</p>}

      {m && (
        <>
          <section aria-label="Metrics" className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Questions" value={String(m.total)} hint={Object.entries(m.routes).map(([k, v]) => `${k} ${v}`).join(" · ") || undefined} />
            <Stat label="Cache hit rate" value={pct(m.cache_hit_rate)} hint={m.latency_ms.cached_p50 !== null ? `hits answer in ${ms(m.latency_ms.cached_p50)}` : undefined} />
            <Stat label="Latency p50 / p95" value={`${ms(m.latency_ms.p50)} / ${ms(m.latency_ms.p95)}`} hint="uncached retrieval answers" />
            <Stat label="Weak retrieval" value={pct(m.weak_rate)} />
            <Stat label="Faithfulness" value={pct(m.scores.faithfulness)} hint={`LLM-judged, ${m.judged} answers`} />
            <Stat label="Answer relevancy" value={pct(m.scores.answer_relevancy)} />
            <Stat label="Context relevancy" value={pct(m.scores.context_relevancy)} />
            <Stat label="Feedback" value={`${m.thumbs.up} up · ${m.thumbs.down} down`} />
            <Stat label="Tokens" value={m.tokens.total.toLocaleString()} hint={m.tokens.per_answer ? `${m.tokens.per_answer.toLocaleString()} per answer` : undefined} />
            <Stat label="Cost" value={m.cost_usd === null ? "–" : `$${m.cost_usd.toFixed(4)}`} hint={m.cost_usd === null ? "Langfuse has no price for this model" : undefined} />
          </section>
          <p className="mt-2 text-xs text-neutral-500">All numbers come from Langfuse and lag a few seconds behind. Open a trace for per-stage latency and calls.</p>
        </>
      )}

      <section aria-label="Bad-answer queue" className="mt-8">
        <h2 className="text-sm font-semibold">Bad-answer queue {m ? `(${Math.max(0, m.queue_open - resolved.size)})` : ""}</h2>
        <p className="text-xs text-neutral-500">Thumbs-down, weak retrieval, or low judge scores. Open the trace to see which stage failed.</p>
        {shown.length === 0 && m && <p className="mt-4 text-sm text-neutral-500">Nothing to review.</p>}
        <ul className="mt-3 space-y-3">
          {shown.map((q) => (
            <li key={q.id} className="rounded-lg border border-black/10 p-4 text-sm dark:border-white/15">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-medium">{q.question}</p>
                <div className="flex shrink-0 items-center gap-3 text-xs">
                  {q.trace_url && <a href={q.trace_url} target="_blank" rel="noreferrer" className="text-blue-600 underline dark:text-blue-300">Open trace</a>}
                  <button type="button" onClick={() => resolve(q.id)} className="rounded border border-black/15 px-2 py-0.5 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10">Resolve</button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {q.reasons.map((r) => <span key={r} className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs">{r}</span>)}
              </div>
              {q.comment && <p className="mt-2 text-xs text-neutral-500">User note: {q.comment}</p>}
              <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-neutral-600 dark:text-neutral-400">{q.answer}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
