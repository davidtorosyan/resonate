// The PDF-first song library in the shell (v90, docs/LIBRARY.md §4): Songs → + Add → PDF stores a
// PDF-only song at once (several files: rows, "✓ 2 added"; one file: it opens in place with the Score
// on its PDF), each row's ⋯ menu (Convert / Reconvert, Delete in two taps), the header's Convert all
// and while it runs "Converting 1/2" + Stop, the conversions one after another in the tray (folded, the
// tile "song 1/4 · …", no done row between songs, then one: "✓ 2 converted" / "✓ Title · ready"), the
// queue across a reload, deleting a queued / the running / the open song, Stop, Reconvert (forced, even
// with this engine), a PDF-only song opened on a phone / an iPad / a desktop (the Score only, no Sing
// toggle, ▶ not in the dock), Play's Convert in the shell (the Score reloads with notes, Sing comes
// back), the remote's open_song (pdf_only) and sing (refused) for one, a PDF that can't be read in a batch
// (marked "couldn't read", said, the queue goes on, Convert all passes it by).
// fixes: the v90 review round, one check per finding (F1–F10 below: two tabs and the queue, Stop as a
// song starts, a delete synced from elsewhere, the done row of a deleted song, the batch's count and a
// forced Reconvert across a reload, the wake lock while paused, an error that can't be tried again, the
// ⋯ menu against outside taps and re-renders, a PDF only converted elsewhere, open_song on a bad PDF).
// No engine: the worker is replaced by a script posting what the real one would (importfixes.cjs's
// fakeWorker: fixtures/trace's Amazing Grace blocks, then its MusicXML), so a conversion takes seconds.
// Synthetic PDFs only (fixtures/import/amazing-grace1.pdf).
//   node songlib.cjs                         (http://localhost:8097; screenshots into SHOTS)
//   ONLY=add,remote,queue,open,convert,fail,look,fixes node songlib.cjs   (FIX=1,2,… picks fixes)
//   SHOTS=0 node songlib.cjs                 (no screenshots; or node -r ./harness/noshots.cjs)
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = (process.env.BASE || 'http://localhost:8097').replace(/\/$/, '') + '/resonate/';
const FX = path.join(__dirname, 'fixtures');
const SHOTS = process.env.SHOTS === '0' ? null : process.env.SHOTS || path.join(os.tmpdir(), 'resonate-songlib');
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const want = (k) => !ONLY || ONLY.has(k);
const PDF = path.join(FX, 'import', 'amazing-grace1.pdf');
const PDF2 = path.join(FX, 'import', 'greensleeves3.pdf');
const PDF_B64 = fs.readFileSync(PDF).toString('base64');

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
  slow: [...MILESTONES, ...AG.slice(0, cut), ['wait', 3000], ...AG.slice(cut), ...AG_END], // (time to look at it running)
  full: [...MILESTONES, ...AG, ...AG_END],
  long: [...MILESTONES, ...AG.slice(0, cut), ['wait', 8000], ...AG.slice(cut), ...AG_END], // (another tab looks on)
  err: [...MILESTONES, ['post', { type: 'error', message: 'The engine stopped.' }]], // (kind engine: kept once per stage)
};

