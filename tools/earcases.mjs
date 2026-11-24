// Ear's judgments (public/ear.js; docs/EAR.md; the Ear fix plan's WP2–WP4) on synthetic singers, in node — the
// page's own code from the mic onwards:
//   Line  (● Sing on your own time): the plan sung as the page's mic would hear it (rhythmsynth.mjs) → pitch.js
//         frames (rhythmharness.mjs) → ear.js judgeFree, as sing.js earDone calls it.
//   Beats (● Sing with the click): the guided take as startSing(part) runs it on the phrase — its count-in and
//         the click guide in the recording (a phone speaker: findClicks measures the trip; rig: { clickLevel: 0 }
//         headphones), the singer on what they hear → frames, gradeTake, Sing's own rhythmOf (takerhythm.js, a
//         guided span, as guidedverdicts.mjs) → ear.js judgeBeats.
// The plans are tools/lib/earsinger.cjs's — the browser probe's singer (earprobe.cjs): the same fields (indices in
// the phrase), the same segments(); scoop is the browser's only (rhythmsynth scoops every syllable a little). Every
// case is sung once more, the frames half a frame later and other room noise: the same singing must get the same
// answer.
// Each case names the work package that makes it so (DONE: those landed; "WP0": today's code already gets it
// right — a guard): a case whose package hasn't landed is run and printed as "todo", not judged, and says so
// when it already passes. WP2–WP4 turn theirs on (WP4 adds Notes' holds). The lines are the fix plan's (Q-A: the
// printed lines, PLAN_PHRASE), compared with the page's own (ear.js EAR_PHRASE) as a WP1 case.
// usage: node earcases.mjs   (V=1: each case's notes; ONLY=<regex>: some cases; TODO=0: hide the todo lines;
//   JOBS=n: cases sung on n threads, default 3 — the page's pitch detector over an attempt takes ~2.5 s a run)
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import os from 'node:os';
import { sing } from './rhythmsynth.mjs';
import { features, frames } from './rhythmharness.mjs';
import { loadSong, fixtureNames } from './fixturelib.mjs';
import earsinger from './lib/earsinger.cjs';
import { findClicks } from '../public/rhythm.js';
import * as TR from '../public/takerhythm.js';
import { clickWave, CLICK_GAIN } from '../public/piano.js';
import { gradeTake, MAX_SHIFT } from '../public/grade.js';
import { MIN_RMS, ANALYSIS_LAG, FFT_SIZE } from '../public/pitch.js';
import { noteName } from '../public/music.js';
import { PRACTICE, groupPhrases } from '../public/practice.js';
import { EAR_PHRASE, judgeFree, judgeBeats } from '../public/ear.js';

const { segments } = earsinger;
const DONE = new Set(['WP0']); // the work packages landed: their cases are judged
const V = !!process.env.V, ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null, SHOW_TODO = process.env.TODO !== '0';

let pass = 0, fail = 0;
const todo = {};
const check = (name, ok, detail = '') => { if (ok) pass++; else { fail++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); } };

// ---------------------------------------------------------------------------
// The songs and their lines

const PLAN_PHRASE = { ...EAR_PHRASE, maxSyl: 8 }; // the fix plan's lines (Q-A default: the printed line, ≤ 8 syllables; WP1.12)
function songOf(name) {
  const s = loadSong(name);
  const fx = s.fx;
  const group = (params) => { const keep = { ...PRACTICE.phrase }; Object.assign(PRACTICE.phrase, params); try { return groupPhrases(s.notes, s.lines, s.opts).phrases; } finally { Object.assign(PRACTICE.phrase, keep); } };
  const score = { measures: fx.measures, meters: fx.meters, length: fx.length, measureOf: fx.measureOf, tempo: fx.tempo };
  const flats = (fx.fifths ?? 0) < 0;
  return { name, title: fx.title, notes: s.notes, lines: s.lines, score, spq: fx.spq, flats, page: group(EAR_PHRASE), plan: group(PLAN_PHRASE) };
}
const lineText = (S, ph) => `${ph.j0}–${ph.j1 - 1} ${(S.notes[ph.j1 - 1].t + S.notes[ph.j1 - 1].d - S.notes[ph.j0].t).toFixed(1)} s ${ph.syl} syl “${ph.words || ''}”`;
if (isMainThread) for (const name of fixtureNames()) {
  const S = songOf(name);
  console.log(`${S.title} (${name}) — Ear's lines (ear.js EAR_PHRASE, maxSyl ${EAR_PHRASE.maxSyl}):`);
  S.page.forEach((ph, i) => console.log(`  L${i} ${lineText(S, ph)}`));
  if (JSON.stringify(S.page.map((p) => [p.j0, p.j1])) !== JSON.stringify(S.plan.map((p) => [p.j0, p.j1]))) {
    console.log(`  the fix plan's lines (maxSyl ${PLAN_PHRASE.maxSyl}) — the cases below use these:`);
    S.plan.forEach((ph, i) => console.log(`  L${i} ${lineText(S, ph)}`));
  }
}
const AG = songOf('amazing-grace');

