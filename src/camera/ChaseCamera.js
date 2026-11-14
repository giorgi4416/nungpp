import * as THREE from 'three';

/**
 * Speed-sensitive chase camera rig. Lags slightly behind the car's heading
 * (which reveals the corner ahead), pulls back and widens FOV with speed,
 * shakes on impacts, and never clips into the ground or barriers.
 */
const _fwd = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _look = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _m = new THREE.Matrix4();

export class ChaseCamera {
  constructor({ distance = 6.4, height = 1.85, lookAhead = 4.5, fov = 60, stiffness = 9 } = {}) {
    this.distance = distance;
    this.height = height;
    this.lookAhead = lookAhead;
    this.baseFov = fov;
    this.stiffness = stiffness;
    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.fov = fov;
    this.yaw = 0;
    this.pitchLag = 0;
    this.initialized = false;
    this.velLag = 0;
  }

  reset(carPos, carQuat) {
    _fwd.set(0, 0, 1).applyQuaternion(carQuat);
    this.yaw = Math.atan2(_fwd.x, _fwd.z);
    this.position.copy(carPos).addScaledVector(_fwd, -this.distance).add(new THREE.Vector3(0, this.height, 0));
    this.initialized = true;
    this.velLag = 0;
  }

  /**
   * @param ctx {carPos, carQuat, speed (m/s), accel (m/s^2), shake: {x,y}, groundAt(x,z), rayClip(from, dir, dist) -> dist}
   */
  update(dt, ctx) {
    if (!this.initialized) this.reset(ctx.carPos, ctx.carQuat);
    _fwd.set(0, 0, 1).applyQuaternion(ctx.carQuat);
    const carYaw = Math.atan2(_fwd.x, _fwd.z);
    let dy = carYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    // when reversing, swing behind the direction of travel slowly
    const yawRate = 5.5;
    this.yaw += dy * Math.min(1, dt * yawRate);
    const spd = Math.max(0, ctx.speed);
    const sp = Math.min(1, spd / 85);
    // subtle push-back under acceleration, pull-in under braking
    this.velLag += ((ctx.accel || 0) * 0.025 - this.velLag) * Math.min(1, dt * 3);
    const dist = this.distance + sp * 1.4 + THREE.MathUtils.clamp(this.velLag, -0.35, 0.45);
    const h = this.height + sp * 0.25;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    _desired.set(ctx.carPos.x - fx * dist, ctx.carPos.y + h, ctx.carPos.z - fz * dist);
    // follow the car's slope a bit so crests and dips read well
    _desired.y += -_fwd.y * dist * 0.6;
    const k = 1 - Math.exp(-dt * this.stiffness * (1 + sp));
    this.position.lerp(_desired, k);
    // hard constraint on distance so the car never escapes at 300 km/h
    _dir.subVectors(this.position, ctx.carPos);
    const d = _dir.length();
    if (d > dist * 1.25) this.position.copy(ctx.carPos).addScaledVector(_dir, (dist * 1.25) / d);

    // clipping: barriers/terrain between car and camera
    if (ctx.rayClip) {
      _look.copy(ctx.carPos);
      _look.y += 0.9;
      _dir.subVectors(this.position, _look);
      const len = _dir.length();
      _dir.divideScalar(len);
      const hit = ctx.rayClip(_look, _dir, len);
      if (hit < len) this.position.copy(_look).addScaledVector(_dir, Math.max(1.2, hit - 0.35));
    }
    if (ctx.groundAt) {
      const gy = ctx.groundAt(this.position.x, this.position.z) + 0.65;
      if (this.position.y < gy) this.position.y = gy;
    }

    _look.set(ctx.carPos.x + fx * this.lookAhead, ctx.carPos.y + 0.75 + sp * 0.1, ctx.carPos.z + fz * this.lookAhead);
    _m.lookAt(this.position, _look, THREE.Object3D.DEFAULT_UP);
    this.quaternion.setFromRotationMatrix(_m);
    if (ctx.shake && (ctx.shake.x || ctx.shake.y)) {
      this.position.x += ctx.shake.x;
      this.position.y += ctx.shake.y;
    }
    this.fov = this.baseFov + sp * sp * 13;
  }
}
