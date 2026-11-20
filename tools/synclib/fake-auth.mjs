// auth.js for sync.js under synclib.mjs: a Supabase client faked over W.cloud — sync_items rows (last
// writer wins by modified_at, updated_at as the pull cursor, the song limit W.limit, tombstones) and the
// songs bucket's files (W.failUpload(path) makes an upload fail).
import { W, UID } from './world.mjs';
export const savedUser = () => ({ id: UID });
const err = (status, message, extra = {}) => ({ data: null, error: { status, statusCode: String(status), message, ...extra } });
function query(table) {
  const q = { table, filters: [], op: 'select', single: false, gt: null, or: null };
  const api = {
    select() { return api; },
    gt(col, v) { q.gt = v; return api; },
    or(s) { q.or = s; return api; },
    eq(col, v) { q.filters.push([col, v]); return api; },
    order() { return api; },
    limit(n) { q.limit = n; return api; },
    maybeSingle() { q.single = true; return api; },
    upsert(rows) { q.op = 'upsert'; q.rows = JSON.parse(JSON.stringify(rows)); return api; },
    update(patch) { q.op = 'update'; q.patch = JSON.parse(JSON.stringify(patch)); return api; },
    then(res, rej) { return Promise.resolve(run(q)).then(res, rej); },
  };
  return api;
}
const key = (r) => `${r.kind}:${r.id}`;
function write(r, op) {
  const C = W.cloud;
  const old = C.rows.get(key(r));
  if (old && Date.parse(r.modified_at) <= Date.parse(old.modified_at)) return null; // LWW
  const live = [...C.rows.values()].filter((x) => !x.deleted && x.kind === 'song' && key(x) !== key(r)).length;
  if (r.kind === 'song' && !r.deleted && (!old || old.deleted) && live >= W.limit) return 'limit';
  const row = { kind: r.kind, id: r.id, data: r.deleted ? null : r.data, deleted: !!r.deleted, modified_at: r.modified_at, updated_at: new Date(Date.UTC(2026, 10, 20) + ++C.t * 1000).toISOString() };
  C.rows.set(key(r), row);
  C.log.push(['write', key(r), r.deleted ? 'del' : JSON.stringify(r.data)]);
  return row;
}
function run(q) {
  const C = W.cloud;
  if (q.table === 'accounts') return { data: { approved: true }, error: null };
  if (q.op === 'select') {
    let rows = [...C.rows.values()];
    for (const [c, v] of q.filters) rows = rows.filter((r) => String(r[c]) === String(v));
    if (q.single) return { data: rows[0] || null, error: null };
    if (q.or) throw new Error('paging not faked');
    rows = rows.filter((r) => r.updated_at > q.gt).sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1));
    return { data: rows.slice(0, q.limit).map((r) => structuredClone(r)), error: null };
  }
  if (q.op === 'upsert') {
    const out = [];
    for (const r of q.rows) { const w = write(r); if (w === 'limit') return err(400, 'song limit', { hint: 'resonate:limit:song' }); if (w) out.push(w); }
    return { data: out.map((r) => ({ kind: r.kind, id: r.id, deleted: r.deleted })), error: null };
  }
  if (q.op === 'update') {
    const [k, i] = [q.filters.find((f) => f[0] === 'kind')[1], q.filters.find((f) => f[0] === 'id')[1]];
    const old = C.rows.get(`${k}:${i}`);
    if (!old) return { data: [], error: null };
    const w = write({ kind: k, id: i, ...q.patch });
    return { data: w && w !== 'limit' ? [{ kind: k, id: i, deleted: w.deleted }] : [], error: null };
  }
}
const storage = {
  from() {
    return {
      async upload(path, blob) { if (W.failUpload?.(path)) return err(500, 'boom'); W.cloud.files.set(path, new Uint8Array(await blob.arrayBuffer())); W.cloud.log.push(['upload', path]); return { data: { path }, error: null }; },
      async download(path) { const f = W.cloud.files.get(path); return f ? { data: new Blob([f]), error: null } : err(404, 'Object not found'); },
      async remove(paths) { for (const p of paths) W.cloud.files.delete(p); return { data: [], error: null }; },
    };
  },
};
const client = { from: query, storage, auth: { getSession: async () => ({ data: { session: { user: { id: UID } } } }) } };
export const supabase = async () => client;
