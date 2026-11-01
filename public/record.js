// Record mode: capture a sung phrase and transcribe it into discrete notes.
// Self-contained on purpose — the tuner page (app.js) is untouched.

const canvas = document.getElementById("roll");
const ctx = canvas.getContext("2d");
const recBtn = document.getElementById("rec");
const statusEl = document.getElementById("status");
const liveNoteEl = document.getElementById("live-note");
const liveCentsEl = document.getElementById("live-cents");
const timerEl = document.getElementById("timer");
const transcriptEl = document.getElementById("transcript");
const noteCountEl = document.getElementById("note-count");
const copyBtn = document.getElementById("copy");
const accBtn = document.getElementById("accidentals");

// --- Tunables -------------------------------------------------------------
const MIN_RMS = 0.012;      // loudness gate (same as tuner)
const MIN_CLARITY = 0.8;    // YIN clarity gate (same as tuner)
const MIN_FREQ = 50;
const MAX_FREQ = 1100;
const SMOOTH_MS = 100;      // median window for the live pitch used to segment
const SPLIT_MS = 80;        // pitch must sit >50¢ off the current note this long to start a new note
const GAP_MS = 70;          // unvoiced gap this long ends the current note
const TAIL_SAMPLES = 1024;  // voicing gate looks at only the newest ~21 ms, so gaps between repeated notes register
const MIN_NOTE_MS = 80;     // shorter notes are dropped as glitches
const PX_PER_SEC = 110;     // horizontal zoom of the piano roll
const GUTTER = 38;          // left gutter for note labels (CSS px)

const SHARPS = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const FLATS = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
const BLACK = new Set([1, 3, 6, 8, 10]);
const ACC_KEY = "resonate.accidentals";

let useFlats = false;
try { useFlats = localStorage.getItem(ACC_KEY) === "flat"; } catch {}

