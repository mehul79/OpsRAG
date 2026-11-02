"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Source = {
  source: string;
  heading: string | null;
  path: string;
  url: string | null;
  score: number;
  text: string;
};
type Done = { cached: boolean; weak: boolean; route?: string; route_confidence?: number; trace_id?: string };
const ROUTE_LABEL: Record<string, string> = { chitchat: "small talk", about_bot: "about this assistant", out_of_scope: "outside the docs" };

// Reranker logits run roughly -11..+11 (local); Cohere scores are already 0..1.
const relevance = (s: number) => (s >= 0 && s <= 1 ? s : 1 / (1 + Math.exp(-s)));

export default function Home() {
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    setAsked(q); setAnswer(""); setSources([]); setDone(null); setError(""); setActive(null); setVote(null); setBusy(true);
    try {
      const res = await fetch(`${API}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += value;
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const raw of events) {
          const ev = /^event: (.*)$/m.exec(raw)?.[1];
          const data = /^data: (.*)$/m.exec(raw)?.[1];
          if (!ev || data === undefined) continue;
          const v = JSON.parse(data);
          if (ev === "sources") setSources(v);
          else if (ev === "token") setAnswer((a) => a + v);
          else if (ev === "done") setDone(v);
          else if (ev === "error") setError(v);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function sendFeedback(good: boolean) {
    if (!done?.trace_id || vote) return;
    setVote(good ? "up" : "down");
    try {
      const r = await fetch(`${API}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trace_id: done.trace_id, good }) });
      if (!r.ok) throw new Error();
    } catch {
      setVote(null);
      setError("Couldn't save your feedback.");
    }
  }

  function focusChunk(n: number) {
    setActive(n);
    cardRefs.current[n - 1]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  const skipped = !!done?.route && done.route !== "retrieve";

  // [1] -> markdown link to #cite-1, rendered below as a button that highlights chunk 1 in the sidebar
  const withCites = answer.replace(/\[(\d+)\]/g, (m, n) => (+n >= 1 && +n <= sources.length ? `[${n}](#cite-${n})` : m));

  return (
    <div className="flex h-dvh flex-col lg:flex-row">
      <main className="flex min-h-0 flex-1 flex-col">
        <header className="border-b border-black/10 px-6 py-4 dark:border-white/10">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold tracking-tight">OpsRAG</h1>
            <Link href="/dashboard" className="text-sm text-neutral-500 underline-offset-4 hover:underline">Dashboard</Link>
          </div>
          <p className="text-sm text-neutral-500">Ask about Kubernetes, Docker, Terraform and AWS. Every answer shows its sources.</p>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {!asked && (
            <div className="mx-auto max-w-2xl space-y-2 text-sm text-neutral-500">
              <p>Try:</p>
              {["my pod keeps restarting after deploy", "How do I attach a managed policy to an IAM role in Terraform?", "What is the difference between an ECS task role and the task execution role?"].map((s) => (
                <button key={s} onClick={() => setQuestion(s)} className="block text-left underline-offset-4 hover:underline">{s}</button>
              ))}
            </div>
          )}
          {asked && (
            <div className="mx-auto max-w-2xl">
              <p className="mb-4 text-base font-medium">{asked}</p>
              {done?.weak && (
                <p role="status" className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                  Low-confidence retrieval: the docs may not cover this question.
                </p>
              )}
              {error && <p role="alert" className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">{error}</p>}
              {busy && !answer && !error && <p className="text-sm text-neutral-500">{sources.length ? "Writing the answer…" : "Searching the docs…"}</p>}
              <div className="prose-sm space-y-3 leading-relaxed [&_a]:no-underline [&_code]:rounded [&_code]:bg-black/5 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.85em] dark:[&_code]:bg-white/10 [&_li]:ml-5 [&_li]:list-disc [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-black/5 [&_pre]:p-3 dark:[&_pre]:bg-white/10 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:font-semibold">
                <ReactMarkdown
                  components={{
                    a: ({ href, children }) => {
                      const n = /^#cite-(\d+)$/.exec(href ?? "")?.[1];
                      return n ? (
                        <button type="button" onClick={() => focusChunk(+n)} aria-label={`Show source ${n}`}
                          className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded bg-blue-500/15 px-1 align-baseline text-xs font-medium text-blue-600 hover:bg-blue-500/30 dark:text-blue-300">
                          {n}
                        </button>
                      ) : <a href={href} target="_blank" rel="noreferrer" className="underline">{children}</a>;
                    },
                  }}
                >{withCites}</ReactMarkdown>
              </div>
              {done?.cached && <p className="mt-4 text-xs text-neutral-500">Answered from the semantic cache.</p>}
              {done?.trace_id && !busy && (
                <div className="mt-4 flex items-center gap-2 text-xs text-neutral-500">
                  {vote ? <span role="status">Thanks, {vote === "down" ? "this answer was added to the review queue." : "noted."}</span> : (
                    <>
                      <span>Was this helpful?</span>
                      <button type="button" onClick={() => sendFeedback(true)} aria-label="Good answer" className="rounded border border-black/15 px-2 py-0.5 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10">Yes</button>
                      <button type="button" onClick={() => sendFeedback(false)} aria-label="Bad answer" className="rounded border border-black/15 px-2 py-0.5 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10">No</button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <form onSubmit={ask} className="border-t border-black/10 p-4 dark:border-white/10">
          <div className="mx-auto flex max-w-2xl gap-2">
            <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={2000} placeholder="Ask about your infrastructure…" aria-label="Question"
              className="min-w-0 flex-1 rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-white/20" />
            <button disabled={busy || !question.trim()}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
              {busy ? "…" : "Ask"}
            </button>
          </div>
        </form>
      </main>

      <aside aria-label="Retrieved chunks" className="flex max-h-[45dvh] w-full shrink-0 flex-col border-t border-black/10 lg:max-h-none lg:w-[400px] lg:border-l lg:border-t-0 dark:border-white/10">
        <div className="border-b border-black/10 px-4 py-4 dark:border-white/10">
          <h2 className="text-sm font-semibold">Retrieved chunks</h2>
          <p className="text-xs text-neutral-500">{skipped ? "No retrieval: answered directly" : sources.length ? `Top ${sources.length} after reranking, with relevance score` : "Sources appear here with their scores"}</p>
        </div>
        {skipped && (
          <div className="m-4 rounded-lg border border-black/10 p-3 text-sm dark:border-white/15">
            <p className="font-medium">Routed: {ROUTE_LABEL[done!.route!] ?? done!.route}</p>
            <p className="mt-1 text-xs text-neutral-500">The question didn't need the docs, so the search was skipped{done!.route_confidence !== undefined && ` (${Math.round(done!.route_confidence * 100)}% confident)`}.</p>
          </div>
        )}
        <ol className="flex-1 space-y-3 overflow-y-auto p-4">
          {sources.map((s, i) => (
            <li key={i} ref={(el) => { cardRefs.current[i] = el; }}
              className={`rounded-lg border p-3 text-sm transition-colors ${active === i + 1 ? "border-blue-500 bg-blue-500/10" : "border-black/10 dark:border-white/15"}`}>
              <button type="button" onClick={() => setActive(active === i + 1 ? null : i + 1)} aria-expanded={active === i + 1} className="w-full text-left">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-blue-500/15 px-1 text-xs font-medium text-blue-600 dark:text-blue-300">{i + 1}</span>
                  <span className="rounded bg-black/5 px-1.5 py-0.5 text-xs dark:bg-white/10">{s.source}</span>
                  <span className="ml-auto font-mono text-xs tabular-nums">{s.score.toFixed(2)}</span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded bg-black/10 dark:bg-white/10" aria-hidden>
                  <div className="h-full rounded bg-blue-500" style={{ width: `${Math.round(relevance(s.score) * 100)}%` }} />
                </div>
                <p className="mt-2 font-medium leading-snug">{s.heading || s.path}</p>
                <p className="mt-0.5 break-all font-mono text-[11px] text-neutral-500">{s.path}</p>
              </button>
              {active === i + 1 && <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-black/5 p-2 font-mono text-xs leading-relaxed dark:bg-white/10">{s.text}</pre>}
              {active === i + 1 && s.url && <a href={s.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-blue-600 underline dark:text-blue-300">Open original page</a>}
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
