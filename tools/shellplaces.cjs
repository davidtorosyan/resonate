// The shell's places (v87): Record, Voice and Assistants in place — a full-height sheet over the
// shell, no navigation, one history entry (Back closes it), the tuner parked before Record / Voice
// take the mic, a Record take kept when the sheet closes, Voice's range test stopped; the Reader's
// Sing it / Play it open the new song in place (the scripted worker of shell.cjs / importfixes.cjs);
// 📡 from home with a signed-in, approved account faked cheaply: the session in localStorage, the
// REST calls answered by route, sync.js stubbed, the Realtime socket held open and silent — commands
// go in through assist.js's own remote.handle(), the same path a Realtime command takes.
//   node shellplaces.cjs           (http://localhost:8097/resonate/; SHOTS=dir for the 2 screenshots)
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:8097/resonate/';
const SHOTS = process.env.SHOTS === '0' ? null : process.env.SHOTS || '/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/v87'; // ("0": no screenshots, as shell.cjs)
const FX = '/home/user/tools/fixtures';
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

let passes = 0, fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`); if (c) passes++; else fails++; return c; };

// --- the scripted worker (shell.cjs) -------------------------------------------------------------
const b64 = (f) => fs.readFileSync(f).toString('base64');
function traceBlocks(file) {
  const blocks = [];
  let cur = null;
  for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
    if (/^[A-Z] /.test(l)) { if (cur) blocks.push(cur); cur = l; } else if (cur != null && l) cur += '\n' + l;
  }
  if (cur) blocks.push(cur);
  return blocks;
}
function fakeWorker(steps) {
  return `
