// Cloud sync after review (v71): the cases the review found, against the live project with the
// approved test user (TEST_EMAIL / TEST_PW). The cloud is emptied (tombstones) first and last.
//   1 the browser clears the songs' database (localStorage kept) → nothing is deleted in the cloud,
//     the songs come back
//   2 the session ends without Sign out → the account's data is parked, the signed-out data is
//     back; signing in again brings the parked data back
//   3 a leftover sign-up marker doesn't make an existing account adopt the signed-out data
//   4 an email link for another account is refused while signed in
//   5 20 rows written together (one updated_at) are all pulled with a page of 3
//   6 a key changed on one device and a tempo on another: both stay
//   7 two devices' take histories are merged
//   8 a take sung here later than the cloud's (which has the newer stamp) stays and goes up
//   9 a write the server drops (the cloud's is newer) is followed by the cloud's
//  10 signing in to another account parks the first; coming back restores it
//  11 sync off, a change, Sign out → warned
const { chromium } = require('playwright');
const fs = require('fs');
const EMAIL = process.env.TEST_EMAIL, PW = process.env.TEST_PW;
const SB = 'https://ltyadhjhnfxdlgsmrcds.supabase.co', KEY = 'sb_publishable_8FEg0aiW9Ir-RrrND8kfQw_IBirLBai';
const URL0 = 'http://localhost:8097/resonate/';
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };

