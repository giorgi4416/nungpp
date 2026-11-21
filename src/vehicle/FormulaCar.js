import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR_SPEC } from './VehiclePhysics.js';
import { TEAMS, hex } from './Teams.js';
import * as TX from '../scene/Textures.js';

/**
 * Procedural Formula car models for three regulation eras.
 *
 *  - 2020: wide halo car with complex multi-element wings; each team's chassis
 *    concept (nose / sidepods / wings / airbox) changes the shape.
 *  - 2000s (V10 2000-05, V8 2006-08): narrow track, grooved tyres, high nose with
 *    pylons, big bargeboards; the V8 cars add horns, chimneys, flip-ups, shark fin
 *    and a bridge wing.
 *  - 1990s (early / mid / late): wide-bodied low-nose cars with huge rear slicks,
 *    raised-nose mid-90s cars with high cockpit sides, narrow grooved-tyre 98/99 cars.
 *
 * Every car is built from named components (nose, front wing, rear wing, sidepods,
 * suspension corners, wheels...) with their own hinge points so crash damage can
 * bend, crumple or detach real pieces. AI cars merge everything per material.
 *
 * Local frame: +Z forward, +Y up, +X left. Origin at wheel-axle height.
 */

const AXLE = 0.36;
const g = (h) => h - AXLE;

// ------------------------------------------------------------------ geometry helpers
function superellipse(theta, w, h, n) {
  const c = Math.cos(theta), s = Math.sin(theta);
  const e = 2 / n;
  return [w * Math.sign(c) * Math.abs(c) ** e, h * Math.sign(s) * Math.abs(s) ** e];
}

/** Loft through sections [{z, w, wb, h, hb, y, n, x}] (wb/hb: lower-half width/height for undercuts). */
function loft(sections, radial = 28, { capStart = true, capEnd = true } = {}) {
  const pos = [], uv = [], idx = [];
  const S = sections.length;
  for (let i = 0; i < S; i++) {
    const sec = sections[i];
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      const lower = Math.sin(th) < 0;
      const [x, y] = superellipse(th, lower ? sec.wb ?? sec.w : sec.w, lower ? sec.hb ?? sec.h : sec.h, sec.n ?? 2.6);
      pos.push((sec.x ?? 0) + x, g(sec.y) + y, sec.z);
      uv.push(j / radial, i / (S - 1));
    }
  }
  const row = radial + 1;
  for (let i = 0; i < S - 1; i++) for (let j = 0; j < radial; j++) {
    const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const addCap = (i, flip) => {
    const sec = sections[i];
    const centre = pos.length / 3;
    pos.push(sec.x ?? 0, g(sec.y), sec.z);
    uv.push(0.25, i === 0 ? 0 : 1);
    for (let j = 0; j < radial; j++) {
      const a = i * row + j, b = a + 1;
      if (flip) idx.push(centre, b, a); else idx.push(centre, a, b);
    }
  };
  if (capStart) addCap(0, false);
  if (capEnd) addCap(S - 1, true);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Aerofoil extruded along X (span); leading edge at z = 0, chord toward -Z. Optional span-wise bend. */
function aerofoil(span, chord, thick, { camber = 0.04, bend = null, segments = 12 } = {}) {
  const shape = new THREE.Shape();
  const N = 12;
  const top = [], bot = [];
  for (let i = 0; i <= N; i++) {
    const x = (i / N) ** 1.6;
    const t = 5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4);
    const c = camber * 4 * x * (1 - x);
    top.push([x * chord, (c + t) * chord]);
    bot.push([x * chord, (c - t) * chord]);
  }
  shape.moveTo(top[0][0], top[0][1]);
  for (let i = 1; i <= N; i++) shape.lineTo(top[i][0], top[i][1]);
  for (let i = N; i >= 1; i--) shape.lineTo(bot[i][0], bot[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: span, bevelEnabled: false, steps: bend ? segments : 1, curveSegments: 1 });
  geo.translate(0, 0, -span / 2);
  geo.rotateY(Math.PI / 2);
  if (bend) {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const s = Math.abs(p.getX(i)) / (span / 2);
      const [dy, dz] = bend(s);
      p.setY(i, p.getY(i) + dy);
      p.setZ(i, p.getZ(i) + dz);
    }
    geo.computeVertexNormals();
  }
  return geo;
}

function box(w, h, d, x, y, z) {
  return new THREE.BoxGeometry(w, h, d).translate(x, g(y), z);
}

function rod(a, b, r = 0.018) {
  const A = new THREE.Vector3(a[0], g(a[1]), a[2]);
  const B = new THREE.Vector3(b[0], g(b[1]), b[2]);
  const geo = new THREE.CylinderGeometry(r, r, A.distanceTo(B), 6, 1);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
  geo.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return geo;
}

/** Flat plate from a 2D outline (x = toward -Z, y = up), extruded across X. */
function plate(points, thickness, x, yBase, z0) {
  const sh = new THREE.Shape();
  sh.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p.length === 4) sh.quadraticCurveTo(p[0], p[1], p[2], p[3]);
    else sh.lineTo(p[0], p[1]);
  }
  sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, { depth: thickness, bevelEnabled: false, curveSegments: 6 });
  geo.rotateY(Math.PI / 2);
  geo.translate(x - thickness / 2, g(yBase), z0);
  return geo;
}

function clean(geo) {
  const n = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
  if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
  if (!n.attributes.normal) n.computeVertexNormals();
  return n;
}
const prep = (geos) => (geos.length ? mergeGeometries(geos.map(clean)) : null);

const MATS = ['paint', 'wing', 'carbon', 'black', 'metal', 'glow'];

/** Collects geometry per component and material. */
class Parts {
  constructor() {
    this.comps = {};
  }
  add(comp, mat, geo) {
    const c = (this.comps[comp] ||= { hinge: [0, 0, 0], geos: {} });
    (c.geos[mat] ||= []).push(geo);
  }
  hinge(comp, x, y, z) {
    (this.comps[comp] ||= { hinge: [0, 0, 0], geos: {} }).hinge = [x, y, z];
  }
  finish() {
    for (const c of Object.values(this.comps)) for (const m of Object.keys(c.geos)) c.geos[m] = prep(c.geos[m]);
    return this.comps;
  }
}

// ------------------------------------------------------------------ era visual specs
/**
 * Visual proportions per sub-era. Physics wheel positions stay the same for every
 * car (so handling remains consistent); these only shape the model.
 */
