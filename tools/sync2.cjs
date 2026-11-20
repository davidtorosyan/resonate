// Cloud sync end to end against the live project, three "devices" (browser contexts), the
// approved test user (TEST_EMAIL / TEST_PW). The cloud is emptied (tombstones) first and last.
//  A: signs in (its signed-out state is shelved — empty here), adds 2 songs, sets a key and a
//     tempo, sings a take, makes a voice profile → all in the cloud.
//  B: has its own signed-out song; signs in → it's shelved, A's things arrive (the take too,
//     without the recording); changes a tempo and removes a song → A follows; signs out → its
//     own song is back.
//  C: 12 songs signed out, creates the account (answered with the test user's session) → they
//     go up until the cloud holds 10; signing out warns that the rest aren't in the cloud.
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
async function cloud(t) {
  const r = await fetch(`${SB}/rest/v1/sync_items?deleted=eq.false&select=kind,id,data,modified_at`, { headers: { apikey: KEY, Authorization: `Bearer ${t.access_token}` } });
  return r.json();
}
async function emptyCloud(t) {
  const H = { apikey: KEY, Authorization: `Bearer ${t.access_token}`, 'content-type': 'application/json' };
  const live = await cloud(t);
  const now = new Date(Date.now() + 1000).toISOString();
  if (live.length) await fetch(`${SB}/rest/v1/sync_items?on_conflict=user_id,kind,id`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(live.map((x) => ({ user_id: t.user.id, kind: x.kind, id: x.id, deleted: true, data: null, modified_at: now }))) });
  const files = await (await fetch(`${SB}/storage/v1/object/list/songs`, { method: 'POST', headers: H, body: JSON.stringify({ prefix: `${t.user.id}/`, limit: 1000 }) })).json();
  if (Array.isArray(files) && files.length) await fetch(`${SB}/storage/v1/object/songs`, { method: 'DELETE', headers: H, body: JSON.stringify({ prefixes: files.map((f) => `${t.user.id}/${f.name}`) }) });
}

