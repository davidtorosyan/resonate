// The owner's jank list (docs/ROADMAP.md "Work queue"), the Score's part, in the one-page shell:
//   A2  the song's title is a label: a tap on it doesn't open Songs (Songs, bottom right, is the one way)
//   A3  the Piano turned on (and off) under the Score keeps what's shown: the same page, the same first
//       and last bars, the music drawn smaller (play.js S.hold) — and off again, the layout as it was;
//       a page turn under the hold turns the held pages; − / +, a view, Sing coming lay out for the
//       stage (the hold let go); from the Piano on at the start, off then on: what's shown kept too.
//       (Before: in portrait the place's page began 8 bars earlier — bars 26–37 → 18–29 —, in
//       landscape the size went with the height and bars 11–14 became 7–12.) iPad portrait and
//       landscape, iPhone.
//   A4  one ▶: a stretch picked, its controls are ⟳ · speed · ✕ (no second ▶ / ■) and the main ▶ —
//       the dock's, the Score alone — plays the stretch; ■ there stops it.
//   A5  (tools/shellmods.cjs `linked`: one keyboard, the Score's keys on it) — here the shots.
// The multi-page song is tools/fixtures/play/score-pvg.musicxml (synthetic voice + piano + guitar).
//   node -r ./harness/noshots.cjs jank.cjs    (BASE=http://localhost:8097/resonate/; SHOTS=<dir> keeps the shots)
//   ONLY=ipad-p,iphone node jank.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:8097/resonate/';
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user-resonate/ff8222dc-0c50-507b-b424-c024937f0d1b/scratchpad/jank';
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const XML = fs.readFileSync(path.join(__dirname, 'fixtures/play/score-pvg.musicxml'), 'utf8');
fs.mkdirSync(SHOTS, { recursive: true });

let passes = 0, fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`); if (c) passes++; else fails++; return c; };
const sleep = (t) => new Promise((r) => setTimeout(r, t));

const SIZES = [
  { n: 'ipad-p', w: 820, h: 1180, touch: true, dev: 'tablet', turns: 2 },
  { n: 'ipad-l', w: 1180, h: 820, touch: true, dev: 'tablet', turns: 2 },
  { n: 'iphone', w: 393, h: 852, touch: true, dev: 'phone', turns: 3 },
];

let browser;
async function context(sz, seed) {
  const ctx = await browser.newContext({ viewport: { width: sz.w, height: sz.h }, deviceScaleFactor: 1, ...(sz.touch ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.route('**/*.supabase.co/**', (r) => r.abort());
  await ctx.addInitScript((seed) => {
    try {
      if (location.protocol === 'about:' || sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    } catch {}
  }, seed);
  ctx.errors = [];
  ctx.on('page', (p) => {
    p.on('pageerror', (e) => ctx.errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|supabase|Failed to fetch|sync/i.test(m.text())) ctx.errors.push(m.text()); });
  });
  return ctx;
}
const IDLE = `() => { const d = window.resonateDebug?.().song; return d && !d.moving && !d.switching; }`;
const waitFn = (p, src, ms = 20000) => p.waitForFunction(`(${src})()`, null, { timeout: ms, polling: 100 }).then(() => true, () => false);
// What the Score shows: its page, the first and last bar drawn, the size, the layout's generation, the hold.
const view = (p) => p.evaluate(() => {
  const s = window.resonatePlay.state(), d = window.resonateDebug().score.play;
  const ms = [...document.querySelectorAll('#stage .page g.measure')].map((g) => Number(/^m(\d+)$/.exec(g.id)?.[1])).filter(Number.isInteger);
  const st = document.getElementById('stage').getBoundingClientRect(), svg = document.querySelector('#stage .page svg')?.getBoundingClientRect();
  return { page: s.page, pages: s.pages, at: s.at, first: ms[0], last: ms.at(-1), sp: Math.round(s.sp * 100) / 100, H: s.H, lgen: s.lgen, mode: s.mode,
    hold: d.hold, stageH: Math.round(st.height), svg: svg && [Math.round(svg.left), Math.round(svg.top), Math.round(svg.right), Math.round(svg.bottom)], stageB: Math.round(st.bottom), stageR: Math.round(st.right) };
});
const toggle = async (p, k) => { await p.click(`#mod-${k}`); await waitFn(p, IDLE); await sleep(500); };
const shot = (p, name) => p.screenshot({ path: `${SHOTS}/score-${name}.png` });
const inside = (v) => v.svg && v.svg[2] <= v.stageR + 0.5 && v.svg[3] <= v.stageB + 0.5;

