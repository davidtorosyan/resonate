// Rhythm: when each sung note came in, from the sound itself (no speech recognition — the
// lyric's spelling at most says whether a syllable starts with a vowel or a consonant).
//
// Sources, all from the take's recorded PCM (capture.js), sample-accurate:
//  - band energies every ~5 ms (makeFeatures, streamed while the take runs): lo 80–450 Hz
//    (the voice's fundamental, nasal hum), mid 500–2500 Hz (vowel formants: where a sung
//    syllable's beat is felt — singers put the vowel on the beat, the consonant before it),
//    hi ≥ 3 kHz (consonants, the metronome click);
//  - the count-in clicks found in the recording by a matched filter (findClicks): the real
//    round trip (output + input latency), so a note meant for song time T is expected in the
//    recording at T + rt — and how loudly the speaker leaks into the mic;
//  - pitch frames (sing.js, ~60 Hz) for voicing and for pitch changes in legato/melismas.
//
// Everything is judged on the "as heard" clock: recording time − songT0 − rt. With no click
// in the recording (headphones, or too quiet) rt is unknown: only timing *within* the take
// (relative to its own steady lead) means anything, and nothing absolute is claimed.

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const lowerBound = (arr, x) => {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; }
  return lo;
};

// ---------------------------------------------------------------------------
// Features

// 2nd-order Butterworth section; 4th order = two of them (Q 0.5412, 1.3066).
function section(type, f, Q, sr) {
  const w = (2 * Math.PI * f) / sr, c = Math.cos(w), a = Math.sin(w) / (2 * Q), a0 = 1 + a;
  const b = type === "lp" ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [(1 + c) / 2, -(1 + c), (1 + c) / 2];
  return { b0: b[0] / a0, b1: b[1] / a0, b2: b[2] / a0, a1: (-2 * c) / a0, a2: (1 - a) / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
}
const chain = (spec, sr) => spec.flatMap(([type, f]) => [section(type, f, 0.5412, sr), section(type, f, 1.3066, sr)]);
function run(ch, x) {
  for (const s of ch) {
    const y = s.b0 * x + s.b1 * s.x1 + s.b2 * s.x2 - s.a1 * s.y1 - s.a2 * s.y2;
    s.x2 = s.x1; s.x1 = x; s.y2 = s.y1; s.y1 = y; x = y;
  }
  return x;
}

// Streaming: push(chunk) as the recording arrives; result() → { sr, hop (samples), lo, mid, hi }
// (mean square per hop; hop i covers samples [i·hop, (i+1)·hop) of the recording).
export function makeFeatures(sr) {
  const hop = Math.round(sr * 0.005);
  const lo = chain([["hp", 80], ["lp", 450]], sr), mid = chain([["hp", 500], ["lp", 2500]], sr), hi = chain([["hp", 3000]], sr);
  const out = { lo: [], mid: [], hi: [] };
  let n = 0, el = 0, em = 0, eh = 0;
  return {
    push(chunk) {
      for (let i = 0; i < chunk.length; i++) {
        const x = chunk[i];
        const a = run(lo, x), b = run(mid, x), c = run(hi, x);
        el += a * a; em += b * b; eh += c * c;
        if (++n === hop) { out.lo.push(el / hop); out.mid.push(em / hop); out.hi.push(eh / hop); n = 0; el = em = eh = 0; }
      }
    },
    result: () => ({ sr, hop, lo: Float32Array.from(out.lo), mid: Float32Array.from(out.mid), hi: Float32Array.from(out.hi) }),
  };
}

// ---------------------------------------------------------------------------
// The count-in clicks in the recording (matched filter)

function fft(re, im, inv = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inv ? 2 : -2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang), h = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < h; k++) {
        const p = i + k, q = p + h;
        const br = re[q] * cr - im[q] * ci, bi = re[q] * ci + im[q] * cr;
        re[q] = re[p] - br; im[q] = im[p] - bi; re[p] += br; im[p] += bi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

// Cross-correlation of x with template w at every lag 0…x.length − w.length (FFT).
function xcorr(x, w) {
  let n = 1;
  while (n < x.length + w.length) n <<= 1;
  const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n);
  ar.set(x); br.set(w);
  fft(ar, ai); fft(br, bi);
  for (let i = 0; i < n; i++) { const r = ar[i] * br[i] + ai[i] * bi[i], m = ai[i] * br[i] - ar[i] * bi[i]; ar[i] = r; ai[i] = m; }
  fft(ar, ai, true);
  return ar.subarray(0, x.length - w.length + 1);
}

