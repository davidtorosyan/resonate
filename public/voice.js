// Voice profiles: create / rename / delete them, calibrate volume (like the Tuner's
// gear, in two guided steps), and measure the vocal range: the piano plays a note and
// you sing it back and hold it. From a note you pick as comfortable the test walks down
// by whole tones until you can't hold one (two tries), checks the semitone in between,
// then does the same going up. The lowest and highest notes held are your limits; the
// comfortable range starts a few notes inside them and can be adjusted by hand.

import { openMic, createReader, FFT_SIZE } from "./pitch.js?v=70";
import { loadPiano, holdPiano } from "./piano.js?v=70";
import { noteName, median } from "./music.js?v=70";
import { loadProfiles, createProfile, updateProfile, deleteProfile, setActiveProfile } from "./profiles.js?v=70";

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const msgEl = $("msg");
const testEl = $("test");
const tStep = $("t-step"), tTitle = $("t-title"), tText = $("t-text"), tTarget = $("t-target");
const tYou = $("t-you"), tHint = $("t-hint"), tLadder = $("t-ladder"), tMeter = $("t-meter").firstElementChild;
const tReplay = $("t-replay"), tLimit = $("t-limit"), tStop = $("t-stop");

// --- Tunables -------------------------------------------------------------------
const STEP = 2;            // semitones between test notes; the last one is checked by semitone
const LOWEST = 33;         // A1 (55 Hz): pitch detection stops at 50 Hz
const HIGHEST = 84;        // C6 (1047 Hz): …and at 1100 Hz
const NOTE_SEC = 1.2;      // the reference note (piano + held tone, as the Sing page's keys)
const REF_LEVEL = 2.0;     // ~6 dB above Listen; the loudest sample still peaks below −2 dBFS
const LISTEN_DELAY = 0.35; // s after it before listening (its fading tail isn't you)
const LISTEN_MAX = 6000;   // ms to find the note and hold it
const HOLD_MS = 800;       // on-pitch time that counts as holding it
const ON_CENTS = 50;
const SMOOTH_MS = 120;     // pitch = median of the last voiced frames
const ANCHOR_MS = 1200;    // a steady comfortable note this long starts the test
const PAUSE_MS = 700;      // ✓ / ✗ shown between notes
const VOL_HOLD_MS = 2000, VOL_MIN_DB = -50; // as the Tuner's calibration (app.js)

// Typical ranges (limits, comfortable), for starting without a test.
const PRESETS = {
  Bass: [40, 64, 43, 60],      // E2–E4, G2–C4
  Baritone: [43, 67, 45, 62],  // G2–G4, A2–D4
  Tenor: [48, 72, 50, 69],     // C3–C5, D3–A4
  Alto: [53, 77, 55, 72],      // F3–F5, G3–C5
  Mezzo: [57, 81, 59, 76],     // A3–A5, B3–E5
  Soprano: [60, 84, 62, 79],   // C4–C6, D4–G5
};

let run = null; // the test in progress (range or volume)

// ---------------------------------------------------------------------------
// Profiles

function current() {
  const p = loadProfiles();
  return p.list.find((x) => x.id === p.active) || null;
}

function showMsg(text, kind = "ok") {
  msgEl.textContent = text;
  msgEl.dataset.kind = kind;
}

function render() {
  const p = loadProfiles();
  const prof = current();
  $("create-card").hidden = !!prof;
  for (const id of ["profile-card", "range-card", "vol-card"]) $(id).hidden = !prof;
  if (!prof) return;
  const sel = $("profile-select");
  sel.textContent = "";
  for (const x of p.list) sel.add(new Option(x.name, x.id));
  sel.value = prof.id;
  renderRange(prof);
  renderVol(prof);
}

function renderVol(prof) {
  $("vol-text").textContent = prof.vol
    ? `Quiet ${Math.round(prof.vol.floor)} dB · loud ${Math.round(prof.vol.ceiling)} dB`
    : "Not calibrated";
  $("vol-btn").textContent = prof.vol ? "Calibrate again" : "Calibrate volume";
}

