// Play page: checks for the fixes from the adversarial review (Nov 2026). Each would fail on the
// code before the fix. Chromium; synthetic scores written here (no licensed music); the owner's
// converted scores (PLAY_SCORES) add their own cases when present.
//
//   U  prep + Verovio (playprep.js / playnames.js / fixscore.js in a page of the site):
//      endings, D.S./To Coda, tempo and section marks from the top part · ties written start-
//      before-stop · tuplet marks · a multi-rest over notes, no part-list, an unlisted part ·
//      slurs / beams cut by one-hand views · a hymn's stanzas in Melody · a bar with two keys ·
//      cross-staff ledgers · the key mark at its head · Some's floor · a pill clear of its printed
//      accidental, no black ring · C+C♯+D letters
//      (second round) beams cut only where a filter cut them (grace notes, "begin" inside a group) ·
//      a transposing part in a remote sounding key named as drawn · a dropped restated key isn't the
//      bar's first · quarter- next to eighth-triplets · a unison head named for both voices · Some's
//      floor by the score's time (a second on the far side of the stem) · key marks clear of
//      accidentals, barlines, ties, heads
//   P  play.html: a menu closed with no pick doesn't eat the pedal · My songs failing to open
//      keeps the records · a song keeps its level · a failed view then rotation · a PDF page that
//      can't be read · the PDF's worker freed · landscape default size · a one-page view in a
//      spread · the PDF spread on an 11" iPad · the bar stays one row with the chip · nothing of
//      the sheet shows around the PDF
//      (second round) positioned rests stay on their staff (transposeToSoundingPitch only for a
//      transposing view) · the engine loads after a failed download · the landscape size a step
// usage: node playfixes.cjs   (BASE=http://localhost:8097/resonate/, PLAY_SCORES=<dir>, ONLY=U,P1,…)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { pdfmini } = require("./pdfmini.cjs");
const BASE = process.env.BASE || "http://localhost:8097/resonate/";
const SCRATCH = "/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad";
const SCORES = process.env.PLAY_SCORES ?? path.join(SCRATCH, "play/scores");
const FIX = path.join(__dirname, "fixtures/play");
const SHOTS = process.env.SHOTS || path.join(SCRATCH, "playshots");
fs.mkdirSync(SHOTS, { recursive: true });

const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) passes++; else { fails++; console.log("FAIL", msg); } };
const read = (f) => fs.readFileSync(f, "utf8");

// ---- synthetic scores --------------------------------------------------------------------------
const HEAD = (parts, omr = false) => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1"><work><work-title>Fix test</work-title></work>${omr ? "<identification><encoding><software>Audiveris 5.4</software></encoding></identification>" : ""}
<part-list>${parts.map((p) => `<score-part id="${p}"><part-name>${p === "P2" ? "Piano" : "Voice"}</part-name></score-part>`).join("")}</part-list>`;
// a note: n("C5", 1, { staff, voice, type, chord, lyric, … extra xml })
const n = (p, dur, o = {}) => {
  const m = /^([A-G])(#|b)?(\d)$/.exec(p);
  const alter = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  const type = o.type || { 1: "quarter", 2: "half", 4: "whole", 0.5: "eighth" }[dur] || "quarter";
  return `<note>${o.chord ? "<chord/>" : ""}<pitch><step>${m[1]}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${m[3]}</octave></pitch><duration>${o.d ?? dur}</duration>${o.tie || ""}<voice>${o.voice || 1}</voice><type>${type}</type>${o.acc ? `<accidental>${o.acc}</accidental>` : ""}${o.tm || ""}${o.staff ? `<staff>${o.staff}</staff>` : ""}${o.beam ? `<beam number="1">${o.beam}</beam>` : ""}${o.not ? `<notations>${o.not}</notations>` : ""}${o.lyric ? [].concat(o.lyric).map((t, i) => `<lyric number="${i + 1}"><syllable>single</syllable><text>${t}</text></lyric>`).join("") : ""}</note>`;
};
const ATTR = (o = {}) => `<attributes><divisions>${o.div || 1}</divisions><key><fifths>${o.fifths || 0}</fifths></key><time><beats>${o.beats || 4}</beats><beat-type>4</beat-type></time>${o.staves ? `<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>` : `<clef><sign>G</sign><line>2</line></clef>`}</attributes>`;
const back = (d) => `<backup><duration>${d}</duration></backup>`;

// Voice (P1) with endings, To Coda, D.S. and a tempo; piano (P2) with a misread ending, "Verse" on
// staff 1 and "rit." on staff 2.
const MARKS = HEAD(["P1", "P2"], true) + `
<part id="P1">
<measure number="1">${ATTR()}<direction placement="above"><direction-type><words>Moderately</words></direction-type><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>100</per-minute></metronome></direction-type><sound tempo="100"/></direction>${n("C5", 4, { lyric: "Ah" })}</measure>
<measure number="2"><barline location="left"><ending number="1" type="start"/></barline>${n("D5", 1, { lyric: "la" })}${n("E5", 1, { lyric: "la" })}<direction placement="above"><direction-type><words>To Coda</words></direction-type></direction>${n("F5", 2, { lyric: "la" })}</measure>
<measure number="3">${n("G5", 4, { lyric: "la" })}<barline location="right"><bar-style>light-heavy</bar-style><ending number="1" type="stop"/><repeat direction="backward"/></barline></measure>
<measure number="4"><barline location="left"><ending number="2" type="start"/></barline>${n("C5", 4, { lyric: "oh" })}<direction placement="above"><direction-type><words>D.S. al Coda</words></direction-type></direction><barline location="right"><ending number="2" type="discontinue"/></barline></measure>
</part>
<part id="P2">
<measure number="1">${ATTR({ staves: true })}<barline location="left"><ending number="1" type="start"/></barline>${n("C4", 4, { staff: 1 })}${back(4)}${n("C3", 4, { staff: 2, voice: 5 })}</measure>
<measure number="2"><direction placement="above"><direction-type><words>Verse</words></direction-type><staff>1</staff></direction>${n("D4", 4, { staff: 1 })}${back(4)}${n("D3", 4, { staff: 2, voice: 5 })}</measure>
<measure number="3">${n("E4", 4, { staff: 1 })}${back(4)}<direction placement="below"><direction-type><words>rit.</words></direction-type><staff>2</staff></direction>${n("E3", 4, { staff: 2, voice: 5 })}<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline></measure>
<measure number="4">${n("C4", 4, { staff: 1 })}${back(4)}${n("C3", 4, { staff: 2, voice: 5 })}</measure>
</part></score-partwise>`;

// A held chord tied in and out, Audiveris's order (start before stop) on the middle one.
const TIES = HEAD(["P1"]) + `<part id="P1">
<measure number="1">${ATTR()}${n("C5", 2, { tie: '<tie type="start"/>', not: '<tied type="start"/>' })}${n("C5", 2, { tie: '<tie type="start"/><tie type="stop"/>', not: '<tied type="start"/><tied type="stop"/>' })}</measure>
<measure number="2">${n("C5", 4, { tie: '<tie type="stop"/>', not: '<tied type="stop"/>' })}</measure></part></score-partwise>`;

// 3/4: four quarters (an unmarked quadruplet) and two triplets of eighths with time-modification
// but no tuplet marks.
const TUP3 = '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>';
const TUPLETS = HEAD(["P1"], true) + `<part id="P1">
<measure number="1">${ATTR({ beats: 3 })}${n("C5", 1, { lyric: "I'm" })}${n("D5", 1, { lyric: "a" })}${n("E5", 1, { lyric: "bu" })}${n("F5", 1, { lyric: "sy" })}</measure>
<measure number="2"><attributes><divisions>6</divisions></attributes>${["C5", "D5", "E5", "F5", "G5", "A5"].map((p) => n(p, 2, { type: "eighth", tm: TUP3 })).join("")}${n("G5", 6, { type: "half" })}</measure>
</part></score-partwise>`;

const PIANO1 = (body, { list = true, id = "P1" } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">${list ? `<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>` : ""}<part id="${id}">${body}</part></score-partwise>`;
const TWO_BARS = `<measure number="1">${ATTR({ staves: true })}${n("C5", 2, { staff: 1 })}${n("E5", 2, { staff: 1 })}${back(4)}${n("C3", 4, { staff: 2, voice: 5 })}</measure>
<measure number="2">${n("G4", 4, { staff: 1 })}${back(4)}${n("G2", 4, { staff: 2, voice: 5 })}</measure>`;
// a multi-measure rest written over bars that have notes
const MULTI = PIANO1(`<measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef><measure-style><multiple-rest>3</multiple-rest></measure-style></attributes>${n("C5", 4, { staff: 1 })}${back(4)}${n("C3", 4, { staff: 2, voice: 5 })}</measure>
<measure number="2">${n("D5", 4, { staff: 1 })}${back(4)}${n("D3", 4, { staff: 2, voice: 5 })}</measure>
<measure number="3">${n("E5", 4, { staff: 1 })}${back(4)}${n("E3", 4, { staff: 2, voice: 5 })}</measure>`);

// One figure across both staves: voice 1's four beamed eighths start on the bass staff; a slur from
// that note to the next (cross-staff) and one inside the treble staff.
const CROSS = PIANO1(`<measure number="1">${ATTR({ staves: true })}${n("C3", 0.5, { d: 1, type: "eighth", staff: 2, beam: "begin", not: '<slur number="1" type="start"/>' })}${n("E4", 0.5, { d: 1, type: "eighth", staff: 1, beam: "continue", not: '<slur number="1" type="stop"/>' })}${n("G4", 0.5, { d: 1, type: "eighth", staff: 1, beam: "continue", not: '<slur number="1" type="start"/>' })}${n("C5", 0.5, { d: 1, type: "eighth", staff: 1, beam: "end", not: '<slur number="1" type="stop"/>' })}${n("E5", 2, { d: 4, staff: 1 })}${back(8)}${n("C2", 4, { d: 8, staff: 2, voice: 5 })}</measure>`.replace("<divisions>1</divisions>", "<divisions>2</divisions>"));

