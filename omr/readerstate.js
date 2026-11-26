// The PDF → Song import as data: a pure reducer over the import's event stream, plus selectors.
// No DOM — reader.js draws it, pdf-import.js reports from it, node tests replay it. A resumed
// import is the same stored events reduced again (fast-forward, no animation).
//
// Events (the importer produces them; coordinates are 300-dpi page pixels = Audiveris sheet
// pixels = the TIFF; s = 1-based sheet among the kept music pages; page = 1-based PDF page):
//   { t:'job', id, name, size, resumed }
//   { t:'phase', phase: 'pages'|'engine'|'read'|'export'|'clean'|'save'|'done'|'error' }
//   { t:'page', page, of, w, h, music, blank, s?, preview: Blob|null, staves:[{ x0, x1, y:[5] }] }
//   { t:'meta', title?, tempo? }
//   { t:'engine', milestone: 'fetch'|'jvm'|'start'|'font'|'book', detail? }   (the same milestone again: its
//     detail updated — the worker's '↓ 23 MB' while the engine's files download)
//   { t:'sheet', s, state:'start'|'done'|'failed', reason?, step? (failed: where), ms? }   (a failed sheet
//     stays failed: the engine stores it in the book too, but it wasn't read)
//   { t:'step', s, step }
//   { t:'grid', s, systems:[{ id, box:[l,t,r,b], staves:[{ id, part, x0, x1, lines:[[y0,y1]×5] }] }] }
//   { t:'sym', s, step, sys, add:[{ id, k, x, y, w, h, v? }], del:[ids] }
//   { t:'measures', s, sys, xs:[x…] }
//   { t:'words', s, words:[{ x, y, w, h, text }] }
//   { t:'notes', s, sys, notes:[{ m, x, y, step, alter, oct, dur, voice, syl? }] }   (m = the page's measure
//     id; again for a (s, sys) during the export: those notes minus the measures the export couldn't write)
//   { t:'export', s }   the export reading sheet s back from the book (after phase 'export')
//   { t:'xml', text }   { t:'fix', msg }   { t:'done', songId, title }   { t:'error', message, kind? }
// Any event may carry `at` (ms, Date.now() when it happened); reader.js stamps it on push and
// stored events keep it, so clocks and the ETA survive a replay. Missing fields are left out by
// the importer, never invented — every selector copes with their absence.
// tools/importcontract.mjs checks a run's events against this (fields, types, order).

// Audiveris's sheet steps, in order: trace.js's list (one list — trace.js rejects a step it doesn't know).
import { STEPS } from './trace.js?v=111';
export { STEPS };
// Audiveris walks the systems one after another in these (AbstractSystemStep); the others work on
// the whole sheet at once.
export const PER_SYSTEM = new Set(['HEADERS', 'STEM_SEEDS', 'BEAMS', 'LEDGERS', 'HEADS', 'STEMS', 'REDUCTION',
  'CUE_BEAMS', 'TEXTS', 'MEASURES', 'CHORDS', 'SYMBOLS', 'LINKS']);

// Share of a page's time per step in the browser (sandbox Chromium, 20 s samples over every e2e
// run: HEADS 29%, BEAMS 20%, PAGE 15% incl. storing the book, STEMS 9% …); the rest ≥ 0.2.
export const STEP_SHARE = {
  LOAD: 1.0, BINARY: 2.9, SCALE: 1.0, GRID: 5.6, HEADERS: 3.0, STEM_SEEDS: 1.0, BEAMS: 20.1, LEDGERS: 4.5,
  HEADS: 28.8, STEMS: 9.0, REDUCTION: 1.0, CUE_BEAMS: 0.2, TEXTS: 3.5, MEASURES: 0.5, CHORDS: 0.5,
  CURVES: 3.3, SYMBOLS: 2.5, LINKS: 0.5, RHYTHMS: 0.5, PAGE: 15.2,
};
const SHARE_SUM = STEPS.reduce((a, s) => a + STEP_SHARE[s], 0);
const SHARE_BEFORE = {};
{ let acc = 0; for (const s of STEPS) { SHARE_BEFORE[s] = acc / SHARE_SUM; acc += STEP_SHARE[s]; } }

