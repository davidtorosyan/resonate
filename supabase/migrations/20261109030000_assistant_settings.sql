-- Assistants (v74): the user's standing instructions and how a take started by an assistant
-- behaves, and which assistant has been active lately (the Sing page shows it by 📡).

create table public.assistant_settings (
  user_id             uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  instructions        text not null default '' check (char_length(instructions) <= 4000),
  start_delay_s       integer not null default 4 check (start_delay_s between 0 and 20),
  review_after_remote boolean not null default false,
  updated_at          timestamptz not null default now()
);
alter table public.assistant_settings enable row level security;
revoke all on public.assistant_settings from anon, authenticated;
grant select, insert, update on public.assistant_settings to authenticated;
create policy "read own" on public.assistant_settings for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_approved()));
create policy "app writes own" on public.assistant_settings for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_approved()) and (select public.is_app_session()))
  with check (user_id = (select auth.uid()) and (select public.is_approved()) and (select public.is_app_session()));

-- Which assistant called the MCP server last, and when (written only by assistant_seen).
create table public.assistant_activity (
  user_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id text not null,
  name      text not null default '',
  logo      text,
  last_at   timestamptz not null default now(),
  last_tool text,
  primary key (user_id, client_id)
);
alter table public.assistant_activity enable row level security;
revoke all on public.assistant_activity from anon, authenticated;
grant select on public.assistant_activity to authenticated;
create policy "read own" on public.assistant_activity for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_approved()));

-- Called by the MCP server on each tool call, with the assistant's own token: records the call
-- (its name and logo as the client registered them) and tells the account's open pages.
create function public.assistant_seen(tool text) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  cid text := coalesce(auth.jwt() ->> 'client_id', '');
  nm text;
  lg text;
begin
  if uid is null or cid = '' or not public.is_approved() then return null; end if;
  select c.client_name, c.logo_uri into nm, lg from auth.oauth_clients c where c.id::text = cid;
  nm := left(coalesce(nullif(nm, ''), 'Assistant'), 60);
  lg := case when lg like 'https://%' then left(lg, 500) else null end;
  insert into public.assistant_activity as a (user_id, client_id, name, logo, last_at, last_tool)
    values (uid, cid, nm, lg, now(), left(tool, 40))
    on conflict (user_id, client_id) do update set name = excluded.name, logo = excluded.logo, last_at = excluded.last_at, last_tool = excluded.last_tool;
  perform realtime.send(jsonb_build_object('client', cid, 'name', nm, 'logo', lg, 'tool', left(tool, 40), 'at', now()), 'assistant', 'user:' || uid::text, true);
  return jsonb_build_object('name', nm);
end $$;
revoke all on function public.assistant_seen(text) from public, anon;
grant execute on function public.assistant_seen(text) to authenticated;
