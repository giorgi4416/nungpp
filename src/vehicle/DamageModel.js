import * as THREE from 'three';

/**
 * Crash damage driven by real collisions.
 *
 * Every contact between the player's chassis colliders and a barrier / other car
 * is accumulated into an "impact episode" (the few physics steps a crash lasts).
 * When the episode ends it is resolved from:
 *   - severity:  the velocity change of the car during the episode (m/s) —
 *                a gentle touch changes velocity a little, a 200 km/h wall hit a lot
 *   - direction: that velocity change expressed in the car's frame (front/rear/side, left/right)
 *   - contact:   which collider was hit (front wing, rear wing, sidepods, tub)
 *
 * Severity levels: < 5 m/s nothing, MINOR, MODERATE, SEVERE, TERMINAL.
 * Effects are applied to the model (bend / crumple / detach real components)
 * and to the physics (lost downforce, steering pull, soft corners, lost wheels,
 * engine failure).
 */
export const LEVELS = ['NONE', 'MINOR', 'MODERATE', 'SEVERE', 'TERMINAL'];
const THRESH = [5, 11, 20, 30]; // m/s velocity change for MINOR / MODERATE / SEVERE / TERMINAL

const _q = new THREE.Quaternion(), _inv = new THREE.Quaternion(), _l = new THREE.Vector3(), _p = new THREE.Vector3(), _v = new THREE.Vector3();
const CORNERS = ['suspFL', 'suspFR', 'suspRL', 'suspRR'];

export class DamageModel {
  /**
   * @param fx {sparks(pos, vel, n), notify(label, value, style), sound(strength), shake(amount)}
   */
  constructor(car, physics, debris, fx) {
    this.car = car;
    this.physics = physics;
    this.debris = debris;
    this.fx = fx;
    this.enabled = true;
    this.reset();
  }

  setCar(car) {
    this.car = car;
    this.reset();
  }

  /** Full repair (respawn). */
  reset() {
    if (this.car) {
      for (const c of Object.values(this.car.components || {})) if (!c.attached) this.debris.release(c.group);
      for (const w of this.car.wheels || []) if (!w.attached) this.debris.release(w.pivot);
      this.car.repair();
    }
    this.physics && this.physics.repair();
    this.health = { frontWing: 1, nose: 1, rearWing: 1, sidepodL: 1, sidepodR: 1, corner: [1, 1, 1, 1], engine: 1 };
    this.wheelLost = [false, false, false, false];
    this.level = 0;
    this.total = 0;
    this.episode = null;
    this.log = [];
  }

  /** Called for every relevant contact force event of a physics step. */
  onContact(part, dv) {
    if (!this.enabled) return;
    const e = (this.episode ||= { dv: new THREE.Vector3(), parts: new Set(), age: 0, quiet: 0, peak: 0 });
    e.dv.add(dv);
    e.parts.add(part);
    e.quiet = 0;
    e.peak = Math.max(e.peak, dv.length());
  }

  /** Advance; resolves an episode once contacts have stopped for a moment. */
  update(dt) {
    const e = this.episode;
    if (!e) return null;
    e.age += dt;
    e.quiet += dt;
    if (e.quiet < 0.08 && e.age < 0.35) return null;
    this.episode = null;
    return this._resolve(e);
  }

  _resolve(e) {
    const sev = Math.max(e.dv.length(), e.peak);
    if (sev < THRESH[0]) return null;
    const level = sev >= THRESH[3] ? 4 : sev >= THRESH[2] ? 3 : sev >= THRESH[1] ? 2 : 1;
    // direction in the car frame (+Z forward, +X left)
    const r = this.physics.body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    _inv.copy(_q).invert();
    _l.copy(e.dv).applyQuaternion(_inv);
    // the direction of the velocity change decides the zone; the contacted colliders add secondary damage
    const zone = Math.abs(_l.x) > Math.abs(_l.z) * 0.9 ? 'side' : _l.z < 0 ? 'front' : 'rear';
    // side of the car that took the hit: pushed toward +X -> hit on the right (-X)
    const side = Math.abs(_l.x) > 0.25 * Math.abs(_l.z) ? (_l.x > 0 ? 'R' : 'L') : 'C';
    const frontish = zone === 'front' || (zone === 'side' && e.parts.has('frontWing'));
    const info = { level, severity: sev, zone, side, levelName: LEVELS[level], parts: e.parts };
    this.log.push(info);
    this._apply(info, frontish);
    this.level = Math.max(this.level, level);
    this._syncPhysics();
    this._feedback(info);
    return info;
  }

