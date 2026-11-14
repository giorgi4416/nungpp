import { el, button, setVisible, escapeHtml } from './dom.js';
import { formatTime } from '../race/LapSystem.js';

/** Final classification with the player's race summary and lap list. */
export class ResultsScreen {
  constructor(root, audio, handlers) {
    const o = (this.node = el('section', 'screen overlay'));
    o.innerHTML = `
      <div class="panel results-panel" role="dialog" aria-label="Race results">
        <div class="results-head">
          <div>
            <h2><small>HUNGARORING · FINAL CLASSIFICATION</small><span data-title>Race Result</span></h2>
            <div data-record></div>
          </div>
          <div class="results-pos" data-pos>P1<small>/5</small></div>
        </div>
        <div class="results-stats" style="margin-top:18px">
          <div>TOTAL TIME<b data-total>-</b></div>
          <div>BEST LAP<b data-best>-</b></div>
          <div>LAPS<b data-laps>-</b></div>
        </div>
        <div class="laps-list" data-lapslist></div>
        <table class="classification">
          <thead><tr><th>POS</th><th>DRIVER</th><th>TEAM</th><th>TIME / GAP</th><th>BEST LAP</th></tr></thead>
          <tbody data-rows></tbody>
        </table>
        <div class="actions">
          <button class="btn" data-act="menu">Main Menu</button>
          <button class="btn primary" data-act="restart">Race Again</button>
        </div>
      </div>`;
    root.appendChild(o);
    o.querySelectorAll('[data-act]').forEach((b) => button(b, audio, () => handlers[b.dataset.act] && handlers[b.dataset.act]()));
    this.q = (s) => o.querySelector(s);
    this.visible = false;
  }

  /**
   * @param summary {position, total, totalTime, bestLap, lapTimes[], newRecord}
   * @param rows classification rows from RaceManager
   */
  show(summary, rows) {
    const q = this.q;
    const pos = summary.position;
    q('[data-title]').textContent = pos === 1 ? 'Victory!' : pos <= 3 ? 'Podium Finish' : 'Race Complete';
    q('[data-pos]').innerHTML = `P${pos}<small>/${summary.total}</small>`;
    q('[data-total]').textContent = formatTime(summary.totalTime);
    q('[data-best]').textContent = formatTime(summary.bestLap);
    q('[data-laps]').textContent = String(summary.lapTimes.length);
    q('[data-record]').innerHTML = summary.newRecord ? '<span class="record-badge">NEW PERSONAL BEST LAP</span>' : '';
    q('[data-lapslist]').innerHTML = summary.lapTimes.map((t, i) => `<span class="${t === summary.bestLap ? 'best' : ''}">L${i + 1} · ${formatTime(t)}</span>`).join('');
    this.updateRows(rows);
    setVisible(this.node, true);
    this.visible = true;
  }

  updateRows(rows) {
    const html = rows.map((r) => {
      const R = r.racer;
      const time = r.position === 1 && r.total != null ? formatTime(r.total) : r.gap;
      return `<tr class="${R.isPlayer ? 'me' : ''}"><td>${r.position}</td><td><span class="sw" style="background:${R.color}"></span>${escapeHtml(R.name)}</td><td>${escapeHtml(R.team)}</td><td>${escapeHtml(time)}</td><td>${formatTime(r.bestLap)}</td></tr>`;
    }).join('');
    if (html !== this._last) {
      this._last = html;
      this.q('[data-rows]').innerHTML = html;
    }
  }

  hide() {
    setVisible(this.node, false);
    this.visible = false;
  }
}