// What each step is, in a word or two, and one glyph for the corner pill.
export const STEP_INFO = {
  LOAD: ['page', '▤'], BINARY: ['black & white', '◐'], SCALE: ['staff size', '↕'], GRID: ['staves', '☰'],
  HEADERS: ['clefs & keys', '♭'], STEM_SEEDS: ['stems', '│'], BEAMS: ['beams', '▬'], LEDGERS: ['ledger lines', '═'],
  HEADS: ['note heads', '●'], STEMS: ['stems', '│'], REDUCTION: ['sorting out', '⋯'], CUE_BEAMS: ['cue notes', '▬'],
  TEXTS: ['words', 'A'], MEASURES: ['bars', '‖'], CHORDS: ['chords', '⋮'], CURVES: ['slurs & ties', '⌒'],
  SYMBOLS: ['rests & marks', '♯'], LINKS: ['linking', '⟷'], RHYTHMS: ['rhythm', '♪'], PAGE: ['notes', '♫'],
};
export const PHASE_INFO = {
  idle: ['', '·'], pages: ['pages', '▤'], engine: ['engine', '⚙'], read: ['reading', '●'], export: ['MusicXML', '</>'],
  clean: ['clean-up', '✓'], save: ['saving', '↓'], done: ['done', '✓'], error: ['stopped', '!'],
};
export const MILESTONES = ['fetch', 'jvm', 'start', 'font', 'book'];
export const MILESTONE_INFO = { fetch: 'download', jvm: 'Java', start: 'engine', font: 'music font', book: 'pages' };
// Overall progress: how the whole run splits between the phases (pages ~20 s, engine 10–20 s
// warm, then ~30 s a page on an iPhone, export ~a third of a page).
const PHASE_W = { pages: 0.03, engine: 0.04, read: 0.88, export: 0.03, finish: 0.02 };
const LATER = ['export', 'clean', 'save'];
const FINAL = ['done', 'error'];

export function initial() {
  return {
    job: null, phase: 'idle', at0: null, at: null, n: 0,
    of: 0, pages: {}, sheets: {}, nSheets: 0, meta: {}, engine: [],
    cur: { s: 0, step: null, stepAt: null, sys: null },
    xml: [], fixes: [], done: null, error: null, phaseAt: {}, exported: [], // sheets the export read back
    paused: null, gap: 0, // the clocks stop at `paused` (a stored run reloaded, the host holding it); the break is left out
  };
}

// Clocks stopped from `when` (default: the last event) until the next event: a stored run just
// loaded (its last event may be hours old) or the host holding it (stuck, another tab reading).
// The time in between isn't reading time: the next event adds it to `gap`, which elapsed leaves out.
export function pause(st, when = null) {
  if (st.paused != null || st.at0 == null) return st;
  const at = Number.isFinite(when) ? Math.max(when, st.at ?? when) : st.at;
  return Number.isFinite(at) ? { ...st, paused: at } : st;
}

function sheetOf(st, s) {
  return st.sheets[s] || {
    s, page: null, state: 'wait', step: null, startAt: null, ms: null, reason: null, doneAt: null,
    systems: null, syms: {}, symN: 0, sysAt: {}, measures: {}, words: null, notes: {}, noteN: 0,
  };
}
const withSheet = (st, sh) => ({ ...st, sheets: { ...st.sheets, [sh.s]: sh } });
const reading = (ph) => (['idle', 'pages', 'engine'].includes(ph) ? 'read' : ph);