export const ERA_SPECS = {
  '2020': {
    fz: 1.72, rz: -1.88, thF: 0.82, thR: 0.82, tyreF: { r: 0.345, w: 0.3, grooves: 0 }, tyreR: { r: 0.36, w: 0.4, grooves: 0 },
    rim: { spokes: 5, color: 0x232428, disc: 0.165 }, halo: true, steering: '2020', eye: [0, 0.578, 0.21], helmet: [0.88, 0.28],
    mirrors: [0.49, 0.845, 0.58], stripe: true,
  },
  '2000s-v10': {
    fz: 1.6, rz: -1.52, thF: 0.73, thR: 0.72, tyreF: { r: 0.33, w: 0.27, grooves: 4 }, tyreR: { r: 0.335, w: 0.355, grooves: 4 },
    rim: { spokes: 10, color: 0x2e3036, disc: 0.15 }, steering: '2000s', eye: [0, 0.6, 0.12], helmet: [0.9, 0.2],
    nose: { tipZ: 2.48, tipY: 0.4, tipW: 0.07, tipH: 0.07, base: 0.44 }, sideTop: 0.82,
    airbox: { y: 0.94, w: 0.15, h: 0.13 }, pods: { x: 0.47, zf: 0.62, zr: -1.15, w: 0.2, h: 0.17, y: 0.36, under: 0.6 },
    fw: { z: 2.72, span: 1.4, y: 0.1, chord: 0.3, flaps: 2, spoon: 0.05, endH: 0.26, endLen: 0.5 },
    rw: { z: -1.95, span: 0.88, y: 0.9, chord: 0.33, flaps: 2, endH: 0.62, endLen: 0.6, beam: true },
    barge: 0.3, periscope: true, chimney: 0.06, mirrors: [0.36, 0.86, 0.55],
  },
  '2000s-v8': {
    fz: 1.62, rz: -1.55, thF: 0.73, thR: 0.72, tyreF: { r: 0.33, w: 0.27, grooves: 4 }, tyreR: { r: 0.335, w: 0.355, grooves: 4 },
    rim: { spokes: 10, color: 0x1f2024, disc: 0.15 }, steering: '2000s', eye: [0, 0.6, 0.12], helmet: [0.9, 0.2],
    nose: { tipZ: 2.52, tipY: 0.36, tipW: 0.075, tipH: 0.065, base: 0.44 }, sideTop: 0.83,
    airbox: { y: 0.95, w: 0.13, h: 0.12 }, pods: { x: 0.46, zf: 0.6, zr: -1.2, w: 0.19, h: 0.16, y: 0.35, under: 0.55 },
    fw: { z: 2.74, span: 1.4, y: 0.1, chord: 0.3, flaps: 3, spoon: 0.07, endH: 0.28, endLen: 0.52, bridge: true },
    rw: { z: -1.95, span: 0.88, y: 0.9, chord: 0.33, flaps: 3, endH: 0.64, endLen: 0.62, beam: true },
    barge: 0.36, periscope: true, chimney: 0.12, horns: true, flipups: true, sharkFin: true, mirrors: [0.38, 0.88, 0.52],
  },
  '1990s-early': {
    fz: 1.5, rz: -1.45, thF: 0.86, thR: 0.8, tyreF: { r: 0.325, w: 0.3, grooves: 0 }, tyreR: { r: 0.33, w: 0.47, grooves: 0 },
    rim: { spokes: 8, color: 0xb8bcc2, disc: 0.14 }, steering: '90s', eye: [0, 0.62, 0.08], helmet: [0.92, 0.16],
    nose: { tipZ: 2.38, tipY: 0.17, tipW: 0.1, tipH: 0.06, base: 0.4, low: true }, sideTop: 0.7,
    airbox: { y: 0.98, w: 0.19, h: 0.17 }, pods: { x: 0.5, zf: 0.82, zr: -1.15, w: 0.24, h: 0.2, y: 0.34, under: 0.95, boxy: true },
    fw: { z: 2.55, span: 1.55, y: 0.08, chord: 0.32, flaps: 1, spoon: 0, endH: 0.22, endLen: 0.58, onNose: true },
    rw: { z: -1.85, span: 1.0, y: 0.78, chord: 0.42, flaps: 2, endH: 0.5, endLen: 0.72, beam: false },
    barge: 0, periscope: false, chimney: 0, mirrors: [0.42, 0.78, 0.45],
  },
  '1990s-mid': {
    fz: 1.55, rz: -1.45, thF: 0.82, thR: 0.8, tyreF: { r: 0.325, w: 0.29, grooves: 0 }, tyreR: { r: 0.33, w: 0.38, grooves: 0 },
    rim: { spokes: 10, color: 0xc9a54a, disc: 0.14 }, steering: '90s', eye: [0, 0.61, 0.1], helmet: [0.91, 0.18],
    nose: { tipZ: 2.42, tipY: 0.42, tipW: 0.08, tipH: 0.07, base: 0.45 }, sideTop: 0.8,
    airbox: { y: 0.97, w: 0.17, h: 0.15 }, pods: { x: 0.49, zf: 0.6, zr: -1.0, w: 0.22, h: 0.18, y: 0.34, under: 0.8 },
    fw: { z: 2.68, span: 1.48, y: 0.09, chord: 0.31, flaps: 1, spoon: 0, endH: 0.22, endLen: 0.55 },
    rw: { z: -1.9, span: 0.95, y: 0.9, chord: 0.38, flaps: 2, endH: 0.56, endLen: 0.66, beam: true },
    barge: 0.18, periscope: false, chimney: 0, mirrors: [0.4, 0.86, 0.5],
  },
  '1990s-late': {
    fz: 1.55, rz: -1.45, thF: 0.73, thR: 0.72, tyreF: { r: 0.325, w: 0.28, grooves: 3 }, tyreR: { r: 0.33, w: 0.36, grooves: 4 },
    rim: { spokes: 10, color: 0xb8bcc2, disc: 0.14 }, steering: '90s', eye: [0, 0.61, 0.1], helmet: [0.91, 0.18],
    nose: { tipZ: 2.46, tipY: 0.42, tipW: 0.075, tipH: 0.07, base: 0.45 }, sideTop: 0.82,
    airbox: { y: 0.96, w: 0.16, h: 0.14 }, pods: { x: 0.46, zf: 0.58, zr: -1.05, w: 0.2, h: 0.17, y: 0.35, under: 0.7 },
    fw: { z: 2.7, span: 1.36, y: 0.09, chord: 0.3, flaps: 2, spoon: 0, endH: 0.24, endLen: 0.52 },
    rw: { z: -1.92, span: 0.9, y: 0.92, chord: 0.36, flaps: 2, endH: 0.58, endLen: 0.64, beam: true },
    barge: 0.24, periscope: false, chimney: 0, mirrors: [0.38, 0.86, 0.5],
  },
};

