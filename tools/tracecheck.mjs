#!/usr/bin/env node
// tracecheck.mjs — check a WebTrace stream (engine patch 0009, -Daudiveris.web.trace=stderr) and
// map it to the Reader's event contract.
//
//   node tracecheck.mjs <trace.log> [score.mxl|.musicxml] [--events out.json] [--per-page S] [--quiet]
//
// 1. Grammar: every line of every block is one the format allows (omr-build/README.md "0009"); a '-'
//    removes an id sent before on that system; a '+' for a known id only when its kind changed;
//    blocks arrive in order (B before E, sheets stored once). Other stderr lines are ignored.
// 2. With the exported MusicXML: the trace's notes after PAGE (N blocks) against the export — the
//    pitch multiset (step+alter+octave) of every pitched head; chords with no time slot (t "-")
//    are left out, as the export leaves them out.
// 3. --events: writes { name, events: [{ at, ev }] } in the Reader's contract (step, sheet, grid,
//    sym, measures, notes, engine 'book'); 'at' = the engine's own step times (E lines) spread over
//    each step's systems, scaled so a page takes --per-page seconds (default: as measured).
// Exit code 1 on any grammar error or note mismatch.
import fs from 'node:fs';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
const flag = (k) => { const i = args.indexOf(k); if (i >= 0) { args.splice(i, 1); return true; } return false; };
const eventsOut = opt('--events'), perPage = opt('--per-page'), quiet = flag('--quiet');
const [tracePath, xmlPath] = args;
if (!tracePath) { console.error('usage: tracecheck.mjs <trace.log> [score.mxl] [--events out.json] [--per-page S]'); process.exit(2); }

const STEPS = ['LOAD', 'BINARY', 'SCALE', 'GRID', 'HEADERS', 'STEM_SEEDS', 'BEAMS', 'LEDGERS', 'HEADS', 'STEMS',
  'REDUCTION', 'CUE_BEAMS', 'TEXTS', 'MEASURES', 'CHORDS', 'CURVES', 'SYMBOLS', 'LINKS', 'RHYTHMS', 'PAGE'];
const KINDS = new Set(['head', 'stem', 'beam', 'ledger', 'rest', 'clef', 'key', 'time', 'bar', 'slur', 'tie', 'acc',
  'flag', 'dot', 'word', 'lyric', 'other']);
const HEADER = /^([KBEGYNSF]) /;
const TRACE = /^([KBEGYNSF] [0-9]|[difymnr] |[+-][0-9])/;
const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

// ---- read blocks -----------------------------------------------------------------------------
const lines = fs.readFileSync(tracePath, 'utf8').split('\n').filter((l) => TRACE.test(l));
const blocks = [];
for (const l of lines) {
  if (HEADER.test(l)) blocks.push({ head: l, recs: [] });
  else if (blocks.length) blocks[blocks.length - 1].recs.push(l);
  else err(`record before any header: ${l}`);
}

let errors = 0;
function err(m) { errors++; if (errors <= 40) console.log('ERROR ' + m); }

// ---- grammar + state -------------------------------------------------------------------------
const sheets = new Map(); // s -> { steps: [{step, ms, systems}], stored, failed, sym: Map(sys -> Map(id -> rec)), notes: [], grid }
let book = null, cur = null;
const sheet = (s) => { if (!sheets.has(s)) sheets.set(s, { steps: [], stored: null, failed: null, sym: new Map(), notes: [], grid: null, ys: [] }); return sheets.get(s); };
const num = (x) => /^-?\d+$/.test(x);
const events = []; // { ev, s, step, unit } — timing filled later

