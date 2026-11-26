// Harp — tune strings by ear, from string lengths (Tools → Harp).
// A string's pitch is the open note × 1 / its length (the full length = the open note, F♯3 by default). A pluck is
// synthesised from its harmonics (exact multiples of the string's frequency, so two strings nearly in tune beat as real
// ones do); the pendant — a light finger resting on a string — leaves only the harmonics with a node where it rests
// (at ½ the octave rings, at ⅓ the twelfth). Numbers (lengths, Hz, notes, beats) are hidden until 123.

const $ = (id) => document.getElementById(id);
const stage = $("stage"), cv = $("cv"), cx = cv.getContext("2d");
const KEY = "resonate.harp";
const FOOT = 84;                   // px at the stage's foot for ▶ Start / ■
const LMIN = 0.2;                  // the shortest a string can be (of the full length)
const PLUCK_AT = 0.2;              // where a finger plucks (of the length): nearer the middle, rounder
const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const noteName = (m) => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const DEFAULT = () => ({ base: 54, strings: [{ L: 1 }, { L: 1 }], snap: "strong", info: false, notes: false, pendant: null });

// ---------- state ----------
let S = load();
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (s && Array.isArray(s.strings) && s.strings.length) {
      const d = DEFAULT();
      return { ...d, ...s, strings: s.strings.map((x) => ({ L: clamp(+x.L || 1, LMIN, 1), ...(typeof x.fixed === "string" ? { fixed: x.fixed } : {}) })), pendant: s.pendant && s.pendant.s < s.strings.length ? s.pendant : null };
    }
  } catch {}
  return DEFAULT();
}
let saveT = 0;
function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} }, 200); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
const freqOf = (i) => hz(S.base) / S.strings[i].L;

// ---------- ♪ Notes: the pentatonic's notes found by length ----------
// The pentatonic of five pure fifths from the open note (frequency ×1, 9/8, 81/64, 3/2, 27/16), in every octave a
// string can reach. A string within 3¢ of one (not fixed) shows a glowing ✦ above it; a tap names it and fixes it.
const PENTA = [1, 9 / 8, 81 / 64, 3 / 2, 27 / 16];
const CANON = [1, 2, 4].flatMap((o) => PENTA.map((r) => r * o)).filter((r) => r <= 1 / LMIN + 1e-9);
function noteOf(L) {
  const r = 1 / L;
  for (const c of CANON) if (Math.abs(1200 * Math.log2(r / c)) < 3) return noteName(Math.round(S.base + 12 * Math.log2(c)));
  return null;
}
const fixedOn = (i) => S.notes && !!S.strings[i]?.fixed;
const glowing = (i) => S.notes && !S.strings[i].fixed && !drags.has("b" + i) && !!noteOf(S.strings[i].L);
function tagPt(i) { const e = pt(i, S.strings[i].L); return G.land ? { x: e.x, y: e.y - 22 } : { x: e.x, y: e.y - 24 }; }

// ---------- geometry ----------
let G = null;
function layout() {
  const r = stage.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // the foot (FOOT px) holds ▶ Start / ■, centred under the strings and their grips
  const W = r.width, H0 = r.height, H = H0 - FOOT, land = W >= H, n = S.strings.length, m = 28;
  if (land) {
    const nut = m + 24, end = W - m - 64;             // the pendant's tray on the right
    const span = Math.min((H - 2 * m) / n, 110), top = (H - span * n) / 2;
    G = { W, H: H0, land, nut, Lpx: end - nut, span, across: (i) => top + (n - 1 - i + 0.5) * span, dock: { x: W - m - 22, y: m + 22 } };
  } else {
    const nut = H - m - 24, end = m + 70;               // the tray at the top
    const span = Math.min((W - 2 * m) / n, 90), left = (W - span * n) / 2;
    G = { W, H: H0, land, nut, Lpx: nut - end, span, across: (i) => left + (i + 0.5) * span, dock: { x: W - m - 18, y: m + 18 } };
  }
  draw();
}
// a point on string i at a (0 = the nut … 1 = the full length)
function pt(i, a) {
  const c = G.across(i);
  return G.land ? { x: G.nut + a * G.Lpx, y: c } : { x: c, y: G.nut - a * G.Lpx };
}
const alongOf = (x, y) => (G.land ? (x - G.nut) / G.Lpx : (G.nut - y) / G.Lpx);
const acrossOf = (x, y) => (G.land ? y : x);

