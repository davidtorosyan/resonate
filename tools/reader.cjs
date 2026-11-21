// The Reader (public/omr/reader.js + readerstate.js): the PDF → Song import drawn as it happens.
//   node reader.cjs            unit checks (reducer, selectors, code lines) + browser replays + a
//                              screenshot of every stage on an iPhone and an iPad (both ways)
//   SHOTS=0 node reader.cjs    no stage gallery
//   FX=killing node reader.cjs replay another fixture (fixtures/reader/<name>: readerfixture.py)
// Fixtures: /home/user/tools/fixtures/reader/{greensleeves,amazing-grace} (synthetic, rendered by
// us) and killing (the owner's score — stays outside the repo). The dev harness is
// /home/user/sitetest/readerdev.html (?fx=&speed=&load=N&stop=N&min&hold&bare).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8097';
const FXDIR = '/home/user/tools/fixtures/reader';
const OUT = process.env.OUT || '/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/import/shots';
const FX = process.env.FX || 'greensleeves';
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('ok   ', msg); } else { fail++; console.log('FAIL ', msg); } };
// Timing checks mean something only on a quiet machine: with other browsers / Java runs on the
// CPU (load above ~¾ of the cores) they're reported, not judged (STRICT=1 judges them anyway).
const os = require('os');
const busy = () => !process.env.STRICT && os.loadavg()[0] > os.cpus().length * 0.75;
const timing = (c, msg) => { if (c || !busy()) ok(c, msg); else console.log(`info  ${msg} — not judged: CPU busy (load ${os.loadavg()[0].toFixed(1)} on ${os.cpus().length} cores)`); };

const VIEWS = [
  { name: 'iphone', width: 393, height: 852, dpr: 3, mobile: true },
  { name: 'ipad', width: 820, height: 1180, dpr: 2, mobile: true },
  { name: 'ipad-land', width: 1180, height: 820, dpr: 2, mobile: true },
];

