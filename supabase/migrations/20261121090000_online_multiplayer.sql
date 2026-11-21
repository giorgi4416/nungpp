-- =====================================================================================
-- HUNGARORING GP · online multiplayer
--
-- Postgres holds room metadata, membership, host ownership and results.
-- Live racing data never touches these tables: it travels over Supabase Realtime
-- (Broadcast for car state / race events, Presence for who is connected) on the
-- private channel  room:<room id>,  which only members of that room may join.
--
-- Clients never write the tables directly: every change goes through the
-- SECURITY DEFINER functions below, which check auth.uid() for membership and
-- host ownership. Players are guests (Supabase anonymous sign-in).
-- =====================================================================================

create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------------ tables
create table public.multiplayer_rooms (
  id              uuid primary key default gen_random_uuid(),
  room_code       text not null unique check (room_code ~ '^[A-Z2-9]{6}$'),
  name            text not null check (char_length(name) between 1 and 40),
  host_user_id    uuid not null references auth.users (id) on delete cascade,
  host_name       text not null check (char_length(host_name) between 1 and 20),
  track_id        text not null check (track_id in ('hungaroring', 'monaco', 'spa', 'suzuka')),
  car_era         text not null check (car_era in ('2020', '2000s-v10', '2000s-v8', '1990s-early', '1990s-mid', '1990s-late')),
  laps            smallint not null default 3 check (laps between 1 and 20),
  max_players     smallint not null default 8 check (max_players between 2 and 8),
  visibility      text not null default 'public' check (visibility in ('public', 'private')),
  has_password    boolean not null default false,
  status          text not null default 'waiting' check (status in ('waiting', 'countdown', 'racing', 'finished', 'closed')),
  race_start_at   timestamptz,
  race_seq        integer not null default 0,
  player_count    smallint not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_heartbeat  timestamptz not null default now()
);

-- room passwords (bcrypt) live apart from the readable room row; no client role can read this table
create table public.multiplayer_room_secrets (
  room_id         uuid primary key references public.multiplayer_rooms (id) on delete cascade,
  password_hash   text not null
);