for (const b of blocks) {
  const h = b.head.split(' ');
  const t = h[0];
  if (t === 'K') {
    if (h.length !== 4 || !num(h[1])) err(`bad K: ${b.head}`);
    const list = (x) => (x === '-' ? [] : x.split(',').map(Number));
    book = { n: +h[1], done: list(h[2]), invalid: list(h[3]) };
    events.push({ ev: { t: 'engine', milestone: 'book', detail: book } });
    continue;
  }
  const s = +h[1];
  if (!num(h[1])) { err(`bad sheet in ${b.head}`); continue; }
  const sh = sheet(s);
  if (t === 'B') {
    if (h.length !== 3 || !STEPS.includes(h[2])) err(`bad B: ${b.head}`);
    if (cur && cur.s === s && !cur.done) err(`B before E of ${cur.step}: ${b.head}`);
    if (h[2] === 'LOAD') { sh.sym.clear(); events.push({ ev: { t: 'sheet', s, state: 'start' }, s }); }
    cur = { s, step: h[2], done: false, systems: 0 };
    sh.steps.push(cur);
    events.push({ ev: { t: 'step', s, step: h[2] }, s, step: h[2] });
  } else if (t === 'E') {
    if (h.length !== 4 || !num(h[3]) || !cur || cur.s !== s || cur.step !== h[2]) err(`bad/unmatched E: ${b.head}`);
    else { cur.done = true; cur.ms = +h[3]; }
    for (const r of b.recs) {
      const f = r.split(' ');
      if (f[0] === 'd' && f.length === 3 && h[2] === 'LOAD') sh.size = [+f[1], +f[2]];
      else if (f[0] === 'i' && f.length === 2 && h[2] === 'SCALE') sh.interline = +f[1];
      else err(`bad E record: ${r}`);
    }
  } else if (t === 'G') {
    if (+h[2] !== b.recs.filter((r) => r.startsWith('y ')).length) err(`G system count: ${b.head}`);
    const systems = [];
    for (const r of b.recs) {
      const f = r.split(' ').map((x, i) => (i ? +x : x));
      if (f[0] === 'y' && f.length === 6) systems.push({ id: f[1], box: f.slice(2), staves: [] });
      else if (f[0] === 'f' && f.length >= 6 && (f.length - 6) % 2 === 0) {
        const sys = systems.find((y) => y.id === f[1]);
        if (!sys) { err(`staff before its system: ${r}`); continue; }
        const ls = [];
        for (let i = 6; i < f.length; i += 2) ls.push([f[i], f[i + 1]]);
        if (ls.length !== 5) err(`staff with ${ls.length} lines: ${r}`);
        sys.staves.push({ id: f[2], part: f[3], x0: f[4], x1: f[5], lines: ls });
      } else err(`bad G record: ${r}`);
    }
    sh.grid = systems;
    events.push({ ev: { t: 'grid', s, systems }, s, step: 'GRID' });
  } else if (t === 'Y') {
    if (h.length !== 4 || !STEPS.includes(h[2]) || !num(h[3])) { err(`bad Y: ${b.head}`); continue; }
    const sys = +h[3];
    if (!sh.sym.has(sys)) sh.sym.set(sys, new Map());
    const known = sh.sym.get(sys);
    const add = [], del = [];
    let xs = null;
    for (const r of b.recs) {
      if (r[0] === '+') {
        const f = r.slice(1).split(' ');
        if (f.length < 6 || !KINDS.has(f[1]) || !f.slice(2, 6).every(num)) { err(`bad +: ${r}`); continue; }
        const id = +f[0];
        if (known.has(id) && known.get(id).k === f[1]) err(`re-add of same kind: ${r} (${b.head})`);
        const rec = { id, k: f[1], x: +f[2], y: +f[3], w: +f[4], h: +f[5] };
        if (f.length > 6) rec.v = f.slice(6).map(dec).join(' ');
        known.set(id, rec);
        add.push(rec);
      } else if (r[0] === '-') {
        const id = +r.slice(1);
        if (!known.delete(id)) err(`removal of unknown id: ${r} (${b.head})`);
        del.push(id);
      } else if (r.startsWith('m ')) {
        if (h[2] !== 'MEASURES') err(`m outside MEASURES: ${b.head}`);
        xs = r.split(' ').slice(1).map(Number);
        if (xs.some((x, i) => i && x < xs[i - 1])) err(`measure xs not increasing: ${r}`);
      } else err(`bad Y record: ${r}`);
    }
    if (cur && cur.s === s && cur.step === h[2] && !cur.done) cur.systems++;
    events.push({ ev: { t: 'sym', s, step: h[2], sys, add, del }, s, step: h[2], unit: true });
    if (xs) events.push({ ev: { t: 'measures', s, sys, xs }, s, step: h[2] });
  } else if (t === 'N') {
    const sys = +h[2];
    const notes = [];
    for (const r of b.recs) {
      const f = r.split(' ');
      if (!/^[nr]$/.test(f[0]) || f.length < 7) { err(`bad N record: ${r}`); continue; }
      const [kind, chord, m, staff, voice, tt, dur] = f;
      if (!/^(-|\d+\/\d+)$/.test(tt) || !/^(-|g|M|\d+\/\d+)$/.test(dur)) err(`bad t/dur: ${r}`);
      if (kind === 'r') { if (f.length > 8) err(`bad rest: ${r}`); continue; }
      const heads = [], lyr = [];
      for (const x of f.slice(7)) {
        if (x[0] === 'L') {
          const [v, syl, ...txt] = x.slice(1).split(',');
          if (!num(v) || !/^[sbme]$/.test(syl)) err(`bad lyric: ${x}`);
          lyr.push({ v: +v, syl, text: dec(txt.join(',')) });
        } else {
          const p = x.split(',');
          if (p.length < 6 || p.length > 7 || !/^([A-G]|-)$/.test(p[3]) || !num(p[4]) || !num(p[5])) { err(`bad head: ${x}`); continue; }
          if (p.length === 7 && !/^(s|e|se)$/.test(p[6])) err(`bad ties: ${x}`);
          heads.push({ id: +p[0], x: +p[1], y: +p[2], step: p[3], alter: +p[4], oct: +p[5], ties: p[6] || '' });
        }
      }
      const syl = lyr.find((l) => l.v === 1) || lyr[0];
      heads.forEach((hd, i) => {
        sh.notes.push({ sys, chord: +chord, m, staff: +staff, voice, t: tt, dur, ...hd });
        if (hd.step === '-' || tt === '-') return; // unpitched, or no time slot: not exported
        const n = { m, x: hd.x, y: hd.y, step: hd.step, alter: hd.alter, oct: hd.oct, dur, voice: voice === '-' ? null : +voice };
        if (i === 0 && syl) n.syl = syl.text;
        notes.push(n);
      });
    }
    events.push({ ev: { t: 'notes', s, sys, notes }, s, step: 'PAGE' });
  } else if (t === 'S') {
    if (sh.stored) err(`sheet stored twice: ${b.head}`);
    sh.stored = { ms: h[2] ? +h[2] : null };
    events.push({ ev: { t: 'sheet', s, state: 'done', ms: sh.stored.ms }, s });
  } else if (t === 'F') {
    sh.failed = { step: h[2], reason: dec(h.slice(3).join(' ')) };
    events.push({ ev: { t: 'sheet', s, state: 'failed', reason: sh.failed.reason }, s });
  }
}
if (!book) err('no K line');

