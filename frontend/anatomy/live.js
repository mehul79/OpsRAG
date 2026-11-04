// Live layer: every pose is a pure function of (scenario, t) through stateAt(); nothing here invents numbers.
const stage = document.querySelector(".oa-stage");
const svg = stage.querySelector("svg");
const $ = (p) => svg.querySelector(`[data-part="${p}"]`);
const readout = document.querySelector("[data-readout]");
const buttons = [...document.querySelectorAll("[data-pick]")];
const still = matchMedia("(prefers-reduced-motion: reduce)");
const TZ = C.TZ;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ramp = (v, a, b) => clamp((v - a) / (b - a));
const bump = (v, a, b) => Math.sin(Math.PI * ramp(v, a, b));
const E = {};
for (const name of ["carriage", "penarm", "p-q", "p-qs-1", "p-qs-2", "p-qs-3", "p-chips", "p-top", "p-ans", "divert", "push-head", "push-rod", "drawer", "shuttle", "shuttle-card", "t-head", "t-ram", "r-head", "r-ram", "studs-lit", "flag", "sheet", "marks", "m-root", "n-route", "n-cache", "n-crag", "key-0", "key-1", "tag-fly", "bar-0", "bar-1", "bar-2", "n-dash-0", "n-dash-1", "n-dash-2"]) E[name] = $(name);
const chips = [...E["p-chips"].children];
const tags = [0, 1, 2, 3, 4].map((i) => $(`tag-${i}`));
const spanMarks = Object.keys(SPAN).map((key) => [key, $(`m-${key}`)]);
const scoreMarks = [0, 1, 2, 3].map((i) => $(`m-score-${i}`));
const memo = new WeakMap();
const remember = (el, key, value) => { let m = memo.get(el); if (!m) memo.set(el, (m = {})); if (m[key] === value) return false; m[key] = value; return true; };
const set = (el, attr, value) => { if (el && remember(el, attr, value)) value === null ? el.removeAttribute(attr) : el.setAttribute(attr, value); };
const html = (el, value) => { if (remember(el, "#", value)) el.innerHTML = value; };
const op = (el, v) => set(el, "style", v >= 0.999 ? "" : `opacity:${v.toFixed(3)}`);
const move = (el, v) => set(el, "transform", translateAlong(P, v));
const hex = () => Array.from({ length: 32 }, () => "0123456789abcdef"[(Math.random() * 16) | 0]).join("");

let index = 0, sc = SCENARIOS[0], T = timeline(sc), t = 0, traceId = hex();
let recorded = false, queuedThisRun = false, open = 0, shownTags = 0;
const runs = [];
const dash = [0, 0, 0], dashTarget = [0, 0, 0];

function start(i) {
  index = (i + SCENARIOS.length) % SCENARIOS.length;
  sc = SCENARIOS[index];
  T = timeline(sc);
  t = 0;
  traceId = hex();
  recorded = false;
  queuedThisRun = false;
  if (open >= 3) open -= 1; // the oldest item is resolved from the dashboard
  shownTags = Math.min(open, 5);
  buttons.forEach((b, j) => b.setAttribute("aria-pressed", String(j === index)));
}

function say(st) {
  const g = st.seg, s = sc, id = traceId.slice(0, 8) + "…";
  const span = SPAN[g.key];
  const f2 = (v) => v.toFixed(2);
  const detail = {
    route: () => `p(skip) ${f2(s.route)} ${s.route >= ROUTER_MIN ? "≥" : "<"} ${f2(ROUTER_MIN)} → ${skipOf(s) ? s.label : "retrieve"}`,
    cache: () => `similarity ${f2(s.sim)} ${s.sim >= CACHE_MIN ? "≥" : "<"} ${f2(CACHE_MIN)} → ${hitOf(s) ? "hit" : "miss"}`,
    transform: () => `${s.queries} quer${s.queries > 1 ? "ies" : "y"}`,
    retrieve: () => `BM25 + dense ×${s.queries}, RRF → ${CANDIDATES} candidates`,
    rerank: () => `${CANDIDATES} → ${TOP_K}, top score ${s.top.toFixed(1)}`,
    grade: () => `top ${s.top.toFixed(1)} ${weakOf(s) ? "<" : "≥"} ${RELEVANCE_MIN.toFixed(1)} → ${weakOf(s) ? "weak" : "ok"}`,
    generate: () => `${TOP_K} chunks → answer with [n] citations${weakOf(s) ? ", says docs may not cover it" : ""}`,
    done: () => `done · trace ${id}`,
    write: () => `answer stored, never for weak answers`,
    judge: () => `judge · faith ${f2(s.scores[0])} · answer ${f2(s.scores[1])} · context ${f2(s.scores[2])}`,
    feedback: () => `user_feedback ${s.thumb}`,
    queue: () => `bad-answer queue · ${reasonsOf(s).join(", ")}`,
    divert: () => `canned ${s.label} reply, no retrieval`,
    serve: () => `cached answer served`,
    hold: () => `trace ${id} · ask + ${T.line.filter((k) => SPAN[k]).length + (T.post.includes("write") ? 1 : 0)} spans`,
    advance: () => `trace ${id} · next request`,
  }[g.key];
  const text = `${s.name} · ${g.kind === "travel" ? "→ " + (span || g.key) : span ? "span " + span + " · " : ""}${g.kind === "travel" ? "" : detail ? detail() : ""}`;
  if (readout.textContent !== text) readout.textContent = text;
}

