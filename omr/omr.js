// In-browser optical music recognition: Audiveris (Java) running in CheerpJ
// (a WebAssembly JVM) inside a Web Worker (omr-worker.js), with OCR by the
// WebAssembly build of Tesseract (ocr-engine.js) in the same worker.
//
//   const omr = await import('./omr/omr.js');
//   const { mxl, title, log } = await omr.convertPdf(file, { onProgress });
//
// The page must not run two conversions: Audiveris keeps global state, so the
// tool page reloads itself between conversions (everything is cached by then).
//
// See omr/README.md for how the pieces are built and licensed.

import { renderPdf, buildTiff } from './pdfprep.js';

const BASE = new URL('.', import.meta.url).href;          // .../omr/

// Audiveris + dependencies, Java 17 bytecode (see omr-build/). Order follows the
// Gradle-generated launcher script. GUI-only libraries are left out (PDF printing,
// charts, update checker + JSON, Swing look-and-feel, Markdown help, JNA): CheerpJ
// reads every classpath jar's index up front, ~0.4 MB each.
const JARS = [
  'audiveris.jar', 'args4j-2.33.jar', 'logback-classic-1.4.14.jar', 'jai-imageio-jpeg2000-1.4.0.jar',
  'jai-imageio-core-1.4.0.jar', 'jaxb-core-2.3.0.1.jar', 'jaxb-impl-2.3.1.jar', 'jama-1.0.3.jar', 'jai-core-1.1.3.jar', 'jaxb-api-2.3.1.jar',
  'ij-1.54p.jar', 'jcip-annotations-1.0.jar', 'org.apache.commons.io-2.4.jar',
  'jbig2-imageio-3.0.4.jar', 'pdfbox-3.0.6.jar', 'fontbox-3.0.6.jar', 'pdfbox-io-3.0.6.jar', 'proxymusic-4.0.3.jar',
  'eventbus-1.4.jar', 'tesseract-5.5.2-1.5.13.jar', 'leptonica-1.87.0-1.5.13.jar', 'javacpp-1.5.13.jar',
  'bsaf-1.9.2.jar', 'jgrapht-core-1.5.2.jar', 'reflections-0.10.2.jar', 'slf4j-api-2.0.17.jar', 'logback-core-1.4.14.jar', 'javax.activation-api-1.2.0.jar', 'commons-io-2.16.1.jar', 'commons-logging-1.3.5.jar', 'jaxb-runtime-4.0.5.jar',
  'jaxb-core-4.0.5.jar', 'jakarta.xml.bind-api-4.0.2.jar', 'jheaps-0.14.jar', 'apfloat-1.10.1.jar',
  'commons-lang3-3.18.0.jar', 'javassist-3.28.0-GA.jar',
  'jsr305-3.0.2.jar', 'angus-activation-2.0.2.jar', 'jakarta.activation-api-2.1.3.jar', 'txw2-4.0.5.jar', 'istack-commons-runtime-4.1.2.jar',
];

// Audiveris sheet steps, in order (for progress reporting).
export const STEPS = ['LOAD', 'BINARY', 'SCALE', 'GRID', 'HEADERS', 'STEM_SEEDS', 'BEAMS', 'LEDGERS', 'HEADS',
  'STEMS', 'REDUCTION', 'CUE_BEAMS', 'TEXTS', 'MEASURES', 'CHORDS', 'CURVES', 'SYMBOLS', 'LINKS', 'RHYTHMS', 'PAGE'];

let started = false;

// --- Progress from Audiveris's log lines ---------------------------------------------
// Lines look like:  INFO  [killing#3]   null 0    | HEADS
function progressTracker(sheetCount, onProgress) {
  let sheet = 0, step = -1;
  return (line) => {
    const m = /\[[^\]]*?#(\d+)\][^|]*\|\s*([A-Z_]+)\s*$/.exec(line);
    if (m && STEPS.includes(m[2])) {
      sheet = Number(m[1]);
      step = STEPS.indexOf(m[2]);
      const done = (sheet - 1) * STEPS.length + step;
      onProgress?.({ phase: 'recognize', sheet, sheets: sheetCount, step: m[2], fraction: done / (sheetCount * STEPS.length) });
    } else if (/exported to/.test(line)) {
      onProgress?.({ phase: 'export', sheet, sheets: sheetCount, fraction: 1 });
    }
  };
}

