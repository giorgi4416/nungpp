import * as THREE from 'three';

/**
 * Formula car physics on top of Rapier's DynamicRayCastVehicleController.
 *
 * - Chassis: dynamic rigid body with low centre of mass and realistic inertia.
 * - 4 ray-cast wheels: front steer, rear drive, all brake, spring/damper suspension.
 * - Arcade layer: aero downforce & drag, speed-sensitive steering, 8-speed gearbox
 *   (automatic, or manual with rev limiter and over-rev protection), power curve,
 *   off-track drag/grip, yaw-stability & anti-roll assists.
 * - Visual-state layer: per-wheel brake disc temperature (drives the glow only, never grip),
 *   wheel slip for smoke & rubber marks, kerb chatter and floor-contact detection.
 * - Era spec (power / downforce / drag / grip / gearbox) and crash-damage effects
 *   (lost wings, damaged suspension, lost wheels, engine damage). Both are neutral
 *   for an undamaged 2020 car, so the baseline handling is unchanged.
 *
 * Local frame: +Z forward, +Y up, -X right (Three.js object convention).
 * The body origin sits at wheel-axle height.
 */

export const CAR_SPEC = {
  mass: 780,
  wheelBase: 3.6,
  frontZ: 1.72,
  rearZ: -1.88,
  trackHalf: 0.82,
  wheelRadiusF: 0.345,
  wheelRadiusR: 0.36,
  suspRest: 0.24,
  suspConnY: 0.2,
  maxEngineForce: 11800, // N at the wheels (traction limited at low speed)
  power: 640000, // W
  maxBrake: 30, // Rapier brake impulse scale (~2.5 g on tarmac)
  dragCoef: 0.78, // N/(m/s)^2  -> ~330 km/h top speed
  downforceCoef: 2.4, // N/(m/s)^2
  gears: [0, 82, 118, 152, 186, 220, 256, 292, 340], // gear top speed km/h (index = gear)
  idleRpm: 4000,
  maxRpm: 12500,
};

const _q = new THREE.Quaternion();
const _w = new THREE.Vector3();
const _rp = new THREE.Vector3();
const _av = new THREE.Vector3();
const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();