// (state, event) → state. Never mutates (but see reduceAll's `own`); unknown or malformed events only
// bump the count.
export function reduce(st, ev, own = null) {
  if (!ev || typeof ev !== 'object') return st;
  const at = Number.isFinite(ev.at) ? ev.at : st.at;
  st = { ...st, n: st.n + 1, at, at0: st.at0 ?? at };
  if (st.paused != null && Number.isFinite(ev.at)) st = { ...st, gap: (st.gap || 0) + Math.max(0, ev.at - st.paused), paused: null };
  switch (ev.t) {
    case 'job':
      return { ...st, job: { id: ev.id ?? null, name: ev.name ?? '', size: ev.size ?? null, resumed: !!ev.resumed } };
    case 'phase': {
      if (!ev.phase || !(ev.phase in PHASE_INFO)) return st;
      // 'done'/'error' are final: a late phase event never reopens them.
      if (FINAL.includes(st.phase) && !FINAL.includes(ev.phase)) return st;
      return { ...st, phase: ev.phase, phaseAt: { ...st.phaseAt, [ev.phase]: st.phaseAt[ev.phase] ?? at } };
    }
    case 'page': {
      if (!Number.isFinite(ev.page)) return st;
      const rec = {
        page: ev.page, of: ev.of, w: ev.w || null, h: ev.h || null, music: !!ev.music, blank: !!ev.blank,
        s: ev.music && Number.isFinite(ev.s) ? ev.s : null, preview: ev.preview || null,
        staves: Array.isArray(ev.staves) ? ev.staves : [],
      };
      const pages = { ...st.pages, [ev.page]: rec };
      const nSheets = Object.values(pages).filter((p) => p.music).length;
      let next = { ...st, pages, of: Math.max(st.of, ev.of || 0, ev.page), nSheets: Math.max(st.nSheets, nSheets) };
      if (st.phase === 'idle') next.phase = 'pages';
      if (rec.s) next = withSheet(next, { ...sheetOf(next, rec.s), page: ev.page });
      return next;
    }
    case 'meta': {
      const meta = { ...st.meta };
      if (ev.title) meta.title = String(ev.title);
      if (ev.tempo) meta.tempo = ev.tempo;
      return { ...st, meta };
    }
    case 'engine': {
      if (!ev.milestone) return st;
      const i = st.engine.findIndex((m) => m.milestone === ev.milestone);
      if (i < 0) return { ...st, engine: [...st.engine, { milestone: ev.milestone, detail: ev.detail, at }] };
      if (ev.detail === undefined || ev.detail === st.engine[i].detail) return st;
      const engine = st.engine.slice();
      engine[i] = { ...engine[i], detail: ev.detail };
      return { ...st, engine };
    }
    case 'sheet': {
      if (!Number.isFinite(ev.s)) return st;
      const sh = sheetOf(st, ev.s);
      const cur = { ...st.cur };
      let next;
      if (ev.state === 'start') {
        next = withSheet(st, { ...sh, state: 'read', startAt: sh.startAt ?? at });
        cur.s = ev.s; cur.step = null; cur.stepAt = at; cur.sys = null;
      } else if (ev.state === 'done' || ev.state === 'failed') {
        // (A sheet the engine gave up on is stored in the book too — 'done' after 'failed' — but
        // it wasn't read: it stays failed, with its reason.)
        if (ev.state === 'done' && sh.state === 'failed') return st;
        const ms = Number.isFinite(ev.ms) ? ev.ms : sh.startAt != null && at != null ? at - sh.startAt : null;
        next = withSheet(st, { ...sh, state: ev.state, ms, reason: ev.reason || null, doneAt: at });
        if (cur.s === ev.s) cur.sys = null;
      } else return st;
      return { ...next, cur, nSheets: Math.max(next.nSheets, ev.s), phase: reading(next.phase) };
    }
    case 'step': {
      if (!Number.isFinite(ev.s) || !ev.step) return st;
      const sh = sheetOf(st, ev.s);
      // A step on a sheet that never said 'start' starts it (older engines only log steps).
      const started = sh.state === 'wait' ? { state: 'read', startAt: at } : {};
      const next = withSheet(st, { ...sh, ...started, step: ev.step });
      return {
        ...next, cur: { s: ev.s, step: ev.step, stepAt: at, sys: null },
        nSheets: Math.max(next.nSheets, ev.s), phase: reading(next.phase),
      };
    }
    case 'grid': {
      if (!Number.isFinite(ev.s) || !Array.isArray(ev.systems)) return st;
      return withSheet(st, { ...sheetOf(st, ev.s), systems: ev.systems });
    }
    case 'sym': {
      if (!Number.isFinite(ev.s)) return st;
      const sh = sheetOf(st, ev.s);
      // A sheet's symbols: copied once per reduce — but in place while reduceAll owns the copy (a
      // stored run of 13 pages is ~1000 events: copying every sheet's map on each was 345 000 entries).
      let syms = sh.syms;
      if (!own?.has(syms)) { syms = { ...syms }; own?.add(syms); }
      let symN = sh.symN;
      for (const id of ev.del || []) if (id in syms) { delete syms[id]; symN--; }
      for (const a of ev.add || []) if (a && a.id != null) { if (!(a.id in syms)) symN++; syms[a.id] = { ...a, step: ev.step, sys: ev.sys ?? null }; }
      // The furthest system a step has reported: a step's epilog may report an earlier one again
      // (the real trace: LEDGERS ends with a removal on system 2), which isn't the engine going back.
      let sysAt = sh.sysAt;
      if (ev.step) {
        const idx = (id) => (sh.systems ? sh.systems.findIndex((x) => x.id === id) : -1);
        const prevSys = sh.sysAt[ev.step];
        if (prevSys === undefined || idx(ev.sys ?? null) >= idx(prevSys)) sysAt = { ...sh.sysAt, [ev.step]: ev.sys ?? null };
      }
      const next = withSheet(st, { ...sh, syms, symN, sysAt });
      return st.cur.s === ev.s ? { ...next, cur: { ...st.cur, sys: ev.sys ?? null } } : next;
    }
    case 'measures': {
      if (!Number.isFinite(ev.s)) return st;
      const sh = sheetOf(st, ev.s);
      return withSheet(st, { ...sh, measures: { ...sh.measures, [ev.sys ?? 0]: ev.xs || [] } });
    }
    case 'words': {
      if (!Number.isFinite(ev.s)) return st;
      return withSheet(st, { ...sheetOf(st, ev.s), words: Array.isArray(ev.words) ? ev.words : [] });
    }
    case 'notes': {
      if (!Number.isFinite(ev.s)) return st;
      const sh = sheetOf(st, ev.s);
      const notes = { ...sh.notes, [ev.sys ?? 0]: Array.isArray(ev.notes) ? ev.notes : [] };
      const noteN = Object.values(notes).reduce((a, l) => a + l.length, 0);
      const next = withSheet(st, { ...sh, notes, noteN });
      return st.cur.s === ev.s ? { ...next, cur: { ...st.cur, sys: ev.sys ?? null } } : next;
    }
    case 'export': {
      if (!Number.isFinite(ev.s) || st.exported.includes(ev.s)) return st;
      return { ...st, exported: [...st.exported, ev.s], phase: FINAL.includes(st.phase) ? st.phase : 'export' };
    }
    case 'xml':
      return typeof ev.text === 'string' && ev.text ? { ...st, xml: [...st.xml, ev.text] } : st;
    case 'fix':
      return ev.msg ? { ...st, fixes: [...st.fixes, String(ev.msg)] } : st;
    case 'done':
      return { ...st, phase: 'done', done: { songId: ev.songId ?? null, title: ev.title ?? null }, phaseAt: { ...st.phaseAt, done: st.phaseAt.done ?? at } };
    case 'error':
      if (st.phase === 'done') return st;
      return { ...st, phase: 'error', error: { message: ev.message || '', kind: ev.kind || null }, phaseAt: { ...st.phaseAt, error: at } };
    default:
      return st;
  }
}

