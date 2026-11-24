# Singing around the ear (E8) — design draft

Status: a draft for the owner (2026-11-22, revised after one review); nothing built. It replaces guided practice's card (docs/COACHING.md, v76). **Prerequisites:** docs/CLEANUP.md Phase 7 (Sing's suites in the shell), and the owner's Reconvert all (a Reconvert changes notes, and the phrase keys Ear's marks hang on).

## 0. The request

The owner (docs/ROADMAP.md E8), as requirements:
- **R1** The singer never sees the time-series lane or per-note colours; the data stays.
- **R2** Practice is on a short phrase the singer picks.
- **R3** ▶ plays it whenever the singer likes; singing starts when the singer starts (no count-in, no forced listen → your turn).
- **R4** The singer presses Done.
- **R5** Two counts: **beats on** (on the money or close) and **notes hit** (generous). The total stays hidden until every one is right: "all of them".
- **R6** Rhythm: the phrase with a metronome, then sung while snapping along. Done → the beats count.
- **R7** Notes: the phrase's lowest, highest and other notes; ▶ hear, hold to match (as the range test), then the phrase.
- **R8** Everything trains listening: sounds over visuals, short phrases.
- **R9** Counts to beat, never a grade or a %.

## 1. The approach

Sing shows **one phrase**: its words, ▶ Hear, ● Sing. The singer hears it as often as they like, sings alone once ■ Done appears, and taps it; nothing sounds or is drawn meanwhile. Resonate finds the singer's own start and tempo, grades with the existing code, and shows a win, two counts (♩, ♪) and at most one cue with two sounds. **Beats** and **Notes** end on the phrase; runs rejoin the song. Nothing starts by itself.

## 2. Decisions

**D1. Ear replaces the guided card.**
- Removed: practice.js `nextStep` (:959), `applyRound` (:538), the ladder; sing.js `runBlock` (:2115) and the card; coach.js `roundResult` (:233). The card's markup stays hidden until CLEANUP Phase 9 (a v93 shell reads it).
- Rewritten: runs (`runSpan` :2044, `applyRunResult` :2082) and the map (`renderMap` :1947), on Ear's phrases and counts (D12). v76's ♩♪✓ marks don't carry over: the map starts empty.
- Kept: `groupPhrases`, `phraseKeys`, `rhythmOf` / PhraseRhythm, and ⚙ → Guide me off = v75's screen with the lane (existing code; the v75-era suites run on it; Q4).
- No exact precedent: EarMaster's Melody Imitation lets you replay and wait, but you start on its metronome's first beat (User Guide p. 15).

