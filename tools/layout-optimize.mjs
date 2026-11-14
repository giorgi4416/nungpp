// Dev tool: random-search the corner angles/straights of the Hungaroring layout so that
// the loop closes with a ~800 m main straight and ~500 m back straight, with no
// self-intersection and healthy clearance between separate parts of the circuit.
import { SEGMENTS, integrateLayout, TRACK_LENGTH } from '../src/track/HungaroringLayout.js';

const base = SEGMENTS.map((s) => ({ ...s }));
const turnIdx = base.map((s, i) => (s.t ? i : -1)).filter((i) => i >= 0);
const strIdx = base.map((s, i) => (typeof s.s === 'number' ? i : -1)).filter((i) => i >= 0);

function score(segs) {
  const L = integrateLayout(segs, 4);
  if (!(L.mainLen > 0 && L.backLen > 0)) return { v: 1e9 };
  const sc = TRACK_LENGTH / L.length;
  const main = L.mainLen * sc, back = L.backLen * sc;
  let v = ((main - 820) / 80) ** 2 + ((back - 520) / 80) ** 2 + ((sc - 1.0) / 0.15) ** 2;
  // clearance: points far apart along the track must be > 70 m apart in space
  const P = L.points.map(([x, y]) => [x * sc, y * sc]);
  const n = P.length, ds = (L.length * sc) / n;
  const minSep = Math.round(250 / ds);
  let minD = Infinity;
  for (let i = 0; i < n; i += 2) for (let j = i + minSep; j < n; j += 2) {
    if (n - (j - i) < minSep) continue;
    const d = Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]);
    if (d < minD) minD = d;
  }
  if (minD < 70) v += ((70 - minD) / 10) ** 2 * 5;
  return { v, main, back, minD, sc };
}

let best = base.map((s) => ({ ...s }));
let bestS = score(best);
const rand = (a) => (Math.random() * 2 - 1) * a;
for (let it = 0; it < 6000; it++) {
  const c = best.map((s) => ({ ...s }));
  const k = 1 + Math.floor(Math.random() * 3);
  for (let q = 0; q < k; q++) {
    if (Math.random() < 0.6) {
      const i = turnIdx[Math.floor(Math.random() * turnIdx.length)];
      const orig = base[i].ang;
      c[i].ang = Math.max(orig * 0.75, Math.min(orig * 1.25, c[i].ang + rand(8)));
    } else {
      const i = strIdx[Math.floor(Math.random() * strIdx.length)];
      const orig = base[i].s;
      c[i].s = Math.max(orig * 0.6, Math.min(orig * 1.6, c[i].s + rand(25)));
    }
  }
  // keep net heading exactly -360 by adjusting T14
  let net = 0;
  for (const s of c) if (s.t) net += s.dir * s.ang;
  const t14 = c.find((s) => s.t === 14);
  t14.ang += net + 360; // net should be -360
  if (t14.ang < 90 || t14.ang > 150) continue;
  const sc = score(c);
  if (sc.v < bestS.v) { best = c; bestS = sc; }
}
console.log(JSON.stringify(bestS));
for (const s of best) {
  if (s.t) console.log(`  { t: ${s.t}, dir: ${s.dir > 0 ? '+1' : '-1'}, ang: ${s.ang.toFixed(0)}, r: ${s.r} },`);
  else console.log(`  { s: ${typeof s.s === 'number' ? s.s.toFixed(0) : `'${s.s}'`} },`);
}
