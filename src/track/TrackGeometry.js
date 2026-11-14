import * as THREE from 'three';
import { integrateLayout, elevationAt, TRACK_LENGTH } from './HungaroringLayout.js';

/**
 * Pure track data (no rendering, no DOM): centreline spline, per-sample frames,
 * curvature, runoff/barrier widths, kerbs, gravel, racing line and speed profile.
 * Used by rendering, physics, AI, lap timing and the minimap.
 */

export const TRACK_HALF_WIDTH = 6.75; // 13.5 m wide
export const KERB_WIDTH = 1.4;
export const SAMPLE_SPACING = 2; // metres
const START_OFFSET = 330; // start line distance into the main straight

const UP = new THREE.Vector3(0, 1, 0);

export class TrackGeometry {
  constructor() {
    this.halfWidth = TRACK_HALF_WIDTH;
    this._buildCentreline();
    this._buildFrames();
    this._buildSpatialHash();
    this._buildRunoff();
    this._buildRacingLine();
    this._buildSpeedProfile();
  }

  _buildCentreline() {
    const layout = integrateLayout(undefined, 1);
    const scale = TRACK_LENGTH / layout.length;
    const raw = layout.points.map(([x, y]) => [x * scale, y * scale]);
    const n = raw.length;
    // rotate so that index 0 is the start line (START_OFFSET into the main straight).
    // integration begins at the start of the main straight, i.e. the point list index 0.
    const shift = Math.round(START_OFFSET / (layout.length * scale / n));
    const pts = [];
    for (let i = 0; i < n; i++) pts.push(raw[(i + shift) % n]);
    // centre on origin
    let cx = 0, cy = 0;
    for (const [x, y] of pts) { cx += x; cy += y; }
    cx /= n; cy /= n;
    // control points every ~14 m -> CatmullRomCurve3 (closed)
    const step = 14;
    const ctrl = [];
    const cn = Math.round(n / step);
    for (let i = 0; i < cn; i++) {
      const k = Math.floor((i * n) / cn);
      const [x, y] = pts[k];
      ctrl.push(new THREE.Vector3(x - cx, elevationAt(k / n), -(y - cy)));
    }
    this.controlPoints = ctrl;
    this.curve = new THREE.CatmullRomCurve3(ctrl, true, 'centripetal');
    this.length = this.curve.getLength();
    this.count = Math.round(this.length / SAMPLE_SPACING);
    this.ds = this.length / this.count;
    // corner apex locations in game distance
    const L = layout.length * scale;
    this.corners = layout.corners.map((c) => {
      const toGame = (d) => ((((d * scale) - START_OFFSET) % L) + L) % L * (this.length / L);
      return { turn: c.turn, dir: c.dir, start: toGame(c.start), end: toGame(c.end), apex: toGame(c.apex) };
    });
  }