**D2. A phrase is a lyric line.**
- `lyricLines` (split at rests and line-ending punctuation); a line under 4 syllables joins the next (the previous at a section's end); one over 10 is cut after its longest note, at a word end, both parts ≥ 4. No seconds limit.
- `groupPhrases` (:137) takes these lines with `opts.limits` that join nothing, so names, keys, hard boundaries, sections and ride-alongs stay v76's. (Its limits only merge lines; no limit cuts one.)
- Amazing Grace at ♩=80 (the repo's one fixture): 6 phrases, 4–6 syllables, 4.5–11.3 s ("Amazing grace!", "how sweet the sound!", … "Was blind, but now I see."). The owner's songs: earcases prints every fixture's, and `PLAY_SCORES`'.
- **Your own:** tap a phrase's first word, then its last (whole words, one section) → a phrase keyed by its own `wk`.

**D3. ▶ Hear: the phrase, mic closed.**
- `holdPiano` (piano + held tone), in the octave last sung (`take.octave`), else the key's. ▶ First note replays the start.
- After an attempt that hit every note, ▶ You plays it: singers copy their own voice best (Pfordresher & Mantell 2014; vocal targets beat piano: Moore et al. 2008).
- Nothing plays during an attempt: iOS is quiet with the mic open, and the melody under the voice made poor singers' notes worse (their intervals better: Pfordresher & Brown 2007). ▶ during an attempt **ends it, uncounted** (Q2).

**D4. On the singer's own time; ■ Done is the start signal.**
- ● Sing stops any ▶ and opens the mic in the tap (`play-and-record`). Words show; nothing sounds.
- iOS takes hundreds of ms for `getUserMedia` and the session switch. **■ Done and its level ring appear 0.25 s after the first mic frame**: the singer starts on it, and that quarter second is the room (`quiet` for `firstSound`, `voiceCover`, `vowelFloor`; `loudGate`'s floor, grade.js:131).
- Our own sound: after a ▶, frames gate at `MIN_RMS` until `soundGone` (pitch.js:29) of its `stopsAt()`, which is `firstSound`'s `from` (v97's rule).
- Voiced from the first frame (started on the tap): note 1 is out of both counts that attempt; `loudGate` takes this device's `vol.room` (E4) when calibrated.
- Ends: ■ Done, or 3× the phrase + 5 s. No karaoke cursor.
- Slower is never held against the singer: 13 of 15 occasional singers were more accurate slower (Dalla Bella et al. 2007). ▶ First note right before singing: a held pitch loses precision over 2–8 s (Wisniewski & Tollefsrud 2023, pure tones).

**D5. The free clock: the singer's line, found by pitch.**
- Notes go at t = a + b·T(q), T = the song's map time (`qToT` at 100%: a tapped timing's shape is followed), from the phrase's first note.
  1. a₀ = `firstSound` (rhythm.js:507), b₀ = the tempo last heard.
  2. b over 0.6–1.5 × b₀ in 3% steps at a₀, then a over a₀ ± 0.3 s in 60 ms steps at the best b, then once more around both. Each candidate graded by `gradeTake` (`MAX_SHIFT` unchanged), scored by its DP cost (a new return field). ~50 calls on ≤ 20 notes; target ≤ 20 ms.
  3. `findOnsets` on the best line (`rt` null, `seedRange` [−0.3, 0.3]): these grades and onsets give the counts.
- Under a third of the notes hit on the best line: no ♩ that attempt.
- Why: grade.js and rhythm.js work from written times, so the search reuses them whole. DTW of the pitch track only if real attempts beat the search.

**D6. The counts.**

**Fixed per phrase**, at the song's own tempo, so totals never move and ↑ compares like with like:
- ♪ counts notes ≥ 0.12 s; shorter ones ride along (graded, kept as data).
- ♩ counts **starts**: the first note and every note with its own syllable ≥ 0.12 s (every non-melisma note without words).
- Notes set aside (D11) count for neither.

**♪ hit:** good or ok (grade.js :112: the moved slot's octave-folded median within 50¢). An `unclear` note (loud, no pitch) doesn't block "all of them" when at least half the counted notes were judged; it brings "Closer to the mic". Why ±50¢: the field's standard (Pfordresher & Demorest 2021), what listeners forgive in voices, and a note's middle rides out vibrato. Q5: the written note or the attempt's own offset.

**♩ on:** within `tolFlag(u)` = clamp(0.33u, 80–160 ms) (rhythm.js:337) of its time: the D5 line refit by Theil–Sen over the *other* measured starts (leave-one-out, ≥ 3 others; else the D5 line, which pitch chose); in Beats, the click grid less the measured trip. A start sung but unmeasured (a legato repeat, a glide) is on when its note was hit and at least half the starts were measured; else no ♩ that attempt.

**Shown:** "♩ 6 · ♪ 8"; ↑ beside a count that beat the last attempt's; "all of them" in place of a count when every one is right. Never "6/9", never a %. "1 to go" would help late in a goal (Koo & Fishbach 2012) but gives the total away (R5).

**Secured:** all of them in 2 of the phrase's last 3 counting attempts (free, Beats for ♩, runs; not Notes) marks ♩ or ♪ on the map; both give ✓ (v76's rule).

**D7. After Done: a win, the counts, one cue** (about 0.8 s after, for the analysis).
- **The win:** the counts themselves when one rose or reached all of them; else one true win from coach.js, no digits ("“grace” on the note", "In on “That”").
- **At most one cue**, with ▶ the note (or stretch) and ▶ you (the attempt there); the first rule that applies:
  - nothing heard: "Didn't hear you" (no counts, never a miss);
  - the whole phrase off by the same amount (median ≥ 60¢ one way, spread < 80¢): "Start note ▶ ▶";
  - the note off longest: "“sweet” · higher ▶ ▶";
  - mostly unclear: "Closer to the mic";
  - for beats, the start furthest off: "“grace” · sooner ▶ ▶".
- A note missed the same way 3 attempts running (a steady step or more): "“sweet” ▶ the score's note · Not what's printed?" (D11).

**D8. No picture, during or after (v1).** Ear hides the lane, chips, syllable colours, 🎤 Pitch and the review's pitch line. Real-time visuals helped pure-tone matching fast (Blanco et al. 2021: beginners' voices 271¢ off at baseline, the feedback group 20¢ with the aid), but gains decayed once they went (Paney & Tharp 2019): the owner's point.

