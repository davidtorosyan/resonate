// The shell preview, step 3: the Score (today's Play, mounted by shell/scoreview.js) inside the page
// next to Sing, at five sizes — iPad 820×1180 / 1180×820, iPhone 393×852 / 393×659 (Safari),
// desktop 1440×900. A fake mic (a sawtooth A3) feeds the tuner; every 30 ms, and at every press on
// the paper, the page checks that the tuner holds no live track while the Score or Sing sounds.
//   node shellscore.cjs            (http://localhost:8097/resonate/, screenshots into SHOTS)
//   ONLY=iphone,ipad-p node shellscore.cjs
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:8097/resonate/';
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/shell3';
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
fs.mkdirSync(SHOTS, { recursive: true });

let passes = 0, fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`); if (c) passes++; else fails++; return c; };

const SIZES = [
  { n: 'ipad-p', w: 820, h: 1180, touch: true, dev: 'tablet', shots: true },
  { n: 'ipad-l', w: 1180, h: 820, touch: true, dev: 'tablet', shots: true, cols: true },
  { n: 'iphone', w: 393, h: 852, touch: true, dev: 'phone', shots: true },
  { n: 'safari', w: 393, h: 659, touch: true, dev: 'phone' },
  { n: 'desktop', w: 1440, h: 900, touch: false, dev: 'desktop', cols: true },
];

// The fake mic + the tuner watch (in the page).
function watch() {
  if (location.protocol === 'about:') return;
  window.__mics = []; window.__viol = []; window.__pressLive = []; window.__pressMon = [];
  let shared = null;
  navigator.mediaDevices.getUserMedia = async () => {
    const tuner = /shell\/tuner\.js/.test(new Error().stack || '');
    if (!shared) {
      const ac = new AudioContext();
      const osc = ac.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 220;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2500;
      const g = ac.createGain(); g.gain.value = 0.25;
      const dest = ac.createMediaStreamDestination();
      osc.connect(lp); lp.connect(g); g.connect(dest); osc.start();
      shared = dest.stream;
    }
    const s = shared.clone();
    window.__mics.push({ stream: s, tuner });
    return s;
  };
  const live = () => window.__mics.some((m) => m.tuner && m.stream.getTracks().some((t) => t.readyState === 'live'));
  setInterval(() => {
    const P = window.resonatePlay?.state?.(), S = window.resonateSing?.state?.();
    if ((P?.busy || P?.held || S?.busy) && live()) window.__viol.push({ t: performance.now(), P: !!(P?.busy || P?.held), S: !!S?.busy });
  }, 30);
  // (bubbling at the window: after play.js's own pointerdown on the paper has struck)
  addEventListener('pointerdown', (e) => {
    if (!e.target.closest?.('#stage')) return;
    window.__pressLive.push(live());
    window.__pressMon.push(window.__mics.some((m) => !m.tuner && m.stream.getTracks().some((t) => t.readyState === 'live'))); // (Sing's 🎤 Pitch)
  });
}

let browser;
async function context(sz, seed = {}) {
  const ctx = await browser.newContext({ viewport: { width: sz.w, height: sz.h }, deviceScaleFactor: 1, ...(sz.touch ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.route('**/*.supabase.co/**', (r) => r.abort());
  await ctx.addInitScript((seed) => {
    try {
      if (location.protocol === 'about:' || sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    } catch {}
  }, seed);
  await ctx.addInitScript(watch);
  ctx.errors = []; ctx.vrv = [];
  ctx.on('page', (p) => {
    p.on('pageerror', (e) => ctx.errors.push(`${p.url().split('/').pop()}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|supabase|Failed to fetch|sync/i.test(m.text())) ctx.errors.push(`${p.url().split('/').pop()}: ${m.text()}`); });
    p.on('request', (r) => { if (/verovio|play\.js/.test(r.url())) ctx.vrv.push(r.url().split('/').pop()); });
  });
  return ctx;
}
const dbg = (p) => p.evaluate(() => {
  const d = window.resonateDebug?.();
  if (!d) return null;
  const pl = d.score?.play, s = window.resonateSing?.debug?.();
  return { song: d.song, tuner: d.tuner, overlay: d.overlay,
    play: pl && { ready: pl.ready, page: pl.page, pages: pl.pages, at: pl.at, W: pl.W, H: pl.H, sp: pl.sp, keys: pl.keys.shown, peeks: pl.peekLog.length, last: pl.peekLog.at(-1) || null,
      pb: pl.playback.state, sched: pl.playback.scheduled.length, audio: pl.audio },
    lgen: d.song?.score?.lgen ?? null,
    sing: s && { session: s.session?.kind || null, title: s.score?.title } };
}).catch(() => null);
async function until(p, pred, ms = 15000) {
  const end = Date.now() + ms;
  let d = null;
  while (Date.now() < end) { d = await dbg(p); try { if (d && pred(d)) return d; } catch {} await p.waitForTimeout(100); }
  return d;
}
const rect = (p, sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom, vis: !!e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' }; }).catch(() => null);
const shown = async (p, sel) => !!(await rect(p, sel))?.vis;
const shot = (p, sz, name) => sz.shots && p.screenshot({ path: `${SHOTS}/${name}-${sz.n}.png` });
// The paper: inside the window, above the keyboard and the dock; no page scroll; the bars' targets ≥ 44.
const paper = (p) => p.evaluate(() => {
  const r = (e) => e && e.getClientRects().length ? e.getBoundingClientRect() : null;
  const st = r(document.getElementById('stage')), kb = r(document.getElementById('dock')), row = r(document.querySelector('.dock .row')), top = r(document.querySelector('.top'));
  const se = document.scrollingElement;
  const small = [...document.querySelectorAll('.top button, .top a, .dock .row button, #score-region #bar button, #score-region #bar select, #score-region .corner button')]
    .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
    .map((e) => ({ e, b: e.getBoundingClientRect() })).filter(({ b }) => b.width && (b.width < 43.5 || b.height < 43.5))
    .map(({ e, b }) => `${e.id || e.className}:${Math.round(b.width)}×${Math.round(b.height)}`);
  return { st: st && [st.left, st.top, st.right, st.bottom], kb: kb && [kb.top, kb.bottom], row: row && row.height ? row.top : null, top: top.bottom,
    scrollH: se.scrollHeight, scrollW: se.scrollWidth, W: innerWidth, H: innerHeight, scrolled: scrollX || scrollY, small };
});
async function checkPaper(p, label) {
  const L = await paper(p);
  const [l, t, r, b] = L.st || [0, 0, 0, 0];
  ok(!!L.st && l >= -0.5 && r <= L.W + 0.5 && t >= L.top - 0.5 && b <= L.H + 0.5, `${label}: the paper inside the window (${Math.round(l)},${Math.round(t)}–${Math.round(r)},${Math.round(b)})`);
  ok(!L.kb || b <= L.kb[0] + 0.5, `${label}: the paper never under the keyboard (${Math.round(b)} ≤ ${L.kb ? Math.round(L.kb[0]) : '—'})`);
  ok(L.row === null || b <= L.row + 0.5 || L.kb && L.kb[1] <= L.row + 0.5, `${label}: the paper / keyboard never under the dock (${L.row === null ? 'no dock' : Math.round(L.row)})`);
  ok(L.scrollH <= L.H && L.scrollW <= L.W && !L.scrolled, `${label}: no page scroll (${L.scrollW}×${L.scrollH} in ${L.W}×${L.H})`);
  ok(!L.small.length, `${label}: touch targets ≥ 44 px${L.small.length ? ': ' + L.small.join(', ') : ''}`);
}
// A press on a note head (held ms): a finger on a touch screen, else the mouse.
async function pressNote(p, sz, k = 3, ms = 220) {
  const pt = await p.evaluate((k) => {
    const hs = [...document.querySelectorAll('#stage g.note > g.notehead')].map((h) => h.getBoundingClientRect()).filter((b) => b.width && b.top > 0 && b.bottom < innerHeight);
    const b = hs[Math.min(k, hs.length - 1)];
    return b && { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, k);
  if (!pt) return false;
  if (sz.touch) {
    const cdp = await p.context().newCDPSession(p);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y, id: 1 }] });
    await p.waitForTimeout(ms);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await p.mouse.move(pt.x, pt.y); await p.mouse.down(); await p.waitForTimeout(ms); await p.mouse.up();
  }
  return true;
}
const playSel = '#play:not(#sing-region #play)'; // (Sing's after-take Play shares the id)
const scorePlay = (p) => p.evaluateHandle(() => [...document.querySelectorAll('#play')].find((b) => !b.closest('#sing-region')));
async function clickScorePlay(p) { const h = await scorePlay(p); try { await h.asElement().click({ timeout: 4000 }); } catch (e) { console.log("CLICK", e.message.slice(0, 2500)); throw e; } }
const stable = async (p, ms = 900) => { await p.waitForTimeout(ms); return dbg(p); };

