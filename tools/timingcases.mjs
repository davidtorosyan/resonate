// timing.js: knots → map; partial tapping; merging; bounces; monotonic.
import { knotsFromTaps, mergeKnots, makeTiming } from '/home/user/resonate/public/timing.js';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
// Steady 100 bpm (0.6 s per quarter), words on every quarter from q=2..18.
let taps = []; for (let q = 2; q <= 18; q++) taps.push({ q, t: 10 + (q - 2) * 0.6 });
let segs = mergeKnots([], knotsFromTaps(taps));
let tm = makeTiming(segs);
ok(near(tm.avg, 0.6) && near(tm.qToT(10) - tm.qToT(2), 4.8) && near(tm.qToT(0), 0), 'steady taps: pace 0.6 s/q, time 0 at q 0');
ok(near(tm.qToT(30) - tm.qToT(18), 12 * 0.6), 'after the last tap: the average pace');
// Slows down: second half at 0.8 s/q.
taps = []; let t = 0; for (let q = 0; q <= 16; q++) { taps.push({ q, t }); t += q < 8 ? 0.5 : 0.8; }
segs = mergeKnots([], knotsFromTaps(taps)); tm = makeTiming(segs);
ok(near(tm.qToT(8), 4) && near(tm.qToT(16), 4 + 6.4) && segs.length === 3, 'ritardando: two paces, segments merged: ' + JSON.stringify(segs));
// A held note (fermata): one gap of 2 s between q 4 and 5.
taps = [0, 1, 2, 3, 4, 5, 6].map((q) => ({ q, t: q * 0.5 + (q >= 5 ? 1.5 : 0) }));
tm = makeTiming(mergeKnots([], knotsFromTaps(taps)));
ok(near(tm.qToT(5) - tm.qToT(4), 2), 'a held note keeps its length');
// Bounce: a second tap 30 ms later is dropped; out-of-order q dropped.
const k = knotsFromTaps([{ q: 0, t: 0 }, { q: 1, t: 0.03 }, { q: 1, t: 0.6 }, { q: 0.5, t: 0.9 }, { q: 2, t: 1.2 }]);
ok(k.length === 3 && k[1].t === 0.6, 'bounces and backwards taps dropped');
// Re-tapping a middle section replaces only it.
taps = []; for (let q = 0; q <= 20; q++) taps.push({ q, t: q * 0.6 });
segs = mergeKnots([], knotsFromTaps(taps));
const mid = []; for (let q = 8; q <= 12; q++) mid.push({ q, t: 100 + (q - 8) * 0.4 });
segs = mergeKnots(segs, knotsFromTaps(mid)); tm = makeTiming(segs);
ok(near(tm.qToT(8), 4.8) && near(tm.qToT(12) - tm.qToT(8), 1.6) && near(tm.qToT(20) - tm.qToT(12), 4.8), 'retap q 8–12 faster: before and after unchanged ' + JSON.stringify(segs));
// Monotonic everywhere.
let prev = -Infinity, mono = true; for (let q = -4; q < 30; q += 0.1) { const x = tm.qToT(q); if (x <= prev) mono = false; prev = x; }
ok(mono, 'monotonic');
// Too few taps.
ok(makeTiming(mergeKnots([], knotsFromTaps([{ q: 0, t: 0 }]))) === null, 'one tap: no map');
process.exitCode = fails ? 1 : 0;
// A 30 s pause in the tapping (restarting the music) is left out.
import('/home/user/resonate/public/timing.js').then(({ splitPauses }) => {
  const taps = []; for (let q = 0; q < 12; q++) taps.push({ q, t: q * 0.75 + (q >= 6 ? 30 : 0) });
  const { runs, pauses } = splitPauses(knotsFromTaps(taps));
  let sg = []; for (const r of runs) sg = mergeKnots(sg, r);
  const tm2 = makeTiming(sg);
  ok(runs.length === 2 && pauses.length === 1 && near(tm2.avg, 0.75) && near(tm2.qToT(6) - tm2.qToT(5), 0.75), 'a long pause in tapping is left out');
  // A held note (2 s on one syllable among 0.5 s ones) is not a pause.
  const h = [0, 1, 2, 3, 4, 5, 6].map((q) => ({ q, t: q * 0.5 + (q >= 4 ? 1.5 : 0) }));
  ok(splitPauses(knotsFromTaps(h)).runs.length === 1, 'a held note is not a pause');
  process.exitCode = fails ? 1 : 0;
});
