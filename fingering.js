// Piano fingering on the main thread (E7 stage 2, docs/FINGERING.md §3–4): a song's keyboard notes as
// finger.js takes them, the stored record, and the Worker that works it out (finger-worker.js). The
// Score (play.js) asks for the open song's; a conversion's save (omr/importer.js) for the song it
// saved — best effort, never in the way.
//
//   const rec = await fingeringFor({ id, xml, P, T, bpm, stored, rev });   → the record, or null
//
// The record (library.js songs, beside `clean`; samples: kept in memory only; never synced):
//   { v: 1, alg, hand, bpm, sig, at, ms, n: { "<note id>": [h, f, p, x] }, fr: { r: [[q0, m1…m5]], l } }
//   h "r" | "l", f 1–5 (0: none — a grace note, `w`), p its hand's frame, x flags (m moved, w too
//   wide, t a tie's continuation, g grace); fr each hand's frames: from written quarter q0, the key
//   each finger rests on (thumb first). Valid while alg, hand, bpm and sig match (`valid`): another
//   algorithm (finger.js ALG), hand size, tempo at 100% (the song's own tempo, else the score's,
//   else 90 — never the speed menu) or MusicXML (sig: its length + FNV-1a) is worked out again.
// Every record made ready (stored or worked out) is announced on window as "resonate:fingering"
// { song, fing, computed (worked out now), from: "score" | "import" }.
import { ALG, fingerNotes } from "./finger.js?v=108";
import { prepare } from "./playprep.js?v=108";
import { timeline, track } from "./playtime.js?v=108";
import { parseMusicXml, DEFAULT_TEMPO } from "./musicxml.js?v=108";
import { getSong, saveFing } from "./library.js?v=108";
import { songXml, SAMPLES } from "./catalog.js?v=108";

export { ALG };
export const HAND = "sb"; // the hand size (D3: small, the beginner weights) — in the cache key
const BASE = new URL(".", import.meta.url).href;
const memo = new Map(); // id → the record worked out last on this page (a sample's only home; a song's: its record read before it was kept — the Score reopening it as a conversion keeps it)
const inflight = new Map(); // "id|alg|hand|bpm|sig" → the record being worked out (a conversion's save and the Score's reload ask at once: once)
export const stats = { computed: 0, worker: 0, main: 0, last: null }; // (tests: how many were worked out on this page, where)

