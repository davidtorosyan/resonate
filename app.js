const canvas = document.getElementById("scope");
const button = document.getElementById("toggle");
const statusEl = document.getElementById("status");
const noteEl = document.getElementById("note");
const centsLabelEl = document.getElementById("cents-label");
const centsNeedleEl = document.getElementById("cents-needle");
const volumeFillEl = document.getElementById("volume-fill");
const volumeBarEl = document.getElementById("volume-bar");
const volumeRowEl = document.getElementById("volume-row");
const volumeSteadyEl = document.getElementById("volume-steady");
const volDbLoEl = document.getElementById("vol-db-lo");
const volDbHiEl = document.getElementById("vol-db-hi");
const volumeReadoutEl = document.getElementById("volume-readout");
const calModal = document.getElementById("calibrate-modal");
const calLowPad = document.getElementById("cal-low");
const calHighPad = document.getElementById("cal-high");
const calLowDbEl = document.getElementById("cal-low-db");
const calHighDbEl = document.getElementById("cal-high-db");
const calLiveEl = document.getElementById("cal-live");
const calClearBtn = document.getElementById("cal-clear");
const calCancelBtn = document.getElementById("cal-cancel");
const calConfirmBtn = document.getElementById("cal-confirm");
const ctx = canvas.getContext("2d");

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const PITCH_WINDOW_MS = 1500;
const SWITCH_WINDOW_MS = 300;
const SWITCH_DELAY_MS = 250;
const MIN_RMS = 0.012;
const MIN_CLARITY = 0.8;
const MIN_FREQ = 50;
const MAX_FREQ = 1100;

let lockedNote = null;
let offNoteSince = 0;

let audioCtx = null;
let analyser = null;
let source = null;
let stream = null;
let rafId = null;
let timeBuf = null;
let floatBuf = null;
let yinBuf = null;
let minTau = 0;
let maxTau = 0;

const pitchHistory = [];

const PEAK_HISTORY_MAX = 240;
const peakHistory = [];

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

const ro = new ResizeObserver(resize);
ro.observe(canvas);
resize();

function clearCanvas() {
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, rect.height / 2);
  ctx.lineTo(rect.width, rect.height / 2);
  ctx.stroke();
}

