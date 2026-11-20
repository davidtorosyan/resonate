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

**How to A/B** (native; `tools/trace-ab.sh`, `trace-cmp.sh`, `trace-resume.sh`, `trace-jfr.sh` outside the repo do this
for the test scores): build in a checkout with the patches applied (`./gradlew -PtheMinJavaVersion=17 :app:installDist`),
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