function noteName(midi) {
  const names = useFlats ? FLATS : SHARPS;
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

// --- Audio state ------------------------------------------------------------
let audioCtx = null;
let analyser = null;
let source = null;
let stream = null;
let floatBuf = null;
let yinBuf = null;
let minTau = 0;
let maxTau = 0;
let rafId = null;
let wakeLock = null;
let recording = false;
let t0 = 0; // performance.now() at record start

// --- Take state ---------------------------------------------------------------
let frames = [];   // { t (s), midi | null }
let segments = []; // finished notes: { start, end, note, cents, samples }
let cur = null;    // note in progress
let pend = null;   // candidate new pitch while waiting out SPLIT_MS
let smooth = [];   // recent voiced { t, midi } for the live median
let lastVoiced = -Infinity;
let liveMidi = null;
let duration = 0;

// --- View state ---------------------------------------------------------------
let rangeLo = 48; // C3
let rangeHi = 72; // C5
let scrollT = 0;  // left edge (s) when reviewing
let hasPitch = false; // range snaps around the first detected pitch
let selected = -1;

// YIN pitch detection — same algorithm and settings as the tuner (app.js).
function detectPitch(buf, sampleRate) {
  const halfN = buf.length - maxTau;
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < halfN; i++) {
      const d = buf[i] - buf[i + tau];
      sum += d * d;
    }
    yinBuf[tau] = sum;
  }
  yinBuf[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    running += yinBuf[tau];
    yinBuf[tau] = (yinBuf[tau] * tau) / (running || 1);
  }
  let tau = -1;
  for (let i = minTau; i <= maxTau; i++) {
    if (yinBuf[i] < 0.2) {
      while (i + 1 <= maxTau && yinBuf[i + 1] < yinBuf[i]) i++;
      tau = i;
      break;
    }
  }
  if (tau === -1) return null;
  let interp = tau;
  if (tau > 0 && tau < maxTau) {
    const s0 = yinBuf[tau - 1], s1 = yinBuf[tau], s2 = yinBuf[tau + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (Math.abs(denom) > 1e-9) interp = tau + (s2 - s0) / denom;
  }
  return { freq: sampleRate / interp, clarity: 1 - yinBuf[tau] };
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// --- Segmentation ---------------------------------------------------------------
// A note is a run of voiced frames whose smoothed pitch stays within 50¢ of
// the note's (median) pitch. It ends on an unvoiced gap ≥ GAP_MS, or when the
// smoothed pitch sits >50¢ away for SPLIT_MS — the new note then starts where
// the departure began.

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

// --- Rendering ---------------------------------------------------------------

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

  // Semitone rows.
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
    ctx.fillStyle = fill;
    ctx.strokeStyle = i === selected ? "#fff" : stroke;
    ctx.lineWidth = i === selected ? 2 : 1;
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
    const x = xOf(duration);
    ctx.fillStyle = "rgba(255,111,138,0.8)";
    ctx.fillRect(x, 0, 1.5, h);
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

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(1).padStart(4, "0")}`;
}

function centsLabel(c) {
  return `${c > 0 ? "+" : c < 0 ? "" : "±"}${c}¢`;
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
  copyBtn.disabled = recording || segments.length === 0;
  if (recording) transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function selectSegment(i) {
  if (recording) return;
  selected = selected === i ? -1 : i;
  if (selected >= 0) {
    const s = segments[i];
    const span = visibleSpan(canvas.getBoundingClientRect().width);
    scrollT = (s.start + s.end) / 2 - span / 2;
  }
  renderTranscript();
  render();
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

// --- Loop ---------------------------------------------------------------

function tick() {
  rafId = requestAnimationFrame(tick);
  if (!analyser) return;
  analyser.getFloatTimeDomainData(floatBuf);
  let sumSq = 0;
  for (let i = 0; i < floatBuf.length; i++) sumSq += floatBuf[i] * floatBuf[i];
  const rms = Math.sqrt(sumSq / floatBuf.length);
  let tailSq = 0;
  for (let i = floatBuf.length - TAIL_SAMPLES; i < floatBuf.length; i++) tailSq += floatBuf[i] * floatBuf[i];
  const tailRms = Math.sqrt(tailSq / TAIL_SAMPLES);
  const t = (performance.now() - t0) / 1000;
  duration = t;

  let midi = null;
  if (rms > MIN_RMS && tailRms > MIN_RMS) {
    const r = detectPitch(floatBuf, audioCtx.sampleRate);
    if (r && r.clarity > MIN_CLARITY && r.freq >= MIN_FREQ && r.freq <= MAX_FREQ) {
      midi = 69 + 12 * Math.log2(r.freq / 440);
    }
  }
  processFrame(t, midi);
  updateLive();
  render();
  statusEl.textContent = `${(20 * Math.log10(rms || 1e-6)).toFixed(0)} dB`;
}

async function startRecording() {
  try {
    recBtn.disabled = true;
    statusEl.textContent = "requesting mic…";
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") await audioCtx.resume();
    source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0;
    floatBuf = new Float32Array(analyser.fftSize);
    source.connect(analyser);
    minTau = Math.max(2, Math.floor(audioCtx.sampleRate / MAX_FREQ));
    maxTau = Math.min((analyser.fftSize >> 1) - 1, Math.floor(audioCtx.sampleRate / MIN_FREQ));
    yinBuf = new Float32Array(maxTau + 1);

    frames = [];
    segments = [];
    cur = null;
    pend = null;
    smooth = [];
    lastVoiced = -Infinity;
    liveMidi = null;
    duration = 0;
    selected = -1;
    rangeLo = 48;
    rangeHi = 72;
    hasPitch = false;
    t0 = performance.now();
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
  if (stream) stream.getTracks().forEach((t) => t.stop());
  if (source) try { source.disconnect(); } catch {}
  if (audioCtx) try { await audioCtx.close(); } catch {}
  audioCtx = analyser = source = stream = null;
  try { await wakeLock?.release(); } catch {}
  wakeLock = null;
  liveMidi = null;
  recBtn.textContent = segments.length ? "Record again" : "Record";
  recBtn.dataset.recording = "false";
  timerEl.dataset.rec = "false";
  statusEl.textContent = "idle";
  canvas.dataset.pannable = frames.length ? "true" : "false";
  // Start the review at the beginning of the take.
  scrollT = 0;
  updateLive();
  liveNoteEl.textContent = segments.length ? `${segments.length} notes` : "—";
  liveNoteEl.dataset.active = "false";
  renderTranscript();
  render();
}

recBtn.addEventListener("click", () => (recording ? stopRecording() : startRecording()));

document.addEventListener("visibilitychange", async () => {
  if (document.hidden && recording) {
    await stopRecording();
    statusEl.textContent = "auto-stopped (backgrounded)";
  }
});

// Drag to scroll through the take once it's stopped.
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
const endDrag = () => { drag = null; };
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
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
  updateLive();
  if (!recording && segments.length) liveNoteEl.textContent = `${segments.length} notes`;
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
  statusEl.textContent = "mic API unavailable — open over HTTPS";
}

renderTranscript();
render();
