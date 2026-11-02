// Record mode: capture a sung phrase and transcribe it into discrete notes.
// Self-contained on purpose — the tuner page (app.js) is untouched.
// With a song (MusicXML) loaded, the take is aligned to the score's melody
// (rhythm ignored, octave-tolerant) and each note is graded against it.

import { parseMusicXml, loadScoreFile, notesForVerse } from "./musicxml.js";
import { alignTake, fold } from "./align.js";

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
const songSelect = document.getElementById("song-select");
const verseSelect = document.getElementById("verse-select");
const keySelect = document.getElementById("key-select");
const fileInput = document.getElementById("file-input");
const tabsEl = document.getElementById("tabs");
const songErrEl = document.getElementById("song-error");
const playbarEl = document.getElementById("playbar");
const playBtn = document.getElementById("play");
const playModesEl = document.getElementById("play-modes");

const SAMPLES = { "amazing-grace": { title: "Amazing Grace", url: "songs/amazing-grace.musicxml" } };
const SONG_KEY = "resonate.song";       // selected song id
const CUSTOM_KEY = "resonate.customSong"; // parsed custom score (JSON)
const VERSE_KEY = "resonate.verse";
const KEYMODE_KEY = "resonate.keyMode";

// --- Song state ---------------------------------------------------------------
let score = null;     // parsed score
let targets = null;   // notes for the chosen verse
let alignment = null; // result of alignTake for the current take
let tab = "score";    // "score" | "notes" (bottom panel, when a song is loaded)

// --- Tunables -------------------------------------------------------------
const MIN_RMS = 0.012;      // loudness gate (same as tuner)
const MIN_CLARITY = 0.8;    // YIN clarity gate (same as tuner)
const MIN_FREQ = 50;
const MAX_FREQ = 1100;
const SMOOTH_MS = 100;      // median window for the live pitch used to segment
const SPLIT_MS = 80;        // pitch must sit >50¢ off the current note this long to start a new note
const GAP_MS = 70;          // unvoiced gap this long ends the current note
const TAIL_SAMPLES = 1024;  // voicing gate looks at only the newest ~21 ms, so gaps between repeated notes register
const MIN_NOTE_MS = 60;     // shorter notes are dropped as glitches (fast melisma notes come out ~80 ms)
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
let ctxT0 = 0; // audioCtx.currentTime at record start — the take's clock

// --- Take audio + playback ---------------------------------------------------------
const MAX_TAKE_SEC = 300;  // auto-stop (raw audio is ~11 MB/min)
const SYNTH_LAG = 0.05;    // detected notes trail the audio by ~half an analysis window
const PLAYMODE_KEY = "resonate.playMode";
let recNode = null, recSink = null, recChunks = [], recStart = null, recFlushed = null;
let voice = null;          // { data: Float32Array, sampleRate, start (take s), gain }
let playCtx = null;
let playNodes = [];
let playing = false;
let playT0 = 0, playFrom = 0, playRaf = null;
let playhead = null;       // take time being played, or null
let cursorT = 0;           // where Play starts
let playMode = "both";     // voice | notes | both | score
try { playMode = localStorage.getItem(PLAYMODE_KEY) || "both"; } catch {}

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
    realign();
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
  extra: ["rgba(255,255,255,0.1)", "rgba(255,255,255,0.35)"],
};

// With a song: colour a sung note by how it matched its score note.
function segStyle(i, s) {
  if (!alignment || s.live || i >= alignment.segTo.length) return { tune: tuneOf(s.cents) };
  const j = alignment.segTo[i];
  if (j < 0) return { tune: "extra" };
  const r = alignment.notes[j];
  return { tune: r.status === "unsung" || r.status === "missed" ? "extra" : r.status, j, r, first: r.segs[0] === i };
}

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
    const st = segStyle(i, s);
    const [fill, stroke] = TUNE_COLORS[st.tune];
    const y = yOf(s.note);
    // Missed pitch: dashed ghost where the score note was (in the sung octave).
    if (st.r && st.r.status === "off" && st.r.main === i) {
      const gm = targets[st.j].midi + alignment.transpose + 12 * st.r.octave;
      if (gm >= rangeLo && gm <= rangeHi) {
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = "rgba(255,255,255,0.75)";
        ctx.lineWidth = 1.2;
        roundRect(x0, yOf(gm) - barH / 2, Math.max(2, x1 - x0), barH, Math.min(5, barH / 2));
        ctx.stroke();
        ctx.restore();
      }
    }
    // Lyric syllable above the bar.
    if (st.r && st.first) {
      const syl = sylLabel(targets[st.j]);
      if (syl) {
        ctx.save();
        ctx.font = "italic 600 12px system-ui, sans-serif";
        ctx.fillStyle = "rgba(255,230,160,0.95)";
        ctx.textBaseline = "bottom";
        ctx.fillText(syl, x0, y - barH / 2 - 2);
        ctx.restore();
      }
    }
    ctx.fillStyle = fill;
    const active = playhead !== null && !s.live && s.start - SYNTH_LAG <= playhead && playhead < s.end - SYNTH_LAG;
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
    const x = xOf(duration);
    ctx.fillStyle = "rgba(255,111,138,0.8)";
    ctx.fillRect(x, 0, 1.5, h);
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

