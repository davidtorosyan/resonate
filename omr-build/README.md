# Building the in-browser Audiveris

`build.sh` reproduces `public/omr/lib/*.jar` from upstream Audiveris (`7a36078`) + `patches/`.

## What the patches change

`0001` — **Java 17.** CheerpJ 4.2 runs Java 8/11/17 bytecode; upstream targets Java 25. The only
newer constructs in the source were pattern-matching `switch` (rewritten as `instanceof` chains with
the same case order, guards and null behaviour), `case null`, qualified enum `case` labels and one
`getFirst()`. `-PtheMinJavaVersion=17` compiles with `--release 17` so newer *APIs* fail at compile time
too. Verified natively: same MusicXML as the Java 25 build.

`0002` — **Browser runtime.**
- `text/web/WebOCR.java`: an `OCR` implementation whose recognition is a `native` method implemented in
  JavaScript (`public/omr/omr-worker.js` + `ocr-engine.js`, WebAssembly Tesseract). Selected by `-Daudiveris.ocr=web`.
  `OcrUtil`, `TextLine`, `TextBuilder`, `Main` go through the `OCR` interface instead of `TesseractOCR`.
- `WellKnowns`: fall back to the `user.home` property when `HOME` is unset (no environment in CheerpJ).
- `OmrExecutors`: with `-Daudiveris.web=true`, the cached pool uses a `LinkedBlockingQueue` —
  `SynchronousQueue` needs `VarHandle` natives CheerpJ lacks.

`0003` — **No AWT in batch.** `LogUtil` (4 places) and `SheetStub` asked `SwingUtilities.isEventDispatchThread()`,
which initializes the AWT toolkit; inside a Web Worker CheerpJ has no display, so that crashed. They now only ask
when a GUI exists (`OMR.gui != null`).

`0004` — **Lyrics with extender lines.** Not browser-specific: a fix to Audiveris itself. OCR reads a melisma
extender (`pain____`) as a very wide word, whose width made the computed font size huge, and `TextLine` then
threw away the *whole* OCR line before lyrics were built (half the syllables of the test score). Now dash-only
words skip the font-size check, a glued dash run is not counted in a word's font size, other oversized words
(slur pieces read as letters) are dropped instead of their line, and a dash on the syllables' baseline becomes an
extender instead of a hyphen. Test score: lyric syllables 44% → 87%, notes unchanged.

`0005` — **Batch robustness.** (1) One failed sheet no longer throws away the book: each failure is logged as
`Sheet#N failed at STEP: reason`, the sheet is discarded (no slurs/ties/voices linked across it), and the remaining sheets are
exported (`Partial transcription: K of N sheets, without failed sheets [#..]`; an extra warning when it's the first sheet,
which carries the title, tempo and time signature). (2) The music font must actually work: at startup every glyph the family
uses is checked (outline bounds, plus pixels for a few key glyphs); a bad font is recreated once from the jar, otherwise one
ERROR line `Music font Bravura unusable: …` names the failing glyphs and nothing is exported — an empty glyph found mid-run is
fatal too, rather than recognizing with a blank clef. (3) `-Daudiveris.fonts.dir=DIR` reads font files in place
(`Font.createFont(File)`), so the browser can hand Bravura over in memory instead of a temp copy in IndexedDB. Prompted by a
user's browser run where every sheet died at HEADERS on a 0×0 clef image (FreeType returned empty outlines; not reproduced in
Chromium or WebKitGTK). Healthy output is byte-identical.

`0006` — **Octave clefs.** A bass clef with a small 8 below (low voices, e.g. Hades in *Hadestown*) was never
recognized: `F_CLEF_8VA/8VB` were left out of the clefs looked for at a staff start, and the classifier grades octave
clefs far below the plain clef anyway. They're now candidates, and when the classifier proposes the octave variant of the
chosen G or F clef for a glyph that extends at least half an interline past it (the 8), that variant is used with the
plain clef's grade. Test scan: 20 of 21 low-voice staves (the 21st's 8 is merged with the barline; the page side fixes
it). Other test scores: identical output.

`0007` — **Unmarked tuplets.** Audiveris only knows "3" and "6" tuplet signs. In a quadruplet (four quarters in 3/4 under a
bracketed 4) the 4th chord got no time slot and was left out of the export with its lyric syllable. A chord that comes
after a same-staff voice of chords of its duration, filling the measure exactly, is now appended to that voice; the
measure ends one chord too long, and the page side (`public/omr/fixscore.js`) turns it into a 4:3 tuplet. Only chords that
used to be dropped are affected.

`0008` — **Lyrics between a part's staves.** `TextRole.guess` made text between two staves of the same part a Direction,
never Lyrics. A piano/vocal arrangement with the tune in the piano's right hand prints the words exactly there (Musicnotes'
"The Longest Time": 1 syllable exported out of ~300). A non-italic line of two or more words with vowels between the staves
of a multi-staff part is now Lyrics; `mapLyricLines` already maps such a line to the staff above. Italic directions there
("sim.", "8va bassa throughout") stay directions. Other test scores: the sung melody and its words identical; a stray
syllable or two in a piano part, which the Sing page's parser never picks as the melody.

`0009` — **Live trace** (`text/web/WebTrace.java`) for PDF → Song's progress view ("the Reader"): what each step
finds, system by system, while it works. Off unless `-Daudiveris.web.trace=web` (each block to `private static native
void emit(String)`, implemented in `omr-worker.js` as `Java_org_audiveris_omr_text_web_WebTrace_emit(lib, block)`, like
WebOCR's native) or `=stderr` (printed, for native runs and A/B checks); a native that throws turns it off. Hooks, each
behind `if (WebTrace.ON)`: `SheetStub.doOneStep` before and after each step (after `done(step)`), `AbstractSystemStep`
after each system's `doSystem`, `Book.reachBookStep` after "Book reaching" and after each sheet's "End of Stub#N" (the
sheet is in the `.omr` then), `Book.sheetFailed`. Read-only: `AbstractInter.peekBounds()` (new: the bounds as known,
nothing cached — `getBounds()` caches, and `bounds` is stored with the book), key signatures from their shape or signs
(not `getFifths()`, which caches a stored field), time signatures from `TimeWholeInter`'s field or the numbers
(`TimePairInter`/`TimeCustomInter.getTimeRational()` cache a stored field), ensemble members unsorted (sorting computes
bounds); after PAGE the notes use the export's own accessors (`getStep`, `getAlteration(fifths)` with the key carried
per part/staff as `PartwiseBuilder` does, `getOctave` + octave shift, `getDuration`, `getTimeOffset`, `getVoice`) on the
finished sheet. Every entry point catches Throwable. One string per call: per sheet ≈ 20 B + 20 E lines + one Y block
per system per per-system step + the sheet steps' changes + G + one N per system + S. `tools/tracecheck.mjs --events`
maps a trace to the Reader's event contract (`tools/fixtures/trace/*.events.json`).

