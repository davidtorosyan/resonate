// Record mode: sing freely, see a live piano roll, get a transcript of the
// notes you sang, and play it back (your voice and/or the notes on piano).
// Song-based scoring lives on the Sing page (sing.js).

import { noteName as nameOf, BLACK, median, centsLabel } from "./music.js?v=65";
import { openMic, ANALYSIS_LAG } from "./pitch.js?v=65";
import { startCapture, playVoice } from "./capture.js?v=65";
import { loadPiano, pianoReady, playPiano, scheduleAhead, keepAlive } from "./piano.js?v=65";

const $ = (id) => document.getElementById(id);
const canvas = $("roll");
const ctx = canvas.getContext("2d");
const recBtn = $("rec");
const statusEl = $("status");
const liveNoteEl = $("live-note");
const liveCentsEl = $("live-cents");
const timerEl = $("timer");
const transcriptEl = $("transcript");
const noteCountEl = $("note-count");
const copyBtn = $("copy");
const accBtn = $("accidentals");
const playbarEl = $("playbar");
const playBtn = $("play");
const playModesEl = $("play-modes");

// --- Tunables -------------------------------------------------------------
const SMOOTH_MS = 100;      // median window for the live pitch used to segment
const SPLIT_MS = 80;        // pitch must sit >50¢ off the current note this long to start a new note
const GAP_MS = 70;          // unvoiced gap this long ends the current note
const MIN_NOTE_MS = 60;     // shorter notes are dropped as glitches
const PX_PER_SEC = 110;     // horizontal zoom of the piano roll
const GUTTER = 38;          // left gutter for note labels (CSS px)
const MAX_TAKE_SEC = 300;   // auto-stop (raw audio is ~11 MB/min)

const ACC_KEY = "resonate.accidentals";
const PLAYMODE_KEY = "resonate.playMode";

let useFlats = false;
try { useFlats = localStorage.getItem(ACC_KEY) === "flat"; } catch {}
const noteName = (m) => nameOf(m, useFlats);

// --- Recording state ------------------------------------------------------------
let mic = null;       // from openMic()
let capture = null;   // from startCapture()
let wakeLock = null;
let rafId = null;
let recording = false;
let ctxT0 = 0;        // mic AudioContext time at record start — the take's clock

// --- Take state ---------------------------------------------------------------
let frames = [];   // { t (s), midi | null }
let segments = []; // finished notes: { start, end, note, cents, samples }
let cur = null;    // note in progress
let pend = null;   // candidate new pitch while waiting out SPLIT_MS
let smooth = [];   // recent voiced { t, midi } for the live median
let lastVoiced = -Infinity;
let liveMidi = null;
let duration = 0;
let voice = null;  // captured audio, start in take time

// --- View state ---------------------------------------------------------------
let rangeLo = 48; // C3
let rangeHi = 72; // C5
let scrollT = 0;  // left edge (s) when reviewing
let hasPitch = false;
let selected = -1;

// --- Playback state ---------------------------------------------------------------
let playCtx = null;
let playNodes = [];
let playing = false;
let playT0 = 0, playFrom = 0, playRaf = null;
let playhead = null; // take time being played, or null
let cursorT = 0;     // where Play starts
let playMode = "both"; // voice | notes | both
try { playMode = localStorage.getItem(PLAYMODE_KEY) || "both"; } catch {}
if (!["voice", "notes", "both"].includes(playMode)) playMode = "both";

// ---------------------------------------------------------------------------
// Segmentation: a note is a run of voiced frames whose smoothed pitch stays
// within 50¢ of the note's (median) pitch. It ends on an unvoiced gap ≥
// GAP_MS, or when the smoothed pitch sits >50¢ away for SPLIT_MS — the new
// note then starts where the departure began.

function newSegment(start, samples) {
  return { start, end: start, samples: [...samples], note: Math.round(median(samples)) };
}

function closeCurrent() {
  if (cur && (cur.end - cur.start) * 1000 >= MIN_NOTE_MS) {
    cur.cents = Math.round((median(cur.samples) - cur.note) * 100);
    const prev = segments[segments.length - 1];
    // A dropped blip can leave two same-note neighbours — rejoin them.
    if (prev && prev.note === cur.note && (cur.start - prev.end) * 1000 < GAP_MS) {
      prev.samples.push(...cur.samples);
      prev.end = cur.end;
      prev.cents = Math.round((median(prev.samples) - prev.note) * 100);
    } else {
      segments.push(cur);
    }
    renderTranscript();
  }
  cur = null;
  pend = null;
  smooth = [];
}