// ------------------------------------------------------------------ 2020 model (team chassis concepts)
function build2020(ch) {
  const P = new Parts();
  const nose = {
    long: { tip: 2.74, tw: 0.055, th: 0.045, ty: 0.29 },
    short: { tip: 2.5, tw: 0.075, th: 0.06, ty: 0.32 },
    wide: { tip: 2.68, tw: 0.1, th: 0.05, ty: 0.3 },
  }[ch.nose] || { tip: 2.74, tw: 0.055, th: 0.045, ty: 0.29 };
  // nose (detachable) + monocoque
  P.add('nose', 'paint', loft([
    { z: nose.tip, w: nose.tw, h: nose.th, y: nose.ty },
    { z: nose.tip - 0.22, w: nose.tw + 0.04, h: nose.th + 0.03, y: nose.ty + 0.02 },
    { z: 2.05, w: 0.15, h: 0.115, y: 0.37 },
    { z: 1.55, w: 0.212, h: 0.155, y: 0.437 },
  ]));
  P.hinge('nose', 0, g(0.43), 1.58);
  P.add('core', 'paint', loft([
    { z: 1.62, w: 0.2, h: 0.148, y: 0.428 },
    { z: 1.2, w: 0.26, h: 0.19, y: 0.48 },
    { z: 0.85, w: 0.31, h: 0.235, y: 0.515, wb: 0.27 },
    { z: 0.4, w: 0.39, h: 0.26, y: 0.52, wb: 0.33 },
    { z: -0.1, w: 0.44, h: 0.27, y: 0.52, wb: 0.36 },
    { z: -0.45, w: 0.42, h: 0.27, y: 0.52, wb: 0.34 },
  ]));
  const air = ch.airbox === 'low' ? 0.05 : 0.11;
  P.add('core', 'paint', loft([
    { z: 0.05, w: 0.17, h: 0.11, y: 0.84 + air * 0.4, n: 2.2 },
    { z: -0.15, w: 0.26, h: 0.3 + air * 0.4, y: 0.72 + air * 0.25 },
    { z: -0.55, w: 0.28, h: 0.34, y: 0.67 },
    { z: -1.05, w: 0.22, h: 0.27, y: 0.58, wb: 0.18 },
    { z: -1.6, w: 0.14, h: 0.19, y: 0.5, wb: 0.1 },
    { z: -2.05, w: 0.08, h: 0.11, y: 0.44 },
    { z: -2.3, w: 0.05, h: 0.07, y: 0.42 },
  ]));
  P.add('core', 'black', loft([
    { z: 0.075, w: 0.105, h: 0.085, y: 0.92 + air * 0.45, n: 2.4 },
    { z: 0.0, w: 0.095, h: 0.075, y: 0.92 + air * 0.45, n: 2.4 },
  ], 16));
  P.add('core', 'paint', plate([[0, 0], [1.25, 0], [1.25, 0.08], [0.12, 0.45 + air * 0.5], [0, 0.45 + air * 0.5]], 0.012, 0, 0.55, -0.45));
  // sidepods
  const pod = {
    downwash: [
      { z: 0.62, w: 0.15, h: 0.15, y: 0.42, wb: 0.1 }, { z: 0.38, w: 0.22, h: 0.19, y: 0.41, wb: 0.12, hb: 0.16 },
      { z: -0.2, w: 0.23, h: 0.17, y: 0.36, wb: 0.11, hb: 0.13 }, { z: -0.8, w: 0.16, h: 0.11, y: 0.28, wb: 0.08 },
      { z: -1.4, w: 0.09, h: 0.07, y: 0.23 }, { z: -1.75, w: 0.05, h: 0.05, y: 0.22 },
    ],
    ramp: [
      { z: 0.62, w: 0.15, h: 0.14, y: 0.4, wb: 0.11 }, { z: 0.38, w: 0.22, h: 0.19, y: 0.4, wb: 0.14 },
      { z: -0.3, w: 0.23, h: 0.2, y: 0.39, wb: 0.14 }, { z: -0.95, w: 0.18, h: 0.16, y: 0.35, wb: 0.11 },
      { z: -1.5, w: 0.1, h: 0.1, y: 0.27 }, { z: -1.82, w: 0.05, h: 0.06, y: 0.24 },
    ],
    slim: [
      { z: 0.6, w: 0.1, h: 0.17, y: 0.4 }, { z: 0.35, w: 0.15, h: 0.21, y: 0.39, wb: 0.13 },
      { z: -0.3, w: 0.15, h: 0.2, y: 0.37, wb: 0.12 }, { z: -0.9, w: 0.12, h: 0.15, y: 0.32 },
      { z: -1.5, w: 0.07, h: 0.09, y: 0.26 }, { z: -1.8, w: 0.04, h: 0.05, y: 0.24 },
    ],
  }[ch.pods];
  const podX = ch.pods === 'slim' ? 0.5 : 0.55;
  for (const sx of [-1, 1]) {
    const c = sx > 0 ? 'sidepodL' : 'sidepodR';
    P.add(c, 'paint', loft(pod.map((s, k) => ({ ...s, x: sx * (podX - k * 0.025) })), 24));
    const f = pod[0];
    P.add(c, 'black', loft([
      { z: f.z + 0.02, w: f.w * 0.82, h: f.h * 0.78, y: f.y + 0.01, x: sx * podX, n: 3.2 },
      { z: f.z - 0.02, w: f.w * 0.82, h: f.h * 0.78, y: f.y + 0.01, x: sx * podX, n: 3.2 },
    ], 16));
    P.add(c, 'carbon', box(0.02, 0.2, 0.55, sx * 0.8, 0.25, 0.62));
    P.add(c, 'carbon', box(0.17, 0.014, 0.42, sx * 0.72, 0.43, 0.76));
    P.hinge(c, sx * 0.32, g(0.36), 0);
    P.add('core', 'carbon', rod([sx * 0.3, 0.74, 0.6], [sx * 0.46, 0.84, 0.58], 0.012));
    P.add('core', 'paint', box(0.17, 0.075, 0.07, sx * 0.49, 0.845, 0.58));
  }
  floorAndDiffuser(P, 0.84, -2.15);
  // front wing: 4 elements sweeping up outboard
  const fwCurved = ch.frontWing === 'curved';
  const fwBend = (k) => (s) => {
    const out = Math.max(0, (s - 0.32) / 0.68);
    return [out * out * (fwCurved ? 0.1 + k * 0.03 : 0.035 + k * 0.012), -out * (fwCurved ? 0.05 : 0.02)];
  };
  const fwZ = Math.max(2.95, nose.tip + 0.2);
  [[1.95, 0.3, 0.1, 0.06, 0.09], [1.86, 0.2, 0.09, 0.3, 0.135], [1.78, 0.16, 0.09, 0.5, 0.17], [1.7, 0.13, 0.09, 0.72, 0.205]].forEach(([span, chord, th, ang, y], k) => {
    const e = aerofoil(span, chord, th, { camber: 0.06, bend: fwBend(k) });
    e.rotateX(ang);
    e.translate(0, g(y), fwZ - 0.06 - k * 0.075);
    P.add('frontWing', k === 0 ? 'carbon' : k === 3 ? 'paint' : 'wing', e);
  });
  for (const sx of [-1, 1]) {
    P.add('frontWing', 'wing', plate([[0, 0], [0.6, 0], [0.62, 0.2], [0.5, 0.27], [0.12, 0.27, 0, 0.12]], 0.022, sx * 0.975, 0.08, fwZ + 0.02));
    P.add('frontWing', 'carbon', rod([sx * 0.07, nose.ty, nose.tip - 0.25], [sx * 0.09, 0.12, fwZ - 0.1], 0.013));
  }
  P.hinge('frontWing', 0, g(0.15), fwZ - 0.2);
  // rear wing
  const spoon = ch.rearWing === 'spoon';
  const rw = aerofoil(1.0, 0.36, 0.12, { camber: 0.07, bend: (s) => [spoon ? -0.05 * (1 - s * s) : 0, 0] });
  rw.rotateX(0.14);
  rw.translate(0, g(0.86), -2.2);
  P.add('rearWing', 'carbon', rw);
  const flap = aerofoil(1.0, 0.24, 0.1, { camber: 0.08, bend: (s) => [spoon ? -0.03 * (1 - s * s) : 0, 0] });
  flap.rotateX(0.58);
  flap.translate(0, g(0.975), -2.17);
  P.add('rearWing', 'paint', flap);
  for (const sx of [-1, 1]) P.add('rearWing', 'wing', plate([[0, 0], [0.62, 0], [0.64, 0.5], [0.5, 0.74, 0.2, 0.74], [0, 0.6]], 0.022, sx * 0.51, 0.5, -1.98));
  const beam = aerofoil(0.88, 0.2, 0.1, { camber: 0.05 });
  beam.translate(0, g(0.42), -2.22);
  P.add('rearWing', 'carbon', beam);
  P.add('rearWing', 'carbon', rod([0, 0.48, -1.98], [0, 0.95, -2.2], 0.022));
  P.hinge('rearWing', 0, g(0.5), -2.0);
  P.add('core', 'carbon', box(0.12, 0.12, 0.4, 0, 0.35, -2.25));
  P.add('core', 'glow', box(0.11, 0.06, 0.02, 0, 0.37, -2.46));
  // cockpit, halo, T-cam, exhaust
  cockpitOpening(P, 0.785, 0.32, 0.27, 0.48);
  P.add('core', 'paint', box(0.5, 0.08, 0.16, 0, 0.78, 0.02));
  const haloPts = [[0.31, 0.74, -0.08], [0.34, 0.92, 0.18], [0.27, 0.985, 0.48], [0.1, 1.0, 0.66], [0, 1.0, 0.69], [-0.1, 1.0, 0.66], [-0.27, 0.985, 0.48], [-0.34, 0.92, 0.18], [-0.31, 0.74, -0.08]];
  P.add('core', 'black', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(haloPts.map(([x, y, z]) => new THREE.Vector3(x, g(y), z))), 40, 0.032, 8, false));
  P.add('core', 'black', rod([0, 1.0, 0.69], [0, 0.735, 0.98], 0.03));
  P.add('core', 'black', box(0.12, 0.05, 0.08, 0, 1.06 + air * 0.4, 0.02));
  P.add('core', 'metal', new THREE.CylinderGeometry(0.045, 0.05, 0.12, 12).rotateX(Math.PI / 2).translate(0, g(0.52), -2.08));
  suspension(P, ERA_SPECS['2020'], 0.18, 0.3);
  return P.finish();
}

function floorAndDiffuser(P, halfW, rearZ) {
  const floor = new THREE.Shape();
  floor.moveTo(-0.38, 1.45); floor.lineTo(0.38, 1.45); floor.lineTo(halfW - 0.04, 0.85); floor.lineTo(halfW, -1.1);
  floor.lineTo(halfW * 0.76, -1.55); floor.lineTo(halfW * 0.66, rearZ); floor.lineTo(-halfW * 0.66, rearZ); floor.lineTo(-halfW * 0.76, -1.55);
  floor.lineTo(-halfW, -1.1); floor.lineTo(-(halfW - 0.04), 0.85); floor.closePath();
  const fg = new THREE.ExtrudeGeometry(floor, { depth: 0.03, bevelEnabled: false });
  fg.rotateX(Math.PI / 2);
  fg.translate(0, g(0.1), 0);
  P.add('core', 'carbon', fg);
  for (const x of [-0.45, -0.15, 0.15, 0.45]) P.add('core', 'carbon', box(0.012, 0.2, 0.48, x * (halfW / 0.84), 0.18, rearZ + 0.2));
  P.add('core', 'carbon', box(halfW * 1.3, 0.012, 0.42, 0, 0.27, rearZ + 0.1));
}

function cockpitOpening(P, y, z, w, l) {
  const cock = new THREE.CircleGeometry(1, 28);
  cock.rotateX(-Math.PI / 2);
  cock.scale(w, 1, l);
  cock.rotateX(-0.06);
  cock.translate(0, g(y), z);
  P.add('core', 'black', cock);
}

/** Wishbones, push rods and uprights per corner (each corner is its own component). */
function suspension(P, E, innerF, innerR) {
  const { fz, rz, thF, thR } = E;
  for (const sx of [-1, 1]) {
    const cf = sx > 0 ? 'suspFL' : 'suspFR', cr = sx > 0 ? 'suspRL' : 'suspRR';
    const hf = sx * (thF - 0.12);
    P.add(cf, 'carbon', rod([sx * innerF, 0.5, fz + 0.25], [hf, 0.5, fz], 0.017));
    P.add(cf, 'carbon', rod([sx * innerF, 0.5, fz - 0.3], [hf, 0.5, fz], 0.017));
    P.add(cf, 'carbon', rod([sx * (innerF + 0.02), 0.3, fz + 0.3], [hf, 0.24, fz], 0.017));
    P.add(cf, 'carbon', rod([sx * (innerF + 0.02), 0.3, fz - 0.35], [hf, 0.24, fz], 0.017));
    P.add(cf, 'carbon', rod([sx * innerF, 0.36, fz + 0.05], [hf, 0.36, fz + 0.08], 0.013));
    P.add(cf, 'carbon', rod([sx * (innerF + 0.02), 0.52, fz - 0.1], [hf, 0.25, fz - 0.02], 0.015));
    P.add(cf, 'metal', box(0.07, 0.26, 0.14, sx * (thF - 0.13), AXLE, fz));
    P.hinge(cf, sx * innerF, g(0.4), fz);
    const hr = sx * (thR - 0.14);
    P.add(cr, 'carbon', rod([sx * innerR, 0.46, rz + 0.4], [hr, 0.48, rz], 0.017));
    P.add(cr, 'carbon', rod([sx * innerR, 0.46, rz - 0.15], [hr, 0.48, rz], 0.017));
    P.add(cr, 'carbon', rod([sx * (innerR - 0.02), 0.26, rz + 0.45], [hr, 0.24, rz], 0.017));
    P.add(cr, 'carbon', rod([sx * (innerR - 0.02), 0.26, rz - 0.15], [hr, 0.24, rz], 0.017));
    P.add(cr, 'carbon', rod([sx * innerR, 0.3, rz + 0.1], [hr, 0.5, rz + 0.02], 0.015));
    P.add(cr, 'metal', box(0.07, 0.28, 0.16, sx * (thR - 0.15), AXLE, rz));
    P.hinge(cr, sx * innerR, g(0.4), rz);
  }
}

