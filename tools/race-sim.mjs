// Headless multi-seed race simulation: player car (Rapier) + 4 AI (kinematic) on the real circuit.
// The player follows the racing line but randomly swerves into traffic and brake-checks,
// to stress car-to-car contact. Reports rollovers, max tilt and lap completion per seed.
// Usage: node tools/race-sim.mjs [seeds=6] [seconds=200]
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { TrackGeometry } from '../src/track/TrackGeometry.js';
import { CIRCUITS } from '../src/track/circuits/index.js';
import { TerrainData } from '../src/scene/TerrainData.js';
import { computeBarrierLines, createTrackColliders } from '../src/track/TrackColliders.js';
import { VehiclePhysics } from '../src/vehicle/VehiclePhysics.js';
import { CarController } from '../src/vehicle/CarController.js';
import { AIDriver } from '../src/ai/AIDriver.js';

const SEEDS = Number(process.argv[2] || 6);
const SECONDS = Number(process.argv[3] || 200);
await RAPIER.init();
const track = new TrackGeometry(CIRCUITS[process.env.TRACK || 'hungaroring']);
const terrain = new TerrainData(track);
const barriers = computeBarrierLines(track);
const DT = 1 / 120;
const L = track.length;
const ROSTER = [
  { name: 'VAR', skill: 0.975, aggression: 0.75, launch: 0.22 },
  { name: 'FON', skill: 0.958, aggression: 0.55, launch: 0.3 },
  { name: 'BRA', skill: 0.944, aggression: 0.6, launch: 0.38 },
  { name: 'OKA', skill: 0.93, aggression: 0.85, launch: 0.26 },
];

function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const results = [];
for (let seed = 1; seed <= SEEDS; seed++) {
  Math.random = seeded(seed * 7919);
  const rnd = seeded(seed * 104729);
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  createTrackColliders(RAPIER, world, track, terrain, barriers);
  const slots = [0, 1, 2, 3, 4].map((k) => ({ s: L - 10 - k * 8.5, lateral: k % 2 === 0 ? -2.8 : 2.8 }));
  const p = new THREE.Vector3(), t = new THREE.Vector3();
  track.sampleAt(slots[4].s, slots[4].lateral, p, t);
  const car = new VehiclePhysics(RAPIER, world, { position: p.clone().setY(p.y + 0.48), quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(t.x, 0, t.z).normalize()) });
  const sp = { index: undefined };
  car.setSurfaceSampler((x, z) => { track.project(x, z, sp.index, sp); return track.surfaceAt(sp.index, sp.lateral); });
  const ctrl = new CarController({ steer: 0, throttle: 0, brake: 0 }, car, track);
  ctrl.autopilot = true;
  ctrl.autopilotPace = 0.97 + rnd() * 0.04;
  const ais = ROSTER.map((r, i) => {
    const d = new AIDriver(RAPIER, world, track, { setVisible() {} }, r);
    d.difficulty = 0.965;
    d.place(slots[i].s - L, slots[i].lateral);
    d.release(r.launch + Math.random() * 0.15);
    return d;
  });
  const proj = { index: undefined };
  const eq = new RAPIER.EventQueue(true);
  let minUp = 1, bigTilts = 0, impacts = 0, dist = 0, lastS = null, swerve = 0, swerveDir = 0, brakeCheck = 0;
  const list = [];
  for (let step = 0; step < SECONDS / DT; step++) {
    const time = step * DT;
    // chaotic human inputs layered over the autopilot
    if (swerve <= 0 && rnd() < DT / 5) { swerve = 0.4 + rnd() * 0.5; swerveDir = rnd() < 0.5 ? -1 : 1; }
    if (brakeCheck <= 0 && rnd() < DT / 12) brakeCheck = 0.5 + rnd() * 0.6;
    ctrl.update(DT, true);
    if (swerve > 0) { swerve -= DT; car.steer = swerveDir; }
    if (brakeCheck > 0) { brakeCheck -= DT; car.throttle = 0; car.brake = 1; }
    car.locked = false;
    car.preStep(DT);
    list.length = 0;
    for (const d of ais) list.push({ ref: d, s: d.wrappedS, lateral: d.lateral, speed: d.speed, isPlayer: false });
    list.push({ ref: null, s: proj.s ?? slots[4].s, lateral: proj.lateral ?? slots[4].lateral, speed: car.speed, isPlayer: true });
    for (const d of ais) d.fixedUpdate(DT, list);
    world.step(eq);
    eq.drainContactForceEvents((e) => { if (e.totalForceMagnitude() > 14000) impacts++; });
    car.postStep(DT);
    const b = car.currPos;
    track.project(b.x, b.z, proj.index, proj);
    if (lastS !== null) { let d = proj.s - lastS; if (d < -L / 2) d += L; if (d > L / 2) d -= L; dist += d; }
    lastS = proj.s;
    if (car.upright < minUp) minUp = car.upright;
    if (car.upright < 0.85) bigTilts++;
    // like the game: auto-recover after 2 s upside down
    void time;
  }
  results.push({ seed, minUp: +minUp.toFixed(3), tiltSteps: bigTilts, impacts, laps: +(dist / L).toFixed(2), aiLaps: ais.map((d) => +(d.s / L).toFixed(2)).join(' ') });
  console.log(JSON.stringify(results[results.length - 1]));
  world.free();
}
const worst = Math.min(...results.map((r) => r.minUp));
console.log('WORST upright across seeds:', worst.toFixed(3), worst > 0.5 ? 'OK - no rollovers' : 'ROLLOVER');
