// What a stretch of the Score holds, for an assistant (the Resonate MCP server, get_score_view):
// the notes of the bars as text — per part and staff (and voice), each note's place in the bar,
// its name with octave, its written value, ties, rests, lyrics — the chord names, and the bars of
// the view's MusicXML (as Verovio drew them). Pure: DOM-on-XML, no drawing.
//
// A highlight (span: { q0, end, ids? } in written quarters — a stretch dragged on the page: what
// starts in [q0, end); one chord picked by a double-tap: only those notes, ids) is named exactly —
// where it starts and stops (bar + beat), its first and last notes (spanInfo) — and the text
// lists only its notes on each staff line, the rest of each bar after them as context.
//
//   barsText(doc, T, facts, { bars, keep, chords, number, span, fing }) → text
//   spanInfo(doc, T, facts, { span, keep, number }) → { kind, start, end, quarters, bars, first, last, notes, staff? }
//   placeOf(T, q, number, stop) → { bar, beat }
//   sliceMeasures(xml, from, to) → the MusicXML with only measures [from, to] (indices) of each part
//
// Piano fingering (E7, docs/FINGERING.md §6): with `fing` — finger.js fingerNotes' result, or the song
// record's stored form { alg, hand, bpm, sig, n: { id: [h, f, p, x] }, fr } — each keyboard note's hand
// and fingers follow its value, low to high as its names: "@1 [E4 G4 C5] quarter RH 1 2 5", "@1 [G3 B4]
// half LH 1, RH 5" (the left hand takes G3), "–" = no finger. Then the legend is textLegend(fing):
// TEXT_LEGEND + FINGER_LEGEND. Without `fing` the text is what it was, byte for byte.
//   fingOf(fing) → { note(id) → { h, f, p, x } | null, frames: { r, l }, alg, hand, bpm, sig } | null
//   nameOf(e, facts) → "E♭4" (as written; from the MIDI number without facts)
//   staffWords(doc) → (e) → the clef of the staff e is written on ("treble", "bass"…), null where that
//     doesn't tell its staff apart

