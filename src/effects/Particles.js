import * as THREE from 'three';
import { smokeSprite } from '../scene/Textures.js';

/**
 * Pooled GPU point particles for tyre smoke and off-track dust.
 * Fixed-size typed arrays: zero allocations per frame.
 */
export class Particles {
  constructor(scene, max = 600) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.size = new Float32Array(max);
    this.color = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aAlpha', this.aAlpha);
    g.setAttribute('aColor', this.aColor);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: smokeSprite() },
        uScale: { value: 600 },
        fogColor: { value: new THREE.Color() },
        fogNear: { value: 0 },
        fogFar: { value: 1 },
      },
      vertexShader: `
        attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
        varying float vAlpha; varying vec3 vColor; varying float vFog;
        uniform float uScale;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / max(0.1, -mv.z);
          vAlpha = aAlpha; vColor = aColor; vFog = -mv.z;
        }`,
      fragmentShader: `
        uniform sampler2D uMap; uniform vec3 fogColor; uniform float fogNear; uniform float fogFar;
        varying float vAlpha; varying vec3 vColor; varying float vFog;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          float a = t.a * vAlpha;
          if (a < 0.01) discard;
          float f = smoothstep(fogNear, fogFar, vFog);
          gl_FragColor = vec4(mix(vColor, fogColor, f), a);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    if (scene.fog) {
      this.material.uniforms.fogColor.value.copy(scene.fog.color);
      this.material.uniforms.fogNear.value = scene.fog.near;
      this.material.uniforms.fogFar.value = scene.fog.far;
    }
  }

  setViewportHeight(h) {
    this.material.uniforms.uScale.value = h * 0.9;
  }

  emit(x, y, z, vx, vy, vz, { life = 1.2, size = 1.2, r = 0.9, g = 0.9, b = 0.92, alpha = 0.5 } = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.size[i] = size;
    this.color[i * 3] = r; this.color[i * 3 + 1] = g; this.color[i * 3 + 2] = b;
    this.alpha[i] = alpha;
    this._baseAlpha = this._baseAlpha || new Float32Array(this.max);
    this._baseAlpha[i] = alpha;
  }

  update(dt) {
    const sz = this.aSize.array;
    const base = this._baseAlpha;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { sz[i] = 0; this.alpha[i] = 0; continue; }
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      if (t >= 1) { this.life[i] = 0; sz[i] = 0; this.alpha[i] = 0; continue; }
      const drag = 1 - Math.min(1, dt * 1.8);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 2] *= drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag + dt * 0.6;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      sz[i] = this.size[i] * (0.6 + t * 2.4);
      this.alpha[i] = base[i] * (1 - t) * Math.min(1, t * 8);
    }
    this.aPos.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
    this.aColor.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
  }
}