let browser;
async function context(sz, { seed = {}, scenario = 'full', wake = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: sz.w, height: sz.h }, deviceScaleFactor: 1, permissions: ['microphone'],
    ...(sz.touch ? { isMobile: true, hasTouch: true } : {}) });
  ctx.sc = scenario;
  ctx.scs = []; // (scenarios for the next workers, in turn; then ctx.sc)
  await ctx.route('**/omr/omr-worker.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: fakeWorker(SC[ctx.scs.length ? ctx.scs.shift() : ctx.sc]) }));
  await ctx.route('**/*.supabase.co/**', (r) => r.abort());
  await ctx.addInitScript((seed) => {
    try { if (!navigator.audioSession) Object.defineProperty(navigator, 'audioSession', { configurable: true, value: { type: 'auto' } }); } catch {}
    try {
      if (location.protocol === 'about:' || sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    } catch {}
  }, seed);
  // (the screen wake lock counted: window.__wl = { asks, active })
  if (wake) await ctx.addInitScript(() => {
    window.__wl = { asks: 0, active: 0 };
    const request = async () => {
      window.__wl.asks++; window.__wl.active++;
      const s = new EventTarget();
      s.released = false;
      s.release = async () => { if (!s.released) { s.released = true; window.__wl.active--; s.dispatchEvent(new Event('release')); } };
      return s;
    };
    try { Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } }); } catch {}
  });
  ctx.errors = [];
  ctx.on('page', (p) => {
    p.on('pageerror', (e) => ctx.errors.push(`${p.url().split('/').pop()}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|supabase|Failed to fetch|sync/i.test(m.text())) ctx.errors.push(`${p.url().split('/').pop()}: ${m.text()}`); });
  });
  return ctx;
}
async function closeCtx(ctx, label) {
  ok(!ctx.errors.length, `${label}: no console errors${ctx.errors.length ? ': ' + ctx.errors.slice(0, 5).join(' | ') : ''}`);
  await ctx.close();
}
const dbg = (p) => p.evaluate(() => window.resonateDebug?.()).catch(() => null);
async function until(p, pred, ms = 15000) {
  const end = Date.now() + ms;
  let d = null;
  while (Date.now() < end) { d = await dbg(p); try { if (d && pred(d)) return d; } catch {} await p.waitForTimeout(150); }
  return null;
}
const rect = (p, sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom, vis: !!e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' }; }).catch(() => null);
const shown = async (p, sel) => !!(await rect(p, sel))?.vis;
const text = (p, sel) => p.textContent(sel).then((t) => (t || '').replace(/\s+/g, ' ').trim()).catch(() => '');
const shot = (p, name) => (SHOTS ? p.screenshot({ path: path.join(SHOTS, `${name}.png`) }) : null);
async function home(ctx) {
  const p = await ctx.newPage();
  await p.goto(BASE + 'shell.html');
  await p.waitForFunction(() => window.resonateDebug?.().tuner, null, { timeout: 15000 });
  await p.waitForTimeout(300);
  return p;
}
// Songs added through the page's own library module (the badge's version: the same module instance).
// list: [{ pdf: true, name, title, fail? } | { xml: true, title, source, engine? }]
function seed(p, list) {
  return p.evaluate(async ({ list, pdf }) => {
    const v = document.getElementById('version').textContent.trim().replace(/^v/, '');
    const L = await import(`./library.js?v=${v}`);
    const buf = () => Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0)).buffer;
    const xml = await (await fetch('songs/amazing-grace.musicxml')).text();
    const ids = [];
    for (const [i, s] of list.entries()) {
      if (s.pdf) {
        const id = await L.addPdfSong(buf(), { name: s.name, title: s.title });
        if (s.fail) await L.markConvFailed(id, { kind: 'nomusic', message: 'no music' });
        ids.push(id);
      } else {
        ids.push(await L.addSong(s.title, xml + ' '.repeat(i), { source: s.source, ...(s.source === 'pdf' ? { pdf: buf(), pdfName: 'x.pdf' } : {}), ...(s.engine ? { engine: { n: s.engine, id: 'x', at: Date.now() } } : {}) }));
      }
    }
    return ids;
  }, { list, pdf: PDF_B64 });
}
const rows = (p) => p.$$eval('#songs-body .songrow', (rs) => rs.map((r) => ({ id: r.dataset.id, t: r.querySelector('.t')?.textContent, s: r.querySelector('.s')?.textContent || '', more: !!r.querySelector('.more'), tile: r.querySelector('.tile')?.dataset.src })));
const rowFact = (p, id) => text(p, `#songs-body .song[data-id="${id}"] .s`);
async function openMenu(p, id) {
  await p.waitForSelector(`#songs-body .songrow[data-id="${id}"] .more`, { timeout: 5000 });
  await p.click(`#songs-body .songrow[data-id="${id}"] .more`);
}
async function deleteSong(p, id) {
  await openMenu(p, id);
  await p.click('#row-menu [data-act="delete"]');
  await p.click('#row-menu [data-act="delete"]');
}
async function openSongs(p) {
  if (!(await shown(p, '#songs'))) await p.click('#songs-btn');
  await p.waitForSelector('#songs-body .song', { timeout: 5000 });
}
const IPAD = { n: 'ipad', w: 820, h: 1180, touch: true };
const IPHONE = { n: 'iphone', w: 393, h: 852, touch: true };
const DESKTOP = { n: 'desktop', w: 1440, h: 900, touch: false };

// --- add two PDFs, the ⋯ menu, Convert all, the done row; one PDF opens on its PDF; delete it ------
async function add() {
  console.log('\n=== add (iPad): + Add → PDF, ⋯, Convert all, delete the open song');
  const ctx = await context(IPAD, { seed: { 'resonate.sing.song': 'amazing-grace' } });
  const p = await home(ctx);
  await p.click('#songs-btn');
  await p.waitForSelector('#songs-body .song');
  await p.click('#add-btn');
  ok((await text(p, '#add-pdf')) === 'PDF', `the menu says "PDF" (${await text(p, '#add-pdf')})`);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('#add-pdf')]);
  ok(fc.isMultiple(), 'the PDF picker takes several files');
  const t0 = Date.now();
  await fc.setFiles([PDF, PDF2]);
  await p.waitForFunction(() => document.querySelectorAll('#songs-body .songrow .more').length >= 2, null, { timeout: 8000 }).catch(() => {});
  const ms = Date.now() - t0;
  let rs = await rows(p);
  const mine = rs.filter((r) => r.more);
  ok(mine.length === 2 && mine.every((r) => r.s === 'PDF only · new' && r.tile === 'pdf'), `two PDF-only rows with ⋯ at once (${ms} ms): ${JSON.stringify(mine.map((r) => [r.t, r.s, r.tile]))}`);
  ok(mine.map((r) => r.t).sort().join() === 'amazing-grace1,greensleeves3', `titles from the file names (${mine.map((r) => r.t).join(', ')})`);
  ok(rs.filter((r) => !r.more).length >= 1, 'samples: no ⋯');
  ok(/✓ 2 added/.test(await text(p, '#songs-msg')), `said: "${await text(p, '#songs-msg')}"`);
  ok(!(await dbg(p)).song.open && !(await dbg(p)).import.song, 'two files: nothing opened, nothing converting');
  ok(/Convert all · 2/.test(await text(p, '#songs-body .sec')), `header: "${await text(p, '#songs-body .sec')}"`);
  const ids = mine.map((r) => r.id);
  // the ⋯ menu
  await openMenu(p, ids[0]);
  ok(await shown(p, '#row-menu'), 'the ⋯ menu shows');
  const items = await p.$$eval('#row-menu .prow', (b) => b.map((x) => x.textContent.trim()));
  ok(items.join(',') === 'Convert,Delete', `a PDF only: ${items.join(', ')}`);
  const mr = await rect(p, '#row-menu'), rr = await rect(p, `#songs-body .songrow[data-id="${ids[0]}"]`);
  ok(mr && rr && Math.abs(mr.y - rr.b) < 12, `the menu at the row (${Math.round(mr?.y)} vs ${Math.round(rr?.b)})`);
  await p.keyboard.press('Escape');
  ok(!(await shown(p, '#row-menu')) && (await shown(p, '#songs')), 'Escape closes the menu only');
  await openMenu(p, ids[0]);
  const sr = await rect(p, '#songs');
  await p.mouse.click(sr.x + 30, sr.y + 20); // (the sheet's title: inside the sheet, outside the menu)
  await p.waitForTimeout(200);
  ok(!(await shown(p, '#row-menu')) && (await shown(p, '#songs')), 'a tap elsewhere in the sheet closes the menu only');
  await openMenu(p, ids[0]);
  await p.mouse.click(30, IPAD.h / 2); // (the scrim beside the popover: Songs closes, the menu with it)
  await p.waitForTimeout(300);
  ok(!(await shown(p, '#row-menu')) && !(await shown(p, '#songs')), 'a tap on the scrim closes Songs and the menu');
  // Convert all: one after the other, folded
  await openSongs(p);
  await p.click('#songs-body [data-act="convert-all"]');
  let d = await until(p, (x) => x.import.song, 5000);
  ok(!!d?.import.song, `a song converting (${JSON.stringify(d?.import.queue)})`);
  const order = await p.evaluate(() => JSON.parse(localStorage.getItem('resonate.convert') || 'null'));
  ok(d && order && d.import.queue.total === 2 && order.ids.length === 1 && order.ids[0] !== d.import.song.id, `queue stored: 1 waiting, total 2 (${JSON.stringify(order)})`);
  ok(d && d.import.song.id === rs.filter((r) => r.more).map((r) => r.id)[0], 'Convert all in list order (the first row first)');
  const sec = await text(p, '#songs-body .sec');
  ok(/Converting 1\/2/.test(sec) && /Stop/.test(sec) && !/Convert all/.test(sec), `header while running: "${sec}"`);
  const first = d.import.song.id, other = ids.find((i) => i !== first);
  ok(/^converting/.test(await rowFact(p, first)), `its row: "${await rowFact(p, first)}"`);
  ok(/^PDF only · queued$/.test(await rowFact(p, other)), `the other: "${await rowFact(p, other)}"`);
  ok(d.import.mode === 'min' && !(await shown(p, '#tray')), `folded (${d.import.mode})`);
  await openMenu(p, first);
  const busyItems = await p.$$eval('#row-menu .prow', (b) => b.map((x) => x.textContent.trim()));
  ok(busyItems.join(',') === 'Delete', `the converting song's menu: ${busyItems.join(', ')}`);
  await p.keyboard.press('Escape');
  d = await until(p, (x) => (x.import.queue.running && x.import.queue.running !== first) || x.import.result, 30000);
  ok(!!d && !d.import.result && !(await shown(p, '#imp-done')), 'the second starts; no done row between songs');
  ok(d && /Converting 2\/2/.test(await text(p, '#songs-body .sec')), `header: "${await text(p, '#songs-body .sec')}"`);
  d = await until(p, (x) => x.import.result, 30000);
  ok(d?.import.result?.batch === 2, `batch result: ${JSON.stringify(d?.import.result)}`);
  await p.waitForTimeout(400);
  rs = await rows(p);
  ok(rs.filter((r) => r.more && r.s === 'engine 10 · new' && r.tile === 'conv').length === 2, `rows: engine 10 (${rs.filter((r) => r.more).map((r) => r.s).join(', ')})`);
  ok(!/Convert all|Reconvert all|Converting/.test(await text(p, '#songs-body .sec')), `header: nothing to convert (${await text(p, '#songs-body .sec')})`);
  ok(await p.evaluate(() => localStorage.getItem('resonate.convert')) === null, 'the queue key removed');
  const titles = await p.evaluate(async () => { const v = document.getElementById('version').textContent.trim().replace(/^v/, ''); return (await (await import(`./library.js?v=${v}`)).listSongs()).map((s) => [s.title, s.k, s.eng]); });
  ok(titles.length === 2 && titles.every(([, k, e]) => k === 'conv' && e === 10), `stored: ${JSON.stringify(titles)}`);
  ok(await p.evaluate(() => localStorage.getItem('resonate.sing.song')) === 'amazing-grace', 'the open song pointer untouched by the conversions');
  // the done row, at home
  if (await shown(p, '#songs')) await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  ok((await shown(p, '#imp-done')) && /2 converted/.test(await text(p, '#imp-done')) && !(await shown(p, '#imp-done .openbtn')), `done row: "${await text(p, '#imp-done')}" (no Open)`);
  await shot(p, 'add-done-ipad');
  await p.click('#imp-done .x');
  ok(!(await shown(p, '#imp-done')), '✕ closes the done row');
  // one PDF → it opens in place on its PDF (the Score only)
  await openSongs(p);
  await p.click('#add-btn');
  const [fc2] = await Promise.all([p.waitForEvent('filechooser'), p.click('#add-pdf')]);
  await fc2.setFiles([PDF]);
  d = await until(p, (x) => x.song.open && x.song.pdfOnly, 8000);
  ok(!!d && !d.song.set.sing && d.song.set.score, `one PDF: opened, the Score only (${JSON.stringify(d?.song.set)})`);
  ok(!(await shown(p, '#mod-sing')) && (await shown(p, '#mod-score')), 'no Sing toggle; the Score toggle');
  const newId = d?.song.state?.song;
  ok(!!newId && (await p.evaluate(() => localStorage.getItem('resonate.sing.song'))) === newId, `the open song is the new one (${newId})`);
  d = await until(p, (x) => x.score?.play?.song === newId && x.score.play.pdfOnly && x.score.play.onScreen, 15000);
  ok(!!d, 'the Score shows its PDF');
  ok(!(await dbg(p)).import.song, 'not converted by itself');
  // delete it while it's open: the song closes, Songs comes back without it
  await p.click('#songs-btn');
  await openMenu(p, newId);
  await p.click('#row-menu [data-act="delete"]');
  ok(/Delete\?/.test(await text(p, '#row-menu [data-act="delete"]')), 'Delete → "Delete?" (armed)');
  await p.waitForTimeout(3300);
  ok(/^Delete$/.test(await text(p, '#row-menu [data-act="delete"]')), 'unarmed after 3 s');
  await p.click('#row-menu [data-act="delete"]');
  await p.click('#row-menu [data-act="delete"]');
  d = await until(p, (x) => !x.song.open && !x.songs.deleting, 8000);
  await p.waitForTimeout(800);
  ok(!!d && !d.song.open, 'the song closed');
  ok(await shown(p, '#songs'), 'Songs open again');
  ok(!(await p.$(`#songs-body .songrow[data-id="${newId}"]`)), 'its row gone');
  const gone = await p.evaluate(async (id) => {
    const v = document.getElementById('version').textContent.trim().replace(/^v/, '');
    const L = await import(`./library.js?v=${v}`);
    return { song: await L.getSong(id), pdf: await L.getPdf(id), open: localStorage.getItem('resonate.sing.song'), play: JSON.parse(localStorage.getItem('resonate.play') || '{}')[id] };
  }, newId);
  ok(!gone.song && !gone.pdf && gone.open === null && gone.play === undefined, `deleted: song, PDF, open pointer, Play's record (${JSON.stringify(gone)})`);
  ok(/shell\.html$/.test(p.url()), 'still shell.html');
  await closeCtx(ctx, 'add');
}

// --- a phone: the remote on a PDF only, Convert while it's open, Reconvert forced, Stop ------------
async function remote() {
  console.log('\n=== remote (iPhone): open_song / sing on a PDF only, Convert while open, Reconvert, Stop');
  const ctx = await context(IPHONE, { seed: { 'resonate.sing.song': 'amazing-grace' } });
  const p = await home(ctx);
  const [a, b] = await seed(p, [{ pdf: true, name: 'Wichita_Lineman.pdf', title: 'Wichita Lineman' }, { xml: true, title: 'Piano Man', source: 'pdf', engine: 10 }]);
  const run = (action, args) => p.evaluate(async ({ action, args }) => {
    const v = document.getElementById('version').textContent.trim().replace(/^v/, '');
    const { remote } = await import(`./assist.js?v=${v}`);
    return remote.hooks.run(action, args);
  }, { action, args });
  let r = await run('open_song', { song: 'wichita' });
  ok(r?.ok && r.pdf_only && r.song?.id === a && r.song?.pdf_only, `open_song: ok, pdf_only, the song (${JSON.stringify(r).slice(0, 200)})`);
  let d = await dbg(p);
  ok(d.song.open && d.song.pdfOnly && d.song.set.score && !d.song.set.sing, `the Score only on a phone (${JSON.stringify(d.song.set)})`);
  r = await run('sing', {});
  ok(r && r.ok === false && r.pdf_only && /convert it first/.test(r.error || ''), `sing refused: "${r?.error}"`);
  r = await run('listen', {});
  ok(r && r.ok === false && r.pdf_only, 'listen refused too');
  r = await run('stop', {});
  ok(r && r.ok !== false, `stop answers (${JSON.stringify(r).slice(0, 120)})`);
  await p.evaluate(async (id) => { const v = document.getElementById('version').textContent.trim().replace(/^v/, ''); (await import(`./shell/songlist.js?v=${v}`)).openSong(id, { sing: true }); }, a);
  await p.waitForTimeout(600);
  d = await dbg(p);
  ok(!d.song.set.sing && d.song.pdfOnly, 'openSong {sing} (Next-up) keeps Sing off for a PDF only');
  // Convert from the list while it's open: Sing (the phone's saved module) comes back
  await openSongs(p);
  await openMenu(p, a);
  await p.click('#row-menu [data-act="convert"]');
  d = await until(p, (x) => x.import.result, 40000);
  ok(d?.import.result?.songId === a && !d.import.result.batch, `converted: ${JSON.stringify(d?.import.result)}`);
  d = await until(p, (x) => x.song.set.sing && !x.song.pdfOnly, 15000);
  ok(!!d, `the saved modules again (${JSON.stringify((await dbg(p)).song.set)})`);
  await p.waitForFunction(() => !document.getElementById('mod-sing').hidden, null, { timeout: 8000 }).catch(() => {});
  ok(await shown(p, '#mod-sing'), 'the Sing toggle shown');
  if (await shown(p, '#songs')) await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  ok(/ready/.test(await text(p, '#imp-done .s')), `the done row: "${await text(p, '#imp-done')}" (a first conversion: ready)`);
  await p.click('#imp-done .x').catch(() => {});
  // Reconvert a song this engine read already: forced (not passed by)
  await openSongs(p);
  ok(/^engine 10 · /.test(await rowFact(p, b)), `the engine-10 row: "${await rowFact(p, b)}"`);
  ok(!/Reconvert all/.test(await text(p, '#songs-body .sec')), 'no Reconvert all (nothing older)');
  await openMenu(p, b);
  const items = await p.$$eval('#row-menu .prow', (x) => x.map((e) => e.textContent.trim()));
  ok(items.join(',') === 'Reconvert,Delete', `converted from a PDF: ${items.join(', ')}`);
  ctx.sc = 'slow';
  await p.click('#row-menu [data-act="reconvert"]');
  d = await until(p, (x) => x.import.song?.id === b, 5000);
  ok(!!d, 'Reconvert runs (forced)');
  await p.waitForTimeout(500);
  ok(/Converting/.test(await text(p, '#songs-body .sec')) && (await shown(p, '#songs-body [data-act="stop"]')), `header: "${await text(p, '#songs-body .sec')}"`);
  await p.click('#songs-body [data-act="stop"]');
  d = await until(p, (x) => !x.import.song && !x.import.running, 8000);
  ok(!!d && !d.import.queue.ids.length, `Stop: stopped (${JSON.stringify(d?.import.queue)})`);
  await p.waitForTimeout(500);
  ok(/^engine 10/.test(await rowFact(p, b)), `its row as it was: "${await rowFact(p, b)}"`);
  ok(await p.evaluate(() => localStorage.getItem('resonate.import')) === null && await p.evaluate(() => localStorage.getItem('resonate.convert')) === null, 'no import flag, no queue');
  ok(!(await shown(p, '#imp-done')) && !(await shown(p, '#imp-mini')), 'no done row, no tile');
  await closeCtx(ctx, 'remote');
}

// --- a queue across a reload; deleting a queued song and the running one; the tile's line ----------
async function queue() {
  console.log('\n=== queue (iPad): four songs, a reload, deletes');
  const ctx = await context(IPAD, { scenario: 'slow' });
  const p = await home(ctx);
  const ids = await seed(p, ['One', 'Two', 'Three', 'Four'].map((n) => ({ pdf: true, name: `${n}.pdf`, title: n })));
  await openSongs(p);
  ok(/Convert all · 4/.test(await text(p, '#songs-body .sec')), `header: "${await text(p, '#songs-body .sec')}"`);
  await p.click('#songs-body [data-act="convert-all"]');
  let d = await until(p, (x) => x.import.song && x.import.reader?.phase === 'read', 15000);
  const first = d?.import.song.id;
  ok(!!d && d.import.queue.total === 4 && d.import.queue.ids.length === 3, `queue: 4, 3 waiting (${JSON.stringify(d?.import.queue)})`);
  ok(first === ids[3], 'the newest row first (list order)');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  const ps = await text(p, '#imp-mini .ps');
  ok(/^song 1\/4 · /.test(ps), `the tile: "${ps}"`);
  // delete a queued one
  const queued = d.import.queue.ids[1];
  await openSongs(p);
  await deleteSong(p, queued);
  d = await until(p, (x) => !x.songs.deleting && x.import.queue.total === 3, 6000);
  ok(!!d && !d.import.queue.ids.includes(queued) && d.import.song?.id === first, `a queued one deleted: total 3, the first goes on (${JSON.stringify(d?.import.queue)})`);
  ok(/Converting 1\/3/.test(await text(p, '#songs-body .sec')), `header: "${await text(p, '#songs-body .sec')}"`);
  // a reload mid-song
  await p.reload();
  await p.waitForFunction(() => window.resonateDebug?.().tuner, null, { timeout: 15000 });
  d = await until(p, (x) => x.import.song?.id === first && x.import.running, 15000);
  ok(!!d, `after a reload: the same song goes on (${JSON.stringify((await dbg(p))?.import.queue)})`);
  ok(d && d.import.mode === 'min', 'folded after the reload');
  d = await until(p, (x) => x.import.song && x.import.song.id !== first, 40000);
  ok(!!d && d.import.queue.done === 1, `then the next: done 1 (${JSON.stringify(d?.import.queue)})`);
  // delete the running one
  const run = d.import.song.id;
  await openSongs(p);
  await deleteSong(p, run);
  d = await until(p, (x) => !x.songs.deleting && x.import.song && x.import.song.id !== run, 15000);
  ok(!!d, `the running one deleted: the next starts (${JSON.stringify(d?.import.queue)})`);
  const gone = await p.evaluate(async (id) => { const v = document.getElementById('version').textContent.trim().replace(/^v/, ''); return (await import(`./library.js?v=${v}`)).getSong(id); }, run);
  ok(!gone, 'the deleted song stays gone (not saved back)');
  d = await until(p, (x) => x.import.result, 40000);
  ok(d?.import.result?.batch === 2, `batch result: 2 converted (${JSON.stringify(d?.import.result)})`);
  const list = await p.evaluate(async () => { const v = document.getElementById('version').textContent.trim().replace(/^v/, ''); return (await import(`./library.js?v=${v}`)).listSongs(); });
  ok(list.length === 2 && list.every((s) => s.k === 'conv' && s.eng === 10), `two songs left, both converted (${list.map((s) => `${s.title}:${s.k}:${s.eng}`).join(' ')})`);
  const jobs = await p.evaluate(async () => { const v = document.getElementById('version').textContent.trim().replace(/^v/, ''); return (await (await import(`./omr/jobs.js?v=${v}`)).listJobs()).length; });
  ok(jobs === 0 && await p.evaluate(() => localStorage.getItem('resonate.convert')) === null, `no job, no queue left (${jobs})`);
  await closeCtx(ctx, 'queue');
}

// --- a PDF only opened from the list on a phone, an iPad, a desktop ----------------------------------
async function open() {
  for (const sz of [IPAD, IPHONE, DESKTOP]) {
    console.log(`\n=== open (${sz.n}): a PDF only from the list`);
    const ctx = await context(sz);
    const p = await home(ctx);
    const [id] = await seed(p, [{ pdf: true, name: 'Wichita.pdf', title: 'Wichita Lineman' }]);
    await openSongs(p);
    ok(/^PDF only · new$/.test(await rowFact(p, id)), `${sz.n}: the row "${await rowFact(p, id)}"`);
    await p.click(`#songs-body .song[data-id="${id}"]`);
    const d = await until(p, (x) => x.song.open && x.score?.play?.song === id && x.score.play.pdfOnly && x.score.play.onScreen, 15000);
    await p.waitForTimeout(800);
    ok(!!d && d.song.pdfOnly && !d.song.set.sing && d.song.set.score, `${sz.n}: the Score only, on its PDF (${JSON.stringify(d?.song.set)})`);
    const play = await p.$eval('#play', (e) => ({ inDock: !!e.closest('.dock'), vis: !!e.getClientRects().length }));
    ok(!play.inDock && !play.vis, `${sz.n}: ▶ not in the dock, hidden (${JSON.stringify(play)})`);
    ok(!(await shown(p, '#mod-sing')) && (await shown(p, '#mod-score')), `${sz.n}: no Sing toggle`);
    ok(!(await p.evaluate(() => performance.getEntriesByType('resource').some((e) => /verovio/.test(e.name)))), `${sz.n}: no Verovio fetched`);
    ok((await text(p, '#song-pill .t')) === 'Wichita Lineman', `${sz.n}: the pill "${await text(p, '#song-pill .t')}"`);
    await shot(p, `open-pdfonly-${sz.n}`);
    // Back home, then a sample: the saved modules again (Sing on a phone)
    await p.goBack();
    await until(p, (x) => !x.song.open, 8000);
    await p.evaluate(async () => { const v = document.getElementById('version').textContent.trim().replace(/^v/, ''); (await import(`./shell/songlist.js?v=${v}`)).openSong('amazing-grace'); });
    const d2 = await until(p, (x) => x.song.open && x.song.state?.song === 'amazing-grace' && !x.song.pdfOnly, 15000);
    ok(!!d2 && (sz.n !== 'iphone' || d2.song.set.sing), `${sz.n}: a sample after it opens with the saved modules (${JSON.stringify(d2?.song.set)})`);
    await p.waitForFunction(() => !document.getElementById('mod-sing').hidden, null, { timeout: 5000 }).catch(() => {});
    ok(await shown(p, '#mod-sing'), `${sz.n}: the Sing toggle back`);
    await closeCtx(ctx, `open ${sz.n}`);
  }
}

// --- iPad: Play's Convert on a PDF only in the shell → the Score reloads with notes ----------------
async function convert() {
  console.log("\n=== convert (iPad): Play's Convert in the shell");
  const ctx = await context(IPAD);
  const p = await home(ctx);
  const [id] = await seed(p, [{ pdf: true, name: 'Scanned Document 2.pdf', title: 'Scanned Document 2' }]);
  await openSongs(p);
  await p.click(`#songs-body .song[data-id="${id}"]`);
  let d = await until(p, (x) => x.song.open && x.score?.play?.pdfOnly && x.score.play.onScreen, 15000);
  ok(!!d, 'its PDF shown');
  ok((await text(p, '#pdf-again')).includes('Convert'), `the PDF bar's button: "${await text(p, '#pdf-again')}"`);
  await p.click('#pdf-again');
  d = await until(p, (x) => x.import.song?.id === id, 5000);
  ok(!!d && d.import.mode === 'min', `Convert → the tray, folded (${d?.import.mode})`);
  d = await until(p, (x) => x.import.result, 40000);
  ok(d?.import.result?.songId === id, `converted (${JSON.stringify(d?.import.result)})`);
  d = await until(p, (x) => !x.song.pdfOnly && x.score?.play?.ready && !x.score.play.pdfOnly && x.score.play.song === id, 20000);
  ok(!!d, 'the Score reloaded with notes');
  ok(d && d.score.play.counts?.pitched > 0, `notes drawn (${d?.score.play.counts?.pitched} pitched)`);
  await p.waitForFunction(() => !document.getElementById('mod-sing').hidden, null, { timeout: 8000 }).catch(() => {});
  ok(await shown(p, '#mod-sing'), 'the Sing toggle back');
  const play = await p.$eval('#play', (e) => ({ inDock: !!e.closest('.dock'), vis: !!e.getClientRects().length }));
  ok(play.inDock && play.vis, `▶ in the dock again (the Score alone: ${JSON.stringify(play)})`);
  ok(await p.evaluate(() => localStorage.getItem('resonate.sing.song')) === id, 'the open song pointer: still this one');
  const done = await text(p, '#imp-done');
  ok(/ready/.test(done), `the done row: "${done}"`);
  await shot(p, 'convert-ipad');
  await closeCtx(ctx, 'convert');
}

// --- a PDF that can't be read: marked, said, the queue goes on; Convert all passes it by ------------
async function fail() {
  console.log("\n=== fail (iPad): a PDF that can't be read in a batch");
  const ctx = await context(IPAD);
  const p = await home(ctx);
  const garbage = fs.readFileSync(path.join(FX, 'import', 'garbage.pdf')).toString('base64');
  const [good] = await seed(p, [{ pdf: true, name: 'Good.pdf', title: 'Good' }]);
  const bad = await p.evaluate(async (b) => {
    const v = document.getElementById('version').textContent.trim().replace(/^v/, '');
    const L = await import(`./library.js?v=${v}`);
    return L.addPdfSong(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)).buffer, { name: 'garbage.pdf', title: 'Garbage' });
  }, garbage);
  await openSongs(p);
  await p.click('#songs-body [data-act="convert-all"]');
  let toast = '';
  for (let i = 0; i < 80 && !toast; i++) { toast = await p.evaluate(() => { const t = document.getElementById('toast'); return t && !t.hidden ? t.textContent : ''; }); if (!toast) await p.waitForTimeout(100); }
  ok(/“Garbage” couldn't be read/.test(toast), `said: "${toast}"`);
  let d = await until(p, (x) => x.import.result, 40000);
  ok(d?.import.result?.batch === 1, `the queue went on: ${JSON.stringify(d?.import.result)}`);
  ok(!d?.import.error && !d?.import.stuck && !(await shown(p, '#tray-bar')), 'no bar left waiting');
  await p.waitForTimeout(300);
  ok((await rowFact(p, bad)) === "PDF only · couldn't read" && /^engine 10 · /.test(await rowFact(p, good)), `rows: "${await rowFact(p, bad)}", "${await rowFact(p, good)}"`);
  const rec = await p.evaluate(async (id) => { const v = document.getElementById('version').textContent.trim().replace(/^v/, ''); const L = await import(`./library.js?v=${v}`); return { conv: (await L.getSong(id))?.conv?.kind, fail: (await L.listSongs()).find((x) => x.id === id)?.fail }; }, bad);
  ok(rec.conv === 'pdf' && rec.fail === 1, `marked: conv ${rec.conv}, index fail ${rec.fail}`);
  ok(!/Convert all/.test(await text(p, '#songs-body .sec')), `Convert all passes it by ("${await text(p, '#songs-body .sec')}")`);
  await openMenu(p, bad);
  const items = await p.$$eval('#row-menu .prow', (b) => b.map((x) => x.textContent.trim()));
  ok(items.join(',') === 'Convert,Delete', `its ⋯ still offers: ${items.join(', ')}`);
  await p.keyboard.press('Escape');
  if (await shown(p, '#songs')) await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  ok(/1 converted/.test(await text(p, '#imp-done')), `the done row: "${await text(p, '#imp-done')}"`);
  await closeCtx(ctx, 'fail');
}

// --- the list's look on three sizes: every kind of row, the menu, a run; touch targets ------------
async function look() {
  for (const sz of [IPHONE, IPAD, DESKTOP]) {
    console.log(`\n=== look (${sz.n})`);
    const ctx = await context(sz, { scenario: 'slow' });
    const p = await home(ctx);
    const [wl, scan, km, pm, gs] = await seed(p, [
      { pdf: true, name: 'Wichita_Lineman_-_F_Major_-_MN0305807.pdf', title: 'Wichita Lineman' },
      { pdf: true, name: 'Scan 2.pdf', title: 'Scan 2', fail: true },
      { xml: true, title: 'Killing Me Softly', source: 'pdf' },
      { xml: true, title: 'Piano Man', source: 'pdf', engine: 10 },
      { xml: true, title: 'Greensleeves', source: 'file' },
    ]);
    await openSongs(p);
    await p.waitForTimeout(300);
    const facts = Object.fromEntries(await Promise.all([['wl', wl], ['scan', scan], ['km', km], ['pm', pm], ['gs', gs]].map(async ([k, id]) => [k, await rowFact(p, id)])));
    ok(facts.wl === 'PDF only · new' && facts.scan === "PDF only · couldn't read" && facts.km === 'engine ≤9 · new' && facts.pm === 'engine 10 · new' && facts.gs === 'MusicXML · new', `${sz.n}: facts ${JSON.stringify(facts)}`);
    const old = await p.$$eval('#songs-body .song[data-old]', (x) => x.map((e) => e.dataset.id));
    ok(old.length === 1 && old[0] === km, `${sz.n}: the older engine marked (data-old)`);
    const sec = await text(p, '#songs-body .sec');
    ok(/Convert all · 1/.test(sec) && /Reconvert all · 1/.test(sec), `${sz.n}: header "${sec}" (the failed one left out)`);
    await shot(p, `look-list-${sz.n}`);
    await openMenu(p, km);
    await shot(p, `look-menu-${sz.n}`);
    await p.keyboard.press('Escape');
    await p.click('#songs-body [data-act="reconvert-all"]');
    const d = await until(p, (x) => x.import.song?.id === km, 6000);
    ok(!!d, `${sz.n}: Reconvert all → the older one runs`);
    await p.waitForTimeout(1200);
    await shot(p, `look-running-${sz.n}`);
    const small = await p.evaluate(() => [...document.querySelectorAll('#songs button')].filter((e) => e.getClientRects().length).map((e) => ({ e, r: e.getBoundingClientRect() })).filter(({ r }) => r.width < 43.5 || r.height < 43.5).map(({ e, r }) => `${e.className}:${Math.round(r.width)}x${Math.round(r.height)}`));
    ok(!sz.touch || !small.length, `${sz.n}: touch targets ≥ 44 px${small.length ? ': ' + small.join(', ') : ''}`);
    const wide = await p.evaluate(() => [...document.querySelectorAll('#songs *')].filter((e) => e.getClientRects().length).some((e) => e.getBoundingClientRect().right > innerWidth + 1));
    ok(!wide, `${sz.n}: nothing pokes out sideways`);
    await p.click('#songs-body [data-act="stop"]').catch(() => {});
    await until(p, (x) => !x.import.song, 8000);
    await closeCtx(ctx, `look ${sz.n}`);
  }
}

// --- the v90 review round: one check per finding --------------------------------------------------
const VER = "document.getElementById('version').textContent.trim().replace(/^v/, '')";
const songsNow = (p) => p.evaluate(async (VER) => { const v = eval(VER); return (await (await import(`./library.js?v=${v}`)).listSongs()).map((s) => ({ id: s.id, title: s.title, k: s.k, eng: s.eng })); }, VER);
const songNow = (p, id) => p.evaluate(async ({ id, VER }) => { const v = eval(VER); const s = await (await import(`./library.js?v=${v}`)).getSong(id); return s && { id: s.id, title: s.title, engine: s.engine || null, rev: s.rev || null, xml: typeof s.xml === 'string' }; }, { id, VER });
const queueNow = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('resonate.convert') || 'null'));
const jobsNow = (p) => p.evaluate(async (VER) => { const v = eval(VER); return (await (await import(`./omr/jobs.js?v=${v}`)).listJobs()).length; }, VER);
const toastNow = (p) => p.evaluate(() => { const t = document.getElementById('toast'); return t && !t.hidden ? t.textContent : ''; });
async function waitToast(p, re, ms = 15000) {
  let t = '';
  for (let i = 0; i < ms / 100 && !re.test(t); i++) { t = await toastNow(p); if (!re.test(t)) await p.waitForTimeout(100); }
  return t;
}
const remoteRun = (p, action, args) => p.evaluate(async ({ action, args, VER }) => {
  const v = eval(VER);
  const { remote } = await import(`./assist.js?v=${v}`);
  return remote.hooks.run(action, args);
}, { action, args, VER });
async function closeSongs(p) {
  for (let i = 0; i < 3 && (await shown(p, '#songs')); i++) { await p.keyboard.press('Escape'); await p.waitForTimeout(250); }
}