create table public.multiplayer_players (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references public.multiplayer_rooms (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  display_name    text not null check (char_length(display_name) between 1 and 20),
  selected_team   text not null default '' check (char_length(selected_team) <= 40),
  selected_car    text not null default '' check (char_length(selected_car) <= 40),
  ready_status    boolean not null default false,
  grid_slot       smallint not null default 0,
  joined_at       timestamptz not null default now(),
  last_seen       timestamptz not null default now(),
  unique (room_id, user_id)
);

create table public.race_results (
  id                 uuid primary key default gen_random_uuid(),
  room_id            uuid not null references public.multiplayer_rooms (id) on delete cascade,
  race_seq           integer not null,
  user_id            uuid not null references auth.users (id) on delete cascade,
  display_name       text not null,
  selected_car       text not null default '',
  finishing_position smallint not null check (finishing_position between 1 and 8),
  best_lap           real check (best_lap > 0),
  total_time         real check (total_time > 0),
  created_at         timestamptz not null default now(),
  unique (room_id, race_seq, user_id)
);

create index multiplayer_rooms_listing_idx on public.multiplayer_rooms (visibility, status, last_heartbeat desc);
create index multiplayer_rooms_host_idx on public.multiplayer_rooms (host_user_id);
create index multiplayer_players_room_idx on public.multiplayer_players (room_id, joined_at);
create index multiplayer_players_user_idx on public.multiplayer_players (user_id);
create index race_results_room_idx on public.race_results (room_id, race_seq);

-- ------------------------------------------------------------------ helpers
create or replace function public.mp_is_member(p_room uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.multiplayer_players p where p.room_id = p_room and p.user_id = auth.uid());
$$;

create or replace function public.mp_clean_name(p text, p_default text)
returns text language sql immutable as $$
  select coalesce(nullif(left(regexp_replace(btrim(coalesce(p, '')), '[[:cntrl:]<>]', '', 'g'), 20), ''), p_default);
$$;

-- keep multiplayer_rooms.player_count in sync (also makes the room row change, so the
-- live server browser - subscribed to multiplayer_rooms - updates on join / leave)
create or replace function public.mp_sync_player_count()
returns trigger language plpgsql security definer set search_path = public as $$
declare r uuid := coalesce(new.room_id, old.room_id);
begin
  update public.multiplayer_rooms
     set player_count = (select count(*) from public.multiplayer_players where room_id = r), updated_at = now()
   where id = r;
  return null;
end $$;

create trigger mp_player_count after insert or delete on public.multiplayer_players
for each row execute function public.mp_sync_player_count();

-- rooms whose host stopped sending heartbeats are closed; old closed rooms are deleted
create or replace function public.mp_cleanup_stale()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.multiplayer_rooms set status = 'closed', updated_at = now()
   where status <> 'closed' and last_heartbeat < now() - interval '90 seconds';
  delete from public.multiplayer_rooms
   where (status = 'closed' and updated_at < now() - interval '30 minutes')
      or created_at < now() - interval '12 hours';
end $$;

-- ------------------------------------------------------------------ RLS
alter table public.multiplayer_rooms enable row level security;
alter table public.multiplayer_players enable row level security;
alter table public.race_results enable row level security;
alter table public.multiplayer_room_secrets enable row level security;

-- public rooms are discoverable; private rooms only by their members
create policy "rooms readable: public or member" on public.multiplayer_rooms
  for select to authenticated
  using ((visibility = 'public' and status <> 'closed') or public.mp_is_member(id));

-- player rows (names, cars, ready state) are only visible inside the room
create policy "players readable by room members" on public.multiplayer_players
  for select to authenticated using (public.mp_is_member(room_id));

-- a player may change only their own car / ready state (columns limited by the grant below)
create policy "players update own row" on public.multiplayer_players
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "results readable by room members" on public.race_results
  for select to authenticated using (public.mp_is_member(room_id));

-- no direct inserts / deletes / room updates: those go through the functions below
revoke all on public.multiplayer_rooms, public.multiplayer_players, public.race_results, public.multiplayer_room_secrets from anon, authenticated;
grant select on public.multiplayer_rooms, public.multiplayer_players, public.race_results to authenticated;
grant update (selected_team, selected_car, ready_status, last_seen) on public.multiplayer_players to authenticated;

-- ------------------------------------------------------------------ API (RPC)
create or replace function public.mp_server_time()
returns double precision language sql stable as $$ select extract(epoch from clock_timestamp()) * 1000 $$;

create or replace function public.mp_new_code()
returns text language plpgsql volatile as $$
declare alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; c text; i int;
begin
  loop
    c := '';
    for i in 1..6 loop c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    exit when not exists (select 1 from public.multiplayer_rooms where room_code = c);
  end loop;
  return c;
end $$;

create or replace function public.mp_create_room(
  p_name text, p_host_name text, p_track text, p_era text, p_laps int, p_max_players int,
  p_visibility text, p_password text, p_car text, p_team text)
returns public.multiplayer_rooms language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); r public.multiplayer_rooms; hn text := public.mp_clean_name(p_host_name, 'Driver');
begin
  if uid is null then raise exception 'not signed in'; end if;
  perform public.mp_cleanup_stale();
  -- one live room per host: leave / close anything this user is still in
  perform public.mp_leave_all(uid);
  insert into public.multiplayer_rooms (room_code, name, host_user_id, host_name, track_id, car_era, laps, max_players,
                                        visibility, has_password)
  values (public.mp_new_code(), public.mp_clean_name(p_name, hn || '''s race'), uid, hn, p_track, p_era,
          greatest(1, least(20, coalesce(p_laps, 3))), greatest(2, least(8, coalesce(p_max_players, 8))),
          case when p_visibility = 'private' then 'private' else 'public' end,
          coalesce(p_password, '') <> '')
  returning * into r;
  if coalesce(p_password, '') <> '' then
    insert into public.multiplayer_room_secrets (room_id, password_hash) values (r.id, crypt(left(p_password, 64), gen_salt('bf')));
  end if;
  insert into public.multiplayer_players (room_id, user_id, display_name, selected_team, selected_car, grid_slot)
  values (r.id, uid, hn, coalesce(p_team, ''), coalesce(p_car, ''), 0);
  select * into r from public.multiplayer_rooms where id = r.id;
  return r;
end $$;

-- join by room id (server browser) or by invite code (private rooms). Idempotent for members (reconnect).
create or replace function public.mp_join_room(p_room uuid, p_code text, p_password text, p_name text, p_car text, p_team text)
returns public.multiplayer_rooms language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); r public.multiplayer_rooms; n int; slot int;
begin
  if uid is null then raise exception 'not signed in'; end if;
  perform public.mp_cleanup_stale();
  if p_room is not null then
    select * into r from public.multiplayer_rooms where id = p_room for update;
    if found and r.visibility = 'private' and not exists (select 1 from public.multiplayer_players where room_id = r.id and user_id = uid)
       and upper(coalesce(p_code, '')) <> r.room_code then
      raise exception 'private room: use the invite code';
    end if;
  else
    select * into r from public.multiplayer_rooms where room_code = upper(btrim(coalesce(p_code, ''))) for update;
  end if;
  if not found or r.status = 'closed' then raise exception 'room not found or closed'; end if;
  if exists (select 1 from public.multiplayer_players where room_id = r.id and user_id = uid) then
    update public.multiplayer_players set last_seen = now() where room_id = r.id and user_id = uid;
  else
    if r.status <> 'waiting' then raise exception 'race already in progress'; end if;
    if r.has_password and not exists (select 1 from public.multiplayer_room_secrets sc
                                        where sc.room_id = r.id and sc.password_hash = crypt(coalesce(p_password, ''), sc.password_hash)) then
      raise exception 'wrong password';
    end if;
    select count(*) into n from public.multiplayer_players where room_id = r.id;
    if n >= r.max_players then raise exception 'room is full'; end if;
    perform public.mp_leave_all(uid);
    select min(s) into slot from generate_series(0, 7) s
     where s not in (select grid_slot from public.multiplayer_players where room_id = r.id);
    insert into public.multiplayer_players (room_id, user_id, display_name, selected_team, selected_car, grid_slot)
    values (r.id, uid, public.mp_clean_name(p_name, 'Driver'), coalesce(p_team, ''), coalesce(p_car, ''), coalesce(slot, n));
  end if;
  select * into r from public.multiplayer_rooms where id = r.id;
  return r;
end $$;

-- leave one room; the host leaving hands the room to the longest-waiting player, or closes it when empty
create or replace function public.mp_leave_room(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r public.multiplayer_rooms; nxt public.multiplayer_players;
begin
  select * into r from public.multiplayer_rooms where id = p_room for update;
  if not found then return; end if;
  delete from public.multiplayer_players where room_id = p_room and user_id = uid;
  if r.host_user_id = uid then
    select * into nxt from public.multiplayer_players where room_id = p_room order by joined_at limit 1;
    if found then
      update public.multiplayer_rooms set host_user_id = nxt.user_id, host_name = nxt.display_name, updated_at = now(), last_heartbeat = now()
       where id = p_room;
    else
      update public.multiplayer_rooms set status = 'closed', updated_at = now() where id = p_room;
    end if;
  elsif not exists (select 1 from public.multiplayer_players where room_id = p_room) then
    update public.multiplayer_rooms set status = 'closed', updated_at = now() where id = p_room;
  end if;
end $$;

create or replace function public.mp_leave_all(p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if p_uid is distinct from auth.uid() then raise exception 'not allowed'; end if;
  for rid in select room_id from public.multiplayer_players where user_id = p_uid loop
    perform public.mp_leave_room(rid);
  end loop;
end $$;

-- host: change track / era / laps / slots / visibility while waiting
create or replace function public.mp_update_room(p_room uuid, p_name text, p_track text, p_era text, p_laps int, p_max_players int, p_visibility text)
returns public.multiplayer_rooms language plpgsql security definer set search_path = public as $$
declare r public.multiplayer_rooms;
begin
  select * into r from public.multiplayer_rooms where id = p_room for update;
  if not found or r.host_user_id <> auth.uid() then raise exception 'only the host can change the room'; end if;
  if r.status not in ('waiting', 'finished') then raise exception 'race in progress'; end if;
  update public.multiplayer_rooms set
      name = public.mp_clean_name(coalesce(p_name, r.name), r.name),
      track_id = coalesce(p_track, r.track_id),
      car_era = coalesce(p_era, r.car_era),
      laps = greatest(1, least(20, coalesce(p_laps, r.laps))),
      max_players = greatest(r.player_count, greatest(2, least(8, coalesce(p_max_players, r.max_players)))),
      visibility = case when p_visibility in ('public', 'private') then p_visibility else r.visibility end,
      status = 'waiting', updated_at = now(), last_heartbeat = now()
   where id = p_room returning * into r;
  -- any change to the race invalidates the other players' ready state
  update public.multiplayer_players set ready_status = false where room_id = p_room and user_id <> auth.uid();
  return r;
end $$;

create or replace function public.mp_kick_player(p_room uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.multiplayer_rooms where id = p_room and host_user_id = auth.uid()) then
    raise exception 'only the host can remove players';
  end if;
  if p_user = auth.uid() then raise exception 'the host cannot remove themselves'; end if;
  delete from public.multiplayer_players where room_id = p_room and user_id = p_user;
end $$;

-- host: start. The start instant is fixed on the database clock so every client
-- (synchronised to mp_server_time) releases the cars together.
create or replace function public.mp_start_race(p_room uuid, p_delay_ms int default 9000)
returns public.multiplayer_rooms language plpgsql security definer set search_path = public as $$
declare r public.multiplayer_rooms;
begin
  select * into r from public.multiplayer_rooms where id = p_room for update;
  if not found or r.host_user_id <> auth.uid() then raise exception 'only the host can start the race'; end if;
  if r.status not in ('waiting', 'finished') then raise exception 'race already started'; end if;
  update public.multiplayer_rooms
     set status = 'countdown', race_seq = race_seq + 1,
         race_start_at = clock_timestamp() + make_interval(secs => greatest(4000, least(20000, p_delay_ms)) / 1000.0),
         updated_at = now(), last_heartbeat = now()
   where id = p_room returning * into r;
  update public.multiplayer_players set ready_status = false where room_id = p_room;
  return r;
end $$;

create or replace function public.mp_set_status(p_room uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('racing', 'finished', 'waiting') then raise exception 'bad status'; end if;
  update public.multiplayer_rooms set status = p_status, updated_at = now(), last_heartbeat = now()
   where id = p_room and host_user_id = auth.uid();
end $$;

create or replace function public.mp_close_room(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.multiplayer_rooms set status = 'closed', updated_at = now()
   where id = p_room and host_user_id = auth.uid();
  if not found then raise exception 'only the host can close the room'; end if;
  delete from public.multiplayer_players where room_id = p_room;
end $$;

-- every member pings ~every 15 s; the host's ping keeps the room alive
create or replace function public.mp_heartbeat(p_room uuid)
returns public.multiplayer_rooms language plpgsql security definer set search_path = public as $$
declare r public.multiplayer_rooms;
begin
  update public.multiplayer_players set last_seen = now() where room_id = p_room and user_id = auth.uid();
  if not found then raise exception 'not in this room'; end if;
  update public.multiplayer_rooms set last_heartbeat = now() where id = p_room and host_user_id = auth.uid();
  select * into r from public.multiplayer_rooms where id = p_room;
  return r;
end $$;

-- host migration: when the host has gone silent, the longest-waiting active player takes over
create or replace function public.mp_claim_host(p_room uuid)
returns public.multiplayer_rooms language plpgsql security definer set search_path = public as $$
declare r public.multiplayer_rooms; nxt public.multiplayer_players;
begin
  if not public.mp_is_member(p_room) then raise exception 'not in this room'; end if;
  select * into r from public.multiplayer_rooms where id = p_room for update;
  if exists (select 1 from public.multiplayer_players where room_id = p_room and user_id = r.host_user_id and last_seen > now() - interval '25 seconds') then
    return r; -- host still alive
  end if;
  select * into nxt from public.multiplayer_players
   where room_id = p_room and last_seen > now() - interval '25 seconds' order by joined_at limit 1;
  if found then
    delete from public.multiplayer_players where room_id = p_room and user_id = r.host_user_id;
    update public.multiplayer_rooms set host_user_id = nxt.user_id, host_name = nxt.display_name, last_heartbeat = now(), updated_at = now()
     where id = p_room returning * into r;
  end if;
  return r;
end $$;

create or replace function public.mp_submit_result(p_room uuid, p_race_seq int, p_position int, p_best_lap real, p_total real)
returns void language plpgsql security definer set search_path = public as $$
declare pl public.multiplayer_players;
begin
  select * into pl from public.multiplayer_players where room_id = p_room and user_id = auth.uid();
  if not found then raise exception 'not in this room'; end if;
  insert into public.race_results (room_id, race_seq, user_id, display_name, selected_car, finishing_position, best_lap, total_time)
  values (p_room, p_race_seq, auth.uid(), pl.display_name, pl.selected_car, greatest(1, least(8, p_position)),
          nullif(p_best_lap, 0), nullif(p_total, 0))
  on conflict (room_id, race_seq, user_id) do nothing;
end $$;

-- server browser: public, live rooms only (no player details)
create or replace function public.mp_list_rooms()
returns table (id uuid, name text, host_name text, track_id text, car_era text, laps smallint, max_players smallint,
               player_count smallint, status text, has_password boolean, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  perform public.mp_cleanup_stale();
  return query
    select r.id, r.name, r.host_name, r.track_id, r.car_era, r.laps, r.max_players, r.player_count, r.status, r.has_password, r.created_at
      from public.multiplayer_rooms r
     where r.visibility = 'public' and r.status <> 'closed' and r.last_heartbeat > now() - interval '90 seconds'
     order by (r.status = 'waiting') desc, r.created_at desc
     limit 100;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.mp_is_member(uuid) to authenticated; -- used inside the RLS policies
grant execute on function public.mp_server_time(), public.mp_create_room(text, text, text, text, int, int, text, text, text, text),
  public.mp_join_room(uuid, text, text, text, text, text), public.mp_leave_room(uuid), public.mp_update_room(uuid, text, text, text, int, int, text),
  public.mp_kick_player(uuid, uuid), public.mp_start_race(uuid, int), public.mp_set_status(uuid, text), public.mp_close_room(uuid),
  public.mp_heartbeat(uuid), public.mp_claim_host(uuid), public.mp_submit_result(uuid, int, int, real, real), public.mp_list_rooms()
  to authenticated;

-- ------------------------------------------------------------------ Realtime
-- live server browser + lobby list (row changes are filtered by the RLS policies above)
alter publication supabase_realtime add table public.multiplayer_rooms, public.multiplayer_players;

-- private room channels: only members of room <id> may receive or send on topic "room:<id>"
create policy "room members receive room channel" on realtime.messages
  for select to authenticated
  using (
    realtime.topic() like 'room:%'
    and exists (select 1 from public.multiplayer_players p
                 where p.user_id = auth.uid() and 'room:' || p.room_id::text = realtime.topic())
  );

create policy "room members send on room channel" on realtime.messages
  for insert to authenticated
  with check (
    realtime.topic() like 'room:%'
    and exists (select 1 from public.multiplayer_players p
                 where p.user_id = auth.uid() and 'room:' || p.room_id::text = realtime.topic())
  );