// ---------- snapping ----------
const RATIOS = [1 / 3, 1 / 2, 2 / 3, 3 / 4, 4 / 5, 5 / 6, 1, 6 / 5, 5 / 4, 4 / 3, 3 / 2, 2, 3];
const NODES = [];
for (let q = 2; q <= 6; q++) for (let p = 1; p < q; p++) if (gcd(p, q) === 1) NODES.push(p / q);
function gcd(a, b) { return b ? gcd(b, a % b) : a; }
// pull v towards the nearest target (relative distance for lengths, absolute for fractions)
function pull(v, targets, rel) {
  if (S.snap === "off") return v;
  let best = null, bd = Infinity;
  for (const t of targets) { const d = Math.abs(v - t) / (rel ? t : 1); if (d < bd) { bd = d; best = t; } }
  if (best == null) return v;
  if (S.snap === "strong") return bd < (rel ? 0.018 : 0.025) ? best : v;
  if (bd < (rel ? 0.0025 : 0.004)) return best;
  return bd < (rel ? 0.01 : 0.014) ? best + (v - best) * 0.35 : v;  // gentle: drawn in, not stuck
}
function snapLength(i, L) {
  const t = [1];
  S.strings.forEach((s, j) => { if (j !== i) for (const r of RATIOS) { const v = s.L * r; if (v >= LMIN && v <= 1) t.push(v); } });
  return clamp(pull(L, t, true), LMIN, 1);
}

// ---------- sound ----------
let ac = null, master = null;
const voices = new Map();        // string → { src, g }
const cache = new Map();         // "f|x" → AudioBuffer
const plucks = [];               // the last plucks (debug, beats)
function makeCtx() {
  if (!ac) {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    // a soft limiter, not a compressor (one pumped: a pluck's tail swelled back after its attack)
    const lim = ac.createWaveShaper(), curve = new Float32Array(1025);
    for (let k = 0; k < 1025; k++) { const x = k / 512 - 1, a = Math.abs(x); curve[k] = Math.sign(x) * (a < 0.7 ? a : 0.7 + 0.3 * Math.tanh((a - 0.7) / 0.3)); }
    lim.curve = curve;
    master = ac.createGain(); master.gain.value = 0.6;
    master.connect(lim).connect(ac.destination);
    ac.addEventListener("statechange", () => { if (ac?.state === "running") wake(); });
  }
  return ac;
}
function audio() {
  makeCtx();
  try { if (navigator.audioSession && navigator.audioSession.type !== "playback") navigator.audioSession.type = "playback"; } catch {}
  if (ac.state !== "running") ac.resume().catch(() => {});
  return ac;
}
// the harmonics a pluck gives: amplitude of harmonic n (plucked at PLUCK_AT; a touch at x keeps those with a node there)
function partials(f, x, sr) {
  const out = [], top = Math.min(sr * 0.45, 10000);
  for (let n = 1; n * f < top && n <= 64; n++) {
    let a = Math.sin(n * Math.PI * PLUCK_AT) / n ** 1.6;
    if (x != null) a *= Math.exp(-60 * Math.sin(n * Math.PI * x) ** 2);
    if (Math.abs(a) > 1e-4) out.push([n, a]);
  }
  return out;
}
const ringOf = (f) => clamp(2.5 + 500 / f, 2, 7);   // s: the fundamental's decay
function buffer(f, x) {
  const key = f.toFixed(3) + "|" + (x == null ? "-" : x.toFixed(4));
  if (cache.has(key)) return cache.get(key);
  // a long, even ring: the fundamental decays slowly, the upper harmonics a little faster (not a twang that
  // drops away), and the buffer fades out over its last third — never an abrupt stop
  const tau1 = ringOf(f), sr = ac.sampleRate, dur = Math.min(8, 2 * tau1), len = Math.round(dur * sr);
  const buf = ac.createBuffer(1, len, sr), d = buf.getChannelData(0);
  let ref = 0;
  for (const [, a] of partials(f, null, sr)) ref += Math.abs(a);
  const gain = (x == null ? 0.5 : 0.9) / ref;
  for (const [n, a0] of partials(f, x, sr)) {
    const tau = tau1 / (1 + 0.15 * (n - 1)), r = Math.exp(-1 / (tau * sr)), w = (2 * Math.PI * n * f) / sr;
    const A = a0 * gain, c = 2 * r * Math.cos(w), r2 = r * r;
    const kmax = Math.min(len, Math.ceil(tau * sr * Math.log(Math.abs(A) / 1e-6 + 1)));
    let y2 = 0, y1 = A * r * Math.sin(w);
    d[1] += y1;
    for (let k = 2; k < kmax; k++) { const y = c * y1 - r2 * y2; d[k] += y; y2 = y1; y1 = y; }
  }
  const att = Math.round(0.003 * sr);
  for (let k = 0; k < att && k < len; k++) d[k] *= k / att;                 // no click
  const f0 = Math.floor(len * 0.65);
  for (let k = f0; k < len; k++) d[k] *= 0.5 + 0.5 * Math.cos((Math.PI * (k - f0)) / (len - f0));
  if (cache.size > 16) cache.delete(cache.keys().next().value);
  cache.set(key, buf);
  return buf;
}
function pluck(i, { level = 1, log = true } = {}) {
  const a = audio(), f = freqOf(i);
  const x = S.pendant && S.pendant.s === i ? S.pendant.a / S.strings[i].L : null;
  const old = voices.get(i);
  if (old) { try { old.g.gain.setTargetAtTime(0, a.currentTime, 0.015); old.src.stop(a.currentTime + 0.12); } catch {} }
  const src = a.createBufferSource(), g = a.createGain();
  g.gain.value = level;
  src.buffer = buffer(f, x);
  src.connect(g).connect(master);
  src.start(a.currentTime + 0.003);
  // iOS starts a page's sound only at a finger's lift: a pluck made before that waits for it (unlock), and is dropped
  // if the sound still hasn't started 1.5 s on — never played late in a heap
  if (a.state !== "running") setTimeout(() => { if (ac && ac.state !== "running") { try { src.stop(); } catch {} } }, 1500);
  voices.set(i, { src, g });
  src.onended = () => { for (const [k, v] of voices) if (v.src === src) voices.delete(k); };
  const kept = partials(f, x, a.sampleRate).filter(([n, v]) => n <= 16 && Math.abs(v) > 0.02 * Math.abs(Math.sin(n * Math.PI * PLUCK_AT) / n ** 1.6)).map(([n]) => n);
  if (log) plucks.push({ i, f, x, kept, at: performance.now() });
  if (plucks.length > 24) plucks.shift();
  // the string's motion: its first harmonics' shapes, slowed down
  const shape = partials(f, x, 48000).filter(([n]) => n <= 8);
  const peak = shape.reduce((s, [, v]) => s + Math.abs(v), 0) || 1;
  vib[i] = { t0: performance.now(), shape: shape.map(([n, v]) => [n, v / peak]), tau: Math.min(2.4, ringOf(f) * 0.5) };
  showBeats();
  tick();
}

