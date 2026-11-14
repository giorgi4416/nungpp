/**
 * Safe localStorage wrapper. Every read is validated and falls back to sane
 * defaults when storage is unavailable or the stored data is corrupted.
 */

const PREFIX = 'hgp.v1.';

export const DEFAULT_SETTINGS = Object.freeze({
  quality: 'medium', // low | medium | high
  volume: 70, // 0..100
  music: true,
  muted: false,
  camera: 'chase', // chase | far | cockpit
  cameraShake: true,
  difficulty: 'medium', // easy | medium | hard
  laps: 3, // 3 | 5
});

function read(key) {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const oneOf = (v, list, def) => (list.includes(v) ? v : def);
const num = (v, min, max, def) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def);
const bool = (v, def) => (typeof v === 'boolean' ? v : def);

export const Storage = {
  loadSettings() {
    const s = read('settings');
    const d = DEFAULT_SETTINGS;
    if (!s || typeof s !== 'object') return { ...d };
    return {
      quality: oneOf(s.quality, ['low', 'medium', 'high'], d.quality),
      volume: num(s.volume, 0, 100, d.volume),
      music: bool(s.music, d.music),
      muted: bool(s.muted, d.muted),
      camera: oneOf(s.camera, ['chase', 'far', 'cockpit'], d.camera),
      cameraShake: bool(s.cameraShake, d.cameraShake),
      difficulty: oneOf(s.difficulty, ['easy', 'medium', 'hard'], d.difficulty),
      laps: oneOf(s.laps, [3, 5], d.laps),
    };
  },

  saveSettings(settings) {
    write('settings', settings);
  },

  /** Best lap (ms) for a mode: 'race' | 'trial'. */
  loadBestLap(mode = 'trial') {
    const v = read('bestLap.' + mode);
    return typeof v === 'number' && Number.isFinite(v) && v > 20 && v < 3600 ? v : null;
  },

  saveBestLap(mode, seconds) {
    write('bestLap.' + mode, seconds);
  },

  /** Overall best lap across modes. */
  loadAllTimeBest() {
    const a = this.loadBestLap('trial'), b = this.loadBestLap('race');
    if (a == null) return b;
    if (b == null) return a;
    return Math.min(a, b);
  },

  loadLastResult() {
    const r = read('lastResult');
    if (!r || typeof r !== 'object') return null;
    if (typeof r.position !== 'number' || typeof r.total !== 'number' || typeof r.time !== 'number') return null;
    return {
      position: r.position,
      total: r.total,
      time: r.time,
      laps: typeof r.laps === 'number' ? r.laps : 3,
      bestLap: typeof r.bestLap === 'number' ? r.bestLap : null,
      date: typeof r.date === 'string' ? r.date : '',
    };
  },

  saveLastResult(result) {
    write('lastResult', result);
  },
};
