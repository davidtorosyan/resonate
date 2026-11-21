// The shell preview (index.html: home = the full tuner, Songs, + Add, the Reader tray, the account
// corner) at five sizes: iPhone 393×852, iPhone Safari 393×659, iPad 820×1180 / 1180×820, desktop
// 1440×900. Chromium with a fake mic playing an A3 tone (fixtures/shell/a3.wav); the PDF import runs
// on a scripted worker (as importfixes.cjs: trace blocks from fixtures/trace, the MusicXML), so a
// conversion takes seconds. v90: + Add → PDF stores a PDF-only song at once (one file opens on its
// PDF); converting it is ⋯ → Convert (or the header's Convert all), in the background, folded — the
// done row "✓ Title · ready" / "✓ 2 converted" (songlib.cjs tests the library's flows in depth).
//   node shell.cjs                    (http://localhost:8097/resonate/, screenshots into SHOTS)
//   ONLY=iphone,ipad-p node shell.cjs
//   SHOTS=0 node shell.cjs            (no screenshots; or node -r ./harness/noshots.cjs)
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:8097/resonate/';
const SHOTS = process.env.SHOTS === '0' ? null : process.env.SHOTS || path.join(os.tmpdir(), 'resonate-shell');
const FX = path.join(__dirname, 'fixtures');
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

let passes = 0, fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`); if (c) passes++; else fails++; return c; };

// --- the scripted worker (importfixes.cjs fakeWorker) -------------------------------------------
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
    if (k === 'wait') await new Promise((r) => setTimeout(r, a));
    else if (k === 'post') self.postMessage(a);
    else if (k === 'log') self.postMessage({ type: 'log', line: a });
    else if (k === 'trace') self.postMessage({ type: 'trace', block: a });
    else if (k === 'done') { const m = buf(a); self.postMessage({ type: 'done', mxls: [m] }, [m]); return; }
    else if (k === 'hang') return;
    await new Promise((r) => setTimeout(r, 15));
  }
};`;
}
const MILESTONES = [['post', { type: 'engine', milestone: 'fetch' }], ['post', { type: 'engine', milestone: 'jvm' }],
  ['log', 'INFO  [score]                       Main 280  | Audiveris'], ['post', { type: 'engine', milestone: 'start' }],
  ['post', { type: 'engine', milestone: 'font', detail: '156 glyphs' }]];
const AG = traceBlocks(`${FX}/trace/amazing-grace.trace`).map((b) => ['trace', b]);
const AG_END = [['log', 'INFO  [score] PartwiseBuilder 2707 | Exporting sheet(s): [#1]'], ['post', { type: 'export', at: 'write' }],
  ['log', 'INFO  [score] Score 1 | Score score exported to /files/x/score.mxl'], ['done', b64(`${FX}/trace/amazing-grace.mxl`)]];
const cut = Math.floor(AG.length / 3);
const SC = {
  slow: [...MILESTONES, ...AG.slice(0, cut), ['wait', 6000], ...AG.slice(cut), ...AG_END], // time to fold it and look
  hang: [...MILESTONES, ['trace', 'K 1 - -'], ['trace', 'B 1 LOAD'], ['hang']],
  full: [...MILESTONES, ...AG, ...AG_END],
};

const SIZES = [
  { n: 'iphone', w: 393, h: 852, touch: true, page: 'sing.html', shots: true },
  { n: 'safari', w: 393, h: 659, touch: true, page: 'sing.html' },
  { n: 'ipad-p', w: 820, h: 1180, touch: true, page: 'play.html', shots: true },
  { n: 'ipad-l', w: 1180, h: 820, touch: true, page: 'play.html', shots: true },
  { n: 'desktop', w: 1440, h: 900, touch: false, page: 'sing.html' },
];
const PROFILE = { active: 'p1', list: [{ id: 'p1', name: 'Dave', vol: { floor: -50, ceiling: -10 }, range: { low: 45, high: 67, comfortLow: 48, comfortHigh: 64, at: 1 } }] };

