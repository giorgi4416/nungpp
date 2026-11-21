/**
 * Generic circuit layout integration.
 *
 * A circuit is a sequence of straights and corners:
 *   { s: 120 }                          straight of 120 m
 *   { s: 'A' } / { s: 'B' }             two straights whose lengths are solved so the loop closes exactly
 *   { t: 'La Source', n: 1, dir: -1, ang: 160, r: 17 }   corner (+1 left, -1 right)
 * The sequence is integrated into a 2D polyline (x, y map coordinates, y = north).
 */
export function integrateLayout(segments, step = 1) {
  const names = [...new Set(segments.filter((s) => typeof s.s === 'string').map((s) => s.s))];
  if (names.length !== 2) throw new Error('layout needs exactly two solved straights, got ' + names.join(','));
  const run = (la, lb, collect) => {
    let x = 0, y = 0, h = 0;
    const pts = collect ? [] : null;
    const segOf = collect ? [] : null;
    const corners = [];
    let dist = 0;
    for (let si = 0; si < segments.length; si++) {
      const seg = segments[si];
      if (seg.s !== undefined) {
        const L = seg.s === names[0] ? la : seg.s === names[1] ? lb : seg.s;
        const n = Math.max(1, Math.round(Math.abs(L) / step));
        const d = L / n;
        for (let i = 0; i < n; i++) { x += Math.cos(h) * d; y += Math.sin(h) * d; dist += d; if (pts) { pts.push([x, y]); segOf.push(si); } }
      } else {
        const total = (seg.ang * Math.PI) / 180;
        const arc = total * seg.r;
        const n = Math.max(2, Math.round(arc / step));
        const dh = (total / n) * seg.dir;
        const d = arc / n;
        const start = dist;
        for (let i = 0; i < n; i++) {
          const hm = h + dh * 0.5;
          x += Math.cos(hm) * d; y += Math.sin(hm) * d; h += dh; dist += d;
          if (pts) { pts.push([x, y]); segOf.push(si); }
        }
        corners.push({ name: seg.t, num: seg.n, dir: seg.dir, ang: seg.ang, r: seg.r, start, end: dist, apex: (start + dist) / 2 });
      }
    }
    return { x, y, h, pts, segOf, corners, dist };
  };
  const base = run(0, 0, false);
  const a = run(1, 0, false);
  const b = run(0, 1, false);
  const ax = a.x - base.x, ay = a.y - base.y, bx = b.x - base.x, by = b.y - base.y;
  const det = ax * by - ay * bx;
  const la = (-base.x * by + base.y * bx) / det;
  const lb = (-ax * base.y + ay * base.x) / det;
  const res = run(la, lb, true);
  return { points: res.pts, segOf: res.segOf, corners: res.corners, length: res.dist, solved: [la, lb], closure: Math.hypot(res.x, res.y), heading: res.h };
}

/**
 * Elevation from keyframes [[u, h], ...] (u = lap fraction 0..1, periodic),
 * interpolated with smooth cosine easing.
 */
export function elevationFromKeys(keys) {
  const k = keys.slice().sort((p, q) => p[0] - q[0]);
  return (u) => {
    u = ((u % 1) + 1) % 1;
    let i = k.length - 1;
    for (let j = 0; j < k.length; j++) if (k[j][0] <= u) i = j;
    const a = k[i], b = k[(i + 1) % k.length];
    let span = b[0] - a[0];
    let t = u - a[0];
    if (span <= 0) span += 1;
    if (t < 0) t += 1;
    const f = Math.min(1, Math.max(0, t / span));
    const e = (1 - Math.cos(f * Math.PI)) / 2;
    return a[1] + (b[1] - a[1]) * e;
  };
}
