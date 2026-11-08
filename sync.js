// Cloud sync (v71), for a signed-in account the owner has approved (invite-only), on by
// default, off per device on the Account page. What syncs:
//   • songs: the MusicXML (and the original PDF from PDF → Song) — up to SONG_LIMIT: the ones
//     already in the cloud stay, the newest others fill free places; the rest stay on the device;
//   • each song's settings (key, tempo %, tapped timing / own tempo) and its take history — one
//     row each (song_state "<song>|key", "|rate", "|timing", "|history"), so a change to one on a
//     device doesn't undo another device's change to another; histories are merged, never replaced;
//   • each song's last take — all its data, compressed, but not the recording (this device only);
//   • voice profiles (name and range; the volume calibration is per device — it's the mic's).
// Server: public.sync_items (one JSON document per thing, last writer wins by modified_at,
// deletes as tombstones) and the private Storage bucket "songs" — see
// supabase/migrations/20261108180000_sync.sql. Local: what the pages
// already use (library.js, localStorage) in the active space (space.js), plus resonate.sync
// (what was last synced).
//
// A pass (syncNow): note local changes (each thing's fingerprint against the last synced one;
// a change is stamped when it's first seen), pull the cloud's changes since the last pass
// (newer wins; histories are merged), push what's left. Passes run on page load, after the
// pages' "resonate:data" events (debounced), when the page becomes visible, and every 2 minutes
// while it's open — one at a time across tabs (Web Locks).

import { supabase, savedUser } from "./auth.js?v=71";
import { activeSpace, SYNC_META } from "./space.js?v=71";
import { listSongs, getSong, putSong, removeSong, getPdf, putPdf, listPdfIds, countVoices, listTakes, getTake, putTake, removeTake, persistent, dbGen } from "./library.js?v=71";

export const SONG_LIMIT = 10;
const FILE_LIMIT = 10 * 1024 * 1024;
const TEXT_LIMIT = 64 * 1024 * 1024; // a downloaded file never unpacks to more than this
export const OFF_KEY = "resonate.sync.off"; // this device doesn't sync (a device setting)
const L = { keys: "resonate.sing.keys", rates: "resonate.sing.rates", timing: "resonate.sing.timing", history: "resonate.sing.history", profiles: "resonate.profiles" };
const FIELDS = { key: L.keys, rate: L.rates, timing: L.timing }; // a song's settings: song_state "<song>|<field>", data { v }
const HISTORY = "history"; // its take history: song_state "<song>|history", data { list }
const BUCKET = "songs";
const COLS = "kind,id,data,deleted,modified_at,updated_at";
const PAGE = (() => { try { return Number(localStorage.getItem("resonate.sync.page")) || 100; } catch { return 100; } })(); // (tests use a small page)

