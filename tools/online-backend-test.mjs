// Live check of the online backend (real Supabase project from .env):
// three independent guest players, RLS/RPCs, private Realtime room channel, Broadcast + Presence.
// Usage: node tools/online-backend-test.mjs
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const URL_ = env.VITE_SUPABASE_URL, KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;
let ok = true;
const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) ok = false; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
const client = () => createClient(URL_, KEY, { auth: { storage: mem(), persistSession: true, autoRefreshToken: false } });

async function guest(name) {
  const sb = client();
  const { data, error } = await sb.auth.signInAnonymously();
  if (error) throw new Error(name + ': ' + error.message);
  await sb.realtime.setAuth();
  return { sb, id: data.user.id, name };
}
const rpc = async (p, fn, args) => { const { data, error } = await p.sb.rpc(fn, args); if (error) throw new Error(error.message); return data; };
const rpcFails = async (p, fn, args) => { const { error } = await p.sb.rpc(fn, args); return !!error; };

const A = await guest('Host'), B = await guest('Friend'), C = await guest('Stranger');
check(A.id && B.id && C.id && new Set([A.id, B.id, C.id]).size === 3, 'three independent anonymous guest identities');

const t0 = performance.now(); const srv = await rpc(A, 'mp_server_time'); const t1 = performance.now();
check(Math.abs(srv - (Date.now() - (t1 - t0) / 2)) < 5000, `server clock reachable (RTT ${(t1 - t0).toFixed(0)} ms)`);

const room = await rpc(A, 'mp_create_room', { p_name: 'QA Monaco', p_host_name: 'Host', p_track: 'monaco', p_era: '2020', p_laps: 2, p_max_players: 4, p_visibility: 'public', p_password: null, p_car: '2020-ferrari', p_team: 'ferrari' });
check(room && room.room_code && room.player_count === 1, `public room created (code ${room.room_code})`);
const list = await rpc(C, 'mp_list_rooms');
check(list.some((r) => r.id === room.id), 'room appears in the live server list');

// live server-browser subscription (postgres_changes) sees the join
let listEvents = 0;
const watch = C.sb.channel('room-list').on('postgres_changes', { event: '*', schema: 'public', table: 'multiplayer_rooms' }, () => listEvents++);
await new Promise((res) => watch.subscribe((s) => s === 'SUBSCRIBED' && res()));
await sleep(4000); // change feeds need a moment after SUBSCRIBED
await rpc(B, 'mp_join_room', { p_room: room.id, p_code: null, p_password: null, p_name: 'Friend', p_car: '2020-mclaren', p_team: 'mclaren' });
await sleep(2500);
check(listEvents > 0, `server browser received ${listEvents} live update(s) when a player joined`);
const { data: pl } = await B.sb.from('multiplayer_players').select('*').eq('room_id', room.id);
check(pl && pl.length === 2, 'both players visible in the lobby');
const { data: plC } = await C.sb.from('multiplayer_players').select('*').eq('room_id', room.id);
check(plC && plC.length === 0, 'outsider cannot read lobby player details');
const { error: updErr } = await B.sb.from('multiplayer_players').update({ ready_status: true }).eq('room_id', room.id).eq('user_id', B.id);
check(!updErr, 'friend sets READY');
check(await rpcFails(B, 'mp_start_race', { p_room: room.id, p_delay_ms: 9000 }), 'only the host can start');

