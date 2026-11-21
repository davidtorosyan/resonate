// What a stretch of the Score holds, for an assistant (the Resonate MCP server, get_score_view):
// the notes of the bars as text — per part and staff (and voice), each note's place in the bar,
// its name with octave, its written value, ties, rests, lyrics — the chord names, and the bars of
// the view's MusicXML (as Verovio drew them). Pure: DOM-on-XML, no drawing.
//
//   barsText(doc, T, facts, { bars, keep, chords, number }) → text
//   sliceMeasures(xml, from, to) → the MusicXML with only measures [from, to] (indices) of each part

import { fullName } from "./playnames.js?v=94";

const kids = (el, name) => { const out = []; for (const c of el.children) if (c.nodeName === name) out.push(c); return out; };
const kid = (el, name) => { for (const c of el.children) if (c.nodeName === name) return c; return null; };
const txt = (el) => (el ? el.textContent.trim() : "");
const EPS = 1e-6;

// id → its <note> (once a document)
const notesOf = new WeakMap();
function noteEls(doc) {
  let m = notesOf.get(doc);
  if (!m) {
    m = new Map();
    for (const n of doc.getElementsByTagName("note")) { const id = n.getAttribute("id"); if (id) m.set(id, n); }
    notesOf.set(doc, m);
  }
  return m;
}

// A written value: "quarter", "dotted eighth", "eighth (triplet)" — from <type>, <dot> and
// <time-modification>, else from its length in quarters.
const BY_Q = [[4, "whole"], [3, "dotted half"], [2, "half"], [1.5, "dotted quarter"], [1, "quarter"], [0.75, "dotted eighth"], [0.5, "eighth"], [0.375, "dotted 16th"], [0.25, "16th"], [0.125, "32nd"]];
function valueOf(el, d) {
  const type = txt(kid(el, "type"));
  if (type) {
    const dots = kids(el, "dot").length;
    let s = (dots === 1 ? "dotted " : dots === 2 ? "double-dotted " : "") + type;
    const tm = kid(el, "time-modification");
    if (tm) {
      const a = txt(kid(tm, "actual-notes")), n = txt(kid(tm, "normal-notes"));
      s += a === "3" && n === "2" ? " (triplet)" : ` (${a} in ${n})`;
    }
    return s;
  }
  const hit = BY_Q.find(([q]) => Math.abs(q - d) < 1e-3);
  return hit ? hit[1] : `${Math.round(d * 1000) / 1000} quarters`;
}
// Its words: verse 1's syllable ("Kill-", "-ing", "me"), other verses after " / ".
function wordsOf(el) {
  const out = [];
  for (const l of kids(el, "lyric")) {
    const t = txt(kid(l, "text"));
    if (!t) { if (kid(l, "extend")) out.push("_"); continue; }
    const s = txt(kid(l, "syllabic"));
    out.push((s === "middle" || s === "end" ? "-" : "") + t + (s === "begin" || s === "middle" ? "-" : ""));
  }
  return out.length ? `"${out.join(" / ")}"` : "";
}
const beat = (o) => "@" + String(Math.round((o + 1) * 1000) / 1000);
const FIFTHS = ["C♭", "G♭", "D♭", "A♭", "E♭", "B♭", "F", "C", "G", "D", "A", "E", "B", "F♯", "C♯"];
function keyName(fifths, mode) {
  const f = Number(fifths) || 0;
  const n = f === 0 ? "no sharps or flats" : `${Math.abs(f)} ${f > 0 ? "sharp" : "flat"}${Math.abs(f) > 1 ? "s" : ""}`;
  const major = FIFTHS[f + 7], minor = FIFTHS[f + 10] || "";
  return `${n} (${mode === "minor" ? `${minor} minor` : mode === "major" ? `${major} major` : `${major} major / ${minor} minor`})`;
}
const clefName = (c) => {
  const s = txt(kid(c, "sign")), line = txt(kid(c, "line")), oc = Number(txt(kid(c, "clef-octave-change")) || 0);
  const base = s === "G" ? "treble" : s === "F" ? "bass" : s === "C" ? (line === "3" ? "alto" : line === "4" ? "tenor" : "C") : s === "percussion" ? "percussion" : s || "?";
  return base + (oc === -1 ? " 8vb" : oc === 1 ? " 8va" : "");
};

