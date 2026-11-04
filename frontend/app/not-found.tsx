import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-start justify-center gap-4 px-6">
      <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">404 · no span for this path</p>
      <h1 className="text-3xl font-light tracking-tight">This page is not in the index</h1>
      <p className="text-sm text-muted-foreground">The link may be old. The chat and the dashboard are still where they were.</p>
      <div className="flex gap-4 text-sm">
        <Link href="/" className="underline underline-offset-4">Home</Link>
        <Link href="/chat" className="underline underline-offset-4">Ask a question</Link>
        <Link href="/dashboard" className="underline underline-offset-4">Dashboard</Link>
      </div>
    </main>
  );
}