export function reduceAll(events, st = initial()) {
  const own = new WeakSet(); // (the symbol maps this call made: changed in place, never shared before)
  for (const ev of events) st = reduce(st, ev, own);
  return st;
}

// --- selectors ---------------------------------------------------------------------------

export const pageList = (st) => Object.values(st.pages).sort((a, b) => a.page - b.page);
export const sheetList = (st) => Object.values(st.sheets).sort((a, b) => a.s - b.s);
export const currentSheet = (st) => (st.cur.s ? st.sheets[st.cur.s] || null : null);
export const firstMusicPage = (st) => pageList(st).find((p) => p.music)?.page ?? null;
export const pageOfSheet = (st, s) => st.sheets[s]?.page ?? pageList(st).find((p) => p.s === s)?.page ?? null;
export const currentPage = (st) => {
  const sh = currentSheet(st);
  if (sh?.page) return sh.page;
  if (st.phase === 'pages') return pageList(st).at(-1)?.page ?? null;
  return null;
};
export const stepLabel = (step) => STEP_INFO[step]?.[0] ?? (step ? step.toLowerCase() : '');
export const stepGlyph = (step) => STEP_INFO[step]?.[1] ?? '·';

// The page the Reader shows and how: 'paper' (the printed page: while pages are found, the engine
// starts, and a sheet's LOAD), 'engine' (black & white from BINARY on, the engine's view),
// 'done' (back on paper with the notes found). null before any page.
export function heroOf(st) {
  const pages = pageList(st);
  if (!pages.length) return null;
  const first = firstMusicPage(st) ?? pages[0].page;
  if (st.phase === 'done') return { page: first, s: st.pages[first]?.s ?? null, look: 'done' };
  // The export reads each sheet back from the book: the page it's on (its notes).
  const ex = st.exported.at(-1);
  if (ex && pageOfSheet(st, ex) && LATER.includes(st.phase)) return { page: pageOfSheet(st, ex), s: ex, look: 'engine' };
  if (st.phase === 'idle' || st.phase === 'pages') return { page: pages.at(-1).page, s: pages.at(-1).s, look: 'paper' };
  const sh = currentSheet(st);
  if (!sh || !sh.page) return { page: first, s: st.pages[first]?.s ?? null, look: 'paper' };
  const look = sh.state === 'read' && (!sh.step || sh.step === 'LOAD') ? 'paper' : 'engine';
  return { page: sh.page, s: sh.s, look };
}

