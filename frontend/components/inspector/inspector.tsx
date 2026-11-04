"use client";

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Turn } from "@/lib/types";
import type { InspectorTab } from "@/components/chat/turn";
import { PipelineDetail } from "./pipeline-detail";
import { SourcesList } from "./sources-list";
import { TraceView } from "./trace-view";

function Body({ turn, tab, onTab, activeCite, onCite }: { turn: Turn | null; tab: InspectorTab; onTab: (t: InspectorTab) => void; activeCite: number | null; onCite: (n: number | null) => void }) {
  if (!turn) {
    return (
      <Empty className="border-0">
        <EmptyHeader>
          <EmptyTitle className="text-[13px]">Nothing to inspect</EmptyTitle>
          <EmptyDescription className="text-[12px]">Ask a question to see its sources, pipeline and trace.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  const traceId = turn.done?.trace_id;
  return (
    <Tabs value={tab} onValueChange={(v) => onTab(v as InspectorTab)} className="min-h-0 flex-1 gap-0">
      <TabsList variant="line" className="w-full shrink-0 justify-start border-b px-3">
        <TabsTrigger value="sources">Sources</TabsTrigger>
        <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
        <TabsTrigger value="trace">Trace</TabsTrigger>
      </TabsList>
      <TabsContent value="sources" className="min-h-0 overflow-y-auto">
        <SourcesList sources={turn.sources} active={activeCite} onActive={onCite} />
      </TabsContent>
      <TabsContent value="pipeline" className="min-h-0 overflow-y-auto">
        <PipelineDetail turn={turn} />
      </TabsContent>
      <TabsContent value="trace" className="min-h-0 overflow-y-auto">
        {traceId ? (
          <TraceView key={traceId} traceId={traceId} expectScores={turn.done?.route === "retrieve" && !turn.done.cached} />
        ) : (
          <p className="p-3 text-[13px] text-muted-foreground">The trace is available once the answer finishes.</p>
        )}
      </TabsContent>
    </Tabs>
  );
}

/** Right pane from lg up; a Sheet below. */
export function Inspector({ turn, tab, onTab, activeCite, onCite, sheetOpen, onSheetOpen }: {
  turn: Turn | null; tab: InspectorTab; onTab: (t: InspectorTab) => void; activeCite: number | null; onCite: (n: number | null) => void;
  sheetOpen: boolean; onSheetOpen: (o: boolean) => void;
}) {
  const body = <Body turn={turn} tab={tab} onTab={onTab} activeCite={activeCite} onCite={onCite} />;
  return (
    <>
      <aside aria-label="Inspector" className="hidden w-96 shrink-0 flex-col border-l lg:flex">{body}</aside>
      <Sheet open={sheetOpen} onOpenChange={onSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md lg:hidden">
          <SheetHeader>
            <SheetTitle>Inspector</SheetTitle>
            <SheetDescription className="sr-only">Sources, pipeline stages and trace for the selected answer</SheetDescription>
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    </>
  );
}
