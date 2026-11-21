// Headless crash-damage checks: real Rapier car + real DamageModel, driven into a concrete wall.
//  - severity scales with impact speed (gentle touches stay harmless)
//  - direction (front / rear / side) picks the damaged zone
//  - high speed detaches wings and wheels, and the damage changes the physics
//  - repair() restores the car exactly
// The visual car is a stub that records what the damage model asks it to do
// (the real FormulaCar needs a browser canvas for its livery textures).
// Usage: node tools/damage-test.mjs
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { VehiclePhysics } from '../src/vehicle/VehiclePhysics.js';
import { DamageModel } from '../src/vehicle/DamageModel.js';

await RAPIER.init();
const DT = 1 / 120;
let ok = true;
const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) ok = false; };

class StubCar {
  constructor() { this.car = { primary: '#d00' }; this.repair(); }
  repair() {
    this.components = Object.fromEntries(['nose', 'core', 'sidepodL', 'sidepodR', 'frontWing', 'rearWing', 'suspFL', 'suspFR', 'suspRL', 'suspRR'].map((n) => [n, { group: new THREE.Group(), attached: true }]));
    this.wheels = [0, 1, 2, 3].map(() => ({ pivot: new THREE.Group(), attached: true }));
    this.deforms = [];
  }
  hasComponent(n) { return !!this.components[n]?.attached; }
  deform(n, d) { this.deforms.push(n); }
  detach(n) { const c = this.components[n]; if (!c || !c.attached) return null; c.attached = false; return c.group; }
  detachWheel(i) { const w = this.wheels[i]; if (!w.attached) return null; w.attached = false; return w.pivot; }
  bendWheel() {}
  get detached() { return Object.entries(this.components).filter(([, c]) => !c.attached).map(([n]) => n); }
  get wheelsLost() { return this.wheels.filter((w) => !w.attached).length; }
}
const debris = { addPiece() {}, burst() {}, release() {}, clear() {} };

function makeWorld() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  const ground = world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0).setFriction(1));
  // wall: across the +Z axis at z = 40
  world.createCollider(RAPIER.ColliderDesc.cuboid(60, 1.2, 0.5).setTranslation(0, 1.2, 40.5).setFriction(0.4));
  return { world, groundHandles: new Set([ground.handle]), eq: new RAPIER.EventQueue(true) };
}

/** Launch the car at `kmh` toward the wall; heading = car yaw, travel = velocity direction. */
function crash(kmh, { yaw = 0, travelYaw = 0, gap = 9 } = {}) {
  const { world, groundHandles, eq } = makeWorld();
  const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const ph = new VehiclePhysics(RAPIER, world, { position: new THREE.Vector3(0, 0.48, 40 - gap), quaternion: quat });
  ph.resetThermals(20);
  const car = new StubCar();
  const notes = [];
  const dm = new DamageModel(car, ph, debris, { notify: (l, v) => notes.push(l + ' ' + v) });
  for (let i = 0; i < 60; i++) { ph.preStep(DT); world.step(); ph.postStep(DT); } // settle
  const v = kmh / 3.6;
  ph.body.setLinvel({ x: Math.sin(travelYaw) * v, y: 0, z: Math.cos(travelYaw) * v }, true);
  ph.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  for (let i = 0; i < 240; i++) {
    ph.throttle = 0; ph.brake = 0; ph.steer = 0;
    ph.preStep(DT);
    const a = ph.body.linvel();
    world.step(eq);
    const b = ph.body.linvel();
    eq.drainContactForceEvents((e) => {
      if (groundHandles.has(e.collider1()) || groundHandles.has(e.collider2())) return;
      const part = ph.partOf(e.collider1()) || ph.partOf(e.collider2()) || 'tub';
      dm.onContact(part, new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z));
    });
    ph.postStep(DT);
    dm.update(DT);
  }
  return { ph, car, dm, world, notes };
}

// ---- 1. severity scales with speed (head-on)
console.log('\nhead-on wall impacts');
const levels = {};
for (const kmh of [12, 25, 45, 80, 130, 200, 280]) {
  const r = crash(kmh);
  const log = r.dm.log.map((l) => `${l.levelName}/${l.zone}/${l.severity.toFixed(1)}`).join(', ') || 'no damage';
  console.log(`  ${String(kmh).padStart(3)} km/h -> level ${r.dm.level} [${log}] detached: ${r.car.detached.join(',') || '-'} wheels lost: ${r.car.wheelsLost}`);
  levels[kmh] = r;
}
check(levels[12].dm.level === 0, '12 km/h touch: no damage');
check(levels[25].dm.level <= 1 && levels[25].car.detached.length === 0, '25 km/h knock: at most minor, nothing comes off');
check(levels[45].car.detached.length === 0 && levels[45].car.wheelsLost === 0, '45 km/h: car not destroyed (no parts detached)');
check(levels[80].dm.level === 3, '80 km/h head-on: severe');
check(levels[130].dm.level === 4, '130 km/h head-on: terminal');
check(levels[80].car.detached.includes('frontWing'), '80 km/h head-on: front wing detaches');
check(levels[200].car.detached.length >= 3, '200 km/h: multiple parts detach');
check(levels[280].dm.level === 4 && levels[280].car.wheelsLost >= 1, '280 km/h: terminal, wheel(s) torn off');
check(levels[280].notes.some((n) => n.includes('PRESS R')), 'terminal damage tells the player to respawn');
check([12, 25, 45, 80, 130, 200, 280].every((k, i, a) => i === 0 || levels[k].dm.level >= levels[a[i - 1]].dm.level), 'damage level is monotonic in impact speed');
for (const k of [80, 130, 200]) check(levels[k].dm.log.every((l) => l.zone === 'front'), `${k} km/h head-on classified as FRONT`);

