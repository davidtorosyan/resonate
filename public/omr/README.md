# In-browser music recognition (PDF → MusicXML)

Used by `pdf-import.html`. Everything runs client-side:

| piece | what | license |
|---|---|---|
| `lib/*.jar` | [Audiveris](https://github.com/Audiveris/audiveris) (optical music recognition, Java) and its dependencies, compiled for Java 17 with the patches in `/omr-build/patches` (GUI-only libraries left out) | Audiveris: AGPL-3.0. Dependencies: their own licenses (Apache-2.0, LGPL, EPL, BSD, MIT, CDDL; `jai-core` under Sun's JAI distribution license) — as shipped by Audiveris |
| CheerpJ | WebAssembly JVM that runs the jars, loaded from `cjrtnc.leaningtech.com` | CheerpJ Community Edition — free for personal and non-business use |
| `tesseract/` | [tesseract.js-core](https://github.com/naptha/tesseract.js-core) 6.1.2 (Tesseract OCR compiled to WebAssembly, with the legacy engine Audiveris needs) | Apache-2.0 |
| `tessdata/eng.traineddata.gz` | Tesseract English model, tessdata 4.1.0 (legacy + LSTM) | Apache-2.0 |
| `fonts/Bravura.otf` | [Bravura](https://github.com/steinbergmedia/bravura) music font (Steinberg), the copy Audiveris ships in `res/`; handed to Java in memory | SIL Open Font License 1.1 (license text embedded in the font) |
| `pdfjs/` | [pdf.js](https://github.com/mozilla/pdf.js) 6.5.438 | Apache-2.0 |
| `pdfjs/wasm/` | pdf.js's image decoders for scanned PDFs, loaded on demand: JBIG2 (from PDFium), JPEG 2000 (OpenJPEG), color profiles (qcms), with JS fallbacks | BSD-3-Clause (PDFium), BSD-2-Clause (OpenJPEG), MIT (qcms); license files alongside |
| `pdfjs/standard_fonts/`, `pdfjs/iccs/` | pdf.js's substitutes for PDF fonts that aren't embedded (Foxit, Liberation) and its default CMYK profile | BSD-3-Clause (Foxit/PDFium), SIL OFL 1.1 (Liberation), CC0 (ICC); license files alongside |
| `omr.js`, `omr-worker.js`, `ocr-engine.js`, `pdfprep.js`, `trace.js`, `jobs.js`, `importer.js` | glue: the engine, page prep, the trace → events, the resumable import job (this repo) | — |
| `reader.js`, `readerstate.js` | the Reader: the import drawn as it happens — a mountable component (this repo) | — |

**Source for the Audiveris build** (AGPL §13): upstream commit `7a36078` plus
`/omr-build/patches/*.patch`, built by `/omr-build/build.sh`.

## How it fits together

1. `pdfprep.js` renders each PDF page at 300 dpi with pdf.js, keeps pages that have staves
   (Audiveris fails a whole book on a page without staves), and packs them into one
   8-bit gray multi-page TIFF.
2. `omr.js` hands the TIFF to `omr-worker.js`, a Web Worker that starts CheerpJ (Java 17 runtime) and runs Audiveris's batch CLI on it:
   `-batch -export -output /files/… /str/score.tif`, then reads back the `.mxl`.
3. Lyrics/text OCR: Audiveris calls `WebOCR.recognizeGray` (a Java `native` method) which CheerpJ
   routes to JavaScript in the same worker; `ocr-engine.js` runs it on the WebAssembly Tesseract exactly like
   Audiveris's `TesseractOrder` does natively (legacy engine, same page-segmentation modes,
   word font attributes, baselines, symbol boxes).
4. Live trace (engine patch 0009): with the Java property `audiveris.web.trace=web`, Audiveris calls
   `WebTrace.emit(String)` (a `native`, `Java_org_audiveris_omr_text_web_WebTrace_emit(lib, block)` in the worker — a
   plain synchronous function: an async native would suspend the Java thread) once per step per sheet and once per
   system per per-system step: staff geometry after GRID, the symbols each step adds or removes per system (boxes in
   TIFF pixels), measure boundaries, and after PAGE the notes (pitch, duration, voice, syllable) as the MusicXML export
   computes them — ~100 calls and 13–68 KB a page. Record format: `/omr-build/README.md` ("0009"). The worker posts each
   block as `{ type: 'trace', block }`; `trace.js` turns blocks into the progress view's events (the contract is at the
   top of `readerstate.js`), and the OCR native's words (`{ type: 'ocr' }`) into `words` events in sheet pixels.
   Nothing is traced without the property; `=stderr` prints the same blocks in a native run. Two things the trace
   can't know: a sheet that failed is still stored (`F` then `S`) — it stays failed, `S` gives no `done` for it —
   and the notes are what PAGE found: the export can still drop a measure that fails when its sheet is reloaded
   (a skewed scan's barlines: "Error visiting Measure{#3P1} in {Page#2.1}"); `trace.js` `exportLost` takes those
   notes off the Reader during the export (sheets traced in this run) and `convertPdf` lists them (`res.lost`, the
   result card: "Page 3: 2 bars left out").
5. Resume: every finished sheet is stored in the book's `.omr` (`End of Stub#N`, trace `S s ms`). Audiveris run on a copy
   of that `.omr` (in a writable folder — it saves back next to itself) with the same `-constant`s skips the finished
   sheets and gives the same MusicXML; the input TIFF must be at the path `book.xml` recorded (`/str/score.tif`), and
   its finished pages may be 1×1 placeholders (only LOAD reads a page). In the browser (`importer.js`, `jobs.js`): the
   worker reads the `.omr` with `cjFileBlob` right after each `S` and the page keeps it in IndexedDB
   (`resonate-imports`) with the PDF and the events shown so far; after a reload the TIFF is rebuilt from the stored PDF
   (only the unfinished pages; the rest 1×1), the book is copied back into `/files` by Java in CheerpJ's library mode
   (`cheerpjRunLibrary('')`, `FileInputStream.transferTo(FileOutputStream)` from `/str` — no JavaScript API writes
   `/files`), and Audiveris runs on it. A job made by another engine (`ENGINE` in `omr.js`) starts over (the
   Reader then gets none of its stored sheets). A book whose sheets are all read prints nothing before the export
   (no "Book reaching", no `K`, no "End of Book"): `omr.js` calls it the export at the first "Loaded /sheet#N" once
   every sheet is accounted for. Errors carry a `kind`: a file that fails the same way every time (`pdf` — locked
   or not a PDF —, `nomusic`, `blank`, `unread`, `missing`) isn't kept; another error keeps the job once per stage.
6. OCR: Tesseract's adaptive classifier is cleared before every call (`ocr-engine.js`), as Audiveris's own
   `TesseractOrder` gets a new engine per call: a page's words no longer depend on the pages read before it (which
   also made a resumed import read some words differently).
7. The progress view: `importer.js` (and `omr.js` under it) produce one stream of events — the contract is at the
   top of `readerstate.js`; what is stored for a resume is the same events — and `reader.js` draws them:
   `mount(el, { onStop, onMinimize, onExpand, minimized })` → `{ push, load, hold, canStop, minimize, expand, destroy }`,
   its CSS injected once with every colour and size a `--rd-*` custom property, so another page (a tray) can host it.
   It draws only what the events carry: no event, no symbol. Its reveals are visibility flips of ≤ 14 slices timed
   from JavaScript, not CSS animations of SVG elements: WebKit can't composite those, and each frame of one repainted
   the whole page (WebKitGTK at a phone's size: ~40 fps, 75–120 ms p95 frames while a page was read).
