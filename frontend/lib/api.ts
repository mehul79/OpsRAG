import type { Done, Item, Metrics, Source, Trace } from "./types";

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type StageEvent = { name: string; status: "start" | "done"; ms?: number; meta?: Record<string, unknown> };
export type AskHandlers = {
  sources: (s: Source[]) => void;
  token: (t: string) => void;
  stage: (s: StageEvent) => void;
  done: (d: Done) => void;
  error: (m: string) => void;
};

/** POST /ask and dispatch each server-sent event. Throws on network/HTTP failure (AbortError included). */
export async function streamAsk(question: string, h: AskHandlers, signal?: AbortSignal) {
  const res = await fetch(`${API}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    const events = buf.split("\n\n");
    buf = events.pop() ?? "";
    for (const raw of events) {
      const ev = /^event: (.*)$/m.exec(raw)?.[1];
      const data = /^data: (.*)$/m.exec(raw)?.[1];
      if (!ev || data === undefined) continue;
      const v = JSON.parse(data);
      if (ev === "sources") h.sources(v);
      else if (ev === "token") h.token(v);
      else if (ev === "stage") h.stage(v);
      else if (ev === "done") h.done(v);
      else if (ev === "error") h.error(v);
    }
  }
}

const json = { "Content-Type": "application/json" };

export async function sendFeedback(trace_id: string, good: boolean) {
  const r = await fetch(`${API}/feedback`, { method: "POST", headers: json, body: JSON.stringify({ trace_id, good }) });
  if (!r.ok) throw new Error(`Feedback failed (${r.status})`);
}

/** null while Langfuse has not ingested the trace yet (404). */
export async function getTrace(id: string): Promise<Trace | null> {
  const r = await fetch(`${API}/trace/${id}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Couldn't load the trace (${r.status})`);
  return r.json();
}

export async function getMetrics(win: string): Promise<Metrics> {
  const r = await fetch(`${API}/metrics?window=${win}`);
  if (!r.ok) throw new Error(`Request failed (${r.status})`);
  return r.json();
}

export async function getQueue(win: string): Promise<Item[]> {
  const r = await fetch(`${API}/queue?window=${win}`);
  if (!r.ok) throw new Error(`Request failed (${r.status})`);
  return r.json();
}

export async function resolveItem(id: string) {
  const r = await fetch(`${API}/resolve`, { method: "POST", headers: json, body: JSON.stringify({ trace_id: id }) });
  if (!r.ok) throw new Error("Couldn't resolve that item.");
}
