// Play page: the score as a piano player reads it. Pure DOM-on-XML (no rendering): the parts,
// the views (the full score / both hands / one hand / the tune), each note's pitch facts as
// written, and the MusicXML each view hands to Verovio.
//
//   const P = prepare(xml);              // { doc, parts, views, facts }
//   const v = buildView(P.doc, P.views.rh);  // { xml, pitched, firstMeasureAtOrAfter }
//
// Note ids ("n<i>", document order over the whole score) are set once on the parsed score, so
// every view shares them and the facts map (built from the whole score) serves them all.
import { pickMelody } from "./musicxml.js?v=83";

const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const PIANO = /piano|pno|keyboard|klavier|clavier|organ/i;
export const VIEW_LABELS = { score: "Full score", both: "Both hands", rh: "Right hand", lh: "Left hand", melody: "Melody" };

const kids = (el, name) => { const out = []; for (const c of el.children) if (c.nodeName === name) out.push(c); return out; };
const kid = (el, name) => { for (const c of el.children) if (c.nodeName === name) return c; return null; };
const txt = (el) => (el ? el.textContent.trim() : "");
const num = (el, d = 0) => { const s = txt(el); if (s === "") return d; const v = Number(s); return Number.isFinite(v) ? v : d; };
const partsIn = (root) => kids(root, "part");

// Parse once; throws on anything that isn't a partwise score.
export function prepare(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Not valid XML");
  if (doc.documentElement.nodeName !== "score-partwise") throw new Error("Not a partwise MusicXML score");
  const parts = partsOf(doc);
  if (!parts.length) throw new Error("Score has no parts");
  const facts = noteFacts(doc);
  return { doc, parts, views: planViews(doc, parts), facts };
}

// Every <note> without an id gets "n<i>" (i = its index among all notes, document order).
// Idempotent; an id already taken by another element gets a suffix.
export function ensureIds(doc) {
  const notes = doc.getElementsByTagName("note");
  let missing = false;
  for (const n of notes) if (!n.hasAttribute("id")) { missing = true; break; }
  if (!missing) return;
  const used = new Set([...doc.querySelectorAll("[id]")].map((e) => e.getAttribute("id")));
  let i = 0;
  for (const n of notes) {
    if (!n.hasAttribute("id")) {
      let id = "n" + i;
      while (used.has(id)) id += "_";
      n.setAttribute("id", id);
      used.add(id);
    }
    i++;
  }
}

// → [{ id, name, instrument, program, staves, notes (pitched), lyrics (notes with a syllable),
//      clefs: { staff: sign of its first clef }, measures, live (share of measures with pitched notes) }]
export function partsOf(doc) {
  const root = doc.documentElement;
  const list = kid(root, "part-list");
  const byId = new Map((list ? kids(list, "score-part") : []).map((sp) => [sp.getAttribute("id"), sp]));
  const out = [];
  for (const part of partsIn(root)) {
    const id = part.getAttribute("id"), sp = byId.get(id) || null;
    const measures = kids(part, "measure");
    let staves = 1, notes = 0, lyrics = 0, live = 0;
    const clefs = {};
    for (const m of measures) {
      let any = false;
      for (const el of m.children) {
        if (el.nodeName === "attributes") {
          for (const a of el.children) {
            if (a.nodeName === "staves") staves = Math.max(staves, num(a, 1));
            else if (a.nodeName === "clef") { const n = a.getAttribute("number") || "1"; if (!(n in clefs)) clefs[n] = txt(kid(a, "sign")); }
          }
        } else if (el.nodeName === "note") {
          if (kid(el, "pitch")) { notes++; any = true; }
          if (kid(el, "lyric")) lyrics++;
        }
      }
      if (any) live++;
    }
    const prog = sp && sp.querySelector("midi-instrument > midi-program");
    out.push({
      id, name: sp ? txt(kid(sp, "part-name")) : "", instrument: sp ? txt(sp.querySelector("score-instrument > instrument-name")) : "",
      program: prog ? num(prog, null) : null, staves, notes, lyrics, clefs,
      measures: measures.length, live: measures.length ? live / measures.length : 0,
    });
  }
  return out;
}

// The views a pianist gets (§5): { score?, both, rh?, lh?, melody? }, in that order (fullest
// first). Each: { key, label, kind, parts: [ids], staff (number | null), voice (string | null),
// brace, lyrics, staves (per system), low: ["part|staff" read from the bottom: a bar's floor name
// at Some is its bass note] }. The full score also has words { part (the tune's), staff (null, or
// the one staff of it that keeps its words: the tune inside the keyboard part), also (other sung
// parts that keep theirs), tune { staff, voice } (where its syllables gather) }, sung (the parts
// that sing, not the keyboard's: the voice's strip colour), braced (the hymn pair braced as Both)
// and condense (≥ 3 staves: a staff resting a whole system is left out of it, as printed).
export function planViews(doc, parts = partsOf(doc)) {
  const view = (key, o) => ({ key, label: VIEW_LABELS[key], kind: "piano", staff: null, voice: null, brace: false, lyrics: false, staves: 1, ...o });
  const views = {};
  // (parts that really play: pitched notes in ≥ 10% of measures — not a few stray OCR notes)
  const live = (p) => p.notes > 0 && p.live >= 0.1;
  let piano = null;
  const pianos = parts.filter((p) => p.notes > 0 && (p.staves >= 2 || PIANO.test(p.name) || PIANO.test(p.instrument) || (p.program >= 1 && p.program <= 8)));
  if (pianos.length) {
    piano = pianos.reduce((a, b) => (b.notes > a.notes ? b : a));
    views.both = view("both", { parts: [piano.id], staves: piano.staves });
    if (piano.staves === 2) {
      views.rh = view("rh", { parts: [piano.id], staff: 1 });
      views.lh = view("lh", { parts: [piano.id], staff: 2 });
    }
  } else {
    // No piano: the parts that really play (pitched notes in ≥ 10% of measures). A treble
    // part over a bass part (a hymn's SA + TB) is the keyboard score: braced as a grand staff.
    let live = parts.filter((p) => p.notes > 0 && p.live >= 0.1);
    if (!live.length) live = parts.filter((p) => p.notes > 0);
    if (!live.length) live = parts.slice(0, 1);
    const hymn = live.length === 2 && live.every((p) => p.staves === 1) && live[0].clefs["1"] === "G" && live[1].clefs["1"] === "F";
    views.both = view("both", { kind: hymn ? "hymn" : "parts", parts: live.map((p) => p.id), brace: hymn, staves: live.reduce((s, p) => s + p.staves, 0) });
    if (hymn) {
      views.rh = view("rh", { kind: "hymn", parts: [live[0].id] });
      views.lh = view("lh", { kind: "hymn", parts: [live[1].id] });
    }
  }
  const mel = parts.length ? pickMelody(doc.documentElement) : null;
  const mp = mel && parts.find((p) => p.id === mel.partId);
  // A part that sings: the tune's, or one (not the keyboard's) whose notes mostly carry words — a
  // second singer; not a piano's or a cue staff's stray OCR syllables (Piano Man: 6 in 2019, 13
  // in 401).
  const singer = (p) => p.id !== piano?.id && ((mp && p.id === mp.id && mp.lyrics > 0) || (p.notes > 0 && p.lyrics >= 0.25 * p.notes));
  // (a score without words has no sung tune: pickMelody's fallback is just the first voice)
  let score = null;
  if (mp && mp.lyrics > 0) {
    const both = views.both;
    const melody = view("melody", { kind: "melody", parts: [mp.id], staff: mp.staves > 1 ? Number(mel.staff) || 1 : null, voice: String(mel.voice), lyrics: true });
    // Hidden when it shows exactly what Both shows (a voice-only song): Both then is the tune,
    // with its words.
    if (sameNotes(doc, both, melody)) both.lyrics = true;
    else views.melody = melody;
    // The full score, as piano/vocal music is printed: the tune's staff with its words over the
    // piano (and any other part that plays), in score order. Offered when it shows more than
    // Both: more parts, or the words Both leaves out (the tune inside the piano, a hymn).
    const keep = parts.filter((p) => p.id === mp.id || (piano ? p.id === piano.id || live(p) : both.parts.includes(p.id)));
    if (keep.length > both.parts.length || !both.lyrics) {
      const ids = keep.map((p) => p.id);
      const braced = both.brace && both.parts.every((id) => ids.includes(id)) ? [...both.parts] : null;
      // (the sung parts: the tune's and any other kept part that sings — a second singer's)
      const sung = keep.filter((p) => singer(p) && !braced?.includes(p.id)).map((p) => p.id);
      const staves = keep.reduce((s, p) => s + p.staves, 0);
      score = view("score", {
        kind: "score", parts: ids, brace: !!braced, braced, lyrics: true, staves, sung, condense: staves >= 3,
        words: {
          part: mp.id,
          // (the tune inside the keyboard part: its staff's words only, not a stray syllable under
          // the left hand; a singer's own part keeps every staff's — a duet on two staves)
          staff: mp.id === piano?.id && mp.staves > 1 ? Number(mel.staff) || 1 : null,
          also: sung.filter((id) => id !== mp.id),
          tune: { staff: Number(mel.staff) || 1, voice: String(mel.voice) },
        },
      });
    }
  }
  const out = score ? { score, ...views } : views;
  // Staves read from the bottom (the Some floor names a bar's bass note there): the piano's left
  // hand, a hymn's bass part, any other bass-clef staff but a singer's (the tune, a baritone's
  // line in a duet).
  const low = new Set();
  const hymnLow = views.both.kind === "hymn" ? views.both.parts[1] : null;
  for (const p of parts) {
    for (let s = 1; s <= p.staves; s++) {
      const lo = piano && p.id === piano.id ? s >= 2 : p.id === hymnLow ? true : p.id !== mp?.id && !singer(p) && p.clefs[String(s)] === "F";
      if (lo) low.add(p.id + "|" + s);
    }
  }
  for (const v of Object.values(out)) v.low = [...low].filter((k) => v.parts.includes(k.slice(0, k.lastIndexOf("|"))));
  return out;
}

