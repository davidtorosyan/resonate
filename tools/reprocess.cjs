// Reprocess a song from its stored PDF (v88): the song's MusicXML replaced under the same id.
//   node reprocess.cjs                 (http://localhost:8097, the working tree)
//   ONLY=page,reload,deleted,shell,pages,back node reprocess.cjs
// No engine: the worker is replaced by a script posting what the real one would (importfixes.cjs's
// fakeWorker: trace blocks from fixtures/trace, a book, the MusicXML), so a conversion takes seconds.
// Synthetic PDFs only (fixtures/import: amazing-grace1 = one music page, greensleeves3 = a title page +
// 3 music pages).
const { chromium } = require('playwright');
const fs = require('fs');
const { execSync } = require('child_process');

const BASE = process.env.BASE || 'http://localhost:8097';
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const want = (k) => !ONLY || ONLY.has(k);
const FX = '/home/user/tools/fixtures';
const V = (require('fs').readFileSync('/home/user/resonate/public/shell.html', 'utf8').match(/id="version"[^>]*>v(\d+)</) || [])[1] || '88'; // (the page's own modules: the badge's version)
let passes = 0, fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`); if (c) passes++; else fails++; return c; };

// --- the scripted worker (importfixes.cjs) -------------------------------------------------------
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
    const [k, a, b] = st;
    if (k === 'wait') await new Promise((r) => setTimeout(r, a));
    else if (k === 'post') self.postMessage(a);
    else if (k === 'log') self.postMessage({ type: 'log', line: a });
    else if (k === 'trace') self.postMessage({ type: 'trace', block: a });
    else if (k === 'book') { const bytes = buf(b); self.postMessage({ type: 'book', s: a, bytes, ms: 3 }, [bytes]); }
    else if (k === 'done') { const m = buf(a); self.postMessage({ type: 'done', mxls: [m] }, [m]); return; }
    else if (k === 'hang') return;
    await new Promise((r) => setTimeout(r, 15));
  }
};`;
}
const MILESTONES = [['post', { type: 'engine', milestone: 'fetch' }], ['post', { type: 'engine', milestone: 'jvm' }],
  ['log', 'INFO  [score]                       Main 280  | Audiveris'], ['post', { type: 'engine', milestone: 'start' }],
  ['post', { type: 'engine', milestone: 'font', detail: '156 glyphs' }]];
const AG_MXL = b64(`${FX}/trace/amazing-grace.mxl`), GS_MXL = b64(`${FX}/trace/greensleeves.mxl`), GS_BOOK = b64(`${FX}/import/greensleeves3-skip2.omr`);
const AG_RUN = [...MILESTONES, ...traceBlocks(`${FX}/trace/amazing-grace.trace`).map((b) => ['trace', b]),
  ['log', 'INFO  [score] PartwiseBuilder 2707 | Exporting sheet(s): [#1]'], ['post', { type: 'export', at: 'write' }],
  ['log', 'INFO  [score] Score 1 | Score score exported to /files/x/score.mxl'], ['done', AG_MXL]];
const exportSteps = (sheets) => sheets.flatMap((s) => [
  ['log', `INFO  [greensleeves3]          SheetStub 1055 | Loaded /sheet#${s}/sheet#${s}.xml`], ['post', { type: 'export', at: 'sheet', s }], ['wait', 300]]);
const SC = {
  ag: AG_RUN,
  agSlow: [['wait', 4000], ...AG_RUN],
  gsSheet1: [...MILESTONES, ['trace', 'K 3 - -'], ['trace', 'B 1 LOAD'], ['wait', 300], ['trace', 'S 1 88'], ['book', 1, GS_BOOK], ['hang']],
  gsExport: [...MILESTONES, ['wait', 300], ...exportSteps([1, 3]),
    ['log', 'INFO  [greensleeves3]    PartwiseBuilder 2707 | Exporting sheet(s): [#1#3]'], ['post', { type: 'export', at: 'write' }], ['wait', 300],
    ['log', 'INFO  [greensleeves3] Score 1 | Score greensleeves3 exported to /files/x/greensleeves3.mxl'], ['done', GS_MXL]],
};
// Seeds: a song whose MusicXML is NOT what the PDF converts to (so a replace is visible).
const GS_XML = execSync(`unzip -p ${FX}/trace/greensleeves.mxl greensleeves-th200.xml`).toString();
const AG_XML = fs.readFileSync('/home/user/resonate/public/songs/amazing-grace.musicxml', 'utf8');

