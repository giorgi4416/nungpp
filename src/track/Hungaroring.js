import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { KERB_WIDTH } from './TrackGeometry.js';
import { BARRIER_HEIGHT } from './TrackColliders.js';
import * as TX from '../scene/Textures.js';

/**
 * Builds every visual mesh that belongs to the racing circuit itself.
 * All geometry is generated from the TrackGeometry centreline so road,
 * kerbs, barriers, colliders, AI and minimap always agree.
 */

const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _r = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);

function offsetMat(polygonOffset) {
  return polygonOffset ? { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -polygonOffset } : {};
}

/**
 * Ribbon along the track. inner/outer: lateral offsets (functions of index or numbers).
 * mask: optional Uint8Array -> only build where mask[i] is set (open runs).
 */
export function ribbonGeometry(track, inner, outer, { y = 0, yOuter = null, vLen = 10, mask = null, uFlip = false } = {}) {
  const N = track.count;
  const P = track.pos, R = track.right;
  const pos = [], uv = [], idx = [];
  const fIn = typeof inner === 'function' ? inner : () => inner;
  const fOut = typeof outer === 'function' ? outer : () => outer;
  const yo = yOuter == null ? y : yOuter;
  const runs = [];
  if (!mask) runs.push([0, N, true]);
  else {
    let any = false;
    for (let i = 0; i < N; i++) if (mask[i]) { any = true; break; }
    if (any) {
      let allOn = true;
      for (let i = 0; i < N; i++) if (!mask[i]) { allOn = false; break; }
      if (allOn) runs.push([0, N, true]);
      else for (let i = 0; i < N; i++) {
        if (mask[i] && !mask[(i - 1 + N) % N]) {
          let len = 0;
          while (mask[(i + len) % N] && len < N) len++;
          runs.push([i, len, false]);
        }
      }
    }
  }
  const reps = Math.max(1, Math.round(track.length / vLen));
  for (const [a, len, closed] of runs) {
    const base = pos.length / 3;
    const rows = closed ? len + 1 : len + 1;
    for (let k = 0; k < rows; k++) {
      const i = (a + k) % N;
      const ri = fIn(i), ro = fOut(i);
      const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
      const rx = R[i * 3], rz = R[i * 3 + 2];
      pos.push(px + rx * ri, py + y, pz + rz * ri, px + rx * ro, py + yo, pz + rz * ro);
      const v = closed ? (k / len) * reps : (k * track.ds) / vLen;
      uv.push(uFlip ? 1 : 0, v, uFlip ? 0 : 1, v);
      if (k > 0) {
        const c = base + k * 2, p = c - 2;
        // ensure upward-facing winding regardless of inner/outer order
        if (ro > ri) idx.push(p, p + 1, c, p + 1, c + 1, c);
        else idx.push(p, c, p + 1, p + 1, c, c + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A frame at distance s: position (with lateral), tangent and right (flattened). */
function frameAt(track, s, lateral = 0) {
  const p = new THREE.Vector3(), t = new THREE.Vector3(), r = new THREE.Vector3();
  track.sampleAt(s, lateral, p, t, r);
  t.y = 0;
  t.normalize();
  return { p, t, r };
}

/** Matrix placing a local object (+Z forward, +X left) on the track frame. */
function matrixFromFrame(p, forward, scale = _s) {
  _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), forward);
  return new THREE.Matrix4().compose(p, _q, scale);
}

export class Hungaroring {
  constructor(scene, track, barriers, quality, terrain) {
    this.terrain = terrain;
    this.scene = scene;
    this.track = track;
    this.barriers = barriers;
    this.group = new THREE.Group();
    this.group.name = 'circuit';
    scene.add(this.group);
    this.materials = [];
    this._buildRoad();
    this._buildKerbs();
    this._buildGravel();
    this._buildBarriers(quality);
    this._buildPitLane();
    this._buildStartLine();
    this._buildGantry();
    this._buildSignage();
    if (track.def.tunnel) this._buildTunnel();
    if (terrain) this._buildBridgeDecks();
  }

  _mat(params, Type = THREE.MeshStandardMaterial) {
    const m = new Type(params);
    this.materials.push(m);
    return m;
  }

  _add(geo, mat, { cast = false, receive = true, name = '' } = {}) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    mesh.name = name;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    return mesh;
  }

  _buildRoad() {
    const T = this.track;
    const hw = T.halfWidth;
    const asphalt = TX.asphaltTexture();
    const bump = TX.asphaltBump();
    bump.repeat.set(4, 4);
    const road = ribbonGeometry(T, -hw, hw, { y: 0, vLen: hw * 2 });
    this.roadMesh = this._add(road, this._mat({ map: asphalt, bumpMap: bump, bumpScale: 0.6, roughness: 0.88, metalness: 0.0, color: 0xffffff }), { name: 'road' });

    // tarmac verge either side (under kerbs), slightly darker, then a grass-coloured edge fade
    const vergeMat = this._mat({ map: asphalt, color: 0x9a9a9a, roughness: 0.92, ...offsetMat(2) });
    const vL = ribbonGeometry(T, -hw - 2.2, -hw + 0.02, { y: -0.012, vLen: 13.5, uFlip: false });
    const vR = ribbonGeometry(T, hw - 0.02, hw + 2.2, { y: -0.012, vLen: 13.5 });
    // UVs of verge sample the middle of the asphalt texture (no edge lines)
    for (const g of [vL, vR]) {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, 0.3 + uv.getX(i) * 0.15);
    }
    this._add(mergeGeometries([vL, vR]), vergeMat, { name: 'verge' });
  }

  _buildKerbs() {
    const T = this.track;
    const hw = T.halfWidth;
    const mat = this._mat({ map: TX.kerbTexture(), roughness: 0.6, ...offsetMat(4) });
    const kL = ribbonGeometry(T, -hw + 0.12, -hw - KERB_WIDTH, { y: 0.008, yOuter: 0.05, vLen: 4, mask: T.kerbL });
    const kR = ribbonGeometry(T, hw - 0.12, hw + KERB_WIDTH, { y: 0.008, yOuter: 0.05, vLen: 4, mask: T.kerbR });
    const parts = [kL, kR].filter((g) => g.attributes.position.count > 0);
    if (parts.length) this._add(mergeGeometries(parts), mat, { name: 'kerbs' });
  }

  _buildGravel() {
    const T = this.track;
    const hw = T.halfWidth;
    const tex = TX.gravelTexture();
    const mat = this._mat({ map: tex, roughness: 1, color: 0xf2eadb, ...offsetMat(2) });
    const off = this.barriers;
    const gL = ribbonGeometry(T, -hw - 4.5, (i) => -Math.max(hw + 6, off.offL[i] - 1.2), { y: -0.035, vLen: 8, mask: T.gravelL });
    const gR = ribbonGeometry(T, hw + 4.5, (i) => Math.max(hw + 6, off.offR[i] - 1.2), { y: -0.035, vLen: 8, mask: T.gravelR });
    // planar UVs so gravel is not stretched
    for (const g of [gL, gR]) {
      const p = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 6, p.getZ(i) / 6);
    }
    const parts = [gL, gR].filter((g) => g.attributes.position.count > 0);
    if (parts.length) this._add(mergeGeometries(parts), mat, { name: 'gravel' });
  }

  _wallGeometry(line, offsets, outwardSign, height, thickness) {
    const T = this.track;
    const N = T.count;
    const pos = [], uv = [], idx = [];
    let dist = 0;
    for (let k = 0; k <= N; k++) {
      const i = k % N;
      const x = line[i * 3], y = line[i * 3 + 1], z = line[i * 3 + 2];
      const rx = T.right[i * 3] * outwardSign, rz = T.right[i * 3 + 2] * outwardSign;
      if (k > 0) {
        const j = (k - 1) % N;
        dist += Math.hypot(x - line[j * 3], z - line[j * 3 + 2]);
      }
      const u = dist / 24;
      // inner face bottom/top, outer top/bottom
      pos.push(x, y - 0.4, z, x, y + height, z, x + rx * thickness, y + height, z + rz * thickness, x + rx * thickness, y - 0.4, z + rz * thickness);
      uv.push(u, 0, u, 1, u, 0, u, 1);
      if (k > 0) {
        const c = k * 4, p = c - 4;
        for (let f = 0; f < 3; f++) idx.push(p + f, c + f, p + f + 1, p + f + 1, c + f, c + f + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    // group 0: inner face (sponsor band), group 1: cap + outer face
    g.addGroup(0, idx.length, 0);
    g.computeVertexNormals();
    return g;
  }

  _buildBarriers(quality) {
    const T = this.track;
    const B = this.barriers;
    const tex = TX.barrierTexture();
    const mat = this._mat({ map: tex, roughness: 0.7, side: THREE.DoubleSide });
    const left = this._wallGeometry(B.left, B.offL, -1, BARRIER_HEIGHT, 0.5);
    const right = this._wallGeometry(B.right, B.offR, 1, BARRIER_HEIGHT, 0.5);
    this._add(mergeGeometries([left, right]), mat, { cast: true, name: 'barriers' });

    // tyre walls in front of barriers at the outside of corners (gravel zones)
    const tyreGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.95, 8, 1);
    const tyreMat = this._mat({ color: 0x1a1a1c, roughness: 0.9 });
    const bandMat = this._mat({ color: 0xf0f0f0, roughness: 0.6 });
    const pts = [];
    const N = T.count;
    for (const [mask, line, sign] of [[T.gravelL, B.left, 1], [T.gravelR, B.right, -1]]) {
      for (let i = 0; i < N; i += 1) {
        if (!mask[i]) continue;
        for (const row of [0.45, 1.15]) {
          const rx = T.right[i * 3] * sign, rz = T.right[i * 3 + 2] * sign; // toward the track
          pts.push([line[i * 3] + rx * row + (i % 2) * 0.1, line[i * 3 + 1] + 0.47, line[i * 3 + 2] + rz * row]);
        }
      }
    }
    const tyres = new THREE.InstancedMesh(tyreGeo, tyreMat, pts.length);
    const band = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.365, 0.365, 0.16, 8, 1, true), bandMat, pts.length);
    pts.forEach((p, k) => {
      _m.makeTranslation(p[0], p[1], p[2]);
      tyres.setMatrixAt(k, _m);
      _m.makeTranslation(p[0], p[1] + 0.2, p[2]);
      band.setMatrixAt(k, _m);
    });
    tyres.castShadow = quality.shadows;
    tyres.receiveShadow = true;
    this.group.add(tyres, band);

    // catch fencing on the main straight and grandstand corners
    const fenceTex = TX.fenceTexture();
    const fenceMat = this._mat({ map: fenceTex, transparent: false, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.5 });
    const fenceMask = new Uint8Array(N);
    const street = !!T.def.runoff.street;
    for (let i = 0; i < N; i++) {
      const s = i * T.ds;
      if (street || s < T.def.pit.to + 350 || s > T.length + T.def.pit.from - 100) fenceMask[i] = 1;
    }
    const fences = [];
    for (const [line, mask] of [[B.left, fenceMask], [B.right, fenceMask]]) {
      const pos = [], uv = [], idx = [];
      let dist = 0, row = 0;
      for (let i = 0; i < N; i++) {
        if (!mask[i]) continue;
        const x = line[i * 3], y = line[i * 3 + 1], z = line[i * 3 + 2];
        if (row > 0) dist += T.ds;
        pos.push(x, y + BARRIER_HEIGHT, z, x, y + BARRIER_HEIGHT + 3.2, z);
        uv.push(dist / 3.2, 0, dist / 3.2, 1);
        if (row > 0 && mask[i - 1]) {
          const c = row * 2, p = c - 2;
          idx.push(p, c, p + 1, p + 1, c, c + 1);
        }
        row++;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      fences.push(g);
    }
    this._add(mergeGeometries(fences), fenceMat, { name: 'fence' });
  }

  _buildPitLane() {
    const T = this.track;
    const L = T.length;
    const N = T.count;
    const mask = new Uint8Array(N);
    const P = T.def.pit;
    const start = L + P.from - 10, end = P.to;
    for (let i = 0; i < N; i++) {
      const s = i * T.ds;
      if (s >= start || s <= end) mask[i] = 1;
    }
    const lane = (i) => {
      const s = i * T.ds;
      const d = s >= start ? s - start : s + (L - start);
      const total = end + (L - start);
      const k = Math.min(1, d / 90, (total - d) / 90);
      return k;
    };
    // pit lane sits behind the pit wall on the pit side, merging at entry and exit
    const sgn = P.side;
    const w0 = T.halfWidth + P.wall + 0.35;
    const innerAbs = (i) => w0 + 5.4 * lane(i);
    const outerAbs = (i) => w0 + 16.4 * lane(i);
    const inner = (i) => sgn * innerAbs(i);
    const outer = (i) => sgn * outerAbs(i);
    this.pitLaneOffset = sgn * (w0 + 10.9);
    const geo = ribbonGeometry(T, inner, outer, { y: -0.01, vLen: 13.5, mask });
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.98 + 0.01);
    this._add(geo, this._mat({ map: TX.asphaltTexture(), color: 0xd0d0d0, roughness: 0.9, ...offsetMat(2) }), { name: 'pitlane' });
    // pit lane centre line (white)
    const line = ribbonGeometry(T, (i) => sgn * (innerAbs(i) + 3.9), (i) => sgn * (innerAbs(i) + 4.1), { y: 0.0, vLen: 8, mask });
    this._add(line, this._mat({ color: 0xf0f0f0, roughness: 0.6, ...offsetMat(4) }), { name: 'pitline' });
    this.pitRange = { start, end };
  }

  _buildStartLine() {
    const T = this.track;
    const hw = T.halfWidth;
    const { p, t } = frameAt(T, 0, 0);
    const tex = TX.checkerTexture();
    tex.repeat.set(2, 1);
    const geo = new THREE.PlaneGeometry(hw * 2, 1.2);
    geo.rotateX(-Math.PI / 2);
    // align plane X across the track, Z along
    const mesh = new THREE.Mesh(geo, this._mat({ map: tex, roughness: 0.6, ...offsetMat(6) }));
    mesh.position.copy(p).add(new THREE.Vector3(0, 0.01, 0));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), t);
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // grid boxes (white brackets) for 5 cars
    const white = this._mat({ color: 0xf2f2f2, roughness: 0.6, ...offsetMat(6) });
    const parts = [];
    this.gridSlots = [];
    for (let k = 0; k < 5; k++) {
      const s = -10 - k * 8.5;
      const lat = k % 2 === 0 ? -2.8 : 2.8;
      const f = frameAt(T, s, lat);
      this.gridSlots.push({ s: T.wrapS(s), lateral: lat });
      const bar = new THREE.PlaneGeometry(2.4, 0.18).rotateX(-Math.PI / 2);
      const sideA = new THREE.PlaneGeometry(0.18, 1.2).rotateX(-Math.PI / 2).translate(1.2, 0, -0.6);
      const sideB = new THREE.PlaneGeometry(0.18, 1.2).rotateX(-Math.PI / 2).translate(-1.2, 0, -0.6);
      const g = mergeGeometries([bar, sideA, sideB]);
      g.translate(0, 0, 3.1);
      g.applyMatrix4(matrixFromFrame(f.p.clone().add(new THREE.Vector3(0, 0.012, 0)), f.t));
      parts.push(g);
    }
    // pole position marker painted "P1"
    const g = mergeGeometries(parts);
    this._add(g, white, { name: 'grid' });
  }

  _buildGantry() {
    const T = this.track;
    const hw = T.halfWidth;
    const { p, t, r } = frameAt(T, 4, 0);
    const steel = this._mat({ color: 0x2b2e35, roughness: 0.5, metalness: 0.7 });
    const g = new THREE.Group();
    g.position.copy(p);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), t);
    // pillars (local +X = left)
    for (const side of [-1, 1]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(0.7, 8, 0.7), steel);
      pil.position.set(side * (hw + 3.2), 4, 0);
      pil.castShadow = true;
      g.add(pil);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 7.2, 1.6, 0.9), steel);
    beam.position.set(0, 7.6, 0);
    beam.castShadow = true;
    g.add(beam);
    // banner on beam, facing approaching cars (-Z)
    const ban = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2 + 6.8, 1.3), this._mat({ map: TX.signTexture('HUNGARORING', { bg: '#0d0e12', fg: '#ffffff', w: 1024, h: 128 }), roughness: 0.5 }));
    ban.position.set(0, 7.6, -0.46);
    ban.rotation.y = Math.PI;
    g.add(ban);
    const ban2 = ban.clone();
    ban2.material = this._mat({ map: TX.signTexture('FINISH', { bg: '#e10600', fg: '#ffffff', w: 1024, h: 128 }), roughness: 0.5 });
    ban2.position.z = 0.46;
    ban2.rotation.y = 0;
    g.add(ban2);
    // start light pods hanging under the beam, facing the grid (-Z)
    this.lightCols = [];
    const podGeo = new THREE.BoxGeometry(0.62, 1.9, 0.35);
    const lampGeo = new THREE.CircleGeometry(0.22, 20);
    const pod = this._mat({ color: 0x0a0a0c, roughness: 0.4 });
    for (let k = 0; k < 5; k++) {
      const x = (k - 2) * 0.85;
      const box = new THREE.Mesh(podGeo, pod);
      box.position.set(x, 5.75, -0.2);
      g.add(box);
      const redMat = this._mat({ color: 0x220303, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.3 });
      const greenMat = this._mat({ color: 0x031a08, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.3 });
      for (let rI = 0; rI < 2; rI++) {
        const lamp = new THREE.Mesh(lampGeo, redMat);
        lamp.position.set(x, 6.3 - rI * 0.5, -0.38);
        lamp.rotation.y = Math.PI;
        g.add(lamp);
      }
      const gl = new THREE.Mesh(lampGeo, greenMat);
      gl.position.set(x, 5.25, -0.38);
      gl.rotation.y = Math.PI;
      g.add(gl);
      this.lightCols.push({ red: redMat, green: greenMat });
    }
    this.group.add(g);
    this.gantry = g;
  }

  /** Start light state: n red columns lit, or green. */
  setStartLights(nRed, green = false) {
    this.lightCols.forEach((c, k) => {
      const on = !green && k < nRed;
      c.red.emissive.setHex(on ? 0xff1800 : 0x000000);
      c.red.emissiveIntensity = on ? 6 : 1;
      c.green.emissive.setHex(green ? 0x14ff60 : 0x000000);
      c.green.emissiveIntensity = green ? 5 : 1;
    });
  }

  _buildSignage() {
    const T = this.track;
    const B = this.barriers;
    const signs = new THREE.Group();
    const postMat = this._mat({ color: 0x9aa0a8, metalness: 0.6, roughness: 0.4 });
    const board = (tex, w, h, s, side, extra, height, faceBack = 0.35) => {
      const i = Math.round(T.wrapS(s) / T.ds) % T.count;
      const off = (side < 0 ? B.offL[i] : B.offR[i]) + extra;
      const f = frameAt(T, s, side * off);
      // face approaching traffic, angled toward the track
      const toTrack = f.r.clone().multiplyScalar(-side);
      const face = f.t.clone().multiplyScalar(-1).lerp(toTrack, faceBack).normalize();
      const mat = this._mat({ map: tex, roughness: 0.55 });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      const holder = new THREE.Group();
      holder.position.copy(f.p);
      holder.position.y = f.p.y + height;
      holder.lookAt(holder.position.clone().add(face));
      plane.castShadow = true;
      holder.add(plane);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), postMat);
      back.rotation.y = Math.PI;
      back.position.z = -0.02;
      holder.add(back);
      signs.add(holder);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, height, 6), postMat);
      post.position.copy(f.p);
      post.position.y = f.p.y + height / 2 - h / 2;
      signs.add(post);
    };
    // turn numbers at each apex (outside of the corner)
    for (const c of T.corners) {
      const side = c.dir > 0 ? 1 : -1; // left turn -> outside is right (+)
      board(TX.signTexture(String(c.turn), { bg: '#ffffff', fg: '#111111', sub: 'TURN', w: 256, h: 256, italic: false, border: '#e10600' }), 1.6, 1.6, c.start - 5, side, 2.2, 2.6, 0.55);
    }
    // braking boards before the heavy stops
    for (const turn of T.def.brakingBoards || []) {
      const c = T.corner(turn);
      if (!c) continue;
      const side = c.dir > 0 ? 1 : -1;
      for (const d of [150, 100, 50]) {
        board(TX.signTexture(String(d), { bg: '#1b4fd6', fg: '#ffffff', w: 256, h: 192 }), 1.1, 0.82, c.start - d, side, 1.4, 1.4, 0.2);
      }
    }
    this.group.add(signs);
  }

  /** Monaco tunnel: walls, roof, lamp strips; exposes `tunnelRange` for the lighting change. */
  _buildTunnel() {
    const T = this.track;
    const B = this.barriers;
    const tdef = T.def.tunnel;
    const s0 = T.wrapS(T.corner(tdef.from).end + (tdef.fromOffset || 0));
    const s1 = T.wrapS(T.corner(tdef.to).start + (tdef.toOffset || 0));
    this.tunnelRange = { start: s0, end: s1 };
    const N = T.count;
    const i0 = Math.round(s0 / T.ds), i1 = Math.round(s1 / T.ds);
    const count = (i1 - i0 + N) % N;
    const H = 6.4;
    const wallPos = [], roofPos = [], lampPos = [];
    const idxW = [], idxR = [], idxL = [];
    for (let k = 0; k <= count; k++) {
      const i = (i0 + k) % N;
      const lx = B.left[i * 3] - T.right[i * 3] * 0.3, lz = B.left[i * 3 + 2] - T.right[i * 3 + 2] * 0.3;
      const rx = B.right[i * 3] + T.right[i * 3] * 0.3, rz = B.right[i * 3 + 2] + T.right[i * 3 + 2] * 0.3;
      const y = T.pos[i * 3 + 1];
      wallPos.push(lx, y - 0.5, lz, lx, y + H, lz, rx, y - 0.5, rz, rx, y + H, rz);
      roofPos.push(lx, y + H, lz, rx, y + H, rz, lx, y + H + 1.6, lz, rx, y + H + 1.6, rz);
      // lamp strip down the centre of the ceiling
      const cx = T.pos[i * 3], cz = T.pos[i * 3 + 2];
      const tx = T.right[i * 3] * 0.35, tz = T.right[i * 3 + 2] * 0.35;
      lampPos.push(cx - tx, y + H - 0.05, cz - tz, cx + tx, y + H - 0.05, cz + tz);
      if (k > 0) {
        const p = (k - 1) * 4, c = k * 4;
        idxW.push(p, c, p + 1, p + 1, c, c + 1, p + 2, p + 3, c + 2, p + 3, c + 3, c + 2);
        idxR.push(p, p + 1, c, p + 1, c + 1, c, p + 2, c + 2, p + 3, p + 3, c + 2, c + 3);
        const pl = (k - 1) * 2, cl = k * 2;
        if (k % 6 < 3) idxL.push(pl, cl, pl + 1, pl + 1, cl, cl + 1);
      }
    }
    const mk = (pos, idx) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const wallMat = this._mat({ map: TX.concreteTexture(), color: 0x8a8580, roughness: 0.95, side: THREE.DoubleSide });
    const roofMat = this._mat({ color: 0x4a4744, roughness: 1, side: THREE.DoubleSide });
    const lampMat = this._mat({ color: 0xffd9a0, emissive: 0xffc070, emissiveIntensity: 3.5, side: THREE.DoubleSide });
    this._add(mk(wallPos, idxW), wallMat, { cast: true, name: 'tunnel-walls' });
    this._add(mk(roofPos, idxR), roofMat, { cast: true, name: 'tunnel-roof' });
    this._add(mk(lampPos, idxL), lampMat, { receive: false, name: 'tunnel-lamps' });
    // a hotel block sits on top of the tunnel
    const mid = (i0 + Math.round(count / 2)) % N;
    const mx = T.pos[mid * 3], my = T.pos[mid * 3 + 1], mz = T.pos[mid * 3 + 2];
    const hotel = new THREE.Mesh(new THREE.BoxGeometry(Math.min(300, count * T.ds * 0.7), 22, 46), this._mat({ map: TX.facadeTexture(), roughness: 0.6 }));
    hotel.position.set(mx - T.right[mid * 3] * 34, my + H + 12.5, mz - T.right[mid * 3 + 2] * 34);
    hotel.rotation.y = Math.atan2(T.tan[mid * 3], T.tan[mid * 3 + 2]) + Math.PI / 2;
    hotel.castShadow = true;
    this.group.add(hotel);
  }

  /** Is distance s inside the tunnel? */
  inTunnel(s) {
    const r = this.tunnelRange;
    if (!r) return false;
    return r.start < r.end ? s > r.start && s < r.end : s > r.start || s < r.end;
  }

  /** Where the road runs above the ground (Suzuka's crossover) add a deck slab and pillars. */
  _buildBridgeDecks() {
    const T = this.track;
    const B = this.barriers;
    const N = T.count;
    const parts = [];
    const pillars = [];
    const off = (p, dy) => [p[0], p[1] + dy, p[2]];
    for (let i = 0; i < N; i++) {
      const y = T.pos[i * 3 + 1];
      const gy = this.terrain.heightAt(T.pos[i * 3], T.pos[i * 3 + 2]);
      if (y - gy < 1.6) continue;
      const j = (i + 1) % N;
      const at = (line, k) => [line[k * 3], line[k * 3 + 1], line[k * 3 + 2]];
      const a = at(B.left, i), b = at(B.right, i), c = at(B.left, j), d = at(B.right, j);
      const top = -0.08, bot = -1.3;
      // underside
      parts.push(...off(a, bot), ...off(b, bot), ...off(c, bot), ...off(b, bot), ...off(d, bot), ...off(c, bot));
      // sides
      for (const [p0, p1] of [[a, c], [b, d]]) {
        parts.push(...off(p0, top), ...off(p0, bot), ...off(p1, top), ...off(p0, bot), ...off(p1, bot), ...off(p1, top));
      }
      if (i % 9 === 0) for (const p of [a, b]) pillars.push([p[0], gy, p[2], Math.max(0.5, y - 1.3 - gy)]);
    }
    if (!parts.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(parts, 3));
    g.computeVertexNormals();
    const mat = this._mat({ map: TX.concreteTexture(), color: 0xb0aca6, roughness: 0.9, side: THREE.DoubleSide });
    this._add(g, mat, { cast: true, name: 'bridge-deck' });
    const pg = new THREE.BoxGeometry(1.2, 1, 1.2);
    pg.translate(0, 0.5, 0);
    const im = new THREE.InstancedMesh(pg, mat, pillars.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    pillars.forEach(([x, y, z, h], k) => im.setMatrixAt(k, m.compose(v.set(x, y, z), q, sc.set(1, h, 1))));
    im.castShadow = true;
    this.group.add(im);
    this.bridgeCount = pillars.length;
  }

  addSectorBoards(sectorStarts) {
    const T = this.track;
    const B = this.barriers;
    sectorStarts.forEach((s, k) => {
      if (k === 0) return;
      const i = Math.round(T.wrapS(s) / T.ds) % T.count;
      const f = frameAt(T, s, -(B.offL[i] + 1.5));
      const tex = TX.signTexture(`SECTOR ${k + 1}`, { bg: '#111216', fg: '#ffd21f', w: 512, h: 128 });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.05), this._mat({ map: tex, roughness: 0.5, side: THREE.DoubleSide }));
      m.position.copy(f.p);
      m.position.y += 3.2;
      m.lookAt(m.position.clone().add(f.t.clone().multiplyScalar(-1)));
      this.group.add(m);
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.15, 3.2, 0.15), this._mat({ color: 0x333333 }));
      pole.position.copy(f.p);
      pole.position.y += 1.6;
      this.group.add(pole);
    });
  }
}
