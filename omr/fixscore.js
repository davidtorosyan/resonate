// Clean-ups applied to Audiveris's MusicXML before it's saved (pdf-import.js). They fix
// recognition slips that the generic MusicXML parser shouldn't second-guess in hand-made
// scores, so they run once, here, on OMR output only.
//
//   const { xml: fixed, changes } = fixOmrScore(xml, log);   // log: the engine's log lines

const SPARSE = 0.15; // a "verse" with < 15% of the main verse's syllables is an OCR artifact

export function fixOmrScore(xml, log = []) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) return { xml, changes: [] };
  const changes = [];
  foldSparseVerses(doc, changes);
  restoreTempo(doc, log, changes);
  unifyKeySignatures(doc, changes);
  unifyOctaveClefs(doc, changes);
  markUnmarkedTuplets(doc, changes);
  return { xml: changes.length ? new XMLSerializer().serializeToString(doc) : xml, changes };
}

// Several scores ("movements") Audiveris exported from one PDF, joined in order into one:
// each part gets the next score's measures for the same part id (else the same position),
// renumbered; a part missing from a score gets empty measures so the parts stay aligned.
// Credits, part list and defaults are the first score's. A song is one piece; Audiveris
// starts a new movement at an indented system (a Coda), which the engine now turns off,
// but music must never be dropped if it happens anyway.
export function joinMovements(xmls) {
  if (xmls.length < 2) return xmls[0];
  const docs = xmls.map((x) => new DOMParser().parseFromString(x, "application/xml"));
  if (docs.some((d) => d.querySelector("parsererror"))) return xmls[0];
  const base = docs[0];
  const measuresOf = (part) => [...part.children].filter((c) => c.nodeName === "measure");
  const baseParts = [...base.querySelectorAll("score-partwise > part")];
  for (const d of docs.slice(1)) {
    const parts = [...d.querySelectorAll("score-partwise > part")];
    const add = Math.max(0, ...parts.map((p) => measuresOf(p).length));
    baseParts.forEach((bp, i) => {
      const src = parts.find((p) => p.getAttribute("id") === bp.getAttribute("id")) || parts[i];
      const ms = src ? measuresOf(src) : [];
      let n = measuresOf(bp).length;
      for (let k = 0; k < add; k++) {
        const m = ms[k] ? base.importNode(ms[k], true) : base.createElement("measure");
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
function restoreTempo(doc, log, changes) {
  if (doc.querySelector("sound[tempo], metronome")) return;
  let bpm = null;
  for (const line of log) {
    const m = /metronome line "[^"]*?=\s*(\d{2,3})\b/.exec(line);
    if (m && Number(m[1]) >= 30 && Number(m[1]) <= 300) { bpm = Number(m[1]); break; }
  }
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
  changes.push(`tempo ♩ = ${bpm} restored from the engine log (the note symbol wasn't read)`);
}

// Missed key signatures. On small staves Audiveris often doesn't find a system's key
// signature (Wichita Lineman, in F: the voice had none for its first 12 measures and the
// key flipped between F and C every system, in voice and piano alike), and then writes
// that system in C — every B♭ becomes a B. A key reading of "none" is the usual miss, so
// when the readings (one per part per system) are mostly one key and parts disagree
// within a system, each system gets the key its staves read (majority of the non-zero
// readings; none → the previous system's, the first ones → the first key read), and the
// notes of re-keyed measures are respelled: no printed accidental → the key's alteration;
// printed accidentals, notes after one in the same measure, and tied continuations keep
// theirs. Scores whose parts agree system by system are left alone (real key changes).
const KEY_SHARPS = "FCGDAEB", KEY_FLATS = "BEADGCF";
const keyAlter = (fifths, step) =>
  fifths > 0 && KEY_SHARPS.indexOf(step) < fifths ? 1 : fifths < 0 && KEY_FLATS.indexOf(step) < -fifths ? -1 : 0;

function unifyKeySignatures(doc, changes) {
  const kids = (el, name) => [...el.children].filter((c) => c.nodeName === name);
  // Transposing instruments (a B♭ part) have their own key on every system: left out.
  const parts = [...doc.querySelectorAll("score-partwise > part")]
    .filter((p) => !p.querySelector(":scope > measure > attributes > transpose"))
    .map((p) => kids(p, "measure"));
  if (!parts.length || !parts[0].length) return;
  const count = Math.min(...parts.map((m) => m.length));
  // System starts: measure 0 and any measure (of any part) printed on a new system or page.
  const starts = [0];
  for (let i = 1; i < count; i++) {
    if (parts.some((ms) => ms[i].querySelector(':scope > print[new-system="yes"], :scope > print[new-page="yes"]'))) starts.push(i);
  }
  const sysOf = (i) => { let s = 0; while (s + 1 < starts.length && starts[s + 1] <= i) s++; return s; };
  const keyIn = (m) => {
    const k = m.querySelector(":scope > attributes > key > fifths");
    return k ? Number(k.textContent) : null;
  };
  // Each part's key in force at each measure, as written (none yet = 0).
  const old = parts.map((ms) => {
    let k = 0;
    return ms.slice(0, count).map((m) => (k = keyIn(m) ?? k));
  });
  const readings = starts.map((i) => old.map((ks) => ks[i]));
  const all = readings.flat();
  const nonzero = all.filter((k) => k !== 0);
  if (nonzero.length < 2 || nonzero.length < 0.25 * all.length) return; // a song in C, or a stray reading
  const disagree = parts.length > 1
    ? readings.some((r) => new Set(r).size > 1)
    : readings.some((r, s) => r[0] === 0 && readings.slice(0, s).some((x) => x[0]) && readings.slice(s + 1).some((x) => x[0])) ||
      nonzero.length >= 0.5 * all.length;
  if (!disagree) return;
  // Resolve each system's key.
  const resolved = readings.map((r) => {
    const counts = new Map();
    for (const k of r) if (k !== 0) counts.set(k, (counts.get(k) || 0) + 1);
    return counts.size ? [...counts].sort((a, b) => b[1] - a[1])[0][0] : null;
  });
  for (let s = 1; s < resolved.length; s++) if (resolved[s] === null) resolved[s] = resolved[s - 1];
  const first = resolved.find((k) => k !== null);
  for (let s = 0; s < resolved.length; s++) if (resolved[s] === null) resolved[s] = first;
  const target = (i) => resolved[sysOf(i)];
  if (old.every((ks) => ks.every((k, i) => k === target(i)))) return;

  let notesFixed = 0, systemsFixed = new Set();
  parts.forEach((ms, p) => {
    let prevTarget = null;
    const tieAlter = new Map(); // staff|step|octave → alter of the last tie start
    ms.slice(0, count).forEach((m, i) => {
      const t = target(i);
      // Key elements: one where the resolved key starts or changes, none elsewhere.
      for (const k of m.querySelectorAll(":scope > attributes > key")) k.remove();
      if (t !== prevTarget) setKey(doc, m, t);
      prevTarget = t;
      const fix = old[p][i] !== t;
      if (fix) systemsFixed.add(sysOf(i));
      const carried = new Set(); // staff|step|octave with a printed accidental earlier in the measure
      for (const n of kids(m, "note")) {
        const pitch = kids(n, "pitch")[0];
        if (!pitch) continue;
        const step = kids(pitch, "step")[0]?.textContent;
        const octave = kids(pitch, "octave")[0]?.textContent;
        const where = `${kids(n, "staff")[0]?.textContent || "1"}|${step}|${octave}`;
        const tied = kids(n, "tie").map((x) => x.getAttribute("type"));
        let alterEl = kids(pitch, "alter")[0];
        let alter = alterEl ? Number(alterEl.textContent) : 0;
        if (kids(n, "accidental").length) carried.add(where);
        else if (fix && !carried.has(where)) {
          const want = tied.includes("stop") && tieAlter.has(where) ? tieAlter.get(where) : keyAlter(t, step);
          if (want !== alter) {
            if (!want) alterEl?.remove();
            else {
              if (!alterEl) { alterEl = doc.createElement("alter"); pitch.insertBefore(alterEl, kids(pitch, "octave")[0] || null); }
              alterEl.textContent = String(want);
            }
            alter = want;
            notesFixed++;
          }
        }
        if (tied.includes("start")) tieAlter.set(where, alter);
      }
    });
  });
  const names = [...new Set(resolved)].map((k) => (k ? `${Math.abs(k)} ${k > 0 ? "sharp" : "flat"}${Math.abs(k) > 1 ? "s" : ""}` : "no sharps or flats"));
  changes.push(`key signature ${names.join(" / ")}: missed on ${systemsFixed.size} of ${starts.length} systems, ${notesFixed} notes respelled`);
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
