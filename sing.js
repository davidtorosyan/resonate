// Sing (karaoke) mode: the score sets the clock. Notes scroll toward a "now"
// line with their lyrics; after a count-in you sing along, and each score
// note is graded on the pitch you held during its own time slot (any octave).

import { parseMusicXml, readScoreFile, notesForVerse, lyricLines } from "./musicxml.js";
import { noteName as nameOf, BLACK, fold, median, centsLabel } from "./music.js";
import { openMic, ANALYSIS_LAG } from "./pitch.js";
import { startCapture, playVoice } from "./capture.js";
import { loadPiano, pianoReady, playPiano, playClick } from "./piano.js";
import { listSongs, getSong, addSong, removeSong, persistent } from "./library.js";

const $ = (id) => document.getElementById(id);
const canvas = $("lane");
const ctx = canvas.getContext("2d");
const statusEl = $("status");
const songSelect = $("song-select");
const verseSelect = $("verse-select");
const keySelect = $("key-select");
const tempoSelect = $("tempo-select");
const guideSelect = $("guide-select");
const fileInput = $("file-input");
const songMsgEl = $("song-msg");
const openFileBtn = $("open-file");
const openLinkBtn = $("open-link");
const removeBtn = $("remove-song");
const saveBtn = $("save-song");
const mySongsEl = $("my-songs");
const dropEl = $("drop");
const lyricNowEl = $("lyric-now");
const lyricNextEl = $("lyric-next");
const scorePctEl = $("score-pct");
const summaryEl = $("summary");
const playbarEl = $("playbar");
const playBtn = $("play");
const playModesEl = $("play-modes");
const chipsEl = $("chips");
const listenBtn = $("listen");
const singBtn = $("sing");

const SAMPLES = { "amazing-grace": { title: "Amazing Grace", url: "songs/amazing-grace.musicxml" } };
const K = {
  song: "resonate.sing.song",
  legacyXml: "resonate.sing.customXml",   // pre-library single custom song (migrated)
  legacyName: "resonate.sing.customName",
  verse: "resonate.sing.verse",
  transpose: "resonate.sing.transpose",
  rate: "resonate.sing.rate",
  guide: "resonate.sing.guide",
  playMode: "resonate.sing.playMode",
};
const RATES = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25];

// --- Tunables -------------------------------------------------------------
const PX_PER_SEC = 100;     // lane zoom
const NOW_FRAC = 0.3;       // where the "now" line sits across the lane
const GUTTER = 36;          // note-label gutter (CSS px)
const INPUT_LATENCY = 0.02; // mic → analyser, rough (not reported by browsers)
const GRACE_MAX = 0.12;     // ignore up to this much of each note's start (scoops, late entry)
const GRACE_FRAC = 0.25;    //   …or this fraction of the note, whichever is less
const MIN_VOICED = 0.35;    // voiced less than this share of the slot → "missed"
const GOOD_CENTS = 25;
const OK_CENTS = 50;
const END_PAD = 1.0;        // keep going this long after the last note

// --- Song state ---------------------------------------------------------------
let score = null;
let notes = [];    // { midi (transposed), t, d (s), text, syllabic, melisma, restBefore }
let lines = [];    // [[note index]]
let lineOf = [];   // note index → line index
let flats = false;
let songEnd = 0;   // s
let entryIdx = 0;  // measure where the singing starts (skips instrumental intros)
let entryT = 0;    // its start time (s) — count-in, lane and Listen start here
let range = { lo: 55, hi: 72 };

const store = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
const recall = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

let transpose = Number(recall(K.transpose)) || 0;
let rate = Number(recall(K.rate)) || 1;
let guide = recall(K.guide) || "click";
let playMode = recall(K.playMode) || "both";

// --- Session state (sing / listen / playback) ----------------------------------
let session = null; // { kind, ac, nodes, songT0, raf, mic?, capture?, latency? }
let take = null;    // { frames, grades, endT, voice, songT0, latency, octave }
let scrollT = 0;    // song time at the now-line when idle (also where Play/Listen start)
let nowT = 0;       // song time at the now-line (follows the session)
let shownLine = -1; // lyric line currently rendered
let lastChip = -1;  // chip marked as current

const noteName = (m) => nameOf(m, flats);

// ---------------------------------------------------------------------------
// Song loading

function secPerQuarter() {
  return 60 / (score.tempo * rate);
}

