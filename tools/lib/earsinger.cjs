// A simulated singer for Ear's tools (earwalk.cjs, earprobe.cjs; earcases.mjs sings the same plans in node):
// an init script that replaces getUserMedia with a sawtooth (and a noise source for talking) following
// window.__sing, read against Sing's debug state (window.resonateSing.debug() in the shell, else
// window.resonateDebug() on sing.html).
// The singer, in the page: window.__sing = null (silent) or a plan. Every note index is the note's index IN
// THE PHRASE (0 = its first note; ≥ the phrase's length: `extra` notes after it).
//   { mode: 'free', at: performance.now() ms when note 0 starts, f: tempo factor (1.2 = 20 % slower), … }
//   { mode: 'beats', late: s late on every note, f (1.1: slowing 10 % against the click), … } — on the take's
//       song clock
//   { mode: 'hold', by: semitones off the target, cents, vib }
//   { mode: 'talk' } — unpitched noise bursts (talking, a cough)
// The fields a free or beats plan sings with (segments() below turns them into notes):
//   cents {i: ¢}, all (¢ every note), wrong {i: semitones}, oct (semitones: −12 an octave down)
//   drift (¢ by the phrase's end, from 0 at its start), vib (¢ depth, 5.5 Hz), scoop (¢ a note starts off by, 100 ms)
//   jit {i: s} — the whole note late (−: early), its length kept
//   starts {i: s} — only its start moves: the note before is held up to a late one (with gap: true it
//       isn't — a silence), an early one cuts the note before; the note still ends where it did
//   drop [i] — not sung; stop: i — nothing after note i; held: s — the last note sung held at most s (a long
//       last note let go early)
//   curve: x — the tempo eases from 1 to 1 + x across the line (each note's length × 1 + x·its place in the line,
//       from 0 at note 0's start to 1 at the last note's end: a ritardando into the line's end; −x an accelerando)
//   false {n, gap} — a false start: notes 0…n−1, a silence until gap s after note n's time, then from note 0
//   extra: n — n notes past the phrase sung too (free); hum {m, d} — a hum at midi m for d s, ending 0.3 s
//       before note 0 (free); vol (the gain, default 0.25: 0.012 is a whisper the gate doesn't hear)
//   label — the fake mic track's label while this plan (or, once it's cleared, the last plan) is the singer's:
//       "AirPods" for Beats' Bluetooth route check (none: the track's own)
// In node (earcases.mjs voice 'saw'): render() below makes the same sound sample by sample — the browser-like voice.

// A plan's notes as the singer sings them, from the phrase's notes (ns: [{t, d, midi, shift}], song seconds,
// then any `extra` notes) at tempo factor f: [{ i (the note's index in the phrase), s, e (seconds from note 0's
// start as the singer starts it), m (midi sung, before drift / vib / scoop), re (a false start's restart: s it
// came after) }], in time order.
function segments(P, ns, f = 1) {
  if (!ns.length) return [];
  const T0 = ns[0].t;
  const semis = (i) => ((P.cents?.[i] || 0) + (P.all || 0)) / 100 + (P.wrong?.[i] || 0) + (P.oct || 0);
  // (written seconds from note 0's start → as sung: × f, and with a curve the line's length × (1 + x·place) added up —
  // τ + x·τ²/2W, W the written line from note 0's start to its last note's end)
  const W = Math.max(...ns.map((n) => n.t - T0 + n.d)) || 1;
  const at = (tau) => (tau + (P.curve ? (P.curve * tau * tau) / (2 * W) : 0)) * f;
  let out = ns.map((n, i) => { const j = P.jit?.[i] || 0; return { i, s: at(n.t - T0) + j, e: at(n.t - T0 + n.d) + j - 0.04, m: n.midi + (n.shift || 0) + semis(i) }; });
  for (const [k, v] of Object.entries(P.starts || {})) {
    const o = out[+k];
    if (!o || !v) continue;
    const prev = out[+k - 1], adj = prev && Math.abs(prev.e + 0.04 - o.s) < 0.01;
    o.s += v;
    if (prev && v < 0) prev.e = Math.min(prev.e, o.s - 0.04);
    else if (adj && !P.gap) prev.e = o.s - 0.04;
  }
  const dropped = new Set(P.drop || []);
  out = out.filter((o) => !dropped.has(o.i) && !(P.stop != null && o.i > P.stop) && o.e > o.s + 0.01);
  if (P.false && P.false.n > 0 && P.false.n < ns.length) {
    const pre = at(ns[P.false.n].t - T0), re = pre + (P.false.gap || 0);
    out = [...out.filter((o) => o.i < P.false.n).map((o) => ({ ...o, e: Math.min(o.e, pre - 0.04) })), ...out.map((o) => ({ ...o, s: o.s + re, e: o.e + re, re }))];
  }
  out.sort((x, y) => x.s - y.s);
  if (P.held > 0 && out.length) { const L = out[out.length - 1]; L.e = Math.min(L.e, L.s + P.held); }
  return out;
}
// The pitch offset (semitones) drift and vib add at time t (s from the first segment's start) of a sung span `tot` s long.
function bend(P, t, tot) {
  return ((P.drift ? (P.drift * Math.max(0, Math.min(1, t / (tot || 1)))) : 0) + (P.vib ? P.vib * Math.sin(2 * Math.PI * 5.5 * t) : 0)) / 100;
}
// The pitch sung at t (s from note 0's start as sung) — M: { segs (segments()), tot (the sung span) } — or null:
// silent. free: a hum before note 0 too (Beats has none).
function sungAt(P, M, t, free) {
  if (free && P.hum && t < -0.3 && t >= -0.3 - P.hum.d) return P.hum.m;
  for (const o of M.segs) if (t >= o.s && t < o.e) return o.m + bend(P, t - M.segs[0].s, M.tot) + (P.scoop && t - o.s < 0.1 ? -P.scoop / 100 : 0);
  return null;
}
const madeOf = (segs) => ({ segs, tot: segs.length ? Math.max(...segs.map((o) => o.e)) - segs[0].s : 0 });
// Talking (mode 'talk'): unpitched noise bursts, on while sin(ms / 90) > 0.2 (≈ 0.25 s of every 0.57 s), at 0.2.
const talkAt = (ms) => (Math.sin(ms / 90) > 0.2 ? 0.2 : 0);

