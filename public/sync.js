// Cloud sync (v71), for a signed-in account the owner has approved (invite-only), on by
// default, off per device on the Account page. What syncs:
//   • songs: the MusicXML (and the original PDF from PDF → Song) — up to SONG_LIMIT: the ones
//     already in the cloud stay, the newest others fill free places; the rest stay on the device;
//   • each song's settings (key, tempo %, tapped timing / own tempo) and take history;
//   • each song's last take — all its data, compressed, but not the recording (this device only);
//   • voice profiles (name and range; the volume calibration is per device — it's the mic's).
// Server: public.sync_items (one JSON document per thing, last writer wins by modified_at,
// deletes as tombstones) and the private Storage bucket "songs" — see
// supabase/migrations/20261108180000_sync.sql. Local: what the pages already use (library.js,
// localStorage) in the active space (space.js), plus resonate.sync (what was last synced).
//
// A pass (syncNow): note local changes (each thing's fingerprint against the last synced one;
// a change is stamped when it's first seen), pull the cloud's changes since the last pass
// (newer wins; history lists are merged), push what's left. Passes run on page load, after the
// pages' "resonate:data" events (debounced), when the page becomes visible, and every 2 minutes
// while it's open — one at a time across tabs (Web Locks).

import { supabase, savedUser } from "./auth.js?v=71";
import { activeSpace, SYNC_META } from "./space.js?v=71";
import { listSongs, getSong, putSong, removeSong, getPdf, listTakes, getTake, putTake, removeTake, persistent } from "./library.js?v=71";

export const SONG_LIMIT = 10;
const FILE_LIMIT = 10 * 1024 * 1024;
export const OFF_KEY = "resonate.sync.off"; // this device doesn't sync (a device setting)
const L = { keys: "resonate.sing.keys", rates: "resonate.sing.rates", timing: "resonate.sing.timing", history: "resonate.sing.history", profiles: "resonate.profiles" };
const BUCKET = "songs";

const readJson = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const isLibraryId = (id) => /^s[0-9a-z]{6,}$/.test(id); // library.js ids; anything else is a bundled sample

