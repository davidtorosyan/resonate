// Sing (karaoke) mode: the score sets the clock. Notes scroll toward a "now"
// line with their lyrics; after a count-in you sing along, and each score
// note is graded on the pitch you held during its own time slot (any octave).

import { parseMusicXml, readScoreFile, notesForVerse, lyricLines } from "./musicxml.js?v=76";
import { noteName as nameOf, BLACK, fold, median, centsLabel, transposeKey, keyName, spellTransposed } from "./music.js?v=76";
import { openMic, createReader, ANALYSIS_LAG, FFT_SIZE, MIN_RMS } from "./pitch.js?v=76";
import { gradeTake, gradeLive, takeScore, timingTendency, MAX_SHIFT, GOOD_CENTS, OK_CENTS } from "./grade.js?v=76";
import { analyzeLines, lineDelta, feedback, rhythmText, roundResult, runResult, securedText } from "./coach.js?v=76";
import * as P from "./practice.js?v=76";
import { knotsFromTaps, mergeKnots, makeTiming, splitPauses, MIN_GAP } from "./timing.js?v=76";
import { startCapture, playVoice } from "./capture.js?v=76";
import { loadPiano, pianoReady, playPiano, holdPiano, playClick, clickWave, CLICK_GAIN, scheduleAhead, keepAlive } from "./piano.js?v=76";
import { makeFeatures, findClicks, findOnsets, rhythmStats, rhythmObservations, tolOn, firstSound, voiceCover, noteCover } from "./rhythm.js?v=76";
import { listSongs, getSong, addSong, removeSong, persistent, saveClean, getTake, putTake, putClip, getClip, listClips } from "./library.js?v=76";
import { fixOmrScore } from "./omr/fixscore.js?v=76";
import { activeProfile } from "./profiles.js?v=76";
import { fitOptions, fitKey, fitToRange } from "./fit.js?v=76";
import { DATA_KEYS } from "./space.js?v=76";
import { spaceChanged } from "./nav.js?v=76";
import { shareSong, takeStarted, lineDone, takeEnded, remote } from "./assist.js?v=76";

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
const monitorBtn = $("monitor");
const youEl = $("you");
const youNoteEl = $("you-note");
const youCentsEl = $("you-cents");
const youVsEl = $("you-vs");
const reviewEl = $("review");
const optionsEl = $("options");
const optionsBtn = $("options-btn");
const lyricPrevEl = $("lyric-prev");
const countinEl = $("countin");
const loopBtn = $("loop-btn");
const loopbarEl = $("loopbar");
const reviewBtn = $("review-btn");

const SAMPLES = { "amazing-grace": { title: "Amazing Grace", url: "songs/amazing-grace.musicxml" } };
const K = {
  song: "resonate.sing.song",
  legacyXml: "resonate.sing.customXml",   // pre-library single custom song (migrated)
  legacyName: "resonate.sing.customName",
  verse: "resonate.sing.verse",
  legacyTranspose: "resonate.sing.transpose", // pre-v31: one transposition for every song
  keys: "resonate.sing.keys",                  // { songId: semitones }
  rate: "resonate.sing.rate",                  // (pre-v71: one tempo % for every song — migrated to rates)
  rates: "resonate.sing.rates",                // { songId: tempo × } — per song since v71 (1 isn't stored)
  guide: "resonate.sing.guide",
  playMode: "resonate.sing.playMode",
  history: "resonate.sing.history",            // { songId: [{ sig, at, pct, lines: [score | null] }] } — latest last
  view: "resonate.sing.view",                  // while singing: "practice" (notes + pitch) or "perform" (lyrics only)
  timing: "resonate.sing.timing",              // { songId: { sig, segs: [[q, spq | null]], use } } — tapped along with a recording
};
const RATES = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25];

// --- Tunables -------------------------------------------------------------
const PX_PER_SEC = 100;     // lane zoom
const NOW_FRAC = 0.3;       // where the "now" line sits across the lane
const GUTTER = 36;          // note-label gutter (CSS px)
const INPUT_LATENCY = 0.02; // mic → analyser, rough (not reported by browsers)
const END_PAD = 1.0;        // keep going this long after the last note

// --- Song state ---------------------------------------------------------------
let score = null;
let notes = [];    // { midi (transposed), name (spelled in the new key), t, d (s), text, syllabic, melisma, restBefore }
let lines = [];    // [[note index]]
let lineOf = [];   // note index → line index
let flats = false; // black keys as flats (the key's signature has flats)
let songId = null;
let minor = false; // the song's key is minor (from <mode>, else guessed from the melody)
let songEnd = 0;   // s
let entryIdx = 0;  // measure where the singing starts (skips instrumental intros)
let entryT = 0;    // its start time (s) — count-in, lane and Listen start here
let range = { lo: 55, hi: 72 };

// Every setting is written here; the user's own data (per-song key, tempo, timing, history…)
// announces itself so the cloud sync (sync.js), when it runs, can follow.
// After another tab switched whose data the device shows, nothing of the user's is written
// here (it would land in the other space) — nav.js reloads the page as soon as it's idle.
const SYNCED = new Set([K.keys, K.rates, K.timing, K.history]);
const USER_DATA = new Set(DATA_KEYS);
const store = (k, v) => {
  if (USER_DATA.has(k) && spaceChanged()) return;
  try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {}
  if (SYNCED.has(k)) { try { window.dispatchEvent(new CustomEvent("resonate:data", { detail: { what: "settings", key: k } })); } catch {} }
};
const recall = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

let transpose = 0;  // whole-song semitones; "fit:s" = key s split by phrase octaves for the voice
                    // profile (fit.js); "fit" = "fit me" without a profile range yet. Per song (K.keys)
let fit = null;     // how the current choice fits the voice profile (a fit.js option), if there is one
let profile = null; // the active voice profile (profiles.js)
let fitOpts = [];   // fitOptions for it: what the transpose menu offers
let shifts = [];    // semitones per score note (all the same unless fitting)
let shiftSig = "";  // shifts as a string, to tell whether a take's grades still apply
let rate = 1; // (loadTiming sets it per song)
let guide = recall(K.guide) || "click";
let view = recall(K.view) === "perform" ? "perform" : "practice";
let playMode = recall(K.playMode) || "both";

// --- Session state (sing / listen / playback) ----------------------------------
let session = null; // { kind, ac, nodes, songT0, raf, mic?, capture?, latency? }
let take = null;    // { frames, grades, endT, voice, songT0, latency, octave }
let scrollT = 0;    // song time at the now-line when idle (also where Play/Listen start)
let nowT = 0;       // song time at the now-line (follows the session)
let shownLine = -1; // lyric line currently rendered
let lastChip = -1;  // chip marked as current
let preview = null; // the latest note chip held down (piano keys): { j }
let practiceJ = -1; // the note chip pressed last: what the pitch readout compares you with
// The lane's display (guided practice sets it per step): "on" — notes and your pitch in
// colour; "neutral" — no pitch colours (working on timing); "bars" — the notes without your
// pitch line (confirming the tune); "off" — neither (confirming the timing, runs).
let laneMode = "on";

const noteName = (m) => nameOf(m, flats);

// ---------------------------------------------------------------------------
// Song loading

function secPerQuarter() {
  return 60 / (score.tempo * rate);
}

// A slower round in guided practice: the song's times at rate r, for now only — nothing is
// stored, synced or announced (the tempo menu still says the song's tempo); the plan puts
// the song's own rate back (retime(base)) when the round's block ends or stops.
function retime(r) {
  if (!score || r === rate) return;
  rate = r;
  for (const n of notes) { n.t = qToT(n.q); n.d = qToT(n.q + n.dq) - n.t; }
  songEnd = notes.length ? Math.max(...notes.map((n) => n.t + n.d)) : 0;
  entryT = qToT(score.measures[entryIdx] ?? 0);
  // (guided practice's phrases too: a slower round's listen, ▶ You and the cue's ▶ use them)
  if (psong) for (const p of psong.phrases) { p.t0 = notes[p.j0].t; p.t1 = Math.max(...p.js.map((j) => notes[j].t + notes[j].d)); }
  renderAll();
}

// Song time (s) of a position in quarter notes (performance order): the score's tempo ×
// rate, or — when the song has a timing tapped along with a recording and it's chosen —
// that timing (timing.js), also × rate (90% = a little slower than the recording).
let tmap = null;      // makeTiming(...) of this song's tapped timing, or null
let useMap = false;   // follow it
const qToT = (q) => (useMap && tmap ? tmap.qToT(q) / rate : q * secPerQuarter());
// Seconds per beat (the click's beat) from quarter q: steady, or with a tapped timing the
// average over the next two bars (up to `limit`) — one stretched pickup or breath
// shouldn't set the count-in's pace — else the timing's average.
// (The meter is the one in effect at a measure — a song may change it, e.g. Piano Man's
// "Freely" intro in 4/4, then 3/4.)
const meterAt = (mi) => score.meters?.[mi] || [score.beats, score.beatType];
const measureAt = (q) => { let m = 0; score.measures.forEach((x, i) => { if (x <= q + 1e-6) m = i; }); return m; };
// The beat you feel (clicked and counted): a dotted quarter in 6/8, 9/8, 12/8 (a dotted
// eighth in 6/16…), else the meter's own unit (a half in 2/2). → { q (quarters), n (per bar) }
const feltBeat = ([b, t]) => (b > 3 && b % 3 === 0 && t >= 8 ? { q: 12 / t, n: b / 3 } : { q: 4 / t, n: b });
const beatQ = (mi = entryIdx) => feltBeat(meterAt(mi)).q;
function beatSecAt(q, limit = score.length, meter = meterAt(measureAt(q))) {
  const bq = feltBeat(meter).q;
  if (!(useMap && tmap)) return qToT(q + bq) - qToT(q);
  const bar = feltBeat(meter).n * bq;
  const span = Math.min(2 * bar, limit - q);
  if (span < bar) return (tmap.avg / rate) * bq;
  return ((qToT(q + span) - qToT(q)) / span) * bq;
}
// Identifies the timing a take was sung to (a take's grades only hold for it).
const timingSig = () => `${rate}|${useMap && tmap ? JSON.stringify(timingEntry()?.segs) : "steady"}`;

function readTimingStore() {
  try { return JSON.parse(recall(K.timing) || "{}") || {}; } catch { return {}; }
}
// (Keyed by the note count: verses with the same music share one timing.)
const timingKey = () => `${score ? notesForVerse(score, verseSelect.value || score.verses[0] || "1").length : 0}`;
// This song's tapped timing (for the current verse's notes), if any.
function timingEntry() {
  const e = readTimingStore()[songId];
  return e && e.sig === timingKey() ? e : null;
}
// The song's timing, and its speed: a tempo tapped for this song (`bpm`), else the
// percentage chosen for it (one of the menu's), else as written.
function readRates() {
  try { return JSON.parse(recall(K.rates)) || {}; } catch { return {}; }
}
function saveRate(r) {
  const all = readRates();
  if (r === 1 || !songId) delete all[songId];
  else all[songId] = r;
  store(K.rates, JSON.stringify(all));
}
function loadTiming() {
  const e = timingEntry();
  tmap = e?.segs?.length ? makeTiming(e.segs) : null;
  useMap = !!(tmap && e.use);
  const saved = Number(readRates()[songId]) || 1;
  rate = !useMap && e?.bpm ? e.bpm / score.tempo : RATES.includes(saved) || MAP_RATES.includes(saved) ? saved : 1;
}
function saveTiming(fields) {
  const all = readTimingStore();
  const e = { sig: timingKey(), segs: [], use: false, ...(timingEntry() || {}), ...fields };
  if (!e.segs.length && !e.bpm) delete all[songId];
  else all[songId] = e;
  store(K.timing, JSON.stringify(all));
  loadTiming();
}

function applySong() {
  if (drill) stopLoop(); // its line, times and saved take belong to the song as it was
  if (gblock) stopGuided();
  if (!moreEl.hidden) closeMore();
  stopKeys();
  const verse = verseSelect.value || score.verses[0] || "1";
  loadTiming();
  // Transpose like a notation editor: new key with the fewest accidentals, every note
  // moved by the interval (so spelled right in that key), not just its MIDI number.
  // Fitting may also move whole phrases by octaves (same key, so same spelling rules).
  shifts = noteShifts();
  shiftSig = shifts.join(",");
  flats = transposeKey(score.fifths, fit ? fit.key : shifts[0] ?? 0).fifths < 0;
  notes = notesForVerse(score, verse).map((n, i) => ({
    wmidi: n.midi, // as written (before transpose / fit shifts)
    midi: n.midi + shifts[i],
    name: spellTransposed(n, shifts[i], transposeKey(score.fifths, shifts[i]).steps, flats).name,
    q: n.onset,
    dq: n.dur,
    t: qToT(n.onset),
    d: qToT(n.onset + n.dur) - qToT(n.onset),
    text: n.text,
    syllabic: n.syllabic,
    melisma: n.melisma,
    restBefore: n.restBefore,
    pass: n.pass ?? 1, // the verse pass of the repeat it's sung in (musicxml.js unfold)
    measure: n.measure, // written measure
    mi: measureAt(n.onset), // played measure index (score.measureOf[mi] = its written one)
  }));
  lines = lyricLines(notesForVerse(score, verse));
  lineOf = [];
  lines.forEach((l, li) => l.forEach((i) => (lineOf[i] = li)));
  songEnd = notes.length ? Math.max(...notes.map((n) => n.t + n.d)) : 0;
  const mids = notes.map((n) => n.midi);
  range = { lo: Math.min(...mids) - 4, hi: Math.max(...mids) + 4 };
  showFitMsg();
  fillTempoOptions();
  fillKeyOptions();
  if (take && !takeFits(take)) take = null; // grades no longer apply
  if (take?.restored && !take.derived) deriveTake(take);
  if (!take) { reviewRows = []; closeReview(); }
  // Start at the bar containing the first note, not at bar 1 — songs with a
  // long piano intro would otherwise mean a long wait before singing.
  entryIdx = 0;
  if (notes.length) score.measures.forEach((m, i) => { if (m <= notes[0].q + 1e-6) entryIdx = i; });
  entryT = qToT(score.measures[entryIdx] ?? 0);
  shownLine = -1; // force the lyric line to redraw for the new song
  lastChip = -1;
  scrollT = entryT;
  renderAll();
  loadPractice();
  assistSong();
  remote.changedSoon();
}

// A take's grades hold only for the notes, timing and verse it was sung to (a stored take
// also checks the notes themselves: a song's clean-ups can change between versions).
const takeFits = (t) => !!t && t.shiftSig === shiftSig && t.timing === timingSig() && t.verse === (verseSelect.value || score.verses[0] || "1")
  && (!t.notesSig || t.notesSig === notesSig());
const notesSig = () => { let h = 0x811c9dc5; for (const n of notes) for (const x of [n.midi, Math.round(n.t * 1000), Math.round(n.d * 1000)]) { h ^= x & 0xffff; h = Math.imul(h, 0x01000193) >>> 0; } return `${notes.length}.${h.toString(36)}`; };

// The song's (transposed) lowest and highest notes.
const lowest = () => notes.reduce((a, n) => (n.midi < a.midi ? n : a));
const highest = () => notes.reduce((a, n) => (n.midi > a.midi ? n : a));

// The tempo menu: the timing tapped along with a recording (if any) at a few speeds,
// steady tempos, and the ways to set one by tapping.
const MAP_RATES = [1, 0.9, 0.8, 0.7];
function fillTempoOptions() {
  tempoSelect.textContent = "";
  const group = (label) => {
    const g = document.createElement("optgroup");
    g.label = label;
    tempoSelect.append(g);
    return g;
  };
  if (tmap) {
    const g = group("Tapped timing");
    const rs = !useMap || MAP_RATES.includes(rate) ? MAP_RATES : [...MAP_RATES, rate].sort((a, b) => b - a);
    for (const r of rs) g.append(new Option(r === 1 ? "Tapped" : `Tapped · ${Math.round(r * 100)}%`, `m:${r}`));
  }
  const g = tmap ? group("Steady tempo") : tempoSelect;
  const rs = useMap || RATES.includes(rate) ? RATES : [...RATES, rate].sort((a, b) => a - b); // + this song's tapped tempo
  for (const r of rs) {
    const bpm = Math.round(score.tempo * r);
    g.append(new Option(`♩=${bpm}${r === 1 ? "" : RATES.includes(r) ? ` (${Math.round(r * 100)}%)` : " (yours)"}`, `r:${r}`));
  }
  const t = group("Set the tempo");
  t.append(new Option("Type a tempo…", "type"));
  t.append(new Option("Tap the beat…", "tap"));
  t.append(new Option("Tap along with a recording…", "tapmap"));
  if (tmap) t.append(new Option("Forget the tapped timing", "clearmap"));
  tempoSelect.value = `${useMap ? "m" : "r"}:${rate}`;
}

// Semitones per score note: the whole-song transposition, or a key split by phrase
// octaves for the voice profile ("fit:s"). Also works out how every option fits the
// profile's range, for the transpose menu.
function noteShifts() {
  profile = activeProfile();
  fitOpts = profile?.range ? fitOptions(score.notes, profile.range) : [];
  fit = null;
  if (typeof transpose === "string") {
    if (transpose.startsWith("fit:") && profile?.range) {
      fit = fitKey(score.notes, profile.range, Number(transpose.slice(4)));
      return fit.shifts;
    }
    return score.notes.map(() => 0); // "fit" with no range yet: as written (showFitMsg says why)
  }
  fit = fitOpts.find((o) => !o.split && o.key === transpose) || null;
  return score.notes.map(() => transpose);
}

const signed = (t) => (t ? `${t > 0 ? "+" : "−"}${Math.abs(t)}` : "±0");
const keyOf = (t) => keyName(transposeKey(score.fifths, t).fifths, minor);
const pctOut = (f) => `${Math.round(f * 100) || "<1"}%`;

// Under the song bar, when the key moved or there's a voice range: the song's range as
// written → as sung, and the comfortable range ("C3–F4 → A2–D4 · Dave C3–E4 ✓").
function showFitMsg() {
  const r = profile?.range;
  if (!r && typeof transpose === "string") return showMsg("", "info", { href: "voice.html", text: "Set your range" });
  const moved = shifts.some((x) => x);
  if (!notes.length || (!r && !moved)) return showMsg("");
  const written = notesForVerse(score, verseSelect.value || score.verses[0] || "1");
  const steps = transposeKey(score.fifths, 0).steps;
  const wName = (n) => spellTransposed(n, 0, steps, score.fifths < 0).name;
  const lo = written.reduce((a, n) => (n.midi < a.midi ? n : a)), hi = written.reduce((a, n) => (n.midi > a.midi ? n : a));
  const span = `${wName(lo)}–${wName(hi)}${moved ? ` → ${lowest().name}–${highest().name}` : ""}`;
  if (!r) return showMsg(span);
  const ok = fit && fit.outside < 0.02 && !fit.beyond;
  const yours = `${profile.name} ${nameOf(r.comfortLow, flats)}–${nameOf(r.comfortHigh, flats)}`;
  showMsg(`${span} · ${yours}${!fit ? "" : ok ? " ✓" : ` · ${pctOut(fit.outside)} out`}`, ok ? "ok" : "info");
}

// The transpose menu. With a voice range: "Fits Dave (C3–E4)" — every option that keeps
// the singing inside the comfortable range, best first — then "Close" (a little outside),
// then the other whole-song shifts −12…+12. Options name the key they land in ("−10 Dm",
// "−12 Cm · same key"); a split names each part's move ("+12 / −12 Cm · same key").
function fillKeyOptions() {
  keySelect.textContent = "";
  const label = (t) => (t ? `${signed(t)} ${keyOf(t)}${t % 12 === 0 ? " · same key" : ""}` : `Key ${keyOf(0)}`);
  const optLabel = (o) => (o.split
    ? `${[...o.moves].sort((a, b) => b.shift - a.shift).map((m) => signed(m.shift)).join(" / ")} ${keyOf(o.key)}${o.s === 0 ? " · same key" : ""}`
    : label(o.key));
  const value = (o) => (o.split ? `fit:${o.s}` : String(o.key));
  const listed = new Set();
  const group = (name) => {
    const g = document.createElement("optgroup");
    g.label = name;
    keySelect.append(g);
    return g;
  };
  const add = (parent, text, v) => {
    if (listed.has(v)) return;
    listed.add(v);
    parent.append(new Option(text, v));
  };
  if (fitOpts.length) {
    const r = profile.range;
    const byTotal = (a, b) => a.total - b.total;
    const good = fitOpts.filter((o) => o.outside < 0.02 && !o.beyond).sort(byTotal);
    const close = fitOpts.filter((o) => !good.includes(o) && o.outside < 0.15 && o.beyond < 0.02).sort(byTotal).slice(0, 8);
    const name = profile.name.length > 12 ? `${profile.name.slice(0, 11)}…` : profile.name;
    if (good.length) {
      const g = group(`Fits ${name} (${nameOf(r.comfortLow, flats)}–${nameOf(r.comfortHigh, flats)})`);
      for (const o of good) add(g, optLabel(o), value(o));
    }
    if (close.length) {
      const g = group(good.length ? "Close" : `Closest for ${name}`);
      for (const o of close) add(g, `${optLabel(o)} · ${pctOut(o.outside)} out`, value(o));
    }
  } else {
    add(keySelect, "Fit my range…", "fit");
  }
  // A song whose parts need splitting (a duet on one staff) also offers every other key
  // split — first, since singing it whole fits nobody; e.g. its own key, to stay in it.
  const splits = fitOpts.filter((o) => o.split && !listed.has(value(o))).sort((a, b) => a.s - b.s);
  const best = fitOpts.reduce((a, o) => (!a || o.total < a.total ? o : a), null);
  const addSplits = () => {
    if (!splits.length) return;
    const g = group("Other keys, parts split");
    for (const o of splits) add(g, `${optLabel(o)} · ${pctOut(o.outside)} out`, value(o));
  };
  if (best?.split) addSplits();
  const other = fitOpts.length ? group(best?.split ? "Other keys, sung whole" : "Other keys") : keySelect;
  for (let t = -12; t <= 12; t++) add(other, label(t), String(t));
  if (!best?.split) addSplits();
  // A saved choice the lists above don't hold (e.g. −17 from a fit, or a split without a range now).
  if (!listed.has(String(transpose))) {
    if (typeof transpose === "number") add(other, label(transpose), String(transpose));
    else if (!listed.has("fit")) add(keySelect, "Fit my range…", "fit");
  }
  keySelect.value = listed.has(String(transpose)) ? String(transpose) : "fit";
}