// Does the plan keep this note (part id, staff number, voice string)?
export const keeps = (plan, part, staff, voice) =>
  plan.parts.includes(part) && (plan.staff == null || plan.staff === staff) && (plan.voice == null || plan.voice === voice);

function sameNotes(doc, a, b) {
  let ca = 0, cb = 0;
  for (const part of partsIn(doc.documentElement)) {
    const pid = part.getAttribute("id");
    if (!a.parts.includes(pid) && !b.parts.includes(pid)) continue;
    for (const n of part.getElementsByTagName("note")) {
      if (!kid(n, "pitch")) continue;
      const st = num(kid(n, "staff"), 1), v = txt(kid(n, "voice")) || "1";
      const ka = keeps(a, pid, st, v), kb = keeps(b, pid, st, v);
      if (ka !== kb) return false;
      if (ka) { ca++; cb++; }
    }
  }
  return ca === cb && ca > 0;
}

// The key's alteration per step: { C: 0, …, B: -1 }.
const SHARP_ORDER = "FCGDAEB", FLAT_ORDER = "BEADGCF";
export function keyAlters(keyEl) {
  const a = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  const f = kid(keyEl, "fifths");
  if (f) {
    const n = Math.max(-7, Math.min(7, Math.round(num(f, 0))));
    for (let i = 0; i < Math.abs(n); i++) a[(n > 0 ? SHARP_ORDER : FLAT_ORDER)[i]] = n > 0 ? 1 : -1;
    return a;
  }
  // Non-traditional key: key-step / key-alter pairs.
  let step = null;
  for (const c of keyEl.children) {
    if (c.nodeName === "key-step") step = txt(c).toUpperCase();
    else if (c.nodeName === "key-alter" && step in a) { a[step] = num(c, 0); step = null; }
  }
  return a;
}
const NOKEY = keyAlters({ children: [] });

// A transposing part (<transpose>: a B♭ clarinet, an F horn, a guitar's octave): the page shows
// and names the sounding pitch (Verovio's transposeToSoundingPitch, set only for a view that has
// a <transpose>), the key a pianist plays. Verovio respells a remote sounding key (G♭ → F♯,
// C♭ → B): the badges of such a part take the spelling it drew (playnames.js decorate, fact.tr).
const LETTERS = "CDEFGAB";
// <transpose> → { d (letters), c (semitones) } or null
function transOf(t) {
  const oc = num(kid(t, "octave-change"), 0), c = num(kid(t, "chromatic"), 0) + 12 * oc;
  const d = (kid(t, "diatonic") ? num(kid(t, "diatonic"), 0) : Math.round((num(kid(t, "chromatic"), 0) * 7) / 12)) + 7 * oc;
  return d || c ? { d, c } : null;
}
// A written pitch moved by d letters and c semitones (spelled by the interval).
function shiftPitch(step, alter, oct, d, c) {
  const i = LETTERS.indexOf(step) + d;
  const o = oct + Math.floor(i / 7), s = LETTERS[((i % 7) + 7) % 7];
  return { step: s, oct: o, alter: (oct + 1) * 12 + STEP_PC[step] + alter + c - ((o + 1) * 12 + STEP_PC[s]) };
}
// The written key's alterations, transposed: { C: …, …, B: … } of the sounding key.
function shiftKey(a, tr) {
  const out = {};
  for (const s of LETTERS) { const p = shiftPitch(s, a[s] || 0, 4, tr.d, tr.c); out[p.step] = p.alter; }
  return out;
}

// Pitch facts from the whole score, as written — at sounding pitch in a transposing part:
// Map(noteId → { step, alter, oct, midi, part, staff, voice, mi, acc, nat, onset (quarters from
// the bar's start), grace, tr (in a transposing part) }). Per part and staff:
// the key in force (<key number> aware) and the accidentals printed in the bar (by step + octave,
// reset at each barline).
//   acc "printed": it has an <accidental>; "carried": an earlier one in the bar applies, or its
//   alter differs from the key with nothing printed (a tie from the previous bar, an OMR alter);
//   "key": altered by the key signature only; null: plain.
//   nat: a natural that cancels the key or an earlier accidental (shown "B♮").
// Notes are taken in time order within a bar (voices are written one after another, joined
// by <backup>), so an accidental applies to what comes after it in time.
export function noteFacts(doc) {
  ensureIds(doc);
  const facts = new Map();
  for (const part of partsIn(doc.documentElement)) {
    const pid = part.getAttribute("id");
    let keys = { all: NOKEY }; // "all" | staff number → alters
    let trans = { all: null }; // "all" | staff number → { d, c } (a transposing part) | null
    let div = 1; // (divisions: a note's onset in quarters from the bar's start)
    const sounding = new Map(); // written alters → { "d|c" → sounding alters }
    const keyOf = (wk, tr) => {
      if (!tr) return wk;
      let m = sounding.get(wk);
      if (!m) sounding.set(wk, (m = new Map()));
      const k = tr.d + "|" + tr.c;
      if (!m.has(k)) m.set(k, shiftKey(wk, tr));
      return m.get(k);
    };
    kids(part, "measure").forEach((m, mi) => {
      const state = {}; // staff → Map(step+oct → alter of the accidental printed there)
      const events = [];
      let pos = 0, last = 0, i = 0;
      for (const el of m.children) {
        const name = el.nodeName;
        if (name === "backup") pos -= num(kid(el, "duration"), 0);
        else if (name === "forward") pos += num(kid(el, "duration"), 0);
        else if (name === "attributes") {
          const dv = num(kid(el, "divisions"), 0);
          if (dv > 0) div = dv;
          if (kid(el, "key") || kid(el, "transpose")) events.push([pos, 0, i++, el]);
        } else if (name === "note") {
          const chord = !!kid(el, "chord");
          const onset = chord ? last : pos;
          if (!chord) { last = pos; if (!kid(el, "grace")) pos += num(kid(el, "duration"), 0); }
          if (kid(el, "pitch")) events.push([onset, 1, i++, el, onset / div]);
        }
      }
      events.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
      for (const [, kind, , el, q] of events) {
        if (kind === 0) {
          for (const k of kids(el, "key")) {
            const n = k.getAttribute("number");
            if (n) keys[n] = keyAlters(k); else keys = { all: keyAlters(k) };
          }
          for (const t of kids(el, "transpose")) {
            const n = t.getAttribute("number");
            if (n) trans[n] = transOf(t); else trans = { all: transOf(t) };
          }
          continue;
        }
        const p = kid(el, "pitch");
        if (!p) continue;
        const wstep = txt(kid(p, "step")).toUpperCase();
        if (!(wstep in STEP_PC)) continue;
        const staff = num(kid(el, "staff"), 1), voice = txt(kid(el, "voice")) || "1";
        const tr = staff in trans ? trans[staff] : trans.all;
        let step = wstep, alter = num(kid(p, "alter"), 0), oct = num(kid(p, "octave"), 4);
        if (tr) ({ step, alter, oct } = shiftPitch(step, alter, oct, tr.d, tr.c));
        const ka = keyOf(keys[staff] || keys.all, tr)[step] || 0;
        const st = (state[staff] ||= new Map());
        const sk = step + oct, prev = st.get(sk);
        const accEl = kid(el, "accidental");
        const printed = !!accEl && accEl.getAttribute("print-object") !== "no";
        let acc, nat;
        if (printed) {
          acc = "printed";
          nat = alter === 0 && (ka !== 0 || (prev ?? 0) !== 0 || (!tr && txt(accEl) === "natural"));
          st.set(sk, alter);
        } else if (prev !== undefined) {
          acc = "carried";
          nat = alter === 0 && (ka !== 0 || prev !== 0);
        } else if (alter !== ka) {
          acc = "carried";
          nat = alter === 0;
        } else {
          acc = alter !== 0 ? "key" : null;
          nat = false;
        }
        facts.set(el.getAttribute("id"), {
          step, alter, oct, midi: (oct + 1) * 12 + STEP_PC[step] + Math.round(alter),
          part: pid, staff, voice, mi, acc, nat, onset: q, grace: !!kid(el, "grace"), ...(tr ? { tr: true } : {}),
        });
      }
    });
  }
  return facts;
}

