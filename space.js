// Whose data this device shows: the signed-out user's ("anon") or an account's (v71).
//
// The pages keep reading and writing the same localStorage keys and song databases as always;
// switching spaces swaps what's in them:
//   • sign up (a new account) — the signed-out state becomes the account's (adopt);
//   • sign in to an existing account — the signed-out state is shelved (its localStorage keys
//     copied to resonate.shelf, its databases kept under their name) and the account's data
//     comes back: what was parked here for it, else nothing — filled by the cloud sync (enter);
//   • Sign out (the button) — the account's data leaves this device and the shelved state comes
//     back (leave; another account found active instead is parked, not deleted);
//   • the session ended some other way (expired, signed out in another tab) — the account's data
//     is parked: kept on the device, out of sight, and the shelved state comes back (park).
//     Nothing is deleted without the Sign out button and its warning.
// The songs' databases are per space (dbName, plus "<name>-files"): "resonate" for the
// signed-out state as always, "resonate-<uid>" for an account signed in on top of it; an
// adopted account keeps the databases it was signed out with, and the signed-out state gets
// new ones. Moves are all-or-nothing: a copy is written before anything is removed.

const SPACE = "resonate.space"; // { active: "anon" | uid, db: { [space]: database name } }
const SHELF = "resonate.shelf"; // the shelved signed-out localStorage, while an account is active
const PARKED = (uid) => `resonate.parked.${uid}`; // a parked account's localStorage
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
  "resonate.sing.practice",   // per song: guided practice marks (practice.js; device only until v1.1)
  "resonate.sing.session",    // guided practice: the session under way
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
  try { localStorage.setItem(SPACE, JSON.stringify(s)); return true; } catch { return false; }
}
const fresh = () => ({ active: "anon", db: {} });
const randomName = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const owned = (s, name) => Object.entries(s.db).some(([k, v]) => k !== "anon" && v === name);
// The signed-out space's databases: never ones an account owns (an adopted account keeps the
// name the signed-out data had). Sets s.db.anon when it has to pick a new name.
function anonDb(s) {
  let n = s.db.anon || DEFAULT_DB;
  if (owned(s, n)) n = s.db.anon = randomName(DEFAULT_DB);
  return n;
}

export const activeSpace = () => read()?.active || "anon";
export function dbName() {
  const s = read();
  if (!s) return DEFAULT_DB;
  if (s.active !== "anon") return s.db[s.active] || `${DEFAULT_DB}-${s.active}`;
  const before = s.db.anon, n = anonDb(s);
  if (s.db.anon !== before) write(s);
  return n;
}
export const isFresh = () => !read(); // no space was ever set up on this device

// A device's first visit since v71: signed out → its data is the signed-out user's (as it
// always was); already signed in (an account made before spaces existed) → the account
// adopts what's here. Afterwards the space only changes by signing up, in or out.
export function ensureSpace(uid) {
  if (read()) return;
  write(uid ? { active: uid, db: { [uid]: DEFAULT_DB, anon: randomName(DEFAULT_DB) } } : fresh());
}

// The active localStorage DATA_KEYS (+ the sync state), as an object (nothing removed).
const keyList = (withSync) => [...DATA_KEYS, ...(withSync ? [SYNC_META] : [])];
function readKeys(withSync) {
  const kept = {};
  for (const k of keyList(withSync)) {
    const v = localStorage.getItem(k);
    if (v !== null) kept[k] = v;
  }
  return kept;
}
function dropKeys(withSync) {
  for (const k of keyList(withSync)) { try { localStorage.removeItem(k); } catch {} }
}
function putKeys(kept) {
  let ok = true;
  for (const [k, v] of Object.entries(kept || {})) {
    try { localStorage.setItem(k, v); } catch { ok = false; }
  }
  return ok;
}
function readJson(k) {
  try { return JSON.parse(localStorage.getItem(k)); } catch { return null; }
}
// A copy kept under `key`, written before anything is removed: false when it couldn't be
// (storage full) — then nothing moves.
function stash(key, withSync) {
  try { localStorage.setItem(key, JSON.stringify(readKeys(withSync))); } catch { return false; }
  dropKeys(withSync);
  return true;
}

// The signed-out state back from the shelf (the account's keys already moved out). The shelf
// stays if it couldn't all be written back.
function unshelve(s) {
  if (putKeys(readJson(SHELF))) localStorage.removeItem(SHELF);
  s.active = "anon";
  anonDb(s);
}

// The session ended without Sign out: keep the account's data here, out of sight.
// (Synchronous: it runs before a page reads anything.) false: nothing was moved.
export function park() {
  const s = read();
  if (!s || s.active === "anon") return false;
  if (!stash(PARKED(s.active), true)) return false;
  unshelve(s);
  write(s);
  return true;
}

// Sign up: what's on this device becomes the new account's (another account's is parked first).
export function adopt(uid) {
  let s = read() || fresh();
  if (s.active === uid) return false;
  if (s.active !== "anon") { if (!park()) return false; s = read(); }
  s.db[uid] = anonDb(s);
  s.db.anon = randomName(DEFAULT_DB); // (the signed-out space starts anew, in databases of its own)
  s.active = uid;
  write(s);
  return true;
}

// Sign in to an existing account: shelve the signed-out state; the account's data comes back
// (parked here earlier) or starts empty (the sync fills it).
export async function enter(uid) {
  let s = read() || fresh();
  if (s.active === uid) return false;
  if (s.active !== "anon") { if (!park()) return false; s = read(); }
  // (What an earlier unshelve couldn't write back stays in the shelf: the keys here win.)
  try { localStorage.setItem(SHELF, JSON.stringify({ ...(readJson(SHELF) || {}), ...readKeys(false) })); } catch { return false; }
  dropKeys(false);
  anonDb(s);
  localStorage.removeItem(SYNC_META);
  const parked = readJson(PARKED(uid));
  if (parked) {
    if (putKeys(parked)) localStorage.removeItem(PARKED(uid));
    // Partly written back (storage full): without its sync state the sync starts over, the cloud
    // first — nothing missing here is taken for deleted.
    else localStorage.removeItem(SYNC_META);
  }
  const isNew = !s.db[uid];
  if (isNew) s.db[uid] = `resonate-${uid}`;
  s.active = uid;
  write(s);
  if (isNew) await deleteDbs(s.db[uid]); // (anything left from an earlier visit)
  return true;
}

// Sign out: the account's data leaves this device; the shelved signed-out state comes back.
// Only the account being signed out (uid) is removed: any other active account is parked.
export async function leave(uid) {
  const s = read();
  if (!s || s.active === "anon") return false;
  if (uid && s.active !== uid) return park();
  const db = s.db[s.active];
  dropKeys(true);
  delete s.db[s.active];
  unshelve(s);
  // (Never reopen the databases being deleted: an older tab can hold the delete up.)
  if (anonDb(s) === db) s.db.anon = randomName(DEFAULT_DB);
  write(s);
  if (db) await deleteDbs(db);
  return true;
}

const names = (db) => [db, `${db}-files`];
async function deleteDbs(db) {
  for (const name of names(db)) {
    await new Promise((resolve) => {
      try {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      } catch { resolve(); }
    });
  }
  try { localStorage.removeItem(`resonate.dbgen.${db}`); } catch {}
}
