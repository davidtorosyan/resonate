// The songs waiting to be converted (Convert / Convert all / Reconvert all, docs/LIBRARY.md §1), one
// after another by the shell's tray: localStorage 'resonate.convert' = { db, ids: [songId…], total, done }.
//   db    — the songs' database it was written for (space.js activeDb): read only while that's the
//           one on screen (else empty), and in DATA_KEYS, so it's shelved / parked with its space.
//   ids   — ids[0] converts next; the song being converted is the importer's job (job.replace), not here.
//   total / done — the batch so far, for "2/5": enqueue adds to total, the tray counts done; a song
//           taken out before it ran (dropFromQueue) leaves the total. Reset — the key removed — once
//           nothing waits and every song of the batch is counted (ids empty, done ≥ total).
// No DOM and nothing heavy: forget.js and the shell import it. Writes don't check whose data the
// page shows — the caller does (nav.js spaceChanged), as for every DATA_KEYS write.
import { activeDb } from '../space.js?v=89';

export const QUEUE = 'resonate.convert';

const empty = () => ({ db: activeDb(), ids: [], total: 0, done: 0 });
const count = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

export function readQueue() {
  let q = null;
  try { q = JSON.parse(localStorage.getItem(QUEUE) || 'null'); } catch {}
  if (!q || typeof q !== 'object' || q.db !== activeDb()) return empty();
  const ids = Array.isArray(q.ids) ? [...new Set(q.ids.filter((id) => typeof id === 'string' && id))] : [];
  const done = count(q.done);
  return { db: q.db, ids, total: Math.max(count(q.total), done + ids.length), done };
}

// Stores q (its db stamped now) and returns it as stored — the empty queue once the batch is over.
export function writeQueue(q) {
  const ids = Array.isArray(q?.ids) ? [...new Set(q.ids.filter((id) => typeof id === 'string' && id))] : [];
  const done = count(q?.done);
  const out = { db: activeDb(), ids, total: Math.max(count(q?.total), done + ids.length), done };
  try {
    if (!ids.length && done >= out.total) { localStorage.removeItem(QUEUE); return empty(); }
    localStorage.setItem(QUEUE, JSON.stringify(out));
  } catch {}
  return out;
}

// Appended in the order given; ids already waiting stay where they are (not counted again).
export function enqueue(ids) {
  const q = readQueue();
  const add = [...new Set((ids || []).filter((id) => typeof id === 'string' && id && !q.ids.includes(id)))];
  if (!add.length) return q;
  return writeQueue({ ...q, ids: [...q.ids, ...add], total: q.total + add.length });
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