// F1: another tab's import kept on this device stalled the queue (nothing ran, nothing showed, the
// screen kept awake); a tab that waited on another's song counted it a second time.
async function fixTabs() {
  console.log("\n--- F1 (iPad, two tabs): another tab's import is gone on with here; a song counted once");
  const ctx = await context(IPAD, { scenario: 'long', wake: true });
  const a = await home(ctx);
  const [one, two] = await seed(a, [{ pdf: true, name: 'One.pdf', title: 'One' }, { pdf: true, name: 'Two.pdf', title: 'Two' }]);
  const b = await home(ctx);
  await openSongs(a);
  await openMenu(a, one);
  await a.click('#row-menu [data-act="convert"]');
  ok(!!(await until(a, (x) => x.import.song?.id === one && x.import.jobId, 8000)), 'A converts One');
  await openSongs(b);
  await openMenu(b, two);
  await b.click('#row-menu [data-act="convert"]');
  const w = await until(b, (x) => x.import.state === 'waiting' && x.import.song?.id === one, 8000);
  ok(!!w, `F1 B goes on with A's import, waiting for the engine (${JSON.stringify(w ? null : (await dbg(b))?.import?.state)})`);
  ok((await text(b, '#tray-msg')) === 'Running in another tab', `F1 B's bar: "${await text(b, '#tray-msg')}"`);
  await a.close(); // (iOS ends the tab mid-run)
  const d = await until(b, (x) => x.import.result, 60000);
  const list = await songsNow(b);
  ok(list.length === 2 && list.every((x) => x.k === 'conv'), `F1 both converted in B (${list.map((x) => `${x.title}:${x.k}`).join(' ')})`);
  ok(d?.import.result?.batch === 2, `F1 B: "2 converted" (${JSON.stringify(d?.import.result)})`);
  ok((await queueNow(b)) === null && (await jobsNow(b)) === 0, 'F1 no queue, no job left');
  await b.waitForTimeout(300);
  const wl = await b.evaluate(() => window.__wl);
  ok(wl.active === 0, `F1 B's screen wake lock let go at the end (${JSON.stringify(wl)})`);
  await closeCtx(ctx, 'F1 tabs');

  // a tab opened while another converts a batch: it waits on that song; the song is counted once
  const ctx2 = await context(IPAD, { scenario: 'long' });
  const a2 = await home(ctx2);
  await seed(a2, [{ pdf: true, name: 'One.pdf', title: 'One' }, { pdf: true, name: 'Two.pdf', title: 'Two' }]);
  await openSongs(a2);
  await a2.click('#songs-body [data-act="convert-all"]');
  await until(a2, (x) => x.import.song && x.import.jobId, 8000);
  const b2 = await home(ctx2);
  ok(!!(await until(b2, (x) => x.import.state === 'waiting', 8000)), 'F1 a tab opened meanwhile waits on it');
  let rec = null;
  const trace = async () => { if (!process.env.VERBOSE) return; const [x, y] = [(await dbg(a2))?.import, (await dbg(b2))?.import]; console.log('   ', JSON.stringify(await queueNow(a2)), '| A', x?.state, x?.song?.id, x?.jobId, x?.running, '| B', y?.state, y?.song?.id, y?.jobId, y?.running); };
  for (let i = 0; i < 200 && !(rec?.done >= 1); i++) { rec = await queueNow(a2); if (i % 4 === 0) await trace(); if (!(rec?.done >= 1)) await a2.waitForTimeout(150); }
  await a2.waitForTimeout(2000); // (the waiting tab gets the engine, finds the song done)
  rec = await queueNow(a2);
  ok(rec && rec.done === 1 && rec.total === 2 && rec.ok === 1, `F1 after the first song: done 1 of 2, counted once (${JSON.stringify(rec)})`);
  let ends = null;
  for (let i = 0; i < 400; i++) {
    const [ra, rb] = [(await dbg(a2))?.import, (await dbg(b2))?.import];
    if ((ra?.result || rb?.result) && !ra?.running && !rb?.running) { ends = [ra.result, rb.result]; break; }
    if (i % 4 === 0) await trace();
    await a2.waitForTimeout(150);
  }
  ok(!!ends && ends.filter((r) => r?.batch === 2).length === 1 && ends.filter(Boolean).length === 1, `F1 one tab says "2 converted" (${JSON.stringify(ends)})`);
  ok((await queueNow(a2)) === null && (await songsNow(a2)).every((x) => x.k === 'conv'), 'F1 both converted, the queue gone');
  await closeCtx(ctx2, 'F1 counted once');
}