// ---- summary ---------------------------------------------------------------------------------
let totalNotes = 0;
for (const [s, sh] of [...sheets].sort((a, b) => a[0] - b[0])) {
  const kinds = {};
  for (const m of sh.sym.values()) for (const r of m.values()) kinds[r.k] = (kinds[r.k] || 0) + 1;
  const ms = sh.steps.reduce((a, st) => a + (st.ms || 0), 0);
  totalNotes += sh.notes.filter((n) => n.step !== '-').length;
  if (!quiet) {
    console.log(`sheet ${s}: ${sh.steps.length} steps ${ms} ms, ${sh.grid ? sh.grid.length : 0} systems, ` +
      `final symbols ${Object.entries(kinds).map(([k, v]) => k + ' ' + v).join(', ')}; ` +
      `${sh.notes.length} heads after PAGE${sh.stored ? ', stored' : ''}${sh.failed ? ', FAILED at ' + sh.failed.step : ''}`);
  }
}

// ---- notes vs MusicXML -----------------------------------------------------------------------
if (xmlPath) {
  let xml = fs.readFileSync(xmlPath);
  if (xml[0] === 0x50 && xml[1] === 0x4b) xml = unzipFirstXml(xml);
  xml = xml.toString('utf8');
  const exp = [];
  for (const m of xml.matchAll(/<note\b[^>]*>([\s\S]*?)<\/note>/g)) {
    const p = /<pitch>([\s\S]*?)<\/pitch>/.exec(m[1]);
    if (!p) continue;
    const step = /<step>(\w)<\/step>/.exec(p[1])[1];
    const alter = +((/<alter>(-?[\d.]+)<\/alter>/.exec(p[1]) || [0, 0])[1]);
    const oct = +/<octave>(\d+)<\/octave>/.exec(p[1])[1];
    exp.push(`${step}${alter}/${oct}`);
  }
  const got = [];
  let noSlot = 0;
  for (const sh of sheets.values()) for (const n of sh.notes) {
    if (n.step === '-') continue;
    if (n.t === '-') { noSlot++; continue; } // no time slot: the export leaves the chord out
    got.push(`${n.step}${n.alter}/${n.oct}`);
  }
  const count = (a) => a.reduce((m, k) => m.set(k, (m.get(k) || 0) + 1), new Map());
  const ce = count(exp), cg = count(got);
  const diffs = [];
  for (const k of new Set([...ce.keys(), ...cg.keys()])) if ((ce.get(k) || 0) !== (cg.get(k) || 0)) diffs.push(`${k}: trace ${cg.get(k) || 0} export ${ce.get(k) || 0}`);
  const same = diffs.length === 0;
  console.log(`notes: trace ${got.length} pitched heads (+${noSlot} without a time slot), export ${exp.length} pitched notes — pitch multiset ${same ? 'SAME' : 'DIFFERS'}`);
  if (!same) { console.log('  ' + diffs.slice(0, 12).join('\n  ')); errors++; }
}

