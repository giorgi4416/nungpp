import { el, setVisible, escapeHtml } from './dom.js';
import { formatTime } from '../race/LapSystem.js';
import { TrackMap } from '../track/TrackMap.js';

/**
 * Broadcast-style racing HUD: position/lap, timing tower, lap & sector
 * timing, digital speedometer with rev arc and shift lights, live minimap
 * and animated notifications. DOM writes are cached to avoid layout churn.
 */
export class HUD {
  constructor(root) {
    const h = (this.node = el('section', 'screen hud'));
    h.innerHTML = `
      <div class="hud-top-left">
        <div class="hud-box pos-lap">
          <div class="pos-block"><span class="p">P</span><span class="pv" data-pos>1</span><span class="pt" data-tot>/5</span></div>
          <div class="lap-block"><span class="lbl" data-lap-lbl>LAP</span><span class="val" data-lap>1<span>/3</span></span></div>
        </div>
        <div class="hud-box tower" data-tower></div>
      </div>
      <div class="hud-top-right">
        <div class="hud-box timing">
          <div class="lbl" data-cur-lbl>CURRENT LAP</div>
          <div class="cur" data-cur>0:00.000</div>
          <div class="sectors" data-sectors>
            <div class="sector"><div class="sn">S1</div><div class="st">--.---</div><div class="bar"></div></div>
            <div class="sector"><div class="sn">S2</div><div class="st">--.---</div><div class="bar"></div></div>
            <div class="sector"><div class="sn">S3</div><div class="st">--.---</div><div class="bar"></div></div>
          </div>
          <div class="rows">
            <div class="row"><span>Best lap</span><b data-best>-:--.---</b></div>
            <div class="row"><span>Last lap</span><b data-last>-:--.---</b></div>
            <div class="row" data-race-row><span>Race time</span><b data-race>0:00.000</b></div>
          </div>
        </div>
      </div>
      <div class="hud-box minimap"><canvas data-map></canvas></div>
      <div class="speedo">
        <div class="shift-lights" data-leds>${'<i></i>'.repeat(15)}</div>
        <svg viewBox="0 0 300 190" aria-hidden="true">
          <defs>
            <linearGradient id="revgrad" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stop-color="#ffffff"/><stop offset="0.72" stop-color="#ffffff"/><stop offset="0.86" stop-color="#ffd21f"/><stop offset="1" stop-color="#ff2a1f"/>
            </linearGradient>
          </defs>
          <path d="M 63.4 170 A 100 100 0 1 1 236.6 170" fill="none" stroke="rgba(10,11,14,0.75)" stroke-width="22" stroke-linecap="butt"/>
          <path d="M 63.4 170 A 100 100 0 1 1 236.6 170" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="14" pathLength="100"/>
          <path data-rev d="M 63.4 170 A 100 100 0 1 1 236.6 170" fill="none" stroke="url(#revgrad)" stroke-width="14" pathLength="100" stroke-dasharray="0 100"/>
          <g data-ticks></g>
        </svg>
        <div class="readout"><div class="spd" data-spd>0</div><div class="unit">KM/H</div></div>
        <div class="gear" data-gear>N</div>
      </div>
      <div class="hud-box dmg-panel" data-status>
        <div class="dmg-title">CAR <span data-trans class="trans-badge">AUTO</span></div>
        <div class="dmg-car">
          <i data-part="frontWing" style="left:14px;right:14px;top:0;height:7px"></i>
          <i data-part="nose" style="left:50px;width:12px;top:9px;height:22px"></i>
          <i data-part="corner0" style="left:4px;width:18px;top:12px;height:24px"></i>
          <i data-part="corner1" style="right:4px;width:18px;top:12px;height:24px"></i>
          <i data-part="sidepodL" style="left:30px;width:14px;top:42px;height:34px"></i>
          <i data-part="sidepodR" style="right:30px;width:14px;top:42px;height:34px"></i>
          <i data-part="engine" style="left:48px;width:16px;top:33px;height:50px;opacity:.85"></i>
          <i data-part="corner2" style="left:2px;width:22px;top:72px;height:28px"></i>
          <i data-part="corner3" style="right:2px;width:22px;top:72px;height:28px"></i>
          <i data-part="rearWing" style="left:32px;right:32px;top:104px;height:8px"></i>
        </div>
        <div class="dmg-level l0" data-dmg-level>NO DAMAGE</div>
      </div>
      <div class="hud-center" data-toasts></div>
      <div class="hud-hint" data-hint></div>
    `;
    root.appendChild(h);
    const q = (s) => h.querySelector(s);
    this.e = {
      pos: q('[data-pos]'), tot: q('[data-tot]'), lap: q('[data-lap]'), lapLbl: q('[data-lap-lbl]'),
      tower: q('[data-tower]'), cur: q('[data-cur]'), curLbl: q('[data-cur-lbl]'), best: q('[data-best]'), last: q('[data-last]'),
      race: q('[data-race]'), raceRow: q('[data-race-row]'), sectors: [...h.querySelectorAll('.sector')],
      rev: q('[data-rev]'), spd: q('[data-spd]'), gear: q('[data-gear]'), leds: q('[data-leds]'), ledList: [...h.querySelectorAll('[data-leds] i')],
      toasts: q('[data-toasts]'), hint: q('[data-hint]'),
      trans: q('[data-trans]'),
      parts: Object.fromEntries([...h.querySelectorAll('[data-part]')].map((n) => [n.dataset.part, n])), dmgLevel: q('[data-dmg-level]'),
    };
    // speedo ticks
    const ticks = q('[data-ticks]');
    let t = '';
    for (let i = 0; i <= 12; i++) {
      const a = ((210 - (240 * i) / 12) * Math.PI) / 180;
      const r1 = 112, r2 = i % 2 === 0 ? 120 : 116;
      const cx = 150, cy = 120;
      t += `<line x1="${cx + Math.cos(a) * r1}" y1="${cy - Math.sin(a) * r1}" x2="${cx + Math.cos(a) * r2}" y2="${cy - Math.sin(a) * r2}" stroke="rgba(255,255,255,${i >= 10 ? '0.9' : '0.45'})" stroke-width="2"/>`;
    }
    ticks.innerHTML = t;
    this.e.ledList.forEach((led, i) => led.dataset.c = i < 5 ? 'g' : i < 10 ? 'r' : 'b');
    this.mapCanvas = q('[data-map]');
    this.cache = new Map();
    this._towerTimer = 0;
    this._toastCount = 0;
  }

