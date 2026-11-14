import { el, button, setVisible } from './dom.js';

/** Visual keyboard controls guide. */
export class ControlsPanel {
  constructor(root, audio) {
    const o = (this.node = el('section', 'screen overlay top'));
    o.innerHTML = `
      <div class="panel" role="dialog" aria-label="Controls">
        <h2><small>HOW TO DRIVE</small>Controls</h2>
        <div class="controls-grid">
          <div class="ctrl"><div class="keys"><kbd>W</kbd><kbd>↑</kbd></div><span><b>Accelerate</b>Throttle</span></div>
          <div class="ctrl"><div class="keys"><kbd>S</kbd><kbd>↓</kbd></div><span><b>Brake</b>Hold at a stop to reverse</span></div>
          <div class="ctrl"><div class="keys"><kbd>A</kbd><kbd>←</kbd></div><span><b>Steer left</b></span></div>
          <div class="ctrl"><div class="keys"><kbd>D</kbd><kbd>→</kbd></div><span><b>Steer right</b></span></div>
          <div class="ctrl"><div class="keys"><kbd class="wide">SPACE</kbd></div><span><b>Strong brake</b>Maximum stopping power</span></div>
          <div class="ctrl"><div class="keys"><kbd>C</kbd></div><span><b>Camera</b>Chase · Far · Cockpit</span></div>
          <div class="ctrl"><div class="keys"><kbd>R</kbd></div><span><b>Reset car</b>Back onto the track</span></div>
          <div class="ctrl"><div class="keys"><kbd>ESC</kbd></div><span><b>Pause</b>Menu, restart, quit</span></div>
          <div class="ctrl"><div class="keys"><kbd>M</kbd></div><span><b>Mute</b>Toggle all sound</span></div>
        </div>
        <p class="controls-tip">
          Steering is speed sensitive: the car turns sharply in slow corners and stays stable at 300 km/h.
          Brake in a straight line before the turn — watch the blue 150 / 100 / 50 m boards — and get back on the throttle at the exit.
          Kerbs are fine, but grass and gravel cost grip and speed. Turn 1 at the end of the main straight is the best overtaking spot.
        </p>
        <div class="actions"><button class="btn primary" data-act="close">Got it</button></div>
      </div>`;
    root.appendChild(o);
    button(o.querySelector('[data-act=close]'), audio, () => this.hide());
    o.addEventListener('click', (e) => { if (e.target === o) this.hide(); });
  }

  show(onClose) {
    this._onClose = onClose;
    setVisible(this.node, true);
    this.visible = true;
  }

  hide() {
    if (!this.visible) return;
    setVisible(this.node, false);
    this.visible = false;
    const cb = this._onClose;
    this._onClose = null;
    cb && cb();
  }
}
