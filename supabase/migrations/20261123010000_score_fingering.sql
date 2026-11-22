-- Score fingering (E7, docs/FINGERING.md §4): Resonate's suggested piano fingering of a song, as text
-- for an assistant (read_resonate fingering): every bar's notes with their hand and finger, the hand
-- positions, the notes moved to the other hand, the keys out of reach (public/fingertext.js). One row
-- a song, written by the app (assist.js shareFingering) once it has worked the fingering out on the
-- Score, only when an assistant has connected to the account; deleted with the song (forget.js). The
-- fingering itself is derived and stays on each device (library.js, never synced): this is a copy.

create table public.score_fingering (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  song_id    text not null check (char_length(song_id) between 1 and 100),
  alg        integer not null check (alg between 1 and 1000000), -- finger.js ALG that worked it out
  data       jsonb not null check (pg_column_size(data) <= 524288),
  updated_at timestamptz not null default now(),
  primary key (user_id, song_id)
);

alter table public.score_fingering enable row level security;
revoke all on public.score_fingering from anon, authenticated;
grant select, insert, update, delete on public.score_fingering to authenticated;

-- The app (a session with no client_id) writes and deletes; assistants only read.
create policy "read own" on public.score_fingering for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_approved()));
create policy "app writes own" on public.score_fingering for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_approved()) and (select public.is_app_session()))
  with check (user_id = (select auth.uid()) and (select public.is_approved()) and (select public.is_app_session()));