const readJson = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const isLibraryId = (id) => /^s[0-9a-z]{6,}$/.test(id); // library.js ids; anything else is a bundled sample
const validId = (id) => typeof id === "string" && id.length >= 1 && id.length <= 100;
const splitKey = (key) => { const i = key.indexOf(":"); return [key.slice(0, i), key.slice(i + 1)]; };
// The song a settings / history / take row belongs to.
const songOf = (kind, id) => (kind === "song_state" ? id.slice(0, id.lastIndexOf("|")) : id);
const PER_SONG = ["song_state", "take"];

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
// meta = { uid, gen (the songs' database generation, library.js), cursor,
//          items: { "kind:id": { h, m (ms), up (pushed), del } }, info: { songId: { sha, source, pdf (in the cloud) } },
//          held: { songId: why } — songs that stay on this device: "full" (the cloud had no room
//          when pushed: tried again once songs change there) or "large" (over the file limit),
//          missing: { songId: modified ms } — in the cloud, but its file couldn't be found,
//          orphans: [path] — files whose removal is still to be done }
function loadMeta(uid) {
  const m = readJson(SYNC_META, null);
  const fresh = { uid, gen: null, cursor: null, items: {}, info: {}, held: {}, missing: {}, orphans: [] };
  return m && m.uid === uid ? { ...fresh, ...m } : fresh;
}
// (Only into the space it belongs to: a pass that outlives a switch writes nothing.)
const saveMeta = (m) => { if (current(m.uid)) writeJson(SYNC_META, m); };

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The local things in their sync form ("kind:id" → { kind, id, data }), and which songs go.
async function localItems(meta) {
  const items = new Map();
  const put = (kind, id, data) => { if (validId(id)) items.set(`${kind}:${id}`, { kind, id, data }); };
  const songs = await listSongs(); // newest first
  const here = new Set(songs.map((s) => s.id));
  const cloud = (id) => { const m = meta.items[`song:${id}`]; return !!m && !m.del; };
  let room = SONG_LIMIT - Object.entries(meta.items).filter(([k, m]) => k.startsWith("song:") && !m.del).length;
  // Room in the cloud again (a song deleted here or elsewhere): songs held for lack of it try again.
  if (room > 0) for (const [sid, why] of Object.entries(meta.held)) if (why === "full") delete meta.held[sid];
  const pdfs = new Set(await listPdfIds());
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
      if (!full) { synced.delete(s.id); continue; }
      info = meta.info[s.id] = { sha: await sha256(full.xml), source: full.source || null };
    }
    put("song", s.id, { title: s.title, added: s.added, source: info.source, sha: info.sha, pdf: pdfs.has(s.id) });
  }
  // Settings, history and the last take: for songs in the cloud and the bundled samples.
  const ok = (id) => synced.has(id) || !isLibraryId(id);
  for (const [field, key] of Object.entries(FIELDS)) {
    for (const [id, v] of Object.entries(readJson(key, {}))) if (ok(id) && v !== null && v !== undefined && !String(id).includes("|")) put("song_state", `${id}|${field}`, { v });
  }
  for (const [id, list] of Object.entries(readJson(L.history, {}))) if (ok(id) && Array.isArray(list) && list.length && !String(id).includes("|")) put("song_state", `${id}|${HISTORY}`, { list });
  for (const t of await listTakes()) if (ok(t.songId) && t.takeId) put("take", t.songId, { takeId: t.takeId, at: t.at });
  const prof = readJson(L.profiles, null);
  if (prof && Array.isArray(prof.list)) {
    for (const p of prof.list) put("profile", p.id, { name: p.name ?? "", range: p.range ?? null });
    put("prefs", "prefs", { activeProfile: prof.active ?? null });
  }
  return { items, synced, here, pdfs };
}

// The sync form of what the cloud sent (what localItems would make of it once applied).
function norm(kind, data) {
  if (!data) return null;
  if (kind === "song") return { title: data.title, added: data.added, source: data.source ?? null, sha: data.sha, pdf: !!data.pdf };
  if (kind === "take") return { takeId: data.takeId, at: data.at };
  if (kind === "profile") return { name: data.name ?? "", range: data.range ?? null };
  return data;
}

