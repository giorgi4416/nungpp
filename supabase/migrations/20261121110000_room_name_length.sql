-- Server names may be up to 40 characters (they were cut to 20 by the shared name cleaner).
-- The cleaner now allows 40; player / host names keep their 20-character limit via BEFORE
-- triggers, which run before the length CHECK constraints.
create or replace function public.mp_clean_name(p text, p_default text)
returns text language sql immutable as $$
  select coalesce(nullif(left(regexp_replace(btrim(coalesce(p, '')), '[[:cntrl:]<>]', '', 'g'), 40), ''), p_default);
$$;

create or replace function public.mp_trim_player_name()
returns trigger language plpgsql as $$
begin
  new.display_name := left(new.display_name, 20);
  return new;
end $$;

create or replace function public.mp_trim_host_name()
returns trigger language plpgsql as $$
begin
  new.host_name := left(new.host_name, 20);
  return new;
end $$;

create trigger mp_trim_player_name before insert or update of display_name on public.multiplayer_players
for each row execute function public.mp_trim_player_name();
create trigger mp_trim_host_name before insert or update of host_name on public.multiplayer_rooms
for each row execute function public.mp_trim_host_name();