  _apply({ level, zone, side, severity, parts }, frontish) {
    const car = this.car;
    const H = this.health;
    const sgn = side === 'L' ? 1 : side === 'R' ? -1 : (Math.random() < 0.5 ? 1 : -1);
    const jitter = (a) => (Math.random() - 0.5) * a;
    const hitCorner = (i, amount) => {
      H.corner[i] = Math.max(0, H.corner[i] - amount);
      car.bendWheel && car.bendWheel(i, amount * 0.12 * (Math.random() < 0.5 ? 1 : -1), amount * 0.07 * (i < 2 ? 1 : 0.4) * sgn);
      car.deform(CORNERS[i], { pitch: jitter(0.2 * amount), roll: jitter(0.25 * amount) });
    };
    if (zone === 'front') {
      const amt = [0, 0.18, 0.45, 1, 1][level];
      H.frontWing = Math.max(0, H.frontWing - amt);
      car.deform('frontWing', { pitch: 0.05 * level + jitter(0.03), yaw: jitter(0.05 * level), roll: jitter(0.08 * level), sag: 0.01 * level });
      if (level >= 2) {
        H.nose = Math.max(0, H.nose - 0.3 * (level - 1));
        car.deform('nose', { pitch: 0.04 * level, crumple: new THREE.Vector3(1, 1 - 0.03 * level, 1 - 0.06 * level) });
      }
      if (level >= 3) {
        this._detach('frontWing', 1.2);
        const corners = side === 'C' ? [0, 1] : [side === 'L' ? 0 : 1];
        for (const i of corners) hitCorner(i, level === 3 ? 0.6 : 1);
      }
      if (level >= 4) {
        this._detach('nose', 1.4);
        for (const i of side === 'C' ? [0, 1] : [side === 'L' ? 0 : 1]) this._loseWheel(i);
        H.engine = 0.2;
      }
    } else if (zone === 'rear') {
      H.rearWing = Math.max(0, H.rearWing - [0, 0.18, 0.45, 1, 1][level]);
      car.deform('rearWing', { pitch: -0.05 * level + jitter(0.03), roll: jitter(0.08 * level) });
      if (level >= 3) {
        this._detach('rearWing', 1.3);
        for (const i of side === 'C' ? [2, 3] : [side === 'L' ? 2 : 3]) hitCorner(i, level === 3 ? 0.55 : 1);
      }
      if (level >= 4) {
        for (const i of side === 'C' ? [2, 3] : [side === 'L' ? 2 : 3]) this._loseWheel(i);
        H.engine = 0.15;
      }
    } else {
      const pod = sgn > 0 ? 'sidepodL' : 'sidepodR';
      H[pod] = Math.max(0, H[pod] - [0, 0.15, 0.4, 0.8, 1][level]);
      car.deform(pod, { crumple: new THREE.Vector3(1 - 0.07 * level, 1 - 0.02 * level, 1), yaw: jitter(0.04 * level) });
      const iF = sgn > 0 ? 0 : 1, iR = sgn > 0 ? 2 : 3;
      if (level >= 2) hitCorner(frontish ? iF : iR, level === 2 ? 0.3 : 0.6);
      if (level >= 3) {
        hitCorner(frontish ? iR : iF, 0.4);
        if (severity > 20) this._loseWheel(frontish ? iF : iR);
      }
      // a side hit that also caught a wing: the endplate side of that wing takes the blow
      for (const wing of ['frontWing', 'rearWing']) {
        if (!parts.has(wing)) continue;
        H[wing] = Math.max(0, H[wing] - [0, 0.1, 0.3, 0.6, 1][level]);
        car.deform(wing, { yaw: 0.04 * level * sgn, roll: 0.05 * level * sgn + jitter(0.03) });
        if (level >= 3 && severity > 24) this._detach(wing, 1.0);
      }
      if (level >= 4) {
        this._detach(pod, 1.0);
        this._loseWheel(iF);
        this._loseWheel(iR);
        H.engine = 0.2;
      }
    }
    if (level >= 4) this._detach(zone === 'rear' ? 'frontWing' : 'rearWing', 0.9);
    const lost = this.wheelLost.filter(Boolean).length;
    this.total = Math.min(1, (1 - H.frontWing) * 0.15 + (1 - H.rearWing) * 0.15 + (1 - H.nose) * 0.1 + ((1 - H.sidepodL) + (1 - H.sidepodR)) * 0.05 +
      H.corner.reduce((a, c) => a + (1 - c) * 0.06, 0) + lost * 0.2 + (1 - H.engine) * 0.4);
  }

