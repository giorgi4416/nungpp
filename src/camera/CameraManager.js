import * as THREE from 'three';
import { ChaseCamera } from './ChaseCamera.js';

/**
 * Camera director. Each mode produces a target transform; switching modes
 * blends smoothly from the previous transform instead of snapping.
 *
 * Modes: chase | far | cockpit (racing), orbit (menu showcase),
 *        grid (start cinematic), finish (post-race orbit)
 */
const _pos = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _off = new THREE.Vector3();
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const TILT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.07);

export const RACE_CAMERAS = ['chase', 'far', 'cockpit'];
export const CAMERA_LABELS = { chase: 'CHASE CAM', far: 'FAR CHASE', cockpit: 'COCKPIT CAM' };

export class CameraManager {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'orbit';
    this.chase = new ChaseCamera({ distance: 6.2, height: 1.8, lookAhead: 4.8, fov: 60 });
    this.far = new ChaseCamera({ distance: 9.6, height: 3.1, lookAhead: 6, fov: 58, stiffness: 7 });
    this.blend = 1;
    this.blendDur = 0.7;
    this.fromPos = new THREE.Vector3();
    this.fromQuat = new THREE.Quaternion();
    this.fromFov = 60;
    this.time = 0;
    this.orbitAngle = 0;
    this.shakeAmp = 0;
    this.shake = { x: 0, y: 0 };
    this.shakeEnabled = true;
    this.gridT = 0;
  }

  setMode(mode, { instant = false, duration = 0.7 } = {}) {
    if (mode === this.mode && !instant) return;
    this.fromPos.copy(this.camera.position);
    this.fromQuat.copy(this.camera.quaternion);
    this.fromFov = this.camera.fov;
    this.mode = mode;
    this.blend = instant ? 1 : 0;
    this.blendDur = duration;
    if (mode === 'grid') this.gridT = 0;
  }

  resetRig(carPos, carQuat) {
    this.chase.reset(carPos, carQuat);
    this.far.reset(carPos, carQuat);
  }

  addShake(amount) {
    if (!this.shakeEnabled) return;
    this.shakeAmp = Math.min(0.6, this.shakeAmp + amount);
  }

  /**
   * ctx: {carPos, carQuat, speed, accel, groundAt, rayClip, showcase: {pos, quat}, grid: {focus, front}}
   */
  update(dt, ctx) {
    this.time += dt;
    // shake noise
    this.shakeAmp = Math.max(0, this.shakeAmp - dt * 1.4);
    const a = this.shakeAmp * this.shakeAmp;
    this.shake.x = (Math.sin(this.time * 71.3) + Math.sin(this.time * 43.1)) * 0.5 * a * 0.5;
    this.shake.y = (Math.sin(this.time * 59.7) + Math.cos(this.time * 37.9)) * 0.5 * a * 0.4;
    // high-speed micro vibration
    const vib = Math.max(0, (ctx.speed || 0) - 50) * 0.00009 * (this.shakeEnabled ? 1 : 0);
    this.shake.y += Math.sin(this.time * 90) * vib;

    let fov = 60;
    const cctx = { ...ctx, shake: this.shake };
    switch (this.mode) {
      case 'chase':
      case 'far': {
        const rig = this.mode === 'chase' ? this.chase : this.far;
        rig.update(dt, cctx);
        // keep the other rig warm so switching is seamless
        (this.mode === 'chase' ? this.far : this.chase).update(dt, { ...ctx, shake: null });
        _pos.copy(rig.position);
        _q.copy(rig.quaternion);
        fov = rig.fov;
        break;
      }
      case 'cockpit': {
        this.chase.update(dt, { ...ctx, shake: null });
        this.far.update(dt, { ...ctx, shake: null });
        // driver's eye line: inside the helmet (culled), looking through the halo
        _off.set(0, 0.575, 0.33).applyQuaternion(ctx.carQuat);
        _pos.copy(ctx.carPos).add(_off);
        _q.copy(ctx.carQuat).multiply(FLIP).multiply(TILT);
        _pos.x += this.shake.x * 0.3;
        _pos.y += this.shake.y * 0.3;
        fov = 72 + Math.min(1, Math.max(0, ctx.speed) / 85) ** 2 * 8;
        break;
      }
      case 'orbit': {
        const sc = ctx.showcase;
        this.orbitAngle += dt * 0.11;
        const r = 8.6 + Math.sin(this.time * 0.17) * 1.2;
        const h = 1.25 + Math.sin(this.time * 0.23) * 0.45;
        _v.set(Math.sin(this.orbitAngle) * r, h, Math.cos(this.orbitAngle) * r);
        _pos.copy(sc.pos).add(_v);
        const look = sc.pos.clone();
        look.y += 0.35;
        // shift framing so the car sits right of the menu panel
        const right = new THREE.Vector3().subVectors(look, _pos).cross(THREE.Object3D.DEFAULT_UP).normalize();
        look.addScaledVector(right, -1.35);
        _m.lookAt(_pos, look, THREE.Object3D.DEFAULT_UP);
        _q.setFromRotationMatrix(_m);
        fov = 42;
        break;
      }
      case 'grid': {
        // sweeping shot over the grid, then settle behind the player
        this.gridT += dt;
        const g = ctx.grid;
        const t = Math.min(1, this.gridT / 3.2);
        const e = t * t * (3 - 2 * t);
        _pos.copy(g.from).lerp(g.to, e);
        _pos.y += Math.sin(e * Math.PI) * 2.5;
        _m.lookAt(_pos, g.focus, THREE.Object3D.DEFAULT_UP);
        _q.setFromRotationMatrix(_m);
        fov = 48;
        this.chase.update(dt, { ...ctx, shake: null });
        this.far.update(dt, { ...ctx, shake: null });
        break;
      }
      case 'finish': {
        this.orbitAngle += dt * 0.25;
        const r = 9;
        _v.set(Math.sin(this.orbitAngle) * r, 2.6, Math.cos(this.orbitAngle) * r);
        _pos.copy(ctx.carPos).add(_v);
        if (ctx.groundAt) _pos.y = Math.max(_pos.y, ctx.groundAt(_pos.x, _pos.z) + 1.5);
        _m.lookAt(_pos, ctx.carPos, THREE.Object3D.DEFAULT_UP);
        _q.setFromRotationMatrix(_m);
        fov = 50;
        break;
      }
    }

    const cam = this.camera;
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / this.blendDur);
      const b = this.blend * this.blend * (3 - 2 * this.blend);
      cam.position.lerpVectors(this.fromPos, _pos, b);
      cam.quaternion.slerpQuaternions(this.fromQuat, _q, b);
      fov = this.fromFov + (fov - this.fromFov) * b;
    } else {
      cam.position.copy(_pos);
      cam.quaternion.copy(_q);
    }
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
