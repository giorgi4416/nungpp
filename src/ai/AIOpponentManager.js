import { AIDriver } from './AIDriver.js';
import { FormulaCar, LIVERIES } from '../vehicle/FormulaCar.js';

/** Four fictional rivals with distinct pace and racecraft. */
export const AI_ROSTER = [
  { name: 'M. VARGA', short: 'VAR', liveryId: 'aurora', skill: 0.975, aggression: 0.75, launch: 0.22 },
  { name: 'L. FONTAINE', short: 'FON', liveryId: 'vektor', skill: 0.958, aggression: 0.55, launch: 0.3 },
  { name: 'K. BRANDT', short: 'BRA', liveryId: 'solaris', skill: 0.944, aggression: 0.6, launch: 0.38 },
  { name: 'R. OKAFOR', short: 'OKA', liveryId: 'nordwind', skill: 0.93, aggression: 0.85, launch: 0.26 },
];

export const DIFFICULTY = { easy: 0.92, medium: 0.985, hard: 1.04 };

export class AIOpponentManager {
  constructor(RAPIER, world, scene, track) {
    this.track = track;
    this.drivers = AI_ROSTER.map((p) => {
      const livery = LIVERIES.find((l) => l.id === p.liveryId);
      const car = new FormulaCar(livery);
      scene.add(car.root);
      const d = new AIDriver(RAPIER, world, track, car, p);
      d.livery = livery;
      return d;
    });
    this._list = [];
  }

  setDifficulty(name) {
    const m = DIFFICULTY[name] ?? DIFFICULTY.medium;
    for (const d of this.drivers) d.difficulty = m;
  }

  setEnabled(on) {
    for (const d of this.drivers) d.setEnabled(on);
  }

  /** Spread the cars around the lap for the menu's live backdrop. */
  placeDemo() {
    const L = this.track.length;
    this.drivers.forEach((d, i) => {
      d.place(L * (0.92 - i * 0.07), this.track.lineOffset[0]);
      d.release(0);
      d.speed = 40;
    });
  }

  /** Grid slots: [{s, lateral}] - AI fill the first slots, player takes the last. */
  placeOnGrid(slots) {
    this.drivers.forEach((d, i) => {
      const slot = slots[i];
      d.place(slot.s - this.track.length, slot.lateral); // behind the line: s < 0 unwrapped
    });
  }

  release() {
    for (const d of this.drivers) d.release(d.profile.launch + Math.random() * 0.15);
  }

  /** @param others - extra participants (player) [{s, lateral, speed, isPlayer}] */
  fixedUpdate(dt, player) {
    const list = this._list;
    list.length = 0;
    for (const d of this.drivers) list.push({ ref: d, s: d.wrappedS, lateral: d.lateral, speed: d.speed, isPlayer: false });
    if (player) list.push(player);
    for (const d of this.drivers) if (d.enabled !== false) d.fixedUpdate(dt, list);
  }
}
