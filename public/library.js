// Saved songs (MusicXML text) in IndexedDB — roomier than localStorage, which
// caps out around 5 MB. Falls back to an in-memory list (songs then last only
// until reload) if IndexedDB is unavailable, e.g. some private-browsing modes.
//   song = { id, title, xml: string | null, added (ms), source?, clean?: { xml, ver }, pages?: [pdf page], rev?,
//            engine?, titleAuto?, conv? }   (docs/LIBRARY.md §1)
//   xml:   null = a PDF only (v90: added, not converted yet) — its PDF is in `pdfs` under the same id;
//          so is any text that isn't MusicXML (isMusicXml: a v89 device's "null").
//   pages: for a song made with PDF → Song, the PDF page (1-based) of each music sheet the engine read,
//          in order (sheet 1 = pages[0]) — Play's 📄 lines the PDF up with the music; this device only.
//   rev:   set when the song's MusicXML was replaced under the same id (a PDF processed again,
//          replaceSong): the index carries it, so the sync sees the new content without reading it.
//   engine: { n, id, at } — the engine that converted it (omr/engine.js ENGINE_N, omr.js ENGINE, ms);
//          none on songs converted before v90 and on MusicXML / link / sample songs.
//   titleAuto: true — the title came from the PDF's file name (addPdfSong): the first conversion may name it.
//   conv:  { kind, message, at } — the last conversion failed in a way that would fail again; device only.
//   fing:  { v, alg, hand, bpm, sig, at, ms, n, fr } — its piano fingering (fingering.js, E7): derived, device
//          only (never synced), dropped with its MusicXML (replaceSong); written only by saveFing.
//
// The list of songs is also kept as a small index in localStorage, so showing My songs never
// reads the songs themselves: each is often 1–2 MB of MusicXML, and reading them all to list
// their titles made the Sing page slower with every song saved. An entry:
//   { id, title, added, rev?, k: "pdf" (a PDF only) | "conv" (converted from a PDF) | "xml", eng?, fail? }
//   eng: for "conv", the engine number (0: before v90); fail: 1 for a PDF only whose conversion failed.
// The index is rebuilt from the database whenever it doesn't match the database's keys
// (cleared site data, first run after this change, another tab's older copy of the page), or
// an entry lacks `k` (an index from v89, or one a v89 tab wrote).
//
// Next to the songs (v71), in a second database "<songs db>-files" (version 1 — the songs'
// database keeps its version, so an older page in another tab never blocks an upgrade):
//   pdfs   { id, pdf: ArrayBuffer, name, bytes }   a song's original PDF (PDF → Song)
//   takes  { songId, takeId, at, data }             each song's last take (sing.js), indexed
//                                                   by [takeId, at] so listing reads no data
//   voices { songId, takeId, pcm, sampleRate, start, gain }  its recording — this device only;
//          also guided practice's recordings under "<songId>#then#…" / "<songId>#now" (clips)
// Whose songs: the databases belong to the active space (space.js). Each database pair has a
// generation (localStorage resonate.dbgen.<name>), renewed whenever one is created: the sync
// (sync.js) starts over when it changes — a database that came back empty (evicted, cleared)
// must not read as "every song deleted". Every change announces itself with a "resonate:data"
// event so the sync, when it runs, can follow.

import { dbName } from "./space.js?v=98";

const STORE = "songs";
const INDEX_KEY = "resonate.songs.index"; // [{ id, title, added, rev?, k, eng?, fail? }]
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
// MusicXML text: its root element near the top. Anything else a song may hold — null (a PDF only),
// or "null", which a v89 device stored for a PDF-only song it pulled from a v90 one — isn't music:
// the song is a PDF only (catalog.js songXml, sync.js read it so too).
export const isMusicXml = (text) => typeof text === "string" && /<score-(partwise|timewise)[\s>]/.test(text.slice(0, 65536));
// What a song is, for lists (no XML kept): a PDF only, converted from a PDF (and by which engine), or
// MusicXML (a file, a link, another device's song that came without its source).
const kindOf = (song) => (!isMusicXml(song.xml) ? "pdf" : song.source === "pdf" ? "conv" : "xml");
function entry(song) {
  const { id, title, added, rev } = song;
  const k = kindOf(song);
  return {
    id, title, added, ...(rev ? { rev } : {}), k,
    ...(k === "conv" ? { eng: song.engine?.n || 0 } : {}),
    ...(k === "pdf" && song.conv ? { fail: 1 } : {}),
  };
}

// Every song's index entry, read with a cursor: one record at a time (each can be 1–2 MB of
// MusicXML; getAll held them all at once).
async function readEntries() {
  const db = await openSongs();
  if (!db) return [...memory.songs.values()].map(entry);
  return new Promise((resolve, reject) => {
    const out = [];
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      out.push(entry(c.value));
      c.continue();
    };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("storage aborted"));
  });
}

