import { el, button, setVisible, escapeHtml } from './dom.js';
import { hex } from '../vehicle/Teams.js';
import { ERAS, CAR_BY_ID, SUBERA_BY_ID, carsForSub } from '../vehicle/CarCatalog.js';
import { CIRCUITS, CIRCUIT_ORDER } from '../track/circuits/index.js';
import { OnlineService, onlineConfigured } from '../net/OnlineService.js';
import { RoomSession } from '../net/RoomSession.js';

const NAME_KEY = 'hgp-online-name';
const ROOM_KEY = 'hgp-online-room';
const SUBS = ERAS.flatMap((e) => e.subs.map((s) => ({ ...s, eraName: e.name })));
const subLabel = (id) => { const s = SUBERA_BY_ID[id]; return s ? (s.id === '2020' ? '2020' : s.name) : id; };
const trackName = (id) => (CIRCUITS[id] ? CIRCUITS[id].name : id);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const col = (v) => (typeof v === 'number' ? hex(v) : v);

/**
 * ONLINE RACING: server browser, create / join, lobby. Owns the OnlineService and
 * the current RoomSession; hands the session to the Game when the host starts.
 */
export class OnlineMenu {
  constructor(root, audio, game) {
    this.audio = audio;
    this.game = game;
    this.svc = new OnlineService();
    this.session = null;
    this.view = 'browse';
    this.rooms = [];
    this.filters = { q: '', track: '', open: false, locked: true };
    const o = (this.node = el('section', 'screen overlay top online'));
    o.innerHTML = `
      <div class="panel online-panel" role="dialog" aria-label="Online racing">
        <div class="online-head">
          <h2><small>MULTIPLAYER</small>Online Racing</h2>
          <div class="net-status" data-net></div>
        </div>
        <div class="tabs" data-tabs>
          <button data-view="browse">Browse Servers</button>
          <button data-view="create">Create Server</button>
          <button data-view="join">Join with Code</button>
          <button data-view="lobby">My Session</button>
        </div>
        <div class="online-body" data-body></div>
        <div class="online-msg" data-msg></div>
        <div class="actions"><button class="btn" data-act="back">Back to Main Menu</button></div>
      </div>`;
    root.appendChild(o);
    this.body = o.querySelector('[data-body]');
    this.msgEl = o.querySelector('[data-msg]');
    this.netEl = o.querySelector('[data-net]');
    o.querySelectorAll('[data-view]').forEach((b) => button(b, audio, () => this.go(b.dataset.view)));
    button(o.querySelector('[data-act=back]'), audio, () => this.hide());
    this.body.addEventListener('click', (e) => this._click(e));
    this.body.addEventListener('change', (e) => this._change(e));
    this.body.addEventListener('input', (e) => this._input(e));
    this.body.addEventListener('keydown', (e) => e.stopPropagation()); // typing must not drive the car / hit shortcuts
  }

  get name() {
    return store.get(NAME_KEY) || '';
  }

  // ------------------------------------------------------------------ show / hide / navigation
  async show() {
    setVisible(this.node, true);
    this.visible = true;
    this.go(this.session ? 'lobby' : this.view === 'lobby' ? 'browse' : this.view || 'browse');
    if (!onlineConfigured()) return this._msg('Online racing is not configured on this build.', 'err');
    try {
      this._msg('Connecting…');
      await this.svc.connect();
      this._msg('');
      this._renderNet();
      // reconnect to the session we were in (page reload, crash, lost tab)
      const saved = store.get(ROOM_KEY);
      if (!this.session && saved) await this._enter(() => this.svc.joinRoom({ roomId: saved, name: this.name, ...this._myCar() }), true);
      this.go(this.session ? 'lobby' : this.view);
    } catch (e) {
      this._msg(e.message, 'err');
    }
  }

  hide() {
    if (!this.visible) return;
    setVisible(this.node, false);
    this.visible = false;
    this.svc.unwatchRoomList();
    clearInterval(this._netTimer);
    this.onClose && this.onClose();
  }

