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
import { loadPiano, holdPiano } from "./piano.js?v=96";

const NOTE = 57; // A3
const SECS = 4;
const $ = (id) => document.getElementById(id);
const testsEl = $("tests"), statusEl = $("status");
const results = {};
let ctx = null, media = null, running = false;
const extras = [], streams = []; // the mic rows' other contexts and mic streams

const setSession = (t) => { try { if (navigator.audioSession) navigator.audioSession.type = t; } catch {} };
const sessionType = () => navigator.audioSession?.type ?? "–";
// (A test going on in the background ends at its next wait: the page was put to sleep — sleepPage.)
const sleep = (ms) => new Promise((r, j) => setTimeout(() => (document.hidden ? j(new Error("page hidden")) : r()), ms));
const ms = (s) => (typeof s === "number" && isFinite(s) ? `${Math.round(s * 1000)} ms` : "–");

// Everything a test opened is closed — and the close awaited — before the next one starts, so
// each test gets its own output path (contexts alive together share one).
async function closeAll() {
  if (media) { media.pause(); media.srcObject = null; media.removeAttribute("src"); media = null; }
  for (const st of streams.splice(0)) for (const t of st.getTracks()) t.stop();
  const all = [ctx, ...extras.splice(0)];
  ctx = null;
  for (const ac of all) if (ac && ac.state !== "closed") { try { await ac.close(); } catch {} }
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
const loadSS = { atLoad: navigator.audioSession?.state ?? "–" }; // row H: did the offline decode wake the session?
(async () => {
  try {
    const sr = 44100, off = new OfflineAudioContext(1, Math.ceil(sr * (SECS + 1)), sr);
    const piano = await loadPiano(off);
    holdPiano(off, piano, 0.05, NOTE, 1.4).release(0.05 + SECS);
    loadSS.afterDecode = navigator.audioSession?.state ?? "–";
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
    for (const b of document.querySelectorAll(".test > button")) b.disabled = true;
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
    for (const b of document.querySelectorAll(".test > button")) b.disabled = false;
    running = false;
  });
  testsEl.appendChild(row);
});

// ---- Mic + speaker (the redesign's listening policy: can the tuner keep listening between sounds?)
// Each row answers one question on a real device; some ask what you heard (chips under the row).
const MIC = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } };
const ssState = () => navigator.audioSession?.state ?? "–";
const now = () => performance.now();
async function getMic() {
  if (document.hidden) throw new Error("page hidden");
  const t0 = now();
  const st = await navigator.mediaDevices.getUserMedia(MIC);
  streams.push(st);
  return { st, ms: Math.round(now() - t0) };
}
const stopMic = (st) => { for (const t of st.getTracks()) t.stop(); };
// A context for listening, made in the tap (iOS starts one only there).
function micCtx() {
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  extras.push(ac); ac.resume().catch(() => {});
  return ac;
}
// ms from now until the mic delivers a non-silent frame (null: none within `limit`).
async function firstSound(ac, st, limit = 4000) {
  const src = ac.createMediaStreamSource(st), an = ac.createAnalyser();
  an.fftSize = 2048; src.connect(an);
  const buf = new Float32Array(an.fftSize), t0 = now();
  while (now() - t0 < limit) {
    an.getFloatTimeDomainData(buf);
    let e = 0; for (const v of buf) e += v * v;
    if (Math.sqrt(e / buf.length) > 1e-4) return Math.round(now() - t0);
    await sleep(10);
  }
  return null;
}
function beep(ac, at, dur = 0.06, f = 880, level = 0.3) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.frequency.value = f;
  g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(level, at + 0.005);
  g.gain.setValueAtTime(level, at + dur); g.gain.linearRampToValueAtTime(0, at + dur + 0.01);
  o.connect(g); g.connect(ac.destination); o.start(at); o.stop(at + dur + 0.02);
}
const flipBack = () => { setSession("auto"); setSession("playback"); };
const lat = (ac) => `${ac.sampleRate} Hz · out ${ms(ac.outputLatency)} · base ${ms(ac.baseLatency)}`;
// A pad in the row: resolves after n presses (or 25 s); onDown runs inside the pointerdown.
function pad(row, label, n, onDown) {
  const el = row.querySelector(".pad");
  el.hidden = false; el.textContent = `${label} · ${n}`;
  return new Promise((done) => {
    let left = n;
    const finish = () => { el.onpointerdown = null; el.hidden = true; clearTimeout(t); done(n - left); };
    const t = setTimeout(finish, 25000);
    el.onpointerdown = (ev) => {
      ev.preventDefault();
      if (left <= 0) return;
      onDown(ev);
      left--; el.textContent = left ? `${label} · ${left}` : "✓";
      if (!left) setTimeout(finish, 300);
    };
  });
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };

const MIC_TESTS = [
  { key: "A", name: "Mic on, then off", how: "a beep before and after", ask: ["2nd beep as loud", "2nd quieter", "2nd silent"], run: async () => {
    setSession("playback");
    const ac = newCtx(), states = [], T0 = now();
    ac.onstatechange = () => states.push(`${ac.state}@${Math.round(now() - T0)}`);
    await started(ac);
    beep(ac, ac.currentTime + 0.05, 0.3); await sleep(500);
    setSession("play-and-record");
    const { st, ms: open } = await getMic();
    await sleep(1500);
    stopMic(st); flipBack(); await sleep(300);
    const c0 = ac.currentTime; await sleep(300);
    const moving = ac.currentTime > c0;
    if (ac.state !== "running") { try { await within(ac.resume(), 1500, "resume"); } catch {} }
    beep(ac, ac.currentTime + 0.05, 0.3); await sleep(600);
    return { open, states: states.join(" ") || "no change", after: ac.state, moving, lat: lat(ac), ss: ssState() };
  } },
  { key: "B", name: "Volume after the mic", how: "1 loud beep, mic 1 s, then 8 beeps 0.1 s apart", ask: ["0", "1", "2", "3", "4", "5", "6", "7", "8"], askText: "How many of the 8 were quiet?", run: async () => {
    setSession("playback");
    const ac = newCtx();
    await started(ac);
    beep(ac, ac.currentTime + 0.05); await sleep(500);
    setSession("play-and-record");
    const { st } = await getMic();
    await sleep(1000);
    stopMic(st); flipBack();
    if (ac.state !== "running") { try { await within(ac.resume(), 1000, "resume"); } catch {} }
    const t = ac.currentTime + 0.01;
    for (let i = 0; i < 8; i++) beep(ac, t + i * 0.1, 0.04);
    await sleep(1200);
    return { state: ac.state, lat: lat(ac), ss: ssState() };
  } },
  { key: "C", name: "Mic again, no tap", how: "opens, closes, waits 6 s, opens again", run: async () => {
    const mac = micCtx();
    setSession("play-and-record");
    const first = await getMic();
    const heard1 = await firstSound(mac, first.st);
    stopMic(first.st); setSession("auto");
    statusEl.textContent = "waiting 6 s — don't tap";
    await sleep(6000);
    statusEl.textContent = "opening again…";
    setSession("play-and-record");
    let again;
    try { again = await within(getMic(), 10000, "no answer in 10 s"); }
    catch (err) { setSession("auto"); return { first: first.ms, heard1, again: `✗ ${err.name || ""} ${err.message}`.trim() }; }
    if (mac.state !== "running") { try { await within(mac.resume(), 1500, "resume"); } catch {} }
    const heard2 = await firstSound(mac, again.st);
    stopMic(again.st); setSession("auto");
    return { first: first.ms, heard1, again: again.ms, heard2, micCtx: mac.state };
  } },
  { key: "D", name: "Press with the mic on / off", how: "press the pad 5× each way", ask: ["same", "mic on quieter", "mic on slower", "quieter + slower"], run: async (row) => {
    setSession("playback");
    const ac = newCtx();
    await started(ac);
    const piano = await loadPiano(ac);
    const take = (out) => (ev) => {
      const t = ac.currentTime;
      holdPiano(ac, piano, t, 60 + out.length * 2, 1.4).release(t + 0.5);
      out.push({ lag: now() - ev.timeStamp, state: ac.state });
    };
    setSession("play-and-record");
    const { st } = await getMic();
    const on = [], off = [];
    const onLat = lat(ac);
    await pad(row, "Mic on — press", 5, take(on));
    stopMic(st); flipBack();
    await sleep(300);
    await pad(row, "Mic off — press", 5, take(off));
    const sum = (a) => a.length ? `${a.length}× lag ${median(a.map((x) => x.lag)).toFixed(1)} ms · ${[...new Set(a.map((x) => x.state))].join("/")}` : "no presses";
    return { on: `${sum(on)} · ${onLat}`, off: `${sum(off)} · ${lat(ac)}` };
  } },
  { key: "E", name: "Route", how: "with AirPods or in the car: a note right after the mic closes", ask: ["heard its start", "start cut off", "silent"], run: async () => {
    setSession("playback");
    const ac = newCtx(), mac = micCtx();
    await started(ac);
    const before = lat(ac);
    setSession("play-and-record");
    const t0 = now();
    const { st } = await getMic();
    const tOpen = now(), heard = await firstSound(mac, st);
    const tr = st.getAudioTracks()[0], set = tr?.getSettings?.() || {};
    const during = lat(ac);
    let devs = [];
    try { devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind.startsWith("audio")).map((d) => `${d.kind === "audioinput" ? "in" : "out"}:${d.label || "?"}`); } catch {}
    await sleep(1500);
    stopMic(st); flipBack();
    const t1 = now();
    if (ac.state !== "running") { try { await within(ac.resume(), 1500, "resume"); } catch {} }
    const piano = await loadPiano(ac);
    const at = ac.currentTime + 0.02;
    holdPiano(ac, piano, at, NOTE, 1.4).release(at + 1.5);
    const noteAfter = Math.round(now() - t1);
    await sleep(2000);
    return { track: tr?.label || "?", rate: set.sampleRate, ch: set.channelCount, micToSound: heard == null ? null : Math.round(tOpen - t0 + heard), before, during, after: lat(ac), noteAfter, devices: devs.join(", "), ss: ssState() };
  } },
  { key: "F", name: "Sound with the mic open", how: "3 notes: before, while the mic is open, after", ask: ["all clear", "2nd dull", "3rd dull", "2nd + 3rd dull"], run: async () => {
    const one = async (label) => {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      extras.push(ac);
      try { await within(ac.resume(), 1500, "resume"); } catch {}
      const r = `${label}: ${ac.state} · ${lat(ac)}`;
      if (ac.state === "running") { const piano = await loadPiano(ac); const at = ac.currentTime + 0.05; holdPiano(ac, piano, at, NOTE, 1.4).release(at + 1); await sleep(1500); }
      await ac.close().catch(() => {});
      return r;
    };
    setSession("playback");
    const ac = newCtx(); await started(ac); // the tap's context keeps the page allowed to play
    const a = await one("playback");
    setSession("play-and-record");
    const { st } = await getMic();
    const b = await one("mic open");
    stopMic(st); flipBack(); await sleep(200);
    const c = await one("after");
    return { a, b, c, ss: ssState() };
  } },
  { key: "G", name: "Other apps' music", how: "start music in another app first, then tap", ask: ["kept playing", "paused", "paused, came back"], run: async () => {
    const standalone = matchMedia("(display-mode: standalone)").matches || !!navigator.standalone;
    setSession("play-and-record");
    const { st } = await getMic();
    await sleep(2000);
    stopMic(st); setSession("auto");
    await sleep(1500);
    return { standalone, ss: ssState() };
  } },
  { key: "H", name: "Piano decoded offline", how: "decode with no output, then ▶ on a 48 kHz context", ask: ["clean", "crackly", "silent"], run: async (row) => {
    const s0 = ssState(), t0 = now();
    const off = new OfflineAudioContext(1, 1, 44100);
    const piano = await loadPiano(off);
    const decode = Math.round(now() - t0), s1 = ssState();
    setSession("playback");
    let ac = null;
    await pad(row, "▶ Play it", 1, () => {
      ac = newCtx({ sampleRate: 48000 });
      const at = ac.currentTime + 0.05;
      holdPiano(ac, piano, at, NOTE, 1.4).release(at + 3);
    });
    const ss = `load ${loadSS.atLoad} → decoded ${loadSS.afterDecode ?? "?"} · tap ${s0} → ${s1}`;
    if (!ac) return { decode, ss, played: false };
    const done = clockProbe(ac);
    await sleep(3600);
    return { decode, ss, lat: lat(ac), ...done() };
  } },
];

