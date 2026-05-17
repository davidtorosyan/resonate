const canvas = document.getElementById("scope");
const button = document.getElementById("toggle");
const statusEl = document.getElementById("status");
const noteEl = document.getElementById("note");
const centsLabelEl = document.getElementById("cents-label");
const centsNeedleEl = document.getElementById("cents-needle");
const volumeFillEl = document.getElementById("volume-fill");
const volumeBarEl = document.getElementById("volume-bar");
const calibrateBtn = document.getElementById("calibrate");
const calModal = document.getElementById("calibrate-modal");
const calTitle = document.getElementById("cal-title");
const calInstr = document.getElementById("cal-instructions");
const calReadout = document.getElementById("cal-readout");
const calAction = document.getElementById("cal-action");
const calCancel = document.getElementById("cal-cancel");
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

let VOL_FLOOR_DB = -50;
let VOL_CEIL_DB = -20;

const CAL_KEY = "resonate.volCal";
const CAL_CAPTURE_MS = 2500;
let calState = "idle"; // idle | await-quiet | capturing-quiet | await-loud | capturing-loud | done
let calSamples = [];
let calFloor = null;
let calCeiling = null;
let calTimer = null;

try {
  const raw = localStorage.getItem(CAL_KEY);
  if (raw) {
    const cal = JSON.parse(raw);
    if (typeof cal.floor === "number" && typeof cal.ceiling === "number" && cal.ceiling > cal.floor) {
      VOL_FLOOR_DB = cal.floor;
      VOL_CEIL_DB = cal.ceiling;
    }
  }
} catch {}

function setCalState(state) {
  calState = state;
  if (state === "idle") {
    calModal.hidden = true;
    calReadout.dataset.capturing = "false";
    return;
  }
  calModal.hidden = false;
  calReadout.dataset.capturing = state === "capturing-quiet" || state === "capturing-loud" ? "true" : "false";
  if (state === "await-quiet") {
    calTitle.textContent = "Calibrate · Step 1 of 2";
    calInstr.textContent = "Make your QUIETEST sustained sound, then tap Capture. We'll record for 2.5 seconds.";
    calAction.textContent = "Capture quietest";
    calAction.disabled = false;
  } else if (state === "capturing-quiet") {
    calInstr.textContent = "Hold your quiet sound…";
    calAction.textContent = "Capturing…";
    calAction.disabled = true;
  } else if (state === "await-loud") {
    calTitle.textContent = "Calibrate · Step 2 of 2";
    calInstr.textContent = "Now make your LOUDEST sustained sound, then tap Capture.";
    calAction.textContent = "Capture loudest";
    calAction.disabled = false;
  } else if (state === "capturing-loud") {
    calInstr.textContent = "Hold your loud sound…";
    calAction.textContent = "Capturing…";
    calAction.disabled = true;
  } else if (state === "done") {
    calTitle.textContent = "Calibrated";
    calInstr.textContent = `Floor: ${calFloor.toFixed(1)} dB · Ceiling: ${calCeiling.toFixed(1)} dB. Saved.`;
    calAction.textContent = "Done";
    calAction.disabled = false;
  }
}

function calPercentile(arr, p) {
  if (arr.length === 0) return -60;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

function startCalCapture(captureState, onDone) {
  calSamples = [];
  setCalState(captureState);
  if (calTimer) clearTimeout(calTimer);
  calTimer = setTimeout(() => {
    calTimer = null;
    onDone();
  }, CAL_CAPTURE_MS);
}

function updateVolumeMeter(db) {
  const range = VOL_CEIL_DB - VOL_FLOOR_DB;
  const pct = Math.max(0, Math.min(100, ((db - VOL_FLOOR_DB) / range) * 100));
  volumeFillEl.style.width = `${pct}%`;
  volumeBarEl.dataset.over = db > VOL_CEIL_DB ? "true" : "false";
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

  if (calState !== "idle") {
    calReadout.textContent = `${db.toFixed(1)} dB`;
    if (calState === "capturing-quiet" || calState === "capturing-loud") {
      calSamples.push(db);
    }
  }

  const now = performance.now();
  if (rms > MIN_RMS) {
    const r = detectPitch(floatBuf, audioCtx.sampleRate);
    if (r && r.clarity > MIN_CLARITY && r.freq >= MIN_FREQ && r.freq <= MAX_FREQ) {
      pushPitch(freqToMidi(r.freq), now);
    }
  } else {
    const cutoff = now - PITCH_WINDOW_MS;
    while (pitchHistory.length && pitchHistory[0].time < cutoff) pitchHistory.shift();
  }
  updatePitchDisplay();
  updateVolumeMeter(db);

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
    lockedNote = null;
    offNoteSince = 0;

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
  if (calTimer) {
    clearTimeout(calTimer);
    calTimer = null;
  }
  if (calState !== "idle") setCalState("idle");
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
  lockedNote = null;
  offNoteSince = 0;
  button.textContent = "Start";
  button.dataset.recording = "false";
  statusEl.textContent = "idle";
  updatePitchDisplay();
  updateVolumeMeter(0);
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

calibrateBtn.addEventListener("click", async () => {
  if (button.dataset.recording !== "true") {
    await start();
    if (button.dataset.recording !== "true") return;
  }
  calFloor = null;
  calCeiling = null;
  calReadout.textContent = "— dB";
  setCalState("await-quiet");
});

calCancel.addEventListener("click", () => {
  if (calTimer) {
    clearTimeout(calTimer);
    calTimer = null;
  }
  setCalState("idle");
});

calAction.addEventListener("click", () => {
  if (calState === "await-quiet") {
    startCalCapture("capturing-quiet", () => {
      calFloor = calPercentile(calSamples, 0.25);
      setCalState("await-loud");
    });
  } else if (calState === "await-loud") {
    startCalCapture("capturing-loud", () => {
      calCeiling = calPercentile(calSamples, 0.9);
      if (calCeiling - calFloor < 6) calCeiling = calFloor + 6;
      VOL_FLOOR_DB = calFloor;
      VOL_CEIL_DB = calCeiling;
      try {
        localStorage.setItem(CAL_KEY, JSON.stringify({ floor: calFloor, ceiling: calCeiling }));
      } catch {}
      setCalState("done");
    });
  } else if (calState === "done") {
    setCalState("idle");
  }
});

if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
  button.disabled = true;
  statusEl.textContent = "mic API unavailable — open over HTTPS";
}

clearCanvas();
updatePitchDisplay();
