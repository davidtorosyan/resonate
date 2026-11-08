// Sing (karaoke) mode: the score sets the clock. Notes scroll toward a "now"
// line with their lyrics; after a count-in you sing along, and each score
// note is graded on the pitch you held during its own time slot (any octave).

import { parseMusicXml, readScoreFile, notesForVerse, lyricLines } from "./musicxml.js?v=65";
import { noteName as nameOf, BLACK, fold, median, centsLabel, transposeKey, keyName, spellTransposed } from "./music.js?v=65";
import { openMic, createReader, ANALYSIS_LAG, FFT_SIZE, MIN_RMS } from "./pitch.js?v=65";
import { gradeTake, gradeLive, takeScore, timingTendency, MAX_SHIFT, GOOD_CENTS, OK_CENTS } from "./grade.js?v=65";
import { analyzeLines, lineDelta, feedback, rhythmText } from "./coach.js?v=65";
import { knotsFromTaps, mergeKnots, makeTiming, splitPauses, MIN_GAP } from "./timing.js?v=65";
import { startCapture, playVoice } from "./capture.js?v=65";
import { loadPiano, pianoReady, playPiano, holdPiano, playClick, clickWave, CLICK_GAIN, scheduleAhead, keepAlive } from "./piano.js?v=65";
import { makeFeatures, findClicks, findOnsets, rhythmStats, rhythmObservations, tolOn } from "./rhythm.js?v=65";
import { listSongs, getSong, addSong, removeSong, persistent, saveClean } from "./library.js?v=65";
import { fixOmrScore } from "./omr/fixscore.js?v=65";
import { activeProfile } from "./profiles.js?v=65";
import { fitOptions, fitKey, fitToRange } from "./fit.js?v=65";

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
  rate: "resonate.sing.rate",
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

const store = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
const recall = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

let transpose = 0;  // whole-song semitones; "fit:s" = key s split by phrase octaves for the voice
                    // profile (fit.js); "fit" = "fit me" without a profile range yet. Per song (K.keys)
let fit = null;     // how the current choice fits the voice profile (a fit.js option), if there is one
let profile = null; // the active voice profile (profiles.js)
let fitOpts = [];   // fitOptions for it: what the transpose menu offers
let shifts = [];    // semitones per score note (all the same unless fitting)
let shiftSig = "";  // shifts as a string, to tell whether a take's grades still apply
let rate = Number(recall(K.rate)) || 1;
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

const noteName = (m) => nameOf(m, flats);

// ---------------------------------------------------------------------------
// Song loading

function secPerQuarter() {
  return 60 / (score.tempo * rate);
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
// percentage chosen (global, one of the menu's), else as written.
function loadTiming() {
  const e = timingEntry();
  tmap = e?.segs?.length ? makeTiming(e.segs) : null;
  useMap = !!(tmap && e.use);
  const saved = Number(recall(K.rate)) || 1;
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
}

// A take's grades hold only for the notes, timing and verse it was sung to.
const takeFits = (t) => !!t && t.shiftSig === shiftSig && t.timing === timingSig() && t.verse === (verseSelect.value || score.verses[0] || "1");

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

function setScore(sc) {
  score = sc;
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
  take = null;
  practiceJ = -1;
  applySong();
}

// id: a sample key, or a saved song's id (from library.js).
async function selectSong(id) {
  stopLoop();
  stopSession();
  songId = id;
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
    return setScore(parseMusicXml(songXml(song), song.title));
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
async function importXml(xml, name) {
  const sc = parseMusicXml(xml, name);
  const id = await addSong(sc.title, xml);
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
// part (a phrase-loop round): { from (s, a bar start: the count-in is the bar before),
// until (s), range: [first note, end), ac (the loop's mic context) } — no recording,
// review or history; stopSing resolves session.ended with the round's grades.
async function startSing(part = null) {
  starting = "sing";
  monitorSync();
  try { await beginSing(part); } finally { starting = null; monitorSync(MON_RESUME); }
}

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
    if (part) stopLoop(`Couldn't open the microphone: ${err.message || err.name}`);
    return;
  }
  micWasOpen = true;
  if (part && drill?.token !== part.token) { await mic.close(); return; } // the loop stopped meanwhile
  const ac = mic.ac;
  let piano = null;
  if (guide === "melody") {
    statusEl.textContent = "loading piano…";
    try { piano = await loadPiano(ac); } catch (err) { console.warn(err); }
  }
  // The recording: a take's for playback; a loop round keeps just its count-in (to find the
  // clicks). Both stream into the rhythm features as they arrive.
  const features = makeFeatures(ac.sampleRate);
  const capture = await startCapture(ac, mic.source, { keepSeconds: part ? 10 : Infinity, onChunk: (c) => features.push(c) });
  let wakeLock = null;
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
  if (part && drill?.token !== part.token) { // the loop stopped while the piano loaded
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
  if (guide === "click") for (const b of beatGrid()) if (b.t >= start - 1e-6 && b.t < end) guideItems.push({ when: songT0 + b.t, end: songT0 + b.t + 0.03, accent: b.accent });
  if (piano) for (const n of notes.slice(j0, j1)) guideItems.push({ when: songT0 + n.t, end: songT0 + n.t + n.d, n });
  guideItems.sort((a, b) => a.when - b.when);
  keepAlive(ac, nodes);
  scheduleAhead(ac, guideItems, (it) => it.n ? playPiano(ac, piano, it.when, it.n.d, it.n.midi, 0.9, nodes) : playClick(ac, it.when, it.accent, nodes), nodes);

  // The singer follows what they hear (output latency); the mic hears them
  // late (input latency); a pitch frame lags its audio (analysis window).
  const latency = (ac.outputLatency || ac.baseLatency || 0) + INPUT_LATENCY;
  take = { frames: [], grades: notes.map(() => null), endT: null, voice: null, songT0, latency, shiftSig, timing: timingSig(), rate, verse: verseSelect.value || score.verses[0] || "1", octave: 0, range: [j0, j1], part: !!part, guide };
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
  });
}

