# Resonate roadmap

The direction the user set on 2026-11-07, in their order. Keep this file current: tick items
off, add decisions and open questions as they're settled. The standing principles also
live in CLAUDE.md ("UI principles").

## Standing principles

1. **Feedback is coaching, not a game.** Resonate is for learning to sing; this isn't
   Guitar Hero. Keep every number (scores, cents, timing) in the data: history, sync, the
   AI coach. Be very careful about how numbers are shown. No percentages or grades
   flashing after a line (seeing "30%" right after singing a line in Perform "really
   sucks"), and no scoreboard. Show what went well and a few concrete things to work on.
   This has to be built in at the lowest level, not added as a skin over scores.
2. **Few words.** The UI can't have that many words. Don't explain what the user just did.
   Show the critical facts compactly instead of a paragraph. Example: picking a key printed
   "fits Dave's comfortable range…" when the useful fact is the song's range before and
   after (C3–F4 → A2–D4). The PDF → Song tool has the same problem.
3. **Everything works without signing in.** GitHub Pages stays the primary host. Signing in
   only unlocks cloud sync and the AI (MCP) connection.

## 1. Rhythm — v1 built (v58); v2 next

Notes don't mean much if the rhythm is wrong, and bad rhythm also makes note detection
harder. On the Sing page, keep track of whether each note comes in on time, inside the
take's own data:

- coming in at the right time, especially after rests;
- syncopation (off-beat notes and anticipations), not just notes on the beat;
- rushing or dragging through a line, and holding long notes for their length.

No speech recognition. Work from the sound itself: loudness (a vowel's energy rises at the
syllable), voicing, and pitch changes, with the score saying when each note is due.
Probably nothing for the Tuner.

Built in v1 (see CLAUDE.md, Sing → Rhythm): onsets from the take's recording (vowel-band
energy rises, pitch steps for legato, voicing), the count-in clicks found in the recording by a
matched filter (the real round trip), tolerances in units of the beat's division, entries,
rushing/dragging, off-beat notes, held notes, all as observations with a tone. Tested on 27
synthetic takes; **not yet on real voices** — next: a way to save a take (WAV + JSON, kept out of
the repo) so real iPhone takes can be replayed through the analysis.

v2 (from the design reviews): an STFT front end with bands that follow F0; onset rules by the
syllable's first letter (vowel / unvoiced / voiced obstruent / m n l r w y); judging against a
local pulse (±2 bars) instead of the take's lead; counting-error hypotheses (a whole line a beat
late, a syncopation squared, a dotted pair evened, a triplet straightened); swing and laid-back
style; fermata / rit. / rubato spans judged on proportions; trust levels (ok / relative / unsure /
skipped); a live per-line pass for Perform and the AI coach; the first (accented) count-in click
as an anchor against a one-beat alias when the round trip is longer than a beat.

Original design notes:
- The mic feeds an AudioWorklet that measures low-band energy (vowels) and high-band
  energy (consonants, the click) every ~5 ms. Pitch frames come at ~60 Hz with an 85 ms
  window, too coarse for timing.
- The count-in clicks the phone plays come back through the mic. Their position in the
  recording measures the real round-trip latency, a free latency calibration. Their
  level tells whether the speaker leaks into the mic.
- Each note's onset is found near where the score puts it (energy rise, voicing start, or
  a pitch change for legato), with one dynamic-programming pass over the take so onsets
  stay in order.
- Per note: how early or late it was, and how sure we are. Per take: steady lead or lag,
  consistency, rushing/dragging, syncopated vs on-beat notes, entries after rests,
  held-note releases.

## 2. Feedback tone — v1 built (v58)

See principle 1. Keep collecting the numbers, but change what the singer sees:
- Perform: no score after each line.
- Review: lead with what went well; at most a few things to work on, each phrased as
  something to try, with a ▶ to hear it.
- No grade-like percentages anywhere in the singing flow. Avoid red "fail" colouring.

## 2b. Guided practice — v1 built (v76); v1.1 next

The site guides practice (docs/COACHING.md; CLAUDE.md "Guided practice"): phrase by phrase,
in time → in tune → in the song, one step on one card, wins first, the song map, ▶ Then → Now.
v1.1, in order:
- Tune `PRACTICE` from the owner's real rounds (More → Tools → ⤓ Last round).
- Sync the practice state (`<song>|practice` rows; docs/COACHING.md §8.3), so the map is the
  same on the phone and the PC.
