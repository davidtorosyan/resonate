// A simulated singer for Ear's tools (earwalk.cjs, earprobe.cjs): an init script that replaces getUserMedia
// with a sawtooth (and a noise source for talking) following window.__sing, read against Sing's debug state
// (window.resonateSing.debug() in the shell, else window.resonateDebug() on sing.html).
// The singer, in the page: window.__sing = null (silent) or a plan —
//   { mode: 'free', at: performance.now() ms when note 1 starts, f: tempo factor (1.2 = 20 % slower),
//     cents: { [note index]: cents off }, all: cents off every note, oct: semitones (−12: an octave down),
//     jit: { [note index]: s late }, drop: [note index], scoop: cents a note starts off by (100 ms) }
//   { mode: 'beats', late: s late on every note, cents, all, oct }
//   { mode: 'hold', by: semitones off the target, cents }
//   { mode: 'talk' } — unpitched noise bursts (talking, a cough)
const SINGER = () => {
  if (location.protocol === 'about:') return;
  if (!navigator.audioSession) Object.defineProperty(navigator, 'audioSession', { configurable: true, value: { type: 'auto' } });
  window.__sing = null;
  let shared = null;
  navigator.mediaDevices.getUserMedia = async () => {
    if (!shared) {
      const ac = new AudioContext();
      const osc = ac.createOscillator(); osc.type = 'sawtooth';
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2500;
      const g = ac.createGain(); g.gain.value = 0;
      const nb = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      const ns = ac.createBufferSource(); ns.buffer = nb; ns.loop = true; const ng = ac.createGain(); ng.gain.value = 0;
      const dest = ac.createMediaStreamDestination();
      osc.connect(lp); lp.connect(g); g.connect(dest); osc.start(); ns.connect(ng); ng.connect(dest); ns.start();
      setInterval(() => {
        const d = window.resonateSing?.debug?.() || window.resonateDebug?.(); const P = window.__sing; let m = null, noise = 0;
        if (!d || !P) { g.gain.setTargetAtTime(0, ac.currentTime, 0.005); ng.gain.setTargetAtTime(0, ac.currentTime, 0.005); return; }
        const off = (i) => ((P.cents?.[i] || 0) + (P.all || 0)) / 100 + (P.oct || 0);
        if (P.mode === 'talk') { noise = Math.sin(performance.now() / 90) > 0.2 ? 0.2 : 0; }
        else if (P.mode === 'free' && d.ear.run === 'free') {
          const t = (performance.now() - P.at) / 1000;
          const [a, z] = [d.ear.ph.j0, d.ear.ph.j1], T0 = d.notes[a].t;
          for (let k = a; k < z; k++) {
            if (P.drop?.includes(k)) continue;
            const n = d.notes[k], s = (n.t - T0) * P.f + (P.jit?.[k] || 0), e = s + n.d * P.f - 0.04;
            if (t >= s && t < e) { m = n.midi + (n.shift || 0) + off(k) + (P.scoop && t - s < 0.1 ? -P.scoop / 100 : 0); break; }
          }
        } else if (P.mode === 'beats' && d.session?.kind === 'sing') {
          const t = d.nowT - (P.late || 0), [a, z] = d.take?.range || [0, d.notes.length];
          for (let k = a; k < z; k++) { const n = d.notes[k]; if (n.t <= t && t < n.t + n.d - 0.04) { m = n.midi + (n.shift || 0) + off(k); break; } }
        } else if (P.mode === 'hold' && d.ear.run === 'hold') {
          const N = d.ear.notes; const n = d.notes[N.targets[N.i]]; m = n.midi + (n.shift || 0) + (P.by || 0) + (P.cents || 0) / 100;
        }
        if (m === null) g.gain.setTargetAtTime(0, ac.currentTime, 0.005);
        else { osc.frequency.setValueAtTime(440 * 2 ** ((m - 69) / 12), ac.currentTime); g.gain.setTargetAtTime(0.25, ac.currentTime, 0.005); }
        ng.gain.setTargetAtTime(noise, ac.currentTime, 0.005);
      }, 5);
      shared = dest.stream;
    }
    return shared.clone();
  };
};

module.exports = { SINGER };