// ---------- ■: every string damped at once, with the clink of hands closing on them ----------
let clinks = 0;
function stopAll() {
  const a = audio(), t = a.currentTime;
  for (const [i, v] of voices) { try { v.g.gain.setTargetAtTime(0, t + 0.01, 0.025); v.src.stop(t + 0.3); } catch {} voices.delete(i); }
  // the clink: a few short metallic partials and a tick of noise
  const out = a.createGain(); out.gain.value = 0.22; out.connect(master);
  for (const [fq, tc, lv] of [[1870, 0.05, 1], [2960, 0.035, 0.7], [4410, 0.025, 0.5], [6230, 0.018, 0.3]]) {
    const o = a.createOscillator(), g = a.createGain();
    o.frequency.value = fq; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(lv, t + 0.002); g.gain.setTargetAtTime(0, t + 0.002, tc);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.4);
  }
  const nb = a.createBuffer(1, Math.round(a.sampleRate * 0.02), a.sampleRate), nd = nb.getChannelData(0);
  for (let k = 0; k < nd.length; k++) nd[k] = (Math.random() * 2 - 1) * (1 - k / nd.length) ** 2 * 0.6;
  const ns = a.createBufferSource(), bp = a.createBiquadFilter();
  bp.type = "bandpass"; bp.frequency.value = 3500; bp.Q.value = 1.2;
  ns.buffer = nb; ns.connect(bp).connect(out); ns.start(t);
  clinks++;
  const now = performance.now();
  vib.forEach((v) => { if (v) { v.t0 = now - 0.0001; v.tau = 0.06; } });
  tick();
}