// Major or minor: the file says (<mode>), else the bass of the final chord or the
// melody's last note, if it's one of the two tonics the key signature allows (F / D for 1
// flat), else the one the melody dwells on. (Wichita Lineman ends on a B♭maj7 chord and its
// melody dwells on D, but the melody ends on F: F major.)
function guessMinor(sc) {
  if (sc.mode) return sc.mode === "minor";
  const pc = (m) => ((m % 12) + 12) % 12;
  const major = pc(7 * sc.fifths), rel = pc(major + 9);
  if (sc.finalBass != null && pc(sc.finalBass) === major) return false;
  if (sc.finalBass != null && pc(sc.finalBass) === rel) return true;
  const end = sc.notes.reduce((a, n) => (n.onset >= a.onset ? n : a), sc.notes[0]);
  if (end && pc(end.midi) === major) return false;
  if (end && pc(end.midi) === rel) return true;
  let wMajor = 0, wMinor = 0;
  for (const n of sc.notes) {
    if (pc(n.midi) === major) wMajor += n.dur;
    if (pc(n.midi) === rel) wMinor += n.dur;
  }
  const last = sc.notes[sc.notes.length - 1];
  const bonus = 0.25 * sc.notes.reduce((a, n) => a + n.dur, 0) / 7; // the final note counts extra
  if (last && pc(last.midi) === major) wMajor += bonus;
  if (last && pc(last.midi) === rel) wMinor += bonus;
  return wMinor > wMajor;
}

function readKeys() {
  try { return JSON.parse(recall(K.keys)) || {}; } catch { return {}; }
}

let scoreId = null; // the song the loaded score is (songId changes as soon as another is chosen)
function setScore(sc, stored = null) {
  score = sc;
  scoreId = songId;
  minor = guessMinor(sc);
  const savedKey = readKeys()[songId];
  transpose = typeof savedKey === "string" && savedKey.startsWith("fit") ? savedKey : Number(savedKey) || 0;
  // v32's single "Fit" choice becomes the option it picked.
  const range = activeProfile()?.range;
  if (transpose === "fit" && range) {
    const best = fitToRange(sc.notes, range);
    if (best) transpose = best.split ? `fit:${best.s}` : best.key;
    const keys = readKeys();
    if (transpose) keys[songId] = transpose;
    else delete keys[songId];
    store(K.keys, JSON.stringify(keys));
  }
  verseSelect.textContent = "";
  for (const v of sc.verses) verseSelect.add(new Option(`Verse ${v}`, v));
  const saved = recall(K.verse);
  if (saved && sc.verses.includes(saved)) verseSelect.value = saved;
  verseSelect.hidden = sc.verses.length < 2;
  take = reviveTake(stored); // the song's last take, if it still fits (applySong checks)
  reviewRows = [];
  closeReview();
  practiceJ = -1;
  applySong();
  flushRemote(); // (cloud changes that came while it loaded)
}

// id: a sample key, or a saved song's id (from library.js). Its last take comes back with it.
let songGen = 0; // a newer selectSong wins over one still loading
async function selectSong(id) {
  stopLoop();
  stopGuided();
  stopSession();
  $("taptempo").hidden = true; // (their taps belong to the song they were opened on)
  $("tapalong").hidden = true;
  tapAlong = null;
  const gen = ++songGen;
  songId = id;
  songSelect.value = id;
  store(K.song, id);
  removeBtn.hidden = !!SAMPLES[id];
  const stored = getTake(id, { voice: true }).catch(() => null);
  try {
    let sc;
    if (SAMPLES[id]) {
      const res = await fetch(SAMPLES[id].url);
      if (!res.ok) throw new Error(`couldn't load (${res.status})`);
      sc = parseMusicXml(await res.text(), SAMPLES[id].title);
      sc.title = SAMPLES[id].title;
    } else {
      const song = await getSong(id);
      if (!song) throw new Error("that song is no longer saved");
      sc = parseMusicXml(songXml(song), song.title);
    }
    const rec = await stored;
    if (gen !== songGen) return;
    return setScore(sc, rec);
  } catch (err) {
    console.error(err);
    showMsg(`Couldn't load song: ${err.message}`, "error");
  }
}

// Songs converted from PDF (Audiveris) get the OMR clean-ups again on load, so songs saved by an
// older version benefit from newer fixes without converting again (the clean-ups leave an
// already-clean score unchanged).
function cleanXml(xml) {
  if (!/<software>\s*Audiveris/.test(xml.slice(0, 4000))) return xml;
  try {
    const { xml: fixed, changes } = fixOmrScore(xml);
    if (changes.length) console.info("OMR clean-ups on load:", changes);
    return fixed;
  } catch (err) {
    console.warn("OMR clean-ups failed", err);
    return xml;
  }
}

// A saved song's MusicXML, cleaned up: the cleaned copy saved with it when this version of
// the app made it (the clean-ups take a while on a big score on a phone), else cleaned now
// and saved for next time. The original stays as it was imported.
const APP_VERSION = document.getElementById("version")?.textContent.trim() || "";
function songXml(song) {
  if (!/<software>\s*Audiveris/.test(song.xml.slice(0, 4000))) return song.xml;
  if (APP_VERSION && song.clean?.ver === APP_VERSION) return song.clean.xml ?? song.xml;
  const xml = cleanXml(song.xml);
  if (APP_VERSION) saveClean(song.id, xml === song.xml ? null : xml, APP_VERSION).catch(() => {});
  return xml;
}

function showMsg(text, kind = "info", link = null) {
  songMsgEl.textContent = text;
  if (link) {
    const a = document.createElement("a");
    a.href = link.href;
    a.textContent = link.text;
    songMsgEl.append(" ", a);
  }
  songMsgEl.dataset.kind = kind;
  songMsgEl.hidden = !text && !link;
}

async function refreshLibrary() {
  const songs = await listSongs();
  mySongsEl.textContent = "";
  for (const s of songs) mySongsEl.appendChild(new Option(s.title, s.id));
  mySongsEl.hidden = !songs.length;
}

// Validate, save to My songs, and switch to it.
async function importXml(xml, name, source = "file") {
  const sc = parseMusicXml(xml, name);
  const id = await addSong(sc.title, xml, { source });
  await refreshLibrary();
  store(K.verse, null);
  await selectSong(id);
  const bits = [`✓ ${sc.title}`];
  if (!sc.verses.length) bits.push("no lyrics");
  if (!sc.tempoFromScore) bits.push(`no tempo, ♩=${sc.tempo}`);
  if (sc.partName) bits.push(`melody: ${sc.partName}`);
  if (!(await persistent())) bits.push("not kept after reload");
  showMsg(bits.join(" · "), "ok");
}

// Explain the common wrong-format cases instead of a generic parse error.
function formatHint(name) {
  const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
  const hints = {
    mscz: "MuseScore file — in MuseScore: File → Export → MusicXML.",
    mscx: "MuseScore file — in MuseScore: File → Export → MusicXML.",
    mid: "MIDI has no lyrics — export MusicXML instead.",
    midi: "MIDI has no lyrics — export MusicXML instead.",
    pdf: "convert PDFs with Tools → PDF → Song.",
    sib: "Sibelius file — export it as MusicXML.",
    gp: "Guitar Pro file — export it as MusicXML.",
  };
  return hints[ext] || null;
}

