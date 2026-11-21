// The shell's places (v87): Record, Voice and Assistants in place — a full-height sheet over the
// shell, no navigation, one history entry (Back closes it), the tuner parked before Record / Voice
// take the mic, a Record take kept when the sheet closes, Voice's range test stopped; the Reader's
// Sing it / Play it open the new song in place (the scripted worker of shell.cjs / importfixes.cjs);
// the AI button from home with a signed-in, approved account faked cheaply: the session in
// localStorage, the REST calls answered by route, sync.js stubbed, the Realtime socket held open
// (its join answered, nothing else unless a test sends a broadcast) — commands go in through
// assist.js's own remote.handle(), the same path a Realtime command takes; on a stale shell
// (sing.html / play.html of another badge) a command that mounts Sing or the Score runs in place.
// The AI button (E2, v96; was 📡): shown only once an assistant has connected to the account
// (assistant_activity has a row — and live when one does: a Realtime "assistant" event), or while
// this device's switch is on (also when the check fails); remembered for the account on this device,
// so a reload shows it before the cloud answers, and checked again; the AI mark, no words — at home,
// in Sing, on sing.html and play.html, and the Assistants list's device that has it on.
//   node shellplaces.cjs   (BASE: http://localhost:8097/resonate/; SHOTS=dir for the 2 screenshots, 0: none;
//                           ONLY=phone,ipad,desktop,gate,pages)
const { chromium } = require('playwright');
const fs = require('fs');
const { ok, done } = require('./lib/check.cjs');
const { BASE, FIX: FX, SHOTS } = require('./lib/paths.cjs');

