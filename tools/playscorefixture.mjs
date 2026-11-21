// Synthetic MusicXML fixtures for the Play page's Full score view (no licensed content), written to
// /home/user/tools/fixtures/play/:
//   score-pvg.musicxml — Audiveris-style: P1 Voice (rests through a 12-bar intro; 2 stanzas, real
//     1./2. endings, segno, D.S. al Coda, To Coda, coda, rehearsal B, tempo — marks in bars the
//     voice rests through), P2 Piano
//     (2 staves, chords in both hands; its left hand rests through bars 20–27; bogus endings in bars 4–5 = an 8va misread;
//     2 stray syllables), P3 Guitar (plays bars 8–15 and 32–35 = 30% of bars; 1 stray syllable),
//     P4 "Voice" (2 notes, 1 syllable — a spurious part, < 10% of bars)
//   score-duet.musicxml — Songbird-like: P1 a spurious "Voice" on top (3 notes) holding the road map
//     (endings, D.S., tempo), P2 the duet on one staff (two voices, his words on line 2), P3 Piano
//   score-duet-partner.musicxml — the same with P1 the partner's own staff (5 notes, all sung)
//   score-duet-spurious.musicxml — score-duet with the partner's own staff (4 notes, all sung) as P4,
//     listed second: the view's top part is sparse and the road map's home (P1) is dropped
//   score-partner-rit.musicxml — score-duet-partner from MuseScore, a "rit." on P1 where she rests
//   score-voice-partner.musicxml — no piano: P1 a partner singing 2 bars of 24 (all sung), P2 the voice
//   score-guitar.musicxml — no piano: P1 Voice + P2 Guitar (plays throughout, 1 stray syllable)
//   score-tunein.musicxml — one piano part, the tune with words in staff 1, 3 stray syllables in staff 2
// usage: node playscorefixture.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "play");
fs.mkdirSync(OUT, { recursive: true });