async function importFile(file) {
  showMsg(`Opening “${file.name}”…`);
  try {
    const hint = formatHint(file.name);
    if (hint) throw new Error(hint);
    if (file.size > 20 * 1024 * 1024) throw new Error("over 20 MB — not a song score");
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
  const raw = prompt("MusicXML link (.musicxml, .xml, .mxl):");
  if (!raw || !raw.trim()) return;
  let url;
  try {
    url = normalizeLink(raw.trim());
  } catch {
    showMsg("Not a link.", "error");
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
      throw new Error("the site blocks this — download the file and use Open.");
    }
    if (!res.ok) throw new Error(`the link returned ${res.status}`);
    const blob = await res.blob();
    const xml = await readScoreFile(new File([blob], name));
    if (/^\s*<!doctype html|^\s*<html/i.test(xml)) throw new Error("that's a web page — use the direct download link.");
    await importXml(xml, name, "link");
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

// The count-in's meter: the one where the singing starts (measure mi) — or, when that bar
// is a pickup, the next bar's (a pickup may still carry the old meter: a 4/4 intro, a beat
// of pickup, then 3/4).
function countInMeter(mi = entryIdx) {
  const own = meterAt(mi);
  const firstQ = (score.measures[mi + 1] ?? score.length) - score.measures[mi];
  return firstQ < own[0] * (4 / own[1]) - 1e-6 ? meterAt(Math.min(mi + 1, score.measures.length - 1)) : own;
}
// A bar of clicks in that meter, plus the missing beats when the first bar is a pickup —
// fractional for a pickup that isn't whole beats (an eighth in 4/4: 7½, so the pickup lands
// on the "and" of 4 and the downbeat on the next click's time; rounding put the song half a
// beat late against its own count-in, and the clicks jumped half a beat after the pickup).
function countInBeats(mi = entryIdx) {
  const { q: bq, n } = feltBeat(countInMeter(mi));
  const barQ = n * bq;
  const firstQ = (score.measures[mi + 1] ?? score.length) - score.measures[mi];
  return n + (firstQ < barQ - 1e-6 ? (barQ - firstQ) / bq : 0);
}

// The count-in number shown at song time t: it changes on each click (a fractional count —
// a pickup that isn't whole beats — starts from the next whole number).
function countInLeft(s, t) {
  const n = Math.ceil(s.count - 1e-9);
  const k = Math.floor((t - (s.start - s.count * s.beatSec)) / s.beatSec + 1e-9); // clicks gone − 1
  return Math.min(n, Math.max(1, n - k));
}

// Every beat of the song: [{ t (s), accent, q }]. A pickup bar (the song's first bar, and its
// replays after a repeat) counts back from its barline: an eighth pickup in 4/4 has no beat of
// its own; a 1½-beat pickup has one, half a beat in.
function beatGrid() {
  const out = [];
  score.measures.forEach((m, i) => {
    const bq = beatQ(i);
    const end = score.measures[i + 1] ?? score.length;
    const short = end - m < feltBeat(meterAt(i)).n * bq - 1e-6;
    if (short && (score.measureOf?.[i] ?? i) === 0) {
      const qs = [];
      for (let q = end - bq; q >= m - 1e-6; q -= bq) qs.unshift(q);
      for (const q of qs) out.push({ t: qToT(q), accent: false, q });
      return;
    }
    for (let q = m; q < end - 1e-6; q += bq) out.push({ t: qToT(q), accent: q === m && i > 0, q });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Sing

// While Sing / Listen / Play is starting ("sing" / "play"), the pitch monitor keeps its mic closed.
let starting = null;
// part (a phrase-loop round, or a guided-practice round or run): { from (s, a bar start: the
// count-in is the bar before), until (s), range: [first note, end), ac (the loop's mic context),
// token } — no review or history; stopSing resolves session.ended with the take. Guided practice
// adds: guided, guide ("click": its own guide, whatever the menu says), view ("practice" |
// "perform"), lane ("on" | "neutral" | "off" | "bars"), stage ("time" | "tune" | "song"),
// record (keep the recording: runs, and rounds for "▶ You"), phrases ([[note j…]], the phrases
// judged — rhythm per phrase, PhraseRhythm in take.rhythm.phrases).
async function startSing(part = null) {
  starting = "sing";
  monitorSync();
  try { await beginSing(part); } finally { starting = null; monitorSync(MON_RESUME); flushRemote(); }
}

// A round's loop (the phrase loop, or a guided step) is still the one that asked for it.
const partAlive = (part) => (part.guided ? gblock?.token === part.token : drill?.token === part.token);

async function beginSing(part) {
  if (!part) {
    closeReview();
    reviewRows = [];
  }
  stopKeys();
  stopSession();
  playGen++;
  take = null;
  showMsg("");
  updateButtons(); // (the old take's Play bar goes: a Play tapped while the mic opens would run under the take)
  singBtn.disabled = listenBtn.disabled = true;
  statusEl.textContent = "requesting mic…";
  let mic;
  try {
    mic = await openMic({ ac: part?.ac });
  } catch (err) {
    console.error(err);
    statusEl.textContent = `mic error: ${err.name || err.message}`;
    singBtn.disabled = listenBtn.disabled = false;
    if (part?.guided) { stopGuided(); showMsg(`Couldn't open the microphone: ${err.message || err.name}`, "error"); }
    else if (part) stopLoop(`Couldn't open the microphone: ${err.message || err.name}`);
    return;
  }
  micWasOpen = true;
  if (part && !partAlive(part)) { await mic.close(); return; } // the loop stopped meanwhile
  const ac = mic.ac;
  const g = part?.guide ?? guide;
  let piano = null;
  if (g === "melody") {
    statusEl.textContent = "loading piano…";
    try { piano = await loadPiano(ac); } catch (err) { console.warn(err); }
  }
  // The recording: a take's for playback; a loop round keeps just its count-in (to find the
  // clicks). Both stream into the rhythm features as they arrive.
  const features = makeFeatures(ac.sampleRate);
  const capture = await startCapture(ac, mic.source, { keepSeconds: part && !part.record ? 10 : Infinity, onChunk: (c) => features.push(c) });
  let wakeLock = null;
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
  if (part && !partAlive(part)) { // the loop stopped while the piano loaded
    try { await wakeLock?.release(); } catch {}
    await mic.close();
    return;
  }

  if (session) stopSession(); // anything that started while the mic opened (its sounds would play on)
  const nodes = [];
  const startQ = part ? part.fromQ : score.measures[entryIdx] ?? 0;
  const lastQ = part ? notes[part.range[1] - 1].q + notes[part.range[1] - 1].dq : score.length;
  const startM = part ? part.fromM : entryIdx;
  const meter = part ? meterAt(startM) : countInMeter(startM); // one meter for the count-in's beats, pace and accents
  const beatSec = beatSecAt(startQ, lastQ, meter); // the count-in's pace: the song's at its start
  const start = part ? part.from : entryT;
  const end = part ? part.until : songEnd + END_PAD;
  const [j0, j1] = part ? part.range : [0, notes.length];
  // (a loop round on a line in the song's pickup bar gets the pickup's missing beats too)
  const pickLen = (score.measures[startM + 1] ?? score.length) - score.measures[startM];
  const fbm = feltBeat(meter);
  const pickupFill = part && pickLen < fbm.n * fbm.q - 1e-6 && (score.measureOf?.[startM] ?? startM) === 0 ? (fbm.n * fbm.q - pickLen) / fbm.q : 0;
  const count = part ? fbm.n + pickupFill : countInBeats();
  const barBeats = feltBeat(meter).n;
  const t0 = ac.currentTime + 0.3;
  const songT0 = t0 + count * beatSec - start; // song time `start` sounds right after the count-in
  const countClicks = [];
  for (let k = 0; k < count; k++) {
    countClicks.push({ t: t0 + k * beatSec, accent: k % barBeats === 0 });
    playClick(ac, t0 + k * beatSec, k % barBeats === 0, nodes);
  }
  // The guide, a few seconds ahead at a time (scheduleAhead: all at once choked WebKit).
  const guideItems = [];
  if (g === "click") for (const b of beatGrid()) if (b.t >= start - 1e-6 && b.t < end) guideItems.push({ when: songT0 + b.t, end: songT0 + b.t + 0.03, accent: b.accent });
  if (piano) for (const n of notes.slice(j0, j1)) guideItems.push({ when: songT0 + n.t, end: songT0 + n.t + n.d, n });
  guideItems.sort((a, b) => a.when - b.when);
  keepAlive(ac, nodes);
  scheduleAhead(ac, guideItems, (it) => it.n ? playPiano(ac, piano, it.when, it.n.d, it.n.midi, 0.9, nodes) : playClick(ac, it.when, it.accent, nodes), nodes);

  // The singer follows what they hear (output latency); the mic hears them
  // late (input latency); a pitch frame lags its audio (analysis window).
  const latency = (ac.outputLatency || ac.baseLatency || 0) + INPUT_LATENCY;
  take = { frames: [], grades: notes.map(() => null), endT: null, voice: null, songT0, latency, shiftSig, timing: timingSig(), rate, verse: verseSelect.value || score.verses[0] || "1", octave: 0, range: [j0, j1], part: !!part, guide: g, guided: !!part?.guided };
  // A whole take is shared with assistants line by line as it's sung (assist.js).
  if (!part && !spaceChanged()) { take.coachId = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; take.coachSent = new Set(); takeStarted(take.coachId, songId, assistMeta()); }
  // A take an assistant started: who, and the line it ends after (a short performance).
  if (!part && remoteTake) {
    take.remoteBy = remoteTake.by;
    // (only notes up to that line are graded: the next line may start inside the margin)
    if (remoteTake.until !== null && lines[remoteTake.until]) { const idx = lines[remoteTake.until], jl = idx[idx.length - 1], last = notes[jl]; take.untilLine = remoteTake.until; take.untilT = last.t + last.d + 0.8; take.range = [take.range[0], Math.min(take.range[1], jl + 1)]; }
  }
  if (!part) remoteTake = null; // (a guided round mustn't eat an assistant's pending take)
  let endRes;
  const ended = new Promise((r) => { endRes = r; });
  session = { kind: "sing", ac, nodes, songT0, latency, mic, capture, features, countClicks, wakeLock, raf: null, part, start, beatSec, count, ended, endRes };
  stopKeys(); // a key pressed while the mic was opening
  singBtn.disabled = false;
  updateButtons();

  const tick = () => {
    if (!session || session.kind !== "sing") return;
    const songT = ac.currentTime - songT0;
    const r = mic.read();
    const ft = songT - ANALYSIS_LAG - latency;
    if (ft > start - 0.5) addFrame(ft, r.midi, r.rms);
    pushYou(r.midi);
    gradeUpTo(ft);
    nowT = songT;
    renderYou();
    statusEl.textContent = songT < start ? `count-in ${Math.max(1, Math.min(Math.ceil(count), Math.floor((songT - start + count * beatSec) / beatSec) + 1))}` : `${r.db.toFixed(0)} dB`;
    renderLive();
    if (take.untilT !== undefined) {
      const last = shownLine >= take.untilLine;
      takeEndEl.hidden = false;
      takeEndEl.dataset.last = String(last);
      takeEndEl.textContent = last ? "last line" : `to line ${take.untilLine + 1}`;
      if (songT > take.untilT) { stopSing(); return; }
    }
    if (songT > end) { stopSing(); return; }
    session.raf = requestAnimationFrame(tick);
  };
  session.raf = requestAnimationFrame(tick);
}

// Store a frame; `disp` is the pitch shifted by octaves next to the melody
// so singing an octave off still overlays the notes.
function addFrame(t, midi, rms) {
  const f = { t, midi, rms, disp: null, ok: null };
  if (midi !== null) {
    const i = noteAt(t);
    const ref = i >= 0 ? notes[i].midi : take.lastDisp ?? (range.lo + range.hi) / 2;
    f.disp = midi + 12 * Math.round((ref - midi) / 12);
    take.lastDisp = f.disp;
    if (i >= 0) f.ok = Math.abs(fold(midi - notes[i].midi)) * 100 <= OK_CENTS;
  }
  take.frames.push(f);
}

// Grade (grade.js) every note the take can no longer change: once frames reach past its
// latest possible end. The whole take is graded again when it ends (slots move together).
function gradeUpTo(t) {
  const [j0, j1] = take.range;
  notes.forEach((n, j) => {
    if (j < j0 || j >= j1 || take.grades[j] || n.t + n.d + MAX_SHIFT > t) return;
    take.grades[j] = gradeLive(notes, take.frames, j, { endT: t, gate: MIN_RMS });
    const old = chipsEl.querySelectorAll(".chip")[j];
    if (old) old.replaceWith(makeChip(j));
    // A line whose notes are all graded goes to the assistants at once.
    const li = lineOf[j];
    if (take.coachId && li !== undefined && !take.coachSent.has(li) && lines[li].every((k) => take.grades[k] || k < j0 || k >= j1)) {
      take.coachSent.add(li);
      lineDone(take.coachId, li, assistLine(li));
    }
  });
}

// The take's final grades; your pitch line is coloured against the note each frame was
// matched with (its moved slot), and drawn next to it.
function gradeFinal(endT) {
  const [j0, j1] = take.range;
  const part = gradeTake(notes.slice(j0, j1), take.frames, { endT, gate: MIN_RMS });
  take.grades = notes.map((_, j) => (j >= j0 && j < j1 ? part[j - j0] : null));
  recolour(take);
}
// Each frame of the pitch line coloured against the note its grade matched it with (the
// note's moved slot), and drawn next to it.
function recolour(tk) {
  for (const f of tk.frames) f.ok = null;
  let k = 0;
  tk.grades.forEach((g, j) => {
    if (!g || g.from === undefined) return;
    const n = notes[j];
    while (k < tk.frames.length && tk.frames[k].t < g.from) k++;
    for (let i = k; i < tk.frames.length && tk.frames[i].t < g.to; i++) {
      const f = tk.frames[i];
      if (f.midi === null) continue;
      f.ok = Math.abs(fold(f.midi - n.midi)) * 100 <= OK_CENTS;
      f.disp = f.midi + 12 * Math.round((n.midi - f.midi) / 12);
    }
  });
}

// While a stopped take is still being finished (the recording flushing, the mic closing,
// rhythm, grades), nothing from the cloud is applied: it could replace the take.
let finishing = false;
async function stopSing() {
  const s = session;
  if (!s || s.kind !== "sing") return;
  session = null;
  finishing = true;
  takeEndEl.hidden = true;
  try { await finishSing(s); } finally { finishing = false; flushRemote(); }
}
async function finishSing(s) {
  const tk = take, sid = songId;
  let settings = null;
  try { settings = s.mic.stream.getAudioTracks()[0]?.getSettings() || null; } catch {}
  // The mic stops now (the recording still flushes what it has): iOS keeps playback on the
  // quiet earpiece while a capture is live, so a Play tapped right after Stop was silent.
  s.mic.stream.getTracks().forEach((t) => t.stop());
  cancelAnimationFrame(s.raf);
  for (const n of s.nodes) try { n.stop(); } catch {}
  const stopAt = s.ac.currentTime;
  take.endT = stopAt - s.songT0 - ANALYSIS_LAG - s.latency;
  const v = await s.capture.finish();
  if (take !== tk && tk.coachId) takeEnded(tk.coachId, { status: "stopped", meta: assistMeta(), review: null, lines: [] });
  if (take !== tk) { // replaced while the recording flushed (a loop stopped mid-round): drop this one
    try { await s.wakeLock?.release(); } catch {}
    await s.mic.close();
    if (!session && starting === null) statusEl.textContent = "";
    s.endRes(null);
    return;
  }
  // The count-in clicks in the recording measure the real round trip (output + input
  // latency; the browser's estimate can be well off — Bluetooth). With it, the pitch frames
  // and the recording are placed where they were really sung against what was heard.
  let cal = null;
  try { if (v) cal = findClicks(v.data, v.sampleRate, v.start, s.countClicks, s.beatSec, (a) => clickWave(v.sampleRate, a), (a) => CLICK_GAIN[a ? "accent" : "plain"]); } catch (err) { console.warn("clicks", err); }
  Object.assign(take, { ctxStart: v ? v.start : null, est: s.latency, beatSec: s.beatSec, countClicks: s.countClicks });
  if (cal) {
    const d = s.latency - cal.rt;
    for (const f of take.frames) f.t += d;
    take.endT += d;
    take.latency = cal.rt;
    take.frameShift = d;
  }
  gradeFinal(take.endT);
  const octs = take.grades.filter((g) => g && g.octave !== undefined).map((g) => g.octave);
  take.octave = octs.length ? Math.round(median(octs)) : 0;
  // Line the recording up with the score: shift by the round trip.
  if (v && (!s.part || s.part.record)) take.voice = { ...v, start: v.start - s.songT0 - take.latency };
  try { take.rhythm = rhythmOf(s, v, cal, stopAt, settings); } catch (err) { console.warn("rhythm", err); take.rhythm = null; }
  try { await s.wakeLock?.release(); } catch {}
  await s.mic.close();
  statusEl.textContent = "";
  if (take !== tk) { if (tk.coachId) takeEnded(tk.coachId, { status: "stopped", meta: assistMeta(), review: null, lines: [] }); s.endRes(null); return; } // a new take started while the mic closed
  if (s.part) {
    renderAll();
    s.endRes(take);
    return;
  }
  scrollT = entryT;
  nowT = entryT;
  renderAll();
  chipsEl.scrollTop = 0;
  monitorSync(MON_RESUME);
  s.endRes(take);
  recordTake();
  // (After a take an assistant started, the assistant gives the feedback — the review stays a tap away.)
  if ((!tk.remoteBy || remote.settings.review_after_remote) && !guiding()) openReview();
  guidedAfterTake(tk);
  saveLastTake(tk, sid);
  if (spaceChanged()) showMsg("Not kept: signed in or out in another tab.", "error");
  else if (tk.coachId) assistTakeEnded(tk);
}

// ---------------------------------------------------------------------------
// Rhythm (rhythm.js): when each note came in, from the take's recording

// Per note, where it sits in the beat: { beat (s), u (the beat's division, s), off (not on a
// felt beat), level ("beat" | "div" | "sub"), toBeat (s to the next beat), entry (first note,
// or after a rest ≥ ½ beat), rest (s), lineEnd }. A pickup bar counts back from its barline.
function metricOf() {
  const lineEnd = new Set(lines.map((l) => l[l.length - 1]));
  return notes.map((n, j) => {
    const mi = measureAt(n.q), meter = meterAt(mi), fb = feltBeat(meter);
    const m0 = score.measures[mi], end = score.measures[mi + 1] ?? score.length;
    const pickup = end - m0 < fb.n * fb.q - 1e-6 && (score.measureOf?.[mi] ?? mi) === 0;
    const origin = pickup ? end - fb.n * fb.q : m0;
    const pos = (n.q - origin) / fb.q, frac = pos - Math.floor(pos + 1e-6);
    const div = fb.q === 4 / meter[1] ? 2 : 3; // a compound beat divides in three
    const off = frac > 1e-6;
    const level = !off ? "beat" : Math.abs(frac * div - Math.round(frac * div)) < 1e-6 ? "div" : "sub";
    const beat = qToT(n.q + fb.q) - qToT(n.q);
    const prev = notes[j - 1];
    const rest = prev ? n.t - (prev.t + prev.d) : Infinity;
    return {
      beat, u: beat / div, off, level,
      toBeat: off ? qToT(origin + Math.ceil(pos - 1e-6) * fb.q) - n.t : 0,
      entry: !prev || (n.restBefore && rest >= beat / 2), rest: Math.min(rest, 9), lineEnd: lineEnd.has(j),
    };
  });
}

// After a take: each note's onset and what the timing says, from the recording (cal: the
// count-in clicks found in it, or null). → take.rhythm = { calibrated, rt, trust, lead, steady,
// drift, notes: [{ dev, rdev, cls, rel, kind, conf, u } | null], obs: [observation], diag }.
function rhythmOf(s, v, cal, stopAt, settings) {
  if (!v) return null;
  const [j0, j1] = take.range;
  const diag = { coupling: cal ? cal.coupling : null, clicks: cal ? cal.n : 0, est: s.latency, out: s.ac.outputLatency ?? null, base: s.ac.baseLatency ?? null, settings };
  // The melody guide from a speaker the mic can hear (the count-in clicks were found): its
  // piano lands right on time in the recording, so the timing can't be judged. Headphones fix it.
  if (take.guide === "melody" && cal) {
    return { calibrated: true, rt: cal.rt, trust: "speaker-guide", lead: null, notes: notes.map(() => null), obs: [{ kind: "headphones", tone: "try", scope: "take" }], diag,
      ...(s.part?.phrases ? { phrases: s.part.phrases.map(() => ({ trust: "speaker-guide", guide: "melody", obs: [], takeObs: [] })) } : {}) };
  }
  const trip = cal ? cal.rt : s.latency;
  const ns = notes.slice(j0, j1);
  const met = metricOf().slice(j0, j1);
  const ls = lines.map((l) => l.filter((j) => j >= j0 && j < j1).map((j) => j - j0));
  const feat = s.features.result();
  const guided = !!s.part?.guided;
  // A guided span starts after its own count-in: its first note is an entry, after that rest.
  if (guided && met.length) met[0] = { ...met[0], entry: true, rest: Math.min(9, s.count * s.beatSec) };
  // Notes the pitch grading found nothing for aren't searched — but in a guided span a "missed"
  // note the singer clearly voiced (sung a beat late, out of its slot) still is: timing mustn't
  // rest on the pitch grade (a late entry used to come out as "Sing out").
  let unsung = ns.map((_, k) => ["unsung", "missed"].includes(take.grades[j0 + k]?.status));
  if (guided) {
    const quiet = [-Infinity, ns[0].t - (met[0]?.beat ?? s.beatSec)]; // the count-in: nobody sang there
    const cov = noteCover(feat, v.start, { songT0: s.songT0, trip, quiet }, ns, met.map((m) => m.beat));
    unsung = ns.map((_, k) => { const st = take.grades[j0 + k]?.status; return st === "unsung" || (st === "missed" && !(cov[k] >= P.PRACTICE.time.noteHeard)); });
  }
  const on = findOnsets(ns, feat, v.start, take.frames, met, { songT0: s.songT0, rt: cal ? cal.rt : null, latency: take.latency, endT: stopAt - s.songT0 - trip, unsung,
    ...(guided ? { loose: s.part.stage === "time", ...(cal ? { seedRange: P.PRACTICE.time.seedRound } : {}) } : {}) });
  // Saying the whole take was behind/ahead needs a measured round trip that's short (with a
  // long one — Bluetooth — the singer may be following the screen, which runs ahead of the
  // sound), the click guide, and no tapped timing map (the taps carry their own error).
  const st = rhythmStats(ns, on, met, ls, { calibrated: !!cal && cal.rt <= 0.1 && take.guide === "click" && !(useMap && tmap) });
  const obs = rhythmObservations(st, ls).map((o) => (o.j !== undefined ? { ...o, j: o.j + j0 } : o));
  const per = notes.map((_, j) => {
    if (j < j0 || j >= j1) return null;
    const x = st.notes[j - j0], o = on.notes[j - j0];
    return x.dev === null ? null : { dev: x.dev, rdev: x.rdev, cls: x.cls, rel: x.rel, kind: o.kind, conf: o.conf, u: met[j - j0].u };
  });
  const strict = !!cal && cal.rt <= 0.1 && take.guide === "click" && !(useMap && tmap);
  const out = { calibrated: !!cal, calLead: strict, rt: cal ? cal.rt : null, trust: "ok", lead: on.lead, leadN: on.leadN ?? null, steady: st.steady, drift: st.drift, notes: per, obs, diag };
  // Per phrase, for guided practice: a guided span's phrases, or — a free take while guiding —
  // the song's (credit for what was sung; the whole-take path above is unchanged).
  const phr = s.part?.phrases ?? (!s.part && guiding() ? psong.phrases.map((p) => p.js) : null);
  if (phr) try { out.phrases = phraseRhythm(s, v, cal, ns, met, on, j0, feat, trip, phr, per); } catch (err) { console.warn("practice: phrase rhythm", err); }
  return out;
}

// Guided practice: the timing facts practice.js judges each phrase of a span on (PhraseRhythm,
// docs/COACHING.md) — its observations, how much of it was voiced, how many of its syllables
// got an onset, and for the span's first phrase how late the first sound came after the count-in.
function phraseRhythm(s, v, cal, ns, met, on, j0, feat, trip, phr, per) {
  const groups = phr.map((js) => js.filter((j) => j - j0 >= 0 && j - j0 < ns.length).map((j) => j - j0));
  const measured = !!cal && cal.rt <= 0.1;
  const strict = measured && take.guide === "click" && !(useMap && tmap);
  const pst = rhythmStats(ns, on, met, groups, { calibrated: strict });
  const pobs = rhythmObservations(pst, groups);
  // (behind/ahead of the click: a round's own claim — a run's phrases don't each carry it)
  const takeObs = s.part && s.part.stage !== "song" ? pobs.filter((o) => o.scope === "take") : [];
  const quiet = [-Infinity, ns[0].t - (met[0]?.beat ?? s.beatSec)];
  const shiftT = take.latency - trip;
  return groups.map((g, pi) => {
    if (!g.length) return null;
    const first = ns[g[0]], last = ns[g[g.length - 1]];
    const syl = g.filter((k) => !ns[k].melisma);
    const classified = syl.filter((k) => (on.notes[k]?.conf ?? 0) >= 0.3 && on.notes[k]?.dev !== null && on.notes[k]?.dev !== undefined).length;
    const lead = on.lead ?? 0;
    const cover = voiceCover(feat, v.start, { songT0: s.songT0, trip, quiet }, [[first.t + lead, last.t + last.d + lead]])[0] ?? null;
    const beat = met[g[0]]?.beat ?? s.beatSec, u = met[g[0]]?.u ?? 0.3;
    let lag = null;
    if (pi === 0 && (s.part || g[0] === 0)) { // after the silent count-in
      const fs = firstSound(feat, v.start, take.frames, { songT0: s.songT0, trip, shiftT, from: first.t - beat, to: first.t + 4 * beat });
      lag = fs === null ? null : fs - first.t;
    } else if (g[0] > 0) {
      // A phrase after a real rest, inside a run: its first sound too — only when that rest
      // was really quiet (a singer holding the last note through it: no claim either way).
      const prev = ns[g[0] - 1], restS = first.t - (prev.t + prev.d);
      const q = [prev.t + prev.d + 0.15 + lead, first.t - 0.05 + lead];
      if (restS >= Math.max(0.5 * beat, 0.35) && q[1] - q[0] >= 0.15 && voiceCover(feat, v.start, { songT0: s.songT0, trip }, [q])[0] < 0.3) {
        const fs = firstSound(feat, v.start, take.frames, { songT0: s.songT0, trip, shiftT, from: Math.max(q[0], first.t - Math.min(beat, restS)), to: first.t + 4 * beat, quiet: q });
        lag = fs === null ? null : fs - first.t;
      }
    }
    return {
      trust: "ok", calibrated: !!cal, guide: take.guide, tapped: !!(useMap && tmap), measuredRt: measured,
      lag, beat, u, cover, classified, syllables: syl.length, // (+ notes: take.rhythm.notes where judged — prOf)
      obs: pobs.filter((o) => o.scope !== "take" && o.li === pi).map((o) => (o.j !== undefined ? { ...o, j: o.j + j0 } : o)),
      takeObs, leadN: on.leadN ?? 0, seedAgrees: on.seed !== null && on.seed !== undefined && on.lead !== null && Math.abs(on.seed - on.lead) <= tolOn(u),
    };
  });
}

// ---------------------------------------------------------------------------
// Listen / playback (score clock, no mic)

let playCtx = null;

// The playback context, ready to play. iOS: after a mic was open the session type is
// re-applied (going through "auto": setting "playback" when it already says so changes
// nothing, and set while a take's mic was still closing it left the page on the quiet
// earpiece output); a context iOS left "interrupted" (or closed) is replaced by a fresh one in
// a touch, which can then start it; and a resume that doesn't settle no longer leaves every
// later Play waiting on it. `how`:
//   "tap"   — a tap that starts the sound (Play, Listen, a key's lift): a resume still pending
//             after 1.5 s marks the context stuck, and the next tap starts over with a new one;
//   "press" — a key's touch-down: iOS starts audio only at the lift, so a long hold isn't stuck;
//   "auto"  — no touch at all (the loop's later rounds): keep the context a tap started (a new
//             one couldn't start), give its resume 4 s.
let micWasOpen = false; // a mic has been open since the session was last set to playback
let playCtxStuck = false; // its last resume in a tap didn't get it running
// (Synchronous, so a touch can make the context it may then start.)
function freshPlayCtx(how = "tap") {
  if (playCtx?.state === "running") playCtxStuck = false;
  const bad = !playCtx || playCtx.state === "closed"
    || (how !== "auto" && (playCtxStuck || playCtx.state === "interrupted"));
  if (bad) {
    if (playCtx && playCtx.state !== "closed") playCtx.close().catch(() => {});
    playCtx = new (window.AudioContext || window.webkitAudioContext)();
    playCtxStuck = false;
  }
  return playCtx;
}
async function getPlayCtx(how = "tap") {
  try {
    if (navigator.audioSession) {
      if (micWasOpen && navigator.audioSession.type === "playback") navigator.audioSession.type = "auto";
      navigator.audioSession.type = "playback";
    }
  } catch {}
  micWasOpen = false;
  const ac = freshPlayCtx(how);
  if (ac.state !== "running") await Promise.race([ac.resume().catch(() => {}), new Promise((r) => setTimeout(r, how === "auto" ? 4000 : 1500))]);
  if (ac === playCtx) playCtxStuck = how !== "press" && ac.state !== "running";
  return ac;
}

// kind: "listen" (melody) or "playback" (per playMode).
// opts: { mode (voice / melody / both, instead of the play mode), until (s), line (review row) }
async function startPlay(kind, from, opts = {}) {
  starting = "play";
  monitorSync();
  try { await beginPlay(kind, from, opts); } finally { starting = null; monitorSync(MON_RESUME); flushRemote(); }
}

let playGen = 0; // bumped by every start and stop: a start still loading checks it's current

async function beginPlay(kind, from, opts) {
  stopKeys();
  stopSession();
  const gen = ++playGen;
  const ac = await getPlayCtx(opts.how);
  if (gen !== playGen) return;
  if (ac.state !== "running") {
    statusEl.textContent = "the sound didn't start — tap again";
    return;
  }
  if (statusEl.textContent.startsWith("the sound didn't")) statusEl.textContent = "";
  const mode = opts.mode ?? playMode;
  // A take stopped before any note (in the count-in) holds nothing of yours to play back: the
  // melody instead, the whole song, in any mode (Voice used to play the song through in silence).
  const reached = !!take && take.endT !== null && notes.length > 0 && take.endT > notes[0].t + 0.2;
  const end = opts.until ?? (kind === "playback" && reached ? Math.max(take.endT, 0) : songEnd);
  if (from >= end - 0.05 || from < entryT - 1) from = entryT;
  const voice = kind === "playback" && reached ? take.voice : null;
  const wantMelody = kind === "listen" || mode !== "voice" || !voice;
  const wantVoice = kind === "playback" && voice && mode !== "melody";
  let piano = null;
  if (wantMelody) {
    if (!pianoReady(ac)) {
      statusEl.textContent = "loading piano…";
      (kind === "listen" ? listenBtn : playBtn).textContent = "Loading…";
    }
    try { piano = await loadPiano(ac); } catch (err) { console.warn(err); }
    statusEl.textContent = "";
    if (gen !== playGen) { updateButtons(); return; }
  }
  const nodes = [];
  const start = ac.currentTime + 0.1;
  const songT0 = start - from;
  keepAlive(ac, nodes);
  if (piano) {
    const [j0, j1] = opts.range ?? [0, notes.length]; // (a line: just its notes — not the held note before it)
    const items = [];
    for (const n of notes.slice(j0, j1)) {
      if (n.t + n.d <= from || n.t >= end) continue;
      const st = Math.max(n.t, from);
      items.push({ when: songT0 + st, end: songT0 + n.t + n.d, n });
    }
    // (a few seconds ahead at a time: a whole song's notes at once made WebKit choppy)
    scheduleAhead(ac, items, (it) => playPiano(ac, piano, it.when, it.end - it.when, it.n.midi, wantVoice ? 0.8 : 1.4, nodes), nodes);
  }
  if (wantVoice) playVoice(ac, voice, start, from, nodes);
  let endRes;
  const ended = new Promise((r) => { endRes = r; });
  session = { kind, ac, nodes, songT0, raf: null, end, line: opts.line ?? null, mode, ended, endRes };
  stopKeys(); // a key that started while this was loading
  updateButtons();
  const loop = () => {
    if (!session || session.ac !== ac || session.kind !== kind) return;
    nowT = ac.currentTime - songT0;
    if (nowT > end + 0.3) { session.natural = true; stopSession(); return; }
    renderLive();
    session.raf = requestAnimationFrame(loop);
  };
  session.raf = requestAnimationFrame(loop);
}

function stopSession() {
  playGen++;
  const s = session;
  if (!s) return;
  if (s.kind === "sing") { stopSing(); return; }
  session = null;
  cancelAnimationFrame(s.raf);
  for (const n of s.nodes) try { n.stop(); } catch {}
  scrollT = Math.max(0, Math.min(nowT, songEnd));
  renderAll();
  monitorSync(MON_RESUME);
  s.endRes?.(!!s.natural); // true: it played to its end (not stopped)
  flushRemote();
}

// ---------------------------------------------------------------------------
// Rendering

function renderAll() {
  if (!session) nowT = scrollT;
  renderLyrics(nowT);
  renderChips();
  renderSummary();
  updateButtons();
  renderYou();
  renderLane();
  if (psong || document.body.dataset.guided === "true") renderGuided();
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
  if (!score.verses.length) return n.name + " "; // no lyrics: show the notes
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

let shownPrev = null; // [line, perform] of the previous-line display

function renderLyrics(t) {
  if (!notes.length) return;
  const perform = performing();
  // (a guided round's count-in: its own line, not the held word of the line before)
  const sp = session?.kind === "sing" && session.part?.guided ? session.part.range[0] : -1;
  const fi = !session && preview ? preview.j : sp >= 0 && notes[sp] && t < notes[sp].t ? sp : focusNote(t);
  const li = lineOf[fi] ?? 0;
  if (li !== shownLine) {
    sylEls = new Map();
    lineHtml(li, lyricNowEl, true);
    lineHtml(li + 1, lyricNextEl, false);
    shownLine = li;
  }
  // Perform: the line just sung stays above; once it's all graded, a quiet ✓ if it went well
  // (nothing otherwise — no score mid-song).
  const prevKey = perform ? li - 1 : -1;
  if (shownPrev !== prevKey) {
    lineHtml(prevKey, lyricPrevEl, false);
    if (prevKey >= 0) lyricPrevEl.append(Object.assign(document.createElement("span"), { className: "pct" }));
    lyricPrevEl.dataset.tune = "";
    shownPrev = prevKey;
  }
  if (prevKey >= 0 && !session?.part) { // (not in guided runs: it's pitch-only and mid-take)
    const js = lines[prevKey];
    const sc = js.every((j) => take.grades[j]) ? takeScore(js.map((j) => notes[j]), js.map((j) => take.grades[j])) : null;
    const tune = sc !== null && sc >= 0.85 ? "good" : "";
    if (lyricPrevEl.dataset.tune !== tune) {
      lyricPrevEl.dataset.tune = tune;
      lyricPrevEl.querySelector(".pct").textContent = tune ? "✓" : "";
    }
  }
  // Perform: the count-in in big numbers (the lane, which shows it otherwise, is hidden).
  const counting = perform && nowT < entryT;
  if (countinEl.hidden === counting) countinEl.hidden = !counting;
  if (counting) {
    const left = String(countInLeft(session, nowT));
    if (countinEl.textContent !== left) countinEl.textContent = left;
  }
  const cur = session ? noteAt(t) : preview ? preview.j : -1;
  // The syllable a melisma note belongs to.
  let curSyl = cur;
  while (curSyl > 0 && notes[curSyl].melisma) curSyl--;
  for (const [i, span] of sylEls) {
    const g = take?.grades[i];
    // (Perform: no note-by-note colours while singing.)
    span.dataset.state = i === curSyl && cur >= 0 ? "current" : g && g.status !== "unsung" && !perform && laneMode === "on" ? g.status : "";
  }
}

// A take in Perform view: just the lyrics.
const performing = () => session?.kind === "sing" && (session.part ? session.part.view === "perform" : view === "perform");

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
    // A held syllable (melisma) draws the score's extender line instead of a word.
    const lyric = b.querySelector("i");
    if (n.melisma) {
      lyric.className = "held";
      lyric.setAttribute("aria-label", "held");
    } else lyric.textContent = n.text + (joinsNext(j) ? "-" : "");
    b.querySelector("b").textContent = n.name;
    let res = "";
    if (g?.status === "good" || g?.status === "ok") res = `✓ ${centsLabel(Math.round(g.dev * 100))}`;
    else if (g?.status === "off") res = noteName(Math.round(g.sungMidi));
    else if (g?.status === "missed") res = "missed";
    else if (g?.status === "unclear") res = "unclear";
    b.querySelector("small").textContent = res || " ";
    b.title = "Hold to hear";
    b.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || session) return; // left mouse button (touch and pen report 0); Listen: see click
      if (e.pointerType === "touch" && performance.now() - lastChipScroll < 150) return; // stopping a fling
      try { b.setPointerCapture(e.pointerId); } catch {} // mouse: the release still reaches us
      pressKey(j, e.pointerId, true);
    });
    b.addEventListener("pointerup", onPointerUp);
    b.addEventListener("pointercancel", (e) => cancelKey(e.pointerId));
    b.addEventListener("click", (e) => {
      if (session) { if (session.kind !== "sing" && !drill) seek(n.t - 0.4); return; } // a tap, not a scroll
      if (e.detail === 0) pressKey(j, "click", false); // keyboard, assistive tech
    });
    b.addEventListener("contextmenu", (e) => e.preventDefault()); // long press is a held key
    if (j === lastChip) b.dataset.current = "true";
    if ([...keys.values()].some((k) => k.j === j)) b.dataset.playing = "true";
    return b;
}

function markCurrentChip() {
  setCurrentChip(noteAt(nowT), true);
}

function setCurrentChip(i, scroll) {
  if (i === lastChip) return;
  const chips = chipsEl.querySelectorAll(".chip");
  if (lastChip >= 0 && chips[lastChip]) chips[lastChip].dataset.current = "false";
  if (i >= 0 && chips[i]) {
    chips[i].dataset.current = "true";
    if (scroll) chips[i].scrollIntoView({ block: "nearest" });
  }
  lastChip = i;
}

// ---------------------------------------------------------------------------
// Note chips are piano keys: press one (touch down / mouse down) and it sounds — the
// same piano as Listen, in the current key — for as long as it's held, then it's damped
// like a lifted key. A soft steady tone joins under the piano so a held pitch stays
// audible (holdPiano). The chip, its syllable and its lane bar light up while it sounds,
// and the cursor moves there so Listen starts from it; the chip list isn't rebuilt (it
// would jump back to the top), so you can go note by note. Each finger is its own key.
// A click with no press (keyboard, assistive tech) plays the note for its length in the
// song. During Listen / Play a tap (click, so not a scroll) jumps playback there; while
// singing, nothing.
//
// Scrolling the chip list starts on a chip too: when the browser takes the touch for a
// scroll (pointercancel) the note is cut off at once and the cursor goes back where it
// was; a touch that stops a fling (just after the list scrolled) isn't a key press.
//
// Browsers only let audio *start* on a touch's end (iOS, and the HTML spec's activation
// rules), so on a phone the very first press may only sound when the finger lifts: it then
// plays for its length in the song, and every later press sounds at once. The piano
// starts loading on that first touch (decoding works before audio is allowed), so the
// lift doesn't wait for the download; a press that still isn't sounding 1.5 s after the
// lift is dropped rather than played late.

const MIN_PRESS = 0.25;   // s: a quick tap still sounds this long
const CUT = 0.01;         // s: time constant when a scroll cancels a press
const MAX_HOLD = 60000;   // ms: a key nobody lets go of (a lost release) stops by itself
const keys = new Map();   // pointerId (or "click") → { id, j, held, ac, note, t0, timer, cap, prev }
let lastChipScroll = -1e9;

async function pressKey(j, id, held) {
  if (session) return;
  const n = notes[j];
  const old = keys.get(id);
  if (old) dropKey(old, true);
  const key = { id, j, held, ac: null, note: null, t0: 0, timer: 0, cap: 0, prev: { scrollT, nowT, chip: lastChip, practiceJ } };
  keys.set(id, key);
  practiceJ = j;
  // The pitch monitor's mic closes while a key sounds (on iPhone an open mic makes it
  // quiet); the speaker needs a moment to take over again before the note starts.
  const route = mon && (mon.stream || mon.opening) ? 0.1 : 0;
  monitorSync();
  if (held) key.cap = setTimeout(() => releaseKey(id), MAX_HOLD);
  scrollT = nowT = Math.max(-1, Math.min(n.t - 0.4, songEnd));
  showKeys();
  // The samples can load and decode before audio may start (first touch on a phone). (The
  // session is set before a context is made: getPlayCtx's first, synchronous part.)
  const ready = getPlayCtx("press");
  const loading = loadPiano(playCtx);
  loading.catch(() => {});
  if (!pianoReady(playCtx)) statusEl.textContent = "loading piano…";
  let ac = null, piano = null;
  try {
    ac = await ready;
    piano = await loading;
  } catch (err) { console.warn(err); }
  if (statusEl.textContent === "loading piano…") statusEl.textContent = "";
  if (keys.get(id) !== key) return; // pressed again, let go too long ago, or silenced
  if (session) return dropKey(key, true); // Listen / Sing started meanwhile
  if (!piano || ac !== playCtx) {
    if (!piano) statusEl.textContent = "couldn't load the piano";
    return dropKey(key);
  }
  key.ac = ac;
  key.t0 = ac.currentTime + 0.01 + route;
  // Still held: until released. Already let go (it couldn't start sooner) or a click: the
  // note's length in the song, the piano alone — as Listen plays it.
  key.note = holdPiano(ac, piano, key.t0, n.midi, 1.4, { sustain: key.held });
  if (!key.held) {
    const end = key.t0 + Math.max(0.12, n.d);
    key.note.release(end);
    clearTimeout(key.timer);
    key.timer = setTimeout(() => dropKey(key), (end - ac.currentTime) * 1000);
  }
}

// Let go of a key: damped at MIN_PRESS after it started, or now if later.
function releaseKey(id) {
  const key = keys.get(id);
  if (!key || !key.held) return; // not held (already let go, or a click)
  key.held = false;
  clearTimeout(key.cap);
  clearTimeout(key.timer);
  if (!key.note) {
    // Not sounding yet (first press on a phone): pressKey plays it for its length in the
    // song if audio starts soon; otherwise forget it rather than play it late.
    key.timer = setTimeout(() => { if (!key.note) dropKey(key); }, 1500);
    return;
  }
  const t = Math.max(key.ac.currentTime, key.t0 + MIN_PRESS);
  key.note.release(t);
  key.timer = setTimeout(() => dropKey(key), Math.max(0, t - key.ac.currentTime) * 1000);
}

// The browser took the touch for a scroll: cut the note off and put the cursor back.
function cancelKey(id) {
  const key = keys.get(id);
  if (!key) return;
  if (!session) {
    scrollT = key.prev.scrollT;
    nowT = key.prev.nowT;
    practiceJ = key.prev.practiceJ;
    setCurrentChip(key.prev.chip, false);
  }
  dropKey(key, true, CUT);
}

function dropKey(key, now = false, tc = undefined) {
  clearTimeout(key.timer);
  clearTimeout(key.cap);
  if (now && key.note) key.note.release(key.ac.currentTime, tc);
  if (keys.get(key.id) === key) keys.delete(key.id);
  showKeys();
  monitorSync(keys.size ? 0 : MON_RESUME); // the last key up: listen again once it has died away
}

// Silence every key (Listen, Sing, another song or transposition, the page hidden).
function stopKeys() {
  for (const key of [...keys.values()]) dropKey(key, true);
}

// The chips of the keys down light up; the latest one's syllable and lane bar too.
function showKeys() {
  const last = [...keys.values()].pop();
  preview = last ? { j: last.j } : null;
  const chips = chipsEl.querySelectorAll(".chip");
  const down = new Set([...keys.values()].map((k) => k.j));
  chips.forEach((c, i) => {
    const on = down.has(i) ? "true" : "false";
    if ((c.dataset.playing || "false") !== on) c.dataset.playing = on;
  });
  if (session) return; // the session draws the lane and lyrics
  if (preview) setCurrentChip(preview.j, false);
  renderLyrics(nowT);
  renderYou();
  renderLane();
}

// Releases are handled on the window (a pointer that wandered off its chip) and on the
// chip itself (WebKit sends a touch's end to the chip it started on, even if that chip
// was replaced meanwhile and so no longer reaches the window).
function onPointerUp(e) {
  if (!keys.has(e.pointerId)) return;
  // A touch's end is when phones allow audio to start: resume it here if the press couldn't.
  if (!playCtx || playCtx.state !== "running") getPlayCtx();
  releaseKey(e.pointerId);
}
window.addEventListener("pointerup", onPointerUp);
window.addEventListener("pointercancel", (e) => cancelKey(e.pointerId));
chipsEl.addEventListener("scroll", () => { lastChipScroll = performance.now(); }, { passive: true });

// Start the audio on the first tap or key anywhere (but not the Sing button, or while
// singing), so even the first chip press sounds on touch-down. The context only resumes:
// the audio session is left alone (not "playback"), so other apps' music isn't stopped
// before a note actually plays. The piano starts loading too.
function unlockPlay(e) {
  if (!e.isTrusted || session?.kind === "sing" || e.target.closest?.("#sing, #tapalong, #taptempo")) return;
  for (const t of ["pointerup", "keydown"]) document.removeEventListener(t, unlockPlay, true);
  if (freshPlayCtx().state !== "running") playCtx.resume().catch(() => {});
  loadPiano(playCtx).catch(() => {});
}
for (const t of ["pointerup", "keydown"]) document.addEventListener(t, unlockPlay, true);
window.addEventListener("blur", stopKeys);

// ---------------------------------------------------------------------------
// Pitch monitor (🎤 Pitch): the note you're singing, any time — not only during a take —
// so a note can be practised: press its chip to hear it, then sing it back and watch the
// readout (and your pitch drawn on the lane) turn green. It's compared with the chip
// pressed last, in any octave. During a take the readout follows the take's own mic.
//
// iPhone plays very quietly while a page has the mic open (see the Voice page), so the
// monitor only captures while nothing plays: its mic closes when a key goes down or
// Listen / Play / Sing start, and reopens MON_RESUME after the last key is let go (no new
// permission prompt within the page). Its AudioContext is made in the tap that turns it on.

const MON_RESUME = 300;  // ms after the last key is let go (the note's damping) before listening again
const MON_QUIET = 150;   // ms of a reopened mic not read (what's left of the note)
const YOU_WINDOW = 0.2;  // s of pitch frames the readout takes the median of
const MIC = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } };
const setSession = (type) => { try { if (navigator.audioSession) navigator.audioSession.type = type; } catch {} };
let mon = null;          // { micCtx, analyser, read, stream, source, opening, timer, raf, quietUntil }
const youFrames = [];    // recent { t (s, performance clock), midi | null }

