// The PDF → Song event contract (readerstate.js header; normative), as a checker: every event the
// importer produces must pass, and the Reader reads nothing else. Returns a list of problems.
//   import { checkEvent, checkStream } from './importcontract.mjs';
const PHASES = ['pages', 'engine', 'read', 'export', 'clean', 'save', 'done', 'error'];
const MILESTONES = ['fetch', 'jvm', 'start', 'font', 'book'];
const STEPS = ['LOAD', 'BINARY', 'SCALE', 'GRID', 'HEADERS', 'STEM_SEEDS', 'BEAMS', 'LEDGERS', 'HEADS',
  'STEMS', 'REDUCTION', 'CUE_BEAMS', 'TEXTS', 'MEASURES', 'CHORDS', 'CURVES', 'SYMBOLS', 'LINKS', 'RHYTHMS', 'PAGE'];
const KINDS = ['head', 'stem', 'beam', 'ledger', 'rest', 'clef', 'key', 'time', 'bar', 'slur', 'tie', 'acc', 'flag', 'dot', 'word', 'lyric', 'other'];
const n = (x) => typeof x === 'number' && Number.isFinite(x);
const int = (x) => Number.isInteger(x);
const pos = (x) => int(x) && x >= 1;
const str = (x) => typeof x === 'string';
// Fields each type may carry (beyond t and at); anything else is reported.
const FIELDS = {
  job: ['id', 'name', 'size', 'resumed'], phase: ['phase'],
  page: ['page', 'of', 'w', 'h', 'music', 'blank', 's', 'preview', 'staves'], meta: ['title', 'tempo'],
  engine: ['milestone', 'detail'], sheet: ['s', 'state', 'reason', 'ms', 'step'], step: ['s', 'step'],
  grid: ['s', 'systems'], sym: ['s', 'step', 'sys', 'add', 'del'], measures: ['s', 'sys', 'xs'],
  words: ['s', 'words'], notes: ['s', 'sys', 'notes'], export: ['s'], xml: ['text'], fix: ['msg'],
  done: ['songId', 'title'], error: ['message', 'kind'],
};