const STEPS = ${JSON.stringify(steps)};
const buf = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;
self.onmessage = async (e) => {
  if (e.data.type !== 'run') return;
  for (const st of STEPS) {
    const [k, a] = st;
    if (k === 'post') self.postMessage(a);
    else if (k === 'log') self.postMessage({ type: 'log', line: a });
    else if (k === 'trace') self.postMessage({ type: 'trace', block: a });
    else if (k === 'done') { const m = buf(a); self.postMessage({ type: 'done', mxls: [m] }, [m]); return; }
    await new Promise((r) => setTimeout(r, 5));
  }
};`;
}
const FULL = [['post', { type: 'engine', milestone: 'fetch' }], ['post', { type: 'engine', milestone: 'jvm' }],
  ['log', 'INFO  [score]                       Main 280  | Audiveris'], ['post', { type: 'engine', milestone: 'start' }],
  ['post', { type: 'engine', milestone: 'font', detail: '156 glyphs' }],
  ...traceBlocks(`${FX}/trace/amazing-grace.trace`).map((b) => ['trace', b]),
  ['log', 'INFO  [score] PartwiseBuilder 2707 | Exporting sheet(s): [#1]'], ['post', { type: 'export', at: 'write' }],
  ['log', 'INFO  [score] Score 1 | Score score exported to /files/x/score.mxl'], ['done', b64(`${FX}/trace/amazing-grace.mxl`)]];

const SIZES = [
  { n: 'phone', w: 390, h: 844, touch: true, dev: 'phone' },
  { n: 'ipad', w: 820, h: 1180, touch: true, dev: 'tablet' },
  { n: 'desktop', w: 1280, h: 800, touch: false, dev: 'desktop' },
];
const PROFILE = { active: 'p1', list: [{ id: 'p1', name: 'Dave', vol: { floor: -50, ceiling: -10 }, range: { low: 45, high: 67, comfortLow: 48, comfortHigh: 64, at: 1 } }] };
const UID = '00000000-0000-4000-8000-00000000abcd';
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function session() {
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const jwt = `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub: UID, exp, role: 'authenticated', email: 'dave@mail.com', aud: 'authenticated' })}.sig`;
  return { access_token: jwt, refresh_token: 'r-test', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: UID, email: 'dave@mail.com', aud: 'authenticated', role: 'authenticated' } };
}

let browser;
// cloud: fake an approved account — REST answered here (net.log: what was asked; net.remote: the
// device's switch; net.answers: the commands' answers), sync.js stubbed, Realtime held silent.
async function context(sz, seed = {}, { cloud = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: sz.w, height: sz.h }, deviceScaleFactor: 1, permissions: ['microphone'], ...(sz.touch ? { isMobile: true, hasTouch: true } : {}) });
  ctx.net = { log: [], remote: false, answers: [] };
  await ctx.route('**/omr/omr-worker.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: fakeWorker(FULL) }));
  if (cloud) {
    await ctx.route('**/sync.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: 'export const syncOff = () => true; export const start = () => {}; export const stop = async () => {}; export const syncNow = () => {};' }));
    await ctx.routeWebSocket(/supabase\.co/, (ws) => { ws.onMessage(() => {}); });
    await ctx.route('**/*.supabase.co/**', async (r) => {
      const req = r.request(), u = new URL(req.url()), m = req.method(), path = u.pathname;
      ctx.net.log.push(`${m} ${path.replace('/rest/v1/', '')}`);
      const json = (b, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
      if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      const body = (() => { try { return req.postDataJSON(); } catch { return null; } })();
      if (path.endsWith('/rest/v1/accounts')) return json([{ approved: true }]);
      if (path.endsWith('/rest/v1/devices')) {
        if (m === 'POST' && body && 'remote' in body) ctx.net.remote = !!body.remote;
        return json([{ remote: ctx.net.remote }], m === 'POST' ? 201 : 200);
      }
      if (path.endsWith('/rest/v1/assistant_settings')) return json([{ start_delay_s: 0, review_after_remote: false }]);
      if (path.endsWith('/rest/v1/device_commands') && m === 'PATCH') {
        if (body?.status) ctx.net.answers.push({ id: u.searchParams.get('id'), status: body.status, result: body.result });
        return json([{ id: (u.searchParams.get('id') || '').replace(/^eq\./, '') }]);
      }
      if (path.includes('/rest/v1/')) return m === 'GET' ? json([]) : json([], 201);
      if (path.includes('/auth/v1/oauth/grants')) return json([]);
      return json({}, 404);
    });
  } else await ctx.route('**/*.supabase.co/**', (r) => r.abort());
  await ctx.addInitScript((seed) => {
    try {
      if (location.protocol === 'about:' || sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    } catch {}
  }, seed);
  await ctx.addInitScript(() => {
    if (location.protocol === 'about:') return;
    window.__live = () => !!window.resonateDebug?.().tuner.live;
    // Was the tuner's mic still live when Record / Voice opened theirs? (every getUserMedia)
    window.__gum = [];
    const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => { window.__gum.push({ tunerLive: !!window.resonateDebug?.().tuner?.live, place: window.resonateDebug?.().place?.open || null }); return g(c); };
  });
  ctx.errors = [];
  ctx.on('page', (p) => {
    p.navs = [];
    p.on('framenavigated', (f) => { if (f === p.mainFrame() && !/\/index\.html(\?|#|$)/.test(f.url())) p.navs.push(f.url()); }); // (pushState / Back within the shell: not a navigation)
    p.on('load', () => { p.loads = (p.loads || 0) + 1; });
    p.on('pageerror', (e) => ctx.errors.push(`${p.url().split('/').pop()}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|supabase|Failed to fetch|sync|WebSocket/i.test(m.text())) ctx.errors.push(`${p.url().split('/').pop()}: ${m.text()}`); });
  });
  return ctx;
}
async function closeCtx(ctx) {
  ok(!ctx.errors.length, `no console errors${ctx.errors.length ? ': ' + ctx.errors.slice(0, 4).join(' | ') : ''}`);
  await ctx.close();
}
const dbg = (p) => p.evaluate(() => { const d = window.resonateDebug?.(); return d && { song: d.song, tuner: d.tuner, place: d.place, remote: d.remote, import: d.import, overlay: d.overlay }; }).catch(() => null);
async function until(p, pred, ms = 15000) {
  const end = Date.now() + ms;
  let d = null;
  while (Date.now() < end) { d = await dbg(p); try { if (d && pred(d)) return d; } catch {} await p.waitForTimeout(100); }
  return d;
}
async function home(ctx, url = 'index.html') {
  const p = await ctx.newPage();
  await p.goto(BASE + url);
  await p.waitForFunction(() => window.resonateDebug?.().tuner && window.resonateDebug().place);
  await p.waitForTimeout(400);
  p.navs.length = 0;
  return p;
}
const tap = (p, sz, sel) => (sz.touch ? p.tap(sel) : p.click(sel));
// The sheet: shown, covering the window, the page under it the shell still.
const sheet = (p, name) => p.evaluate((name) => {
  const el = document.getElementById(`place-${name}`);
  if (!el || el.hidden) return null;
  const r = el.getBoundingClientRect();
  return { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width), cover: r.top <= 1 && r.height >= innerHeight - 1 && r.width >= innerWidth - 1, url: location.pathname, hist: history.length };
}, name);
const settled = (p, name) => p.waitForFunction((name) => { const el = document.getElementById(`place-${name}`); return el && !el.hidden && !el.getAnimations().length; }, name, { timeout: 5000 }).catch(() => {});
const gone = (p, name) => p.waitForFunction((name) => { const el = document.getElementById(`place-${name}`); return !el || el.hidden; }, name, { timeout: 5000 }).then(() => true, () => false);
const vis = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'; }, sel);

