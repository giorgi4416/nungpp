/**
 * Keyboard input. Tracks held keys, emits one-shot actions, prevents page
 * scrolling for racing keys and clears all state on blur so the car never
 * keeps accelerating/steering after focus is lost.
 */

const RACING_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyC', 'KeyR', 'KeyM',
]);

export class InputManager {
  constructor() {
    this.down = new Set();
    this.listeners = new Map(); // action -> Set<fn>
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onBlur = this.clear.bind(this);
    window.addEventListener('keydown', this._onKeyDown, { passive: false });
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('visibilitychange', this._onBlur);
  }

  _onKeyDown(e) {
    const tag = e.target && e.target.tagName;
    if (RACING_KEYS.has(e.code) && tag !== 'INPUT') e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    const map = {
      KeyC: 'camera',
      KeyR: 'reset',
      Escape: 'pause',
      KeyP: 'pause',
      KeyM: 'mute',
    };
    const action = map[e.code];
    if (action) this.emit(action, e);
  }

  _onKeyUp(e) {
    this.down.delete(e.code);
  }

  clear() {
    this.down.clear();
  }

  on(action, fn) {
    if (!this.listeners.has(action)) this.listeners.set(action, new Set());
    this.listeners.get(action).add(fn);
    return () => this.listeners.get(action).delete(fn);
  }

  emit(action, payload) {
    const set = this.listeners.get(action);
    if (set) for (const fn of set) fn(payload);
  }

  get throttle() {
    return this.down.has('KeyW') || this.down.has('ArrowUp') ? 1 : 0;
  }

  get brake() {
    if (this.down.has('Space')) return 1;
    return this.down.has('KeyS') || this.down.has('ArrowDown') ? 0.85 : 0;
  }

  get strongBrake() {
    return this.down.has('Space');
  }

  /** +1 = left, -1 = right */
  get steer() {
    let s = 0;
    if (this.down.has('KeyA') || this.down.has('ArrowLeft')) s += 1;
    if (this.down.has('KeyD') || this.down.has('ArrowRight')) s -= 1;
    return s;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('visibilitychange', this._onBlur);
    this.listeners.clear();
  }
}
