import type { Metadata } from "next";
import Link from "next/link";
import { Arrow, Figure, Mark, Nav, Reveal, Tagline } from "@/components/landing/client";
import "./landing.css";

export const metadata: Metadata = {
  title: "OpsRAG · Find out why your docs copilot got it wrong",
  description:
    "A RAG copilot for Kubernetes, Docker, Terraform and AWS docs. Every answer is traced stage by stage in Langfuse, so a wrong one points at retrieval, reranking or the model.",
  openGraph: {
    title: "OpsRAG",
    description: "Answers from Kubernetes, Docker, Terraform and AWS docs, with a trace for every stage of every answer.",
    type: "website",
  },
};

const REPO = "https://github.com/mehul79/OpsRAG";

// Each failure mode, and the stage of the pipeline that catches it. Numbers are from the eval in README.md.
const FAILURES = [
  {
    tag: "Retrieval missed",
    title: "The right page never came back",
    body: <>BM25 and dense search, fused with RRF, catch exact names like <code>aws_iam_role_policy_attachment</code> and vague questions alike.</>,
    stat: ["recall@20", "1.000"],
  },
  {
    tag: "Ranking buried it",
    title: "It fell out of the top five",
    body: <>A cross encoder keeps the best 5 of 20, and logs the top score.</>,
    stat: ["recall@5", "0.971"],
  },
  {
    tag: "The model guessed",
    title: "The docs had no answer",
    body: <>Low reranker scores flag the answer as weak. It says so and is never cached.</>,
    stat: ["weak flag accuracy", "1.000"],
  },
];

const STEPS = [
  ["Ask", "Small talk skips search and repeats hit the cache. The rest get hybrid search, a reranker and a cited answer."],
  ["Trace", "Every stage is a Langfuse span. A judge scores the answer and your Yes or No adds feedback."],
  ["Fix", "Bad answers land in the dashboard queue, each linked to the trace that shows the failing stage."],
];

const EVALS = [
  ["recall@20", "1.000", "the right chunk is in the 20 candidates"],
  ["recall@5", "0.971", "still there after the reranker keeps 5"],
  ["faithfulness", "0.967", "share of answer claims the chunks support"],
  ["router false skips", "0", "out of 230 test prompts"],
  ["cache wrong hits", "0", "at the 0.95 similarity cut off"],
  ["weak flag accuracy", "1.000", "answerable vs unanswerable questions"],
];

const FAQ = [
  ["Which docs does it answer from?", "Kubernetes, Docker, Terraform core and the Terraform AWS provider, plus nine AWS guides: EC2, ECS, EKS, IAM, CloudFront, RDS, ELB, Billing and Support. That is 51,082 chunks in a Qdrant index."],
  ["What happens when the docs do not cover my question?", "The reranker scores stay low, the answer is flagged weak, and it tells you the docs may not cover it instead of guessing. Weak answers are never cached and go straight to the review queue."],
  ["Where do the traces live?", "In Langfuse. There is no local database: the dashboard reads spans, scores and feedback back from Langfuse, so every number on it links to a real trace."],
  ["How fast is an answer?", "About 10 seconds for a fresh answer on a 4 core laptop, most of it the LLM call and CPU reranking. A cached answer comes back in well under a second."],
  ["Which models does it use?", "Answers come from deepseek/deepseek-v4.1-flash through OpenRouter. The judge is a different model, openai/gpt-6-luna, so it does not grade its own writing."],
  ["Can I run it myself?", "Yes. You need uv, Node.js, an OpenRouter key and Qdrant, with Langfuse keys for the traces. The README walks through setup and ingestion."],
];

