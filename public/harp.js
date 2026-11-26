// Harp — tune strings by ear, from string lengths (Tools → Harp).
// A string's pitch is the open note × 1 / its length (the full length = the open note, F♯3 by default). A pluck is
// synthesised from its harmonics (exact multiples of the string's frequency, so two strings nearly in tune beat as real
// ones do); the pendant — a light finger resting on a string — leaves only the harmonics with a node where it rests
// (at ½ the octave rings, at ⅓ the twelfth). Numbers (lengths, Hz, notes, beats) are hidden until 👁.

const $ = (id) => document.getElementById(id);
const stage = $("stage"), cv = $("cv"), cx = cv.getContext("2d");
const KEY = "resonate.harp";
const LMIN = 0.2;                  // the shortest a string can be (of the full length)
const PLUCK_AT = 0.13;             // where a finger plucks (of the length)
const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const noteName = (m) => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const DEFAULT = () => ({ base: 54, strings: [{ L: 1 }, { L: 1 }], snap: "strong", info: false, pendant: null });

// ---------- state ----------
let S = load();
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (s && Array.isArray(s.strings) && s.strings.length) {
      const d = DEFAULT();
      return { ...d, ...s, strings: s.strings.map((x) => ({ L: clamp(+x.L || 1, LMIN, 1) })), pendant: s.pendant && s.pendant.s < s.strings.length ? s.pendant : null };
    }
  } catch {}
  return DEFAULT();
}
let saveT = 0;
function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} }, 200); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
const freqOf = (i) => hz(S.base) / S.strings[i].L;

