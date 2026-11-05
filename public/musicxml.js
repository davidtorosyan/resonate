// MusicXML → a timed melody for karaoke.
//   score = { title, partName, fifths, mode ("major"/"minor"/null), tempo (quarter notes / min),
//             beats, beatType, verses, measures: [start (quarters)], length (quarters), notes }
//   note  = { midi, letter (0-6 = C-B, as written), alter, onset, dur (quarters), measure,
//             verses: { "1": {text, syllabic} }, restBefore }

const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const LETTERS = "CDEFGAB";
const UNIT_QUARTERS = { whole: 4, half: 2, quarter: 1, eighth: 0.5, "16th": 0.25 };
export const DEFAULT_TEMPO = 90;

// Read a File that is .musicxml / .xml / .mxl and return the score XML text.
export async function readScoreFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"
  return isZip ? xmlFromMxl(bytes) : decodeText(bytes);
}

// UTF-8 by default; UTF-16 (some exporters, e.g. Finale) by BOM or by the
// tell-tale zero bytes of "<?xml" in UTF-16.
function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  if (bytes[0] === 0x3c && bytes[1] === 0x00) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0x00 && bytes[1] === 0x3c) return new TextDecoder("utf-16be").decode(bytes);
  return new TextDecoder().decode(bytes);
}