// ---------------------------------------------------------------------------
// The singer (earsinger.cjs segments) on its own: where a plan puts each note

if (isMainThread) {
  const ph = AG.plan[0], ns = AG.notes.slice(ph.j0, ph.j1);
  const k = ns.findIndex((n) => n.text === 'sweet'); // (“sweet”: the note before it, “how”, is held or cut)
  const base = segments({}, ns), late = segments({ starts: { [k]: 0.25 } }, ns), gap = segments({ starts: { [k]: 0.25 }, gap: true }, ns);
  const early = segments({ starts: { [k]: -0.25 } }, ns);
  check('singer: starts moves only that note’s start', k > 0 && late.every((o, x) => (o.i === k ? Math.abs(o.s - base[x].s - 0.25) < 1e-9 : Math.abs(o.s - base[x].s) < 1e-9)) && late.every((o, x) => (o.i === k - 1 ? true : Math.abs(o.e - base[x].e) < 1e-9)), JSON.stringify(late.map((o) => [o.i, +o.s.toFixed(3), +o.e.toFixed(3)])));
  check('singer: the note before a late start is held up to it', Math.abs(late[k - 1].e - (late[k].s - 0.04)) < 1e-9 && Math.abs(gap[k - 1].e - base[k - 1].e) < 1e-9);
  check('singer: an early start cuts the note before', Math.abs(early[k - 1].e - (early[k].s - 0.04)) < 1e-9 && Math.abs(early[k].e - base[k].e) < 1e-9);
  const L0 = ns, fs = segments({ false: { n: 3, gap: 1 } }, L0);
  check('singer: a false start sings 0…n−1, then the whole line after the gap', fs.length === 3 + L0.length && fs.slice(0, 3).map((o) => o.i).join() === '0,1,2' && Math.abs(fs[3].s - (L0[3].t - L0[0].t + 1)) < 1e-9);
  const st = segments({ stop: 6, drop: [2] }, L0);
  check('singer: stop and drop', st.map((o) => o.i).join() === '0,1,3,4,5,6');
  const ex = segments({ extra: 2 }, AG.notes.slice(ph.j0, ph.j1 + 2));
  check('singer: extra notes keep their place', ex.length === L0.length + 2 && Math.abs(ex[L0.length + 1].s - (AG.notes[ph.j1 + 1].t - AG.notes[ph.j0].t)) < 1e-9);
  const sl = segments({ f: 1.5 }, L0, 1.5);
  check('singer: f scales every start and length', Math.abs(sl[10].s - 1.5 * (L0[10].t - L0[0].t)) < 1e-9 && Math.abs(sl[10].e - sl[10].s - (1.5 * L0[10].d - 0.04)) < 1e-9);
}

// ---------------------------------------------------------------------------
// An attempt, sung