// YIN pitch detection (de Cheveigné & Kawahara, 2002).
// Reliable for monophonic pitch like singing.
function detectPitch(buf, sampleRate) {
  // Use as many samples as the largest lag allows. With fftSize 4096 and
  // maxTau ~870, this lets low pitches see ~3.7 cycles instead of ~2.3.
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

  const threshold = 0.2;
  let tau = -1;
  for (let i = minTau; i <= maxTau; i++) {
    if (yinBuf[i] < threshold) {
      while (i + 1 <= maxTau && yinBuf[i + 1] < yinBuf[i]) i++;
      tau = i;
      break;
    }
  }
  if (tau === -1) return null;

  let interp = tau;
  if (tau > 0 && tau < maxTau) {
    const s0 = yinBuf[tau - 1];
    const s1 = yinBuf[tau];
    const s2 = yinBuf[tau + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (Math.abs(denom) > 1e-9) interp = tau + (s2 - s0) / denom;
  }

  return { freq: sampleRate / interp, clarity: 1 - yinBuf[tau] };
}

function freqToMidi(freq) {
  return 69 + 12 * Math.log2(freq / 440);
}

function midiToNote(midi) {
  const rounded = Math.round(midi);
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  const cents = Math.round((midi - rounded) * 100);
  return { name, octave, cents };
}

function pushPitch(midi, time) {
  pitchHistory.push({ time, midi });
  const cutoff = time - PITCH_WINDOW_MS;
  while (pitchHistory.length && pitchHistory[0].time < cutoff) pitchHistory.shift();
}

function smoothedMidi() {
  if (pitchHistory.length < 5) return null;
  const sorted = pitchHistory.map((p) => p.midi).sort((a, b) => a - b);
  const n = sorted.length;
  return n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[n >> 1];
}

function recentMidi(now) {
  const cutoff = now - SWITCH_WINDOW_MS;
  const recent = [];
  for (let i = pitchHistory.length - 1; i >= 0; i--) {
    if (pitchHistory[i].time < cutoff) break;
    recent.push(pitchHistory[i].midi);
  }
  if (recent.length < 3) return null;
  recent.sort((a, b) => a - b);
  return recent[recent.length >> 1];
}

function updatePitchDisplay() {
  const now = performance.now();
  const longMidi = smoothedMidi();
  const shortMidi = recentMidi(now);

  if (longMidi === null) {
    noteEl.textContent = "—";
    noteEl.dataset.active = "false";
    noteEl.dataset.onnote = "true";
    centsLabelEl.textContent = "—";
    centsNeedleEl.style.left = "50%";
    centsNeedleEl.removeAttribute("data-tune");
    lockedNote = null;
    offNoteSince = 0;
    return;
  }

  if (lockedNote === null) lockedNote = Math.round(longMidi);

  if (shortMidi !== null) {
    const liveCents = (shortMidi - lockedNote) * 100;
    if (Math.abs(liveCents) > 50) {
      if (offNoteSince === 0) offNoteSince = now;
      if (now - offNoteSince > SWITCH_DELAY_MS) {
        lockedNote = Math.round(shortMidi);
        // Clear older history so the long-window median resets to the new note quickly.
        const cutoff = now - SWITCH_WINDOW_MS;
        let drop = 0;
        while (drop < pitchHistory.length && pitchHistory[drop].time < cutoff) drop++;
        pitchHistory.splice(0, drop);
        offNoteSince = 0;
      }
    } else {
      offNoteSince = 0;
    }
  }

  const stableMidi = smoothedMidi() ?? longMidi;
  const cents = Math.round((stableMidi - lockedNote) * 100);
  const isOnNote = shortMidi === null || Math.abs((shortMidi - lockedNote) * 100) <= 50;

  const name = NOTE_NAMES[((lockedNote % 12) + 12) % 12];
  const octave = Math.floor(lockedNote / 12) - 1;
  noteEl.textContent = `${name}${octave}`;
  noteEl.dataset.active = "true";
  noteEl.dataset.onnote = isOnNote ? "true" : "false";

  const sign = cents > 0 ? "+" : cents < 0 ? "" : "±";
  centsLabelEl.textContent = `${sign}${cents}¢`;
  const clamped = Math.max(-50, Math.min(50, cents));
  centsNeedleEl.style.left = `${50 + clamped}%`;
  const abs = Math.abs(cents);
  centsNeedleEl.dataset.tune = abs < 5 ? "good" : abs < 20 ? "ok" : "off";
}

// Wide default range so an uncalibrated meter rarely pins to either end.
// Calibration replaces these with values tailored to the singer.
const VOL_FLOOR_DEFAULT = -65;
const VOL_CEIL_DEFAULT = -5;
let VOL_FLOOR_DB = VOL_FLOOR_DEFAULT;
let VOL_CEIL_DB = VOL_CEIL_DEFAULT;

// Steady-volume readout: median of voiced loudness over this window.
const VOL_STEADY_MS = 2000;
const volHistory = [];
let isCalibrated = false;

const CAL_KEY = "resonate.volCal";
const CAL_HOLD_MS = 2000; // how long a pad must be held to lock in a level
const CAL_MIN_DB = -50;   // sound must exceed this for a held pad to fill

let calLowDb = null;
let calHighDb = null;
let calCapturing = null; // which pad is mid-capture: null | "low" | "high"
let calActiveMs = 0;     // time held with sound present — this drives the fill
let calLastTick = 0;
let calSamples = [];

try {
  const raw = localStorage.getItem(CAL_KEY);
  if (raw) {
    const cal = JSON.parse(raw);
    if (typeof cal.floor === "number" && typeof cal.ceiling === "number" && cal.ceiling > cal.floor) {
      VOL_FLOOR_DB = cal.floor;
      VOL_CEIL_DB = cal.ceiling;
      setCalibrated(true);
    }
  }
} catch {}

function calPercentile(arr, p) {
  if (arr.length === 0) return -60;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

// --- Volume calibration (one modal, hold-to-capture) --------------------
// Hold "Low" while sustaining your quietest sound and "High" for your
// loudest; each pad fills over CAL_HOLD_MS, then locks that level. Confirm
// saves the pair; Clear discards a stored calibration.

function renderCalPad(pad, dbEl, side, value) {
  const capturing = calCapturing === side;
  pad.dataset.state = capturing ? "capturing" : value !== null ? "done" : "empty";
  if (!capturing) pad.style.setProperty("--cal-progress", "0%");
  dbEl.textContent = capturing ? "…" : value !== null ? `${Math.round(value)} dB` : "— dB";
}

function renderCal() {
  renderCalPad(calLowPad, calLowDbEl, "low", calLowDb);
  renderCalPad(calHighPad, calHighDbEl, "high", calHighDb);
  calConfirmBtn.disabled = calLowDb === null || calHighDb === null;
}

function startCalCapture(side) {
  if (calCapturing || calModal.hidden) return;
  calCapturing = side;
  calActiveMs = 0;
  calLastTick = performance.now();
  calSamples = [];
  renderCal();
}

function finishCalCapture() {
  // Low pad -> quiet floor (low percentile); High pad -> loud ceiling.
  const value =
    calCapturing === "low"
      ? calPercentile(calSamples, 0.25)
      : calPercentile(calSamples, 0.9);
  if (calCapturing === "low") calLowDb = value;
  else calHighDb = value;
  calCapturing = null;
  calSamples = [];
  renderCal();
}

function cancelCalCapture() {
  if (!calCapturing) return;
  calCapturing = null;
  calSamples = [];
  renderCal();
}

// Called every frame while the modal is open; advances any held capture.
// The fill only grows while the pad is held AND sound is coming in — holding
// it in silence pauses the fill instead of running out the clock.
function tickCalibration(db, now) {
  calLiveEl.textContent = `${db.toFixed(1)} dB`;
  if (!calCapturing) return;
  const delta = Math.min(now - calLastTick, 100);
  calLastTick = now;
  if (db > CAL_MIN_DB) {
    calActiveMs += delta;
    calSamples.push(db);
  }
  const progress = Math.min(1, calActiveMs / CAL_HOLD_MS);
  const pad = calCapturing === "low" ? calLowPad : calHighPad;
  pad.style.setProperty("--cal-progress", `${progress * 100}%`);
  if (progress >= 1) finishCalCapture();
}

function openCalModal() {
  calCapturing = null;
  calSamples = [];
  // Pre-fill from the active calibration so the user can redo just one side.
  calLowDb = isCalibrated ? VOL_FLOOR_DB : null;
  calHighDb = isCalibrated ? VOL_CEIL_DB : null;
  calClearBtn.hidden = !isCalibrated;
  calLiveEl.textContent = "— dB";
  renderCal();
  calModal.hidden = false;
}

function closeCalModal() {
  cancelCalCapture();
  calModal.hidden = true;
}

function confirmCalibration() {
  if (calLowDb === null || calHighDb === null) return;
  const floor = Math.min(calLowDb, calHighDb);
  let ceiling = Math.max(calLowDb, calHighDb);
  if (ceiling - floor < 6) ceiling = floor + 6; // keep a usable span
  VOL_FLOOR_DB = floor;
  VOL_CEIL_DB = ceiling;
  setCalibrated(true);
  try {
    localStorage.setItem(CAL_KEY, JSON.stringify({ floor, ceiling }));
  } catch {}
  closeCalModal();
}

function updateVolumeMeter(db) {
  const range = VOL_CEIL_DB - VOL_FLOOR_DB;
  const pct = Math.max(0, Math.min(100, ((db - VOL_FLOOR_DB) / range) * 100));
  volumeFillEl.style.width = `${pct}%`;
  volumeBarEl.dataset.over = db > VOL_CEIL_DB ? "true" : "false";
}

// Map a loudness in dB onto the calibrated 1-10 scale (floor -> 1, ceiling -> 10).
function dbToLevel(db) {
  const range = VOL_CEIL_DB - VOL_FLOOR_DB;
  const t = Math.max(0, Math.min(1, (db - VOL_FLOOR_DB) / range));
  return 1 + t * 9;
}

// Calibrated meter reveals the 1-10 scale, tick marks, dB endpoints, and the
// steady-volume number; uncalibrated it's just a raw bar.
function setCalibrated(v) {
  isCalibrated = v;
  volumeRowEl.dataset.calibrated = v ? "true" : "false";
  if (v) {
    volDbLoEl.textContent = `${Math.round(VOL_FLOOR_DB)} dB`;
    volDbHiEl.textContent = `${Math.round(VOL_CEIL_DB)} dB`;
  }
}

// Discard the saved calibration and revert to the wide default range.
function clearCalibration() {
  try {
    localStorage.removeItem(CAL_KEY);
  } catch {}
  VOL_FLOOR_DB = VOL_FLOOR_DEFAULT;
  VOL_CEIL_DB = VOL_CEIL_DEFAULT;
  setCalibrated(false);
}

// "idle" dims the meter to show the mic isn't running; "live" while recording.
function setMeterState(state) {
  volumeRowEl.dataset.state = state;
}

// Steady volume — median of recent voiced loudness, like the locked-note logic
// for pitch. Only meaningful (and only shown) once calibrated.
function updateSteadyVolume() {
  if (!isCalibrated) return;
  if (volHistory.length < 8) {
    volumeSteadyEl.textContent = "—";
    return;
  }
  const sorted = volHistory.map((v) => v.db).sort((a, b) => a - b);
  const n = sorted.length;
  const medDb = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[n >> 1];
  volumeSteadyEl.textContent = dbToLevel(medDb).toFixed(0);
}

function draw() {
  rafId = requestAnimationFrame(draw);
  if (!analyser) return;

  analyser.getByteTimeDomainData(timeBuf);
  analyser.getFloatTimeDomainData(floatBuf);

  let sumSq = 0;
  for (let i = 0; i < floatBuf.length; i++) sumSq += floatBuf[i] * floatBuf[i];
  const rms = Math.sqrt(sumSq / floatBuf.length);
  const db = 20 * Math.log10(rms || 1e-6);

  const now = performance.now();
  if (!calModal.hidden) tickCalibration(db, now);

  if (rms > MIN_RMS) {
    volHistory.push({ time: now, db });
    const r = detectPitch(floatBuf, audioCtx.sampleRate);
    if (r && r.clarity > MIN_CLARITY && r.freq >= MIN_FREQ && r.freq <= MAX_FREQ) {
      pushPitch(freqToMidi(r.freq), now);
    }
  } else {
    const cutoff = now - PITCH_WINDOW_MS;
    while (pitchHistory.length && pitchHistory[0].time < cutoff) pitchHistory.shift();
  }
  while (volHistory.length && volHistory[0].time < now - VOL_STEADY_MS) volHistory.shift();
  updatePitchDisplay();
  updateVolumeMeter(db);
  updateSteadyVolume();

  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  const mid = h / 2;
  ctx.clearRect(0, 0, w, h);

  let framePeak = 0;
  for (let i = 0; i < floatBuf.length; i++) {
    const a = Math.abs(floatBuf[i]);
    if (a > framePeak) framePeak = a;
  }
  peakHistory.push(framePeak);
  if (peakHistory.length > PEAK_HISTORY_MAX) peakHistory.shift();

  const barWidth = 3;
  const stride = 6;
  const numBars = Math.max(1, Math.floor(w / stride));
  const offset = (w - (numBars - 1) * stride) / 2;
  const gain = 5.5;

  ctx.strokeStyle = "rgba(232,232,240,0.95)";
  ctx.lineCap = "round";
  ctx.lineWidth = barWidth;

  const startIdx = Math.max(0, peakHistory.length - numBars);
  for (let i = startIdx; i < peakHistory.length; i++) {
    const peak = peakHistory[i];
    const barH = Math.max(barWidth / 2, Math.tanh(peak * gain) * mid * 0.94);
    const x = offset + (i - startIdx) * stride;
    ctx.beginPath();
    ctx.moveTo(x, mid - barH);
    ctx.lineTo(x, mid + barH);
    ctx.stroke();
  }

  statusEl.textContent = `${audioCtx.sampleRate} Hz · ${db.toFixed(0)} dB`;
}

async function start() {
  try {
    button.disabled = true;
    statusEl.textContent = "requesting mic…";

    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") await audioCtx.resume();

    source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0;
    timeBuf = new Uint8Array(analyser.fftSize);
    floatBuf = new Float32Array(analyser.fftSize);
    source.connect(analyser);

    minTau = Math.max(2, Math.floor(audioCtx.sampleRate / MAX_FREQ));
    maxTau = Math.min((analyser.fftSize >> 1) - 1, Math.floor(audioCtx.sampleRate / MIN_FREQ));
    yinBuf = new Float32Array(maxTau + 1);

    pitchHistory.length = 0;
    peakHistory.length = 0;
    volHistory.length = 0;
    lockedNote = null;
    offNoteSince = 0;

    setMeterState("live");
    volumeSteadyEl.textContent = "—";
    button.textContent = "Stop";
    button.dataset.recording = "true";
    button.disabled = false;

    if (!rafId) draw();
  } catch (err) {
    button.disabled = false;
    statusEl.textContent = `mic error: ${err.name || err.message}`;
    console.error(err);
    await stop();
  }
}

async function stop() {
  closeCalModal();
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  if (source) try { source.disconnect(); } catch {}
  if (audioCtx) try { await audioCtx.close(); } catch {}
  audioCtx = null;
  analyser = null;
  source = null;
  stream = null;
  timeBuf = null;
  floatBuf = null;
  yinBuf = null;
  pitchHistory.length = 0;
  peakHistory.length = 0;
  volHistory.length = 0;
  lockedNote = null;
  offNoteSince = 0;
  button.textContent = "Start";
  button.dataset.recording = "false";
  statusEl.textContent = "idle";
  updatePitchDisplay();
  setMeterState("idle");
  volumeFillEl.style.width = "0%";
  volumeBarEl.dataset.over = "false";
  volumeSteadyEl.textContent = "—";
  clearCanvas();
}

button.addEventListener("click", () => {
  if (button.dataset.recording === "true") stop();
  else start();
});

// Auto-stop when the page is backgrounded — minimized, tab hidden, or the phone
// screen locked. Otherwise the mic keeps capturing while the app isn't visible.
document.addEventListener("visibilitychange", async () => {
  if (document.hidden && button.dataset.recording === "true") {
    await stop();
    statusEl.textContent = "auto-stopped (backgrounded)";
  }
});

// The volume readout (the "VOL" gear) is the calibration entry point.
volumeReadoutEl.addEventListener("click", async () => {
  if (button.dataset.recording !== "true") {
    await start();
    if (button.dataset.recording !== "true") return;
  }
  openCalModal();
});

for (const [pad, side] of [
  [calLowPad, "low"],
  [calHighPad, "high"],
]) {
  pad.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    startCalCapture(side);
  });
  pad.addEventListener("contextmenu", (e) => e.preventDefault());
}
// A capture ends when the pointer is released anywhere. If the pad already
// filled, finishCalCapture cleared calCapturing and this is a no-op.
document.addEventListener("pointerup", cancelCalCapture);
document.addEventListener("pointercancel", cancelCalCapture);

calConfirmBtn.addEventListener("click", confirmCalibration);
calCancelBtn.addEventListener("click", closeCalModal);
calClearBtn.addEventListener("click", () => {
  clearCalibration();
  // Reset the modal back to a blank capture, but leave it open.
  calCapturing = null;
  calSamples = [];
  calLowDb = null;
  calHighDb = null;
  calClearBtn.hidden = true;
  renderCal();
});

if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
  button.disabled = true;
  statusEl.textContent = "mic API unavailable — open over HTTPS";
}

clearCanvas();
updatePitchDisplay();
