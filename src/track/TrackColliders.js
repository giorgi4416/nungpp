import { KERB_WIDTH, smoothCircular } from './TrackGeometry.js';

/**
 * Barrier lines + Rapier colliders for the circuit (pure data, works in Node).
 */

export const BARRIER_HEIGHT = 1.1;

/** Barrier polylines (left/right) as Float32Array xyz per track sample + offsets. */
export function computeBarrierLines(track) {
  const N = track.count;
  const offL = new Float32Array(N), offR = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let l = track.halfWidth + track.runoffL[i];
    let r = track.halfWidth + track.runoffR[i];
    // keep the inside barrier of tight corners from folding over itself
    const k = track.curv[i]; // + = left turn -> inside is left
    let kMax = 0;
    for (let q = -8; q <= 8; q++) kMax = Math.max(kMax, Math.abs(track.curv[(i + q + N) % N]));
    const maxInside = kMax > 1e-4 ? 0.8 / kMax : 1e9;
    if (k > 0) l = Math.min(l, Math.max(track.halfWidth + KERB_WIDTH + 2, maxInside));
    else r = Math.min(r, Math.max(track.halfWidth + KERB_WIDTH + 2, maxInside));
    offL[i] = l; offR[i] = r;
  }
  const sl = smoothCircular(offL, 6), sr = smoothCircular(offR, 6);
  const left = new Float32Array(N * 3), right = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const px = track.pos[i * 3], py = track.pos[i * 3 + 1], pz = track.pos[i * 3 + 2];
    const rx = track.right[i * 3], rz = track.right[i * 3 + 2];
    left[i * 3] = px - rx * sl[i]; left[i * 3 + 1] = py; left[i * 3 + 2] = pz - rz * sl[i];
    right[i * 3] = px + rx * sr[i]; right[i * 3 + 1] = py; right[i * 3 + 2] = pz + rz * sr[i];
  }
  return { left, right, offL: sl, offR: sr };
}

/** Flat ribbon (road + kerbs + verge) as collider/visual base data. */
export function buildRibbon(track, inner, outer, yOff = 0) {
  const N = track.count;
  const positions = new Float32Array(N * 2 * 3);
  for (let i = 0; i < N; i++) {
    const px = track.pos[i * 3], py = track.pos[i * 3 + 1] + yOff, pz = track.pos[i * 3 + 2];
    const rx = track.right[i * 3], rz = track.right[i * 3 + 2];
    positions[i * 6] = px + rx * inner; positions[i * 6 + 1] = py; positions[i * 6 + 2] = pz + rz * inner;
    positions[i * 6 + 3] = px + rx * outer; positions[i * 6 + 4] = py; positions[i * 6 + 5] = pz + rz * outer;
  }
  const indices = new Uint32Array(N * 6);
  for (let i = 0; i < N; i++) {
    const a = i * 2, b = a + 1, c = ((i + 1) % N) * 2, d = c + 1;
    indices[i * 6] = a; indices[i * 6 + 1] = b; indices[i * 6 + 2] = c;
    indices[i * 6 + 3] = b; indices[i * 6 + 4] = d; indices[i * 6 + 5] = c;
  }
  return { positions, indices };
}

function wallMesh(line, N, height) {
  const positions = new Float32Array(N * 2 * 3);
  for (let i = 0; i < N; i++) {
    positions[i * 6] = line[i * 3]; positions[i * 6 + 1] = line[i * 3 + 1] - 1.5; positions[i * 6 + 2] = line[i * 3 + 2];
    positions[i * 6 + 3] = line[i * 3]; positions[i * 6 + 4] = line[i * 3 + 1] + height; positions[i * 6 + 5] = line[i * 3 + 2];
  }
  const indices = new Uint32Array(N * 6);
  for (let i = 0; i < N; i++) {
    const a = i * 2, b = a + 1, c = ((i + 1) % N) * 2, d = c + 1;
    indices.set([a, c, b, b, c, d], i * 6);
  }
  return { positions, indices };
}

/** Create all static colliders for the circuit. */
export function createTrackColliders(RAPIER, world, track, terrain, barriers) {
  const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const out = { body: fixed };
  // racing surface incl. kerbs & verge
  const road = buildRibbon(track, -(track.halfWidth + KERB_WIDTH + 1.2), track.halfWidth + KERB_WIDTH + 1.2, 0);
  out.road = world.createCollider(RAPIER.ColliderDesc.trimesh(road.positions, road.indices).setFriction(1.0), fixed);
  // terrain
  const t = terrain.buildMeshData();
  out.terrain = world.createCollider(RAPIER.ColliderDesc.trimesh(t.positions, t.indices).setFriction(0.8), fixed);
  // barriers
  const N = track.count;
  for (const line of [barriers.left, barriers.right]) {
    const w = wallMesh(line, N, BARRIER_HEIGHT + 0.4);
    world.createCollider(RAPIER.ColliderDesc.trimesh(w.positions, w.indices).setFriction(0.1).setRestitution(0.2), fixed);
  }
  return out;
}
