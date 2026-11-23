# Piano fingering (E7): design

A draft (2026-11-22, revised after one review). Stage 1, the algorithm (`public/finger.js`), is built: its "as built" section at the end wins where it differs.

## 1. What the owner asked for

An adult beginner learning to read, from Audiveris conversions of pop piano/vocal arrangements. docs/ROADMAP.md E7:

- **R1** Start from existing work: PianoPlayer, Parncutt-style cost models, Nakamura's HMMs and PIG, dynamic programming over hand positions.
- **R2** Run locally after a conversion, like a clean-up: stored with the song, rerun when the algorithm changes.
- **R3** A hand and a finger for every note.
- **R4** Readable by assistants (a `read_resonate` query).
- **R5** On the Score's keyboard: off / finger numbers / a ghost hand.
- **R6** Catch a G3 + B4 the right hand can't span: two hands.

House rules: few words; works signed out. A fingering is a suggestion: nothing counts, grades or marks it wrong.

## 2. Decisions

**D1 — Our own rule-based cost model for the hands; the fingers ours or ac-kit's (a spike decides, §7).** No trained model.

Every published method scores below two pianists' agreement (71.4 Mgen, Nakamura et al. 2020); the learned ones can't ship:

| option | why not |
|---|---|
| Nakamura's HMMs (61.7–64.5) | C++ with no licence; trained on PIG ("only nonprofit, academic use"). |
| ArGNN (66.8) | MIT code, weights from ThumbSet + PIG (restricted); ONNX + MBs of wasm for ~3 points. |
| Smart Piano Fingering (61.9) | GPL-3.0-only; hands fixed per staff (misses R6). |
| PianoPlayer (MIT, Python) | No 1–5 span limit (G3+B4 passes); hands fixed per part. |
| @ac-kit/media-piano-fingering 0.1.3 (BSD-3, 2026-11-15) | Keeps a given hand even past reach, so with staves passed it misses R6. Has Balliauw's hands, printed fingers, early release, a crossing cost; a beam, "~1 s for 917 notes" (its comment); three deps (an esbuild bundle). **A Stage B candidate.** |

Ours, vanilla JS from the published methods:

- **Costs:** Parncutt et al. 1997, Jacobs 2001 (only finger 4 is weak), Balliauw et al. 2017 (rules 13–15, below).
- **Distances:** Balliauw's 14 units an octave (E–F 2, C–C♯ 1).
- **Search:** Al Kasimi et al. 2007's chord trellis, by Viterbi.
- **Spans:** Balliauw's Tables 1, 9, 10 (large, small, medium; pydactyl's match), cited in finger.js and docs/PLAY.md.

Deterministic, explainable (a sum of named costs), no training data, and it gives the hand's position (the ghost). Accuracy: the rule-based VNS reaches 56.7 Mgen / 78.2 Msoft where pianists agree at 70.2: about 2 notes in 5 differ from a given pianist's, about 1 in 5 from every pianist's. A beginner learns what is shown, so printed fingers are kept (§3).

**D2 — Hands from the staff; notes move only at an onset the staff's hands can't play**, each move flagged: R6. Joint methods solve a harder problem, without staves (best 90.8% hand accuracy on PIG: Penner & Hindle 2026).

**D3 — A small hand and beginner weights by default (Q1).** Small: 1–5 comfortable to a seventh, at most an octave. Boyle et al. 2015: an octave clear of the keys' front edge needs ~7.6 in; a ninth at 7.6 in only "with considerable discomfort and not at speed"; non-pianist adults' means 8.3 in (men), 7.6 in (women). An unreachable suggestion is worse than one more hand-over, so v1 errs small; medium (an octave comfortable, a ninth at most) and large are a setting away. The beginner weights (thumb on black ×2, hand jumps ×2) are always on, part of `ALG`; both stored as `hand` ("sb").

**D4 — On the device, in a Worker, after a conversion's save and when a stale song opens** (another algorithm, hand, tempo or MusicXML). No library-wide batch.

**D5 — On the keyboard only (v1), its control at the keyboard's right end**, beside what it changes; the Score's bar is left alone. Digits sparse, as printed music, Synthesia (a hint where "it's time to move your hand") and P.I.A.N.O. ("fingering information for every note overwhelms learners") do. Verovio's `<fingering>` (tested) re-lays the page on every toggle and makes systems 8% taller: on the music, later.

**D6 — Assistants: one cloud table, one query, fingers in the highlight's text** (§6).

**D7 — No PIG by default.** Its terms don't clearly cover a personal app; registering is the owner's call (Q5). Instead: fixtures and a survey (§8).

## 3. The algorithm (contract for `public/finger.js`)

**Input:** ▶'s schedule: `playtime.js` `track(S.T, { bars: written order, keep: the keyboard part, base })` items — ties joined, unisons struck once, an OMR-overfilled voice cut at its barline — with staff and part from `S.Tid`, not `timeline`'s raw `els`.

- **Part:** `views.both` when a piano or a hymn. Piano: staff 1 RH, the last LH, a middle staff by its clef; a one-staff piano has no staff hand. Hymn: treble part RH, bass LH. Else: none.
- **Notes:** struck items and tie continuations (`t`: not struck, the start's hand and finger, kept busy). Grace notes: no finger (v1). A key both staves strike is one key. A printed `<technical><fingering>` (MuseScore's) pins its finger. An `<arpeggiate>` chord's span isn't limited.
- **Time:** ▶'s 100%: the song's own tempo (`resonate.sing.timing[id].bpm`) when set, else the score's, else 90 — in the cache key. Never the speed menu. Written order.

**Stage A — hands.** At an onset the staff's hands **fail** when a hand would span past its practical limit or take > 5 keys, with every held key let go. Only there are other splits tried, so `m` stays rare. A split k gives the k lowest struck keys to the LH, the rest to the RH; a held key keeps its hand (crossing allowed for it) or is let go early, the pedal holding it. Costs:

