"use client";

import { useEffect, useState } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Pref = "system" | "light" | "dark";
const NEXT: Record<Pref, Pref> = { system: "light", light: "dark", dark: "system" };
const ICON = { system: MonitorIcon, light: SunIcon, dark: MoonIcon };
const LABEL = { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" };

/** Cycles system → light → dark. The choice is stored in localStorage and applied by the script in app/layout.tsx. */
export function ThemeToggle() {
  const [pref, setPref] = useState<Pref | null>(null); // null until mounted: the server can't know the stored choice
  useEffect(() => {
    let p: Pref = "system";
    try { p = (localStorage.getItem("opsrag-theme") as Pref) || "system"; } catch {}
    setPref(p);
  }, []);
  const choose = (p: Pref) => {
    try { localStorage.setItem("opsrag-theme", p); } catch {}
    (window as unknown as { __applyTheme?: () => void }).__applyTheme?.();
    setPref(p);
  };
  const Icon = ICON[pref ?? "system"];
  const label = LABEL[pref ?? "system"];
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`${label}. Switch theme`} onClick={() => choose(NEXT[pref ?? "system"])} />}>
        <Icon />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