let browser;
async function ctxFor(scenario, viewport = { width: 820, height: 1180 }, extra = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, ...extra });
  ctx.sc = scenario;
  await ctx.route('**/omr/omr-worker.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: fakeWorker(SC[ctx.sc]) }));
  await ctx.route('**/*.supabase.co/**', (r) => r.abort());
  ctx.errors = [];
  ctx.on('page', (p) => p.on('pageerror', (e) => ctx.errors.push(`${p.url().split('/').pop()}: ${e.message}`)));
  return ctx;
}
// A song with its PDF and settings, as a PDF → Song import would have left it (+ a stale clean-up cache).
async function seedSong(p, { pdf, xml, title = 'My Grace', stale = true }) {
  return p.evaluate(async ({ pdf, xml, title, stale, V }) => {
    const L = await import(`/resonate/library.js?v=${V}`);
    const id = `s${Date.now().toString(36)}seed`;
    await L.putSong({ id, title, xml, added: Date.now() - 86400e3, source: 'pdf', ...(stale ? { clean: { xml: '<stale/>', ver: 'v' + V } } : {}) });
    const bytes = await (await fetch(pdf)).arrayBuffer();
    await L.putPdf(id, bytes, pdf.split('/').pop());
    const set = (k, v) => { const all = JSON.parse(localStorage.getItem(k) || '{}'); all[id] = v; localStorage.setItem(k, JSON.stringify(all)); };
    set('resonate.sing.keys', 2);
    set('resonate.sing.rates', 0.9);
    set('resonate.play', { names: 'some', view: 'both', at: 3, speed: 0.75 });
    localStorage.setItem('resonate.sing.song', id);
    return { id, pdfBytes: bytes.byteLength };
  }, { pdf, xml, title, stale, V });
}
const songInfo = (p, id) => p.evaluate(async ({ id, V }) => {
  const L = await import(`/resonate/library.js?v=${V}`);
  const J = await import(`/resonate/omr/jobs.js?v=${V}`);
  const s = await L.getSong(id);
  const pdf = await L.getPdf(id);
  const list = await L.listSongs();
  const get = (k) => JSON.parse(localStorage.getItem(k) || '{}')[id];
  return {
    exists: !!s, title: s?.title, xmlLen: s?.xml?.length ?? 0, xmlTitle: (/<movement-title>([^<]*)</.exec(s?.xml || '') || [])[1] ?? null,
    software: /Audiveris/.test(s?.xml || ''), clean: s ? 'clean' in s : null, cleanOld: s?.clean?.xml === '<stale/>' || (s?.clean?.xml?.length ?? 0) > 100000, rev: s?.rev ?? null, pages: await L.getPages(id), pdf: pdf?.bytes ?? null, pdfName: pdf?.name ?? null,
    songs: list.length, ids: list.map((x) => x.id), indexRev: list.find((x) => x.id === id)?.rev ?? null,
    key: get('resonate.sing.keys'), rate: get('resonate.sing.rates'), play: get('resonate.play'),
    jobs: (await J.listJobs()).map((j) => ({ id: j.id, replace: j.replace ?? null, done: j.done })), flag: localStorage.getItem('resonate.import'), open: localStorage.getItem('resonate.sing.song'),
  };
}, { id, V });
const dbg = (p) => p.evaluate(() => {
  const d = window.resonateDebug?.() || {};
  return {
    state: d.import?.state, events: (d.eventList || []).map((e) => e.t + (e.phase ? ':' + e.phase : '') + (e.resumed ? ':resumed' : '')),
    err: document.getElementById('error')?.hidden === false ? document.getElementById('error-msg').textContent : '',
    done: document.getElementById('result')?.hidden === false, detail: document.getElementById('result-detail')?.textContent || '',
    pick: !!document.getElementById('pick') && getComputedStyle(document.getElementById('pick')).display !== 'none' && !document.getElementById('pick').hidden,
    notice: document.getElementById('notice')?.hidden === false ? document.getElementById('notice').textContent : '',
    url: location.search,
  };
}).catch((e) => ({ fail: e.message }));
async function until(p, pred, ms = 30000, f = dbg) {
  const end = Date.now() + ms;
  let d = null;
  while (Date.now() < end) { d = await f(p); try { if (d && pred(d)) return d; } catch {} await p.waitForTimeout(200); }
  return d;
}

