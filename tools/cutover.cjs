// The cut-over (v92, docs/CUTOVER.md): the one-page shell is the site's root. On an iPhone 393×852
// and an iPad 820×1180 (touch):
//   R  the root is the shell (index.html, <html data-shell>) — and no import pill over it, even with
//      an import flag of this space —; tuner.html (a stub since cleanup C phase 4) lands on home
//   S  shell.html (a stub) carries ?search and #hash to the root without a history entry of its own
//   L  each old page lands in the shell in its state (localStorage resonate.redirect = "1": an
//      automated browser stays on the old pages otherwise): sing.html → the last song with Sing,
//      play.html → with the Score, either with no last song → Songs, record / voice / assistants.html
//      → their place, pdf-import.html → the Reader open when an import waits, else Songs;
//      pdf-import.html?reprocess=<song> → that song queued (and converted: the scripted worker)
//   B  Back from a landed song closes it, then leaves to the page before (the old page left no
//      entry); a reload comes home (the address lost ?open)
//   N  nothing runs on a page that is leaving (the shell's answer held back 2.5 s): data-away, no
//      sing.js / play.js / pdf-import.js (no resonateDebug, resonatePlay, resonateBusy), no Verovio,
//      no worker
//   F  the shell's fetch path stays inert: with redirect=1, Sing, the Score, Record, Voice and
//      Assistants mounted in place — no navigation, one load
//   E  the escapes: pdf-import.html?page stays the old page (its Reader's ✕ too); the 3-second
//      fallback link replaces the leaving page; without resonate.redirect an automated
//      browser stays on sing.html; email links (an error, a token) at the root and on sing.html
//      reach account.html
//   G  a stale shell (cleanup C 3.2): sing.html / play.html / voice.html fetched with another badge (v0)
//      → the shell reloads into ./?open=sing / score / voice before mounting it (no sing.js / play.js /
//      voice.js asked for, nothing mounted as it leaves), and lands there; the second time within 10 min
//      it mounts (no loop); not while something is under way; a matching badge mounts in place (F too)
//   node -r ./harness/noshots.cjs cutover.cjs      (BASE=http://localhost:8097/resonate/; ONLY=iphone; PARTS=N,E)
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:8097/resonate/';
const ROOT_PATH = new URL(BASE).pathname; // '/resonate/'
const FX = '/home/user/tools/fixtures';
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const PARTS = process.env.PARTS ? new Set(process.env.PARTS.split(',')) : null; // (R,S,L,B,N,F,E,G: their groups)