// ---------- asleep until the sound can start ----------
// On load and whenever the page comes back, try to start the sound with no tap (most browsers allow it once the
// site has been used); only where that fails (iOS: a page's sound starts only from a tap) the harp stays grey with
// ▶ Start over it. Its tap wakes it: the colour comes back and the strings ring softly, one after another.
let locked = true, strumOnWake = false, probing = 0;
function setLocked(on) {
  locked = on;
  const lk = $("lock");
  if (on) { stage.dataset.locked = "1"; lk.hidden = false; goButton(); requestAnimationFrame(() => lk.classList.remove("out")); }
  else wake();
}
function wake() {
  if (!stage.dataset.locked && $("lock").hidden) return;
  locked = false;
  delete stage.dataset.locked;
  goButton();
  const lk = $("lock");
  if (!lk.hidden) { lk.classList.add("out"); setTimeout(() => { if (!locked) lk.hidden = true; }, 450); }
  const strum = strumOnWake; strumOnWake = false;
  const now = performance.now();
  S.strings.forEach((s, i) => {
    setTimeout(() => {
      if (strum && ac?.state === "running") pluck(i, { level: 0.3, log: false });
      else vib[i] = { t0: performance.now(), shape: [[1, 0.6], [2, 0.25]], tau: 0.35 };
      tick();
    }, 120 + i * 70);
  });
  void now;
}
async function probe() {
  const my = ++probing;
  makeCtx();
  if (ac.state !== "running") {
    try { ac.resume().catch(() => {}); } catch {}
    await new Promise((r) => setTimeout(r, 350));
  }
  if (my !== probing) return;
  if (ac?.state === "running") wake(); else setLocked(true);
}
// one button at the foot: ▶ Start while the sound is locked, ■ (stop every string) once awake
function goButton() { const b = $("go"); b.dataset.mode = locked ? "start" : "stop"; b.textContent = locked ? "▶ Start" : "■"; b.setAttribute("aria-label", locked ? "Start the harp" : "Stop all strings"); }
$("go").addEventListener("click", () => { if (locked) { strumOnWake = true; audio(); } else stopAll(); });

// ---------- beats (123): the last two strings plucked ----------
function showBeats() {
  const el = $("beats");
  if (!S.info || plucks.length < 2) { el.textContent = ""; return; }
  const p = plucks[plucks.length - 1], q = [...plucks].reverse().find((v) => v.i !== p.i);
  if (!q || p.i < 0 || q.i < 0 || p.i >= S.strings.length || q.i >= S.strings.length) { el.textContent = ""; return; }
  const f1 = freqOf(p.i), f2 = freqOf(q.i);
  let best = null;
  for (let m = 1; m <= 8; m++) for (let n = 1; n <= 8; n++) {
    const d = Math.abs(m * f1 - n * f2);
    if (d < 12 && (!best || m + n < best.m + best.n || (m + n === best.m + best.n && d < best.d))) best = { m, n, d };
  }
  el.textContent = !best ? "" : best.d < 0.05 ? `strings ${q.i + 1} & ${p.i + 1}: no beats` : `strings ${q.i + 1} & ${p.i + 1}: ${best.d.toFixed(1)} beats/s`;
}