- 3 per key moved off its staff's hand (`LEAVE`; 0 with no staff hand);
- 2 per held key let go early;
- each hand's spread over its struck and kept keys: 2 a unit above the comfortable 1–5 span, 10 a unit past the practical one (rule 13), +10 a key over 5;
- 0.5 a unit the hand's centre moved since it last played.

A state is the hand of every sounding key plus each resting hand's last centre, so the Viterbi is exact; moves tried only where the staff fails keep most onsets to one state. A key still past a practical span or over 5 is then flagged `w` (no finger): the inner key breaking it, so the bass and the melody keep theirs. A one-staff piano: every onset is open.

R6, small hand (practical 14 units):

- G3+B4 on the treble staff, the LH holding C3: RH {G3, B4} spans 18: fails. RH {B4} + LH {C3, G3} (8) costs 3. G3 → LH 1 (`m`), C3 LH 5.
- Holding C2: LH {C2, G3} is 22; letting C2 go costs 3 + 2 = 5, against 40 + stretch for G3 in the RH. G3 → LH.
- Holding C2 + C3: C2 let go, LH {C3, G3}: 5. G3 → LH.

**Stage B — fingers, per hand** (the LH mirrored, −x). ac-kit with Stage A's hands as `hand` if the spike wins; else:

- **State:** the fingers of the hand's sounding keys, rising with pitch: C(5, K) ≤ 10.
- **Held keys** keep their finger; when that leaves no state, one is let go early (+2). **Pinned** fingers are forced.
- **Transition:** summed over the key pairs (a, fa) → (b, fb) and averaged (Al Kasimi). Inside a chord, stretch and span count twice (rule 14).

| rule | cost |
|---|---|
| Stretch | 2 a unit outside MinComf…MaxComf; 10 a unit outside MinPrac…MaxPrac (rule 13) |
| Small / large span | 1 a unit outside MinRel…MaxRel for thumb pairs, 2 for others |
| Finger 4; three-to-four; four on black | 1 each |
| Thumb on black | 1 (×2 beginner), +1 beside a white key |
| Five on black | 1, beside a white key |
| Thumb passing | 1 on the same level; 3 from white onto a black thumb |
| Same key, other finger | 1 (rule 15) |
| Hand jump | 10 a unit the anchor moves × urgency max(0.05, 0.05 s / gap), instead of Stretch where the hand can lift (gap ≥ 0.15 s): an octave bass on 5–5 is fine. ×2 beginner. |

The **anchor** = a key's x minus its finger's rest offset (0, 2, 4, 6, 8: a five-finger position); 1-2-3-4-5 on C D E F G is one anchor. First-order (on PIG, HMM1 is within 2.6 points of HMM2). Ties go to the lower state index. Pair costs are precomputed tables. Worst case 3000 slices × 100 transitions × 25 pairs = 7.5 M lookups: tens of ms on a desktop, hundreds on a phone — hence the Worker.

**Positions (the ghost).** Each hand's path is cut into frames, the key each finger rests on: played fingers on their keys, the others at their offsets, snapped to the nearest key (white first). A slice keeps the frame while every played finger is within 1 unit of its rest key; else a new frame. Each note gets its frame's index `p`.

**Output.** `fingerNotes(items, { hand: "sb" })` → `{ notes: Map(id → { h: "r" | "l", f: 1–5 | 0, p, x }), frames: { r: [{ q0, keys: [m1…m5] }], l }, ms }`; `x` = `m` moved, `w` too wide, `t` tied, `g` grace. `ALG`, an integer, is bumped with any change in output (as `ENGINE_N`).

## 4. Data

**The song record** (library.js `songs`) gets `fing` beside `clean`: `{ v: 1, alg, hand, bpm, sig, at, n: { "<note id>": [h, f, p, x] }, fr: { r: [[q0, m1…m5]], l } }`, ~40 KB for 2000 notes.

- **`sig`:** `length + ":" + FNV-1a` of the MusicXML Play reads (catalog.js `songXml`); note ids are `ensureIds`'s `n<i>`, positions in it.
- **Valid** while alg, hand, bpm and sig match. `saveFing(id, fing, from)` reads and writes in one readwrite transaction, never into a song replaced meanwhile, with no `changed()` (no sync pass). `saveClean` too: both run on the first open after a release, and split transactions let one drop the other's field.
- **Lifetime:** `replaceSong` drops it; it goes with the song (`forgetSong`) and the songs' database (adopt / shelve / park). Samples: in memory only. **Not synced** (derived), as `clean`.

**Device pref:** `resonate.play.fingers` = "off" | "num" | "hand" (not shelved). Default "num" (Q2).

**Cloud, for assistants:** `public.score_fingering`, one row a song (`user_id, song_id, alg, data jsonb check (pg_column_size(data) <= 524288), updated_at`), as `score_focus`. Written after a conversion and on the Score, once an assistant has connected (`hasAssistant`); a device-only marker `resonate.play.fingUp` = { uid: { songId: "alg|hand|bpm|sig" } } skips an unchanged one per account. `forgetSong` deletes the row (best effort). RLS: read own + approved; write and delete only from an app session. `data` = { v, alg, hand, song, title, bars: [{ bar, text }], moved: [{ bar, beat, note, staff, hand, finger }], wide: [{ bar, beat, notes }] }.

## 5. On screen

**The control.** `#fing`, 44 × 44, at the right end of the shell's Piano row (`#piano-region`, after `.kb`).

- **Shown** while the Piano is linked to the Score and the view draws fingered notes (the piano's or a hymn's views, Melody when the tune is the right hand); hidden over the PDF, for a PDF only, until ready.
- **A tap** cycles Off → numbers → hand: a hand outline, "123", a filled hand; `aria-label` "Fingering: off | numbers | hand".
- **Room:** the ▶ chips give way first (`placeHear`, `KEY_MIN`).
- **Off** is exactly today's keyboard and ▶.