// ------------------------------------------------------------------ historical models (2000s / 1990s)
function buildClassic(E) {
  const P = new Parts();
  const N = E.nose;
  const top = E.sideTop;
  // nose: low drooping (early 90s) or raised with pylons
  if (N.low) {
    P.add('nose', 'paint', loft([
      { z: N.tipZ, w: N.tipW, h: N.tipH, y: N.tipY, n: 2.2 },
      { z: N.tipZ - 0.3, w: 0.13, h: 0.09, y: N.tipY + 0.07 },
      { z: N.tipZ - 0.7, w: 0.17, h: 0.13, y: N.tipY + 0.17 },
      { z: 1.5, w: 0.22, h: 0.16, y: 0.43 },
    ]));
  } else {
    P.add('nose', 'paint', loft([
      { z: N.tipZ, w: N.tipW, h: N.tipH, y: N.tipY, n: 2.3 },
      { z: N.tipZ - 0.25, w: N.tipW + 0.04, h: N.tipH + 0.03, y: N.tipY + 0.02 },
      { z: N.tipZ - 0.6, w: 0.14, h: 0.11, y: (N.tipY + N.base) / 2 + 0.02 },
      { z: 1.5, w: 0.2, h: 0.14, y: N.base },
    ]));
  }
  P.hinge('nose', 0, g(N.low ? 0.42 : N.base), 1.52);
  // tub: narrower than 2020, cockpit sides at `top`
  const tubY = top - 0.24;
  P.add('core', 'paint', loft([
    { z: 1.56, w: 0.2, h: 0.14, y: N.low ? 0.43 : N.base },
    { z: 1.1, w: 0.25, h: 0.17, y: (N.low ? 0.45 : N.base) + 0.02 },
    { z: 0.75, w: 0.3, h: 0.22, y: tubY + 0.02, wb: 0.26 },
    { z: 0.3, w: 0.35, h: 0.24, y: tubY, wb: 0.3 },
    { z: -0.15, w: 0.37, h: 0.25, y: tubY, wb: 0.3 },
    { z: -0.45, w: 0.33, h: 0.25, y: tubY, wb: 0.27 },
  ]));
  // engine cover + airbox
  const A = E.airbox;
  P.add('core', 'paint', loft([
    { z: 0.06, w: A.w, h: A.h * 0.7, y: A.y - 0.02, n: 2.3 },
    { z: -0.2, w: A.w + 0.08, h: A.h + 0.12, y: A.y - 0.14 },
    { z: -0.6, w: 0.26, h: 0.3, y: 0.66 },
    { z: -1.0, w: 0.2, h: 0.24, y: 0.58, wb: 0.16 },
    { z: E.rz - 0.05, w: 0.12, h: 0.15, y: 0.47, wb: 0.09 },
    { z: E.rz - 0.4, w: 0.06, h: 0.08, y: 0.43 },
  ]));
  P.add('core', 'black', loft([
    { z: 0.08, w: A.w * 0.7, h: A.h * 0.55, y: A.y - 0.01, n: 2.4 },
    { z: 0.02, w: A.w * 0.65, h: A.h * 0.5, y: A.y - 0.01, n: 2.4 },
  ], 16));
  if (E.sharkFin) P.add('core', 'paint', plate([[0, 0], [1.2, 0], [1.2, 0.3], [0.1, 0.36], [0, 0.32]], 0.012, 0, 0.62, -0.45));
  // sidepods
  const S = E.pods;
  for (const sx of [-1, 1]) {
    const c = sx > 0 ? 'sidepodL' : 'sidepodR';
    const n = S.boxy ? 3.6 : 2.7;
    P.add(c, 'paint', loft([
      { z: S.zf, w: S.w * 0.8, h: S.h * 0.85, y: S.y + 0.02, x: sx * S.x, n, wb: S.w * 0.8 * S.under },
      { z: S.zf - 0.25, w: S.w, h: S.h, y: S.y + 0.02, x: sx * S.x, n, wb: S.w * S.under },
      { z: (S.zf + S.zr) / 2, w: S.w * 0.95, h: S.h * 0.95, y: S.y, x: sx * (S.x - 0.02), n, wb: S.w * S.under * 0.9 },
      { z: S.zr + 0.25, w: S.w * 0.6, h: S.h * 0.7, y: S.y - 0.04, x: sx * (S.x - 0.08), n },
      { z: S.zr, w: S.w * 0.3, h: S.h * 0.4, y: S.y - 0.07, x: sx * (S.x - 0.12), n },
    ], 24));
    P.add(c, 'black', loft([
      { z: S.zf + 0.02, w: S.w * 0.65, h: S.h * 0.6, y: S.y + 0.02, x: sx * S.x, n: 3 },
      { z: S.zf - 0.02, w: S.w * 0.65, h: S.h * 0.6, y: S.y + 0.02, x: sx * S.x, n: 3 },
    ], 16));
    if (E.barge) P.add(c, 'carbon', plate([[0, 0], [E.barge + 0.25, 0], [E.barge + 0.2, 0.22], [0.05, 0.26]], 0.015, sx * (S.x + S.w + 0.05), 0.12, S.zf + 0.3));
    if (E.periscope) P.add(c, 'metal', new THREE.CylinderGeometry(0.04, 0.045, 0.14, 10).translate(sx * (S.x - 0.04), g(S.y + S.h + 0.05), S.zr + 0.32));
    if (E.chimney) P.add(c, 'paint', box(0.07, E.chimney, 0.16, sx * (S.x + 0.06), S.y + S.h + E.chimney / 2 - 0.02, (S.zf + S.zr) / 2 - 0.15));
    if (E.flipups) P.add(c, 'carbon', plate([[0, 0], [0.22, 0], [0.18, 0.16], [0.02, 0.1]], 0.012, sx * (E.thR - 0.32), 0.3, E.rz + 0.55));
    if (E.horns) P.add('core', 'carbon', aerofoil(0.18, 0.12, 0.08).translate(sx * 0.3, g(top + 0.05), -0.05));
    P.hinge(c, sx * (S.x - 0.15), g(S.y), (S.zf + S.zr) / 2);
    // mirrors on stalks from the cockpit sides
    const [mx, my, mz] = E.mirrors;
    P.add('core', 'carbon', rod([sx * 0.22, top - 0.02, mz + 0.03], [sx * mx, my, mz], 0.011));
    P.add('core', 'paint', box(0.13, 0.065, 0.06, sx * (mx + 0.04), my, mz));
  }
  floorAndDiffuser(P, E.thF - 0.02, E.rz - 0.25);
  // front wing
  const F = E.fw;
  const bend = (s) => [F.spoon ? F.spoon * Math.max(0, 1 - s / 0.35) : 0, 0];
  const main = aerofoil(F.span, F.chord, 0.1, { camber: 0.05, bend });
  main.rotateX(0.05);
  main.translate(0, g(F.y), F.z);
  P.add('frontWing', 'wing', main);
  for (let k = 0; k < F.flaps; k++) {
    const flapSpan = F.span * (0.86 - k * 0.06) / 2;
    for (const sx of [-1, 1]) {
      // flaps sit outboard of the nose on each side
      const f = aerofoil(flapSpan * 0.82, F.chord * (0.62 - k * 0.1), 0.09, { camber: 0.08 });
      f.rotateX(0.32 + k * 0.22);
      f.translate(sx * (F.span / 2 - flapSpan * 0.45), g(F.y + 0.05 + k * 0.04), F.z - 0.12 - k * 0.07);
      P.add('frontWing', k === F.flaps - 1 ? 'paint' : 'wing', f);
    }
  }
  if (F.bridge) {
    const br = aerofoil(0.5, 0.12, 0.08, { camber: 0.07 });
    br.rotateX(0.3);
    br.translate(0, g(N.tipY + 0.1), F.z - 0.05);
    P.add('frontWing', 'carbon', br);
  }
  for (const sx of [-1, 1]) {
    P.add('frontWing', 'paint', plate([[0, 0], [F.endLen, 0], [F.endLen - 0.04, F.endH * 0.7], [F.endLen * 0.35, F.endH, 0.04, F.endH * 0.6]], 0.02, sx * (F.span / 2 + 0.01), F.y - 0.03, F.z + 0.03));
    if (!F.onNose) P.add('frontWing', 'carbon', box(0.02, Math.max(0.05, N.tipY - F.y - 0.02), 0.18, sx * 0.06, (N.tipY + F.y) / 2, F.z - 0.12));
  }
  P.hinge('frontWing', 0, g(F.y + 0.05), F.z - 0.15);
  // rear wing
  const R = E.rw;
  const rwm = aerofoil(R.span, R.chord, 0.12, { camber: 0.07 });
  rwm.rotateX(0.18);
  rwm.translate(0, g(R.y), R.z);
  P.add('rearWing', 'wing', rwm);
  for (let k = 0; k < R.flaps - 1; k++) {
    const f = aerofoil(R.span, R.chord * (0.62 - k * 0.12), 0.1, { camber: 0.08 });
    f.rotateX(0.55 + k * 0.25);
    f.translate(0, g(R.y + 0.1 + k * 0.08), R.z + 0.04 - k * 0.04);
    P.add('rearWing', k === R.flaps - 2 ? 'paint' : 'wing', f);
  }
  for (const sx of [-1, 1]) {
    P.add('rearWing', 'paint', plate([[0, 0], [R.endLen, 0], [R.endLen, R.endH], [0.06, R.endH]], 0.022, sx * (R.span / 2 + 0.012), R.y - R.endH + 0.18, R.z + 0.12));
    // rear wing supports to the gearbox
    P.add('rearWing', 'carbon', box(0.018, R.y - 0.32, 0.22, sx * 0.1, (R.y + 0.32) / 2, R.z - 0.16));
  }
  if (R.beam) {
    const b = aerofoil(R.span * 0.85, 0.17, 0.1, { camber: 0.05 });
    b.translate(0, g(0.4), R.z - 0.05);
    P.add('rearWing', 'carbon', b);
  }
  P.hinge('rearWing', 0, g(0.45), R.z);
  P.add('core', 'carbon', box(0.12, 0.12, 0.35, 0, 0.33, E.rz - 0.38));
  P.add('core', 'glow', box(0.1, 0.06, 0.02, 0, 0.35, E.rz - 0.57));
  // cockpit: open, with headrest pads; T-cam / roll hoop camera
  cockpitOpening(P, top - 0.005, 0.32, 0.25, 0.46);
  P.add('core', 'black', box(0.36, 0.06, 0.14, 0, top, -0.06));
  P.add('core', 'black', box(0.13, 0.05, 0.08, 0, A.y + A.h * 0.6, -0.02));
  // exhaust tailpipes (90s: low exits above the diffuser)
  if (!E.periscope) for (const sx of [-1, 1]) P.add('core', 'metal', new THREE.CylinderGeometry(0.04, 0.045, 0.12, 10).rotateX(Math.PI / 2).translate(sx * 0.2, g(0.36), E.rz - 0.28));
  suspension(P, E, 0.16, 0.22);
  return P.finish();
}