// F2: Stop (and the Reader's ✕) in a song's first moments — its PDF read and its job stored — didn't
// stop it: it converted on, unseen, and saved.
async function fixStop() {
  console.log('\n--- F2 (iPad): Stop and the Reader\'s ✕ while a song starts');
  const ctx = await context(IPAD, { scenario: 'slow' });
  const p = await home(ctx);
  await seed(p, [{ pdf: true, name: 'One.pdf', title: 'One' }, { pdf: true, name: 'Two.pdf', title: 'Two' }]);
  // (a big PDF on an iPad: its bytes come late — here a File's arrayBuffer() waits window.__late ms)
  await p.evaluate(() => { const ab = Blob.prototype.arrayBuffer; window.__late = 1500; File.prototype.arrayBuffer = function () { return new Promise((r) => setTimeout(r, window.__late)).then(() => ab.call(this)); }; });
  await openSongs(p);
  await p.click('#songs-body [data-act="convert-all"]');
  await p.waitForSelector('#songs-body [data-act="stop"]', { timeout: 3000 });
  const at = (await dbg(p)).import;
  ok(at.running && !at.jobId, `F2 Stop as it starts (running ${at.running}, job ${at.jobId})`);
  await p.click('#songs-body [data-act="stop"]');
  await p.waitForTimeout(5000); // (the run would be well under way)
  let d = (await dbg(p)).import;
  let list = await songsNow(p);
  ok(!d.running && !d.song && list.every((x) => x.k === 'pdf'), `F2 Stop: nothing converts unseen (running ${d.running}; ${list.map((x) => `${x.title}:${x.k}`).join(' ')})`);
  ok((await jobsNow(p)) === 0 && (await queueNow(p)) === null && !(await shown(p, '#imp-mini')) && !(await shown(p, '#imp-done')), 'F2 no job, no queue, no tile, no done row');
  // the Reader's ✕ (two taps) the same
  await p.evaluate(() => { window.__late = 4000; });
  await p.waitForSelector('#songs-body [data-act="convert-all"]', { timeout: 3000 });
  await p.click('#songs-body [data-act="convert-all"]');
  await until(p, (x) => x.import.running, 3000);
  await closeSongs(p);
  await p.click('#imp-mini');
  await p.waitForSelector('#reader-host .rd-stop:not([hidden])', { timeout: 3000 });
  await p.click('#reader-host .rd-stop');
  const at2 = (await dbg(p)).import;
  await p.click('#reader-host .rd-stop');
  ok(at2.running && !at2.jobId, `F2 ✕ as it starts (running ${at2.running}, job ${at2.jobId})`);
  await p.waitForTimeout(7000);
  d = (await dbg(p)).import;
  list = await songsNow(p);
  ok(!d.running && !d.song && list.every((x) => x.k === 'pdf'), `F2 ✕: nothing converts unseen (running ${d.running}; ${list.map((x) => `${x.title}:${x.k}`).join(' ')})`);
  ok((await jobsNow(p)) === 0 && (await queueNow(p)) === null && !(await shown(p, '#imp-mini')) && !(await shown(p, '#imp-done')) && !(await shown(p, '#tray')), 'F2 no job, no queue, no tile, no done row, the tray closed');
  await closeCtx(ctx, 'F2 stop');
}

