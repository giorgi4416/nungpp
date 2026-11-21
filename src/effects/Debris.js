import * as THREE from 'three';

/**
 * Lightweight rigid-ish debris: detached car parts (wings, wheels, nose...) and
 * small carbon-fibre shards. Simple ballistic integration with ground bounce,
 * friction and tumbling — cheap enough to never touch the physics engine.
 */
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();

export class Debris {
  constructor(scene, groundAt, maxShards = 220) {
    this.scene = scene;
    this.groundAt = groundAt;
    this.pieces = [];
    // shards: one instanced mesh (one draw call)
    const geo = new THREE.TetrahedronGeometry(0.06, 0);
    geo.scale(1.4, 0.35, 1);
    this.shardMat = new THREE.MeshStandardMaterial({ color: 0x1c1d21, roughness: 0.35, metalness: 0.4, vertexColors: false });
    this.shards = new THREE.InstancedMesh(geo, this.shardMat, maxShards);
    this.shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shards.frustumCulled = false;
    this.shards.count = 0;
    this.shards.castShadow = false;
    scene.add(this.shards);
    this.max = maxShards;
    this.sp = new Float32Array(maxShards * 3);
    this.sv = new Float32Array(maxShards * 3);
    this.sr = new Float32Array(maxShards * 3);
    this.sw = new Float32Array(maxShards * 3);
    this.sl = new Float32Array(maxShards);
    this.ss = new Float32Array(maxShards);
    this.cursor = 0;
    this.color = new THREE.Color();
  }

  /** A detached part flies off with the car's velocity plus an impulse and tumble. */
  addPiece(obj, vel, spin, { radius = 0.25, life = 25 } = {}) {
    this.scene.add(obj);
    this.pieces.push({ obj, vel: vel.clone(), spin: spin.clone(), radius, life, rest: false });
  }

  /** Remove a piece from the simulation (when the car is repaired it takes the part back). */
  release(obj) {
    const i = this.pieces.findIndex((p) => p.obj === obj);
    if (i >= 0) this.pieces.splice(i, 1);
  }

  /** Small carbon / paint shards. */
  burst(pos, baseVel, n, colorHex = 0x1c1d21, spread = 6) {
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      this.sp[i * 3] = pos.x + (Math.random() - 0.5) * 0.6;
      this.sp[i * 3 + 1] = pos.y + Math.random() * 0.4;
      this.sp[i * 3 + 2] = pos.z + (Math.random() - 0.5) * 0.6;
      this.sv[i * 3] = baseVel.x * 0.6 + (Math.random() - 0.5) * spread;
      this.sv[i * 3 + 1] = 1.5 + Math.random() * spread * 0.8;
      this.sv[i * 3 + 2] = baseVel.z * 0.6 + (Math.random() - 0.5) * spread;
      this.sr[i * 3] = Math.random() * 6; this.sr[i * 3 + 1] = Math.random() * 6; this.sr[i * 3 + 2] = Math.random() * 6;
      this.sw[i * 3] = (Math.random() - 0.5) * 30; this.sw[i * 3 + 1] = (Math.random() - 0.5) * 30; this.sw[i * 3 + 2] = (Math.random() - 0.5) * 30;
      this.sl[i] = 6 + Math.random() * 6;
      this.ss[i] = 0.5 + Math.random() * 1.1;
      this.shards.setColorAt(i, this.color.setHex(Math.random() < 0.6 ? 0x1c1d21 : colorHex));
    }
    this.shards.count = this.max;
    if (this.shards.instanceColor) this.shards.instanceColor.needsUpdate = true;
  }

  update(dt) {
    const G = 9.81;
    // parts
    for (let k = this.pieces.length - 1; k >= 0; k--) {
      const p = this.pieces[k];
      p.life -= dt;
      if (p.life <= 0) {
        p.obj.removeFromParent();
        this.pieces.splice(k, 1);
        continue;
      }
      if (p.rest) continue;
      p.vel.y -= G * dt;
      const o = p.obj;
      o.position.addScaledVector(p.vel, dt);
      _q.setFromEuler(_e.set(p.spin.x * dt, p.spin.y * dt, p.spin.z * dt));
      o.quaternion.multiply(_q);
      const gy = this.groundAt(o.position.x, o.position.z) + p.radius * 0.5;
      if (o.position.y < gy) {
        o.position.y = gy;
        if (p.vel.y < 0) p.vel.y *= -0.28;
        p.vel.x *= 0.82; p.vel.z *= 0.82;
        p.spin.multiplyScalar(0.8);
        if (p.vel.lengthSq() < 0.2 && Math.abs(p.vel.y) < 0.5) p.rest = true;
      }
    }
    // shards
    if (this.shards.count === 0) return;
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.sl[i] <= 0) { _m.makeScale(0, 0, 0); this.shards.setMatrixAt(i, _m); continue; }
      alive++;
      this.sl[i] -= dt;
      this.sv[i * 3 + 1] -= G * dt;
      this.sp[i * 3] += this.sv[i * 3] * dt;
      this.sp[i * 3 + 1] += this.sv[i * 3 + 1] * dt;
      this.sp[i * 3 + 2] += this.sv[i * 3 + 2] * dt;
      const gy = this.groundAt(this.sp[i * 3], this.sp[i * 3 + 2]) + 0.01;
      if (this.sp[i * 3 + 1] < gy) {
        this.sp[i * 3 + 1] = gy;
        this.sv[i * 3 + 1] *= -0.25;
        this.sv[i * 3] *= 0.6; this.sv[i * 3 + 2] *= 0.6;
        this.sw[i * 3] *= 0.6; this.sw[i * 3 + 1] *= 0.6; this.sw[i * 3 + 2] *= 0.6;
      }
      this.sr[i * 3] += this.sw[i * 3] * dt; this.sr[i * 3 + 1] += this.sw[i * 3 + 1] * dt; this.sr[i * 3 + 2] += this.sw[i * 3 + 2] * dt;
      const sc = this.ss[i] * Math.min(1, this.sl[i] / 1.5);
      _q.setFromEuler(_e.set(this.sr[i * 3], this.sr[i * 3 + 1], this.sr[i * 3 + 2]));
      _m.compose(_v.set(this.sp[i * 3], this.sp[i * 3 + 1], this.sp[i * 3 + 2]), _q, _s.set(sc, sc, sc));
      this.shards.setMatrixAt(i, _m);
    }
    this.shards.instanceMatrix.needsUpdate = true;
    if (!alive) this.shards.count = 0;
  }

  /** Remove everything (new session / circuit change). */
  clear() {
    for (const p of this.pieces) p.obj.removeFromParent();
    this.pieces.length = 0;
    this.sl.fill(0);
    this.shards.count = 0;
  }
}