// pcm: the recording; start: the audio-clock time of its first sample; clicks: [{ t (audio
// clock), accent }] of the count-in (the singer isn't singing yet), beat (s between clicks);
// wave(accent) → the click's exact waveform; gain(accent) → its playback gain.
// Every click's correlation is lined up on its scheduled time and summed (+6 dB with four
// clicks), over lags up to just under a beat — further, the next click (the same sound) would
// match too. The round trip is the earliest lag that's clearly a peak.
// → { rt (s), coupling (click amplitude in the mic ÷ as played), n } or null.
export function findClicks(pcm, sr, start, clicks, beat, wave, gain) {
  const hp = chain([["hp", 1500]], sr);
  const maxLag = Math.min(0.6, Math.max(0.1, beat - 0.02));
  const L0 = Math.round(-0.005 * sr), L1 = Math.round(maxLag * sr);
  const curves = [];
  for (const c of clicks) {
    const w = wave(c.accent);
    const i0 = Math.round((c.t - start) * sr) + L0, i1 = Math.round((c.t - start) * sr) + L1 + w.length;
    if (i0 < 0 || i1 > pcm.length) continue;
    for (const s of hp) s.x1 = s.x2 = s.y1 = s.y2 = 0;
    const seg = new Float64Array(i1 - i0);
    // (the filter runs in over the 20 ms before, so it starts settled)
    const pre = Math.max(0, i0 - Math.round(0.02 * sr));
    for (let i = pre; i < i0; i++) run(hp, pcm[i]);
    for (let i = i0; i < i1; i++) seg[i - i0] = run(hp, pcm[i]);
    let ww = 0;
    for (const v of w) ww += v * v;
    curves.push({ r: xcorr(seg, w), norm: ww * gain(c.accent) });
  }
  if (curves.length < 2) return null;
  const n = Math.min(...curves.map((c) => c.r.length));
  const sum = new Float64Array(n);
  for (const c of curves) for (let i = 0; i < n; i++) sum[i] += Math.max(0, c.r[i]) / c.norm;
  let best = 0;
  for (let i = 0; i < n; i++) if (sum[i] > best) best = sum[i];
  const mags = Array.from(sum).sort((a, b) => a - b);
  const noise = mags[mags.length >> 1] || 1e-12;
  // Mic hiss alone scores up to ~14 here (2 clicks); a click 40 dB down scores ≥ 70.
  if (best / noise < 25) return null;
  // the earliest lag at half the best (a reflection or the next click comes later), then its local top
  let at = 0;
  while (at < n && sum[at] < best / 2) at++;
  while (at + 1 < n && sum[at + 1] >= sum[at]) at++;
  // each click on its own should agree (within 4 ms) for at least half of them
  const tol = Math.round(0.004 * sr);
  let agree = 0;
  const amps = [];
  for (const c of curves) {
    let b = 0, k = -1;
    for (let i = Math.max(0, at - tol); i <= Math.min(c.r.length - 1, at + tol); i++) if (c.r[i] > b) { b = c.r[i]; k = i; }
    let m = 0;
    for (let i = 0; i < c.r.length; i++) if (c.r[i] > m) m = c.r[i];
    if (k >= 0 && b >= 0.5 * m) { agree++; amps.push(b / c.norm); }
  }
  if (agree < Math.max(2, curves.length / 2)) return null;
  if (at + L0 < Math.round(0.003 * sr)) return null; // no real output + input round trip is ≤ 3 ms
  return { rt: (at + L0) / sr, coupling: median(amps), n: agree };
}

// ---------------------------------------------------------------------------
// Onsets

const ATTACK_MIN = 6;     // dB a vowel's energy must rise to count as a new syllable
const SUSTAIN = 0.035;    // s it must then stay up (a click is gone in ~15 ms)
const PLATEAU = 0.12;     // s after a rise in which the vowel reaches its level
const VOWEL_DB = 9;       // the onset is where the rise gets within this many dB of that level
const MIN_GAP = 0.05;     // s between two notes' onsets
const ATTACK_OFFSET = 0.01; // s the −9 dB point sits into a typical 30 ms vowel swell (read as on time)
const DEV_COST = 2;       // per second away from the take's steady lead (a weak prior: real
                          //   rhythm mistakes are what we're here to find)
const STEP_COST = 1.5;    // per second the deviation changes between joined notes
const STEP_COST_REST = 0.5; // …across a rest

// dB of a band over ~20 ms windows (4 hops; enough for a bass's 82 Hz period) and its floor.
// Window i covers hops [i − 1, i + 3): its centre is hop i + 1's start.
function envelope(e) {
  const n = e.length, L = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let p = 0, c = 0;
    for (let k = Math.max(0, i - 1); k < Math.min(n, i + 3); k++) { p += e[k]; c++; }
    L[i] = 10 * Math.log10(p / c + 1e-14);
  }
  // The floor: the quiet between phrases (10th percentile) — unless the recording has hardly
  // any quiet in it (sung all through), then 20 dB under its middle level.
  const sorted = Float32Array.from(L).sort();
  const p10 = sorted[Math.floor(sorted.length * 0.1)] ?? -100, p50 = sorted[sorted.length >> 1] ?? -100, p90 = sorted[Math.floor(sorted.length * 0.9)] ?? -100;
  return { L, floor: p50 - p10 < 15 && p90 - p50 < 10 ? p50 - 20 : p10 };
}