// The singer's segments → rhythmsynth's notes (song seconds; melisma kept where the note before was sung
// right up to it, else a new syllable), and the pitch each sings (drift as a step per note).
function sungNotes(plan, ns, segs, lead) {
  const tot = segs.length ? Math.max(...segs.map((o) => o.e)) - segs[0].s : 0;
  const out = [];
  for (const o of segs) {
    const n = ns[o.i], prev = out[out.length - 1];
    const t = lead + o.s, d = o.e + 0.04 - o.s;
    const restBefore = !prev || t - (prev.t + prev.d) > 0.02;
    const melisma = !!n.melisma && !restBefore && prev?.i === o.i - 1;
    const drift = plan.drift ? (plan.drift * Math.max(0, Math.min(1, ((o.s + o.e) / 2 - segs[0].s) / (tot || 1)))) / 100 : 0;
    out.push({ i: o.i, t, d, midi: o.m + drift, text: melisma ? '' : n.text || '', melisma, restBefore });
  }
  return out;
}

const LEAD = 1.3; // the singer's first note, s after the mic opened (earprobe: ■ Done shows, then 1 s)
// vol: the browser singer's gain — its sawtooth's RMS is ≈ 0.56 × vol (0.012: under MIN_RMS, never heard; 0.03:
// heard) — as rhythmsynth's vowel level (RMS ≈ 0.075 in the singing range); none: rhythmsynth's own level.
const loudOf = (plan) => (plan.vol != null ? (0.56 * plan.vol) / 0.075 : 1);
// ● Sing (Line) on a phrase: → the result, the frames, the singer's notes.
function lineRound(S, ph, plan, { phase = 0, seed = 7 } = {}) {
  const f = plan.f || 1;
  const ns = S.notes.slice(ph.j0, Math.min(S.notes.length, ph.j1 + (plan.extra || 0)));
  const segs = plan.silent ? [] : segments(plan, ns, f);
  const sung = sungNotes(plan, ns, segs, LEAD);
  if (plan.hum && sung.length) sung.unshift({ i: -1, t: LEAD - 0.3 - plan.hum.d, d: plan.hum.d, midi: plan.hum.m, text: '', melisma: false, restBefore: true });
  const lastE = segs.length ? Math.max(...segs.map((o) => o.e)) : (S.notes[ph.j1 - 1].t + S.notes[ph.j1 - 1].d - S.notes[ph.j0].t) * f;
  const endT = LEAD + lastE + 0.7; // (■ Done 0.7 s after the singer's last note)
  const vol = loudOf(plan);
  const r = sing(sung, { songT0: 0, rt: 0, until: endT, vibrato: plan.vib ?? 0, noise: 0.002, seed, loud: () => vol });
  const fr = frames(r.audio, r.sr, { songT0: 0, latency: 0, fps: 60, from: FFT_SIZE / r.sr + phase, to: endT });
  const ctx = { notes: S.notes, spq: S.spq, name: (m) => noteName(m, S.flats) };
  const t0 = performance.now();
  const res = judgeFree(ph, fr, endT, ctx);
  return { res, ms: performance.now() - t0, frames: fr, sung };
}

