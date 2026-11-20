// The shell's chrome after the owner's jank report (docs/ROADMAP.md "Work queue", 2026-11-20):
//   drag  (A1) a bottom sheet that shows its handle — Songs and the account menu on a phone — follows a
//         finger on the handle or its head down and closes past a threshold or on a flick, springs back
//         otherwise; the head's + Add still takes a tap; the list's own scroll doesn't move it; the scrim,
//         Escape and Back still close it; a song open under it stays open (one history entry each);
//         reduced motion: no follow, the release decides; a tablet's popovers (no handle) don't drag.
//   pill  (A2) with a song open the top bar's title is plain words — no chevron, no menu, not a button,
//         a tap on it opens nothing — and its ✕ still closes the song; Songs is the one way to the list.
//   tile  (A8) the folded conversion beside Songs keeps one footprint while its words change: the Score's
//         ▶ in the dock beside it, sampled every frame, never moves (five sizes).
// (A7, the song rows' facts and the older-engine badge: songlib.cjs look.)
// Touch through CDP (Input.dispatchTouchEvent: touch-action and the browser's own pan are real); the
// conversion on the scripted worker (as songlib.cjs: fixtures/trace's Amazing Grace, paced so the tile's
// words change for seconds). Screenshots of each fixed state into SHOTS.
//   node jankchrome.cjs                      (http://localhost:8097/resonate/; ONLY=drag,pill,tile)
//   SHOTS=0 node jankchrome.cjs              (no screenshots; or node -r ./harness/noshots.cjs)
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = (process.env.BASE || 'http://localhost:8097').replace(/\/$/, '').replace(/\/resonate$/, '') + '/resonate/';
const FX = path.join(__dirname, 'fixtures');
const SHOTS = process.env.SHOTS === '0' ? null : process.env.SHOTS || path.join(os.tmpdir(), 'resonate-jank');
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const want = (k) => !ONLY || ONLY.has(k);
const PDF_B64 = fs.readFileSync(path.join(FX, 'import', 'amazing-grace1.pdf')).toString('base64');

let passes = 0, fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`); if (c) passes++; else fails++; return c; };

// --- the scripted worker (songlib.cjs) ------------------------------------------------------------
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
    await new Promise((r) => setTimeout(r, 15));
  }
};`;
}
const MILESTONES = [['post', { type: 'engine', milestone: 'fetch' }], ['wait', 400], ['post', { type: 'engine', milestone: 'jvm' }], ['wait', 400],
  ['log', 'INFO  [score]                       Main 280  | Audiveris'], ['post', { type: 'engine', milestone: 'start' }], ['wait', 400],
  ['post', { type: 'engine', milestone: 'font', detail: '156 glyphs' }]];
const AG = traceBlocks(`${FX}/trace/amazing-grace.trace`).map((b) => ['trace', b]);
const AG_END = [['log', 'INFO  [score] PartwiseBuilder 2707 | Exporting sheet(s): [#1]'], ['post', { type: 'export', at: 'write' }],
  ['log', 'INFO  [score] Score 1 | Score score exported to /files/x/score.mxl'], ['done', b64(`${FX}/trace/amazing-grace.mxl`)]];
// (paced: every step its own moment, so the tile's words change through the whole sampling)
const PACED = [...MILESTONES, ...AG.flatMap((b) => [b, ['wait', 70]]), ...AG_END];

const IPHONE = { n: 'iphone', w: 393, h: 852, touch: true };
const SAFARI = { n: 'safari', w: 393, h: 659, touch: true };
const IPAD = { n: 'ipad', w: 820, h: 1180, touch: true };
const IPAD_L = { n: 'ipad-l', w: 1180, h: 820, touch: true };
const DESKTOP = { n: 'desktop', w: 1440, h: 900, touch: false };