let passes = 0, fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`); if (c) passes++; else fails++; return c; };
const wait = (t) => new Promise((r) => setTimeout(r, t));

// --- the scripted worker (shell.cjs / shellplaces.cjs) ---------------------------------------------
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
    await new Promise((r) => setTimeout(r, 30));
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
  { n: 'iphone', w: 393, h: 852, dev: 'phone' },
  { n: 'ipad', w: 820, h: 1180, dev: 'tablet' },
];

let browser;
// seed: localStorage set once per context (the first page), before any script; redirect: the old
// pages go into the shell (resonate.redirect = "1"). hold: the shell's answer to ?open= held back
// (ms) — the leaving page stays current meanwhile.
async function context(sz, { seed = {}, redirect = true, hold = 0 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: sz.w, height: sz.h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, permissions: ['microphone'] });
  await ctx.route('**/omr/omr-worker.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: fakeWorker(FULL) }));
  await ctx.route('**/*.supabase.co/**', (r) => r.abort());
  ctx.reqs = [];
  ctx.released = 0;
  if (hold) {
    await ctx.route((u) => u.pathname === ROOT_PATH && /[?&]open=/.test(u.search), async (r) => { await wait(hold); ctx.released = Date.now(); r.continue(); });
  }
  await ctx.addInitScript(({ seed, redirect }) => {
    try {
      if (location.protocol === 'about:' || sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
      if (redirect) localStorage.setItem('resonate.redirect', '1');
    } catch {}
  }, { seed, redirect });
  // On the old pages: did their own scripts run? (sessionStorage: kept across the tab's navigations)
  await ctx.addInitScript(() => {
    if (!/\/(sing|play|pdf-import|record|voice|assistants)\.html$/.test(location.pathname)) return;
    const page = location.pathname.split('/').pop();
    const mark = (what) => { try { sessionStorage.setItem('__ran', (sessionStorage.getItem('__ran') || '') + `${page}:${what} `); } catch {} };
    for (const k of ['resonateDebug', 'resonatePlay', 'resonateBusy', 'resonateSing']) {
      let val;
      Object.defineProperty(window, k, { configurable: true, get: () => val, set: (v) => { val = v; mark(k); } });
    }
    const W = window.Worker;
    window.Worker = function (...a) { mark('Worker'); return new W(...a); };
    // (what the page was like as it left: read from the next page — its document is gone by then)
    addEventListener('pagehide', () => {
      const html = document.documentElement;
      try {
        sessionStorage.setItem('__leave', JSON.stringify({ page, away: html.hasAttribute('data-away'), hidden: getComputedStyle(html).visibility,
          dbg: typeof window.resonateDebug, play: typeof window.resonatePlay, busy: typeof window.resonateBusy, at: Date.now() }));
      } catch {}
    });
  });
  ctx.errors = [];
  ctx.on('request', (r) => ctx.reqs.push({ url: r.url(), at: Date.now() }));
  ctx.on('page', (p) => {
    p.navs = [];
    p.on('framenavigated', (f) => { if (f === p.mainFrame()) p.navs.push(f.url()); });
    p.loads = 0;
    p.on('load', () => { p.loads++; });
    p.on('pageerror', (e) => ctx.errors.push(`${p.url().split('/').pop()}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|supabase|Failed to fetch|sync|WebSocket|ERR_/i.test(m.text())) ctx.errors.push(`${p.url().split('/').pop()}: ${m.text()}`); });
  });
  return ctx;
}
async function closeCtx(ctx, what) {
  ok(!ctx.errors.length, `${what}: no page errors${ctx.errors.length ? ': ' + ctx.errors.slice(0, 4).join(' | ') : ''}`);
  await ctx.close();
}
const dbg = (p) => p.evaluate(() => { const d = window.resonateDebug?.(); return d && d.tuner ? { song: d.song, place: d.place, import: d.import, overlay: d.overlay, url: location.pathname + location.search + location.hash, shell: document.documentElement.hasAttribute('data-shell') } : null; }).catch(() => null);
async function until(p, pred, ms = 15000) {
  const end = Date.now() + ms;
  let d = null;
  while (Date.now() < end) { d = await dbg(p); try { if (d && pred(d)) return d; } catch {} await p.waitForTimeout(100); }
  return d;
}
const atRoot = (p) => { const u = new URL(p.url()); return u.pathname === ROOT_PATH; };
const shown = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && e.getClientRects().length > 0; }, sel).catch(() => false);
// An old page, opened by address: lands where it lands (waitUntil commit: it may never load).
async function land(ctx, url) {
  const p = await ctx.newPage();
  await p.goto(BASE + url, { waitUntil: 'commit' });
  await p.waitForURL((u) => u.pathname === ROOT_PATH, { timeout: 15000 }).catch(() => {});
  await p.waitForFunction(() => window.resonateDebug?.().tuner, null, { timeout: 15000 }).catch(() => {});
  return p;
}
async function addPdfSong(p, title) {
  return p.evaluate(async (title) => {
    const v = document.getElementById('version').textContent.trim().slice(1);
    const L = await import(`/resonate/library.js?v=${v}`);
    const pdf = await (await fetch('/imp/amazing-grace1.pdf')).arrayBuffer();
    return L.addPdfSong(pdf, { name: `${title}.pdf`, title });
  }, title);
}
// An unfinished import of this space, as PDF → Song leaves one (the job and its PDF, the flag).
async function seedImport(p) {
  return p.evaluate(async () => {
    const v = document.getElementById('version').textContent.trim().slice(1);
    const J = await import(`/resonate/omr/jobs.js?v=${v}`);
    const { ENGINE } = await import(`/resonate/omr/omr.js?v=${v}`);
    const sp = await import(`/resonate/space.js?v=${v}`);
    const pdf = await (await fetch('/imp/amazing-grace1.pdf')).arrayBuffer();
    const job = { id: J.newId(), space: sp.activeSpace(), db: sp.dbName(), name: 'amazing-grace1.pdf', size: pdf.byteLength, type: 'application/pdf', engine: ENGINE, app: 'test',
      created: Date.now(), phase: 'prep', music: null, of: null, title: null, tempo: null, done: [], failed: [], starts: {}, lefts: {}, fails: {}, stage: null, runs: 0, skip: [] };
    await J.createJob(job, pdf);
    J.setFlag(job);
    return job.id;
  });
}

