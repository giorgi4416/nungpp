/**
 * Keyboard + gamepad input with remappable key bindings.
 *
 * - Held actions (throttle, brake, steer) are read every frame.
 * - One-shot actions (camera, reset, pause, mute, shift up/down) are emitted as events.
 * - Racing keys never scroll the page; all state clears on blur so the car never
 *   keeps accelerating or steering after focus is lost.
 * - Gamepad (standard mapping): left stick steer, RT throttle, LT brake,
 *   RB/LB or A/X shift up/down, Y camera, B reset, Start pause,
 *   right stick looks around, R3 resets the camera view.
 */

export const ACTIONS = [
  ['accelerate', 'Accelerate'],
  ['brake', 'Brake / reverse'],
  ['left', 'Steer left'],
  ['right', 'Steer right'],
  ['strongBrake', 'Strong brake'],
  ['shiftUp', 'Shift up (manual)'],
  ['shiftDown', 'Shift down (manual)'],
  ['camera', 'Change camera'],
  ['cameraReset', 'Reset camera view'],
  ['lookLeft', 'Look left (hold)'],
  ['lookRight', 'Look right (hold)'],
  ['reset', 'Reset car'],
  ['pause', 'Pause'],
  ['mute', 'Mute sound'],
];

export const DEFAULT_BINDINGS = Object.freeze({
  accelerate: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  strongBrake: ['Space'],
  shiftUp: ['KeyE', 'ShiftRight'],
  shiftDown: ['KeyQ', 'ControlRight'],
  camera: ['KeyC'],
  cameraReset: ['KeyV'],
  lookLeft: ['KeyZ'],
  lookRight: ['KeyX'],
  reset: ['KeyR'],
  pause: ['Escape', 'KeyP'],
  mute: ['KeyM'],
});

const ONE_SHOT = ['camera', 'cameraReset', 'reset', 'pause', 'mute', 'shiftUp', 'shiftDown'];

export function keyLabel(code) {
  if (!code) return '—';
  const map = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'SPACE', Escape: 'ESC', ShiftRight: 'R-SHIFT', ShiftLeft: 'L-SHIFT', ControlRight: 'R-CTRL', ControlLeft: 'L-CTRL', Enter: 'ENTER', Tab: 'TAB', Backspace: 'BKSP' };
  if (map[code]) return map[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'NUM ' + code.slice(6);
  return code.toUpperCase();
}

export class InputManager {
  constructor(bindings = DEFAULT_BINDINGS) {
    this.down = new Set();
    this.listeners = new Map();
    this.setBindings(bindings);
    this.capture = null; // fn(code) while remapping a key
    this.pad = { steer: 0, throttle: 0, brake: 0, lookX: 0, lookY: 0, connected: false, prevButtons: [] };
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onBlur = this.clear.bind(this);
    window.addEventListener('keydown', this._onKeyDown, { passive: false });
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('visibilitychange', this._onBlur);
  }

  setBindings(b) {
    this.bindings = {};
    for (const [action] of ACTIONS) this.bindings[action] = (b && Array.isArray(b[action]) ? b[action] : DEFAULT_BINDINGS[action]).slice(0, 2);
    this.codeToActions = new Map();
    for (const [action, codes] of Object.entries(this.bindings)) for (const c of codes) {
      if (!c) continue;
      if (!this.codeToActions.has(c)) this.codeToActions.set(c, []);
      this.codeToActions.get(c).push(action);
    }
  }

  _onKeyDown(e) {
    if (this.capture) {
      e.preventDefault();
      const fn = this.capture;
      this.capture = null;
      fn(e.code);
      return;
    }
    const tag = e.target && e.target.tagName;
    const acts = this.codeToActions.get(e.code);
    if (acts && tag !== 'INPUT') e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    if (acts) for (const a of acts) if (ONE_SHOT.includes(a)) this.emit(a, e);
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

  _held(action) {
    for (const c of this.bindings[action]) if (c && this.down.has(c)) return true;
    return false;
  }

  /** Poll the first connected gamepad (call once per frame). */
  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected) { gp = p; break; }
    const P = this.pad;
    P.connected = !!gp;
    if (!gp) { P.steer = P.throttle = P.brake = P.lookX = P.lookY = 0; return; }
    const dz = (v, d = 0.12) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));
    P.steer = -dz(gp.axes[0] || 0);
    const bv = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
    P.lookX = dz(gp.axes[2] || 0, 0.18);
    P.lookY = dz(gp.axes[3] || 0, 0.18);
    P.throttle = bv(7);
    P.brake = bv(6);
    const pressed = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const edge = (i) => pressed(i) && !P.prevButtons[i];
    if (edge(5) || edge(0)) this.emit('shiftUp');
    if (edge(4) || edge(2)) this.emit('shiftDown');
    if (edge(3)) this.emit('camera');
    if (edge(1)) this.emit('reset');
    if (edge(9)) this.emit('pause');
    if (edge(11)) this.emit('cameraReset');
    P.prevButtons = gp.buttons.map((b) => b.pressed);
  }

  get throttle() {
    return Math.max(this._held('accelerate') ? 1 : 0, this.pad.throttle);
  }

  get brake() {
    if (this._held('strongBrake')) return 1;
    return Math.max(this._held('brake') ? 0.85 : 0, this.pad.brake);
  }

  /** -1 look left, +1 look right, 0 none (cockpit hold-to-look keys). */
  get lookHold() {
    return (this._held('lookRight') ? 1 : 0) - (this._held('lookLeft') ? 1 : 0);
  }

  get strongBrake() {
    return this._held('strongBrake');
  }

  /** +1 = left, -1 = right */
  get steer() {
    let s = 0;
    if (this._held('left')) s += 1;
    if (this._held('right')) s -= 1;
    if (s === 0 && this.pad.steer) return this.pad.steer;
    return s;
  }

  /** True while the steering input is analog (gamepad) - skip keyboard smoothing. */
  get analogSteer() {
    return this.pad.connected && Math.abs(this.pad.steer) > 0 && !this._held('left') && !this._held('right');
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('visibilitychange', this._onBlur);
    this.listeners.clear();
  }
}