// ---------- drawing ----------
const vib = [];
let raf = 0;
function tick() { if (!raf) raf = requestAnimationFrame(frame); }
function frame() {
  raf = 0;
  draw();
  const now = performance.now();
  if (vib.some((v) => v && now - v.t0 < v.tau * 4000) || drags.size || S.strings.some((_, i) => glowing(i))) tick();
}
function frac(v) {
  for (let q = 1; q <= 256; q++) { const p = Math.round(v * q); if (p && Math.abs(v - p / q) < 2e-6 * v) return q === 1 ? `${p}` : `${p}/${q}`; }
  return v.toFixed(4);
}
function draw() {
  if (!G) return;
  const { W, H } = G, now = performance.now();
  cx.clearRect(0, 0, W, H);
  const n = S.strings.length;
  // the nut
  const a0 = pt(0, 0), a1 = pt(n - 1, 0);
  cx.strokeStyle = "#8a6a4a"; cx.lineWidth = 8; cx.lineCap = "round";
  cx.beginPath();
  if (G.land) { cx.moveTo(a0.x, a0.y + G.span * 0.4); cx.lineTo(a1.x, a1.y - G.span * 0.4); }
  else { cx.moveTo(a0.x - G.span * 0.4, a0.y); cx.lineTo(a1.x + G.span * 0.4, a1.y); }
  cx.stroke();
  // the grips (drag to rearrange)
  S.strings.forEach((_, i) => {
    const q = gripOf(i), held = drags.get("g") === i;
    cx.fillStyle = held ? "rgba(197,140,255,0.9)" : "rgba(255,255,255,0.28)";
    for (const o of [-4, 0, 4]) {
      cx.beginPath();
      if (G.land) cx.fillRect(q.x - 7, q.y + o - 1, 14, 2); else cx.fillRect(q.x + o - 1, q.y - 7, 2, 14);
      cx.fill();
    }
  });
  S.strings.forEach((s, i) => {
    // the rest of the full length, faint
    const e = pt(i, s.L), f = pt(i, 1);
    cx.strokeStyle = "rgba(255,255,255,0.08)"; cx.lineWidth = 1; cx.setLineDash([3, 5]);
    cx.beginPath(); cx.moveTo(e.x, e.y); cx.lineTo(f.x, f.y); cx.stroke(); cx.setLineDash([]);
    // the string, moving while it rings
    const v = vib[i], t = v ? (now - v.t0) / 1000 : 0, amp = v ? Math.min(G.span * 0.22, 14) * Math.exp(-t / v.tau) : 0;
    cx.strokeStyle = drags.get("g") === i && gripOff ? "rgba(255,110,140,0.55)" : "#e9c46a"; cx.lineWidth = 1.2 + 1.4 * s.L;
    cx.beginPath();
    for (let k = 0; k <= 60; k++) {
      const u = k / 60, p = pt(i, u * s.L);
      let dsp = 0;
      if (amp > 0.2) for (const [h, w] of v.shape) dsp += w * Math.sin(h * Math.PI * u) * Math.cos(2 * Math.PI * h * 2.5 * t);
      const X = G.land ? p.x : p.x + amp * dsp, Y = G.land ? p.y + amp * dsp : p.y;
      k ? cx.lineTo(X, Y) : cx.moveTo(X, Y);
    }
    cx.stroke();
    // the nodes (123)
    if (S.info) {
      cx.fillStyle = "rgba(124,196,255,0.55)";
      for (const nd of [1 / 2, 1 / 3, 2 / 3, 1 / 4, 3 / 4]) { const p = pt(i, nd * s.L); cx.beginPath(); cx.arc(p.x, p.y, nd === 0.5 ? 3 : 2, 0, 7); cx.fill(); }
    }
    // the bridge (drag it; a fixed string's is grey and stays)
    cx.fillStyle = fixedOn(i) ? "#6b6488" : drags.has("b" + i) ? "#c58cff" : "#a64fff";
    cx.strokeStyle = "rgba(255,255,255,0.7)"; cx.lineWidth = 1.5;
    cx.beginPath(); cx.arc(e.x, e.y, 9, 0, 7); cx.fill(); cx.stroke();
    if (fixedOn(i)) {
      const q = tagPt(i), t = s.fixed;
      cx.font = "600 13px system-ui, -apple-system, sans-serif"; const w = cx.measureText(t).width + 16;
      cx.fillStyle = "#e9c46a"; cx.beginPath(); cx.roundRect ? cx.roundRect(q.x - w / 2, q.y - 11, w, 22, 11) : cx.rect(q.x - w / 2, q.y - 11, w, 22); cx.fill();
      cx.fillStyle = "#1b1838"; cx.textAlign = "center"; cx.textBaseline = "middle"; cx.fillText(t, q.x, q.y + 0.5); cx.textBaseline = "alphabetic";
    } else if (glowing(i)) {
      const q = tagPt(i), ph = (now % 1600) / 1600, pulse = 0.5 + 0.5 * Math.sin(ph * 2 * Math.PI);
      const gr = cx.createRadialGradient(q.x, q.y, 0, q.x, q.y, 18 + 4 * pulse);
      gr.addColorStop(0, `rgba(255,220,120,${0.55 + 0.35 * pulse})`); gr.addColorStop(1, "rgba(255,220,120,0)");
      cx.fillStyle = gr; cx.beginPath(); cx.arc(q.x, q.y, 22 + 4 * pulse, 0, 7); cx.fill();
      cx.fillStyle = "#fff6d8"; cx.font = "16px system-ui, sans-serif"; cx.textAlign = "center"; cx.textBaseline = "middle"; cx.fillText("✦", q.x, q.y + 1); cx.textBaseline = "alphabetic";
    }
    if (S.info) {
      const fq = freqOf(i), m = 69 + 12 * Math.log2(fq / 440), mr = Math.round(m), cents = Math.round((m - mr) * 100);
      const label = `${frac(s.L)} · ${fq.toFixed(1)} Hz · ${noteName(mr)}${cents ? (cents > 0 ? " +" : " −") + Math.abs(cents) + "¢" : ""}`;
      cx.fillStyle = "rgba(232,232,240,0.75)"; cx.font = "11px ui-monospace, SF Mono, monospace";
      const p = pt(i, 0);
      if (G.land) { cx.textAlign = "left"; cx.fillText(label, p.x + 10, p.y - 7); }
      else { cx.save(); cx.translate(p.x - 6, p.y - 10); cx.rotate(-Math.PI / 2); cx.textAlign = "left"; cx.fillText(label, 0, 0); cx.restore(); }
    }
  });
  // the pendant's tray, and the pendant
  const d = G.dock;
  cx.strokeStyle = "rgba(124,196,255,0.35)"; cx.setLineDash([3, 4]); cx.lineWidth = 1.5;
  cx.beginPath(); cx.arc(d.x, d.y, 17, 0, 7); cx.stroke(); cx.setLineDash([]);
  const pp = pendantPos();
  cx.fillStyle = "rgba(124,196,255,0.85)"; cx.strokeStyle = "#fff"; cx.lineWidth = 2;
  cx.beginPath(); cx.arc(pp.x, pp.y, 11, 0, 7); cx.fill(); cx.stroke();
  if (S.info && S.pendant) {
    cx.fillStyle = "#bfe3ff"; cx.font = "11px ui-monospace, SF Mono, monospace"; cx.textAlign = "center";
    cx.fillText(frac(S.pendant.a / S.strings[S.pendant.s].L), pp.x, pp.y - 16);
  }
}
let pendDrag = null;               // { x, y } while dragged off a string
function pendantPos() {
  if (pendDrag && !pendDrag.on) return pendDrag;
  if (S.pendant) return pt(S.pendant.s, S.pendant.a);
  return G.dock;
}

