/**
 * Terrain height field (pure data). The circuit sits in a shallow valley:
 * flat run-off around the track, gentle infield mounds and hills rising
 * toward the horizon, as at the real Hungaroring near Mogyoród.
 */

export function hash2(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x, z, oct = 4) {
  let sum = 0, amp = 1, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += (valueNoise(x * f, z * f) * 2 - 1) * amp;
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return sum / norm;
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class TerrainData {
  constructor(track, { size = 3000, res = 240 } = {}) {
    this.track = track;
    const b = track.bounds;
    this.cx = (b.minX + b.maxX) / 2;
    this.cz = (b.minZ + b.maxZ) / 2;
    this.size = size;
    this.res = res; // cells per side
    this.cellSize = size / res;
    this.x0 = this.cx - size / 2;
    this.z0 = this.cz - size / 2;
    // coarse track samples for smooth height blending
    const step = 5;
    this.coarse = [];
    for (let i = 0; i < track.count; i += step) this.coarse.push(i);
    this.heights = new Float32Array((res + 1) * (res + 1));
    this.trackDist = new Float32Array((res + 1) * (res + 1));
    this._build();
  }

  _natural(x, z) {
    const b = this.track.bounds;
    // distance outside the track's bounding box (hills rise beyond the circuit)
    const dx = Math.max(b.minX - 120 - x, 0, x - b.maxX - 120);
    const dz = Math.max(b.minZ - 120 - z, 0, z - b.maxZ - 120);
    const out = Math.hypot(dx, dz);
    const rim = smoothstep(0, 700, out) * 70 + smoothstep(0, 180, out) * 10;
    const n = fbm(x * 0.0035, z * 0.0035, 4);
    const n2 = fbm(x * 0.012 + 40, z * 0.012 - 13, 3);
    return rim * (0.75 + 0.5 * n) + n * 9 + n2 * 2.5 + 1.5;
  }

  /** Full-quality height evaluation at an arbitrary point (used at build time). */
  evaluate(x, z) {
    const T = this.track;
    const nearest = T.nearestIndex(x, z, 420);
    if (nearest < 0) return { h: this._natural(x, z), d: 999 };
    const px = T.pos[nearest * 3], pz = T.pos[nearest * 3 + 2];
    const d = Math.hypot(x - px, z - pz);
    const th = T.pos[nearest * 3 + 1];
    // lateral side & flat band width from run-off widths
    const lat = (x - px) * T.right[nearest * 3] + (z - pz) * T.right[nearest * 3 + 2];
    const s = nearest * T.ds;
    const pitStraight = s < 320 || s > T.length - 450;
    let flat = T.halfWidth + (lat > 0 ? T.runoffR[nearest] : T.runoffL[nearest]) + 7;
    if (pitStraight && lat > 0) flat = 62; // pit lane & paddock plateau
    if (pitStraight && lat < 0) flat = Math.max(flat, 24);
    if (d < flat) return { h: th - 0.06, d };
    // smooth blended track height from nearby coarse samples
    let ws = 0, hs = 0;
    for (const i of this.coarse) {
      const ex = T.pos[i * 3] - x, ez = T.pos[i * 3 + 2] - z;
      const dd = ex * ex + ez * ez;
      if (dd > 200 * 200) continue;
      const w = Math.exp(-dd / (2 * 60 * 60));
      ws += w; hs += w * T.pos[i * 3 + 1];
    }
    const hBlend = ws > 1e-6 ? hs / ws : th;
    const t1 = smoothstep(flat, flat + 30, d);
    const near = th + (hBlend - th) * t1;
    const t2 = smoothstep(flat + 10, flat + 130, d);
    const nat = this._natural(x, z) + hBlend;
    return { h: near + (nat - near) * t2 - 0.06, d };
  }

  _build() {
    const r = this.res;
    for (let j = 0; j <= r; j++) {
      for (let i = 0; i <= r; i++) {
        const x = this.x0 + i * this.cellSize, z = this.z0 + j * this.cellSize;
        const e = this.evaluate(x, z);
        this.heights[j * (r + 1) + i] = e.h;
        this.trackDist[j * (r + 1) + i] = e.d;
      }
    }
  }

  /** Bilinear height lookup (fast, runtime). Matches the rendered/collision mesh. */
  heightAt(x, z) {
    const r = this.res;
    let fx = (x - this.x0) / this.cellSize, fz = (z - this.z0) / this.cellSize;
    fx = Math.min(r - 1e-4, Math.max(0, fx)); fz = Math.min(r - 1e-4, Math.max(0, fz));
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const H = this.heights, w = r + 1;
    // match triangle split used in the mesh (diagonal from (i,j+1) to (i+1,j))
    const h00 = H[j * w + i], h10 = H[j * w + i + 1], h01 = H[(j + 1) * w + i], h11 = H[(j + 1) * w + i + 1];
    if (tx + tz <= 1) return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  }

  /** Approximate distance to the track centreline (bilinear on the grid). */
  trackDistanceAt(x, z) {
    const r = this.res;
    const fx = Math.min(r - 1e-4, Math.max(0, (x - this.x0) / this.cellSize));
    const fz = Math.min(r - 1e-4, Math.max(0, (z - this.z0) / this.cellSize));
    const i = Math.floor(fx), j = Math.floor(fz);
    return this.trackDist[j * (r + 1) + i];
  }

  /** Positions + indices for mesh / trimesh collider. */
  buildMeshData() {
    const r = this.res, w = r + 1;
    const positions = new Float32Array(w * w * 3);
    for (let j = 0; j <= r; j++) for (let i = 0; i <= r; i++) {
      const k = j * w + i;
      positions[k * 3] = this.x0 + i * this.cellSize;
      positions[k * 3 + 1] = this.heights[k];
      positions[k * 3 + 2] = this.z0 + j * this.cellSize;
    }
    const indices = new Uint32Array(r * r * 6);
    let p = 0;
    for (let j = 0; j < r; j++) for (let i = 0; i < r; i++) {
      const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
      // CCW when viewed from above (+Y): a, c, b and b, c, d
      indices[p++] = a; indices[p++] = c; indices[p++] = b;
      indices[p++] = b; indices[p++] = c; indices[p++] = d;
    }
    return { positions, indices };
  }
}