// ● Sing with the click (Beats) on a phrase, as startSing(part) runs it. rig: the phone's speaker by default
// (the clicks reach the mic: the trip measured), { clickLevel: 0 } headphones (the browser's estimate only).
const RIG = { rt: 0.07, est: 0.04, clickLevel: 0.3 };
function beatsRound(S, ph, plan, { phase = 0, seed = 7 } = {}) {
  const rig = { ...RIG, ...plan.rig };
  const rate = plan.slow || 1, spq = S.spq / rate, qToT = (q) => q * spq; // (Beats' Slower: retime(rate))
  const notes = S.notes.map((n) => ({ ...n, t: qToT(n.q), d: qToT(n.q + n.dq) - qToT(n.q) }));
  const sc = S.score, meterAt = (mi) => TR.meterAt(sc, mi), feltBeat = TR.feltBeat;
  // spanOf(p, p)
  const m = TR.measureAt(sc, notes[ph.j0].q), last = notes[ph.j1 - 1];
  const sp = { j0: ph.j0, j1: ph.j1, from: qToT(sc.measures[m]), fromQ: sc.measures[m], fromM: m, end: last.t + last.d };
  // startSing(part): the count-in (a bar, + a pickup's missing beats), its pace, the click guide (beatGrid)
  const meter = meterAt(sp.fromM), fbm = feltBeat(meter), beatSec = fbm.q * spq;
  const pickLen = (sc.measures[sp.fromM + 1] ?? sc.length) - sc.measures[sp.fromM];
  const pickupFill = pickLen < fbm.n * fbm.q - 1e-6 && (sc.measureOf?.[sp.fromM] ?? sp.fromM) === 0 ? (fbm.n * fbm.q - pickLen) / fbm.q : 0;
  const count = fbm.n + pickupFill, start = sp.from, until = sp.end + MAX_SHIFT + 0.6;
  const t0 = 0.3, songT0 = t0 + count * beatSec - start;
  const countClicks = [];
  for (let k = 0; k < count; k++) countClicks.push({ t: t0 + k * beatSec, accent: k % fbm.n === 0 });
  const grid = [];
  sc.measures.forEach((mq, i) => {
    const fb = feltBeat(meterAt(i)), end = sc.measures[i + 1] ?? sc.length;
    if (end - mq < fb.n * fb.q - 1e-6 && (sc.measureOf?.[i] ?? i) === 0) { for (let q = end - fb.q; q >= mq - 1e-6; q -= fb.q) grid.push({ t: qToT(q), accent: false }); return; }
    for (let q = mq; q < end - 1e-6; q += fb.q) grid.push({ t: qToT(q), accent: q === mq && i > 0 });
  });
  const guide = grid.filter((b) => b.t >= start - 1e-6 && b.t < until);
  // the singer, on what they hear (song time; its sound reaches the recording rig.rt later)
  const ns = notes.slice(ph.j0, ph.j1);
  const segs = plan.silent ? [] : segments(plan, ns, plan.f || 1);
  const sung = sungNotes(plan, ns, segs, notes[ph.j0].t + (plan.late || 0));
  const vol = loudOf(plan);
  const r = sing(sung, { songT0, rt: rig.rt, clicks: [...countClicks.map((c) => ({ t: c.t - songT0, accent: c.accent })), ...guide], clickLevel: rig.clickLevel, noise: 0.002, until, vibrato: plan.vib ?? 0, seed, loud: () => vol });
  const feat = features(r.audio, r.sr);
  let fr = frames(r.audio, r.sr, { songT0, latency: rig.est, fps: 60, from: start - 0.5 + phase });
  const cal = findClicks(r.audio, r.sr, 0, countClicks, beatSec, (a) => clickWave(r.sr, a), (a) => CLICK_GAIN[a ? 'accent' : 'plain']);
  let latency = rig.est;
  const stopAt = songT0 + until;
  let endT = stopAt - songT0 - ANALYSIS_LAG - latency;
  if (cal) { const dd = rig.est - cal.rt; fr = fr.map((x) => ({ ...x, t: x.t + dd })); endT += dd; latency = cal.rt; } // (as finishSing)
  const part = gradeTake(ns, fr, { endT, gate: MIN_RMS });
  const grades = notes.map((_, j) => (j >= ph.j0 && j < ph.j1 ? part[j - ph.j0] : null));
  const s = { latency: rig.est, ac: {}, songT0, count, beatSec, features: { result: () => feat }, part: { guided: true, stage: 'time', phrases: [ph.js] } };
  const take = { range: [ph.j0, ph.j1], grades, frames: fr, latency, guide: 'click' };
  const rhythm = TR.rhythmOf({ s, v: { start: 0 }, cal, stopAt, settings: null, take, score: sc, notes, lines: S.lines, qToT, tapped: false });
  const ctx = { notes, spq, name: (mm) => noteName(mm, S.flats) };
  const t1 = performance.now();
  const res = judgeBeats(ph, { rhythm, frames: fr, grades }, ctx);
  return { res, ms: performance.now() - t1, cal, rhythm, grades, sung };
}

// ---------------------------------------------------------------------------
// What a result should be

