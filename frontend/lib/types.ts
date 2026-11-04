export type StageName = "route" | "cache" | "transform" | "retrieve" | "rerank" | "grade" | "generate" | "cache_write";

export type Stage = {
  name: StageName;
  status: "running" | "done" | "skipped" | "failed";
  ms?: number;
  meta?: Record<string, unknown>;
};

export type Source = {
  source: string;
  heading: string | null;
  path: string;
  url: string | null;
  position?: number | null;
  score: number;
  text: string;
};

export type Done = {
  cached: boolean;
  weak: boolean;
  route: string;
  trace_id: string;
  top_score?: number;
  route_confidence?: number;
};

export type Turn = {
  id: string;
  question: string;
  answer: string;
  sources: Source[];
  stages: Stage[];
  done?: Done;
  error?: string;
  vote?: "up" | "down";
  startedAt: number;
};

export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: Turn[];
};

export type Span = {
  id: string;
  parent_id: string | null;
  name: string;
  type: string;
  start_ms: number;
  duration_ms: number;
  model: string | null;
  tokens: number | null;
  level: string | null;
};

export type Trace = {
  trace_id: string;
  url: string | null;
  latency_ms: number;
  tokens: number | null;
  cost: number | null;
  scores: Record<string, number>;
  spans: Span[];
};

export type Metrics = {
  total: number;
  cache_hit_rate: number | null;
  weak_rate: number | null;
  routes: Record<string, number>;
  latency_ms: { p50: number | null; p95: number | null; cached_p50: number | null };
  scores: { faithfulness: number | null; answer_relevancy: number | null; context_relevancy: number | null };
  judged: number;
  thumbs: { up: number; down: number };
  tokens: { total: number; per_answer: number | null };
  cost_usd: number | null;
  queue_open: number;
};

export type Item = {
  id: string;
  ts: number;
  question: string;
  answer: string;
  reasons: string[];
  trace_url: string | null;
  comment: string | null;
};