(async () => {
  const src = fs.readFileSync('/home/user/tools/review.cjs', 'utf8');
  const singer = eval(src.slice(src.indexOf('await p.addInitScript(() => {') + 'await p.addInitScript('.length, src.indexOf('  });\n  await p.goto') + 3));
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' }, args: ['--autoplay-policy=no-user-gesture-required'] });
  const t0 = await token();
  await emptyCloud(t0);
  const grace = await (await fetch(URL0 + 'songs/amazing-grace.musicxml')).text();
  const xmlTitled = (title) => grace.replace(/<movement-title>[^<]*<\/movement-title>/, `<movement-title>${title}</movement-title>`).replace('<score-partwise', `<score-partwise data-t="${title}"`);

  const device = async (name) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(singer);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(`${name}: ${e.message}`));
    p.on('console', (m) => { if (/sync/i.test(m.text())) console.log(`  [${name} ${m.type()}] ${m.text().slice(0, 300)}`); });
    p.on('dialog', (d) => { p.lastDialog = d.message(); d.accept(); });
    return { ctx, p, errs };
  };
  const lib = (p, fn, arg) => p.evaluate(async ([fn, arg]) => { const m = await import('/resonate/library.js?v=71'); return m[fn](...arg); }, [fn, arg]);
  const settle = async (p, ms = 60000) => { // the page's sync is idle with a finished pass
    const t = Date.now();
    while (Date.now() - t < ms) {
      const s = await p.evaluate(() => window.resonateSync?.()).catch(() => null);
      if (s && !s.state.running && s.state.last && !s.state.last.skipped) { await p.waitForTimeout(300); const s2 = await p.evaluate(() => window.resonateSync?.()); if (!s2.state.running) return s2; }
      await p.waitForTimeout(400);
    }
    return p.evaluate(() => window.resonateSync?.());
  };
  const syncNow = (p) => p.evaluate(async () => { const m = await import('/resonate/sync.js?v=71'); return m.syncNow(); });
  const signIn = async (p) => {
    await p.goto(URL0 + 'account.html');
    await p.waitForFunction(() => window.resonateDebug?.().view === 'out', null, { timeout: 15000 });
    await p.fill('#email', EMAIL); await p.fill('#password', PW); await p.click('#signin');
    await p.waitForFunction(() => window.resonateDebug?.().view === 'in', null, { timeout: 20000 });
  };

  // --- A ---
  const A = await device('A');
  await signIn(A.p);
  await settle(A.p);
  await A.p.goto(URL0 + 'sing.html'); await A.p.waitForTimeout(1500);
  const s1 = await lib(A.p, 'addSong', ['Sync Song One', xmlTitled('Sync Song One'), { source: 'file' }]);
  const s2 = await lib(A.p, 'addSong', ['Sync Song Two', xmlTitled('Sync Song Two'), { source: 'file' }]);
  await A.p.reload(); await A.p.waitForTimeout(1500); // (the page lists them)
  // a key for song one, a tempo for the sample (through the page's own menus)
  await A.p.evaluate((id) => { const s = document.getElementById('song-select'); s.value = id; s.dispatchEvent(new Event('change')); }, s1); await A.p.waitForTimeout(1200);
  await A.p.evaluate(() => { const k = document.getElementById('key-select'); k.value = '2'; k.dispatchEvent(new Event('change')); }); await A.p.waitForTimeout(500);
  await A.p.evaluate(() => { const s = document.getElementById('song-select'); s.value = 'amazing-grace'; s.dispatchEvent(new Event('change')); }); await A.p.waitForTimeout(1200);
  await A.p.evaluate(() => { const t = document.getElementById('tempo-select'); t.value = 'r:0.9'; t.dispatchEvent(new Event('change')); }); await A.p.waitForTimeout(500);
  // a take on the sample (simulated singer, stopped after 9 s)
  await A.p.click('#sing'); await A.p.waitForTimeout(9000); await A.p.click('#sing'); await A.p.waitForTimeout(2500);
  const takeA = await lib(A.p, 'getTake', ['amazing-grace', { voice: true }]);
  check(!!takeA?.takeId && !!takeA.voice?.pcm, `A: the take is kept (with its recording here)`);
  // a voice profile
  await A.p.goto(URL0 + 'voice.html'); await A.p.waitForTimeout(800);
  await A.p.evaluate(async () => { const m = await import('/resonate/profiles.js?v=71'); m.createProfile('Tester'); m.updateProfile(m.activeProfile().id, { range: { low: 48, high: 67, comfortLow: 50, comfortHigh: 64, at: 1 }, vol: { floor: -40, ceiling: -10 } }); });
  await A.p.waitForTimeout(2500); await syncNow(A.p); await settle(A.p);
  let c = await cloud(t0);
  const has = (k, id) => c.find((x) => x.kind === k && x.id === id);
  check(has('song', s1) && has('song', s2), `cloud: both songs (${c.filter((x) => x.kind === 'song').length})`);
  check(has('song_state', `${s1}|key`)?.data.v === 2, `cloud: song one's key (${JSON.stringify(has('song_state', `${s1}|key`)?.data)})`);
  check(has('song_state', 'amazing-grace|rate')?.data.v === 0.9, 'cloud: the sample\'s tempo');
  check(has('song_state', 'amazing-grace|history')?.data.list?.length >= 1, 'cloud: the sample\'s take history');
  check(has('take', 'amazing-grace')?.data.takeId === takeA.takeId && !!has('take', 'amazing-grace')?.data.gz, 'cloud: the take (compressed, no recording)');
  const prof = c.find((x) => x.kind === 'profile');
  check(prof?.data.name === 'Tester' && prof.data.range?.comfortLow === 50 && !('vol' in prof.data), 'cloud: the voice profile, without the volume calibration');

  // --- B ---
  const B = await device('B');
  await B.p.goto(URL0 + 'sing.html'); await B.p.waitForTimeout(1200);
  const bLocal = await lib(B.p, 'addSong', ['B Local Song', xmlTitled('B Local Song'), {}]);
  await signIn(B.p);
  await settle(B.p);
  let titles = (await lib(B.p, 'listSongs', [])).map((x) => x.title).sort();
  check(JSON.stringify(titles) === JSON.stringify(['Sync Song One', 'Sync Song Two']), `B: the account's songs, not its own (${titles})`);
  const bState = await B.p.evaluate(() => ({ keys: JSON.parse(localStorage.getItem('resonate.sing.keys') || '{}'), rates: JSON.parse(localStorage.getItem('resonate.sing.rates') || '{}'), profiles: JSON.parse(localStorage.getItem('resonate.profiles') || 'null'), shelf: !!localStorage.getItem('resonate.shelf') }));
  check(bState.keys[s1] === 2 && bState.rates['amazing-grace'] === 0.9, 'B: key and tempo arrived');
  check(bState.profiles?.list?.[0]?.name === 'Tester' && bState.profiles.list[0].vol === null, 'B: the profile arrived (its own calibration: none yet)');
  check(bState.shelf, 'B: its signed-out state is shelved');
  await B.p.goto(URL0 + 'sing.html'); await B.p.waitForTimeout(2500);
  await B.p.evaluate(() => { const s = document.getElementById('song-select'); s.value = 'amazing-grace'; s.dispatchEvent(new Event('change')); }); await B.p.waitForTimeout(2000);
  const bTake = await B.p.evaluate(() => { const d = window.resonateDebug(); return { take: !!d.take, at: d.take?.at, voice: !!d.take?.voice, review: !document.getElementById('review-btn').hidden }; });
  check(bTake.take && bTake.at === takeA.at && !bTake.voice && bTake.review, `B: A's last take shows (no recording here), Review available (${JSON.stringify(bTake)})`);
  // B changes song two's tempo and removes song one
  await B.p.evaluate((id) => { const s = document.getElementById('song-select'); s.value = id; s.dispatchEvent(new Event('change')); }, s2); await B.p.waitForTimeout(1500);
  await B.p.evaluate(() => { const t = document.getElementById('tempo-select'); t.value = 'r:0.8'; t.dispatchEvent(new Event('change')); }); await B.p.waitForTimeout(500);
  await B.p.evaluate((id) => { const s = document.getElementById('song-select'); s.value = id; s.dispatchEvent(new Event('change')); }, s1); await B.p.waitForTimeout(1500);
  await B.p.click('#remove-song'); await B.p.waitForTimeout(2500);
  await syncNow(B.p); await settle(B.p);
  // A follows (a pass, as when it comes back to the page)
  await A.p.goto(URL0 + 'sing.html'); await A.p.waitForTimeout(1000); await syncNow(A.p); await settle(A.p);
  const aNow = await A.p.evaluate(() => ({ rates: JSON.parse(localStorage.getItem('resonate.sing.rates') || '{}'), keys: JSON.parse(localStorage.getItem('resonate.sing.keys') || '{}') }));
  titles = (await lib(A.p, 'listSongs', [])).map((x) => x.title);
  check(aNow.rates[s2] === 0.8, `A: B's tempo for song two arrived (${aNow.rates[s2]})`);
  check(!titles.includes('Sync Song One') && !(s1 in aNow.keys), `A: song one is gone, with its key (${titles})`);
  // B signs out: its own song is back
  await B.p.goto(URL0 + 'account.html'); await B.p.waitForFunction(() => window.resonateDebug?.().view === 'in', null, { timeout: 20000 });
  B.p.lastDialog = null;
  await B.p.click('#signout'); await B.p.waitForFunction(() => window.resonateDebug?.().view === 'out', null, { timeout: 30000 });
  titles = (await lib(B.p, 'listSongs', [])).map((x) => x.title);
  check(JSON.stringify(titles) === JSON.stringify(['B Local Song']) && !B.p.lastDialog, `B signed out: its own song is back, no warning needed (${titles}; ${B.p.lastDialog})`);
  check(await B.p.evaluate(() => !localStorage.getItem('resonate.profiles') && !localStorage.getItem('resonate.shelf')), 'B signed out: the account\'s profile left with it');

  // --- C: 12 songs, creates the account → the cloud fills to 10, the rest stay ---
  const C = await device('C');
  await C.p.goto(URL0 + 'sing.html'); await C.p.waitForTimeout(1200);
  for (let i = 1; i <= 12; i++) { await lib(C.p, 'addSong', [`C Song ${String(i).padStart(2, '0')}`, xmlTitled(`C Song ${i}`), {}]); await C.p.waitForTimeout(5); }
  const sess = await token();
  sess.user.created_at = new Date().toISOString(); // (answered as a new account: made just now)
  await C.p.route('**/auth/v1/signup**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sess) }));
  await C.p.goto(URL0 + 'account.html'); await C.p.waitForFunction(() => window.resonateDebug?.().view === 'out', null, { timeout: 15000 });
  await C.p.fill('#email', EMAIL); await C.p.fill('#password', 'whatever-long');
  await C.p.click('#signup');
  await C.p.waitForFunction(() => window.resonateDebug?.().view === 'in', null, { timeout: 20000 });
  await settle(C.p, 120000); await syncNow(C.p); await settle(C.p, 60000);
  c = await cloud(t0);
  const cloudSongs = c.filter((x) => x.kind === 'song').map((x) => x.data.title).sort();
  const cLocal = (await lib(C.p, 'listSongs', [])).map((x) => x.title);
  check(cloudSongs.length === 10 && cloudSongs.includes('Sync Song Two'), `C: the cloud holds 10 songs (${cloudSongs.length}: ${cloudSongs.join(', ')})`);
  check(cLocal.length === 13 && cLocal.includes('Sync Song Two'), `C: keeps all 12 of its own (+ the account's) (${cLocal.length})`);
  check(!cloudSongs.includes('C Song 01') && !cloudSongs.includes('C Song 02') && !cloudSongs.includes('C Song 03'), 'C: the oldest three stayed on the device');
  // C deletes one of its songs that's in the cloud: room again, the newest held one goes up.
  const cSongs = await lib(C.p, 'listSongs', []);
  const gone = cSongs.find((x) => x.title === 'C Song 04');
  await lib(C.p, 'removeSong', [gone.id]);
  await syncNow(C.p); await settle(C.p); await syncNow(C.p); await settle(C.p);
  c = await cloud(t0);
  const cloud2 = c.filter((x) => x.kind === 'song').map((x) => x.data.title).sort();
  check(cloud2.length === 10 && !cloud2.includes('C Song 04') && cloud2.includes('C Song 03'), `C: a song deleted → a held one takes its place (${cloud2.join(', ')})`);
  await C.p.goto(URL0 + 'account.html'); await C.p.waitForFunction(() => window.resonateDebug?.().view === 'in', null, { timeout: 20000 });
  C.p.lastDialog = null;
  await C.p.click('#signout'); await C.p.waitForFunction(() => window.resonateDebug?.().view === 'out', null, { timeout: 60000 });
  check(/^2 songs aren't in the cloud/.test(C.p.lastDialog || ''), `C signed out: warned first ("${C.p.lastDialog}")`);
  check((await lib(C.p, 'listSongs', [])).length === 0, 'C signed out: nothing left (its songs went into the account)');

  for (const d of [A, B, C]) check(!d.errs.length, 'no page errors ' + d.errs.join('; '));
  await emptyCloud(await token());
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'all ok');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