// ------------------------------------------------------------------ model cache
/** Flag every BufferGeometry reachable from a cached value as shared (never disposed per car). */
function markShared(v, seen = new Set()) {
  if (!v || typeof v !== 'object' || seen.has(v)) return v;
  seen.add(v);
  if (v.isBufferGeometry) { v.userData.shared = true; return v; }
  for (const x of Array.isArray(v) || v instanceof Map ? [...v.values()] : Object.values(v)) markShared(x, seen);
  return v;
}

const MODEL_CACHE = new Map();
function buildModel(car) {
  const key = car.sub === '2020' ? '2020:' + JSON.stringify(car.chassis) : car.sub;
  if (!MODEL_CACHE.has(key)) MODEL_CACHE.set(key, markShared(car.sub === '2020' ? build2020(car.chassis) : buildClassic(ERA_SPECS[car.sub])));
  return MODEL_CACHE.get(key);
}

const MERGED_CACHE = new Map();
function mergedModel(car, comps) {
  const key = car.sub === '2020' ? '2020:' + JSON.stringify(car.chassis) : car.sub;
  if (MERGED_CACHE.has(key)) return MERGED_CACHE.get(key);
  const out = {};
  for (const m of MATS) {
    const list = Object.values(comps).map((c) => c.geos[m]).filter(Boolean);
    out[m] = list.length ? mergeGeometries(list) : null;
  }
  MERGED_CACHE.set(key, markShared(out));
  return out;
}