function renderRange(prof) {
  const r = prof.range;
  $("range-edit").hidden = !r;
  $("range-btn").textContent = r ? "Test again" : "Find my range";
  if (!r) {
    $("range-text").textContent =
      "Not measured · ~2 min, quiet room";
  } else {
    const when = r.at ? `Tested ${new Date(r.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "Preset";
    $("range-text").textContent = `${when} · tap a note to hear it`;
    for (const el of document.querySelectorAll(".stepper")) renderStepper(el, r);
  }
  renderStrip(r);
}

function renderStepper(el, r) {
  const k = el.dataset.k;
  el.textContent = "";
  const minus = document.createElement("button");
  const plus = document.createElement("button");
  const note = document.createElement("button");
  minus.type = plus.type = note.type = "button";
  minus.textContent = "−";
  plus.textContent = "+";
  minus.setAttribute("aria-label", `${k} down a semitone`);
  plus.setAttribute("aria-label", `${k} up a semitone`);
  note.className = "note mono";
  note.textContent = noteName(r[k]);
  note.title = "Hear this note";
  minus.addEventListener("click", () => nudge(k, -1));
  plus.addEventListener("click", () => nudge(k, 1));
  note.addEventListener("click", () => hear(r[k]));
  el.append(minus, note, plus);
}

// Keep low ≤ comfortLow < comfortHigh ≤ high.
function nudge(k, d) {
  const prof = current();
  if (!prof?.range) return;
  const r = { ...prof.range, [k]: prof.range[k] + d };
  if (r.low < 31 || r.high > 96 || r.low > r.comfortLow || r.comfortLow >= r.comfortHigh || r.comfortHigh > r.high) return;
  updateProfile(prof.id, { range: r });
  renderRange(current());
}

function renderStrip(r) {
  const strip = $("strip");
  strip.textContent = "";
  let lo = 36, hi = 84; // C2..C6, widened to whole octaves around the range
  if (r) {
    lo = Math.min(lo, Math.floor((r.low - 1) / 12) * 12);
    hi = Math.max(hi, Math.ceil((r.high + 1) / 12) * 12);
  }
  const x = (m) => `${((m - lo) / (hi - lo)) * 100}%`;
  for (let m = lo; m <= hi; m += 12) {
    const line = document.createElement("div");
    line.className = "line";
    line.style.left = x(m);
    const tick = document.createElement("div");
    tick.className = "tick mono";
    tick.style.left = x(m);
    tick.textContent = noteName(m);
    strip.append(line, tick);
  }
  if (!r) return;
  for (const [cls, a, b] of [["limits", r.low, r.high], ["comfy", r.comfortLow, r.comfortHigh]]) {
    const band = document.createElement("div");
    band.className = `band ${cls}`;
    band.style.left = x(a - 0.5);
    band.style.width = `${((b - a + 1) / (hi - lo)) * 100}%`;
    strip.append(band);
  }
}

// Play a note (outside a test).
let playCtx = null;
async function hear(midi) {
  try {
    if (run) return;
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
    if (!playCtx || playCtx.state === "closed") playCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (playCtx.state === "suspended") await playCtx.resume();
    const piano = await loadPiano(playCtx);
    const t = playCtx.currentTime + 0.03;
    holdPiano(playCtx, piano, t, midi, REF_LEVEL).release(t + NOTE_SEC);
  } catch (err) {
    console.warn(err);
  }
}

$("create-btn").addEventListener("click", () => {
  createProfile($("create-name").value);
  render();
  showMsg("");
});
$("create-name").addEventListener("keydown", (e) => { if (e.key === "Enter") $("create-btn").click(); });
$("profile-select").addEventListener("change", (e) => {
  setActiveProfile(e.target.value);
  render();
  showMsg("");
});
$("new-btn").addEventListener("click", () => {
  const name = prompt("New profile name:");
  if (name === null) return;
  createProfile(name);
  render();
  showMsg("");
});
$("rename-btn").addEventListener("click", () => {
  const prof = current();
  const name = prompt("Rename profile:", prof.name);
  if (!name?.trim()) return;
  updateProfile(prof.id, { name: name.trim() });
  render();
});
$("delete-btn").addEventListener("click", () => {
  const prof = current();
  if (!confirm(`Delete ${prof.name}'s profile?`)) return;
  deleteProfile(prof.id);
  render();
  showMsg("");
});
for (const [name, [low, high, comfortLow, comfortHigh]] of Object.entries(PRESETS)) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = name;
  b.title = `${noteName(low)}–${noteName(high)}, comfortable ${noteName(comfortLow)}–${noteName(comfortHigh)}`;
  b.addEventListener("click", () => {
    const prof = current();
    if (prof.range && !confirm(`Replace ${prof.name}'s range with ${name}?`)) return;
    updateProfile(prof.id, { range: { low, high, comfortLow, comfortHigh, at: null } });
    renderRange(current());
    showMsg("");
  });
  $("presets").append(b);
}

