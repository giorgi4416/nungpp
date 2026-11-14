import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm, hash2 } from './TerrainData.js';
import * as TX from './Textures.js';

/**
 * Everything around the circuit: terrain, forests, grandstands with animated
 * crowds, pit building & garages, control tower, marshal posts, billboards,
 * flags and a sponsor bridge. Repeated objects use InstancedMesh.
 */

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function colorize(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function stripToBasic(geo) {
  // keep only position/normal/uv/color so geometries can be merged
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) geo.deleteAttribute(k);
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  return geo.index ? geo.toNonIndexed() : geo;
}

export class Environment {
  constructor(scene, track, terrain, barriers, quality) {
    this.scene = scene;
    this.track = track;
    this.terrain = terrain;
    this.barriers = barriers;
    this.quality = quality;
    this.group = new THREE.Group();
    this.group.name = 'environment';
    scene.add(this.group);
    this.uniforms = { uTime: { value: 0 }, uExcite: { value: 0.2 } };
    this.exclusions = []; // circles {x, z, r} where trees must not grow
    this.crowd = [];

    // start-line frame for pit/paddock layout
    this.p0 = new THREE.Vector3();
    this.t0 = new THREE.Vector3();
    this.r0 = new THREE.Vector3();
    track.sampleAt(0, 0, this.p0, this.t0, this.r0);
    this.t0.y = 0;
    this.t0.normalize();

    this._buildTerrain();
    this._buildPitComplex();
    this._buildGrandstands();
    this._buildCrowd();
    this._buildBillboards();
    this._buildMarshalPosts();
    this._buildBridge();
    this._buildFlags();
    this._buildTrees();
  }

  /** Position on the main straight frame: along (m from start line), lateral (+ = right/pit side). */
  straightPoint(along, lateral, y = 0) {
    return this.p0.clone().addScaledVector(this.t0, along).addScaledVector(this.r0, lateral).setY(this.p0.y + y);
  }

  _onTop(mesh) {
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    return mesh;
  }

