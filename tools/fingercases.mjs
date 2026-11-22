// public/finger.js (E7 stage 1, docs/FINGERING.md §3, §8 "Node"): synthetic keyboard parts with the
// fingerings a teacher would accept, R6 (the owner's G3 + B4), the invariants on every case for every
// hand size, determinism (also with the notes shuffled), 3000 notes against the clock, and golden
// hashes: an output change without an ALG bump fails.
//   node fingercases.mjs            the checks
//   node fingercases.mjs --update   rewrite fixtures/finger/golden.json — refused while ALG is the
//                                   golden's and a stored hash changed (bump ALG in finger.js first)
//   VERBOSE=1                        every case's fingering
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import C from "./lib/check.cjs";
import { invariants } from "./lib/fingerinv.mjs";
import { ALG, SPANS, COST, keyX, assignHands, fingerHand, framesOf, fingerNotes } from "../public/finger.js";

const { ok, done, fail } = C;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(HERE, "fixtures", "finger", "golden.json");
const UPDATE = process.argv.includes("--update");
const VERBOSE = !!process.env.VERBOSE;
const SIZES = ["sb", "mb", "lb"];

// ---- building parts ---------------------------------------------------------------------------------
// A note at written quarter q for dq quarters, at ♩=bpm (t, d in seconds as track() gives them).
let BPM = 90;
const spq = () => 60 / BPM;
const N = (id, q, dq, midi, hand, o = {}) => ({ id, q, t: q * spq(), d: dq * spq(), midi, staff: hand === "l" ? 2 : 1, hand, tied: false, grace: false, pin: 0, arp: false, ...o });
// A line of notes, one after another: [midi, dq] pairs (midi an array = a chord), from q0.
function line(prefix, hand, q0, notes, o = {}) {
  const out = [];
  let q = q0;
  notes.forEach(([m, dq], i) => {
    for (const midi of [].concat(m)) out.push(N(`${prefix}${i}${Array.isArray(m) ? "." + midi : ""}`, q, dq, midi, hand, o));
    q += dq;
  });
  return out;
}
const M = { C2: 36, D2: 38, E2: 40, F2: 41, G2: 43, A2: 45, B2: 47, C3: 48, D3: 50, E3: 52, F3: 53, G3: 55, A3: 57, B3: 59,
  C4: 60, D4: 62, E4: 64, F4: 65, G4: 67, A4: 69, B4: 71, C5: 72, D5: 74, E5: 76, F5: 77, G5: 79, A5: 81, C6: 84, C1: 24, G1: 31,
  Fs4: 66, Gs4: 68, As4: 70, Cs5: 73, Ds5: 75 };

const run = (items, hand = "sb") => fingerNotes(items, { hand, debug: true });
const fingersOf = (res, ids) => ids.map((id) => res.notes.get(id)?.f);
const handsOf = (res, ids) => ids.map((id) => res.notes.get(id)?.h).join("");
const show = (res, items) => items.map((it) => { const n = res.notes.get(it.id); return n ? `${it.id}:${n.h}${n.f}${n.x}` : `${it.id}:—`; }).join(" ");
const oneOf = (got, sets) => sets.some((s) => s.length === got.length && s.every((v, i) => v === got[i]));
const ids = (items) => items.map((it) => it.id);

// ---- the invariants (§8 fingersurvey's, on every case and hand size): lib/fingerinv.mjs ---------------

// A stable text of a result (no ms): the golden hashes and the determinism checks.
function serial(res) {
  const notes = [...res.notes].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([id, n]) => `${id}:${n.h}${n.f}.${n.p}.${n.x}`).join(" ");
  return notes + "|" + JSON.stringify(res.frames);
}
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

