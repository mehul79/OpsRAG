"use client";

import { useSyncExternalStore } from "react";
import { finalize } from "./stages";
import type { Conversation, Turn } from "./types";

// Module store: conversations live in memory and in localStorage. Streaming tokens only touch memory;
// persist() runs on done/error/rename/delete/vote so storage is written a handful of times per answer.
const KEY = "opsrag:conversations:v1";
const MAX = 50;
const EMPTY: Conversation[] = []; // server snapshot must be referentially stable

let state: Conversation[] | null = null;
const listeners = new Set<() => void>();

function load(): Conversation[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    // a turn saved mid-stream (reload, tab closed) will never finish: mark it interrupted
    return (parsed as Conversation[]).map((c) => ({
      ...c,
      turns: c.turns.map((t) => (t.done || t.error ? t : { ...t, error: "Interrupted before the answer finished.", stages: finalize(t.stages, "error") })),
    }));
  } catch {
    return [];
  }
}

const get = () => (state ??= load());
function set(next: Conversation[]) {
  state = next;
  listeners.forEach((l) => l());
}

export function persist() {
  let list = get().slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX);
  for (;;) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      return;
    } catch (e) {
      const quota = e instanceof DOMException && (e.name === "QuotaExceededError" || e.code === 22);
      if (!quota || list.length <= 1) return; // storage unavailable or still full with one chat: keep working in memory
      list = list.slice(0, -1); // drop the oldest and retry
    }
  }
}

export function useHistory(): Conversation[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    get,
    () => EMPTY,
  );
}

const uid = () => crypto.randomUUID();
const map = (id: string, f: (c: Conversation) => Conversation) => set(get().map((c) => (c.id === id ? f(c) : c)));

export function create(): Conversation {
  const now = Date.now();
  const c: Conversation = { id: uid(), title: "New chat", createdAt: now, updatedAt: now, turns: [] };
  set([c, ...get()].slice(0, MAX));
  return c;
}

export function rename(id: string, title: string) {
  const t = title.trim();
  if (t) map(id, (c) => ({ ...c, title: t.slice(0, 60) }));
  persist();
}

export function remove(id: string) {
  set(get().filter((c) => c.id !== id));
  persist();
}

export function addTurn(convId: string, question: string): Turn {
  const turn: Turn = { id: uid(), question, answer: "", sources: [], stages: [], startedAt: Date.now() };
  map(convId, (c) => ({
    ...c,
    title: c.turns.length ? c.title : question.slice(0, 60),
    updatedAt: turn.startedAt,
    turns: [...c.turns, turn],
  }));
  return turn;
}

export function patchTurn(convId: string, turnId: string, patch: Partial<Turn> | ((t: Turn) => Partial<Turn>)) {
  map(convId, (c) => ({
    ...c,
    updatedAt: Date.now(),
    turns: c.turns.map((t) => (t.id === turnId ? { ...t, ...(typeof patch === "function" ? patch(t) : patch) } : t)),
  }));
}