function sylLabel(tn) {
  if (tn.melisma) return "";
  return tn.syllabic === "begin" || tn.syllabic === "middle" ? `${tn.text}-` : tn.text;
}

// Pitch to show for a score note: written pitch, shifted if "any key" moved it.
function targetMidi(j) {
  return targets[j].midi + (alignment ? alignment.transpose : 0);
}

function realign() {
  alignment = null;
  if (!targets || !segments.length) return;
  const sung = segments.map((s) => ({ midi: s.note + s.cents / 100, dur: s.end - s.start }));
  const anyKey = keySelect.value === "any";
  alignment = alignTake(sung, targets, { anyKey });
  // Sang in another key with "As written" on? Suggest switching.
  if (!anyKey) {
    const alt = alignTake(sung, targets, { anyKey: true });
    const hits = (a) => a.summary.good + a.summary.ok;
    if (alt.transpose !== 0 && hits(alt) >= hits(alignment) * 1.5 + 3) alignment.keyHint = alt.transpose;
  }
}

function renderTranscript() {
  tabsEl.hidden = !targets;
  for (const b of tabsEl.querySelectorAll("button")) b.dataset.active = b.dataset.tab === tab ? "true" : "false";
  if (targets && tab === "score") renderScoreChips();
  else renderNoteChips();
  copyBtn.disabled = recording || segments.length === 0;
  updatePlayUI();
}

function renderScoreChips() {
  transcriptEl.textContent = "";
  let focus = null;
  targets.forEach((tn, j) => {
    if (tn.restBefore && j > 0) {
      const br = document.createElement("span");
      br.className = "phrase-break";
      transcriptEl.appendChild(br);
    }
    const r = alignment ? alignment.notes[j] : null;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "note-chip score-chip mono";
    b.dataset.tune = r ? r.status : "pending";
    b.dataset.selected = r && r.segs.includes(selected) ? "true" : "false";
    b.innerHTML = `<i></i><b></b><small></small>`;
    b.querySelector("i").textContent = tn.melisma ? "‿" : sylLabel(tn);
    b.querySelector("b").textContent = noteName(targetMidi(j));
    let res = "";
    if (r && (r.status === "good" || r.status === "ok")) res = `✓ ${centsLabel(Math.round(r.dev * 100))}`;
    else if (r && r.status === "off") res = noteName(Math.round(r.sungMidi));
    else if (r && r.status === "missed") res = "missed";
    if (r && r.octave && r.status !== "missed" && r.status !== "unsung") res += r.octave > 0 ? " ↑8" : " ↓8";
    b.querySelector("small").textContent = res || "\u00a0";
    if (r && r.segs.length) b.addEventListener("click", () => selectSegment(r.main ?? r.segs[0]));
    transcriptEl.appendChild(b);
    if (alignment && j === alignment.end) focus = b;
  });
  noteCountEl.textContent = alignment ? summaryText(alignment) : `${score.title.toUpperCase()} · ${targets.length} NOTES`;
  if (recording && focus) focus.scrollIntoView({ block: "nearest" });
}

function summaryText(a) {
  const s = a.summary;
  const hit = s.good + s.ok;
  let t = `${hit}/${s.total} ON PITCH`;
  if (s.off) t += ` · ${s.off} OFF`;
  if (s.missed) t += ` · ${s.missed} MISSED`;
  const k = (x) => (x > 6 ? `${x - 12}` : `+${x}`);
  if (a.transpose) t += ` · KEY ${k(a.transpose)}`;
  if (a.keyHint) t += ` · SOUNDS LIKE KEY ${k(a.keyHint)} — TRY "ANY KEY"`;
  return t;
}

