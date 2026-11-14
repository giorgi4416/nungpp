import { el, button, setVisible } from './dom.js';
import { Storage } from '../systems/LocalStorage.js';

/** Settings overlay. Changes apply immediately and persist to localStorage. */
export class SettingsMenu {
  constructor(root, audio, settings, onChange) {
    this.audio = audio;
    this.settings = settings;
    this.onChange = onChange;
    const o = (this.node = el('section', 'screen overlay top'));
    o.innerHTML = `
      <div class="panel" role="dialog" aria-label="Settings">
        <h2><small>OPTIONS</small>Settings</h2>
        <div class="settings-grid">
          <label>Graphics quality<small>Shadows, resolution, scenery density</small></label>
          <div class="seg" data-key="quality"><button data-v="low">LOW</button><button data-v="medium">MEDIUM</button><button data-v="high">HIGH</button></div>
          <label>Master volume</label>
          <div class="range"><input type="range" min="0" max="100" step="1" data-key="volume" aria-label="Volume"><output></output></div>
          <label>Sound<small>Mute all audio (shortcut: M)</small></label>
          <button class="toggle" data-key="muted-inv" aria-label="Sound on/off"></button>
          <label>Menu music</label>
          <button class="toggle" data-key="music" aria-label="Music on/off"></button>
          <label>Default camera<small>Press C while driving to cycle</small></label>
          <div class="seg" data-key="camera"><button data-v="chase">CHASE</button><button data-v="far">FAR</button><button data-v="cockpit">COCKPIT</button></div>
          <label>Camera shake<small>Impacts & high-speed vibration</small></label>
          <button class="toggle" data-key="cameraShake" aria-label="Camera shake"></button>
          <label>Rival pace</label>
          <div class="seg" data-key="difficulty"><button data-v="easy">EASY</button><button data-v="medium">MEDIUM</button><button data-v="hard">HARD</button></div>
          <label>Race distance</label>
          <div class="seg" data-key="laps"><button data-v="3">3 LAPS</button><button data-v="5">5 LAPS</button></div>
        </div>
        <div class="actions"><button class="btn primary" data-act="close">Done</button></div>
      </div>`;
    root.appendChild(o);
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
    const range = o.querySelector('input[type=range]');
    range.addEventListener('input', () => this._set('volume', Number(range.value)));
    button(o.querySelector('[data-act=close]'), audio, () => this.hide());
    o.addEventListener('click', (e) => { if (e.target === o) this.hide(); });
    this.refresh();
  }

  _set(key, value) {
    this.settings[key] = value;
    Storage.saveSettings(this.settings);
    this.refresh();
    this.onChange && this.onChange(key, value);
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
    const range = o.querySelector('input[type=range]');
    range.value = s.volume;
    o.querySelector('output').textContent = s.volume;
  }

  show(onClose) {
    this._onClose = onClose;
    this.refresh();
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