function applySong() {
  const verse = verseSelect.value || score.verses[0] || "1";
  const spq = secPerQuarter();
  notes = notesForVerse(score, verse).map((n) => ({
    midi: n.midi + transpose,
    t: n.onset * spq,
    d: n.dur * spq,
    text: n.text,
    syllabic: n.syllabic,
    melisma: n.melisma,
    restBefore: n.restBefore,
  }));
  lines = lyricLines(notesForVerse(score, verse));
  lineOf = [];
  lines.forEach((l, li) => l.forEach((i) => (lineOf[i] = li)));
  songEnd = notes.length ? Math.max(...notes.map((n) => n.t + n.d)) : 0;
  const mids = notes.map((n) => n.midi);
  range = { lo: Math.min(...mids) - 4, hi: Math.max(...mids) + 4 };
  // Spell notes like the (transposed) key signature.
  const f = (((score.fifths + 7 * transpose) % 12) + 12 + 6) % 12 - 6;
  flats = f < 0;
  fillTempoOptions();
  if (take && (take.transpose !== transpose || take.rate !== rate)) take = null; // grades no longer apply
  // Start at the bar containing the first note, not at bar 1 — songs with a
  // long piano intro would otherwise mean a long wait before singing.
  entryIdx = 0;
  if (notes.length) score.measures.forEach((m, i) => { if (m * spq <= notes[0].t + 1e-6) entryIdx = i; });
  entryT = (score.measures[entryIdx] ?? 0) * spq;
  shownLine = -1; // force the lyric line to redraw for the new song
  lastChip = -1;
  scrollT = entryT;
  renderAll();
}

function fillTempoOptions() {
  tempoSelect.textContent = "";
  for (const r of RATES) {
    const bpm = Math.round(score.tempo * r);
    tempoSelect.add(new Option(`♩=${bpm}${r === 1 ? "" : ` (${Math.round(r * 100)}%)`}`, String(r)));
  }
  tempoSelect.value = String(rate);
}

function setScore(sc) {
  score = sc;
  verseSelect.textContent = "";
  for (const v of sc.verses) verseSelect.add(new Option(`Verse ${v}`, v));
  const saved = recall(K.verse);
  if (saved && sc.verses.includes(saved)) verseSelect.value = saved;
  verseSelect.hidden = sc.verses.length < 2;
  take = null;
  applySong();
}

// id: a sample key, or a saved song's id (from library.js).
async function selectSong(id) {
  stopSession();
  songSelect.value = id;
  store(K.song, id);
  removeBtn.hidden = !!SAMPLES[id];
  try {
    if (SAMPLES[id]) {
      const res = await fetch(SAMPLES[id].url);
      if (!res.ok) throw new Error(`couldn't load (${res.status})`);
      const sc = parseMusicXml(await res.text(), SAMPLES[id].title);
      sc.title = SAMPLES[id].title;
      return setScore(sc);
    }
    const song = await getSong(id);
    if (!song) throw new Error("that song is no longer saved");
    return setScore(parseMusicXml(song.xml, song.title));
  } catch (err) {
    console.error(err);
    showMsg(`Couldn't load song: ${err.message}`, "error");
  }
}

function showMsg(text, kind = "info") {
  songMsgEl.textContent = text;
  songMsgEl.dataset.kind = kind;
  songMsgEl.hidden = !text;
}

async function refreshLibrary() {
  const songs = await listSongs();
  mySongsEl.textContent = "";
  for (const s of songs) mySongsEl.appendChild(new Option(s.title, s.id));
  mySongsEl.hidden = !songs.length;
}

// Validate, save to My songs, and switch to it.
async function importXml(xml, name) {
  const sc = parseMusicXml(xml, name);
  const id = await addSong(sc.title, xml);
  await refreshLibrary();
  store(K.verse, null);
  await selectSong(id);
  const notes = sc.notes.length;
  const bits = [`${notes} notes`, sc.verses.length ? `${sc.verses.length} verse${sc.verses.length > 1 ? "s" : ""}` : "no lyrics found — notes only"];
  if (!sc.tempoFromScore) bits.push(`no tempo in the file, using ♩=${sc.tempo}`);
  if (sc.partName) bits.push(`melody from “${sc.partName}”`);
  const kept = (await persistent()) ? "" : " (this browser won't keep it after reload)";
  showMsg(`Loaded “${sc.title}”: ${bits.join(", ")}.${kept}`, "ok");
}

// Explain the common wrong-format cases instead of a generic parse error.
function formatHint(name) {
  const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
  const hints = {
    mscz: "That's a MuseScore file — in MuseScore use File → Export → MusicXML, then open the .musicxml/.mxl.",
    mscx: "That's a MuseScore file — in MuseScore use File → Export → MusicXML, then open the .musicxml/.mxl.",
    mid: "MIDI files aren't supported (no lyrics) — export MusicXML from your notation app instead.",
    midi: "MIDI files aren't supported (no lyrics) — export MusicXML from your notation app instead.",
    pdf: "PDF sheet music can't be read — it needs MusicXML (.musicxml, .xml or .mxl).",
    sib: "That's a Sibelius file — export it as MusicXML first.",
    gp: "Guitar Pro files aren't supported — export MusicXML first.",
  };
  return hints[ext] || null;
}

