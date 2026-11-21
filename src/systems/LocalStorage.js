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
  transmission: 'auto', // auto | manual
  steering: 1.0, // steering sensitivity 0.6..1.4
  cockpitFov: 74, // degrees, 60..95
  cameraSmoothing: 1.0, // chase camera stiffness multiplier 0.5..1.5
  team: 'ferrari',
  car: '', // catalog id, e.g. '2020-ferrari', '2000s-v10-ferrari', '1990s-mid-williams'
  cameraSensitivity: 1.0, // mouse / stick look-around speed 0.3..2
  track: 'hungaroring',
  bindings: null, // null = defaults
});

const TEAM_IDS = ['ferrari', 'mercedes', 'mclaren', 'redbull', 'aston', 'williams', 'alpine', 'haas', 'danubio'];
const TRACK_IDS = ['hungaroring', 'monaco', 'spa', 'suzuka'];

function sanitizeBindings(b) {
  if (!b || typeof b !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(b)) {
    if (!/^[a-zA-Z]+$/.test(k) || !Array.isArray(v)) continue;
    out[k] = v.filter((c) => typeof c === 'string' && c.length < 32).slice(0, 2);
  }
  return out;
}

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
      camera: oneOf(s.camera, ['chase', 'far', 'cockpit', 'tcam'], d.camera),
      cameraShake: bool(s.cameraShake, d.cameraShake),
      difficulty: oneOf(s.difficulty, ['easy', 'medium', 'hard'], d.difficulty),
      laps: oneOf(s.laps, [3, 5], d.laps),
      transmission: oneOf(s.transmission, ['auto', 'manual'], d.transmission),
      steering: num(s.steering, 0.6, 1.4, d.steering),
      cockpitFov: num(s.cockpitFov, 60, 95, d.cockpitFov),
      cameraSmoothing: num(s.cameraSmoothing, 0.5, 1.5, d.cameraSmoothing),
      team: oneOf(s.team, TEAM_IDS, d.team),
      car: typeof s.car === 'string' && /^[a-z0-9-]{3,40}$/.test(s.car) ? s.car : '',
      cameraSensitivity: num(s.cameraSensitivity, 0.3, 2, d.cameraSensitivity),
      track: oneOf(s.track, TRACK_IDS, d.track),
      bindings: sanitizeBindings(s.bindings),
    };
  },

  saveSettings(settings) {
    write('settings', settings);
  },

  /** Best lap (seconds) for a circuit and mode ('race' | 'trial'). */
  loadBestLap(mode = 'trial', track = 'hungaroring') {
    let v = read(`bestLap.${track}.${mode}`);
    if (v == null && track === 'hungaroring') v = read('bestLap.' + mode); // records from v1.0
    return typeof v === 'number' && Number.isFinite(v) && v > 20 && v < 3600 ? v : null;
  },

  saveBestLap(mode, seconds, track = 'hungaroring') {
    write(`bestLap.${track}.${mode}`, seconds);
  },

  /** Best lap on a circuit across modes. */
  loadAllTimeBest(track = 'hungaroring') {
    const a = this.loadBestLap('trial', track), b = this.loadBestLap('race', track);
    if (a == null) return b;
    if (b == null) return a;
    return Math.min(a, b);
  },

  loadLastResult() {
    const r = read('lastResult');
    if (r && typeof r.track !== 'string') r.track = 'hungaroring';
    if (!r || typeof r !== 'object') return null;
    if (typeof r.position !== 'number' || typeof r.total !== 'number' || typeof r.time !== 'number') return null;
    return {
      position: r.position,
      total: r.total,
      time: r.time,
      laps: typeof r.laps === 'number' ? r.laps : 3,
      bestLap: typeof r.bestLap === 'number' ? r.bestLap : null,
      date: typeof r.date === 'string' ? r.date : '',
      track: TRACK_IDS.includes(r.track) ? r.track : 'hungaroring',
    };
  },

  saveLastResult(result) {
    write('lastResult', result);
  },
};