// Note local changes: anything whose fingerprint moved is stamped and waits to be pushed;
// anything synced before and now gone becomes a delete. A stamp is the time the change was
// first seen (a take: when it was sung, so an older take never beats a newer one), and always
// later than the last version this device knew, so the server takes it.
function noteChanges(meta, { items, synced, here }, now) {
  let n = 0;
  for (const [key, it] of items) {
    const h = fingerprint(it.data);
    const m = meta.items[key];
    if (m && !m.del && m.h === h) continue;
    const when = it.kind === "take" && typeof it.data.at === "number" ? it.data.at : now;
    meta.items[key] = { h, m: Math.max(when, (m?.m || 0) + 1), up: false };
    n++;
  }
  // Songs first: whether a song is gone decides for its settings, history and take.
  const gone = Object.entries(meta.items).filter(([key, m]) => !items.has(key) && !m.del);
  gone.sort(([a], [b]) => (b.startsWith("song:") ? 1 : 0) - (a.startsWith("song:") ? 1 : 0));
  for (const [key, m] of gone) {
    const [kind, id] = splitKey(key);
    if (kind === "song" && (meta.missing[id] || meta.held[id])) continue; // (not here, not deleted)
    if (PER_SONG.includes(kind)) {
      const sid = songOf(kind, id);
      // A song that isn't here (not downloaded, held, …): nothing is known about its things.
      if (isLibraryId(sid) && !synced.has(sid) && !here.has(sid) && !meta.items[`song:${sid}`]?.del) continue;
      if (isLibraryId(sid) && !synced.has(sid) && here.has(sid)) continue;
    }
    meta.items[key] = { h: null, m: Math.max(now, m.m + 1), up: false, del: true };
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
  for (const h of [...(a || []), ...(b || [])]) if (h && typeof h === "object" && typeof h.at === "number" && typeof h.sig === "string") seen.set(`${h.at}|${h.sig}`, h);
  const all = [...seen.values()].sort((x, y) => x.at - y.at);
  const perSig = new Map();
  for (const h of all) perSig.set(h.sig, [...(perSig.get(h.sig) || []), h]);
  const keep = new Set([...perSig.values()].flatMap((l) => l.slice(-10)));
  return all.filter((h) => keep.has(h)).slice(-40);
}

// What a setting may be (anything else from the cloud is ignored).
const num = (x, lo, hi) => (typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi ? x : null);
function cleanField(field, v) {
  if (field === "key") return typeof v === "string" ? (/^fit(:-?\d{1,2})?$/.test(v) ? v : null) : num(v, -48, 48);
  if (field === "rate") return num(v, 0.1, 4);
  if (field === "timing") {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    // (A pace may be null: untapped there — the map's average, timing.js.)
    const segs = Array.isArray(v.segs) ? v.segs.filter((s) => Array.isArray(s) && s.length === 2 && Number.isFinite(s[0]) && (s[1] === null || Number.isFinite(s[1]))) : [];
    const out = { sig: String(v.sig ?? ""), segs, use: !!v.use };
    if (v.bpm === null) out.bpm = null;
    else if (num(v.bpm, 10, 1000) !== null) out.bpm = v.bpm;
    return segs.length || out.bpm ? out : null;
  }
  return null;
}
function cleanRange(r) {
  if (!r || typeof r !== "object") return null;
  const out = {};
  for (const k of ["low", "high", "comfortLow", "comfortHigh"]) { out[k] = num(r[k], 0, 127); if (out[k] === null) return null; }
  out.at = num(r.at, 0, 1e15); // (null: a preset, not measured)
  return out;
}

const permanent = (msg) => Object.assign(new Error(msg), { permanent: true });
async function gunzipText(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  const reader = s.getReader(), parts = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > TEXT_LIMIT) { reader.cancel().catch(() => {}); throw permanent("unpacks too large"); }
      parts.push(value);
    }
  } catch (err) { throw err.permanent ? err : permanent(`not gzip: ${err.message}`); }
  return new TextDecoder().decode(await new Blob(parts).arrayBuffer());
}
async function gzipBytes(text) {
  const s = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
const toB64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (b) => { try { return Uint8Array.from(atob(b), (c) => c.charCodeAt(0)); } catch { throw permanent("bad base64"); } };
const notFound = (e) => e && (e.status === 404 || String(e.statusCode) === "404" || /not.?found/i.test(e.message || ""));

// One row from the cloud, applied here. Throws when it should be tried again (a download cut
// off…); a row that can never be applied (a broken document) throws `permanent` and is passed by.
async function apply(sb, row, meta, changed, uid) {
  const { kind, id, deleted } = row;
  // Before every write: the device still shows this account (a sign-out in another tab…).
  const guard = () => { if (!current(uid)) throw new Error("the space changed"); };
  // A delete of something this version doesn't know (another form, a test's): nothing to do.
  const field = id.slice(id.lastIndexOf("|") + 1);
  const known = kind === "song" ? isLibraryId(id) : kind === "song_state" ? id.includes("|") && (!!FIELDS[field] || field === HISTORY) : true;
  if (deleted && !known) return;
  const data = deleted ? null : row.data;
  if (!deleted && (!data || typeof data !== "object")) throw permanent("no data");
  const m = Date.parse(row.modified_at);
  let h = deleted ? null : fingerprint(norm(kind, data));
  let up = true;
  if (kind === "song") {
    if (!isLibraryId(id)) throw permanent("not a song id");
    delete meta.missing[id];
    if (deleted) {
      guard();
      await removeSong(id, { quiet: true });
      for (const k of [L.keys, L.rates, L.timing, L.history]) setIn(k, id, null); // (removeSong took its take and PDF)
      delete meta.info[id];
      delete meta.held[id];
    } else {
      const have = await getSong(id);
      const title = String(data.title ?? "").slice(0, 300) || "Song";
      if (!have) {
        if (typeof data.xml?.path !== "string") throw permanent("no file");
        const blob = await sb.storage.from(BUCKET).download(data.xml.path);
        if (blob.error && notFound(blob.error)) {
          // Not there (yet, or any more): this song stays in the cloud, just not here.
          meta.missing[id] = m;
          meta.items[`song:${id}`] = { h, m, up: true };
          return;
        }
        if (blob.error) throw blob.error;
        const xml = await gunzipText(await blob.data.arrayBuffer());
        guard();
        await putSong({ id, title, xml, added: Number(data.added) || Date.now(), ...(data.source ? { source: String(data.source) } : {}) }, { quiet: true });
      } else if (have.title !== title) { guard(); await putSong({ ...have, title }, { quiet: true }); }
      // Its original PDF (PDF → Song), when the cloud has it and this device doesn't — on a
      // best-effort basis: a PDF that can't be had (no room here…) never holds up the pull.
      if (typeof data.pdf?.path === "string" && !(await getPdf(id))) {
        try {
          const f = await sb.storage.from(BUCKET).download(data.pdf.path);
          if (f.error && !notFound(f.error)) throw f.error;
          if (!f.error) { const buf = await f.data.arrayBuffer(); guard(); await putPdf(id, buf, String(data.pdf.name ?? ""), { quiet: true }); }
        } catch (err) {
          if (!current(uid)) throw err;
          console.warn("sync: pdf", id, err);
        }
      }
      dropOrphans(meta, uid, id); // (its files are live)
      meta.info[id] = { sha: String(data.sha ?? ""), source: data.source ?? null, pdf: !!data.pdf };
      // What this device now has, in its sync form (so nothing echoes back as a change).
      const stored = await getSong(id);
      h = fingerprint({ title: stored?.title ?? title, added: stored?.added ?? data.added, source: meta.info[id].source, sha: meta.info[id].sha, pdf: !!(await getPdf(id)) });
    }
    for (const [sid, why] of Object.entries(meta.held)) if (why === "full") delete meta.held[sid];
    changed.songs = true;
  } else if (kind === "song_state" && field === HISTORY) {
    const sid = songOf(kind, id);
    if (!sid) throw permanent("unknown setting");
    const local = readJson(L.history, {})[sid];
    guard();
    if (deleted) setIn(L.history, sid, null);
    else {
      if (!Array.isArray(data.list)) throw permanent("bad history");
      const merged = mergeHistory(local, data.list);
      setIn(L.history, sid, merged.length ? merged : null);
      // (A merge that differs from the cloud's goes back up: noteChanges sees the difference.)
    }
    (changed.state ||= new Set()).add(sid);
  } else if (kind === "song_state") {
    const sid = songOf(kind, id);
    if (!sid || !FIELDS[field]) throw permanent("unknown setting");
    const v = deleted ? null : cleanField(field, data.v);
    if (!deleted && v === null) throw permanent("bad setting");
    guard();
    setIn(FIELDS[field], sid, v);
    if (!deleted) h = fingerprint({ v }); // (what was written: a cleaned value never echoes back)
    (changed.state ||= new Set()).add(sid);
  } else if (kind === "take") {
    const local = await getTake(id);
    if (deleted) {
      // A take sung here after the cloud's delete stays (and goes up).
      if (local && local.at > m) { meta.items[`take:${id}`] = { h: fingerprint({ takeId: local.takeId, at: local.at }), m: Math.max(local.at, m + 1), up: false }; return; }
      guard();
      await removeTake(id, { quiet: true });
    } else {
      if (typeof data.takeId !== "string" || typeof data.at !== "number") throw permanent("bad take");
      if (local && local.takeId !== data.takeId && local.at > data.at) {
        // Ours was sung later: it stays, and goes up.
        meta.items[`take:${id}`] = { h: fingerprint({ takeId: local.takeId, at: local.at }), m: Math.max(local.at, m + 1), up: false };
        return;
      }
      if (local?.takeId !== data.takeId) {
        let take;
        try { take = JSON.parse(await gunzipText(fromB64(String(data.gz ?? "")))); } catch (err) { throw err.permanent ? err : permanent("bad take data"); }
        if (!take || typeof take !== "object") throw permanent("bad take data");
        guard();
        await putTake({ songId: id, takeId: data.takeId, at: data.at, data: take, voice: null }, { quiet: true });
      }
    }
    (changed.takes ||= new Set()).add(id);
  } else if (kind === "profile" || kind === "prefs") {
    guard();
    const p = readJson(L.profiles, { active: null, list: [] });
    if (!Array.isArray(p.list)) p.list = [];
    if (kind === "prefs") { if (!deleted && typeof data.activeProfile === "string") p.active = data.activeProfile; }
    else if (deleted) p.list = p.list.filter((x) => x.id !== id);
    else {
      const old = p.list.find((x) => x.id === id);
      const prof = { id, name: String(data.name ?? "").slice(0, 60), vol: old?.vol ?? null, range: cleanRange(data.range) }; // (vol: this device's)
      p.list = old ? p.list.map((x) => (x.id === id ? prof : x)) : [...p.list, prof];
      if (!p.active) p.active = id;
      h = fingerprint({ name: prof.name, range: prof.range });
    }
    writeJson(L.profiles, p);
    changed.profiles = true;
  } else throw permanent("unknown kind");
  // What this thing now is here: the cloud's version (a merged history may differ from it, and
  // so goes back up on the next push).
  meta.items[`${kind}:${id}`] = { h, m, up, ...(deleted ? { del: true } : {}) };
}

// A row from the cloud: applied unless ours is the same change or a newer one (still to go up).
// false: stop pulling here (tried again next pass — skipping it could make what follows wrong).
async function take1(sb, row, meta, changed, uid) {
  const key = `${row.kind}:${row.id}`;
  const m = meta.items[key];
  if (!validId(row.id)) return true;
  if (m && Date.parse(row.modified_at) <= m.m) {
    // Ours is newer — but a history is merged all the same: what goes up must hold the cloud's
    // entries too (they may be on no other device any more).
    const field = row.id.slice(row.id.lastIndexOf("|") + 1);
    if (row.kind === "song_state" && field === HISTORY && !row.deleted && Array.isArray(row.data?.list) && current(uid)) {
      const sid = songOf(row.kind, row.id);
      const local = readJson(L.history, {})[sid];
      const merged = mergeHistory(local, row.data.list);
      if (fingerprint(merged) !== fingerprint(local || [])) {
        setIn(L.history, sid, merged.length ? merged : null);
        (changed.state ||= new Set()).add(sid);
      }
    }
    return true;
  }
  try { await apply(sb, row, meta, changed, uid); return true; }
  catch (err) {
    console.warn("sync: couldn't apply", key, err);
    return !!err.permanent; // a broken row is passed by; anything else is tried again
  }
}

// The rows changed since the last pass, oldest first. Pages are keyed on (updated_at, kind, id),
// so rows written together (one batch has one updated_at) are never split and lost between pages.
async function pull(sb, meta, uid) {
  const changed = {};
  const since = meta.cursor ? new Date(Date.parse(meta.cursor) - 3000).toISOString() : "1970-01-01T00:00:00Z";
  let after = null; // the last row read: { t, kind, id }
  const q = (v) => `"${String(v).replace(/["\\]/g, "")}"`;
  for (let page = 0; page < 200; page++) {
    let req = sb.from("sync_items").select(COLS);
    req = after
      ? req.or(`updated_at.gt.${q(after.t)},and(updated_at.eq.${q(after.t)},kind.gt.${q(after.kind)}),and(updated_at.eq.${q(after.t)},kind.eq.${q(after.kind)},id.gt.${q(after.id)})`)
      : req.gt("updated_at", since);
    const { data: rows, error } = await req.order("updated_at", { ascending: true }).order("kind", { ascending: true }).order("id", { ascending: true }).limit(PAGE);
    if (error) throw error;
    for (const row of rows) {
      if (!current(uid)) return changed;
      if (!(await take1(sb, row, meta, changed, uid))) { saveMeta(meta); return changed; }
      if (!meta.cursor || row.updated_at > meta.cursor) meta.cursor = row.updated_at;
    }
    saveMeta(meta);
    if (rows.length < PAGE) break;
    const last = rows[rows.length - 1];
    after = { t: last.updated_at, kind: last.kind, id: last.id };
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
      // A refusal (the server said no) leaves the PDF on this device; anything else (no
      // connection…) is tried again with the song next pass.
      if (r.error && !(r.error.status >= 400 && r.error.status < 500)) throw r.error;
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

// A song that stays on this device: forget that it was going up (with its settings, history
// and take), so it's neither retried every pass nor taken for a delete.
function hold(meta, id, why) {
  meta.held[id] = why;
  for (const key of Object.keys(meta.items)) {
    const [kind, kid] = splitKey(key);
    if ((kind === "song" ? kid === id : PER_SONG.includes(kind) && songOf(kind, kid) === id) && !meta.items[key].up) delete meta.items[key];
  }
}

// Files to remove: the server's answer is checked, and what didn't go is tried again next pass
// (a leftover file still counts against the account's files).
async function removeFiles(sb, meta, paths) {
  if (!paths.length) return;
  const { error } = await sb.storage.from(BUCKET).remove(paths).catch((err) => ({ error: err }));
  const left = new Set(meta.orphans || []);
  for (const p of paths) error ? left.add(p) : left.delete(p);
  meta.orphans = [...left];
}
const songFiles = (uid, id) => [`${uid}/${id}.xml.gz`, `${uid}/${id}.pdf`];
// A song live in the cloud again: its files are no longer leftovers.
function dropOrphans(meta, uid, id) {
  const mine = new Set(songFiles(uid, id));
  if (meta.orphans?.length) meta.orphans = meta.orphans.filter((p) => !mine.has(p));
}

async function push(sb, uid, meta, items, changed) {
  if (meta.orphans?.length) await removeFiles(sb, meta, [...meta.orphans]);
  const rows = [];
  for (const [key, m] of Object.entries(meta.items)) {
    if (m.up) continue;
    const [kind, id] = splitKey(key);
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
    }
    rows.push({ key, m: m.m, row: { user_id: uid, kind, id, data, deleted: !!m.del, modified_at: new Date(m.m).toISOString() } });
  }
  const dropped = [];
  const mark = (r, kept) => {
    const now = meta.items[r.key];
    if (!now || now.m !== r.m) return; // (changed again meanwhile: goes up next pass)
    now.up = true;
    if (!kept) dropped.push(r.key);
    // A song's files go once its delete is in (never before: a delete the server refused
    // would leave a song without its file).
    // (Noted as leftovers first: the removal is checked at the end of the push, and whatever
    // didn't go is tried again next pass.)
    else if (r.row.kind === "song" && r.row.deleted) meta.orphans = [...new Set([...(meta.orphans || []), ...songFiles(uid, r.row.id)])];
    else if (r.row.kind === "song") { meta.info[r.row.id] = { ...(meta.info[r.row.id] || {}), pdf: !!r.row.data?.pdf }; dropOrphans(meta, uid, r.row.id); }
  };
  // The server answers with the rows it kept: one it didn't was older than the cloud's.
  const sent = async (batch) => {
    const { data, error } = await sb.from("sync_items").upsert(batch.map((r) => r.row), { onConflict: "user_id,kind,id" }).select("kind,id,deleted");
    if (error) return error;
    const kept = new Set((data || []).map((x) => `${x.kind}:${x.id}`));
    for (const r of batch) mark(r, kept.has(r.key));
    return null;
  };
  // The server's limits count the row being written too (an upsert runs the insert check
  // first): a row already in the cloud, pushed again while the account is at a limit, is
  // refused as an insert — as an update it goes through.
  const sendOne = async (r) => {
    const error = await sent([r]);
    if (!String(error?.hint || "").startsWith("resonate:limit:")) return error;
    const { kind, id, data, deleted, modified_at } = r.row;
    const up = await sb.from("sync_items").update({ data, deleted, modified_at }).eq("kind", kind).eq("id", id).select("kind,id,deleted");
    if (up.error) return up.error;
    if (up.data?.length) { mark(r, true); return null; }
    // Nothing updated: no such row (the limit is real), or the cloud's is newer (dropped).
    const { data: row, error: e2 } = await sb.from("sync_items").select("deleted").eq("kind", kind).eq("id", id).maybeSingle();
    if (e2) return e2; // (not known: tried again next pass — never taken for "no room")
    if (row && !row.deleted) { mark(r, false); return null; }
    return error;
  };
  // Songs one at a time (the cloud may be full: that one stays on this device, with its
  // settings and take), the rest in batches.
  for (const r of rows.filter((x) => x.row.kind === "song")) {
    if (!current(uid)) return;
    const error = await sendOne(r);
    if (error?.hint === "resonate:limit:song") {
      // No room: the files just uploaded for it go again, and it stays on this device.
      if (!r.row.deleted) await removeFiles(sb, meta, songFiles(uid, r.row.id));
      hold(meta, r.row.id, "full");
    } else if (error) console.warn("sync: push", r.key, error);
  }
  const rest = rows.filter((x) => x.row.kind !== "song" && meta.items[x.key] && !meta.items[x.key].up);
  for (let i = 0; i < rest.length; i += 20) {
    if (!current(uid)) break;
    const batch = rest.slice(i, i + 20);
    if (!(await sent(batch))) continue;
    // One bad thing mustn't hold the others back: one at a time.
    for (const r of batch) {
      const e = await sendOne(r);
      if (e) console.warn("sync: push", r.key, e);
    }
  }
  // What the server kept instead of ours: fetched and applied now.
  for (const key of dropped) {
    if (!current(uid)) break;
    const [kind, id] = splitKey(key);
    const { data: row, error } = await sb.from("sync_items").select(COLS).eq("kind", kind).eq("id", id).maybeSingle();
    if (error || !row) continue;
    meta.items[key].m = Math.min(meta.items[key].m, Date.parse(row.modified_at) - 1);
    await take1(sb, row, meta, changed, uid);
  }
  if (meta.orphans?.length && current(uid)) await removeFiles(sb, meta, [...meta.orphans]);
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
  let meta = loadMeta(uid);
  // The songs' database is a new one (the browser cleared it, …): what was synced before says
  // nothing about what's here now — start over, the cloud's copy first (nothing looks deleted).
  const gen = dbGen();
  if (meta.gen !== gen) meta = { ...loadMeta(null), uid, gen };
  // Changes made here since the last pass are stamped before the pull, so a pulled older change
  // doesn't overwrite them (a fresh start has nothing to compare: the cloud comes first).
  if (meta.cursor) noteChanges(meta, await localItems(meta), Date.now());
  saveMeta(meta);
  const changed = await pull(sb, meta, uid);
  if (!current(uid)) return { skipped: true };
  // The songs' database still the one this pass started with, and still there: otherwise what's
  // read now could look like "everything deleted".
  if (!(await persistent()) || dbGen() !== gen) return { skipped: true };
  // What the pull changed here (a merged history, a song now in the cloud…) is noted again.
  const local = await localItems(meta);
  noteChanges(meta, local, Date.now());
  saveMeta(meta);
  await push(sb, uid, meta, local.items, changed);
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
      if (state.again && !stopped) { state.again = false; syncNow(); }
    }
  };
  state.running = run();
  return state.running;
}