const at = (r, ph) => (r.cue?.j != null ? r.cue.j - ph.j0 : null);
const X = {
  notesAll: ['♪ all', (r) => !!r.counts?.notesAll],
  notNotesAll: ['not ♪ all', (r) => !r.counts?.notesAll],
  noNotes: ['no ♪', (r) => r.counts?.notes == null],
  beatsAll: ['♩ all', (r) => !!r.counts?.beatsAll],
  notBeatsAll: ['not ♩ all', (r) => !r.counts?.beatsAll],
  noBeats: ['no ♩ count', (r) => r.counts?.beats == null],
  win: (k) => [`win ${k}`, (r) => r.win?.kind === k],
  cue: (k, i, dir) => [`cue ${k}${i != null ? ` @${i}` : ''}${dir ? ` ${dir}` : ''}`, (r, ph) => r.cue?.kind === k && (i == null || at(r, ph) === i) && (!dir || r.cue.dir === dir)],
  noCue: ['no cue', (r) => !r.cue],
  noTiming: ['no timing cue', (r) => !['timing', 'held', 'steady', 'drift', 'slip'].includes(r.cue?.kind)],
  neverDir: (d) => [`never “${d}”`, (r) => r.cue?.dir !== d],
  b: (f, tol = 0.03) => [`b ×${f} ±${Math.round(tol * 100)}%`, (r) => !!r.fit && Math.abs(r.fit.b / f - 1) <= tol],
  keyS: (sv) => [`key ${sv > 0 ? '+' : ''}${sv}`, (r) => r.key?.s === sv],
};

