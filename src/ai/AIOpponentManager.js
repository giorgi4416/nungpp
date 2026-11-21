import { AIDriver } from './AIDriver.js';
import { FormulaCar } from '../vehicle/FormulaCar.js';
import { AI_DRIVERS } from '../vehicle/Teams.js';
import { CAR_BY_ID, carsForSub, SUBERA_BY_ID } from '../vehicle/CarCatalog.js';

export const DIFFICULTY = { easy: 0.92, medium: 0.985, hard: 1.04 };

/** Preferred rival line-up; the player's own team is skipped. */
const RIVAL_ORDER = ['redbull', 'ferrari', 'mclaren', 'mercedes', 'aston', 'alpine', 'williams', 'haas'];

export class AIOpponentManager {
  constructor(RAPIER, world, scene, track, playerCarId) {
    this.track = track;
    this.scene = scene;
    this.drivers = AI_DRIVERS.map((p) => new AIDriver(RAPIER, world, track, null, p));
    this._list = [];
    this.eraPace = 1;
    this.setPlayerCar(playerCarId);
  }

  /** Rivals drive cars from the same era as the player (any team except the player's). */
  setPlayerCar(playerCarId) {
    const player = CAR_BY_ID[playerCarId];
    const pool = carsForSub(player.sub).filter((c) => c.id !== player.id);
    pool.sort((a, b) => (RIVAL_ORDER.indexOf(a.teamId) + 1 || 99) - (RIVAL_ORDER.indexOf(b.teamId) + 1 || 99));
    // older cars have less grip: rivals lap a little slower too
    this.eraPace = Math.sqrt(SUBERA_BY_ID[player.sub].perf.grip * (0.7 + 0.3 * SUBERA_BY_ID[player.sub].perf.downforce));
    if (this._difficulty) this.setDifficulty(this._difficulty);
    this.drivers.forEach((d, i) => {
      const team = pool[i % pool.length];
      if (d.livery && d.livery.id === team.id) return;
      const visible = d.car ? d.car.root.visible : true;
      if (d.car) d.car.dispose();
      d.car = new FormulaCar(team);
      d.car.setVisible(visible);
      d.livery = team;
      this.scene.add(d.car.root);
    });
  }

  setDifficulty(name) {
    this._difficulty = name;
    const m = (DIFFICULTY[name] ?? DIFFICULTY.medium) * this.eraPace;
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
      d.place(slot.s - this.track.length, slot.lateral);
    });
  }

  release() {
    for (const d of this.drivers) d.release(d.profile.launch + Math.random() * 0.15);
  }

  fixedUpdate(dt, player) {
    const list = this._list;
    list.length = 0;
    for (const d of this.drivers) list.push({ ref: d, s: d.wrappedS, lateral: d.lateral, speed: d.speed, isPlayer: false });
    if (player) list.push(player);
    for (const d of this.drivers) if (d.enabled !== false) d.fixedUpdate(dt, list);
  }

  dispose(world) {
    for (const d of this.drivers) {
      if (d.car) d.car.dispose();
      world.removeRigidBody(d.body);
    }
  }
}