// F3: a song deleted on another device (the sync: resonate:remote gone) — the one converting and a
// queued one: their conversions go as for a delete here, the rest goes on.
async function fixGone() {
  console.log('\n--- F3 (iPad): songs deleted on another device while a batch runs');
  const ctx = await context(IPAD, { scenario: 'slow' });
  const p = await home(ctx);
  await seed(p, ['One', 'Two', 'Three'].map((n) => ({ pdf: true, name: `${n}.pdf`, title: n })));
  await openSongs(p);
  await p.click('#songs-body [data-act="convert-all"]');
  const d0 = await until(p, (x) => x.import.song && x.import.jobId && x.import.reader?.phase === 'read', 15000);
  const run = d0?.import.song.id, queued = d0?.import.queue.ids[0], left = d0?.import.queue.ids[1];
  await p.evaluate(async ({ ids, VER }) => { // (the sync's pull: the songs removed, then the event)
    const v = eval(VER);
    const L = await import(`./library.js?v=${v}`);
    for (const id of ids) await L.removeSong(id, { quiet: true });
    dispatchEvent(new CustomEvent('resonate:remote', { detail: { songs: true, gone: ids } }));
  }, { ids: [run, queued], VER });
  const t0 = Date.now();
  const st = await until(p, (x) => x.import.song?.id !== run, 15000);
  ok(!!st && Date.now() - t0 < 2500, `F3 the running one stops at once (${Date.now() - t0} ms)`);
  const d1 = await until(p, (x) => x.import.song?.id === left, 15000);
  ok(!!d1 && !d1.import.queue.ids.length, `F3 the running and a queued song gone: the last one runs (${JSON.stringify(d1?.import.queue)})`);
  const d = await until(p, (x) => x.import.result && !x.import.running, 40000);
  const list = await songsNow(p);
  ok(list.length === 1 && list[0].id === left && list[0].k === 'conv', `F3 only the song left, converted — the deleted ones not saved back (${list.map((x) => `${x.title}:${x.k}`).join(' ')})`);
  ok(d?.import.result?.songId === left && !d.import.result.batch, `F3 its done row (${JSON.stringify(d?.import.result)})`);
  ok((await jobsNow(p)) === 0 && (await queueNow(p)) === null, 'F3 no job, no queue left');
  await closeCtx(ctx, 'F3 gone');
}