export function checkEvent(ev) {
  const bad = [];
  const need = (c, what) => { if (!c) bad.push(what); };
  if (!ev || typeof ev !== 'object' || !(ev.t in FIELDS)) return [`unknown event ${JSON.stringify(ev)?.slice(0, 80)}`];
  for (const k of Object.keys(ev)) if (k !== 't' && k !== 'at' && !FIELDS[ev.t].includes(k)) bad.push(`extra field ${k}`);
  if ('at' in ev) need(n(ev.at), 'at');
  switch (ev.t) {
    case 'job': need(str(ev.id) && ev.id && str(ev.name) && typeof ev.resumed === 'boolean' && (ev.size == null || n(ev.size)), 'job id/name/size/resumed'); break;
    case 'phase': need(PHASES.includes(ev.phase), `phase ${ev.phase}`); break;
    case 'page':
      need(pos(ev.page) && pos(ev.of) && ev.page <= ev.of, 'page/of');
      need(pos(ev.w) && pos(ev.h), 'w/h');
      need(typeof ev.music === 'boolean' && typeof ev.blank === 'boolean', 'music/blank');
      need(ev.music ? pos(ev.s) : ev.s === undefined, 's only and always on a music page');
      need(ev.preview === null || (typeof Blob !== 'undefined' && ev.preview instanceof Blob) || (str(ev.preview) && ev.preview.length > 0), 'preview Blob|null');
      need(Array.isArray(ev.staves) && ev.staves.every((f) => n(f.x0) && n(f.x1) && f.x1 > f.x0 && Array.isArray(f.y) && f.y.length === 5 && f.y.every(n)), 'staves [{x0,x1,y[5]}]');
      need(!ev.music || ev.staves.length >= 1, 'a music page has staves');
      break;
    case 'meta':
      need(ev.title === undefined || (str(ev.title) && ev.title), 'title');
      need(ev.tempo === undefined || (ev.tempo && n(ev.tempo.bpm)), 'tempo.bpm');
      need(ev.title !== undefined || ev.tempo !== undefined, 'meta carries something');
      break;
    case 'engine': need(MILESTONES.includes(ev.milestone), `milestone ${ev.milestone}`); break;
    case 'sheet':
      need(pos(ev.s) && ['start', 'done', 'failed'].includes(ev.state), 'sheet s/state');
      need(ev.ms === undefined || (n(ev.ms) && ev.ms >= 0), 'ms');
      need(ev.state === 'failed' || ev.reason === undefined, 'reason only on failed');
      break;
    case 'step': need(pos(ev.s) && STEPS.includes(ev.step), `step ${ev.step}`); break;
    case 'grid':
      need(pos(ev.s) && Array.isArray(ev.systems) && ev.systems.length > 0, 'grid systems');
      for (const y of ev.systems || []) {
        need(int(y.id) && Array.isArray(y.box) && y.box.length === 4 && y.box.every(n) && y.box[2] > y.box[0] && y.box[3] > y.box[1], 'system id/box');
        for (const f of y.staves || []) need(int(f.id) && n(f.x0) && n(f.x1) && Array.isArray(f.lines) && f.lines.length === 5 && f.lines.every((l) => l.length === 2 && l.every(n)), 'staff id/x0/x1/lines[5][2]');
        need(Array.isArray(y.staves) && y.staves.length > 0, 'a system has staves');
      }
      break;
    case 'sym':
      need(pos(ev.s) && STEPS.includes(ev.step) && int(ev.sys), 'sym s/step/sys');
      need(Array.isArray(ev.add) && Array.isArray(ev.del), 'add/del arrays');
      for (const a of ev.add || []) need(int(a.id) && KINDS.includes(a.k) && [a.x, a.y, a.w, a.h].every(n) && a.w >= 0 && a.h >= 0 && (a.v === undefined || str(a.v)), `sym add ${JSON.stringify(a)}`);
      for (const d of ev.del || []) need(int(d), 'del id');
      break;
    case 'measures': need(pos(ev.s) && int(ev.sys) && Array.isArray(ev.xs) && ev.xs.every(n) && ev.xs.every((x, i) => i === 0 || x >= ev.xs[i - 1]), 'measures xs ascending'); break;
    case 'words':
      need(pos(ev.s) && Array.isArray(ev.words), 'words');
      for (const w of ev.words || []) need([w.x, w.y, w.w, w.h].every(n) && str(w.text) && w.text, `word ${JSON.stringify(w)}`);
      break;
    case 'notes':
      need(pos(ev.s) && int(ev.sys) && Array.isArray(ev.notes), 'notes');
      for (const x of ev.notes || []) {
        need(x.m != null && n(x.x) && n(x.y) && /^[A-G]$/.test(x.step) && int(x.alter) && int(x.oct) && str(x.dur) && /^\d+(\/\d+)?$/.test(x.dur), `note ${JSON.stringify(x)}`);
        need(x.voice === null || int(x.voice), 'voice');
        need(x.syl === undefined || (str(x.syl) && x.syl), 'syl');
      }
      break;
    case 'export': need(pos(ev.s), 'export s'); break;
    case 'xml': need(str(ev.text) && ev.text.length > 0, 'xml text'); break;
    case 'fix': need(str(ev.msg) && ev.msg.length > 0, 'fix msg'); break;
    case 'done': need((ev.songId === null || str(ev.songId)) && str(ev.title), 'done songId/title'); break;
    case 'error': need(str(ev.message) && ev.message.length > 0, 'error message'); break;
  }
  return bad;
}