function renderNoteChips() {
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

// Big readout after a take: score result with a song, else the note count.
function showTakeResult() {
  updateLive();
  if (alignment) {
    const s = alignment.summary;
    liveNoteEl.textContent = `${s.good + s.ok}/${s.total}`;
    liveNoteEl.dataset.active = "true";
    liveCentsEl.textContent = "on pitch";
  } else if (segments.length) {
    liveNoteEl.textContent = `${segments.length} notes`;
  }
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
  const t = audioCtx.currentTime - ctxT0;
  duration = t;
  if (t > MAX_TAKE_SEC) { stopRecording(); return; }

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
    stopPlayback();
    setAudioSession("play-and-record");
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
    await startCapture();

    frames = [];
    segments = [];
    cur = null;
    pend = null;
    smooth = [];
    lastVoiced = -Infinity;
    liveMidi = null;
    duration = 0;
    selected = -1;
    alignment = null;
    rangeLo = 48;
    rangeHi = 72;
    hasPitch = false;
    cursorT = 0;
    ctxT0 = audioCtx.currentTime;
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
  realign();
  await finishCapture();
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
  showTakeResult();
  renderTranscript();
  transcriptEl.scrollTop = 0;
  render();
}

recBtn.addEventListener("click", () => (recording ? stopRecording() : startRecording()));

document.addEventListener("visibilitychange", async () => {
  if (document.hidden && playing) stopPlayback();
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
canvas.addEventListener("pointerup", (e) => {
  const tap = drag && !drag.moved;
  drag = null;
  if (!tap) return;
  // Tap = move the play cursor there (and jump, if playing).
  const x = e.clientX - canvas.getBoundingClientRect().left;
  cursorT = Math.max(0, Math.min(duration, scrollT + (x - GUTTER) / PX_PER_SEC));
  if (playing) startPlayback(cursorT);
  else render();
});
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
  if (!recording) showTakeResult();
  render();
});
accBtn.textContent = useFlats ? "♭ → ♯" : "♯ → ♭";

copyBtn.addEventListener("click", async () => {
  const text = targets && tab === "score" && alignment
    ? targets
        .map((tn, j) => {
          const r = alignment.notes[j];
          if (r.status === "unsung") return null;
          const syl = tn.melisma ? "~" : sylLabel(tn);
          const res =
            r.status === "missed" ? "missed"
            : r.status === "off" ? `sang ${noteName(Math.round(r.sungMidi))}`
            : `ok ${centsLabel(Math.round(r.dev * 100))}`;
          return `${syl}\t${noteName(targetMidi(j))}\t${res}`;
        })
        .filter(Boolean)
        .join("\n")
    : segments
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

// --- Take capture ---------------------------------------------------------------

function setAudioSession(type) {
  // iOS: "playback" plays through the speaker even with the silent switch on.
  try { if (navigator.audioSession) navigator.audioSession.type = type; } catch {}
}

async function startCapture() {
  voice = null;
  recChunks = [];
  recStart = null;
  try {
    await audioCtx.audioWorklet.addModule("recorder-worklet.js");
    recNode = new AudioWorkletNode(audioCtx, "pcm-recorder");
    recSink = audioCtx.createGain();
    recSink.gain.value = 0; // keep the node pulled without hearing yourself
    source.connect(recNode);
    recNode.connect(recSink);
    recSink.connect(audioCtx.destination);
    recNode.port.onmessage = (e) => {
      const d = e.data;
      if (d instanceof Float32Array) recChunks.push(d);
      else if (d.start !== undefined) recStart = d.start;
      else if (d.done && recFlushed) recFlushed();
    };
  } catch (err) {
    console.warn("Take audio capture unavailable — playback will be notes only", err);
    recNode = recSink = null;
  }
}

async function finishCapture() {
  if (!recNode) return;
  await new Promise((res) => {
    recFlushed = res;
    recNode.port.postMessage("flush");
    setTimeout(res, 400);
  });
  recFlushed = null;
  try { recNode.disconnect(); recSink.disconnect(); } catch {}
  recNode = recSink = null;
  const len = recChunks.reduce((a, c) => a + c.length, 0);
  if (!len || recStart === null) { recChunks = []; return; }
  const data = new Float32Array(len);
  let o = 0;
  for (const c of recChunks) { data.set(c, o); o += c.length; }
  recChunks = [];
  let peak = 0;
  for (let i = 0; i < len; i++) { const a = Math.abs(data[i]); if (a > peak) peak = a; }
  voice = { data, sampleRate: audioCtx.sampleRate, start: recStart - ctxT0, gain: peak > 0 ? Math.min(8, 0.9 / peak) : 1 };
}

// --- Playback ---------------------------------------------------------------
// voice = the recording; notes = a piano note per detected note; both = voice + notes;
// score = voice + the score's correct notes on your timing (needs a song).

function midiToFreq(m) {
  return 440 * 2 ** ((m - 69) / 12);
}

function synthNotes(mode) {
  if (mode !== "score") return segments.map((s) => ({ start: s.start, end: s.end, midi: s.note }));
  if (!alignment) return [];
  const out = [];
  segments.forEach((s, i) => {
    const j = alignment.segTo[i];
    if (j < 0 || alignment.notes[j].status === "unsung") return;
    const target = targets[j].midi + alignment.transpose;
    const raw = s.note + s.cents / 100 - target;
    out.push({ start: s.start, end: s.end, midi: target + 12 * Math.round((raw - fold(raw)) / 12) });
  });
  return out;
}

// Piano: Salamander Grand Piano samples (CC-BY 3.0, see piano/README.md),
// one every minor third from A1 to C7; each note uses the nearest sample,
// pitch-shifted by playbackRate (≤ 1.5 semitones, inaudible as a shift).
const PIANO_SAMPLES = ["A1", ...[2, 3, 4, 5, 6].flatMap((o) => ["C", "Ds", "Fs", "A"].map((n) => n + o)), "C7"];
const PIANO_ONSET = 0.012; // samples start ~12 ms in (recording + encoder delay)
const PIANO_RELEASE = 0.12; // damper time constant when a note ends
let piano = null; // { ac, keys: [midi], buffers: Map<midi, AudioBuffer> }
let pianoLoading = null;

function sampleMidi(name) {
  const pc = { C: 0, Ds: 3, Fs: 6, A: 9 }[name.slice(0, -1)];
  return (Number(name.slice(-1)) + 1) * 12 + pc;
}

function loadPiano(ac) {
  if (piano && piano.ac === ac) return Promise.resolve(piano);
  if (pianoLoading) return pianoLoading;
  pianoLoading = Promise.all(
    PIANO_SAMPLES.map(async (name) => {
      const res = await fetch(`piano/${name}.mp3`);
      if (!res.ok) throw new Error(`piano sample ${name}: ${res.status}`);
      return [sampleMidi(name), await ac.decodeAudioData(await res.arrayBuffer())];
    }),
  )
    .then((entries) => {
      piano = { ac, keys: entries.map((e) => e[0]).sort((a, b) => a - b), buffers: new Map(entries) };
      return piano;
    })
    .finally(() => { pianoLoading = null; });
  return pianoLoading;
}

function playPiano(ac, when, dur, midi, level) {
  let key = piano.keys[0];
  for (const k of piano.keys) if (Math.abs(k - midi) < Math.abs(key - midi)) key = k;
  const src = ac.createBufferSource();
  src.buffer = piano.buffers.get(key);
  src.playbackRate.value = 2 ** ((midi - key) / 12);
  const g = ac.createGain();
  const end = when + Math.max(0.12, dur);
  g.gain.setValueAtTime(level, when);
  g.gain.setTargetAtTime(0, end, PIANO_RELEASE);
  src.connect(g);
  g.connect(ac.destination);
  src.start(when, PIANO_ONSET);
  src.stop(end + PIANO_RELEASE * 6);
  playNodes.push(src);
}

// Fallback if the piano samples can't load.
function playTone(ac, when, dur, midi, level) {
  const f = midiToFreq(midi);
  const o1 = ac.createOscillator();
  o1.type = "triangle";
  o1.frequency.value = f;
  const o2 = ac.createOscillator();
  o2.type = "sine";
  o2.frequency.value = f * 2;
  const g2 = ac.createGain();
  g2.gain.value = 0.2;
  const g = ac.createGain();
  const a = 0.015, r = 0.06, hold = Math.max(a, dur);
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(level, when + a);
  g.gain.setValueAtTime(level, when + hold);
  g.gain.linearRampToValueAtTime(0, when + hold + r);
  o1.connect(g);
  o2.connect(g2);
  g2.connect(g);
  g.connect(ac.destination);
  o1.start(when);
  o2.start(when);
  o1.stop(when + hold + r + 0.02);
  o2.stop(when + hold + r + 0.02);
  playNodes.push(o1, o2);
}

function effectiveMode() {
  let m = playMode;
  if (m === "score" && !alignment) m = "both";
  if (!voice && m !== "notes") m = "notes";
  return m;
}

async function startPlayback(from) {
  stopPlayback();
  if (recording || (!voice && !segments.length)) return;
  setAudioSession("playback");
  if (!playCtx || playCtx.state === "closed") playCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (playCtx.state === "suspended") await playCtx.resume();
  const ac = playCtx;
  const mode = effectiveMode();
  let usePiano = false;
  if (mode !== "voice") {
    try {
      if (!piano || piano.ac !== ac) {
        playBtn.textContent = "Loading…";
        playBtn.disabled = true;
      }
      await loadPiano(ac);
      usePiano = true;
    } catch (err) {
      console.warn("Piano samples unavailable, using a plain tone", err);
    } finally {
      playBtn.disabled = false;
    }
    if (playing) return; // another play started while loading
  }
  from = Math.max(0, Math.min(from, duration));
  if (from >= duration - 0.05) from = 0;
  const start = ac.currentTime + 0.08;

  const withVoice = mode !== "notes";
  if (withVoice) {
    const buf = ac.createBuffer(1, voice.data.length, voice.sampleRate);
    buf.copyToChannel(voice.data, 0);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const g = ac.createGain();
    g.gain.value = voice.gain;
    src.connect(g);
    g.connect(ac.destination);
    const off = from - voice.start;
    if (off >= 0) src.start(start, off);
    else src.start(start - off);
    playNodes.push(src);
  }
  if (mode !== "voice") {
    const level = usePiano ? (withVoice ? 0.9 : 1.6) : withVoice ? 0.16 : 0.3;
    const note = usePiano ? playPiano : playTone;
    for (const n of synthNotes(mode === "score" ? "score" : "notes")) {
      const s0 = n.start - SYNTH_LAG, e0 = n.end - SYNTH_LAG;
      if (e0 <= from) continue;
      const st = Math.max(s0, from);
      note(ac, start + (st - from), e0 - st, n.midi, level);
    }
  }

  playing = true;
  playFrom = from;
  playT0 = start;
  playhead = from;
  updatePlayUI();
  const loop = () => {
    if (!playing) return;
    playhead = playFrom + Math.max(0, ac.currentTime - playT0);
    if (playhead >= duration + 0.15) {
      stopPlayback();
      return;
    }
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

// While playing, the big readout shows the note under the playhead.
function showPlayingNote() {
  timerEl.textContent = formatTime(playhead);
  const i = segments.findIndex((s) => s.start - SYNTH_LAG <= playhead && playhead < s.end - SYNTH_LAG);
  if (i < 0) {
    liveNoteEl.textContent = "—";
    liveNoteEl.dataset.active = "false";
    liveCentsEl.textContent = "";
    return;
  }
  const s = segments[i];
  liveNoteEl.textContent = noteName(s.note);
  liveNoteEl.dataset.active = "true";
  const j = alignment ? alignment.segTo[i] : -1;
  liveCentsEl.textContent = j >= 0 && targets[j] && !targets[j].melisma ? `“${targets[j].text}” ${centsLabel(s.cents)}` : centsLabel(s.cents);
}

function updatePlayUI() {
  playbarEl.hidden = recording || (!voice && !segments.length);
  playBtn.textContent = playing ? "■ Stop" : "▶ Play";
  playBtn.dataset.playing = playing ? "true" : "false";
  const mode = effectiveMode();
  for (const b of playModesEl.querySelectorAll("button")) {
    const m = b.dataset.mode;
    b.hidden = m === "score" && !alignment;
    b.disabled = m !== "notes" && !voice;
    b.dataset.active = m === mode ? "true" : "false";
  }
}

playBtn.addEventListener("click", () => (playing ? stopPlayback() : startPlayback(cursorT)));
playModesEl.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-mode]");
  if (!b || b.disabled) return;
  playMode = b.dataset.mode;
  try { localStorage.setItem(PLAYMODE_KEY, playMode); } catch {}
  if (playing) startPlayback(playhead);
  else updatePlayUI();
});

// --- Song selection ---------------------------------------------------------------

function store(key, val) {
  try { val === null ? localStorage.removeItem(key) : localStorage.setItem(key, val); } catch {}
}
function recall(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function setScore(sc) {
  score = sc;
  songErrEl.hidden = true;
  if (!sc) {
    targets = null;
    alignment = null;
    verseSelect.hidden = true;
    keySelect.hidden = true;
    if (!recording) showTakeResult();
    renderTranscript();
    render();
    return;
  }
  verseSelect.textContent = "";
  for (const v of sc.verses) verseSelect.add(new Option(`Verse ${v}`, v));
  const saved = recall(VERSE_KEY);
  if (saved && sc.verses.includes(saved)) verseSelect.value = saved;
  verseSelect.hidden = sc.verses.length < 2;
  keySelect.hidden = false;
  // Spell notes the way the score's key signature does.
  if (sc.fifths !== 0) {
    useFlats = sc.fifths < 0;
    accBtn.textContent = useFlats ? "♭ → ♯" : "♯ → ♭";
  }
  applyVerse();
}

function applyVerse() {
  targets = notesForVerse(score, verseSelect.value || score.verses[0] || "1");
  tab = "score";
  realign();
  if (!recording) showTakeResult();
  renderTranscript();
  render();
}

function setCustomOption(title) {
  let opt = songSelect.querySelector('option[value="custom"]');
  if (!opt) {
    opt = new Option("", "custom");
    songSelect.insertBefore(opt, songSelect.querySelector('option[value="load"]'));
  }
  opt.textContent = title;
}

let songValue = "";
async function selectSong(id) {
  if (id === "load") {
    songSelect.value = songValue;
    fileInput.click();
    return;
  }
  songValue = id;
  songSelect.value = id;
  store(SONG_KEY, id);
  try {
    if (!id) return setScore(null);
    if (SAMPLES[id]) {
      const res = await fetch(SAMPLES[id].url);
      if (!res.ok) throw new Error(`couldn't load (${res.status})`);
      const sc = parseMusicXml(await res.text(), SAMPLES[id].title);
      sc.title = SAMPLES[id].title;
      return setScore(sc);
    }
    if (id === "custom") return setScore(JSON.parse(recall(CUSTOM_KEY)));
  } catch (err) {
    console.error(err);
    showSongError(err.message);
  }
}

function showSongError(msg) {
  songErrEl.textContent = `Couldn't load song: ${msg}`;
  songErrEl.hidden = false;
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  fileInput.value = "";
  if (!file) return;
  try {
    const sc = await loadScoreFile(file);
    store(CUSTOM_KEY, JSON.stringify(sc));
    setCustomOption(sc.title);
    store(VERSE_KEY, null);
    await selectSong("custom");
  } catch (err) {
    console.error(err);
    showSongError(err.message);
  }
});

songSelect.addEventListener("change", () => selectSong(songSelect.value));
verseSelect.addEventListener("change", () => {
  store(VERSE_KEY, verseSelect.value);
  applyVerse();
});
keySelect.addEventListener("change", () => {
  store(KEYMODE_KEY, keySelect.value);
  realign();
  if (!recording) showTakeResult();
  renderTranscript();
  render();
});
tabsEl.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (!b) return;
  tab = b.dataset.tab;
  renderTranscript();
});

keySelect.value = recall(KEYMODE_KEY) === "any" ? "any" : "written";
try {
  const custom = JSON.parse(recall(CUSTOM_KEY));
  if (custom?.title) setCustomOption(custom.title);
} catch {}
const savedSong = recall(SONG_KEY);
renderTranscript();
render();
selectSong(savedSong === null ? "amazing-grace" : savedSong === "custom" && !recall(CUSTOM_KEY) ? "" : savedSong);

// Debug hook for automated tests / poking around in devtools.
window.resonateDebug = () => ({ voice, segments, frames, duration, alignment, playing, playhead, cursorT });