// F4: the done row (and the Reader's Sing it / Play it) kept offering a song just deleted.
async function fixDoneRow() {
  console.log('\n--- F4 (iPad): the done row of a song deleted');
  const ctx = await context(IPAD);
  const p = await home(ctx);
  const [one] = await seed(p, [{ pdf: true, name: 'One.pdf', title: 'One' }]);
  await openSongs(p);
  await openMenu(p, one);
  await p.click('#row-menu [data-act="convert"]');
  let d = await until(p, (x) => x.import.result && !x.import.running, 30000);
  ok(d?.import.result?.songId === one, 'F4 converted: its done row');
  await deleteSong(p, one);
  d = await until(p, (x) => !x.songs.deleting, 8000);
  await p.waitForTimeout(300);
  await closeSongs(p);
  d = await dbg(p);
  ok(!d.import.result && !d.import.lastOk && !(await shown(p, '#imp-done')), `F4 deleted: no done row, nothing to open (${JSON.stringify(d.import.result)}, ${d.import.lastOk})`);
  // a batch's "2 converted" stays — without the song
  const [a, b] = await seed(p, [{ pdf: true, name: 'A.pdf', title: 'A' }, { pdf: true, name: 'B.pdf', title: 'B' }]);
  await openSongs(p);
  await p.click('#songs-body [data-act="convert-all"]');
  d = await until(p, (x) => x.import.result?.batch === 2 && !x.import.running, 40000);
  const last = d?.import.lastOk;
  ok(!!last && [a, b].includes(last), `F4 a batch: "2 converted", the last song ${last}`);
  await deleteSong(p, last);
  d = await until(p, (x) => !x.songs.deleting, 8000);
  await p.waitForTimeout(300);
  await closeSongs(p);
  d = await dbg(p);
  ok(d.import.result?.batch === 2 && !d.import.result.songId && !d.import.lastOk && /2 converted/.test(await text(p, '#imp-done')), `F4 the batch row stays, without the song (${JSON.stringify(d.import.result)})`);
  await closeCtx(ctx, 'F4 done row');
}