const TYPE = { 4: "whole", 2: "half", 1: "quarter" };
// { p: "C5" | null, d, staff, voice, chord, lyric: [syl,text] | text, lyric2, stem }
function note(n, staves) {
  const x = ["<note>"];
  if (n.chord) x.push("<chord/>");
  if (n.p) {
    const m = /^([A-G])(#|b)?(\d)$/.exec(n.p);
    x.push(`<pitch><step>${m[1]}</step>${m[2] ? `<alter>${m[2] === "#" ? 1 : -1}</alter>` : ""}<octave>${m[3]}</octave></pitch>`);
  } else x.push(n.d === 4 && !n.partial ? `<rest measure="yes"/>` : "<rest/>");
  x.push(`<duration>${n.d}</duration><voice>${n.voice || 1}</voice><type>${TYPE[n.d]}</type>`);
  if (n.p && n.stem) x.push(`<stem>${n.stem}</stem>`);
  if (staves > 1) x.push(`<staff>${n.staff || 1}</staff>`);
  const lyr = (l, num) => {
    if (!l) return;
    const [syl, text] = Array.isArray(l) ? l : ["single", l];
    x.push(`<lyric number="${num}"><syllabic>${syl}</syllabic><text>${text}</text></lyric>`);
  };
  lyr(n.lyric, 1);
  lyr(n.lyric2, 2);
  x.push("</note>");
  return x.join("");
}
const backup = (d) => `<backup><duration>${d}</duration></backup>`;
const dir = (inner, extra = "", placement = "above", staff = 0) => `<direction placement="${placement}"><direction-type>${inner}</direction-type>${staff ? `<staff>${staff}</staff>` : ""}${extra}</direction>`;
const words = (w) => dir(`<words>${w}</words>`);
const barline = (loc, inner) => `<barline location="${loc}">${inner}</barline>`;
const attrs = ({ staves = 1, clefs = [["G", 2]], key = 0 } = {}) =>
  `<attributes><divisions>1</divisions><key><fifths>${key}</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>` +
  (staves > 1 ? `<staves>${staves}</staves>` : "") +
  clefs.map(([s, l, oc], i) => `<clef${staves > 1 ? ` number="${i + 1}"` : ""}><sign>${s}</sign><line>${l}</line>${oc ? `<clef-octave-change>${oc}</clef-octave-change>` : ""}</clef>`).join("") + "</attributes>";

// One part: measures[i] = { pre (before the notes), notes: [..], post (after: right barline), staves }
function part(id, ms, staves = 1) {
  const out = [`<part id="${id}">`];
  ms.forEach((m, i) => {
    out.push(`<measure number="${i + 1}">`);
    if (m.pre) out.push(m.pre);
    // notes per staff: staff 1 then backup then staff 2
    const s1 = m.notes.filter((n) => (n.staff || 1) === 1), s2 = m.notes.filter((n) => n.staff === 2);
    for (const n of s1) out.push(note(n, staves));
    if (s2.length) { out.push(backup(4)); for (const n of s2) out.push(note(n, staves)); }
    if (m.post) out.push(m.post);
    out.push("</measure>");
  });
  out.push("</part>");
  return out.join("\n");
}
function score(title, software, parts) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
<movement-title>${title}</movement-title>
<identification><encoding><software>${software}</software></encoding></identification>
<part-list>
${parts.map((p) => `<score-part id="${p.id}"><part-name>${p.name}</part-name>${p.instr ? `<score-instrument id="${p.id}-I1"><instrument-name>${p.instr}</instrument-name></score-instrument>` : ""}${p.program ? `<midi-instrument id="${p.id}-I1"><midi-program>${p.program}</midi-program></midi-instrument>` : ""}</score-part>`).join("\n")}
</part-list>
${parts.map((p) => p.xml).join("\n")}
</score-partwise>
`;
}

const TUNE = ["C5", "D5", "E5", "F5", "G5", "F5", "E5", "D5"];
const W1 = ["Sing", "a", "long", "line", "to", "the", "end", "now"];
const W2 = ["one", "more", "time", "with", "a", "sec", "ond", "verse"];
const sung = (mi, k = 0, v2 = false) => Array.from({ length: 4 }, (_, j) => ({ p: TUNE[(mi + j + k) % 8], d: 1, lyric: W1[(mi * 4 + j) % 8], ...(v2 ? { lyric2: W2[(mi * 4 + j) % 8] } : {}) }));
const rest4 = (staff) => ({ p: null, d: 4, ...(staff ? { staff } : {}) });

// ---------------------------------------------------------------- score-pvg
function scorePvg() {
  const M = 40;
  const v = [], pn = [], g = [], s4 = [];
  for (let mi = 0; mi < M; mi++) {
    // P1 Voice
    const singing = (mi >= 12 && mi <= 23) || mi >= 32;
    const m = { notes: singing ? sung(mi, 0, mi >= 12 && mi <= 17) : [rest4()] };
    let pre = "";
    if (mi === 0) pre += attrs() + dir(`<metronome><beat-unit>quarter</beat-unit><per-minute>96</per-minute></metronome>`, `<sound tempo="96"/>`);
    if (mi === 12) pre += barline("left", `<bar-style>heavy-light</bar-style><repeat direction="forward"/>`) + dir("<segno/>") + words("Verse");
    if (mi === 16) pre += barline("left", `<ending number="1" type="start">1.</ending>`);
    if (mi === 17) pre += barline("left", `<ending number="2" type="start">2.</ending>`);
    if (mi === 24) pre += dir("<rehearsal>B</rehearsal>");
    if (mi === 27) pre += words("D.S. al Coda");
    if (mi === 29) pre += words("To Coda");
    if (mi === 32) pre += dir("<coda/>");
    m.pre = pre;
    if (mi === 16) m.post = barline("right", `<bar-style>light-heavy</bar-style><ending number="1" type="stop"/><repeat direction="backward"/>`);
    if (mi === 17) m.post = barline("right", `<ending number="2" type="discontinue"/>`);
    v.push(m);
    // P2 Piano: RH chords, LH half notes (rests in 20–27); bogus endings (an 8va) in 4–5
    const rh = [0, 1, 2, 3].flatMap(() => [{ p: "E4", d: 1, staff: 1 }, { p: "G4", d: 1, staff: 1, chord: true }, { p: "C5", d: 1, staff: 1, chord: true }]);
    if (mi === 10) { rh[0].lyric = "xx"; rh[3].lyric = "yy"; }
    const lh = mi >= 20 && mi <= 27 ? [{ ...rest4(2), voice: 5 }] : [{ p: "C3", d: 2, staff: 2, voice: 5 }, { p: "G3", d: 2, staff: 2, voice: 5, chord: true }, { p: "G2", d: 2, staff: 2, voice: 5 }, { p: "D3", d: 2, staff: 2, voice: 5, chord: true }];
    let ppre = mi === 0 ? attrs({ staves: 2, clefs: [["G", 2], ["F", 4]] }) : "";
    if (mi === 4) ppre += barline("left", `<ending number="1" type="start">1.</ending>`);
    pn.push({ pre: ppre, notes: [...rh, ...lh], post: mi === 5 ? barline("right", `<ending number="1" type="stop"/>`) : "" });
    // P3 Guitar: bars 8–15, 32–35
    const plays = (mi >= 8 && mi <= 15) || (mi >= 32 && mi <= 35);
    const gn = plays ? [{ p: "G4", d: 2 }, { p: "E4", d: 2 }] : [rest4()];
    if (mi === 9) gn[0].lyric = "zz";
    g.push({ pre: mi === 0 ? attrs() : "", notes: gn });
    // P4 spurious "Voice": two notes in bar 12
    s4.push({ pre: mi === 0 ? attrs() : "", notes: mi === 12 ? [{ p: "A4", d: 2, lyric: "oh" }, { p: "B4", d: 2 }] : [rest4()] });
  }
  return score("Synth Score PVG", "Audiveris 5.11.0", [
    { id: "P1", name: "Voice", xml: part("P1", v) },
    { id: "P2", name: "Piano", xml: part("P2", pn, 2) },
    { id: "P3", name: "Guitar", instr: "Acoustic Guitar", program: 25, xml: part("P3", g) },
    { id: "P4", name: "Voice", xml: part("P4", s4) },
  ]);
}

// ---------------------------------------------------------------- score-duet
// partner: P1 is the duet partner's own staff where the print gives her one (Songbird's Eurydice,
// two systems of the song) — every note sung, in bars 3 and 18 — the road map still on it
function scoreDuet({ partner = false, spurious = false, rit = false } = {}) {
  const M = 24;
  const top = [], duet = [], pn = [], own = [];
  for (let mi = 0; mi < M; mi++) {
    // P1: a spurious top part (3 notes), the road map's home
    let pre = mi === 0 ? attrs() + dir(`<metronome><beat-unit>quarter</beat-unit><per-minute>80</per-minute></metronome>`, `<sound tempo="80"/>`) : "";
    if (mi === 8) pre += barline("left", `<repeat direction="forward"/>`);
    if (mi === 14) pre += barline("left", `<ending number="1" type="start">1.</ending>`);
    if (mi === 15) pre += barline("left", `<ending number="2" type="start">2.</ending>`);
    if (mi === 20) pre += words("D.S. al Fine");
    if (rit && mi === 11) pre += words("rit.");
    const post = mi === 14 ? barline("right", `<ending number="1" type="stop"/><repeat direction="backward"/>`) : mi === 15 ? barline("right", `<ending number="2" type="discontinue"/>`) : "";
    top.push({ pre, post, notes: mi === 3 ? [{ p: "A4", d: 2, lyric: "la" }, { p: "B4", d: 1, ...(partner ? { lyric: "lo" } : {}) }, { p: "C5", d: 1, ...(partner ? { lyric: "li" } : {}) }]
      : partner && mi === 18 ? [{ p: "E5", d: 2, lyric: "oh" }, { p: "D5", d: 2, lyric: "my" }] : [rest4()] });
    // (spurious: the partner's own staff as a part of its own, under the spurious top part)
    own.push({ pre: mi === 0 ? attrs() : "", notes: mi === 3 || mi === 18 ? [{ p: "E5", d: 2, lyric: "oh" }, { p: "D5", d: 2, lyric: "my" }] : [rest4()] });
    // P2: the duet (voice 1 her, voice 2 him, both with words) from bar 4
    const dn = mi < 4 ? [rest4()] : [
      { p: TUNE[mi % 8], d: 2, voice: 1, stem: "up", lyric: W1[mi % 8] }, { p: TUNE[(mi + 1) % 8], d: 2, voice: 1, stem: "up", lyric: W1[(mi + 1) % 8] },
    ];
    // (his words under hers, on the second line — as a duet on one staff is printed)
    const low = mi < 4 || mi % 2 ? null : [{ p: "C4", d: 2, voice: 2, stem: "down", lyric2: W2[mi % 8] }, { p: "E4", d: 2, voice: 2, stem: "down", lyric2: W2[(mi + 1) % 8] }];
    duet.push({ pre: mi === 0 ? attrs() : "", notes: dn, post: low ? backup(4) + low.map((n) => note(n, 1)).join("") : "" });
    // P3 Piano, with a bogus ending in bar 6
    const rh = [0, 1].flatMap(() => [{ p: "C4", d: 2, staff: 1 }, { p: "E4", d: 2, staff: 1, chord: true }]);
    const lh = [{ p: "C3", d: 4, staff: 2, voice: 5 }];
    pn.push({ pre: (mi === 0 ? attrs({ staves: 2, clefs: [["G", 2], ["F", 4]] }) : "") + (mi === 6 ? barline("left", `<ending number="1" type="start">1.</ending>`) : ""), notes: [...rh, ...lh], post: mi === 6 ? barline("right", `<ending number="1" type="stop"/>`) : "" });
  }
  return score(spurious ? "Synth Duet Spurious" : partner ? "Synth Duet Partner" : "Synth Duet", rit ? "MuseScore 4.4" : "Audiveris 5.11.0", [
    { id: "P1", name: "Voice", xml: part("P1", top) },
    ...(spurious ? [{ id: "P4", name: "Voice", xml: part("P4", own) }] : []),
    { id: "P2", name: "Voice", xml: part("P2", duet) },
    { id: "P3", name: "Piano", xml: part("P3", pn, 2) },
  ]);
}

// ---------------------------------------------------------------- score-guitar (no piano)
function scoreGuitar() {
  const M = 16, v = [], g = [];
  for (let mi = 0; mi < M; mi++) {
    v.push({ pre: mi === 0 ? attrs() : "", notes: mi < 2 ? [rest4()] : sung(mi) });
    const gn = [{ p: "G3", d: 2 }, { p: "D4", d: 2 }];
    if (mi === 5) gn[1].lyric = "ww";
    g.push({ pre: mi === 0 ? attrs({ clefs: [["G", 2, -1]] }) : "", notes: gn });
  }
  return score("Synth Guitar", "Synth", [
    { id: "P1", name: "Voice", xml: part("P1", v) },
    { id: "P2", name: "Guitar", instr: "Acoustic Guitar", program: 25, xml: part("P2", g) },
  ]);
}

// ---------------------------------------------------------------- score-voice-partner (no piano)
// a partner singing two bars of 24 on a staff of her own over the voice: a Full score of 2 staves
function scoreVoicePartner() {
  const M = 24, a = [], v = [];
  for (let mi = 0; mi < M; mi++) {
    a.push({ pre: mi === 0 ? attrs() : "", notes: mi === 5 || mi === 18 ? [{ p: "E5", d: 2, lyric: "oh" }, { p: "D5", d: 2, lyric: "my" }] : [rest4()] });
    v.push({ pre: mi === 0 ? attrs() : "", notes: sung(mi) });
  }
  return score("Synth Voice Partner", "Synth", [
    { id: "P1", name: "Voice", xml: part("P1", a) },
    { id: "P2", name: "Voice", xml: part("P2", v) },
  ]);
}

// ---------------------------------------------------------------- score-tunein (the tune in the piano)
function scoreTunein() {
  const M = 12, pn = [];
  for (let mi = 0; mi < M; mi++) {
    const rh = sung(mi).map((n) => ({ ...n, staff: 1, stem: "up" }));
    const lh = [{ p: "C3", d: 2, staff: 2, voice: 5 }, { p: "G2", d: 2, staff: 2, voice: 5 }];
    if (mi === 3 || mi === 7) lh[0].lyric = "stray";
    if (mi === 5) lh[1].lyric = "junk";
    pn.push({ pre: mi === 0 ? attrs({ staves: 2, clefs: [["G", 2], ["F", 4]] }) : "", notes: [...rh, ...lh] });
  }
  return score("Synth Tune In Piano", "Synth", [{ id: "P1", name: "Piano", xml: part("P1", pn, 2) }]);
}

fs.writeFileSync(path.join(OUT, "score-pvg.musicxml"), scorePvg());
fs.writeFileSync(path.join(OUT, "score-duet.musicxml"), scoreDuet());
fs.writeFileSync(path.join(OUT, "score-duet-partner.musicxml"), scoreDuet({ partner: true }));
fs.writeFileSync(path.join(OUT, "score-duet-spurious.musicxml"), scoreDuet({ spurious: true }));
fs.writeFileSync(path.join(OUT, "score-partner-rit.musicxml"), scoreDuet({ partner: true, rit: true }));
fs.writeFileSync(path.join(OUT, "score-voice-partner.musicxml"), scoreVoicePartner());
fs.writeFileSync(path.join(OUT, "score-guitar.musicxml"), scoreGuitar());
fs.writeFileSync(path.join(OUT, "score-tunein.musicxml"), scoreTunein());
console.log("wrote score-pvg, score-duet, score-duet-partner, score-duet-spurious, score-partner-rit, score-voice-partner, score-guitar, score-tunein to", OUT);