export class VehiclePhysics {
  /**
   * @param {object} RAPIER - initialised rapier module
   * @param {object} world - RAPIER.World
   */
  constructor(RAPIER, world, { position, quaternion } = {}) {
    this.RAPIER = RAPIER;
    this.world = world;
    const S = CAR_SPEC;
    const p = position || new THREE.Vector3();
    const q = quaternion || new THREE.Quaternion();

    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(p.x, p.y, p.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setLinearDamping(0.02)
      .setAngularDamping(0.6)
      .setAdditionalMassProperties(
        S.mass,
        { x: 0, y: -0.02, z: -0.15 },
        { x: 1050, y: 1180, z: 260 },
        { x: 0, y: 0, z: 0, w: 1 },
      );
    this.body = world.createRigidBody(desc);

    // collision shape: main tub + sidepods + wings (zero density, mass comes from additional props)
    const mk = (hx, hy, hz, x, y, z) => {
      const cd = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(x, y, z)
        .setDensity(0)
        .setFriction(0.35)
        .setRestitution(0.15)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(9000);
      return world.createCollider(cd, this.body);
    };
    this.colliderNames = ['tub', 'sidepods', 'frontWing', 'rearWing'];
    this.colliders = [
      mk(0.5, 0.26, 2.45, 0, 0.16, -0.1), // tub & engine cover
      mk(0.86, 0.17, 0.8, 0, 0.08, -0.35), // sidepods
      mk(0.92, 0.06, 0.32, 0, -0.1, 2.75), // front wing
      mk(0.5, 0.2, 0.25, 0, 0.55, -2.55), // rear wing
    ];

    const vc = world.createVehicleController(this.body);
    vc.indexUpAxis = 1;
    vc.setIndexForwardAxis = 2;
    this.vc = vc;
    const dir = { x: 0, y: -1, z: 0 };
    const axle = { x: -1, y: 0, z: 0 }; // forward = axle x up -> +Z
    const wheels = [
      { x: S.trackHalf, z: S.frontZ, r: S.wheelRadiusF, front: true }, // FL (left = +X)
      { x: -S.trackHalf, z: S.frontZ, r: S.wheelRadiusF, front: true }, // FR
      { x: S.trackHalf, z: S.rearZ, r: S.wheelRadiusR, front: false }, // RL
      { x: -S.trackHalf, z: S.rearZ, r: S.wheelRadiusR, front: false }, // RR
    ];
    this.wheels = wheels;
    wheels.forEach((w, i) => {
      vc.addWheel({ x: w.x, y: S.suspConnY, z: w.z }, dir, axle, S.suspRest, w.r);
      vc.setWheelSuspensionStiffness(i, 46);
      vc.setWheelSuspensionCompression(i, 3.2);
      vc.setWheelSuspensionRelaxation(i, 3.8);
      vc.setWheelMaxSuspensionTravel(i, 0.16);
      vc.setWheelMaxSuspensionForce(i, 60000);
      vc.setWheelFrictionSlip(i, w.front ? 2.5 : 2.6);
      vc.setWheelSideFrictionStiffness(i, 1.0);
    });

    // driver controls (set by CarController / AI)
    this.throttle = 0;
    this.brake = 0;
    this.steer = 0; // -1 right .. +1 left
    this.handbrake = false;
    this.locked = false; // grid hold before start

    // state
    this.steerAngle = 0;
    this.gear = 1;
    this.rpm = S.idleRpm;
    this.shiftTimer = 0;
    this.speed = 0; // signed forward m/s
    this.surface = [0, 0, 0, 0];
    this.offTrack = 0; // 0..1
    this.slip = 0; // tyre slip intensity 0..1 (for smoke/squeal)
    this.lastImpact = 0;
    this.wheelSpin = [0, 0, 0, 0];
    this.onGearChange = null;
    this.onShiftRejected = null;

    // driver settings
    this.transmission = 'auto'; // 'auto' | 'manual'
    this.steerSensitivity = 1;
    this.limiter = false;

    // visual state (never feeds back into grip)
    this.ambient = 25;
    this.brakeTemp = [25, 25, 25, 25];
    this.wheelSlip = [0, 0, 0, 0]; // sliding speed (m/s) per wheel, for marks & smoke
    this.wheelSpinUp = [0, 0, 0, 0];
    // era performance spec + crash damage effects
    this.spec = { ...CAR_SPEC, gripMul: 1, eraDownforce: 1, eraDrag: 1, eraPower: 1 };
    this.dmg = null;
    this.repair();
    this.compression = [0, 0, 0, 0]; // 0 = extended, 1 = fully compressed
    this.bottoming = 0;
    this.onKerb = 0;
    this._kerbDist = 0;
    this._engineForce = 0;

    // interpolation state
    this.prevPos = new THREE.Vector3(p.x, p.y, p.z);
    this.currPos = this.prevPos.clone();
    this.prevQuat = q.clone();
    this.currQuat = q.clone();
  }

  /** Which part of the car a collider handle belongs to (for crash damage), or null. */
  partOf(handle) {
    for (let i = 0; i < this.colliders.length; i++) if (this.colliders[i].handle === handle) return this.colliderNames[i];
    return null;
  }

  /** surfaceFn(x, z) -> 0 road, 1 kerb, 2 verge, 3 grass, 4 gravel */
  setSurfaceSampler(fn) {
    this.surfaceFn = fn;
  }

  /** Brakes cold again (new session). Kept under the old name for callers. */
  resetThermals(ambient = this.ambient) {
    this.ambient = ambient;
    for (let i = 0; i < 4; i++) this.brakeTemp[i] = ambient + 60;
  }

  /**
   * Era performance: {gears, maxRpm, idleRpm, power, downforce, drag, grip} multipliers/overrides.
   * The 2020 spec is the unchanged baseline.
   */
  setEra(era) {
    const S = this.spec;
    S.gears = era.gears || CAR_SPEC.gears;
    S.maxRpm = era.maxRpm || CAR_SPEC.maxRpm;
    S.idleRpm = era.idleRpm || CAR_SPEC.idleRpm;
    S.eraPower = era.power ?? 1;
    S.eraDownforce = era.downforce ?? 1;
    S.eraDrag = era.drag ?? 1;
    S.gripMul = era.grip ?? 1;
    if (this.gear > S.gears.length - 1) this.gear = S.gears.length - 1;
  }

  /** Clear all crash damage effects (respawn / repair). */
  repair() {
    this.dmg = { frontAero: 1, rearAero: 1, drag: 1, power: 1, steerBias: 0, wheelGrip: [1, 1, 1, 1], wheelLost: [false, false, false, false], suspSoft: [1, 1, 1, 1] };
    if (!this.vc) return;
    for (let i = 0; i < 4; i++) {
      this.vc.setWheelSuspensionRestLength(i, CAR_SPEC.suspRest);
      this.vc.setWheelMaxSuspensionForce(i, 60000);
      this.vc.setWheelRadius(i, this.wheels[i].r);
    }
  }

  /** Apply damage effects computed by the damage model. */
  applyDamage(effects) {
    Object.assign(this.dmg, effects);
    for (let i = 0; i < 4; i++) {
      if (this.dmg.wheelLost[i]) {
        // no wheel: that corner sits on the chassis
        this.vc.setWheelSuspensionRestLength(i, 0.0);
        this.vc.setWheelMaxSuspensionForce(i, 0);
        this.vc.setWheelRadius(i, 0.05);
      }
    }
  }

  shiftUp() {
    if (this.transmission !== 'manual' || this.locked) return false;
    if (this.gear >= this.spec.gears.length - 1) { this.onShiftRejected && this.onShiftRejected(); return false; }
    this.gear++;
    this.shiftTimer = 0.05;
    this.onGearChange && this.onGearChange(this.gear, true);
    return true;
  }

  shiftDown() {
    if (this.transmission !== 'manual') return false;
    if (this.gear <= 1) { this.onShiftRejected && this.onShiftRejected(); return false; }
    // refuse a downshift that would over-rev the engine
    const S = this.spec;
    const kmh = Math.abs(this.speed) * 3.6;
    const rpm = S.idleRpm + (kmh / S.gears[this.gear - 1]) * (S.maxRpm - S.idleRpm);
    if (rpm > S.maxRpm * 1.03) { this.onShiftRejected && this.onShiftRejected(); return false; }
    this.gear--;
    this.shiftTimer = 0.05;
    this.onGearChange && this.onGearChange(this.gear, false);
    return true;
  }

  reset(position, quaternion) {
    this.body.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
    this.body.setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    this.steerAngle = 0;
    this.gear = 1;
    this.rpm = CAR_SPEC.idleRpm;
    this.speed = 0;
    this.prevPos.copy(position);
    this.currPos.copy(position);
    this.prevQuat.copy(quaternion);
    this.currQuat.copy(quaternion);
  }

  /** Called before world.step() at a fixed timestep. */
  preStep(dt) {
    const S = this.spec;
    const body = this.body;
    const vc = this.vc;
    const r = body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    _fwd.set(0, 0, 1).applyQuaternion(_q);
    _up.set(0, 1, 0).applyQuaternion(_q);
    _right.set(-1, 0, 0).applyQuaternion(_q);
    const lv = body.linvel();
    _v.set(lv.x, lv.y, lv.z);
    const speed = _v.dot(_fwd);
    const vAbs = _v.length();
    this.speed = speed;
    const kmh = Math.abs(speed) * 3.6;

    // ---- surface ----
    let off = 0, gravel = 0;
    if (this.surfaceFn) {
      const t = body.translation();
      for (let i = 0; i < 4; i++) {
        const w = this.wheels[i];
        const wx = t.x + _right.x * -w.x + _fwd.x * w.z;
        const wz = t.z + _right.z * -w.x + _fwd.z * w.z;
        const sfc = this.surfaceFn(wx, wz);
        this.surface[i] = sfc;
        if (sfc >= 3) off += 0.25;
        if (sfc === 4) gravel += 0.25;
      }
    }
    this.offTrack = off;

    // ---- steering: speed sensitive ----
    const steerLimit = THREE.MathUtils.lerp(0.36, 0.065, smooth01(kmh / 260));
    const sens = this.steerSensitivity;
    const target = THREE.MathUtils.clamp(this.steer * sens, -1, 1) * steerLimit;
    const rate = (Math.abs(target) > Math.abs(this.steerAngle) ? 2.4 : 3.6) * (0.5 + steerLimit) * (0.75 + 0.25 * sens);
    this.steerAngle += THREE.MathUtils.clamp(target - this.steerAngle, -rate * dt, rate * dt);
    vc.setWheelSteering(0, this.steerAngle + this.dmg.steerBias);
    vc.setWheelSteering(1, this.steerAngle + this.dmg.steerBias);

    // ---- gearbox ----
    this._updateGearbox(dt, kmh, speed);

    // ---- engine ----
    let engine = 0;
    const locked = this.locked;
    if (!locked) {
      if (this.throttle > 0) {
        const v = Math.max(Math.abs(speed), 4);
        if (this.transmission === 'manual') {
          // power depends on where the engine sits in its rev range for the selected gear
          const top = S.gears[this.gear] / 3.6;
          const frac = Math.abs(speed) / top;
          let p = 0.25 + 0.75 * Math.min(1, frac) ** 0.8;
          if (frac < 0.3 && this.gear > 2) p *= 0.35 + (frac / 0.3) * 0.65; // lugging in too high a gear
          engine = Math.min(S.maxEngineForce, (S.power * p) / Math.max(v, top * 0.22)) * this.throttle;
          this.limiter = frac >= 0.99;
          if (frac >= 1) engine = 0; // on the limiter: fuel cut, no more drive in this gear
        } else {
          const powerLimited = S.power / v;
          const rpmN = (this.rpm - S.idleRpm) / (S.maxRpm - S.idleRpm);
          const torqueShape = 0.86 + 0.14 * Math.sin(Math.min(1, rpmN) * Math.PI * 0.9);
          engine = Math.min(S.maxEngineForce, powerLimited) * torqueShape * this.throttle;
        }
        if (this.shiftTimer > 0) engine *= 0.35;
        if (off > 0) engine *= 1 - 0.25 * off;
      }
      // reverse when braking at (near) standstill
      if (this.brake > 0.5 && speed < 1.0 && this.throttle === 0) {
        engine = -3200 * this.brake;
      }
    }
    engine *= S.eraPower * this.dmg.power;
    this._engineForce = engine;
    vc.setWheelEngineForce(0, 0);
    vc.setWheelEngineForce(1, 0);
    vc.setWheelEngineForce(2, engine * 0.5);
    vc.setWheelEngineForce(3, engine * 0.5);

    // ---- brakes ----
    let brake = 0;
    if (locked) brake = 30;
    else if (this.brake > 0 && !(speed < 1.0 && this.throttle === 0)) brake = this.brake * S.maxBrake;
    if (this.handbrake) brake = Math.max(brake, S.maxBrake * 1.4);
    if (!locked && this.throttle === 0 && this.brake === 0) brake = 0.06; // engine braking / rolling resistance
    for (let i = 0; i < 4; i++) vc.setWheelBrake(i, brake * (i < 2 ? 0.56 : 0.44) * 2);
    this._brakeCmd = locked ? 0 : brake / S.maxBrake;

    // ---- aero platform: springs stiffen with downforce so the floor does not slam the road at 300 km/h
    const stiff = 46 + 0.005 * speed * speed;

    // ---- grip by surface ----
    for (let i = 0; i < 4; i++) {
      const sfc = this.surface[i];
      const base = i < 2 ? 2.5 : 2.6;
      const mul = sfc === 4 ? 0.45 : sfc === 3 ? 0.62 : sfc === 2 ? 0.92 : 1;
      vc.setWheelFrictionSlip(i, this.dmg.wheelLost[i] ? 0 : base * mul * S.gripMul * this.dmg.wheelGrip[i]);
      vc.setWheelSuspensionStiffness(i, stiff * this.dmg.suspSoft[i]);
    }

    // ---- aero ----
    body.resetForces(false);
    body.resetTorques(false);
    const down = S.downforceCoef * S.eraDownforce * speed * speed;
    body.addForce({ x: -_up.x * down, y: -_up.y * down, z: -_up.z * down }, true);
    // a missing/damaged wing gives back its share of downforce at that axle (unbalances the car)
    const tp = body.translation();
    const lossF = down * 0.36 * (1 - this.dmg.frontAero), lossR = down * 0.42 * (1 - this.dmg.rearAero);
    if (lossF > 0) body.addForceAtPoint({ x: _up.x * lossF, y: _up.y * lossF, z: _up.z * lossF }, { x: tp.x + _fwd.x * 1.7, y: tp.y + _fwd.y * 1.7, z: tp.z + _fwd.z * 1.7 }, true);
    if (lossR > 0) body.addForceAtPoint({ x: _up.x * lossR, y: _up.y * lossR, z: _up.z * lossR }, { x: tp.x - _fwd.x * 1.9, y: tp.y - _fwd.y * 1.9, z: tp.z - _fwd.z * 1.9 }, true);
    let dragK = S.dragCoef * S.eraDrag * this.dmg.drag * vAbs;
    // off-track resistance (grass / gravel)
    dragK += off * 28 + gravel * 260 * Math.min(1, vAbs / 12);
    body.addForce({ x: -_v.x * dragK, y: -_v.y * dragK * 0.2, z: -_v.z * dragK }, true);

    // kerb chatter: alternating vertical kicks at each wheel riding a kerb (one per 2 m stripe)
    this._kerbDist += Math.abs(speed) * dt;
    let kerbs = 0;
    const t0 = body.translation();
    for (let i = 0; i < 4; i++) {
      if (this.surface[i] !== 1 || Math.abs(speed) < 4) continue;
      kerbs++;
      const w = this.wheels[i];
      const phase = Math.sin((this._kerbDist / 1.0) * Math.PI + i);
      const f = 2600 * phase * Math.min(1, Math.abs(speed) / 25);
      _rp.set(t0.x + _right.x * -w.x + _fwd.x * w.z, t0.y, t0.z + _right.z * -w.x + _fwd.z * w.z);
      body.addForceAtPoint({ x: _up.x * f, y: _up.y * f, z: _up.z * f }, { x: _rp.x, y: _rp.y, z: _rp.z }, true);
    }
    this.onKerb = kerbs / 4;

    vc.updateVehicle(dt);
  }

  /** Called after world.step(). Stability assists + bookkeeping. */
  postStep(dt) {
    const body = this.body;
    const r = body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    _fwd.set(0, 0, 1).applyQuaternion(_q);
    _up.set(0, 1, 0).applyQuaternion(_q);
    _right.set(-1, 0, 0).applyQuaternion(_q);
    const lv = body.linvel();
    const av = body.angvel();
    _v.set(lv.x, lv.y, lv.z);
    const fwdSpeed = _v.dot(_fwd);
    const latSpeed = _v.dot(_right);

    let contacts = 0;
    for (let i = 0; i < 4; i++) if (this.vc.wheelIsInContact(i)) contacts++;
    this.grounded = contacts >= 2;

    // yaw stability: pull yaw rate toward the steering-implied rate (arcade predictability)
    if (this.grounded) {
      const implied = (fwdSpeed * Math.tan(this.steerAngle)) / CAR_SPEC.wheelBase;
      const maxRate = Math.min(2.2, 26 / Math.max(5, Math.abs(fwdSpeed))); // lateral-g cap
      const desired = THREE.MathUtils.clamp(implied, -maxRate, maxRate);
      const yaw = av.x * _up.x + av.y * _up.y + av.z * _up.z;
      const offK = this.offTrack > 0 ? 0.03 : 0.11;
      const corr = (desired - yaw) * offK;
      // lateral slip damping (keeps the car from snapping into spins)
      const slipK = this.offTrack > 0 ? 0.015 : 0.05;
      const dLat = -latSpeed * slipK;
      body.setLinvel({ x: lv.x + _right.x * dLat, y: lv.y, z: lv.z + _right.z * dLat }, true);
      // damp roll/pitch rates, apply yaw correction
      const rollRate = av.x * _fwd.x + av.y * _fwd.y + av.z * _fwd.z;
      const pitchRate = av.x * _right.x + av.y * _right.y + av.z * _right.z;
      body.setAngvel({
        x: av.x + _up.x * corr - _fwd.x * rollRate * 0.15 - _right.x * pitchRate * 0.1,
        y: av.y + _up.y * corr - _fwd.y * rollRate * 0.15 - _right.y * pitchRate * 0.1,
        z: av.z + _up.z * corr - _fwd.z * rollRate * 0.15 - _right.z * pitchRate * 0.1,
      }, true);
      this.slip = Math.min(1, Math.max(0, (Math.abs(latSpeed) - 1.5) / 5) + (this.brake > 0.7 && Math.abs(fwdSpeed) > 15 ? 0.25 : 0) + (this.handbrake && Math.abs(fwdSpeed) > 5 ? 0.6 : 0));
    } else {
      this.slip = 0;
    }
    // tilt limiter: whatever pushes the car (kerbs, barriers, other cars), never let it roll over.
    // Below ~17 deg of tilt this does nothing, so normal driving is unaffected.
    const tilt = Math.acos(THREE.MathUtils.clamp(_up.y, -1, 1));
    if (tilt > 0.3) {
      // axis that rotates the car's up vector back toward world up
      const ax = _up.z, az = -_up.x; // cross(up, worldUp) = (-up.z?..) -> (up.z, 0, -up.x) up to sign
      const len = Math.hypot(ax, az) || 1;
      const nx = -ax / len, nz = -az / len;
      const a2 = body.angvel();
      const wAlong = a2.x * nx + a2.z * nz; // current rate about the righting axis
      const want = Math.min(4, (tilt - 0.25) * 7); // rad/s toward upright
      if (wAlong < want) {
        const k = Math.min(1, (tilt - 0.3) * 4 + 0.35);
        body.setAngvel({ x: a2.x + nx * (want - wAlong) * k, y: a2.y * 0.98, z: a2.z + nz * (want - wAlong) * k }, true);
      }
    }
    this.upright = _up.y;

    // wheel spin for visuals
    for (let i = 0; i < 4; i++) {
      const rad = this.wheels[i].r;
      this.wheelSpin[i] += (fwdSpeed / rad) * dt;
    }

    this._thermals(dt, fwdSpeed);

    // interpolation buffers
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    const t = body.translation();
    this.currPos.set(t.x, t.y, t.z);
    this.currQuat.copy(_q);
  }

  /** Visual state: brake disc temperature (glow), wheel slip (smoke/marks), suspension compression. */
  _thermals(dt, fwdSpeed) {
    const S = CAR_SPEC;
    const vc = this.vc;
    const body = this.body;
    const v = Math.abs(fwdSpeed);
    const av = body.angvel();
    _av.set(av.x, av.y, av.z);
    const amb = this.ambient;
    let bottom = 0;
    for (let i = 0; i < 4; i++) {
      const wd = this.wheels[i];
      const contact = vc.wheelIsInContact(i) && !this.dmg.wheelLost[i];
      // sideways sliding speed of the contact patch (visual only: smoke and rubber marks)
      _rp.set(_right.x * -wd.x + _fwd.x * wd.z - _up.x * 0.36, _right.y * -wd.x + _fwd.y * wd.z - _up.y * 0.36, _right.z * -wd.x + _fwd.z * wd.z - _up.z * 0.36);
      _w.crossVectors(_av, _rp).add(_v);
      const st = i < 2 ? this.steerAngle : 0;
      const ax = _right.x * Math.cos(st) + _fwd.x * Math.sin(st);
      const az = _right.z * Math.cos(st) + _fwd.z * Math.sin(st);
      const latSlip = contact ? Math.abs(_w.x * ax + _w.z * az) : 0;
      // rear wheelspin estimate (visual only)
      const load = Math.max(0, vc.wheelSuspensionForce(i) || 0);
      const limit = Math.max(1, load * 2.6);
      const spin = i >= 2 && contact ? Math.max(0, Math.min(1, (Math.abs(this._engineForce) * 0.5 - limit * 0.9) / (limit * 0.6))) : 0;
      this.wheelSpinUp[i] = spin;
      this.wheelSlip[i] = Math.max(0, latSlip - 0.8) + spin * 6;

      // brake disc temperature: heats with braking intensity x speed, cools with airflow (visual glow)
      const share = i < 2 ? 0.56 : 0.44;
      const bh = 9.5 * (this._brakeCmd || 0) * share * 2 * v;
      const bc = 0.11 * (this.brakeTemp[i] - amb) * (0.3 + v / 45);
      this.brakeTemp[i] = Math.max(amb, this.brakeTemp[i] + (bh - bc) * dt);

      const len = vc.wheelSuspensionLength(i) ?? S.suspRest;
      const c = Math.max(0, Math.min(1, (S.suspRest - len) / 0.16));
      this.compression[i] = c;
      if (contact && c > 0.82) bottom = Math.max(bottom, (c - 0.82) / 0.18);
    }
    this.bottoming = bottom * Math.min(1, v / 40);
  }

  _updateGearbox(dt, kmh, speed) {
    const S = this.spec;
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    const top = S.gears[this.gear];
    const low = S.gears[this.gear - 1] || 0;
    let rpm = S.idleRpm + (kmh / top) * (S.maxRpm - S.idleRpm);
    if (this.transmission === 'manual') {
      // the driver selects gears; the engine just follows road speed (limiter at max rpm)
      if (this.throttle > 0 && kmh < 8 && !this.locked && this.gear <= 2) rpm = Math.max(rpm, 6500 + this.throttle * 2000);
      if (this.locked && this.throttle > 0) rpm = S.idleRpm + this.throttle * (S.maxRpm - S.idleRpm) * 0.85;
      if (speed < -0.5) rpm = S.idleRpm + (kmh / 40) * 5000;
      rpm = Math.min(S.maxRpm * 1.01, rpm);
      this.rpm += (rpm - this.rpm) * Math.min(1, dt * 22);
      return;
    }
    if (speed < -0.5) {
      this.gear = 1;
      rpm = S.idleRpm + (kmh / 40) * 5000;
    } else if (this.shiftTimer <= 0) {
      if (rpm > S.maxRpm * 0.985 && this.gear < S.gears.length - 1) {
        this.gear++;
        this.shiftTimer = 0.08;
        this.onGearChange && this.onGearChange(this.gear, true);
      } else if (this.gear > 1 && kmh < low * 0.78) {
        this.gear--;
        this.shiftTimer = 0.06;
        this.onGearChange && this.onGearChange(this.gear, false);
      }
    }
    if (this.throttle > 0 && kmh < 8 && !this.locked) rpm = Math.max(rpm, 6500 + this.throttle * 2000);
    if (this.locked && this.throttle > 0) rpm = S.idleRpm + this.throttle * (S.maxRpm - S.idleRpm) * 0.85;
    rpm = Math.min(S.maxRpm, rpm);
    this.rpm += (rpm - this.rpm) * Math.min(1, dt * 18);
  }

  /** Interpolated transform for rendering. */
  getInterpolated(alpha, outPos, outQuat) {
    outPos.lerpVectors(this.prevPos, this.currPos, alpha);
    outQuat.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
  }

  /** Wheel state for visuals: suspension length & steering. */
  wheelSuspension(i) {
    return this.vc.wheelSuspensionLength(i) ?? CAR_SPEC.suspRest;
  }

  dispose() {
    this.world.removeVehicleController(this.vc);
    this.world.removeRigidBody(this.body);
  }
}

function smooth01(x) {
  x = Math.min(1, Math.max(0, x));
  return x * x * (3 - 2 * x);
}
