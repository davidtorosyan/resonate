// Audio test (Tools): the same held piano note played six ways, to find which way crackles on a
// given output (CarPlay: even one held key on the Sing page dropped out every few seconds,
// while the phone speaker was fine). Each row reports what the device said: the context's
// sample rate, its output/base latency, the audio session, and — from a tiny AudioWorklet —
// how the output pulls audio: frames per wake-up (≈ the real IO buffer; WebKit asks for 128),
// the longest pause between wake-ups, and how far the audio clock wandered from the wall clock.
import { loadPiano, holdPiano } from "./piano.js?v=66";

const NOTE = 57; // A3
const SECS = 4;
const $ = (id) => document.getElementById(id);
const testsEl = $("tests"), statusEl = $("status");
const results = {};
let ctx = null, media = null, running = false;

const setSession = (t) => { try { if (navigator.audioSession) navigator.audioSession.type = t; } catch {} };
const sessionType = () => navigator.audioSession?.type ?? "–";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ms = (s) => (typeof s === "number" && isFinite(s) ? `${Math.round(s * 1000)} ms` : "–");

// Close what the last test left (a test's context is closed by the next one).
function release() {
  if (ctx && ctx.state !== "closed") ctx.close().catch(() => {});
  ctx = null;
  if (media) { media.pause(); media = null; }
}
// Create and start a context — synchronously, inside the tap, so iOS lets it start.
function newCtx(opts) {
  release();
  const ac = new (window.AudioContext || window.webkitAudioContext)(opts);
  ctx = ac;
  ac.resume().catch(() => {});
  return ac;
}
async function running_(ac) {
  for (let i = 0; i < 30 && ac.state !== "running"; i++) await sleep(50);
  return ac.state === "running";
}

const PROBE = `class Probe extends AudioWorkletProcessor {
  constructor() {
    super(); this.n = 0; this.last = 0; this.cur = 0; this.bursts = []; this.gaps = [];
    this.dmin = Infinity; this.dmax = -Infinity;
    this.port.onmessage = () => this.port.postMessage({ bursts: this.bursts, gaps: this.gaps, jitter: this.dmax - this.dmin });
  }
  process() {
    const t = Date.now();
    if (++this.n === 200) { this.t0 = t; this.f0 = currentFrame; }
    if (this.n > 200) {
      if (t - this.last >= 2) { if (this.cur) this.bursts.push(this.cur); this.gaps.push(t - this.last); this.cur = 0; }
      const d = (t - this.t0) / 1000 - (currentFrame - this.f0) / sampleRate;
      if (d < this.dmin) this.dmin = d; if (d > this.dmax) this.dmax = d;
    }
    this.cur += 128; this.last = t;
    return true;
  }
}
registerProcessor("probe", Probe);`;
const probeUrl = URL.createObjectURL(new Blob([PROBE], { type: "text/javascript" }));
const mods = new WeakSet();
async function probe(ac) {
  try {
    if (!mods.has(ac)) { await ac.audioWorklet.addModule(probeUrl); mods.add(ac); }
    const node = new AudioWorkletNode(ac, "probe", { numberOfOutputs: 1, outputChannelCount: [1] });
    node.connect(ac.destination);
    return async () => {
      const r = await new Promise((res) => { node.port.onmessage = (e) => res(e.data); node.port.postMessage(0); setTimeout(() => res(null), 1000); });
      node.disconnect();
      if (!r || !r.bursts.length) return {};
      const sorted = (a) => [...a].sort((x, y) => x - y);
      const b = sorted(r.bursts), g = sorted(r.gaps);
      return { wake: b[b.length >> 1], wakeMax: b[b.length - 1], gap: g[g.length >> 1], gapMax: g[g.length - 1], jitter: r.jitter };
    };
  } catch (err) { console.warn("probe", err); return async () => ({}); }
}

// One held piano note (and its steady tone underneath) — what a held chip plays on the Sing page.
async function playNote(ac) {
  const piano = await loadPiano(ac);
  const done = await probe(ac);
  const when = ac.currentTime + 0.1;
  holdPiano(ac, piano, when, NOTE, 1.4).release(when + SECS);
  await sleep((SECS + 0.9) * 1000);
  return done();
}
async function playTone(ac) {
  const done = await probe(ac);
  const o = ac.createOscillator(), g = ac.createGain();
  o.frequency.value = 220;
  const t = ac.currentTime + 0.1;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.3, t + 0.05);
  g.gain.setValueAtTime(0.3, t + SECS); g.gain.linearRampToValueAtTime(0, t + SECS + 0.05);
  o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + SECS + 0.1);
  await sleep((SECS + 0.6) * 1000);
  return done();
}
function facts(ac) {
  return { rate: ac.sampleRate, out: ac.outputLatency, base: ac.baseLatency };
}