async function importFile(file) {
  showMsg(`Opening “${file.name}”…`);
  try {
    const hint = formatHint(file.name);
    if (hint) throw new Error(hint);
    if (file.size > 20 * 1024 * 1024) throw new Error("file is over 20 MB — that's not a single song score");
    const xml = await readScoreFile(file);
    await importXml(xml, file.name);
  } catch (err) {
    console.error(err);
    showMsg(`Couldn't load “${file.name}”: ${err.message}`, "error");
  }
}

// GitHub page links → the raw file; Dropbox share links → direct download.
function normalizeLink(url) {
  const u = new URL(url);
  if (u.hostname === "github.com") {
    const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
    if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
  }
  if (u.hostname.endsWith("dropbox.com")) {
    u.searchParams.set("dl", "1");
    return u.toString();
  }
  return u.toString();
}

async function importLink() {
  const raw = prompt("Paste a link to a MusicXML file (.musicxml, .xml or .mxl):");
  if (!raw || !raw.trim()) return;
  let url;
  try {
    url = normalizeLink(raw.trim());
  } catch {
    showMsg("That doesn't look like a link.", "error");
    return;
  }
  const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "Linked song");
  showMsg(`Downloading ${name}…`);
  try {
    const hint = formatHint(name);
    if (hint) throw new Error(hint);
    let res;
    try {
      res = await fetch(url);
    } catch {
      throw new Error("that site doesn't let other pages download its files. Download the file to your device and use Open instead.");
    }
    if (!res.ok) throw new Error(`the link returned ${res.status}`);
    const blob = await res.blob();
    const xml = await readScoreFile(new File([blob], name));
    if (/^\s*<!doctype html|^\s*<html/i.test(xml)) throw new Error("the link is a web page, not a MusicXML file — use the site's direct download link.");
    await importXml(xml, name);
  } catch (err) {
    console.error(err);
    showMsg(`Couldn't load the link: ${err.message}`, "error");
  }
}

// ---------------------------------------------------------------------------
// Timeline helpers

function noteAt(t) {
  for (let i = 0; i < notes.length; i++) if (notes[i].t <= t && t < notes[i].t + notes[i].d) return i;
  return -1;
}

// The note being sung now, else the next one coming up.
function focusNote(t) {
  const i = noteAt(t);
  if (i >= 0) return i;
  for (let j = 0; j < notes.length; j++) if (notes[j].t > t) return j;
  return notes.length - 1;
}

function countInBeats() {
  const beatQ = 4 / score.beatType;
  const barQ = score.beats * beatQ;
  const firstQ = (score.measures[entryIdx + 1] ?? score.length) - score.measures[entryIdx];
  // Pickup bar: count a full bar, then the rest of the pickup bar's beats.
  const pickupFill = firstQ < barQ - 1e-6 ? Math.round((barQ - firstQ) / beatQ) : 0;
  return score.beats + pickupFill;
}

