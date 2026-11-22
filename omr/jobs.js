// PDF → Song import jobs on this device (IndexedDB 'resonate-imports'), so an import survives a
// reload, a crash or leaving the page and continues where it was: the PDF, what page prep found,
// the engine's book (.omr) after every finished page, and the events the progress view showed.
// Device-only: never synced. A job records the songs' database its song goes into (space.js dbName):
// only the space whose data that is sees it, and it follows that data through sign-up (adopt), a
// sign-in on top (shelved), a session ending (parked); Sign out deletes it with the data (space.js
// leave → deleteJobsOf); deleting a song deletes its conversions (forget.js → deleteJobsFor). The
// small flag nav.js reads is the space's own localStorage key 'resonate.import' (space.js DATA_KEYS:
// shelved / parked with the space).
//
// Stores (database version 1; never upgraded in place — an older tab never blocks it):
//   jobs  { id, db, space, name, size, lastModified, engine, app, created, updated, phase,
//           music: [{ page, s, w, h }] | null, of (PDF pages), title, tempo, done: [s], failed: […],
//           stage ('prep' | 'boot' | '<s>' | 'export' | 'save': the last one begun), starts / lefts
//           { stage: n } (begun / left on purpose), fails { stage: n } (errors kept), runs, skip: [s],
//           replace?: songId (a reprocess: the song's stored PDF read again; the result replaces its MusicXML) }
//   data  key "<id>|pdf" → ArrayBuffer · "<id>|book" → { s, done: [s], bytes } (the latest checked .omr)
//         "<id>|ev|pre" → [event] (job, pages, meta: before the engine) · "<id>|ev|<s>" → [event] (sheet s,
//         once stored in the book) · "<id>|mxl" → [ArrayBuffer]
// Events are kept as the Reader got them; a preview Blob is stored as { blob: ArrayBuffer, type }.

import { activeDb, activeSpace } from '../space.js?v=97';

export const DB = 'resonate-imports';
export const FLAG = 'resonate.import';           // { id, db, space, name, done, of, page, pages, at } — for nav.js's pill
export const MAX_AGE = 14 * 24 * 3600e3;          // a job left this long is dropped

let dbp = null;
export function openJobs() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'));
    const rq = indexedDB.open(DB, 1);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('jobs')) db.createObjectStore('jobs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('data')) db.createObjectStore('data');
    };
    rq.onsuccess = () => {
      const db = rq.result;
      db.onversionchange = () => { db.close(); dbp = null; };
      db.onclose = () => { dbp = null; };
      resolve(db);
    };
    rq.onerror = () => reject(rq.error);
    rq.onblocked = () => reject(new Error('the imports database is blocked'));
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}

function tx(stores, mode, fn) {
  return openJobs().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let out;
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('aborted'));
    out = fn(t);
  }));
}
const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const range = (id) => IDBKeyRange.bound(`${id}|`, `${id}|￿`);
// (Only a job's events: a cursor over `range` would read its PDF and book too — megabytes — to skip them.)
const evRange = (id) => IDBKeyRange.bound(`${id}|ev|`, `${id}|ev|￿`);