// Syllable onsets in the vowel band: a rise of ≥ ATTACK_MIN dB within ~40 ms that stays up.
// Its time is where the rise first gets within VOWEL_DB of the level the vowel reaches —
// past a consonant's quieter start. strength = the rise in dB.
function attacks(t, L, floor) {
  const out = [];
  const hop = t.length > 1 ? t[1] - t[0] : 0.005;
  const back = Math.round(0.04 / hop), fwd = Math.round(0.03 / hop), hold = Math.round(SUSTAIN / hop), plat = Math.round(PLATEAU / hop);
  let last = -Infinity;
  for (let i = back; i + fwd + hold < L.length; i++) {
    let lo = Infinity, dip = i;
    for (let k = i - back; k <= i; k++) if (L[k] < lo) { lo = L[k]; dip = k; }
    const hi = L[i + fwd];
    if (hi - lo < ATTACK_MIN || hi < floor + 10) continue;
    let lo2 = Infinity;
    for (let k = i + 1 - back; k <= i + 1; k++) if (L[k] < lo2) lo2 = L[k];
    if (L[i + 1 + fwd] - lo2 > hi - lo) continue; // the next hop's rise is bigger: not the best yet
    let ok = true;
    for (let k = i + fwd; k < i + fwd + hold; k++) if (L[k] < floor + 10 || L[k] < hi - 9) { ok = false; break; }
    if (!ok) continue;
    let top = -Infinity;
    for (let k = i; k < Math.min(L.length, i + plat); k++) if (L[k] > top) top = L[k];
    const mid = Math.max((lo + hi) / 2, top - VOWEL_DB);
    let j = dip + 1; // from the bottom of the dip (not into the previous note's tail)
    while (j < L.length - 1 && L[j] < mid) j++;
    const a = L[j - 1], b = L[j], when = a >= b ? t[j] : t[j - 1] + ((mid - a) / (b - a)) * (t[j] - t[j - 1]);
    const s = hi - lo, at = when - ATTACK_OFFSET;
    if (at - last < MIN_GAP) {
      if (out.length && s > out[out.length - 1].s) { out[out.length - 1] = { t: at, s, kind: "attack" }; last = at; }
      continue;
    }
    out.push({ t: at, s, kind: "attack" });
    last = at;
  }
  return out;
}

// Where the sung pitch moves to the next note, for joined notes of different pitch (legato,
// melismas: the energy may not dip): the best split of the frames between the two notes' sung
// levels (a two-level step fit — vibrato crossing the midpoint doesn't fool it).
// loose (In time rounds, where the timing is judged and not the notes): a step sung on the wrong
// pitches counts too (looseStep) — legato on wrong notes still shows where each note began.
function glides(notes, frames, shiftT, lead, win, loose = false) {
  const out = new Map();
  const ft = frames.map((f) => f.t + shiftT);
  for (let j = 1; j < notes.length; j++) {
    const a = notes[j - 1], b = notes[j];
    if (b.restBefore || a.midi === b.midi || b.t - (a.t + a.d) > 0.05) continue;
    // between the middles of the two notes, as sung (moved by the take's lead)
    const i0 = lowerBound(ft, Math.max(a.t + a.d / 2, b.t - win[j].early) + lead), i1 = lowerBound(ft, Math.min(b.t + b.d / 2, b.t + win[j].late) + lead);
    const seg = [];
    for (let i = i0; i < i1; i++) if (frames[i].midi !== null) seg.push(i);
    if (seg.length < 6) continue;
    const ps = seg.map((i) => frames[i].midi);
    const at = noteStep(ps, a.midi, b.midi) ?? (loose ? looseStep(ps, b.midi - a.midi) : null);
    if (at === null) continue;
    const tm = (ft[seg[at]] + ft[seg[at + 1]]) / 2;
    out.set(j, { t: tm, s: Math.abs(b.midi - a.midi) >= 3 ? 9 : 6, kind: "glide" });
  }
  return out;
}

// The split (index of the last frame on note a) of pitches ps between written notes ma → mb, or
// null. A real move: ≥ 3 frames either side, each side near its note, and the step fits much
// better than one level (else note b was never sung — no onset).
function noteStep(ps, ma, mb) {
  const oct = 12 * Math.round((median(ps) - (ma + mb) / 2) / 12);
  const ya = ma + oct, yb = mb + oct;
  let best = Infinity, at = -1, cost = 0;
  for (const p of ps) cost += (p - yb) ** 2; // everything on note b
  for (let k = 0; k < ps.length; k++) { // frames 0..k on note a
    cost += (ps[k] - ya) ** 2 - (ps[k] - yb) ** 2;
    if (k >= 1 && k < ps.length - 2 && cost < best) { best = cost; at = k; }
  }
  if (at < 0) return null;
  const before = ps.slice(0, at + 1), after = ps.slice(at + 1);
  let one = 0;
  const mAll = median(ps);
  for (const p of ps) one += (p - mAll) ** 2;
  if (before.length < 3 || after.length < 3 || Math.abs(median(before) - ya) > 0.7 || Math.abs(median(after) - yb) > 0.7 || best > 0.5 * one) return null;
  return at;
}

// The loose rule: a two-level step on the singer's own levels (a free fit — the written ones
// would put the split anywhere when a side is off its note), the way the melody goes (interval
// w), at least half of it and ≥ 1 semitone; ≥ 3 frames a side and the same fit test. → split | null
const LOOSE_FRAC = 0.5, LOOSE_MIN = 1;
function looseStep(ps, w) {
  const n = ps.length, S1 = [0], S2 = [0];
  for (const p of ps) { S1.push(S1[S1.length - 1] + p); S2.push(S2[S2.length - 1] + p * p); }
  const sse = (i, k) => { const s = S1[k] - S1[i]; return S2[k] - S2[i] - (s * s) / (k - i); };
  const one = sse(0, n);
  let best = Infinity, at = -1;
  for (let k = 3; k <= n - 3; k++) { const c = sse(0, k) + sse(k, n); if (c < best) { best = c; at = k - 1; } }
  if (at < 0) return null;
  const step = median(ps.slice(at + 1)) - median(ps.slice(0, at + 1));
  if (Math.sign(step) !== Math.sign(w) || Math.abs(step) < Math.max(LOOSE_MIN, LOOSE_FRAC * Math.abs(w)) || best > 0.5 * one) return null;
  return at;
}

