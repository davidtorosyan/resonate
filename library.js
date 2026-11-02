// Saved songs (MusicXML text) in IndexedDB — roomier than localStorage, which
// caps out around 5 MB. Falls back to an in-memory list (songs then last only
// until reload) if IndexedDB is unavailable, e.g. some private-browsing modes.
//   song = { id, title, xml, added (ms) }

const DB_NAME = "resonate";
const STORE = "songs";
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

// Newest first, without the (possibly large) XML.
export async function listSongs() {
  const all = await run("readonly", (s) => (s ? s.getAll() : { result: [...memory.values()] }));
  return (all || []).map(({ id, title, added }) => ({ id, title, added })).sort((a, b) => b.added - a.added);
}

export function getSong(id) {
  return run("readonly", (s) => (s ? s.get(id) : { result: memory.get(id) }));
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
  return song.id;
}

export function removeSong(id) {
  return run("readwrite", (s) => (s ? s.delete(id) : (memory.delete(id), {})));
}

export async function persistent() {
  return !!(await open());
}