// ---- events ----------------------------------------------------------------------------------
if (eventsOut) {
  // Spread each step's measured ms over its system blocks; whole-sheet events at the step's end.
  let at = 0;
  const stepMs = new Map();
  for (const [s, sh] of sheets) for (const st of sh.steps) stepMs.set(`${s}:${st.step}:${sh.steps.indexOf(st)}`, st);
  const scale = perPage ? (() => {
    const pages = [...sheets.values()].filter((sh) => sh.steps.length);
    const total = pages.reduce((a, sh) => a + sh.steps.reduce((b, st) => b + (st.ms || 0), 0), 0);
    return total ? (perPage * 1000 * pages.length) / total : 1;
  })() : 1;
  const out = [];
  let step = null, unitMs = 0;
  const idx = new Map();
  for (const e of events) {
    if (e.ev.t === 'step') {
      const sh = sheets.get(e.s);
      const i = idx.get(e.s) || 0; idx.set(e.s, i + 1);
      step = sh.steps[i];
      unitMs = ((step.ms || 0) * scale) / Math.max(1, step.systems);
    }
    out.push({ at: Math.round(at), ev: e.ev });
    if (e.unit && step && e.step === step.step) at += unitMs;
    else if (e.ev.t === 'step' && step && !step.systems) at += (step.ms || 0) * scale;
  }
  fs.writeFileSync(eventsOut, JSON.stringify({ name: tracePath.split('/').slice(-2).join('/'), events: out }));
  console.log(`events: ${out.length} → ${eventsOut} (${Math.round(at / 1000)} s)`);
}

console.log(errors ? `FAIL ${errors} error(s)` : `OK ${blocks.length} blocks, ${lines.length} lines, ${totalNotes} pitched heads`);
process.exit(errors ? 1 : 0);

function unzipFirstXml(buf) {
  // Minimal zip reader: the first entry ending in .xml that isn't META-INF/container.xml
  let p = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const n = buf.readUInt16LE(p + 10);
  let c = buf.readUInt32LE(p + 16);
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(c + 10), size = buf.readUInt32LE(c + 20);
    const nl = buf.readUInt16LE(c + 28), xl = buf.readUInt16LE(c + 30), cl = buf.readUInt16LE(c + 32);
    const off = buf.readUInt32LE(c + 42);
    const name = buf.slice(c + 46, c + 46 + nl).toString();
    c += 46 + nl + xl + cl;
    if (!/\.xml$/.test(name) || name.startsWith('META-INF')) continue;
    const ln = buf.readUInt16LE(off + 26), lx = buf.readUInt16LE(off + 28);
    const data = buf.slice(off + 30 + ln + lx, off + 30 + ln + lx + size);
    return method === 8 ? zlib.inflateRawSync(data) : data;
  }
  throw new Error('no xml in zip');
}