// F5: a reload mid-batch lost the batch's count ("1 converted" of 3) and a forced Reconvert queued
// behind others (dropped: this engine had read it).
async function fixCounts() {
  console.log('\n--- F5 (iPad): the count and a forced Reconvert across a reload');
  const ctx = await context(IPAD, { scenario: 'slow' });
  const p = await home(ctx);
  const [one, two, x] = await seed(p, [{ pdf: true, name: 'One.pdf', title: 'One' }, { pdf: true, name: 'Two.pdf', title: 'Two' }, { xml: true, title: 'Ten', source: 'pdf', engine: 10 }]);
  await openSongs(p);
  await p.click('#songs-body [data-act="convert-all"]');
  await until(p, (y) => y.import.song && y.import.jobId, 8000);
  await openMenu(p, x);
  await p.click('#row-menu [data-act="reconvert"]');
  await p.waitForTimeout(300);
  let rec = await queueNow(p);
  ok(rec?.force?.join() === x && rec.ids.at(-1) === x, `F5 Reconvert queued behind, forced in the stored queue (${JSON.stringify(rec)})`);
  for (let i = 0; i < 300 && !(rec?.done >= 1); i++) { rec = await queueNow(p); if (!(rec?.done >= 1)) await p.waitForTimeout(150); }
  ok(rec?.done === 1 && rec.ok === 1, `F5 the first converted: counted in the stored queue (${JSON.stringify(rec)})`);
  await until(p, (y) => y.import.song && y.import.jobId, 8000);
  await p.reload();
  await p.waitForFunction(() => window.resonateDebug?.().tuner, null, { timeout: 15000 });
  const d = await until(p, (y) => y.import.result && !y.import.running, 60000);
  ok(d?.import.result?.batch === 3, `F5 after the reload: "3 converted" (${JSON.stringify(d?.import.result)})`);
  const ten = await songNow(p, x);
  ok(ten?.engine && ten.engine.id !== 'x' && !!ten.rev, `F5 the forced one converted again (${JSON.stringify(ten?.engine)})`);
  ok((await songsNow(p)).every((y) => y.k === 'conv'), 'F5 all converted');
  await closeCtx(ctx, 'F5 counts');
}

