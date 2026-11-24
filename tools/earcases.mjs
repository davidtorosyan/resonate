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
// printed lines, PLAN_PHRASE), compared with the page's own (ear.js EAR_PHRASE) as a WP1 case. Every case also
// checks a win or cue that names a note against what the singer did there (TRUTH: no win from a note sung wrong or
// late, no cue pointing the wrong way or at a note sung right). A case may be sung `before` another attempt at the
// line: that one's result is handed on as the page keeps it (EAR.last: only a whole attempt) — "fixed now", "more
// than last time", "twice running", never the same win twice. Line plans may also carry `tail` (our own ▶'s last
// note in the mic, on a calibrated device: `gate`) — node only.
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
import { EAR_PHRASE, judgeFree, judgeBeats, wordOf, countSets, gateFrames } from '../public/ear.js';

const { segments } = earsinger;
const DONE = new Set(['WP0', 'WP1', 'WP2']); // the work packages landed: their cases are judged
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
// ear.js on its own: naming a note, the count sets (WP2)

if (isMainThread) {
  const W = (j) => { const w = wordOf(j, AG.notes); return w && `${w.word}|${w.syl}|${w.at}|${w.k}/${w.n}`; };
  check('wordOf: a melisma’s notes — the whole word, the syllable, which of its notes', W(3) === 'Amazing|zing|3,7|0/3' && W(4) === 'Amazing|zing|3,7|1/3' && W(1) === 'Amazing|A|0,1|1/2' && W(2) === 'Amazing|ma|1,3|0/1', [1, 2, 3, 4].map(W).join(' · '));
  check('wordOf: a word’s punctuation left out', W(6) === 'grace|grace|0,5|0/1' && W(10) === 'sound|sound|0,5|0/1', [6, 10].map(W).join(' · '));
  const ph = AG.plan[0], slow = AG.notes.map((n) => ({ ...n, t: n.t / 0.7, d: n.d / 0.7 }));
  const at100 = countSets(ph, AG.notes, AG.spq), at70 = countSets(ph, slow, AG.spq), old70 = countSets(ph, slow, null);
  check('count sets: fixed at the song’s own tempo (70 % counts the same notes)', JSON.stringify(at70) === JSON.stringify(at100) && at100.counted.length === 11 && at100.starts.join() === '0,2,3,6,7,8,9,10', `${at100.counted.length} notes, starts ${at100.starts} — at 70 %: ${at70.counted.length}; by the slowed lengths ${old70.counted.length}`);
  // (rule 1 alone: a frame under MIN_RMS before gateUntil isn't sung, after it is)
  const g = gateFrames([{ t: 0.1, midi: 63, rms: 0.008 }, { t: 0.2, midi: 63, rms: 0.02 }, { t: 0.6, midi: 63, rms: 0.008 }], 0.5);
  check('gateFrames: our own ▶’s tail out until gateUntil', g[0].midi === null && g[1].midi === 63 && g[2].midi === 63);
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
    const driftAt = (x) => (plan.drift ? (plan.drift * Math.max(0, Math.min(1, (x - segs[0].s) / (tot || 1)))) / 100 : 0);
    if (!plan.drift) { out.push({ i: o.i, t, d, midi: o.m, text: melisma ? '' : n.text || '', melisma, restBefore }); continue; }
    // (a drift goes on within a note too, as the browser's singer bends it: the note in three parts, glided)
    for (let p = 0; p < 3; p++) out.push({ i: o.i, t: t + (p * d) / 3, d: d / 3, midi: o.m + driftAt(o.s + ((p + 0.5) * (o.e - o.s)) / 3), text: p || melisma ? '' : n.text || '', melisma: p > 0 || melisma, restBefore: p === 0 && restBefore });
  }
  return out;
}

// What the singer really did with note i of the phrase (its last time through: a false start's restart): dev
// (semitones off its written pitch, drift in), moved (s its start sat off its place — Line: on the singer's own
// tempo f; Beats: on the click, `late` in) — or null: not sung.
function truthOf(plan, ns, segs, sung, beats) {
  const f = plan.f || 1, T0 = ns[0].t;
  return (i) => {
    const o = segs.findLast((x) => x.i === i), y = sung.findLast((x) => x.i === i);
    if (!o || !y) return null;
    const n = ns[i];
    return { dev: y.midi - (n.midi + (n.shift || 0)), moved: beats ? o.s + (plan.late || 0) - (n.t - T0) : o.s - (n.t - T0) * f - (o.re || 0) };
  };
}

