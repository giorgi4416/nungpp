import { LapTracker } from './LapSystem.js';
import { RacePosition } from './RacePosition.js';

/**
 * Owns the competitors, lap trackers, classification and race rules
 * (race distance, chequered flag, finishing order). Emits events that the
 * game turns into HUD notifications and sounds.
 */
export class RaceManager {
  constructor(track, checkpoints, onEvent) {
    this.track = track;
    this.cps = checkpoints;
    this.onEvent = onEvent || (() => {});
    this.positions = new RacePosition();
    this.racers = [];
    this.mode = 'race';
    this.totalLaps = 3;
    this.startTime = 0;
    this.chequered = false;
    this._evs = [];
  }

  /**
   * @param {'race'|'trial'} mode
   * @param racers [{id, name, short, team, color, isPlayer, getS: () => wrapped s, getSpeed: () => m/s}]
   */
  setup(mode, totalLaps, racers) {
    this.mode = mode;
    this.totalLaps = mode === 'race' ? totalLaps : Infinity;
    this.chequered = false;
    this.positions.reset();
    this.bestSectorsAll = [null, null, null];
    this.bestLapAll = null;
    this.racers = racers.map((r) => ({
      ...r,
      active: true,
      tracker: new LapTracker(this.track, this.cps),
      position: 0,
      gap: 0,
      prevPosition: 0,
    }));
    for (const r of this.racers) r.tracker.reset(r.getS(), 0, mode === 'trial');
    this.player = this.racers.find((r) => r.isPlayer);
  }

  /** Race clock starts (lights out). */
  start(time) {
    this.startTime = time;
    for (const r of this.racers) {
      r.tracker.lapStart = time;
      r.tracker.sectorStart = time;
      r.tracker.lastCpTime = time;
    }
  }

  fixedUpdate(time, dt) {
    const evs = this._evs;
    for (const r of this.racers) {
      if (!r.active) continue;
      const tr = r.tracker;
      const wasFinished = tr.finished;
      tr.update(r.getS(), time, dt, evs);
      for (const e of evs) this._handle(r, e, wasFinished);
    }
    const order = this.positions.update(this.racers);
    if (this.player) {
      const p = this.player;
      if (p.prevPosition && p.position !== p.prevPosition && this.mode === 'race' && !p.tracker.finished && time - this.startTime > 2.5) {
        this.onEvent(p.position < p.prevPosition ? 'position-gained' : 'position-lost', { racer: p, position: p.position });
      }
      p.prevPosition = p.position;
    }
    return order;
  }

  _handle(r, e, wasFinished) {
    const tr = r.tracker;
    if (e.type === 'checkpoint') {
      r.gap = this.positions.recordPass(e.lap, e.index, e.time);
    } else if (e.type === 'sector') {
      const i = e.sector;
      let cls = 'yellow';
      if (tr.bestSectors[i] === e.sectorTime) cls = 'green';
      if (!tr.invalid && (this.bestSectorsAll[i] == null || e.sectorTime < this.bestSectorsAll[i])) {
        this.bestSectorsAll[i] = e.sectorTime;
        cls = 'purple';
      }
      e.cls = cls;
      if (r.isPlayer) this.onEvent('sector', { racer: r, ...e });
    } else if (e.type === 'lap') {
      r.gap = this.positions.recordPass(e.lap, 0, e.time);
      const s3 = e.sectors[2];
      if (s3 != null) {
        let cls = tr.bestSectors[2] === s3 ? 'green' : 'yellow';
        if (e.valid && (this.bestSectorsAll[2] == null || s3 < this.bestSectorsAll[2])) {
          this.bestSectorsAll[2] = s3;
          cls = 'purple';
        }
        e.s3cls = cls;
      }
      let overall = false;
      if (e.valid && (this.bestLapAll == null || e.lapTime < this.bestLapAll)) {
        this.bestLapAll = e.lapTime;
        overall = true;
      }
      e.overall = overall;
      if (this.mode === 'race' && !wasFinished && (tr.lapsCompleted >= this.totalLaps || this.chequered)) {
        tr.finished = true;
        tr.finishTime = e.time;
        const first = !this.chequered;
        this.chequered = true;
        this.onEvent(r.isPlayer ? 'finish' : 'ai-finish', { racer: r, time: e.time, winner: first });
      }
      if (r.isPlayer) this.onEvent('lap', { racer: r, ...e });
    } else if (e.type === 'start') {
      if (r.isPlayer) this.onEvent('lap-start', { racer: r });
    }
  }

  /** Final/live classification rows for the results screen. */
  classification(now) {
    const order = this.positions.update(this.racers);
    const leader = order[0];
    const leaderTime = leader && leader.tracker.finished ? leader.tracker.finishTime - this.startTime : null;
    return order.map((r) => {
      const tr = r.tracker;
      const total = tr.finished ? tr.finishTime - this.startTime : null;
      const lapsDown = leader ? leader.tracker.lapsCompleted - tr.lapsCompleted : 0;
      let gap = '';
      if (r === leader) gap = total != null ? 'WINNER' : 'LEADER';
      else if (tr.finished && leaderTime != null) gap = lapsDown > 0 ? `+${lapsDown} LAP${lapsDown > 1 ? 'S' : ''}` : '+' + (total - leaderTime).toFixed(3);
      else gap = 'RUNNING';
      return { racer: r, position: r.position, total, gap, bestLap: tr.bestLap, laps: tr.lapsCompleted, now };
    });
  }
}