import { fullName } from "./playnames.js?v=107";
import { barAt } from "./playtime.js?v=107";

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
const r3 = (x) => Math.round(x * 1000) / 1000;
const beat = (o) => "@" + String(r3(o + 1));
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
export function barsText(doc, T, facts, { bars, keep = () => true, chords = [], number = (mi) => String(mi + 1), span = null, fing = null }) {
  const els = noteEls(doc), parts = partInfo(doc), fg = fingOf(fing);
  const inside = span ? inSpan(span) : null;
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
  if (span) lines.push(spanLine(spanInfo(doc, T, facts, { span, keep, number })));
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
    if (span && bar) head += barScope(span, bar);
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
      const say = (ev) => eventText(ev, els, facts, fg);
      if (!inside) { lines.push(`  ${label}: ${evs.map(say).join(" · ") || "(nothing)"}`); continue; }
      // (a highlight: its notes on the line, the rest of the bar after them — a note started before
      // it and still held at its start says so)
      const inn = evs.filter((ev) => ev.notes.some(inside)), out = evs.filter((ev) => !ev.notes.some(inside));
      lines.push(`  ${label}: ${inn.map(say).join(" · ") || "(nothing highlighted)"}`);
      if (out.length) lines.push(`    outside the highlight: ${out.map((ev) => say(ev) + (!ev.rest && ev.q < span.q0 - EPS && ev.q + ev.d > span.q0 + EPS ? " (still sounding)" : "")).join(" · ")}`);
    }
    const ch = bar ? chords.filter((c) => c.q >= bar.q - EPS && c.q < bar.q + bar.len - EPS) : [];
    const chordText = (list) => list.map((c) => `${c.name} ${beat(c.q - bar.q)}`).join(" · ");
    if (ch.length && !span) lines.push(`  Chords: ${chordText(ch)}`);
    else if (ch.length) {
      const inn = ch.filter((c) => c.q >= span.q0 - EPS && c.q < span.end - EPS), out = ch.filter((c) => !inn.includes(c));
      lines.push(`  Chords: ${chordText(inn) || "(none starts in the highlight)"}`);
      if (out.length) lines.push(`    outside the highlight: ${chordText(out)}`);
    }
  });
  return lines.join("\n");
}
// One event (a note, a chord low to high, a rest): "@2 [F4 A4] quarter "syl-"" — with a fingering
// (fg), the hand and fingers after the value: "@2 [F4 A4] quarter RH 2 4 "syl-"".
function eventText(ev, els, facts, fg = null) {
  const el = els.get(ev.notes[0].id);
  if (ev.rest) return `${beat(ev.o)} rest ${ev.mrest ? "(whole bar)" : el ? valueOf(el, ev.d) : ""}`.trim();
  const words = ev.notes.map((n) => { const x = els.get(n.id); return x ? wordsOf(x) : ""; }).find(Boolean) || "";
  const cue = ev.notes[0].cue ? " (cue)" : "";
  const fingers = fg ? fingersOf(ev.notes, facts, fg) : "";
  return `${beat(ev.o)} ${ev.grace ? "grace " : ""}${pitchOf(ev.notes, facts)}${ev.grace ? "" : " " + (el ? valueOf(el, ev.d) : "")}${cue}${fingers}${words ? " " + words : ""}`;
}
// An event's hands and fingers, low to high as pitchOf names its notes: " RH 1 2 5", " LH 1, RH 5"
// (the left hand takes the low note), "–" = no finger (a grace note, a key out of the hand's reach);
// "" when the fingering has none of its notes (another part than the keyboard's).
function fingersOf(notes, facts, fg) {
  const got = notes
    .map((n) => ({ f: facts.get(n.id), r: fg.note(n.id) }))
    .sort((a, b) => (a.f?.midi ?? 0) - (b.f?.midi ?? 0));
  if (!got.some((g) => g.r)) return "";
  const runs = [];
  for (const { r } of got) {
    const h = r ? HAND[r.h] || "?" : "?", d = r && r.f >= 1 && r.f <= 5 ? String(r.f) : "–";
    const last = runs[runs.length - 1];
    if (last && last.h === h) last.d.push(d); else runs.push({ h, d: [d] });
  }
  return " " + runs.map((x) => `${x.h} ${x.d.join(" ")}`).join(", ");
}
// A chord's names low to high (← tied from the note before, → tied to the next): "[F4 A4→]".
function pitchOf(notes, facts, ties = true) {
  const names = notes
    .map((n) => ({ n, f: facts.get(n.id) }))
    .sort((a, b) => (a.f?.midi ?? 0) - (b.f?.midi ?? 0))
    .map(({ n, f }) => (ties && n.tieStop ? "←" : "") + (f ? fullName(f) : "?") + (ties && n.tieStart ? "→" : ""));
  return names.length > 1 ? `[${names.join(" ")}]` : names[0];
}