// What each part has in effect at each bar (key, time, clefs) and the parts' names and staves.
function partInfo(doc) {
  const names = new Map();
  for (const sp of doc.getElementsByTagName("score-part")) names.set(sp.getAttribute("id"), txt(kid(sp, "part-name")) || txt(kid(sp, "part-abbreviation")));
  const out = new Map();
  for (const part of kids(doc.documentElement, "part")) {
    const id = part.getAttribute("id");
    let key = null, time = null, staves = 1;
    const clefs = new Map();
    const at = []; // per measure: { key, time, clefs (staff → name), changed: [what changed here] }
    for (const m of kids(part, "measure")) {
      const changed = [];
      for (const a of kids(m, "attributes")) {
        const st = Number(txt(kid(a, "staves")) || 0);
        if (st) staves = st;
        const k = kid(a, "key");
        if (k) { const nk = keyName(txt(kid(k, "fifths")), txt(kid(k, "mode"))); if (nk !== key) { key = nk; changed.push("key"); } }
        const t = kid(a, "time");
        if (t && kid(t, "beats")) { const nt = `${txt(kid(t, "beats"))}/${txt(kid(t, "beat-type"))}`; if (nt !== time) { time = nt; changed.push("time"); } }
        for (const c of kids(a, "clef")) {
          const n = Number(c.getAttribute("number") || 1), nc = clefName(c);
          if (clefs.get(n) !== nc) { clefs.set(n, nc); changed.push("clef" + n); }
        }
      }
      at.push({ key, time, clefs: new Map(clefs), changed });
    }
    const name = names.get(id) || id;
    const keyboard = /piano|pno|keyboard|organ|key/i.test(name) || staves === 2;
    out.set(id, { name, staves, keyboard, at });
  }
  return out;
}
function staffLabel(info, staff) {
  if (!info || info.staves < 2) return info?.name || "?";
  if (info.keyboard && info.staves === 2) return `${info.name}, ${staff === 1 ? "right hand (upper staff)" : "left hand (lower staff)"}`;
  return `${info.name}, staff ${staff}`;
}

// The bars as text: a heading a bar (its number in the MusicXML, the key / time / clefs where they
// start or change), then a line per part / staff / voice: "@beat note value "syllable"".
// T: playtime timeline; facts: playprep noteFacts; keep(e): the view draws it; chords: [{ q, name }]
// (the view's chord moments); number(mi): the bar's number in the MusicXML.
export function barsText(doc, T, facts, { bars, keep = () => true, chords = [], number = (mi) => String(mi + 1) }) {
  const els = noteEls(doc), parts = partInfo(doc);
  const want = new Set(bars);
  const byBar = new Map();
  for (const e of T.els) {
    if (!want.has(e.mi) || !keep(e)) continue;
    let b = byBar.get(e.mi);
    if (!b) byBar.set(e.mi, (b = new Map()));
    const k = `${e.part}|${e.staff}|${e.voice}`;
    if (!b.has(k)) b.set(k, []);
    b.get(k).push(e);
  }
  const lines = [];
  bars.forEach((mi, i) => {
    const bar = T.bars[mi];
    const first = parts.values().next().value?.at[mi];
    let head = `Bar ${number(mi)}`;
    const facts1 = [];
    if (first) {
      if (i === 0 || first.changed.includes("time")) facts1.push(first.time ? `time ${first.time}` : "");
      if (i === 0 || first.changed.includes("key")) facts1.push(first.key ? `key ${first.key}` : "");
    }
    const f1 = facts1.filter(Boolean);
    if (f1.length) head += ` (${f1.join(", ")})`;
    if (bar && bar.len) head += ` — ${Math.round(bar.len * 1000) / 1000} quarters long`;
    lines.push(head);
    const groups = byBar.get(mi) || new Map();
    const keys = [...groups.keys()].sort((a, b) => {
      const [pa, sa, va] = a.split("|"), [pb, sb, vb] = b.split("|");
      const ia = [...parts.keys()].indexOf(pa), ib = [...parts.keys()].indexOf(pb);
      return ia - ib || Number(sa) - Number(sb) || va.localeCompare(vb, undefined, { numeric: true });
    });
    const voices = new Map(); // part|staff → voices there
    for (const k of keys) { const ps = k.split("|").slice(0, 2).join("|"); voices.set(ps, (voices.get(ps) || 0) + 1); }
    for (const k of keys) {
      const [part, staffS, voice] = k.split("|");
      const staff = Number(staffS);
      const info = parts.get(part);
      const at = info?.at[mi];
      let label = staffLabel(info, staff);
      if (at && (i === 0 || at.changed.includes("clef" + staff)) && at.clefs.get(staff)) label += ` [${at.clefs.get(staff)} clef]`;
      if (voices.get(`${part}|${staffS}`) > 1) label += `, voice ${voice}`;
      // a chord (<chord/> members) is one event: its notes low to high
      const evs = [];
      for (const e of groups.get(k).sort((a, b) => a.q - b.q || (a.grace ? -1 : 0) - (b.grace ? -1 : 0))) {
        const last = evs[evs.length - 1];
        if (e.chord && last && Math.abs(last.q - e.q) < EPS && !last.rest) { last.notes.push(e); continue; }
        evs.push({ q: e.q, o: e.o, d: e.d, rest: e.rest, mrest: e.mrest, grace: e.grace, notes: [e] });
      }
      const out = evs.map((ev) => {
        const el = els.get(ev.notes[0].id);
        if (ev.rest) return `${beat(ev.o)} rest ${ev.mrest ? "(whole bar)" : el ? valueOf(el, ev.d) : ""}`.trim();
        const names = ev.notes
          .map((n) => ({ n, f: facts.get(n.id) }))
          .sort((a, b) => (a.f?.midi ?? 0) - (b.f?.midi ?? 0))
          .map(({ n, f }) => (n.tieStop ? "←" : "") + (f ? fullName(f) : "?") + (n.tieStart ? "→" : ""));
        const pitch = names.length > 1 ? `[${names.join(" ")}]` : names[0];
        const words = ev.notes.map((n) => { const x = els.get(n.id); return x ? wordsOf(x) : ""; }).find(Boolean) || "";
        const cue = ev.notes[0].cue ? " (cue)" : "";
        return `${beat(ev.o)} ${ev.grace ? "grace " : ""}${pitch}${ev.grace ? "" : " " + (el ? valueOf(el, ev.d) : "")}${cue}${words ? " " + words : ""}`;
      });
      lines.push(`  ${label}: ${out.join(" · ") || "(nothing)"}`);
    }
    const ch = bar ? chords.filter((c) => c.q >= bar.q - EPS && c.q < bar.q + bar.len - EPS) : [];
    if (ch.length) lines.push(`  Chords: ${ch.map((c) => `${c.name} ${beat(c.q - bar.q)}`).join(" · ")}`);
  });
  return lines.join("\n");
}

