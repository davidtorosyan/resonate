// Piano fingering as text for assistants (E7 stage 3, docs/FINGERING.md §4, §6): public/fingertext.js
// (the score_fingering row read_resonate fingering answers from) and scoretext.js's fingers in a
// highlight's text, on a synthetic voice-over-piano score (fixtures/finger/fingertext.musicxml: a
// fingered bar, the owner's R6 — G3 + B4 on the treble staff over C3, G3 to the left hand —, a
// 6-note chord with a key out of reach, a grace note and a tie, a bar only held). Node only: the
// MusicXML through tools/lib/minidom.mjs, the timeline from playtime.js as Play builds it.
//   A  fingerText on a hand-made fingering: every bar's text exactly, moved, wide, both fingering forms
//   B  fingerText on finger.js's own fingering (the timeline → track() → fingerNotes, as stage 2 does)
//   C  scoretext.js barsText: byte-identical without a fingering (fixtures/finger/scoretext-nofing.json,
//      written by the version before E7), the fingers with one; textLegend
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import C from "./lib/check.cjs";
import { parseXml } from "./lib/minidom.mjs";
import { timeline, track } from "../public/playtime.js";
import { barsText, TEXT_LEGEND, FINGER_LEGEND, textLegend, fingOf } from "../public/scoretext.js";
import { fingerText } from "../public/fingertext.js";
import { fingerNotes, ALG } from "../public/finger.js";

const { ok, done, fail } = C;
const FX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "finger");
const VERBOSE = !!process.env.VERBOSE;

