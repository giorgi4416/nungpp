// Headless stress test: violent steering at speed, off-track excursions and barrier hits.
// Reports the minimum "upright" value (1 = flat, <0.2 = rolled over).
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { TrackGeometry } from '../src/track/TrackGeometry.js';
import { CIRCUITS } from '../src/track/circuits/index.js';
import { TerrainData } from '../src/scene/TerrainData.js';
import { computeBarrierLines, createTrackColliders } from '../src/track/TrackColliders.js';
import { VehiclePhysics } from '../src/vehicle/VehiclePhysics.js';

await RAPIER.init();
const track = new TrackGeometry(CIRCUITS[process.env.TRACK || 'hungaroring']);
const terrain = new TerrainData(track);
const barriers = computeBarrierLines(track);
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const DT = 1 / 120;
world.timestep = DT;
createTrackColliders(RAPIER, world, track, terrain, barriers);

const p = new THREE.Vector3(), t = new THREE.Vector3();
function place(s, lat) {
  track.sampleAt(s, lat, p, t);
  return { pos: p.clone().setY(p.y + 0.48), quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(t.x, 0, t.z).normalize()) };
}
const st = place(track.length - 380, 0);
const car = new VehiclePhysics(RAPIER, world, { position: st.pos, quaternion: st.quat });
const proj = { index: 0 };
car.setSurfaceSampler((x, z) => { track.project(x, z, proj.index, proj); return track.surfaceAt(proj.index, proj.lateral); });
const eq = new RAPIER.EventQueue(true);
let steer = 0;
function step(input) {
  const rate = input.steer === 0 || Math.sign(input.steer) !== Math.sign(steer) ? 7 : 4.2;
  steer += THREE.MathUtils.clamp(input.steer - steer, -rate * DT, rate * DT);
  car.steer = steer; car.throttle = input.throttle; car.brake = input.brake || 0;
  car.preStep(DT); world.step(eq); eq.drainContactForceEvents(() => {}); car.postStep(DT);
}
const report = (label, fn, seconds) => {
  let minUp = 1, maxLat = 0, maxY = -1e9, maxAng = 0;
  for (let i = 0; i < seconds / DT; i++) {
    fn(i * DT);
    minUp = Math.min(minUp, car.upright);
    const b = car.body.translation();
    const a = car.body.angvel();
    maxAng = Math.max(maxAng, Math.hypot(a.x, a.z));
    track.project(b.x, b.z, proj.index, proj);
    maxLat = Math.max(maxLat, Math.abs(proj.lateral));
    maxY = Math.max(maxY, b.y - proj.height);
  }
  console.log(label.padEnd(34), `minUp=${minUp.toFixed(3)} maxLat=${maxLat.toFixed(1)} maxHeightAboveTrack=${maxY.toFixed(2)} maxRollPitchRate=${maxAng.toFixed(2)} v=${(car.speed * 3.6).toFixed(0)}km/h`);
  return minUp;
};
const resetTo = (s, lat, kmh) => {
  const q = place(s, lat);
  car.reset(q.pos, q.quat);
  steer = 0;
  for (let i = 0; i < 60; i++) step({ steer: 0, throttle: 0 });
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q.quat).multiplyScalar(kmh / 3.6);
  car.body.setLinvel({ x: f.x, y: 0, z: f.z }, true);
};

let worst = 1;
resetTo(track.length - 400, 0, 210);
worst = Math.min(worst, report('slalom L/R at 210', (tt) => step({ steer: tt < 0.75 ? 1 : tt < 1.5 ? -1 : 0, throttle: 1 }), 6));
resetTo(track.length - 400, 0, 250);
worst = Math.min(worst, report('full lock left 250 into grass', () => step({ steer: 1, throttle: 1 }), 5));
resetTo(track.length - 400, 0, 300);
worst = Math.min(worst, report('full lock right 300 (pit wall)', () => step({ steer: -1, throttle: 1 }), 4));
resetTo(400, 0, 300);
worst = Math.min(worst, report('T1 no braking at 300', () => step({ steer: 0, throttle: 1 }), 6));
const c5 = track.corners.find((c) => c.turn === 5);
resetTo(c5.start - 120, 0, 220);
worst = Math.min(worst, report('T5 too fast into gravel', () => step({ steer: 0, throttle: 1 }), 6));
resetTo(1300, 0, 280);
worst = Math.min(worst, report('back straight weave', (tt) => step({ steer: Math.sin(tt * 4) > 0 ? 1 : -1, throttle: 1 }), 6));
console.log('WORST upright', worst.toFixed(3), worst > 0.5 ? 'OK' : 'ROLLOVER RISK');
