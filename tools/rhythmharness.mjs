// Run the Sing page's own analysis on synthetic audio, in node:
//  features(): rhythm.js makeFeatures fed 8192-sample chunks, as capture.js delivers them;
//  frames(): what sing.js's requestAnimationFrame loop gets from pitch.js's reader.
import { makeFeatures } from '../public/rhythm.js';
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

// Metric facts per note for a melody() tune in one meter: beats per bar, beat in quarters
// (1.5 in 6/8), seconds per quarter; lines split at rests.
export function metricFor(notes, { beatQ = 1, spq, div = 2 }) {
  const lines = [];
  notes.forEach((n, j) => { if (!j || n.restBefore) lines.push([]); lines[lines.length - 1].push(j); });
  const lineEnd = new Set(lines.map((l) => l[l.length - 1]));
  const metric = notes.map((n, j) => {
    const pos = n.q / beatQ, frac = pos - Math.floor(pos + 1e-6);
    const off = frac > 1e-6;
    const level = !off ? 'beat' : Math.abs(frac * div - Math.round(frac * div)) < 1e-6 ? 'div' : 'sub';
    const prev = notes[j - 1];
    const rest = prev ? (n.q - (prev.q + prev.dq)) * spq : Infinity;
    const beat = beatQ * spq;
    return { beat, u: beat / div, off, level, toBeat: off ? (Math.ceil(pos - 1e-6) - pos) * beat : 0, entry: j === 0 || (n.restBefore && rest >= beat / 2), rest: Math.min(rest, 9), lineEnd: lineEnd.has(j) };
  });
  return { metric, lines };
}