// Voicing starts (after ≥ 60 ms unvoiced): a weak cue for entries the energy missed.
function voicings(frames, shiftT) {
  const out = [];
  let quiet = 0;
  for (let i = 1; i < frames.length; i++) {
    const dt = frames[i].t - frames[i - 1].t;
    if (frames[i].midi === null) { quiet += dt; continue; }
    if (frames[i - 1].midi === null && quiet >= 0.06) out.push({ t: frames[i].t + shiftT - 0.04, s: 5, kind: "voicing" });
    quiet = 0;
  }
  return out;
}

const KIND_W = { attack: 1, glide: 0.9, voicing: 0.6 };

// One onset per note (or none), in order, near where the score puts it, close to the take's
// steady lead and preferring strong cues — dynamic programming over the notes.
function align(notes, cands, lead) {
  const n = notes.length;
  if (!n) return [];
  const opts = notes.map((nt, j) => [...cands[j].map((x) => ({ ...x, dev: x.t - nt.t })), { none: true, t: nt.t + lead, dev: null, s: 0 }]);
  const reward = (x) => (x.none ? 0 : (Math.min(x.s, 24) / 8) * KIND_W[x.kind]);
  const local = (x) => (x.none ? 0 : DEV_COST * Math.abs(x.dev - lead)) - reward(x);
  const cost = opts.map((o) => o.map(() => Infinity)), from = opts.map((o) => o.map(() => -1));
  opts[0].forEach((x, a) => { cost[0][a] = local(x); });
  for (let j = 1; j < n; j++) {
    const joined = !notes[j].restBefore;
    opts[j].forEach((x, b) => {
      const lx = local(x);
      opts[j - 1].forEach((y, a) => {
        if (cost[j - 1][a] === Infinity) return;
        if (!x.none && !y.none && x.t < y.t + MIN_GAP) return;
        let c = cost[j - 1][a] + lx;
        if (!x.none && !y.none) c += (joined ? STEP_COST : STEP_COST_REST) * Math.abs(x.dev - y.dev);
        if (c < cost[j][b]) { cost[j][b] = c; from[j][b] = a; }
      });
    });
  }
  let b = cost[n - 1].indexOf(Math.min(...cost[n - 1]));
  const pick = new Array(n);
  for (let j = n - 1; j >= 0; j--) { pick[j] = opts[j][b]; b = from[j][b]; }
  return pick;
}

// Tolerances scale with the beat's division u (an eighth in 4/4 and in 6/8): within tolOn is
// with the beat; beyond tolFlag is worth a word.
export const tolOn = (u) => Math.min(0.08, Math.max(0.04, 0.2 * u));
export const tolFlag = (u) => Math.min(0.16, Math.max(0.08, 0.33 * u));

