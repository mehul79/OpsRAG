// OpsRAG as an assay line, the landing page's figure: node frontend/anatomy/build.mjs
// Writes frontend/public/anatomy/opsrag.html.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "./iso-kit.mjs";
import * as M from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (file) => readFileSync(join(HERE, file), "utf8").replace(/^export /gm, "");

const W = 1000, H = 390;
const PLATE = { x: -334, y: -84, w: 688, d: 182, r: 10 };
const PLATE_H = 12, FOOT_H = 5;

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [-105, -40, 50], [115, -46, 54], [128, -40, 50], [180, -56, 62], [300, 42, 46], [-290, -40, 30]],
  W, H, { pad: 20, azimuth: 74, elevation: 40 },
);

const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const slab = (plan, z, h, style = {}, steps = 3, bevel = 0.5) => S(k.slabOf(plan, z, h, P, steps, bevel), { tone: "mid", ...style });
const cyl = (x, y, r, z, h, style = {}, steps = 24) => S(k.cylinder(x, y, r, z, h, P, steps), { tone: "mid", ...style });
const depth = (x, y, z = 0) => k.depthOf([x, y, z], P);
const byDepth = (points) => [...points].sort((a, b) => depth(a[0], a[1]) - depth(b[0], b[1]));
const screws = (points, z, ring = 0) => (ring ? L(points.map(([x, y]) => k.ring(x, y, ring, z, P, 14)).join(""), { tone: "lo" }) : "") + D(points.map(([x, y]) => at([x, y, z])), { size: 0.45 });
const group = (part, body, transform) => `<g data-part="${part}"${transform ? ` transform="${transform}"` : ""}>${body}</g>`;

// A face-up dial: puck, bezel ring, ticks over a 270 degree arc, a threshold mark, a hub.
const ARC = [-Math.PI * 0.75, Math.PI * 1.5];
function dial(cx, cy, r, z, h, { marks = [], count = 40, every = 5 } = {}) {
  const top = z + h;
  const out = [cyl(cx, cy, r, z, h, { tone: "hi", crease: "lo" }, 56)];
  out.push(L(k.sideArc(cx, cy, r, top - 1.2, P, 32), { tone: "faint" }));
  out.push(L(k.ring(cx, cy, r - 1.6, top, P, 56), { tone: "lo" }));
  const t = k.radialTicks(cx, cy, r - 2.2, count, every, top, [1, 2.2], P, ARC[0], ARC[1]);
  out.push(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }));
  for (const f of marks) {
    const a = ARC[0] + f * ARC[1];
    out.push(L(k.lineOnTop([cx + Math.sin(a) * (r - 5.2), cy - Math.cos(a) * (r - 5.2)], [cx + Math.sin(a) * (r - 1.6), cy - Math.cos(a) * (r - 1.6)], top, P), { tone: "hi" }));
  }
  out.push(L(k.ring(cx, cy, 1.2, top, P, 12), { tone: "mid" }));
  return out.join("");
}
const needle = (cx, cy, r, top, f) => {
  const a = ARC[0] + Math.min(1, Math.max(0, f)) * ARC[1];
  return k.lineOnTop([cx - Math.sin(a) * 1.2, cy + Math.cos(a) * 1.2], [cx + Math.sin(a) * (r - 3), cy - Math.cos(a) * (r - 3)], top + 0.1, P);
};
const needleSvg = (part, cx, cy, r, top, f) => `<path data-part="${part}" class="iso-line" data-tone="lit" data-free="start" d="${needle(cx, cy, r, top, f)}" style="stroke-width:1"/>`;

// ---------- base plate, ruler, label ----------
function plate() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  const feet = [...k.corners(PLATE, 24), [PLATE.x + PLATE.w / 2, PLATE.y + 24], [PLATE.x + PLATE.w / 2, PLATE.y + PLATE.d - 24]];
  for (const [x, y] of byDepth(feet)) {
    out.push(cyl(x, y, 8, -PLATE_H - FOOT_H, 1.6, { tone: "lo" }, 28));
    out.push(cyl(x, y, 6.2, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, {}, 28));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 10, 1.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P, 10), { tone: "lo" }));
  const corners = k.corners(PLATE, 11);
  out.push(screws(corners, 0, 2.2));
  const strip = { x: -300, y: 87, w: 540, d: 7, r: 1 };
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 5, 5, strip.y, 0.6, [2, 3.8], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(D([at([strip.x + 2, strip.y + 3.5, 0.6]), at([strip.x + strip.w - 2, strip.y + 3.5, 0.6])], { size: 0.45 }));
  const label = { x: 262, y: 84, w: 66, d: 11, r: 1.2 };
  out.push(S(k.slabOf(label, 0, 0.8, P, 4), { tone: "lo" }));
  out.push(L(k.planOutline(k.insetPlan(label, 1.4), 0.8, P, 4), { tone: "faint" }));
  out.push(k.faceTextSvg(k.topMatrix([label.x + 6, label.y + 7.2], 0.8, P, "x"), "OPSRAG · ASSAY LINE", { size: 3.6, tone: "lo" }));
  out.push(D([at([label.x + 2.4, label.y + 2.4, 0.8]), at([label.x + label.w - 2.4, label.y + label.d - 2.4, 0.8])], { size: 0.4 }));
  return out.join("");
}

