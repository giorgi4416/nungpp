import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR_SPEC } from './VehiclePhysics.js';
import * as TX from '../scene/Textures.js';

/**
 * Procedurally modelled modern open-wheel Formula car.
 *
 * Built from lofted superellipse sections (monocoque, nose, engine cover,
 * sidepods), extruded aerofoils (front & rear wings), a tube-swept halo,
 * lathe-turned tyres, wheel covers, brake discs, suspension wishbones,
 * mirrors, helmet and livery decals. Static parts are merged per material
 * into a few draw calls and the geometry is shared by every car.
 *
 * Local frame: +Z forward, +Y up, +X left. Origin at wheel-axle height.
 */

const AXLE = 0.36; // axle height above ground
const g = (h) => h - AXLE; // ground height -> local y

// ------------------------------------------------------------------ geometry helpers
function superellipse(theta, w, h, n) {
  const c = Math.cos(theta), s = Math.sin(theta);
  const e = 2 / n;
  return [w * Math.sign(c) * Math.abs(c) ** e, h * Math.sign(s) * Math.abs(s) ** e];
}

/** Loft through sections [{z, w, h, y, n, x}] (y,x = section centre). */
function loft(sections, radial = 24, { capStart = true, capEnd = true } = {}) {
  const pos = [], uv = [], idx = [];
  const S = sections.length;
  for (let i = 0; i < S; i++) {
    const sec = sections[i];
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      const [x, y] = superellipse(th, sec.w, sec.h, sec.n ?? 2.6);
      pos.push((sec.x ?? 0) + x, g(sec.y) + y, sec.z);
      uv.push(j / radial, i / (S - 1));
    }
  }
  const row = radial + 1;
  for (let i = 0; i < S - 1; i++) for (let j = 0; j < radial; j++) {
    const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
    // sections run from front (+z) to back (-z)
    idx.push(a, b, c, b, d, c);
  }
  const addCap = (i, flip) => {
    const sec = sections[i];
    const centre = pos.length / 3;
    pos.push(sec.x ?? 0, g(sec.y), sec.z);
    uv.push(0.5, 0.5);
    for (let j = 0; j < radial; j++) {
      const a = i * row + j, b = a + 1;
      if (flip) idx.push(centre, b, a); else idx.push(centre, a, b);
    }
  };
  if (capStart) addCap(0, true);
  if (capEnd) addCap(S - 1, false);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Aerofoil (NACA-like) cross-section extruded along X (span); leading edge at z=0, chord toward -Z. */
function aerofoil(span, chord, thick, { camber = 0.04 } = {}) {
  const shape = new THREE.Shape();
  const N = 14;
  const top = [], bot = [];
  for (let i = 0; i <= N; i++) {
    const x = (i / N) ** 1.6; // cluster points at the leading edge
    const t = 5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4);
    const c = camber * 4 * x * (1 - x);
    top.push([x * chord, (c + t) * chord]);
    bot.push([x * chord, (c - t) * chord]);
  }
  shape.moveTo(top[0][0], top[0][1]);
  for (let i = 1; i <= N; i++) shape.lineTo(top[i][0], top[i][1]);
  for (let i = N; i >= 1; i--) shape.lineTo(bot[i][0], bot[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: span, bevelEnabled: false, steps: 1, curveSegments: 1 });
  geo.translate(0, 0, -span / 2);
  geo.rotateY(Math.PI / 2); // chord x -> -z, span z -> x
  return geo;
}

function box(w, h, d, x, y, z) {
  return new THREE.BoxGeometry(w, h, d).translate(x, g(y), z);
}