// notes: the take's notes [{ t, d, midi, restBefore, melisma }] (song s), in order.
// feat: makeFeatures().result(); start: audio-clock time of the recording's first sample.
// frames: [{ t, midi, rms }] (song s, placed with `latency`). metric[j]: { beat, u (s), off
// (not on a felt beat), level ("beat" | "div" | "sub"), toBeat (s to the next beat), entry
// (after a rest ≥ ½ beat, or the first note), rest (s of rest before), lineEnd }.
// opts: songT0, rt (null: unknown), latency, endT, unsung[j] (leave note j out: nothing to
// time), and for guided spans (COACHING.md §3.3; the defaults are the whole take's):
// loose (glides on wrong pitches, In time rounds), seedRange (s: where the first guess at the
// lead may lie — −0.15…+0.25 in a calibrated round; a whole take allows an unmeasured
// Bluetooth delay).
// → { notes: [{ dev (s, + = late) | null, conf, kind, rel? (release − written end, s) }], lead,
//     leadN (on-beat, non-entry attacks the lead is the median of; 0 when it came from other
//     cues), leadBy ("on" | "any" | "glide" — which notes set it — | "seed" | null),
//     seed (the grid search's best offset, s — the middle of its best run; null when no attack
//     lined up: compare with lead to see the lead wasn't locked a division off) }
export function findOnsets(notes, feat, start, frames, metric, { songT0, rt, latency, endT = Infinity, unsung = null, loose = false, seedRange = [-0.15, 0.45] }) {
  const trip = rt ?? latency;
  const hopS = feat.hop / feat.sr;
  const t = hopTimes(feat, start, songT0, trip);
  const { L, floor } = envelope(feat.mid);
  const shiftT = latency - trip; // frames were placed with the estimate
  const att = attacks(t, L, floor);
  const voi = voicings(frames, shiftT);
  // A note can be judged only if the recording reaches past where it could start, it was sung
  // at all (unsung[j]: the pitch grading found nothing), and the take hadn't stopped.
  const heardTo = t.length ? t[t.length - 1] : -Infinity;
  const live = notes.map((n, j) => n.t < endT && !(unsung && unsung[j]) && n.t + Math.min(0.35, n.d) < heardTo);
  // How far to look: an entry may come in up to a beat late (or early, into the rest); a
  // syncopation may be pushed to the next beat; otherwise a little over the division.
  const win = notes.map((n, j) => {
    const m = metric[j] || {}, u = m.u ?? 0.3, beat = m.beat ?? 0.6;
    const base = Math.min(0.35, Math.max(0.15, 1.2 * u));
    const late = m.entry ? Math.min(beat + tolFlag(u), Math.max(base, n.d / 2)) : m.off ? Math.max(base, (m.toBeat ?? u) + tolFlag(u)) : base;
    const early = m.entry ? Math.min(Math.max(base, (m.rest ?? 0) - 0.06), beat + tolFlag(u)) : base;
    return { early, late };
  });
  const candsFor = (lead) => {
    const gl = glides(notes, frames, shiftT, lead, win, loose);
    return notes.map((n, j) => {
      if (!live[j]) return [];
      const lo = n.t + lead - win[j].early, hi = n.t + lead + win[j].late;
      const c = [];
      if (!n.melisma) for (const a of att) if (a.t >= lo && a.t <= hi) c.push(a);
      if (gl.has(j)) c.push(gl.get(j));
      if (!n.melisma) for (const v of voi) if (v.t >= lo && v.t <= hi) c.push(v);
      return c;
    });
  };
  // The steady lead comes from notes on the beat that aren't entries (mistakes cluster there).
  // → { lead, n (cues behind it), by } or null
  const steadyLead = (pick) => {
    const on = pick.filter((x, j) => live[j] && !x.none && x.kind === "attack" && !metric[j]?.off && !metric[j]?.entry).map((x) => x.dev);
    const any = pick.filter((x, j) => live[j] && !x.none && x.kind === "attack").map((x) => x.dev);
    const glided = pick.filter((x, j) => live[j] && !x.none && x.kind !== "voicing").map((x) => x.dev); // legato singing
    return on.length >= 3 ? { lead: median(on), n: on.length, by: "on" } : any.length >= 3 ? { lead: median(any), n: any.length, by: "any" }
      : glided.length >= 3 ? { lead: median(glided), n: glided.length, by: "glide" } : null;
  };
  // First guess at the lead (an unmeasured Bluetooth delay can be 0.2 s off the estimate): the
  // offset that lines the most strong syllable onsets up with the notes. (The search starts from
  // the first offset of the best run; seedEnd is its last, so the returned seed is the run's
  // middle — the first offset sits up to 40 ms early, too far to compare with the lead.)
  let seed = 0, seedBest = -1, seedEnd = 0, inBest = false;
  const attT = att.map((a) => a.t);
  for (let off = seedRange[0]; off <= seedRange[1] + 1e-9; off += 0.005) {
    let score = 0;
    notes.forEach((n, j) => {
      if (!live[j] || n.melisma) return;
      let s = 0;
      for (let k = lowerBound(attT, n.t + off - 0.04); k < att.length && att[k].t <= n.t + off + 0.04; k++) s = Math.max(s, Math.min(att[k].s, 24));
      score += s;
    });
    if (score > seedBest + 1e-9) { seedBest = score; seed = seedEnd = off; inBest = true; }
    else if (inBest && score >= seedBest - 1e-9) seedEnd = off;
    else inBest = false;
  }
  let lead = seedBest > 0 ? seed : 0, pick = align(notes, candsFor(lead), lead);
  let by = seedBest > 0 ? "seed" : null, leadN = 0;
  const l1 = steadyLead(pick);
  if (l1 !== null) {
    lead = l1.lead;
    pick = align(notes, candsFor(lead), lead);
    const l2 = steadyLead(pick) ?? l1;
    lead = l2.lead;
    by = l2.by;
    leadN = l2.by === "on" ? l2.n : 0;
  }
  const out = pick.map((x, j) => (!live[j] || x.none ? { dev: null, conf: 0, kind: null }
    : { dev: x.dev, conf: Math.min(1, Math.max(0, (x.s - 4) / 10)) * KIND_W[x.kind], kind: x.kind }));
  // Releases of long notes (≥ 2 beats) before a rest or a breath: where the vowel's energy
  // falls well below its own level (a tapered ending or the room's echo isn't a cut).
  notes.forEach((n, j) => {
    const next = notes[j + 1], m = metric[j] || {};
    if (!live[j] || out[j].dev === null || n.d < 2 * (m.beat ?? 0.6) || (next && !next.restBefore && !m.lineEnd)) return;
    if (n.t + n.d + 0.3 > Math.min(endT, heardTo)) return; // the take stopped around here: can't tell
    const on = n.t + out[j].dev;
    const end = n.t + n.d + lead; // the written end on the singer's own clock
    const stop = Math.min(end + 0.6, next ? next.t + lead - 0.05 : Infinity, endT);
    const i0 = lowerBound(t, on + 0.1), i1 = lowerBound(t, stop);
    if (i1 - i0 < 10) return;
    const level = median(Array.from(L.subarray(i0, Math.min(i1, lowerBound(t, on + Math.max(0.3, n.d / 2))))));
    if (level === null) return;
    const need = Math.round(0.06 / hopS);
    let runLen = 0;
    for (let i = i0; i < i1; i++) {
      // 20 dB under the note — or, in a noisy room, 6 dB over the noise (but well under the note)
      runLen = L[i] < Math.min(level - 8, Math.max(level - 20, floor + 6)) ? runLen + 1 : 0;
      if (runLen >= need) { out[j].rel = t[i - need + 1] - end; break; }
    }
    if (out[j].rel === undefined && t[Math.min(i1, t.length) - 1] >= end + 0.55) out[j].rel = 0.6; // still going into the rest
  });
  return { notes: out, lead, leadN, leadBy: by, seed: seedBest > 0 ? (seed + seedEnd) / 2 : null };
}