const BODY = (segments, bend, sungAt, madeOf, talkAt) => {
  if (location.protocol === 'about:') return;
  if (!navigator.audioSession) Object.defineProperty(navigator, 'audioSession', { configurable: true, value: { type: 'auto' } });
  // (window.__sing an accessor: the last plan given is remembered for the mic track's label)
  let cur = null, lastPlan = null;
  Object.defineProperty(window, '__sing', { configurable: true, get: () => cur, set: (p) => { cur = p; if (p) lastPlan = p; } });
  window.__sung = null; // the plan as sung: { mode, plan, base (song s of note 0), f, segs } — for the probes
  let shared = null, made = null;
  const ownLabel = Object.getOwnPropertyDescriptor(MediaStreamTrack.prototype, 'label')?.get;
  const labelled = (stream) => {
    for (const tr of stream.getAudioTracks()) Object.defineProperty(tr, 'label', { configurable: true, get() { const p = cur || lastPlan; return p && p.label != null ? String(p.label) : ownLabel ? ownLabel.call(this) : ''; } });
    return stream;
  };
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
        // the plan's segments, made once an attempt (the notes don't change during one; another tempo — Beats'
        // Slower, the tempo menu — between two attempts of one plan makes them again)
        const plan = (a, z, extra) => {
          const key = `${P.mode}|${a}|${z}|${d.notes[a]?.t}|${d.notes[z - 1]?.t}`;
          if (!made || made.P !== P || made.key !== key) {
            const notes = d.notes.slice(a, Math.min(d.notes.length, z + (extra || 0)));
            const f = P.f || 1, segs = segments(P, notes, f);
            made = { P, key, ...madeOf(segs), base: d.notes[a].t };
            window.__sung = { mode: P.mode, base: made.base, f, segs: segs.map((o) => ({ ...o, w: (notes[o.i].t - notes[0].t) * f + (o.re || 0) })) };
          }
          return made;
        };
        if (P.mode === 'talk') { noise = talkAt(performance.now()); }
        else if (P.mode === 'free' && d.ear.run === 'free') {
          const t = (performance.now() - P.at) / 1000;
          const M = plan(d.ear.ph.j0, d.ear.ph.j1, P.extra);
          m = sungAt(P, M, t, true);
        } else if (P.mode === 'beats' && d.session?.kind === 'sing') {
          const [a, z] = d.ear.on && d.ear.ph ? [d.ear.ph.j0, d.ear.ph.j1] : d.take?.range || [0, d.notes.length]; // (Ear's phrase; else the take's span)
          const M = plan(a, z, 0);
          m = sungAt(P, M, d.nowT - (P.late || 0) - M.base, false);
        } else if (P.mode === 'hold' && d.ear.run === 'hold') {
          const N = d.ear.notes; const n = d.notes[N.js ? N.js[N.i] : N.targets[N.i]]; // (targets: offsets in the line since WP1; js: in the song)
          m = n.midi + (n.shift || 0) + (P.by || 0) + (P.cents || 0) / 100 + (P.vib ? P.vib * Math.sin(2 * Math.PI * 5.5 * performance.now() / 1000) / 100 : 0);
        }
        if (m === null) g.gain.setTargetAtTime(0, ac.currentTime, 0.005);
        else { osc.frequency.setValueAtTime(440 * 2 ** ((m - 69) / 12), ac.currentTime); g.gain.setTargetAtTime(P.vol ?? 0.25, ac.currentTime, 0.005); }
        ng.gain.setTargetAtTime(noise, ac.currentTime, 0.005);
      }, 5);
      shared = dest.stream;
    }
    return labelled(shared.clone());
  };
};

