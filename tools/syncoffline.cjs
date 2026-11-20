// Offline: a change made while the cloud can't be reached is kept, nothing is deleted, and it
// goes up once the connection is back.
const { chromium } = require('playwright');
const SB = 'https://ltyadhjhnfxdlgsmrcds.supabase.co', KEY = 'sb_publishable_8FEg0aiW9Ir-RrrND8kfQw_IBirLBai';
const U = 'http://localhost:8097/resonate/';
(async () => {
  let fails = 0; const check = (ok, m) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${m}`); if (!ok) fails++; };
  const tok = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env.TEST_EMAIL, password: process.env.TEST_PW }) })).json();
  const H = { apikey: KEY, Authorization: `Bearer ${tok.access_token}`, 'content-type': 'application/json' };
  const live = async () => (await fetch(`${SB}/rest/v1/sync_items?deleted=eq.false&select=kind,id,data`, { headers: H })).json();
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
  const ctx = await b.newContext(); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(U + 'account.html'); await p.waitForFunction(() => window.resonateDebug?.().view === 'out');
  await p.fill('#email', process.env.TEST_EMAIL); await p.fill('#password', process.env.TEST_PW); await p.click('#signin');
  await p.waitForFunction(() => window.resonateDebug?.().view === 'in', null, { timeout: 20000 });
  await p.goto(U + 'sing.html'); await p.waitForTimeout(1500);
  const grace = await (await fetch(U + 'songs/amazing-grace.musicxml')).text();
  const id = await p.evaluate(async (xml) => (await import('/resonate/library.js?v=71')).addSong('Offline Song', xml.replace('<score-partwise', '<score-partwise data-o="1"'), {}), grace);
  const pass = () => p.evaluate(async () => (await import('/resonate/sync.js?v=71')).syncNow());
  await pass(); await pass();
  check((await live()).some((x) => x.kind === 'song' && x.id === id), 'the song is in the cloud');
  // Offline: the cloud can't be reached.
  await ctx.route(/supabase\.co/, (r) => r.abort('internetdisconnected'));
  await p.evaluate((id) => { localStorage.setItem('resonate.sing.keys', JSON.stringify({ [id]: 5 })); window.dispatchEvent(new CustomEvent('resonate:data')); }, id);
  const r1 = await pass(); const r2 = await pass();
  const local = await p.evaluate(async (id) => ({ songs: (await (await import('/resonate/library.js?v=71')).listSongs()).map((s) => s.id), key: JSON.parse(localStorage.getItem('resonate.sing.keys'))[id], pending: Object.entries(window.resonateSync().meta.items).filter(([, m]) => !m.up).map(([k]) => k) }), id);
  check(local.songs.includes(id) && local.key === 5, 'offline: the song and the change stay');
  check(local.pending.includes(`song_state:${id}|key`) && !local.pending.some((k) => k.startsWith('song:')), `offline: the change waits to go up, nothing marked deleted (${local.pending})`);
  // Back online.
  await ctx.unroute(/supabase\.co/);
  await pass(); await pass();
  const st = (await live()).find((x) => x.kind === 'song_state' && x.id === `${id}|key`);
  check(st?.data.v === 5, `back online: the change went up (${JSON.stringify(st?.data)})`);
  // tidy up: delete the song (tombstones)
  await p.evaluate(async (id) => { const L = await import('/resonate/library.js?v=71'); await L.removeSong(id); const k = JSON.parse(localStorage.getItem('resonate.sing.keys')); delete k[id]; localStorage.setItem('resonate.sing.keys', JSON.stringify(k)); }, id);
  await pass(); await pass();
  check(!(await live()).some((x) => x.id === id || x.id.startsWith(`${id}|`)), 'removed again');
  check(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'all ok'); process.exit(fails ? 1 : 0);
})();