// ---------------------------------------------------------------------------
// Tests (range / volume): one mic session, one frame loop.

// iOS plays sound very quietly (through the earpiece, or ducked) while a page has the
// microphone open, and only goes back to the loudspeaker at full volume once capture
// stops and the audio session is "playback" again. So the range test only captures while
// you sing: before each reference note it stops the microphone and switches the session
// to playback, then reopens the microphone to listen (no new permission prompt within the
// page). Both of its audio contexts are created and started in the tap that begins the
// test, so they may run again later without a tap.
const MIC = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } };
const setSession = (type) => { try { if (navigator.audioSession) navigator.audioSession.type = type; } catch {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function newCtx() {
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  ac.resume().catch(() => {});
  return ac;
}

// Capture into the test's analyser; false if the test moved on meanwhile.
async function micOn(r, live) {
  setSession("play-and-record");
  const stream = await navigator.mediaDevices.getUserMedia(MIC);
  if (!live()) {
    stream.getTracks().forEach((t) => t.stop());
    return false;
  }
  if (r.micCtx.state !== "running") await Promise.race([r.micCtx.resume(), sleep(1000)]).catch(() => {});
  r.stream = stream;
  r.source = r.micCtx.createMediaStreamSource(stream);
  r.source.connect(r.analyser);
  return true;
}

function micOff(r) {
  r.stream?.getTracks().forEach((t) => t.stop());
  try { r.source?.disconnect(); } catch {}
  r.stream = r.source = null;
}

async function startRun(kind) {
  if (run) return;
  statusEl.textContent = "starting mic…";
  if (kind === "vol") {
    let mic;
    try {
      mic = await openMic(); // inside the tap (iOS)
    } catch (err) {
      statusEl.textContent = "idle";
      showMsg(`Couldn't open the microphone: ${err.message || err.name}`, "error");
      return;
    }
    run = { kind, mic, read: mic.read, raf: 0, lastT: 0, recent: [], phase: "", phaseT: performance.now() };
  } else {
    // Inside the tap: both contexts start now (playback first, then the microphone's).
    setSession("playback");
    const playCtx = newCtx();
    setSession("play-and-record");
    const micCtx = newCtx();
    const analyser = micCtx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0;
    const r = { kind, playCtx, micCtx, analyser, read: createReader(analyser, micCtx.sampleRate), stream: null, source: null,
      piano: null, note: null, seq: 0, raf: 0, lastT: 0, recent: [], phase: "starting", phaseT: performance.now() };
    run = r;
    const fail = async (text) => {
      if (run === r) await stopRun();
      showMsg(text, "error");
    };
    try {
      if (!(await micOn(r, () => run === r))) return;
    } catch (err) {
      return fail(`Couldn't open the microphone: ${err.message || err.name}`);
    }
    statusEl.textContent = "loading piano…";
    try { r.piano = await loadPiano(playCtx); } catch (err) {
      return fail("Couldn't load the piano sound.");
    }
    if (run !== r) return;
  }
  statusEl.textContent = "mic on";
  testEl.hidden = false;
  tLadder.textContent = "";
  tHint.textContent = "";
  if (kind === "range") beginAnchor();
  else beginVol("quiet");
  run.raf = requestAnimationFrame(loop);
}

async function stopRun() {
  const r = run;
  if (!r) return;
  run = null;
  cancelAnimationFrame(r.raf);
  testEl.hidden = true;
  statusEl.textContent = "idle";
  if (r.kind === "vol") return r.mic.close();
  r.note?.release();
  micOff(r);
  setSession("playback");
  for (const ac of [r.playCtx, r.micCtx]) try { await ac.close(); } catch {}
}

function loop() {
  if (!run) return;
  const now = performance.now();
  const dt = run.lastT ? Math.min(100, now - run.lastT) : 0;
  run.lastT = now;
  const fr = run.kind === "vol" || run.stream ? run.read() : null; // range: no mic while a note plays
  if (run.kind === "range") rangeFrame(fr, now, dt);
  else volFrame(fr, now, dt);
  if (run) run.raf = requestAnimationFrame(loop);
}

function setPhase(phase) {
  run.phase = phase;
  run.phaseT = performance.now();
}

function meter(f) {
  tMeter.style.width = `${Math.max(0, Math.min(1, f)) * 100}%`;
}

// Median pitch of the voiced frames in the last SMOOTH_MS (null when not singing).
function smoothed(fr, now) {
  const rec = run.recent;
  if (fr.midi !== null) rec.push({ t: now, m: fr.midi });
  while (rec.length && rec[0].t < now - SMOOTH_MS) rec.shift();
  return rec.length >= 3 ? median(rec.map((x) => x.m)) : null;
}

// --- Range --------------------------------------------------------------------

function beginAnchor() {
  setPhase("anchor");
  run.window = [];
  tStep.textContent = "Range test";
  tTitle.textContent = "Sing a comfortable note";
  tText.textContent = "On “ah” — hold it steady.";
  tTarget.textContent = "—";
  tTarget.dataset.state = "";
  tReplay.hidden = tLimit.hidden = true;
  meter(0);
}

function rangeFrame(fr, now, dt) {
  const sm = fr && run.phase !== "play" ? smoothed(fr, now) : null;
  if (run.phase === "anchor") {
    run.window.push({ t: now, m: sm });
    while (run.window[0].t < now - ANCHOR_MS) run.window.shift();
    tYou.textContent = sm === null ? "" : `you: ${noteName(Math.round(sm))}`;
    const voiced = run.window.filter((f) => f.m !== null).map((f) => f.m).sort((a, b) => a - b);
    const mid = voiced.length ? median(voiced) : null;
    const steady = mid === null ? 0 : run.window.filter((f) => f.m !== null && Math.abs(f.m - mid) <= 0.5).length;
    meter(Math.min(1, (now - run.phaseT) / ANCHOR_MS) * (steady / Math.max(1, run.window.length)));
    if (now - run.phaseT >= ANCHOR_MS && voiced.length >= 10 && steady >= 0.75 * run.window.length) {
      const a = Math.max(LOWEST + STEP, Math.min(HIGHEST - STEP, Math.round(mid)));
      run.anchor = a;
      run.best = { "-1": a, 1: a };
      run.dir = -1;
      run.retry = run.refining = false;
      addLadder(a, true);
      tReplay.hidden = tLimit.hidden = false;
      go(a - STEP);
    }
    return;
  }
  if (run.phase === "play") return; // playTarget moves on to "listen"
  if (run.phase === "listen") {
    if (sm !== null) {
      const c = Math.round((sm - run.target) * 100);
      tYou.textContent = `you: ${noteName(Math.round(sm))} ${c > 0 ? "+" : ""}${c}¢`;
      if (Math.abs(c) <= ON_CENTS) run.onMs += dt;
      const oct = Math.round((sm - run.target) / 12);
      tHint.textContent = oct && Math.abs(sm - run.target - 12 * oct) <= 0.5
        ? `An octave ${oct > 0 ? "high" : "low"} — match the piano`
        : run.retry ? "One more try" : "";
    } else {
      tYou.textContent = "";
    }
    meter(run.onMs / HOLD_MS);
    if (run.onMs >= HOLD_MS) result(true);
    else if (now - run.phaseT > LISTEN_MAX) result(false);
    return;
  }
  if (run.phase === "pause" && now - run.phaseT >= PAUSE_MS) next(run.lastOk);
}

function go(target) {
  run.target = target;
  const down = run.dir < 0;
  tStep.textContent = `Range test · going ${down ? "down" : "up"}`;
  tTitle.textContent = down ? "How low can you go?" : "How high can you go?";
  playTarget();
}

// Play the reference note with the microphone off (loud on phones, see above), then
// reopen it and listen. A later call (Hear it again, next note, Stop) supersedes this one.
async function playTarget() {
  const r = run;
  const token = ++r.seq;
  const live = () => run === r && r.seq === token;
  setPhase("play");
  r.note?.release();
  micOff(r);
  setSession("playback");
  tTarget.textContent = noteName(r.target);
  tTarget.dataset.state = "";
  tText.textContent = "Listen…";
  tYou.textContent = "";
  tHint.textContent = r.retry ? "One more try" : "";
  meter(0);
  await sleep(100); // let the output move back to the loudspeaker
  if (!live()) return;
  const ac = r.playCtx;
  if (ac.state !== "running") await Promise.race([ac.resume(), sleep(500)]).catch(() => {});
  const when = ac.currentTime + 0.03;
  r.note = holdPiano(ac, r.piano, when, r.target, REF_LEVEL);
  r.note.release(when + NOTE_SEC);
  await sleep((0.03 + NOTE_SEC + LISTEN_DELAY) * 1000);
  if (!live()) return;
  try {
    if (!(await micOn(r, live))) return;
  } catch (err) {
    await stopRun();
    return showMsg(`The microphone didn't reopen: ${err.message || err.name}`, "error");
  }
  setPhase("listen");
  r.recent = [];
  r.onMs = 0;
  tTarget.dataset.state = "listen";
  tText.textContent = "Now sing it and hold it.";
}

function result(ok) {
  addLadder(run.target, ok);
  run.lastOk = ok;
  tTarget.dataset.state = ok ? "ok" : "miss";
  tText.textContent = ok ? "Got it." : "Not this time.";
  setPhase("pause");
}

// Whole tones while you hold them; a missed note gets one more try; after two misses
// the semitone between it and the last note held is tried, then the direction ends.
function next(ok) {
  const d = run.dir, t = run.target;
  if (ok) {
    if ((t - run.best[d]) * d > 0) run.best[d] = t;
    if (run.refining) return endDirection();
    run.retry = false;
    const n = t + STEP * d;
    return n < LOWEST || n > HIGHEST ? endDirection() : go(n);
  }
  if (!run.retry && !run.refining) {
    run.retry = true;
    return go(t);
  }
  if (!run.refining && Math.abs(t - run.best[d]) === STEP) {
    run.refining = true;
    run.retry = false;
    return go(run.best[d] + d);
  }
  endDirection();
}

function endDirection() {
  if (run.dir < 0) {
    run.dir = 1;
    run.retry = run.refining = false;
    return go(Math.min(HIGHEST, run.anchor + STEP));
  }
  finishRange();
}

async function finishRange() {
  const low = run.best[-1], high = run.best[1];
  const span = high - low;
  // Comfortable: a few notes inside what you could just hold (~15% of the range each side).
  const pull = span >= 8 ? Math.max(2, Math.round(span * 0.15)) : Math.floor(span / 4);
  const range = { low, high, comfortLow: low + pull, comfortHigh: Math.max(low + pull + 1, high - pull), at: Date.now() };
  const prof = current();
  await stopRun();
  if (!prof) return;
  updateProfile(prof.id, { range });
  render();
  showMsg(`✓ Range ${noteName(low)}–${noteName(high)}`);
}

function addLadder(m, ok) {
  const s = document.createElement("span");
  s.textContent = noteName(m);
  s.dataset.ok = String(ok);
  tLadder.append(s);
}

// --- Volume -------------------------------------------------------------------

function beginVol(which) {
  setPhase(which);
  run.activeMs = 0;
  run.samples = [];
  tReplay.hidden = tLimit.hidden = true;
  tTarget.textContent = which === "quiet" ? "Quiet" : "Loud";
  tTarget.dataset.state = "";
  tStep.textContent = `Volume · ${which === "quiet" ? "1" : "2"} of 2`;
  tTitle.textContent = which === "quiet" ? "Your quietest" : "Your loudest";
  tText.textContent = which === "quiet"
    ? "Soft but steady, until the bar fills."
    : "Full voice, no shouting, until the bar fills.";
  meter(0);
}

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.max(0, Math.min(s.length - 1, Math.floor((s.length - 1) * p)))];
};