async function unit() {
  const R = await import('/home/user/resonate/public/omr/readerstate.js');
  const { highlight } = await import('/home/user/resonate/public/omr/reader.js').catch(() => ({}));
  for (const name of fs.readdirSync(FXDIR)) {
    const f = path.join(FXDIR, name, 'events.json');
    if (!fs.existsSync(f)) continue;
    const { events } = JSON.parse(fs.readFileSync(f, 'utf8'));
    let st = R.initial(), last = 0, back = 0, sysLens = 0, firstEta = null, etaNull = true;
    for (const { at, ev } of events) {
      st = R.reduce(st, { ...ev, at });
      const p = R.progress(st);
      if (p < last - 1e-9) back++;
      last = p;
      if (st.cur.s && R.lensOf(st, st.cur.s).kind === 'sys') sysLens++;
      const e = R.eta(st, at);
      if (e != null && firstEta == null) firstEta = st.n;
      if (e != null && !Object.values(st.sheets).some((s) => s.state === 'done')) etaNull = false;
    }
    const c = R.counts(st);
    ok(back === 0 && last === 1, `${name}: progress never goes back, ends at 1 (${events.length} events)`);
    ok(st.phase === 'done' && R.heroOf(st).look === 'done', `${name}: done, hero on paper (page ${R.heroOf(st).page})`);
    ok(c.done === c.music && c.music > 0, `${name}: every music sheet done (${c.done}/${c.music}, ${c.syms} symbols, ${c.notes} notes, ${c.words} words)`);
    ok(sysLens > 0, `${name}: the lens sits on a system during per-system steps (${sysLens} events)`);
    ok(etaNull && firstEta != null, `${name}: no ETA before the first page is done, one after (from event ${firstEta})`);
    // Replay = the same state (resume is reduceAll over the stored events).
    const again = R.reduceAll(events.map(({ at, ev }) => ({ ...ev, at })));
    ok(JSON.stringify(R.status(again, 0)) === JSON.stringify(R.status(st, 0)), `${name}: reduceAll gives the same state as event by event`);
  }
  // Final phases stay final; junk is ignored.
  let st = R.reduceAll([{ t: 'phase', phase: 'read' }, { t: 'done', title: 'X' }, { t: 'phase', phase: 'export' }, { t: 'error', message: 'late' }, null, 7, { t: 'nope' }, { t: 'sym' }, { t: 'page' }]);
  ok(st.phase === 'done' && !st.error, 'done stays done (a late phase or error never reopens it); malformed events ignored');
  st = R.reduceAll([{ t: 'page', page: 1, of: 2, music: true, s: 1, staves: [] }, { t: 'step', s: 1, step: 'HEADS' }]);
  ok(R.lensOf(st, 1).kind === 'page' && st.sheets[1].state === 'read', 'a step with no grid: the lens holds the page (steps only: today\'s log)');
  st = R.reduce(st, { t: 'grid', s: 1, systems: [{ id: 1, box: [0, 0, 10, 10], staves: [] }, { id: 2, box: [0, 20, 10, 30], staves: [] }] });
  ok(R.lensOf(st, 1).sys === 1, 'grid known, nothing reported yet: the lens on system 1');
  st = R.reduce(st, { t: 'sym', s: 1, step: 'HEADS', sys: 1, add: [{ id: 5, k: 'head', x: 1, y: 2, w: 3, h: 3 }] });
  ok(R.lensOf(st, 1).sys === 2 && st.sheets[1].symN === 1, 'system 1 reported: the engine is on system 2');
  st = R.reduce(st, { t: 'sym', s: 1, step: 'REDUCTION', sys: 2, del: [5] });
  ok(st.sheets[1].symN === 0, 'a removed symbol leaves the sheet');
  // Clocks are reading time: a stored run loaded hours later (load → pause) or held by its host
  // doesn't count the break.
  st = R.pause(R.reduceAll([{ t: 'job', id: 'j', name: 'x.pdf', resumed: false, at: 1000 }, { t: 'step', s: 1, step: 'HEADS', at: 61000 }]));
  const frozen = R.elapsed(st, 9e9);
  st = R.reduce(st, { t: 'phase', phase: 'engine', at: 7261000 });
  ok(frozen === 60 && R.elapsed(st, 7271000) === 70 && st.gap === 7200000 && st.paused == null, `pause: frozen at ${frozen} s; 2 h later the next event adds the break to gap → ${R.elapsed(st, 7271000)} s`);
  ok(R.pause(R.initial()).paused == null && R.pause(st, 7300000).paused === 7300000, 'pause: nothing before the first event; a host hold stops the clock at its own time');
  // Code lines.
  const ls = R.noteLines([{ m: 3, x: 10, y: 5, step: 'F', alter: 1, oct: 4, dur: '3/8', voice: 1, syl: 'a<b' }, { m: 3, x: 12, y: 9, step: 'A', oct: 4, dur: '3/8', voice: 1 }, { m: 4, x: 40, step: 'B', oct: 3, dur: '1/12', voice: 1 }]).map((x) => x.xml);
  ok(ls[0] === '<measure number="3">' && ls[1].includes('<alter>1</alter>') && ls[1].includes('<type>quarter</type><dot/>') && ls[1].includes('<text>a&lt;b</text>'), 'noteLines: measure, alter, dotted type, escaped syllable');
  ok(ls[2].startsWith('<note><chord/>') && ls[3] === '<measure number="4">' && !ls[4].includes('<type>'), 'noteLines: a chord note; a tuplet length gets no made-up type');
  ok(R.symLine({ k: 'clef', x: 0, y: 0, w: 10, h: 20, v: 'G' }) === '<clef x="5" y="10" shape="G"/>' && R.symLine({ k: 'tie', x: 0, y: 0, w: 2, h: 2 }).includes('tie="true"'), 'symLine: the engine\'s own element names and the symbol\'s centre');
  ok(R.metaLines({ title: 'A & B', tempo: { bpm: 174, unit: 'half', dotted: true } }).join('') === '<work-title>A &amp; B</work-title><metronome><beat-unit>half</beat-unit><beat-unit-dot/><per-minute>174</per-minute></metronome>', 'metaLines: title and the tempo mark as MusicXML');
  ok(R.nameTitle('Wichita_Lineman_-_F_Major_-_MN0305807.pdf') === 'Wichita Lineman', 'nameTitle: a seller\'s file name');
  if (highlight) ok(!/<(?!\/?span)/.test(highlight('<a x="1"><!-- c --><b>t&</b>')) && highlight('<x>&</x>').includes('&amp;'), 'highlight: only spans, text escaped');
}