// A seeded shuffle (mulberry32).
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const shuffled = (a, seed) => { const r = rng(seed), b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

// ---- the cases ----------------------------------------------------------------------------------------
const CASES = []; // { name, items, check(res, hand) → [ok, what] list (only for the hands in `on`), on }
const add = (name, items, check, on = ["sb"]) => CASES.push({ name, items, check, on });

// A five-finger tune: C D E F G F E D C → 1 2 3 4 5 4 3 2 1.
{
  const it = line("ff", "r", 0, [[M.C4, 1], [M.D4, 1], [M.E4, 1], [M.F4, 1], [M.G4, 1], [M.F4, 1], [M.E4, 1], [M.D4, 1], [M.C4, 2]]);
  add("five-finger tune", it, (res) => [[oneOf(fingersOf(res, ids(it)), [[1, 2, 3, 4, 5, 4, 3, 2, 1]]), `1 2 3 4 5 4 3 2 1 (${fingersOf(res, ids(it)).join(" ")})`],
    [res.frames.r.length === 1 && res.frames.r[0].keys.join() === [60, 62, 64, 65, 67].join(), `one frame, C D E F G (${JSON.stringify(res.frames.r)})`]], SIZES);
}
// The ghost's frame from a finger on a black key (the frame is set at its first onset: E♭ on 3 alone —
// the thumb tucks onto C, 4 and 5 rest on F and G), kept while the line stays within it.
{
  const it = line("cm", "r", 0, [[63, 1], [M.D4, 1], [M.C4, 1], [M.D4, 1], [63, 1]]);
  add("C minor five-finger frame", it, (res) => [[oneOf(fingersOf(res, ids(it)), [[3, 2, 1, 2, 3]]), `3 2 1 2 3 (${fingersOf(res, ids(it)).join(" ")})`],
    [res.frames.r.length === 1 && res.frames.r[0].keys.join() === [60, 62, 63, 65, 67].join(), `one frame, C D E♭ F G (${JSON.stringify(res.frames.r)})`]], SIZES);
}
// C major, both ways, eighths at ♩=90.
{
  const up = [M.C4, M.D4, M.E4, M.F4, M.G4, M.A4, M.B4, M.C5], down = up.slice().reverse();
  const it = line("cr", "r", 0, [...up, ...down.slice(1)].map((m) => [m, 0.5]));
  add("C major RH", it, (res) => { const f = fingersOf(res, ids(it)); return [[oneOf(f, [[1, 2, 3, 1, 2, 3, 4, 5, 4, 3, 2, 1, 3, 2, 1]]), `1 2 3 1 2 3 4 5 4 3 2 1 3 2 1 (${f.join(" ")})`]]; }, SIZES);
  const lup = up.map((m) => m - 12), ldown = lup.slice().reverse();
  const lt = line("cl", "l", 0, [...lup, ...ldown.slice(1)].map((m) => [m, 0.5]));
  add("C major LH (mirrored)", lt, (res) => { const f = fingersOf(res, ids(lt)); return [[oneOf(f, [[5, 4, 3, 2, 1, 3, 2, 1, 2, 3, 1, 2, 3, 4, 5]]), `5 4 3 2 1 3 2 1 2 3 1 2 3 4 5 (${f.join(" ")})`]]; }, SIZES);
  const l5 = line("l5", "l", 0, [[M.C3, 1], [M.D3, 1], [M.E3, 1], [M.F3, 1], [M.G3, 1]]);
  add("LH five-finger (mirrored)", l5, (res) => [[oneOf(fingersOf(res, ids(l5)), [[5, 4, 3, 2, 1]]), `5 4 3 2 1 (${fingersOf(res, ids(l5)).join(" ")})`]], SIZES);
}
// RH chords: C major root, 1st and 2nd inversion.
{
  const it = line("ch", "r", 0, [[[M.C4, M.E4, M.G4], 2], [[M.E4, M.G4, M.C5], 2], [[M.G4, M.C5, M.E5], 2]]);
  add("RH chords", it, (res) => {
    const f = (i) => [0, 1, 2].map((j) => res.notes.get(it[3 * i + j].id).f);
    return [[oneOf(f(0), [[1, 3, 5]]), `C E G 1 3 5 (${f(0).join(" ")})`], [oneOf(f(1), [[1, 2, 5]]), `E G C 1 2 5 (${f(1).join(" ")})`],
      [oneOf(f(2), [[1, 3, 5], [1, 2, 5]]), `G C E 1 3 5 or 1 2 5 (${f(2).join(" ")})`]];
  }); // (the default hand; a medium hand's C E G comes out 1 2 4 — the averaged move into the next chord pays for its 4)
}
// LH root–fifth–octave, Alberti, octave leaps (5–5).
{
  const rfo = line("rf", "l", 0, [[M.C2, 0.5], [M.G2, 0.5], [M.C3, 0.5], [M.G2, 0.5], [M.C2, 0.5], [M.G2, 0.5], [M.C3, 0.5], [M.G2, 0.5]]);
  add("LH root–fifth–octave", rfo, (res) => { const f = fingersOf(res, ids(rfo)); return [[oneOf(f.slice(0, 4), [[5, 2, 1, 2], [5, 3, 1, 3]]), `5 2 1 2 or 5 3 1 3 (${f.join(" ")})`]]; }, SIZES);
  const alb = line("al", "l", 0, [[M.C3, 0.5], [M.G3, 0.5], [M.E3, 0.5], [M.G3, 0.5], [M.C3, 0.5], [M.G3, 0.5], [M.E3, 0.5], [M.G3, 0.5]]);
  add("LH Alberti", alb, (res) => { const f = fingersOf(res, ids(alb)); return [[oneOf(f.slice(0, 4), [[5, 1, 3, 1], [5, 1, 2, 1]]), `5 1 3 1 or 5 1 2 1 (${f.join(" ")})`]]; });
  // (the default hand: for a medium or large one 3–1 spans the fifth relaxed too — a tie with 5–1, the
  // lower state wins: 3 1 2 1)
  // octave leaps: a slow octave bass is 5 below, 5 or 1 above (a lift or a stretched octave, both fine);
  // printed 5–5 is kept, and where the hand can lift it costs a jump, not the legato stretch (§3: "an
  // octave bass on 5–5 is fine")
  const oct = line("oc", "l", 0, [[M.C2, 2], [M.C3, 2], [M.G1, 2], [M.G2, 2]]);
  add("LH octave leaps", oct, (res) => { const f = fingersOf(res, ids(oct)); return [[f[0] === 5 && f[2] === 5 && [1, 5].includes(f[1]) && [1, 5].includes(f[3]), `5 below, 5 or 1 above (${f.join(" ")})`]]; }, SIZES);
  const oct55 = oct.map((it) => ({ ...it, pin: 5 })), fast55 = line("of", "l", 0, [[M.C2, 0.125], [M.C3, 0.125], [M.G1, 0.125], [M.G2, 0.125]]).map((it) => ({ ...it, pin: 5 }));
  add("LH octave leaps on 5–5 (printed)", oct55, (res) => {
    const slow = res.debug.l.cost / 3, fast = run(fast55, res.debug.A.size).debug.l.cost / 3;
    return [[fingersOf(res, ids(oct55)).every((x) => x === 5), "kept 5 5 5 5"],
      [slow <= 16 && fast > 4 * slow, `a lift: ${slow.toFixed(1)} a leap at half notes, ${fast.toFixed(1)} in 32nds (no lift)`]];
  }, SIZES);
}
// An arpeggiated tenth in the LH: one hand, no w, no move; without the arpeggio the small hand can't.
{
  const arp = [N("aC2", 0, 2, M.C2, "l", { arp: true }), N("aE3", 0, 2, M.E3, "l", { arp: true }), ...line("am", "r", 0, [[M.C5, 1], [M.D5, 1]])];
  add("arpeggiated tenth", arp, (res) => {
    const a = res.notes.get("aC2"), b = res.notes.get("aE3");
    return [[a.h === "l" && b.h === "l" && !a.x && !b.x && a.f === 5 && b.f === 1, `C2 + E3 LH 5 1, no flag (${show(res, arp.slice(0, 2))})`]];
  }, SIZES);
  const plain = arp.map((it) => ({ ...it, arp: false }));
  add("tenth, no arpeggio", plain, (res) => {
    const b = res.notes.get("aE3");
    return [[/[mw]/.test(b.x + res.notes.get("aC2").x), `E3 moved or too wide (${show(res, plain.slice(0, 2))})`]];
  });
}
// Repeated notes keep the finger; a black-key run keeps the thumb off the black keys.
{
  const rep = line("rp", "r", 0, [[M.C4, 0.5], [M.C4, 0.5], [M.C4, 0.5], [M.C4, 0.5]]);
  add("repeated notes", rep, (res) => { const f = fingersOf(res, ids(rep)); return [[f.every((x) => x === f[0] && x > 0), `one finger (${f.join(" ")})`]]; }, SIZES);
  const blk = line("bk", "r", 0, [[M.Fs4, 0.5], [M.Gs4, 0.5], [M.As4, 0.5], [M.Gs4, 0.5], [M.Fs4, 1]]);
  add("black keys", blk, (res) => { const f = fingersOf(res, ids(blk)); return [[!f.includes(1), `no thumb on a black key (${f.join(" ")})`], [oneOf(f, [[2, 3, 4, 3, 2]]), `2 3 4 3 2 (${f.join(" ")})`]]; }, SIZES);
}
// Ties: the continuation is the start's (t); a held note under a moving line keeps its finger.
{
  const tie = [N("tA", 0, 3, M.C4, "r"), N("tB", 2, 1, M.C4, "r", { tied: true }), ...line("tl", "r", 0, [[M.E4, 1], [M.F4, 1], [M.G4, 1], [M.E4, 1]])];
  add("ties", tie, (res) => {
    const a = res.notes.get("tA"), b = res.notes.get("tB");
    return [[b.x === "t" && b.h === a.h && b.f === a.f && a.f > 0, `the continuation is its start's, flagged t (${show(res, tie.slice(0, 2))})`]];
  }, SIZES);
  const held = [N("hC", 0, 4, M.C4, "r"), ...line("hl", "r", 0, [[M.E4, 1], [M.F4, 1], [M.G4, 1], [M.A4, 1]])];
  add("held under a moving line", held, (res) => {
    const c = res.notes.get("hC").f, f = fingersOf(res, ids(held).slice(1));
    return [[c === 1 && f.every((x) => x > c), `C4 1, the line above it (${c} | ${f.join(" ")})`], [res.debug.r.let.length === 0, `nothing let go (${res.debug.r.let.length})`]];
  }, SIZES);
}
// A 6-note chord: one inner key w (the right hand's lowest), the rest 1–5.
{
  const six = [...line("sx", "r", 0, [[[M.C4, M.D4, M.E4, M.F4, M.G4, M.A4], 2]]), ...line("sl", "l", 0, [[[M.C2, M.D2, M.E2, M.F2, M.G2], 2]])];
  add("6-note chord", six, (res) => {
    const r = six.slice(0, 6).map((it) => res.notes.get(it.id));
    const w = r.filter((n) => /w/.test(n.x));
    return [[w.length === 1 && /w/.test(r[0].x), `one w, on C4 (${show(res, six.slice(0, 6))})`], [r.slice(1).map((n) => n.f).join() === "1,2,3,4,5", `D4…A4 1 2 3 4 5`]];
  }, SIZES);
}
// R6 — the owner's: G3 + B4 on the treble staff over a held LH C3, C2, C2 + C3 → G3 to the LH (m).
// (Small and medium: a tenth is past the practical 1–5 span, 14 / 16. The large hand reaches a tenth —
// 18 is its MaxPrac — so its staff's hand plays it, D2; a twelfth moves for every hand size.)
const R6 = {
  "C3": [N("C3", 0, 2, M.C3, "l"), N("E4", 0, 1, M.E4, "r"), N("G3", 1, 1, M.G3, "r"), N("B4", 1, 1, M.B4, "r")],
  "C2": [N("C2", 0, 2, M.C2, "l"), N("E4", 0, 1, M.E4, "r"), N("G3", 1, 1, M.G3, "r"), N("B4", 1, 1, M.B4, "r")],
  "C2+C3": [N("C2", 0, 2, M.C2, "l"), N("C3", 0, 2, M.C3, "l"), N("E4", 0, 1, M.E4, "r"), N("G3", 1, 1, M.G3, "r"), N("B4", 1, 1, M.B4, "r")],
};
for (const [held, it] of Object.entries(R6)) {
  add(`R6 over ${held}`, it, (res, hand) => {
    const g = res.notes.get("G3"), b = res.notes.get("B4");
    const out = [];
    if (hand === "lb") out.push([g.h === "r" && !g.x && g.f > 0, `large hand: G3 + B4 a tenth, the RH plays it (${show(res, it)})`]);
    else {
      out.push([g.h === "l" && g.x === "m" && g.f === 1, `G3 LH 1, m (${show(res, it)})`]);
      out.push([b.h === "r" && !b.x && b.f > 0, `B4 RH (${b.h}${b.f}${b.x})`]);
      if (held === "C3" && hand === "sb") out.push([res.notes.get("C3").f === 5, `C3 LH 5 (${res.notes.get("C3").f})`]);
    }
    return out;
  }, SIZES);
}
{
  const it = [N("C3", 0, 2, M.C3, "l"), N("E4", 0, 1, M.E4, "r"), N("G3", 1, 1, M.G3, "r"), N("D5", 1, 1, M.D5, "r")];
  add("R6 wide: G3 + D5 over C3", it, (res) => { const g = res.notes.get("G3"); return [[g.h === "l" && g.x === "m" && g.f === 1, `G3 LH 1, m (${show(res, it)})`]]; }, SIZES);
}
// A one-staff piano: no staff hands — every onset open; never m.
{
  const it = [N("oC3", 0, 2, M.C3, null), N("oG4", 0, 1, M.G4, null), N("oA4", 1, 1, M.A4, null), N("oE3", 2, 2, M.E3, null), N("oB4", 2, 1, M.B4, null), N("oC5", 3, 1, M.C5, null)];
  add("one-staff piano", it, (res) => [[handsOf(res, ids(it)) === "lrrlrr", `bass LH, tune RH (${show(res, it)})`], [it.every((x) => !/m/.test(res.notes.get(x.id).x)), "no m"]], SIZES);
}
// Printed fingers kept; contradictory ones don't break anything.
{
  const it = line("pf", "r", 0, [[M.C4, 1], [M.D4, 1], [M.E4, 1], [M.F4, 1], [M.G4, 1]]);
  it[1].pin = 3; // D4 printed 3
  add("printed finger", it, (res) => { const f = fingersOf(res, ids(it)); return [[f[1] === 3, `D4 3 as printed (${f.join(" ")})`]]; }, SIZES);
  const bad = line("pb", "r", 0, [[[M.C4, M.E4], 1], [M.G4, 1]]);
  bad[0].pin = 2; bad[1].pin = 2; // both keys of a chord printed 2
  add("contradictory printed fingers", bad, (res) => { const f = fingersOf(res, ids(bad)); return [[f[0] !== f[1] && f.every((x) => x > 0), `fingered anyway (${f.join(" ")})`]]; }, SIZES);
}
// An octave error (G3 read for G4 under C5 + E5, the LH far below): an inner w, no exception.
{
  const it = [...line("oe", "r", 0, [[[M.G3, M.C5, M.E5], 2]]), ...line("ol", "l", 0, [[[M.C1, M.G1], 2]])];
  add("octave error", it, (res) => {
    const g = res.notes.get(it[0].id), c = res.notes.get(it[1].id), e = res.notes.get(it[2].id);
    return [[g.x === "w" && g.f === 0 && g.h === "r", `G3 w (${show(res, it)})`], [c.f > 0 && e.f > 0 && c.f < e.f, "C5 E5 fingered"]];
  }, SIZES);
}
// Grace notes: a hand, no finger, g. A unison across the staves: one key.
{
  const it = [N("gr", 1, 0, M.D4, "r", { grace: true, t: 1 * spq() - 0.07, d: 0.07 }), ...line("gl", "r", 0, [[M.C4, 1], [M.C4, 1], [M.E4, 1]])];
  add("grace note", it, (res) => { const g = res.notes.get("gr"); return [[g.h === "r" && g.f === 0 && g.x === "g", `D4 grace r0g (${g.h}${g.f}${g.x})`]]; }, SIZES);
  const un = [N("uR", 0, 1, M.C4, "r"), N("uL", 0, 1, M.C4, "l"), N("uE", 0, 1, M.E4, "r"), N("uA", 0, 1, M.A3, "l")];
  add("unison across the staves", un, (res) => {
    const a = res.notes.get("uR"), b = res.notes.get("uL");
    return [[a.h === b.h && a.f === b.f && a.f > 0 && !a.x && !b.x, `C4 one key, one finger (${show(res, un)})`]];
  }, SIZES);
}

// The bundled Amazing Grace (a hymn: treble part RH, bass part LH; unisons, ties) — a stand-in for
// tools/fixtures/finger/amazing-grace.json until stage 2's dumpkeys.cjs: the MusicXML read here with
// regular expressions (this one file), its tempo, ties joined as track() joins them.
function hymn() {
  const xml = fs.readFileSync(path.join(HERE, "..", "public", "songs", "amazing-grace.musicxml"), "utf8");
  const bpm = Number(/<sound tempo="(\d+)"/.exec(xml)?.[1]) || 90;
  const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const parts = [...xml.matchAll(/<part id="([^"]+)">([\s\S]*?)<\/part>/g)];
  const lens = [];
  const raw = [];
  parts.forEach(([, pid, body], pi) => {
    let div = 1;
    [...body.matchAll(/<measure\b[^>]*>([\s\S]*?)<\/measure>/g)].forEach(([, mb], mi) => {
      let pos = 0, max = 0, last = 0;
      for (const [el, name] of mb.matchAll(/<(note|backup|forward|attributes)\b[\s\S]*?<\/\1>/g)) {
        const dur = Number(/<duration>(\d+)<\/duration>/.exec(el)?.[1] || 0);
        if (name === "attributes") { const d = /<divisions>(\d+)<\/divisions>/.exec(el); if (d) div = Number(d[1]); continue; }
        if (name === "backup") { pos -= dur / div; continue; }
        if (name === "forward") { pos += dur / div; max = Math.max(max, pos); continue; }
        const chord = /<chord\/>/.test(el), o = chord ? last : pos;
        if (!chord) { last = pos; pos += dur / div; max = Math.max(max, pos); }
        if (/<rest\b/.test(el) || /<grace\b/.test(el)) continue;
        const step = /<step>([A-G])<\/step>/.exec(el)[1], alter = Number(/<alter>(-?\d+)<\/alter>/.exec(el)?.[1] || 0), oct = Number(/<octave>(\d+)<\/octave>/.exec(el)[1]);
        raw.push({ pid, pi, mi, o, dq: dur / div, midi: 12 * (oct + 1) + STEP[step] + alter, voice: /<voice>(\d+)<\/voice>/.exec(el)?.[1] || "1",
          tieStart: /<tie type="start"/.test(el), tieStop: /<tie type="stop"/.test(el) });
      }
      lens[mi] = Math.max(lens[mi] ?? 0, max);
    });
  });
  const barQ = [];
  lens.reduce((q, len, mi) => { barQ[mi] = q; return q + len; }, 0);
  const sp = 60 / bpm, items = [], open = new Map();
  raw.map((r) => ({ ...r, q: barQ[r.mi] + r.o })).sort((a, b) => a.q - b.q || a.pi - b.pi).forEach((r, i) => {
    const it = { id: `h${i}`, q: r.q, t: r.q * sp, d: r.dq * sp, midi: r.midi, staff: 1, hand: r.pi === 0 ? "r" : "l", tied: false, grace: false, pin: 0, arp: false };
    const key = r.pid + "|" + r.midi, start = r.tieStop ? open.get(key) : null;
    if (start) { start.d = it.t + it.d - start.t; it.tied = true; }
    if (r.tieStart) open.set(key, start || it); else open.delete(key);
    items.push(it);
  });
  return items;
}
const HYMN = hymn();
add("Amazing Grace (hymn)", HYMN, (res) => {
  const st = summary(HYMN, res);
  return [[HYMN.length > 150 && st.fingered + st.ties + st.wide + st.grace === HYMN.length, `${HYMN.length} notes: ${JSON.stringify(st)}`]];
}, SIZES);

// A 3000-note piano part (seeded): RH tune in eighths and quarters with dyads and triads under it, held
// notes, ties over the barline, grace notes, now and then a tune note low on the treble staff; LH Alberti,
// root–fifth–octave, block chords, held bass. ♩=100, 4/4.
function bigPiece(n = 3000, seed = 7) {
  const r = rng(seed), out = [];
  const pick = (a) => a[Math.floor(r() * a.length)];
  const prevBpm = BPM; BPM = 100;
  const SCALE = [0, 2, 4, 5, 7, 9, 11];
  let bar = 0, mel = 72, id = 0;
  const add1 = (q, dq, midi, hand, o) => out.push(N(`b${id++}`, q, dq, midi, hand, o));
  while (out.length < n) {
    const q0 = bar * 4, root = pick([48, 53, 55, 57, 50, 52]), triad = [root, root + (r() < 0.5 ? 4 : 3), root + 7];
    // LH
    const lh = pick(["alberti", "rfo", "block", "held"]);
    if (lh === "alberti") [0, 2, 1, 2, 0, 2, 1, 2].forEach((ix, i) => add1(q0 + i * 0.5, 0.5, triad[ix], "l"));
    else if (lh === "rfo") [root - 12, root - 5, root, root - 5].forEach((m, i) => add1(q0 + i, 1, m, "l"));
    else if (lh === "block") { for (const m of triad) add1(q0, 2, m - (r() < 0.5 ? 12 : 0), "l"); for (const m of triad) add1(q0 + 2, 2, m, "l"); }
    else { add1(q0, 4, root - 12, "l"); add1(q0 + 1, 1, root, "l"); add1(q0 + 2, 1, root + 7, "l"); add1(q0 + 3, 1, root + 4, "l"); }
    // RH
    let q = q0;
    while (q < q0 + 4 - 1e-9) {
      const dq = Math.min(pick([0.5, 0.5, 1, 1, 1.5, 2]), q0 + 4 - q);
      const step = pick([-2, -1, -1, 1, 1, 2, 0, 3, -3, 5, -4]);
      let deg = SCALE.indexOf(((mel % 12) + 12) % 12);
      if (deg < 0) deg = 0;
      const oct = Math.floor(mel / 12) + Math.floor((deg + step) / 7), nd = ((deg + step) % 7 + 7) % 7;
      mel = Math.max(62, Math.min(88, oct * 12 + SCALE[nd]));
      const o = {};
      if (r() < 0.04) add1(q, 0, mel + 2, "r", { grace: true, t: q * spq() - 0.07, d: 0.07 });
      add1(q, dq, mel, "r", o);
      if (r() < 0.25) add1(q, dq, mel - pick([3, 4, 5, 7, 8]), "r");
      if (r() < 0.1) add1(q, dq, mel - pick([7, 9, 12]), "r");
      if (r() < 0.02) add1(q, dq, pick([53, 55, 57]), "r"); // (a treble-staff note down by the LH)
      q += dq;
    }
    // a tie over the barline now and then: the last RH note held into the next bar
    if (r() < 0.15) {
      const last = out.filter((it) => it.hand === "r" && !it.grace && it.q + it.d / spq() > q0 + 4 - 1e-6 - 2).pop();
      if (last && Math.abs(last.q + last.d / spq() - (q0 + 4)) < 1e-6) { last.d += spq(); add1(q0 + 4, 1, last.midi, "r", { tied: true }); }
    }
    bar++;
  }
  BPM = prevBpm;
  return out;
}
const BIG = bigPiece();

function summary(items, res) {
  const s = { fingered: 0, ties: 0, wide: 0, grace: 0, moved: 0, frames: res.frames.r.length + res.frames.l.length, letA: 0, letB: 0 };
  for (const it of items) {
    const n = res.notes.get(it.id);
    if (!n) continue;
    if (/g/.test(n.x)) s.grace++; else if (/w/.test(n.x)) s.wide++; else if (/t/.test(n.x)) s.ties++; else s.fingered++;
    if (/m/.test(n.x)) s.moved++;
  }
  s.letA = [...res.debug.A.let].filter((x) => x >= 0).length;
  s.letB = res.debug.r.let.length + res.debug.l.let.length;
  return s;
}

// ---- run ----------------------------------------------------------------------------------------------
async function main() {
  ok(ALG === 1 || Number.isInteger(ALG), `ALG ${ALG}`);
  // SPANS: Balliauw et al. 2017, Tables 1, 9, 10 (the preprint, checked 2026-11-22)
  ok(SPANS.s[15].join() === "-2,0,7,10,12,14" && SPANS.m[15].join() === "-2,0,7,12,14,16" && SPANS.l[15].join() === "-2,0,7,12,16,18",
    "SPANS 1–5: small 12 / 14 (a seventh comfortable, an octave at most), medium 14 / 16, large 16 / 18");
  ok(SPANS.s[12].join() === "-7,-5,1,3,8,10" && SPANS.l[12].join() === "-10,-8,1,6,9,11" && SPANS.m[25].join() === "2,2,5,6,10,12", "SPANS: a few more cells as printed");
  const eq1 = ["s", "m", "l"].every((h) => Object.entries(SPANS[h]).every(([p, v]) => v[4] === v[5] - 2 && v[1] === v[0] + (p[0] === "1" ? 2 : 0)));
  ok(eq1, "SPANS: MaxComf = MaxPrac − 2, MinComf = MinPrac (+ 2 with the thumb) — Balliauw's Eq. 1");
  ok(keyX(60) === 70 && keyX(61) - keyX(60) === 1 && keyX(65) - keyX(64) === 2 && keyX(72) - keyX(71) === 2 && keyX(72) - keyX(60) === 14 && keyX(55) === 64 && keyX(71) === 82,
    "keyX: 14 an octave, C–C♯ 1, E–F 2, B–C 2; G3 64, B4 82");
  ok(typeof COST.LEAVE === "number" && typeof assignHands === "function" && typeof fingerHand === "function" && typeof framesOf === "function", "exports");

  const golden = fs.existsSync(GOLDEN) ? JSON.parse(fs.readFileSync(GOLDEN, "utf8")) : { alg: null, cases: {} };
  const hashes = {};
  let allBad = 0;
  for (const c of CASES) {
    for (const hand of SIZES) {
      let res;
      try { res = run(c.items, hand); } catch (e) { ok(false, `${c.name} [${hand}]: threw ${e.stack || e}`); continue; }
      const bad = invariants(c.items, res, hand);
      allBad += bad.length;
      if (bad.length) ok(false, `${c.name} [${hand}]: invariants — ${bad.slice(0, 4).join("; ")}${bad.length > 4 ? ` (+${bad.length - 4})` : ""}`);
      if (c.on.includes(hand)) for (const [cond, what] of c.check(res, hand)) ok(cond, `${c.name} [${hand}]: ${what}`);
      hashes[`${c.name} [${hand}]`] = hash(serial(res));
      if (VERBOSE) console.log(`  ${c.name} [${hand}] ${show(res, c.items)}`);
    }
  }
  ok(!allBad, `invariants on all ${CASES.length} cases × ${SIZES.length} hand sizes (span ≤ practical but w / arpeggio, fingers rising, held keys keep theirs, every note fingered or flagged, ties = their start, m only off a staff hand)`);

  // determinism: twice, and shuffled
  for (const c of [CASES.find((x) => x.name.startsWith("Amazing")), CASES.find((x) => x.name === "R6 over C2+C3"), CASES.find((x) => x.name === "6-note chord"), { name: "3000 notes", items: BIG }]) {
    const a = serial(fingerNotes(c.items, {})), b = serial(fingerNotes(c.items, {}));
    const s1 = serial(fingerNotes(shuffled(c.items, 1), {})), s2 = serial(fingerNotes(shuffled(c.items, 99).reverse(), {}));
    ok(a === b && a === s1 && a === s2, `deterministic: ${c.name} — twice, shuffled, shuffled and reversed`);
  }
  // equal-cost ties → the lower state index: the repeated note's single finger is 1 (the first state)
  {
    const it = [N("x", 0, 1, M.C4, "r")];
    ok(fingerNotes(it, {}).notes.get("x").f === 1, "a lone note: finger 1 (ties go to the lower state index)");
  }

  // 3000 notes against the clock
  {
    const t0 = performance.now();
    const first = fingerNotes(BIG, { debug: true });
    const cold = performance.now() - t0;
    const times = [];
    for (let i = 0; i < 5; i++) { const t = performance.now(); fingerNotes(BIG, {}); times.push(performance.now() - t); }
    times.sort((a, b) => a - b);
    const st = summary(BIG, first);
    const bad = invariants(BIG, first, "sb");
    ok(!bad.length, `3000 notes: invariants (${bad.slice(0, 3).join("; ")})`);
    ok(times[2] < 100, `3000 notes (${BIG.length} items, ${first.debug.A.slices.length} onsets): ${times[2].toFixed(1)} ms median of 5 warm, ${cold.toFixed(1)} ms the first (Stage A states at most ${first.debug.A.states}) — under 100 ms`);
    console.log(`  3000 notes: ${JSON.stringify(st)}`);
    hashes["3000 notes [sb]"] = hash(serial(first));
  }

  // finger-worker.js: a message in, the same result out (structured-clonable); an error answered, not thrown
  {
    const got = [];
    globalThis.self = { postMessage: (m) => got.push(structuredClone(m)) };
    await import("../public/finger-worker.js");
    const it = R6["C3"];
    self.onmessage({ data: { id: 7, items: it, hand: "sb" } });
    self.onmessage({ data: { id: 8, items: [{ get id() { throw new Error("bad item"); } }], hand: "sb" } });
    const r = got[0]?.result;
    ok(got[0]?.id === 7 && r?.notes instanceof Map && serial(r) === serial(fingerNotes(it, { hand: "sb" })) && typeof r.ms === "number", "finger-worker.js: { id, items, hand } → { id, result } (the same fingering, cloned)");
    ok(got[1]?.id === 8 && /bad item/.test(got[1]?.error) && !got[1].result, `finger-worker.js: a failure → { id, error } (${got[1]?.error})`);
    delete globalThis.self;
  }

  // a known limit, printed, not judged: an octave leap into a figure in the new position — §3's weights
  // stretch 5→1 and cross 2 over the thumb (13) rather than jump 5–5 (14: the beginner's ×2 on jumps)
  {
    const it = line("kl", "l", 0, [[M.C2, 2], [M.C3, 0.5], [M.E3, 0.5], [M.G3, 0.5], [M.E3, 0.5]]);
    console.log(`  info (not judged): LH C2 | C3 E3 G3 E3 → ${fingersOf(fingerNotes(it, {}), ids(it)).join(" ")} (a teacher's: 5 | 5 3 1 3)`);
  }

  // golden: a change in output without an ALG bump fails
  const changed = Object.keys(hashes).filter((k) => golden.cases[k] && golden.cases[k] !== hashes[k]);
  const missing = Object.keys(hashes).filter((k) => !golden.cases[k]);
  if (UPDATE) {
    if (golden.alg === ALG && changed.length) {
      ok(false, `--update refused: ${changed.length} output(s) changed under ALG ${ALG} (${changed.slice(0, 3).join(", ")}) — bump ALG in public/finger.js first`);
    } else {
      fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
      fs.writeFileSync(GOLDEN, JSON.stringify({ alg: ALG, note: "sha256[0:16] of each case's output (tools/fingercases.mjs); regenerate with --update after bumping ALG", cases: hashes }, null, 1) + "\n");
      ok(true, `golden written: ${Object.keys(hashes).length} hashes, ALG ${ALG}`);
    }
  } else if (golden.alg == null) {
    ok(false, `no golden (${path.relative(HERE, GOLDEN)}): node fingercases.mjs --update`);
  } else if (golden.alg !== ALG) {
    ok(false, `ALG is ${ALG}, the golden's ${golden.alg}: node fingercases.mjs --update`);
  } else {
    ok(!changed.length, `golden: ${Object.keys(hashes).length - missing.length} outputs as stored for ALG ${ALG}${changed.length ? ` — changed: ${changed.slice(0, 5).join(", ")}: bump ALG and --update` : ""}`);
    ok(!missing.length, `golden: every case stored${missing.length ? ` — new: ${missing.slice(0, 5).join(", ")}: --update` : ""}`);
  }

  // per-case summary
  console.log("\ncase                                   hand  notes  m  w  t  g  frames  ms");
  for (const c of CASES) {
    const res = fingerNotes(c.items, { debug: true });
    const s = summary(c.items, res);
    console.log(`${c.name.padEnd(38)} sb   ${String(c.items.length).padStart(5)} ${String(s.moved).padStart(2)} ${String(s.wide).padStart(2)} ${String(s.ties).padStart(2)} ${String(s.grace).padStart(2)} ${String(s.frames).padStart(7)} ${res.ms.toFixed(2).padStart(5)}`);
  }
  done();
}
main().catch(fail);
