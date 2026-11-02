// MusicXML → a flat melody: [{ midi, beats, measure, verses: { "1": {text, syllabic} } }].
// Rhythm is kept (in quarter-note beats) for display only; matching ignores it.

const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Load a File (or {name, arrayBuffer}) that is .musicxml / .xml / .mxl.
export async function loadScoreFile(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"
  const xml = isZip ? await xmlFromMxl(bytes) : new TextDecoder().decode(bytes);
  return parseMusicXml(xml, file.name);
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

  let divisions = 1;
  let fifths = 0;
  let fifthsSet = false;
  const notes = [];
  const verseSet = new Set();
  let restPending = false;

  for (const measure of best.part.querySelectorAll(":scope > measure")) {
    const mNum = measure.getAttribute("number");
    for (const el of measure.children) {
      if (el.nodeName === "attributes") {
        const d = text(el.querySelector("divisions"));
        if (d) divisions = Number(d) || 1;
        const f = text(el.querySelector("key > fifths"));
        if (f && !fifthsSet) { fifths = Number(f); fifthsSet = true; }
        continue;
      }
      if (el.nodeName !== "note") continue;
      const voice = text(el.querySelector("voice")) || "1";
      if (voice !== best.voice) continue;
      if (el.querySelector("grace") || el.querySelector("cue")) continue;
      const beats = (Number(text(el.querySelector(":scope > duration"))) || 0) / divisions;

      if (el.querySelector("rest")) {
        restPending = true;
        continue;
      }
      const pitch = el.querySelector("pitch");
      if (!pitch) continue; // unpitched
      const midi =
        (Number(text(pitch.querySelector("octave"))) + 1) * 12 +
        STEP_PC[text(pitch.querySelector("step"))] +
        Math.round(Number(text(pitch.querySelector("alter")) || 0));

      // Chord tones: keep only the highest note at that onset.
      if (el.querySelector("chord")) {
        const last = notes[notes.length - 1];
        if (last && midi > last.midi) last.midi = midi;
        continue;
      }

      const tieTypes = [...el.querySelectorAll(":scope > tie")].map((t) => t.getAttribute("type"));
      const verses = {};
      for (const ly of el.querySelectorAll(":scope > lyric")) {
        const num = ly.getAttribute("number") || "1";
        const t = [...ly.querySelectorAll("text")].map((x) => x.textContent).join(" ");
        const clean = t.replace(/^\s*\d+\.\s*/, "").trim();
        if (!clean) continue;
        verses[num] = { text: clean, syllabic: text(ly.querySelector("syllabic")) || "single" };
        verseSet.add(num);
      }

      const last = notes[notes.length - 1];
      if (tieTypes.includes("stop") && last && last.midi === midi && last.tieOpen) {
        last.beats += beats;
        last.tieOpen = tieTypes.includes("start");
        continue;
      }
      notes.push({
        midi,
        beats,
        measure: mNum,
        verses,
        restBefore: restPending,
        tieOpen: tieTypes.includes("start"),
      });
      restPending = false;
    }
  }
  if (!notes.length) throw new Error("No pitched notes found");
  for (const n of notes) delete n.tieOpen;

  const verses = [...verseSet].sort((a, b) => (Number(a) || 0) - (Number(b) || 0) || a.localeCompare(b));
  return { title, partName, fifths, verses, notes };
}

// Resolve the notes for one verse: each note gets the syllable it carries, or
// is marked as a melisma continuation of the previous syllable.
export function notesForVerse(score, verse) {
  let lastSyl = null;
  return score.notes.map((n) => {
    const v = n.verses[verse];
    if (v) {
      lastSyl = v;
      return { midi: n.midi, beats: n.beats, measure: n.measure, restBefore: n.restBefore, text: v.text, syllabic: v.syllabic, melisma: false };
    }
    return { midi: n.midi, beats: n.beats, measure: n.measure, restBefore: n.restBefore, text: "", syllabic: null, melisma: !!lastSyl && !n.restBefore };
  });
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
