"use client";

import { ArrowRightIcon } from "lucide-react";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import type { Turn } from "@/lib/types";
import { TurnView, type InspectorTab } from "./turn";

const EXAMPLES = [
  "my pod keeps restarting after deploy",
  "How do I attach a managed policy to an IAM role in Terraform?",
  "What is the difference between an ECS task role and the task execution role?",
];

export function Thread({
  turns,
  live,
  selectedId,
  onSelect,
  onCite,
  onOpen,
  onVote,
  onExample,
}: {
  turns: Turn[];
  live: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCite: (turnId: string, n: number) => void;
  onOpen: (tab: InspectorTab) => void;
  onVote: (turn: Turn, good: boolean) => Promise<void>;
  onExample: (q: string) => void;
}) {
  if (!turns.length) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-4">
        <div className="w-full max-w-[640px]">
          <p className="font-mono text-xs uppercase tracking-[0.06em] text-muted-foreground">OpsRAG / Ask the docs</p>
          <h2 className="mt-3 text-3xl font-light tracking-tight text-balance text-foreground">Ask about your infrastructure</h2>
          <p className="mt-3 text-sm text-pretty text-muted-foreground">
            Kubernetes, Docker, Terraform and AWS, answered from the official docs. Every answer shows its sources and the stages that produced it.
          </p>
          <ul className="mt-8 border-t">
            {EXAMPLES.map((q) => (
              <li key={q} className="border-b">
                <button type="button" onClick={() => onExample(q)} className="group flex w-full items-center justify-between gap-4 py-3 text-left text-sm text-muted-foreground hover:text-foreground">
                  {q}
                  <ArrowRightIcon className="size-3.5 shrink-0 transition-transform duration-300 ease-out group-hover:translate-x-0.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }
  // ponytail: if MessageScroller proves flaky, swap for a plain overflow-y-auto div that follows only within 80px of the bottom
  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller>
        <MessageScrollerViewport>
          <MessageScrollerContent className="mx-auto w-full max-w-[720px] gap-8 px-4 py-6">
            {turns.map((t, i) => (
              <MessageScrollerItem key={t.id} messageId={t.id} scrollAnchor={i === turns.length - 1}>
                <TurnView
                  turn={t}
                  live={live.has(t.id)}
                  selected={t.id === selectedId}
                  onSelect={() => onSelect(t.id)}
                  onCite={(n) => onCite(t.id, n)}
                  onOpen={onOpen}
                  onVote={(good) => onVote(t, good)}
                />
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