const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;

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
  // (assistant: assistant_activity has a row; activityStatus: its answer's status — 500 = the check
  // fails; hold: a promise the accounts read waits on — the cloud not answered yet; sockets: the
  // Realtime sockets, to send a broadcast down)
  ctx.net = { log: [], remote: false, answers: [], assistant: true, activityStatus: 200, hold: null, sockets: [] };
  await ctx.route('**/omr/omr-worker.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: fakeWorker(FULL) }));
  if (cloud) {
    await ctx.route('**/sync.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: 'export const syncOff = () => true; export const start = () => {}; export const stop = async () => {}; export const syncNow = () => {};' }));
    await ctx.routeWebSocket(/supabase\.co/, (ws) => {
      const s = { ws, joins: [] };
      ctx.net.sockets.push(s);
      ws.onMessage((m) => { try { const j = JSON.parse(String(m)); if (Array.isArray(j) && j[3] === 'phx_join') { s.joins.push(j); ws.send(JSON.stringify([j[0], j[1], j[2], 'phx_reply', { status: 'ok', response: { postgres_changes: [] } }])); } } catch {} });
    });
    await ctx.route('**/*.supabase.co/**', async (r) => {
      const req = r.request(), u = new URL(req.url()), m = req.method(), path = u.pathname;
      ctx.net.log.push(`${m} ${path.replace('/rest/v1/', '')}`);
      const json = (b, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
      if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      const body = (() => { try { return req.postDataJSON(); } catch { return null; } })();
      if (path.endsWith('/rest/v1/accounts')) { if (ctx.net.hold) await ctx.net.hold; return json([{ approved: true }]); }
      if (path.endsWith('/rest/v1/assistant_activity')) {
        if (ctx.net.activityStatus !== 200) return json({ message: 'unavailable' }, ctx.net.activityStatus);
        return json(ctx.net.assistant ? [{ name: 'Claude', logo: null, last_at: new Date(Date.now() - 3600000).toISOString(), last_tool: 'get_status' }] : []);
      }
      if (path.endsWith('/rest/v1/devices')) {
        if (m === 'POST' && body && 'remote' in body) ctx.net.remote = !!body.remote;
        return json([{ id: 'dtest', name: 'Desk', remote: ctx.net.remote, seen_at: new Date().toISOString(), state: null }], m === 'POST' ? 201 : 200);
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
// The AI button: shown, lit (data-on, aria-pressed), its words (none), its label and title, and whether
// its mark is assist.js's AI_MARK (the same markup on every page).
const LABEL = 'Let an assistant control this device';
const aiBtn = (p, sel) => p.evaluate(async (sel) => {
  const e = document.querySelector(sel);
  if (!e) return null;
  let mark = false;
  try {
    const m = await import(`/resonate/assist.js?v=${document.getElementById('version').textContent.trim().replace(/^v/, '')}`);
    const t = document.createElement('template');
    t.innerHTML = m.AI_MARK || '';
    const svg = e.querySelector('svg');
    mark = !!m.AI_MARK && !!svg && t.content.firstElementChild?.isEqualNode(svg) && svg.getBoundingClientRect().width > 8;
  } catch {}
  return { shown: e.getClientRects().length > 0 && !e.hidden, on: e.dataset.on === 'true', pressed: e.getAttribute('aria-pressed') === 'true', text: e.textContent.trim(), label: e.getAttribute('aria-label'), title: e.title, mark };
}, sel).catch(() => null);
const marked = (b) => !!b?.mark && b.text === '' && b.label === LABEL;
// A Realtime broadcast to the account's topic, down every socket that joined it (as the server's
// assistant_seen sends one at every tool call an assistant makes).
function broadcast(ctx, event, payload) {
  let n = 0;
  for (const s of ctx.net.sockets) for (const j of s.joins) if (/^realtime:user:/.test(j[2])) { s.ws.send(JSON.stringify([null, null, j[2], 'broadcast', { type: 'broadcast', event, payload }])); n++; }
  return n;
}
const SEEN = (p) => p.evaluate((uid) => { try { return JSON.parse(localStorage.getItem('resonate.remote.seen') || '{}')[uid] || null; } catch { return 'bad'; } }, UID);

// --- Record (a phone): no navigation, the tuner parked, a take kept, Back / ✕ close it -----------
async function record(sz) {
  const ctx = await context(sz, { 'resonate.profiles': JSON.stringify(PROFILE), 'resonate.shell.modules': JSON.stringify({ phone: ['score'] }) });
  const p = await home(ctx);
  const h0 = await p.evaluate(() => history.length);
  await tap(p, sz, '#main-btn');
  let d = await until(p, (x) => x.tuner.state === 'listening' && x.tuner.live, 8000);
  ok(d?.tuner.live, `${sz.n}: the tuner listens at home`);
  ok(!(await vis(p, '#home-remote')), `${sz.n}: signed out — no AI button`);
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
  await p.waitForSelector('#acct a[href="./?open=voice"]', { state: 'visible' });
  await tap(p, sz, '#acct a[href="./?open=voice"]');
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

// --- Assistants and the AI button from home (a desktop, the account faked; an assistant connected) ---
async function remote(sz) {
  const ctx = await context(sz, { 'resonate.auth': JSON.stringify(session()), 'resonate.profiles': JSON.stringify(PROFILE), 'resonate.shell.modules': JSON.stringify({ desktop: ['score', 'piano'] }) }, { cloud: true });
  const p = await home(ctx);
  let d = await until(p, (x) => x.remote?.available, 10000);
  let b = await aiBtn(p, '#home-remote');
  ok(d?.remote?.available && b?.shown && marked(b) && !b.on && !b.pressed, `${sz.n}: signed in and approved, an assistant connected — the AI button at home, off (${JSON.stringify(d?.remote && { available: d.remote.available, on: d.remote.on })} ${JSON.stringify(b)})`);
  ok(d?.remote?.state.page === 'home' && d.remote.state.song === null && !d.song.loaded, `${sz.n}: the device says home, no song; Sing not loaded`);
  ok(ctx.net.log.some((l) => /POST devices/.test(l)), `${sz.n}: the device's heartbeat went (devices)`);
  // Assistants from the account menu: in place.
  await tap(p, sz, '#avatar');
  await p.waitForSelector('#acct a[href="./?open=assistants"]', { state: 'visible' });
  await tap(p, sz, '#acct a[href="./?open=assistants"]');
  await settled(p, 'assistants');
  await p.waitForFunction(() => !document.querySelector('#place-assistants #v-connect')?.hidden, null, { timeout: 8000 }).catch(() => {});
  const s = await sheet(p, 'assistants');
  const url = await p.inputValue('#place-assistants #url').catch(() => '');
  ok(!!s?.cover && !p.navs.length && /functions\/v1\/mcp$/.test(url), `${sz.n}: Assistants in place — the server URL, no navigation (${url}; ${p.navs.join(' ')})`);
  ok(await vis(p, '#place-assistants #v-devices'), `${sz.n}: … its Devices card`);
  await p.goBack();
  ok(await gone(p, 'assistants'), `${sz.n}: Back closes it`);
  // On from home: Sing mounted, hidden.
  await tap(p, sz, '#home-remote');
  d = await until(p, (x) => x.remote?.on && x.song.loaded, 15000);
  b = await aiBtn(p, '#home-remote');
  ok(d?.remote?.on && b?.on && b.pressed && marked(b) && /tap to stop/.test(b.title), `${sz.n}: the AI button on (home): lit, the mark, no words (${JSON.stringify(b)})`);
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
  b = await aiBtn(p, '#sing-top #remote-btn');
  ok(!(await vis(p, '#home-remote')) && b?.shown && b.on && b.pressed && marked(b), `${sz.n}: one AI button: Sing's own now, on, the same mark (${JSON.stringify(b)})`);
  // Home again; a Record sheet open; sing from there: the sheet gives way, the take runs in Sing.
  await tap(p, sz, '#song-close');
  d = await until(p, (x) => !x.song.open && !x.song.moving && !x.song.closing, 8000);
  ok(!d?.song.open && await vis(p, '#home-remote'), `${sz.n}: the song closed — the AI button at home again`);
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
  // Off from Sing's own button: home's follows.
  await tap(p, sz, '#remote-btn');
  d = await until(p, (x) => !x.remote.on, 5000);
  ok(!d?.remote.on && !ctx.net.remote, `${sz.n}: Sing's AI button off — the switch is one (${d?.remote.on})`);
  await tap(p, sz, '#song-close');
  await until(p, (x) => !x.song.open && !x.song.moving, 8000);
  b = await aiBtn(p, '#home-remote');
  ok(b?.shown && !b.on && !b.pressed && marked(b), `${sz.n}: home's AI button shows it off (an assistant connected: still there)`);
  await closeCtx(ctx);
}

// --- The AI button on a stale shell (v94 review): a command that mounts Sing or the Score for the first time
// with another badge on sing.html / play.html runs in place (no reload under it: it would stay
// claimed and never be answered) and is answered; the song a command opens is the open song, so a
// later reload (the Sing toggle, no command running) reopens that one.
async function remoteStale(sz) {
  const cmdIn = (p, action, args = {}) => p.evaluate(async ({ action, args }) => {
    const m = await import(`/resonate/assist.js?v=${document.getElementById('version').textContent.trim().replace(/^v/, '')}`);
    const id = `c${Math.random().toString(36).slice(2, 8)}`;
    m.remote.handle({ id, device: m.device().id, action, args, at: new Date().toISOString() });
    return `eq.${id}`;
  }, { action, args });
  for (const action of ['open_song', 'score_open']) {
    const ctx = await context(sz, { 'resonate.auth': JSON.stringify(session()), 'resonate.sing.song': 'amazing-grace', 'resonate.shell.modules': JSON.stringify({ desktop: ['score', 'piano'] }) }, { cloud: true });
    ctx.net.remote = true; // (on already: the app opened again — Sing isn't mounted until a command comes)
    let stale = true;
    await ctx.route((u) => /\/(sing|play)\.html$/.test(u.pathname), async (r) => {
      const res = await r.fetch();
      const body = await res.text();
      r.fulfill({ response: res, body: stale ? body.replace(/(<span id="version"[^>]*>)v\d+(<\/span>)/, '$1v0$2') : body });
    });
    const p = await home(ctx);
    let d = await until(p, (x) => x.remote?.on, 10000);
    const other = action === 'score_open' && await p.evaluate(async () => {
      const lib = await import(`./library.js?v=${document.getElementById('version').textContent.trim().replace(/^v/, '')}`);
      const xml = await (await fetch('songs/amazing-grace.musicxml')).text();
      return lib.addSong('Grace Again', xml.replace(/Amazing [Gg]race/g, 'Grace Again'));
    });
    ok(d?.remote?.on && !d.song.loaded && !d.song.scoreLoaded, `${sz.n} stale: the AI button on at boot, Sing and the Score not mounted (${JSON.stringify(d?.remote && { on: d.remote.on })})`);
    const want = action === 'open_song' ? 'amazing-grace' : other;
    const id = await cmdIn(p, action, action === 'open_song' ? { song: 'Amazing Grace' } : { song: other });
    const end = Date.now() + 30000;
    let a = null;
    while (Date.now() < end && !(a = ctx.net.answers.find((x) => x.id === id))) await p.waitForTimeout(100);
    d = await until(p, (x) => x.song.open && !x.song.moving && !x.song.switching, 10000);
    const stamp = await p.evaluate(() => sessionStorage.getItem('resonate.shell.stale'));
    const mounted = action === 'open_song' ? d?.song.loaded && d.song.set.sing : d?.song.scoreLoaded && d.song.set.score;
    ok(a?.status === 'done' && a.result?.ok !== false && p.loads === 1 && !stamp, `${sz.n} stale: ${action} with sing.html / play.html of another badge → run in place and answered (${a?.status}${a?.result?.error ? ' ' + a.result.error : ''}; loads ${p.loads}, stamp ${stamp})`);
    ok(mounted && d.song.state?.song === want, `${sz.n} stale: … the song open, its module mounted (${d?.song.state?.song} ${JSON.stringify(d?.song.set)})`);
    if (action === 'score_open') {
      const saved = await p.evaluate(() => localStorage.getItem('resonate.sing.song'));
      ok(saved === other, `${sz.n} stale: score_open's song is the open song (resonate.sing.song ${saved})`);
      // no command now: the Sing toggle mounts sing.html → the reload, into the song score_open opened
      await tap(p, sz, '#mod-sing');
      d = await until(p, (x) => x.song.open && x.song.loaded && !x.song.moving && !x.song.switching && p.loads > 1, 30000);
      const st = await p.evaluate(() => sessionStorage.getItem('resonate.shell.stale'));
      ok(p.loads === 2 && !!st && d?.song.state?.song === other && d.song.set.sing && d.song.set.score, `${sz.n} stale: then the Sing toggle (no command running) → one reload, back on that song with Sing (${d?.song.state?.song} ${JSON.stringify(d?.song.set)}; loads ${p.loads})`);
    }
    stale = false;
    await closeCtx(ctx);
  }
}

// --- The AI button's gate (a desktop, the account faked): no assistant → none; one connects →
// there at once (Realtime) and remembered; a reload shows it before the cloud answers; the cloud's
// no hides it again; a device whose switch is on keeps it (also when the check fails) until it's
// turned off; the Assistants list marks that device with the same mark.
async function remoteGate(sz) {
  const seed = { 'resonate.auth': JSON.stringify(session()), 'resonate.shell.modules': JSON.stringify({ desktop: ['score', 'piano'] }) };
  const ctx = await context(sz, seed, { cloud: true });
  ctx.net.assistant = false;
  const asked = (n = 1) => ctx.net.log.filter((l) => l === 'GET assistant_activity').length >= n;
  const settle = async (pred, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end && !pred()) await new Promise((r) => setTimeout(r, 100)); await new Promise((r) => setTimeout(r, 400)); };
  let p = await home(ctx);
  await settle(() => asked() && ctx.net.log.some((l) => l === 'POST devices'));
  let b = await aiBtn(p, '#home-remote');
  let d = await dbg(p);
  ok(asked() && b && !b.shown && !d?.remote?.available, `${sz.n} gate: signed in and approved, no assistant has connected — no AI button (${JSON.stringify(b && { shown: b.shown })}, available ${d?.remote?.available}, asked ${asked()})`);
  ok(await SEEN(p) === null, `${sz.n} gate: … nothing remembered (${JSON.stringify(await SEEN(p))})`);
  // An assistant's first tool call: the server's "assistant" broadcast → the button, at once.
  ctx.net.assistant = true;
  const sent = broadcast(ctx, 'assistant', { name: 'Claude', logo: null, tool: 'get_status', at: new Date().toISOString() });
  await p.waitForFunction(() => !document.getElementById('home-remote').hidden, null, { timeout: 5000 }).catch(() => {});
  b = await aiBtn(p, '#home-remote');
  ok(sent > 0 && b?.shown && marked(b) && !b.on && !b.pressed && b.title === LABEL, `${sz.n} gate: an assistant connects (Realtime) → the AI button at once, off: the mark, no words, its label (${sent} sent; ${JSON.stringify(b)})`);
  ok((await SEEN(p))?.a === true, `${sz.n} gate: … remembered for the account (${JSON.stringify(await SEEN(p))})`);
  // A reload: shown before the cloud has answered (the accounts read held), and still after.
  let release;
  ctx.net.hold = new Promise((r) => { release = r; });
  ctx.net.log.length = 0;
  await p.reload();
  await p.waitForFunction(() => window.resonateDebug?.().remote, null, { timeout: 10000 }).catch(() => {});
  await settle(() => ctx.net.log.includes('GET accounts'), 8000);
  b = await aiBtn(p, '#home-remote');
  ok(ctx.net.log.includes('GET accounts') && !ctx.net.log.includes('GET assistant_activity') && b?.shown && marked(b), `${sz.n} gate: a reload shows it at once — before the cloud answers (${JSON.stringify(b && { shown: b.shown, mark: b.mark })}; asked: ${ctx.net.log.join(', ')})`);
  ctx.net.hold = null;
  release();
  await settle(() => asked(), 8000);
  b = await aiBtn(p, '#home-remote');
  ok(asked() && b?.shown && (await dbg(p))?.remote?.available, `${sz.n} gate: … and after the check (an assistant still there)`);
  // Remembered, but the cloud says none: hidden and forgotten.
  ctx.net.assistant = false;
  ctx.net.log.length = 0;
  await p.reload();
  await p.waitForFunction(() => window.resonateDebug?.().remote, null, { timeout: 10000 }).catch(() => {});
  await settle(() => asked() && ctx.net.log.some((l) => l === 'POST devices'));
  b = await aiBtn(p, '#home-remote');
  ok(asked() && !b?.shown && await SEEN(p) === null, `${sz.n} gate: remembered, the check says none → hidden, forgotten (${JSON.stringify(b && { shown: b.shown })}, ${JSON.stringify(await SEEN(p))})`);
  await p.close();
  // This device's switch on, no assistant — and the check failing: shown (so it can be turned off).
  ctx.net.remote = true;
  ctx.net.activityStatus = 500;
  ctx.net.log.length = 0;
  p = await home(ctx);
  await settle(() => asked() && ctx.net.log.some((l) => l === 'POST devices'));
  b = await aiBtn(p, '#home-remote');
  d = await dbg(p);
  ok(asked() && b?.shown && b.on && b.pressed && marked(b) && d?.remote?.on, `${sz.n} gate: the switch on here, the check failing → shown, lit (${JSON.stringify(b)})`);
  ok((await SEEN(p))?.on === true, `${sz.n} gate: … remembered on (${JSON.stringify(await SEEN(p))})`);
  ctx.net.activityStatus = 200;
  // The Assistants list: this device marked with the same mark, on (the devices read answers this one).
  await tap(p, sz, '#avatar');
  await p.waitForSelector('#acct a[href="./?open=assistants"]', { state: 'visible' });
  await tap(p, sz, '#acct a[href="./?open=assistants"]');
  await settled(p, 'assistants');
  await p.waitForFunction(() => document.querySelector('#place-assistants #devices .item'), null, { timeout: 8000 }).catch(() => {});
  const list = await p.evaluate(async () => {
    const box = document.querySelector('#place-assistants #devices');
    const m = await import(`/resonate/assist.js?v=${document.getElementById('version').textContent.trim().replace(/^v/, '')}`);
    const t = document.createElement('template');
    t.innerHTML = m.AI_MARK || '';
    const svg = box?.querySelector('.on svg');
    return { text: box?.textContent || '', on: box?.querySelector('.on')?.textContent.trim(), mark: !!m.AI_MARK && !!svg && t.content.firstElementChild.isEqualNode(svg), note: document.querySelector('#place-assistants #v-devices .note')?.textContent || '' };
  });
  ok(list.mark && list.on === 'on' && !/📡/.test(list.text + list.note) && /AI button/.test(list.note), `${sz.n} gate: Assistants — the device on, marked with the AI mark; its note names the AI button (${JSON.stringify(list)})`);
  await p.goBack();
  await gone(p, 'assistants');
  // Turned off: no assistant, so the button goes (and nothing is remembered).
  await tap(p, sz, '#home-remote');
  d = await until(p, (x) => !x.remote.on, 5000);
  await p.waitForTimeout(300);
  b = await aiBtn(p, '#home-remote');
  ok(!d?.remote.on && !ctx.net.remote && !b?.shown && await SEEN(p) === null, `${sz.n} gate: turned off — off in the cloud, and with no assistant the button goes (${JSON.stringify(b && { shown: b.shown })})`);
  await closeCtx(ctx);
}

// --- sing.html and play.html (their own AI button, the old pages tests still open): none with no
// assistant; with one, the same mark, label and title; on, lit.
async function pages(sz) {
  for (const [url, ready] of [['sing.html', () => !!window.resonateDebug?.()], ['play.html', () => !!window.resonateDebug?.().play]]) {
    for (const assistant of [false, true]) {
      const ctx = await context(sz, { 'resonate.auth': JSON.stringify(session()) }, { cloud: true });
      ctx.net.assistant = assistant;
      ctx.net.remote = assistant; // (with an assistant: this device's switch on — lit)
      const p = await ctx.newPage();
      await p.goto(BASE + url);
      await p.waitForFunction(ready, null, { timeout: 30000 }).catch(() => {});
      const end = Date.now() + 10000;
      while (Date.now() < end && !(ctx.net.log.includes('GET assistant_activity') && ctx.net.log.includes('POST devices'))) await p.waitForTimeout(100);
      await p.waitForTimeout(500);
      const b = await aiBtn(p, '#remote-btn');
      if (!assistant) ok(b && !b.shown, `${sz.n} ${url}: no assistant — its AI button hidden (${JSON.stringify(b && { shown: b.shown })})`);
      else ok(b?.shown && marked(b) && b.on && b.pressed, `${sz.n} ${url}: an assistant connected, the switch on — its AI button shown, lit, the mark, no words (${JSON.stringify(b)})`);
      await closeCtx(ctx);
    }
  }
}

(async () => {
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${FX}/shell/a3.wav`] });
  try {
    if (!ONLY || ONLY.has('phone')) await record(SIZES[0]);
    if (!ONLY || ONLY.has('ipad')) await voice(SIZES[1]);
    if (!ONLY || ONLY.has('desktop')) await remote(SIZES[2]);
    if (!ONLY || ONLY.has('desktop')) await remoteStale(SIZES[2]);
    if (!ONLY || ONLY.has('gate')) await remoteGate(SIZES[2]);
    if (!ONLY || ONLY.has('pages')) await pages(SIZES[2]);
  } catch (err) {
    ok(false, `crashed: ${err.stack || err}`);
  }
  await browser.close();
  done();
})();
