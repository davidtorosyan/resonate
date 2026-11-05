// Piano (Salamander Grand Piano samples, CC-BY 3.0 — see piano/README.md)
// and a metronome click, scheduled on any AudioContext.

const SAMPLES = ["A1", ...[2, 3, 4, 5, 6].flatMap((o) => ["C", "Ds", "Fs", "A"].map((n) => n + o)), "C7"];
const ONSET = 0.012;   // samples start ~12 ms in (recording + encoder delay)
const RELEASE = 0.12;  // damper time constant when a note ends

const cache = new WeakMap(); // AudioContext -> Promise<{ keys, buffers }>

function sampleMidi(name) {
  const pc = { C: 0, Ds: 3, Fs: 6, A: 9 }[name.slice(0, -1)];
  return (Number(name.slice(-1)) + 1) * 12 + pc;
}

export function pianoReady(ac) {
  return cache.has(ac);
}

export function loadPiano(ac) {
  if (!cache.has(ac)) {
    const p = Promise.all(
      SAMPLES.map(async (name) => {
        const res = await fetch(`piano/${name}.mp3`);
        if (!res.ok) throw new Error(`piano sample ${name}: ${res.status}`);
        return [sampleMidi(name), await ac.decodeAudioData(await res.arrayBuffer())];
      }),
    ).then((entries) => ({ keys: entries.map((e) => e[0]).sort((a, b) => a - b), buffers: new Map(entries) }));
    p.catch(() => cache.delete(ac));
    cache.set(ac, p);
  }
  return cache.get(ac);
}

// Schedule one note. `piano` is the resolved loadPiano() value. Returns the note's
// gain node (to damp it early).
export function playPiano(ac, piano, when, dur, midi, level, nodes) {
  let key = piano.keys[0];
  for (const k of piano.keys) if (Math.abs(k - midi) < Math.abs(key - midi)) key = k;
  const src = ac.createBufferSource();
  src.buffer = piano.buffers.get(key);
  src.playbackRate.value = 2 ** ((midi - key) / 12);
  const g = ac.createGain();
  const end = when + Math.max(0.12, dur);
  g.gain.setValueAtTime(level, when);
  g.gain.setTargetAtTime(0, end, RELEASE);
  src.connect(g);
  g.connect(ac.destination);
  src.start(when, ONSET);
  src.stop(end + RELEASE * 6);
  nodes.push(src);
  return g;
}

// Hold a note down like a piano key, until release(at). The samples die away fast (mid
// and high notes are ~40 dB down within a second, and they end at 3 s), so with
// `sustain` a soft steady tone at the same pitch fades in under the piano to keep a held
// pitch audible. It has plenty of overtones (≈1/n^1.2, like a mellow sawtooth) and is
// boosted below middle C: a phone speaker barely plays below ~200 Hz, so a low note's
// fundamental alone would be near silent. release() damps both like lifting the key; it
// can be called again with an earlier time (stop now instead of at the end of the note).
const SUSTAIN = 0.05;   // held tone's level, relative to the piano's
const HARMONICS = [0, ...Array.from({ length: 12 }, (_, i) => 1 / (i + 1) ** 1.2)];
const waves = new WeakMap(); // AudioContext -> PeriodicWave

export function holdPiano(ac, piano, when, midi, level, { sustain = true } = {}) {
  const nodes = [];
  const g = playPiano(ac, piano, when, 3600, midi, level, nodes); // until released
  const parts = [{ src: nodes[0], gain: g.gain }];
  if (sustain) {
    let wave = waves.get(ac);
    if (!wave) {
      wave = ac.createPeriodicWave(new Float32Array(HARMONICS.length), new Float32Array(HARMONICS));
      waves.set(ac, wave);
    }
    const osc = ac.createOscillator();
    osc.setPeriodicWave(wave);
    osc.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    const sg = ac.createGain();
    const low = Math.min(2, Math.max(1, 1 + (60 - midi) / 24)); // ×1 at C4 → ×2 at C2
    sg.gain.setValueAtTime(0, when);
    sg.gain.setTargetAtTime(SUSTAIN * level * low, when + 0.15, 0.3); // in as the piano fades
    osc.connect(sg);
    sg.connect(ac.destination);
    osc.start(when);
    parts.push({ src: osc, gain: sg.gain });
  }
  let releasedAt = Infinity;
  return {
    // Damp at `at` with time constant `tc` (RELEASE = a lifted key; small = cut off).
    release(at = ac.currentTime, tc = RELEASE) {
      at = Math.max(at, ac.currentTime);
      if (at >= releasedAt) return;
      releasedAt = at;
      if (at <= when) {
        // Called off before it started: silence it outright (cancelling its starting levels
        // alone would leave the gains at their default, full volume, for an instant).
        for (const p of parts) {
          p.gain.cancelScheduledValues(0);
          p.gain.setValueAtTime(0, ac.currentTime);
          try { p.src.stop(when); } catch {}
        }
        return;
      }
      for (const p of parts) {
        p.gain.cancelScheduledValues(at);
        p.gain.setTargetAtTime(0, at, tc);
        try { p.src.stop(at + tc * 6); } catch {}
      }
    },
  };
}

// Metronome click: a short filtered noise burst. Noise has no pitch, so the
// mic picking it up doesn't register as singing.
export function playClick(ac, when, accent, nodes) {
  const len = Math.floor(ac.sampleRate * 0.03);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len / 6));
  const src = ac.createBufferSource();
  src.buffer = buf;
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = accent ? 3200 : 2200;
  bp.Q.value = 1.2;
  const g = ac.createGain();
  g.gain.value = accent ? 1.6 : 0.9;
  src.connect(bp);
  bp.connect(g);
  g.connect(ac.destination);
  src.start(when);
  nodes.push(src);
}
