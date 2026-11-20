-- Sync limits for the song library (v90, docs/LIBRARY.md §7): 20 songs (was 10) and 60 files
-- (was 40: 20 songs × MusicXML + PDF, with room for leftovers still to be removed and for a
-- storage upsert that may be checked as an insert at the cap). public/sync.js SONG_LIMIT = 20 —
-- apply this before that ships (else songs 11–20 go up, are refused, and try again every pass).
--
-- It also folds in 20261108200000_sync_fixes.sql (never applied): the limits count only the
-- *other* rows, so a row already in the cloud pushed again at a limit (an upsert runs the INSERT
-- trigger first, even for a row that exists) isn't refused as an insert.
-- Applies whichever of the two is live: create or replace keeps the trigger's binding and the
-- grants; the 2-argument private.sync_count (when it's there) is left as it is, unused. No drops.
-- Profiles (20), rows (400), 3 MB a document and 10 MB a file are unchanged.

create or replace function private.sync_count(uid uuid, k text, ek text, eid text) returns integer
  language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.sync_items
  where user_id = uid and not deleted and (k is null or kind = k)
    and not (kind = ek and id = eid)
$$;
revoke all on function private.sync_count(uuid, text, text, text) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.sync_count(uuid, text, text, text) to authenticated;

-- Every write: server time; an older change than the stored one is dropped; limits.
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
    if new.kind = 'song' and private.sync_count(new.user_id, 'song', new.kind, new.id) >= 20 then
      raise exception 'song limit reached (20)' using errcode = 'P0001', hint = 'resonate:limit:song';
    elsif new.kind = 'profile' and private.sync_count(new.user_id, 'profile', new.kind, new.id) >= 20 then
      raise exception 'profile limit reached (20)' using errcode = 'P0001', hint = 'resonate:limit:profile';
    elsif private.sync_count(new.user_id, null, new.kind, new.id) >= 400 then
      raise exception 'item limit reached (400)' using errcode = 'P0001', hint = 'resonate:limit:items';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.sync_items_write() from public, anon, authenticated;

-- Song files: 60 per account.
alter policy "songs: approved users add files" on storage.objects
  with check (bucket_id = 'songs' and (storage.foldername(name))[1] = (select auth.uid())::text
              and (select public.is_approved())
              and private.song_file_count((select auth.uid())) < 60);
