// Audiveris's live trace (engine patch 0009, WebTrace) → the Reader's events (readerstate.js has
// the contract). The worker hands over each block exactly as Java emitted it; this turns it into
// events, keeping the little state the format needs (the current sheet, each sheet's image size).
// Pure: no DOM, no worker — node tests feed it saved traces (tools/fixtures/trace/*.trace).
//
//   const tr = createTrace();
//   for (const ev of tr.block(text)) emit(ev);          // one WebTrace.emit(String)
//   for (const ev of tr.ocr({ width, height, words })) emit(ev);   // the WebOCR native's words
//
// Block format (omr-build/README.md "0009"): lines split by "\n"; the first is a header starting
// with an upper-case letter (K B E G Y N S F), records follow; coordinates are sheet pixels (= the
// 300-dpi render = the TIFF); texts URI-encoded.
//   K n done invalid · B s STEP · E s STEP ms (d w h | i interline) · G s n (y sys l t r b | f sys staff
//   part x0 x1 yl1 yr1 … yl5 yr5) · Y s STEP sys (+id k x y w h [v…] | -id | m x0 … xn) · N s sys
//   (n chord m staff voice t dur head… [lyric…] | r chord m staff voice t dur x,y) · S s ms · F s STEP reason
// Nothing is invented: a record that doesn't parse is skipped (counted in `bad`).

// Audiveris's sheet steps, in order — the one list (readerstate.js imports it, omr.js re-exports it).
export const STEPS = ['LOAD', 'BINARY', 'SCALE', 'GRID', 'HEADERS', 'STEM_SEEDS', 'BEAMS', 'LEDGERS', 'HEADS',
  'STEMS', 'REDUCTION', 'CUE_BEAMS', 'TEXTS', 'MEASURES', 'CHORDS', 'CURVES', 'SYMBOLS', 'LINKS', 'RHYTHMS', 'PAGE'];
const KINDS = new Set(['head', 'stem', 'beam', 'ledger', 'rest', 'clef', 'key', 'time', 'bar', 'slur', 'tie', 'acc',
  'flag', 'dot', 'word', 'lyric', 'other']);
// Tesseract's page-wide call gets the sheet with a white margin of this many pixels on every side
// (Audiveris OcrUtil.whiteMarginAdded): its word boxes are moved back by it.
export const OCR_MARGIN = 10;

const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const int = (x) => (/^-?\d+$/.test(x) ? Number(x) : NaN);
const list = (x) => (x === '-' || x == null ? [] : x.split(',').map(Number).filter(Number.isFinite));

