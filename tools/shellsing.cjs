// The shell preview, step 2: Sing inside the page (index.html + shell/singview.js) at five sizes —
// iPhone 393×852, iPhone Safari 393×659, iPad 820×1180 / 1180×820, desktop 1440×900. A simulated
// singer (a sawtooth through a fake getUserMedia, as guided.cjs) sings the take's notes, and plays
// an A3 between takes so the tuner has something to hear. Every 50 ms the page checks that the
// tuner never holds a live track while Sing plays, records or runs a step.
//   node shellsing.cjs            (http://localhost:8097/resonate/, screenshots into SHOTS)
//   ONLY=iphone,ipad-p node shellsing.cjs
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:8097/resonate/';
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/shell2';
const FX = '/home/user/tools/fixtures';
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
fs.mkdirSync(SHOTS, { recursive: true });

let passes = 0, fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`); if (c) passes++; else fails++; return c; };

const SIZES = [
  { n: 'iphone', w: 393, h: 852, touch: true, form: 'strip', shots: true },
  { n: 'safari', w: 393, h: 659, touch: true, form: 'strip' },
  { n: 'ipad-p', w: 820, h: 1180, touch: true, form: 'docked', shots: true },
  { n: 'ipad-l', w: 1180, h: 820, touch: true, form: 'docked', shots: true },
  { n: 'desktop', w: 1440, h: 900, touch: false, form: 'docked' },
];
const PROFILE = { active: 'p1', list: [{ id: 'p1', name: 'Dave', vol: { floor: -50, ceiling: -10 }, range: { low: 45, high: 67, comfortLow: 48, comfortHigh: 64, at: 1 } }] };

// The simulated singer + the tuner watch (in the page).
function singer() {
  if (location.protocol === 'about:') return;
  window.__plan = { wrong: [], idle: 57 }; // idle: what it sings between takes (the tuner's A3)
  window.__mics = []; // { stream, tuner }
  window.__viol = [];
  let shared = null;
  navigator.mediaDevices.getUserMedia = async () => {
    const tuner = /shell\/tuner\.js/.test(new Error().stack || '');
    if (!shared) {
      const ac = new AudioContext();
      const osc = ac.createOscillator(); osc.type = 'sawtooth';
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2500;
      const g = ac.createGain(); g.gain.value = 0;
      const dest = ac.createMediaStreamDestination();
      osc.connect(lp); lp.connect(g); g.connect(dest); osc.start();
      setInterval(() => {
        const d = window.resonateSing?.debug?.(); const P = window.__plan; let m = null;
        if (d?.session?.kind === 'sing') {
          const [a, z] = d.take?.range || [0, d.notes.length];
          const i = d.notes.findIndex((n, k) => k >= a && k < z && n.t <= d.nowT && d.nowT < n.t + n.d - 0.04);
          if (i >= 0) m = d.notes[i].midi + (P.wrong.includes(i) ? -2 : 0);
        } else if (!d?.session && P.idle) m = P.idle;
        if (m === null) g.gain.setTargetAtTime(0, ac.currentTime, 0.005);
        else { osc.frequency.setValueAtTime(440 * 2 ** ((m - 69) / 12), ac.currentTime); g.gain.setTargetAtTime(0.25, ac.currentTime, 0.005); }
      }, 5);
      shared = dest.stream;
    }
    const s = shared.clone();
    window.__mics.push({ stream: s, tuner });
    return s;
  };
  setInterval(() => {
    const st = window.resonateSing?.state?.();
    if (!st?.busy) return;
    const live = window.__mics.some((m) => m.tuner && m.stream.getTracks().some((t) => t.readyState === 'live'));
    if (live) window.__viol.push({ t: performance.now(), st });
  }, 50);
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
  await ctx.addInitScript(singer);
  ctx.errors = [];
  ctx.on('page', (p) => {
    p.on('pageerror', (e) => ctx.errors.push(`${p.url().split('/').pop()}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|supabase|Failed to fetch|sync/i.test(m.text())) ctx.errors.push(`${p.url().split('/').pop()}: ${m.text()}`); });
  });
  return ctx;
}
// The shell's state, with Sing's own as on sing.html (light: no score / notes / frames).
const dbg = (p) => p.evaluate(() => {
  const d = window.resonateDebug?.();
  if (!d) return null;
  const s = window.resonateSing?.debug?.();
  return { song: d.song, tuner: d.tuner, overlay: d.overlay, history: history.state,
    sing: s && { session: s.session, nowT: s.nowT, title: s.score?.title, line2: s.notes[s.lines[2]?.[0]]?.t, card: s.practice.card, on: s.practice.on, takeEnd: s.take?.endT ?? null } };
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
// No page scroll, nothing sideways; the top bar, the dock and Sing's head ≥ 44 px.
const layout = (p) => p.evaluate(() => {
  const se = document.scrollingElement;
  const small = [...document.querySelectorAll('.top a, .top button, .dock a, .dock button, #sing-region .controls button, #sing-region .controls select, #coach button')]
    .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
    .map((e) => ({ e, r: e.getBoundingClientRect() }))
    .filter(({ r }) => r.width && (r.width < 43.5 || r.height < 43.5))
    .map(({ e, r }) => `${e.id || e.className || e.tagName}:${Math.round(r.width)}×${Math.round(r.height)}`);
  const wide = [...document.querySelectorAll('.app *')].filter((e) => e.getClientRects().length && !e.closest('.scope')).some((e) => e.getBoundingClientRect().right > innerWidth + 1);
  return { scrollH: se.scrollHeight, scrollW: se.scrollWidth, H: innerHeight, W: innerWidth, small, wide, scrolled: scrollY || scrollX };
});
// What the singer reads (not the key menu's options: "· 13% out" there is the fit's data, as on sing.html).
const words = (p) => p.evaluate(() => {
  const c = document.getElementById('sing-region').cloneNode(true);
  c.querySelectorAll('select').forEach((e) => e.remove());
  return [c.textContent, document.getElementById('review')?.innerText || '', document.querySelector('.dock').innerText].join(' ');
});

async function runSize(sz) {
  console.log(`\n=== ${sz.n} ${sz.w}×${sz.h}`);
  // (Sing alone on every device: step 3's default on a tablet / desktop is the Score — shellscore.cjs)
  const ctx = await context(sz, { 'resonate.profiles': JSON.stringify(PROFILE), 'resonate.sing.song': 'amazing-grace', 'resonate.shell.modules': JSON.stringify({ phone: 'sing', tablet: 'sing', desktop: 'sing' }) });
  const p = await ctx.newPage();
  await p.goto(BASE + 'index.html');
  await p.waitForFunction(() => window.resonateDebug?.().tuner);
  await p.waitForTimeout(300);
  const homeEntries = await p.evaluate(() => history.length);

  // --- the tuner listening at home, then a song from Songs: Sing in place, the tuner parked -------
  await p.click('#main-btn');
  let d = await until(p, (x) => x.tuner.note === 57, 6000);
  ok(d?.tuner.state === 'listening' && d.tuner.note === 57, 'home: the tuner listens (A3)');
  await p.click('#songs-btn');
  await p.waitForSelector('#songs-body .song[data-id="amazing-grace"]', { timeout: 4000 });
  await p.click('#songs-body .song[data-id="amazing-grace"]');
  // (v87: the modules come up once Sing is ready — laid — and slide in: wait for the motion to end)
  d = await until(p, (x) => x.song.open && x.song.laid && !x.song.moving && x.sing?.title === 'Amazing Grace' && x.song.state?.song === 'amazing-grace', 15000);
  ok(!!d?.song.open && d.sing?.title === 'Amazing Grace', 'Songs → Amazing Grace opens Sing in place');
  ok(/index\.html$/.test(p.url()), `no navigation (${p.url().split('/').pop()})`);
  ok(d?.tuner.form === sz.form && d.song.form === sz.form, `the tuner is ${sz.form} (${d?.tuner.form})`);
  ok(d?.tuner.state === 'off' && !d.tuner.live && /parked/.test(d.tuner.word), `the tuner parked: "${d?.tuner.word}"`);
  ok(!(await shown(p, '#songs')) && (await p.textContent('#song-pill .t')) === 'Amazing Grace', 'the list closed; the song pill says Amazing Grace');
  ok(!(await shown(p, '#nextup')) && !(await shown(p, '#main-btn')) && await shown(p, '#listen') && await shown(p, '#sing') && await shown(p, '#songs-btn'), 'the dock: Listen · Sing\'s primary · Songs');
  await p.waitForTimeout(400);
  const tun = await rect(p, '#tuner');
  ok(Math.abs(tun.h - (sz.form === 'strip' ? 52 : 150)) <= 1, `tuner height ${Math.round(tun.h)}`);
  const lane = await rect(p, '#lane'), dock = await rect(p, '.dock'), coach = await rect(p, '#coach');
  ok(lane.h >= 150 && lane.b <= dock.y && (!coach.vis || coach.b <= dock.y + 1), `lane ${Math.round(lane.w)}×${Math.round(lane.h)} (≥ 150), Sing above the dock`);
  let L = await layout(p);
  ok(L.scrollH <= L.H && L.scrollW <= L.W && !L.wide && !L.scrolled, `no page scroll / overflow (${L.scrollW}×${L.scrollH} in ${L.W}×${L.H})`);
  ok(!L.small.length, `touch targets ≥ 44 px${L.small.length ? ': ' + L.small.join(', ') : ''}`);
  ok(d.sing.on && /Hear it/.test(d.sing.card.title + (await p.textContent('#sing'))), `guided: the card "${d.sing.card.title}", the primary "${(await p.textContent('#sing')).trim()}"`);
  ok(await p.evaluate(() => history.state?.shellPage === 'song'), 'a history entry for the song');
  await shot(p, sz, 'song-open');

  // --- Listen plays and stops; the tuner paused meanwhile ------------------------------------------
  await p.click('#listen');
  d = await until(p, (x) => x.sing?.session?.kind === 'listen' && x.sing.nowT > 0.5, 8000);
  ok(d?.sing?.session?.kind === 'listen', 'Listen plays');
  await p.waitForTimeout(250);
  d = await dbg(p);
  ok(d.tuner.hold === 'paused' && d.tuner.word === 'paused' && await p.$eval('#tuner .tmic', (e) => e.disabled), 'the tuner says "paused", its mic button off');
  ok(await p.$eval('#listen', (e) => e.hasAttribute('data-stop')) && /Stop/.test(await p.textContent('#listen-w')), 'Listen shows ■ Stop');
  await shot(p, sz, 'listen');
  await p.click('#listen');
  d = await until(p, (x) => !x.sing?.session, 3000);
  ok(!d?.sing?.session && !(await p.$eval('#listen', (e) => e.hasAttribute('data-stop'))), '■ stops it');
  d = await until(p, (x) => !x.tuner.hold, 2000);
  ok(!d?.tuner.hold && /parked/.test(d.tuner.word), 'the tuner parked again (not paused)');

  // --- the guided step: Hear it starts and ■ Stop stops it -------------------------------------------
  await p.click('#sing');
  d = await until(p, (x) => x.sing?.session?.kind === 'listen', 6000);
  ok(d?.sing?.session?.kind === 'listen' && /Stop/.test(await p.textContent('#sing')), `guided Hear it plays (the primary "${(await p.textContent('#sing')).trim()}")`);
  await p.waitForTimeout(800);
  await p.click('#sing');
  d = await until(p, (x) => !x.sing?.session && !x.song.state.busy, 4000);
  ok(!d?.sing?.session && !!d?.sing?.card.title, `stopped; the card: "${d?.sing?.card.title}"`);

  // --- Guide me off → a free take with the simulated singer → the review --------------------------------
  await p.waitForTimeout(500);
  await p.click('#options-btn');
  await p.waitForSelector('#options:not([hidden])');
  await p.click('#guided-on');
  await p.goBack(); // (Back closes Sing's sheet, the song stays)
  await p.waitForTimeout(300);
  d = await dbg(p);
  ok(!(await shown(p, '#options')) && d.song.open && !d.sing.on, 'Guide me off; Back closed the options, the song stays');
  ok(/Sing/.test(await p.textContent('#sing')), `the primary: "${(await p.textContent('#sing')).trim()}"`);
  await p.evaluate(() => window.__plan.wrong = [6, 7]);
  await p.click('#sing');
  d = await until(p, (x) => x.sing?.session?.kind === 'sing', 8000);
  ok(d?.sing?.session?.kind === 'sing', 'a take starts');
  d = await until(p, (x) => x.sing?.nowT > 2, 15000);
  ok(d?.tuner.hold === 'take' && d.tuner.word === 'take' && !d.tuner.live, 'the strip says "take", no tuner mic');
  ok(await p.$eval('#sing', (e) => e.dataset.active === 'true' && /Stop/.test(e.textContent)), 'the primary is ■ Stop (red)');
  await shot(p, sz, 'take');
  d = await until(p, (x) => x.sing?.nowT > x.sing.line2 + 0.3, 30000);
  await p.click('#sing');
  await p.waitForSelector('#review:not([hidden])', { timeout: 10000 }).catch(() => {});
  d = await until(p, (x) => !x.song.state.busy, 8000);
  ok(await shown(p, '#review') && (await p.textContent('#rv-headline')).trim().length > 3, `■ Stop → the review: "${(await p.textContent('#rv-headline').catch(() => '')).trim()}"`);
  const txt = await words(p);
  const bad = txt.match(/.{0,30}(\d\s?%|\bfail|\bwrong\b|score:).{0,30}/i);
  ok(!bad, `no %, no "fail" in the review or Sing${bad ? ': …' + bad[0].replace(/\s+/g, ' ') + '…' : ''}`);
  ok(await p.evaluate(() => { const t = JSON.parse(localStorage.getItem('resonate.sing.history') || '{}')['amazing-grace']; return Array.isArray(t) && t.length > 0; }), 'the take is in the history (as sing.html)');
  await shot(p, sz, 'review');
  await p.goBack();
  await p.waitForTimeout(300);
  d = await dbg(p);
  ok(!(await shown(p, '#review')) && d.song.open, 'Back closes the review, the song stays');

  // --- the tuner drop: the rest of the strip drops the full tuner; no relayout -----------------------------
  const laneBefore = await rect(p, '#lane');
  const tr = await rect(p, '#tuner');
  await p.mouse.click(tr.x + tr.w * 0.55, tr.y + Math.min(tr.h / 2, 30));
  await p.waitForTimeout(300);
  d = await dbg(p);
  ok(d.song.drop && d.overlay === 'tuner' && d.tuner.form === 'full', 'a tap on the tuner drops the full tuner');
  const laneAfter = await rect(p, '#lane');
  ok(JSON.stringify(laneBefore) === JSON.stringify(laneAfter), 'Sing not laid out again');
  await p.click('#tuner .tmic');
  d = await until(p, (x) => x.tuner.note === 57, 6000);
  ok(d?.tuner.state === 'listening' && d.tuner.note === 57, 'its own mic button: listening (A3)');
  await p.waitForTimeout(500);
  await shot(p, sz, 'tuner-drop');
  const dr = await rect(p, '#tuner');
  await p.mouse.click(dr.x + dr.w / 2, dr.y + dr.h * 0.35);
  await p.waitForTimeout(300);
  d = await dbg(p);
  ok(!d.song.drop && d.tuner.form === sz.form && d.tuner.state === 'listening', `a tap closes it: ${sz.form} again, still listening`);
  if (sz.touch) { // a swipe up closes it too
    await p.mouse.click(tr.x + tr.w * 0.55, tr.y + Math.min(tr.h / 2, 30));
    await p.waitForTimeout(250);
    const r2 = await rect(p, '#tuner');
    await p.mouse.move(r2.x + r2.w / 2, r2.y + r2.h * 0.6); await p.mouse.down();
    await p.mouse.move(r2.x + r2.w / 2, r2.y + r2.h * 0.6 - 120, { steps: 5 }); await p.mouse.up();
    await p.waitForTimeout(300);
    ok(!(await dbg(p)).song.drop, 'a swipe up closes it');
  }
  await shot(p, sz, 'listening-strip');

  // --- a tap that starts sound parks the tuner first; ◎ goes home and stops everything ----------------------
  await p.click('#listen');
  d = await dbg(p);
  ok(d.tuner.state === 'off' && !d.tuner.live, 'Listen tapped while the tuner listens: the tuner parked first');
  d = await until(p, (x) => x.sing?.session?.kind === 'listen', 6000);
  ok(d?.sing?.session?.kind === 'listen', 'and Listen plays');
  await p.waitForTimeout(500);
  await p.click('#brand');
  d = await until(p, (x) => !x.song.open && !x.song.moving && !x.song.closing, 5000); // (v87: Sing slides out first)
  await p.waitForSelector('#nextup:not([hidden])', { timeout: 3000 }).catch(() => {});
  ok(!d?.song.open && !d.song.state.busy && !d.sing?.session, '◎ home: Sing closed, nothing playing');
  ok(d?.tuner.form === 'full' && await shown(p, '.gauge') && await shown(p, '#main-btn') && await shown(p, '#nextup') && !(await shown(p, '#sing-region')), 'the full tuner, Start and Next-up back');
  ok(await p.evaluate((n) => history.length === n + 1 && !history.state?.shellPage, homeEntries) || await p.evaluate(() => !history.state?.shellPage), 'the song\'s history entry gone');
  L = await layout(p);
  ok(L.scrollH <= L.H && !L.wide, 'home: no page scroll');

  // --- another song: Next-up → Amazing Grace; then a MusicXML added → Sing switches; Back → home ----------
  await p.click('#nextup');
  d = await until(p, (x) => x.song.open && x.song.laid && !x.song.moving && x.sing?.title === 'Amazing Grace', 8000);
  ok(!!d?.song.open, 'Next-up ▶ opens Sing');
  await p.click('#songs-btn');
  await p.click('#add-btn');
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('#add-xml')]);
  await fc.setFiles(`${FX}/trace/oh-susanna.mxl`);
  d = await until(p, (x) => x.song.open && /^s/.test(x.song.state?.song || '') && x.sing?.title && x.sing.title !== 'Amazing Grace', 10000);
  ok(!!d && /susanna/i.test(d.sing?.title || '') && /susanna/i.test(await p.textContent('#song-pill .t')), `a MusicXML added: Sing switches to it (${d?.song.state?.song} "${d?.sing?.title}")`);
  ok(!(await shown(p, '#songs')) && /index\.html$/.test(p.url()), 'the list closed, no navigation');
  await p.goBack();
  d = await until(p, (x) => !x.song.open && !x.song.moving && !x.song.closing, 5000);
  await p.waitForFunction(() => /susanna/i.test(document.querySelector('#nextup .t')?.textContent || ''), null, { timeout: 3000 }).catch(() => {});
  const nu = await p.textContent('#nextup .t'); ok(!d?.song.open && d.tuner.form === 'full' && /susanna/i.test(nu), `Back from the song → home (Next-up: that song) [open ${d?.song.open} form ${d?.tuner.form} nextup "${nu}"]`);

  // --- a reload with a song open comes home --------------------------------------------------------------
  await p.click('#nextup');
  await until(p, (x) => x.song.open && x.sing?.title, 8000);
  await p.reload();
  await p.waitForFunction(() => window.resonateDebug?.().tuner);
  await p.waitForTimeout(500);
  d = await dbg(p);
  ok(!d.song.open && d.tuner.form === 'full' && await shown(p, '#nextup'), 'reload with a song open → home (the song on Next-up)');

  const viol = await p.evaluate(() => window.__viol.length);
  ok(!viol, `the tuner never had a live track while Sing was busy (${viol} samples)`);
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