// ctx.addInitScript(SINGER) (an init script's content: the page gets segments(), bend(), sungAt() … as they are here)
// (sungAt calls bend by name: each a const in one scope)
const SINGER = { content: `(() => { const bend = ${bend}, sungAt = ${sungAt}, madeOf = ${madeOf}, talkAt = ${talkAt}; (${BODY})(${segments}, bend, sungAt, madeOf, talkAt); })();` };

// --- The same singer in node (earcases.mjs voice 'saw'): the browser's sound, sample by sample ------------------------
// The fake mic above, rendered: a band-limited sawtooth (polyBLEP) through Web Audio's lowpass (2500 Hz, its default
// Q 1 dB) and a gain; every 5 ms (the page's setInterval) the pitch is set (setValueAtTime: a step, no glide) and the
// gain heads for the plan's vol or 0 (setTargetAtTime, τ 5 ms: the 40 ms between segments() is silence, every note —
// a melisma's too — its own attack); no consonants, no scoop unless the plan has one, drift / vib / hum as sungAt();
// talk: the noise bursts (white, unfiltered, 0.2), on the same tick. No room noise: the browser's mic has none.
//   P: the plan; M: madeOf(segments(…)) — or null (talk only); audio: the buffer it's added into, sr; t0: the clock
//   time (s in the buffer) of the plan's t = 0 — note 0's start as sung (the singer's own clock: free, from P.at;
//   Beats, the song clock less `late`); from / to: the clock span rendered; free: a hum before note 0 (Line);
//   tick: where the 5 ms ticks fall (s, 0…0.005); rand: () → 0…1 (the talk noise; seeded in node).
function render(P, M, { audio, sr, t0 = 0, from = 0, to = audio.length / sr, free = true, tick = 0, rand = Math.random }) {
  const hz = (m) => 440 * 2 ** ((m - 69) / 12);
  // Web Audio's lowpass (the Audio EQ Cookbook, Q in dB for lowpass / highpass)
  const w = (2 * Math.PI * 2500) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * 10 ** (1 / 20)), a0 = 1 + al;
  const b0 = (1 - c) / 2 / a0, b1 = (1 - c) / a0, b2 = b0, a1 = (-2 * c) / a0, a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const kG = 1 - Math.exp(-1 / (0.005 * sr)); // (setTargetAtTime τ 5 ms, per sample)
  const vol = P.vol ?? 0.25, talking = P.mode === 'talk' || !!P.talk;
  let g = 0, gT = 0, ng = 0, ngT = 0, f = 220, ph = 0;
  const i0 = Math.max(0, Math.floor(from * sr)), i1 = Math.min(audio.length, Math.ceil(to * sr));
  let next = Math.ceil((from - tick) / 0.005) * 0.005 + tick;
  const blep = (t, dt) => (t < dt ? ((t /= dt), t + t - t * t - 1) : t > 1 - dt ? ((t = (t - 1) / dt), t * t + t + t + 1) : 0);
  for (let i = i0; i < i1; i++) {
    const T = i / sr;
    if (T >= next) {
      next += 0.005;
      const m = M ? sungAt(P, M, T - t0, free) : null;
      if (m == null) gT = 0; else { f = hz(m); gT = vol; }
      ngT = talking ? talkAt(T * 1000) : 0;
    }
    g += (gT - g) * kG; ng += (ngT - ng) * kG;
    const dt = f / sr;
    ph += dt; if (ph >= 1) ph -= 1;
    const x = 2 * ph - 1 - blep(ph, dt);
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y;
    audio[i] += g * y + (ng > 1e-6 ? ng * (rand() * 2 - 1) : 0);
  }
  return audio;
}

module.exports = { SINGER, segments, bend, sungAt, madeOf, talkAt, render };