export default function Landing() {
  return (
    <div className="lp relative min-h-screen w-full overflow-x-clip">
      <a href="#main" className="lp-skip button-sm">Skip to content</a>
      <div className="lp-glow" aria-hidden />
      <Nav />

      <main id="main" className="relative">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 pt-32 sm:px-6 md:pt-40">
          <p className="caption-4 lp-muted lp-mono">OpsRAG <span aria-hidden>/</span> Traced RAG for infra docs</p>
          <div className="lp-rule mt-3" />
          <div className="mt-12 grid gap-8 md:grid-cols-[1.3fr_1fr] md:items-end md:gap-16">
            <h1 className="heading-1 max-w-[680px]">
              <span className="lp-grad">Find out why your docs<br className="hidden md:block" /> copilot got it wrong</span>
            </h1>
            <div className="max-w-[680px]">
              <p className="body-3 lp-muted">
                OpsRAG answers Kubernetes, Docker, Terraform and AWS questions from the official docs and records every stage of every answer. When one is wrong, its trace shows whether retrieval, reranking or the model failed.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-4">
                <Link href="/chat" className="lp-btn lp-btn-dark button-sm">Ask a question <Arrow /></Link>
                <span className="caption-5 lp-muted lp-mono">No sign up · sources and trace with every answer</span>
              </div>
            </div>
          </div>

          <Reveal className="mt-16" index={1}>
            <Figure />
          </Reveal>
          <p className="caption-5 lp-muted mt-3 max-w-[680px]">
            One request on the line. Each station is a pipeline stage, and the pen on the carriage writes a span onto the tape for every stage it stops at. The tape is the Langfuse trace.
          </p>
        </section>

        {/* Problem */}
        <section id="problem" className="mx-auto max-w-6xl scroll-mt-24 px-4 pt-24 sm:px-6 md:pt-32">
          <Reveal>
            <p className="caption-4 lp-muted lp-mono">The problem</p>
            <h2 className="heading-3 mt-3 max-w-[680px]">A confident answer with no paper trail</h2>
            <p className="body-3 lp-muted mt-4 max-w-[680px]">
              You ask how to attach a policy to an IAM role. The bot answers, cites a page, and the argument it suggests does not exist. Did search miss the page, did ranking drop it, or did the model fill a gap? Most RAG setups log the prompt and the reply, so you guess.
            </p>
          </Reveal>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {FAILURES.map((f, i) => (
              <Reveal key={f.tag} index={i} className="lp-card flex flex-col p-6 md:p-8">
                <p className="caption-4 lp-mono text-[var(--lp-accent)]">{f.tag}</p>
                <h3 className="title-2 mt-3">{f.title}</h3>
                <p className="body-6 lp-muted mt-3 grow">{f.body}</p>
                <div className="lp-rule mt-6 flex items-baseline justify-between pt-4">
                  <span className="caption-5 lp-muted lp-mono">{f.stat[0]}</span>
                  <span className="title-2 lp-mono">{f.stat[1]}</span>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Tagline */}
        <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6 md:py-32">
          <Tagline lines={["Every answer leaves a trace.", "Every trace points at the stage that broke."]} />
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto max-w-6xl scroll-mt-24 px-4 sm:px-6">
          <Reveal>
            <p className="caption-4 lp-muted lp-mono">How it works</p>
            <h2 className="heading-3 mt-3 max-w-[680px]">Ask, trace, fix</h2>
          </Reveal>
          <ol className="mt-12 grid gap-8 md:grid-cols-3">
            {STEPS.map(([title, body], i) => (
              <Reveal as="li" key={title} index={i} className="lp-rule pt-6">
                <p className="caption-5 lp-muted lp-mono">0{i + 1}</p>
                <h3 className="title-2 mt-2">{title}</h3>
                <p className="body-6 lp-muted mt-3">{body}</p>
              </Reveal>
            ))}
          </ol>
          <Reveal className="mt-8">
            <Link href="/dashboard" className="lp-link body-6 text-[var(--lp-ink)]">Open the dashboard and its bad answer queue</Link>
          </Reveal>
        </section>

        {/* Evals */}
        <section id="evals" className="mx-auto max-w-6xl scroll-mt-24 px-4 pt-24 sm:px-6 md:pt-32">
          <Reveal>
            <p className="caption-4 lp-muted lp-mono">Measured, not claimed</p>
            <h2 className="heading-3 mt-3 max-w-[680px]">37 questions through the real pipeline</h2>
            <p className="body-3 lp-muted mt-4 max-w-[680px]">
              35 answerable and 2 unanswerable questions, graded by an LLM judge. A small set, kept as a regression baseline that every change is checked against.
            </p>
          </Reveal>
          <div className="lp-card mt-12 grid gap-px overflow-hidden sm:grid-cols-2 lg:grid-cols-3" style={{ background: "var(--lp-line)" }}>
            {EVALS.map(([name, value, note], i) => (
              <Reveal key={name} index={i % 3} className="bg-[var(--lp-surface)] p-6 md:p-8">
                <p className="caption-5 lp-muted lp-mono">{name}</p>
                <p className="heading-3 lp-mono mt-2">{value}</p>
                <p className="body-6 lp-muted mt-2">{note}</p>
              </Reveal>
            ))}
          </div>
          <p className="caption-5 lp-muted mt-3">
            Retrieval re-checked 2026-11-04 on the live 51k chunk index. <a href={`${REPO}/blob/main/docs/BENCHMARK.md`} className="lp-link" target="_blank" rel="noreferrer">Full benchmark</a>
          </p>
        </section>

        {/* FAQ */}
        <section id="faq" className="mx-auto grid max-w-6xl scroll-mt-24 gap-8 px-4 pt-24 sm:px-6 md:grid-cols-[1fr_2fr] md:pt-32">
          <Reveal>
            <p className="caption-4 lp-muted lp-mono">Questions</p>
            <h2 className="heading-3 mt-3">What people ask first</h2>
          </Reveal>
          <Reveal className="lp-faq lp-rule">
            {FAQ.map(([q, a]) => (
              <details key={q} className="border-b border-[var(--lp-line)]">
                <summary className="flex items-center justify-between gap-6 py-6 title-2">
                  {q}
                  <span className="lp-plus" aria-hidden />
                </summary>
                <p className="body-6 lp-muted max-w-[680px] pb-6">{a}</p>
              </details>
            ))}
          </Reveal>
        </section>

        {/* Final CTA */}
        <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6 md:py-32">
          <Reveal className="lp-card flex flex-col items-start gap-6 p-8 md:flex-row md:items-end md:justify-between md:p-12">
            <div>
              <h2 className="heading-3 max-w-[680px]">Ask it the question that broke last week</h2>
              <p className="body-6 lp-muted mt-3">No sign up. Every answer comes with its sources and its trace.</p>
            </div>
            <Link href="/chat" className="lp-btn lp-btn-dark button-sm shrink-0">Ask a question <Arrow /></Link>
          </Reveal>
        </section>
      </main>

      <footer className="relative mx-auto max-w-6xl px-4 pb-12 sm:px-6">
        <div className="lp-rule flex flex-col gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2 title-4 text-[var(--lp-ink)]"><Mark /> OpsRAG</span>
          <nav aria-label="Footer" className="flex flex-wrap gap-6 body-6 lp-muted">
            <Link href="/chat" className="lp-link">Chat</Link>
            <Link href="/dashboard" className="lp-link">Dashboard</Link>
            <a href={REPO} className="lp-link" target="_blank" rel="noreferrer">Source on GitHub</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
