import { el, button, setVisible } from './dom.js';
import { Storage } from '../systems/LocalStorage.js';
import { ACTIONS, DEFAULT_BINDINGS, keyLabel } from '../systems/InputManager.js';

/**
 * Settings overlay, organised in tabs. Every change applies immediately and
 * persists to localStorage. The Controls tab remaps keys (click, then press).
 */
export class SettingsMenu {
  constructor(root, audio, settings, input, onChange) {
    this.audio = audio;
    this.settings = settings;
    this.input = input;
    this.onChange = onChange;
    const o = (this.node = el('section', 'screen overlay top'));
    o.innerHTML = `
      <div class="panel settings-panel" role="dialog" aria-label="Settings">
        <h2><small>OPTIONS</small>Settings</h2>
        <div class="tabs" data-tabs>
          <button data-tab="gameplay" class="active">GAMEPLAY</button><button data-tab="driving">DRIVING</button>
          <button data-tab="audio">AUDIO</button><button data-tab="graphics">GRAPHICS</button><button data-tab="controls">CONTROLS</button>
        </div>
        <div class="settings-grid" data-pane="gameplay">
          <label>Transmission<small>Manual: shift with E / Q (or gamepad bumpers)</small></label>
          <div class="seg" data-key="transmission"><button data-v="auto">AUTOMATIC</button><button data-v="manual">MANUAL</button></div>
          <label>Rival pace</label>
          <div class="seg" data-key="difficulty"><button data-v="easy">EASY</button><button data-v="medium">MEDIUM</button><button data-v="hard">HARD</button></div>
          <label>Race distance</label>
          <div class="seg" data-key="laps"><button data-v="3">3 LAPS</button><button data-v="5">5 LAPS</button></div>
        </div>
        <div class="settings-grid" data-pane="driving" hidden>
          <label>Steering sensitivity<small>How quickly and how far the wheels turn</small></label>
          <div class="range"><input type="range" min="0.6" max="1.4" step="0.05" data-range="steering"><output></output></div>
          <label>Default camera<small>Press C while driving to cycle</small></label>
          <div class="seg" data-key="camera"><button data-v="chase">CHASE</button><button data-v="far">FAR</button><button data-v="cockpit">COCKPIT</button></div>
          <label>Cockpit field of view</label>
          <div class="range"><input type="range" min="60" max="95" step="1" data-range="cockpitFov"><output></output></div>
          <label>Chase camera response<small>Lower = smoother, higher = tighter</small></label>
          <div class="range"><input type="range" min="0.5" max="1.5" step="0.05" data-range="cameraSmoothing"><output></output></div>
          <label>Look-around sensitivity<small>Mouse drag & right stick (V / double-click resets the view)</small></label>
          <div class="range"><input type="range" min="0.3" max="2" step="0.05" data-range="cameraSensitivity"><output></output></div>
          <label>Camera shake<small>Impacts, kerbs & high-speed vibration</small></label>
          <button class="toggle" data-key="cameraShake" aria-label="Camera shake"></button>
        </div>
        <div class="settings-grid" data-pane="audio" hidden>
          <label>Master volume</label>
          <div class="range"><input type="range" min="0" max="100" step="1" data-range="volume"><output></output></div>
          <label>Sound<small>Mute all audio (shortcut: M)</small></label>
          <button class="toggle" data-key="muted-inv" aria-label="Sound on/off"></button>
          <label>Menu music</label>
          <button class="toggle" data-key="music" aria-label="Music on/off"></button>
        </div>
        <div class="settings-grid" data-pane="graphics" hidden>
          <label>Graphics quality<small>Shadows, resolution, scenery density, mirrors (Medium+)</small></label>
          <div class="seg" data-key="quality"><button data-v="low">LOW</button><button data-v="medium">MEDIUM</button><button data-v="high">HIGH</button></div>
          <label class="span2"><small>Recommended: Medium on laptop GPUs (e.g. RTX 2050), High on desktop GPUs.</small></label>
        </div>
        <div data-pane="controls" hidden>
          <div class="bind-list" data-binds></div>
          <p class="controls-tip">Click a key box, then press the new key (Esc cancels). Gamepads work automatically: left stick steer, RT/LT throttle/brake, RB/LB shift, Y camera, B reset, Start pause.</p>
          <div class="actions" style="justify-content:flex-start;margin-top:10px"><button class="btn" data-act="reset-binds">Reset to defaults</button></div>
        </div>
        <div class="actions"><button class="btn primary" data-act="close">Done</button></div>
      </div>`;
    root.appendChild(o);
    o.querySelectorAll('[data-tab]').forEach((t) => button(t, audio, () => this._tab(t.dataset.tab)));
    o.querySelectorAll('.seg').forEach((seg) => {
      seg.querySelectorAll('button').forEach((b) => button(b, audio, () => {
        const key = seg.dataset.key;
        this._set(key, key === 'laps' ? Number(b.dataset.v) : b.dataset.v);
      }));
    });
    o.querySelectorAll('.toggle').forEach((t) => button(t, audio, () => {
      const key = t.dataset.key;
      if (key === 'muted-inv') this._set('muted', !this.settings.muted);
      else this._set(key, !this.settings[key]);
    }));
    o.querySelectorAll('input[type=range]').forEach((r) => r.addEventListener('input', () => this._set(r.dataset.range, Number(r.value))));
    button(o.querySelector('[data-act=close]'), audio, () => this.hide());
    button(o.querySelector('[data-act=reset-binds]'), audio, () => this._set('bindings', null));
    o.addEventListener('click', (e) => { if (e.target === o) this.hide(); });
    this.refresh();
  }