// One view's MusicXML for Verovio (works on a clone). → { xml, pitched (notes with a pitch
// kept), firstMeasureAtOrAfter(mi) (the written measure index Verovio has an element for:
// a multi-measure rest swallows the measures after its first), ids (the kept note ids) }.
export function buildView(doc, plan) {
  ensureIds(doc);
  const d = doc.cloneNode(true);
  const root = d.documentElement;
  const keep = new Set(plan.parts);
  const all = partsIn(root);
  // Audiveris writes endings, D.S. / To Coda, tempo and section marks on the top (vocal) part
  // only, and reads a piano's 8va lines as endings (Sing's readStructure reads endings from the
  // top part for the same reason): a view without the top part gets its marks.
  const host = all.find((p) => keep.has(p.getAttribute("id")));
  if (all[0] && host && host !== all[0]) copyMarks(d, all[0], host);
  const dropped = all.some((p) => !keep.has(p.getAttribute("id")));
  for (const p of all) if (!keep.has(p.getAttribute("id"))) p.remove();
  const score = plan.kind === "score";
  // The full score: the road map is the top part's (Verovio reads endings from the first part
  // only; Audiveris writes them there, and reads a piano's 8va lines as endings below).
  if (score) {
    scoreEndings(d, partsIn(root));
    scoreBarlines(d, partsIn(root));
    scoreMarks(d, partsIn(root));
  }
  // A part the part-list doesn't name (or no part-list): Verovio loads it and draws nothing. Its
  // entry goes where its <part> stands (Verovio orders the staves by the part-list: appended, a
  // voice missing from it was drawn under the piano).
  let list = kid(root, "part-list");
  if (!list) { list = d.createElement("part-list"); root.insertBefore(list, partsIn(root)[0] || null); }
  const listed = new Set(kids(list, "score-part").map((sp) => sp.getAttribute("id")));
  const order = partsIn(root).map((p) => p.getAttribute("id"));
  order.forEach((id, i) => {
    if (listed.has(id)) return;
    const sp = d.createElement("score-part");
    sp.setAttribute("id", id);
    sp.appendChild(d.createElement("part-name"));
    let at = kids(list, "score-part").find((x) => order.indexOf(x.getAttribute("id")) > i) || null;
    // (before the groups that open there, not inside them)
    while (at?.previousElementSibling?.nodeName === "part-group" && at.previousElementSibling.getAttribute("type") === "start") at = at.previousElementSibling;
    list.insertBefore(sp, at);
    listed.add(id);
  });
  { // the part-list: only the kept parts, a hymn's two braced, no names
    // (the full score keeps a group of the source all of whose parts it shows — a choir's bracket,
    // its barlines through the staves — as Both does)
    const whole = score ? wholeGroups(list, keep, plan.braced) : new Set();
    for (const sp of kids(list, "score-part")) if (!keep.has(sp.getAttribute("id"))) sp.remove();
    if (dropped || keep.size === 1 || plan.brace || score) for (const g of kids(list, "part-group")) if (!whole.has(g)) g.remove();
    const sps = kids(list, "score-part");
    if (score) scoreGroups(d, list, plan, whole);
    else if (plan.brace && sps.length === 2) {
      const pg = (type) => {
        const g = d.createElement("part-group");
        g.setAttribute("type", type); g.setAttribute("number", "1");
        if (type === "start") for (const [n, v] of [["group-symbol", "brace"], ["group-barline", "yes"]]) { const c = d.createElement(n); c.textContent = v; g.appendChild(c); }
        return g;
      };
      list.insertBefore(pg("start"), sps[0]);
      sps[1].after(pg("stop"));
    }
    // No instrument name on every system.
    for (const sp of sps) {
      for (const c of [...sp.children]) {
        if (c.nodeName === "part-name" || c.nodeName === "part-abbreviation") c.textContent = "";
        else if (c.nodeName === "part-name-display" || c.nodeName === "part-abbreviation-display") c.remove();
      }
    }
  }
  // Credits: OCR'd page text (chord grids, "Authorized for use by: …"). The page draws its own title.
  for (const c of kids(root, "credit")) c.remove();
  const parts = partsIn(root);
  for (const part of parts) {
    for (const h of [...part.getElementsByTagName("harmony")]) h.remove();
    // Chord names and guitar grids the OCR read as plain words ("Ei7/D", "G/ B", "xxoo"):
    // chord symbols are off in v1, and these are the garbled ones.
    for (const w of [...part.querySelectorAll("direction > direction-type > words")]) {
      if (!chordWords(w.textContent)) continue;
      const dt = w.parentElement, dir = dt.parentElement;
      w.remove();
      if (!dt.children.length) dt.remove();
      if (!kids(dir, "direction-type").length) dir.remove();
    }
    // A staff Audiveris hid in some systems (a voice resting through a piano intro): the page
    // reflows, so its systems don't exist here.
    for (const sd of [...part.getElementsByTagName("staff-details")]) {
      if (sd.getAttribute("print-object") !== "no") continue;
      sd.removeAttribute("print-object");
      if (!sd.children.length && !sd.attributes.length) sd.remove();
    }
    if (!plan.lyrics) for (const l of [...part.getElementsByTagName("lyric")]) l.remove();
    else if (plan.words) {
      // (the full score: words only where they're sung — the tune's part (the tune's staff only
      // when the tune is inside the keyboard part) and another singer's — not a piano's or another
      // part's stray OCR syllables)
      const w = plan.words, pid = part.getAttribute("id"), tune = pid === w.part, mine = tune || !!w.also?.includes(pid);
      for (const l of [...part.getElementsByTagName("lyric")]) {
        const n = l.parentElement;
        if (!mine || (tune && w.staff != null && num(kid(n, "staff"), 1) !== w.staff)) l.remove();
      }
      if (tune && w.tune) gatherSyllables(part, w.tune.staff, w.tune.voice);
      if (mine) firstStanzaOnly(part);
    } else firstStanzaOnly(part);
  }
  if (plan.staff != null || plan.voice != null) for (const part of parts) {
    // (one staff / voice of music written across both: slurs and beams whose other end goes)
    const pairs = slurPairs(part), beams = beamGroups(part);
    filterPart(d, part, plan.staff, plan.voice, plan.lyrics);
    const drop = (sl) => { const no = sl.parentElement; sl.remove(); if (no && !no.children.length) no.remove(); };
    for (const [sl, partner] of pairs) if (sl.isConnected && !partner.isConnected) drop(sl);
    for (const sl of [...part.querySelectorAll("notations > slur")]) if (!pairs.has(sl)) drop(sl);
    rebeam(beams);
  }
  for (const part of parts) {
    // A note tied both ways with <tied type="start"/> before <tied type="stop"/> (Audiveris):
    // Verovio pairs the stop with the note's own start (not drawn) and the incoming tie skips to
    // the next note — one long arc over a chord that looks re-struck (Killing Me Softly bar 11).
    for (const n of part.getElementsByTagName("note")) {
      tiesInOrder(n, "tie");
      for (const no of kids(n, "notations")) tiesInOrder(no, "tied");
    }
    for (const n of part.getElementsByTagName("note")) {
      // Audiveris writes <beam> and <tuplet> on every note of a chord; Verovio expects them on
      // the chord's first note only and drops the rest of the group (Wichita: 496 of 820 notes).
      if (!kid(n, "chord")) continue;
      for (const b of kids(n, "beam")) b.remove();
      const no = kid(n, "notations");
      if (no) { for (const t of kids(no, "tuplet")) t.remove(); if (!no.children.length) no.remove(); }
    }
    // Audiveris writes <measure-numbering>none</measure-numbering>: no bar numbers at all.
    for (const mn of part.querySelectorAll("print > measure-numbering")) mn.textContent = "system";
    dropRestatedKeys(part);
    dropUnclosedSpanners(part);
    dropCoveringRests(part, score ? parts : [part]); // (the full score: a rest bar is every part's)
    if (score && plan.condense && stavesOf(part) === 1) keepMarks(d, part);
  }
  // Measure ids for the page anchor (Verovio keeps them: <measure id="m3"> → g#m3), on the part
  // the part-list names first: Verovio takes a measure's id from that part.
  const present = [];
  const ids = [];
  const first = kids(list, "score-part")[0]?.getAttribute("id");
  const idPart = parts.find((p) => p.getAttribute("id") === first) || parts[0];
  parts.forEach((part) => {
    let skip = 0;
    kids(part, "measure").forEach((m, mi) => {
      if (part !== idPart) { m.removeAttribute("id"); return; }
      m.setAttribute("id", "m" + mi);
      if (skip > 0) skip--; else present.push(mi);
      const mr = m.querySelector("attributes > measure-style > multiple-rest");
      if (mr) skip = Math.max(0, num(mr, 1) - 1);
    });
  });
  let pitched = 0;
  for (const part of parts) for (const n of part.getElementsByTagName("note")) if (kid(n, "pitch")) { pitched++; ids.push(n.getAttribute("id")); }
  const firstMeasureAtOrAfter = (mi) => {
    for (const x of present) if (x >= mi) return x;
    return present.length ? present[present.length - 1] : 0;
  };
  return { xml: new XMLSerializer().serializeToString(d), pitched, firstMeasureAtOrAfter, measures: present, ids };
}

