// Guided practice, end to end in node: synthetic practice rounds (rhythmsynth.mjs) through the
// page's own features, pitch frames and grading, rhythm.js's guided-span analysis, a PhraseRhythm
// per phrase built the way sing.js rhythmOf should (phraseRhythms below — the reference for the
// integrator), practice.js's verdicts and coach.js's words. docs/COACHING.md §3.3, §5, §10.
// usage: node guidedverdicts.mjs   (V=1: print every PhraseRhythm)
import { sing, melody } from './rhythmsynth.mjs';
import { features, frames, metricFor } from './rhythmharness.mjs';
import { findClicks, findOnsets, rhythmStats, rhythmObservations, firstSound, voiceCover, noteCover, tolOn } from '../public/rhythm.js';
import { clickWave, CLICK_GAIN } from '../public/piano.js';
import { gradeTake } from '../public/grade.js';
import { MIN_RMS, ANALYSIS_LAG } from '../public/pitch.js';
import { noteName } from '../public/music.js';
import { PRACTICE, timeVerdict, tuneVerdict } from '../public/practice.js';
import { roundResult } from '../public/coach.js';

const median = (xs) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };

// ---------------------------------------------------------------------------
// The reference: what sing.js rhythmOf computes for a guided span (a round, or a run), per phrase.
//   all: the song's notes (global indices); j0, j1: the span's notes; phrases: the covered phrases
//   ({ i, js (global) }, in order); met: metricOf() for the span (local), met[0] made an entry after
//   the count-in (entry, rest = count-in beats × beat); feat/start: the take's features and the
//   recording's start (ctx s); frames: take.frames (already moved by the measured round trip);
//   songT0; cal: findClicks() or null; latency: take.latency (cal.rt when measured); stopAt (ctx s);
//   grades: take.grades (global); guide: "click" (guided steps force it); tapped: a tapped timing
//   map plays; stage: "time" | "tune" | "song"; round: a practice round (false: a run).
// → { on, st, obs, per, rs: [PhraseRhythm per covered phrase] }
export function phraseRhythms({ all, j0, j1, phrases, met, feat, start, frames: fr, songT0, cal, latency, stopAt, grades, guide = 'click', tapped = false, stage, round = true }) {
  const T = PRACTICE.time;
  const trip = cal ? cal.rt : latency;
  const ns = all.slice(j0, j1);
  const beat0 = met[0].beat;
  const base = { songT0, trip, quiet: [-Infinity, ns[0].t + T.firstWin[0] * beat0] }; // (the count-in: nobody sings there)
  // The onset gate: a note is left out only if unsung, or missed with < 20% voice around it.
  const cover = noteCover(feat, start, base, ns, met.map((m) => m.beat));
  const unsung = ns.map((_, k) => grades[j0 + k]?.status === 'unsung' || (grades[j0 + k]?.status === 'missed' && cover[k] < T.noteHeard));
  const on = findOnsets(ns, feat, start, fr, met, { songT0, rt: cal ? cal.rt : null, latency, endT: stopAt - songT0 - trip, unsung,
    loose: stage === 'time', ...(cal ? { seedRange: T.seedRound } : {}) });
  const groups = phrases.map((ph) => ph.js.map((j) => j - j0));
  // (as v75: behind/ahead only with a short measured round trip, the click guide, no tapped map)
  const st = rhythmStats(ns, on, met, groups, { calibrated: !!cal && cal.rt <= 0.1 && guide === 'click' && !tapped });
  const obs = rhythmObservations(st, groups).map((o) => ({ ...o, ...(o.j !== undefined ? { j: o.j + j0 } : {}), ...(o.li !== undefined ? { li: phrases[o.li].i } : {}) }));
  const per = all.map((_, j) => {
    if (j < j0 || j >= j1) return null;
    const x = st.notes[j - j0], o = on.notes[j - j0];
    return x.dev === null ? null : { dev: x.dev, rdev: x.rdev, cls: x.cls, rel: x.rel, kind: o.kind, conf: o.conf, u: met[j - j0].u };
  });
  // The counting slip: the first sound after the (silent) count-in — the span's first phrase only.
  const e0 = phrases[0].js.find((j) => !all[j].melisma) ?? phrases[0].js[0];
  const first = firstSound(feat, start, fr, { songT0, trip, shiftT: latency - trip, from: ns[0].t + T.firstWin[0] * beat0, to: ns[0].t + T.firstWin[1] * beat0 });
  const takeObs = round ? obs.filter((o) => o.scope === 'take' && (o.kind === 'behind' || o.kind === 'ahead')) : [];
  const rs = phrases.map((ph, p) => {
    const ks = ph.js.map((j) => j - j0);
    const nc = voiceCover(feat, start, base, ks.map((k) => [ns[k].t + on.lead, ns[k].t + ns[k].d + on.lead]));
    const dur = ks.reduce((a, k) => a + ns[k].d, 0);
    const syl = ks.filter((k) => !ns[k].melisma);
    const u = median(ks.map((k) => met[k].u));
    return {
      trust: 'ok', calibrated: !!cal, measuredRt: !!cal && cal.rt <= 0.1, guide, tapped,
      lag: p === 0 && first !== null ? first - all[e0].t : null,
      beat: met[ks[0]].beat, u,
      cover: dur ? ks.reduce((a, k, i) => a + nc[i] * ns[k].d, 0) / dur : null,
      classified: syl.filter((k) => st.notes[k].cls !== null).length, syllables: syl.length,
      obs: obs.filter((o) => o.scope !== 'take' && o.li === ph.i), takeObs,
      leadN: on.leadN, seedAgrees: on.seed !== null && Math.abs(on.seed - on.lead) <= tolOn(u),
      notes: per,
    };
  });
  return { on, st, obs, per, rs };
}

