// Saved songs (MusicXML text) in IndexedDB — roomier than localStorage, which
// caps out around 5 MB. Falls back to an in-memory list (songs then last only
// until reload) if IndexedDB is unavailable, e.g. some private-browsing modes.
//   song = { id, title, xml, added (ms), clean?: { xml, ver } }
//
// The list of songs (id, title, added) is also kept as a small index in localStorage, so
// showing My songs never reads the songs themselves: each is often 1–2 MB of MusicXML, and
// reading them all to list their titles made the Sing page slower with every song saved.
// The index is rebuilt from the database whenever it doesn't match the database's keys
// (cleared site data, first run after this change, another tab's older copy of the page).

const DB_NAME = "resonate";
const STORE = "songs";
const INDEX_KEY = "resonate.songs.index"; // [{ id, title, added }]
let dbPromise = null;
const memory = new Map();

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function run(mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        if (!db) return resolve(fn(null));
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req && "result" in req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("storage aborted"));
      }),
  );
}

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
  if (!(await open())) return [...memory.values()].map(entry).sort((a, b) => b.added - a.added);
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
  const song = await run("readonly", (s) => (s ? s.get(id) : { result: memory.get(id) }));
  if (!song) {
    const list = readIndex();
    if (list && list.some((x) => x.id === id)) writeIndex(list.filter((x) => x.id !== id));
  }
  return song;
}

// Saving the same title + content again replaces the old copy.
export async function addSong(title, xml) {
  const existing = (await listSongs()).find((x) => x.title === title);
  if (existing) {
    const old = await getSong(existing.id);
    if (old && old.xml === xml) return existing.id;
  }
  const song = { id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, title, xml, added: Date.now() };
  await run("readwrite", (s) => (s ? s.put(song) : (memory.set(song.id, song), {})));
  const list = readIndex();
  if (list) writeIndex([...list.filter((x) => x.id !== song.id), entry(song)]);
  return song.id;
}

// Keep a cleaned-up copy of a song's MusicXML (tagged with the app version that made it),
// next to the original, so loading it again doesn't redo the clean-ups.
export async function saveClean(id, xml, ver) {
  const song = await run("readonly", (s) => (s ? s.get(id) : { result: memory.get(id) }));
  if (!song) return;
  song.clean = { xml, ver };
  await run("readwrite", (s) => (s ? s.put(song) : (memory.set(id, song), {})));
}

export async function removeSong(id) {
  await run("readwrite", (s) => (s ? s.delete(id) : (memory.delete(id), {})));
  const list = readIndex();
  if (list) writeIndex(list.filter((x) => x.id !== id));
}

export async function persistent() {
  return !!(await open());
}
