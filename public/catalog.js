// The songs the Sing and Play pages offer: the bundled samples and My songs (library.js), and a
// song's MusicXML as the pages read it — a converted (Audiveris) score with the OMR clean-ups.
import { listSongs, getSong, saveClean } from "./library.js?v=77";
import { fixOmrScore } from "./omr/fixscore.js?v=77";

// Bundled sample scores (songs/README.md). sing.html also lists them in its Samples optgroup.
export const SAMPLES = { "amazing-grace": { title: "Amazing Grace", url: "songs/amazing-grace.musicxml" } };

// Songs converted from PDF (Audiveris) get the OMR clean-ups again on load, so songs saved by an
// older version benefit from newer fixes without converting again (the clean-ups leave an
// already-clean score unchanged).
export function cleanXml(xml) {
  if (!/<software>\s*Audiveris/.test(xml.slice(0, 4000))) return xml;
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
// and saved for next time. The original stays as it was imported.
export function songXml(song) {
  const APP_VERSION = appVersion();
  if (!/<software>\s*Audiveris/.test(song.xml.slice(0, 4000))) return song.xml;
  if (APP_VERSION && song.clean?.ver === APP_VERSION) return song.clean.xml ?? song.xml;
  const xml = cleanXml(song.xml);
  if (APP_VERSION) saveClean(song.id, xml === song.xml ? null : xml, APP_VERSION).catch(() => {});
  return xml;
}

// A song by id (a sample's key or a library id) → { id, title, xml, source } — xml as the pages
// read it, source "sample" or the library's ("pdf", "file", "link"… or null) — or null when
// there's no such song. Throws when it couldn't be read (a sample that didn't download).
export async function loadSong(id) {
  if (!id) return null;
  if (SAMPLES[id]) {
    const res = await fetch(SAMPLES[id].url);
    if (!res.ok) throw new Error(`couldn't load (${res.status})`);
    return { id, title: SAMPLES[id].title, xml: await res.text(), source: "sample" };
  }
  const song = await getSong(id);
  if (!song) return null;
  return { id, title: song.title, xml: songXml(song), source: song.source ?? null };
}

// What a song menu lists: { samples: [{ id, title }], mine: [{ id, title, added }] (newest first) }.
export async function songChoices() {
  return {
    samples: Object.entries(SAMPLES).map(([id, s]) => ({ id, title: s.title })),
    mine: await listSongs(),
  };
}
