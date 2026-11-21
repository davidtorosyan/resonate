// In-browser optical music recognition: Audiveris (Java) running in CheerpJ
// (a WebAssembly JVM) inside a Web Worker (omr-worker.js), with OCR by the
// WebAssembly build of Tesseract (ocr-engine.js) in the same worker.
//
//   const omr = await import('./omr/omr.js?v=93');
//   const { mxls, title, log } = await omr.convertPdf(file, { onProgress, onEvent });
//
// Each conversion runs in a new worker (Audiveris keeps global state per Java runtime), so a page
// can convert one file after another. omr/importer.js wraps this in a resumable import job.
//
// See omr/README.md for how the pieces are built and licensed.

import { renderPdf, buildTiff, placeholder } from './pdfprep.js?v=93';
import { createTrace, EXPORT_LOST } from './trace.js?v=93';

const BASE = new URL('.', import.meta.url).href;          // .../omr/

// The engine's identity: the Audiveris build in lib/ (its commit, then the first 8 hex digits of
// audiveris.jar's SHA-256 — tools/jobstore.mjs checks them) and the CheerpJ version. A stored book is
// continued only by the same engine; another one starts the import over from the stored PDF.
// Change it with lib/ (not with the version badge).
export const ENGINE = '816cc6c-ffd097d7-cj4.2';

// The engine's Web Lock: one conversion per browser at a time (CheerpJ's files are one database per
// site). Held by the page for a whole import (importer.js), or by convertPdf itself.
export const LOCK = 'resonate-omr-engine';
export const BUSY = 'A PDF → Song conversion is already running in another tab. Let it finish (or close that tab), then try again.';

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

