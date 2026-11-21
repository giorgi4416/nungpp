/**
 * Synthesised Formula engine (turbo V6-like scream), tyre squeal, wind noise
 * and a shared voice for nearby AI cars. Driven every frame from vehicle state.
 */
export class CarAudio {
  constructor(audio) {
    this.audio = audio;
    this.ready = false;
    this.active = false;
    if (audio.enabled) this._build();
    else audio.onReady = () => this._build();
  }

  _build() {
    const a = this.audio;
    const c = a.ctx;
    if (!c || this.ready) return;
    // ---- player engine ----
    this.engineGain = c.createGain();
    this.engineGain.gain.value = 0;
    const shaper = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 2.4);
    }
    shaper.curve = curve;
    this.engineFilter = c.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 2.5;
    this.engineFilter.frequency.value = 800;
    const pre = c.createGain();
    pre.gain.value = 0.55;
    this.oscs = [];
    const defs = [
      { type: 'sawtooth', mul: 1, gain: 0.5 },
      { type: 'square', mul: 2, gain: 0.18 },
      { type: 'sawtooth', mul: 0.5, gain: 0.4 },
      { type: 'triangle', mul: 3.01, gain: 0.12 },
      { type: 'sawtooth', mul: 1.5, gain: 0.14 }, // V6 half-order harmonic gives the rasp
      { type: 'sine', mul: 0.25, gain: 0.22 }, // low body
    ];
    for (const d of defs) {
      const o = c.createOscillator();
      o.type = d.type;
      o.frequency.value = 200 * d.mul;
      const g = c.createGain();
      g.gain.value = d.gain;
      o.connect(g).connect(pre);
      o.start();
      this.oscs.push({ o, mul: d.mul });
    }
    // rough "grain": noise amplitude-modulates the engine slightly
    const lfo = c.createOscillator();
    lfo.frequency.value = 23;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 6;
    lfo.connect(lfoGain);
    for (const { o } of this.oscs) lfoGain.connect(o.detune);
    lfo.start();
    pre.connect(shaper).connect(this.engineFilter).connect(this.engineGain).connect(a.engineBus);

    // ---- turbo whistle ----
    this.turbo = c.createOscillator();
    this.turbo.type = 'sine';
    this.turboGain = c.createGain();
    this.turboGain.gain.value = 0;
    this.turbo.connect(this.turboGain).connect(a.engineBus);
    this.turbo.start();

    // ---- tyre squeal ----
    const sq = c.createBufferSource();
    sq.buffer = a.noiseBuffer;
    sq.loop = true;
    const sqF = c.createBiquadFilter();
    sqF.type = 'bandpass';
    sqF.frequency.value = 1500;
    sqF.Q.value = 9;
    const sqF2 = c.createBiquadFilter();
    sqF2.type = 'peaking';
    sqF2.frequency.value = 2400;
    sqF2.gain.value = 8;
    this.squealGain = c.createGain();
    this.squealGain.gain.value = 0;
    sq.connect(sqF).connect(sqF2).connect(this.squealGain).connect(a.sfx);
    sq.start();
    this.squealFilter = sqF;

    // ---- wind / road rumble ----
    const wn = c.createBufferSource();
    wn.buffer = a.noiseBuffer;
    wn.loop = true;
    const wF = c.createBiquadFilter();
    wF.type = 'lowpass';
    wF.frequency.value = 500;
    this.windGain = c.createGain();
    this.windGain.gain.value = 0;
    wn.connect(wF).connect(this.windGain).connect(a.sfx);
    wn.start();
    this.windFilter = wF;

    // ---- gravel / grass rumble ----
    const rb = c.createBufferSource();
    rb.buffer = a.noiseBuffer;
    rb.loop = true;
    const rF = c.createBiquadFilter();
    rF.type = 'lowpass';
    rF.frequency.value = 180;
    this.rumbleGain = c.createGain();
    this.rumbleGain.gain.value = 0;
    rb.connect(rF).connect(this.rumbleGain).connect(a.sfx);
    rb.start();

    // ---- AI engine voice ----
    this.aiGain = c.createGain();
    this.aiGain.gain.value = 0;
    this.aiFilter = c.createBiquadFilter();
    this.aiFilter.type = 'lowpass';
    this.aiFilter.frequency.value = 1200;
    this.aiOsc = c.createOscillator();
    this.aiOsc.type = 'sawtooth';
    this.aiOsc2 = c.createOscillator();
    this.aiOsc2.type = 'square';
    const g2 = c.createGain();
    g2.gain.value = 0.3;
    this.aiOsc.connect(this.aiFilter);
    this.aiOsc2.connect(g2).connect(this.aiFilter);
    this.aiFilter.connect(this.aiGain).connect(a.engineBus);
    this.aiOsc.start();
    this.aiOsc2.start();
    this.prevThrottle = 0;
    this.popCooldown = 0;
    this.ready = true;
  }

  setActive(on) {
    this.active = on;
    if (!on) this.silence();
  }

  silence() {
    if (!this.ready) return;
    const t = this.audio.ctx.currentTime;
    for (const g of [this.engineGain, this.squealGain, this.windGain, this.aiGain, this.turboGain, this.rumbleGain]) {
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(0, t, 0.08);
    }
  }

  /**
   * @param {object} s - {rpm, throttle, speed (m/s), slip (0..1), offTrack, ai: {distance, rpm, closingSpeed}}
   */
  update(s) {
    if (!this.ready || !this.active) return;
    const c = this.audio.ctx;
    const t = c.currentTime;
    const k = 0.03;
    const rpm = s.rpm;
    const maxRpm = s.maxRpm || 12500;
    const rn = rpm / maxRpm;
    // firing frequency: cylinders/2 pulses per revolution (V6 hybrid, V8, V10, V12 sound different)
    const f = (rpm / 60) * ((s.cylinders || 6) / 2) * 0.5;
    for (const { o, mul } of this.oscs) o.frequency.setTargetAtTime(f * mul, t, k);
    const thr = s.throttle;
    // rev limiter stutter (manual gearbox): chop the engine note rapidly
    const lim = s.limiter ? 0.55 + 0.45 * Math.sign(Math.sin(t * 70)) : 1;
    // lift-off crackles: a few pops from the exhaust when the throttle closes at high revs
    this.popCooldown -= 1 / 60;
    if (this.prevThrottle > 0.6 && thr < 0.2 && rpm > 8500 && this.popCooldown <= 0) {
      this.popCooldown = 0.6;
      for (let k = 0; k < 3; k++) this.audio.noiseBurst(0.035, { gain: 0.16, freq: 600 + Math.random() * 500, q: 1.2, when: k * (0.06 + Math.random() * 0.07) });
    }
    this.prevThrottle = thr;
    const cutoff = 500 + rn * 3200 * (0.45 + thr * 0.55);
    this.engineFilter.frequency.setTargetAtTime(cutoff, t, 0.05);
    this.engineGain.gain.setTargetAtTime((0.13 + thr * 0.17 + rn * 0.08) * lim, t, 0.02);
    this.turbo.frequency.setTargetAtTime(2400 + rn * 4200, t, 0.1);
    this.turboGain.gain.setTargetAtTime(thr * rn * 0.012, t, 0.15);

    const spd = Math.abs(s.speed);
    this.squealGain.gain.setTargetAtTime(Math.min(0.22, s.slip * 0.24) * Math.min(1, spd / 8), t, 0.05);
    this.squealFilter.frequency.setTargetAtTime(1300 + s.slip * 500, t, 0.1);
    this.windGain.gain.setTargetAtTime(Math.min(0.16, (spd / 90) ** 2 * 0.16), t, 0.1);
    this.windFilter.frequency.setTargetAtTime(300 + spd * 14, t, 0.1);
    const kerb = (s.kerb || 0) * Math.min(1, spd / 20) * 0.45;
    this.rumbleGain.gain.setTargetAtTime(Math.max(s.offTrack > 0 ? Math.min(0.5, spd / 30) * s.offTrack : 0, kerb), t, 0.03);

    if (s.ai) {
      const d = s.ai.distance;
      const vol = d < 160 ? Math.min(0.12, 9 / (d + 12)) : 0;
      // doppler-ish pitch shift from closing speed
      const dop = 1 + Math.max(-0.25, Math.min(0.25, s.ai.closingSpeed / 340));
      const af = (s.ai.rpm / 60) * ((s.cylinders || 6) / 2) * 0.5 * dop;
      this.aiOsc.frequency.setTargetAtTime(af, t, 0.05);
      this.aiOsc2.frequency.setTargetAtTime(af * 2, t, 0.05);
      this.aiGain.gain.setTargetAtTime(vol, t, 0.08);
      this.aiFilter.frequency.setTargetAtTime(600 + 2000 * Math.min(1, 30 / (d + 1)), t, 0.1);
    } else {
      this.aiGain.gain.setTargetAtTime(0, t, 0.1);
    }
  }
}