/** Cylinder rod between two points (ground-height coords). */
function rod(a, b, r = 0.018) {
  const A = new THREE.Vector3(a[0], g(a[1]), a[2]);
  const B = new THREE.Vector3(b[0], g(b[1]), b[2]);
  const len = A.distanceTo(B);
  const geo = new THREE.CylinderGeometry(r, r, len, 6, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  geo.applyQuaternion(q);
  geo.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return geo;
}

function prep(geos) {
  return mergeGeometries(geos.map((geo) => {
    const n = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
    if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    if (!n.attributes.normal) n.computeVertexNormals();
    return n;
  }));
}

let SHARED = null;

function buildShared() {
  const paint = [], accent = [], carbon = [], black = [], metal = [], glow = [];

  // ---- monocoque & nose
  paint.push(loft([
    { z: 2.66, w: 0.055, h: 0.045, y: 0.30 },
    { z: 2.45, w: 0.095, h: 0.075, y: 0.32 },
    { z: 2.05, w: 0.15, h: 0.115, y: 0.37 },
    { z: 1.6, w: 0.205, h: 0.15, y: 0.43 },
    { z: 1.2, w: 0.26, h: 0.19, y: 0.48 },
    { z: 0.85, w: 0.31, h: 0.235, y: 0.515 },
    { z: 0.4, w: 0.39, h: 0.26, y: 0.52 },
    { z: -0.1, w: 0.44, h: 0.27, y: 0.52 },
    { z: -0.45, w: 0.42, h: 0.27, y: 0.52 },
  ]));
  // nose tip accent
  accent.push(loft([
    { z: 2.72, w: 0.03, h: 0.025, y: 0.295 },
    { z: 2.66, w: 0.056, h: 0.046, y: 0.30 },
    { z: 2.5, w: 0.088, h: 0.07, y: 0.315 },
  ], 16));

  // ---- engine cover with airbox
  paint.push(loft([
    { z: 0.05, w: 0.18, h: 0.12, y: 0.86, n: 2.2 },
    { z: -0.15, w: 0.27, h: 0.33, y: 0.74 },
    { z: -0.55, w: 0.28, h: 0.36, y: 0.67 },
    { z: -1.05, w: 0.23, h: 0.29, y: 0.58 },
    { z: -1.6, w: 0.15, h: 0.2, y: 0.5 },
    { z: -2.05, w: 0.085, h: 0.12, y: 0.44 },
    { z: -2.3, w: 0.05, h: 0.07, y: 0.42 },
  ]));
  // airbox intake (black) above helmet
  black.push(loft([
    { z: 0.07, w: 0.11, h: 0.09, y: 0.94, n: 2.4 },
    { z: 0.0, w: 0.1, h: 0.08, y: 0.94, n: 2.4 },
  ], 16));
  // shark fin
  const fin = new THREE.Shape();
  fin.moveTo(0, 0); fin.lineTo(1.3, 0); fin.lineTo(1.3, 0.1); fin.lineTo(0.12, 0.47); fin.lineTo(0, 0.47);
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.012, bevelEnabled: false });
  finGeo.rotateY(Math.PI / 2);
  finGeo.translate(-0.006, g(0.55), -0.45); // fin from z=-0.45 back to -1.75
  accent.push(finGeo);

  // ---- sidepods (left & right)
  for (const sx of [-1, 1]) {
    paint.push(loft([
      { z: 0.6, w: 0.14, h: 0.16, y: 0.38, x: sx * 0.54 },
      { z: 0.35, w: 0.22, h: 0.205, y: 0.38, x: sx * 0.55 },
      { z: -0.25, w: 0.235, h: 0.2, y: 0.36, x: sx * 0.55 },
      { z: -0.85, w: 0.18, h: 0.155, y: 0.32, x: sx * 0.5 },
      { z: -1.45, w: 0.1, h: 0.105, y: 0.27, x: sx * 0.42 },
      { z: -1.8, w: 0.06, h: 0.07, y: 0.25, x: sx * 0.36 },
    ]));
    // inlet
    black.push(loft([
      { z: 0.62, w: 0.12, h: 0.13, y: 0.39, x: sx * 0.54, n: 3 },
      { z: 0.58, w: 0.12, h: 0.13, y: 0.39, x: sx * 0.54, n: 3 },
    ], 16));
    // side-impact/bargeboard winglets
    carbon.push(box(0.02, 0.22, 0.5, sx * 0.79, 0.27, 0.62));
    carbon.push(box(0.16, 0.015, 0.4, sx * 0.72, 0.43, 0.75));
  }

  // ---- floor / plank
  const floor = new THREE.Shape();
  floor.moveTo(-0.38, 1.45);
  floor.lineTo(0.38, 1.45);
  floor.lineTo(0.8, 0.85);
  floor.lineTo(0.82, -1.1);
  floor.lineTo(0.62, -1.55);
  floor.lineTo(0.55, -2.15);
  floor.lineTo(-0.55, -2.15);
  floor.lineTo(-0.62, -1.55);
  floor.lineTo(-0.82, -1.1);
  floor.lineTo(-0.8, 0.85);
  floor.closePath();
  const floorGeo = new THREE.ExtrudeGeometry(floor, { depth: 0.03, bevelEnabled: false });
  floorGeo.rotateX(Math.PI / 2); // shape y -> +z (forward), thickness downward
  floorGeo.translate(0, g(0.1), 0);
  carbon.push(floorGeo);
  // diffuser fences
  for (const x of [-0.45, -0.15, 0.15, 0.45]) carbon.push(box(0.012, 0.18, 0.45, x, 0.17, -1.95));

  // ---- front wing
  const fw = aerofoil(1.9, 0.34, 0.1, { camber: 0.05 });
  fw.translate(0, g(0.1), 2.92);
  carbon.push(fw);
  const f1 = aerofoil(1.7, 0.22, 0.09, { camber: 0.07 });
  f1.rotateX(0.28);
  f1.translate(0, g(0.155), 2.74);
  accent.push(f1);
  const f2 = aerofoil(1.55, 0.17, 0.09, { camber: 0.08 });
  f2.rotateX(0.5);
  f2.translate(0, g(0.205), 2.62);
  paint.push(f2);
  for (const sx of [-1, 1]) {
    accent.push(box(0.025, 0.26, 0.56, sx * 0.96, 0.2, 2.67));
    carbon.push(rod([sx * 0.06, 0.29, 2.42], [sx * 0.08, 0.13, 2.7], 0.012));
  }

  // ---- rear wing
  const rw = aerofoil(1.0, 0.36, 0.12, { camber: 0.06 });
  rw.rotateX(0.12);
  rw.translate(0, g(0.86), -2.2);
  carbon.push(rw);
  const rf = aerofoil(1.0, 0.24, 0.1, { camber: 0.07 });
  rf.rotateX(0.55);
  rf.translate(0, g(0.97), -2.18);
  paint.push(rf);
  for (const sx of [-1, 1]) {
    // endplates
    const ep = new THREE.Shape();
    ep.moveTo(0, 0); ep.lineTo(0.62, 0); ep.lineTo(0.62, 0.62); ep.lineTo(0.12, 0.7); ep.lineTo(0, 0.5);
    const epg = new THREE.ExtrudeGeometry(ep, { depth: 0.022, bevelEnabled: false });
    epg.rotateY(Math.PI / 2);
    epg.translate(sx * 0.51 - 0.011, g(0.5), -2.0);
    accent.push(epg);
  }
  // beam wing + swan neck pylons
  const bw = aerofoil(0.9, 0.2, 0.1, { camber: 0.05 });
  bw.translate(0, g(0.42), -2.22);
  carbon.push(bw);
  for (const sx of [-1, 1]) carbon.push(rod([sx * 0.06, 0.48, -2.0], [sx * 0.08, 0.92, -2.25], 0.02));
  // crash structure + rain light
  carbon.push(box(0.12, 0.12, 0.4, 0, 0.35, -2.25));
  glow.push(box(0.1, 0.06, 0.02, 0, 0.37, -2.46));

  // ---- cockpit opening, headrest, halo
  const cock = new THREE.CircleGeometry(1, 28);
  cock.rotateX(-Math.PI / 2);
  cock.scale(0.27, 1, 0.48);
  cock.rotateX(-0.06);
  cock.translate(0, g(0.785), 0.32);
  black.push(cock);
  accent.push(box(0.5, 0.08, 0.16, 0, 0.78, 0.02)); // headrest
  const haloPts = [[0.31, 0.74, -0.08], [0.34, 0.92, 0.18], [0.27, 0.985, 0.48], [0.1, 1.0, 0.66], [0, 1.0, 0.69], [-0.1, 1.0, 0.66], [-0.27, 0.985, 0.48], [-0.34, 0.92, 0.18], [-0.31, 0.74, -0.08]];
  const haloCurve = new THREE.CatmullRomCurve3(haloPts.map(([x, y, z]) => new THREE.Vector3(x, g(y), z)));
  black.push(new THREE.TubeGeometry(haloCurve, 40, 0.032, 8, false));
  black.push(rod([0, 1.0, 0.69], [0, 0.735, 0.98], 0.03));

  // ---- mirrors
  for (const sx of [-1, 1]) {
    carbon.push(rod([sx * 0.3, 0.72, 0.62], [sx * 0.44, 0.82, 0.6], 0.012));
    paint.push(box(0.15, 0.07, 0.06, sx * 0.47, 0.82, 0.6));
  }
  // T-cam
  black.push(box(0.12, 0.05, 0.08, 0, 1.06, 0.02));

  // ---- suspension (static wishbones)
  const fz = CAR_SPEC.frontZ, rz = CAR_SPEC.rearZ, tx = CAR_SPEC.trackHalf;
  for (const sx of [-1, 1]) {
    const hubF = [sx * (tx - 0.12), AXLE, fz];
    carbon.push(rod([sx * 0.18, 0.5, fz + 0.25], [hubF[0], 0.5, fz], 0.016));
    carbon.push(rod([sx * 0.18, 0.5, fz - 0.3], [hubF[0], 0.5, fz], 0.016));
    carbon.push(rod([sx * 0.2, 0.3, fz + 0.3], [hubF[0], 0.24, fz], 0.016));
    carbon.push(rod([sx * 0.2, 0.3, fz - 0.35], [hubF[0], 0.24, fz], 0.016));
    carbon.push(rod([sx * 0.18, 0.36, fz + 0.05], [hubF[0], 0.36, fz + 0.08], 0.013)); // track rod
    carbon.push(rod([sx * 0.2, 0.5, fz - 0.1], [hubF[0], 0.25, fz - 0.02], 0.014)); // push rod
    const hubR = [sx * (tx - 0.14), AXLE, rz];
    carbon.push(rod([sx * 0.3, 0.46, rz + 0.4], [hubR[0], 0.48, rz], 0.016));
    carbon.push(rod([sx * 0.3, 0.46, rz - 0.15], [hubR[0], 0.48, rz], 0.016));
    carbon.push(rod([sx * 0.28, 0.26, rz + 0.45], [hubR[0], 0.24, rz], 0.016));
    carbon.push(rod([sx * 0.28, 0.26, rz - 0.15], [hubR[0], 0.24, rz], 0.016));
    carbon.push(rod([sx * 0.3, 0.3, rz + 0.1], [hubR[0], 0.5, rz + 0.02], 0.014));
    // brake ducts / uprights
    metal.push(box(0.08, 0.28, 0.16, sx * (tx - 0.1), AXLE, fz));
    metal.push(box(0.08, 0.3, 0.18, sx * (tx - 0.12), AXLE, rz));
  }
  // exhaust
  metal.push(new THREE.CylinderGeometry(0.045, 0.05, 0.12, 12).rotateX(Math.PI / 2).translate(0, g(0.52), -2.08));

  // ---- wheels (spun separately)
  const tyre = (R, W) => {
    const prof = [
      [0.225, -W / 2], [R - 0.035, -W / 2], [R - 0.012, -W / 2 + 0.018], [R, -W / 2 + 0.05], [R, W / 2 - 0.05],
      [R - 0.012, W / 2 - 0.018], [R - 0.035, W / 2], [0.225, W / 2],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const geo = new THREE.LatheGeometry(prof, 32);
    geo.rotateZ(Math.PI / 2);
    return geo;
  };
  const rimCover = (W) => new THREE.CylinderGeometry(0.226, 0.226, W - 0.012, 24, 1, false).rotateZ(Math.PI / 2);
  const stripe = (R, W) => {
    const parts = [];
    for (const s of [-1, 1]) {
      const r = new THREE.RingGeometry(R - 0.075, R - 0.058, 32);
      r.rotateY(Math.PI / 2 * s);
      r.translate(s * (W / 2 + 0.001), 0, 0);
      parts.push(r);
    }
    return prep(parts);
  };
  const hub = (W) => new THREE.CylinderGeometry(0.05, 0.05, W + 0.03, 12).rotateZ(Math.PI / 2);
  const spokes = (W) => {
    const parts = [];
    for (let k = 0; k < 5; k++) {
      for (const s of [-1, 1]) {
        const b = new THREE.BoxGeometry(0.004, 0.18, 0.03).translate(0, 0.11, 0);
        b.rotateX((k / 5) * Math.PI * 2);
        b.translate(s * (W / 2 - 0.004), 0, 0);
        parts.push(b);
      }
    }
    return prep(parts);
  };
  const disc = new THREE.CylinderGeometry(0.15, 0.15, 0.03, 20).rotateZ(Math.PI / 2);

  const merged = {
    paint: prep(paint),
    accent: prep(accent),
    carbon: prep(carbon),
    black: prep(black),
    metal: prep(metal),
    glow: prep(glow),
    front: { tyre: tyre(CAR_SPEC.wheelRadiusF, 0.3), rim: rimCover(0.3), stripe: stripe(CAR_SPEC.wheelRadiusF, 0.3), hub: hub(0.3), spokes: spokes(0.3), W: 0.3 },
    rear: { tyre: tyre(CAR_SPEC.wheelRadiusR, 0.4), rim: rimCover(0.4), stripe: stripe(CAR_SPEC.wheelRadiusR, 0.4), hub: hub(0.4), spokes: spokes(0.4), W: 0.4 },
    disc,
    helmet: new THREE.SphereGeometry(0.15, 24, 16).scale(1, 1.05, 1.12).translate(0, g(0.88), 0.28),
    // visor band: partial sphere centred on +Z (phi = PI/2 faces forward)
    visor: new THREE.SphereGeometry(0.153, 24, 6, Math.PI / 2 - 0.95, 1.9, Math.PI * 0.38, Math.PI * 0.15).scale(1, 1.05, 1.12).translate(0, g(0.88), 0.28),
  };
  return merged;
}

