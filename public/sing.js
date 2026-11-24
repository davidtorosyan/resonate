// Sing (karaoke) mode: the score sets the clock. Notes scroll toward a "now"
// line with their lyrics; after a count-in you sing along, and each score
// note is graded on the pitch you held during its own time slot (any octave).

import { parseMusicXml, readScoreFile, notesForVerse, lyricLines } from "./musicxml.js?v=102";
import { noteName as nameOf, BLACK, fold, median, centsLabel, transposeKey, keyName, spellTransposed } from "./music.js?v=102";
import { openMic, createReader, soundGone, ANALYSIS_LAG, FFT_SIZE, MIN_RMS } from "./pitch.js?v=102";
import { gradeTake, gradeLive, takeScore, timingTendency, MAX_SHIFT, GOOD_CENTS, OK_CENTS } from "./grade.js?v=102";
import { analyzeLines, lineDelta, feedback, rhythmText, roundResult, runResult, securedText } from "./coach.js?v=102";
import * as P from "./practice.js?v=102";
import { knotsFromTaps, mergeKnots, makeTiming, splitPauses, MIN_GAP } from "./timing.js?v=102";
import { startCapture, playVoice } from "./capture.js?v=102";
import { loadPiano, pianoReady, playPiano, holdPiano, playClick, clickWave, CLICK_GAIN, scheduleAhead, keepAlive, ownContext, sleepAudio } from "./piano.js?v=102";
import { makeFeatures, findClicks, tolOn } from "./rhythm.js?v=102";
import * as TR from "./takerhythm.js?v=102";
import * as E from "./ear.js?v=102";
import { listSongs, getSong, addSong, persistent, getTake, putTake, putClip, getClip, listClips } from "./library.js?v=102";
import { SAMPLES, songXml, songRev, songInfo } from "./catalog.js?v=102";
import { forgetSong } from "./forget.js?v=102";
import { activeProfile } from "./profiles.js?v=102";
import { fitOptions, fitKey, fitToRange } from "./fit.js?v=102";
import { DATA_KEYS } from "./space.js?v=102";
import { spaceChanged } from "./nav.js?v=102";
import { shareSong, takeStarted, lineDone, takeEnded, remote, paintRemote } from "./assist.js?v=102";

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

