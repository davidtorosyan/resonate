// Piano fingering as text, for assistants (E7, docs/FINGERING.md §4 and §6): the row the app keeps in
// public.score_fingering (assist.js shareFingering), which the MCP server's read_resonate fingering
// answers from. Pure: no DOM of its own (scoretext.js's helpers read the MusicXML document when given).
//
//   const data = fingerText({ fing, T, numberOf, title, song, facts, doc });
//
// fing: finger.js fingerNotes' result or the song record's stored `fing` (scoretext.js fingOf takes
//   both); its alg, hand (size), bpm and sig are copied into the row (or given here: alg, hand, bpm,
//   sig — alg defaults to finger.js ALG).
// T: playtime.js timeline(doc, facts) — every note with its id, part, staff, voice, bar index (mi),
//   written place (q; o from the bar's start) and sounding MIDI number.
// numberOf(mi): a bar's number in the MusicXML. facts (optional): playprep noteFacts — names spelled
//   as written (else from the MIDI number). doc (optional): the MusicXML document — a moved note's
//   staff named by its clef ("written on the treble staff"; else "on the right-hand staff").
//
// → { v, alg, hand, bpm, sig, song, title,
//     bars: [{ bar, text, rh?, lh? }]  every written bar in order: text = the whole bar, rh / lh = one
//       hand's part of it (absent when that hand plays nothing there) — read_resonate's hand filter;
//     moved: [{ bar, beat, note, staff, hand, finger }]  notes the other hand plays than the staff
//       they're written on (staff: its clef, or "right-hand" / "left-hand"; hand "rh" | "lh"; finger
//       null when out of reach);
//     wide: [{ bar, beat, hand, notes }]  keys a hand can't reach at an onset (no finger) }
// or null (no fingering, no timeline).
//
// A bar, in scoretext.js's terms (C4 = middle C; @beat = quarters from the bar's start, 1 = the
// downbeat; [ ] = struck together, low to high, the fingers in the same order):
//   Bar 12 — RH: @1 [E4 G4 C5] 1 2 5 · @2.5 D5 4 · @3 C5 5 — LH: @1 C3 5 · @1 G3 1 (written on the
//   treble staff) · @3 E3 3 — RH position: thumb on E4 — LH position: thumb on G3
// A tie's continuation isn't listed (the finger that struck it holds it): a hand that only holds
// through a bar reads "RH: held". – = no finger (a grace note, a key out of reach: "(G3 out of reach)").
// Position = the hand's frame (the ghost hand): the key under its thumb; several in a bar: "RH
// positions: thumb on E4 · @3 thumb on G4".

import { ALG } from "./finger.js?v=112";
import { fingOf, nameOf, midiName, staffWords } from "./scoretext.js?v=112";

export const FINGER_TEXT_V = 1;
const EPS = 1e-6;
const r3 = (x) => Math.round(x * 1000) / 1000;
const HANDS = [["r", "RH", "rh"], ["l", "LH", "lh"]];

