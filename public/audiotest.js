// Audio test (Tools): the same held piano note played seven ways, to find which way crackles
// on a given output (CarPlay: even one held key on the Sing page dropped out every few
// seconds, while the phone's speaker was fine). Each row reports what the device said.
//
// What's known (WebKit source, Nov 2026): Web Audio's output on iOS renders each IO callback's
// frames only after the callback asked for them, with no lookahead; when callbacks come in
// bursts or uneven sizes the shortfall is filled with zeros (a hard cut, every time). Every
// context of one sample rate and channel count shares one output path, and WebKit forces a
// 128-frame IO buffer while any context exists. An <audio> element goes through AVFoundation's
// deep buffers instead. So the tests compare: Web Audio made before / after "playback", at
// 44.1 / 48 kHz (a rate no other context uses gets its own path), a plain oscillator, Web Audio
// streamed into an <audio> element, and a pre-rendered WAV in an <audio> element with no
// AudioContext open at all.
//
// The probe reads the audio clock from the page (no AudioWorklet: a worklet makes WebKit's
// shared render thread wait on a slower thread every callback — itself a cause of crackles):
// ac.currentTime moves once per render wake-up, so its steps (in frames) show how the output
// pulls audio — the speaker's are small and even; bursts or uneven steps are what WebKit turns
// into holes. "speed" is the audio clock against the wall clock (1.00 = right).
import { loadPiano, holdPiano } from "./piano.js?v=74";

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

// Everything a test opened is closed — and the close awaited — before the next one starts, so
// each test gets its own output path (contexts alive together share one).
async function closeAll() {
  if (media) { media.pause(); media.srcObject = null; media.removeAttribute("src"); media = null; }
  const ac = ctx;
  ctx = null;
  if (ac && ac.state !== "closed") { try { await ac.close(); } catch {} }
}
// Create and start a context. (Called right in the tap: iOS lets audio start only there.)
function newCtx(opts) {
  const ac = new (window.AudioContext || window.webkitAudioContext)(opts);
  ctx = ac;
  ac.resume().catch(() => {});
  return ac;
}
async function started(ac) {
  for (let i = 0; i < 30 && ac.state !== "running"; i++) await sleep(50);
  if (ac.state !== "running") throw new Error("didn't start");
}

// The audio clock's steps while the note plays.
function clockProbe(ac) {
  const steps = [];
  let last = ac.currentTime;
  const c0 = ac.currentTime, w0 = performance.now();
  const t = setInterval(() => {
    const c = ac.currentTime;
    if (c !== last) { steps.push(Math.round((c - last) * ac.sampleRate)); last = c; }
  }, 1);
  return () => {
    clearInterval(t);
    const speed = (ac.currentTime - c0) / ((performance.now() - w0) / 1000);
    const s = steps.slice(10);
    if (!s.length) return { speed };
    const sorted = [...s].sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1];
    return { step: med, stepMax: sorted[sorted.length - 1], uneven: s.filter((x) => Math.abs(x - med) > 128).length / s.length, speed };
  };
}

// One held piano note (and its steady tone underneath) — what a held chip plays on the Sing page.
async function heldNote(ac) {
  const piano = await loadPiano(ac);
  const done = clockProbe(ac);
  const when = ac.currentTime + 0.1;
  holdPiano(ac, piano, when, NOTE, 1.4).release(when + SECS);
  await sleep((SECS + 0.9) * 1000);
  return done();
}
// The same piano sample into any node (for the stream test).
function pianoInto(ac, piano, out, when) {
  let key = piano.keys[0];
  for (const k of piano.keys) if (Math.abs(k - NOTE) < Math.abs(key - NOTE)) key = k;
  const src = ac.createBufferSource();
  src.buffer = piano.buffers.get(key);
  src.playbackRate.value = 2 ** ((NOTE - key) / 12);
  const g = ac.createGain();
  g.gain.setValueAtTime(1.4, when); g.gain.setTargetAtTime(0, when + SECS, 0.12);
  const o = ac.createOscillator(), og = ac.createGain();
  o.frequency.value = 440 * 2 ** ((NOTE - 69) / 12); o.type = "sawtooth";
  og.gain.setValueAtTime(0, when); og.gain.setTargetAtTime(0.05, when + 0.15, 0.3); og.gain.setTargetAtTime(0, when + SECS, 0.12);
  src.connect(g); g.connect(out); o.connect(og); og.connect(out);
  src.start(when, 0.012); src.stop(when + SECS + 1); o.start(when); o.stop(when + SECS + 1);
}
const facts = (ac) => ({ rate: ac.sampleRate, out: ac.outputLatency, base: ac.baseLatency });

