/**
 * Fixed-timestep simulation with interpolated rendering, on top of
 * renderer.setAnimationLoop. Physics/AI/timing advance in exact 1/120 s steps
 * regardless of monitor refresh rate; rendering interpolates between steps.
 */
export class GameLoop {
  constructor(renderer, { fixedDt = 1 / 120, maxSteps = 10, fixed, frame }) {
    this.renderer = renderer;
    this.fixedDt = fixedDt;
    this.maxSteps = maxSteps;
    this.fixed = fixed;
    this.frame = frame;
    this.acc = 0;
    this.last = null;
    this.running = false;
    this.fps = 60;
    this._tick = this._tick.bind(this);
  }

  start() {
    if (this.running) return; // never start a second loop
    this.running = true;
    this.last = null;
    this.renderer.setAnimationLoop(this._tick);
  }

  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  _tick(now) {
    if (this.last === null) this.last = now;
    // clamp long frames (tab switches, hitches) so the simulation never explodes
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= this.fixedDt && steps < this.maxSteps) {
      this.fixed(this.fixedDt);
      this.acc -= this.fixedDt;
      steps++;
    }
    if (steps === this.maxSteps) this.acc = 0;
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;
    this.frame(dt, this.acc / this.fixedDt);
  }
}