  _tab(name) {
    this.node.querySelectorAll('[data-tab]').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    this.node.querySelectorAll('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== name));
  }

  _set(key, value) {
    this.settings[key] = value;
    Storage.saveSettings(this.settings);
    this.refresh();
    this.onChange && this.onChange(key, key === 'bindings' ? value || DEFAULT_BINDINGS : value);
  }

  _renderBindings() {
    const b = this.settings.bindings || DEFAULT_BINDINGS;
    const list = this.node.querySelector('[data-binds]');
    list.innerHTML = ACTIONS.map(([id, label]) => `
      <div class="bind-row"><span>${label}</span>
        ${[0, 1].map((k) => `<button class="keybox" data-bind="${id}" data-slot="${k}">${keyLabel((b[id] || [])[k])}</button>`).join('')}
      </div>`).join('');
    list.querySelectorAll('[data-bind]').forEach((btn) => button(btn, this.audio, () => {
      btn.textContent = 'PRESS A KEY…';
      btn.classList.add('listening');
      this.input.capture = (code) => {
        if (code !== 'Escape') {
          const cur = JSON.parse(JSON.stringify(this.settings.bindings || DEFAULT_BINDINGS));
          // a key can only do one job: remove it from other actions first
          for (const a of Object.keys(cur)) cur[a] = (cur[a] || []).map((c) => (c === code ? null : c));
          cur[btn.dataset.bind] = cur[btn.dataset.bind] || [null, null];
          cur[btn.dataset.bind][Number(btn.dataset.slot)] = code;
          this._set('bindings', cur);
        } else this._renderBindings();
      };
    }));
  }

  refresh() {
    const s = this.settings;
    const o = this.node;
    o.querySelectorAll('.seg').forEach((seg) => {
      const cur = String(s[seg.dataset.key]);
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === cur));
    });
    o.querySelector('[data-key="muted-inv"]').classList.toggle('on', !s.muted);
    o.querySelector('[data-key="music"]').classList.toggle('on', s.music);
    o.querySelector('[data-key="cameraShake"]').classList.toggle('on', s.cameraShake);
    o.querySelectorAll('input[type=range]').forEach((r) => {
      const v = s[r.dataset.range];
      r.value = v;
      const fmt = r.dataset.range === 'cockpitFov' ? v + '°' : r.dataset.range === 'volume' ? String(v) : Math.round(v * 100) + '%';
      r.nextElementSibling.textContent = fmt;
    });
    this._renderBindings();
  }

  show(onClose) {
    this._onClose = onClose;
    this.refresh();
    setVisible(this.node, true);
    this.visible = true;
  }

  hide() {
    if (!this.visible) return;
    this.input.capture = null;
    setVisible(this.node, false);
    this.visible = false;
    const cb = this._onClose;
    this._onClose = null;
    cb && cb();
  }
}
