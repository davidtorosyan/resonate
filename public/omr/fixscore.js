// Clean-ups applied to Audiveris's MusicXML before it's saved (pdf-import.js). They fix
// recognition slips that the generic MusicXML parser shouldn't second-guess in hand-made
// scores, so they run once, here, on OMR output only.
//
//   const { xml: fixed, changes } = fixOmrScore(xml, log, { tempo });
//   log: the engine's log lines; tempo: a metronome mark read from the PDF's own text,
//   { bpm, unit: 'half'|'quarter'|'eighth'|null, dotted }

const SPARSE = 0.15; // a "verse" with < 15% of the main verse's syllables is an OCR artifact

export function fixOmrScore(xml, log = [], { tempo = null } = {}) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) return { xml, changes: [] };
  const changes = [];
  dropInserts(doc, changes);
  foldSparseVerses(doc, changes);
  restoreTempo(doc, log, changes, tempo);
  unifyKeySignatures(doc, changes);
  unifyOctaveClefs(doc, changes);
  markUnmarkedTuplets(doc, changes);
  markTupletGroups(doc, changes);
  restoreTies(doc, changes);
  return { xml: changes.length ? new XMLSerializer().serializeToString(doc) : xml, changes };
}

// Boxed inserts — "Fill 1" (a piano fill for the 2nd time), an ossia — are small systems
// drawn apart from the music, usually in a box at the foot of a page, with the time
// signature restated. The engine reads them as measures of the song, right where they
// sit on the page, so the melody got bars of silence that aren't in the song (Piano Man:
// "mak-in' | love" across a page break waited a whole bar for Fill 1). A system is an insert
// only when all three hold: the melody's staff isn't in it (its measures have no width
// and no notes), it restates the time signature already in effect, and it's much
// narrower (< 75%) or far more indented (> 2×) than the score's regular systems — a box
// centred on the page. (A real piano-only passage — an intro, an interlude — has full
// width and no restated time, and stays.) Its measures are removed from every part; the
// attributes set inside them — <divisions>, and the last <key> / <clef> per staff — move to
// the next measure where it doesn't set its own: Audiveris fills a part hidden in the box
// with the clef of that part's next system and writes no clef there when it's the same,
// so the box can be the only place a clef change was written.
function dropInserts(doc, changes) {
  const parts = [...doc.querySelectorAll("score-partwise > part")];
  if (parts.length < 2) return;
  const measuresOf = (p) => [...p.children].filter((c) => c.nodeName === "measure");
  const all = parts.map(measuresOf);
  const n = Math.min(...all.map((ms) => ms.length));
  const lyrics = parts.map((p) => p.querySelectorAll("lyric").length);
  const melody = all[lyrics.indexOf(Math.max(...lyrics))];
  const starts = [];
  for (let i = 0; i < n; i++) {
    if (i === 0 || all.some((ms) => ms[i].querySelector(':scope > print[new-system="yes"], :scope > print[new-page="yes"]'))) starts.push(i);
  }
  const width = (i) => Math.max(0, ...all.map((ms) => Number(ms[i].getAttribute("width")) || 0));
  const margin = (i) => {
    for (const ms of all) {
      const m = ms[i].querySelector(":scope > print system-margins > left-margin");
      if (m) return Number(m.textContent) || 0;
    }
    return null;
  };
  const systems = starts.map((from, k) => {
    const to = starts[k + 1] ?? n;
    let w = 0;
    for (let i = from; i < to; i++) w += width(i);
    return { from, to, width: w, margin: margin(from) };
  });
  const median = (xs) => { const a = xs.filter((x) => x).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : 0; };
  const regularWidth = median(systems.map((sy) => sy.width));
  const regularMargin = median(systems.map((sy) => sy.margin));
  const timeAt = (i) => {
    const t = all.map((ms) => ms[i].querySelector(":scope > attributes > time")).find(Boolean);
    return t ? `${t.querySelector("beats")?.textContent}/${t.querySelector("beat-type")?.textContent}` : null;
  };
  let meter = null;
  const meterBefore = [];
  for (let i = 0; i < n; i++) {
    meterBefore.push(meter);
    meter = timeAt(i) ?? meter;
  }
  const drop = systems.filter((sy) => {
    if (sy.from === 0) return false;
    for (let i = sy.from; i < sy.to; i++) {
      if (melody[i].getAttribute("width") || [...melody[i].querySelectorAll("note")].some((nt) => !nt.querySelector("rest"))) return false;
    }
    const t = timeAt(sy.from);
    if (!t || t !== meterBefore[sy.from]) return false;
    return (regularWidth && sy.width < 0.75 * regularWidth) || (regularMargin && sy.margin !== null && sy.margin > 2 * regularMargin);
  });
  if (!drop.length) return;
  const num = (i) => melody[i].getAttribute("number");
  let count = 0;
  for (const sy of drop) {
    for (const ms of all) {
      // The attribute state the box leaves behind: divisions, keys and clefs by number.
      const carry = new Map(); // "divisions" | "key:N" | "clef:N" → element
      for (let i = sy.from; i < sy.to; i++) {
        for (const at of ms[i].querySelectorAll(":scope > attributes")) {
          for (const el of at.children) {
            if (el.nodeName === "divisions") carry.set("divisions", el);
            else if (el.nodeName === "key" || el.nodeName === "clef") carry.set(`${el.nodeName}:${el.getAttribute("number") || "1"}`, el);
          }
        }
        ms[i].remove();
      }
      const next = ms[sy.to];
      if (!next || !carry.size) continue;
      // Only the next measure's leading attributes count as "set there" (a clef change in
      // the middle of it comes after the box's clef has applied).
      const firstMusic = next.querySelector(":scope > note, :scope > backup, :scope > forward");
      let lead = next.querySelector(":scope > attributes");
      if (lead && firstMusic && lead.compareDocumentPosition(firstMusic) & Node.DOCUMENT_POSITION_PRECEDING) lead = null;
      const has = (key) => {
        if (!lead) return false;
        const [name, num] = key.split(":");
        return [...lead.children].some((el) => el.nodeName === name && (!num || (el.getAttribute("number") || "1") === num));
      };
      const missing = [...carry].filter(([key]) => !has(key));
      if (!missing.length) continue;
      if (!lead) {
        lead = doc.createElement("attributes");
        next.insertBefore(lead, next.querySelector(":scope > note, :scope > backup, :scope > forward, :scope > direction, :scope > harmony") || null);
      }
      // MusicXML order: divisions, key, time, staves, …, clef.
      const order = { divisions: 0, key: 1, time: 2, staves: 3, "part-symbol": 4, instruments: 5, clef: 6 };
      for (const [, el] of missing) {
        const rank = order[el.nodeName];
        const before = [...lead.children].find((c) => (order[c.nodeName] ?? 7) > rank);
        lead.insertBefore(el, before || null);
      }
    }
    count += sy.to - sy.from;
  }
  changes.push(`inserted boxes (fills, ossias) dropped: ${drop.map((sy) => `m${num(sy.from)}${sy.to - sy.from > 1 ? `–${num(sy.to - 1)}` : ""}`).join(", ")} (${count} measures)`);
}

