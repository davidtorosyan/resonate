// Synthetic MusicXML fixtures for the Full score review fixes (playscore.cjs part E), written to
// /home/user/tools/fixtures/playscore/ (not iterated by the other suites: pv-unlisted's and
// hymn-unlisted's other views differ from v77 on purpose — the part-list order fix):
//   pv-lowbars        Finale: Voice + Piano; repeats, 1./2. endings, a double bar and the final
//                     barline written on the piano only
//   pv-lowbars-omr    Audiveris: the same bar styles on the piano only, its "endings" an 8va misread
//   pv-dupmarks       Finale: tempo, rehearsal A, segno, "Chorus", "To Coda", "D.S. al Coda", coda
//                     written in both parts (system text exported into every part)
//   pv-heading-omr    Audiveris: systems with measure widths; a "Chorus" placed below the piano's
//                     left hand (the next system's heading), a "Verse" below it in the last system,
//                     an "Interlude" above the piano
//   pvc-transpose     MuseScore: Voice + Piano + B♭ Clarinet (<transpose>), endings on every part
//   pv-unlisted       Finale: the voice's part missing from the part-list (48 bars)
//   hymn-unlisted     Finale: a hymn's SA part missing from the part-list
//   duet-2staves      Finale: one "Voices" part on two staves (her words on staff 1, his on staff 2)
//                     + a piano
//   duet-parts        Finale: Soprano and Baritone parts with words + a piano
//   satb-open         Finale: S A T B parts under a bracket (group-barline yes)
//   satbp             Finale: S A T B (bracket; the alto rests through bars 8–15) + piano
//   split-syll        Finale: the tune in a piano's right hand, its syllables split between the tune
//                     and the chord under it (The Longest Time's OCR), one sung on a beat the tune
//                     holds through
//   hymn-copy         Finale: SA on one staff, the alto with a copy of the words (moving where the
//                     soprano holds)
// usage: node playscorefixture2.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "playscore");
fs.mkdirSync(OUT, { recursive: true });