// The take's final grades; your pitch line is coloured against the note each frame was
// matched with (its moved slot), and drawn next to it.
function gradeFinal(endT) {
  const [j0, j1] = take.range;
  const part = gradeTake(notes.slice(j0, j1), take.frames, { endT, gate: MIN_RMS });
  take.grades = notes.map((_, j) => (j >= j0 && j < j1 ? part[j - j0] : null));
  for (const f of take.frames) f.ok = null;
  let k = 0;
  take.grades.forEach((g, j) => {
    if (!g || g.from === undefined) return;
    const n = notes[j];
    while (k < take.frames.length && take.frames[k].t < g.from) k++;
    for (let i = k; i < take.frames.length && take.frames[i].t < g.to; i++) {
      const f = take.frames[i];
      if (f.midi === null) continue;
      f.ok = Math.abs(fold(f.midi - n.midi)) * 100 <= OK_CENTS;
      f.disp = f.midi + 12 * Math.round((n.midi - f.midi) / 12);
    }
  });
}

async function stopSing() {
  const s = session;
  if (!s || s.kind !== "sing") return;
  session = null;
  const tk = take;
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
  if (v && !s.part) take.voice = { ...v, start: v.start - s.songT0 - take.latency };
  try { take.rhythm = rhythmOf(s, v, cal, stopAt, settings); } catch (err) { console.warn("rhythm", err); take.rhythm = null; }
  try { await s.wakeLock?.release(); } catch {}
  await s.mic.close();
  statusEl.textContent = "";
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
  openReview();
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
    return { calibrated: true, rt: cal.rt, trust: "speaker-guide", lead: null, notes: notes.map(() => null), obs: [{ kind: "headphones", tone: "try", scope: "take" }], diag };
  }
  const trip = cal ? cal.rt : s.latency;
  const ns = notes.slice(j0, j1);
  const met = metricOf().slice(j0, j1);
  const ls = lines.map((l) => l.filter((j) => j >= j0 && j < j1).map((j) => j - j0));
  const unsung = ns.map((_, k) => ["unsung", "missed"].includes(take.grades[j0 + k]?.status));
  const on = findOnsets(ns, s.features.result(), v.start, take.frames, met, { songT0: s.songT0, rt: cal ? cal.rt : null, latency: take.latency, endT: stopAt - s.songT0 - trip, unsung });
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
  return { calibrated: !!cal, rt: cal ? cal.rt : null, trust: "ok", lead: on.lead, steady: st.steady, drift: st.drift, notes: per, obs, diag };
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
  try { await beginPlay(kind, from, opts); } finally { starting = null; monitorSync(MON_RESUME); }
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
  const fi = !session && preview ? preview.j : focusNote(t);
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
  if (prevKey >= 0) {
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
    span.dataset.state = i === curSyl && cur >= 0 ? "current" : g && g.status !== "unsung" && !perform ? g.status : "";
  }
}

