"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ChartColumnIcon, EllipsisIcon, SquarePenIcon } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import type { Conversation } from "@/lib/types";

const DAY = 86_400_000;

function group(list: Conversation[]) {
  if (!list.length) return []; // also keeps new Date() out of the prerender
  const start = new Date().setHours(0, 0, 0, 0);
  const buckets: [string, Conversation[]][] = [["Today", []], ["Previous 7 days", []], ["Older", []]];
  for (const c of [...list].sort((a, b) => b.updatedAt - a.updatedAt)) {
    buckets[c.updatedAt >= start ? 0 : c.updatedAt >= start - 7 * DAY ? 1 : 2][1].push(c);
  }
  return buckets.filter(([, items]) => items.length);
}

function Row({
  c, active, renaming, onOpen, onStartRename, onRename, onCancel, onDelete,
}: {
  c: Conversation; active: boolean; renaming: boolean;
  onOpen: () => void; onStartRename: () => void; onRename: (t: string) => void; onCancel: () => void; onDelete: () => void;
}) {
  const cancelled = useRef(false); // Esc must not be followed by the blur-save
  if (renaming) {
    return (
      <SidebarMenuItem>
        <Input
          autoFocus
          defaultValue={c.title}
          maxLength={60}
          aria-label="Rename conversation"
          className="h-8 text-[13px]"
          onFocus={(e) => { cancelled.current = false; e.currentTarget.select(); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") { cancelled.current = true; onCancel(); }
          }}
          onBlur={(e) => { if (!cancelled.current) onRename(e.currentTarget.value); }}
        />
      </SidebarMenuItem>
    );
  }
  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={active} onClick={onOpen} className="text-[13px]">
        <span>{c.title}</span>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger render={<SidebarMenuAction showOnHover aria-label={`Actions for ${c.title}`} />}>
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start">
          <DropdownMenuItem onClick={onStartRename}>Rename</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={onDelete}>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

export function HistorySidebar({
  conversations, activeId, onSelect, onNew, onRename, onDelete,
}: {
  conversations: Conversation[]; activeId: string | null;
  onSelect: (id: string) => void; onNew: () => void; onRename: (id: string, t: string) => void; onDelete: (id: string) => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const { setOpenMobile } = useSidebar();
  const groups = group(conversations);
  return (
    <Sidebar>
      <SidebarHeader className="gap-3 p-3">
        <span className="px-1 text-[13px] font-semibold tracking-tight">OpsRAG</span>
        <Button variant="outline" className="w-full justify-start text-[13px]" onClick={() => { onNew(); setOpenMobile(false); }}>
          <SquarePenIcon data-icon="inline-start" />
          New chat
        </Button>
      </SidebarHeader>
      <SidebarContent>
        {groups.length === 0 && (
          <Empty className="border-0 p-4">
            <EmptyHeader>
              <EmptyTitle className="text-[13px]">No chats yet</EmptyTitle>
              <EmptyDescription className="text-[12px]">Your questions are kept in this browser.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {groups.map(([label, items]) => (
          <SidebarGroup key={label}>
            <SidebarGroupLabel>{label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {items.map((c) => (
                  <Row
                    key={c.id}
                    c={c}
                    active={c.id === activeId}
                    renaming={renamingId === c.id}
                    onOpen={() => { onSelect(c.id); setOpenMobile(false); }}
                    onStartRename={() => setRenamingId(c.id)}
                    onRename={(t) => { onRename(c.id, t); setRenamingId(null); }}
                    onCancel={() => setRenamingId(null)}
                    onDelete={() => onDelete(c.id)}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="p-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link href="/dashboard" />} className="text-[13px]">
              <ChartColumnIcon />
              <span>Dashboard</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
