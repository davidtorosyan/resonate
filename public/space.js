// Whose data this device shows: the signed-out user's ("anon") or an account's (v71).
//
// The pages keep reading and writing the same localStorage keys and song databases as always;
// switching spaces swaps what's in them:
//   • sign up (a new account) — the signed-out state becomes the account's (adopt);
//   • sign in to an existing account — the signed-out state is shelved (its localStorage keys
//     copied to resonate.shelf, its databases kept under their name) and the account's data
//     comes back: what was parked here for it, else nothing — filled by the cloud sync (enter);
//   • Sign out (the button) — the account's data leaves this device and the shelved state comes
//     back (leave);
//   • the session ended some other way (expired, signed out in another tab) — the account's data
//     is parked: kept on the device, out of sight, and the shelved state comes back (park).
//     Nothing is deleted without the Sign out button and its warning.
// The songs' databases are per space (dbName, plus "<name>-files"): "resonate" for the
// signed-out state as always, "resonate-<uid>" for an account signed in on top of it; an
// adopted account keeps the databases it was signed out with.

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
const fresh = () => ({ active: "anon", db: {} });
const randomName = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

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
  write(uid ? { active: uid, db: { [uid]: DEFAULT_DB } } : fresh());
}

// Move the active localStorage DATA_KEYS (+ the sync state) out, into an object.
function takeKeys(withSync) {
  const kept = {};
  for (const k of [...DATA_KEYS, ...(withSync ? [SYNC_META] : [])]) {
    const v = localStorage.getItem(k);
    if (v !== null) kept[k] = v;
    localStorage.removeItem(k);
  }
  return kept;
}
function putKeys(kept) {
  for (const [k, v] of Object.entries(kept || {})) {
    try { localStorage.setItem(k, v); } catch {}
  }
}
function readJson(k) {
  try { return JSON.parse(localStorage.getItem(k)); } catch { return null; }
}

// The signed-out state back from the shelf (the account's keys already moved out).
function unshelve(s) {
  putKeys(readJson(SHELF));
  localStorage.removeItem(SHELF);
  s.active = "anon";
}

// The session ended without Sign out: keep the account's data here, out of sight.
// (Synchronous: it runs before a page reads anything.)
export function park() {
  const s = read();
  if (!s || s.active === "anon") return false;
  const uid = s.active;
  try { localStorage.setItem(PARKED(uid), JSON.stringify(takeKeys(true))); } catch {}
  // An adopted account uses the signed-out databases' name: the signed-out state starts anew.
  if ((s.db.anon || DEFAULT_DB) === s.db[uid]) s.db.anon = randomName(DEFAULT_DB);
  unshelve(s);
  write(s);
  return true;
}

// Sign up: what's on this device becomes the new account's (another account's is parked first).
export function adopt(uid) {
  let s = read() || fresh();
  if (s.active === uid) return false;
  if (s.active !== "anon") { park(); s = read(); }
  s.db[uid] = s.db.anon || DEFAULT_DB;
  delete s.db.anon;
  s.active = uid;
  write(s);
  return true;
}

// Sign in to an existing account: shelve the signed-out state; the account's data comes back
// (parked here earlier) or starts empty (the sync fills it).
export async function enter(uid) {
  let s = read() || fresh();
  if (s.active === uid) return false;
  if (s.active !== "anon") { park(); s = read(); }
  try { localStorage.setItem(SHELF, JSON.stringify(takeKeys(false))); } catch {}
  s.db.anon = s.db.anon || DEFAULT_DB;
  const parked = readJson(PARKED(uid));
  if (parked && s.db[uid]) {
    localStorage.removeItem(SYNC_META);
    putKeys(parked);
    localStorage.removeItem(PARKED(uid));
    s.active = uid;
    write(s);
    return true;
  }
  localStorage.removeItem(SYNC_META);
  localStorage.removeItem(PARKED(uid));
  s.db[uid] = `resonate-${uid}`;
  s.active = uid;
  write(s);
  await deleteDbs(s.db[uid]); // (anything left from an earlier visit)
  return true;
}

// Sign out: the account's data leaves this device; the shelved signed-out state comes back.
export async function leave() {
  const s = read();
  if (!s || s.active === "anon") return false;
  const db = s.db[s.active];
  takeKeys(true);
  delete s.db[s.active];
  unshelve(s);
  write(s);
  // (An adopted account's databases may have the signed-out ones' name: deleted all the same —
  // the signed-out state starts anew, and opening them again makes them afresh.)
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
