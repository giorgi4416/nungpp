import { el, button, setVisible } from './dom.js';
import { keyLabel } from '../systems/InputManager.js';

/** Visual controls guide; shows the player's current key bindings. */
export class ControlsPanel {
  constructor(root, audio, input) {
    this.input = input;
    const o = (this.node = el('section', 'screen overlay top'));
    o.innerHTML = `
      <div class="panel" role="dialog" aria-label="Controls">
        <h2><small>HOW TO DRIVE</small>Controls</h2>
        <div class="controls-grid" data-grid></div>
        <p class="controls-tip">
          Steering is speed sensitive: the car turns sharply in slow corners and stays stable at 300 km/h.
          Brake in a straight line before the turn — watch the blue 150 / 100 / 50 m boards. Hit a barrier hard and the car
          really breaks: wings, nose, suspension and wheels can come off. Press R to respawn a repaired car.
          Drag the mouse on the 3D view to look around the car (or around the cockpit), scroll to zoom, V or double-click to reset.
          In Manual transmission shift up near the blue shift lights and don't over-rev on downshifts.
          Remap any key in Settings → Controls. Gamepads are supported (right stick looks around).
        </p>
        <div class="actions"><button class="btn primary" data-act="close">Got it</button></div>
      </div>`;
    root.appendChild(o);
    button(o.querySelector('[data-act=close]'), audio, () => this.hide());
    o.addEventListener('click', (e) => { if (e.target === o) this.hide(); });
  }

  _render() {
    const b = this.input.bindings;
    const keys = (a) => (b[a] || []).filter(Boolean).map((c) => `<kbd class="${keyLabel(c).length > 3 ? 'wide' : ''}">${keyLabel(c)}</kbd>`).join('');
    const rows = [
      ['accelerate', 'Accelerate', 'Throttle'], ['brake', 'Brake', 'Hold at a stop to reverse'], ['left', 'Steer left', ''], ['right', 'Steer right', ''],
      ['strongBrake', 'Strong brake', 'Maximum stopping power'], ['shiftUp', 'Shift up', 'Manual transmission'], ['shiftDown', 'Shift down', 'Manual transmission'],
      ['camera', 'Camera', 'Chase · Far · Cockpit'], ['cameraReset', 'Reset view', 'Or double-click the 3D view'],
      ['lookLeft', 'Look left', 'Hold (cockpit)'], ['lookRight', 'Look right', 'Hold (cockpit)'], ['reset', 'Reset car', 'Back onto the track'], ['pause', 'Pause', 'Menu, restart, quit'], ['mute', 'Mute', 'Toggle all sound'],
    ];
    this.node.querySelector('[data-grid]').innerHTML = rows.map(([a, t, d]) => `<div class="ctrl"><div class="keys">${keys(a)}</div><span><b>${t}</b>${d}</span></div>`).join('');
  }

  show(onClose) {
    this._onClose = onClose;
    this._render();
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