// ---------- return rail at the back (cache-write) ----------
const RR = { x: -194, w: 398, y: -78, d: 4 };
function returnRail() {
  const out = [];
  out.push(slab({ x: RR.x, y: RR.y, w: RR.w, d: RR.d, r: 1 }, 0, 3, {}, 3, 0.4));
  for (const x of [RR.x - 6, RR.x + RR.w]) {
    out.push(slab({ x, y: RR.y - 3, w: 6, d: 10, r: 1.2 }, 0, 7));
    out.push(D([at([x + 3, RR.y - 0.5, 7]), at([x + 3, RR.y + 4.5, 7])], { size: 0.4 }));
  }
  return out.join("");
}
const SHUTTLE = (lit) => slab({ x: -8, y: RR.y - 3, w: 16, d: 10, r: 2 }, 3, 4) + (lit ? `<g data-part="shuttle-card">${S(k.slabOf({ x: -6, y: RR.y - 1.5, w: 12, d: 7, r: 0.8 }, 7, 1, P, 3), { tone: "hi", lit: true })}</g>` : "");

// ---------- stations (behind the line) ----------
function intake() {
  const b = { x: -306, y: -50, w: 32, d: 34, r: 3 };
  const out = [slab(b, 0, 24, {}, 4, 0.8)];
  out.push(L(k.sideSeam(b, 8, P, 4), { tone: "faint" }));
  out.push(L(k.planOutline(k.insetPlan(b, 3), 24, P, 4), { tone: "faint" }));
  for (let i = 0; i < 4; i++) out.push(slab({ x: -300, y: -44 + i * 0.4, w: 20, d: 22, r: 1 }, 24 + i * 1.2, 0.9, { tone: "hi" }, 3, 0));
  out.push(slab({ x: -300, y: -16, w: 20, d: 5, r: 1 }, 13, 1.5));
  out.push(screws([[-302, -46], [-278, -46]], 24));
  return out.join("");
}

const ROUTE = { x: -235, dial: [-235, -43], r: 12, z: 20, h: 4 };
function router() {
  const b = { x: -254, y: -62, w: 38, d: 38, r: 3 };
  const out = [slab(b, 0, 20, {}, 4, 0.8)];
  out.push(L(k.sideSeam(b, 6, P, 4), { tone: "faint" }));
  out.push(dial(ROUTE.dial[0], ROUTE.dial[1], ROUTE.r, ROUTE.z, ROUTE.h, { marks: [M.ROUTER_MIN] }));
  out.push(screws(k.corners(b, 4), 20));
  // tray for canned replies, open toward the viewer
  const tray = { x: -248, y: -22.6, w: 26, d: 11, r: 1 };
  out.push(slab(tray, 0, 1.2, { tone: "lo" }, 3, 0));
  out.push(slab({ x: tray.x, y: tray.y, w: tray.w, d: 1.2, r: 0.4 }, 1.2, 5, {}, 2, 0));
  out.push(slab({ x: tray.x, y: tray.y + 1.2, w: 1.2, d: tray.d - 1.2, r: 0.4 }, 1.2, 5, {}, 2, 0));
  out.push(slab({ x: tray.x + tray.w - 1.2, y: tray.y + 1.2, w: 1.2, d: tray.d - 1.2, r: 0.4 }, 1.2, 5, {}, 2, 0));
  return out.join("");
}
const trayFront = () => slab({ x: -248, y: -12.8, w: 26, d: 1.2, r: 0.4 }, 1.2, 3, {}, 2, 0);

const CACHE = { dial: [-170, -44], r: 12, z: 34, h: 4, face: -24 };
const DRAWER = { x: -169, w: 21, z: 12, h: 9 };
function cabinet() {
  const b = { x: -194, y: -64, w: 48, d: 40, r: 2 };
  const out = [slab(b, 0, 34, {}, 4, 0.8)];
  for (const [x0, w] of [[-192.5, 21.5], [-169, 21]]) {
    for (const [z0, h] of [[2, 9], [12, 9], [22, 9]]) {
      if (x0 === DRAWER.x && z0 === DRAWER.z) continue;
      out.push(drawerFront(x0, w, z0, h, 0));
    }
  }
  out.push(dial(CACHE.dial[0], CACHE.dial[1], CACHE.r, CACHE.z, CACHE.h, { marks: [M.CACHE_MIN] }));
  out.push(screws(k.corners(b, 4), 34));
  return out.join("");
}
function drawerFront(x0, w, z0, h, out) {
  const y = CACHE.face + out;
  const f = { x: x0, y, w, d: 1.2, r: 0.4 };
  const parts = [slab(f, z0, h, {}, 2, 0.3)];
  const pull = { x: x0 + w / 2 - 3, y: y + 1.2, w: 6, d: 1.4, r: 0.6 };
  parts.push(slab(pull, z0 + h / 2 - 1, 2, {}, 2, 0));
  const holder = [[x0 + w / 2 - 4, y + 1.2, z0 + h - 1.6], [x0 + w / 2 + 4, y + 1.2, z0 + h - 1.6], [x0 + w / 2 + 4, y + 1.2, z0 + h - 3.6], [x0 + w / 2 - 4, y + 1.2, z0 + h - 3.6]];
  parts.push(L(k.pathOf(holder.map(at), true), { tone: "faint" }));
  return parts.join("");
}
// the hit drawer: body grows as it slides out, front rides on it, answer card on top once out
function drawer(e) {
  const out = [];
  if (e > 0.05) {
    out.push(slab({ x: DRAWER.x + 0.6, y: CACHE.face, w: DRAWER.w - 1.2, d: e, r: 0.3 }, DRAWER.z + 0.5, DRAWER.h - 1, { tone: "hi" }, 2, 0));
    out.push(S(k.slabOf({ x: DRAWER.x + 4, y: CACHE.face + Math.max(0, e - 9), w: DRAWER.w - 8, d: Math.min(e, 8), r: 0.5 }, DRAWER.z + DRAWER.h - 0.5, 0.8, P, 2), { tone: "hi", lit: true }));
  }
  out.push(drawerFront(DRAWER.x, DRAWER.w, DRAWER.z, DRAWER.h, e));
  return out.join("");
}