// ------------------------------------------------------------------ wheels (per era)
const WHEEL_CACHE = new Map();
function buildWheels(E) {
  const key = JSON.stringify([E.tyreF, E.tyreR, E.rim]);
  if (WHEEL_CACHE.has(key)) return WHEEL_CACHE.get(key);
  const rimR = 0.228;
  const tyre = (R, W) => {
    const prof = [
      [rimR + 0.004, -W / 2], [R - 0.035, -W / 2], [R - 0.012, -W / 2 + 0.018], [R, -W / 2 + 0.05], [R, W / 2 - 0.05],
      [R - 0.012, W / 2 - 0.018], [R - 0.035, W / 2], [rimR + 0.004, W / 2],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    return new THREE.LatheGeometry(prof, 36).rotateZ(Math.PI / 2);
  };
  const grooves = (R, W, n) => {
    if (!n) return null;
    const parts = [];
    for (let k = 0; k < n; k++) {
      const x = -W / 2 + 0.06 + ((W - 0.12) * k) / Math.max(1, n - 1);
      parts.push(new THREE.TorusGeometry(R + 0.0005, 0.007, 3, 40).rotateY(Math.PI / 2).translate(x, 0, 0));
    }
    return prep(parts);
  };
  const make = (T) => {
    const { r: R, w: W } = T;
    const barrel = new THREE.CylinderGeometry(rimR, rimR, W - 0.01, 28, 1, true).rotateZ(Math.PI / 2);
    const lips = [];
    for (const s of [-1, 1]) {
      const ring = new THREE.RingGeometry(rimR - 0.035, rimR + 0.001, 32);
      ring.rotateY((Math.PI / 2) * s);
      ring.translate(s * (W / 2 - 0.006), 0, 0);
      lips.push(ring);
    }
    // thin spokes on the outer face only so the disc stays visible
    const n = E.rim.spokes;
    const spokesFor = (side) => {
      const out = [];
      for (let k = 0; k < n; k++) {
        const angles = n === 5 ? [0, 0.3] : [0]; // 2020: twin-spoke pairs
        for (const da of angles) {
          const b = new THREE.BoxGeometry(0.01, rimR - 0.05, n > 6 ? 0.016 : 0.022).translate(0, (rimR - 0.05) / 2 + 0.045, 0);
          b.rotateX((k / n) * Math.PI * 2 + da);
          b.translate(side * (W / 2 - 0.03), 0, 0);
          out.push(b);
        }
      }
      return prep(out);
    };
    const stripe = [];
    if (E.stripe) for (const s of [-1, 1]) {
      const r = new THREE.RingGeometry(R - 0.075, R - 0.058, 36);
      r.rotateY((Math.PI / 2) * s);
      r.translate(s * (W / 2 + 0.001), 0, 0);
      stripe.push(r);
    }
    return {
      tyre: tyre(R, W), grooves: grooves(R, W, T.grooves), rim: prep([barrel, ...lips]), spokesL: spokesFor(1),
      spokesR: spokesFor(-1), stripe: stripe.length ? prep(stripe) : null,
      hub: new THREE.CylinderGeometry(0.046, 0.046, 0.05, 12).rotateZ(Math.PI / 2), W, R,
    };
  };
  const d = E.rim.disc;
  // vented carbon disc: two faces + vane ring, slightly smaller than the rim so it reads clearly
  const disc = prep([
    new THREE.CylinderGeometry(d, d, 0.036, 32).rotateZ(Math.PI / 2),
    new THREE.TorusGeometry(d - 0.004, 0.012, 6, 32).rotateY(Math.PI / 2),
  ]);
  const out = {
    front: make(E.tyreF), rear: make(E.tyreR), disc,
    bell: new THREE.CylinderGeometry(d * 0.5, d * 0.5, 0.05, 16).rotateZ(Math.PI / 2),
    caliper: new THREE.BoxGeometry(0.06, 0.1, 0.16),
  };
  WHEEL_CACHE.set(key, markShared(out));
  return out;
}

// ------------------------------------------------------------------ livery texture
const LIVERY_CACHE = new Map();
function liveryTexture(car) {
  if (LIVERY_CACHE.has(car.id)) return LIVERY_CACHE.get(car.id);
  const W = 256, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const P = hex(car.primary), S = hex(car.secondary), A = hex(car.accent);
  // u (canvas x) runs around the body: 0 = left flank, 0.25 = top, 0.5 = right flank, 0.75 = belly
  x.fillStyle = P;
  x.fillRect(0, 0, W, H);
  const band = (u0, u1, col) => { x.fillStyle = col; x.fillRect(u0 * W, 0, (u1 - u0) * W, H); };
  if (car.pattern === 'split') {
    band(0.47, 1.0, S); band(0, 0.03, S);
    band(0.455, 0.47, A); band(0.03, 0.045, A);
  } else if (car.pattern === 'stripe') {
    band(0.56, 0.94, S);
    band(0.02, 0.07, A); band(0.43, 0.48, A);
  } else {
    band(0.6, 0.9, S);
    band(0.235, 0.265, A);
  }
  if (car.noseTip) { x.fillStyle = hex(car.noseTip); x.fillRect(0, 0, W, H * 0.07); }
  const grd = x.createLinearGradient(0, 0, W, 0);
  grd.addColorStop(0, 'rgba(0,0,0,0.05)'); grd.addColorStop(0.25, 'rgba(255,255,255,0.06)');
  grd.addColorStop(0.5, 'rgba(0,0,0,0.05)'); grd.addColorStop(0.75, 'rgba(0,0,0,0.2)'); grd.addColorStop(1, 'rgba(0,0,0,0.05)');
  x.fillStyle = grd;
  x.fillRect(0, 0, W, H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  LIVERY_CACHE.set(car.id, t);
  return t;
}

// ------------------------------------------------------------------ brake glow colour from temperature
const _hot = new THREE.Color();
/** Disc colour from temperature: dark metal below ~380 C, then dull red -> bright orange. Returns 0..1. */
export function brakeGlow(tempC, out = _hot) {
  const t = Math.max(0, Math.min(1, (tempC - 380) / 620));
  if (t <= 0) return out.setRGB(0, 0, 0), 0;
  out.setRGB(1, 0.06 + 0.26 * t * t, 0.01 + 0.03 * t * t * t);
  return t;
}

/** Legacy export: 2020 team list. */
export const LIVERIES = TEAMS;

const _wp = new THREE.Vector3(), _wq = new THREE.Quaternion(), _ws = new THREE.Vector3();

export class FormulaCar {
  /**
   * @param car catalog entry (CarCatalog.js) — 2020 team entries from Teams.js also work
   * @param opts {cockpit: adds the detailed cockpit, detachable: keeps components separate for crash damage}
   */
  constructor(car, opts = {}) {
    if (!car.sub) car = { ...car, sub: '2020' };
    this.team = this.livery = this.car = car;
    const E = (this.era = ERA_SPECS[car.sub]);
    const comps = buildModel(car);
    const Wh = buildWheels(E);
    this.detachable = !!opts.detachable;
    this.root = new THREE.Group();
    this.root.name = 'car-' + car.id;
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.eye = new THREE.Vector3(...E.eye);
    // tailpipe exit points (local, body frame) for exhaust-pop flames
    const ax = (h) => h - AXLE;
    this.exhausts = car.sub === '2020' ? [new THREE.Vector3(0, ax(0.52), -2.16)]
      : E.periscope ? [-1, 1].map((sx) => new THREE.Vector3(sx * (E.pods.x - 0.04), ax(E.pods.y + E.pods.h + 0.12), E.pods.zr + 0.32))
      : [-1, 1].map((sx) => new THREE.Vector3(sx * 0.2, ax(0.36), E.rz - 0.36));

    const mats = (this.materials = {
      paint: new THREE.MeshPhysicalMaterial({ map: liveryTexture(car), metalness: 0.05, roughness: 0.36, clearcoat: 0.7, clearcoatRoughness: 0.08, envMapIntensity: 0.75 }),
      wing: new THREE.MeshPhysicalMaterial({ color: car.wing, metalness: 0.05, roughness: 0.4, clearcoat: 0.55, clearcoatRoughness: 0.12, envMapIntensity: 0.6 }),
      carbon: new THREE.MeshPhysicalMaterial({ map: TX.carbonTexture(), color: 0x8a8a8a, metalness: 0.3, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.1 }),
      black: new THREE.MeshStandardMaterial({ color: 0x0c0c0e, metalness: 0.2, roughness: 0.45 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x9a9ea6, metalness: 0.95, roughness: 0.22 }),
      glow: new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1010, emissiveIntensity: 0.4 }),
      tyre: new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.82, metalness: 0 }),
      groove: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1 }),
      rim: new THREE.MeshStandardMaterial({ color: E.rim.color, metalness: 0.85, roughness: 0.28, side: THREE.DoubleSide }),
      spoke: new THREE.MeshStandardMaterial({ color: E.rim.color, metalness: 0.85, roughness: 0.25 }),
      stripe: new THREE.MeshStandardMaterial({ color: 0xffd21f, roughness: 0.6 }),
      hub: new THREE.MeshStandardMaterial({ color: car.primary, metalness: 0.6, roughness: 0.3 }),
      caliper: new THREE.MeshStandardMaterial({ color: car.accent, metalness: 0.4, roughness: 0.35 }),
      helmet: new THREE.MeshPhysicalMaterial({ color: car.helmet, metalness: 0.2, roughness: 0.25, clearcoat: 1 }),
      visor: new THREE.MeshStandardMaterial({ color: 0x050608, metalness: 0.9, roughness: 0.1 }),
    });
    const add = (geo, mat, parent, cast = true) => {
      if (!geo) return null;
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = cast;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    // ---- bodywork components
    this.components = {};
    if (this.detachable) {
      for (const [name, c] of Object.entries(comps)) {
        const grp = new THREE.Group();
        grp.name = name;
        grp.position.set(...c.hinge);
        const inner = new THREE.Group();
        inner.position.set(-c.hinge[0], -c.hinge[1], -c.hinge[2]);
        grp.add(inner);
        for (const m of MATS) add(c.geos[m], mats[m], inner, m !== 'glow');
        this.body.add(grp);
        this.components[name] = { group: grp, inner, hinge: c.hinge, attached: true };
      }
    } else {
      const merged = mergedModel(car, comps);
      for (const m of MATS) add(merged[m], mats[m], this.body, m !== 'glow');
    }
    const partParent = (name) => (this.components[name] ? this.components[name].inner : this.body);

    // helmet & visor
    const [hy, hz] = E.helmet;
    const helmet = new THREE.SphereGeometry(0.15, 24, 16).scale(1, 1.05, 1.12).translate(0, g(hy), hz);
    const visor = new THREE.SphereGeometry(0.153, 24, 6, Math.PI / 2 - 0.95, 1.9, Math.PI * 0.38, Math.PI * 0.15).scale(1, 1.05, 1.12).translate(0, g(hy), hz);
    this.helmet = add(helmet, mats.helmet, partParent('core'));
    add(visor, mats.visor, partParent('core'), false);

    // ---- decals
    this.detailParts = [];
    this.lodFar = false;
    const numTex = TX.numberTexture(car.number, car.numberColor, '#000000');
    const decal = new THREE.MeshStandardMaterial({ map: numTex, transparent: true, roughness: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    if (car.sub === '2020') {
      const nd = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.25), decal);
      nd.rotation.x = -Math.PI / 2 + 0.22;
      nd.position.set(0, g(0.628), 1.42);
      partParent('core').add(nd);
      this.detailParts.push(nd);
    } else {
      const N = E.nose;
      const nd = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), decal);
      nd.rotation.x = -Math.PI / 2 + (N.low ? 0.35 : 0.12);
      nd.position.set(0, g(N.low ? N.tipY + 0.23 : N.tipY + 0.13), N.low ? N.tipZ - 0.62 : N.tipZ - 0.5);
      partParent('nose').add(nd);
      this.detailParts.push(nd);
    }
    const textMat = new THREE.MeshStandardMaterial({ map: TX.liveryTextTexture(car.name.toUpperCase(), hex(car.pattern === 'split' && car.primary > 0xb00000 ? car.secondary : 0xffffff)), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 0.35 });
    const podOut = car.sub === '2020' ? (car.chassis.pods === 'slim' ? 0.655 : 0.775) : E.pods.x + E.pods.w + 0.005;
    const podY = car.sub === '2020' ? 0.42 : E.pods.y + 0.02;
    const podZ = car.sub === '2020' ? -0.2 : (E.pods.zf + E.pods.zr) / 2 + 0.05;
    for (const sx of [-1, 1]) {
      const n = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), decal);
      n.rotation.y = (sx * Math.PI) / 2;
      n.position.set(sx * (car.sub === '2020' ? 0.272 : 0.25), g(car.sub === '2020' ? 0.68 : 0.66), car.sub === '2020' ? -0.72 : -0.7);
      partParent('core').add(n);
      this.detailParts.push(n);
      const txt = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.16), textMat);
      txt.rotation.y = (sx * Math.PI) / 2;
      txt.position.set(sx * podOut, g(podY), podZ);
      partParent(sx > 0 ? 'sidepodL' : 'sidepodR').add(txt);
      this.detailParts.push(txt);
    }

    // ---- wheels: steering pivot -> spinning group; disc & caliper inside the open rim
    this.wheels = [];
    this.discMats = [];
    this.glowSprites = [];
    const glowTex = TX.smokeSprite();
    const defs = [
      { x: E.thF, z: E.fz, f: true }, { x: -E.thF, z: E.fz, f: true },
      { x: E.thR, z: E.rz, f: false }, { x: -E.thR, z: E.rz, f: false },
    ];
    for (const d of defs) {
      const W = d.f ? Wh.front : Wh.rear;
      const outward = Math.sign(d.x);
      const pivot = new THREE.Group();
      pivot.position.set(d.x, 0, d.z);
      const spin = new THREE.Group();
      pivot.add(spin);
      add(W.tyre, mats.tyre, spin);
      add(W.grooves, mats.groove, spin, false);
      add(W.rim, mats.rim, spin, false);
      add(W.stripe, mats.stripe, spin, false);
      const sp = add(outward > 0 ? W.spokesL : W.spokesR, mats.spoke, spin, false);
      const hub = add(W.hub, mats.hub, spin, false);
      hub.position.x = outward * (W.W / 2 - 0.02);
      this.detailParts.push(sp, hub);
      const discMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, emissive: 0x000000, emissiveIntensity: 1, metalness: 0.55, roughness: 0.5 });
      this.discMats.push(discMat);
      const disc = add(Wh.disc, discMat, spin, false);
      disc.position.x = outward * (W.W / 2 - 0.085); // just behind the spokes: visible from outside
      const bell = add(Wh.bell, mats.spoke, spin, false);
      bell.position.x = outward * (W.W / 2 - 0.06);
      const cal = add(Wh.caliper, mats.caliper, pivot, false);
      cal.position.set(outward * (W.W / 2 - 0.085), E.rim.disc - 0.02, -0.05);
      this.detailParts.push(bell, cal);
      // heat glow around the disc, also visible through the inside of the rim from behind
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff5a10, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      sprite.scale.setScalar(E.rim.disc * 2.6);
      sprite.position.x = outward * (W.W / 2 - 0.13);
      sprite.visible = false;
      pivot.add(sprite);
      this.glowSprites.push(sprite);
      this.root.add(pivot);
      this.wheels.push({ pivot, spin, front: d.f, r: W.R, base: pivot.position.clone(), attached: true, camber: 0, toe: 0 });
    }
    this.spinAngle = 0;
    this.pitch = 0;
    this.roll = 0;
    this.heave = 0;
    this.time = 0;
    this.brakeTemp = [25, 25, 25, 25];
    if (opts.cockpit) this._buildCockpit();
  }

  // ---------------------------------------------------------------- cockpit (player car)
  _buildCockpit() {
    const car = this.car;
    const E = this.era;
    const style = E.steering;
    const wheel = new THREE.Group();
    const parent = this.components.core ? this.components.core.inner : this.body;
    const wheelMat = new THREE.MeshStandardMaterial({ map: TX.carbonTexture(), color: 0x6a6a6a, roughness: 0.4, metalness: 0.3 });
    const grip = new THREE.MeshStandardMaterial({ color: 0x121214, roughness: 0.9 });
    const glove = new THREE.MeshStandardMaterial({ color: car.primary, roughness: 0.7 });
    if (style === '90s') {
      // small near-round wheel with a flat bottom, no display: dash is on the tub
      wheel.position.set(0, g(E.sideTop - 0.02), 0.55);
      wheel.rotation.x = 0.42;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.017, 8, 32), grip);
      wheel.add(ring);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 16).rotateX(Math.PI / 2), wheelMat);
      wheel.add(hub);
      for (const a of [0, Math.PI * 0.75, -Math.PI * 0.75]) {
        const sp = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.11, 0.01), wheelMat);
        sp.position.set(Math.sin(a) * 0.065, Math.cos(a) * 0.065, 0);
        sp.rotation.z = -a;
        wheel.add(sp);
      }
    } else {
      const big = style === '2020';
      wheel.position.set(0, g(big ? 0.8 : E.sideTop - 0.02), big ? 0.64 : 0.55);
      wheel.rotation.x = big ? 0.32 : 0.4;
      const sw = big ? 0.14 : 0.12;
      const shape = new THREE.Shape();
      shape.moveTo(-sw, -0.06); shape.lineTo(-sw, 0.05); shape.quadraticCurveTo(-sw + 0.01, 0.085, -sw + 0.05, 0.085);
      shape.lineTo(sw - 0.05, 0.085); shape.quadraticCurveTo(sw - 0.01, 0.085, sw, 0.05); shape.lineTo(sw, -0.06);
      shape.quadraticCurveTo(sw - 0.04, -0.09, 0.05, -0.08); shape.lineTo(-0.05, -0.08); shape.quadraticCurveTo(-sw + 0.04, -0.09, -sw, -0.06);
      const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.035, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2 });
      bodyGeo.translate(0, 0, -0.035);
      wheel.add(new THREE.Mesh(bodyGeo, wheelMat));
      for (const sx of [-1, 1]) {
        const g1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.024, 0.11, 4, 8), grip);
        g1.position.set(sx * (sw + 0.01), -0.01, -0.02);
        wheel.add(g1);
      }
    }
    for (const sx of [-1, 1]) {
      const gl = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 8).scale(1, 1.4, 1.1), glove);
      gl.position.set(sx * (style === '90s' ? 0.12 : style === '2020' ? 0.155 : 0.135), 0.0, -0.035);
      wheel.add(gl);
    }
    // display: on the wheel (2000s / 2020) or a dash pod on the tub (1990s)
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 128;
    this.dashCtx = cv.getContext('2d');
    this.dashTex = new THREE.CanvasTexture(cv);
    this.dashTex.colorSpace = THREE.SRGBColorSpace;
    const screenMat = new THREE.MeshBasicMaterial({ map: this.dashTex, toneMapped: false });
    if (style === '90s') {
      const pod = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.08), screenMat);
      pod.position.set(0, g(E.sideTop + 0.01), 0.68);
      pod.rotation.set(-0.5, Math.PI, 0);
      parent.add(pod);
    } else {
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(style === '2020' ? 0.11 : 0.09, style === '2020' ? 0.055 : 0.035), screenMat);
      screen.position.set(0, style === '2020' ? 0.015 : 0.04, -0.0425);
      screen.rotation.y = Math.PI;
      wheel.add(screen);
      const knobMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0.7, roughness: 0.3 });
      for (const [x, y] of [[-0.085, -0.045], [0.085, -0.045], [-0.04, -0.06], [0.04, -0.06]]) {
        const k = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.012, 10).rotateX(Math.PI / 2), knobMat);
        k.position.set(x, y, -0.043);
        wheel.add(k);
      }
      [0xe10600, 0x19d36a, 0xffd21f, 0x2a64b8].forEach((col, i) => {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.008, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.25 }));
        b.position.set(-0.095 + (i % 2) * 0.19, 0.045 - Math.floor(i / 2) * 0.025, -0.042);
        wheel.add(b);
      });
    }
    parent.add(wheel);
    this.steeringWheel = wheel;
    const pad = new THREE.MeshStandardMaterial({ color: 0x1c1d21, roughness: 0.9 });
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.5), pad);
      p.position.set(sx * 0.24, g((E.sideTop || 0.8) - 0.01), 0.32);
      parent.add(p);
    }
    // mirror glass facing the driver (shows the rear-view render target)
    this.mirrorMat = new THREE.MeshBasicMaterial({ color: 0x8090a0, toneMapped: false });
    const [mx, my, mz] = E.mirrors;
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(car.sub === '2020' ? 0.155 : 0.12, 0.058), this.mirrorMat);
      m.position.set(sx * (car.sub === '2020' ? mx : mx + 0.04), g(my), mz - 0.045);
      m.rotation.y = Math.PI + sx * 0.12;
      const uv = m.geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, sx > 0 ? 1 - uv.getX(i) * 0.5 : 0.5 - uv.getX(i) * 0.5);
      parent.add(m);
    }
    this._dashTimer = 0;
  }

  setMirrorTexture(tex) {
    if (!this.mirrorMat) return;
    this.mirrorMat.map = tex;
    this.mirrorMat.color.setHex(tex ? 0xffffff : 0x8090a0);
    this.mirrorMat.needsUpdate = true;
  }

  /** Wheel / dash display: gear, speed, rev LEDs, damage warning. */
  _drawDash(s) {
    const c = this.dashCtx;
    const W = 256, H = 128;
    c.fillStyle = '#05070a';
    c.fillRect(0, 0, W, H);
    const rpmN = Math.max(0, Math.min(1, ((s.rpm || 0) - (s.maxRpm || 12500) * 0.56) / ((s.maxRpm || 12500) * 0.44)));
    const leds = 15;
    for (let i = 0; i < leds; i++) {
      const on = i < Math.round(rpmN * leds);
      c.fillStyle = on ? (i < 5 ? '#1cff6b' : i < 10 ? '#ff2a1f' : '#3b8bff') : '#1a1d22';
      c.beginPath();
      c.arc(14 + i * 16.3, 12, 6, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = '#ffffff';
    c.font = 'bold 70px Arial';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(s.gearLabel || '-', W / 2, 74);
    c.font = 'bold 30px Arial';
    c.textAlign = 'left';
    c.fillText(String(Math.round(Math.abs(s.speed || 0) * 3.6)), 10, 62);
    c.font = '14px Arial';
    c.fillStyle = '#9aa4ae';
    c.fillText('KM/H', 10, 86);
    c.textAlign = 'right';
    c.fillStyle = s.manual ? '#ffd21f' : '#9aa4ae';
    c.fillText(s.manual ? 'MANUAL' : 'AUTO', W - 10, 86);
    if (s.damage > 0.05) {
      c.fillStyle = s.damage > 0.6 ? '#ff2a1f' : '#ffd21f';
      c.fillText('DAMAGE', W - 10, 60);
    }
    c.fillStyle = '#e10600';
    c.fillRect(0, H - 6, W * Math.max(0, Math.min(1, s.brake || 0)), 6);
    this.dashTex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- crash damage visuals
  hasComponent(name) {
    const c = this.components[name];
    return !!(c && c.attached);
  }

  /** Bend a component about its hinge (radians) and optionally crumple it (scale < 1 along an axis). */
  deform(name, { pitch = 0, yaw = 0, roll = 0, crumple = null, sag = 0 } = {}) {
    const c = this.components[name];
    if (!c || !c.attached) return;
    const g0 = c.group;
    g0.rotation.x += pitch;
    g0.rotation.y += yaw;
    g0.rotation.z += roll;
    g0.position.y -= sag;
    if (crumple) g0.scale.multiply(crumple);
  }

  /**
   * Detach a component: removed from the car and returned with its world transform
   * baked in, ready to become flying debris. Returns null if already gone.
   */
  detach(name) {
    const c = this.components[name];
    if (!c || !c.attached) return null;
    c.group.updateWorldMatrix(true, false);
    c.group.matrixWorld.decompose(_wp, _wq, _ws);
    c.attached = false;
    c.group.removeFromParent();
    c.group.position.copy(_wp);
    c.group.quaternion.copy(_wq);
    c.group.scale.copy(_ws);
    return c.group;
  }

  /** Detach a wheel (with its disc & caliper). */
  detachWheel(i) {
    const w = this.wheels[i];
    if (!w || !w.attached) return null;
    w.pivot.updateWorldMatrix(true, true);
    w.pivot.matrixWorld.decompose(_wp, _wq, _ws);
    w.attached = false;
    w.pivot.removeFromParent();
    w.pivot.position.copy(_wp);
    w.pivot.quaternion.copy(_wq);
    this.glowSprites[i].visible = false;
    return w.pivot;
  }

  /** Bend a wheel's suspension (camber / toe in radians) - visible on damaged corners. */
  bendWheel(i, camber, toe) {
    const w = this.wheels[i];
    w.camber += camber;
    w.toe += toe;
  }

  /** Undo all damage: re-attach components and wheels in their original places. */
  repair() {
    for (const c of Object.values(this.components)) {
      if (c.group.parent && c.group.parent !== this.body) c.group.removeFromParent();
      if (!c.group.parent) this.body.add(c.group);
      c.group.position.set(...c.hinge);
      c.group.rotation.set(0, 0, 0);
      c.group.scale.set(1, 1, 1);
      c.attached = true;
    }
    for (const w of this.wheels) {
      if (w.pivot.parent && w.pivot.parent !== this.root) w.pivot.removeFromParent();
      if (!w.pivot.parent) this.root.add(w.pivot);
      w.pivot.position.copy(w.base);
      w.pivot.rotation.set(0, 0, 0);
      w.attached = true;
      w.camber = 0;
      w.toe = 0;
    }
  }

  /**
   * @param {number} dt
   * @param {object} s - {speed, steer, accelLong, accelLat, brake, susp[4], compression[4], brakeTemp[4], rpm, maxRpm, gearLabel, manual, vibration, damage}
   */
  update(dt, s) {
    this.time += dt;
    this.spinAngle += (s.speed / CAR_SPEC.wheelRadiusR) * dt;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      if (!w.attached) continue;
      w.spin.rotation.x = this.spinAngle * (CAR_SPEC.wheelRadiusR / w.r);
      w.pivot.rotation.y = (w.front ? s.steer || 0 : 0) + w.toe;
      w.pivot.rotation.z = w.camber * Math.sign(w.base.x);
      if (s.susp) w.pivot.position.y = s.susp[i] - Math.abs(w.camber) * 0.25;
    }
    let pitchT = -(s.accelLong || 0) * 0.0019;
    let rollT = (s.accelLat || 0) * 0.0013;
    let heaveT = -Math.min(0.03, Math.abs(s.speed) * 0.00032);
    if (s.compression) {
      const c = s.compression;
      pitchT += ((c[0] + c[1]) - (c[2] + c[3])) * 0.012;
      rollT += ((c[1] + c[3]) - (c[0] + c[2])) * 0.012;
      heaveT -= ((c[0] + c[1] + c[2] + c[3]) / 4) * 0.015;
    }
    const k = 1 - Math.exp(-dt * 9);
    this.pitch += (THREE.MathUtils.clamp(pitchT, -0.035, 0.03) - this.pitch) * k;
    this.roll += (THREE.MathUtils.clamp(rollT, -0.03, 0.03) - this.roll) * k;
    this.heave += (heaveT - this.heave) * k;
    const vib = (s.vibration || 0) * Math.sin(this.time * 83) * 0.004;
    this.body.rotation.set(this.pitch, 0, this.roll);
    this.body.position.y = this.heave + vib;

    // brake discs: dark metal -> dull red -> orange with braking (physics temps for the player)
    let temps = s.brakeTemp;
    if (!temps) {
      temps = this.brakeTemp;
      const v = Math.abs(s.speed);
      for (let i = 0; i < 4; i++) {
        const heat = 9.5 * (s.brake || 0) * (i < 2 ? 0.56 : 0.44) * 2 * v;
        const cool = 0.11 * (temps[i] - 25) * (0.3 + v / 45);
        temps[i] = Math.max(25, temps[i] + (heat - cool) * dt);
      }
    }
    for (let i = 0; i < 4; i++) {
      const m = this.discMats[i];
      const t = brakeGlow(temps[i], m.emissive);
      m.emissiveIntensity = t > 0 ? 0.5 + t * 1.0 : 1;
      const sp = this.glowSprites[i];
      const o = this.wheels[i].attached && t > 0.08 ? Math.min(0.3, (t - 0.08) * 0.42) : 0;
      sp.visible = o > 0.01;
      if (sp.visible) {
        sp.material.opacity = o;
        sp.material.color.setRGB(0.95, 0.1 + 0.12 * t, 0.01);
      }
    }
    this.materials.glow.emissiveIntensity = (s.brake || 0) > 0.3 ? 3 : 0.5;

    if (this.steeringWheel) {
      this.steeringWheel.rotation.z = -((s.steer || 0) / 0.36) * 1.75;
      this._dashTimer -= dt;
      if (this._dashTimer <= 0 && s.dashVisible) {
        this._dashTimer = 1 / 15;
        this._drawDash(s);
      }
    }
  }

  /** Level of detail: far cars drop small parts and stop casting shadows. */
  setLOD(far) {
    if (far === this.lodFar) return;
    this.lodFar = far;
    for (const p of this.detailParts) if (p) p.visible = !far;
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData.cast === undefined) o.userData.cast = o.castShadow;
      o.castShadow = far ? false : o.userData.cast;
    });
  }

  setVisible(v) {
    this.root.visible = v;
  }

  dispose() {
    // per-car geometry (cockpit, decals, steering wheel ...) is freed; cached model/wheel geometry is shared
    const geos = new Set();
    this.root.traverse((o) => { if (o.geometry && !o.isSprite && !o.geometry.userData.shared) geos.add(o.geometry); });
    for (const c of Object.values(this.components || {})) c.group.traverse((o) => { if (o.geometry && !o.isSprite && !o.geometry.userData.shared) geos.add(o.geometry); });
    for (const gm of geos) gm.dispose();
    if (this.dashTex) this.dashTex.dispose();
    for (const m of Object.values(this.materials)) m.dispose();
    for (const m of this.discMats) m.dispose();
    for (const s of this.glowSprites) s.material.dispose();
    this.root.removeFromParent();
  }
}
