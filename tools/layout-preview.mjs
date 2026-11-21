// Dev tool: render a circuit definition to SVG (corner labels, start line, crossings).
// Usage: node tools/layout-preview.mjs <circuitId> out.svg
import { writeFileSync } from 'node:fs';
import { integrateLayout } from '../src/track/layout.js';
import { CIRCUITS } from '../src/track/circuits/index.js';

const def = CIRCUITS[process.argv[2] || 'hungaroring'];
const out = process.argv[3] || 'layout.svg';
const L = integrateLayout(def.segments, 1);
const scale = def.length / L.length;
console.log(def.id, 'raw', L.length.toFixed(0), 'solved', L.solved.map((x) => (x * scale).toFixed(0)).join('/'), 'scale', scale.toFixed(3), 'heading', ((L.heading * 180) / Math.PI).toFixed(1));
const pts = L.points.map(([x, y]) => [x * scale, y * scale]);
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
console.log('extent', (maxX - minX).toFixed(0), 'x', (maxY - minY).toFixed(0));
const pad = 80, W = maxX - minX + pad * 2, H = maxY - minY + pad * 2;
const tx = (x) => x - minX + pad, ty = (y) => maxY - y + pad;
const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${tx(x).toFixed(1)},${ty(y).toFixed(1)}`).join('') + 'Z';
const fs = Math.max(W, H) / 45;
let labels = '';
for (const c of L.corners) {
  const p = pts[Math.min(pts.length - 1, Math.round((c.apex / L.length) * pts.length))];
  labels += `<text x="${tx(p[0]) + fs * 0.4}" y="${ty(p[1]) - fs * 0.3}" font-size="${fs}" font-family="Arial" fill="#c00">${c.num}</text>`;
}
const so = pts[Math.round((def.startOffset / def.length) * pts.length) % pts.length];
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${((1000 * H) / W).toFixed(0)}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="none" stroke="#222" stroke-width="${fs * 0.35}" stroke-linejoin="round"/><circle cx="${tx(so[0])}" cy="${ty(so[1])}" r="${fs * 0.5}" fill="green"/>${labels}</svg>`;
writeFileSync(out, svg);