// --- a highlight --------------------------------------------------------------------------------
// span: { q0, end, ids? } → is a timeline element in it (ids: one chord picked — only those notes)
const inSpan = (span) => {
  if (span.ids) { const ids = new Set(span.ids); return (e) => ids.has(e.id); }
  return (e) => e.q >= span.q0 - EPS && e.q < span.end - EPS;
};
// Where q is: { bar (its number), beat (quarters from the bar's start, 1 = the downbeat) }. As an
// end (stop: true) a barline is the next bar's downbeat, the score's end its last bar's end.
export function placeOf(T, q, number, stop = false) {
  let mi = barAt(T, stop ? q - 1e-4 : q);
  const b = T.bars[mi];
  if (stop && mi + 1 < T.bars.length && Math.abs(b.q + b.len - q) < EPS) return { bar: number(mi + 1), beat: 1 };
  return { bar: number(mi), beat: r3(q - b.q + 1) };
}
// What a highlight is, for an assistant: a stretch (what starts in [q0, end) on every staff the
// view shows) or one chord on one staff (ids); its start and end (end: where it stops, not
// included); its first and last notes — every staff / voice's chord at its earliest and latest
// onset (pitched notes, not grace notes); how many notes are in it.
export function spanInfo(doc, T, facts, { span, keep = () => true, number = (mi) => String(mi + 1) }) {
  const els = noteEls(doc), parts = partInfo(doc), inside = inSpan(span);
  const notes = T.els.filter((e) => keep(e) && inside(e) && !e.rest && !e.grace && e.midi != null);
  // (how many voices each staff has in a bar: a voice is named where its staff has more than one)
  const voices = new Map();
  const bars = new Set(notes.map((e) => e.mi));
  for (const e of T.els) if (bars.has(e.mi) && keep(e)) { const k = `${e.mi}|${e.part}|${e.staff}`; if (!voices.has(k)) voices.set(k, new Set()); voices.get(k).add(e.voice); }
  const events = (q) => {
    const by = new Map();
    for (const e of notes) if (Math.abs(e.q - q) < EPS) { const k = `${e.part}|${e.staff}|${e.voice}`; if (!by.has(k)) by.set(k, []); by.get(k).push(e); }
    const order = [...parts.keys()];
    return [...by.values()].sort((a, b) => order.indexOf(a[0].part) - order.indexOf(b[0].part) || a[0].staff - b[0].staff || a[0].voice.localeCompare(b[0].voice, undefined, { numeric: true })).map((ns) => {
      const e = ns[0], info = parts.get(e.part), el = els.get(e.id);
      return {
        notes: ns.map((n) => ({ n, m: facts.get(n.id)?.midi ?? 0 })).sort((a, b) => a.m - b.m).map(({ n }) => { const f = facts.get(n.id); return f ? fullName(f) : "?"; }),
        part: e.part, part_name: info?.name ?? e.part, staff: e.staff, staff_name: staffLabel(info, e.staff), voice: e.voice,
        bar: number(e.mi), beat: r3(e.o + 1), value: el ? valueOf(el, e.d) : null,
        ...(voices.get(`${e.mi}|${e.part}|${e.staff}`)?.size > 1 ? { voices_on_staff: voices.get(`${e.mi}|${e.part}|${e.staff}`).size } : {}),
      };
    });
  };
  const qs = notes.map((e) => e.q);
  const first = qs.length ? events(Math.min(...qs)) : [], last = qs.length ? events(Math.max(...qs)) : [];
  const out = {
    kind: span.ids ? "note" : "stretch",
    start: placeOf(T, span.q0, number), end: placeOf(T, span.end, number, true), quarters: r3(span.end - span.q0),
    bars: [number(barAt(T, span.q0)), number(barAt(T, span.end - 1e-4))],
    first, last, notes: notes.length,
  };
  if (span.ids && first[0]) out.staff = first[0].staff_name;
  if (span.end >= T.length - EPS) out.to_end_of_score = true;
  return out;
}
// The highlight's first line in the text.
function spanLine(s) {
  const at = (p) => `bar ${p.bar} @${p.beat}`;
  const who = (list) => list.map((x) => `${x.notes.length > 1 ? `[${x.notes.join(" ")}]` : x.notes[0]} (${x.staff_name}${x.voices_on_staff ? `, voice ${x.voice}` : ""})`).join(" · ");
  if (s.kind === "note") {
    if (!s.first.length) return `Highlighted: one note at ${at(s.start)}.`;
    const one = s.notes === 1, value = [...new Set(s.first.map((x) => x.value).filter(Boolean))].join(" / ");
    return `Highlighted: one ${one ? "note" : "chord"} only, on one staff — ${who(s.first)}${value ? `, ${value}` : ""}, at ${at(s.start)}; the rest of the bar below is context.`;
  }
  const end = s.to_end_of_score ? "to the end of the score" : s.end.beat === 1 ? `to the end of bar ${s.bars[1]}` : `up to ${at(s.end)} (not included)`;
  let t = `Highlighted: from ${at(s.start)} ${end} — ${s.quarters} quarter${s.quarters === 1 ? "" : "s"}, the notes starting in it on every staff shown (${s.notes} note${s.notes === 1 ? "" : "s"}).`;
  if (s.first.length) t += ` First: ${who(s.first)} at ${at({ bar: s.first[0].bar, beat: s.first[0].beat })}.`;
  if (s.last.length) t += ` Last: ${who(s.last)} at ${at({ bar: s.last[0].bar, beat: s.last[0].beat })}.`;
  return t;
}
// A bar's own share of the highlight, after its heading: "; highlighted from @2 up to @4" (a part
// of it), "; highlighted: @2, Piano, right hand only" (one chord); nothing when it's all in.
function barScope(span, bar) {
  const b0 = bar.q, b1 = bar.q + bar.len;
  if (span.ids) return "";
  const from = span.q0 > b0 + EPS && span.q0 < b1 - EPS, to = span.end > b0 + EPS && span.end < b1 - EPS;
  if (!from && !to) return "";
  return `; highlighted${from ? ` from ${beat(span.q0 - b0)}` : ""}${to ? ` up to ${beat(span.end - b0)}` : ""}`;
}

