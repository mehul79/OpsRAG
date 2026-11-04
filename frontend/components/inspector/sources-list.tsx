"use client";

import { useEffect, useRef } from "react";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { relevance } from "@/lib/stages";
import type { Source } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SourcesList({ sources, active, onActive }: { sources: Source[]; active: number | null; onActive: (n: number | null) => void }) {
  const refs = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    if (active) refs.current[active - 1]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [active]);

  if (!sources.length) {
    return (
      <Empty className="border-0">
        <EmptyHeader>
          <EmptyTitle className="text-[13px]">No sources</EmptyTitle>
          <EmptyDescription className="text-[12px]">Retrieved chunks appear here once the answer is grounded.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <ol className="flex flex-col gap-2 p-3">
      {sources.map((s, i) => {
        const open = active === i + 1;
        return (
          <li
            key={i}
            ref={(el) => { refs.current[i] = el; }}
            className={cn("rounded-lg border bg-card text-[13px]", open && "border-signal")}
          >
            <button type="button" onClick={() => onActive(open ? null : i + 1)} aria-expanded={open} className="w-full rounded-lg p-3 text-left">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm bg-[color-mix(in_oklab,var(--signal)_12%,transparent)] px-1 font-mono text-[11px] text-signal tabular-nums">{i + 1}</span>
                <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[12px] text-muted-foreground">{s.source}</span>
                <span className="ml-auto font-mono text-[12px] tabular-nums">{s.score.toFixed(2)}</span>
              </div>
              <div className="mt-2 h-0.5 rounded-full bg-foreground/50" style={{ width: `${Math.round(relevance(s.score) * 100)}%` }} aria-hidden />
              <p className="mt-2 leading-snug font-medium">{s.heading || s.path}</p>
              <p className="mt-0.5 font-mono text-[12px] break-all text-muted-foreground">{s.path}</p>
            </button>
            {open && (
              <div className="flex flex-col gap-2 px-3 pb-3">
                <pre className="max-h-72 overflow-auto rounded-md bg-muted p-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">{s.text}</pre>
                {s.url && (
                  <a href={s.url} target="_blank" rel="noreferrer" className="text-[12px] text-signal underline underline-offset-2">
                    Open original page
                  </a>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
