/**
 * Hungaroring layout definition.
 *
 * The circuit is described the way a race engineer would describe it: a
 * sequence of straights and corners (direction, angle, radius). The sequence
 * is integrated into a 2D centreline, closed exactly by solving two straight
 * lengths, then scaled to the real lap length of 4.381 km. The resulting
 * points become control points for a closed CatmullRomCurve3.
 *
 * Direction: clockwise (like the real circuit). +1 = left, -1 = right.
 */

export const TRACK_LENGTH = 4381;

// prettier-ignore
export const SEGMENTS = [
  { s: 'main' },                                      // main straight (solved)
  { t: 1, dir: -1, ang: 136, r: 28 },               // T1  downhill right hairpin
  { s: 212 },
  { t: 2, dir: +1, ang: 92, r: 50 },                // T2  long downhill left
  { s: 95 },
  { t: 3, dir: -1, ang: 83, r: 60 },                // T3  right onto back straight
  { s: 'back' },                                      // back straight (solved)
  { t: 4, dir: +1, ang: 52, r: 125 },               // T4  fast blind left over crest
  { s: 187 },
  { t: 5, dir: -1, ang: 134, r: 58 },               // T5  long right
  { s: 273 },
  { t: 6, dir: -1, ang: 91, r: 24 },                // T6  chicane right
  { s: 42 },
  { t: 7, dir: +1, ang: 84, r: 24 },                // T7  chicane left
  { s: 95 },
  { t: 8, dir: +1, ang: 80, r: 48 },                // T8  left
  { s: 39 },
  { t: 9, dir: -1, ang: 98, r: 44 },                // T9  right
  { s: 231 },
  { t: 10, dir: +1, ang: 38, r: 95 },               // T10 left kink
  { s: 47 },
  { t: 11, dir: -1, ang: 69, r: 92 },               // T11 fast right
  { s: 308 },
  { t: 12, dir: -1, ang: 84, r: 34 },               // T12 heavy braking right
  { s: 152 },
  { t: 13, dir: +1, ang: 81, r: 40 },               // T13 left
  { s: 146 },
  { t: 14, dir: -1, ang: 93, r: 52 },               // T14 long final right
  { s: 151 },
];

/** Integrate the segment list into a closed 2D polyline (x, y map coords). */
export function integrateLayout(segments = SEGMENTS, step = 1) {
  // heading of every straight is independent of straight lengths -> solve closure linearly
  const run = (lenMain, lenBack, collect) => {
    let x = 0, y = 0, h = 0; // heading radians, 0 = +x
    const pts = collect ? [] : null;
    const corners = [];
    const push = () => pts && pts.push([x, y]);
    let dist = 0;
    for (const seg of segments) {
      if (seg.s !== undefined) {
        const L = seg.s === 'main' ? lenMain : seg.s === 'back' ? lenBack : seg.s;
        const n = Math.max(1, Math.round(L / step));
        const d = L / n;
        for (let i = 0; i < n; i++) { x += Math.cos(h) * d; y += Math.sin(h) * d; dist += d; push(); }
      } else {
        const total = (seg.ang * Math.PI) / 180;
        const arc = total * seg.r;
        const n = Math.max(2, Math.round(arc / step));
        const dh = (total / n) * seg.dir;
        const d = arc / n;
        const start = dist;
        for (let i = 0; i < n; i++) {
          // midpoint heading integration keeps arcs exact
          const hm = h + dh * 0.5;
          x += Math.cos(hm) * d; y += Math.sin(hm) * d; h += dh; dist += d; push();
        }
        corners.push({ turn: seg.t, dir: seg.dir, start, end: dist, apex: (start + dist) / 2 });
      }
    }
    return { x, y, h, pts, corners, dist };
  };
  const base = run(0, 0, false);
  const a = run(1, 0, false);
  const b = run(0, 1, false);
  // endpoint is linear in (lenMain, lenBack): E = base + m*(a-base) + k*(b-base) = 0
  const ax = a.x - base.x, ay = a.y - base.y, bx = b.x - base.x, by = b.y - base.y;
  const det = ax * by - ay * bx;
  const m = (-base.x * by + base.y * bx) / det;
  const k = (-ax * base.y + ay * base.x) / det;
  const res = run(m, k, true);
  return { points: res.pts, corners: res.corners, length: res.dist, mainLen: m, backLen: k, closure: Math.hypot(res.x, res.y) };
}

/**
 * Elevation profile (metres) as a function of normalised lap distance u in [0,1).
 * Hungaroring sits in a valley: downhill into T1/T2, climb to the T4 crest,
 * undulating middle sector, gentle climb back to the start line.
 */
export function elevationAt(u) {
  const bumps = [
    // [centre u, width u, height m]
    [0.0, 0.10, 4.0],
    [0.16, 0.06, -5.5],
    [0.245, 0.05, -3.0],
    [0.36, 0.05, 5.5],
    [0.47, 0.06, 1.5],
    [0.62, 0.07, -3.5],
    [0.78, 0.06, -1.5],
    [0.95, 0.08, 2.5],
    [1.0, 0.10, 4.0],
    [-0.05, 0.08, 2.5],
  ];
  let h = 0;
  for (const [c, w, a] of bumps) {
    const d = (u - c) / w;
    h += a * Math.exp(-d * d);
  }
  return h;
}
