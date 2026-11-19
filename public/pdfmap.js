// Where a song's bars sit on its original PDF (Play's 📄): from the MusicXML Audiveris exported
// (PDF → Song), whose layout is the page as it was read —
//
//   <defaults> scaling (40 tenths = the interline × 4, at 300 dpi) and page-layout: the sheet's
//     size in tenths plus 2 × 80 of margins Audiveris adds (PartwiseBuilder: page-width =
//     toTenths(sheet width) + 160);
//   <print> in each system's first measure: system-margins left-margin = the system's left x on
//     the sheet (tenths, no page margin), top-system-distance = the first system's top line y,
//     system-distance = this system's top − the previous one's bottom line, and per part
//     staff-layout staff-distance = a staff's top − the staff above's bottom (every staff but the
//     system's first); a staff is 40 tenths high (Audiveris writes no staff-size: a small staff is
//     taken as a normal one — its system reads up to an interline too tall);
//   <measure width>: the bar's width, barline to barline, from the system's left;
//   <print new-page>: the next sheet; miscellaneous source-sheet-N: the book's sheet number of
//     each exported page (a sheet that failed is left out of the export) — sheet N is the PDF's
//     N-th page with music (PDF → Song keeps only pages with staves).
//
// Checked against the engine's own geometry (the Reader's grid / measures events of a real run,
// tools/fixtures/trace/greensleeves): barlines within 3 px of 2550, staff lines within 15 px of
// 3300 (a system's height adds up its staves at 40 tenths each — the interline is a whole number
// of pixels — so a page's last system can sit an interline low).
//
//   readLayout(xml | Document) → layout | null (no layout: not an Audiveris export)
//     layout = { sheetW, sheetH (tenths, <defaults>: sheet 1's), pages: [{ w, h } each exported
//                page's own sheet size in its own tenths], sheets: [book sheet number per exported page],
//                measures: [{ n (number attribute), page (exported page, 0-based), sys (system on
//                it), x0, x1, y0, y1 (fractions of the sheet) }] }
//   matchMeasures(layout, numbers) → [layout index | -1] per bar of the song as Play reads it
//     (numbers: each bar's number attribute; the song's clean-ups may have dropped bars — boxed
//     fills — so bars are matched by number, in order)
//   sheetPages(layout, { pages, numPages, music }) → [PDF page (1-based) | null] per exported page
//   focusRects(layout, idx, pdfPages, pad) → [{ page, x0, y0, x1, y1 }] a rect per system segment
//   musicPages(doc, findStaves) → [PDF pages with a five-line staff] (pdf.js document, 150 dpi)

const kids = (el, name) => (el ? [...el.children].filter((c) => c.nodeName === name) : []);
const kid = (el, name) => (el ? [...el.children].find((c) => c.nodeName === name) || null : null);
const num = (el, d = 0) => { const v = Number(el?.textContent); return Number.isFinite(v) && el ? v : d; };
const STAFF = 40; // a staff's height in tenths (4 interlines)

