// Headless checks for braking, brake-disc glow state and the manual gearbox:
//  1. grip never changes with driving style (no tyre temperature / wear / lock-up model)
//  2. braking 260 -> 100 km/h matches the original v1 figures (2.03 s, ~99 m)
//  3. brake discs heat with braking and cool afterwards (drives the visual glow only)
//  4. manual gearbox: limiter, upshifts, over-rev protection, gear limits
// Usage: node tools/brake-gearbox-test.mjs   (TRACK=monaco|spa|suzuka|hungaroring)
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { TrackGeometry } from '../src/track/TrackGeometry.js';
import { CIRCUITS } from '../src/track/circuits/index.js';
import { TerrainData } from '../src/scene/TerrainData.js';
import { computeBarrierLines, createTrackColliders } from '../src/track/TrackColliders.js';
import { VehiclePhysics } from '../src/vehicle/VehiclePhysics.js';

await RAPIER.init();
const def = CIRCUITS[process.env.TRACK || 'hungaroring'];
const track = new TrackGeometry(def);
const terrain = new TerrainData(track);
const barriers = computeBarrierLines(track);
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const DT = 1 / 120;
world.timestep = DT;
createTrackColliders(RAPIER, world, track, terrain, barriers);
const p = new THREE.Vector3(), t = new THREE.Vector3();
const place = (s, lat) => {
  track.sampleAt(s, lat, p, t);
  return { pos: p.clone().setY(p.y + 0.48), quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(t.x, 0, t.z).normalize()) };
};
const st = place(track.length - 380, 0);
const car = new VehiclePhysics(RAPIER, world, { position: st.pos, quaternion: st.quat });
car.resetThermals(def.ambient);
const sp = { index: undefined };
car.setSurfaceSampler((x, z) => { track.project(x, z, sp.index, sp); return track.surfaceAt(sp.index, sp.lateral); });
const step = () => { car.preStep(DT); world.step(); car.postStep(DT); };
let ok = true;
const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) ok = false; };
const grips = () => [0, 1, 2, 3].map((i) => car.vc.wheelFrictionSlip(i));

check(car.tyreTemp === undefined && car.tyreGrip === undefined && car.wheelLock === undefined, 'no tyre temperature, wear or lock-up state exists');

// 1. abuse: weave with full throttle & lock for 30 s, then compare grip on tarmac
const g0 = grips();
for (let i = 0; i < 120 * 30; i++) {
  if (i % (120 * 4) === 0) { const r = place(track.length - 600, 0); car.reset(r.pos, r.quat); }
  car.throttle = 1; car.brake = 0; car.steer = Math.sin(i * DT * 5) > 0 ? 1 : -1;
  step();
}
const r1 = place(track.length - 380, 0);
car.reset(r1.pos, r1.quat);
car.steer = 0; car.throttle = 0;
for (let i = 0; i < 60; i++) step();
const g1 = grips();
console.log('friction slip before', g0.map((x) => x.toFixed(2)).join('/'), 'after 30 s of abuse', g1.map((x) => x.toFixed(2)).join('/'));
check(g1.every((x, i) => Math.abs(x - g0[i]) < 1e-6), 'grip is identical after aggressive driving (no temperature-based grip loss)');

// 2. braking distance (same procedure as the v1 sim-test)
const hp = {};
for (let i = 0; i < 2400; i++) {
  const b = car.body.translation();
  track.project(b.x, b.z, hp.index ?? 0, hp);
  car.throttle = 1; car.brake = 0; car.steer = THREE.MathUtils.clamp(hp.lateral * 0.12, -1, 1);
  step();
  if (car.speed * 3.6 > 260) break;
}
const p0 = car.body.translation();
let bt = 0;
car.resetThermals(def.ambient);
while (car.speed * 3.6 > 100 && bt < 10) { car.throttle = 0; car.brake = 1; step(); bt += DT; }
const p1 = car.body.translation();
const dist = Math.hypot(p1.x - p0.x, p1.z - p0.z);
console.log(`brake 260->100 km/h: ${bt.toFixed(2)} s over ${dist.toFixed(1)} m (v1: 2.03 s, 99.4 m)`);
check(Math.abs(bt - 2.03) < 0.1 && Math.abs(dist - 99.4) < 5, 'braking matches the original behaviour');

// 3. brake glow state
const hot = car.brakeTemp.slice();
console.log('after the stop: discs', hot.map((x) => x.toFixed(0)).join('/'), 'C');
check(hot[0] > 450 && hot[0] > hot[2], 'discs heat under braking (fronts more than rears) -> visible glow');
for (let i = 0; i < 120 * 8; i++) { car.throttle = 0.6; car.brake = 0; step(); }
check(car.brakeTemp[0] < hot[0] - 150, 'discs cool down when the brakes are released');

// 4. manual gearbox
const ms = place(track.length - 450, 0);
car.reset(ms.pos, ms.quat);
car.transmission = 'manual';
for (let i = 0; i < 120 * 3; i++) { car.throttle = 1; car.brake = 0; car.steer = 0; step(); }
check(car.gear === 1 && car.limiter && car.speed * 3.6 < 90, `manual: holds 1st on the limiter (${(car.speed * 3.6).toFixed(0)} km/h)`);
let shifts = 0;
for (let g = 0; g < 6; g++) { if (car.shiftUp()) shifts++; for (let i = 0; i < 180; i++) { car.throttle = 1; step(); } }
check(shifts === 6 && car.gear === 7, 'manual: upshifts work');
let rejected = 0;
car.onShiftRejected = () => rejected++;
car.shiftDown();
check(rejected === 1, 'manual: an over-revving downshift is refused');
car.gear = car.spec.gears.length - 1;
check(!car.shiftUp(), 'manual: cannot shift beyond top gear');
console.log(ok ? '\nALL BRAKE/GEARBOX CHECKS PASSED' : '\nSOME CHECKS FAILED');
