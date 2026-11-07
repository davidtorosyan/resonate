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

## 1. Rhythm (now)

Notes don't mean much if the rhythm is wrong, and bad rhythm also makes note detection
harder. On the Sing page, keep track of whether each note comes in on time, inside the
take's own data:

- coming in at the right time, especially after rests;
- syncopation (off-beat notes and anticipations), not just notes on the beat;
- rushing or dragging through a line, and holding long notes for their length.

No speech recognition. Work from the sound itself: loudness (a vowel's energy rises at the
syllable), voicing, and pitch changes, with the score saying when each note is due.
Probably nothing for the Tuner.

Design notes (being built):
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

## 2. Feedback tone (right after rhythm)

See principle 1. Keep collecting the numbers, but change what the singer sees:
- Perform: no score after each line.
- Review: lead with what went well; at most a few things to work on, each phrased as
  something to try, with a ▶ to hear it.
- No grade-like percentages anywhere in the singing flow. Avoid red "fail" colouring.

## 3. Fewer words (standing; fix the worst now)

- Key/transpose: replace the explanation under the song bar with the original range and
  the new range (and whether it fits) in a few characters.
- PDF → Song: cut the text down to what's needed to act.
- Sweep the other pages for paragraphs that explain the obvious.

## 4. Keep take data

Today a take's recording and grades live only in memory until the page reloads. History
keeps only the score and per-line scores of the last 10 takes per verse. Keep per-take
statistics locally (per note: pitch and timing; per line; per take). This is small and
it's the base for sync and the AI coach. Recordings: maybe keep some (opt-in or recent
only), not every take.

## 5. Cloud sync (sign-in unlocks it)

- Use any device without re-uploading or re-processing sheet music: songs (MusicXML plus
  the cleaned-up copy) shared across devices.
- Take statistics (and maybe some recordings) shared across devices.

## 6. AI coach over MCP

An MCP server that exposes the statistics of recent songs and takes, so an AI agent
(including a voice agent, which can't hear pitch well) can tell the singer what to work
on. Goal: near-live. The singer sings in Resonate, the app processes each line and
uploads the stats, and the agent queries the MCP server and says "hold on, your rhythm
is off there".

## 7. Accounts / auth

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

## Open questions

(Filled in as research and decisions come in.)