// Every beat of the song: [{ t (s), accent }]
function beatGrid() {
  const spq = secPerQuarter();
  const beatQ = 4 / score.beatType;
  const out = [];
  score.measures.forEach((m, i) => {
    const end = score.measures[i + 1] ?? score.length;
    for (let q = m; q < end - 1e-6; q += beatQ) out.push({ t: q * spq, accent: q === m && i > 0 });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Sing

async function startSing() {
  stopSession();
  take = null;
  showMsg("");
  singBtn.disabled = listenBtn.disabled = true;
  statusEl.textContent = "requesting mic…";
  let mic;
  try {
    mic = await openMic();
  } catch (err) {
    console.error(err);
    statusEl.textContent = `mic error: ${err.name || err.message}`;
    singBtn.disabled = listenBtn.disabled = false;
    return;
  }
  const ac = mic.ac;
  let piano = null;
  if (guide === "melody") {
    statusEl.textContent = "loading piano…";
    try { piano = await loadPiano(ac); } catch (err) { console.warn(err); }
  }
  const capture = await startCapture(ac, mic.source);
  let wakeLock = null;
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}

  const nodes = [];
  const beatSec = (4 / score.beatType) * secPerQuarter();
  const count = countInBeats();
  const t0 = ac.currentTime + 0.3;
  const songT0 = t0 + count * beatSec - entryT; // song time entryT sounds right after the count-in
  for (let k = 0; k < count; k++) playClick(ac, t0 + k * beatSec, k % score.beats === 0, nodes);
  if (guide === "click") for (const b of beatGrid()) if (b.t >= entryT - 1e-6) playClick(ac, songT0 + b.t, b.accent, nodes);
  if (piano) for (const n of notes) playPiano(ac, piano, songT0 + n.t, n.d, n.midi, 0.9, nodes);

  // The singer follows what they hear (output latency); the mic hears them
  // late (input latency); a pitch frame lags its audio (analysis window).
  const latency = (ac.outputLatency || ac.baseLatency || 0) + INPUT_LATENCY;
  take = { frames: [], grades: notes.map(() => null), endT: null, voice: null, songT0, latency, transpose, rate, octave: 0 };
  session = { kind: "sing", ac, nodes, songT0, latency, mic, capture, wakeLock, raf: null };
  singBtn.disabled = false;
  updateButtons();

  const loop = () => {
    if (!session || session.kind !== "sing") return;
    const songT = ac.currentTime - songT0;
    const r = mic.read();
    const ft = songT - ANALYSIS_LAG - latency;
    if (ft > entryT - 0.5) addFrame(ft, r.midi);
    gradeUpTo(ft);
    nowT = songT;
    statusEl.textContent = songT < entryT ? `count-in ${Math.min(count, Math.floor((songT - entryT + count * beatSec) / beatSec) + 1)}` : `${r.db.toFixed(0)} dB`;
    renderLive();
    if (songT > songEnd + END_PAD) { stopSing(); return; }
    session.raf = requestAnimationFrame(loop);
  };
  session.raf = requestAnimationFrame(loop);
}

// Store a frame; `disp` is the pitch shifted by octaves next to the melody
// so singing an octave off still overlays the notes.
function addFrame(t, midi) {
  const f = { t, midi, disp: null, ok: null };
  if (midi !== null) {
    const i = noteAt(t);
    const ref = i >= 0 ? notes[i].midi : take.lastDisp ?? (range.lo + range.hi) / 2;
    f.disp = midi + 12 * Math.round((ref - midi) / 12);
    take.lastDisp = f.disp;
    if (i >= 0) f.ok = Math.abs(fold(midi - notes[i].midi)) * 100 <= OK_CENTS;
  }
  take.frames.push(f);
}

// Grade every note whose slot has fully passed by frame time `t`.
function gradeUpTo(t, final = false) {
  notes.forEach((n, j) => {
    if (take.grades[j]) return;
    if (n.t + n.d <= t) take.grades[j] = gradeNote(j, n.t + n.d);
    else if (final) take.grades[j] = gradeNote(j, t);
    else return;
    const old = chipsEl.querySelectorAll(".chip")[j];
    if (old) old.replaceWith(makeChip(j));
  });
}

function gradeNote(j, until) {
  const n = notes[j];
  const from = n.t + Math.min(GRACE_MAX, GRACE_FRAC * n.d);
  const to = Math.min(n.t + n.d, until);
  const win = take.frames.filter((f) => f.t >= from && f.t < to);
  // Stopped before (most of) this note → not part of the take.
  if (to - from < 0.5 * (n.t + n.d - from) || win.length < 2) return { status: "unsung" };
  const voiced = win.filter((f) => f.midi !== null);
  if (voiced.length / win.length < MIN_VOICED) return { status: "missed", hit: 0 };
  const diffs = voiced.map((f) => f.midi - n.midi);
  const dev = median(diffs.map(fold));
  const raw = median(diffs);
  const octave = Math.round((raw - fold(raw)) / 12);
  const hit = voiced.filter((f) => Math.abs(fold(f.midi - n.midi)) * 100 <= OK_CENTS).length / win.length;
  const a = Math.abs(dev) * 100;
  const status = a <= GOOD_CENTS ? "good" : a <= OK_CENTS ? "ok" : "off";
  return { status, hit, dev, octave, sungMidi: n.midi + raw };
}

async function stopSing() {
  const s = session;
  if (!s || s.kind !== "sing") return;
  session = null;
  cancelAnimationFrame(s.raf);
  for (const n of s.nodes) try { n.stop(); } catch {}
  const endT = s.ac.currentTime - s.songT0 - ANALYSIS_LAG - s.latency;
  take.endT = endT;
  gradeUpTo(endT, true);
  const octs = take.grades.filter((g) => g && g.octave !== undefined).map((g) => g.octave);
  take.octave = octs.length ? Math.round(median(octs)) : 0;
  const v = await s.capture.finish();
  // Line the recording up with the score: shift by the recording latency.
  if (v) take.voice = { ...v, start: v.start - s.songT0 - s.latency };
  try { await s.wakeLock?.release(); } catch {}
  await s.mic.close();
  statusEl.textContent = "idle";
  scrollT = entryT;
  nowT = entryT;
  renderAll();
  chipsEl.scrollTop = 0;
}

// ---------------------------------------------------------------------------
// Listen / playback (score clock, no mic)

let playCtx = null;

async function getPlayCtx() {
  try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
  if (!playCtx || playCtx.state === "closed") playCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (playCtx.state === "suspended") await playCtx.resume();
  return playCtx;
}

// kind: "listen" (melody) or "playback" (per playMode).
async function startPlay(kind, from) {
  stopSession();
  const ac = await getPlayCtx();
  const end = kind === "playback" && take ? Math.max(take.endT ?? songEnd, 0) : songEnd;
  if (from >= end - 0.05 || from < entryT - 1) from = entryT;
  const wantMelody = kind === "listen" || playMode !== "voice" || !take?.voice;
  const wantVoice = kind === "playback" && take?.voice && playMode !== "melody";
  let piano = null;
  if (wantMelody) {
    if (!pianoReady(ac)) {
      statusEl.textContent = "loading piano…";
      (kind === "listen" ? listenBtn : playBtn).textContent = "Loading…";
    }
    try { piano = await loadPiano(ac); } catch (err) { console.warn(err); }
    statusEl.textContent = "idle";
  }
  const nodes = [];
  const start = ac.currentTime + 0.1;
  const songT0 = start - from;
  if (piano) {
    for (const n of notes) {
      if (n.t + n.d <= from) continue;
      const st = Math.max(n.t, from);
      playPiano(ac, piano, songT0 + st, n.t + n.d - st, n.midi, wantVoice ? 0.8 : 1.4, nodes);
    }
  }
  if (wantVoice) playVoice(ac, take.voice, start, from, nodes);
  session = { kind, ac, nodes, songT0, raf: null, end };
  updateButtons();
  const loop = () => {
    if (!session || session.ac !== ac || session.kind !== kind) return;
    nowT = ac.currentTime - songT0;
    if (nowT > end + 0.3) { stopSession(); return; }
    renderLive();
    session.raf = requestAnimationFrame(loop);
  };
  session.raf = requestAnimationFrame(loop);
}

function stopSession() {
  const s = session;
  if (!s) return;
  if (s.kind === "sing") { stopSing(); return; }
  session = null;
  cancelAnimationFrame(s.raf);
  for (const n of s.nodes) try { n.stop(); } catch {}
  scrollT = Math.max(0, Math.min(nowT, songEnd));
  renderAll();
}

// ---------------------------------------------------------------------------
// Rendering

function renderAll() {
  if (!session) nowT = scrollT;
  renderLyrics(nowT);
  renderChips();
  renderSummary();
  updateButtons();
  renderLane();
}

function renderLive() {
  renderLyrics(nowT);
  markCurrentChip();
  renderLane();
}

let sylEls = new Map();

// Does the syllable on note i continue into the next sung syllable? Only when it
// says so (begin/middle) AND the next syllable agrees (middle/end) — OCR'd scores
// sometimes tag a whole word as "begin", which would glue it to the next word.
function joinsNext(i) {
  const n = notes[i];
  if (n.syllabic !== "begin" && n.syllabic !== "middle") return false;
  for (let j = i + 1; j < notes.length; j++) {
    if (notes[j].melisma || !notes[j].text) continue;
    return notes[j].syllabic === "middle" || notes[j].syllabic === "end";
  }
  return false;
}

function sylText(n, i) {
  if (n.melisma) return "";
  if (!score.verses.length) return noteName(n.midi) + " "; // no lyrics: show the notes
  return n.text + (joinsNext(i) ? "" : " ");
}

function lineHtml(li, el, keep) {
  el.textContent = "";
  if (li < 0 || li >= lines.length) return;
  for (const i of lines[li]) {
    const t = sylText(notes[i], i);
    if (!t) continue;
    const span = document.createElement("span");
    span.className = "syl";
    span.textContent = t;
    el.appendChild(span);
    if (keep) sylEls.set(i, span);
  }
}

function renderLyrics(t) {
  if (!notes.length) return;
  const fi = focusNote(t);
  const li = lineOf[fi] ?? 0;
  if (li !== shownLine) {
    sylEls = new Map();
    lineHtml(li, lyricNowEl, true);
    lineHtml(li + 1, lyricNextEl, false);
    shownLine = li;
  }
  const cur = noteAt(t);
  // The syllable a melisma note belongs to.
  let curSyl = cur;
  while (curSyl > 0 && notes[curSyl].melisma) curSyl--;
  for (const [i, span] of sylEls) {
    const g = take?.grades[i];
    span.dataset.state = i === curSyl && cur >= 0 && session ? "current" : g && g.status !== "unsung" ? g.status : "";
  }
}

function renderChips() {
  chipsEl.textContent = "";
  lastChip = -1;
  notes.forEach((n, j) => {
    if (j > 0 && lineOf[j] !== lineOf[j - 1]) {
      const br = document.createElement("span");
      br.className = "phrase-break";
      chipsEl.appendChild(br);
    }
    chipsEl.appendChild(makeChip(j));
  });
}

function makeChip(j) {
    const n = notes[j];
    const g = take?.grades[j];
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip mono";
    b.dataset.tune = g ? g.status : "";
    b.innerHTML = "<i></i><b></b><small></small>";
    b.querySelector("i").textContent = n.melisma ? "‿" : n.text + (joinsNext(j) ? "-" : "");
    b.querySelector("b").textContent = noteName(n.midi);
    let res = "";
    if (g?.status === "good" || g?.status === "ok") res = `✓ ${centsLabel(Math.round(g.dev * 100))}`;
    else if (g?.status === "off") res = noteName(Math.round(g.sungMidi));
    else if (g?.status === "missed") res = "missed";
    b.querySelector("small").textContent = res || " ";
    b.addEventListener("click", () => seek(n.t - 0.4));
    if (j === lastChip) b.dataset.current = "true";
    return b;
}

function markCurrentChip() {
  const i = noteAt(nowT);
  if (i === lastChip) return;
  const chips = chipsEl.querySelectorAll(".chip");
  if (lastChip >= 0 && chips[lastChip]) chips[lastChip].dataset.current = "false";
  if (i >= 0 && chips[i]) {
    chips[i].dataset.current = "true";
    chips[i].scrollIntoView({ block: "nearest" });
  }
  lastChip = i;
}

function renderSummary() {
  if (!take || take.endT === null) {
    scorePctEl.textContent = "";
    summaryEl.textContent = score
      ? `${score.title.toUpperCase()} · ${score.beats}/${score.beatType} · ♩=${Math.round(score.tempo * rate)}${score.tempoFromScore ? "" : " (no tempo in score)"}`
      : "";
    return;
  }
  const graded = take.grades.map((g, j) => [g, notes[j]]).filter(([g]) => g && g.status !== "unsung");
  if (!graded.length) {
    scorePctEl.textContent = "";
    summaryEl.textContent = "NO NOTES SUNG";
    return;
  }
  const total = graded.reduce((a, [, n]) => a + n.d, 0);
  const pct = Math.round((100 * graded.reduce((a, [g, n]) => a + (g.hit || 0) * n.d, 0)) / total);
  const c = (s) => graded.filter(([g]) => g.status === s).length;
  scorePctEl.textContent = `${pct}%`;
  let t = `${c("good")} GOOD · ${c("ok")} CLOSE · ${c("off")} OFF · ${c("missed")} MISSED`;
  if (take.octave) t += take.octave < 0 ? " · SUNG 8VB" : " · SUNG 8VA";
  summaryEl.textContent = t;
}

function updateButtons() {
  const kind = session?.kind;
  singBtn.textContent = kind === "sing" ? "■ Stop" : take?.endT != null ? "● Sing again" : "● Sing";
  singBtn.dataset.active = kind === "sing" ? "true" : "false";
  listenBtn.textContent = kind === "listen" ? "■ Stop" : "▶ Listen";
  listenBtn.disabled = kind === "sing" || !score;
  singBtn.disabled = !score || (kind && kind !== "sing");
  playbarEl.hidden = !take || take.endT === null || kind === "sing";
  playBtn.textContent = kind === "playback" ? "■ Stop" : "▶ Play";
  playBtn.dataset.playing = kind === "playback" ? "true" : "false";
  for (const b of playModesEl.querySelectorAll("button")) {
    b.disabled = b.dataset.mode !== "melody" && !take?.voice;
    b.dataset.active = b.dataset.mode === playMode ? "true" : "false";
  }
  for (const el of [songSelect, verseSelect, keySelect, tempoSelect, guideSelect, openFileBtn, openLinkBtn, removeBtn, saveBtn]) el.disabled = kind === "sing";
  canvas.dataset.pannable = session ? "false" : "true";
}

const TUNE = {
  good: ["rgba(74,222,128,0.45)", "rgba(74,222,128,0.95)"],
  ok: ["rgba(166,79,255,0.45)", "rgba(166,79,255,0.95)"],
  off: ["rgba(255,111,111,0.4)", "rgba(255,111,111,0.95)"],
  missed: ["rgba(255,255,255,0.04)", "rgba(255,255,255,0.35)"],
  todo: ["rgba(255,255,255,0.12)", "rgba(255,255,255,0.4)"],
};

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  renderLane();
}
new ResizeObserver(resize).observe(canvas);

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function renderLane() {
  const r = canvas.getBoundingClientRect();
  const w = r.width, h = r.height;
  if (!w || !h) return;
  ctx.clearRect(0, 0, w, h);
  if (!score) return;
  const { lo, hi } = range;
  const rowH = h / (hi - lo + 1);
  const nowX = GUTTER + (w - GUTTER) * NOW_FRAC;
  const xOf = (t) => nowX + (t - nowT) * PX_PER_SEC;
  const yOf = (m) => h - (m - lo + 0.5) * rowH;
  const tMin = nowT - (nowX - GUTTER) / PX_PER_SEC, tMax = nowT + (w - nowX) / PX_PER_SEC;

  // Semitone rows.
  for (let m = lo; m <= hi; m++) {
    const pc = ((m % 12) + 12) % 12;
    const y = yOf(m) - rowH / 2;
    if (BLACK.has(pc)) {
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(GUTTER, y, w - GUTTER, rowH);
    }
    if (pc === 0) {
      ctx.fillStyle = "rgba(255,255,255,0.1)";
      ctx.fillRect(GUTTER, y + rowH - 1, w - GUTTER, 1);
    }
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(GUTTER, 0, w - GUTTER, h);
  ctx.clip();

  // Bar lines.
  const spq = secPerQuarter();
  ctx.fillStyle = "rgba(255,255,255,0.09)";
  for (const m of score.measures) {
    const t = m * spq;
    if (t >= tMin && t <= tMax) ctx.fillRect(xOf(t), 0, 1, h);
  }

  // Score notes with lyrics.
  const barH = Math.max(6, Math.min(rowH * 0.85, 22));
  const cur = noteAt(nowT);
  notes.forEach((n, j) => {
    if (n.t + n.d < tMin || n.t > tMax) return;
    const g = take?.grades[j];
    const key = g && g.status !== "unsung" ? g.status : "todo";
    const [fill, stroke] = TUNE[key];
    const x0 = xOf(n.t) + 1, x1 = xOf(n.t + n.d) - 1;
    const y = yOf(n.midi);
    ctx.fillStyle = fill;
    ctx.strokeStyle = j === cur && session ? "#ffe6a0" : stroke;
    ctx.lineWidth = j === cur && session ? 2 : 1;
    if (key === "missed") ctx.setLineDash([4, 3]);
    roundRect(x0, y - barH / 2, Math.max(3, x1 - x0), barH, Math.min(5, barH / 2));
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    if (!n.melisma && n.text) {
      ctx.font = "italic 600 12px system-ui, sans-serif";
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillStyle = j === cur && session ? "#ffe6a0" : "rgba(255,230,160,0.8)";
      ctx.fillText(n.text + (joinsNext(j) ? "-" : ""), x0, y + barH / 2 + 2);
    }
  });

  // Your pitch.
  if (take) {
    ctx.lineWidth = 2.5;
    ctx.lineJoin = ctx.lineCap = "round";
    let prev = null;
    // Live: only up to now. Review: the whole take.
    const upTo = session?.kind === "sing" ? Math.min(tMax, nowT) : tMax;
    for (const f of take.frames) {
      if (f.t < tMin - 0.1 || f.t > upTo + 0.05 || f.disp === null) { prev = null; continue; }
      if (prev && Math.abs(prev.disp - f.disp) < 1.5 && f.t - prev.t < 0.1) {
        ctx.strokeStyle = f.ok === true ? "rgba(74,222,128,0.95)" : f.ok === false ? "rgba(255,120,120,0.95)" : "rgba(255,255,255,0.8)";
        ctx.beginPath();
        ctx.moveTo(xOf(prev.t), yOf(prev.disp));
        ctx.lineTo(xOf(f.t), yOf(f.disp));
        ctx.stroke();
      }
      prev = f;
    }
  }

  // Now / cursor line.
  ctx.fillStyle = session ? "rgba(255,230,160,0.9)" : "rgba(120,200,255,0.5)";
  ctx.fillRect(nowX - 1, 0, 2, h);
  ctx.restore();

  // Count-in overlay.
  if (session?.kind === "sing" && nowT < entryT) {
    const beatSec = (4 / score.beatType) * spq;
    const left = Math.ceil((entryT - nowT) / beatSec);
    ctx.fillStyle = "rgba(255,230,160,0.9)";
    ctx.font = "800 44px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(left), GUTTER + (w - GUTTER) / 2, h / 2);
  }

  // Live readout (top-right): target and you.
  if (session?.kind === "sing" && nowT >= 0) {
    const i = noteAt(nowT - ANALYSIS_LAG - take.latency);
    const f = take.frames[take.frames.length - 1];
    ctx.font = "600 12px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    if (i >= 0) {
      ctx.fillStyle = "rgba(255,230,160,0.9)";
      ctx.fillText(`target ${noteName(notes[i].midi)}`, w - 8, 6);
      if (f && f.midi !== null) {
        const c = Math.round(fold(f.midi - notes[i].midi) * 100);
        ctx.fillStyle = Math.abs(c) <= OK_CENTS ? "#4ade80" : "#ff7878";
        ctx.fillText(`you ${noteName(Math.round(f.midi))} ${centsLabel(c)}`, w - 8, 22);
      }
    }
  }

  // Gutter labels.
  ctx.fillStyle = "rgba(15,15,30,0.85)";
  ctx.fillRect(0, 0, GUTTER, h);
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let m = lo; m <= hi; m++) {
    const pc = ((m % 12) + 12) % 12;
    const isC = pc === 0;
    if (!isC && (BLACK.has(pc) || rowH < 11)) continue;
    ctx.font = isC ? "600 10px ui-monospace, monospace" : "10px ui-monospace, monospace";
    ctx.fillStyle = isC ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.4)";
    ctx.fillText(noteName(m), GUTTER - 5, yOf(m));
  }
}