// Cross-staff notes in voice 1 (written <staff>2</staff>) among treble notes: no ledgers counted
// against the treble staff.
const XSTAFF = PIANO1(`<measure number="1">${ATTR({ staves: true })}${n("C5", 1, { staff: 1 })}${n("A2", 1, { staff: 2 })}${n("C3", 1, { staff: 2 })}${n("E5", 1, { staff: 1 })}${back(4)}${n("C2", 4, { staff: 2, voice: 5 })}</measure>`);

// A voice-only song: three stanzas stacked (a hymn) / two verses (a song's second pass).
const VERSES = (k) => HEAD(["P1"]) + `<part id="P1"><measure number="1">${ATTR()}${["C5", "D5", "E5", "F5"].map((p, i) => n(p, 1, { lyric: Array.from({ length: k }, (_, v) => `v${v + 1}s${i}`) })).join("")}</measure>
<measure number="2">${n("G5", 4, { lyric: Array.from({ length: k }, (_, v) => `v${v + 1}e`) })}</measure></part></score-partwise>`;

// C4 + C♯4 + D4 (and E♭–G–B♭ chords in a flat key for the key marks)
const CLUSTER = PIANO1(`<measure number="1">${ATTR({ staves: true, fifths: -3 })}${n("C4", 2, { staff: 1 })}${n("C#4", 2, { staff: 1, chord: true, acc: "sharp" })}${n("D4", 2, { staff: 1, chord: true })}${n("Eb4", 2, { staff: 1 })}${n("G4", 2, { staff: 1, chord: true })}${n("Bb4", 2, { staff: 1, chord: true })}${back(4)}${n("Eb3", 2, { staff: 2, voice: 5 })}${n("G3", 2, { staff: 2, voice: 5, chord: true })}${n("Bb3", 2, { staff: 2, voice: 5, chord: true })}${n("Ab2", 2, { staff: 2, voice: 5 })}${n("C3", 2, { staff: 2, voice: 5, chord: true })}${n("Eb3", 2, { staff: 2, voice: 5, chord: true })}</measure>
<measure number="2">${n("B4", 1, { staff: 1, acc: "natural" })}${n("F#4", 1, { staff: 1, acc: "sharp" })}${n("Ab4", 2, { staff: 1 })}${back(4)}${n("Bb2", 4, { staff: 2, voice: 5 })}</measure>`);

// A transposing part on its own (a lead sheet for B♭ clarinet …): written notes [pitch, printed
// accidental] → the sounding MIDI a pianist plays.
const TRANSP = (name, tr, fifths, notes) => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1"><part-list><score-part id="P1"><part-name>${name}</part-name></score-part></part-list><part id="P1">
<measure number="1"><attributes><divisions>1</divisions><key><fifths>${fifths}</fifths></key><time><beats>${notes.length}</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef><transpose>${tr}</transpose></attributes>${notes.map(([p, acc]) => n(p, 1, { acc })).join("")}</measure></part></score-partwise>`;
const TRANSPOSING = [
  // B♭ clarinet in D: D5, a printed E♯5, F♯5 from the key, a printed C♮5 → C5, D♯5, E5, B♭4
  ["clarinet", TRANSP("Clarinet in Bb", "<diatonic>-1</diatonic><chromatic>-2</chromatic>", 2, [["D5"], ["E#5", "sharp"], ["F#5"], ["C5", "natural"]]), [72, 75, 76, 70]],
  // F horn in G: a printed F♮5, G5, a printed F♯5 → B♭4, C5, B♮4
  ["horn", TRANSP("Horn in F", "<diatonic>-4</diatonic><chromatic>-7</chromatic>", 1, [["F5", "natural"], ["G5"], ["F#5", "sharp"]]), [70, 72, 71]],
  // E♭ alto sax in A: A5, C♯5 from the key, a printed G♮5 → C5, E4, B♭4
  ["alto", TRANSP("Alto Saxophone", "<diatonic>-5</diatonic><chromatic>-9</chromatic>", 3, [["A5"], ["C#5"], ["G5", "natural"]]), [72, 64, 70]],
  // guitar an octave down: E5, G5 → E4, G4
  ["guitar", TRANSP("Guitar", "<diatonic>0</diatonic><chromatic>0</chromatic><octave-change>-1</octave-change>", 0, [["E5"], ["G5"]]), [64, 67]],
  // remote sounding keys Verovio respells: alto sax in written E♭ (sounds G♭ major, drawn F♯ major)
  // E♭5 F5 G5 A♭5 → G♭4 A♭4 B♭4 C♭5; A clarinet in written A (sounds F♯ major, drawn G♭ major)
  ["alto in E♭", TRANSP("Alto Saxophone", "<diatonic>-5</diatonic><chromatic>-9</chromatic>", -3, [["Eb5"], ["F5"], ["G5"], ["Ab5"]]), [66, 68, 70, 71]],
  ["A clarinet in A", TRANSP("Clarinet in A", "<diatonic>-2</diatonic><chromatic>-3</chromatic>", 3, [["A5"], ["C#5"], ["F#5"], ["G#5"]]), [78, 70, 75, 77]],
];

// A piano's right hand: four beamed eighths with an unbeamed grace note before the 2nd (bar 1), two
// beamed grace 16ths before the 2nd (bar 2); bar 3 as Audiveris writes an eighth and two 16ths
// (a "begin" on the 16ths while the eighth's group is open). The left hand: whole notes.
const gr = (p, beam = "") => { const m = /^([A-G])(\d)$/.exec(p); return `<note><grace/><pitch><step>${m[1]}</step><octave>${m[2]}</octave></pitch><voice>1</voice><type>16th</type><staff>1</staff>${beam}</note>`; };
const nb = (p, dur, type, beams) => { const m = /^([A-G])(\d)$/.exec(p); return `<note><pitch><step>${m[1]}</step><octave>${m[2]}</octave></pitch><duration>${dur}</duration><voice>1</voice><type>${type}</type><staff>1</staff>${beams.map((b, i) => `<beam number="${i + 1}">${b}</beam>`).join("")}</note>`; };
const LH16 = `${back(16)}${n("C3", 4, { d: 16, type: "whole", staff: 2, voice: 5 })}`;
const GRACE = PIANO1(`<measure number="1">${ATTR({ staves: true }).replace("<divisions>1</divisions>", "<divisions>4</divisions>")}${nb("C5", 2, "eighth", ["begin"])}${gr("D5")}${nb("E5", 2, "eighth", ["continue"])}${nb("F5", 2, "eighth", ["continue"])}${nb("G5", 2, "eighth", ["end"])}${nb("A5", 8, "half", [])}${LH16}</measure>
<measure number="2">${nb("C5", 2, "eighth", ["begin"])}${gr("D5", '<beam number="1">begin</beam><beam number="2">begin</beam>')}${gr("E5", '<beam number="1">end</beam><beam number="2">end</beam>')}${nb("E5", 2, "eighth", ["continue"])}${nb("F5", 2, "eighth", ["continue"])}${nb("G5", 2, "eighth", ["end"])}${nb("A5", 8, "half", [])}${LH16}</measure>
<measure number="3">${nb("C5", 2, "eighth", ["begin"])}${nb("D5", 1, "16th", ["begin", "begin"])}${nb("E5", 1, "16th", ["end", "end"])}${nb("A5", 12, "half", []).replace("<type>half</type>", "<type>half</type><dot/>")}${LH16}</measure>`);

// A key restated at a bar's start (fixOmrScore at a page start) with a change mid-bar, the next
// barline restating the new key: drawn once, at bar 2.
const MIDKEY = PIANO1(`<measure number="1">${ATTR({ staves: true })}${n("G5", 4, { staff: 1 })}${back(4)}${n("G2", 4, { staff: 2, voice: 5 })}</measure>
<measure number="2"><attributes><key><fifths>0</fifths></key></attributes>${n("E5", 1, { staff: 1 })}${n("B4", 1, { staff: 1 })}<attributes><key><fifths>2</fifths></key></attributes>${n("F#5", 1, { staff: 1 })}${n("C#5", 1, { staff: 1 })}${back(4)}${n("D3", 4, { staff: 2, voice: 5 })}</measure>
<measure number="3"><attributes><key><fifths>2</fifths></key></attributes>${n("F#5", 4, { staff: 1 })}${back(4)}${n("D3", 4, { staff: 2, voice: 5 })}</measure>`);

// 4/4, divisions 6, no tuplet marks: three quarter-triplets then three eighth-triplets (bar 1), the
// other way round (bar 2) — each its own group of three.
const TQ = '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>';
const MIXTUP = HEAD(["P1"], true) + `<part id="P1">
<measure number="1">${ATTR().replace("<divisions>1</divisions>", "<divisions>6</divisions>")}${["C5", "D5", "E5"].map((p) => n(p, 4, { type: "quarter", tm: TQ })).join("")}${["F5", "G5", "A5"].map((p) => n(p, 2, { type: "eighth", tm: TQ })).join("")}${n("B4", 6, { type: "quarter" })}</measure>
<measure number="2">${["C5", "D5", "E5"].map((p) => n(p, 2, { type: "eighth", tm: TQ })).join("")}${["F5", "G5", "A5"].map((p) => n(p, 4, { type: "quarter", tm: TQ })).join("")}${n("B4", 6, { type: "quarter" })}</measure>
</part></score-partwise>`;

// A bare page (no accidentals, no ledger notes): each bar's first chord E4 G4 C5 D5 (the D5 or
// the C5 pushed to the other side of the stem), then E4; the left hand a whole C3.
const SECONDS = PIANO1([1, 2, 3, 4].map((k) => `<measure number="${k}">${k === 1 ? ATTR({ staves: true }) : ""}${n("E4", 2, { staff: 1 })}${n("G4", 2, { staff: 1, chord: true })}${n("C5", 2, { staff: 1, chord: true })}${n("D5", 2, { staff: 1, chord: true })}${n("E4", 2, { staff: 1 })}${back(4)}${n("C3", 4, { staff: 2, voice: 5 })}</measure>`).join(""));

// A damaged PDF: page `which`'s reference in /Kids replaced by a number of the same length.
function damaged(which) {
  let s = pdfmini(3).toString("latin1");
  const m = s.match(/\/Kids \[(\d+) 0 R (\d+) 0 R (\d+) 0 R\]/);
  const ref = m[which] + " 0 R";
  s = s.replace(m[0], m[0].replace(ref, ("4" + "2".repeat(ref.length - 1)).slice(0, ref.length)));
  return Buffer.from(s, "latin1");
}

// ---- in-page helpers ---------------------------------------------------------------------------
// Load the page's modules and Verovio in a page of the site; → per view: MEI facts and the log.
async function boot(page) {
  await page.goto(BASE + "tools.html");
  await page.evaluate(async () => {
    window.prep = await import("./playprep.js?v=76");
    window.names = await import("./playnames.js?v=76");
    window.fix = await import("./omr/fixscore.js?v=76");
    const V = "./vendor/verovio-6.4.0/";
    const [{ default: c }, { VerovioToolkit }] = await Promise.all([import(V + "verovio-module.mjs"), import(V + "verovio.mjs")]);
    window.tk = new VerovioToolkit(await c());
    // the page's own options (play.js VRV)
    window.VRVOPT = { header: "none", footer: "none", breaks: "auto", mnumInterval: 0, adjustPageHeight: false,
      svgAdditionalAttribute: ["note@pname", "note@oct", "note@oct.ges", "accid@accid", "accid@accid.ges", "note@staff", "chord@staff", "staff@n"],
      pageMarginLeft: 60, pageMarginRight: 60, pageMarginTop: 40, pageMarginBottom: 20, spacingStaff: 8, spacingBraceGroup: 8, lyricWordSpace: 3 };
    // (the page sets transposeToSoundingPitch per view: only where a part transposes)
    const trOpt = (x) => ({ transposeToSoundingPitch: /<transpose\b/.test(x) });
    // xml → { views: { key: { mei facts, log, pages, rendered, pitched, xml } } }
    window.views = (xml, { omr = /<software>\s*Audiveris/.test(xml.slice(0, 4000)), only = null, scale = 40, W = 2100, H = 2970 } = {}) => {
      if (omr) xml = fix.fixOmrScore(xml).xml;
      const P = prep.prepare(xml);
      const out = { P, views: {} };
      for (const [k, plan] of Object.entries(P.views)) {
        if (only && !only.includes(k)) continue;
        const v = prep.buildView(P.doc, plan);
        tk.setOptions({ ...VRVOPT, ...trOpt(v.xml), scale, pageWidth: W, pageHeight: H });
        tk.loadData(v.xml);
        const log = tk.getLog() || "";
        const mei = new DOMParser().parseFromString(tk.getMEI({}), "application/xml");
        let rendered = 0;
        for (let p = 1; p <= tk.getPageCount(); p++) {
          const s = new DOMParser().parseFromString(tk.renderToSVG(p), "image/svg+xml");
          rendered += [...s.querySelectorAll("g.note")].filter((g) => g.querySelector(":scope > g.notehead")).length;
        }
        const mid = (el) => el.getAttribute("xml:id");
        out.views[k] = {
          xml: v.xml, pitched: v.pitched, rendered, log,
          endings: [...mei.getElementsByTagName("ending")].map((e) => { const ms = [...e.getElementsByTagName("measure")].map(mid); return e.getAttribute("n") + ":" + ms[0] + (ms.length > 1 ? ".." + ms[ms.length - 1] : ""); }),
          dirs: [...mei.querySelectorAll("dir, tempo")].map((d) => [d.textContent.replace(/\s+/g, " ").trim(), d.getAttribute("tstamp"), d.closest("measure") && mid(d.closest("measure"))]),
          tempo: mei.getElementsByTagName("tempo").length,
          ties: [...mei.getElementsByTagName("tie")].map((t) => (t.getAttribute("startid") + ">" + t.getAttribute("endid")).replace(/#/g, "")),
          slurs: [...mei.getElementsByTagName("slur")].map((t) => (t.getAttribute("startid") + ">" + t.getAttribute("endid")).replace(/#/g, "")),
          beams: [...mei.getElementsByTagName("beam")].map((b) => b.querySelectorAll("note").length),
          beamSpans: mei.getElementsByTagName("beamSpan").length,
          tuplets: mei.getElementsByTagName("tuplet").length,
          keys: [...mei.querySelectorAll("section > scoreDef keySig, measure > staffDef keySig, scoreDef > keySig")].map((k) => k.getAttribute("sig")),
          keyAt: [...mei.querySelectorAll("section > *")].reduce((a, el) => { if (el.nodeName === "scoreDef") { const k = el.querySelector("keySig"); if (k) a.pending = k.getAttribute("sig"); } else if (el.nodeName === "measure") { a.list.push(a.pending || ""); a.pending = null; } return a; }, { list: [], pending: null }).list,
          verses: [...new Set([...mei.getElementsByTagName("verse")].map((x) => x.getAttribute("n")))],
          lyricsInXml: [...new DOMParser().parseFromString(v.xml, "application/xml").getElementsByTagName("lyric")].map((l) => l.getAttribute("number") || "1"),
        };
      }
      return out;
    };
    // Render one view's first page into a stage at the size given; decorate; → nothing (DOM)
    window.drawView = (xml, view, { W = 820, H = 1080, sp = 16, names: lvl = "all" } = {}) => {
      if (/<software>\s*Audiveris/.test(xml.slice(0, 4000))) xml = fix.fixOmrScore(xml).xml;
      const P = prep.prepare(xml);
      const plan = P.views[view];
      const v = prep.buildView(P.doc, plan);
      const s = Math.min(sp, W / 40, H / (12 * plan.staves)), scale = Math.round(s / 0.18);
      tk.setOptions({ ...VRVOPT, ...trOpt(v.xml), justifyVertically: true, justificationStaff: 0.2, justificationBraceGroup: 0.2, scale, pageWidth: Math.floor((W * 100) / scale), pageHeight: Math.floor((H * 100) / scale) });
      tk.loadData(v.xml);
      let st = document.getElementById("stage");
      if (!st) {
        document.body.innerHTML = "";
        const css = document.createElement("style");
        css.textContent = `html,body{margin:0;background:#fdfcf8} #stage{background:#fdfcf8;color:#111} #stage svg{display:block}
          #stage .nn, #stage .km { display:none } #stage[data-names=all] .nn, #stage[data-names=some] .nn.lv, #stage[data-names=some] .km { display:inline }`;
        document.head.appendChild(css);
        st = document.createElement("main"); st.id = "stage"; document.body.appendChild(st);
      }
      st.dataset.names = lvl;
      window.pagesN = tk.getPageCount();
      window.showPage = (p) => { st.innerHTML = `<div class="page">${tk.renderToSVG(p)}</div>`; return names.decorate(st.firstChild, P.facts); };
      window.facts = P.facts;
      return window.showPage(1).items.length;
    };
  });
}

