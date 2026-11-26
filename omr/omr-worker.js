// Web Worker hosting the whole recognition engine, so the page stays responsive:
// CheerpJ (the Java runtime, which runs every Java thread on this one thread) with
// Audiveris, plus the WebAssembly Tesseract it calls back into for OCR.
//
// in:  { type: 'run', base, classpath, tiff: ArrayBuffer, sheetStepTimeOut, dir, trace, book: ArrayBuffer | null }
//        dir: the book's folder in /files (stable per import job: '/files/omr-<job>')
//        trace: true → Audiveris's live trace (patch 0009, -Daudiveris.web.trace=web)
//        book: a stored .omr to continue (a resumed import): put back at <dir>/score.omr and run on it
// out: { type: 'log', line }                       every line Java prints (and the worker's own)
//      { type: 'engine', milestone, detail? }       real start-up milestones: fetch, jvm, start, font; the
//                                                   latest one again with detail '↓ N MB' while files download
//      { type: 'trace', block }                     one WebTrace block, as Java emitted it (omr/trace.js)
//      { type: 'ocr', width, height, psm, words }   the OCR engine's words (boxes in the OCR image)
//      { type: 'book', s, bytes: ArrayBuffer }      the .omr right after sheet s was stored in it
//      { type: 'export', at: 'book'|'sheet'|'write', s? }   export progress (End of Book, Loaded /sheet#N, Exporting)
//      … then { type: 'done', mxls: [ArrayBuffer] } | { type: 'error', message }
//
// One run per worker (Audiveris keeps global state): a second conversion uses a new worker. The
// page (omr.js / importer.js) holds the engine's Web Lock; this worker only clears CheerpJ's files.

const CHEERPJ = 'https://cjrtnc.leaningtech.com/4.2/loader.js';
let started = false;

const post = (msg, transfer = []) => self.postMessage(msg, transfer);
const log = (line) => post({ type: 'log', line });
let lastMilestone = null;
const milestone = (m, detail) => { lastMilestone = m; post({ type: 'engine', milestone: m, ...(detail != null ? { detail } : {}) }); };

// What the engine's files took over the network so far, while it starts (resource timing: the first
// time ~60 MB — the OCR engine, CheerpJ's runtime, the jars —, later the browser's cache and ~0). Only
// this site's files count: CheerpJ's CDN sends no Timing-Allow-Origin, so its sizes read 0. Posted as
// the latest milestone's detail ('↓ 23 MB') each time it passes another MB; stops once Java runs.
let netTimer = null, netMb = 0;
function sampleNet() {
  let b = 0;
  try { for (const e of performance.getEntriesByType('resource')) b += e.transferSize || 0; } catch {}
  const mb = Math.floor(b / 1e6);
  if (mb >= 1 && mb !== netMb && lastMilestone) { netMb = mb; milestone(lastMilestone, `↓ ${mb} MB`); }
}
function watchNet(on) {
  clearInterval(netTimer); netTimer = null;
  if (on) { try { performance.setResourceTimingBufferSize?.(5000); } catch {} netTimer = setInterval(sampleNet, 1000); }
  else sampleNet();
}

// CheerpJ keeps Java's writable files (/files: temp files, logs, the book) in one IndexedDB
// database per site. Two engines at once (two tabs) corrupt it, so the page holds the Web Lock
// 'resonate-omr-engine' for the whole import, and each run starts from an empty database
// (a killed worker never deletes Java's temp files; a resumed book is put back from the page's
// own copy — see run()).
const FILES_DB = 'cjFS_/files/';
const BUSY = 'A PDF → Song conversion is already running in another tab. Let it finish (or close that tab), then try again.';

function clearFiles() {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.deleteDatabase(FILES_DB);
    rq.onsuccess = rq.onerror = () => resolve();
    rq.onblocked = () => reject(new Error(BUSY)); // an older version's engine still has it open
  });
}

self.onmessage = async (e) => {
  const job = e.data;
  if (job.type !== 'run') return;
  if (started) return post({ type: 'error', message: 'This engine already ran; start a new worker for another file.' });
  started = true;
  try {
    await clearFiles();
    await run(job);
  } catch (err) {
    post({ type: 'error', message: (err && err.message) || String(err) });
  }
};

