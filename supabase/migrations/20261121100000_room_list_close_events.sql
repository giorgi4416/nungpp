-- The live server browser must also hear about rooms that close. With the original policy a
-- closed public room became invisible to non-members, so Realtime never delivered that change.
-- Public room rows stay readable (they hold no private data; mp_list_rooms still filters out
-- closed / stale rooms, and closed rooms are deleted after 30 minutes by mp_cleanup_stale).
drop policy "rooms readable: public or member" on public.multiplayer_rooms;
create policy "rooms readable: public or member" on public.multiplayer_rooms
  for select to authenticated
  using (visibility = 'public' or public.mp_is_member(id));