// ---------------------------------------------------------------------------
// Guided spans (COACHING.md §3.3): the first sound, and whether anything was sung at all —
// from the recording alone, never from the pitch grading (a note sung a beat late can be graded
// "missed" or "off" in its slot, which only moves 0.24 s: a timing fault, not silence or pitch).

// As-heard song time of each feature hop's end (recording time − songT0 − trip).
function hopTimes(feat, start, songT0, trip) {
  const hopS = feat.hop / feat.sr;
  return Float64Array.from({ length: feat.mid.length }, (_, i) => start + (i + 1) * hopS - songT0 - trip);
}

// The vowel band and its floor (as findOnsets has them) — but, given a stretch nobody sang in
// (`quiet`: [t0, t1] song s as heard, e.g. the count-in), never under that stretch's level: a
// recording with no singing at all has no quiet *between* phrases, so envelope() puts its floor
// 20 dB under the room's noise and the noise would read as singing.
function vowelFloor(feat, t, quiet) {
  const { L, floor } = envelope(feat.mid);
  if (!quiet) return { L, floor };
  const i0 = lowerBound(t, quiet[0]), i1 = lowerBound(t, quiet[1]);
  if (i1 - i0 < 20) return { L, floor }; // (< 0.1 s: too little to tell)
  return { L, floor: Math.max(floor, median(Array.from(L.subarray(i0, i1)))) };
}

const FIRST_RUN = 0.08;   // s of voiced frames that make the first sound
const FIRST_GAP = 0.05;   // s of unvoiced frames a run may skip (a YIN dropout at a scoop)
const FIRST_BACK = 0.12;  // s the sound may start before its voicing (YIN needs a few periods)
const FIRST_DB = 12;      // with no voiced run: dB over the floor…
const FIRST_HOLD = 0.15;  //   …held this long (a click is gone in ~30 ms)

// The vowel onset near hop i: the vowel band's peak in i … i + win hops, then back through the
// stretch that stays within VOWEL_DB of it (not past kMin), timed like an attack (where it
// crosses, − ATTACK_OFFSET). A consonant before the vowel (a hum, a fricative: ≥ 10 dB under it
// in this band) or a click before it with a dip between isn't part of that stretch. → s | null
function vowelOnset(t, L, i, win, kMin, minLevel) {
  let kp = i;
  for (let k = i; k < Math.min(L.length, i + win); k++) if (L[k] > L[kp]) kp = k;
  const thr = Math.max(L[kp] - VOWEL_DB, minLevel);
  if (L[kp] < thr) return null;
  let k = kp;
  while (k > Math.max(1, kMin) && L[k - 1] >= thr) k--;
  const a = L[k - 1], b = L[k];
  return (a < thr && b > a ? t[k - 1] + ((thr - a) / (b - a)) * (t[k] - t[k - 1]) : t[k]) - ATTACK_OFFSET;
}

// When the singing in a span began (the counting slip at its entry: the singer is quiet through
// the count-in, so the first sound is unambiguous). from/to: the window it may start in (song s,
// as heard: the first note − 1 beat … + 4 beats). The first run of voiced frames ≥ 80 ms that
// starts in it, timed at its vowel's onset (as findOnsets reads every note: where the beat is
// felt) — moved back at most 120 ms (YIN needs a few periods; a soft start voices late), or
// forward past a voiced consonant (an "m" voices before the vowel). No voiced run (unpitched,
// or YIN never settled): the first vowel-band level ≥ floor + 12 dB held ≥ 150 ms, timed the
// same way. A click passes neither test (unpitched, ~30 ms).
// frames: [{ t, midi }] (song s; + shiftT = as heard, as in findOnsets). quiet: the room's
// level comes from here (default: everything before `from` — the count-in).
// → song time (as heard) | null
export function firstSound(feat, start, frames, { songT0, trip, shiftT = 0, from, to, quiet = [-Infinity, from] }) {
  const hopS = feat.hop / feat.sr, plat = Math.round(PLATEAU / hopS);
  const t = hopTimes(feat, start, songT0, trip);
  const { L, floor } = vowelFloor(feat, t, quiet);
  // 1. the first voiced run
  let dt = 1 / 60;
  if (frames.length > 2) dt = median(frames.slice(1, 40).map((f, i) => f.t - frames[i].t)) || dt;
  let run0 = null, last = null, vs = null;
  for (const f of frames) {
    const ft = f.t + shiftT;
    if (ft < from) continue;
    if (f.midi === null) {
      if (run0 !== null && ft - last >= FIRST_GAP) run0 = null;
      continue;
    }
    if (run0 === null) {
      if (ft > to) break;
      run0 = ft;
    }
    last = ft;
    if (last + dt - run0 >= FIRST_RUN - 1e-9) { vs = run0; break; }
  }
  if (vs !== null) {
    const iv = lowerBound(t, vs);
    if (iv < 1 || iv >= L.length) return vs;
    const w = vowelOnset(t, L, iv, plat, iv - Math.round(FIRST_BACK / hopS), floor + 6);
    return w === null ? vs : Math.max(vs - FIRST_BACK, w); // (null: a hum with no vowel — the voicing it is)
  }
  // 2. no voiced run: sustained energy in the vowel band
  const need = Math.round(FIRST_HOLD / hopS);
  let runLen = 0;
  for (let i = lowerBound(t, from); i < L.length; i++) {
    if (L[i] < floor + FIRST_DB) { runLen = 0; continue; }
    if (!runLen && t[i] > to) break;
    if (++runLen >= need) {
      const i0 = i - need + 1;
      return Math.max(t[i0] - ATTACK_OFFSET, vowelOnset(t, L, i0, need, i0, floor + FIRST_DB) ?? t[i0]);
    }
  }
  return null;
}