  go(view) {
    if (view === 'lobby' && !this.session) view = 'browse';
    this.view = view;
    this.node.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    this.node.querySelector('[data-view=lobby]').disabled = !this.session;
    if (view === 'browse' && this.svc.ready) {
      this.svc.watchRoomList(() => this._refreshRooms());
      this._refreshRooms();
    } else this.svc.unwatchRoomList();
    clearInterval(this._netTimer);
    this._netTimer = setInterval(() => this._renderNet(), 1000);
    this.render();
  }

  _msg(text, cls = '') {
    this.msgEl.textContent = text || '';
    this.msgEl.className = 'online-msg ' + cls;
  }

  _renderNet() {
    const s = this.session;
    let txt = this.svc.ready ? 'ONLINE · GUEST' : 'OFFLINE';
    let cls = this.svc.ready ? 'ok' : '';
    if (s) {
      const st = s.status === 'connected' ? 'CONNECTED' : s.status === 'reconnecting' ? 'RECONNECTING…' : s.status.toUpperCase();
      cls = s.status === 'connected' ? 'ok' : 'warn';
      txt = `${st}${s.rtt != null ? ` · ${Math.round(s.rtt)} ms RTT` : ''}`;
    }
    this.netEl.textContent = txt;
    this.netEl.className = 'net-status ' + cls;
  }

  // ------------------------------------------------------------------ rendering
  render() {
    const v = this.view;
    if (!onlineConfigured()) {
      this.body.innerHTML = `<div class="srv-empty"><b>Online servers are offline on this build.</b><br>
        The multiplayer backend (Supabase) has not been connected to this deployment yet.<br>Single-player racing and time trial work as usual.</div>`;
      return;
    }
    if (v === 'browse') this.body.innerHTML = this._browseHtml();
    else if (v === 'create') this.body.innerHTML = this._createHtml();
    else if (v === 'join') this.body.innerHTML = this._joinHtml();
    else if (v === 'lobby') this.body.innerHTML = this._lobbyHtml();
  }

  _nameField() {
    return `<label class="of"><span>Your display name</span><input data-f="name" maxlength="20" placeholder="e.g. Giorgi" value="${escapeHtml(this.name)}"></label>`;
  }

  _browseHtml() {
    const F = this.filters;
    const list = this.rooms.filter((r) =>
      (!F.q || (r.name + ' ' + r.host_name).toLowerCase().includes(F.q.toLowerCase())) &&
      (!F.track || r.track_id === F.track) &&
      (!F.open || (r.player_count < r.max_players && r.status === 'waiting')) &&
      (F.locked || !r.has_password));
    const rows = list.map((r) => {
      const full = r.player_count >= r.max_players;
      const canJoin = !full && r.status === 'waiting';
      return `<div class="srv">
        <div class="srv-main"><b>${escapeHtml(r.name)}${r.has_password ? ' <i class="lock" title="Password">🔒</i>' : ''}</b>
          <span>Host ${escapeHtml(r.host_name)} · ${escapeHtml(trackName(r.track_id))} · ${escapeHtml(subLabel(r.car_era))} · ${r.laps} laps</span></div>
        <div class="srv-count ${full ? 'full' : ''}">${r.player_count}/${r.max_players}</div>
        <div class="srv-status st-${r.status}">${r.status.toUpperCase()}</div>
        <button class="btn ${canJoin ? 'primary' : ''}" data-join="${r.id}" data-pw="${r.has_password ? 1 : 0}" ${canJoin ? '' : 'disabled'}>Join</button>
      </div>`;
    }).join('');
    return `${this._nameField()}
      <div class="srv-filters">
        <input data-f="q" placeholder="Search servers or hosts" value="${escapeHtml(F.q)}">
        <select data-f="track"><option value="">All circuits</option>${CIRCUIT_ORDER.map((id) => `<option value="${id}" ${F.track === id ? 'selected' : ''}>${escapeHtml(trackName(id))}</option>`).join('')}</select>
        <label class="chk"><input type="checkbox" data-f="open" ${F.open ? 'checked' : ''}> Free slots only</label>
        <label class="chk"><input type="checkbox" data-f="locked" ${F.locked ? 'checked' : ''}> Show password rooms</label>
        <button class="btn" data-act="refresh">Refresh</button>
      </div>
      <div class="srv-list">${rows || `<div class="srv-empty">${this.svc.ready ? (this._loadingRooms ? 'Loading servers…' : 'No public servers right now. Create one and invite your friends!') : 'Connecting…'}</div>`}</div>
      <p class="online-note">Private servers are hidden here. Join them with their invite code.</p>`;
  }

