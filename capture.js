// Capture a take's raw mic audio (for playback and rhythm) via recorder-worklet.js.
// opts: keepSeconds (keep only the first so many seconds — a loop round keeps its count-in, for
// finding the clicks), onChunk(chunk) (every chunk as it arrives: rhythm.js features).
// Returns { finish } — await finish() for { data, sampleRate, start (audio-clock s), gain } or null.

const modules = new WeakMap(); // AudioContext → its addModule promise

export async function startCapture(ac, source, { keepSeconds = Infinity, onChunk = null } = {}) {
  const chunks = [];
  const keep = keepSeconds * ac.sampleRate;
  let kept = 0;
  let start = null;
  let flushed = null;
  let node, sink;
  try {
    if (!modules.has(ac)) modules.set(ac, ac.audioWorklet.addModule("recorder-worklet.js?v=72"));
    await modules.get(ac); // (once per context: the phrase loop records every round)
    node = new AudioWorkletNode(ac, "pcm-recorder");
    sink = ac.createGain();
    sink.gain.value = 0; // keep the node pulled without hearing yourself
    source.connect(node);
    node.connect(sink);
    sink.connect(ac.destination);
    node.port.onmessage = (e) => {
      const d = e.data;
      if (d instanceof Float32Array) {
        if (kept < keep) { chunks.push(d); kept += d.length; }
        if (onChunk) try { onChunk(d); } catch (err) { console.warn(err); }
      }
      else if (d.start !== undefined) start = d.start;
      else if (d.done && flushed) flushed();
    };
  } catch (err) {
    modules.delete(ac);
    console.warn("Take audio capture unavailable — no voice playback", err);
    return { finish: async () => null };
  }

  async function finish() {
    await new Promise((res) => {
      flushed = res;
      node.port.postMessage("flush");
      setTimeout(res, 400);
    });
    try { node.disconnect(); sink.disconnect(); source.disconnect(node); } catch {}
    node.port.onmessage = null; // (its closure held this take's chunks and the rhythm features)
    try { node.port.close(); } catch {}
    const len = chunks.reduce((a, c) => a + c.length, 0);
    if (!len || start === null) return null;
    const data = new Float32Array(len);
    let o = 0;
    for (const c of chunks) { data.set(c, o); o += c.length; }
    let peak = 0;
    for (let i = 0; i < len; i++) { const a = Math.abs(data[i]); if (a > peak) peak = a; }
    return { data, sampleRate: ac.sampleRate, start, gain: peak > 0 ? Math.min(8, 0.9 / peak) : 1 };
  }
  return { finish };
}

// Play captured audio on `ac` so that take-time `from` sounds at `when`.
// voice.start is expressed in the same take/song clock as `from`.
export function playVoice(ac, voice, when, from, nodes) {
  const buf = ac.createBuffer(1, voice.data.length, voice.sampleRate);
  buf.copyToChannel(voice.data, 0);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = voice.gain;
  src.connect(g);
  g.connect(ac.destination);
  const off = from - voice.start;
  if (off >= 0) src.start(when, off);
  else src.start(when - off);
  nodes.push(src);
}