// --- Record (a phone): no navigation, the tuner parked, a take kept, Back / ✕ close it -----------
async function record(sz) {
  const ctx = await context(sz, { 'resonate.profiles': JSON.stringify(PROFILE), 'resonate.shell.modules': JSON.stringify({ phone: ['score'] }) });
  const p = await home(ctx);
  const h0 = await p.evaluate(() => history.length);
  await tap(p, sz, '#main-btn');
  let d = await until(p, (x) => x.tuner.state === 'listening' && x.tuner.live, 8000);
  ok(d?.tuner.live, `${sz.n}: the tuner listens at home`);
  ok(!(await vis(p, '#home-remote')), `${sz.n}: signed out — no 📡`);
  // The dock's Record: the sheet, no navigation, the tuner parked in the tap itself.
  const parkedInTap = await p.evaluate(() => { document.getElementById('rec-btn').click(); return !window.__live(); }); // (click() dispatches synchronously)
  ok(parkedInTap, `${sz.n}: Record's tap parks the tuner at once (no live track)`);
  await settled(p, 'record');
  let s = await sheet(p, 'record');
  ok(!!s && s.cover && /index\.html$/.test(s.url) && !p.navs.length, `${sz.n}: Record opens in place — a full-height sheet, no navigation (${JSON.stringify(s)}, navs ${p.navs.length})`);
  ok(s?.hist === h0 + 1, `${sz.n}: one history entry (${h0} → ${s?.hist})`);
  d = await dbg(p);
  ok(d?.place.open === 'record' && d.overlay === 'place-record' && d.tuner.state === 'off', `${sz.n}: debug: place ${d?.place.open}, overlay ${d?.overlay}, tuner ${d?.tuner.state}`);
  ok(await p.evaluate(() => { const r = document.querySelector('#place-record #rec').getBoundingClientRect(); return r.bottom <= innerHeight && r.height >= 44; }), `${sz.n}: Record's button on screen, ≥ 44 px`);
  // A take in the sheet.
  await tap(p, sz, '#place-record #rec');
  d = await until(p, (x) => x.place.record?.recording && x.place.record.duration > 1.6, 8000);
  ok(d?.place.record?.recording, `${sz.n}: a take records in the sheet (${d?.place.record?.duration?.toFixed(1)} s)`);
  const gum = await p.evaluate(() => window.__gum.filter((g) => g.place === 'record'));
  ok(gum.length >= 1 && gum.every((g) => !g.tunerLive), `${sz.n}: Record opened the mic with the tuner parked (${JSON.stringify(gum)})`);
  // Back: closed; the take stops and is kept.
  await p.goBack();
  ok(await gone(p, 'record'), `${sz.n}: Back closes it`);
  d = await until(p, (x) => !x.place.record?.recording, 5000);
  ok(!d?.place.record?.recording && d.place.record.duration > 1.5 && d.place.open === null && /index\.html$/.test(p.url()) && !p.navs.length,
    `${sz.n}: the take stopped (kept: ${d?.place.record?.duration?.toFixed(1)} s, ${d?.place.record?.segments} notes), still the shell`);
  ok(await p.evaluate(() => history.length) === h0 + 1 && await p.evaluate(() => !history.state?.shellSheet), `${sz.n}: back on the shell's entry`);
  // Opened again: the take is there (its playback bar), ✕ closes it.
  await tap(p, sz, '#rec-btn');
  await settled(p, 'record');
  ok(await vis(p, '#place-record #playbar') && (await dbg(p))?.place.record.duration > 1.5, `${sz.n}: opened again — the take is still there (▶ Play)`);
  await p.waitForTimeout(300);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/places-record-${sz.n}.png` });
  await tap(p, sz, '#place-record .place-x');
  ok(await gone(p, 'record'), `${sz.n}: ✕ closes it`);
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => !history.state?.shellSheet), `${sz.n}: ✕ takes its history entry back`);
  // The Reader's Sing it: the new song in place, Sing shown (the phone's saved set is the Score alone).
  await p.goto(`${BASE}index.html?pdf=${encodeURIComponent('/imp/amazing-grace1.pdf')}`);
  p.navs.length = 0;
  d = await until(p, (x) => x.import?.result?.songId, 30000);
  const id = d?.import?.result?.songId;
  ok(!!id, `${sz.n}: an import finishes (${id})`);
  if (id) {
    if ((await dbg(p))?.import?.mode !== 'open') await tap(p, sz, '#imp-mini').catch(() => {});
    await p.waitForSelector('.rd-sing', { state: 'visible', timeout: 5000 }).catch(() => {});
    ok(await vis(p, '.rd-sing') && await vis(p, '.rd-play'), `${sz.n}: the Reader's Sing it / Play it`);
    await tap(p, sz, '.rd-sing');
    d = await until(p, (x) => x.song?.open && x.song.state?.song === id && x.song.set.sing && !x.song.moving && !x.song.switching, 15000);
    ok(!!d && /index\.html/.test(p.url()) && !p.navs.length, `${sz.n}: Sing it → the song in place (${d?.song?.state?.song}), no navigation`);
    ok(d?.song.set.sing && !d.song.set.score, `${sz.n}: … with Sing shown (the Score gives way on a phone): ${JSON.stringify(d?.song.set)}`);
    ok(await p.evaluate(() => JSON.parse(localStorage.getItem('resonate.shell.modules')).phone.join()) === 'score', `${sz.n}: the saved set is unchanged`);
    ok(await p.evaluate(() => history.state?.shellPage === 'song'), `${sz.n}: the song's history entry is the current one (the Reader's handed over)`);
    await p.goBack();
    d = await until(p, (x) => !x.song.open && !x.song.moving && !x.song.closing, 8000);
    ok(!d?.song.open && /index\.html/.test(p.url()) && !p.navs.length, `${sz.n}: Back closes the song, still the shell`);
  }
  await closeCtx(ctx);
}

