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

// Render every page; returns [{ index, width, height, gray: Uint8Array, staves: count, staffLines, blank,
// lines, tempo, preview }] (lines: the page's largest text lines, from its text layer — empty for scans;
// staffLines: [{ x0, x1, y: [5 line ys] }] in 300-dpi pixels; preview: a small Blob of the binarized
// page, only with `preview`). `only` (a Set of 1-based page numbers) renders just those pages — a
// resumed import rebuilds the TIFF of the pages still to read — and `text: false` skips the text layer.
// onPage(i, n, staves, blank, page) after each page (the page record, its gray still there).
export async function renderPdf(data, { pdfjsBase, dpi = DPI, onPage, only = null, preview = false, text = true } = {}) {
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
    if (only && !only.has(i)) continue;
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
    if (text) {
      try {
        const content = await page.getTextContent();
        lines = textLines(content);
        tempo = tempoMark(content);
      } catch {}
    }
    page.cleanup();
    canvas.width = canvas.height = 0; // free the 35 MB backing store now (iOS caps total canvas memory)
    const staffLines = findStaves(gray, width, height);
    let ink = 0;
    for (let p = 0; p < gray.length; p += 97) if (!gray[p]) ink++;
    // < 0.5% ink: (almost) nothing drawn — e.g. an undecodable scan under a footer line
    const blank = ink * 97 < gray.length * 0.005;
    let small = null;
    if (preview) { try { small = await previewOf(gray, width, height); } catch {} }
    const rec = { index: i, width, height, gray, staves: staffLines.length, staffLines, blank, lines, tempo, preview: small };
    pages.push(rec);
    onPage?.(i, doc.numPages, staffLines.length, blank, rec);
  }
  await task.destroy();
  return pages;
}

// A small picture of a binarized page for the progress view: ~1100 px on its long side (a box
// average, so thin lines stay visible as gray), black ink on white, WebP where the browser encodes
// it (else PNG). Its canvas is ~4 MB and freed at once.
export const PREVIEW_PX = 1100;
export async function previewOf(gray, width, height, long = PREVIEW_PX) {
  const f = Math.max(1, Math.round(Math.max(width, height) / long));
  const w = Math.max(1, Math.floor(width / f)), h = Math.max(1, Math.floor(height / f));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data, n = f * f;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let yy = 0; yy < f; yy++) {
        const row = (y * f + yy) * width + x * f;
        for (let xx = 0; xx < f; xx++) sum += gray[row + xx];
      }
      const v = Math.round(sum / n), q = (y * w + x) * 4;
      d[q] = d[q + 1] = d[q + 2] = v; d[q + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  try {
    return await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 }); // PNG where WebP isn't encoded
  } finally {
    canvas.width = canvas.height = 0;
  }
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
// "= 92-96" takes its first number; "= about 76", "= ca. 76", "≈ 76" read as 76. With no note
// symbol in the text, the marking's own words may still say where the beat is: "in 2" / "in
// one" (`felt`: beats per bar — The Longest Time: "Bright rock and roll, in 2 (𝅗𝅥 = about 76)",
// the half note drawn as a picture; ♩ = 152).
export function tempoMark(content) {
  const rows = new Map();
  for (const it of content.items || []) {
    if (!it.str || !it.transform) continue;
    const y = Math.round(it.transform[5] / 3);
    rows.set(y, `${rows.get(y) || ""} ${it.str}`);
  }
  const ys = [...rows.keys()].sort((a, b) => b - a); // top to bottom
  for (const y of ys) {
    const row = rows.get(y);
    const m = /(\S*)\s*(?:=|≈|~)\s*(?:(?:about|approx\.?|approximately|ca\.?|circa|c\.)\s*)?(\d{2,3})(?!\d)/i.exec(row);
    if (!m || Number(m[2]) < 30 || Number(m[2]) > 300) continue;
    // "in 2" / "in one" on this row or the one above it (the tempo words often wrap)
    const above = ys[ys.indexOf(y) - 1] !== undefined && ys[ys.indexOf(y) - 1] - y <= 12 ? rows.get(ys[ys.indexOf(y) - 1]) : "";
    const inN = /\bin\s+(one|two|three|four|1|2|3|4)\b/i.exec(`${above} ${row}`);
    const felt = inN ? { one: 1, two: 2, three: 3, four: 4 }[inN[1].toLowerCase()] ?? Number(inN[1]) : null;
    const g = m[1];
    let unit = /[\u{1D15E}]/u.test(g) ? "half" : /[♩]/u.test(g) ? "quarter" : /[♪]/u.test(g) ? "eighth" : null;
    let dotted = !!unit && /[.]/u.test(g);
    // A music text font's letter: the whole token is one letter (+ a dot).
    const letter = /^([whqex])(\.?)$/.exec(g);
    if (!unit && letter) {
      unit = { w: "whole", h: "half", q: "quarter", e: "eighth", x: "16th" }[letter[1]];
      dotted = !!letter[2];
    }
    return { bpm: Number(m[2]), unit, dotted, ...(felt && !unit ? { felt } : {}) };
  }
  return null;
}