function draw(dt) {
  const st = stateAt(sc, T, t);
  const pr = st.progress, e = st.ease, x = st.x;
  const adv = pr("advance"), hold = Math.max(0, pr("hold"));
  const fade = 1 - ramp(adv, 0, 0.6);
  move(E.carriage, [x, 0, 0]);
  move(E.penarm, [x, 0, 0]);

  const tr = pr("transform"), rv = pr("retrieve"), rr = pr("rerank"), gr = pr("grade"), gen = pr("generate");
  const cp = pr("cache"), serve = pr("serve"), div = pr("divert"), rt = pr("route"), wr = pr("write"), jd = pr("judge"), fb = pr("feedback"), qu = pr("queue");

  // what the carriage carries
  const qGone = Math.max(ramp(tr, 0.45, 0.6), ramp(serve, 0.3, 0.5), div >= 0 ? ramp(div, 0.2, 0.25) : 0);
  op(E["p-q"], (1 - qGone) * fade);
  for (const n of [1, 2, 3]) op(E[`p-qs-${n}`], n === sc.queries ? ramp(tr, 0.45, 0.6) * (1 - ramp(rv, 0.05, 0.3)) : 0);
  const genGone = 1 - ramp(gen, 0.75, 0.95);
  chips.forEach((el) => {
    const i = Number(el.dataset.i);
    const top = C.TOP5.includes(i);
    op(el, ramp(rv, 0.1 + i * 0.03, 0.18 + i * 0.03) * (top ? 1 : 1 - ramp(rr, 0.55, 0.75)) * genGone);
  });
  op(E["p-top"], ramp(rr, 0.5, 0.75) * genGone);
  op(E["p-ans"], Math.max(ramp(gen, 0.8, 0.98), ramp(serve, 0.35, 0.6)) * fade);

  // router: dial, pusher, canned-reply card
  set(E["n-route"], "d", needle(C.ROUTE.dial[0], C.ROUTE.dial[1], C.ROUTE.r, C.ROUTE.z + C.ROUTE.h, sc.route * e(ramp(rt, 0.1, 0.6)) * fade));
  const push = div >= 0 ? bump(div, 0, 0.7) : 0;
  move(E["push-head"], [0, -14 * push, 0]);
  html(E["push-rod"], pusherRod(-14 * Math.round(push * 20) / 20));
  const drop = div >= 0 ? e(ramp(div, 0.2, 0.6)) : 0;
  const from = [X.route + CREEP, 0, 0], to = [X.route + CREEP, -16.2, -6.6];
  move(E.divert, from.map((v, j) => v + (to[j] - v) * drop));
  op(E.divert, div >= 0 && div > 0.18 ? fade : 0);

  // cache: dial, drawer on a hit
  set(E["n-cache"], "d", needle(C.CACHE.dial[0], C.CACHE.dial[1], C.CACHE.r, C.CACHE.z + C.CACHE.h, (cp >= 0 ? sc.sim * e(ramp(cp, 0.1, 0.6)) : 0) * fade));
  const ext = hitOf(sc) ? 10 * e(ramp(cp, 0.5, 0.95)) * fade : 0;
  html(E.drawer, drawer(Math.round(ext * 10) / 10));

  // presses
  for (const [key, p, v, a, b] of [["t", C.PRESS.transform, tr, 0.1, 0.5], ["r", C.PRESS.rerank, rr, 0.1, 0.55]]) {
    const z = Math.round((p.rest - (p.rest - p.down) * bump(v, a, b)) * 10) / 10;
    move(E[`${key}-head`], [0, 0, z]);
    html(E[`${key}-ram`], ram(p, z));
  }
  op(E["studs-lit"], ramp(rr, 0.5, 0.75) * fade);

  // CRAG gauge and flag
  const fTop = sc.top === undefined ? 0 : (sc.top - SCORE_RANGE[0]) / (SCORE_RANGE[1] - SCORE_RANGE[0]);
  set(E["n-crag"], "d", needle(C.GRADE.dial[0], C.GRADE.dial[1], C.GRADE.r, C.GRADE.z + C.GRADE.h, fTop * e(ramp(gr, 0.1, 0.6)) * fade));
  const up = weakOf(sc) ? e(ramp(gr, 0.5, 0.9)) * fade : 0;
  move(E.flag, [0, 0, 19 + 23 * up]);
  set(E.flag.firstElementChild, "data-lit", up > 0.5 ? "" : null);

  // teletype sheet
  html(E.sheet, sheet(Math.round(C.GEN.sheetMax * ramp(gen, 0.05, 0.95) * fade * 5) / 5));

  // cache-write shuttle on the back rail
  const go = wr >= 0 ? e(ramp(wr, 0.1, 0.8)) : 0;
  const back = wr >= 0 ? e(ramp(adv, 0, 0.9)) : 0;
  move(E.shuttle, [X.generate + (X.cache - X.generate) * go * (1 - back), 0, 0]);
  op(E["shuttle-card"], wr >= 0 ? ramp(wr, 0, 0.1) * (1 - ramp(wr, 0.85, 1)) : 0);

  // the tape: the root span, one span per stage passed, then scores
  const penX = x + C.PEN.x;
  const startX = Math.max(C.TAPE.x + 1, X.intake - CREEP + C.PEN.x);
  set(E["m-root"], "d", markD(startX, Math.max(startX + 0.5, penX), C.PEN.lanes.root, 2.4));
  for (const [key, el] of spanMarks) {
    const v = pr(key);
    if (v <= 0 && key !== "write") { set(el, "d", ""); continue; }
    if (key === "write") {
      if (wr <= 0) { set(el, "d", ""); continue; }
      const a = X.done - CREEP + C.PEN.x + 14;
      set(el, "d", markD(a, a + 12 * ramp(wr, 0, 0.9), C.PEN.lanes.span, 3.4));
      wr < 1 ? el.setAttribute("data-live", "") : el.removeAttribute("data-live");
      continue;
    }
    const a = X[key] - CREEP + C.PEN.x;
    const b = Math.min(X[key] + CREEP + C.PEN.x, penX);
    set(el, "d", markD(a, Math.max(a + 0.5, b), C.PEN.lanes.span, 3.4));
    v < 1 ? el.setAttribute("data-live", "") : el.removeAttribute("data-live");
  }
  scoreMarks.forEach((el, i) => op(el, i < 3 ? (jd >= 0 ? ramp(jd, i * 0.25, i * 0.25 + 0.2) : 0) : fb >= 0 ? ramp(fb, 0.3, 0.6) : 0));
  op(E.marks, fade);

  // judge meters
  [0, 1, 2].forEach((i) => {
    const f = sc.scores && jd >= 0 ? sc.scores[i] * e(ramp(jd, i * 0.25, i * 0.25 + 0.3)) * fade : 0;
    html(E[`bar-${i}`], judgeBar(i, Math.round(f * 100) / 100, jd < 1));
  });

  // thumbs keys
  move(E["key-0"], [0, 0, sc.thumb === 1 && fb >= 0 ? -1 * bump(fb, 0.1, 0.9) : 0]);
  move(E["key-1"], [0, 0, sc.thumb === 0 && fb >= 0 ? -1 * bump(fb, 0.1, 0.9) : 0]);

  // bad-answer queue
  if (qu >= 1 && !queuedThisRun) { queuedThisRun = true; open += 1; }
  const stack = Math.min(open, 5);
  shownTags = qu >= 1 ? stack : Math.min(shownTags, stack);
  tags.forEach((el, i) => op(el, i < shownTags ? 1 : 0));
  if (qu >= 0 && qu < 1) {
    const slot = Math.min(open, 4);
    move(E["tag-fly"], [-slot * 0.6 * -1, slot * -0.4, slot * 1.3 + 30 * (1 - e(ramp(qu, 0.1, 0.8)))]);
    op(E["tag-fly"], ramp(qu, 0, 0.15));
  } else op(E["tag-fly"], 0);

  // dashboard: rates over the requests sent so far
  if (hold > 0 && !recorded) {
    recorded = true;
    runs.push({ hit: hitOf(sc), weak: weakOf(sc) });
    const n = runs.length;
    dashTarget[0] = runs.filter((r) => r.hit).length / n;
    dashTarget[1] = runs.filter((r) => r.weak).length / n;
  }
  dashTarget[2] = Math.min(1, open / 10);
  for (let i = 0; i < 3; i++) {
    dash[i] = still.matches ? dashTarget[i] : dash[i] + (dashTarget[i] - dash[i]) * (1 - Math.exp(-dt / 0.5));
    const [cx, cy] = C.DASH.dials[i];
    set(E[`n-dash-${i}`], "d", needle(cx, cy, C.DASH.r, C.DASH.z + 3, dash[i]));
  }
  say(st);
}

let frame = 0, last = 0, visible = false;
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 1 / 60;
  last = now;
  t += dt;
  if (t >= T.total) start(index + 1);
  draw(dt);
  frame = visible ? requestAnimationFrame(tick) : 0;
}
function run() {
  if (still.matches) { stillPose(); return; }
  if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); }
}
function stillPose() {
  const hold = T.segs.find((g) => g.kind === "hold");
  t = hold.t0 + 0.05;
  draw(1);
}
function pick(i) {
  start(i);
  if (still.matches) stillPose();
  else draw(0);
}
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
stage.addEventListener("click", () => pick(index + 1));
buttons.forEach((b) => b.addEventListener("click", () => { pick(Number(b.dataset.pick)); stage.focus(); }));
stage.addEventListener("keydown", (event) => {
  let to = null;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") to = index + 1;
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") to = index - 1;
  if (/^[1-4]$/.test(event.key)) to = Number(event.key) - 1;
  if (to === null) return;
  event.preventDefault();
  pick(to);
});
start(0);
if (still.matches) stillPose(); else draw(0);
