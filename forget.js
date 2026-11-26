// Deleting a song (the shell's Songs list, Sing's ✕), everything in one place (docs/LIBRARY.md §2):
// the song and its files (library.js removeSong: its MusicXML, PDF, last take, recordings), what
// this device keeps for it by id (key, tempo, tapped timing, take history, guided practice, Play's
// record; the practice session and the open song when they're this one), its place in the
// conversion queue and its stored conversions (an unfinished one would bring it back as a new song).
// The sync then sends the tombstones (its pass follows the "resonate:data" events). The cloud rows
// derived from the song for assistants go too, best effort, signed in only: its piano fingering
// (score_fingering, E7 — assist.js dropFingering). (song_scores and score_focus rows stay; the MCP server
// hides a song whose sync tombstone is in.)
// It doesn't stop a conversion running in this page — the shell's tray does that first (tray.forget).
// Only for pages that load nav.js already (spaceChanged: its side effects belong to every such page).
import { removeSong } from "./library.js?v=127";
import { SAMPLES } from "./catalog.js?v=127";
import { spaceChanged } from "./nav.js?v=127";
import { dropFromQueue } from "./omr/queue.js?v=127";
import { deleteJobsFor } from "./omr/jobs.js?v=127";
import { dropFingering } from "./assist.js?v=127";

// Per song: { songId: … } maps in localStorage (DATA_KEYS).
const PER_SONG = ["resonate.sing.keys", "resonate.sing.rates", "resonate.sing.timing", "resonate.sing.history", "resonate.sing.practice", "resonate.sing.eardata", "resonate.play"];

// true once the song is gone; false for a sample (or no id). Throws when the songs' storage failed
// (nothing else is done then).
export async function forgetSong(id) {
  if (!id || SAMPLES[id]) return false;
  await removeSong(id);
  // (Not after another tab switched whose data this device shows: these keys are that space's now.)
  if (!spaceChanged()) {
    for (const k of PER_SONG) {
      try {
        const all = JSON.parse(localStorage.getItem(k) || "null");
        if (all && typeof all === "object" && id in all) {
          delete all[id];
          localStorage.setItem(k, JSON.stringify(all));
        }
      } catch {}
    }
    try { if (JSON.parse(localStorage.getItem("resonate.sing.session") || "null")?.songId === id) localStorage.removeItem("resonate.sing.session"); } catch {}
    try { if (localStorage.getItem("resonate.sing.song") === id) localStorage.removeItem("resonate.sing.song"); } catch {}
    dropFromQueue(id);
  }
  try { await deleteJobsFor(id); } catch (err) { console.warn("forget: jobs", err); }
  if (!spaceChanged()) dropFingering(id); // (not awaited: never holds the delete up; it never throws)
  const say = (type, detail) => { try { window.dispatchEvent(new CustomEvent(type, { detail })); } catch {} };
  say("resonate:data", { what: "settings" });
  say("resonate:remote", { songs: true, gone: [id] });
  return true;
}
