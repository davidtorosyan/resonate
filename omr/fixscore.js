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
  return { xml: changes.length ? new XMLSerializer().serializeToString(doc) : xml, changes };
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