  /** Switch the minimap to a new circuit. */
  setTrack(track, checkpoints) {
    this.map = new TrackMap(this.mapCanvas, track, checkpoints.sectorEnds);
  }

  _set(node, key, text) {
    if (this.cache.get(key) === text) return;
    this.cache.set(key, text);
    node.textContent = text;
  }

  _html(node, key, html) {
    if (this.cache.get(key) === html) return;
    this.cache.set(key, html);
    node.innerHTML = html;
  }

  show(v) {
    setVisible(this.node, v);
    if (v) requestAnimationFrame(() => this.map.resize());
  }

  setMode(mode, totalLaps, transmission = 'auto') {
    this.mode = mode;
    this.e.trans.textContent = transmission === 'manual' ? 'MANUAL' : 'AUTO';
    this.e.trans.classList.toggle('manual', transmission === 'manual');
    this.totalLaps = totalLaps;
    this.cache.clear();
    this.e.tower.style.display = mode === 'race' ? '' : 'none';
    this.e.raceRow.style.display = mode === 'race' ? '' : 'none';
    this.node.querySelector('.pos-lap .pos-block').style.display = mode === 'race' ? '' : 'none';
    this.e.lapLbl.textContent = mode === 'race' ? 'LAP' : 'TIME TRIAL';
    this.e.toasts.innerHTML = '';
    this.e.sectors.forEach((s) => (s.className = 'sector'));
    this.e.cur.classList.remove('invalid');
  }

