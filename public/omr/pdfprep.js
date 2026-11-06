// PDF → music pages → multi-page TIFF, for Audiveris.
//
// Audiveris fails a whole book when any sheet has no staves (title pages,
// lyric sheets), so pages are rendered with pdf.js and only pages with staves
// are kept, binarized (see renderPdf), and packed into one uncompressed 8-bit
// gray TIFF, which Audiveris reads as one sheet per page.

export const DPI = 300;

let pdfjs = null;
async function loadPdfjs(base) {
  if (!pdfjs) {
    pdfjs = await import(`${base}/pdf.min.mjs`);
    pdfjs.GlobalWorkerOptions.workerSrc = `${base}/pdf.worker.min.mjs`;
  }
  return pdfjs;
}

// Render every page; returns [{ index, width, height, gray: Uint8Array, staves, blank, lines }]
// (lines: the page's largest text lines, from its text layer — empty for scans).
export async function renderPdf(data, { pdfjsBase, dpi = DPI, onPage } = {}) {
  const lib = await loadPdfjs(pdfjsBase);
  // Decoders for scanned pages (JBIG2, JPEG 2000) and color profiles are WebAssembly
  // modules pdf.js loads on demand; standard fonts are for PDFs that don't embed them.
  const task = lib.getDocument({
    data,
    wasmUrl: `${pdfjsBase}/wasm/`,
    standardFontDataUrl: `${pdfjsBase}/standard_fonts/`,
    iccUrl: `${pdfjsBase}/iccs/`,
  });
  const doc = await task.promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: dpi / 72 });
    const width = Math.round(viewport.width), height = Math.round(viewport.height);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    await page.render({ canvasContext: ctx, canvas, viewport }).promise;
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const gray = new Uint8Array(width * height);
    // Pure black & white. pdf.js anti-aliases, and on gray glyph edges Tesseract
    // recognizes far fewer lyrics. Edge pixels darker than ~80% white count as ink:
    // slightly bold glyphs OCR best (lyric syllables on the test scores, cut 128 → 200:
    // 87% → 98%, 93% → 96%, 92% → 93%, 100% → 100%; notes identical).
    for (let p = 0, q = 0; p < gray.length; p++, q += 4) {
      gray[p] = rgba[q] * 299 + rgba[q + 1] * 587 + rgba[q + 2] * 114 < 200000 ? 0 : 255;
    }
    let lines = [], tempo = null;
    try {
      const content = await page.getTextContent();
      lines = textLines(content);
      tempo = tempoMark(content);
    } catch {}
    page.cleanup();
    canvas.width = canvas.height = 0; // free the 35 MB backing store now (iOS caps total canvas memory)
    const staves = countStaves(gray, width, height);
    let ink = 0;
    for (let p = 0; p < gray.length; p += 97) if (!gray[p]) ink++;
    // < 0.5% ink: (almost) nothing drawn — e.g. an undecodable scan under a footer line
    const blank = ink * 97 < gray.length * 0.005;
    pages.push({ index: i, width, height, gray, staves, blank, lines, tempo });
    onPage?.(i, doc.numPages, staves, blank);
  }
  await task.destroy();
  return pages;
}