**The fingering's hand rules while on.** A piano note lights in its fingering hand's colour: G3 blue (`#4f7cff`) though written on the treble staff. The RH / LH chips mute by it (`hear` keys from `fing.h`), and a one-hand view plays and lights the notes its hand takes (the LH view: G3's key, no head drawn; the RH view leaves it out).

**Finger numbers.**

- **Which keys:** a press on the music or a double-tapped chord: all it lights. During ▶: each hand's first notes in a new position (`p` changes). A key pressed on the keyboard, voice and other parts, grace notes, `w`: none.
- **White key:** a white disc just under the black keys' ends (r = min(0.36·ww, 0.13·H)), a bold digit in the hand's colour; the letter at the foot shrinks to 0.85; under 16 px a key, the digit replaces it. **Black key:** the disc on its lower end if ≥ 10 px wide, else the digit in its tag.
- **Phone:** digits only where a white key is ≥ 12 px (six octaves beside `#fing` leave ~8).
- **No colour per finger:** colour means the hand, the part, the peek.

**The ghost hand.** Per hand, five rings on the current frame's keys (resting fingers too), each holding its digit: a 1.5–2 px stroke in the hand's colour at 60%, a 20% white fill; a finger that plays fills solid, digit white. No disc or letter on a ringed key. A new frame: a 100 ms crossfade (JazzHandsXR: still snapshots beat an animated hand).

- **Which frame:** with ▶, the hand's newest struck note (`PB.sched`; none for a muted hand); idle with a selection (`S.sel`), its first onset; after a press, the chord's, while held and 2 s after; else none.
- **Phone:** only where a white key is ≥ 14 px; else numbers.

**Cost.** The SVG redraws only when its key string changes (`litKey` gains the finger). The rings are an HTML layer (`.kb-ghost`, `pointer-events: none`), rebuilt at a frame change, fingers down a class; keyboard.js finds its SVG by `:scope > svg`. Nothing animates inside an SVG (WebKit can't composite it).

## 6. Assistants

**The query:** catalog.ts `QUERIES.fingering` (`score: true`; VERSION and CHANGES bumped; the tool list unchanged): "Resonate's suggested piano fingering for a song: hand and finger per note, hand positions, notes moved to the other hand — bars as text." Params: `song`, `from_measure`, `to_measure`, `hand` (rh | lh). resonate.ts `getFingering` finds the song as `get_score_xml` does (`songFiles`: deleted songs hidden), then reads `score_fingering`: ≤ 60 000 characters an answer with `next_from_measure`; no row → "Not worked out yet — open the song on the Score once."; the legend: a suggestion, other fingerings can be right.

A bar in scoretext's terms (C4 = middle C; @beat = quarters from the bar's start):

```
Bar 12 — RH: @1 [E4 G4 C5] 1 2 5 · @2.5 D5 4 · @3 C5 5 — LH: @1 C3 5 · @1 G3 1 (written on the treble staff) · @3 E3 3 — RH position: thumb on E4
```

**Highlights:** scoretext.js `barsText` adds the fingers to each keyboard note (" RH 1 2 5"; `TEXT_LEGEND`), carried by `score_focus` unchanged; `scoreState()` adds `fingering: mode`. **Server:** one non-destructive migration, one redeploy (`import_map_path: "deno.json"`).

## 7. Code plan

0. **Cleanup Phase 8 ships first, as its own release** (docs/CLEANUP.md, with its review and device check): one keyboard path.
1. **Spike (≤ a day):** ac-kit bundled with esbuild, given Stage A's hands, on amazing-grace and the fixtures, timed in WebKitGTK at ×4 CPU. Adopted for Stage B if it passes the fixtures within the budget (§8); else the measured reason goes in docs/PLAY.md.
2. **`public/finger.js`** (pure): `ALG`, `SPANS`, `keyX`, `assignHands`, `fingerHand` (unless ac-kit), `framesOf`, `fingerNotes`. **`finger-worker.js`:** a module Worker (`?v=` from bump.mjs); plain arrays in and out.
3. **`public/fingering.js`** (main thread: no DOMParser in a Worker): `keyboardNotes(P, T, bpm)` (track items, staff, pins), `xmlSig`, `fingeringFor({ id, xml, P, T, stored })`, `fingerText(…)` for the cloud row.
4. **library.js:** `saveFing`; `saveClean` in one transaction; `replaceSong` drops `fing`. **catalog.js:** `loadSong` returns `fing`.
5. **omr/importer.js:** after the save, on `songXml(id)`'s output: `prepare`, `timeline`, `track` (one more main-thread task after the save's 150–180 ms, per song in Convert all), then the Worker. Best effort: never fails an import.
6. **play.js:** `S.fing` after `songTime()` (stored, else the Worker's after `placed()`); `fingOf(id)` a Map lookup, null while pending; `peekStart` / `playKeys` add finger and hand; `hear` / `viewKeep` follow `fing.h` while on; `drawKeys` passes `ghostNow()` to `shellKeys().draw`; `scoreState`, `focusData`; assist.js `shareFingering`; `resonateDebug().play.fing`.
7. **shell/pianoview.js:** `#fing`, its pref; `forScore()` gains `draw(lit, rg, ghost)`, `fingering(available)`.
8. **keyboard.js:** digits on lit keys, `.kb-ghost`, `:scope > svg`, key centres in `geo`.
9. **supabase:** migration `20261123010000_score_fingering.sql`; resonate.ts `getFingering` + `READERS.fingering`; catalog.ts; deploy. **forget.js:** the row's delete.
10. **scoretext.js:** fingers in highlight lines.
11. **tools/dumpkeys.cjs** (new): the piano part's track items with staff, as JSON → `tools/fixtures/finger/amazing-grace.json` (the bundled sample only).
12. **Docs:** CLAUDE.md Play → "Fingering (E7)", docs/PLAY.md "As built (E7)", the roadmap.

Then one review pass and its fixes, a release, the redeploy.

## 8. Tests

**Node:**

- **tools/fingercases.mjs** — synthetic slices with acceptable finger sets: a five-finger tune; C major both ways; the mirrored LH; RH chords; LH root–fifth–octave, Alberti, octave leaps (5–5); an arpeggiated tenth; repeated notes; black keys; ties (`t`); a held note under a moving line; a 6-note chord (one inner `w`); **R6:** G3+B4 over a held LH C3, C2, and C2+C3 → G3 LH (`m`) each time, invariants kept for every hand size; a one-staff piano; printed fingers kept; an octave error → an inner `w`, no exception. Also: deterministic, also shuffled; 3000 notes under 100 ms; golden hashes (tools/fixtures/finger/golden.json): a change without an `ALG` bump fails.
- **tools/fingersurvey.mjs** — on dumpkeys' output (amazing-grace; the owner's songs from `PLAY_SCORES`, never committed). Invariants: no span past practical but `w`, fingers rising with pitch, held keys keep theirs, no finger on two keys, every struck note fingered or flagged. Per song: notes, moved, released, wide, frames, ms. Each `m` and `w` on the owner's songs checked against its PDF crop (tools/accuracy/pairs.cjs): a hand-over, or an OMR error?
- **tools/mcpcatalog.mjs** (the query); **synclib.mjs** (no `fing` synced); **libcore.cjs** (`saveFing` and `saveClean` interleaved keep both fields).

