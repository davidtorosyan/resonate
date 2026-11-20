// grade.js on synthetic takes: in time, early, late, drifting, silent, unclear, wrong, octave, stopped early.
import { gradeTake, gradeLive, takeScore, timingTendency } from '/home/user/resonate/public/grade.js';
const FPS = 60;
// A melody: quarter notes at 100 bpm with a few eighths and a rest.
const spq = 0.6;
const mel = [60, 62, 64, 65, 67, 67, 65, 64, null, 62, 60, 62, 64, 64, 62, 62, 60];
const durs = [1, 1, 1, 1, 0.5, 0.5, 1, 1, 1, 1, 1, 0.5, 0.5, 1, 1, 0.5, 2];
const notes = []; let q = 0;
mel.forEach((m, i) => { if (m !== null) notes.push({ midi: m, t: q * spq, d: durs[i] * spq, restBefore: mel[i - 1] === null }); q += durs[i]; });
const end = q * spq;
// sing(t) → { midi|null, rms }
function take(sing, until = end + 0.5) {
  const frames = [];
  for (let t = -0.5; t < until; t += 1 / FPS) { const s = sing(t); frames.push({ t, midi: s.midi, rms: s.rms }); }
  return frames;
}
const noteAt = (t) => notes.find((n) => n.t <= t && t < n.t + n.d);
const singer = (offset = 0, opts = {}) => (t) => {
  const n = noteAt(t - offset);
  if (!n) return { midi: null, rms: 0.002 };
  if (opts.silent?.includes(notes.indexOf(n))) return { midi: null, rms: 0.002 };
  if (opts.unclear?.includes(notes.indexOf(n))) return { midi: null, rms: 0.05 };
  let m = n.midi + (opts.cents ?? 0) / 100 + (opts.wrong?.includes(notes.indexOf(n)) ? 2 : 0) + (opts.octave ?? 0) * 12;
  m += 0.08 * Math.sin(2 * Math.PI * 5.5 * t); // vibrato ±8¢
  const age = t - offset - n.t; if (age < 0.05) m -= 0.6 * (1 - age / 0.05); // scoop
  return { midi: m, rms: 0.08 };
};
const fmt = (g) => g.map((x) => `${x.status[0]}${x.shift !== undefined && x.status !== 'unsung' ? (x.shift > 0 ? '+' : '') + Math.round(x.shift * 100) : ''}`).join(' ');
let fails = 0;
const check = (name, frames, expect, opt = {}) => {
  const g = gradeTake(notes, frames, opt);
  const pct = takeScore(notes, g);
  const tend = timingTendency(g);
  const ok = expect(g, pct, tend);
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name.padEnd(22)} ${pct === null ? '—' : Math.round(pct * 100) + '%'} tend ${Math.round(tend * 1000)}ms | ${fmt(g)}`);
  return g;
};
const all = (g, s) => g.every((x) => s.includes(x.status));
check('in time', take(singer(0)), (g, p) => all(g, ['good']) && p > 0.85 && g.every((x) => Math.abs(x.shift) <= 0.06));
// The old strict grader on the same takes, for comparison: slot only.
check('150 ms early', take(singer(-0.15)), (g, p, t) => all(g, ['good']) && p > 0.8 && Math.abs(t + 0.15) <= 0.04);
check('200 ms late', take(singer(0.2)), (g, p, t) => all(g, ['good']) && p > 0.8 && Math.abs(t - 0.2) <= 0.04);
check('drifting early→late', take((t) => singer(-0.18 + 0.36 * Math.min(1, Math.max(0, t / end)))(t)), (g, p) => g.filter((x) => x.status === 'good').length >= notes.length - 1 && p > 0.75);
check('silent on 3 & 9', take(singer(0, { silent: [3, 9] })), (g) => g[3].status === 'missed' && g[9].status === 'missed' && g.filter((x) => x.status === 'good').length === notes.length - 2);
check('unclear on 5 & 10', take(singer(0, { unclear: [5, 10] })), (g, p) => g[5].status === 'unclear' && g[10].status === 'unclear' && p > 0.85);
check('wrong on 2 & 12', take(singer(0, { wrong: [2, 12] })), (g) => g[2].status === 'off' && g[12].status === 'off' && Math.round(g[2].sungMidi) === notes[2].midi + 2);
check('40 cents flat', take(singer(0, { cents: -40 })), (g) => all(g, ['ok']));
check('octave down', take(singer(0, { octave: -1 })), (g) => all(g, ['good']) && g.every((x) => x.octave === -1));
check('stopped halfway', take(singer(0), end / 2), (g) => g.slice(0, 7).every((x) => x.status === 'good') && g.slice(9).every((x) => x.status === 'unsung'), { endT: end / 2 });
check('silence', take(() => ({ midi: null, rms: 0.001 })), (g, p) => all(g, ['missed']) && p === 0);
// 400 ms early is beyond the tolerance: mostly not good.
check('400 ms early (too far)', take(singer(-0.4)), (g, p, t) => t <= -0.2 && p < 0.85);

// --- v44 review cases ---
const run = (name, ns, sing, until, expect) => {
  const fr = []; for (let t = -0.5; t < until; t += 1 / FPS) { const x = sing(t); fr.push({ t, midi: x.midi, rms: x.rms }); }
  const g = gradeTake(ns, fr, { endT: until - 0.05 });
  const ok = expect(g, takeScore(ns, g));
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name.padEnd(30)} ${fmt(g)}`);
};
const at = (ns, t) => ns.find((n) => n.t <= t && t < n.t + n.d);
const mk = (spec) => { let t = 0; return spec.map(([m, d, rest = 0]) => { t += rest; const n = { midi: m, t, d }; t += d; return n; }); };
// Final note rung 0.5 s past its end: nothing before it changes.
run('final note held 0.5 s', notes, (t) => { const n = at(notes, t) || (t >= end && t < end + 0.5 ? notes[notes.length - 1] : null); return n ? { midi: n.midi, rms: 0.08 } : { midi: null, rms: 0.002 }; }, end + 0.93,
  (g) => g.every((x) => x.status === 'good') && Math.abs(g[g.length - 1].shift) < 0.08 && g[g.length - 2].hit > 0.85);