// Fixture-dependent stretches: a resume point with ≥ 2 s before the next event (so the check sees
// the stored run alone) and a stop point after the first page's notes (symbols on the page).
const FXEV = JSON.parse(fs.readFileSync(path.join(FXDIR, FX, 'events.json'), 'utf8')).events;
const LOAD_AT = (() => { for (let i = 100; i < FXEV.length; i++) if (FXEV[i].at - FXEV[i - 1].at >= 2000) return i; return 120; })();
const STOP_AT = FXEV.findIndex((e) => e.ev.t === 'notes') + 3;

async function browser() {
  const b = await chromium.launch();
  fs.mkdirSync(OUT, { recursive: true });
  for (const v of VIEWS) {
    const ctx = await b.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.dpr, isMobile: v.mobile, hasTouch: v.mobile });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
    await p.addInitScript(() => {
      window.__long = [];
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (window.__harness?.started) window.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: false }); } catch {}
      window.__live = [];
      window.__aria = [];
    });
    await p.goto(`${BASE}/readerdev.html?fx=${FX}&speed=10&bare`);
    await p.waitForFunction(() => window.__harness?.started, null, { timeout: 60000 });
    await p.evaluate(() => {
      const live = document.querySelector('.rd-sr');
      new MutationObserver(() => window.__live.push(live.textContent)).observe(live, { childList: true, characterData: true, subtree: true });
      const bar = document.querySelector('.rd-bar');
      new MutationObserver(() => window.__aria.push(Number(bar.getAttribute('aria-valuenow')))).observe(bar, { attributes: true, attributeFilter: ['aria-valuenow'] });
    });
    // Mid-run: minimize → nothing drawn; expand → caught up.
    await p.waitForFunction(() => window.__harness.idx > window.__harness.total * 0.3, null, { timeout: 120000 });
    await p.click('.rd-min');
    await p.waitForTimeout(400);
    const m1 = await p.evaluate(() => ({ dbg: window.__rd.debug(), pill: !document.querySelector('.rd-pill').hidden, card: document.querySelector('.rd-card').hidden, pillBox: document.querySelector('.rd-pill').getBoundingClientRect().toJSON(), pillText: document.querySelector('.rd-pill').textContent.trim() }));
    await p.screenshot({ path: `${OUT}/${v.name}-pill.png` });
    await p.waitForTimeout(1500);
    const m2 = await p.evaluate(() => window.__rd.debug());
    ok(m1.pill && m1.card && m1.dbg.mode === 'min', `${v.name}: minimize → the corner pill (“${m1.pillText}”), the card hidden`);
    ok(m1.pillBox.right <= v.width && m1.pillBox.bottom <= v.height && m1.pillBox.height >= 44, `${v.name}: the pill fits in the corner, ≥ 44 px (${Math.round(m1.pillBox.width)}×${Math.round(m1.pillBox.height)})`);
    ok(m2.drawnN === m1.dbg.drawnN && m2.gotN > m1.dbg.gotN && m2.beats === m1.dbg.beats, `${v.name}: minimized, events still counted (${m1.dbg.gotN}→${m2.gotN}) and nothing drawn (${m2.beats} beats)`);
    await p.click('.rd-pill');
    await p.waitForTimeout(300);
    const m3 = await p.evaluate(() => window.__rd.debug());
    ok(m3.mode === 'open' && m3.drawnN >= m2.gotN && m3.statics > m2.statics, `${v.name}: expand → the latest state drawn at once (${m3.drawnN}/${m3.gotN})`);
    // Hidden page: nothing drawn; shown again: caught up.
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    const h1 = await p.evaluate(() => window.__rd.debug());
    await p.waitForTimeout(1200);
    const h2 = await p.evaluate(() => window.__rd.debug());
    const h3 = await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); return window.__rd.debug(); });
    ok(h2.beats === h1.beats && h3.drawnN === h3.gotN, `${v.name}: hidden page → no drawing; visible → caught up`);
    await p.waitForFunction(() => window.__harness.done, null, { timeout: 300000 });
    // The Reader trails the engine by its queue (the export's MusicXML streams, then the flip).
    await p.waitForFunction(() => { const d = window.__rd.debug(); return d.drawnN === d.gotN && !d.timer; }, null, { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(1500);
    const end = await p.evaluate(() => {
      const r = (s) => document.querySelector(s)?.getBoundingClientRect().toJSON();
      return {
        dbg: window.__rd.debug(), st: window.__rd.status(), long: window.__long, live: window.__live, aria: window.__aria,
        overflow: document.documentElement.scrollWidth - innerWidth, page: r('.rd-page'), card: r('.rd-card'), code: r('.rd-code'),
        side: document.querySelector('.rd').hasAttribute('data-side'),
        done: getComputedStyle(document.querySelector('.rd-done')).display !== 'none',
        links: [...document.querySelectorAll('.rd-done a')].map((a) => [a.textContent, a.getAttribute('href')]),
        thumbs: [...document.querySelectorAll('.rd-th')].map((t) => t.dataset.state),
        title: document.querySelector('.rd-title').textContent,
        anims: document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations === Infinity).length,
      };
    });
    await p.screenshot({ path: `${OUT}/${v.name}-end.png` });
    const maxLong = Math.max(0, ...end.long);
    ok(errs.length === 0, `${v.name}: no page errors or warnings ${errs.slice(0, 3).join(' | ')}`);
    ok(end.st.phase === 'done' && end.done && end.links.length === 2 && end.links[0][1] === './?open=sing' && end.links[1][1] === './?open=score', `${v.name}: done → “${end.title}”, Sing it / Play it (${end.st.phase}, block ${end.done}, ${JSON.stringify(end.links)})`);
    ok(end.thumbs.length && end.thumbs.every((s) => s === 'done' || s === 'skip'), `${v.name}: every page in the rail ✓ or skipped (${end.thumbs.join(',')})`);
    ok(end.overflow <= 0 && end.page.right <= v.width && end.card.right <= v.width, `${v.name}: no sideways scroll; page ${Math.round(end.page.width)}×${Math.round(end.page.height)} fits`);
    ok(end.anims === 0, `${v.name}: done → nothing left breathing or spinning`);
    // Long tasks: the page as a whole (noisy when other work shares the CPU) and the Reader's own
    // work per event (draw) and per catch-up (static render).
    // One stray long task ≤ 100 ms is the shared CPU here (other browsers / Java runs), not the Reader.
    const strayOk = !process.env.STRICT && end.long.length === 1 && maxLong <= 100 && end.dbg.slow[0] <= 30;
    timing(maxLong <= 50 || strayOk, `${v.name}: no long task over 50 ms during the 10× replay (max ${maxLong} ms, ${end.long.length} long tasks${strayOk && maxLong > 50 ? ' — one stray, tolerated' : ''})`);
    timing(end.dbg.slow[0] <= 30 && end.dbg.staticMs <= 40, `${v.name}: the Reader's own work: slowest event ${end.dbg.slow[0]} ms (${end.dbg.slow[1]}), slowest catch-up ${end.dbg.staticMs} ms`);
    ok(end.live.length >= 2 && end.live.length <= 15, `${v.name}: the live region speaks sparsely (${end.live.length}: ${end.live.slice(0, 4).join(' · ')} …)`);
    ok(end.aria.every((x, i) => i === 0 || x >= end.aria[i - 1]) && end.aria.at(-1) === 100, `${v.name}: progressbar value never goes back, ends at 100`);
    ok(end.dbg.svgNodes < 1500 && end.dbg.codeLines <= 60, `${v.name}: bounded DOM (svg ${end.dbg.svgNodes} nodes, ${end.dbg.codeLines} code lines; ${end.dbg.beats} beats, ${end.dbg.ff} catch-ups, heavy backlog ≤ ${end.dbg.maxBacklog})`);
    // Code under the page or beside it, whichever shows the page larger: a phone and an iPad in
    // portrait stack (the page 657 px wide on an iPad instead of 498 beside the code), landscape beside.
    if (v.name !== 'ipad-land') ok(!end.side && (end.code.height === 0 || end.code.top >= end.page.bottom - 1), `${v.name}: the code below the page (hidden once done); page ${Math.round(end.page.width)} px wide`);
    else ok(end.side && end.code.left >= end.page.right - 1, `${v.name}: the code beside the page`);
    await ctx.close();
  }

  // The real engine's trace (patch 0009, mapped to the contract: tools/fixtures/trace/, merged with
  // the pages part as fixtures/reader/greensleeves-trace): HEADS proposes heads, REDUCTION drops most.
  if (fs.existsSync(path.join(FXDIR, 'greensleeves-trace/events.json'))) {
    const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
    await p.goto(`${BASE}/readerdev.html?fx=greensleeves-trace&speed=1&load=55&bare`);
    await p.waitForFunction(() => window.__harness?.started);
    const before = await p.evaluate(() => document.querySelectorAll('.rd-svg .l-sym [data-id]').length);
    await p.waitForFunction(() => window.__harness.idx > 60, null, { timeout: 30000 });
    await p.waitForTimeout(800);
    const after = await p.evaluate(() => document.querySelectorAll('.rd-svg .l-sym [data-id]').length);
    ok(after < before * 0.7, `trace: REDUCTION's removals leave the page (${before} → ${after} symbols)`);
    await p.goto(`${BASE}/readerdev.html?fx=greensleeves-trace&speed=10&bare`);
    await p.waitForFunction(() => window.__harness?.done, null, { timeout: 300000 });
    await p.waitForTimeout(2500);
    const d = await p.evaluate(() => ({ dbg: window.__rd.debug(), st: window.__rd.status(), facts: document.querySelector('.rd-facts').textContent }));
    ok(errs.length === 0 && d.st.phase === 'done', `trace: replayed to the end at 10×, no errors ${errs.slice(0, 2).join(' | ')}`);
    ok(!/object/i.test(d.facts), `trace: an object detail never shows as text (“${d.facts}”)`);
    await ctx.close();
  }

  // Resume: a stored run fast-forwarded (load), then live again.
  {
    const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${BASE}/readerdev.html?fx=${FX}&speed=10&load=${LOAD_AT}&bare`);
    await p.waitForFunction(() => window.__harness?.started);
    const d = await p.evaluate(() => ({ dbg: window.__rd.debug(), running: document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity).length }));
    ok(d.dbg.drawnN === LOAD_AT && d.dbg.statics === 1 && d.dbg.beats === 0 && d.dbg.svgNodes > 20, `resume: ${LOAD_AT} stored events drawn at once, no animation replayed (${d.dbg.drawnN} drawn, ${d.dbg.statics} static, ${d.dbg.beats} beats, ${d.dbg.svgNodes} svg nodes, look ${d.dbg.hero.look})`);
    await p.screenshot({ path: `${OUT}/resume-120.png` });
    await p.waitForFunction((n) => window.__harness.idx > n, LOAD_AT + 20, { timeout: 60000 });
    const d2 = await p.evaluate(() => window.__rd.debug());
    ok(d2.beats > 0 && errs.length === 0, `resume: then live again (${d2.beats} beats) ${errs.join(' | ')}`);
    // A failure, then destroy: the error state, then nothing left behind.
    const e = await p.evaluate(async () => {
      window.__harness.paused = true;
      window.__rd.push({ t: 'error', message: 'The music font didn\'t load' });
      for (let i = 0; i < 100 && window.__rd.debug().phase !== 'error'; i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 200));
      const r = { phase: window.__rd.status().phase, attr: document.querySelector('.rd').dataset.phase, facts: document.querySelector('.rd-facts').textContent, code: document.querySelector('.rd-lines').lastElementChild?.textContent };
      window.__rd.destroy();
      await new Promise((r2) => setTimeout(r2, 1500));
      r.left = document.querySelectorAll('.rd, .rd-pill').length;
      return r;
    });
    ok(e.phase === 'error' && e.attr === 'error' && /stopped/.test(e.facts) && /font/.test(e.code || ''), `error: stopped state, the message in the code (“${e.code}”)`);
    ok(e.left === 0 && errs.length === 0, `destroy: nothing left, no errors after ${errs.join(' | ')}`);
    await ctx.close();
  }

  // Host controls: ✕ with a confirming second tap, canStop, hold.
  {
    const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${BASE}/readerdev.html?fx=${FX}&speed=10&load=60&hold&bare`);
    await p.waitForFunction(() => window.__harness?.start);
    await p.evaluate(async () => {
      const { mount } = await import('/resonate/omr/reader.js');
      window.__rd.destroy();
      const ev = (await (await fetch('/readerfix/' + new URLSearchParams(location.search).get('fx') + '/events.json')).json()).events.slice(0, 60).map(({ at, ev: e }) => ({ ...e, preview: null, at: Date.now() - 3600e3 + at }));
      window.__stops = 0;
      window.__rd = mount(document.getElementById('host'), { onStop: () => window.__stops++ });
      window.__rd.load(ev);
    });
    const t1 = await p.evaluate(() => ({ facts: document.querySelector('.rd-facts').textContent, vis: !document.querySelector('.rd-stop').hidden }));
    await p.waitForTimeout(2200);
    const t2 = await p.evaluate(() => document.querySelector('.rd-facts').textContent);
    ok(t1.vis && t1.facts === t2 && !/1:0\d:/.test(t1.facts), `load an hour later: the clock stopped at the stored run's end (“${t1.facts}”)`);
    await p.tap('.rd-stop');
    const a = await p.evaluate(() => ({ txt: document.querySelector('.rd-stop').textContent, stops: window.__stops }));
    await p.tap('.rd-stop');
    const c = await p.evaluate(() => ({ txt: document.querySelector('.rd-stop').textContent, stops: window.__stops }));
    await p.tap('.rd-stop');
    await p.waitForTimeout(3300);
    const d = await p.evaluate(() => ({ txt: document.querySelector('.rd-stop').textContent, stops: window.__stops }));
    ok(a.txt === 'Stop?' && a.stops === 0 && c.stops === 1 && c.txt === '✕' && d.stops === 1 && d.txt === '✕', `✕: the first tap asks (“${a.txt}”), the second stops (${c.stops}), one tap alone lapses after 3 s (${d.stops})`);
    const h = await p.evaluate(async () => {
      window.__rd.canStop(false);
      const hidden = document.querySelector('.rd-stop').hidden;
      window.__rd.hold(true);
      const f1 = document.querySelector('.rd-facts').textContent;
      await new Promise((r) => setTimeout(r, 1500));
      const r = { hidden, held: document.querySelector('.rd').hasAttribute('data-held'), wait: document.querySelector('.rd').hasAttribute('data-wait'), still: f1 === document.querySelector('.rd-facts').textContent };
      window.__rd.push({ t: 'step', s: 2, step: 'LOAD' });
      r.after = window.__rd.held;
      window.__rd.canStop(true);
      r.back = !document.querySelector('.rd-stop').hidden;
      return r;
    });
    ok(h.hidden && h.held && !h.wait && h.still && h.after === false && h.back, `canStop(false) hides ✕; hold: clocks still, nothing breathing; the next event lets go (${JSON.stringify(h)})`);
    ok(errs.length === 0, `host controls: no errors ${errs.join(' | ')}`);
    await ctx.close();
  }

  // Reduced motion: no sweeps, no pops, no breathing; everything still shown.
  {
    const ctx = await b.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/readerdev.html?fx=${FX}&speed=10&stop=${STOP_AT}&bare`);
    await p.waitForFunction(() => window.__harness?.stopped, null, { timeout: 120000 });
    let maxAnims = 0, sweeps = 0;
    for (let i = 0; i < 6; i++) {
      const r = await p.evaluate(() => ({ a: document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().duration > 1).length, s: document.querySelector('.rd-sweep.on') ? 1 : 0 }));
      maxAnims = Math.max(maxAnims, r.a); sweeps += r.s;
      await p.waitForTimeout(150);
    }
    const d = await p.evaluate(() => window.__rd.debug());
    ok(maxAnims === 0 && sweeps === 0 && d.svgNodes > 20, `reduced motion: no animation running, no sweep, symbols still drawn (${d.svgNodes})`);
    await p.goto(`${BASE}/readerdev.html?fx=${FX}&speed=10&load=80&hold&bare`);
    await p.waitForFunction(() => window.__harness?.start);
    await p.evaluate(() => window.__harness.start());
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${OUT}/reduced-motion.png` });
    await ctx.close();
  }

  // Throttled CPU (≈ an older phone): long tasks with the main thread 4× slower.
  {
    const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await p.addInitScript(() => {
      window.__long = [];
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (window.__harness?.started) window.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask' }); } catch {}
    });
    await p.goto(`${BASE}/readerdev.html?fx=${FX}&speed=4&stop=140&bare`);
    await p.waitForFunction(() => window.__harness?.stopped, null, { timeout: 180000 });
    await p.waitForTimeout(2000);
    const long = await p.evaluate(() => window.__long);
    const max = Math.max(0, ...long);
    console.log(`info  4× CPU throttle, 4× replay to event 140: ${long.length} long tasks, max ${max} ms (${long.slice(0, 8).join(',')})`);
    if (process.env.STRICT) ok(max <= 120, `4× slower CPU: no long task over 120 ms (max ${max})`);
    await ctx.close();
  }
  await b.close();
}