function transformBase() {
  const b = { x: -124, y: -62, w: 38, d: 34, r: 3 };
  const out = [slab(b, 0, 16, {}, 4, 0.8)];
  out.push(L(k.sideSeam(b, 5, P, 4), { tone: "faint" }));
  out.push(screws(k.corners(b, 4), 16));
  return out.join("");
}
// cantilever press: column, arm over the line, sleeve, ram (rebuilt), head (moves)
const PRESS = {
  transform: { col: [-105, -42], armY: [-46, 0], head: { x: -114, y: -11, w: 18, d: 14, r: 1.5 }, base: 16, armZ: 46, rest: 26, down: 10.4 },
  rerank: { col: [50, -40], armY: [-44, 0], head: { x: 38, y: -12, w: 24, d: 18, r: 2 }, base: 14, armZ: 42, rest: 25, down: 10.4 },
};
function pressFrame(p) {
  const [cx, cy] = p.col;
  const out = [];
  out.push(cyl(cx, cy, 5, p.base, 3, {}, 28));
  out.push(cyl(cx, cy, 3.2, p.base + 3, p.armZ - p.base - 3, { crease: "none" }, 28));
  out.push(L(k.sideArc(cx, cy, 3.2, p.base + 14, P, 18), { tone: "faint" }));
  out.push(slab({ x: cx - 4, y: p.armY[0], w: 8, d: p.armY[1] - p.armY[0], r: 1.5 }, p.armZ, 4, {}, 3, 0.5));
  out.push(cyl(cx, cy, 3.8, p.armZ + 4, 1.6, {}, 24));
  out.push(D([at([cx, p.armY[1] - 4, p.armZ + 4]), at([cx, p.armY[0] + 9, p.armZ + 4])], { size: 0.4 }));
  return out.join("");
}
const RAM_AT = (p) => [p.head.x + p.head.w / 2, p.head.y + p.head.d / 2];
function pressSleeve(p) {
  const [x, y] = RAM_AT(p);
  return cyl(x, y, 2.6, p.armZ - 6, 6, {}, 20) + L(k.sideArc(x, y, 2.6, p.armZ - 3, P, 12), { tone: "faint" });
}
function ram(p, z) {
  const [x, y] = RAM_AT(p);
  return cyl(x, y, 1.3, z + 4, p.armZ - 6 - z - 4, { crease: "none" }, 16);
}
function head(p, slots) {
  const h = p.head;
  const out = [slab(h, 0, 4, { tone: "hi", crease: "lo" }, 3, 0.5)];
  for (let i = 0; i < slots; i++) {
    const sx = h.x + 3 + i * ((h.w - 6) / Math.max(1, slots - 1)) - 0.6;
    out.push(L(k.planOutline({ x: sx, y: h.y + 3, w: 1.2, d: h.d - 6, r: 0.5 }, 4, P, 2), { tone: "lo" }));
  }
  return out.join("");
}

const BINS = { bm25: { x: -64, y: -64, w: 30, d: 30, r: 2 }, dense: { x: -26, y: -64, w: 30, d: 30, r: 2 }, h: 28 };
function retrieveBins() {
  const out = [];
  for (const b of [BINS.bm25, BINS.dense]) {
    out.push(slab(b, 0, BINS.h, {}, 4, 0.8));
    out.push(L(k.sideSeam(b, 6, P, 4), { tone: "faint" }));
    out.push(L(k.planOutline(k.insetPlan(b, 2.5), BINS.h, P, 4), { tone: "faint" }));
  }
  // BM25: a card index, cards standing in rows with tabs
  for (let i = 0; i < 7; i++) {
    const y = BINS.bm25.y + 4 + i * 3.4;
    out.push(slab({ x: BINS.bm25.x + 4, y, w: 22, d: 0.8, r: 0.2 }, BINS.h, 4 + (i % 2), { tone: "hi" }, 2, 0));
    out.push(slab({ x: BINS.bm25.x + 4 + ((i * 6) % 16), y, w: 5, d: 0.8, r: 0.2 }, BINS.h + 4 + (i % 2), 2, { tone: "hi" }, 2, 0));
  }
  // dense: a pegboard, 384 holes stand in as a 7 x 7 grid with a few pegs set
  const g = BINS.dense;
  out.push(D(k.dotGrid(g.x + 5, g.y + 5, 7, 7, 3.3, BINS.h, P), { size: 0.45, tone: "lo" }));
  for (const [i, j] of byDepth([[1, 2], [4, 1], [2, 5], [5, 4], [3, 3], [6, 6]]).map((v) => v)) out.push(cyl(g.x + 5 + i * 3.3, g.y + 5 + j * 3.3, 0.9, BINS.h, 2.4, { tone: "hi" }, 12));
  out.push(screws([[BINS.bm25.x + 2.5, BINS.bm25.y + 2.5], [BINS.dense.x + BINS.dense.w - 2.5, BINS.dense.y + 2.5]], BINS.h));
  return out.join("");
}
// RRF: a stepped funnel hung on both bins, then a chute arm and spout over the line
function funnel() {
  const out = [];
  out.push(slab({ x: -62, y: -34, w: 64, d: 12, r: 2 }, 22, 5, {}, 3, 0.6));
  out.push(L(k.planOutline({ x: -58, y: -32, w: 56, d: 8, r: 1.5 }, 27, P, 3), { tone: "lo" }));
  out.push(slab({ x: -44, y: -31, w: 28, d: 8, r: 1.5 }, 18, 4, {}, 3, 0.5));
  out.push(slab({ x: -35, y: -29.5, w: 10, d: 6, r: 1 }, 15, 3, {}, 3, 0.4));
  out.push(slab({ x: -34, y: -28, w: 8, d: 26, r: 1.2 }, 12, 3, {}, 3, 0.4));
  out.push(cyl(-30, -5, 2.2, 10.6, 1.4, {}, 18));
  out.push(D([at([-30, -24, 15]), at([-30, -9, 15])], { size: 0.4 }));
  return out.join("");
}

