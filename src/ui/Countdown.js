import { el, setVisible } from './dom.js';

/**
 * Start-light sequence: five red columns light one per second, hold for a
 * randomised delay, then all go green -> "GO!". Driven by game time (dt), so
 * it pauses correctly. Mirrors the 3D gantry lights through a callback.
 */
export class Countdown {
  constructor(root, audio) {
    this.audio = audio;
    const n = (this.node = el('section', 'screen lights'));
    n.innerHTML = `
      <div class="light-rig">${'<div class="light-pod"><i></i><i></i></div>'.repeat(5)}</div>
      <div class="grid-caption" data-cap>FORMATION COMPLETE · GRID READY</div>
      <div class="go-text" data-go>GO!</div>`;
    root.appendChild(n);
    this.pods = [...n.querySelectorAll('.light-pod')];
    this.go = n.querySelector('[data-go]');
    this.cap = n.querySelector('[data-cap]');
    this.active = false;
  }

  /**
   * @param opts {preDelay, interval, onLights(nRed, green), onGo, caption}
   */
  start({ preDelay = 2.4, interval = 1.0, holdMin = 0.6, holdMax = 2.2, onLights, onGo, caption = '' } = {}) {
    this.t = 0;
    this.preDelay = preDelay;
    this.interval = interval;
    this.hold = holdMin + Math.random() * (holdMax - holdMin);
    this.onLights = onLights;
    this.onGo = onGo;
    this.lit = 0;
    this.green = false;
    this.active = true;
    this.done = false;
    this.cap.textContent = caption;
    this.cap.style.opacity = caption ? '1' : '0';
    this.go.classList.remove('show');
    this._render();
    setVisible(this.node, true);
    this.onLights && this.onLights(0, false);
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    if (!this.green) {
      const n = Math.max(0, Math.min(5, Math.floor((this.t - this.preDelay) / this.interval) + 1));
      if (this.t >= this.preDelay && n > this.lit) {
        this.lit = n;
        this.audio.countdownBeep();
        this._render();
        this.onLights && this.onLights(this.lit, false);
      }
      const allOnAt = this.preDelay + this.interval * 4;
      if (this.lit === 5 && this.t >= allOnAt + this.hold) {
        this.green = true;
        this._render();
        this.onLights && this.onLights(0, true);
        this.audio.goSound();
        this.go.classList.remove('show');
        void this.go.offsetWidth; // restart animation
        this.go.classList.add('show');
        this.cap.style.opacity = '0';
        this.goTime = this.t;
        this.onGo && this.onGo();
      }
    } else if (this.t - this.goTime > 1.6) {
      this.active = false;
      setVisible(this.node, false);
      this.onLights && this.onLights(0, false);
    }
  }

  _render() {
    this.pods.forEach((p, k) => {
      const [a, b] = p.children;
      const on = !this.green && k < this.lit;
      a.className = on ? 'on' : this.green ? 'green' : '';
      b.className = on ? 'on' : this.green ? 'green' : '';
    });
  }

  cancel() {
    this.active = false;
    this.go.classList.remove('show');
    setVisible(this.node, false);
    this.onLights && this.onLights(0, false);
  }
}
