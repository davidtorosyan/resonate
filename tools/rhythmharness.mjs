// Run the Sing page's own analysis on synthetic audio, in node:
//  features(): rhythm.js makeFeatures fed 8192-sample chunks, as capture.js delivers them;
//  frames(): what sing.js's requestAnimationFrame loop gets from pitch.js's reader;
//  metricFor(): Sing's metricOf on a melody() tune.
import { makeFeatures } from '../public/rhythm.js';
import { metricOf } from '../public/takerhythm.js';
import { createYin, FFT_SIZE, MIN_RMS, MIN_CLARITY, MIN_FREQ, MAX_FREQ, TAIL_SAMPLES, ANALYSIS_LAG } from '../public/pitch.js';

export function features(audio, sr) {
  const f = makeFeatures(sr);
  for (let i = 0; i < audio.length; i += 8192) f.push(audio.subarray(i, Math.min(audio.length, i + 8192)));
  return f.result();
}

// frames as sing.js records them: ctx time τ every 1/fps s → { t: τ − songT0 − ANALYSIS_LAG − latency, midi, rms }
export function frames(audio, sr, { songT0, latency, fps = 60, from = -1, to = Infinity }) {
  const yin = createYin(sr, FFT_SIZE);
  const out = [];
  for (let ct = Math.max(FFT_SIZE / sr, songT0 + from); ct < audio.length / sr && ct < songT0 + to; ct += 1 / fps) {
    const e = Math.floor(ct * sr), buf = audio.subarray(e - FFT_SIZE, e);
    let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    const rms = Math.sqrt(s / FFT_SIZE);
    let ts = 0; for (let i = FFT_SIZE - TAIL_SAMPLES; i < FFT_SIZE; i++) ts += buf[i] * buf[i];
    let midi = null;
    if (rms > MIN_RMS && Math.sqrt(ts / TAIL_SAMPLES) > MIN_RMS) {
      const d = yin(buf);
      if (d && d.clarity > MIN_CLARITY && d.freq >= MIN_FREQ && d.freq <= MAX_FREQ) midi = 69 + 12 * Math.log2(d.freq / 440);
    }
    out.push({ t: ct - songT0 - ANALYSIS_LAG - latency, midi, rms });
  }
  return out;
}

// Metric facts per note for a melody() tune in one meter, from Sing's own metricOf
// (takerhythm.js): beat in quarters (1.5 in 6/8: div 3), seconds per quarter; bars from q 0;
// lines split at rests.
export function metricFor(notes, { beatQ = 1, spq, div = 2 }) {
  const lines = [];
  notes.forEach((n, j) => { if (!j || n.restBefore) lines.push([]); lines[lines.length - 1].push(j); });
  const score = scoreFor(notes, { beatQ, div });
  return { metric: metricOf(score, notes, lines, (q) => q * spq), lines, score };
}
// The score metricOf reads: one meter (four beats of beatQ, or 6/8 for a compound beat: div 3),
// whole bars from q 0 to the last note's end.
export function scoreFor(notes, { beatQ = 1, div = 2 }) {
  const [beats, beatType] = div === 3 ? [6, 12 / beatQ] : [4, 4 / beatQ];
  const barQ = (beats * 4) / beatType;
  const last = notes[notes.length - 1], length = last ? last.q + last.dq : 0;
  const measures = [];
  for (let q = 0; q < length - 1e-9 || !measures.length; q += barQ) measures.push(q);
  return { beats, beatType, meters: measures.map(() => [beats, beatType]), measures, length: measures.length * barQ };
}