// A stable fingerprint of a JSON value (key order doesn't matter).
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
export function fingerprint(v) {
  const s = stable(v);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${h.toString(36)}.${s.length.toString(36)}`;
}

// --- What's here ------------------------------------------------------------------------
// meta = { uid, cursor, items: { "kind:id": { h, m (ms), up (pushed), del } }, info: { songId: { sha, source } },
//          held: { songId: why } — songs that stay on this device: "full" (the cloud had no room
//          when pushed: tried again once songs change there) or "large" (over the file limit) }
function loadMeta(uid) {
  const m = readJson(SYNC_META, null);
  const fresh = { uid, cursor: null, items: {}, info: {}, held: {} };
  return m && m.uid === uid ? { ...fresh, ...m } : fresh;
}
const saveMeta = (m) => writeJson(SYNC_META, m);

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The local things in their sync form ("kind:id" → { kind, id, data }), and which songs go.
async function localItems(meta) {
  const items = new Map();
  const put = (kind, id, data) => { if (typeof id === "string" && id.length >= 1 && id.length <= 100) items.set(`${kind}:${id}`, { kind, id, data }); };
  const songs = await listSongs(); // newest first
  const cloud = (id) => { const m = meta.items[`song:${id}`]; return !!m && !m.del; };
  let room = SONG_LIMIT - Object.entries(meta.items).filter(([k, m]) => k.startsWith("song:") && !m.del).length;
  const synced = new Set();
  for (const s of songs) {
    if (cloud(s.id)) synced.add(s.id);
    else if (room > 0 && !meta.held[s.id]) { synced.add(s.id); room--; }
  }
  for (const s of songs) {
    if (!synced.has(s.id)) continue;
    let info = meta.info[s.id];
    if (!info) {
      const full = await getSong(s.id);
      if (!full) continue;
      info = meta.info[s.id] = { sha: await sha256(full.xml), source: full.source || null };
    }
    put("song", s.id, { title: s.title, added: s.added, source: info.source, sha: info.sha });
  }
  // Settings, history and the last take: for songs in the cloud and the bundled samples.
  const keys = readJson(L.keys, {}), rates = readJson(L.rates, {}), timing = readJson(L.timing, {}), history = readJson(L.history, {});
  const ok = (id) => synced.has(id) || !isLibraryId(id);
  for (const id of new Set([...Object.keys(keys), ...Object.keys(rates), ...Object.keys(timing), ...Object.keys(history)])) {
    if (!ok(id)) continue;
    put("song_state", id, { key: keys[id] ?? null, rate: rates[id] ?? null, timing: timing[id] ?? null, history: history[id] ?? null });
  }
  for (const t of await listTakes()) if (ok(t.songId) && t.takeId) put("take", t.songId, { takeId: t.takeId, at: t.at });
  const prof = readJson(L.profiles, null);
  if (prof && Array.isArray(prof.list)) {
    for (const p of prof.list) put("profile", p.id, { name: p.name ?? "", range: p.range ?? null });
    put("prefs", "prefs", { activeProfile: prof.active ?? null });
  }
  return { items, synced };
}

// The sync form of what the cloud sent (what localItems would make of it once applied).
function norm(kind, data) {
  if (!data) return null;
  if (kind === "song") return { title: data.title, added: data.added, source: data.source ?? null, sha: data.sha };
  if (kind === "take") return { takeId: data.takeId, at: data.at };
  if (kind === "profile") return { name: data.name ?? "", range: data.range ?? null };
  return data;
}

// Note local changes: anything whose fingerprint moved is stamped now and waits to be pushed;
// anything synced before and now gone becomes a delete.
function noteChanges(meta, items, now) {
  let n = 0;
  for (const [key, it] of items) {
    const h = fingerprint(it.data);
    const m = meta.items[key];
    if (!m || m.del || m.h !== h) { meta.items[key] = { h, m: now, up: false }; n++; }
  }
  for (const [key, m] of Object.entries(meta.items)) {
    if (items.has(key) || m.del) continue;
    // A song that just isn't synced from here (room) is "gone" only if it was in the cloud.
    meta.items[key] = { h: null, m: now, up: false, del: true };
    n++;
  }
  return n;
}

// --- Applying the cloud's changes -----------------------------------------------------------
function setIn(key, id, val) {
  const all = readJson(key, {});
  if (val === null || val === undefined) delete all[id];
  else all[id] = val;
  writeJson(key, all);
}
// Two copies of a song's take history: every entry of either, oldest first, trimmed like
// sing.js's recordTake (10 per verse, 40 per song).
export function mergeHistory(a = [], b = []) {
  const seen = new Map();
  for (const h of [...(a || []), ...(b || [])]) if (h && typeof h.at === "number") seen.set(`${h.at}|${h.sig}`, h);
  const all = [...seen.values()].sort((x, y) => x.at - y.at);
  const perSig = new Map();
  for (const h of all) perSig.set(h.sig, [...(perSig.get(h.sig) || []), h]);
  const keep = new Set([...perSig.values()].flatMap((l) => l.slice(-10)));
  return all.filter((h) => keep.has(h)).slice(-40);
}

async function gunzipText(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(s).text();
}
async function gzipBytes(text) {
  const s = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
const toB64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));

async function apply(sb, row, meta, changed) {
  const { kind, id, data, deleted } = row;
  if (kind === "song") {
    if (deleted) {
      await removeSong(id, { quiet: true });
      for (const k of [L.keys, L.rates, L.timing, L.history]) setIn(k, id, null);
      delete meta.info[id];
    } else {
      const have = await getSong(id);
      if (!have) {
        const blob = await sb.storage.from(BUCKET).download(data.xml.path);
        if (blob.error) throw blob.error;
        const xml = await gunzipText(await blob.data.arrayBuffer());
        await putSong({ id, title: data.title, xml, added: data.added, ...(data.source ? { source: data.source } : {}) }, { quiet: true });
      } else if (have.title !== data.title) await putSong({ ...have, title: data.title }, { quiet: true });
      meta.info[id] = { sha: data.sha, source: data.source ?? null };
    }
    for (const [sid, why] of Object.entries(meta.held)) if (why === "full") delete meta.held[sid];
    changed.songs = true;
  } else if (kind === "song_state") {
    const d = data || {};
    setIn(L.keys, id, deleted ? null : d.key);
    setIn(L.rates, id, deleted ? null : d.rate);
    setIn(L.timing, id, deleted ? null : d.timing);
    const local = readJson(L.history, {})[id];
    setIn(L.history, id, deleted ? null : (d.history || local) ? mergeHistory(local, d.history) : null);
    (changed.state ||= new Set()).add(id);
  } else if (kind === "take") {
    if (deleted) await removeTake(id, { quiet: true });
    else {
      const local = await getTake(id);
      if (local?.takeId !== data.takeId) {
        const take = JSON.parse(await gunzipText(fromB64(data.gz)));
        await putTake({ songId: id, takeId: data.takeId, at: data.at, data: take, voice: null }, { quiet: true });
      }
    }
    (changed.takes ||= new Set()).add(id);
  } else if (kind === "profile" || kind === "prefs") {
    const p = readJson(L.profiles, { active: null, list: [] });
    if (!Array.isArray(p.list)) p.list = [];
    if (kind === "prefs") { if (!deleted && data) p.active = data.activeProfile ?? p.active; }
    else if (deleted) p.list = p.list.filter((x) => x.id !== id);
    else {
      const old = p.list.find((x) => x.id === id);
      const prof = { id, name: data.name ?? "", vol: old?.vol ?? null, range: data.range ?? null }; // (vol: this device's)
      p.list = old ? p.list.map((x) => (x.id === id ? prof : x)) : [...p.list, prof];
      if (!p.active) p.active = id;
    }
    writeJson(L.profiles, p);
    changed.profiles = true;
  }
  // What this thing now is here: the cloud's version (a merged history differs from it, and
  // so goes back up on the next push).
  meta.items[`${kind}:${id}`] = { h: deleted ? null : fingerprint(norm(kind, data)), m: Date.parse(row.modified_at), up: true, ...(deleted ? { del: true } : {}) };
}

async function pull(sb, meta, uid) {
  const changed = {};
  let since = meta.cursor ? new Date(Date.parse(meta.cursor) - 3000).toISOString() : "1970-01-01T00:00:00Z";
  for (let page = 0; page < 50; page++) {
    const { data: rows, error } = await sb.from("sync_items").select("kind,id,data,deleted,modified_at,updated_at")
      .gt("updated_at", since).order("updated_at", { ascending: true }).limit(100);
    if (error) throw error;
    for (const row of rows) {
      if (!current(uid)) return changed;
      const key = `${row.kind}:${row.id}`;
      const m = meta.items[key];
      // Ours is the same change or a newer one (still to be pushed): keep ours.
      if (!(m && Date.parse(row.modified_at) <= m.m)) {
        // A failure (a download cut off…) stops here: the cursor stays before it, so it's
        // tried again next time — skipping it could make what follows it look deleted.
        try { await apply(sb, row, meta, changed); }
        catch (err) { console.warn("sync: couldn't apply", key, err); saveMeta(meta); return changed; }
      }
      if (!meta.cursor || row.updated_at > meta.cursor) meta.cursor = row.updated_at;
    }
    saveMeta(meta);
    if (rows.length < 100) break;
    since = rows[rows.length - 1].updated_at;
  }
  return changed;
}

// --- Pushing ------------------------------------------------------------------------------
async function wireData(sb, uid, it) {
  if (it.kind === "song") {
    const song = await getSong(it.id);
    if (!song) return null;
    const xmlPath = `${uid}/${it.id}.xml.gz`;
    const gz = await gzipBytes(song.xml);
    if (gz.byteLength > FILE_LIMIT) throw Object.assign(new Error("song too large"), { tooLarge: true });
    const up = await sb.storage.from(BUCKET).upload(xmlPath, new Blob([gz], { type: "application/gzip" }), { upsert: true, contentType: "application/gzip" });
    if (up.error) throw up.error;
    let pdf = null;
    const p = await getPdf(it.id);
    if (p?.pdf && p.bytes <= FILE_LIMIT) {
      const pdfPath = `${uid}/${it.id}.pdf`;
      const r = await sb.storage.from(BUCKET).upload(pdfPath, new Blob([p.pdf], { type: "application/pdf" }), { upsert: true, contentType: "application/pdf" });
      if (!r.error) pdf = { path: pdfPath, bytes: p.bytes, name: p.name || "" };
    }
    return { ...it.data, xml: { path: xmlPath, bytes: gz.byteLength }, pdf };
  }
  if (it.kind === "take") {
    const rec = await getTake(it.id);
    if (!rec?.data) return null;
    return { takeId: rec.takeId, at: rec.at, v: 1, gz: toB64(await gzipBytes(JSON.stringify(rec.data))) };
  }
  return it.data;
}

// A song that stays on this device: forget that it was going up (with its settings and take),
// so it's neither retried every pass nor taken for a delete.
function hold(meta, id, why) {
  meta.held[id] = why;
  for (const k of ["song", "song_state", "take"]) if (!meta.items[`${k}:${id}`]?.up) delete meta.items[`${k}:${id}`];
  if (meta.items[`song:${id}`]?.up && why === "large") return; // (already in the cloud)
}

async function push(sb, uid, meta, items) {
  const pending = Object.entries(meta.items).filter(([, m]) => !m.up);
  const rows = [];
  for (const [key, m] of pending) {
    const [kind, ...rest] = key.split(":");
    const id = rest.join(":");
    const it = items.get(key);
    let data = null;
    if (!m.del) {
      if (!it) continue;
      try { data = await wireData(sb, uid, it); }
      catch (err) {
        if (err.tooLarge) hold(meta, id, "large");
        console.warn("sync: couldn't prepare", key, err);
        continue;
      }
      if (!data) continue;
    } else if (kind === "song") {
      sb.storage.from(BUCKET).remove([`${uid}/${id}.xml.gz`, `${uid}/${id}.pdf`]).catch(() => {});
    }
    rows.push({ key, row: { user_id: uid, kind, id, data, deleted: !!m.del, modified_at: new Date(m.m).toISOString() } });
  }
  // Songs one at a time (the cloud may be full: that one stays on this device, with its
  // settings and take), the rest together.
  const songs = rows.filter((r) => r.row.kind === "song");
  for (const r of songs) {
    if (!current(uid)) return;
    const { error } = await sb.from("sync_items").upsert(r.row, { onConflict: "user_id,kind,id" });
    if (!error) meta.items[r.key].up = true;
    else if (error.hint === "resonate:limit:song") hold(meta, r.row.id, "full");
    else console.warn("sync: push", r.key, error);
  }
  const rest = rows.filter((r) => r.row.kind !== "song" && meta.items[r.key]);
  for (let i = 0; i < rest.length; i += 20) {
    if (!current(uid)) break;
    const batch = rest.slice(i, i + 20);
    const { error } = await sb.from("sync_items").upsert(batch.map((r) => r.row), { onConflict: "user_id,kind,id" });
    if (!error) { for (const r of batch) meta.items[r.key].up = true; continue; }
    // One bad thing mustn't hold the others back: one at a time.
    for (const r of batch) {
      const { error: e } = await sb.from("sync_items").upsert(r.row, { onConflict: "user_id,kind,id" });
      if (!e) meta.items[r.key].up = true;
      else console.warn("sync: push", r.key, e);
    }
  }
  saveMeta(meta);
}

// --- Running ------------------------------------------------------------------------------
export const syncOff = () => { try { return localStorage.getItem(OFF_KEY) === "1"; } catch { return false; } };
let approved = null; // per page load
let state = { running: null, again: false, last: null };
let stopped = false;
// The pass's account is still the one whose data is on this device (signing out stops passes,
// but one already under way checks before each step).
const current = (uid) => !stopped && activeSpace() === uid && savedUser()?.id === uid;

// Whether this device syncs now: signed in, this account's data on the device, approved, on.
async function ready() {
  const user = savedUser();
  if (stopped || !user || syncOff() || activeSpace() !== user.id) return null;
  const sb = await supabase();
  const { data: { session } } = await sb.auth.getSession();
  if (!session || session.user.id !== user.id) return null;
  if (approved === null) {
    const { data, error } = await sb.from("accounts").select("approved").maybeSingle();
    if (error) return null;
    approved = !!data?.approved;
  }
  return approved ? { sb, uid: user.id } : null;
}

async function pass() {
  const ctx = await ready();
  if (!ctx) return { skipped: true };
  // Songs only in memory (no IndexedDB — some private modes) would look deleted: no sync then.
  if (!(await persistent())) return { skipped: true };
  const { sb, uid } = ctx;
  const meta = loadMeta(uid);
  let { items } = await localItems(meta);
  noteChanges(meta, items, Date.now());
  saveMeta(meta);
  const changed = await pull(sb, meta, uid);
  if (!current(uid)) return { skipped: true };
  // What the pull changed here (a merged history, a song now in the cloud…) is noted again.
  ({ items } = await localItems(meta));
  noteChanges(meta, items, Date.now());
  saveMeta(meta);
  await push(sb, uid, meta, items);
  if (Object.keys(changed).length) {
    try { window.dispatchEvent(new CustomEvent("resonate:remote", { detail: changed })); } catch {}
  }
  return { changed };
}

// One pass at a time (in this page, and across tabs where Web Locks exist); a request while
// one runs makes one more pass after it.
export function syncNow() {
  if (state.running) { state.again = true; return state.running; }
  const run = async () => {
    try {
      const go = () => pass().catch((err) => { console.warn("sync:", err); return { error: err }; });
      state.last = await (navigator.locks ? navigator.locks.request("resonate-sync", go) : go());
      return state.last;
    } finally {
      state.running = null;
      if (state.again) { state.again = false; syncNow(); }
    }
  };
  state.running = run();
  return state.running;
}

// What would be lost if this device forgot the account's data now (Sign out).
export async function unsynced() {
  const user = savedUser();
  if (!user || activeSpace() !== user.id) return { songs: 0, changes: 0 };
  const meta = loadMeta(user.id);
  const { items, synced } = await localItems(meta);
  noteChanges(meta, items, Date.now());
  const songs = (await listSongs()).filter((s) => !synced.has(s.id)).length;
  const changes = Object.values(meta.items).filter((m) => !m.up).length;
  return { songs, changes };
}

// Signing out: no more passes; wait for one under way (it stops at its next step).
export async function stop() {
  stopped = true;
  clearInterval(timer);
  try { await state.running; } catch {}
}

let started = false, timer = null;
export function start() {
  if (started) return;
  started = true;
  let soon = null;
  window.addEventListener("resonate:data", () => { clearTimeout(soon); soon = setTimeout(syncNow, 1500); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) syncNow(); });
  timer = setInterval(() => { if (!document.hidden) syncNow(); }, 120000);
  syncNow();
}

window.resonateSync = () => ({ state: { running: !!state.running, last: state.last }, meta: readJson(SYNC_META, null), approved });
