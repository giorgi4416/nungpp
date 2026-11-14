/**
 * Lap & sector timing for one competitor, using ordered checkpoints.
 * A lap only counts when every checkpoint has been passed in order, so
 * shortcuts, reversing over the line, or teleport-like jumps never score.
 * Crossing times are interpolated between physics steps for accuracy.
 */
export class LapTracker {
  constructor(track, checkpoints) {
    this.track = track;
    this.cps = checkpoints;
    this.reset(0, 0);
  }

  /**
   * @param s - current wrapped distance
   * @param lapStartTime - time the first lap starts (race: GO time; trial: set on first crossing)
   * @param flying - true for time trial (timing starts when crossing the line)
   */
  reset(s, lapStartTime, flying = false) {
    this.prevS = s;
    this.started = false;
    this.flying = flying;
    this.nextCp = 1;
    this.lapsCompleted = 0;
    this.lapStart = lapStartTime;
    this.sectorStart = lapStartTime;
    this.sector = 0;
    this.lapTimes = [];
    this.lapValid = [];
    this.bestLap = null;
    this.lastLap = null;
    this.sectorTimes = [null, null, null];
    this.lastSectorTimes = [null, null, null];
    this.bestSectors = [null, null, null];
    this.finished = false;
    this.finishTime = null;
    this.invalid = false;
    this.lastCpTime = lapStartTime;
    this.lastCpIndex = 0;
  }

  /** Continuous race progress in metres (for ordering). */
  progress() {
    const L = this.track.length;
    if (!this.started) return this.prevS - L;
    const list = this.cps.list;
    const lo = list[this.nextCp - 1];
    const hi = this.nextCp < list.length ? list[this.nextCp] : L;
    let s = this.prevS;
    if (this.nextCp >= list.length && s < 200) s = L; // just before the line wrap
    s = Math.min(hi, Math.max(lo, s));
    return this.lapsCompleted * L + s;
  }

  /**
   * Advance with the new wrapped distance at `time` (end of a step of length dt).
   * Returns an array of events (reused).
   */
  update(s, time, dt, out) {
    out.length = 0;
    const L = this.track.length;
    const prev = this.prevS;
    let ds = s - prev;
    if (ds > L / 2) ds -= L;
    if (ds < -L / 2) ds += L;
    this.prevS = s;
    if (Math.abs(ds) > 60) return out; // discontinuity (reset/teleport): never credits progress
    const cross = (from, to, at) => {
      // fraction of the step at which the boundary was crossed
      let a = at - from, b = to - from;
      if (b < -L / 2) b += L;
      if (a < -L / 2) a += L;
      const f = b !== 0 ? Math.min(1, Math.max(0, a / b)) : 1;
      return time - dt + dt * f;
    };
    const list = this.cps.list;
    // finish line (wrap) forward
    if (ds > 0 && prev > L - 120 && s < 120) {
      const t = cross(prev, s + L, L);
      if (!this.started) {
        this.started = true;
        this.nextCp = 1;
        if (this.flying) {
          this.lapStart = t;
          this.sectorStart = t;
        }
        out.push({ type: 'start', time: t });
      } else if (this.nextCp >= list.length) {
        const lapTime = t - this.lapStart;
        this.sectorTimes[2] = t - this.sectorStart;
        this._closeSector(2);
        this.lapTimes.push(lapTime);
        this.lapValid.push(!this.invalid);
        this.lastLap = lapTime;
        const isBest = !this.invalid && (this.bestLap == null || lapTime < this.bestLap);
        if (isBest) this.bestLap = lapTime;
        this.lapsCompleted++;
        out.push({ type: 'lap', time: t, lapTime, best: isBest, valid: !this.invalid, sectors: this.lastSectorTimes.slice(), lap: this.lapsCompleted });
        this.lapStart = t;
        this.sectorStart = t;
        this.nextCp = 1;
        this.sector = 0;
        this.sectorTimes = [null, null, null];
        this.invalid = false;
        this.lastCpTime = t;
        this.lastCpIndex = 0;
      }
      return out;
    }
    if (!this.started) return out;
    // ordered checkpoints (forward)
    if (ds > 0 && this.nextCp < list.length) {
      const c = list[this.nextCp];
      if (prev < c && s >= c) {
        const t = cross(prev, s, c);
        const idx = this.nextCp;
        const sec = this.cps.sectorIdx.indexOf(idx);
        if (sec >= 0) {
          this.sectorTimes[sec] = t - this.sectorStart;
          this._closeSector(sec);
          out.push({ type: 'sector', sector: sec, time: t, sectorTime: this.sectorTimes[sec] });
          this.sectorStart = t;
          this.sector = sec + 1;
        }
        this.nextCp++;
        this.lastCpTime = t;
        this.lastCpIndex = idx;
        out.push({ type: 'checkpoint', index: idx, lap: this.lapsCompleted, time: t });
      }
    } else if (ds < 0 && this.nextCp > 1) {
      // reversing back over a checkpoint un-credits it
      const c = list[this.nextCp - 1];
      if (prev >= c && s < c) this.nextCp--;
    }
    return out;
  }

  _closeSector(i) {
    const t = this.sectorTimes[i];
    this.lastSectorTimes[i] = t;
    if (!this.invalid && t != null && (this.bestSectors[i] == null || t < this.bestSectors[i])) this.bestSectors[i] = t;
  }

  currentLapTime(time) {
    if (!this.started && this.flying) return 0;
    return Math.max(0, time - this.lapStart);
  }
}

export function formatTime(sec, { sign = false, short = false } = {}) {
  if (sec == null || !Number.isFinite(sec)) return short ? '--.---' : '-:--.---';
  const neg = sec < 0;
  sec = Math.abs(sec);
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  const ss = s.toFixed(3).padStart(6, '0');
  const body = m > 0 || !short ? `${m}:${ss}` : s.toFixed(3);
  return (neg ? '-' : sign ? '+' : '') + body;
}