// --- R + S: the root, tuner.html, the stub --------------------------------------------------------
async function rootAndStub(sz) {
  const flag = JSON.stringify({ id: 'jgone', db: 'resonate', space: 'anon', name: 'x.pdf', done: 0, of: 2, page: 1, pages: 2, at: Date.now() });
  const ctx = await context(sz, { seed: { 'resonate.import': flag } });
  let p = await ctx.newPage();
  await p.goto(BASE);
  await p.waitForFunction(() => window.resonateDebug?.().tuner, null, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(1800); // (nav.js's pill would be up by now)
  const r = await p.evaluate(() => ({ shell: document.documentElement.hasAttribute('data-shell'), tuner: !!window.resonateDebug?.().tuner, home: !!document.getElementById('main-btn'),
    pill: !!document.getElementById('import-pill'), brand: document.getElementById('brand')?.getAttribute('href'), title: document.title }));
  ok(r.shell && r.tuner && r.home && atRoot(p), `${sz.n} R: the root is the shell (${JSON.stringify(r)})`);
  ok(!r.pill, `${sz.n} R: no import pill over the shell, an import flag of this space set`);
  ok(r.brand === './', `${sz.n} R: the brand links to ./ (${r.brand})`);
  ok(!ctx.reqs.some((q) => /vendor\/supabase/.test(q.url)), `${sz.n} R: signed out, the sign-in library isn't loaded`);
  await p.goto(BASE + 'index.html');
  await p.waitForFunction(() => window.resonateDebug?.().tuner, null, { timeout: 15000 }).catch(() => {});
  ok(await p.evaluate(() => document.documentElement.hasAttribute('data-shell')), `${sz.n} R: index.html is the shell`);

  // tuner.html: a stub since cleanup C phase 4 (the old Tuner went) — an old link lands home, no entry of its own
  await p.goto(BASE + 'tools.html');
  const ht = await p.evaluate(() => history.length);
  await p.goto(BASE + 'tuner.html', { waitUntil: 'commit' });
  await p.waitForURL((u) => u.pathname === ROOT_PATH, { timeout: 10000 }).catch(() => {});
  await p.waitForFunction(() => window.resonateDebug?.().tuner, null, { timeout: 15000 }).catch(() => {});
  const t = await p.evaluate(() => ({ path: location.pathname, search: location.search, shell: document.documentElement.hasAttribute('data-shell'), hist: history.length, song: window.resonateDebug?.().song?.open, overlay: window.resonateDebug?.().overlay }));
  ok(t.path === ROOT_PATH && t.shell && !t.search && !t.song && !t.overlay && t.hist === ht + 1, `${sz.n} R: tuner.html (a stub) → home, no entry of its own (${JSON.stringify(t)})`);
  const stub = await (await fetch(BASE + 'tuner.html')).text();
  ok(!/id="version"/.test(stub) && !/app\.js/.test(stub), `${sz.n} R: the stub has no badge and no app.js`);

  // S: tools.html → shell.html?x=1#frag: the root with both, one entry
  await p.goto(BASE + 'tools.html');
  const h0 = await p.evaluate(() => history.length);
  await p.goto(BASE + 'shell.html?x=1#frag', { waitUntil: 'commit' });
  await p.waitForURL((u) => u.pathname === ROOT_PATH, { timeout: 10000 }).catch(() => {});
  await p.waitForFunction(() => window.resonateDebug?.().tuner, null, { timeout: 15000 }).catch(() => {});
  const s = await p.evaluate(() => ({ path: location.pathname, search: location.search, hash: location.hash, hist: history.length, shell: document.documentElement.hasAttribute('data-shell') }));
  ok(s.path === ROOT_PATH && s.search === '?x=1' && s.hash === '#frag' && s.shell, `${sz.n} S: shell.html → the root with ?search and #hash (${s.path}${s.search}${s.hash})`);
  ok(s.hist === h0 + 1, `${sz.n} S: the stub left no history entry (${h0} → ${s.hist})`);
  await p.goBack({ waitUntil: 'commit' }).catch(() => {});
  await p.waitForTimeout(500);
  ok(/tools\.html$/.test(p.url()), `${sz.n} S: Back from there is the page before (${p.url().split('/').pop()})`);
  await closeCtx(ctx, `${sz.n} root`);
}

// --- L + B: the old pages land in the shell ---------------------------------------------------------
async function landings(sz) {
  // sing.html / play.html: the last song with Sing / the Score, for it only; Back, then the page before
  {
    const ctx = await context(sz, { seed: { 'resonate.sing.song': 'amazing-grace' } });
    const p = await ctx.newPage();
    await p.goto(BASE + 'tools.html');
    const h0 = await p.evaluate(() => history.length);
    await p.goto(BASE + 'sing.html', { waitUntil: 'commit' });
    await p.waitForURL((u) => u.pathname === ROOT_PATH, { timeout: 15000 }).catch(() => {});
    let d = await until(p, (x) => x.song?.open && x.song.set.sing && x.song.loaded && !x.song.moving, 20000);
    ok(!!d?.song?.open && d.song.set.sing && d.song.state?.song === 'amazing-grace' && atRoot(p) && !/open=/.test(p.url()),
      `${sz.n} L: sing.html → the shell, the last song with Sing (${JSON.stringify(d?.song?.set)}, ${new URL(p.url()).pathname}${new URL(p.url()).search})`);
    const saved = await p.evaluate(() => localStorage.getItem('resonate.shell.modules'));
    ok(!saved, `${sz.n} L: Sing shown for that song only (no module set saved: ${saved})`);
    const hist = await p.evaluate(() => history.length);
    ok(hist === h0 + 2, `${sz.n} B: no entry for sing.html — the shell's and the song's (${h0} → ${hist})`);
    await p.goBack();
    d = await until(p, (x) => !x.song.open, 8000);
    ok(!d?.song?.open && atRoot(p) && !!d?.shell, `${sz.n} B: Back closes the song, home in the shell (${p.url().split('/').slice(3).join('/')})`);
    await p.goBack({ waitUntil: 'commit' }).catch(() => {});
    await p.waitForTimeout(600);
    ok(/tools\.html$/.test(p.url()), `${sz.n} B: Back again: the page before sing.html (${p.url().split('/').pop()})`);

    // play.html: the Score; a reload comes home
    await p.goto(BASE + 'play.html', { waitUntil: 'commit' });
    await p.waitForURL((u) => u.pathname === ROOT_PATH, { timeout: 15000 }).catch(() => {});
    d = await until(p, (x) => x.song?.open && x.song.set.score && x.song.scoreLoaded && !x.song.moving, 30000);
    ok(!!d?.song?.open && d.song.set.score && (sz.dev !== 'phone' || !d.song.set.sing) && atRoot(p), `${sz.n} L: play.html → the shell, the last song with the Score (${JSON.stringify(d?.song?.set)})`);
    await p.reload();
    await p.waitForFunction(() => window.resonateDebug?.().tuner, null, { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(800);
    d = await dbg(p);
    ok(!!d && !d.song.open && atRoot(p) && !/open=/.test(p.url()), `${sz.n} B: a reload comes home (${p.url().split('/').slice(3).join('/')}, song open ${d?.song?.open})`);
    await closeCtx(ctx, `${sz.n} sing/play`);
  }
  // no last song: Songs
  for (const pg of ['sing.html', 'play.html']) {
    const ctx = await context(sz);
    const p = await land(ctx, pg);
    const d = await until(p, (x) => x.overlay === 'songs', 8000);
    ok(d?.overlay === 'songs' && !d.song.open && await shown(p, '#songs'), `${sz.n} L: ${pg} with no last song → Songs (${d?.overlay})`);
    await closeCtx(ctx, `${sz.n} ${pg} no song`);
  }
  // record / voice / assistants: their place
  {
    const ctx = await context(sz);
    for (const name of ['record', 'voice', 'assistants']) {
      const p = await land(ctx, `${name}.html`);
      const d = await until(p, (x) => x.place?.open === name, 10000);
      ok(d?.place?.open === name && await shown(p, `#place-${name}`) && atRoot(p) && !/open=/.test(p.url()), `${sz.n} L: ${name}.html → the shell with ${name} in place (${d?.place?.open}, ${p.url().split('/').slice(3).join('/')})`);
      await p.close();
    }
    await closeCtx(ctx, `${sz.n} places`);
  }
  // pdf-import.html: the Reader when an import waits, else Songs; ?reprocess= queues
  {
    const ctx = await context(sz);
    let p = await ctx.newPage();
    await p.goto(BASE + 'tools.html');
    await seedImport(p);
    await p.close();
    p = await land(ctx, 'pdf-import.html');
    let d = await until(p, (x) => x.import?.mode === 'open' && x.overlay === 'tray', 10000);
    ok(d?.import?.mode === 'open' && d.overlay === 'tray' && atRoot(p), `${sz.n} L: pdf-import.html with an import waiting → the Reader, open (${d?.import?.mode}, ${d?.overlay})`);
    d = await until(p, (x) => x.import?.result?.songId, 30000);
    ok(!!d?.import?.result?.songId, `${sz.n} L: … and it goes on to the end (${d?.import?.result?.title})`);
    await p.close();

    p = await land(ctx, 'pdf-import.html');
    d = await until(p, (x) => x.overlay === 'songs', 8000);
    ok(d?.overlay === 'songs' && !d.import.running && atRoot(p), `${sz.n} L: pdf-import.html with nothing waiting → Songs (${d?.overlay})`);
    const id = await addPdfSong(p, 'Cutover PDF');
    await p.close();

    p = await land(ctx, `pdf-import.html?reprocess=${id}`);
    d = await until(p, (x) => x.import?.song?.id === id || x.import?.queue?.ids?.includes(id), 10000);
    ok(!!d && (d.import.song?.id === id || d.import.queue.ids.includes(id)) && atRoot(p) && !/reprocess=/.test(p.url()), `${sz.n} L: pdf-import.html?reprocess=<song> → queued in the shell (${JSON.stringify(d?.import?.song)})`);
    ok(d?.overlay === 'songs', `${sz.n} L: … Songs shown, its row converting (${d?.overlay})`);
    d = await until(p, (x) => !x.import.running && !x.import.song && !x.import.queue.ids.length, 40000);
    const k = await p.evaluate(async (id) => {
      const v = document.getElementById('version').textContent.trim().slice(1);
      return (await (await import(`/resonate/catalog.js?v=${v}`)).songInfo(id))?.k;
    }, id);
    ok(k === 'conv', `${sz.n} L: … and converted under its id (${k})`);
    await closeCtx(ctx, `${sz.n} pdf-import`);
  }
}

// --- N: nothing runs on a page that is leaving -------------------------------------------------------
async function leaving(sz) {
  for (const [pg, seed, setup] of [
    ['sing.html', { 'resonate.sing.song': 'amazing-grace' }],
    ['play.html', { 'resonate.sing.song': 'amazing-grace' }],
    ['pdf-import.html', {}, seedImport],
  ]) {
    const ctx = await context(sz, { seed, hold: 2500 });
    let p = await ctx.newPage();
    await p.goto(BASE + 'tools.html');
    if (setup) await setup(p);
    await p.evaluate(() => { sessionStorage.removeItem('__ran'); sessionStorage.removeItem('__leave'); });
    const t0 = Date.now();
    await p.goto(BASE + pg, { waitUntil: 'commit' });
    // (the shell's answer held back: the old page stays the one shown until then — what it did meanwhile
    // is read from the shell, as it was when it left)
    await p.waitForURL((u) => u.pathname === ROOT_PATH, { timeout: 15000 }).catch(() => {});
    await p.waitForFunction(() => window.resonateDebug?.().tuner, null, { timeout: 15000 }).catch(() => {});
    const old = await p.evaluate(() => ({ ...JSON.parse(sessionStorage.getItem('__leave') || '{}'), ran: sessionStorage.getItem('__ran') || '' }));
    const held = ctx.released - t0;
    const before = ctx.reqs.filter((r) => r.at >= t0 && r.at < ctx.released);
    const heavy = before.filter((r) => /verovio|omr-worker|cheerpj|ocr-engine/i.test(r.url)).map((r) => r.url.split('/').pop());
    ok(held >= 2400 && old.page === pg && old.away && old.dbg === 'undefined' && old.play === 'undefined' && old.busy === 'undefined' && !old.ran,
      `${sz.n} N: ${pg} kept ${held} ms on its way out: data-away, its modules never ran (${JSON.stringify(old)})`);
    ok(!heavy.length, `${sz.n} N: ${pg} leaving: no Verovio, no worker (${before.length} requests: ${heavy.join(', ') || 'none heavy'})`);
    ok(old.hidden === 'hidden', `${sz.n} N: ${pg} leaving: not shown on its way out (${old.hidden})`);
    ok(atRoot(p), `${sz.n} N: ${pg}: then the shell (${p.url().split('/').slice(3).join('/')})`);
    await closeCtx(ctx, `${sz.n} leaving ${pg}`);
  }
  // The page on its way out with the answer never coming, two ways (Chromium stops a page's loading
  // as its navigation starts, so the held answer above can't tell what holds the modules back):
  //   stay — away.js itself, its location.replace a no-op: it stops the page, nothing after it runs;
  //   mark — only the marker nav.js reads (data-away): nav.js's wait holds its importers back (here;
  //          WebKit runs them anyway — tools/cutoverwk.mjs — which is why away.js stops the page).
  const AWAY = fs.readFileSync(require('path').join(__dirname, '../public/away.js'), 'utf8').replace('location.replace(', '(function () {})(');
  for (const how of ['stay', 'mark']) {
    for (const [pg, seed, setup, heavyRe] of [
      ['sing.html', { 'resonate.sing.song': 'amazing-grace' }, null, /songs\/amazing-grace|\.mp3/], // (what runs fetches: its static imports are fetched, never run)
      ['play.html', { 'resonate.sing.song': 'amazing-grace' }, null, /verovio|songs\/amazing-grace/],
      ['pdf-import.html', {}, seedImport, /omr-worker/],
    ]) {
      const ctx = await context(sz, { seed, redirect: how === 'stay' });
      await ctx.route((u) => u.pathname.endsWith('/' + pg), async (r) => {
        const res = await r.fetch();
        const body = (await res.text()).replace(/<script src="away\.js[^"]*" data-open="([a-z]+)"><\/script>/,
          (m, o) => (how === 'stay' ? `<script data-open="${o}">${AWAY}</script>` : '<script>document.documentElement.setAttribute("data-away", "")</script>'));
        r.fulfill({ response: res, body });
      });
      const p = await ctx.newPage();
      await p.goto(BASE + 'tools.html');
      if (setup) await setup(p);
      const t0 = Date.now();
      await p.goto(BASE + pg, { waitUntil: 'commit' });
      await p.waitForTimeout(3300);
      const st = await p.evaluate(() => ({ away: document.documentElement.hasAttribute('data-away'), ran: sessionStorage.getItem('__ran') || '', dbg: typeof window.resonateDebug, busy: typeof window.resonateBusy,
        link: document.querySelector('a[href^="./?open="]')?.getAttribute('href') || null, shown: getComputedStyle(document.documentElement).visibility }));
      const heavy = ctx.reqs.filter((r) => r.at >= t0 && heavyRe.test(r.url)).map((r) => r.url.split('/').pop());
      if (how === 'stay') ok(st.shown === 'visible' && /^\.\/\?open=[a-z]+$/.test(st.link || ''), `${sz.n} N: ${pg}: the shell not there after 3 s — a plain link to it (${st.link}, ${st.shown})`);
      ok(st.away && !st.ran && st.dbg === 'undefined' && st.busy === 'undefined' && !heavy.length && p.url().endsWith(pg),
        `${sz.n} N: ${pg} ${how === 'stay' ? 'on its way out (away.js), the answer never coming' : 'marked leaving (nav.js\'s wait alone)'}, 3 s later: none of its modules ran (${JSON.stringify({ ...st, link: undefined })}; ${heavy.join(', ') || 'nothing heavy'})`);
      await closeCtx(ctx, `${sz.n} ${how} ${pg}`);
    }
  }
}

// --- F: the shell's fetch path stays inert with redirect on ------------------------------------------
async function inert(sz) {
  const ctx = await context(sz, { seed: { 'resonate.sing.song': 'amazing-grace', 'resonate.shell.modules': JSON.stringify({ phone: ['sing', 'score'], tablet: ['sing', 'score', 'piano'] }) } });
  const p = await ctx.newPage();
  await p.goto(BASE);
  await p.waitForFunction(() => window.resonateDebug?.().tuner, null, { timeout: 15000 });
  await p.waitForTimeout(400);
  const navs0 = p.navs.length, loads0 = p.loads;
  await p.tap('#nextup');
  let d = await until(p, (x) => x.song?.open && x.song.loaded && x.song.scoreLoaded && !x.song.moving, 30000);
  ok(!!d?.song?.loaded && d.song.scoreLoaded, `${sz.n} F: Sing and the Score mounted in place (sing.html, play.html fetched)`);
  for (const name of ['record', 'voice', 'assistants']) {
    await p.evaluate((n) => { const a = document.createElement('a'); a.href = `${n}.html`; document.body.append(a); a.click(); a.remove(); }, name);
    d = await until(p, (x) => x.place?.open === name && x.place.loaded.includes(name), 10000);
    ok(d?.place?.open === name, `${sz.n} F: ${name} in place (${d?.place?.open})`);
    await p.keyboard.press('Escape');
    await until(p, (x) => !x.place?.open, 5000);
  }
  await p.waitForTimeout(500);
  const away = p.navs.slice(navs0).filter((u) => new URL(u).pathname !== ROOT_PATH);
  ok(!away.length && p.loads === loads0 && atRoot(p), `${sz.n} F: no navigation while the shell mounts the old pages (${away.join(', ') || 'none'}; loads ${loads0} → ${p.loads})`);
  await closeCtx(ctx, `${sz.n} inert`);
}

// --- G: a stale shell reloads instead of mixing versions ------------------------------------------
// (the page fetched for a mount — sing.html, play.html or voice.html: `page` — answered with badge v0
// while ctx.stale; what the shell had mounted as it left: sessionStorage __shellLeave)
async function staleCtx(sz, page, seed) {
  const ctx = await context(sz, { seed });
  ctx.stale = true;
  await ctx.route((u) => u.pathname.endsWith(`/${page}`), async (r) => {
    const res = await r.fetch();
    const body = await res.text();
    r.fulfill({ response: res, body: ctx.stale ? body.replace(/(<span id="version"[^>]*>)v\d+(<\/span>)/, '$1v0$2') : body });
  });
  await ctx.addInitScript(() => {
    if (!/\/resonate\/(index\.html)?$/.test(location.pathname)) return;
    addEventListener('pagehide', () => {
      try {
        sessionStorage.setItem('__shellLeave', JSON.stringify({ sing: !!document.getElementById('sing-css'), score: !!document.getElementById('play-css'),
          place: !!document.querySelector('#places > .sheet'), url: location.pathname + location.search }));
      } catch {}
    });
  });
  return ctx;
}
const docReqs = (ctx, t0, re) => ctx.reqs.filter((q) => q.at >= t0 && re.test(new URL(q.url).pathname + new URL(q.url).search));
async function stale(sz) {
  const K = { sing: ['sing.html', /\/sing\.js/], score: ['play.html', /\/play\.js/], voice: ['voice.html', /\/voice\.js/] };
  for (const what of ['sing', 'score', 'voice']) {
    const [page, script] = K[what];
    const ctx = await staleCtx(sz, page, { 'resonate.sing.song': 'amazing-grace' });
    const p = await ctx.newPage();
    const t0 = Date.now();
    // sing: Next-up (opens with Sing); score: the address (the Score shown for the song); voice: a link to its place
    await p.goto(BASE + (what === 'score' ? '?open=score' : ''));
    await p.waitForFunction(() => window.resonateDebug?.().tuner, null, { timeout: 15000 });
    if (what === 'sing') { await p.waitForTimeout(300); await p.tap('#nextup'); }
    if (what === 'voice') { await p.waitForTimeout(300); await p.evaluate(() => { const a = document.createElement('a'); a.href = './?open=voice'; document.body.append(a); a.click(); a.remove(); }); }
    const d = what === 'voice' ? await until(p, (x) => x.place?.open === 'voice' && x.place.loaded.includes('voice') && p.loads > 1, 20000)
      : await until(p, (x) => x.song?.open && (what === 'sing' ? x.song.loaded : x.song.scoreLoaded) && !x.song.moving && p.loads > 1, 30000);
    await p.waitForTimeout(1500);
    const fetched = docReqs(ctx, t0, new RegExp(`/${page.replace('.', '\\.')}\\?v=`))[0]?.at ?? Infinity;
    const reload = docReqs(ctx, fetched, new RegExp(`^/resonate/\\?open=${what}$`));
    const early = ctx.reqs.filter((q) => q.at >= fetched && q.at < (reload[0]?.at ?? Infinity) && script.test(q.url)).map((q) => q.url.split('/').pop());
    const left = await p.evaluate(() => JSON.parse(sessionStorage.getItem('__shellLeave') || 'null'));
    ok(fetched < Infinity && reload.length === 1 && p.loads === 2,
      `${sz.n} G: ${page} with another badge → one reload into ./?open=${what} (${reload.length} reloads, ${p.loads} loads)`);
    ok(!early.length && !!left && !left[what === 'voice' ? 'place' : what], `${sz.n} G: … before mounting it (${early.join(', ') || 'no script asked for'}; as it left: ${JSON.stringify(left)})`);
    const there = what === 'voice' ? d?.place?.open === 'voice' : !!d?.song?.open && d.song.state?.song === 'amazing-grace' && d.song.set[what];
    const stamp = await p.evaluate(() => sessionStorage.getItem('resonate.shell.stale'));
    ok(there && !!stamp && atRoot(p) && !/open=/.test(p.url()), `${sz.n} G: … lands there: the second try within 10 min mounts it, no loop (${what === 'voice' ? d?.place?.open : JSON.stringify(d?.song?.set)}, ${p.url().split('/').slice(3).join('/')})`);
    await closeCtx(ctx, `${sz.n} stale ${what}`);
  }
  // not while something is under way; a matching badge mounts in place
  for (const how of ['busy', 'same']) {
    const ctx = await staleCtx(sz, 'voice.html', {});
    ctx.stale = how === 'busy';
    const p = await ctx.newPage();
    await p.goto(BASE);
    await p.waitForFunction(() => window.resonateDebug?.().tuner, null, { timeout: 15000 });
    await p.waitForTimeout(300);
    const t0 = Date.now();
    await p.evaluate((busy) => {
      if (busy) window.resonateBusy = () => true;
      const a = document.createElement('a'); a.href = './?open=voice'; document.body.append(a); a.click(); a.remove();
    }, how === 'busy');
    const d = await until(p, (x) => x.place?.open === 'voice' && x.place.loaded.includes('voice'), 15000);
    await p.waitForTimeout(800);
    const stamp = await p.evaluate(() => sessionStorage.getItem('resonate.shell.stale'));
    const reloads = docReqs(ctx, t0, /^\/resonate\/\?open=/).length;
    ok(d?.place?.open === 'voice' && p.loads === 1 && !reloads && !stamp,
      `${sz.n} G: ${how === 'busy' ? 'another badge while something is under way' : 'a matching badge'}: Voice mounted in place, no reload (${d?.place?.open}; loads ${p.loads}, reloads ${reloads}, stamp ${stamp})`);
    await closeCtx(ctx, `${sz.n} stale ${how}`);
  }
}

// --- E: the escapes ----------------------------------------------------------------------------------
async function escapes(sz) {
  {
    const ctx = await context(sz);
    let p = await ctx.newPage();
    await p.goto(BASE + 'pdf-import.html?page');
    await p.waitForTimeout(1500);
    let r = await p.evaluate(() => ({ path: location.pathname, away: document.documentElement.hasAttribute('data-away'), dbg: typeof window.resonateDebug }));
    ok(r.path.endsWith('pdf-import.html') && !r.away && r.dbg === 'function', `${sz.n} E: pdf-import.html?page stays the old page (${JSON.stringify(r)})`);
    // the Reader's ✕ → Stop? there: back to the picker on the same page (?page kept — v92 review)
    await p.setInputFiles('#file', `${FX}/import/greensleeves3.pdf`);
    const stop = p.locator('.rd-stop');
    await stop.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    const reloaded = p.waitForEvent('load', { timeout: 10000 }).catch(() => {});
    await stop.click().catch(() => {});
    await stop.click().catch(() => {});
    await reloaded;
    await p.waitForTimeout(1500);
    r = await p.evaluate(() => ({ path: location.pathname, search: location.search, away: document.documentElement.hasAttribute('data-away'), shell: document.documentElement.hasAttribute('data-shell') })).catch((e) => ({ err: String(e) }));
    ok(/pdf-import\.html$/.test(r.path || '') && r.search === '?page' && !r.away && !r.shell, `${sz.n} E: ✕ → Stop? on pdf-import.html?page stays there, at the picker (${JSON.stringify(r)})`);
    await p.close();
    // an email link's error on sing.html and at the root → account.html; a token at the root too
    for (const [url, what] of [['sing.html#error=access_denied&error_code=otp_expired&error_description=x', 'sing.html'], ['#error=access_denied&error_code=otp_expired&error_description=x', 'the root']]) {
      p = await ctx.newPage();
      await p.goto(BASE + url, { waitUntil: 'commit' });
      await p.waitForURL(/account\.html/, { timeout: 10000 }).catch(() => {});
      await p.waitForFunction(() => /expired/.test(document.getElementById('msg')?.textContent || ''), null, { timeout: 10000 }).catch(() => {});
      r = await p.evaluate(() => ({ path: location.pathname, msg: document.getElementById('msg')?.textContent || '' })).catch(() => ({}));
      ok(/account\.html$/.test(r.path || '') && /expired/.test(r.msg), `${sz.n} E: an email link's error on ${what} → account.html ("${r.msg}")`);
      await p.close();
    }
    p = await ctx.newPage();
    await p.goto(BASE + '#access_token=x.y.z&refresh_token=r&type=recovery', { waitUntil: 'commit' });
    await p.waitForURL(/account\.html/, { timeout: 10000 }).catch(() => {});
    ok(/account\.html$/.test(new URL(p.url()).pathname), `${sz.n} E: an email link's token at the root → account.html (${new URL(p.url()).pathname})`);
    await p.close();
    await ctx.close(); // (the account page's own errors with no network aren't this suite's)
  }
  {
    // the 3-second fallback link (the shell slow to come): a tap replaces the leaving page, so Back
    // from the shell goes to the page before it, not to the hidden old page (v92 review)
    const ctx = await context(sz, { hold: 6000 });
    const p = await ctx.newPage();
    await p.goto(BASE + 'tools.html');
    await p.goto(BASE + 'sing.html', { waitUntil: 'commit' });
    const link = p.locator('a', { hasText: 'Resonate ›' });
    await link.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
    await link.tap().catch(() => {});
    await p.waitForFunction(() => document.documentElement.hasAttribute('data-shell'), null, { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(800);
    // Back until the address leaves the shell (a landed song may take one Back of its own)
    let back = '';
    for (let i = 0; i < 3; i++) {
      await p.goBack({ waitUntil: 'commit', timeout: 8000 }).catch(() => {});
      await p.waitForTimeout(800);
      back = new URL(p.url()).pathname;
      if (!back.endsWith('/resonate/')) break;
    }
    ok(back.endsWith('tools.html'), `${sz.n} E: the fallback link, tapped, leaves no entry: Back from the shell reaches tools.html (${back})`);
    await closeCtx(ctx, `${sz.n} fallback link`);
  }
  {
    const ctx = await context(sz, { redirect: false });
    const p = await ctx.newPage();
    await p.goto(BASE + 'sing.html');
    await p.waitForFunction(() => window.resonateDebug, null, { timeout: 15000 }).catch(() => {});
    const r = await p.evaluate(() => ({ path: location.pathname, away: document.documentElement.hasAttribute('data-away'), dbg: typeof window.resonateDebug }));
    ok(r.path.endsWith('sing.html') && !r.away && r.dbg === 'function', `${sz.n} E: an automated browser without resonate.redirect stays on sing.html (the old suites)`);
    await closeCtx(ctx, `${sz.n} no redirect`);
  }
}

(async () => {
  browser = await chromium.launch();
  for (const sz of SIZES) {
    if (ONLY && !ONLY.has(sz.n)) continue;
    console.log(`\n=== ${sz.n} ${sz.w}×${sz.h}`);
    const part = (k) => !PARTS || PARTS.has(k);
    if (part('R') || part('S')) await rootAndStub(sz);
    if (part('L') || part('B')) await landings(sz);
    if (part('N')) await leaving(sz);
    if (part('F')) await inert(sz);
    if (part('E')) await escapes(sz);
    if (part('G')) await stale(sz);
  }
  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
