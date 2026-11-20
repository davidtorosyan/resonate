// Synthetic MusicXML fixtures for the Play page (no licensed content), written to
// /home/user/tools/fixtures/play/:
//   synth-pvg.musicxml (+ synth-pvg.json: expected label / Some / .km / ledgers per note,
//     by part, measure, staff and order) — an Audiveris-style voice + 2-staff piano score
//   synth-longest.musicxml — one 2-staff piano part, the tune with words in staff 1 voice 1
//   synth-voice.musicxml — a voice-only lead sheet with a multi-measure rest intro
// usage: node playfixture.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "play");
fs.mkdirSync(OUT, { recursive: true });

const DIV = 12; // quarter = 12
const D = { w: 48, hd: 36, h: 24, qd: 18, q: 12, e: 6, t: 4, s: 3 };
const TYPE = { 48: ["whole"], 36: ["half", 1], 24: ["half"], 18: ["quarter", 1], 12: ["quarter"], 6: ["eighth"], 4: ["eighth"], 3: ["16th"] };
const ACCN = { 1: "sharp", "-1": "flat", 0: "natural", 2: "double-sharp", "-2": "flat-flat" };
const FL = { "-2": "𝄫", "-1": "♭", 0: "", 1: "♯", 2: "𝄪" };

// "Eb4", "F#4", "Bn4" (n = natural, alter 0), "C6"
function parsePitch(s) {
  const m = /^([A-G])(bb|##|b|#|n)?(-?\d)$/.exec(s);
  if (!m) throw new Error("pitch " + s);
  const alter = { bb: -2, "##": 2, b: -1, "#": 1, n: 0 }[m[2]] ?? 0;
  return { step: m[1], alter, oct: +m[3] };
}
const diat = (step, oct) => oct * 7 + "CDEFGAB".indexOf(step);
// Ledger lines of a written pitch in a clef (bottom line E4 in G, G2 in F).
function ledgers(step, oct, clef) {
  const bottom = clef === "F" ? diat("G", 2) : diat("E", 4), top = bottom + 8, x = diat(step, oct);
  return x < bottom ? Math.floor((bottom - x) / 2) : x > top ? Math.floor((x - top) / 2) : 0;
}

// A note spec: { p: "Eb4" | null (rest), d: duration, staff, voice, chord, acc (print the
// accidental), beam: ["begin"…], tie: "start"|"stop"|"both", lyric, tm (triplet), tup: "start"|"stop",
// stem, exp: { label, some, km } (explicit expectation), grace }
function noteXml(n, ctx) {
  const x = [];
  const attrs = n.id ? ` id="${n.id}"` : "";
  x.push(`<note${attrs}${n.dx ? ` default-x="${n.dx}"` : ""}>`);
  if (n.grace) x.push(`<grace slash="yes"/>`);
  if (n.chord) x.push("<chord/>");
  if (n.p) {
    const { step, alter, oct } = parsePitch(n.p);
    x.push(`<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${oct}</octave></pitch>`);
  } else x.push(n.measureRest ? `<rest measure="yes"/>` : "<rest/>");
  if (!n.grace) x.push(`<duration>${n.d}</duration>`);
  if (n.tie === "start" || n.tie === "both") x.push(`<tie type="start"/>`);
  if (n.tie === "stop" || n.tie === "both") x.push(`<tie type="stop"/>`);
  x.push(`<voice>${n.voice}</voice>`);
  const [type, dot] = n.grace ? ["eighth"] : TYPE[n.d] || ["quarter"];
  if (!n.measureRest) x.push(`<type>${type}</type>`);
  if (dot) x.push("<dot/>");
  if (n.acc && n.p) x.push(`<accidental>${ACCN[parsePitch(n.p).alter]}</accidental>`);
  if (n.tm) x.push(`<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>`);
  if (n.p && n.stem) x.push(`<stem>${n.stem}</stem>`);
  if (ctx.staves > 1) x.push(`<staff>${n.staff}</staff>`);
  for (const [i, b] of (n.beam || []).entries()) x.push(`<beam number="${i + 1}">${b}</beam>`);
  const no = [];
  if (n.tie === "start" || n.tie === "both") no.push(`<tied type="start"/>`);
  if (n.tie === "stop" || n.tie === "both") no.push(`<tied type="stop"/>`);
  if (n.tup) no.push(`<tuplet type="${n.tup}" bracket="no"/>`);
  if (no.length) x.push(`<notations>${no.join("")}</notations>`);
  if (n.lyric) {
    const [syl, text] = Array.isArray(n.lyric) ? n.lyric : ["single", n.lyric];
    x.push(`<lyric number="1"><syllabic>${syl}</syllabic><text>${text}</text></lyric>`);
  }
  x.push("</note>");
  return x.join("");
}

const backup = (d) => `<backup><duration>${d}</duration></backup>`;
const forward = (d, voice, staff) => `<forward><duration>${d}</duration><voice>${voice}</voice>${staff ? `<staff>${staff}</staff>` : ""}</forward>`;
const dir = (inner, staff, placement = "below") => `<direction placement="${placement}"><direction-type>${inner}</direction-type>${staff ? `<staff>${staff}</staff>` : ""}</direction>`;
const harmony = (step, alter = 0, kind = "major") =>
  `<harmony print-frame="no"><root><root-step>${step}</root-step>${alter ? `<root-alter>${alter}</root-alter>` : ""}</root><kind>${kind}</kind></harmony>`;

// ---------------------------------------------------------------- synth-pvg
// Voice P1 (lyrics) + Piano P2 (2 staves), 40 measures, E♭ major (3 flats), 4/4.
function synthPvg() {
  const M = 40;
  const KEYF = { B: -1, E: -1, A: -1 };
  const expected = [];
  // Filler: in-key notes inside the staff (no ledger lines): a key-only flat is a .km mark.
  const fill = (s, extra = {}) => {
    const { step, alter, oct } = parsePitch(s);
    if (alter !== (KEYF[step] || 0)) throw new Error("filler not in key: " + s);
    return { p: s, ...extra, filler: true };
  };
  const RHF = ["Eb4", "F4", "G4", "Ab4", "Bb4", "C5", "D5", "Eb5", "F5"];
  const LHF = ["G2", "Ab2", "Bb2", "C3", "D3", "Eb3", "F3", "G3", "Ab3"];
  const VF = ["G4", "Ab4", "Bb4", "C5", "Bb4", "Ab4", "G4", "F4", "Eb4"];
  const pick = (arr, i) => arr[((i % arr.length) + arr.length) % arr.length];
  const exp = (label, some = false, km = false) => ({ label, some, km });

  // Staff contents per measure: { s1: [[voice notes]...], s2: [...], pre1, pre2, attrs, print, post1 }
  const piano = [];
  for (let mi = 0; mi < M; mi++) {
    const m = { mi, v: {} };
    switch (mi) {
      case 0: // the designed chord E♭4 G4 B♭4 (half), then B♭4, G4 quarters
        m.v[1] = [
          { p: "Eb4", d: D.h, exp: exp("E♭", false, true), stem: "up" },
          { p: "G4", d: D.h, chord: true, exp: exp("G") },
          { p: "Bb4", d: D.h, chord: true, exp: exp("B♭", false, true) },
          fill("Bb4", { d: D.q }), fill("G4", { d: D.q }),
        ];
        m.v[5] = [fill("Eb3", { d: D.w })];
        break;
      case 1: { // eighth-note chords with <beam> on every note (Audiveris)
        const pairs = [["G4", "Bb4"], ["Ab4", "C5"], ["Bb4", "D5"], ["C5", "Eb5"], ["Bb4", "D5"], ["Ab4", "C5"], ["G4", "Bb4"], ["F4", "Ab4"]];
        const beams = ["begin", "continue", "continue", "end", "begin", "continue", "continue", "end"];
        m.v[1] = pairs.flatMap(([a, b], i) => [fill(a, { d: D.e, beam: [beams[i]], stem: "up" }), fill(b, { d: D.e, chord: true, beam: [beams[i]], stem: "up" })]);
        m.v[5] = [fill("Eb3", { d: D.h }), fill("Bb2", { d: D.h })];
        break;
      }
      case 2: { // a triplet of eighth chords, <tuplet> and <beam> on every chord note
        const tri = [["Eb4", "G4"], ["F4", "Ab4"], ["G4", "Bb4"]];
        const tb = ["begin", "continue", "end"], tt = ["start", null, "stop"];
        m.v[1] = [
          ...tri.flatMap(([a, b], i) => [
            fill(a, { d: D.t, tm: true, beam: [tb[i]], tup: tt[i], stem: "up" }),
            fill(b, { d: D.t, chord: true, tm: true, beam: [tb[i]], tup: tt[i], stem: "up" }),
          ]),
          fill("Ab4", { d: D.q }), fill("G4", { d: D.h }),
        ];
        m.v[5] = [fill("C3", { d: D.h }), fill("Ab2", { d: D.h })];
        break;
      }
      case 3: // a printed B♮, a later carried B♮; a printed F♯, carried, tied into m4
        m.v[1] = [
          { p: "Bn4", d: D.q, acc: true, exp: exp("B♮", true) },
          { p: "Bn4", d: D.q, exp: exp("B♮", true) },
          { p: "F#4", d: D.q, acc: true, exp: exp("F♯", true) },
          { p: "F#4", d: D.q, tie: "start", exp: exp("F♯", true) },
        ];
        m.v[5] = [fill("G2", { d: D.w })];
        break;
      case 4: // the tie carries F♯ over the barline; a later F is plain again
        m.v[1] = [
          { p: "F#4", d: D.q, tie: "stop", exp: exp("F♯", true) },
          { p: "F4", d: D.q, exp: exp("F") },
          { p: "Bb4", d: D.q, exp: exp("B♭", false, true) },
          { p: "G4", d: D.q, exp: exp("G") },
        ];
        m.v[5] = [fill("C3", { d: D.h }), fill("G2", { d: D.h })];
        break;
      case 5: case 6: case 7: // voices 1/2 on staff 1 and 5/6 on staff 2
        m.v[1] = ["C5", "D5", "Eb5", "F5"].map((p) => fill(p, { d: D.q, stem: "up" }));
        m.v[2] = [fill(mi === 6 ? "Ab4" : "G4", { d: D.h, stem: "down" }), fill("F4", { d: D.h, stem: "down" })];
        m.v[5] = [fill("Bb2", { d: D.h, stem: "up" }), fill("C3", { d: D.h, stem: "up" })];
        m.v[6] = [fill("G2", { d: D.w, stem: "down" })];
        break;
      case 8: // ledger lines: C6 (2), A5 (1), A♭3 (2, key flat), C4 (1); bass E♭4 (2), D4 (1), C4 (1)
        m.v[1] = [
          { p: "C6", d: D.q, exp: exp("C", true) },
          { p: "An5", d: D.q, acc: true, exp: exp("A♮", true) },
          { p: "Ab3", d: D.q, exp: exp("A♭", true) },
          { p: "C4", d: D.q, exp: exp("C") },
        ];
        m.v[5] = [
          { p: "Eb4", d: D.q, exp: exp("E♭", true) },
          { p: "D4", d: D.q, exp: exp("D") },
          { p: "C4", d: D.q, exp: exp("C") },
          { p: "G2", d: D.q, exp: exp("G") },
        ];
        break;
      case 9: // time order across voices: v2's C5 before v1's printed C♯5 is plain; v2's C♯5 after it is carried
        m.v[1] = [
          { p: "An4", d: D.q, acc: true, exp: exp("A♮", true), stem: "up" },
          { p: "Ab5", d: D.q, exp: exp("A♭", false, true), stem: "up" },
          { p: "C#5", d: D.q, acc: true, exp: exp("C♯", true), stem: "up" },
          { p: "Eb5", d: D.q, exp: exp("E♭", false, true), stem: "up" },
        ];
        m.v[2] = [
          { p: "C5", d: D.h, exp: exp("C"), stem: "down" },
          { p: null, d: D.q },
          { p: "C#5", d: D.q, exp: exp("C♯", true), stem: "down" },
        ];
        m.v[5] = [fill("Ab2", { d: D.w })];
        break;
      case 10: case 11: // an 8va: sounding C7 drawn at C6 (2 ledgers), B♭6 at B♭5 (1)
        m.v[1] = mi === 10
          ? [{ p: "C7", d: D.q, exp: exp("C", true) }, { p: "Bb6", d: D.q, exp: exp("B♭", false, true) }, { p: "G6", d: D.q, exp: exp("G") }, { p: "Eb6", d: D.q, exp: exp("E♭", false, true) }]
          : [{ p: "F6", d: D.h, exp: exp("F") }, { p: "D7", d: D.h, exp: exp("D", true) }];
        m.written = { oct: -1 }; // written an octave below sounding
        m.v[5] = [fill("Eb3", { d: D.w })];
        if (mi === 10) m.pre1 = dir(`<octave-shift type="down" size="8" number="1"/>`, 1, "above");
        else m.post1 = dir(`<octave-shift type="stop" size="8" number="1"/>`, 1, "above");
        break;
      case 12: case 13: // staff 2 in the treble clef: E♭4 (0), C4 (1), A♭3 (2), G4 (0)
        m.v[1] = [fill("Eb5", { d: D.h }), fill("D5", { d: D.h })];
        m.v[5] = mi === 12
          ? [{ p: "Eb4", d: D.q, exp: exp("E♭", false, true) }, { p: "C4", d: D.q, exp: exp("C") }, { p: "Ab3", d: D.q, exp: exp("A♭", true) }, { p: "G4", d: D.q, exp: exp("G") }]
          : [{ p: "G4", d: D.h, exp: exp("G") }, { p: "Bb4", d: D.h, exp: exp("B♭", false, true) }];
        break;
      default: {
        // filler patterns
        const k = mi % 4;
        if (k === 0) { m.v[1] = [0, 1, 2, 3].map((j) => fill(pick(RHF, mi + j), { d: D.q })); m.v[5] = [fill(pick(LHF, mi), { d: D.h }), fill(pick(LHF, mi + 2), { d: D.h })]; }
        else if (k === 1) { m.v[1] = [fill(pick(RHF, mi), { d: D.h }), fill(pick(RHF, mi + 3), { d: D.h })]; m.v[5] = [fill(pick(LHF, mi + 1), { d: D.w })]; }
        else if (k === 2) {
          const b = ["begin", "continue", "continue", "end"];
          m.v[1] = [0, 1, 2, 3].map((j) => fill(pick(RHF, mi + j), { d: D.e, beam: [b[j]] })).concat([fill(pick(RHF, mi + 4), { d: D.h })]);
          m.v[5] = [0, 1, 2, 3].map((j) => fill(pick(LHF, mi + 2 * j), { d: D.q }));
        } else { m.v[1] = [fill(pick(RHF, mi + 5), { d: D.hd }), fill(pick(RHF, mi + 1), { d: D.q })]; m.v[5] = [fill(pick(LHF, mi + 3), { d: D.hd }), fill(pick(LHF, mi), { d: D.q })]; }
      }
    }
    piano.push(m);
  }
  // The clef in force on staff 2 per measure (bass, treble from m12, bass again from m14).
  const clef2At = (mi) => (mi >= 12 && mi <= 13 ? "G" : "F");

  const voiceM = [];
  for (let mi = 0; mi < M; mi++) {
    if (mi < 2) { voiceM.push([{ p: null, d: D.w, measureRest: true, voice: 1, staff: 1 }]); continue; }
    const k = mi % 3;
    const durs = k === 0 ? [D.q, D.q, D.q, D.q] : k === 1 ? [D.h, D.q, D.q] : [D.h, D.h];
    voiceM.push(durs.map((d, j) => ({ ...fill(pick(VF, mi + j), {}), d, voice: 1, staff: 1, lyric: j === 0 ? ["begin", "la"] : j === durs.length - 1 ? ["end", "la"] : ["middle", "la"] })));
  }

  const key = `<key><fifths>-3</fifths><mode>major</mode></key>`;
  let p1 = "", p2 = "";
  for (let mi = 0; mi < M; mi++) {
    const print = mi === 0 ? "" : mi % 16 === 0 ? `<print new-page="yes"/>` : mi % 4 === 0 ? `<print new-system="yes"/>` : "";
    const restate = mi > 0 && mi % 16 === 0 ? `<attributes>${key}</attributes>` : "";
    // Voice part
    let a = `<measure number="${mi + 1}" width="220">${print}`;
    if (mi === 0) a += `<attributes><divisions>${DIV}</divisions>${key}<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><sound tempo="90"/>`;
    a += restate;
    if (mi === 4 || mi === 20) a += harmony("E", -1);
    for (const n of voiceM[mi]) {
      a += noteXml({ ...n, voice: 1 }, { staves: 1 });
      if (n.p) expected.push({ part: "P1", mi, staff: 1, label: n.exp?.label ?? expFill(n.p).label, some: false, km: n.exp?.km ?? expFill(n.p).km, ledgers: ledgers(parsePitch(n.p).step, parsePitch(n.p).oct, "G") });
    }
    p1 += a + "</measure>\n";
    // Piano part
    const m = piano[mi];
    let b = `<measure number="${mi + 1}" width="220">${print}`;
    if (mi === 0) b += `<attributes><divisions>${DIV}</divisions>${key}<time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>`;
    b += restate;
    if (mi === 12) b += `<attributes><clef number="2"><sign>G</sign><line>2</line></clef></attributes>`;
    if (mi === 14) b += `<attributes><clef number="2"><sign>F</sign><line>4</line></clef></attributes>`;
    if (mi === 4 || mi === 24) b += harmony("A", -1);
    const emit = (notes, voice, staff) => {
      let s = "";
      for (const n of notes) {
        const nn = { ...n, voice, staff };
        s += noteXml(nn, { staves: 2 });
        if (n.p) {
          const { step, oct } = parsePitch(n.p);
          const wOct = oct + (m.written?.oct && staff === 1 ? m.written.oct : 0);
          const clef = staff === 1 ? "G" : clef2At(mi);
          const e = n.exp || expFill(n.p);
          expected.push({ part: "P2", mi, staff, label: e.label, some: e.some, km: e.km, ledgers: ledgers(step, wOct, clef), p: n.p });
        }
      }
      return s;
    };
    // Directions: an unclosed crescendo at m20, a closed one m22–m23.
    if (mi === 20) b += dir(`<wedge type="crescendo" number="1" spread="0"/>`, 1);
    if (mi === 22) b += dir(`<wedge type="diminuendo" number="1" spread="15"/>`, 1);
    if (m.pre1) b += m.pre1;
    b += emit(m.v[1], "1", 1);
    if (mi === 23) b += dir(`<wedge type="stop" number="1" spread="0"/>`, 1);
    if (m.post1) b += m.post1;
    if (m.v[2]) { b += backup(D.w) + emit(m.v[2], "2", 1); }
    b += backup(D.w);
    if (mi === 30) b += dir(`<dynamics><p/></dynamics>`, 2);
    b += emit(m.v[5], "5", 2);
    if (m.v[6]) { b += backup(D.w) + emit(m.v[6], "6", 2); }
    if (mi === M - 1) b += `<barline location="right"><bar-style>light-heavy</bar-style></barline>`;
    p2 += b + "</measure>\n";
  }
  function expFill(p) {
    const { step, alter } = parsePitch(p);
    return { label: step + FL[alter], some: false, km: alter !== 0 };
  }
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
<work><work-title>Synth PVG</work-title></work>
<movement-title>x F )</movement-title>
<identification><encoding><software>Audiveris 5.11.0</software><software>ProxyMusic 4.0.3</software><encoding-date>2026-11-16</encoding-date></encoding></identification>
<defaults><scaling><millimeters>7</millimeters><tenths>40</tenths></scaling></defaults>
<credit page="1"><credit-type>title</credit-type><credit-words default-x="600" default-y="1500" font-size="24" justify="center">Synth PVG</credit-words></credit>
<credit page="1"><credit-words default-x="100" default-y="100" font-size="8">Authorized for use by: Test Person</credit-words></credit>
<credit page="1"><credit-words default-x="300" default-y="1300" font-size="10">Blzmaj7</credit-words></credit>
<part-list>
<score-part id="P1"><part-name>Voice</part-name><score-instrument id="P1-I1"><instrument-name>Voice Oohs</instrument-name></score-instrument><midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>54</midi-program></midi-instrument></score-part>
<score-part id="P2"><part-name>Piano</part-name><score-instrument id="P2-I1"><instrument-name>Acoustic Grand Piano</instrument-name></score-instrument><midi-instrument id="P2-I1"><midi-channel>2</midi-channel><midi-program>1</midi-program></midi-instrument></score-part>
</part-list>
<part id="P1">
${p1}</part>
<part id="P2">
${p2}</part>
</score-partwise>
`;
  // order within (part, mi, staff), document order
  const seen = {};
  for (const e of expected) { const k = `${e.part}|${e.mi}|${e.staff}`; e.k = seen[k] = (seen[k] ?? -1) + 1; }
  const side = {
    notes: expected,
    peekChord: { part: "P2", mi: 0, staff: 1, k: [0, 1, 2], names: "E♭4 G4 B♭4", midis: [63, 67, 70] },
    unclosedWedge: { part: "P2", mi: 20 }, closedWedge: { part: "P2", from: 22, to: 23 },
    restatedKeys: [16, 32], clefChange: { staff: 2, treble: [12, 13] }, octave: { staff: 1, from: 10, to: 11 },
    harmony: 4, credits: 3, measures: M,
  };
  return { xml, side };
}

// ---------------------------------------------------------------- synth-longest
// One 2-staff piano part: the tune with words in staff 1 voice 1 (with gaps filled by
// <forward>), chords in voice 2 under it (a few syllables recognition put on them), LH in voice 5.
function synthLongest() {
  const M = 16;
  const tune = ["F#5", "E5", "D5", "A4", "B4", "C#5", "D5", "E5"];
  let body = "";
  const words = ["Once", "I", "thought", "my", "in-", "no-", "cence", "was", "gone", "now", "I", "know", "that", "hap-", "pi-", "ness"];
  let w = 0, orphanLyric = null;
  for (let mi = 0; mi < M; mi++) {
    let b = `<measure number="${mi + 1}">`;
    if (mi === 0) b += `<attributes><divisions>${DIV}</divisions><key><fifths>2</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>`;
    if (mi % 2 === 0) b += harmony("D");
    const t = (j) => tune[(mi * 2 + j) % tune.length];
    const lyr = () => { const s = words[w++ % words.length]; return s.endsWith("-") ? ["begin", s.slice(0, -1)] : ["single", s]; };
    // voice 1: quarter, quarter, (gap of a quarter via <forward>), quarter — or a half then quarters
    const orphanAt = mi % 4 === 1; // the 2nd beat's syllable lands on voice 2's chord
    if (mi % 3 === 2) {
      b += noteXml({ p: t(0), d: D.h, voice: "1", staff: 1, stem: "up", lyric: lyr() }, { staves: 2 });
      b += noteXml({ p: t(1), d: D.h, voice: "1", staff: 1, stem: "up", lyric: lyr() }, { staves: 2 });
    } else {
      const l0 = lyr(), l1 = lyr(), l3 = lyr(); // in time order; beat 2's may sit on voice 2's chord
      if (orphanAt) orphanLyric = l1;
      b += noteXml({ p: t(0), d: D.q, voice: "1", staff: 1, stem: "up", lyric: l0 }, { staves: 2 });
      b += noteXml({ p: t(1), d: D.q, voice: "1", staff: 1, stem: "up", lyric: orphanAt ? null : l1 }, { staves: 2 });
      b += forward(D.q, "1", 1);
      b += noteXml({ p: t(2), d: D.q, voice: "1", staff: 1, stem: "up", lyric: l3 }, { staves: 2 });
    }
    b += backup(D.w);
    // voice 2: chords on beats 1–4 (quarters), D4 F#4 A4 / E4 G4 B4
    for (let j = 0; j < 4; j++) {
      const ch = (mi + j) % 2 ? ["E4", "G4", "B4"] : ["D4", "F#4", "A4"];
      const ly = orphanAt && j === 1 ? orphanLyric : null;
      ch.forEach((p, k) => { b += noteXml({ p, d: D.q, voice: "2", staff: 1, chord: k > 0, stem: "down", lyric: k === 0 ? ly : null }, { staves: 2 }); });
    }
    b += backup(D.w);
    // voice 5: bass half notes
    b += noteXml({ p: mi % 2 ? "A2" : "D3", d: D.h, voice: "5", staff: 2 }, { staves: 2 });
    b += noteXml({ p: mi % 2 ? "E3" : "A2", d: D.h, voice: "5", staff: 2 }, { staves: 2 });
    if (mi === M - 1) b += `<barline location="right"><bar-style>light-heavy</bar-style></barline>`;
    body += b + "</measure>\n";
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
<work><work-title>Synth Longest</work-title></work>
<identification><encoding><software>Synth</software></encoding></identification>
<part-list><score-part id="P1"><part-name>Piano</part-name><score-instrument id="P1-I1"><instrument-name>Acoustic Grand Piano</instrument-name></score-instrument><midi-instrument id="P1-I1"><midi-program>1</midi-program></midi-instrument></score-part></part-list>
<part id="P1">
${body}</part>
</score-partwise>
`;
}