// Where the engine is on sheet s: 'sys' (a per-system step on a known system, the one it works
// on now = the one after the last system it reported), 'page' (a sheet-wide step, or systems not
// known yet), or 'none' (not reading this sheet).
export function lensOf(st, s) {
  const sh = st.sheets[s];
  if (!sh || sh.state !== 'read' || st.phase !== 'read' || st.cur.s !== s || !sh.step) return { kind: 'none' };
  if (!PER_SYSTEM.has(sh.step) || !sh.systems?.length) return { kind: 'page' };
  const last = sh.sysAt[sh.step];
  let i = 0;
  if (last !== undefined) {
    i = sh.systems.findIndex((x) => x.id === last) + 1;
    if (i <= 0 || i >= sh.systems.length) return { kind: 'page' }; // past the last system: the step's epilog
  }
  return { kind: 'sys', sys: sh.systems[i].id, box: sh.systems[i].box, i, n: sh.systems.length };
}

// Interline (pixels between staff lines) of a sheet: from the engine's grid, else pdfprep's staves.
export function interlineOf(st, s, page) {
  const gaps = [];
  for (const sys of st.sheets[s]?.systems || []) {
    for (const f of sys.staves || []) {
      const ys = (f.lines || []).map((l) => (Array.isArray(l) ? l[0] : l));
      for (let i = 1; i < ys.length; i++) gaps.push(ys[i] - ys[i - 1]);
    }
  }
  if (!gaps.length) {
    for (const f of st.pages[page]?.staves || []) {
      const ys = f.y || [];
      for (let i = 1; i < ys.length; i++) gaps.push(ys[i] - ys[i - 1]);
    }
  }
  if (!gaps.length) return null;
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1];
}

// How far a sheet is, 0..1: the steps before the current one by their share, plus the current
// step's share × the systems it has finished (per-system steps report each). < 1 until done.
export function sheetFraction(st, s) {
  const sh = st.sheets[s];
  if (!sh) return 0;
  if (sh.state === 'done' || sh.state === 'failed') return 1;
  if (sh.state === 'wait' || !sh.step || !(sh.step in SHARE_BEFORE)) return 0;
  let f = SHARE_BEFORE[sh.step];
  const n = sh.systems?.length;
  const sys = sh.sysAt[sh.step];
  if (n && sys != null) {
    const i = sh.systems.findIndex((x) => x.id === sys);
    if (i >= 0) f += (STEP_SHARE[sh.step] / SHARE_SUM) * ((i + 1) / n);
  }
  return Math.min(0.99, f);
}