// ---------- gestures ----------
const drags = new Map();           // pointerId → what it holds
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const where = (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
function stringAt(p) {
  let best = -1, bd = Infinity;
  S.strings.forEach((s, i) => {
    const a = alongOf(p.x, p.y), d = Math.abs(acrossOf(p.x, p.y) - G.across(i));
    if (a >= -0.02 && a <= s.L + 0.02 && d < G.span * 0.5 && d < bd) { bd = d; best = i; }
  });
  return best;
}
function onString(p) {             // where the pendant would rest
  for (let i = 0; i < S.strings.length; i++) {
    const L = S.strings[i].L, a = alongOf(p.x, p.y);
    if (Math.abs(acrossOf(p.x, p.y) - G.across(i)) < Math.min(26, G.span * 0.45) && a > 0.02 && a < L - 0.02) {
      return { s: i, a: clamp(pull(a / L, NODES, false), 0.02, 0.98) * L };
    }
  }
  return null;
}
stage.addEventListener("pointerdown", (e) => {
  if (e.target.closest?.("button") || locked) return;   // ✕ remove, ▶ Start / ■: their own taps
  hideRemove();
  audio();
  stage.setPointerCapture(e.pointerId);
  const p = where(e);
  for (let i = 0; i < S.strings.length; i++) {
    if (glowing(i) && dist(p, tagPt(i)) < 24) { S.strings[i].fixed = noteOf(S.strings[i].L); save(); tick(); return; }
  }
  if (dist(p, pendantPos()) < 26) { drags.set(e.pointerId, { k: "pendant" }); pendDrag = { ...p }; tick(); return; }
  for (let i = 0; i < S.strings.length; i++) {
    if (!fixedOn(i) && dist(p, pt(i, S.strings[i].L)) < 26) { drags.set(e.pointerId, { k: "bridge", i, id: "b" + i }); drags.set("b" + i, true); tick(); return; }
  }
  for (let i = 0; i < S.strings.length; i++) {
    if (dist(p, gripOf(i)) < 22) { drags.set(e.pointerId, { k: "grip", i }); drags.set("g", i); tick(); return; }
  }
  const i = stringAt(p), g = { k: "strum", c: acrossOf(p.x, p.y), last: i, start: p, moved: false, lp: 0 };
  if (i >= 0) {
    pluck(i);
    g.lp = setTimeout(() => { if (!g.moved) showRemove(i); }, 600);
  }
  drags.set(e.pointerId, g);
});
stage.addEventListener("pointermove", (e) => {
  const g = drags.get(e.pointerId);
  if (!g) return;
  const p = where(e);
  if (g.k === "pendant") {
    const on = onString(p);
    pendDrag = on ? { on, ...pt(on.s, on.a) } : { ...p };
    if (on) S.pendant = on;
    tick();
  } else if (g.k === "grip") {
    const c = acrossOf(p.x, p.y);
    let j = g.i, bd = Infinity;
    S.strings.forEach((_, k) => { const d = Math.abs(G.across(k) - c); if (d < bd) { bd = d; j = k; } });
    if (j !== g.i) { moveString(g.i, j); g.i = j; drags.set("g", j); }
    gripAt = c;
    gripOff = S.strings.length > 1 && (p.x < 8 || p.y < 8 || p.x > G.W - 8 || p.y > G.H - 8) ? p : null;   // dragged off the harp
    tick();
  } else if (g.k === "bridge") {
    S.strings[g.i].L = snapLength(g.i, clamp(alongOf(p.x, p.y), LMIN, 1));
    if (S.pendant?.s === g.i && S.pendant.a > S.strings[g.i].L * 0.98) S.pendant.a = S.strings[g.i].L * 0.98;
    save(); tick();
  } else {
    if (dist(p, g.start) > 8) { g.moved = true; clearTimeout(g.lp); }
    const c = acrossOf(p.x, p.y), a = alongOf(p.x, p.y);
    const lo = Math.min(g.c, c), hi = Math.max(g.c, c);
    const crossed = S.strings.map((s, i) => i).filter((i) => i !== g.last && G.across(i) > lo && G.across(i) <= hi && a >= 0 && a <= S.strings[i].L + 0.02);
    crossed.sort((i, j) => (c > g.c ? G.across(i) - G.across(j) : G.across(j) - G.across(i)));
    for (const i of crossed) { pluck(i); g.last = i; }
    if (g.last >= 0 && Math.abs(c - G.across(g.last)) > G.span * 0.45) g.last = -1;
    g.c = c;
  }
});
function end(e) {
  const g = drags.get(e.pointerId);
  if (!g) return;
  drags.delete(e.pointerId);
  if (g.k === "pendant") {
    const on = pendDrag?.on || (pendDrag && onString(pendDrag));
    S.pendant = on ? { s: on.s, a: on.a } : null;
    pendDrag = null;
    save();
  } else if (g.k === "bridge") drags.delete(g.id);
  else if (g.k === "grip") { drags.delete("g"); gripAt = null; if (gripOff) removeString(g.i); gripOff = null; save(); }
  else clearTimeout(g.lp);
  tick();
}
stage.addEventListener("pointerup", end);
// the first tap's lift (or any tap on the page) starts the sound
const unlock = () => { if (ac && ac.state !== "running") ac.resume().catch(() => {}); };
for (const t of ["pointerup", "touchend", "click"]) document.addEventListener(t, unlock, true);
stage.addEventListener("pointercancel", end);
stage.addEventListener("contextmenu", (e) => e.preventDefault());

// ---------- rearranging: a grip at each string's nut end ----------
let gripAt = null;                 // the dragged grip's across position (it follows the finger)
let gripOff = null;                // the finger, while a grip is dragged off the harp (let go: the string goes)
function gripOf(i) {
  if (drags.get("g") === i && gripOff) return gripOff;
  const c = drags.get("g") === i && gripAt != null ? gripAt : G.across(i);
  return G.land ? { x: G.nut - 26, y: c } : { x: c, y: G.nut + 26 };
}
function moveString(from, to) {
  const ord = S.strings.map((_, k) => k);
  ord.splice(to, 0, ord.splice(from, 1)[0]);            // ord[new] = old
  const inv = [];
  ord.forEach((o, n) => (inv[o] = n));
  S.strings = ord.map((o) => S.strings[o]);
  const v2 = ord.map((o) => vib[o]);
  vib.length = 0; vib.push(...v2);
  const nv = [...voices].map(([k, v]) => [inv[k], v]);
  voices.clear(); for (const [k, v] of nv) voices.set(k, v);
  if (S.pendant) S.pendant.s = inv[S.pendant.s];
  for (const p of plucks) if (inv[p.i] != null) p.i = inv[p.i];
  save();
}

// ---------- removing a string (long press) ----------
let removing = -1;
function showRemove(i) {
  if (S.strings.length < 2) return;
  removing = i;
  const b = $("remove"), p = pt(i, Math.min(0.15, S.strings[i].L / 2));
  b.style.left = (G.land ? p.x + 40 : p.x) + "px";
  b.style.top = (G.land ? p.y - 22 : p.y - 40) + "px";
  b.style.display = "block";
}
function hideRemove() { $("remove").style.display = "none"; removing = -1; }
$("remove").addEventListener("click", () => { const i = removing; hideRemove(); removeString(i); });
function removeString(i) {
  if (i < 0 || S.strings.length < 2) return;
  stopVoice(i);
  const nv = [...voices].filter(([k]) => k !== i).map(([k, v]) => [k > i ? k - 1 : k, v]);
  voices.clear(); for (const [k, v] of nv) voices.set(k, v);
  S.strings.splice(i, 1);
  vib.splice(i, 1);
  if (S.pendant) { if (S.pendant.s === i) S.pendant = null; else if (S.pendant.s > i) S.pendant.s--; }
  for (const p of plucks) if (p.i > i) p.i--; else if (p.i === i) p.i = -1;
  save(); controls(); layout();
}
function stopVoice(i) {
  const v = voices.get(i);
  if (v && ac) { try { v.g.gain.setTargetAtTime(0, ac.currentTime, 0.02); v.src.stop(ac.currentTime + 0.15); } catch {} }
  voices.delete(i);
}

// ---------- controls ----------
const noteSel = $("note");
for (let m = 36; m <= 72; m++) noteSel.add(new Option(noteName(m), m));
function controls() {
  noteSel.value = S.base;
  $("snap").textContent = "Snap: " + S.snap;
  $("info").setAttribute("aria-pressed", S.info);
  $("notes").setAttribute("aria-pressed", !!S.notes);
  $("add").disabled = S.strings.length >= 12;
  showBeats();
}
noteSel.addEventListener("change", () => { S.base = +noteSel.value; noteSel.blur(); save(); draw(); showBeats(); });
$("preset").addEventListener("change", (e) => {
  const v = e.target.value;
  e.target.value = ""; e.target.blur();
  for (const i of [...voices.keys()]) stopVoice(i);
  vib.length = 0;
  if (v === "reset") S = { ...DEFAULT(), snap: S.snap, info: S.info };
  // five pure fifths from the open string, each folded back into its octave
  else if (v === "penta") S.strings = [1, 8 / 9, 64 / 81, 2 / 3, 16 / 27].map((L) => ({ L })), S.pendant = null;
  save(); controls(); layout();
});
$("add").addEventListener("click", () => { if (S.strings.length < 12) { S.strings.push({ L: 1 }); save(); controls(); layout(); } });
$("snap").addEventListener("click", () => { S.snap = { strong: "gentle", gentle: "off", off: "strong" }[S.snap]; save(); controls(); });
$("info").addEventListener("click", () => { S.info = !S.info; save(); controls(); draw(); });
$("notes").addEventListener("click", () => { S.notes = !S.notes; save(); controls(); tick(); });

// ---------- sleep ----------
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) { probe(); return; }
  if (!ac) return;
  for (const i of [...voices.keys()]) stopVoice(i);
  ac.suspend().catch(() => {});
  try { if (navigator.audioSession) navigator.audioSession.type = "auto"; } catch {}
});
addEventListener("pagehide", () => { clearTimeout(saveT); try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} try { ac?.close(); } catch {} ac = null; cache.clear(); try { if (navigator.audioSession) navigator.audioSession.type = "auto"; } catch {} });