// ---------------------------------------------------------------- synth-voice
// A voice-only lead sheet: F major, 3/4, a 4-bar multi-measure rest intro, chord symbols, words.
function synthVoice() {
  const M = 16;
  const tune = ["F4", "G4", "A4", "Bb4", "C5", "D5", "C5", "A4", "G4", "F4", "E4", "F4"];
  let body = "";
  for (let mi = 0; mi < M; mi++) {
    let b = `<measure number="${mi + 1}">`;
    if (mi === 0) b += `<attributes><divisions>${DIV}</divisions><key><fifths>-1</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef><measure-style><multiple-rest>4</multiple-rest></measure-style></attributes>`;
    if (mi < 4) { b += noteXml({ p: null, d: D.hd, voice: "1", staff: 1, measureRest: true }, { staves: 1 }); body += b + "</measure>\n"; continue; }
    b += harmony(mi % 2 ? "C" : "F", 0, mi % 2 ? "dominant" : "major");
    const t = (j) => tune[(mi * 2 + j) % tune.length];
    if (mi % 4 === 3) b += noteXml({ p: t(0), d: D.hd, voice: "1", staff: 1, lyric: ["single", "home"] }, { staves: 1 });
    else {
      b += noteXml({ p: t(0), d: D.h, voice: "1", staff: 1, lyric: ["begin", "Sun"] }, { staves: 1 });
      b += noteXml({ p: mi === 9 ? "B4" : t(1), d: D.q, voice: "1", staff: 1, acc: mi === 9, lyric: ["end", "shine"] }, { staves: 1 });
    }
    if (mi === M - 1) b += `<barline location="right"><bar-style>light-heavy</bar-style></barline>`;
    body += b + "</measure>\n";
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
<work><work-title>Synth Voice</work-title></work>
<identification><encoding><software>Synth</software></encoding></identification>
<part-list><score-part id="P1"><part-name>Voice</part-name><score-instrument id="P1-I1"><instrument-name>Voice</instrument-name></score-instrument><midi-instrument id="P1-I1"><midi-program>53</midi-program></midi-instrument></score-part></part-list>
<part id="P1">
${body}</part>
</score-partwise>
`;
}

const pvg = synthPvg();
fs.writeFileSync(path.join(OUT, "synth-pvg.musicxml"), pvg.xml);
fs.writeFileSync(path.join(OUT, "synth-pvg.json"), JSON.stringify(pvg.side, null, 1));
fs.writeFileSync(path.join(OUT, "synth-longest.musicxml"), synthLongest());
fs.writeFileSync(path.join(OUT, "synth-voice.musicxml"), synthVoice());
console.log("wrote", fs.readdirSync(OUT).join(", "), "to", OUT, "·", pvg.side.notes.length, "expected notes");