// Per PDF page: 'skip' (no music) | 'wait' | 'read' | 'done' | 'failed', and a 0..1 fraction.
export function pageProgress(st, page) {
  const p = st.pages[page];
  if (!p) return { state: 'wait', fraction: 0 };
  if (!p.music) return { state: 'skip', fraction: 1 };
  const sh = st.sheets[p.s];
  if (!sh || sh.state === 'wait') return { state: 'wait', fraction: 0 };
  return { state: sh.state, fraction: sheetFraction(st, p.s), reason: sh.reason || null };
}

export function counts(st) {
  const sheets = sheetList(st);
  return {
    pages: st.of, music: st.nSheets,
    done: sheets.filter((s) => s.state === 'done').length,
    failed: sheets.filter((s) => s.state === 'failed').length,
    syms: sheets.reduce((a, s) => a + s.symN, 0),
    words: sheets.reduce((a, s) => a + (s.words?.length || 0), 0),
    notes: sheets.reduce((a, s) => a + s.noteN, 0),
  };
}

// The whole import, 0..1 — monotonic over a run's events; 1 only when done.
export function progress(st) {
  if (st.phase === 'done') return 1;
  const P = PHASE_W;
  const seen = Object.keys(st.pages).length;
  const pages = st.of ? Math.min(1, seen / st.of) : 0;
  const engine = Math.min(1, st.engine.length / MILESTONES.length);
  const n = st.nSheets;
  let read = 0;
  if (n) {
    for (const sh of sheetList(st)) read += sheetFraction(st, sh.s);
    read = Math.min(1, read / n);
  }
  const ph = st.phase;
  let f = P.pages * pages;
  if (['engine', 'read', ...LATER].includes(ph) || st.engine.length || read) f = P.pages + P.engine * engine;
  if (read || ph === 'read' || LATER.includes(ph)) f = P.pages + P.engine + P.read * read;
  if (LATER.includes(ph)) {
    f = P.pages + P.engine + P.read;
    // (The export reads every sheet the engine read back from the book, then writes the file.)
    const toLoad = Math.max(1, n - sheetList(st).filter((x) => x.state === 'failed').length);
    f += ph === 'export' ? P.export * 0.9 * Math.min(1, st.exported.length / toLoad) : P.export;
    if (ph === 'save') f += P.finish * 0.5;
  }
  return Math.max(0, Math.min(0.995, f));
}

// Seconds left, from the finished sheets' times (null until one is done). The current sheet
// counts what's left of an average sheet, by its steps' shares and by its clock, whichever says
// more; the export after the last page costs about a third of a page.
export function eta(st, now) {
  const done = sheetList(st).filter((s) => s.state === 'done' && Number.isFinite(s.ms) && s.ms > 0);
  if (!done.length || FINAL.includes(st.phase)) return null;
  const avg = done.reduce((a, s) => a + s.ms, 0) / done.length / 1000;
  if (LATER.includes(st.phase)) return Math.max(3, avg * 0.15);
  const n = st.nSheets;
  const finished = sheetList(st).filter((s) => s.state === 'done' || s.state === 'failed').length;
  const cur = currentSheet(st);
  const live = cur && cur.state === 'read';
  let left = 0;
  if (live) {
    const byShare = avg * (1 - sheetFraction(st, cur.s));
    const byClock = cur.startAt != null && now != null ? avg - (now - cur.startAt) / 1000 : byShare;
    left = Math.max(0, byShare, byClock);
  }
  const after = Math.max(0, n - finished - (live ? 1 : 0));
  return Math.max(3, left + after * avg + avg * 0.35);
}

// Reading time: from the first event, less the breaks (a reload, another tab); stopped while paused.
export const elapsed = (st, now) => (st.at0 != null && now != null ? Math.max(0, ((st.paused ?? now) - st.at0 - (st.gap || 0)) / 1000) : 0);
export const stepElapsed = (st, now) => (st.cur.stepAt != null && now != null ? Math.max(0, ((st.paused ?? now) - st.cur.stepAt) / 1000) : 0);