async function runSize(sz) {
  console.log(`\n=== ${sz.n} ${sz.w}×${sz.h}`);
  const ctx = await context(sz, { 'resonate.sing.song': 'amazing-grace' });
  const p = await ctx.newPage();
  await p.goto(BASE + 'shell.html');
  await p.waitForFunction(() => window.resonateDebug?.().tuner);
  await p.waitForTimeout(400);
  ok(!ctx.vrv.length, `home: neither play.js nor Verovio loaded (${ctx.vrv.join(', ') || 'none'})`);

  // --- the tuner listening at home, then a song from Songs --------------------------------------------
  await p.click('#main-btn');
  let d = await until(p, (x) => x.tuner.note === 57, 6000);
  ok(d?.tuner.state === 'listening', 'home: the tuner listens (A3)');
  await p.click('#songs-btn');
  await p.waitForSelector('#songs-body .song[data-id="amazing-grace"]', { timeout: 4000 });
  await p.click('#songs-body .song[data-id="amazing-grace"]');
  if (sz.dev === 'phone') {
    d = await until(p, (x) => x.song.open && x.song.laid && !x.song.moving && x.sing?.title === 'Amazing Grace', 15000);
    ok(d?.song.mods === 'sing' && d.tuner.form === 'strip', `a phone opens Sing alone (${d?.song.mods}, tuner ${d?.tuner.form})`);
    await p.waitForTimeout(1500);
    ok(!ctx.vrv.length && !d.play, `Sing alone: Verovio not loaded (${ctx.vrv.join(', ') || 'none'})`);
    // (v87: the dock's Sing · Score · Piano beside Songs replace Sing's head Score button and the top bar's Sing · Score)
    ok(await shown(p, '#mod-score') && await shown(p, '#mod-sing') && !(await p.$('#score-btn')) && !(await p.$('#layers')), 'Sing · Score · Piano beside Songs; no Score button in Sing, nothing in the top bar');
    await shot(p, sz, 'sing');
    await p.click('#mod-score'); // (Sing and the Score, stacked)
    await until(p, (x) => x.song.mods === 'both' && !x.song.switching && !x.song.moving, 30000);
    await p.click('#mod-sing'); // (the Score alone)
  }
  d = await until(p, (x) => x.song.open && x.song.laid && !x.song.moving && !x.song.switching && x.play?.ready && x.song.mods === 'score', 30000);
  ok(d?.song.mods === 'score' && d.play?.ready, `the Score alone (${sz.dev === 'phone' ? 'the Score button' : 'the default on a ' + sz.dev}): drawn, ${d?.play?.pages} page(s) at ${d?.play?.sp?.toFixed(2)} px`);
  ok(ctx.vrv.some((u) => /verovio/.test(u)), 'Verovio loaded once the Score shows');
  ok(d?.tuner.form === 'chip' && await p.evaluate(() => !!document.querySelector('#score-region #bar #tuner .tmic')), `the tuner: a mic chip in the Score's bar (${d?.tuner.form})`);
  ok(d?.tuner.state === 'off' && !d.tuner.live, 'the tuner parked when the song opened');
  ok(/Amazing Grace/.test(await p.textContent('#song-pill .t')), 'the song pill names it');
  // (v87: the Score alone puts its ▶ in the dock on every device — ‹ › stay in its bar —, and Songs and the toggles never move: the shell's dock stays under the desk too)
  ok(await p.evaluate(() => !!document.querySelector('.dock .row #play') && !!document.querySelector('#score-region #bar .pager') && !!document.querySelector('.dock .row .corner #songs-btn')) && await shown(p, '#mod-piano'),
    "the dock: ▶ Play · the toggles · Songs (‹ › in the Score's bar)");
  if (sz.dev === 'phone') ok(!d.play.keys && !(await shown(p, '#listen')), 'no keyboard by default on a phone; no Listen');
  else ok(d.play.keys && !(await shown(p, '#score-region #keys')) && await p.$eval('#mod-piano', (e) => e.getAttribute('aria-pressed') === 'true'), "the desk: the keyboard docked — the dock's Piano on, no 🎹 in the Score's bar");
  await p.waitForTimeout(600);
  await checkPaper(p, 'the Score alone');
  await shot(p, sz, sz.dev === 'phone' ? 'phone-score' : 'desk');

  // --- a press sounds, with the tuner's mic given up first ------------------------------------------------
  await p.click('#tuner .tmic');
  d = await until(p, (x) => x.tuner.note === 57, 6000);
  ok(d?.tuner.state === 'listening', "the chip's mic listens (A3)");
  const n0 = d.play.peeks;
  ok(await pressNote(p, sz), 'a note head pressed');
  d = await until(p, (x) => x.play.peeks > n0 && x.play.last?.midis?.length, 4000);
  ok(d?.play.peeks > n0 && d.play.last.midis.length > 0, `the press sounded (peekLog: ${JSON.stringify(d?.play.last?.midis)}, ${d?.play.last?.how})`);
  const pl = await p.evaluate(() => window.__pressLive.slice());
  ok(pl.length && pl.every((x) => !x) && d.tuner.state === 'off' && !d.tuner.live, `the tuner had no live track at the press (${JSON.stringify(pl)}), parked`);

  // --- ▶ plays and ■ stops ------------------------------------------------------------------------------------
  await clickScorePlay(p);
  d = await until(p, (x) => x.play.pb === 'playing' && x.play.sched > 0, 6000);
  ok(d?.play.pb === 'playing' && d.play.sched > 0, `▶ plays (${d?.play.sched} notes struck)`);
  await p.waitForTimeout(300);
  d = await dbg(p);
  ok(d.tuner.hold === 'paused' && !d.tuner.live, `the tuner paused meanwhile ("${d.tuner.word}")`);
  await p.waitForTimeout(900);
  await shot(p, sz, sz.dev === 'phone' ? 'phone-score-playing' : 'desk-playing');
  await clickScorePlay(p);
  d = await until(p, (x) => x.play.pb === 'idle', 3000);
  ok(d?.play.pb === 'idle', '■ stops it');
  d = await until(p, (x) => !x.tuner.hold, 2000);
  ok(!d?.tuner.hold, 'the tuner not paused any more');

  if (sz.dev === 'phone') {
    // --- the phone: the page keys; Sing on (stacked) stops ▶; the Score back keeps its place -------------
    const pg0 = d.play.page;
    await p.keyboard.press('ArrowRight');
    d = await until(p, (x) => x.play.page === pg0 + 1, 2000);
    ok(d?.play.page === pg0 + 1, `→ turns the page (${pg0} → ${d?.play.page} / ${d?.play.pages})`);
    const at = d.play.at;
    await clickScorePlay(p);
    await until(p, (x) => x.play.pb === 'playing', 4000);
    // (v87: the dock's Sing — Sing joins the Score, stacked; v86's Score-bar Sing button switched to Sing alone)
    await p.click('#mod-sing');
    d = await until(p, (x) => x.song.mods === 'both' && !x.song.state.busy && !x.song.switching && !x.song.moving, 8000);
    const sr = await rect(p, '#sing-region'), cr = await rect(p, '#score-region');
    ok(d?.song.mods === 'both' && d.play.pb === 'idle' && sr?.vis && cr?.vis && sr.b <= cr.y + 0.5, `Sing on: Sing above the Score (${Math.round(sr?.h)} / ${Math.round(cr?.h)} px), ▶ stopped first`);
    await p.click('#mod-score');
    d = await until(p, (x) => x.song.mods === 'sing' && !x.song.switching && !x.song.moving, 8000);
    ok(d?.song.mods === 'sing' && !(await shown(p, '#score-region')) && d.tuner.form === 'strip' && await shown(p, '#listen'), 'the Score off: Sing alone, the strip and Sing\'s dock');
    const pgS = d.play.page; // (laid out stacked meanwhile: the place's page there)
    await p.keyboard.press('ArrowLeft');
    await p.waitForTimeout(300);
    d = await dbg(p);
    ok(d.play.page === pgS, `← with the Score hidden: no turn (page ${d.play.page})`);
    await p.click('#mod-sing'); // (none: the full tuner, the song still open)
    d = await until(p, (x) => x.song.mods === 'none' && !x.song.switching && !x.song.moving, 8000);
    ok(d?.song.mods === 'none' && d.tuner.form === 'full' && await shown(p, '#song-pill') && await shown(p, '#main-btn'), 'Sing off too: the full tuner, Start, the song\'s pill');
    const lg = d.lgen;
    await p.click('#mod-score');
    d = await until(p, (x) => x.song.mods === 'score' && x.play.ready && !x.song.switching && !x.song.moving, 8000);
    d = await stable(p);
    ok(d.play.at === at && d.play.page === pg0 + 1 && d.lgen <= lg + 1, `the Score back: the place kept (bar ${d.play.at}, page ${d.play.page}), laid out at most once (${lg} → ${d.lgen})`);
    await p.keyboard.press('ArrowLeft');
    d = await until(p, (x) => x.play.page === pg0, 2000);
    ok(d?.play.page === pg0, '← turns back with the Score shown');
  } else {
    // --- a tablet / desktop: Sing · Score — both, the cross-stops, the keys, and back ---------------------
    const at0 = d.play.at, lg0 = d.lgen;
    await p.click('#mod-sing');
    d = await until(p, (x) => x.song.mods === 'both' && !x.song.switching && !x.song.moving && x.sing?.title === 'Amazing Grace' && x.play.ready, 15000);
    d = await stable(p, 1200);
    ok(d.song.mods === 'both' && await shown(p, '#sing-region') && await shown(p, '#score-region'), 'Sing on: Sing and the Score');
    ok(d.lgen === lg0 + 1 && d.play.at === at0, `laid out once (${lg0} → ${d.lgen}), the place kept (bar ${d.play.at})`);
    ok(d.tuner.form === 'strip' && await p.evaluate(() => document.getElementById('tuner').parentNode.classList.contains('top')), 'the tuner: a strip in the top bar');
    const sr = await rect(p, '#sing-region'), cr = await rect(p, '#score-region');
    if (sz.cols) ok(sr.r <= cr.x + 0.5 && Math.abs(sr.y - cr.y) < 2 && sr.w >= 400 && sr.w <= 440, `two columns: Sing ${Math.round(sr.w)} px left, the Score ${Math.round(cr.w)} px right`);
    else ok(sr.b <= cr.y + 0.5 && Math.abs(sr.w - cr.w) < 2 * 20 + 2, `Sing (${Math.round(sr.h)} px) above the Score (${Math.round(cr.h)} px)`);
    ok(await shown(p, '#listen') && await shown(p, '.dock #sing') && await p.evaluate(() => !!document.querySelector('.dock .row #songs-btn')), "the dock is Sing's: Listen · the primary · Songs");
    await checkPaper(p, 'Sing + Score');
    await shot(p, sz, 'sing-score');
    // the page keys: the Score's while it shows
    if (d.play.pages > 1) {
      await p.keyboard.press('ArrowRight');
      d = await until(p, (x) => x.play.page === 2, 2000);
      ok(d?.play.page === 2, `→ turns the Score's page (2 / ${d?.play.pages})`);
    }
    // Sing's Listen stops the Score's ▶, and the Score's ▶ stops Sing's Listen
    await clickScorePlay(p);
    d = await until(p, (x) => x.play.pb === 'playing', 5000);
    await p.waitForTimeout(400);
    await p.click('#listen');
    d = await until(p, (x) => x.sing?.session === 'listen' && x.play.pb === 'idle', 6000);
    ok(d?.sing?.session === 'listen' && d.play.pb === 'idle', "Sing's Listen stopped the Score's ▶");
    await p.waitForTimeout(500);
    await clickScorePlay(p);
    d = await until(p, (x) => x.play.pb === 'playing' && !x.sing?.session, 6000);
    ok(d?.play.pb === 'playing' && !d.sing?.session, "the Score's ▶ stopped Sing's Listen");
    // the Score off (Sing alone): ▶ stops, the keys aren't the Score's
    await p.click('#mod-score');
    d = await until(p, (x) => x.song.mods === 'sing' && !x.song.state.busy && !x.song.switching && !x.song.moving, 5000);
    ok(d?.song.mods === 'sing' && d.play.pb === 'idle' && !(await shown(p, '#score-region')) && d.tuner.form === 'docked', `the Score off: Sing alone, ▶ stopped first, the tuner docked (${d?.tuner.form})`);
    const pgS = d.play.page;
    await p.keyboard.press(pgS > 1 ? 'ArrowLeft' : 'ArrowRight');
    await p.waitForTimeout(300);
    d = await dbg(p);
    ok(d.play.page === pgS, `a page key with the Score hidden: no turn (page ${d.play.page})`);
    await p.click('#mod-score');
    d = await until(p, (x) => x.song.mods === 'both' && x.play.ready && !x.song.switching && !x.song.moving, 6000);
    d = await stable(p);
    ok(d.play.page === pgS, `the Score back: the same page (${d.play.page})`);
    // (v87 review) Sing's 🎤 Pitch on: a press on the Score closes its mic first (iOS plays quietly
    // while the page has the mic open), ▶ keeps it closed, and it listens again once they're quiet
    if (sz.n === 'desktop') {
      const monOn = () => p.waitForFunction(() => window.resonateSing?.debug?.()?.monitor?.listening, null, { timeout: 6000, polling: 100 }).then(() => true, () => false);
      await p.evaluate(() => document.getElementById('monitor').click());
      ok(await monOn(), "🎤 Pitch listens (Sing · Score)");
      await p.evaluate(() => { window.__pressMon = []; });
      await pressNote(p, sz, 2, 300);
      const pm = await p.evaluate(() => window.__pressMon.slice());
      ok(pm.length && pm.every((x) => !x), `a press on the Score: Sing's 🎤 Pitch mic closed first (${JSON.stringify(pm)})`);
      ok(await monOn(), '…and listening again after the lift');
      await clickScorePlay(p);
      await until(p, (x) => x.play.pb === 'playing', 5000);
      await p.waitForTimeout(800);
      const during = await p.evaluate(() => !!window.resonateSing.debug().monitor?.listening);
      await clickScorePlay(p);
      await until(p, (x) => x.play.pb === 'idle', 3000);
      ok(!during && await monOn(), `▶: closed while it plays (listening ${during}), listening again after ■`);
      await p.evaluate(() => document.getElementById('monitor').click());
      ok(await p.evaluate(() => !window.resonateSing.debug().monitor), '🎤 Pitch off');
    }
    // Sing off again: the desk, laid out once, the place kept
    const lg1 = d.lgen, at1 = d.play.at;
    await p.click('#mod-sing');
    d = await until(p, (x) => x.song.mods === 'score' && !x.song.switching && !x.song.moving, 5000);
    d = await stable(p, 1200);
    ok(d.lgen === lg1 + 1 && d.play.at === at1 && d.tuner.form === 'chip', `Sing off: the desk again, laid out once (${lg1} → ${d.lgen}), bar ${d.play.at} kept`);
    ok(await p.evaluate(() => (JSON.parse(localStorage.getItem('resonate.shell.modules') || '{}')[document.getElementById('app').dataset.dev] || []).join(',') === 'score,piano'), 'the choice kept for this device class (v87: a set — score, piano)');
  }

  // --- ◎ home stops everything ------------------------------------------------------------------------------
  await clickScorePlay(p);
  d = await until(p, (x) => x.play.pb === 'playing', 5000);
  ok(d?.play.pb === 'playing', '▶ again before going home');
  await p.click('#brand');
  d = await until(p, (x) => !x.song.open && !x.song.moving && !x.song.closing, 5000);
  ok(!d?.song.open && d.play.pb === 'idle' && !d.sing?.session && !d.song.state?.busy, '◎ home: the song closed, nothing playing');
  ok(d?.tuner.form === 'full' && await shown(p, '.gauge') && await shown(p, '#main-btn') && !(await shown(p, '#score-region')) && await p.evaluate(() => !!document.querySelector('.dock .row .corner #songs-btn')), 'the full tuner, Start and Songs back in the dock');
  if (sz.dev === 'phone') ok(await p.evaluate(() => !!document.querySelector('#score-region #bar .pager') && !!document.querySelector('#score-region #bar #play')), "the Score's ‹ › and ▶ back in its bar");
  const L = await paper(p);
  ok(L.scrollH <= L.H && L.scrollW <= L.W, 'home: no page scroll');
  // (and a song opened again comes back the same way)
  await p.click('#songs-btn');
  await p.click('#songs-body .song[data-id="amazing-grace"]');
  d = await until(p, (x) => x.song.open && x.song.laid && !x.song.moving && x.play?.ready && x.song.mods === 'score', 10000);
  ok(d?.song.mods === 'score' && d.tuner.form === 'chip', `opened again: the Score (${d?.song.mods}) — the choice remembered`);
  await p.goBack();
  d = await until(p, (x) => !x.song.open, 5000);
  ok(!d?.song.open, 'Back closes the song');

  const viol = await p.evaluate(() => window.__viol.length);
  ok(!viol, `the tuner never had a live track while the Score or Sing sounded (${viol} samples)`);
  ok(!ctx.errors.length, `no console errors${ctx.errors.length ? ': ' + ctx.errors.slice(0, 4).join(' | ') : ''}`);
  await ctx.close();
}

(async () => {
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
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