export const LIVERIES = [
  { id: 'player', team: 'Danubio Racing', primary: 0xc4000f, secondary: 0x17181c, helmet: 0xffd21f, number: 7, numberColor: '#ffffff', textColor: '#ffffff', tyreStripe: 0xffd21f },
  { id: 'aurora', team: 'Aurora GP', primary: 0x0d8f8f, secondary: 0x101418, helmet: 0xffffff, number: 11, numberColor: '#ffffff', textColor: '#ffffff', tyreStripe: 0xffd21f },
  { id: 'vektor', team: 'Vektor Racing', primary: 0xff7a00, secondary: 0x1a2b6d, helmet: 0x1a2b6d, number: 4, numberColor: '#1a2b6d', textColor: '#1a2b6d', tyreStripe: 0xffd21f },
  { id: 'solaris', team: 'Solaris Motorsport', primary: 0xb8bec6, secondary: 0x0c7c3a, helmet: 0x0c7c3a, number: 63, numberColor: '#0c7c3a', textColor: '#0c7c3a', tyreStripe: 0xffd21f },
  { id: 'nordwind', team: 'Nordwind Racing', primary: 0x1c3fae, secondary: 0xffd21f, helmet: 0xe10600, number: 22, numberColor: '#ffd21f', textColor: '#ffd21f', tyreStripe: 0xffd21f },
];