// ---------------------------------------------------------------------------
// A practice round on the synthetic singer (as rhythmcases.mjs guided(): its own count-in, the
// click guide through it), the song's notes kept whole so the indices are the page's.

const SPEC = [
  [60, 1, 'Ma'], [62, 1, 'ry'], [64, 1, 'had'], [64, 1, 'a'],
  [65, 0.5, 'lit'], [64, 1, 'tle'], [62, 1.5, 'lamb'], [null, 1],
  [67, 1, 'Its'], [67, 1, 'fleece'], [65, 0.5, 'was'], [64, 0.5, '', true], [62, 2, 'white'], [null, 1],
  [60, 0.5, 'as'], [62, 0.5, 'snow'], [64, 1, 'and'], [65, 1.5, 'ev'], [64, 0.5, 'ery'], [62, 3, 'where'],
];
const named = (T) => ({ ...T, notes: T.notes.map((n) => ({ ...n, wmidi: n.midi, name: noteName(n.midi), syllabic: 'single', pass: 1 })) });
const tune = (bpm = 96) => named(melody(SPEC, bpm));

function round(T, phrases, o = {}) {
  const all = T.notes, spq = T.spq;
  const j0 = phrases[0].js[0], j1 = phrases[phrases.length - 1].js.at(-1) + 1;
  const ns = all.slice(j0, j1);
  const beatQ = 1, barQ = 4, beat = beatQ * spq, count = barQ / beatQ;
  const fromQ = Math.floor(ns[0].q / barQ + 1e-9) * barQ, start = fromQ * spq;
  const last = ns[ns.length - 1], endQ = last.q + last.dq;
  const countClicks = Array.from({ length: count }, (_, k) => ({ t: start - (count - k) * beat, accent: k === 0 }));
  const guide = Array.from({ length: Math.ceil((endQ - fromQ) / beatQ) }, (_, k) => ({ t: start + k * beat, accent: k % count === 0 }));
  const songT0 = 0.3 - countClicks[0].t;
  const rt = o.rt ?? 0.07;
  const r = sing(o.sung ? o.sung(ns, beat) : ns, { songT0, rt, clicks: [...countClicks, ...guide], clickLevel: o.clickLevel ?? 0.3, noise: 0.002, until: last.t + last.d + 1, ...o.sing });
  const feat = features(r.audio, r.sr);
  const est = o.latencyEst ?? 0.04;
  let fr = frames(r.audio, r.sr, { songT0, latency: est, fps: 60, from: start - 0.5 });
  const cal = findClicks(r.audio, r.sr, 0, countClicks.map((c) => ({ t: songT0 + c.t, accent: c.accent })), beat, (a) => clickWave(r.sr, a), (a) => CLICK_GAIN[a ? 'accent' : 'plain']);
  let latency = est;
  if (cal) { const d = est - cal.rt; fr = fr.map((f) => ({ ...f, t: f.t + d })); latency = cal.rt; } // (as finishSing)
  const trip = cal ? cal.rt : latency, stopAt = r.audio.length / r.sr;
  const part = gradeTake(ns, fr, { endT: stopAt - songT0 - ANALYSIS_LAG - latency, gate: MIN_RMS });
  const grades = all.map((_, j) => (j >= j0 && j < j1 ? part[j - j0] : null));
  const { metric } = metricFor(ns, { beatQ, spq, div: 2 });
  metric[0] = { ...metric[0], entry: true, rest: count * beat }; // the span's first note: an entry after the count-in
  const stage = o.stage ?? 'time';
  const res = phraseRhythms({ all, j0, j1, phrases, met: metric, feat, start: 0, frames: fr, songT0, cal, latency, stopAt, grades, stage, round: o.round ?? true });
  const verdicts = phrases.map((ph, p) => {
    const tv = timeVerdict({ ph, r: res.rs[p], grades, notes: all });
    const uv = tuneVerdict({ ph, r: res.rs[p], grades, notes: all });
    return { tv, uv, timeWords: roundResult('time', tv, o.prevCue ?? null, all, ph), tuneWords: roundResult('tune', uv, null, all, ph) };
  });
  if (process.env.V) for (const r1 of res.rs) console.log('   ', JSON.stringify({ ...r1, notes: undefined }));
  return { ...res, verdicts, cal, grades, beat };
}

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else { fail++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); } };
const text = (w) => [w.win && `✓ ${w.win.text}`, w.cue && w.cue.text].filter(Boolean).join(' · ');
const say = (name, R, p = 0) => {
  const v = R.verdicts[p], r = R.rs[p];
  console.log(`${name}: time ${v.tv.v}${v.tv.ev ? `(${v.tv.ev})` : ''} "${text(v.timeWords)}" | tune ${v.uv.v} "${text(v.tuneWords)}" | lag ${r.lag === null ? '—' : (r.lag / R.beat).toFixed(2) + 'b'} cover ${Math.round((r.cover ?? 0) * 100)}% classified ${r.classified}/${r.syllables} leadN ${r.leadN} seed ${r.seedAgrees ? 'agrees' : 'no'}`);
};
const PITCH = /aim|up to|down to|flat|sharp|right on|Every note|on [A-G]/;