// Per span [t0, t1] (song s, as heard — move a note by the take's lead first): the share of it
// with the vowel band ≥ floor + 10 dB, i.e. something was sung there (whatever its pitch).
// Time the recording doesn't reach counts as not sung. opts.quiet: as for firstSound (pass the
// count-in, or a silent take reads as sung).
export function voiceCover(feat, start, { songT0, trip, quiet = null }, spans) {
  const hopS = feat.hop / feat.sr;
  const t = hopTimes(feat, start, songT0, trip);
  const { L, floor } = vowelFloor(feat, t, quiet);
  return spans.map(([t0, t1]) => {
    if (!(t1 > t0)) return 0;
    let on = 0;
    for (let i = lowerBound(t, t0), i1 = lowerBound(t, t1); i < i1; i++) if (L[i] >= floor + 10) on++;
    return Math.min(1, (on * hopS) / (t1 - t0));
  });
}

// The onset gate in a guided span: per note, voiceCover over [t − 0.1, t + d + 1 beat] (as
// written: before the lead is known, so a note sung up to a beat late is still covered). A note
// is left out of the onset search only if unsung, or "missed" with cover < 20%.
// beat: s per beat — one number, or one per note (metric[j].beat).
export function noteCover(feat, start, opts, notes, beat) {
  return voiceCover(feat, start, opts, notes.map((n, j) => [n.t - 0.1, n.t + n.d + (typeof beat === "number" ? beat : beat[j])]));
}

// ---------------------------------------------------------------------------
// What the timing says (the numbers stay in the data; the coach turns them into words)

// on = findOnsets(); metric as above; lines [[j]]. calibrated: rt was measured (else the
// lead may just be the browser's latency estimate).
// → { notes: [{ dev, rdev, cls, rel }], lead, calibrated, drift, steady, offbeat, u, beat,
//     lines: [{ entries, drift, offbeat, short, held, u, beat }] }
export function rhythmStats(notes, on, metric, lines, { calibrated = false } = {}) {
  const lead = on.lead ?? 0;
  const per = notes.map((n, j) => {
    const x = on.notes[j], m = metric[j] || {};
    if (!x || x.dev === null || x.conf < 0.3) return { dev: x?.dev ?? null, rdev: null, cls: null, rel: x?.rel, kind: x?.kind ?? null };
    const rdev = x.dev - lead, u = m.u ?? 0.3;
    const cls = Math.abs(rdev) <= tolOn(u) ? "on" : Math.abs(rdev) <= tolFlag(u) ? "close" : rdev < 0 ? "early" : "late";
    return { dev: x.dev, rdev, cls, rel: x.rel, kind: x.kind };
  });
  // Off-beat notes (syncopations at the beat's division — not 16ths in a fast pop line)
  // against notes on the beat; ≥ 3 of them to say anything.
  const offDiff = (js) => {
    const att = (j) => per[j].rdev !== null && per[j].kind === "attack"; // (a glide's time is fuzzier)
    const offs = js.filter((j) => att(j) && metric[j]?.off && metric[j]?.level === "div" && !metric[j]?.entry).map((j) => per[j].rdev);
    const ons = js.filter((j) => att(j) && !metric[j]?.off && !metric[j]?.entry).map((j) => per[j].rdev);
    return offs.length >= 3 && ons.length >= 2 ? median(offs) - median(ons) : null;
  };
  // Rushing / dragging: how much the timing changes from first to last note (Theil–Sen: the
  // median of pairwise slopes, so one late entry doesn't read as rushing), entries left out.
  const trend = (js, minDt) => {
    const got = js.filter((j) => per[j].rdev !== null && per[j].kind === "attack" && !metric[j]?.entry);
    if (got.length < 4) return null;
    const sl = [];
    for (let a = 0; a < got.length; a++) for (let b = a + 1; b < got.length; b++) {
      const dt = notes[got[b]].t - notes[got[a]].t;
      if (dt > minDt) sl.push((per[got[b]].rdev - per[got[a]].rdev) / dt);
    }
    return sl.length ? median(sl) * (notes[got[got.length - 1]].t - notes[got[0]].t) : null;
  };
  const rows = lines.map((js) => {
    const entries = js.filter((j) => metric[j]?.entry && per[j].rdev !== null).map((j) => ({ j, rdev: per[j].rdev, dev: per[j].dev }));
    const short = js.filter((j) => {
      const r = per[j].rel, b = metric[j]?.beat ?? 0.6;
      if (r === undefined) return false;
      const isLast = j === js[js.length - 1];
      return r <= -Math.max(b / 2, 0.2 * notes[j].d) && (!isLast || r <= -0.5 * notes[j].d);
    });
    const held = js.filter((j) => per[j].rel !== undefined && per[j].rel >= Math.max(0.35, (metric[j]?.beat ?? 0.6) / 2));
    return { entries, drift: trend(js, 0.05), offbeat: offDiff(js), short, held, u: median(js.map((j) => metric[j]?.u ?? 0.3)), beat: median(js.map((j) => metric[j]?.beat ?? 0.6)) };
  });
  const all = notes.map((_, j) => j);
  const devs = all.filter((j) => per[j].rdev !== null).map((j) => Math.abs(per[j].rdev));
  return {
    notes: per, lead, calibrated,
    drift: trend(all, 0.5),
    steady: devs.length ? median(devs) : null, // typical distance from your own steady timing
    offbeat: offDiff(all),
    u: median(metric.map((m) => m?.u ?? 0.3)),
    beat: median(metric.map((m) => m?.beat ?? 0.6)),
    lines: rows,
  };
}