// ---------------------------------------------------------------------------
// Interaction

function seek(t) {
  scrollT = Math.max(-1, Math.min(t, songEnd));
  if (session && session.kind !== "sing") startPlay(session.kind, Math.max(0, scrollT));
  else if (!session) renderAll();
}

let drag = null;
canvas.addEventListener("pointerdown", (e) => {
  if (session) return;
  drag = { x: e.clientX, t: scrollT };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  scrollT = Math.max(-1, Math.min(songEnd, drag.t - (e.clientX - drag.x) / PX_PER_SEC));
  nowT = scrollT;
  renderLive();
});
const endDrag = () => { drag = null; };
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
canvas.addEventListener("wheel", (e) => {
  if (session) return;
  e.preventDefault();
  scrollT = Math.max(-1, Math.min(songEnd, scrollT + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / PX_PER_SEC));
  nowT = scrollT;
  renderLive();
}, { passive: false });

singBtn.addEventListener("click", () => (session?.kind === "sing" ? stopSing() : startSing()));
listenBtn.addEventListener("click", () => (session?.kind === "listen" ? stopSession() : startPlay("listen", Math.max(0, scrollT))));
playBtn.addEventListener("click", () => (session?.kind === "playback" ? stopSession() : startPlay("playback", Math.max(0, scrollT))));
playModesEl.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-mode]");
  if (!b || b.disabled) return;
  playMode = b.dataset.mode;
  store(K.playMode, playMode);
  if (session?.kind === "playback") startPlay("playback", Math.max(0, nowT));
  else updateButtons();
});

