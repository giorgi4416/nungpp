import { el, button, setVisible } from './dom.js';
import { formatTime } from '../race/LapSystem.js';
import { Storage } from '../systems/LocalStorage.js';

/**
 * Cinematic main menu overlay. The 3D scene behind it (showcase car, live
 * circuit with AI cars lapping) is driven by the Game while this is shown.
 */
export class MainMenu {
  constructor(root, audio, settings, handlers) {
    this.audio = audio;
    this.settings = settings;
    this.h = handlers;
    const m = (this.node = el('section', 'screen menu'));
    m.innerHTML = `
      <div class="menu-left">
        <div class="menu-kicker">GRAND PRIX WEEKEND · MOGYORÓD, HUNGARY</div>
        <h1 class="menu-title">Hungaroring<br><span class="gp">GP</span></h1>
        <div class="menu-sub-title">RACING CHALLENGE</div>
        <p class="menu-tagline">“Master the circuit. Own the race.”</p>
        <div class="menu-buttons">
          <button class="menu-btn primary" data-act="race">Start Race <span class="hint" data-laps-hint></span></button>
          <button class="menu-btn" data-act="trial">Time Trial <span class="hint">SOLO · HOTLAP</span></button>
          <button class="menu-btn" data-act="settings">Settings <span class="hint">GRAPHICS · AUDIO</span></button>
          <button class="menu-btn" data-act="controls">Controls <span class="hint">KEYBOARD</span></button>
        </div>
        <div class="race-options">
          <div class="seg" data-seg="laps"><span class="seg-label">LAPS</span><button data-v="3">3</button><button data-v="5">5</button></div>
          <div class="seg" data-seg="difficulty"><span class="seg-label">RIVALS</span><button data-v="easy">EASY</button><button data-v="medium">MED</button><button data-v="hard">HARD</button></div>
        </div>
      </div>
      <div class="menu-right">
        <div class="info-card">
          <div class="car-tag"><div class="car-num">#7</div><div><h4 style="margin:0">YOUR CAR</h4><div style="font-weight:800;letter-spacing:.06em">DANUBIO RACING · DR-26</div></div></div>
          <div class="row" style="margin-top:10px"><span>Circuit</span><b>4.381 km · 14 turns</b></div>
          <div class="row"><span>Personal best</span><b data-best>-:--.---</b></div>
          <div class="row"><span>Last race</span><b data-last>—</b></div>
        </div>
      </div>
      <div class="menu-footer">THREE.JS · RAPIER PHYSICS · ALL ASSETS PROCEDURAL · FICTIONAL TEAMS & LIVERIES</div>
    `;
    root.appendChild(m);
    m.querySelectorAll('.menu-btn').forEach((b) => button(b, audio, () => this._act(b.dataset.act)));
    m.querySelectorAll('.seg').forEach((seg) => {
      seg.querySelectorAll('button').forEach((b) => button(b, audio, () => {
        const key = seg.dataset.seg;
        const v = key === 'laps' ? Number(b.dataset.v) : b.dataset.v;
        this.settings[key] = v;
        Storage.saveSettings(this.settings);
        this.refresh();
        this.h.onOptions && this.h.onOptions();
      }));
    });
    this.refresh();
  }

  _act(a) {
    if (a === 'race') this.h.onRace();
    else if (a === 'trial') this.h.onTrial();
    else if (a === 'settings') this.h.onSettings();
    else if (a === 'controls') this.h.onControls();
  }

  refresh() {
    const m = this.node;
    m.querySelectorAll('.seg').forEach((seg) => {
      const cur = String(this.settings[seg.dataset.seg]);
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === cur));
    });
    m.querySelector('[data-laps-hint]').textContent = `${this.settings.laps} LAPS · 4 RIVALS`;
    const best = Storage.loadAllTimeBest();
    m.querySelector('[data-best]').textContent = formatTime(best);
    const last = Storage.loadLastResult();
    m.querySelector('[data-last]').textContent = last ? `P${last.position}/${last.total} · ${formatTime(last.time)}` : '—';
  }

  show(v) {
    if (v) this.refresh();
    setVisible(this.node, v);
    if (v) setTimeout(() => this.node.querySelector('.menu-btn.primary')?.focus({ preventScroll: true }), 50);
  }
}
