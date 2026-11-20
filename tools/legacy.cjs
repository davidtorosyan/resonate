// A device that was signed in before v71 (no "space" yet): its songs are the account's —
// loading a page adopts them and the sync uploads them, a PDF song's PDF too.
const { chromium } = require('playwright');
const SB = 'https://ltyadhjhnfxdlgsmrcds.supabase.co', KEY = 'sb_publishable_8FEg0aiW9Ir-RrrND8kfQw_IBirLBai';
const U = 'http://localhost:8097/resonate/';
(async () => {
  let fails = 0; const check = (ok, m) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${m}`); if (!ok) fails++; };
  const tok = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env.TEST_EMAIL, password: process.env.TEST_PW }) })).json();
  const H = { apikey: KEY, Authorization: `Bearer ${tok.access_token}`, 'content-type': 'application/json' };
  const live = async () => (await fetch(`${SB}/rest/v1/sync_items?deleted=eq.false&select=kind,id,data`, { headers: H })).json();
  const empty = async () => {
    const l = await live(); const now = new Date(Date.now() + 1000).toISOString();
    if (l.length) await fetch(`${SB}/rest/v1/sync_items?on_conflict=user_id,kind,id`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(l.map((x) => ({ user_id: tok.user.id, kind: x.kind, id: x.id, deleted: true, data: null, modified_at: now }))) });
    const files = await (await fetch(`${SB}/storage/v1/object/list/songs`, { method: 'POST', headers: H, body: JSON.stringify({ prefix: `${tok.user.id}/`, limit: 1000 }) })).json();
    if (Array.isArray(files) && files.length) await fetch(`${SB}/storage/v1/object/songs`, { method: 'DELETE', headers: H, body: JSON.stringify({ prefixes: files.map((f) => `${tok.user.id}/${f.name}`) }) });
  };
  await empty();
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
  const p = await (await b.newContext()).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  // Before v71: songs (one from a PDF) and a key, signed in, no space.
  await p.goto(U + 'audiotest.html');
  const grace = await (await fetch(U + 'songs/amazing-grace.musicxml')).text();
  const ids = await p.evaluate(async ([xml, session]) => {
    const L = await import('/resonate/library.js?v=71');
    const a = await L.addSong('Legacy One', xml.replace('<score-partwise', '<score-partwise data-x="1"'), { source: 'file' });
    const pdf = new TextEncoder().encode('%PDF-1.4\n% legacy test\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n').buffer;
    const c = await L.addSong('Legacy PDF Song', xml.replace('<score-partwise', '<score-partwise data-x="2"'), { source: 'pdf', pdf, pdfName: 'legacy.pdf' });
    localStorage.setItem('resonate.sing.keys', JSON.stringify({ [a]: -3 }));
    localStorage.removeItem('resonate.space');
    localStorage.setItem('resonate.auth', JSON.stringify(session));
    return { a, c };
  }, [grace, tok]);
  // Any page with nav.js: the account adopts what's here, the sync uploads it.
  await p.goto(U);
  const t = Date.now();
  let l = [];
  while (Date.now() - t < 60000) { l = await live(); if (l.filter((x) => x.kind === 'song').length >= 2 && l.some((x) => x.kind === 'song_state' && x.id === `${ids.a}|key`)) break; await p.waitForTimeout(1500); }
  const space = await p.evaluate(() => JSON.parse(localStorage.getItem('resonate.space')));
  check(space?.active === tok.user.id && space.db[tok.user.id] === 'resonate', `adopted: the account's data is the one already here (${JSON.stringify(space)})`);
  const songs = l.filter((x) => x.kind === 'song');
  check(songs.length === 2, `both songs in the cloud (${songs.map((x) => x.data.title)})`);
  const pdfSong = songs.find((x) => x.id === ids.c);
  check(pdfSong?.data.pdf?.path === `${tok.user.id}/${ids.c}.pdf` && pdfSong.data.source === 'pdf', `the PDF song's PDF too (${JSON.stringify(pdfSong?.data.pdf)})`);
  const f = await fetch(`${SB}/storage/v1/object/songs/${tok.user.id}/${ids.c}.pdf`, { headers: H });
  check(f.status === 200 && (await f.text()).startsWith('%PDF'), `the PDF is stored (${f.status})`);
  check(l.find((x) => x.kind === 'song_state' && x.id === `${ids.a}|key`)?.data.v === -3, 'and the key');
  check(await p.evaluate(async () => (await (await import('/resonate/library.js?v=71')).listSongs()).length === 2), 'still on the device');
  check(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close();
  await empty();
  console.log(fails ? `${fails} FAILED` : 'all ok'); process.exit(fails ? 1 : 0);
})();