// ---------- geometry ----------
let G = null;
function layout() {
  const r = stage.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = r.width, H = r.height, land = W >= H, n = S.strings.length, m = 28;
  if (land) {
    const nut = m + 24, end = W - m - 64;             // the pendant's tray on the right
    const span = Math.min((H - 2 * m) / n, 110), top = (H - span * n) / 2;
    G = { W, H, land, nut, Lpx: end - nut, span, across: (i) => top + (n - 1 - i + 0.5) * span, dock: { x: W - m - 22, y: m + 22 } };
  } else {
    const nut = H - m - 24, end = m + 70;               // the tray at the top
    const span = Math.min((W - 2 * m) / n, 90), left = (W - span * n) / 2;
    G = { W, H, land, nut, Lpx: nut - end, span, across: (i) => left + (i + 0.5) * span, dock: { x: W - m - 18, y: m + 18 } };
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
function audio() {
  if (!ac) {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -10; comp.ratio.value = 6;
    master = ac.createGain(); master.gain.value = 0.7;
    master.connect(comp).connect(ac.destination);
  }
  try { if (navigator.audioSession && navigator.audioSession.type !== "playback") navigator.audioSession.type = "playback"; } catch {}
  if (ac.state !== "running") ac.resume().catch(() => {});
  return ac;
}
// the harmonics a pluck gives: amplitude of harmonic n (plucked at PLUCK_AT; a touch at x keeps those with a node there)
function partials(f, x, sr) {
  const out = [], top = Math.min(sr * 0.45, 10000);
  for (let n = 1; n * f < top && n <= 64; n++) {
    let a = Math.sin(n * Math.PI * PLUCK_AT) / n ** 1.3;
    if (x != null) a *= Math.exp(-60 * Math.sin(n * Math.PI * x) ** 2);
    if (Math.abs(a) > 1e-4) out.push([n, a]);
  }
  return out;
}
function buffer(f, x) {
  const key = f.toFixed(3) + "|" + (x == null ? "-" : x.toFixed(4));
  if (cache.has(key)) return cache.get(key);
  const sr = ac.sampleRate, dur = Math.min(6, 2.2 + 400 / f), len = Math.round(dur * sr);
  const buf = ac.createBuffer(1, len, sr), d = buf.getChannelData(0);
  const tau1 = 1.2 + 250 / f;
  let ref = 0;
  for (const [, a] of partials(f, null, sr)) ref += Math.abs(a);
  const gain = (x == null ? 0.5 : 0.9) / ref;
  for (const [n, a0] of partials(f, x, sr)) {
    const tau = tau1 / (1 + 0.35 * (n - 1)), r = Math.exp(-1 / (tau * sr)), w = (2 * Math.PI * n * f) / sr;
    const A = a0 * gain, c = 2 * r * Math.cos(w), r2 = r * r;
    const kmax = Math.min(len, Math.ceil(tau * sr * Math.log(Math.abs(A) / 1e-6 + 1)));
    let y2 = 0, y1 = A * r * Math.sin(w);
    d[1] += y1;
    for (let k = 2; k < kmax; k++) { const y = c * y1 - r2 * y2; d[k] += y; y2 = y1; y1 = y; }
  }
  for (let k = 0; k < 48 && k < len; k++) d[k] *= k / 48;   // no click
  if (cache.size > 64) cache.delete(cache.keys().next().value);
  cache.set(key, buf);
  return buf;
}
function pluck(i) {
  const a = audio(), f = freqOf(i);
  const x = S.pendant && S.pendant.s === i ? S.pendant.a / S.strings[i].L : null;
  const old = voices.get(i);
  if (old) { try { old.g.gain.setTargetAtTime(0, a.currentTime, 0.015); old.src.stop(a.currentTime + 0.12); } catch {} }
  const src = a.createBufferSource(), g = a.createGain();
  src.buffer = buffer(f, x);
  src.connect(g).connect(master);
  src.start(a.currentTime + 0.003);
  voices.set(i, { src, g });
  src.onended = () => { if (voices.get(i)?.src === src) voices.delete(i); };
  const kept = partials(f, x, a.sampleRate).filter(([n, v]) => n <= 16 && Math.abs(v) > 0.02 * Math.abs(Math.sin(n * Math.PI * PLUCK_AT) / n ** 1.3)).map(([n]) => n);
  plucks.push({ i, f, x, kept, at: performance.now() });
  if (plucks.length > 24) plucks.shift();
  // the string's motion: its first harmonics' shapes, slowed down
  const shape = partials(f, x, 48000).filter(([n]) => n <= 8);
  const peak = shape.reduce((s, [, v]) => s + Math.abs(v), 0) || 1;
  vib[i] = { t0: performance.now(), shape: shape.map(([n, v]) => [n, v / peak]), tau: Math.min(1.6, (1.2 + 250 / f) * 0.6) };
  showBeats();
  tick();
}

// ---------- beats (👁): the last two strings plucked ----------
function showBeats() {
  const el = $("beats");
  if (!S.info || plucks.length < 2) { el.textContent = ""; return; }
  const p = plucks[plucks.length - 1], q = [...plucks].reverse().find((v) => v.i !== p.i);
  if (!q || q.i >= S.strings.length) { el.textContent = ""; return; }
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
  if (vib.some((v) => v && now - v.t0 < v.tau * 4000) || drags.size) tick();
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
  S.strings.forEach((s, i) => {
    // the rest of the full length, faint
    const e = pt(i, s.L), f = pt(i, 1);
    cx.strokeStyle = "rgba(255,255,255,0.08)"; cx.lineWidth = 1; cx.setLineDash([3, 5]);
    cx.beginPath(); cx.moveTo(e.x, e.y); cx.lineTo(f.x, f.y); cx.stroke(); cx.setLineDash([]);
    // the string, moving while it rings
    const v = vib[i], t = v ? (now - v.t0) / 1000 : 0, amp = v ? Math.min(G.span * 0.22, 14) * Math.exp(-t / v.tau) : 0;
    cx.strokeStyle = "#e9c46a"; cx.lineWidth = 1.2 + 1.4 * s.L;
    cx.beginPath();
    for (let k = 0; k <= 60; k++) {
      const u = k / 60, p = pt(i, u * s.L);
      let dsp = 0;
      if (amp > 0.2) for (const [h, w] of v.shape) dsp += w * Math.sin(h * Math.PI * u) * Math.cos(2 * Math.PI * h * 2.5 * t);
      const X = G.land ? p.x : p.x + amp * dsp, Y = G.land ? p.y + amp * dsp : p.y;
      k ? cx.lineTo(X, Y) : cx.moveTo(X, Y);
    }
    cx.stroke();
    // the nodes (👁)
    if (S.info) {
      cx.fillStyle = "rgba(124,196,255,0.55)";
      for (const nd of [1 / 2, 1 / 3, 2 / 3, 1 / 4, 3 / 4]) { const p = pt(i, nd * s.L); cx.beginPath(); cx.arc(p.x, p.y, nd === 0.5 ? 3 : 2, 0, 7); cx.fill(); }
    }
    // the bridge (drag it)
    cx.fillStyle = drags.has("b" + i) ? "#c58cff" : "#a64fff";
    cx.strokeStyle = "rgba(255,255,255,0.7)"; cx.lineWidth = 1.5;
    cx.beginPath(); cx.arc(e.x, e.y, 9, 0, 7); cx.fill(); cx.stroke();
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
  if (e.target.id === "remove") return;
  hideRemove();
  audio();
  stage.setPointerCapture(e.pointerId);
  const p = where(e);
  if (dist(p, pendantPos()) < 26) { drags.set(e.pointerId, { k: "pendant" }); pendDrag = { ...p }; tick(); return; }
  for (let i = 0; i < S.strings.length; i++) {
    if (dist(p, pt(i, S.strings[i].L)) < 26) { drags.set(e.pointerId, { k: "bridge", i, id: "b" + i }); drags.set("b" + i, true); tick(); return; }
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
  else clearTimeout(g.lp);
  tick();
}
stage.addEventListener("pointerup", end);
stage.addEventListener("pointercancel", end);
stage.addEventListener("contextmenu", (e) => e.preventDefault());

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
$("remove").addEventListener("click", () => {
  const i = removing;
  hideRemove();
  if (i < 0 || S.strings.length < 2) return;
  stopVoice(i);
  S.strings.splice(i, 1);
  vib.splice(i, 1);
  if (S.pendant) { if (S.pendant.s === i) S.pendant = null; else if (S.pendant.s > i) S.pendant.s--; }
  save(); layout();
});
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

// ---------- sleep ----------
document.addEventListener("visibilitychange", () => {
  if (!document.hidden || !ac) return;
  for (const i of [...voices.keys()]) stopVoice(i);
  ac.suspend().catch(() => {});
  try { if (navigator.audioSession) navigator.audioSession.type = "auto"; } catch {}
});
addEventListener("pagehide", () => { clearTimeout(saveT); try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} try { ac?.close(); } catch {} ac = null; cache.clear(); try { if (navigator.audioSession) navigator.audioSession.type = "auto"; } catch {} });

new ResizeObserver(layout).observe(stage);
controls();
layout();

window.resonateDebug = () => ({
  state: JSON.parse(JSON.stringify(S)), freqs: S.strings.map((_, i) => freqOf(i)), plucks: plucks.map((p) => ({ ...p })),
  land: G?.land, span: G?.span, beats: $("beats").textContent, pt: (i, a) => pt(i, a), dock: G && { ...G.dock },
  audio: ac?.state || null, frac, voices: voices.size, partials: (f, x) => partials(f, x, 48000),
});