songSelect.addEventListener("change", () => selectSong(songSelect.value));
verseSelect.addEventListener("change", () => {
  store(K.verse, verseSelect.value);
  stopSession();
  applySong();
});
keySelect.addEventListener("change", () => {
  transpose = Number(keySelect.value);
  store(K.transpose, String(transpose));
  stopSession();
  applySong();
});
tempoSelect.addEventListener("change", () => {
  rate = Number(tempoSelect.value);
  store(K.rate, String(rate));
  stopSession();
  applySong();
});
guideSelect.addEventListener("change", () => {
  guide = guideSelect.value;
  store(K.guide, guide);
});
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  fileInput.value = "";
  if (file) importFile(file);
});
openFileBtn.addEventListener("click", () => fileInput.click());
openLinkBtn.addEventListener("click", importLink);
removeBtn.addEventListener("click", async () => {
  const id = songSelect.value;
  if (SAMPLES[id]) return;
  const title = songSelect.selectedOptions[0]?.textContent || "this song";
  if (!confirm(`Remove “${title}” from My songs?`)) return;
  await removeSong(id);
  await refreshLibrary();
  showMsg(`Removed “${title}”.`);
  await selectSong("amazing-grace");
});

// Download the current song's MusicXML (as stored: for PDF imports, the cleaned-up score).
// On phones the share sheet is friendlier (Save to Files, AirDrop, another app); elsewhere a
// plain download.
saveBtn.addEventListener("click", async () => {
  const id = songSelect.value;
  let xml, title;
  try {
    if (SAMPLES[id]) {
      xml = await (await fetch(SAMPLES[id].url)).text();
      title = SAMPLES[id].title;
    } else {
      const song = await getSong(id);
      if (!song) throw new Error("that song is no longer saved");
      ({ xml, title } = song);
    }
  } catch (err) {
    return showMsg(`Couldn't read the song: ${err.message}`, "error");
  }
  const name = `${(title || "song").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "song"}.musicxml`;
  const file = new File([xml], name, { type: "application/xml" });
  if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (err) {
      if (err.name === "AbortError") return; // closed the share sheet
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
});

// Drag and drop a file anywhere on the page (desktop).
let dragDepth = 0;
document.addEventListener("dragenter", (e) => {
  if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
  dragDepth++;
  dropEl.hidden = false;
});
document.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) { dragDepth = 0; dropEl.hidden = true; }
});
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropEl.hidden = true;
  const file = e.dataTransfer?.files?.[0];
  if (file && session?.kind !== "sing") importFile(file);
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && session) {
    stopSession();
    statusEl.textContent = "stopped (backgrounded)";
  }
});

// ---------------------------------------------------------------------------
// Init

for (let k = -6; k <= 6; k++) keySelect.add(new Option(k === 0 ? "Key ±0" : `Key ${k > 0 ? "+" : ""}${k}`, String(k)));
keySelect.value = String(transpose);
guideSelect.value = guide;
if (!navigator.mediaDevices?.getUserMedia) {
  statusEl.textContent = "mic API unavailable — open over HTTPS";
}
(async () => {
  // One-time move of the old single custom song into the library.
  const legacy = recall(K.legacyXml);
  let savedSong = recall(K.song);
  if (legacy) {
    try {
      const id = await addSong(recall(K.legacyName) || "Custom song", legacy);
      if (savedSong === "custom") savedSong = id;
      store(K.legacyXml, null);
      store(K.legacyName, null);
    } catch (err) { console.warn("couldn't migrate saved song", err); }
  }
  await refreshLibrary();
  const known = SAMPLES[savedSong] || (savedSong && [...mySongsEl.querySelectorAll("option")].some((o) => o.value === savedSong));
  await selectSong(known ? savedSong : "amazing-grace");
})();

// Debug hook for automated tests / devtools.
window.resonateDebug = () => ({ score, notes, take, session: session && { kind: session.kind }, nowT, scrollT });