// ---- 2. direction: side & rear
console.log('\ndirectional impacts');
const side = crash(150, { yaw: Math.PI / 2, gap: 1.6 }); // spun car, right side slams into the barrier
console.log('  side (150 km/h, sliding sideways):', side.dm.log.map((l) => `${l.levelName}/${l.zone}/${l.side}`).join(', '), 'detached:', side.car.detached.join(',') || '-');
check(side.dm.log.length && side.dm.log[0].zone === 'side', 'sideways slide into wall -> SIDE damage');
check(side.dm.health.sidepodL < 1 || side.dm.health.sidepodR < 1, 'side hit damages a sidepod');
const rear = crash(95, { yaw: Math.PI }); // car facing away from the wall, travelling backwards
console.log('  rear (95 km/h, backwards):', rear.dm.log.map((l) => `${l.levelName}/${l.zone}`).join(', '), 'detached:', rear.car.detached.join(',') || '-');
check(rear.dm.log.length && rear.dm.log[0].zone === 'rear', 'backwards into wall -> REAR damage');
check(rear.dm.health.rearWing < 1 && rear.dm.health.frontWing === 1, 'rear hit damages the rear wing, not the front');
const glance = crash(250, { yaw: Math.PI / 2 - 0.17, travelYaw: Math.PI / 2 - 0.17, gap: 2.4 });
console.log('  glancing (250 km/h, 10 deg):', glance.dm.log.map((l) => `${l.levelName}/${l.zone}/${l.severity.toFixed(1)}`).join(', '), 'detached:', glance.car.detached.join(',') || '-', 'wheels lost', glance.car.wheelsLost);
check(glance.dm.level >= 1 && glance.dm.level <= 3 && glance.car.wheelsLost === 0, '250 km/h glancing scrape: damaged but not destroyed');

// ---- 3. damaged cars behave differently
console.log('\nphysics after damage');
function driveTest(r) {
  // fresh flat world, same physics object state: measure top speed after 12 s and grip in a 6 s full-lock circle
  const ph = r.ph;
  ph.reset(new THREE.Vector3(0, 0.48, -300), new THREE.Quaternion());
  let maxV = 0;
  for (let i = 0; i < 120 * 12; i++) { ph.throttle = 1; ph.brake = 0; ph.steer = 0; ph.preStep(DT); r.world.step(); ph.postStep(DT); maxV = Math.max(maxV, ph.speed); }
  const b = ph.body.translation();
  return { vmax: maxV * 3.6, drift: Math.abs(b.x) };
}
const clean = crash(10), mod = crash(50), term = crash(280);
const dC = driveTest(clean), dM = driveTest(mod), dT = driveTest(term);
console.log(`  clean: ${dC.vmax.toFixed(0)} km/h, lateral drift ${dC.drift.toFixed(1)} m`);
console.log(`  ${mod.dm.log.map((l) => l.levelName).join('/')}: ${dM.vmax.toFixed(0)} km/h, lateral drift ${dM.drift.toFixed(1)} m  dmg=${JSON.stringify({ fa: +mod.ph.dmg.frontAero.toFixed(2), steer: +mod.ph.dmg.steerBias.toFixed(3) })}`);
console.log(`  terminal: ${dT.vmax.toFixed(0)} km/h, wheels lost ${term.ph.dmg.wheelLost.filter(Boolean).length}, power ${term.ph.dmg.power}`);
check(dC.vmax > 230, 'undamaged car accelerates normally');
check(mod.dm.level === 2, '50 km/h head-on: moderate');
check(dM.vmax > dC.vmax * 0.85, 'moderate damage: still drivable');
check(mod.ph.dmg.frontAero < 1, 'moderate front damage reduces front downforce');
check(dT.vmax < dC.vmax * 0.6, 'terminal damage: car barely drivable (much lower speed)');

// ---- 4. repair
term.dm.reset();
check(term.car.detached.length === 0 && term.car.wheelsLost === 0 && term.dm.level === 0, 'respawn repairs the model (all parts back)');
check(term.ph.dmg.power === 1 && term.ph.dmg.wheelLost.every((x) => !x) && term.ph.vc.wheelSuspensionRestLength(0) > 0.1, 'respawn repairs the physics (wheels, power)');
const dR = driveTest(term);
console.log(`  repaired: ${dR.vmax.toFixed(0)} km/h`);
check(Math.abs(dR.vmax - dC.vmax) < 3, 'repaired car is as fast as a clean one');

console.log(ok ? '\nALL DAMAGE CHECKS PASSED' : '\nSOME CHECKS FAILED');
process.exit(ok ? 0 : 1);
