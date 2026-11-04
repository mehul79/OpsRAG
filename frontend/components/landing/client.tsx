"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

export const Arrow = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M2 7h9.5M7.5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const LINKS = [
  { href: "#problem", label: "Problem" },
  { href: "#how", label: "How it works" },
  { href: "#evals", label: "Evals" },
  { href: "/dashboard", label: "Dashboard" },
];

export function Nav() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  return (
    <header className="fixed inset-x-0 top-0 z-50 px-4 pt-4 sm:px-6">
      <nav aria-label="Main" className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <Link href="/" aria-current="page" className="lp-nav-pill flex items-center gap-2 px-3 py-2 title-4 text-[var(--lp-ink)]">
          <Mark /> OpsRAG
        </Link>
        <div className="lp-nav-pill hidden items-center p-1 md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="lp-nav-link body-6">{l.label}</a>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Link href="/chat" className="lp-btn lp-btn-accent button-sm">Ask a question</Link>
          <button
            type="button"
            className="lp-nav-pill flex size-10 items-center justify-center md:hidden"
            aria-expanded={open}
            aria-controls="lp-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <rect className="lp-menu-line" x="2" y="4" width="12" height="1.5" rx="0.75" fill="currentColor" style={{ transform: open ? "translateY(3.25px) rotate(45deg)" : "none" }} />
              <rect className="lp-menu-line" x="2" y="10.5" width="12" height="1.5" rx="0.75" fill="currentColor" style={{ transform: open ? "translateY(-3.25px) rotate(-45deg)" : "none" }} />
            </svg>
          </button>
        </div>
      </nav>
      <div
        id="lp-menu"
        className="lp-panel fixed inset-0 top-0 -z-10 flex flex-col gap-2 px-6 pt-24 md:hidden"
        data-open={open ? "" : undefined}
        style={{ opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none" }}
        aria-hidden={!open}
      >
        {[...LINKS, { href: "/chat", label: "Ask a question" }].map((l, i) => (
          <a key={l.href} href={l.href} tabIndex={open ? 0 : -1} onClick={() => setOpen(false)} className="lp-rule py-4 heading-3" style={{ ["--i" as string]: Math.min(i, 6) }}>
            {l.label}
          </a>
        ))}
      </div>
    </header>
  );
}

export function Mark() {
  // a tape with three spans: the trace that every answer leaves
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <rect x="1" y="3" width="16" height="12" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="4" y="6.5" width="10" height="1.6" rx="0.8" fill="currentColor" />
      <rect x="4" y="10" width="3" height="1.6" rx="0.8" fill="#e4572e" />
      <rect x="8.5" y="10" width="2.5" height="1.6" rx="0.8" fill="currentColor" />
    </svg>
  );
}

export function Reveal({ children, className = "", index = 0, as: Tag = "div" }: { children: ReactNode; className?: string; index?: number; as?: "div" | "section" | "li" }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { el.setAttribute("data-shown", ""); io.disconnect(); }
    }, { rootMargin: "0px 0px -10% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    // @ts-expect-error: ref type differs by tag, all are HTMLElement
    <Tag ref={ref} className={`lp-reveal ${className}`} style={{ ["--i" as string]: index }}>
      {children}
    </Tag>
  );
}

export function Tagline({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const words = [...(ref.current?.querySelectorAll<HTMLElement>(".lp-word") ?? [])];
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { words.forEach((w) => w.setAttribute("data-on", "")); return; }
    // a word lights when it crosses a line 40% up from the bottom of the viewport, and stays lit
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.setAttribute("data-on", ""); io.unobserve(e.target); }
    }, { rootMargin: "0px 0px -40% 0px" });
    words.forEach((w) => io.observe(w));
    return () => io.disconnect();
  }, []);
  return (
    <p ref={ref} className="heading-tagline max-w-[680px]">
      {lines.map((line, i) => (
        <span key={i} className="block">
          {line.split(" ").map((w, j) => (
            <span key={j} className="lp-word">{w}{" "}</span>
          ))}
        </span>
      ))}
    </p>
  );
}

// The isometric figure is a standalone page (frontend/anatomy/build.mjs) served from /public.
// It is same origin, so the frame watches its body and takes its height.
export function Figure() {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let ro: ResizeObserver | null = null;
    const attach = () => {
      const body = frame.contentDocument?.body;
      if (!body || !body.childElementCount) return;
      const fit = () => setHeight(frame.contentDocument!.documentElement.scrollHeight);
      ro?.disconnect();
      ro = new ResizeObserver(fit);
      ro.observe(body);
      fit();
    };
    attach();
    frame.addEventListener("load", attach);
    return () => { frame.removeEventListener("load", attach); ro?.disconnect(); };
  }, []);
  return (
    <div className="overflow-x-auto">
      <iframe
        ref={ref}
        src="/anatomy/opsrag.html"
        title="Interactive drawing of OpsRAG: a question card rides a line of stations while a pen writes each stage onto a trace tape"
        className="block w-full min-w-[720px] border-0"
        style={{ height: height ?? 640 }}
      />
    </div>
  );
}