// One line of facts for the host (debug, tests, aria): no prose.
export function status(st, now) {
  const page = currentPage(st);
  const sh = currentSheet(st);
  const step = st.phase === 'read' ? st.cur.step : null;
  const sysIdx = sh?.systems && st.cur.sys != null ? sh.systems.findIndex((x) => x.id === st.cur.sys) : -1;
  const c = counts(st);
  return {
    phase: st.phase, page, of: st.of, s: st.cur.s || null, sheets: st.nSheets,
    step, label: step ? stepLabel(step) : PHASE_INFO[st.phase]?.[0] ?? '',
    glyph: step ? stepGlyph(step) : PHASE_INFO[st.phase]?.[1] ?? '·',
    sys: sysIdx >= 0 ? sysIdx + 1 : null, systems: sh?.systems?.length ?? null,
    fraction: progress(st), eta: eta(st, now), elapsed: elapsed(st, now),
    done: c.done, failed: c.failed, resumed: !!st.job?.resumed,
  };
}

// Clock text: 0:42, 3:05, 1:02:03.
export function clock(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
// ETA text: "~4 min", "<1 min".
export const etaText = (sec) => (sec == null ? '' : sec < 60 ? '<1 min' : `~${Math.round(sec / 60)} min`);

// --- the code column: what the engine found, as text --------------------------------------

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// A note's MusicXML type from its duration in wholes ("3/8" → ['quarter', 1 dot]); null for
// tuplets and odd lengths (left out rather than guessed).
const TYPES = [[2, 'breve'], [1, 'whole'], [1 / 2, 'half'], [1 / 4, 'quarter'], [1 / 8, 'eighth'], [1 / 16, '16th'], [1 / 32, '32nd'], [1 / 64, '64th']];
export function noteType(dur) {
  const m = /^(\d+)\/(\d+)$/.exec(String(dur ?? ''));
  const v = m ? +m[1] / +m[2] : Number(dur);
  if (!Number.isFinite(v) || v <= 0) return null;
  for (const [d, name] of TYPES) {
    if (Math.abs(v - d) < 1e-9) return [name, 0];
    if (Math.abs(v - d * 1.5) < 1e-9) return [name, 1];
    if (Math.abs(v - d * 1.75) < 1e-9) return [name, 2];
  }
  return null;
}

// Measure numbers as the export writes them (Audiveris Score.getMeasureIdOffset): a note's `m` is
// its page's measure id; the score's number adds every earlier page's last measure id (a page the
// engine gave up on adds none). From the notes the engine reported — a page whose last bar holds no
// pitched note at all would count one short.
const MEASURE_ID = /^(\D*)(\d+)/;
export function lastMeasureOf(st, s) {
  let last = 0;
  for (const list of Object.values(st.sheets[s]?.notes || {})) {
    for (const n of list) { const m = MEASURE_ID.exec(String(n?.m ?? '')); if (m) last = Math.max(last, +m[2]); }
  }
  return last;
}
export function measureOffset(st, s) {
  let off = 0;
  for (const sh of sheetList(st)) if (sh.s < s) off += lastMeasureOf(st, sh.s);
  return off;
}
export function scoreMeasure(m, offset = 0) {
  const x = MEASURE_ID.exec(String(m ?? ''));
  return x ? `${x[1]}${offset + +x[2]}` : String(m ?? '');
}

// The notes of one system as MusicXML lines, in reading order: a <measure> line where the
// measure changes (numbered as the export will: `offset`, measureOffset), then one <note> per line
// (pitch, type, the syllable) — <chord/> for a note struck with the one before in its voice.
// Everything shown comes from the event; a field the engine didn't give is left out.
export function noteLines(notes, prevMeasure = null, { pretty = false, offset = 0 } = {}) {
  const out = [];
  let m = prevMeasure, last = null;
  const list = [...(notes || [])].sort((a, b) => (a.x ?? 0) - (b.x ?? 0) || (a.y ?? 0) - (b.y ?? 0));
  const ind = pretty ? '  ' : '';
  for (const n of list) {
    if (!n || !n.step) continue;
    if (n.m != null && n.m !== m) { out.push({ m: n.m, xml: `<measure number="${esc(scoreMeasure(n.m, offset))}">` }); m = n.m; last = null; }
    const chord = last && last.voice === n.voice && Math.abs((last.x ?? 0) - (n.x ?? 0)) <= 6;
    const alter = n.alter ? `<alter>${n.alter}</alter>` : '';
    const ty = noteType(n.dur);
    const pitch = `<pitch><step>${esc(n.step)}</step>${alter}<octave>${esc(n.oct ?? '')}</octave></pitch>`;
    const type = ty ? `<type>${ty[0]}</type>${'<dot/>'.repeat(ty[1])}` : '';
    const syl = n.syl ? `<lyric><text>${esc(n.syl)}</text></lyric>` : '';
    if (!pretty) {
      out.push({ note: n, xml: `<note>${chord ? '<chord/>' : ''}${pitch}${type}${syl}</note>` });
    } else {
      out.push({ note: n, xml: `${ind}<note>` });
      for (const part of [chord ? '<chord/>' : '', pitch, type, syl]) if (part) out.push({ note: n, xml: `${ind}  ${part}` });
      out.push({ note: n, xml: `${ind}</note>` });
    }
    last = n;
  }
  return out;
}

// A symbol the engine found, as a line of its own sheet XML (Audiveris's sheet#N.xml element
// names), at its centre: <head x="812" y="1290"/>.
const SYM_TAG = {
  head: 'head', stem: 'stem', beam: 'beam', ledger: 'ledger', rest: 'rest', clef: 'clef', key: 'key',
  time: 'time', bar: 'barline', slur: 'slur', tie: 'slur', acc: 'alter', flag: 'flag', dot: 'augmentation-dot',
  word: 'word', lyric: 'lyric-item', other: 'inter',
};
const SYM_ATTR = { clef: 'shape', key: 'fifths', time: 'value', word: 'value', lyric: 'value', acc: 'shape', rest: 'shape', flag: 'shape', other: 'shape', head: 'shape', bar: 'shape' };
export function symLine(sym) {
  const tag = SYM_TAG[sym.k] || 'inter';
  const cx = Math.round((sym.x ?? 0) + (sym.w ?? 0) / 2), cy = Math.round((sym.y ?? 0) + (sym.h ?? 0) / 2);
  let extra = sym.k === 'tie' ? ' tie="true"' : '';
  const v = typeof sym.v === 'string' || typeof sym.v === 'number' ? String(sym.v).trim() : '';
  const hp = sym.k === 'head' ? /^([A-Z_]+)\s+(-?\d+)$/.exec(v) : null; // the trace's "NOTEHEAD_BLACK -4": shape, staff pitch
  if (hp) extra += ` shape="${esc(hp[1])}" pitch="${hp[2]}"`;
  else if ((v && v.length <= 24 && !/^[-\d.\s]+$/.test(v)) || (v && sym.k === 'key')) extra += ` ${SYM_ATTR[sym.k] || 'v'}="${esc(v)}"`;
  return `<${tag} x="${cx}" y="${cy}"${extra}/>`;
}

export const wordLine = (w) => `<word value="${esc(w.text ?? '')}"/>`;

// The PDF's own title and tempo, as the MusicXML that will carry them.
export function metaLines(meta) {
  const out = [];
  if (meta?.title) out.push(`<work-title>${esc(meta.title)}</work-title>`);
  const t = meta?.tempo;
  if (t?.bpm) {
    out.push(t.unit
      ? `<metronome><beat-unit>${esc(t.unit)}</beat-unit>${t.dotted ? '<beat-unit-dot/>' : ''}<per-minute>${esc(t.bpm)}</per-minute></metronome>`
      : `<sound tempo="${esc(t.bpm)}"/>`);
  }
  return out;
}

// The file name without its extension and seller's tail, for a title before the PDF's own.
export function nameTitle(name) {
  return String(name || '').replace(/\.pdf$/i, '').replace(/_+/g, ' ').replace(/\s+-\s+[A-G][b#♭♯]?\s*(major|minor)\b.*$|\s*-?\s*\bMN\d{5,}\b.*$/i, '').trim();
}
