import { el, button, setVisible, escapeHtml } from './dom.js';
import { hex } from '../vehicle/Teams.js';
import { ERAS, CARS, CAR_BY_ID, SUBERA_BY_ID, carsForSub } from '../vehicle/CarCatalog.js';
import { CIRCUITS, CIRCUIT_ORDER } from '../track/circuits/index.js';
import { integrateLayout } from '../track/layout.js';
import { Storage } from '../systems/LocalStorage.js';
import { formatTime } from '../race/LapSystem.js';

class Overlay {
  constructor(root, title, sub) {
    const o = (this.node = el('section', 'screen overlay top'));
    o.innerHTML = `<div class="panel select-panel" role="dialog" aria-label="${title}"><h2><small>${sub}</small>${title}</h2><div class="select-grid" data-grid></div>
      <div class="actions"><button class="btn primary" data-act="close">Done</button></div></div>`;
    root.appendChild(o);
    o.addEventListener('click', (e) => { if (e.target === o) this.hide(); });
    this.grid = o.querySelector('[data-grid]');
  }

  show() {
    this.render();
    setVisible(this.node, true);
    this.visible = true;
  }

  hide() {
    if (!this.visible) return;
    setVisible(this.node, false);
    this.visible = false;
  }
}

const CONCEPT = {
  nose: { long: 'long nose', short: 'short nose', wide: 'wide nose' },
  pods: { downwash: 'downwash sidepods', ramp: 'ramp sidepods', slim: 'slim sidepods' },
  rearWing: { spoon: 'spoon rear wing', flat: 'flat rear wing' },
};

/**
 * Car selection: era -> sub-era -> car. Docked on the left so the 3D car in the
 * menu scene stays visible on the right as a live preview (drag to rotate, scroll to zoom).
 */
export class CarSelect {
  constructor(root, audio, getCurrent, onPick) {
    this.audio = audio;
    this.getCurrent = getCurrent;
    this.onPick = onPick;
    const o = (this.node = el('section', 'screen car-select'));
    o.innerHTML = `
      <div class="cs-panel" role="dialog" aria-label="Car selection">
        <h2><small>CAR SELECTION</small>Choose your car</h2>
        <div class="era-tabs" data-eras></div>
        <p class="era-blurb" data-blurb></p>
        <div class="sub-chips" data-subs></div>
        <div class="car-list" data-cars></div>
        <div class="actions"><button class="btn primary" data-act="close">Select &amp; close</button></div>
      </div>
      <div class="cs-preview-hint">DRAG TO ROTATE · SCROLL TO ZOOM · DOUBLE-CLICK TO RESET</div>
      <div class="cs-info" data-info></div>`;
    root.appendChild(o);
    button(o.querySelector('[data-act=close]'), audio, () => this.hide());
  }

  show() {
    const cur = CAR_BY_ID[this.getCurrent()] || CARS[0];
    this.era = cur.era;
    this.sub = cur.sub;
    this.render();
    setVisible(this.node, true);
    this.visible = true;
  }

  hide() {
    if (!this.visible) return;
    setVisible(this.node, false);
    this.visible = false;
    this.onClose && this.onClose();
  }

  _pickInSub(sub, teamId) {
    const keep = CARS.find((c) => c.sub === sub && c.teamId === teamId) || carsForSub(sub)[0];
    this.onPick(keep.id);
  }

