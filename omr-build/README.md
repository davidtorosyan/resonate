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

## StripVolatile (applied to every jar)

CheerpJ's runtime lacks the `Unsafe` natives behind *reflective* access to `volatile` (and, once made
accessible, `final`) fields of type boolean/byte/short/char/float, which JAXB uses for book storage and
MusicXML export. CheerpJ runs all Java threads on one JavaScript thread, so `StripVolatile.java` (JDK 25
`java.lang.classfile`) clears `ACC_VOLATILE` on such fields and `ACC_FINAL` on such *instance* fields,
touching nothing else. Verified natively: identical MusicXML before/after.

## Runtime settings (in `public/omr/omr.js`)

Java properties `user.home=/files`, `sun.java2d.uiScale=1` (skips a JNA/GTK probe), `audiveris.ocr=web`,
`audiveris.web=true`, `java.awt.headless=true`; Audiveris constants `Main.sheetStepTimeOut=7200` (slow devices),
`OmrExecutors.useParallelism=false`, `OmrExecutors.graceDelay=1`. Everything runs in a Web Worker
(`public/omr/omr-worker.js`) — on the page's main thread CheerpJ froze the UI for up to 11 s at a time.