// Order rules over a whole run: job first; pages before the engine; a sheet's events between its
// start and its end; done/error last; at never goes back.
export function checkStream(events) {
  const bad = [];
  const evs = events.map((e) => (e && e.ev ? { ...e.ev, at: e.at } : e));
  evs.forEach((ev, i) => { for (const b of checkEvent(ev)) bad.push(`#${i} ${ev?.t}: ${b}`); });
  if (evs[0]?.t !== 'job') bad.push('the first event is not job');
  const fin = evs.findIndex((e) => e.t === 'done' || e.t === 'error');
  // (after done/error only that same phase may follow)
  if (fin >= 0 && evs.slice(fin + 1).some((e) => !(e.t === 'phase' && e.phase === evs[fin].t))) bad.push(`events after ${evs[fin].t} (#${fin} of ${evs.length})`);
  let at = -Infinity;
  evs.forEach((e, i) => { if (n(e.at)) { if (e.at < at) bad.push(`#${i} at goes back`); at = e.at; } });
  const open = new Set(), closed = new Set(), failed = new Set();
  let exporting = false;
  evs.forEach((e, i) => {
    if (e.t === 'phase') exporting = e.phase === 'export' || (exporting && ['clean', 'save'].includes(e.phase));
    if (e.t === 'sheet' && e.state === 'start') { open.add(e.s); closed.delete(e.s); failed.delete(e.s); }
    else if (e.t === 'sheet') {
      // (a sheet the engine gave up on isn't then reported read: it stays failed)
      if (e.state === 'done' && failed.has(e.s)) bad.push(`#${i} sheet ${e.s} done after it failed`);
      if (e.state === 'failed') failed.add(e.s);
      open.delete(e.s); closed.add(e.s);
    }
    // (during the export: a system's notes again, less the measures the export couldn't write)
    else if (e.t === 'notes' && exporting && closed.has(e.s)) {}
    else if (['step', 'grid', 'sym', 'measures', 'words', 'notes'].includes(e.t) && !open.has(e.s)) bad.push(`#${i} ${e.t} on sheet ${e.s} outside its start…end`);
    if (e.t === 'export' && !exporting) bad.push(`#${i} export before phase export`);
  });
  const music = evs.filter((e) => e.t === 'page' && e.music).map((e) => e.s);
  if (music.some((s, i) => s !== i + 1)) bad.push(`music pages' s not 1..n (${music})`);
  return bad;
}

// CLI: node importcontract.mjs [events.json …] — every recorded real run by default.
if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import('node:fs');
  const files = process.argv.slice(2);
  if (!files.length) {
    for (const f of fs.readdirSync(new URL('fixtures/import', import.meta.url))) if (f.endsWith('.events.json')) files.push(new URL(`fixtures/import/${f}`, import.meta.url).pathname);
    for (const d of fs.readdirSync(new URL('fixtures/reader', import.meta.url))) {
      const f = new URL(`fixtures/reader/${d}/events.json`, import.meta.url).pathname;
      if (fs.existsSync(f) && JSON.parse(fs.readFileSync(f, 'utf8')).real) files.push(f);
    }
  }
  let bad = 0;
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const b = checkStream(Array.isArray(j) ? j : j.events);
    console.log(`${b.length ? 'FAIL' : 'ok  '} ${f}: ${(Array.isArray(j) ? j : j.events).length} events${b.length ? ' — ' + b.slice(0, 5).join(' | ') : ''}`);
    bad += b.length ? 1 : 0;
  }
  // The checker itself: it catches what it should.
  const probes = [
    [{ t: 'page', page: 1, of: 1, w: 10, h: 10, music: true, blank: false, preview: null, staves: [] }, 'a music page without staves or s'],
    [{ t: 'sym', s: 1, step: 'HEADS', sys: 1, add: [{ id: 1, k: 'blob', x: 0, y: 0, w: 1, h: 1 }], del: [] }, 'an unknown symbol kind'],
    [{ t: 'notes', s: 1, sys: 1, notes: [{ m: 1, x: 0, y: 0, step: 'H', alter: 0, oct: 4, dur: '1/4', voice: 1 }] }, 'a pitch letter H'],
    [{ t: 'step', s: 1, step: 'LOAD', extra: 1 }, 'an extra field'],
    [{ t: 'export', s: 0 }, 'an export of sheet 0'],
  ];
  // Order: a failed sheet reported done afterwards; an export event outside the export.
  for (const [evs, what] of [
    [[{ t: 'job', id: 'j', name: 'x', resumed: false }, { t: 'sheet', s: 1, state: 'start' }, { t: 'sheet', s: 1, state: 'failed', reason: 'r', step: 'SCALE' }, { t: 'sheet', s: 1, state: 'done', ms: 5 }], 'a failed sheet then done'],
    [[{ t: 'job', id: 'j', name: 'x', resumed: false }, { t: 'export', s: 1 }], 'an export event before phase export'],
  ]) {
    const caught = checkStream(evs).length > 0;
    console.log(`${caught ? 'ok  ' : 'FAIL'} the checker refuses ${what}`);
    bad += caught ? 0 : 1;
  }
  for (const [ev, what] of probes) {
    const caught = checkEvent(ev).length > 0;
    console.log(`${caught ? 'ok  ' : 'FAIL'} the checker refuses ${what}`);
    bad += caught ? 0 : 1;
  }
  process.exit(bad ? 1 : 0);
}
