-- Sync fixes after review (v71):
--   • the limits counted the row being written too, so an upsert of an existing song (a re-push)
--     failed once the account held 10: count only the *other* rows;
--   • take histories become their own kind ('history', id = song id) — merged, not replaced —
--     and a song's settings are split into one row per field (song_state ids "<song>|key",
--     "<song>|rate", "<song>|timing"), so a change to one doesn't undo another device's change
--     to another.

alter table public.sync_items drop constraint sync_items_kind_check;
alter table public.sync_items add constraint sync_items_kind_check
  check (kind in ('song', 'song_state', 'history', 'take', 'profile', 'prefs'));

create or replace function private.sync_count(uid uuid, k text, ek text, eid text) returns integer
  language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.sync_items
  where user_id = uid and not deleted and (k is null or kind = k)
    and not (kind = ek and id = eid)
$$;
revoke all on function private.sync_count(uuid, text, text, text) from public, anon, authenticated;
grant execute on function private.sync_count(uuid, text, text, text) to authenticated;

create or replace function private.sync_items_write() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.modified_at <= old.modified_at then
      return null; -- last writer wins: the stored row is newer (or the same change again)
    end if;
    new.user_id := old.user_id;
  end if;
  new.updated_at := now();
  if new.deleted then
    new.data := null;
  elsif tg_op = 'INSERT' or old.deleted then -- a row that starts to count (not counting itself)
    if new.kind = 'song' and private.sync_count(new.user_id, 'song', new.kind, new.id) >= 10 then
      raise exception 'song limit reached (10)' using errcode = 'P0001', hint = 'resonate:limit:song';
    elsif new.kind = 'profile' and private.sync_count(new.user_id, 'profile', new.kind, new.id) >= 20 then
      raise exception 'profile limit reached (20)' using errcode = 'P0001', hint = 'resonate:limit:profile';
    elsif private.sync_count(new.user_id, null, new.kind, new.id) >= 600 then
      raise exception 'item limit reached (600)' using errcode = 'P0001', hint = 'resonate:limit:items';
    end if;
  end if;
  return new;
end $$;

drop function private.sync_count(uuid, text);
