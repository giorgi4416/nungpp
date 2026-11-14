/**
 * Live classification: finished cars by finishing time, everyone else by
 * checkpoint-validated race distance. Gaps are measured the broadcast way:
 * the time difference at the last common timing point.
 */
export class RacePosition {
  constructor() {
    this.order = [];
    this.leaderPass = new Map(); // key lap:cp -> time first crossed
  }

  reset() {
    this.order.length = 0;
    this.leaderPass.clear();
  }

  /** Record a checkpoint crossing; returns gap to the first car through that point. */
  recordPass(lap, cp, time) {
    const key = lap * 1000 + cp;
    const t0 = this.leaderPass.get(key);
    if (t0 == null) {
      this.leaderPass.set(key, time);
      return 0;
    }
    return time - t0;
  }

  /** Sort racers in place; assigns racer.position (1-based). */
  update(racers) {
    const o = this.order;
    o.length = 0;
    for (const r of racers) if (r.active) o.push(r);
    o.sort((a, b) => {
      if (a.tracker.finished && b.tracker.finished) return a.tracker.finishTime - b.tracker.finishTime;
      if (a.tracker.finished) return -1;
      if (b.tracker.finished) return 1;
      return b.tracker.progress() - a.tracker.progress();
    });
    o.forEach((r, i) => (r.position = i + 1));
    return o;
  }
}
