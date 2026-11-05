// Clean-ups applied to Audiveris's MusicXML before it's saved (pdf-import.js). They fix
// recognition slips that the generic MusicXML parser shouldn't second-guess in hand-made
// scores, so they run once, here, on OMR output only.
//
//   const { xml: fixed, changes } = fixOmrScore(xml, log, { tempo });
//   log: the engine's log lines; tempo: a metronome mark read from the PDF's own text

const SPARSE = 0.15; // a "verse" with < 15% of the main verse's syllables is an OCR artifact

export function fixOmrScore(xml, log = [], { tempo = null } = {}) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) return { xml, changes: [] };
  const changes = [];
  foldSparseVerses(doc, changes);
  restoreTempo(doc, log, changes, tempo);
  unifyKeySignatures(doc, changes);
  unifyOctaveClefs(doc, changes);
  markUnmarkedTuplets(doc, changes);
  return { xml: changes.length ? new XMLSerializer().serializeToString(doc) : xml, changes };
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

// Audiveris drops a metronome mark whose note symbol OCR missed ("♩ = 133" read as "= 133"),
// logging: No beat unit in metronome line "With seductive menace, = 133" ... — assume a quarter note.
function restoreTempo(doc, log, changes, fromText) {
  if (doc.querySelector("sound[tempo], metronome")) return;
  let bpm = null, source = "the engine log (the note symbol wasn't read)";
  for (const line of log) {
    const m = /metronome line "[^"]*?=\s*(\d{2,3})\b/.exec(line);
    if (m && Number(m[1]) >= 30 && Number(m[1]) <= 300) { bpm = Number(m[1]); break; }
  }
  // Else the mark as the PDF's text has it (vector PDFs): the engine missed it entirely.
  if (!bpm && fromText) { bpm = fromText; source = "the PDF's text (the engine didn't read the mark)"; }
  if (!bpm) return;
  const measure = doc.querySelector("score-partwise > part > measure");
  if (!measure) return;
  const el = (name, attrs = {}, kids = []) => {
    const e = doc.createElement(name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    for (const k of kids) e.append(k);
    return e;
  };
  const direction = el("direction", { placement: "above" }, [
    el("direction-type", {}, [el("metronome", {}, [el("beat-unit", {}, ["quarter"]), el("per-minute", {}, [String(bpm)])])]),
    el("sound", { tempo: String(bpm) }),
  ]);
  // After <print>/<attributes>, before the first note: direction is valid anywhere in the music data.
  const first = measure.querySelector(":scope > note, :scope > backup, :scope > forward, :scope > direction");
  measure.insertBefore(direction, first);
  changes.push(`tempo ♩ = ${bpm} restored from ${source}`);
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
      for (const oct of [-1, 1]) {
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
