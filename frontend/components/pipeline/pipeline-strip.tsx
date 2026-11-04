"use client";

import { CheckIcon, XIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { STAGES, fmtMs } from "@/lib/stages";
import type { Stage } from "@/lib/types";
import { cn } from "@/lib/utils";

function StageItem({ label, stage }: { label: string; stage?: Stage }) {
  const status = stage?.status ?? "pending";
  const weak = stage?.name === "grade" && stage.status === "done" && stage.meta?.weak === true;
  const body = (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap text-[12px]",
        status === "pending" && "text-muted-foreground",
        status === "running" && "text-signal",
        status === "done" && !weak && "text-foreground",
        weak && "text-warn-foreground",
        status === "skipped" && "text-muted-foreground line-through opacity-40",
        status === "failed" && "text-destructive",
      )}
    >
      {status === "done" && <CheckIcon className="pop size-3" aria-hidden />}
      {status === "failed" && <XIcon className="size-3" aria-hidden />}
      {status === "pending" && <span className="size-1.5 rounded-full border border-current" aria-hidden />}
      <span className={cn(status === "running" && "shimmer")}>{label}</span>
    </span>
  );
  if (status !== "done" || stage?.ms == null) return body;
  return (
    <Tooltip>
      <TooltipTrigger render={<span />}>{body}</TooltipTrigger>
      <TooltipContent className="font-mono tabular-nums">{fmtMs(stage.ms)}</TooltipContent>
    </Tooltip>
  );
}

/** The eight pipeline stages as one hairline-joined row. Clicking it opens the Pipeline tab. */
export function PipelineStrip({ stages, onOpen }: { stages: Stage[]; onOpen: () => void }) {
  const running = stages.find((s) => s.status === "running");
  const label = (k: string) => STAGES.find((s) => s.key === k)?.label;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open pipeline details"
      className="flex w-full flex-wrap items-center gap-y-1 rounded-md py-1 text-left hover:bg-muted/60"
    >
      <span className="sr-only" aria-live="polite">{running ? `Running ${label(running.name)}` : ""}</span>
      {STAGES.map(({ key, label }, i) => (
        <span key={key} className="flex items-center">
          {i > 0 && <span className="mx-1.5 h-px w-2 bg-border sm:w-3" aria-hidden />}
          <StageItem label={label} stage={stages.find((s) => s.name === key)} />
        </span>
      ))}
    </button>
  );
}
