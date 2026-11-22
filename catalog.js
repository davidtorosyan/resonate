// The songs the Sing and Play pages offer: the bundled samples and My songs (library.js), and a
// song's MusicXML as the pages read it — a converted (Audiveris) score with the OMR clean-ups.
import { listSongs, getSong, saveClean, isMusicXml } from "./library.js?v=96";
import { fixOmrScore } from "./omr/fixscore.js?v=96";

// Bundled sample scores (songs/README.md). sing.html also lists them in its Samples optgroup.
export const SAMPLES = { "amazing-grace": { title: "Amazing Grace", url: "songs/amazing-grace.musicxml" } };

// Songs converted from PDF (Audiveris) get the OMR clean-ups again on load, so songs saved by an
// older version benefit from newer fixes without converting again (the clean-ups leave an
// already-clean score unchanged). Only fixes that add reach them: the stored XML is the import's
// cleaned output, so a tie or change an older version's clean-up wrote stays — a narrowed rule
// (restoreTies' rule 3 since Nov 20: Yellow Submarine bar 13's inner G♯3/B3) reaches a stored song only
// through Reconvert. Anything but MusicXML text (a PDF-only song's null) is returned as is.
export function cleanXml(xml) {
  if (typeof xml !== "string" || !/<software>\s*Audiveris/.test(xml.slice(0, 4000))) return xml;
  try {
    const { xml: fixed, changes } = fixOmrScore(xml);
    if (changes.length) console.info("OMR clean-ups on load:", changes);
    return fixed;
  } catch (err) {
    console.warn("OMR clean-ups failed", err);
    return xml;
  }
}

// The page's version badge (v76…): the clean-up cache is keyed by it, so every page that shares
// the cache carries the same badge.
const appVersion = () => (typeof document !== "undefined" && document.getElementById("version")?.textContent.trim()) || "";

// A saved song's MusicXML, cleaned up: the cleaned copy saved with it when this version of
// the app made it (the clean-ups take a while on a big score on a phone), else cleaned now
// and saved for next time. The original stays as it was imported. null for a PDF-only song
// (not converted yet: docs/LIBRARY.md) — and for one holding text that isn't MusicXML (a v89
// device's "null": library.js isMusicXml), which is a PDF only too.
export function songXml(song) {
  if (!isMusicXml(song?.xml)) return null;
  const APP_VERSION = appVersion();
  if (!/<software>\s*Audiveris/.test(song.xml.slice(0, 4000))) return song.xml;
  if (APP_VERSION && song.clean?.ver === APP_VERSION) return song.clean.xml ?? song.xml;
  const xml = cleanXml(song.xml);
  if (APP_VERSION) saveClean(song.id, xml === song.xml ? null : xml, APP_VERSION, song.xml).catch(() => {});
  return xml;
}

// A song by id (a sample's key or a library id) → { id, title, xml, source, rev, pdfOnly, engine } —
// xml as the pages read it (null: a PDF only, not converted yet — pdfOnly), source "sample" or the
// library's ("pdf", "file", "link"… or null), rev the library's (a new one each time its MusicXML is
// replaced: its PDF read again) or null, engine the number of the engine that converted it (null:
// unknown — before v90, or not converted from a PDF) — or null when there's no such song. Throws when
// it couldn't be read (a sample that didn't download).
export async function loadSong(id) {
  if (!id) return null;
  if (SAMPLES[id]) {
    const res = await fetch(SAMPLES[id].url);
    if (!res.ok) throw new Error(`couldn't load (${res.status})`);
    return { id, title: SAMPLES[id].title, xml: await res.text(), source: "sample", rev: null, pdfOnly: false, engine: null };
  }
  const song = await getSong(id);
  if (!song) return null;
  const xml = songXml(song);
  return { id, title: song.title, xml, source: song.source ?? null, rev: song.rev ?? null, pdfOnly: xml == null, engine: song.engine?.n ?? null };
}

// What the index knows of a song, without reading it: { id, title, added, rev?, k, eng?, fail? }
// (library.js; k "pdf" = a PDF only, "conv" = converted from a PDF — eng its engine number, 0 before
// v90 —, "xml"), { id, title, k: "sample" } for a sample, null for no such song.
export async function songInfo(id) {
  if (!id) return null;
  if (SAMPLES[id]) return { id, title: SAMPLES[id].title, k: "sample" };
  return (await listSongs()).find((x) => x.id === id) || null;
}

// A library song's rev as the index has it (no XML read): null for a sample, a song never replaced
// or one that isn't there (undefined).
export async function songRev(id) {
  if (!id || SAMPLES[id]) return null;
  const e = (await listSongs()).find((x) => x.id === id);
  return e ? e.rev ?? null : undefined;
}

// What a song menu lists: { samples: [{ id, title }], mine: [{ id, title, added, rev?, k, eng?, fail? }]
// (newest first; k "pdf": a PDF only — not something Sing or Play's notes can open yet).
export async function songChoices() {
  return {
    samples: Object.entries(SAMPLES).map(([id, s]) => ({ id, title: s.title })),
    mine: await listSongs(),
  };
}
