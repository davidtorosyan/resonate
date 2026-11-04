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
| `omr.js`, `omr-worker.js`, `ocr-engine.js`, `pdfprep.js` | glue (this repo) | — |

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