  render() {
    const cur = CAR_BY_ID[this.getCurrent()] || CARS[0];
    const era = ERAS.find((e) => e.id === this.era);
    const q = (x) => this.node.querySelector(x);
    q('[data-eras]').innerHTML = ERAS.map((e) => `<button class="${e.id === this.era ? 'active' : ''}" data-era="${e.id}">${e.name}</button>`).join('');
    q('[data-blurb]').textContent = era.blurb;
    q('[data-subs]').innerHTML = era.subs.length > 1 ? era.subs.map((s) => `<button class="${s.id === this.sub ? 'active' : ''}" data-sub="${s.id}">${s.name}</button>`).join('') : '';
    const sub = SUBERA_BY_ID[this.sub];
    q('[data-cars]').innerHTML = carsForSub(this.sub).map((c) => `
      <button class="car-card ${c.id === cur.id ? 'active' : ''}" data-car="${c.id}">
        <span class="swatch" style="background:linear-gradient(135deg, ${hex(c.primary)} 0 55%, ${hex(c.secondary)} 55% 85%, ${hex(c.accent)} 85%)"></span>
        <span class="cc-text"><b>${escapeHtml(c.name)}</b><small>#${c.number} · ${escapeHtml(sub.years)}${c.sub === '2020' ? ' · ' + CONCEPT.nose[c.chassis.nose] + ', ' + CONCEPT.pods[c.chassis.pods] : ''}</small></span>
      </button>`).join('');
    const cs = SUBERA_BY_ID[cur.sub];
    q('[data-info]').innerHTML = `<div class="ci-era">${escapeHtml(cs.eraName)} · ${escapeHtml(cs.years)}</div>
      <div class="ci-name">${escapeHtml(cur.carName)}</div>
      <div class="ci-row"><span>Team</span><b>${escapeHtml(cur.name)}</b></div>
      <div class="ci-row"><span>Engine</span><b>${escapeHtml(cur.engine)}</b></div>
      <div class="ci-row"><span>Gearbox</span><b>${(cs.perf.gears || [0, 0, 0, 0, 0, 0, 0, 0, 0]).length - 1}-speed</b></div>`;
    this.node.querySelectorAll('[data-era]').forEach((b) => button(b, this.audio, () => {
      this.era = b.dataset.era;
      this.sub = ERAS.find((x) => x.id === this.era).subs[0].id;
      this._pickInSub(this.sub, cur.teamId);
      this.render();
    }));
    this.node.querySelectorAll('[data-sub]').forEach((b) => button(b, this.audio, () => {
      this.sub = b.dataset.sub;
      this._pickInSub(this.sub, cur.teamId);
      this.render();
    }));
    this.node.querySelectorAll('[data-car]').forEach((b) => button(b, this.audio, () => {
      this.onPick(b.dataset.car);
      this.render();
    }));
  }
}

const OUTLINES = new Map();
function outlinePath(def, w, h) {
  const key = def.id + w + 'x' + h;
  if (OUTLINES.has(key)) return OUTLINES.get(key);
  const L = integrateLayout(def.segments, 6);
  const pts = L.points;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const sc = Math.min((w - 20) / (maxX - minX), (h - 20) / (maxY - minY));
  const ox = (w - (maxX - minX) * sc) / 2, oy = (h - (maxY - minY) * sc) / 2;
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${(ox + (x - minX) * sc).toFixed(1)},${(oy + (maxY - y) * sc).toFixed(1)}`).join('') + 'Z';
  const k = Math.round((def.startOffset / def.length) * pts.length) % pts.length;
  const start = [ox + (pts[k][0] - minX) * sc, oy + (maxY - pts[k][1]) * sc];
  const out = { d, start };
  OUTLINES.set(key, out);
  return out;
}

/** Circuit selection with live outlines generated from the circuit definitions. */
export class TrackSelect extends Overlay {
  constructor(root, audio, getCurrent, onPick) {
    super(root, 'Choose a circuit', 'TRACK SELECTION');
    this.audio = audio;
    this.getCurrent = getCurrent;
    this.onPick = onPick;
    button(this.node.querySelector('[data-act=close]'), audio, () => this.hide());
  }

  render() {
    const cur = this.getCurrent();
    this.grid.innerHTML = CIRCUIT_ORDER.map((id) => {
      const c = CIRCUITS[id];
      const o = outlinePath(c, 240, 150);
      const best = Storage.loadAllTimeBest(id);
      const corners = Math.max(...c.segments.filter((s) => s.t).map((s) => s.n));
      return `<button class="track-card ${id === cur ? 'active' : ''}" data-track="${id}">
        <svg viewBox="0 0 240 150"><path d="${o.d}" fill="none" stroke="rgba(0,0,0,.6)" stroke-width="7" stroke-linejoin="round"/><path d="${o.d}" fill="none" stroke="#fff" stroke-width="3.2" stroke-linejoin="round"/><circle cx="${o.start[0]}" cy="${o.start[1]}" r="5" fill="#e10600"/></svg>
        <div class="tc-name">${escapeHtml(c.name)}</div>
        <div class="tc-meta">${escapeHtml(c.gp)} · ${escapeHtml(c.location)}</div>
        <div class="tc-stats"><span>${(c.length / 1000).toFixed(3)} km</span><span>${corners} corners</span><span>${escapeHtml(c.direction)}</span></div>
        <div class="tc-best">Best lap <b>${formatTime(best)}</b></div>
      </button>`;
    }).join('');
    this.grid.querySelectorAll('[data-track]').forEach((b) => button(b, this.audio, () => {
      const id = b.dataset.track;
      if (id === this.getCurrent()) return;
      this.hide();
      this.onPick(id);
    }));
  }
}