async function token() {
  const t = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PW }) })).json();
  if (!t.access_token) throw new Error('sign-in failed');
  return t;
}
const hdr = (t) => ({ apikey: KEY, Authorization: `Bearer ${t.access_token}`, 'content-type': 'application/json' });
async function cloud(t) {
  return (await fetch(`${SB}/rest/v1/sync_items?deleted=eq.false&select=kind,id,data,modified_at,updated_at`, { headers: hdr(t) })).json();
}
async function upsert(t, rows) {
  const r = await fetch(`${SB}/rest/v1/sync_items?on_conflict=user_id,kind,id`, { method: 'POST', headers: { ...hdr(t), Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(rows) });
  return r.json();
}
async function emptyCloud(t) {
  const live = await cloud(t);
  const now = new Date(Date.now() + 1000).toISOString();
  if (live.length) await upsert(t, live.map((x) => ({ user_id: t.user.id, kind: x.kind, id: x.id, deleted: true, data: null, modified_at: new Date(Math.max(Date.parse(now), Date.parse(x.modified_at) + 1)).toISOString() })));
  const files = await (await fetch(`${SB}/storage/v1/object/list/songs`, { method: 'POST', headers: hdr(t), body: JSON.stringify({ prefix: `${t.user.id}/`, limit: 1000 }) })).json();
  if (Array.isArray(files) && files.length) await fetch(`${SB}/storage/v1/object/songs`, { method: 'DELETE', headers: hdr(t), body: JSON.stringify({ prefixes: files.map((f) => `${t.user.id}/${f.name}`) }) });
}

(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' }, args: ['--autoplay-policy=no-user-gesture-required'] });
  const t0 = await token();
  const uid = t0.user.id;
  await emptyCloud(t0);
  const grace = await (await fetch(URL0 + 'songs/amazing-grace.musicxml')).text();
  const xmlTitled = (title) => grace.replace(/<movement-title>[^<]*<\/movement-title>/, `<movement-title>${title}</movement-title>`).replace('<score-partwise', `<score-partwise data-t="${title}"`);

  const device = async (name) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(`${name}: ${e.message}`));
    p.on('console', (m) => { if (/sync/i.test(m.text()) && !/at /.test(m.text().slice(0, 4))) console.log(`  [${name} ${m.type()}] ${m.text().split('\n')[0].slice(0, 200)}`); });
    p.on('dialog', (d) => { p.lastDialog = d.message(); d.accept(); });
    return { ctx, p, errs };
  };
  const lib = (p, fn, arg = []) => p.evaluate(async ([fn, arg]) => { const m = await import('/resonate/library.js?v=71'); return m[fn](...arg); }, [fn, arg]);
  const titles = async (p) => (await lib(p, 'listSongs')).map((x) => x.title).sort();
  const settle = async (p, ms = 60000) => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      const s = await p.evaluate(() => window.resonateSync?.()).catch(() => null);
      if (s && !s.state.running && s.state.last && !s.state.last.skipped) { await p.waitForTimeout(300); const s2 = await p.evaluate(() => window.resonateSync?.()); if (!s2.state.running) return s2; }
      await p.waitForTimeout(400);
    }
    return p.evaluate(() => window.resonateSync?.());
  };
  const syncNow = (p) => p.evaluate(async () => { const m = await import('/resonate/sync.js?v=71'); return m.syncNow(); });
  const pass = async (p) => { await syncNow(p); return settle(p); };
  const signIn = async (p) => {
    await p.goto(URL0 + 'account.html');
    await p.waitForFunction(() => window.resonateDebug?.().view === 'out', null, { timeout: 15000 });
    await p.fill('#email', EMAIL); await p.fill('#password', PW); await p.click('#signin');
    await p.waitForFunction(() => window.resonateDebug?.().view === 'in', null, { timeout: 20000 });
  };
  const ls = (p, k) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), k);
  const setLs = (p, k, v) => p.evaluate(([k, v]) => { localStorage.setItem(k, JSON.stringify(v)); window.dispatchEvent(new CustomEvent('resonate:data')); }, [k, v]);

  // --- 1: the browser clears the songs' database ---
  const D1 = await device('D1');
  await D1.p.goto(URL0 + 'audiotest.html');
  await lib(D1.p, 'addSong', ['D1 Anon Song', xmlTitled('D1 Anon Song'), {}]);
  await signIn(D1.p);
  await settle(D1.p);
  await D1.p.goto(URL0 + 'sing.html'); await D1.p.waitForTimeout(1200);
  const e1 = await lib(D1.p, 'addSong', ['Evict One', xmlTitled('Evict One'), {}]);
  await lib(D1.p, 'addSong', ['Evict Two', xmlTitled('Evict Two'), {}]);
  await setLs(D1.p, 'resonate.sing.keys', { [e1]: 4 });
  await pass(D1.p);
  let c = await cloud(t0);
  check(c.filter((x) => x.kind === 'song').length === 2, '1: two songs in the cloud');
  await D1.p.goto(URL0 + 'audiotest.html'); // (no page holding the databases open)
  const dbs = await D1.p.evaluate(async () => {
    const s = JSON.parse(localStorage.getItem('resonate.space'));
    const name = s.db[s.active];
    for (const n of [name, `${name}-files`]) await new Promise((r) => { const q = indexedDB.deleteDatabase(n); q.onsuccess = q.onerror = q.onblocked = r; });
    return name;
  });
  await D1.p.goto(URL0 + 'sing.html'); await D1.p.waitForTimeout(1000);
  await settle(D1.p); await pass(D1.p);
  c = await cloud(t0);
  check(c.filter((x) => x.kind === 'song').length === 2 && c.some((x) => x.id === `${e1}|key`), `1: database ${dbs} cleared → nothing deleted in the cloud (${c.filter((x) => x.kind === 'song').length} songs)`);
  check(JSON.stringify(await titles(D1.p)) === JSON.stringify(['Evict One', 'Evict Two']), `1: the songs came back (${await titles(D1.p)})`);
  check((await ls(D1.p, 'resonate.sing.keys'))?.[e1] === 4, '1: and the key');

  // --- 2: the session ends without Sign out ---
  await D1.p.evaluate(() => localStorage.removeItem('resonate.auth'));
  await D1.p.goto(URL0 + 'sing.html'); await D1.p.waitForTimeout(1200);
  const sp = await ls(D1.p, 'resonate.space');
  check(sp.active === 'anon' && !!(await ls(D1.p, `resonate.parked.${uid}`)), `2: the account's data is parked (${JSON.stringify(sp)})`);
  check(JSON.stringify(await titles(D1.p)) === JSON.stringify(['D1 Anon Song']) && !(await ls(D1.p, 'resonate.sing.keys'))?.[e1], `2: the signed-out data is back (${await titles(D1.p)})`);
  let downloads = 0;
  D1.p.on('request', (r) => { if (/storage\/v1\/object\/(authenticated\/)?songs\//.test(r.url()) && r.method() === 'GET') downloads++; });
  await signIn(D1.p);
  check(JSON.stringify(await titles(D1.p)) === JSON.stringify(['Evict One', 'Evict Two']) && (await ls(D1.p, 'resonate.sing.keys'))?.[e1] === 4, `2: signed in again: the parked data is back (${await titles(D1.p)})`);
  await settle(D1.p);
  check(downloads === 0 && !(await ls(D1.p, `resonate.parked.${uid}`)), `2: nothing downloaded again (${downloads}), the parking spot is gone`);

  // --- 3: a leftover sign-up marker ---
  const D2 = await device('D2');
  await D2.p.goto(URL0 + 'audiotest.html');
  await lib(D2.p, 'addSong', ['D2 Anon Song', xmlTitled('D2 Anon Song'), {}]);
  await D2.p.evaluate((email) => localStorage.setItem('resonate.adopt', JSON.stringify({ email: email.toLowerCase(), at: Date.now() - 3600000 })), EMAIL);
  await signIn(D2.p);
  await settle(D2.p);
  check(JSON.stringify(await titles(D2.p)) === JSON.stringify(['Evict One', 'Evict Two']) && !!(await ls(D2.p, 'resonate.shelf')) && !(await ls(D2.p, 'resonate.adopt')), `3: an existing account doesn't take the signed-out songs (${await titles(D2.p)})`);
  c = await cloud(t0);
  check(!c.some((x) => x.kind === 'song' && x.data.title === 'D2 Anon Song'), '3: … nor send them to the cloud');

  // --- 4: a link for another account ---
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const fake = `${b64({ alg: 'ES256' })}.${b64({ sub: '11111111-2222-3333-4444-555555555555', exp: Math.floor(Date.now() / 1000) + 3600 })}.x`;
  await D2.p.goto('about:blank'); // (not a same-page jump to the fragment)
  await D2.p.goto(URL0 + 'account.html#access_token=' + fake + '&refresh_token=nope&expires_in=3600&token_type=bearer&type=recovery');
  await D2.p.waitForTimeout(2500);
  const st4 = await D2.p.evaluate(() => ({ d: window.resonateDebug(), msg: document.getElementById('msg').textContent, hash: location.hash, user: JSON.parse(localStorage.getItem('resonate.auth'))?.user?.email }));
  check(st4.d.view === 'in' && st4.d.email === EMAIL.toLowerCase() && st4.user === EMAIL.toLowerCase() && !st4.hash && /Sign out first/.test(st4.msg), `4: another account's link is refused (${JSON.stringify(st4)})`);

  // --- 5: rows written together, a page of 3 ---
  await D2.p.goto(URL0 + 'audiotest.html');
  await D2.p.evaluate(() => localStorage.setItem('resonate.sync.page', '3'));
  await D2.p.goto(URL0 + 'sing.html'); await settle(D2.p);
  const ties = await upsert(t0, Array.from({ length: 20 }, (_, i) => ({ user_id: uid, kind: 'song_state', id: `tie-song-${String(i).padStart(2, '0')}|key`, data: { v: i - 10 }, deleted: false, modified_at: new Date().toISOString() })));
  check(Array.isArray(ties) && ties.length === 20 && new Set(ties.map((x) => x.updated_at)).size === 1, `5: 20 rows with one updated_at (${Array.isArray(ties) ? new Set(ties.map((x) => x.updated_at)).size : JSON.stringify(ties)})`);
  await pass(D2.p);
  const k5 = await ls(D2.p, 'resonate.sing.keys') || {};
  const got = Array.from({ length: 20 }, (_, i) => k5[`tie-song-${String(i).padStart(2, '0')}`] === i - 10).filter(Boolean).length;
  check(got === 20, `5: all 20 pulled in pages of 3 (${got})`);
  await D2.p.evaluate(() => localStorage.removeItem('resonate.sync.page'));

  // --- 6: a key here, a tempo there ---
  await D1.p.goto(URL0 + 'sing.html'); await settle(D1.p);
  await D2.p.goto(URL0 + 'sing.html'); await settle(D2.p);
  const keys1 = await ls(D1.p, 'resonate.sing.keys') || {};
  await setLs(D1.p, 'resonate.sing.keys', { ...keys1, 'amazing-grace': 3 });
  const rates2 = await ls(D2.p, 'resonate.sing.rates') || {};
  await setLs(D2.p, 'resonate.sing.rates', { ...rates2, 'amazing-grace': 0.8 });
  await pass(D1.p); await pass(D2.p); await pass(D1.p);
  const s6 = [await ls(D1.p, 'resonate.sing.keys'), await ls(D1.p, 'resonate.sing.rates'), await ls(D2.p, 'resonate.sing.keys'), await ls(D2.p, 'resonate.sing.rates')];
  check(s6[0]['amazing-grace'] === 3 && s6[1]['amazing-grace'] === 0.8 && s6[2]['amazing-grace'] === 3 && s6[3]['amazing-grace'] === 0.8, `6: both devices have the key and the tempo (${JSON.stringify(s6.map((x) => x?.['amazing-grace']))})`);

  // --- 7: two histories merged ---
  const entry = (at, pct) => ({ sig: '1|t7|t7', at, pct, whole: true, lines: [pct], rhythm: null });
  const h1 = await ls(D1.p, 'resonate.sing.history') || {};
  await setLs(D1.p, 'resonate.sing.history', { ...h1, 'amazing-grace': [...(h1['amazing-grace'] || []), entry(Date.now() - 5000, 70)] });
  const h2 = await ls(D2.p, 'resonate.sing.history') || {};
  await setLs(D2.p, 'resonate.sing.history', { ...h2, 'amazing-grace': [...(h2['amazing-grace'] || []), entry(Date.now(), 80)] });
  await pass(D1.p); await pass(D2.p); await pass(D1.p);
  const n7 = async (p) => ((await ls(p, 'resonate.sing.history'))?.['amazing-grace'] || []).filter((h) => h.sig === '1|t7|t7').map((h) => h.pct).join(',');
  check(await n7(D1.p) === '70,80' && await n7(D2.p) === '70,80', `7: both takes in both histories (D1 ${await n7(D1.p)}, D2 ${await n7(D2.p)})`);

  // --- 8: a take sung here later than the cloud's ---
  const T2 = Date.now();
  await lib(D2.p, 'putTake', [{ songId: 'amazing-grace', takeId: 'take-here', at: T2, data: { v: 1, at: T2, frames: [], grades: [] } }]);
  await upsert(t0, [{ user_id: uid, kind: 'take', id: 'amazing-grace', data: { takeId: 'take-older', at: T2 - 100000, v: 1, gz: '' }, deleted: false, modified_at: new Date(T2 + 10000).toISOString() }]);
  await pass(D2.p);
  c = await cloud(t0);
  const take8 = await lib(D2.p, 'getTake', ['amazing-grace']);
  check(take8?.takeId === 'take-here' && c.find((x) => x.kind === 'take' && x.id === 'amazing-grace')?.data.takeId === 'take-here', `8: the later take stays here and goes up (${take8?.takeId}, cloud ${c.find((x) => x.kind === 'take')?.data.takeId})`);
  await pass(D1.p);
  check((await lib(D1.p, 'getTake', ['amazing-grace']))?.takeId === 'take-here', '8: … and reaches the other device');

  // --- 9: a write the server drops ---
  await D1.p.goto(URL0 + 'sing.html'); await settle(D1.p);
  let first = true;
  await D1.p.route(/\/rest\/v1\/sync_items\?select=/, async (r) => {
    if (!first || r.request().method() !== 'GET') return r.continue();
    first = false;
    const resp = await r.fetch(); // what the pull sees: from before the other device's change
    await upsert(t0, [{ user_id: uid, kind: 'song_state', id: 'amazing-grace|key', data: { v: -2 }, deleted: false, modified_at: new Date(Date.now() + 60000).toISOString() }]);
    await r.fulfill({ response: resp });
  });
  const keys9 = await ls(D1.p, 'resonate.sing.keys') || {};
  await setLs(D1.p, 'resonate.sing.keys', { ...keys9, 'amazing-grace': 5 });
  await pass(D1.p);
  await D1.p.unroute(/\/rest\/v1\/sync_items\?select=/);
  c = await cloud(t0);
  const k9 = (await ls(D1.p, 'resonate.sing.keys'))?.['amazing-grace'];
  check(!first && k9 === -2 && c.find((x) => x.id === 'amazing-grace|key')?.data.v === -2, `9: the server kept the newer key; this device follows it (${k9}, cloud ${c.find((x) => x.id === 'amazing-grace|key')?.data.v})`);

  // --- 10: another account signs in on top ---
  await D2.p.goto(URL0 + 'audiotest.html');
  const r10 = await D2.p.evaluate(async (uid) => {
    const S = await import('/resonate/space.js?v=71');
    const L = await import('/resonate/library.js?v=71');
    const other = '99999999-8888-7777-6666-555555555555';
    const before = (await L.listSongs()).length;
    await S.enter(other);
    const there = { active: S.activeSpace(), parked: !!localStorage.getItem(`resonate.parked.${uid}`), songs: (await L.listSongs()).length };
    await S.enter(uid);
    const back = { active: S.activeSpace(), songs: (await L.listSongs()).length, parked: !!localStorage.getItem(`resonate.parked.${uid}`) };
    await S.leave(); // (back to signed out: the other account had nothing)
    await S.enter(uid);
    return { before, there, back };
  }, uid);
  check(r10.there.active.startsWith('9999') && r10.there.parked && r10.there.songs === 0 && r10.back.active === uid && r10.back.songs === r10.before && !r10.back.parked, `10: another account parks this one, which comes back whole (${JSON.stringify(r10)})`);

  // --- 12: at 10 songs, a song already in the cloud is pushed again; songs whose file is missing ---
  await D2.p.goto(URL0 + 'sing.html'); await settle(D2.p); await pass(D2.p);
  c = await cloud(t0);
  const room = 10 - c.filter((x) => x.kind === 'song').length;
  const fillers = Array.from({ length: room }, (_, i) => `sfill${i}x${uid.slice(0, 6)}`);
  await upsert(t0, fillers.map((id) => ({ user_id: uid, kind: 'song', id, data: { title: `Filler ${id}`, added: 1, source: null, sha: 'x', xml: { path: `${uid}/${id}.xml.gz`, bytes: 1 }, pdf: null }, deleted: false, modified_at: new Date().toISOString() })));
  await pass(D2.p);
  c = await cloud(t0);
  let m12 = (await D2.p.evaluate(() => window.resonateSync().meta));
  check(c.filter((x) => x.kind === 'song').length === 10 && fillers.every((id) => m12.missing[id]), `12: songs whose file is missing stay in the cloud, marked missing here (${c.filter((x) => x.kind === 'song').length} songs, ${Object.keys(m12.missing).length} missing)`);
  const before12 = c.find((x) => x.kind === 'song' && x.id === e1)?.modified_at;
  await D2.p.evaluate((id) => { const m = JSON.parse(localStorage.getItem('resonate.sync')); m.items[`song:${id}`].h = 'stale'; localStorage.setItem('resonate.sync', JSON.stringify(m)); }, e1);
  await pass(D2.p);
  m12 = (await D2.p.evaluate(() => window.resonateSync().meta));
  c = await cloud(t0);
  const after12 = c.find((x) => x.kind === 'song' && x.id === e1)?.modified_at;
  check(!m12.held[e1] && m12.items[`song:${e1}`]?.up && after12 && after12 !== before12, `12: at 10, a song already in the cloud goes up again (as an update), not held (${before12} → ${after12}, held ${JSON.stringify(m12.held)})`);

  // --- 11: sync off, a change, Sign out → warned ---
  await D1.p.goto(URL0 + 'sing.html'); await settle(D1.p);
  await D1.p.evaluate(() => localStorage.setItem('resonate.sync.off', '1'));
  const keys11 = await ls(D1.p, 'resonate.sing.keys') || {};
  await setLs(D1.p, 'resonate.sing.keys', { ...keys11, 'amazing-grace': 1 });
  await D1.p.goto(URL0 + 'account.html'); await D1.p.waitForFunction(() => window.resonateDebug?.().view === 'in', null, { timeout: 20000 });
  D1.p.lastDialog = null;
  await D1.p.click('#signout'); await D1.p.waitForFunction(() => window.resonateDebug?.().view === 'out', null, { timeout: 30000 });
  check(/^Some changes aren't in the cloud/.test(D1.p.lastDialog || ''), `11: warned before the change is lost ("${D1.p.lastDialog}")`);
  check(JSON.stringify(await titles(D1.p)) === JSON.stringify(['D1 Anon Song']), '11: signed out: the signed-out song is back');
  await D1.p.evaluate(() => localStorage.removeItem('resonate.sync.off'));

  for (const d of [D1, D2]) check(!d.errs.length, 'no page errors ' + d.errs.join('; '));
  await emptyCloud(await token());
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'all ok');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
