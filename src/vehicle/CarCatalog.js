import { TEAMS } from './Teams.js';

/**
 * Car catalog: three regulation eras, each with sub-eras, each with its own
 * car geometry (see FormulaCar.js ERA_SPECS), engine, gearbox and performance.
 *
 * Performance multipliers are relative to the 2020 baseline (1.0) and are kept
 * modest so every car stays enjoyable: older cars carry less downforce and
 * grip but also less drag, and rev much higher (V10/V12 vs. the 2020 V6 hybrid).
 *
 * Historical liveries are original colour schemes in each team's period colours —
 * no sponsor or team logos. The `team` field links a historical entrant to the
 * modern team that descends from it, so team selection stays compatible.
 */

const G6 = [0, 105, 150, 192, 235, 280, 330];
const G7 = [0, 96, 136, 172, 208, 245, 284, 330];

export const ERAS = [
  {
    id: '2020', name: '2020 ERA', blurb: 'Turbo-hybrid V6, halo, wide cars with complex multi-element aero.',
    subs: [
      { id: '2020', name: '2020', years: '2020', engine: '1.6 L V6 turbo-hybrid', cylinders: 6, perf: { power: 1, downforce: 1, drag: 1, grip: 1, maxRpm: 12500, idleRpm: 4000 } },
    ],
  },
  {
    id: '2000s', name: '2000s ERA', blurb: 'Screaming naturally aspirated engines, narrow track, grooved tyres, high noses.',
    subs: [
      { id: '2000s-v10', name: 'V10 · 2000–2005', years: '2000–2005', engine: '3.0 L V10', cylinders: 10, perf: { power: 1.04, downforce: 0.86, drag: 0.9, grip: 0.97, maxRpm: 18500, idleRpm: 5500, gears: G7 } },
      { id: '2000s-v8', name: 'V8 · 2006–2008', years: '2006–2008', engine: '2.4 L V8', cylinders: 8, perf: { power: 0.97, downforce: 0.9, drag: 0.92, grip: 0.97, maxRpm: 19000, idleRpm: 6000, gears: G7 } },
    ],
  },
  {
    id: '1990s', name: '1990s ERA', blurb: 'Raw, mechanical, manual-era aero: from wide slick-shod cars to narrow grooved-tyre racers.',
    subs: [
      { id: '1990s-early', name: 'Early · 1990–1993', years: '1990–1993', engine: '3.5 L V10 / V12', cylinders: 12, perf: { power: 0.98, downforce: 0.7, drag: 0.95, grip: 0.97, maxRpm: 14500, idleRpm: 4500, gears: G6 } },
      { id: '1990s-mid', name: 'Mid · 1994–1997', years: '1994–1997', engine: '3.0 L V10', cylinders: 10, perf: { power: 0.97, downforce: 0.75, drag: 0.9, grip: 0.95, maxRpm: 16500, idleRpm: 5000, gears: G6 } },
      { id: '1990s-late', name: 'Late · 1998–1999', years: '1998–1999', engine: '3.0 L V10', cylinders: 10, perf: { power: 0.96, downforce: 0.72, drag: 0.88, grip: 0.93, maxRpm: 17000, idleRpm: 5000, gears: G6 } },
    ],
  },
];

export const SUBERA_BY_ID = Object.fromEntries(ERAS.flatMap((e) => e.subs.map((s) => [s.id, { ...s, era: e.id, eraName: e.name }])));

// historical liveries: [id, name, team (modern lineage), number, primary, secondary, accent, wing, pattern, helmet]
const H = (sub, list) => list.map(([id, name, team, number, primary, secondary, accent, wing, pattern, helmet, numberColor]) => ({
  id: `${sub}-${id}`, sub, name, team, number, primary, secondary, accent, wing: wing ?? secondary, pattern, helmet: helmet ?? accent,
  numberColor: numberColor ?? '#ffffff', chassis: { nose: 'long', pods: 'ramp', frontWing: 'flat', rearWing: 'flat', airbox: 'tall' },
}));

