// PDF → Song end to end on the real page with the Reader watching: a real conversion (CheerpJ +
// Audiveris + the 0009 trace) of the synthetic greensleeves3.pdf (title page + 3 music pages) in
// Chromium, a screenshot at every stage, a reload in the middle (sheet 2 under way) that must bring
// the Reader back at once with what it showed (and minimized when it was), then on to the song.
//   VIEW=iphone|ipad node importreader.cjs [outdir]     (default: both, one after the other)
// Checks: every event honours the contract (importcontract.mjs) before and after the reload; the
// picker never flashes on the reload; the stored events drawn at once (no animation replayed);
// sheet 1 never read again; minimized survives the reload (device pref); minimize / expand mid-run;
// done → the title, Sing it / Play it, the rail all ✓, the song saved, the job gone; no page errors.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:8097';
const PDF = process.env.PDF || '/imp/greensleeves3.pdf';
const OUTROOT = process.argv[2] || '/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/import/shots/e2e';
const VIEWS = {
  iphone: { width: 393, height: 852, dpr: 2, mobile: true, minBeforeReload: true },
  ipad: { width: 820, height: 1180, dpr: 2, mobile: true, minBeforeReload: false },
};
let fails = 0, passes = 0;
let tag = '';
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} [${tag}] ${m}`); if (c) passes++; else fails++; };
let t0 = Date.now();
const stamp = () => `${String(Math.round((Date.now() - t0) / 1000)).padStart(3)}s`;

// What the test watches each tick (small: no previews, no event bodies).
const probe = () => {
  const d = window.resonateDebug?.() || {};
  const ev = d.eventList || [];
  const last = ev[ev.length - 1];
  return {
    st: d.reader || null, rd: d.readerDebug || null, imp: d.import || null, n: ev.length, has: d.hasResult,
    last: last ? { t: last.t, s: last.s, step: last.step, phase: last.phase } : null,
    notes1: ev.some((e) => e.t === 'notes' && e.s === 1),
    flag: (() => { try { return JSON.parse(localStorage.getItem('resonate.import') || 'null'); } catch { return null; } })(),
    err: document.getElementById('error')?.hidden === false ? document.getElementById('error-msg').textContent : '',
    min: localStorage.getItem('resonate.import.min'),
  };
};
// The event list as data the checker can read (a preview Blob → a marker string).
const eventsData = () => (window.resonateDebug?.().eventList || []).map((e) => (e.preview instanceof Blob ? { ...e, preview: `blob:${e.preview.type}:${e.preview.size}` } : e));

async function one(name) {
  const v = VIEWS[name];
  tag = name;
  t0 = Date.now();
  const OUT = path.join(OUTROOT, name);
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png')) fs.unlinkSync(path.join(OUT, f));
  const { checkStream } = await import('./importcontract.mjs');
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
  const ctx = await b.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.dpr, isMobile: v.mobile, hasTouch: v.mobile });
  // Every frame from the very start of a load: was the picker ever shown, when did the Reader appear
  // and when had it drawn the stored run.
  await ctx.addInitScript(() => {
    window.__frames = { pick: 0, first: null, rd: null, drawn: null, n: 0 };
    window.__long = [];
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([Math.round(e.startTime), Math.round(e.duration), window.resonateDebug?.().reader?.phase || '-']); }).observe({ type: 'longtask' }); } catch {}
    const tick = () => {
      const f = window.__frames;
      const pick = document.getElementById('pick');
      if (pick && pick.getClientRects().length && getComputedStyle(pick).display !== 'none') f.pick++;
      if (f.first == null && document.body) f.first = performance.now();
      if (f.rd == null && document.querySelector('.rd')) f.rd = performance.now();
      const d = window.resonateDebug?.().readerDebug;
      if (f.drawn == null && d && d.drawnN > 5) { f.drawn = performance.now(); f.n = d.drawnN; }
      if (f.drawn == null || performance.now() < 5000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  let p = await ctx.newPage();
  const errs = [];
  const watch = (pg) => {
    pg.on('pageerror', (e) => { errs.push(e.message); console.log(stamp(), 'pageerror', e.message); });
    pg.on('console', (m) => { if (m.type() === 'error') { errs.push(m.text()); console.log(stamp(), 'console.error', m.text().slice(0, 200)); } });
  };
  watch(p);
  await p.goto(`${BASE}/resonate/pdf-import.html`);
  await p.evaluate(async () => { // a clean slate: no jobs, no pref
    localStorage.removeItem('resonate.import.min');
    const J = await import('/resonate/omr/jobs.js?v=80');
    for (const j of await J.listJobs()) await J.deleteJob(j.id);
  });
  await p.goto(`${BASE}/resonate/pdf-import.html?pdf=${PDF}`);

  const shots = [];
  const shot = async (label, full = false) => {
    const f = path.join(OUT, `${String(shots.length + 1).padStart(2, '0')}-${label}.png`);
    await p.screenshot({ path: f, fullPage: full }).catch((e) => console.log('screenshot failed', e.message.split('\n')[0]));
    shots.push(f);
    console.log(stamp(), 'shot', path.basename(f));
  };
  const step = (d) => d.st?.phase === 'read' ? `${d.st.s}:${d.st.step}${d.st.sys ? `/${d.st.sys}` : ''}` : d.st?.phase;
  // Stages before the reload: [label, condition, delay so the drawing catches up]
  const before = [
    ['pages', (d) => d.st?.phase === 'pages' && d.st.of >= 2, 500],
    ['engine', (d) => d.st?.phase === 'engine', 2500],
    ['binary', (d) => d.st?.s === 1 && d.st.step === 'BINARY', 900],
    ['grid', (d) => d.st?.s === 1 && d.st.step === 'HEADERS', 1300],
    ['beams', (d) => d.st?.s === 1 && d.st.step === 'BEAMS', 700],
    ['heads', (d) => d.st?.s === 1 && d.st.step === 'HEADS' && d.st.sys >= 2, 1500],
    ['reduction', (d) => d.st?.s === 1 && d.st.step === 'REDUCTION', 450],
    ['words', (d) => d.st?.s === 1 && ['MEASURES', 'CHORDS', 'CURVES'].includes(d.st.step), 300],
    ['notes', (d) => d.notes1, 1500],
    ['page2', (d) => d.st?.s === 2 && d.st.step === 'GRID', 900],
  ];
  const reloadAt = (d) => d.st?.s === 2 && ['HEADS', 'STEMS'].includes(d.st.step) && (d.flag?.done || 0) >= 1;
  let last = '';
  let d = null;
  const deadline = Date.now() + 30 * 60000;
  const poll = async (until, list = []) => {
    while (Date.now() < deadline) {
      d = await p.evaluate(probe).catch(() => null);
      if (!d) { await p.waitForTimeout(300); continue; }
      const line = `${step(d)} ${d.imp?.state || ''} ${d.err}`;
      if (line !== last) { console.log(stamp(), line); last = line; }
      if (d.err) return false;
      for (const s of list) {
        if (!s.done && s[1](d)) {
          s.done = true;
          await p.waitForTimeout(s[2]);
          await shot(s[0]);
        }
      }
      if (until(d)) return true;
      await p.waitForTimeout(250);
    }
    return false;
  };
  ok(await poll(reloadAt, before), `reached sheet 2 with sheet 1 kept (${step(d)}, flag ${JSON.stringify(d?.flag)})`);
  const missed = before.filter((s) => !s.done).map((s) => s[0]);
  ok(await p.evaluate(() => !document.querySelector('.rd-stop').hidden && document.getElementById('job-bar').hidden), 'running: the ✕ on the Reader, no job bar');
  ok(missed.length === 0, `every stage before the reload shot (${before.length - missed.length}/${before.length}${missed.length ? `; missed ${missed}` : ''})`);
  const evA = await p.evaluate(eventsData);
  const badA = checkStream(evA);
  ok(badA.length === 0, `contract: ${evA.length} live events before the reload ${badA.slice(0, 4).join(' | ')}`);
  const longA = await p.evaluate(() => window.__long);
  if (v.minBeforeReload) {
    await p.click('.rd-min');
    await p.waitForTimeout(500);
    await shot('min-before-reload');
    ok((await p.evaluate(() => localStorage.getItem('resonate.import.min'))) === '1', 'minimized → the device pref is set');
  } else await shot('before-reload');

  // The reload, of the page without ?pdf (the test hook would start a new import): its address
  // replaced first, so it's a real reload (navigation type 'reload' — a minimized Reader stays so only
  // then; arriving by a link or the pill opens it).
  const drawnBefore = d.rd?.drawnN;
  await p.evaluate(() => history.replaceState(null, '', location.pathname));
  await p.reload({ waitUntil: 'commit' });
  const fr = await p.waitForFunction(() => window.__frames.drawn != null || (window.__frames.rd != null && window.resonateDebug?.().readerDebug?.mode === 'min' && window.resonateDebug().readerDebug.gotN > 5), null, { timeout: 30000, polling: 16 }).then(() => p.evaluate(() => ({ ...window.__frames, rdState: window.resonateDebug().readerDebug, nav: performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd }))).catch(() => null);
  await shot(v.minBeforeReload ? 'restored-min' : 'restored');
  console.log(stamp(), 'restored', JSON.stringify(fr && { pick: fr.pick, rd: Math.round(fr.rd), drawn: fr.drawn && Math.round(fr.drawn), n: fr.n, mode: fr.rdState?.mode, got: fr.rdState?.gotN, dcl: Math.round(fr.nav || 0) }));
  ok(fr && fr.pick === 0, `the picker never showed during the reload (${fr?.pick} frames)`);
  ok(fr && fr.rd != null && fr.rd < 3000, `the Reader there ${Math.round(fr?.rd)} ms after the navigation started`);
  if (v.minBeforeReload) {
    ok(fr?.rdState?.mode === 'min' && (await p.isVisible('.rd-pill')), `minimized before → minimized after the reload (the pill: “${await p.textContent('.rd-pill').catch(() => '')}”)`);
    await p.waitForTimeout(400);
    await p.click('.rd-pill');
    await p.waitForTimeout(450);
    const r = await p.evaluate(() => window.resonateDebug().readerDebug);
    ok(r.mode === 'open' && r.drawnN === r.gotN, `expand → the stored run drawn at once (${r.drawnN}/${r.gotN} events)`);
    await shot('restored-expanded');
  } else {
    const r = await p.evaluate(() => window.resonateDebug().readerDebug);
    ok(fr?.drawn != null && fr.drawn - fr.rd < 1500 && r.statics >= 1 && fr.n >= 5, `the stored run (${fr?.n} events; ${drawnBefore} drawn before the reload) drawn ${Math.round((fr?.drawn ?? NaN) - (fr?.rd ?? NaN))} ms after the Reader appeared, as one static render (${r.statics})`);
  }
  const rail = await p.evaluate(() => [...document.querySelectorAll('.rd-th')].map((t) => t.dataset.state));
  ok(rail.includes('done'), `the rail shows page 2 read (${rail.join(',')})`);

  // On to the end, with a minimize / expand on the iPad.
  const after = [
    ['resumed-live', (x) => x.st?.s === 2 && x.st.phase === 'read' && ['HEADS', 'STEMS', 'REDUCTION', 'TEXTS'].includes(x.st.step) && x.imp?.state === 'running', 2500],
    ['page3', (x) => x.st?.s === 3 && x.st.step === 'HEADS' && x.st.sys >= 1, 1500],
    ['page3-notes', (x) => x.last?.t === 'notes' && x.last.s === 3, 1600],
    ['export', (x) => x.st?.phase === 'export', 1200],
  ];
  if (!v.minBeforeReload) {
    after.splice(2, 0, ['pill', (x) => x.st?.s === 3 && x.st.step === 'STEMS', 0]);
  }
  const finished = (x) => x.has && x.rd?.phase === 'done';
  const pollAfter = async () => {
    while (Date.now() < deadline) {
      d = await p.evaluate(probe).catch(() => null);
      if (!d) { await p.waitForTimeout(300); continue; }
      const line = `${step(d)} ${d.imp?.state || ''} ${d.err}`;
      if (line !== last) { console.log(stamp(), line); last = line; }
      if (d.err) return false;
      for (const s of after) {
        if (s.done || !s[1](d)) continue;
        s.done = true;
        if (s[0] === 'pill') {
          await p.click('.rd-min');
          await p.waitForTimeout(500);
          await shot('pill');
          const a = await p.evaluate(() => window.resonateDebug().readerDebug);
          await p.waitForTimeout(2500);
          const m = await p.evaluate(() => window.resonateDebug().readerDebug);
          ok(a.mode === 'min' && m.drawnN === a.drawnN && m.gotN >= a.gotN, `minimized mid-run: nothing drawn (${a.drawnN} → ${m.drawnN}), events still taken (${a.gotN} → ${m.gotN})`);
          await p.click('.rd-pill');
          await p.waitForTimeout(400);
          const e = await p.evaluate(() => window.resonateDebug().readerDebug);
          ok(e.mode === 'open' && e.drawnN >= m.gotN, `expand → caught up at once (${e.drawnN}/${e.gotN})`);
          await shot('expanded');
          ok((await p.evaluate(() => localStorage.getItem('resonate.import.min'))) === null, 'expanded → the pref cleared');
          continue;
        }
        await p.waitForTimeout(s[2]);
        await shot(s[0]);
      }
      if (finished(d)) return true;
      await p.waitForTimeout(250);
    }
    return false;
  };
  ok(await pollAfter(), `finished after the reload (${d?.err || 'done'})`);
  await p.waitForTimeout(600);
  await shot('done-flip');
  await p.waitForTimeout(3500);
  await shot('done');
  await shot('done-page', true);
  const end = await p.evaluate(() => {
    const dd = window.resonateDebug();
    return {
      st: dd.reader, rd: dd.readerDebug, has: dd.hasResult, title: document.querySelector('.rd-title')?.textContent,
      links: [...document.querySelectorAll('.rd-done a')].map((a) => [a.textContent.trim(), a.getAttribute('href')]),
      linksShown: [...document.querySelectorAll('.rd-done a')].some((a) => a.getClientRects().length),
      rail: [...document.querySelectorAll('.rd-th')].map((t) => t.dataset.state),
      result: document.getElementById('result-detail').textContent, mode: dd.readerDebug.mode,
      flag: localStorage.getItem('resonate.import'), min: localStorage.getItem('resonate.import.min'),
      overflow: document.documentElement.scrollWidth - innerWidth, long: window.__long,
    };
  });
  const evB = await p.evaluate(eventsData);
  const badB = checkStream(evB);
  ok(badB.length === 0, `contract: ${evB.length} events after the reload (stored + live) ${badB.slice(0, 4).join(' | ')}`);
  const job = evB[0];
  ok(job?.t === 'job' && job.resumed === true, 'the resumed list starts with the stored job event (resumed)');
  const liveStart = evB.findIndex((e, i) => i > 0 && e.t === 'phase' && e.phase === 'engine');
  const live = evB.slice(liveStart);
  ok(liveStart > 0 && !live.some((e) => e.s === 1 && (e.t === 'step' || e.t === 'sym')), `sheet 1 never read again after the reload (live from #${liveStart})`);
  ok(live.some((e) => e.t === 'engine' && e.milestone === 'book' && (e.detail?.done || []).includes(1)), 'the engine continued the stored book (K: sheet 1 done)');
  ok(end.st.phase === 'done' && end.title === 'Greensleeves' && end.links.length === 2 && end.linksShown, `done → “${end.title}” with ${end.links.map((l) => l[0]).join(' / ')}`);
  ok(end.rail.filter((x) => x === 'done').length === 3 && end.rail.filter((x) => x === 'skip').length === 1, `the rail: ${end.rail.join(',')}`);
  ok(/saved to My songs/.test(end.result) && !end.flag, `the song saved, no job flag left (${end.result})`);
  ok(end.mode === 'open' && (v.minBeforeReload ? end.min === null : true), 'the end expands itself (the pref untouched by it)');
  ok(end.overflow <= 0, `no sideways scroll (${end.overflow})`);
  ok(errs.length === 0, `no page errors ${errs.slice(0, 3).join(' | ')}`);
  const longs = [...longA, ...end.long];
  const maxLong = Math.max(0, ...longs.map((x) => x[1]));
  console.log(`info  [${name}] the Reader's own slowest event ${end.rd.slow?.[0]} ms (${end.rd.slow?.[1]}), slowest catch-up ${end.rd.staticMs} ms, ${end.rd.beats} beats, ${end.rd.ff} catch-ups`);
  console.log(`info  [${name}] main-thread long tasks: ${longs.length}, max ${maxLong} ms (${longs.slice(0, 16).map((x) => `${x[1]}@${x[2]}`).join(', ')})`);
  fs.writeFileSync(path.join(OUT, 'events.json'), JSON.stringify(evB));
  fs.writeFileSync(path.join(OUT, 'log.txt'), await p.evaluate(() => document.getElementById('log')?.textContent || '').catch(() => ''));
  await b.close();
  console.log(stamp(), `${name}: ${shots.length} shots in ${OUT}`);
}

(async () => {
  const list = process.env.VIEW ? process.env.VIEW.split(',') : ['iphone', 'ipad'];
  for (const v of list) await one(v);
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