// Phrase end held into the rest; the next phrase starts on that pitch.
const ph = mk([[60, 0.3], [62, 0.3], [64, 0.3], [65, 0.3], [65, 0.3, 0.3], [64, 0.3], [62, 0.3], [60, 0.6]]);
run('phrase end held into rest', ph, (t) => { let n = at(ph, t); if (!n && t >= 1.2 && t < 1.5) n = ph[3]; return n ? { midi: n.midi, rms: 0.08 } : { midi: null, rms: 0.002 }; }, 3.2,
  (g) => g.every((x) => x.status === 'good') && Math.abs(g[4].shift) < 0.12);
// Scoops: every note slides up from 1.5 semitones below over 0.2 s.
const sc = mk([[67, 1.2], [71, 0.3], [67, 0.3], [71, 1.2], [69, 0.3], [67, 0.3], [64, 1.2]]);
run('scoops into short notes', sc, (t) => { const n = at(sc, t); if (!n) return { midi: null, rms: 0.002 }; const age = t - n.t; return { midi: n.midi - (age < 0.2 ? 1.5 * (1 - age / 0.2) : 0), rms: 0.08 }; }, 5,
  (g) => g.every((x) => x.status === 'good' || x.status === 'ok') && g.filter((x) => x.status === 'ok').length <= 1 && g.slice(1, -1).every((x) => Math.abs(x.shift) < 0.08));
// A short repeated note never sung (the first rings 40 ms into it): missed, not good.
const rp = mk([[64, 0.6], [60, 0.6], [60, 0.2], [64, 0.6], [62, 0.6]]);
run('silent repeated short note', rp, (t) => { const n = at(rp, t); if (n === rp[2]) return t < rp[2].t + 0.04 ? { midi: 60, rms: 0.08 } : { midi: null, rms: 0.002 }; return n ? { midi: n.midi, rms: 0.08 } : { midi: null, rms: 0.002 }; }, 3,
  (g) => g[2].status === 'missed' && g[1].status === 'good' && g[3].status === 'good');