export function createTrace() {
  const st = {
    book: null,            // { n, done: [s], invalid: [s] } from K
    cur: null,             // { s, step } — the step under way (B … E)
    size: {},              // s → [w, h] (after LOAD)
    interline: {},         // s → px (after SCALE)
    stored: [],            // sheets stored in the .omr in this run (S)
    failed: [],            // [{ s, step, reason }] (F)
    parts: {},             // s → { staff id → part id } (G)
    notes: {},             // s → sys → { notes, staffOf } (N: each note's staff, for the export's losses)
    lost: [],              // [{ s, m, part }]: measures the export couldn't write (exportLost)
    bad: 0,                // records that didn't parse
    blocks: 0,
  };

  function block(text) {
    const out = [];
    if (typeof text !== 'string' || !text) return out;
    const lines = text.split('\n');
    const head = lines[0].trim().split(' ');
    const recs = lines.slice(1).filter((l) => l.length);
    st.blocks++;
    const t = head[0];
    try {
      if (t === 'K') {
        st.book = { n: int(head[1]), done: list(head[2]), invalid: list(head[3]) };
        out.push({ t: 'engine', milestone: 'book', detail: { ...st.book } });
        return out;
      }
      const s = int(head[1]);
      if (!Number.isFinite(s)) { st.bad++; return out; }
      if (t === 'B') {
        const step = head[2];
        if (!STEPS.includes(step)) { st.bad++; return out; }
        st.cur = { s, step };
        if (step === 'LOAD') out.push({ t: 'sheet', s, state: 'start' });
        out.push({ t: 'step', s, step });
      } else if (t === 'E') {
        for (const r of recs) {
          const f = r.split(' ');
          if (f[0] === 'd' && f.length === 3) st.size[s] = [int(f[1]), int(f[2])];
          else if (f[0] === 'i' && f.length === 2) st.interline[s] = int(f[1]);
          else st.bad++;
        }
        if (st.cur && st.cur.s === s && st.cur.step === head[2]) st.cur = { ...st.cur, done: true };
      } else if (t === 'G') {
        const systems = [];
        for (const r of recs) {
          const f = r.split(' ');
          const n = f.slice(1).map(int);
          if (f[0] === 'y' && f.length === 6 && n.every(Number.isFinite)) {
            systems.push({ id: n[0], box: n.slice(1), staves: [] });
          } else if (f[0] === 'f' && f.length >= 16 && (f.length - 6) % 2 === 0) {
            // f sys staff part x0 x1 yl1 yr1 … yl5 yr5 (the part id is kept as written when not a number)
            const sys = systems.find((y) => y.id === n[0]);
            const lines = [];
            for (let i = 6; i + 1 < f.length; i += 2) lines.push([int(f[i]), int(f[i + 1])]);
            if (!sys || ![n[1], n[3], n[4]].every(Number.isFinite) || !lines.flat().every(Number.isFinite)) { st.bad++; continue; }
            sys.staves.push({ id: n[1], part: Number.isFinite(n[2]) ? n[2] : f[3], x0: n[3], x1: n[4], lines });
          } else st.bad++;
        }
        st.parts[s] = Object.fromEntries(systems.flatMap((y) => y.staves.map((f) => [f.id, f.part])));
        out.push({ t: 'grid', s, systems });
      } else if (t === 'Y') {
        const step = head[2], sys = int(head[3]);
        if (!STEPS.includes(step) || !Number.isFinite(sys)) { st.bad++; return out; }
        const add = [], del = [];
        let xs = null;
        for (const r of recs) {
          if (r[0] === '+') {
            const f = r.slice(1).split(' ');
            const box = f.slice(2, 6).map(int);
            if (f.length < 6 || !KINDS.has(f[1]) || !Number.isFinite(int(f[0])) || !box.every(Number.isFinite)) { st.bad++; continue; }
            const rec = { id: int(f[0]), k: f[1], x: box[0], y: box[1], w: box[2], h: box[3] };
            if (f.length > 6) rec.v = f.slice(6).map(dec).join(' ');
            add.push(rec);
          } else if (r[0] === '-') {
            const id = int(r.slice(1));
            if (Number.isFinite(id)) del.push(id); else st.bad++;
          } else if (r.startsWith('m ')) {
            xs = r.split(' ').slice(1).map(int).filter(Number.isFinite);
          } else st.bad++;
        }
        out.push({ t: 'sym', s, step, sys, add, del });
        if (xs) out.push({ t: 'measures', s, sys, xs });
      } else if (t === 'N') {
        const sys = int(head[2]);
        const notes = [], staffOf = [];
        for (const r of recs) {
          const f = r.split(' ');
          if (f[0] !== 'n' || f.length < 8) { if (f[0] !== 'r') st.bad++; continue; }
          const [, , m, staff, voice, tt, dur] = f;
          const heads = [], lyr = [];
          for (const x of f.slice(7)) {
            if (x[0] === 'L') {
              const [v, syl, ...txt] = x.slice(1).split(',');
              lyr.push({ v: int(v), syl, text: dec(txt.join(',')) });
            } else {
              const p = x.split(',');
              if (p.length < 6) { st.bad++; continue; }
              heads.push({ x: int(p[1]), y: int(p[2]), step: p[3], alter: int(p[4]), oct: int(p[5]) });
            }
          }
          if (tt === '-') continue; // no time slot: the export leaves the chord out
          const syl = lyr.find((l) => l.v === 1) || lyr[0];
          heads.forEach((hd, i) => {
            if (!/^[A-G]$/.test(hd.step)) return; // unpitched
            const n = { m, x: hd.x, y: hd.y, step: hd.step, alter: hd.alter || 0, oct: hd.oct, dur, voice: voice === '-' ? null : int(voice) };
            if (i === 0 && syl && syl.text) n.syl = syl.text;
            notes.push(n);
            staffOf.push(int(staff));
          });
        }
        (st.notes[s] = st.notes[s] || {})[sys] = { notes, staffOf };
        out.push({ t: 'notes', s, sys, notes });
      } else if (t === 'S') {
        // Stored in the book — a resume point (the worker copies the book on this record). A sheet
        // that failed in this run is stored too (as invalid): it stays failed, not read.
        st.stored.push(s);
        const ms = int(head[2]);
        if (!st.failed.some((x) => x.s === s)) out.push({ t: 'sheet', s, state: 'done', ...(Number.isFinite(ms) ? { ms } : {}) });
      } else if (t === 'F') {
        const reason = dec(head.slice(3).join(' '));
        st.failed.push({ s, step: head[2], reason });
        out.push({ t: 'sheet', s, state: 'failed', reason, step: head[2] });
      } else st.bad++;
    } catch {
      st.bad++;
    }
    return out;
  }

  // The OCR native's words → a 'words' event for the sheet being read, when the image was that
  // sheet plus the margin (the page-wide call; other calls are crops whose place isn't known).
  function ocr({ width, height, words }) {
    const s = st.cur?.s;
    const size = s && st.size[s];
    if (!size || width !== size[0] + 2 * OCR_MARGIN || height !== size[1] + 2 * OCR_MARGIN || !Array.isArray(words)) return [];
    return [{
      t: 'words', s,
      words: words.filter((w) => w && w.text).map((w) => ({ x: w.x - OCR_MARGIN, y: w.y - OCR_MARGIN, w: w.w, h: w.h, text: w.text })),
    }];
  }

  // A measure the export couldn't write (its log: "Error visiting Measure{#3P1} in {Page#2.1}" — a
  // measure that fails when the sheet is reloaded for export, e.g. a skewed scan's barlines): its
  // notes aren't in the MusicXML, so they leave the Reader too — a 'notes' event per system of that
  // sheet holding the rest. Only for sheets read in this run (a resumed run's earlier sheets weren't
  // traced here: their notes stay as they were shown).
  function exportLost(line) {
    const m = EXPORT_LOST.exec(String(line || ''));
    if (!m) return [];
    const [, mid, part, sheet] = m;
    const s = +sheet;
    const out = [];
    for (const [sys, rec] of Object.entries(st.notes[s] || {})) {
      const keep = [], keepStaff = [];
      rec.notes.forEach((n, i) => {
        const p = st.parts[s]?.[rec.staffOf[i]];
        const lost = n.m === mid && (part == null || String(p) === part);
        if (!lost) { keep.push(n); keepStaff.push(rec.staffOf[i]); }
      });
      if (keep.length === rec.notes.length) continue;
      rec.notes = keep; rec.staffOf = keepStaff;
      out.push({ t: 'notes', s, sys: +sys, notes: keep });
    }
    if (out.length || st.notes[s]) st.lost.push({ s, m: mid, part: part ?? null });
    return out;
  }
  return { block, ocr, exportLost, state: st };
}

// Audiveris's export, a measure it couldn't write: page measure id, part (absent with one part), sheet.
export const EXPORT_LOST = /Error visiting Measure\{#([^}P\s]+)(?:P(\d+))?\} in \{Page#(\d+)\.\d+\}/;

// The OCR engine's records (ocr-engine.js: tab-separated, URI-encoded) → words with boxes in the
// OCR image's pixels.
export function ocrWords(records) {
  const out = [];
  for (const l of String(records || '').split('\n')) {
    if (l[0] !== 'W') continue;
    const f = l.split('\t');
    const text = dec(f[f.length - 1] || '').trim();
    const [x, y, w, h] = f.slice(1, 5).map(Number);
    if (text && [x, y, w, h].every(Number.isFinite)) out.push({ x, y, w, h, text });
  }
  return out;
}