  // ---------------------------------------------------------------- terrain
  _buildTerrain() {
    const T = this.terrain;
    const data = T.buildMeshData();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    const n = data.positions.length / 3;
    const uv = new Float32Array(n * 2);
    const col = new Float32Array(n * 3);
    const dist = new Float32Array(n);
    const base = new THREE.Color(), tmp = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const x = data.positions[i * 3], y = data.positions[i * 3 + 1], z = data.positions[i * 3 + 2];
      uv[i * 2] = x / 9;
      uv[i * 2 + 1] = z / 9;
      const d = T.trackDist[i];
      dist[i] = d;
      const nz = fbm(x * 0.006, z * 0.006, 3);
      const nz2 = fbm(x * 0.03 + 7, z * 0.03, 2);
      // lush near the track, drier/yellower on far hills
      base.setRGB(0.78 + nz * 0.12, 0.92 + nz * 0.1, 0.62 + nz * 0.08);
      const far = Math.min(1, Math.max(0, (d - 120) / 500));
      tmp.setRGB(1.0, 0.9, 0.62);
      base.lerp(tmp, far * (0.35 + 0.25 * nz2));
      // darker on high hills (forest floor feel)
      const hk = Math.min(1, Math.max(0, (y - 20) / 60));
      base.multiplyScalar(1 - hk * 0.18);
      col[i * 3] = base.r; col[i * 3 + 1] = base.g; col[i * 3 + 2] = base.b;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aDist', new THREE.BufferAttribute(dist, 1));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: TX.grassTexture(), vertexColors: true, roughness: 0.96, metalness: 0 });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aDist;\nvarying float vDist;\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDist = aDist;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vDist;\nvarying vec3 vWPos;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          float mow = smoothstep(95.0, 45.0, vDist);
          float stripe = step(0.5, fract((vWPos.x * 0.6 + vWPos.z * 0.8) / 14.0));
          diffuseColor.rgb *= 1.0 + mow * (stripe * 0.11 - 0.05);`);
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    this._onTop(mesh);
  }

  // ---------------------------------------------------------------- pit complex
  _box(w, h, d, mats, pos, forward) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, mats);
    mesh.position.copy(pos);
    // local X along forward, local Z = right of forward
    const right = new THREE.Vector3().crossVectors(forward, Y).normalize();
    const basis = new THREE.Matrix4().makeBasis(forward, Y, right);
    mesh.quaternion.setFromRotationMatrix(basis);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return this._onTop(mesh);
  }

  _buildPitComplex() {
    const t = this.t0;
    const facade = TX.facadeTexture();
    const garage = TX.garageTexture().clone();
    garage.needsUpdate = true;
    const concrete = new THREE.MeshStandardMaterial({ map: TX.concreteTexture(), roughness: 0.85 });
    const white = new THREE.MeshStandardMaterial({ color: 0xe9eaec, roughness: 0.6 });
    const glass = new THREE.MeshStandardMaterial({ map: facade, roughness: 0.25, metalness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23252b, roughness: 0.5, metalness: 0.4 });

    // pit garages (ground floor) along the pit lane: s from -230 to +190
    const len = 420, mid = -20;
    garage.repeat.set(len / 26, 1);
    const garageMat = new THREE.MeshStandardMaterial({ map: garage, roughness: 0.6 });
    const facadeL = facade.clone();
    facadeL.needsUpdate = true;
    facadeL.repeat.set(len / 20, 1);
    const glassL = new THREE.MeshStandardMaterial({ map: facadeL, roughness: 0.25, metalness: 0.3 });
    // BoxGeometry material order: +x, -x, +y, -y, +z (away from track), -z (track side)
    const gz = 37;
    this._box(len, 6, 16, [white, white, concrete, concrete, white, garageMat], this.straightPoint(mid, gz, 3), t);
    this._box(len, 6.5, 14, [glass, glass, concrete, concrete, glassL, glassL], this.straightPoint(mid, gz + 0.8, 9.25), t);
    // roof canopy
    this._box(len + 6, 0.5, 20, [dark, dark, white, dark, dark, dark], this.straightPoint(mid, gz - 1, 12.75), t);
    this.exclusions.push({ x: this.straightPoint(mid, gz).x, z: this.straightPoint(mid, gz).z, r: len / 2 + 20, line: true, a: this.straightPoint(-260, gz), b: this.straightPoint(220, gz), w: 45 });

    // paddock & hospitality blocks behind
    const colors = [0xe10600, 0x0e8f8a, 0xff7a00, 0x3a3d9f, 0x222222];
    for (let k = 0; k < 6; k++) {
      const m = new THREE.MeshStandardMaterial({ color: colors[k % colors.length], roughness: 0.5, metalness: 0.2 });
      this._box(32, 8, 14, [glass, glass, m, m, glass, glass], this.straightPoint(-200 + k * 70, 66, 4), t);
    }

    // control tower near the start line with circuit name
    const sign = new THREE.MeshStandardMaterial({ map: TX.signTexture('HUNGARORING', { bg: '#0d0e12', fg: '#ffffff', w: 1024, h: 192 }), roughness: 0.5, emissive: 0x111111 });
    this._box(16, 24, 14, [glass, glass, concrete, concrete, glass, glass], this.straightPoint(70, 56, 12), t);
    this._box(22, 4, 1, [dark, dark, dark, dark, dark, sign], this.straightPoint(70, 48.5, 26), t);

    // podium balcony
    this._box(14, 0.4, 4, [white, white, white, white, white, white], this.straightPoint(20, 28.5, 9), t);
  }

  // ---------------------------------------------------------------- grandstands
  /**
   * @param s centre distance along track; side -1 = left, +1 = right
   */
  _standFrame(s, side, length, depth, gap = 7) {
    const T = this.track;
    const B = this.barriers;
    const p = new THREE.Vector3(), tt = new THREE.Vector3(), r = new THREE.Vector3();
    T.sampleAt(s, 0, p, tt, r);
    tt.y = 0;
    tt.normalize();
    const i = Math.round(T.wrapS(s) / T.ds) % T.count;
    let off = (side < 0 ? B.offL[i] : B.offR[i]) + gap;
    // push outward until the whole footprint clears the barriers
    for (let iter = 0; iter < 40; iter++) {
      let ok = true;
      for (let a = -0.5; a <= 0.5; a += 0.125) for (const dd of [0, depth]) {
        const q = p.clone().addScaledVector(tt, a * length).addScaledVector(r, side * (off + dd));
        const j = T.nearestIndex(q.x, q.z, 200);
        if (j < 0) continue;
        const dist = Math.hypot(q.x - T.pos[j * 3], q.z - T.pos[j * 3 + 2]);
        const lim = Math.max(B.offL[j], B.offR[j]) + 4;
        if (dist < lim) ok = false;
      }
      if (ok) break;
      off += 3;
    }
    const centre = p.clone().addScaledVector(r, side * off);
    const facing = r.clone().multiplyScalar(-side); // toward the track
    return { centre, along: tt, facing, baseY: p.y };
  }

  _makeStand(length, rows, roof) {
    const step = 0.85, rise = 0.5, base = 1.4;
    const conc = [], seats = [], roofG = [], cols = [];
    for (let k = 0; k < rows; k++) {
      const h = base + k * rise;
      const g = new THREE.BoxGeometry(length, h, step);
      g.translate(0, h / 2, -k * step - step / 2);
      conc.push(g);
      const sg = new THREE.BoxGeometry(length, 0.22, 0.38);
      sg.translate(0, h + 0.11, -k * step - step * 0.62);
      seats.push(sg);
    }
    const depth = rows * step;
    const topH = base + rows * rise;
    const back = new THREE.BoxGeometry(length, topH + 2.5, 0.4);
    back.translate(0, (topH + 2.5) / 2, -depth - 0.2);
    conc.push(back);
    for (const sx of [-1, 1]) {
      const side = new THREE.BoxGeometry(0.4, topH + 1, depth + 0.4);
      side.translate(sx * (length / 2 + 0.2), (topH + 1) / 2, -depth / 2 - 0.2);
      conc.push(side);
    }
    const front = new THREE.BoxGeometry(length, base + 0.6, 0.3);
    front.translate(0, (base + 0.6) / 2, 0.15);
    conc.push(front);
    if (roof) {
      const rg = new THREE.BoxGeometry(length + 2, 0.35, depth + 5);
      rg.rotateX(-0.08);
      rg.translate(0, topH + 5.2, -depth / 2 + 1.5);
      roofG.push(rg);
      const n = Math.max(2, Math.round(length / 14));
      for (let k = 0; k <= n; k++) {
        const x = -length / 2 + (k * length) / n;
        const cg = new THREE.CylinderGeometry(0.22, 0.22, topH + 5.4, 8);
        cg.translate(x, (topH + 5.4) / 2, -depth - 0.6);
        cols.push(cg);
      }
    }
    return { conc: mergeGeometries(conc.map(stripToBasic)), seats: mergeGeometries(seats.map(stripToBasic)), roof: roofG.length ? mergeGeometries(roofG.map(stripToBasic)) : null, cols: cols.length ? mergeGeometries(cols.map(stripToBasic)) : null, depth, rows, step, rise, base };
  }

  _buildGrandstands() {
    const T = this.track;
    const conc = new THREE.MeshStandardMaterial({ map: TX.concreteTexture(), roughness: 0.9 });
    const seatMats = [0x2a64b8, 0xd0202a, 0x1f8c4a, 0xe8e8e8].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xf0f1f3, roughness: 0.4, metalness: 0.3 });
    const colMat = new THREE.MeshStandardMaterial({ color: 0x8b9099, roughness: 0.4, metalness: 0.6 });
    const corner = (n) => T.corners.find((c) => c.turn === n);
    const stands = [
      // main grandstand opposite the pits
      { s: 0, side: -1, length: 280, rows: 20, roof: true, gap: 9 },
      { s: -260, side: -1, length: 140, rows: 14, roof: false, gap: 9 },
      // turn 1 outside (left of a right-hander)
      { s: corner(1).start - 70, side: -1, length: 110, rows: 16, roof: true, gap: 6 },
      { s: corner(1).apex + 20, side: -1, length: 80, rows: 12, roof: false, gap: 6 },
      // turn 2/3
      { s: corner(2).apex, side: 1, length: 90, rows: 12, roof: false, gap: 8 },
      // turn 4 crest
      { s: corner(4).start - 30, side: 1, length: 110, rows: 14, roof: true, gap: 8 },
      // turn 5
      { s: corner(5).apex, side: -1, length: 90, rows: 12, roof: false, gap: 8 },
      // chicane 6/7
      { s: corner(6).start - 60, side: -1, length: 100, rows: 12, roof: true, gap: 6 },
      // turn 11/12
      { s: corner(12).start - 60, side: -1, length: 120, rows: 14, roof: true, gap: 7 },
      // final corner
      { s: corner(14).apex, side: -1, length: 110, rows: 14, roof: true, gap: 8 },
    ];
    this.stands = [];
    stands.forEach((st, k) => {
      const geo = this._makeStand(st.length, st.rows, st.roof);
      const f = this._standFrame(st.s, st.side, st.length, geo.depth, st.gap);
      const holder = new THREE.Group();
      holder.position.copy(f.centre);
      holder.position.y = this.terrain.heightAt(f.centre.x, f.centre.z) - 0.3;
      // local +Z faces the track, local X along the track
      const right = new THREE.Vector3().crossVectors(Y, f.facing).normalize(); // X axis
      holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, Y, f.facing));
      const add = (g, m) => {
        if (!g) return;
        const mesh = new THREE.Mesh(g, m);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        holder.add(mesh);
      };
      add(geo.conc, conc);
      add(geo.seats, seatMats[k % seatMats.length]);
      add(geo.roof, roofMat);
      add(geo.cols, colMat);
      holder.updateMatrixWorld(true);
      this.group.add(holder);
      this.stands.push({ holder, geo, length: st.length });
      // exclusion for trees
      const c = holder.localToWorld(new THREE.Vector3(0, 0, -geo.depth / 2));
      this.exclusions.push({ x: c.x, z: c.z, r: Math.max(st.length / 2, geo.depth) + 12 });
    });
  }

  _buildCrowd() {
    const density = 0.62 * this.quality.crowd;
    const r = rng(42);
    const positions = [];
    for (const st of this.stands) {
      const { geo, holder, length } = st;
      for (let k = 0; k < geo.rows; k++) {
        const y = geo.base + k * geo.rise + 0.22;
        const z = -k * geo.step - geo.step * 0.55;
        for (let x = -length / 2 + 0.5; x < length / 2 - 0.5; x += 0.62) {
          if (r() > density) continue;
          _v.set(x + (r() - 0.5) * 0.1, y, z);
          holder.localToWorld(_v);
          positions.push(_v.x, _v.y, _v.z, holder.rotation.y);
        }
      }
    }
    const count = positions.length / 4;
    if (!count) return;
    // shuffle so quality scaling thins the crowd evenly rather than emptying whole stands
    for (let i = count - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      for (let k = 0; k < 4; k++) { const t = positions[i * 4 + k]; positions[i * 4 + k] = positions[j * 4 + k]; positions[j * 4 + k] = t; }
    }
    const body = new THREE.BoxGeometry(0.44, 0.62, 0.3);
    body.translate(0, 0.31, 0);
    const head = new THREE.IcosahedronGeometry(0.13, 0);
    head.translate(0, 0.78, 0);
    const shirt = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const skin = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const bodies = new THREE.InstancedMesh(body, shirt, count);
    const heads = new THREE.InstancedMesh(head, skin, count);
    const palette = [0xe10600, 0xffffff, 0x1f8c4a, 0xffd21f, 0x2a64b8, 0xff7a00, 0x222222, 0x8e2bd6, 0x0e8f8a, 0xf2f2f2, 0xd0202a];
    const skins = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
    const c = new THREE.Color();
    const holderQuat = new THREE.Quaternion();
    for (let i = 0; i < count; i++) {
      const x = positions[i * 4], y = positions[i * 4 + 1], z = positions[i * 4 + 2];
      holderQuat.setFromAxisAngle(Y, r() * 0.6 - 0.3);
      _m.compose(_v.set(x, y, z), holderQuat, _s.set(1, 0.9 + r() * 0.25, 1));
      bodies.setMatrixAt(i, _m);
      heads.setMatrixAt(i, _m);
      bodies.setColorAt(i, c.setHex(palette[Math.floor(r() * palette.length)]));
      heads.setColorAt(i, c.setHex(skins[Math.floor(r() * skins.length)]));
    }
    const U = this.uniforms;
    const patch = (mat) => {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = U.uTime;
        shader.uniforms.uExcite = U.uExcite;
        shader.vertexShader = 'uniform float uTime;\nuniform float uExcite;\n' + shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float ph = instanceMatrix[3].x * 0.71 + instanceMatrix[3].z * 0.37;
          float jump = max(0.0, sin(uTime * (5.0 + fract(ph) * 3.0) + ph * 6.28));
          transformed.y += jump * jump * 0.16 * uExcite * step(0.55, fract(ph * 3.7));`,
        );
      };
    };
    patch(shirt);
    patch(skin);
    bodies.frustumCulled = false; // spread over the whole circuit
    heads.frustumCulled = false;
    bodies.userData.total = heads.userData.total = count;
    this.crowdMeshes = [bodies, heads];
    this.group.add(bodies, heads);
  }

  // ---------------------------------------------------------------- billboards
  _buildBillboards() {
    const T = this.track;
    const B = this.barriers;
    const brands = [
      ['APEX OIL', '#e10600', '#ffffff', 'HIGH PERFORMANCE LUBRICANTS'],
      ['VELOCITA', '#101114', '#ffd21f', 'TYRES'],
      ['NORDLINE', '#0f2a5f', '#ffffff', 'LOGISTICS'],
      ['SOLARIS', '#ff7a00', '#ffffff', 'ENERGY'],
      ['KRONOS', '#f4f4f4', '#111111', 'SWISS TIMING'],
      ['DANUBE AIR', '#0e8f8a', '#ffffff', 'FLY FURTHER'],
    ];
    const r = rng(7);
    const items = brands.map(() => []);
    let k = 0;
    for (let s = 120; s < T.length - 60; s += 95 + r() * 60) {
      const i = Math.round(s / T.ds) % T.count;
      const side = r() < 0.5 ? -1 : 1;
      // keep the pit side of the main straight clear
      if (side > 0 && (s < 320 || s > T.length - 450)) continue;
      const off = (side < 0 ? B.offL[i] : B.offR[i]) + 3.5;
      const p = new THREE.Vector3(), tt = new THREE.Vector3(), rr = new THREE.Vector3();
      T.sampleAt(s, side * off, p, tt, rr);
      // clearance check against other track sections
      const j = T.nearestIndex(p.x, p.z, 100);
      if (j >= 0) {
        const d = Math.hypot(p.x - T.pos[j * 3], p.z - T.pos[j * 3 + 2]);
        if (d < Math.max(B.offL[j], B.offR[j]) + 2) continue;
      }
      tt.y = 0;
      tt.normalize();
      const face = rr.clone().multiplyScalar(-side).lerp(tt.clone().multiplyScalar(-1), 0.25).normalize();
      items[k % brands.length].push({ p, face });
      this.exclusions.push({ x: p.x, z: p.z, r: 9 });
      k++;
    }
    const plane = new THREE.PlaneGeometry(12, 3);
    const postGeo = new THREE.BoxGeometry(0.25, 1, 0.25);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x5a5f66, metalness: 0.6, roughness: 0.4 });
    const allPosts = [];
    items.forEach((list, b) => {
      if (!list.length) return;
      const [name, bg, fg, sub] = brands[b];
      const mat = new THREE.MeshStandardMaterial({ map: TX.signTexture(name, { bg, fg, sub, w: 1024, h: 256 }), roughness: 0.55, side: THREE.DoubleSide });
      const im = new THREE.InstancedMesh(plane, mat, list.length);
      list.forEach(({ p, face }, n) => {
        const y = this.terrain.heightAt(p.x, p.z);
        _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), face);
        _m.compose(_v.set(p.x, y + 3.6, p.z), _q, _s.set(1, 1, 1));
        im.setMatrixAt(n, _m);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(_q);
        for (const sx of [-4.5, 4.5]) allPosts.push([p.x + right.x * sx, y, p.z + right.z * sx]);
      });
      im.castShadow = true;
      im.receiveShadow = true;
      this.group.add(im);
    });
    const posts = new THREE.InstancedMesh(postGeo, postMat, allPosts.length);
    allPosts.forEach(([x, y, z], n) => {
      _m.compose(_v.set(x, y + 1.05, z), _q.identity(), _s.set(1, 2.1, 1));
      posts.setMatrixAt(n, _m);
    });
    this.group.add(posts);
  }

  _buildMarshalPosts() {
    const T = this.track;
    const B = this.barriers;
    const cabin = new THREE.BoxGeometry(2.2, 2.3, 2.0);
    cabin.translate(0, 1.15, 0);
    const roof = new THREE.BoxGeometry(2.6, 0.2, 2.4);
    roof.translate(0, 2.4, 0);
    const cabMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xff6a00, roughness: 0.5 });
    const list = [];
    let side = 1;
    for (let s = 200; s < T.length - 100; s += 290) {
      side = -side;
      if (side > 0 && (s < 320 || s > T.length - 450)) side = -1;
      const i = Math.round(s / T.ds) % T.count;
      const off = (side < 0 ? B.offL[i] : B.offR[i]) + 2.2;
      const p = new THREE.Vector3(), tt = new THREE.Vector3();
      T.sampleAt(s, side * off, p, tt);
      const j = T.nearestIndex(p.x, p.z, 100);
      if (j >= 0 && Math.hypot(p.x - T.pos[j * 3], p.z - T.pos[j * 3 + 2]) < Math.max(B.offL[j], B.offR[j]) + 1) continue;
      list.push({ p, yaw: Math.atan2(tt.x, tt.z) });
      this.exclusions.push({ x: p.x, z: p.z, r: 4 });
    }
    const a = new THREE.InstancedMesh(cabin, cabMat, list.length);
    const b = new THREE.InstancedMesh(roof, roofMat, list.length);
    list.forEach(({ p, yaw }, n) => {
      _q.setFromAxisAngle(Y, yaw);
      _m.compose(_v.set(p.x, this.terrain.heightAt(p.x, p.z), p.z), _q, _s.set(1, 1, 1));
      a.setMatrixAt(n, _m);
      b.setMatrixAt(n, _m);
    });
    a.castShadow = b.castShadow = true;
    this.group.add(a, b);
  }

  _buildBridge() {
    // sponsor footbridge across the back straight
    const T = this.track;
    const B = this.barriers;
    const c3 = T.corners.find((c) => c.turn === 3), c4 = T.corners.find((c) => c.turn === 4);
    const s = (c3.end + c4.start) / 2;
    const i = Math.round(s / T.ds) % T.count;
    const p = new THREE.Vector3(), tt = new THREE.Vector3(), rr = new THREE.Vector3();
    T.sampleAt(s, 0, p, tt, rr);
    tt.y = 0;
    tt.normalize();
    const span = B.offL[i] + B.offR[i] + 6;
    const midLat = (B.offR[i] - B.offL[i]) / 2;
    const centre = p.clone().addScaledVector(rr, midLat);
    const g = new THREE.Group();
    g.position.copy(centre);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tt);
    const steel = new THREE.MeshStandardMaterial({ color: 0xdfe2e6, metalness: 0.5, roughness: 0.35 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(span, 2.2, 3), steel);
    deck.position.y = 8.2;
    deck.castShadow = true;
    g.add(deck);
    const ad = new THREE.MeshStandardMaterial({ map: TX.signTexture('VELOCITA', { bg: '#101114', fg: '#ffd21f', sub: 'OFFICIAL TYRE PARTNER', w: 1024, h: 192 }), roughness: 0.5 });
    for (const z of [-1.52, 1.52]) {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(span - 1, 2), ad);
      pl.position.set(0, 8.2, z);
      if (z > 0) pl.rotation.y = 0; else pl.rotation.y = Math.PI;
      g.add(pl);
    }
    for (const sx of [-1, 1]) {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(2.4, 9.5, 3.2), steel);
      tower.position.set(sx * (span / 2 - 1.2), 4.4, 0);
      tower.castShadow = true;
      g.add(tower);
    }
    this.group.add(g);
    const world = g.position;
    this.exclusions.push({ x: world.x, z: world.z, r: span / 2 + 6 });
  }

  _buildFlags() {
    this.flags = [];
    const geo = new THREE.PlaneGeometry(2.4, 1.5, 16, 4);
    geo.translate(1.2, 0, 0);
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 9, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xcfd3d8, metalness: 0.7, roughness: 0.3 });
    const flagSets = [
      ['#ce2939', '#ffffff', '#477050'], // Hungarian tricolour
      ['#e10600', '#e10600'],
      ['#101114', '#ffd21f'],
      ['#0f2a5f', '#ffffff'],
    ];
    const U = this.uniforms;
    const mats = flagSets.map((cols) => {
      const m = new THREE.MeshStandardMaterial({ map: TX.flagTexture(cols), side: THREE.DoubleSide, roughness: 0.8 });
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = U.uTime;
        shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float w = position.x / 2.4;
          transformed.z += sin(position.x * 2.6 - uTime * 7.0 + position.y * 0.8) * 0.22 * w;
          transformed.y -= w * w * 0.15;`,
        );
      };
      return m;
    });
    const spots = [];
    for (let k = 0; k < 9; k++) spots.push(this.straightPoint(-140 + k * 35, -(this.barriers.offL[0] + 5)));
    for (let k = 0; k < 6; k++) spots.push(this.straightPoint(-200 + k * 80, 46));
    spots.forEach((pt, k) => {
      const y = this.terrain.heightAt(pt.x, pt.z);
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(pt.x, y + 4.5, pt.z);
      this.group.add(pole);
      const flag = new THREE.Mesh(geo, mats[k % mats.length]);
      flag.position.set(pt.x, y + 8.1, pt.z);
      flag.rotation.y = Math.atan2(this.t0.x, this.t0.z) + Math.PI / 2 + 0.6;
      this.group.add(flag);
    });
  }

  // ---------------------------------------------------------------- trees
  _treeGeometries() {
    const trunkCol = 0x5b4128;
    // conifer
    const t1 = colorize(new THREE.CylinderGeometry(0.18, 0.3, 2.6, 6), trunkCol).translate(0, 1.3, 0);
    const c1 = colorize(new THREE.ConeGeometry(2.3, 5.2, 7), 0x2f5a2a).translate(0, 4.4, 0);
    const c2 = colorize(new THREE.ConeGeometry(1.75, 4.0, 7), 0x356530).translate(0, 6.6, 0);
    const c3 = colorize(new THREE.ConeGeometry(1.1, 3.0, 7), 0x3b6e35).translate(0, 8.4, 0);
    const conifer = mergeGeometries([t1, c1, c2, c3].map(stripToBasic));
    // deciduous
    const t2 = colorize(new THREE.CylinderGeometry(0.25, 0.4, 3.4, 6), trunkCol).translate(0, 1.7, 0);
    const blob = (r, x, y, z, col, seed) => {
      const g = new THREE.IcosahedronGeometry(r, 0);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const n = 0.88 + hash2(p.getX(i) * 3 + seed, p.getZ(i) * 3 + p.getY(i)) * 0.24;
        p.setXYZ(i, p.getX(i) * n, p.getY(i) * n * 0.85, p.getZ(i) * n);
      }
      g.computeVertexNormals();
      return colorize(g, col).translate(x, y, z);
    };
    const decid = mergeGeometries([
      t2,
      blob(2.6, 0, 5.0, 0, 0x4d7a2e, 1),
      blob(1.9, 1.3, 6.2, 0.6, 0x5a8735, 2),
      blob(1.8, -1.2, 5.8, -0.7, 0x456f29, 3),
    ].map(stripToBasic));
    return { conifer, decid };
  }

  _buildTrees() {
    const T = this.track;
    const B = this.barriers;
    const ter = this.terrain;
    const { conifer, decid } = this._treeGeometries();
    const target = Math.round(8500 * this.quality.trees);
    const r = rng(1234);
    const pts = [];
    const half = ter.size / 2 - 40;
    const blocked = (x, z) => {
      for (const e of this.exclusions) {
        if (e.line) {
          // capsule exclusion along the pit building
          const ax = e.a.x, az = e.a.z, bx = e.b.x, bz = e.b.z;
          const dx = bx - ax, dz = bz - az;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
          if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < e.w) return true;
        } else if ((x - e.x) ** 2 + (z - e.z) ** 2 < e.r * e.r) return true;
      }
      const j = T.nearestIndex(x, z, 120);
      if (j >= 0) {
        const d = Math.hypot(x - T.pos[j * 3], z - T.pos[j * 3 + 2]);
        const lim = Math.max(B.offL[j], B.offR[j]) + 9;
        if (d < lim) return true;
        // pit/paddock zone and main grandstand: keep open
        const s = j * T.ds;
        if ((s < 330 || s > T.length - 460) && d < 95) return true;
      }
      return false;
    };
    // clustered forests
    let guard = 0;
    const b = T.bounds;
    while (pts.length < target && guard++ < 6000) {
      // 65% of forests hug the circuit (Hungaroring sits among wooded hills), the rest anywhere
      let cx, cz;
      if (r() < 0.65) {
        cx = b.minX - 250 + r() * (b.maxX - b.minX + 500);
        cz = b.minZ - 250 + r() * (b.maxZ - b.minZ + 500);
      } else {
        cx = ter.cx + (r() * 2 - 1) * half;
        cz = ter.cz + (r() * 2 - 1) * half;
      }
      const radius = 25 + r() * 90;
      const n = 10 + Math.floor(r() * 50);
      const type = r() < 0.45 ? 0 : 1;
      for (let k = 0; k < n && pts.length < target; k++) {
        const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * radius;
        const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
        if (blocked(x, z)) continue;
        pts.push([x, z, r() < 0.85 ? type : 1 - type, 0.75 + r() * 0.75, r() * Math.PI * 2]);
      }
    }
    // shuffle so lower quality settings remove trees uniformly
    for (let i = pts.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = pts[i]; pts[i] = pts[j]; pts[j] = t;
    }
    const counts = [0, 0];
    for (const p of pts) counts[p[2]]++;
    const U = this.uniforms;
    const mkMat = () => {
      const m = new THREE.MeshLambertMaterial({ vertexColors: true });
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = U.uTime;
        shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float hh = max(0.0, position.y - 2.5) / 7.0;
          float ph = instanceMatrix[3].x * 0.045 + instanceMatrix[3].z * 0.06;
          transformed.x += sin(uTime * 1.25 + ph) * 0.22 * hh * hh;
          transformed.z += cos(uTime * 0.95 + ph * 1.7) * 0.15 * hh * hh;`,
        );
      };
      return m;
    };
    const meshes = [new THREE.InstancedMesh(conifer, mkMat(), Math.max(1, counts[0])), new THREE.InstancedMesh(decid, mkMat(), Math.max(1, counts[1]))];
    const idx = [0, 0];
    const col = new THREE.Color();
    for (const [x, z, type, sc, rot] of pts) {
      const y = ter.heightAt(x, z) - 0.2;
      _q.setFromAxisAngle(Y, rot);
      _m.compose(_v.set(x, y, z), _q, _s.set(sc, sc * (0.85 + hash2(x, z) * 0.4), sc));
      const im = meshes[type];
      im.setMatrixAt(idx[type], _m);
      const h = hash2(z, x);
      im.setColorAt(idx[type], col.setRGB(0.82 + h * 0.3, 0.85 + h * 0.25, 0.75 + h * 0.2));
      idx[type]++;
    }
    this.treeMeshes = meshes;
    meshes.forEach((m, k) => {
      m.count = idx[k];
      m.userData.total = idx[k];
      m.castShadow = this.quality.shadowMap >= 2048;
      m.receiveShadow = false;
      m.frustumCulled = false;
      this.group.add(m);
    });
    this.treeCount = pts.length;
  }

  /** Scale scenery density & shadow casting to the graphics preset (no rebuild needed). */
  applyQuality(q) {
    for (const m of this.treeMeshes || []) {
      m.count = Math.round(m.userData.total * q.trees);
      m.castShadow = q.shadowMap >= 4096;
    }
    for (const m of this.crowdMeshes || []) m.count = Math.round(m.userData.total * q.crowd);
  }

  update(dt, time) {
    this.uniforms.uTime.value = time;
  }

  setExcitement(v) {
    this.uniforms.uExcite.value = v;
  }
}