// One screenshot per stage, at 1× (each from a fast-forward to just before it, then live).
const STAGES = {
  greensleeves: [
    ['01-pages', 0, 2300], ['02-engine', 10, 1500], ['03-binary', 16, 420], ['04-grid', 19, 1950],
    ['05-clefs', 21, 720], ['06-heads', 41, 2300], ['07-stems', 46, 560], ['08-words', 61, 1950],
    ['09-lyrics', 62, 650], ['10-notes', 97, 2050], ['11-page2', 101, 1700], ['12-xml', 367, 4700], ['13-fix', 370, 700], ['14-done', 374, 2400],
  ],
};
STAGES['greensleeves-trace'] = [['t1-grid', 19, 900], ['t2-heads', 47, 3500], ['t3-reduction', 56, 260], ['t4-notes', 99, 1400]];
// The real recorded run (importresume.cjs full → importfixture.mjs): Chromium, 4 pages, 276 s.
STAGES['greensleeves3-real'] = [
  ['r01-pages', 0, 2700], ['r02-engine', 8, 2500], ['r03-binary', 16, 700], ['r04-grid', 19, 1400],
  ['r05-clefs', 25, 900], ['r06-beams', 35, 900], ['r07-heads', 47, 4000], ['r08-reduction', 56, 600],
  ['r09-words', 66, 1800], ['r10-symbols', 89, 900], ['r11-notes', 100, 1800], ['r12-page2', 105, 2200],
  ['r13-export', 292, 1500], ['r14-done', 293, 9000],
];
async function gallery() {
  const list = process.env.GALLERY ? process.env.GALLERY.split(',') : [...new Set([FX, 'greensleeves-trace', 'greensleeves3-real'])];
  for (const fx of list) await gallery1(fx);
}
async function gallery1(FX) {
  const stages = STAGES[FX];
  if (!stages) return;
  const b = await chromium.launch();
  for (const v of VIEWS.filter((x) => !process.env.VIEW || x.name === process.env.VIEW)) {
    const ctx = await b.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: 2, isMobile: v.mobile, hasTouch: v.mobile });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    for (const [name, load, wait] of stages) {
      await p.goto(`${BASE}/readerdev.html?fx=${FX}&speed=1&load=${load}&bare`);
      await p.waitForFunction(() => window.__harness?.started, null, { timeout: 60000 });
      await p.waitForTimeout(wait);
      await p.screenshot({ path: `${OUT}/${v.name}-${name}.png` });
    }
    ok(errs.length === 0, `gallery ${v.name}: ${stages.length} stages shot, no errors ${errs.slice(0, 2).join(' | ')}`);
    await ctx.close();
  }
  await b.close();
}

(async () => {
  await unit();
  if (process.env.ONLY !== 'gallery') await browser();
  if (process.env.SHOTS !== '0') await gallery();
  console.log(`\n${pass} passed, ${fail} failed · shots in ${OUT}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