// The cases. line: the fix plan's line (PLAN_PHRASE's); word: the text of the note at index `w` the case is about —
// checked, so a case and its line can't drift apart.
const LINE = [];
// (wp 'WP0': today's code already gets it right — a guard while WP2–WP4 rebuild the judgments)
for (const f of [0.9, 1, 1.1, 1.3, 1.7, 2]) LINE.push({ name: `all right ×${f}`, line: 0, plan: { f }, wp: [0.9, 1.3].includes(f) ? 'WP0' : 'WP2', want: [X.notesAll, X.beatsAll, X.win('spot'), X.b(f)] });
for (const f of [1, 1.1, 1.2, 1.4]) LINE.push({ name: `L2 all right ×${f}`, line: 2, plan: { f }, wp: [1, 1.2].includes(f) ? 'WP0' : 'WP2', want: [X.notesAll, X.beatsAll, X.noTiming] });
for (const c of [-300, -500, 200, 100]) LINE.push({ name: `all ${c > 0 ? '+' : ''}${c}¢ (another key)`, line: 0, plan: { all: c }, wp: 'WP2', want: [X.noNotes, X.win('key'), X.cue('key', null, c < 0 ? 'lower' : 'higher'), X.keyS(c / 100)] });
LINE.push(
  { name: 'all −70¢', line: 0, plan: { all: -70 }, wp: 'WP2', want: [X.cue('offset', null, 'higher'), X.beatsAll] },
  { name: 'all +45¢', line: 0, plan: { all: 45 }, wp: 'WP2', want: [X.notesAll, X.cue('sag', null, 'lower')] },
  { name: 'drift −40¢', line: 0, plan: { drift: -40 }, wp: 'WP2', want: [X.notesAll, X.cue('sag', null, 'higher')] },
  { name: 'drift −80¢', line: 0, plan: { drift: -80 }, wp: 'WP0', want: [X.neverDir('lower'), ['the cue points higher', (r) => r.cue?.dir === 'higher']] },
  { name: '“zing” +100¢', line: 0, w: 3, word: 'zing', plan: { cents: { 3: 100 } }, wp: 'WP2', want: [X.cue('pitch', 3, 'lower'), X.beatsAll] },
  { name: 'L2 “but” +200¢ (on the next note’s F4)', line: 2, w: 6, word: 'but', plan: { cents: { 6: 200 } }, wp: 'WP2', want: [X.notNotesAll, X.cue('pitch', 6, 'lower'), X.beatsAll] },
  { name: 'L3 “Was” +200¢ (on F4)', line: 3, w: 0, word: 'Was', plan: { cents: { 0: 200 } }, wp: 'WP2', want: [X.notNotesAll, X.cue('pitch', 0, 'lower'), X.beatsAll] },
  { name: '“grace” in 0.25 s late', line: 0, w: 6, word: 'grace!', plan: { starts: { 6: 0.25 } }, wp: 'WP2', want: [X.cue('timing', 6, 'sooner')] },
  { name: '“grace” in 0.4 s late', line: 0, w: 6, word: 'grace!', plan: { starts: { 6: 0.4 } }, wp: 'WP2', want: [X.cue('timing', 6, 'sooner')] },
  { name: '“the” in 0.25 s late', line: 0, w: 9, word: 'the', plan: { starts: { 9: 0.25 } }, wp: 'WP2', want: [X.cue('timing', 9, 'sooner')] },
  { name: '“sweet” in 0.25 s early', line: 0, w: 8, word: 'sweet', plan: { starts: { 8: -0.25 } }, wp: 'WP0', want: [X.cue('timing', 8, 'later')] },
  { name: '“grace” held long (rubato)', line: 0, w: 6, word: 'grace!', plan: { starts: { 7: 0.5, 8: 0.5, 9: 0.5, 10: 0.5 } }, wp: 'WP2', want: [X.cue('held', 6)] },
  { name: '“zing”’s 2nd note dropped', line: 0, w: 4, word: '', plan: { drop: [4] }, wp: 'WP2', want: [X.cue('missed', 4)] },
  { name: 'stops after note 6', line: 0, plan: { stop: 6 }, wp: 'WP2', want: [X.cue('short'), ['2+ not reached', (r) => r.notReached >= 2]] },
  { name: 'a false start (3 notes, 1 s)', line: 0, plan: { false: { n: 3, gap: 1 } }, wp: 'WP2', want: [X.notesAll, X.beatsAll] },
  { name: 'silent', line: 0, plan: { silent: true }, wp: 'WP0', want: [X.cue('silent'), ['no counts', (r) => !r.counts]] },
  { name: 'a whisper (vol 0.012)', line: 0, plan: { vol: 0.012 }, wp: 'WP0', want: [X.cue('silent')] },
  // (the personas' other singers: none of these changes the answer)
  { name: 'quiet (vol 0.03)', line: 0, plan: { vol: 0.03 }, wp: 'WP0', want: [X.notesAll, X.beatsAll] },
  { name: 'a hum 0.4 s before', line: 0, plan: { hum: { m: 57, d: 0.4 } }, wp: 'WP0', want: [X.notesAll, X.beatsAll] },
  { name: 'on into the next line (3 notes)', line: 0, plan: { extra: 3 }, wp: 'WP0', want: [X.notesAll, X.beatsAll] },
  { name: 'vibrato 40¢', line: 0, plan: { vib: 40 }, wp: 'WP0', want: [X.notesAll, X.beatsAll] },
);
const BEATS = [
  { name: 'on time', line: 0, plan: {}, wp: 'WP3', want: [X.beatsAll, X.win('spot')] },
  { name: 'on time, headphones (the estimate only)', line: 0, plan: { rig: { clickLevel: 0 } }, wp: 'WP3', want: [X.beatsAll, X.win('spot')] },
  { name: '0.1 s late', line: 0, plan: { late: 0.1 }, wp: 'WP0', want: [X.beatsAll] },
  ...[0.25, 0.4, 0.5].map((l) => ({ name: `${l} s late`, line: 0, plan: { late: l }, wp: 'WP3', want: [X.notBeatsAll, X.cue('steady', null, 'sooner')] })),
  { name: '0.2 s early', line: 0, plan: { late: -0.2 }, wp: 'WP3', want: [X.notBeatsAll, X.cue('steady', null, 'later')] },
  { name: 'a beat late (0.75 s)', line: 0, plan: { late: 0.75 }, wp: 'WP3', want: [X.noBeats, X.cue('slip', null, 'sooner')] },
  { name: 'slowing ×1.1', line: 0, plan: { f: 1.1 }, wp: 'WP3', want: [X.cue('drift', null, 'sooner')] },
  { name: 'speeding ×0.9', line: 0, plan: { f: 0.9 }, wp: 'WP3', want: [X.cue('drift', null, 'later')] },
  { name: '“grace” not sung', line: 0, w: 6, word: 'grace!', plan: { drop: [6] }, wp: 'WP3', want: [X.cue('missed', 6), X.noTiming] },
  { name: '“grace” in 0.2 s late', line: 0, w: 6, word: 'grace!', plan: { starts: { 6: 0.2 } }, wp: 'WP0', want: [X.cue('timing', 6, 'sooner')] },
  { name: 'L2 “once” in 0.2 s late', line: 2, w: 2, word: 'once', plan: { starts: { 2: 0.2 } }, wp: 'WP0', want: [X.cue('timing', 2, 'sooner')] },
  { name: 'silent', line: 0, plan: { silent: true }, wp: 'WP0', want: [X.cue('silent'), ['no counts', (r) => !r.counts]] },
];