addEventListener("pageshow", (e) => { if (e.persisted) probe(); });
new ResizeObserver(layout).observe(stage);
controls();
layout();
probe();

window.resonateDebug = () => ({
  state: JSON.parse(JSON.stringify(S)), freqs: S.strings.map((_, i) => freqOf(i)), plucks: plucks.map((p) => ({ ...p })),
  land: G?.land, span: G?.span, beats: $("beats").textContent, pt: (i, a) => pt(i, a), dock: G && { ...G.dock },
  audio: ac?.state || null, frac, clinks, locked, glows: S.strings.map((_, i) => glowing(i)), tag: (i) => tagPt(i), fixed: S.strings.map((x) => x.fixed || null), lockShown: !$("lock").hidden && !$("lock").classList.contains("out"), grip: (i) => gripOf(i),
  ending: (f) => { makeCtx(); const d = buffer(f, null).getChannelData(0), n = d.length, w = Math.round(n * 0.01); let pk = 0, e = 0; for (let k = 0; k < n; k++) pk = Math.max(pk, Math.abs(d[k])); for (let k = n - w; k < n; k++) e = Math.max(e, Math.abs(d[k])); return { dur: n / ac.sampleRate, peak: pk, end: e / pk }; }, voices: voices.size, partials: (f, x) => partials(f, x, 48000),
});