(async () => {
  browser = await chromium.launch();

  // --- pdf-import.html?reprocess=<id>: the same id, new MusicXML, everything else kept ------------------
  if (want('page')) {
    const ctx = await ctxFor('ag');
    const p = await ctx.newPage();
    await p.goto(`${BASE}/resonate/tools.html`);
    const { id, pdfBytes } = await seedSong(p, { pdf: '/imp/amazing-grace1.pdf', xml: GS_XML });
    const before = await songInfo(p, id);
    await p.goto(`${BASE}/resonate/pdf-import.html?reprocess=${id}`);
    const first = await dbg(p);
    ok(!first.pick, `no picker for a reprocess (${JSON.stringify({ pick: first.pick })})`);
    const d = await until(p, (x) => x.done || !!x.err, 40000);
    const a = await songInfo(p, id);
    ok(d.done && !d.err, `done (${d.err || d.detail})`);
    ok(/song updated/.test(d.detail), `the result says the song was updated ("${d.detail}")`);
    ok(a.exists && a.songs === before.songs && a.open === id, `same id, no new song (${before.songs} → ${a.songs} songs, open ${a.open === id ? 'the same id' : a.open})`);
    ok(a.xmlLen !== before.xmlLen && a.software, `its MusicXML replaced (${before.xmlLen} → ${a.xmlLen} chars, Audiveris ${a.software})`);
    ok(a.title === 'My Grace' && a.xmlTitle === 'My Grace', `title kept: "${a.title}", the XML's movement-title "${a.xmlTitle}"`);
    ok(a.clean === false && !!a.rev && a.indexRev === a.rev, `clean-up cache gone (${a.clean}), a new rev (${a.rev}) in the index too`);
    ok(a.pdf === pdfBytes && a.pdfName === 'amazing-grace1.pdf', `PDF kept (${a.pdf} bytes, ${a.pdfName})`);
    ok(JSON.stringify(a.pages) === '[1]', `pages map stored: ${JSON.stringify(a.pages)}`);
    ok(a.key === 2 && a.rate === 0.9 && a.play?.view === 'both' && a.play?.at === 3 && a.play?.speed === 0.75, `settings kept (key ${a.key}, rate ${a.rate}, play ${JSON.stringify(a.play)})`);
    ok(!a.jobs.length && !a.flag, `no job left (${a.jobs.length}), no flag`);
    ok(d.url === '', `the address lost ?reprocess (${JSON.stringify(d.url)})`);
    // A reload after it: no second run, the picker.
    await p.reload();
    const r = await until(p, (x) => x.pick, 8000);
    ok(r.pick && !r.events.length, `a reload afterwards shows the picker (no second reprocess)`);
    // A song with no PDF: said, no job.
    const none = await p.evaluate(async (V) => { const L = await import(`/resonate/library.js?v=${V}`); return L.addSong('Plain', '<score-partwise><part-list/></score-partwise>'); }, V);
    await p.goto(`${BASE}/resonate/pdf-import.html?reprocess=${none}`);
    const n = await until(p, (x) => !!x.err, 10000);
    ok(/PDF isn't on this device/.test(n.err) && !(await songInfo(p, none)).jobs.length, `a song with no PDF: "${n.err}", no job`);
    ok(!ctx.errors.length, `no page errors${ctx.errors.length ? ': ' + ctx.errors.join(' | ') : ''}`);
    await ctx.close();
  }

  // --- a reload mid-run resumes the job and still replaces --------------------------------------------
  if (want('reload')) {
    const ctx = await ctxFor('gsSheet1');
    const p = await ctx.newPage();
    await p.goto(`${BASE}/resonate/tools.html`);
    const { id } = await seedSong(p, { pdf: '/imp/greensleeves3.pdf', xml: AG_XML, title: 'Green' });
    const before = await songInfo(p, id);
    await p.goto(`${BASE}/resonate/pdf-import.html?reprocess=${id}`);
    const mid = await until(p, () => true, 1, async () => {
      const end = Date.now() + 40000;
      let s;
      while (Date.now() < end) { s = await songInfo(p, id); if (s.jobs[0]?.done?.includes(1)) return s; await p.waitForTimeout(250); }
      return s;
    });
    const url = await p.evaluate(() => location.search);
    ok(mid.jobs.length === 1 && mid.jobs[0].replace === id && mid.jobs[0].done.includes(1), `a job carrying the song's id, sheet 1 kept (${JSON.stringify(mid.jobs)})`);
    ok(url === '', `the address lost ?reprocess once the job was kept (${JSON.stringify(url)})`);
    ctx.sc = 'gsExport';
    await p.reload();
    const d = await until(p, (x) => x.done || !!x.err, 40000);
    const a = await songInfo(p, id);
    ok(d.done && d.events.includes('job:resumed'), `after the reload: resumed and done (${d.err || d.detail})`);
    ok(a.songs === before.songs && a.xmlLen !== before.xmlLen && a.title === 'Green' && a.xmlTitle === 'Green', `replaced under the same id (${before.xmlLen} → ${a.xmlLen} chars, "${a.title}")`);
    ok(JSON.stringify(a.pages) === '[2,3,4]', `pages map: ${JSON.stringify(a.pages)} (a title page, then 3 music pages)`);
    ok(a.key === 2 && a.play?.at === 3 && !a.jobs.length, `settings kept, no job left`);
    ok(!ctx.errors.length, `no page errors${ctx.errors.length ? ': ' + ctx.errors.join(' | ') : ''}`);
    await ctx.close();
  }

  // --- the song deleted meanwhile: saved as a new song ----------------------------------------------
  if (want('deleted')) {
    const ctx = await ctxFor('agSlow');
    const p = await ctx.newPage();
    await p.goto(`${BASE}/resonate/tools.html`);
    const { id } = await seedSong(p, { pdf: '/imp/amazing-grace1.pdf', xml: GS_XML });
    await p.goto(`${BASE}/resonate/pdf-import.html?reprocess=${id}`);
    await until(p, (x) => x.events.includes('phase:engine'), 20000);
    await p.evaluate(async ({ id, V }) => { const L = await import(`/resonate/library.js?v=${V}`); await L.removeSong(id); }, { id, V });
    const d = await until(p, (x) => x.done || !!x.err, 40000);
    const nid = await p.evaluate(() => localStorage.getItem('resonate.sing.song'));
    const a = await songInfo(p, nid), old = await songInfo(p, id);
    ok(d.done && /saved to My songs/.test(d.detail), `done: "${d.detail}"`);
    ok(nid !== id && a.exists && !old.exists && a.pdf > 0 && JSON.stringify(a.pages) === '[1]', `saved as a new song (${nid}, PDF ${a.pdf} bytes, pages ${JSON.stringify(a.pages)}); the old id stays gone`);
    ok(!ctx.errors.length, `no page errors${ctx.errors.length ? ': ' + ctx.errors.join(' | ') : ''}`);
    await ctx.close();
  }

  // --- a new import stores the pages map; another import running → a reprocess is refused, said ------
  if (want('pages')) {
    const ctx = await ctxFor('ag');
    const p = await ctx.newPage();
    await p.goto(`${BASE}/resonate/pdf-import.html?pdf=/imp/amazing-grace1.pdf`);
    const d = await until(p, (x) => x.done || !!x.err, 40000);
    const nid = await p.evaluate(() => localStorage.getItem('resonate.sing.song'));
    const a = await songInfo(p, nid);
    ok(d.done && JSON.stringify(a.pages) === '[1]' && a.pdf > 0, `a new import keeps its pages map (${JSON.stringify(a.pages)})`);
    const plain = await p.evaluate(async (V) => { const L = await import(`/resonate/library.js?v=${V}`); return L.getPages(await L.addSong('Typed', '<score-partwise><part-list/></score-partwise>')); }, V);
    ok(plain === null, `a song not from a PDF: getPages → ${JSON.stringify(plain)}`);
    // Another import kept unfinished here: ?reprocess= says so and continues that one.
    ctx.sc = 'gsSheet1';
    const { id } = await seedSong(p, { pdf: '/imp/greensleeves3.pdf', xml: AG_XML, title: 'Green' });
    await p.goto(`${BASE}/resonate/pdf-import.html?pdf=/imp/greensleeves3.pdf`);
    await until(p, () => true, 1, async () => { const end = Date.now() + 30000; let s; while (Date.now() < end) { s = await songInfo(p, id); if (s.jobs[0]?.done?.includes(1)) return s; await p.waitForTimeout(250); } return s; });
    await p.goto(`${BASE}/resonate/pdf-import.html?reprocess=${id}`);
    const b = await until(p, (x) => !!x.notice && x.events.includes('job:resumed'), 10000);
    const s = await songInfo(p, id);
    ok(!!b.notice && s.jobs.length === 1 && !s.jobs[0].replace, `another import under way: "${b.notice}", that one goes on (${JSON.stringify(s.jobs.map((j) => j.replace))})`);
    ok(!ctx.errors.length, `no page errors${ctx.errors.length ? ': ' + ctx.errors.join(' | ') : ''}`);
    await ctx.close();
  }

  // --- the shell: resonatePlay.reprocess(id) in place, the open song loads again -----------------------
  if (want('shell')) {
    const ctx = await ctxFor('agSlow', { width: 1440, height: 900 });
    await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('__s')) { sessionStorage.setItem('__s', '1'); localStorage.setItem('resonate.shell.modules', JSON.stringify({ desktop: ['sing', 'score'] })); } } catch {} });
    const p = await ctx.newPage();
    const navs = [];
    p.on('framenavigated', (f) => { if (f === p.mainFrame()) navs.push(f.url()); }); // (pushState too: the shell's own history entries)
    await p.goto(`${BASE}/resonate/tools.html`);
    const { id } = await seedSong(p, { pdf: '/imp/amazing-grace1.pdf', xml: GS_XML, stale: false }); // (a stale cache of this version would open as it is)
    await p.goto(`${BASE}/resonate/shell.html`);
    await p.waitForFunction(() => window.resonateDebug?.().tuner, null, { timeout: 15000 });
    await p.evaluate(async ({ id, V }) => (await import(`/resonate/shell/songlist.js?v=${V}`)).openSong(id), { id, V });
    const look = () => p.evaluate(() => {
      const d = window.resonateDebug();
      const pl = d.score?.play;
      return { open: d.song.open, song: d.song.state?.song, scoreSong: pl?.song, ready: pl?.ready, pitched: pl?.counts?.pitched ?? null,
        singNotes: window.resonateSing?.debug?.()?.notes?.length ?? null, singSong: window.resonateSing?.state?.().song, imp: d.import, mark: window.__mark, hook: typeof window.resonatePlay?.reprocess };
    });
    let s0 = await until(p, (x) => x.open && x.ready && x.scoreSong && x.singSong && x.pitched && x.singNotes, 30000, look);
    ok(s0.open && s0.ready && s0.singSong === s0.scoreSong && s0.hook === 'function', `the song open with Sing and the Score; resonatePlay.reprocess is set (${JSON.stringify({ ...s0, imp: undefined })})`);
    await p.evaluate(() => { window.__mark = 1; });
    const navs0 = navs.length;
    const started = await p.evaluate((id) => window.resonatePlay.reprocess(id), id);
    const again = await p.evaluate((id) => window.resonatePlay.reprocess(id), id);
    const toast = await p.evaluate(() => { const t = document.getElementById('toast'); return t && !t.hidden ? t.textContent : ''; });
    ok(started === true && again === false && /Another PDF/.test(toast), `one at a time: a second reprocess refused and said ("${toast}")`);
    const s1 = await until(p, (x) => x.imp?.result && x.pitched !== s0.pitched && x.singNotes !== s0.singNotes, 40000, look);
    const a = await songInfo(p, id);
    ok(s1.imp?.result?.songId === id && s1.imp.replaced, `the tray: done, the same song replaced (${JSON.stringify(s1.imp?.result)})`);
    ok(s1.mark === 1 && navs.slice(navs0).every((u) => /shell\.html/.test(u)) && /shell\.html/.test(p.url()), `no navigation (the page's own state kept; ${navs.length - navs0} same-page history entries, ${p.url().split('/').pop()})`);
    ok(s1.open && s1.song === id && s1.scoreSong === id && s1.singSong === id, `the song still open, in place`);
    ok(s1.pitched !== s0.pitched && s1.singNotes !== s0.singNotes, `Sing and the Score show the new notes (Score ${s0.pitched} → ${s1.pitched} pitched, Sing ${s0.singNotes} → ${s1.singNotes} notes)`);
    ok(a.title === 'My Grace' && !a.cleanOld && JSON.stringify(a.pages) === '[1]' && a.key === 2, `stored: title kept, no clean-up of the old notes (${a.clean ? 'a new one, made on reload' : 'none'}), pages ${JSON.stringify(a.pages)}, key kept (${a.key})`);
    const done = await p.evaluate(() => { const r = document.getElementById('imp-done'); return { shown: !r.hidden, s: r.querySelector('.s')?.textContent }; });
    ok(/updated/.test(done.s || ''), `the done row says "${done.s}"`);
    if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/reprocess-shell.png` });
    ok(!ctx.errors.length, `no page errors${ctx.errors.length ? ': ' + ctx.errors.join(' | ') : ''}`);
    await ctx.close();
  }

  // --- an open Play / Sing page follows its song replaced (review: Back from the bfcache after ⟳
  // Reprocess, or the sync bringing another device's file, left the old notes on screen) -------------
  if (want('back')) {
    const ctx = await ctxFor('ag', { width: 1280, height: 800 });
    await ctx.addInitScript(() => { try { if (!navigator.audioSession) Object.defineProperty(navigator, 'audioSession', { configurable: true, value: { type: 'auto' } }); } catch {} });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/resonate/tools.html`);
    const { id } = await seedSong(p, { pdf: '/imp/amazing-grace1.pdf', xml: GS_XML, stale: false });
    await p.goto(`${BASE}/resonate/play.html`);
    const pl = (pg) => pg.evaluate(() => { const d = window.resonateDebug?.().play; return d && { ready: d.ready, song: d.song, rev: d.rev, pitched: d.counts.pitched, at: d.at }; });
    const s0 = await until(p, (x) => x?.ready && x.song === id && x.pitched, 60000, pl);
    // ⟳ Reprocess (pdf-import.html?reprocess=…) in another tab, then Back to this one from the bfcache
    const q = await ctx.newPage();
    await q.goto(`${BASE}/resonate/pdf-import.html?reprocess=${id}`);
    const d = await until(q, (x) => x.done || x.err, 40000);
    await q.close();
    await p.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    const s1 = await until(p, (x) => x?.ready && x.rev && x.rev !== s0.rev && x.pitched !== s0.pitched, 30000, pl);
    ok(d.done && s1?.rev && s1.rev !== s0.rev && s1.pitched !== s0.pitched && s1.at === s0.at, `Play, Back from the bfcache after a reprocess: the new notes (${s0.pitched} → ${s1?.pitched} pitched, rev ${s0.rev} → ${s1?.rev}, the place kept: bar ${s0.at} → ${s1?.at})`);
    // the sync replaces it again (another device's file): Play and a Sing tab load it again
    const g = await ctx.newPage();
    await g.goto(`${BASE}/resonate/sing.html`);
    const sg = (pg) => pg.evaluate(() => { const x = window.resonateDebug?.(); return x?.score ? { title: x.score.title, notes: x.notes?.length ?? 0 } : null; });
    const g0 = await until(g, (x) => x?.notes > 0, 30000, sg);
    const remote = (pg) => pg.evaluate((id) => window.dispatchEvent(new CustomEvent('resonate:remote', { detail: { songs: true, replaced: new Set([id]) } })), id);
    await g.evaluate(async ({ id, xml, V }) => { const L = await import(`/resonate/library.js?v=${V}`); await L.replaceSong(id, xml, { quiet: true }); }, { id, xml: GS_XML, V });
    await remote(p); await remote(g);
    const s2 = await until(p, (x) => x?.ready && x.rev !== s1.rev && x.pitched === s0.pitched, 30000, pl);
    const g1 = await until(g, (x) => x?.notes > 0 && x.notes !== g0.notes, 30000, sg);
    ok(s2?.rev !== s1.rev && s2?.pitched === s0.pitched && g1?.notes !== g0.notes, `the sync's replacement: Play (${s1.pitched} → ${s2?.pitched} pitched) and Sing (${g0.notes} → ${g1?.notes} notes) load it again`);
    // (Sing too, Back from the bfcache: a third file, then pageshow)
    await g.evaluate(async ({ id, xml, V }) => { const L = await import(`/resonate/library.js?v=${V}`); await L.replaceSong(id, xml, { quiet: true }); }, { id, xml: AG_XML, V });
    await g.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    const g2 = await until(g, (x) => x?.notes > 0 && x.notes !== g1?.notes, 30000, sg);
    ok(g2?.notes && g2.notes !== g1?.notes, `Sing, Back from the bfcache: the new notes (${g1?.notes} → ${g2?.notes})`);
    ok(!ctx.errors.length, `no page errors${ctx.errors.length ? ': ' + ctx.errors.join(' | ') : ''}`);
    await ctx.close();
  }

  await browser.close();
  console.log(`${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
