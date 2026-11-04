"use client";

import { MessagesSquareIcon } from "lucide-react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
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
        <Empty className="max-w-[720px] border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon"><MessagesSquareIcon /></EmptyMedia>
            <EmptyTitle className="text-[15px]">Ask about your infrastructure</EmptyTitle>
            <EmptyDescription>Kubernetes, Docker, Terraform and AWS. Each answer shows the stages that produced it.</EmptyDescription>
          </EmptyHeader>
          <ul className="flex w-full max-w-md flex-col gap-1 text-left">
            {EXAMPLES.map((q) => (
              <li key={q}>
                <button type="button" onClick={() => onExample(q)} className="w-full rounded-md px-3 py-2 text-left text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground">
                  {q}
                </button>
              </li>
            ))}
          </ul>
        </Empty>
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