(async () => {
  const browser = await chromium.launch();
  const owner = (f) => { const p = path.join(SCORES, f + ".musicxml"); return SCORES && fs.existsSync(p) ? read(p) : null; };

  // ================================ U: prep + Verovio ==========================================
  if (!ONLY || ONLY.has("U")) {
    const errors = [];
    const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push("pageerror " + e.message));
    await boot(page);
    const V = (xml, o) => page.evaluate(([xml, o]) => { const r = views(xml, o); return Object.fromEntries(Object.entries(r.views).map(([k, v]) => [k, { ...v, xml: undefined, log: v.log.split("\n").filter((l) => /warning|error/i.test(l)).join(" / ") }])); }, [xml, o || {}]);

    // 1. marks of the top part: endings (the piano's misread one gone), To Coda at beat 3, D.S.,
    //    tempo — in Both, RH and LH; "rit." (staff 2) in RH, "Verse" (staff 1) in LH
    {
      const r = await V(MARKS);
      for (const k of ["both", "rh", "lh"]) {
        const v = r[k], texts = v.dirs.map((d) => d[0]);
        ok(v.endings.join() === "1:m1..m2,2:m3", `marks ${k}: endings ${v.endings} (want 1:m1..m2, 2:m3)`);
        const coda = v.dirs.find((d) => /To Coda/.test(d[0]));
        ok(coda && coda[1] === "3" && coda[2] === "m1", `marks ${k}: To Coda at m1 beat 3 (${coda})`);
        ok(texts.some((t) => /D\.S\. al Coda/.test(t)) && texts.some((t) => /Moderately/.test(t)) && v.tempo === 1, `marks ${k}: D.S., Moderately ♩=100 (${texts}, tempo ${v.tempo})`);
      }
      ok(r.rh.dirs.some((d) => d[0] === "rit.") && r.lh.dirs.some((d) => d[0] === "Verse"), `marks: RH has the staff-2 "rit.", LH the staff-1 "Verse" (${r.rh.dirs.map((d) => d[0])} | ${r.lh.dirs.map((d) => d[0])})`);
      ok(r.both.dirs.filter((d) => d[0] === "Verse").length === 1, "marks: no mark twice");
      ok(r.melody.endings.join() === "1:m1..m2,2:m3", `marks melody (the top part itself): ${r.melody.endings}`);
      const own = { killing: "1:m37..m38,2:m39", wichita: "1:m20,1:m29,2:m30" };
      for (const [name, want] of Object.entries(own)) {
        const xml = owner(name);
        if (!xml) continue;
        const o = await V(xml, { only: ["both", "rh", "lh"] });
        for (const k of ["both", "rh", "lh"]) ok(o[k].endings.join() === want, `${name} ${k}: endings ${o[k].endings} (want ${want})`);
        if (name === "wichita") ok(o.both.dirs.some((d) => /Moderately/.test(d[0])) && o.both.tempo === 1, `wichita both: Moderately ♩=104 (${o.both.dirs.map((d) => d[0])})`);
      }
      const pm = owner("pianoman");
      if (pm) {
        const o = await V(pm, { only: ["both", "lh"] });
        for (const k of ["both", "lh"]) {
          const t = o[k].dirs.map((d) => d[0]).join(" | ");
          ok(/To Coda/.test(t) && /D\.S\./.test(t) && /Chorus/.test(t) && /Freely/.test(t), `pianoman ${k}: To Coda, D.S., Chorus, Freely (${t.slice(0, 200)})`);
        }
      }
    }
    // 2. ties: no tie onto its own note, the chain as written
    {
      const r = await V(TIES);
      ok(!/identical values/.test(r.both.log) && r.both.ties.length === 2 && r.both.ties.every((t) => t.split(">")[0] !== t.split(">")[1]), `ties: ${r.both.ties} ${r.both.log}`);
      for (const name of ["killing", "wichita"]) {
        const xml = owner(name);
        if (!xml) continue;
        const o = await V(xml, { only: ["both", "rh"] });
        ok(!/identical values/.test(o.both.log + o.rh.log), `${name}: no tie on its own note`);
      }
    }
    // 3. tuplet marks (fixscore): the quadruplet and two triplets bracketed; idempotent
    {
      const r = await page.evaluate((xml) => {
        const a = fix.fixOmrScore(xml), b = fix.fixOmrScore(a.xml);
        const d = new DOMParser().parseFromString(a.xml, "application/xml");
        const t = (type) => [...d.querySelectorAll(`tuplet[type="${type}"]`)].map((x) => x.closest("note").querySelector("pitch step").textContent + x.closest("measure").getAttribute("number"));
        return { start: t("start"), stop: t("stop"), changes: a.changes, again: b.changes, same: a.xml === b.xml };
      }, TUPLETS);
      ok(r.start.join() === "C1,C2,F2" && r.stop.join() === "F1,E2,A2", `tuplet marks: start ${r.start} stop ${r.stop} (${r.changes.join(" / ")})`);
      ok(r.same && !r.again.length, `tuplet marks idempotent (${r.again})`);
      const v = await V(TUPLETS);
      ok(v.both.tuplets === 3, `tuplets drawn: ${v.both.tuplets}`);
      const sb = owner("songbird");
      if (sb) { const o = await V(sb, { only: ["melody"] }); ok(o.melody.tuplets === 17, `songbird melody: ${o.melody.tuplets} tuplets (17)`); }
    }
    // 4. nothing dropped: a multi-measure rest over notes, no part-list, a part the list doesn't name
    for (const [name, xml] of [["multi-rest over notes", MULTI], ["no part-list", PIANO1(TWO_BARS, { list: false })], ["unlisted part id", PIANO1(TWO_BARS, { id: "X1" })]]) {
      const r = await V(xml, { only: ["both"] });
      ok(r.both.rendered === r.both.pitched && r.both.pitched > 0, `${name}: drawn ${r.both.rendered} of ${r.both.pitched}`);
    }
    // 5. one hand of a figure across both staves: beams re-terminated, the cut slur gone, the real one kept
    {
      const r = await V(CROSS);
      ok(r.rh.beams.join() === "3" && !/beamspan|could not be ended/i.test(r.rh.log), `RH: beam of the 3 kept eighths (${r.rh.beams}), ${r.rh.log}`);
      ok(r.rh.slurs.length === 1 && r.rh.slurs[0] === "n2>n3", `RH: the treble slur only (${r.rh.slurs})`);
      ok(r.lh.beams.length === 0 && r.lh.slurs.length === 0 && !/beamspan|could not be ended/i.test(r.lh.log), `LH: the lone eighth unbeamed, no slur (${r.lh.beams} | ${r.lh.slurs}) ${r.lh.log}`);
      ok(r.both.beams.length + r.both.beamSpans === 1 && r.both.slurs.join() === "n0>n1,n2>n3", `Both unchanged (beams ${r.both.beams} + ${r.both.beamSpans} | ${r.both.slurs})`);
    }
    // 6. a hymn's stacked stanzas → verse 1 in Melody / a voice-only Both; two verses kept
    {
      const three = await V(VERSES(3)), two = await V(VERSES(2));
      ok([...new Set(three.both.lyricsInXml)].join() === "1", `3 stanzas: verse 1 only (${[...new Set(three.both.lyricsInXml)]})`);
      ok([...new Set(two.both.lyricsInXml)].join() === "1,2", `2 verses: both kept (${[...new Set(two.both.lyricsInXml)]})`);
      const ag = await page.evaluate(async () => { const x = await (await fetch("./songs/amazing-grace.musicxml")).text(); const r = views(x, { only: ["melody"] }); return [...new Set(r.views.melody.lyricsInXml)]; });
      ok(ag.join() === "1", `Amazing Grace Melody: verse 1 only (${ag})`);
      const lt = owner("longest");
      if (lt) { const o = await V(lt, { only: ["melody"] }); ok(o.melody.verses.length === 2, `The Longest Time Melody keeps its 2 verses (${o.melody.verses})`); }
    }
    // 7. a bar with two keys (E♭ at the barline, D mid-bar), the next barline restating D: drawn
    {
      const caseE = HEAD(["P1"]).replace("<part-name>Voice", "<part-name>Piano") + `<part id="P1"><measure number="1">${ATTR({ staves: true, fifths: 1 })}${n("G5", 4, { staff: 1 })}${back(4)}${n("G2", 4, { staff: 2, voice: 5 })}</measure>
<measure number="2"><attributes><key><fifths>-3</fifths></key></attributes>${n("Eb5", 1, { staff: 1 })}${n("Bb4", 1, { staff: 1 })}<attributes><key><fifths>2</fifths></key></attributes>${n("F#5", 1, { staff: 1 })}${n("C#5", 1, { staff: 1 })}${back(4)}${n("D3", 4, { staff: 2, voice: 5 })}</measure>
<measure number="3"><attributes><key><fifths>2</fifths></key></attributes>${n("F#5", 4, { staff: 1 })}${back(4)}${n("D3", 4, { staff: 2, voice: 5 })}</measure>
<measure number="4"><attributes><key><fifths>2</fifths></key></attributes>${n("E5", 4, { staff: 1 })}${back(4)}${n("D3", 4, { staff: 2, voice: 5 })}</measure></part></score-partwise>`;
      const r = await V(caseE, { only: ["both", "rh"] });
      for (const k of ["both", "rh"]) ok(r[k].keyAt.slice(1).join("|") === "3f|2s|", `two keys in bar 2 (${k}): keys drawn at bars 2–4 "${r[k].keyAt.slice(1).join("|")}" (want 3f|2s|)`);
    }
    // transposing parts: every badge = the sounding note Verovio draws; the facts' MIDI sounding
    for (const [name, xml, midis] of TRANSPOSING) {
      await page.evaluate((xml) => drawView(xml, "both"), xml);
      const r = await page.evaluate(() => {
        const ACCID = { s: 1, f: -1, ss: 2, x: 2, ff: -2, n: 0 };
        return showPage(1).items.map((i) => {
          const ac = i.g.querySelector("g.accid"), code = ac ? ac.getAttribute("data-accid") || ac.getAttribute("data-accid.ges") : null;
          const svg = i.g.getAttribute("data-pname").toUpperCase() + (ACCID[code] ?? 0) + "/" + (i.g.getAttribute("data-oct.ges") ?? i.g.getAttribute("data-oct"));
          const SYM = { "-2": "𝄫", "-1": "♭", 0: "", 1: "♯", 2: "𝄪" };
          const drawn = i.g.getAttribute("data-pname").toUpperCase() + (ac?.getAttribute("data-accid") === "n" ? "♮" : SYM[ACCID[code] ?? 0]);
          return { svg, fact: i.fact.step + i.fact.alter + "/" + i.fact.oct, midi: i.fact.midi, label: i.badge.querySelector("text").textContent, drawn, printed: !!(ac && ac.getAttribute("data-accid")) };
        });
      });
      ok(r.every((x) => x.svg === x.fact), `${name}: facts = Verovio's sounding notes (${r.map((x) => x.fact + (x.fact === x.svg ? "" : "≠" + x.svg)).join(" ")})`);
      ok(r.every((x) => x.label === x.drawn), `${name}: badges spelled as drawn (${r.map((x) => x.label + (x.label === x.drawn ? "" : "≠" + x.drawn)).join(" ")})`);
      ok(r.map((x) => x.midi).join() === midis.join(), `${name}: sounding MIDI ${r.map((x) => x.midi)} (want ${midis})`);
      console.log(`   ${name}: ${r.map((x) => x.label + (x.printed ? "*" : "")).join(" ")}`);
    }
    // 8–12: the badges on a rendered page
    {
      // 8. cross-staff notes: no ledgers against the treble staff, no name at Some for that
      await page.evaluate((xml) => drawView(xml, "both"), XSTAFF);
      const x = await page.evaluate(() => { const it = showPage(1).items; return it.map((i) => [i.fact.step + i.fact.oct, i.ledgers, i.some]); });
      const a2 = x.find((i) => i[0] === "A2"), c3 = x.find((i) => i[0] === "C3");
      ok(a2 && c3 && a2[1] === 0 && c3[1] === 0 && a2[2] !== "name" && c3[2] !== "name", `cross-staff A2 / C3: ledgers ${a2?.[1]} / ${c3?.[1]}, Some ${a2?.[2]} / ${c3?.[2]}`);
      // 9. the key's ♭ mark at its own head (not by the note a third up), 11. the pill clear of a
      //    printed accidental and without Verovio's black ring, 12. C / C♯ / D all readable
      await page.evaluate((xml) => drawView(xml, "both", { names: "some" }), CLUSTER);
      const g = await page.evaluate(() => {
        const it = showPage(1).items;
        const heads = it.filter((i) => i.w);
        const km = [];
        for (const i of heads) {
          const k = i.g.querySelector(":scope > .km");
          if (!k) continue;
          const b = k.getBBox(), c = { x: b.x + b.width / 2, y: b.y + b.height * 0.62 }; // (♭'s bowl / ♯'s middle: low in the em box)
          const near = heads.reduce((a, o) => (Math.hypot(o.cx - c.x, o.cy - c.y) < Math.hypot(a.cx - c.x, a.cy - c.y) ? o : a));
          km.push({ id: i.fact.step + i.fact.oct, own: near === i, dy: (c.y - i.cy) / i.h });
        }
        const acc = [];
        for (const i of heads) {
          const ac = i.g.querySelector(":scope > g.accid");
          if (!ac || !ac.getAttribute("data-accid")) continue;
          const a = ac.getBBox(), r = i.badge.querySelector("rect");
          acc.push({ id: i.fact.step + (i.fact.alter || ""), gap: (Number(r.getAttribute("x")) - (a.x + a.width)) / i.h });
        }
        // letters of the cluster: the centre of each letter not under another name's pill drawn later
        const pills = heads.filter((i) => i.badge).map((i) => ({ i, r: i.badge.querySelector("rect").getBBox(), t: i.badge.querySelector("text").textContent }));
        const covered = [];
        pills.forEach((p, k) => {
          const tb = p.i.badge.querySelector("text").getBBox(), cx = tb.x + tb.width * 0.3, cy = tb.y + tb.height / 2;
          for (const q of pills.slice(k + 1)) if (q.t !== p.t && cx > q.r.x && cx < q.r.x + q.r.width && cy > q.r.y && cy < q.r.y + q.r.height) covered.push(p.t + " under " + q.t);
        });
        return { km, acc, covered };
      });
      ok(g.km.length >= 6 && g.km.every((k) => k.own && Math.abs(k.dy) < 0.5), `key marks at their own heads: ${JSON.stringify(g.km)}`);
      ok(g.acc.length >= 3 && g.acc.every((a) => a.gap >= 0.05), `pills clear of printed accidentals: ${JSON.stringify(g.acc)}`);
      ok(!g.covered.length, `C / C♯ / D letters readable: ${g.covered}`);
      // 10. Some's floor: Amazing Grace's first page (no ledger notes, no accidentals) still names
      //     one note a bar per staff
      const ag = await page.evaluate(async () => {
        const x = await (await fetch("./songs/amazing-grace.musicxml")).text();
        drawView(x, "both", { names: "some" });
        const it = showPage(1).items.filter((i) => i.w);
        const bars = new Set(it.map((i) => i.g.closest("g.measure").id + "|" + i.staff.getAttribute("data-n")));
        return { heads: it.length, named: it.filter((i) => i.some === "name").length, bars: bars.size, marks: it.filter((i) => i.km).length };
      });
      ok(ag.named >= ag.bars && ag.named >= 0.1 * ag.heads, `Amazing Grace p1 at Some: ${ag.named} of ${ag.heads} named (${ag.bars} bar-staves), ${ag.marks} marks`);
      // key marks on the owner's flat-key song: by their own heads
      const lt = owner("longest");
      if (lt) {
        const r = await page.evaluate((x) => {
          const pages = (drawView(x, "both", { names: "some" }), window.pagesN);
          let n = 0, bad = 0;
          for (let p = 1; p <= Math.min(pages, 6); p++) {
            const heads = showPage(p).items.filter((i) => i.w);
            for (const i of heads) {
              const k = i.g.querySelector(":scope > .km");
              if (!k) continue;
              n++;
              const b = k.getBBox(), c = { x: b.x + b.width / 2, y: b.y + b.height * 0.62 };
              const near = heads.reduce((a, o) => (Math.hypot(o.cx - c.x, o.cy - c.y) < Math.hypot(a.cx - c.x, a.cy - c.y) ? o : a));
              if (near !== i) bad++;
            }
          }
          return { n, bad };
        }, lt);
        ok(r.n > 20 && r.bad <= 0.05 * r.n, `The Longest Time: ${r.bad} of ${r.n} key marks nearer another head`);
      }
      await page.screenshot({ path: path.join(SHOTS, "fixes-cluster.png"), clip: { x: 0, y: 0, width: 820, height: 400 } });
    }
    // ---- second round ----
    // R1. beams: a one-hand view keeps every group the filter didn't cut as written — a grace note
    //     inside a run, a "begin" inside an open group (Verovio reads both as one beam)
    {
      const r = await V(GRACE, { only: ["both", "rh"] });
      ok(r.both.beams.length >= 3 && r.rh.beams.join() === r.both.beams.join(), `grace / OMR beams: RH ${r.rh.beams} = Both ${r.both.beams}`);
      const wi = owner("wichita");
      if (wi) {
        const o = await page.evaluate((xml) => {
          const r = views(xml, { only: ["melody"] });
          const mei = new DOMParser().parseFromString(tk.getMEI({}), "application/xml");
          const m = [...mei.getElementsByTagName("measure")].find((x) => x.getAttribute("xml:id") === "m8");
          return m ? [...m.getElementsByTagName("beam")].map((b) => b.getElementsByTagName("note").length) : null;
        }, wi);
        ok(o && o.includes(5), `Wichita Melody bar 9: the eighth and both 16ths under one beam (${o})`);
      }
      // a cut group (the cross-staff figure) still re-terminated: test 5 above
    }
    // R2. a key restated at the bar's start, changed mid-bar: drawn once (bar 2), not again at bar 3
    {
      const r = await V(MIDKEY, { only: ["both", "rh"] });
      for (const k of ["both", "rh"]) ok(r[k].keyAt.slice(1).join("|") === "2s|", `restated key + mid-bar change (${k}): keys at bars 2–3 "${r[k].keyAt.slice(1).join("|")}" (want 2s|)`);
    }
    // R3. unmarked tuplets of two values next to each other: [q q q] [e e e], [e e e] [q q q]
    {
      const r = await page.evaluate((xml) => {
        const a = fix.fixOmrScore(xml), b = fix.fixOmrScore(a.xml);
        const d = new DOMParser().parseFromString(a.xml, "application/xml");
        const t = (type) => [...d.querySelectorAll(`tuplet[type="${type}"]`)].map((x) => x.closest("note").querySelector("pitch step").textContent + x.closest("measure").getAttribute("number"));
        return { start: t("start"), stop: t("stop"), same: a.xml === b.xml };
      }, MIXTUP);
      ok(r.start.join() === "C1,F1,C2,F2" && r.stop.join() === "E1,A1,E2,A2" && r.same, `quarter- and eighth-triplets: start ${r.start} stop ${r.stop} (idempotent ${r.same})`);
    }
    // R4–R6 on rendered pages, at Some
    {
      // R4. Some's floor by the score's time: the top of E4 G4 C5 D5 is D5 wherever the second's
      //     head is drawn
      await page.evaluate((xml) => drawView(xml, "both", { names: "some" }), SECONDS);
      const f = await page.evaluate(() => {
        const it = showPage(1).items.filter((i) => i.w);
        const named = it.filter((i) => i.badge.classList.contains("lv"));
        return { s1: named.filter((i) => i.fact.staff === 1).map((i) => i.fact.step + i.fact.oct), s2: named.filter((i) => i.fact.staff === 2).map((i) => i.fact.step + i.fact.oct) };
      });
      ok(f.s1.join() === "D5,D5,D5,D5" && f.s2.join() === "C3,C3,C3,C3", `floor on seconds: RH ${f.s1}, LH ${f.s2} (want D5 ×4, C3 ×4)`);
      // R5. a head two voices share (Amazing Grace's unisons): both named or neither, on every page
      // R6. key marks: their ink (the glyph's box from the font) clear of other notes' heads and
      //     printed accidentals, stems, barlines, ties and slurs; few left out
      const scan = (xml, view, o) => page.evaluate(([xml, view, o]) => {
        drawView(xml, view, { ...o, names: "some" });
        const out = { pages: window.pagesN, unison: [], marks: 0, blocked: 0, hits: [] };
        const cv = document.createElement("canvas").getContext("2d");
        for (let p = 1; p <= window.pagesN; p++) {
          const items = showPage(p).items.filter((i) => i.w);
          for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) {
            const A = items[a], B = items[b];
            if (A.staff === B.staff && Math.abs(A.cx - B.cx) < 0.3 * Math.max(A.w, B.w) && Math.abs(A.cy - B.cy) < 0.15 * Math.max(A.h, B.h)
              && A.badge.classList.contains("lv") !== B.badge.classList.contains("lv")) out.unison.push(`p${p} ${A.id}/${B.id}`);
          }
          const svg = document.querySelector("#stage svg");
          const heads = items.map((i) => ({ i, b: i.head.getBBox() }));
          // (a line's box widened by its stroke: a barline's or a stem's box has no width)
          const boxes = [...svg.querySelectorAll("g.accid, g.stem > path, g.flag, g.barLine > path")].filter((e) => e.matches("g.accid") ? !!e.getAttribute("data-accid") : true).map((e) => {
            const b = e.getBBox(), pad = (Number(e.getAttribute("stroke-width")) || 0) / 2;
            return { e, b: { x: b.x - pad, y: b.y - pad, width: b.width + 2 * pad, height: b.height + 2 * pad } };
          });
          const curves = [...svg.querySelectorAll("g.tie > path, g.slur > path")];
          for (const i of items) {
            if (i.some !== "mark") continue;
            out.marks++;
            const k = i.g.querySelector(":scope > .km");
            if (!k) { if (i.badge.getAttribute("data-km") === "blocked") out.blocked++; else out.hits.push(`${i.id}: no mark, not blocked`); continue; }
            const size = Number(k.getAttribute("font-size")), x = Number(k.getAttribute("x")), y = Number(k.getAttribute("y"));
            cv.font = `700 ${size}px ${k.getAttribute("font-family")}`;
            const m = cv.measureText(k.textContent), end = k.getAttribute("text-anchor") === "end";
            const x0 = x - m.actualBoundingBoxLeft - (end ? m.width : 0), x1 = x + m.actualBoundingBoxRight - (end ? m.width : 0);
            const y0 = y - m.actualBoundingBoxAscent, y1 = y + m.actualBoundingBoxDescent, tol = 0.04 * size;
            const hit = (b) => Math.min(x1, b.x + b.width) - Math.max(x0, b.x) > tol && Math.min(y1, b.y + b.height) - Math.max(y0, b.y) > tol;
            const own = i.g.querySelector(":scope > g.stem") || i.g.closest("g.chord")?.querySelector(":scope > g.stem");
            // (a head: the oval its box holds)
            const oval = (b) => { const cx = b.x + b.width / 2, cy = b.y + b.height / 2, dx = (Math.min(Math.max(cx, x0 + tol), x1 - tol) - cx) / (b.width / 2), dy = (Math.min(Math.max(cy, y0 + tol), y1 - tol) - cy) / (b.height / 2); return dx * dx + dy * dy < 1; };
            for (const h of heads) if (h.i !== i && oval(h.b)) out.hits.push(`p${p} ${i.id} on head ${h.i.id}`);
            for (const o of boxes) if (!(own && own.contains(o.e)) && !i.g.contains(o.e) && hit(o.b)) out.hits.push(`p${p} ${i.id} on ${o.e.getAttribute("class") || o.e.parentNode.getAttribute("class")}`);
            const pt = svg.createSVGPoint();
            for (const c of curves) {
              let touch = false;
              for (let u = 0; u < 5 && !touch; u++) for (let v = 0; v < 5 && !touch; v++) {
                pt.x = x0 + ((u + 0.5) / 5) * (x1 - x0); pt.y = y0 + ((v + 0.5) / 5) * (y1 - y0);
                touch = c.isPointInFill(pt) || c.isPointInStroke(pt);
              }
              if (touch) out.hits.push(`p${p} ${i.id} on ${c.parentNode.getAttribute("class")}`);
            }
          }
        }
        return out;
      }, [xml, view, o]);
      const ag = await page.evaluate(async () => (await fetch("./songs/amazing-grace.musicxml")).text());
      const runs = [["Amazing Grace", ag, "both", { W: 744, H: 1050, sp: 16 }], ["Amazing Grace", ag, "both", { W: 820, H: 1080, sp: 16 }], ["Amazing Grace", ag, "melody", { W: 744, H: 1050, sp: 16 }], ["Amazing Grace", ag, "both", { W: 1133, H: 660, sp: 12.5 }]];
      for (const [nm, v, o] of [["wichita", "lh", { W: 1133, H: 660, sp: 12.5 }], ["wichita", "both", { W: 1366, H: 940, sp: 20 }], ["killing", "melody", { W: 1180, H: 740, sp: 14 }], ["longest", "both", { W: 820, H: 1080, sp: 16 }]]) { const x = owner(nm); if (x) runs.push([nm, x, v, o]); }
      // (a mark with no clear side is left out: a dense bar at a small size — a few, not many)
      let marks = 0, blocked = 0;
      for (const [nm, xml, view, o] of runs) {
        const r = await scan(xml, view, o);
        const tag = `${nm} ${view} ${o.W}×${o.H} @${o.sp}`;
        ok(!r.unison.length, `${tag}: unison heads named alike (${r.unison.slice(0, 6)})`);
        ok(!r.hits.length && r.blocked <= Math.max(3, 0.2 * r.marks), `${tag}: ${r.marks} key marks, ${r.blocked} left out, collisions: ${r.hits.slice(0, 6).join(" | ")}`);
        marks += r.marks; blocked += r.blocked;
      }
      ok(blocked <= 0.1 * marks, `key marks left out: ${blocked} of ${marks}`);
      console.log(`   key marks left out: ${blocked} of ${marks}`);
    }
    ok(!errors.length, `U: no errors ${errors}`);
    await ctx.close();
  }

  // ================================ P: play.html ===============================================
  const newPage = async (w, h, errors, init) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push("pageerror " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console " + m.text()); });
    return { ctx, page };
  };
  const D = (page) => page.evaluate(() => { const { facts, countAll, ...d } = window.resonateDebug().play; return d; });
  const ready = (page, song, view) => page.waitForFunction(([s, v]) => { const d = window.resonateDebug?.().play; return d && d.ready && (!s || d.song === s) && (!v || d.view === v); }, [song, view], { timeout: 60000 });
  const seed = (page, list) => page.evaluate(async (list) => {
    const L = await import("./library.js?v=76");
    const ids = {};
    for (const { name, xml, source, pdf } of list) ids[name] = await L.addSong(name, xml, { source: source || "file", ...(pdf ? { pdf: new Uint8Array(pdf).buffer, pdfName: name + ".pdf" } : {}) });
    return ids;
  }, list);
  const openSong = async (page, id) => { await page.evaluate((id) => localStorage.setItem("resonate.sing.song", id), id); await page.reload(); await ready(page, id); };
  // (records seeded from another page of the site: Play writes its own on pagehide)
  const setRecord = async (page, id, rec) => {
    await page.goto(BASE + "tools.html");
    await page.evaluate(([id, rec]) => { const all = JSON.parse(localStorage.getItem("resonate.play") || "{}"); if (rec == null) delete all[id]; else all[id] = rec; localStorage.setItem("resonate.play", JSON.stringify(all)); }, [id, rec]);
    await page.goto(BASE + "play.html");
  };
  const pvg = read(path.join(FIX, "synth-pvg.musicxml"));

  const section = async (name, f) => { if (ONLY && !ONLY.has(name)) return; try { await f(); } catch (e) { ok(false, `${name}: ${String(e.message || e).split("\n")[0]}`); } };
  // 13–16: menus and the pedal, records, levels, a failed view
  await section("P1", async () => {
    const errors = [];
    const { ctx, page } = await newPage(820, 1180, errors, () => {
      if (sessionStorage.getItem("idbfail")) IDBFactory.prototype.open = function () { const r = { result: null, error: new DOMException("test", "UnknownError") }; setTimeout(() => r.onerror && r.onerror({ target: r })); return r; };
    });
    await page.goto(BASE + "play.html");
    await ready(page, "amazing-grace");
    const ids = await seed(page, [{ name: "synth-pvg", xml: pvg }, { name: "synth-longest", xml: read(path.join(FIX, "synth-longest.musicxml")) }]);
    const P = ids["synth-pvg"], L = ids["synth-longest"];
    await page.evaluate(() => localStorage.setItem("resonate.play.zoom", "+4")); // (pages to turn: four steps over the default, ~16)
    await openSong(page, P);
    let d = await D(page);
    ok(d.pages >= 3, `synth-pvg: ${d.pages} pages`);
    // a menu tapped and closed with no new pick keeps focus: the pedal turns the page anyway
    await page.tap("#hands");
    await page.keyboard.press("Escape");
    const f0 = await page.evaluate(() => document.activeElement?.id);
    await page.keyboard.press("ArrowRight");
    d = await D(page);
    ok(d.page === 2 && d.view === "both" && (await page.evaluate(() => document.activeElement?.id)) !== "hands", `hands tapped, closed (focus ${f0}): ArrowRight → page ${d.page}, view ${d.view}`);
    await page.tap("#song");
    await page.keyboard.press("Escape");
    await page.keyboard.press("PageDown");
    d = await D(page);
    const saved = await page.evaluate(() => localStorage.getItem("resonate.sing.song"));
    ok(d.song === P && d.page === 3 && saved === P, `song tapped, closed: PageDown → page ${d.page}, song kept (${d.song === P}, Sing's ${saved === P})`);
    await page.tap("#song");
    await page.keyboard.press("Escape");
    await page.keyboard.press("ArrowLeft");
    d = await D(page);
    ok(d.song === P && d.page === 2, `ArrowLeft after the song menu → page ${d.page}, same song`);
    // reached with Tab, a menu keeps its keys
    await page.focus("#hands");
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(300);
    ok((await page.evaluate(() => document.getElementById("hands").value)) !== "both", "Tab-focused hands menu: ArrowDown changes it");
    ok(!errors.length, `P1: no errors ${errors}`);
    await ctx.close();
  });
  await section("P1b", async () => {
    const errors = [];
    const { ctx, page } = await newPage(820, 1180, errors, () => {
      if (sessionStorage.getItem("idbfail")) IDBFactory.prototype.open = function () { const r = { result: null, error: new DOMException("test", "UnknownError") }; setTimeout(() => r.onerror && r.onerror({ target: r })); return r; };
    });
    await page.goto(BASE + "play.html");
    await ready(page, "amazing-grace");
    const ids = await seed(page, [{ name: "synth-pvg", xml: pvg }, { name: "synth-longest", xml: read(path.join(FIX, "synth-longest.musicxml")) }]);
    const P = ids["synth-pvg"], L = ids["synth-longest"];
    let d;

    // 14. My songs fails to open on a load: the records stay
    await setRecord(page, L, { names: "some", view: "rh", at: 3, days: { n: 2, ask: 3, d: "2026-11-15", ms: 0 } });
    await page.evaluate(() => sessionStorage.setItem("idbfail", "1"));
    await page.reload();
    await ready(page);
    let rec = await page.evaluate((id) => JSON.parse(localStorage.getItem("resonate.play") || "{}")[id], L);
    ok(rec && rec.names === "some" && rec.at === 3 && rec.days?.n === 2, `the library failed to open: record kept (${JSON.stringify(rec)})`);
    await page.evaluate(() => sessionStorage.removeItem("idbfail"));
    await page.reload();
    await ready(page);
    await openSong(page, L);
    d = await D(page);
    ok(d.names === "some" && d.view === "rh", `next load: the song at its level and view (${d.names}, ${d.view})`);

    // 15. a song keeps the level it opened at; another song's level change leaves it alone
    await setRecord(page, "amazing-grace", { at: 0, days: { n: 3, ask: 3, d: "2026-11-15", ms: 0 } });
    await page.evaluate(() => localStorage.setItem("resonate.play.names", "all"));
    await openSong(page, "amazing-grace");
    d = await D(page);
    ok(d.names === "all" && d.offer.shown && d.offer.to === "some", `A opens at All, offer Some (${d.names}, ${JSON.stringify(d.offer.to)})`);
    await page.selectOption("#song", P);
    await ready(page, P);
    for (let i = 0; i < 3 && (await D(page)).names !== "off"; i++) await page.click("#names");
    ok((await D(page)).names === "off", "B set to Off");
    await page.selectOption("#song", "amazing-grace");
    await ready(page, "amazing-grace");
    d = await D(page);
    ok(d.names === "all" && d.offer.shown && d.offer.to === "some", `A back: still All, offer Some (${d.names}, ${d.offer.to})`);
    for (let i = 0; i < 3 && (await D(page)).names !== "some"; i++) { await page.selectOption("#song", P); await ready(page, P); await page.click("#names"); await page.selectOption("#song", "amazing-grace"); await ready(page, "amazing-grace"); }
    d = await D(page);
    ok(d.names === "all", `B at Some: A still All (${d.names})`);

    // 16. a view that fails to load; back to Both; rotation re-lays the page; the failed view isn't kept
    await openSong(page, P);
    await page.evaluate(async () => {
      const m = await import("./vendor/verovio-6.4.0/verovio.mjs");
      const o = m.VerovioToolkit.prototype.getPageCount;
      m.VerovioToolkit.prototype.getPageCount = function () { if (window.__failOnce) { window.__failOnce = false; return 0; } return o.call(this); };
      window.__failOnce = true;
    });
    await page.selectOption("#hands", "rh");
    await page.waitForFunction(() => window.resonateDebug().play.failed === "song");
    await page.waitForTimeout(1200);
    rec = await page.evaluate((id) => JSON.parse(localStorage.getItem("resonate.play") || "{}")[id], P);
    ok(rec.view !== "rh", `failed RH not kept as the song's view (${rec.view})`);
    await page.selectOption("#hands", "both");
    await ready(page, P, "both");
    d = await D(page);
    ok(!d.failed && d.ready, `back to Both: failed ${d.failed}`);
    const w0 = d.W;
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.waitForFunction((w0) => window.resonateDebug().play.W !== w0, w0, { timeout: 5000 }).catch(() => {});
    d = await D(page);
    ok(d.W > 1000, `rotated after a failed view: laid out again (W ${w0} → ${d.W})`);
    // the badges' outline: Verovio's own <style> strokes every rect (a black ring round the pill)
    const ring = await page.evaluate(() => ["#stage .nn.nb-f rect", "#stage .nn.nb-h rect"].map((q) => { const r = document.querySelector(q); return r ? getComputedStyle(r).stroke : null; }));
    ok(ring[0] === "none" && (ring[1] == null || ring[1] === "rgb(94, 47, 184)"), `pill outlines: filled ${ring[0]}, hollow ${ring[1]}`);
    ok(!errors.length, `P1: no errors ${errors}`);
    await ctx.close();
  });

  // 17, 22: PDF pages that can't be read; the worker freed; nothing of the sheet around the PDF
  await section("P2", async () => {
    const errors = [];
    const { ctx, page } = await newPage(1180, 820, errors);
    await page.goto(BASE + "play.html");
    await ready(page, "amazing-grace");
    const ids = await seed(page, [
      { name: "bad1", xml: pvg, source: "pdf", pdf: [...damaged(1)] },
      { name: "bad3", xml: pvg, source: "pdf", pdf: [...damaged(3)] },
      // (staff-details print-object="yes", as every Audiveris conversion has: Verovio writes
      // visibility="visible" on those staves)
      { name: "good", xml: pvg.replace(/<part id="P2">[\s\S]*$/, (p2) => p2.replace(/(<measure number="(\d+)"[^>]*>)/g, (m, tag, num) => (Number(num) > 1 ? tag + '<attributes><staff-details print-object="yes"/></attributes>' : tag))), source: "pdf", pdf: [...pdfmini(4)] },
    ]);
    const pdfState = () => page.evaluate(() => ({ ...window.resonateDebug().play.pdf, msg: document.getElementById("msg").hidden ? "" : document.getElementById("msg").textContent, pg: document.getElementById("pg").textContent }));
    await openSong(page, ids.bad1);
    await page.waitForSelector("#pdf:not([hidden])");
    await page.click("#pdf");
    await page.waitForFunction(() => !window.resonateDebug().play.pdf.on, null, { timeout: 15000 }).catch(() => {});
    let s = await pdfState();
    ok(!s.on && s.msg === "Couldn't open the PDF." && /\d+ \/ \d+/.test(s.pg), `unreadable page 1: "${s.msg}", sheet back (${s.pg})`);
    await openSong(page, ids.bad3);
    await page.waitForSelector("#pdf:not([hidden])");
    await page.click("#pdf");
    await page.waitForFunction(() => { const p = window.resonateDebug().play.pdf; return p.on && !p.busy && p.canvas; }, null, { timeout: 15000 });
    await page.waitForTimeout(300);
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => !window.resonateDebug().play.pdf.on, null, { timeout: 15000 }).catch(() => {});
    s = await pdfState();
    ok(!s.on && s.msg === "Couldn't open the PDF.", `unreadable page 3: turning to it closes the PDF with a message (${s.on}, "${s.msg}", ${s.pg})`);
    await page.waitForTimeout(500);
    ok(!errors.some((e) => /pageerror/.test(e)), `no unhandled errors: ${errors.filter((e) => /pageerror/.test(e))}`);
    // 22. the good one: the sheet hidden under it, all of it; the worker freed once closed
    await openSong(page, ids.good);
    await page.waitForSelector("#pdf:not([hidden])");
    await page.click("#pdf");
    await page.waitForFunction(() => { const p = window.resonateDebug().play.pdf; return p.on && !p.busy && p.canvas; }, null, { timeout: 15000 });
    await page.waitForTimeout(300);
    const vis = await page.evaluate(() => [...document.querySelectorAll("#stage .page, #stage .page *")].filter((e) => getComputedStyle(e).visibility === "visible").length);
    ok(vis === 0, `PDF view: ${vis} elements of the sheet still visible`);
    s = await pdfState();
    ok(s.spread && s.pg === "1–2 / 4", `1180×820, a Letter PDF: two pages side by side (${s.pg})`);
    const workers = () => page.evaluate(() => 0).then(() => page.workers().filter((w) => /pdf\.worker/.test(w.url())).length);
    const w1 = await workers();
    for (let i = 0; i < 3; i++) {
      await page.click("#pdf");
      await page.click("#pdf");
      await page.waitForFunction(() => { const p = window.resonateDebug().play.pdf; return p.on && !p.busy && p.canvas; }, null, { timeout: 15000 });
    }
    await page.click("#pdf");
    await page.waitForTimeout(800);
    const w2 = await workers();
    ok(w1 >= 1 && w2 === 0, `pdf.js workers: ${w1} while open, ${w2} after four opens and closes`);
    await page.screenshot({ path: path.join(SHOTS, "fixes-pdf-1180.png") });
    ok(!errors.filter((e) => !/pdf|PDF|Invalid|UnknownError|bad XRef|Pages tree/i.test(e)).length, `P2: no errors ${errors}`);
    await ctx.close();
  });

  // 18–19: sizes (v79) — the landscape default: the printed density across the width (90 staff
  // spaces), two systems a page (stepping down at most to 0.9 of the device's portrait density);
  // + from there (a step: ×1.15); a phone unchanged; a one-page view at the stage's full width
  await section("P3", async () => {
    const errors = [];
    let ctx, page, d;
    for (const [w, h] of [[1180, 820], [1133, 744], [1180, 746]]) {
      ({ ctx, page } = await newPage(w, h, errors));
      await page.goto(BASE + "play.html");
      await ready(page, "amazing-grace");
      d = await D(page);
      const base = d.W / 90, floor = Math.min(base, (0.9 * Math.min(w, h)) / 90);
      const systems = await page.evaluate(() => document.querySelectorAll("#stage .page g.system").length);
      ok(Math.abs(d.base - base) < 0.01 && d.sp <= base + 0.01 && d.sp >= floor - 0.01 && systems >= 2, `${w}×${h} landscape default: sp ${d.sp} (base ${d.base}, floor ${floor.toFixed(2)}), ${systems} systems on page 1`);
      if (w === 1180 && h === 820) {
        const pm = owner("pianoman");
        if (pm) {
          const ids = await seed(page, [{ name: "pianoman", xml: pm }]);
          await openSong(page, ids.pianoman);
          const r = await page.evaluate(async () => {
            const per = [];
            const d = window.resonateDebug().play;
            for (let p = 1; p <= d.pages; p++) {
              if (p > 1) window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
              await new Promise((r) => setTimeout(r, 20));
              per.push(document.querySelectorAll("#stage .page g.system").length);
            }
            return { sp: window.resonateDebug().play.sp, per };
          });
          const ones = r.per.slice(0, -1).filter((x) => x < 2).length;
          // (v80: with the keyboard docked the stage is ~10% shorter — the fit's own rule, two
          // systems on ≥ 3 pages in 4 (the last aside); v79 had every page)
          const kbOn = (await D(page)).keys?.shown;
          ok(r.sp <= 1180 / 90 + 0.01 && (kbOn ? ones <= 0.25 * (r.per.length - 1) : ones === 0), `Piano Man at 1180×820's default (sp ${r.sp}): ${r.per.length} pages, ${ones} besides the last with one system (keyboard ${kbOn ? "on" : "off"})`);
          await openSong(page, "amazing-grace");
        }
      }
      if (w !== 1180 || h !== 746) await ctx.close();
    }
    await page.screenshot({ path: path.join(SHOTS, "fixes-landscape-1180x746.png") });
    ok(!(await page.isDisabled("#bigger")), "+ enabled in landscape");
    const sp0 = d.sp, next = Math.min(d.cap, sp0 * 1.15);
    await page.click("#bigger");
    await page.waitForFunction(() => window.resonateDebug().play.ready);
    d = await D(page);
    ok(Math.abs(d.sp - next) < 0.02 && (await page.evaluate(() => localStorage.getItem("resonate.play.zoom"))) === "+1", `+ from ${sp0} → ${d.sp} (want ${next.toFixed(2)}), kept as a step`);
    await page.reload();
    await ready(page);
    ok(Math.abs((await D(page)).sp - next) < 0.02, `after a reload: ${(await D(page)).sp}`);
    await page.click("#bigger");
    await page.waitForFunction(() => window.resonateDebug().play.ready);
    await page.click("#smaller");
    await page.waitForFunction(() => window.resonateDebug().play.ready);
    ok(Math.abs((await D(page)).sp - next) < 0.02, `+ then − → ${(await D(page)).sp}`);
    await page.evaluate(() => localStorage.removeItem("resonate.play.zoom"));
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.reload();
    await ready(page);
    ok(Math.abs((await D(page)).sp - 820 / 90) < 0.01, `portrait: 9.11 (${(await D(page)).sp})`);
    await ctx.close();
    ({ ctx, page } = await newPage(844, 390, errors));
    await page.goto(BASE + "play.html");
    await ready(page, "amazing-grace");
    d = await D(page);
    ok(Math.abs(d.sp - 9.5) < 0.01, `phone landscape: sp ${d.sp} (9.5)`);
    await ctx.close();
    // 19. a one-page view in a spread-size stage (− all the way: 5 px, 136 staff spaces a half): the full width
    ({ ctx, page } = await newPage(1366, 1024, errors));
    await page.goto(BASE + "tools.html");
    await page.evaluate(() => localStorage.setItem("resonate.play.zoom", "-8"));
    await page.goto(BASE + "play.html");
    await ready(page, "amazing-grace");
    d = await D(page);
    const pw = await page.evaluate(() => [...document.querySelectorAll("#stage .page")].map((p) => Math.round(p.getBoundingClientRect().width)));
    ok(d.pages === 1 && !d.spread && pw.length === 1 && pw[0] >= d.W - 2, `1366×1024 at ${d.sp}: ${d.pages} page, spread ${d.spread}, page ${pw} of ${d.W}`);
    await page.screenshot({ path: path.join(SHOTS, "fixes-onepage-1366.png") });
    await page.click("#bigger");
    await page.waitForFunction(() => window.resonateDebug().play.ready);
    for (let i = 0; i < 4 && (await D(page)).pages < 2; i++) { await page.click("#bigger"); await page.waitForFunction(() => window.resonateDebug().play.ready); }
    d = await D(page);
    ok(d.pages < 2 || d.spread === (d.W / 2 / d.size >= 110), `bigger: a real spread again once 2 pages (${d.pages} pages, spread ${d.spread}, size ${d.size})`);
    ok(!errors.length, `P3: no errors ${errors}`);
    await ctx.close();
  });

  // 21. the bar keeps one row with the chip (a PDF song with hands, 📄 shown) from 1100 px
  await section("P4", async () => {
    const errors = [];
    for (const [w, h] of [[1112, 834], [1133, 744], [1180, 820], [1366, 1024]]) {
      const { ctx, page } = await newPage(w, h, errors);
      await page.goto(BASE + "play.html");
      await ready(page, "amazing-grace");
      const ids = await seed(page, [{ name: "Hey, Little Songbird (long title)", xml: pvg, source: "pdf", pdf: [...pdfmini(2)] }]);
      const id = ids["Hey, Little Songbird (long title)"];
      await setRecord(page, id, { days: { n: 3, ask: 3, d: "2026-11-15", ms: 0 } });
      await page.evaluate((id) => localStorage.setItem("resonate.sing.song", id), id);
      await page.reload();
      await ready(page, id);
      await page.waitForSelector("#pdf:not([hidden])");
      const bar = () => page.evaluate(() => Math.round(document.getElementById("bar").getBoundingClientRect().height));
      const withChip = await bar(), shown = !(await page.isHidden("#offer"));
      await page.click("#offer-no");
      await page.waitForTimeout(300);
      const without = await bar();
      ok(shown && withChip === without, `${w}×${h}: bar ${withChip}px with the chip, ${without}px without`);
      if (w === 1133) await page.screenshot({ path: path.join(SHOTS, "fixes-bar-1133.png"), clip: { x: 0, y: 0, width: w, height: 130 } });
      await ctx.close();
    }
    ok(!errors.length, `P4: no errors ${errors}`);
  });

  // R7. positioned rests stay on their staff: transposeToSoundingPitch (which moves them in any
  //     score) only for a view with a transposing part — which still sounds where it should
  await section("P5", async () => {
    const errors = [];
    const rest = (step, oct, staff, voice) => `<note><rest><display-step>${step}</display-step><display-octave>${oct}</display-octave></rest><duration>1</duration><voice>${voice}</voice><type>quarter</type><staff>${staff}</staff></note>`;
    // (as Songbird bar 24: two voices in the left hand, the upper one starting with a rest — with
    // the option Verovio moved such a rest to B4, into the gap above the bass staff)
    const RESTS = PIANO1([1, 2].map((k) => `<measure number="${k}">${k === 1 ? ATTR({ staves: true }) : ""}${n("F4", 2, { staff: 1 })}${n("D4", 1, { staff: 1 })}${n("G4", 1, { staff: 1 })}${back(4)}${rest("A", 3, 2, 5)}${n("F3", 2, { staff: 2, voice: 5 })}${rest("F", 3, 2, 5)}${back(4)}${n("Bb2", 4, { staff: 2, voice: 6, type: "whole" })}</measure>`).join(""));
    const { ctx, page } = await newPage(1180, 820, errors);
    await page.goto(BASE + "play.html");
    await ready(page, "amazing-grace");
    const ids = await seed(page, [{ name: "rests", xml: RESTS }, { name: "clarinet", xml: TRANSPOSING[0][1] }]);
    await openSong(page, ids.rests);
    const r = await page.evaluate(() => {
      const out = [];
      for (const g of document.querySelectorAll("#stage g.rest")) {
        const st = g.closest("g.staff"), ys = [...st.children].filter((c) => c.nodeName === "path").map((c) => Number(/M\s*[\d.]+\s+([\d.]+)/.exec(c.getAttribute("d"))?.[1])).filter(Number.isFinite);
        const b = g.getBBox(), cy = b.y + b.height / 2;
        out.push({ staff: st.getAttribute("data-n"), inside: cy >= Math.min(...ys) && cy <= Math.max(...ys) });
      }
      return out;
    });
    ok(r.length === 4 && r.every((x) => x.staff === "2" && x.inside), `bass-staff rests drawn inside the bass staff: ${JSON.stringify(r)}`);
    const sb = owner("songbird");
    if (sb) {
      // Songbird bars 24–27: the left hand's quarter rests in the bass staff (not in the gap above)
      const ids2 = await seed(page, [{ name: "songbird", xml: sb }]);
      await setRecord(page, ids2.songbird, { at: 23, view: "both", days: { n: 3, ask: 3, d: "2026-11-15", ms: 0 } });
      await openSong(page, ids2.songbird);
      const o = await page.evaluate(() => {
        const out = [];
        for (const mi of [23, 25, 26]) for (const g of document.querySelectorAll(`#stage g.measure#m${mi} g.staff[data-n="2"] g.rest`)) {
          const st = g.closest("g.staff"), ys = [...st.children].filter((c) => c.nodeName === "path").map((c) => Number(/M\s*[\d.]+\s+([\d.]+)/.exec(c.getAttribute("d"))?.[1])).filter(Number.isFinite);
          const b = g.getBBox(), cy = b.y + b.height / 2;
          out.push(`m${mi}:${cy >= Math.min(...ys) && cy <= Math.max(...ys) ? "in" : "OUT"}`);
        }
        return out;
      });
      ok(o.length >= 2 && o.every((x) => x.endsWith(":in")), `Songbird bars 24–27: bass rests in the bass staff (${o})`);
    }
    await openSong(page, ids.clarinet);
    const c = await page.evaluate(() => [...document.querySelectorAll("#stage g.note")].map((g) => g.getAttribute("data-pname") + (g.getAttribute("data-oct.ges") ?? g.getAttribute("data-oct"))));
    ok(c.join() === "c5,d5,e5,b4", `the B♭ clarinet part drawn at sounding pitch (${c})`);
    ok(!errors.length, `P5: no errors ${errors}`);
    await ctx.close();
  });

  // R8. the engine's download fails once: picking another hands view loads it (a new address — a
  //     browser keeps a failed module import for the page's life)
  await section("P6", async () => {
    const errors = [];
    const { ctx, page } = await newPage(820, 1180, errors);
    let asked = 0, offline = true;
    await page.route(/verovio-module\.mjs/, (route) => { asked++; return offline ? route.abort("internetdisconnected") : route.continue(); });
    await page.goto(BASE + "play.html");
    await page.waitForFunction(() => window.resonateDebug?.().play?.failed === "engine", null, { timeout: 30000 });
    offline = false;
    const before = asked;
    const views = await page.evaluate(() => [...document.getElementById("hands").options].map((o) => o.value));
    await page.selectOption("#hands", views.find((v) => v !== "both"));
    await page.waitForFunction(() => { const d = window.resonateDebug().play; return d.ready || d.failed; }, null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(500);
    const d = await D(page);
    ok(d.ready && !d.failed && asked > before, `after a failed download, Hands → ${d.view}: ready ${d.ready}, failed ${d.failed}, ${asked - before} new requests`);
    ok(!errors.filter((e) => !/verovio|Failed to fetch|ERR_INTERNET|module/i.test(e)).length, `P6: no errors ${errors}`);
    await ctx.close();
  });

  console.log(`${passes} passed, ${fails} failed`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