function monitorOn() {
  if (mon) return;
  // In the tap: the context may start now and keep running between mic sessions (made
  // for recording, like the Voice page's). If a key, Listen or Play is sounding, the
  // session goes straight back to playback so it stays loud; the mic opens after.
  setSession("play-and-record");
  const micCtx = new (window.AudioContext || window.webkitAudioContext)();
  micCtx.resume().catch(() => {});
  if (keys.size || starting === "play" || (session && session.kind !== "sing")) setSession("playback");
  const analyser = micCtx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0;
  mon = { micCtx, analyser, read: createReader(analyser, micCtx.sampleRate), stream: null, pending: null, source: null, opening: false, gen: 0, timer: 0, raf: 0, quietUntil: 0 };
  youFrames.length = 0;
  monitorBtn.setAttribute("aria-pressed", "true");
  const loop = () => {
    if (!mon) return;
    mon.raf = requestAnimationFrame(loop);
    if (session) return renderYou(); // a take shows its own mic; Listen / Play: hidden, the mic is closed
    if (mon.stream && performance.now() >= mon.quietUntil) pushYou(mon.read().midi);
    renderYou();
    renderLane();
  };
  mon.raf = requestAnimationFrame(loop);
  monitorSync();
}

function monitorOff() {
  const m = mon;
  if (!m) return;
  mon = null;
  clearTimeout(m.timer);
  cancelAnimationFrame(m.raf);
  micStop(m);
  m.micCtx.close().catch(() => {});
  monitorBtn.setAttribute("aria-pressed", "false");
  if (!session) setSession("auto");
  youFrames.length = 0;
  renderYou();
  renderLane();
}

const monitorListens = () => mon && !session && !drill && !gblock && !starting && !keys.size && !document.hidden;

// Open or close the monitor's mic to match what's going on; reopening can wait `delay` ms.
function monitorSync(delay = 0) {
  if (!mon) return;
  clearTimeout(mon.timer);
  if (!monitorListens()) {
    mon.gen++; // an open still in flight is stale: dropped when it settles, then retried
    return micStop(mon);
  }
  if (mon.stream || mon.opening) return;
  if (delay) mon.timer = setTimeout(() => monitorSync(), delay);
  else micStart(mon);
}

async function micStart(m) {
  const gen = m.gen;
  const stale = () => mon !== m || m.gen !== gen;
  m.opening = true;
  setSession("play-and-record");
  let stream = null, error = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia(MIC);
    m.pending = stream; // micStop can still close it while the context resumes
    if (!stale() && m.micCtx.state !== "running") {
      await Promise.race([m.micCtx.resume(), new Promise((r) => setTimeout(r, 1000))]).catch(() => {});
    }
  } catch (err) {
    error = err;
  }
  m.opening = false;
  m.pending = null;
  if (stale()) {
    // A key, Listen or Sing interrupted the open (getPlayCtx may have switched the session
    // to playback under it, which can also make it fail): not an error, try again later.
    stream?.getTracks().forEach((t) => t.stop());
    if (mon === m) monitorSync(MON_RESUME);
    return;
  }
  if (error) {
    console.warn(error);
    monitorOff();
    showMsg(error.name === "NotAllowedError"
      ? "Mic blocked — allow it: Safari aA → Website Settings → Microphone."
      : `Couldn't open the microphone: ${error.message || error.name}`, "error");
    return;
  }
  micWasOpen = true;
  m.stream = stream;
  m.source = m.micCtx.createMediaStreamSource(stream);
  m.source.connect(m.analyser);
  m.quietUntil = performance.now() + MON_QUIET;
  youFrames.length = 0;
}

function micStop(m) {
  m.stream?.getTracks().forEach((t) => t.stop());
  m.pending?.getTracks().forEach((t) => t.stop());
  try { m.source?.disconnect(); } catch {}
  m.stream = m.source = null;
}

function pushYou(midi) {
  const t = performance.now() / 1000;
  youFrames.push({ t, midi });
  while (youFrames.length && youFrames[0].t < t - 4) youFrames.shift();
}

// The pitch you're singing now (median of the last YOU_WINDOW), or null when silent.
function currentYou() {
  const t = performance.now() / 1000;
  const win = youFrames.filter((f) => f.t >= t - YOU_WINDOW);
  const voiced = win.filter((f) => f.midi !== null).map((f) => f.midi);
  return voiced.length >= 2 && voiced.length >= win.length / 2 ? median(voiced) : null;
}

// What the readout compares you with: during a take the note due now, else the chip
// pressed last.
function youTarget() {
  // (A take: the note due at the middle of the readout's median window, so the target
  // changes when the shown pitch does.)
  if (session?.kind === "sing") return noteAt(nowT - ANALYSIS_LAG - session.latency - YOU_WINDOW / 2);
  return practiceJ >= 0 && practiceJ < notes.length ? practiceJ : -1;
}

const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };

function renderYou() {
  // Shown while Pitch is on, also during a take (its own mic) — and kept in the layout but
  // invisible during Listen / Play, so the lane doesn't change size.
  const sing = session?.kind === "sing";
  if (youEl.hidden === !!mon) youEl.hidden = !mon;
  const visible = !!mon && (!session || sing);
  if ((youEl.style.visibility === "hidden") === visible) youEl.style.visibility = visible ? "" : "hidden";
  if (!visible) return;
  const j = youTarget();
  const target = j >= 0 ? notes[j] : null;
  let state = "", big = "–", cents = "", vs = "";
  if (!sing && keys.size) {
    // A key sounds (the mic is closed meanwhile): show the note to match.
    state = "hear";
    big = target ? target.name : "♪";
    vs = "listen…";
  } else if (!sing && !mon.stream) {
    state = "wait";
    big = "…";
    vs = "mic…";
  } else {
    const m = currentYou();
    if (m !== null) {
      const r = Math.round(m);
      big = noteName(r);
      cents = centsLabel(Math.round((m - r) * 100));
    }
    if (!target) vs = sing ? "" : "tap a note";
    else if (m === null) vs = `sing ${target.name}`;
    else {
      const d = fold(m - target.midi);
      const a = Math.abs(d) * 100;
      state = a <= GOOD_CENTS ? "good" : a <= OK_CENTS ? "ok" : "off";
      vs = `${a <= OK_CENTS ? "✓" : d < 0 ? "↑" : "↓"} ${target.name}`;
    }
  }
  if ((youEl.dataset.state || "") !== state) youEl.dataset.state = state;
  setText(youNoteEl, big);
  setText(youCentsEl, cents || "\u00a0");
  setText(youVsEl, vs || "\u00a0");
  youVsEl.title = state === "off" ? (vs.startsWith("↑") ? "sing higher" : "sing lower") : "";
}

monitorBtn.addEventListener("click", () => {
  if (mon) monitorOff();
  else {
    showMsg("");
    monitorOn();
  }
  renderYou();
  renderLane();
});

// ---------------------------------------------------------------------------
// Phrase loop: one line over and over — hear it (the melody, with the mic closed so it's
// loud on a phone), then sing it after a bar of count-in (graded like a take, grade.js),
// then see how it went (coach.js) — until Stop. The whole-song take is put back after.

let drill = null; // { li, range: [j0, j1), from, until, token, round, scores, phase, last, savedTake, ac }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startLoop(li) {
  if (!lines[li]?.length || session?.kind === "sing") return;
  stopLoop();
  closeReview();
  stopKeys();
  const js = lines[li];
  const j0 = js[0], j1 = js[js.length - 1] + 1;
  let m = 0;
  score.measures.forEach((q, i) => { if (q <= notes[j0].q + 1e-6) m = i; });
  const last = notes[j1 - 1];
  // In the tap: the mic's context is made for recording, then the playback context
  // starts (getPlayCtx, in startPlay) — so later rounds can start both without a tap.
  setSession("play-and-record");
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  ac.resume().catch(() => {});
  drill = {
    li, range: [j0, j1], from: qToT(score.measures[m]), fromQ: score.measures[m], fromM: m, until: last.t + last.d + MAX_SHIFT + 0.3,
    token: {}, round: 0, scores: [], phase: "", last: null, savedTake: take?.part ? drill?.savedTake ?? null : take, ac,
  };
  showMsg("");
  monitorSync();
  updateButtons();
  runLoop(drill);
}

async function runLoop(d) {
  const alive = () => drill === d;
  while (alive()) {
    d.round++;
    d.phase = "listen";
    renderLoop();
    if (!notes[d.range[0]]) return stopLoop();
    await startPlay("listen", Math.max(0, notes[d.range[0]].t - 0.3), { until: d.until - MAX_SHIFT, line: d.li, range: d.range, how: d.round > 1 ? "auto" : "tap" });
    if (!alive()) return;
    const heard = await session?.ended;
    if (!alive()) return;
    if (!heard) return stopLoop(); // the listen was cut short (Stop, another start): don't sing on
    await sleep(250);
    if (!alive()) return;
    d.phase = "sing";
    renderLoop();
    await startSing({ from: d.from, fromQ: d.fromQ, fromM: d.fromM, until: d.until, range: d.range, ac: d.ac, token: d.token });
    if (!alive()) return;
    const t = await session?.ended;
    if (!alive() || !t) return;
    const row = analyzeLines(notes, [lines[d.li]], t.grades, { text: () => lineText(d.li), name: noteName, syl: (j) => sylText(notes[j], j), rhythm: t.rhythm, lineIndex: [d.li] })[0];
    if (row && t.rhythm?.trust === "ok") {
      for (const o of t.rhythm.obs) {
        if (o.scope !== "take" || o.tone !== "try" || (o.kind !== "behind" && o.kind !== "ahead")) continue;
        row.reasons.push({ kind: o.kind, text: rhythmText(o, () => ""), rhythm: true });
        row.good = false;
        row.weak = true;
      }
    }
    d.last = row || null;
    d.scores.push(row ? row.score : null);
    d.phase = "result";
    renderLoop();
    await sleep(2400);
  }
}

// Stop looping (msg: why, shown as an error) and put the whole-song take back.
function stopLoop(msg) {
  const d = drill;
  if (!d) return;
  drill = null;
  if (session) stopSession();
  playGen++;
  take = takeFits(d.savedTake) ? d.savedTake : null;
  reviewRows = [];
  d.ac.close().catch(() => {});
  if (lines[d.li]) cursorToLine(d.li);
  renderAll();
  monitorSync(MON_RESUME);
  if (msg) showMsg(msg, "error");
  flushRemote();
}

function renderLoop() {
  const d = drill;
  if (!d) return;
  const text = $("lp-text");
  let line = "", tune = "";
  if (d.phase === "listen") line = `Round ${d.round} · listen…`;
  else if (d.phase === "sing") line = `Round ${d.round} · your turn`;
  else if (d.phase === "result") {
    // A next step, or ✓ — never a score (d.scores keeps the numbers, as data).
    const r = d.last;
    tune = r?.good ? "good" : "";
    line = r?.good ? "✓ That's it" : r?.reasons[0]?.text || "Again";
  }
  text.textContent = line;
  text.dataset.tune = tune;
  updateButtons();
}

loopBtn.addEventListener("click", () => startLoop(shownLine));

// Put the cursor at the start of line li (just before it, unless that's still inside the
// line before — then the lyrics would show that one).
function cursorToLine(li) {
  const t0 = notes[lines[li][0]].t;
  const k = noteAt(t0 - 0.5);
  scrollT = Math.max(-1, k >= 0 && lineOf[k] !== li ? t0 : t0 - 0.5);
}