// One staff and/or one voice of a part, with the timeline rewritten: every original
// <backup>/<forward> goes and the cursor is moved only for what is kept, with forwards in the
// voice of the note that follows (forwards in a dropped voice would add a layer of spaces,
// which flips Verovio's stems). Directions and attributes keep their place: one past the kept
// notes waits for the next kept note (a forward in that note's voice), or takes an <offset>.
function filterPart(d, part, staff, voice, lyrics) {
  const S = staff == null ? null : String(staff);
  const V = voice == null ? null : String(voice);
  const dur = (el) => num(kid(el, "duration"), 0);
  const mk = (name, dv, v) => {
    const el = d.createElement(name);
    const du = d.createElement("duration"); du.textContent = String(dv); el.appendChild(du);
    if (name === "forward") { const ve = d.createElement("voice"); ve.textContent = v; el.appendChild(ve); }
    return el;
  };
  const setStaff = (el) => { const s = kid(el, "staff"); if (s) s.textContent = "1"; };
  const otherDir = (el) => {
    const ds = txt(kid(el, "staff")) || "1", dvc = txt(kid(el, "voice"));
    return (S != null && ds !== S) || (V != null && dvc && dvc !== V);
  };
  for (const m of kids(part, "measure")) {
    let pos = 0, cur = 0, last = 0, chordKept = false;
    const out = [], pending = [];
    const own = new Set(kids(m, "direction").filter((el) => !otherDir(el)).map(dirSig)); // (a mark both staves carry: once)
    const kept = new Map(); // onset → note (main notes kept), for syllables left on dropped voices
    const orphan = [];      // [onset, lyric] from dropped notes on the kept staff
    const move = (to, v) => {
      if (to > cur) out.push(mk("forward", to - cur, v));
      else if (to < cur) out.push(mk("backup", cur - to));
      cur = to;
    };
    const flush = (upto, v) => {
      while (pending.length && pending[0].at <= upto) { const p = pending.shift(); move(p.at, v); out.push(p.el); }
    };
    const place = (el, at) => {
      if (at <= cur) { move(at); out.push(el); } else pending.push({ el, at });
    };
    for (const el of [...m.children]) {
      switch (el.nodeName) {
        case "backup": pos -= dur(el); break;
        case "forward": pos += dur(el); break;
        case "note": {
          const chord = !!kid(el, "chord"), grace = !!kid(el, "grace"), dv = grace ? 0 : dur(el);
          const onset = chord ? last : pos;
          if (!chord) { last = pos; pos += dv; }
          const ns = txt(kid(el, "staff")) || "1", nv = txt(kid(el, "voice")) || "1";
          if ((S != null && ns !== S) || (V != null && nv !== V)) {
            if (!chord) chordKept = false;
            if (lyrics && V != null && (S == null || ns === S)) for (const l of kids(el, "lyric")) orphan.push([onset, l]);
            break;
          }
          if (chord && !chordKept) kid(el, "chord").remove(); // its chord's first note went with another staff/voice
          if (!chord || !chordKept) {
            flush(onset, nv);
            move(onset, nv);
            cur = onset + dv;
            chordKept = true;
            if (!grace && !kept.has(onset)) kept.set(onset, el);
          }
          setStaff(el);
          out.push(el);
          break;
        }
        case "direction": {
          // (the other staff's / voice's directions go — but a tempo, a D.S., a section name is
          // for both hands: kept, once)
          if (otherDir(el)) {
            const sig = dirSig(el);
            if (!isMark(el, true) || own.has(sig)) break;
            own.add(sig);
            for (const v of kids(el, "voice")) v.remove();
          }
          setStaff(el);
          place(el, pos);
          break;
        }
        case "attributes": {
          if (S != null) filterAttributes(el, S);
          if (el.children.length) place(el, pos);
          break;
        }
        case "harmony": case "figured-bass": {
          if (S != null && (txt(kid(el, "staff")) || "1") !== S) break;
          setStaff(el);
          place(el, pos);
          break;
        }
        case "print": {
          if (S != null) for (const sl of kids(el, "staff-layout")) {
            if ((sl.getAttribute("number") || "1") !== S) sl.remove(); else sl.removeAttribute("number");
          }
          out.push(el);
          break;
        }
        default: out.push(el); // barline, sound, …
      }
    }
    // Past the last kept note: directions take an offset, attributes stay at the cursor.
    for (const p of pending) {
      if (p.el.nodeName === "direction" && p.at > cur) {
        let off = kid(p.el, "offset");
        const base = off ? num(off, 0) : 0;
        if (!off) {
          off = d.createElement("offset");
          p.el.insertBefore(off, kid(p.el, "staff") || kid(p.el, "sound") || kid(p.el, "listening") || null);
        }
        off.textContent = String(base + p.at - cur);
      }
      out.push(p.el);
    }
    while (m.firstChild) m.removeChild(m.firstChild);
    for (const el of out) m.appendChild(el);
    // Syllables the recognition gave to another voice of the tune's staff (the chord under
    // it, The Longest Time): onto the tune's note at the same moment, when it has none.
    for (const [onset, l] of orphan) {
      const n = kept.get(onset);
      if (!n) continue;
      const nb = l.getAttribute("number") || "1";
      if (kids(n, "lyric").some((x) => (x.getAttribute("number") || "1") === nb)) continue;
      n.insertBefore(l, kid(n, "play") || kid(n, "listen") || null);
    }
  }
}