export function parseMusicXml(xmlText, fallbackName = "Untitled") {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Not valid XML");
  const root = doc.documentElement;
  if (root.nodeName === "score-timewise") throw new Error("Timewise MusicXML isn't supported — export as partwise");
  if (root.nodeName !== "score-partwise") throw new Error("Not a MusicXML score");

  const title =
    text(root.querySelector("movement-title")) ||
    text(root.querySelector("work > work-title")) ||
    creditTitle(root) ||
    fallbackName.replace(/\.(musicxml|xml|mxl)$/i, "");

  const parts = [...root.querySelectorAll(":scope > part")];
  if (!parts.length) throw new Error("Score has no parts");

  // Pick the part + voice that carries the most lyric syllables (the sung
  // melody). Fall back to the first part's voice 1 for lyric-less scores.
  let best = null;
  for (const part of parts) {
    const counts = {};
    for (const n of part.querySelectorAll("note")) {
      if (!n.querySelector("lyric")) continue;
      const v = text(n.querySelector("voice")) || "1";
      counts[v] = (counts[v] || 0) + 1;
    }
    for (const [voice, c] of Object.entries(counts)) {
      if (!best || c > best.count) best = { part, voice, count: c };
    }
  }
  if (!best) best = { part: parts[0], voice: text(parts[0].querySelector("note > voice")) || "1", count: 0 };

  const partId = best.part.getAttribute("id");
  const partName = text(root.querySelector(`score-part[id="${partId}"] > part-name`)) || partId;

  const tempo = findTempo(root);
  let divisions = 1;
  let fifths = null, mode = null;
  let beats = null, beatType = null;
  const notes = [];
  const measures = [];
  const verseSet = new Set();
  let restPending = false;
  let measureStart = 0;

  // Measures that start a new system or page (the <print> marks usually sit in the first part).
  const lineStarts = new Set();
  for (const part of new Set([parts[0], best.part])) {
    for (const m of part.querySelectorAll(':scope > measure')) {
      if (m.querySelector(':scope > print[new-system="yes"], :scope > print[new-page="yes"]')) lineStarts.add(m.getAttribute("number"));
    }
  }

  const melodyMeasures = [...best.part.querySelectorAll(":scope > measure")];
  melodyMeasures.forEach((measure, mi) => {
    const mNum = measure.getAttribute("number");
    measures.push(measureStart);
    let lineStart = lineStarts.has(mNum); // until this measure's first melody note
    // Track the position across every voice (backup/forward) so the
    // measure's length — and so every note's onset — is right.
    let pos = 0, maxPos = 0, lastStart = 0;
    for (const el of measure.children) {
      const name = el.nodeName;
      if (name === "attributes") {
        const d = text(el.querySelector("divisions"));
        if (d) divisions = Number(d) || 1;
        const f = text(el.querySelector("key > fifths"));
        if (f && fifths === null) {
          fifths = Number(f);
          mode = { major: "major", minor: "minor" }[text(el.querySelector("key > mode"))] || null;
        }
        if (beats === null && el.querySelector("time > beats")) {
          beats = Number(text(el.querySelector("time > beats"))) || 4;
          beatType = Number(text(el.querySelector("time > beat-type"))) || 4;
        }
        continue;
      }
      if (name === "backup") { pos -= (Number(text(el.querySelector("duration"))) || 0) / divisions; continue; }
      if (name === "forward") {
        pos += (Number(text(el.querySelector("duration"))) || 0) / divisions;
        maxPos = Math.max(maxPos, pos);
        continue;
      }
      if (name !== "note") continue;

      const isChord = !!el.querySelector(":scope > chord");
      const isGrace = !!el.querySelector(":scope > grace");
      const dur = isGrace ? 0 : (Number(text(el.querySelector(":scope > duration"))) || 0) / divisions;
      let start;
      if (isChord) start = lastStart;
      else {
        start = pos;
        lastStart = pos;
        pos += dur;
        maxPos = Math.max(maxPos, pos);
      }

      const voice = text(el.querySelector("voice")) || "1";
      if (voice !== best.voice || isGrace || el.querySelector(":scope > cue")) continue;
      if (el.querySelector(":scope > rest")) {
        restPending = true;
        continue;
      }
      const pitch = el.querySelector("pitch");
      if (!pitch) continue; // unpitched
      const step = text(pitch.querySelector("step"));
      const alter = Math.round(Number(text(pitch.querySelector("alter")) || 0));
      const midi = (Number(text(pitch.querySelector("octave"))) + 1) * 12 + STEP_PC[step] + alter;
      const letter = LETTERS.indexOf(step);
      const onset = measureStart + start;

      // Chord tones: keep only the highest note at that onset.
      if (isChord) {
        const last = notes[notes.length - 1];
        if (last && Math.abs(last.onset - onset) < 1e-6 && midi > last.midi) Object.assign(last, { midi, letter, alter });
        continue;
      }

      const tieTypes = [...el.querySelectorAll(":scope > tie")].map((t) => t.getAttribute("type"));
      const verses = {};
      for (const ly of el.querySelectorAll(":scope > lyric")) {
        const num = ly.getAttribute("number") || "1";
        // Elided syllables (<text>I</text><elision/><text>'m</text>): join
        // directly before an apostrophe, otherwise with a space.
        const t = [...ly.querySelectorAll("text")].map((x) => x.textContent)
          .reduce((acc, x) => (acc ? acc + (/^['’]/.test(x) ? "" : " ") + x : x), "");
        // Drop verse numbers ("1. "), and old-style spaced contractions ("I 'm").
        // NFKC turns typographic ligatures (common in OCR'd scores: "ﬁ") into plain letters.
        const clean = t.normalize("NFKC").replace(/^\s*\d+\.\s*/, "").replace(/(\w)\s(['’](?:m|s|t|ll|re|ve|d)\b)/g, "$1$2").trim();
        if (!clean) continue;
        verses[num] = { text: clean, syllabic: text(ly.querySelector("syllabic")) || "single" };
        verseSet.add(num);
      }

      const last = notes[notes.length - 1];
      if (tieTypes.includes("stop") && last && last.midi === midi && last.tieOpen) {
        last.dur += dur;
        last.tieOpen = tieTypes.includes("start");
        lineStart = false;
        continue;
      }
      // A tie split by a line or page break is often lost by sheet-music recognition
      // (Audiveris doesn't join the two halves of the curve across pages): the line's
      // first note then repeats the last sung note, with no syllable of its own and no
      // rest between. Treat that as the tie it almost always is.
      if (lineStart && last && last.midi === midi && !restPending && !Object.keys(verses).length &&
          Object.keys(last.verses).length && Math.abs(last.onset + last.dur - onset) < 1e-6) {
        last.dur += dur;
        last.tieOpen = tieTypes.includes("start");
        lineStart = false;
        continue;
      }
      lineStart = false;
      notes.push({ midi, letter, alter, onset, dur, measure: mNum, mi, verses, restBefore: restPending, tieOpen: tieTypes.includes("start") });
      restPending = false;
    }
    measureStart += maxPos;
  });
  if (!notes.length) throw new Error("No pitched notes found");
  for (const n of notes) delete n.tieOpen;

  const verses = [...verseSet].sort((a, b) => (Number(a) || 0) - (Number(b) || 0) || a.localeCompare(b));
  const score = {
    title, partName, fifths: fifths ?? 0, mode, tempo: tempo ?? DEFAULT_TEMPO, tempoFromScore: tempo !== null,
    beats: beats ?? 4, beatType: beatType ?? 4, verses, measures, length: measureStart, notes,
  };
  const order = performanceOrder(readStructure(parts, melodyMeasures.length), notes);
  return order ? unfold(score, order) : score;
}

// --- Repeats, endings and jumps -------------------------------------------------
// The Sing page follows a song the way it's performed: repeats taken, 1st/2nd endings,
// D.S./D.C. (al Coda / al Fine) — each pass through a repeated section singing its own
// verse (pass 2 → verse 2, when that section has a verse 2; else the latest verse it has).

// Per measure (index): { forward, backward, times, endingStart: [numbers], endingStop,
// segno, codaSign, toCoda, codaTarget, ds, dc, fine }, from every part (sheet-music
// recognition may put a sign on only some of them).
function readStructure(parts, count) {
  const marks = Array.from({ length: count }, () => ({}));
  for (const part of parts) {
    [...part.querySelectorAll(":scope > measure")].slice(0, count).forEach((m, i) => {
      const mk = marks[i];
      for (const bl of m.querySelectorAll(":scope > barline")) {
        const rep = bl.querySelector(":scope > repeat");
        const dir = rep?.getAttribute("direction");
        if (dir === "forward") mk.forward = true;
        if (dir === "backward") {
          mk.backward = true;
          mk.times = Math.max(mk.times || 0, Number(rep.getAttribute("times")) || 0);
        }
        const end = bl.querySelector(":scope > ending");
        if (end) {
          const type = end.getAttribute("type");
          if (type === "start") {
            const nums = (end.getAttribute("number") || "").split(/[,\s.]+/).map(Number).filter((n) => n > 0);
            mk.endingStart = nums.length ? nums : [1];
          } else if (type === "stop" || type === "discontinue") mk.endingStop = true;
        }
      }
      for (const d of m.querySelectorAll(":scope > direction")) {
        const words = [...d.querySelectorAll("direction-type > words")].map((w) => w.textContent).join(" ");
        if (d.querySelector("direction-type > segno")) mk.segno = true;
        if (d.querySelector("direction-type > coda")) mk.codaSign = true;
        if (/\bto\s+coda\b/i.test(words)) mk.toCoda = true;
        if (/\bD\.\s?S\.|\bdal\s+segno\b/i.test(words)) mk.ds = true;
        else if (/\bD\.\s?C\.|\bda\s+capo\b/i.test(words)) mk.dc = true;
        if (/^\s*fine\s*$/i.test(words)) mk.fine = true;
      }
      for (const snd of m.querySelectorAll("sound")) {
        if (snd.hasAttribute("segno")) mk.segno = true;
        if (snd.hasAttribute("dalsegno")) mk.ds = true;
        if (snd.getAttribute("dacapo") === "yes") mk.dc = true;
        if (snd.hasAttribute("tocoda")) mk.toCoda = true;
        if (snd.hasAttribute("coda")) mk.codaTarget = true;
        if (snd.hasAttribute("fine")) mk.fine = true;
      }
    });
  }
  return marks;
}

// The measure indexes in performance order, or null when that's just the written order.
// Repeats go back to the last forward repeat (or the start, or just after the previous
// repeat); a repeat plays `times` times, or one more than its ending's highest number
// ("1.2.3." → 4), and at least as many times as its section has verses. An ending is
// played on the passes it's numbered for; one past all its numbers that doesn't repeat is
// the final ending. A 1st ending recognition cut short (it stops just before its repeat
// sign) runs to that repeat. After a D.S./D.C. repeats aren't taken again, first endings
// are skipped, "To Coda" jumps to the Coda and "Fine" ends the song.
function performanceOrder(marks, notes) {
  const N = marks.length;
  if (!marks.some((m) => m.backward || m.ds || m.dc)) return null;
  const versesIn = Array.from({ length: N }, () => new Set());
  for (const n of notes) for (const v of Object.keys(n.verses)) versesIn[n.mi]?.add(v);
  // Endings: start → stop (or its repeat), extended to a repeat sign just after it.
  const endingOf = new Array(N).fill(null);
  for (let i = 0; i < N; i++) {
    if (!marks[i].endingStart) continue;
    let j = i;
    while (j < N - 1 && !marks[j].endingStop && !marks[j].backward && !marks[j + 1].endingStart && !marks[j + 1].forward) j++;
    if (!marks[j].backward) {
      for (let k = j + 1; k <= Math.min(N - 1, j + 2); k++) {
        if (marks[k].endingStart || marks[k].forward) break;
        if (marks[k].backward) { j = k; break; }
      }
    }
    const e = { nums: marks[i].endingStart, start: i, end: j };
    for (let k = i; k <= j; k++) endingOf[k] = e;
    i = j;
  }
  const segno = marks.findIndex((m) => m.segno);
  const jumpFrom = marks.findIndex((m) => m.ds || m.dc);
  const toCoda = marks.findIndex((m) => m.toCoda);
  let codaAt = marks.findIndex((m, i) => m.codaTarget && i > jumpFrom);
  if (codaAt < 0) codaAt = marks.findLastIndex((m, i) => m.codaSign && i > Math.max(jumpFrom, toCoda) && !m.toCoda);

  const order = [];
  const taken = new Map();
  let i = 0, repStart = 0, pass = 1, jumped = false, guard = 0;
  while (i < N && guard++ < N * 12) {
    const mk = marks[i], e = endingOf[i];
    if (mk.forward && repStart !== i) { repStart = i; pass = 1; }
    if (e && i === e.start) {
      const repeats = marks[e.end].backward;
      const play = jumped ? !repeats : e.nums.includes(pass) || (pass > Math.max(...e.nums) && !repeats);
      if (!play) { i = e.end + 1; continue; }
    }
    order.push(i);
    if (jumped && mk.fine) break;
    if (jumped && mk.toCoda && codaAt > i) { i = codaAt; continue; }
    if (mk.backward && !jumped) {
      let verseCount = 1;
      for (let k = repStart; k <= i; k++) for (const v of versesIn[k]) verseCount = Math.max(verseCount, Number(v) || 1);
      const times = Math.max(mk.times || (e ? Math.max(...e.nums) + 1 : 2), Math.min(verseCount, 8));
      const t = taken.get(i) || 0;
      if (t < times - 1) { taken.set(i, t + 1); pass++; i = repStart; continue; }
      repStart = i + 1;
    }
    if ((mk.ds && segno >= 0) || mk.dc) {
      if (!jumped) { jumped = true; i = mk.ds ? segno : 0; continue; }
    }
    i++;
  }
  return order.every((m, k) => m === k) && order.length === N ? null : order;
}

// Lay the notes out in performance order. Each run of consecutive measures is one pass:
// the k-th time its first measure is played, each of its measures sings verse k if it has
// words for it, else the latest verse it has words for (a refrain printed once, under
// verse 1). Notes then carry that pass's syllable as verse "1" (the Sing page's verse
// menu disappears: the passes choose the verses).
function unfold(score, order) {
  const len = (i) => (score.measures[i + 1] ?? score.length) - score.measures[i];
  const byMeasure = new Map();
  for (const n of score.notes) {
    if (!byMeasure.has(n.mi)) byMeasure.set(n.mi, []);
    byMeasure.get(n.mi).push(n);
  }
  const runs = [];
  order.forEach((m, k) => (k && m === order[k - 1] + 1 ? runs[runs.length - 1].push(m) : runs.push([m])));
  const seen = new Map();
  const notes = [], measures = [];
  let t = 0;
  for (const run of runs) {
    const k = (seen.get(run[0]) || 0) + 1;
    run.forEach((m, r) => {
      const have = new Set();
      for (const n of byMeasure.get(m) || []) for (const v of Object.keys(n.verses)) have.add(v);
      const num = [...have].map(Number).filter((v) => v > 0 && v <= k);
      const verse = have.has(String(k)) ? String(k) : num.length ? String(Math.max(...num)) : [...have][0];
      seen.set(m, (seen.get(m) || 0) + 1);
      measures.push(t);
      for (const n of byMeasure.get(m) || []) {
        const v = verse && n.verses[verse];
        notes.push({ ...n, onset: t + (n.onset - score.measures[m]), verses: v ? { 1: v } : {},
          restBefore: n.restBefore || (r === 0 && n === byMeasure.get(m)[0] && notes.length > 0), pass: k });
      }
      t += len(m);
    });
  }
  return {
    ...score,
    notes,
    measures,
    length: t,
    verses: notes.some((n) => n.verses[1]) ? ["1"] : [],
    unfolded: { written: score.measures.length, played: order.length, passes: Math.max(...[...seen.values()]) },
  };
}

// First tempo marking: <sound tempo> (quarter notes/min) or a <metronome>.
function findTempo(root) {
  const snd = root.querySelector("sound[tempo]");
  if (snd) {
    const t = Number(snd.getAttribute("tempo"));
    if (t > 0) return t;
  }
  const met = root.querySelector("metronome");
  if (met) {
    const per = Number(text(met.querySelector("per-minute")));
    const unit = UNIT_QUARTERS[text(met.querySelector("beat-unit"))] || 1;
    const dotted = met.querySelector("beat-unit-dot") ? 1.5 : 1;
    if (per > 0) return per * unit * dotted;
  }
  return null;
}

// Resolve the notes for one verse: each note gets the syllable it carries, or
// is marked as a melisma continuation of the previous syllable.
export function notesForVerse(score, verse) {
  let lastSyl = null;
  return score.notes.map((n) => {
    const v = n.verses[verse];
    const base = { midi: n.midi, letter: n.letter, alter: n.alter, onset: n.onset, dur: n.dur, measure: n.measure, restBefore: n.restBefore };
    if (v) {
      lastSyl = v;
      return { ...base, text: v.text, syllabic: v.syllabic, melisma: false };
    }
    return { ...base, text: "", syllabic: null, melisma: !!lastSyl && !n.restBefore };
  });
}

// Split a verse's notes into lyric lines for the karaoke display: break at
// rests and after line-ending punctuation; cap very long lines.
export function lyricLines(notes, maxSyllables = 14) {
  const lines = [];
  let cur = [];
  let syl = 0;
  notes.forEach((n, i) => {
    if (cur.length && n.restBefore) { lines.push(cur); cur = []; syl = 0; }
    cur.push(i);
    if (!n.melisma) syl++;
    const next = notes[i + 1];
    const endsLine = /[,.;:!?]["'”’)]*$/.test(n.text) && !(next && next.melisma);
    if (endsLine || (syl >= maxSyllables && !(next && next.melisma) && n.syllabic !== "begin" && n.syllabic !== "middle")) {
      lines.push(cur); cur = []; syl = 0;
    }
  });
  if (cur.length) lines.push(cur);
  return lines;
}

// Many exporters (e.g. MuseScore) only put the title in a page credit:
// use an explicit credit-type "title", else the largest-font credit.
function creditTitle(root) {
  const credits = [...root.querySelectorAll("credit")];
  const typed = credits.find((c) => text(c.querySelector("credit-type")) === "title");
  if (typed) return text(typed.querySelector("credit-words"));
  let best = null, size = 0;
  for (const w of root.querySelectorAll("credit > credit-words")) {
    const s = parseFloat(w.getAttribute("font-size")) || 0;
    if (s > size && text(w)) { size = s; best = w; }
  }
  return best ? text(best) : "";
}

function text(el) {
  return el ? el.textContent.trim() : "";
}

// --- .mxl (zip) ---------------------------------------------------------------
// Minimal zip reader: central directory → entries; deflate via DecompressionStream.

async function xmlFromMxl(bytes) {
  const entries = readZipDirectory(bytes);
  let path = null;
  const container = entries.find((e) => e.name === "META-INF/container.xml");
  if (container) {
    const c = new DOMParser().parseFromString(await unzipEntry(bytes, container), "application/xml");
    if (c.querySelector("parsererror")) throw new Error("Corrupt .mxl (bad container.xml)");
    path = c.querySelector("rootfile")?.getAttribute("full-path") || null;
  }
  const entry =
    entries.find((e) => e.name === path) ||
    entries.find((e) => !e.name.startsWith("META-INF/") && /\.(musicxml|xml)$/i.test(e.name));
  if (!entry) throw new Error("No score inside .mxl");
  return unzipEntry(bytes, entry);
}

function readZipDirectory(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Corrupt .mxl (no zip directory)");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function unzipEntry(bytes, e) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lp = e.localOffset;
  const start = lp + 30 + dv.getUint16(lp + 26, true) + dv.getUint16(lp + 28, true);
  const data = bytes.subarray(start, start + e.compSize);
  if (e.method === 0) return decodeText(data);
  if (e.method !== 8) throw new Error("Unsupported .mxl compression");
  if (typeof DecompressionStream === "undefined") throw new Error("This browser can't open .mxl — use uncompressed .musicxml");
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return decodeText(new Uint8Array(await new Response(stream).arrayBuffer()));
}