**Trace format** (lines separated by `\n`; a block = one `emit`, its first line a header starting with an upper-case
letter, record lines follow; coordinates are sheet pixels = TIFF pixels = the 300-dpi render; texts URI-encoded, UTF-8,
as `encodeURIComponent`):
```
K n done invalid        transcription starts: n sheets; sheets already done (a resumed book) "1,2" or -; invalid ones or -
B s STEP                STEP starts on sheet s (LOAD … PAGE; a sheet's first B is LOAD)
E s STEP ms             STEP done on sheet s in ms (wall time); records:
  d w h                   after LOAD: image size
  i interline             after SCALE: pixels between staff lines
G s n                   after GRID, n systems; records:
  y sys l t r b           a system's box
  f sys staff part x0 x1 yl1 yr1 … yl5 yr5   a staff: ids, part id, left/right x, each line's y at its left/right end
Y s STEP sys            symbols of system sys after STEP — after every system of a per-system step (HEADERS … LINKS;
                        possibly empty), and after any step for a system whose symbols changed; records:
  +id k x y w h [v…]      added (bounding box); a + for an id already sent replaces it (a slur found to be a tie)
  -id                     removed (REDUCTION drops candidate heads/beams, LINKS stray symbols …)
  m x0 x1 … xn            after MEASURES: the system's measure boundaries
N s sys                 after PAGE, the system's notes in measure then time order; records:
  n chord m staff voice t dur head… [lyric…]
      head  = id,x,y,STEP,alter,octave[,s|e|se]   center; ties starting / ending there; "-,0,0" unpitched
      lyric = Lverse,syllabic,text                 syllabic s single, b begin, m middle, e end
  r chord m staff voice t dur x,y                   a rest
      m = page measure id; t = offset in the measure, dur = duration, as whole-note fractions ("1/8");
      dur g = grace, M = whole-measure rest; voice "-" if unknown; t "-" = no time slot (the export
      leaves such a chord out — 13 heads on Songbird, 10 on Piano Man)
S s ms                  sheet s processed in this run is stored in the .omr (also after it failed: F then S — the
                        browser keeps it failed, trace.js sends no "done" for it): a resume point
F s STEP reason         sheet s failed at STEP (or ?), left out
```
Kinds `k` and their extras `v`: head (shape, staff pitch: 0 = middle line, + down), stem, beam (median x1 y1 x2 y2,
height), ledger, rest (shape), clef (shape), key (fifths), time (num/den or shape), bar (shape), slur / tie (cubic x1 y1
cx1 cy1 cx2 cy2 x2 y2), acc (shape), flag (shape), dot, word (text), lyric (text), other (shape). Not sent: ensembles
(chords, sentences, lyric lines, beam groups, staff barlines), members drawn by their ensemble (key signs, time numbers),
clutter. Not produced: per-step OCR word boxes (the Reader gets them from the WebOCR native), letters on heads before
PAGE (the clef/key aren't applied until then).

**How to A/B** (native; `tools/trace-ab.sh`, `trace-cmp.sh`, `trace-resume.sh` and `trace-jfr.sh` do this for the test
scores — `SP`, `JDK`, `INST` from the environment, as `tools/accuracy/env.sh` reads them; the web's `-constant`s are
`tools/accuracy/constants.sh`): build in a checkout with the patches applied (`./gradlew -PtheMinJavaVersion=17 :app:installDist`),
then run the same TIFF twice, the second time with the trace, and compare the MusicXML without its `encoding-date`:
```
B=app/build/install/app/bin/Audiveris
C="-constant org.audiveris.omr.sheet.ProcessingSwitches.indentations=false -constant org.audiveris.omr.util.OmrExecutors.useParallelism=false"
$B -batch -export -output off $C score.tif
AUDIVERIS_OPTS=-Daudiveris.web.trace=stderr $B -batch -export -output on $C score.tif 2> on/trace.log
node tools/tracecheck.mjs on/trace.log on/score.mxl        # grammar + notes vs the export
```

**As measured** (native, JDK 25, the same build with the trace off vs `stderr`, the web's settings `indentations=false` +
`useParallelism=false`, the 7 test scores of 0004–0008 — Amazing Grace, Oh Susanna, Greensleeves (synthetic), Wichita,
Killing Me Softly, Songbird, Piano Man (the owner's, outside the repo)):
- *Output.* MusicXML byte-identical (`encoding-date` stripped) on Amazing Grace, Oh Susanna, Greensleeves, Wichita, Killing.
  Songbird and Piano Man can differ by a dotted chord or two from one run to the next, trace or not — the engine isn't
  deterministic there: Songbird off₁ = on₁, off₂ = on₂, off₁ ≠ off₂; Piano Man, 5 runs, 4 different MusicXMLs, two of
  them trace-off. The `.omr`'s persistent ids differ between two trace-off runs on every multi-system score
  (`last-persistent-id` 2616 vs 2607 on Oh Susanna), so its sheet XML isn't comparable byte for byte (`book.xml` and
  `BINARY.png` are, and match). With the trace off the build gives 0008's MusicXML (Killing at default parallelism;
  `useParallelism=false` itself moves one dot there).
- *Notes.* `tools/tracecheck.mjs` (outside the repo) parses a trace — grammar, every `-` an id sent before, a repeated `+`
  only with a new kind — and compares the `N` notes with the export: the pitch multiset (step+alter+octave of every pitched
  head, slotless chords left out) equals the MusicXML's on all 7 (39 … 2783 heads). `N` is what PAGE found: the export
  reloads every sheet and can still drop a measure that fails then — Greensleeves page 2 rotated 3.5°: `Measure.afterReload`
  "PartBarline with no proper StaffBarline", then "Error visiting Measure{#3P1} in {Page#1.1}" for 9 measures, the
  trace's 88 slotted heads vs the export's 36 (the same MusicXML trace on or off). The browser takes those measures' notes
  off the Reader during the export (`trace.js` `exportLost`) and lists them in the result (`omr.js` `lostMeasures`).
  A 2° skew, a 1.5× page, a skipped page and a staff-less page pass tracecheck.
- *Measure numbers.* `m` is the page's measure id; the export's number adds every earlier page's last measure id
  (`Score.getMeasureIdOffset`, the page's `deltaMeasureId`): the Reader numbers `<measure>` lines that way
  (`readerstate.js` `measureOffset`; Greensleeves' pages 16 + 16 + 16 + 18 = the file's 1…66).
- *Size.* ≈ 106 `emit` calls a page; 13–68 KB a page (4–17 KB gzipped), 380–2100 records (Amazing Grace 13 KB, Oh Susanna
  23, Greensleeves 37, Songbird 43, Killing 48, Piano Man 48, Wichita 68); the largest block 13 KB, the median 20–30 B.
- *Time.* Within noise natively: 178.6 s off vs 178.4 s on over the five pairs run alone. JFR execution samples inside
  `WebTrace` (stderr printing included): 0.20% on Greensleeves (8 of 3952), 0.18% on Killing (10 of 5563), mostly `diff`.
  The cost of a CheerpJ native call is not measured yet.
- *Where the time goes* (native, Killing, from the `E` lines): HEADS 35%, BEAMS 25%, TEXTS 10%, CURVES 7%, GRID 5%,
  BINARY 5%, SYMBOLS 4%, HEADERS 3%, STEMS 3%, the rest ≤ 1.5% each.

**Resume.** Audiveris checkpoints by itself: in batch every finished sheet is stored into the `.omr` (`End of Stub#N`,
trace `S`); the zip is written to a temp file and moved over the old one, so the file on disk is always a whole book.
Running `Audiveris -batch -export <the same -constants> score.omr` on a copy (in a writable folder: the book is saved back
next to itself) skips the finished sheets and processes the rest from LOAD, reading their pages from the input path in
`book.xml`. Native, Wichita (3 pages), the `.omr` copied at `S 1` while the run went on (A, uninterrupted):
- B = Audiveris on the copy: `K 3 1 -`, `End of Stub#1` at once, LOAD only on sheets 2 and 3 (2 `Loaded image` lines), every
  sheet reloaded from the `.omr` for the export; MusicXML = A's; `book.xml` and sheet 1 = A's.
- Killing (6 pages) from a copy taken at `S 2`: `K 6 1,2 -`, 4 pages read, MusicXML = A's — also with pages 1–2 as 1×1.
- The same with the TIFF's finished page replaced by a 1×1 page (same path, same page count): MusicXML = A's, no warning —
  only LOAD reads a page, so the finished pages need not be rendered again.
- Without repeating `-constant …ProcessingSwitches.indentations=false` (it isn't stored in the book): two movements
  (`score.mvt1.mxl`, `score.mvt2.mxl`) instead of one. Every `-constant` must be repeated; `useParallelism`,
  `graceDelay` and `sheetStepTimeOut` only steer the run.
- `kill -9` while sheet 3 was being read, then Audiveris on that same `.omr` in place: `K 3 1,2 -`, only sheet 3 read,
  MusicXML = A's.
- A failed sheet is invalidated in batch (`invalid` is stored: a resumed book doesn't retry it, `K … invalid` lists it), but
  `discarded` isn't stored, so the export starts a new movement after it (read from code; `joinMovements` in fixscore.js
  joins movements). The `.omr` names the engine build (`<book software-build="<commit>">`, the commit of the last
  patch), usable to refuse a resume across engine versions.
- A book whose sheets are all read (stored, or invalid) — a run ended during the export, then resumed: `reachBookStep`
  returns before "Book reaching" ("Nothing to do"), so there's no `K` and no "End of Book{"; the run goes straight to
  "Loaded /sheet#N" for each valid sheet, "Exporting sheet(s)", the export (native, Amazing Grace's finished `.omr`). The
  browser calls that the export from the first "Loaded" once every sheet is accounted for (`omr.js`).
- A sheet left unfinished drawn as a 1×1 page (the browser's "Skip page" after a page stopped the engine twice): it
  fails at SCALE ("No regularly spaced lines found", 88 ms), `F`/`S` are traced, the rest is exported ("Partial
  transcription: 2 of 3 sheets"; Greensleeves pages 1–3 with page 2 as 1×1).
- In CheerpJ (v81, `public/omr/importer.js`): the worker reads the `.omr` after each `S` with `cjFileBlob`, the page keeps
  it; after a reload the book is copied back into `/files` by Java in library mode (`cheerpjRunLibrary('')`, then
  `cheerpjRunMain` as usual) and Audiveris runs on it — MusicXML = the uninterrupted run's once the OCR engine's adaptive
  classifier is reset per call (`ocr-engine.js`; it carried learning from earlier pages, which a resumed engine lacks).
  Tests outside the repo: tools/importresume.cjs, tools/importwk.mjs. `ENGINE` in `public/omr/omr.js` must change with
  `public/omr/lib/` (`<commit>-<first 8 hex of audiveris.jar's SHA-256>-cj<CheerpJ version>`; `build.sh` prints it).

`0010` — **A rest shared by two voices.** When both voices of a staff rest at the same moment, engravers print one
rest, in the middle of the staff; `MeasureRhythm` gives every rest to exactly one voice. The other voice's next chord then
got the end of that voice's previous chord as its time — the time of the rest, a slot to its *left* — and where the voices
disagreed `checkSlotTime` kept the lowest time ("pick up the lowest one and reject the mappings that led to other values"):
the whole slot came a beat early and the voices ended short of the measure. The owner's report: Killing Me Softly bars 7
and 9, a piano right hand with a quarter rest on beat 3 shared by both voices — its beat-4 eighths came out on beat 3.
Now:
- `voiceEnd(chord, slot, inclusive)`: a voice whose last chord (on one staff) ends exactly where a *centered* rest
  (pitch within ±1.5 of the middle line; a rest of one voice among others is moved up or down) of another voice on the
  same staff starts, in an earlier compound slot, would be free at that rest's end (consecutive shared rests too).
- `SlotMapper.endFor` uses it — for the times a slot infers, the mapping check and `applyMapping` (logged
  `… after a rest shared with another voice`) — only when the narrow slot *confirms* that time: its time is already known
  to be that, or another chord of the slot comes there on its own (its voice's last chord end, or a beam or tie). Else the
  raw end, as before: a rest drawn out of line with its column, or a stray rest-shaped symbol, doesn't push a lone chord late.
- `purgeExtinctVoices`: a voice resting along with such a rest stays active until the rest ends, and is over if it doesn't
  resume right there (kept any longer, a stale end brought the early-slot bug back one slot later).
- The voice gets a gap, which the export writes as a `<forward>`, as printed (the rest drawn once).
- Not reconciled with implicit tuplets (`shrinkVoice` re-times from raw ends; the switch is off by default and in the
  browser).

One review round (three lenses, each finding verified): the confirmation rule, the purge rule, the centered and
one-staff conditions came from it. A/B, native, the same build without / with 0010: Killing changes in bars 7 and 9 only
(both as printed; bar 20's dot comes and goes between runs of either build); Goodbye Yellow Brick Road, Greensleeves,
Amazing Grace: identical, it never fires; Stumblin' In: never fires (two runs of the build without it differ in 3 bars, a
dot read or not). Piano Man, Wichita, Songbird and The Longest Time weren't run (their PDFs aren't in this container).

`0011`–`0013` — **Keys, whole notes and chords this engraving loses** (the Musicnotes font: a flat with a taller stem,
whole notes unlike Bravura's). Found by comparing the owner's songs with their PDFs; Goodbye Yellow Brick Road (key of
F) had no key signature on 19 of its 36 systems (B♭ read as B, and a "key change" to C with cancelling naturals where a
system without the key followed one with it), whole notes missing (left-hand C4s on a ledger, F3, D♭3, the upper note of
whole-note octaves) and three half-note chords gone. Three causes, one patch each:
- `0011` **A one-flat key whose flat measures half a step off.** A key item's pitch comes from the glyph's mass and
  area centers shifted by offsets measured on Bravura's flat (`AlterInter.computePitch`). This font's flat has a longer
  stem, so a flat on the B line measures −0.5…−0.6 in treble and 1.4…1.5 in bass (`KeyBuilder` debug: "invalid FLAT
  pitch -0.5 vs 0 for TREBLE"), and a one-item key tolerated 0.5 (`maxDeltaPitch_1`): "no clef-key compatibility" on
  every staff, and the system lost its key (`KeyColumn` checks the staves of a system together). The export then wrote
  nothing (C) on those systems, fifths 0 after a system that had the key, and sometimes took the key's flat for an
  accidental on the first note (C♭5, A♭4, A♭2). Now a key made of a single flat may be up to one step off
  (`maxDeltaPitchFlat_1` = 1.0; the only position a one-flat key has is the B one); sharps and longer keys unchanged (two
  items already allowed one step). Systems with the key: Goodbye Yellow Brick Road 17 → 36 of 36, Wichita all 11
  (`unifyKeySignatures` had only partly repaired it: it treats a key missing on every staff of a system at once as a
  real change, and here a miss is always on every staff).
- `0012` **Whole notes below the stem-less grade.** Whole notes of this font match Bravura's template at only
  0.45–0.6, and a stem-less head under the minimum contextual grade (0.5) is dropped at once in HEADS
  (`isWeakStemLessHead`: it can never get a stem's support); a ledger through it, an accidental beside it, the other
  note of an octave cost a few hundredths. The half-note head found in its place (grade ~0.2) then had no stem and
  went at REDUCTION: no note at all. `stemLessBoost` (0.38 upstream once, then 0) is now 0.15: candidates from about
  0.45 are kept (on Goodbye Yellow Brick Road the lost whole notes were at 0.47–0.50; the one stray whole candidate seen,
  on a half-note chord, was at 0.38 and stays out).
- `0013` **A ledger discarded for a beam that isn't one.** Before ledgers are searched, `LedgersFilter` drops every
  ledger section intersecting any beam or hook candidate. Void heads stacked a third apart around a ledger above the
  staff were read in BEAMS as a little slanted beam and hook (~1 interline wide; purged later by the heads), so the
  ledger went, the head beyond it was never searched (heads outside the staff are only scanned along ledgers found),
  the stem seed ran past the topmost remaining head ("not an end", `HeadLinker`) and no stem was built: every head of
  the chord was deleted for want of a stem. A section that sticks out of the candidate by ≥ ¼ interline on both
  sides isn't part of it and is kept (`minLedgerOverhang`). Goodbye Yellow Brick Road: exactly 4 more ledgers (bars
  54, 62 ×2, 81), all real.

A/B, native, the build with 0001–0010 vs with 0011–0013 too, the owner's nine songs; every changed bar checked against
the PDF; the base and the new build run again where a bar differed by a dot:

| song | bars changed | what |
|---|---|---|
| Goodbye Yellow Brick Road | 52 | the key of F on every system: B → B♭ (33 bars with nothing else changed), C♭5 → C5 (bars 35, 50, 108, 112, 123: the key's flat had become an accidental), E → E♭ (73: a printed flat that OCR had taken for text is an accidental again; 76, 137: tied from the added notes); whole notes added: C4 (4, 20, 40), F3 (27), D♭3 (50), E♭2 (75), D♭3 (88), E♭4 (135, 136); chords added: [G3 B♭3 D4] (54, 62 ×2), [A3 D4 F4] (81) — all as printed. Besides notes (text and curves are built from what the symbol steps leave, so they shift a little): a slur over a system break (93–96) and a tie over one (99–100) now read, as printed; 3 chord names read better; one syllable OCR'd worse (bar 63, "rn" for "m") |
| Wichita Lineman | 13 | the key of F on every system: 11 bars of B → B♭, A♭4 → A4 (4), A♭2 → A2 (25) — as printed |
| Too Sweet | 9 | the middle G4 of whole-note chords (21, 22, 53, 54, 69, 70, 97, 98, 113) |
| The Longest Time | 3 | the tune's whole notes in the right hand, with their 4 syllables: B♭4 (6, 13), C5 (8) |
| Stumblin' In | 2 | G4 in the last whole chord (78); bar 55 a dot (varies between runs of either build) |
| Piano Man | 2 | accordion-staff dots (101, 168; bar 48 too between two base runs) — they come and go between runs of either build; 168 was read right by both new runs, wrong by both base runs |
| Killing Me Softly | 1 | bar 20's dot (varies between runs, as before) |
| Hey, Little Songbird, Yellow Submarine | 0 | |

Not fixed: Stumblin' In's duet (bars 32–35, 73–78) prints the second voice in **cue-size heads** on the main voice's
stem (≈ ⅔ the width), around the C4/A3 ledgers: with the `smallHeads` switch off (the default, and the browser's) only
normal heads are searched, and a template matched across the ledger between a normal and a cue head gives one note a
step off (C4 for [B3 D4]); with `smallHeads` on, the chords stay single and 17 bars of rests and rhythms get worse.

`0014` — **Ties lost over a page turn, into the wrong head of a chord, or beside another voice.** The same comparison
found lost ties the most common error (~40 of 172 findings, with the accidentals a tie carries). What the engine saw —
the trace's symbols per step, the stored `.omr`'s slurs and the heads they link, a debug build logging every tie
decision — sorts them into five causes; this patch fixes the first three:
- **Over a page turn: both halves found, then deleted.** A tie over a page turn is two halves, one at the end of the
  page's last system, one at the start of the next page's first. `Page.connectOrphanSlurs` connects halves between the
  systems of *one* page; a page-edge half had no extension and no tie flag (a tie needs both heads), so it was abnormal
  and LINKS's `checkAbnormals` removed it (trace: `-id` at LINKS; Killing 13 halves on each side of its five page turns,
  Stumblin' In 15 / 13) long before `Voices.refineScore` looks for orphans to connect across pages: upstream never kept a
  tie over a page turn. Killing 9→10, 34→35, 61→62; Stumblin' In 20→21, 42→43, 66→67; Too Sweet 28→29, 73→74; Goodbye
  Yellow Brick Road 62→63; Piano Man 92→93; Yellow Submarine 59→60.
- **The wrong head at a curve end.** Ties into a chord end between its heads; `SlurLinker` takes, in the chord whose box
  middle is nearest the end, the head nearest the end's target point — with two voices at one abscissa another voice's
  chord, with a third the neighbouring head, and a void head found a second time 17 px left of itself at a system start
  (Killing 35, 45) draws both halves. One end on the wrong head: not tie-compatible, a slur. Killing 28, 43→44, 44→45,
  46, 64→65, 68→69 (a whole-note G♯3 tied to a B3 eighth); Stumblin' In 1→2, 11→12, 37→38, 41→42, 49→50, 74; Songbird
  16→17 (so the continuation also lost its natural: B♭4), left hand 37→38; Wichita 3, 14, 20, 28.
- **A chord of another voice struck with a tied head.** `isSpaceClear` refuses a tie when a chord takes more than 25% of
  the tie's box — also the other voice's chord at the very abscissa of one of the tied heads (debug: invasion
  0.46–0.57). Killing B3 10→11, A3 36→37 and 66→67; Songbird G3 37→38 and 58→59, A♭3 122→123.
- *Never built as a curve* (not fixed): no slur or tie symbol there at any step. Killing right hand 24→25 (D♯4 through
  the barline: the D♯4 continuation came out D), 28→29 ([G3 B3] at a system end); Goodbye Yellow Brick Road's left hand
  15, 17→18, 23, 34 (a dotted half tied over the staff lines to an eighth), 32→33, the octaves 96, 133, 136→137 (one
  curve of two, or none); 88→89 and 103→104 lost one half of each tie of an octave at a system break, and the two halves
  left were paired (`canExtend` allows 4 interlines, a below half with an above half) into a slur D♭2 → D♭3, E1 → E2.
- *A misread head* (not fixed): Stumblin' In 20 (the right hand's [A3 C4] read as B3: those halves now connect, as two
  slurs B3 → A3, B3 → C4).

Now (`SlurInter`, `Voices.refineScore`, `Page.checkPageCrossTies`):
- `canStayAbnormal`: a page orphan (`isPageOrphan`: one head, at the start of its page's first system or the end of its
  last, as `isBeginningOrphan` / `isEndingOrphan` say) survives LINKS. `refineScore` connects them across pages as
  before (`checkCrossTie`: tie or slur), then discards those connected to nothing (the score's first and last page, next
  to a missing sheet or part).
- `tieAlternative` / `relink`: when the heads at a curve's ends aren't tie-compatible, the final checks — `checkStaffTie`
  (LINKS) and a second pass after `checkCrossTie` (`retieCrossTie`, run once every connection at hand is checked, so the
  halves tied by then keep their heads) — look on each side for another head of the staff right at the curve end (its
  near edge at most 2 interlines beyond the end or 1 interline back over it; its centre on the concave side within 1.25
  interlines, or 0.6 outside) that is tie-compatible with the far head and isn't already the end of another tie, or of a
  same-pitch slur, on that side. Found: that end is relinked to it and the curve is a tie.
- `isSpaceClear(…, alongsideOk)`: a chord with a head overlapping the left or the right head by half a head's width is
  struck with it, not between — in `checkStaffTie` only. At SLURS (`ClumpPruner`) such a tie into a chord from two
  chords made `ChordSplitter` split that chord, and its rhythm came out wrong (a first build: Killing bar 11 4½ beats).
- `isEdgeClear`, for every cross-system tie (within a page too): no other head of the staff between each tied head and
  its system edge, under the curve; a head touching the tied one (≤ 0.2 interline: a second, a duplicate) doesn't count.
  A phrase slur from a note to a later one of the same pitch over the line was a tie (Killing's voice 67→69 —
  B3 tied twice —, Too Sweet 44→45 over a page turn).

A/B, native, the build with 0001–0013 vs with 0014 too (and before that 0001–0010 vs 0010 + 0014: the same bars changed,
apart from the dots below), the owner's nine songs, every changed bar checked against the PDF:

| song | tied notes (pairs) | bars changed | what |
|---|---|---|---|
| Killing Me Softly | 163 → 183 | 30 | over the page turns: voice D4 + piano [D4 B4] 9→10, voice D4 + piano [E3 G3 D4] 34→35, voice G4 + piano [A3 D4 G4] 61→62, voice slur A4 → F♯4 47→48 and G4 → F♯4 61→62; right heads: D4 28, D4 43→44, B3 44→45, E4 46, G3 64→65, G♯3 68→69 (a slur before); beside another voice: B3 10→11, A3 36→37, 66→67; voice 67→69 a phrase slur, not a second tie on B3 — all as printed |
| Stumblin' In | 228 → 244 | 24 | over the page turns: voice + piano 20→21 (E4; the misread [A3 C4] now two slurs), 42→43 ([B3 D4 G4]), 66→67 ([D4 F♯4 B4]), voice slur G4 → A4 8→9; right heads: A4 1→2, 37→38, E4 11→12, F♯4 41→42, 49→50, E4 74 |
| Hey, Little Songbird | 76 → 81 | 8 | beside another voice: G3 37→38, 58→59, A♭3 122→123; right heads: B♮4 16→17 (the continuation was B♭4), left hand D3 37→38 |
| Wichita Lineman | 66 → 73 | 4 | right heads in the piano's tied 16th chords: [C5 D5] 3, 20, 28, E4 14 |
| Too Sweet | 100 → 102 | 6 | C5 28→29, 73→74 over the page turns; 44→45 a slur over the page turn (B♭4 → the half note on beat 2), not a tie |
| Goodbye Yellow Brick Road | 143 → 144 | 2 | A4 62→63 over the page turn |
| Yellow Submarine | 44 → 45 (+ F♯2) | 4 | F♯4 and the left hand's F♯2 59→60 over the page turn |
| Piano Man | 81 → 82 | 2 | D5 92→93 over the page turn |
| The Longest Time | 2 → 2 | 0 | |

Dots that come and go (durations only, no tie or slur; they differ between two runs of one build): Killing 20, Stumblin'
In 55 and 59, Piano Man P3 48, 101 and 168, Songbird 32, Yellow Submarine 64 (the base with 0013 lost its dot, the build
with 0014 kept it; on 0010 it was the other way round — the dot is made in sheet 4's SYMBOLS, before any of this code runs
on that sheet, and a debug build of 0014 that only adds logging kept it).

Of the comparison's tie findings named for this work: fixed Killing 9→10, 34→35, 43→44 / 44→45, 64→65, 68→69,
Stumblin' In 42→43, 66→67, Songbird 37→38, 58→59, part of Stumblin' In 20→21 (voice and E4); not fixed Killing 24→25
and Goodbye Yellow Brick Road's left hand and octaves (never built as curves), Stumblin' In 20's misread chord. Not done:
a tie over a page turn doesn't carry an accidental (`HeadInter.getAlteration`'s TODO for the previous page: the second
note takes the key's alteration; none of the nine songs has one).

`0015` — **A phantom hollow head beside a hollow head, on the far side of its stem.** The comparison's largest
pattern (97 findings in 5 songs, 76 of them audible): a hollow head with a second one beside it, about an interline
away, at the same pitch or a step off — on the augmentation dot of a dotted half with an up stem (the dot lost: a half
note plus a duplicate; every dotted-half octave of Piano Man's left hand), on the end of a tie arriving at a hollow head
with a down stem (Killing's system starts: the tie went to the phantom and the real chord was struck again), or on an
accidental (the accidental lost: Songbird's B♮3 read B♭3, Goodbye Yellow Brick Road's D♭5 read D5 beside a C5). The
triage's suspect, `evalBlackAsVoid` (a black match relabelled void when its hole is white enough), isn't it: a debug
build logging every head candidate in a watched box (Piano Man bar 28's left hand) shows the phantom matched by the
**void template itself** (`NOTEHEAD_VOID`, distance 0.363, grade 0.22, against the real head's 0.63), so neither
`minHoleWhiteRatio` nor the head templates' font would change it. Why such a match exists: template matching ignores
the pixels of staff lines, ledgers and stem seeds (`DistancesBuilder` neutralizes them), so a void template set in a
staff space beside a stem has one side on the stem and its top and bottom on the staff lines, all ignored, and the dot,
the end of the tie arc or a stroke of the accidental on the other side gives it the rest. Then nothing removes it:
- HEADS: its box overlaps the real head's by 5 px of 23 (a second's heads overlap by the stem width), not enough for
  `HeadInter.overlaps` (more than 0.2 of the width, more than 0.25 of the area), so no exclusion;
- STEMS: it is linked to the stem it shares with the real head, which supports it (`HeadHeadRelation`, same duration on
  one stem): contextual grade 0.67;
- REDUCTION: `checkHeadSide` lets a head stay on the wrong side of its stem whenever another head lies on the other side
  at pitch −1, the same pitch or +1 — the layout of a second (or an altered unison) — whatever that other head is like.

Logged for every head that `checkHeadSide` keeps that way, on the nine songs (and checked against the export: did it
reach the MusicXML), the phantom's grade over its partner's is 0.26–0.47 a step away (Piano Man 195, 210, 213, 222,
Goodbye Yellow Brick Road 86, 97, Yellow Submarine 44, Songbird 17, 37, The Longest Time 60) and 0.23–0.60 at the same
pitch (all the rest; 0.60 is Goodbye Yellow Brick Road 75, whose flat's bowl makes a good left side), the displaced head
of every real second 0.73 or more (void and black). Now `checkHeadSide` takes the other head as a partner only if the head
on the wrong side has at least 0.6 of its grade (a step away, `minSecondGradeRatio`) or 0.8 (same pitch,
`minUnisonGradeRatio`: only an altered unison is real there, two heads matched alike); otherwise the relation goes as
for a head with no partner, and the head with it (no stem). `lookupHead` gives the best head at that pitch (a weaker
duplicate of the real head no longer stands in for it). Once the phantom is gone, SYMBOLS and LINKS give the dot, the
tie or the accidental to the real head.

A/B, native, 0001–0013 vs 0001–0013 + 0015, the owner's nine songs, the base run twice (three times for Stumblin' In)
and the new build twice on Stumblin' In and Piano Man; every changed bar checked against the PDF:

| song | bars changed | what |
|---|---|---|
| Piano Man | 56 (60 bar-parts) | dotted halves back, phantom gone: the left hand's octaves (28, 30, 39, 50, 52, 58, 62, 67, 71, 95, 122, 149, 153, 157, 165, 174, 178, 189, 197, 209, 210, 213, 215, 219, 221, 222, 224, 225, 235, 237 — 210, 213, 222 had the phantom a step above, [G1 G2 A2]), right-hand chords (96, 200, 223, 224), the accordion's chords (51, 83, 91, 97, 99, 101, 137, 140, 145, 152, 183, 185–187, 199, 201, 202, 215, 217, 219–221, 223); ties: 83 and 153 on the real head, 101→102 C5 tied (as printed); 195 [E5 F5] → F♯5 (its sharp back); 163→164: the D4 tie, which began on the phantom, is a slur B3 → D4 (with 0014 too it is the tie again — checked); 58 and 101 weren't in the triage. All as printed |
| Killing Me Softly | 5 | the phantom gone at the system starts 35, 45, 65; the ties 44→45 and 64→65 into the real chords [G3 B3], [E3 G3] (both notes, as printed; the real ones were struck again); 35's two ties over the page turn stay lost here (0014 brings them; with both patches: E3 and G3 tied) |
| Hey, Little Songbird | 8 | 16→17 B♮4 tied into a dotted half (was A♭4 + B♭4 half); left hand 18 and 31 phantom C3 gone ([C2 C3] tied as printed); 37→38 D3 tied (was a phantom E♭3 and no tie); 55 B♮3 (was B♭3 twice); 66 D♭4 (was D4 twice) |
| Yellow Submarine | 6 | dotted halves back: left hand 1, 49, 57 (with their ties on the real heads, as printed), 17 (its upper tie missing in both builds), right hand 44, 72 |
| Goodbye Yellow Brick Road | 4 | accidentals back: 75, 76 E♭3 (and on beat 3 by the bar's rule), 86 C♯4, 97 the voice's D♭5 (was C5 + D5) |
| The Longest Time | 1 | 60: the cue-size verse-2 D5 beside the tune's D5 had been read as an E♭5 on the half note's stem; gone (the cue note itself isn't read: small heads aren't looked for) |
| Stumblin' In, Too Sweet, Wichita Lineman | 0 | (Stumblin' In 17, 55, 59: dots that come and go in either build — base runs 2 and 3 differ there too) |

Pattern 1 before → after: 1a (dot) 74 → 0, 1b (tie end) 10 → 0 (Killing 35's ties still need 0014), 1c (accidental)
13 → 0; plus the triage's Piano Man 195 (accidental) and two phantoms it hadn't listed. Other noise seen: Killing 20,
Piano Man P3 48 and 168, Songbird 32 (dots, between base runs).

Not fixed — **pattern 4** (49 findings, Stumblin' In 20, 32–35, 73–78; Too Sweet 48–55, 96–111): the second voice is
printed in cue-size heads on the main voice's stem, a third away, and small heads aren't looked for. The same debug
build on Too Sweet bar 49: a void candidate across the normal G5 and the cue B♭5 (A5, its ring half of each, its hole
the white between; grade 0.28 by the void template, 0.24 relabelled by `evalBlackAsVoid` — so again not that) overlaps
the G5 (0.79): only an exclusion. In STEMS the stem is built from the void head, the only head at the stem's end (the
cue head isn't a candidate); the G5, with the same stem seed above and below it, is "not an end" (`HeadLinker.linkSides`
leaves it undefined, waiting for a link from an end head that never comes), crosses a stem it isn't linked to and goes.
Tried and dropped: (1) removing a void head that overlaps a black head a step away matched twice as well, in HEADS —
the chord then has no end head at all, nothing is linked, and whole bars came out empty (Too Sweet's 24 bars, Stumblin'
In 32–35 and 74–75): worse; (2) that, plus linking a head left undefined along the longer part of its seed (upstream's
commented-out TODO in `StemsRetriever.checkNeededStems`): the stem is built, but it spans the seed through the cue head,
so `computeDirection` finds no head at either end and REDUCTION deletes it. It needs the cue heads themselves (small
heads as members of a normal chord on its stem). Piano Man 42 and 44 (pattern 7's systems 9–10) show the same void
across a black head and a ledger head. Also left from pattern 7: Songbird 51, 139 (dotted-half chords with seconds —
every head candidate deleted in REDUCTION) and Piano Man's left hand in 40–49 (a treble 8va clef read there).

`0016` — **The dots of a chord taken in a random order.** The accuracy loop's round 2 found its top pattern in dotted
chords exported undotted (20 findings in 5 songs; the rest of the bar then comes half a beat early, and a hand aligned
with it is split into voices) — and found it random: the same build, run twice on the same PDF, kept a chord's dot in
one run and lost it in the next (every "dot that comes and goes" in the A/Bs of 0010–0015 above). The chords: a third
whose heads both sit on lines or ledgers ([G4 B4], [B4 D5], [C4 E4], [E♭4 G4], [A♯3 C♯4]), so their two dots are stacked
one interline apart at the same abscissa, the lower one in the space between the two heads.

What happens (a debug build that only logs: every stacked pair of dot candidates, the order they are checked in, the
head each takes, and every chord whose heads are dotted in part; three runs of the 0015 build on the five songs, plus
the round's own run):
- `AugmentationDotInter.lookupHeadLink` expects the dots top down ("Assumption: System dots are already in place or
  they are processed top down"): among the free heads within reach (0.8 interline up or down), a head facing the dot
  (in its space) wins, else the topmost. Top down, the upper dot takes the upper head and the dot below, finding it
  taken, the lower one. Bottom up, the lower dot takes the upper head, and the upper dot has no free head within
  reach.
- `DotFactory.lateDotChecks` sorted the candidates by abscissa only (a stable sort), so a stack kept the order in
  which `SymbolsBuilder` had evaluated its glyphs. A glyph cluster is one of JGraphT's `connectedSets()` (a
  `HashSet`), its seeds sorted by weight only (`GlyphCluster.decompose`), and a `Glyph`'s hash includes its run
  table's orientation, an enum, whose identity hash changes from run to run (`RunTable.hashCode`:
  `Objects.hashCode(orientation)`). Two dots of one weight — every pair on a page rendered from vectors — come in hash
  order: Killing Me Softly bar 20's two 9×9 dots hashed `6dbf98b7` / `6dbf9df6` in one run (the upper one evaluated
  first: both heads dotted) and `e4994c3b` / `e49946fc` in the next (the lower first: it took B4, the upper dot found
  nothing). On a scan (Songbird) the weights differ and the heavier dot comes first, every run: Songbird lost the same
  6 chords' dots in every run.
- One head of two dotted, `AbstractChordInter.countDots` takes the mean, `Math.rint(0.5)` = 0, removes the dot and the
  chord is undotted. A chord of three or four heads kept its dot by the majority, with dots on the wrong heads.
- How often: of the stacked pairs that reach a head, 6–9 of Killing's 13, 11–17 of Stumblin' In's 33, 81–89 of Piano
  Man's 174, 54–62 of Yellow Submarine's 116 and 65–68 of Songbird's 125 were checked bottom up, a different set in
  each run; between two runs 2 (Killing) to 120 (Piano Man) dot–head links differed, and the books' inters (kind,
  shape, pitch, bounds) differed in augmentation dots only.

Now `DotFactory.sortDots`: the candidates go by columns, left to right — a column being the dots whose abscissa range
overlaps that of its leftmost dot — and each column top down; both orders are total (abscissa, ordinate, width, height),
so the outcome no longer depends on the order the glyphs were found in (16–88 pairs a song were found bottom up and are
now checked top down). Top down also suits a lower voice whose dots are printed *below* its line notes (Yellow
Submarine's right hand, a third on lines under a dotted half): the upper dot, between the two heads, takes the upper
one, the lowest dot the lower.

**Determinism.** The 0015 build, four runs (the round's `r15` + three): the exported MusicXML differs between runs in
Killing 20, Stumblin' In 17 and 59, Songbird 32, Piano Man 48 and 168, Yellow Submarine 64 (dotted in some runs, not in
others). With 0016: four runs of those five songs, three of the other four — byte-identical MusicXML (encoding date
aside), identical inters and identical dot–head links, every song (links found, one base run → 0016: Killing 136 → 136,
Stumblin' In 141 → 151, Songbird 420 → 456, Piano Man 649 → 687, Yellow Submarine 423 → 428). The `.omr`'s ids still
differ between runs (glyphs and inters are numbered in hash order), nothing that is exported.

A/B, native, 0001–0015 (`r15`) vs 0001–0016, the owner's nine songs, every changed bar checked against the PDF:

| song | bars changed | what |
|---|---|---|
| Hey, Little Songbird | 6 | the right hand's dotted chords back: [A♭3 C4] dotted quarters 27, 48, 78 and [A♭3 E♭4] + [E♭4 G4] 127, with the rest of the bar half a beat later; [E♭4 G♭4] dotted half 79; [C4 E♭4] dotted half 43 — all as printed. But 43's left-hand G2 on beat 3 is now dropped ("No timeOffset"): the bar's lower right-hand voice (a quarter rest, then E♭3) is misread in both builds (its rest given to the left hand, E♭3 timed on beat 3), and with voice 1 now full the E♭3 lands in the left hand's voice at G2's time |
| Too Sweet | 6 | 53, 55, 97, 105, 109, 111: the vocal line's harmony in cue-size heads (pattern 4: cue and normal heads merged, the bar's dotted-quarter chord read as a half-note chord, the chords after it misread or missing). Its two printed dots are now both found, so the misread chord is a dotted half: the bar 4 beats long instead of 3 (111: 4 instead of 5, its stray last chord gone). Wrong before and after |
| Piano Man | 2 | the accordion's dotted halves [G3 C4 E4] 48, [C4 E4] 168 — as printed |
| Killing Me Softly | 1 | 20 [G4 B4] dotted quarter, the rest of the bar half a beat later — as printed |
| Stumblin' In | 1 | 55 [B4 D5] dotted quarter, the rest of the bar half a beat later and the left hand in one voice on its beats — as printed |
| Yellow Submarine | 1 | 64 [A♯3 C♯4] dotted half — as printed |
| Goodbye Yellow Brick Road, The Longest Time, Wichita Lineman | 0 | byte-identical MusicXML |

Bars the round's run happened to get right and other runs lost (Stumblin' In 17, 59, Songbird 32 in this build's runs,
Piano Man 101 in earlier builds') are right in every run of 0016. The triage's pattern 1, 20 findings → 8: fixed Killing
20, Stumblin' In 55 (×2), Piano Man 48, 168, Yellow Submarine 64 (the five "regressions" of round 2), Songbird 27, 43,
48, 78, 79, 127; one new defect (Songbird 43's G2, above). Chords left undotted, none of them an order problem — each
has fewer dots than heads whatever the order:
- Piano Man 191, 192: four-note right-hand chords on ledgers above the staff; the two upper dots, one each side of a
  ledger, were one glyph with it (9×26 once the ledger was taken out) and never a dot candidate: 2 heads of 4 dotted.
- Piano Man 100, 202: left-hand [G1 G2] octaves below three ledgers; G1's dot is printed a space above its head in 100
  (one interline: beyond the 0.8 reach) and, in 202, its glyph is never a symbol candidate: 1 head of 2.
- Yellow Submarine 3, 4 (×2): the right hand's lower voice [A♯3 C♯4], dots printed below the notes; the lower dot, at
  the height of the lyric line, is read by OCR as a lyric "o": 1 head of 2.
- Songbird 121: a dotted chord with a second (heads on both sides of the stem), read as two voices.
With 0016 the seven chords of the first three items are the only ones in the nine songs dotted on exactly half their
heads, and all seven are dotted in print; `countDots` rounds the half down (`Math.rint(0.5)` = 0, the dot removed).
`0017` — **Ties that run along a staff line; two ties linked to the same notes.** The accuracy loop's round 2 still
found ties lost (56 findings, 53 audible); 38 of them inside a system, where 0014 had changed nothing. A debug build
logging, for watch boxes around every finding, each skeleton arc (shape, ends), each slur seed's extensions on both
sides (and why `addArc` refused one), what `weed` kept or purged, each candidate's grade or reason, and ClumpPruner's
choice, showed that most of them are **long flat ties lying along a staff line**: a whole note or a dotted half
tied to the next note, the tie just above the top line or below the bottom line (Goodbye Yellow Brick Road's and
The Longest Time's left hands, Yellow Submarine's right hand on C♯5 and F♯4, Too Sweet's whole-note chords, Piano
Man's voice in bar 71), or along a line inside the staff. Close enough to merge with the line, the tie's arcs were
all in the skeleton, but no slur was made of them, so no curve appeared at any step:
- The skeleton is computed on the image *with* its staff lines. Where the tie touches a line, each vertical run
  holds both, and the skeleton runs in the middle of the run, a pixel or two off the tie towards the line, joined to
  the line at both ends: the tie is cut into a free middle arc, merged stretches (`LINE` or `STAFF_ARC` arcs) and,
  beyond the line crossing, its free ends.
- Joining a merged stretch to the middle arc gave a side model (the circle through three points of the last six
  interlines) that bends the other way than the slur by a fraction of a pixel — the side of a long flat tie is
  nearly straight — and `addArc` refused the extension (`ccw`): Goodbye Yellow Brick Road 15, 17, 23, The Longest
  Time 50, 52 (whose tie hugs the line its whole length).
- Where the extension was taken, the side model through the shifted points missed the points beyond, and `weed`
  dropped the candidate (side distance over 0.1 interline: Yellow Submarine 1, 1.95 px for 1.70).
- The middle arc alone ends two or more interlines short of the heads, so ClumpPruner linked no head (`selected
  null`).

Now (`SlursBuilder`, `SlurInfo`):
- `onCurve`: where the run holding a staff line sticks out of it on one side only, by 0.1 interline or more, the
  curve's middle is half a line thickness inside the run's outer end. `SlurInfo.computeSideModel` defines a side
  model by its three points moved there, and `computeImpacts` measures a side model on its points moved there too
  (`sidePoints`). Global models (and a slur no longer than a side, whose side model is the global one) stay on the
  skeleton points: moving every point made pieces of staff line merged with something look like curves (Wichita
  12's voice tie came out twice, bar 32's F4 tie went to the D4), and leaving merged points out of
  the fits did the same (Wichita 32–33: a stretch of the D5 line took the B4 tie's arcs).
- `addArc` lets an extension through when the new side model bends against the slur but is flat over its side
  (sagitta ≤ 0.07 interline: `isFlat`), unless the arc added is a piece of bare staff line — one interline or more,
  4 points in 5 on a line with nothing sticking out (`isAlongLine`): without that guard a short tie's left extension
  ran along the line for 400 px and the purge of shorter candidates (`purgeShortests`) dropped the tie (Killing
  46–47's F♯4).

Ties of a chord tied over the barline lie one above the other along the lines, and two of them could be linked to
the same two heads, the ones nearest both curve ends (Too Sweet's [D4 G4 B♭4 D5] whole notes: D5 tied twice, B♭4
not at all — 5 bars on engine 15 already, more once the ties above are found; Piano Man's accordion [A3 C4 F4] in
151; Stumblin' In 5's [C4 E4 A4]). `SlurInter.checkStaffTie` now looks, when another curve links the very same two
heads (`twinOf`), for another pair right at this curve's ends (`tieAlternativePair`: each as `tieAlternative` sees
one head — `altDy`, now shared —, tie-compatible, not the end of another tie, the space between clear) and moves
the curve there; when both twins could move, the one whose ends lie farther from the heads (`endsDistance`).

A/B, native, engine 15 (0001–0015) vs + 0017, the owner's nine songs (the trace on, as the browser runs it), every
changed bar checked against the PDF's 300-dpi rendering (the clean build and the debug build it came from, run
apart, gave the same tie changes):

| song | tie pairs | bars changed | what |
|---|---|---|---|
| Too Sweet | 102 → 144 | 52 + 3 | the right hand's whole-note chords tied over the barline (17–22, 41–46, 49–54, 65–70, 81–86, 89–94, 97–102, 107–110, 113–118; 67–68 over the line break), the twin ties on D5 (41, 43, 81, 83, 89, 91, 93, 113, 115) moved to B♭4; the voice's slurs 67 (G4 → B♭4) and 119–120 (D5 → B♭4) as printed |
| Goodbye Yellow Brick Road | 144 → 160 | 26 | left hand 15, 17–18, 23, 32–33 (and the voice 32–33), 52–53, 60, 68, 77, 88–89, 103–105, 133–137; the accidentals they carry: E♭3 33, D♭2/D♭3 89, E♭1/E♭2 104–105, D♭3 134, E♭3 136–137; the voice's phrase slurs 31–33, 74–76 |
| Yellow Submarine | 52 → 65 | 25 | voice C♯5 17, G♯4 31, C♯5 49, 57; right hand C♯5 1, 17, 25, F♯4 3, 51; left hand C♯3 7, 17, 23, 55; 59: the half at the line break on the F♯4, not on C♯4 (still a slur) |
| The Longest Time | 2 → 7 | 10 | left hand B♭2 50–51, C3 52–53, E♭3 56–57, C3 60–61, B♭2 64–65 |
| Piano Man | 85 → 89 | 8 | voice C5 71–72; accordion [A3 C4 F4] 151–152 (twin moved), C5 185–186; the voice's slur 211–212 from the tied B4 |
| Wichita Lineman | 73 → 76 | 4 | voice D5 19–20; right hand A4 and F♯4 11–12 (the continuation F♯4, was F4) |
| Hey, Little Songbird | 81 → 83 | 2 | right hand C4 42, 57 (half note into the beat-3 eighth) |
| Killing Me Softly | 183 → 184 | 2 | right hand B3 40–41 |
| Stumblin' In | 244 → 245 | 1 | right hand 5: the twin tie on C4 moved to E4 |

Other bars changed only by dots that differ between any two runs of engine 15 (0016 makes them deterministic):
Killing 20, Stumblin' In 17, 55, 59, Piano Man's accordion 168, Songbird 32, Yellow Submarine 64. No regression:
every changed note checked against the print.

Round 2's tie findings, before → after: within a system 38 → 12 (24 fixed here, 2 more — Yellow Submarine's right
hand 23 and 55 — by `restoreTies`' rule 2, which now reaches a tune note held over an inner voice); across a break
8 → 8 (Yellow Submarine 59–60's right-hand half now on the right head); into or out of endings 6 → 6; the accidentals
4 → 2 (Goodbye Yellow Brick Road 33 here, Killing 40–41 by `restoreTies`' new rule 5). Not fixed:
- ties along a line still not assembled: The Longest Time 54 and Piano Man 219–220 (the extension through the
  merged stretch fails the side distance by a hair, 1.85 / 2.21 px for 1.70), Yellow Submarine 11 (2.40 px measured
  on the moved points), Goodbye Yellow Brick Road 34 (the tie's ends merge into a staff-line arc longer than five
  interlines, classified `IRRELEVANT`: the middle arc ends 34 px from each head, the link area reaches 2 interlines);
- a tie whose ends lie *on* a staff line inside the staff (Yellow Submarine's right-hand G♯4 23, 31, 55, along the
  B4 line; 23 and 55 now tied by `restoreTies`' rule 2, 31 not — the tune is alone in its strike there): its end
  parts are purged as staff line (`purgeStaffLines`) and the middle arc stops 25–36 px short of the heads;
- no curve at all: Wichita 19's ties between 16th chords (≈ 20 px), Songbird 47 (into a triplet) and 76–77, Goodbye
  Yellow Brick Road 96–97 (an eighth on ledger lines tied over the barline, its D♭ lost with it), Piano Man's
  accordion 164, 165, 167 (its G4 held under changing chords: no curve for 164→165);
- across breaks: one half or both never found (Goodbye Yellow Brick Road 73–74 — the first half is there, as a slur
  —, 95–96, Songbird 68–69, 77–78, Wichita 27), Piano Man 202–203 (both halves connected, the right one on A4: a
  slur), Piano Man 132 (after a dropped fill box);
- into or out of endings (Killing 40 ×2, Stumblin' In 60, 77, 78, Wichita 30): a tie-in or tie-out arc with no head
  on one side. Sing and Play strike a note again after a jump anyway; the accidental a tie-in carries is
  `restoreTies`' rule 5.

`0018` — **A chord dotted on half its heads is dotted.** Rounding the half up instead (`Math.floor(mean + 0.5)`), on
top of 0016: on the nine songs it changes exactly those seven chords — Piano Man 100, 191, 192, 202 and Yellow
Submarine 3 (both chords), 4 (with the rest of the bar, both hands, half a beat later) — all as printed, and nothing
else.

`0019` — **A cue-size second voice on the main voice's stem.** Round 2's pattern 3 (66 findings, 62 audible, in four
songs): Too Sweet's vocal line carries a harmony in cue-size heads on the tune's own stems, a third (sometimes a
fourth) above it — on ledger lines over the staff —, and Stumblin' In's voice staff is a duet whose second voice is
cue-size heads on the tune's stems, a third to a sixth below. Every such chord came out as one wrong head, often on
the step between ([G5 + cue B♭5] → an A5 half, [D5 + cue F5] → E♭5), quarters read as halves, bars overfull, the cue
notes lost (and once a half-note "triplet" that the clean-ups made of a 6-beat bar).

What happens (the 0009 trace and a debug build making the heads in a watch box VIP; Too Sweet bar 49, Stumblin' In
bar 32):
- With the small heads switch off (the web's setting, as upstream's default) small heads are never candidates. The
  void template matched across the pair — its ring's top on one head, its bottom on the other, the ledger between
  blanked as in 0015 (grade 0.24–0.28) — and that head, the only one at the stem's end, got the stem. The real head
  (a black G5, 0.79), its stem seed going on past it to the cue head, was "not an end" for `HeadLinker.linkSides`,
  got no stem and was removed at REDUCTION (`checkHeadHasStem`).
- `-constant org.audiveris.omr.sheet.ProcessingSwitches.smallHeads=true` alone (A/B on the nine songs, the 0016 +
  0018 build with and without it) is much worse: small heads are then looked for everywhere, and the curl of a
  quarter rest is a small black head with its zigzag for a stem — 286 quarter rests lost (Piano Man 187, Songbird 28,
  Killing 21…), 692 bars changed, 378 small chords; a small template matches inside a normal black head (Too Sweet
  49's G5 read as small); `SigReducer` doesn't let small and standard heads share a stem, so one of the pair goes
  (Too Sweet's voice bars 49–55 and 96–111 came out empty or rests only); a stem whose first head is small is a
  grace stem for `StemInter.isGraceStem` and refuses a standard flag; and a small head is exported as a grace note
  (`SmallChordInter`, outside the voices) — a timed cue note isn't in Audiveris's model. It did bring grace notes
  (17 over the nine songs: Piano Man 2, Songbird 21, Too Sweet 28 and 79…), with the rest of the damage.

Now, with the switch off, small heads are *cue partners* only (`ShapeSet.smallHeadsArePartners`):
- HEADS (`NoteHeadsBuilder`): on each stem seed the small black and void templates are tried with the standard
  ones (`seedShapes`; not in the range scan, not on a drum staff). After the staff's purges, `selectCuePartners`
  keeps a small head only beside a standard head of the same kind (black / void) on the same seed and side, 2 to 5
  steps away (a third to a sixth: the nine songs' cue partners are 2, 3 and 5 away; an octave let a left hand's low
  octave head below the staff read as a cue, Piano Man 43–49), of grade 0.4 or more; the small head itself 0.45 or
  more (true cue heads 0.48–0.80, the lowest on a staff line; false ones, a seventh away, 0.45–0.48), and no
  standard head at its pitch or a step away overlapping it with 0.75 of its grade or more (a small template inside
  or beside a real head: every head of a chord drew one). A partner kept removes the weak standard heads on it, a
  step from it or matched across the pair (the void ring). Small seed heads are not competitors for the range scan,
  so the standard heads found are the ones found before.
- STEMS: small heads are linked like stem heads (`getStemHeadsLinked` in `StemsRetriever`), also on a standard
  beam (`BeamLinker`, `HeadLinker`).
- REDUCTION: no exclusion between small and standard heads on one stem, nor between small heads and standard
  beams.
- CHORDS: a stem holding a standard head makes a standard chord, the cue head its member (`ChordsBuilder`); a
  standard chord is told by its class (`Measure.getStandardHeadChords` read the first member); a grace stem is one
  with no standard head (`isGraceStem` read the first head: the eighths' flags were refused); a slur from a cue head
  names no grace chord (`HeadChordInter.getGraceChord` cast its chord: the export threw on Too Sweet's voice).
- Export (`PartwiseBuilder`): the cue head is a `<note>` with `<cue/>` and `<type size="cue">`, written after the
  chord's standard notes (`exportOrder`: a chord's first note, which carries its lyrics, directions and timing, is
  never a cue), with no `<tie>` element (MusicXML's cue notes have none; `<tied>` stays). A small chord is a grace
  note as before; the trace marks a grace by the chord's class too.

A/B, native, 0001–0016 + 0018 (`h1`) vs + 0019, the owner's nine songs, every changed bar checked against the PDF:

| song | bars changed | what |
|---|---|---|
| Too Sweet | 24 | the voice's harmony: 48, 96 (D5 + cue F5, F5 + cue A5 quarters; was an E♭5 half), 49, 97, 105 (G5 + cue B♭5 dotted quarter, B♭5 + cue D6 eighth, G5 + cue B♭5 half; was an A5 dotted half and a 3-note half chord), 51, 99, 107 (D5 + F5, F5 + B♭5, D5 + F5), 53, 55, 101, 103, 109, 111 (C5 + E♭5, D5 + F5, B♭4 + D5; was a B♭4/D5 dotted half and an E♭5), 50, 52, 54, 98, 100, 102, 104, 106, 108, 110 (quarter chords a third apart after a rest; were halves), the eighths' flags found again, every bar 4 beats; 104 is no longer a 6-beat bar (the clean-ups' half-note triplet there is gone) — as printed. System 27 (101–104) comes out an octave high in both builds (a treble 8va clef read there, which the clean-ups' stray-8va rule moves back) |
| Stumblin' In | 9 + 3 | the duet's cue voice: 32–35 (D4 + cue B3, C4 + A3, B3 + G3 eighths; were a C4 quarter, a B3 half, an A3 half, 4¼-beat bars, syllables on the wrong verse), 73–75 (G4 + cue B3, A4 + C4, B4 + D4: a sixth below; were D4/G4 half chords), 76 and 78 (the G4 + cue B3 the bar starts with; were rests only) — as printed; right hand 34: the F♯3 of a tied chord now tied (as printed, A3 still not); right hand 42: two of three ties over the barline lost (B3, D4; `restoreTies` puts them back); 40: the voice's three syllables lost (below) |
| the other seven | 0 | MusicXML byte-identical (encoding date aside) |

With 0017 applied first (0001–0019): the same Too Sweet and Stumblin' In bars change, identically, and 0017's own
(its right-hand ties) stay as they are — the two patches touch different files and different staves.

The HEADS step takes the same time (Piano Man 39.4 → 40.0 s, Too Sweet 31.1 → 30.7 s, native); the trace's
pitched heads still equal the export's.

The lyrics around Stumblin' In's cue bars move, though the inters there don't: the OCR image (`TextsCleaner`) now
erases the cue heads, and Tesseract's page layout changes with it. Before, the unrecognised cue heads below bars
34–35 were read as a lyric line of their own, so the verse lines under them were numbered 2 and 3 and the chorus
line of bar 36, printed between them, 3 (the clean-ups fold a sparse verse 3 into verse 1); now that line is gone,
the chorus line is verse 2 and bar 34's second verse verse 3 — Sing's verse 1 has no words in bar 36 (5 syllables)
and still mixed ones in 34. Bar 40's lyric line, under the next system but one, lost its first three words (the
image there is identical; the OCR of the page isn't). Bar 32's two verses are right now (were swapped, with junk)
and bar 33 has its syllables.

Round 2's pattern 3, 66 findings → 13: the merged heads 52 → 3 (Stumblin' In 20 ×2 and 21: a normal-size third on
ledger lines in the piano, [A3 C4 E4] → [B3 E4], not cue heads), the missing cue notes 14 → 10. Not fixed:
- cue notes in a voice of their own, with their own stems: The Longest Time's verse-2 pickups and rhythm (20, 44,
  60, 62), Wichita Lineman's verse-2 voice (9, a cue unison beside the tune's C5s), Stumblin' In 18 (a second voice,
  normal size). A small head with no standard partner on its stem is still dropped: Audiveris can only make such a
  chord a grace note, outside the voices and the bar's time;
- grace notes (pattern 8): not looked for (only the switch does, with the damage above). `crossHeads` and
  `implicitTuplets` were tried the same way and help no more: `crossHeads` reads Piano Man 191's x-heads (as
  printed) but adds notes or splits voices wrongly in seven songs (Too Sweet 18 bars, Songbird 12, Killing's right
  hand 13, Goodbye Yellow Brick Road 83 and 89, Yellow Submarine 66, Wichita 9, Piano Man 2 and 192 — its grace
  note read as a quarter); `implicitTuplets` doesn't
  fix Songbird 83's duplets and puts dropped chords after the barline (Too Sweet 13 bars, Songbird 43, 90, 149,
  Piano Man 42, 203, Goodbye Yellow Brick Road 83–84, Yellow Submarine 10, 53; Killing 31's eighths made a
  triplet).

`build.sh` applies the patches with `git am --keep-cr`: the upstream sources are CRLF.

## StripVolatile (applied to every jar)

Two rewrites, both invisible to Java semantics (details in the file's header):

**2-D primitive arrays.** CheerpJ 4.2's JIT miscompiles hot code that allocates a 2-D primitive array in one shot
(`multianewarray`, e.g. `new double[m][n]`) and fills it element by element: after ~70 calls the results are wrong.
Jama's `Matrix.getArrayCopy` does exactly that, so the circle fits behind slur and tie detection failed and pages 2+ had
no slurs or ties at all. Every such allocation (178 sites across the jars) becomes a call to a generated
`cheerpjfix/Arrays2D` helper that allocates the rows one by one. Verified natively under `-Xverify:all` with identical
output. CheerpJ 5.0 doesn't have the bug.

**Volatile/final flags.**

CheerpJ's runtime lacks the `Unsafe` natives behind *reflective* access to `volatile` (and, once made
accessible, `final`) fields of type boolean/byte/short/char/float, which JAXB uses for book storage and
MusicXML export. CheerpJ runs all Java threads on one JavaScript thread, so `StripVolatile.java` (JDK 25
`java.lang.classfile`) clears `ACC_VOLATILE` on such fields and `ACC_FINAL` on such *instance* fields,
and nothing else about fields. Verified natively: identical MusicXML before/after.

## Runtime settings (in `public/omr/omr.js`)

Java properties `user.home=/files`, `sun.java2d.uiScale=1` (skips a JNA/GTK probe), `audiveris.ocr=web`,
`audiveris.web=true`, `java.awt.headless=true`; Audiveris constants `Main.sheetStepTimeOut=7200` (slow devices),
`OmrExecutors.useParallelism=false`, `OmrExecutors.graceDelay=1`. Everything runs in a Web Worker
(`public/omr/omr-worker.js`) — on the page's main thread CheerpJ froze the UI for up to 11 s at a time.
