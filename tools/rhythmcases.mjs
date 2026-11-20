// rhythm.js on synthetic takes (rhythmsynth.mjs) through the page's own feature and pitch code.
// Each case: how close the found onsets are to the truth (the vowel onsets the synth made), and
// what the coach would be told (rhythmObservations).
import { sing, melody } from './rhythmsynth.mjs';
import { features, frames, metricFor } from './rhythmharness.mjs';
import { findClicks, findOnsets, rhythmStats, rhythmObservations, firstSound, voiceCover, noteCover, tolOn } from '/home/user/resonate/public/rhythm.js';
import { clickWave, CLICK_GAIN } from '/home/user/resonate/public/piano.js';
import { gradeTake } from '/home/user/resonate/public/grade.js';
import { analyzeLines } from '/home/user/resonate/public/coach.js';
import { MIN_RMS, ANALYSIS_LAG } from '/home/user/resonate/public/pitch.js';
const GUIDED_ONLY = process.env.ONLY === 'guided'; // (ONLY=guided: just the guided-span cases below)

// 4/4: entries after rests, same-pitch repeats, a melisma, off-beat eighths, held notes.
const SPEC = [
  [60, 1, 'Ma'], [62, 1, 'ry'], [64, 1, 'had'], [64, 1, 'a'],
  [65, 0.5, 'lit'], [64, 1, 'tle'], [62, 1.5, 'lamb'], [null, 1],
  [67, 1, 'Its'], [67, 1, 'fleece'], [65, 0.5, 'was'], [64, 0.5, '', true], [62, 2, 'white'], [null, 1],
  [60, 0.5, 'as'], [62, 0.5, 'snow'], [64, 1, 'and'], [65, 1.5, 'ev'], [64, 0.5, 'ery'], [62, 3, 'where'],
];
const tune = (bpm = 96, shift = 0) => melody(SPEC.map(([m, ...r]) => [m === null ? null : m + shift, ...r]), bpm);
// 6/8 felt in dotted quarters (1.5 quarters), with off-beat eighths.
const SIX8 = melody([
  [64, 1.5, 'Row'], [64, 1, 'row'], [67, 0.5, 'your'], [69, 1.5, 'boat'], [null, 1.5],
  [67, 0.5, 'gent'], [65, 0.5, 'ly'], [64, 0.5, 'down'], [62, 1, 'the'], [64, 0.5, 'stream'], [60, 3, 'oh'],
], 160);