const STUDS = Array.from({ length: 20 }, (_, i) => [33.5 + (i % 10) * 3.6, -57 + Math.floor(i / 10) * 5]);
const TOP5 = [2, 6, 9, 13, 17];
function rerankBase() {
  const b = { x: 28, y: -62, w: 44, d: 32, r: 3 };
  const out = [slab(b, 0, 14, {}, 4, 0.8)];
  out.push(L(k.sideSeam(b, 5, P, 4), { tone: "faint" }));
  out.push(slab({ x: 31, y: -60, w: 38, d: 11, r: 1.2 }, 14, 0.6, { tone: "lo" }, 3, 0));
  for (const [x, y] of byDepth(STUDS)) out.push(cyl(x, y, 1.2, 14.6, 1.2, {}, 14));
  out.push(screws([[31, -34], [69, -34]], 14));
  return out.join("");
}
const studsLit = () => byDepth(TOP5.map((i) => STUDS[i])).map(([x, y]) => cyl(x, y, 1.2, 14.6, 1.6, { tone: "hi", lit: true }, 14)).join("");

const GRADE = { dial: [115, -2], r: 12, z: 34, h: 6, post: [115, -48], flag: [129, -40] };
function gradeBase() {
  const b = { x: 96, y: -62, w: 42, d: 30, r: 3 };
  const out = [slab(b, 0, 18, {}, 4, 0.8)];
  out.push(L(k.planOutline(k.insetPlan(b, 3), 18, P, 4), { tone: "faint" }));
  out.push(screws([[100, -36], [134, -58]], 18));
  const [fx, fy] = GRADE.flag;
  out.push(cyl(fx, fy, 2.4, 18, 2, {}, 18));
  out.push(cyl(fx, fy, 0.9, 20, 30, { crease: "none" }, 12));
  out.push(cyl(fx, fy, 1.4, 50, 1, {}, 12));
  return out.join("");
}
const flag = () => S(k.slabOf({ x: GRADE.flag[0] + 0.9, y: GRADE.flag[1] - 0.6, w: 11, d: 1.2, r: 0.3 }, 0, 6, P, 2), { tone: "hi" });
function gradeGauge() {
  const [px, py] = GRADE.post;
  const [dx, dy] = GRADE.dial;
  const out = [];
  out.push(cyl(px, py, 4.6, 18, 3, {}, 24));
  out.push(cyl(px, py, 3, 21, 26, { crease: "none" }, 24));
  out.push(L(k.sideArc(px, py, 3, 32, P, 16), { tone: "faint" }));
  out.push(slab({ x: px - 6, y: py - 6, w: 12, d: 12, r: 2 }, 36, 8, {}, 3, 0.5));
  out.push(slab({ x: dx - 4, y: py + 6, w: 8, d: dy - GRADE.r - py - 6 + 0.4, r: 1.5 }, 38, 4, {}, 3, 0.5));
  out.push(D([at([dx, py + 9, 42]), at([dx, dy - GRADE.r - 3, 42])], { size: 0.4 }));
  out.push(cyl(dx, dy, 1.2, 12, GRADE.z - 12, { tone: "hi", crease: "none" }, 14));
  out.push(cyl(dx, dy, 2, 10.6, 1.4, { tone: "hi" }, 16));
  out.push(dial(dx, dy, GRADE.r, GRADE.z, GRADE.h, { marks: [(M.RELEVANCE_MIN - M.SCORE_RANGE[0]) / (M.SCORE_RANGE[1] - M.SCORE_RANGE[0])], count: 48, every: 4 }));
  out.push(L(k.knurl(dx, dy, GRADE.r, GRADE.z + 1, GRADE.z + GRADE.h - 2, 64, P, 0.3), { tone: "lo" }));
  return out.join("");
}

const GEN = { body: { x: 154, y: -64, w: 52, d: 42, r: 3 }, platen: { x: 158, y: -61, w: 44, d: 10, r: 3 }, sheet: { x: 165, y: -56.4, w: 30, d: 0.8, r: 0.2 }, sheetZ: 27, sheetMax: 34 };
function teletype() {
  const out = [slab(GEN.body, 0, 20, {}, 4, 0.8)];
  out.push(L(k.sideSeam(GEN.body, 6, P, 4), { tone: "faint" }));
  const bed = { x: 158, y: -38, w: 44, d: 13, r: 1.5 };
  out.push(slab(bed, 20, 1.4, { tone: "lo" }, 3, 0));
  out.push(D(k.dotGrid(161, -35.5, 12, 3, 3.5, 21.4, P), { size: 0.7, tone: "mid" }));
  out.push(slab({ x: 168, y: -27.6, w: 24, d: 2.2, r: 1 }, 21.4, 0.8, {}, 2, 0));
  out.push(slab(GEN.platen, 20, 7, {}, 6, 0.6));
  out.push(L(k.lineOnTop([GEN.platen.x + 3, GEN.platen.y + 6.8], [GEN.platen.x + GEN.platen.w - 3, GEN.platen.y + 6.8], 27, P), { tone: "faint" }));
  out.push(screws([[157, -24], [203, -24]], 20));
  return out.join("");
}
const LINES = 8;
function sheet(h) {
  if (h < 0.2) return "";
  const s = GEN.sheet;
  const out = [slab(s, GEN.sheetZ, h, { tone: "hi", crease: "none" }, 2, 0)];
  const face = s.y + s.d;
  for (let i = 0; i < LINES; i++) {
    const z = GEN.sheetZ + h - 3 - i * 3.6;
    if (z < GEN.sheetZ + 1.5) break;
    const len = [24, 20, 26, 14, 22, 25, 18, 10][i];
    out.push(L(k.segment([s.x + 2, face, z], [s.x + 2 + len, face, z], P), { tone: "lo", free: "end" }));
    if (i % 3 === 1) out.push(D([at([s.x + 3 + len, face, z])], { size: 0.55, tone: "hi" }));
  }
  return out.join("");
}