const K = {
  song: "resonate.sing.song",
  legacyXml: "resonate.sing.customXml",   // pre-library single custom song (migrated)
  legacyName: "resonate.sing.customName",
  verse: "resonate.sing.verse",
  keys: "resonate.sing.keys",                  // { songId: semitones }
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
// A note with no pitch counts as sung ("unclear", not missed) only above this, and the take's own noise
// floor (grade.js loudGate) — MIN_RMS whatever this device's calibrated gate (the mic's reader takes that,
// so a distant singer's pitches are read): with the lower one a fan starting mid-take made every skipped
// note "unclear".
const LOUD_MIN = MIN_RMS;
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
// (The meter is the one in effect at a measure; the beat you feel — takerhythm.js.)
const meterAt = (mi) => TR.meterAt(score, mi);
const measureAt = (q) => TR.measureAt(score, q);
const feltBeat = TR.feltBeat;
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
// A song with its own tempo (typed or tapped: `bpm`) slowed in Ear (Normal · Slow · Slower — the ♩ menu's own
// setting): its share of that tempo, kept per song in resonate.sing.eardata (`sp`; device-only, as the rest of it) —
// the menu shows it as "♩=139 (yours · 80%)". Any other choice in the menu, a typed or tapped tempo, clears it.
const EAR_DATA = "resonate.sing.eardata";
const EAR_SPEEDS = [[1, "Normal"], [0.8, "Slow"], [0.7, "Slower"]];
function ownSpeed() {
  let sp = 1;
  try { sp = (JSON.parse(recall(EAR_DATA) || "{}") || {})[songId]?.sp; } catch {}
  return sp === 0.8 || sp === 0.7 ? sp : 1;
}
// → true when it changed.
function setOwnSpeed(f) {
  if (!songId || ownSpeed() === f) return false;
  let all = {};
  try { all = JSON.parse(recall(EAR_DATA) || "{}") || {}; } catch {}
  const cur = { ...(all[songId] || {}), v: 1 };
  if (f === 1) delete cur.sp;
  else cur.sp = f;
  all[songId] = cur;
  store(EAR_DATA, JSON.stringify(all));
  return true;
}
function loadTiming() {
  const e = timingEntry();
  tmap = e?.segs?.length ? makeTiming(e.segs) : null;
  useMap = !!(tmap && e.use);
  const saved = Number(readRates()[songId]) || 1;
  rate = !useMap && e?.bpm ? (e.bpm / score.tempo) * ownSpeed() : RATES.includes(saved) || MAP_RATES.includes(saved) ? saved : 1;
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
  const e = timingEntry(), sp = !useMap && e?.bpm ? ownSpeed() : 1;
  if (sp !== 1) {
    // (the song's own tempo, slowed in Ear: that tempo — o:1 — and the share of it in use, among the score's)
    const own = e.bpm / score.tempo;
    const xs = [...RATES.map((r) => [r, `r:${r}`, r === 1 ? "" : ` (${Math.round(r * 100)}%)`]), [own, "o:1", " (yours)"], [own * sp, `o:${sp}`, ` (yours · ${Math.round(sp * 100)}%)`]];
    for (const [r, v, l] of xs.sort((a, b) => a[0] - b[0])) g.append(new Option(`♩=${Math.round(score.tempo * r)}${l}`, v));
  } else {
    const rs = useMap || RATES.includes(rate) ? RATES : [...RATES, rate].sort((a, b) => a - b); // + this song's tapped tempo
    for (const r of rs) {
      const bpm = Math.round(score.tempo * r);
      g.append(new Option(`♩=${bpm}${r === 1 ? "" : RATES.includes(r) ? ` (${Math.round(r * 100)}%)` : " (yours)"}`, `r:${r}`));
    }
  }
  const t = group("Set the tempo");
  t.append(new Option("Type a tempo…", "type"));
  t.append(new Option("Tap the beat…", "tap"));
  t.append(new Option("Tap along with a recording…", "tapmap"));
  if (tmap) t.append(new Option("Forget the tapped timing", "clearmap"));
  tempoSelect.value = sp !== 1 ? `o:${sp}` : `${useMap ? "m" : "r"}:${rate}`;
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
  if (!r && typeof transpose === "string") return showMsg("", "info", { href: "./?open=voice", text: "Set your range" });
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
let songRevNow = null; // the library's rev of the MusicXML loaded (a new one when it's replaced: its PDF read again)
function setScore(sc, stored = null) {
  earFresh = true; // (Ear starts the song afresh, on its stored line: another song, or this one read again)
  score = sc;
  scoreId = songId;
  minor = guessMinor(sc);
  const savedKey = readKeys()[songId];
  transpose = typeof savedKey === "string" && savedKey.startsWith("fit") ? savedKey : Number(savedKey) || 0;
  // "fit" (Fit my range… chosen while the profile had no range — and v32's single "Fit") becomes
  // the option it picks once there is one.
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
  window.resonateSing?.onSong?.(songId, sc.title);
}

// id: a sample key, or a saved song's id (from library.js). Its last take comes back with it.
// → true once it's open; false when it isn't: a PDF only (not converted yet — nothing changes here,
// a word says so), a song that couldn't be read (the one before stays: its score, the menu, the
// saved choice), or a newer choice came first. remember false: not saved as the song open
// (resonate.sing.song, shared with Play and the shell) — a stand-in for one Sing can't open.
let songGen = 0; // a newer selectSong wins over one still loading
let songAsk = 0, songWent = 0; // (requests in the order made: one that looked its song up wins only if no later one went ahead)
async function selectSong(id, { remember = true } = {}) {
  const ask = ++songAsk;
  if (!SAMPLES[id]) {
    const info = await songInfo(id).catch(() => null);
    if (info?.k === "pdf") {
      if (songId) songSelect.value = songId;
      showMsg(`“${info.title}” is a PDF — convert it in Songs.`);
      return false;
    }
    if (ask < songWent) return false;
  }
  songWent = ask;
  stopLoop();
  earStop(); // (Ear's phrase, note or attempt: its sound and mic stop too)
  stopGuided();
  stopSession();
  $("taptempo").hidden = true; // (their taps belong to the song they were opened on)
  $("tapalong").hidden = true;
  tapAlong = null;
  const gen = ++songGen;
  const before = scoreId; // (the song loaded now: it stays if this one can't be read)
  songId = id;
  songSelect.value = id;
  removeBtn.hidden = !!SAMPLES[id];
  const stored = getTake(id, { voice: true }).catch(() => null);
  let rev = null, sc, rec;
  try {
    if (SAMPLES[id]) {
      const res = await fetch(SAMPLES[id].url);
      if (!res.ok) throw new Error(`couldn't load (${res.status})`);
      sc = parseMusicXml(await res.text(), SAMPLES[id].title);
      sc.title = SAMPLES[id].title;
    } else {
      const song = await getSong(id);
      if (!song) throw new Error("that song is no longer saved");
      const xml = songXml(song);
      if (xml == null) throw new Error("it's only a PDF so far"); // (the index said otherwise: another tab's)
      sc = parseMusicXml(xml, song.title);
      rev = song.rev ?? null;
    }
    rec = await stored;
    if (gen !== songGen) return false;
  } catch (err) {
    console.error(err);
    if (gen !== songGen) return false;
    showMsg(`Couldn't load song: ${err.message}`, "error");
    songId = before;
    songSelect.value = before ?? "";
    removeBtn.hidden = !before || !!SAMPLES[before];
    return false;
  }
  // (Read: it's the song open now, whatever goes wrong drawing it.)
  songRevNow = rev;
  if (remember) store(K.song, id);
  try { setScore(sc, rec); }
  catch (err) { console.error(err); showMsg(`Couldn't load song: ${err.message}`, "error"); }
  return true;
}

// (SAMPLES, the OMR clean-ups on load — cleanXml — and songXml are in catalog.js, shared with Play.)

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

// (A PDF only — not converted yet — is listed, but can't be chosen: "Title · PDF".)
async function refreshLibrary() {
  const songs = await listSongs();
  mySongsEl.textContent = "";
  for (const s of songs) {
    const pdf = s.k === "pdf";
    const o = new Option(pdf ? `${s.title} · PDF` : s.title, s.id);
    o.dataset.title = s.title;
    if (pdf) { o.disabled = true; o.dataset.k = "pdf"; }
    mySongsEl.appendChild(o);
  }
  mySongsEl.hidden = !songs.length;
  if (songId) songSelect.value = songId;
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

// A part's count-in (a loop round, a guided round, Ear's Beats — its ● Sing and its ▶ Hear alike): a bar in the
// meter it starts in, at the song's pace there (up to lastQ), plus — on a line in the song's pickup bar — the
// pickup's missing beats, fractional when the pickup isn't whole beats.
function partCountIn(startM, startQ, lastQ) {
  const meter = meterAt(startM), fbm = feltBeat(meter);
  const pickLen = (score.measures[startM + 1] ?? score.length) - score.measures[startM];
  const pickupFill = pickLen < fbm.n * fbm.q - 1e-6 && (score.measureOf?.[startM] ?? startM) === 0 ? (fbm.n * fbm.q - pickLen) / fbm.q : 0;
  return { meter, beatSec: beatSecAt(startQ, lastQ, meter), count: fbm.n + pickupFill, barBeats: fbm.n, pickup: pickupFill > 0 };
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
  window.resonateSing?.beforeSound?.(); // (the shell's tuner gives its mic up first; nothing on sing.html)
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
  statusEl.textContent = earBeatsTake() ? "" : "requesting mic…"; // (Ear says Mic… itself)
  const slept0 = sleeps;
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
  ownContext(mic.ac);
  // The loop stopped meanwhile, or the page went to the background (a whole take doesn't start there).
  const gone = () => (part && !partAlive(part)) || document.hidden || sleeps !== slept0;
  const standDown = () => { if (!part) { statusEl.textContent = "stopped (backgrounded)"; singBtn.disabled = listenBtn.disabled = false; updateButtons(); } };
  if (gone()) { await mic.close(); return standDown(); }
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
  if (gone()) { // the loop stopped while the piano loaded (or the page was hidden)
    try { await wakeLock?.release(); } catch {}
    await mic.close();
    return standDown();
  }

  if (session) stopSession(); // anything that started while the mic opened (its sounds would play on)
  const nodes = [];
  const startQ = part ? part.fromQ : score.measures[entryIdx] ?? 0;
  const lastQ = part ? notes[part.range[1] - 1].q + notes[part.range[1] - 1].dq : score.length;
  const startM = part ? part.fromM : entryIdx;
  const pci = part ? partCountIn(startM, startQ, lastQ) : null;
  const meter = pci ? pci.meter : countInMeter(startM); // one meter for the count-in's beats, pace and accents
  const beatSec = pci ? pci.beatSec : beatSecAt(startQ, lastQ, meter); // the count-in's pace: the song's at its start
  const start = part ? part.from : entryT;
  const end = part ? part.until : songEnd + END_PAD;
  const [j0, j1] = part ? part.range : [0, notes.length];
  const count = pci ? pci.count : countInBeats();
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
    if (earBeatsTake()) earTakeTick(songT, r, ac); // (Ear's Beats: the count-in row, the level ring)
    if (!earBeatsTake()) statusEl.textContent = songT < start ? `count-in ${Math.max(1, Math.min(Math.ceil(count), Math.floor((songT - start + count * beatSec) / beatSec) + 1))}` : `${r.db.toFixed(0)} dB`; // (Ear's Beats: no count-in or dB in the controls row)
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
    take.grades[j] = gradeLive(notes, take.frames, j, { endT: t, gate: LOUD_MIN });
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
  const part = gradeTake(notes.slice(j0, j1), take.frames, { endT, gate: LOUD_MIN });
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

// Per note, where it sits in the beat; after a take, each note's onset and what the timing
// says, per phrase while guiding — takerhythm.js (the node suites test the same functions).
function metricOf() { return TR.metricOf(score, notes, lines, qToT); }
function rhythmOf(s, v, cal, stopAt, settings) {
  return TR.rhythmOf({ s, v, cal, stopAt, settings, take, score, notes, lines, qToT, tapped: !!(useMap && tmap),
    songPhrases: () => (guiding() ? psong.phrases.map((p) => p.js) : null) });
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
    playCtx = ownContext(new (window.AudioContext || window.webkitAudioContext)());
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
  window.resonateSing?.beforeSound?.();
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
  if (!e.isTrusted || document.hidden || session?.kind === "sing" || e.target.closest?.("#sing, #tapalong, #taptempo")) return;
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
let hushed = false;      // the one-page shell: another module sounds (its Piano, the Score) — the mic stays closed as for a key (never set on sing.html)
const youFrames = [];    // recent { t (s, performance clock), midi | null }

function monitorOn() {
  if (mon) return;
  // In the tap: the context may start now and keep running between mic sessions (made
  // for recording, like the Voice page's). If a key, Listen or Play is sounding, the
  // session goes straight back to playback so it stays loud; the mic opens after.
  setSession("play-and-record");
  const micCtx = ownContext(new (window.AudioContext || window.webkitAudioContext)());
  micCtx.resume().catch(() => {});
  if (keys.size || hushed || starting === "play" || (session && session.kind !== "sing")) setSession("playback");
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

const monitorListens = () => mon && !hushed && !session && !drill && !gblock && !starting && !keys.size && !document.hidden;

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
  if (!sing && (keys.size || hushed)) {
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
  const ac = ownContext(new (window.AudioContext || window.webkitAudioContext)());
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

const PK = { doc: "resonate.sing.practice", session: "resonate.sing.session", guided: "resonate.sing.ear" };
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
  const newSong = pdocId !== songId || earFresh, earWas = newSong ? null : earPh(); // (Ear: the line open before a regroup)
  earFresh = false;
  if (pdocId !== songId) { thenNow = null; thenNowFresh = false; lastRound = null; mapNew.clear(); cardGlow = 0; winsShown = []; }
  psong = null;
  pstep = null;
  cardRes = null;
  if (!score || !notes.length || !songId) return renderGuided();
  try {
    psong = P.groupPhrases(notes, lines, { spq: songSpq(), barQAt, measureOf: score.measureOf || null });
  } catch (err) { console.warn("practice: grouping", err); psong = null; }
  earRegroup(newSong, earWas);
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
  // (E8 prototype: Ear replaces the card and the map)
  if (on && earActive()) { mapEl.hidden = true; coachEl.hidden = true; return renderEar(); }
  renderEar();
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
const spanOf = (p0, p1) => spanJs(psong.phrases[p0].j0, psong.phrases[p1].j1);
// (notes [j0, j1): from the bar the first starts in — Ear's line, a printed one or the singer's own)
const spanJs = (j0, j1) => {
  const m = measureAt(notes[j0].q);
  const last = notes[j1 - 1];
  return { j0, j1, from: qToT(score.measures[m]), fromQ: score.measures[m], fromM: m, end: last.t + last.d };
};

// The plan's button (the footer's right one).
function runPlan() {
  if (!guiding()) return;
  if (earActive()) return earMain();
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
  const ac = ownContext(new (window.AudioContext || window.webkitAudioContext)());
  ac.resume().catch(() => {});
  return ac;
}

function stopGuided() {
  const b = gblock;
  if (!b) return;
  // Hear it stopped once a phrase has played still counts (decided now: the lane moves on below).
  if (b.step.kind === "hear" && nowT >= psong.phrases[b.step.from].t1) { pdoc = P.markHeard(pdoc, Date.now()); savePractice(); }
  gblock = null;
  if (b.step.kind === "ear" && EAR.count && !EAR.count.run) EAR.count = null; // (Ear's Beats: its count-in row goes with the take)
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

// ---------------------------------------------------------------------------
// Ear (E8 prototype, docs/EAR.md; the owner: "the beats and the notes exercises … pretty much the main
// thing I care about"). While "Guide me" is on (⚙ "Phrase by phrase"), Sing shows one line at a time (the
// printed line: ear.js EAR_PHRASE) with three modes:
//   Line  — ▶ Hear / ▶ First note (mic closed), ● Sing → the mic opens, nothing sounds, you sing on
//           your own time and tap ■ Done; your start and tempo are found from your pitch (ear.js judgeFree),
//           the existing grading counts ♩ (starts on time, against your own tempo) and ♪ (notes
//           within 50¢), then one win and at most one cue with ▶ note / ▶ you.
//   Beats — ▶ Hear (melody + click + the count-in ● Sing has, mic closed), ● Sing with the click (the guided
//           take path: count-in, click) at the ♩ menu's tempo — both with the count-in row (a dot a click, the
//           first word lit at the entry), then the level ring; ear.js judgeBeats: each start against its click
//           (the grid less the measured trip), a count off, steady behind / ahead, a drift, a note held long,
//           a start not sung, one start — ▶ Click / ▶ You (the take with the click) for the timing cues.
//   Notes — the notes the last Line attempt sang off or didn't sing (≤ 3, "Off last time"), then the line's lowest
//           and highest: a row of its pitches low → high (the word first sung on each), a tap plays one (mic
//           closed) and makes it current; ● Match: the note, then hold it (ear.js holdStep: 800 ms within 50¢, any
//           octave, within 6 s — a neutral ring and an arc for the time left; the mic gated at MIN_RMS until the
//           note's sound is gone); matched → it sounds again (an octave apart: the song's octave follows yours);
//           a miss: "Not yet", from the 2nd which way and how far (holdVerdict), from the 3rd ▶ Sing along / Next
//           note › (and "Too high for now?" on the top note sung low); every target held → ● Sing (the line).
// ▶ during an attempt ends it, uncounted ("Stopped — not counted"). For the shell an attempt is a take (its
// tuner — a live pitch readout — is hidden while Ear shows; its modules stay put), and anything of Ear's
// sounding is busy (the cloud's changes, a stale shell's reload wait for it). Each line and mode keeps its
// latest result (dimmed under "Last time" once you've moved away and back); the line open is kept per song
// (resonate.sing.eardata).
// No lane, no colours, no pitch readout: you train by ear. Counts, never a fraction or a %.

Object.assign(P.PRACTICE.phrase, E.EAR_PHRASE); // (a line: the printed line)
const EAR = {
  mode: "line",     // "line" | "beats" | "notes"
  p: 0,             // the line open (psong.phrases index)
  run: null,        // what runs: { kind: "play" | "notePlay" | "free" | "think" | "hold", … }
  res: null,        // the result of the attempt just made (res.view: the song, line and mode it's for)
  latest: {},       // view (song|line|mode) → the latest result there: "Last time", once you've moved away and back
  last: {},         // view|tempo → the latest whole attempt there (ear.js attemptOf — the store's too: earPrev; what "more than
                    //   last time" compares with: like with like)
  notesBy: {},      // song|line → Notes' state (earNotesOf): { targets: [offsets in the line], cur, done: Set (of offsets), tries, v, … }
  drillFrom: {},    // song|line → the latest Line result there Ear could follow (its drill: Notes' "Off last time" targets —
                    //   a silent attempt or one it couldn't follow after it says nothing about the notes)
  flash: "",        // a word on the stage instead of a result: "Stopped — not counted"
  fact: "",         // …or a fact until the next attempt: "Key A♭ → F" (Lower / Raise the song) — while the key is still that
  factTr: null,     //   one (factTr: the Key menu's value it left)
  heard: new Set(), // song|line|key: ▶ Hear has played it (the round ▶ stops pulsing)
  sound: null,      // our own ▶'s sound: { ac, end } (its context's time it has stopped) — a mic opened right after
                    //   hears its tail (pitch.js soundGone): the attempt gates at MIN_RMS until it's gone
  count: null,      // Beats' count-in row while it shows (earCountRow): ● Sing's, lit from the take's clock, or ▶ Hear's
  level: 0,         // the Beats take's mic level (the ring; a free attempt's and a hold's are their run's)
  tip: false,       // 🎧 shown with this Beats take and its result (once per touch device)
  oct: 0,           // the singer's octave against the written one (semitones: −12 a man on a soprano's tune), from a Notes
                    //   match an octave apart — every ▶ of Ear's plays in it; kept per song (eardata)
  octWas: 0,        // the octave a match set this visit (the action row's "Octave down" chip: a tap toggles it)
  hintRoom: false,  // the first times' hint has had its line this visit: it keeps it (quiet) — nothing moves as hints retire
  list: [],         // the lines: the printed ones (psong.phrases) and the singer's own (Pick words: ★), in song order —
                    //   EAR.p indexes it
  pick: null,       // Pick words in the Lines sheet: { a: the first word picked (its index in the song's words) | null }
  secNew: null,     // the line (wk) whose ♩ / ♪ was just secured: its dot pulses once
};
// (a playPiano note rings on RELEASE × 6 after its end: piano.js)
const EAR_TAIL = 0.72;
// Our own ▶'s tail: until when (performance.now() ms) a mic may still hear it (a context put to sleep or closed
// mid-sound stopped it: its clock stands still).
const earSettle = () => (EAR.sound && EAR.sound.ac.state === "running" ? Math.min(soundGone(EAR.sound.ac, EAR.sound.end), performance.now() + 3000) : 0);
let earFresh = true; // (a score just loaded: earRegroup starts Ear afresh)
const EK = EAR_DATA; // { songId: { v: 1, p: the line open (its wk), pi: its index, oct: the singer's octave (EAR.oct), sp: a song with its own tempo slowed (ownSpeed),
                     //   own: the singer's own lines, ph: { [wk]: each line's attempts, heard } } } — ear.js EAR_STORE; device only (DATA_KEYS: shelved with the account; forget.js, sync.js's tombstones)
const EH = "resonate.sing.earhint"; // { line, beats, hold: attempts judged on this device } — a device pref: the first times' hints
let earHints = readAll(EH);
const earEl = $("ear");
const earActive = () => guiding() && !drill;
const earPh = () => EAR.list[Math.min(EAR.p, EAR.list.length - 1)] || null;
// This song's record in the store (ear.js EAR_STORE), and a write to it (fn: the record → the record).
const earData = () => (songId ? readAll(EK)[songId] || null : null);
function earWrite(fn) {
  if (!songId) return;
  const all = readAll(EK);
  all[songId] = { ...fn({ ...(all[songId] || {}) }), v: 1 };
  store(EK, JSON.stringify(all));
}
// A line's record (its attempts, heard) — by its wk: a repeat shares it.
const earRecOf = (ph, data = earData()) => (ph?.wk ? data?.ph?.[ph.wk] || null : null);
function earWriteRec(ph, fn) {
  if (!ph?.wk) return;
  earWrite((d) => ({ ...d, ph: { ...(d.ph || {}), [ph.wk]: fn({ ...(d.ph?.[ph.wk] || {}) }) } }));
}
// ▶ Hear has played this line in this key — this visit, or within EAR_STORE.heard (the "▶ Hear it first" hint).
function earHeard(ph) {
  if (!ph) return false;
  if (EAR.heard.has(earHeardKey(ph))) return true;
  const r = earRecOf(ph);
  return !!r?.h && r.hk === transpose && Date.now() - r.h < E.EAR_STORE.heard;
}
function earMarkHeard(ph) {
  EAR.heard.add(earHeardKey(ph));
  earWriteRec(ph, (r) => ({ ...r, h: Date.now(), hk: transpose }));
}
// A line the singer picked (Pick words: ear.js wordTokens / ownSpan), as a line: groupPhrases's fields for notes [j0, j1).
function earOwnPh(j0, j1) {
  const js = [];
  for (let j = j0; j < j1; j++) js.push(j);
  const words = P.wordsOf(notes, js), keys = P.phraseKeys(notes, js, words);
  const q1 = Math.max(...js.map((j) => notes[j].q + notes[j].dq));
  const sec = psong?.phrases.find((p) => p.j0 <= j0 && j0 < p.j1)?.section ?? 0;
  const ph = { own: true, i: -1, js, lines: [], j0, j1, q0: notes[j0].q, q1, t0: notes[j0].t, t1: Math.max(...js.map((j) => notes[j].t + notes[j].d)),
    sec: (q1 - notes[j0].q) * songSpq(), syl: js.filter((j) => !notes[j].melisma).length, words, bars: "", mk: keys.mk, wk: keys.wk,
    hardBefore: false, hard: null, pass: notes[j0].pass ?? 1, section: sec, ride: false, head: words, headCut: false };
  ph.name = words ? P.phraseName(ph) : notes.slice(j0, Math.min(j1, j0 + 4)).map((n) => n.name).join(" ");
  ph.label = ph.name;
  return ph;
}
// The singer's own lines as they are in the notes now: each where its notes still give its wk (else where they
// do now — a reconversion moved it —, else not shown: kept in the store).
function earOwnLines(data = earData()) {
  const out = [];
  for (const o of data?.own || []) {
    const n = o.j1 - o.j0;
    if (!(n > 0) || !notes.length) continue;
    const at = (j0) => (j0 >= 0 && j0 + n <= notes.length && P.phraseKeys(notes, Array.from({ length: n }, (_, k) => j0 + k)).wk === o.wk ? earOwnPh(j0, j0 + n) : null);
    let ph = at(o.j0);
    for (let j = 0; !ph && j + n <= notes.length; j++) if (j !== o.j0) ph = at(j);
    if (ph && !out.some((x) => x.j0 === ph.j0 && x.j1 === ph.j1)) out.push(ph);
  }
  return out;
}
// Ear's lines: the printed ones, the singer's own after the line each starts in (song order).
function earBuildList() {
  const ps = psong?.phrases || [];
  EAR.list = [...ps, ...earOwnLines()].sort((a, b) => a.j0 - b.j0 || (a.own ? 1 : 0) - (b.own ? 1 : 0) || a.j1 - b.j1);
}
const earJs = E.phraseJs;
const earMidi = (j) => notes[j].midi + (notes[j].shift || 0);
// A note as Ear plays it: in the singer's octave (EAR.oct; D3 "in the octave last sung").
const earRefMidi = (j) => earMidi(j) + EAR.oct;
// A note's name in the key's spelling (n.name), in an octave `oct` semitones from the written one.
const earNoteName = (j, oct = EAR.oct) => (notes[j].name || noteName(earMidi(j))).replace(/(-?\d+)$/, (d) => String(Number(d) + Math.round(oct / 12)));
// (the judgments are ear.js's, on the song's notes as they're shown: tools/earcases.mjs runs the same code —
// the count sets at the song's own tempo, the meter on the singer's clock)
const earCtx = (more = {}) => ({ notes, spq: secPerQuarter(), spq0: songSpq(), name: noteName, score, qToT, ...more });
const earSleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A line of this song (two with the same tune and words are one), a view (+ the mode), the key it's heard in.
const earLineKey = (ph) => `${songId}|${ph.wk || ph.mk || ph.j0}`;
const earViewKey = (mode = EAR.mode, ph = earPh()) => (ph ? `${earLineKey(ph)}|${mode}` : null);
const earHeardKey = (ph) => `${earLineKey(ph)}|${transpose}`;
// An attempt (the mic open on Ear's own time, being judged, a held note): a take, for the shell.
const earTake = () => { const k = EAR.run?.kind; return k === "free" || k === "think" || k === "hold"; };
const earBeatsTake = () => gblock?.step?.kind === "ear";

// The result shown for the line and mode open: the attempt just made, else the latest there (old: dimmed).
// A result sung in another key isn't shown (its notes aren't these: the key's moved — Lower the song).
function earShown() {
  if (EAR.mode === "notes") return null;
  const view = earViewKey(), ph = earPh();
  if (!view) return null;
  const here = (r) => !!r && (r.tr === undefined || r.tr === transpose);
  if (EAR.res?.view === view && here(EAR.res)) return { res: EAR.res, old: false };
  const l = EAR.latest[view];
  if (here(l)) return { res: l, old: true };
  // (none this visit: the last whole attempt here in this key, from the store — its counts, win and cue)
  const st = E.lastFrom(earRecOf(ph), EAR.mode, transpose, ph);
  return st ? { res: { ...st, view }, old: true } : null;
}
// The last whole attempt at this line, of this kind, at this speed (what judgeFree / judgeBeats compare with: "more
// than last time", "right on it now", "twice running", never the same win twice) — the store's, or this visit's
// when the store couldn't take it (another tab switched whose data this device shows).
function earPrev(ph, kind) {
  const m = EAR.last[`${earViewKey(kind, ph)}|${rate}`], a = [...(earRecOf(ph)?.a || [])];
  if (m && !a.some((x) => x.at === m.at && x.k === m.k)) a.push(m);
  return E.prevFrom({ a: a.sort((x, y) => x.at - y.at) }, kind, rate, ph);
}

// The line open, kept for the song (a reload, another song and back open it again).
function earSaveLine() {
  const ph = earPh();
  if (!songId || !ph) return;
  earWrite((d) => ({ ...d, p: ph.wk || null, pi: EAR.p, oct: EAR.oct || 0 }));
}
// The song's lines grouped again (loadPractice): another song opens on its own line, with nothing of the
// last one's (results, Notes' targets, ▶ heard); the same song (a verse, a key) keeps the line open.
function earRegroup(newSong, was) {
  if (!psong?.phrases.length) { EAR.list = []; return; }
  earBuildList();
  const ps = EAR.list;
  // (a line by its wk — a repeat shares it: the one at that place first)
  const find = (wk, j0) => { const xs = ps.map((p, i) => [p, i]).filter(([p]) => p.wk === wk); return (xs.find(([p]) => p.j0 === j0) || xs[0])?.[1] ?? -1; };
  if (newSong) {
    EAR.res = null;
    EAR.flash = "";
    EAR.fact = ""; // ("Key A♭ → F" was the last song's: another song at the same Key menu value isn't it)
    EAR.factTr = null;
    EAR.tip = false;
    if (EAR.count && !EAR.count.run) EAR.count = null;
    EAR.latest = {};
    EAR.notesBy = {};
    EAR.drillFrom = {};
    EAR.heard.clear();
    EAR.pick = null;
    EAR.secNew = null;
    closeEarLines(); // (its rows were the last song's)
    // (the record may hold no line yet — ▶ Hear, an attempt or Slow write it before ‹ › ever does)
    const s = readAll(EK)[songId];
    EAR.p = s?.p && Number.isInteger(s.pi) && ps[s.pi]?.wk === s.p ? s.pi : Math.max(0, s?.p ? find(s.p, -1) : 0);
    EAR.oct = [-24, -12, 12, 24].includes(s?.oct) ? s.oct : 0;
    EAR.octWas = EAR.oct;
  } else if (was && (ps[EAR.p]?.wk !== was.wk || ps[EAR.p]?.j0 !== was.j0)) {
    // (not there by its wk — another verse's words —: the printed line at its place, not whatever line has its
    // index now: the singer's own lines come and go with their words)
    let i = find(was.wk, was.j0);
    if (i < 0) i = ps.findIndex((p) => !p.own && p.j0 <= was.j0 && was.j0 < p.j1);
    if (i >= 0) EAR.p = i;
  }
  if (!(EAR.p >= 0 && EAR.p < ps.length)) EAR.p = 0;
}
// The device's attempts so far (the first times' hints: ▶ Hear it first …).
function earCount(kind) {
  earHints = { ...earHints, [kind]: (earHints[kind] || 0) + 1 };
  store(EH, JSON.stringify(earHints));
}
// The first times' hint, one line under the tabs, until this device has had 3 Line attempts / 2 Beats takes / 2
// holds judged: Line "▶ Hear it first" (the round ▶ pulses; a line not heard yet this visit in this key and not sung
// in it) → "Now ● Sing — at your own speed"; Beats "Sing along with the clicks"; Notes "Hear a note, sing it back,
// keep it going". → { on (the line keeps its place — the action row under it never moves), text ("": nothing to say
// now — an attempt, a result, a verdict, something sounding in Notes) }.
const EAR_HINTS = { line: 3, beats: 2, hold: 2 };
function earHint() {
  const kind = EAR.mode === "notes" ? "hold" : EAR.mode, ph = earPh();
  if (!earActive() || !ph) return { on: false, text: "" };
  if ((earHints[kind] || 0) >= EAR_HINTS[kind]) {
    // (the song just moved to another key — Lower / Raise the song —: hear it there first, however many attempts)
    const again = EAR.mode === "line" && !!earFact() && !EAR.run && !gblock && !earHeard(ph) && !earShown();
    // (its line stays, quiet, while another mode's hint is still to come and once shown this visit: a hint retiring —
    // the 3rd Line attempt's result, the 2nd hold — or another mode's still showing moves nothing on screen)
    const room = EAR.hintRoom || Object.keys(EAR_HINTS).some((x) => (earHints[x] || 0) < EAR_HINTS[x]);
    return again ? { on: true, text: "▶ Hear it first" } : { on: room, text: "" };
  }
  const k = EAR.run?.kind;
  if (gblock || (k && k !== "play") || (EAR.mode === "notes" && k)) return { on: true, text: "" };
  if (EAR.mode === "notes") { const N = earNotesOf(ph); return { on: true, text: N.v || N.complete || N.fact ? "" : "Hear a note, sing it back, keep it going" }; }
  if (earShown()) return { on: true, text: "" };
  if (EAR.mode === "beats") return { on: true, text: "Sing along with the clicks" };
  return { on: true, text: earHeard(ph) ? "Now ● Sing — at your own speed" : "▶ Hear it first" };
}
function earHearFirst() { return !EAR.run && earHint().text === "▶ Hear it first"; }

// An Ear run that's over (if it's still the one): the screen follows, and what waited for it (the cloud's
// changes, busyNow) comes in.
function earEnd(run) {
  if (EAR.run !== run) return false;
  EAR.run = null;
  if (EAR.count?.run === run) EAR.count = null;
  renderEar();
  updateButtons();
  flushRemote();
  return true;
}
// Stop whatever Ear is doing (a sound, an attempt, a note hold).
function earStop() {
  const r = EAR.run;
  if (!r) return;
  EAR.run = null;
  if (EAR.count?.run === r) EAR.count = null;
  r.stopped = true;
  r.stop?.();
  renderEar();
  updateButtons();
  flushRemote();
}

// The line (or its first note) on the piano, a click and a count-in for Beats, or one note (midi: as it sounds);
// mic closed; in the singer's octave (EAR.oct). An attempt under way ends, uncounted (the fix plan's Q-I). kind "notePlay": Notes' note before its hold —
// the run stays for earNote to hand on to the hold (→ true: it played to its end). range [ja, jb]: only those
// notes (a cue's stretch) — scale: at the attempt's own tempo (its fitted b: seconds sung per second heard); with
// click, two clicks before the beat it starts on, then the beat through it (▶ Click).
// The whole line with the click (Beats' ▶ Hear) counts in as ● Sing does, its row lit as it plays.
async function earPlay({ first = false, click = false, midi = null, dur = 1.2, kind = "play", range = null, scale = 1, tag = null } = {}) {
  window.resonateSing?.beforeSound?.(); // (the shell's tuner gives its mic up first: iOS plays quietly while one is open)
  const attempt = EAR.run?.kind === "free" || earBeatsTake();
  earStop();
  if (gblock) stopGuided();
  stopSession();
  stopKeys();
  EAR.count = null;
  if (attempt) EAR.flash = "Stopped — not counted";
  const ph = earPh();
  if (!ph && midi == null) return false;
  const run = (EAR.run = { kind, tag, nodes: [], stop() {
    for (const n of this.nodes) { try { n.stop?.(); } catch {} try { n.disconnect?.(); } catch {} }
    if (this.sound && EAR.sound === this.sound) this.sound.end = Math.min(this.sound.end, this.sound.ac.currentTime + 0.02); // (cut: gone at once)
  } });
  if (midi == null && !first && !range && EAR.mode === "line") earMarkHeard(ph);
  // (Beats' ▶ Hear: its count-in row shows at once, lit once the sound starts)
  const sp = midi == null && click && !range ? spanJs(ph.j0, ph.j1) : null;
  const ci = sp ? earCountIn(ph, sp) : null;
  if (sp) EAR.count = { ...earCountRow(ph, sp, ci), run };
  updateButtons();
  renderEar();
  const ac = await getPlayCtx("tap");
  if (EAR.run !== run) return false;
  let piano = null;
  try { piano = await loadPiano(ac); } catch (err) { console.warn(err); }
  if (EAR.run !== run) return false;
  if (!piano) { earEnd(run); return false; }
  const t0 = ac.currentTime + 0.15;
  let end = t0;
  run.sound = EAR.sound = { ac, end: t0 };
  run.midis = []; // (what it plays: resonateDebug().ear.playing)
  if (midi != null) {
    run.midis.push(midi);
    const h = holdPiano(ac, piano, t0, midi, 2.0);
    h.release(t0 + dur);
    run.nodes.push({ stop: () => h.release(ac.currentTime, 0.02) });
    end = t0 + dur + 0.3;
    run.stopsAt = () => h.stopsAt();
    run.sound.end = h.stopsAt();
  } else {
    const ja = range ? range[0] : ph.j0, jb = range ? range[1] : ph.j1 - 1;
    const js = first ? [ph.j0] : earJs({ j0: ja, j1: jb + 1 });
    let base = t0 - notes[ja].t; // (song s → this context's: no click, the first note at once)
    if (sp) {
      // the count-in ● Sing has (partCountIn: a pickup's missing beats, fractional), then the bar's own beats
      for (let k = 0; k < ci.count; k++) playClick(ac, t0 + k * ci.beatSec, k % ci.barBeats === 0, run.nodes);
      base = t0 + ci.count * ci.beatSec - sp.from;
      const last = notes[ph.j1 - 1];
      for (const b of beatGrid()) if (b.t >= sp.from - 1e-6 && b.t <= last.t + last.d + 1e-6) playClick(ac, base + b.t, b.accent, run.nodes);
      EAR.count.ac = ac;
      EAR.count.songT0 = base;
      earCountPlay(run);
    } else if (click) {
      // a stretch with the click: two clicks before the beat it starts on, then the beat to its end
      const beat = beatSecAt(notes[ja].q), grid = beatGrid(), until = notes[jb].t + notes[jb].d;
      const g0 = grid.filter((b) => b.t <= notes[ja].t + 1e-6).pop()?.t ?? notes[ja].t;
      base = t0 - (g0 - 2 * beat);
      for (const k of [2, 1]) playClick(ac, base + g0 - k * beat, false, run.nodes);
      for (const b of grid) if (b.t >= g0 - 1e-6 && b.t <= until + 1e-6) playClick(ac, base + b.t, b.accent, run.nodes);
      end = Math.max(end, base + until + 0.3);
    }
    const sc = range && !click && Number.isFinite(scale) ? Math.max(0.5, Math.min(2.2, scale)) : 1;
    for (const j of js) {
      const n = notes[j], when = sc === 1 ? base + n.t : t0 + (n.t - notes[ja].t) * sc, d = (first ? Math.min(1.5, n.d) : n.d) * sc;
      playPiano(ac, piano, when, d, earRefMidi(j), 1.4, run.nodes);
      run.midis.push(earRefMidi(j));
      end = Math.max(end, when + d + 0.3);
      run.sound.end = Math.max(run.sound.end, when + Math.max(0.12, d) + EAR_TAIL);
    }
    if (click) run.sound.end = Math.max(run.sound.end, end); // (a click is gone in ~30 ms)
  }
  const left = Math.max(0, end - ac.currentTime) * 1000;
  run.done = earSleep(left);
  await run.done;
  if (kind === "notePlay") return EAR.run === run && !run.stopped; // (Notes: the hold takes over from here)
  earEnd(run);
  return true;
}

// Beats' count-in, as ● Sing has it (partCountIn on the line's span).
function earCountIn(ph, sp) {
  const last = notes[ph.j1 - 1];
  return partCountIn(sp.fromM, sp.fromQ, last.q + last.dq);
}
// Beats' count-in row (the fix plan's screens): every click before the line's first word — the count-in, then
// the bar's own beats up to it — in bars (a bar's first beat big), then the word, lit at the entry. Song s.
function earCountRow(ph, sp, ci) {
  const T1 = notes[ph.j0].t, clicks = [];
  for (let k = 0; k < ci.count; k++) clicks.push({ t: sp.from - (ci.count - k) * ci.beatSec, big: k % ci.barBeats === 0 });
  for (const b of beatGrid()) if (b.t >= sp.from - 1e-6 && b.t < T1 - 1e-6) clicks.push({ t: b.t, big: !!b.accent });
  const w = E.wordOf(ph.j0, notes);
  return {
    id: `${songId}|${ph.j0}|${rate}|${Date.now()}`, clicks, word: w?.word || noteName(earMidi(ph.j0)), entry: T1,
    // (the word on a bar's downbeat: a group of its own — not the song's pickup bar's start: that's a late beat)
    bar: !ci.pickup && score.measures.some((q) => Math.abs(q - notes[ph.j0].q) < 1e-6),
    end: T1 + Math.min(notes[ph.j0].d, ci.beatSec), lit: -1, word0: false, gone: false,
  };
}
// The row lit at song time t (as heard): every click gone by, the latest brighter; the word from the entry on.
// A take's row gives way to the level ring once the first word has been sung (end).
function earCountTick(t) {
  const c = EAR.count;
  if (!c) return;
  let lit = -1;
  for (let i = 0; i < c.clicks.length; i++) if (t >= c.clicks[i].t - 0.01) lit = i;
  const word = t >= c.entry - 0.01;
  if (lit !== c.lit || word !== c.word0) { c.lit = lit; c.word0 = word; paintCount(); }
  if (!c.run && !c.gone && t > c.end) { c.gone = true; renderEar(); }
}
// ▶ Hear's row, from the play context's clock while it plays.
function earCountPlay(run) {
  const step = () => {
    const c = EAR.count;
    if (EAR.run !== run || c?.run !== run) return;
    earCountTick(c.ac.currentTime - c.songT0 - (c.ac.outputLatency || c.ac.baseLatency || 0));
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
// A Beats take's frame (beginSing's tick): the level ring from the take's mic, the row from its song clock.
function earTakeTick(songT, r, ac) {
  EAR.level = Math.min(1, Math.max(0, (r.db + 60) / 50));
  renderEarLevel();
  earCountTick(songT - (ac.outputLatency || ac.baseLatency || 0));
}

// The line's tempo as heard now (♩ a minute: its quarters over its seconds — a tapped timing's own pace there).
function earLineBpm(ph) {
  const a = notes[ph.j0], z = notes[ph.j1 - 1], sec = z.t + z.d - a.t;
  return sec > 0 ? (60 * (z.q + z.dq - a.q)) / sec : null;
}
// ● Sing (the free attempt): the mic, nothing sounding; ■ Done ends it (or 3× the line + 5 s).
async function earFree() {
  if (EAR.run?.kind === "free") return earDone();
  window.resonateSing?.beforeSound?.();
  earStop();
  stopSession();
  stopKeys();
  closeReview();
  const ph = earPh();
  if (!ph) return;
  EAR.flash = "";
  EAR.fact = "";
  const ac = tapContext();
  const run = (EAR.run = { kind: "free", ph, frames: [], level: 0, ready: false, stop: null, ac });
  renderEar();
  updateButtons();
  let mic;
  try { mic = await openMic({ ac }); } catch (err) {
    showMsg(`Couldn't open the microphone: ${err.message || err.name}`, "error");
    ac.close().catch(() => {});
    earEnd(run);
    return;
  }
  micWasOpen = true;
  if (EAR.run !== run) { mic.close(); ac.close().catch(() => {}); return; }
  // (the recording's energy as it comes, for the starts: rhythm.js features, as a take's)
  const features = makeFeatures(ac.sampleRate);
  const cap = await startCapture(ac, mic.source, { onChunk: (c) => features.push(c) }).catch(() => null);
  const t0 = ac.currentTime, p0 = performance.now();
  const dur = notes[ph.j1 - 1].t + notes[ph.j1 - 1].d - ph.t0;
  // Our own ▶ may still ring in the mic: until it's gone a frame counts only above MIN_RMS (this device's
  // calibrated gate can be under it — the tail would read as the note sung: the line starts on the ▶'s last).
  const gate0 = mic.read.gate, settle = earSettle();
  run.gateUntil = settle > p0 ? (settle - p0) / 1000 - ANALYSIS_LAG : -Infinity;
  let raf = 0, firstAt = null;
  const tick = () => {
    if (EAR.run !== run) return;
    mic.read.gate = performance.now() < settle ? Math.max(gate0, MIN_RMS) : gate0;
    const r = mic.read();
    const t = ac.currentTime - t0 - ANALYSIS_LAG;
    run.frames.push({ t, midi: r.midi, rms: r.rms });
    run.level = Math.min(1, Math.max(0, (r.db + 60) / 50));
    if (firstAt == null) firstAt = performance.now();
    if (!run.ready && performance.now() - firstAt > 250) { run.ready = true; updateButtons(); }
    renderEarLevel();
    if (t > 3 * dur + 5) { earDone(); return; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  run.finish = async () => {
    cancelAnimationFrame(raf);
    // The mic stops now (the recording still flushes what it has), the session with it — before a ▶ that
    // ended the attempt sets "playback": iOS plays quietly while a capture is live, and an "auto" set after
    // the flush would have undone the ▶'s "playback".
    mic.stream.getTracks().forEach((t) => t.stop());
    setSession("auto");
    const voice = await cap?.finish().catch(() => null);
    mic.close();
    if (voice) voice.start -= t0; // (the attempt's clock: frame times)
    return { frames: run.frames, voice, endT: ac.currentTime - t0, feat: voice ? features.result() : null };
  };
  run.stop = () => { run.finish(); ac.close().catch(() => {}); };
}
async function earDone() {
  const run = EAR.run;
  if (!run || run.kind !== "free" || !run.ready) return;
  const think = (EAR.run = { kind: "think" });
  renderEar(); updateButtons();
  const { frames, voice, endT, feat } = await run.finish();
  run.ac.close().catch(() => {});
  await earSleep(50);
  if (EAR.run !== think) return; // (stopped meanwhile: another song, the page hidden)
  const prev = earPrev(run.ph, "line");
  const res = E.judgeFree(run.ph, frames, endT, earCtx({ feat, start: voice ? voice.start : null, gateUntil: run.gateUntil, prev }));
  res.voice = voice;
  res.bpm = earLineBpm(run.ph); // (the speed it was heard at: "You sang it at ♩=62" when the singer's was well off it)
  earShow(run.ph, "line", res);
  earCount("line");
  earEnd(think);
  earReveal();
}

// ● Sing with the click (Beats): the guided take path — count-in, the click, the line's span — its count-in row
// and level ring in Ear; then ear.js judgeBeats: each start against its click (the take's recording, as heard).
// 🎧 the first time on a touch device: the click is quiet on a phone's speaker while the mic is open.
const earTouch = () => { try { return matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0; } catch { return false; } };
async function earBeats() {
  if (gblock) return stopGuided();
  earStop();
  const ph = earPh();
  if (!ph) return;
  EAR.flash = "";
  EAR.fact = "";
  EAR.tip = false;
  if (earTouch() && !earHints.phones) { EAR.tip = true; earHints = { ...earHints, phones: 1 }; store(EH, JSON.stringify(earHints)); }
  const ac = tapContext();
  const b = gblock = { step: { kind: "ear" }, token: {}, phase: "sing", baseRate: rate, ac, savedTake: take?.part ? null : take, sid: songId };
  closeReview();
  stopKeys();
  const sp = spanJs(ph.j0, ph.j1);
  EAR.count = earCountRow(ph, sp, earCountIn(ph, sp));
  EAR.level = 0;
  renderEar();
  updateButtons();
  await startSing({ guided: true, from: sp.from, fromQ: sp.fromQ, fromM: sp.fromM, until: sp.end + MAX_SHIFT + 0.6, range: [sp.j0, sp.j1], ac, token: b.token, guide: "click", view: "practice", lane: "off", stage: "time", record: true, phrases: [ph.js] });
  if (gblock !== b) { if (EAR.count && !EAR.count.run) { EAR.count = null; renderEar(); } return; } // (the mic refused, stopped meanwhile)
  const s = session?.kind === "sing" ? session : null;
  const t = await s?.ended;
  if (EAR.count && !EAR.count.run) { EAR.count = null; if (gblock !== b) renderEar(); }
  if (gblock !== b) return;
  gblock = null;
  ac.close().catch(() => {});
  take = b.sid === songId && takeFits(b.savedTake) ? b.savedTake : null;
  if (t && b.sid === songId) {
    // (the take's recording and its features, on the frames' clock — the song as heard; the last whole Beats
    // attempt here at this speed: "In on … now", "more on the click than last time")
    let feat = null;
    try { feat = t.voice ? s.features.result() : null; } catch {}
    const prev = earPrev(ph, "beats");
    const res = E.judgeBeats(ph, t, earCtx({ feat, start: t.voice ? t.voice.start : null, prev }));
    // (▶ You plays the take with the clicks it was sung to — the count-in's and the guide's, song s at the take's
    // tempo — over the line, a beat before it to past its end: the ♩ menu may change before it's tapped)
    const last = notes[ph.j1 - 1];
    const clicks = [...(t.countClicks || []).map((c) => ({ t: c.t - t.songT0, accent: c.accent })), ...beatGrid().filter((g) => g.t >= sp.from - 1e-6 && g.t < sp.end + MAX_SHIFT + 0.6)];
    const youAt = t.voice ? [Math.max(t.voice.start, notes[ph.j0].t - beatSecAt(notes[ph.j0].q)), last.t + last.d + 0.6] : null;
    earShow(ph, "beats", { ...res, voice: t.voice, songT0: t.songT0, clicks, youAt });
    earCount("beats");
  }
  renderAll();
  renderEar();
  updateButtons();
  flushRemote();
  earReveal();
}

// The result of an attempt, kept for its line and mode: counts with ↑ against the last whole one of the same
// kind at the same tempo (EAR.last: what judgeFree compares with — its counts, win and cue; a silent attempt,
// one Ear couldn't follow or one stopped early isn't a baseline).
function earShow(ph, kind, res) {
  const view = earViewKey(kind, ph), base = `${view}|${rate}`;
  const prev = earPrev(ph, kind);
  if (kind !== "line") { // (judgeBeats gives them: the take sung to its end, the last whole one here)
    res.up ??= { beats: prev?.counts?.beats != null && res.counts?.beats != null && res.counts.beats > prev.counts.beats, notes: false };
    res.whole ??= !!res.counts;
  }
  res.kind = kind;
  res.view = view;
  res.tr = transpose; // (the key it was sung in: another key's result isn't shown — earShown)
  res.rate = rate;    // (the speed: ▶ Piano's stretch at the attempt's tempo)
  // a whole attempt Ear could count: the line's "last time" (its notes as offsets in the line: a repeat of it shares
  // the record), kept for the song (ear.js EAR_STORE) — ♩ / ♪ secured from them
  const e = E.attemptOf(res, ph, { kind, rate, tr: transpose });
  if (e) {
    EAR.last[base] = e;
    const was = earRecOf(ph)?.sec || {};
    earWriteRec(ph, (r) => E.secure(E.addAttempt(r, e), e.at));
    const now = earRecOf(ph)?.sec || {};
    if ((now.b && !was.b) || (now.n && !was.n)) EAR.secNew = ph.wk;
  }
  if (kind === "line" && Array.isArray(res.drill)) EAR.drillFrom[earLineKey(ph)] = res;
  EAR.latest[view] = res;
  EAR.res = res;
}

// Notes (the fix plan's WP4; D10). Per line (song|line): { targets: [offsets in the line, in the order they're held —
// ear.js noteTargets: the last Line attempt's off / not-sung notes, then the lowest and highest], off: Set (the
// targets from that attempt: "Off last time"), lo / hi (the line's lowest / highest pitch), cur (the offset ● Match
// holds), done: Set (offsets held), tries (misses at cur), v (the last hold's verdict there: holdVerdict), fact
// ("Key A♭ → F"), complete (every target held: ● Sing goes on to the line), from (the Line result they came from) }.
// A newer Line attempt at the line (one Ear could follow) makes them again, the done marks kept for pitches still
// targeted.
function earNotesOf(ph) {
  // (the latest Line attempt Ear could follow: a silent one, or one it couldn't follow, says nothing about the notes)
  const key = earLineKey(ph), last = EAR.drillFrom[key] || null;
  const old = EAR.notesBy[key];
  if (old && old.from === last) return old;
  const m = (k) => earMidi(ph.j0 + k);
  const T = E.noteTargets(ph, notes, last, earMidi);
  // (held before and not off in this attempt: still held — a note held in Notes, then off again in the line, is
  // "Off last time" again, not done)
  const offM = new Set(T.off.map(m)), heldM = new Set(old ? [...old.done].map(m).filter((x) => !offM.has(x)) : []);
  const N = (EAR.notesBy[key] = { targets: T.targets, off: new Set(T.off), lo: T.lo, hi: T.hi, done: new Set(T.targets.filter((k) => heldM.has(m(k)))), cur: null, tries: 0, v: null, fact: "", complete: false, from: last });
  N.cur = T.targets.find((k) => !N.done.has(k)) ?? T.targets[0];
  N.complete = !!old && T.targets.every((k) => N.done.has(k));
  return N;
}
// The note ● Match holds (j in the song), or null.
function earTarget(ph = earPh()) {
  if (!ph) return null;
  const k = earNotesOf(ph).cur;
  return k == null || ph.j0 + k >= ph.j1 ? null : ph.j0 + k;
}
// A note made the current one (a tap on its name, "Practise that note ›"): a target from now on.
function earPick(ph, k) {
  const N = earNotesOf(ph);
  const t = N.targets.find((x) => earMidi(ph.j0 + x) === earMidi(ph.j0 + k)) ?? (N.targets.push(k), k);
  if (N.cur !== t) { N.tries = 0; N.v = null; }
  N.cur = t;
  N.fact = "";
  N.complete = false;
  return t;
}
// Next note ›: the next target not held yet (after the current one, round), or null.
function earNextTarget(N) {
  const i = N.targets.indexOf(N.cur);
  for (let d = 1; d < N.targets.length; d++) { const k = N.targets[(i + d) % N.targets.length]; if (!N.done.has(k)) return k; }
  return null;
}
// "Practise that note ›" (a Line cue on a note's pitch, or a note not sung): Notes, that note current — nothing sounds.
function earPractise(j) {
  const ph = earPh();
  if (!ph || j == null || j < ph.j0 || j >= ph.j1) return;
  if (EAR.run?.kind === "play") earStop(); // (a ▶ of the line's still sounding: it doesn't go on into Notes)
  EAR.mode = "notes";
  EAR.res = null;
  EAR.flash = "";
  EAR.tip = false;
  earPick(ph, j - ph.j0);
  renderEar(); updateButtons();
}
// Lower / Raise the song (the fix plan's WP6.4 — Notes' "Too high for now?" here): the Key menu to the whole-song
// shift + s (±12 at most), as a choice there would; only while it holds a whole-song shift (not a fit: split).
// → "Key A♭ → F", or null.
const earCanShift = (s) => typeof transpose === "number" && !!s && Math.abs(transpose + s) <= 12 && [...keySelect.options].some((o) => o.value === String(transpose + s));
function earKeyShift(s) {
  if (!earCanShift(s) || session || gblock || earTake()) return null;
  const from = keyOf(transpose), to = keyOf(transpose + s);
  earStop();
  keySelect.value = String(transpose + s);
  keySelect.dispatchEvent(new Event("change"));
  return `Key ${from} → ${to}`;
}
// ● Match (and ▶ Try again): the note (mic closed), then hold it — ear.js holdStep, frame by frame; the mic gated at
// MIN_RMS until the note's own sound is gone (D10; our ▶'s tail would read as the note held). Every target held:
// ● Sing — on to the whole line, the mic opening in this tap.
async function earNote() {
  const k0 = EAR.run?.kind;
  if (k0 === "hold" || k0 === "notePlay") { earStop(); return; }
  const ph = earPh();
  if (!ph) return;
  const N = earNotesOf(ph);
  if (N.complete) {
    EAR.mode = "line";
    EAR.res = null;
    EAR.flash = "";
    return earFree();
  }
  const j = earTarget(ph);
  if (j == null) return;
  const micAc = ownContext(new (window.AudioContext || window.webkitAudioContext)()); // (made in the tap: it runs later without one)
  micAc.resume().catch(() => {});
  N.v = null;
  N.fact = "";
  EAR.flash = "";
  // ▶ the note, mic closed
  if (!(await earPlay({ midi: earRefMidi(j), dur: 1.2, kind: "notePlay" }))) { micAc.close().catch(() => {}); return; }
  // then the mic: hold it
  const run = (EAR.run = { kind: "hold", level: 0, left: 1, stop: null, j });
  renderEar(); updateButtons();
  let mic;
  try { mic = await openMic({ ac: micAc }); } catch (err) { showMsg(`Couldn't open the microphone: ${err.message || err.name}`, "error"); micAc.close().catch(() => {}); earEnd(run); return; }
  micWasOpen = true;
  if (EAR.run !== run) { mic.close(); micAc.close().catch(() => {}); return; }
  const target = earMidi(j), gate0 = mic.read.gate, settle = earSettle();
  const h = (run.h = E.holdStart());
  let last = null, raf = 0;
  const close = () => { cancelAnimationFrame(raf); mic.close(); micAc.close().catch(() => {}); setSession("auto"); };
  run.stop = close;
  const end = () => {
    close();
    earCount("hold");
    const top = earMidi(ph.j0 + N.hi) === target, bottom = earMidi(ph.j0 + N.lo) === target;
    const v = (N.v = E.holdVerdict(h, { tries: N.tries + 1, top, bottom, refOct: EAR.oct, name: (oct) => earNoteName(j, oct) }));
    if (v.kind !== "match") { N.tries++; earEnd(run); earReveal(); return; }
    // matched: held; an octave apart, the song's octave follows the singer's; the note again (0.5 s), so the
    // ear checks itself — in that octave
    N.done.add(N.cur);
    N.tries = 0;
    if (v.oct !== EAR.oct) { EAR.oct = Math.max(-24, Math.min(24, v.oct)); EAR.octWas = EAR.oct || EAR.octWas; earSaveLine(); }
    const nx = earNextTarget(N); // (on from here: one skipped with Next note › comes round again)
    if (nx == null) N.complete = true;
    else N.cur = nx;
    earEnd(run);
    earReveal();
    earPlay({ midi: earRefMidi(j), dur: 0.5, tag: "again" });
  };
  const tick = () => {
    if (EAR.run !== run) return;
    const now = performance.now();
    mic.read.gate = now < settle ? Math.max(gate0, MIN_RMS) : gate0;
    const r = mic.read();
    E.holdStep(h, last == null ? 0 : (now - last) / 1000, r.midi == null ? null : r.midi - target);
    last = now;
    run.level = Math.min(1, Math.max(0, (r.db + 60) / 50));
    run.left = Math.max(0, 1 - h.t / E.EAR_HOLD.window);
    renderEarLevel();
    if (h.end) return end();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
// The message under Notes' row: { text, tone: "win" | "cue" | "fact" | "", pre (a line before it) }.
function earNotesMsg(N, k = EAR.run?.kind) {
  if (k === "notePlay" || (k === "play" && EAR.run.tag === "ref")) return { text: "Listen…", tone: "" };
  if (k === "play" && EAR.run.tag === "along") return { text: "Sing along with it", tone: "" };
  if (k === "hold") return { text: "Now sing it — keep it going", tone: "" };
  if (N.complete) return { text: "✓ Those notes — now the whole line", tone: "win", pre: N.v?.said ? N.v.text : null };
  if (N.v) return { text: N.v.text, tone: N.v.kind === "match" ? "win" : "cue" };
  if (N.fact) return { text: N.fact, tone: "fact" };
  if (N.off.has(N.cur)) return { text: "Off last time", tone: "fact" };
  return { text: "", tone: "" };
}
// A note's syllable as printed under it ("A-", "-ma-", "-zing", "grace"): the one it's sung on.
function earSyl(j) {
  const w = E.wordOf(j, notes);
  if (!w) return "";
  const sy = notes[w.j0]?.syllabic || "single", t = w.syl || w.word;
  return `${/^(middle|end)$/.test(sy) ? "-" : ""}${t}${/^(begin|middle)$/.test(sy) ? "-" : ""}`;
}
// Notes on screen: the line's pitches low → high (the key's spelling, in the singer's octave; under each the syllable
// first sung on it — a target's own), the targets marked (a dot; amber: off last time), the current one lit; the
// message; after a miss ▶ Try again (from the 3rd also ▶ Sing along, Next note ›, and on the top / bottom note sung
// low / high "Too high for now?" [Lower the song]).
function renderEarNotes(box, ph, busy) {
  const N = earNotesOf(ph);
  box.textContent = "";
  const row = document.createElement("div");
  row.className = "ear-names";
  const by = new Map();
  for (const j of earJs(ph)) if (!by.has(earMidi(j))) by.set(earMidi(j), j);
  for (const t of N.targets) by.set(earMidi(ph.j0 + t), ph.j0 + t);
  for (const [, j] of [...by].sort((a, b) => a[0] - b[0])) {
    const kk = j - ph.j0, isT = N.targets.includes(kk);
    const b = earButton("", "target");
    b.dataset.j = String(j);
    b.dataset.state = kk === N.cur && !N.complete ? "cur" : isT && N.done.has(kk) ? "done" : isT ? "todo" : "";
    b.toggleAttribute("data-off", isT && N.off.has(kk) && !N.done.has(kk));
    const syl = earSyl(j), w = E.wordOf(j, notes);
    b.append(Object.assign(document.createElement("b"), { textContent: earNoteName(j) }));
    if (syl) b.append(Object.assign(document.createElement("small"), { textContent: syl }));
    b.append(Object.assign(document.createElement("i"), { className: "ear-dot" }));
    b.setAttribute("aria-label", `${earNoteName(j)}${w ? `, “${w.word}”` : ""}${b.dataset.off != null ? ", off last time" : isT && N.done.has(kk) ? ", held" : ""}`);
    if (kk === N.cur && !N.complete) b.setAttribute("aria-current", "true");
    b.disabled = busy;
    row.append(b);
  }
  box.append(row);
  const m = earNotesMsg(N);
  for (const [text, tone] of m.pre ? [[m.pre, "win"], [m.text, m.tone]] : [[m.text, m.tone]]) {
    const msg = Object.assign(document.createElement("div"), { className: "ear-msg", textContent: text });
    msg.dataset.tone = tone;
    box.append(msg);
  }
  const v = N.v;
  if (busy || !v || v.kind === "match" || N.complete) return;
  const chips = document.createElement("div");
  chips.className = "ear-chips";
  chips.append(earButton("▶ Try again", "try", "chip"));
  if (v.along) {
    chips.append(earButton("▶ Sing along", "along", "chip"));
    if (earNextTarget(N) != null) chips.append(earButton("Next note ›", "nextnote", "chip"));
  }
  box.append(chips);
  const s = v.key && (v.key.dir === "lower" ? -v.key.s : v.key.s);
  if (s && earCanShift(s)) {
    const kr = document.createElement("div");
    kr.className = "ear-keyoffer";
    const kb = earButton(v.key.dir === "lower" ? "Lower the song" : "Raise the song", "keyshift", "chip");
    kb.dataset.s = String(s);
    kr.append(Object.assign(document.createElement("span"), { textContent: v.key.text }), kb);
    box.append(kr);
  }
}

// ▶ you: the attempt around a moment (song seconds of the fit / the take), from its recording. click (Beats): the
// click on the beat with it, where it was (the take's recording is on the song's clock as heard).
async function earYou(res, at, { click = false } = {}) {
  if (!res?.voice) return;
  window.resonateSing?.beforeSound?.();
  earStop();
  const ac = await getPlayCtx("tap");
  if (!ac || EAR.run) return;
  const run = (EAR.run = { kind: "play", nodes: [], stop() {
    for (const n of this.nodes) try { n.stop?.(); } catch {}
    if (this.sound && EAR.sound === this.sound) this.sound.end = Math.min(this.sound.end, this.sound.ac.currentTime + 0.02);
  } });
  renderEar(); updateButtons();
  const [a, b] = at || [res.voice.start, res.voice.start + Math.min(30, res.voice.data.length / res.voice.sampleRate)];
  const when = ac.currentTime + 0.1;
  playVoice(ac, res.voice, when, a, run.nodes);
  // (Beats: the clicks the take was sung to in that stretch, where they were — the count-in's too)
  if (click) run.clicks = (res.clicks || []).filter((g) => g.t >= a - 1e-6 && g.t <= b + 1e-6).map((g) => (playClick(ac, when + g.t - a, g.accent, run.nodes), g.t));
  run.sound = EAR.sound = { ac, end: when + (b - a) + 0.3 }; // (your own voice is a ▶ too: the next attempt's mic gates it out)
  await earSleep((b - a + 0.3) * 1000);
  if (EAR.run === run) { run.stop(); earEnd(run); }
}

// --- Ear on screen --------------------------------------------------------------------------
function renderEarLevel() {
  const ring = earEl.querySelector(".ear-ring");
  if (!ring) return;
  ring.style.setProperty("--lv", String(EAR.run ? EAR.run.level ?? 0 : earBeatsTake() ? EAR.level : 0));
  const hold = EAR.run?.kind === "hold";
  if (ring.hasAttribute("data-arc") !== hold) ring.toggleAttribute("data-arc", hold);
  if (hold) { const c = ring.querySelector(".ear-arc circle"); if (c) c.style.strokeDashoffset = String((100 * (1 - (EAR.run.left ?? 1))).toFixed(2)); }
  // (a free attempt: "Sing" inside the ring once the mic is ready; the first two times "Tap ■ Done at the end" under it)
  const free = EAR.run?.kind === "free";
  const t = free && EAR.run.ready ? "Sing" : "", h = free && (earHints.line || 0) < 2 ? "Tap ■ Done at the end" : "";
  const te = ring.querySelector(".ear-ring-t"), he = earEl.querySelector(".ear-ring-hint");
  if (te && te.textContent !== t) te.textContent = t;
  if (he && he.textContent !== h) he.textContent = h;
}
// Beats' count-in row: built once per row, lit in place (earCountTick).
const countEl = $("ear-count");
function paintCount() {
  const c = EAR.count;
  if (!c) return;
  if (countEl.dataset.id !== c.id) {
    countEl.dataset.id = c.id;
    countEl.textContent = "";
    let bar = null;
    const group = () => { bar = document.createElement("span"); bar.className = "ec-bar"; countEl.append(bar); };
    c.clicks.forEach((k, i) => {
      if (!bar || (k.big && i > 0)) group();
      const d = document.createElement("i");
      d.className = "ec-dot";
      if (k.big) d.dataset.big = "";
      bar.append(d);
    });
    if (!bar || c.bar) group();
    bar.append(Object.assign(document.createElement("span"), { className: "ec-word", textContent: c.word }));
  }
  countEl.querySelectorAll(".ec-dot").forEach((d, i) => { d.toggleAttribute("data-on", i <= c.lit); d.toggleAttribute("data-now", i === c.lit && !c.word0); });
  countEl.querySelector(".ec-word")?.toggleAttribute("data-on", c.word0);
}
function earButton(text, act, cls = "") {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  b.dataset.act = act;
  if (cls) b.className = cls;
  return b;
}
const earDiv = (cls, text = "") => Object.assign(document.createElement("div"), { className: cls, textContent: text });
// ♩ and ♪ for the counts, drawn alike at 1em (the ♩ glyph came from a font with a wide gap after it).
const EAR_ICONS = {
  beat: '<ellipse cx="4.2" cy="13" rx="3.7" ry="2.6" transform="rotate(-22 4.2 13)"/><rect x="6.9" y="1" width="1.4" height="12"/>',
  note: '<ellipse cx="4.2" cy="13" rx="3.7" ry="2.6" transform="rotate(-22 4.2 13)"/><rect x="6.9" y="1" width="1.4" height="12"/><path d="M8.3 1c0 3 3.5 3.6 3.5 7.4 0 1.2-.4 2.2-.9 3 .3-.8.4-1.5.4-2.2 0-2.7-2.1-3.6-3-4.2z"/>',
};
function earIcon(kind) {
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 12 16");
  svg.setAttribute("class", "ear-ic");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = EAR_ICONS[kind];
  return svg;
}
// A line of words from ear.js (earText's parts): strings, the syllable a note is sung on underlined.
function earParts(el, parts) {
  for (const x of parts) el.append(typeof x === "string" ? x : Object.assign(document.createElement("u"), { textContent: x.u }));
  return el;
}
// "Key A♭ → F" while the key is still the one it moved to (the menu moved it again: gone).
function earFact() { return EAR.fact && EAR.factTr === transpose ? EAR.fact : ""; }
// What a result says (ear.js earText), for this result on this screen.
// The next printed line after the one open (Next line ›: from the singer's own line too, the printed line after
// where it starts), or -1.
function earNextPrinted() {
  const ph = earPh();
  return ph ? EAR.list.findIndex((p) => !p.own && p.j0 > ph.j0) : -1;
}
const earTextOf = (res, old = false) => E.earText(res, {
  notes, name: noteName, old, bpm: res.bpm ?? null, lastLine: earNextPrinted() < 0,
  voice: !!res.voice && (res.kind !== "beats" || !!res.youAt), shift: (s) => earCanShift(s) && !session && !gblock,
});
// Normal · Slow · Slower: which one the ♩ menu holds (100 / 80 / 70 % of the song's own tempo), or null.
function earSpeedNow() {
  const e = timingEntry(), f = !useMap && e?.bpm ? ownSpeed() : rate;
  return EAR_SPEEDS.find(([x]) => Math.abs(x - f) < 1e-9)?.[0] ?? null;
}
// The column's room (the fix plan's iPad rules, "centred vertically in the region"): the big sizes (#ear[data-big]:
// words 2.4rem, every button ≥ 48 px, the stage 17rem) on a window ≥ 700 px wide whose region leaves Ear ≥ 560 px of
// height — the Score stacked under Sing on an iPad leaves ~340: a phone's sizes there, or nothing after ■ Done shows.
// (Ear's region has a height of its own — the shell's region, sing.html's main: what's in Ear doesn't change it.)
function earRoom() {
  const p = earEl.parentElement;
  if (!p || earEl.hidden) return;
  const cs = getComputedStyle(p), gap = parseFloat(cs.rowGap) || 0;
  let h = p.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
  for (const c of p.children) if (c !== earEl && c.getClientRects().length) h -= c.getBoundingClientRect().height + gap;
  const big = innerWidth >= 700 && h >= 560;
  if (earEl.hasAttribute("data-big") !== big) earEl.toggleAttribute("data-big", big);
}
if (window.ResizeObserver && earEl.parentElement) new ResizeObserver(() => earRoom()).observe(earEl.parentElement);
// A region too short for the whole column: what an attempt (or a hold) says, scrolled into view in Ear when it comes —
// its top kept in view (the words above scroll away; a scroll brings them back).
function earReveal() {
  requestAnimationFrame(() => {
    if (!earActive() || earEl.scrollHeight <= earEl.clientHeight + 1) return;
    const el = earEl.querySelector(EAR.mode === "notes" ? "#ear-notes" : "#ear-res");
    if (!el || el.hidden || !el.firstChild) return;
    const a = earEl.getBoundingClientRect(), r = el.getBoundingClientRect();
    const over = r.bottom - a.bottom;
    if (over > 1) earEl.scrollTop += Math.min(over, Math.max(0, r.top - a.top));
  });
}
// --- The lines: ‹ the dots (or the line's first words ▾) › and the Lines sheet ------------------------------
// The dots (≤ 10 lines — the singer's own a diamond): the line open larger; a line's ♩ or ♪ secured fills it dim
// green, both bright (D6: "all" in 2 of the last 3 — a mark once earned stays); more lines: the open line's first
// words ▾. A tap opens the Lines sheet.
const EAR_DOTS = 10;
const earLineName = (ph) => (ph.words ? `“${P.phraseName(ph, 3)}”` : P.phraseName(ph, 3));
const earSecOf = (ph, data) => { const s = earRecOf(ph, data)?.sec || {}; return `${s.b ? "b" : ""}${s.n ? "n" : ""}`; };
let earNavSig = "";
function renderEarNav(busy) {
  const ps = EAR.list, btn = $("ear-lines"), box = $("ear-name"), data = earData();
  const dots = ps.length <= EAR_DOTS;
  const sig = JSON.stringify([dots ? ps.map((p) => [p.j0, p.j1, !!p.own, earSecOf(p, data)]) : [earLineName(ps[EAR.p] || {}), earSecOf(ps[EAR.p], data)], EAR.p]);
  if (sig !== earNavSig) { // (built again only when it changes: a dot's pulse plays out)
    earNavSig = sig;
    box.textContent = "";
    if (dots) {
      ps.forEach((p, i) => {
        const d = Object.assign(document.createElement("i"), { className: "eld" });
        if (i === EAR.p) d.dataset.cur = "";
        if (p.own) d.dataset.own = "";
        const sec = earSecOf(p, data);
        if (sec) d.dataset.sec = sec;
        box.append(d);
      });
    } else {
      // (many lines: the open one's first words — and its dot when it has a mark)
      const p = ps[EAR.p], sec = earSecOf(p, data);
      if (sec) { const d = Object.assign(document.createElement("i"), { className: "eld" }); d.dataset.sec = sec; box.append(d); }
      box.append(Object.assign(document.createElement("span"), { className: "elw", textContent: `${p.own ? "★ " : ""}${earLineName(p)}` }), Object.assign(document.createElement("span"), { className: "elv", textContent: "▾" }));
    }
  }
  // (a line just secured: its dot pulses — twice, then stays as it is)
  if (EAR.secNew) {
    const d = dots ? box.querySelectorAll(".eld")[ps[EAR.p]?.wk === EAR.secNew ? EAR.p : ps.findIndex((p) => p.wk === EAR.secNew)] : ps[EAR.p]?.wk === EAR.secNew ? box.querySelector(".eld") : null;
    if (d) d.dataset.new = "";
    EAR.secNew = null;
  }
  const p = ps[EAR.p];
  btn.toggleAttribute("data-words", !dots);
  btn.setAttribute("aria-label", `Lines: ${p ? `${p.own ? "your line " : ""}${EAR.p + 1} of ${ps.length}` : ""}`);
  btn.disabled = busy;
}

// The Lines sheet: a row per line (its words, ♩ ♪ green once secured; the singer's own ★ with ✕ — two taps), a tap
// goes there; Pick words… → the song's words as buttons: the first, then the last (whole words, one section, ≥ 2
// words, ≤ ear.js EAR_STORE.ownMax syllables) → a line of the singer's own, kept for the song, open.
const earLinesEl = () => $("earlines");
let earArm = null; // ✕ tapped once: { i, t } (a second tap within 3 s removes it)
function openEarLines() {
  if (!earActive() || EAR.run || gblock) return;
  EAR.pick = null;
  earArm = null;
  renderEarLines();
  earLinesEl().hidden = false;
  requestAnimationFrame(() => earLinesEl().querySelector('.el-row[data-cur] .el-go, .el-row[data-cur]')?.scrollIntoView?.({ block: "nearest" }));
}
function closeEarLines() {
  const el = earLinesEl();
  if (!el || el.hidden) return;
  el.hidden = true;
  EAR.pick = null;
  earArm = null;
}
// The song's words for Pick words: by printed line, each { t (its index), j0, j1, text, li (the line), sec (its section) }.
function earWordRows() {
  const rows = [];
  let t = 0;
  for (const [li, p] of (psong?.phrases || []).entries()) {
    const ws = E.wordTokens(notes, p.j0, p.j1, (j) => notes[j].name || noteName(notes[j].midi)).map((w) => ({ ...w, t: t++, li, sec: p.section }));
    if (ws.length) rows.push(ws);
  }
  return rows;
}
function renderEarLines() {
  const el = earLinesEl();
  if (!el) return;
  const list = el.querySelector("#el-list"), pick = el.querySelector("#el-pick"), foot = el.querySelector(".el-foot");
  list.textContent = "";
  pick.textContent = "";
  const picking = !!EAR.pick;
  list.hidden = picking;
  pick.hidden = !picking;
  el.querySelector("#el-title").textContent = picking ? "Pick words" : "Lines";
  foot.textContent = "";
  if (!picking) {
    const data = earData();
    EAR.list.forEach((p, i) => {
      const row = Object.assign(document.createElement("div"), { className: "el-row" });
      if (i === EAR.p) row.dataset.cur = "";
      const go = earButton(`${p.own ? "★ " : ""}${p.words || P.phraseName(p, 12, "none")}`, "go", "el-go");
      go.dataset.i = String(i);
      if (i === EAR.p) go.setAttribute("aria-current", "true");
      const s = earRecOf(p, data)?.sec || {};
      const marks = Object.assign(document.createElement("span"), { className: "el-marks" });
      for (const [icon, on, what] of [["beat", s.b, "in time"], ["note", s.n, "in tune"]]) {
        const ic = earIcon(icon);
        if (on) ic.dataset.on = "";
        marks.append(ic);
        if (on) go.setAttribute("aria-label", `${go.getAttribute("aria-label") || go.textContent}, ${what}`);
      }
      row.append(go, marks);
      if (p.own) {
        const x = earButton(earArm?.i === i ? "Remove?" : "✕", "rm", "el-x");
        x.dataset.i = String(i);
        if (earArm?.i === i) x.dataset.arm = "";
        x.setAttribute("aria-label", earArm?.i === i ? "Remove this line?" : "Remove your line");
        row.append(x);
      }
      list.append(row);
    });
    foot.append(earButton("Pick words…", "pick", "chip"));
    return;
  }
  // Pick words: the first tapped lit; the words it can end on as they are, the rest dimmed (a tap there starts over)
  const rows = earWordRows(), all = rows.flat(), a = EAR.pick.a != null ? all[EAR.pick.a] : null;
  pick.append(earDiv("el-hint", a ? "…then the last" : "Tap the first word, then the last"));
  for (const ws of rows) {
    const r = Object.assign(document.createElement("div"), { className: "el-words" });
    if (ws[0].li === psong.phrases.indexOf(earPh()) || (earPh()?.own && ws.some((w) => w.j0 === earPh().j0))) r.dataset.cur = "";
    for (const w of ws) {
      const b = earButton(w.text, "word");
      b.dataset.t = String(w.t);
      if (a && w.t === a.t) b.dataset.a = "";
      else if (a && !(w.t > a.t && w.sec === a.sec && E.ownSpan(notes, all, a.t, w.t))) b.dataset.far = "";
      r.append(b);
    }
    pick.append(r);
  }
  foot.append(earButton("Cancel", "pickcancel", "chip"));
}
// A word tapped in Pick words.
function earPickWord(t) {
  const all = earWordRows().flat(), a = EAR.pick?.a != null ? all[EAR.pick.a] : null, w = all[t];
  if (!w) return;
  if (!a || w.t === a.t) { EAR.pick = { a: a && w.t === a.t ? null : w.t }; return renderEarLines(); }
  const span = w.t > a.t && w.sec === a.sec ? E.ownSpan(notes, all, a.t, w.t) : null;
  if (!span) { EAR.pick = { a: w.t }; return renderEarLines(); }
  // a line already there (a printed one, or one picked before): open it; else a new one of the singer's own
  let i = EAR.list.findIndex((p) => p.j0 === span.j0 && p.j1 === span.j1);
  if (i < 0) {
    const ph = earOwnPh(span.j0, span.j1);
    earWrite((d) => {
      const own = (d.own || []).filter((o) => !(o.j0 === span.j0 && o.j1 === span.j1));
      own.push({ j0: span.j0, j1: span.j1, wk: ph.wk });
      return { ...d, own: own.slice(-E.EAR_STORE.own) };
    });
    earBuildList();
    i = EAR.list.findIndex((p) => p.j0 === span.j0 && p.j1 === span.j1);
    if (i < 0) { EAR.list.push(ph); i = EAR.list.length - 1; } // (the store couldn't take it: for this visit)
  }
  closeEarLines();
  if (i === EAR.p) { renderEar(); return; }
  earGoLine(i);
}
// ✕ on a line of the singer's own (the second tap): gone from the list — the line it starts in open if it was this one.
function earRemoveOwn(i) {
  const p = EAR.list[i];
  if (!p?.own) return;
  const cur = earPh();
  earWrite((d) => {
    const own = d.own || [];
    // (the entry that made it: at its place, else — moved since — by its wk)
    let k = own.findIndex((o) => o.j0 === p.j0 && o.j1 === p.j1);
    if (k < 0) k = own.findIndex((o) => o.wk === p.wk);
    return { ...d, own: own.filter((_, x) => x !== k) };
  });
  earBuildList();
  if (cur === p || (cur?.own && cur.j0 === p.j0 && cur.j1 === p.j1)) {
    const k = EAR.list.findIndex((x) => !x.own && x.j0 <= p.j0 && p.j0 < x.j1);
    EAR.p = Math.max(0, k);
    EAR.res = null; EAR.flash = ""; EAR.fact = "";
    earSaveLine();
  } else EAR.p = Math.max(0, EAR.list.findIndex((x) => x.j0 === cur?.j0 && x.j1 === cur?.j1 && !!x.own === !!cur?.own));
  renderEarLines();
  renderEar(); updateButtons();
}
$("ear-lines")?.addEventListener("click", openEarLines);
earLinesEl()?.addEventListener("click", (e) => {
  const el = earLinesEl();
  if (e.target === el) return closeEarLines(); // (the dimmed backdrop)
  const b = e.target.closest("button");
  if (!b || b.disabled) return;
  if (b.id === "el-close") return closeEarLines();
  const act = b.dataset.act;
  if (act === "go") { const i = Number(b.dataset.i); closeEarLines(); return i === EAR.p ? undefined : earGoLine(i); }
  if (act === "rm") {
    const i = Number(b.dataset.i);
    if (earArm?.i === i && Date.now() - earArm.t < 3000) { earArm = null; return earRemoveOwn(i); }
    earArm = { i, t: Date.now() };
    renderEarLines();
    setTimeout(() => { if (earArm?.i === i && Date.now() - earArm.t >= 2900) { earArm = null; if (!earLinesEl().hidden) renderEarLines(); } }, 3000);
    return;
  }
  if (act === "pick") { EAR.pick = { a: null }; renderEarLines(); el.querySelector(".sheet").scrollTop = 0; requestAnimationFrame(() => el.querySelector(".el-words[data-cur]")?.scrollIntoView?.({ block: "nearest" })); return; }
  if (act === "pickcancel") { EAR.pick = null; return renderEarLines(); }
  if (act === "word") return earPickWord(Number(b.dataset.t));
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && earLinesEl() && !earLinesEl().hidden) closeEarLines(); });

function renderEar() {
  const on = earActive();
  earEl.hidden = !on;
  if (document.body.dataset.ear !== String(on)) document.body.dataset.ear = String(on);
  if (!on) return;
  earRoom();
  if (!EAR.list.length) earBuildList();
  const ps = EAR.list;
  if (!(EAR.p >= 0 && EAR.p < ps.length)) EAR.p = 0;
  const ph = earPh();
  const k = EAR.run?.kind, beatsTake = earBeatsTake();
  const busy = !!EAR.run || !!gblock;
  const listening = k === "free" || k === "hold" || beatsTake;
  renderEarNav(busy);
  earEl.querySelector("#ear-prev").disabled = busy || EAR.p === 0;
  earEl.querySelector("#ear-next").disabled = busy || EAR.p >= ps.length - 1;
  earEl.querySelector("#ear-words").textContent = ph.words || P.phraseName(ph, 12, "none");
  for (const b of earEl.querySelectorAll(".ear-modes button")) { b.setAttribute("aria-pressed", String(b.dataset.ear === EAR.mode)); b.disabled = busy; }
  // the first times' hint (its line kept while it has nothing to say: the row under it doesn't move)
  const hint = earHint(), hintEl = earEl.querySelector("#ear-hint");
  if (hint.on) EAR.hintRoom = true;
  hintEl.hidden = !hint.on;
  hintEl.toggleAttribute("data-quiet", !hint.text);
  hintEl.textContent = hint.text || "·";
  const shown = earShown();
  // the action row: ▶ First note — in Beats too (a choir never counts you in without a pitch); it ends an attempt,
  // uncounted, as the dock's ▶ — and the speed, Normal · Slow · Slower (the ♩ menu's: ▶ Hear, ▶ First note, Beats)
  const acts = earEl.querySelector("#ear-acts");
  acts.textContent = "";
  if (EAR.mode !== "notes") {
    const first = earButton("▶ First note", "first");
    first.disabled = k === "think";
    acts.append(first);
    const seg = Object.assign(document.createElement("span"), { className: "ear-speed" });
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "Speed");
    const now = earSpeedNow();
    for (const [f, label] of EAR_SPEEDS) {
      const b = earButton(label, "speed");
      b.dataset.f = String(f);
      b.setAttribute("aria-pressed", String(now === f));
      b.disabled = busy || !score;
      seg.append(b);
    }
    acts.append(seg);
  }
  // (the singer's octave, once a Notes match set it: "Octave down", pressed — a tap plays the written octave again, another back)
  if (EAR.octWas) {
    const o = earButton(EAR.octWas < 0 ? "Octave down" : "Octave up", "oct");
    o.setAttribute("aria-pressed", String(EAR.oct === EAR.octWas));
    o.disabled = busy;
    acts.append(o);
  }
  // Notes: the line's pitches (the targets marked, the current one lit), the message, after a miss its chips
  const nn = earEl.querySelector("#ear-notes");
  nn.hidden = EAR.mode !== "notes";
  if (EAR.mode === "notes") renderEarNotes(nn, ph, busy);
  // Beats: the count-in row (● Sing until its first word has been sung; ▶ Hear while it plays), then the level
  // ring while the mic listens
  const counting = EAR.mode === "beats" && !!EAR.count && !EAR.count.gone;
  countEl.hidden = !counting;
  if (counting) paintCount();
  const ringBox = earEl.querySelector("#ear-ring");
  ringBox.hidden = !listening || counting;
  if (listening && !ringBox.firstChild) {
    // (the level ring — "Sing" inside it once the mic is ready —; a hold's time left as a thin arc on it: time, not
    // pitch — Q-E)
    const ring = Object.assign(document.createElement("div"), { className: "ear-ring" });
    ring.innerHTML = '<svg class="ear-arc" viewBox="0 0 70 70" aria-hidden="true"><circle cx="35" cy="35" r="33.5" pathLength="100"></circle></svg><span class="ear-ring-t"></span>';
    ringBox.append(ring, earDiv("ear-ring-hint"));
  }
  renderEarLevel();
  const tip = earEl.querySelector("#ear-tip");
  tip.hidden = !(EAR.tip && EAR.mode === "beats");
  // the result (ear.js earText): the win, the counts, the cue with its ▶s, the next exercise — the latest for this line
  // and mode, dimmed once you've been away ("Last time": the win, the counts, the cue); "Checking…", "Stopped — not
  // counted" or a fact ("Key A♭ → F") in its place
  const out = earEl.querySelector("#ear-res");
  out.hidden = EAR.mode === "notes"; // (Notes says its own: under its row)
  out.textContent = "";
  out.toggleAttribute("data-old", false);
  if (k === "think") out.append(earDiv("ear-flash", "Checking…"));
  else if (!listening && EAR.mode !== "notes" && (EAR.flash || (earFact() && !(shown && !shown.old)))) out.append(earDiv("ear-flash", EAR.flash || earFact()));
  else if (!listening && shown) {
    const res = shown.res, T = earTextOf(res, shown.old);
    if (shown.old) { out.toggleAttribute("data-old", true); out.append(earDiv("ear-last", "Last time")); }
    if (T.win) out.append(earParts(earDiv("ear-win"), T.win));
    if (T.counts.length) {
      const c = earDiv("ear-counts");
      T.counts.forEach((x, i) => {
        if (i) c.append(Object.assign(document.createElement("span"), { className: "ear-sep", textContent: "·" }));
        const n = Object.assign(document.createElement("span"), { className: "ear-count" });
        n.dataset.icon = x.icon;
        if (x.up) n.dataset.up = "";
        n.append(earIcon(x.icon), x.text);
        c.append(n);
      });
      out.append(c);
    }
    if (T.tempo) {
      const t = earDiv("ear-tempo");
      t.append("You sang it at", earIcon("beat"), `=${T.tempo.bpm}`);
      t.setAttribute("aria-label", `You sang it at ${T.tempo.bpm} beats a minute`);
      out.append(t);
    }
    if (T.cue) out.append(earParts(earDiv("ear-cue"), T.cue));
    if (!shown.old) {
      if (T.sounds.length) {
        const row = earDiv("ear-chips");
        for (const x of T.sounds) { const b = earButton(x.label, x.act, "chip"); if (x.s != null) b.dataset.s = String(x.s); row.append(b); }
        out.append(row);
      }
      if (T.next) { const nx = earDiv("ear-next"); nx.append(earButton(T.next.label, T.next.act, "chip")); out.append(nx); }
    }
  }
  earButtons(); // (the dock follows: Ear can come on without a button change — a song loaded, ⚙)
}
// Another line (‹ ›, Next line ›) or mode (the tabs, a result's next chip): the attempt just made stays that view's
// latest ("Last time" when you come back); nothing starts.
function earGoLine(p) {
  if (!psong || p < 0 || p >= EAR.list.length || p === EAR.p) return;
  if (EAR.run?.kind === "play") earStop(); // (this line's ▶ doesn't go on under the next)
  EAR.p = p;
  EAR.res = null;
  EAR.flash = "";
  EAR.fact = "";
  EAR.tip = false;
  earSaveLine();
  cursorToLine(lineOf[earPh().j0]);
  renderEar(); updateButtons();
}
function earGoMode(m) {
  if (m === EAR.mode) return;
  if (EAR.run?.kind === "play") earStop(); // (a ▶ of the line's still sounding: it doesn't go on into the other mode)
  EAR.mode = m;
  EAR.res = null;
  EAR.flash = "";
  EAR.tip = false;
  renderEar(); updateButtons();
}
// Normal · Slow · Slower: the ♩ menu set to 100 / 80 / 70 % of the song's own tempo (r: of the score's; m: of a
// tapped timing in use; a song with its own tempo, that share of it — ownSpeed), as a choice there would.
function earSpeed(f) {
  if (!score || session || gblock || EAR.run || earSpeedNow() === f) return;
  const e = timingEntry();
  if (useMap && tmap) setTiming(f, true);
  else if (e?.bpm) { if (!setOwnSpeed(f)) return; stopSession(); applySong(); }
  else setTiming(f, false);
  EAR.flash = "";
  renderEar(); updateButtons();
}
earEl.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.disabled) return;
  const act = b.dataset.act, ph = earPh(), res = earShown()?.res;
  if (b.id === "ear-prev" || b.id === "ear-next") return earGoLine(EAR.p + (b.id === "ear-prev" ? -1 : 1));
  if (b.dataset.ear) return earGoMode(b.dataset.ear);
  if (act === "first") return earPlay({ first: true });
  if (act === "speed") return earSpeed(Number(b.dataset.f));
  if (act === "you" && res?.kind === "beats" && res.youAt) return earYou(res, res.youAt, { click: true }); // (the take over its line, the click with it)
  if (act === "you") return earYou(res, null);
  if (act === "cue-hear") return res?.kind === "beats" ? earPlay({ click: true }) : earPlay();
  if (act === "cue-click" && res?.cue?.range) return earPlay({ click: true, range: res.cue.range });
  if (act === "cue-you" && res?.cue?.at && res.kind === "beats") return earYou(res, res.cue.at, { click: true });
  if (act === "cue-note" && res?.cue?.j != null && notes[res.cue.j]) { const n = notes[res.cue.j]; return earPlay({ midi: earRefMidi(res.cue.j), dur: Math.max(0.6, Math.min(1.5, n.d)) }); }
  // (▶ Piano on a timing cue: the stretch, from two starts before through the note, at the attempt's own tempo)
  // (the fit's b is the singer's seconds per second heard at the attempt's speed, res.rate; the notes now are at `rate`:
  // a second of theirs is rate / res.rate of then — Slow tapped since plays the singer's tempo all the same)
  if (act === "cue-stretch" && res?.cue?.range) return earPlay({ range: res.cue.range, scale: (res.fit?.b ?? 1) * (rate / (res.rate ?? rate)) });
  // (▶ The rest: the piano from the first note not sung to the line's end)
  if (act === "cue-rest" && ph && res?.cue?.from != null && res.cue.from >= ph.j0 && res.cue.from < ph.j1) return earPlay({ range: [res.cue.from, ph.j1 - 1] });
  if (act === "cue-you" && res?.cue?.at) return earYou(res, res.cue.at);
  if (act === "cue-key") {
    // (Lower / Raise the song by the semitones it was sung in: "Key A♭ → F", the result gone with the old key, ▶ Hear it first again)
    const fact = earKeyShift(Number(b.dataset.s));
    if (fact) { EAR.res = null; EAR.flash = ""; EAR.fact = fact; EAR.factTr = transpose; }
    renderEar(); updateButtons();
    return;
  }
  if (act === "practise" && res?.cue?.j != null) return earPractise(res.cue.j);
  if (act === "beats" || act === "line") return earGoMode(act);
  if (act === "nextline") return earGoLine(earNextPrinted());
  if (act === "oct") { EAR.oct = EAR.oct ? 0 : EAR.octWas; earSaveLine(); renderEar(); updateButtons(); return; }
  if (!ph || EAR.mode !== "notes") return;
  // Notes: a name — hear it (mic closed), the current note from now; ▶ Try again — ● Match again; ▶ Sing along — the
  // note 4 s to sing with (nothing judged); Next note ›; Lower / Raise the song
  const N = earNotesOf(ph);
  if (act === "target") { const j = Number(b.dataset.j); earPick(ph, j - ph.j0); return earPlay({ midi: earRefMidi(j), dur: 1.2, tag: "ref" }); }
  if (act === "try") return earNote();
  if (act === "along") { const j = earTarget(ph); return j == null ? undefined : earPlay({ midi: earRefMidi(j), dur: 4, tag: "along" }); }
  if (act === "nextnote") { const nx = earNextTarget(N); if (nx != null) { N.cur = nx; N.tries = 0; N.v = null; N.fact = ""; } renderEar(); updateButtons(); return; }
  if (act === "keyshift") {
    const fact = earKeyShift(Number(b.dataset.s));
    if (fact) { const M = earPh() && earNotesOf(earPh()); if (M) { M.fact = fact; M.v = null; M.tries = 0; } }
    renderEar(); updateButtons();
  }
});
// The dock: the mode's two actions (the round ▶ on the left, the main one on the right).
function earMain() {
  const k = EAR.run?.kind;
  if (EAR.mode === "line") return k === "free" ? earDone() : k === "think" ? null : earFree();
  if (EAR.mode === "beats") return gblock ? stopGuided() : Date.now() < guideQuiet ? undefined : earBeats(); // (a double tap on ■ Stop doesn't sing again)
  return earNote();
}
function earListen() {
  const k = EAR.run?.kind;
  if (k === "play" || k === "notePlay" || k === "hold") return earStop(); // (■ Stop)
  if (k === "think") return;
  if (EAR.mode === "beats") return earPlay({ click: true });
  if (EAR.mode === "notes") {
    const ph = earPh(), N = ph && earNotesOf(ph);
    if (N?.complete) return earPlay(); // (every target held: the line, which ● Sing sings next)
    const j = earTarget();
    return j == null ? undefined : earPlay({ midi: earRefMidi(j), dur: 1.2, tag: "ref" });
  }
  return earPlay();
}
// Short labels (≤ 8 characters: a phone's dock), the round button's caption beside it (the shell shows it).
function earButtons() {
  const k = EAR.run?.kind, beatsTake = earBeatsTake();
  if (EAR.mode === "line") singBtn.textContent = k === "free" ? (EAR.run.ready ? "■ Done" : "Mic…") : k === "think" ? "…" : "● Sing";
  else if (EAR.mode === "beats") singBtn.textContent = beatsTake ? "■ Stop" : "● Sing";
  else { const ph = earPh(); singBtn.textContent = k === "hold" || k === "notePlay" ? "■ Stop" : ph && earNotesOf(ph).complete ? "● Sing" : "● Match"; }
  const stop = k === "play" || k === "notePlay" || k === "hold";
  listenBtn.textContent = stop ? "■ Stop" : "▶ Hear";
  if (listenBtn.dataset.caption !== (stop ? "Stop" : "Hear")) listenBtn.dataset.caption = stop ? "Stop" : "Hear";
  listenBtn.toggleAttribute("data-pulse", earHearFirst());
  singBtn.dataset.active = k === "free" || k === "hold" || beatsTake ? "true" : "false";
  singBtn.disabled = !score || k === "think" || (k === "free" && !EAR.run.ready);
  listenBtn.disabled = !score || k === "think" || (EAR.mode === "notes" && !stop && earTarget() == null);
}
// resonateDebug().ear: what Ear shows and runs (the probes and tools/ear.cjs read it).
function earDebug() {
  const ph = earPh(), sh = earActive() ? earShown() : null, N = ph && earActive() && EAR.mode === "notes" ? earNotesOf(ph) : ph ? EAR.notesBy[earLineKey(ph)] : null;
  return {
    on: earActive(), mode: EAR.mode, p: EAR.p, run: EAR.run?.kind || null, ph: ph && { j0: ph.j0, j1: ph.j1, wk: ph.wk, words: ph.words },
    gate: EAR.run?.kind === "free" && Number.isFinite(EAR.run.gateUntil) ? EAR.run.gateUntil : null, // (s: our own ▶'s tail kept out of this attempt until then)
    res: E.debugRes(EAR.res), shown: sh && { old: sh.old, kind: sh.res.kind, res: E.debugRes(sh.res) }, flash: EAR.flash || null, pulse: listenBtn.hasAttribute("data-pulse"),
    // (Notes: targets as offsets in the line, in the order they're held; js — the same notes' indices in the song; i —
    // the current one's place in targets; done, off — offsets; msg — the message shown; v — the last hold's verdict)
    notes: N && { targets: N.targets, js: ph ? N.targets.map((k) => ph.j0 + k) : [], i: N.targets.indexOf(N.cur), cur: N.cur, done: [...N.done], off: [...N.off], lo: N.lo, hi: N.hi,
      tries: N.tries, complete: N.complete, msg: earNotesMsg(N).text, v: N.v && { kind: N.v.kind, dir: N.v.dir ?? null, size: N.v.size ?? null, r: N.v.r ?? null, oct: N.v.oct ?? null, said: N.v.said ?? null, along: !!N.v.along, key: N.v.key || null, text: N.v.text },
      hold: EAR.run?.kind === "hold" && EAR.run.h ? { t: +EAR.run.h.t.toFixed(2), good: +EAR.run.h.good.toFixed(2), voiced: +EAR.run.h.voiced.toFixed(2), left: +(EAR.run.left ?? 1).toFixed(3) } : null },
    oct: EAR.oct, octWas: EAR.octWas, playing: EAR.run?.midis || null, tag: EAR.run?.tag || null, // (the singer's octave; what Ear's ▶ plays now — midi)
    // (the lines: printed and the singer's own — own, sec: ♩ "b" / ♪ "n" secured; the Lines sheet open, Pick words' first word)
    lines: EAR.list.map((p) => ({ j0: p.j0, j1: p.j1, words: p.words, ...(p.own ? { own: true } : {}), sec: earSecOf(p) })), hints: { ...earHints },
    linesOpen: !!earLinesEl() && !earLinesEl().hidden, pick: EAR.pick, nav: { dots: $("ear-name")?.querySelectorAll(".eld").length ?? 0, text: $("ear-name")?.textContent || "" },
    hint: earActive() ? earHint().text || null : null, speed: earActive() ? earSpeedNow() : null, fact: earFact() || null,
    // (what the result shown says — ear.js earText: plain words; u: the underlined syllables)
    words: sh ? (({ win, counts, tempo, cue, sounds, next }) => ({ win: win && E.plainOf(win), counts: counts.map((c) => `${c.icon === "beat" ? "♩" : "♪"} ${c.text}${c.up ? " (up)" : ""}`), tempo: tempo?.text || null,
      cue: cue && E.plainOf(cue), u: [...(win || []), ...(cue || [])].filter((x) => typeof x !== "string").map((x) => x.u), sounds: sounds.map((x) => x.label), next: next?.label || null }))(earTextOf(sh.res, sh.old)) : null,
    // (Beats: the count-in row — its clicks (song s), the latest lit, the word lit, shown; the take's level; 🎧)
    count: EAR.count && { clicks: EAR.count.clicks.map((c) => ({ t: +c.t.toFixed(3), big: c.big })), word: EAR.count.word, entry: EAR.count.entry, lit: EAR.count.lit, wordOn: EAR.count.word0, gone: EAR.count.gone, play: !!EAR.count.run, shown: !countEl.hidden },
    level: earBeatsTake() ? EAR.level : EAR.run?.level ?? null, tip: EAR.tip,
    you: EAR.run?.clicks || null, // (▶ You in Beats: the take's clicks it plays, song s)
  };
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
  earStop(); // (Ear's ▶ Hear doesn't play on under the whole song's Listen)
  guidedOn = on;
  store(PK.guided, on ? "on" : "off");
  const box = $("guided-on");
  if (box) box.checked = on;
  pstep = null;
  renderAll();
  renderGuided();
  syncOptions();
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
// The AI button in the header (once an assistant has connected: assist.js remote.available): on,
// an assistant can run these on this page (one device at a time). Lines are numbered from 1 here,
// as people say them.
const remoteBtn = $("remote-btn");
const showRemote = (on) => paintRemote(remoteBtn, on);
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

// Which assistant is connected: shown by the AI button for 2 minutes after its last call (the
// dot pulses for 15 s after one).
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
const songOptions = () => [...songSelect.querySelectorAll("option")].map((o) => ({ id: o.value, title: o.dataset.title || o.textContent.trim(), pdf: o.dataset.k === "pdf" }));
const pdfOnlyAnswer = (id, title) => ({ ok: false, pdf_only: true, id, title, error: `“${title}” is only a PDF so far — convert it first (Songs → ⋯ → Convert).` });
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
      if (hit.pdf) return pdfOnlyAnswer(hit.id, hit.title); // (Sing can't open it: nothing stops)
      if (drill) stopLoop();
      if (session?.kind === "sing") await stopSing(); else if (session) stopSession();
      if (!(await selectSong(hit.id))) {
        const info = await songInfo(hit.id).catch(() => null);
        if (info?.k === "pdf") return pdfOnlyAnswer(hit.id, info.title);
        return { ok: false, error: songMsgEl.dataset.kind === "error" && !songMsgEl.hidden ? songMsgEl.textContent : `Couldn't open “${hit.title}”.`, ...remoteState() };
      }
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
      if (document.hidden) return { ok: false, error: "The page isn't in front on this device — bring it up and ask again." }; // (asleep in the background)
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
      // (the Score's commands: Play's page, or the one-page shell's Score — v88)
      if (String(action).startsWith("score_")) return { ok: false, error: "The Score isn't open on this device — open Play (or the Score in the new Resonate) there.", ...remoteState() };
      return { ok: false, error: `Unknown action “${action}”.` };
  }
}
// (the Score's commands go to a Play page of this device first: `handles`; in the one-page shell
// its own hooks take every command)
remote.start({ run: runRemote, state: remoteState, changed: showRemote, assistant: showAssistant, handles: (a) => !String(a).startsWith("score_") }).catch((err) => console.warn("remote", err));

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

// Singing options: Ear's switch ("Phrase by phrase"); with it off, Practice / Perform and the guide (Ear
// ignores them: they hide while it shows).
function syncOptions() {
  const el = $("op-whole");
  if (el) el.hidden = earActive();
}
function openOptions() {
  $("guided-on").checked = guidedOn;
  syncOptions();
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
    summaryEl.textContent = score
      ? `${score.title.toUpperCase()} · ${meterAt(entryIdx).join("/")} · ${useMap && tmap ? `TAPPED TIMING ♩≈${Math.round(60 / (tmap.avg / rate))}` : `♩=${Math.round(score.tempo * rate)}${score.tempoFromScore ? "" : " (default)"}`}${notes.length ? ` · ${lowest().name}–${highest().name}` : ""}`
      : "";
    return;
  }
  // After a take: the song's facts, plus the octave it was sung in — no counts or score.
  const graded = take.grades.filter((g) => g && g.status !== "unsung");
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
  if (earActive()) earButtons();
  else if (listenBtn.hasAttribute("data-caption") || listenBtn.hasAttribute("data-pulse")) { delete listenBtn.dataset.caption; listenBtn.removeAttribute("data-pulse"); }
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
  const earBusy = earTake() || EAR.run?.kind === "notePlay"; // (an Ear attempt: the song, its key and tempo stay as they were)
  for (const el of [songSelect, verseSelect, keySelect, tempoSelect, optionsBtn, openFileBtn, openLinkBtn, removeBtn, saveBtn]) el.disabled = kind === "sing" || !!drill || !!gblock || earBusy;
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
listenBtn.addEventListener("click", () => (earActive() ? earListen() : session?.kind === "listen" ? stopSession() : startPlay("listen", Math.max(0, scrollT))));
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
  if (kind === "o") { setOwnSpeed(Number(r)); stopSession(); applySong(); return; } // (the song's own tempo, or a share of it)
  setTiming(Number(r), kind === "m");
});

// Choose a speed (× the score's tempo, or × the tapped timing) from the menu; a tempo
// tapped for this song is kept as its own (bpm).
function setTiming(r, map, bpm = null) {
  setOwnSpeed(1);
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
// is the one the count-in clicks (feltBeat): a dotted quarter in 6/8, 9/8, 12/8 (a dotted
// eighth in 6/16, 12/16), else the time signature's unit (an eighth in 3/8).

const tapQ = () => feltBeat(countInMeter(entryIdx)).q; // (the count-in's meter: a pickup bar in the old meter counts the new one, as the clicks)
const unitGlyph = (q) => ({ 0.25: "𝅘𝅥𝅯", 0.5: "♪", 0.75: "♪.", 1: "♩", 1.5: "♩.", 2: "𝅗𝅥" })[q] || "♩";
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
// ✕: the song and everything kept for it go (forget.js — as the shell's Songs list deletes);
// not while a take, a loop or a playback runs or a take is being finished (it'd be saved back).
removeBtn.addEventListener("click", async () => {
  const id = songSelect.value;
  if (SAMPLES[id] || busyNow()) return;
  const o = songSelect.selectedOptions[0];
  const title = o?.dataset.title || o?.textContent || "this song"; // (the index's title, not the menu's text)
  if (!confirm(`Remove “${title}” from My songs?`)) return;
  try { await forgetSong(id); }
  catch (err) { console.error(err); return showMsg(`Couldn't remove it: ${err.message}`, "error"); }
  const opened = selectSong("amazing-grace"); // (songId moves now: the "gone" from forgetSong finds it moved)
  await refreshLibrary();
  await opened;
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

// The page hidden (Safari in the background, the screen locked) or left: the page goes to sleep —
// every sound stops (keys, Listen / Play, a loop, a guided step, an assistant's countdown), the
// mics close (a take stops as Stop does: it's kept), the contexts are suspended and the session
// goes back to "auto" (sleepAudio). Nothing starts again by itself: the next tap resumes the
// playback context (unlockPlay, getPlayCtx).
let sleeps = 0; // bumped each time the page sleeps: a take whose mic opened across one stands down
function sleepPage() {
  sleeps++;
  if (cancelGetReady()) remoteTake = null;
  for (const key of [...keys.values()]) dropKey(key, true, 0.002); // (cut, not damped: the context is suspended next, and a tail would ring on when it resumes)
  stopLoop();
  earStop(); // (Ear's phrase, note or attempt: its sound and mic stop too)
  stopGuided();
  if (mon) {
    monitorOff();
    statusEl.textContent = "pitch off (backgrounded)";
  }
  const was = session;
  stopSession(); // (also when there's none: a Listen still loading stands down)
  if (was) statusEl.textContent = "stopped (backgrounded)";
  sleepAudio();
  for (const t of ["pointerup", "keydown"]) document.addEventListener(t, unlockPlay, true);
}
document.addEventListener("visibilitychange", () => { if (document.hidden) sleepPage(); });
// Leaving the page: give the tab's audio session back. iOS keeps its type across pages,
// and a "playback" left behind kept the Tuner's microphone from starting.
window.addEventListener("pagehide", () => {
  sleepPage();
  if (playCtx) playCtx.close().catch(() => {});
  playCtx = null;
  setSession("auto");
});
// Back from the back/forward cache: the next tap starts the audio again.
window.addEventListener("pageshow", (e) => {
  if (!e.persisted) return;
  for (const t of ["pointerup", "keydown"]) document.addEventListener(t, unlockPlay, true);
  // (Back from PDF → Song's ⟳ Reprocess: the song read again — loaded again; through the queue,
  // so never under a take)
  if (songId && !SAMPLES[songId]) { queueRemote({ replaced: [songId] }); flushRemote(); }
});

// ---------------------------------------------------------------------------
// Init

guideSelect.value = guide;
// The cloud sync brought changes (sync.js): the song list, the open song's settings, its last
// take. Nothing changes under a take, a loop or a playback: what arrives then waits for its end.
let pendingRemote = null; // { songs, profiles, state: Set, takes: Set, replaced: Set } — song ids
function queueRemote({ songs = false, profiles = false, state = [], takes = [], replaced = [] }) {
  const p = (pendingRemote ||= { songs: false, profiles: false, state: new Set(), takes: new Set(), replaced: new Set() });
  p.songs ||= !!songs;
  p.profiles ||= !!profiles;
  for (const id of state) p.state.add(id);
  for (const id of takes) p.takes.add(id);
  for (const id of replaced) p.replaced.add(id);
}
window.addEventListener("resonate:remote", (e) => { queueRemote(e.detail || {}); flushRemote(); });
// (After another tab signed in or out, the reload also waits for an open review to close.)
const busyNow = () => !!(session || drill || gblock || starting || finishing || EAR.run || (spaceChanged() && !reviewEl.hidden));
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
      // (a stand-in, not a choice: the saved song may be another one open now — the shell's Score
      // on a song Sing doesn't hold —, and one that named the deleted song is already cleared)
      if (gone && !busyNow()) return selectSong("amazing-grace", { remember: false });
    }
    const sid = songId;
    if (!score || scoreId !== sid || busyNow()) return queueRemote({ ...p, songs: gone }); // (setScore flushes; a song gone meanwhile is closed later)
    // The open song's MusicXML replaced (another device read its PDF again): loaded again — its
    // settings, take and the rest come with it.
    if (p.replaced.has(sid) && !SAMPLES[sid]) {
      const rev = await songRev(sid).catch(() => undefined); // (the library's index: no XML read)
      if (sid !== songId || busyNow()) return queueRemote({ ...p, songs: false });
      if (rev !== undefined && rev !== songRevNow) return selectSong(sid);
    }
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
  await refreshLibrary();
  // A PDF only (not converted yet — Play or the shell opened it last): Amazing Grace here, the
  // saved choice kept for them. A song that can't be read: Amazing Grace too.
  const saved = savedSong ? [...mySongsEl.querySelectorAll("option")].find((o) => o.value === savedSong) : null;
  const pdfOnly = saved?.dataset.k === "pdf";
  const known = SAMPLES[savedSong] || (saved && !pdfOnly);
  const ask = songAsk + 1;
  const ok = await selectSong(known ? savedSong : "amazing-grace", { remember: !pdfOnly });
  if (!ok && !score && songAsk === ask) await selectSong("amazing-grace", { remember: false });
})();

// The one-page shell (shell.html) mounts this page's Sing: it opens songs, stops everything
// before it leaves the song, and reads what runs. (On sing.html nothing calls these.)
async function stopAll() {
  if (cancelGetReady()) remoteTake = null;
  for (let i = 0; i < 160 && starting; i++) await sleep(50); // (a take or Listen still starting: it starts, then stops)
  stopKeys();
  stopLoop();
  earStop(); // (Ear's phrase, note or attempt: its sound and mic stop too)
  stopGuided();
  monitorOff();
  if (session?.kind === "sing") await stopSing();
  else stopSession();
  for (let i = 0; i < 400 && finishing; i++) await sleep(50); // (a take being finished is recorded and saved first)
  closeReview();
  closeMore();
  closeEarLines();
  for (const id of ["options", "taptempo", "tapalong"]) $(id).hidden = true;
}
window.resonateSing = Object.assign(window.resonateSing || {}, {
  open: async (id) => { await refreshLibrary(); return selectSong(id); }, // → true / false (not opened: a PDF only, …)
  stopAll,
  // (take: the mic open for a take — Ear's own attempts too: the shell's tuner holds, its modules stay; ear: Ear shows)
  state: () => ({ busy: busyNow() || !!getReady, take: session?.kind === "sing" || starting === "sing" || earTake(), ear: earActive(), song: scoreId, title: score?.title || "" }),
  // (the shell, synchronously before its Piano or the Score sounds: on — the monitor's mic closes now;
  // off once they're quiet — it listens again MON_RESUME later, as after Sing's own keys)
  hush: (on) => {
    on = !!on;
    if (on === hushed) return;
    hushed = on;
    if (mon) monitorSync(on ? 0 : MON_RESUME);
  },
});

// Debug hook for automated tests / devtools.
window.resonateDebug = () => ({ ear: earDebug(), score, notes, lines, take, session: session && { kind: session.kind, line: session.line, mode: session.mode, count: session.count, beatSec: session.beatSec }, nowT, scrollT, practiceJ, reviewRows, rate, laneMode,
  practice: { on: guiding(), doc: pdoc, session: psess, step: pstep, block: gblock && { phase: gblock.phase, step: gblock.step, setup: gblock.setup, round: gblock.round, last: gblock.last && { r: { ...gblock.last.r, notes: undefined }, tv: gblock.last.tv, uv: gblock.last.uv } },
    phrases: psong?.phrases.map((p) => ({ name: p.name, j0: p.j0, j1: p.j1, t0: p.t0, t1: p.t1, mk: p.mk, section: p.section, marks: P.phraseMarks(pdoc, p) })),
    card: { title: coTitle.textContent, win: coWin.textContent, cue: coCue.textContent, buttons: [...coBtns.querySelectorAll("button")].map((b) => b.textContent), hidden: coachEl.hidden }, thenNow: !!thenNow },
  monitor: mon && { listening: !!mon.stream, opening: mon.opening, ctx: mon.micCtx.state }, you: currentYou(), tapTargets: tapAlong?.targets });
