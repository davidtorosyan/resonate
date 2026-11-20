// Cloud sync after the second review (v71), live, the approved test user (TEST_EMAIL / TEST_PW).
//   1 a tapped timing with untapped (null) stretches arrives intact and doesn't echo back
//   2 a history newer here still takes in the cloud's entries before it goes up
//   3 the songs' database goes away mid-pass (deleted, reopening fails) → nothing deleted in the cloud
//   4 a song's original PDF reaches the other device; a PDF attached later goes up too
//   5 a tab left open on the Sing page follows a sign-out made in another tab (reloads, shows the
//     signed-out data; nothing written into it meanwhile)
//   6 Sign out warns about the take recordings that live only on this device
//   7 tokens in a link's query string are never taken; a token link for another account on
//     another page is handed to the account page and refused there
//   8 spaces: after an adopted account is parked, the signed-out data never uses its database;
//     leave(uid) for an account that isn't the active one parks the active one instead
const { chromium } = require('playwright');
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
const cloud = async (t) => (await fetch(`${SB}/rest/v1/sync_items?deleted=eq.false&select=kind,id,data,modified_at,updated_at`, { headers: hdr(t) })).json();
const upsert = async (t, rows) => (await fetch(`${SB}/rest/v1/sync_items?on_conflict=user_id,kind,id`, { method: 'POST', headers: { ...hdr(t), Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(rows) })).json();
async function emptyCloud(t) {
  const live = await cloud(t);
  const now = Date.now() + 1000;
  if (live.length) await upsert(t, live.map((x) => ({ user_id: t.user.id, kind: x.kind, id: x.id, deleted: true, data: null, modified_at: new Date(Math.max(now, Date.parse(x.modified_at) + 1)).toISOString() })));
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
    p.on('console', (m) => { const t = m.text(); if (/sync/i.test(t) && !/unknown setting|not a song id/.test(t)) console.log(`  [${name} ${m.type()}] ${t.split('\n')[0].slice(0, 200)}`); });
    p.on('dialog', (d) => { p.lastDialog = d.message(); d.accept(); });
    return { ctx, p, errs };
  };
  const lib = (p, fn, arg = []) => p.evaluate(async ([fn, arg]) => { const m = await import('/resonate/library.js?v=71'); return m[fn](...arg); }, [fn, arg]);
  const settle = async (p, ms = 60000) => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      const s = await p.evaluate(() => window.resonateSync?.()).catch(() => null);
      if (s && !s.state.running && s.state.last && !s.state.last.skipped) { await p.waitForTimeout(300); const s2 = await p.evaluate(() => window.resonateSync?.()).catch(() => null); if (s2 && !s2.state.running) return s2; }
      await p.waitForTimeout(400);
    }
    return p.evaluate(() => window.resonateSync?.()).catch(() => null);
  };
  const pass = async (p) => { await p.evaluate(async () => (await import('/resonate/sync.js?v=71')).syncNow()); return settle(p); };
  const signIn = async (p) => {
    await p.goto(URL0 + 'account.html');
    await p.waitForFunction(() => window.resonateDebug?.().view === 'out', null, { timeout: 15000 });
    await p.fill('#email', EMAIL); await p.fill('#password', PW); await p.click('#signin');
    await p.waitForFunction(() => window.resonateDebug?.().view === 'in', null, { timeout: 20000 });
  };
  const ls = (p, k) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), k);
  const setLs = (p, k, v) => p.evaluate(([k, v]) => { localStorage.setItem(k, JSON.stringify(v)); window.dispatchEvent(new CustomEvent('resonate:data')); }, [k, v]);
  const meta = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('resonate.sync')));

  const A = await device('A'), B = await device('B');
  await signIn(A.p); await settle(A.p);
  await signIn(B.p); await settle(B.p);
  await A.p.goto(URL0 + 'sing.html'); await settle(A.p);
  await B.p.goto(URL0 + 'sing.html'); await settle(B.p);

  // --- 1: a tapped timing with null stretches ---
  const tmap = { sig: '41', segs: [[0, 0.62], [4, 0.66], [8, null], [20, 0.7], [24, null]], use: true, bpm: null };
  await setLs(A.p, 'resonate.sing.timing', { 'amazing-grace': tmap });
  await pass(A.p); await pass(B.p); await pass(B.p); await pass(A.p);
  const tA = (await ls(A.p, 'resonate.sing.timing'))?.['amazing-grace'], tB = (await ls(B.p, 'resonate.sing.timing'))?.['amazing-grace'];
  const mB = (await meta(B.p)).items['song_state:amazing-grace|timing'];
  check(JSON.stringify(tB) === JSON.stringify(tmap) && JSON.stringify(tA) === JSON.stringify(tmap), `1: the timing arrives intact and stays so on both (${JSON.stringify(tB)})`);
  const c1 = await cloud(t0);
  const row1 = c1.find((x) => x.id === 'amazing-grace|timing');
  const sorted = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x)); // (jsonb reorders keys)
  const mA = (await meta(A.p)).items['song_state:amazing-grace|timing'];
  check(mB?.up && mA?.up && sorted(row1?.data.v) === sorted(tmap) && Date.parse(row1.modified_at) === mA.m, `1: nothing echoed back (B up ${mB?.up}, cloud as A sent it: ${sorted(row1?.data.v) === sorted(tmap)}, still A's stamp: ${Date.parse(row1?.modified_at) === mA?.m})`);

  // --- 2: a history newer here takes in the cloud's entries ---
  const e = (at, pct) => ({ sig: '1|t2|t2', at, pct, whole: true, lines: [pct], rhythm: null });
  await upsert(t0, [{ user_id: uid, kind: 'song_state', id: 'amazing-grace|history', data: { list: [e(1000, 61)] }, deleted: false, modified_at: new Date(Date.now() - 500).toISOString() }]); // (after the clean-up's tombstone, before B's change)
  // B's own, newer — noted before the pull sees the cloud's
  await setLs(B.p, 'resonate.sing.history', { 'amazing-grace': [e(2000, 72)] });
  await B.p.evaluate(async () => { const m = JSON.parse(localStorage.getItem('resonate.sync')); m.items['song_state:amazing-grace|history'] = { h: 'old', m: Date.now() - 120000, up: true }; localStorage.setItem('resonate.sync', JSON.stringify(m)); });
  await pass(B.p);
  const hB = ((await ls(B.p, 'resonate.sing.history'))?.['amazing-grace'] || []).map((x) => x.pct).join(',');
  const hC = ((await cloud(t0)).find((x) => x.id === 'amazing-grace|history')?.data.list || []).map((x) => x.pct).join(',');
  check(hB === '61,72' && hC === '61,72', `2: both entries kept, here and in the cloud (here ${hB}, cloud ${hC})`);

  // --- 3: the songs' database goes away mid-pass ---
  const s3 = await lib(A.p, 'addSong', ['Lose One', xmlTitled('Lose One'), {}]);
  await lib(A.p, 'addSong', ['Lose Two', xmlTitled('Lose Two'), {}]);
  await pass(A.p);
  let c3 = await cloud(t0);
  check(c3.filter((x) => x.kind === 'song').length === 2, '3: two songs in the cloud');
  let broke = false;
  await A.p.route(/\/rest\/v1\/sync_items\?select=/, async (r) => {
    if (broke || r.request().method() !== 'GET') return r.continue();
    broke = true;
    await A.p.evaluate(async () => {
      const s = JSON.parse(localStorage.getItem('resonate.space')); const name = s.db[s.active];
      const open = indexedDB.open.bind(indexedDB);
      indexedDB.open = () => { const req = {}; setTimeout(() => req.onerror?.({ target: req })); return req; }; // the server connection is lost
      await new Promise((res) => { const q = indexedDB.deleteDatabase(name); q.onsuccess = q.onerror = q.onblocked = res; });
      window.__open = open;
    });
    await r.continue();
  });
  await A.p.evaluate(async () => (await import('/resonate/sync.js?v=71')).syncNow()); await A.p.waitForTimeout(4000);
  await A.p.unroute(/\/rest\/v1\/sync_items\?select=/);
  c3 = await cloud(t0);
  check(broke && c3.filter((x) => x.kind === 'song').length === 2 && c3.some((x) => x.id === 'amazing-grace|timing'), `3: the database lost mid-pass → nothing deleted in the cloud (${c3.filter((x) => x.kind === 'song').length} songs)`);
  await A.p.goto(URL0 + 'sing.html'); await settle(A.p); await pass(A.p);
  check((await lib(A.p, 'listSongs')).length === 2, '3: after a reload the songs are back from the cloud');

  // --- 4: PDFs ---
  const pdfBytes = (tag) => Array.from(new TextEncoder().encode(`%PDF-1.4\n% ${tag}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`));
  const s4 = await A.p.evaluate(async ([xml, bytes]) => (await import('/resonate/library.js?v=71')).addSong('PDF Song', xml, { source: 'pdf', pdf: new Uint8Array(bytes).buffer, pdfName: 'a.pdf' }), [xmlTitled('PDF Song'), pdfBytes('four')]);
  await pass(A.p); await pass(B.p);
  const pB = await B.p.evaluate(async (id) => { const r = await (await import('/resonate/library.js?v=71')).getPdf(id); return r ? { name: r.name, text: new TextDecoder().decode(r.pdf).slice(0, 8) } : null; }, s4);
  check(pB?.name === 'a.pdf' && pB.text.startsWith('%PDF'), `4: the PDF reached the other device (${JSON.stringify(pB)})`);
  // attached later to a song already in the cloud (the same song saved again from PDF → Song)
  await A.p.evaluate(async ([xml, bytes]) => (await import('/resonate/library.js?v=71')).addSong('Lose One', xml, { source: 'pdf', pdf: new Uint8Array(bytes).buffer, pdfName: 'later.pdf' }), [xmlTitled('Lose One'), pdfBytes('later')]);
  await pass(A.p); await pass(B.p);
  const c4 = await cloud(t0);
  const later = await B.p.evaluate(async (id) => !!(await (await import('/resonate/library.js?v=71')).getPdf(id)), s3);
  check(c4.find((x) => x.kind === 'song' && x.id === s3)?.data.pdf?.name === 'later.pdf' && later, '4: a PDF attached later goes up and arrives');

  // --- 5: a stale Sing tab follows a sign-out made in another tab ---
  const A2 = await A.ctx.newPage(); A2.on('dialog', (d) => d.accept());
  await A2.goto(URL0 + 'account.html'); await A2.waitForFunction(() => window.resonateDebug?.().view === 'in', null, { timeout: 20000 });
  let reloaded = false;
  A.p.on('framenavigated', (f) => { if (f === A.p.mainFrame()) reloaded = true; });
  await A2.click('#signout'); await A2.waitForFunction(() => window.resonateDebug?.().view === 'out', null, { timeout: 60000 });
  await A.p.waitForTimeout(2500);
  const after5 = await A.p.evaluate(async () => ({ space: JSON.parse(localStorage.getItem('resonate.space')).active, songs: (await (await import('/resonate/library.js?v=71')).listSongs()).length, keys: localStorage.getItem('resonate.sing.timing') }));
  check(reloaded && after5.space === 'anon' && after5.songs === 0 && !after5.keys, `5: the Sing tab reloaded and shows the signed-out data (${JSON.stringify(after5)})`);
  await A2.close();

  // --- 6: Sign out warns about recordings kept only here ---
  await signIn(A.p); await settle(A.p);
  await A.p.goto(URL0 + 'sing.html'); await settle(A.p); await pass(A.p);
  await A.p.evaluate(async () => { const L = await import('/resonate/library.js?v=71'); await L.putTake({ songId: 'amazing-grace', takeId: 'rec6', at: Date.now(), data: { v: 1, at: Date.now(), frames: [], grades: [] }, voice: { pcm: new Int16Array(800), sampleRate: 24000, start: 0, gain: 1 } }); });
  await pass(A.p);
  await A.p.goto(URL0 + 'account.html'); await A.p.waitForFunction(() => window.resonateDebug?.().view === 'in', null, { timeout: 20000 });
  A.p.lastDialog = null;
  await A.p.click('#signout'); await A.p.waitForFunction(() => window.resonateDebug?.().view === 'out', null, { timeout: 60000 });
  check(/^The recording of your last take isn't in the cloud and will be removed from this device\. Sign out\?$/.test(A.p.lastDialog || ''), `6: warned about the recording ("${A.p.lastDialog}")`);

  // --- 7: links ---
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const other = `${b64({ alg: 'ES256' })}.${b64({ sub: '11111111-2222-3333-4444-555555555555', exp: Math.floor(Date.now() / 1000) + 3600 })}.x`;
  await B.p.goto('about:blank');
  await B.p.goto(URL0 + `account.html?access_token=${other}&refresh_token=nope&expires_in=3600&token_type=bearer&type=signup`);
  await B.p.waitForTimeout(2500);
  const s7 = await B.p.evaluate(() => ({ view: window.resonateDebug().view, user: JSON.parse(localStorage.getItem('resonate.auth'))?.user?.email, search: location.search }));
  check(s7.view === 'in' && s7.user === EMAIL.toLowerCase() && !s7.search, `7: query-string tokens not taken, stripped (${JSON.stringify(s7)})`);
  await B.p.goto('about:blank');
  await B.p.goto(URL0 + `sing.html#access_token=${other}&refresh_token=nope&expires_in=3600&token_type=bearer&type=recovery`);
  await B.p.waitForURL(/account\.html/, { timeout: 10000 }).catch(() => {});
  await B.p.waitForTimeout(2500);
  const s7b = await B.p.evaluate(() => ({ path: location.pathname, msg: document.getElementById('msg')?.textContent, user: JSON.parse(localStorage.getItem('resonate.auth'))?.user?.email, space: JSON.parse(localStorage.getItem('resonate.space')).active }));
  check(/account\.html$/.test(s7b.path) && /Sign out first/.test(s7b.msg || '') && s7b.user === EMAIL.toLowerCase() && s7b.space === uid, `7: another account's link on the Sing page is handed on and refused (${JSON.stringify(s7b)})`);

  // --- 8: spaces ---
  const C = await device('C');
  await C.p.goto(URL0 + 'audiotest.html');
  const r8 = await C.p.evaluate(async () => {
    const S = await import('/resonate/space.js?v=71');
    const out = {};
    S.ensureSpace(null);
    S.adopt('aaaaaaaa-0000-0000-0000-000000000001');             // sign up A: takes "resonate"
    const aDb = S.dbName();
    S.park();                                                    // A's session ends
    out.anonAfterPark = S.dbName();
    S.adopt('bbbbbbbb-0000-0000-0000-000000000002');             // sign up B
    out.bDb = S.dbName();
    await S.leave('bbbbbbbb-0000-0000-0000-000000000002');       // B signs out
    out.anonAfterLeave = S.dbName();
    out.aDb = aDb;
    // leave(uid) for an account that isn't the active one: the active one is parked, not removed
    await S.enter('cccccccc-0000-0000-0000-000000000003');
    localStorage.setItem('resonate.sing.keys', JSON.stringify({ x: 3 }));
    await S.leave('dddddddd-0000-0000-0000-000000000004');
    out.cParked = JSON.parse(localStorage.getItem('resonate.parked.cccccccc-0000-0000-0000-000000000003') || 'null')?.['resonate.sing.keys'] || null;
    out.active = S.activeSpace();
    return out;
  });
  check(r8.aDb === 'resonate' && r8.anonAfterPark !== r8.aDb && r8.bDb !== r8.aDb && r8.anonAfterLeave !== r8.aDb && r8.anonAfterLeave !== r8.bDb, `8: the signed-out data never uses a parked or departed account's database (${JSON.stringify(r8)})`);
  check(r8.cParked === '{"x":3}' && r8.active === 'anon', '8: leave() for another account parks the active one');

  // --- 9: IndexedDB that throws at once → the page works from memory (signed out) ---
  const D = await device('D');
  await D.ctx.addInitScript(() => { try { Object.defineProperty(window, 'indexedDB', { value: { open() { throw new DOMException('The operation is insecure.', 'SecurityError'); }, deleteDatabase() { throw new DOMException('insecure', 'SecurityError'); } } }); } catch {} });
  await D.p.goto(URL0 + 'sing.html'); await D.p.waitForTimeout(2500);
  const r9 = await D.p.evaluate(async () => { const L = await import('/resonate/library.js?v=71'); const id = await L.addSong('Mem', '<score-partwise/>'); return { list: (await L.listSongs()).map((x) => x.title), persistent: await L.persistent(), id: !!id, song: window.resonateDebug?.().songId || document.getElementById('song-select')?.value }; });
  check(r9.list.includes('Mem') && r9.persistent === false && r9.song === 'amazing-grace', `9: storage that throws at once → songs in memory, the Sing page works (${JSON.stringify(r9)})`);
  check(!D.errs.length, 'no page errors ' + D.errs.join('; '));

  // --- 10: two Account tabs, Sign out in one: the other doesn't sign back in to the account ---
  await B.p.goto(URL0 + 'account.html'); await B.p.waitForFunction(() => window.resonateDebug?.().view === 'in', null, { timeout: 20000 }); await settle(B.p); // (B is signed in)
  const B2 = await B.ctx.newPage();
  await B2.goto(URL0 + 'account.html'); await B2.waitForFunction(() => window.resonateDebug?.().view === 'in', null, { timeout: 20000 });
  B.p.lastDialog = null;
  await B.p.click('#signout'); await B.p.waitForFunction(() => window.resonateDebug?.().view === 'out', null, { timeout: 60000 });
  await B2.waitForTimeout(4000);
  const r10 = await B2.evaluate(() => ({ view: window.resonateDebug?.().view, space: JSON.parse(localStorage.getItem('resonate.space')), parked: Object.keys(localStorage).filter((k) => k.startsWith('resonate.parked.')), auth: !!localStorage.getItem('resonate.auth') }));
  check(r10.view === 'out' && r10.space.active === 'anon' && !r10.space.db[uid] && !r10.parked.length && !r10.auth, `10: the other tab ends signed out, nothing of the account left (${JSON.stringify(r10)})`);
  await B2.close();

  for (const d of [A, B, C]) check(!d.errs.length, 'no page errors ' + d.errs.join('; '));
  await emptyCloud(await token());
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'all ok');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
