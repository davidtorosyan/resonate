// Web Worker hosting the whole recognition engine, so the page stays responsive:
// CheerpJ (the Java runtime, which runs every Java thread on this one thread) with
// Audiveris, plus the WebAssembly Tesseract it calls back into for OCR.
//
// in:  { type: 'run', base, classpath, tiff: ArrayBuffer, sheetStepTimeOut }
// out: { type: 'log', line } … then { type: 'done', mxl: ArrayBuffer } | { type: 'error', message }

const CHEERPJ = 'https://cjrtnc.leaningtech.com/4.2/loader.js';
let started = false;

const post = (msg, transfer = []) => self.postMessage(msg, transfer);
const log = (line) => post({ type: 'log', line });

self.onmessage = async (e) => {
  const job = e.data;
  if (job.type !== 'run') return;
  if (started) return post({ type: 'error', message: 'This engine already ran; reload the page to convert another file.' });
  started = true;

  try {
    // OCR engine first: its download/initialization overlaps Java's startup.
    importScripts(`${job.base}ocr-engine.js`);
    self.OmrOcr.configure({ coreDir: `${job.base}tesseract`, tessdataPath: `${job.base}tessdata` });
    const ocrReady = self.OmrOcr.warmup('eng');

    importScripts(CHEERPJ);

    // Java's System.out/err arrive through console.log/error. Audiveris logs
    // "Score X exported to /path.mxl" once the file is written: read it then,
    // rather than waiting for Java to exit (parked CheerpJ threads don't wake on
    // interrupt, so executor shutdown would sit out its grace delay).
    let exportedPath = null, onExported;
    const exported = new Promise((resolve) => { onExported = resolve; });
    const tap = (orig) => (...args) => {
      const line = args.join(' ').trimEnd();
      if (line) {
        log(line);
        const m = /exported to (\S+\.mxl)\s*$/.exec(line);
        if (m) { exportedPath = m[1]; onExported(); }
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
      ],
    });
    await ocrReady;

    cheerpOSAddStringFile('/str/score.tif', new Uint8Array(job.tiff));
    job.tiff = null;
    const out = `/files/omr-${Date.now()}`;
    const run = cheerpjRunMain('Audiveris', job.classpath,
      '-batch', '-export', '-output', out,
      '-constant', `org.audiveris.omr.Main.sheetStepTimeOut=${job.sheetStepTimeOut || 7200}`,
      '-constant', 'org.audiveris.omr.util.OmrExecutors.useParallelism=false', // one JS thread anyway
      '-constant', 'org.audiveris.omr.util.OmrExecutors.graceDelay=1',
      '/str/score.tif');
    await Promise.race([run, exported]);
    await new Promise((r) => setTimeout(r, 300));

    let blob = null;
    try { blob = await cjFileBlob(exportedPath || `${out}/score.mxl`); } catch {}
    if (!blob) throw new Error('Audiveris finished without producing MusicXML — see the log for details.');
    const mxl = await blob.arrayBuffer();
    post({ type: 'done', mxl }, [mxl]);
  } catch (err) {
    post({ type: 'error', message: (err && err.message) || String(err) });
  }
};