export const TEXT_LEGEND = "Each bar: its number in the MusicXML, then one line per part / staff (/ voice): @beat (quarter notes from the bar's start, 1 = the downbeat), the note with its octave (C4 = middle C; a transposing part at concert pitch; [ ] = a chord, low to high), its written value, → = tied to the next note, ← = tied from the one before, then its lyric syllable in quotes. Chords: Resonate's chord names for what the piano part sounds.";

// The MusicXML of measures [from, to] (indices within each part, 0-based): the header (part list
// and all) as it is, each part with only those measures, and — before them, as a comment — the
// divisions, key, time and clefs in effect from earlier bars.
export function sliceMeasures(xml, from, to) {
  const P = /<part(?=[\s>])[^>]*>[\s\S]*?<\/part>/g;
  const M = /<measure(?=[\s>])[^>]*>[\s\S]*?<\/measure>/g;
  let out = "", last = 0, m;
  while ((m = P.exec(xml))) {
    out += xml.slice(last, m.index);
    last = m.index + m[0].length;
    const part = m[0];
    const open = /^<part(?=[\s>])[^>]*>/.exec(part)[0];
    const ms = part.match(M) || [];
    const carry = inEffect(ms.slice(0, from));
    out += open + (carry ? `\n<!-- in effect from earlier bars: ${carry} -->` : "") + "\n" + ms.slice(from, to + 1).join("\n") + "\n</part>";
  }
  return out + xml.slice(last);
}
function inEffect(measures) {
  const last = {};
  for (const ms of measures) {
    for (const a of ms.match(/<attributes>[\s\S]*?<\/attributes>/g) || []) {
      for (const tag of ["divisions", "key", "time", "transpose"]) {
        const x = a.match(new RegExp(`<${tag}(?=[\\s>])[^>]*>[\\s\\S]*?</${tag}>`));
        if (x) last[tag] = x[0];
      }
      for (const c of a.match(/<clef(?=[\s>])[^>]*>[\s\S]*?<\/clef>/g) || []) last["clef" + (/number="(\d+)"/.exec(c)?.[1] || "1")] = c;
    }
  }
  return Object.values(last).join(" ").replace(/\s*\n\s*/g, " ").replace(/--/g, "- -");
}
