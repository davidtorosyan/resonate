// OCR engine for in-browser Audiveris (loaded with importScripts by omr-worker.js):
// the WebAssembly build of Tesseract (tesseract.js-core, which includes the legacy
// engine), driven exactly like Audiveris's TesseractOrder drives native Tesseract:
//   Init(OEM_TESSERACT_ONLY) → SetImage → SetSourceResolution → SetPageSegMode
//   → AnalyseLayout → Recognize → ResultIterator over lines / words / symbols.
// recognize() returns the tab-separated records WebOCR.java parses.
//
//   OmrOcr.configure({ coreDir, tessdataPath });
//   await OmrOcr.warmup('eng');
//   const records = await OmrOcr.recognize({ gray, width, height, lang, psm, dpi });

const OEM_TESSERACT_ONLY = 0;
const RIL_TEXTLINE = 2, RIL_WORD = 3, RIL_SYMBOL = 4;

let config = { coreDir: 'tesseract', tessdataPath: 'tessdata' };
let modulePromise = null;
const apis = new Map(); // lang spec -> initialized TessBaseAPI

function loadModule() {
  if (!modulePromise) {
    modulePromise = (async () => {
      importScripts(`${config.coreDir}/${simdSupported() ? 'tesseract-core-simd.wasm.js' : 'tesseract-core.wasm.js'}`);
      return self.TesseractCore({});
    })();
  }
  return modulePromise;
}

async function fetchTraineddata(lang) {
  // A gzipped copy halves the download. Check the gzip magic bytes rather than the
  // name: a host may already have decoded it (Content-Encoding: gzip).
  for (const name of [`${lang}.traineddata.gz`, `${lang}.traineddata`]) {
    const res = await fetch(`${config.tessdataPath}/${name}`);
    if (!res.ok) continue;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  throw new Error(`no traineddata for ${lang}`);
}

// WebAssembly SIMD support (smallest module using a v128 op).
function simdSupported() {
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3,
      2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch { return false; }
}

async function getApi(langSpec) {
  if (apis.has(langSpec)) return apis.get(langSpec);
  const TessModule = await loadModule();
  try { TessModule.FS.mkdir('/tessdata'); } catch {}
  for (const lang of langSpec.split('+')) {
    const path = `/tessdata/${lang}.traineddata`;
    let exists = true;
    try { TessModule.FS.stat(path); } catch { exists = false; }
    if (!exists) TessModule.FS.writeFile(path, await fetchTraineddata(lang));
  }
  const api = new TessModule.TessBaseAPI();
  if (api.Init('/tessdata', langSpec, OEM_TESSERACT_ONLY) !== 0) throw new Error(`Tesseract Init failed for ${langSpec}`);
  apis.set(langSpec, api);
  return api;
}

const enc = (s) => encodeURIComponent(s ?? '');

async function recognize({ gray, width, height, lang, psm, dpi }) {
  // gray: Uint8Array or ArrayBuffer, width*height bytes
  const TessModule = await loadModule();
  const api = await getApi(lang);
  const ptr = TessModule._malloc(width * height);
  try {
    TessModule.HEAPU8.set(gray instanceof Uint8Array ? gray : new Uint8Array(gray), ptr);
    api.SetImage(ptr, width, height, 1, width);
    if (dpi !== -1) api.SetSourceResolution(dpi);
    api.SetPageSegMode(psm);
    const layout = api.AnalyseLayout();
    if (layout) TessModule.destroy(layout);
    if (api.Recognize(null) !== 0) throw new Error('Tesseract Recognize failed');

    // Same walk as TesseractOrder.getLines()
    const out = [];
    const it = api.GetIterator();
    if (!it) return '';
    let nextLevel;
    do {
      nextLevel = RIL_SYMBOL;
      if (it.Empty(RIL_SYMBOL)) continue;
      if (it.IsAtBeginningOf(RIL_TEXTLINE)) out.push('L');
      if (it.IsAtBeginningOf(RIL_WORD)) {
        const font = it.getWordFontAttributes();
        if (!font.font_name) { // no font info: TesseractOrder skips the whole word
          nextLevel = RIL_WORD;
          continue;
        }
        const b = it.getBoundingBox(RIL_WORD);
        const bl = it.getBaseline(RIL_WORD);
        out.push(['W', b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, it.Confidence(RIL_WORD),
          +!!font.is_bold, +!!font.is_italic, +!!font.is_underlined, +!!font.is_monospace, +!!font.is_serif, +!!font.is_smallcaps,
          font.pointsize,
          ...(bl.has_baseline ? [bl.x0, bl.y0, bl.x1, bl.y1] : ['-', '-', '-', '-']),
          enc(it.GetUTF8Text(RIL_WORD))].join('\t'));
      }
      const s = it.getBoundingBox(RIL_SYMBOL);
      out.push(['S', s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0, enc(it.GetUTF8Text(RIL_SYMBOL))].join('\t'));
    } while (it.Next(nextLevel));
    TessModule.destroy(it);
    return out.join('\n');
  } finally {
    api.Clear();
    TessModule._free(ptr);
  }
}

self.OmrOcr = {
  configure: (c) => Object.assign(config, c),
  warmup: (lang = 'eng') => getApi(lang),
  recognize,
};