// F6 / F7: Convert while the queue is paused on an error took the screen wake lock with nothing
// running; an error that can't be tried again halted the batch until Close.
async function fixPaused() {
  console.log('\n--- F6/F7 (iPad): the wake lock while paused; an error that can\'t be tried again');
  const ctx = await context(IPAD, { wake: true });
  const p = await home(ctx);
  const [one, two, three] = await seed(p, ['One', 'Two', 'Three'].map((n) => ({ pdf: true, name: `${n}.pdf`, title: n })));
  ctx.scs = ['err'];
  await openSongs(p);
  await openMenu(p, one);
  await p.click('#row-menu [data-act="convert"]');
  let d = await until(p, (x) => x.import.error && !x.import.running, 15000);
  ok(!!d && /Try again/.test(await text(p, '#tray-bar')), `F6 One stopped, kept: the bar "${await text(p, '#tray-bar')}"`);
  await p.waitForTimeout(300);
  const wl0 = await p.evaluate(() => ({ ...window.__wl }));
  ok(wl0.active === 0, `F6 paused: the wake lock let go (${JSON.stringify(wl0)})`);
  await openMenu(p, two);
  await p.click('#row-menu [data-act="convert"]');
  await openMenu(p, three);
  await p.click('#row-menu [data-act="convert"]');
  await p.waitForTimeout(500);
  const wl1 = await p.evaluate(() => ({ ...window.__wl }));
  ok(wl1.active === 0 && wl1.asks === wl0.asks, `F6 Convert while paused: no wake lock (${JSON.stringify(wl1)})`);
  ok(JSON.stringify((await queueNow(p))?.ids) === JSON.stringify([two, three]) && !(await dbg(p)).import.running, 'F6 queued behind the paused one, nothing runs');
  // Try again → the same stage fails again: not kept → passed by, said; the rest go on
  ctx.scs = ['err'];
  await closeSongs(p);
  await p.click('#imp-mini');
  await p.waitForSelector('#tray-bar [data-act="again"]', { timeout: 5000 });
  await p.click('#tray-bar [data-act="again"]');
  const t = await waitToast(p, /didn't convert/, 20000);
  ok(/“One” didn't convert/.test(t), `F7 said: "${t}"`);
  d = await until(p, (x) => x.import.song?.id === two || x.import.result, 8000);
  ok(!!d && !d.import.error && d.import.song?.id === two && !(await shown(p, '#tray-bar')), `F7 no bar waiting: the next song runs (${JSON.stringify(d?.import.song)})`);
  d = await until(p, (x) => x.import.result && !x.import.running, 40000);
  ok(d?.import.result?.batch === 2, `F7 "2 converted" (${JSON.stringify(d?.import.result)})`);
  const list = await songsNow(p);
  const k = Object.fromEntries(list.map((x) => [x.id, x.k]));
  ok(k[one] === 'pdf' && k[two] === 'conv' && k[three] === 'conv', `F7 One left as it was, the others converted (${JSON.stringify(k)})`);
  ok((await jobsNow(p)) === 0 && (await queueNow(p)) === null, 'F7 no job, no queue left');
  await p.waitForTimeout(300);
  ok((await p.evaluate(() => window.__wl.active)) === 0, 'F7 the wake lock let go at the end');
  await closeCtx(ctx, 'F6/F7 paused');
}

// F8: a tap outside the ⋯ menu also opened the row under it; a re-render (the tray, the sync, a
// library write) closed an armed Delete, so its second tap opened the row beneath.
async function fixMenu() {
  console.log('\n--- F8 (iPad, touch): the ⋯ menu against outside taps and re-renders');
  const ctx = await context(IPAD);
  const p = await home(ctx);
  const [a, b] = await seed(p, [{ pdf: true, name: 'A.pdf', title: 'A' }, { pdf: true, name: 'B.pdf', title: 'B' }]);
  await openSongs(p);
  await openMenu(p, a);
  await p.tap(`#songs-body .song[data-id="${b}"]`);
  await p.waitForTimeout(600);
  let d = await dbg(p);
  ok(!(await shown(p, '#row-menu')) && (await shown(p, '#songs')) && !d.song.open, `F8 a tap on another row closes the menu only (open ${d.song.open})`);
  await p.tap(`#songs-body .songrow[data-id="${a}"] .more`);
  await p.tap('#row-menu [data-act="delete"]');
  // a re-render while armed: a song added (a library write → resonate:data)
  const [c] = await seed(p, [{ pdf: true, name: 'C.pdf', title: 'C' }]);
  await p.waitForTimeout(500);
  ok((await shown(p, '#row-menu')) && /Delete\?/.test(await text(p, '#row-menu [data-act="delete"]')) && !(await p.$(`#songs-body .songrow[data-id="${c}"]`)), 'F8 the armed Delete stays across a re-render (the list waits)');
  await p.tap('#row-menu [data-act="delete"]');
  await until(p, (x) => !x.songs.deleting, 8000);
  await p.waitForTimeout(500);
  d = await dbg(p);
  const ids = (await rows(p)).filter((r) => r.more).map((r) => r.id);
  ok(!d.song.open && !ids.includes(a) && ids.includes(b) && ids.includes(c), `F8 the second tap deleted it — no row opened; the list caught up (${ids.length} rows)`);
  await closeCtx(ctx, 'F8 menu');
}

// F9: a PDF only converted on another device (the sync's resonate:remote replaced) reloaded with notes
// in the Score, but the shell stayed in its PDF-only mode (no Sing; the remote refused Sing's commands).
async function fixReplaced() {
  console.log('\n--- F9 (iPad): a PDF only open here, converted elsewhere');
  const ctx = await context(IPAD);
  const p = await home(ctx);
  const [w] = await seed(p, [{ pdf: true, name: 'Wichita.pdf', title: 'Wichita' }]);
  await openSongs(p);
  await p.click(`#songs-body .song[data-id="${w}"]`);
  let d = await until(p, (x) => x.song.pdfOnly && x.score?.play?.pdfOnly && x.score.play.onScreen, 15000);
  ok(!!d && !(await shown(p, '#mod-sing')), 'F9 open on its PDF, no Sing toggle');
  await p.evaluate(async ({ id, VER }) => { // (the sync's pull: replaceSong quietly, then the event)
    const v = eval(VER);
    const L = await import(`./library.js?v=${v}`);
    const xml = await (await fetch('songs/amazing-grace.musicxml')).text();
    await L.replaceSong(id, xml, { engine: { n: 10, id: 'elsewhere', at: Date.now() }, quiet: true });
    dispatchEvent(new CustomEvent('resonate:remote', { detail: { songs: true, replaced: new Set([id]) } }));
  }, { id: w, VER });
  d = await until(p, (x) => !x.song.pdfOnly && x.score?.play?.ready && !x.score.play.pdfOnly && x.score.play.song === w, 20000);
  ok(!!d, 'F9 the shell out of PDF-only mode, the Score with notes');
  await p.waitForFunction(() => !document.getElementById('mod-sing').hidden, null, { timeout: 8000 }).catch(() => {});
  ok(await shown(p, '#mod-sing'), 'F9 the Sing toggle back');
  d = await dbg(p);
  ok(d.remote?.state?.song?.id === w && !d.remote.state.song.pdf_only, `F9 the device state: no pdf_only (${JSON.stringify(d.remote?.state?.song)})`);
  await closeCtx(ctx, 'F9 replaced');
}

// F10: open_song on a PDF only whose PDF didn't open answered ok "shown in the Score".
async function fixOpenBad() {
  console.log("\n--- F10 (iPhone): the remote's open_song on a PDF only that doesn't open");
  const ctx = await context(IPHONE);
  const p = await home(ctx);
  const garbage = fs.readFileSync(path.join(FX, 'import', 'garbage.pdf')).toString('base64');
  const [bad, gone] = await p.evaluate(async ({ b, pdf, VER }) => {
    const v = eval(VER);
    const L = await import(`./library.js?v=${v}`);
    const bytes = (x) => Uint8Array.from(atob(x), (c) => c.charCodeAt(0)).buffer;
    const bad = await L.addPdfSong(bytes(b), { name: 'Broken.pdf', title: 'Broken' });
    const gone = await L.addPdfSong(bytes(pdf), { name: 'Elsewhere.pdf', title: 'Elsewhere' });
    // (its PDF not on this device: another device's song whose PDF didn't come)
    const S = await import(`./space.js?v=${v}`);
    await new Promise((res, rej) => { const r = indexedDB.open(`${S.dbName()}-files`); r.onerror = rej; r.onsuccess = () => { const tx = r.result.transaction('pdfs', 'readwrite'); tx.objectStore('pdfs').delete(gone); tx.oncomplete = () => { r.result.close(); res(); }; tx.onerror = rej; }; });
    return [bad, gone];
  }, { b: garbage, pdf: PDF_B64, VER });
  let t0 = Date.now();
  let r = await remoteRun(p, 'open_song', { song: 'Broken' });
  ok(r && r.ok === false && r.pdf_only && r.error === "Its PDF didn't open on this device.", `F10 a PDF that doesn't open: ok false, Play's words (${JSON.stringify(r && { ok: r.ok, error: r.error })}, ${Date.now() - t0} ms)`);
  t0 = Date.now();
  r = await remoteRun(p, 'open_song', { song: 'Elsewhere' });
  ok(r && r.ok === false && r.pdf_only && r.error === "This song's PDF isn't on this device.", `F10 no PDF here: ok false, Play's words (${JSON.stringify(r && { ok: r.ok, error: r.error })}, ${Date.now() - t0} ms)`);
  r = await remoteRun(p, 'open_song', { song: 'Broken' });
  ok(r && r.ok === false && r.error === "Its PDF didn't open on this device.", 'F10 asked again: the same answer');
  await closeCtx(ctx, 'F10 open_song');
}

async function fixes() {
  const FIX = process.env.FIX ? new Set(process.env.FIX.split(',')) : null;
  const all = { 1: fixTabs, 2: fixStop, 3: fixGone, 4: fixDoneRow, 5: fixCounts, 6: fixPaused, 8: fixMenu, 9: fixReplaced, 10: fixOpenBad };
  for (const [k, fn] of Object.entries(all)) {
    if (FIX && !FIX.has(k) && !(k === '6' && FIX.has('7'))) continue;
    try { await fn(); } catch (e) { ok(false, `F${k}: ${String(e.message || e).split('\n')[0]}`); }
    for (const c of browser.contexts()) await c.close().catch(() => {});
  }
}

(async () => {
  browser = await chromium.launch();
  for (const [k, fn] of Object.entries({ add, remote, queue, open, convert, fail, look, fixes })) {
    if (!want(k)) continue;
    try { await fn(); } catch (e) { ok(false, `${k}: ${String(e.message || e).split('\n')[0]}`); }
    for (const c of browser.contexts()) await c.close().catch(() => {});
  }
  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