async function a3(sz) {
  console.log(`\n=== A3 ${sz.n} ${sz.w}×${sz.h}`);
  const ctx = await context(sz, { 'resonate.shell.modules': JSON.stringify({ [sz.dev]: ['score'] }) });
  const p = await ctx.newPage();
  await p.goto(BASE + 'index.html');
  await p.waitForFunction(() => window.resonateDebug?.().tuner);
  const id = await p.evaluate(async (xml) => (await import(`./library.js?v=${document.getElementById('version').textContent.trim().replace(/^v/, '')}`)).addSong('PVG', xml), XML);
  await p.evaluate((id) => import(`./shell/songlist.js?v=${document.getElementById('version').textContent.trim().replace(/^v/, '')}`).then((m) => m.openSong(id)), id);
  await p.waitForFunction(() => window.resonatePlay?.state?.().ready, null, { timeout: 30000 });
  await waitFn(p, IDLE);
  await p.selectOption('#hands', 'score');
  await p.waitForFunction(() => window.resonatePlay.state().ready && window.resonateDebug().score.play.view === 'score', null, { timeout: 30000 });
  await sleep(600);
  for (let i = 0; i < sz.turns; i++) { await p.click('#next'); await sleep(250); }
  const v0 = await view(p);
  ok(v0.page === sz.turns + 1 && v0.first === v0.at, `${sz.n}: on page ${v0.page}/${v0.pages}, bars ${v0.first}–${v0.last} (the place: ${v0.at})`);
  await shot(p, `a3-${sz.n}-1-before`);

  // --- the Piano on: the same page, the same bars, smaller ----------------------------------------
  await toggle(p, 'piano');
  const v1 = await view(p);
  ok(v1.page === v0.page && v1.pages === v0.pages && v1.first === v0.first && v1.last === v0.last,
    `${sz.n}: Piano on — the same page (${v1.page}/${v1.pages}) and bars (${v1.first}–${v1.last}; were ${v0.first}–${v0.last})`);
  ok(v1.stageH < v0.stageH && v1.sp < v0.sp && v1.mode === 'held' && v1.hold, `${sz.n}: the Score shorter (${v0.stageH} → ${v1.stageH} px), the music smaller (${v0.sp} → ${v1.sp} px a staff space), held`);
  ok(inside(v1), `${sz.n}: the page inside the shorter stage (${JSON.stringify(v1.svg)} in ${v1.stageR}×${v1.stageB})`);
  ok(v1.lgen === v0.lgen + 1, `${sz.n}: laid out once (${v0.lgen} → ${v1.lgen})`);
  await shot(p, `a3-${sz.n}-2-piano-on`);

  // --- off again: the layout as it was ------------------------------------------------------------
  await toggle(p, 'piano');
  const v2 = await view(p);
  ok(v2.page === v0.page && v2.first === v0.first && v2.last === v0.last && v2.sp === v0.sp && !v2.hold && v2.mode !== 'held',
    `${sz.n}: Piano off — as it was (page ${v2.page}, bars ${v2.first}–${v2.last}, ${v2.sp} px, no hold)`);

  // --- on, then a page turn: the held pages; then − : laid out for the stage -----------------------
  await toggle(p, 'piano');
  await p.click('#next'); await sleep(300);
  let v = await view(p);
  ok(v.page === v0.page + 1 && v.pages === v0.pages && v.hold && v.first > v0.last, `${sz.n}: a turn under the hold — the held layout's next page (${v.page}/${v.pages}, bars ${v.first}–${v.last})`);
  await p.click('#prev'); await sleep(300);
  if (await p.isEnabled('#smaller')) {
    await p.click('#smaller'); await sleep(700);
    v = await view(p);
    ok(!v.hold && v.mode !== 'held' && v.first <= v.at && v.at <= v.last, `${sz.n}: − lays out for the stage (${v.mode}, ${v.sp} px), the place still shown (${v.at} in ${v.first}–${v.last})`);
    await p.click('#bigger'); await sleep(700);
  }

  // --- the Piano on at the start (a fresh layout for the shorter stage): off and on keep what's shown too
  await p.reload();
  await p.waitForFunction(() => window.resonateDebug?.().tuner);
  await p.evaluate((id) => import(`./shell/songlist.js?v=${document.getElementById('version').textContent.trim().replace(/^v/, '')}`).then((m) => m.openSong(id)), id);
  await p.waitForFunction(() => window.resonatePlay?.state?.().ready, null, { timeout: 30000 });
  await waitFn(p, IDLE);
  await sleep(600);
  const w0 = await view(p);
  ok(!w0.hold && w0.mode !== 'held', `${sz.n}: reload with the Piano on — laid out for the stage (${w0.mode}, ${w0.sp} px), page ${w0.page}, bars ${w0.first}–${w0.last}`);
  await toggle(p, 'piano');
  const w1 = await view(p);
  ok(!w1.hold && w1.first <= w0.at && w0.at <= w1.last, `${sz.n}: Piano off (a taller stage) — laid out for it, the place shown (${w0.at} in ${w1.first}–${w1.last})`);
  await toggle(p, 'piano');
  const w2 = await view(p);
  ok(w2.hold && w2.page === w1.page && w2.first === w1.first && w2.last === w1.last, `${sz.n}: on again — what was shown kept (${w2.first}–${w2.last})`);

  // --- Sing coming lays out for its smaller region (the hold let go) --------------------------------
  await toggle(p, 'sing');
  await waitFn(p, `() => window.resonatePlay.state().ready`);
  await sleep(600);
  v = await view(p);
  ok(!v.hold && v.mode !== 'held' && v.first <= v.at && v.at <= v.last, `${sz.n}: Sing on — laid out for the Score's region (${v.mode}), the place shown (${v.at} in ${v.first}–${v.last})`);
  await shot(p, `a3-${sz.n}-3-sing`);
  // (beside Sing too: the Piano off, then on — what was shown kept)
  await toggle(p, 'piano');
  const x0 = await view(p);
  await toggle(p, 'piano');
  const x1 = await view(p);
  ok(x1.hold && x1.page === x0.page && x1.first === x0.first && x1.last === x0.last && inside(x1), `${sz.n}: with Sing, the Piano off then on — the same page and bars (${x0.first}–${x0.last} → ${x1.first}–${x1.last})`);
  ok(!ctx.errors.length, `${sz.n}: no console errors${ctx.errors.length ? ': ' + ctx.errors.slice(0, 3).join(' | ') : ''}`);
  await ctx.close();
}

