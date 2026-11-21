// Guided practice, end to end in node: synthetic practice rounds (rhythmsynth.mjs) through the
// page's own features, pitch frames and grading, Sing's own take rhythm (takerhythm.js rhythmOf:
// rhythm.js's guided-span analysis and a PhraseRhythm per phrase), practice.js's verdicts and
// coach.js's words. docs/COACHING.md §3.3, §5, §10.
// usage: node guidedverdicts.mjs   (V=1: print every PhraseRhythm)
import { sing, melody } from './rhythmsynth.mjs';
import { features, frames, metricFor } from './rhythmharness.mjs';
import { findClicks } from '../public/rhythm.js';
import { rhythmOf } from '../public/takerhythm.js';
import { clickWave, CLICK_GAIN } from '../public/piano.js';
import { gradeTake } from '../public/grade.js';
import { MIN_RMS, ANALYSIS_LAG } from '../public/pitch.js';
import { noteName } from '../public/music.js';
import { timeVerdict, tuneVerdict } from '../public/practice.js';
import { roundResult } from '../public/coach.js';

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
  const stopAt = r.audio.length / r.sr;
  const part = gradeTake(ns, fr, { endT: stopAt - songT0 - ANALYSIS_LAG - latency, gate: MIN_RMS });
  const grades = all.map((_, j) => (j >= j0 && j < j1 ? part[j - j0] : null));
  // Sing's own rhythmOf, as finishSing calls it for a guided span (startSing(part): the click
  // guide, the span's phrases; ctx time 0 = the recording's start), and prOf's PhraseRhythm.
  const { lines, score } = metricFor(all, { beatQ, spq, div: 2 });
  const stage = o.stage ?? 'time';
  const s = { latency: est, ac: {}, songT0, count, beatSec: beat, features: { result: () => feat }, part: { guided: true, stage, phrases: phrases.map((ph) => ph.js) } };
  const take = { range: [j0, j1], grades, frames: fr, latency, guide: 'click' };
  const rhythm = rhythmOf({ s, v: { start: 0 }, cal, stopAt, settings: null, take, score, notes: all, lines, qToT: (q) => q * spq, tapped: false });
  const res = { rhythm, obs: rhythm.obs, rs: rhythm.phrases.map((r) => r && { ...r, notes: rhythm.notes }) };
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
{ // a run over two phrases sung on time: the entry lag on the first phrase, and on the second
  // after its quiet rest (rhythmOf: a counting slip after a rest inside a run too — the copy this
  // suite used to test, before cleanup C 5.1, had only the first), behind/ahead never a try in a
  // run, both phrases pass
  const R = round(T96, [ITS, AS], { stage: 'song' }); say('run: phrase 1', R, 0); say('run: phrase 2', R, 1);
  check('run: an entry lag on the first phrase and after the rest, both on time', [0, 1].every((p) => R.rs[p].lag !== null && Math.abs(R.rs[p].lag) < 0.25 * R.beat), R.rs.map((r) => r.lag).join(' '));
  check('run: no take-scope tries in a run', R.rs.every((r) => r.takeObs.length === 0));
  check('run: both pass', R.verdicts.every((v) => v.tv.v === 'pass' && v.uv.v === 'pass'), R.verdicts.map((v) => `${v.tv.v}/${v.uv.v}`).join(' '));
  // (each phrase's own observations — phraseRhythm keys them by the phrase's place in the span, 0, 1, …;
  // the take's are keyed by lyric line and checked nowhere here)
  check('run: each phrase observation carries its phrase index in the span', R.rs.every((r, p) => r.obs.length > 0 && r.obs.filter((o) => o.scope !== 'take').every((o) => o.li === p)), R.rs.map((r) => r.obs.map((o) => `${o.kind}@${o.li}`).join(',')).join(' | '));
}
{ // the second phrase of a run sung a beat late: a late-in with count → a slip on that phrase
  const R = round(T96, [ITS, AS], { stage: 'song', sung: (ns, beat) => ns.map((n, k) => (k >= 5 ? { ...n, t: n.t + beat } : n)) });
  say('run: 2nd phrase a beat late', R, 1);
  check('run: 2nd phrase late → not a pass', R.verdicts[1].tv.v !== 'pass', R.verdicts[1].tv.v);
  check('run: 2nd phrase late after its rest → a counting slip on it', R.verdicts[1].tv.v === 'slip' && /beat sooner/.test(text(R.verdicts[1].timeWords)), text(R.verdicts[1].timeWords));
}
console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
