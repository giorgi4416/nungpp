// Dev tool: build every circuit's track data and report key numbers (length, reference lap,
// speed range, crossover clearance). Usage: node tools/track-report.mjs [id]
import { TrackGeometry } from '../src/track/TrackGeometry.js';
import { CIRCUITS, CIRCUIT_ORDER } from '../src/track/circuits/index.js';
import { buildCheckpoints } from '../src/track/Checkpoints.js';

for (const id of process.argv[2] ? [process.argv[2]] : CIRCUIT_ORDER) {
  const t0 = performance.now();
  const T = new TrackGeometry(CIRCUITS[id]);
  let lap = 0;
  for (let i = 0; i < T.count; i++) lap += T.ds / T.speedProfile[i];
  const cps = buildCheckpoints(T);
  // crossover: samples far apart along the track but close in plan view
  let cross = null;
  for (let i = 0; i < T.count; i += 2) {
    const j = T.nearestIndex(T.pos[i * 3], T.pos[i * 3 + 2], 12, i, Math.round(200 / T.ds));
    if (j >= 0) { const dy = Math.abs(T.pos[i * 3 + 1] - T.pos[j * 3 + 1]); if (!cross || dy < cross.dy) cross = { i, j, dy: +dy.toFixed(2), under: T.pos[i * 3 + 1] < T.pos[j * 3 + 1] ? T.corners.find((c) => c.start > i * T.ds)?.name : T.corners.find((c) => c.start > j * T.ds)?.name }; }
  }
  const h = []; for (let i = 0; i < T.count; i++) h.push(T.pos[i * 3 + 1]);
  let maxGrade = 0; for (let i = 0; i < T.count; i++) maxGrade = Math.max(maxGrade, Math.abs(T.slope[i]));
  console.log(id.padEnd(12), 'len', T.length.toFixed(0), 'samples', T.count, 'refLap', lap.toFixed(1) + 's', 'v', (Math.min(...T.speedProfile) * 3.6).toFixed(0) + '-' + (Math.max(...T.speedProfile) * 3.6).toFixed(0), 'elev', Math.min(...h).toFixed(1) + '..' + Math.max(...h).toFixed(1), 'maxGrade', (maxGrade * 100).toFixed(1) + '%', 'cps', cps.list.length, 'sectors', cps.sectorEnds.map((x) => x.toFixed(0)).join('/'), 'crossover', cross ? JSON.stringify(cross) : 'none', (performance.now() - t0).toFixed(0) + 'ms');
}