function processFrame(t, midi) {
  frames.push({ t, midi });
  if (midi === null) {
    if (cur && (t - lastVoiced) * 1000 >= GAP_MS) closeCurrent();
    if ((t - lastVoiced) * 1000 >= GAP_MS) liveMidi = null;
    return;
  }
  lastVoiced = t;
  smooth.push({ t, midi });
  while (smooth.length && (t - smooth[0].t) * 1000 > SMOOTH_MS) smooth.shift();
  const sm = median(smooth.map((s) => s.midi));
  liveMidi = sm;
  expandRange(midi);

  if (!cur) {
    cur = newSegment(t, [midi]);
    return;
  }
  if (Math.abs(sm - cur.note) > 0.5) {
    if (!pend) pend = { start: t, samples: [] };
    pend.samples.push(midi);
    if ((t - pend.start) * 1000 >= SPLIT_MS) {
      const p = pend;
      cur.end = Math.min(cur.end, p.start);
      closeCurrent();
      cur = newSegment(p.start, p.samples);
      cur.end = t;
      smooth = [{ t, midi }];
    }
  } else {
    if (pend) { cur.samples.push(...pend.samples); pend = null; }
    cur.samples.push(midi);
    cur.end = t;
    cur.note = Math.round(median(cur.samples));
  }
}

function expandRange(midi) {
  const m = Math.round(midi);
  if (!hasPitch) {
    hasPitch = true;
    rangeLo = m - 6;
    rangeHi = m + 6;
  }
  if (m - 2 < rangeLo) rangeLo = m - 2;
  if (m + 2 > rangeHi) rangeHi = m + 2;
}

// ---------------------------------------------------------------------------
// Rendering

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render();
}
new ResizeObserver(resize).observe(canvas);

function tuneOf(cents) {
  const a = Math.abs(cents);
  return a < 15 ? "good" : a < 30 ? "ok" : "off";
}
const TUNE_COLORS = {
  good: ["rgba(74,222,128,0.55)", "rgba(74,222,128,0.9)"],
  ok: ["rgba(166,79,255,0.55)", "rgba(166,79,255,0.95)"],
  off: ["rgba(255,111,111,0.5)", "rgba(255,111,111,0.9)"],
};

function visibleSpan(w) {
  return (w - GUTTER) / PX_PER_SEC;
}