- Kept checks: the next session starts with a short run over yesterday's ✓ phrases (gold dots).
- Hear the note (in tune, after two misses), a smaller chunk before rotating, the key offer.
- Entry lag inside runs where there's no rest (today: a phrase a whole beat late mid-run reads
  as on time).
- The MCP coach reads `practice` to add to the site's steps (never to replace them).

## 3. Fewer words (standing; fix the worst now)

- Key/transpose: replace the explanation under the song bar with the original range and
  the new range (and whether it fits) in a few characters.
- PDF → Song: cut the text down to what's needed to act.
- Sweep the other pages for paragraphs that explain the obvious.

## 4. Keep take data

So far (v58): each take's history entry keeps its rhythm summary too; the review's ⤓ saves a
take as WAV + JSON (notes, clocks, frames, grades, rhythm) — for sending real takes back to
validate the analysis (tools/replaytake.mjs replays one). Next: phase 0 of the plan below.

Today a take's recording and grades live only in memory until the page reloads. History
keeps only the score and per-line scores of the last 10 takes per verse. Keep per-take
statistics locally (per note: pitch and timing; per line; per take). This is small and
it's the base for sync and the AI coach. Recordings: maybe keep some (opt-in or recent
only), not every take.

## 5. Cloud sync (sign-in unlocks it) — v1 built (v71)

**Built 2026-11-08:** songs (XML + PDF, 10 per account), per-song key/tempo/timing/history, each song's last take (data only), voice profiles; local spaces (shelve on sign-in, adopt on sign-up, restore on sign-out). One generic `sync_items` document table instead of the typed tables planned below (simpler sync; the MCP server can read the same documents). Details in CLAUDE.md "Cloud sync". Next: an owner screen for approvals and limits, recordings (opt-in), real-time push instead of polling.


- Use any device without re-uploading or re-processing sheet music: songs (MusicXML plus
  the cleaned-up copy) shared across devices.
- Take statistics (and maybe some recordings) shared across devices.

## 6. AI coach over MCP — v1 built (v73)

**Built 2026-11-08 (v73):** an MCP server (Edge Function `mcp`) with OAuth through Supabase Auth, read tools (songs, takes line by line — live during a take —, coaching, progress, voice profile, devices) and one acting tool (`control_resonate`) for the device with 📡 Remote on; the Assistants page (URL to copy, connected assistants, devices); details in CLAUDE.md "Assistants". Next: test with the owner's ChatGPT plan (which plans run the acting tool; voice mode), Claude's voice mode once it calls connectors, an in-app voice coach (no MCP), recordings opt-in.

