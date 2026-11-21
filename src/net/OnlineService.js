import { createClient } from '@supabase/supabase-js';

/**
 * Supabase backend for online racing.
 *  - Auth: guests sign in anonymously (a real auth.users identity, so nobody can act as someone else).
 *  - Postgres (via RPC functions that check ownership/membership server-side): rooms, players, results.
 *  - Realtime postgres_changes: the live server browser / lobby list.
 *  - Clock: offset to the database clock, so race starts line up across machines.
 * Live racing traffic lives in RoomSession (Realtime Broadcast + Presence).
 */
const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const onlineConfigured = () => !!(URL && KEY);

function tabStorage() {
  const mem = new Map();
  try {
    const t = window.sessionStorage;
    t.setItem('hgp-probe', '1');
    t.removeItem('hgp-probe');
    return t;
  } catch {
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  }
}

export class OnlineService {
  constructor() {
    this.sb = null;
    this.user = null;
    this.clockOffset = 0; // serverMs = performance.now() + clockOffset
    this.clockRtt = null;
    this._listSub = null;
  }

  get ready() {
    return !!this.user;
  }

  /** Sign in (or restore the stored guest session). */
  async connect() {
    if (!onlineConfigured()) throw new Error('Online racing is not configured on this build (missing Supabase settings).');
    if (!this.sb) {
      this.sb = createClient(URL, KEY, {
        // per TAB identity (sessionStorage): two tabs / windows = two different players, while a
        // reload of the same tab keeps its seat in the room
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'hgp-online-auth', storage: tabStorage() },
        realtime: { params: { eventsPerSecond: 30 }, heartbeatIntervalMs: 15000 },
      });
    }
    if (this.user) return this.user;
    const { data: s } = await this.sb.auth.getSession();
    let user = s.session && s.session.user;
    if (!user) {
      const { data, error } = await this.sb.auth.signInAnonymously();
      if (error) throw new Error('Could not sign in as a guest: ' + error.message);
      user = data.user;
    }
    this.user = user;
    await this.sb.realtime.setAuth();
    await this.syncClock();
    return user;
  }

  /** NTP-style offset to the Postgres clock: best of a few samples (lowest round trip). */
  async syncClock(samples = 5) {
    let best = null;
    for (let i = 0; i < samples; i++) {
      const t0 = performance.now();
      const { data, error } = await this.sb.rpc('mp_server_time');
      const t1 = performance.now();
      if (error || typeof data !== 'number') continue;
      const rtt = t1 - t0;
      if (!best || rtt < best.rtt) best = { rtt, offset: data - (t0 + t1) / 2 };
    }
    if (best) {
      this.clockOffset = best.offset;
      this.clockRtt = best.rtt;
    }
    return best;
  }

  serverNow() {
    return performance.now() + this.clockOffset;
  }

  async _rpc(fn, args) {
    const { data, error } = await this.sb.rpc(fn, args);
    if (error) throw new Error(friendly(error.message));
    return data;
  }

  listRooms() {
    return this._rpc('mp_list_rooms');
  }

  createRoom(o) {
    return this._rpc('mp_create_room', {
      p_name: o.name, p_host_name: o.hostName, p_track: o.track, p_era: o.era, p_laps: o.laps, p_max_players: o.maxPlayers,
      p_visibility: o.visibility, p_password: o.password || null, p_car: o.car, p_team: o.team,
    });
  }

  joinRoom({ roomId = null, code = null, password = null, name, car, team }) {
    return this._rpc('mp_join_room', { p_room: roomId, p_code: code, p_password: password, p_name: name, p_car: car, p_team: team });
  }

  leaveRoom(roomId) { return this._rpc('mp_leave_room', { p_room: roomId }); }
  updateRoom(roomId, o) {
    return this._rpc('mp_update_room', { p_room: roomId, p_name: o.name ?? null, p_track: o.track ?? null, p_era: o.era ?? null, p_laps: o.laps ?? null, p_max_players: o.maxPlayers ?? null, p_visibility: o.visibility ?? null });
  }
  kick(roomId, userId) { return this._rpc('mp_kick_player', { p_room: roomId, p_user: userId }); }
  startRace(roomId, delayMs) { return this._rpc('mp_start_race', { p_room: roomId, p_delay_ms: delayMs }); }
  setStatus(roomId, status) { return this._rpc('mp_set_status', { p_room: roomId, p_status: status }); }
  closeRoom(roomId) { return this._rpc('mp_close_room', { p_room: roomId }); }
  heartbeat(roomId) { return this._rpc('mp_heartbeat', { p_room: roomId }); }
  claimHost(roomId) { return this._rpc('mp_claim_host', { p_room: roomId }); }
  submitResult(roomId, seq, position, bestLap, total) {
    return this._rpc('mp_submit_result', { p_room: roomId, p_race_seq: seq, p_position: position, p_best_lap: bestLap || 0, p_total: total || 0 });
  }

  async getRoom(roomId) {
    const { data, error } = await this.sb.from('multiplayer_rooms').select('*').eq('id', roomId).maybeSingle();
    if (error) throw new Error(friendly(error.message));
    return data;
  }

  async getPlayers(roomId) {
    const { data, error } = await this.sb.from('multiplayer_players').select('*').eq('room_id', roomId).order('joined_at');
    if (error) throw new Error(friendly(error.message));
    return data || [];
  }

  async updateMyPlayer(roomId, fields) {
    const { error } = await this.sb.from('multiplayer_players').update(fields).eq('room_id', roomId).eq('user_id', this.user.id);
    if (error) throw new Error(friendly(error.message));
  }

  /** Live server browser: calls onChange whenever any visible room row changes. */
  watchRoomList(onChange) {
    this.unwatchRoomList();
    this._listSub = this.sb
      .channel('room-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'multiplayer_rooms' }, () => onChange())
      .subscribe();
  }

  unwatchRoomList() {
    if (this._listSub) this.sb.removeChannel(this._listSub);
    this._listSub = null;
  }
}

function friendly(msg) {
  const m = String(msg || '');
  if (/fetch|network/i.test(m)) return 'Network error: check your connection.';
  return m.replace(/^.*?exception:?\s*/i, '');
}