// --- Progress from Audiveris's log lines (when there's no trace) ----------------------
// Lines look like:  INFO  [killing#3]   null 0    | HEADS   — a one-page book has no "#N":
//                   INFO  [score]       null 0    | HEADS
export const STEP_LINE = /\[[^\]#]*(?:#(\d+))?\][^|]*\|\s*([A-Z_]+)\s*$/;
export function stepOfLine(line) {
  const m = STEP_LINE.exec(line);
  return m && STEPS.includes(m[2]) ? { sheet: m[1] ? Number(m[1]) : 1, step: m[2] } : null;
}

// The song's title from the PDF's own text (exact, unlike OCR): on the pages up to the
// first one with music (a title page, then the first page's heading), the largest line
// that is real words — the notation itself is often drawn with a font ("{} mf", "Ï Ï") —
// and not a publisher's line ("Authorized for use by", ©, "Words and Music by"). It must
// be about as large as the largest words on its page: when the real title is rejected,
// a smaller credit line isn't taken instead (null → the file name). An ALL-CAPS heading
// takes the same words' mixed-case spelling from elsewhere (a title page), else Title Case.
const NOT_TITLE = /authori[sz]ed for use|musicnotes|copyright|©|\(c\)\s*\d|all rights reserved|unauthori[sz]ed|published (by|under)|words and music|music by|lyrics by|arranged by/i;
const WORDS = /^[\p{L}\p{N}\s'’",.!?&:()\-–—]+$/u;
export function pdfTitle(pages, firstMusic) {
  let best = null;
  const seen = [];
  for (const p of pages) {
    if (p.index > firstMusic) break;
    const words = (p.lines || []).filter((l) => l.text.length <= 80 && /\p{L}{2}/u.test(l.text) && WORDS.test(l.text));
    seen.push(...words);
    const top = Math.max(0, ...words.map((l) => l.size));
    for (const l of words) {
      if (NOT_TITLE.test(l.text) || l.size < 0.85 * top) continue;
      if (!best || l.size > best.size) best = l;
    }
  }
  if (!best) return null;
  const t = best.text.replace(/^["“”']+|["“”']+$/g, "").trim();
  if (t !== t.toUpperCase()) return t;
  const key = (x) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const mixed = seen.find((l) => l.text !== l.text.toUpperCase() && key(l.text) === key(t));
  if (mixed) return mixed.text.trim();
  if (/^\p{L}{1,5}[!.]?$/u.test(t)) return t; // "SOS", "YMCA", "ABC": keep a short one as printed
  return t.toLowerCase().replace(/(^|[\s(-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}

/**
 * Convert a PDF (File/Blob/ArrayBuffer) to MusicXML with Audiveris.
 * Returns { mxls: [Uint8Array] (zipped MusicXML: one score, or several if Audiveris split the
 *           book into movements), pages: [kept page numbers], title: the PDF's own title text or null,
 *           tempo: a "= 104" metronome mark in the first music page's text ({ bpm, unit, dotted }) or null,
 *           failed: [{ sheet, page, step, reason }] (pages Audiveris gave up on; the rest is in mxls),
 *           lost: [{ sheet, page, measure, part }] (measures the export couldn't write — their notes aren't in mxls),
 *           music: [{ page, s, w, h }] (the kept pages, s = sheet number), log: string[] }.
 * Errors carry `kind`: 'pdf' (not a PDF pdf.js can open, or locked), 'nomusic', 'blank', 'unread' (no
 * page could be read), 'missing' (a page of a stored PDF) — the same file fails the same way again;
 * 'download', 'crash', 'font', 'nomxl', 'engine' — another try may do better.
 * Options:
 *   onProgress(p)     coarse progress { phase: pages|engine|recognize|export, fraction, … }
 *   onLog(line)       every log line
 *   onEvent(ev)       the Reader's events (readerstate.js): page, meta, phase, engine, sheet, step,
 *                     grid, sym, measures, words, notes — from pdfprep, the worker and the live trace
 *   onBook(s, bytes)  the engine's book (.omr) right after sheet s was stored in it: a resume point
 *   previews          make each page's small preview (the 'page' events carry it)
 *   dir               the book's folder in CheerpJ's /files (stable per job: '/files/omr-<id>')
 *   locked            the caller holds the engine lock (LOCK); else this takes it (busy → BUSY)
 *   signal            an AbortSignal: stops the engine (the worker is terminated)
 *   resume            continue a stored book: { book: ArrayBuffer (.omr), music: [{ page, s, w, h }],
 *                     done: [s], blank: [s], failed: [{ sheet, page, step, reason }], title, tempo } — only
 *                     the pages still to read are rendered (the finished ones are 1×1 placeholders;
 *                     `blank` ones too, which the engine then fails and leaves out); book null = from the
 *                     first sheet, with the pages page prep found before
 */
export async function convertPdf(input, opts = {}) {
  if (!opts.locked && self.navigator?.locks) {
    return navigator.locks.request(LOCK, { ifAvailable: true }, (lock) => {
      if (!lock) throw new Error(BUSY);
      return convertPdf(input, { ...opts, locked: true });
    });
  }
  const { onProgress, onLog, onBook, signal } = opts;
  const resume = opts.resume || null;
  const log = [];
  const addLog = (s) => { log.push(s); onLog?.(s); };
  const emit = (ev) => { try { opts.onEvent?.(ev); } catch (err) { console.warn('onEvent', err); } };
  const aborted = () => signal?.aborted;
  const abortError = () => Object.assign(new Error('stopped'), { name: 'AbortError' });

  // 1. Pages → staves → TIFF (pdf.js, in this page)
  const data = new Uint8Array(input instanceof ArrayBuffer ? input.slice(0) : await input.arrayBuffer());
  let music, title, tempo, tiff;
  if (!resume) {
    onProgress?.({ phase: 'pages', fraction: 0 });
    emit({ t: 'phase', phase: 'pages' });
    let s = 0;
    const pages = await pdfOnly(renderPdf(data, {
      pdfjsBase: `${BASE}pdfjs`,
      preview: !!opts.previews,
      onPage: (i, n, count, blank, p) => {
        addLog(`page ${i}/${n}: ${count} staves${blank ? ' (blank)' : ''}`);
        onProgress?.({ phase: 'pages', page: i, pages: n, fraction: i / n });
        const isMusic = count >= 1;
        emit({
          t: 'page', page: i, of: n, w: p.width, h: p.height, music: isMusic, blank,
          ...(isMusic ? { s: ++s } : {}), preview: p.preview || null,
          staves: p.staffLines.map((f) => ({ x0: f.x0, x1: f.x1, y: f.y.map((y) => Math.round(y * 10) / 10) })),
        });
        p.preview = null;
      },
    }), addLog);
    if (aborted()) throw abortError();
    const kept = pages.filter((p) => p.staves >= 1);
    if (!kept.length) {
      const blank = pages.every((p) => p.blank);
      throw Object.assign(new Error(blank
        ? 'The pages came out blank. Send the log (Details → Copy log).'
        : 'No music staves found. Scans need to be sharp.'), { kind: blank ? 'blank' : 'nomusic' });
    }
    title = pdfTitle(pages, kept[0].index);
    if (title) addLog(`title from the PDF's text: ${title}`);
    tempo = kept[0].tempo ?? pages.find((p) => p.tempo && p.index <= kept[0].index)?.tempo ?? null;
    if (tempo) addLog(`tempo mark in the PDF's text: ${tempo.unit ? `${tempo.dotted ? "dotted " : ""}${tempo.unit} ` : ""}= ${tempo.bpm}`);
    if (title || tempo) emit({ t: 'meta', ...(title ? { title } : {}), ...(tempo ? { tempo } : {}) });
    music = kept.map((p, k) => ({ page: p.index, s: k + 1, w: p.width, h: p.height }));
    tiff = buildTiff(kept);
    pages.length = 0; // free the rendered pages
  } else {
    // A stored book: only the pages it hasn't finished are drawn again, in sheet order; the
    // finished ones are placeholders (Audiveris never loads them again).
    music = resume.music;
    title = resume.title ?? null;
    tempo = resume.tempo ?? null;
    const done = new Set(resume.done || []);
    const blank = new Set(resume.blank || []); // pages to leave out (they stopped the engine before): drawn 1×1, the engine fails them
    const need = new Set(music.filter((m) => !done.has(m.s) && !blank.has(m.s)).map((m) => m.page));
    onProgress?.({ phase: 'pages', fraction: 0 });
    const pages = need.size ? await pdfOnly(renderPdf(data, { pdfjsBase: `${BASE}pdfjs`, only: need, text: false }), addLog) : [];
    if (aborted()) throw abortError();
    const byPage = new Map(pages.map((p) => [p.index, p]));
    const list = music.map((m) => (done.has(m.s) || blank.has(m.s) ? placeholder() : byPage.get(m.page)));
    if (list.some((p) => !p)) throw Object.assign(new Error('A page of the stored PDF is missing.'), { kind: 'missing' });
    addLog(`[resume] ${done.size} of ${music.length} pages already read; drawing ${need.size} again`);
    tiff = buildTiff(list);
    pages.length = 0;
  }
  const pageOf = (sheet) => music.find((m) => m.s === sheet)?.page ?? sheet;

  // 2. Engine: CheerpJ + Audiveris + OCR, all in a Web Worker (keeps this page responsive)
  if (aborted()) throw abortError();
  onProgress?.({ phase: 'engine', fraction: 0 });
  emit({ t: 'phase', phase: 'engine' });
  const trace = createTrace();
  let traced = false, lastSheet = 0, exportLoaded = 0, exporting = false;
  // Every sheet read (stored in the book in an earlier run, or in this one) or given up on: what
  // the engine does next is the export. (A resumed book whose sheets are all read says nothing
  // else — no "Book reaching", no trace K, no "End of Book" — before it reads them back.)
  const allRead = () => {
    const seen = new Set([...(resume?.done || []), ...trace.state.stored, ...trace.state.failed.map((f) => f.s)]);
    return music.every((m) => seen.has(m.s));
  };
  const toExport = () => { if (!exporting) { exporting = true; emit({ t: 'phase', phase: 'export' }); } };
  const sheetCount = music.length;
  const step = (sheet, name) => {
    lastSheet = sheet;
    const done = (sheet - 1) * STEPS.length + STEPS.indexOf(name);
    onProgress?.({ phase: 'recognize', sheet, sheets: sheetCount, page: pageOf(sheet), step: name, fraction: done / (sheetCount * STEPS.length) });
  };
  const classpath = JARS.map((j) => `/app${new URL(`lib/${j}`, BASE).pathname}`).join(':');
  const worker = new Worker(`${BASE}omr-worker.js?v=93`);
  const stop = () => worker.terminate();
  signal?.addEventListener('abort', stop);
  try {
    const mxls = await new Promise((resolve, reject) => {
      signal?.addEventListener('abort', () => reject(abortError()));
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'log') {
          addLog(m.line);
          if (!traced) { const st = stepOfLine(m.line); if (st) step(st.sheet, st.step); }
          // A measure the export couldn't write: its notes leave the Reader too.
          if (exporting && EXPORT_LOST.test(m.line)) for (const ev of trace.exportLost(m.line)) emit(ev);
        } else if (m.type === 'trace') {
          traced = true;
          for (const ev of trace.block(m.block)) {
            if (ev.t === 'step') step(ev.s, ev.step);
            if (ev.t === 'engine' && ev.milestone === 'book') { emit(ev); emit({ t: 'phase', phase: 'read' }); continue; }
            emit(ev);
          }
        } else if (m.type === 'ocr') {
          for (const ev of trace.ocr(m)) emit(ev);
        } else if (m.type === 'engine') {
          emit({ t: 'engine', milestone: m.milestone, ...(m.detail != null ? { detail: m.detail } : {}) });
        } else if (m.type === 'book') {
          addLog(`[resume] book after sheet ${m.s}: ${(m.bytes.byteLength / 1e6).toFixed(2)} MB (read in ${m.ms} ms)`);
          try { onBook?.(m.s, m.bytes); } catch (err) { console.warn('onBook', err); }
        } else if (m.type === 'export') {
          if (m.at === 'book' || allRead()) toExport();
          if (m.at === 'sheet') {
            exportLoaded = Math.max(exportLoaded, m.s);
            if (exporting && Number.isFinite(m.s)) emit({ t: 'export', s: m.s });
          }
          onProgress?.({ phase: 'export', sheet: lastSheet, sheets: sheetCount, loaded: exportLoaded, at: m.at,
            fraction: m.at === 'write' ? 0.9 : 0.8 * (exportLoaded / Math.max(1, sheetCount)) });
        } else if (m.type === 'done') {
          onProgress?.({ phase: 'export', sheet: lastSheet, sheets: sheetCount, fraction: 1 });
          resolve(m.mxls.map((b) => new Uint8Array(b)));
        } else if (m.type === 'error') reject(new Error(m.message));
      };
      worker.onerror = (e) => reject(Object.assign(new Error(e.message || 'the recognition engine crashed'), { kind: 'crash' }));
      worker.postMessage({
        type: 'run', base: BASE, classpath, tiff: tiff.buffer, trace: true,
        dir: opts.dir || `/files/omr-${Date.now()}`, book: resume?.book || null,
      }, [tiff.buffer, ...(resume?.book ? [resume.book] : [])]);
    });
    // Belt and braces: Audiveris exports nothing once its music font proved unusable.
    if (log.some((l) => /Music font \S+ unusable/.test(l))) throw new Error('music font unusable');
    if (mxls.length > 1) addLog(`[engine] ${mxls.length} scores exported (movements); they're joined in order`);
    const failed = mergeFailed(resume?.failed || [], failedSheets(log, pageOf),
      trace.state.failed.map((f) => ({ sheet: f.s, page: pageOf(f.s), step: f.step, reason: f.reason })));
    return { mxls, pages: music.map((m) => m.page), music, title, tempo, failed, lost: lostMeasures(log, pageOf), log };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    addLog(`[error] ${err?.message || err}`); // (as it came: Details → Copy log keeps it)
    // (A resumed run's earlier failures aren't logged again: the stored ones say why.)
    throw explain(err, log, pageOf, resume?.failed || []);
  } finally {
    signal?.removeEventListener('abort', stop);
    worker.terminate();
  }
}

function mergeFailed(...lists) {
  const out = [];
  for (const f of lists.flat()) if (f && !out.some((g) => g.sheet === f.sheet)) out.push(f);
  return out.sort((a, b) => a.sheet - b.sheet);
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

// Measures the export couldn't write ("Error visiting Measure{#3P1} in {Page#2.1}": a measure that
// fails when its sheet is reloaded for export — a skewed scan's barlines): their notes are missing.
function lostMeasures(log, pageOf) {
  const out = [];
  for (const line of log) {
    const m = EXPORT_LOST.exec(line);
    if (m && !out.some((x) => x.sheet === +m[3] && x.measure === m[1] && x.part === (m[2] ?? null))) {
      out.push({ sheet: +m[3], page: pageOf(+m[3]), measure: m[1], part: m[2] ?? null });
    }
  }
  return out;
}

const kinded = (msg, kind) => Object.assign(new Error(msg), { kind });
function explain(err, log, pageOf, before = []) {
  if (log.some((l) => /Music font \S+ unusable/.test(l))) {
    return kinded("The music font didn't load in this browser. Try again; if it recurs, " +
      "try another browser and send the log (Details → Copy log).", 'font');
  }
  const failed = mergeFailed(before, failedSheets(log, pageOf));
  if (/without producing MusicXML/.test(err.message)) {
    if (failed.length) {
      const f = failed[0];
      return kinded(`No page could be read (page ${f.page}, ${f.step}: ${f.reason}). Log: Details → Copy log.`, 'unread');
    }
    return Object.assign(err, { kind: 'nomxl' });
  }
  // A download cut short (the engine's runtime comes from CheerpJ's CDN): a script that ends mid-way
  // fails to parse — "Unexpected end of input" said nothing to the singer. The job is kept: Try again
  // continues it.
  if (/Unexpected end of (input|script|JSON)|Failed to fetch|NetworkError|Load failed|importScripts/i.test(err?.message || '')) {
    return kinded("The engine didn't download completely. Check the connection, then try again.", 'download');
  }
  if (!err.kind) err.kind = 'engine';
  return err;
}

// pdf.js couldn't open the file (locked, not a PDF, damaged): the same file always will — said plainly.
async function pdfOnly(p, addLog) {
  try {
    return await p;
  } catch (err) {
    const name = err?.name || '';
    if (!/PasswordException|InvalidPDFException|MissingPDFException|FormatError|UnknownErrorException|UnexpectedResponseException/.test(name)) throw err;
    addLog(`[error] ${name}: ${err.message}`);
    throw kinded(name === 'PasswordException' ? 'This PDF is locked with a password.' : "This file can't be read as a PDF.", 'pdf');
  }
}