// The full score keeps every voice of the tune's staff, but syllables the recognition gave to
// another voice of it (the chord under the tune, The Longest Time: "For the long-est" came out
// "For" on the tune, "the" on the chord, "long" on the tune, "est" on the chord) move onto the
// tune's note at the same moment, when it has none for that verse — as Melody does — so a word's
// hyphens join within one voice (Verovio joins a syllable to the next one of its own voice: they
// ran through the other voice's syllables). Only a verse the tune's voice sings and the other voices
// don't carry a copy of (a duet's second singer on one staff with his own verse, a hymn's alto
// with the same words: theirs). One with no tune note at its moment (sung on a beat the tune's
// printed note holds through: "wo-man" over a half note) stays, and the hyphens either side of it
// go (they'd join over it), its own included.
function gatherSyllables(part, staff, voice) {
  const S = String(staff ?? 1), V = String(voice ?? "1");
  const dur = (el) => num(kid(el, "duration"), 0);
  const onStaff = (n) => (txt(kid(n, "staff")) || "1") === S;
  const verse = (l) => l.getAttribute("number") || "1";
  const tuneVerses = new Set();
  for (const n of part.getElementsByTagName("note")) if (onStaff(n) && (txt(kid(n, "voice")) || "1") === V) for (const l of kids(n, "lyric")) tuneVerses.add(verse(l));
  if (!tuneVerses.size) return;
  // Each measure's tune notes by onset, its other voices' syllables of those verses, the tune's own.
  const bars = kids(part, "measure").map((m, mi) => {
    let pos = 0, last = 0;
    const tune = new Map(), orphan = [], own = [];
    for (const el of m.children) {
      if (el.nodeName === "backup") pos -= dur(el);
      else if (el.nodeName === "forward") pos += dur(el);
      else if (el.nodeName === "note") {
        const chord = !!kid(el, "chord"), grace = !!kid(el, "grace");
        const onset = chord ? last : pos;
        if (!chord) { last = pos; pos += grace ? 0 : dur(el); }
        if (!onStaff(el)) continue;
        if ((txt(kid(el, "voice")) || "1") !== V) { for (const l of kids(el, "lyric")) if (tuneVerses.has(verse(l))) orphan.push([onset, l]); continue; }
        for (const l of kids(el, "lyric")) own.push([onset, l]);
        if (!chord && !grace && kid(el, "pitch") && !tune.has(onset)) tune.set(onset, el);
      }
    }
    return { mi, tune, orphan, own };
  });
  // (a copy: most of a verse's syllables on other voices land on a tune note that has its own)
  const has = (n, v) => kids(n, "lyric").some((x) => verse(x) === v);
  const stat = new Map();
  for (const b of bars) for (const [onset, l] of b.orphan) {
    const n = b.tune.get(onset), st = stat.get(verse(l)) || stat.set(verse(l), { n: 0, copy: 0 }).get(verse(l));
    st.n++;
    if (n && has(n, verse(l))) st.copy++;
  }
  const split = (v) => { const st = stat.get(v); return !!st && st.copy <= st.n / 2; };
  const sung = new Map(), left = []; // verse → the tune's syllables in time order [{ at, l }]; syllables left
  for (const { mi, tune, orphan, own } of bars) {
    for (const [onset, l] of orphan) {
      if (!split(verse(l))) continue;
      const n = tune.get(onset);
      if (!n) { left.push({ at: [mi, onset], l }); continue; }
      if (has(n, verse(l))) continue;
      n.insertBefore(l, kid(n, "play") || kid(n, "listen") || null);
      own.push([onset, l]);
    }
    for (const [onset, l] of own.sort((a, b) => a[0] - b[0])) (sung.get(verse(l)) || sung.set(verse(l), []).get(verse(l))).push({ at: [mi, onset], l });
  }
  const before = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const close = (l) => {
    const sy = kid(l, "syllabic");
    if (sy && txt(sy) === "begin") sy.textContent = "single";
    else if (sy && txt(sy) === "middle") sy.textContent = "end";
  };
  for (const { at, l } of left) {
    close(l);
    const prev = (sung.get(verse(l)) || []).filter((x) => before(x.at, at)).pop();
    if (prev) close(prev.l);
  }
}

function filterAttributes(attr, S) {
  for (const a of [...attr.children]) {
    const n = a.getAttribute("number");
    switch (a.nodeName) {
      case "staves": case "part-symbol": a.remove(); break;
      case "clef": if ((n || "1") !== S) a.remove(); else a.removeAttribute("number"); break;
      case "key": case "time": case "transpose": case "staff-details": case "measure-style":
        if (n && n !== S) a.remove(); else a.removeAttribute("number");
        break;
    }
  }
}