// Newest first, without the (possibly large) XML.
export async function listSongs() {
  if (!(await openSongs())) return [...memory.songs.values()].map(entry).sort((a, b) => b.added - a.added);
  let list = readIndex();
  // The keys alone are cheap to read: rebuild the index when it doesn't match them (missing,
  // or a song saved or removed by an older copy of the page in another tab) or an entry has no
  // kind (written by v89, which knew no PDF-only songs).
  const keys = await run("readonly", (s) => s.getAllKeys());
  const ids = new Set(keys || []);
  if (!list || list.length !== ids.size || list.some((x) => !x || !ids.has(x.id) || !x.k)) {
    list = await readEntries();
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
// "link", "pdf"…), pdf (the original PDF: ArrayBuffer), pdfName, pages (PDF → Song: see above),
// engine (PDF → Song: { n, id, at }) }.
export async function addSong(title, xml, opts = {}) {
  // (Only MusicXML is the same content: two PDF-only songs aren't — null === null.)
  const existing = typeof xml === "string" ? (await listSongs()).find((x) => x.title === title) : null;
  if (existing) {
    const old = await getSong(existing.id);
    if (old && old.xml === xml) {
      if (opts.pdf && !(await getPdf(existing.id))) await putPdf(existing.id, opts.pdf, opts.pdfName);
      const add = {
        ...(Array.isArray(opts.pages) && !Array.isArray(old.pages) ? { pages: opts.pages } : {}),
        ...(opts.engine && !old.engine ? { engine: opts.engine } : {}),
      };
      if (Object.keys(add).length) await putSong({ ...old, ...add }, { quiet: true });
      return existing.id;
    }
  }
  const song = {
    id: newId(), title, xml, added: Date.now(), ...(opts.source ? { source: opts.source } : {}),
    ...(Array.isArray(opts.pages) ? { pages: opts.pages } : {}), ...(opts.engine ? { engine: opts.engine } : {}),
  };
  await putSong(song, { quiet: true });
  if (opts.pdf) await putPdf(song.id, opts.pdf, opts.pdfName, { quiet: true });
  changed("song", song.id);
  return song.id;
}

// A PDF kept as a song at once, not converted (v90): converting it later (the importer's
// reprocess) gives it its MusicXML under the same id. The PDF is written first — a PDF-only song
// is never there without the only thing it has; a record that couldn't be written takes its PDF
// back with it. No dedupe: the same PDF added twice is two songs. title: the caller's (the file
// name's, omr/importer.js titleFromFileName — the first conversion may name it better: titleAuto).
export async function addPdfSong(pdf, { name = "", title = "" } = {}) {
  if (typeof Blob !== "undefined" && pdf instanceof Blob) pdf = await pdf.arrayBuffer();
  const id = newId();
  await putPdf(id, pdf, name, { quiet: true });
  const song = { id, title: title || name.replace(/\.pdf$/i, "").trim() || "Song", xml: null, added: Date.now(), source: "pdf", titleAuto: true };
  try {
    await putSong(song, { quiet: true });
  } catch (err) {
    try { await run("readwrite", (s, mem) => (s ? s.delete(id) : (mem.delete(id), {})), "pdfs"); } catch {}
    throw err;
  }
  changed("song", id);
  return id;
}

// Store a song as it is (its id, added time…) — a song arriving from another device.
export async function putSong(song, { quiet = false } = {}) {
  await run("readwrite", (s, mem) => (s ? s.put(song) : (mem.set(song.id, song), {})));
  const list = readIndex();
  if (list) writeIndex([...list.filter((x) => x.id !== song.id), entry(song)]);
  if (!quiet) changed("song", song.id);
}

// New MusicXML for a song under the same id (its PDF processed again — or converted the first
// time; or another device's, through the sync): its title, added time, source and PDF stay, so do
// its settings (keyed by the id); the clean-up cache goes (the clean-ups run again on the new
// notes), and so do what described the old content — its page map, its engine, a title still
// from the file name, a failed conversion — and a new rev marks the change.
// opts: { pages (the new sheet → PDF page map; none: the old one goes), title, engine ({ n, id, at }:
// the engine that made it; none: unknown), quiet }.
// Resolves with the song as stored, or null when there is no such song (deleted meanwhile).
export async function replaceSong(id, xml, { pages = null, title = null, engine = null, quiet = false } = {}) {
  const old = await getSong(id);
  if (!old) return null;
  const { clean, fing, pages: _pages, engine: _engine, titleAuto, conv, ...keep } = old;
  const song = {
    ...keep, xml, rev: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, ...(title ? { title } : {}),
    ...(Array.isArray(pages) ? { pages } : {}), ...(engine ? { engine } : {}),
  };
  await putSong(song, { quiet: true });
  if (!quiet) changed("song", id);
  return song;
}

// A conversion of this song failed in a way that would fail again (no music in the PDF, a file
// pdf.js refuses…): kept with the song so "Convert all" passes it by (index: fail). Device only;
// the next replaceSong clears it.
export async function markConvFailed(id, { kind = "", message = "" } = {}) {
  const song = await run("readonly", (s, mem) => (s ? s.get(id) : { result: mem.get(id) }));
  if (!song) return null;
  const marked = { ...song, conv: { kind, message, at: Date.now() } };
  await putSong(marked, { quiet: true });
  changed("song", id);
  return marked;
}

// The PDF page of each music sheet of a song made with PDF → Song ([pdf page, …], 1-based, sheet
// order), or null (another kind of song, one converted before v88, one from another device).
export async function getPages(id) {
  const song = await getSong(id);
  return Array.isArray(song?.pages) ? song.pages : null;
}

// A song record changed in one readwrite transaction: read, fn(song) → the record to write (or null:
// nothing), written — so two such writes (saveClean, saveFing: both run on the first open after a
// release) never drop each other's field, as a read in one transaction and a write in another did.
// No "resonate:data" event: what they keep is derived (no sync pass). → written
function modify(id, fn) {
  return openSongs().then((db) => new Promise((resolve, reject) => {
    if (!db) {
      const song = memory.songs.get(id), next = song ? fn(song) : null;
      if (next) memory.songs.set(id, next);
      return resolve(!!next);
    }
    let wrote = false;
    const tx = db.transaction(STORE, "readwrite"), st = tx.objectStore(STORE);
    const req = st.get(id);
    req.onsuccess = () => {
      const song = req.result, next = song ? fn(song) : null;
      if (next) { st.put(next); wrote = true; }
    };
    tx.oncomplete = () => resolve(wrote);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("storage aborted"));
  }));
}

// Keep a cleaned-up copy of a song's MusicXML (tagged with the app version that made it),
// next to the original, so loading it again doesn't redo the clean-ups.
export async function saveClean(id, xml, ver, from = null) {
  // (its MusicXML replaced meanwhile — its PDF read again: not kept)
  await modify(id, (song) => (from != null && song.xml !== from ? null : { ...song, clean: { xml, ver } }));
}

// Keep a song's piano fingering (fingering.js) with it — only into the MusicXML it was worked out
// from: rev, the song's as it was read (null: never replaced) — a song replaced meanwhile (its PDF
// read again, another device's version) isn't given the old notes' fingering. → kept
export async function saveFing(id, fing, rev = null) {
  return modify(id, (song) => ((song.rev ?? null) !== (rev ?? null) || !isMusicXml(song.xml) ? null : { ...song, fing }));
}

export async function removeSong(id, { quiet = false } = {}) {
  await run("readwrite", (s, mem) => (s ? s.delete(id) : (mem.delete(id), {})));
  for (const st of FILES) await run("readwrite", (s, mem) => (s ? s.delete(id) : (mem.delete(id), {})), st);
  await removeClips(id);
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
// How many take recordings are kept here (they never leave this device; practice clips aside).
export async function countVoices() {
  const keys = (await run("readonly", (s, mem) => (s ? s.getAllKeys() : { result: [...mem.keys()] }), "voices")) || [];
  return keys.filter((k) => !String(k).includes("#")).length;
}

// Guided practice's recordings (sing.js): "<songId>#then#<at>" — the part of a run that first
// reached some phrases — and "<songId>#now" — the latest run. Same shape as a take's voice plus
// what it covers; in the voices store under their own keys (no schema change), this device only.
const clipRange = (id) => (typeof IDBKeyRange !== "undefined" ? IDBKeyRange.bound(`${id}#`, `${id}#\uffff`) : null);
export async function putClip(key, rec) {
  const v = { ...rec, songId: key };
  await run("readwrite", (s, mem) => (s ? s.put(v) : (mem.set(key, v), {})), "voices");
}
export async function getClip(key) {
  return run("readonly", (s, mem) => (s ? s.get(key) : { result: mem.get(key) }), "voices");
}
// Every clip of a song (newest "then" last), or just their keys.
export async function listClips(id, { keysOnly = false } = {}) {
  const r = clipRange(id);
  const out = await run("readonly", (s, mem) => (s ? (keysOnly ? s.getAllKeys(r) : s.getAll(r)) : { result: [...mem.entries()].filter(([k]) => String(k).startsWith(`${id}#`)).map(([k, v]) => (keysOnly ? k : v)) }), "voices");
  return out || [];
}
export async function removeClips(id, { except = null } = {}) {
  const keys = await listClips(id, { keysOnly: true });
  for (const k of keys) if (k !== except) await run("readwrite", (s, mem) => (s ? s.delete(k) : (mem.delete(k), {})), "voices");
}
export async function countClips() {
  const keys = (await run("readonly", (s, mem) => (s ? s.getAllKeys() : { result: [...mem.keys()] }), "voices")) || [];
  return keys.filter((k) => String(k).includes("#")).length;
}

// Songs (and their files) are really kept — not just in memory.
export async function persistent() {
  try { return !!(await openSongs()) && !!(await openFiles()); } catch { return false; }
}
