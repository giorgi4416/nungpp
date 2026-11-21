/** Hungaroring, Mogyoród — 4.381 km, 14 corners, clockwise, a technical circuit in a wooded valley. */
const bumps = [
  [0.0, 0.10, 4.0], [0.16, 0.06, -5.5], [0.245, 0.05, -3.0], [0.36, 0.05, 5.5], [0.47, 0.06, 1.5],
  [0.62, 0.07, -3.5], [0.78, 0.06, -1.5], [0.95, 0.08, 2.5], [1.0, 0.10, 4.0], [-0.05, 0.08, 2.5],
];

export default {
  id: 'hungaroring',
  name: 'Hungaroring',
  gp: 'Hungarian Grand Prix',
  location: 'Mogyoród, Hungary',
  length: 4381,
  startOffset: 330,
  halfWidth: 6.75,
  direction: 'Clockwise',
  // prettier-ignore
  segments: [
    { s: 'A' },
    { t: 'T1', n: 1, dir: -1, ang: 136, r: 28 },
    { s: 212 },
    { t: 'T2', n: 2, dir: +1, ang: 92, r: 50 },
    { s: 95 },
    { t: 'T3', n: 3, dir: -1, ang: 83, r: 60 },
    { s: 'B' },
    { t: 'T4', n: 4, dir: +1, ang: 52, r: 125 },
    { s: 187 },
    { t: 'T5', n: 5, dir: -1, ang: 134, r: 58 },
    { s: 273 },
    { t: 'T6', n: 6, dir: -1, ang: 91, r: 24 },
    { s: 42 },
    { t: 'T7', n: 7, dir: +1, ang: 84, r: 24 },
    { s: 95 },
    { t: 'T8', n: 8, dir: +1, ang: 80, r: 48 },
    { s: 39 },
    { t: 'T9', n: 9, dir: -1, ang: 98, r: 44 },
    { s: 231 },
    { t: 'T10', n: 10, dir: +1, ang: 38, r: 95 },
    { s: 47 },
    { t: 'T11', n: 11, dir: -1, ang: 69, r: 92 },
    { s: 308 },
    { t: 'T12', n: 12, dir: -1, ang: 84, r: 34 },
    { s: 152 },
    { t: 'T13', n: 13, dir: +1, ang: 81, r: 40 },
    { s: 146 },
    { t: 'T14', n: 14, dir: -1, ang: 93, r: 52 },
    { s: 151 },
  ],
  elevation: (u) => {
    let h = 0;
    for (const [c, w, a] of bumps) { const d = (u - c) / w; h += a * Math.exp(-d * d); }
    return h;
  },
  sectors: ['T4', 'T11'], // sector boundaries after these corners
  runoff: { base: 11, extra: 20, gravel: true },
  pit: { side: 1, from: -420, to: 300, wall: 4.5 },
  brakingBoards: ['T1', 'T2', 'T5', 'T6', 'T12', 'T13', 'T14'],
  grandstands: [
    { s: 0, side: -1, length: 280, rows: 20, roof: true, gap: 9 },
    { s: -260, side: -1, length: 140, rows: 14, roof: false, gap: 9 },
    { at: 'T1', offset: -70, side: 'out', length: 110, rows: 16, roof: true, gap: 6 },
    { at: 'T1', ref: 'apex', offset: 20, side: 'out', length: 80, rows: 12, roof: false, gap: 6 },
    { at: 'T2', ref: 'apex', side: 'out', length: 90, rows: 12, roof: false, gap: 8 },
    { at: 'T4', offset: -30, side: 'out', length: 110, rows: 14, roof: true, gap: 8 },
    { at: 'T5', ref: 'apex', side: 'out', length: 90, rows: 12, roof: false, gap: 8 },
    { at: 'T6', offset: -60, side: -1, length: 100, rows: 12, roof: true, gap: 6 },
    { at: 'T12', offset: -60, side: -1, length: 120, rows: 14, roof: true, gap: 7 },
    { at: 'T14', ref: 'apex', side: -1, length: 110, rows: 14, roof: true, gap: 8 },
  ],
  bridge: ['T3', 'T4'],
  theme: 'valley',
  trees: 8500,
  ambient: 29,
  sky: { zenith: 0x2f6fc4, horizon: 0xd6e6f3, fog: 0xc9dbea, sunElevation: 38, sunAzimuth: 215 },
};
