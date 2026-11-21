import * as THREE from 'three';

/**
 * Rubber marks laid down by sliding, locking or spinning tyres. A fixed ring
 * buffer of quads (one draw call, no allocations): the oldest marks are reused.
 */
export class SkidMarks {
  constructor(scene, maxQuads = 1600) {
    this.max = maxQuads;
    this.pos = new Float32Array(maxQuads * 6 * 3);
    this.col = new Float32Array(maxQuads * 6 * 4);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('color', this.aCol);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.cursor = 0;
    this.last = [null, null, null, null];
    this.dirty = false;
  }

  /** Add a mark segment for wheel i at world point p (ground contact), lateral dir r, intensity 0..1. */
  add(i, p, rx, rz, intensity, width = 0.32) {
    const prev = this.last[i];
    if (!prev || intensity <= 0) {
      this.last[i] = intensity > 0 ? [p.x, p.y, p.z, rx, rz] : null;
      return;
    }
    const dx = p.x - prev[0], dz = p.z - prev[2];
    const d2 = dx * dx + dz * dz;
    if (d2 < 0.16) return; // segment at least 0.4 m
    if (d2 > 9) { this.last[i] = [p.x, p.y, p.z, rx, rz]; return; } // teleport/reset
    const k = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const hw = width / 2;
    const y0 = prev[1] + 0.02, y1 = p.y + 0.02;
    const a = [prev[0] - prev[3] * hw, y0, prev[2] - prev[4] * hw];
    const b = [prev[0] + prev[3] * hw, y0, prev[2] + prev[4] * hw];
    const c = [p.x - rx * hw, y1, p.z - rz * hw];
    const d = [p.x + rx * hw, y1, p.z + rz * hw];
    const verts = [a, b, c, b, d, c];
    const alpha = Math.min(0.55, 0.12 + intensity * 0.45);
    for (let v = 0; v < 6; v++) {
      this.pos.set(verts[v], (k * 6 + v) * 3);
      this.col.set([0.035, 0.035, 0.04, alpha], (k * 6 + v) * 4);
    }
    this.last[i] = [p.x, p.y, p.z, rx, rz];
    this.dirty = true;
  }

  endAll() {
    this.last.fill(null);
  }

  update() {
    if (!this.dirty) return;
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.dirty = false;
  }

  clear() {
    this.pos.fill(0);
    this.col.fill(0);
    this.endAll();
    this.dirty = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
}