export class FormulaCar {
  constructor(livery) {
    if (!SHARED) SHARED = buildShared();
    const S = SHARED;
    this.livery = livery;
    this.root = new THREE.Group();
    this.root.name = 'car-' + livery.id;
    // body rig pitches/rolls with load transfer; wheels stay planted
    this.body = new THREE.Group();
    this.root.add(this.body);

    const mats = (this.materials = {
      paint: new THREE.MeshPhysicalMaterial({ color: livery.primary, metalness: 0.05, roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.14, envMapIntensity: 0.5 }),
      accent: new THREE.MeshPhysicalMaterial({ color: livery.secondary, metalness: 0.05, roughness: 0.44, clearcoat: 0.5, clearcoatRoughness: 0.16, envMapIntensity: 0.5 }),
      carbon: new THREE.MeshStandardMaterial({ map: TX.carbonTexture(), color: 0x9a9a9a, metalness: 0.4, roughness: 0.38 }),
      black: new THREE.MeshStandardMaterial({ color: 0x0c0c0e, metalness: 0.2, roughness: 0.45 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x8c9096, metalness: 0.9, roughness: 0.3 }),
      glow: new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1010, emissiveIntensity: 0.4 }),
      tyre: new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.82, metalness: 0 }),
      rim: new THREE.MeshStandardMaterial({ color: 0x1d1e22, metalness: 0.75, roughness: 0.32 }),
      stripe: new THREE.MeshStandardMaterial({ color: livery.tyreStripe, roughness: 0.6 }),
      hub: new THREE.MeshStandardMaterial({ color: livery.primary, metalness: 0.6, roughness: 0.3 }),
      disc: new THREE.MeshStandardMaterial({ color: 0x3a3a3c, emissive: 0xff4a00, emissiveIntensity: 0, metalness: 0.6, roughness: 0.5 }),
      helmet: new THREE.MeshPhysicalMaterial({ color: livery.helmet, metalness: 0.2, roughness: 0.25, clearcoat: 1 }),
      visor: new THREE.MeshStandardMaterial({ color: 0x050608, metalness: 0.9, roughness: 0.1 }),
    });

    const add = (geo, mat, parent = this.body, cast = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = cast;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    add(S.paint, mats.paint);
    add(S.accent, mats.accent);
    add(S.carbon, mats.carbon);
    add(S.black, mats.black);
    add(S.metal, mats.metal);
    add(S.glow, mats.glow, this.body, false);
    add(S.helmet, mats.helmet);
    add(S.visor, mats.visor, this.body, false);

    // livery decals: racing number on nose and engine cover; team name on sidepods
    const numTex = TX.numberTexture(livery.number, livery.numberColor, '#000000');
    const decal = new THREE.MeshStandardMaterial({ map: numTex, transparent: true, roughness: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const nose = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), decal);
    nose.rotation.x = -Math.PI / 2 + 0.22;
    nose.position.set(0, g(0.628), 1.42);
    this.body.add(nose);
    for (const sx of [-1, 1]) {
      const n = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), decal);
      n.rotation.y = sx * Math.PI / 2;
      n.position.set(sx * 0.272, g(0.68), -0.72);
      this.body.add(n);
      const txt = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.19), new THREE.MeshStandardMaterial({ map: TX.liveryTextTexture(livery.team.toUpperCase(), livery.textColor), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 0.35 }));
      txt.rotation.y = sx * Math.PI / 2;
      txt.position.set(sx * 0.79, g(0.4), -0.15);
      this.body.add(txt);
    }

    // wheels: steering pivot -> spinning group
    this.wheels = [];
    const defs = [
      { x: CAR_SPEC.trackHalf, z: CAR_SPEC.frontZ, f: true },
      { x: -CAR_SPEC.trackHalf, z: CAR_SPEC.frontZ, f: true },
      { x: CAR_SPEC.trackHalf, z: CAR_SPEC.rearZ, f: false },
      { x: -CAR_SPEC.trackHalf, z: CAR_SPEC.rearZ, f: false },
    ];
    for (const d of defs) {
      const W = d.f ? S.front : S.rear;
      const pivot = new THREE.Group();
      pivot.position.set(d.x, 0, d.z);
      const spin = new THREE.Group();
      pivot.add(spin);
      add(W.tyre, mats.tyre, spin);
      add(W.rim, mats.rim, spin, false);
      add(W.stripe, mats.stripe, spin, false);
      add(W.spokes, mats.metal, spin, false);
      add(W.hub, mats.hub, pivot, false);
      const disc = add(S.disc, mats.disc, pivot, false);
      disc.position.x = -Math.sign(d.x) * (W.W / 2 + 0.03);
      this.root.add(pivot);
      this.wheels.push({ pivot, spin, front: d.f, r: d.f ? CAR_SPEC.wheelRadiusF : CAR_SPEC.wheelRadiusR, baseY: 0 });
    }
    this.spinAngle = 0;
    this.pitch = 0;
    this.roll = 0;
    this.heat = 0;
  }

  /**
   * @param {number} dt
   * @param {object} s - {speed, steer (rad), accelLong, accelLat, brake, susp: [4] (local wheel y), rpm}
   */
  update(dt, s) {
    this.spinAngle += (s.speed / CAR_SPEC.wheelRadiusR) * dt;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const r = w.r;
      w.spin.rotation.x = this.spinAngle * (CAR_SPEC.wheelRadiusR / r);
      if (w.front) w.pivot.rotation.y = s.steer || 0;
      if (s.susp) w.pivot.position.y = s.susp[i];
    }
    // body load transfer (visual only) - pitch under braking/accel, roll in corners
    const targetPitch = THREE.MathUtils.clamp(-(s.accelLong || 0) * 0.0016, -0.022, 0.022);
    const targetRoll = THREE.MathUtils.clamp((s.accelLat || 0) * 0.0011, -0.02, 0.02);
    const k = 1 - Math.exp(-dt * 8);
    this.pitch += (targetPitch - this.pitch) * k;
    this.roll += (targetRoll - this.roll) * k;
    this.body.rotation.set(this.pitch, 0, this.roll);
    // aero squat: body lower at speed
    this.body.position.y = -Math.min(0.025, Math.abs(s.speed) * 0.0003);
    // brake glow
    const b = s.brake || 0;
    this.heat += ((b > 0.5 && Math.abs(s.speed) > 20 ? 1 : 0) - this.heat) * (b > 0.5 ? dt * 1.5 : dt * 0.6);
    this.materials.disc.emissiveIntensity = this.heat * 2.2;
    this.materials.glow.emissiveIntensity = b > 0.3 ? 3 : 0.5;
  }

  setVisible(v) {
    this.root.visible = v;
  }

  dispose() {
    Object.values(this.materials).forEach((m) => m.dispose());
    this.root.removeFromParent();
  }
}
