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