// ---------- the line: rails, carriage, payloads ----------
const RAIL = { from: -312, to: 252 };
function rails() {
  const out = [];
  for (const y of [-10, 4]) {
    out.push(slab({ x: RAIL.from, y, w: RAIL.to - RAIL.from, d: 4, r: 1 }, 0, 3, {}, 3, 0.4));
    out.push(D([RAIL.from + 6, RAIL.to - 6].map((x) => at([x, y + 2, 3])), { size: 0.4 }));
  }
  for (const x of [RAIL.from - 6, RAIL.to]) {
    out.push(slab({ x, y: -14, w: 6, d: 26, r: 1.2 }, 0, 8, {}, 3, 0.5));
    out.push(D([at([x + 3, -10, 8]), at([x + 3, 8, 8])], { size: 0.45 }));
  }
  return out.join("");
}
const CARR = { x: -15, y: -13, w: 30, d: 24, r: 3 };
const TOP = 8;
const CHIPS = Array.from({ length: 20 }, (_, i) => [-10 + (i % 5) * 5, -9 + Math.floor(i / 5) * 5]);
const QUERY_X = { 1: [0], 2: [-5.5, 5.5], 3: [-10, 0, 10] };
const card = (plan, z = TOP) => S(k.slabOf(plan, z, 1.2, P, 3, 0.3), { tone: "hi", lit: true }) + L(k.lineOnTop([plan.x + 2, plan.y + 3], [plan.x + plan.w - 3, plan.y + 3], z + 1.2, P), { tone: "lo", free: true }) + L(k.lineOnTop([plan.x + 2, plan.y + 5.5], [plan.x + plan.w * 0.6, plan.y + 5.5], z + 1.2, P), { tone: "lo", free: true });
function carriage() {
  const out = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(CARR, 3), 3, 0.1, P)}" style="filter:blur(3px)"/>`];
  for (const [x, y] of byDepth([[-11, -8], [11, -8], [-11, 6], [11, 6]])) out.push(slab({ x: x - 3, y: y - 2.5, w: 6, d: 5, r: 1 }, 3, 1.6, { tone: "lo" }, 2, 0));
  out.push(slab(CARR, 4.6, TOP - 4.6, {}, 4, 0.6));
  out.push(D([-10, -3.5, 3.5, 10].map((x) => at([x, CARR.y + CARR.d - 1.8, TOP])), { size: 0.4, tone: "lo" }));
  out.push(group("p-q", card({ x: -9, y: -7, w: 18, d: 13, r: 1 })));
  for (const n of [1, 2, 3]) out.push(group(`p-qs-${n}`, QUERY_X[n].map((cx) => card({ x: cx - 4, y: -7, w: 8, d: 13, r: 0.8 })).join(""), ""));
  out.push(`<g data-part="p-chips">${byDepth(CHIPS.map((c, i) => [...c, i])).map(([x, y, i]) => `<g data-i="${i}">${cyl(x, y, 1.8, TOP, 1.2, { tone: "hi" }, 16)}</g>`).join("")}</g>`);
  out.push(`<g data-part="p-top">${byDepth(TOP5.map((i) => CHIPS[i])).map(([x, y]) => cyl(x, y, 1.8, TOP, 1.8, { tone: "hi", lit: true }, 16)).join("")}</g>`);
  out.push(group("p-ans", S(k.slabOf({ x: -10, y: -8, w: 20, d: 15, r: 1 }, TOP, 1.2, P, 3, 0.3), { tone: "hi", lit: true }) + [3, 5.5, 8, 10.5].map((dy, i) => L(k.lineOnTop([-8, -8 + dy], [-8 + [15, 11, 14, 7][i], -8 + dy], TOP + 1.2, P), { tone: "lo", free: true })).join("")));
  return out.join("");
}
// the pen arm: rides with the carriage and writes the trace on the tape
const PEN = { x: -11, lanes: { root: 44, span: 53.5, score: 63 } };
function penArm() {
  const x = PEN.x;
  const out = [];
  out.push(cyl(x, 8.2, 1.6, TOP, 8, { crease: "none" }, 16));
  out.push(slab({ x: x - 3, y: 6, w: 6, d: 53, r: 1.2 }, 16, 2.4, {}, 3, 0.4));
  for (const y of [PEN.lanes.root, PEN.lanes.span]) {
    out.push(cyl(x, y, 1.6, 13, 3, {}, 16));
    out.push(cyl(x, y, 0.8, 10.5, 2.5, { tone: "hi", crease: "none" }, 12));
  }
  out.push(D([at([x, 10, 18.4]), at([x, 56, 18.4])], { size: 0.4 }));
  return out.join("");
}

// pusher for the router's divert: guide block, rod (rebuilt), head (moves)
const PUSH = { head: { x: -236, y: 11, w: 10, d: 2, r: 0.6 }, guide: { x: -239, y: 20, w: 16, d: 8, r: 1.5 }, z: 8.6 };
const pusherGuide = () => slab(PUSH.guide, 0, 13, {}, 3, 0.5) + screws([[PUSH.guide.x + 3, PUSH.guide.y + 4], [PUSH.guide.x + 13, PUSH.guide.y + 4]], 13);
const pusherRod = (dy) => slab({ x: -232, y: PUSH.head.y + PUSH.head.d + dy, w: 2, d: PUSH.guide.y - (PUSH.head.y + PUSH.head.d + dy), r: 0.8 }, 9.4, 1.8, {}, 2, 0);
const pusherHead = () => slab(PUSH.head, PUSH.z, 3.4, { tone: "hi" }, 2, 0.3);

