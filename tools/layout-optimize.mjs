// Dev tool: random-search corner angles / straight lengths of a circuit definition so the loop
// closes with sensible solved straights, the real lap length, the expected number of crossovers
// (Suzuka: 1) and healthy clearance between unrelated parts of the circuit.
// Usage: node tools/layout-optimize.mjs <circuitId> [iterations] [targetA] [targetB] [minClear]
import { integrateLayout } from '../src/track/layout.js';
import { CIRCUITS } from '../src/track/circuits/index.js';

const id = process.argv[2] || 'monaco';
const iters = Number(process.argv[3] || 4000);
const def = CIRCUITS[id];
const tA = Number(process.argv[4] || 300), tB = Number(process.argv[5] || 300);
const minClear = Number(process.argv[6] || 60);
const crossingsWanted = def.crossings || 0;
const netWanted = crossingsWanted ? 0 : -360;

const base = def.segments.map((s) => ({ ...s }));
const turnIdx = base.map((s, i) => (s.t ? i : -1)).filter((i) => i >= 0);
const strIdx = base.map((s, i) => (typeof s.s === 'number' ? i : -1)).filter((i) => i >= 0);
const closer = turnIdx[turnIdx.length - 1];

function segIntersect(p, q, r, s) {
  const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d;
  const u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t] : null;
}

export function analyse(segs) {
  const L = integrateLayout(segs, 4);
  const sc = def.length / L.length;
  const P = L.points.map(([x, y]) => [x * sc, y * sc]);
  const n = P.length, ds = def.length / n;
  // crossings (coarse polyline)
  const stepC = Math.max(1, Math.round(8 / ds));
  const crosses = [];
  for (let i = 0; i < n; i += stepC) {
    const i2 = Math.min(n - 1, i + stepC);
    for (let j = i + Math.round(150 / ds); j < n; j += stepC) {
      if (n - (j - i) < 150 / ds) continue;
      const j2 = (j + stepC) % n;
      const c = segIntersect(P[i], P[i2], P[j], P[j2]);
      if (c) { c.tags = [segs[L.segOf[i]].tag, segs[L.segOf[j]].tag]; crosses.push(c); }
    }
  }
  let minD = Infinity;
  const minSep = Math.round(250 / ds);
  for (let i = 0; i < n; i += 2) for (let j = i + minSep; j < n; j += 2) {
    if (n - (j - i) < minSep) continue;
    const d = Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]);
    if (d >= minD) continue;
    if (crosses.some((c) => Math.hypot(c[0] - P[i][0], c[1] - P[i][1]) < 90)) continue;
    minD = d;
  }
  return { L, sc, crosses, minD, A: L.solved[0] * sc, B: L.solved[1] * sc };
}

function score(segs) {
  const a = analyse(segs);
  if (!(a.A > 40 && a.B > 40)) return { v: 1e9 };
  let v = ((a.A - tA) / 60) ** 2 + ((a.B - tB) / 60) ** 2 + ((a.sc - 1) / 0.08) ** 2;
  v += Math.abs(a.crosses.length - crossingsWanted) * 50;
  // a crossover must be between the straights tagged 'under' and 'over'
  for (const c of a.crosses) if (!(c.tags.includes('under') && c.tags.includes('over'))) v += 60;
  if (a.minD < minClear) v += ((minClear - a.minD) / 8) ** 2 * 5;
  return { v, ...a };
}

let best = base.map((s) => ({ ...s }));
const fixNet = (c) => {
  let net = 0;
  for (const s of c) if (s.t) net += s.dir * s.ang;
  c[closer].ang += (netWanted - net) * c[closer].dir;
};
fixNet(best);
let bestS = score(best);
const rand = (x) => (Math.random() * 2 - 1) * x;
for (let it = 0; it < iters; it++) {
  const c = best.map((s) => ({ ...s }));
  const k = 1 + Math.floor(Math.random() * 3);
  for (let q = 0; q < k; q++) {
    if (Math.random() < 0.6) {
      const i = turnIdx[Math.floor(Math.random() * turnIdx.length)];
      const o = base[i].ang;
      const span = def.crossings ? 0.45 : 0.28;
      c[i].ang = Math.max(o * (1 - span), Math.min(o * (1 + span), c[i].ang + rand(9)));
    } else {
      const i = strIdx[Math.floor(Math.random() * strIdx.length)];
      const o = base[i].s;
      c[i].s = Math.max(o * 0.5, Math.min(o * 1.6, c[i].s + rand(25)));
    }
  }
  fixNet(c);
  const ob = base[closer].ang;
  if (c[closer].ang < ob * 0.6 || c[closer].ang > ob * 1.5) continue;
  const sc = score(c);
  if (sc.v < bestS.v) { best = c; bestS = sc; }
}
console.log(JSON.stringify({ v: bestS.v, A: bestS.A, B: bestS.B, scale: bestS.sc, crossings: bestS.crosses?.length, minClear: bestS.minD }));
console.log('SEGMENTS_JSON ' + JSON.stringify(best.map((s) => (s.t ? { t: s.t, n: s.n, dir: s.dir, ang: Math.round(s.ang), r: s.r } : { s: typeof s.s === 'number' ? Math.round(s.s) : s.s, tag: s.tag }))));
