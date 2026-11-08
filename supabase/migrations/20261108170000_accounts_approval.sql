-- Invite-only cloud: anyone can create an account (no email confirmation), but the cloud
-- features stay off until the owner approves the account.
--
-- public.accounts: one row per sign-up, made by a trigger on auth.users. A user can read their
-- own row (the app shows "Cloud: waiting for approval" / "Cloud: on"); nobody can change it
-- through the API — the owner flips `approved` in the dashboard (Table Editor → accounts) or
-- with SQL. public.is_approved() is what every cloud table's RLS policy will require:
--   using (user_id = (select auth.uid()) and (select public.is_approved()))

create table public.accounts (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  email       text,
  approved    boolean not null default false,
  approved_at timestamptz,
  created_at  timestamptz not null default now()
);
comment on table public.accounts is
  'One row per sign-up. approved = the owner switched cloud features on for this account (invite-only). Users read their own row; only the owner changes it (Table Editor or SQL).';

alter table public.accounts enable row level security;
revoke all on public.accounts from anon, authenticated;
grant select on public.accounts to authenticated;
create policy "Users read their own account"
  on public.accounts for select to authenticated
  using (user_id = (select auth.uid()));

-- Functions that must bypass RLS live in a schema the API doesn't expose.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- A new sign-up (or a changed email) → its accounts row.
create function private.sync_account() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.accounts (user_id, email) values (new.id, new.email)
  on conflict (user_id) do update set email = excluded.email;
  return new;
end $$;
revoke all on function private.sync_account() from public, anon, authenticated;
create trigger on_auth_user_saved
  after insert or update of email on auth.users
  for each row execute function private.sync_account();

-- approved_at follows approved.
create function private.stamp_approval() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if new.approved and not coalesce(old.approved, false) then new.approved_at := now();
  elsif not new.approved then new.approved_at := null;
  end if;
  return new;
end $$;
revoke all on function private.stamp_approval() from public, anon, authenticated;
create trigger accounts_stamp_approval
  before update of approved on public.accounts
  for each row execute function private.stamp_approval();

-- Is the signed-in user's account approved? (Runs as the caller: it can only see its own row.)
create function public.is_approved() returns boolean
  language sql stable security invoker set search_path = '' as $$
  select coalesce((select a.approved from public.accounts a where a.user_id = (select auth.uid())), false)
$$;
revoke all on function public.is_approved() from public, anon;
grant execute on function public.is_approved() to authenticated;

-- Accounts made before this migration.
insert into public.accounts (user_id, email)
select id, email from auth.users
on conflict (user_id) do nothing;