// Several scores ("movements") Audiveris exported from one PDF, joined in order into one:
// each part gets the next score's measures for the part with the same name (else the same
// id, else the same position), renumbered; a part missing from a score gets measures of
// rest so the parts stay aligned. Each joined score's first measure starts a new page
// (as it did in the PDF), so the key and line-break logic see the boundary. Credits, part
// list and defaults are the first score's. A song is one piece; Audiveris starts a new
// movement at an indented system (a Coda), which the engine now turns off, but music must
// never be dropped if it happens anyway.
export function joinMovements(xmls) {
  if (xmls.length < 2) return xmls[0];
  const docs = xmls.map((x) => new DOMParser().parseFromString(x, "application/xml"));
  if (docs.some((d) => d.querySelector("parsererror"))) return xmls[0];
  const base = docs[0];
  const measuresOf = (part) => [...part.children].filter((c) => c.nodeName === "measure");
  const nameOf = (d, id) => d.querySelector(`score-part[id="${id}"] > part-name`)?.textContent.trim() || "";
  const baseParts = [...base.querySelectorAll("score-partwise > part")];
  for (const d of docs.slice(1)) {
    const parts = [...d.querySelectorAll("score-partwise > part")];
    const used = new Set();
    const pick = (bp, i) => {
      const id = bp.getAttribute("id"), name = nameOf(base, id);
      const free = parts.filter((p) => !used.has(p));
      return (name && free.find((p) => nameOf(d, p.getAttribute("id")) === name)) ||
        (parts.length === baseParts.length && free.find((p) => p.getAttribute("id") === id)) ||
        (parts.length === baseParts.length ? free[0] : null);
    };
    const add = Math.max(0, ...parts.map((p) => measuresOf(p).length));
    baseParts.forEach((bp, i) => {
      const src = pick(bp, i);
      if (src) used.add(src);
      const ms = src ? measuresOf(src) : [];
      let n = measuresOf(bp).length;
      for (let k = 0; k < add; k++) {
        let m;
        if (ms[k]) m = base.importNode(ms[k], true);
        else {
          // A whole-measure rest; its length is the other parts' measure.
          m = base.createElement("measure");
          const len = parts.map((p) => measuresOf(p)[k]).filter(Boolean)
            .map((x) => [...x.children].filter((c) => c.nodeName === "note" && !c.querySelector(":scope > chord"))
              .reduce((a, c) => a + Number(c.querySelector(":scope > duration")?.textContent || 0), 0))[0] || 0;
          if (len) {
            const el = (name, kids = [], attrs = {}) => {
              const e = base.createElement(name);
              for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
              for (const c of kids) e.append(c);
              return e;
            };
            m.append(el("note", [el("rest", [], { measure: "yes" }), el("duration", [String(len)]), el("voice", ["1"])]));
          }
        }
        if (k === 0) {
          let pr = [...m.children].find((c) => c.nodeName === "print");
          if (!pr) { pr = base.createElement("print"); m.insertBefore(pr, m.firstChild); }
          pr.setAttribute("new-page", "yes");
        }
        m.setAttribute("number", String(++n));
        bp.append(m);
      }
    });
  }
  return new XMLSerializer().serializeToString(base);
}

// Lyric lines that hold only a few syllables are OCR artifacts:
// - part of a lyric line read slightly below its staff line, so numbered 2 — it belongs to the
//   main verse wherever that verse has no syllable ("See, | people get mean when the chips are down");
// - footnotes or markings under the staff ("See additional lyrics", "gently") — dropped.
function foldSparseVerses(doc, changes) {
  const num = (l) => l.getAttribute("number") || "1";
  const counts = {};
  for (const l of doc.querySelectorAll("note > lyric")) counts[num(l)] = (counts[num(l)] || 0) + 1;
  const verses = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  if (verses.length < 2) return;
  const main = verses[0];
  const sparse = verses.filter((v) => v !== main && counts[v] < SPARSE * counts[main]);
  if (!sparse.length) return;
  let moved = 0, dropped = 0;
  for (const note of doc.querySelectorAll("note")) {
    const lyrics = [...note.querySelectorAll(":scope > lyric")];
    if (!lyrics.length) continue;
    let hasMain = lyrics.some((l) => num(l) === main);
    for (const l of lyrics.sort((a, b) => Number(num(a)) - Number(num(b)) || num(a).localeCompare(num(b)))) {
      if (!sparse.includes(num(l))) continue;
      if (!hasMain) {
        l.setAttribute("number", main);
        hasMain = true;
        moved++;
      } else {
        l.remove();
        dropped++;
      }
    }
  }
  changes.push(`lyric lines ${sparse.join(", ")} (${sparse.map((v) => counts[v]).join("+")} syllables): ` +
    `${moved} moved into verse ${main}, ${dropped} dropped`);
}

// A tempo the engine didn't put in the score. Best source first: the mark as the PDF's own
// text has it (vector PDFs: exact digits, often its note glyph too), then Audiveris's log
// line for a metronome mark whose note symbol OCR missed (No beat unit in metronome line
// "With seductive menace, = 133"). The text mark is the first music page's, so it's added
// unless the first measure has a tempo already (a later mark the engine read doesn't count);
// the log line can't be placed, so it's only used when the score has no tempo at all.
// Beat unit: the glyph when known (SMuFL ♩ 𝅗𝅥 ♪, with a dot), else the meter's usual one —
// a dotted quarter in 6/8, 9/8, 12/8, a half in cut time, else a quarter.
const BEAT = { whole: 4, half: 2, quarter: 1, eighth: 0.5, "16th": 0.25 };
function restoreTempo(doc, log, changes, fromText) {
  const firstMeasures = [...doc.querySelectorAll("score-partwise > part")].map((p) => p.querySelector(":scope > measure")).filter(Boolean);
  if (!firstMeasures.length) return;
  const text = typeof fromText === "number" ? { bpm: fromText } : fromText;
  let mark = null, source = "";
  if (text?.bpm && !firstMeasures.some((m) => m.querySelector("sound[tempo], metronome"))) {
    mark = text;
    source = "the PDF's text (the engine didn't read the mark)";
  } else if (!doc.querySelector("sound[tempo], metronome")) {
    for (const line of log) {
      const m = /metronome line "([^"]*?)(?:=|≈|~)\s*(?:(?:about|approx\.?|approximately|ca\.?|circa|c\.)\s*)?(\d{2,3})\b/i.exec(line);
      if (m && Number(m[2]) >= 30 && Number(m[2]) <= 300) {
        const inN = /\bin\s+(one|two|three|four|1|2|3|4)\b/i.exec(m[1]);
        mark = { bpm: Number(m[2]), ...(inN ? { felt: { one: 1, two: 2, three: 3, four: 4 }[inN[1].toLowerCase()] ?? Number(inN[1]) } : {}) };
        break;
      }
    }
    source = "the engine log (the note symbol wasn't read)";
  }
  if (!mark) return;
  let unit = mark.unit, dotted = !!mark.dotted;
  if (!unit) {
    const time = doc.querySelector("time");
    const beats = Number(time?.querySelector("beats")?.textContent), type = Number(time?.querySelector("beat-type")?.textContent);
    // "in 2" / "in one" in the marking: the bar divided into that many beats.
    const barQ = beats && type ? (beats * 4) / type : null;
    const beatQ = mark.felt && barQ ? barQ / mark.felt : null;
    const asUnit = { 4: ["whole", false], 3: ["half", true], 2: ["half", false], 1.5: ["quarter", true], 1: ["quarter", false], 0.75: ["eighth", true], 0.5: ["eighth", false] }[beatQ];
    if (asUnit) [unit, dotted] = asUnit;
    else if (type === 8 && beats >= 6 && beats % 3 === 0) { unit = "quarter"; dotted = true; }
    else if (time?.getAttribute("symbol") === "cut" || (beats === 2 && type === 2)) unit = "half";
    else unit = "quarter";
  }
  const qpm = Math.round(mark.bpm * BEAT[unit] * (dotted ? 1.5 : 1) * 100) / 100;
  const el = (name, attrs = {}, kids = []) => {
    const e = doc.createElement(name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    for (const k of kids) e.append(k);
    return e;
  };
  const direction = el("direction", { placement: "above" }, [
    el("direction-type", {}, [el("metronome", {}, [el("beat-unit", {}, [unit]), ...(dotted ? [el("beat-unit-dot")] : []), el("per-minute", {}, [String(mark.bpm)])])]),
    el("sound", { tempo: String(qpm) }),
  ]);
  // After <print>/<attributes>, before the first note: direction is valid anywhere in the music data.
  const measure = firstMeasures[0];
  const first = measure.querySelector(":scope > note, :scope > backup, :scope > forward, :scope > direction");
  measure.insertBefore(direction, first);
  const glyph = ({ whole: "𝅝", half: "𝅗𝅥", quarter: "♩", eighth: "♪", "16th": "𝅘𝅥𝅯" }[unit] || "♩") + (dotted ? "." : "");
  changes.push(`tempo ${glyph} = ${mark.bpm} restored from ${source}`);
}

// Missed key signatures. On small staves Audiveris often doesn't find a system's key
// signature (Wichita Lineman, in F: the voice had none for its first 12 measures and the
// key flipped between F and C every system, in voice and piano alike) and spells that
// system in C — every B♭ becomes a B. How its exporter writes keys (PartwiseBuilder):
// a <key> where a staff's key changes (number="N" when the staves of a part differ),
// fifths 0 at a system start where a key is missing after one was known, and nothing at
// all at the top of a page where it's missing (it forgets keys at each page). So each
// staff's key is read per "segment" (system starts, plus measures where a key was
// written mid-system), a page start without a key counting as "none", and:
// - a segment where some staves read a key and others none gets the key the staves read
//   (the majority; ties → the key read most often in the score);
// - a run of segments where no staff reads a key is a miss only next to a segment whose
//   staves disagree (key read on some, missed on others); when every staff changes key
//   together it's a real key change and stays. A single staff fills a gap only between
//   two segments in the same key;
// - a part whose key differs from the others' by the same amount on every segment is a
//   transposing instrument (Audiveris never writes <transpose>): left alone.
// Notes of re-keyed measures are respelled in time order: no printed accidental → the
// key's alteration; printed accidentals carry to later notes of that staff, step and
// octave in the measure (any voice), and tie continuations keep their tie start's pitch.
// Keys are rewritten where they start or change and at every page start, so running this
// again changes nothing.
const KEY_SHARPS = "FCGDAEB", KEY_FLATS = "BEADGCF";
const keyAlter = (fifths, step) =>
  fifths > 0 && KEY_SHARPS.indexOf(step) < fifths ? 1 : fifths < 0 && KEY_FLATS.indexOf(step) < -fifths ? -1 : 0;