const micEl = $("mic");
const keyLine = (r) => r.error ? `✗ ${r.error}` : Object.entries(r).filter(([k]) => k !== "answer").map(([k, v]) => `${k} ${typeof v === "number" ? +v.toFixed?.(3) : v}`).join(" · ");
MIC_TESTS.forEach((t) => {
  const row = document.createElement("div");
  row.className = "test";
  row.innerHTML = `<button type="button">${t.key}</button><b></b><div class="out mono"></div><div class="pad" hidden></div><div class="ask" hidden></div>`;
  row.querySelector("b").textContent = `${t.name} — ${t.how}`;
  const btn = row.querySelector("button"), out = row.querySelector(".out"), ask = row.querySelector(".ask");
  btn.addEventListener("click", async () => {
    if (running) return;
    if (!navigator.mediaDevices?.getUserMedia && t.key !== "H") { out.textContent = "✗ no microphone API"; return; }
    running = true;
    for (const b of document.querySelectorAll(".test > button")) b.disabled = true;
    row.dataset.state = "playing"; ask.hidden = true;
    statusEl.textContent = `▶ ${t.key}…`;
    let r;
    try { r = await t.run(row); } catch (err) { r = { error: `${err.name && err.name !== "Error" ? err.name + ": " : ""}${err.message || err}` }; }
    r.session = sessionType();
    await closeAll(); setSession("auto");
    results[t.key] = { test: t.name, ...r };
    out.textContent = keyLine(r);
    if (t.ask && !r.error) {
      ask.hidden = false;
      ask.innerHTML = `<span>${t.askText || "Heard:"}</span>`;
      for (const a of t.ask) {
        const c = document.createElement("button");
        c.type = "button"; c.textContent = a;
        c.onclick = () => { results[t.key].answer = a; for (const x of ask.querySelectorAll("button")) x.ariaPressed = String(x === c); };
        ask.appendChild(c);
      }
    }
    row.dataset.state = ""; statusEl.textContent = "";
    for (const b of document.querySelectorAll(".test > button")) b.disabled = false;
    running = false;
  });
  micEl.appendChild(row);
});

$("copy").addEventListener("click", async () => {
  const text = JSON.stringify({ ua: navigator.userAgent, results }, null, 1);
  try { await navigator.clipboard.writeText(text); statusEl.textContent = "copied"; }
  catch { window.prompt("Copy:", text); }
});

// Hidden (Safari in the background, the screen locked) or left: everything a test opened closes
// and the session goes "auto" — a test under way ends with an error at its next step.
const sleepPage = () => { closeAll(); setSession("auto"); };
document.addEventListener("visibilitychange", () => { if (document.hidden) sleepPage(); });
window.addEventListener("pagehide", sleepPage);
window.resonateDebug = () => ({ results, running });