let browser;
async function context(sz, { seed = {}, scenario = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: sz.w, height: sz.h }, deviceScaleFactor: 1, permissions: ['microphone'],
    ...(sz.touch ? { isMobile: true, hasTouch: true } : {}) });
  ctx.sc = scenario;
  await ctx.route('**/omr/omr-worker.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: fakeWorker(SC[ctx.sc || 'full']) }));
  await ctx.route('**/*.supabase.co/**', (r) => r.abort()); // (a fake session never reaches the server)
  await ctx.addInitScript((seed) => {
    try {
      if (location.protocol === 'about:' || sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    } catch {}
  }, seed);
  ctx.errors = [];
  ctx.on('page', (p) => {
    p.on('pageerror', (e) => ctx.errors.push(`${p.url().split('/').pop()}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|supabase|Failed to fetch|sync/i.test(m.text())) ctx.errors.push(`${p.url().split('/').pop()}: ${m.text()}`); });
  });
  return ctx;
}
const dbg = (p) => p.evaluate(() => window.resonateDebug?.()).catch(() => null);
async function until(p, pred, ms = 15000) {
  const end = Date.now() + ms;
  let d = null;
  while (Date.now() < end) { d = await dbg(p); try { if (d && pred(d)) return d; } catch {} await p.waitForTimeout(150); }
  return d;
}
const rect = (p, sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom, vis: !!e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' }; }).catch(() => null);
const shown = async (p, sel) => !!(await rect(p, sel))?.vis;
const shot = (p, sz, name) => sz.shots && SHOTS && p.screenshot({ path: `${SHOTS}/${name}-${sz.n}.png` });
// Nothing scrolls the page, nothing pokes out sideways; every control in the bars ≥ 44 px.
const layout = (p) => p.evaluate(() => {
  const se = document.scrollingElement;
  const small = [...document.querySelectorAll('.top a, .top button, .dock a, .dock button, .sheet:not([hidden]) button, .sheet:not([hidden]) a')]
    .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('.rd'))
    .map((e) => ({ e, r: e.getBoundingClientRect() }))
    .filter(({ r }) => r.width && (r.width < 43.5 || r.height < 43.5))
    .map(({ e, r }) => `${e.id || e.className || e.tagName}:${Math.round(r.width)}×${Math.round(r.height)}`);
  const wide = [...document.querySelectorAll('.app *')].filter((e) => e.getClientRects().length && !e.closest('.scope')).some((e) => e.getBoundingClientRect().right > innerWidth + 1);
  return { scrollH: se.scrollHeight, scrollW: se.scrollWidth, H: innerHeight, W: innerWidth, small, wide, scrolled: scrollY || scrollX };
});

async function closeCtx(ctx) {
  ok(!ctx.errors.length, `no console errors${ctx.errors.length ? ': ' + ctx.errors.slice(0, 4).join(' | ') : ''}`);
  await ctx.close();
}
async function home(sz, ctx, url = 'index.html') {
  const p = await ctx.newPage();
  await p.goto(BASE + url);
  await p.waitForFunction(() => window.resonateDebug?.().tuner);
  await p.waitForTimeout(300);
  return p;
}

async function runSize(sz) {
  console.log(`\n=== ${sz.n} ${sz.w}×${sz.h}`);
  // --- home, the tuner -------------------------------------------------------------------------
  let ctx = await context(sz, { seed: { 'resonate.profiles': JSON.stringify(PROFILE), 'resonate.sing.song': 'amazing-grace' } });
  let p = await home(sz, ctx);
  const av = await rect(p, '#avatar');
  ok(av && av.vis && av.r <= sz.w && av.r >= sz.w - 70 && av.y >= 0 && av.b <= 130, `avatar top right (${av && `${Math.round(av.x)},${Math.round(av.y)} ${av.w}×${av.h}`})`);
  ok(await p.$eval('#avatar', (e) => e.hasAttribute('data-out') && !!e.querySelector('svg')), 'signed out: a person glyph');
  const VER = (await p.textContent('#version')).trim(); ok(/^v\d+$/.test(VER), 'version badge ' + VER);
  let L = await layout(p);
  ok(L.scrollH <= L.H && L.scrollW <= L.W && !L.wide, `no page scroll / overflow (${L.scrollW}×${L.scrollH} in ${L.W}×${L.H}${L.wide ? ', something pokes out' : ''})`);
  ok(!L.small.length, `touch targets ≥ 44 px${L.small.length ? ': ' + L.small.join(', ') : ''}`);
  ok(await shown(p, '.ribbon-wrap') && await shown(p, '#nextup'), 'range ribbon and Next-up shown');
  ok((await p.textContent('#nextup .t')) === 'Amazing Grace', 'Next-up: the last song');
  // (v87: Next-up is a one-line chip just above Songs, inside the dock — no longer a card above it)
  const sbn = await rect(p, '#songs-btn'), nu = await rect(p, '#nextup');
  ok(nu.b <= sbn.y + 1 && Math.abs(nu.r - sbn.r) < 2 && nu.h <= 48, `Next-up: a chip just above Songs (${Math.round(nu.b)} ≤ ${Math.round(sbn.y)}, ${Math.round(nu.w)}×${Math.round(nu.h)})`);
  ok((await dbg(p)).tuner.state === 'off' && (await p.textContent('#main-btn .l')) === 'Start', 'nothing listens at load; the main button says Start');
  await p.click('#main-btn');
  let d = await until(p, (x) => x.tuner.note === 57, 6000);
  ok(d?.tuner.note === 57 && Math.abs(d.tuner.cents) <= 10, `Start → A3 from the fake mic (${d?.tuner.note} ${d?.tuner.cents}¢, ${d?.tuner.state})`);
  ok((await p.textContent('.note-text')).startsWith('A') && (await p.textContent('#main-btn .l')) === 'Listening', 'the note and "Listening" shown');
  await p.waitForTimeout(400);
  ok(await p.$eval('.level .n', (e) => !e.hidden && /^\d+$/.test(e.textContent)), 'level 1–10 with a calibrated profile');
  await shot(p, sz, 'home');
  L = await layout(p);
  ok(L.scrollH <= L.H && L.scrollW <= L.W && !L.scrolled, 'still no page scroll while listening');
  await p.click('#main-btn');
  d = await until(p, (x) => x.tuner.state === 'off', 3000);
  ok(d?.tuner.state === 'off' && (await p.textContent('.note-text')) === '—', 'Stop → off, the note cleared');

  // --- the account menu, signed out ----------------------------------------------------------------
  await p.click('#avatar');
  ok(await shown(p, '#acct') && /Everything works signed out/.test(await p.textContent('#acct')) && /Sign in/.test(await p.textContent('#acct')), 'account menu (signed out): Sign in, "Everything works signed out"');
  ok(!(await p.$('#acct a[href="./?open=assistants"]')) && !!(await p.$('#acct a[href="./?open=voice"]')) && !!(await p.$('#acct a[href="tools.html"]')), 'signed out: Voice, Tools; no Assistants');
  ok((await p.textContent('#acct .foot')).includes((await p.textContent('#version')).trim()), 'version line in the menu');
  const am = await rect(p, '#acct');
  if (sz.w >= 700) ok(Math.abs(am.w - 380) < 2 && am.y < 120, `tablet: a 380 px popover under the avatar (${am.w}×${Math.round(am.h)} at y ${Math.round(am.y)})`);
  else ok(am.b >= sz.h - 1 && am.w === sz.w, 'phone: a bottom sheet');
  ok(await shown(p, '#avatar'), 'the avatar stays above the scrim');
  await shot(p, sz, 'account-menu-signed-out');
  await p.keyboard.press('Escape');
  ok(!(await shown(p, '#acct')), 'Escape closes it');
  await p.click('#avatar');
  await p.mouse.click(sz.w < 700 ? 20 : 30, sz.w < 700 ? 140 : sz.h / 2);
  ok(!(await shown(p, '#acct')), 'a tap on the scrim closes it');
  await p.click('#avatar');
  await p.goBack();
  await p.waitForTimeout(300);
  ok(!(await shown(p, '#acct')) && /index\.html/.test(p.url()), 'Back closes it (and stays home)');

  // --- Songs: the list, choosing a sample --------------------------------------------------------
  await p.click('#songs-btn');
  await p.waitForSelector('#songs-body .song', { timeout: 3000 }).catch(() => {});
  ok(await shown(p, '#songs'), 'Songs opens the list');
  ok(/Amazing Grace/.test(await p.textContent('#songs-body')), 'samples listed');
  const sh = await rect(p, '#songs');
  if (sz.w >= 700) ok(Math.abs(sh.w - 440) < 2 && sh.b < sz.h - 60, `tablet: a 440 px popover above Songs (${sh.w}×${Math.round(sh.h)})`);
  else ok(Math.abs(sh.h - sz.h * 0.9) < 3, `phone: a 90% sheet (${Math.round(sh.h)} of ${sz.h})`);
  await shot(p, sz, 'song-list');
  await p.click('#add-btn');
  ok(await shown(p, '#add-menu') && /PDF/.test(await p.textContent('#add-menu')) && /MusicXML/.test(await p.textContent('#add-menu')) && /Link/.test(await p.textContent('#add-menu')), 'Add: PDF · MusicXML · Link');
  await shot(p, sz, 'song-add');
  await p.click('#add-link');
  const lf = await rect(p, '#link-form'), bodyR = await rect(p, '#songs-body');
  ok(lf?.vis && lf.b <= bodyR.y + 1 && lf.y - sh.y < 120, `Link: a URL field at the top of the sheet (${Math.round(lf?.y - sh.y)} px down)`);
  ok(await p.evaluate(() => document.activeElement?.id === 'link-url'), 'the field has focus');
  L = await layout(p);
  ok(L.scrollH <= L.H && L.scrollW <= L.W, 'no page scroll with the sheet open');
  await p.click('#songs-body .song[data-id="amazing-grace"]');
  // (step 2: a song opens in place with Sing on every device — shellsing.cjs tests Sing there)
  d = await until(p, (x) => x.song?.open && x.song.state?.song === 'amazing-grace', 15000);
  ok(!!d?.song?.open && /index\.html$/.test(p.url()), `a sample opens Sing in place (${p.url().split('/').pop()}, ${d?.song?.state?.song})`);
  await p.goBack();
  d = await until(p, (x) => !x.song?.open, 8000);
  ok(/index\.html$/.test(p.url()) && !d?.song?.open && !(await shown(p, '#songs')), 'Back from the song comes home, the list closed');
  await closeCtx(ctx);

  // --- MusicXML: saved, listed, opened -------------------------------------------------------------
  ctx = await context(sz);
  p = await home(sz, ctx);
  ok(!(await shown(p, '#nextup')) && !(await shown(p, '.ribbon-wrap')), 'no last song: no Next-up; no range: no ribbon');
  await p.click('#songs-btn');
  await p.click('#add-btn');
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('#add-xml')]);
  ok(!(await p.$eval('#xml-input', (e) => e.getAttribute('accept'))), 'MusicXML picker: no accept filter');
  await fc.setFiles(path.join(__dirname, '..', 'public', 'songs', 'amazing-grace.musicxml'));
  d = await until(p, (x) => x.song?.open && /^s/.test(x.song.state?.song || ''), 10000);
  const sid = await p.evaluate(() => localStorage.getItem('resonate.sing.song'));
  ok(!!d?.song?.open && /index\.html$/.test(p.url()) && /^s/.test(sid || '') && d.song.state.song === sid, `MusicXML saved and opened in place (${sid})`);
  await p.goBack();
  await p.waitForFunction(() => window.resonateDebug?.().tuner && !window.resonateDebug().song.open && !document.getElementById('nextup').hidden, null, { timeout: 8000 }).catch(() => {});
  await p.click('#songs-btn');
  await p.waitForSelector(`#songs-body .song[data-id="${sid}"]`, { timeout: 4000 }).catch(() => {});
  ok(!!(await p.$(`#songs-body .song[data-id="${sid}"]`)), 'listed in My songs');
  ok(/^Amazing grace$/i.test(await p.textContent('#nextup .t').catch(() => '')), 'Next-up shows it');
  await p.keyboard.press('Escape');
  // a bad file: said plainly, nothing opened
  await p.click('#songs-btn');
  await p.click('#add-btn');
  const [fc2] = await Promise.all([p.waitForEvent('filechooser'), p.click('#add-xml')]);
  await fc2.setFiles({ name: 'song.mscz', mimeType: 'application/octet-stream', buffer: Buffer.from('x') });
  await p.waitForTimeout(300);
  ok(/MuseScore/.test(await p.textContent('#songs-msg')) && /index\.html$/.test(p.url()), 'a .mscz: the export hint, stays home');
  await closeCtx(ctx);

  // --- signed in (a saved session, sync off on this device) -----------------------------------------
  ctx = await context(sz, { seed: { 'resonate.auth': JSON.stringify({ user: { email: 'dave@mail.com', id: 'u-test' } }), 'resonate.sync.off': '1',
    'resonate.space': JSON.stringify({ active: 'u-test', db: { 'u-test': 'resonate-u-test' } }) } });
  p = await home(sz, ctx);
  ok(await p.$eval('#avatar .face', (e) => e.textContent) === 'D' && !(await p.$eval('#avatar', (e) => e.hasAttribute('data-out'))), 'signed in: the email\'s initial');
  await p.click('#avatar');
  const txt = await p.textContent('#acct');
  ok(/dave@mail\.com/.test(txt) && !!(await p.$('#acct a[href="./?open=assistants"]')) && !!(await p.$('#acct a[href="account.html"]')) && !!(await p.$('#acct a[href="./?open=voice"]')) && !!(await p.$('#acct a[href="tools.html"]')),
    'menu: email, Voice, Assistants, Tools, Account');
  ok(await p.$eval('#sync-row', (e) => e.getAttribute('aria-checked')) === 'false', 'Sync this device: off (resonate.sync.off)');
  await shot(p, sz, 'account-menu');
  await p.click('#sync-row');
  ok(await p.evaluate(() => localStorage.getItem('resonate.sync.off')) === null && await p.$eval('#sync-row', (e) => e.getAttribute('aria-checked')) === 'true', 'the switch turns it on (the pref removed)');
  await p.click('#sync-row');
  ok(await p.evaluate(() => localStorage.getItem('resonate.sync.off')) === '1', 'and off again (the pref set)');
  await p.click('#acct a[href="./?open=voice"]'); // (v87: in place — shellplaces.cjs checks the places themselves)
  await p.waitForSelector('#place-voice', { state: 'visible', timeout: 5000 }).catch(() => {});
  ok(/index\.html/.test(p.url()) && await p.isVisible('#place-voice'), 'Voice → in place (still index.html)');
  await closeCtx(ctx);

  // --- mic states and a link (one size) ---------------------------------------------------------
  if (sz.n === 'iphone') {
    ctx = await context(sz);
    await ctx.addInitScript(() => {
      if (!navigator.mediaDevices || location.protocol === 'about:') return;
      const mode = () => localStorage.getItem('__gum');
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (c) => mode() === 'deny' ? Promise.reject(new DOMException('denied', 'NotAllowedError'))
        : mode() === 'never' ? new Promise(() => {}) : real(c);
      window.__session = [];
      Object.defineProperty(navigator, 'audioSession', { configurable: true, value: { set type(v) { window.__session.push(v); }, get type() { return window.__session.at(-1) || 'auto'; } } });
    });
    p = await home(sz, ctx);
    await p.evaluate(() => localStorage.setItem('__gum', 'deny'));
    await p.click('#main-btn');
    d = await until(p, (x) => x.tuner.state === 'blocked', 4000);
    ok(d?.tuner.state === 'blocked' && /aA → Website Settings → Microphone/.test(await p.textContent('.tmsg')) && (await p.textContent('#main-btn .l')) === 'Start', 'blocked mic: "Allow the mic: aA → …", Start again');
    ok((await p.evaluate(() => window.__session))[0] === 'play-and-record', 'play-and-record set before getUserMedia');
    await p.evaluate(() => localStorage.setItem('__gum', 'never'));
    await p.click('#main-btn');
    d = await until(p, (x) => x.tuner.state === 'noanswer', 10000);
    ok(d?.tuner.state === 'noanswer' && /not answering/.test(await p.textContent('.tmsg')), 'no answer in 8 s: "Mic not answering — tap again"');
    await p.evaluate(() => localStorage.setItem('__gum', ''));
    await p.click('#main-btn');
    d = await until(p, (x) => x.tuner.note === 57, 6000);
    ok(d?.tuner.state === 'listening' && d.tuner.note === 57, 'tapped again: listening (A3)');
    await p.click('#main-btn');
    ok((await p.evaluate(() => window.__session)).at(-1) === 'auto', 'Stop: the session back to auto');
    // a GitHub page link → the raw file, saved and opened
    await ctx.route('https://raw.githubusercontent.com/**', (r) => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/xml',
      body: fs.readFileSync(path.join(__dirname, '..', 'public', 'songs', 'amazing-grace.musicxml'), 'utf8') }));
    await p.click('#songs-btn');
    await p.click('#add-btn');
    await p.click('#add-link');
    await p.fill('#link-url', 'https://github.com/someone/songs/blob/main/grace.musicxml');
    await p.press('#link-url', 'Enter');
    d = await until(p, (x) => x.song?.open && /^s/.test(x.song.state?.song || ''), 10000);
    const lid = await p.evaluate(() => localStorage.getItem('resonate.sing.song'));
    ok(!!d?.song?.open && /index\.html$/.test(p.url()) && /^s/.test(lid || ''), `a GitHub link: the raw file saved and opened in place (${lid})`);
    await closeCtx(ctx);
  }

  // --- a PDF: a song at once (its PDF only), converted in the background (v90) ------------------------
  // iPad landscape adds two and converts them all; the other touch sizes add one and convert it from its ⋯.
  if (sz.n !== 'desktop') {
    const batch = sz.n === 'ipad-l';
    ctx = await context(sz, { scenario: 'slow' });
    p = await home(sz, ctx);
    await p.click('#songs-btn');
    await p.click('#add-btn');
    const [fcp] = await Promise.all([p.waitForEvent('filechooser'), p.click('#add-pdf')]);
    await fcp.setFiles(batch ? [`${FX}/import/amazing-grace1.pdf`, `${FX}/import/greensleeves3.pdf`] : `${FX}/import/amazing-grace1.pdf`);
    let ids;
    if (batch) {
      await p.waitForFunction(() => document.querySelectorAll('#songs-body .songrow .more').length >= 2, null, { timeout: 8000 }).catch(() => {});
      ids = await p.$$eval('#songs-body .songrow', (rs) => rs.filter((r) => r.querySelector('.more')).map((r) => r.dataset.id));
      d = await dbg(p);
      ok(ids.length === 2 && !d.song.open && !d.import.song && /✓ 2 added/.test(await p.textContent('#songs-msg')), `two PDFs: two songs at once, nothing opened or converting ("${await p.textContent('#songs-msg')}")`);
      await p.keyboard.press('Escape');
    } else {
      d = await until(p, (x) => x.song?.open && x.song.pdfOnly, 8000);
      ids = [d?.song.state?.song];
      ok(!!d && !d.import.song && !d.import.running && /index\.html$/.test(p.url()) && d.song.set.score && !d.song.set.sing, `PDF → a song at once, open in place on its PDF (the Score only), nothing converting (${JSON.stringify(d?.song.set)})`);
      await p.goBack();
      d = await until(p, (x) => !x.song?.open, 8000);
      ok(!!d && /index\.html$/.test(p.url()), 'Back: home');
    }
    await p.click('#main-btn'); // (the tuner keeps working while a PDF is converted)
    await until(p, (x) => x.tuner.note === 57, 6000);
    await p.click('#songs-btn');
    await p.waitForSelector(`#songs-body .songrow[data-id="${ids[0]}"] .more`, { timeout: 5000 });
    const fact0 = await p.textContent(`#songs-body .song[data-id="${ids[0]}"] .s`);
    ok(/^PDF only · new$/.test(fact0), `its row: "${fact0}"`);
    if (batch) await p.click('#songs-body [data-act="convert-all"]');
    else { await p.click(`#songs-body .songrow[data-id="${ids[0]}"] .more`); await p.click('#row-menu [data-act="convert"]'); }
    d = await until(p, (x) => !!x.import.song, 8000);
    ok(!!d && d.import.mode === 'min' && !(await shown(p, '#tray')) && (await shown(p, '#songs')), `${batch ? 'Convert all' : '⋯ → Convert'}: in the background, folded (${d?.import.mode}), the list stays`);
    ok(/index\.html$/.test(p.url()), 'no navigation');
    const fact1 = await p.textContent(`#songs-body .song[data-id="${d?.import.song?.id}"] .s`).catch(() => '');
    ok(/^converting/.test(fact1), `the song's row: "${fact1}"`);
    await p.keyboard.press('Escape');
    d = await until(p, (x) => x.import.reader?.phase === 'read', 12000);
    await p.waitForTimeout(400);
    d = await dbg(p);
    const tile = await rect(p, '#imp-mini'), sb = await rect(p, '#songs-btn'), mods = await rect(p, '#mods');
    ok(d.import.mode === 'min' && !(await shown(p, '#tray')) && tile?.vis, 'the tile shown, the tray hidden');
    // (v87: the module toggles sit between the tile and Songs)
    ok(tile && sb && mods && tile.r <= mods.x + 1 && mods.x - tile.r < 24 && mods.r <= sb.x + 1 && Math.abs((tile.y + tile.h / 2) - (sb.y + sb.h / 2)) < 40, `the tile beside the toggles and Songs (${Math.round(tile?.x)}–${Math.round(tile?.r)} | toggles ${Math.round(mods?.x)} | Songs ${Math.round(sb?.x)})`);
    ok(!(await shown(p, '#reader-host .rd-pill')), "the Reader's own corner pill isn't shown");
    const ps = await p.textContent('#imp-mini .ps');
    ok(batch ? /^song 1\/2 · /.test(ps) : !/song \d/.test(ps), `the tile's line: "${ps}"`);
    ok((await dbg(p)).tuner.note === 57, 'the tuner still hears A3 while the PDF is converted');
    await shot(p, sz, 'tray-mini');
    await p.click('#imp-mini');
    d = await until(p, (x) => x.import.mode === 'open', 3000);
    ok(d?.import.mode === 'open' && await shown(p, '#tray'), 'the tile opens the Reader');
    await p.waitForTimeout(1200);
    await shot(p, sz, 'tray-expanded');
    L = await layout(p);
    ok(L.scrollH <= L.H && L.scrollW <= L.W, 'no page scroll with the tray open');
    await p.keyboard.press('Escape');
    d = await until(p, (x) => x.import.mode === 'min', 3000);
    ok(d?.import.mode === 'min', 'Escape folds it');
    d = await until(p, (x) => x.import.result, 40000);
    await p.waitForTimeout(300);
    const doneText = (await p.textContent('#imp-done').catch(() => '')).replace(/\s+/g, ' ').trim();
    if (batch) ok(d?.import.result?.batch === 2 && await shown(p, '#imp-done') && /2 converted/.test(doneText) && !(await shown(p, '#imp-done .openbtn')), `done: "${doneText}" (no Open)`);
    else ok(d?.import.result?.songId === ids[0] && await shown(p, '#imp-done') && /ready/.test(doneText) && (await shown(p, '#imp-done .openbtn')), `done: "${doneText}" with Open (${d?.import.result?.songId})`);
    ok(!(await shown(p, '#imp-mini')), 'the tile gives way to the done row');
    await shot(p, sz, 'import-done');
    await p.click('#songs-btn');
    await p.waitForTimeout(300);
    // (A7: converted from a PDF — "PDF · new"; by this engine: no "v9 → v10" badge)
    const facts = await Promise.all(ids.map((id) => p.$eval(`#songs-body .song[data-id="${id}"]`, (b) => (b.querySelector('.s')?.textContent || '') + (b.querySelector('.eng') ? ' +' + b.querySelector('.eng').textContent : '')).catch(() => '')));
    ok(facts.every((f) => f === 'PDF · new'), `converted: ${JSON.stringify(facts)}`);
    await p.keyboard.press('Escape');
    if (!batch) {
      await p.click('#imp-done .openbtn');
      const d2 = await until(p, (x) => x.song?.open && x.song.state?.song === ids[0] && !x.song.pdfOnly, 10000);
      ok(!!d2 && /index\.html$/.test(p.url()) && await p.evaluate(() => localStorage.getItem('resonate.sing.song')) === ids[0], `Open → the song in place, converted (${JSON.stringify(d2?.song.set)})`);
    } else {
      await p.click('#imp-done .x');
      ok(!(await shown(p, '#imp-done')), '✕ closes the done row');
    }
    await closeCtx(ctx);
  }

  // --- a reload mid-run continues it ---------------------------------------------------------------------
  if (sz.n === 'iphone' || sz.n === 'ipad-l') {
    ctx = await context(sz, { scenario: 'hang' });
    p = await home(sz, ctx, `index.html?pdf=${encodeURIComponent('/imp/amazing-grace1.pdf')}`);
    d = await until(p, (x) => x.import.events > 0 && (x.eventList || []).some((e) => e.t === 'sheet' && e.state === 'start'), 15000);
    ok(!!d, 'a run under way (sheet 1 started)');
    await p.waitForTimeout(800);
    ctx.sc = 'full';
    await p.goto(BASE + 'index.html');
    d = await until(p, (x) => x.import.state === 'running' || x.import.result, 15000);
    const resumed = (d?.eventList || []).some((e) => e.t === 'job' && e.resumed);
    ok(d && resumed && d.import.mode === 'min', `reload → the import continues, folded (${d?.import.state}, resumed ${resumed}, ${d?.import.mode})`);
    ok(!(await p.$('#import-pill')), "no nav.js pill here: the shell's own tile");
    d = await until(p, (x) => x.import.result, 25000);
    ok(!!d?.import.result?.songId && await shown(p, '#imp-done'), `and finishes: ${d?.import.result?.title} (${d?.import.result?.songId})`);
    ok(await p.evaluate(() => localStorage.getItem('resonate.import')) === null, 'the import flag cleared');
    await closeCtx(ctx);
  }
}

(async () => {
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${FX}/shell/a3.wav`] });
  const errors = [];
  for (const sz of SIZES) {
    if (ONLY && !ONLY.has(sz.n)) continue;
    const before = fails;
    try { await runSize(sz); } catch (e) { ok(false, `${sz.n}: ${e.message.split('\n')[0]}`); }
    for (const c of browser.contexts()) await c.close().catch(() => {});
    if (fails === before) console.log(`(${sz.n}: all passed)`);
  }
  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
