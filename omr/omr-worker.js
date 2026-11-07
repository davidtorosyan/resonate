// Web Worker hosting the whole recognition engine, so the page stays responsive:
// CheerpJ (the Java runtime, which runs every Java thread on this one thread) with
// Audiveris, plus the WebAssembly Tesseract it calls back into for OCR.
//
// in:  { type: 'run', base, classpath, tiff: ArrayBuffer, sheetStepTimeOut }
// out: { type: 'log', line } … then { type: 'done', mxls: [ArrayBuffer] } | { type: 'error', message }

const CHEERPJ = 'https://cjrtnc.leaningtech.com/4.2/loader.js';
let started = false;

const post = (msg, transfer = []) => self.postMessage(msg, transfer);
const log = (line) => post({ type: 'log', line });

// CheerpJ keeps Java's writable files (/files: temp files, logs, the output) in one
// IndexedDB database per site. Two engines at once (two tabs) corrupt it, and nothing
// in it is needed later (the worker is killed, so Java never deletes its temp files).
// So: one conversion per browser at a time (a Web Lock, released when this worker is
// terminated), each starting from an empty database.
const FILES_DB = 'cjFS_/files/';
const BUSY = 'A PDF → Song conversion is already running in another tab. Let it finish (or close that tab), then try again.';

function withEngineLock(fn) {
  if (!self.navigator?.locks) return fn(); // older browsers: no lock, keep old files
  return navigator.locks.request('resonate-omr-engine', { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error(BUSY);
    await new Promise((resolve, reject) => {
      const rq = indexedDB.deleteDatabase(FILES_DB);
      rq.onsuccess = rq.onerror = () => resolve();
      rq.onblocked = () => reject(new Error(BUSY)); // an older version's engine still has it open
    });
    return fn();
  });
}

self.onmessage = async (e) => {
  const job = e.data;
  if (job.type !== 'run') return;
  if (started) return post({ type: 'error', message: 'This engine already ran; reload the page to convert another file.' });
  started = true;
  try {
    await withEngineLock(() => run(job));
  } catch (err) {
    post({ type: 'error', message: (err && err.message) || String(err) });
  }
};

async function run(job) {
  // OCR engine first: its download/initialization overlaps Java's startup.
  importScripts(`${job.base}ocr-engine.js?v=60`);
  self.OmrOcr.configure({ coreDir: `${job.base}tesseract`, tessdataPath: `${job.base}tessdata` });
  const ocrReady = self.OmrOcr.warmup('eng');

  // The music font, handed to Java in memory (/str) rather than letting Font.createFont
  // copy it out of the jar into a temp file in IndexedDB (/files). See patch 0005.
  const musicFont = fetch(`${job.base}fonts/Bravura.otf`)
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .catch(() => null);

  importScripts(CHEERPJ);

  // Java's System.out/err arrive through console.log/error. Audiveris logs
  // "Exporting sheet(s): [#1#2]" before writing a score and "Score X exported to
  // /path.mxl" once it's written: read the files then, rather than waiting for Java to
  // exit (parked CheerpJ threads don't wake on interrupt, so executor shutdown would sit
  // out its grace delay). A book can come out as several scores ("movements") — the
  // indentation switch below prevents the usual cause — so every one is collected: done
  // when no export is pending and either the book is closed or 2 s pass without another.
  const exportedPaths = [];
  let pending = 0, settle = null, onExported;
  const exported = new Promise((resolve) => { onExported = resolve; });
  const tap = (orig) => (...args) => {
    const line = args.join(' ').trimEnd();
    if (line) {
      log(line);
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
  console.log = tap(console.log);
  console.error = tap(console.error);

  // Java native org.audiveris.omr.text.web.WebOCR.recognizeGray (see WebOCR.java).
  async function Java_org_audiveris_omr_text_web_WebOCR_recognizeGray(lib, gray, width, height, lang, psm, dpi) {
    try {
      const t0 = performance.now();
      const pixels = new Uint8Array(gray.buffer, gray.byteOffset, gray.length);
      const records = await self.OmrOcr.recognize({ gray: pixels, width, height, lang, psm, dpi });
      const words = records ? records.split('\n').filter((l) => l[0] === 'W').length : 0;
      log(`[ocr] ${width}x${height} psm ${psm}: ${words} words in ${Math.round(performance.now() - t0)} ms`);
      return records;
    } catch (err) {
      log(`[ocr] error ${err && err.message || err}`);
      return null;
    }
  }

  await cheerpjInit({
    version: 17,
    status: 'none',
    natives: { Java_org_audiveris_omr_text_web_WebOCR_recognizeGray },
    javaProperties: [
      'user.home=/files',            // Audiveris config/log folders (no HOME env var here)
      'sun.java2d.uiScale=1',        // skip GTK HiDPI probing through JNA
      'java.awt.headless=true',
      'audiveris.ocr=web',           // OCR through the native bridge above
      'audiveris.ocr.languages=eng',
      'audiveris.web=true',          // thread pools that work on CheerpJ
      'audiveris.fonts.dir=/str',    // music font files (below); the jar copy is the fallback
    ],
  });
  await ocrReady;

  const font = await musicFont;
  if (font) cheerpOSAddStringFile('/str/Bravura.otf', new Uint8Array(font)); // flat path: /str has no folders
  else log('[font] Bravura.otf not downloaded; using the copy in the jar');
  cheerpOSAddStringFile('/str/score.tif', new Uint8Array(job.tiff));
  job.tiff = null;
  const out = `/files/omr-${Date.now()}`;
  const main = cheerpjRunMain('Audiveris', job.classpath,
    '-batch', '-export', '-output', out,
    '-constant', `org.audiveris.omr.Main.sheetStepTimeOut=${job.sheetStepTimeOut || 7200}`,
    '-constant', 'org.audiveris.omr.util.OmrExecutors.useParallelism=false', // one JS thread anyway
    '-constant', 'org.audiveris.omr.util.OmrExecutors.graceDelay=1',
    // One PDF is one song: don't start a new score ("movement") at an indented system —
    // a Coda's indented first line made Wichita Lineman come out as two scores.
    '-constant', 'org.audiveris.omr.sheet.ProcessingSwitches.indentations=false',
    '/str/score.tif');
  await Promise.race([main, exported]);
  await new Promise((r) => setTimeout(r, 300));

  const mxls = [];
  for (const path of exportedPaths.length ? exportedPaths : [`${out}/score.mxl`]) {
    try { mxls.push(await (await cjFileBlob(path)).arrayBuffer()); } catch {}
  }
  if (!mxls.length) throw new Error('Audiveris finished without producing MusicXML — see the log for details.');
  post({ type: 'done', mxls }, mxls);
}
