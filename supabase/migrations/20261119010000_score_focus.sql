-- Score focus (v88): what's highlighted in the Score on each device — the bars the user picked
-- (dragged across the notes on Play / the shell's Score) — for an assistant to read: the notes as
-- text, the view's MusicXML for those bars, where they are on the song's PDF, and two pictures
-- (the Score's drawing of them with the note names; the PDF's bars with a red border, as data
-- URLs). One row a device, written by the app only when the account has an assistant connected;
-- read by the account's assistants (get_score_view).

create table public.score_focus (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device_id  text not null check (char_length(device_id) between 1 and 100),
  song_id    text not null check (char_length(song_id) between 1 and 100),
  data       jsonb not null check (pg_column_size(data) <= 524288),
  score_img  text check (score_img is null or char_length(score_img) <= 2000000),
  pdf_img    text check (pdf_img is null or char_length(pdf_img) <= 2000000),
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id)
);
create index score_focus_recent on public.score_focus (user_id, updated_at desc);

alter table public.score_focus enable row level security;
revoke all on public.score_focus from anon, authenticated;
grant select, insert, update, delete on public.score_focus to authenticated;

-- The app (a session with no client_id) writes; assistants only read.
create policy "read own" on public.score_focus for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_approved()));
create policy "app writes own" on public.score_focus for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_approved()) and (select public.is_app_session()))
  with check (user_id = (select auth.uid()) and (select public.is_approved()) and (select public.is_app_session()));