// --- Voice (an iPad): from the tuner's range, the test stopped on close, a change reaches the tuner
async function voice(sz) {
  const ctx = await context(sz, { 'resonate.profiles': JSON.stringify(PROFILE), 'resonate.shell.modules': JSON.stringify({ tablet: ['sing'] }) });
  const p = await home(ctx);
  await tap(p, sz, '#main-btn');
  let d = await until(p, (x) => x.tuner.live, 8000);
  ok(d?.tuner.live, `${sz.n}: the tuner listens`);
  const lbl0 = await p.textContent('#tuner .ribbon-wrap .lbl span');
  // The tuner's range ribbon links to Voice: in place.
  await tap(p, sz, '#tuner .ribbon-wrap');
  await settled(p, 'voice');
  let s = await sheet(p, 'voice');
  d = await dbg(p);
  ok(!!s?.cover && !p.navs.length && d.place.open === 'voice', `${sz.n}: the range ribbon opens Voice in place (${JSON.stringify(s)})`);
  ok(d?.tuner.state === 'off' && !d.tuner.live, `${sz.n}: the tuner parked`);
  ok(await vis(p, '#place-voice #range-card') && await p.evaluate(() => document.querySelector('#place-voice #profile-select').value) === 'p1', `${sz.n}: its cards: Dave's range`);
  await p.waitForTimeout(250);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/places-voice-${sz.n}.png` });
  // The range test, then Back: it stops.
  await tap(p, sz, '#place-voice #range-btn');
  d = await until(p, (x) => x.place.voice?.run?.kind === 'range' && x.place.voice.run.mic, 8000);
  ok(d?.place.voice?.run?.kind === 'range', `${sz.n}: the range test runs (${d?.place.voice?.run?.phase}, mic ${d?.place.voice?.run?.mic})`);
  const gum = await p.evaluate(() => window.__gum.filter((g) => g.place === 'voice'));
  ok(gum.length >= 1 && gum.every((g) => !g.tunerLive), `${sz.n}: Voice opened the mic with the tuner parked`);
  const live0 = await p.evaluate(() => window.__tracks = 0);
  await p.goBack();
  ok(await gone(p, 'voice'), `${sz.n}: Back closes Voice`);
  d = await until(p, (x) => !x.place.voice?.run, 4000);
  ok(!d?.place.voice?.run && await p.evaluate(() => document.querySelector('#place-voice #test').hidden), `${sz.n}: … and the range test stopped`);
  // Again from the account menu; a change to the range reaches the tuner when it closes.
  await tap(p, sz, '#avatar');
  await p.waitForSelector('#acct a[href="voice.html"]', { state: 'visible' });
  await tap(p, sz, '#acct a[href="voice.html"]');
  await settled(p, 'voice');
  ok(!!(await sheet(p, 'voice')) && !p.navs.length && (await dbg(p)).overlay === 'place-voice', `${sz.n}: the account menu's Voice opens it in place (the menu gives way)`);
  await tap(p, sz, '#place-voice .stepper[data-k="comfortHigh"] button:last-child');
  await p.keyboard.press('Escape');
  ok(await gone(p, 'voice'), `${sz.n}: Escape closes it`);
  await p.waitForTimeout(200);
  const lbl1 = await p.textContent('#tuner .ribbon-wrap .lbl span');
  ok(lbl0 !== lbl1 && /F4/.test(lbl1), `${sz.n}: the tuner's range follows (${lbl0} → ${lbl1})`);
  // The Reader's Play it: the Score shown, with Sing (a tablet keeps both).
  await p.goto(`${BASE}index.html?pdf=${encodeURIComponent('/imp/amazing-grace1.pdf')}`);
  p.navs.length = 0;
  d = await until(p, (x) => x.import?.result?.songId, 30000);
  const id = d?.import?.result?.songId;
  if (ok(!!id, `${sz.n}: an import finishes`)) {
    if ((await dbg(p))?.import?.mode !== 'open') await tap(p, sz, '#imp-mini').catch(() => {});
    await p.waitForSelector('.rd-play', { state: 'visible', timeout: 5000 }).catch(() => {});
    await tap(p, sz, '.rd-play');
    d = await until(p, (x) => x.song?.open && x.song.set.score && !x.song.moving && !x.song.switching && x.song.score?.song === id, 25000);
    ok(!!d && !p.navs.length, `${sz.n}: Play it → the song in place on the Score (${d?.song?.score?.song}), no navigation`);
    ok(d?.song.set.score && d.song.set.sing, `${sz.n}: … the Score shown beside Sing: ${JSON.stringify(d?.song.set)}`);
  }
  await closeCtx(ctx);
}