async function run(job) {
  milestone('fetch');
  watchNet(true);
  // OCR engine first: its download/initialization overlaps Java's startup.
  importScripts(`${job.base}ocr-engine.js?v=120`);
  self.OmrOcr.configure({ coreDir: `${job.base}tesseract`, tessdataPath: `${job.base}tessdata` });
  const ocrReady = self.OmrOcr.warmup('eng');

  // The music font, handed to Java in memory (/str) rather than letting Font.createFont
  // copy it out of the jar into a temp file in IndexedDB (/files). See patch 0005.
  const musicFont = fetch(`${job.base}fonts/Bravura.otf`)
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .catch(() => null);

  importScripts(CHEERPJ);

  const dir = job.dir || `/files/omr-${Date.now()}`;
  let bookPath = `${dir}/score.omr`;

  // Java's System.out/err arrive through console.log/error. Audiveris logs
  // "Exporting sheet(s): [#1#2]" before writing a score and "Score X exported to
  // /path.mxl" once it's written: read the files then, rather than waiting for Java to
  // exit (parked CheerpJ threads don't wake on interrupt, so executor shutdown would sit
  // out its grace delay). A book can come out as several scores ("movements") — the
  // indentation switch below prevents the usual cause; a resumed book whose earlier run lost a
  // sheet starts one there — so every one is collected: done when no export is pending and
  // either the book is closed or 2 s pass without another.
  const exportedPaths = [];
  let pending = 0, settle = null, onExported, javaUp = false;
  const exported = new Promise((resolve) => { onExported = resolve; });
  const tap = (orig) => (...args) => {
    const line = args.join(' ').trimEnd();
    if (line) {
      log(line);
      watch(line);
      if (/Exporting sheet\(s\)/.test(line)) { pending++; clearTimeout(settle); }
      const m = /exported to (\S+\.mxl)\s*$/.exec(line);
      if (m) {
        exportedPaths.push(m[1]);
        pending = Math.max(0, pending - 1);
        clearTimeout(settle);
        if (!pending) settle = setTimeout(onExported, 2000);
      }
      if (exportedPaths.length && !pending && /Book stored|Closing \{Score/.test(line)) onExported();
    }
    orig.apply(console, args);
  };
  // Milestones and export progress from Audiveris's own lines (logback: "INFO  [score#1] … | msg").
  function watch(line) {
    if (!javaUp && /^\s*(INFO|WARN|ERROR|DEBUG)\s+\[/.test(line)) { javaUp = true; watchNet(false); milestone('start'); }
    let m;
    if ((m = /Music font (\S+): (\d+) glyphs checked in (\d+) ms/.exec(line))) milestone('font', `${m[2]} glyphs`);
    else if ((m = /Book stored as (\S+\.omr)\s*$/.exec(line))) bookPath = m[1];
    else if (/End of Book\{/.test(line)) post({ type: 'export', at: 'book' });
    else if ((m = /Loaded \/sheet#(\d+)\/sheet#\d+\.xml/.exec(line))) post({ type: 'export', at: 'sheet', s: +m[1] });
    else if (/Exporting sheet\(s\)/.test(line)) post({ type: 'export', at: 'write' });
    else if (!job.trace && (m = /End of Stub#(\d+)\s*$/.exec(line))) snapshot(+m[1]);
  }
  console.log = tap(console.log);
  console.error = tap(console.error);
  console.warn = tap(console.warn);

  // The book after sheet s was stored in it (trace "S s ms", else the log's "End of Stub#s"): the
  // page keeps a copy, so a reload continues from there. Java has closed the file by then (the
  // store is a whole-file write, committed before Java goes on), and the next write to it is a
  // whole sheet later; the page checks the copy before keeping it.
  let lastCopy = Promise.resolve();
  function snapshot(s) {
    lastCopy = lastCopy.then(async () => {
      try {
        const t0 = performance.now();
        const bytes = await (await cjFileBlob(bookPath)).arrayBuffer();
        post({ type: 'book', s, bytes, ms: Math.round(performance.now() - t0) }, [bytes]);
      } catch (err) {
        log(`[resume] couldn't read ${bookPath} after sheet ${s}: ${err && err.message || err}`);
      }
    });
  }

  // Java native org.audiveris.omr.text.web.WebOCR.recognizeGray (see WebOCR.java).
  async function Java_org_audiveris_omr_text_web_WebOCR_recognizeGray(lib, gray, width, height, lang, psm, dpi) {
    try {
      const t0 = performance.now();
      const pixels = new Uint8Array(gray.buffer, gray.byteOffset, gray.length);
      const records = await self.OmrOcr.recognize({ gray: pixels, width, height, lang, psm, dpi });
      const words = [];
      if (records) {
        for (const l of records.split('\n')) {
          if (l[0] !== 'W') continue;
          const f = l.split('\t');
          let text = f[f.length - 1] || '';
          try { text = decodeURIComponent(text); } catch {}
          if (text.trim()) words.push({ x: +f[1], y: +f[2], w: +f[3], h: +f[4], text: text.trim() });
        }
      }
      log(`[ocr] ${width}x${height} psm ${psm}: ${words.length} words in ${Math.round(performance.now() - t0)} ms`);
      if (words.length) post({ type: 'ocr', width, height, psm, words });
      return records;
    } catch (err) {
      log(`[ocr] error ${err && err.message || err}`);
      return null;
    }
  }

  // Java native org.audiveris.omr.text.web.WebTrace.emit (patch 0009): one block of the live
  // trace. Synchronous on purpose — an async native would suspend the Java thread.
  function Java_org_audiveris_omr_text_web_WebTrace_emit(lib, block) {
    post({ type: 'trace', block });
    if (block.charCodeAt(0) === 83 /* S */ && block[1] === ' ') snapshot(parseInt(block.slice(2), 10));
  }

  await cheerpjInit({
    version: 17,
    status: 'none',
    natives: { Java_org_audiveris_omr_text_web_WebOCR_recognizeGray, Java_org_audiveris_omr_text_web_WebTrace_emit },
    javaProperties: [
      'user.home=/files',            // Audiveris config/log folders (no HOME env var here)
      'sun.java2d.uiScale=1',        // skip GTK HiDPI probing through JNA
      'java.awt.headless=true',
      'audiveris.ocr=web',           // OCR through the native bridge above
      'audiveris.ocr.languages=eng',
      'audiveris.web=true',          // thread pools that work on CheerpJ
      'audiveris.fonts.dir=/str',    // music font files (below); the jar copy is the fallback
      ...(job.trace ? ['audiveris.web.trace=web'] : []), // the live trace (patch 0009)
    ],
  });
  milestone('jvm');
  await ocrReady;

  const font = await musicFont;
  if (font) cheerpOSAddStringFile('/str/Bravura.otf', new Uint8Array(font)); // flat path: /str has no folders
  else log('[font] Bravura.otf not downloaded; using the copy in the jar');
  // The input pages, at the path the book records (a resumed book reads its unfinished sheets from
  // it; pages it finished may be 1×1 placeholders: only LOAD reads a page).
  cheerpOSAddStringFile('/str/score.tif', new Uint8Array(job.tiff));
  job.tiff = null;

  let input = '/str/score.tif';
  if (job.book) {
    // /str is read-only to Java and Audiveris saves a book next to itself, so the stored book is
    // copied into /files by Java (library mode: no JavaScript API writes /files).
    const t0 = performance.now();
    await putBack(job.book, dir, 'score.omr');
    log(`[resume] book put back: ${(job.book.byteLength / 1e6).toFixed(2)} MB in ${Math.round(performance.now() - t0)} ms`);
    job.book = null;
    input = `${dir}/score.omr`;
    bookPath = input;
  }

  const main = cheerpjRunMain('Audiveris', job.classpath,
    '-batch', '-export', '-output', dir,
    '-constant', `org.audiveris.omr.Main.sheetStepTimeOut=${job.sheetStepTimeOut || 7200}`,
    '-constant', 'org.audiveris.omr.util.OmrExecutors.useParallelism=false', // one JS thread anyway
    '-constant', 'org.audiveris.omr.util.OmrExecutors.graceDelay=1',
    // One PDF is one song: don't start a new score ("movement") at an indented system —
    // a Coda's indented first line made Wichita Lineman come out as two scores. Not stored in
    // the book: a resumed run must say it again (every -constant here is repeated).
    '-constant', 'org.audiveris.omr.sheet.ProcessingSwitches.indentations=false',
    input);
  await Promise.race([main, exported]);
  await new Promise((r) => setTimeout(r, 300));
  await lastCopy;

  const mxls = [];
  for (const path of exportedPaths.length ? exportedPaths : [`${dir}/score.mxl`]) {
    try { mxls.push(await (await cjFileBlob(path)).arrayBuffer()); } catch {}
  }
  if (!mxls.length) throw new Error('Audiveris finished without producing MusicXML — see the log for details.');
  post({ type: 'done', mxls }, mxls);
}

// Copy a stored book into CheerpJ's /files, through Java (cheerpjRunLibrary: the JDK's own classes).
async function putBack(bytes, dir, name) {
  cheerpOSAddStringFile('/str/resume.omr', new Uint8Array(bytes));
  const lib = await cheerpjRunLibrary('');
  const JFile = await lib.java.io.File;
  const FIS = await lib.java.io.FileInputStream;
  const FOS = await lib.java.io.FileOutputStream;
  await (await new JFile(dir)).mkdirs();
  const fin = await new FIS('/str/resume.omr');
  const fout = await new FOS(`${dir}/${name}`);
  try {
    await fin.transferTo(fout);
  } finally {
    await fin.close();
    await fout.close();
  }
  const back = await cjFileBlob(`${dir}/${name}`);
  if (back.size !== bytes.byteLength) throw new Error(`the stored book didn't copy back (${back.size} of ${bytes.byteLength} bytes)`);
}