// ---------------------------------------------------------------------------
// Guided practice (practice.js plans, coach.js words; docs/COACHING.md)
//
// One card under the lane: the next step (one button — the footer's right one), what went well
// and at most one thing to try. A step runs by itself: Hear it (Listen to the first section),
// a run (a span of phrases, Perform view, lane off, recorded), or a phrase's block of rounds —
// listen → your turn → result — until practice.js says it's secured, moves on or asks.
// Nothing here decides: practice.js does (pure), this file plays, listens and shows.

const PK = { doc: "resonate.sing.practice", session: "resonate.sing.session", guided: "resonate.sing.guided" };
let guidedOn = recall(PK.guided) !== "off";
let pdoc = null;      // this song's practice doc (practice.js), saved per song under PK.doc
let psess = null;     // the practice session (device only, PK.session)
let psong = null;     // { phrases, sections } — groupPhrases of the song as it's shown (verse)
let pstep = null;     // the step on the card (nextStep / pickPhrase)
let gblock = null;    // a step under way: { step, token, phase, baseRate, ac, last, wait, voice }
let cardRes = null;   // the last result: { win, cue, play } (coach.js), shown under the title
let cardGlow = 0;     // until when the card glows (a stage secured)
let mapNew = new Set(); // phrases whose marks just moved (the map pulses them)
let lastRound = null;   // the last round or run: { tk, extra } — More → Tools → ⤓ (real takes, to tune PRACTICE)
let winsShown = [];     // the win texts shown lately (newest last), so they rotate
let guideQuiet = 0;     // footer taps are ignored until then (just after a step stopped)
let cursorFor = null;   // the step the lane and lyrics were last moved to
const coachEl = $("coach"), coTitle = $("co-title"), coRes = $("co-res"), coWin = $("co-win"), coCue = $("co-cue"), coPlay = $("co-play"), coBtns = $("co-btns");
const mapEl = $("map"), moreEl = $("more");

const guiding = () => guidedOn && !!score && notes.length > 0 && !!psong?.phrases.length;
const readAll = (k) => { try { return JSON.parse(recall(k) || "{}") || {}; } catch { return {}; } };

// The song's own seconds per quarter — a typed/tapped tempo, else the score's — never the
// tempo % (phrases mustn't regroup when the singer slows the song down).
function songSpq() {
  const e = timingEntry();
  if (e?.bpm) return 60 / e.bpm;
  if (tmap?.avg) return tmap.avg;
  return 60 / (score.tempo || 90);
}
const barQAt = (q) => { const [b, t] = meterAt(measureAt(q)); return (b * 4) / t; };

// After applySong: this verse's phrases, and the song's practice state.
let pdocId = null; // the song pdoc belongs to
function loadPractice() {
  stopGuided();
  if (pdocId !== songId) { thenNow = null; thenNowFresh = false; lastRound = null; mapNew.clear(); cardGlow = 0; winsShown = []; }
  psong = null;
  pstep = null;
  cardRes = null;
  if (!score || !notes.length || !songId) return renderGuided();
  try {
    psong = P.groupPhrases(notes, lines, { spq: songSpq(), barQAt, measureOf: score.measureOf || null });
  } catch (err) { console.warn("practice: grouping", err); psong = null; }
  pdoc = readAll(PK.doc)[songId] || P.newDoc();
  pdocId = songId;
  const s = readAll(PK.session);
  psess = P.sessionFor(s && s.songId ? s : null, songId, Date.now());
  // A song sung here before (history, a saved take) has been heard: no "Hear it first".
  if (!pdoc.heard && (readHistory()[songId]?.length || take)) pdoc = P.markHeard(pdoc, Date.now());
  renderGuided();
  // ▶ Then → Now stays available (More) for as long as its recordings are here.
  const sid = songId;
  storedThenNow().then((x) => { if (songId === sid) { thenNow = x; renderGuided(); } }, () => {});
}
function savePractice() {
  if (!pdocId || !pdoc || pdocId !== songId || spaceChanged()) return;
  pdoc.lastAt = Date.now();
  const all = readAll(PK.doc);
  all[pdocId] = pdoc;
  store(PK.doc, JSON.stringify(all));
  store(PK.session, JSON.stringify({ ...psess, songId: pdocId, lastAt: Date.now() }));
}
// The plan's next step (a session that went quiet for 3 h starts a new one).
function planNext() {
  psess = P.sessionFor(psess, songId, Date.now());
  return P.nextStep(pdoc, psong, psess, Date.now());
}

// --- The card, the map, More ---------------------------------------------------

function renderGuided() {
  const on = guiding();
  const g = on ? "true" : "false";
  if (document.body.dataset.guided !== g) document.body.dataset.guided = g;
  mapEl.hidden = !on;
  coachEl.hidden = !on || performing();
  if (!on) return;
  if (!gblock && !pstep) { pstep = planNext(); updateButtons(); }
  const step = gblock?.step || pstep;
  const label = P.stepLabel(step, psong);
  // Title: the step (or, mid-step, what's happening).
  const ph = gblock?.phase;
  const checking = gblock?.phase === "wait" || (!gblock && step?.kind === "selfcheck");
  const name = (i) => { const p = psong.phrases[i]; return p ? (p.words ? `“${P.phraseName(p, 3)}”` : P.phraseName(p, 3)) : ""; };
  coTitle.textContent = "";
  coTitle.append(checking ? `Sounded right? ${name(step.p)}` : label.title);
  if (ph === "listen") coTitle.append(Object.assign(document.createElement("span"), { className: "co-sub", textContent: " · listen" }));
  if (!gblock && label.note) coTitle.append(Object.assign(document.createElement("span"), { className: "co-sub", textContent: ` · ${label.note}` }));
  // The lane and lyrics show the step's line when it changes (not while the singer pans).
  if (!gblock && !session && step && step !== cursorFor && psong.phrases[step.p ?? step.from]) {
    cursorFor = step;
    cursorToLine(lineOf[psong.phrases[step.p ?? step.from].j0]);
    nowT = scrollT;
    renderLyrics(nowT);
    renderLane();
  }
  // The result line: a win and/or one cue (kept on through the next listen; the self-check
  // asks instead of repeating the fault).
  const res = cardRes;
  const cue = checking ? null : res?.cue;
  coRes.hidden = !res || (!res.win && !cue);
  coWin.textContent = res?.win ? (res.win.text.includes("✓") ? res.win.text : `✓ ${res.win.text}`) : "";
  coCue.textContent = cue ? cue.text : "";
  coPlay.hidden = !res?.cue?.play || (!!gblock && gblock.phase !== "wait");
  // Buttons on the card: only for questions (the self-check) and Then → Now.
  coBtns.textContent = "";
  if (gblock?.phase === "wait" || (!gblock && pstep?.kind === "selfcheck")) {
    coBtns.append(cardBtn("✓ Yes", "yes", true), cardBtn("Again", "again"));
    if (gblock?.voice) coBtns.append(cardBtn("▶ You", "you"));
  } else if (!gblock && thenNow && (thenNowFresh || session?.kind === "thennow")) coBtns.append(cardBtn(session?.kind === "thennow" ? "■ Stop" : "▶ Then → Now", "thennow"));
  coBtns.hidden = !coBtns.childElementCount;
  coachEl.dataset.glow = Date.now() < cardGlow ? "true" : "false";
  renderMap();
}
function cardBtn(text, act, go = false) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  b.dataset.act = act;
  if (go) b.className = "go";
  return b;
}

function phraseState(i) {
  const m = P.phraseMarks(pdoc, psong.phrases[i]);
  return m.song ? "song" : m.tune ? "tune" : m.time ? "time" : "";
}
function renderMap() {
  const strip = mapEl.firstElementChild;
  const ps = psong.phrases;
  if (strip.childElementCount !== ps.length) {
    strip.textContent = "";
    for (const p of ps) strip.append(Object.assign(document.createElement("i"), { title: p.name }));
  }
  const step = gblock?.step || pstep;
  const cur = step?.kind === "stage" ? step.p : -1;
  const total = ps.reduce((a, p) => a + p.sec, 0) || 1;
  ps.forEach((p, i) => {
    const el = strip.children[i];
    el.style.flex = `${Math.max(0.5, (p.sec / total) * 100)} 1 0`;
    const m = phraseState(i);
    if (el.dataset.m !== m) el.dataset.m = m;
    el.dataset.cur = i === cur || (cur >= 0 && ps[cur].mk === p.mk) ? "true" : "false";
    el.dataset.new = mapNew.has(i) ? "true" : "false";
  });
}

// --- Running a step ------------------------------------------------------------------

// A phrase's PhraseRhythm from a take, with the take's per-note rhythm the verdicts read.
const prOf = (tk, k) => { const r = tk?.rhythm?.phrases?.[k]; return r ? { ...r, notes: tk.rhythm.notes } : null; };
const sleepG = (ms, b) => new Promise((r) => { const t = setTimeout(r, ms); b && (b.cancel = () => { clearTimeout(t); r(); }); });
const spanOf = (p0, p1) => {
  const a = psong.phrases[p0], b = psong.phrases[p1];
  const j0 = a.j0, j1 = b.j1;
  const m = measureAt(notes[j0].q);
  const last = notes[j1 - 1];
  return { j0, j1, from: qToT(score.measures[m]), fromQ: score.measures[m], fromM: m, end: last.t + last.d };
};

// The plan's button (the footer's right one).
function runPlan() {
  if (!guiding()) return;
  if (gblock) return stopGuided();
  const step = pstep;
  if (!step) return;
  if (Date.now() < guideQuiet) return;
  thenNowFresh = false;
  cardRes = null;
  if (step.kind === "hear") return runHear(step);
  if (step.kind === "selfcheck") { answerCheck(step, false); return runPlan(); } // (the footer is "Again"; Yes is on the card)
  if (step.kind === "stage") return runBlock(step);
  return runSpan(step); // first, run, singon, through, finish
}

// In the tap: the mic's context (later rounds start without a tap, like the phrase loop).
function tapContext() {
  setSession("play-and-record");
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  ac.resume().catch(() => {});
  return ac;
}

function stopGuided() {
  const b = gblock;
  if (!b) return;
  // Hear it stopped once a phrase has played still counts (decided now: the lane moves on below).
  if (b.step.kind === "hear" && nowT >= psong.phrases[b.step.from].t1) { pdoc = P.markHeard(pdoc, Date.now()); savePractice(); }
  gblock = null;
  b.cancel?.();
  b.waitRes?.(null);
  if (session) session.kind === "sing" ? stopSing() : stopSession();
  playGen++;
  retime(b.baseRate);
  laneMode = "on";
  b.ac?.close?.().catch(() => {});
  take = b.sid === songId && takeFits(b.savedTake) ? b.savedTake : take?.part ? null : take;
  guideQuiet = Date.now() + 400; // (a double tap on ■ Stop doesn't start the step again)
  pstep = planNext();
  monitorSync(MON_RESUME);
  renderAll();
  renderGuided();
  flushRemote();
}

async function runHear(step) {
  const b = gblock = { step, token: {}, phase: "listen", baseRate: rate, sid: songId };
  const ps = psong.phrases;
  const t0 = ps[step.from].t0, t1 = ps[step.to].t1;
  renderGuided();
  await startPlay("listen", Math.max(0, t0 - 0.3), { until: t1 + 0.3, range: [ps[step.from].j0, ps[step.to].j1], how: "tap" });
  const ok = await session?.ended;
  // Stopping early (the button) still counts once a phrase has played.
  if (ok || nowT >= ps[step.from].t1) { pdoc = P.markHeard(pdoc, Date.now()); savePractice(); }
  if (gblock !== b) { if (!gblock) { pstep = planNext(); renderAll(); } return; }
  gblock = null;
  pstep = planNext();
  monitorSync(MON_RESUME);
  renderAll();
  renderGuided();
}

// A run (the first run, a run, Sing on, Sing from here, Sing it through): the span from
// phrase `from` to `to` in Perform view with the lane off, clicks, the song's tempo; recorded.
async function runSpan(step) {
  const ac = tapContext();
  const b = gblock = { step, token: {}, phase: "sing", baseRate: rate, ac, savedTake: take?.part ? null : take, setup: step.setup, sid: songId };
  closeReview();
  stopKeys();
  const sp = spanOf(step.from, step.to);
  laneMode = "off";
  renderGuided();
  const covered = [];
  for (let i = step.from; i <= step.to; i++) covered.push(i);
  await startSing({
    guided: true, from: sp.from, fromQ: sp.fromQ, fromM: sp.fromM, until: sp.end + 0.8, range: [sp.j0, sp.j1], ac, token: b.token,
    guide: "click", view: "perform", lane: "off", stage: "song", record: true, phrases: covered.map((i) => psong.phrases[i].js),
  });
  if (gblock !== b) return;
  const t = await session?.ended;
  if (gblock !== b) return;
  gblock = null;
  laneMode = "on";
  b.ac.close().catch(() => {});
  monitorSync(MON_RESUME);
  if (!t) { pstep = planNext(); renderAll(); return renderGuided(); }
  // The phrases this run sang to their end (a run stopped early covers only those: a phrase cut
  // a note in mustn't be judged — or credited — on that note).
  const reached = covered.filter((i) => wholly(psong.phrases[i], t));
  const results = reached.map((i) => {
    const ph = psong.phrases[i], r = prOf(t, covered.indexOf(i));
    return { time: P.timeVerdict({ ph, r, grades: t.grades, notes, tapped: useMap && !!tmap }), tune: P.tuneVerdict({ ph, r, grades: t.grades, notes }) };
  });
  lastRound = { tk: t, extra: { run: step.kind, phrases: reached.map((i) => psong.phrases[i].name), results } };
  applyRunResult(t, reached, results, { rate: 1, guide: "click", first: step.kind === "first", at: Date.now(), kind: step.kind });
  take = b.sid === songId && takeFits(b.savedTake) ? b.savedTake : null; // the run isn't the song's take
  pstep = planNext();
  renderAll();
  renderGuided();
}

// A run's (or a free take's) verdicts → marks, the card's words, the recordings.
async function applyRunResult(t, reached, results, run) {
  const firstReach = reached.filter((i) => !P.phraseMarks(pdoc, psong.phrases[i]).reached);
  const out = P.applyRun(pdoc, psess, psong, reached, results, run, Date.now());
  pdoc = out.doc; psess = out.session;
  mapNew = new Set((out.moved || []).map(([i]) => i));
  setTimeout(() => { mapNew.clear(); renderGuided(); }, 3000);
  savePractice();
  const rr = runResult(out.moved || [], out.improved || [], psong);
  const wins = [rr.headline, rr.win].filter(Boolean);
  cardRes = wins.length ? { win: { text: wins.join(" · ") }, cue: null } : null;
  if ((out.moved || []).length) { cardGlow = Date.now() + 1500; setTimeout(renderGuided, 1600); }
  renderGuided();
  const passed = reached.filter((i, k) => !/^(try|slip)$/.test(results[k]?.time?.v) && !/^(try|slip)$/.test(results[k]?.tune?.v));
  await keepRunAudio(t, reached, { ...out, firstReached: firstReach, passed });
  renderGuided();
}

const wholly = (ph, tk) => ph.js.every((j) => tk.grades[j] && tk.grades[j].status !== "unsung");
// A free take (More → Sing it through, an assistant's take…) while guiding: credit for what
// was sung (its own guide: the melody guide gives no ♩).
function guidedAfterTake(tk) {
  if (!guiding() || !tk || tk.part || spaceChanged()) return;
  const rs = tk.rhythm?.phrases || [];
  const reached = psong.phrases.map((p, i) => i).filter((i) => wholly(psong.phrases[i], tk));
  if (!reached.length) return;
  const results = reached.map((i) => {
    const ph = psong.phrases[i], r = rs[i] ? { ...prOf(tk, i), takeObs: [] } : null;
    return { time: P.timeVerdict({ ph, r, grades: tk.grades, notes, tapped: useMap && !!tmap }), tune: P.tuneVerdict({ ph, r, grades: tk.grades, notes }) };
  });
  applyRunResult(tk, reached, results, { rate: tk.rate / rate, guide: tk.guide, first: !pdoc.firstRun, at: Date.now(), kind: "through" }).then(() => { pstep = planNext(); renderGuided(); });
}

// A phrase's block: rounds until practice.js secures the stage, moves on or asks.
async function runBlock(step) {
  const ac = tapContext();
  const b = gblock = { step, token: {}, phase: "", baseRate: rate, ac, savedTake: take?.part ? null : take, setup: step.setup, round: 0, sid: songId };
  closeReview();
  stopKeys();
  const ph = psong.phrases[step.p];
  const alive = () => gblock === b;
  while (alive()) {
    b.round++;
    const setup = b.setup;
    retime(b.baseRate * (setup.rate || 1));
    b.check = null;
    cursorToLine(lineOf[ph.j0]);
    // Listen first (the melody, mic closed).
    if (setup.listen) {
      b.phase = "listen";
      laneMode = "on";
      renderGuided();
      await startPlay("listen", Math.max(0, ph.t0 - 0.3), { until: ph.t1 + 0.2, range: [ph.j0, ph.j1], how: b.round > 1 ? "auto" : "tap" });
      if (!alive()) return;
      const heard = await session?.ended;
      if (!alive()) return;
      if (!heard) return stopGuided();
      await sleepG(250, b);
      if (!alive()) return;
    }
    // Your turn.
    b.phase = "sing";
    laneMode = laneOf(setup);
    renderGuided();
    const sp = spanOf(step.p, step.p);
    await startSing({
      guided: true, from: sp.from, fromQ: sp.fromQ, fromM: sp.fromM, until: sp.end + MAX_SHIFT + 0.3, range: [sp.j0, sp.j1], ac, token: b.token,
      guide: "click", view: "practice", lane: laneMode, stage: step.stage, record: true, phrases: [ph.js],
    });
    if (!alive()) return;
    const t = await session?.ended;
    if (!alive() || !t) return;
    b.voice = t.voice;
    // The verdict, the words, the plan.
    const r = prOf(t, 0);
    const tv = P.timeVerdict({ ph, r, grades: t.grades, notes, tapped: useMap && !!tmap });
    const uv = P.tuneVerdict({ ph, r, grades: t.grades, notes });
    const v = step.stage === "time" ? tv : uv;
    b.last = { r, tv, uv }; // (resonateDebug: what the verdicts were made of)
    lastRound = { tk: t, extra: { phrase: ph.name, stage: step.stage, setup, r: r && { ...r, notes: undefined }, time: tv, tune: uv } };
    const out = P.applyRound(pdoc, psess, ph, step.stage, step.stage === "time" ? { ...tv, tune: uv } : v, setup, Date.now());
    pdoc = out.doc; psess = out.session;
    // (the wins shown lately: roundResult rotates between the true ones instead of repeating one)
    cardRes = roundResult(step.stage, { ...v, fullSpeed: out.fullSpeed, shown: winsShown.slice(-6) }, b.lastCue, notes, ph);
    if (cardRes?.win?.text) winsShown.push(cardRes.win.text);
    if (v.cue) b.lastCue = v.cue;
    b.phase = "result";
    cursorToLine(lineOf[ph.j0]); // (the lane and lyrics back on the round's line, where the card is)
    renderAll();
    savePractice();
    if (out.event === "secured") {
      const stages = step.stage === "time" && out.alsoTune ? ["time", "tune"] : [step.stage];
      cardRes = { win: { text: securedText(ph, stages) }, cue: null };
      cardGlow = Date.now() + 1500;
      setTimeout(renderGuided, 1600);
      mapNew = new Set([step.p]);
      setTimeout(() => { mapNew.clear(); renderGuided(); }, 3000);
      return endBlock(b);
    }
    if (out.event === "rotate" || out.event === "park") {
      cardRes = { win: cardRes?.win || null, cue: { text: "Back to this one later", good: true } };
      return endBlock(b);
    }
    if (out.event === "self-check") {
      b.phase = "wait";
      renderGuided();
      for (;;) {
        const ans = await new Promise((res) => { b.waitRes = res; });
        if (!alive() || ans === null) return;
        if (ans === "you") { playRoundVoice(b); continue; }
        const r2 = P.answerSelfCheck(pdoc, psess, ph, step.stage, ans === "yes", Date.now());
        pdoc = r2.doc; psess = r2.session;
        savePractice();
        if (ans === "yes") {
          cardRes = { win: { text: securedText(ph, [step.stage]) }, cue: null };
          cardGlow = Date.now() + 1500;
          setTimeout(renderGuided, 1600);
          return endBlock(b);
        }
        break;
      }
    }
    // The next round: the plan's, while it's the same block (same, confirm, slower…).
    const nxt = planNext();
    if (nxt.kind !== "stage" || !nxt.cont || nxt.p !== step.p || nxt.stage !== step.stage) return endBlock(b, nxt);
    b.setup = nxt.setup;
    b.step = { ...step, ...nxt };
    renderGuided();
    await sleepG(1600, b);
  }
}
const laneOf = (setup) => (setup.lane === "off" ? "off" : setup.lane === "neutral" ? "neutral" : setup.trail === false ? "bars" : "on");
// The self-check on the card when no block is running (after a reload): Yes secures it.
function answerCheck(step, yes) {
  const ph = psong.phrases[step.p];
  if (!ph) return;
  const r = P.answerSelfCheck(pdoc, psess, ph, step.stage, yes, Date.now());
  pdoc = r.doc; psess = r.session;
  savePractice();
  if (yes) { cardRes = { win: { text: securedText(ph, [step.stage]) }, cue: null }; cardGlow = Date.now() + 1500; setTimeout(renderGuided, 1600); }
  pstep = planNext();
  renderGuided();
}
function endBlock(b, nxt = null) {
  if (gblock !== b) return;
  gblock = null;
  retime(b.baseRate);
  laneMode = "on";
  b.ac?.close?.().catch(() => {});
  take = b.sid === songId && takeFits(b.savedTake) ? b.savedTake : null;
  pstep = nxt || planNext();
  monitorSync(MON_RESUME);
  renderAll();
  renderGuided();
  flushRemote();
}

// --- Then → Now: the same lines from the first try and from now ------------------------------
// A run keeps its recording on this device: "then" — the part that first reached some phrases
// (kept for good) — and "now" — the latest run at the song's tempo. ▶ Then → Now plays one
// excerpt of phrases that went better now, then 0.6 s, then the same phrases now.

