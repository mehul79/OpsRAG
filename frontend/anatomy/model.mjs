// The truth the figure moves by. Thresholds and counts are the pipeline's own (backend/pipeline.py,
// backend/router.py, backend/monitor.py); per-request scores are example values inside the ranges the evals report.
export const CACHE_MIN = 0.95;     // cosine cut-off for a semantic-cache hit
export const ROUTER_MIN = 0.8;     // top non-retrieve probability needed to skip retrieval
export const RELEVANCE_MIN = 0.0;  // local cross-encoder: every top score below this = weak
export const CANDIDATES = 20, TOP_K = 5, MAX_QUERIES = 3;
export const FAITH_MIN = 0.7, ANSWER_MIN = 0.5; // bad-answer queue thresholds (monitor.py)
export const SCORE_RANGE = [-12, 12]; // CRAG dial scale (answerable >= 1.9, unanswerable <= -9.6 in the eval)

// Stations along the line, in world x. The carriage creeps CREEP either side while a stage works,
// so the pen on its arm draws that stage's span on the tape.
export const X = { intake: -290, route: -235, cache: -170, transform: -105, retrieve: -30, rerank: 50, grade: 115, generate: 180, done: 222 };
export const CREEP = 6;
export const SPAN = { route: "route", cache: "semantic-cache", transform: "query-transform", retrieve: "hybrid-retrieval", rerank: "rerank", grade: "crag-grade", generate: "generate", write: "cache-write" };

export const SCENARIOS = [
  { id: "fresh", name: "fresh answer", route: 0.04, label: "retrieve", sim: 0.88, queries: 2, top: 5.3, scores: [1.0, 0.92, 0.8], thumb: 1 },
  { id: "cached", name: "cache hit", route: 0.03, label: "retrieve", sim: 0.97 },
  { id: "weak", name: "weak retrieval", route: 0.11, label: "retrieve", sim: 0.62, queries: 1, top: -10.4, scores: [0.86, 0.41, 0.2] },
  { id: "routed", name: "routed: chitchat", route: 0.93, label: "chitchat" },
];

export const hitOf = (s) => s.label === "retrieve" && s.sim >= CACHE_MIN;
export const skipOf = (s) => s.label !== "retrieve" && s.route >= ROUTER_MIN;
export const weakOf = (s) => s.top !== undefined && s.top < RELEVANCE_MIN;
export const judgedOf = (s) => !skipOf(s) && !hitOf(s); // online evals run after fresh retrieval answers only
export function reasonsOf(s) {
  const out = [];
  if (s.thumb === 0) out.push("thumbs-down");
  if (weakOf(s)) out.push("weak retrieval");
  if (s.scores && s.scores[0] < FAITH_MIN) out.push("faithfulness " + s.scores[0].toFixed(2));
  if (s.scores && s.scores[1] < ANSWER_MIN) out.push("answer relevancy " + s.scores[1].toFixed(2));
  return out;
}

const TRAVEL = 0.75, WORK = 1.25, POST = 1.5, HOLD = 1.8, ADVANCE = 1.1;

// The stages one request really passes, in order: a skipped stage is not in the list, so it never draws a span.
export function stagesOf(s) {
  const line = ["route"];
  const post = [];
  if (skipOf(s)) post.push("divert");
  else {
    line.push("cache");
    if (hitOf(s)) post.push("serve");
    else {
      line.push("transform", "retrieve", "rerank", "grade", "generate", "done");
      if (!weakOf(s)) post.push("write");
      post.push("judge");
      if (s.thumb !== undefined) post.push("feedback");
      if (reasonsOf(s).length) post.push("queue");
    }
  }
  return { line, post };
}

export function timeline(s) {
  const { line, post } = stagesOf(s);
  const segs = [];
  let t = 0;
  let x = X.intake - CREEP;
  for (const key of line) {
    const to = X[key] - CREEP;
    segs.push({ key, kind: "travel", t0: t, t1: t + TRAVEL, x0: x, x1: to });
    t += TRAVEL;
    const work = key === "generate" ? WORK * 1.8 : key === "done" ? 0.45 : WORK;
    segs.push({ key, kind: "work", t0: t, t1: t + work, x0: to, x1: X[key] + CREEP });
    t += work;
    x = X[key] + CREEP;
  }
  for (const key of post) {
    const d = key === "write" ? POST * 1.4 : POST;
    segs.push({ key, kind: "post", t0: t, t1: t + d, x0: x, x1: x });
    t += d;
  }
  segs.push({ key: "hold", kind: "hold", t0: t, t1: t + HOLD, x0: x, x1: x });
  t += HOLD;
  segs.push({ key: "advance", kind: "advance", t0: t, t1: t + ADVANCE, x0: x, x1: x });
  t += ADVANCE;
  return { segs, total: t, line, post };
}

const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

// Everything the figure shows at time t of one request, as plain numbers.
export function stateAt(s, T, t) {
  const seg = T.segs.find((g) => t < g.t1) || T.segs[T.segs.length - 1];
  const u = Math.min(1, Math.max(0, (t - seg.t0) / (seg.t1 - seg.t0)));
  const progress = (key) => {
    const g = T.segs.find((v) => v.key === key && v.kind !== "travel");
    if (!g) return -1; // never reached
    return Math.min(1, Math.max(0, (t - g.t0) / (g.t1 - g.t0)));
  };
  const x = seg.kind === "travel" ? seg.x0 + (seg.x1 - seg.x0) * ease(u) : seg.kind === "work" ? seg.x0 + (seg.x1 - seg.x0) * u : seg.x0;
  return { seg, u, x, progress, ease };
}