function clampScroll(w) {
  const span = visibleSpan(w);
  scrollT = Math.max(0, Math.min(scrollT, Math.max(0, duration - span * 0.9)));
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function render() {
  const r = canvas.getBoundingClientRect();
  const w = r.width, h = r.height;
  if (!w || !h) return;
  ctx.clearRect(0, 0, w, h);

  const span = visibleSpan(w);
  let left;
  if (recording) left = Math.max(0, duration - span * 0.85);
  else { clampScroll(w); left = scrollT; }

  const rows = rangeHi - rangeLo + 1;
  const rowH = h / rows;
  const yOf = (m) => h - (m - rangeLo + 0.5) * rowH;
  const xOf = (t) => GUTTER + (t - left) * PX_PER_SEC;

  for (let m = rangeLo; m <= rangeHi; m++) {
    const pc = ((m % 12) + 12) % 12;
    const y = yOf(m) - rowH / 2;
    if (BLACK.has(pc)) {
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(GUTTER, y, w - GUTTER, rowH);
    }
    if (pc === 0) {
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(GUTTER, y + rowH - 1, w - GUTTER, 1);
    }
  }

  // Second ticks.
  ctx.font = "10px ui-monospace, monospace";
  ctx.textBaseline = "bottom";
  ctx.textAlign = "left";
  for (let s = Math.ceil(left); s <= left + span; s++) {
    const x = xOf(s);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(x, 0, 1, h);
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.fillText(`${s}s`, x + 3, h - 2);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(GUTTER, 0, w - GUTTER, h);
  ctx.clip();

  // Note bars.
  const all = cur && cur.end > cur.start ? [...segments, { ...cur, cents: Math.round((median(cur.samples) - cur.note) * 100), live: true }] : segments;
  const barH = Math.max(4, Math.min(rowH * 0.8, 26));
  ctx.textBaseline = "middle";
  ctx.font = "600 11px system-ui, sans-serif";
  all.forEach((s, i) => {
    const x0 = xOf(s.start), x1 = xOf(s.end);
    if (x1 < GUTTER || x0 > w) return;
    const [fill, stroke] = TUNE_COLORS[tuneOf(s.cents)];
    const y = yOf(s.note);
    const active = playhead !== null && !s.live && s.start - ANALYSIS_LAG <= playhead && playhead < s.end - ANALYSIS_LAG;
    ctx.fillStyle = fill;
    ctx.strokeStyle = i === selected || active ? "#fff" : stroke;
    ctx.lineWidth = i === selected || active ? 2 : 1;
    roundRect(x0, y - barH / 2, Math.max(2, x1 - x0), barH, Math.min(5, barH / 2));
    ctx.fill();
    ctx.stroke();
    if (x1 - x0 > 26 && barH >= 10) {
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fillText(noteName(s.note), x0 + 4, y + 0.5);
    }
  });

  // Raw pitch trace.
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.beginPath();
  let prev = null;
  for (const f of frames) {
    if (f.t < left - 0.1 || f.t > left + span + 0.1) { prev = null; continue; }
    if (f.midi === null) { prev = null; continue; }
    const x = xOf(f.t), y = yOf(f.midi);
    if (prev && Math.abs(prev.midi - f.midi) < 1.5 && f.t - prev.t < 0.1) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
    prev = f;
  }
  ctx.stroke();

  if (recording) {
    ctx.fillStyle = "rgba(255,111,138,0.8)";
    ctx.fillRect(xOf(duration), 0, 1.5, h);
  } else if (playhead !== null) {
    ctx.fillStyle = "rgba(120,200,255,0.95)";
    ctx.fillRect(xOf(playhead), 0, 2, h);
  } else if (frames.length) {
    ctx.fillStyle = "rgba(120,200,255,0.45)";
    ctx.fillRect(xOf(cursorT), 0, 1.5, h);
  }
  ctx.restore();

  // Gutter labels.
  ctx.fillStyle = "rgba(15,15,30,0.85)";
  ctx.fillRect(0, 0, GUTTER, h);
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let m = rangeLo; m <= rangeHi; m++) {
    const pc = ((m % 12) + 12) % 12;
    const isC = pc === 0;
    if (!isC && (BLACK.has(pc) || rowH < 11)) continue;
    ctx.font = isC ? "600 10px ui-monospace, monospace" : "10px ui-monospace, monospace";
    ctx.fillStyle = isC ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.4)";
    ctx.fillText(noteName(m), GUTTER - 6, yOf(m));
  }
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(1).padStart(4, "0")}`;
}

function renderTranscript() {
  transcriptEl.textContent = "";
  segments.forEach((s, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "note-chip mono";
    b.dataset.tune = tuneOf(s.cents);
    b.dataset.selected = i === selected ? "true" : "false";
    b.innerHTML = `<b></b><small></small>`;
    b.querySelector("b").textContent = noteName(s.note);
    b.querySelector("small").textContent = `${(s.end - s.start).toFixed(2)}s ${centsLabel(s.cents)}`;
    b.addEventListener("click", () => selectSegment(i));
    transcriptEl.appendChild(b);
  });
  noteCountEl.textContent = segments.length ? `NOTES · ${segments.length}` : "NOTES";
  if (recording) transcriptEl.scrollTop = transcriptEl.scrollHeight;
  copyBtn.disabled = recording || segments.length === 0;
  updatePlayUI();
}

function selectSegment(i) {
  if (recording) return;
  selected = selected === i ? -1 : i;
  if (selected >= 0) {
    const s = segments[i];
    const span = visibleSpan(canvas.getBoundingClientRect().width);
    scrollT = (s.start + s.end) / 2 - span / 2;
    cursorT = Math.max(0, s.start - 0.25);
    if (playing) startPlayback(cursorT);
  }
  renderTranscript();
  render();
}

function showTakeResult() {
  updateLive();
  if (segments.length) liveNoteEl.textContent = `${segments.length} notes`;
}

function updateLive() {
  timerEl.textContent = formatTime(duration);
  const note = cur ? cur.note : null;
  if (note === null || liveMidi === null) {
    liveNoteEl.textContent = "—";
    liveNoteEl.dataset.active = "false";
    liveCentsEl.textContent = "—";
    return;
  }
  liveNoteEl.textContent = noteName(note);
  liveNoteEl.dataset.active = "true";
  liveCentsEl.textContent = centsLabel(Math.round((liveMidi - note) * 100));
}

// ---------------------------------------------------------------------------
// Recording

function tick() {
  rafId = requestAnimationFrame(tick);
  if (!mic) return;
  const r = mic.read();
  const t = mic.ac.currentTime - ctxT0;
  duration = t;
  if (t > MAX_TAKE_SEC) { stopRecording(); return; }
  processFrame(t, r.midi);
  updateLive();
  render();
  statusEl.textContent = `${r.db.toFixed(0)} dB`;
}

async function startRecording() {
  try {
    recBtn.disabled = true;
    statusEl.textContent = "requesting mic…";
    stopPlayback();
    mic = await openMic();
    capture = await startCapture(mic.ac, mic.source);
    frames = [];
    segments = [];
    cur = null;
    pend = null;
    smooth = [];
    lastVoiced = -Infinity;
    liveMidi = null;
    duration = 0;
    selected = -1;
    voice = null;
    rangeLo = 48;
    rangeHi = 72;
    hasPitch = false;
    cursorT = 0;
    ctxT0 = mic.ac.currentTime;
    recording = true;
    canvas.dataset.pannable = "false";
    renderTranscript();
    try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
    recBtn.textContent = "Stop";
    recBtn.dataset.recording = "true";
    timerEl.dataset.rec = "true";
    recBtn.disabled = false;
    if (!rafId) tick();
  } catch (err) {
    recBtn.disabled = false;
    console.error(err);
    await stopRecording();
    statusEl.textContent = `mic error: ${err.name || err.message}`;
  }
}

async function stopRecording() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  if (recording) closeCurrent();
  recording = false;
  if (capture) {
    const v = await capture.finish();
    if (v) voice = { ...v, start: v.start - ctxT0 };
    capture = null;
  }
  if (mic) await mic.close();
  mic = null;
  try { await wakeLock?.release(); } catch {}
  wakeLock = null;
  liveMidi = null;
  recBtn.textContent = "Record";
  recBtn.dataset.recording = "false";
  timerEl.dataset.rec = "false";
  statusEl.textContent = "idle";
  canvas.dataset.pannable = frames.length ? "true" : "false";
  scrollT = 0;
  showTakeResult();
  renderTranscript();
  transcriptEl.scrollTop = 0;
  render();
}

// ---------------------------------------------------------------------------
// Playback: voice = the recording; notes = a piano note per detected note;
// both = voice + notes.

function effectiveMode() {
  return voice ? playMode : "notes";
}

async function startPlayback(from) {
  stopPlayback();
  if (recording || (!voice && !segments.length)) return;
  try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
  if (!playCtx || playCtx.state === "closed") playCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (playCtx.state === "suspended") await playCtx.resume();
  const ac = playCtx;
  const mode = effectiveMode();
  let piano = null;
  if (mode !== "voice") {
    if (!pianoReady(ac)) { playBtn.textContent = "Loading…"; playBtn.disabled = true; }
    try { piano = await loadPiano(ac); } catch (err) { console.warn("Piano samples unavailable", err); }
    playBtn.disabled = false;
    if (playing) return; // another play started while loading
  }
  from = Math.max(0, Math.min(from, duration));
  if (from >= duration - 0.05) from = 0;
  const start = ac.currentTime + 0.08;
  const withVoice = mode !== "notes";
  keepAlive(ac, playNodes);
  if (withVoice) playVoice(ac, voice, start, from, playNodes);
  if (piano) {
    const level = withVoice ? 0.9 : 1.6;
    const items = [];
    for (const s of segments) {
      // Detected notes trail the audio by about half an analysis window.
      const s0 = s.start - ANALYSIS_LAG, e0 = s.end - ANALYSIS_LAG;
      if (e0 <= from) continue;
      const st = Math.max(s0, from);
      items.push({ when: start + (st - from), end: start + (e0 - from), midi: s.note });
    }
    items.sort((a, b) => a.when - b.when);
    // (a few seconds ahead at a time: a long take's notes all at once made WebKit choppy)
    scheduleAhead(ac, items, (it) => playPiano(ac, piano, it.when, it.end - it.when, it.midi, level, playNodes), playNodes);
  }
  playing = true;
  playFrom = from;
  playT0 = start;
  playhead = from;
  updatePlayUI();
  const loop = () => {
    if (!playing) return;
    playhead = playFrom + Math.max(0, ac.currentTime - playT0);
    if (playhead >= duration + 0.15) { stopPlayback(); return; }
    followPlayhead();
    showPlayingNote();
    render();
    playRaf = requestAnimationFrame(loop);
  };
  playRaf = requestAnimationFrame(loop);
}

function stopPlayback() {
  for (const n of playNodes) try { n.stop(); } catch {}
  playNodes = [];
  const was = playing;
  playing = false;
  playhead = null;
  if (playRaf) cancelAnimationFrame(playRaf);
  playRaf = null;
  updatePlayUI();
  if (was) {
    showTakeResult();
    render();
  }
}

function followPlayhead() {
  const span = visibleSpan(canvas.getBoundingClientRect().width);
  if (playhead < scrollT || playhead > scrollT + span * 0.85) scrollT = playhead - span * 0.15;
}

function showPlayingNote() {
  timerEl.textContent = formatTime(playhead);
  const s = segments.find((x) => x.start - ANALYSIS_LAG <= playhead && playhead < x.end - ANALYSIS_LAG);
  if (!s) {
    liveNoteEl.textContent = "—";
    liveNoteEl.dataset.active = "false";
    liveCentsEl.textContent = "";
    return;
  }
  liveNoteEl.textContent = noteName(s.note);
  liveNoteEl.dataset.active = "true";
  liveCentsEl.textContent = centsLabel(s.cents);
}

function updatePlayUI() {
  playbarEl.hidden = recording || (!voice && !segments.length);
  playBtn.textContent = playing ? "■ Stop" : "▶ Play";
  playBtn.dataset.playing = playing ? "true" : "false";
  const mode = effectiveMode();
  for (const b of playModesEl.querySelectorAll("button")) {
    b.disabled = b.dataset.mode !== "notes" && !voice;
    b.dataset.active = b.dataset.mode === mode ? "true" : "false";
  }
}

// ---------------------------------------------------------------------------
// Interaction

recBtn.addEventListener("click", () => (recording ? stopRecording() : startRecording()));
playBtn.addEventListener("click", () => (playing ? stopPlayback() : startPlayback(cursorT)));
playModesEl.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-mode]");
  if (!b || b.disabled) return;
  playMode = b.dataset.mode;
  try { localStorage.setItem(PLAYMODE_KEY, playMode); } catch {}
  if (playing) startPlayback(playhead);
  else updatePlayUI();
});

// Leaving the page: give the tab's audio session back. iOS keeps its type across pages,
// and a "playback" left behind kept the Tuner's microphone from starting.
window.addEventListener("pagehide", () => {
  if (playing) stopPlayback();
  if (playCtx) playCtx.close().catch(() => {});
  playCtx = null;
  try { if (navigator.audioSession) navigator.audioSession.type = "auto"; } catch {}
});

document.addEventListener("visibilitychange", async () => {
  if (document.hidden && playing) stopPlayback();
  if (document.hidden && recording) {
    await stopRecording();
    statusEl.textContent = "auto-stopped (backgrounded)";
  }
});

// Drag to scroll through the take; tap to move the play cursor.
let drag = null;
canvas.addEventListener("pointerdown", (e) => {
  if (recording || !frames.length) return;
  drag = { x: e.clientX, scroll: scrollT, moved: false };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  if (Math.abs(dx) > 3) drag.moved = true;
  scrollT = drag.scroll - dx / PX_PER_SEC;
  render();
});
canvas.addEventListener("pointerup", (e) => {
  const tap = drag && !drag.moved;
  drag = null;
  if (!tap) return;
  const x = e.clientX - canvas.getBoundingClientRect().left;
  cursorT = Math.max(0, Math.min(duration, scrollT + (x - GUTTER) / PX_PER_SEC));
  if (playing) startPlayback(cursorT);
  else render();
});
canvas.addEventListener("pointercancel", () => { drag = null; });
canvas.addEventListener("wheel", (e) => {
  if (recording || !frames.length) return;
  e.preventDefault();
  scrollT += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / PX_PER_SEC;
  render();
}, { passive: false });

accBtn.addEventListener("click", () => {
  useFlats = !useFlats;
  try { localStorage.setItem(ACC_KEY, useFlats ? "flat" : "sharp"); } catch {}
  accBtn.textContent = useFlats ? "♭ → ♯" : "♯ → ♭";
  renderTranscript();
  if (recording) updateLive();
  else showTakeResult();
  render();
});
accBtn.textContent = useFlats ? "♭ → ♯" : "♯ → ♭";

copyBtn.addEventListener("click", async () => {
  const text = segments
    .map((s) => `${noteName(s.note)} ${(s.end - s.start).toFixed(2)}s ${centsLabel(s.cents)}`)
    .join("\n");
  try {
    await navigator.clipboard.writeText(text);
    copyBtn.textContent = "Copied";
  } catch {
    copyBtn.textContent = "Copy failed";
  }
  setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
});

if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
  recBtn.disabled = true;
  statusEl.textContent = "no mic — use HTTPS";
}

renderTranscript();
render();

// Debug hook for automated tests / poking around in devtools.
window.resonateDebug = () => ({ voice, segments, frames, duration, playing, playhead, cursorT });