let thenNow = null; // { then, now (clips), a, b: [t0, t1] in each clip's own song seconds } — in More (Today)
let thenNowFresh = false; // …and on the card, right after the run that improved

// Cut a take's recording (song seconds) down to [t0, t1] and pack it (16-bit, half rate).
function clipOf(v, t0, t1) {
  const sr = v.sampleRate;
  const a = Math.max(0, Math.floor((t0 - v.start) * sr)), z = Math.min(v.data.length, Math.ceil((t1 - v.start) * sr));
  if (z - a < sr * 0.3) return null;
  return packVoice({ data: v.data.subarray(a, z), sampleRate: sr, start: v.start + a / sr, gain: v.gain });
}
async function keepRunAudio(t, reached, out) {
  if (!t.voice || spaceChanged() || !songId || !reached.length) return;
  const sid = songId, ps = psong.phrases; // (the song may change while this awaits)
  const span = (is) => [Math.min(...is.map((i) => ps[i].t0)) - 0.5, Math.max(...is.map((i) => ps[i].t1)) + 0.5];
  const spans = (is) => Object.fromEntries(is.map((i) => [ps[i].wk, [ps[i].t0, ps[i].t1]]));
  const at = Date.now();
  try {
    // "then": the phrases this run reached for the first time.
    const first = (out.firstReached || []).filter((i) => reached.includes(i));
    if (first.length) {
      const [a, z] = span(first);
      const c = clipOf(t.voice, a, z);
      if (c) await putClip(`${sid}#then#${at.toString(36)}`, { ...c, at, rate, spans: spans(first) });
    }
    // "now": this run (the song's tempo — a run always is).
    const [a, z] = span(reached);
    const c = clipOf(t.voice, a, z);
    if (c) await putClip(`${sid}#now`, { ...c, at, rate, spans: spans(reached), ok: (out.passed || []).map((i) => ps[i].wk) });
    // Offer it when some phrase went better now than in its first try.
    const x = await storedThenNow(sid, ps);
    if (songId === sid) { thenNow = x; thenNowFresh = !!x && (out.improved || []).length > 0; }
  } catch (err) { console.warn("practice: recording", err); }
}
// The excerpt to play: phrases that went better than their first try (practice.js marks them,
// w.then.told), sung well in the latest run ("now".ok) and kept in one "then" clip — the first
// such phrase and the ones after it that fit in 30 s.
async function storedThenNow(sid = songId, ps = psong?.phrases || []) {
  const now = await getClip(`${sid}#now`);
  if (!now?.ok?.length) return null;
  const better = new Set(ps.filter((p) => pdoc?.w?.[p.wk]?.then?.told && now.ok.includes(p.wk)).map((p) => p.wk));
  if (!better.size) return null;
  const thens = (await listClips(sid)).filter((c) => c.songId.includes("#then#"));
  let best = null;
  for (const th of thens) {
    const wks = [...better].filter((wk) => th.spans?.[wk] && now.spans?.[wk]);
    if (wks.length && (!best || wks.length > best.wks.length)) best = { then: th, now, wks };
  }
  if (!best) return null;
  const pick = best.wks.map((wk) => [wk, ...best.now.spans[wk]]).sort((x, y) => x[1] - y[1]), run = [pick[0]];
  for (const x of pick.slice(1)) { if (x[2] - run[0][1] > 30) break; run.push(x); }
  const keep = run.map((x) => x[0]);
  const rng = (c) => { const s = keep.map((wk) => c.spans[wk]); return [Math.min(...s.map((x) => x[0])) - 0.3, Math.max(...s.map((x) => x[1])) + 0.3]; };
  return { then: best.then, now: best.now, a: rng(best.then), b: rng(best.now), wks: keep };
}
function playClip(ac, c, when, t0, t1, nodes) {
  const v = unpackVoice(c);
  const buf = ac.createBuffer(1, v.data.length, v.sampleRate);
  buf.copyToChannel(v.data, 0);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = v.gain;
  src.connect(g);
  g.connect(ac.destination);
  const off = Math.max(0, t0 - v.start);
  const dur = Math.max(0.1, t1 - Math.max(t0, v.start));
  src.start(when + Math.max(0, v.start - t0), off, dur);
  nodes.push(src);
  return dur + Math.max(0, v.start - t0);
}
async function playThenNow(x) {
  stopSession();
  const gen = ++playGen;
  const ac = await getPlayCtx("tap");
  if (gen !== playGen || ac.state !== "running") return;
  const nodes = [];
  keepAlive(ac, nodes);
  const t = ac.currentTime + 0.1;
  const d1 = playClip(ac, x.then, t, x.a[0], x.a[1], nodes);
  const d2 = playClip(ac, x.now, t + d1 + 0.6, x.b[0], x.b[1], nodes);
  let endRes;
  const ended = new Promise((r) => { endRes = r; });
  session = { kind: "thennow", ac, nodes, songT0: 0, raf: null, end: Infinity, ended, endRes };
  updateButtons();
  renderGuided();
  const me = session;
  setTimeout(() => { if (session === me) { session.natural = true; stopSession(); renderGuided(); } }, (d1 + 0.6 + d2 + 0.3) * 1000);
}
function playRoundVoice(b) {
  if (!b.voice) return;
  const ph = psong.phrases[b.step.p];
  getPlayCtx("tap").then((ac) => {
    if (ac.state !== "running") return;
    stopSession();
    const nodes = [];
    playVoice(ac, b.voice, ac.currentTime + 0.05, Math.max(b.voice.start, ph.t0 - 0.5), nodes);
    const me = session = { kind: "playback", ac, nodes, songT0: 0, raf: null, end: Infinity, ended: Promise.resolve(true), endRes() {} };
    setTimeout(() => { if (session === me) { session.natural = true; stopSession(); } }, (ph.t1 - ph.t0 + 1) * 1000);
  });
}

// --- More: the song's lines (the map as rows), Then → Now, tools ----------------------------

function openMore() {
  if (!guiding()) return;
  renderMore();
  moreEl.hidden = false;
}
function closeMore() { moreEl.hidden = true; }
function renderMore() {
  const rows = $("mo-lines");
  rows.textContent = "";
  const seen = new Map();
  psong.phrases.forEach((p, i) => {
    if (seen.has(p.wk)) { const r = seen.get(p.wk); r.n++; r.sub.textContent = `×${r.n}`; return; }
    const m = P.phraseMarks(pdoc, p);
    const row = document.createElement("div");
    row.className = "mo-row";
    row.dataset.cur = (gblock?.step || pstep)?.p === i ? "true" : "false";
    const marks = document.createElement("span");
    marks.className = "mo-marks";
    marks.innerHTML = `<b class="t" data-on="${m.time}" aria-label="in time">♩</b><b data-on="${m.tune}" aria-label="in tune">♪</b><b data-on="${m.song}" aria-label="in the song">✓</b>`;
    const text = Object.assign(document.createElement("button"), { type: "button", className: "mo-text", textContent: p.words || p.name });
    text.addEventListener("click", () => { closeMore(); if (gblock) stopGuided(); pstep = P.pickPhrase(pdoc, psong, psess, i, Date.now()); cardRes = null; cursorToLine(lineOf[p.j0]); renderAll(); renderGuided(); });
    const sub = Object.assign(document.createElement("span"), { className: "mo-sub", textContent: m.slower ? "slower" : "" });
    const from = Object.assign(document.createElement("button"), { type: "button", className: "mo-from", textContent: "▶ from here" });
    from.addEventListener("click", () => {
      closeMore();
      if (gblock) stopGuided();
      pstep = P.singFromHere(pdoc, psong, i) || pstep;
      cardRes = null;
      renderGuided();
      runPlan();
    });
    row.append(marks, text, sub, from);
    rows.append(row);
    seen.set(p.wk, { n: 1, sub });
  });
  const today = $("mo-today");
  today.textContent = "";
  // Other: the next-best step, and the ways past this one (I know it, timing's fine).
  const step = pstep;
  const other = (text, fn) => { const b = Object.assign(document.createElement("button"), { type: "button", className: "co-chip", textContent: text }); b.addEventListener("click", () => { closeMore(); if (gblock) stopGuided(); fn(); cardRes = null; renderAll(); }); today.append(b); };
  if (step?.alt?.[0]) other(P.stepLabel(step.alt[0], psong).title, () => { pstep = step.alt[0]; });
  if (step?.kind === "hear") other("I know it", () => { pdoc = P.markHeard(pdoc, Date.now()); savePractice(); pstep = planNext(); });
  if (step?.kind === "stage" && step.stage === "time") other("Timing's fine → in tune", () => { const r = P.overrule(pdoc, psess, psong.phrases[step.p], Date.now()); pdoc = r.doc; psess = r.session; savePractice(); pstep = planNext(); });
  if (thenNow) {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "co-chip", textContent: "▶ Then → Now" });
    b.addEventListener("click", () => playThenNow(thenNow));
    today.append(b);
  }
  const tools = $("mo-tools");
  tools.textContent = "";
  const tool = (text, fn) => { const b = Object.assign(document.createElement("button"), { type: "button", textContent: text }); b.addEventListener("click", () => { closeMore(); fn(); }); tools.append(b); };
  tool("● Sing it through", () => { if (gblock) stopGuided(); startSing(); });
  tool("⟳ Loop line", () => { if (gblock) stopGuided(); startLoop(shownLine >= 0 ? shownLine : 0); });
  tool(mon ? "🎤 Pitch off" : "🎤 Pitch", () => monitorBtn.click());
  if (take?.endT != null && !take.part) tool("Last take", () => openReview());
  if (lastRound?.tk?.voice) tool("⤓ Last round", () => saveTake(lastRound.tk, lastRound.extra));
  tool("Guide me off", () => setGuided(false));
}
function setGuided(on) {
  if (guidedOn === on) return;
  if (gblock) stopGuided();
  guidedOn = on;
  store(PK.guided, on ? "on" : "off");
  const box = $("guided-on");
  if (box) box.checked = on;
  pstep = null;
  renderAll();
  renderGuided();
}

// ---------------------------------------------------------------------------
// Review (coach.js): after a take, the lines worth working on — with what went wrong in
// plain words — then every line; each can be heard (your take / the melody / both) or
// shown on the lane. Scores are compared with the previous take of the same song.

let reviewRows = [];

const lineText = (li) => (lines[li] || []).map((i) => sylText(notes[i], i)).join("").trim();
const historySig = () => `${verseSelect.value || "1"}|${notes.length}|${lines.length}`;

const analyzeTake = () => analyzeLines(notes, lines, take.grades, { text: lineText, name: noteName, lead: timingLead(), syl: (j) => sylText(notes[j], j), rhythm: take.rhythm });
// The take's steady lead (s, − = early), when it's big enough to mention.
const timingLead = () => { const t = timingTendency(take.grades); return Math.abs(t) >= 0.08 ? t : 0; };

function readHistory() {
  try { return JSON.parse(recall(K.history) || "{}") || {}; } catch { return {}; }
}

// This take's scores go into the song's history (per verse — `sig` — the last 10 takes
// each). A take that stopped early (< 80% of the lines sung) is kept for its lines but isn't
// the "last take" the next one is compared with.
function recordTake() {
  if (!take || take.endT === null || !songId) return;
  take.at = take.at || Date.now();
  const all = readHistory();
  const full = all[songId] || [];
  const sig = historySig();
  const same = full.filter((h) => h.sig === sig);
  take.prev = [...same].reverse().find((h) => h.whole !== false) || null;
  // Per line, its latest earlier score (from any take that reached it).
  take.prevLines = lines.map((_, li) => [...same].reverse().map((h) => h.lines?.[li]).find((x) => x !== null && x !== undefined) ?? null);
  const pct = takeScore(notes, take.grades);
  if (pct === null) return;
  reviewRows = analyzeTake();
  const whole = reviewRows.filter((r) => r.complete).length >= 0.8 * lines.length;
  take.whole = whole;
  full.push({ sig, at: take.at, pct, whole, lines: lines.map((_, li) => reviewRows.find((r) => r.li === li)?.score ?? null), rhythm: rhythmSummary() });
  const keep = new Set(full.filter((h) => h.sig === sig).slice(-10));
  all[songId] = full.filter((h) => h.sig !== sig || keep.has(h)).slice(-40);
  store(K.history, JSON.stringify(all));
}