// What would be lost if this device forgot the active account's data now (Sign out): songs
// not confirmed in the cloud, and other changes not yet pushed.
export async function unsynced() {
  const uid = activeSpace();
  if (uid === "anon") return { songs: 0, changes: 0, recordings: 0, calibration: false };
  // This page can't read the songs (storage unavailable): it can't say what's safe — assume something isn't.
  if (!(await persistent())) return { songs: 0, changes: 1, recordings: 0, calibration: false };
  const meta = loadMeta(uid);
  const local = await localItems(meta);
  if (meta.cursor) noteChanges(meta, local, Date.now());
  const inCloud = (id) => { const m = meta.items[`song:${id}`]; return !!m && m.up && !m.del; };
  const songs = (await listSongs()).filter((s) => !inCloud(s.id)).length;
  let changes = meta.cursor
    ? Object.entries(meta.items).filter(([key, m]) => !m.up && !key.startsWith("song:")).length
    : [...local.items.keys()].filter((key) => !key.startsWith("song:")).length;
  // A song in the cloud whose original PDF isn't (over the size limit, refused).
  changes += [...local.pdfs].filter((id) => inCloud(id) && !meta.info[id]?.pdf).length;
  // What only ever lives on this device: the recordings of the last takes, the mic calibration.
  const recordings = await countVoices().catch(() => 0);
  const prof = readJson(L.profiles, null);
  const calibration = !!(prof?.list?.some?.((p) => p?.vol) || localStorage.getItem("resonate.volCal"));
  return { songs, changes, recordings, calibration };
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
  try { navigator.storage?.persist?.().catch(() => {}); } catch {} // (less likely to be cleared by the browser)
  let soon = null;
  window.addEventListener("resonate:data", () => { clearTimeout(soon); soon = setTimeout(syncNow, 1500); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) syncNow(); });
  timer = setInterval(() => { if (!document.hidden) syncNow(); }, 120000);
  syncNow();
}

window.resonateSync = () => ({ state: { running: !!state.running, last: state.last }, meta: readJson(SYNC_META, null), approved });