function unifyKeySignatures(doc, changes) {
  const kids = (el, name) => [...el.children].filter((c) => c.nodeName === name);
  const partEls = [...doc.querySelectorAll("score-partwise > part")];
  const parts = partEls.map((p) => kids(p, "measure"));
  if (!parts.length || !parts[0].length) return;
  const count = Math.min(...parts.map((m) => m.length));
  const has = (i, sel) => parts.some((ms) => ms[i].querySelector(sel));
  const pageStart = (i) => i === 0 || has(i, ':scope > print[new-page="yes"]');
  const systemStart = (i) => pageStart(i) || has(i, ':scope > print[new-system="yes"]');
  // Staves (lanes) of pitched parts; percussion/tab staves have no key.
  const lanes = [];
  parts.forEach((ms, p) => {
    if (ms.some((m) => m.querySelector(":scope > attributes > clef > sign")?.textContent.match(/percussion|TAB/))) return;
    const staves = Math.max(1, ...ms.map((m) => Number(m.querySelector(":scope > attributes > staves")?.textContent || 1)));
    for (let st = 1; st <= staves; st++) lanes.push({ p, st });
  });
  if (!lanes.length) return;
  const keyFor = (m, st) => {
    let all = null, mine = null;
    for (const k of m.querySelectorAll(":scope > attributes > key")) {
      const f = k.querySelector(":scope > fifths");
      if (!f) continue;
      const n = k.getAttribute("number");
      if (!n) all = Number(f.textContent);
      else if (Number(n) === st) mine = Number(f.textContent);
    }
    return mine ?? all;
  };
  // Each lane's key as Audiveris spelled its notes.
  const spelled = lanes.map(({ p, st }) => {
    let k = 0;
    return parts[p].slice(0, count).map((m, i) => {
      const w = keyFor(m, st);
      k = w !== null ? w : pageStart(i) ? 0 : k;
      return k;
    });
  });
  const bounds = [];
  for (let i = 0; i < count; i++) {
    if (systemStart(i) || spelled.some((ks) => ks[i] !== ks[i - 1])) bounds.push(i);
  }
  const segOf = (i) => { let s = 0; while (s + 1 < bounds.length && bounds[s + 1] <= i) s++; return s; };
  const read = bounds.map((i) => spelled.map((ks) => ks[i]));

  // Transposing parts: the same non-zero offset from the other parts on every segment
  // where both read a key (at least twice).
  const skip = new Set();
  [...new Set(lanes.map((l) => l.p))].forEach((p) => {
    const offs = [];
    read.forEach((r) => {
      const mine = r.filter((k, li) => lanes[li].p === p && k !== 0);
      const others = r.filter((k, li) => lanes[li].p !== p && k !== 0);
      if (mine.length && others.length) offs.push(mine[0] - others[0]);
    });
    if (offs.length >= 2 && offs[0] !== 0 && offs.every((o) => o === offs[0])) skip.add(p);
  });
  const fixGroup = (act) => {
    const nz = (s) => act.map((li) => read[s][li]).filter((k) => k !== 0);
    const popular = new Map();
    read.forEach((_, s) => nz(s).forEach((k) => popular.set(k, (popular.get(k) || 0) + 1)));
    if (!popular.size) return null; // a song in C
    const mixed = (s) => { const n = nz(s).length; return n > 0 && n < act.length; };
    // Several staves that agree on every segment: nothing was missed (or nothing can be told apart).
    if (act.length > 1 && !read.some((_, s) => mixed(s))) return null;
    // Resolve each segment. A key written mid-system is read beyond the system's header
    // (accidentals before a change): what was written there wins over staves that kept
    // the old key.
    const resolved = read.map((_, s) => {
      const i0 = bounds[s];
      if (!systemStart(i0)) {
        const w = act.filter((li) => keyFor(parts[lanes[li].p][i0], lanes[li].st) !== null).map((li) => spelled[li][i0]);
        if (w.length) {
          const c = new Map();
          for (const k of w) c.set(k, (c.get(k) || 0) + 1);
          return [...c].sort((a, b) => b[1] - a[1])[0][0];
        }
      }
      const c = new Map();
      for (const k of nz(s)) c.set(k, (c.get(k) || 0) + 1);
      if (!c.size) return null;
      return [...c].sort((a, b) => b[1] - a[1] || (popular.get(b[0]) || 0) - (popular.get(a[0]) || 0))[0][0];
    });
    for (let a = 0; a < resolved.length; a++) {
      if (resolved[a] !== null) continue;
      let b = a;
      while (b + 1 < resolved.length && resolved[b + 1] === null) b++;
      const prev = a > 0 ? a - 1 : null, next = b + 1 < resolved.length ? b + 1 : null;
      // A boundary that is a key written mid-system is a real change, not evidence of misses.
      const viaPrev = prev !== null && systemStart(bounds[a]);
      const viaNext = next !== null && systemStart(bounds[next]);
      const fill = act.length > 1
        ? (viaPrev && mixed(prev)) || (viaNext && mixed(next))
        : viaPrev && viaNext && resolved[prev] === resolved[next];
      const k = fill ? (prev !== null ? resolved[prev] : resolved[next]) : 0;
      for (let s = a; s <= b; s++) resolved[s] = k;
      a = b;
    }
    const target = (i) => resolved[segOf(i)];
    const wrong = act.filter((li) => spelled[li].some((k, i) => k !== target(i)));
    if (!wrong.length) return null;

    let notes = 0;
    const segsFixed = new Set();
    const tieAlter = new Map(); // lane|step|octave → alter of the last tie start
    const dur = (el) => Number(kids(el, "duration")[0]?.textContent || 0);
    [...new Set(act.map((li) => lanes[li].p))].forEach((p) => {
      const laneOf = (st) => act.find((li) => lanes[li].p === p && lanes[li].st === st);
      let prevTarget = null;
      parts[p].slice(0, count).forEach((m, i) => {
        const t = target(i);
        for (const k of m.querySelectorAll(":scope > attributes > key")) k.remove();
        if (t !== prevTarget || pageStart(i)) setKey(doc, m, t);
        prevTarget = t;
        // Notes in time order (voices of a staff interleave through <backup>).
        const items = [];
        let pos = 0, last = 0;
        for (const el of m.children) {
          if (el.nodeName === "backup") pos -= dur(el);
          else if (el.nodeName === "forward") pos += dur(el);
          else if (el.nodeName === "note") {
            const chord = kids(el, "chord").length > 0;
            const at = chord ? last : pos;
            if (!chord) { last = pos; if (!kids(el, "grace").length) pos += dur(el); }
            items.push({ el, at, order: items.length });
          }
        }
        items.sort((a, b) => a.at - b.at || a.order - b.order);
        const carried = new Set();
        for (const { el: n } of items) {
          const pitch = kids(n, "pitch")[0];
          if (!pitch) continue;
          const st = Number(kids(n, "staff")[0]?.textContent || 1);
          const li = laneOf(st);
          if (li === undefined) continue;
          const step = kids(pitch, "step")[0]?.textContent;
          const where = `${li}|${step}|${kids(pitch, "octave")[0]?.textContent}`;
          const ties = kids(n, "tie").map((x) => x.getAttribute("type"));
          let alterEl = kids(pitch, "alter")[0];
          let alter = alterEl ? Number(alterEl.textContent) : 0;
          if (kids(n, "accidental").length) carried.add(where);
          else if (spelled[li][i] !== t && !carried.has(where)) {
            const want = ties.includes("stop") && tieAlter.has(where) ? tieAlter.get(where) : keyAlter(t, step);
            if (want !== alter) {
              if (!want) alterEl?.remove();
              else {
                if (!alterEl) { alterEl = doc.createElement("alter"); pitch.insertBefore(alterEl, kids(pitch, "octave")[0] || null); }
                alterEl.textContent = String(want);
              }
              alter = want;
              notes++;
              segsFixed.add(segOf(i));
            }
          }
          if (ties.includes("start")) tieAlter.set(where, alter);
        }
      });
    });
    const names = [...new Set(resolved)].map((k) => (k ? `${Math.abs(k)} ${k > 0 ? "sharp" : "flat"}${Math.abs(k) > 1 ? "s" : ""}` : "none"));
    const missed = new Set(wrong.flatMap((li) => spelled[li].map((k, i) => (k !== target(i) ? segOf(i) : -1)).filter((x) => x >= 0))).size;
    const who = groups.length > 1 ? `part${act.length > 1 && new Set(act.map((li) => lanes[li].p)).size > 1 ? "s" : ""} ${[...new Set(act.map((li) => partEls[lanes[li].p].getAttribute("id")))].join(", ")}: ` : "";
    return `${who}key signature ${names.join(" / ")}: missed on ${missed} of ${bounds.length} segments, ${notes} notes respelled`;
  };
  // Parts transposed against the others are judged on their own; the rest together.
  const groups = [];
  const together = lanes.map((l, li) => li).filter((li) => !skip.has(lanes[li].p));
  if (together.length) groups.push(together);
  for (const p of skip) groups.push(lanes.map((l, li) => li).filter((li) => lanes[li].p === p));
  for (const g of groups) {
    const msg = fixGroup(g);
    if (msg) changes.push(msg + (skip.size && g === together ? ` (transposing part${skip.size > 1 ? "s" : ""} ${[...skip].map((p) => partEls[p].getAttribute("id")).join(", ")} on their own)` : ""));
  }
}