**Browser (the shell, in regress.sh):**

- **tools/playfinger.cjs** — a generated piano fixture and Amazing Grace, on an iPad, a phone and a desktop: `#fing` only where §5 says, its cycle and pref; a press on G3+B4 lights B4 purple with its digit, G3 blue with LH 1; ▶'s digits only at position changes; muting LH silences G3, the LH view plays it; the rings change once per frame; the SVG drawn only when lit keys change; no long task on open; a phone's wide range → no digits; the cache (a reload computes nothing; an `ALG` bump, Reprocess, a clean-up change, a typed tempo do).
- **tools/playfingerwk.mjs** (WebKitGTK): presses, the Worker, no SVG element animating (importfixes.cjs S's `svgAnim`).
- **tools/mcp2.cjs** (live): a `score_fingering` row → `read_resonate fingering` names the moved G3; a highlight's text has fingers; a deleted song isn't answered.

**Evaluation:** the fixtures' share of acceptable fingers. PIG only if registered, outside the repo: target the rule-based level (56.7 Mgen / 78.2 Msoft). Later: public-domain beginner pieces with printed fingering (Czerny, Burgmüller) as ground truth.

## 9. Risks and open questions

**Risks:**

- **Garbage in.** OMR errors (a missed octave clef, a note on the wrong staff) give odd fingers or `w`; Reconvert recomputes. Audiveris exports no 8va lines (it reads them as endings), so an RH 8va passage sits an octave low and may crowd the LH into moves.
- **2 notes in 5 differ from a given pianist's.** Hard limits keep it playable; it never claims to be the only fingering.
- **R3's gaps:** grace notes and `w` keys get a hand, no finger.
- **Repeats:** a bar is fingered as written. **Pedalled long notes** count as held; letting go early softens it.
- **Tempo:** a misread score tempo weakens the urgency term until the song's own is typed.

**For the owner, each with the default:**

1. Hand size: an octave comfortably? A ninth, a tenth? *Default: small (a seventh comfortable, an octave at most).*
2. The first time: numbers on, or off until you turn them on? *Default: numbers.*
3. Change a finger (a teacher's), kept per song, the rest re-solved around it? *Default: not in v1.*
4. Mark on the music the notes the other hand plays? *Default: not in v1; the keyboard's colour shows it.*
5. Register for PIG under its academic terms? *Default: no.*
6. The button at the keyboard's right end, or in the Score's bar? *Default: the keyboard's end.*

## Sources

Parncutt et al. 1997: https://static.uni-graz.at/fileadmin/_Persoenliche_Webseite/parncutt_richard/Pdfs/PaSlClRaDe97_FingeringModel.pdf · Jacobs 2001, Music Perception 18(4) · Al Kasimi et al. 2007: https://archives.ismir.net/ismir2007/paper/000355.pdf · Balliauw et al. 2017: https://dorienherremans.com/sites/default/files/ITOR_VNS_APF_preprint.pdf · Nakamura et al. 2020: https://arxiv.org/abs/1904.10237, terms http://beam.kisarazu.ac.jp/research/PianoFingeringDataset/ · Ramoneda et al. 2022: https://eita-nakamura.github.io/articles/Ramoneda_PianoFingeringFromPartiallyAnnotatedScores_2022.pdf · Penner & Hindle 2026: https://arxiv.org/html/2609.28787v1 · Boyle et al. 2015: https://paskpiano.org/wp-content/uploads/2023/10/Boyle-Boyle-Booker-_APPCA-2015_Dec-2015.pdf · ac-kit: https://www.npmjs.com/package/@ac-kit/media-piano-fingering · PianoPlayer: https://github.com/marcomusy/pianoplayer · pydactyl: https://github.com/dvdrndlph/pydactyl · Smart Piano Fingering: https://github.com/emanuelemerlo/smart-piano-fingering · P.I.A.N.O.: https://www.uni-ulm.de/fileadmin/website_uni_ulm/iui.inst.100/1-hci/hci-paper/2014/2014-gugenheimer-piano.pdf · JazzHandsXR: https://cgvr.cs.uni-bremen.de/theses/finishedtheses/jazz_hands_xr/thesis.pdf · Synthesia: https://synthesia.app/support/guide/firstSong · Verovio: https://raw.githubusercontent.com/rism-digital/verovio/version-6.4.0/src/iomusxml.cpp

## Review notes

One review (1 must-fix, 13 should-fix, 13 nits), all applied but:

- Nit 23, "small and medium are pydactyl's own": Balliauw's preprint prints all three hands (Tables 1, 9, 10; pydactyl's match), so they're cited as the paper's.
- #12, "prep in the Worker": `prepare` needs DOMParser, which a Worker lacks; only finger.js moves there.
- #14, Q3 in v1: left to the owner; printed fingers are pinned already, so it is only a UI step.

## Fingering algorithm (E7 stage 1) — as built

`public/finger.js` (pure, `ALG` 1), `public/finger-worker.js` (`{ id, items, hand }` → `{ id, result }` / `{ id, error }`), `tools/fingercases.mjs` (fast tier). No ac-kit: Stage B is ours. Default hand "sb".

**API.** `fingerNotes(items, { hand, debug })` → §3's output exactly (`debug: true` adds the stages' results). Also `assignHands(items, { hand })` (Stage A), `fingerHand(A, "r" | "l")` (Stage B: fingers + the path of sounding keys), `framesOf(path, side)`, `keyX`, `SPANS` (Tables 1, 9, 10, checked against the preprint), `COST` (every weight, one place).

