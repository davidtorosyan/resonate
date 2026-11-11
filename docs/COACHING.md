# Guided practice — v1 decisions and module contracts (v76)

This sits on top of the full design spec below (sections 1–10). Where they differ, this wins.

## The approach in one paragraph

A song is practised **phrase by phrase**. Each phrase earns three marks in order — **♩ in time**, **♪ in tune**, **✓ in the song** — but nothing is locked: a phrase already in time and in tune gets both at once, and the singer can always pick something else. The site, not an LLM, picks **one next step** and puts it on **one card with one button**; rounds then run by themselves (listen → your turn → result) until the stage is secured (2 passes in the last 3 counted rounds, the latest with less help on screen). Feedback is **one win and at most one cue**, never a score. Struggle steps down quietly (same again → slower 90% → 80% → move on to another phrase and come back), uncertain data says nothing, and every block ends. Phrases rejoin the song in **runs** (sing from a bit before to a bit after, lane off), which give ✓. Accomplishment is the **song map** filling up and **▶ Then → Now**: the same lines from the first try and from now, played back to back, shown only where it's true.

## v1 cuts (from the spec)

- **No joins** (§3.5): runs do the chaining. Rule 4 of §4.1 is dropped; ✓ comes only from runs (and "Sing it through").
- **No fallback adoption** (§3.1): orphaned state is kept, not re-matched.
- **No beat-pulse bar and no 🎧 hint** in v1.
- **No sync** of practice state (v1.1); it is in `DATA_KEYS` so spaces shelve/park it. No `mergePractice` needed yet.
- **More ›** has three parts: **Lines** (the map as rows, tap = practise it, ▶ from here), **Today** (▶ Then → Now, what moved), **Tools** (Loop, Pitch, Keys/chips, Play, Last take/review, Sing it through, Guide me off).
- Everything else in §v1 of the spec stays: phrases, sections, verdicts with the engine fixes, ladder (same / slower / rotate / park / self-check / overrule), runs, Sing on, Sing from here, Hear it, first run, credit, Then → Now, Guide me (on by default; off = v75 exactly).

## Module contracts

### public/practice.js (new, pure — no DOM, no imports)

```js
export const PRACTICE = { /* §8.1 constants, minus join/adoption entries */ };

// notes: the Sing page's notes, each { wmidi, midi, q, dq, t, d, text, syllabic, melisma, restBefore, pass, measure, mi }
//   (t/d are song seconds at the current rate; q/dq quarters; wmidi = as written, midi = as sung)
// lines: lyricLines() — arrays of note indices (the karaoke lines)
// opts: { spq: song's own seconds per quarter (rate-independent), barQAt(q) → quarters in the bar at q,
//         measureOf: score.measureOf (played measure → written measure) or null }
export function groupPhrases(notes, lines, opts)
// → { phrases: [{ i, js, lines, j0, j1 /*exclusive*/, q0, q1, t0, t1, sec, syl, name, words, mk, wk, hardBefore, section }],
//     sections: [{ i, p0, p1 /*exclusive*/ }] }
//   name = the phrase's first words (≤ 4 words, ends with "…" when cut), or "Bars 12–14" without lyrics.

export function newDoc()      // { v:1, heard:0, firstRun:0, lastAt:0, runs:0, runsSinceTop:0, stepsSinceRun:0, tuneSinceRun:0, m:{}, w:{} }
export function newSession(now)

// What sing.js computes per phrase after a round or run (see "PhraseRhythm" below) plus the grades:
export function timeVerdict({ ph, r, grades, notes, tapped })   // grades/notes: whole arrays, index by ph.js
export function tuneVerdict({ ph, r, grades, notes })
// each → { v: "pass"|"try"|"unsure"|"unknown"|"unheard"|"slip", cue: { kind, j?, dir?, note? } | null,
//          facts: { entryOk, entryJ, heldOkJ, steady, goodLongJ, allFound, ... }, ev: "onsets"|"shift"|null }
//   ("slip" is a counted try whose cue is a counting slip; keep it distinct so words can differ)

export function phraseMarks(doc, ph)      // → { time, tune, song, reached, slower, thin } (booleans) for the map/rows
export function applyRound(doc, session, ph, stage, verdict, setup, now)   // → { doc, session, event: null|"secured"|"rotate"|"park"|"self-check", alsoTune: bool }
export function answerSelfCheck(doc, session, ph, stage, yes, now)          // → { doc, session, event }
export function overrule(doc, session, ph, now)                             // ♩ by "override"
export function applyRun(doc, session, song, covered /*phrase idxs*/, results /*[{time, tune}] verdicts per covered phrase*/, run /*{ rate, guide, first, at }*/, now)
//   → { doc, session, moved: [[i, mark]], improved: [i] /*phrases whose "then" run was worse and passed now*/ }
export function markHeard(doc, now)
export function nextStep(doc, song /*{ phrases, sections }*/, session, now)
//   → { kind: "hear"|"first"|"stage"|"run"|"singon"|"through"|"finish"|"selfcheck", stage?: "time"|"tune",
//       p?: phrase idx, from: phrase idx, to: phrase idx (inclusive),
//       setup: { rate /*multiplier on the song's rate: 1, 0.9, 0.8*/, confirm, lane: "on"|"neutral"|"off", view: "practice"|"perform", listen },
//       extra: null|"slower"|"full speed"|"stop"|"again", alt: [step] /*next-best, for More*/ }
export function pickPhrase(doc, song, session, p, now)    // the singer chose a phrase (More → Lines): its step
export function stepLabel(step, song)                     // → { title, button } plain strings, few words (§4.2)
```

State shape: §8.1 `resonate.sing.practice` (per song) and `resonate.sing.session` (device only), as in the spec. `practice.js` never touches storage; sing.js loads/saves the doc.

### public/coach.js (add, keep everything that exists)

```js
export function roundResult(stage, verdict, prevCue, notes, ph)   // → { verdict, win: { kind, text } | null, cue: { kind, text, play: { j } | null } | null }
export function runResult(moved, improved, song)                  // → { headline: string|null, win: string|null }
```
Words per §5 tables. No digits except in note names, no "%", "fail", "wrong", "score". A pass shows only a win; unsure/unknown never a fault.

`verdict.shown` (optional): the win texts the card showed in the last few rounds, newest last (sing.js keeps ~6). With it the win rotates among the true ones: a progress win unless it was the last one shown, else the first true win not shown, else the one shown longest ago. "With the beat" / "In tune" (true of every pass) takes its turn on passes. A true win is never dropped. Without `shown`: the first true win, as before.

### Rules settled after the integration check (D1–D7)