// 5-line staves: rows containing a long horizontal dark run are candidate staff lines; staves are
// 5 of them with near-equal spacing. Returns [{ x0, x1, y: [5 line centre ys] }] (x: the lines'
// leftmost start and rightmost end).
export function findStaves(gray, width, height) {
  const minRun = width * 0.3;
  const rows = []; // { y, x0, x1 }
  for (let y = 0; y < height; y++) {
    let run = 0, best = 0, gap = 0, start = 0, bs = 0, be = 0;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (gray[row + x] < 140) {
        if (run === 0) start = x;
        run += gap + 1; gap = 0;
        if (run > best) { best = run; bs = start; be = x; }
      } else if (run > 0 && gap < 2) gap++;   // tolerate tiny breaks
      else { run = 0; gap = 0; }
    }
    if (best >= minRun) rows.push({ y, x0: bs, x1: be });
  }
  // Merge adjacent rows into lines (centre y).
  const lines = [];
  for (let k = 0; k < rows.length; ) {
    let j = k, x0 = rows[k].x0, x1 = rows[k].x1;
    while (j + 1 < rows.length && rows[j + 1].y - rows[j].y <= 1) { j++; x0 = Math.min(x0, rows[j].x0); x1 = Math.max(x1, rows[j].x1); }
    if (rows[j].y - rows[k].y < 8) lines.push({ y: (rows[k].y + rows[j].y) / 2, x0, x1 });
    k = j + 1;
  }
  // Greedy 5-line groups with consistent spacing (6..60 px at 300 dpi).
  const staves = [];
  for (let i = 0; i + 4 < lines.length; ) {
    const gaps = [1, 2, 3, 4].map((d) => lines[i + d].y - lines[i + d - 1].y);
    const mean = gaps.reduce((a, b) => a + b) / 4;
    if (mean >= 6 && mean <= 60 && gaps.every((g) => Math.abs(g - mean) <= Math.max(2, mean * 0.2))) {
      const five = lines.slice(i, i + 5);
      staves.push({ x0: Math.min(...five.map((l) => l.x0)), x1: Math.max(...five.map((l) => l.x1)), y: five.map((l) => l.y) });
      i += 5;
    } else i++;
  }
  return staves;
}
export const countStaves = (gray, width, height) => findStaves(gray, width, height).length;

// Multi-page TIFF: little-endian, 8-bit gray (BlackIsZero), uncompressed, one strip per page.
// Each page's pixels are released (page.gray = null) once copied, so the peak memory is about
// one TIFF rather than pages + TIFF (~9 MB per page at 300 dpi; it matters on phones). A resumed
// import passes 1×1 white placeholders for the pages already read (only Audiveris's LOAD step reads
// a page, and finished sheets are never loaded again: placeholder()).
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

// A stand-in page for a sheet the engine already finished (a resumed book never loads it again).
export const placeholder = () => ({ width: 1, height: 1, gray: new Uint8Array([255]) });