// A2 + A4 (+ shots of A5): Amazing Grace, the Score with the Piano.
async function onePlay(sz) {
  console.log(`\n=== A2 · A4 ${sz.n} ${sz.w}×${sz.h}`);
  const ctx = await context(sz, { 'resonate.sing.song': 'amazing-grace', 'resonate.shell.modules': JSON.stringify({ [sz.dev]: ['score', 'piano'] }) });
  const p = await ctx.newPage();
  await p.goto(BASE + 'index.html');
  await p.waitForFunction(() => window.resonateDebug?.().tuner);
  await p.click('#songs-btn');
  await p.waitForSelector('#songs-body .song[data-id="amazing-grace"]', { timeout: 5000 });
  await p.click('#songs-body .song[data-id="amazing-grace"]');
  await p.waitForFunction(() => window.resonatePlay?.state?.().ready, null, { timeout: 30000 });
  await waitFn(p, IDLE);
  await sleep(600);

  // A2: the title is a label
  await p.evaluate(() => document.getElementById('song-title').click());
  await p.click('#song-title', { force: true });
  await sleep(500);
  ok(await p.evaluate(() => document.getElementById('songs').hidden), 'A2: a tap on the song title opens nothing (Songs stays closed)');

  // A4: a stretch — one ▶
  const g = await p.evaluate(() => window.resonateDebug().score.play.playback.geo());
  const pg = g[0], s0 = pg.systems[0];
  const pt = (i) => [pg.rect[0] + (s0.cols[i][1] + s0.cols[i][2]) / 2, pg.rect[1] + (s0.top + s0.bottom) / 2];
  const a = pt(1), b = pt(Math.min(s0.cols.length - 1, 7));
  const cdp = await ctx.newCDPSession(p);
  const t = (type, q) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: q ? [{ x: q[0], y: q[1], id: 1 }] : [] });
  await t('touchStart', a);
  for (let i = 1; i <= 10; i++) { await t('touchMove', [a[0] + ((b[0] - a[0]) * i) / 10, a[1]]); await sleep(16); }
  await sleep(150);
  await t('touchEnd');
  await cdp.detach();
  await sleep(400);
  const sb = await p.evaluate(() => {
    const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
    const bar = document.getElementById('selbar');
    const plays = [...document.querySelectorAll('button')].filter((x) => vis(x) && /^(Play|Stop)$/.test(x.getAttribute('aria-label') || '') && !x.closest('#sing-region'));
    return { shown: vis(bar), loop: vis(document.getElementById('sel-loop')), speed: vis(document.getElementById('speed')), clear: vis(document.getElementById('sel-clear')),
      inBar: [...bar.querySelectorAll('button')].filter(vis).map((x) => x.id || x.dataset.key), plays: plays.map((x) => x.closest('.dock') ? 'dock' : x.closest('#bar') ? 'bar' : 'other') };
  });
  const span = (await p.evaluate(() => window.resonateDebug().score.play.playback.span));
  ok(span && sb.shown && sb.loop && sb.speed && sb.clear && !sb.inBar.includes('sel-play'), `A4: a stretch picked — its controls ⟳ · speed · ✕ (${sb.inBar.join(' ')})`);
  ok(sb.plays.length === 1 && sb.plays[0] === 'dock', `A4: one ▶ on screen — the dock's (${sb.plays.join(', ')})`);
  await shot(p, `a4-${sz.n}-stretch`);
  await p.click('.dock .row #play');
  ok(await waitFn(p, `() => { const x = window.resonateDebug().score.play.playback; return x.state === 'playing' && x.kind === 'span'; }`, 8000), 'A4: the main ▶ plays the stretch');
  const during = await p.evaluate(() => [...document.querySelectorAll('button')].filter((x) => x.getClientRects().length && /^(Play|Stop)$/.test(x.getAttribute('aria-label') || '') && !x.closest('#sing-region')).map((x) => x.getAttribute('aria-label')));
  ok(during.length === 1 && during[0] === 'Stop', `A4: while it plays, one ■ (${during.join(', ')})`);
  await shot(p, `a4-${sz.n}-playing`);
  await p.click('.dock .row #play');
  ok(await waitFn(p, `() => window.resonateDebug().score.play.playback.state === 'idle'`, 5000), 'A4: ■ stops it');
  await p.tap('#sel-loop');
  ok(await waitFn(p, `() => window.resonateDebug().score.play.playback.state === 'looping'`, 8000), 'A4: ⟳ loops the stretch');
  await p.click('.dock .row #play');
  ok(await waitFn(p, `() => window.resonateDebug().score.play.playback.state === 'idle'`, 5000), 'A4: the main ■ stops the loop');
  await p.tap('#sel-clear');
  await sleep(300);
  ok(!(await p.evaluate(() => window.resonateDebug().score.play.playback.span)), 'A4: ✕ lets go of the stretch');

  // A5 shots: the Piano alone at home, then the Score coming over it
  await p.click('#mod-score'); await waitFn(p, IDLE); await sleep(500);
  await shot(p, `a5-${sz.n}-1-piano`);
  await p.click('#mod-score'); await waitFn(p, IDLE);
  await p.waitForFunction(() => window.resonatePlay.state().ready);
  await sleep(500);
  await shot(p, `a5-${sz.n}-2-score-piano`);
  ok(!ctx.errors.length, `${sz.n}: no console errors${ctx.errors.length ? ': ' + ctx.errors.slice(0, 3).join(' | ') : ''}`);
  await ctx.close();
}

(async () => {
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const runs = [...SIZES.map((sz) => [sz.n, () => a3(sz)]), ...SIZES.filter((sz) => sz.n !== 'ipad-l').map((sz) => [`play-${sz.n}`, () => onePlay(sz)])];
  for (const [n, fn] of runs) {
    if (ONLY && !ONLY.has(n) && !ONLY.has(n.replace(/^play-/, ''))) continue;
    const before = fails;
    try { await fn(); } catch (e) { ok(false, `${n}: ${e.message.split('\n')[0]}`); }
    for (const c of browser.contexts()) await c.close().catch(() => {});
    if (fails === before) console.log(`(${n}: all passed)`);
  }
  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
