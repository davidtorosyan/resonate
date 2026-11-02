// Captures raw mic samples on the audio thread for playback of a take.
// Posts { start } (audio-clock time of the first sample) once, then
// Float32Array chunks; "flush" posts the partial chunk and { done: true }.
class PcmRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(8192);
    this.n = 0;
    this.started = false;
    this.port.onmessage = (e) => {
      if (e.data === "flush") {
        if (this.n) this.port.postMessage(this.buf.slice(0, this.n));
        this.n = 0;
        this.port.postMessage({ done: true });
      }
    };
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    if (!this.started) {
      this.started = true;
      this.port.postMessage({ start: currentTime });
    }
    let i = 0;
    while (i < ch.length) {
      const k = Math.min(ch.length - i, this.buf.length - this.n);
      this.buf.set(ch.subarray(i, i + k), this.n);
      this.n += k;
      i += k;
      if (this.n === this.buf.length) {
        this.port.postMessage(this.buf);
        this.buf = new Float32Array(8192);
        this.n = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-recorder", PcmRecorder);