// ---------- the recorder: the trace ----------
const REC = { x: -312, y: 30, w: 572, d: 52, r: 4 };
const TAPE = { x: -300, y: 38, w: 550, d: 30, r: 0.4 };
const TZ = 10.5;
function recorder() {
  const out = [`<path class="iso-halo" d="${k.haloOf(REC, 0, 10, P)}" style="opacity:.5"/>`];
  out.push(S(k.slabOf(REC, 0, 10, P, 6, 1), { tone: "mid", inner: L(k.sideSeam(REC, 3.5, P, 6), { tone: "faint" }) }));
  const t = k.sideTicks(REC.x + 12, REC.x + REC.w - 12, 5, 5, REC.y + REC.d, 10, [1.4, 2.8], P);
  out.push(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }));
  out.push(S(k.slabOf(TAPE, 10, 0.5, P, 2), { tone: "lo", crease: "none" }));
  for (const y of [49, 58]) out.push(L(k.lineOnTop([TAPE.x, y], [TAPE.x + TAPE.w, y], TZ, P), { tone: "faint" }));
  const holes = [];
  for (let x = TAPE.x + 4; x < TAPE.x + TAPE.w - 2; x += 6) holes.push(at([x, TAPE.y + 1.6, TZ]), at([x, TAPE.y + TAPE.d - 1.6, TZ]));
  out.push(D(holes, { size: 0.4, tone: "lo" }));
  for (const x of [TAPE.x - 5, TAPE.x + TAPE.w]) {
    out.push(slab({ x, y: TAPE.y - 3, w: 5, d: TAPE.d + 6, r: 1.5 }, 10, 3.5, {}, 3, 0.5));
    out.push(D([at([x + 2.5, TAPE.y - 1, 13.5]), at([x + 2.5, TAPE.y + TAPE.d + 1, 13.5])], { size: 0.4 }));
  }
  out.push(screws([[REC.x + 4, REC.y + 4], [REC.x + REC.w - 4, REC.y + 4], [REC.x + 4, REC.y + REC.d - 4], [REC.x + REC.w - 4, REC.y + REC.d - 4]], 10));
  // the feedback rocker: two keys, thumbs up and thumbs down
  out.push(slab({ x: 222, y: 71, w: 26, d: 9, r: 1.5 }, 10, 2, {}, 3, 0.4));
  return out.join("");
}
const KEY = (i, z) => slab({ x: 224 + i * 11.5, y: 72.5, w: 10.5, d: 6, r: 1 }, z, 2.5, { tone: "hi" }, 3, 0.4) + L(k.lineOnTop([229.25 + i * 11.5 - 2, 75.5], [229.25 + i * 11.5 + 2, 75.5], z + 2.5, P), { tone: i ? "lo" : "mid" });

// lane C marks: scores the judge writes later, and the user's thumbs
const SCORE_MARKS = [[204, 210], [212, 218], [220, 226], [228, 234]];
const markD = (x0, x1, y, w) => k.onTop([[x0, y - w / 2], [x1, y - w / 2], [x1, y + w / 2], [x0, y + w / 2]], TZ + 0.05, P, true);

// ---------- right bench: judge, queue, dashboard ----------
const JUDGE = { body: { x: 272, y: 34, w: 66, d: 46, r: 3 }, meters: [282, 300, 318], z: 14, h: 28, plateY: 68 };
function judge() {
  const b = JUDGE.body;
  const out = [slab(b, 0, JUDGE.z, {}, 4, 0.8)];
  out.push(L(k.sideSeam(b, 4.5, P, 4), { tone: "faint" }));
  out.push(screws([[b.x + 4, b.y + b.d - 4], [b.x + b.w - 4, b.y + b.d - 4]], JUDGE.z));
  JUDGE.meters.forEach((x, i) => {
    const plate = { x, y: JUDGE.plateY, w: 11, d: 2, r: 0.4 };
    out.push(slab(plate, JUDGE.z, JUDGE.h + 2, {}, 2, 0.3));
    const face = plate.y + plate.d;
    for (let s = 0; s <= 10; s++) {
      const z = JUDGE.z + (s / 10) * JUDGE.h;
      out.push(L(k.segment([x, face, z], [x + (s % 5 === 0 ? 3 : 1.8), face, z], P), { tone: s % 5 === 0 ? "mid" : "lo" }));
    }
    const limit = [M.FAITH_MIN, M.ANSWER_MIN, null][i];
    if (limit !== null) out.push(L(k.segment([x, face, JUDGE.z + limit * JUDGE.h], [x + 11, face, JUDGE.z + limit * JUDGE.h], P), { tone: "hi" }));
  });
  // the judge's pen arm reaches over the end of the tape
  out.push(slab({ x: 238, y: 60, w: 34, d: 6, r: 1.2 }, 14.5, 2.5, {}, 3, 0.4));
  out.push(cyl(241, 63, 1.4, 12.5, 2, {}, 14));
  out.push(cyl(241, 63, 0.7, TZ, 2.5, { tone: "hi", crease: "none" }, 10));
  return out.join("");
}
const judgeBar = (i, f, lit) => (f <= 0.01 ? "" : slab({ x: JUDGE.meters[i] + 3.8, y: JUDGE.plateY + 2, w: 5, d: 2.6, r: 0.4 }, JUDGE.z, f * JUDGE.h, { tone: "hi", lit }, 2, 0.3));

