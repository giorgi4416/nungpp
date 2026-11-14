// Dev tool: integrate the Hungaroring layout and write an SVG preview.
import { writeFileSync } from 'node:fs';
import { integrateLayout, TRACK_LENGTH } from '../src/track/HungaroringLayout.js';

const out = process.argv[2] || 'layout.svg';
const L = integrateLayout();
const scale = TRACK_LENGTH / L.length;
console.log('raw length', L.length.toFixed(1), 'main', L.mainLen.toFixed(1), 'back', L.backLen.toFixed(1), 'closure', L.closure.toFixed(4), 'scale', scale.toFixed(3));
const pts = L.points.map(([x, y]) => [x * scale, y * scale]);
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
console.log('extent', (maxX - minX).toFixed(0), 'x', (maxY - minY).toFixed(0));
const pad = 60, W = maxX - minX + pad * 2, H = maxY - minY + pad * 2;
const tx = (x) => x - minX + pad, ty = (y) => maxY - y + pad;
let d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${tx(x).toFixed(1)},${ty(y).toFixed(1)}`).join('') + 'Z';
let labels = '';
for (const c of L.corners) {
  const i = Math.min(pts.length - 1, Math.round(c.apex * scale) );
  const p = pts[Math.min(pts.length - 1, Math.round((c.apex / L.length) * pts.length))];
  labels += `<text x="${tx(p[0]) + 18}" y="${ty(p[1]) - 10}" font-size="40" fill="#c00">${c.turn}</text>`;
}
const s0 = pts[0];
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${(1000 * H / W).toFixed(0)}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="none" stroke="#222" stroke-width="13"/><circle cx="${tx(s0[0])}" cy="${ty(s0[1])}" r="20" fill="green"/>${labels}</svg>`;
writeFileSync(out, svg);