const LEAD = 1.3; // the singer's first note, s after the mic opened (earprobe: ■ Done shows, then 1 s)
// vol: the browser singer's gain — its sawtooth's RMS is ≈ 0.56 × vol (0.012: under MIN_RMS, never heard; 0.03:
// heard) — as rhythmsynth's vowel level (RMS ≈ 0.075 in the singing range); none: rhythmsynth's own level.
const loudOf = (plan) => (plan.vol != null ? (0.56 * plan.vol) / 0.075 : 1);
// ● Sing (Line) on a phrase: → the result, the frames, the singer's notes. As earFree hands it over: the frames, the
// recording's features (its first sample at the attempt's 0 s), the song's meter and own tempo. tail: { m, d, gap,
// level } — our own ▶'s last note still in the mic (a speaker, quieter than a voice: under MIN_RMS), ending `gap` s
// before the singer starts, on a calibrated device (the reader's gate under MIN_RMS: `gate`), with the page's
// gateUntil (rule 1) at its end + 0.1 s — or, gateUntil: false, without it.
function lineRound(S, ph, plan, { phase = 0, seed = 7, prev = null } = {}) {
  const f = plan.f || 1;
  const ns = S.notes.slice(ph.j0, Math.min(S.notes.length, ph.j1 + (plan.extra || 0)));
  const segs = plan.silent ? [] : segments(plan, ns, f);
  const sung = sungNotes(plan, ns, segs, LEAD);
  if (plan.hum && sung.length) sung.unshift({ i: -1, t: LEAD - 0.3 - plan.hum.d, d: plan.hum.d, midi: plan.hum.m, text: '', melisma: false, restBefore: true });
  const tail = plan.tail && { t: LEAD - plan.tail.gap - plan.tail.d, d: plan.tail.d, midi: plan.tail.m, text: '', melisma: false, restBefore: true, i: -2 };
  if (tail) sung.unshift(tail);
  const lastE = segs.length ? Math.max(...segs.map((o) => o.e)) : (S.notes[ph.j1 - 1].t + S.notes[ph.j1 - 1].d - S.notes[ph.j0].t) * f;
  const endT = LEAD + lastE + (plan.done ?? 0.7); // (■ Done 0.7 s after the singer's last note — `done`: negative, while still singing)
  const vol = loudOf(plan);
  const r = sing(sung, { songT0: 0, rt: 0, until: endT, vibrato: plan.vib ?? 0, noise: 0.002, seed, loud: (j) => (sung[j]?.i === -2 ? plan.tail.level : vol) });
  const fr = frames(r.audio, r.sr, { songT0: 0, latency: 0, fps: 60, from: FFT_SIZE / r.sr + phase, to: endT, gate: plan.gate });
  const ctx = { notes: S.notes, spq: S.spq, spq0: S.spq, name: (m) => noteName(m, S.flats), score: S.score, qToT: (q) => q * S.spq, feat: features(r.audio, r.sr), start: 0,
    gateUntil: tail && plan.gateUntil !== false ? tail.t + tail.d + 0.1 : undefined, prev };
  const t0 = performance.now();
  const res = judgeFree(ph, fr, endT, ctx);
  return { res, ms: performance.now() - t0, frames: fr, sung, truth: truthOf(plan, ns, segs, sung, false) };
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
  const ctx = { notes, spq, spq0: S.spq, name: (mm) => noteName(mm, S.flats) };
  const t1 = performance.now();
  const res = judgeBeats(ph, { rhythm, frames: fr, grades }, ctx);
  return { res, ms: performance.now() - t1, cal, rhythm, grades, sung, truth: truthOf(plan, ns, segs, sung, true) };
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
  win: (k, i) => [`win ${k}${i != null ? ` @${i}` : ''}`, (r, ph) => r.win?.kind === k && (i == null || (r.win.j != null && r.win.j - ph.j0 === i))],
  cue: (k, i, dir) => [`cue ${k}${i != null ? ` @${i}` : ''}${dir ? ` ${dir}` : ''}`, (r, ph) => r.cue?.kind === k && (i == null || at(r, ph) === i) && (!dir || r.cue.dir === dir)],
  noCue: ['no cue', (r) => !r.cue],
  noTiming: ['no timing cue', (r) => !['timing', 'held', 'steady', 'drift', 'slip'].includes(r.cue?.kind)],
  neverDir: (d) => [`never “${d}”`, (r) => r.cue?.dir !== d],
  b: (f, tol = 0.03) => [`b ×${f} ±${Math.round(tol * 100)}%`, (r) => !!r.fit && Math.abs(r.fit.b / f - 1) <= tol],
  keyS: (sv) => [`key ${sv > 0 ? '+' : ''}${sv}`, (r) => r.key?.s === sv],
};