const T96 = tune(96), T60 = tune(60);
const ph = (i, js) => ({ i, js, j0: js[0], j1: js.at(-1) + 1 });
const MARY = ph(0, [0, 1, 2, 3, 4, 5, 6]), ITS = ph(1, [7, 8, 9, 10, 11]), AS = ph(2, [12, 13, 14, 15, 16, 17]);
const beatLate = (ns, beat) => ns.map((n) => ({ ...n, t: n.t + beat }));
const noteLate = (ns) => ns.map((n, k) => (k + 1 < ns.length ? { ...n, t: ns[k + 1].t, d: ns[k + 1].d } : { ...n, t: n.t + n.d }));

{ // on time: a pass with a timing win, nothing to fix; In tune a pass too
  const R = round(T96, [ITS]); say('on time', R);
  const v = R.verdicts[0];
  check('on time: time pass', v.tv.v === 'pass', v.tv.v);
  check('on time: a win, no cue', v.timeWords.win && !v.timeWords.cue, text(v.timeWords));
  check('on time: tune pass', v.uv.v === 'pass', v.uv.v);
  check('on time: no pitch words In time', !PITCH.test(text(v.timeWords)), text(v.timeWords));
  check('on time: PhraseRhythm complete', ['trust', 'calibrated', 'guide', 'tapped', 'lag', 'beat', 'measuredRt', 'cover', 'classified', 'syllables', 'obs', 'takeObs', 'leadN', 'seedAgrees'].every((k) => R.rs[0][k] !== undefined));
}
for (const [label, T, o] of [['1 beat late', T96, {}], ['1 beat late ♩=60', T60, {}], ['1 beat late, headphones (uncalibrated)', T96, { clickLevel: 0, latencyEst: 0.04, rt: 0.07 }]]) {
  // §10 Step 7 acceptance 4 (in node): a cue that matches /beat sooner/, never /Sing out/
  const R = round(T, [ITS], { sung: beatLate, ...o }); say(label, R);
  const v = R.verdicts[0];
  check(`${label}: time slip`, v.tv.v === 'slip', v.tv.v);
  check(`${label}: "a beat sooner"`, /beat sooner/.test(text(v.timeWords)) && !/Sing out/.test(text(v.timeWords)), text(v.timeWords));
  check(`${label}: In tune — the slip is the cue, no pitch words`, v.uv.v === 'slip' && /beat sooner/.test(text(v.tuneWords)) && !PITCH.test(text(v.tuneWords)), `${v.uv.v} "${text(v.tuneWords)}"`);
  // and the next round on time: the progress win
  const R2 = round(T, [ITS], { prevCue: v.tv.cue, ...o });
  check(`${label}: on time next → "on the beat now"`, /on the beat now/.test(text(R2.verdicts[0].timeWords)), text(R2.verdicts[0].timeWords));
}
{
  const R = round(T96, [MARY], { sung: noteLate }); say('one note late throughout', R);
  check('one note late throughout: slip', R.verdicts[0].tv.v === 'slip', R.verdicts[0].tv.v);
}
{
  const R = round(T96, [ITS], { sing: { breathy: new Set([0]) } }); say('breathy first syllable', R);
  check('breathy first syllable: no slip', R.verdicts[0].tv.v !== 'slip' && R.verdicts[0].uv.v !== 'slip', R.verdicts[0].tv.v);
}
{ // the singer skips "Its" and comes in on "fleece", on time, under loud click bleed: the first
  // sound is a beat after the first note — a counting slip by the rule (never a click)
  const R = round(T96, [ITS], { clickLevel: 0.6, sing: { silent: new Set([0]) } }); say('silent first beat, loud clicks', R);
  check('silent first beat: slip, not "Sing out"', R.verdicts[0].tv.v === 'slip' && !/Sing out/.test(text(R.verdicts[0].timeWords)), text(R.verdicts[0].timeWords));
}
{ // nothing sung: In time says "Sing out" (uncounted), never a slip or a fault on the clicks
  const R = round(T96, [ITS], { clickLevel: 0.6, sing: { silent: new Set([0, 1, 2, 3, 4]) } }); say('silent round', R);
  check('silent round: unheard', R.verdicts[0].tv.v === 'unheard', R.verdicts[0].tv.v);
  check('silent round: "Sing out on “Its”"', text(R.verdicts[0].timeWords) === 'Sing out on “Its”', text(R.verdicts[0].timeWords));
}
{ // a run over two phrases sung on time: the entry lag is the first phrase's only, behind/ahead never
  // a try in a run, both phrases pass
  const R = round(T96, [ITS, AS], { round: false, stage: 'song' }); say('run: phrase 1', R, 0); say('run: phrase 2', R, 1);
  check('run: lag only on the span\'s first phrase', R.rs[0].lag !== null && R.rs[1].lag === null);
  check('run: no take-scope tries in a run', R.rs.every((r) => r.takeObs.length === 0));
  check('run: both pass', R.verdicts.every((v) => v.tv.v === 'pass' && v.uv.v === 'pass'), R.verdicts.map((v) => `${v.tv.v}/${v.uv.v}`).join(' '));
  check('run: phrase observations carry the phrase index', R.obs.filter((o) => o.scope !== 'take').every((o) => o.li === ITS.i || o.li === AS.i));
}
{ // the second phrase of a run sung a beat late: a late-in with count → a slip on that phrase
  const R = round(T96, [ITS, AS], { round: false, stage: 'song', sung: (ns, beat) => ns.map((n, k) => (k >= 5 ? { ...n, t: n.t + beat } : n)) });
  say('run: 2nd phrase a beat late', R, 1);
  check('run: 2nd phrase late → not a pass', R.verdicts[1].tv.v !== 'pass', R.verdicts[1].tv.v);
}
console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