// Put <key><fifths>f</fifths></key> in a measure's <attributes> (made if needed), after
// <divisions> as MusicXML orders them.
function setKey(doc, measure, fifths) {
  let at = [...measure.children].find((c) => c.nodeName === "attributes");
  if (!at) {
    at = doc.createElement("attributes");
    measure.insertBefore(at, [...measure.children].find((c) => c.nodeName !== "print") || null);
  }
  const key = doc.createElement("key");
  const f = doc.createElement("fifths");
  f.textContent = String(fifths);
  key.append(f);
  const after = [...at.children].filter((c) => ["footnote", "level", "divisions"].includes(c.nodeName)).pop();
  at.insertBefore(key, after ? after.nextSibling : at.firstChild);
}

// Octave clefs (a G or F clef with a small 8 below or above, e.g. the bass clef of a low voice):
// Audiveris's evidence for the 8 is weak (the classifier grades octave clefs ~0.1), so whether it
// finds it on a given system depends on the exact pixels: on an iPhone half of Hades' systems in
// "Hey, Little Songbird" came out with a plain bass clef, an octave high. A singer's staff doesn't
// switch between a clef and its octave variant, so in a single-staff part where the octave was
// found on at least 2 systems, and on at least a third of that clef's systems, the plain ones
// are the same clef with the 8 missed: they get the octave and their notes (written as sounding
// pitch) move by it, up to the next clef. The 8 has never been found on a plain clef in testing.
function unifyOctaveClefs(doc, changes) {
  for (const part of doc.querySelectorAll("score-partwise > part")) {
    const measures = [...part.querySelectorAll(":scope > measure")];
    if (measures.some((m) => Number(m.querySelector(":scope > attributes > staves")?.textContent || 1) > 1)) continue;
    const clefs = [];
    measures.forEach((m, mi) => {
      for (const c of m.querySelectorAll(":scope > attributes > clef")) {
        clefs.push({ el: c, mi, kind: `${c.querySelector("sign")?.textContent}${c.querySelector("line")?.textContent}`,
          oct: Number(c.querySelector("clef-octave-change")?.textContent || 0) });
      }
    });
    for (const kind of new Set(clefs.map((c) => c.kind))) {
      if (!/^[GF]/.test(kind)) continue;
      const same = clefs.filter((c) => c.kind === kind);
      // First, treble 8va clefs among plain ones of the part are misreads — something
      // printed just above the clef taken for the 8 (Piano Man's "𝄌𝄌" coda sign at CODA II put
      // "And the piano, it sounds like a…" an octave high). A voice doesn't switch to an 8va
      // clef for a system or two; only a part whose clefs are (nearly) all 8va — a piccolo —
      // keeps them. (An 8vb is never reverted: it may be a tenor clef the engine only saw
      // sometimes.)
      const up = same.filter((c) => c.oct === 1);
      const plainG = same.filter((c) => c.oct === 0);
      if (/^G/.test(kind) && up.length && plainG.length && up.length < 2 * plainG.length) {
        let moved = 0;
        for (const c of up) {
          c.el.querySelector("clef-octave-change")?.remove();
          c.oct = 0; // (now plain: an 8vb spread below covers it too)
          const next = clefs.find((d) => d.mi > c.mi);
          const end = next ? next.mi : measures.length;
          for (let mi = c.mi; mi < end; mi++) {
            for (const o of measures[mi].querySelectorAll(":scope > note > pitch > octave")) {
              o.textContent = String(Number(o.textContent) - 1);
              moved++;
            }
          }
        }
        changes.push(`part ${part.getAttribute("id")}: ${up.length} ${kind} 8va clef${up.length > 1 ? "s" : ""} (${up.map((c) => `m${measures[c.mi].getAttribute("number")}`).join(", ")}) among plain ones: ${moved} notes moved down an octave`);
      }
      // Then (only) an 8vb spreads (a voice's treble 8va is a misread — above — and a few of
      // those must not move the whole part up.)
      for (const oct of /^G/.test(kind) ? [-1] : [-1, 1]) {
        const withOct = same.filter((c) => c.oct === oct).length;
        const plain = same.filter((c) => c.oct === 0);
        if (!plain.length || withOct < 2 || 2 * withOct < plain.length) continue;
        let moved = 0;
        for (const c of plain) {
          let coc = c.el.querySelector("clef-octave-change");
          if (!coc) { coc = doc.createElement("clef-octave-change"); c.el.append(coc); }
          coc.textContent = String(oct);
          const next = clefs.find((d) => d.mi > c.mi);
          const end = next ? next.mi : measures.length;
          for (let mi = c.mi; mi < end; mi++) {
            for (const o of measures[mi].querySelectorAll(":scope > note > pitch > octave")) {
              o.textContent = String(Number(o.textContent) + oct);
              moved++;
            }
          }
        }
        changes.push(`part ${part.getAttribute("id")}: ${plain.length} ${kind} clef${plain.length > 1 ? "s" : ""} without the 8 ` +
          `(${withOct} have it): ${moved} notes moved ${oct < 0 ? "down" : "up"} an octave`);
      }
    }
  }
}

