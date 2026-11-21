// One check per finding of the v81 import review (PDF → Song: the Reader, the resumable importer,
// the nav pill, the job store). Each fails on the build before the fixes and passes after:
//   node importfixes.cjs                         the working tree (http://localhost:8097, ROOT = the repo's public/)
//   BASE=http://localhost:8098 ROOT=<presite>/resonate node importfixes.cjs     the build before the fixes
//   ONLY=A,C,F node importfixes.cjs              some of them
// No real engine: the worker is replaced by a script that posts what the real one would (log lines,
// trace blocks from fixtures/trace, milestones, export progress, a book, the MusicXML) — so a
// conversion, a resume, an export or a crash loop takes seconds. Synthetic PDFs only (fixtures/import:
// greensleeves3, amazing-grace1, nostaff, locked, garbage).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:8097';
const ROOT = process.env.ROOT || '/home/user/resonate/public';
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const FX = '/home/user/tools/fixtures';
const OUT = process.env.OUT || '/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/fixes/out';
fs.mkdirSync(OUT, { recursive: true });

let fails = 0, passes = 0;
const results = [];
function ok(id, c, msg) {
  console.log(`${c ? 'ok  ' : 'FAIL'} [${id}] ${msg}`);
  results.push({ id, ok: !!c, msg });
  if (c) passes++; else fails++;
}
const want = (id) => !ONLY || ONLY.has(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// --- fixtures -----------------------------------------------------------------------------------
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
const REC = JSON.parse(fs.readFileSync(`${FX}/import/greensleeves3.events.json`, 'utf8')).events;
const PRE = REC.slice(1, REC.findIndex((e) => e.t === 'phase' && e.phase === 'engine'));
function sheetEvents(s) {
  const a = REC.findIndex((e) => e.t === 'sheet' && e.s === s && e.state === 'start');
  const b = REC.findIndex((e) => e.t === 'sheet' && e.s === s && e.state === 'done');
  return REC.slice(a, b + 1);
}
const GS_MUSIC = REC.filter((e) => e.t === 'page' && e.music).map((e) => ({ page: e.page, s: e.s, w: e.w, h: e.h }));

// A worker script that replays steps: ['post', msg] ['log', line] ['trace', block] ['wait', ms]
// ['book', s, base64] ['done', base64 mxl] ['error', message] ['hang'].
function fakeWorker(steps) {
  return `
const STEPS = ${JSON.stringify(steps)};
const buf = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;
self.onmessage = async (e) => {
  if (e.data.type !== 'run') return;
  for (const st of STEPS) {
    const [k, a, b] = st;
    if (k === 'wait') await new Promise((r) => setTimeout(r, a));
    else if (k === 'post') self.postMessage(a);
    else if (k === 'log') self.postMessage({ type: 'log', line: a });
    else if (k === 'trace') self.postMessage({ type: 'trace', block: a });
    else if (k === 'book') { const bytes = buf(b); self.postMessage({ type: 'book', s: a, bytes, ms: 3 }, [bytes]); }
    else if (k === 'done') { const m = buf(a); self.postMessage({ type: 'done', mxls: [m] }, [m]); return; }
    else if (k === 'error') { self.postMessage({ type: 'error', message: a }); return; }
    else if (k === 'hang') return;
    await new Promise((r) => setTimeout(r, 15));
  }
};`;
}
const MILESTONES = [['post', { type: 'engine', milestone: 'fetch' }], ['post', { type: 'engine', milestone: 'jvm' }],
  ['log', 'INFO  [score]                       Main 280  | Audiveris'], ['post', { type: 'engine', milestone: 'start' }],
  ['post', { type: 'engine', milestone: 'font', detail: '156 glyphs' }]];
const AG_MXL = b64(`${FX}/trace/amazing-grace.mxl`), GS_MXL = b64(`${FX}/trace/greensleeves.mxl`), GS_BOOK = b64(`${FX}/import/greensleeves3-skip2.omr`);
const exportSteps = (sheets) => sheets.flatMap((s) => [
  ['log', `INFO  [greensleeves3]          SheetStub 1055 | Loaded /sheet#${s}/sheet#${s}.xml`], ['post', { type: 'export', at: 'sheet', s }], ['wait', 600]]);
const SC = {
  agFull: [...MILESTONES, ...traceBlocks(`${FX}/trace/amazing-grace.trace`).map((b) => ['trace', b]),
    ['log', 'INFO  [score] PartwiseBuilder 2707 | Exporting sheet(s): [#1]'], ['post', { type: 'export', at: 'write' }],
    ['log', 'INFO  [score] Score 1 | Score score exported to /files/x/score.mxl'], ['done', AG_MXL]],
  hidden: [...MILESTONES, ['trace', 'K 3 - -'], ['trace', 'B 1 LOAD'], ['wait', 1500], ['trace', 'S 1 100'], ['wait', 1500], ['trace', 'B 2 LOAD'], ['hang']],
  race: [...MILESTONES, ['trace', 'K 3 - -'], ['trace', 'B 1 LOAD'], ['wait', 300], ['trace', 'S 1 88'], ['book', 1, GS_BOOK], ['hang']],
  running: [...MILESTONES, ['trace', 'K 3 - -'], ['trace', 'B 1 LOAD'], ['hang']],
  exportAll: [...MILESTONES, ['wait', 300], ...exportSteps([1, 3]),
    ['log', 'INFO  [greensleeves3]    PartwiseBuilder 2707 | Exporting sheet(s): [#1#3]'], ['post', { type: 'export', at: 'write' }], ['wait', 400],
    ['log', 'INFO  [greensleeves3] Score 1 | Score greensleeves3 exported to /files/x/greensleeves3.mxl'], ['done', GS_MXL]],
  exportHang: [...MILESTONES, ['wait', 300], ...exportSteps([1]), ['hang']],
  unread: [...MILESTONES, ['trace', 'K 1 - -'], ['trace', 'B 1 LOAD'], ['trace', 'B 1 SCALE'],
    ['log', 'WARN  [amazing-grace1]  SheetStub 1 | Sheet#1 failed at SCALE: No regularly spaced lines found'],
    ['trace', 'F 1 SCALE No%20regularly%20spaced%20lines%20found'], ['trace', 'S 1 50'],
    ['error', 'Audiveris finished without producing MusicXML — see the log for details.']],
  unreadAgain: [...MILESTONES, ['wait', 200], ['error', 'Audiveris finished without producing MusicXML — see the log for details.']],
};

// --- browser ------------------------------------------------------------------------------------
let browser;
async function ctxFor({ scenario = null, viewport = { width: 820, height: 1180 }, mobile = false, init = null } = {}) {
  const ctx = await browser.newContext({ viewport, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  if (scenario) await ctx.route('**/omr/omr-worker.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: fakeWorker(SC[ctx.__sc || scenario]) }));
  ctx.setScenario = (s) => { ctx.__sc = s; };
  if (init) await ctx.addInitScript(init);
  return ctx;
}
async function page(ctx, url) {
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  if (url) await p.goto(BASE + url);
  return p;
}
const dbg = (p) => p.evaluate(() => {
  const d = window.resonateDebug?.() || {};
  return {
    state: d.import?.state, stage: d.stage, mode: d.readerDebug?.mode, events: (d.eventList || []).map((e) => e.t + (e.phase ? ':' + e.phase : '') + (e.state ? ':' + e.state : '') + (e.s ? ':' + e.s : '')),
    err: document.getElementById('error')?.hidden ? '' : document.getElementById('error-msg')?.textContent,
    pick: !document.getElementById('pick')?.hidden && getComputedStyle(document.getElementById('pick')).display !== 'none',
    flag: localStorage.getItem('resonate.import'), bar: document.getElementById('job-bar')?.hidden === false ? document.getElementById('job-msg').textContent : null,
    done: !document.getElementById('result')?.hidden,
  };
}).catch((e) => ({ fail: e.message }));
async function until(p, pred, ms = 30000) {
  const end = Date.now() + ms;
  let d = null;
  while (Date.now() < end) { d = await dbg(p); if (pred(d)) return d; await p.waitForTimeout(250); }
  return d;
}
const jobs = (p) => p.evaluate(async () => (await (await import('/resonate/omr/jobs.js?v=80')).listJobs()).map((j) => ({ id: j.id, phase: j.phase, stage: j.stage, starts: j.starts, lefts: j.lefts, db: j.db, space: j.space })));

// A stored greensleeves3 job (title page + 3 music pages) as a run would have left it: the PDF, the
// pre-engine events and each sheet's, the book after sheet 3 (sheets 1, 3 read, 2 given up on).
async function seedJob(p, over = {}) {
  return p.evaluate(async ({ PRE, SHEETS, MUSIC, BOOK, over }) => {
    const J = await import('/resonate/omr/jobs.js?v=80');
    const { ENGINE } = await import('/resonate/omr/omr.js?v=80');
    const sp = await import('/resonate/space.js?v=80');
    const id = J.newId();
    const pdf = await (await fetch('/imp/greensleeves3.pdf')).arrayBuffer();
    const book = Uint8Array.from(atob(BOOK), (c) => c.charCodeAt(0)).buffer;
    const job = {
      id, space: sp.activeSpace(), db: sp.dbName(), name: 'greensleeves3.pdf', size: pdf.byteLength, engine: ENGINE, app: 'test',
      created: Date.now() - 60000, phase: 'export', music: MUSIC, of: 4, title: 'Greensleeves', tempo: null,
      done: [1, 2, 3], failed: [{ sheet: 2, page: 3, step: 'SCALE', reason: 'test' }], starts: {}, lefts: {}, fails: {}, runs: 1, skip: [], ...over,
    };
    await J.putData(id, 'pdf', pdf);
    await J.putData(id, 'book', { s: 3, done: [1, 2, 3], bytes: book });
    await J.saveEvents(id, 'pre', PRE);
    for (const [s, evs] of Object.entries(SHEETS)) await J.saveEvents(id, String(s), evs);
    await J.putJob(job);
    J.setFlag(job);
    return id;
  }, { PRE, SHEETS: { 1: sheetEvents(1), 2: sheetEvents(2), 3: sheetEvents(3) }, MUSIC: GS_MUSIC, BOOK: GS_BOOK, over });
}
async function crash(p) {
  const cdp = await p.context().newCDPSession(p);
  await Promise.race([cdp.send('Page.crash').catch(() => {}), wait(3000)]); // (never answers: the page is gone)
  await wait(1000);
}

// ============================================================================================
(async () => {
  const pathToURL = (f) => 'file://' + path.join(ROOT, f);
  const T = await import(pathToURL('omr/trace.js'));
  const R = await import(pathToURL('omr/readerstate.js'));

  // A — a page the engine gave up on stays failed (F then S: stored as invalid, not read)
  if (want('A')) {
    const t = T.createTrace();
    const evs = [];
    for (const b of ['K 2 - -', 'B 1 LOAD', 'E 1 LOAD 3\nd 2550 3300', 'B 1 SCALE', 'F 1 SCALE No%20regularly%20spaced%20lines%20found', 'S 1 152', 'B 2 LOAD', 'S 2 9000']) evs.push(...t.block(b));
    const st = R.reduceAll([{ t: 'page', page: 1, of: 2, w: 2550, h: 3300, music: true, blank: false, s: 1, preview: null, staves: [] },
      { t: 'page', page: 2, of: 2, w: 2550, h: 3300, music: true, blank: false, s: 2, preview: null, staves: [] }, ...evs]);
    const c = R.counts(st);
    ok('A', st.sheets[1].state === 'failed' && c.failed === 1 && R.pageProgress(st, 1).state === 'failed' && !evs.some((e) => e.t === 'sheet' && e.s === 1 && e.state === 'done'),
      `F 1 then S 1: sheet 1 ${st.sheets[1].state}, failed ${c.failed}, rail ${R.pageProgress(st, 1).state}`);
    const st2 = R.reduceAll([{ t: 'sheet', s: 1, state: 'start' }, { t: 'sheet', s: 1, state: 'failed', reason: 'x', step: 'SCALE' }, { t: 'sheet', s: 1, state: 'done', ms: 5 }]);
    ok('A', st2.sheets[1].state === 'failed' && st2.sheets[1].reason === 'x', `a stored failed→done stays failed with its reason (${st2.sheets[1].state}, ${st2.sheets[1].reason})`);
  }

  // B — measures the export couldn't write leave the Reader (and the result names them)
  if (want('B')) {
    const t = T.createTrace();
    t.block('B 2 LOAD');
    t.block('G 2 1\ny 1 356 338 2360 753\nf 1 1 1 356 2359 338 338 357 357 375 375 394 394 413 413\nf 1 2 2 356 2359 508 508 527 527 546 546 564 564 583 583');
    const n = t.block('N 2 1\nn 1 3 1 1 0/1 1/4 5,100,340,A,0,4\nn 2 3 2 1 0/1 1/4 6,100,520,C,0,3\nn 3 4 1 1 0/1 1/4 7,200,340,B,0,4')[0];
    const line = 'WARN  [skew35b]           PartwiseBuilder 2229 | Error visiting Measure{#3P1} in {Page#2.1}';
    const out = typeof t.exportLost === 'function' ? t.exportLost(line) : [];
    const notes = out[0]?.notes || [];
    ok('B', n?.notes?.length === 3 && out.length === 1 && notes.length === 2 && !notes.some((x) => x.m === '3' && x.step === 'A'),
      `"Error visiting Measure{#3P1}": part 1's notes of bar 3 leave, part 2's stay (${JSON.stringify(notes.map((x) => x.m + x.step))})`);
    const src = fs.readFileSync(path.join(ROOT, 'omr/omr.js'), 'utf8');
    ok('B', /lostMeasures/.test(src) && /lost:/.test(src), 'convertPdf reports the lost measures (res.lost)');
  }

  // D — measure numbers as the export writes them (page 2 continues after page 1's last bar)
  if (want('D')) {
    const t = T.createTrace();
    const evs = traceBlocks(`${FX}/trace/greensleeves.trace`).flatMap((b) => t.block(b));
    const st = R.reduceAll(evs);
    const off = R.measureOffset ? R.measureOffset(st, 2) : 0;
    const sys = Object.keys(st.sheets[2].notes)[0];
    const first = R.noteLines(st.sheets[2].notes[sys], null, { offset: off }).find((x) => x.m != null)?.xml;
    const mxl = require('child_process').execSync(`unzip -p ${FX}/trace/greensleeves.mxl '*.xml'`).toString();
    const nums = [...mxl.matchAll(/<measure number="(\d+)"/g)].map((m) => +m[1]);
    ok('D', /number="17"/.test(first || '') && Math.max(...nums) === 66 && (R.measureOffset?.(st, 4) ?? 0) + R.lastMeasureOf?.(st, 4) === 66,
      `sheet 2's first bar: ${first} (the file numbers 1…${Math.max(...nums)})`);
  }

  // R — the done state's code column: excerpts cut after a whole element, never mid-tag
  if (want('R')) {
    const src = fs.readFileSync(path.join(ROOT, 'omr/importer.js'), 'utf8');
    const body = src.slice(src.indexOf('export function excerpts'));
    // eslint-disable-next-line no-new-func
    const excerpts = new Function(`${body.replace('export function', 'function')}; return excerpts;`)();
    const xml = require('child_process').execSync(`unzip -p ${FX}/trace/greensleeves.mxl '*.xml'`).toString();
    const ex = excerpts(xml);
    const bad = ex.filter((e) => /\n…$/.test(e)).map((e) => e.split('\n').at(-2)).filter((l) => !/>\s*$/.test(l) || /<[^>]*$/.test(l));
    ok('R', ex.length >= 2 && ex.some((e) => /\n…$/.test(e)) && !bad.length, `cut excerpts end on a whole line (${bad.length ? 'cut: ' + JSON.stringify(bad) : ex.map((e) => JSON.stringify(e.split('\n').at(-2))).join(' ')})`);
  }

  // W — a stored run reduced in one go doesn't copy each sheet's symbols on every event
  if (want('W')) {
    const evs = [];
    let id = 1;
    for (let s = 1; s <= 13; s++) {
      evs.push({ t: 'sheet', s, state: 'start' });
      for (let k = 0; k < 70; k++) evs.push({ t: 'sym', s, step: 'HEADS', sys: 1, add: Array.from({ length: 12 }, () => ({ id: id++, k: 'head', x: 1, y: 1, w: 2, h: 2 })), del: k % 3 ? [] : [id - 20] });
      evs.push({ t: 'sheet', s, state: 'done', ms: 1000 });
    }
    const one = () => { let st = R.initial(); for (const e of evs) st = R.reduce(st, e); return st; };
    const t0 = performance.now(); const a = R.reduceAll(evs); const t1 = performance.now(); const b = one(); const t2 = performance.now();
    const same = R.sheetList(a).every((sh) => sh.symN === b.sheets[sh.s].symN && Object.keys(sh.syms).length === sh.symN);
    ok('W', same && (t1 - t0) * 3 < (t2 - t1), `reduceAll ${Math.round(t1 - t0)} ms vs event by event ${Math.round(t2 - t1)} ms, same symbols (${same})`);
  }

  // P (unit) — the export reading sheets back moves the bar; the export's page is the hero
  if (want('P')) {
    let st = R.reduceAll([{ t: 'page', page: 1, of: 2, w: 2550, h: 3300, music: true, blank: false, s: 1, preview: null, staves: [] },
      { t: 'page', page: 2, of: 2, w: 2550, h: 3300, music: true, blank: false, s: 2, preview: null, staves: [] },
      { t: 'sheet', s: 1, state: 'start' }, { t: 'sheet', s: 1, state: 'done', ms: 9 }, { t: 'sheet', s: 2, state: 'start' }, { t: 'sheet', s: 2, state: 'done', ms: 9 },
      { t: 'phase', phase: 'export' }]);
    const f0 = R.progress(st);
    st = R.reduce(st, { t: 'export', s: 1 });
    const f1 = R.progress(st), h1 = R.heroOf(st);
    st = R.reduce(st, { t: 'export', s: 2 });
    const f2 = R.progress(st), h2 = R.heroOf(st);
    ok('P', f0 < f1 && f1 < f2 && h1?.page === 1 && h2?.page === 2, `export of sheets 1, 2: progress ${f0.toFixed(3)} → ${f1.toFixed(3)} → ${f2.toFixed(3)}, page ${h1?.page} → ${h2?.page}`);
  }

  // Q (unit) — the engine's download progress updates the milestone's detail
  if (want('Q')) {
    const st = R.reduceAll([{ t: 'engine', milestone: 'fetch' }, { t: 'engine', milestone: 'jvm' }, { t: 'engine', milestone: 'jvm', detail: '↓ 3 MB' }, { t: 'engine', milestone: 'jvm', detail: '↓ 21 MB' }]);
    const src = fs.readFileSync(path.join(ROOT, 'omr/omr-worker.js'), 'utf8');
    ok('Q', st.engine.length === 2 && st.engine[1].detail === '↓ 21 MB' && /transferSize/.test(src),
      `jvm's detail follows the bytes (${JSON.stringify(st.engine.map((m) => m.detail ?? null))}); the worker measures them`);
  }

  browser = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY || 'http://127.0.0.1:9', bypass: 'localhost,127.0.0.1' } });

  // A (page) — the rail of a page given up on reads !, not ✓ (a stored run with F then S)
  // (covered by the reducer above; the Reader draws pageProgress)

  // C + P — a resume whose book has every sheet: phase export, the export's pages, the page breathes
  if (want('C') || want('P')) {
    const ctx = await ctxFor({ scenario: 'exportAll' });
    const p = await page(ctx, '/resonate/tools.html');
    await seedJob(p);
    await p.goto(BASE + '/resonate/pdf-import.html');
    const samples = [];
    const end = Date.now() + 25000;
    let d;
    while (Date.now() < end) {
      d = await dbg(p);
      const look = await p.evaluate(() => ({ lens: document.querySelector('.rd-page')?.dataset.lens, wait: document.querySelector('.rd')?.hasAttribute('data-wait'), phase: document.querySelector('.rd')?.dataset.phase, f: window.resonateDebug?.().fraction })).catch(() => ({}));
      samples.push({ ...look, ev: d.events?.length });
      if (d.done || d.err) break;
      await p.waitForTimeout(150);
    }
    const evs = d.events || [];
    const iExport = evs.indexOf('phase:export'), iClean = evs.indexOf('phase:clean');
    if (want('C')) ok('C', iExport > 0 && iExport < iClean && d.done, `all-done resume: phase export before clean (${evs.filter((e) => /phase|export/.test(e)).join(' ')})`);
    if (want('P')) {
      const ex = samples.filter((x) => x.phase === 'export');
      const fs1 = ex.map((x) => x.f);
      ok('P', evs.includes('export:1') && evs.includes('export:3') && ex.some((x) => x.lens === 'page' && x.wait) && Math.max(...fs1) > Math.min(...fs1),
        `the export: its sheets as events (${evs.filter((e) => /^export/.test(e)).join(',')}), the page breathes (${ex.filter((x) => x.lens === 'page' && x.wait).length}/${ex.length} samples), the bar moves (${Math.min(...fs1).toFixed(3)} → ${Math.max(...fs1).toFixed(3)})`);
    }
    await ctx.close();
  }

  // E — crashes in a stage other than reading a page: the second one stops the auto-resume
  if (want('E')) {
    const ctx = await ctxFor({ scenario: 'exportHang' });
    let p = await page(ctx, '/resonate/tools.html');
    await seedJob(p);
    for (let i = 0; i < 2; i++) {
      await p.goto(BASE + '/resonate/pdf-import.html');
      await until(p, (x) => (x.events || []).includes('export:1'), 20000);
      await p.waitForTimeout(500);
      await crash(p);
      p = await page(ctx);
    }
    await p.goto(BASE + '/resonate/pdf-import.html');
    const d = await until(p, (x) => x.state === 'stuck' || (x.events || []).includes('export:1'), 20000);
    ok('E', d.state === 'stuck' && /Stopped twice/.test(d.bar || ''), `two crashes in the export → ${d.state}, bar "${d.bar}"`);
    await ctx.close();
  }

  // F — a file that can't work again isn't kept: the picker after Try again; a locked PDF said plainly;
  // a resumed book with no readable page names the reason and goes
  if (want('F')) {
    for (const [file, re] of [['garbage.pdf', /can't be read as a PDF|Invalid PDF/], ['locked.pdf', /locked with a password|password/i]]) {
      const ctx = await ctxFor({});
      const p = await page(ctx, `/resonate/pdf-import.html?pdf=/imp/${file}`);
      const d1 = await until(p, (x) => !!x.err, 20000);
      // (Try again reloads the page; here that would start the test hook's ?pdf= again: the page without it.)
      await p.goto(BASE + '/resonate/pdf-import.html');
      await p.waitForTimeout(1500);
      const d2 = await dbg(p);
      ok('F', re.test(d1.err || '') && !d1.flag && d2.pick && !d2.err, `${file}: "${d1.err}"; kept: ${!!d1.flag}; after Try again the picker: ${d2.pick}`);
      await ctx.close();
    }
    {
      const ctx = await ctxFor({ scenario: 'unread' });
      const p = await page(ctx, '/resonate/pdf-import.html?pdf=/imp/amazing-grace1.pdf');
      const d1 = await until(p, (x) => !!x.err, 30000);
      const left = await jobs(p);
      ok('F', /No page could be read \(page 1, SCALE/.test(d1.err || '') && !left.length && !d1.flag, `no page read: "${d1.err}", jobs kept ${left.length}`);
      await ctx.close();
    }
    {
      const ctx = await ctxFor({ scenario: 'unreadAgain' });
      const p = await page(ctx, '/resonate/tools.html');
      await seedJob(p, { phase: 'read', done: [1, 2, 3], failed: [{ sheet: 1, page: 2, step: 'SCALE', reason: 'No regularly spaced lines found' }] });
      await p.goto(BASE + '/resonate/pdf-import.html');
      const d1 = await until(p, (x) => !!x.err, 30000);
      const left = await jobs(p);
      ok('F', /No page could be read \(page 2, SCALE: No regularly/.test(d1.err || '') && !left.length, `a resumed book with no readable page: "${d1.err}", kept ${left.length}`);
      await ctx.close();
    }
  }

  // G — hidden while sheet 1 read, the run moves on to sheet 2: an end now is sheet 2's
  if (want('G')) {
    const ctx = await ctxFor({ scenario: 'hidden' });
    const p = await page(ctx, '/resonate/pdf-import.html?pdf=/imp/greensleeves3.pdf');
    await until(p, (x) => (x.events || []).includes('sheet:start:1'), 30000);
    await p.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await until(p, (x) => (x.events || []).includes('sheet:start:2'), 15000);
    await p.waitForTimeout(300);
    const left = await p.evaluate(() => JSON.parse(localStorage.getItem('resonate.import.left') || 'null'));
    ok('G', (left?.stage ?? (left?.s != null ? String(left.s) : null)) === '2', `hidden in sheet 1, now in sheet 2: left = ${JSON.stringify(left)}`);
    await ctx.close();
  }

  // H — the head's flag was another space's (nav.js parked the account first): the picker, not a blank page
  if (want('H')) {
    const ctx = await ctxFor({ init: () => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('resonate.space', JSON.stringify({ active: 'uid-x', db: { 'uid-x': 'resonate-uid-x', anon: 'resonate' } }));
      localStorage.setItem('resonate.import', JSON.stringify({ id: 'job1', space: 'uid-x', db: 'resonate-uid-x', name: 'a.pdf', done: 1, of: 3, at: Date.now() }));
    } });
    const p = await page(ctx, '/resonate/pdf-import.html');
    await p.waitForTimeout(2500);
    const d = await dbg(p);
    const sp = await p.evaluate(() => JSON.parse(localStorage.getItem('resonate.space')).active);
    ok('H', sp === 'anon' && d.pick, `parked on load (active ${sp}): the picker shows (${d.pick})`);
    await ctx.close();
  }

  // I, J, K, L, V — the job store and the spaces (no engine)
  if (['I', 'J', 'K', 'L', 'V'].some(want)) {
    const ctx = await ctxFor({});
    const p = await page(ctx, '/resonate/tools.html');
    await p.evaluate(() => { localStorage.clear(); });
    await p.reload();
    if (want('I')) {
      const r = await p.evaluate(async () => {
        const J = await import('/resonate/omr/jobs.js?v=80');
        const sp = await import('/resonate/space.js?v=80');
        const { createImporter } = await import('/resonate/omr/importer.js?v=80');
        sp.ensureSpace(null);
        await sp.enter('uid-a');
        const id = J.newId();
        await J.putData(id, 'pdf', new ArrayBuffer(300000));
        await J.putJob({ id, space: 'uid-a', db: sp.dbName(), name: 'licensed.pdf', created: Date.now(), phase: 'read', music: [{ page: 1, s: 1 }], done: [] });
        await sp.leave('uid-a');
        const after = (await J.listJobs()).length;
        await J.putData('jorphan', 'pdf', new ArrayBuffer(1000));
        await createImporter({}).pending();
        const orphan = await J.getData('jorphan', 'pdf');
        return { after, orphan: !!orphan, active: sp.activeSpace() };
      });
      ok('I', r.active === 'anon' && r.after === 0 && !r.orphan, `Sign out (leave): the account's import gone (${r.after} left); data with no job dropped (${!r.orphan})`);
    }
    if (want('J')) {
      const r = await p.evaluate(async () => {
        localStorage.clear();
        const J = await import('/resonate/omr/jobs.js?v=80');
        const sp = await import('/resonate/space.js?v=80');
        const { createImporter } = await import('/resonate/omr/importer.js?v=80');
        for (const j of await J.listJobs()) await J.deleteJob(j.id);
        sp.ensureSpace(null);
        const id = J.newId();
        const job = { id, space: 'anon', db: sp.dbName(), name: 'a.pdf', created: Date.now(), phase: 'read', music: [{ page: 1, s: 1 }], done: [], of: 1 };
        await J.putData(id, 'pdf', new ArrayBuffer(10));
        await J.putJob(job); J.setFlag(job);
        sp.adopt('uid-new');
        const pend = await createImporter({}).pending();
        return { pend: pend?.id === id, flag: !!localStorage.getItem('resonate.import'), active: sp.activeSpace() };
      });
      ok('J', r.active === 'uid-new' && r.pend && r.flag, `signed up mid-import: the new account's import (${r.pend}), its flag kept (${r.flag})`);
    }
    if (want('K')) {
      const r = await p.evaluate(async () => {
        const J = await import('/resonate/omr/jobs.js?v=80');
        localStorage.setItem('resonate.parked.uid-p', JSON.stringify({ 'resonate.import': JSON.stringify({ id: 'jpark', space: 'uid-p', done: 1, of: 2 }), 'resonate.sing.song': 's1' }));
        localStorage.setItem('resonate.shelf', JSON.stringify({ 'resonate.import': JSON.stringify({ id: 'jpark', space: 'anon' }) }));
        await J.deleteJob('jpark');
        return { parked: JSON.parse(localStorage.getItem('resonate.parked.uid-p')), shelf: JSON.parse(localStorage.getItem('resonate.shelf')) };
      });
      ok('K', !r.parked['resonate.import'] && r.parked['resonate.sing.song'] === 's1' && !r.shelf['resonate.import'], `a deleted job's flag leaves the parked and shelved copies (${JSON.stringify(r)})`);
    }
    if (want('L')) {
      const id = await seedJob(p, { engine: 'older-engine', phase: 'read' });
      const r = await p.evaluate(async (id) => {
        const { createImporter } = await import('/resonate/omr/importer.js?v=80');
        return (await createImporter({}).storedEvents(id)).map((e) => e.t);
      }, id);
      ok('L', r.length === 1 && r[0] === 'job', `a job another engine made: stored events shown = ${r.length} (${[...new Set(r)].join(',')})`);
    }
    if (want('V')) {
      const id = await seedJob(p);
      const r = await p.evaluate(async (id) => {
        const J = await import('/resonate/omr/jobs.js?v=80');
        const seen = [];
        const orig = IDBObjectStore.prototype.openCursor;
        IDBObjectStore.prototype.openCursor = function (range, ...a) { seen.push(range?.lower); return orig.call(this, range, ...a); };
        const n = (await J.loadEvents(id)).length;
        IDBObjectStore.prototype.openCursor = orig;
        return { n, seen };
      }, id);
      ok('V', r.n > 10 && r.seen.length && r.seen.every((l) => String(l).endsWith('|ev|')), `loadEvents' cursor starts at ${JSON.stringify(r.seen)} (${r.n} events)`);
    }
    await ctx.close();
  }

  // M — the pill elsewhere says paused and counts as the Reader; leaving from the header asks
  if (want('M') || want('O')) {
    const ctx = await ctxFor({ scenario: 'running' });
    const p = await page(ctx, '/resonate/tools.html');
    await p.evaluate(() => localStorage.clear());
    await p.reload();
    await seedJob(p, { phase: 'read', done: [1], stage: '2' });
    if (want('M')) {
      await p.goto(BASE + '/resonate/sing.html');
      await p.waitForTimeout(1500);
      const pill = await p.evaluate(() => document.getElementById('import-pill')?.textContent || null);
      ok('M', /⏸/.test(pill || '') && /3\/4/.test(pill || ''), `the Sing page's pill: "${pill}" (paused, PDF page 3 of 4 as the Reader counts)`);
    }
    if (want('O')) {
      await p.evaluate(() => localStorage.setItem('resonate.import.min', '1'));
      // (the pill names the shell's place for the import since cleanup C 3.1: ./?open=import — the tray
      // resumes it, shown; pdf-import.html, Tools' PDF → Song, keeps the minimized pref for a reload)
      const href = await p.getAttribute('#import-pill', 'href');
      await p.click('#import-pill');
      await p.waitForURL((u) => u.pathname === '/resonate/');
      let d0 = null;
      for (let i = 0; i < 40 && d0?.mode !== 'open'; i++) { await p.waitForTimeout(250); d0 = await p.evaluate(() => window.resonateDebug?.().import || null).catch(() => null); }
      await p.goto(BASE + '/resonate/pdf-import.html');
      await p.waitForTimeout(1500);
      const d1 = await dbg(p);
      await p.reload();
      await p.waitForTimeout(1500);
      const d2 = await dbg(p);
      ok('O', href === './?open=import' && d0?.mode === 'open' && d1.mode === 'open' && d2.mode === 'min',
        `from the pill (${href}): the shell's Reader ${d0?.mode}; pdf-import.html from a link: ${d1.mode}; a reload: ${d2.mode} (the singer's minimized pref)`);
    }
    await ctx.close();
  }
  if (want('M')) {
    const ctx = await ctxFor({ scenario: 'running' });
    const p = await page(ctx, '/resonate/pdf-import.html?pdf=/imp/greensleeves3.pdf');
    await until(p, (x) => (x.events || []).includes('sheet:start:1'), 30000);
    await p.waitForTimeout(500);
    let asked = null;
    p.once('dialog', (dl) => { asked = dl.message(); dl.dismiss(); });
    await p.click('header a[href="sing.html"]').catch(() => {});
    await p.waitForTimeout(1000);
    ok('M', !!asked && /pdf-import/.test(p.url()), `the header's Sing link while it reads: asked "${asked}", stayed (${/pdf-import/.test(p.url())})`);
    await ctx.close();
  }

  // N — the facts row on an iPhone: the step's name whole, its quiet clock in sight
  if (want('N')) {
    const ctx = await ctxFor({ viewport: { width: 393, height: 852 }, mobile: true });
    const p = await page(ctx, '/resonate/pdf-import.html');
    const r = await p.evaluate(async ({ REC }) => {
      for (const id of ['pick', 'warning']) document.getElementById(id).hidden = true;
      document.querySelector('main').classList.add('reading');
      const host = document.getElementById('reader-host');
      host.hidden = false;
      const { mount } = await import('/resonate/omr/reader.js?v=80');
      const rd = mount(host, { onStop: () => {} });
      const upto = REC.findIndex((e, i) => e.t === 'step' && e.s === 2 && e.step === 'HEADS');
      const evs = REC.slice(0, upto + 1).map((e) => ({ ...e }));
      const shift = Date.now() - 25000 - evs.at(-1).at;
      for (const e of evs) { e.at += shift; if (e.t === 'page' && typeof e.preview === 'string') e.preview = null; }
      for (const e of evs) rd.push(e); // (live: a stored run's clocks are stopped, load() would show none)
      await new Promise((res) => setTimeout(res, 2500));
      const step = document.querySelector('.rd-step'), q = document.querySelector('.rd-q'), facts = document.querySelector('.rd-facts');
      const fr = facts.getBoundingClientRect(), qr = q?.getBoundingClientRect();
      return { text: facts.textContent, shown: [...facts.children].filter((x) => !x.hidden && getComputedStyle(x).display !== 'none').map((x) => x.textContent).join(' · '), stepCut: step.scrollWidth > step.clientWidth + 1, q: !!q, qIn: !!qr && qr.right <= fr.right + 0.5 && qr.width > 0 && getComputedStyle(q).display !== 'none' };
    }, { REC });
    await p.locator('.rd-top').screenshot({ path: path.join(OUT, `facts-${new URL(BASE).port}.png`) }).catch(() => {});
    ok('N', !r.stepCut && r.q && r.qIn, `iPhone, 25 s into note heads: "${r.text}" (shown: ${r.shown}) — step whole ${!r.stepCut}, its clock shown ${r.qIn}`);
    await ctx.close();
  }

  // S, U — reveals don't animate SVG children; an expand doesn't land every thumbnail again
  if (want('S') || want('U')) {
    const ctx = await ctxFor({ viewport: { width: 393, height: 852 }, mobile: true });
    if (want('S')) {
      const p = await page(ctx, '/readerdev.html?fx=greensleeves3-real&speed=3&bare&load=45');
      await p.waitForFunction(() => window.__harness && window.__rd, null, { timeout: 15000 });
      await p.evaluate(() => window.__harness.start?.());
      const r = await p.evaluate(async () => {
        let svgAnim = 0, n = 0;
        const end = performance.now() + 12000;
        while (performance.now() < end) {
          const a = document.getAnimations().filter((x) => x.playState === 'running' && x.effect?.target instanceof SVGElement);
          if (a.length) svgAnim++;
          n++;
          await new Promise((res) => setTimeout(res, 100));
        }
        return { svgAnim, n, drawn: window.__rd.debug().beats };
      });
      ok('S', r.n > 50 && r.svgAnim / r.n < 0.02 && r.drawn > 5, `12 s of reading at 3×: an SVG child animating in ${r.svgAnim} of ${r.n} samples (${r.drawn} events drawn)`);
      await p.close();
    }
    if (want('U')) {
      const p = await page(ctx, '/readerdev.html?fx=greensleeves3-real&speed=40&bare&stop=150');
      await p.waitForFunction(() => window.__harness?.stopped, null, { timeout: 60000 });
      await p.waitForTimeout(1500);
      const r = await p.evaluate(async () => {
        window.__rd.minimize();
        await new Promise((res) => setTimeout(res, 400));
        window.__rd.expand();
        await new Promise((res) => setTimeout(res, 80));
        return document.getAnimations().filter((a) => a.animationName === 'rd-land' && a.effect?.target?.classList?.contains('rd-th')).length;
      });
      ok('U', r === 0, `minimize → expand: thumbnails landing again: ${r}`);
      await p.close();
    }
    await ctx.close();
  }

  // T — the screen wake lock goes when an import ends in an error
  if (want('T')) {
    const ctx = await ctxFor({ init: () => {
      window.__wake = { requested: 0, released: 0, live: 0 };
      Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => {
        window.__wake.requested++; window.__wake.live++;
        const ls = [];
        const s = { released: false, addEventListener: (t, f) => ls.push(f), release: async () => { if (!s.released) { s.released = true; window.__wake.released++; window.__wake.live--; ls.forEach((f) => f()); } } };
        return s;
      } } });
    } });
    const p = await page(ctx, '/resonate/pdf-import.html?pdf=/imp/nostaff.pdf');
    const d = await until(p, (x) => !!x.err, 20000);
    await p.waitForTimeout(800);
    const w = await p.evaluate(() => window.__wake);
    ok('T', !!d.err && w.requested >= 1 && w.live === 0, `"${d.err}": wake lock ${JSON.stringify(w)}`);
    await ctx.close();
  }

  // X — the pill sits under the pages' sheets and moves off controls that show later
  if (want('X')) {
    const ctx = await ctxFor({ viewport: { width: 393, height: 852 }, mobile: true, init: () => {
      localStorage.setItem('resonate.import', JSON.stringify({ id: 'jx', space: 'anon', db: 'resonate', name: 'a.pdf', done: 1, of: 3, page: 3, pages: 4, at: Date.now() }));
    } });
    const p = await page(ctx, '/resonate/sing.html');
    await p.waitForTimeout(2500);
    await p.click('#options-btn').catch(() => {});
    await p.waitForTimeout(500);
    const r1 = await p.evaluate(() => {
      const a = document.getElementById('import-pill');
      if (!a) return { pill: false };
      const r = a.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { pill: true, topIsPill: top === a || a.contains(top), sheet: !document.getElementById('options')?.hidden };
    });
    ok('X', r1.pill && r1.sheet && !r1.topIsPill, `Sing's options open: the pill under the sheet (top at its centre is the pill: ${r1.topIsPill})`);
    const p2 = await page(ctx, '/resonate/tools.html');
    await p2.waitForTimeout(2200);
    const r2 = await p2.evaluate(async () => {
      const a = document.getElementById('import-pill');
      const r = a.getBoundingClientRect();
      const b = document.createElement('button');
      b.textContent = 'late'; b.hidden = true;
      b.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;z-index:1`;
      document.body.append(b);
      await new Promise((res) => setTimeout(res, 100));
      b.hidden = false;
      await new Promise((res) => setTimeout(res, 900));
      const q = a.getBoundingClientRect(), c = b.getBoundingClientRect();
      return !(q.left < c.right && q.right > c.left && q.top < c.bottom && q.bottom > c.top);
    });
    ok('X', r2, `a control shown later where the pill was: the pill moved off it (${r2})`);
    await ctx.close();
  }

  // Y — a song is saved with its PDF even when the job store couldn't keep the import
  if (want('Y')) {
    const ctx = await ctxFor({ scenario: 'agFull', init: () => {
      const orig = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (name, ...a) { if (name === 'resonate-imports') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); return orig.call(this, name, ...a); };
    } });
    const p = await page(ctx, '/resonate/pdf-import.html?pdf=/imp/amazing-grace1.pdf');
    const d = await until(p, (x) => x.done || !!x.err, 40000);
    const r = await p.evaluate(async () => {
      const lib = await import('/resonate/library.js?v=80');
      const id = localStorage.getItem('resonate.sing.song');
      const pdf = await lib.getPdf?.(id);
      return { id, pdf: !!pdf, bytes: pdf?.bytes?.byteLength ?? pdf?.byteLength ?? pdf?.data?.byteLength ?? null };
    });
    ok('Y', d.done && r.pdf, `saved with the job store refused: song ${r.id}, its PDF ${r.pdf ? 'kept' : 'missing'}`);
    await ctx.close();
  }

  // Z — ✕ while a sheet's book is being checked/stored: nothing written back
  if (want('Z')) {
    const ctx = await ctxFor({ scenario: 'race' });
    await ctx.route('**/__importharness.html', (r) => r.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset="utf-8"><body><script type="module">
      const { createImporter } = await import('/resonate/omr/importer.js?v=80');
      const J = await import('/resonate/omr/jobs.js?v=80');
      window.__out = { log: [] };
      let id = null;
      const imp = createImporter({ app: 'test', onEvent: (e) => { if (e.t === 'job') id = e.id; }, onLog: (l) => {
        window.__out.log.push(l);
        if (/book after sheet 1/.test(l)) setTimeout(async () => { await imp.discard(id); window.__out.discarded = true;
          setTimeout(async () => { window.__out.jobs = (await J.listJobs()).length; window.__out.flag = localStorage.getItem('resonate.import'); window.__out.done = true; }, 1500); }, 0);
      } });
      const b = await (await fetch('/imp/greensleeves3.pdf')).blob();
      imp.start(new File([b], 'greensleeves3.pdf', { type: 'application/pdf' })).catch(() => {});
    </script>` }));
    const p = await page(ctx, '/__importharness.html');
    await p.waitForFunction(() => window.__out?.done, null, { timeout: 40000 }).catch(() => {});
    const r = await p.evaluate(() => window.__out);
    ok('Z', r?.done && r.jobs === 0 && !r.flag, `✕ while the book after sheet 1 was being kept: jobs ${r?.jobs}, flag ${r?.flag}`);
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, `importfixes-${new URL(BASE).port}.json`), JSON.stringify(results, null, 1));
  console.log(`${passes} passed, ${fails} failed (${BASE})`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