const QUEUE = { x: 272, y: -8, w: 66, d: 32, r: 2 };
const TAG = (i) => slab({ x: QUEUE.x + 9 + i * 0.6, y: QUEUE.y + 6 - i * 0.4, w: 46, d: 20, r: 1 }, 1.2 + i * 1.3, 1, { tone: "hi" }, 3, 0.3) + L(k.lineOnTop([QUEUE.x + 12 + i * 0.6, QUEUE.y + 10 - i * 0.4], [QUEUE.x + 30 + i * 0.6, QUEUE.y + 10 - i * 0.4], 2.2 + i * 1.3, P), { tone: "lo", free: true });
function queueBack() {
  const q = QUEUE;
  return slab(q, 0, 1.2, { tone: "lo" }, 3, 0) + slab({ x: q.x, y: q.y, w: q.w, d: 1.4, r: 0.4 }, 1.2, 8, {}, 2, 0) + slab({ x: q.x, y: q.y + 1.4, w: 1.4, d: q.d - 1.4, r: 0.4 }, 1.2, 8, {}, 2, 0);
}
function queueFront() {
  const q = QUEUE;
  return slab({ x: q.x + q.w - 1.4, y: q.y + 1.4, w: 1.4, d: q.d - 1.4, r: 0.4 }, 1.2, 8, {}, 2, 0) + slab({ x: q.x + 1.4, y: q.y + q.d - 1.4, w: q.w - 2.8, d: 1.4, r: 0.4 }, 1.2, 5, {}, 2, 0) + screws([[q.x + 0.7, q.y + 0.7], [q.x + q.w - 0.7, q.y + q.d - 0.7]], 9.2);
}

const DASH = { body: { x: 270, y: -72, w: 70, d: 54, r: 3 }, z: 22, dials: [[284, -45], [305, -45], [326, -45]], r: 9 };
function dashboard() {
  const b = DASH.body;
  const out = [slab(b, 0, DASH.z, {}, 4, 0.8)];
  out.push(L(k.sideSeam(b, 7, P, 4), { tone: "faint" }));
  out.push(slab({ x: b.x + 3, y: b.y + 3, w: b.w - 6, d: 12, r: 1.5 }, DASH.z, 1, { tone: "lo" }, 3, 0));
  for (const [x, y] of DASH.dials) out.push(dial(x, y, DASH.r, DASH.z, 3, { count: 20, every: 5 }));
  out.push(screws([[b.x + 4, b.y + b.d - 4], [b.x + b.w - 4, b.y + b.d - 4]], DASH.z));
  return out.join("");
}
// Langfuse feed: a cable from the recorder's end to the dashboard
function feed() {
  return k.wireSvg(at([260, 36, 6]), at([270, -26, 9]), { via: [at([264, 36, 6]), at([264, 36, 0.4]), at([264, -26, 0.4]), at([264, -26, 9])], tone: "mid", size: 1 });
}

// ---------- assemble, back to front ----------
const stations = [
  [depth(-290, -33), intake()],
  [depth(-235, -43), router()],
  [depth(-170, -44), cabinet()],
  [depth(-105, -45), transformBase()],
  [depth(-30, -49), retrieveBins()],
  [depth(50, -46), rerankBase()],
  [depth(117, -47), gradeBase()],
  [depth(180, -43), teletype()],
].sort((a, b) => a[0] - b[0]).map((v) => v[1]);

const R0 = M.SCENARIOS[0];
const body = [
  plate(),
  returnRail(),
  group("shuttle", SHUTTLE(true), k.translateAlong(P, [M.X.generate, 0, 0])),
  ...stations,
  group("studs-lit", studsLit()),
  group("flag", flag(), k.translateAlong(P, [0, 0, 19])),
  needleSvg("n-route", ROUTE.dial[0], ROUTE.dial[1], ROUTE.r, ROUTE.z + ROUTE.h, 0),
  needleSvg("n-cache", CACHE.dial[0], CACHE.dial[1], CACHE.r, CACHE.z + CACHE.h, 0),
  group("drawer", drawer(0)),
  group("sheet", ""),
  group("divert", card({ x: -9, y: -7, w: 18, d: 13, r: 1 }), k.translateAlong(P, [M.X.route + M.CREEP, -16.2, -6.6])),
  trayFront(),
  funnel(),
  rails(),
  group("carriage", carriage(), k.translateAlong(P, [M.X.intake - M.CREEP, 0, 0])),
  pusherGuide(),
  group("push-rod", pusherRod(0)),
  group("push-head", pusherHead()),
  pressFrame(PRESS.transform), pressSleeve(PRESS.transform), group("t-ram", ram(PRESS.transform, PRESS.transform.rest)), group("t-head", head(PRESS.transform, 3), k.translateAlong(P, [0, 0, PRESS.transform.rest])),
  pressFrame(PRESS.rerank), pressSleeve(PRESS.rerank), group("r-ram", ram(PRESS.rerank, PRESS.rerank.rest)), group("r-head", head(PRESS.rerank, 5), k.translateAlong(P, [0, 0, PRESS.rerank.rest])),
  gradeGauge(),
  needleSvg("n-crag", GRADE.dial[0], GRADE.dial[1], GRADE.r, GRADE.z + GRADE.h, 0.5),
  recorder(),
  group("key-0", KEY(0, 12)), group("key-1", KEY(1, 12)),
  `<g data-part="marks">` +
    `<path data-part="m-root" class="iso-mark" d=""/>` +
    Object.keys(M.SPAN).map((s) => `<path data-part="m-${s}" class="iso-mark" data-span="${s}" d=""/>`).join("") +
    SCORE_MARKS.map(([a, b], i) => `<path data-part="m-score-${i}" class="iso-mark" data-score="" d="${markD(a, b, PEN.lanes.score, 2.6)}" style="opacity:0"/>`).join("") +
    `</g>`,
  group("penarm", penArm(), k.translateAlong(P, [M.X.intake - M.CREEP, 0, 0])),
  feed(),
  dashboard(),
  ...DASH.dials.map(([x, y], i) => needleSvg(`n-dash-${i}`, x, y, DASH.r, DASH.z + 3, 0)),
  queueBack(),
  ...Array.from({ length: 5 }, (_, i) => group(`tag-${i}`, TAG(i))),
  group("tag-fly", TAG(0)),
  queueFront(),
  judge(),
  ...[0, 1, 2].map((i) => group(`bar-${i}`, "")),
];