// Unmarked tuplets. Audiveris only knows "3" and "6" tuplet signs, and misses some of those, so
// a voice can end up longer than its measure: 4 quarters of a quadruplet in 3/4 ("I'm a bu-sy",
// the 4th of which patch 0007 now keeps instead of dropping it with its syllable), or 3 eighths of
// a triplet whose "3" wasn't read ("give me a"). When a voice is too long by exactly the duration d
// of a run of k >= 3 consecutive equal elements (notes or rests) of duration d, that run is a
// k:(k-1) tuplet: its elements share k-1 slots (durations scaled, <time-modification> added).
// Divisions are multiplied by k in that measure so durations stay whole, and restored after it.
function markUnmarkedTuplets(doc, changes) {
  const kids = (el, name) => [...el.children].filter((c) => c.nodeName === name);
  const val = (el, name) => { const c = el && kids(el, name)[0]; return c ? Number(c.textContent) : null; };
  const voiceOf = (n) => kids(n, "voice")[0]?.textContent || "1";
  const tiedIn = (n) => n.querySelector(':scope > tie[type="stop"], :scope > notations > tied[type="stop"]') !== null;
  const spot = (n) => { const p = kids(n, "pitch")[0]; return p && `${kids(p, "step")[0]?.textContent}${kids(p, "octave")[0]?.textContent}|${kids(n, "staff")[0]?.textContent || "1"}`; };
  // n tied in from a note of a k:(k-1) tuplet in the bar before (the same run over the barline;
  // bars go in order, so that bar's run is marked already)
  const fromTuplet = (n, prev, k) => !!prev && kids(prev, "note").some((p) => spot(p) === spot(n) &&
    p.querySelector(':scope > tie[type="start"], :scope > notations > tied[type="start"]') &&
    kids(p, "time-modification").some((tm) => val(tm, "actual-notes") === k && val(tm, "normal-notes") === k - 1));
  for (const part of doc.querySelectorAll("score-partwise > part")) {
    let divisions = 1, beats = 4, beatType = 4;
    const measures = kids(part, "measure");
    measures.forEach((measure, mi) => {
      for (const at of kids(measure, "attributes")) {
        divisions = val(at, "divisions") ?? divisions;
        const time = kids(at, "time")[0];
        if (time) { beats = val(time, "beats") ?? beats; beatType = val(time, "beat-type") ?? beatType; }
      }
      const expected = (beats * 4 / beatType) * divisions;
      const notes = kids(measure, "note").filter((n) => !kids(n, "grace").length);
      for (const v of new Set(notes.map(voiceOf))) {
        const lead = notes.filter((n) => voiceOf(n) === v && !kids(n, "chord").length);
        const total = lead.reduce((t, n) => t + (val(n, "duration") || 0), 0);
        const excess = total - expected;
        if (excess <= 0 || lead.some((n) => kids(n, "time-modification").length)) continue;
        // Longest run of consecutive elements lasting exactly the excess.
        let best = null;
        for (let i = 0; i < lead.length; ) {
          let j = i;
          while (j < lead.length && val(lead[j], "duration") === excess) j++;
          if (j - i >= 3 && (!best || j - i > best[1] - best[0])) best = [i, j];
          i = j > i ? j : i + 1;
        }
        if (!best) continue;
        // (a note tied in from before starts none when the run after it still makes one: Songbird
        // bar 61, B♭4 held over the barline, then the triplet "rest, A♭4, G4" — not a quadruplet
        // with the held note, as its bars 22, 41, 84 and 119 print, rest first or not — unless it's
        // held from the bar before's own k:(k−1) run: a quadruplet tied into the next one)
        if (best[1] - best[0] > 3 && tiedIn(lead[best[0]]) && !fromTuplet(lead[best[0]], measures[mi - 1], best[1] - best[0])) best[0]++;
        const k = best[1] - best[0];
        const run = new Set(lead.slice(best[0], best[1]));
        // Scale every duration of the measure by k; run elements (and their chord notes) get excess*(k-1).
        for (const el of measure.querySelectorAll(":scope > note > duration, :scope > backup > duration, :scope > forward > duration")) {
          el.textContent = String(Number(el.textContent) * k);
        }
        let owner = null;
        for (const x of kids(measure, "note")) {
          if (voiceOf(x) !== v) continue;
          if (!kids(x, "chord").length) owner = x;
          if (!run.has(owner)) continue;
          kids(x, "duration")[0].textContent = String(excess * (k - 1));
          const tm = doc.createElement("time-modification");
          const a = doc.createElement("actual-notes"); a.textContent = String(k);
          const b = doc.createElement("normal-notes"); b.textContent = String(k - 1);
          tm.append(a, b);
          const after = [...x.children].filter((c) => ["type", "dot", "accidental"].includes(c.nodeName)).pop();
          after ? after.after(tm) : x.append(tm);
        }
        // A backup that went back over the whole (too long) voice now goes back over the measure.
        for (const bk of kids(measure, "backup")) {
          if (val(bk, "duration") === total * k) kids(bk, "duration")[0].textContent = String(expected * k);
        }
        setDivisions(doc, measure, divisions * k);
        const next = measures[mi + 1];
        if (next && !next.querySelector(":scope > attributes > divisions")) setDivisions(doc, next, divisions);
        const words = [...run].map((n) => n.querySelector("lyric > text")?.textContent || (kids(n, "rest").length ? "rest" : "~"));
        changes.push(`part ${part.getAttribute("id")} measure ${measure.getAttribute("number")}: ` +
          `${k} in the time of ${k - 1} (${words.join(" ")})`);
        break; // one per measure (divisions now changed)
      }
    });
  }
}

// Tuplets with no tuplet mark: notes with <time-modification> outside any <tuplet> start/stop —
// those markUnmarkedTuplets made, and Audiveris's own when its "3" was read but not its bracket.
// Notation software draws nothing for them: four plain quarters in a 3/4 bar ("I'm a bu-sy"),
// "give me a" with no 3. Each run of them, per voice, is split into groups of actual-notes
// (by duration: k × the group's shortest element, unscaled) whose first and last elements get
// <tuplet type="start"/"stop">. Runs on every load (idempotent: a marked group is inside a
// tuplet), so songs saved before it get the marks too.
function markTupletGroups(doc, changes) {
  const kids = (el, name) => [...el.children].filter((c) => c.nodeName === name);
  const val = (el, name) => { const c = el && kids(el, name)[0]; return c ? Number(c.textContent) : null; };
  const voiceOf = (n) => kids(n, "voice")[0]?.textContent || "1";
  const tupletOf = (n, type) => n.querySelector(`:scope > notations > tuplet[type="${type}"]`);
  const mark = (n, type) => {
    let no = kids(n, "notations")[0];
    if (!no) {
      no = doc.createElement("notations");
      n.insertBefore(no, kids(n, "lyric")[0] || kids(n, "play")[0] || kids(n, "listen")[0] || null);
    }
    const t = doc.createElement("tuplet");
    t.setAttribute("type", type);
    no.appendChild(t);
  };
  for (const part of doc.querySelectorAll("score-partwise > part")) {
    const where = [];
    for (const measure of kids(part, "measure")) {
      const notes = kids(measure, "note").filter((n) => !kids(n, "grace").length);
      let groups = 0;
      for (const v of new Set(notes.map(voiceOf))) {
        // lead elements of the voice, each with its chord notes (Audiveris marks every chord note)
        const leads = [];
        for (const n of notes) {
          if (voiceOf(n) !== v) continue;
          if (!kids(n, "chord").length || !leads.length) leads.push([n]);
          else leads[leads.length - 1].push(n);
        }
        const runs = [];
        let inside = false, run = null;
        for (const g of leads) {
          if (g.some((n) => tupletOf(n, "start"))) inside = true;
          const tm = kids(g[0], "time-modification")[0];
          const ratio = tm ? `${val(tm, "actual-notes")}:${val(tm, "normal-notes")}` : null;
          if (!inside && tm && val(tm, "actual-notes") >= 2 && val(tm, "normal-notes") >= 1) {
            if (run && run.ratio === ratio) run.els.push(g[0]);
            else runs.push((run = { ratio, actual: val(tm, "actual-notes"), normal: val(tm, "normal-notes"), els: [g[0]] }));
          } else run = null;
          if (g.some((n) => tupletOf(n, "stop"))) inside = false;
        }
        for (const r of runs) {
          const nominal = (n) => (val(n, "duration") || 0) * r.actual / r.normal;
          if (!(Math.min(...r.els.map(nominal)) > 0)) continue;
          // a group closes at `actual` of its own smallest value (3 eighths, or 3 quarters: quarter
          // triplets next to eighth triplets are two groups, not [q q] [q e])
          let grp = [], sum = 0, unit = Infinity;
          for (const n of r.els) {
            const v = nominal(n);
            grp.push(n);
            sum += v;
            unit = Math.min(unit, v);
            if (sum >= r.actual * unit - 1e-6) {
              if (grp.length > 1) { mark(grp[0], "start"); mark(grp[grp.length - 1], "stop"); groups++; }
              grp = []; sum = 0; unit = Infinity;
            }
          }
        }
      }
      if (groups) where.push(`m${measure.getAttribute("number")}`);
    }
    if (where.length) changes.push(`part ${part.getAttribute("id")}: tuplet marks added (${where.join(", ")})`);
  }
}