  _buildFrames() {
    const N = this.count;
    const pts = this.curve.getSpacedPoints(N); // N+1 points, last == first
    pts.length = N;
    this.pos = new Float32Array(N * 3);
    this.tan = new Float32Array(N * 3);
    this.right = new Float32Array(N * 3);
    this.curv = new Float32Array(N); // signed curvature, + = left turn
    this.slope = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      this.pos[i * 3] = pts[i].x; this.pos[i * 3 + 1] = pts[i].y; this.pos[i * 3 + 2] = pts[i].z;
    }
    const t = new THREE.Vector3(), r = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      t.set(this.pos[b * 3] - this.pos[a * 3], this.pos[b * 3 + 1] - this.pos[a * 3 + 1], this.pos[b * 3 + 2] - this.pos[a * 3 + 2]).normalize();
      this.tan[i * 3] = t.x; this.tan[i * 3 + 1] = t.y; this.tan[i * 3 + 2] = t.z;
      r.set(-t.z, 0, t.x).normalize(); // right = tangent x up
      this.right[i * 3] = r.x; this.right[i * 3 + 1] = 0; this.right[i * 3 + 2] = r.z;
      this.slope[i] = t.y;
    }
    // curvature from heading change over +-3 samples, smoothed
    const raw = new Float32Array(N);
    const K = 3;
    for (let i = 0; i < N; i++) {
      const a = (i - K + N) % N, b = (i + K) % N;
      const ha = Math.atan2(this.tan[a * 3 + 2], this.tan[a * 3]);
      const hb = Math.atan2(this.tan[b * 3 + 2], this.tan[b * 3]);
      let d = hb - ha;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      // heading measured in x/z plane: positive atan2(z,x) change = turning toward +z = right turn
      raw[i] = -d / (2 * K * this.ds);
    }
    this.curv = smoothCircular(raw, 4);
  }

  _buildSpatialHash() {
    this.cell = 25;
    this.hash = new Map();
    for (let i = 0; i < this.count; i++) {
      const key = this._key(this.pos[i * 3], this.pos[i * 3 + 2]);
      let arr = this.hash.get(key);
      if (!arr) this.hash.set(key, (arr = []));
      arr.push(i);
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < this.count; i++) {
      minX = Math.min(minX, this.pos[i * 3]); maxX = Math.max(maxX, this.pos[i * 3]);
      minZ = Math.min(minZ, this.pos[i * 3 + 2]); maxZ = Math.max(maxZ, this.pos[i * 3 + 2]);
    }
    this.bounds = { minX, maxX, minZ, maxZ };
  }

  _key(x, z) {
    return (Math.floor(x / this.cell) + 1000) * 4096 + (Math.floor(z / this.cell) + 1000);
  }

  /** Nearest centreline sample to (x,z) within maxR metres (global search). Returns index or -1. */
  nearestIndex(x, z, maxR = 400, excludeNear = -1, excludeRange = 0) {
    const c = this.cell;
    const cx = Math.floor(x / c), cz = Math.floor(z / c);
    let best = -1, bestD = maxR * maxR;
    const rings = Math.ceil(maxR / c);
    for (let ring = 0; ring <= rings; ring++) {
      for (let ix = cx - ring; ix <= cx + ring; ix++) {
        for (let iz = cz - ring; iz <= cz + ring; iz++) {
          if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== ring) continue;
          const arr = this.hash.get((ix + 1000) * 4096 + (iz + 1000));
          if (!arr) continue;
          for (const i of arr) {
            if (excludeNear >= 0) {
              let di = Math.abs(i - excludeNear);
              di = Math.min(di, this.count - di);
              if (di < excludeRange) continue;
            }
            const dx = this.pos[i * 3] - x, dz = this.pos[i * 3 + 2] - z;
            const d = dx * dx + dz * dz;
            if (d < bestD) { bestD = d; best = i; }
          }
        }
      }
      // once found, one more ring is enough to guarantee the nearest
      if (best >= 0 && (ring * c) ** 2 > bestD + c * c * 2) break;
    }
    return best;
  }

  /**
   * Project a world position onto the centreline. `hint` (previous index) enables a fast
   * local search; falls back to a global search when the local result is far away.
   * Writes into `out` {index, s, lateral, dist, height}.
   */
  project(x, z, hint, out = {}) {
    const N = this.count;
    let best = -1, bestD = Infinity;
    if (hint !== undefined && hint >= 0) {
      for (let k = -40; k <= 40; k++) {
        const i = (hint + k + N) % N;
        const dx = this.pos[i * 3] - x, dz = this.pos[i * 3 + 2] - z;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    if (best < 0 || bestD > 30 * 30) {
      const g = this.nearestIndex(x, z, 600);
      if (g >= 0) best = g;
      if (best < 0) best = 0;
    }
    // refine on segment best -> best+1 or best-1 -> best
    const i0 = best, i1 = (best + 1) % N, im = (best - 1 + N) % N;
    let t = this._segT(i0, i1, x, z);
    let a = i0, b = i1;
    if (t < 0) { a = im; b = i0; t = this._segT(im, i0, x, z); }
    t = Math.min(1, Math.max(0, t));
    const px = this.pos[a * 3] + (this.pos[b * 3] - this.pos[a * 3]) * t;
    const pz = this.pos[a * 3 + 2] + (this.pos[b * 3 + 2] - this.pos[a * 3 + 2]) * t;
    const rx = this.right[a * 3], rz = this.right[a * 3 + 2];
    out.index = best;
    let s = (a + t) * this.ds;
    if (s >= this.length) s -= this.length;
    out.s = s;
    out.lateral = (x - px) * rx + (z - pz) * rz;
    out.dist = Math.hypot(x - px, z - pz);
    out.height = this.pos[a * 3 + 1] + (this.pos[b * 3 + 1] - this.pos[a * 3 + 1]) * t;
    return out;
  }

  _segT(a, b, x, z) {
    const ax = this.pos[a * 3], az = this.pos[a * 3 + 2];
    const dx = this.pos[b * 3] - ax, dz = this.pos[b * 3 + 2] - az;
    return ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz);
  }

  wrapS(s) {
    s %= this.length;
    return s < 0 ? s + this.length : s;
  }

  /** Interpolated sample at distance s. Writes position (with lateral offset), tangent, right. */
  sampleAt(s, lateral = 0, outPos, outTan, outRight) {
    s = this.wrapS(s);
    const f = s / this.ds;
    const a = Math.floor(f) % this.count, b = (a + 1) % this.count, t = f - Math.floor(f);
    const P = this.pos, T = this.tan, R = this.right;
    const rx = R[a * 3] + (R[b * 3] - R[a * 3]) * t, rz = R[a * 3 + 2] + (R[b * 3 + 2] - R[a * 3 + 2]) * t;
    if (outPos) outPos.set(
      P[a * 3] + (P[b * 3] - P[a * 3]) * t + rx * lateral,
      P[a * 3 + 1] + (P[b * 3 + 1] - P[a * 3 + 1]) * t,
      P[a * 3 + 2] + (P[b * 3 + 2] - P[a * 3 + 2]) * t + rz * lateral,
    );
    if (outTan) outTan.set(T[a * 3] + (T[b * 3] - T[a * 3]) * t, T[a * 3 + 1] + (T[b * 3 + 1] - T[a * 3 + 1]) * t, T[a * 3 + 2] + (T[b * 3 + 2] - T[a * 3 + 2]) * t).normalize();
    if (outRight) outRight.set(rx, 0, rz).normalize();
  }

  interp(arr, s) {
    s = this.wrapS(s);
    const f = s / this.ds;
    const a = Math.floor(f) % this.count, b = (a + 1) % this.count, t = f - Math.floor(f);
    return arr[a] + (arr[b] - arr[a]) * t;
  }

  heightAtS(s) {
    s = this.wrapS(s);
    const f = s / this.ds;
    const a = Math.floor(f) % this.count, b = (a + 1) % this.count, t = f - Math.floor(f);
    return this.pos[a * 3 + 1] + (this.pos[b * 3 + 1] - this.pos[a * 3 + 1]) * t;
  }

  _buildRunoff() {
    const N = this.count;
    // clearance to other parts of the circuit (samples > 160 m away along the track)
    const clear = new Float32Array(N);
    const excl = Math.round(160 / this.ds);
    for (let i = 0; i < N; i++) {
      const j = this.nearestIndex(this.pos[i * 3], this.pos[i * 3 + 2], 260, i, excl);
      clear[i] = j < 0 ? 260 : Math.hypot(this.pos[j * 3] - this.pos[i * 3], this.pos[j * 3 + 2] - this.pos[i * 3 + 2]);
    }
    this.clearance = clear;
    // corner-ness, looking ahead (runoff is needed at the outside of corners and braking zones)
    const absK = new Float32Array(N);
    for (let i = 0; i < N; i++) absK[i] = Math.abs(this.curv[i]);
    const left = new Float32Array(N), right = new Float32Array(N);
    const kerbL = new Uint8Array(N), kerbR = new Uint8Array(N);
    const gravelL = new Uint8Array(N), gravelR = new Uint8Array(N);
    const look = Math.round(40 / this.ds);
    for (let i = 0; i < N; i++) {
      // max signed curvature in a window around i (biased ahead)
      let kMax = 0;
      for (let k = -look; k <= look * 2; k++) {
        const c = this.curv[(i + k + N) % N];
        if (Math.abs(c) > Math.abs(kMax)) kMax = c;
      }
      const corner = Math.min(1, Math.abs(kMax) * 60);
      // outside of a left turn is the right side
      const outsideRight = kMax > 0;
      const base = 11, extra = 20 * corner;
      left[i] = base + (outsideRight ? extra * 0.25 : extra);
      right[i] = base + (outsideRight ? extra : extra * 0.25);
      // kerbs where the corner is meaningful
      const kHere = Math.abs(this.curv[i]);
      let kNear = 0;
      for (let k = -6; k <= 6; k++) kNear = Math.max(kNear, Math.abs(this.curv[(i + k + N) % N]));
      if (kNear > 1 / 220) { kerbL[i] = 1; kerbR[i] = 1; }
      if (kHere > 1 / 90 || corner > 0.75) {
        if (outsideRight) gravelR[i] = 1; else gravelL[i] = 1;
      }
    }
    // limit by clearance (barriers of neighbouring track sections must not cross)
    for (let i = 0; i < N; i++) {
      const lim = Math.max(4, clear[i] / 2 - this.halfWidth - 6);
      left[i] = Math.min(left[i], lim);
      right[i] = Math.min(right[i], lim);
    }
    // pit straight: right side holds the pit wall close to the track
    for (let i = 0; i < N; i++) {
      const s = i * this.ds;
      const d = Math.min(s, this.length - s);
      const onPitStraight = s < 300 || s > this.length - 420;
      if (onPitStraight) { right[i] = 4.5; gravelR[i] = 0; gravelL[i] = 0; }
      if (d < 600) kerbL[i] = kerbL[i];
    }
    this.runoffL = smoothCircular(left, 10);
    this.runoffR = smoothCircular(right, 10);
    for (let i = 0; i < N; i++) {
      const s = i * this.ds;
      if (s < 300 || s > this.length - 420) this.runoffR[i] = 4.5;
    }
    this.kerbL = dilate(kerbL, 5);
    this.kerbR = dilate(kerbR, 5);
    this.gravelL = dilate(gravelL, 12);
    this.gravelR = dilate(gravelR, 12);
  }

  /** Surface type at sample index and lateral offset (metres, + = right). */
  surfaceAt(index, lateral) {
    const a = Math.abs(lateral);
    if (a <= this.halfWidth) return 0; // road
    const right = lateral > 0;
    const kerb = right ? this.kerbR[index] : this.kerbL[index];
    if (a <= this.halfWidth + KERB_WIDTH && kerb) return 1; // kerb
    if (a <= this.halfWidth + 2.0) return 2; // run-off verge / tarmac strip
    const gravel = right ? this.gravelR[index] : this.gravelL[index];
    if (gravel && a > this.halfWidth + 4) return 4;
    return 3; // grass
  }

  _buildRacingLine() {
    const N = this.count;
    const off = new Float32Array(N);
    const lim = this.halfWidth - 1.7;
    const P = this.pos, R = this.right;
    const px = new Float32Array(N), pz = new Float32Array(N);
    const update = () => {
      for (let i = 0; i < N; i++) {
        px[i] = P[i * 3] + R[i * 3] * off[i];
        pz[i] = P[i * 3 + 2] + R[i * 3 + 2] * off[i];
      }
    };
    for (const k of [24, 16, 10, 6, 4, 2, 1]) {
      const iters = 140;
      for (let it = 0; it < iters; it++) {
        update();
        for (let i = 0; i < N; i++) {
          const a = (i - k + N) % N, b = (i + k) % N;
          const mx = (px[a] + px[b]) * 0.5, mz = (pz[a] + pz[b]) * 0.5;
          const d = (mx - px[i]) * R[i * 3] + (mz - pz[i]) * R[i * 3 + 2];
          off[i] = Math.max(-lim, Math.min(lim, off[i] + d * 0.6));
        }
      }
    }
    this.lineOffset = smoothCircular(off, 3);
    // racing line curvature
    update();
    const kLine = new Float32Array(N);
    const K = 4;
    for (let i = 0; i < N; i++) {
      const a = (i - K + N) % N, b = (i + K) % N;
      const ax = px[i] - px[a], az = pz[i] - pz[a];
      const bx = px[b] - px[i], bz = pz[b] - pz[i];
      const cross = ax * bz - az * bx;
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
      const lc = Math.hypot(px[b] - px[a], pz[b] - pz[a]);
      kLine[i] = (2 * cross) / (la * lb * lc + 1e-6);
    }
    this.lineCurv = smoothCircular(kLine, 3);
  }

  /** Speed profile along the racing line (m/s) for a reference grip level. */
  _buildSpeedProfile() {
    this.speedProfile = this.computeSpeedProfile({ gripBase: 15.5, gripAero: 0.0026, vMax: 90, brake: 15, brakeAero: 0.0032, accel: 11 });
  }

  computeSpeedProfile({ gripBase, gripAero, vMax, brake, brakeAero, accel }) {
    const N = this.count, ds = this.ds;
    const v = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const k = Math.abs(this.lineCurv[i]);
      const den = k - gripAero;
      v[i] = den <= 0 ? vMax : Math.min(vMax, Math.sqrt(gripBase / den));
    }
    // two laps of passes to propagate across the wrap
    for (let pass = 0; pass < 2; pass++) {
      // braking: backward pass
      for (let j = 2 * N - 1; j >= 0; j--) {
        const i = j % N, n = (i + 1) % N;
        const vn = v[n];
        const dec = brake + brakeAero * vn * vn;
        const lim = Math.sqrt(vn * vn + 2 * dec * ds);
        if (v[i] > lim) v[i] = lim;
      }
      // acceleration: forward pass
      for (let j = 0; j < 2 * N; j++) {
        const i = j % N, p = (i - 1 + N) % N;
        const vp = v[p];
        const a = accel * Math.max(0.15, 1 - (vp / vMax) ** 2);
        const lim = Math.sqrt(vp * vp + 2 * a * ds);
        if (v[i] > lim) v[i] = lim;
      }
    }
    return v;
  }
}

export function smoothCircular(arr, radius) {
  const N = arr.length;
  const out = new Float32Array(N);
  const w = radius * 2 + 1;
  let sum = 0;
  for (let k = -radius; k <= radius; k++) sum += arr[(k + N) % N];
  for (let i = 0; i < N; i++) {
    out[i] = sum / w;
    sum += arr[(i + radius + 1) % N] - arr[(i - radius + N) % N];
  }
  return out;
}

function dilate(arr, r) {
  const N = arr.length;
  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!arr[i]) continue;
    for (let k = -r; k <= r; k++) out[(i + k + N) % N] = 1;
  }
  return out;
}

export { UP };
