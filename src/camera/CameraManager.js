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
const _q2 = new THREE.Quaternion();
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const TILT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.12);

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
    this.cockpitFov = 74;
    // cockpit head motion (spring-damper: the head lags the chassis under g-forces)
    this.head = new THREE.Vector3();
    this.headVel = new THREE.Vector3();
    this.headRoll = 0;
    // look-around state: targets set by mouse / stick / keys, smoothed values applied
    this.look = { yaw: 0, pitch: 0, zoom: 1, tYaw: 0, tPitch: 0, tZoom: 1, hold: 0 };
    this.sensitivity = 1;
    this.eye = new THREE.Vector3(0, 0.578, 0.21);
  }

  /** Mouse drag / right stick: dx, dy in pixels (or stick units scaled to pixels). */
  lookInput(dx, dy) {
    const L = this.look;
    const k = 0.0055 * this.sensitivity;
    if (this.mode === 'cockpit') {
      L.tYaw = THREE.MathUtils.clamp(L.tYaw - dx * k, -1.75, 1.75);
      L.tPitch = THREE.MathUtils.clamp(L.tPitch - dy * k, -0.45, 0.5);
    } else if (this.mode === 'orbit') {
      this.orbitAngle -= dx * k;
      L.tPitch = THREE.MathUtils.clamp(L.tPitch + dy * k * 0.6, -0.35, 0.9);
    } else {
      L.tYaw -= dx * k;
      L.tPitch = THREE.MathUtils.clamp(L.tPitch + dy * k * 0.7, -0.3, 1.1);
    }
  }

  /** Mouse wheel: positive = zoom out. */
  zoomInput(delta) {
    const L = this.look;
    L.tZoom = THREE.MathUtils.clamp(L.tZoom * (1 + delta * 0.0012), this.mode === 'orbit' ? 0.55 : 0.6, this.mode === 'orbit' ? 2.0 : 2.4);
  }

  /** Hold-to-look keys in the cockpit (-1 left, +1 right, 0 none). */
  setLookHold(dir) {
    this.look.hold = dir;
  }

  /** Snap back to the default view (reset key / double-click). */
  resetLook() {
    const L = this.look;
    L.tYaw = 0; L.tPitch = 0; L.tZoom = 1; L.hold = 0;
    if (this.mode === 'orbit') this.orbitAngle = Math.round(this.orbitAngle / (Math.PI * 2)) * Math.PI * 2;
  }

  get looking() {
    const L = this.look;
    return Math.abs(L.yaw) > 0.05 || Math.abs(L.pitch) > 0.05 || Math.abs(L.zoom - 1) > 0.05;
  }

  /** Chase camera responsiveness (settings: camera smoothing). */
  setSmoothing(k) {
    this.chase.stiffness = 9 * k;
    this.far.stiffness = 7 * k;
  }

  setMode(mode, { instant = false, duration = 0.7 } = {}) {
    if (mode === this.mode && !instant) return;
    this.fromPos.copy(this.camera.position);
    this.fromQuat.copy(this.camera.quaternion);
    this.fromFov = this.camera.fov;
    this.mode = mode;
    // each camera starts from its default view
    const L = this.look;
    L.yaw = L.tYaw = 0; L.pitch = L.tPitch = 0; L.zoom = L.tZoom = 1; L.hold = 0;
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

    // smooth the look-around toward its targets (hold-keys override the cockpit yaw)
    const L = this.look;
    const ks = 1 - Math.exp(-dt * 10);
    const tYaw = this.mode === 'cockpit' && L.hold ? -L.hold * 1.35 : L.tYaw;
    L.yaw += (tYaw - L.yaw) * ks;
    L.pitch += (L.tPitch - L.pitch) * ks;
    L.zoom += (L.tZoom - L.zoom) * ks;
    for (const rig of [this.chase, this.far]) {
      const active = (this.mode === 'chase' && rig === this.chase) || (this.mode === 'far' && rig === this.far);
      rig.orbitYaw = active ? L.yaw : 0;
      rig.orbitPitch = active ? L.pitch : 0;
      rig.zoom = active ? L.zoom : 1;
    }
    if (ctx.eye) this.eye.copy(ctx.eye);

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
        // driver's eye line: inside the helmet (culled), looking through the halo over the wheel
        // head motion: braking pitches the head forward/down, acceleration pushes it back,
        // cornering leans it outward; a stiff spring keeps it subtle and comfortable
        const aL = THREE.MathUtils.clamp(ctx.accel || 0, -45, 30);
        const aY = THREE.MathUtils.clamp(ctx.accelLat || 0, -45, 45);
        const tx = -aY * 0.0007, ty = -Math.abs(aL) * 0.00025, tz = aL * 0.0011;
        // stiff spring-damper, sub-stepped so long frames can never make it unstable
        const kS = 160, kD = 22;
        const n = Math.min(20, Math.ceil(dt / 0.006));
        const h = dt / Math.max(1, n);
        for (let k = 0; k < n; k++) {
          this.headVel.x += ((tx - this.head.x) * kS - this.headVel.x * kD) * h;
          this.headVel.y += ((ty - this.head.y) * kS - this.headVel.y * kD) * h;
          this.headVel.z += ((tz - this.head.z) * kS - this.headVel.z * kD) * h;
          this.head.addScaledVector(this.headVel, h);
        }
        this.head.clampScalar(-0.06, 0.06);
        _off.set(this.eye.x + this.head.x, this.eye.y + this.head.y, this.eye.z + this.head.z).applyQuaternion(ctx.carQuat);
        _pos.copy(ctx.carPos).add(_off);
        // follow the chassis but filter out most of its roll so the horizon stays calm
        _q.copy(ctx.carQuat).multiply(FLIP).multiply(TILT);
        _v.set(0, 0, -1).applyQuaternion(_q);
        _m.lookAt(_pos, _off.copy(_pos).add(_v), THREE.Object3D.DEFAULT_UP);
        _q2.setFromRotationMatrix(_m);
        _q.slerp(_q2, 0.65);
        // driver turning their head (limited look-around)
        if (L.yaw || L.pitch) {
          _q.multiply(_q2.setFromAxisAngle(_v.set(0, 1, 0), L.yaw));
          _q.multiply(_q2.setFromAxisAngle(_v.set(1, 0, 0), L.pitch));
        }
        const vib = Math.max(0, (ctx.speed || 0) - 40) * 0.000035 * (this.shakeEnabled ? 1 : 0);
        _pos.x += this.shake.x * 0.25 + Math.sin(this.time * 71) * vib;
        _pos.y += this.shake.y * 0.25 + Math.sin(this.time * 97) * vib;
        fov = this.cockpitFov + Math.min(1, Math.max(0, ctx.speed) / 85) ** 2 * 6;
        break;
      }
      case 'orbit': {
        const sc = ctx.showcase;
        this.orbitAngle += dt * 0.11;
        // slow automatic orbit; the player can drag to rotate/tilt and scroll to zoom
        const r = (8.6 + Math.sin(this.time * 0.17) * 1.2) * L.zoom;
        const h = Math.max(0.35, 1.25 + Math.sin(this.time * 0.23) * 0.45 + L.pitch * 6);
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