export const TEXT_LEGEND = "Each bar: its number in the MusicXML, then one line per part / staff (/ voice): @beat (quarter notes from the bar's start, 1 = the downbeat), the note with its octave (C4 = middle C; a transposing part at concert pitch; [ ] = a chord, low to high), its written value, → = tied to the next note, ← = tied from the one before, then its lyric syllable in quotes. Chords: Resonate's chord names for what the piano part sounds. The first line names the highlight exactly — a stretch from bar @beat up to bar @beat (not included), or one note / chord on one staff (a double-tap on it); each staff line then lists only the highlighted notes, and \"outside the highlight:\" the rest of that bar, for context (\"still sounding\" = started before the highlight and held into it).";

// --- a fingering (E7) ---------------------------------------------------------------------------
const HAND = { r: "RH", l: "LH" };
const NORM = Symbol("fing");
// finger.js fingerNotes' result ({ notes: Map(id → { h, f, p, x }), frames: { r: [{ q0, keys }], l } }),
// or the song record's stored form ({ alg, hand, bpm, sig, n: { id: [h, f, p, x] }, fr: { r: [[q0,
// m1…m5]], l } }) → one shape: { note(id) → { h, f, p, x } | null, frames, alg, hand, bpm, sig }; null:
// no fingering.
export function fingOf(fing) {
  if (!fing || typeof fing !== "object") return null;
  if (fing[NORM]) return fing;
  let note = null;
  if (fing.notes instanceof Map) note = (id) => fing.notes.get(id) || null;
  else if (fing.n && typeof fing.n === "object") {
    note = (id) => {
      const a = Object.hasOwn(fing.n, id) ? fing.n[id] : null;
      return Array.isArray(a) ? { h: a[0], f: a[1], p: a[2], x: a[3] || "" } : null;
    };
  }
  if (!note) return null;
  const list = (fs) => (Array.isArray(fs) ? fs : [])
    .map((x) => (Array.isArray(x) ? { q0: x[0], keys: x.slice(1) } : x))
    .filter((x) => x && Array.isArray(x.keys));
  const fr = fing.frames || fing.fr || {};
  return { [NORM]: true, note, frames: { r: list(fr.r), l: list(fr.l) }, alg: fing.alg ?? null, hand: fing.hand ?? null, bpm: fing.bpm ?? null, sig: fing.sig ?? null };
}
const NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
export const midiName = (m) => `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
// A timeline element's name with octave: as written (the facts), else from its MIDI number.
export function nameOf(e, facts) {
  const f = facts?.get?.(e.id);
  return f ? fullName(f) : e.midi != null ? midiName(e.midi) : "?";
}
// The staff a timeline element is written on, by its clef at that bar ("treble", "bass"…) — null
// where that doesn't tell it apart (another staff of its part has the same clef there; no doc).
export function staffWords(doc) {
  const parts = doc ? partInfo(doc) : new Map();
  return (e) => {
    const info = parts.get(e.part), at = info?.at[e.mi];
    const clef = at?.clefs.get(e.staff);
    if (!clef) return null;
    for (const [n, c] of at.clefs) if (n !== e.staff && n <= info.staves && c === clef) return null;
    return clef;
  };
}
export const FINGER_LEGEND = "Fingering (Resonate's suggestion — other fingerings can be right): after a keyboard note's value, the hand and its fingers, low to high as the notes are named: RH / LH = right / left hand, 1 = thumb … 5 = little finger, – = none suggested (a grace note, or a key the hand can't reach); \"LH 1, RH 5\" = the left hand takes the low note though it's written on the other staff.";
// The legend for barsText's output: with a fingering, the fingers' line too.
export const textLegend = (fing) => (fingOf(fing) ? `${TEXT_LEGEND} ${FINGER_LEGEND}` : TEXT_LEGEND);

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
