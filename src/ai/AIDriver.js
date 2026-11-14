import * as THREE from 'three';
import { CAR_SPEC } from '../vehicle/VehiclePhysics.js';

/**
 * An AI racer. Motion is continuous along the circuit spline (distance s,
 * lateral offset), driven by a speed profile scaled by the driver's skill,
 * with traffic awareness: following, overtaking on the side with room,
 * side-by-side spacing and reacting to contact. The car is a kinematic
 * Rapier body so the player physically collides with it.
 */

const UP = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _r = new THREE.Vector3();
const _left = new THREE.Vector3(), _up = new THREE.Vector3(), _m = new THREE.Matrix4();

export class AIDriver {
  constructor(RAPIER, world, track, car, profile) {
    this.track = track;
    this.car = car;
    this.profile = profile; // {name, skill, aggression, launch}
    this.name = profile.name;
    const desc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -100, 0);
    this.body = world.createRigidBody(desc);
    const mk = (hx, hy, hz, x, y, z) => world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(0.3).setRestitution(0.2), this.body);
    mk(0.55, 0.3, 2.45, 0, 0.16, -0.1);
    mk(0.95, 0.2, 0.45, 0, 0.0, 1.72); // front wheels
    mk(0.98, 0.22, 0.5, 0, 0.0, -1.88); // rear wheels
    mk(0.95, 0.06, 0.3, 0, -0.12, 2.75); // front wing

    this.difficulty = 1;
    this.s = 0; // unwrapped distance travelled (for the lap system use wrapS)
    this.lateral = 0;
    this.latVel = 0;
    this.speed = 0;
    this.avoid = 0;
    this.speedCap = Infinity;
    this.released = false;
    this.launchDelay = 0;
    this.cooldown = false;
    this.rpm = CAR_SPEC.idleRpm;
    this.gear = 1;
    this.steerVis = 0;
    this.accelLong = 0;
    this.accelLat = 0;
    this.brakeVis = 0;
    this.bumpTimer = 0;
    this.prevPos = new THREE.Vector3();
    this.currPos = new THREE.Vector3();
    this.prevQuat = new THREE.Quaternion();
    this.currQuat = new THREE.Quaternion();
    this.varPhase = Math.random() * 100;
  }

  place(s, lateral) {
    this.s = s;
    this.lateral = lateral;
    this.latVel = 0;
    this.speed = 0;
    this.avoid = 0;
    this.released = false;
    this.cooldown = false;
    this._computePose();
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    this.body.setTranslation({ x: this.currPos.x, y: this.currPos.y, z: this.currPos.z }, true);
    this.body.setRotation({ x: this.currQuat.x, y: this.currQuat.y, z: this.currQuat.z, w: this.currQuat.w }, true);
  }

  release(delay = 0) {
    this.released = true;
    this.launchDelay = delay;
  }

  setEnabled(on) {
    this.body.setEnabled(on);
    this.car.setVisible(on);
    this.enabled = on;
  }

  get wrappedS() {
    return this.track.wrapS(this.s);
  }

  /**
   * @param {number} dt
   * @param {Array} others - [{s (wrapped), lateral, speed, isPlayer}]
   */
  fixedUpdate(dt, others) {
    const T = this.track;
    const P = this.profile;
    const L = T.length;
    const sw = this.wrappedS;
    let skill = P.skill * this.difficulty;
    if (this.cooldown) skill *= 0.7;
    // small, slow pace variation so drivers are not robotic
    skill *= 1 + Math.sin(this.varPhase + this.s * 0.0021) * 0.012;

    // ---- target speed from profile (look ahead covers braking reaction)
    const look = 3 + this.speed * 0.12;
    let vt = T.interp(T.speedProfile, sw + look) * skill;
    // ---- traffic
    let avoidTarget = 0;
    let cap = Infinity;
    const baseLine = T.interp(T.lineOffset, sw);
    for (const o of others) {
      if (o.ref === this) continue;
      let ds = o.s - sw;
      if (ds > L / 2) ds -= L;
      if (ds < -L / 2) ds += L;
      const dl = o.lateral - this.lateral;
      // car ahead in our lane: look as far as our braking distance requires
      const closing = this.speed - Math.max(0, o.speed);
      const brakeDist = closing > 0 ? (this.speed * this.speed - Math.max(0, o.speed) ** 2) / (2 * 12) : 0;
      const range = 28 + brakeDist + this.speed * 0.35;
      if (ds > 0 && ds < range && Math.abs(dl) < 2.6) {
        if (closing > -2) {
          // pick the side with more room for a pass
          const hw = T.halfWidth - 1.3;
          const leftRoom = o.lateral - 2.9 > -hw;
          const rightRoom = o.lateral + 2.9 < hw;
          let side = 0;
          if (leftRoom && rightRoom) side = baseLine > o.lateral ? 1 : -1;
          else if (leftRoom) side = -1;
          else if (rightRoom) side = 1;
          // slow or stopped cars are always avoided; racing passes depend on aggression
          if (side !== 0 && (P.aggression > 0.3 || o.speed < this.speed * 0.6)) {
            avoidTarget = o.lateral + side * 3.3 - baseLine;
          }
          // until we are clear sideways, never carry more speed than we can shed before contact
          if (Math.abs(dl) < 2.3) {
            const gapMin = 7.5;
            const vo = Math.max(0, o.speed);
            const vAllowed = Math.sqrt(vo * vo + 2 * 12 * Math.max(0, ds - gapMin));
            cap = Math.min(cap, vAllowed);
          }
        }
      }
      // alongside: keep a car's width apart
      if (Math.abs(ds) < 6.5 && Math.abs(dl) < 2.6) {
        const push = (2.6 - Math.abs(dl)) * (dl > 0 ? -1 : 1);
        avoidTarget += push * 1.4;
        if (Math.abs(ds) < 5.4 && Math.abs(dl) < 2.15) {
          // overlapping/contact: sidestep immediately instead of leaning on the other car
          this.emergency = (dl > 0 ? -1 : 1) * 4.5;
          if (o.isPlayer) this.bumpTimer = 0.6;
          // the car behind backs off
          if (ds > 0) cap = Math.min(cap, Math.max(0, o.speed - 2));
        }
      }
    }
    if (this.bumpTimer > 0) {
      this.bumpTimer -= dt;
      cap = Math.min(cap, this.speed * 0.985);
    }
    this.speedCap = cap;
    vt = Math.min(vt, cap);

    // ---- longitudinal dynamics
    const vmax = 90 * skill;
    if (!this.released) {
      vt = 0;
    } else if (this.launchDelay > 0) {
      this.launchDelay -= dt;
      vt = 0;
    }
    const accel = 11.5 * skill * Math.max(0.15, 1 - (this.speed / Math.max(30, vmax)) ** 2);
    const brake = 15 + 0.0032 * this.speed * this.speed;
    const prevSpeed = this.speed;
    if (this.speed < vt) this.speed = Math.min(vt, this.speed + accel * dt);
    else this.speed = Math.max(vt, this.speed - brake * dt * 1.1);
    if (!this.released) this.speed = 0;
    this.accelLong = (this.speed - prevSpeed) / dt;
    this.brakeVis = this.accelLong < -8 ? 1 : 0;

    // ---- lateral motion
    this.avoid += (avoidTarget - this.avoid) * Math.min(1, dt * 1.6);
    const hw = T.halfWidth - 1.15;
    const latTarget = THREE.MathUtils.clamp(baseLine + this.avoid, -hw, hw);
    const maxLatV = 2.2 + this.speed * 0.035;
    let wantV = THREE.MathUtils.clamp((latTarget - this.lateral) * 1.8, -maxLatV, maxLatV);
    if (this.emergency) {
      wantV = this.emergency;
      this.emergency = 0;
      this.latVel += (wantV - this.latVel) * Math.min(1, dt * 12);
    }
    this.latVel += (wantV - this.latVel) * Math.min(1, dt * 4);
    this.lateral = THREE.MathUtils.clamp(this.lateral + this.latVel * dt, -hw - 0.3, hw + 0.3);

    this.s += this.speed * dt;

    // ---- gearbox (sound/HUD)
    const kmh = this.speed * 3.6;
    const gears = CAR_SPEC.gears;
    while (this.gear < gears.length - 1 && kmh > gears[this.gear] * 0.97) this.gear++;
    while (this.gear > 1 && kmh < gears[this.gear - 1] * 0.8) this.gear--;
    this.rpm = CAR_SPEC.idleRpm + Math.min(1, kmh / gears[this.gear]) * (CAR_SPEC.maxRpm - CAR_SPEC.idleRpm);

    // ---- pose
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    this._computePose();
    this.body.setNextKinematicTranslation({ x: this.currPos.x, y: this.currPos.y, z: this.currPos.z });
    this.body.setNextKinematicRotation({ x: this.currQuat.x, y: this.currQuat.y, z: this.currQuat.z, w: this.currQuat.w });
    // visuals: steer from path curvature + lateral motion
    const k = T.interp(T.curv, sw);
    const steer = Math.atan(CAR_SPEC.wheelBase * k) - Math.atan2(this.latVel, Math.max(5, this.speed)) * 0.8;
    this.steerVis += (THREE.MathUtils.clamp(steer, -0.35, 0.35) - this.steerVis) * Math.min(1, dt * 8);
    this.accelLat = this.speed * this.speed * k;
  }

  _computePose() {
    const T = this.track;
    T.sampleAt(this.s, this.lateral, _p, _t, _r);
    _p.y += CAR_SPEC.wheelRadiusR + 0.005;
    // heading offset from lateral velocity
    const yawOff = Math.atan2(this.latVel, Math.max(4, this.speed));
    _t.applyAxisAngle(UP, -yawOff * 1); // + latVel (to the right) turns heading right
    _left.crossVectors(UP, _t).normalize();
    _up.crossVectors(_t, _left).normalize();
    _m.makeBasis(_left, _up, _t);
    this.currQuat.setFromRotationMatrix(_m);
    this.currPos.copy(_p);
  }

  /** Interpolated visual pose. */
  getInterpolated(alpha, outPos, outQuat) {
    outPos.lerpVectors(this.prevPos, this.currPos, alpha);
    outQuat.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
  }
}