// Room noise (rms 0.02, no pitch) and only notes 0–2 sung: the rest are missed, not unclear.
run('noisy room, notes skipped', notes, (t) => { const n = at(notes, t); return n && notes.indexOf(n) < 3 ? { midi: n.midi, rms: 0.08 } : { midi: null, rms: 0.02 }; }, end + 0.5,
  (g, p) => g.slice(3).every((x) => x.status === 'missed') && p < 0.3);
// …but a breathy note in that room (loud, no pitch) is still unclear.
run('noisy room, one breathy note', notes, (t) => { const n = at(notes, t); if (!n) return { midi: null, rms: 0.02 }; return notes.indexOf(n) === 6 ? { midi: null, rms: 0.09 } : { midi: n.midi, rms: 0.08 }; }, end + 0.5,
  (g) => g[6].status === 'unclear' && g.filter((x) => x.status === 'good').length === notes.length - 1);
// A tiny joined note squeezed by an early next note: graded, not "unsung", at 60 and 30 fps.
const tiny = mk([[57, 0.6], [60, 0.3], [60, 0.1], [63, 0.3], [62, 0.6]]);
for (const fps of [60, 30]) {
  const fr = []; for (let t = -0.5; t < 2.5; t += 1 / fps) { let n = at(tiny, t + (t > 0.85 ? 0.13 : 0)); fr.push({ t, midi: n ? n.midi : null, rms: n ? 0.08 : 0.002 }); }
  const g = gradeTake(tiny, fr, { endT: 2.4 });
  const ok = g.every((x) => x.status !== 'unsung');
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${('tiny squeezed note @' + fps).padEnd(30)} ${fmt(g)}`);
}


// A scooped entry after a rest (0.2 s up from 1.5 semitones below) isn't "late".
const se = mk([[60, 0.6], [62, 0.6], [64, 0.6, 0.6], [62, 0.6], [60, 1.2]]);
run('scooped entry not late', se, (t) => { const n = at(se, t); if (!n) return { midi: null, rms: 0.002 }; const age = t - n.t; return { midi: n.midi - (n === se[2] && age < 0.2 ? 1.5 * (1 - age / 0.2) : 0), rms: 0.08 }; }, 4.5,
  (g) => g.every((x) => x.status === 'good') && Math.abs(g[2].shift) < 0.08);
// …but a silent 0.2 s late entry still is.
run('late entry still found', se, (t) => { const n = at(se, t); if (!n) return { midi: null, rms: 0.002 }; if (n === se[2] && t - n.t < 0.2) return { midi: null, rms: 0.002 }; return { midi: n.midi, rms: 0.08 }; }, 4.5,
  (g) => g[2].shift >= 0.15);

// Live grading of one note matches the final one in a clean early take.
const fr = take(singer(-0.15));
const live = notes.map((_, j) => gradeLive(notes, fr, j).status);
console.log((live.every((s) => s === 'good') ? 'PASS' : 'FAIL') + ' live grading of an early take: ' + live.join(','));
if (!live.every((s) => s === 'good')) fails++;
// Speed: a long song.
const big = []; for (let i = 0; i < 450; i++) big.push({ midi: 60 + (i % 7), t: i * 0.4, d: 0.4 });
const bigFrames = []; for (let t = 0; t < 450 * 0.4; t += 1 / 60) { const n = big[Math.floor(t / 0.4)]; bigFrames.push({ t: t + 0.1, midi: n.midi, rms: 0.1 }); }
const t0 = performance.now(); const gb = gradeTake(big, bigFrames); const ms = performance.now() - t0;
console.log(`${ms < 1500 ? 'PASS' : 'FAIL'} 450 notes / ${bigFrames.length} frames graded in ${Math.round(ms)} ms, ${gb.filter((x) => x.status === 'good').length} good, tend ${timingTendency(gb)}`);
process.exitCode = fails ? 1 : 0;