let browser;
async function context(sz, { seed = {}, reduced = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: sz.w, height: sz.h }, deviceScaleFactor: 1, permissions: ['microphone'],
    reducedMotion: reduced ? 'reduce' : 'no-preference', ...(sz.touch ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.route('**/omr/omr-worker.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: fakeWorker(PACED) }));
  await ctx.route('**/*.supabase.co/**', (r) => r.abort());
  await ctx.addInitScript((seed) => {
    try { if (!navigator.audioSession) Object.defineProperty(navigator, 'audioSession', { configurable: true, value: { type: 'auto' } }); } catch {}
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
async function closeCtx(ctx, label) {
  ok(!ctx.errors.length, `${label}: no console errors${ctx.errors.length ? ': ' + ctx.errors.slice(0, 4).join(' | ') : ''}`);
  await ctx.close();
}
const dbg = (p) => p.evaluate(() => window.resonateDebug?.()).catch(() => null);
async function until(p, pred, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const d = await dbg(p); try { if (d && pred(d)) return d; } catch {} await p.waitForTimeout(150); }
  return null;
}
const rect = (p, sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2, vis: !!e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' }; }).catch(() => null);
const shown = async (p, sel) => !!(await rect(p, sel))?.vis;
const shot = (p, name) => (SHOTS ? p.screenshot({ path: path.join(SHOTS, `${name}.png`) }) : null);
async function home(ctx) {
  const p = await ctx.newPage();
  await p.goto(BASE + 'shell.html');
  await p.waitForFunction(() => window.resonateDebug?.().tuner, null, { timeout: 15000 });
  await p.waitForTimeout(300);
  return p;
}
// A finger: down at (x, y), moved by dy in `steps` moves `ms` apart; `mid` runs before the lift.
async function swipe(p, cdp, x, y, dy, { steps = 12, ms = 16, mid = null } = {}) {
  const t = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  await t('touchStart', [{ x, y, id: 1 }]);
  for (let i = 1; i <= steps; i++) { await t('touchMove', [{ x, y: y + (dy * i) / steps, id: 1 }]); if (ms) await p.waitForTimeout(ms); }
  const m = mid ? await mid() : null;
  await t('touchEnd', []);
  return m;
}
const tapAt = (cdp, x, y) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
  .then(() => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }));
const sheetState = (p, id) => p.evaluate((id) => {
  const s = document.getElementById(id), sc = document.getElementById('scrim');
  const m = /translateY\(([-\d.]+)px\)/.exec(s.style.transform || getComputedStyle(s).transform.replace(/matrix\(1, 0, 0, 1, 0, ([-\d.]+)\)/, 'translateY($1px)'));
  return { open: !s.hidden, ty: m ? +m[1] : 0, inline: s.style.transform, scrim: !sc.hidden, scrimOp: sc.style.opacity, overlay: window.resonateDebug().overlay, state: history.state, len: history.length };
}, id);
async function openSongs(p, cdp) {
  const r = await rect(p, '#songs-btn');
  await tapAt(cdp, r.cx, r.cy);
  await p.waitForSelector('#songs-body .song', { timeout: 5000 });
  await p.waitForTimeout(250);
}

// --- A1: drag a sheet down by its handle or head ----------------------------------------------------
async function drag() {
  for (const sz of [IPHONE, SAFARI]) {
    console.log(`\n=== drag (${sz.n})`);
    const ctx = await context(sz);
    const p = await home(ctx);
    const cdp = await ctx.newCDPSession(p);
    await openSongs(p, cdp);
    const g = await rect(p, '#songs .grab'), hd = await rect(p, '#songs .sheet-head h2'), sh = await rect(p, '#songs');
    ok(g?.vis && g.y - sh.y < 20, `${sz.n}: the handle shows at the sheet's top (${g && Math.round(g.y - sh.y)} px down)`);
    // (the handle's target is finger-sized, not its 40×5 bar)
    const hit = await p.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.grab'), { x: g.cx + 60, y: g.cy + 6 });
    ok(hit, `${sz.n}: 60 px beside the handle still takes the finger`);

    // a short drag follows the finger, then springs back
    const mid = await swipe(p, cdp, g.cx, g.cy, 50, { steps: 6, mid: () => sheetState(p, 'songs') });
    ok(mid.open && Math.abs(mid.ty - 50) < 2 && mid.scrimOp && +mid.scrimOp < 1, `${sz.n}: the sheet follows the finger (${mid.ty} px, scrim ${mid.scrimOp})`);
    await p.waitForTimeout(350);
    let s = await sheetState(p, 'songs');
    ok(s.open && s.overlay === 'songs' && !s.inline && s.ty === 0 && !s.scrimOp && s.state?.shellSheet, `${sz.n}: 50 px and let go: back in place, still open (${JSON.stringify({ ty: s.ty, ov: s.overlay })})`);

    // far enough: closed, its history entry gone
    const len0 = s.len;
    const mid2 = await swipe(p, cdp, g.cx, g.cy, 320, { steps: 16, mid: () => sheetState(p, 'songs') });
    ok(Math.abs(mid2.ty - 320) < 2, `${sz.n}: dragged 320 px (${mid2.ty})`);
    await p.waitForTimeout(500);
    s = await sheetState(p, 'songs');
    ok(!s.open && !s.scrim && s.overlay === null && !s.state?.shellSheet && !s.inline && !s.scrimOp, `${sz.n}: past the threshold: closed, the scrim gone, the sheet's entry popped (${JSON.stringify({ open: s.open, ov: s.overlay, st: s.state, len: `${len0}→${s.len}` })})`);
    ok(!(await p.evaluate(() => document.getElementById('songs-btn').getAttribute('aria-expanded') === 'true')), `${sz.n}: Songs says closed (aria-expanded)`);

    // the head drags it too; its + Add still takes a tap
    await openSongs(p, cdp);
    const add = await rect(p, '#add-btn');
    await tapAt(cdp, add.cx, add.cy);
    await p.waitForTimeout(200);
    ok(await shown(p, '#add-menu') && (await sheetState(p, 'songs')).open, `${sz.n}: + Add in the head still opens its menu`);
    await swipe(p, cdp, hd.cx, hd.cy, 260, { steps: 12 });
    await p.waitForTimeout(500);
    s = await sheetState(p, 'songs');
    ok(!s.open && s.overlay === null && !(await shown(p, '#add-menu')), `${sz.n}: dragging the head ("Songs") down closes it (and the Add menu)`);

    // a flick: short and fast
    await openSongs(p, cdp);
    await swipe(p, cdp, g.cx, g.cy, 70, { steps: 4, ms: 8 });
    await p.waitForTimeout(500);
    ok(!(await sheetState(p, 'songs')).open, `${sz.n}: a flick (70 px, fast) closes it`);

    // the list scrolls: dragging inside it doesn't move the sheet
    await openSongs(p, cdp);
    const body = await rect(p, '#songs-body');
    const mid3 = await swipe(p, cdp, body.cx, body.y + 60, 200, { steps: 10, mid: () => sheetState(p, 'songs') });
    await p.waitForTimeout(400);
    ok(mid3.ty === 0 && (await sheetState(p, 'songs')).open, `${sz.n}: a drag in the list doesn't move or close the sheet`);

    // a drag that starts down and comes back up: springs back, open
    await swipe(p, cdp, g.cx, g.cy, 30, { steps: 4 });
    await p.waitForTimeout(350);
    ok((await sheetState(p, 'songs')).open, `${sz.n}: 30 px: still open`);

    // the scrim, Escape and Back as before
    const shr = await rect(p, '#songs'), topH = await rect(p, '.top');
    if (shr.y - topH.b > 12) {
      await tapAt(cdp, sz.w / 2, (shr.y + topH.b) / 2);
      await p.waitForTimeout(300);
      ok(!(await sheetState(p, 'songs')).open, `${sz.n}: a tap on the scrim (between the top bar and the sheet) closes it`);
      await openSongs(p, cdp);
    }
    await p.keyboard.press('Escape');
    await p.waitForTimeout(200);
    ok(!(await sheetState(p, 'songs')).open, `${sz.n}: Escape closes it`);
    await openSongs(p, cdp);
    await p.goBack();
    await p.waitForTimeout(300);
    ok(!(await sheetState(p, 'songs')).open && /shell\.html/.test(p.url()), `${sz.n}: Back closes it (and stays home)`);
    if (sz === IPHONE) {
      await openSongs(p, cdp);
      await shot(p, `drag-songs-${sz.n}`);
    }

    // the account menu: its head drags it down
    const av = await rect(p, '#avatar');
    if (await shown(p, '#songs')) { await p.keyboard.press('Escape'); await p.waitForTimeout(200); }
    await tapAt(cdp, av.cx, av.cy);
    await p.waitForTimeout(300);
    ok(await shown(p, '#acct') && await shown(p, '#acct .grab'), `${sz.n}: the account menu is a sheet with a handle`);
    const ah = await rect(p, '#acct .acct-head');
    const mid4 = await swipe(p, cdp, ah.cx, ah.cy, 220, { steps: 12, mid: () => sheetState(p, 'acct') });
    if (sz === IPHONE) await shot(p, `drag-account-${sz.n}`);
    await p.waitForTimeout(500);
    s = await sheetState(p, 'acct');
    ok(mid4.ty > 150 && !s.open && s.overlay === null && !(await p.evaluate(() => document.getElementById('avatar').getAttribute('aria-expanded') === 'true')), `${sz.n}: the account menu drags down and closes (${mid4.ty} px)`);

    // Songs over an open song: the sheet goes, the song stays — and Back then closes the song
    await openSongs(p, cdp);
    const ag = await rect(p, '#songs-body .song[data-id="amazing-grace"]');
    await tapAt(cdp, ag.cx, ag.cy);
    await until(p, (d) => d.song?.state?.song === 'amazing-grace' || /amazing/.test(JSON.stringify(d.song || {})), 8000);
    await p.waitForTimeout(1500);
    await openSongs(p, cdp);
    const g2 = await rect(p, '#songs .grab');
    await swipe(p, cdp, g2.cx, g2.cy, 300, { steps: 14 });
    await p.waitForTimeout(500);
    s = await sheetState(p, 'songs');
    ok(!s.open && s.state?.shellPage && await shown(p, '#song-pill'), `${sz.n}: over a song: Songs closes, the song stays (${JSON.stringify(s.state)})`);
    await p.goBack();
    await p.waitForTimeout(600);
    ok(!(await shown(p, '#song-pill')), `${sz.n}: then Back closes the song`);
    await closeCtx(ctx, `drag ${sz.n}`);
  }

  // reduced motion: nothing follows the finger; the release decides
  {
    console.log('\n=== drag (iphone, reduced motion)');
    const ctx = await context(IPHONE, { reduced: true });
    const p = await home(ctx);
    const cdp = await ctx.newCDPSession(p);
    await openSongs(p, cdp);
    const g = await rect(p, '#songs .grab');
    const mid = await swipe(p, cdp, g.cx, g.cy, 40, { steps: 5, mid: () => sheetState(p, 'songs') });
    await p.waitForTimeout(300);
    ok(mid.ty === 0 && !mid.scrimOp && (await sheetState(p, 'songs')).open, `reduced motion: 40 px — the sheet stays put, still open (${mid.ty})`);
    const mid2 = await swipe(p, cdp, g.cx, g.cy, 260, { steps: 12, mid: () => sheetState(p, 'songs') });
    const s = await sheetState(p, 'songs');
    ok(mid2.ty === 0 && !s.open && s.overlay === null, `reduced motion: 260 px — no follow, closed at the release (${mid2.ty})`);
    await closeCtx(ctx, 'drag reduced');
  }

  // a narrow desktop window (the handle shows there too): a mouse drags it; a click on + Add still works
  {
    console.log('\n=== drag (narrow desktop window, mouse)');
    const sz = { n: 'narrow', w: 600, h: 800, touch: false };
    const ctx = await context(sz);
    const p = await home(ctx);
    await p.click('#songs-btn');
    await p.waitForSelector('#songs-body .song');
    const g = await rect(p, '#songs .grab');
    ok(g?.vis, 'narrow: the handle shows');
    await p.click('#add-btn');
    ok(await shown(p, '#add-menu'), 'narrow: a click on + Add still opens its menu');
    await p.mouse.move(g.cx, g.cy); await p.mouse.down();
    for (let i = 1; i <= 4; i++) { await p.mouse.move(g.cx, g.cy + i * 10); await p.waitForTimeout(40); } // (by hand: not a flick)
    await p.waitForTimeout(120);
    await p.mouse.up();
    await p.waitForTimeout(350);
    ok((await sheetState(p, 'songs')).open, 'narrow: 40 px with the mouse: still open');
    const hd = await rect(p, '#songs .sheet-head h2');
    await p.mouse.move(hd.cx, hd.cy); await p.mouse.down();
    await p.mouse.move(hd.cx, hd.cy + 300, { steps: 15 }); await p.mouse.up();
    await p.waitForTimeout(500);
    const s = await sheetState(p, 'songs');
    ok(!s.open && s.overlay === null && !s.inline, 'narrow: dragged down with the mouse: closed');
    await closeCtx(ctx, 'drag narrow');
  }

  // a tablet: Songs and the account menu are popovers (no handle) — a drag on their head does nothing
  for (const sz of [IPAD, IPAD_L]) {
    console.log(`\n=== drag (${sz.n}: popovers)`);
    const ctx = await context(sz);
    const p = await home(ctx);
    const cdp = await ctx.newCDPSession(p);
    await openSongs(p, cdp);
    ok(!(await shown(p, '#songs .grab')), `${sz.n}: no handle on the Songs popover`);
    const hd = await rect(p, '#songs .sheet-head h2');
    const mid = await swipe(p, cdp, hd.cx, hd.cy, 260, { steps: 12, mid: () => sheetState(p, 'songs') });
    await p.waitForTimeout(400);
    ok(mid.ty === 0 && (await sheetState(p, 'songs')).open, `${sz.n}: dragging its head neither moves nor closes it`);
    await p.keyboard.press('Escape');
    await closeCtx(ctx, `drag ${sz.n}`);
  }
}

// --- A2: the song's title in the top bar is plain words ---------------------------------------------
async function pill() {
  for (const sz of [IPHONE, IPAD, IPAD_L, DESKTOP]) {
    console.log(`\n=== pill (${sz.n})`);
    const ctx = await context(sz, { seed: { 'resonate.sing.song': 'amazing-grace' } });
    const p = await home(ctx);
    // a long title (ellipsis), opened from Songs
    const id = await p.evaluate(async () => {
      const L = await import('./library.js?v=' + document.getElementById('version').textContent.trim().slice(1));
      const xml = await (await fetch('songs/amazing-grace.musicxml')).text();
      const long = 'Amazing Grace (How Sweet the Sound) — the long arrangement for voice and piano';
      return L.addSong(long, xml.replace(/(<score-partwise[^>]*>)/, `$1<movement-title>${long}</movement-title>`), { source: 'file' }); // (Sing names it from the score)
    });
    if (sz.touch) { const cdp = await ctx.newCDPSession(p); await openSongs(p, cdp); } else { await p.click('#songs-btn'); await p.waitForSelector('#songs-body .song'); }
    await p.click(`#songs-body .song[data-id="${id}"]`);
    await p.waitForFunction(() => !document.getElementById('song-pill').hidden && !document.getElementById('song-pill').hasAttribute('data-loading'), null, { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(800);
    const info = await p.evaluate(() => {
      const pill = document.getElementById('song-pill'), t = document.getElementById('song-title'), tx = pill.querySelector('.t');
      const cs = getComputedStyle(pill);
      return {
        tag: t.tagName, popup: !!pill.querySelector('[aria-haspopup]'), svgs: t.querySelectorAll('svg').length, buttons: [...pill.querySelectorAll('button')].map((b) => b.id),
        pe: getComputedStyle(t).pointerEvents, bg: cs.backgroundColor, shadow: cs.boxShadow, cut: tx.scrollWidth > tx.clientWidth + 1, text: tx.textContent,
        oneLine: tx.getBoundingClientRect().height < 30,
      };
    });
    ok(info.tag === 'SPAN' && !info.popup && !info.svgs && info.buttons.join() === 'song-close' && info.pe === 'none',
      `${sz.n}: the title is plain words: no button, no chevron, no aria-haspopup; the ✕ the only control (${JSON.stringify({ tag: info.tag, popup: info.popup, svgs: info.svgs, buttons: info.buttons, pe: info.pe })})`);
    ok(/rgba\(0, 0, 0, 0\)|transparent/.test(info.bg) && info.shadow === 'none', `${sz.n}: no box around it (${info.bg}, ${info.shadow})`);
    ok(/long arrangement/.test(info.text) && info.cut && info.oneLine, `${sz.n}: a long title on one line, cut with an ellipsis ("${info.text}", cut ${info.cut}, one line ${info.oneLine})`);
    const tr = await rect(p, '#song-title'), cl = await rect(p, '#song-close'), av = await rect(p, '#avatar');
    ok(cl.w >= 44 && cl.h >= 44 && cl.x >= tr.r - 1 && cl.r <= av.x, `${sz.n}: the ✕ (${cl.w}×${cl.h}) right after the title, clear of the avatar`);
    await shot(p, `pill-${sz.n}`);
    // a tap on the title opens nothing
    if (sz.touch) { const cdp = await ctx.newCDPSession(p); await tapAt(cdp, tr.x + Math.min(40, tr.w / 2), tr.cy); } else await p.mouse.click(tr.x + Math.min(40, tr.w / 2), tr.cy);
    await p.waitForTimeout(400);
    let d = await dbg(p);
    ok(!(await shown(p, '#songs')) && !d.overlay && await shown(p, '#song-pill'), `${sz.n}: a tap on the title opens nothing (overlay ${d.overlay})`);
    // Songs is the way to the list
    await p.click('#songs-btn');
    await p.waitForTimeout(300);
    ok(await shown(p, '#songs'), `${sz.n}: Songs opens the list`);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(200);
    // the ✕ closes the song
    await p.click('#song-close');
    await p.waitForTimeout(800);
    d = await dbg(p);
    ok(!(await shown(p, '#song-pill')) && await shown(p, '#main-btn'), `${sz.n}: ✕ closes the song (home: Start)`);
    await closeCtx(ctx, `pill ${sz.n}`);
  }
}

// --- A8: the folded conversion keeps its footprint; the Score's ▶ beside it never moves --------------
async function tile() {
  for (const sz of [IPHONE, SAFARI, IPAD, IPAD_L, DESKTOP]) {
    console.log(`\n=== tile (${sz.n})`);
    const mods = JSON.stringify({ phone: ['score'], tablet: ['score'], desktop: ['score'] });
    const ctx = await context(sz, { seed: { 'resonate.shell.modules': mods, 'resonate.sing.song': 'amazing-grace' } });
    const p = await home(ctx);
    const pdfId = await p.evaluate(async (pdf) => {
      const L = await import('./library.js?v=' + document.getElementById('version').textContent.trim().slice(1));
      return L.addPdfSong(Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0)).buffer, { name: 'Grace.pdf', title: 'Grace' }); // (short: the words that change set the width, if anything does)
    }, PDF_B64);
    // Amazing Grace with the Score alone (the saved modules: from Songs — Next-up opens with Sing): its ▶ in the dock
    await p.click('#songs-btn');
    await p.waitForSelector('#songs-body .song[data-id="amazing-grace"]');
    await p.click('#songs-body .song[data-id="amazing-grace"]');
    const inDock = () => p.evaluate(() => !!document.querySelector('.dock .row > #play') && !!document.querySelector('.dock #play').getClientRects().length);
    for (let i = 0; i < 80 && !(await inDock()); i++) await p.waitForTimeout(250);
    ok(await inDock(), `${sz.n}: the Score alone — its ▶ in the dock`);
    await p.waitForTimeout(1500); // (Verovio's layout settles)
    // ⋯ → Convert on the PDF; Songs closed: the tile beside Songs
    await p.click('#songs-btn');
    await p.waitForSelector(`#songs-body .songrow[data-id="${pdfId}"] .more`);
    await p.click(`#songs-body .songrow[data-id="${pdfId}"] .more`);
    await p.click('#row-menu [data-act="convert"]');
    await p.keyboard.press('Escape');
    const run = await until(p, (d) => d.import.mini && d.import.song?.id === pdfId, 10000);
    ok(!!run, `${sz.n}: converting, folded: the tile shows`);
    // every frame for 4 s: the ▶ and the tile's rects, the tile's words
    const smp = await p.evaluate(() => new Promise((res) => {
      const out = [], t0 = performance.now(), play = document.querySelector('.dock #play'), tile = document.getElementById('imp-mini');
      const r = (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map((v) => Math.round(v * 100) / 100); };
      (function f() {
        if (!tile.hidden) out.push({ play: r(play), tile: r(tile), text: tile.textContent.replace(/\s+/g, ' ').trim() });
        if (performance.now() - t0 < 4000) requestAnimationFrame(f); else res(out);
      })();
    }));
    const texts = new Set(smp.map((s) => s.text));
    const spread = (k) => smp.length ? Math.max(...[0, 1, 2, 3].map((i) => Math.max(...smp.map((s) => s[k][i])) - Math.min(...smp.map((s) => s[k][i])))) : NaN;
    ok(smp.length > 60 && texts.size >= 3, `${sz.n}: sampled ${smp.length} frames, the tile's words changed ${texts.size - 1} times (${[...texts].slice(-2).join(' | ')})`);
    ok(spread('play') === 0, `${sz.n}: the ▶ never moved (±${spread('play')} px; ${smp[0]?.play.join(',')})`);
    ok(spread('tile') === 0, `${sz.n}: the tile kept its footprint (±${spread('tile')} px; ${smp[0]?.tile.slice(2).join('×')})`);
    if (sz.w >= 1024) { // (a long title and long words: the same footprint, cut inside — measured before the next second's redraw)
      const long = await p.evaluate(() => {
        const t = document.getElementById('imp-mini'), r0 = t.getBoundingClientRect().width;
        t.querySelector('.pt').textContent = 'Amazing Grace (How Sweet the Sound) — the long arrangement';
        t.querySelector('.ps').textContent = 'song 12/20 · 13/14 · black & white · ~12 min';
        const r1 = t.getBoundingClientRect().width;
        return { r0, r1, cut: [...t.querySelectorAll('.pt, .ps')].every((e) => e.scrollWidth > e.clientWidth + 1) };
      });
      ok(long.r1 === long.r0 && long.cut, `${sz.n}: long words: the same width (${long.r0} → ${long.r1}), cut inside (ellipsis)`);
    }
    const tr = await rect(p, '#imp-mini'), pr = await rect(p, '.dock #play');
    ok(tr.vis && (tr.x >= pr.r - 1 || tr.b <= pr.y + 1) && tr.r <= sz.w, `${sz.n}: the tile clear of the ▶ and on screen`);
    await shot(p, `tile-${sz.n}`);
    // stopped: nothing left converting
    await p.click('#songs-btn');
    await p.click('#songs-body [data-act="stop"]').catch(() => {});
    await until(p, (x) => !x.import.song, 8000);
    await closeCtx(ctx, `tile ${sz.n}`);
  }
}

(async () => {
  browser = await chromium.launch();
  for (const [k, fn] of Object.entries({ drag, pill, tile })) {
    if (!want(k)) continue;
    try { await fn(); } catch (e) { ok(false, `${k}: ${String(e.message || e).split('\n')[0]}`); }
    for (const c of browser.contexts()) await c.close().catch(() => {});
  }
  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