try {
  const xml = fs.readFileSync(path.join(FX, "fingertext.musicxml"), "utf8");
  const doc = parseXml(xml);
  // the note facts Play reads (playprep noteFacts: the written spelling, the sounding MIDI number)
  const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const facts = new Map();
  for (const n of doc.getElementsByTagName("note")) {
    const p = n.getElementsByTagName("pitch")[0];
    if (!p) continue;
    const g = (t) => p.getElementsByTagName(t)[0]?.textContent.trim();
    const step = g("step"), alter = Number(g("alter") || 0), oct = Number(g("octave"));
    facts.set(n.getAttribute("id"), { step: step.toLowerCase(), alter, oct, midi: 12 * (oct + 1) + STEP[step] + alter });
  }
  const T = timeline(doc, facts);
  const numberOf = (mi) => String(mi + 1);

  // ---- A: a hand-made fingering (the song record's stored form) --------------------------------------
  // Bar 1: RH [E4 G4 C5] 1 2 5, D5 4, C5 5 / LH C3 5, E3 3. Bar 2 (R6): RH B4 5, [C5 E5] 1 3 (a new
  // position) / LH C3 5, G3 1 moved from the treble staff. Bar 3: RH C4 out of reach, D4…A4 1–5 / LH
  // C2…G2 5–1. Bar 4: a grace D5, C5 1, E5 3 tied on. Bar 5: E5 held, the LH resting.
  const fr = {
    r: [[0, 64, 67, 69, 71, 72], [4, 64, 65, 67, 69, 71], [6, 72, 74, 76, 77, 79], [8, 62, 64, 65, 67, 69], [12, 72, 74, 76, 77, 79]],
    l: [[0, 55, 53, 52, 50, 48], [8, 43, 41, 40, 38, 36], [12, 55, 53, 52, 50, 48]],
  };
  const n = {
    p1: ["r", 1, 0, ""], p2: ["r", 2, 0, ""], p3: ["r", 5, 0, ""], p4: ["r", 4, 0, ""], p5: ["r", 5, 0, ""], p6: ["l", 5, 0, ""], p7: ["l", 3, 0, ""],
    p8: ["l", 1, 0, "m"], p9: ["r", 5, 1, ""], p10: ["r", 1, 2, ""], p11: ["r", 3, 2, ""], p12: ["l", 5, 0, ""],
    p13: ["r", 0, 3, "w"], p14: ["r", 1, 3, ""], p15: ["r", 2, 3, ""], p16: ["r", 3, 3, ""], p17: ["r", 4, 3, ""], p18: ["r", 5, 3, ""],
    p19: ["l", 5, 1, ""], p20: ["l", 4, 1, ""], p21: ["l", 3, 1, ""], p22: ["l", 2, 1, ""], p23: ["l", 1, 1, ""],
    p24: ["r", 0, 4, "g"], p25: ["r", 1, 4, ""], p26: ["r", 3, 4, ""], p27: ["l", 5, 2, ""], p28: ["r", 3, 4, "t"],
  };
  const stored = { v: 1, alg: 1, hand: "sb", bpm: 90, sig: "6420:abcd1234", at: 0, n, fr };
  const data = fingerText({ fing: stored, T, numberOf, title: "Fixture", song: "s0fixture", facts, doc });
  if (VERBOSE) console.log(JSON.stringify(data, null, 1));
  const want = [
    "Bar 1 — RH: @1 [E4 G4 C5] 1 2 5 · @2.5 D5 4 · @3 C5 5 — LH: @1 C3 5 · @3 E3 3 — RH position: thumb on E4 — LH position: thumb on G3",
    "Bar 2 — RH: @1 B4 5 · @3 [C5 E5] 1 3 — LH: @1 C3 5 · @1 G3 1 (written on the treble staff) — RH positions: thumb on E4 · @3 thumb on C5 — LH position: thumb on G3",
    "Bar 3 — RH: @1 [C4 D4 E4 F4 G4 A4] – 1 2 3 4 5 (C4 out of reach) — LH: @1 [C2 D2 E2 F2 G2] 5 4 3 2 1 — RH position: thumb on D4 — LH position: thumb on G2",
    "Bar 4 — RH: @1 grace D5 – · @1 C5 1 · @3 E5 3 — LH: @1 C3 5 — RH position: thumb on C5 — LH position: thumb on G3",
    "Bar 5 — RH: held — RH position: thumb on C5",
  ];
  ok(data && data.bars.length === 5, `A every written bar (${data?.bars.length})`);
  want.forEach((w, i) => ok(data.bars[i]?.text === w, `A bar ${i + 1}: ${data.bars[i]?.text === w ? w : `\n   got  ${data.bars[i]?.text}\n   want ${w}`}`));
  ok(data.bars[1].lh === "LH: @1 C3 5 · @1 G3 1 (written on the treble staff) — LH position: thumb on G3", `A bar 2's left hand alone: ${data.bars[1].lh}`);
  ok(data.bars[1].rh === "RH: @1 B4 5 · @3 [C5 E5] 1 3 — RH positions: thumb on E4 · @3 thumb on C5", `A bar 2's right hand alone: ${data.bars[1].rh}`);
  ok(data.bars[4].rh === "RH: held — RH position: thumb on C5" && !("lh" in data.bars[4]), "A bar 5: the right hand holds, no left-hand part");
  ok(JSON.stringify(data.moved) === JSON.stringify([{ bar: "2", beat: 1, note: "G3", staff: "treble", hand: "lh", finger: 1 }]), `A moved: ${JSON.stringify(data.moved)}`);
  ok(JSON.stringify(data.wide) === JSON.stringify([{ bar: "3", beat: 1, hand: "rh", notes: ["C4"] }]), `A wide: ${JSON.stringify(data.wide)}`);
  ok(data.v === 1 && data.alg === 1 && data.hand === "sb" && data.bpm === 90 && data.sig === "6420:abcd1234" && data.song === "s0fixture" && data.title === "Fixture", "A the row's head: v, alg, hand, bpm, sig, song, title (from the stored fingering)");
  ok(!/Hey|C5 whole/.test(data.bars[0].text), "A the voice part isn't fingered");
  ok(!JSON.stringify(data).match(/\d+(\.\d+)?%/), "A no percentages");
  // the same fingering as finger.js returns it (notes a Map, frames as objects) → the same row
  const result = {
    notes: new Map(Object.entries(n).map(([id, [h, f, p, x]]) => [id, { h, f, p, x }])),
    frames: { r: fr.r.map(([q0, ...keys]) => ({ q0, keys })), l: fr.l.map(([q0, ...keys]) => ({ q0, keys })) },
    ms: 1,
  };
  const data2 = fingerText({ fing: result, T, numberOf, title: "Fixture", song: "s0fixture", facts, doc, alg: 1, hand: "sb", bpm: 90, sig: "6420:abcd1234" });
  ok(JSON.stringify(data2) === JSON.stringify(data), "A fingerNotes' form (a Map) gives the same row as the stored form");
  // no doc: the staff by the hand; no facts: names from the MIDI numbers (C major: the same here)
  const bare = fingerText({ fing: stored, T, numberOf });
  ok(bare.bars[1].text.includes("@1 G3 1 (written on the right-hand staff)") && bare.moved[0].staff === "right-hand", `A without the document: "${bare.moved[0]?.staff}"`);
  ok(bare.bars.map((b) => b.text.replace("right-hand", "treble")).join("\n") === data.bars.map((b) => b.text).join("\n"), "A without facts: the same names (C major)");
  // a sharp from the MIDI number, spelled as written from the facts
  const Tflat = { ...T, els: T.els.map((e) => (e.id === "p4" ? { ...e, midi: 75 } : e)) };
  const f3 = new Map(facts); f3.set("p4", { step: "e", alter: -1, oct: 5, midi: 75 });
  ok(fingerText({ fing: stored, T: Tflat, numberOf, facts: f3 }).bars[0].text.includes("@2.5 E♭5 4") && fingerText({ fing: stored, T: Tflat, numberOf }).bars[0].text.includes("@2.5 E♭5 4"), "A a black key: as written (facts), else from the MIDI number");
  // a key both staves strike: one key; a later finger.js ALG without the field: finger.js's
  const twin = { ...T, els: [...T.els, { ...T.els.find((e) => e.id === "p6"), id: "p6b", staff: 1 }] };
  const dt = fingerText({ fing: { ...stored, alg: undefined, n: { ...n, p6b: ["l", 5, 0, ""] } }, T: twin, numberOf, facts, doc });
  ok(dt.bars[0].text === want[0] && dt.alg === ALG, `A a unison twin listed once; alg defaults to finger.js ALG (${dt.alg})`);
  ok(fingerText({ fing: null, T, numberOf }) === null && fingerText({ fing: stored, T: null }) === null && fingerText({ fing: { nope: 1 }, T }) === null, "A no fingering or no timeline: null");
  ok(JSON.stringify(data).length < 4000, `A the row is small (${JSON.stringify(data).length} chars for 5 bars)`);

  // ---- B: finger.js's own fingering, from the timeline as stage 2 builds its items --------------------
  const piano = (e) => e.part === "P2";
  const tr = track(T, { bars: T.bars.map((_, i) => i), keep: piano, base: 90 });
  const byId = new Map(T.els.map((e) => [e.id, e]));
  const items = tr.items.map((it) => {
    const e = byId.get(it.id);
    return { id: it.id, q: it.q, t: it.sec, d: it.sound ? it.hold : it.dur, midi: it.midi, staff: e.staff, hand: e.staff === 1 ? "r" : "l",
      tied: !it.sound && !!e.tieStop && !it.grace, grace: !!it.grace, pin: 0, arp: false };
  });
  const res = fingerNotes(items, { hand: "sb" });
  const real = fingerText({ fing: res, T, numberOf, title: "Fixture", song: "s0fixture", facts, doc, bpm: 90, sig: "x" });
  if (VERBOSE) for (const b of real.bars) console.log("   " + b.text);
  ok(/LH: @1 C3 5 · @1 G3 1 \(written on the treble staff\)/.test(real.bars[1].text), `B R6: G3 to the left hand, 1, over C3 5 — ${real.bars[1].text}`);
  ok(/RH: @1 B4 \d/.test(real.bars[1].text), "B R6: B4 stays in the right hand");
  ok(real.moved.length === 1 && real.moved[0].note === "G3" && real.moved[0].hand === "lh" && real.moved[0].finger === 1 && real.moved[0].staff === "treble", `B moved: ${JSON.stringify(real.moved)}`);
  ok(real.wide.length === 1 && real.wide[0].bar === "3" && real.wide[0].notes.join() === "C4" && /\[C4 D4 E4 F4 G4 A4\] – 1 2 3 4 5 \(C4 out of reach\)/.test(real.bars[2].text), `B the 6-note chord: C4 out of reach — ${real.bars[2].text}`);
  ok(/RH: @1 grace D5 – · @1 C5 \d · @3 E5 \d/.test(real.bars[3].text), `B a grace note: no finger — ${real.bars[3].text}`);
  ok(/^Bar 5 — RH: held — RH position: thumb on /.test(real.bars[4].text), `B the tie: held, not struck again — ${real.bars[4].text}`);
  ok(real.bars.every((b) => /position/.test(b.text)), "B every bar names a position");
  const again = fingerText({ fing: fingerNotes([...items].reverse(), { hand: "sb" }), T, numberOf, title: "Fixture", song: "s0fixture", facts, doc, bpm: 90, sig: "x" });
  ok(JSON.stringify(again) === JSON.stringify(real), "B deterministic (the items in another order)");

  // ---- C: scoretext.js — byte-identical without a fingering, the fingers with one ---------------------
  const G = JSON.parse(fs.readFileSync(path.join(FX, "scoretext-nofing.json"), "utf8"));
  const chords = [{ q: 0, name: "C" }, { q: 4, name: "C" }, { q: 8, name: "Fadd9" }];
  const views = {
    all: (o) => barsText(doc, T, facts, { bars: [0, 1, 2, 3, 4], chords, number: numberOf, ...o }),
    stretch: (o) => barsText(doc, T, facts, { bars: [0, 1], chords, number: numberOf, span: { q0: 1.5, end: 6 }, ...o }),
    note: (o) => barsText(doc, T, facts, { bars: [1], chords, number: numberOf, span: { q0: 4, end: 6, ids: ["p8", "p9"] }, ...o }),
  };
  for (const [k, f] of Object.entries(views)) {
    ok(f({}) === G[k], `C ${k}: no fingering → the text before E7, byte for byte`);
    ok(f({ fing: null }) === G[k] && f({ fing: {} }) === G[k], `C ${k}: fing null / not a fingering → the same`);
    ok(f({ fing: { n: { zz: ["r", 1, 0, ""] }, fr: {} } }) === G[k], `C ${k}: a fingering of other notes → the same`);
  }
  ok(TEXT_LEGEND === G.legend && textLegend(null) === TEXT_LEGEND && textLegend(stored) === `${TEXT_LEGEND} ${FINGER_LEGEND}`, "C TEXT_LEGEND unchanged; textLegend adds the fingers' line only with a fingering");
  const withF = views.all({ fing: stored });
  if (VERBOSE) console.log(withF);
  const lines = withF.split("\n"), gl = G.all.split("\n");
  ok(lines.length === gl.length, "C with a fingering: the same lines");
  ok(lines.includes("  Piano, right hand (upper staff) [treble clef]: @1 [E4 G4 C5] dotted quarter RH 1 2 5 · @2.5 D5 eighth RH 4 · @3 C5 half RH 5"), "C bar 1's right hand: RH 1 2 5 after the value");
  ok(lines.includes("  Piano, right hand (upper staff): @1 [G3 B4] half LH 1, RH 5 · @3 [C5 E5] half RH 1 3"), "C bar 2: [G3 B4] half LH 1, RH 5 — the left hand takes G3");
  ok(lines.includes("  Piano, right hand (upper staff): @1 [C4 D4 E4 F4 G4 A4] whole RH – 1 2 3 4 5"), "C bar 3: – for the key out of reach");
  ok(lines.includes("  Piano, right hand (upper staff): @1 grace D5 RH – · @1 C5 half RH 1 · @3 E5→ half RH 3"), "C bar 4: a grace note's hand, no finger");
  ok(lines.includes("  Piano, right hand (upper staff): @1 ←E5 half RH 3 · @3 rest half"), "C bar 5: a tie's continuation shows the finger holding it, a rest nothing");
  ok(lines.filter((l) => /Voice|Chords/.test(l)).join("\n") === gl.filter((l) => /Voice|Chords/.test(l)).join("\n"), "C the voice and the chord lines: unchanged");
  const hl = views.stretch({ fing: stored }).split("\n");
  ok(hl[0] === G.stretch.split("\n")[0] && hl.includes("    outside the highlight: @1 [E4 G4 C5] dotted quarter RH 1 2 5"), "C a highlight: its first line as before, fingers on the notes in it and in the context");
  ok(views.note({ fing: result }).includes("@1 [G3 B4] half LH 1, RH 5"), "C finger.js's form (a Map) works too");
  const once = fingOf(stored);
  ok(fingOf(once) === once && once.note("p8").x === "m" && once.frames.l[0].keys[0] === 55 && fingOf(result).note("p8").h === "l", "C fingOf: both forms, and its own output as it is");
} catch (err) {
  fail(err);
}
done();