// A take in Perform view: just the lyrics.
const performing = () => session?.kind === "sing" && !session.part && view === "perform";

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
  // The samples can load and decode before audio may start (first touch on a phone).
  const loading = loadPiano(freshPlayCtx("press"));
  loading.catch(() => {});
  if (!pianoReady(playCtx)) statusEl.textContent = "loading piano…";
  let ac = null, piano = null;
  try {
    ac = await getPlayCtx("press");
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

const monitorListens = () => mon && !session && !drill && !starting && !keys.size && !document.hidden;

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
  full.push({ sig, at: Date.now(), pct, whole, lines: lines.map((_, li) => reviewRows.find((r) => r.li === li)?.score ?? null), rhythm: rhythmSummary() });
  const keep = new Set(full.filter((h) => h.sig === sig).slice(-10));
  all[songId] = full.filter((h) => h.sig !== sig || keep.has(h)).slice(-40);
  store(K.history, JSON.stringify(all));
}

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
function renderReview() {
  const pct = takeScore(notes, take.grades);
  const wordOf = (j) => { let i = j; while (i > 0 && notes[i].melisma) i--; return `“${sylText(notes[i], i).trim().replace(/[,.;:!?]+$/, "")}”`; };
  const fb = feedback(reviewRows, { rhythm: take.rhythm, prev: take.prev && take.prevLines ? { pct: take.prev.pct, lines: take.prevLines } : null, pct, whole: take.whole !== false, w: wordOf });
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
  const kind = session?.kind;
  const verb = view === "perform" ? "Perform" : "Sing";
  singBtn.textContent = drill ? "■ Stop loop" : kind === "sing" ? "■ Stop" : take?.endT != null ? `● ${verb} again` : `● ${verb}`;
  const perform = performing() ? "true" : "false";
  if (document.body.dataset.perform !== perform) document.body.dataset.perform = perform;
  singBtn.dataset.active = kind === "sing" ? "true" : "false";
  listenBtn.textContent = kind === "listen" ? "■ Stop" : "▶ Listen";
  listenBtn.disabled = kind === "sing" || !score || !!drill;
  singBtn.disabled = !score || (kind && kind !== "sing" && !drill);
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
  for (const el of [songSelect, verseSelect, keySelect, tempoSelect, optionsBtn, openFileBtn, openLinkBtn, removeBtn, saveBtn]) el.disabled = kind === "sing" || !!drill;
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
    if (n.t + n.d < tMin || n.t > tMax) return;
    const g = take?.grades[j];
    const key = g && g.status !== "unsung" ? g.status : "todo";
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
  if (take) {
    ctx.globalAlpha = monitoring ? 0.4 : 1;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = ctx.lineCap = "round";
    let prev = null;
    // Live: only up to now. Review: the whole take.
    const upTo = session?.kind === "sing" ? Math.min(tMax, nowT) : tMax;
    for (const f of take.frames) {
      if (f.t < tMin - 0.1 || f.t > upTo + 0.05 || f.disp === null) { prev = null; continue; }
      if (prev && Math.abs(prev.disp - f.disp) < 1.5 && f.t - prev.t < 0.1) {
        ctx.strokeStyle = f.ok === true ? "rgba(74,222,128,0.95)" : f.ok === false ? "rgba(245,170,90,0.95)" : "rgba(255,255,255,0.8)";
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

singBtn.addEventListener("click", () => (drill ? stopLoop() : session?.kind === "sing" ? stopSing() : startSing()));
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
  if (!bpm && (RATES.includes(r) || MAP_RATES.includes(r))) store(K.rate, String(r));
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
  store(K.rate, "1");
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
async function saveTake() {
  if (!take?.voice) return;
  const r = (x, k) => (x === null || x === undefined ? null : Math.round(x * 10 ** k) / 10 ** k);
  const base = `${safeName(score.title || "take")} take ${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`;
  const meta = {
    app: $("version")?.textContent || null, title: score.title, songId, verse: take.verse, rate: take.rate, timing: take.timing, guide: take.guide, view,
    clock: { ctxStart: take.ctxStart, songT0: take.songT0, est: take.est, latency: take.latency, beatSec: take.beatSec, countClicks: take.countClicks, frameShift: take.frameShift ?? 0 },
    notes: notes.map((n) => ({ t: r(n.t, 4), d: r(n.d, 4), q: n.q, dq: n.dq, midi: n.midi, text: n.text, melisma: n.melisma, restBefore: n.restBefore })),
    lines, range: take.range, endT: take.endT, metric: metricOf(),
    frames: take.frames.map((f) => [r(f.t, 4), r(f.midi, 3), r(f.rms, 5)]),
    grades: take.grades.map((g) => g && { status: g.status, dev: r(g.dev, 3), hit: r(g.hit, 3), shift: r(g.shift, 3) }),
    rhythm: take.rhythm,
  };
  await shareFiles([
    new File([wavOf(take.voice.data, take.voice.sampleRate)], `${base}.wav`, { type: "audio/wav" }),
    new File([JSON.stringify(meta)], `${base}.json`, { type: "application/json" }),
  ], base);
}
$("rv-save").addEventListener("click", saveTake);

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
  await refreshLibrary();
  const known = SAMPLES[savedSong] || (savedSong && [...mySongsEl.querySelectorAll("option")].some((o) => o.value === savedSong));
  await selectSong(known ? savedSong : "amazing-grace");
})();

// Debug hook for automated tests / devtools.
window.resonateDebug = () => ({ score, notes, lines, take, session: session && { kind: session.kind, line: session.line, mode: session.mode, count: session.count, beatSec: session.beatSec }, nowT, scrollT, practiceJ, reviewRows,
  monitor: mon && { listening: !!mon.stream, opening: mon.opening, ctx: mon.micCtx.state }, you: currentYou(), tapTargets: tapAlong?.targets });
