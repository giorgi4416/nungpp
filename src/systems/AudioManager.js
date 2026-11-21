/**
 * Web Audio manager. Everything is synthesised (no audio files), so nothing
 * can fail to load. The AudioContext is only created after the first user
 * gesture to respect browser autoplay rules. All methods are safe no-ops
 * when audio is unavailable.
 */
export class AudioManager {
  constructor(settings) {
    this.ctx = null;
    this.enabled = false;
    this.volume = settings.volume / 100;
    this.muted = settings.muted;
    this.musicOn = settings.music;
    this._musicWanted = false;
    this._musicTimer = null;
    this._unlock = this._unlock.bind(this);
    window.addEventListener('pointerdown', this._unlock);
    window.addEventListener('keydown', this._unlock);
  }

  _unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const c = this.ctx;
      this.master = c.createGain();
      this.master.connect(c.destination);
      // gentle limiter so engine + effects never clip
      this.comp = c.createDynamicsCompressor();
      this.comp.threshold.value = -10;
      this.comp.ratio.value = 6;
      this.comp.connect(this.master);
      this.sfx = c.createGain();
      this.sfx.connect(this.comp);
      this.engineBus = c.createGain();
      this.engineBus.connect(this.comp);
      this.musicBus = c.createGain();
      this.musicBus.gain.value = 0.32;
      this.musicBus.connect(this.master);
      this.noiseBuffer = this._makeNoise(2);
      this.enabled = true;
      this._applyVolume();
      if (this._musicWanted) this._startMusic();
      this.onReady && this.onReady();
    } catch (e) {
      console.warn('Audio unavailable:', e);
      this.enabled = false;
    }
    window.removeEventListener('pointerdown', this._unlock);
    window.removeEventListener('keydown', this._unlock);
  }

  _makeNoise(seconds) {
    const c = this.ctx;
    const buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _applyVolume() {
    if (!this.ctx) return;
    const v = this.muted ? 0 : this.volume;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setVolume(v01) {
    this.volume = v01;
    this._applyVolume();
  }

  setMuted(m) {
    this.muted = m;
    this._applyVolume();
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  /** Short synthesized tone. */
  tone(freq, dur = 0.15, { type = 'sine', gain = 0.3, attack = 0.005, when = 0, slideTo = null } = {}) {
    if (!this.enabled) return;
    const c = this.ctx;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noiseBurst(dur = 0.1, { gain = 0.3, freq = 1200, q = 1, type = 'bandpass', when = 0 } = {}) {
    if (!this.enabled) return;
    const c = this.ctx;
    const t = c.currentTime + when;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  uiHover() { this.tone(1800, 0.04, { type: 'triangle', gain: 0.05 }); }
  uiClick() {
    this.tone(1100, 0.06, { type: 'square', gain: 0.07 });
    this.tone(1650, 0.08, { type: 'triangle', gain: 0.06, when: 0.03 });
  }
  countdownBeep() { this.tone(880, 0.22, { type: 'square', gain: 0.12 }); }
  goSound() {
    this.tone(1320, 0.6, { type: 'square', gain: 0.14 });
    this.tone(660, 0.6, { type: 'sawtooth', gain: 0.06 });
  }
  gearShift(up) {
    this.noiseBurst(0.05, { gain: 0.18, freq: up ? 2400 : 900, q: 2 });
    this.tone(up ? 140 : 90, 0.06, { type: 'square', gain: 0.06 });
  }
  impact(strength = 1) {
    const g = Math.min(0.9, 0.25 + strength * 0.4);
    this.noiseBurst(0.35, { gain: g, freq: 260, q: 0.8, type: 'lowpass' });
    this.noiseBurst(0.12, { gain: g * 0.6, freq: 2600, q: 1.5 });
    this.tone(70, 0.3, { type: 'sine', gain: g * 0.8, slideTo: 40 });
  }
  /** Crash: heavy thump + carbon crack + scraping debris, scaled by damage level (1..4). */
  crash(strength = 1, level = 1) {
    this.impact(Math.min(1, strength));
    const n = 1 + level * 2;
    for (let i = 0; i < n; i++) this.noiseBurst(0.04 + Math.random() * 0.05, { gain: 0.12 + level * 0.05, freq: 1800 + Math.random() * 2600, q: 3, when: 0.03 + i * (0.03 + Math.random() * 0.05) });
    if (level >= 3) this.noiseBurst(0.6, { gain: 0.22, freq: 900, q: 0.6, when: 0.08 });
  }
  lapChime(best = false) {
    const notes = best ? [880, 1108.7, 1318.5] : [880, 1108.7];
    notes.forEach((f, i) => this.tone(f, 0.25, { type: 'triangle', gain: 0.1, when: i * 0.09 }));
  }
  warning() {
    this.tone(520, 0.12, { type: 'square', gain: 0.07 });
    this.tone(520, 0.12, { type: 'square', gain: 0.07, when: 0.16 });
  }

  // ------------------------------------------------------------- music
  setMusicEnabled(on) {
    this.musicOn = on;
    if (!on) this._stopMusic();
    else if (this._musicWanted) this._startMusic();
  }

  playMusic(want) {
    this._musicWanted = want;
    if (want && this.musicOn) this._startMusic();
    else this._stopMusic();
  }

  _startMusic() {
    if (!this.enabled || this._musicTimer) return;
    const c = this.ctx;
    // a moody, driving synth loop: Am - F - C - G with pulsing bass and arpeggio
    const chords = [
      [57, 60, 64], [53, 57, 60], [48, 55, 60], [55, 59, 62],
    ];
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const bpm = 112;
    const beat = 60 / bpm;
    let nextTime = c.currentTime + 0.1;
    let step = 0;
    const musicGain = c.createGain();
    musicGain.gain.value = 0;
    musicGain.gain.linearRampToValueAtTime(1, c.currentTime + 2.5);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    musicGain.connect(lp).connect(this.musicBus);
    this._musicNode = musicGain;
    const play = (freq, t, dur, type, gain) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(musicGain);
      o.start(t);
      o.stop(t + dur + 0.05);
    };
    const schedule = () => {
      while (nextTime < c.currentTime + 0.4) {
        const bar = Math.floor(step / 16) % 4;
        const ch = chords[bar];
        const s16 = step % 16;
        // bass: eighth notes
        if (s16 % 2 === 0) play(mtof(ch[0] - 24), nextTime, beat * 0.45, 'sawtooth', 0.09);
        // arpeggio: sixteenth notes
        const n = ch[[0, 1, 2, 1][s16 % 4]] + (s16 >= 8 ? 12 : 0);
        play(mtof(n), nextTime, beat * 0.22, 'square', 0.025);
        // pad on bar start
        if (s16 === 0) ch.forEach((m) => { play(mtof(m), nextTime, beat * 4, 'triangle', 0.03); play(mtof(m) * 1.004, nextTime, beat * 4, 'sawtooth', 0.012); });
        // soft hat
        if (s16 % 4 === 2) {
          const src = c.createBufferSource();
          src.buffer = this.noiseBuffer;
          const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
          const g = c.createGain(); g.gain.setValueAtTime(0.05, nextTime); g.gain.exponentialRampToValueAtTime(0.0001, nextTime + 0.05);
          src.connect(f).connect(g).connect(musicGain);
          src.start(nextTime, Math.random()); src.stop(nextTime + 0.06);
        }
        // kick
        if (s16 % 4 === 0) {
          const o = c.createOscillator(); const g = c.createGain();
          o.frequency.setValueAtTime(120, nextTime); o.frequency.exponentialRampToValueAtTime(40, nextTime + 0.15);
          g.gain.setValueAtTime(0.18, nextTime); g.gain.exponentialRampToValueAtTime(0.0001, nextTime + 0.2);
          o.connect(g).connect(musicGain); o.start(nextTime); o.stop(nextTime + 0.25);
        }
        nextTime += beat / 4;
        step++;
      }
    };
    schedule();
    this._musicTimer = setInterval(schedule, 100);
  }

  _stopMusic() {
    if (this._musicTimer) {
      clearInterval(this._musicTimer);
      this._musicTimer = null;
    }
    if (this._musicNode && this.ctx) {
      const g = this._musicNode;
      g.gain.cancelScheduledValues(this.ctx.currentTime);
      g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
      setTimeout(() => g.disconnect(), 1500);
      this._musicNode = null;
    }
  }
}