export function readLayout(src) {
  let doc = src;
  if (typeof src === "string") {
    if (!/<page-layout\b/.test(src.slice(0, 20000))) return null;
    doc = new DOMParser().parseFromString(src, "application/xml");
    if (doc.querySelector("parsererror")) return null;
  }
  const root = doc?.documentElement;
  if (!root || root.nodeName !== "score-partwise") return null;
  const defaults = kid(root, "defaults"), pl = kid(defaults, "page-layout");
  if (!pl) return null;
  const pw = num(kid(pl, "page-width")), ph = num(kid(pl, "page-height"));
  const pm = kids(pl, "page-margins")[0];
  const ml = num(kid(pm, "left-margin"), 0), mr = num(kid(pm, "right-margin"), 0);
  const mt = num(kid(pm, "top-margin"), 0), mb = num(kid(pm, "bottom-margin"), 0);
  // (Audiveris: page-width = sheet + left margin + top margin, page-height = sheet + 2 × top margin;
  // its margins are equal, 80)
  const sheetW = pw - ml - mr, sheetH = ph - mt - mb;
  if (!(sheetW > 100 && sheetH > 100)) return null;
  const parts = kids(root, "part");
  if (!parts.length) return null;
  const lists = parts.map((p) => kids(p, "measure"));
  const n = lists[0].length;
  if (!n) return null;
  // Each part's staves at each bar (<staves>, kept until changed).
  const staves = parts.map((p, pi) => {
    let s = 1;
    return lists[pi].map((m) => {
      for (const at of kids(m, "attributes")) { const st = kid(at, "staves"); if (st) s = num(st, 1) || 1; }
      return s;
    });
  });
  const printOf = (m) => kid(m, "print");
  // System starts: a bar with <print new-system|new-page> in any part (and bar 0). Positions are
  // kept in tenths here and made fractions of their own page's sheet at the end (below).
  const measures = [];
  const systems = []; // { page, left, right (right-margin | null), w (Σ bar widths) }
  let page = 0, sys = -1, top = 0, bottom = 0, left = 0, x = 0, seen = false, cur = null;
  const prevDist = new Map(); // "part|staff" → the last staff-distance seen (a missing one)
  for (let i = 0; i < n; i++) {
    const prints = lists.map((ms) => (ms[i] ? printOf(ms[i]) : null));
    const newPage = prints.some((p) => p?.getAttribute("new-page") === "yes");
    const newSys = i === 0 || newPage || prints.some((p) => p?.getAttribute("new-system") === "yes");
    if (newSys) {
      if (newPage && seen) { page++; sys = -1; }
      sys++;
      seen = true;
      const sl = prints.map((p) => kid(p, "system-layout")).find(Boolean) || null;
      const sm = kid(sl, "system-margins");
      left = sm ? num(kid(sm, "left-margin"), 0) : left;
      const rm = kid(sm, "right-margin");
      cur = { page, left, right: rm ? num(rm, NaN) : null, w: 0 };
      systems.push(cur);
      const tsd = kid(sl, "top-system-distance"), sd = kid(sl, "system-distance");
      if (sys === 0) top = tsd ? num(tsd) : sd ? num(sd) : 0;
      else top = bottom + (sd ? num(sd) : tsd ? num(tsd) - bottom : 0);
      // The system's height: its staves (parts not printed in it left out), and the distances.
      let h = 0, first = true;
      parts.forEach((p, pi) => {
        const m = lists[pi][i];
        if (!m) return;
        const sd2 = kids(m, "attributes").flatMap((a) => kids(a, "staff-details"));
        if (sd2.length && sd2.every((d) => d.getAttribute("print-object") === "no")) return;
        const pr = prints[pi];
        const dist = new Map(kids(pr, "staff-layout").map((s) => [s.getAttribute("number") || "1", kid(s, "staff-distance")]));
        for (let s = 1; s <= staves[pi][i]; s++) {
          if (!first) {
            const key = `${pi}|${s}`, el = dist.get(String(s));
            const d = el ? num(el, 60) : prevDist.get(key) ?? 60;
            prevDist.set(key, d);
            h += d;
          }
          h += STAFF;
          first = false;
        }
      });
      bottom = top + Math.max(h, STAFF);
      x = left;
    }
    const w = Math.max(0, ...lists.map((ms) => Number(ms[i]?.getAttribute("width")) || 0));
    measures.push({ n: lists[0][i].getAttribute("number") || "", page, sys, x0: x, x1: x + w, y0: top, y1: bottom });
    x += w;
    cur.w += w;
  }
  // Each exported page's own sheet size: Audiveris writes a page's <print>, margins and widths in
  // that sheet's own interline (toTenths), and <defaults> only once — sheet 1's. A later sheet read
  // at another interline (Piano Man: 18 px on sheet 1, 17 on the rest) is wider in its own tenths:
  // a system's left-margin + its bars + right-margin is the sheet's width (Audiveris writes the
  // right-margin when the system stops short of the edge). The median over a page's systems; none
  // with a right-margin → the defaults. The height in proportion (the sheets are one size).
  const pages = [];
  for (let k = 0; k <= page; k++) {
    const t = systems.filter((s) => s.page === k && Number.isFinite(s.right)).map((s) => s.left + s.w + s.right).sort((a, b) => a - b);
    const med = t.length ? (t.length % 2 ? t[t.length >> 1] : (t[t.length / 2 - 1] + t[t.length / 2]) / 2) : 0;
    // (within 1.5% of the defaults: the defaults — the sums round each bar to a tenth, and the
    // interline is a whole number of pixels, ≥ 4% from the next one at the sizes Audiveris reads;
    // far off — over a third — is not a sheet width: the defaults too)
    const w = med > sheetW * 0.75 && med < sheetW * 1.5 && Math.abs(med / sheetW - 1) > 0.015 ? med : sheetW;
    pages.push({ w, h: sheetH * (w / sheetW) });
  }
  for (const m of measures) {
    const { w, h } = pages[m.page];
    m.x0 /= w; m.x1 /= w; m.y0 /= h; m.y1 /= h;
  }
  // The book's sheet of each exported page.
  const fields = [...root.querySelectorAll("identification > miscellaneous > miscellaneous-field")]
    .map((f) => /^source-sheet-(\d+)$/.exec(f.getAttribute("name") || "")).filter(Boolean).map((m) => Number(m[1]));
  const sheets = [];
  for (let k = 0; k <= page; k++) sheets.push(fields[k] ?? (k ? sheets[k - 1] + 1 : 1));
  return { sheetW, sheetH, pages, sheets, measures };
}

