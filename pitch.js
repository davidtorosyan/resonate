// Mic + YIN pitch detection, same algorithm and settings as the tuner (app.js).

export const MIN_RMS = 0.012;    // loudness gate
export const MIN_CLARITY = 0.8;  // YIN clarity gate
export const MIN_FREQ = 50;
export const MAX_FREQ = 1100;
export const FFT_SIZE = 4096;
export const TAIL_SAMPLES = 1024; // voicing also needs the newest ~21 ms to be loud, so short gaps register
export const ANALYSIS_LAG = 0.05; // a frame describes the trailing ~85 ms window; its pitch lags ~50 ms

// Open the mic with processing off (echo cancel / noise suppression / AGC
// distort pitch and level). Returns the pieces the caller needs. `ac`: an AudioContext
// to use (made earlier, in a tap, so it can run without one now) — left open by close().
export async function openMic({ ac: given = null } = {}) {
  try { if (navigator.audioSession) navigator.audioSession.type = "play-and-record"; } catch {}
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const ac = given || new (window.AudioContext || window.webkitAudioContext)();
  if (ac.state !== "running") await Promise.race([ac.resume(), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
  const source = ac.createMediaStreamSource(stream);
  const analyser = ac.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);
  const read = createReader(analyser, ac.sampleRate);

  async function close() {
    stream.getTracks().forEach((t) => t.stop());
    try { source.disconnect(); } catch {}
    if (!given) try { await ac.close(); } catch {}
  }

  return { stream, ac, source, analyser, read, close };
}

// An AnalyserNode (fftSize FFT_SIZE) fed by a mic → read() the newest window:
// { rms, db, midi | null }.
export function createReader(analyser, sampleRate) {
  const floatBuf = new Float32Array(FFT_SIZE);
  const detect = createYin(sampleRate, FFT_SIZE);
  return function read() {
    analyser.getFloatTimeDomainData(floatBuf);
    let sumSq = 0;
    for (let i = 0; i < floatBuf.length; i++) sumSq += floatBuf[i] * floatBuf[i];
    const rms = Math.sqrt(sumSq / floatBuf.length);
    let tailSq = 0;
    for (let i = floatBuf.length - TAIL_SAMPLES; i < floatBuf.length; i++) tailSq += floatBuf[i] * floatBuf[i];
    const tailRms = Math.sqrt(tailSq / TAIL_SAMPLES);
    let midi = null;
    if (rms > MIN_RMS && tailRms > MIN_RMS) {
      const r = detect(floatBuf);
      if (r && r.clarity > MIN_CLARITY && r.freq >= MIN_FREQ && r.freq <= MAX_FREQ) {
        midi = 69 + 12 * Math.log2(r.freq / 440);
      }
    }
    return { rms, db: 20 * Math.log10(rms || 1e-6), midi };
  };
}

// YIN (de Cheveigné & Kawahara, 2002), bounded to the vocal range.
export function createYin(sampleRate, size) {
  const minTau = Math.max(2, Math.floor(sampleRate / MAX_FREQ));
  const maxTau = Math.min((size >> 1) - 1, Math.floor(sampleRate / MIN_FREQ));
  const yinBuf = new Float32Array(maxTau + 1);
  return function detect(buf) {
    // Use as many samples as the largest lag allows (see CLAUDE.md).
    const halfN = buf.length - maxTau;
    for (let tau = 1; tau <= maxTau; tau++) {
      let sum = 0;
      for (let i = 0; i < halfN; i++) {
        const d = buf[i] - buf[i + tau];
        sum += d * d;
      }
      yinBuf[tau] = sum;
    }
    yinBuf[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= maxTau; tau++) {
      running += yinBuf[tau];
      yinBuf[tau] = (yinBuf[tau] * tau) / (running || 1);
    }
    let tau = -1;
    for (let i = minTau; i <= maxTau; i++) {
      if (yinBuf[i] < 0.2) {
        while (i + 1 <= maxTau && yinBuf[i + 1] < yinBuf[i]) i++;
        tau = i;
        break;
      }
    }
    if (tau === -1) return null;
    let interp = tau;
    if (tau > 0 && tau < maxTau) {
      const s0 = yinBuf[tau - 1], s1 = yinBuf[tau], s2 = yinBuf[tau + 1];
      const denom = 2 * (2 * s1 - s2 - s0);
      if (Math.abs(denom) > 1e-9) interp = tau + (s2 - s0) / denom;
    }
    return { freq: sampleRate / interp, clarity: 1 - yinBuf[tau] };
  };
}
