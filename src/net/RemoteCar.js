import * as THREE from 'three';
import { FormulaCar } from '../vehicle/FormulaCar.js';
import { CAR_BY_ID } from '../vehicle/CarCatalog.js';

/**
 * Another player's car. Their own browser runs the physics; we receive compact
 * snapshots (~8-12 Hz) and play them back slightly in the past, interpolating
 * between two snapshots (position lerp, rotation slerp) so motion stays smooth
 * whatever the network jitter. Short gaps are bridged by extrapolating with the
 * last velocity; long gaps freeze the car instead of letting it drift.
 *
 * The car is a kinematic Rapier body, so you can bump into friends just like AI cars.
 */

// snapshot layout (array, rounded numbers - keeps each message ~150 bytes)
export const F = { X: 0, Y: 1, Z: 2, QX: 3, QY: 4, QZ: 5, QW: 6, VX: 7, VY: 8, VZ: 9, SPEED: 10, STEER: 11, THR: 12, BRK: 13, GEAR: 14, RPM: 15, PROG: 16, LAPS: 17, FLAGS: 18, DMG: 19, BEST: 20 };
export const FLAG = { PAUSED: 1, FINISHED: 2, ONTRACK: 4 };
const DMG_PARTS = ['frontWing', 'rearWing', 'nose', 'sidepodL', 'sidepodR'];

const MAX_BUFFER = 30;
const MAX_EXTRAPOLATE = 350; // ms

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();

/** Pack the local car's state for a broadcast. */
export function packState(o) {
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const r4 = (v) => Math.round(v * 10000) / 10000;
  return [
    r3(o.pos.x), r3(o.pos.y), r3(o.pos.z),
    r4(o.quat.x), r4(o.quat.y), r4(o.quat.z), r4(o.quat.w),
    r3(o.vel.x), r3(o.vel.y), r3(o.vel.z),
    Math.round(o.speed * 100) / 100, Math.round(o.steer * 1000) / 1000, Math.round(o.throttle * 100) / 100, Math.round(o.brake * 100) / 100,
    o.gear, Math.round(o.rpm / 10) * 10, Math.round(o.progress * 10) / 10, o.laps, o.flags, o.damageMask, o.bestLap ? Math.round(o.bestLap * 1000) / 1000 : 0,
  ];
}

export function damageMask(car, wheelsLost) {
  let m = 0;
  DMG_PARTS.forEach((n, i) => { if (car.components[n] && !car.components[n].attached) m |= 1 << i; });
  wheelsLost.forEach((lost, i) => { if (lost) m |= 1 << (8 + i); });
  return m;
}

/** Stand-in for LapTracker: positions come from what the remote player reports. */
class RemoteTracker {
  constructor() { this.reset(); }
  reset() {
    this.started = true;
    this.finished = false;
    this.finishTime = null;
    this.lapsCompleted = 0;
    this.bestLap = null;
    this.lapTimes = [];
    this.bestSectors = [null, null, null];
    this._progress = -1e6;
  }
  progress() { return this._progress; }
  update(s, time, dt, out) { out.length = 0; }
}