**Items** (stage 2 builds them from `track()` items + `S.Tid`): `{ id, q, t, d, midi, staff, hand: "r" | "l" | null, tied, grace, pin: 0–5, arp }`. `d` = `hold` for a struck note (ties joined), its own `dur` for a unison's twin. Bad items are skipped, never thrown on.

**Where it differs from §3, and why:**

- **The hand jump:** where the hand can lift, the cheaper of the distance rules (1, 2, 13) and the jump. Replacing them outright made a thumb walking C-D-E-F cheaper than a thumb-under in a scale; keeping rule 2 under the jump makes 5–5 cost 28 more, not "fine".
- **Stage A:** a hand's centre is the middle of its struck keys. Held keys can be let go only from the bottom or the top, and only where that lowers the spread (letting go later costs the same). It stays exact over those moves; at most 27 states at once in the tests (a cap of 256 for one-staff pianos).
- **Stage B:** a held key can be let go beyond the fewest needed: one more where keeping it costs more than `LET`. Kept keys that end before the hand's next onset don't count in a state's identity (an exact merge). Rule 14 doubles rules 1 and 2, not 13 (Balliauw). Finger 4 and the thumb on black are counted per key, not averaged.
- **`w`:** from the hand's inner side (RH lowest, LH highest), after letting go the held keys in the way. The octave-error case flags G3 under C5 E5.
- **Pins:** ignored on a moved key (printed for the other hand), and dropped at an onset they leave no state for.
- **Frames:** free fingers are placed at their offsets between the played ones and snapped to the nearest white key. On a tie, those above go up and the thumb tucks under (3 on E♭ → C D E♭ F G).
- **R6, large hand:** G3 + B4 is a tenth, the large hand's practical span (18), so D2 leaves it in the RH. Small and medium move it (all three holds); G3 + D5 moves for every size.

**Known limits** (synthetic tests; the survey on real songs decides any tuning, with an `ALG` bump):

- An octave leap into a figure (LH C2 | C3 E3 G3 E3) comes out 5 | 1 2 1 3 at 13, against 5 | 5 3 1 3 at 14. The beginner's ×2 makes a slow octave jump 14; a crossing costs about 6. It is printed as info, not judged.
- Medium and large hands: 3–1 spans a fifth as relaxed as 5–1, so Alberti is 3 1 2 1 (a tie, the lower state wins).
- The imaginary E–F key makes E♭–G 5 units, so a small hand's C E♭ G is 1 2 5.

**Timings** (node 22, 4 cores, a regression run alongside): 3000 notes (1588 onsets) take 27–40 ms warm (median of 5) and 47–75 ms on the first run. The suite takes ~1 s.

**Golden:** `tools/fixtures/finger/golden.json` holds 85 hashes: every case × 3 hand sizes, plus the 3000-note piece. A changed output under the same `ALG` fails; `--update` refuses until `ALG` is bumped.

## Fingering on the Piano (E7 stage 2) — as built

Stage 2 shows stage 1's fingering on the shell's Piano, and works it out and keeps it with the song. The assistants' half (the cloud table, `read_resonate fingering`, fingers in a highlight's text, `shareFingering`, forget.js) is built separately; this stage leaves them a reader (below). No Cleanup Phase 8: only its slice for the tests (tools/lib/shell.cjs; boot.js's `resonateDebug().play`, the Score's).

**Files.**

- `public/fingering.js` (main thread; §7 item 3):
  - `keyboardOf(P)`: the keyboard part, §3's.
  - `keyboardNotes(P, T, bpm)`: §3's items, plus `pin` (`<technical><fingering>`) and `arp`. `tied` is a non-struck item on a tie's stop; `d` is `hold`, or a twin's `dur`.
  - `xmlSig`.
  - `songTempo(id, xml, T)`: what play.js's `tempoBase` is.
  - `fingeringFor({ id, xml, P, T, bpm, stored, rev, from })`, which returns `{ rec, computed }`.
  - `fingerSong(id)`: for the importer.
  - `fingerAsync`: the Worker. There is one, kept. A module Worker that doesn't load falls back to the main thread.
  - `stats`.
  - No `fingerText`: the cloud row is the assistants' half.
- `library.js`: `saveFing(id, fing, rev)`. `saveClean` now uses one readwrite transaction (`modify`). `replaceSong` drops `fing`.
- `catalog.js`: `loadSong(…).fing`; `songXml(song, { keep })`.
- `omr/importer.js`: `fingerLater(id)`, after the save. It is a dynamic import of fingering.js, and failures are only logged.
- `keyboard.js`:
  - the digits on lit keys (`text.fd` / `circle.fd`);
  - `.kb-ghost`;
  - `:scope > svg`;
  - `geo()`, `spot(m)`, `ghost()` for tests.
- `shell/pianoview.js`: `#fing`, the pref, and `forScore()`'s `draw(lit, range, ghost)`, `fingering(avail)`, `fingers()`, `host().fing`.
- `shell/songview.js` / `scoreview.js`: `fingersChanged`.
- `play.js`: `F`, `fingStart`, `fingOf`, `fingAvail`, `fingMode`, `fingButton`, `fingChanged`, `ghostNow`, `fingSeen`, `groupOfEl`, `playKeep`, and `handOf(f, id)`.
- `index.html`: `#fing`'s look.
- `shell/boot.js`: the `play` alias.

**When it's worked out.**

