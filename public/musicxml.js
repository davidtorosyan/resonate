// MusicXML → a timed melody for karaoke.
//   score = { title, partName, fifths, tempo (quarter notes / min), beats, beatType,
//             verses, measures: [start (quarters)], length (quarters), notes }
//   note  = { midi, onset, dur (quarters), measure, verses: { "1": {text, syllabic} }, restBefore }

const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const UNIT_QUARTERS = { whole: 4, half: 2, quarter: 1, eighth: 0.5, "16th": 0.25 };
export const DEFAULT_TEMPO = 90;

// Read a File that is .musicxml / .xml / .mxl and return the score XML text.
export async function readScoreFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"
  return isZip ? xmlFromMxl(bytes) : new TextDecoder().decode(bytes);
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
  let fifths = null;
  let beats = null, beatType = null;
  const notes = [];
  const measures = [];
  const verseSet = new Set();
  let restPending = false;
  let measureStart = 0;

  for (const measure of best.part.querySelectorAll(":scope > measure")) {
    const mNum = measure.getAttribute("number");
    measures.push(measureStart);
    // Track the position across every voice (backup/forward) so the
    // measure's length — and so every note's onset — is right.
    let pos = 0, maxPos = 0, lastStart = 0;
    for (const el of measure.children) {
      const name = el.nodeName;
      if (name === "attributes") {
        const d = text(el.querySelector("divisions"));
        if (d) divisions = Number(d) || 1;
        const f = text(el.querySelector("key > fifths"));
        if (f && fifths === null) fifths = Number(f);
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
      const midi =
        (Number(text(pitch.querySelector("octave"))) + 1) * 12 +
        STEP_PC[text(pitch.querySelector("step"))] +
        Math.round(Number(text(pitch.querySelector("alter")) || 0));
      const onset = measureStart + start;

      // Chord tones: keep only the highest note at that onset.
      if (isChord) {
        const last = notes[notes.length - 1];
        if (last && Math.abs(last.onset - onset) < 1e-6 && midi > last.midi) last.midi = midi;
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
        const clean = t.replace(/^\s*\d+\.\s*/, "").replace(/(\w)\s(['’](?:m|s|t|ll|re|ve|d)\b)/g, "$1$2").trim();
        if (!clean) continue;
        verses[num] = { text: clean, syllabic: text(ly.querySelector("syllabic")) || "single" };
        verseSet.add(num);
      }

      const last = notes[notes.length - 1];
      if (tieTypes.includes("stop") && last && last.midi === midi && last.tieOpen) {
        last.dur += dur;
        last.tieOpen = tieTypes.includes("start");
        continue;
      }
      notes.push({ midi, onset, dur, measure: mNum, verses, restBefore: restPending, tieOpen: tieTypes.includes("start") });
      restPending = false;
    }
    measureStart += maxPos;
  }
  if (!notes.length) throw new Error("No pitched notes found");
  for (const n of notes) delete n.tieOpen;

  const verses = [...verseSet].sort((a, b) => (Number(a) || 0) - (Number(b) || 0) || a.localeCompare(b));
  return {
    title, partName, fifths: fifths ?? 0, tempo: tempo ?? DEFAULT_TEMPO, tempoFromScore: tempo !== null,
    beats: beats ?? 4, beatType: beatType ?? 4, verses, measures, length: measureStart, notes,
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
    const base = { midi: n.midi, onset: n.onset, dur: n.dur, measure: n.measure, restBefore: n.restBefore };
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
  if (e.method === 0) return new TextDecoder().decode(data);
  if (e.method !== 8) throw new Error("Unsupported .mxl compression");
  if (typeof DecompressionStream === "undefined") throw new Error("This browser can't open .mxl — use uncompressed .musicxml");
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}
