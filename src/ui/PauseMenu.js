import { el, button, setVisible } from './dom.js';

/** Pause overlay: resume, restart, controls, settings, main menu. */
export class PauseMenu {
  constructor(root, audio, handlers) {
    const o = (this.node = el('section', 'screen overlay'));
    o.innerHTML = `
      <div class="panel pause-panel" role="dialog" aria-label="Paused">
        <h2><small data-sub>RACE</small>Paused</h2>
        <div class="menu-buttons">
          <button class="menu-btn primary" data-act="resume">Resume <span class="hint">ESC</span></button>
          <button class="menu-btn" data-act="restart">Restart <span class="hint" data-restart-hint>FROM THE GRID</span></button>
          <button class="menu-btn" data-act="controls">Controls</button>
          <button class="menu-btn" data-act="settings">Settings</button>
          <button class="menu-btn" data-act="menu">Main Menu</button>
        </div>
      </div>`;
    root.appendChild(o);
    o.querySelectorAll('.menu-btn').forEach((b) => button(b, audio, () => handlers[b.dataset.act] && handlers[b.dataset.act]()));
    this.sub = o.querySelector('[data-sub]');
    this.restartHint = o.querySelector('[data-restart-hint]');
    this.visible = false;
  }

  show(mode) {
    this.sub.textContent = mode === 'race' ? 'GRAND PRIX' : 'TIME TRIAL';
    this.restartHint.textContent = mode === 'race' ? 'FROM THE GRID' : 'NEW SESSION';
    setVisible(this.node, true);
    this.visible = true;
    setTimeout(() => this.node.querySelector('.menu-btn.primary')?.focus({ preventScroll: true }), 30);
  }

  hide() {
    setVisible(this.node, false);
    this.visible = false;
  }
}
