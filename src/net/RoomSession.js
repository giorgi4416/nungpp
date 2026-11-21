/**
 * One joined room: the private Realtime channel "room:<id>" plus the room/player rows.
 *
 *  Presence  -> who is connected right now (online / offline, reconnects)
 *  Broadcast -> car state snapshots ('s'), race start ('start'), finish ('fin'),
 *               ping/pong for a measured round-trip time, kick / close notices
 *  Postgres  -> room settings, host, membership, ready state, results
 *               (lobby list refreshes from postgres_changes on those rows)
 *
 * The channel is private: Supabase only lets a user join it when the RLS policy on
 * realtime.messages finds their row in multiplayer_players for that room.
 */
const HEARTBEAT_MS = 10000;
const PING_MS = 2000;
const HOST_GRACE_MS = 20000;

export class RoomSession {
  constructor(svc, room, handlers = {}) {
    this.svc = svc;
    this.sb = svc.sb;
    this.room = room;
    this.me = svc.user.id;
    this.h = handlers; // {onRoom, onPlayers, onPresence, onState, onStart, onFinish, onStatus, onKicked, onClosed, onNotice}
    this.players = [];
    this.online = new Map(); // user_id -> presence meta
    this.status = 'connecting';
    this.rtt = null;
    this.sid = Math.random().toString(36).slice(2, 8); // sender session id: receivers reset sequence tracking when it changes
    this.seq = 0;
    this._pings = new Map();
    this._rtts = [];
    this._closed = false;
    this._hostMissingSince = 0;
    this._meta = {};
  }

  get isHost() {
    return this.room && this.room.host_user_id === this.me;
  }