// Observations, for the coach: { kind, tone: "good" | "try" | "style", scope: "take" | "line",
// li?, j?, amount (s), beats (amount in beats), count? (a beat or more: a counting slip) }.
// A "try" only when clearly past the tolerance; "style" (a steady laid-back lag) is data only.
export function rhythmObservations(st, lines) {
  const out = [];
  const beats = (s, b) => Math.round((s / b) * 100) / 100;
  const B = st.beat || 0.6, U = st.u || 0.3;
  if (st.calibrated && st.lead !== null) {
    if (Math.abs(st.lead) >= Math.max(0.12, 0.2 * B)) out.push({ kind: st.lead > 0 ? "behind" : "ahead", tone: "try", scope: "take", amount: st.lead, beats: beats(st.lead, B) });
    else if (st.lead > tolOn(U)) out.push({ kind: "laid-back", tone: "style", scope: "take", amount: st.lead, beats: beats(st.lead, B) });
  }
  if (st.drift !== null && Math.abs(st.drift) >= Math.max(tolFlag(U), 0.25 * B)) out.push({ kind: st.drift > 0 ? "dragging" : "rushing", tone: "try", scope: "take", amount: st.drift, beats: beats(st.drift, B) });
  if (st.offbeat !== null && Math.abs(st.offbeat) >= tolFlag(U)) out.push({ kind: st.offbeat > 0 ? "offbeat-late" : "offbeat-early", tone: "try", scope: "take", amount: st.offbeat, beats: beats(st.offbeat, B) });
  st.lines.forEach((row, li) => {
    const b = row.beat || B, u = row.u || U;
    for (const e of row.entries) {
      // Off against your own steady timing *and* against the beat as best known (the one line
      // sung on time in a take that ran late isn't the one to fix).
      if (Math.abs(e.rdev) > tolFlag(u) && Math.abs(e.dev) > tolFlag(u) && Math.sign(e.dev) === Math.sign(e.rdev)) out.push({ kind: e.rdev > 0 ? "late-in" : "early-in", tone: "try", scope: "line", li, j: e.j, amount: e.rdev, beats: beats(e.rdev, b), count: Math.abs(e.rdev) >= 0.6 * b });
    }
    if (row.drift !== null && Math.abs(row.drift) >= Math.max(tolFlag(u), 0.25 * b)) out.push({ kind: row.drift < 0 ? "rushing" : "dragging", tone: "try", scope: "line", li, amount: row.drift, beats: beats(row.drift, b) });
    if (row.offbeat !== null && Math.abs(row.offbeat) >= tolFlag(u)) out.push({ kind: row.offbeat > 0 ? "offbeat-late" : "offbeat-early", tone: "try", scope: "line", li, amount: row.offbeat, beats: beats(row.offbeat, b) });
    for (const j of row.short) out.push({ kind: "short", tone: "try", scope: "line", li, j, amount: st.notes[j].rel, beats: beats(st.notes[j].rel, b) });
    for (const j of row.held) out.push({ kind: "held", tone: "try", scope: "line", li, j, amount: st.notes[j].rel, beats: beats(st.notes[j].rel, b) });
    // Something good to say: a line whose notes were all with the beat.
    const js = lines[li] || [];
    const judged = js.filter((j) => st.notes[j].cls !== null);
    if (judged.length >= 4 && judged.every((j) => st.notes[j].cls === "on" || st.notes[j].cls === "close") && judged.filter((j) => st.notes[j].cls === "on").length >= 0.8 * judged.length) {
      out.push({ kind: "steady-line", tone: "good", scope: "line", li });
    }
  });
  return out;
}