// --- Assistants and 📡 from home (a desktop, the account faked) --------------------------------------
async function remote(sz) {
  const ctx = await context(sz, { 'resonate.auth': JSON.stringify(session()), 'resonate.profiles': JSON.stringify(PROFILE), 'resonate.shell.modules': JSON.stringify({ desktop: ['score', 'piano'] }) }, { cloud: true });
  const p = await home(ctx);
  let d = await until(p, (x) => x.remote?.available, 10000);
  ok(d?.remote?.available && await vis(p, '#home-remote') && (await p.textContent('#home-remote')).trim() === '📡', `${sz.n}: signed in and approved — 📡 at home (${JSON.stringify(d?.remote)})`);
  ok(d?.remote?.state.page === 'home' && d.remote.state.song === null && !d.song.loaded, `${sz.n}: the device says home, no song; Sing not loaded`);
  ok(ctx.net.log.some((l) => /POST devices/.test(l)), `${sz.n}: the device's heartbeat went (devices)`);
  // Assistants from the account menu: in place.
  await tap(p, sz, '#avatar');
  await p.waitForSelector('#acct a[href="assistants.html"]', { state: 'visible' });
  await tap(p, sz, '#acct a[href="assistants.html"]');
  await settled(p, 'assistants');
  await p.waitForFunction(() => !document.querySelector('#place-assistants #v-connect')?.hidden, null, { timeout: 8000 }).catch(() => {});
  const s = await sheet(p, 'assistants');
  const url = await p.inputValue('#place-assistants #url').catch(() => '');
  ok(!!s?.cover && !p.navs.length && /functions\/v1\/mcp$/.test(url), `${sz.n}: Assistants in place — the server URL, no navigation (${url}; ${p.navs.join(' ')})`);
  ok(await vis(p, '#place-assistants #v-devices'), `${sz.n}: … its Devices card`);
  await p.goBack();
  ok(await gone(p, 'assistants'), `${sz.n}: Back closes it`);
  // 📡 on from home: Sing mounted, hidden.
  await tap(p, sz, '#home-remote');
  d = await until(p, (x) => x.remote?.on && x.song.loaded, 15000);
  ok(d?.remote?.on && (await p.textContent('#home-remote')).includes('Remote on') && await p.getAttribute('#home-remote', 'aria-pressed') === 'true', `${sz.n}: 📡 on (home)`);
  ok(d?.song.loaded && !d.song.open && !(await vis(p, '#sing-region')) && d.remote.wrapped && d.remote.inner, `${sz.n}: Sing mounted hidden, its remote hooks inside the shell's`);
  const cmd = (action, args = {}) => p.evaluate(async ({ action, args }) => {
    const m = await import(`/resonate/assist.js?v=${document.getElementById('version').textContent.trim().replace(/^v/, '')}`); // (the page's own module: the badge's version, not a fixed one)
    const id = `c${Math.random().toString(36).slice(2, 8)}`;
    m.remote.handle({ id, device: m.device().id, action, args, at: new Date().toISOString() });
    return `eq.${id}`;
  }, { action, args });
  const answer = async (id, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { const a = ctx.net.answers.find((x) => x.id === id); if (a) return a; await p.waitForTimeout(100); } return null; };
  // open_song from home: the song in place with Sing.
  let a = await answer(await cmd('open_song', { song: 'Amazing Grace' }), 20000);
  d = await until(p, (x) => x.song.open && x.song.set.sing && !x.song.moving && !x.song.switching, 10000);
  ok(a?.status === 'done' && d?.song.open && d.song.state?.song === 'amazing-grace', `${sz.n}: open_song from home → done, Amazing Grace in place (${a?.status} ${JSON.stringify(a?.result?.song)})`);
  ok(d?.song.set.sing && await vis(p, '#sing-region'), `${sz.n}: … with Sing shown (${JSON.stringify(d?.song.set)})`);
  ok(!(await vis(p, '#home-remote')) && await vis(p, '#sing-top #remote-btn') && (await p.textContent('#remote-btn')).includes('Remote on'), `${sz.n}: one 📡: Sing's own now, on`);
  // Home again; a Record sheet open; sing from there: the sheet gives way, the take runs in Sing.
  await tap(p, sz, '#song-close');
  d = await until(p, (x) => !x.song.open && !x.song.moving && !x.song.closing, 8000);
  ok(!d?.song.open && await vis(p, '#home-remote'), `${sz.n}: the song closed — 📡 at home again`);
  await tap(p, sz, '#rec-btn');
  await settled(p, 'record');
  a = await answer(await cmd('sing', { by: 'Claude', delay: 0 }), 25000);
  d = await until(p, (x) => x.song.state?.take, 8000);
  ok(a?.status === 'done' && d?.song.open && d.song.set.sing && d.song.state?.take, `${sz.n}: sing from home (Record open) → a take in Sing, in place (${a?.status}${a?.result?.error ? ' ' + a.result.error : ''})`);
  ok(await gone(p, 'record') && (await dbg(p)).place.open === null, `${sz.n}: … the Record sheet gave way`);
  ok(d?.tuner.state === 'off' && !p.navs.length && p.loads === 1, `${sz.n}: the tuner parked, no navigation (${p.navs.join(' ')}, loads ${p.loads})`);
  ok(await p.evaluate(() => history.state?.shellPage === 'song'), `${sz.n}: the song's history entry is the current one (Record's handed over)`);
  a = await answer(await cmd('stop', { by: 'Claude' }), 15000);
  d = await until(p, (x) => !x.song.state?.take, 10000);
  ok(a?.status === 'done' && !d?.song.state?.take, `${sz.n}: stop → the take ends (${a?.status})`);
  // 📡 off from Sing's own button: home's follows.
  await tap(p, sz, '#remote-btn');
  d = await until(p, (x) => !x.remote.on, 5000);
  ok(!d?.remote.on && !ctx.net.remote, `${sz.n}: Sing's 📡 off — the switch is one (${d?.remote.on})`);
  await tap(p, sz, '#song-close');
  await until(p, (x) => !x.song.open && !x.song.moving, 8000);
  ok((await p.textContent('#home-remote')).trim() === '📡' && await p.getAttribute('#home-remote', 'aria-pressed') === 'false', `${sz.n}: home's 📡 shows it off`);
  await closeCtx(ctx);
}

(async () => {
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${FX}/shell/a3.wav`] });
  try {
    if (!ONLY || ONLY.has('phone')) await record(SIZES[0]);
    if (!ONLY || ONLY.has('ipad')) await voice(SIZES[1]);
    if (!ONLY || ONLY.has('desktop')) await remote(SIZES[2]);
  } catch (err) {
    ok(false, `crashed: ${err.stack || err}`);
  }
  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
