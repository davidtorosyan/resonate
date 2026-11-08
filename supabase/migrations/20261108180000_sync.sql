-- Cloud sync for approved accounts (invite-only — public.is_approved()).
--
-- public.sync_items: one row per synced thing, a small JSON document:
--   kind 'song'       id = song id      {title, added, source, xml:{path,bytes,sha256}, pdf:{…}|null}
--   kind 'song_state' id = song id      {key, tempo, timing, history}   (samples too: id "sample:…")
--   kind 'take'       id = song id      the last take: {takeId, at, summary…, gz: base64 gzip JSON} (no audio)
--   kind 'profile'    id = profile id   a voice profile
--   kind 'prefs'      id = 'prefs'      {activeProfile}
-- Last writer wins by modified_at (when the change was made, on the device); a write older
-- than the stored row is dropped. Deletes are tombstones (deleted = true, data null) so other
-- devices delete too. updated_at is the server's time of the write: devices pull "everything
-- updated since my cursor".
-- Song files live in the private Storage bucket "songs": {uid}/{song id}.xml.gz and .pdf.
-- Limits (raise them here): 10 songs, 20 profiles, 400 rows, 3 MB a document, 10 MB a file,
-- 40 files per account.

create table public.sync_items (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('song', 'song_state', 'take', 'profile', 'prefs')),
  id          text not null check (char_length(id) between 1 and 100),
  data        jsonb,
  deleted     boolean not null default false,
  modified_at timestamptz not null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, kind, id),
  constraint sync_items_data_size check (data is null or pg_column_size(data) <= 3145728),
  constraint sync_items_tombstone check (not deleted or data is null)
);
comment on table public.sync_items is
  'Cloud sync documents (songs, per-song settings, last takes, voice profiles, prefs) of approved accounts. Last writer wins by modified_at; deletes are tombstones.';
create index sync_items_pull on public.sync_items (user_id, updated_at);

alter table public.sync_items enable row level security;
revoke all on public.sync_items from anon, authenticated;
grant select, insert, update on public.sync_items to authenticated;
create policy "Approved users read their items" on public.sync_items
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_approved()));
create policy "Approved users add their items" on public.sync_items
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_approved()));
create policy "Approved users change their items" on public.sync_items
  for update to authenticated
  using (user_id = (select auth.uid()) and (select public.is_approved()))
  with check (user_id = (select auth.uid()) and (select public.is_approved()));

-- Counting a user's rows / files has to see past RLS (a policy can't count its own table).
create function private.sync_count(uid uuid, k text) returns integer
  language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.sync_items
  where user_id = uid and not deleted and (k is null or kind = k)
$$;
revoke all on function private.sync_count(uuid, text) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.sync_count(uuid, text) to authenticated;

-- Every write: server time; an older change than the stored one is dropped; limits.
create function private.sync_items_write() returns trigger
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
  elsif tg_op = 'INSERT' or old.deleted then -- a row that starts to count
    if new.kind = 'song' and private.sync_count(new.user_id, 'song') >= 10 then
      raise exception 'song limit reached (10)' using errcode = 'P0001', hint = 'resonate:limit:song';
    elsif new.kind = 'profile' and private.sync_count(new.user_id, 'profile') >= 20 then
      raise exception 'profile limit reached (20)' using errcode = 'P0001', hint = 'resonate:limit:profile';
    elsif private.sync_count(new.user_id, null) >= 400 then
      raise exception 'item limit reached (400)' using errcode = 'P0001', hint = 'resonate:limit:items';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.sync_items_write() from public, anon, authenticated;
create trigger sync_items_write
  before insert or update on public.sync_items
  for each row execute function private.sync_items_write();

-- Song files.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('songs', 'songs', false, 10485760, array['application/gzip', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create function private.song_file_count(uid uuid) returns integer
  language sql stable security definer set search_path = '' as $$
  select count(*)::int from storage.objects
  where bucket_id = 'songs' and (storage.foldername(name))[1] = uid::text
$$;
revoke all on function private.song_file_count(uuid) from public, anon, authenticated;
grant execute on function private.song_file_count(uuid) to authenticated;

create policy "songs: approved users read their files" on storage.objects
  for select to authenticated
  using (bucket_id = 'songs' and (storage.foldername(name))[1] = (select auth.uid())::text
         and (select public.is_approved()));
create policy "songs: approved users add files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'songs' and (storage.foldername(name))[1] = (select auth.uid())::text
              and (select public.is_approved())
              and private.song_file_count((select auth.uid())) < 40);
create policy "songs: approved users replace their files" on storage.objects
  for update to authenticated
  using (bucket_id = 'songs' and (storage.foldername(name))[1] = (select auth.uid())::text
         and (select public.is_approved()))
  with check (bucket_id = 'songs' and (storage.foldername(name))[1] = (select auth.uid())::text
              and (select public.is_approved()));
create policy "songs: approved users delete their files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'songs' and (storage.foldername(name))[1] = (select auth.uid())::text
         and (select public.is_approved()));