  /** Per-frame update. d: see Game._hudData */
  update(dt, d) {
    const e = this.e;
    if (this.mode === 'race') {
      this._set(e.pos, 'pos', String(d.position));
      this._set(e.tot, 'tot', '/' + d.total);
      this._html(e.lap, 'lap', `${Math.max(1, Math.min(d.totalLaps, d.lap))}<span>/${d.totalLaps}</span>`);
      this._set(e.race, 'race', formatTime(d.raceTime));
    } else {
      this._html(e.lap, 'lap', `${d.lap}<span> LAP</span>`);
    }
    this._set(e.curLbl, 'curLbl', d.waiting ? 'CROSS THE LINE TO START' : d.invalid ? 'LAP INVALIDATED' : 'CURRENT LAP');
    this._set(e.cur, 'cur', formatTime(d.lapTime));
    if (this.cache.get('inv') !== d.invalid) {
      this.cache.set('inv', d.invalid);
      e.cur.classList.toggle('invalid', d.invalid);
    }
    this._set(e.best, 'best', formatTime(d.best));
    this._set(e.last, 'last', formatTime(d.last));
    if (this.cache.get('bestP') !== d.bestIsOverall) {
      this.cache.set('bestP', d.bestIsOverall);
      e.best.classList.toggle('purple', !!d.bestIsOverall);
    }
    // sectors
    for (let i = 0; i < 3; i++) {
      const s = d.sectors[i];
      const cls = 'sector' + (s.cls ? ' ' + s.cls : '') + (d.currentSector === i && !d.waiting ? ' active' : '');
      const node = e.sectors[i];
      if (this.cache.get('sc' + i) !== cls) { this.cache.set('sc' + i, cls); node.className = cls; }
      this._set(node.children[1], 'st' + i, s.time != null ? s.time.toFixed(3) : '--.---');
    }
    // speedo
    this._set(e.spd, 'spd', String(Math.round(d.speedKmh)));
    this._set(e.gear, 'gear', d.gear);
    if (this.cache.get('lim') !== d.limiter) { this.cache.set('lim', d.limiter); e.gear.classList.toggle('limiter', !!d.limiter); }
    // damage diagram (4 Hz is plenty)
    this._statusT = (this._statusT || 0) - dt;
    if (d.damage && this._statusT <= 0) {
      this._statusT = 0.25;
      const D = d.damage;
      const cls = (h) => (h < 0 ? 'gone' : h > 0.85 ? '' : h > 0.55 ? 'd1' : h > 0.25 ? 'd2' : 'd3');
      const set = (k, h) => { const n = e.parts[k]; const c = cls(h); if (n.className !== c) n.className = c; };
      set('frontWing', D.frontWing); set('nose', D.nose); set('rearWing', D.rearWing);
      set('sidepodL', D.sidepodL); set('sidepodR', D.sidepodR); set('engine', D.engine);
      D.corner.forEach((h, i) => set('corner' + i, h));
      const names = ['NO DAMAGE', 'MINOR DAMAGE', 'MODERATE DAMAGE', 'SEVERE DAMAGE', 'TERMINAL · PRESS R'];
      this._set(e.dmgLevel, 'dmgl', names[D.level]);
      const lc = 'dmg-level l' + D.level;
      if (e.dmgLevel.className !== lc) e.dmgLevel.className = lc;
    }
    const rpmN = Math.max(0, Math.min(1, (d.rpm - 3000) / (d.rpmMax - 3000)));
    const dash = (rpmN * 100).toFixed(1);
    if (this.cache.get('rev') !== dash) { this.cache.set('rev', dash); e.rev.setAttribute('stroke-dasharray', `${dash} 100`); }
    const ledLo = d.rpmMax * 0.7, ledHi = d.rpmMax * 0.98;
    const ledN = d.rpm < ledLo ? 0 : Math.min(15, Math.ceil(((d.rpm - ledLo) / (ledHi - ledLo)) * 15));
    const flash = d.rpm > ledHi && d.gear !== String(d.topGear);
    const key = ledN + (flash ? 'f' : '');
    if (this.cache.get('leds') !== key) {
      this.cache.set('leds', key);
      e.leds.classList.toggle('flash', flash);
      e.ledList.forEach((led, i) => (led.className = i < ledN && !flash ? led.dataset.c : ''));
    }
    // tower & minimap
    this._towerTimer -= dt;
    if (this.mode === 'race' && this._towerTimer <= 0 && d.tower) {
      this._towerTimer = 0.25;
      const html = d.tower.map((r) => `<div class="tower-row${r.isPlayer ? ' me' : ''}"><span class="tp">${r.position}</span><span class="tc" style="background:${r.color}"></span><span class="tn">${escapeHtml(r.name)}</span><span class="tg">${r.gap}</span></div>`).join('');
      this._html(e.tower, 'tower', html);
    }
    if (d.markers) this.map.draw(d.markers);
  }

  /** Animated notification. style: '' | red | purple | green | yellow | warn */
  notify(label, value = '', style = '', duration = 2.2) {
    const t = el('div', 'toast' + (style ? ' ' + style : ''), `<span>${escapeHtml(label)}</span>${value ? `<span class="tv">${escapeHtml(value)}</span>` : ''}`);
    const list = this.e.toasts;
    list.appendChild(t);
    while (list.children.length > 3) list.removeChild(list.firstChild);
    setTimeout(() => t.classList.add('out'), duration * 1000);
    setTimeout(() => t.remove(), duration * 1000 + 450);
  }

  hint(text, duration = 2.5) {
    this.e.hint.textContent = text;
    this.e.hint.style.opacity = '1';
    clearTimeout(this._hintT);
    this._hintT = setTimeout(() => (this.e.hint.style.opacity = '0'), duration * 1000);
  }

  clearToasts() {
    this.e.toasts.innerHTML = '';
  }
}