  _createHtml() {
    const g = this.game;
    const era = (CAR_BY_ID[g.settings.car] || {}).sub || '2020';
    return `${this._nameField()}
      <div class="of-grid">
        <label class="of"><span>Server name</span><input data-c="name" maxlength="40" placeholder="${escapeHtml((this.name || 'My') + "'s race")}"></label>
        <label class="of"><span>Circuit</span><select data-c="track">${CIRCUIT_ORDER.map((id) => `<option value="${id}" ${g.trackId === id ? 'selected' : ''}>${escapeHtml(trackName(id))}</option>`).join('')}</select></label>
        <label class="of"><span>Car era</span><select data-c="era">${SUBS.map((s) => `<option value="${s.id}" ${s.id === era ? 'selected' : ''}>${escapeHtml(s.id === '2020' ? '2020 era' : s.eraName.replace(' ERA', '') + ' · ' + s.name)}</option>`).join('')}</select></label>
        <label class="of"><span>Your car</span><select data-c="car">${this._carOptions(era, g.settings.car)}</select></label>
        <label class="of"><span>Laps</span><select data-c="laps">${[1, 2, 3, 5, 8, 10].map((n) => `<option ${n === 3 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="of"><span>Max players</span><select data-c="max">${[2, 3, 4, 5, 6, 7, 8].map((n) => `<option ${n === 8 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="of"><span>Visibility</span><select data-c="vis"><option value="public">Public (listed)</option><option value="private">Private (invite code)</option></select></label>
        <label class="of"><span>Password (optional)</span><input data-c="pw" type="password" maxlength="64" autocomplete="new-password"></label>
      </div>
      <div class="actions"><button class="btn primary" data-act="create">Create Server</button></div>`;
  }

  _carOptions(sub, current) {
    return carsForSub(sub).map((c) => `<option value="${c.id}" ${c.id === current ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
  }

  _joinHtml() {
    return `${this._nameField()}
      <div class="of-grid">
        <label class="of"><span>Invite code</span><input data-j="code" maxlength="6" placeholder="ABC123" style="text-transform:uppercase;letter-spacing:.3em;font-weight:800"></label>
        <label class="of"><span>Password (if the room has one)</span><input data-j="pw" type="password" maxlength="64"></label>
      </div>
      <div class="actions"><button class="btn primary" data-act="joincode">Join Server</button></div>`;
  }

  _lobbyHtml() {
    const s = this.session;
    if (!s) return '<div class="srv-empty">You are not in a server.</div>';
    const r = s.room;
    const host = s.isHost;
    const me = s.players.find((p) => p.user_id === s.me) || {};
    const rows = s.players.map((p) => {
      const car = CAR_BY_ID[p.selected_car];
      const online = s.online.has(p.user_id) || p.user_id === s.me;
      const isHost = p.user_id === r.host_user_id;
      return `<div class="lp ${online ? '' : 'off'}">
        <i class="dot ${online ? 'on' : ''}" title="${online ? 'Connected' : 'Disconnected'}"></i>
        <span class="sw" style="background:${car ? col(car.primary) : '#555'}"></span>
        <div class="lp-name"><b>${escapeHtml(p.display_name)}${p.user_id === s.me ? ' (you)' : ''}</b>${isHost ? ' <em class="host">HOST</em>' : ''}
          <span>${car ? escapeHtml(car.name + ' · ' + car.years) : '—'}</span></div>
        <div class="lp-ready ${p.ready_status || isHost ? 'yes' : ''}">${isHost ? 'HOST' : p.ready_status ? 'READY' : 'NOT READY'}</div>
        ${host && p.user_id !== s.me ? `<button class="btn" data-kick="${p.user_id}">Remove</button>` : ''}
      </div>`;
    }).join('');
    const others = s.players.filter((p) => p.user_id !== r.host_user_id && (s.online.has(p.user_id)));
    const allReady = others.every((p) => p.ready_status);
    const racing = r.status === 'countdown' || r.status === 'racing';
    return `
      <div class="lobby-head">
        <div><b class="lobby-name">${escapeHtml(r.name)}</b>
          <span>${escapeHtml(trackName(r.track_id))} · ${escapeHtml(subLabel(r.car_era))} · ${r.laps} laps · ${r.visibility === 'private' ? 'PRIVATE' : 'PUBLIC'} · ${r.status.toUpperCase()}</span></div>
        <div class="invite">INVITE CODE <b data-code>${escapeHtml(r.room_code)}</b> <button class="btn" data-act="copy">Copy</button></div>
      </div>
      <div class="lobby-grid">
        <div>
          <div class="lp-title">DRIVERS ${s.players.length}/${r.max_players}</div>
          <div class="lp-list">${rows}</div>
        </div>
        <div class="lobby-side">
          <label class="of"><span>Your car (${escapeHtml(subLabel(r.car_era))})</span><select data-l="car">${this._carOptions(r.car_era, me.selected_car)}</select></label>
          ${host ? '' : `<button class="btn ${me.ready_status ? '' : 'primary'} wide" data-act="ready">${me.ready_status ? 'Not ready' : 'Ready'}</button>`}
          ${host ? `
            <div class="host-box">
              <div class="lp-title">HOST CONTROLS</div>
              <label class="of"><span>Circuit</span><select data-h="track" ${racing ? 'disabled' : ''}>${CIRCUIT_ORDER.map((id) => `<option value="${id}" ${r.track_id === id ? 'selected' : ''}>${escapeHtml(trackName(id))}</option>`).join('')}</select></label>
              <label class="of"><span>Car era</span><select data-h="era" ${racing ? 'disabled' : ''}>${SUBS.map((x) => `<option value="${x.id}" ${x.id === r.car_era ? 'selected' : ''}>${escapeHtml(subLabel(x.id))}</option>`).join('')}</select></label>
              <div class="of-row">
                <label class="of"><span>Laps</span><select data-h="laps" ${racing ? 'disabled' : ''}>${[1, 2, 3, 5, 8, 10].map((n) => `<option ${n === r.laps ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
                <label class="of"><span>Slots</span><select data-h="max" ${racing ? 'disabled' : ''}>${[2, 3, 4, 5, 6, 7, 8].map((n) => `<option ${n === r.max_players ? 'selected' : ''} ${n < s.players.length ? 'disabled' : ''}>${n}</option>`).join('')}</select></label>
              </div>
              <button class="btn primary wide" data-act="start" ${racing ? 'disabled' : ''}>${allReady ? 'Start Race' : 'Start Race (not everyone is ready)'}</button>
              <button class="btn wide" data-act="close">End Session</button>
            </div>` : `<p class="online-note">Waiting for the host to start the race. The countdown starts on every screen at the same moment.</p>`}
          <button class="btn wide" data-act="leave">Leave Server</button>
        </div>
      </div>`;
  }

  // ------------------------------------------------------------------ events
  _input(e) {
    const t = e.target;
    if (t.dataset.f === 'name') store.set(NAME_KEY, t.value.trim().slice(0, 20));
    if (t.dataset.f === 'q') { this.filters.q = t.value; this._rerenderList(); }
  }

  _rerenderList() {
    const list = this.body.querySelector('.srv-list');
    if (!list) return;
    const tmp = el('div', '', this._browseHtml());
    list.replaceWith(tmp.querySelector('.srv-list'));
  }

  async _change(e) {
    const t = e.target;
    if (t.dataset.f === 'track') { this.filters.track = t.value; this._rerenderList(); }
    if (t.dataset.f === 'open') { this.filters.open = t.checked; this._rerenderList(); }
    if (t.dataset.f === 'locked') { this.filters.locked = t.checked; this._rerenderList(); }
    if (t.dataset.c === 'era') this.body.querySelector('[data-c=car]').innerHTML = this._carOptions(t.value, this._sameTeamCar(t.value, this.game.settings.car));
    const s = this.session;
    if (!s) return;
    try {
      if (t.dataset.l === 'car') {
        const car = CAR_BY_ID[t.value];
        await this.svc.updateMyPlayer(s.room.id, { selected_car: car.id, selected_team: car.teamId || car.team || '' });
        this.game.selectCar(car.id);
      }
      if (t.dataset.h) {
        const v = t.value;
        const o = { track: t.dataset.h === 'track' ? v : null, era: t.dataset.h === 'era' ? v : null, laps: t.dataset.h === 'laps' ? +v : null, maxPlayers: t.dataset.h === 'max' ? +v : null };
        const r = await this.svc.updateRoom(s.room.id, o);
        s.room = { ...s.room, ...r };
        if (o.era) await this._ensureEraCar();
        this.render();
      }
    } catch (err) {
      this._msg(err.message, 'err');
    }
  }

  _sameTeamCar(sub, currentId) {
    const cur = CAR_BY_ID[currentId];
    const list = carsForSub(sub);
    return (cur && (list.find((c) => c.id === cur.id) || list.find((c) => c.team === cur.team))) ? (list.find((c) => c.id === cur.id) || list.find((c) => c.team === cur.team)).id : list[0].id;
  }

  _myCar(sub) {
    const id = sub ? this._sameTeamCar(sub, this.game.settings.car) : this.game.settings.car;
    const c = CAR_BY_ID[id];
    return { car: c.id, team: c.teamId || c.team || '' };
  }

  /** After an era change, make sure my car belongs to the room's era. */
  async _ensureEraCar() {
    const s = this.session;
    if (!s) return;
    const me = s.players.find((p) => p.user_id === s.me);
    const car = CAR_BY_ID[me && me.selected_car];
    if (car && car.sub === s.room.car_era) return;
    const pick = this._myCar(s.room.car_era);
    await this.svc.updateMyPlayer(s.room.id, { selected_car: pick.car, selected_team: pick.team, ready_status: false });
    this.game.selectCar(pick.car);
  }

  async _click(e) {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    this.audio.uiClick();
    const s = this.session;
    try {
      if (b.dataset.join) {
        if (!this._needName()) return;
        let pw = null;
        if (b.dataset.pw === '1') { pw = prompt('This server has a password:'); if (pw == null) return; }
        const room = this.rooms.find((r) => r.id === b.dataset.join);
        await this._enter(() => this.svc.joinRoom({ roomId: b.dataset.join, password: pw, name: this.name, ...this._myCar(room && room.car_era) }));
      } else if (b.dataset.kick && s) {
        await s.kick(b.dataset.kick);
      } else switch (b.dataset.act) {
        case 'refresh': await this._refreshRooms(); break;
        case 'create': await this._create(); break;
        case 'joincode': {
          if (!this._needName()) return;
          const code = this.body.querySelector('[data-j=code]').value.trim().toUpperCase();
          if (!/^[A-Z2-9]{6}$/.test(code)) return this._msg('Invite codes have 6 letters / digits.', 'err');
          const pw = this.body.querySelector('[data-j=pw]').value || null;
          await this._enter(() => this.svc.joinRoom({ code, password: pw, name: this.name, ...this._myCar() }));
          await this._ensureEraCar();
          break;
        }
        case 'ready': {
          const me = s.players.find((p) => p.user_id === s.me);
          await this.svc.updateMyPlayer(s.room.id, { ready_status: !me.ready_status });
          me.ready_status = !me.ready_status;
          this.render();
          break;
        }
        case 'copy': navigator.clipboard && navigator.clipboard.writeText(s.room.room_code).catch(() => {}); this._msg('Invite code copied: ' + s.room.room_code); break;
        case 'start': await this._ensureEraCar(); await s.startRace(9000); break;
        case 'close': if (confirm('End this session for everyone?')) await s.closeRoom(); break;
        case 'leave': await this.leave(); break;
      }
    } catch (err) {
      this._msg(err.message, 'err');
    }
  }

  _needName() {
    if (this.name.length >= 1) return true;
    this._msg('Enter a display name first.', 'err');
    const f = this.body.querySelector('[data-f=name]');
    f && f.focus();
    return false;
  }

  async _create() {
    if (!this._needName()) return;
    const q = (k) => this.body.querySelector(`[data-c=${k}]`);
    const car = CAR_BY_ID[q('car').value];
    await this._enter(() => this.svc.createRoom({
      name: q('name').value.trim() || `${this.name}'s race`, hostName: this.name, track: q('track').value, era: q('era').value,
      laps: +q('laps').value, maxPlayers: +q('max').value, visibility: q('vis').value, password: q('pw').value, car: car.id, team: car.teamId || car.team || '',
    }));
  }

  async _refreshRooms() {
    if (!this.svc.ready) return;
    this._loadingRooms = !this.rooms.length;
    try {
      this.rooms = (await this.svc.listRooms()) || [];
    } catch (e) {
      this._msg(e.message, 'err');
    }
    this._loadingRooms = false;
    if (this.view === 'browse' && this.visible) this._rerenderList();
  }

  // ------------------------------------------------------------------ session
  async _enter(joinFn, silent = false) {
    this._msg(silent ? 'Reconnecting to your session…' : 'Joining…');
    let room;
    try {
      room = await joinFn();
    } catch (e) {
      if (silent) { store.set(ROOM_KEY, null); this._msg(''); return; }
      throw e;
    }
    if (this.session) this.session.dispose();
    const s = (this.session = new RoomSession(this.svc, room, {
      onRoom: () => this._sessionChanged(),
      onPlayers: () => this._sessionChanged(),
      onPresence: () => this._sessionChanged(),
      onStatus: (st) => { this._renderNet(); this.game.onlineStatus(st); },
      onStart: (info) => this.game.onlineStart(s, info),
      onState: (m) => this.game.onlineState(m),
      onFinish: (m) => this.game.onlineFinish(m),
      onNotice: (type, userId) => this.game.onlineNotice(type, userId, s),
      onKicked: () => this._ended('You were removed from the server.'),
      onClosed: (msg) => this._ended(msg),
    }));
    await s.open();
    if (this.session !== s) return; // closed while opening
    store.set(ROOM_KEY, room.id);
    this._msg(silent ? 'Reconnected to your session.' : '');
    this.game.onlineJoined(s);
    // the room might already be counting down / racing (reconnect)
    if ((room.status === 'countdown' || room.status === 'racing') && room.race_start_at) this.game.onlineStart(s, { seq: room.race_seq, at: Date.parse(room.race_start_at), rejoin: true });
    if (this.visible) this.go('lobby');
  }

  _sessionChanged() {
    if (this.visible && this.view === 'lobby') {
      // keep focus-free re-render cheap: only when the user is not interacting with a select
      const a = document.activeElement;
      if (!(a && this.body.contains(a) && a.tagName === 'SELECT')) this.render();
    }
    this.game.onlineRosterChanged(this.session);
  }

  async leave() {
    const s = this.session;
    if (!s) return;
    this.session = null;
    store.set(ROOM_KEY, null);
    this.game.onlineLeft();
    await s.leave();
    if (this.visible) this.go('browse');
  }

  _ended(msg) {
    this.session = null;
    store.set(ROOM_KEY, null);
    this.game.onlineLeft(msg);
    if (msg) this._msg(msg, 'err');
    if (this.visible) this.go('browse');
  }

  /** Return to the lobby after a race (results screen / pause menu). */
  showLobby() {
    this.show();
  }
}
