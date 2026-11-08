// Saved songs (MusicXML text) in IndexedDB — roomier than localStorage, which
// caps out around 5 MB. Falls back to an in-memory list (songs then last only
// until reload) if IndexedDB is unavailable, e.g. some private-browsing modes.
//   song = { id, title, xml, added (ms), source?, clean?: { xml, ver } }
//
// The list of songs (id, title, added) is also kept as a small index in localStorage, so
// showing My songs never reads the songs themselves: each is often 1–2 MB of MusicXML, and
// reading them all to list their titles made the Sing page slower with every song saved.
// The index is rebuilt from the database whenever it doesn't match the database's keys
// (cleared site data, first run after this change, another tab's older copy of the page).
//
// Next to the songs (v71), in a second database "<songs db>-files" (version 1 — the songs'
// database keeps its version, so an older page in another tab never blocks an upgrade):
//   pdfs   { id, pdf: ArrayBuffer, name, bytes }   a song's original PDF (PDF → Song)
//   takes  { songId, takeId, at, data }             each song's last take (sing.js), indexed
//                                                   by [takeId, at] so listing reads no data
//   voices { songId, takeId, pcm, sampleRate, start, gain }  its recording — this device only
// Whose songs: the databases belong to the active space (space.js). Each database pair has a
// generation (localStorage resonate.dbgen.<name>), renewed whenever one is created: the sync
// (sync.js) starts over when it changes — a database that came back empty (evicted, cleared)
// must not read as "every song deleted". Every change announces itself with a "resonate:data"
// event so the sync, when it runs, can follow.

import { dbName } from "./space.js?v=72";

const STORE = "songs";
const INDEX_KEY = "resonate.songs.index"; // [{ id, title, added }]
const FILES = ["takes", "voices", "pdfs"];
const memory = { songs: new Map(), takes: new Map(), voices: new Map(), pdfs: new Map() };
const conns = new Map(); // database name → Promise<IDBDatabase | null>
// Whether this page keeps songs in IndexedDB ("idb") or only in memory ("memory": IndexedDB
// never worked here — some private modes). Decided once: after a database has opened, a lost
// connection (iOS: "Connection to Indexed Database server lost" after the app was in the
// background) is an error, never an empty in-memory library — the sync would take that for
// "every song deleted".
let mode = null;

const GEN = (name) => `resonate.dbgen.${name}`;
function newGen(name) {
  try { localStorage.setItem(GEN(name), `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`); } catch {}
}
// The songs' generation (the active space's databases).
export function dbGen() {
  const name = dbName();
  let g = null;
  try { g = localStorage.getItem(GEN(name)); } catch {}
  if (!g) { newGen(name); try { g = localStorage.getItem(GEN(name)); } catch {} }
  return g;
}

function openDb(name, gen, upgrade) {
  if (mode === "memory") return Promise.resolve(null);
  if (!conns.has(name)) {
    let p; // (declared first: an open that throws at once calls fail() before p is assigned)
    p = new Promise((resolve, reject) => {
      const fail = () => { // (not kept: tried again next time)
        if (conns.get(name) === p) conns.delete(name);
        if (mode === "idb") reject(new Error("storage unavailable — reload the page"));
        else { mode = "memory"; resolve(null); }
      };
      try {
        const req = indexedDB.open(name, 1);
        let created = false;
        req.onupgradeneeded = (e) => { created = e.oldVersion === 0; upgrade(req.result, req.transaction); };
        req.onsuccess = () => {
          const db = req.result;
          const forget = () => { if (conns.get(name) === p) conns.delete(name); };
          db.onversionchange = () => { db.close(); forget(); }; // (a space being deleted)
          db.onclose = forget;
          if (created) newGen(gen);
          mode = "idb";
          resolve(db);
        };
        req.onerror = fail;
      } catch { fail(); }
    });
    conns.set(name, p);
  }
  return conns.get(name);
}
const openSongs = () => openDb(dbName(), dbName(), (db) => {
  if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
});
const openFiles = () => openDb(`${dbName()}-files`, dbName(), (db) => {
  if (!db.objectStoreNames.contains("takes")) db.createObjectStore("takes", { keyPath: "songId" }).createIndex("meta", ["takeId", "at"]);
  if (!db.objectStoreNames.contains("voices")) db.createObjectStore("voices", { keyPath: "songId" });
  if (!db.objectStoreNames.contains("pdfs")) db.createObjectStore("pdfs", { keyPath: "id" });
});

function run(mode, fn, store = STORE) {
  return (FILES.includes(store) ? openFiles() : openSongs()).then(
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
  if (!(await openSongs())) return [...memory.songs.values()].map(entry).sort((a, b) => b.added - a.added);
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
  for (const st of FILES) await run("readwrite", (s, mem) => (s ? s.delete(id) : (mem.delete(id), {})), st);
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

// The last take of a song (sing.js): { songId, takeId, at, data, voice? } — the recording
// (voice) is read only when asked for, and only if it belongs to that take.
export async function getTake(songId, { voice = false } = {}) {
  const rec = await run("readonly", (s, mem) => (s ? s.get(songId) : { result: mem.get(songId) }), "takes");
  if (!rec || !voice) return rec;
  const v = await run("readonly", (s, mem) => (s ? s.get(songId) : { result: mem.get(songId) }), "voices");
  return v && v.takeId === rec.takeId ? { ...rec, voice: v } : rec;
}
export async function putTake({ voice, ...rec }, { quiet = false } = {}) {
  await run("readwrite", (s, mem) => (s ? s.put(rec) : (mem.set(rec.songId, rec), {})), "takes");
  if (voice?.pcm) {
    const v = { ...voice, songId: rec.songId, takeId: rec.takeId };
    await run("readwrite", (s, mem) => (s ? s.put(v) : (mem.set(rec.songId, v), {})), "voices");
  } else await run("readwrite", (s, mem) => (s ? s.delete(rec.songId) : (mem.delete(rec.songId), {})), "voices");
  if (!quiet) changed("take", rec.songId);
}
export async function removeTake(songId, { quiet = false } = {}) {
  for (const st of ["takes", "voices"]) await run("readwrite", (s, mem) => (s ? s.delete(songId) : (mem.delete(songId), {})), st);
  if (!quiet) changed("take", songId);
}
// Every stored take as { songId, takeId, at } — from the index's keys: no data is read.
export async function listTakes() {
  const db = await openFiles();
  if (!db) return [...memory.takes.values()].map(({ songId, takeId, at }) => ({ songId, takeId, at }));
  return new Promise((resolve, reject) => {
    const out = [];
    const tx = db.transaction("takes", "readonly");
    const req = tx.objectStore("takes").index("meta").openKeyCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      out.push({ songId: c.primaryKey, takeId: c.key[0], at: c.key[1] });
      c.continue();
    };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
  });
}

// Which songs have their original PDF here (the keys only: no PDF is read).
export async function listPdfIds() {
  return (await run("readonly", (s, mem) => (s ? s.getAllKeys() : { result: [...mem.keys()] }), "pdfs")) || [];
}
// How many take recordings are kept here (they never leave this device).
export async function countVoices() {
  return (await run("readonly", (s, mem) => (s ? s.count() : { result: mem.size }), "voices")) || 0;
}

// Songs (and their files) are really kept — not just in memory.
export async function persistent() {
  try { return !!(await openSongs()) && !!(await openFiles()); } catch { return false; }
}