// --- The last take of each song, kept (library.js "takes") ------------------------------------
// Its data — compact frames [t, midi, rms], grades, rhythm, what it fits — is synced to the
// cloud when signed in (sync.js); the recording stays on this device (16-bit, half rate).
const rd = (x, k) => (typeof x === "number" ? Math.round(x * k) / k : x ?? null);
function takeData(tk) {
  const rhythm = tk.rhythm ? JSON.parse(JSON.stringify(tk.rhythm)) : null;
  if (rhythm?.diag?.settings) { delete rhythm.diag.settings.deviceId; delete rhythm.diag.settings.groupId; }
  return {
    v: 1, at: tk.at, verse: tk.verse, rate: tk.rate, timing: tk.timing, guide: tk.guide, shiftSig: tk.shiftSig, notesSig: notesSig(),
    endT: rd(tk.endT, 1e4), latency: rd(tk.latency, 1e4), whole: tk.whole ?? null, octave: tk.octave ?? 0, prev: tk.prev ?? null,
    frames: tk.frames.map((f) => [rd(f.t, 1e4), f.midi === null ? null : rd(f.midi, 1e3), rd(f.rms, 1e5)]),
    grades: tk.grades.map((g) => g && Object.fromEntries(Object.entries(g).map(([k, v]) => [k, rd(v, 1e4)]))),
    rhythm,
  };
}
function packVoice(v) {
  if (!v?.data?.length) return null;
  const step = v.sampleRate >= 44100 ? 2 : 1;
  const n = Math.floor(v.data.length / step), pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    let x = 0;
    for (let k = 0; k < step; k++) x += v.data[i * step + k];
    pcm[i] = Math.max(-1, Math.min(1, x / step)) * 32767;
  }
  return { pcm, sampleRate: v.sampleRate / step, start: v.start, gain: v.gain };
}
function unpackVoice(p) {
  if (!p?.pcm?.length) return null;
  const data = new Float32Array(p.pcm.length);
  for (let i = 0; i < data.length; i++) data[i] = p.pcm[i] / 32767;
  return { data, sampleRate: p.sampleRate, start: p.start, gain: p.gain };
}
// A whole take that judged something becomes the song's last take (not a loop round, not a
// stop in the count-in).
function saveLastTake(tk, sid) {
  if (!tk || tk.part || tk.endT === null || !sid || !tk.grades.some((g) => g && g.status !== "unsung") || spaceChanged()) return;
  tk.at = tk.at || Date.now();
  tk.takeId = `${tk.at.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let rec;
  try { rec = { songId: sid, takeId: tk.takeId, at: tk.at, data: takeData(tk), voice: packVoice(tk.voice) }; }
  catch (err) { console.warn("take not saved", err); return; }
  putTake(rec).catch((err) => console.warn("take not saved", err));
}
// A stored take (here or from the cloud) as the page's take; derived once the notes are known.
function reviveTake(rec) {
  const d = rec?.data;
  if (!d || d.v !== 1 || !Array.isArray(d.frames)) return null;
  return {
    restored: true, derived: false, takeId: rec.takeId, at: d.at,
    frames: d.frames.map(([t, midi, rms]) => ({ t, midi, rms, disp: null, ok: null })),
    grades: d.grades, endT: d.endT, voice: unpackVoice(rec.voice), latency: d.latency,
    shiftSig: d.shiftSig, notesSig: d.notesSig, timing: d.timing, rate: d.rate, verse: d.verse,
    octave: d.octave ?? 0, part: false, guide: d.guide, rhythm: d.rhythm, whole: d.whole, prev: d.prev ?? null,
  };
}
function deriveTake(tk) {
  tk.range = [0, notes.length];
  let last = (range.lo + range.hi) / 2;
  for (const f of tk.frames) {
    if (f.midi === null) continue;
    const i = noteAt(f.t);
    f.disp = f.midi + 12 * Math.round(((i >= 0 ? notes[i].midi : last) - f.midi) / 12);
    last = f.disp;
  }
  recolour(tk);
  // Each line's latest earlier score, from the history before this take.
  const same = (readHistory()[songId] || []).filter((h) => h.sig === historySig() && h.at < tk.at);
  tk.prevLines = lines.map((_, li) => [...same].reverse().map((h) => h.lines?.[li]).find((x) => x !== null && x !== undefined) ?? null);
  tk.derived = true;
}

// --- Assistants (assist.js, the MCP server) ------------------------------------------------
// The open song as the page reads it, and each whole take line by line — notes as written in
// the key sung (target), the note sung, cents off it, the grade, timing (ms, + late) — with the
// page's own next steps. Assistants read them; scores stay data (never shown as grades here).
const r3 = (x) => Math.round(x * 1000) / 1000;
const optText = (sel) => sel.selectedOptions[0]?.textContent?.trim() || "";
const bpmNow = () => (useMap && tmap ? Math.round(60 / (tmap.avg / rate)) : Math.round(score.tempo * rate));
function assistMeta() {
  return { title: score?.title || "", verse: verseSelect.value || score?.verses[0] || "1", key: optText(keySelect), tempo: optText(tempoSelect), bpm: score ? bpmNow() : null,
    guide, view, lines: lines.length, notes: notes.length, notesSig: notesSig(), app: $("version")?.textContent || "" };
}
function assistSong() {
  if (!score || !notes.length || !songId || spaceChanged()) return;
  shareSong(songId, {
    v: 1, ...assistMeta(), verses: score.verses, meter: meterAt(entryIdx).join("/"), range: `${lowest().name}–${highest().name}`,
    lines: lines.map((idx, li) => ({ li, text: lineText(li), at: r3(notes[idx[0]].t), notes: idx.map((j) => [notes[j].name, r3(notes[j].dq), notes[j].melisma ? "_" : (notes[j].text || "")]) })),
  });
}
// One line of the take: rows = the review's (final) or worked out now from the live grades.
function assistLine(li, rows = null) {
  const idx = lines[li] || [];
  const rdev = take.rhythm?.notes;
  const row = rows ? rows.find((r) => r.li === li)
    : analyzeLines(notes, [idx], take.grades, { text: lineText, name: noteName, syl: (j) => sylText(notes[j], j), rhythm: null, lineIndex: [li], lead: timingLead() })[0];
  return {
    text: lineText(li), from: r3(notes[idx[0]]?.t ?? 0),
    notes: idx.map((j) => {
      const n = notes[j], g = take.grades[j];
      const dev = g && typeof g.dev === "number" ? g.dev : null;
      const dt = rdev?.[j]?.dev ?? (g && typeof g.shift === "number" ? g.shift : null);
      return [n.name, dev === null ? null : noteName(Math.round(n.midi + dev)), dev === null ? null : Math.round(dev * 100), g?.status ?? null, dt === null ? null : Math.round(dt * 1000), n.melisma ? "_" : (n.text || "")];
    }),
    steps: row ? row.reasons.map((r) => r.text) : [], ok: !!row?.good, score: row?.score ?? null, octave: take.octave || 0,
  };
}
function assistTakeEnded(tk) {
  if (take !== tk) return;
  let review = null;
  if (reviewRows.length) {
    const { pct, fb } = reviewFeedback();
    const rh = take.rhythm;
    review = { headline: pct === null ? "Couldn't hear the notes clearly" : fb.headline, wins: fb.wins.map((w) => ({ text: w.text, line: w.li === undefined ? null : w.li + 1 })),
      tries: fb.tries.map((t) => ({ text: t.text, line: t.li === undefined ? null : t.li + 1 })), tip: fb.tip || null, score: pct,
      timing: rh ? { trust: rh.trust, calibrated: !!rh.calibrated, lead_ms: rh.lead === undefined || rh.lead === null ? null : Math.round(rh.lead * 1000), steady: rh.steady ?? null } : null };
  }
  const sung = lines.map((_, li) => li).filter((li) => lines[li].some((j) => take.grades[j] && take.grades[j].status !== "unsung"));
  takeEnded(tk.coachId, { status: take.whole === false ? "stopped" : "done", meta: assistMeta(), review, lines: sung.map((li) => ({ li, data: assistLine(li, reviewRows) })) });
}

// --- Remote control (assist.js remote) ----------------------------------------------------
// The 📡 switch in the header: on, an assistant can run these on this page (one device at a
// time). Lines are numbered from 1 here, as people say them.
const remoteBtn = $("remote-btn");
function showRemote(on) {
  remoteBtn.hidden = !remote.available;
  remoteBtn.dataset.on = String(!!on);
  remoteBtn.textContent = on ? "📡 Remote on" : "📡";
  remoteBtn.title = on ? "An assistant can control this page — tap to stop" : "Let an assistant control this page";
  remoteBtn.setAttribute("aria-pressed", String(!!on));
}
remoteBtn.addEventListener("click", () => { remoteBtn.disabled = true; remote.set(!remote.on).finally(() => { remoteBtn.disabled = false; }); });
function remoteState() {
  return { page: "sing", song: songId && score ? { id: songId, title: score.title } : null, key: score ? optText(keySelect) : null, tempo: score ? optText(tempoSelect) : null,
    doing: getReady ? "get-ready" : drill ? "loop" : gblock ? "practice" : session?.kind || (starting ? "starting" : "idle"), line: shownLine >= 0 ? shownLine + 1 : null, lines: lines.length,
    has_take: !!(take && take.endT !== null), sound: playCtx ? playCtx.state : "none" };
}
// Takes an assistant starts: a "Get ready" countdown first (its own words land there, not over
// the count-in), tap to cancel; then the take, maybe ending by itself after a line.
let remoteTake = null; // { by, until (line index | null) } — for the next whole take
let getReady = null;   // { timer, resolve }
const getReadyEl = $("getready"), takeEndEl = $("take-end");
function cancelGetReady() {
  if (!getReady) return false;
  clearInterval(getReady.timer);
  const r = getReady.resolve;
  getReady = null;
  getReadyEl.hidden = true;
  r(false);
  remote.changedSoon();
  return true;
}
function startGetReady(delay, by) {
  cancelGetReady();
  return new Promise((resolve) => {
    let left = delay;
    const show = () => { getReadyEl.querySelector(".n").textContent = String(left); getReadyEl.querySelector(".by").textContent = `${by} — get ready`; };
    show();
    getReadyEl.hidden = false;
    getReady = { resolve, timer: setInterval(() => {
      left--;
      if (left > 0) return show();
      clearInterval(getReady.timer);
      getReady = null;
      getReadyEl.hidden = true;
      resolve(true);
    }, 1000) };
    remote.changedSoon();
  });
}
getReadyEl.addEventListener("click", () => { if (cancelGetReady()) remoteTake = null; });
function setView(v) {
  view = v;
  store(K.view, view);
  for (const r of optionsEl.querySelectorAll('input[name="view"]')) r.checked = r.value === v;
  updateButtons();
}

// Which assistant is connected: shown by 📡 for 2 minutes after its last call (the dot pulses
// for 15 s after one).
const assistantChip = $("assistant-chip");
let assistantSeen = null;
function showAssistant(info) {
  if (info) assistantSeen = { ...info, t: info.received ?? Date.parse(info.at) };
  const a = assistantSeen;
  const age = a ? Date.now() - a.t : Infinity;
  assistantChip.hidden = !(age < 120000);
  if (assistantChip.hidden) return;
  assistantChip.dataset.active = String(age < 15000);
  if (assistantChip.dataset.name !== a.name || assistantChip.dataset.logo !== String(a.logo || "")) {
    assistantChip.dataset.name = a.name;
    assistantChip.dataset.logo = String(a.logo || "");
    assistantChip.textContent = "";
    if (a.logo) { const img = new Image(); img.src = a.logo; img.alt = ""; img.referrerPolicy = "no-referrer"; img.onerror = () => img.remove(); assistantChip.append(img); }
    assistantChip.append(Object.assign(document.createElement("span"), { className: "nm", textContent: a.name }), Object.assign(document.createElement("span"), { className: "dot" }));
  }
  assistantChip.title = `${a.name} is connected`;
}
setInterval(() => showAssistant(), 5000);

const lineArg = (a) => {
  if (a.line === undefined || a.line === null) return null;
  const li = Math.round(Number(a.line)) - 1;
  if (!(li >= 0 && li < lines.length)) throw new Error(`No line ${a.line} (lines 1–${lines.length}).`);
  return li;
};
const songOptions = () => [...songSelect.querySelectorAll("option")].map((o) => ({ id: o.value, title: o.textContent.trim() }));
async function runRemote(action, a) {
  const done = (extra = {}) => ({ ok: true, ...remoteState(), ...extra });
  // (a take still being finished — recording, rhythm, review — is let finish first)
  for (let i = 0; i < 100 && finishing; i++) await new Promise((r) => setTimeout(r, 100));
  if (spaceChanged()) return { ok: false, error: "This page is out of date (signed in or out elsewhere) and is reloading." };
  // Guided practice running: the assistant's command comes first (it ends the step).
  const wasGuided = !!gblock;
  if (gblock && action !== "review") stopGuided();
  switch (action) {
    case "stop": {
      const was = cancelGetReady() || drill || session || wasGuided;
      if (drill) stopLoop(); else if (session?.kind === "sing") await stopSing(); else if (session) stopSession();
      if (was && a.by) showMsg(`Stopped by ${a.by}`);
      return done();
    }
    case "open_song": {
      const want = String(a.song ?? "").trim().toLowerCase();
      const all = songOptions();
      const hit = all.find((o) => o.id.toLowerCase() === want) || all.find((o) => o.title.toLowerCase() === want) || all.find((o) => o.title.toLowerCase().includes(want));
      if (!want || !hit) return { ok: false, error: `No song like “${a.song ?? ""}”.`, songs: all.map((o) => o.title) };
      if (drill) stopLoop();
      if (session?.kind === "sing") await stopSing(); else if (session) stopSession();
      await selectSong(hit.id);
      return done();
    }
    case "set_key": {
      if (session?.kind === "sing" || drill) return { ok: false, error: "Not while singing — stop first." };
      const opts = [...keySelect.querySelectorAll("option")];
      const want = a.semitones !== undefined && a.semitones !== null ? String(Math.round(Number(a.semitones))) : null;
      // fit: the menu's best fit for the voice profile (the first of "Fits …" / "Close(st) …").
      let o = opts.find((x) => x.value === want);
      if (!o && a.fit && want === null) {
        if (opts.some((x) => x.value === "fit")) return { ok: false, error: "No voice range yet — the range test is on Resonate's Voice page." };
        o = [...keySelect.querySelectorAll("optgroup")].find((g) => /^(Fits|Close)/.test(g.label))?.querySelector("option") || null;
        if (!o) return { ok: false, error: "No key comes close to the voice range — pick one by semitones.", keys: opts.map((x) => x.textContent.trim()) };
      }
      if (!o) return { ok: false, error: "That key isn't offered.", keys: opts.map((x) => x.textContent.trim()) };
      if (session) stopSession();
      keySelect.value = o.value;
      keySelect.dispatchEvent(new Event("change"));
      return done();
    }
    case "set_tempo": {
      if (session?.kind === "sing" || drill) return { ok: false, error: "Not while singing — stop first." };
      const r = Number(a.percent) / 100;
      const o = [...tempoSelect.querySelectorAll("option")].find((x) => x.value === `r:${r}`);
      if (!o) return { ok: false, error: "That tempo isn't offered.", percents: RATES.map((x) => Math.round(x * 100)) };
      if (session) stopSession();
      tempoSelect.value = o.value;
      tempoSelect.dispatchEvent(new Event("change"));
      return done();
    }
    case "go_to_line": {
      const li = lineArg(a);
      if (li === null) return { ok: false, error: "Which line?" };
      if (session || drill) return { ok: false, error: "Stop first." };
      cursorToLine(li);
      renderAll();
      return done();
    }
    case "listen":
    case "play_take": {
      if (session?.kind === "sing" || drill) return { ok: false, error: "Not while singing — stop first." };
      if (action === "play_take" && !(take && take.endT !== null)) return { ok: false, error: "No take to play back yet." };
      const li = lineArg(a);
      if (li !== null) cursorToLine(li);
      const opts = { how: "auto" };
      if (li !== null && a.only_line) { const last = notes[lines[li][lines[li].length - 1]]; opts.until = last.t + last.d + 0.3; }
      if (action === "play_take" && ["voice", "melody", "both"].includes(a.mode)) opts.mode = a.mode;
      await startPlay(action === "listen" ? "listen" : "playback", scrollT, opts);
      if (session?.kind !== (action === "listen" ? "listen" : "playback")) return { ok: false, error: "The sound didn't start on this device — someone needs to tap the page once.", ...remoteState() };
      return done();
    }
    case "sing": {
      if (session?.kind === "sing" || drill || getReady) return { ok: false, error: "Already singing." };
      if (session) stopSession();
      const until = a.to_line !== undefined && a.to_line !== null ? lineArg({ line: a.to_line }) : null;
      if (a.view === "perform" || a.view === "practice") setView(a.view);
      const delay = Math.max(0, Math.min(20, Math.round(Number(a.delay ?? 4)) || 0));
      remoteTake = { by: String(a.by || "Assistant").slice(0, 60), until };
      const end = until === null ? {} : { to_line: until + 1 };
      if (delay > 0) {
        // Answered now (the assistant talks during the countdown); the take starts after it.
        // (a take that didn't start — the mic refused — mustn't leave its settings to the next one)
        startGetReady(delay, remoteTake.by).then(async (go) => {
          if (go) { try { await startSing(); } catch (err) { console.warn("remote sing", err); } }
          remoteTake = null;
          remote.changedSoon();
        });
        return done({ starts_in_s: delay, ...end });
      }
      await startSing();
      if (session?.kind !== "sing") { remoteTake = null; return { ok: false, error: "The microphone didn't open on this device — someone needs to tap Sing there.", ...remoteState() }; }
      return done(end);
    }
    case "loop_line": {
      const li = lineArg(a) ?? (shownLine >= 0 ? shownLine : null);
      if (li === null) return { ok: false, error: "Which line?" };
      if (session?.kind === "sing") return { ok: false, error: "Not while singing — stop first." };
      if (session) stopSession();
      startLoop(li);
      return done({ doing: "loop" });
    }
    case "review":
      if (!take || take.endT === null) return { ok: false, error: "No take to review yet." };
      openReview();
      return done({ review: reviewEl.hidden ? null : $("rv-headline").textContent });
    default:
      return { ok: false, error: `Unknown action “${action}”.` };
  }
}
remote.start({ run: runRemote, state: remoteState, changed: showRemote, assistant: showAssistant }).catch((err) => console.warn("remote", err));

function openReview() {
  if (!take || take.endT === null) return;
  if (!reviewRows.length) reviewRows = analyzeTake();
  if (!reviewRows.length) return;
  renderReview();
  reviewEl.hidden = false;
  reviewEl.querySelector(".sheet").scrollTop = 0;
}

function closeReview() {
  reviewEl.hidden = true;
}

// The review (coach.js feedback): a headline, what went well, a take-wide tip, the next
// steps (each line can be heard and looped), then every line. No scores: the numbers are in
// the take and its history only.
function reviewFeedback() {
  const pct = takeScore(notes, take.grades);
  const wordOf = (j) => { let i = j; while (i > 0 && notes[i].melisma) i--; return `“${sylText(notes[i], i).trim().replace(/[,.;:!?]+$/, "")}”`; };
  return { pct, fb: feedback(reviewRows, { rhythm: take.rhythm, prev: take.prev && take.prevLines ? { pct: take.prev.pct, lines: take.prevLines } : null, pct, whole: take.whole !== false, w: wordOf }) };
}
function renderReview() {
  const { pct, fb } = reviewFeedback();
  $("rv-save").hidden = !take.voice;
  $("rv-headline").textContent = pct === null ? "Couldn't hear the notes clearly — closer to the mic?" : fb.headline;
  const wins = $("rv-wins");
  wins.textContent = "";
  for (const w of fb.wins) {
    const li = document.createElement("li");
    li.textContent = w.text;
    if (w.li !== undefined) {
      li.dataset.li = w.li;
      li.addEventListener("click", () => showLine(reviewRows.find((r) => r.li === w.li)));
    }
    wins.append(li);
  }
  const tip = $("rv-tip");
  tip.hidden = !fb.tip;
  tip.textContent = fb.tip || "";
  const workEl = $("rv-work"), linesEl = $("rv-lines");
  workEl.textContent = linesEl.textContent = "";
  $("rv-title").hidden = !fb.tries.length;
  for (const t of fb.tries) workEl.append(reviewLine(t.row, true));
  for (const r of reviewRows) linesEl.append(reviewLine(r, false));
  showReviewPlaying();
}

function reviewLine(r, full) {
  const el = document.createElement("div");
  el.className = `rv-line${full ? " work" : ""}`;
  el.dataset.li = r.li;
  const top = document.createElement("div");
  top.className = "rv-top";
  const mk = document.createElement("span");
  mk.className = "rv-mark";
  mk.textContent = r.good ? "✓" : "";
  const tx = document.createElement("button");
  tx.type = "button";
  tx.className = "rv-text";
  tx.textContent = r.text || "…";
  tx.title = "Show on the lane";
  tx.addEventListener("click", () => showLine(r));
  top.append(mk, tx);
  // Closer than last time: said, without a number; worse never is.
  const delta = lineDelta({ lines: take.prevLines }, r);
  if (delta !== null && delta >= 0.1) {
    const dd = document.createElement("span");
    dd.className = "rv-d";
    dd.textContent = "↑";
    dd.title = "Closer than last time";
    top.append(dd);
  }
  el.append(top);
  const reasons = full ? r.reasons.slice(0, 2) : r.reasons.slice(0, 1);
  if (reasons.length) {
    const ul = document.createElement("ul");
    ul.className = "rv-why";
    for (const x of reasons) {
      const li = document.createElement("li");
      li.textContent = x.text;
      ul.append(li);
    }
    el.append(ul);
  }
  const btns = document.createElement("div");
  btns.className = "rv-btns";
  for (const [mode, label] of full ? [["voice", "▶ You"], ["melody", "▶ Melody"], ["both", "▶ Both"]] : [["voice", "▶ You"], ["melody", "▶ Melody"]]) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.mode = mode;
    b.dataset.label = label;
    b.textContent = label;
    if (mode !== "melody" && !take.voice) b.disabled = true;
    b.addEventListener("click", () => playLine(r, mode));
    btns.append(b);
  }
  const lb = document.createElement("button");
  lb.type = "button";
  lb.textContent = "⟳ Loop";
  lb.title = "Hear it, sing it, repeat";
  lb.addEventListener("click", () => startLoop(r.li));
  btns.append(lb);
  el.append(btns);
  return el;
}

// The timing facts kept with a take in the history (data for progress, sync and an AI coach).
function rhythmSummary() {
  const rh = take.rhythm;
  if (!rh) return null;
  const r3 = (x) => (x === null || x === undefined ? null : Math.round(x * 1000) / 1000);
  return {
    cal: rh.calibrated, trust: rh.trust, guide: take.guide, timing: take.timing,
    lead: rh.calibrated ? r3(rh.lead) : null, steady: r3(rh.steady), drift: r3(rh.drift),
    obs: rh.obs.map((o) => ({ kind: o.kind, tone: o.tone, scope: o.scope, li: o.li, beats: o.beats })),
  };
}

// Hear a line: from just before it to just after it.
function playLine(r, mode) {
  if (session?.line === r.li && session.mode === mode) return stopSession();
  const js = lines[r.li];
  startPlay("playback", Math.max(0, r.from - 0.4), { mode, until: r.to + 0.5, line: r.li, range: [js[0], js[js.length - 1] + 1] });
}

// The review's play buttons follow what's playing.
function showReviewPlaying() {
  for (const el of reviewEl.querySelectorAll(".rv-line")) {
    const on = session && session.line === Number(el.dataset.li);
    el.dataset.playing = on ? "true" : "false";
    for (const b of el.querySelectorAll("button[data-mode]")) {
      const active = on && session.mode === b.dataset.mode;
      b.dataset.on = active ? "true" : "false";
      b.textContent = active ? "■ Stop" : b.dataset.label;
    }
  }
}

// Close the review on the lane at this line.
function showLine(r) {
  closeReview();
  if (session) stopSession();
  cursorToLine(r.li);
  renderAll();
}

// Singing options: Practice / Perform, and the guide.
function openOptions() {
  $("guided-on").checked = guidedOn;
  for (const r of optionsEl.querySelectorAll('input[name="view"]')) r.checked = r.value === view;
  guideSelect.value = guide;
  optionsEl.hidden = false;
}
optionsBtn.addEventListener("click", openOptions);
$("op-close").addEventListener("click", () => { optionsEl.hidden = true; });
optionsEl.addEventListener("click", (e) => { if (e.target === optionsEl) optionsEl.hidden = true; });
for (const r of optionsEl.querySelectorAll('input[name="view"]')) {
  r.addEventListener("change", () => {
    if (!r.checked) return;
    view = r.value;
    store(K.view, view);
    updateButtons();
  });
}

reviewBtn.addEventListener("click", openReview);
$("guided-on").addEventListener("change", (e) => setGuided(e.target.checked));
$("co-more").addEventListener("click", openMore);
mapEl.addEventListener("click", openMore);
$("mo-close").addEventListener("click", closeMore);
moreEl.addEventListener("click", (e) => { if (e.target === moreEl) closeMore(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !moreEl.hidden) closeMore(); });
coBtns.addEventListener("click", (e) => {
  const act = e.target.closest("button")?.dataset.act;
  if (!act) return;
  if (act === "thennow") return session?.kind === "thennow" ? (stopSession(), renderGuided()) : thenNow && playThenNow(thenNow);
  if (gblock?.waitRes) { const r = gblock.waitRes; gblock.waitRes = null; r(act); return; }
  if (!gblock && pstep?.kind === "selfcheck" && (act === "yes" || act === "again")) answerCheck(pstep, act === "yes");
});
// The cue's ▶: the note to aim for (in tune), or the phrase's melody (in time).
coPlay.addEventListener("click", () => {
  const j = cardRes?.cue?.play?.j;
  if (j === undefined || j === null || !notes[j] || (gblock && gblock.phase !== "wait")) return;
  const p = psong.phrases.find((x) => x.js.includes(j));
  if ((gblock?.step || pstep)?.stage === "time" && p) startPlay("listen", Math.max(0, p.t0 - 0.3), { until: p.t1 + 0.2, range: [p.j0, p.j1], how: "tap" });
  else startPlay("listen", Math.max(0, notes[j].t - 0.05), { until: notes[j].t + Math.max(0.6, notes[j].d), range: [j, j + 1], how: "tap" });
});
$("rv-close").addEventListener("click", closeReview);
// The dimmed backdrop closes the review. A tap there on Play or Listen showing through
// (Play peeks out above a short sheet) also does what it says: it used to only close the
// sheet, so after a take a tap on Play "didn't play".
reviewEl.addEventListener("click", (e) => {
  if (e.target !== reviewEl) return;
  closeReview();
  const under = document.elementFromPoint(e.clientX, e.clientY)?.closest("#play, #listen"); // (not the modes: a stored choice)
  if (under && !under.disabled) under.click();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!reviewEl.hidden) closeReview();
  for (const id of ["options", "taptempo", "tapalong"]) $(id).hidden = true;
});

function renderSummary() {
  if (!take || take.endT === null) {
    scorePctEl.textContent = "";
    summaryEl.textContent = score
      ? `${score.title.toUpperCase()} · ${meterAt(entryIdx).join("/")} · ${useMap && tmap ? `TAPPED TIMING ♩≈${Math.round(60 / (tmap.avg / rate))}` : `♩=${Math.round(score.tempo * rate)}${score.tempoFromScore ? "" : " (default)"}`}${notes.length ? ` · ${lowest().name}–${highest().name}` : ""}`
      : "";
    return;
  }
  // After a take: the song's facts, plus the octave it was sung in — no counts or score.
  const graded = take.grades.filter((g) => g && g.status !== "unsung");
  scorePctEl.textContent = "";
  if (!graded.length) { summaryEl.textContent = "NO NOTES SUNG"; return; }
  let t = `${score.title.toUpperCase()} · ${lowest().name}–${highest().name}`;
  if (take.octave) t += take.octave < 0 ? " · SUNG 8VB" : " · SUNG 8VA";
  summaryEl.textContent = t;
}

function updateButtons() {
  remote.changedSoon();
  const kind = session?.kind;
  const verb = view === "perform" ? "Perform" : "Sing";
  singBtn.textContent = drill ? "■ Stop loop" : kind === "sing" ? "■ Stop" : take?.endT != null ? `● ${verb} again` : `● ${verb}`;
  const perform = performing() ? "true" : "false";
  if (document.body.dataset.perform !== perform) document.body.dataset.perform = perform;
  document.body.dataset.drill = drill ? "true" : "false"; // (guided: a loop from More shows its bar)
  document.body.dataset.mon = mon ? "true" : "false";      // (…and 🎤 Pitch its readout)
  singBtn.dataset.active = kind === "sing" ? "true" : "false";
  // Guided: the footer's right button runs the plan's step (■ Stop while it runs).
  if (guiding() && !drill) {
    if (gblock) singBtn.textContent = "■ Stop";
    else if (kind !== "sing" && pstep) singBtn.textContent = pstep.kind === "selfcheck" ? "● Again" : P.stepLabel(pstep, psong).button;
    singBtn.dataset.active = gblock || kind === "sing" ? "true" : "false";
  }
  listenBtn.textContent = kind === "listen" && !gblock ? "■ Stop" : "▶ Listen";
  listenBtn.disabled = kind === "sing" || !score || !!drill || !!gblock;
  singBtn.disabled = !score || (kind && kind !== "sing" && !drill && !gblock);
  playbarEl.hidden = !take || take.endT === null || kind === "sing" || !!drill;
  reviewBtn.hidden = !take?.grades?.some((g) => g && g.status !== "unsung");
  loopBtn.hidden = !!session || !!drill || !score || !notes.length;
  loopbarEl.hidden = !drill;
  playBtn.textContent = kind === "playback" ? "■ Stop" : "▶ Play";
  playBtn.dataset.playing = kind === "playback" ? "true" : "false";
  for (const b of playModesEl.querySelectorAll("button")) {
    b.disabled = b.dataset.mode !== "melody" && !take?.voice;
    b.dataset.active = b.dataset.mode === playMode ? "true" : "false";
  }
  for (const el of [songSelect, verseSelect, keySelect, tempoSelect, optionsBtn, openFileBtn, openLinkBtn, removeBtn, saveBtn]) el.disabled = kind === "sing" || !!drill || !!gblock;
  canvas.dataset.pannable = session ? "false" : "true";
  if (!reviewEl.hidden) showReviewPlaying();
}

const TUNE = {
  good: ["rgba(74,222,128,0.45)", "rgba(74,222,128,0.95)"],
  ok: ["rgba(166,79,255,0.45)", "rgba(166,79,255,0.95)"],
  off: ["rgba(245,170,90,0.4)", "rgba(245,170,90,0.95)"], // warm amber: a note to aim at, not a "fail"
  missed: ["rgba(255,255,255,0.04)", "rgba(255,255,255,0.35)"],
  unclear: ["rgba(160,170,255,0.08)", "rgba(160,170,255,0.5)"],
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
  ctx.fillStyle = "rgba(255,255,255,0.09)";
  for (const m of score.measures) {
    const t = qToT(m);
    if (t >= tMin && t <= tMax) ctx.fillRect(xOf(t), 0, 1, h);
  }

  // Score notes with lyrics.
  const barH = Math.max(6, Math.min(rowH * 0.85, 22));
  const practised = mon && !take?.grades[youTarget()] ? youTarget() : -1; // (a graded note keeps its grade's outline)
  const cur = session ? noteAt(nowT) : preview ? preview.j : practised; // lit: playing now / tapped / practised
  notes.forEach((n, j) => {
    if (n.t + n.d < tMin || n.t > tMax || laneMode === "off") return;
    const g = take?.grades[j];
    const key = g && g.status !== "unsung" && laneMode !== "neutral" ? g.status : "todo";
    const [fill, stroke] = TUNE[key];
    const x0 = xOf(n.t) + 1, x1 = xOf(n.t + n.d) - 1;
    const y = yOf(n.midi);
    ctx.fillStyle = fill;
    ctx.strokeStyle = j === cur ? "#ffe6a0" : stroke;
    ctx.lineWidth = j === cur ? 2 : 1;
    if (key === "missed" || key === "unclear") ctx.setLineDash([4, 3]);
    roundRect(x0, y - barH / 2, Math.max(3, x1 - x0), barH, Math.min(5, barH / 2));
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    // Sung early or late: a line over the bar where you actually came in (rhythm.js; else the
    // pitch grading's moved slot). Measured against your own steady timing, unless the whole
    // take was clearly behind/ahead of the click.
    const rh = take?.rhythm?.notes?.[j];
    if (rh) {
      const abs = take.rhythm.calibrated && take.rhythm.obs.some((o) => o.kind === "behind" || o.kind === "ahead");
      const off = abs ? rh.dev : rh.rdev;
      if (off !== null && Math.abs(off) >= tolOn(rh.u)) {
        ctx.fillStyle = stroke;
        ctx.fillRect(xOf(n.t + off) + 1, y - barH / 2 - 4, Math.max(2, xOf(n.t + n.d + off) - xOf(n.t + off) - 2), 2);
      }
    } else if (!take?.rhythm && g?.from !== undefined && Math.abs(g.shift) >= 0.08 && ["good", "ok", "off"].includes(g.status)) {
      ctx.fillStyle = stroke;
      ctx.fillRect(xOf(g.from) + 1, y - barH / 2 - 4, Math.max(2, xOf(g.to) - xOf(g.from) - 2), 2);
    }
    if (!n.melisma && n.text) {
      ctx.font = "italic 600 12px system-ui, sans-serif";
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillStyle = j === cur ? "#ffe6a0" : "rgba(255,230,160,0.8)";
      ctx.fillText(n.text + (joinsNext(j) ? "-" : ""), x0, y + barH / 2 + 2);
    }
  });

  // Your pitch (a take; dimmed under the pitch monitor's live trail).
  const monitoring = mon && !session;
  if (take && laneMode !== "off" && laneMode !== "bars") {
    ctx.globalAlpha = monitoring ? 0.4 : 1;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = ctx.lineCap = "round";
    let prev = null;
    // Live: only up to now. Review: the whole take.
    const upTo = session?.kind === "sing" ? Math.min(tMax, nowT) : tMax;
    for (const f of take.frames) {
      if (f.t < tMin - 0.1 || f.t > upTo + 0.05 || f.disp === null) { prev = null; continue; }
      if (prev && Math.abs(prev.disp - f.disp) < 1.5 && f.t - prev.t < 0.1) {
        ctx.strokeStyle = laneMode === "neutral" ? "rgba(255,255,255,0.8)" : f.ok === true ? "rgba(74,222,128,0.95)" : f.ok === false ? "rgba(245,170,90,0.95)" : "rgba(255,255,255,0.8)";
        ctx.beginPath();
        ctx.moveTo(xOf(prev.t), yOf(prev.disp));
        ctx.lineTo(xOf(f.t), yOf(f.disp));
        ctx.stroke();
      }
      prev = f;
    }
    ctx.globalAlpha = 1;
  }

  // Pitch monitor: the practised note's row, and your pitch over the last few seconds
  // running back from the now line, moved by octaves next to that note.
  if (monitoring) {
    const j = youTarget();
    const ref = j >= 0 ? notes[j].midi : (lo + hi) / 2;
    if (j >= 0) {
      ctx.strokeStyle = "rgba(255,230,160,0.45)";
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(GUTTER, yOf(ref));
      ctx.lineTo(w, yOf(ref));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const tNow = performance.now() / 1000;
    const colour = (m) => j < 0 ? "rgba(255,255,255,0.85)" : Math.abs(fold(m - ref)) * 100 <= OK_CENTS ? "rgba(74,222,128,0.95)" : "rgba(245,170,90,0.95)";
    const disp = (m) => m + 12 * Math.round((ref - m) / 12);
    ctx.lineWidth = 2.5;
    ctx.lineJoin = ctx.lineCap = "round";
    let prev = null;
    for (const f of youFrames) {
      if (f.midi === null) { prev = null; continue; }
      const p = { x: nowX - (tNow - f.t) * PX_PER_SEC, y: yOf(disp(f.midi)), d: disp(f.midi), t: f.t };
      if (prev && Math.abs(prev.d - p.d) < 1.5 && f.t - prev.t < 0.1) {
        ctx.strokeStyle = colour(f.midi);
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      prev = p;
    }
    const m = currentYou();
    if (m !== null) {
      ctx.fillStyle = colour(m);
      ctx.beginPath();
      ctx.arc(nowX, yOf(disp(m)), 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Now / cursor line.
  ctx.fillStyle = session ? "rgba(255,230,160,0.9)" : "rgba(120,200,255,0.5)";
  ctx.fillRect(nowX - 1, 0, 2, h);
  ctx.restore();

  // Count-in overlay.
  if (session?.kind === "sing" && nowT < session.start) {
    const left = countInLeft(session, nowT);
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
      ctx.fillText(`target ${notes[i].name}`, w - 8, 6);
      if (f && f.midi !== null) {
        const c = Math.round(fold(f.midi - notes[i].midi) * 100);
        ctx.fillStyle = Math.abs(c) <= OK_CENTS ? "#4ade80" : "#f5a85a";
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

singBtn.addEventListener("click", () => (cancelGetReady() ? null : drill ? stopLoop() : gblock ? stopGuided() : session?.kind === "sing" ? stopSing() : guiding() ? runPlan() : startSing()));
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
  transpose = keySelect.value.startsWith("fit") ? keySelect.value : Number(keySelect.value);
  const keys = readKeys();
  if (transpose) keys[songId] = transpose;
  else delete keys[songId];
  store(K.keys, JSON.stringify(keys));
  stopSession();
  applySong(); // (shows the range before → after)
});
tempoSelect.addEventListener("change", () => {
  const v = tempoSelect.value;
  if (v === "type" || v === "tap" || v === "tapmap" || v === "clearmap") {
    fillTempoOptions(); // the menu shows the current choice again
    if (v === "type") typeTempo();
    else if (v === "tap") openTapTempo();
    else if (v === "tapmap") openTapAlong();
    else if (confirm("Forget the tapped timing?")) {
      saveTiming({ segs: [], use: false });
      stopSession();
      applySong();
    }
    return;
  }
  const [kind, r] = v.split(":");
  setTiming(Number(r), kind === "m");
});

// Choose a speed (× the score's tempo, or × the tapped timing) from the menu; a tempo
// tapped for this song is kept as its own (bpm).
function setTiming(r, map, bpm = null) {
  if (!bpm && (RATES.includes(r) || MAP_RATES.includes(r))) saveRate(r);
  saveTiming({ use: map, bpm });
  stopSession();
  applySong();
}

// Type a tempo: quarter notes per minute, kept as this song's own (like a tapped one).
function typeTempo() {
  const now = Math.round(useMap && tmap ? 60 / (tmap.avg / rate) : score.tempo * rate);
  const answer = prompt(`♩ per minute (score: ♩=${Math.round(score.tempo)}):`, String(now));
  if (answer === null) return;
  const bpm = Math.round(Number(String(answer).replace(",", ".").replace(/[^\d.]/g, "")));
  if (!(bpm >= 20 && bpm <= 400)) {
    showMsg("♩ didn't look right — use 20–400.", "error");
    return;
  }
  setTiming(null, false, bpm);
}

// ---------------------------------------------------------------------------
// Tap the beat: a steady tempo from taps (the median of the last few intervals). The beat
// is the meter's: a dotted quarter in 6/8, 9/8, 12/8, else the time signature's unit.

const tapQ = () => { const [b, t] = meterAt(entryIdx); return t === 8 && b % 3 === 0 ? 1.5 : 4 / t; };
const unitGlyph = (q) => ({ 0.5: "♪", 1: "♩", 1.5: "♩.", 2: "𝅗𝅥" })[q] || "♩";
let tapTimes = [];
let tappedBpm = null; // quarter notes per minute

function openTapTempo() {
  stopLoop();
  tapTimes = [];
  tappedBpm = null;
  $("tt-bpm").textContent = "—";
  $("tt-use").disabled = true;
  $("taptempo").hidden = false;
}
$("tt-pad").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  const now = performance.now() / 1000;
  if (tapTimes.length && now - tapTimes[tapTimes.length - 1] > 2.5) tapTimes = []; // a pause: start over
  tapTimes.push(now);
  tapTimes = tapTimes.slice(-12);
  if (tapTimes.length < 4) {
    $("tt-bpm").textContent = `${4 - tapTimes.length} more…`;
    return;
  }
  const gaps = tapTimes.slice(1).map((t, i) => t - tapTimes[i]);
  const beat = median(gaps);
  tappedBpm = (60 / beat) * tapQ();
  $("tt-bpm").textContent = `${unitGlyph(tapQ())} = ${Math.round(60 / beat)}`;
  $("tt-use").disabled = false;
});
$("tt-use").addEventListener("click", () => {
  if (!tappedBpm) return;
  $("taptempo").hidden = true;
  setTiming(null, false, Math.round(tappedBpm));
});
$("tt-close").addEventListener("click", () => { $("taptempo").hidden = true; });

// ---------------------------------------------------------------------------
// Tap along with a recording (timing.js): while the song plays elsewhere, tap each
// syllable (or each line's first one) as it's sung; the taps become this song's timing.
// The page makes no sound meanwhile (other apps' audio isn't interrupted).

let tapAlong = null; // { mode, startLine, targets: [note index], taps: [{ q, t }] }

function openTapAlong() {
  stopLoop();
  stopKeys();
  stopSession();
  if (playCtx && playCtx.state === "running") playCtx.suspend().catch(() => {});
  tapAlong = { mode: tapAlong?.mode || "words", startLine: Math.max(0, shownLine), targets: [], taps: [] };
  prepTapAlong();
  $("tapalong").hidden = false;
}

function prepTapAlong() {
  const a = tapAlong;
  const first = lines[a.startLine]?.[0] ?? 0;
  const words = score.verses.length > 0;
  a.targets = a.mode === "lines"
    ? lines.slice(a.startLine).map((l) => l.find((j) => !notes[j].melisma) ?? l[0])
    : notes.map((_, j) => j).filter((j) => j >= first && !notes[j].melisma && (!words || notes[j].text));
  a.taps = [];
  renderTapAlong();
}

function renderTapAlong() {
  const a = tapAlong;
  for (const b of $("ta-mode").querySelectorAll("button")) b.dataset.active = b.dataset.mode === a.mode ? "true" : "false";
  $("ta-start").textContent = `From line ${a.startLine + 1} / ${lines.length}`;
  const next = a.targets[a.taps.length];
  const li = next === undefined ? lines.length - 1 : lineOf[next];
  const nowEl = $("ta-now");
  nowEl.textContent = "";
  for (const i of lines[li] || []) {
    const t = sylText(notes[i], i);
    if (!t) continue;
    const span = document.createElement("span");
    span.textContent = t;
    const k = a.targets.indexOf(i);
    span.dataset.s = i === next ? "next" : k >= 0 && k < a.taps.length ? "done" : "";
    nowEl.append(span);
  }
  $("ta-next").textContent = lineText(li + 1);
  $("ta-count").textContent = next === undefined ? `all ${a.taps.length} tapped` : `${a.taps.length} / ${a.targets.length}`;
  $("ta-save").disabled = knotsFromTaps(a.taps).length < 4;
  $("ta-undo").disabled = !a.taps.length;
  $("ta-prevline").disabled = a.startLine <= 0;
  $("ta-nextline").disabled = a.startLine >= lines.length - 1;
}

function tapAlongTap() {
  const a = tapAlong;
  if (!a || a.taps.length >= a.targets.length) return;
  const t = performance.now() / 1000;
  const last = a.taps[a.taps.length - 1];
  if (last && t - last.t < MIN_GAP) return; // a bounce (or a second finger), not the next syllable
  a.taps.push({ q: notes[a.targets[a.taps.length]].q, t });
  renderTapAlong();
}
$("ta-pad").addEventListener("pointerdown", (e) => { e.preventDefault(); tapAlongTap(); });
$("ta-pad").addEventListener("click", (e) => { if (e.detail === 0) tapAlongTap(); }); // keyboard
$("ta-undo").addEventListener("click", () => { tapAlong.taps.pop(); renderTapAlong(); });
$("ta-prevline").addEventListener("click", () => { tapAlong.startLine--; prepTapAlong(); });
$("ta-nextline").addEventListener("click", () => { tapAlong.startLine++; prepTapAlong(); });
$("ta-mode").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-mode]");
  if (!b) return;
  tapAlong.mode = b.dataset.mode;
  prepTapAlong();
});
$("ta-close").addEventListener("click", () => { $("tapalong").hidden = true; });
$("ta-save").addEventListener("click", () => {
  const knots = knotsFromTaps(tapAlong.taps);
  if (knots.length < 4) return;
  // A long pause in the tapping (restarting the music, say) is left out, not kept as a crawl.
  const { runs, pauses } = splitPauses(knots);
  let segs = timingEntry()?.segs || [];
  for (const run of runs) segs = mergeKnots(segs, run);
  saveRate(1);
  saveTiming({ segs, use: true, bpm: null });
  $("tapalong").hidden = true;
  stopSession();
  applySong();
  const skipped = pauses.map((p) => `${Math.round(p.s)} s`).join(", ");
  if (skipped) showMsg(`Pause left out: ${skipped}`);
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
  for (const k of [K.keys, K.rates, K.timing, K.history]) {
    const all = (() => { try { return JSON.parse(recall(k)) || {}; } catch { return {}; } })();
    if (id in all) { delete all[id]; store(k, JSON.stringify(all)); }
  }
  await refreshLibrary();
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
      xml = songXml(song);
      title = song.title;
    }
  } catch (err) {
    return showMsg(`Couldn't read the song: ${err.message}`, "error");
  }
  const name = `${safeName(title || "song")}.musicxml`;
  await shareFiles([new File([xml], name, { type: "application/xml" })], name);
});