- **Phrases that ride along** (`ph.ride`: fewer than 2 syllables with words, or notes in a song without lyrics). A word-less piece cut off by a jump or a new pass joins the phrase before it in performance order (not across a rest of a bar or more), so Killing Me Softly's "Bar 40" and Wichita's "Bars 32–33" are gone. What's left (Piano Man's lone note "Bar 185", "lone.") is never a phrase step, focus-window member, run target or Then → Now: runs that end just before one take it along (no rest between), it gets ♩♪ from a run where it had no try and a pass in time or tune (never the melody guide), then ✓ as usual, and never "· again". Sing on and Sing it through don't wait for it. `pickPhrase` on one returns a run from the phrase before it. `phraseMarks` adds `ride`.
- **"· again" / "· full speed" from runs** need 2 run slips (`m.rs`, the stage in `m.rsk`; a run that holds at the song's tempo starts over). With nothing else left to do, a single slip's "· again" comes at once (rather than the same run straight back). A redo back again in the same session (`session.redos`) counts as a rotation: left out for 2 steps, the second time parked (quietly).
- **"· full speed"** confirms at the song's tempo, whatever tempo the pass was at, and clears only with a pass there.
- **"Good place to stop"**: never before 10 minutes (`stopNotBeforeMin`); again only after 6 more milestones (`stopAgainMarks`). Milestones are §6's: a stage secured (♩♪ at once is one), a section in the song. A run's credit and each phrase's ✓ don't count.
- **No repeats**: a phrase rotated or left out isn't the next step: a run over it in its section comes first (from the section before when its section is one phrase). A run to the same phrase as the last run (whatever its start), a run to a phrase the last run just sang, or any run right after one that moved nothing waits while other work is left; the same run again for the ✓ that new ♪ allows comes only when nothing else is left. "Finish with" shows only after a park from a block.
- **Then → Now / "Better than your first try"**: a phrase only the first time it improves (`w.then.told`).
- **Names** come from the phrase's first lyric line only ("“to quell…”", not "“to quell And they're…”"; `ph.head`, `ph.headCut`) and never start inside a word: a phrase that does (the syllable before left open; or OCR's "begin" on both sides of a jump) is named from its next word ("“but it don’t look…”", not "“cation…”"; joining the syllables back on isn't safe with OCR'd lyrics — Piano Man's "car|and").

### public/rhythm.js (extend; whole-take defaults unchanged)

```js
findOnsets(notes, feat, start, frames, metric, { songT0, rt, latency, endT, unsung, loose = false, seedRange = [-0.15, 0.45] })
//   also returns leadN (attacks behind the steady lead) and seed
glides(..., loose)                         // §3.3 loose glide rule
export function firstSound(feat, start, frames, { songT0, trip, shiftT, from, to })  // → song time | null
export function voiceCover(feat, start, { songT0, trip }, spans /*[[t0,t1]]*/)        // → [share 0..1]
export function noteCover(feat, start, { songT0, trip }, notes, beat)                // → per note share over [t−0.1, t+d+1 beat] (the onset gate)
```

### PhraseRhythm (computed by sing.js `rhythmOf` per phrase, passed to the verdicts as `r`)

```js
{ trust: "ok"|"speaker-guide"|"none", calibrated, guide: "click"|"melody"|"none", tapped,
  lag /* entryLag s, null unknown */, beat /* s per felt beat at the phrase start */, measuredRt /* bool */,
  cover /* voiceCover share */, classified, syllables, obs /* phrase-scope observations, li = phrase */,
  takeObs /* take-scope: behind/ahead */, leadN, seedAgrees }
```

---

# The design spec (reviewed, revision 2)

Research: vocal pedagogy, practice science and motivation design (sources cited inline); drafted from two angles, merged, critiqued for experience and feasibility, revised (2026-11-11).


At any moment the phone shows one card, one button and one short line. The line is something the singer did well, one thing to try, or both. The site picks the next step with plain rules over stored per-phrase state, and no LLM is involved. Every threshold lives in one table (`PRACTICE`, §8.1) so it can be tuned against the owner's real sessions.

Revision 2 folds in the experience and feasibility critiques. Each was checked against the v75 code. The main changes:
- Timing is judged without relying on the pitch grade (§3.3).
- Securing, slowing down and rotating can no longer loop, or park a singer who is succeeding (§3.4).
- Practice can reach any part of the song (§3.5).
- v1 is cut to what the owner's first real sessions need. Sync, kept checks, hear-the-note and key offers move to v1.1 (§9, §10).

## 1. Verdict on the owner's approach

**What's right**
- **Rhythm before notes, per line.** This is the choral default (Wine: speak in rhythm, then sing on one note, then add the pitches; Adams). The stronger reason here is measurement. `grade.js` grades each note in a time slot that moves at most ±0.24 s, so pitch grades on a line sung out of time are noise.
- **Mixing parts of the song.** Practising time-slices is the best-supported form of part practice. Blocking a new item and then rotating beats both pure schedules (Porter & Magill 2010; Carter & Grahn 2016).
- **One suggestion, one button, a quiet "more".** Feedback should cover the single most important thing (Crocco & Meyer 2021), and several instructions at once hurt (Buszard 2017). Choice overload is worst for an unsure novice (Chernev 2015), but removing choice entirely backfires (Duolingo's path petition).
- **Targeted advice once a line is in focus, then "now the notes".** Task → response → one correction (Yarbrough & Price).
- **The three feelings.** Feedback after good trials (Chiviacowsky & Wulf); small wins, because setbacks weigh 2–3× more (Amabile); comparison with the singer's own past.

**What to refine**
1. **Lyrics and rhythm are one activity: the words in time.** The singer always sings the phrase normally. A stage changes only what the site *listens to and talks about*. Words and melody are bound in memory (Serafine 1984), and coupled parts drilled apart transfer poorly (Naylor & Briggs).
2. **Eligibility, not a wall.** The evidence for the order is convention; Bauer 2015 failed to replicate the key study. So notes are never locked. A phrase already in time and in tune gets credit for both, and the singer can overrule.
3. **"Good enough" must be explicit, lenient, and about timing alone.**
   - The rule is 2 passes in the last 3 counted rounds, and uncertain data never fails.
   - A timing verdict must never rest on a pitch grade. Today it does: `rhythmOf` passes `missed` notes to `findOnsets` as unsung. A short note sung a beat late is graded `missed`, because its slot can move only 0.24 s. So the error the In time stage exists for came out as "Sing out".
4. **"Fix A and B, then try again" becomes single steps**, never a list.
5. **The unit is a phrase, not a lyric line.** 45 of Piano Man's 76 lines are under 4 syllables.
6. **Slowing down is the main way to make a step easier** (Dalla Bella 2007). Full speed is a later, separate win: raise the bar with new steps, not by tightening the first gate.

**Add:**
- Hear it, up to the first stop point only.
- Whole → part → whole runs.
- ▶ Then → Now from stored runs.
- "Sing from here" anywhere.
- A "kept" check in a later session (v1.1).

**Drop:**
- a separate lyrics stage;
- fault lists;
- "Round N" and streak dots;
- streaks;
- per-note "mid-line" tries;
- the review sheet that opens by itself.

### Merging the drafts and the critiques

| Conflict | Resolution |
|---|---|
| Grouping | Draft A's boundaries, which prefer rests, with B's numbers. Durations use the **song's own tempo**: a typed or tapped bpm, else a tapped map's average, else the score's tempo, and never the % rate. OMR scores often carry a wrong tempo (Piano Man came in at ♩=58 for 174). |
| Keys | Two keys. A **music key** holds ♩ ♪ and is shared by repeats and by verses with the same tune. A **music + words key** holds reached, ✓ and kept. Both hash intervals, not absolute pitch, so an OMR octave fix or a respelling doesn't orphan marks. |
| Names | Stages are "in time / in tune / in the song", with marks ♩ ♪ ✓, so they read as goals. |
| Display during In time | Neutral everywhere: no pitch colour on syllables, chips, lane bars or the trail. Only timing marks show. |
| Confirm round | **"Lane off"**: note bars and trail are hidden and the layout stays put. Switching to Perform view would re-lay out the screen every other round. Runs still use Perform view. |
| Unsure rounds | They neither count nor break anything. Grade shifts can stand in as evidence. A self-check comes after 2, and Yes secures the stage. |
| Behind/ahead in a round | Counts only when ≥ 4 on-beat attacks set the lead, the round trip was measured at ≤ 0.1 s, and the seed agrees with the lead. |
| Ladder | Slower first. A stage may secure at a slower tempo, and joins and runs check full speed. Rotate after 6 counted rounds; park only after two rotations. "Smaller" and "hear the note" move to v1.1, "Say it in time" to later. |
| After ♩ | The same phrase moves on to tune (block first); rotation starts once ♪ is earned. |
| Picking | Sections of about 75 s, a focus window per section, every 3rd pick from another reached section, and "Sing from here" on any phrase. |
| Sessions | A new session after a 3 h gap. Device-local in v1; kept checks and warm-up in v1.1. |
| Card, map | The card sits outside `#results`, since Perform view hides it. The guided screen hides the play bar, the results row and the chips; they're in More → Tools. ♩ is never amber, because amber means "try". |
| Recordings | v1 has song-level ▶ Then → Now from runs, stored in the existing `voices` store under prefixed keys with no schema bump. Per-phrase clips come in v1.1. |
| Smaller ones | Transpose: marks stand, and v1.1 re-checks them. Tapped timing: only counting slips fail. Tempo is described in words. A "Guide me" switch. |

## 2. Design principles

1. **One step, one cue, one button.** Working memory holds little; "less is more" (Crocco & Meyer).
2. **Sing the whole phrase; only the listening narrows.** Text and melody stay integrated (Hurley & Atkins 2022).
3. **Time, then tune, then the song, as eligibility.** Pitch grading needs timing, but the evidence for the order is weak, so it is never a lock.
4. **Wins first: earned, specific, about the music.** Feedback aimed at the self backfires (Kluger & DeNisi), and setbacks weigh more than wins (Amabile).
5. **Uncertain data means silence; inside the band, just ✓.** A timing verdict never rests on a pitch grade, and a pitch verdict never stands on top of a counting slip. A false "wrong" is worse than saying nothing (Sherwood 1988; app-review complaints).
6. **Twice, and still there next time.** 2 of the last 3 rounds (Duke, Simmons & Cash 2009), plus a later-session check in v1.1 (Rawson & Dunlosky).
7. **Step down quietly, step up visibly, and never loop forever.** Keep most rounds passing (challenge point).
8. **Echo, then fade the support.** The model plays before the singer, never under them (Pfordresher & Brown 2007). The lane is for learning; lane off is for confirming (the guidance hypothesis).
9. **Whole → part → whole; mix after mastery; any part of the song is one tap away.**
10. **Claim then-vs-now only where the data shows it.** People already rate their past selves as worse (Wilson & Ross 2001).

## 3. The practice model

### 3.1 Units: phrases and sections

A phrase joins consecutive `lyricLines()` lines of the current verse.
- **Syllables** are notes that start one (not melisma). In songs without lyrics, count notes instead.
- **Durations** are quarters × the song's own seconds per quarter:
  - `60 / bpm` when the song has a typed or tapped tempo (`resonate.sing.timing[song].bpm`);
  - else `tmap.avg` when a tapped map exists;
  - else `60 / score.tempo`.

  The tempo % menu and the ladder's temporary tempo never regroup phrases.

**Boundaries:**
- **Hard** (always close):
  - a rest of ≥ 1 bar;
  - a repeat jump, where the played measure's written measure (`score.measureOf`) isn't the previous one + 1;
  - a change of verse pass (`note.pass`).

  Today the page's notes carry neither field: `notesForVerse` keeps `measure` but not `pass`, and `applySong` drops both. v1 adds them.
- **Breath** (`restBefore`): close once the minimum is reached (**≥ 6 syllables and ≥ 2.5 s**).
- **Punctuation:** close only when adding the next line would pass the maximum (**16 syllables or 10 s**) and the phrase already has its minimum.

A short tail joins the previous phrase if no hard boundary separates them and the result is ≤ 1.5× the maximum. v1 never splits inside a line.

Amazing Grace (♩=80) gives 4 phrases: "Amazing grace, how sweet the sound" · "That saved a wretch like me" · "I once was lost, but now am found" · "Was blind, but now I see". The karaoke display still shows lyric lines.

**Name:** the phrase's first words, or "Bars 12–14" when there are no lyrics. The UI never says "phrase".

**Keys:**
- **`mk` (music):** an FNV hash over each note's:
  - interval to the phrase's first note, in written semitones (before transpose and fit shifts);
  - `dq` on a 1/24-quarter grid;
  - rest-before (bool);
  - syllable start (bool).

  It is shared by repeats and by verses with the same tune. Transposing, changing tempo, or an OMR fix that moves a whole phrase by an octave or respells it doesn't change it.
- **`wk` (words):** `mk` plus the phrase's words, as lowercase letters only.
- ♩ and ♪ live on `mk`; reached, ✓ and kept live on `wk`. A second verse with new words therefore starts at ♩♪ (real credit for knowing the tune) but still needs its own ✓.
- **Fallback adoption:** some phrases have no state under either key, for example after an OMR clean-up changed a `dq` or a typed tempo regrouped them. Such a phrase adopts marks from stored entries of the same verse whose first note is within 1 beat of its own and whose words match. A mark is adopted only if every stored entry starting inside the new phrase has it. Unmatched state is kept.

**Sections.** Starting from the entry, a section closes at whichever comes first:
- the first phrase that ends ≥ 75 s after the section's start;
- a verse-pass change, once the section is ≥ 30 s long;
- the song's end.

The first section is the first run's span. Runs, "Sing on" and variety all work in sections.

### 3.2 Stages

| Mark | Stage | Setup | Judged on | Secured |
|---|---|---|---|---|
| — | **Hear it** | ▶ Listen from the entry to the end of the first section | — | — |
| — | **First run**: the first section; the singer can stop anytime | clicks, Perform view | everything, silently | gives credit and the "then" recording |
| ♩ | **In time**: the phrase, sung normally | listen first (melody, mic closed); clicks; lane with neutral colours; the confirm round has the lane off | timing | 2 passes in the last 3 counted rounds, the latest a confirm round. May be earned slower. |
| ♪ | **In tune** | listen first; clicks; live colours; the confirm round keeps the note bars (they're the target) but hides the live trail | pitch (timing only for counting slips) | same rule |
| ✓ | **In the song**: a join or a run | no listen first; clicks; joins with the lane off, runs in Perform view; the song's tempo | both, leniently | 1 pass |
| ● | **Kept** (v1.1): the first run of a later session | Perform view | both | 1 pass, ≥ 8 h after the last mark |

"The song's tempo" means the per-song tempo the singer chose (`rate` as loaded), not 100% of the score.

**Credit for both stages from In time:** an In time pass that also meets the pitch credit bar (§3.3) counts as an In tune pass too. A singer who knows the tune by ear secures ♩ and ♪ together in 2 rounds and goes straight to a join.

### 3.3 Verdicts

Each attempt gives each phrase in the span one verdict per stage being judged: **pass**, **try** (with one cue), **unsure**, **unknown** or **unheard**.

Phrase timing is computed inside `rhythmOf` from the same onsets, grouped by phrase. `rhythmStats` and `rhythmObservations` already accept any grouping. Observations on lyric lines stay as they are, for the review, history and MCP.

**Timing, first match wins:**
1. **Unknown**, and nothing is said, when:
   - there is no recording;
   - `trust !== "ok"`;
   - or the take used the melody guide. That includes takes where the clicks weren't found, because a quiet speaker's piano biases onsets toward "on time".
2. **Counting slip** (try, counted). At the span's start the singer is silent through the count-in, so the first sound is unambiguous.
   - `entryLag` = first sound − the first note's time.
   - First sound is the start of the first run of voiced frames ≥ 80 ms within [first note − 1 beat, first note + 4 beats], moved back to where the vowel-band energy rose (at most 120 ms earlier).
   - With no voiced frames, first sound is the first vowel-band level ≥ floor + 12 dB held for ≥ 150 ms. A click is gone in about 30 ms.
   - It is a slip when entryLag ≥ max(0.6 beat, 0.25 s) with a measured round trip, or ≥ max(0.6 beat, 0.35 s) without one. Only late lags count, since breaths before an entry can look early.
   - A `late-in` or `early-in` observation with `count` is also a slip.
   - Cue: "Count in — “That” a beat sooner" (or "“That” waits a beat").
   - This also catches a phrase sung a whole note late throughout. Without it, each note's window picks up the previous note's attack and the phrase reads as on time.
3. **Unheard** (uncounted): the phrase's notes have vowel-band energy ≥ floor + 10 dB for < 30% of their duration, on the lead-shifted clock. Cue: "Sing out on “x”".
4. **Try** (counted):
   - a phrase-scope `try` observation: late-in, early-in, rushing, dragging, offbeat-late/early, short or held;
   - or, in a round, a take-scope behind/ahead, when all of these hold:
     - ≥ 4 on-beat, non-entry attacks set the lead (`leadN`);
     - the round trip was measured at ≤ 0.1 s;
     - the click guide played and there's no tapped map;
     - the grid seed agrees with the steady lead within `tolOn`.
   - With a tapped timing map, only slips are tries; any other try becomes unsure.
5. **Unsure** (uncounted): fewer than max(2, 40% of syllable notes) are classified (conf ≥ 0.3). Before calling it unsure, the pitch grading's moved slots may stand in as evidence. If ≥ 80% of the phrase's notes are good/ok and each has |shift − the round's median shift| ≤ `tolFlag(u)`, the verdict is a **pass** (`ev: "shift"`).
6. **Pass.** A steady laid-back lag (`style`) counts as inside the band.

**No longer a try:** "more than 15% of non-entry notes early or late". Per-note classes are measured against a lead estimated from the same few notes. At ♩=160–174 the seed can lock an eighth note off, and the 80 ms band is narrow. These counts go into the log `a` only, and mid-line notes stay lane marks.

**Engine changes, for guided spans only** (whole takes outside guided spans keep v75 behaviour exactly):
- **Onset gate:** a note is left out of onset search only if it is `unsung`, or `missed` with vowel energy covering < 20% of [t − 0.1, t + d + 1 beat]. v75 leaves out every `missed` note.
- **The span's first note is an entry**: `met[0].entry = true`, and `rest` = count-in beats × beat. Today `metricOf` decides entries from the song's previous note, so a phrase starting after punctuation wasn't treated as one.
- **Loose glides in In time rounds:** `glides` also accepts a two-level step in the written direction of at least max(1 semitone, half the written interval). Today each side must sit within 0.7 st of its own note, so legato on wrong pitches gives no onsets.
- **Seed range in calibrated rounds:** the lead seed searches −0.15…+0.25 s. Whole takes keep −0.15…+0.45 s, which covers unmeasured Bluetooth.

**Notes (In tune), first match wins:**
1. **Counting slip** in the same round (timing rule 2): uncounted; the slip is the cue.
2. **Unknown**: the score is null (> 50% unclear). Uncounted; cue "Closer to the mic".
3. **Pass**: score ≥ 0.80, no `missed` reason, and no `off` note lasting ≥ 1 beat.
4. **Try**: one cue, chosen by the priority in §5.

**In the song** (joins, runs): a pass unless timing or tune is a try, slips included. Unsure and unknown get the benefit of the doubt, but ✓ only goes to phrases that already had ♪.

**Credit** from the first run, any run, free takes and "Sing it through":
- ♩ for a timing pass, by onsets or by shifts, with the click guide or no guide. Never from a melody-guide take.
- ♪ when ♩ holds (now or from before) and pitch meets the **credit bar**: score ≥ 0.90 and no pitch reasons.
- ✓ only for a phrase that already had ♪ before this run.

### 3.4 Securing, the ladder, and moving on

**Counted rounds** are passes and tries. Unsure, unknown and unheard rounds don't count and don't break anything.

**Securing** (per phrase, per stage):
- `recent` keeps the last 3 counted results. The stage secures when the latest counted round is a pass in the confirm setup and `recent` holds another pass.
- The next round is a **confirm round** if one of the last 2 counted rounds was a pass; otherwise it's a learning round.
- A failed confirm leaves the earlier pass in place, so the confirm is tried once more before going back to learning rounds. Nothing visibly resets.
- A confirm runs at the tempo of the pass it confirms. The mark records that tempo.
- A mark earned slower is a real mark. Full speed is checked where it matters, in joins and runs at the song's tempo. A phrase whose timing slips there gets a "· full speed" step.

**Ladder** (learning rounds; `miss` = counted tries in a row, reset by a pass):

| miss | In time | In tune |
|---|---|---|
| 1 | same again; the cue stays on the card through the listen | same again |
| 2 | **slower**: 90% of the song's tempo | same again (v1.1: hear the note) |
| 3 | slower: 80% (the floor) | slower: 90% |
| 4+ | stays at the floor | slower: 80% |

Every rung is silent: the card just shows the next setup ("· slower").
- **Rotate:** after 6 counted rounds in one block without securing, the plan moves to another phrase ("Back to this one later"). This phrase is left out for the next 2 steps and keeps its tempo and `recent`.
- **Park:** a phrase rotated away twice in one session without securing is left out until the next session. If the session ends there, the card offers "Finish with “X”" (a phrase with ✓ or ♪), so it ends on something the singer can do.
- **Self-check:** after 2 uncounted rounds in a row, the loop pauses: "Sounded right? ▶ You · ✓ Yes · Again".
  - **Yes secures the stage** (`by: "self"`) and marks the phrase `thin`. From then on its first uncounted round goes straight to the self-check.
  - ▶ You plays the round's own recording; rounds now keep their audio.
- **Overrule:** More → "Timing's fine → in tune" sets ♩ (`by: "override"`).
- **v1.1 rungs:**
  - **Hear the note** (In tune, miss 2), done in sequence: the note plays for 1.2 s with the mic closed, then the mic opens with the piano silent, counting frames from 0.35 s after it stopped. "✓ That's A♭" after 0.8 s within 50¢.
  - **Smaller** (before rotating): the cue's word plus the 2 beats before it, at least 2 s and 3 syllables, starting on a beat; otherwise the half of the phrase that holds the cue.
  - **Hesitant entry**: "Hear “Its” first ▶", only when the entry's own pitch is also off, judged on frames from its onset to onset + min(d, 0.3 s), not on its graded slot. Lateness alone no longer sends the singer to pitch work.
- **Later:** "Say it in time", which needs the energy gate tested on speech.

Nothing loops forever: every block ends by securing (≥ 2 rounds), rotating (6 counted rounds) or a self-check (2 uncounted rounds).

### 3.5 Rejoining the song, and reaching all of it

- **Join**: when P secures ♪ and a neighbour (the phrase before, else the one after; same section, no hard boundary between them) has ♪ or ✓, the two are sung as one span with a count-in, lane off, at the song's tempo. A pass gives ✓ to both. If a phrase's timing slips, its next step is "· full speed" (if its mark was earned slower) or "· in time again".
- **Run**: due after 4 steps since the last run, or after 2 phrases newly reach ♪. The card says "Sing to “X”", within the current section.
  - **Checked** phrases are those with ♪ but no ✓.
  - **X** is the last checked phrase, or the first unreached phrase if there are none.
  - **Start**: the section's start if it is ≤ 15 s before the first checked phrase, and every third run anyway (whole → part → whole). Otherwise one phrase before the first checked phrase. Runs are capped at 90 s.
  - **End**: the run stops by itself 0.8 s after X (the `to_line` mechanism).
  - Setup: Perform view, clicks, the song's tempo.
- **Sing on**: when every reached phrase of the current section has ♪ or ✓ (or is parked), the next step is the next section's first run, starting one phrase before it. This is how practice moves through a long song.
- **Sing from here** (More → Lines, any row): a run from that phrase to the end of its section. It reaches phrases the plan hasn't got to, and the singer can use it at any time.

### 3.6 Variety without choices

- A new phrase is **blocked**: ♩, then its ♪, then its join.
- After that the picker **rotates**: never the same phrase twice in a row (unless it's the only one), stage types alternate, and runs come in between.
- **Focus window**: the first 3 reached, unfinished phrases of the current section that aren't left out.
- Once 2 or more sections are reached, **every third pick comes from another reached section** that still has unfinished phrases.

## 4. The one next step

**Inputs:**
- Per phrase: marks, step state, the last cue, when last practised.
- Per song: heard, runs, first run, steps since the last run.
- Per session: start, steps, what moved, rotations and left-out phrases.
- The tempo.

### 4.1 Rules, first match wins

`nextStep(doc, song, session)` in `practice.js` is a pure function, tested in node.

1. **Hear it**: the song has never been heard, has no history, no saved last take and no run.
2. **First run**: no run yet. A saved v75 last take that still fits (`takeFits`), with its recording on this device, counts as the first run: it gives credit from its grades and rhythm, and its audio becomes the "then".
3. **P · in tune**: ♩ was just secured on P, by any route, and P has no ♪.
4. **Join**: ♪ was just secured on P and a neighbour qualifies.
5. **Run**, when one is due.
6. **Sing on**: the current section's window is empty and unreached phrases remain.
7. **Pick a phrase**:
   - Candidates: the focus window (or, on every third pick, another section's window), minus the last phrase practised (unless it's the only one), minus left-out phrases.
   - Stage: the first of ♩ → ♪ → ✓ (a join) that isn't secured, or "· full speed" when a join or run slipped on a slower mark.
   - Rank, highest first: join-ready; one fix away (a pass in `recent`, or a single cue last time); a different stage type from the last step; lower stage; earlier in the song.
8. **Sing it through**: once every phrase has ✓, a guided whole take in Perform view. v1.1 adds the performance steps: no clicks, and full speed when the song's tempo is under 100%.

**Ending a session:**
- After a run, if ≥ 2 marks moved this session or 20 minutes have passed, the card adds "Good place to stop". It shows once, and again only after 2 more marks move.
- After a park, the card offers "Finish with “X”".

v1.1 adds, ahead of rule 3: the key offer, the warm-up kept check, and due re-checks.

### 4.2 Wording and the button

| Step | Card | Button |
|---|---|---|
| hear | Hear it first | ▶ Hear it |
| first run | Sing to “Was blind” | ● Sing |
| in time | “That saved a wretch…” · in time | ● Go |
| slower | “That saved…” · in time · slower | ● Go |
| full speed | “That saved…” · full speed | ● Go |
| in tune | “That saved…” · in tune | ● Go |
| confirm (between rounds) | Once more, lane off | ■ Stop |
| join | “I once was lost” + “Was blind” | ● Go |
| run | Sing to “Was blind” | ● Sing |
| sing on | Sing on to “Through many dangers” | ● Sing |
| self-check | Sounded right? | ✓ Yes · Again · ▶ You |
| finish | Finish with “Amazing grace” | ● Go |

- The footer's right button **is** the plan's button.
- ▶ Listen on the left stays a free tool and plays from the cursor. The card puts the cursor at the step's phrase.
- During a step the button reads ■ Stop, and rounds run on their own: listen → your turn → result → next.
- A secured stage ends the loop, and the button becomes the next step.
- After a Stop, the same step waits behind ● Go, so running it back is one tap.

### 4.3 More ›

One bottom sheet, in the `#review` container:
- **Other**: the next-best candidate; "Sing it through" (a free whole take with the singer's own guide and view); "Timing's fine → in tune" on a ♩ step; "I know it" on Hear it.
- **Lines**: the map as rows. Tapping a row makes it the step; "▶ from here" runs from it.
- **Today**: what moved this session; ▶ Then → Now; the map after the first run, shown above the map now.
- **Tools**: ⟳ Loop, 🎤 Pitch, Keys (shows the chips), ▶ Play (Voice/Melody/Both), Last take (the review), ⤓ last round.

Free actions still count. A ⟳ Loop gives rounds at its phrase's stage, and a free take counts as a run.

### 4.4 After each attempt

- **Pass**: goes into `recent`; either secures the stage or sets up the confirm.
- **Try**: `miss` + 1, and the ladder moves.
- **Unsure, unknown or unheard**: the round repeats; after 2 in a row, the self-check.
- **Join or run**, for every phrase it covered:
  - reached;
  - credit;
  - ✓;
  - the slower flag cleared if the phrase held at the song's tempo;
  - "then" for newly reached phrases;
  - the "now" recording.

## 5. Feedback during and after an attempt

There is one shape everywhere: `✓ <win> · <cue>`, and either part can be left out.
- A cue names a word, a beat or a note, never the body or the person.
- `coach.roundResult(stage, verdicts, prev)` returns `{ verdict, win: {kind, text, play}, cue: {kind, text, play} }`. These are data with a tone.

**During a round:**
- **Listen**: the last result stays up, win included ("✓ In on “That” · Hold “me” full length"). The win stays as long as the cue does.
- **Your turn**: the count-in, plus a **beat pulse**: a 4 px bar over the lyrics and a flash on the card's edge at every count-in and guide click. On a phone the clicks are quiet while the mic is open (CLAUDE.md), so the beat is seen as well as heard.
- Before a confirm: "Once more, lane off".
- On an iPhone, the first time the clicks aren't found (or `coupling` < 2%), the card adds "🎧 helps", once per device.

**After a round** (shown until the next result): the win, then the cue. Wins come only from that round's data, in this order:

| Kind | Example |
|---|---|
| progress (the last cue is fixed) | “That” on the beat now · “me” full length now · “me” on G4 now |
| timing | In on “That” (entry on or close) · Held “grace” full length · Steady (`steady-line`) |
| tune | “sweet” right on A♭4 (the longest note good) · Every note found (none missed or off) |
| tempo | Full speed (the first pass at the song's tempo after slower) |

If no win is true, the cue stands alone. A pass shows only the win. An unsure round shows the win, or "Again", and never a fault.

**Cue priority.** One cue per round; it stays until it's fixed or the ladder moves.
- In time: counting slip > unheard > entry > rushing or dragging > off-beats > short or held > behind or ahead.
- In tune: counting slip > missed > the longest off note > lean > unclear.

| Timing | Cue |
|---|---|
| counting slip | Count in — “Its” a beat sooner · “Its” waits a beat |
| unheard | Sing out on “saved” |
| late-in / early-in | “Its” on the beat · Let the beat go first, then “Its” |
| rushing / dragging | Let the beat lead · Lean toward the next beat |
| off-beats | Off-beat notes a touch sooner / later |
| short / held | Hold “white” full length ▶ · Let go of “white” sooner |
| behind / ahead (round) | A touch behind the beat · A touch ahead — let the beat lead |

| Notes | Cue |
|---|---|
| the longest off note | “sweet” — up to A♭4 ▶ (or down to) |
| missed | Sing out on “saved” |
| lean ≥ 20¢ | A touch flat — lift it · A touch sharp — ease it |
| unclear / unknown | Closer to the mic |

The ▶ on a cue plays the note (tune), or the phrase's melody with clicks from 1 beat before (timing).

**Stage secured:** a 1.5 s green glow with "✓ “Was blind…” in time", and the map segment pulses.

**After a join or run** (no review sheet opens), the card shows, in order:
1. A headline only when a fact backs it: "In the song ✓ “Amazing grace”, “That saved”" (v1.1: "Kept ✓ …"). Otherwise there's no headline.
2. The first true win: "Better than your first try: “Was blind” ▶ Then → Now". If none, the map animates the new marks with no words. After the first run, that animation is the whole message.
3. The next step.

**Never shown:**
- percentages, scores, cents or counts;
- red, or "fail";
- pitch comments or pitch colours in In time;
- live pitch colours in confirm rounds, joins, runs and checks;
- lost marks;
- lists;
- praise of the person, or comparison with others;
- body cues;
- streaks or streak dots;
- "Round N";
- generic headlines.

## 6. Accomplishment

**The song map:** an 8 px strip under the song controls (12 px on desktop), with one segment per phrase sized by duration.
- States: outline → soft purple (♩) → green (♪) → green with a bright top edge (✓). In v1.1 a gold dot marks kept.
- The current step's phrase is outlined in white, and identical repeats light up together.
- A 24 px tap target opens More → Lines.
- It shows the distant goal without a number; the pull comes from seeing it nearly full.

**Lines rows:** the words; ♩ ♪ ✓ lit or dim (with aria labels); "slower" when a mark was earned slower; a repeated line shown once with "×2"; "▶ from here".

**Milestones** each get one green glow and one line, with no sound:
- a stage secured;
- a join ("✓ … together");
- a section in the song ("✓ “Amazing grace” … “I see” in the song");
- the whole song;
- the first full-speed pass of a mark earned slower.

**▶ Then → Now (v1, song level):**
- Every run keeps its recording, on the device only.
- The first run that reaches a phrase is that phrase's **"then"**. That part of the recording is kept for good, along with the phrase's verdicts in that run.
- The latest run at the song's tempo is **"now"**, replaced after every run.
- After a run, ▶ Then → Now appears only when at least one phrase is in both recordings, did worse in its "then" run (a timing or tune try, or unsure), and passed "in the song" now.
- It plays one excerpt of at most 30 s: the run of consecutive phrases with the most such phrases. First the "then" recording, then 0.6 s of silence, then the same phrases from "now". Voice only, each recording aligned with its own round trip. It is one button, which shows ■ while playing.
- More → Today has the same button, plus two strips with no numbers: the map as it was after the first run (marks dated up to the first run) above the map now.
- Per-phrase Then/Now from loop rounds comes in v1.1.

**Session:** "Good place to stop" comes with ▶ Then → Now when there is one. If the session ends mid-struggle, the card says "It settles overnight" (Simmons & Duke 2006).

**Across sessions (v1.1):** a kept check opens a later session and brings the gold dots. No streaks.

## 7. Screens and flows

### 7.1 Layout (390 px phone; desktop is the same, with the card no wider than the lyrics)

```
header (nav · 📡 · v76)
[song ▾][Open][Link][⤓][✕]
[verse][key][tempo][⚙]
▬▬▬▭▬▬▭▭▬▭▭▭               ← song map (8 px)
▔▔▔▔ beat bar ▔▔▔▔
lyrics (prev / now / next)
lane (flex)
┌ “Was blind, but now…” · in time  ┐  ← #coach (the #loopbar styles,
│ ✓ In on “Was” · “see” on the beat  │     moved outside #results)
└                           More › ┘
[▶ Listen]                   [● Go]   ← right button runs the plan
```

With Guide me on, `#playbar`, the results row (summary, ⟳ Loop line, 🎤 Pitch) and `#chips` are hidden; they're in More → Tools. Guide me off restores the v75 screen. During a run (Perform view) the card is hidden, and it comes back with the result.

**Card states:**
- idle (the step);
- listen;
- your turn (count-in, beat pulse);
- confirm;
- round result;
- secured;
- self-check;
- run result;
- hear.

### 7.2 Existing pieces

| Piece | Change |
|---|---|
| ● Sing | runs the plan; a free whole take moves to More → "Sing it through" |
| Review sheet | with Guide me on, it doesn't open by itself; it lives in More → Tools → Last take; ⤓ stays |
| ⟳ Loop | More → Tools; loops the phrase at its stage and updates the marks |
| Guide and Perform settings | still apply to free takes; guided steps set their own (clicks, view, lane) per step without changing the stored choice |
| Perform's live ✓ on the previous line | unchanged for free takes. Off in guided spans: it is pitch-only and appears mid-take, before any timing exists (rhythm is computed at Stop). |
| 🎤 Pitch, chips | More → Tools ("Keys" shows the chips) |
| ⚙ | gains **Guide me** (on by default); turning it off restores v75 exactly and stops all practice writes |

### 7.3 First session: Amazing Grace

1. The map is all outline. "Hear it first" → ▶ plays to the end of the first section. Stopping early still counts once a phrase has played.
2. "Sing to “Was blind”" → ● Sing (Perform view).
   - The map animates: P1 and P3 turn purple (♩), P4 turns green (♩♪).
   - The card shows only the next step: "“That saved a wretch…” · in time".
3. ● Go.
   - Round 1: "✓ In on “That” · Hold “me” full length ▶".
   - Round 2 passes: "✓ “me” full length now", then "Once more, lane off".
   - Round 3 (lane off) passes, with pitch at the credit bar: glow, "✓ “That saved…” in time · in tune".
4. "“Amazing grace…” · in tune".
   - Round 1: "✓ “grace” right on D4 · “sweet” — up to B4 ▶".
   - Then two passes give a glow ♪.
   - Next comes the join "“Amazing grace” + “That saved”", which gives ✓ on both.
5. "“I once was lost…” · in tune" → ♪. A run is now due: "Sing to “Was blind”". The card shows:
   - "In the song ✓ “I once was lost”, “Was blind”";
   - "Better than your first try: “I once was lost” ▶ Then → Now";
   - "Good place to stop".

### 7.4 Return session

- **v1**: no warm-up. The plan continues where it was, and ▶ Then → Now is in More → Today.
- **v1.1**:
  - "Sing to “I once was lost”" opens the visit cold, in Perform view, and brings "Kept ✓ — “Amazing grace”" (a gold dot).
  - A ♪ phrase that didn't hold becomes due, keeps its mark, and comes back later as "“That saved…” · in tune again", with no mention of slipping.

## 8. Data model, storage and edge cases

### 8.1 Practice state

v1 keeps this locally only. It is in `DATA_KEYS`, so spaces shelve and park it, and it syncs from v1.1.

```js
// localStorage "resonate.sing.practice"
{ [songId]: { v: 1,
  heard: 0 | ms, firstRun: 0 | ms, lastAt: ms,
  runs: n, runsSinceTop: n, stepsSinceRun: n, tuneSinceRun: n,
  m: { [mk]: {                                   // ♩ ♪: music only
    time: null | { at, by, rate },               // by: "earned"|"credit"|"self"|"override"; rate < 1: earned slower
    tune: null | { at, by, rate },
    thin: false,                                  // the engine can't hear its timing: self-check sooner
    step: null | { stage: "time"|"tune", recent: [[v, rate, confirm]], miss, rounds, rate, rotated, at },
    a: [[at, stage, verdict, cue, rate, score, ev, extra]],   // newest 12, data only, never shown
  } },
  w: { [wk]: {                                   // reached, ✓: music + words
    q0, words, reached: 0 | ms, song: null | { at, rate },
    then: null | { rec, v: { time, tune } },     // the run that first reached it, and how it went there
  } },
} }
```

**Merge** (used for local writes now and for sync in v1.1):
- marks keep the earliest value;
- `step` is chosen by `at`;
- `a` is a union keyed `at|stage`, sorted, newest 12;
- counters take the max;
- `then` keeps the earliest.

**Session** (`resonate.sing.session`, device only, in `DATA_KEYS`, not synced): `{ songId, start, lastAt, steps, moved: [[key, mark, at]], stopShown, left: { [mk]: untilStep }, rotations: { [mk]: n }, last: { mk, stage } }`. A new session starts after 3 h without practice.

**Device pref:** `resonate.sing.guided` (`"off"` = v75). It isn't shelved, like guide and view.

**Constants:**

```js
export const PRACTICE = {
  phrase:  { minSyl: 6, minSec: 2.5, maxSyl: 16, maxSec: 10, tailMax: 1.5, hardRestBars: 1, dqGrid: 24, adoptBeats: 1 },
  section: { stopSec: 75, passMinSec: 30, runMaxSec: 90, fromTopWithinSec: 15 },
  time:    { slipBeats: 0.6, slipSec: 0.25, slipSecUncal: 0.35,
             firstVoicedMs: 80, firstBackMs: 120, firstEnergyDb: 12, firstEnergyMs: 150, firstWin: [-1, 4] /* beats */,
             heard: 0.30, noteHeard: 0.20, heardDb: 10, evidence: 0.40, evidenceMin: 2, shiftShare: 0.80,
             leadN: 4, seedRound: [-0.15, 0.25], glideLooseFrac: 0.5, glideLooseMin: 1 },
  tune:    { pass: 0.80, credit: 0.90, offBeats: 1 },
  secure:  { window: 3, need: 2 },
  ladder:  { time: { 2: 0.9, 3: 0.8 }, tune: { 3: 0.9, 4: 0.8 }, floor: 0.8,
             rotateAfter: 6, parkAfterRotations: 2, leaveOutSteps: 2, selfCheckAfter: 2 },
  plan:    { window: 3, runEvery: 4, runAfterTune: 2, runFromTopEvery: 3, otherSectionEvery: 3,
             sessionGapH: 3, stopAfterMin: 20, stopAfterMarks: 2, stopAgainMarks: 2 },
  then:    { excerptSec: 30, gapSec: 0.6, pad: 0.5 },
  log: 12,
};
```

### 8.2 Recordings

- **Runs keep their audio** (`keepSeconds: Infinity`). **Rounds keep theirs** (span + count-in + 1 s), in memory only, for ▶ You in the self-check and for ⤓ last round.
- **"Then"**: a `voices` record keyed `"<song>#then#<runAt base36>"`. It holds the run's audio trimmed to the phrases that run first reached, ± 0.5 s: `{ songId, takeId, pcm, sampleRate, start, gain, at, rate, rt, spans: { [wk]: [t0, t1] } }`. Spans are in that take's song seconds, so an excerpt plays correctly whatever tempo it was sung at.
- **"Now"**: `"<song>#now"`, the latest run at the song's tempo, kept whole. Same shape, plus `ok: [wk]` for the phrases that passed in the song.
- They use the same half-rate 16-bit packing as the last take (~48 KB/s). A 75 s section is about 3.6 MB, so a song being worked on holds one "then" per section plus one "now" of ≤ 90 s (~4.3 MB).
- **library.js:**
  - `removeSong` and `removeTake` also delete the key range `[id + "#", id + "#￿"]`. In memory they delete by prefix. Today they delete only the exact key.
  - `countVoices` counts only keys without "#".
  - A new `countClips()` lets the Sign out warning mention "practice recordings" separately.
  - No schema bump is needed: the keys are strings on the existing `songId` keyPath. Sync reads only `takes`, so clips never upload.
- **History:** runs write entries with `whole` as computed (≥ 80% of lines) plus `rate` (data only); rounds don't. A run saves the last take only when it is whole, so a partial run never overwrites a whole take.

### 8.3 Sync (v1.1)

One row per song: `"<song>|practice"`. The plumbing:
- space.js `DATA_KEYS` (already in v1);
- sing.js `SYNCED`, the ✕ cleanup, `flushRemote`;
- sync.js `L`, `localItems`, `known`, and a `cleanField`/merge branch in `apply`.

The critique found six more things the existing sync needs:
1. **take1's "ours is newer" branch** must merge practice the way it merges history, so a newer local copy doesn't push over the cloud's marks.
2. **`mergePractice` is commutative and gives byte-identical results** on both devices, tested as `merge(a, b) ≡ merge(b, a)`. Otherwise fingerprints never converge and devices keep re-pushing.
3. **Clip references stay out of the doc.** Keys are deterministic, so they're looked up in `voices`. On another device ▶ Then → Now hides, but the then/now map strips still show.
4. **Every practice write is read–merge–write**, so the end of a round can't overwrite a mark the cloud just merged in.
5. **Song deletion** (sync.js L249) clears the practice row too.
6. **The first v77 pass re-pulls `|practice` rows** that a v76 client skipped as "unknown setting": reset the pull cursor once, or fetch ids LIKE '%|practice'.

Sessions then start from the synced `lastAt`, so moving from desktop to phone doesn't start a new session.

### 8.4 Edge cases

| Case | Handling |
|---|---|
| Repeats, choruses | One mk/wk with shared marks. The picker uses the first occurrence; any occurrence passing in a run counts. |
| Verses | Phrases per verse. The same tune shares ♩♪; new words need their own ✓. Switching verse redraws the map. |
| Transpose | Marks stand, since keys use intervals. v1.1: a ♪ earned ≥ 3 semitones away is re-checked by the next run. |
| Tempo % change | Targets follow it; grouping doesn't, and nothing is un-ticked. |
| Typed or tapped tempo | Can regroup; marks carry over through fallback adoption. |
| Tapped timing map | Only counting slips are tries. "Slower" works, because the rate divides the map; Stop restores it (tested). |
| Melody guide | Guided steps force clicks. Free takes with the melody guide give no ♩ credit, even when the clicks weren't found. |
| Headphones, Bluetooth | Uncalibrated: relative timing still works; slips need ≥ 0.35 s; behind/ahead never counts. |
| Capture failed | Timing is unknown, so the self-check follows; the phrase becomes `thin`, which leans it toward tune. |
| No lyrics | Notes count as syllables; phrases are named "Bars 12–14". |
| Very long songs | Sections, Sing on, Sing from here. |
| An OMR clean-up changes the notes | Interval keys survive octave moves and respellings; `dq` changes go through adoption; orphaned state is kept. |
| Assistant (MCP) takes | Free takes, so they count as runs. The plan doesn't steer them. |

## 9. Scope, risks and how to judge it

### v1 (v76)

1. **Notes carry `pass` and `measure`** (musicxml.js `notesForVerse`, sing.js `applySong`).
2. **`practice.js`** (pure): grouping, keys, adoption, sections, verdicts, securing and the ladder, joins, runs, Sing on, Sing from here, the picker, merge, `PRACTICE`.
   - Ladder rungs: same, slower, rotate, park, self-check, overrule.
3. **rhythm.js**: the guided gate, the span entry, loose glides, the round seed range, `firstSound`, `voiceCover`, `leadN`.
4. **sing.js**: span sessions (replacing `part`), `retime`, phrase rhythm in `rhythmOf`, and a wait phase for card buttons.
5. **coach.js**: `roundResult`, `runResult`.
6. **UI**:
   - the card, the map, the beat bar;
   - the footer binding;
   - More (Other / Lines / Today / Tools);
   - the guided screen, lane modes, neutral display;
   - the 🎧 hint, Guide me, no automatic review.
7. **Recordings**: then/now in `voices`, ▶ Then → Now, prefix deletes and counts, history `rate`, runs that never overwrite a whole last take.
8. **Data for tuning**: the log `a`, ⤓ last round, `resonateDebug().practice`, `tools/phraseverdicts.mjs`.
9. **Tests** (§10). Every existing suite passes with Guide me off.

### v1.1 (v77)

- Sync of `|practice` (§8.3); sessions from the synced `lastAt`.
- **Kept checks:**
  - A warm-up runs only when some ✓ phrase is ≥ 8 h old and not yet kept. Its span (≤ 90 s) covers the most such phrases, oldest first.
  - Gold dots, due re-checks, "· again".
- Hear the note (in sequence), the smaller rung, the hesitant entry rule.
- **Key offer**: "● Try it" plus a small "Keep key"; `keyOffered` is set either way. It appears only after range-bound misses, or before the first run when the song goes past the profile's limits. It can be undone in More ("Original key").
- Per-phrase Then/Now clips (`#now#<mk>`, from passing rounds at the song's tempo).
- Performance steps: no clicks, full speed.
- Entry lag for every entry after a rest of ≥ 1 beat inside runs, where silence before it is confirmed.
- Pruning orphaned state after 60 days.

### Later

- "Say it in time" (needs the energy gate tested on speech).
- Clicks under the listen.
- The singer's own best take as the model.
- `tolOn` for kept checks, once real-voice fixtures exist.
- A live rhythm pass (ROADMAP v2).
- Lyrics hidden as a performance step.
- "How did that feel?"
- The MCP coach reading `practice`, to add to the site's steps, never to replace them.

### Risks

| Risk | Mitigation |
|---|---|
| False "late" from an unvalidated engine | Tries come only from explicit observations and the count-in entry measure, never from per-note classes. Uncertain data stays silent. Shift evidence can stand in. The self-check (Yes secures) and the overrule. Every verdict logged; ⤓ last round to collect real voices before v1.1. |
| Hollow marks | Credit needs evidence and never comes from melody-guide takes. ✓ needs a run or join at the song's tempo. Marks earned slower are labelled and re-tested at full speed. v1.1's kept needs a later day. |
| Rigid or boring | More ›, Sing from here, rotation across sections, free tools that still count, Guide me off. |
| Loops that never end | 2-of-3 securing, rotate after 6, park after 2 rotations, self-check after 2 uncounted rounds; a fuzz test (§10 step 4). |
| The temporary tempo leaks | `retime` never stores, syncs or announces it; `stopLoop` restores it first; tested with a tapped map. |
| Storage on iPhone | About 4–8 MB per song being worked on, device only, removed with the song, listed separately at Sign out. |
| More UI | The guided screen has fewer controls than v75: the play bar, results row and chips move to More → Tools. |
| Thresholds are guesses | All in `PRACTICE`. The session simulator runs before the UI is built. The owner's first rounds come back via ⤓ before v1.1. |

### Judging it against the owner's three feelings

| Feeling | What a session should show |
|---|---|
| Positivity | Every result leads with a true win or says nothing wrong. About 3 rounds in 4 end in ✓; the simulator and `a` measure it, and `PRACTICE` is tuned if it's lower. No %, no red, no "fail". |
| Progression | A next step is always one tap away. A stage secures in 2–5 rounds, and no block runs more than 6 counted rounds. The map fills during a session, and any part of the song is reachable. |
| Accomplishment | After a run, ▶ Then → Now plays the same lines from the first try and from now, wherever they improved. More → Today shows the map then above the map now. v1.1 adds next-day gold dots. |

## 10. Build plan for v1

Each step lists what changes, the data shapes, and the acceptance tests. Browser tests use the existing simulated singer: review.cjs's fake `getUserMedia` (a sawtooth plus noise driven by `resonateDebug()`, controlled by `window.__plan`) and `node /home/user/tools/serve.mjs /home/user/sitetest 8097`. The plan extends `__plan` with `quiet` (gain 0.02) and per-span `offset`.

### Step 0: real-voice data (runs alongside; doesn't block the release)

**Finding:** the 10 "Amazing Grace take …" JSON/WAV pairs in the scratchpad are test-harness saves, not the owner's voice:
- they come from v57–v71 and carry the fake device ids `WebAudio-…`;
- each is 4.9 s long;
- each has 8 notes good and 33 unsung.

No real-voice take exists, so thresholds can't be fixed from data yet.
- `tools/phraseverdicts.mjs <take.json> [take.wav]` replays a saved take through the new grouping and verdicts, as replaytake.mjs does for rhythm. Per phrase it prints: verdict, cue, classified share, `entryLag`, `cover`, `ev`.
- v1 ships ⤓ last round (More → Tools) and the verdict log `a`. Ask the owner to send 2–3 rounds and one run from his first session, and tune `PRACTICE` before v1.1.

### Step 1: notes carry pass and measure

- musicxml.js `notesForVerse`: add `pass: n.pass ?? 1` to `base`. `measure` is already there.
- sing.js `applySong`: map `pass`, `measure` and `mi` (the played measure index, `measureAt(n.onset)`) onto `notes`.

**Acceptance:**
- tools/repeatcases.cjs, flow.cjs and verses.cjs are unchanged.
- In Wichita, `pass` changes exactly where `score.unfolded.passes` changes.
- In Killing Me Softly, a repeat jump shows as `measureOf[mi] !== measureOf[mi − 1] + 1`.

### Step 2: practice.js core (grouping, keys, sections)

- New module `public/practice.js` (pure, no DOM, imported with `?v=`):
  - `PRACTICE`;
  - `groupPhrases(notes, lines, { spq, measures, measureOf, barQ })` returns `{ phrases: [{ i, js, j0, j1, q0, q1, syl, sec, name, mk, wk, words, hardBefore, section }], sections: [{ i, p0, p1 }] }`;
  - `phraseKeys(notes, js, writtenMidi)`;
  - `adopt(doc, verse, phrases)`.
- sing.js computes `spq`: `60 / timingEntry()?.bpm` if set, else `tmap?.avg` if a map exists, else `60 / score.tempo`.
- Fixtures: `tools/dumpnotes.cjs` (browser) writes notes and lines JSON. Bundled songs go to `/home/user/tools/fixtures/`; the owner's converted scores go to the scratchpad only and are never committed.

**Acceptance** (`tools/practicecases.mjs`, node):
- Amazing Grace gives exactly the 4 phrases of §3.1, with those names.
- Songbird and Piano Man: no phrase under 6 syllables except before a hard boundary, and none over 1.5× the maximum.
- Piano Man with `bpm` 174 groups by 174, not by the score's 58.
- `rate` 0.7 gives identical grouping.
- Transpose +5 gives identical `mk`/`wk`; one phrase moved by an octave keeps its `mk`.
- Wichita and Killing Me Softly: no phrase crosses a pass change or a repeat jump.
- A second verse with the same tune gets the same `mk` and a different `wk`.
- A `dq` change adopts marks only when every covered entry had them.
- The first section ends at the first phrase that ends ≥ 75 s after the entry.

### Step 3: rhythm.js for guided spans

- `findOnsets(…, { unsung, loose = false, seedRange = [-0.15, 0.45] })` also returns `leadN` (the attacks behind the steady lead) and `seed`.
- `glides(notes, frames, shiftT, lead, win, loose)`: with `loose`, it also accepts a step where |median(after) − median(before)| ≥ max(1, 0.5 × |b.midi − a.midi|) in the written direction. The ≥ 3 frames per side and the step-fit test stay.
- New `firstSound(feat, start, frames, { songT0, trip, shiftT, from, to })` returns a song time or null (§3.3 rule 2).
- New `voiceCover(feat, start, { songT0, trip }, spans)` returns, per span, the share of time with vowel-band level ≥ floor + 10 dB.
- Whole-take defaults are unchanged.

**Acceptance** (new cases in tools/rhythmcases.mjs through rhythmharness.mjs):
1. A one-phrase round (the SPEC tune's "Its fleece was white" with its count-in) sung 1 beat late: `firstSound` within 40 ms of the truth, `entryLag` ≥ 0.6 beat, and the guided verdict is `slip`. With the v75 gating the same audio gives `missed` notes; the test asserts the old path would have said "Sing out".
2. A phrase sung one note late throughout gives a slip.
3. Legato on wrong pitches (+2 st on alternate notes, no gaps): with `loose`, ≥ 40% of syllable notes classified; without it, < 40%.
4. Steady eighths at ♩=174, on time, in a single-phrase calibrated round: no try observation and no behind/ahead.
5. A breathy first syllable (120 ms attack) on time: no slip.
6. Loud click bleed with the singer silent for a beat: `firstSound` is not on a click.
7. The 27 existing cases are unchanged.

### Step 4: practice.js verdicts, state, picker, and a simulator (the gate before UI work)

- Functions:
  - `timeVerdict({ ph, rhythm, grades, notes, tapped, guide, round })`, `tuneVerdict`, `songVerdict` each return `{ v, cue: { kind, j, count? }, win, ev }`.
  - `applyRound(doc, session, ph, stage, result, setup)` returns `{ doc, session, event: null|"secured"|"rotate"|"park"|"self-check", setup }`.
  - `applyRun(doc, session, phrases, results, run)`.
  - `nextStep(doc, song, session)` returns `{ kind: "hear"|"first"|"stage"|"join"|"run"|"singon"|"through"|"finish", stage, phrases: [i], setup: { rate, confirm, lane: "on"|"neutral"|"off", view, listen, from, until }, label, alt: [step] }`.
  - `mergePractice(a, b)`.
  - `thenNowExcerpt(doc, phrases, thenRecs, nowRec)` returns `{ wks, then: [t0, t1], now: [t0, t1] } | null`.

**Acceptance** (practicecases.mjs, sequences):
- Securing:
  - pass → confirm pass → secured;
  - pass → confirm try → confirm pass → secured (the first pass is kept);
  - pass → try → try → learning round.
- Ladder:
  - In time tries 1/2/3 → same / 0.9 / 0.8;
  - a pass at 0.9 → confirm at 0.9 → secured with `{ rate: 0.9 }`.
- Rotate and park:
  - 6 counted rounds without securing → rotate; left out for 2 steps; it comes back with its rate;
  - 2 rotations in a session → parked, then "Finish with".
- Uncounted rounds:
  - 2 unsure → self-check; Yes → secured `self` and `thin`;
  - a `thin` phrase goes to the self-check after 1 uncounted round.
- Tapped timing: only slips count.
- Credit:
  - an In time pass at the credit bar secures ♪ too;
  - first-run credit, including none from a melody-guide take;
  - ✓ never from a phrase's first run.
- Joins and runs:
  - a join with the neighbour before, else after;
  - a run is due after 4 steps or after 2 new ♪;
  - run start rules (section start within 15 s, every third run from the top, else one phrase before);
  - Sing on;
  - every third pick from another section.
- Fuzz: random verdict streams over 500 steps never give one phrase more than 6 counted rounds in a block, and never repeat the same step twice in a row (unless it's the only phrase).
- `mergePractice(a, b)` deep-equals `mergePractice(b, a)`.
- `thenNowExcerpt` returns only improved phrases covered by both recordings, ≤ 30 s.

**Simulator** (`tools/practicesim.mjs`):
- 4 singer profiles:
  - by ear: in time and in tune in about 85% of rounds;
  - late entries: first-note slips in 50% of rounds until a tempo step;
  - pitch-weak: tune tries in 60% of rounds;
  - engine-unsure legato: timing unsure in 70% of rounds.
- Run each on the Amazing Grace and Songbird fixtures.
- For a 30-minute session (about 20 s per round, including the listen) and for the next day, it prints the card text step by step and reports:
  - the share of rounds ending in ✓ (target about 3 in 4);
  - rounds to each mark;
  - how many sections were touched;
  - any card shown 3 times in a row.
- Review these transcripts against positivity, progression and accomplishment before Step 7, and adjust `PRACTICE`.

### Step 5: sing.js span sessions and `retime` (no UI change yet)

- Replace `part` with `span`:

  ```js
  { from, fromQ, fromM, until, range, ac, token?,
    stage: "time"|"tune"|"song"|null, guide: "click"|null,
    lane: "on"|"neutral"|"off", view: "practice"|"perform",
    record, keepSec, history, saveLast: "whole"|false, share,
    phrases: [[j…]] | null, untilT? }
  ```

- Change these sites:
  - L730/L743: check the token only when `span.token` is set.
  - L740: `keepSeconds: span ? (span.record ? Infinity : span.keepSec) : Infinity`.
  - L733/L774/L783: `span?.guide ?? guide`.
  - L785: share with assistants when `span ? span.share : true`.
  - L931: build the voice when `!span || span.record || span.keepSec`.
  - L937: rounds return early unless `span.history`.
  - `performing()`: `(span ? span.view : view) === "perform"`.
  - L1231: the count-in check against `session.start`.
  - Runs reuse `take.untilT` and `untilLine` from the remote `to_line` code.
- `retime(r)`:
  - sets `rate`;
  - recomputes `notes[].t/d` from `q`, `songEnd`, `entryT`, `drill.from/until`;
  - calls `renderAll()`;
  - never calls `stopLoop`, `loadTiming`, `saveRate`, `fillTempoOptions`, `assistSong` or `remote.changedSoon`.

  It is called only between rounds. `drill.baseRate` holds the song's rate, and `stopLoop()` runs `retime(d.baseRate)` as its first statement, before `takeFits`.
- `rhythmOf(s, …)` with `span.phrases`:
  - `met[0].entry = true` and `met[0].rest = count × beatSec`;
  - unsung = the Step 3 gate (using `voiceCover`);
  - `findOnsets` with `loose` (stage time) and `seedRange: [-0.15, 0.25]` when `cal` is found in a round;
  - `rhythmStats(ns, on, met, phraseGroups)` and `rhythmObservations`;
  - stores `take.rhythm.phrases = [{ obs, cover, classified, syllables, lag, slip }]`, `take.rhythm.leadN`, and `take.rhythm.calLead` (the strict flag, which v75 computed but never stored).

  `take.rhythm.obs` stays on lyric lines.
- `analyzeLines` gains an `obs` option (phrase observations, `li` = phrase index).
- Card pauses: `drill.phase = "wait"` plus `await waitCard()`, resolved by card buttons or by `stopLoop`.

**Acceptance:**
- With Guide me off, these pass unchanged: loop.cjs, loopguard.cjs, review.cjs, perform.cjs, playafter.cjs, taptiming.cjs, lasttake.cjs, rhythmpage.cjs, chipkeys.cjs.
- New `tools/spans.cjs`:
  - A run from phrase 3 counts in before phrase 3's bar and records audio.
  - It adds a `whole:false` history entry with `rate`, and leaves the saved last take untouched.
  - `takeStarted` is not called for a mid-song run.
  - A slower round has `resonateDebug().rate === base × 0.9`, and its Listen plays at that tempo.
  - Stop mid-round restores the rate; `resonate.sing.rates` is byte-identical; the saved take still passes `takeFits`.
  - The same holds with a tapped map on.

### Step 6: coach.js words

- `roundResult(stage, verdicts, prev)` and `runResult(doc, run)` implement the wins, cues and priorities of §5.
- They reuse `rhythmText` with the new kinds `slip` and `unheard`, plus "beat" wording when guided.

**Acceptance** (`tools/coachcases.mjs`, node):
- Each verdict kind gives the expected text.
- A pass shows only a win; unsure never shows a fault.
- A progress win appears exactly when the previous round's cue kind is fixed.
- No text contains "%", "fail", "wrong" or "score", or any digit outside a note name.

### Step 7: UI

**sing.html:**
- `#coach` after `#lane`, outside `#results`, reusing the `#loopbar` styles;
- `#map` (8/12 px, 24 px hit area);
- a beat bar at the top of `#lyrics`;
- More in the `#review` container (Other / Lines / Today / Tools);
- "Guide me" in ⚙.

**sing.js:**
- `renderCard()`, `renderMap()`;
- `runStep(step)` bound to `singBtn` when guided;
- `laneMode` in the lane drawing:
  - neutral: every bar uses `TUNE.todo`, and the trail has no pitch colour;
  - off: no bars and no trail; bar lines and the now line stay;
- syllable and chip states gated on `span.stage !== "time"`;
- no live previous-line ✓ in spans;
- no automatic `openReview()` when guided;
- `#playbar`, `.results-head` and `#chips` hidden when guided;
- the beat pulse scheduled from `countClicks` and the guide items;
- the one-time 🎧 hint (`resonate.sing.hp`).

**Acceptance** (`tools/guided.cjs`; storage cleared; bundled Amazing Grace):
1. The card says "Hear it first". ▶ starts Listen with `until` = the end of the first section. Stopping after one phrase still sets `heard`, and the card moves to the first run.
2. **First run** (on time, in tune, except 2 wrong notes in P3):
   - no review sheet opens;
   - `resonateDebug().practice` has P1, P2, P4 at ♩♪ and P3 at ♩;
   - the card shows one step;
   - no visible text contains "%".
3. **P3 · in tune:**
   - Round 1 has a wrong note: the cue matches /up to|down to/, and during the next listen the card still shows the same win and cue.
   - Round 2 is right: "Once more"; the confirm round draws note bars without the live trail.
   - Round 3 is right: secured; next step is a join.
4. **In time slip:** a phrase sung with `offset` = 1 beat gives a cue matching /beat sooner/ and not /Sing out/. With `offset` 0 the win matches /on the beat now/.
5. **Slower:** two late-entry tries (`offset` 0.3 s, a late-in each) make the third round run at `rate × 0.9`. Stop restores the rate and leaves `resonate.sing.rates` unchanged.
6. **Self-check:** two quiet rounds (score null) show "Sounded right?"; ✓ Yes secures with `by: "self"`.
7. **Neutral display:** during an In time round no syllable has `data-state` good/ok/off, and `laneMode` is "neutral". In its confirm round, "off".
8. **Join and run:**
   - The join counts in before the earlier phrase, with the lane off.
   - After 4 steps a run starts in Perform view and ends by itself 0.8 s after X.
   - History gains a `whole:false` entry; the last take is unchanged.
9. **Sing from here:** More → Lines → a later phrase's "▶ from here" counts in before that phrase's bar.
10. **Guide me off:** the v75 screen returns, loop.cjs's selectors work, and the review opens after a take.
11. **Persistence:** after a reload (signed out) the practice doc persists.

### Step 8: recordings and Then → Now

- library.js: prefix deletes in `removeSong`/`removeTake` (IndexedDB key range and memory), `countVoices` without "#", `countClips()`, and the Sign out warning text in sync.js.
- sing.js:
  - `keepRunAudio(take, run)` writes the "then" records (trimmed) and the "now" record;
  - `playThenNow(excerpt)` plays two `playVoice` calls 0.6 s apart, under `playGen` so ■ stops both;
  - a v75 last take that fits becomes the first "then".
- ⤓ last round: the round's take JSON (`takeData`, plus phrase verdicts and `metric`) plus a WAV, using the review's `saveTake` path.

**Acceptance** (guided.cjs):
- After a run in which P3 went from a try to a pass, ▶ Then → Now appears. Tapping it starts two voice sources (spied `AudioBufferSourceNode.start`): the "then" excerpt, then the "now" excerpt about 0.6 s after it ends, each as long as the excerpt.
- After a run with no improved phrase, there is no button.
- `voices` holds `#then#…` and `#now` records. ✕ removes them. `countVoices()` counts only the last-take recording.
- Practice recordings are named separately in the Sign out warning (sync4.cjs warning check updated).
- phraseverdicts.mjs reproduces the page's verdicts from a ⤓ last round file.

### Step 9: docs, version, deploy

- CLAUDE.md gets a "Guided practice (v76)" section: model, rules, constants, files, tests. docs/ROADMAP.md marks v1 done and lists v1.1.
- `node bump.mjs 76`, push to `main`, and confirm the deploy.
- Ask the owner to try a song and send ⤓ last round from a few rounds.