// A page's text (vector PDFs carry it; scans don't) as lines — items sharing a baseline,
// in reading order — with their font size (pt): the 8 largest that are words (music drawn
// with a font, "{} mf", "Ï Ï", would otherwise crowd out the heading).
export function textLines(content) {
  const rows = [];
  for (const it of content.items || []) {
    const str = (it.str || "").trim();
    if (!str || !it.transform) continue;
    const size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 0;
    const x = it.transform[4], y = it.transform[5];
    let row = rows.find((r) => Math.abs(r.y - y) < Math.max(2, size * 0.3));
    if (!row) rows.push((row = { y, size: 0, items: [] }));
    row.items.push({ x, str });
    row.size = Math.max(row.size, size);
  }
  return rows
    .map((r) => ({ text: r.items.sort((a, b) => a.x - b.x).map((i) => i.str).join(" ").replace(/\s+/g, " ").trim(), size: Math.round(r.size * 10) / 10 }))
    .filter((l) => l.text.length <= 80 && /\p{L}{2}/u.test(l.text) && /^[\p{L}\p{N}\s'’",.!?&:()\-–—]+$/u.test(l.text))
    .sort((a, b) => b.size - a.size)
    .slice(0, 8);
}

// A metronome mark in the page's text ("Moderately ♩ = 104": the number is text, the note
// is usually a music-font glyph) → { bpm, unit, dotted }, or null. The unit is read from a
// standard music font's metronome glyph just before the "=" (SMuFL ♩ U+ECA5, 𝅗𝅥 U+ECA3,
// ♪ U+ECA7, dot U+ECB7; Unicode ♩ ♪ 𝅗𝅥), or from a music *text* font that draws notes as
// letters (Finale's Maestro, Sibelius's Opus Text…: w whole, h half, q quarter, e eighth,
// x sixteenth, "." the dot) — the text layer then reads "h. = 58" (Piano Man: 𝅗𝅥. = 58, a
// fast three "in one", i.e. ♩ = 174); otherwise null (the meter decides later). A range
// "= 92-96" takes its first number.
export function tempoMark(content) {
  const rows = new Map();
  for (const it of content.items || []) {
    if (!it.str || !it.transform) continue;
    const y = Math.round(it.transform[5] / 3);
    rows.set(y, `${rows.get(y) || ""} ${it.str}`);
  }
  for (const row of rows.values()) {
    const m = /(\S*)\s*=\s*(\d{2,3})(?!\d)/.exec(row);
    if (!m || Number(m[2]) < 30 || Number(m[2]) > 300) continue;
    const g = m[1];
    let unit = /[\u{1D15E}]/u.test(g) ? "half" : /[♩]/u.test(g) ? "quarter" : /[♪]/u.test(g) ? "eighth" : null;
    let dotted = !!unit && /[.]/u.test(g);
    // A music text font's letter: the whole token is one letter (+ a dot).
    const letter = /^([whqex])(\.?)$/.exec(g);
    if (!unit && letter) {
      unit = { w: "whole", h: "half", q: "quarter", e: "eighth", x: "16th" }[letter[1]];
      dotted = !!letter[2];
    }
    return { bpm: Number(m[2]), unit, dotted };
  }
  return null;
}

// Count 5-line staves: rows containing a long horizontal dark run are
// candidate staff lines; staves are 5 of them with near-equal spacing.
export function countStaves(gray, width, height) {
  const minRun = width * 0.3;
  const lineRows = [];
  for (let y = 0; y < height; y++) {
    let run = 0, best = 0, gap = 0;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (gray[row + x] < 140) { run += gap + 1; gap = 0; if (run > best) best = run; }
      else if (run > 0 && gap < 2) gap++;   // tolerate tiny breaks
      else { run = 0; gap = 0; }
    }
    if (best >= minRun) lineRows.push(y);
  }
  // Merge adjacent rows into lines (centre y).
  const lines = [];
  for (let k = 0; k < lineRows.length; ) {
    let j = k;
    while (j + 1 < lineRows.length && lineRows[j + 1] - lineRows[j] <= 1) j++;
    if (lineRows[j] - lineRows[k] < 8) lines.push((lineRows[k] + lineRows[j]) / 2);
    k = j + 1;
  }
  // Greedy 5-line groups with consistent spacing (6..60 px at 300 dpi).
  let staves = 0;
  for (let i = 0; i + 4 < lines.length; ) {
    const gaps = [1, 2, 3, 4].map((d) => lines[i + d] - lines[i + d - 1]);
    const mean = gaps.reduce((a, b) => a + b) / 4;
    if (mean >= 6 && mean <= 60 && gaps.every((g) => Math.abs(g - mean) <= Math.max(2, mean * 0.2))) {
      staves++;
      i += 5;
    } else i++;
  }
  return staves;
}

// Multi-page TIFF: little-endian, 8-bit gray (BlackIsZero), uncompressed, one strip per page.
// Each page's pixels are released (page.gray = null) once copied, so the peak memory is about
// one TIFF rather than pages + TIFF (~9 MB per page at 300 dpi; it matters on phones).
export function buildTiff(pages, dpi = DPI) {
  const TAGS = 13;
  const ifdSize = 2 + TAGS * 12 + 4;
  const extra = 16; // two RATIONALs (x/y resolution)
  let size = 8;
  for (const p of pages) size += ifdSize + extra + p.gray.length + (p.gray.length & 1);
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  dv.setUint16(0, 0x4949, true); // "II"
  dv.setUint16(2, 42, true);
  let off = 8;
  dv.setUint32(4, off, true);
  pages.forEach((p, n) => {
    const ifd = off;
    const rational = ifd + ifdSize;
    const data = rational + extra;
    const next = n + 1 < pages.length ? data + p.gray.length + (p.gray.length & 1) : 0;
    const tags = [
      [254, 4, 1, 2],                 // NewSubfileType: page of a multi-page image
      [256, 4, 1, p.width],           // ImageWidth
      [257, 4, 1, p.height],          // ImageLength
      [258, 3, 1, 8],                 // BitsPerSample
      [259, 3, 1, 1],                 // Compression: none
      [262, 3, 1, 1],                 // Photometric: BlackIsZero
      [273, 4, 1, data],              // StripOffsets
      [277, 3, 1, 1],                 // SamplesPerPixel
      [278, 4, 1, p.height],          // RowsPerStrip
      [279, 4, 1, p.gray.length],     // StripByteCounts
      [282, 5, 1, rational],          // XResolution
      [283, 5, 1, rational + 8],      // YResolution
      [296, 3, 1, 2],                 // ResolutionUnit: inch
    ];
    dv.setUint16(ifd, TAGS, true);
    tags.forEach(([tag, type, count, value], i) => {
      const e = ifd + 2 + i * 12;
      dv.setUint16(e, tag, true);
      dv.setUint16(e + 2, type, true);
      dv.setUint32(e + 4, count, true);
      if (type === 3) dv.setUint16(e + 8, value, true);
      else dv.setUint32(e + 8, value, true);
    });
    dv.setUint32(ifd + 2 + TAGS * 12, next, true);
    dv.setUint32(rational, dpi, true); dv.setUint32(rational + 4, 1, true);
    dv.setUint32(rational + 8, dpi, true); dv.setUint32(rational + 12, 1, true);
    u8.set(p.gray, data);
    p.gray = null;
    off = next;
  });
  return u8;
}
