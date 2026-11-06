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
      const m = /metronome line "[^"]*?=\s*(\d{2,3})\b/.exec(line);
      if (m && Number(m[1]) >= 30 && Number(m[1]) <= 300) { mark = { bpm: Number(m[1]) }; break; }
    }
    source = "the engine log (the note symbol wasn't read)";
  }
  if (!mark) return;
  let unit = mark.unit, dotted = !!mark.dotted;
  if (!unit) {
    const time = doc.querySelector("time");
    const beats = Number(time?.querySelector("beats")?.textContent), type = Number(time?.querySelector("beat-type")?.textContent);
    if (type === 8 && beats >= 6 && beats % 3 === 0) { unit = "quarter"; dotted = true; }
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
