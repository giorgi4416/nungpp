// Headless physics test: drives the player car (Rapier ray-cast vehicle) around the
// Hungaroring with a simple autopilot and reports handling/lap metrics.
// Usage: node tools/sim-test.mjs [laps]
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { TrackGeometry } from '../src/track/TrackGeometry.js';
import { TerrainData } from '../src/scene/TerrainData.js';
import { computeBarrierLines, createTrackColliders } from '../src/track/TrackColliders.js';
import { VehiclePhysics } from '../src/vehicle/VehiclePhysics.js';

await RAPIER.init();
const t0 = performance.now();
const track = new TrackGeometry();
const terrain = new TerrainData(track);
const barriers = computeBarrierLines(track);
console.log('track+terrain build ms', (performance.now() - t0).toFixed(0));
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const DT = 1 / 120;
world.timestep = DT;
createTrackColliders(RAPIER, world, track, terrain, barriers);

const pos = new THREE.Vector3(), tan = new THREE.Vector3(), rgt = new THREE.Vector3();
function placeAt(s, lat) {
  track.sampleAt(s, lat, pos, tan, rgt);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(tan.x, 0, tan.z).normalize());
  return { p: pos.clone().add(new THREE.Vector3(0, 0.62, 0)), q };
}
const start = placeAt(track.length - 20, 0);
const car = new VehiclePhysics(RAPIER, world, { position: start.p, quaternion: start.q });
const proj = {};
car.setSurfaceSampler((x, z) => {
  track.project(x, z, proj.index ?? 0, proj);
  return track.surfaceAt(proj.index, proj.lateral);
});

const eq = new RAPIER.EventQueue(true);
let impacts = 0;
function step() {
  car.preStep(DT);
  world.step(eq);
  eq.drainContactForceEvents((e) => { if (e.totalForceMagnitude() > 20000) impacts++; });
  car.postStep(DT);
}

// --- 1. settle & straight line on main straight (s from L-20 forward is the straight) ---
for (let i = 0; i < 120; i++) step();
const tp = car.body.translation();
console.log('settled y', tp.y.toFixed(3), 'track h', track.heightAtS(track.length - 20).toFixed(3), 'susp', [0, 1, 2, 3].map((i) => car.wheelSuspension(i).toFixed(3)).join(','));

// --- 2. autopilot lap(s) ---
const laps = Number(process.argv[2] || 1);
const hp = {};
let t = 0, maxKmh = 0, t100 = null, offTime = 0, minUp = 1;
let lastS = null, dist = 0, lapStart = null, lapTimes = [];
let maxLatErr = 0; const offLog = [];
const target = new THREE.Vector3();
const skill = Number(process.argv[3] || 1.0);
const SIM_MAX = 400;
while (t < SIM_MAX && lapTimes.length < laps) {
  const b = car.body.translation();
  track.project(b.x, b.z, hp.index ?? 0, hp);
  const s = hp.s;
  if (lastS !== null) {
    let d = s - lastS;
    if (d < -track.length / 2) d += track.length;
    if (d > track.length / 2) d -= track.length;
    dist += d;
    if (lastS > track.length - 50 && s < 50) {
      if (lapStart !== null) lapTimes.push(t - lapStart);
      lapStart = t;
    }
  }
  lastS = s;
  const v = Math.max(0, car.speed);
  // pure pursuit toward racing line
  const look = 8 + v * 0.42;
  const lineOff = track.interp(track.lineOffset, s + look);
  track.sampleAt(s + look, lineOff, target);
  const r = car.body.rotation();
  const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const left = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const dx = target.x - b.x, dz = target.z - b.z;
  const lx = dx * left.x + dz * left.z, fx = dx * fwd.x + dz * fwd.z;
  const alpha = Math.atan2(lx, fx);
  const wantAngle = Math.atan2(2 * 3.6 * Math.sin(alpha), look);
  const steerLimit = THREE.MathUtils.lerp(0.36, 0.065, Math.min(1, Math.max(0, ((v * 3.6) / 260))) ** 2 * (3 - 2 * Math.min(1, (v * 3.6) / 260)));
  car.steer = THREE.MathUtils.clamp(wantAngle / Math.max(0.05, steerLimit), -1, 1);
  // speed control from profile (look ahead along braking distance)
  const vt = track.interp(track.speedProfile, s + 4 + v * 0.15) * skill;
  if (v < vt - 1) { car.throttle = 1; car.brake = 0; }
  else if (v > vt + 2) { car.throttle = 0; car.brake = Math.min(1, (v - vt) / 6); }
  else { car.throttle = 0.35; car.brake = 0; }
  step();
  t += DT;
  const kmh = car.speed * 3.6;
  maxKmh = Math.max(maxKmh, kmh);
  if (t100 === null && kmh >= 100) t100 = t;
  if (car.offTrack > 0) { if (!offLog.length || t - offLog[offLog.length-1].t > 2) offLog.push({ t: +t.toFixed(1), s: Math.round(s), v: Math.round(kmh), vt: Math.round(vt*3.6), lat: +hp.lateral.toFixed(1) }); offTime += DT; }
  minUp = Math.min(minUp, car.upright);
  maxLatErr = Math.max(maxLatErr, Math.abs(hp.lateral));
  if (Math.round(t / DT) % 1200 === 0) console.log(`t=${t.toFixed(0)}s s=${s.toFixed(0)} dist=${dist.toFixed(0)} v=${kmh.toFixed(0)}km/h gear=${car.gear} rpm=${car.rpm.toFixed(0)} lat=${hp.lateral.toFixed(1)} y=${b.y.toFixed(2)}`);
}
console.log('off-track events', JSON.stringify(offLog));
console.log({ lapTimes: lapTimes.map((x) => x.toFixed(2)), t100: t100?.toFixed(2), maxKmh: maxKmh.toFixed(0), offTime: offTime.toFixed(1), minUp: minUp.toFixed(3), impacts, maxLatErr: maxLatErr.toFixed(1), dist: dist.toFixed(0) });

// --- 3. braking test from current max on a fresh straight run ---
const bs = placeAt(track.length - 380, 0);
car.reset(bs.p, bs.q);
car.steer = 0;
for (let i = 0; i < 2400; i++) { // accelerate up to ~ 300 or end of straight
  const b = car.body.translation();
  track.project(b.x, b.z, hp.index ?? 0, hp);
  car.throttle = 1; car.brake = 0;
  car.steer = THREE.MathUtils.clamp(hp.lateral * 0.12, -1, 1);
  step();
  if (car.speed * 3.6 > 260) break;
}
const vStart = car.speed * 3.6;
const p0 = car.body.translation();
let bt = 0;
while (car.speed * 3.6 > 100 && bt < 10) { car.throttle = 0; car.brake = 1; step(); bt += DT; }
const p1 = car.body.translation();
console.log(`brake ${vStart.toFixed(0)}->100 km/h: ${bt.toFixed(2)}s over ${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1)}m`);
