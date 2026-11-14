/** Game states and a guarded state machine with change listeners. */
export const STATE = Object.freeze({
  LOADING: 'loading',
  MENU: 'menu',
  COUNTDOWN: 'countdown',
  RACING: 'racing',
  PAUSED: 'paused',
  FINISHED: 'finished',
});

const ALLOWED = {
  loading: ['menu'],
  menu: ['countdown'],
  countdown: ['racing', 'paused', 'menu', 'countdown'],
  racing: ['paused', 'finished', 'menu', 'countdown'],
  paused: ['countdown', 'racing', 'finished', 'menu'],
  finished: ['menu', 'countdown', 'paused'],
};

export class GameState {
  constructor() {
    this.current = STATE.LOADING;
    this.previous = null;
    this.mode = 'race'; // 'race' | 'trial'
    this.listeners = new Set();
  }

  is(...states) {
    return states.includes(this.current);
  }

  set(next) {
    if (next === this.current) return true;
    if (!ALLOWED[this.current].includes(next)) {
      console.warn(`Ignored state change ${this.current} -> ${next}`);
      return false;
    }
    this.previous = this.current;
    this.current = next;
    for (const fn of this.listeners) fn(next, this.previous);
    return true;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