export function fingerText({ fing, T, numberOf = (mi) => String(mi + 1), title = "", song = "", facts = null, doc = null, alg, hand, bpm, sig } = {}) {
  const F = fingOf(fing);
  if (!F || !T?.bars || !Array.isArray(T.els)) return null;
  const words = staffWords(doc);
  const name = (e) => nameOf(e, facts);
  // the keyboard part's notes, per bar and hand: { e, r (h, f, p, x) }
  const byBar = new Map();
  for (const e of T.els) {
    if (e.rest || e.midi == null) continue;
    const r = F.note(e.id);
    if (!r || (r.h !== "r" && r.h !== "l")) continue;
    let b = byBar.get(e.mi);
    if (!b) byBar.set(e.mi, (b = { r: [], l: [] }));
    b[r.h].push({ e, r });
  }
  const moved = [], wide = [];
  const bars = T.bars.map((_, mi) => {
    const bar = String(numberOf(mi));
    const b = byBar.get(mi) || { r: [], l: [] };
    const parts = {}; // hand → { play: "RH: …", pos: "RH position: …" }
    for (const [h, label, key] of HANDS) {
      const list = b[h].slice().sort((x, y) => x.e.q - y.e.q || x.e.midi - y.e.midi);
      if (!list.length) continue;
      const struck = [], seen = new Set();
      for (const n of list) {
        if (/t/.test(n.r.x || "")) continue; // (a tie's continuation: held by the finger that struck it)
        const k = `${Math.round(n.e.q / EPS)}|${n.e.midi}|${n.e.grace ? 1 : 0}`;
        if (seen.has(k)) continue; // (a key both staves strike: one key)
        seen.add(k);
        struck.push(n);
      }
      // events: at one onset, the hand's own notes as one chord, the moved ones as another (per staff
      // they're written on), grace notes before them
      const evs = new Map();
      for (const n of struck) {
        const grace = !!n.e.grace, m = !grace && /m/.test(n.r.x || "");
        const where = m ? words(n.e) || (h === "l" ? "right-hand" : "left-hand") : "";
        const k = `${Math.round(n.e.q / EPS)}|${grace ? 0 : m ? 2 : 1}|${where}`;
        if (!evs.has(k)) evs.set(k, { q: n.e.q, o: n.e.o, rank: grace ? 0 : m ? 2 : 1, grace, where, notes: [] });
        evs.get(k).notes.push(n);
      }
      const order = [...evs.values()].sort((x, y) => x.q - y.q || x.rank - y.rank || x.where.localeCompare(y.where));
      const say = order.map((ev) => {
        const ns = ev.notes.sort((x, y) => x.e.midi - y.e.midi);
        const names = ns.map((n) => name(n.e));
        const digits = ns.map((n) => (!ev.grace && n.r.f >= 1 && n.r.f <= 5 ? String(n.r.f) : "–"));
        const out = ns.filter((n) => /w/.test(n.r.x || ""));
        const beat = r3(ev.o + 1);
        if (out.length) wide.push({ bar, beat, hand: key, notes: out.map((n) => name(n.e)) });
        if (ev.where) {
          for (const n of ns) moved.push({ bar, beat, note: name(n.e), staff: ev.where, hand: key, finger: n.r.f >= 1 && n.r.f <= 5 && !/w/.test(n.r.x || "") ? n.r.f : null });
        }
        const what = names.length > 1 ? `[${names.join(" ")}]` : names[0];
        const tail = [
          ev.where ? `(written on the ${ev.where} staff)` : "",
          out.length ? `(${out.map((n) => name(n.e)).join(" ")} out of reach)` : "",
        ].filter(Boolean).join(" ");
        return `@${beat} ${ev.grace ? "grace " : ""}${what} ${digits.join(" ")}${tail ? " " + tail : ""}`;
      });
      const play = `${label}: ${say.length ? say.join(" · ") : "held"}`;
      // positions: the hand's frames its notes use in this bar, in order (the same thumb twice in a row:
      // once — the other fingers' keys show in the notes' own fingers)
      const pos = [];
      for (const n of list) {
        const fr = F.frames[h]?.[n.r.p];
        if (!fr || !Number.isFinite(fr.keys?.[0])) continue;
        const thumb = fr.keys[0];
        if (pos.length && pos[pos.length - 1].thumb === thumb) continue;
        // (spelled as the note the thumb plays there, else from the key)
        const own = list.find((x) => x.r.p === n.r.p && x.r.f === 1 && x.e.midi === thumb);
        pos.push({ thumb, o: n.e.o, name: own ? name(own.e) : midiName(thumb) });
      }
      const where = pos.map((p, i) => `${i ? `@${r3(p.o + 1)} ` : ""}thumb on ${p.name}`);
      parts[h] = { play, pos: where.length ? `${label} position${where.length > 1 ? "s" : ""}: ${where.join(" · ")}` : "" };
    }
    const seg = (h) => parts[h] ? [parts[h].play, parts[h].pos].filter(Boolean).join(" — ") : undefined;
    const all = [parts.r?.play, parts.l?.play, parts.r?.pos, parts.l?.pos].filter(Boolean);
    const out = { bar, text: `Bar ${bar} — ${all.length ? all.join(" — ") : "(rests)"}` };
    const rh = seg("r"), lh = seg("l");
    if (rh) out.rh = rh;
    if (lh) out.lh = lh;
    return out;
  });
  return {
    v: FINGER_TEXT_V,
    alg: Number.isInteger(alg) ? alg : Number.isInteger(F.alg) ? F.alg : ALG,
    hand: String(hand ?? F.hand ?? "sb"),
    bpm: bpm ?? F.bpm ?? null,
    sig: sig ?? F.sig ?? null,
    song: String(song ?? ""), title: String(title ?? ""),
    bars, moved, wide,
  };
}