// The note rendered ahead of time as a WAV, for the no-Web-Audio test (rendered offline, then
// that context is gone: an OfflineAudioContext has no output).
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
const within = (p, ms, what) => Promise.race([p, sleep(ms).then(() => { throw new Error(what); })]);
function mediaStalls(a) {
  const n = { stalls: 0 };
  for (const ev of ["waiting", "stalled"]) a.addEventListener(ev, () => n.stalls++);
  return n;
}

const TESTS = [
  { name: "As Sing does", how: "context made before “playback”", run: async () => {
    setSession("auto");
    const ac = newCtx();
    await started(ac);
    await sleep(400);
    setSession("playback");
    await sleep(300);
    return { ...facts(ac), ...(await heldNote(ac)) };
  } },
  { name: "Fresh", how: "context made after “playback”", run: async () => {
    setSession("playback");
    const ac = newCtx();
    await started(ac);
    return { ...facts(ac), ...(await heldNote(ac)) };
  } },
  { name: "Fresh · 44.1 kHz", how: "", run: async () => {
    setSession("playback");
    const ac = newCtx({ sampleRate: 44100 });
    await started(ac);
    return { ...facts(ac), ...(await heldNote(ac)) };
  } },
  { name: "Fresh · 48 kHz", how: "", run: async () => {
    setSession("playback");
    const ac = newCtx({ sampleRate: 48000 });
    await started(ac);
    return { ...facts(ac), ...(await heldNote(ac)) };
  } },
  { name: "Plain tone", how: "no piano", run: async () => {
    setSession("playback");
    const ac = newCtx();
    await started(ac);
    const done = clockProbe(ac);
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = 220;
    const t = ac.currentTime + 0.1;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.3, t + 0.05);
    g.gain.setValueAtTime(0.3, t + SECS); g.gain.linearRampToValueAtTime(0, t + SECS + 0.05);
    o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + SECS + 0.1);
    await sleep((SECS + 0.6) * 1000);
    return { ...facts(ac), ...done() };
  } },
  { name: "Web Audio → audio element", how: "streamed", run: async () => {
    setSession("playback");
    const ac = newCtx();
    const dest = ac.createMediaStreamDestination();
    const a = new Audio();
    media = a;
    a.srcObject = dest.stream;
    const n = mediaStalls(a);
    const playing = a.play();
    await started(ac);
    await within(playing, 3000, "the audio element didn't start");
    const piano = await loadPiano(ac);
    const done = clockProbe(ac);
    pianoInto(ac, piano, dest, ac.currentTime + 0.15);
    await sleep((SECS + 1) * 1000);
    return { ...facts(ac), ...done(), ...n };
  } },
  { name: "Audio file", how: "no Web Audio open", run: async () => {
    if (!wavUrl) throw new Error("not ready yet — tap again");
    setSession("playback");
    const a = new Audio(wavUrl);
    media = a;
    const n = mediaStalls(a);
    await within(a.play(), 3000, "the audio element didn't start");
    await sleep((SECS + 1.2) * 1000);
    return { ...n };
  } },
];

function line(r) {
  if (r.error) return `✗ ${r.error}`;
  const p = [];
  if (r.rate) p.push(`${r.rate} Hz`);
  if (r.out !== undefined) p.push(`out ${ms(r.out)}`);
  if (r.base !== undefined) p.push(`base ${ms(r.base)}`);
  if (r.step) p.push(`steps ${r.step}${r.stepMax > r.step ? `–${r.stepMax}` : ""} fr`);
  if (typeof r.uneven === "number") p.push(`${Math.round(r.uneven * 100)}% uneven`);
  if (typeof r.speed === "number" && isFinite(r.speed)) p.push(`speed ${r.speed.toFixed(2)}`);
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
    await closeAll();
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

window.addEventListener("pagehide", () => { closeAll(); setSession("auto"); });
window.resonateDebug = () => ({ results, running });
