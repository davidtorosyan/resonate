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
// when it already passes. WP2–WP4 turn theirs on. Notes (WP4): a note held as the page's mic would hear it →
// pitch.js frames → ear.js holdStep frame by frame and holdVerdict at the 1st, 2nd and 3rd miss, as sing.js earNote
// runs them (the fix plan's Notes table); noteTargets after a Line attempt. The lines are the fix plan's (Q-A: the
// printed lines, PLAN_PHRASE), compared with the page's own (ear.js EAR_PHRASE) as a WP1 case. Every case also
// checks a win or cue that names a note against what the singer did there (TRUTH: no win from a note sung wrong or
// late, no cue pointing the wrong way or at a note sung right). A case may be sung `before` another attempt at the
// line: that one's result is handed on as the page keeps it (EAR.last: only a whole attempt) — "fixed now", "more
// than last time", "twice running", never the same win twice. Line plans may also carry `tail` (our own ▶'s last
// note in the mic, on a calibrated device: `gate`) — node only — and `wait` (ms before the first note, as earprobe's).
// Two voices (round 2's WP0): rhythmsynth's (formants, consonants, a scoop, melisma glides — every case) and the
// browser's (`saw`: earsinger.cjs render() — the probes' sawtooth, every note its own attack after a 40 ms gap, no
// consonant, no scoop; three of round 2's blockers showed only with it): a case marked `saw` is sung with both, and
// each must give the wanted answer (saw: '<tag>' — the browser's voice is judged once that package lands).
// The owner's songs (OWN, below): cases on lines of their songs — a note named by its index in the song, never its
// words — run only with EAR_NOTES (the dumps, outside the repo); without them each prints "skip" (CLAUDE.md: a
// skip is a gap to close before shipping).
// usage: node earcases.mjs   (V=1: each case's notes; ONLY=<regex>: some cases — ONLY='^Notes$': the holds alone, ONLY=saw: the
//   cases sung with the browser's voice too, ONLY=owner: the owner's; TODO=0: hide the todo lines; VOICES=saw (or synth,saw): every
//   case sung with those voices — a survey: what the browser's voice changes (judged as each case's saw tag, else its wp);
//   JOBS=n: cases sung on n threads, default 3 — the page's pitch detector over an attempt takes ~2.5 s a run;
//   PLANS='[…]' or @file.json: earprobe's plans in node instead of the cases — below)
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { sing, rng } from './rhythmsynth.mjs';
import { features, frames } from './rhythmharness.mjs';
import { loadSong, fixtureNames } from './fixturelib.mjs';
import earsinger from './lib/earsinger.cjs';
import earsum from './lib/earsum.cjs';
import { findClicks } from '../public/rhythm.js';
import * as TR from '../public/takerhythm.js';
import { clickWave, CLICK_GAIN } from '../public/piano.js';
import { gradeTake, MAX_SHIFT } from '../public/grade.js';
import { MIN_RMS, ANALYSIS_LAG, FFT_SIZE } from '../public/pitch.js';
import { noteName } from '../public/music.js';
import { PRACTICE, groupPhrases } from '../public/practice.js';
import { EAR_PHRASE, judgeFree, judgeBeats, wordOf, countSets, gateFrames, EAR_HOLD, holdStart, holdStep, holdVerdict, noteTargets, earText, plainOf,
  EAR_STORE, attemptOf, addAttempt, securedOf, secure, prevFrom, lastFrom, wordTokens, ownSpan } from '../public/ear.js';
import { phraseKeys } from '../public/practice.js';

const { segments, render, madeOf } = earsinger;
const { summary, spotWhy } = earsum;
// the work packages landed: their cases are judged (round 1's WP0–WP6; round 2's R2-0 … R2-3 — the Ear fix plan, round 2)
const DONE = new Set(['WP0', 'WP1', 'WP2', 'WP3', 'WP4', 'WP5', 'WP6', 'R2-0']);
const V = !!process.env.V, ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null, SHOW_TODO = process.env.TODO !== '0';
const VOICES = process.env.VOICES ? process.env.VOICES.split(',') : null;

let pass = 0, fail = 0;
const todo = {};
const check = (name, ok, detail = '') => { if (ok) pass++; else { fail++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); } };

// ---------------------------------------------------------------------------
// The songs and their lines

