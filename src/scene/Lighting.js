import * as THREE from 'three';
import { SUN_DIRECTION } from './createScene.js';

/**
 * Sun + sky lighting. The shadow frustum is small and follows the camera
 * focus, which keeps shadows crisp around the cars at low cost.
 */
export class Lighting {
  constructor(scene, quality) {
    this.scene = scene;
    this.hemi = new THREE.HemisphereLight(0xdfeaff, 0x55603a, 0.45);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.9);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.focus = new THREE.Vector3();
    this.applyQuality(quality);
  }

  /** 0 = open sky, 1 = deep inside a tunnel. */
  setDimming(f) {
    if (this._baseSun === undefined) { this._baseSun = this.sun.intensity; this._baseHemi = this.hemi.intensity; }
    this.sun.intensity = this._baseSun * (1 - 0.94 * f);
    this.hemi.intensity = this._baseHemi * (1 - 0.8 * f);
  }

  applyQuality(q) {
    const s = this.sun.shadow;
    if (s.mapSize.x !== q.shadowMap) {
      s.mapSize.set(q.shadowMap, q.shadowMap);
      if (s.map) {
        s.map.dispose();
        s.map = null;
      }
    }
    const r = q.shadowRange;
    const cam = s.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
    cam.near = 1; cam.far = 600;
    cam.updateProjectionMatrix();
    this.range = r;
  }

  /** Keep the shadow box centred on `target`, snapped to texels to avoid shimmering. */
  update(target) {
    const texel = (this.range * 2) / this.sun.shadow.mapSize.x;
    this.focus.set(Math.round(target.x / texel) * texel, Math.round(target.y / texel) * texel, Math.round(target.z / texel) * texel);
    this.sun.target.position.copy(this.focus);
    this.sun.position.copy(this.focus).addScaledVector(SUN_DIRECTION, 300);
  }
}
