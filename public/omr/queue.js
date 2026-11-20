// The songs waiting to be converted (Convert / Convert all / Reconvert all, docs/LIBRARY.md §1), one
// after another by the shell's tray: localStorage 'resonate.convert' = { db, ids: [songId…], total, done,
// ok, force: [songId…] }.
//   db    — the songs' database it was written for (space.js activeDb): read only while that's the
//           one on screen (else empty), and in DATA_KEYS, so it's shelved / parked with its space.
//   ids   — ids[0] converts next; the song being converted is the importer's job (job.replace), not here.
//   total / done — the batch so far, for "2/5": enqueue adds to total, the tray counts done; a song
//           taken out before it ran (dropFromQueue) leaves the total. Reset — the key removed — once
//           nothing waits and every song of the batch is counted (ids empty, done ≥ total).
//   ok    — how many of the done ones converted: the batch's "✓ N converted" — kept here, not in the
//           page, so a reload mid-batch (iOS reloads a tab CheerpJ made heavy) still counts the songs before.
//   force — ids asked for one by one (⋯ Convert / Reconvert, the Score's ⟳): converted even when this
//           engine read them already (a Reconvert all passes those by) — kept across a reload too. Only
//           ids still waiting: a song leaves it as it leaves ids.
//   at    — when it was last written: counters with nothing waiting and no import kept are left over
//           only once nobody has touched them for a while (another tab may have just taken a song and
//           not stored its job yet).
// No DOM and nothing heavy: forget.js and the shell import it. Writes don't check whose data the
// page shows — the caller does (nav.js spaceChanged), as for every DATA_KEYS write.
import { activeDb } from '../space.js?v=92';

export const QUEUE = 'resonate.convert';

const empty = () => ({ db: activeDb(), ids: [], total: 0, done: 0, ok: 0, force: [], at: 0 });
const count = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
const idList = (a) => (Array.isArray(a) ? [...new Set(a.filter((id) => typeof id === 'string' && id))] : []);
// (the fields from what was stored or given: counts whole and consistent, force within ids)
function norm(q) {
  const ids = idList(q?.ids);
  const done = count(q?.done);
  return {
    ids, total: Math.max(count(q?.total), done + ids.length), done,
    ok: Math.min(count(q?.ok), done), force: idList(q?.force).filter((id) => ids.includes(id)),
  };
}

export function readQueue() {
  let q = null;
  try { q = JSON.parse(localStorage.getItem(QUEUE) || 'null'); } catch {}
  if (!q || typeof q !== 'object' || q.db !== activeDb()) return empty();
  return { db: q.db, ...norm(q), at: Number.isFinite(q.at) ? q.at : 0 };
}

// Stores q (its db stamped now) and returns it as stored — the empty queue once the batch is over.
export function writeQueue(q) {
  const out = { db: activeDb(), ...norm(q), at: Date.now() };
  const { ids, done } = out;
  try {
    if (!ids.length && done >= out.total) { localStorage.removeItem(QUEUE); return empty(); }
    localStorage.setItem(QUEUE, JSON.stringify(out));
  } catch {}
  return out;
}

// Appended in the order given; ids already waiting stay where they are (not counted again).
// force: asked for one by one — converted even when this engine read them already (those already
// waiting become forced too).
export function enqueue(ids, { force = false } = {}) {
  const q = readQueue();
  const list = idList(ids);
  const add = list.filter((id) => !q.ids.includes(id));
  if (!add.length && (!force || list.every((id) => q.force.includes(id)))) return q;
  return writeQueue({ ...q, ids: [...q.ids, ...add], total: q.total + add.length, force: force ? [...q.force, ...list] : q.force });
}

// A song no longer to convert (deleted, or the tray passed it by): out of the queue and the batch's
// total. The song being converted isn't in the queue — nothing changes for it here. true: it was there.
export function dropFromQueue(id) {
  const q = readQueue();
  if (!q.ids.includes(id)) return false;
  writeQueue({ ...q, ids: q.ids.filter((x) => x !== id), total: Math.max(q.done, q.total - 1) });
  return true;
}

export function clearQueue() {
  try { localStorage.removeItem(QUEUE); } catch {}
}