const css = `
.iso-mark{fill:var(--anatomy-hi);stroke:none}
.iso-mark[data-live]{fill:var(--anatomy-lit)}
.iso[data-theme="light"] .iso-mark{fill:var(--anatomy-hi)}
.oa-stage{outline:none;cursor:pointer}
.oa-stage:focus-visible{box-shadow:0 0 0 2px var(--anatomy-mid);border-radius:6px}
.oa-picks{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0 4px}
.oa-picks button{font:inherit;font-size:12px;padding:3px 10px;border-radius:999px;border:1px solid var(--anatomy-faint);background:transparent;color:var(--anatomy-text);cursor:pointer}
.oa-picks button[aria-pressed="true"]{border-color:var(--anatomy-hi);color:var(--anatomy-hi)}
`;

const svg = k.figureSvg({
  width: W,
  height: H,
  label:
    "OpsRAG drawn as an assay bench. A question card rides a carriage along a rail past eight stations: a router with a confidence dial and a pusher that diverts small talk into a tray, a card-catalog cabinet for the semantic cache whose drawer slides out on a hit, a press that splits the question into up to three queries, a BM25 card index and a dense pegboard that pour candidates through a stepped funnel, a reranking press that keeps five of twenty chips, a dial gauge with a flag for weak retrieval, and a teletype that prints the answer. A pen arm on the carriage writes every stage it passes onto a tape in a recorder along the front: that tape is the Langfuse trace. A judge with three meters writes scores onto the same tape, thumbs keys add feedback, a tray holds bad answers and a console of dials reads the tape.",
  body,
});

const live = `
${src("model.mjs")}
const P = ${JSON.stringify(P)};
const C = ${JSON.stringify({ ROUTE, CACHE, GRADE, DASH, PRESS, PUSH, DRAWER, GEN, PEN, TAPE, TZ, JUDGE, QUEUE, CHIPS_N: 20, TOP5, SCORE_MARKS, RR })};
const ARC = ${JSON.stringify(ARC)};
const needle = ${needle.toString().replace(/k\./g, "")};
const markD = ${markD.toString().replace(/k\./g, "")};
const S = (paths, style) => solidSvg(paths, style);
const L = (d, style) => lineSvg(d, style);
const D = (points, style) => dotsSvg(points, style);
const at = (p) => iso(p, P);
const slab = ${slab.toString().replace(/k\./g, "")};
const cyl = ${cyl.toString().replace(/k\./g, "")};
const RAM_AT = ${RAM_AT.toString()};
const ram = ${ram.toString().replace(/k\./g, "")};
const drawerFront = ${drawerFront.toString().replace(/k\./g, "").replace(/CACHE\./g, "C.CACHE.")};
const drawer = ${drawer.toString().replace(/k\./g, "").replace(/CACHE\./g, "C.CACHE.").replace(/DRAWER\./g, "C.DRAWER.")};
const LINES = ${LINES};
const sheet = ${sheet.toString().replace(/k\./g, "").replace(/GEN\./g, "C.GEN.")};
const pusherRod = ${pusherRod.toString().replace(/PUSH\./g, "C.PUSH.")};
const judgeBar = ${judgeBar.toString().replace(/JUDGE\./g, "C.JUDGE.")};
${LIVE()}
`;
function LIVE() {
  return readFileSync(join(HERE, "live.js"), "utf8");
}

const picks = `<div class="oa-picks" role="group" aria-label="Pick a request">${M.SCENARIOS.map((s, i) => `<button type="button" data-pick="${i}" aria-pressed="${i === 0}">${i + 1} · ${s.name}</button>`).join("")}</div>`;
const plateBody = `<div class="iso-stage oa-stage" tabindex="0" role="group" aria-label="OpsRAG assay line. Press 1 to 4, or the arrow keys, to send a different request down the line.">${svg}</div>`;
const html = k.plateHtml({
  fig: "Fig 1",
  title: "OpsRAG, one request",
  hint: "Click or press 1–4 for another request",
  readout: `${R0.name} · intake`,
  keys: [
    { mark: "lit", label: "The request: question card, then queries, candidates, top 5, answer" },
    { mark: "raised", label: "Stations: one per pipeline stage, each a Langfuse span" },
    { mark: "flat", label: "Recorder tape: the trace, one span per stage passed" },
  ],
  caption:
    "Thresholds and counts are the pipeline's own (router 0.80, cache 0.95, 20 → 5, weak below 0.0, queue at faithfulness < 0.7 or answer relevancy < 0.5). The per-request scores are example values; the console's dials are the hit rate, weak rate and open queue over the requests sent so far.",
  body: plateBody,
});

// light, sized to its iframe on the landing page (components/landing/client.tsx reads its height)
const pageCss = css + `html{color-scheme:light;background:transparent}body{margin:0;background:transparent}.iso-figure{margin:0}.iso-page{width:100%;margin:0}.oa-picks{margin:12px 0 0}.iso-plate{border-radius:12px;box-shadow:0 0 0 1px #eaeaea}.iso-legend{margin-top:12px}`;
const target = join(HERE, "..", "public", "anatomy", "opsrag.html");
writeFileSync(target, k.pageHtml({ title: "OpsRAG anatomy", theme: "light", body: html + picks, script: src("iso-kit.mjs") + live, width: 1080 }).replace("</style>", pageCss + "</style>"));
console.log("wrote", target);
