// Saved songs (MusicXML text) in IndexedDB — roomier than localStorage, which
// caps out around 5 MB. Falls back to an in-memory list (songs then last only
// until reload) if IndexedDB is unavailable, e.g. some private-browsing modes.
//   song = { id, title, xml, added (ms), source?, clean?: { xml, ver } }
// Next to each song (v71): its original PDF when it came from PDF → Song (store "pdfs",
// { id, pdf: ArrayBuffer, name, bytes }) and its last take (store "takes", { songId, … },
// see sing.js saveLastTake) — the Sing page's own recording stays on this device only.
//
// The list of songs (id, title, added) is also kept as a small index in localStorage, so
// showing My songs never reads the songs themselves: each is often 1–2 MB of MusicXML, and
// reading them all to list their titles made the Sing page slower with every song saved.
// The index is rebuilt from the database whenever it doesn't match the database's keys
// (cleared site data, first run after this change, another tab's older copy of the page).
//
// Whose songs: the database belongs to the active space (space.js) — the signed-out user's
// ("resonate", as always) or an account's. Every change announces itself with a
// "resonate:data" event so the cloud sync (sync.js), when it runs, can follow.

import { dbName } from "./space.js?v=71";

const STORE = "songs";
const INDEX_KEY = "resonate.songs.index"; // [{ id, title, added }]
let dbPromise = null, dbFor = null;
const memory = { songs: new Map(), takes: new Map(), pdfs: new Map() };
const KEYPATH = { songs: "id", takes: "songId", pdfs: "id" };

function open() {
  const name = dbName();
  if (!dbPromise || dbFor !== name) {
    const old = dbPromise;
    if (old) old.then((db) => db?.close());
    dbFor = name;
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(name, 2);
        req.onupgradeneeded = () => {
          for (const s of ["songs", "takes", "pdfs"]) {
            if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: KEYPATH[s] });
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          db.onversionchange = () => db.close(); // (a space being deleted, a newer page)
          resolve(db);
        };
        req.onerror = () => resolve(null);
        // An older page in another tab still has it open at the old version: give it a moment.
        req.onblocked = () => setTimeout(() => resolve(null), 3000);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function run(mode, fn, store = STORE) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        if (!db) {
          const r = fn(null, memory[store]);
          return resolve(r && "result" in r ? r.result : undefined);
        }
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req && "result" in req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("storage aborted"));
      }),
  );
}
const changed = (what, id) => { try { window.dispatchEvent(new CustomEvent("resonate:data", { detail: { what, id } })); } catch {} };

function readIndex() {
  try {
    const list = JSON.parse(localStorage.getItem(INDEX_KEY));
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}
function writeIndex(list) {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(list)); } catch {}
}
const entry = ({ id, title, added }) => ({ id, title, added });

// Newest first, without the (possibly large) XML.
export async function listSongs() {
  if (!(await open())) return [...memory.songs.values()].map(entry).sort((a, b) => b.added - a.added);
  let list = readIndex();
  // The keys alone are cheap to read: rebuild the index when it doesn't match them (missing,
  // or a song saved or removed by an older copy of the page in another tab).
  const keys = await run("readonly", (s) => s.getAllKeys());
  const ids = new Set(keys || []);
  if (!list || list.length !== ids.size || list.some((x) => !ids.has(x.id))) {
    const all = await run("readonly", (s) => s.getAll());
    list = (all || []).map(entry);
    writeIndex(list);
  }
  return [...list].sort((a, b) => b.added - a.added);
}

export async function getSong(id) {
  const song = await run("readonly", (s, mem) => (s ? s.get(id) : { result: mem.get(id) }));
  if (!song) {
    const list = readIndex();
    if (list && list.some((x) => x.id === id)) writeIndex(list.filter((x) => x.id !== id));
  }
  return song;
}

const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Saving the same title + content again replaces the old copy. opts: { source ("file",
// "link", "pdf"…), pdf (the original PDF: ArrayBuffer), pdfName }.
export async function addSong(title, xml, opts = {}) {
  const existing = (await listSongs()).find((x) => x.title === title);
  if (existing) {
    const old = await getSong(existing.id);
    if (old && old.xml === xml) {
      if (opts.pdf && !(await getPdf(existing.id))) await putPdf(existing.id, opts.pdf, opts.pdfName);
      return existing.id;
    }
  }
  const song = { id: newId(), title, xml, added: Date.now(), ...(opts.source ? { source: opts.source } : {}) };
  await putSong(song, { quiet: true });
  if (opts.pdf) await putPdf(song.id, opts.pdf, opts.pdfName, { quiet: true });
  changed("song", song.id);
  return song.id;
}

// Store a song as it is (its id, added time…) — a song arriving from another device.
export async function putSong(song, { quiet = false } = {}) {
  await run("readwrite", (s, mem) => (s ? s.put(song) : (mem.set(song.id, song), {})));
  const list = readIndex();
  if (list) writeIndex([...list.filter((x) => x.id !== song.id), entry(song)]);
  if (!quiet) changed("song", song.id);
}

// Keep a cleaned-up copy of a song's MusicXML (tagged with the app version that made it),
// next to the original, so loading it again doesn't redo the clean-ups.
export async function saveClean(id, xml, ver) {
  const song = await run("readonly", (s, mem) => (s ? s.get(id) : { result: mem.get(id) }));
  if (!song) return;
  song.clean = { xml, ver };
  await run("readwrite", (s, mem) => (s ? s.put(song) : (mem.set(id, song), {})));
}

export async function removeSong(id, { quiet = false } = {}) {
  await run("readwrite", (s, mem) => (s ? s.delete(id) : (mem.delete(id), {})));
  await run("readwrite", (s, mem) => (s ? s.delete(id) : (mem.delete(id), {})), "pdfs");
  await run("readwrite", (s, mem) => (s ? s.delete(id) : (mem.delete(id), {})), "takes");
  const list = readIndex();
  if (list) writeIndex(list.filter((x) => x.id !== id));
  if (!quiet) changed("song", id);
}

// The original PDF of a song made with PDF → Song.
export async function getPdf(id) {
  return run("readonly", (s, mem) => (s ? s.get(id) : { result: mem.get(id) }), "pdfs");
}
export async function putPdf(id, pdf, name = "", { quiet = false } = {}) {
  const rec = { id, pdf, name, bytes: pdf.byteLength ?? pdf.size ?? 0 };
  await run("readwrite", (s, mem) => (s ? s.put(rec) : (mem.set(id, rec), {})), "pdfs");
  if (!quiet) changed("pdf", id);
}

// The last take of a song (sing.js): { songId, takeId, at, data, voice? }.
export async function getTake(songId) {
  return run("readonly", (s, mem) => (s ? s.get(songId) : { result: mem.get(songId) }), "takes");
}
export async function putTake(rec, { quiet = false } = {}) {
  await run("readwrite", (s, mem) => (s ? s.put(rec) : (mem.set(rec.songId, rec), {})), "takes");
  if (!quiet) changed("take", rec.songId);
}
export async function removeTake(songId, { quiet = false } = {}) {
  await run("readwrite", (s, mem) => (s ? s.delete(songId) : (mem.delete(songId), {})), "takes");
  if (!quiet) changed("take", songId);
}
// Every stored take without its recording (the sync reads these).
export async function listTakes() {
  const all = await run("readonly", (s, mem) => (s ? s.getAll() : { result: [...mem.values()] }), "takes");
  return (all || []).map(({ voice, ...rest }) => rest);
}

export async function persistent() {
  return !!(await open());
}
