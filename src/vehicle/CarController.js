import * as THREE from 'three';

/**
 * Maps keyboard input to the vehicle: smooths digital steering, ramps the
 * throttle and supports a simple autopilot used for the cool-down lap after
 * the chequered flag.
 */
export class CarController {
  constructor(input, physics, track) {
    this.input = input;
    this.physics = physics;
    this.track = track;
    this.steer = 0;
    this.throttle = 0;
    this.autopilot = false;
    this.autopilotPace = 0.62; // fraction of the reference speed profile
    this._proj = {};
    this._target = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._fwd = new THREE.Vector3();
    this._left = new THREE.Vector3();
  }

  reset() {
    this.steer = 0;
    this.throttle = 0;
  }

  update(dt, enabled) {
    const p = this.physics;
    if (this.autopilot) return this._auto(dt);
    if (!enabled) {
      p.throttle = 0;
      p.brake = 0;
      p.steer = 0;
      p.handbrake = false;
      // let the driver rev the engine on the grid
      p.throttle = this.input.throttle * (p.locked ? 1 : 0);
      return;
    }
    const target = this.input.steer;
    // keyboard steering smoothing: quick to centre, progressive to lock
    if (this.input.analogSteer) {
      // gamepad stick: follow the stick closely (light filtering only)
      this.steer += (target - this.steer) * Math.min(1, dt * 14);
    } else {
      const rate = target === 0 || Math.sign(target) !== Math.sign(this.steer) ? 7 : 4.2;
      this.steer += THREE.MathUtils.clamp(target - this.steer, -rate * dt, rate * dt);
    }
    const thr = this.input.throttle;
    this.throttle += THREE.MathUtils.clamp(thr - this.throttle, -10 * dt, 6 * dt);
    p.steer = this.steer;
    p.throttle = this.throttle;
    p.brake = this.input.brake;
    p.handbrake = false;
    if (p.brake > 0 && this.throttle > 0 && p.speed > 2) p.throttle = 0; // brake overrides throttle when both pressed
  }

  /** Pure-pursuit autopilot along the racing line (cool-down lap). */
  _auto(dt) {
    const p = this.physics;
    const T = this.track;
    const b = p.body.translation();
    T.project(b.x, b.z, this._proj.index ?? undefined, this._proj);
    const v = Math.max(0, p.speed);
    const look = 8 + v * 0.42;
    const s = this._proj.s;
    T.sampleAt(s + look, T.interp(T.lineOffset, s + look), this._target);
    const r = p.body.rotation();
    this._q.set(r.x, r.y, r.z, r.w);
    this._fwd.set(0, 0, 1).applyQuaternion(this._q);
    this._left.set(1, 0, 0).applyQuaternion(this._q);
    const dx = this._target.x - b.x, dz = this._target.z - b.z;
    const alpha = Math.atan2(dx * this._left.x + dz * this._left.z, dx * this._fwd.x + dz * this._fwd.z);
    const want = Math.atan2(2 * 3.6 * Math.sin(alpha), look);
    const kmh = v * 3.6;
    const lim = THREE.MathUtils.lerp(0.36, 0.065, Math.min(1, kmh / 260));
    p.steer = THREE.MathUtils.clamp(want / Math.max(0.05, lim), -1, 1);
    const vt = T.interp(T.speedProfile, s + 4 + v * 0.15) * this.autopilotPace;
    if (v < vt - 1) { p.throttle = this.autopilotPace > 0.8 ? 1 : 0.7; p.brake = 0; }
    else if (v > vt + 2) { p.throttle = 0; p.brake = Math.min(1, (v - vt) / 8); }
    else { p.throttle = 0.25; p.brake = 0; }
  }
}