// Every case, whatever it's about: a win or a cue that names a note says what the singer really did there (the fix
// plan: "no win from a note the fit borrowed"; cues that point the wrong way) — judged with the case's package.
const named = (r, ph, R, kind) => { const x = kind === 'win' ? r.win : r.cue; return x?.j != null ? R.truth(x.j - ph.j0) : undefined; };
const FIXES = { higher: -1, lower: 1, sooner: 1, later: -1 }; // (the sign of the error each instruction fixes: higher — sung low; sooner — came in late)
const pointsAt = (dir, err) => Math.sign(err) === FIXES[dir];
const TRUTH = [
  ['a win’s note sung on its pitch', (r, ph, R) => !r.win || r.win.kind === 'key' || r.win.j == null || Math.abs(named(r, ph, R, 'win')?.dev ?? 99) <= 0.5],
  ['a Beats win’s start sung on the click', (r, ph, R) => !R.beats || !r.win || r.win.j == null || Math.abs(named(r, ph, R, 'win')?.moved ?? 99) <= 0.15],
  ['a pitch cue’s note sung off, the way it points', (r, ph, R) => { if (r.cue?.kind !== 'pitch') return true; const t = named(r, ph, R, 'cue'); return !!t && Math.abs(t.dev) >= 0.4 && pointsAt(r.cue.dir, t.dev); }],
  ['a timing cue’s start sung off, the way it points', (r, ph, R) => { if (r.cue?.kind !== 'timing' || r.cue.j == null) return true; const t = named(r, ph, R, 'cue'); return !!t && Math.abs(t.moved) >= 0.1 && pointsAt(r.cue.dir, t.moved); }],
  ['a missed cue’s note not sung', (r, ph, R) => r.cue?.kind !== 'missed' || r.cue.j == null || named(r, ph, R, 'cue') === null],
];

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
  { name: 'a pause before “how” (the rest of the line in time after it)', line: 0, w: 7, word: 'how', plan: { jit: { 7: 0.5, 8: 0.5, 9: 0.5, 10: 0.5 } }, wp: 'WP2', want: [X.cue('timing', 7, 'sooner'), ['♩ one start off', (r) => r.counts?.beats === 7]] },
  { name: 'a longer pause before “the” (0.7 s; the rest in time after it)', line: 0, w: 9, word: 'the', plan: { jit: { 9: 0.7, 10: 0.7 } }, wp: 'WP2', want: [X.cue('timing', 9, 'sooner'), X.notesAll] },
  { name: '“sweet” held long (0.6 s; the rest in time after it)', line: 0, w: 8, word: 'sweet', plan: { starts: { 9: 0.6, 10: 0.6 } }, wp: 'WP2', want: [X.cue('held', 8, 'sooner'), X.notesAll] },
  { name: '“grace” cut short (the rest of the line in time after it)', line: 0, w: 6, word: 'grace!', plan: { starts: { 7: -0.4, 8: -0.4, 9: -0.4, 10: -0.4 } }, wp: 'WP2', want: [X.cue('held', 6, 'later')] },
  { name: '“zing”’s 2nd note dropped', line: 0, w: 4, word: '', plan: { drop: [4] }, wp: 'WP2', want: [X.cue('missed', 4)] },
  // (a short note left out between two sung ones — their edges fill a third of its window, none of it its pitch)
  { name: 'L1 “like”’s 2nd note dropped', line: 1, w: 8, word: '', plan: { drop: [8] }, wp: 'WP2', want: [X.cue('missed', 8), ['“both notes”', (r) => /sing both notes/.test(r.cue?.text || '')]] },
  { name: 'stops after note 6', line: 0, plan: { stop: 6 }, wp: 'WP2', want: [X.cue('short'), ['2+ not reached', (r) => r.notReached >= 2]] },
  // (stopped early: the line's rest isn't squeezed into what was sung — a note or two more landing on a pitch by
  // chance, nothing left "not reached", the attempt a baseline — and a share is of the notes reached)
  { name: 'stops after note 2 (three notes sung)', line: 0, plan: { stop: 2 }, wp: 'WP2', want: [X.cue('short'), X.b(1)] },
  { name: 'L1 stops after note 3', line: 1, plan: { stop: 3 }, wp: 'WP2', want: [X.cue('short'), X.b(1), ['not a baseline', (r) => !r.whole && r.notReached >= 2]] },
  { name: 'all −300¢ (another key), stops after note 6', line: 0, plan: { all: -300, stop: 6 }, wp: 'WP2', want: [X.cue('key', null, 'lower'), X.keyS(-3), X.noNotes] },
  { name: 'a false start (3 notes, 1 s)', line: 0, plan: { false: { n: 3, gap: 1 } }, wp: 'WP2', want: [X.notesAll, X.beatsAll] },
  // (in free time the singer ends the line: a long last note let go early, or ■ Done tapped while it still sounds, is
  // that note sung — not missed, not a start off, and the singer's tempo isn't squeezed to fit it)
  { name: 'L3 “see.” (6 s) let go after 1.2 s', line: 3, w: 8, word: 'see.', plan: { held: 1.2 }, wp: 'WP2', want: [X.notesAll, X.beatsAll, X.win('spot'), X.b(1)] },
  { name: '■ Done 1 s before “sound!” ends, still singing', line: 0, plan: { done: -1 }, wp: 'WP2', want: [X.notesAll, X.beatsAll, X.win('spot')] },
  { name: 'silent', line: 0, plan: { silent: true }, wp: 'WP0', want: [X.cue('silent'), ['no counts', (r) => !r.counts]] },
  // (rule 4: what can't be followed says so — no counts, no win, nothing to fix that isn't there)
  { name: 'another tune (every note a few semitones off)', line: 0, plan: { wrong: { 0: 5, 1: -4, 2: 6, 3: -3, 4: 4, 5: 7, 6: -5, 7: 3, 8: -6, 9: 5, 10: 4 } }, wp: 'WP2', want: [X.cue('nofit'), ['no counts, no win', (r) => !r.counts && !r.win]] },
  { name: 'far too slow (×2.6)', line: 0, plan: { f: 2.6 }, wp: 'WP2', want: [X.cue('nofit'), ['no counts, no win', (r) => !r.counts && !r.win]] },
  { name: 'a whisper (vol 0.012)', line: 0, plan: { vol: 0.012 }, wp: 'WP0', want: [X.cue('silent')] },
  // (our own ▶'s last note still in the mic, quieter than a voice — under MIN_RMS, over a calibrated device's gate —
  // right before the singer starts: rule 1 keeps it out of the attempt)
  { name: 'the ▶’s tail in the mic just before (a calibrated device)', line: 0, plan: { tail: { m: 63, d: 0.6, gap: 0.1, level: 0.11 }, gate: 0.004 }, wp: 'WP2', want: [X.notesAll, X.beatsAll, X.win('spot')] },
  // (after another attempt at the line — as the page keeps it: the last whole one, at this speed)
  { name: 'fixed: “zing” +100¢, then right (“sweet” off)', line: 0, before: { cents: { 3: 100 } }, plan: { cents: { 8: -150 } }, wp: 'WP2', want: [X.win('fixed', 3), X.cue('pitch', 8, 'higher')] },
  { name: 'rose: two notes off, then one', line: 0, before: { cents: { 3: 100, 8: -150 } }, plan: { cents: { 8: -150 } }, wp: 'WP2', want: [X.win('rose'), ['♪ up', (r) => !!r.up?.notes]] },
  { name: 'in another key after a cue on a note: not “right on it now”', line: 0, before: { cents: { 2: -200 } }, plan: { all: -300 }, wp: 'WP2', want: [X.win('key'), X.cue('key', null, 'lower')] },
  { name: 'spot on twice running', line: 0, before: {}, plan: {}, wp: 'WP2', want: [X.win('spot'), ['twice', (r) => r.win?.sub === 'again']] },
  { name: 'never the same win twice (“the” off both times)', line: 0, before: { cents: { 9: -150 } }, plan: { cents: { 9: -150 } }, wp: 'WP2', want: [['a win, not the one before', (r, ph, R) => !!r.win && !!R.before?.win && (r.win.kind !== R.before.win.kind || r.win.j !== R.before.win.j)], X.cue('pitch', 9, 'higher')] },
  { name: 'not compared after an early stop', line: 0, before: { stop: 6 }, plan: { cents: { 8: -150 } }, wp: 'WP2', want: [['no rose', (r) => r.win?.kind !== 'rose' && !r.up?.notes && !r.up?.beats]] },
  // (the personas' other singers: none of these changes the answer)
  { name: 'quiet (vol 0.03)', line: 0, plan: { vol: 0.03 }, wp: 'WP0', want: [X.notesAll, X.beatsAll] },
  { name: 'a hum 0.4 s before', line: 0, plan: { hum: { m: 57, d: 0.4 } }, wp: 'WP0', want: [X.notesAll, X.beatsAll] },
  { name: 'on into the next line (3 notes)', line: 0, plan: { extra: 3 }, wp: 'WP0', want: [X.notesAll, X.beatsAll] },
  { name: 'on through the whole next line', line: 0, plan: { extra: 10 }, wp: 'WP2', want: [X.notesAll, X.beatsAll] },
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
  // (a case `before` another attempt: that one's result kept as the page keeps it — EAR.last, only a whole attempt)
  const lastOf = (x) => (x?.whole ? { counts: x.counts, whole: true, win: x.win && { kind: x.win.kind, j: x.win.j, sub: x.win.sub }, cue: x.cue && { kind: x.cue.kind, j: x.cue.j } } : null);
  const runs = VARIANTS.map((v) => { const b = c.before ? round(AG, ph, c.before, v).res : null, x = round(AG, ph, c.plan, b ? { ...v, prev: lastOf(b) } : v); x.before = b; return x; });
  const R = runs[0], r = R.res;
  R.beats = mode === 'Beats';
  const failed = [...c.want, ...TRUTH].filter(([, fn]) => !fn(r, ph, R)).map(([w]) => w);
  const same = runs.every((x) => verdict(x.res) === verdict(r));
  const judged = DONE.has(c.wp);
  out.push(`${judged ? '     ' : 'todo '}${label}: ${short(r, ph)}${same ? '' : '  [again: ' + runs.slice(1).map((x) => short(x.res, ph)).join(' / ') + ']'}`);
  if (V) {
    const g = mode === 'Line' ? r.fit?.g : R.grades?.slice(ph.j0, ph.j1);
    for (let i = 0; i < ph.j1 - ph.j0; i++) {
      const n = AG.notes[ph.j0 + i], x = g?.[i], rn = r.rn?.[i];
      const sx = r.starts?.[i];
      out.push(`       ${i} ${(n.text || '·').padEnd(8)} ${n.name.padEnd(4)} ${x ? `${x.status}${x.dev != null ? ` ${Math.round(x.dev * 100)}¢` : ''}${x.shift != null ? ` ${x.shift.toFixed(2)}s` : ''}` : '–'}${rn ? ` | ${rn.cls ?? '–'} dev ${rn.dev?.toFixed(3) ?? '–'} rdev ${rn.rdev?.toFixed(3) ?? '–'}` : ''}${sx ? ` | start ${sx.on ? 'on' : 'off'} ${sx.measured ? `${sx.kind} r ${sx.r?.toFixed(3)}` : 'unmeasured'}` : ''}`);
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
    const start = (w) => { if (next >= ks.length) { w.ended = true; w.terminate(); if (!--running) done(); return; } w.postMessage(ks[next++]); };
    for (let i = 0; i < jobs; i++) {
      const w = new Worker(new URL(import.meta.url), { env: process.env });
      running++;
      w.on('message', (x) => { results[x.k] = x; slowest = Math.max(slowest, x.ms); flush(); start(w); });
      w.on('error', reject);
      w.on('exit', (code) => { if (!w.ended) reject(new Error(`a worker stopped (exit ${code})`)); }); // (never a wait that doesn't end)
      start(w);
    }
  });
  console.log(`(the slowest judgment ${slowest.toFixed(0)} ms)`);
  const todos = Object.entries(todo).map(([k, v]) => `${k} ${v.length}`).join(', ');
  console.log(`${pass} passed, ${fail} failed${todos ? `, todo: ${todos}` : ''}`);
  process.exitCode = fail ? 1 : 0;
}
