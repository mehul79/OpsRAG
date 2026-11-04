"use client";

import { useRef, useState } from "react";
import { PanelRightIcon } from "lucide-react";
import { Composer } from "@/components/chat/composer";
import { HistorySidebar } from "@/components/chat/history-sidebar";
import { Thread } from "@/components/chat/thread";
import type { InspectorTab } from "@/components/chat/turn";
import { Inspector } from "@/components/inspector/inspector";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { sendFeedback, streamAsk } from "@/lib/api";
import { addTurn, create, patchTurn, persist, remove, rename, useHistory } from "@/lib/history";
import { applyStage, finalize } from "@/lib/stages";
import type { Turn } from "@/lib/types";

export default function Home() {
  const convs = useHistory();
  const [activeId, setActiveId] = useState<string | null | undefined>(undefined); // undefined: most recent chat, null: a new empty chat
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
  const [tab, setTab] = useState<InspectorTab>("sources");
  const [activeCite, setActiveCite] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [live, setLive] = useState<Set<string>>(new Set());
  const controllers = useRef(new Map<string, AbortController>()); // one per streaming turn

  const conv = activeId === null ? undefined : convs.find((c) => c.id === (activeId ?? convs[0]?.id));
  const turns = conv?.turns ?? [];
  const selected = turns.find((t) => t.id === selectedTurnId) ?? turns.at(-1) ?? null;

  const openInspector = (t: InspectorTab) => {
    setTab(t);
    if (!window.matchMedia("(min-width: 1024px)").matches) setSheetOpen(true);
  };
  const setLiveTurn = (id: string, on: boolean) =>
    setLive((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });

  function ask(question: string) {
    const c = conv ?? create();
    const cid = c.id;
    const turn = addTurn(cid, question);
    setActiveId(cid);
    setSelectedTurnId(turn.id);
    setActiveCite(null);
    const ac = new AbortController();
    controllers.current.set(turn.id, ac);
    setLiveTurn(turn.id, true);
    const patch = (p: Partial<Turn> | ((t: Turn) => Partial<Turn>)) => patchTurn(cid, turn.id, p); // keyed by ids: safe if the user switches chats
    const fail = (msg: string) => patch((t) => ({ error: msg, stages: finalize(t.stages, "error") }));
    let ended = false;
    streamAsk(question, {
      sources: (sources) => patch({ sources }),
      token: (tok) => patch((t) => ({ answer: t.answer + tok })),
      stage: (ev) => patch((t) => ({ stages: applyStage(t.stages, ev) })),
      done: (done) => { ended = true; patch((t) => ({ done, stages: finalize(t.stages, "done") })); },
      error: (msg) => { ended = true; fail(msg); },
    }, ac.signal)
      .then(() => { if (!ended) fail("The connection closed before the answer finished."); })
      .catch((e) => { if (!ac.signal.aborted) fail(e instanceof Error ? e.message : "Something went wrong."); })
      .finally(() => {
        controllers.current.delete(turn.id);
        setLiveTurn(turn.id, false);
        persist();
      });
  }

  async function vote(turn: Turn, good: boolean) {
    if (!conv || !turn.done?.trace_id) return;
    await sendFeedback(turn.done.trace_id, good);
    patchTurn(conv.id, turn.id, { vote: good ? "up" : "down" });
    persist();
  }

  function del(id: string) {
    convs.find((c) => c.id === id)?.turns.forEach((t) => controllers.current.get(t.id)?.abort());
    remove(id);
    if (conv?.id === id) setActiveId(null);
  }

  return (
    <SidebarProvider className="h-dvh min-h-0">
      <HistorySidebar
        conversations={convs}
        activeId={conv?.id ?? null}
        onSelect={(id) => { setActiveId(id); setSelectedTurnId(null); setActiveCite(null); }}
        onNew={() => { setActiveId(null); setSelectedTurnId(null); setActiveCite(null); }}
        onRename={rename}
        onDelete={del}
      />
      <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger />
          <h1 className="min-w-0 flex-1 truncate text-[13px] font-medium">{conv?.title ?? "New chat"}</h1>
          <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => openInspector(tab)} disabled={!selected}>
            <PanelRightIcon data-icon="inline-start" />
            Inspector
          </Button>
        </header>
        <Thread
          turns={turns}
          live={live}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedTurnId}
          onCite={(id, n) => { setSelectedTurnId(id); setActiveCite(n); openInspector("sources"); }}
          onOpen={openInspector}
          onVote={vote}
          onExample={ask}
        />
        <Composer onSend={ask} />
      </SidebarInset>
      <Inspector turn={selected} tab={tab} onTab={setTab} activeCite={activeCite} onCite={setActiveCite} sheetOpen={sheetOpen} onSheetOpen={setSheetOpen} />
    </SidebarProvider>
  );
}