function volFrame(fr, now, dt) {
  tYou.textContent = `${fr.db.toFixed(1)} dB`;
  if (run.phase === "gap") {
    if (now - run.phaseT >= PAUSE_MS * 2) beginVol("loud");
    return;
  }
  if (fr.db > VOL_MIN_DB) {
    run.activeMs += dt;
    run.samples.push(fr.db);
  }
  meter(run.activeMs / VOL_HOLD_MS);
  if (run.activeMs < VOL_HOLD_MS) return;
  if (run.phase === "quiet") {
    run.quiet = pct(run.samples, 0.25);
    tText.textContent = "Got it.";
    setPhase("gap");
    return;
  }
  const floor = Math.min(run.quiet, pct(run.samples, 0.9));
  let ceiling = Math.max(run.quiet, pct(run.samples, 0.9));
  if (ceiling - floor < 6) ceiling = floor + 6; // keep a usable span (as the Tuner does)
  const prof = current();
  stopRun();
  if (!prof) return;
  updateProfile(prof.id, { vol: { floor, ceiling } });
  render();
  showMsg("✓ Volume saved");
}

// ---------------------------------------------------------------------------

$("range-btn").addEventListener("click", () => startRun("range"));
$("vol-btn").addEventListener("click", () => startRun("vol"));
tReplay.addEventListener("click", () => { if (run?.kind === "range" && !["anchor", "starting"].includes(run.phase)) playTarget(); });
tLimit.addEventListener("click", () => {
  if (run?.kind !== "range" || ["anchor", "starting"].includes(run.phase)) return;
  if (run.phase !== "pause") addLadder(run.target, false);
  endDirection();
});
tStop.addEventListener("click", () => {
  stopRun();
  showMsg("");
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && run) {
    stopRun();
    showMsg("Stopped (page hidden)", "error");
  }
});
// Leaving the page: stop a test and give the tab's audio session back. iOS keeps its type
// across pages, and a "playback" left behind kept the Tuner's microphone from starting.
window.addEventListener("pagehide", () => {
  if (run) stopRun();
  if (playCtx) playCtx.close().catch(() => {});
  playCtx = null;
  setSession("auto");
});
if (!navigator.mediaDevices?.getUserMedia) statusEl.textContent = "mic API unavailable — open over HTTPS";

render();
window.resonateDebug = () => ({ run: run && { kind: run.kind, phase: run.phase, target: run.target, dir: run.dir, best: run.best, anchor: run.anchor, mic: !!(run.stream || run.mic) }, profiles: loadProfiles() });
