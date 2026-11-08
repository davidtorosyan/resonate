// Whose data this device shows: the signed-out user's ("anon") or an account's (v71).
//
// The pages keep reading and writing the same localStorage keys and song database as always;
// switching spaces swaps what's in them:
//   • sign up (a new account) — the signed-out state becomes the account's (adopt);
//   • sign in to an existing account — the signed-out state is shelved (its localStorage keys
//     copied to resonate.shelf, its database kept under its name) and the account starts empty
//     on this device, filled by the cloud sync (enter);
//   • sign out — the account's data leaves this device and the shelved state comes back (leave).
// The songs' database is per space (dbName): "resonate" for the signed-out state as always,
// "resonate-<uid>" for an account signed in on top of it; an adopted account keeps the database
// it was signed out with.

const SPACE = "resonate.space"; // { active: "anon" | uid, db: { [space]: database name } }
const SHELF = "resonate.shelf"; // the shelved signed-out localStorage, while an account is active
export const SYNC_META = "resonate.sync"; // the active account's sync state (sync.js)
const DEFAULT_DB = "resonate";

// The user's own data in localStorage (device preferences — guide, view, play modes,
// accidentals, sync on/off — stay with the device).
export const DATA_KEYS = [
  "resonate.songs.index",     // My songs' list (library.js)
  "resonate.sing.song",       // the song open last
  "resonate.sing.verse",
  "resonate.sing.keys",       // per song: key
  "resonate.sing.rates",      // per song: tempo %
  "resonate.sing.rate",       // (the old global tempo %)
  "resonate.sing.timing",     // per song: tapped timing / own tempo
  "resonate.sing.history",    // per song: takes' summaries
  "resonate.profiles",        // voice profiles
  "resonate.volCal",          // the Tuner's calibration before profiles
  "resonate.sing.customXml", "resonate.sing.customName", "resonate.sing.transpose", // (legacy)
];

function read() {
  try {
    const s = JSON.parse(localStorage.getItem(SPACE));
    if (s && typeof s.active === "string" && s.db && typeof s.db === "object") return s;
  } catch {}
  return null;
}
function write(s) {
  try { localStorage.setItem(SPACE, JSON.stringify(s)); } catch {}
}

export const activeSpace = () => read()?.active || "anon";
export function dbName() {
  const s = read();
  return (s && s.db[s.active]) || DEFAULT_DB;
}
export const isFresh = () => !read(); // no space was ever set up on this device

// A device's first visit since v71: signed out → its data is the signed-out user's (as it
// always was); already signed in (an account made before spaces existed) → the account
// adopts what's here. Afterwards the space only changes by signing up, in or out.
export function ensureSpace(uid) {
  if (read()) return;
  write(uid ? { active: uid, db: { [uid]: DEFAULT_DB } } : { active: "anon", db: {} });
}

// Sign up: what's on this device becomes the new account's.
export function adopt(uid) {
  const s = read() || { active: "anon", db: {} };
  if (s.active === uid) return false;
  if (s.active !== "anon") return false; // (another account: leave() first)
  s.db[uid] = s.db.anon || DEFAULT_DB;
  delete s.db.anon;
  s.active = uid;
  write(s);
  return true;
}

// Sign in to an existing account: shelve the signed-out state; the account starts empty here.
export async function enter(uid) {
  let s = read() || { active: "anon", db: {} };
  if (s.active === uid) return false;
  if (s.active !== "anon") { await leave(); s = read() || { active: "anon", db: {} }; }
  const shelf = {};
  for (const k of DATA_KEYS) {
    const v = localStorage.getItem(k);
    if (v !== null) shelf[k] = v;
    localStorage.removeItem(k);
  }
  try { localStorage.setItem(SHELF, JSON.stringify(shelf)); } catch {}
  localStorage.removeItem(SYNC_META);
  s.db.anon = s.db.anon || DEFAULT_DB;
  s.db[uid] = `resonate-${uid}`;
  s.active = uid;
  write(s);
  await deleteDb(s.db[uid]); // (anything left from an earlier visit)
  return true;
}

// Sign out: the account's data leaves this device; the shelved signed-out state comes back.
export async function leave() {
  const s = read();
  if (!s || s.active === "anon") return false;
  const db = s.db[s.active];
  for (const k of DATA_KEYS) localStorage.removeItem(k);
  localStorage.removeItem(SYNC_META);
  let shelf = {};
  try { shelf = JSON.parse(localStorage.getItem(SHELF)) || {}; } catch {}
  for (const [k, v] of Object.entries(shelf)) {
    try { localStorage.setItem(k, v); } catch {}
  }
  localStorage.removeItem(SHELF);
  delete s.db[s.active];
  s.active = "anon";
  write(s);
  if (db && db !== dbName()) await deleteDb(db);
  else if (db) await clearDb(db); // (an adopted account's database is the signed-out one's name)
  return true;
}

function deleteDb(name) {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch { resolve(); }
  });
}
// Empty a database in place (its name is about to be used again).
function clearDb(name) {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(name);
      req.onsuccess = () => {
        const db = req.result;
        const stores = [...db.objectStoreNames];
        if (!stores.length) { db.close(); return resolve(); }
        const tx = db.transaction(stores, "readwrite");
        for (const st of stores) tx.objectStore(st).clear();
        tx.oncomplete = tx.onerror = tx.onabort = () => { db.close(); resolve(); };
      };
      req.onerror = req.onblocked = () => resolve();
    } catch { resolve(); }
  });
}