const HISTORICAL = [
  ...H('2000s-v10', [
    ['ferrari', 'Scuderia Ferrari', 'ferrari', 1, 0xd10000, 0x1a1a1c, 0xffffff, 0xd10000, 'solid', 0xd10000],
    ['mclaren', 'McLaren', 'mclaren', 3, 0xb9bec4, 0x17181b, 0xe2231a, 0x17181b, 'split', 0xffd21f],
    ['williams', 'Williams', 'williams', 5, 0xf2f2f2, 0x0b2a6b, 0x4fa3e0, 0x0b2a6b, 'split', 0x0b2a6b, '#0b2a6b'],
    ['renault', 'Renault', 'alpine', 7, 0x1f3c9e, 0xffd200, 0xffffff, 0x1f3c9e, 'stripe', 0xffd200, '#ffd200'],
    ['bar', 'BAR', 'mercedes', 9, 0xf2f2f2, 0xc8102e, 0xb8962e, 0xf2f2f2, 'split', 0xc8102e, '#c8102e'],
    ['jordan', 'Jordan', 'aston', 11, 0xffd400, 0x111214, 0x111214, 0x111214, 'solid', 0xffd400, '#111214'],
    ['jaguar', 'Jaguar', 'redbull', 14, 0x0b5e3b, 0xf2f2f2, 0xb8962e, 0x0b5e3b, 'stripe', 0x0b5e3b],
  ]),
  ...H('2000s-v8', [
    ['ferrari', 'Scuderia Ferrari', 'ferrari', 1, 0xd10000, 0xf2f2f2, 0x111111, 0xd10000, 'solid', 0xd10000],
    ['mclaren', 'McLaren', 'mclaren', 2, 0xc2c6cc, 0x17181b, 0xff6a00, 0x17181b, 'split', 0xffd21f],
    ['renault', 'Renault', 'alpine', 3, 0x2a4fb8, 0xffd200, 0xff8c00, 0x2a4fb8, 'stripe', 0xffd200, '#ffd200'],
    ['bmw', 'BMW Sauber', 'danubio', 10, 0xf2f2f2, 0x1d4fa0, 0xc8102e, 0x1d4fa0, 'split', 0x1d4fa0, '#1d4fa0'],
    ['honda', 'Honda', 'mercedes', 16, 0xf2f2f2, 0x1b3d2f, 0xc8102e, 0xf2f2f2, 'split', 0xc8102e, '#c8102e'],
    ['redbull', 'Red Bull Racing', 'redbull', 9, 0x1c2a5c, 0x0e1430, 0xe0242c, 0x1c2a5c, 'stripe', 0x1c2a5c, '#ffc906'],
    ['toyota', 'Toyota', 'haas', 11, 0xf2f2f2, 0xc8102e, 0x111214, 0xc8102e, 'split', 0xc8102e, '#c8102e'],
    ['williams', 'Williams', 'williams', 7, 0x0b2a6b, 0xf2f2f2, 0x4fa3e0, 0x0b2a6b, 'split', 0x4fa3e0],
  ]),
  ...H('1990s-early', [
    ['mclaren', 'McLaren', 'mclaren', 1, 0xf2f2f2, 0xd10a1a, 0xd10a1a, 0xd10a1a, 'split', 0xffd21f, '#d10a1a'],
    ['williams', 'Williams', 'williams', 5, 0xf2f2f2, 0x0b2a6b, 0xffd200, 0x0b2a6b, 'split', 0xffd200, '#0b2a6b'],
    ['ferrari', 'Scuderia Ferrari', 'ferrari', 27, 0xd10000, 0xf2f2f2, 0x111111, 0xd10000, 'solid', 0xd10000],
    ['benetton', 'Benetton', 'alpine', 19, 0x1a7a3a, 0x2a64b8, 0xffd21f, 0x2a64b8, 'stripe', 0xffd21f],
    ['tyrrell', 'Tyrrell', 'mercedes', 3, 0x13234f, 0xf2f2f2, 0x4fa3e0, 0x13234f, 'split', 0xf2f2f2],
  ]),
  ...H('1990s-mid', [
    ['williams', 'Williams', 'williams', 0, 0x0b2a6b, 0xf2f2f2, 0xd4a017, 0x0b2a6b, 'split', 0xd4a017],
    ['benetton', 'Benetton', 'alpine', 1, 0x5bb7e5, 0x1a7a3a, 0xffffff, 0x5bb7e5, 'stripe', 0x1a7a3a],
    ['ferrari', 'Scuderia Ferrari', 'ferrari', 27, 0xd10000, 0xf2f2f2, 0x111111, 0xd10000, 'solid', 0xd10000],
    ['mclaren', 'McLaren', 'mclaren', 7, 0xf2f2f2, 0xd10a1a, 0x111111, 0xd10a1a, 'split', 0xffd21f, '#d10a1a'],
    ['jordan', 'Jordan', 'aston', 11, 0xffd400, 0x111214, 0x1a7a3a, 0xffd400, 'solid', 0xffd400, '#111214'],
    ['sauber', 'Sauber', 'danubio', 14, 0x14254f, 0x1d8f8a, 0xffffff, 0x14254f, 'stripe', 0x1d8f8a],
  ]),
  ...H('1990s-late', [
    ['mclaren', 'McLaren', 'mclaren', 1, 0xc2c6cc, 0x17181b, 0xe2231a, 0x17181b, 'split', 0xffd21f],
    ['ferrari', 'Scuderia Ferrari', 'ferrari', 3, 0xd10000, 0xf2f2f2, 0x111111, 0xd10000, 'solid', 0xd10000],
    ['williams', 'Williams', 'williams', 5, 0xd10a1a, 0xf2f2f2, 0x111111, 0xd10a1a, 'split', 0xd10a1a],
    ['jordan', 'Jordan', 'aston', 9, 0xffd400, 0x111214, 0x111214, 0x111214, 'solid', 0xffd400, '#111214'],
    ['stewart', 'Stewart', 'redbull', 16, 0xf2f2f2, 0x13234f, 0xc8102e, 0xf2f2f2, 'stripe', 0x13234f, '#13234f'],
    ['benetton', 'Benetton', 'alpine', 7, 0x4f9fe0, 0xf2f2f2, 0x1a2b6d, 0x4f9fe0, 'split', 0xf2f2f2],
  ]),
];

/** Every selectable car. 2020 cars are the existing team entries (each with its own chassis concept). */
export const CARS = [
  ...TEAMS.map((t) => ({ ...t, sub: '2020', team: t.id, teamId: t.id, id: `2020-${t.id}` })),
  ...HISTORICAL.map((c) => ({ ...c, teamId: c.team })),
];
for (const c of CARS) {
  const s = SUBERA_BY_ID[c.sub];
  c.era = s.era;
  c.years = s.years;
  c.engine = s.engine;
  c.carName = `${c.name} · ${s.years}`;
}

export const CAR_BY_ID = Object.fromEntries(CARS.map((c) => [c.id, c]));
export const carsForSub = (sub) => CARS.filter((c) => c.sub === sub);
export function defaultCarId(teamId = 'ferrari') {
  return CAR_BY_ID[`2020-${teamId}`] ? `2020-${teamId}` : '2020-ferrari';
}