// ---------------------------------------------------------------------------
// Run them

const verdict = (r) => JSON.stringify({ c: r.counts, w: r.win && [r.win.kind, r.win.text], q: r.cue && [r.cue.kind, r.cue.text, r.cue.j, r.cue.dir] });
const short = (r, ph) => [
  r.counts ? `♩ ${r.counts.beats == null ? '–' : r.counts.beatsAll ? 'all' : r.counts.beats} · ♪ ${r.counts.notes == null ? '–' : r.counts.notesAll ? 'all' : r.counts.notes}` : 'no counts',
  `win ${r.win ? `${r.win.kind} “${r.win.text}”` : '–'}`,
  `cue ${r.cue ? `${r.cue.kind}${at(r, ph) != null ? `@${at(r, ph)}` : ''}${r.cue.dir ? ` ${r.cue.dir}` : ''} “${r.cue.text}”` : '–'}`,
  r.fit ? `b ${r.fit.b.toFixed(2)} a ${r.fit.a.toFixed(2)}` : null,
  r.onsets ? `onsets ${r.onsets.measured}/${r.onsets.of}` : null,
  r.key ? `key c ${Math.round(r.key.c)}¢ s ${r.key.s}` : null,
  r.notReached != null ? `not reached ${r.notReached}` : null,
].filter(Boolean).join(' | ');

// The same singing again: the frames half a frame later (rAF never lands where it did), other room noise.
const VARIANTS = [{ phase: 0, seed: 7 }, { phase: 1 / 120, seed: 11 }];
const CASES = [...LINE.map((c) => ['Line', c]), ...BEATS.map((c) => ['Beats', c])];
const labelOf = ([mode, c]) => `${mode} L${c.line} ${c.name}`;

// One case: → { out (lines to print), checks [[name, ok, detail]], todo (its package, when not landed), ms }.
function evalCase(k) {
  const [mode, c] = CASES[k], label = labelOf(CASES[k]);
  const out = [], checks = [];
  const ph = AG.plan[c.line];
  if (c.word !== undefined && (AG.notes[ph.j0 + c.w].text || '') !== c.word) return { out, checks: [[`${label}: note ${c.w} is “${c.word}”`, false, `it is “${AG.notes[ph.j0 + c.w].text}”`]], todo: null, ms: 0 };
  const round = mode === 'Line' ? lineRound : beatsRound;
  const runs = VARIANTS.map((v) => round(AG, ph, c.plan, v));
  const R = runs[0], r = R.res;
  const failed = c.want.filter(([, fn]) => !fn(r, ph)).map(([w]) => w);
  const same = runs.every((x) => verdict(x.res) === verdict(r));
  const judged = DONE.has(c.wp);
  out.push(`${judged ? '     ' : 'todo '}${label}: ${short(r, ph)}${same ? '' : '  [again: ' + runs.slice(1).map((x) => short(x.res, ph)).join(' / ') + ']'}`);
  if (V) {
    const g = mode === 'Line' ? r.fit?.g : R.grades?.slice(ph.j0, ph.j1);
    for (let i = 0; i < ph.j1 - ph.j0; i++) {
      const n = AG.notes[ph.j0 + i], x = g?.[i], rn = r.rn?.[i];
      out.push(`       ${i} ${(n.text || '·').padEnd(8)} ${n.name.padEnd(4)} ${x ? `${x.status}${x.dev != null ? ` ${Math.round(x.dev * 100)}¢` : ''}${x.shift != null ? ` ${x.shift.toFixed(2)}s` : ''}` : '–'}${rn ? ` | ${rn.cls ?? '–'} dev ${rn.dev?.toFixed(3) ?? '–'} rdev ${rn.rdev?.toFixed(3) ?? '–'}` : ''}`);
    }
  }
  if (judged) {
    checks.push([label, !failed.length, `wanted ${failed.join(', ')}`]);
    checks.push([`${label}: the same singing, the same answer`, same, runs.map((x) => short(x.res, ph)).join(' / ')]);
  } else if (SHOW_TODO) {
    out.push(failed.length || !same ? `       todo ${c.wp}: wants ${failed.join(', ') || '—'}${same ? '' : `${failed.length ? ';' : ''} the same answer every time`}` : `       todo ${c.wp}: passes now — make it a check`);
  }
  return { out, checks, todo: judged ? null : c.wp, ms: Math.max(...runs.map((x) => x.ms)) };
}