// private room channel: Presence + Broadcast between host and friend; stranger refused
const join = (p) => new Promise((res) => {
  const ch = p.sb.channel('room:' + room.id, { config: { private: true, broadcast: { self: false }, presence: { key: p.id } } });
  const got = { s: [], presence: null };
  ch.on('broadcast', { event: 's' }, ({ payload }) => got.s.push(payload))
    .on('presence', { event: 'sync' }, () => (got.presence = Object.keys(ch.presenceState())));
  const timer = setTimeout(() => res({ ch, got, status: 'TIMEOUT' }), 12000);
  ch.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') { clearTimeout(timer); await ch.track({ name: p.name }); res({ ch, got, status }); }
    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { clearTimeout(timer); res({ ch, got, status }); }
  });
});
const [ja, jb, jc] = await Promise.all([join(A), join(B), join(C)]);
check(ja.status === 'SUBSCRIBED' && jb.status === 'SUBSCRIBED', 'host and friend join the private room channel');
check(jc.status !== 'SUBSCRIBED', `stranger is refused on the private room channel (${jc.status})`);
await sleep(2000);
check(ja.got.presence && ja.got.presence.includes(B.id) && ja.got.presence.includes(A.id), 'Presence shows both connected players');
for (let i = 1; i <= 20; i++) { ja.ch.send({ type: 'broadcast', event: 's', payload: { u: A.id, q: i, d: [i, 0, 0] } }); await sleep(70); }
await sleep(1500);
const seqs = jb.got.s.map((m) => m.q);
check(seqs.length >= 18, `friend received ${seqs.length}/20 car-state broadcasts at ~14 Hz`);
check(seqs.every((q, i) => i === 0 || q > seqs[i - 1]), 'broadcasts arrive in order');

// host starts: the start instant comes from the DB clock
const st = await rpc(A, 'mp_start_race', { p_room: room.id, p_delay_ms: 9000 });
const ahead = Date.parse(st.race_start_at) - srv - (performance.now() - t1);
check(st.status === 'countdown' && ahead > 6000 && ahead < 12000, `race start fixed ${(ahead / 1000).toFixed(1)} s ahead on the server clock`);
await rpc(A, 'mp_submit_result', { p_room: room.id, p_race_seq: st.race_seq, p_position: 1, p_best_lap: 80.1, p_total: 170.2 });
const { data: res } = await B.sb.from('race_results').select('*').eq('room_id', room.id);
check(res && res.length === 1, 'race result saved and visible to room members');

// private room via invite code
const pr = await rpc(C, 'mp_create_room', { p_name: 'QA private', p_host_name: 'Stranger', p_track: 'spa', p_era: '1990s-late', p_laps: 3, p_max_players: 8, p_visibility: 'private', p_password: 'pitwall', p_car: '1990s-late-ferrari', p_team: 'ferrari' });
check(!(await rpc(B, 'mp_list_rooms')).some((r) => r.id === pr.id), 'private room is hidden from the server list');
check(await rpcFails(B, 'mp_join_room', { p_room: null, p_code: pr.room_code, p_password: 'nope', p_name: 'Friend', p_car: '', p_team: '' }), 'wrong password rejected');
const pj = await rpc(B, 'mp_join_room', { p_room: null, p_code: pr.room_code, p_password: 'pitwall', p_name: 'Friend', p_car: '1990s-late-mclaren', p_team: 'mclaren' });
check(pj.id === pr.id, 'invite code + password joins the private room');

// host leaves -> migration; cleanup
await rpc(C, 'mp_leave_room', { p_room: pr.id });
const { data: prRow } = await B.sb.from('multiplayer_rooms').select('host_user_id, status').eq('id', pr.id).single();
check(prRow.host_user_id === B.id, 'host left: the remaining player became host');
await rpc(B, 'mp_close_room', { p_room: pr.id });
check(!(await rpc(A, 'mp_list_rooms')).some((r) => r.id === pr.id), 'closed room disappears');
const before = listEvents;
await rpc(A, 'mp_close_room', { p_room: room.id });
await sleep(3000);
check(listEvents > before, 'server browser is notified live when a room closes');
check(!(await rpc(C, 'mp_list_rooms')).some((r) => r.id === room.id), 'host ends the session: room removed from the list');

for (const p of [A, B, C]) await p.sb.removeAllChannels();
console.log(ok ? '\nALL LIVE BACKEND CHECKS PASSED' : '\nSOME CHECKS FAILED');
process.exit(ok ? 0 : 1);