/**
 * Convert a PDF (File/Blob/ArrayBuffer) to MusicXML with Audiveris.
 * Returns { mxl: Uint8Array (zipped MusicXML), pages: [kept page numbers],
 *           failed: [{ sheet, page, step, reason }] (pages Audiveris gave up on; the rest is in mxl),
 *           log: string[] }.
 */
export async function convertPdf(input, { onProgress, onLog } = {}) {
  if (started) throw new Error('Audiveris already ran in this page — reload to convert another file.');
  started = true;
  const log = [];
  const addLog = (s) => { log.push(s); onLog?.(s); };

  // 1. Pages → staves → TIFF (pdf.js, in this page)
  onProgress?.({ phase: 'pages', fraction: 0 });
  const data = new Uint8Array(input instanceof ArrayBuffer ? input : await input.arrayBuffer());
  const pages = await renderPdf(data, {
    pdfjsBase: `${BASE}pdfjs`,
    onPage: (i, n, staves, blank) => {
      addLog(`page ${i}/${n}: ${staves} staves${blank ? ' (blank)' : ''}`);
      onProgress?.({ phase: 'pages', page: i, pages: n, fraction: i / n });
    },
  });
  const music = pages.filter((p) => p.staves >= 1);
  if (!music.length) {
    const blank = pages.every((p) => p.blank);
    throw new Error(blank
      ? "This PDF's pages came out blank here (an image format the page renderer couldn't decode?) — " +
        'send the log (Details → Copy log) so it can be fixed.'
      : 'No music staves found in this PDF — is it sheet music? Scanned pages need to be reasonably sharp.');
  }
  const tiff = buildTiff(music);
  pages.length = 0; // free the rendered pages

  // 2. Engine: CheerpJ + Audiveris + OCR, all in a Web Worker (keeps this page responsive)
  onProgress?.({ phase: 'engine', fraction: 0 });
  const track = progressTracker(music.length, onProgress);
  const classpath = JARS.map((j) => `/app${new URL(`lib/${j}`, BASE).pathname}`).join(':');
  const worker = new Worker(`${BASE}omr-worker.js`);
  try {
    const mxl = await new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'log') { addLog(m.line); track(m.line); }
        else if (m.type === 'done') resolve(new Uint8Array(m.mxl));
        else if (m.type === 'error') reject(new Error(m.message));
      };
      worker.onerror = (e) => reject(new Error(e.message || 'the recognition engine crashed'));
      worker.postMessage({ type: 'run', base: BASE, classpath, tiff: tiff.buffer }, [tiff.buffer]);
    });
    const pageOf = (sheet) => music[sheet - 1]?.index ?? sheet;
    // Belt and braces: Audiveris exports nothing once its music font proved unusable.
    if (log.some((l) => /Music font \S+ unusable/.test(l))) throw new Error('music font unusable');
    return { mxl, pages: music.map((p) => p.index), failed: failedSheets(log, pageOf), log };
  } catch (err) {
    throw explain(err, log, (sheet) => music[sheet - 1]?.index ?? sheet);
  } finally {
    worker.terminate();
  }
}

// --- Failures, from Audiveris's log (see omr-build/patches/0005) -----------------------
//   "Sheet#3 failed at HEADS: <reason>"  → that page is left out, the others are exported
//   "Music font Bravura unusable: ..."    → nothing can be recognized in this browser
function failedSheets(log, pageOf) {
  const out = [];
  for (const line of log) {
    const m = /\bSheet#(\d+) failed at ([A-Z_]+|\?): (.*)$/.exec(line);
    if (m && !out.some((f) => f.sheet === +m[1])) {
      out.push({ sheet: +m[1], page: pageOf(+m[1]), step: m[2], reason: m[3].trim() });
    }
  }
  return out;
}

function explain(err, log, pageOf) {
  if (log.some((l) => /Music font \S+ unusable/.test(l))) {
    return new Error("The recognition engine couldn't draw music symbols in this browser (its music " +
      "font failed to load), so it can't read the score. Reload and try again; if it keeps happening, " +
      "try another browser, and send the log (Details → Copy log) so this can be fixed.");
  }
  const failed = failedSheets(log, pageOf);
  if (failed.length && /without producing MusicXML/.test(err.message)) {
    const f = failed[0];
    return new Error(`Audiveris couldn't read any page (page ${f.page} stopped at ${f.step}: ${f.reason}). ` +
      "Details → Copy log has the full story.");
  }
  return err;
}