export class RemoteCar {
  constructor(RAPIER, world, scene, player) {
    this.userId = player.user_id;
    this.name = player.display_name;
    this.scene = scene;
    this.world = world;
    this.setCar(player.selected_car);
    const desc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -100, 0);
    this.body = world.createRigidBody(desc);
    const mk = (hx, hy, hz, x, y, z) => world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(0.3).setRestitution(0.2), this.body);
    mk(0.55, 0.3, 2.45, 0, 0.16, -0.1);
    mk(0.95, 0.2, 0.45, 0, 0.0, 1.72);
    mk(0.98, 0.22, 0.5, 0, 0.0, -1.88);
    this.buf = [];
    this.sid = null;
    this.lastSeq = -1;
    this.lastRecv = 0;
    this.tracker = new RemoteTracker();
    this.connected = true;
    this.speed = 0;
    this.rpm = 4000;
    this.steerVis = 0;
    this.brakeVis = 0;
    this.accelLong = 0;
    this.accelLat = 0;
    this.interpDelay = 140;
    this._jitter = 0;
    this._lastArrival = 0;
    this._dmg = 0;
    this.pos = new THREE.Vector3(0, -100, 0);
    this.quat = new THREE.Quaternion();
    this.hasState = false;
    this.car.setVisible(false);
  }

  setCar(carId) {
    const def = CAR_BY_ID[carId] || CAR_BY_ID['2020-ferrari'];
    if (this.car && this.carId === def.id) return;
    const vis = this.car ? this.car.root.visible : false;
    if (this.car) this.car.dispose();
    this.carId = def.id;
    this.def = def;
    this.car = new FormulaCar(def, { detachable: true }); // separate parts so friends' crash damage shows
    this.car.setVisible(vis);
    this.scene.add(this.car.root);
    this._dmg = 0;
  }

  /** Incoming snapshot. Out-of-order / duplicate messages are dropped by sequence number. */
  push(msg, serverNow) {
    if (msg.i !== this.sid) { this.sid = msg.i; this.lastSeq = -1; this.buf.length = 0; this.lag = null; }
    if (msg.q <= this.lastSeq) return false;
    this.lastSeq = msg.q;
    // observed delay = network latency + any clock error between the two players. Track its lower
    // envelope and play back relative to it, so a clock-sync error can never leave the car behind.
    const lat = serverNow - msg.t;
    if (this.lag == null || lat < this.lag) this.lag = lat;
    else this.lag += (lat - this.lag) * 0.02;
    const d = msg.d;
    this.buf.push({ t: msg.t, d });
    if (this.buf.length > MAX_BUFFER) this.buf.shift();
    // adaptive playout delay: ~1.5 send intervals + measured jitter
    const now = performance.now();
    if (this._lastArrival) {
      const gap = now - this._lastArrival;
      this._gapAvg = this._gapAvg ? this._gapAvg * 0.9 + gap * 0.1 : gap;
      this._jitter = this._jitter * 0.9 + Math.abs(gap - this._gapAvg) * 0.1;
      this.interpDelay = Math.min(400, Math.max(90, this._gapAvg * 1.5 + this._jitter * 2));
    }
    this._lastArrival = now;
    this.lastRecv = serverNow;
    const tr = this.tracker;
    tr._progress = d[F.PROG];
    tr.lapsCompleted = d[F.LAPS];
    if (d[F.BEST]) tr.bestLap = d[F.BEST];
    if (d[F.DMG] !== this._dmg) this._applyDamage(d[F.DMG]);
    this.paused = !!(d[F.FLAGS] & FLAG.PAUSED);
    return true;
  }

  _applyDamage(mask) {
    this._dmg = mask;
    DMG_PARTS.forEach((n, i) => {
      const c = this.car.components && this.car.components[n];
      if (c) c.group.visible = !(mask & (1 << i));
    });
    this.car.wheels.forEach((w, i) => (w.pivot.visible = !(mask & (1 << (8 + i)))));
  }

  /** Pose at server time `t` (ms). Returns false when there is nothing to show yet. */
  sample(t, outPos, outQuat) {
    const b = this.buf;
    if (!b.length) return false;
    let a = null, c = null;
    for (let i = b.length - 1; i >= 0; i--) {
      if (b[i].t <= t) { a = b[i]; c = b[i + 1] || null; break; }
    }
    if (!a) { a = b[0]; c = null; t = a.t; }
    const da = a.d;
    if (c) {
      const dc = c.d;
      const k = Math.min(1, Math.max(0, (t - a.t) / Math.max(1, c.t - a.t)));
      outPos.set(da[0] + (dc[0] - da[0]) * k, da[1] + (dc[1] - da[1]) * k, da[2] + (dc[2] - da[2]) * k);
      _qa.set(da[3], da[4], da[5], da[6]).normalize();
      _qb.set(dc[3], dc[4], dc[5], dc[6]).normalize();
      outQuat.slerpQuaternions(_qa, _qb, k);
      this.speed = da[F.SPEED] + (dc[F.SPEED] - da[F.SPEED]) * k;
      this.steerVis = da[F.STEER] + (dc[F.STEER] - da[F.STEER]) * k;
    } else {
      // past the newest snapshot: extrapolate briefly with its velocity, then hold
      const ex = Math.min(MAX_EXTRAPOLATE, Math.max(0, t - a.t)) / 1000;
      outPos.set(da[0] + da[7] * ex, da[1] + da[8] * ex, da[2] + da[9] * ex);
      outQuat.set(da[3], da[4], da[5], da[6]).normalize();
      this.speed = da[F.SPEED];
      this.steerVis = da[F.STEER];
    }
    this.brakeVis = da[F.BRK];
    this.rpm = da[F.RPM];
    this.gear = da[F.GEAR];
    return true;
  }

  /** Physics step: move the kinematic body to where the car is shown. */
  playoutTime(serverNow) {
    return serverNow - (this.lag || 0) - this.interpDelay;
  }

  fixedUpdate(serverNow) {
    const ok = this.sample(this.playoutTime(serverNow), this.pos, this.quat);
    const solid = ok && this.connected && !this.paused;
    if (solid !== this._solid) {
      this._solid = solid;
      this.body.setEnabled(solid);
    }
    if (solid) {
      this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
      this.body.setNextKinematicRotation({ x: this.quat.x, y: this.quat.y, z: this.quat.z, w: this.quat.w });
    }
  }

  /** Render: smooth pose for this frame. */
  frameUpdate(dt, serverNow, cameraPos) {
    const ok = this.sample(this.playoutTime(serverNow), this.car.root.position, this.car.root.quaternion);
    const visible = ok && this.connected;
    if (visible !== this.car.root.visible) this.car.setVisible(visible);
    if (!visible) return;
    this.car.update(dt, { speed: this.speed, steer: this.steerVis, accelLong: 0, accelLat: 0, brake: this.brakeVis });
    this.car.setLOD(this.car.root.position.distanceToSquared(cameraPos) > 70 * 70);
  }

  /** Seconds since the last snapshot. */
  silence(serverNow) {
    return this.lastRecv ? (serverNow - this.lastRecv) / 1000 : Infinity;
  }

  dispose(world) {
    this.car.dispose();
    try { (world || this.world).removeRigidBody(this.body); } catch { /* world already freed */ }
  }
}