- **The Score:** once a song is placed, in idle time and one step a task: the timeline, Sing's tempo, then the notes and the Worker.
- **The importer:** after a conversion's save, on `songXml(song, { keep: false })`'s output: the text the Score will read, its cleaned copy not saved there (the Score's first open keeps it, as before; reprocess.cjs checks a replaced song comes without one).
- **Reuse instead of a second run:**
  - A record worked out on the page is kept in memory (`memo`: a sample's only home).
  - A run under way for the same song, alg, hand, bpm and sig is awaited, not repeated. A conversion's save and the Score's reload of that song used to work it out twice.
  - A record reused this way is saved to the song when its own record lacks one.

**Where it differs from §4–§5, and why:**

- **On only with the Piano linked.** The mode in effect is "off" unless the Piano is the Score's and the view draws fingered notes, so the hand rules never act unseen: the Piano off, 📄, play.html. `scoreState().fingering` is then null.
- **A short keyboard.** §5's disc, r = min(0.36·ww, 0.13·H), and the letter at 0.85 overlap on a keyboard under ~100 px tall (a desktop's 72 px). The disc gives way first, down to 6.5 px, then the letter. A letter under 7 px is dropped: the digit replaces it. With its letter moved to the foot, a digit's key loses the middle-C dot.
- **A ringed key** has no disc, no letter, and no tag on a black key.
- **Which notes follow the fingering's hands:**
  - A chord picked by a double-tap still plays what the view draws of it. It is what was asked for, as with the chips.
  - The stretch's columns (`viewOnsets`) stay the drawn notes'.
  - Only ▶ of a stretch or a page follows `playKeep`.
- **A key two parts sound** (the voice's tune and the piano's) shows the keyboard note's colour and digit while the fingering is on.
- **The ghost's frame:** a press on the music wins over ▶ while it's held, plus 2 s. A frame is known by its keys: two frames on the same keys aren't rebuilt.
- **#fing takes the chips' room first.** On a phone (the Score and the Piano: Amazing Grace's four octaves), the RH / LH chips no longer leave the keys 8 px a white key beside #fing, so they go to the stretch's controls. shellmods' `linked` check reads placeHear's own measure for this (`playback.hear.fit`: the keys' width, the white keys, #fing's width).
- **Digit sizes are rules by key width on every device**, not a phone rule: digits at ≥ 12 px a white key, rings at ≥ 14. A phone's Both, with its RH / LH chips beside the keys, gets ~9.5 px (no digits); its RH view gets ~15 px.
- **What makes it stale is tested** for an ALG bump, a typed tempo, a clean-up change (a converted song's cleaned MusicXML read differently: `sig`) and Reprocess.

**For the assistants' upload** (the other half):

- `window.resonatePlay.fingering()` returns the open song's record, or null.
- window `resonate:fingering` is fired whenever a record is made ready: read from the song, reused, or worked out. Its detail is `{ song, fing (the record), computed, from: "score" | "import" }`, and the conversion's ("import") fires for a song the Score isn't showing too.
- The record is §4's, plus `ms`. It is fresh as of the event, and stays fresh until the next event for that song. It goes stale with the song's MusicXML (`replaceSong`), its own tempo, ALG or the hand.

**Tests:**

- **playfinger.cjs:** the shell; iPad, phone and desktop; the generated fixture (fingerfixture.cjs: r6, wide, big) and Amazing Grace. It covers §8's browser list, plus:
  - J: off = a page whose Worker never answers. A press's lit keys, the schedules (Both with LH muted, the LH view) and ▶'s struck notes and keyboard writes are equal, write for write.
  - G: 2851 notes. No long task while they're worked out; the main thread's share is 16 ms.
- **playfingerwk.mjs** (WebKitGTK): the Worker, a press's digits and hands, the rings, and 0 of 87 samples with an SVG element animating while ▶ plays with the rings.
- **fingersurvey.mjs:** the invariants (now `tools/lib/fingerinv.mjs`, shared with fingercases), every hand size, determinism and the shuffle, on Amazing Grace. The owner's songs come in through `PLAY_SCORES=… node dumpkeys.cjs` into the temp dir, never the repo.
- **libcore:** `saveFing` and `saveClean` interleaved (the old `saveClean` fails it).
- **synclib 14:** no `fing` in the row, the file or another device; a new fingering alone sends nothing.

**Timings** (sandbox Chromium, desktop):

| song | notes | Worker | main thread (sig + notes + post) |
|---|---|---|---|
| Amazing Grace | 162 | 15 ms | 13 ms building |
| the fixture | 26 | 2–9 ms | — |
| 150 bars | 2851 | 99 ms | 16 ms (10 ms the notes) |

**Left:**

- The assistants' half.
- The owner's songs through fingersurvey: each `m` / `w` against its PDF.
- Digits on a phone in landscape and in Slide Over (no ROOM rule in the shell: CLEANUP-PHASE8 §0.9).
- One review pass.

## Fingering for assistants (E7 stage 3) — as built

- **The row:** `public.score_fingering` (migration `20261123010000_score_fingering.sql`): one row a song (`user_id`, `song_id`, `alg` integer, `data` jsonb ≤ 512 KB, `updated_at`); RLS: the owner reads (approved), only the app (no `client_id`: `is_app_session()`) inserts, updates and deletes — an assistant only reads. A copy: the fingering itself stays on each device (library.js `fing`, never synced).
- **`public/fingertext.js` `fingerText({ fing, T, numberOf, title, song, facts, doc })`** → `{ v, alg, hand, bpm, sig, song, title, bars: [{ bar, text, rh?, lh? }], moved: [{ bar, beat, note, staff, hand, finger }], wide: [{ bar, beat, hand, notes }] }` or null. `fing` is the stored record or `fingerNotes`' raw result (then `alg / hand / bpm / sig` given too). A bar: "Bar 12 — RH: @1 [E4 G4 C5] 1 2 5 · @2.5 D5 4 — LH: @1 C3 5 · @1 G3 1 (written on the treble staff) — RH position: thumb on E4"; a tie's continuation isn't listed ("RH: held"), "–" = no finger, an empty bar "(rests)". `staff` of a moved note = its clef word, else "right-hand" / "left-hand". ~13 ms for 3000 notes / 750 bars (a 163 KB row).
- **scoretext.js:** `fingOf` (both forms → `note(id)`, frames), `nameOf`, `midiName`, `staffWords`, `FINGER_LEGEND`, `textLegend(fing)`; `barsText(…, { fing })` puts the hand and fingers after each keyboard note's value ("RH 1 2 5", "LH 1, RH 5", "–"). Without `fing` the text and the legend are byte for byte the old ones (`tools/fixtures/finger/scoretext-nofing.json`).
- **The app:** play.js `shareFing()` once the Score's fingering is ready (`fingRec()`, the shell only — play.html works none out), only once an assistant has connected (`hasAssistant`) → assist.js `shareFingering(id, data)`: one call at a time, skipped when the device's marker (`resonate.play.fingUp` = { uid: { song: "alg|hand|bpm|sig|v" } }) says the row is the same. `focusData` passes the fingering to `barsText` and the legend (`textLegend`), whatever the display pref. `forgetSong` → `dropFingering(id)` (the row and the marker; a failed delete retried with the other writes).
- **Server:** `read_resonate fingering {song, from_measure?, to_measure?, hand?: rh | lh}` (catalog `QUERIES.fingering`, `score: true`; `VERSION` 2026-11-23; `resonate.ts` `getFingering`): ≤ 60 000 characters an answer with `next_from_measure`, `moved` / `wide` for the bars shown only (≤ 200 each), the hand size in words, the legend. Songs found through the song index (deleted ones hidden) plus the rows, so a sample (Amazing Grace) is found; no row → "Not worked out yet — open the song on the Score once." `songs()` goes through `songIndex()` (also the deleted ids), `pickSong()` split out of `findSong()`.
- **Tests:** tools/fingertextcases.mjs (fast tier: the exact bar text and hand parts in both forms, finger.js's own fingering, scoretext byte-identical without one), tools/lib/minidom.mjs (a small XML reader so node runs DOM-on-XML modules), mcpcatalog.mjs (the query, still 15 tools), mcp2.cjs section 6 (live: the page writes the row, both hands and one, an assistant's token can't write or delete, `forgetSong` drops it).

## The drawn hand (E7+) — as built

The owner, on v99's rings: *"when I said ghost hand, I meant like even extending below the piano, I wanted to see the wrist and everything. Like I want to see an animation of a hand dancing across the piano."* So hand mode (`#fing`: numbers → hand → off) draws two hands seen from the player's eyes: the fingertips on the keys, the knuckles just in front of them, the palm, the wrist and a bit of forearm in a band under the keyboard. As ▶ plays they move to each new position just before its notes; the finger that plays presses (the key goes down under it), the others rest, the thumb passes under, a far jump lifts in an arc, the wrist and forearm follow a little late (the "dance"). Off and numbers are as v99.

**How it was reached:** three prototypes (realism, performance, learning), two judges (the owner's eyes; an engineer's), merged: realism's hand and motion, the performance prototype's renderer, the learning prototype's layout. The design, the prototype and its measurements: the session's scratchpad `hand/final/` (HAND.md); this section is what was built.

**Files.**

- `public/handplan.js` (pure, node-tested): `bandOf(kh, ww, phone)`, `handGeo(kg, band)`, `keyU`, `planHand(notes, h, g, { start, anchor, until })`, `poseAt(P, t, g, rm)` (closed form in t: no history — a freeze, a seek, a loop or a speed change just evaluates at the new t), `frameAt`, `visAt`, `yieldHands`, `nailStates`; the timing constants (`LEAD` 0.08 s the hand lands before the note, `ARRIVE` 0.04 a finger on its key before it strikes, `PREP`, `RAISE`, `REL`, `GAP` 2.5 a silence that hides the hand, `NEXT` / `NEXT_FAR` the next finger's ring, `LAG_W` 0.11 / `LAG_E` 0.2 the wrist and forearm) and the anatomy tables.
- `public/hand.js` (DOM): `mountHands(kbEl)` → `{ layout(kg, band), notes(list, tv), cut(at, tv), clear(tv), tick(tv), show(pose, tv), debug(), destroy() }`. One `<canvas>` a hand (11 white keys wide, moved by `translate3d`, faded by its opacity, drawn again only when its shape changed — ¼ px), the landing badges (HTML), a static shadow under the keys' front and a fade at the band's foot; CSS injected once (`#kb-hand-style`). A budget watchdog drops detail (no gradients and creases → no shadows → shapes at 30 Hz) when > 10 % of 120 frames are late. Its own rAF only while idle (a press, a selection, the fade after ■), stopping after 20 still frames.
- `keyboard.js`: `update({ hand })` — lit keys keep their letter, moved above the fingertip (a white key's under the black keys' ends, a black key's at its top); no digit discs. The rings (`.kb-ghost`, `ghost()`) are gone; `geo()` adds `x0`, `whites`, `hand` (≥ 14 px a white key).
- `shell/pianoview.js`: in hand mode, where a hand fits, mounts the hands, sets `#piano-region[data-hand]` and `--kb-band` (`bandOf`: 0.8 × the keys' height, a window under 600 px 0.6; 0 under 14 px a white key — numbers then, `fingers()` says "num") and calls `resized()` once when the band comes or goes; `forScore().hands()`.
- `shell/songview.js`: `resized` → the Score laid out with `keep` (its bars stay, drawn a little smaller), as the Piano toggle.
- `play.js`: `handFeed` (▶'s heard, fingered notes — not grace, not `w` — with their position's keys, as `pump` schedules them), `tvNow` (the visual clock: the wall clock re-anchored to the audio clock less its output latency when they're 20 ms apart), `handsOn()?.tick` every frame, `cut` on a reschedule (speed, a chip), `clear` on ■ (the hands rest 2 s, then fade — or glide on from there at the next ▶); idle `handPose()` (a press on the music's chord: pressed while held, let go and shown 2 s more; else the stretch's first onset, shown just before it's struck) → `show`. `ghostNow`, `PB.ghost` are gone.
- `index.html`: `.pianobar[data-hand] { padding-bottom: calc(6px + var(--kb-band)) }` — the row's content box stays the keys' height, so #fing and the ▶ chips stay centred on the keys.

**The plan's rules beyond the prototype** (found by tools/handcases.mjs on Amazing Grace and the owner's nine songs, where the prototype's demo passed):

- **Positions by identity:** a new position wherever the notes' `fid` (finger.js's frame index) changes — a repeat or a loop's next round is an ordinary move.
- **A finger that can't wait for the hand** (its position's landing comes after it must strike — a palm waiting for a held note) travels on its own; it used to jump four keys in a frame.
- **Fingers 2–5 never cross:** where 1 and 5 are too close for the 0.8-key spacing, the free fingers bunch up between them; a finger just let go yields at once.
- **One move at a time, in order:** a palm still waiting for a held note when the next move must start lands then (the held finger stays, the hand stretched after it); a position squeezed to under 60 ms between two moves isn't stopped at. Overlapping moves had made the plan depend on notes more than 4 s ahead, so the hand jumped as ▶ scheduled more.
- **A hand gone** (a silence ≥ `GAP`) **comes back in its new place**, not gliding from where it was a minute ago.

**Tests.** tools/handcases.mjs (fast tier): the prototype's demo and Amazing Grace (also at 50 %) at an iPad's and a phone's keys — every note's finger holding its key at its onset, the tip on its centre; the wrist below the keys; moves landing `LEAD` early (at worst on the note), one at a time, in order; stepping 1/60 s: no NaN, 2–5 in order (two fingers both holding keys excepted: the fingering's own), a frame's largest move ≤ 1.5 keys a tip (2 at a leap's free fingers) and 1.2 the knuckles, excepted where the music's speed asks for it (the finger's next note within 0.15 s, a hand move squeezed under 0.25 s or through a passing position); a plan from a sliding window [t − 3, t + 4] (what the page has) gives the same pose; reduced motion snapping only at a landing, an arrival, a strike or a release; the next ring and landing badges' timing; the band. `KEYS=<dir>` runs it on dumped songs (the owner's nine: 117 checks, never in the repo). playfinger.cjs E/F/H (the band, the layer, a press, ▶ — each fingered note held at its onset —, the fade after ■, a stretch idle, a phone's compact hand, Both's chips leaving no room), playfingerwk.mjs (WebKitGTK: nothing animating in the Piano row while ▶ plays with the hand; rAF gaps reported).

**Known limits:** not run on a real iPad (the canvases are GPU-drawn there; Chromium here draws them on the CPU: ~3 ms a frame at 2× — the watchdog is the fallback); hands crossing over each other aren't laid out (the one in the air on top); a free finger can swing 3 keys in a frame through a passing position (once in the nine songs, Songbird's left hand).

## Review round (E7)

One review pass over all of E7 (four areas — the algorithm, storage, the screen, assistants — each finding adversarially verified): 9 reported, 7 confirmed (one reported twice), 2 refuted (a one-staff keyboard part is slow — seconds, in the Worker, linear under `MAXA`: not a defect; a tempo typed in Sing while the Score is open keeps the old fingering until the song is reopened). Each fix has a check that failed on the code before it.
- **Tie continuations** (`finger.js` `fingerNotes`, `fingerHand`'s `let` now `[key, q]`): a continuation whose key was let go at or before its onset (Stage A, the w pass, Stage B) — or had ended there (another voice struck it again and let go at the tie) — has no finger: f 0, still "t"; the keyboard shows no digit, the assistants' text "–". Before, two keys of one hand showed the same finger at once (4–8 times a seed on the generated 3000-note piece). Checks: the invariant "no two keys of a hand share a finger at an onset, continuations counted" (`lib/fingerinv.mjs`); fingercases "tie let go (fingers)", "tie let go (hands)", "tie after a restrike".
- **Unisons keep the staff split** (`assignHands` → `splitsOf`): a key both staves strike gives two staff splits (it in either hand), those that don't break the hands offered with no leave cost; the lowest-k splits are tried too only when both break (D2). Before, the unison turned the staff split off and notes moved hands at onsets the staves can play. Check: fingercases "unison between the hands". A unison at every beat now runs ~5× faster (fewer splits).
- **ALG 2** (stored records are worked out again). Golden: Amazing Grace changes 3 continuations, the 3000-note piece 34 notes; nothing else.
- **▶ before a later song's fingering is ready** (play.js `fingReset` resets `on`): `F.on` carried over from the previous song, so the new fingering's arrival never called `rehear()` and ▶ / ⟳ kept staff hands. Check: playfinger L (the Worker held back on a BroadcastChannel, `heldWorker`).
- **#fing steady across a song switch** (play.js `fingButton` waits while the song's fingering is unknown; `fingStart`'s catch hides it): it hid and showed again on every open, re-laying the keys and, on a phone, moving the RH / LH chips. Check: playfinger M (`switchSteady`, iPad and phone, every frame).
- **Assistants get the fingering of a song already open** (assist.js `sawAssistant` → window `"resonate:assistant"`, once a page load, when the activity check turns yes or the Realtime "assistant" broadcast comes; play.js calls `shareFing()` on it and in `scoreRun` for any score_* command): before, only opening the song uploaded it, and an assistant's score_open on the song shown was a no-op. Check: playfinger N (an approved account faked as shellplaces does).
- **A Reconvert drops the old row** (omr/importer.js `dropFingeringLater` after `replaceSong`, best effort): the cloud kept the old conversion's fingering until the song showed on a Score. Check: reprocess.cjs page.
- **`fingerSong` one step a task** (fingering.js `breath()` — an idle callback, 500 ms timeout — before songXml, prepare, timeline, songTempo, `fingeringFor`): after each conversion's save it was one 0.3–0.6 s task. The clean-ups alone are still one call (150–260 ms here). Check: playfinger O (longest task's median under 200 ms, or ≤ 70% of the long tasks' total; reported, not judged, on a busy CPU).
- **Found, not fixed:** fuzz-only — when the other staff strikes a tied key again mid-tie, the continuation links to that key and takes its m flag (`fuzz.mjs`, 26 cases).