const TYPE = { 4: "whole", 3: "half", 2: "half", 1: "quarter" };
// note(pitch | null, duration in quarters, { voice, staff, chord, lyr: [[number, syllabic, text]], stem, dot })
function note(p, d, o = {}) {
  const x = ["<note>"];
  if (o.chord) x.push("<chord/>");
  if (p) {
    const m = /^([A-G])(#|b)?(\d)$/.exec(p);
    x.push(`<pitch><step>${m[1]}</step>${m[2] ? `<alter>${m[2] === "#" ? 1 : -1}</alter>` : ""}<octave>${m[3]}</octave></pitch>`);
  } else x.push(d === 4 && !o.partial ? `<rest measure="yes"/>` : "<rest/>");
  x.push(`<duration>${d}</duration><voice>${o.voice || 1}</voice><type>${TYPE[d]}</type>${d === 3 ? "<dot/>" : ""}`);
  if (p && o.stem) x.push(`<stem>${o.stem}</stem>`);
  if (o.staff) x.push(`<staff>${o.staff}</staff>`);
  for (const [n, syl, text] of o.lyr || []) x.push(`<lyric number="${n}"><syllabic>${syl}</syllabic><text>${text}</text></lyric>`);
  x.push("</note>");
  return x.join("");
}
const backup = (d) => `<backup><duration>${d}</duration></backup>`;
const dir = (inner, { placement = "above", staff = 0, extra = "" } = {}) => `<direction placement="${placement}"><direction-type>${inner}</direction-type>${staff ? `<staff>${staff}</staff>` : ""}${extra}</direction>`;
const words = (w, o) => dir(`<words>${w}</words>`, o);
const barline = (loc, inner) => `<barline location="${loc}">${inner}</barline>`;
const attrs = ({ staves = 1, clefs = [["G", 2]], key = 0, transpose = "" } = {}) =>
  `<attributes><divisions>1</divisions><key><fifths>${key}</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>` +
  (staves > 1 ? `<staves>${staves}</staves>` : "") +
  clefs.map(([s, l, oc], i) => `<clef${staves > 1 ? ` number="${i + 1}"` : ""}><sign>${s}</sign><line>${l}</line>${oc ? `<clef-octave-change>${oc}</clef-octave-change>` : ""}</clef>`).join("") + transpose + "</attributes>";
const GRAND = { staves: 2, clefs: [["G", 2], ["F", 4]] };

// part(id, measures): each measure { pre, body (notes etc., already serialised), post, width, print }
function part(id, ms) {
  return [`<part id="${id}">`, ...ms.map((m, i) => `<measure number="${i + 1}"${m.width ? ` width="${m.width}"` : ""}>${m.print || ""}${m.pre || ""}${m.body || ""}${m.post || ""}</measure>`), "</part>"].join("\n");
}
// score({ title, software, list: [{ id, name, instr, program }] (the part-list, in its order, with
// { group: "start"|"stop", number, symbol, barline } entries), parts: [xml] })
function score({ title, software, list, parts }) {
  const entry = (p) => {
    if (p.group === "start") return `<part-group type="start" number="${p.number || 1}"><group-symbol>${p.symbol}</group-symbol>${p.barline ? `<group-barline>${p.barline}</group-barline>` : ""}</part-group>`;
    if (p.group === "stop") return `<part-group type="stop" number="${p.number || 1}"/>`;
    return `<score-part id="${p.id}"><part-name>${p.name}</part-name>${p.instr ? `<score-instrument id="${p.id}-I1"><instrument-name>${p.instr}</instrument-name></score-instrument>` : ""}${p.program ? `<midi-instrument id="${p.id}-I1"><midi-program>${p.program}</midi-program></midi-instrument>` : ""}</score-part>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
<movement-title>${title}</movement-title>
<identification><encoding><software>${software}</software></encoding></identification>
<part-list>
${list.map(entry).join("\n")}
</part-list>
${parts.join("\n")}
</score-partwise>
`;
}

const TUNE = ["C5", "D5", "E5", "F5", "G5", "F5", "E5", "D5"];
const W = ["Sing", "a", "long", "line", "to", "the", "end", "now"];
const HIS = ["low", "and", "deep", "be", "low", "her", "line", "too"];
const rest = (o = {}) => note(null, 4, o);
// four sung quarters (words on verse n)
const sung = (mi, { n = 1, words = W, tune = TUNE, oct = 0, voice = 1, staff = 0 } = {}) =>
  Array.from({ length: 4 }, (_, j) => {
    const p = tune[(mi + j) % 8].replace(/\d/, (o) => String(Number(o) + oct));
    return note(p, 1, { voice, staff, lyr: [[n, "single", words[(mi * 4 + j) % 8]]] });
  }).join("");
// a piano bar: RH a whole-note triad, LH a whole note
const pianoBar = (mi, { lhRest = false } = {}) =>
  note("E4", 4, { staff: 1 }) + note("G4", 4, { staff: 1, chord: true }) + note("C5", 4, { staff: 1, chord: true }) + backup(4) +
  (lhRest ? rest({ staff: 2, voice: 5 }) : note(mi % 2 ? "G2" : "C3", 4, { staff: 2, voice: 5 }));
const PV = (software) => [{ id: "P1", name: "Voice" }, { id: "P2", name: "Piano", instr: "Piano", program: 1 }];

// ---------------------------------------------------------------- pv-lowbars(-omr)
function lowbars(omr) {
  const M = 16, v = [], pn = [];
  for (let mi = 0; mi < M; mi++) {
    v.push({ pre: mi === 0 ? attrs() : "", body: mi < 2 ? rest() : sung(mi) });
    let pre = mi === 0 ? attrs(GRAND) : "", post = "";
    if (omr) {
      if (mi === 10) pre += barline("left", `<ending number="1" type="start">1.</ending>`);
      if (mi === 11) post = barline("right", `<ending number="1" type="stop"/>`);
    } else {
      if (mi === 3) pre += barline("left", `<bar-style>heavy-light</bar-style><repeat direction="forward"/>`);
      if (mi === 6) { pre += barline("left", `<ending number="1" type="start">1.</ending>`); post = barline("right", `<bar-style>light-heavy</bar-style><ending number="1" type="stop"/><repeat direction="backward"/>`); }
      if (mi === 7) { pre += barline("left", `<ending number="2" type="start">2.</ending>`); post = barline("right", `<ending number="2" type="discontinue"/>`); }
    }
    if (mi === 9) post = barline("right", `<bar-style>light-light</bar-style>`);
    if (mi === M - 1) post = barline("right", `<bar-style>light-heavy</bar-style>`);
    pn.push({ pre, body: pianoBar(mi), post });
  }
  return score({ title: omr ? "Low Bars OMR" : "Low Bars", software: omr ? "Audiveris 5.11.0" : "Finale v27", list: PV(), parts: [part("P1", v), part("P2", pn)] });
}

// ---------------------------------------------------------------- pv-dupmarks
function dupmarks() {
  const M = 24, v = [], pn = [];
  const marks = (mi) => {
    let x = "";
    if (mi === 0) x += words("Moderately") + dir(`<metronome><beat-unit>quarter</beat-unit><per-minute>100</per-minute></metronome>`, { extra: `<sound tempo="100"/>` });
    if (mi === 4) x += dir("<rehearsal>A</rehearsal>") + dir("<segno/>");
    if (mi === 8) x += words("Chorus");
    if (mi === 12) x += words("To Coda");
    if (mi === 16) x += words("D.S. al Coda");
    if (mi === 18) x += dir("<coda/>");
    return x;
  };
  for (let mi = 0; mi < M; mi++) {
    v.push({ pre: (mi === 0 ? attrs() : "") + marks(mi), body: mi < 2 ? rest() : sung(mi) });
    pn.push({ pre: (mi === 0 ? attrs(GRAND) : "") + marks(mi), body: pianoBar(mi) });
  }
  return score({ title: "Dup Marks", software: "Finale v27", list: PV(), parts: [part("P1", v), part("P2", pn)] });
}

// ---------------------------------------------------------------- pv-heading-omr
// Systems: m0–3, m4–7, m8–11 (widths 250 for a system's first bar, 200 the others). The piano's
// "Chorus" below its left hand in m1 (x 250 across its system) is the heading of the next system,
// whose m5 ends on a double bar: it belongs over m6 (the section barline a bar from x 250).
function heading() {
  const M = 12, v = [], pn = [];
  const width = (mi) => (mi % 4 === 0 ? 250 : 200);
  const print = (mi) => (mi && mi % 4 === 0 ? `<print new-system="yes"/>` : "");
  for (let mi = 0; mi < M; mi++) {
    v.push({ width: width(mi), print: print(mi), pre: mi === 0 ? attrs() : "", body: sung(mi), post: mi === 5 ? barline("right", `<bar-style>light-light</bar-style>`) : "" });
    let pre = mi === 0 ? attrs(GRAND) : "";
    if (mi === 1) pre += words("Chorus", { placement: "below", staff: 2 });
    if (mi === 9) pre += words("Verse", { placement: "below", staff: 2 });
    if (mi === 10) pre += words("Interlude", { staff: 1 });
    pn.push({ width: width(mi), print: print(mi), pre, body: pianoBar(mi), post: mi === 5 ? barline("right", `<bar-style>light-light</bar-style>`) : "" });
  }
  return score({ title: "Heading OMR", software: "Audiveris 5.11.0", list: PV(), parts: [part("P1", v), part("P2", pn)] });
}

// ---------------------------------------------------------------- pvc-transpose
function transpose() {
  const M = 16, v = [], pn = [], cl = [];
  const ends = (mi) => {
    let pre = "", post = "";
    if (mi === 3) pre += barline("left", `<bar-style>heavy-light</bar-style><repeat direction="forward"/>`);
    if (mi === 6) { pre += barline("left", `<ending number="1" type="start">1.</ending>`); post = barline("right", `<bar-style>light-heavy</bar-style><ending number="1" type="stop"/><repeat direction="backward"/>`); }
    if (mi === 7) { pre += barline("left", `<ending number="2" type="start">2.</ending>`); post = barline("right", `<ending number="2" type="discontinue"/>`); }
    return [pre, post];
  };
  const CL = ["D5", "E5", "F#5", "G5", "A5", "B5", "C#6", "D6"];
  for (let mi = 0; mi < M; mi++) {
    const [pre, post] = ends(mi);
    v.push({ pre: (mi === 0 ? attrs() : "") + pre, body: mi < 2 ? rest() : sung(mi), post });
    pn.push({ pre: (mi === 0 ? attrs(GRAND) : "") + pre, body: pianoBar(mi), post });
    // (written a tone above, two sharps: sounds a tone lower, in C)
    cl.push({ pre: (mi === 0 ? attrs({ key: 2, transpose: "<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>" }) : "") + pre, body: note(CL[mi % 8], 2) + note(CL[(mi + 3) % 8], 2), post });
  }
  return score({
    title: "Clarinet Transposed", software: "MuseScore 4.4.2",
    list: [...PV(), { id: "P3", name: "Clarinet in B♭", instr: "Clarinet in B♭", program: 72 }],
    parts: [part("P1", v), part("P2", pn), part("P3", cl)],
  });
}

// ---------------------------------------------------------------- pv-unlisted / hymn-unlisted
function unlisted() {
  const M = 48, v = [], pn = [];
  for (let mi = 0; mi < M; mi++) {
    v.push({ pre: mi === 0 ? attrs() : "", body: mi < 2 ? rest() : sung(mi) });
    pn.push({ pre: mi === 0 ? attrs(GRAND) : "", body: pianoBar(mi) });
  }
  return score({ title: "Unlisted Voice", software: "Finale v27", list: [{ id: "P2", name: "Piano", instr: "Piano", program: 1 }], parts: [part("P1", v), part("P2", pn)] });
}
function hymnUnlisted() {
  const M = 32, sa = [], tb = [];
  for (let mi = 0; mi < M; mi++) {
    sa.push({ pre: mi === 0 ? attrs() : "", body: sung(mi) + backup(4) + note("C4", 2, { voice: 2 }) + note("E4", 2, { voice: 2 }) });
    tb.push({ pre: mi === 0 ? attrs({ clefs: [["F", 4]] }) : "", body: note("G3", 2) + note("E3", 2) + backup(4) + note("C3", 4, { voice: 2 }) });
  }
  return score({ title: "Unlisted Hymn", software: "Finale v27", list: [{ id: "P2", name: "Tenor Bass" }], parts: [part("P1", sa), part("P2", tb)] });
}

// ---------------------------------------------------------------- duets
function duet2staves() {
  const M = 16, vo = [], pn = [];
  for (let mi = 0; mi < M; mi++) {
    // her line on staff 1 (voice 1), his on staff 2 (voice 5), each with words (verse 1)
    vo.push({ pre: mi === 0 ? attrs(GRAND) : "", body: sung(mi, { staff: 1 }) + backup(4) + sung(mi, { staff: 2, voice: 5, words: HIS, oct: -2 }) });
    // (more notes than the voices: the piano)
    pn.push({ pre: mi === 0 ? attrs(GRAND) : "", body: [0, 1, 2, 3].map(() => note("E4", 1, { staff: 1 }) + note("G4", 1, { staff: 1, chord: true }) + note("C5", 1, { staff: 1, chord: true })).join("") + backup(4) + note("C3", 2, { staff: 2, voice: 5 }) + note("G3", 2, { staff: 2, voice: 5, chord: true }) + note("G2", 2, { staff: 2, voice: 5 }) + note("D3", 2, { staff: 2, voice: 5, chord: true }) });
  }
  return score({ title: "Duet Two Staves", software: "Finale v27", list: [{ id: "P1", name: "Voices" }, { id: "P2", name: "Piano", instr: "Piano", program: 1 }], parts: [part("P1", vo), part("P2", pn)] });
}
function duetParts() {
  const M = 16, s = [], b = [], pn = [];
  for (let mi = 0; mi < M; mi++) {
    s.push({ pre: mi === 0 ? attrs() : "", body: sung(mi) });
    // (his line moves in chords at the end: a divisi — top note is his line)
    b.push({ pre: mi === 0 ? attrs({ clefs: [["F", 4]] }) : "", body: sung(mi, { words: HIS, oct: -2 }) });
    pn.push({ pre: mi === 0 ? attrs(GRAND) : "", body: pianoBar(mi) });
  }
  return score({ title: "Duet Parts", software: "Finale v27", list: [{ id: "P1", name: "Soprano" }, { id: "P2", name: "Baritone" }, { id: "P3", name: "Piano", instr: "Piano", program: 1 }], parts: [part("P1", s), part("P2", b), part("P3", pn)] });
}

// ---------------------------------------------------------------- choirs
const SATB = [["S", "Soprano", [["G", 2]], 0, true], ["A", "Alto", [["G", 2]], -3, false], ["T", "Tenor", [["G", 2, -1]], -7, false], ["B", "Bass", [["F", 4]], -14, false]];
const shift = (tune, k) => tune.map((p) => { const L = "CDEFGAB", m = /^([A-G])(\d)$/.exec(p); const i = L.indexOf(m[1]) + Number(m[2]) * 7 + k; return L[((i % 7) + 7) % 7] + Math.floor(i / 7); });
function satb(withPiano) {
  const M = 24, list = [{ group: "start", number: 1, symbol: "bracket", barline: "yes" }], parts = [];
  for (const [id, name, clefs, k, words] of SATB) {
    list.push({ id, name });
    const ms = [];
    for (let mi = 0; mi < M; mi++) {
      const rests = withPiano && id === "A" && mi >= 8 && mi < 16;
      const tune = shift(TUNE, k);
      ms.push({ pre: mi === 0 ? attrs({ clefs }) : "", body: rests ? rest() : words ? sung(mi, { tune }) : tune.slice(0, 4).map((p, j) => note(tune[(mi + j) % 8], 1)).join("") });
    }
    parts.push(part(id, ms));
  }
  list.push({ group: "stop", number: 1 });
  if (withPiano) {
    list.push({ id: "PN", name: "Piano", instr: "Piano", program: 1 });
    parts.push(part("PN", Array.from({ length: M }, (_, mi) => ({ pre: mi === 0 ? attrs(GRAND) : "", body: pianoBar(mi) }))));
  }
  return score({ title: withPiano ? "SATB and Piano" : "SATB Open", software: "Finale v27", list, parts });
}

// ---------------------------------------------------------------- split-syll (the tune in the piano)
// RH voice 1 the tune, voice 2 the chord under it; verse 1's syllables split between them: a bar is
// "For" (v1, beat 1) "the" (v2, beat 2) "long-" (v1, beat 3) "-est" (v2, beat 4) over a tune of
// quarters on beats 1 and 3 held a beat each (v2 plays every beat). Bar 6: the tune holds a half
// note over beats 1–2, "won-" on it, "-der-" on v2 at beat 2 (no tune note there), "-ful" on v1 at
// beat 3.
function splitSyll() {
  const M = 12, pn = [];
  for (let mi = 0; mi < M; mi++) {
    let body;
    if (mi === 6) {
      body = note("D5", 2, { staff: 1, stem: "up", lyr: [[1, "begin", "won"]] }) + note("C5", 1, { staff: 1, stem: "up", lyr: [[1, "end", "ful"]] }) + note("B4", 1, { staff: 1, stem: "up", lyr: [[1, "single", "so"]] }) +
        backup(4) + note("G4", 1, { staff: 1, voice: 2, stem: "down" }) + note("F4", 1, { staff: 1, voice: 2, stem: "down", lyr: [[1, "middle", "der"]] }) + note("E4", 1, { staff: 1, voice: 2, stem: "down" }) + note("D4", 1, { staff: 1, voice: 2, stem: "down" });
    } else {
      body = note("D5", 1, { staff: 1, stem: "up", lyr: [[1, "single", "For"]] }) + note("D5", 1, { staff: 1, stem: "up" }) + note("E5", 1, { staff: 1, stem: "up", lyr: [[1, "begin", "long"]] }) + note("C5", 1, { staff: 1, stem: "up" }) +
        backup(4) + note("G4", 1, { staff: 1, voice: 2, stem: "down" }) + note("B4", 1, { staff: 1, voice: 2, stem: "down", lyr: [[1, "single", "the"]] }) + note("G4", 1, { staff: 1, voice: 2, stem: "down" }) + note("A4", 1, { staff: 1, voice: 2, stem: "down", lyr: [[1, "end", "est"]] });
    }
    body += backup(4) + note("C3", 2, { staff: 2, voice: 5 }) + note("G2", 2, { staff: 2, voice: 5 });
    pn.push({ pre: mi === 0 ? attrs(GRAND) : "", body });
  }
  return score({ title: "Split Syllables", software: "Finale v27", list: [{ id: "P1", name: "Piano", instr: "Piano", program: 1 }], parts: [part("P1", pn)] });
}

// ---------------------------------------------------------------- hymn-copy
// SA on one staff with the same words under both voices (as some hymnals' files carry them): the
// alto moves on beat 2 where the soprano holds a half note. Nothing moves, no hyphen changes.
function hymnCopy() {
  const M = 12, sa = [], tb = [];
  const words = [["begin", "Glo"], ["end", "ry"], ["single", "to"], ["single", "God"]];
  for (let mi = 0; mi < M; mi++) {
    const lyr = (j) => [[1, ...words[j]]];
    sa.push({ pre: mi === 0 ? attrs() : "", body:
      note("E5", 2, { stem: "up", lyr: lyr(0) }) + note("D5", 1, { stem: "up", lyr: lyr(2) }) + note("C5", 1, { stem: "up", lyr: lyr(3) }) + backup(4) +
      note("C5", 1, { voice: 2, stem: "down", lyr: lyr(0) }) + note("B4", 1, { voice: 2, stem: "down", lyr: lyr(1) }) + note("A4", 1, { voice: 2, stem: "down", lyr: lyr(2) }) + note("G4", 1, { voice: 2, stem: "down", lyr: lyr(3) }) });
    tb.push({ pre: mi === 0 ? attrs({ clefs: [["F", 4]] }) : "", body: note("G3", 2) + note("E3", 2) + backup(4) + note("C3", 4, { voice: 2 }) });
  }
  return score({ title: "Hymn Copy", software: "Finale v27", list: [{ id: "P1", name: "Soprano Alto" }, { id: "P2", name: "Tenor Bass" }], parts: [part("P1", sa), part("P2", tb)] });
}

const files = {
  "hymn-copy": hymnCopy(),
  "pv-lowbars": lowbars(false), "pv-lowbars-omr": lowbars(true), "pv-dupmarks": dupmarks(), "pv-heading-omr": heading(),
  "pvc-transpose": transpose(), "pv-unlisted": unlisted(), "hymn-unlisted": hymnUnlisted(), "duet-2staves": duet2staves(),
  "duet-parts": duetParts(), "satb-open": satb(false), "satbp": satb(true), "split-syll": splitSyll(),
};
for (const [name, xml] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name + ".musicxml"), xml);
console.log("wrote", Object.keys(files).join(", "), "to", OUT);