if (!isMainThread) {
  parentPort.on('message', (k) => parentPort.postMessage({ k, ...evalCase(k) }));
} else {
  // (the fix plan's lines are Ear's own once WP1.12 lands)
  {
    const same = JSON.stringify(AG.page.map((p) => [p.j0, p.j1])) === JSON.stringify(AG.plan.map((p) => [p.j0, p.j1]));
    const four = AG.plan.length === 4 && AG.plan.map((p) => p.words).join(' | ') === 'Amazing grace! how sweet the sound! | That saved a wretch like me! | I once was lost, but now I\'m found; | Was blind, but now I see.';
    check('the fix plan’s lines: Amazing Grace’s four printed lines', four, AG.plan.map((p) => p.words).join(' | '));
    if (DONE.has('WP1')) check('Ear’s lines are the printed lines (WP1.12)', same);
    else { (todo.WP1 ||= []).push('lines'); if (SHOW_TODO) console.log(`todo WP1  Ear's lines are the printed lines (WP1.12): ${same ? 'passes now — make it a check' : `${AG.page.length} lines here (maxSyl ${EAR_PHRASE.maxSyl})`}`); }
  }
  const ks = CASES.map((_, k) => k).filter((k) => !ONLY || ONLY.test(labelOf(CASES[k])));
  const jobs = Math.max(1, Math.min(Number(process.env.JOBS) || Math.min(3, os.availableParallelism?.() ?? os.cpus().length), ks.length));
  const results = new Array(CASES.length);
  let next = 0, shown = 0;
  const flush = () => { // (in case order, as each arrives)
    while (shown < ks.length && results[ks[shown]]) {
      const x = results[ks[shown++]];
      for (const l of x.out) console.log(l);
      for (const [name, ok, detail] of x.checks) check(name, ok, detail);
      if (x.todo) (todo[x.todo] ||= []).push(x.k);
    }
  };
  let slowest = 0;
  if (jobs === 1) for (const k of ks) { results[k] = { k, ...evalCase(k) }; slowest = Math.max(slowest, results[k].ms); flush(); }
  else await new Promise((done, reject) => {
    let running = 0;
    const start = (w) => { if (next >= ks.length) { w.terminate(); if (!--running) done(); return; } w.postMessage(ks[next++]); };
    for (let i = 0; i < jobs; i++) {
      const w = new Worker(new URL(import.meta.url), { env: process.env });
      running++;
      w.on('message', (x) => { results[x.k] = x; slowest = Math.max(slowest, x.ms); flush(); start(w); });
      w.on('error', reject);
      start(w);
    }
  });
  console.log(`(the slowest judgment ${slowest.toFixed(0)} ms)`);
  const todos = Object.entries(todo).map(([k, v]) => `${k} ${v.length}`).join(', ');
  console.log(`${pass} passed, ${fail} failed${todos ? `, todo: ${todos}` : ''}`);
  process.exitCode = fail ? 1 : 0;
}
