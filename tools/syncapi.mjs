// The sync tables' rules, live through the public API as the (approved) test user:
// last writer wins, tombstones, the song limit, the size limit, file folders, anon.
// TEST_EMAIL / TEST_PW. Leaves tombstones under ids starting "t-<run>".
const SB = 'https://ltyadhjhnfxdlgsmrcds.supabase.co', KEY = 'sb_publishable_8FEg0aiW9Ir-RrrND8kfQw_IBirLBai';
const run = Math.random().toString(36).slice(2, 7);
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const tok = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env.TEST_EMAIL, password: process.env.TEST_PW }) })).json();
if (!tok.access_token) throw new Error('sign-in failed ' + JSON.stringify(tok));
const uid = tok.user.id;
const H = { apikey: KEY, Authorization: `Bearer ${tok.access_token}`, 'content-type': 'application/json' };
const upsert = (rows) => fetch(`${SB}/rest/v1/sync_items?on_conflict=user_id,kind,id`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(rows) });
const get = async (kind, id) => (await (await fetch(`${SB}/rest/v1/sync_items?kind=eq.${kind}&id=eq.${encodeURIComponent(id)}&select=data,deleted,modified_at,updated_at`, { headers: H })).json())[0];
const t = (s) => new Date(Date.UTC(2026, 10, 8, 12, 0, s)).toISOString();

// Last writer wins.
const sid = `t-${run}-state`;
let r = await upsert([{ user_id: uid, kind: 'song_state', id: sid, data: { key: 2 }, modified_at: t(10) }]);
check(r.status === 201, `insert (${r.status})`);
await upsert([{ user_id: uid, kind: 'song_state', id: sid, data: { key: -5 }, modified_at: t(5) }]);
let row = await get('song_state', sid);
check(row.data.key === 2, `an older change is dropped (key ${row.data.key})`);
await upsert([{ user_id: uid, kind: 'song_state', id: sid, data: { key: 7 }, modified_at: t(20) }]);
row = await get('song_state', sid);
check(row.data.key === 7, `a newer change wins (key ${row.data.key})`);
const u1 = row.updated_at;
await upsert([{ user_id: uid, kind: 'song_state', id: sid, deleted: true, data: { leak: 1 }, modified_at: t(30) }]);
row = await get('song_state', sid);
check(row.deleted && row.data === null && row.updated_at > u1, 'a delete is a tombstone (data dropped), with a newer updated_at');

// The song limit: count what's there, fill to 10, the next one is refused; a tombstone frees a slot.
const live = await (await fetch(`${SB}/rest/v1/sync_items?kind=eq.song&deleted=eq.false&select=id`, { headers: H })).json();
const free = 10 - live.length;
const ids = Array.from({ length: free }, (_, i) => `t-${run}-song${i}`);
for (const id of ids) await upsert([{ user_id: uid, kind: 'song', id, data: { title: id }, modified_at: t(40) }]);
r = await upsert([{ user_id: uid, kind: 'song', id: `t-${run}-song-extra`, data: { title: 'x' }, modified_at: t(40) }]);
const body = await r.json();
check(r.status >= 400 && body.hint === 'resonate:limit:song', `11th song refused (${r.status} ${body.hint})`);
// A song already there pushed again at 10: as an upsert the live trigger counts it too (the
// optional migration fixes that) — as an update (what sync.js falls back to) it's accepted.
const again = ids[0] || live[0].id;
r = await upsert([{ user_id: uid, kind: 'song', id: again, data: { title: 'renamed' }, deleted: false, modified_at: t(45) }]);
console.log(`     (re-push at 10 as an upsert: ${r.status}${r.status >= 400 ? ' — refused, as expected without the optional migration' : ''})`);
r = await fetch(`${SB}/rest/v1/sync_items?kind=eq.song&id=eq.${encodeURIComponent(again)}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify({ data: { title: 'renamed again' }, deleted: false, modified_at: t(46) }) });
check(r.status === 200 && (await get('song', again))?.data.title === 'renamed again', `a song re-pushed at 10 as an update is accepted (${r.status})`);
await upsert([{ user_id: uid, kind: 'song', id: ids[0] || live[0].id, deleted: true, modified_at: t(50) }]);
r = await upsert([{ user_id: uid, kind: 'song', id: `t-${run}-song-extra`, data: { title: 'x' }, modified_at: t(55) }]);
check(r.status === 201, `after a delete there's room again (${r.status})`);
for (const id of [...ids, `t-${run}-song-extra`]) await upsert([{ user_id: uid, kind: 'song', id, deleted: true, modified_at: t(59) }]);

// A take history row (song_state "<song>|history").
r = await upsert([{ user_id: uid, kind: 'song_state', id: `t-${run}-hist|history`, data: { list: [{ at: 1, sig: 'a' }] }, modified_at: t(58) }]);
check(r.status === 201, `a history row (${r.status})`);
await upsert([{ user_id: uid, kind: 'song_state', id: `t-${run}-hist|history`, deleted: true, modified_at: t(59) }]);

// Size limit (3 MB a document).
r = await upsert([{ user_id: uid, kind: 'take', id: `t-${run}-big`, data: { gz: 'A'.repeat(3_300_000) }, modified_at: t(60) }]);
check(r.status >= 400, `a 3.3 MB document is refused (${r.status})`);

// Files: own folder yes, someone else's no; anon sees nothing.
const up = (path, type = 'application/gzip') => fetch(`${SB}/storage/v1/object/songs/${path}`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${tok.access_token}`, 'content-type': type, 'x-upsert': 'true' }, body: new Uint8Array([31, 139, 8, 0, 1, 2, 3]) });
r = await up(`${uid}/t-${run}.xml.gz`);
check(r.status === 200, `upload to own folder (${r.status})`);
r = await up(`00000000-0000-0000-0000-000000000001/t-${run}.xml.gz`);
check(r.status >= 400, `upload to another folder refused (${r.status})`);
r = await up(`${uid}/t-${run}.txt`, 'text/plain');
check(r.status >= 400, `a non-gzip/pdf file is refused (${r.status})`);
r = await fetch(`${SB}/storage/v1/object/songs/${uid}/t-${run}.xml.gz`, { headers: { apikey: KEY, Authorization: `Bearer ${tok.access_token}` } });
check(r.status === 200 && (await r.arrayBuffer()).byteLength === 7, `download own file (${r.status})`);
r = await fetch(`${SB}/storage/v1/object/songs/${uid}/t-${run}.xml.gz`, { method: 'DELETE', headers: { apikey: KEY, Authorization: `Bearer ${tok.access_token}` } });
check(r.status === 200, `delete own file (${r.status})`);
r = await fetch(`${SB}/rest/v1/sync_items?select=*`, { headers: { apikey: KEY } });
check(r.status === 401 || (await r.json()).length === 0, `anon reads nothing (${r.status})`);
r = await fetch(`${SB}/rest/v1/sync_items?id=eq.${sid}`, { method: 'DELETE', headers: H });
check(r.status >= 400, `rows can't be deleted, only tombstoned (${r.status})`);

console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