// The song's bars (as Play reads it: the clean-ups may drop bars — a boxed fill — and never add or
// renumber any) against the layout's: by number, in order.
export function matchMeasures(layout, numbers) {
  const L = layout.measures;
  if (L.length === numbers.length && L.every((m, i) => m.n === String(numbers[i] ?? ""))) return L.map((_, i) => i);
  const out = [];
  let j = 0;
  for (const nb of numbers) {
    let k = j;
    while (k < L.length && k < j + 64 && L[k].n !== String(nb ?? "")) k++;
    if (k < L.length && L[k].n === String(nb ?? "")) { out.push(k); j = k + 1; } else out.push(-1);
  }
  return out;
}

// The PDF page of each exported page: the song's own record of it (pages: the PDF page of each
// book sheet, PDF → Song), else the same page when the PDF has as many pages as the book had
// sheets, else the PDF's pages with music in order (music: musicPages()). → [page | null].
export function sheetPages(layout, { pages = null, numPages = 0, music = null } = {}) {
  const last = Math.max(...layout.sheets);
  return layout.sheets.map((s) => {
    let p = null;
    if (Array.isArray(pages) && pages.length) p = pages[s - 1] ?? null;
    else if (numPages && numPages === last) p = s;
    else if (Array.isArray(music)) p = music[s - 1] ?? null;
    return Number.isInteger(p) && p >= 1 && (!numPages || p <= numPages) ? p : null;
  });
}

// The rects of some bars (layout indices, in order): one per system they're in, from the first
// bar's left barline to the last one's right, the system's top line to its bottom line — padded
// by `pad` interlines up and down and half that across. → [{ page (PDF), x0, y0, x1, y1 }].
export function focusRects(layout, idx, pdfPages, pad = 1) {
  const groups = new Map();
  for (const j of idx) {
    const m = layout.measures[j];
    if (!m) continue;
    const page = pdfPages[m.page];
    if (!page) continue;
    const key = `${m.page}|${m.sys}`;
    const g = groups.get(key);
    if (!g) groups.set(key, { page, sheet: m.page, x0: m.x0, x1: m.x1, y0: m.y0, y1: m.y1 });
    else { g.x0 = Math.min(g.x0, m.x0); g.x1 = Math.max(g.x1, m.x1); }
  }
  const c = (v) => Math.max(0, Math.min(1, v));
  return [...groups.values()].map((g) => {
    const sz = layout.pages?.[g.sheet] || { w: layout.sheetW, h: layout.sheetH };
    const py = (pad * 10) / sz.h, px = (pad * 5) / sz.w;
    return { page: g.page, x0: c(g.x0 - px), y0: c(g.y0 - py), x1: c(g.x1 + px), y1: c(g.y1 + py) };
  });
}

// The PDF's pages with a five-line staff, as PDF → Song chose them (pdfprep findStaves on a
// binarized render), at 150 dpi (staff lines ≥ 6 px apart there too). Stops once `need` are found.
export async function musicPages(doc, findStaves, { need = Infinity, dpi = 150 } = {}) {
  const out = [];
  for (let p = 1; p <= doc.numPages && out.length < need; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: dpi / 72 });
    const w = Math.round(vp.width), h = Math.round(vp.height);
    const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise;
    const rgba = ctx.getImageData(0, 0, w, h).data;
    const gray = new Uint8Array(w * h);
    for (let i = 0, q = 0; i < gray.length; i++, q += 4) gray[i] = rgba[q] * 299 + rgba[q + 1] * 587 + rgba[q + 2] * 114 < 200000 ? 0 : 255;
    canvas.width = canvas.height = 0;
    if (findStaves(gray, w, h).length) out.push(p);
  }
  return out;
}
