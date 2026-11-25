// Play: one bar at a time (the owner: "I see measures 12, 13, 14 … it would be nice if I could see
// measure 15 and on"). A held ‹ › (or Shift + ← →) moves the page by one bar — the song laid out from
// that bar to its end (Verovio's selection), so the page starts there.
//
//   H  play.html, a phone (Amazing Grace, Both): a hold on › → the page starts a bar later (from,
//      the first bar shown), page 1, "b.N" flashed, no page turned by the hold's click; held longer
//      → a bar each ~0.45 s; Shift + → / ← a bar; a tap on › turns a page of that layout; ‹ back to
//      its first page, then ‹ again → the whole song at the page holding the bar before; a bar
//      back to the first bar → the whole song; − / + keep the start; another view → the whole song
//   S  the shell's Score (an iPad): a hold on › moves a bar
//
// usage: node playbar.cjs   (BASE=…, ONLY=H,S)
const { chromium } = require('playwright');
const { ok, done, fail } = require('./lib/check.cjs');
const { BASE } = require('./lib/paths.cjs');
const SH = require('./lib/shell.cjs');
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const run = (s) => !ONLY || ONLY.has(s);
const sleep = (t) => new Promise((r) => setTimeout(r, t));

const P = (page) => page.evaluate(() => { const d = window.resonateDebug().play; return { page: d.page, pages: d.pages, from: d.from, first: d.firstShown, at: d.at, view: d.view, ready: d.ready, step: d.step, pg: document.getElementById('pg').textContent }; });
const ready = (page) => page.waitForFunction(() => window.resonateDebug?.().play?.ready, null, { timeout: 120000 });
async function hold(page, sel, ms) {
  const b = await page.$(sel);
  const r = await b.boundingBox();
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.down();
  await sleep(ms);
  await page.mouse.up();
  await sleep(150);
}
const key = (page, k, shift = false) => page.evaluate(([k, shift]) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true })), [k, shift]);

async function main() {
  const browser = await chromium.launch();
  const errors = [];
  if (run('H')) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => { try { if (!navigator.audioSession) Object.defineProperty(navigator, 'audioSession', { configurable: true, value: { type: 'auto' } }); } catch {} });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + 'play.html');
    await ready(page);
    if ((await P(page)).view !== 'both') { await page.selectOption('#hands', 'both'); await sleep(300); await ready(page); }
    const s0 = await P(page);
    ok(s0.from === null && s0.page === 1 && s0.pages > 1, `H the whole song, page 1 of ${s0.pages} (first bar ${s0.first})`);
    await hold(page, '#next', 650);
    const s1 = await P(page);
    ok(s1.from != null && s1.from > s0.first && s1.first === s1.from && s1.page === 1, `H a hold on › starts the page a bar on (from ${s1.from}, first shown ${s1.first}, page ${s1.page})`);
    ok(/^b\.\d+$/.test(s1.pg), `H the bar flashed in place of the page number ("${s1.pg}")`);
    await sleep(1400);
    ok(/^\d+ \/ \d+$/.test((await P(page)).pg), 'H the page number back after the flash');
    await hold(page, '#next', 1600);
    const s2 = await P(page);
    ok(s2.from >= s1.from + 2 && s2.first === s2.from, `H held longer: a bar every ~0.45 s (from ${s1.from} → ${s2.from})`);
    await key(page, 'ArrowRight', true); await sleep(200);
    const s3 = await P(page);
    ok(s3.from > s2.from && s3.page === 1, `H Shift + → a bar (from ${s2.from} → ${s3.from})`);
    await key(page, 'ArrowLeft', true); await sleep(200);
    ok((await P(page)).from === s2.from, 'H Shift + ← a bar back');
    // − / + keep the start
    await page.click('#bigger'); await sleep(300);
    const z = await P(page);
    ok(z.from === s2.from && z.first === s2.from && z.step === 1, `H + keeps the page's start (from ${z.from}, first ${z.first})`);
    await page.click('#smaller'); await sleep(300);
    // a tap turns a page of that layout
    const before = await P(page);
    await page.click('#next'); await sleep(250);
    const t1 = await P(page);
    ok(t1.from === before.from && t1.page === 2 && t1.first > before.from, `H a tap on › turns a page (page ${t1.page}, first ${t1.first})`);
    await page.click('#prev'); await sleep(250);
    const t2 = await P(page);
    ok(t2.page === 1 && t2.from === before.from && t2.first === before.from, 'H ‹ back to the start bar\'s page');
    ok(!(await page.$eval('#prev', (b) => b.disabled)), 'H ‹ enabled on the first page of a bar start');
    await page.click('#prev'); await sleep(300);
    const t3 = await P(page);
    ok(t3.from === null && t3.first < before.from, `H ‹ again → the whole song at the page holding the bar before (first ${t3.first}, page ${t3.page})`);
    // back to the first bar → the whole song
    await key(page, 'ArrowRight', true); await sleep(200);
    const f1 = await P(page);
    await page.evaluate(() => { for (let i = 0; i < 40; i++) window.resonateDebug().play.stepBar(-1); });
    await sleep(200);
    const f2 = await P(page);
    ok(f1.from != null && f2.from === null && f2.page === 1, `H bars back to the first → the whole song, page 1 (from ${f1.from} → ${f2.from})`);
    // another view: the whole song
    await key(page, 'ArrowRight', true); await key(page, 'ArrowRight', true); await sleep(200);
    const v0 = await P(page);
    await page.selectOption('#hands', 'rh'); await sleep(300); await ready(page);
    const v1 = await P(page);
    ok(v0.from != null && v1.from === null && v1.view === 'rh', `H another view lays out the whole song (from ${v0.from} → ${v1.from})`);
    await ctx.close();
  }
  if (run('S')) {
    const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    await SH.seedShell(ctx, { song: 'amazing-grace' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await SH.openScore(page);
    await sleep(500);
    for (let i = 0; i < 4 && (await P(page)).pages < 2; i++) { await page.click('#bigger'); await sleep(400); } // (Amazing Grace fits one iPad page: zoomed in)
    const a = await P(page);
    ok(a.pages > 1, `S zoomed in to ${a.pages} pages`);
    const b = await page.$('#next'); const r = await b.boundingBox();
    const cdp = await ctx.newCDPSession(page);
    const t = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: r.x + r.width / 2, y: r.y + r.height / 2, id: 1 }] });
    await t('touchStart'); await sleep(700); await t('touchEnd'); await sleep(300);
    const c = await P(page);
    ok(c.from != null && c.from > a.first && c.page === 1 && c.first === c.from, `S the shell's Score: a held › starts the page a bar on (from ${c.from})`);
    await ctx.close();
  }
  ok(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
  done();
}
main().catch(fail);