  _carVelocity(out) {
    const lv = this.physics.body.linvel();
    return out.set(lv.x, lv.y, lv.z);
  }

  _detach(name, kick) {
    const obj = this.car.detach(name);
    if (!obj) return;
    if (name === 'frontWing') this.health.frontWing = 0;
    if (name === 'rearWing') this.health.rearWing = 0;
    const v = this._carVelocity(_v).multiplyScalar(0.55);
    v.x += (Math.random() - 0.5) * 6 * kick;
    v.y += 2 + Math.random() * 4 * kick;
    v.z += (Math.random() - 0.5) * 6 * kick;
    this.debris.addPiece(obj, v, new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12), { radius: 0.25 });
    this.debris.burst(obj.position, v, 18, this.car.car.primary);
    this.fx.sparks && this.fx.sparks(obj.position, v, 14);
  }

  _loseWheel(i) {
    if (this.wheelLost[i]) return;
    this.wheelLost[i] = true;
    this.health.corner[i] = 0;
    const obj = this.car.detachWheel(i);
    this.car.detach(CORNERS[i]); // the broken suspension goes with it (not simulated as debris)
    if (!obj) return;
    const v = this._carVelocity(_v).multiplyScalar(0.8);
    v.y += 3 + Math.random() * 3;
    v.x += (Math.random() - 0.5) * 5;
    v.z += (Math.random() - 0.5) * 5;
    this.debris.addPiece(obj, v, new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 20), { radius: 0.66 });
  }

  /** Translate component health into physics behaviour. */
  _syncPhysics() {
    const H = this.health;
    const car = this.car;
    const fwOn = car.hasComponent('frontWing'), rwOn = car.hasComponent('rearWing');
    const steerBias = ((1 - H.corner[0]) - (1 - H.corner[1])) * 0.035; // a bent corner pulls the car
    this.physics.applyDamage({
      frontAero: fwOn ? 0.45 + 0.55 * H.frontWing : 0.05,
      rearAero: rwOn ? 0.45 + 0.55 * H.rearWing : 0.05,
      drag: 1 + (1 - H.frontWing) * 0.04 + (1 - H.sidepodL + 1 - H.sidepodR) * 0.03 - (rwOn ? 0 : 0.12),
      power: H.engine,
      steerBias,
      wheelGrip: H.corner.map((c) => 0.62 + 0.38 * c),
      suspSoft: H.corner.map((c) => 0.45 + 0.55 * c),
      wheelLost: this.wheelLost.slice(),
    });
  }

  _feedback({ level, zone, severity }) {
    const fx = this.fx;
    const body = this.physics.body.translation();
    _p.set(body.x, body.y, body.z);
    const vel = this._carVelocity(_v);
    fx.sound && fx.sound(Math.min(1, severity / 28), level);
    fx.shake && fx.shake(0.15 + level * 0.14);
    if (level >= 2) {
      this.debris.burst(_p, vel, 6 + level * 8, this.car.car.primary);
      fx.sparks && fx.sparks(_p, vel, 6 + level * 6);
    }
    const where = zone === 'front' ? 'FRONT' : zone === 'rear' ? 'REAR' : 'SIDE';
    const msg = ['', `${where} DAMAGE`, `${where} DAMAGE`, `HEAVY ${where} DAMAGE`, 'TERMINAL DAMAGE'][level];
    const style = ['', 'yellow', 'yellow', 'red', 'warn'][level];
    if (msg && fx.notify) fx.notify(msg, level === 4 ? 'PRESS R TO RESPAWN' : LEVELS[level], style);
  }

  /** 0..1 damage for each part, for the HUD. */
  status() {
    const H = this.health;
    const car = this.car;
    return {
      frontWing: car.hasComponent('frontWing') ? H.frontWing : -1,
      nose: car.hasComponent('nose') ? H.nose : -1,
      rearWing: car.hasComponent('rearWing') ? H.rearWing : -1,
      sidepodL: car.hasComponent('sidepodL') ? H.sidepodL : -1,
      sidepodR: car.hasComponent('sidepodR') ? H.sidepodR : -1,
      corner: H.corner.map((c, i) => (this.wheelLost[i] ? -1 : c)),
      engine: H.engine,
      level: this.level,
      total: this.total,
    };
  }
}