const safeName = (t) => t.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "song";
// Phones: the share sheet (Save to Files, AirDrop, another app); elsewhere plain downloads.
async function shareFiles(files, title) {
  if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files, title });
      return;
    } catch (err) {
      if (err.name === "AbortError") return; // closed the share sheet
    }
  }
  for (const file of files) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
}

// Save this take: its recording (16-bit WAV) and what the page knew about it (JSON: notes,
// count-in clicks, clocks, pitch frames, grades, rhythm) — so a real take can be sent back and
// replayed through the analysis. It's your voice: only ever shared by you, from here.
function wavOf(data, sr) {
  const buf = new ArrayBuffer(44 + data.length * 2), v = new DataView(buf);
  const str = (o, x) => { for (let i = 0; i < x.length; i++) v.setUint8(o + i, x.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + data.length * 2, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, data[i])) * 32767, true);
  return new Blob([buf], { type: "audio/wav" });
}
// tk: a take (the review's, or guided practice's last round); extra: what the plan made of it.
async function saveTake(tk = take, extra = null) {
  if (!tk?.voice) return;
  const r = (x, k) => (x === null || x === undefined ? null : Math.round(x * 10 ** k) / 10 ** k);
  const base = `${safeName(score.title || "take")} take ${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`;
  const meta = {
    app: $("version")?.textContent || null, title: score.title, songId, verse: tk.verse, rate: tk.rate, notesRate: rate, timing: tk.timing, guide: tk.guide, view,
    clock: { ctxStart: tk.ctxStart, songT0: tk.songT0, est: tk.est, latency: tk.latency, beatSec: tk.beatSec, countClicks: tk.countClicks, frameShift: tk.frameShift ?? 0 },
    notes: notes.map((n) => ({ t: r(n.t, 4), d: r(n.d, 4), q: n.q, dq: n.dq, midi: n.midi, text: n.text, melisma: n.melisma, restBefore: n.restBefore })),
    lines, range: tk.range, endT: tk.endT, metric: metricOf(),
    frames: tk.frames.map((f) => [r(f.t, 4), r(f.midi, 3), r(f.rms, 5)]),
    grades: tk.grades.map((g) => g && { status: g.status, dev: r(g.dev, 3), hit: r(g.hit, 3), shift: r(g.shift, 3) }),
    rhythm: tk.rhythm,
    ...(extra ? { practice: extra } : {}),
  };
  await shareFiles([
    new File([wavOf(tk.voice.data, tk.voice.sampleRate)], `${base}.wav`, { type: "audio/wav" }),
    new File([JSON.stringify(meta)], `${base}.json`, { type: "application/json" }),
  ], base);
}
$("rv-save").addEventListener("click", () => saveTake());

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
  if (document.hidden) stopKeys();
  if (document.hidden && drill) stopLoop();
  if (document.hidden && gblock) stopGuided();
  if (document.hidden && mon) {
    monitorOff();
    statusEl.textContent = "pitch off (backgrounded)";
  }
  if (document.hidden && session) {
    stopSession();
    statusEl.textContent = "stopped (backgrounded)";
  }
});
// Leaving the page: give the tab's audio session back. iOS keeps its type across pages,
// and a "playback" left behind kept the Tuner's microphone from starting.
window.addEventListener("pagehide", () => {
  stopKeys();
  stopLoop();
  stopGuided();
  monitorOff();
  stopSession();
  if (playCtx) playCtx.close().catch(() => {});
  playCtx = null;
  setSession("auto");
});
// Back from the back/forward cache: the next tap starts the audio again.
window.addEventListener("pageshow", (e) => {
  if (e.persisted) for (const t of ["pointerup", "keydown"]) document.addEventListener(t, unlockPlay, true);
});

// ---------------------------------------------------------------------------
// Init

guideSelect.value = guide;
// The cloud sync brought changes (sync.js): the song list, the open song's settings, its last
// take. Nothing changes under a take, a loop or a playback: what arrives then waits for its end.
let pendingRemote = null; // { songs, profiles, state: Set, takes: Set } — song ids
function queueRemote({ songs = false, profiles = false, state = [], takes = [] }) {
  const p = (pendingRemote ||= { songs: false, profiles: false, state: new Set(), takes: new Set() });
  p.songs ||= !!songs;
  p.profiles ||= !!profiles;
  for (const id of state) p.state.add(id);
  for (const id of takes) p.takes.add(id);
}
window.addEventListener("resonate:remote", (e) => { queueRemote(e.detail || {}); flushRemote(); });
// (After another tab signed in or out, the reload also waits for an open review to close.)
const busyNow = () => !!(session || drill || gblock || starting || finishing || (spaceChanged() && !reviewEl.hidden));
window.resonateBusy = busyNow; // (nav.js: a reload for another tab's sign-in/out waits for it)
function flushRemote() {
  if (!pendingRemote) return;
  setTimeout(async () => {
    const p = pendingRemote;
    if (!p || busyNow()) return; // (flushed again when that ends)
    pendingRemote = null;
    let gone = false;
    if (p.songs) {
      await refreshLibrary();
      if (songId) songSelect.value = songId;
      gone = !!songId && !SAMPLES[songId] && ![...mySongsEl.querySelectorAll("option")].some((o) => o.value === songId);
      if (gone && !busyNow()) return selectSong("amazing-grace");
    }
    const sid = songId;
    if (!score || scoreId !== sid || busyNow()) return queueRemote({ ...p, songs: gone }); // (setScore flushes; a song gone meanwhile is closed later)
    if (p.takes.has(sid)) {
      const t = reviveTake(await getTake(sid, { voice: true }).catch(() => null));
      if (sid !== songId || scoreId !== sid || busyNow()) return queueRemote({ takes: [sid], state: p.state, profiles: p.profiles });
      // (A take sung here that isn't recorded yet has no time: it's never replaced.)
      if (t && (!take || (take.at && take.at < t.at))) { take = t; reviewRows = []; closeReview(); }
    }
    if (p.state.has(sid) || p.takes.has(sid) || p.profiles) {
      const savedKey = readKeys()[sid];
      transpose = typeof savedKey === "string" && savedKey.startsWith("fit") ? savedKey : Number(savedKey) || 0;
      applySong();
    }
  }, 0);
}

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
  const legacyT = Number(recall(K.legacyTranspose));
  if (legacyT && savedSong) {
    const keys = readKeys();
    if (!(savedSong in keys)) keys[savedSong] = legacyT;
    store(K.keys, JSON.stringify(keys));
  }
  store(K.legacyTranspose, null);
  // The tempo % was one for every song before v71: it becomes the song open last's.
  const legacyRate = Number(recall(K.rate));
  if (legacyRate && legacyRate !== 1 && savedSong) {
    const rates = readRates();
    if (!(savedSong in rates)) rates[savedSong] = legacyRate;
    store(K.rates, JSON.stringify(rates));
  }
  store(K.rate, null);
  await refreshLibrary();
  const known = SAMPLES[savedSong] || (savedSong && [...mySongsEl.querySelectorAll("option")].some((o) => o.value === savedSong));
  await selectSong(known ? savedSong : "amazing-grace");
})();

// Debug hook for automated tests / devtools.
window.resonateDebug = () => ({ score, notes, lines, take, session: session && { kind: session.kind, line: session.line, mode: session.mode, count: session.count, beatSec: session.beatSec }, nowT, scrollT, practiceJ, reviewRows, rate, laneMode,
  practice: { on: guiding(), doc: pdoc, session: psess, step: pstep, block: gblock && { phase: gblock.phase, step: gblock.step, setup: gblock.setup, round: gblock.round, last: gblock.last && { r: { ...gblock.last.r, notes: undefined }, tv: gblock.last.tv, uv: gblock.last.uv } },
    phrases: psong?.phrases.map((p) => ({ name: p.name, j0: p.j0, j1: p.j1, t0: p.t0, t1: p.t1, mk: p.mk, section: p.section, marks: P.phraseMarks(pdoc, p) })),
    card: { title: coTitle.textContent, win: coWin.textContent, cue: coCue.textContent, buttons: [...coBtns.querySelectorAll("button")].map((b) => b.textContent), hidden: coachEl.hidden }, thenNow: !!thenNow },
  monitor: mon && { listening: !!mon.stream, opening: mon.opening, ctx: mon.micCtx.state }, you: currentYou(), tapTargets: tapAlong?.targets });