An MCP server that exposes the statistics of recent songs and takes, so an AI agent
(including a voice agent, which can't hear pitch well) can tell the singer what to work
on. Goal: near-live. The singer sings in Resonate, the app processes each line and
uploads the stats, and the agent queries the MCP server and says "hold on, your rhythm
is off there".

## 7. Accounts / auth

**Started 2026-11-08 (v68):** Supabase project `resonate` (Jimbo84 org, Free) and **email + password** sign-in (the owner's choice over email codes for now) on `account.html`; details in CLAUDE.md "Account". Email codes, Google/GitHub and Delete account can follow. **Invite-only (v70):** no email confirmation; every account gets a `public.accounts` row with `approved = false`, and cloud tables will require `public.is_approved()` in their RLS — the owner approves accounts in the Table Editor. Later: a notification to the owner on a new sign-up, and an approval screen in the app for the owner.

OAuth, offloaded as much as possible (Supabase or an equivalent provider), as hands-off as
possible. Needed for sync and for the MCP server, whose agents act on the user's own data.
Hosting options to weigh: Supabase; an "MCP-oriented" database the user heard about (name
forgotten); Render, which the user already uses for another project.

## 8. Device-to-device without an account

Maybe: move songs and data between your own devices on the same network without an
account (phone ↔ computer), for people who won't sign up but want their phone on the go.

## 9. Navigation

- Next iteration: no tab bar. One main page, essentially the Tuner, with a gear icon that
  opens a menu of the other pages (Sing, Tools, …).
- After that: a single-page app. The Tuner is always where you are (active or not depending
  on what else is going on), and you load songs, upload things, etc. from there. No reason
  for multiple pages.

## 10. Sound over CarPlay / Bluetooth (open, 2026-11-08)

Web Audio crackles and drops out over CarPlay — even one held key — while the phone's speaker and other apps are fine. WebKit's iOS Web Audio output has no lookahead (each IO callback's frames are rendered after it asks; a burst or a bigger slice than the last is zero-filled), forces a 128-frame IO buffer while any AudioContext exists, ignores `latencyHint`, and shares one output path between all contexts of a rate (details in CLAUDE.md, Sing → "Over CarPlay"). Scheduling ahead (v64) and replacing the context (v66, reverted) didn't help.

- **Now:** Tools → Audio test, run in the car: which of seven ways crackle, with the output's IO pattern. Copy results back.
- **If the `<audio>` file is clean (expected):** a playback path without Web Audio for high-latency routes (detected by output latency / the test, or a setting): Listen / Play / line playback rendered with OfflineAudioContext (in chunks, notes added with `suspend()`), WAV → `<audio>`, every AudioContext closed meanwhile; the lane follows `audio.currentTime`; seeking = `currentTime`. Keys: a pre-rendered held note per pitch, paused on release (iOS ignores `volume`, so no fade — bake a short release in, or accept the cut). Costs: start latency (~0.1–0.3 s), no live mixing.
- **If the streamed `<audio>` (test 6) is clean too:** keep Web Audio and route it through a `MediaStreamAudioDestinationNode` into one `<audio>` element on such routes — keys stay instant.
- **Takes over CarPlay:** play-and-record moves CarPlay to its 24 kHz hands-free route; a take there is a phone-call-quality path by design. Headphones / the phone itself remain the recommendation.

## Plan for 4–8 (research, 2026-11-07)

This is the plan for items 4–8, researched on 2026-11-07. Several of the pieces below are in beta and change quickly. Anything marked *(unverified)* needs re-checking before you build on it.

### Decision

- **Use one Supabase project:** Postgres with RLS, Storage, Auth, Edge Functions and the OAuth 2.1 server. No other option found gives a static GitHub Pages app all of these from one vendor, free to start:
  - sign-in from the browser;
  - row security per user;
  - file storage;
  - an authorization server that MCP clients can use.
- **The no-account path doesn't change.**
  - Load supabase-js (an exact version, from jsDelivr) only when someone taps Sign in.
  - IndexedDB stays the source of truth on each device. The cloud holds a copy.
- **Not Render.** Free web services sleep after 15 min and take about 1 min to wake. Free Postgres expires after 30 days ([render.com/docs/free](https://render.com/docs/free)). Render is only worth it on a paid plan ($7/mo, `0.5c-512mb`), and only if we ever want a Node MCP server there.
- **Plan B if Supabase's OAuth server stalls:** replace only the authorization server and keep the data. Options:
  - WorkOS AuthKit: free up to 1M MAU, `aud` bound to the resource ([pricing](https://workos.com/pricing)).
  - Cloudflare `workers-oauth-provider`: implements the full 2026-07-28 auth spec, including CIMD ([repo](https://github.com/cloudflare/workers-oauth-provider)).
  - Clerk: CIMD GA since September 2026.
  - Neon Managed Better Auth OAuth provider: launched 2026-11-02, has CIMD and audience-bound tokens, but is days old and has no file storage ([blog](https://neon.com/blog/managed-better-auth-oauth-provider-mcp)).
- **Ruled out:**
  - Firebase: no OAuth server for MCP clients, and Storage needs a billing account since Feb 2026.
  - Appwrite Free: projects pause without Console activity and are deleted after 90 days paused.
  - InstantDB: its cloud shuts down in Aug 2027.
  - Ghost: winding down.

### Architecture

- **Sign-in (Supabase Auth)**
  - **6-digit email codes first** (`signInWithOtp` + `verifyOtp`, with an email template that shows `{{ .Token }}`). They work the same in a Safari tab, in a Home Screen app, and inside Claude's or ChatGPT's sign-in sheet.
  - **No magic links.**
    - On iOS, a link opened from Mail lands in Safari, whose storage is separate from the Home Screen app's.
    - Mail scanners can use up one-time links by opening them first.
  - **Then Google and GitHub.** For Google, use Google's own button with `signInWithIdToken`, which needs no redirect.
  - **Apple only if asked.** It needs an Apple Developer account, and its OAuth secret must be renewed every 6 months ([docs](https://supabase.com/docs/guides/auth/social-login/auth-apple)).
  - **Custom SMTP is required before anyone but the owner signs in.** The built-in mailer only sends to team members, at 2 messages/hour ([SMTP](https://supabase.com/docs/guides/auth/auth-smtp)).
  - **Keys:**
    - The browser uses `sb_publishable_…`. `sb_secret_…` lives only in Edge Functions.
    - The legacy `anon` and `service_role` keys are deprecated by the end of 2026 ([API keys](https://supabase.com/docs/guides/api/api-keys)).
    - Use asymmetric JWT signing keys (ES256/RS256) from day one, because `withSupabase` rejects HS256.
- **Data**
  - Postgres tables with `user_id = auth.uid()` RLS on every table. Stats are stored as JSONB.
  - Private Storage buckets, with the user id as the first path segment.
- **Sync**
  - An IndexedDB outbox (rows and files) is flushed on every change and on `visibilitychange`.
  - The page pulls rows with `updated_at > last_pull` on sign-in and whenever it becomes visible.
  - Takes are append-only, so they never conflict.
  - Songs, settings and profiles use last writer wins per row. Deletes are tombstones.
  - Songs are de-duplicated by the SHA-256 of their raw XML.
- **MCP server**
  - One Edge Function at `https://<ref>.supabase.co/functions/v1/mcp`, built from Supabase's BYO-MCP template ([blog, 2026-10-22](https://supabase.com/blog/give-your-supabase-app-its-own-mcp-server), [docs](https://supabase.com/docs/guides/getting-started/byo-mcp)):
    - TS SDK v2 `createMcpHandler`, which serves both 2026-07-28 and older clients;
    - `@supabase/server` ≥ 1.6.0 with `withOAuthProtectedResource()` and `withSupabase({auth:'user'})`;
    - `verify_jwt = false`.
  - Every query runs as the user, through RLS.
  - The Protected Resource Metadata is served under the function's path, and its `resource` must exactly match the URL the user pastes.
  - **Tools** (all read-only, all with `readOnlyHint`):
    - `list_songs`
    - `get_recent_takes`
    - `get_take`
    - `get_new_lines(after, wait_s ≤ 25)`: a long-poll for the live take. 25 s stays under ChatGPT's reported ~60 s timeout, Supabase's 150 s idle limit and Claude's 240 s limit.
    - `get_progress`: one line or a whole song across takes.
    - `get_voice_profile`
  - **Results are compact, paginated JSON.** claude.ai caps a result at about 150k characters and Claude Code at 25k tokens.
  - **No audio, and no resources or subscriptions.** MCP 2026-07-28 is stateless, and `subscriptions/listen` needs a long-lived stream that an Edge Function can't hold: the wall-clock limit is 150 s on Free and 400 s on paid plans ([limits](https://supabase.com/docs/guides/functions/limits), [spec changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)).
  - **Tool descriptions carry principle 1:** coach (say what went well, give one or two things to try), and don't read numbers out as grades.
- **Agent auth: two ways in**
  - **OAuth**, through Supabase's OAuth 2.1 server ([getting started](https://supabase.com/docs/guides/auth/oauth-server/getting-started)). It is in public beta and free on all plans. Turn on dynamic client registration (DCR).
    - This is the path for claude.ai (web, Desktop, mobile; the Free plan gets one custom connector) and for ChatGPT.
    - **The consent page is a static GitHub Pages file.** Set the Site URL to `https://www.jimbo84.com/resonate` and the authorization path to `/oauth/consent`. The consent page is then `https://www.jimbo84.com/resonate/oauth/consent`. The auth server simply joins those two strings and checks only the scheme and host, so this works today without waiting for PR #2417.
    - The page opens inside Claude's or ChatGPT's browser sheet, which may not see the app's session. It must be able to sign the user in by itself, with an email code.
  - **Personal access tokens (PATs)** for clients that only accept a fixed bearer token:
    - the OpenAI Realtime `mcp` tool (its `authorization` field);
    - ElevenLabs agents (Bearer or a custom header);
    - Claude Code (`--header`).
    - claude.ai's fixed-header option is a limited beta for organizations ([Claude auth docs](https://claude.com/docs/connectors/building/authentication)), so it doesn't help ordinary users.
    - Tokens look like `rsn_…`. They are shown once, stored hashed, named, and revocable.
    - Looking a PAT up needs the secret key, which bypasses RLS. So PAT reads go only through narrow `SECURITY DEFINER` functions that take the owner id, and only the service role may execute them.
  - **An agent's token is a full user token.** Supabase OAuth tokens carry `aud: "authenticated"` and have no data scopes ([token security](https://supabase.com/docs/guides/auth/oauth-server/token-security)).
    - So every write policy on tables, `storage.objects` and RPCs is `AS RESTRICTIVE … (auth.jwt()->>'client_id') IS NULL`. Agents can only read; only the app writes.
    - Until audience binding lands ([supabase/auth#2894](https://github.com/supabase/auth/pull/2894)), the MCP function also checks `iss` and that `client_id` is present.
- **Near-live flow**
  1. During a take the page grades each note as it passes (`gradeLive`). When a line's last note is graded, the page upserts a `take_lines` row with `final = false`, straight to PostgREST. That isn't an Edge Function call, so it costs no invocations.
  2. The take has `status = 'live'` and an `updated_at` heartbeat. A live take whose heartbeat is more than 60 s old counts as ended (the page was closed).
  3. At Stop, `gradeTake` regrades the take. The page writes the final rows and sets `status = 'done'`.
  4. Inside its long-poll, `get_new_lines(after)` checks the table every second, so an agent sees a new line within about 1 s.
  - **Claude and ChatGPT call tools only when the user speaks or types** ("how was that line?"). They won't watch a take on their own, so "near-live" means fresh data whenever the user asks.
  - **A voice coach built into Resonate** (OpenAI Realtime or ElevenLabs) doesn't need MCP. The page pushes each graded line into the session, and an Edge Function mints short-lived client keys so the owner's API key stays secret.
    - It should speak between lines or rounds, for example in the phrase loop's result phase. While the mic is open, an iPhone plays sound quietly, and a coach's voice picked up by the mic would be graded.

### Data model

Every table has:
- `user_id uuid not null default auth.uid() references auth.users on delete cascade`
- `updated_at`
- `deleted_at` (tombstone)
- RLS turned on

IDs are generated on the device as UUIDs and are the same in IndexedDB, the export file and the cloud. Each stats JSON carries a schema version, `v`.

| Table / bucket | Holds |
|---|---|
| `songs` | id, title, `xml_sha256`, `xml_path`, `source` (import / link / pdf / `sample:<name>`), `settings` jsonb (key shift from `resonate.sing.keys`, tapped timing from `resonate.sing.timing`, tempo), `clean_ver` + `clean_path` (the OMR clean-up result for that app version; a null path means unchanged) |
| `voice_profiles` | id, name, `vol`, `range`, `active` (what `resonate.profiles` holds today) |
| `takes` | id, song_id, verse, `shift_sig`, `timing_sig`, rate, view (practice/perform), guide, part (whole song or a loop's line range), started_at, ended_at, status (live/done/partial), `summary` jsonb (score, counts, timing tendency, latency), app_version |
| `take_lines` | primary key (take_id, line_idx); text, `final`, `stats` jsonb: line score, coach.js reasons, and a notes array `[{q, dq, target, cents, hit, grade, shift_ms, onset/rhythm (§1), octave}]`. One row per line with its notes inside, so about 20–60 rows per take |
| `recordings` (opt-in) | take_id, path, mime, duration_s, bytes |
| `api_tokens` | id, name, `token_hash`, prefix, created_at, last_used_at, revoked_at |
| bucket `songs` | `{uid}/{song_id}.musicxml.gz`, `{uid}/{song_id}.clean-v{N}.musicxml.gz` |
| bucket `recordings` | `{uid}/{take_id}.webm` (or `.m4a`) |

- **Storage policies:** `(storage.foldername(name))[1] = auth.uid()::text`, plus the same restrictive rule against agent writes. Buckets are private, and agents never get audio.
- **What isn't uploaded:**
  - Bundled samples: they are stored only as `source = 'sample:…'`.
  - PDFs: they are large, and licensed scores stay on the device.
- **Recordings need a new compressed capture path,** because the AudioWorklet captures raw Float32 today. Use MediaRecorder with WebM/Opus where it's supported (Safari 18.4+, reportedly), otherwise mp4/AAC. Feature-detect which one works.

### Phases (build order)

0. **No account, no backend.** This is roadmap item 4, and it comes first.
   - **A local takes store** in IndexedDB with the same shape as the cloud tables. Recordings are opt-in and limited to the last N.
   - Migrate `resonate.sing.history` into it as summary-only takes.
   - **Call `navigator.storage.persist()`, and add a one-line "Add to Home Screen" hint.** Safari tabs lose IndexedDB and localStorage after 7 days of Safari use without visiting the site. Home Screen apps keep their own count of days ([WebKit](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/), [storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/)).
   - **An export/import bundle:**
     - one versioned, gzipped file (`CompressionStream`) with songs (XML and settings), profiles, takes and lines; recordings optional;
     - merged by id and `updated_at`, with songs de-duplicated by hash;
     - **iPhone:** the share sheet (`navigator.share({files})`, as ⤓ already does in `sing.js`) to AirDrop, Files or Mail;
     - **PC:** a plain download, because Chrome desktop's share refuses `.json`, `.zip` and `.gz` files;
     - **import** through the existing Open button, which recognises the bundle;
     - the same serializer and merge later become the sync engine.
1. **Supabase, sign-in and sync.**
   - Create the project, with the schema and RLS as migrations.
   - Email codes, then the outbox and pull.
   - Sign in, Sign out and Delete account in the menu. Delete account is an Edge Function that removes the Storage objects and calls `auth.admin.deleteUser`.
   - Then Google and GitHub.
2. **MCP: read-only, with OAuth.**
   - The Edge Function, the consent page, and line uploads during a take.
   - Test with the MCP Inspector, then claude.ai on the web and on iOS, then Claude Code, then ChatGPT if your plan allows it.
   - A short Connect screen in Resonate: the URL to paste and the client limits.
3. **PATs**, generated and revoked in Resonate, for voice agents and Claude Code. Optionally, the in-app voice coach.
4. **Optional LAN transfer** (see below), only after a data-channel test on the iPhone.

### Cost at small scale

- **Supabase Free, $0** ([pricing](https://supabase.com/pricing)):
  - **Limits:** 500 MB database, 1 GB Storage (50 MB per file), 5 GB egress, 50k MAU, 500k Edge Function calls, 2M Realtime messages, 2 active projects.
  - **Database:** at tens of KB of stats per take, 500 MB holds more than 10k takes.
  - **Song storage:** MusicXML probably gzips to about a tenth of its size (estimate), so 1 GB holds thousands of songs.
  - **Recordings** are what fills it. Opus at about 32 kbps is about 0.2 MB/min (about 80 hours per GB), against a few MB/min for raw PCM.
  - **Long-polls:** about 144 calls per hour of continuous polling, far below 500k a month.
  - **Pausing:** a project with no database activity for a week pauses, and sync and MCP stop until it's resumed. A paused project can be restored for up to a year ([pausing](https://supabase.com/docs/guides/platform/free-project-pausing)). Regular use keeps it awake.
- **Supabase Pro, from $25/mo per organization,** once other people rely on it. It includes 100k MAU, $10 of compute credit and backups.
- **Optional custom auth domain, $10/mo,** so Google's consent screen shows jimbo84.com instead of `<ref>.supabase.co`. Verifying the brand with Google is the other way to fix that.
- **Email:** a transactional SMTP provider (small free tiers exist; not checked), plus DNS records on jimbo84.com.
- **Agents:** users bring their own Claude or ChatGPT plans. An in-app Realtime or ElevenLabs coach would bill the owner per use (not priced here).
- **LAN relay:** $0 on Supabase Broadcast or on a Cloudflare Durable Object (Workers Free: 100k requests/day; use the Hibernation API).

### The owner does by hand (once)

- **Create the Supabase organization and project.** Choose the region (US or EU) after measuring tool latency from Claude. Anthropic's outbound range, `160.79.104.0/21`, has no documented location.
- **Auth → URL configuration:**
  - Site URL: `https://www.jimbo84.com/resonate`
  - Redirect allow list: `https://www.jimbo84.com/resonate/**`, `http://localhost:3000/**`, `https://localhost:3443/**`. LAN-IP testing would rely on email codes, which need no redirect.
- **Auth → Email:**
  - Turn on codes.
  - Edit the template so it shows `{{ .Token }}`.
  - Enter the custom SMTP credentials.
  - Add the SPF and DKIM DNS records.
- **Keys:** switch to asymmetric signing keys and create the publishable and secret keys. The publishable key goes in the page; it isn't a secret.
- **Google Cloud:**
  - Create an OAuth web client with JavaScript origins `https://www.jimbo84.com` and `http://localhost:3000`.
  - Set up the consent screen.
  - Paste the client ID and secret into Supabase.
- **GitHub:** create an OAuth app with callback `https://<ref>.supabase.co/auth/v1/callback`.
- **Auth → OAuth Server:** turn it on, enable dynamic registration, and set the authorization path to `/oauth/consent`.
- **Secrets:**
  - A Supabase access token and the database password, as GitHub Actions secrets for CI deploys.
  - Any OpenAI or ElevenLabs key, with `supabase secrets set`.
- **Add the connector:**
  - Claude: Settings → Connectors → Add custom connector → the function URL.
  - ChatGPT, if your plan allows it: on the web, Plugins → + → Add custom MCP server ([OpenAI](https://developers.openai.com/plugins/deploy/connect-chatgpt)).
  - There are no callback URLs to enter: DCR registers `https://claude.ai/api/mcp/auth_callback` and ChatGPT's per-connector callback by itself.
- **Decide** between Free and Pro, and run the device tests on the iPhone.

### Can be automated (Claude, in the repo)

- **A `supabase/` folder:**
  - migrations: tables, RLS including the restrictive rule against agent writes, Storage policies, the PAT functions;
  - Edge Functions: `mcp`, `account-delete`, `realtime-key`;
  - `config.toml`, with `verify_jwt = false` for `mcp`.
  - A GitHub Action deploys it with the Supabase CLI on every push to `main`, next to Pages.
- **Client code:**
  - the sign-in sheet, outbox and pull, export/import, the Connect screen and the PAT UI;
  - `public/oauth/consent.html`, which Pages should serve at `/oauth/consent` (check);
  - `bump.mjs` adds the `?v=` suffix to the new modules, and supabase-js is pinned to an exact version.
- **Tests:**
  - node cases for the serializer and the merge;
  - browser tests against a throwaway project: user A can't read user B's data, an OAuth-client token can't write, a revoked PAT fails.
- **Development tooling:** Supabase's own MCP server ([docs](https://supabase.com/docs/guides/getting-started/mcp)) can let Claude Code inspect the project while we build. It is a developer tool, not something for end users.

### The "MCP-oriented database"

- **Most likely Ghost, by Tiger Data** (ghost.build).
  - Postgres for coding agents, driven through a CLI or an MCP server.
  - GA 2026-06-09. Free: 100 compute hours/month and 1 TB ([SD Times](https://sdtimes.com/data/tiger-data-launches-ghost-a-purpose-built-database-service-for-the-agentic-er/)).
  - **ghost.build now says it is winding down:** no new users, shutdown date not announced, and no press coverage found.
  - Its predecessor was Tiger's "Agentic Postgres" (Oct 2025).
- **Other candidates:**
  - Neon: a hosted MCP server, plus "claimable" projects.
  - Xata.
  - Supabase's own MCP server.
  - Render's MCP server.
  - SurrealDB 3.1 (`surreal mcp`).
  - Turso (`--mcp`).
  - TiDB Cloud Zero.
  - CockroachDB's managed MCP server.
  - Google Cloud's managed MCP servers for AlloyDB and Cloud SQL.
- **All of these let a developer's agent manage a database.** None gives an app's end users sign-in, per-user isolation and OAuth for their agents. Whichever one it was, the design stays the same.

### Device to device without an account

- **Recommendation:** the export/import file from phase 0 is the answer for people without an account. Signed-in users get cloud sync. Live LAN pairing is optional and comes last.
- **Why not go further:**
  - Browsers can't discover devices on the LAN; Direct Sockets only works in Isolated Web Apps ([Chrome](https://developer.chrome.com/docs/iwa/direct-sockets)).
  - WebRTC still needs a relay on the internet to swap offer and answer.
  - Safari and a Home Screen app have separate storage, so on one iPhone they act as two devices.
- **If we build it ("Sync with phone"):**
  - **Pairing:** the PC shows a QR code with a URL. Its fragment holds the room ID, a one-time key and the PC's DTLS fingerprint.
  - **Relay:** offer and answer travel AES-GCM-encrypted through a relay on the backend we already have (Supabase Broadcast), or a Durable Object if there is no backend yet. Trystero 0.26, with a password taken from the QR code, is acceptable; pin the version.
  - **Transfer:**
    - a WebRTC data channel, with STUN (`stun.cloudflare.com`) from the first attempt and no TURN, so the data stays on the home network;
    - 16–64 KiB chunks with backpressure and acks;
    - a progress bar;
    - Wake Lock (in Home Screen apps only from iOS 18.4).
  - **Home Screen installs** (the iOS 26 default) can't receive a link scanned with the Camera app, because it opens in Safari. They need one of:
    - an in-app scanner (a lazily loaded `barcode-detector` polyfill, ~0.95 MB of wasm);
    - a typed short code, with a matching check code shown on both screens.
  - **Fallbacks:**
    - Briefly open the iPhone's mic, so the PC gets the phone's real IP address.
    - After 10–15 s without a connection, point the user to the file route.
  - **Caveats:**
    - If Realtime's "Allow public access" is ever turned off, devices without an account need anonymous sign-ins, with a CAPTCHA.
    - One unconfirmed report of failing Safari data-channel transfers ([W3C list](https://lists.w3.org/Archives/Public/public-webrtc/2025Nov/0021.html)).
    - Chrome's Local Network Access checks for WebRTC are off by default in Chromium today, but a rollout is being prepared, so budget for a one-time prompt on the PC.
    - The Windows firewall on the Public network profile may block it.
    - Don't use PeerJS's public servers.

### Risks

- **Supabase's OAuth 2.1 server is still beta;** its Q4 2025 GA target slipped. Its gaps:
  - **No CIMD** ([#2895](https://github.com/supabase/auth/pull/2895) is open).
  - **Only DCR, which MCP 2026-07-28 deprecates** (still supported; the changelog guarantees at least 12 months' notice before removal).
  - **Claude registers a new client on every fresh connection,** so client rows pile up.
  - **No `aud` binding.**
  - **Refresh errors aren't `invalid_grant`** ([#2864](https://github.com/supabase/auth/pull/2864)).
  - If these bite, use Plan B.
- **Don't add MFA until [#2802](https://github.com/supabase/auth/pull/2802) (merged 3 Nov) is live on hosted projects.** Until then, an MFA step-up deletes the user's OAuth sessions.
- **An agent token works as a user token on PostgREST and Storage.** One missing restrictive policy on a table, bucket or RPC lets an agent write. Cover this with a test.
- **The PAT path bypasses RLS.** One forgotten owner filter leaks other users' data, so PAT reads go only through `SECURITY DEFINER` functions.
- **On the Free plan, a quiet week pauses the project.**
- **iOS:**
  - Safari-tab data, including the outbox and the session, can be deleted after 7 days, so upload right away.
  - Safari and the Home Screen app need separate sign-ins.
  - OAuth redirects from a Home Screen app may land in Safari. Email codes avoid this.
- **Which clients can connect:**
  - ChatGPT custom MCP servers appear limited to Business, Enterprise and Edu, with Pro read-only and setup on the web only. Free, Go and Plus apparently can't add one *(unverified: OpenAI's help page couldn't be fetched)*.
  - Claude's voice mode with custom connectors is untested.
- **Privacy:**
  - Recordings are voice data: opt-in, deletable per take, deleted with the account, never sent to agents.
  - Users' licensed scores sit in private per-user buckets. Never make a bucket public.
- **Format drift:** stats JSON is versioned, and older cached pages (`max-age=600`) must ignore fields they don't know.
- **supabase-js comes from a third-party CDN at runtime.** Pin the version and load it only when signing in.

### Open questions for the owner

1. Which "MCP-oriented database" did you hear about? Ghost fits best, but the answer doesn't change the plan.
2. Which agents come first?
   - Claude (the default).
   - ChatGPT: which plan do you have?
   - A voice coach inside Resonate (OpenAI Realtime or ElevenLabs): who pays per use?
3. Recordings:
   - Should they sync at all?
   - If so, opt-in per take, or only the last N?
   - Agents never get audio: agreed?
4. Are email codes plus Google and GitHub enough, or do you want Apple too?
5. Hosting plan:
   - Free until other people use it, or Pro from the start?
   - A custom auth domain ($10/mo), or Google brand verification?
6. Region: US or EU? We'll measure first.
7. On your iPhone, do you use Resonate in a Safari tab or as a Home Screen app? This decides the pairing UI and how hard to push storage persistence.
8. LAN transfer:
   - Should LAN pairing be built at all, once the file and sync exist?
   - Which file extension: `.resonate` or `.json.gz` (the Files app may decompress `.gz`)?

**Check on a throwaway project before committing:**
- Supabase's OAuth metadata advertises S256, and sign-in completes end to end for both Claude and ChatGPT.
- PostgREST and Storage still accept a token whose `aud` a Custom Access Token Hook has changed.
- Google's button works inside a Home Screen app.
- `persist()` is granted in a Safari tab.
- A few-MB data-channel transfer completes on iOS 26/27.