export const newId = () => `j${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function putJob(job, { touch = true } = {}) {
  if (touch || !job.updated) job.updated = Date.now();
  await tx(['jobs'], 'readwrite', (t) => t.objectStore('jobs').put(job));
  return job;
}
export async function getJob(id) {
  let r;
  await tx(['jobs'], 'readonly', (t) => { r = req(t.objectStore('jobs').get(id)); });
  return r;
}
export async function listJobs() {
  let r;
  await tx(['jobs'], 'readonly', (t) => { r = req(t.objectStore('jobs').getAll()); });
  return (await r) || [];
}
export async function putData(id, name, value) {
  await tx(['data'], 'readwrite', (t) => t.objectStore('data').put(value, `${id}|${name}`));
}
export async function getData(id, name) {
  let r;
  await tx(['data'], 'readonly', (t) => { r = req(t.objectStore('data').get(`${id}|${name}`)); });
  return r;
}
// A new job and its PDF, in one transaction: never a PDF without its job (dropOrphans) nor a job
// without its PDF.
export async function createJob(job, pdf) {
  job.updated = Date.now();
  await tx(['jobs', 'data'], 'readwrite', (t) => {
    t.objectStore('data').put(pdf, `${job.id}|pdf`);
    t.objectStore('jobs').put(job);
  });
  return job;
}
export async function deleteJob(id) {
  await tx(['jobs', 'data'], 'readwrite', (t) => {
    t.objectStore('jobs').delete(id);
    t.objectStore('data').delete(range(id));
  });
  clearFlag(id);
}

// A finished page: the book that holds it, the page's events and the job's record, in one
// transaction (the previous book is replaced only together with them).
export async function saveSheet(job, s, book, events) {
  const evs = await storable(events);
  job.updated = Date.now();
  await tx(['jobs', 'data'], 'readwrite', (t) => {
    if (book) t.objectStore('data').put(book, `${job.id}|book`);
    t.objectStore('data').put(evs, `${job.id}|ev|${s}`);
    t.objectStore('jobs').put(job);
  });
}
export async function saveEvents(id, name, events) {
  await putData(id, `ev|${name}`, await storable(events));
}

// Every stored event of a job, in order: the ones before the engine, then each stored sheet's (only
// the sheets in `keep`, when given).
export async function loadEvents(id, keep = null) {
  const out = [];
  await tx(['data'], 'readonly', (t) => {
    const r = t.objectStore('data').openCursor(evRange(id));
    const pre = [], sheets = [];
    r.onsuccess = () => {
      const c = r.result;
      if (!c) { out.push(...pre, ...sheets.sort((a, b) => a.s - b.s).flatMap((x) => x.evs)); return; }
      const m = /\|ev\|(pre|\d+)$/.exec(c.key);
      if (m) {
        if (m[1] === 'pre') pre.push(...c.value);
        else if (!keep || keep.includes(+m[1])) sheets.push({ s: +m[1], evs: c.value });
      }
      c.continue();
    };
  });
  return out.map(revive);
}
export async function dropSheetEvents(id, keep) {
  await tx(['data'], 'readwrite', (t) => {
    const r = t.objectStore('data').openCursor(evRange(id));
    r.onsuccess = () => {
      const c = r.result;
      if (!c) return;
      const m = /\|ev\|(\d+)$/.exec(c.key);
      if (m && !keep.includes(+m[1])) c.delete();
      c.continue();
    };
  });
}

// Data stored under an id no job has (a reload between a new job's PDF and its record, a record that
// couldn't be written): dropped. Keys only — nothing is read.
export async function dropOrphans(ids) {
  const keep = new Set(ids);
  let keys = [];
  await tx(['data'], 'readonly', (t) => { keys = req(t.objectStore('data').getAllKeys()); });
  const gone = [...new Set((await keys).map((k) => String(k).split('|')[0]).filter((id) => !keep.has(id)))];
  if (!gone.length) return 0;
  const jobs = new Set((await listJobs()).map((j) => j.id)); // (a job made meanwhile keeps its data)
  const drop = gone.filter((id) => !jobs.has(id));
  if (drop.length) await tx(['data'], 'readwrite', (t) => { for (const id of drop) t.objectStore('data').delete(range(id)); });
  return drop.length;
}

// Sign out (space.js leave): every job of that songs' database goes with it.
export async function deleteJobsOf(db) {
  if (!db) return 0;
  const jobs = (await listJobs()).filter((j) => j.db === db);
  for (const j of jobs) await deleteJob(j.id);
  return jobs.length;
}

// A song deleted (forget.js): its stored conversions (jobs with replace === songId, this space's) go,
// with their flag — a stuck or kept one would otherwise be resumed and save the song again as a new
// one. A job running in this page is the host's to stop first (its next write would store it again).
export async function deleteJobsFor(songId) {
  if (!songId) return 0;
  const db = activeDb();
  const jobs = (await listJobs()).filter((j) => j.replace === songId && (!j.db || j.db === db));
  for (const j of jobs) await deleteJob(j.id);
  return jobs.length;
}

// Blobs → { blob: ArrayBuffer, type } (iOS Safari's IndexedDB has had Blob troubles), and back.
async function storable(events) {
  const out = [];
  for (const ev of events) {
    if (ev && ev.preview instanceof Blob) out.push({ ...ev, preview: { blob: await ev.preview.arrayBuffer(), type: ev.preview.type } });
    else out.push(ev);
  }
  return out;
}
function revive(ev) {
  if (ev && ev.preview && ev.preview.blob instanceof ArrayBuffer) return { ...ev, preview: new Blob([ev.preview.blob], { type: ev.preview.type || 'image/png' }) };
  return ev;
}

// --- the flag other pages read (nav.js) --------------------------------------------------
// Where the import is, counted as the Reader counts: the PDF page being read (the next one) of the
// PDF's pages; done/of = music pages finished. Written only while the job's space is the one on
// screen (a tab still converting after the account was put away in another tab doesn't write its flag
// into the signed-out space).
export function setFlag(job) {
  if (!(job.db ? job.db === activeDb() : job.space === activeSpace())) return;
  const next = (job.music || []).find((m) => !(job.done || []).includes(m.s) && !(job.skip || []).includes(m.s));
  try {
    localStorage.setItem(FLAG, JSON.stringify({
      id: job.id, db: job.db ?? null, space: job.space, name: job.name, done: (job.done || []).length, of: job.music?.length || 0,
      page: next?.page ?? null, pages: job.of || null, at: Date.now(),
    }));
  } catch {}
}
// The flag of job `id` goes — here and in the copies a space put away (space.js: parked accounts,
// the shelved signed-out state), which would otherwise bring back a pill for an import that's gone.
export function clearFlag(id) {
  try {
    const f = JSON.parse(localStorage.getItem(FLAG) || 'null');
    if (!f || !id || f.id === id) localStorage.removeItem(FLAG);
  } catch {}
  if (!id) return;
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (!k || !(k === 'resonate.shelf' || k.startsWith('resonate.parked.'))) continue;
    try {
      const kept = JSON.parse(localStorage.getItem(k) || 'null');
      if (kept && typeof kept[FLAG] === 'string' && JSON.parse(kept[FLAG])?.id === id) {
        delete kept[FLAG];
        localStorage.setItem(k, JSON.stringify(kept));
      }
    } catch {}
  }
}
export function readFlag() {
  try { return JSON.parse(localStorage.getItem(FLAG) || 'null'); } catch { return null; }
}

// --- the book (.omr: a zip) ----------------------------------------------------------------
// Which sheets a stored book has finished: its book.xml lists each sheet's done steps (PAGE = read)
// and marks failed ones invalid. { ok, done: [s], invalid: [s], build } — ok when sheet `s` (if given)
// is finished or invalid and its folder is in the zip.
export async function checkBook(bytes, s = null) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const entries = zipEntries(u8);
  const book = entries.find((e) => e.name === 'book.xml');
  if (!book) return { ok: false, why: 'no book.xml', done: [], invalid: [] };
  const xml = await unzip(u8, book);
  const done = [], invalid = [];
  for (const m of xml.matchAll(/<sheet\b([^>]*)>([\s\S]*?)<\/sheet>/g)) {
    const n = +(/number="(\d+)"/.exec(m[1]) || [])[1];
    if (!n) continue;
    if (/invalid="true"/.test(m[1])) invalid.push(n);
    else if (/<steps>[^<]*\bPAGE\b/.test(m[2]) && entries.some((e) => e.name === `sheet#${n}/sheet#${n}.xml`)) done.push(n);
  }
  const build = (/software-build="([^"]*)"/.exec(xml) || [])[1] || null;
  const ok = s == null || done.includes(s) || invalid.includes(s);
  return { ok, why: ok ? null : `sheet ${s} isn't in the book`, done, invalid, build };
}

function zipEntries(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return [];
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let k = 0; k < count && p + 46 <= u8.length; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    out.push({
      name: new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen)),
      method: dv.getUint16(p + 10, true), size: dv.getUint32(p + 20, true), offset: dv.getUint32(p + 42, true),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
async function unzip(u8, e) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const start = e.offset + 30 + dv.getUint16(e.offset + 26, true) + dv.getUint16(e.offset + 28, true);
  const data = u8.subarray(start, start + e.size);
  if (e.method === 0) return new TextDecoder().decode(data);
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}