let fails = 0;
const ms = (x) => (x === null || x === undefined ? '  —' : `${x >= 0 ? '+' : ''}${Math.round(x * 1000)}`.padStart(4));
function run(name, o = {}, expect = {}) {
  if (GUIDED_ONLY) return;
  const T = o.tune || tune(o.bpm, o.shift);
  const { notes, spq } = T;
  const beatQ = o.beatQ ?? 1, beat = beatQ * spq;
  const songT0 = 3, rt = o.rt ?? 0.07;
  const count = []; for (let k = -4; k < 0; k++) count.push({ t: k * beat, accent: k === -4 });
  const guide = o.guide ? Array.from({ length: Math.ceil(T.length / beatQ) }, (_, k) => ({ t: k * beat, accent: k % 4 === 0 })) : [];
  const r = sing(notes, { songT0, rt, clicks: [...count, ...guide], clickLevel: o.clickLevel ?? 0.3, noise: o.noise ?? 0.002, humDb: o.humDb, piano: o.piano, ...o.sing });
  const feat = features(r.audio, r.sr);
  const latency = o.latencyEst ?? 0.04; // the browser's estimate the frames were shifted by
  const fr = frames(r.audio, r.sr, { songT0, latency, fps: 60, from: -0.5 });
  const cal = findClicks(r.audio, r.sr, 0, count.map((c) => ({ t: songT0 + c.t, accent: c.accent })), beat, (a) => clickWave(r.sr, a), (a) => CLICK_GAIN[a ? 'accent' : 'plain']);
  const { metric, lines } = metricFor(notes, { beatQ, spq, div: o.div ?? 2 });
  const unsung = o.sing?.silent ? notes.map((_, j) => o.sing.silent.has(j)) : null; // (as the pitch grading would say)
  const on = findOnsets(notes, feat, 0, fr, metric, { songT0, rt: cal ? cal.rt : null, latency, endT: o.endT ?? Infinity, unsung });
  const truth = new Map(r.truth.map((x) => [x.j, x]));
  // Without a calibration the absolute offset is unknown: compare timing relative to the lead.
  const tdevs = notes.map((n, j) => (truth.get(j) ? truth.get(j).onset - n.t : null)).filter((x) => x !== null).sort((a, b) => a - b);
  const tmed = tdevs[tdevs.length >> 1];
  const errs = [];
  let found = 0, wrong = 0;
  const rows = notes.map((n, j) => {
    const tr = truth.get(j), got = on.notes[j];
    const tdev = tr ? tr.onset - n.t : null;
    if (got.dev !== null) found++;
    if (got.dev !== null && tdev !== null) { const e = cal ? got.dev - tdev : (got.dev - on.lead) - (tdev - tmed); errs.push(Math.abs(e)); if (Math.abs(e) > 0.04) wrong++; }
    return `${n.text || '‿'}${ms(tdev)}/${ms(got.dev)}${got.kind ? got.kind[0] : ' '}${got.rel !== undefined ? ` r${ms(got.rel)}` : ''}`;
  });
  errs.sort((a, b) => a - b);
  const med = errs.length ? errs[errs.length >> 1] : null, p90 = errs.length ? errs[Math.floor(errs.length * 0.9)] : null;
  const st = rhythmStats(notes, on, metric, lines, { calibrated: !!cal });
  const obs = rhythmObservations(st, lines);
  const said = obs.filter((x) => x.tone === 'try').map((x) => x.kind + (x.j !== undefined ? '@' + (notes[x.j].text || x.j) : '') + (x.scope === 'take' ? '(take)' : ''));
  const good = obs.filter((x) => x.tone === 'good').length, style = obs.filter((x) => x.tone === 'style').map((x) => x.kind);
  const problems = [];
  if (expect.says) for (const w of expect.says) if (!said.some((x) => x.startsWith(w))) problems.push(`missing "${w}"`);
  if (expect.quiet && said.length) problems.push('should say nothing');
  if (expect.cal === true && !cal) problems.push('no calibration');
  if (expect.cal === false && cal) problems.push('calibrated');
  if (cal && Math.abs(cal.rt - rt) > 0.003) problems.push(`rt ${ms(cal.rt)} vs ${ms(rt)}`);
  if (found < (expect.minFound ?? notes.length - 2)) problems.push(`found ${found}`);
  if (wrong > (expect.maxWrong ?? 1)) problems.push(`${wrong} wrong`);
  if ((med ?? 1) > (expect.maxMed ?? 0.02)) problems.push(`median error ${ms(med)}`);
  if (expect.check) { const c = expect.check(on, st, cal); if (c) problems.push(c); }
  const ok = !problems.length;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: cal ${cal ? `${ms(cal.rt)}ms ×${cal.coupling.toFixed(2)}` : 'none'} lead ${ms(on.lead)} found ${found}/${notes.length} err med ${ms(med)} p90 ${ms(p90)} | says [${said.join(' ')}]${good ? ` +${good} good` : ''}${style.length ? ` style[${style}]` : ''}${problems.length ? '  ✗ ' + problems.join('; ') : ''}`);
  if (!ok || process.env.V) console.log('   ' + rows.join('  '));
}

const offbeat = (T, beatQ = 1) => (j) => { const n = T.notes[j], f = (n.q / beatQ) % 1; return f > 1e-6 && Math.abs(f * 2 - Math.round(f * 2)) < 1e-6; };
const T96 = tune();
run('on time', {}, { quiet: true, cal: true });
run('steady 150 ms late', { sing: { dev: () => 0.15 } }, { says: ['behind(take)'] });
run('steady 60 ms late (laid back: style, not a fault)', { sing: { dev: () => 0.06 } }, { quiet: true });
run('steady 90 ms early', { sing: { dev: () => -0.09 } }, { quiet: true, check: (on) => (Math.abs(on.lead + 0.09) < 0.025 ? null : 'lead') });
run('jitter ±50 ms', { sing: { dev: (j) => 0.05 * Math.sin(j * 2.3) } }, { quiet: true });
run('late entries after rests (+250 ms, catching up)', { sing: { dev: (j) => (T96.notes[j].restBefore && j > 0 ? 0.25 : j > 1 && T96.notes[j - 1].restBefore ? 0.1 : 0) } }, { says: ['late-in@Its', 'late-in@as'] });
run('dragging: +18 ms per note', { sing: { dev: (j) => 0.018 * j } }, { says: ['dragging'] });
run('rushing: −15 ms per note', { sing: { dev: (j) => -0.015 * j } }, { says: ['rushing'] });
run('off-beat eighths pushed late (+150 ms)', { sing: { dev: (j) => (offbeat(T96)(j) ? 0.15 : 0) } }, { says: ['offbeat-late'] });
run('held notes cut short by 1 beat+', { sing: { rel: (j) => (T96.notes[j].d > 0.9 ? -0.7 : 0) } }, { says: ['short@white'] });
run('click guide bleeding in (loud)', { guide: true, clickLevel: 0.6 }, { quiet: true });
run('headphones: no click, latency estimate 40 ms off', { clickLevel: 0, latencyEst: 0.03, rt: 0.07 }, { quiet: true, cal: false });
run('quiet speaker (earpiece): click 30 dB down, still found', { clickLevel: 0.01 }, { cal: true, quiet: true });
run('noisy room', { noise: 0.01 }, { quiet: true });
run('nasal/lateral hums only 6 dB under the vowel', { humDb: 6 }, { quiet: true });
run('nasal hums 3 dB under the vowel', { humDb: 3 }, { quiet: true, maxWrong: 3 });
run('bass voice (two octaves down: 65–98 Hz)', { shift: -24 }, { quiet: true });
run('slow (♩=60)', { bpm: 60 }, { quiet: true });
run('fast (♩=160)', { bpm: 160 }, { quiet: true, minFound: 16 });
run('breathy entries', { sing: { breathy: new Set([0, 8, 14]) } }, { maxWrong: 3, maxMed: 0.025 });
run('stopped half-way', { endT: 7 }, { minFound: 9 });
run('two notes not sung', { sing: { silent: new Set([5, 11]) } }, { minFound: 15 });
run('6/8 on time', { tune: SIX8, beatQ: 1.5, div: 3 }, { quiet: true });
const SIX8S = melody(SIX8.notes.length ? [[64, 1.5, 'Row'], [64, 1, 'row'], [67, 0.5, 'your'], [69, 1.5, 'boat'], [null, 1.5], [67, 0.5, 'gent'], [65, 0.5, 'ly'], [64, 0.5, 'down'], [62, 1, 'the'], [64, 0.5, 'stream'], [60, 3, 'oh']] : [], 100);
run('6/8 (eighth 0.3 s): off-beat eighths late (+100 ms)', { tune: SIX8S, beatQ: 1.5, div: 3, sing: { dev: (j) => ((SIX8S.notes[j].q / 1.5) % 1 > 1e-6 ? 0.1 : 0) } }, { says: ['offbeat-late'] });
run('fast (♩=160) with a Bluetooth-like 250 ms round trip', { bpm: 160, rt: 0.25 }, { quiet: true, cal: true, minFound: 16 });
run('headphones, latency estimate 200 ms off (Bluetooth)', { clickLevel: 0, latencyEst: 0.05, rt: 0.25 }, { quiet: true, cal: false });
run('a melisma note not sung', { sing: { silent: new Set([11]) } }, { minFound: 16, check: (on) => (on.notes[11].dev === null ? null : 'onset for the unsung melisma note') });
run('noisy room (fan/TV: vowel band ~18 dB under the voice): clean releases', { noise: 0.04 }, { quiet: true, maxWrong: 3, maxMed: 0.025 });
run('noisy room, held notes cut short: still said', { noise: 0.04, sing: { rel: (j) => (T96.notes[j].d > 0.9 ? -0.7 : 0) } }, { says: ['short@white'], maxWrong: 3, maxMed: 0.025 });

// Mic hiss alone (headphones: no click reaches the mic) must never pass as the count-in clicks.
if (!GUIDED_ONLY) {
  let fake = 0, tries = 0;
  for (const nClicks of [2, 3, 4, 6]) for (let seed = 1; seed <= 12; seed++) {
    let x = seed * 2654435761 >>> 0;
    const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296 * 2 - 1; };
    const sr = 48000, audio = new Float32Array(sr * 6);
    for (let i = 0; i < audio.length; i++) audio[i] = 0.003 * rnd();
    const clicks = Array.from({ length: nClicks }, (_, k) => ({ t: 1 + k * 0.6, accent: k === 0 }));
    tries++;
    if (findClicks(audio, sr, 0, clicks, 0.6, (a) => clickWave(sr, a), (a) => CLICK_GAIN[a ? 'accent' : 'plain'])) fake++;
  }
  const ok = fake === 0;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} hiss alone never calibrates: ${fake}/${tries} fake round trips`);
}