const PLAN_PHRASE = { ...EAR_PHRASE, maxSyl: 8 }; // the fix plan's lines (Q-A default: the printed line, ≤ 8 syllables; WP1.12)
function songOf(name, dir) {
  const s = loadSong(name, dir ? { dir } : {});
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
// The owner's songs (PLAY_SCORES: their converted MusicXML, never in the repo), dumped as the page reads them —
// OUT=$PLAY_SCORES/notes node dumpnotes.cjs $PLAY_SCORES/*.musicxml (or EAR_NOTES=<dir>): each song's lines, their
// lengths at a glance (every line with V=1; the long and the short ones always).
const OWN_DIR = process.env.EAR_NOTES || (process.env.PLAY_SCORES ? path.join(process.env.PLAY_SCORES, 'notes') : null);
if (isMainThread && OWN_DIR) {
  const names = fs.existsSync(OWN_DIR) ? fixtureNames(OWN_DIR) : [];
  if (!names.length) console.log(`skip: the owner's songs' lines — no dumps in ${OWN_DIR} (OUT=${OWN_DIR} node dumpnotes.cjs $PLAY_SCORES/*.musicxml first)`);
  for (const name of names) {
    const S = songOf(name, OWN_DIR), ls = S.page;
    const sec = ls.map((ph) => S.notes[ph.j1 - 1].t + S.notes[ph.j1 - 1].d - S.notes[ph.j0].t), mid = [...sec].sort((a, b) => a - b)[Math.floor(sec.length / 2)];
    console.log(`${S.title} (${name}): ${ls.length} lines · ${Math.min(...sec).toFixed(1)}–${Math.max(...sec).toFixed(1)} s (median ${mid?.toFixed(1)}) · ${Math.min(...ls.map((p) => p.syl))}–${Math.max(...ls.map((p) => p.syl))} syl${ls.length <= 10 ? ' — the dots' : ' — the first words ▾'}`);
    ls.forEach((ph, i) => { if (V || sec[i] > 12 || sec[i] < 2) console.log(`  L${i} ${lineText(S, ph)}${sec[i] > 12 ? '  (long)' : sec[i] < 2 ? '  (short)' : ''}`); });
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
// The store and the lines (WP6): attempts kept per line (by its wk), secured marks, "last time" read back,
// Pick words' words and spans — the page's own code (sing.js earShow / earPrev / earShown, the Lines sheet)

if (isMainThread) {
  const ph = AG.plan[0];
  const R = (all, b = all) => ({ whole: true, counts: { notes: all ? 11 : 9, notesAll: all, beats: b ? 8 : 6, beatsAll: b }, win: all ? { kind: 'spot' } : { kind: 'high', j: ph.j0 + 6 }, cue: all ? null : { kind: 'pitch', j: ph.j0 + 8, dir: 'higher', size: 'aim' } });
  let at = 1;
  const rec = (seq, kind = 'line') => seq.reduce((r, x) => secure(addAttempt(r, attemptOf(x, ph, { kind, rate: 1, tr: 0, at: at++ })), at), null);
  const sec = (r) => { const x = securedOf(r); return `${x.beats ? '♩' : ''}${x.notes ? '♪' : ''}`; };
  check('store: secured after 2 of the last 3 “all” (♩ and ♪)', sec(rec([R(true), R(false), R(true)])) === '♩♪' && sec(rec([R(true), R(false), R(false)])) === '' && sec(rec([R(false), R(true), R(true)])) === '♩♪', [sec(rec([R(true), R(false), R(true)])), sec(rec([R(true), R(false), R(false)]))].join(' / '));
  const kept = rec([R(true), R(true), R(false), R(false), R(false)]);
  check('store: a mark once earned stays (a bad day doesn’t take it back)', !securedOf(kept).notes && !!kept.sec?.n && !!kept.sec?.b, JSON.stringify(kept.sec));
  check('store: ♩ from Beats too, ♪ only from Line', (() => { const r = rec([R(true), R(true)], 'beats'); return securedOf(r).beats && !securedOf(r).notes; })());
  check('store: a key sung elsewhere doesn’t secure ♪', (() => { const k = { ...R(true), counts: { notes: null, notesAll: false, beats: 8, beatsAll: true } }; const r = rec([k, k, k]); return securedOf(r).beats && !securedOf(r).notes && attemptOf(k, ph).n === undefined; })());
  const many = rec(Array.from({ length: 9 }, () => R(true)));
  check(`store: the last ${EAR_STORE.keep} of each kind kept`, many.a.length === EAR_STORE.keep && addAttempt(many, attemptOf(R(true), ph, { kind: 'beats', at: 99 })).a.length === EAR_STORE.keep + 1);
  check('store: not kept — not whole, nothing counted', attemptOf({ ...R(true), whole: false }, ph) === null && attemptOf({ whole: true, counts: null }, ph) === null);
  // (read back: the win and the cue's notes as offsets — on another place of the same line, a repeat, they're there)
  const one = addAttempt(null, attemptOf(R(false), ph, { kind: 'line', rate: 1, tr: 0, at: 5 }));
  const rep = { j0: 100, j1: 111 }, pv = prevFrom(one, 'line', 1, rep);
  check('store: last time read back on a repeat of the line (its notes there)', pv?.win?.j === 106 && pv?.cue?.j === 108 && pv.counts.notes === 9 && pv.whole, JSON.stringify(pv));
  check('store: last time at another speed isn’t this one', prevFrom(one, 'line', 0.8, ph) === null && prevFrom(one, 'beats', 1, ph) === null);
  const lt = lastFrom(one, 'line', 0, ph);
  check('store: “Last time” — its words as the page says them, in that key only', lastFrom(one, 'line', -3, ph) === null && plainOf(earText(lt, { notes: AG.notes, name: (m) => noteName(m, AG.flats), old: true }).cue) === '“sweet” — aim higher', JSON.stringify(lt));
  // Pick words: the words of a line, whole; a span from the first to the last, ≥ 2 words, ≤ ownMax syllables
  const tok = wordTokens(AG.notes, 0, AG.notes.length);
  check('Pick words: the song’s words, whole (a melisma’s notes in its word)', tok.length === 26 && tok[0].text === 'Amazing' && tok[0].j0 === 0 && tok[0].j1 === 6 && tok[1].text === 'grace!' && tok.map((w) => w.text).slice(3, 6).join(' ') === 'sweet the sound!', tok.map((w) => `${w.text}[${w.j0}-${w.j1 - 1}]`).slice(0, 8).join(' '));
  const sp = ownSpan(AG.notes, tok, 3, 5);
  check('Pick words: “sweet” … “sound!” → a line of 3 notes', sp?.j0 === 8 && sp.j1 === 11 && sp.syl === 3, JSON.stringify(sp));
  check(`Pick words: ≥ 2 words, ≤ ${EAR_STORE.ownMax} syllables`, ownSpan(AG.notes, tok, 3, 3) === null && ownSpan(AG.notes, tok, 5, 3) === null && ownSpan(AG.notes, tok, 3, 18)?.syl === 16 && ownSpan(AG.notes, tok, 3, 19) === null);
  const js = [8, 9, 10];
  check('Pick words: its own key (music + words) — not a printed line’s', phraseKeys(AG.notes, js).wk !== ph.wk && phraseKeys(AG.notes, js).wk === phraseKeys(AG.notes, js).wk);
  check('Pick words: a song without words — a note each', (() => { const ns = AG.notes.slice(0, 6).map((n) => ({ ...n, text: undefined, syllabic: undefined })); const t = wordTokens(ns, 0, 6, (j) => `n${j}`); return t.length === 6 && t[2].text === 'n2'; })());
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

const LEAD = 1.3; // the singer's first note, s after the mic opened (earprobe: ■ Done shows, then 1 s — a plan's `wait` ms: 0.3 s + wait)
const SHOWN = LEAD - 1; // (■ Done shows: earprobe gives the singer its plan then — talking starts there)
// vol: the browser singer's gain — its sawtooth's RMS is ≈ 0.56 × vol (0.012: under MIN_RMS, never heard; 0.03:
// heard) — as rhythmsynth's vowel level (RMS ≈ 0.075 in the singing range); none: rhythmsynth's own level.
const loudOf = (plan) => (plan.vol != null ? (0.56 * plan.vol) / 0.075 : 1);
// ● Sing (Line) on a phrase: → the result, the frames, the singer's notes. As earFree hands it over: the frames, the
// recording's features (its first sample at the attempt's 0 s), the song's meter and own tempo. tail: { m, d, gap,
// level } — our own ▶'s last note still in the mic (a speaker, quieter than a voice: under MIN_RMS), ending `gap` s
// before the singer starts, on a calibrated device (the reader's gate under MIN_RMS: `gate`), with the page's
// gateUntil (rule 1) at its end + 0.1 s — or, gateUntil: false, without it.
// voice: 'synth' (rhythmsynth) or 'saw' (the browser's: earsinger render(), no room noise — the fake mic has none).
// talk (or mode 'talk'): the browser's noise bursts instead of singing, either voice — from ■ Done showing (earprobe sets
// the talk plan then; its noise doesn't wait for `wait`) to ■ Done.
const talking = (plan) => plan.mode === 'talk' || !!plan.talk;
const tickOf = (seed) => (seed * 0.00137) % 0.005; // (where the singer's 5 ms ticks fall: another seed, another phase)
function lineRound(S, ph, plan, { phase = 0, seed = 7, prev = null, voice = 'synth' } = {}) {
  const f = plan.f || 1, lead = plan.wait != null ? SHOWN + plan.wait / 1000 : LEAD;
  const ns = S.notes.slice(ph.j0, Math.min(S.notes.length, ph.j1 + (plan.extra || 0)));
  const segs = plan.silent || talking(plan) ? [] : segments(plan, ns, f);
  const sung = sungNotes(plan, ns, segs, lead);
  if (plan.hum && sung.length) sung.unshift({ i: -1, t: lead - 0.3 - plan.hum.d, d: plan.hum.d, midi: plan.hum.m, text: '', melisma: false, restBefore: true });
  const tail = plan.tail && { t: lead - plan.tail.gap - plan.tail.d, d: plan.tail.d, midi: plan.tail.m, text: '', melisma: false, restBefore: true, i: -2 };
  if (tail) sung.unshift(tail);
  const lastE = segs.length ? Math.max(...segs.map((o) => o.e)) : (S.notes[ph.j1 - 1].t + S.notes[ph.j1 - 1].d - S.notes[ph.j0].t) * f;
  const endT = lead + lastE + (plan.done ?? 0.7); // (■ Done 0.7 s after the singer's last note — `done`: negative, while still singing)
  const vol = loudOf(plan);
  const saw = voice === 'saw';
  // (the saw: only our own ▶'s tail is rhythmsynth's — the singer, the hum and talking are rendered after)
  const r = sing(saw ? (tail ? [tail] : []) : sung, { songT0: 0, rt: 0, until: endT, vibrato: plan.vib ?? 0, noise: saw ? 0 : 0.002, seed, loud: (j) => (saw || sung[j]?.i === -2 ? plan.tail?.level ?? 1 : vol) });
  if (saw || talking(plan)) render(saw ? plan : { mode: 'talk' }, saw && segs.length ? madeOf(segs) : null, { audio: r.audio, sr: r.sr, t0: lead, from: talking(plan) ? SHOWN : 0, to: endT, free: true, tick: tickOf(seed), rand: rng(seed) });
  const fr = frames(r.audio, r.sr, { songT0: 0, latency: 0, fps: 60, from: FFT_SIZE / r.sr + phase, to: endT, gate: plan.gate });
  const ctx = { notes: S.notes, spq: S.spq, spq0: S.spq, name: (m) => noteName(m, S.flats), score: S.score, qToT: (q) => q * S.spq, feat: features(r.audio, r.sr), start: 0,
    gateUntil: tail && plan.gateUntil !== false ? tail.t + tail.d + 0.1 : undefined, prev };
  const t0 = performance.now();
  const res = judgeFree(ph, fr, endT, ctx);
  return { res, ms: performance.now() - t0, frames: fr, sung, truth: truthOf(plan, ns, segs, sung, false), voice };
}

// ● Sing with the click (Beats) on a phrase, as startSing(part) runs it. rig: the phone's speaker by default
// (the clicks reach the mic: the trip measured), { clickLevel: 0 } headphones (the browser's estimate only).
// out: the output latency the browser reports (Beats' Bluetooth check: uncalibrated with ≥ 0.12 s); a plan's
// label: the mic track's (earsinger's `label`: "AirPods").
const RIG = { rt: 0.07, est: 0.04, clickLevel: 0.3, out: 0.01 };
// The route as sing.js hands it to judgeBeats (the fix plan's WP2.6: ctx.route = { bt }): a Bluetooth-looking mic
// track, or an uncalibrated take on an output reporting ≥ 0.12 s.
const BT_LABEL = /airpods|bluetooth|buds|hands-?free|headset/i;
const routeOf = (label, cal, out) => ({ bt: BT_LABEL.test(label || '') || (!cal && out >= 0.12), label: label ?? null });
function beatsRound(S, ph, plan, { phase = 0, seed = 7, prev = null, voice = 'synth' } = {}) {
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
  const saw = voice === 'saw';
  const r = sing(saw ? [] : sung, { songT0, rt: rig.rt, clicks: [...countClicks.map((c) => ({ t: c.t - songT0, accent: c.accent })), ...guide], clickLevel: rig.clickLevel, noise: saw ? 0 : 0.002, until, vibrato: plan.vib ?? 0, seed, loud: () => vol });
  // (the browser's singer sings on the song clock as the page shows it — nowT less `late` —, heard rt later)
  if (saw) render(plan, madeOf(segs), { audio: r.audio, sr: r.sr, t0: songT0 + rig.rt + notes[ph.j0].t + (plan.late || 0), free: false, tick: tickOf(seed), rand: rng(seed) });
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
  // (as earBeats hands it over: the take as finishSing leaves it — frames and the recording on the song clock as
  // heard —, the session's features, the meter, the last whole Beats attempt here)
  const ctx = { notes, spq, spq0: S.spq, name: (mm) => noteName(mm, S.flats), score: sc, qToT, feat, start: -songT0 - latency, prev, route: routeOf(plan.label, !!cal, rig.out) };
  const t1 = performance.now();
  const res = judgeBeats(ph, { rhythm, frames: fr, grades, endT, voice: { start: -songT0 - latency } }, ctx);
  return { res, ms: performance.now() - t1, cal, rhythm, grades, sung, truth: truthOf(plan, ns, segs, sung, true), count, beatSec, voice };
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
  // (WP5: what the screen says — ear.js earText: { win, cue, counts, tempo, sounds, next, u (the underlined syllables) };
  // a string is the exact words, a RegExp a pattern, null: none)
  say: (want) => [`says ${JSON.stringify(want, (k, v) => (v instanceof RegExp ? String(v) : v))}`, (r, ph, R) => {
    const w = wordsOf(r, ph, R);
    return Object.entries(want).every(([k, v]) => {
      const got = w[k];
      if (v === null) return got === null || (Array.isArray(got) && !got.length);
      if (v instanceof RegExp) return v.test(Array.isArray(got) ? got.join(' · ') : got ?? '');
      return Array.isArray(v) ? JSON.stringify(got) === JSON.stringify(v) : got === v;
    });
  }],
};
// (the owner's cases name a note by its index in the song)
const XS = {
  cue: (k, j, dir) => [`cue ${k} on #${j}${dir ? ` ${dir}` : ''}`, (r) => r.cue?.kind === k && r.cue.j === j && (!dir || r.cue.dir === dir)],
  notSpot: ['never “Spot on”', (r) => r.win?.kind !== 'spot'],
};
// The screen's words for a result (as sing.js's earTextOf hands it over: the attempt's recording here, the Key menu
// able to move the song, the line's tempo heard — the score's ♩). R.S: the case's song, R.lines its lines.
function wordsOf(r, ph, R) {
  const S = R.S || AG, lines = R.lines || AG.plan;
  const T = earText({ ...r, kind: R.beats ? 'beats' : 'line', youAt: [0, 1] }, { notes: S.notes, name: (m) => noteName(m, S.flats), bpm: 60 / S.spq, voice: true, shift: (s) => Math.abs(s) <= 12, lastLine: lines.findIndex((x) => x.j0 === ph.j0) === lines.length - 1 });
  return { win: T.win && plainOf(T.win), cue: T.cue && plainOf(T.cue), counts: T.counts.map((c) => `${c.icon === 'beat' ? '♩' : '♪'} ${c.text}`), tempo: T.tempo?.text ?? null,
    sounds: T.sounds.map((x) => x.label), next: T.next?.label ?? null, u: [...(T.win || []), ...(T.cue || [])].filter((x) => typeof x !== 'string').map((x) => x.u), T };
}
// Every result's words (CLAUDE.md "Feedback coaches; it doesn't grade"; the fix plan's words tables): no %, no fraction,
// no digit outside a count, a note name or the tempo line; no fail / wrong / score; a count is "all" or a number ≥ 1
// with its unit — never "—", "0" or "↑"; a win starts with ✓; one next chip at most, and it only switches.
const NOTE = /[A-G](?:♭|♯|𝄫|𝄪)?-?\d/g;
const WORDS = [
  ['the words: nothing grade-like', (r, ph, R) => { const w = wordsOf(r, ph, R); const said = [w.win, w.cue, w.next, ...w.sounds].filter(Boolean); return said.every((t) => !/%|\/|fail|wrong|score|↑/i.test(t) && !/\d/.test(t.replace(NOTE, ''))); }],
  ['the words: counts with their units, never 0', (r, ph, R) => wordsOf(r, ph, R).counts.every((c) => /^[♩♪] (all|[1-9]\d*) (on the beat|in tune|on the click)$/.test(c))],
  ['the words: a win starts with ✓, the tempo line only Line’s', (r, ph, R) => { const w = wordsOf(r, ph, R); return (!w.win || w.win.startsWith('✓ ')) && (!w.tempo || (!R.beats && /^You sang it at ♩=\d+$/.test(w.tempo))); }],
  ['the words: the next chip — practise / clicks / next line / on your own', (r, ph, R) => { const w = wordsOf(r, ph, R); return w.next === null || ['Practise that note ›', 'Try it with the clicks ›', 'Next line ›', 'Now on your own ›'].includes(w.next); }],
];

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
  // (Beats: a win naming the word its cue is about reads as a contradiction — “Steady from “Amazing”…” · “Come in
  // sooner on “Amazing””; a run names whole words: from a word's first syllable to a word's last)
  ['a Beats win never names the cue’s word', (r, ph, R) => { if (!R.beats || !r.win || r.cue?.j == null) return true; const k = (j) => wordOf(j, (R.S || AG).notes)?.w0 ?? j; return [r.win.j, r.win.j2].every((j) => j == null || k(j) !== k(r.cue.j)); }],
  ['a Beats run from a word’s start to a word’s end', (r, ph, R) => { if (r.win?.kind !== 'run') return true; const ns = (R.S || AG).notes, a = wordOf(r.win.j, ns), z = wordOf(r.win.j2, ns); return (!a || a.w0 === a.j0) && (!z || z.w1 === z.j0); }],
];

// The cases. line: the fix plan's line (PLAN_PHRASE's); word: the text of the note at index `w` the case is about —
// checked, so a case and its line can't drift apart.
const LINE = [];
// (wp 'WP0': today's code already gets it right — a guard while WP2–WP4 rebuild the judgments)
// (saw: the browser's voice too — a few of round 1's cases, guards that it agrees; ~15 in all, so the fast tier keeps its time)
for (const f of [0.9, 1, 1.1, 1.3, 1.7, 2]) LINE.push({ name: `all right ×${f}`, line: 0, plan: { f }, wp: [0.9, 1.3].includes(f) ? 'WP0' : 'WP2', ...(f === 1 ? { saw: true } : {}), want: [X.notesAll, X.beatsAll, X.win('spot'), X.b(f), X.say({ win: '✓ Spot on', counts: ['♩ all on the beat', '♪ all in tune'], cue: null, sounds: ['▶ You'], next: 'Next line ›', tempo: Math.abs(1 / f - 1) <= 0.1 ? null : new RegExp(`^You sang it at ♩=(${[-1, 0, 1].map((d) => Math.round(80 / f) + d).join('|')})$`) })] });
for (const f of [1, 1.1, 1.2, 1.4]) LINE.push({ name: `L2 all right ×${f}`, line: 2, plan: { f }, wp: [1, 1.2].includes(f) ? 'WP0' : 'WP2', want: [X.notesAll, X.beatsAll, X.noTiming] });
for (const c of [-300, -500, 200, 100]) LINE.push({ name: `all ${c > 0 ? '+' : ''}${c}¢ (another key)`, line: 0, plan: { all: c }, wp: 'WP2', want: [X.noNotes, X.win('key'), X.cue('key', null, c < 0 ? 'lower' : 'higher'), X.keyS(c / 100), X.say({ win: '✓ The tune was right', cue: c < 0 ? 'Started lower than the piano' : 'Started higher than the piano', sounds: ['▶ You', c < 0 ? 'Lower the song' : 'Raise the song'], counts: /^(♩ (all|\d+) on the beat)?$/, next: null })] });
LINE.push(
  { name: 'all −70¢', line: 0, plan: { all: -70 }, wp: 'WP2', want: [X.cue('offset', null, 'higher'), X.beatsAll, X.say({ cue: 'A little low all the way', sounds: ['▶ You'], next: null })] },
  { name: 'all +45¢', line: 0, plan: { all: 45 }, wp: 'WP2', want: [X.notesAll, X.cue('sag', null, 'lower'), X.say({ cue: 'A touch high all the way', sounds: ['▶ You'], next: null })] },
  { name: 'drift −40¢', line: 0, plan: { drift: -40 }, wp: 'WP2', want: [X.notesAll, X.cue('sag', null, 'higher'), X.say({ cue: /^A touch low (all the way|by the end)$/ })] },
  { name: 'drift −80¢', line: 0, plan: { drift: -80 }, wp: 'WP0', want: [X.neverDir('lower'), ['the cue points higher', (r) => r.cue?.dir === 'higher']] },
  { name: '“zing” +100¢', line: 0, w: 3, word: 'zing', plan: { cents: { 3: 100 } }, wp: 'WP2', saw: true, want: [X.cue('pitch', 3, 'lower'), X.beatsAll, X.say({ cue: '“Amazing” — aim lower', u: ['zing'], sounds: ['▶ Piano', '▶ You'], next: 'Practise that note ›', counts: ['♩ all on the beat', '♪ 10 in tune'] })] },
  { name: 'L2 “but” +200¢ (on the next note’s F4)', line: 2, w: 6, word: 'but', plan: { cents: { 6: 200 } }, wp: 'WP2', want: [X.notNotesAll, X.cue('pitch', 6, 'lower'), X.beatsAll, X.say({ cue: '“but” — aim lower', u: [] })] },
  // (the browser's voice: B2's blocker below, one run in two — “Was” (second note) — much lower)
  { name: 'L3 “Was” +200¢ (on F4)', line: 3, w: 0, word: 'Was', plan: { cents: { 0: 200 } }, wp: 'WP2', saw: 'R2-1', want: [X.notNotesAll, X.cue('pitch', 0, 'lower'), X.beatsAll, X.say({ cue: '“Was” — aim lower', next: 'Practise that note ›' })] },
  // (round 2, B2's blocker — only with the browser's voice: a first note sung off had its start searched at the
  // pitch after it, the "step" that made took one start before it, and the notes before it were regraded onto their
  // neighbours: "“Amazing” (second note) — much lower" for a note sung right. rhythmsynth's voice glides into a
  // melisma's next note, the browser's gives it an attack of its own)
  { name: 'the first note −300¢', line: 0, w: 0, word: 'A', plan: { cents: { 0: -300 } }, wp: 'R2-0', saw: 'R2-1', want: [X.cue('pitch', 0, 'higher'), X.beatsAll, ['nothing cued or won on note 1', (r, ph) => r.cue?.j !== ph.j0 + 1 && r.win?.j !== ph.j0 + 1], X.say({ cue: '“Amazing” — much higher', u: ['A'] })] },
  { name: '“That” −300¢', line: 1, w: 0, word: 'That', plan: { cents: { 0: -300 } }, wp: 'R2-0', saw: 'R2-1', want: [X.cue('pitch', 0, 'higher'), X.say({ cue: '“That” — much higher' })] },
  { name: '“grace” in 0.25 s late', line: 0, w: 6, word: 'grace!', plan: { starts: { 6: 0.25 } }, wp: 'WP2', saw: true, want: [X.cue('timing', 6, 'sooner'), X.say({ cue: 'Come in sooner on “grace”', sounds: ['▶ Piano', '▶ You'], next: 'Try it with the clicks ›' })] },
  { name: '“grace” in 0.4 s late', line: 0, w: 6, word: 'grace!', plan: { starts: { 6: 0.4 } }, wp: 'WP2', want: [X.cue('timing', 6, 'sooner'), X.say({ cue: 'Come in sooner on “grace”' })] },
  { name: '“the” in 0.25 s late', line: 0, w: 9, word: 'the', plan: { starts: { 9: 0.25 } }, wp: 'WP2', want: [X.cue('timing', 9, 'sooner'), X.say({ cue: 'Come in sooner on “the”' })] },
  { name: '“sweet” in 0.25 s early', line: 0, w: 8, word: 'sweet', plan: { starts: { 8: -0.25 } }, wp: 'WP0', want: [X.cue('timing', 8, 'later'), X.say({ cue: 'Wait a bit before “sweet”', next: 'Try it with the clicks ›' })] },
  { name: '“grace” held long (rubato)', line: 0, w: 6, word: 'grace!', plan: { starts: { 7: 0.5, 8: 0.5, 9: 0.5, 10: 0.5 } }, wp: 'WP2', want: [X.cue('held', 6), X.say({ cue: '“grace” held long — keep the beat', sounds: ['▶ Piano', '▶ You'], next: 'Try it with the clicks ›' })] },
  { name: 'a pause before “how” (the rest of the line in time after it)', line: 0, w: 7, word: 'how', plan: { jit: { 7: 0.5, 8: 0.5, 9: 0.5, 10: 0.5 } }, wp: 'WP2', want: [X.cue('timing', 7, 'sooner'), ['♩ one start off', (r) => r.counts?.beats === 7]] },
  { name: 'a longer pause before “the” (0.7 s; the rest in time after it)', line: 0, w: 9, word: 'the', plan: { jit: { 9: 0.7, 10: 0.7 } }, wp: 'WP2', want: [X.cue('timing', 9, 'sooner'), X.notesAll] },
  { name: '“sweet” held long (0.6 s; the rest in time after it)', line: 0, w: 8, word: 'sweet', plan: { starts: { 9: 0.6, 10: 0.6 } }, wp: 'WP2', want: [X.cue('held', 8, 'sooner'), X.notesAll] },
  { name: '“grace” cut short (the rest of the line in time after it)', line: 0, w: 6, word: 'grace!', plan: { starts: { 7: -0.4, 8: -0.4, 9: -0.4, 10: -0.4 } }, wp: 'WP2', want: [X.cue('held', 6, 'later'), X.say({ cue: '“grace” cut short — hold it longer' })] },
  { name: '“zing”’s 2nd note dropped', line: 0, w: 4, word: '', plan: { drop: [4] }, wp: 'WP2', want: [X.cue('missed', 4), X.say({ cue: '“Amazing” — sing all three notes', u: ['zing'], sounds: ['▶ Piano', '▶ You'], next: 'Practise that note ›' })] },
  // (a short note left out between two sung ones — their edges fill a third of its window, none of it its pitch)
  { name: 'L1 “like”’s 2nd note dropped', line: 1, w: 8, word: '', plan: { drop: [8] }, wp: 'WP2', want: [X.cue('missed', 8), ['“both notes”', (r) => /sing both notes/.test(r.cue?.text || '')], X.say({ cue: '“like” — sing both notes' })] },
  { name: 'stops after note 6', line: 0, plan: { stop: 6 }, wp: 'WP2', want: [X.cue('short'), ['2+ not reached', (r) => r.notReached >= 2], X.say({ cue: 'Keep going to “sound”', sounds: ['▶ The rest'], next: null })] },
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
  { name: 'silent', line: 0, plan: { silent: true }, wp: 'WP0', want: [X.cue('silent'), ['no counts', (r) => !r.counts], X.say({ cue: 'Didn\'t hear you — sing a bit louder', counts: [], win: null, sounds: [], next: null })] },
  // (round 2, WP1.11: talking — the browser singer's noise bursts — isn't silence)
  { name: 'talking (loud, no pitch)', line: 0, plan: { talk: true }, wp: 'R2-1', want: [X.cue('talk'), ['no counts', (r) => !r.counts]] },
  // (rule 4: what can't be followed says so — no counts, no win, nothing to fix that isn't there)
  { name: 'another tune (every note a few semitones off)', line: 0, plan: { wrong: { 0: 5, 1: -4, 2: 6, 3: -3, 4: 4, 5: 7, 6: -5, 7: 3, 8: -6, 9: 5, 10: 4 } }, wp: 'WP2', want: [X.cue('nofit'), ['no counts, no win', (r) => !r.counts && !r.win], X.say({ cue: 'Couldn\'t follow that one', sounds: ['▶ Hear'], counts: [], next: null })] },
  { name: 'far too slow (×2.6)', line: 0, plan: { f: 2.6 }, wp: 'WP2', want: [X.cue('nofit'), ['no counts, no win', (r) => !r.counts && !r.win]] },
  { name: 'a whisper (vol 0.012)', line: 0, plan: { vol: 0.012 }, wp: 'WP0', want: [X.cue('silent')] },
  // (our own ▶'s last note still in the mic, quieter than a voice — under MIN_RMS, over a calibrated device's gate —
  // right before the singer starts: rule 1 keeps it out of the attempt)
  { name: 'the ▶’s tail in the mic just before (a calibrated device)', line: 0, plan: { tail: { m: 63, d: 0.6, gap: 0.1, level: 0.11 }, gate: 0.004 }, wp: 'WP2', want: [X.notesAll, X.beatsAll, X.win('spot')] },
  // (after another attempt at the line — as the page keeps it: the last whole one, at this speed)
  { name: 'fixed: “zing” +100¢, then right (“sweet” off)', line: 0, before: { cents: { 3: 100 } }, plan: { cents: { 8: -150 } }, wp: 'WP2', want: [X.win('fixed', 3), X.cue('pitch', 8, 'higher'), X.say({ win: '✓ “Amazing” right on it now', cue: '“sweet” — aim higher', u: ['zing'] })] },
  { name: 'rose: two notes off, then one', line: 0, before: { cents: { 3: 100, 8: -150 } }, plan: { cents: { 8: -150 } }, wp: 'WP2', want: [X.win('rose'), ['♪ up', (r) => !!r.up?.notes], X.say({ win: '✓ More in tune than last time' }), ['♪ drawn as risen', (r, ph, R) => wordsOf(r, ph, R).T.counts.some((x) => x.icon === 'note' && x.up)]] },
  { name: 'in another key after a cue on a note: not “right on it now”', line: 0, before: { cents: { 2: -200 } }, plan: { all: -300 }, wp: 'WP2', want: [X.win('key'), X.cue('key', null, 'lower')] },
  { name: 'spot on twice running', line: 0, before: {}, plan: {}, wp: 'WP2', want: [X.win('spot'), ['twice', (r) => r.win?.sub === 'again'], X.say({ win: '✓ Spot on — twice running' })] },
  { name: 'never the same win twice (“the” off both times)', line: 0, before: { cents: { 9: -150 } }, plan: { cents: { 9: -150 } }, wp: 'WP2', want: [['a win, not the one before', (r, ph, R) => !!r.win && !!R.before?.win && (r.win.kind !== R.before.win.kind || r.win.j !== R.before.win.j)], X.cue('pitch', 9, 'higher')] },
  { name: 'not compared after an early stop', line: 0, before: { stop: 6 }, plan: { cents: { 8: -150 } }, wp: 'WP2', want: [['no rose', (r) => r.win?.kind !== 'rose' && !r.up?.notes && !r.up?.beats]] },
  // (WP6: a line of the singer's own — Pick words: “sweet the sound!”, “That saved” — judged as any line; span: its notes)
  { name: 'own “sweet the sound!” all right', line: 0, span: [8, 11], plan: {}, wp: 'WP6', want: [X.notesAll, X.beatsAll, X.win('spot'), X.say({ win: '✓ Spot on', counts: ['♩ all on the beat', '♪ all in tune'], cue: null })] },
  { name: 'own “sweet the sound!”, “the” +200¢', line: 0, span: [8, 11], w: 1, word: 'the', plan: { cents: { 1: 200 } }, wp: 'WP6', want: [X.notNotesAll, X.cue('pitch', 1, 'lower'), X.say({ cue: '“the” — aim lower' }), ['the starts sung on time on (a short line: the fit\'s slack isn\'t a start off)', (r) => r.starts?.[0]?.on && r.starts?.[2]?.on]] },
  { name: 'own “sweet the sound!”, “sound” in 0.4 s late', line: 0, span: [8, 11], w: 2, word: 'sound!', plan: { starts: { 2: 0.4 } }, wp: 'WP6', want: [X.notesAll, X.cue('timing', 2, 'sooner'), X.say({ cue: 'Come in sooner on “sound”' })] },
  { name: 'own “sweet the sound!” spot on twice running (the store)', line: 0, span: [8, 11], before: {}, plan: {}, wp: 'WP6', want: [X.win('spot'), ['twice', (r) => r.win?.sub === 'again']] },
  { name: 'own “sweet the sound!”, “sound” −150¢', line: 0, span: [8, 11], w: 2, word: 'sound!', plan: { cents: { 2: -150 } }, wp: 'WP6', want: [X.cue('pitch', 2, 'higher'), X.beatsAll, ['the tempo heard (±8 %)', (r) => Math.abs((r.fit?.b ?? 0) - 1) <= 0.08]] },
  { name: 'own “sweet the sound!” all right ×1.4 (slower: the tempo found, not the one heard)', line: 0, span: [8, 11], plan: { f: 1.4 }, wp: 'WP6', want: [X.notesAll, X.beatsAll, ['b ×1.4 (±8 %)', (r) => Math.abs((r.fit?.b ?? 0) / 1.4 - 1) <= 0.08]] },
  { name: 'own “sweet the sound!” all right ×0.8', line: 0, span: [8, 11], plan: { f: 0.8 }, wp: 'WP6', want: [X.notesAll, X.beatsAll, ['b ×0.8 (±8 %)', (r) => Math.abs((r.fit?.b ?? 0) / 0.8 - 1) <= 0.08]] },
  { name: 'own “That saved” (two words) all right', line: 1, span: [11, 14], plan: {}, wp: 'WP6', want: [X.notesAll, ['no cue', (r) => !r.cue]] },
  // (the personas' other singers: none of these changes the answer)
  { name: 'quiet (vol 0.03)', line: 0, plan: { vol: 0.03 }, wp: 'WP0', want: [X.notesAll, X.beatsAll] },
  { name: 'a hum 0.4 s before', line: 0, plan: { hum: { m: 57, d: 0.4 } }, wp: 'WP0', want: [X.notesAll, X.beatsAll] },
  { name: 'on into the next line (3 notes)', line: 0, plan: { extra: 3 }, wp: 'WP0', want: [X.notesAll, X.beatsAll] },
  { name: 'on through the whole next line', line: 0, plan: { extra: 10 }, wp: 'WP2', want: [X.notesAll, X.beatsAll] },
  { name: 'vibrato 40¢', line: 0, plan: { vib: 40 }, wp: 'WP0', want: [X.notesAll, X.beatsAll] },
);
const BEATS = [
  { name: 'on time', line: 0, plan: {}, wp: 'WP3', saw: true, want: [X.beatsAll, X.win('spot'), X.say({ win: '✓ Spot on with the click', counts: ['♩ all on the click'], cue: null, sounds: ['▶ You'], next: 'Now on your own ›', tempo: null })] },
  { name: 'on time, headphones (the estimate only)', line: 0, plan: { rig: { clickLevel: 0 } }, wp: 'WP3', want: [X.beatsAll, X.win('spot')] },
  { name: '0.1 s late', line: 0, plan: { late: 0.1 }, wp: 'WP0', want: [X.beatsAll] },
  ...[0.25, 0.4, 0.5].map((l) => ({ name: `${l} s late`, line: 0, plan: { late: l }, wp: 'WP3', want: [X.notBeatsAll, X.cue('steady', null, 'sooner'), X.say({ cue: 'Behind the click — sing right on it', sounds: ['▶ Click', '▶ You'], next: null })] })),
  { name: '0.2 s early', line: 0, plan: { late: -0.2 }, wp: 'WP3', want: [X.notBeatsAll, X.cue('steady', null, 'later'), X.say({ cue: 'Ahead of the click — wait for it' })] },
  { name: 'a beat late (0.75 s)', line: 0, plan: { late: 0.75 }, wp: 'WP3', want: [X.noBeats, X.cue('slip', null, 'sooner'), X.say({ cue: 'Came in late — start when “Amazing” lights', counts: [], sounds: ['▶ Hear'] })] },
  { name: 'slowing ×1.1', line: 0, plan: { f: 1.1 }, wp: 'WP3', want: [X.cue('drift', null, 'sooner'), X.say({ cue: 'Slowing down — stay with the click' })] },
  { name: 'speeding ×0.9', line: 0, plan: { f: 0.9 }, wp: 'WP3', want: [X.cue('drift', null, 'later'), X.say({ cue: 'Speeding up — stay with the click' })] },
  { name: '“grace” not sung', line: 0, w: 6, word: 'grace!', plan: { drop: [6] }, wp: 'WP3', want: [X.cue('missed', 6), X.noTiming, X.say({ cue: 'Sing out on “grace”', sounds: ['▶ Click'] })] },
  { name: '“grace” in 0.2 s late', line: 0, w: 6, word: 'grace!', plan: { starts: { 6: 0.2 } }, wp: 'WP0', want: [X.cue('timing', 6, 'sooner'), X.say({ cue: 'Come in sooner on “grace”', sounds: ['▶ Click', '▶ You'] })] },
  { name: 'L2 “once” in 0.2 s late', line: 2, w: 2, word: 'once', plan: { starts: { 2: 0.2 } }, wp: 'WP0', want: [X.cue('timing', 2, 'sooner'), X.say({ cue: 'Come in sooner on “once”' })] },
  { name: 'silent', line: 0, plan: { silent: true }, wp: 'WP0', want: [X.cue('silent'), ['no counts', (r) => !r.counts]] },
  // (round 2, WP2.6: a Bluetooth-looking route — the mic track's label, earsinger's `label` — gets no behind / ahead)
  { name: 'AirPods, 0.18 s late (headphones: the trip not measured)', line: 0, plan: { label: 'AirPods', late: 0.18, rig: { clickLevel: 0 } }, wp: 'R2-2', want: [X.cue('bt'), X.noBeats] },
  // (WP3 beyond the plan's table: the other lines — L1 and L2 come in on beat 3, two clicks after the count-in —,
  // headphones, 80 %, the entry alone, a beat early, the history, the other singers)
  { name: 'L1 on time', line: 1, plan: {}, wp: 'WP3', want: [X.beatsAll, X.win('spot')] },
  { name: 'L1 0.3 s late', line: 1, plan: { late: 0.3 }, wp: 'WP3', want: [X.notBeatsAll, X.cue('steady', null, 'sooner')] },
  { name: 'L3 on time (its long last note)', line: 3, plan: {}, wp: 'WP3', want: [X.beatsAll, X.win('spot')] },
  { name: '0.25 s late, headphones (the estimate only)', line: 0, plan: { late: 0.25, rig: { clickLevel: 0 } }, wp: 'WP3', want: [X.notBeatsAll, X.cue('steady', null, 'sooner')] },
  { name: '0.1 s late, headphones (inside the wider band)', line: 0, plan: { late: 0.1, rig: { clickLevel: 0 } }, wp: 'WP3', want: [X.beatsAll] },
  { name: 'at 80 %, on time', line: 0, plan: { slow: 0.8 }, wp: 'WP3', want: [X.beatsAll, X.win('spot')] },
  { name: 'at 80 %, 0.3 s late', line: 0, plan: { slow: 0.8, late: 0.3 }, wp: 'WP3', want: [X.notBeatsAll, X.cue('steady', null, 'sooner')] },
  { name: 'only the entry 0.25 s late', line: 0, w: 0, word: 'A', plan: { starts: { 0: 0.25 } }, wp: 'WP3', want: [X.cue('timing', 0, 'sooner'), ['not “Came in on time”', (r) => r.win?.kind !== 'entry']] },
  // (in late and caught up: the late starts are what to fix — the first of them —, not "speeding up")
  { name: 'in 0.3 s late on “Amazing”, on the click from “grace”', line: 0, w: 0, word: 'A', plan: { starts: { 0: 0.3, 1: 0.3, 2: 0.3, 3: 0.3 } }, wp: 'WP3', want: [X.cue('timing', 0, 'sooner')] },
  { name: 'in 0.3 s early on “Amazing”, on the click from “grace”', line: 0, w: 0, word: 'A', plan: { starts: { 0: -0.3, 1: -0.3, 2: -0.3, 3: -0.3 } }, wp: 'WP3', want: [X.cue('timing', 0, 'later')] },
  { name: 'L1 the pickup left out: in a beat late on “saved”, the rest on the click', line: 1, plan: { drop: [0, 1] }, wp: 'WP3', want: [X.noBeats, X.cue('slip', null, 'sooner'), ['no win for the entry', (r) => r.win?.kind !== 'entry']] },
  { name: 'a beat early (0.75 s)', line: 1, plan: { late: -0.75 }, wp: 'WP3', want: [X.noBeats, X.cue('slip', null, 'later')] },
  { name: '“grace” held long, the rest late after it (rubato)', line: 0, w: 6, word: 'grace!', plan: { starts: { 7: 0.5, 8: 0.5, 9: 0.5, 10: 0.5 } }, wp: 'WP3', want: [X.notBeatsAll, X.cue('held', 6, 'sooner')] },
  { name: '“grace” cut short, the rest early after it', line: 0, w: 6, word: 'grace!', plan: { starts: { 7: -0.4, 8: -0.4, 9: -0.4, 10: -0.4 } }, wp: 'WP3', want: [X.notBeatsAll, X.cue('held', 6, 'later')] },
  { name: 'stops singing after “how”', line: 0, plan: { stop: 7 }, wp: 'WP3', want: [X.cue('missed', 8), X.noTiming] },
  { name: 'fixed: “grace” late, then on (“sweet” early)', line: 0, before: { starts: { 6: 0.25 } }, plan: { starts: { 8: -0.25 } }, wp: 'WP3', want: [X.win('fixed', 6), X.cue('timing', 8, 'later')] },
  { name: 'rose: behind the click, then one start off', line: 0, before: { late: 0.25 }, plan: { starts: { 6: 0.25 } }, wp: 'WP3', want: [X.win('rose'), ['♩ up', (r) => !!r.up?.beats], X.cue('timing', 6, 'sooner')] },
  { name: 'spot on with the click twice running', line: 0, before: {}, plan: {}, wp: 'WP3', want: [X.win('spot'), ['twice', (r) => r.win?.sub === 'again']] },
  { name: 'quiet (vol 0.03)', line: 0, plan: { vol: 0.03 }, wp: 'WP3', want: [X.beatsAll] },
  { name: 'vibrato 40¢', line: 0, plan: { vib: 40 }, wp: 'WP3', want: [X.beatsAll] },
  { name: 'a few notes off pitch, on the click', line: 0, plan: { cents: { 3: 150, 8: -200 } }, wp: 'WP3', want: [X.beatsAll] },
];

// The owner's songs (round 2's WP0; EAR_NOTES: their dumps, outside the repo — no words of theirs here): { song (its
// dump), j (a note, by its index in the song: the case is on Ear's line holding it), mode (Line / Beats), plan (the
// singer's — its note indices the SONG's; the line's taken from them), want, wp, saw }. The rows of the fix plan's
// WP1 / WP2 tables (R2-1 / R2-2: judged once those land); the count-in row is WP2's own (partCountIn).
const OWN = [
  // WP1.3: another key, decided on quality (a tone low)
  { song: 'daniel-krieger-tyler-mehlenbacher-and-daniel-tannenbaum', j: 21, name: 'all −200¢', plan: { all: -200 }, wp: 'R2-1', want: [X.cue('key', null, 'lower'), X.keyS(-2)] },
  // WP1.2: a syllable left out of a run of one pitch — the tempo held near the one heard
  ...[1, 2].map((j) => ({ song: 'x-f', j, name: `#${j} not sung (a run of one pitch)`, plan: { drop: [j] }, wp: 'R2-1', saw: true, want: [X.b(1, 0.05), XS.cue('missed', j), ['no pitch cue', (r) => r.cue?.kind !== 'pitch'], ['♩ ≥ the starts − 1', (r, ph, R) => (r.counts?.beats ?? -1) >= countSets(ph, R.S.notes, R.S.spq).starts.length - 1]] })),
  { song: 'piano-man', j: 10, name: '#10 not sung (a run of one pitch)', plan: { drop: [10] }, wp: 'R2-1', want: [X.b(1, 0.05), XS.cue('missed', 10)] },
  // WP1.6: a flat note between equal pitches — ♪ on each note's own span
  { song: 'piano-man', j: 237, name: '#237 −70¢ (between equal pitches)', plan: { cents: { 237: -70 } }, wp: 'R2-1', saw: true, want: [XS.cue('pitch', 237, 'higher'), ['“a touch higher”', (r) => r.cue?.size === 'touch']] },
  ...[246, 247, 250].map((j) => ({ song: 'piano-man', j, name: `#${j} −100¢ (in a run of equal pitches)`, plan: { cents: { [j]: -100 } }, wp: 'R2-1', saw: true, want: [XS.cue('pitch', j, 'higher')] })),
  { song: 'piano-man', j: 250, name: '#250 −100¢, sung so twice (no “right on it now”)', before: { cents: { 250: -100 } }, plan: { cents: { 250: -100 } }, wp: 'R2-1', saw: true, want: [XS.cue('pitch', 250, 'higher'), ['no “fixed” win', (r) => r.win?.kind !== 'fixed']] },
  // WP1.8: an accelerando over the line isn't a note held
  { song: '55-cg', j: 0, name: 'speeding up 8 % over the line', plan: { curve: -0.08 }, wp: 'R2-1', want: [['no held cue', (r) => r.cue?.kind !== 'held']] },
  // WP1.5 / Q2-2: a late start on a repeated pitch (legato: the note before held into it)
  { song: 'piano-man', j: 91, name: '#91 in 0.25 s late, legato on one pitch', plan: { starts: { 91: 0.25 } }, wp: 'R2-1', want: [XS.notSpot, ['a timing cue on it, or ♩ all and “Every note in tune”', (r) => (r.cue?.kind === 'timing' && r.cue.j === 91) || (!!r.counts?.beatsAll && r.win?.kind === 'every')]] },
  { song: 'blzmaj7', j: 31, name: '#31 in 0.2 s late (a run of one pitch)', plan: { starts: { 31: 0.2 } }, wp: 'R2-1', want: [XS.notSpot] },
  { song: 'daniel-krieger-tyler-mehlenbacher-and-daniel-tannenbaum', j: 90, name: '#90 in 0.12 s late', plan: { starts: { 90: 0.12 } }, wp: 'R2-1', want: [['♩ 3', (r) => r.counts?.beats === 3], XS.cue('timing', 90, 'sooner')] },
  // WP2: Beats
  { song: 'hey-little-songbird-p-6', j: 0, mode: 'Beats', name: 'every start 0.15 s late', plan: { late: 0.15 }, wp: 'R2-2', want: [['one verdict (every start one class)', (r) => { const st = Object.values(r.starts || {}).filter((x) => x.reached && !x.missing); return st.every((x) => x.on === st[0]?.on); }], ['no “Came in on time” beside a take-wide cue', (r) => !(r.win?.kind === 'entry' && ['steady', 'hair', 'slip', 'drift'].includes(r.cue?.kind))]] },
  { song: 'x-f', j: 16, mode: 'Beats', name: 'on the click, three notes off pitch', plan: { wrong: { 16: -3, 19: 2, 21: -2 } }, wp: 'R2-2', saw: true, want: [X.beatsAll, X.noTiming, ['#16 not missing', (r, ph) => !r.starts?.[16 - ph.j0]?.missing]] },
  { song: 'daniel-krieger-tyler-mehlenbacher-and-daniel-tannenbaum', j: 6, mode: 'Beats', name: '#6 in 0.15 s late (the note before held into it)', plan: { starts: { 6: 0.15 } }, wp: 'R2-2', want: [XS.notSpot] },
  { song: 'from-the-sara-bareilles-2013-album-brave-enough-live-at-the-variety-playhouse', j: 291, mode: 'Beats', name: 'the long melisma, its notes #297–299 in 0.15 s late', plan: { starts: { 297: 0.15, 298: 0.15, 299: 0.15 } }, wp: 'R2-2', want: [X.notBeatsAll, ['the cue on #297–#299 (the line is the melisma: on the notes sung late)', (r) => r.cue?.j != null && r.cue.j >= 297 && r.cue.j <= 299]] },
];

// ---------------------------------------------------------------------------
// Run them

const verdict = (r) => JSON.stringify({ c: r.counts, w: r.win && [r.win.kind, r.win.text], q: r.cue && [r.cue.kind, r.cue.text, r.cue.j, r.cue.dir] });
const short = (r, ph) => summary(r, ph); // (tools/lib/earsum.cjs: the probe prints the same line)

// ---------------------------------------------------------------------------
// Notes (WP4): a held note

// The singer holds `by` semitones (+ cents) off the note from `at` s after the mic opened, to past the window; the
// frames as the page reads them, fed to holdStep as earNote's tick does (dt: the time since the last frame).
function holdRound(target, plan, { phase = 0, seed = 7 } = {}) {
  const end = EAR_HOLD.window + 0.5;
  const sung = plan.silent ? [] : [{ t: plan.at ?? 0.35, d: plan.d ?? end, midi: target + (plan.by || 0) + (plan.cents || 0) / 100, text: 'ah', melisma: false, restBefore: true }];
  const r = sing(sung, { songT0: 0, rt: 0, until: end, vibrato: plan.vib ?? 20, noise: 0.002, seed, loud: () => loudOf(plan) });
  const fr = frames(r.audio, r.sr, { songT0: 0, latency: 0, fps: 60, from: FFT_SIZE / r.sr + phase, to: end, gate: MIN_RMS });
  const h = holdStart();
  let prev = null;
  for (const f of fr) { holdStep(h, prev == null ? 0 : f.t - prev, f.midi == null ? null : f.midi - target); prev = f.t; if (h.end) break; }
  return h;
}
function notesCases() {
  console.log('Notes (holds; the line’s lowest E♭4 63, highest C5 72, “sweet” A♭4 68):');
  const ph = AG.plan[0], m = (k) => AG.notes[ph.j0 + k].midi;
  const name = (oct) => noteName(68 + oct, true);
  // [name, target, plan, the verdict's options per try (tries 1…), wants (on the last try's verdict), its h]
  const H = [
    ['a fifth sharp (+7)', 68, { by: 7 }, [1, 2], [['1st: Not yet', (v, vs) => vs[0].kind === 'notyet' && vs[0].text === 'Not yet'], ['2nd: That’s another note', (v) => v.kind === 'another' && v.text === 'That’s another note'.replace('’', "'")], ['never “higher”', (v, vs) => vs.every((x) => !/higher/i.test(x.text))], ['ends early (nothing near it)', (v, vs, h) => h.end === 'miss' && h.t < EAR_HOLD.giveUp + 1.2]]],
    ['a major third flat (−4)', 68, { by: -4 }, [1, 2], [['1st: Not yet', (v, vs) => vs[0].kind === 'notyet'], ['2nd: Much higher', (v) => v.kind === 'dir' && v.dir === 'higher' && v.size === 'much' && v.text === 'Much higher']]],
    ['a tone sharp (+2)', 68, { by: 2 }, [2], [['Lower', (v) => v.dir === 'lower' && v.size === 'plain' && v.text === 'Lower'], ['ends early', (v, vs, h) => h.t < EAR_HOLD.giveUp + 1.2]]],
    ['60¢ sharp (no vibrato: a ±20¢ one dips inside the 50¢ often enough to match in ~3 s — D10’s added-up rule)', 68, { cents: 60, vib: 0 }, [2], [['A touch lower', (v) => v.dir === 'lower' && v.size === 'touch' && v.text === 'A touch lower'], ['the whole 6 s (it was near)', (v, vs, h) => h.t >= EAR_HOLD.window - 0.05]]],
    ['a semitone sharp (+1), three times', 68, { by: 1 }, [1, 2, 3], [['3rd: ▶ Sing along, Next note ›', (v) => v.along && v.next], ['2nd: neither yet', (v, vs) => !vs[1].along && !vs[1].next], ['Lower', (v) => v.dir === 'lower' && v.text === 'Lower'], ['no key offer (not the top note)', (v) => !v.key]]],
    ['the highest a tone flat (−2), three times', 72, { by: -2 }, [{ tries: 1, top: true }, { tries: 2, top: true }, { tries: 3, top: true }], [['Higher', (v) => v.text === 'Higher'], ['3rd: Too high for now? — lower the song 2', (v) => v.key?.dir === 'lower' && v.key.s === 2 && v.key.text === 'Too high for now?'], ['2nd: no key offer yet', (v, vs) => !vs[1].key]]],
    ['the highest a tone sharp, three times', 72, { by: 2 }, [{ tries: 3, top: true }], [['no key offer (sharp on the top note)', (v) => !v.key && v.dir === 'lower']]],
    ['the lowest a tone sharp (+2), three times', 63, { by: 2 }, [{ tries: 3, bottom: true }], [['Too low for now? — raise the song 2', (v) => v.key?.dir === 'higher' && v.key.s === 2 && v.key.text === 'Too low for now?']]],
    ['a fourth sharp (+5)', 68, { by: 5 }, [2], [['That’s another note', (v) => v.kind === 'another']]],
    ['a tritone (+6)', 68, { by: 6 }, [2], [['That’s another note', (v) => v.kind === 'another']]],
    ['a minor third flat (−3)', 68, { by: -3 }, [2], [['Much higher', (v) => v.dir === 'higher' && v.size === 'much']]],
    ['on it', 68, {}, [{ refOct: 0, name }], [['matched', (v, vs, h) => v.kind === 'match' && v.oct === 0 && !v.said && v.text === '✓ A♭4' && h.t < 2]]],
    ['on it, wide vibrato (±80¢)', 68, { vib: 80 }, [{ name }], [['matched', (v) => v.kind === 'match']]],
    ['an octave down', 68, { by: -12 }, [{ refOct: 0, name }], [['matched, an octave down', (v) => v.kind === 'match' && v.oct === -12 && v.said === 'lower' && v.text === '✓ Same note, in your lower voice']]],
    ['an octave down, the note played there', 68, { by: -12 }, [{ refOct: -12, name }], [['matched, said once: “✓ A♭3”', (v) => v.kind === 'match' && v.oct === -12 && !v.said && v.text === '✓ A♭3']]],
    ['the written octave, the note played an octave down', 68, {}, [{ refOct: -12, name }], [['higher voice', (v) => v.kind === 'match' && v.oct === 0 && v.said === 'higher']]],
    ['an octave up, 30¢ sharp', 63, { by: 12, cents: 30 }, [{ refOct: 0 }], [['matched an octave up', (v) => v.kind === 'match' && v.oct === 12 && v.said === 'higher']]],
    ['silent', 68, { silent: true }, [1, 2], [['Didn’t hear you', (v) => v.kind === 'silent' && /Didn't hear you/.test(v.text)], ['the whole 6 s', (v, vs, h) => h.t >= EAR_HOLD.window - 0.05]]],
    ['a whisper (vol 0.012)', 68, { vol: 0.012 }, [2], [['Didn’t hear you', (v) => v.kind === 'silent']]],
    ['comes in 2 s late, on it', 68, { at: 2 }, [{ name }], [['matched', (v) => v.kind === 'match']]],
    ['on it for half a second, then nothing', 68, { d: 0.5 }, [1, 2], [['1st: Close — keep it going (not a direction: no need to wait for the 2nd)', (v, vs) => vs.every((x) => x.kind === 'close' && x.text === 'Close — keep it going')]]],
  ];
  for (const [label, target, plan, tries, want] of H) {
    const runs = VARIANTS.map((x) => { const h = holdRound(target, plan, x); return { h, vs: tries.map((t) => holdVerdict(h, typeof t === 'number' ? { tries: t, name } : { name, tries: 1, ...t })) }; });
    const { h, vs } = runs[0], v = vs[vs.length - 1];
    const failed = want.filter(([, fn]) => !fn(v, vs, h)).map(([w]) => w);
    const say = (x) => `${x.kind}${x.dir ? ` ${x.dir}/${x.size}` : ''} “${x.text}”${x.along ? ' +along' : ''}${x.key ? ` +key ${x.key.dir} ${x.key.s}` : ''}`;
    const same = runs.every((x) => JSON.stringify(x.vs.map(say)) === JSON.stringify(vs.map(say)));
    console.log(`     Notes ${label}: ${vs.map(say).join(' → ')} | ${h.end} at ${h.t.toFixed(2)} s, held ${h.good.toFixed(2)} s, voiced ${h.voiced.toFixed(2)} s${v.r != null ? `, r ${v.r}` : ''}${same ? '' : `  [again: ${runs.slice(1).map((x) => x.vs.map(say).join(' → ')).join(' / ')}]`}`);
    check(`Notes ${label}`, !failed.length, `wanted ${failed.join(', ')}`);
    check(`Notes ${label}: the same holding, the same answer`, same);
  }
  // the targets: after a Line attempt (its off / not-sung notes first — the cue's first, ≤ 3 —, then the lowest and highest)
  const T = (plan) => { const r = lineRound(AG, ph, plan).res; return { r, t: noteTargets(ph, AG.notes, r) }; };
  const none = noteTargets(ph, AG.notes, null);
  check('Notes targets, no Line attempt: the lowest, the highest', JSON.stringify(none.targets) === '[0,3]' && !none.off.length && m(none.lo) === 63 && m(none.hi) === 72, JSON.stringify(none));
  let x = T({ cents: { 8: 200 } });
  check('Notes targets after “sweet” +200¢: A♭4 (“sweet”) first, off last time; then E♭4, C5', x.t.targets[0] === 8 && x.t.off.includes(8) && JSON.stringify(x.t.targets) === '[8,0,3]', `${JSON.stringify(x.t)} (drill ${JSON.stringify(x.r.drill)}, cue ${x.r.cue?.kind}@${x.r.cue?.j})`);
  x = T({});
  check('Notes targets after an attempt all right: the lowest, the highest', JSON.stringify(x.t.targets) === '[0,3]' && !x.t.off.length, JSON.stringify(x.t));
  x = T({ drop: [4] });
  check('Notes targets after “Amazing”’s 2nd “zing” note left out: that note (B♭4) first', x.t.targets[0] === 4 && x.t.off.includes(4), `${JSON.stringify(x.t)} (cue ${x.r.cue?.kind}@${x.r.cue?.j})`);
  x = T({ cents: { 2: 150, 7: -200, 9: 200 } });
  check('Notes targets after three notes off: those three (the cue’s first), then the lowest, the highest', JSON.stringify([...x.t.off].sort((a, b) => a - b)) === '[2,7,9]' && x.t.targets[0] === x.r.cue?.j - ph.j0 && JSON.stringify(x.t.targets.slice(3)) === '[0,3]', `${JSON.stringify(x.t)} (cue ${x.r.cue?.kind}@${x.r.cue?.j}; drill ${JSON.stringify(x.r.drill)})`);
  x = T({ cents: { 2: 150, 6: 150, 7: -200, 9: 200 } });
  check('Notes targets after four notes off: three of them, one a pitch (“grace”’s C5 is the highest too)', x.t.off.length === 3 && x.t.off.every((k) => [2, 6, 7, 9].includes(k)) && x.t.targets[0] === x.r.cue?.j - ph.j0 && JSON.stringify(x.t.targets.slice(3)) === '[0]', `${JSON.stringify(x.t)} (cue ${x.r.cue?.kind}@${x.r.cue?.j}; drill ${JSON.stringify(x.r.drill)})`);
  x = T({ stop: 6 });
  check('Notes targets after a singer who stopped: nothing not reached', x.t.off.every((k) => k <= 6), `${JSON.stringify(x.t)} (drill ${JSON.stringify(x.r.drill)})`);
}

// The same singing again: the frames half a frame later (rAF never lands where it did), other room noise.
const VARIANTS = [{ phase: 0, seed: 7 }, { phase: 1 / 120, seed: 11 }];
// PLANS (earprobe.cjs's plans, here: '[{…}]' or @file.json): each sung with both voices and printed — the line earprobe
// prints as `sum`, and why it isn't "Spot on" — nothing judged; the cases aren't run. A plan as earprobe takes it
// (phrase: Ear's line, mode free | beats | talk, the singer's fields, indices in the line); song: an owner's dump
// (EAR_NOTES); a Beats plan without a rig: the browser's — its fake mic hears no click (uncalibrated) and its sound
// reaches the page before the page's estimate says: on the click a take's starts read 0 … −0.04 s, the take's own
// offset drawn at each ● Sing (the median of 10 earprobe takes −0.03 s, here), and ±10 ms between the starts of one
// take (the singer's 5 ms timer on the page's main thread; node's ticks are exact). So a Beats row within ~30 ms of
// a band's edge can differ from one probe take: probe it three times. A hold plan (Notes) is skipped.
const PROBE_RIG = { clickLevel: 0, rt: 0.01, est: 0.04 };
let PLANS = process.env.PLANS || null;
if (PLANS?.startsWith('@')) PLANS = fs.readFileSync(PLANS.slice(1), 'utf8');
PLANS = PLANS ? JSON.parse(PLANS) : null;
const PROBE = (PLANS || []).map((p, k) => [p.mode === 'beats' ? 'Beats' : p.mode === 'hold' ? 'Notes' : 'Line', { name: p.name || `plan ${k + 1}`, probe: true, song: p.song, line: p.phrase || 0, want: [], saw: true,
  plan: { ...(p.mode === 'beats' && !p.rig ? { rig: PROBE_RIG } : {}), ...p } }]);
const CASES = PLANS ? PROBE : [...LINE.map((c) => ['Line', c]), ...BEATS.map((c) => ['Beats', c]), ...OWN.map((c) => [c.mode || 'Line', c])];
const labelOf = ([mode, c]) => c.probe ? `${mode} ${c.song ? `${c.song.split('-').slice(0, 3).join('-')} ` : ''}L${c.line} ${c.name}` : `${mode} ${c.song ? `owner:${c.song.split('-').slice(0, 3).join('-')} j${c.j}` : c.span ? `own ${c.span[0]}–${c.span[1] - 1}` : `L${c.line}`} ${c.name}${c.saw ? ' · saw' : ''}`;
// (the owner's songs, loaded once a thread; a case runs when its own song's dump is there)
const ownOk = (song) => !!OWN_DIR && fs.existsSync(path.join(OWN_DIR, `${song}.json`));
const songs = {};
const songFor = (name) => (songs[name] ||= songOf(name, OWN_DIR));
// An owner case's plan: its note indices are the song's — the singer's are the line's.
const LINE_IDX = ['cents', 'wrong', 'jit', 'starts'];
function toLine(P, ph) {
  const o = { ...P }, n = ph.j1 - ph.j0, bad = [];
  const at = (i) => { const k = +i - ph.j0; if (k < 0 || k >= n + (P.extra || 0)) bad.push(+i); return k; };
  for (const k of LINE_IDX) if (P[k]) o[k] = Object.fromEntries(Object.entries(P[k]).map(([i, v]) => [at(i), v]));
  if (P.drop) o.drop = P.drop.map(at);
  if (P.stop != null) o.stop = at(P.stop);
  return { plan: o, bad };
}

// One case: → { out (lines to print), checks [[name, ok, detail]], todo (its packages, when not landed), ms }. Each
// voice (`saw`: the browser's too) sung VARIANTS times; each judged on its own (the case's wp; the browser's voice:
// `saw` when that's a tag).
function evalCase(k) {
  const [mode, c] = CASES[k], label = labelOf(CASES[k]);
  const out = [], checks = [];
  if (c.song && !ownOk(c.song)) return { out: [`skip ${label} — ${OWN_DIR ? `no dump of ${c.song} in ${OWN_DIR}` : 'EAR_NOTES unset'}`], checks: [], todo: null, skip: true, ms: 0 };
  if (mode === 'Notes') return { out: [`skip ${label} — a hold: the Notes cases below sing those`], checks: [], todo: null, ms: 0 };
  const S = c.song ? songFor(c.song) : AG, lines = c.song ? S.page : AG.plan;
  // (span: a line of the singer's own — Pick words; an owner case: the line holding note j)
  const ph = c.span ? { j0: c.span[0], j1: c.span[1] } : c.song && !c.probe ? lines.find((x) => c.j >= x.j0 && c.j < x.j1) : lines[c.line];
  if (!ph) return { out, checks: [[`${label}: note ${c.j} is in a line`, false, `${S.notes.length} notes, ${lines.length} lines`]], todo: null, ms: 0 };
  if (c.word !== undefined && (S.notes[ph.j0 + c.w].text || '') !== c.word) return { out, checks: [[`${label}: note ${c.w} is “${c.word}”`, false, `it is “${S.notes[ph.j0 + c.w].text}”`]], todo: null, ms: 0 };
  let plan = c.plan, before = c.before;
  if (c.song && !c.probe) {
    const p = toLine(c.plan, ph), b = c.before ? toLine(c.before, ph) : { plan: null, bad: [] };
    if (p.bad.length || b.bad.length) return { out, checks: [[`${label}: the plan's notes in the line ${ph.j0}–${ph.j1 - 1}`, false, `not: ${[...p.bad, ...b.bad].join(', ')}`]], todo: null, ms: 0 };
    plan = p.plan; before = b.plan;
  }
  const round = mode === 'Line' ? lineRound : beatsRound;
  // (a case `before` another attempt: that one's result kept as the page keeps it — the store, ear.js attemptOf: only a
  // whole attempt; read back as the page's earPrev does)
  const kind = mode === 'Line' ? 'line' : 'beats';
  const lastOf = (x) => { const e = attemptOf(x, ph, { kind, rate: 1, tr: 0, at: 1 }); return e ? prevFrom(addAttempt(null, e), kind, 1, ph) : null; };
  const todos = [];
  let ms = 0;
  for (const voice of VOICES || (c.saw ? ['synth', 'saw'] : ['synth'])) {
    const runs = VARIANTS.map((v) => { const vv = { ...v, voice }, b = before ? round(S, ph, before, vv).res : null, x = round(S, ph, plan, b ? { ...vv, prev: lastOf(b) } : vv); x.before = b; return x; });
    const R = runs[0], r = R.res;
    Object.assign(R, { beats: mode === 'Beats', S, lines, j: c.j });
    const failed = [...c.want, ...TRUTH, ...WORDS].filter(([, fn]) => !fn(r, ph, R)).map(([w]) => w);
    const same = runs.every((x) => verdict(x.res) === verdict(r));
    const wp = voice === 'saw' && typeof c.saw === 'string' ? c.saw : c.wp;
    const judged = DONE.has(wp);
    const name = voice === 'saw' ? `${label} [the browser's voice]` : label;
    if (c.probe) out.push(`${label} [${voice}]: ${short(r, ph)} | ${spotWhy(r, mode === 'Beats')}`);
    else out.push(`${judged ? '     ' : 'todo '}${voice === 'saw' && out.length ? '  └ saw' : voice === 'saw' ? `${label} [saw]` : label}: ${short(r, ph)}${same ? '' : '  [again: ' + runs.slice(1).map((x) => short(x.res, ph)).join(' / ') + ']'}`);
    if (V) { // (each note — a probe's too: earprobe's perNote beside it)
      const g = mode === 'Line' ? r.fit?.g : R.grades?.slice(ph.j0, ph.j1);
      for (let i = 0; i < ph.j1 - ph.j0; i++) {
        const n = S.notes[ph.j0 + i], x = g?.[i], rn = r.rn?.[i];
        const sx = r.starts?.[i];
        out.push(`       ${i} ${(c.song ? `#${ph.j0 + i}` : n.text || '·').padEnd(8)} ${n.name.padEnd(4)} ${x ? `${x.status}${x.dev != null ? ` ${Math.round(x.dev * 100)}¢` : ''}${x.shift != null ? ` ${x.shift.toFixed(2)}s` : ''}` : '–'}${rn ? ` | ${rn.cls ?? '–'} dev ${rn.dev?.toFixed(3) ?? '–'} rdev ${rn.rdev?.toFixed(3) ?? '–'}` : ''}${sx ? ` | start ${sx.on ? 'on' : 'off'} ${sx.measured ? `${sx.kind} ${sx.r != null ? `r ${sx.r.toFixed(3)}` : `dev ${sx.dev?.toFixed(3)}`}` : 'unmeasured'}` : ''}`);
      }
    }
    if (c.probe) { ms = Math.max(ms, ...runs.map((x) => x.ms)); continue; }
    if (judged) {
      checks.push([name, !failed.length, `wanted ${failed.join(', ')}`]);
      checks.push([`${name}: the same singing, the same answer`, same, runs.map((x) => short(x.res, ph)).join(' / ')]);
    } else {
      todos.push(wp);
      if (SHOW_TODO) out.push(failed.length || !same ? `       todo ${wp}${voice === 'saw' ? ' (saw)' : ''}: wants ${failed.join(', ') || '—'}${same ? '' : `${failed.length ? ';' : ''} the same answer every time`}` : `       todo ${wp}${voice === 'saw' ? ' (saw)' : ''}: passes now — make it a check`);
    }
    ms = Math.max(ms, ...runs.map((x) => x.ms));
  }
  return { out, checks, todo: todos.length ? todos : null, ms };
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
  let next = 0, shown = 0, skipped = 0;
  const flush = () => { // (in case order, as each arrives)
    while (shown < ks.length && results[ks[shown]]) {
      const x = results[ks[shown++]];
      for (const l of x.out) console.log(l);
      for (const [name, ok, detail] of x.checks) check(name, ok, detail);
      for (const t of x.todo || []) (todo[t] ||= []).push(x.k);
      if (x.skip) skipped++;
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
  if (!PLANS && (!ONLY || ONLY.test('Notes'))) notesCases();
  const todos = Object.entries(todo).map(([k, v]) => `${k} ${v.length}`).join(', ');
  if (skipped) console.log(`skip: ${skipped} of the owner's cases — EAR_NOTES=<dir of their dumps> (OUT=<dir> node dumpnotes.cjs <their MusicXML>) runs them; a skip is a gap to close before shipping`);
  console.log(`${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''}${todos ? `, todo: ${todos}` : ''}`);
  process.exitCode = fail ? 1 : 0;
}