  async open() {
    await this.refresh();
    this._subscribe();
    this._dbChannel = this.sb
      .channel('room-db:' + this.room.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'multiplayer_rooms', filter: `id=eq.${this.room.id}` }, (p) => this._onRoomRow(p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'multiplayer_players', filter: `room_id=eq.${this.room.id}` }, () => this._refreshPlayers())
      .subscribe();
    this._hb = setInterval(() => this._heartbeat(), HEARTBEAT_MS);
    this._pingTimer = setInterval(() => this._ping(), PING_MS);
    this._heartbeat();
  }

  _subscribe() {
    const ch = (this.channel = this.sb.channel('room:' + this.room.id, {
      config: { private: true, broadcast: { self: false, ack: false }, presence: { key: this.me } },
    }));
    ch.on('presence', { event: 'sync' }, () => this._onPresence())
      .on('broadcast', { event: 's' }, ({ payload }) => this.h.onState && this.h.onState(payload))
      .on('broadcast', { event: 'start' }, ({ payload }) => this._onStartMsg(payload))
      .on('broadcast', { event: 'fin' }, ({ payload }) => this.h.onFinish && this.h.onFinish(payload))
      .on('broadcast', { event: 'ping' }, ({ payload }) => this._onPing(payload))
      .on('broadcast', { event: 'pong' }, ({ payload }) => this._onPong(payload))
      .on('broadcast', { event: 'kick' }, ({ payload }) => payload.user === this.me && this._kicked())
      .on('broadcast', { event: 'close' }, () => this._roomClosed('The host closed the server.'));
    ch.subscribe(async (status, err) => {
      if (this._closed) return;
      if (status === 'SUBSCRIBED') {
        this._setStatus('connected');
        await ch.track(this._presenceMeta());
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        this._setStatus('reconnecting', err && err.message);
        // supabase-js retries the join on its own; if access was revoked (kicked) the membership check fails
        this._verifyMembership();
      } else if (status === 'CLOSED') {
        this._setStatus('offline');
      }
    });
  }

  _setStatus(s, detail) {
    if (this.status === s) return;
    this.status = s;
    this.h.onStatus && this.h.onStatus(s, detail);
  }

  _presenceMeta() {
    const p = this.players.find((x) => x.user_id === this.me) || {};
    return { name: p.display_name || '', car: p.selected_car || '', at: Date.now(), ...this._meta };
  }

  /** Update what others see in presence (e.g. "in race", "in lobby"). */
  async setPresence(meta) {
    Object.assign(this._meta, meta);
    if (this.channel && this.status === 'connected') await this.channel.track(this._presenceMeta());
  }

  _onPresence() {
    const st = this.channel.presenceState();
    const prev = this.online;
    this.online = new Map(Object.entries(st).map(([k, metas]) => [k, metas[metas.length - 1] || {}]));
    for (const k of this.online.keys()) if (!prev.has(k) && k !== this.me) this.h.onNotice && this.h.onNotice('join', k);
    for (const k of prev.keys()) if (!this.online.has(k) && k !== this.me) this.h.onNotice && this.h.onNotice('leave', k);
    this.h.onPresence && this.h.onPresence(this.online);
  }

  async refresh() {
    const room = await this.svc.getRoom(this.room.id);
    if (!room || room.status === 'closed') return this._roomClosed('This server has closed.');
    this.room = room;
    await this._refreshPlayers();
    this.h.onRoom && this.h.onRoom(room);
  }

  async _refreshPlayers() {
    try {
      this.players = await this.svc.getPlayers(this.room.id);
    } catch {
      return;
    }
    if (!this._closed && !this.players.some((p) => p.user_id === this.me)) return this._kicked();
    this.h.onPlayers && this.h.onPlayers(this.players);
  }

  _onRoomRow(p) {
    if (p.eventType === 'DELETE') return this._roomClosed('This server has closed.');
    const prev = this.room;
    this.room = { ...this.room, ...p.new };
    if (this.room.status === 'closed') return this._roomClosed('The host closed the server.');
    if (this.room.race_seq !== prev.race_seq && this.room.race_start_at) this._emitStart(this.room.race_seq, Date.parse(this.room.race_start_at));
    if (prev.host_user_id !== this.room.host_user_id && this.room.host_user_id === this.me) this.h.onNotice && this.h.onNotice('host', this.me);
    this.h.onRoom && this.h.onRoom(this.room);
  }

  // ------------------------------------------------------------------ race start (deduplicated: DB row change + host broadcast)
  _onStartMsg(m) {
    if (m && m.seq) this._emitStart(m.seq, m.at);
  }

  _emitStart(seq, at) {
    if (this._startedSeq >= seq) return;
    this._startedSeq = seq;
    this.h.onStart && this.h.onStart({ seq, at });
  }

  async startRace(delayMs) {
    const r = await this.svc.startRace(this.room.id, delayMs);
    this.room = { ...this.room, ...r };
    const at = Date.parse(r.race_start_at);
    this.channel.send({ type: 'broadcast', event: 'start', payload: { seq: r.race_seq, at } });
    this._emitStart(r.race_seq, at);
  }

  // ------------------------------------------------------------------ gameplay traffic
  sendState(data) {
    if (this.status !== 'connected') return false;
    this.channel.send({ type: 'broadcast', event: 's', payload: { u: this.me, i: this.sid, q: ++this.seq, t: Math.round(this.svc.serverNow()), d: data } });
    return true;
  }

  sendFinish(info) {
    if (this.channel) this.channel.send({ type: 'broadcast', event: 'fin', payload: { u: this.me, ...info } });
  }

  // ------------------------------------------------------------------ ping (real round trip through Realtime to another player)
  _ping() {
    if (this.status !== 'connected' || this.online.size < 2) return;
    const id = Math.random().toString(36).slice(2, 8);
    this._pings.set(id, performance.now());
    if (this._pings.size > 20) this._pings.delete(this._pings.keys().next().value);
    this.channel.send({ type: 'broadcast', event: 'ping', payload: { from: this.me, id } });
  }

  _onPing(m) {
    if (m.from !== this.me) this.channel.send({ type: 'broadcast', event: 'pong', payload: { to: m.from, id: m.id, by: this.me } });
  }

  _onPong(m) {
    if (m.to !== this.me || !this._pings.has(m.id)) return;
    const rtt = performance.now() - this._pings.get(m.id);
    this._pings.delete(m.id);
    this._rtts.push(rtt);
    if (this._rtts.length > 8) this._rtts.shift();
    this.rtt = [...this._rtts].sort((a, b) => a - b)[Math.floor(this._rtts.length / 2)];
  }

  // ------------------------------------------------------------------ heartbeat, host migration
  async _heartbeat() {
    if (this._closed) return;
    try {
      const r = await this.svc.heartbeat(this.room.id);
      if (r) this.room = { ...this.room, ...r };
    } catch (e) {
      if (/not in this room/.test(e.message)) return this._kicked();
      return; // transient network error: try again next beat
    }
    // host gone quiet (closed tab / lost connection)? after a grace period someone takes over
    const hostOnline = this.online.has(this.room.host_user_id);
    if (this.status === 'connected' && !hostOnline && this.room.host_user_id !== this.me) {
      this._hostMissingSince ||= Date.now();
      if (Date.now() - this._hostMissingSince > HOST_GRACE_MS) {
        try {
          const r = await this.svc.claimHost(this.room.id);
          if (r) this.room = { ...this.room, ...r };
          this._hostMissingSince = 0;
          await this._refreshPlayers();
          this.h.onRoom && this.h.onRoom(this.room);
        } catch { /* next beat */ }
      }
    } else this._hostMissingSince = 0;
  }

  async _verifyMembership() {
    try {
      const players = await this.svc.getPlayers(this.room.id);
      if (!players.some((p) => p.user_id === this.me)) this._kicked();
    } catch { /* offline: keep retrying */ }
  }

  async kick(userId) {
    await this.svc.kick(this.room.id, userId);
    this.channel.send({ type: 'broadcast', event: 'kick', payload: { user: userId } });
  }

  async closeRoom() {
    this.channel && this.channel.send({ type: 'broadcast', event: 'close', payload: {} });
    await this.svc.closeRoom(this.room.id);
    this._roomClosed(null);
  }

  _kicked() {
    if (this._closed) return;
    this.dispose();
    this.h.onKicked && this.h.onKicked();
  }

  _roomClosed(msg) {
    if (this._closed) return;
    this.dispose();
    this.h.onClosed && this.h.onClosed(msg);
  }

  /** Leave the room (DB + channel). */
  async leave() {
    const id = this.room.id;
    this.dispose();
    try { await this.svc.leaveRoom(id); } catch { /* the stale-room cleanup will catch it */ }
  }

  dispose() {
    if (this._closed) return;
    this._closed = true;
    clearInterval(this._hb);
    clearInterval(this._pingTimer);
    if (this.channel) { this.channel.untrack().catch(() => {}); this.sb.removeChannel(this.channel); }
    if (this._dbChannel) this.sb.removeChannel(this._dbChannel);
    this.channel = this._dbChannel = null;
    this.status = 'offline';
  }
}