// Words that are a chord symbol (or a row of them) or a guitar chord grid, as OCR reads them:
// "Ei7/D", "EL/ G", "F/C C Dm7/C", "Bb(add9)/D", "G7sus", "N.C.", "xxoo", "x 000", "//".
// Not: "Chorus", "Fine", "Coda", "Verse:", "sim,", "in 2 (= about 76)", "D.S. al Coda".
const CHORD_TOKEN = /^[A-G][#b♯♭ﬂiLl]?[A-Za-z0-9()+°ø#♯♭>\-]{0,9}(\/[A-G][#b♯♭ﬂ]?)?$/;
const CHORD_QUALITY = /^[#b♯♭ﬂiLl]?(m|maj|min|dim|aug|sus|add|rn|M)?$/;
export function chordWords(text) {
  const t = text.replace(/\/\s+/g, "/").trim();
  if (!t) return false;
  if (/^N\.?\s?C\.?$/i.test(t)) return true;
  if (/^[xXoOc0-9|—–\-\/.\s]+$/.test(t) && /[xXoO0|\/]/.test(t)) return true;
  return t.split(/\s+/).every((tok) => CHORD_TOKEN.test(tok) && (/[\d\/(]/.test(tok) || tok.length <= 3 || CHORD_QUALITY.test(tok.slice(1))));
}

const keySig = (k) => [...k.children].filter((c) => c.nodeName !== "cancel" && c.nodeName !== "mode" && c.nodeName !== "key-octave").map((c) => c.nodeName + "=" + txt(c)).join(";");

// A <key> that restates the key in force, in a measure with no clef or time change: Verovio
// draws a courtesy key signature at the end of the previous system (fixOmrScore restates the
// key at every page start). Verovio draws only the first key of a bar (per staff number), at the
// bar's start, so only that one counts as in force: a second, mid-bar change isn't drawn, and the
// next barline's key restating it must stay. A restatement dropped here isn't the bar's first
// key: the next one in the bar is (Verovio draws that one at the bar's start).
function dropRestatedKeys(part) {
  let cur = { all: null };
  for (const m of kids(part, "measure")) {
    const attrs = kids(m, "attributes");
    const change = attrs.some((a) => kid(a, "clef") || kid(a, "time"));
    const seen = new Set();
    for (const a of attrs) {
      for (const k of kids(a, "key")) {
        const sig = keySig(k), n = k.getAttribute("number");
        if (seen.has(n || "all") || seen.has("all")) continue;
        const same = n ? (cur[n] ?? cur.all) === sig : cur.all === sig && Object.keys(cur).every((s) => cur[s] === sig);
        if (same && !change) { k.remove(); continue; }
        seen.add(n || "all");
        if (n) cur[n] = sig;
        else cur = { all: sig };
      }
      if (!a.children.length) a.remove();
    }
  }
}

// A hairpin (or dashes, a bracket) that starts and never stops (OMR missed its end): Verovio
// draws it on to the end of the score (Songbird bars 15–19). Dropped, with its <direction>
// when that held nothing else.
function dropUnclosedSpanners(part) {
  const open = new Map(); // "name|staff|number" → element
  const drop = (el) => {
    const dt = el.parentElement, dir = dt?.parentElement;
    el.remove();
    if (dt && !dt.children.length) dt.remove();
    if (dir && dir.nodeName === "direction" && !kids(dir, "direction-type").length) dir.remove();
  };
  for (const el of part.querySelectorAll("direction > direction-type > wedge, direction > direction-type > dashes, direction > direction-type > bracket")) {
    const dir = el.parentElement.parentElement;
    const nb = el.getAttribute("number") || "1", st = txt(kid(dir, "staff")) || "1", type = el.getAttribute("type");
    const key = `${el.nodeName}|${st}|${nb}`;
    if (type === "stop") {
      if (open.has(key)) open.delete(key);
      else for (const k of open.keys()) if (k.startsWith(el.nodeName + "|") && k.endsWith("|" + nb)) { open.delete(k); break; }
    } else if (type === "continue") {
      continue;
    } else {
      if (open.has(key)) drop(open.get(key));
      open.set(key, el);
    }
  }
  for (const el of open.values()) drop(el);
}

// --- Marks of the top part (copyMarks), kept across staves (filterPart) ------------------------

// Section and navigation words: "D.S. 55 al Coda I", "To Coda", "Fine", "Verse:", "Chorus".
const NAV_WORDS = /(^|[^a-z])(d\.\s?s\.|d\.\s?c\.|dal segno|da capo|to coda|coda|fine|segno|verse|chorus|bridge|interlude|intro|outro|refrain|pre-?chorus|vamp|repeat|fade)(?![a-z])/i;
// Tempo words: "Moderately", "Freely", "Fast three, in one", "rit.", "a tempo", "= about 76".
const TEMPO_WORDS = /(^|[^a-z])(a tempo|tempo|rit|ritard|ritardando|rall|rallentando|accel|accelerando|rubato|freely|slowly|moderately|fast|bright|brightly|slow|lento|largo|adagio|andante|andantino|moderato|allegro|allegretto|presto|vivace|langsam|ruhig|schnell|lebhaft|zart|in (one|1|2|two|3|three|4|four))(?![a-z])|=\s*(about|ca\.?|c\.)?\s*\d/i;
const SOUND_MARK = ["tempo", "dalsegno", "dacapo", "tocoda", "coda", "fine", "segno"];

// A direction that is for the whole score, not one staff: a segno / coda / rehearsal mark, a
// metronome, a navigation or section word, a <sound> tempo or jump — and tempo words when
// `tempo` (the piano's own, or the score's first bar).
function isMark(dir, tempo) {
  for (const dt of kids(dir, "direction-type")) {
    for (const c of dt.children) {
      const n = c.nodeName;
      if (n === "segno" || n === "coda" || n === "metronome" || n === "rehearsal") return true;
      if (n === "words") {
        const w = c.textContent;
        if (NAV_WORDS.test(w) || (tempo && TEMPO_WORDS.test(w))) return true;
      }
    }
  }
  const snd = kid(dir, "sound");
  return !!snd && SOUND_MARK.some((a) => snd.hasAttribute(a));
}
// What a direction shows (two copies of one mark compare equal).
const dirSig = (dir) => kids(dir, "direction-type").map((dt) => [...dt.children].map((c) => c.nodeName + ":" + c.textContent.replace(/\s+/g, " ").trim().toLowerCase()).join(",")).join("|");

// The top part's endings, repeats and marks into the kept part `host` (same measure index):
// endings and repeats merged into its barlines (its own endings go: from Audiveris they're 8va
// lines misread), directions copied onto staff 1 at the same moment (an <offset> in the host's
// divisions).
function copyMarks(d, top, host) {
  const tms = kids(top, "measure"), hms = kids(host, "measure");
  const omr = /audiveris/i.test(d.querySelector("identification > encoding > software")?.textContent || "");
  if (omr || top.querySelector("barline > ending")) for (const e of [...host.querySelectorAll("barline > ending")]) e.remove();
  // (where a measure's music starts: after its print, attributes and left barline)
  const startOf = (m) => { for (const c of m.children) if (!(c.nodeName === "print" || c.nodeName === "attributes" || (c.nodeName === "barline" && c.getAttribute("location") === "left"))) return c; return null; };
  let tDiv = 1, hDiv = 1;
  for (let i = 0; i < Math.min(tms.length, hms.length); i++) {
    const tm = tms[i], hm = hms[i];
    for (const a of kids(hm, "attributes")) { const dv = num(kid(a, "divisions"), 0); if (dv > 0) hDiv = dv; }
    for (const tb of kids(tm, "barline")) {
      const end = kid(tb, "ending"), rep = kid(tb, "repeat");
      if (!end && !rep) continue;
      const loc = tb.getAttribute("location") || "right";
      let hb = kids(hm, "barline").find((b) => (b.getAttribute("location") || "right") === loc);
      if (!hb) {
        hb = d.createElement("barline");
        hb.setAttribute("location", loc);
        const bs = kid(tb, "bar-style");
        if (bs) hb.appendChild(bs.cloneNode(true));
        if (loc === "left") hm.insertBefore(hb, startOf(hm)); else hm.appendChild(hb);
      }
      if (end) hb.insertBefore(end.cloneNode(true), kid(hb, "repeat"));
      if (rep && !kid(hb, "repeat")) hb.appendChild(rep.cloneNode(true));
    }
    const have = new Set(kids(hm, "direction").map(dirSig));
    let pos = 0;
    for (const el of tm.children) {
      const name = el.nodeName;
      if (name === "attributes") { const dv = num(kid(el, "divisions"), 0); if (dv > 0) tDiv = dv; }
      else if (name === "backup") pos -= num(kid(el, "duration"), 0);
      else if (name === "forward") pos += num(kid(el, "duration"), 0);
      else if (name === "note") { if (!kid(el, "chord") && !kid(el, "grace")) pos += num(kid(el, "duration"), 0); }
      else if (name === "direction") {
        // (tempo words only in the first bar, or with a metronome: a voice's own "rit." stays its own)
        if (!isMark(el, i === 0)) continue;
        const sig = dirSig(el);
        if (have.has(sig)) continue;
        have.add(sig);
        const c = el.cloneNode(true);
        for (const v of kids(c, "voice")) v.remove();
        const st = kid(c, "staff");
        if (st) st.textContent = "1";
        const at = Math.round(((pos + num(kid(el, "offset"), 0)) / tDiv) * hDiv * 1000) / 1000;
        let off = kid(c, "offset");
        if (at > 0) {
          if (!off) { off = d.createElement("offset"); c.insertBefore(off, kid(c, "staff") || kid(c, "sound") || kid(c, "listening") || null); }
          off.textContent = String(at);
        } else if (off) off.remove();
        hm.insertBefore(c, startOf(hm));
      }
    }
  }
  for (const b of [...host.getElementsByTagName("barline")]) if (!b.children.length) b.remove();
}

// Verovio's MusicXML import takes a measure's barlines — style, repeats, endings — from the first
// part only, and Audiveris writes a barline only on the staves printed in that system (a voice
// resting through a system has none: Piano Man's double bars and final barline, Songbird's double
// bar were drawn single). So the full score's top part gets them from the parts below it.
const omrScore = (d) => /audiveris/i.test(d.querySelector("identification > encoding > software")?.textContent || "");
// (where a measure's music starts: after its print, attributes and left barline)
const musicStart = (m) => { for (const c of m.children) if (!(c.nodeName === "print" || c.nodeName === "attributes" || (c.nodeName === "barline" && c.getAttribute("location") === "left"))) return c; return null; };
// The top part's barline at a location ("left" | "right"), made if missing.
function barlineAt(d, m, loc) {
  let b = kids(m, "barline").find((x) => (x.getAttribute("location") || "right") === loc);
  if (!b) {
    b = d.createElement("barline");
    b.setAttribute("location", loc);
    if (loc === "left") m.insertBefore(b, musicStart(m)); else m.appendChild(b);
  }
  return b;
}

// The full score's endings are its top part's: the lower parts' go when the score is from
// Audiveris (a piano's 8va lines read as endings) or the top part has its own. A file from an
// exporter with endings written only below the top part (Verovio would draw none) has the first
// such part's moved to the top.
function scoreEndings(d, parts) {
  const [top, ...rest] = parts;
  if (!top || !rest.length) return;
  const omr = omrScore(d), own = !!top.querySelector("barline > ending");
  const from = !omr && !own ? rest.find((p) => p.querySelector("barline > ending")) : null;
  if (!omr && !own && !from) return;
  if (from) {
    const tms = kids(top, "measure");
    kids(from, "measure").forEach((m, i) => {
      if (!tms[i]) return;
      for (const b of kids(m, "barline")) {
        const e = kid(b, "ending");
        if (!e) continue;
        const tb = barlineAt(d, tms[i], b.getAttribute("location") || "right");
        if (!kid(tb, "ending")) tb.insertBefore(e.cloneNode(true), kid(tb, "repeat"));
      }
    });
  }
  for (const p of rest) {
    for (const e of [...p.querySelectorAll("barline > ending")]) {
      const b = e.parentElement;
      e.remove();
      if (!b.children.length) b.remove();
    }
  }
}

// The heaviest bar style of the parts, and any repeat, into the top part (location by location).
const BAR_WEIGHT = { "light-light": 1, "heavy-light": 2, "heavy-heavy": 2, "light-heavy": 3 };
function scoreBarlines(d, parts) {
  const [top, ...rest] = parts;
  if (!top || !rest.length) return;
  const tms = kids(top, "measure");
  const weight = (b) => BAR_WEIGHT[txt(kid(b, "bar-style"))] || 0;
  for (const p of rest) kids(p, "measure").forEach((m, i) => {
    if (!tms[i]) return;
    for (const b of kids(m, "barline")) {
      const loc = b.getAttribute("location") || "right", rep = kid(b, "repeat"), w = weight(b);
      if (loc === "middle" || (!w && !rep)) continue;
      const tb = barlineAt(d, tms[i], loc);
      if (w > weight(tb)) { kid(tb, "bar-style")?.remove(); tb.insertBefore(kid(b, "bar-style").cloneNode(true), tb.firstChild); }
      if (rep && !kid(tb, "repeat")) tb.appendChild(rep.cloneNode(true));
    }
  });
}

// The full score's marks on the parts below the top one. A copy of one the top part has in that
// bar goes (an exporter that writes system text into every part: drawn over every staff). From
// Audiveris, a section heading placed below a lower part's staff was printed between two systems,
// over the next one, and attached to the staff above it (Piano Man's "Chorus" under the accordion,
// 7 bars early; Wichita's "Verse:" under the left hand, 3 bars early): it moves to the top part,
// to the bar at the same place across the next system (Audiveris's measure widths) — onto the
// section barline when one is a bar away from there, as headings are printed — and goes when
// there's no next system. (Both keeps v77's.)
const HEADING = /(^|[^a-z])(verse|chorus|bridge|interlude|intro|outro|refrain|pre-?chorus)(?![a-z])/i;
function scoreMarks(d, parts) {
  const [top, ...rest] = parts;
  if (!top || !rest.length) return;
  const omr = omrScore(d), tms = kids(top, "measure");
  for (const p of rest) kids(p, "measure").forEach((m, i) => {
    const have = new Set(tms[i] ? kids(tms[i], "direction").map(dirSig) : []);
    for (const dir of kids(m, "direction")) {
      if (!isMark(dir, i === 0)) continue;
      const heading = omr && dir.getAttribute("placement") === "below" && kids(dir, "direction-type").some((dt) => kids(dt, "words").some((w) => HEADING.test(w.textContent)));
      if (!heading && !have.has(dirSig(dir))) continue;
      const to = heading && !have.has(dirSig(dir)) ? headingBar(parts, p, i, dir) : null;
      dir.remove();
      if (to == null || kids(tms[to], "direction").some((x) => dirSig(x) === dirSig(dir))) continue;
      dir.setAttribute("placement", "above");
      for (const c of [...dir.children]) if (c.nodeName === "offset" || c.nodeName === "voice" || c.nodeName === "staff") c.remove();
      for (const w of dir.querySelectorAll("direction-type > words")) w.removeAttribute("default-y");
      tms[to].insertBefore(dir, musicStart(tms[to]));
    }
  });
}
// The measure (index) a heading attached to measure i of part p was printed over: the same place
// across the next system. → null when there's no next system.
function headingBar(parts, p, i, dir) {
  const n = Math.min(...parts.map((q) => kids(q, "measure").length));
  const starts = [];
  for (let k = 0; k < n; k++) if (k === 0 || parts.some((q) => kids(q, "measure")[k].querySelector(":scope > print[new-system=yes], :scope > print[new-page=yes]"))) starts.push(k);
  const s0 = starts.filter((k) => k <= i).pop() ?? 0, s1 = starts.find((k) => k > i), s2 = starts.find((k) => k > s1) ?? n;
  if (s1 == null) return null;
  const ms = kids(p, "measure");
  const width = (k) => { const v = Number(ms[k]?.getAttribute("width")); return Number.isFinite(v) && v > 0 ? v : 0; };
  // (a section barline: a double / heavy bar or a repeat, in any part, where measure k starts)
  const section = (k) => parts.some((q) => {
    const qm = kids(q, "measure");
    const end = qm[k - 1] && kids(qm[k - 1], "barline").find((b) => (b.getAttribute("location") || "right") === "right");
    const beg = qm[k] && kids(qm[k], "barline").find((b) => b.getAttribute("location") === "left");
    return [end, beg].some((b) => b && (BAR_WEIGHT[txt(kid(b, "bar-style"))] || kid(b, "repeat")));
  });
  // (no widths: the next system's first bar)
  for (let k = s0; k < s2; k++) if (!width(k)) return s1;
  let x = 0;
  for (let k = s0; k < i; k++) x += width(k);
  const len = extentOf(ms[i]), at = positionOf(ms[i], dir);
  x += len > 0 ? (Math.min(at, len) / len) * width(i) : 0;
  let left = 0, k = s1;
  for (; k < s2 - 1 && left + width(k) <= x; k++) left += width(k);
  // the nearest section barline within a bar's width of that place
  let best = k, dist = Infinity, edge = 0;
  for (let j = s1; j < s2; j++) {
    if (section(j) && Math.abs(edge - x) <= width(k) && Math.abs(edge - x) < dist) { best = j; dist = Math.abs(edge - x); }
    edge += width(j);
  }
  return best;
}
// A measure's length in divisions (the furthest any voice reaches), and where an element of it
// stands (its <offset> included).
function extentOf(m) {
  let pos = 0, end = 0;
  for (const el of m.children) {
    if (el.nodeName === "backup") pos -= num(kid(el, "duration"), 0);
    else if (el.nodeName === "forward") pos += num(kid(el, "duration"), 0);
    else if (el.nodeName === "note" && !kid(el, "chord") && !kid(el, "grace")) pos += num(kid(el, "duration"), 0);
    end = Math.max(end, pos);
  }
  return end;
}
function positionOf(m, target) {
  let pos = 0;
  for (const el of m.children) {
    if (el === target) return pos + num(kid(el, "offset"), 0);
    if (el.nodeName === "backup") pos -= num(kid(el, "duration"), 0);
    else if (el.nodeName === "forward") pos += num(kid(el, "duration"), 0);
    else if (el.nodeName === "note" && !kid(el, "chord") && !kid(el, "grace")) pos += num(kid(el, "duration"), 0);
  }
  return pos;
}

// The source's part-groups (start and stop elements) all of whose parts are kept (≥ 2), none of
// them the hymn pair the full score braces itself.
function wholeGroups(list, keep, braced) {
  const out = new Set(), open = new Map();
  for (const c of list.children) {
    if (c.nodeName === "score-part") { for (const g of open.values()) g.ids.push(c.getAttribute("id")); continue; }
    if (c.nodeName !== "part-group") continue;
    const n = c.getAttribute("number") || "1";
    if (c.getAttribute("type") === "start") { open.set(n, { start: c, ids: [] }); continue; }
    const g = open.get(n);
    if (c.getAttribute("type") !== "stop" || !g) continue;
    open.delete(n);
    if (g.ids.length >= 2 && g.ids.every((id) => keep.has(id) && !braced?.includes(id))) { out.add(g.start); out.add(c); }
  }
  return out;
}

// The full score's part-list groups (the source's go, but those kept whole — `whole`): a hymn's
// pair braced, as Both; with ≥ 3 staves each single-staff part outside a kept group on its own in
// an unmarked group (symbol none) — Verovio condenses (leaves a staff resting a whole system out
// of it, as printed: the voice through a piano intro) only when the score has more than one group
// symbol; a piano part's brace is one, and it keeps its two staves together.
function scoreGroups(d, list, plan, whole = new Set()) {
  const sps = kids(list, "score-part");
  const at = (id) => sps.find((sp) => sp.getAttribute("id") === id) || null;
  // (the parts inside a kept group, and the numbers it uses)
  const inGroup = new Set(), open = new Set();
  let nb = 0;
  for (const c of list.children) {
    if (c.nodeName === "part-group" && whole.has(c)) {
      const n = c.getAttribute("number") || "1";
      nb = Math.max(nb, Number(n) || 0);
      if (c.getAttribute("type") === "start") open.add(n); else open.delete(n);
    } else if (c.nodeName === "score-part" && open.size) inGroup.add(c);
  }
  const group = (first, last, symbol) => {
    nb++;
    const start = d.createElement("part-group");
    start.setAttribute("type", "start"); start.setAttribute("number", String(nb));
    const gs = d.createElement("group-symbol");
    gs.textContent = symbol;
    start.appendChild(gs);
    if (symbol === "brace") { const gb = d.createElement("group-barline"); gb.textContent = "yes"; start.appendChild(gb); }
    const stop = d.createElement("part-group");
    stop.setAttribute("type", "stop"); stop.setAttribute("number", String(nb));
    list.insertBefore(start, first);
    last.after(stop);
  };
  const pair = plan.braced ? plan.braced.map(at) : null;
  if (pair && pair[0] && pair[1] && sps.indexOf(pair[1]) === sps.indexOf(pair[0]) + 1) group(pair[0], pair[1], "brace");
  if (!plan.condense) return;
  const root = list.parentNode;
  for (const sp of sps) {
    if (pair?.includes(sp)) continue;
    const part = partsIn(root).find((p) => p.getAttribute("id") === sp.getAttribute("id"));
    if (part && stavesOf(part) > 1) wholeInstrument(d, sp);
    else if (!inGroup.has(sp)) group(sp, sp, "none");
  }
}
// A part of several staves (the piano) is kept whole when it rests through a system in one hand
// only — Verovio shows all the staves of a group that holds an instrument definition (from the
// part's <midi-instrument>; Audiveris always writes one) if one shows, else condenses them one by
// one: the left hand resting through a system was left out, the right hand alone under a brace.
function wholeInstrument(d, sp) {
  if (kid(sp, "midi-instrument")) return;
  let si = kid(sp, "score-instrument");
  const id = si?.getAttribute("id") || sp.getAttribute("id") + "-I1";
  if (!si) {
    si = d.createElement("score-instrument");
    si.setAttribute("id", id);
    si.appendChild(d.createElement("instrument-name"));
    sp.insertBefore(si, kids(sp, "player")[0] || kids(sp, "midi-device")[0] || null);
  }
  const mi = d.createElement("midi-instrument");
  mi.setAttribute("id", id);
  const pr = d.createElement("midi-program");
  pr.textContent = "1";
  mi.appendChild(pr);
  sp.appendChild(mi);
}
const stavesOf = (part) => Math.max(1, ...[...part.querySelectorAll(":scope > measure > attributes > staves")].map((s) => num(s, 1)));

// A staff left out of a system (condensed: it rests there) takes its marks with it — Verovio
// draws a direction only on its own staff: a D.S., a section name, a tempo over a piano interlude
// were lost. Verovio keeps a staff that has a note in the system, so a bar that carries a mark
// and rests gets an invisible grace note (print-object="no", unpitched: no fact, no name, not
// counted; ids "keep-…"), which costs the bar ~1.5 staff spaces at its start. (A hidden clef did
// keep the staff, but Verovio then drew the staff's clef invisible at every later system start;
// a visible one is drawn mid-line.)
function keepMarks(d, part) {
  let sign = "G";
  kids(part, "measure").forEach((m, mi) => {
    for (const a of kids(m, "attributes")) for (const c of kids(a, "clef")) if ((c.getAttribute("number") || "1") === "1") sign = txt(kid(c, "sign")) || sign;
    if (!kids(m, "direction").some((dir) => isMark(dir, true))) return;
    const notes = kids(m, "note");
    if (notes.some((n) => kid(n, "pitch") || kid(n, "unpitched"))) return; // (its notes keep it)
    const [step, oct] = sign === "F" ? ["D", "3"] : sign === "C" ? ["C", "4"] : ["B", "4"];
    const n = d.createElement("note");
    n.setAttribute("print-object", "no");
    n.setAttribute("id", `keep-${part.getAttribute("id")}-${mi}`);
    const el = (name, text, parent = n) => { const e = d.createElement(name); if (text != null) e.textContent = text; parent.appendChild(e); return e; };
    el("grace");
    const u = el("unpitched");
    el("display-step", step, u);
    el("display-octave", oct, u);
    el("voice", notes[0] ? txt(kid(notes[0], "voice")) || "1" : "1");
    el("type", "eighth");
    m.insertBefore(n, notes[0] || kids(m, "barline").find((b) => b.getAttribute("location") !== "left") || null);
  });
}

// --- Lyrics, slurs, beams, ties, rests ------------------------------------------------------------

// A hymn's stacked stanzas (≥ 3 verses each with ≥ half the syllables of the longest): verse 1
// only — eight lines of words under every system left 6 bars a page. A song's second verse under a
// repeat (two at most stacked) is what the second pass reads: kept.
function firstStanzaOnly(part) {
  const count = new Map();
  for (const l of part.getElementsByTagName("lyric")) {
    const n = l.getAttribute("number") || "1";
    count.set(n, (count.get(n) || 0) + 1);
  }
  const main = Math.max(0, ...count.values());
  const stanzas = [...count].filter(([, c]) => c >= 0.5 * main).map(([n]) => n);
  if (stanzas.length < 3) return;
  const first = stanzas.sort((a, b) => (Number(a) || 0) - (Number(b) || 0) || a.localeCompare(b))[0];
  for (const l of [...part.getElementsByTagName("lyric")]) if ((l.getAttribute("number") || "1") !== first) l.remove();
}

// Every slur element → its partner's note (MusicXML pairs by number in document order; a stop
// before its start pairs with the next start).
function slurPairs(part) {
  const out = new Map(), open = new Map(), early = new Map();
  for (const n of part.getElementsByTagName("note")) for (const sl of n.querySelectorAll(":scope > notations > slur")) {
    const k = sl.getAttribute("number") || "1", t = sl.getAttribute("type");
    if (t === "start") {
      if (early.has(k)) { const [e, en] = early.get(k); early.delete(k); out.set(sl, en); out.set(e, n); } else open.set(k, [sl, n]);
    } else if (t === "stop") {
      if (open.has(k)) { const [e, en] = open.get(k); open.delete(k); out.set(sl, en); out.set(e, n); } else early.set(k, [sl, n]);
    } else out.set(sl, n); // (continue)
  }
  return out;
}

// Each voice's beam-1 groups of main notes, as Verovio reads them: a grace note doesn't break a
// group, and a "begin" inside an open group continues it (Audiveris: Wichita bar 9's eighth and
// two 16ths). Taken before a staff / voice filter, so rebeam knows which groups it cut.
const beam1 = (n) => kids(n, "beam").find((b) => (b.getAttribute("number") || "1") === "1");
function beamGroups(part) {
  const groups = [];
  for (const m of kids(part, "measure")) {
    const open = new Map(); // voice → its open group
    for (const n of kids(m, "note")) {
      if (kid(n, "chord") || kid(n, "grace")) continue;
      const v = txt(kid(n, "voice")) || "1", b = beam1(n);
      if (!b) { open.delete(v); continue; }
      let g = open.get(v);
      if (!g) { g = []; groups.push(g); open.set(v, g); }
      g.push(n);
      if (txt(b) === "end") open.delete(v);
    }
  }
  return groups;
}
// Groups the filter cut: re-terminated on their kept notes; a note left alone loses its beams (a
// flag). Groups kept whole are left as written.
function rebeam(groups) {
  for (const grp of groups) {
    const left = grp.filter((n) => n.isConnected);
    if (left.length === grp.length || !left.length) continue;
    if (left.length === 1) { for (const b of kids(left[0], "beam")) b.remove(); continue; }
    left.forEach((n, i) => { beam1(n).textContent = i === 0 ? "begin" : i === left.length - 1 ? "end" : "continue"; });
  }
}

// <tie>/<tied> stop before start on a note tied both ways.
function tiesInOrder(p, tag) {
  const els = kids(p, tag);
  const st = els.find((e) => e.getAttribute("type") === "start"), sp = els.find((e) => e.getAttribute("type") === "stop");
  if (st && sp && els.indexOf(st) < els.indexOf(sp)) p.insertBefore(sp, st);
}

// A multi-measure rest over bars that have notes (a hand-made or generated file): Verovio draws
// the rest and drops the notes. The mark goes; a real one (bars of rests only) stays. `all`: the
// parts whose bars it covers (the full score: every part's — a voice's rest under a piano intro).
function dropCoveringRests(part, all = [part]) {
  const ms = kids(part, "measure"), others = all.map((p) => kids(p, "measure"));
  ms.forEach((m, mi) => {
    for (const mr of [...m.querySelectorAll(":scope > attributes > measure-style > multiple-rest")]) {
      const n = Math.max(1, num(mr, 1));
      if (!others.some((pm) => pm.slice(mi, mi + n).some((x) => [...x.getElementsByTagName("note")].some((nt) => kid(nt, "pitch"))))) continue;
      const st = mr.parentElement;
      mr.remove();
      if (!st.children.length) st.remove();
    }
  });
}