// The note rendered ahead of time as a WAV, for the media-element test (no Web Audio).
let wavUrl = null;
(async () => {
  try {
    const sr = 44100, off = new OfflineAudioContext(1, Math.ceil(sr * (SECS + 1)), sr);
    const piano = await loadPiano(off);
    holdPiano(off, piano, 0.05, NOTE, 1.4).release(0.05 + SECS);
    const buf = await off.startRendering();
    wavUrl = URL.createObjectURL(wav(buf.getChannelData(0), sr));
  } catch (err) { console.warn("wav", err); }
})();
function wav(x, sr) {
  const out = new DataView(new ArrayBuffer(44 + x.length * 2));
  const s = (o, t) => { for (let i = 0; i < t.length; i++) out.setUint8(o + i, t.charCodeAt(i)); };
  s(0, "RIFF"); out.setUint32(4, 36 + x.length * 2, true); s(8, "WAVEfmt "); out.setUint32(16, 16, true);
  out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, sr, true); out.setUint32(28, sr * 2, true);
  out.setUint16(32, 2, true); out.setUint16(34, 16, true); s(36, "data"); out.setUint32(40, x.length * 2, true);
  for (let i = 0; i < x.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x[i])) * 32767, true);
  return new Blob([out], { type: "audio/wav" });
}

const TESTS = [
  { name: "As Sing does", how: "context made before “playback”", run: async () => {
    setSession("auto");
    const ac = newCtx();
    if (!(await running_(ac))) throw new Error("didn't start");
    await sleep(400);
    setSession("playback");
    await sleep(300);
    return { ...facts(ac), ...(await playNote(ac)) };
  } },
  { name: "Fresh", how: "context made after “playback”", run: async () => {
    setSession("playback");
    const ac = newCtx();
    if (!(await running_(ac))) throw new Error("didn't start");
    return { ...facts(ac), ...(await playNote(ac)) };
  } },
  { name: "Fresh · 48 kHz", how: "", run: async () => {
    setSession("playback");
    const ac = newCtx({ sampleRate: 48000 });
    if (!(await running_(ac))) throw new Error("didn't start");
    return { ...facts(ac), ...(await playNote(ac)) };
  } },
  { name: "Fresh · 44.1 kHz", how: "", run: async () => {
    setSession("playback");
    const ac = newCtx({ sampleRate: 44100 });
    if (!(await running_(ac))) throw new Error("didn't start");
    return { ...facts(ac), ...(await playNote(ac)) };
  } },
  { name: "Plain tone", how: "no piano, fresh context", run: async () => {
    setSession("playback");
    const ac = newCtx();
    if (!(await running_(ac))) throw new Error("didn't start");
    return { ...facts(ac), ...(await playTone(ac)) };
  } },
  { name: "Audio file", how: "no Web Audio", run: async () => {
    release();
    if (!wavUrl) throw new Error("not ready yet — tap again");
    setSession("playback");
    const a = new Audio(wavUrl);
    media = a;
    let stalls = 0;
    for (const ev of ["waiting", "stalled"]) a.addEventListener(ev, () => stalls++);
    await a.play();
    await sleep((SECS + 1.2) * 1000);
    return { stalls };
  } },
];

function line(r) {
  if (r.error) return `✗ ${r.error}`;
  const p = [];
  if (r.rate) p.push(`${r.rate} Hz`);
  if (r.out !== undefined) p.push(`out ${ms(r.out)}`);
  if (r.base !== undefined) p.push(`base ${ms(r.base)}`);
  if (r.wake) p.push(`wake ${r.wake}${r.wakeMax > r.wake ? `–${r.wakeMax}` : ""} fr`);
  if (r.gapMax) p.push(`gap ${r.gap}–${r.gapMax} ms`);
  if (typeof r.jitter === "number" && isFinite(r.jitter)) p.push(`drift ${ms(r.jitter)}`);
  if (r.stalls !== undefined) p.push(`stalls ${r.stalls}`);
  p.push(r.session);
  return p.join(" · ");
}

TESTS.forEach((t, i) => {
  const row = document.createElement("div");
  row.className = "test";
  row.innerHTML = `<button type="button">${i + 1}</button><b></b><div class="out mono"></div>`;
  row.querySelector("b").textContent = t.name + (t.how ? ` — ${t.how}` : "");
  const btn = row.querySelector("button"), out = row.querySelector(".out");
  btn.addEventListener("click", async () => {
    if (running) return;
    running = true;
    for (const b of testsEl.querySelectorAll("button")) b.disabled = true;
    row.dataset.state = "playing";
    statusEl.textContent = `▶ ${i + 1}…`;
    let r;
    try { r = await t.run(); } catch (err) { r = { error: err.message || String(err) }; }
    r.session = sessionType();
    results[i + 1] = { test: t.name, ...r };
    out.textContent = line(r);
    row.dataset.state = "";
    statusEl.textContent = "";
    for (const b of testsEl.querySelectorAll("button")) b.disabled = false;
    running = false;
  });
  testsEl.appendChild(row);
});

$("copy").addEventListener("click", async () => {
  const text = JSON.stringify({ ua: navigator.userAgent, results }, null, 1);
  try { await navigator.clipboard.writeText(text); statusEl.textContent = "copied"; }
  catch { window.prompt("Copy:", text); }
});

window.addEventListener("pagehide", () => { release(); setSession("auto"); });
window.resonateDebug = () => ({ results, running });
