"use client";

import { useState } from "react";
import { InfoIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { Skeleton } from "@/components/ui/skeleton";
import { PipelineStrip } from "@/components/pipeline/pipeline-strip";
import { fmtMs } from "@/lib/stages";
import type { Turn } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Answer } from "./answer";

const ROUTE_LABEL: Record<string, string> = { chitchat: "small talk", about_bot: "about this assistant", out_of_scope: "outside the docs" };

export type InspectorTab = "sources" | "pipeline" | "trace";

export function TurnView({
  turn,
  live,
  selected,
  onSelect,
  onCite,
  onOpen,
  onVote,
}: {
  turn: Turn;
  live: boolean;
  selected: boolean;
  onSelect: () => void;
  onCite: (n: number) => void;
  onOpen: (tab: InspectorTab) => void;
  onVote: (good: boolean) => Promise<void>;
}) {
  const [voteError, setVoteError] = useState(false);
  const { done } = turn;
  const routed = !!done && done.route !== "retrieve";
  const total = turn.stages.reduce((n, s) => n + (s.ms ?? 0), 0);

  async function vote(good: boolean) {
    setVoteError(false);
    try {
      await onVote(good);
    } catch {
      setVoteError(true);
    }
  }

  return (
    <article
      onClick={onSelect}
      aria-label={turn.question}
      className={cn(
        "enter relative flex flex-col gap-3 pl-4 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:rounded-full before:bg-transparent",
        selected && "before:bg-signal",
      )}
    >
      <Message align="end">
        <Bubble variant="secondary" align="end" className="max-w-[90%]">
          <BubbleContent className="text-[13px] whitespace-pre-wrap">{turn.question}</BubbleContent>
        </Bubble>
      </Message>

      <PipelineStrip stages={turn.stages} onOpen={() => { onSelect(); onOpen("pipeline"); }} />

      {done?.weak && (
        <Alert role="status" className="border-transparent bg-warn text-warn-foreground">
          <AlertTitle>Low-confidence retrieval</AlertTitle>
          <AlertDescription className="text-warn-foreground">The docs may not cover this question. Check the sources before relying on the answer.</AlertDescription>
        </Alert>
      )}
      {routed && done && (
        <Alert role="status">
          <InfoIcon />
          <AlertTitle>Answered without searching: {ROUTE_LABEL[done.route] ?? done.route}</AlertTitle>
          {done.route_confidence !== undefined && (
            <AlertDescription>
              The question didn&apos;t need the docs (<span className="font-mono tabular-nums">{Math.round(done.route_confidence * 100)}%</span> confident).
            </AlertDescription>
          )}
        </Alert>
      )}
      {turn.error && (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{turn.error}</AlertDescription>
        </Alert>
      )}

      {live && !turn.answer && !turn.error && (
        <div className="flex flex-col gap-2" aria-hidden>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-[92%]" />
          <Skeleton className="h-4 w-[64%]" />
        </div>
      )}
      {turn.answer && <Answer text={turn.answer} sourceCount={turn.sources.length} onCite={(n) => { onSelect(); onCite(n); }} />}

      {done && (
        <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
          {done.cached && <Badge variant="success">From cache</Badge>}
          {total > 0 && <span className="font-mono tabular-nums">{fmtMs(total)}</span>}
          {done.trace_id && (
            <span className="flex items-center gap-1">
              {turn.vote ? (
                <span role="status">Thanks, {turn.vote === "down" ? "this answer was added to the review queue." : "noted."}</span>
              ) : (
                <>
                  <span>Helpful?</span>
                  <Button variant="ghost" size="xs" onClick={() => vote(true)} aria-label="Good answer">Yes</Button>
                  <Button variant="ghost" size="xs" onClick={() => vote(false)} aria-label="Bad answer">No</Button>
                </>
              )}
              {voteError && <span role="alert" className="text-destructive">Couldn&apos;t save your feedback.</span>}
            </span>
          )}
          <Button variant="ghost" size="xs" className="ml-auto" onClick={() => { onSelect(); onOpen(routed ? "pipeline" : "sources"); }}>
            Inspect
          </Button>
        </footer>
      )}
    </article>
  );
}
