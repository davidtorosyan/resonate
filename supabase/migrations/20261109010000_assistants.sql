-- Assistants (MCP, v73): what an AI assistant connected to the account may read, and the
-- commands it may send to the open app.
--
--   public.song_scores    the melody of each song as the app reads it (lines, notes, syllables)
--   public.coach_takes    recent takes (meta + the app's own coaching at the end)
--   public.coach_lines    each take's lines (notes sung vs written, timing, next steps) — written
--                         line by line while the take runs (final = false), final at the end
--   public.devices        the account's devices; `remote` = this device takes commands (its
--                         switch on the Sing page; one device at a time)
--   public.device_commands commands for the remote device; each one goes to the open page over
--                         Realtime (private topic "user:<uid>"), which answers in the row
--
-- Assistants sign in through Supabase Auth's OAuth 2.1 server: their tokens are ordinary user
-- tokens carrying a client_id claim. They may read the account's data (as RLS allows) and send
-- commands, but never write anything else: every write policy here — and new restrictive
-- policies on sync_items and the songs bucket — requires a token without a client_id (the app).

create table public.song_scores (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  song_id    text not null check (char_length(song_id) between 1 and 100),
  updated_at timestamptz not null default now(),
  data       jsonb not null check (pg_column_size(data) <= 1048576),
  primary key (user_id, song_id)
);

create table public.coach_takes (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         text not null check (char_length(id) between 1 and 100),
  song_id    text not null check (char_length(song_id) between 1 and 100),
  status     text not null check (status in ('live', 'done', 'stopped')),
  started_at timestamptz not null,
  updated_at timestamptz not null default now(),
  device_id  text,
  meta       jsonb not null default '{}'::jsonb check (pg_column_size(meta) <= 65536),
  review     jsonb check (review is null or pg_column_size(review) <= 262144),
  primary key (user_id, id)
);
create index coach_takes_recent on public.coach_takes (user_id, started_at desc);

create table public.coach_lines (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  take_id    text not null,
  li         integer not null check (li between 0 and 2000),
  final      boolean not null default false,
  updated_at timestamptz not null default now(),
  data       jsonb not null check (pg_column_size(data) <= 131072),
  primary key (user_id, take_id, li),
  foreign key (user_id, take_id) references public.coach_takes (user_id, id) on delete cascade
);
create index coach_lines_updated on public.coach_lines (user_id, take_id, updated_at);

create table public.devices (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         text not null check (char_length(id) between 1 and 100),
  name       text not null default '' check (char_length(name) <= 60),
  remote     boolean not null default false,
  seen_at    timestamptz not null default now(),
  state      jsonb not null default '{}'::jsonb check (pg_column_size(state) <= 16384),
  primary key (user_id, id)
);

create table public.device_commands (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device_id  text not null,
  action     text not null check (char_length(action) between 1 and 40),
  args       jsonb not null default '{}'::jsonb check (pg_column_size(args) <= 4096),
  status     text not null default 'sent' check (status in ('sent', 'done', 'failed', 'expired')),
  result     jsonb check (result is null or pg_column_size(result) <= 16384),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index device_commands_recent on public.device_commands (user_id, device_id, created_at desc);

-- The app (a session with no client_id) writes; assistants only read and send commands.
create function public.is_app_session() returns boolean
  language sql stable security invoker set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'client_id', '') = ''
$$;
grant execute on function public.is_app_session() to authenticated;

alter table public.song_scores enable row level security;
alter table public.coach_takes enable row level security;
alter table public.coach_lines enable row level security;
alter table public.devices enable row level security;
alter table public.device_commands enable row level security;
revoke all on public.song_scores, public.coach_takes, public.coach_lines, public.devices, public.device_commands from anon, authenticated;
grant select, insert, update, delete on public.song_scores, public.coach_takes, public.coach_lines, public.devices to authenticated;
grant select, insert, update, delete on public.device_commands to authenticated;

create policy "read own" on public.song_scores for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_approved()));
create policy "app writes own" on public.song_scores for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_approved()) and (select public.is_app_session()))
  with check (user_id = (select auth.uid()) and (select public.is_approved()) and (select public.is_app_session()));

create policy "read own" on public.coach_takes for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_approved()));
create policy "app writes own" on public.coach_takes for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_approved()) and (select public.is_app_session()))
  with check (user_id = (select auth.uid()) and (select public.is_approved()) and (select public.is_app_session()));

create policy "read own" on public.coach_lines for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_approved()));
create policy "app writes own" on public.coach_lines for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_approved()) and (select public.is_app_session()))
  with check (user_id = (select auth.uid()) and (select public.is_approved()) and (select public.is_app_session()));

create policy "read own" on public.devices for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_approved()));
create policy "app writes own" on public.devices for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_approved()) and (select public.is_app_session()))
  with check (user_id = (select auth.uid()) and (select public.is_approved()) and (select public.is_app_session()));

-- Commands: anyone signed in to the account (the assistant) may send one, but only to a device
-- whose remote switch is on; only the app answers (status/result) or clears them.
create policy "read own" on public.device_commands for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_approved()));
create policy "send to a remote device" on public.device_commands for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_approved()) and status = 'sent' and result is null
              and exists (select 1 from public.devices d where d.user_id = (select auth.uid()) and d.id = device_id and d.remote));
create policy "app answers" on public.device_commands for update to authenticated
  using (user_id = (select auth.uid()) and (select public.is_approved()) and (select public.is_app_session()))
  with check (user_id = (select auth.uid()) and (select public.is_approved()) and (select public.is_app_session()));
create policy "app clears" on public.device_commands for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.is_approved()) and (select public.is_app_session()));

-- One remote device at a time: switching it on here switches it off everywhere else.
create function private.devices_one_remote() returns trigger
  language plpgsql security invoker set search_path = '' as $$
begin
  if new.remote and (tg_op = 'INSERT' or not old.remote) then
    update public.devices set remote = false where user_id = new.user_id and id <> new.id and remote;
  end if;
  return new;
end $$;
create trigger devices_one_remote after insert or update of remote on public.devices
  for each row execute function private.devices_one_remote();

-- Each command goes to the account's private Realtime topic at once (database-sent broadcasts
-- can be replayed by a page that reconnects).
create function private.device_commands_send() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(
    jsonb_build_object('id', new.id, 'device', new.device_id, 'action', new.action, 'args', new.args, 'at', new.created_at),
    'command', 'user:' || new.user_id::text, true);
  return new;
end $$;
revoke all on function private.device_commands_send() from public, anon, authenticated;
create trigger device_commands_send after insert on public.device_commands
  for each row execute function private.device_commands_send();

-- Realtime: an approved account's devices receive (only) their own topic.
create policy "resonate: own topic" on realtime.messages for select to authenticated
  using ((select realtime.topic()) = 'user:' || (select auth.uid())::text and (select public.is_approved()));

-- Assistants never write the synced data or the song files.
create policy "No writes from assistants" on public.sync_items as restrictive for insert to authenticated
  with check ((select public.is_app_session()));
create policy "No changes from assistants" on public.sync_items as restrictive for update to authenticated
  using ((select public.is_app_session())) with check ((select public.is_app_session()));
create policy "songs: no uploads from assistants" on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'songs' or (select public.is_app_session()));
create policy "songs: no changes from assistants" on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'songs' or (select public.is_app_session()))
  with check (bucket_id <> 'songs' or (select public.is_app_session()));
create policy "songs: no removals by assistants" on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'songs' or (select public.is_app_session()));
