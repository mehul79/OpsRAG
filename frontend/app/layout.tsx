import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OpsRAG",
  description: "RAG copilot for infrastructure docs, with every answer traced",
};

// Runs before first paint so the page never flashes the wrong theme. "system" follows the OS, live.
const THEME_SCRIPT = `(()=>{const r=document.documentElement,q=matchMedia("(prefers-color-scheme: dark)");
const apply=()=>{let p="system";try{p=localStorage.getItem("opsrag-theme")||"system"}catch{}
const d=p==="dark"||(p==="system"&&q.matches);r.dataset.theme=d?"dark":"light";r.style.colorScheme=d?"dark":"light"};
apply();q.addEventListener("change",apply);window.__applyTheme=apply})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <TooltipProvider delay={300}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