// ---------------------------------------------------------------------------
// Guided spans (docs/COACHING.md §3.3, §10 Step 3): one phrase sung as a practice round — its own
// count-in (a bar before the bar the phrase starts in), the click guide through it — analysed the
// way sing.js rhythmOf does for a span: frames moved by the measured round trip, the pitch
// grading, the span's first note an entry after the count-in, the onset gate from noteCover
// (left out only if unsung, or missed with < 20% cover), loose glides and the round's seed
// range, firstSound for the entry. The v75 path (every missed note left out) runs alongside.
const SLIP_BEATS = 0.6, SLIP_SEC = 0.25, SLIP_SEC_UNCAL = 0.35; // PRACTICE.time (§8.1)
function guided(T, js, o = {}) {
  const { notes: all, spq } = T;
  const ns = js.map((j) => all[j]);
  const beatQ = o.beatQ ?? 1, barQ = o.barQ ?? 4, beat = beatQ * spq, count = Math.round(barQ / beatQ);
  const fromQ = Math.floor(ns[0].q / barQ + 1e-9) * barQ, start = fromQ * spq;
  const last = ns[ns.length - 1], endQ = last.q + last.dq;
  const countClicks = Array.from({ length: count }, (_, k) => ({ t: start - (count - k) * beat, accent: k === 0 }));
  const guide = o.guide === false ? [] : Array.from({ length: Math.ceil((endQ - fromQ) / beatQ) }, (_, k) => ({ t: start + k * beat, accent: k % count === 0 }));
  const songT0 = 0.3 - countClicks[0].t; // the recording (ctx time 0) starts 0.3 s before the count-in
  const rt = o.rt ?? 0.07;
  const r = sing(o.sung ? o.sung(ns, beat) : ns, { songT0, rt, clicks: [...countClicks, ...guide], clickLevel: o.clickLevel ?? 0.3, noise: 0.002, until: last.t + last.d + 1, ...o.sing });
  const feat = features(r.audio, r.sr);
  const est = o.latencyEst ?? 0.04;
  let fr = frames(r.audio, r.sr, { songT0, latency: est, fps: 60, from: start - 0.5 });
  if (o.unpitched) fr = fr.map((f) => ({ ...f, midi: null })); // (YIN found no pitch: the energy rule)
  const cal = findClicks(r.audio, r.sr, 0, countClicks.map((c) => ({ t: songT0 + c.t, accent: c.accent })), beat, (a) => clickWave(r.sr, a), (a) => CLICK_GAIN[a ? 'accent' : 'plain']);
  let latency = est;
  if (cal) { const d = est - cal.rt; fr = fr.map((f) => ({ ...f, t: f.t + d })); latency = cal.rt; } // (as finishSing does)
  const trip = cal ? cal.rt : latency, stopAt = r.audio.length / r.sr;
  const grades = gradeTake(ns, fr, { endT: stopAt - songT0 - ANALYSIS_LAG - latency, gate: MIN_RMS });
  const { metric } = metricFor(ns, { beatQ, spq, div: o.div ?? 2 });
  metric[0] = { ...metric[0], entry: true, rest: count * beat }; // the span's first note: an entry after the count-in
  const lines = [ns.map((_, k) => k)];
  const from = ns[0].t - beat, to = ns[0].t + 4 * beat;
  const base = { songT0, trip, quiet: [-Infinity, from] }; // (the count-in: nobody sings there)
  const first = firstSound(feat, 0, fr, { songT0, trip, shiftT: latency - trip, from, to });
  const lag = first === null ? null : first - ns[0].t;
  const cover = noteCover(feat, 0, base, ns, beat);
  const gate = ns.map((_, k) => grades[k].status === 'unsung' || (grades[k].status === 'missed' && cover[k] < 0.2));
  const onOpts = { songT0, rt: cal ? cal.rt : null, latency, endT: stopAt - songT0 - trip };
  const on = findOnsets(ns, feat, 0, fr, metric, { ...onOpts, unsung: gate, loose: o.loose ?? true, ...(cal ? { seedRange: [-0.15, 0.25] } : {}) });
  const calibrated = !!cal && cal.rt <= 0.1 && o.guide !== false;
  const st = rhythmStats(ns, on, metric, lines, { calibrated });
  const obs = rhythmObservations(st, lines);
  // heard at all: the notes' cover on the lead-shifted clock, weighted by length (§3.3 rule 3)
  const nc = voiceCover(feat, 0, base, ns.map((n) => [n.t + on.lead, n.t + n.d + on.lead]));
  const heard = ns.reduce((a, n, k) => a + nc[k] * n.d, 0) / ns.reduce((a, n) => a + n.d, 0);
  const syl = ns.map((_, k) => k).filter((k) => !ns[k].melisma);
  const classified = syl.filter((k) => st.notes[k].cls !== null).length;
  const slip = lag !== null && lag >= Math.max(SLIP_BEATS * beat, cal ? SLIP_SEC : SLIP_SEC_UNCAL);
  // v75: every missed note left out, strict glides, the whole take's seed range
  const oldOn = findOnsets(ns, feat, 0, fr, metric, { ...onOpts, unsung: grades.map((g) => ['unsung', 'missed'].includes(g.status)) });
  const oldObs = rhythmObservations(rhythmStats(ns, oldOn, metric, lines, { calibrated }), lines);
  const oldRows = analyzeLines(ns, lines, grades, { text: () => '', name: (m) => `midi ${m}`, rhythm: { trust: 'ok', obs: oldObs } });
  const tr = r.truth.filter((x) => !x.glide).sort((a, b) => a.onset - b.onset);
  return { ns, beat, cal, first, lag, truth: tr.length ? tr[0].onset : null, slip, cover, gate, on, st, obs, heard, classified, syl: syl.length, grades, oldObs, oldRows, clicks: [...countClicks, ...guide].map((c) => c.t) };
}
const tries = (obs) => obs.filter((x) => x.tone === 'try').map((x) => x.kind + (x.count ? '(count)' : '') + (x.scope === 'take' ? '(take)' : ''));
function gcase(name, R, problems, extra = '') {
  const ok = !problems.length;
  if (!ok) fails++;
  const err = R.first !== null && R.truth !== null ? R.first - R.truth : null;
  const b = (x) => (x === null ? '—' : `${(x / R.beat).toFixed(2)}b`);
  console.log(`${ok ? 'PASS' : 'FAIL'} guided: ${name}: cal ${R.cal ? ms(R.cal.rt) + 'ms' : 'none'} first ${R.first === null ? 'none' : `err ${ms(err)}ms`} lag ${b(R.lag)}${R.slip ? ' SLIP' : ''} | classified ${R.classified}/${R.syl} lead ${ms(R.on.lead)} (${R.on.leadBy}, n ${R.on.leadN}) seed ${ms(R.on.seed)} heard ${Math.round(R.heard * 100)}% | says [${tries(R.obs).join(' ')}] | v75: grades ${R.grades.map((g) => g.status[0]).join('')} says [${tries(R.oldObs).join(' ')}]${extra}${problems.length ? '  ✗ ' + problems.join('; ') : ''}`);
  if (!ok || process.env.V) console.log('   ' + R.ns.map((n, k) => `${n.text || '‿'}${R.gate[k] ? '×' : ''} c${Math.round(R.cover[k] * 100)} ${ms(R.on.notes[k].dev)}${R.on.notes[k].kind ? R.on.notes[k].kind[0] : ' '}${R.st.notes[k].cls ? ' ' + R.st.notes[k].cls : ''}`).join('  '));
}
const near = (R, tol = 0.04) => (R.first !== null && R.truth !== null && Math.abs(R.first - R.truth) <= tol ? null : `first sound ${R.first === null ? 'none' : ms(R.first - R.truth) + 'ms'} off the truth`);
const share = (R) => R.classified / R.syl;
const ITS = [7, 8, 9, 10, 11]; // "Its fleece was ‿ white"
const beatLate = (ns, beat) => ns.map((n) => ({ ...n, t: n.t + beat }));
// One note late throughout: each syllable where the next one should be (the last one after its own).
const noteLate = (ns) => ns.map((n, k) => (k + 1 < ns.length ? { ...n, t: ns[k + 1].t, d: ns[k + 1].d } : { ...n, t: n.t + n.d }));
const P = (...xs) => xs.filter(Boolean);
{
  const R = guided(T96, ITS);
  gcase('on time (control)', R, P(near(R), R.slip && 'slip', tries(R.obs).length && 'a try', share(R) < 0.4 && 'too few classified'));
}
{ // 1: the v75 path reads it as anything but a late entry: at ♩=96 "Its" (= fleece's pitch) still
  // fits its slot moved 0.24 s, and the off-by-a-beat notes come out as wrong pitches; at ♩=60
  // the slot can't reach the late note: missed → "Sing out".
  const reasons = (R) => R.oldRows.flatMap((x) => x.reasons);
  const v75said = (R) => ` v75 coach: ${reasons(R).map((y) => `"${y.text}"`).join(' ')}`;
  const noEntryCue = (R) => (reasons(R).some((x) => ['late-in', 'early-in', 'late', 'early'].includes(x.kind)) ? 'v75 caught the late entry' : null);
  const R = guided(T96, ITS, { sung: beatLate });
  gcase('1 beat late ("Its fleece was white")', R, P(near(R), !(R.lag >= SLIP_BEATS * R.beat) && 'entryLag < 0.6 beat', !R.slip && 'no slip',
    noEntryCue(R), !reasons(R).some((x) => ['missed', 'note'].includes(x.kind)) && 'v75: no pitch/silence cue'), v75said(R));
  const R60 = guided(tune(60), ITS, { sung: beatLate });
  gcase('1 beat late at ♩=60', R60, P(near(R60), !R60.slip && 'no slip', noEntryCue(R60),
    !R60.grades.some((g) => g.status === 'missed') && 'v75: no missed note', !reasons(R60).some((x) => x.kind === 'missed' && /^Sing out/.test(x.text)) && 'v75: no "Sing out"'), v75said(R60));
  // headphones: no click in the mic, the browser's estimate 30 ms short — the slip still shows (≥ 0.35 s)
  const RH = guided(T96, ITS, { sung: beatLate, clickLevel: 0, latencyEst: 0.04, rt: 0.07 });
  gcase('1 beat late, headphones (uncalibrated)', RH, P(!!RH.cal && 'calibrated', !RH.slip && 'no slip', Math.abs(RH.lag - RH.beat) > 0.06 && 'lag off a beat'));
}
{ // 2
  const R = guided(T96, [0, 1, 2, 3, 4, 5, 6], { sung: noteLate });
  gcase('one note late throughout ("Mary had a little lamb")', R, P(near(R), !R.slip && 'no slip'));
}
{ // 3: legato (one breath, no consonants, no energy dips) with every other note 2 semitones sharp
  const LEG = melody([[60, 1, 'oo'], [64, 1, 'oo'], [69, 1, 'oo'], [64, 1, 'oo'], [60, 1, 'oo'], [64, 1, 'oo'], [69, 1, 'oo'], [64, 1, 'oo'], [60, 1, 'oo'], [65, 1, 'oo'], [60, 2, 'oo']], 96);
  const js = LEG.notes.map((_, j) => j);
  const sung = (ns) => ns.map((n, k) => ({ ...n, midi: n.midi + (k % 2 ? 2 : 0), melisma: k > 0 }));
  const L1 = guided(LEG, js, { sung }), L0 = guided(LEG, js, { sung, loose: false });
  gcase('legato on wrong pitches, loose', L1, P(share(L1) < 0.4 && `classified ${Math.round(share(L1) * 100)}% < 40%`, near(L1)));
  gcase('legato on wrong pitches, strict', L0, P(share(L0) >= 0.4 && `classified ${Math.round(share(L0) * 100)}% ≥ 40%`));
}
{ // 4: steady eighths at ♩=174, on time
  const FAST8 = melody([[null, 4], [62, 0.5, 'Sing'], [64, 0.5, 'a'], [66, 0.5, 'long'], [67, 0.5, 'with'], [69, 0.5, 'me'], [67, 0.5, 'to'], [66, 0.5, 'the'], [64, 0.5, 'end'], [62, 0.5, 'of'], [64, 0.5, 'the'], [66, 0.5, 'day'], [67, 0.5, 'and'], [69, 2, 'night']], 174);
  const R = guided(FAST8, FAST8.notes.map((_, j) => j));
  const agree = R.on.seed !== null && Math.abs(R.on.seed - R.on.lead) <= tolOn(R.st.u);
  gcase('steady eighths at ♩=174, on time', R, P(!R.cal && 'no calibration', tries(R.obs).length && 'a try', R.obs.some((x) => x.kind === 'behind' || x.kind === 'ahead') && 'behind/ahead', R.slip && 'slip', near(R),
    !agree && 'the seed disagrees with the lead', share(R) < 0.4 && 'too few classified'), ` seed ${agree ? 'agrees' : 'DISAGREES'} (tolOn ${ms(tolOn(R.st.u))})`);
}
{ // 5
  const R = guided(T96, ITS, { sing: { breathy: new Set([0]) } });
  gcase('breathy first syllable (120 ms attack), on time', R, P(R.slip && 'slip', near(R, 0.06)));
}
{ // 6: the singer silent for the first beat (comes in on "fleece", on time) under loud click bleed
  const onClick = (R) => (R.first !== null && R.clicks.some((c) => c < R.truth - 0.03 && Math.abs(R.first - c) <= 0.03) ? `first sound on the click at ${ms(R.clicks.find((c) => Math.abs(R.first - c) <= 0.03) - R.ns[0].t)}ms` : null);
  for (const [label, o] of [['voiced', {}], ['no pitch found (energy rule)', { unpitched: true }]]) {
    const R = guided(T96, ITS, { clickLevel: 0.6, sing: { silent: new Set([0]) }, ...o });
    gcase(`loud click bleed, silent for a beat, ${label}`, R, P(onClick(R), near(R)));
  }
}
{ // and a round with no singing at all: no first sound, not heard (not the clicks)
  const R = guided(T96, ITS, { clickLevel: 0.6, sing: { silent: new Set([0, 1, 2, 3, 4]) } });
  gcase('silent round, loud clicks', R, P(R.first !== null && 'a first sound', R.heard >= 0.3 && 'heard', R.on.notes.some((x) => x.dev !== null) && 'an onset'));
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exitCode = fails ? 1 : 0;