**D9. Beats: three stages; the singer picks, the next is suggested.**
1. **▶ With the click:** the melody, a click, a bar of count-in; mic closed (loud).
2. **● Sing with the click:** count-in and click through the phrase; snap or tap along if you like (nothing measures it). Done, or the end + 2 beats → ♩ only. Today's take path: `beginSing(part)` with the click guide (sing.js:756, `beatGrid` :717), `findClicks` → the trip, `rhythmOf` → each start's class.
3. **The free attempt (D4).**
- **Slower:** 90 / 80 / 70 % for the stage (`retime()`, sing.js:156); no lower, since synchronizing gets harder as the beat slows (Repp 2005).
- **iPhone:** the click is quiet with the mic open (WebKit 196539 / 218012 / 230902): 🎧 once.
- Why: moving to the beat helps find the pulse, non-musicians most (Su & Pöppel 2012; Manning & Schutz 2013); voicing a rhythm ("da") with the hand on the beat is the easy pairing (Mårup et al. 2022). No study shows snapping improves sung rhythm.

**D10. Notes.**
- **Targets:** the lowest, the highest, then the note the last attempt missed most; any note in the row of names (sung spelling) can be tapped.
- **Each:** ▶ (`holdPiano` 1.2 s at `REF_LEVEL`, mic closed); the mic reopens at `MIN_RMS` until `soundGone`. **Matched** = 800 ms within 50¢, any octave, accumulated within 6 s (the range test's rule, voice.js:29–35) → the mic closes and the note sounds again 0.5 s, so the ear checks itself. Else ▶ again; after 2 tries "higher" / "lower".
- During a hold: no note name, cents or needle; only the level ring.
- An octave apart is said once ("an octave down — fine"). Then "Now the phrase".
- Why: hold-to-match is EarMaster's, Singing Carrots' and the range test's; single notes don't help weak singers more than phrases (Pfordresher & Brown 2007), so Notes ends on the phrase.

**D11. Notes the conversion got wrong.**
- The owner's songs come from PDFs: round 3 still found ~0.37 wrong-playing errors a system after engine 19 (docs/ACCURACY.md), and Sing's melody is each chord's top note (`pickMelody`). A misread note would block "all of them" for good and drill a pitch that isn't printed.
- **"Not what's printed?"** on a note (its cue, or Notes' row) takes it out of both counts for that phrase's key; ▶ the score's note plays what Resonate has. Stored with the phrase; a Reconvert that fixes it changes the key, and the set-aside goes too.

**D12. Rejoining the song.**
- Sing from here and Sing it through stay: count-in, click guide, the score's clock, lane off; the assistant's whole takes, as today.
- Per phrase reached: the win, the counts (♩ against the click grid less the trip), ▶ You / ▶ Melody; all of them there counts toward securing.
- One tap away because children taught whole songs made fewer errors than phrase by phrase (Klinger et al. 1998).

**D13. Not in v1:** a drone, solfège or hand signs, a "hear it in your head" pause, a "Felt right?" tap before the counts (the evidence favours one — Swinnen et al. 1990: instant results leave no time to judge yourself; Barros et al. 2019 — but it's a tap per attempt), a "da" stage, pairs in Notes, a picture after Done, a Score highlight as the phrase, Ear data to the assistant and sync (v1.1).

## 3. Screens (a phone's Sing region; the iPad the same, wider)

```
‹  “Amazing grace!”  ›        ← the phrase list (♩ ♪ ✓ each; Sing it through)
   Amazing grace!             ← tap a word, then another: your own phrase
   ▶ First note   ▶ You
   ✓ “grace” on the note
   ♩ 3 ↑   ♪ all of them
   “A-” · sooner    ▶ note  ▶ you
   ▭▭▬▭▭▭  (the map)
   Beats   Notes
dock:  ▶ Hear (was Listen)    ● Sing (■ Done while singing)
```
Singing: the words, then ■ Done with its level ring. Beats: ▶ With the click · ● Sing with the click · Slower. Notes: the names, the target glowing, ▶ again. No counts before the first attempt.

## 4. Data

`resonate.sing.ear` (localStorage), device-only in v1 (v1.1: a `song_state` row `"<song>|ear"`, merged per phrase). In `DATA_KEYS` (space.js:27: shelved and parked with the account), forget.js `PER_SONG` (:16) and sync.js's tombstone list (:289), so a deleted song takes it along.

```
{ [songId]: { v: 1, alg: EAR_ALG, last: wk, own: [{ j0, j1, wk }],
    p: { [wk]: { a: [{ at, k: "free"|"beats"|"notes"|"run", nh, nn, bo, bn, an, ab, b, oct }],  // last 6
                 sec: { n: at | 0, b: at | 0 }, aside: [k…], holds: { [midi]: at } } } } }
```
- `nn` / `bn` (totals) are data, never shown; `an` / `ab` = all of them; securing reads `a`.
- `wk` (music + words): repeats share a record, a transpose keeps it. `aside`: note offsets in the phrase. `own`: kept while its notes still give that `wk`.
- `alg` bumps when the phrase rule or the counting changes; a record whose `wk` is gone is kept, not shown.
- `resonate.sing.practice` is no longer written.

**Clips** (library.js `putClip`, :377): `"<song>#ear#<wk>"` (the latest attempt that hit every note: ▶ You) and `"<song>#earlast"` (the cue's ▶ you), each the attempt's length. `packVoice` (sing.js:2473) is 16-bit at half rate, ≈ 48 KB/s: a 9 s attempt ≈ 430 KB. Device-only; `removeClips` drops them with the song, `countClips` counts them for Sign out's warning. Not in `resonate.sing.history`.

## 5. The assistant

**v1: nothing of Ear uploads** (guided rounds never did; only whole takes, sing.js:842). Today's actions in Ear:
- `sing`: a whole take; `view` ignored (Ear has no lane).
- `loop_line`: opens that line's phrase and plays ▶ Hear once; the singer sings on their own. `go_to_line`: opens that line's phrase.
- `play_take`, `review`: the last whole take, unchanged.
- One redeploy: catalog.ts (those abouts, a `CHANGES` entry); coaching.ts (the loop paragraph, :87: "In Ear, loop_line opens the phrase; nothing reaches you from it; offer a short take"; rule 6: the singer sees ♩ / ♪ counts — say them as counts or "all of them", never a total, a fraction or a %). The 15 tools don't change.

**v1.1:** each attempt a finished `coach_takes` row, `meta.kind = "ear"`, never `live` between attempts; every query on the table (`resolveTake`, `get_live_lines`, `list_takes`, `list_songs`' counts, `live_take` resonate.ts:213, `recent_takes` :239, `prev_take` :272, `pendingSing`) and both prunes (assist.js `takeEnded`, `KEEP_TAKES` :22) filter by kind; attempts get their own legend; set-aside notes go up as suspected misreads.

## 6. Code plan

**New:**
- **`public/ear.js`** (no DOM): `EAR`; `earLines`, `earPhrases`; `counted`; `fitClock` (D5); `theilSen` (new: rhythm.js `trend` is a closure with no intercept); `judgeAttempt({ ph, notes, frames, feat, start, quiet, from, clock, rt, latency, score, lines })` → { grades, onsets, counts, all, win, cue, b, oct }; `holdMatch` (the range test's ~40 lines of hold logic, copied: voice.js stays as E4 left it); `noteTargets`; `applyAttempt(doc, wk, res, now)` → { doc, event }; `marks`.
- **`public/earui.js`**: the view's DOM; markup in sing.html `#ear`; CSS in sing.html's **first** `<style>` (`scopeCss` scopes only that one), under `body[data-ear]`.

**Changed:**
- **sing.js:** `beginFree(ph)` beside `beginSing` (:756) — mic in the tap, `startCapture` + `makeFeatures` + frames, ■ Done after the first frame, the ▶ tail gate — and `finishFree` → `judgeAttempt`. `startPlay` (:1071) gains `{ click, hold, oct }`. The dock: Listen → ▶ Hear, the primary ● Sing / ■ Done. `body[data-ear]` hides `#lane`, `#results`, the chips, the play bar and 🎤 Pitch (each listed: `data-guided`, sing.html:170, leaves `#lane`). `renderMap`, `runSpan`, `applyRunResult` on Ear's phrases; `runBlock`, `planNext` and the card's code go.
- **practice.js:** `groupPhrases` takes `opts.limits`; the step machine goes.
- **grade.js:** `gradeTake` returns its DP cost.
- **coach.js:** `earWin`, `earCue`.
- **space.js, forget.js, sync.js:** the key. **mcp:** §5.
- **CLAUDE.md "UI principles":** the counts rule; coachcases.mjs's digit ban (:265) stays for words.

**Reused:** `lyricLines`, `firstSound`, `findOnsets`, `rhythmStats`, `metricOf` (fed the fitted clock), `holdPiano`, `soundGone`, `micGate`, `openMic`, `getPlayCtx`, the clip store, the sleep / shell hooks.

## 7. Tests

- **`tools/earcases.mjs` (node):** synthetic singers through rhythmsynth.mjs + rhythmharness.mjs: the heard tempo, 20 % slower, 30 % faster, a tapped map; a pickup then a long note; 3 s late; a breath or hum first; started on the tap; ▶'s tail in the mic; one note flat; the phrase 70¢ flat; a 40¢ drift; an octave down; a legato repeat; breathy; half the phrase; silence, noise; a bass. Checks: b within 3 %, counts exact, the same counted set at every tempo, "all" only when true, a start 150 ms off reads off among 4 (leave-one-out), the cue's note, ≤ 20 ms a phrase. Prints every fixture's phrase lengths.
- **`tools/earstate.mjs` (node):** securing; repeats share, a transpose keeps; set-aside notes; own phrases; an `alg` bump; a 500-attempt fuzz never gives "all" with a miss.
- **coachcases.mjs:** `earWin` / `earCue`.
- **`tools/ear.cjs` (browser, the shell, iPhone and iPad; voicetest's oscillator singer, `BLEED=1`):** ▶ Hear with no live track; ■ Done only after the first frame; a late attempt at 90 % → win and counts; no lane, chip, coloured syllable or readout on any frame; ▶ mid-attempt uncounted; ▶'s tail not counted; Notes (no live track under a reference, no readout, holds, the phrase, ✓); Beats; a word span; Not what's printed?; hidden mid-attempt; a reload; `loop_line` opens the phrase.
- **`tools/earwk.mjs` (WebKitGTK):** a free attempt and a hold.
- **Real voices:** ⤓ Last attempt, replayed by tools/earreplay.mjs; the owner's first 10–20 attempts tune `EAR` before the release is done. Never committed.
- **regress.sh:** node cases in the fast tier, ear.cjs / earwk.mjs in main; guided.cjs and practicesim.mjs go.

## 8. Risks

- **The anchor:** a voiced "um" ≥ 80 ms passes `firstSound`; the a-search (± 0.3 s) absorbs a short one.
- **Rubato and fermatas** bend the line; leave-one-out keeps one bent start from moving the rest. Beats is where ♩ means "with the click".
- **AirPods and the car:** REDESIGN §9.3 (off the built-in speaker: parked after a sound; ● Sing is a tap anyway). ▶ starts after a 0.4 s lead-in of the keep-alive source so the route switch doesn't eat the first note. Whether a reopen loses a second: the device spike.
- **The iPhone speaker in Beats:** headphones.
- **Misread notes** (D11); **Reconvert** orphans marks (build after Reconvert all).
- **Phrase-only practice** (Klinger, D12): runs stay one tap away.
- **Visuals** (D8): if the owner plateaus, a picture after Done. **Counts as a scoreboard:** ↑ and the marks alone are one switch.
- **Synthetic singers flatter** (v76's won ~9 rounds in 10): real attempts set the thresholds.

## 9. Open questions for the owner (the default in bold)

1. A phrase: **a lyric line, short ones joined to 4+ syllables, long ones cut at 10 (Amazing Grace: 4.5–11 s)**; or also cut by seconds, inside lines.
2. ▶ during an attempt: **ends it, uncounted**; or pause and resume.
3. Beats: **snap or tap along as you like, unmeasured; ♩ = the sung starts**; or taps as a third count.
4. ⚙ → Guide me off (v75's screen with the lane): **kept**; or removed with the card.
5. ♪: **within 50¢ of the written note**; or of the attempt's own median offset when under ~50¢ (a drift or a slightly sharp voice still gets all of them).

## Sources

- Pfordresher & Brown 2007: https://www.acsu.buffalo.edu/~pqp/pdfs/Pfordresher&Brown_2007_MP.pdf
- Pfordresher & Mantell 2014: https://www.acsu.buffalo.edu/~pqp/pdfs/Pfordresher&Mantell_2014_CogPsy.pdf
- Moore et al. 2008: https://doi.org/10.1016/j.jvoice.2006.10.013
- Pfordresher & Demorest 2021: https://ubwp.buffalo.edu/apal-pfordresher/wp-content/uploads/sites/79/2022/01/PfordresherDemorest_2021_JRME.pdf
- Wisniewski & Tollefsrud 2023: https://doi.org/10.1121/10.0017518
- Dalla Bella et al. 2007, via Berkowska & Dalla Bella 2009: https://pmc.ncbi.nlm.nih.gov/articles/PMC2865000
- Blanco et al. 2021: https://doi.org/10.3389/fpsyg.2021.684693; Paney & Tharp 2019: https://doi.org/10.1177/0305735619854534
- Swinnen et al. 1990: https://apps.dtic.mil/sti/pdfs/ADA191559.pdf
- Barros et al. 2019: https://raw.githubusercontent.com/cartermaclab/carterlab-papers/main/2019_barros-etal_examining-the-impact-of-error-estimation-on-the-effects-of-self-controlled-feedback.pdf
- Klinger et al. 1998: https://doi.org/10.2307/3345757
- Repp 2005: https://doi.org/10.3758/BF03206433
- Su & Pöppel 2012: https://doi.org/10.1007/s00426-011-0346-3
- Manning & Schutz 2013: https://experts.mcmaster.ca/scholarly-works/383712
- Mårup et al. 2022: https://pmc.ncbi.nlm.nih.gov/articles/PMC9110414
- Koo & Fishbach 2012: https://doi.org/10.1086/663827
- EarMaster 6 User Guide: https://www.earmaster.com/download/EarMaster%206%20User%20Guide.pdf

## Review notes

- 16: word spans are in v1; a Score highlight as the phrase waits (D13): it's in written bars, Ear's phrases in performance order, ambiguous across repeats.
- 5: a grid search, not DTW: it reuses `gradeTake` whole, and leaves only small per-note shifts, so no `maxShift` option.
- 2: the misread's trip to the assistant waits for v1.1 with Ear's upload (4's lean option).
- 11 (Swinnen): cited for the deferred "Felt right?" (D13), not added to v1: a tap on every attempt.

## As built: the v101 prototype (2026-11-23)

The owner approved a quick prototype ("take it easy on the reviews … very early feedback"), with Beats and Notes in it ("pretty much the main thing I care about"). Built in sing.js "Ear" (one section) + sing.html `#ear`, replacing the guided card while ⚙ → Guide me is on (Guide me off: the v75 screen, unchanged). What it does, against §2:
- **Phrases (D2):** practice.js `groupPhrases` with `PRACTICE.phrase` set to 4–10 syllables, no seconds limit (Amazing Grace: 4 phrases — its lyric lines join two clauses each); ‹ › moves between them; the words show; no lane, no chips, no colours, no pitch readout (D8).
- **Sing (D3–D7):** ▶ Hear / ▶ First note (mic closed, the piano); ● Sing → mic open, nothing sounds, ■ Done after 0.25 s of frames, ends by itself at 3× the phrase + 5 s. `earFit`: b over 0.6–1.5 in 3 % steps, a over ±0.3 s, a finer pass — each candidate graded by `gradeTake`, the one hitting most notes kept (~70 calls, ~200 ms). ♪ = hit notes ≥ 0.12 s; ♩ = hit starts within clamp(0.33 beat, 80–160 ms) of a Theil–Sen line through the hit notes' moved starts (none when under a third of the notes hit). Shown "♩ 7 · ♪ 10", ↑ against the last attempt, "all of them"; a win ("That's it" when both are all, else the first note on pitch), one cue (start note higher/lower → the note off longest → closer to the mic → a start sooner/later) with ▶ note / ▶ you (the attempt's recording there).
- **Beats (D9):** ▶ With the click (the phrase on the piano, a count-in bar, the click; mic closed), ● Sing with the click (the guided take path: `startSing` with `guided`, the click guide, the phrase's span; ♩ = starts whose `take.rhythm.notes` class is on / close), Slower 90 / 80 / 70 %.
- **Notes (D10):** targets the phrase's lowest, highest and the last free attempt's most-off note; the names row (the key's spelling), any tapped; ▶ the note (mic closed) → hold: 800 ms within 50¢, any octave, within 6 s (the first 300 ms ignored) → the note again 0.5 s; "▶ again", after 2 tries "a little higher / lower"; an octave apart said once; all done → back to Sing.
- **Not yet:** the map and ✓ marks, your own phrase, "Not what's printed?", the assistant and sync, ▶ during an attempt ending it uncounted (▶ is disabled while the mic listens), the 🎧 tip.
- **Tests:** tools/ear.cjs (a simulated singer: the free attempt slower with a flat note — tempo found, the cue on it —, again all right, Beats, Notes an octave down then on pitch); guided.cjs (the old card) left out of regress.sh; shellsing runs with Guide me off.

## As built: round 1 (v103)

Two persona reviews of the prototype (a beginner, an experienced singer) found Ear's judgments untrustworthy first, then the words, the flow and the navigation. The fix plan (WP0–WP7) built every owner question with its default: the printed line (Q-A), any octave in Notes (Q-B), a direction from the 2nd miss (Q-C), one cue (Q-D), no on-pitch fill (Q-E), ♪ against the written note (Q-F), the tuner hidden (Q-G), no Beats under 70 % (Q-H), ▶ ends an attempt uncounted (Q-I), runs next round (Q-J). The judgments are `public/ear.js` (no DOM; `tools/earcases.mjs` runs the page's own code on synthetic singers); sing.js "Ear" keeps the sessions and the screen.
- **Lines:** the printed line — a lyric line, short ones joined to 4+ syllables, cut near 8 (`EAR_PHRASE`; Amazing Grace: its four hymn lines, 9–11 s). ‹ the dots › (≤ 10 lines; else the open line's first words ▾ — the owner's nine songs have 17–57 lines each, 0.7–19.5 s, median 2.3–8 s —; ♩ or ♪ secured fills a dot dim green, both bright, a new mark pulses once) → the **Lines** sheet: a row per line (♩ ♪ green once secured), a tap goes there; **Pick words…**: the song's words as buttons, the first then the last (whole words, one section, 2+ words, ≤ 16 syllables — the rest dimmed) → a line of the singer's own (★, a diamond dot, after the line it starts in; ✕ twice removes it), judged as any. A short line needed three rules (ear.js; printed lines unchanged): with ≤ 4 counted notes a fit's tie goes to the tempo nearer the one heard (`shortLine`); with fewer than 4 measured starts there's no leave-one-out — the starts are judged on the singer's line with 5 % more room per second from the first (`fewSlack`) and no "held long" step (three starts can't tell a step from a tempo); and a hit needs ≥ 15 % of its slot's frames within 50¢ (`hitMin`: a slot over two wrong notes either side of the target has its median "on" it — a 3-note line's flat last note under the held "the" fitted 26 % fast, 1 attempt in 8 in the browser). The line open is kept per song.
- **Line** (`judgeFree`): ▶'s tail gated out (MIN_RMS until `soundGone`); a false start re-anchors; the key offset from a pitch-class histogram (≥ 90¢ and the tune right: another key — no ♪, "The tune was right", **Lower / Raise the song**: the Key menu by those semitones, "Key A♭ → F", ▶ Hear it first again); the singer's tempo 0.5–2.2× (ties to the smallest slot moves); ♪ regraded with grade.js `maxShift: 0.1` (a new option: a slot can't borrow its neighbour's pitch); ♩ from the recording's onsets (findOnsets), each start against a leave-one-out Theil–Sen line through the others, an unmeasured start never cued; notes after the singer stopped left out ("Keep going to …").
- **Beats** (`judgeBeats`): each start against its click (the grid less the measured trip; +40 ms uncalibrated), not against the take's own lead — a steady lag is "Behind the click"; a count off, a drift, a note held long, a start not sung. The count-in row (a dot a click, bar by bar, the first word lit at the entry) for ● Sing and ▶ Hear alike; the level ring neutral; ▶ Click / ▶ You; 🎧 once on a touch device.
- **Notes:** targets — the notes the last Line attempt sang off or left out (≤ 3, "Off last time"), then the lowest and highest; the row low → high with each note's syllable; hold 800 ms within 50¢, any octave (an octave apart: the song's ▶s follow the singer's octave, "Octave down" undoes it); a miss: "Not yet", from the 2nd which way and how far ("That's another note" beyond 4 semitones), from the 3rd ▶ Sing along · Next note › and on the top / bottom note "Too high for now?" [Lower the song]; all held: "✓ Those notes — now the whole line", ● Sing.
- **Words** (`earText`): the win (✓), the counts with their units ("♩ 7 on the beat · ♪ 9 in tune", "all"; never "—", 0, ↑, a fraction or a %; a count that rose since the last whole attempt here at this speed in green), "You sang it at ♩=62" when well off, one cue naming the whole word with its syllable underlined and its ▶s (▶ Piano — a timing cue's stretch at the singer's tempo —, ▶ You, ▶ The rest, ▶ Click), one next chip (Practise that note › / Try it with the clicks › / Next line › / Now on your own ›: they switch, nothing starts). Hints the first times; **Normal · Slow · Slower** is the ♩ menu (100 / 80 / 70 %), never compounded.
- **The shell:** an attempt is a take (the tuner, a live pitch readout, hidden while Ear shows; the cloud and a stale reload wait); the dock's labels (● Sing → Mic… → ■ Done; ● Match; Hear / Stop under the round ▶).
- **The store** (`resonate.sing.eardata`, device-only; DATA_KEYS, forget.js, sync.js's tombstones): per song the line open, the singer's octave, Slow on a song's own tempo, the own lines `{ j0, j1, wk }` (found again by their wk after a reconversion moves them), and per line (by its wk: a repeat shares it) when ▶ Hear played it (3 h counts as heard), its last whole attempts (6 a kind: counts, all, the win and cue as offsets in the line, speed, key) and `sec { b, n }`: **secured** = "all" in 2 of the last 3 attempts that counted it (♪ Line; ♩ Line and Beats), kept once earned. From it: "Last time" (dimmed) on a line sung before a reload, and what "more … than last time", "right on it now" and "Spot on — twice running" compare with.
- **Not yet:** "Not what's printed?" (D11), runs and the map (D12), sync and the assistant (v1.1), thresholds from real voices.
- **Tests:** `tools/earcases.mjs` (fast tier: the plan's tables as cases, each sung twice the same; the store, securing, Pick words; with `PLAY_SCORES` the owner's songs' lines from `OUT=$PLAY_SCORES/notes node dumpnotes.cjs`), `tools/ear.cjs` (main: sing.html and the shell on a phone and an iPad), coachcases (the words' bans), synclib (the store goes with a deleted song); earprobe / earwalk for reviews.