// The MusicXML's signature: its length and FNV-1a (32 bits) over its UTF-16 code units.
export function xmlSig(xml) {
  let h = 0x811c9dc5;
  for (let i = 0; i < xml.length; i++) { h ^= xml.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return xml.length + ":" + (h >>> 0).toString(16);
}

// The tempo at 100% for the key, as play.js tempoBase: the song's own (Sing's "Type a tempo" / "Tap
// the beat"), else the score's as Sing reads it, else the timeline's first mark, else 90.
export function songTempo(id, xml, T) {
  try {
    const b = Number(JSON.parse(localStorage.getItem("resonate.sing.timing") || "{}")?.[id]?.bpm);
    if (b >= 20 && b <= 400) return b;
  } catch {}
  let t = null;
  try { t = parseMusicXml(xml).tempo; } catch {}
  return t || T?.first || DEFAULT_TEMPO;
}

// The keyboard part (docs/FINGERING.md §3 "Part"): Both's piano — staff 1 the right hand, its last
// the left, a middle one by its clef; one staff: no staff hand (every onset open) — or a hymn's pair
// (the treble part the right hand, the bass the left). Anything else has no fingering. → { parts,
// hand(el) → "r" | "l" | null } | null
export function keyboardOf(P) {
  const both = P?.views?.both;
  if (!both) return null;
  if (both.kind === "piano") {
    const p = P.parts.find((x) => x.id === both.parts[0]);
    if (!p) return null;
    const n = p.staves || 1;
    return { parts: [p.id], hand: (e) => (n < 2 ? null : e.staff <= 1 ? "r" : e.staff >= n ? "l" : p.clefs[String(e.staff)] === "F" ? "l" : "r") };
  }
  if (both.kind === "hymn" && both.parts.length === 2) return { parts: both.parts.slice(), hand: (e) => (e.part === both.parts[1] ? "l" : "r") };
  return null;
}

// Printed fingers (<technical><fingering>: the first digit 1–5) and arpeggiated chords, by note id.
function marksOf(doc) {
  const out = new Map();
  for (const n of doc.getElementsByTagName("note")) {
    const id = n.getAttribute("id");
    if (!id) continue;
    let pin = 0, arp = false;
    for (const no of n.children) {
      if (no.nodeName !== "notations") continue;
      for (const x of no.children) {
        if (x.nodeName === "arpeggiate") arp = true;
        else if (x.nodeName === "technical") for (const f of x.children) if (f.nodeName === "fingering" && !pin) { const d = /[1-5]/.exec(f.textContent || ""); if (d) pin = Number(d[0]); }
      }
    }
    if (pin || arp) out.set(id, { pin, arp });
  }
  return out;
}

// The keyboard part's notes as finger.js takes them (§3 "Input"): ▶'s schedule in written order at
// `bpm` (ties joined, unisons struck once, an overfilled voice cut at its barline), with each note's
// staff and staff hand from the timeline. [] when the song has no keyboard part.
export function keyboardNotes(P, T, bpm, kb = keyboardOf(P)) {
  if (!kb || !T) return [];
  const byId = new Map(T.els.map((e) => [e.id, e]));
  const tr = track(T, { bars: T.bars.map((_, i) => i), keep: (e) => kb.parts.includes(e.part), base: bpm });
  const marks = marksOf(P.doc);
  const out = [];
  for (const it of tr.items) {
    const e = byId.get(it.id);
    if (!e) continue;
    const m = marks.get(it.id);
    out.push({
      id: it.id, q: it.q, t: it.sec, d: it.sound ? it.hold : it.dur, midi: it.midi, staff: e.staff, hand: kb.hand(e),
      tied: !it.sound && !it.grace && !!e.tieStop, grace: !!it.grace, pin: m?.pin || 0, arp: !!m?.arp,
    });
  }
  return out;
}

// Still the right one? (another algorithm, hand, tempo or MusicXML: no)
export const valid = (rec, want) => !!rec && rec.v === 1 && rec.alg === want.alg && rec.hand === want.hand && rec.bpm === want.bpm && rec.sig === want.sig && rec.n && rec.fr;

// finger.js's result → the stored record.
export function pack(res, want) {
  const n = {};
  for (const [id, v] of res.notes) n[id] = [v.h, v.f, v.p, v.x];
  const fr = { r: res.frames.r.map((f) => [f.q0, ...f.keys]), l: res.frames.l.map((f) => [f.q0, ...f.keys]) };
  return { v: 1, alg: want.alg, hand: want.hand, bpm: want.bpm, sig: want.sig, at: Date.now(), ms: Math.round(res.ms || 0), n, fr };
}

// --- the Worker (one, kept; a module Worker — where there's none, the main thread) ---------------------
let worker = null, seq = 0;
const waiting = new Map(); // request id → { resolve, reject, items, hand }
function onMain(w) {
  stats.main++;
  try { w.resolve(fingerNotes(w.items, { hand: w.hand })); } catch (err) { w.reject(err); }
}
function ensureWorker() {
  if (worker !== null) return worker;
  try {
    worker = new Worker(`${BASE}finger-worker.js?v=108`, { type: "module" });
    worker.onmessage = (e) => {
      const w = waiting.get(e.data?.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.error) w.reject(new Error(e.data.error));
      else { stats.worker++; w.resolve(e.data.result); }
    };
    // (it didn't load — no module workers here: what waits is worked out here, and so is what comes)
    worker.onerror = (e) => {
      e.preventDefault?.();
      worker = false;
      const list = [...waiting.values()];
      waiting.clear();
      for (const w of list) onMain(w);
    };
  } catch { worker = false; }
  return worker;
}
export function fingerAsync(items, hand = HAND) {
  return new Promise((resolve, reject) => {
    const w = { resolve, reject, items, hand };
    if (!ensureWorker()) return onMain(w);
    const id = ++seq;
    waiting.set(id, w);
    try { worker.postMessage({ id, items, hand }); } catch (err) { waiting.delete(id); onMain(w); }
  });
}

const announce = (song, fing, computed, from) => { try { window.dispatchEvent(new CustomEvent("resonate:fingering", { detail: { song, fing, computed, from } })); } catch {} };

// A song's fingering: the stored one while it's valid, else worked out (in the Worker) and kept —
// with the song (saveFing, only into the same MusicXML: rev), or in memory for a sample.
// { id, xml (as Play reads it: catalog songXml), P (prepare(xml)), T (timeline), bpm, stored (the
// song's record's fing), rev (the song's rev), from } → { rec, computed, items (ms to build them) } |
// null (no keyboard part). Throws only when the fingering itself failed.
export async function fingeringFor({ id, xml, P, T, bpm, stored = null, rev = null, from = "score" }) {
  const kb = keyboardOf(P);
  if (!kb) return null;
  const ts = performance.now();
  const want = { alg: ALG, hand: HAND, bpm, sig: xmlSig(xml) };
  const sample = !!SAMPLES[id];
  // (a record worked out here already — on this page, or under way — is kept with the song when it
  // isn't yet: its MusicXML read again with the same notes, the conversion and the Score at once)
  const reuse = async (rec) => {
    if (!sample && rec !== stored) { try { await saveFing(id, rec, rev); } catch (err) { console.info("fingering: not kept", err?.message); } }
    announce(id, rec, false, from);
    return { rec, computed: false, items: 0 };
  };
  const have = !sample && valid(stored, want) ? stored : memo.get(id);
  if (valid(have, want)) return reuse(have);
  const key = [id, want.alg, want.hand, want.bpm, want.sig].join("|");
  if (inflight.has(key)) {
    const rec = await inflight.get(key);
    if (rec) return reuse(rec);
  }
  let settle = null;
  inflight.set(key, new Promise((r) => { settle = r; }));
  try {
    const out = await workOut({ id, P, T, bpm, kb, want, sample, rev, from, ts });
    settle(out?.rec || null);
    return out;
  } catch (err) { settle(null); throw err; }
  finally { inflight.delete(key); }
}
async function workOut({ id, P, T, bpm, kb, want, sample, rev, from, ts }) {
  const t0 = performance.now();
  const items = keyboardNotes(P, T, bpm, kb);
  const built = Math.round(performance.now() - t0);
  if (!items.length) return null;
  const run = fingerAsync(items, HAND);
  const sync = Math.round((performance.now() - ts) * 10) / 10; // (this task's share: the signature, the notes, the post)
  const res = await run;
  stats.computed++;
  const rec = pack(res, want);
  stats.last = { song: id, at: rec.at, ms: rec.ms, built, sync, notes: items.length, from };
  memo.set(id, rec);
  if (!sample) {
    try { await saveFing(id, rec, rev); } catch (err) { console.info("fingering: not kept", err?.message); }
  }
  announce(id, rec, true, from);
  return { rec, computed: true, items: built };
}

// A breath between heavy steps: idle time (at most 500 ms away), else the next task — as play.js
// fingStart takes them one a task.
const breath = () => new Promise((r) => (typeof requestIdleCallback === "function" ? requestIdleCallback(() => r(), { timeout: 500 }) : setTimeout(r, 0)));

// After a conversion's save (omr/importer.js): the song's fingering worked out and kept, as the Score
// would on its first open — one step a task (the clean-ups, the views, the timeline, the tempo, then
// the notes: together they held the main thread 0.25–0.6 s on a 150-bar piece). Best effort: never throws.
export async function fingerSong(id) {
  try {
    const song = await getSong(id);
    await breath();
    const xml = songXml(song, { keep: false }); // (what the Score will read; its first open keeps the cleaned copy, as always)
    if (!xml) return null;
    await breath();
    const P = prepare(xml);
    await breath();
    const T = timeline(P.doc, P.facts);
    await breath();
    const bpm = songTempo(id, xml, T);
    await breath();
    const out = await fingeringFor({ id, xml, P, T, bpm, stored: song.fing || null, rev: song.rev ?? null, from: "import" });
    return out?.rec || null;
  } catch (err) {
    console.info("fingering after the save", err?.message || err);
    return null;
  }
}
