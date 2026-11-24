// A synthetic singer for rhythm tests: audio as the Sing page's mic would record it.
//
// sing(notes, opts) → { audio: Float32Array (ctx time 0 = sample 0), sr, truth: [{ j, onset, release }] }
//   notes: [{ t, d, midi, text, melisma, restBefore }] (song seconds)
//   opts: songT0 (ctx time of song time 0), rt (true round trip: what the singer hears + mic),
//         dev(j) → seconds early (−) / late (+) for note j's vowel onset, rel(j) → seconds the
//         release moves (− = cut short), silent: Set of j, clicks: [song times] (count-in + guide),
//         clickLevel, piano: level of the melody guide bleeding in, noise, vibrato (cents),
//         breathy: Set of j (slow 120 ms attack), loud(j) → the syllable's level (1: as recorded; its
//         consonant too), until (song time to stop).
// The "true" onset is the vowel onset (where a sung syllable's beat is felt); consonants come
// before it: unvoiced ones as a noise burst, voiced ones as a quiet hum.

import { clickWave, CLICK_GAIN } from '../public/piano.js';
export const SR = 48000;

function biquad(type, f, Q, sr = SR) {
  const w = (2 * Math.PI * f) / sr, c = Math.cos(w), s = Math.sin(w), a = s / (2 * Q);
  let b0, b1, b2;
  if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
  else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
  else { b0 = a; b1 = 0; b2 = -a; } // band-pass (peak gain Q·…: constant 0 dB peak)
  const a0 = 1 + a, a1 = -2 * c, a2 = 1 - a;
  const k = [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => { const y = k[0] * x + k[1] * x1 + k[2] * x2 - k[3] * y1 - k[4] * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}

// Seeded random, so a test is the same every run.
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

const UNVOICED = /^(s|sh|ch|t|k|p|f|h|th|c|x|q)/i;
const VOICED = /^(l|m|n|w|r|y|v|z|b|d|g|j)/i;
const hz = (m) => 440 * 2 ** ((m - 69) / 12);

export function sing(notes, o = {}) {
  const songT0 = o.songT0 ?? 2, rt = o.rt ?? 0.06, sr = SR;
  const until = o.until ?? (notes.length ? notes[notes.length - 1].t + notes[notes.length - 1].d + 0.6 : 1);
  const N = Math.ceil((songT0 + until + 0.5) * sr);
  const audio = new Float32Array(N);
  const rand = rng(o.seed ?? 7);
  const dev = o.dev || (() => 0), rel = o.rel || (() => 0);
  const vib = (o.vibrato ?? 30) / 100;
  const truth = [];
  // Each sung syllable: vowel from `on` to `off`, pitch following its notes (a melisma glides).
  const at = (t) => Math.round((songT0 + t) * sr);
  let phase = 0;
  for (let j = 0; j < notes.length; j++) {
    const n = notes[j];
    if (o.silent?.has(j) || n.melisma) continue;
    // The syllable spans this note and the melisma notes after it.
    let k = j;
    while (k + 1 < notes.length && notes[k + 1].melisma && !o.silent?.has(k + 1)) k++;
    const on = n.t + rt + dev(j);
    const next = notes[k + 1];
    const joined = next && !next.restBefore && !o.silent?.has(k + 1);
    let off = notes[k].t + notes[k].d + rt + dev(k) * 0.5 + rel(k);
    if (joined) off = Math.min(off, next.t + rt + dev(k + 1) - (UNVOICED.test(next.text || '') ? 0.07 : VOICED.test(next.text || '') ? 0.05 : 0.03));
    if (off > until) off = until;
    if (off <= on + 0.03) continue;
    truth.push({ j, onset: on - rt, release: off - rt });
    for (let m = j + 1; m <= k; m++) truth.push({ j: m, onset: notes[m].t + dev(m) - 0.02, glide: true }); // (the middle of its 40 ms pitch move)
    // Consonant before the vowel (at the syllable's level: loud(j)).
    const txt = n.text || '', lv = o.loud?.(j) ?? 1;
    if (UNVOICED.test(txt)) {
      const len = 0.05 + 0.03 * rand(), hpf = biquad('hp', 2500, 0.7);
      for (let i = at(on - len); i < at(on); i++) { const e = Math.sin(Math.PI * (i - at(on - len)) / (len * sr)); audio[i] += lv * 0.05 * e * hpf(rand() * 2 - 1); }
    } else if (VOICED.test(txt)) {
      // m n l w…: a hum at the note's pitch, strong below 500 Hz (the fundamental and its
      // 2nd harmonic), humDb under the vowel's level, for 60 ms.
      const len = 0.06, f = hz(n.midi), g = lv * 0.12 * 0.35 * 2.2 * 10 ** (-(o.humDb ?? 6) / 20);
      for (let i = at(on - len); i < at(on); i++) { const e = Math.min(1, (i - at(on - len)) / (0.015 * sr)); audio[i] += g * e * (Math.sin(2 * Math.PI * f * (i / sr)) + 0.5 * Math.sin(4 * Math.PI * f * (i / sr))); }
    }
    // The vowel.
    const attack = o.breathy?.has(j) ? 0.12 : 0.03, decay = 0.05;
    const amp = 0.12 * lv;
    for (let i = at(on); i < at(off); i++) {
      const t = i / sr - songT0, age = t - on;
      let env = Math.min(1, age / attack);
      if (t > off - decay) env *= Math.max(0, (off - t) / decay);
      // pitch: the note sung at time t (a melisma moves to the next note at its onset, gliding 40 ms)
      let m = n.midi;
      for (let q = j + 1; q <= k; q++) { const qs = notes[q].t + rt + dev(q); if (t >= qs) m = notes[q].midi; else if (t > qs - 0.04) m += (notes[q].midi - m) * (1 - (qs - t) / 0.04); }
      if (age < 0.05) m -= 0.5 * (1 - age / 0.05); // a small scoop
      if (age > 0.3) m += vib * Math.sin(2 * Math.PI * 5.5 * t);
      phase += (2 * Math.PI * hz(m)) / sr;
      let x = 0;
      for (let h = 1; h <= 12; h++) {
        const fh = h * hz(m); if (fh > 6000) break;
        const formant = 1 + 2.5 * Math.exp(-(((fh - 700) / 250) ** 2)) + 1.5 * Math.exp(-(((fh - 1200) / 300) ** 2));
        x += (formant / h) * Math.sin(h * phase);
      }
      audio[i] += amp * env * 0.35 * x;
    }
  }
  // The metronome coming back through the mic: 30 ms band-passed noise at each click + rt.
  // (the app's own click waveform and gain, scaled by how much of it reaches the mic)
  if (o.clicks && (o.clickLevel ?? 0) > 0) for (const c of o.clicks) {
    const w = clickWave(sr, !!c.accent), g = CLICK_GAIN[c.accent ? 'accent' : 'plain'], i0 = at(c.t + rt);
    for (let i = 0; i < w.length && i0 + i < N; i++) if (i0 + i >= 0) audio[i0 + i] += o.clickLevel * g * w[i];
  }
  // The melody guide's piano coming back through the mic.
  if (o.piano) for (const n of notes) {
    const f = hz(n.midi), i0 = at(n.t + rt), len = Math.floor(Math.min(n.d, 1.5) * sr);
    for (let i = 0; i < len && i0 + i < N; i++) { const e = Math.exp(-i / (0.4 * sr)) * Math.min(1, i / 48); audio[i0 + i] += o.piano * e * (Math.sin(2 * Math.PI * f * i / sr) + 0.5 * Math.sin(4 * Math.PI * f * i / sr) + 0.25 * Math.sin(6 * Math.PI * f * i / sr)); }
  }
  // Room noise (a little low-passed white noise).
  if (o.noise) { const lp = biquad('lp', 3000, 0.7); for (let i = 0; i < N; i++) audio[i] += o.noise * lp(rand() * 2 - 1); }
  return { audio, sr, truth, songT0, rt };
}

// A melody from a compact spec: [[midi | null (rest), quarters, syllable, melisma?], …] at `bpm`.
export function melody(spec, bpm = 100) {
  const spq = 60 / bpm, notes = [];
  let q = 0, rest = false;
  for (const [midi, dq, text = '', melisma = false] of spec) {
    if (midi === null) { rest = true; q += dq; continue; }
    notes.push({ midi, q, dq, t: q * spq, d: dq * spq, text, melisma, restBefore: rest || notes.length === 0 });
    rest = false;
    q += dq;
  }
  return { notes, spq, length: q };
}