// Ties the engine missed. Audiveris finds a tie as a short curve between two heads; beside a
// chord's other heads, or cut by a line break, the curve is often lost, read as a slur, linked to
// the wrong head, or written half (a start with no stop) — Killing Me Softly bar 3: the piano's
// tied F♯/A chord under "life" had no tie at all, and the B/G chord under "words", tied over the
// line break, came out as one slur from the G to the next line's B. The voice usually keeps its
// tie (one head, room around it). Ties are judged note by note: a note's continuation is a note
// of the same staff starting where it ends (or at the next bar's start when nothing else on that
// staff starts later in the bar: at a barline, or a bar the engine left short — Killing bar 6, a
// tied eighth chord read as 16ths) at the same staff position (step and octave), with the same
// alteration or no printed accidental (a tie carries the first note's accidental; a continuation
// the engine didn't link took the key's — Wichita bar 12, F♯ → F; a printed natural is a change,
// and so is a key change between the two: an unmarked note there is the new key's, struck again).
// A note's *strike* is the notes of one part's staff starting at the same moment (any voice —
// Audiveris numbers a chord's notes into voices loosely) when they all last the same; a second
// head at a staff position already paired (the engine's phantom beside a real head, on its dot or
// at a tie's end: Piano Man's accordion chords, Yellow Submarine's octaves) is left out of the
// comparison and never tied. Repairs, in order, each only where the notes tied into carry no
// syllable (a new word is sung, not tied), no articulation and no grace note before them (struck
// again), and the first ones aren't marked short (staccato, a breath):
//   1. a slur from a note to the next onset of its staff is a tie when (a) that onset is the same
//      notes again (a slur between identical chords means nothing else; a tie over a line break
//      comes out this way — a slur within one voice ties no other voice striking again in its
//      own rhythm, as 3), (b) the slur ends on the note's own continuation, or on that of the
//      head a step from it (the curve's start on a phantom: Songbird bar 37's [D3 E♭3]), even when
//      other notes start there (Songbird bar 120's octave tied into a fuller chord, across voices),
//      or (c) the note is alone in its strike and the slur ends a third or less from its
//      continuation, its ends level (the curve linked to the next chord's other head: Killing bar
//      68's G♯3 under the right hand's B3 — a melisma slur to a head a third away climbs with it);
//      and (d) in a sung part, a slur over the note's continuation (no syllable) to the note after
//      it is a melisma slur over a tie the engine lost: the tie is added, the slur kept (Piano Man
//      bar 161; Too Sweet bar 17, the tie's curve linked to the next note — not in a piano part:
//      Yellow Submarine bar 59's tie, linked to a chord struck twice);
//   2. a part that plays the sung line (most of its notes carry words), where it doubles it: where
//      the voice ties a note over, another part's staff striking that note at the same moment, for
//      the same length, and the same notes again where the voice's tie ends, ties it — when that
//      part also plays the voice's note before the tie (or, after a rest, the one after it) at its
//      time and length (Musicnotes P/V/G: the piano's right hand doubles the tune; repeated block
//      chords holding the tied pitch are accompaniment, struck again; where the piano strikes a
//      different chord — Killing bar 7, F♯ then F♯/A — it re-strikes, as printed); a note held
//      there over another voice of its staff striking in its own rhythm (notes of other lengths
//      start with it: no strike) is tied to what its own voice plays next, the voice's tied-to note
//      again for as long (Yellow Submarine's right hand, the tune's dotted halves over inner
//      dotted-quarter chords: bars 1, 3, 11, 23, 25, 51, 55);
//   3. a strike tied on some notes is tied on all of them when the next strike is the same notes
//      again — except another voice under them going on in a voice of its own for as long again:
//      struck again (Yellow Submarine bar 13, the inner dotted quarters under the tune's tied D♯4;
//      Killing bar 62's inner eighth into a half note is held, as printed);
//   4. every tie carries its accidental: a continuation with no printed accidental takes the
//      first note's alteration, along the chain (gybr bars 103–105, E♭ → E; the engine doesn't
//      carry it over a page turn either) — also the engine's own ties, before the rules too;
//   5. a later ending that starts with the notes the bar before the first ending ties into it
//      (the print's tie-in from nowhere, which Audiveris drops) takes their accidentals there
//      (Killing Me Softly bar 40: the piano's G♯3 held from bar 37 read as G3, and bar 41 with it
//      over the engine's tie); no tie is written into the ending (Sing and Play strike again after
//      a jump anyway).
// Known limit: an inner voice striking the same notes again under a held melody note, its new
// notes of another length (printed with a tie on the melody only), looks like a tie lost on it.
// A tie is written both ways the readers take it: <tie> after <duration> (Sing's parser) and
// <tied> in <notations> (Verovio), stop before start on a note tied both ways. The rules go again
// while a pass changes the score (below), so one call is idempotent.
function restoreTies(doc, changes, debug = null, { round = 0, where = new Map(), carried = new Map() } = {}) {
  let dirty = false; // (this pass changed the score)
  const kid = (el, name) => { for (const c of el.children) if (c.nodeName === name) return c; return null; };
  const kids = (el, name) => { const out = []; for (const c of el.children) if (c.nodeName === name) out.push(c); return out; };
  const num = (el, name) => { const c = kid(el, name); return c ? Number(c.textContent) : null; };
  const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }, LETTERS = "CDEFGAB";
  const EPS = 1e-6, Q = 960; // (onsets keyed in 1/960 quarters)
  const key = (q) => Math.round(q * Q);
  const tieTypes = (n) => {
    const out = kids(n, "tie").map((t) => t.getAttribute("type"));
    for (const no of kids(n, "notations")) for (const t of kids(no, "tied")) out.push(t.getAttribute("type"));
    return out;
  };
  const tiedOn = (n) => tieTypes(n).some((t) => t === "start" || t === "continue");
  const tiedIn = (n) => tieTypes(n).some((t) => t === "stop" || t === "continue");
  // marks on a note: any articulation (struck again), and the ones that part it from what follows
  const SHORT = new Set(["staccato", "staccatissimo", "spiccato", "breath-mark", "caesura"]);
  const marksOf = (n) => {
    const out = [];
    for (const no of kids(n, "notations")) for (const ar of kids(no, "articulations")) for (const c of ar.children) out.push(c.nodeName);
    return out;
  };

  const parts = [...doc.querySelectorAll("score-partwise > part")].map((part) => {
    const groups = new Map(); // "mi|staff|onset" → [{ el, pos, alter, acc, midi, d, on, mi, staff, voice, lyric, x, bar }]
    const graces = new Set();  // "mi|staff|onset": a grace note before the note starting there
    const last = new Map();    // "mi|staff" → the latest onset anything (a note or a rest) starts at
    const ends = [], notes = [], byBar = [];
    let div = 1, beats = 4, unit = 4;
    const keys = new Map(); // staff ("" = every staff) → the fifths in effect
    kids(part, "measure").forEach((m, mi) => {
      let pos = 0, prev = 0, max = 0;
      byBar[mi] = [];
      for (const el of m.children) {
        const name = el.nodeName;
        if (name === "attributes") {
          div = num(el, "divisions") || div;
          const t = kid(el, "time");
          if (t && num(t, "beats")) { beats = num(t, "beats"); unit = num(t, "beat-type") || 4; }
          for (const k of kids(el, "key")) {
            const f = num(k, "fifths"), st = k.getAttribute("number");
            if (f == null) continue;
            if (st) keys.set(st, f); else { keys.clear(); keys.set("", f); }
          }
        } else if (name === "backup") pos -= (num(el, "duration") || 0) / div;
        else if (name === "forward") pos += (num(el, "duration") || 0) / div;
        else if (name === "note") {
          const staff = kid(el, "staff")?.textContent || "1";
          if (kid(el, "grace")) { graces.add(`${mi}|${staff}|${key(pos)}`); continue; }
          if (kid(el, "cue")) continue;
          const d = (num(el, "duration") || 0) / div, chord = !!kid(el, "chord");
          const on = chord ? prev : pos;
          if (!chord) { prev = pos; pos += d; max = Math.max(max, pos); }
          const sk = `${mi}|${staff}`;
          if (!(last.get(sk) >= on)) last.set(sk, on);
          const p = kid(el, "pitch");
          if (!p) continue;
          const step = kid(p, "step")?.textContent, oct = num(p, "octave"), alter = Math.round(num(p, "alter") || 0);
          const x = Number(el.getAttribute("default-x"));
          const n = {
            el, step, oct, pos: oct * 7 + LETTERS.indexOf(step), alter, acc: !!kid(el, "accidental"), midi: (oct + 1) * 12 + STEP[step] + alter,
            d, on, mi, staff, voice: kid(el, "voice")?.textContent || "1", lyric: !!kid(el, "lyric"), x: Number.isFinite(x) ? x : null, bar: m,
            key: keys.get(staff) ?? keys.get("") ?? 0,
          };
          const k = `${sk}|${key(on)}`;
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k).push(n);
          notes.push(n);
          byBar[mi].push(n);
        }
      }
      ends[mi] = Math.min(beats * 4 / unit, max || beats * 4 / unit);
    });
    const group = (n) => groups.get(`${n.mi}|${n.staff}|${key(n.on)}`);
    // a note's strike when all its notes last the same; its chord (the notes there as long as it)
    const strike = (n) => { const s = group(n); return s.every((x) => Math.abs(x.d - n.d) < EPS) ? s : null; };
    const chord = (n) => group(n).filter((x) => Math.abs(x.d - n.d) < EPS);
    // the notes of n's staff starting where it ends
    const next = (n) => {
      const t = n.on + n.d;
      if (t < ends[n.mi] - EPS) {
        const s = groups.get(`${n.mi}|${n.staff}|${key(t)}`);
        if (s || last.get(`${n.mi}|${n.staff}`) > n.on + EPS) return s || null;
      }
      return groups.get(`${n.mi + 1}|${n.staff}|0`) || null;
    };
    // the note of the same staff and voice that ends where n starts (in the bar before, at its start)
    const before = (n) => {
      if (n.on > EPS) return byBar[n.mi].find((x) => x.staff === n.staff && x.voice === n.voice && Math.abs(x.on + x.d - n.on) < EPS) || null;
      return n.mi > 0 ? byBar[n.mi - 1].find((x) => x.staff === n.staff && x.voice === n.voice && Math.abs(x.on + x.d - ends[n.mi - 1]) < EPS) || null : null;
    };
    // the notes of n's staff and voice starting where it ends (at the next bar's start when it ends its bar)
    const nextInVoice = (n) => {
      const t = n.on + n.d, inBar = t < ends[n.mi] - EPS;
      const at = inBar ? t : 0, g = (byBar[inBar ? n.mi : n.mi + 1] || []).filter((x) => x.staff === n.staff && x.voice === n.voice && Math.abs(x.on - at) < EPS);
      return g.length ? g : null;
    };
    const sung = notes.filter((n) => n.lyric).length >= 0.25 * notes.length;
    const inTime = notes.map((n, i) => [n, i]).sort((x, y) => x[0].mi - y[0].mi || x[0].on - y[0].on || x[1] - y[1]).map(([n]) => n);
    return { part, id: part.getAttribute("id"), notes, inTime, byBar, graces, strike, chord, next, nextInVoice, before, lyric: notes.length > 0 && sung };
  });

  // the same note again (a tie carries the first one's accidental; a printed one is a change —
  // and so is a key change between them: there an unmarked note is the new key's, struck again)
  const cont = (a, b) => a.pos === b.pos && (a.alter === b.alter || (!b.acc && a.key === b.key));
  // A's notes paired with their continuations in B (the same voice first), a head nearer its
  // chord's column before a second one at its staff position; `miss` / `extra`: the notes of A / B
  // left over, a second head at a staff position already paired in its own group not counted
  const column = (g) => {
    const xs = g.map((n) => n.x).filter((x) => x != null).sort((a, b) => a - b);
    const c = xs.length ? xs[xs.length >> 1] : 0;
    return [...g].sort((a, b) => Math.abs((a.x ?? c) - c) - Math.abs((b.x ?? c) - c));
  };
  const link = (A, B) => {
    const left = column(B), pairs = [], miss = [];
    for (const a of column(A)) {
      let i = left.findIndex((b) => cont(a, b) && b.voice === a.voice);
      if (i < 0) i = left.findIndex((b) => cont(a, b));
      if (i < 0) miss.push(a); else pairs.push([a, left.splice(i, 1)[0]]);
    }
    const dup = (n, side) => pairs.some((pr) => pr[side] !== n && pr[side].pos === n.pos);
    return { pairs, miss: miss.filter((n) => !dup(n, 0)), extra: left.filter((n) => !dup(n, 1)) };
  };
  const same = (L) => L.pairs.length > 0 && !L.miss.length && !L.extra.length;
  // a tie's two ends are level; a slur to a head a step or a third away climbs or falls with it
  // (default-y: tenths from the staff's top line, as Audiveris writes every curve end)
  const level = (a, b) => !a.hasAttribute("default-y") || !b.hasAttribute("default-y") ||
    Math.abs(Number(a.getAttribute("default-y")) - Number(b.getAttribute("default-y"))) <= 5;
  // nothing struck again where the pairs end: no syllable, no articulation, no grace note before
  // them, and nothing marked short where they start
  const clear = (p, pairs) => {
    if (pairs.some(([a, b]) => b.lyric || marksOf(b.el).length || marksOf(a.el).some((m) => SHORT.has(m)))) return false;
    const b = pairs[0][1];
    return !p.graces.has(`${b.mi}|${b.staff}|${key(b.on)}`);
  };
  const add = (n, type) => {
    let changed = false;
    if (!kids(n, "tie").some((t) => t.getAttribute("type") === type)) {
      const t = doc.createElement("tie");
      t.setAttribute("type", type);
      const ties = kids(n, "tie"), dur = kid(n, "duration");
      // stop before start
      const ref = type === "stop" ? (ties[0] || dur?.nextSibling || null) : ((ties.at(-1) || dur)?.nextSibling || null);
      n.insertBefore(t, ref);
      changed = dirty = true;
    }
    let no = kid(n, "notations");
    const tied = no ? kids(no, "tied") : [];
    if (!tied.some((t) => t.getAttribute("type") === type)) {
      if (!no) {
        no = doc.createElement("notations");
        n.insertBefore(no, kid(n, "lyric") || kid(n, "play") || kid(n, "listen") || null);
      }
      const td = doc.createElement("tied");
      td.setAttribute("type", type);
      // (a stop first; a start after the last <tied> there — appended when that's the last child)
      no.insertBefore(td, type === "stop" ? (tied[0] || no.firstChild) : (tied.length ? tied.at(-1).nextSibling : no.firstChild));
      changed = dirty = true;
    }
    return changed;
  };
  // a tied-to note with no printed accidental takes the first note's alteration (carried: part id →
  // bar numbers, over every pass)
  const carry = (p, a, b) => {
    if (b.alter === a.alter || b.acc) return;
    dirty = true;
    const pitch = kid(b.el, "pitch");
    let al = kid(pitch, "alter");
    if (a.alter) {
      if (!al) { al = doc.createElement("alter"); pitch.insertBefore(al, kid(pitch, "octave")); }
      al.textContent = String(a.alter);
    } else if (al) al.remove();
    b.midi += a.alter - b.alter;
    b.alter = a.alter;
    if (!carried.has(p.id)) carried.set(p.id, new Set());
    carried.get(p.id).add(b.bar.getAttribute("number"));
  };
  // (a pair tied already had its accidental carried by carryTies: from the first note tied into it)
  const tieAll = (p, pairs) => {
    let any = false;
    for (const [x, y] of pairs) {
      const a = add(x.el, "start"), b = add(y.el, "stop");
      if (a || b) { any = true; carry(p, x, y); }
    }
    return any;
  };
  const spell = (n) => n.step + (["𝄫", "♭", "", "♯", "𝄪"][n.alter + 2] ?? "") + n.oct;
  // (where: part id → bar numbers, over every pass)
  const mark = (rule, p, pairs) => {
    const [a, b] = pairs[0], no = a.bar.getAttribute("number");
    if (!where.has(p.id)) where.set(p.id, new Set());
    where.get(p.id).add(no);
    debug?.push(`${rule} ${p.id} m${no}@${a.on} st${a.staff} → m${b.bar.getAttribute("number")}@${b.on}: ${pairs.map(([x]) => spell(x)).join(" ")}`);
  };
  // 4. (also first: the comparisons below see the engine's own ties carried; a continuation takes
  // one note's accidental — the first tied into it: two tied heads at its position, a phantom's
  // other alteration beside the real one, would hand it back and forth)
  const carryTies = () => {
    for (const p of parts) {
      const into = new Set();
      for (const x of p.inTime) {
        if (!tiedOn(x.el)) continue;
        const B = p.next(x) || [];
        const y = B.find((b) => b.pos === x.pos && b.voice === x.voice && tiedIn(b.el)) || B.find((b) => b.pos === x.pos && tiedIn(b.el));
        if (y && !into.has(y)) { into.add(y); carry(p, x, y); }
      }
    }
  };
  carryTies();

  // 1. slurs that are ties (in time order: a slur may run from a voice written after <backup> to
  // one written before it)
  for (const p of parts) {
    // slur number → the slurs open under it [{ from (note), els }]: Audiveris frees a number at a
    // slur's end in the order it writes the notes (voice by voice, then <backup>), so two voices'
    // slurs overlapping in time can share one — an end takes its own voice's start, else the latest
    const open = new Map();
    for (const n of p.inTime) {
      for (const no of kids(n.el, "notations")) {
        for (const sl of kids(no, "slur")) {
          const k = sl.getAttribute("number") || "1", type = sl.getAttribute("type");
          if (!open.has(k)) open.set(k, []);
          const list = open.get(k);
          if (type === "start") { list.push({ from: n, els: [sl] }); continue; }
          let i = list.findLastIndex((o) => o.from.voice === n.voice);
          if (i < 0) i = list.length - 1;
          if (i < 0) continue;
          const o = list[i];
          o.els.push(sl);
          if (type !== "stop") continue;
          list.splice(i, 1);
          const x = o.from, B = p.next(x);
          if (!B || n.lyric) continue;
          if (!B.includes(n)) {
            // (d) a sung line's slur over the note's own continuation to the note after it — held over
            // a barline (Piano Man), or the curve starting past halfway to the continuation: a tie's
            // curve linked on (Too Sweet); a melisma slur from the note's own head over a repeat in
            // its bar is sung again
            const y = p.lyric && n.voice === x.voice && !tiedOn(x.el) && B.find((b) => cont(x, b) && b.voice === x.voice);
            const s0 = o.els[0], sx = s0.hasAttribute("default-x") && x.x != null ? x.x + Number(s0.getAttribute("default-x")) : NaN;
            const held = y && (y.mi !== x.mi || (y.x != null && sx > (x.x + y.x) / 2));
            if (held && (p.next(y) || []).includes(n) && clear(p, [[x, y]]) && tieAll(p, [[x, y]])) mark("over", p, [[x, y]]);
            continue;
          }
          const A = p.chord(x), L = link(A, B);
          let pairs = null;
          if (same(L)) {
            // (a) — a slur within one voice doesn't tie another voice striking again in its own
            // rhythm (as 3: Yellow Submarine's inner dotted quarters); held on, it's tied (Killing bar 28)
            const yv = L.pairs.find(([a]) => a === x)?.[1].voice ?? x.voice;
            pairs = n.voice !== x.voice ? L.pairs : L.pairs.filter(([a, b]) => a.voice === x.voice || b.voice === yv || Math.abs(a.d - b.d) > EPS);
          } else {
            const hit = L.pairs.find(([, b]) => b === n), own = L.pairs.find(([a]) => a === x);
            if (hit && (hit[0] === x || (Math.abs(hit[0].pos - x.pos) <= 1 && hit[0].voice === x.voice))) pairs = [hit]; // (b)
            else if (!hit && own && !L.miss.length && L.pairs.length === 1 && Math.abs(n.pos - own[1].pos) <= 2 && level(o.els[0], sl)) pairs = [own]; // (c)
          }
          if (!pairs || !clear(p, pairs)) continue;
          for (const s of o.els) { const par = s.parentElement; s.remove(); if (par && !par.children.length) par.remove(); }
          dirty = true;
          tieAll(p, pairs);
          mark("slur", p, pairs);
        }
      }
    }
  }

  // 2. a part doubling the sung line takes its ties
  for (const v of parts.filter((p) => p.lyric)) {
    for (const n of v.notes) {
      if (!tiedOn(n.el)) continue;
      const to = v.next(n);
      const m = to && (to.find((x) => cont(n, x) && x.voice === n.voice) || to.find((x) => cont(n, x)));
      if (!m) continue;
      // the voice's note before the tie, else (a rest before it) the one after the tied-to note
      const lead = v.before(n) || (v.next(m) || []).find((x) => x.voice === m.voice) || null;
      if (!lead) continue;
      for (const p of parts) {
        if (p === v) continue;
        const doubled = (x) => (p.byBar[x.mi] || []).some((y) => y.midi === x.midi && Math.abs(y.on - x.on) < EPS && Math.abs(y.d - x.d) < EPS);
        if (!doubled(lead)) continue;
        for (const c of p.byBar[n.mi] || []) {
          if (c.midi !== n.midi || Math.abs(c.on - n.on) > EPS || Math.abs(c.d - n.d) > EPS || tiedOn(c.el)) continue;
          const A = p.strike(c);
          let mine;
          if (A) {
            const B = p.next(c);
            if (!B || B[0].mi !== m.mi || Math.abs(B[0].on - m.on) > EPS) continue;
            const L = link(A, B);
            if (!same(L) || !clear(p, L.pairs)) continue;
            mine = L.pairs.filter(([x]) => x === c);
          } else {
            // held, alone in its own voice, over another voice of its staff striking shorter notes
            // with it (Yellow Submarine's right hand: the tune's dotted halves over inner
            // dotted-quarter chords): what its own voice plays next, alone, is the voice's tied-to
            // note again, for as long. (Not where the strike is the tune's note alone: Killing bar
            // 7's F♯ then F♯/A — the A in another voice — is struck again.)
            const g = p.nextInVoice(c) || [], y = g.length === 1 && cont(c, g[0]) ? g[0] : null;
            if (!y || y.mi !== m.mi || Math.abs(y.on - m.on) > EPS || Math.abs(y.d - m.d) > EPS || tiedIn(y.el)) continue;
            if (p.byBar[c.mi].some((x) => x !== c && x.staff === c.staff && x.voice === c.voice && Math.abs(x.on - c.on) < EPS)) continue;
            mine = [[c, y]];
            if (!clear(p, mine)) continue;
          }
          if (tieAll(p, mine)) mark("dbl", p, mine);
        }
      }
    }
  }

  // 3. a strike tied in part is tied whole
  for (const p of parts) {
    const seen = new Set();
    for (const n of p.notes) {
      if (!tiedOn(n.el)) continue;
      const A = p.strike(n), B = A && p.next(n);
      if (!B || seen.has(A)) continue;
      seen.add(A);
      const L = link(A, B);
      if (!same(L) || L.pairs.length < 2 || !clear(p, L.pairs)) continue;
      // (another voice under the tied notes, going on in a voice of its own for as long again, is
      // struck again: Yellow Submarine's inner dotted quarters; held on — Killing bar 62's eighth
      // into a half — or joining the tied notes' chord, it's tied)
      const tv = new Set(), yv = new Set();
      for (const [a, b] of L.pairs) if (tiedOn(a.el)) { tv.add(a.voice); yv.add(b.voice); }
      if (L.pairs.some(([a, b]) => !tv.has(a.voice) && !yv.has(b.voice) && Math.abs(a.d - b.d) < EPS)) continue;
      if (tieAll(p, L.pairs)) mark("chord", p, L.pairs);
    }
  }

  // 5. a later ending starts with the notes held from the bar before the first ending: the tie
  // into it (printed as a tie-in from nowhere) carries their accidentals — Killing Me Softly bar
  // 40, the piano's G♯3 held from bar 37, read as G3 (and so on through bar 41's tie). Endings are
  // read from the top part (Audiveris writes them there only). The notes there take nothing else.
  const marks = [];
  for (const [mi, m] of kids(parts[0]?.part || doc.createElement("part"), "measure").entries()) {
    for (const bl of kids(m, "barline")) for (const e of kids(bl, "ending")) {
      if (e.getAttribute("type") !== "start") continue;
      marks.push({ mi, first: (e.getAttribute("number") || "").split(/[^0-9]+/).includes("1") });
    }
  }
  marks.forEach((e, i) => {
    const f = e.first ? null : marks.slice(0, i).reverse().find((x) => x.first);
    if (!f || f.mi < 1 || e.mi <= f.mi) return;
    for (const p of parts) {
      const seen = new Set();
      for (const a of p.byBar[f.mi - 1] || []) {
        // a strike tied out of the bar before the first ending, into its first notes
        const B = tiedOn(a.el) && p.next(a);
        if (!B || B[0].mi !== f.mi || seen.has(B)) continue;
        seen.add(B);
        const A = p.chord(a).filter((x) => tiedOn(x.el));
        const In = link(A, B);
        if (In.miss.length || !In.pairs.every(([, y]) => tiedIn(y.el))) continue;
        const E = (p.byBar[e.mi] || []).filter((y) => y.staff === a.staff && y.on < EPS);
        const L = link(A, E);
        if (!L.pairs.length || L.miss.length) continue;
        for (const [x, y] of L.pairs) carry(p, x, y);
      }
    }
  });

  carryTies();
  // (a tie rule 3 completes, an accidental it or the closing carry hands on, can make what rules
  // 1–2 judged before match: again until a pass changes nothing — four at most)
  if (dirty && round < 3) return restoreTies(doc, changes, debug, { round: round + 1, where, carried });
  for (const [id, bars] of where) changes.push(`part ${id}: ties restored (m${[...bars].join(", m")})`);
  for (const [id, bars] of carried) changes.push(`part ${id}: accidentals carried over ties (m${[...bars].join(", m")})`);
}

function setDivisions(doc, measure, value) {
  let at = [...measure.children].find((c) => c.nodeName === "attributes");
  if (!at) {
    at = doc.createElement("attributes");
    const first = [...measure.children].find((c) => !["print"].includes(c.nodeName));
    measure.insertBefore(at, first || null);
  }
  let dv = [...at.children].find((c) => c.nodeName === "divisions");
  if (!dv) { dv = doc.createElement("divisions"); at.insertBefore(dv, at.firstChild); }
  dv.textContent = String(value);
}
