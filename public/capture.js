// Capture a take's raw mic audio (for playback) via recorder-worklet.js.
// Returns { finish } — await finish() for { data, sampleRate, start (audio-clock s), gain } or null.

export async function startCapture(ac, source) {
  const chunks = [];
  let start = null;
  let flushed = null;
  let node, sink;
  try {
    await ac.audioWorklet.addModule("recorder-worklet.js");
    node = new AudioWorkletNode(ac, "pcm-recorder");
    sink = ac.createGain();
    sink.gain.value = 0; // keep the node pulled without hearing yourself
    source.connect(node);
    node.connect(sink);
    sink.connect(ac.destination);
    node.port.onmessage = (e) => {
      const d = e.data;
      if (d instanceof Float32Array) chunks.push(d);
      else if (d.start !== undefined) start = d.start;
      else if (d.done && flushed) flushed();
    };
  } catch (err) {
    console.warn("Take audio capture unavailable — no voice playback", err);
    return { finish: async () => null };
  }

  async function finish() {
    await new Promise((res) => {
      flushed = res;
      node.port.postMessage("flush");
      setTimeout(res, 400);
    });
    try { node.disconnect(); sink.disconnect(); } catch {}
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
