// End-to-end tests of PDF → Song as a resumable job (omr/importer.js, omr/jobs.js, the worker's trace and
// book copies) on the real page, pdf-import.html, in Chromium. Synthetic public-domain PDFs only
// (fixtures/import/, served at /imp/ by the test server: sitetest/imp → tools/fixtures/import).
//
//   node importresume.cjs <scenario> [outdir]      scenarios:
//     full     uninterrupted greensleeves3 (title page + 3 music pages) → song; records the event stream
//              (fixtures/import/greensleeves3.events.json, previews as data URLs) and the MusicXML
//     stub1    reload right after "End of Stub#1" → continues from the book (sheet 1 never LOADed
//              again), same MusicXML as `full`
//     prep     reload while the pages are being found → starts over from the stored PDF, same MusicXML
//     engine   reload while the engine starts (no page read yet) → the pages come from storage, the
//              engine reads from sheet 1, same MusicXML
//     crash    the renderer crashes (CDP Page.crash) twice while sheet 2 is read → "Page 3 stopped
//              twice", Skip → the song without page 3
//     discard  ✕ while it reads → nothing kept, the picker back
//     tabs     tab A reads; tab B opens the page → "Running in another tab" with A's finished pages; A is
//              closed → B continues and finishes; the Sing page's pill while a job is open
//     again    two imports one after the other in the same page (importer harness, no reload)
//     engineid a job made by another engine (ENGINE) after a reload → over from the stored PDF (harness)
//   Compares against outdir/../full/song.musicxml when there (run `full` first).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:8097';
const PDF = '/imp/greensleeves3.pdf';
const SC = process.argv[2] || 'full';
const OUT = process.argv[3] || `/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/importresume/${SC}`;
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} [${SC}] ${m}`); if (!c) fails++; };
const t0 = Date.now();
const stamp = () => `${Math.round((Date.now() - t0) / 1000)}s`;
const strip = (x) => (x || '').replace(/<encoding-date>[^<]*<\/encoding-date>/g, '');

async function launch() {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
  const ctx = await b.newContext({ viewport: { width: 820, height: 1180 } });
  return { b, ctx };
}
function watch(p, tag) {
  const f = fs.createWriteStream(`${OUT}/${tag}-console.log`, { flags: 'a' });
  p.on('console', (m) => f.write(`[${m.type()}] ${m.text()}\n`));
  p.on('pageerror', (e) => { f.write(`[pageerror] ${e.message}\n`); console.log(stamp(), tag, 'pageerror', e.message); });
}
const logText = (p) => p.evaluate(() => document.getElementById('log')?.textContent || '').catch(() => '');
const dbg = (p) => p.evaluate(() => {
  const d = window.resonateDebug?.() || {};
  return {
    state: d.import?.state, job: d.import?.job, events: d.events, stage: d.stage,
    done: !document.getElementById('result').hidden, err: document.getElementById('error').hidden ? '' : document.getElementById('error-msg').textContent,
    flag: localStorage.getItem('resonate.import'), bar: document.getElementById('job-bar')?.hidden === false ? document.getElementById('job-msg').textContent : null,
  };
}).catch(() => ({}));
async function until(p, pred, ms, label) {
  const end = Date.now() + ms;
  let last = '';
  while (Date.now() < end) {
    const d = await dbg(p);
    const line = `${d.state} ${d.stage || ''} ${d.err || ''}`;
    if (line !== last) { console.log(stamp(), label, line); last = line; }
    if (await pred(d)) return d;
    if (d.err && !/stopped/.test(d.err)) return d;
    await p.waitForTimeout(1500);
  }
  return null;
}
const finished = (d) => d.done || !!d.err;
async function songXml(p) {
  return p.evaluate(async () => {
    const id = localStorage.getItem('resonate.sing.song');
    const lib = await import('/resonate/library.js?v=80');
    return (await lib.getSong(id))?.xml || null;
  });
}
async function jobsLeft(p) {
  return p.evaluate(async () => (await (await import('/resonate/omr/jobs.js?v=80')).listJobs()).length);
}
async function eventsOf(p) {
  return p.evaluate(async () => {
    const evs = window.resonateDebug().eventList;
    const url = (b) => new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
    return Promise.all(evs.map(async (e) => (e.preview instanceof Blob ? { ...e, preview: await url(e.preview) } : e)));
  });
}
function compareFull(xml) {
  const ref = path.join(path.dirname(OUT), 'full', 'song.musicxml');
  if (!fs.existsSync(ref)) { console.log('     (no full/song.musicxml to compare with)'); return; }
  const a = strip(fs.readFileSync(ref, 'utf8')), b = strip(xml);
  ok(a === b, `MusicXML identical to the uninterrupted run (${b.length} chars, encoding-date stripped)`);
}
const after = (log, marker) => log.slice(Math.max(0, log.indexOf(marker)));

(async () => {
  const { b, ctx } = await launch();
  let p = await ctx.newPage();
  watch(p, 'a');
  try {
    if (SC === 'full') {
      await p.goto(`${BASE}/resonate/pdf-import.html?pdf=${PDF}`);
      const d = await until(p, finished, 30 * 60000, 'full');
      ok(d?.done, `finished: ${d?.err || 'song saved'} in ${stamp()}`);
      const xml = await songXml(p);
      fs.writeFileSync(`${OUT}/song.musicxml`, xml || '');
      const evs = await eventsOf(p);
      const kinds = {}; for (const e of evs) kinds[e.t] = (kinds[e.t] || 0) + 1;
      console.log('     events', JSON.stringify(kinds));
      const pages = evs.filter((e) => e.t === 'page');
      ok(pages.length === 4 && pages.filter((e) => e.music).length === 3 && pages.every((e) => e.music ? e.s >= 1 && e.staves.length >= 1 : !e.s),
        `page events: ${pages.map((e) => `${e.page}${e.music ? `=s${e.s}/${e.staves.length} staves` : ' (no music)'}`).join(', ')}`);
      ok(pages.filter((e) => e.music).every((e) => /^data:image\/(webp|png)/.test(e.preview || '') && e.w === 2550),
        `previews (${pages.map((e) => (e.preview || '').slice(5, 15) + ' ' + Math.round((e.preview || '').length * 0.75 / 1024) + ' KB').join(', ')})`);
      const ms = evs.filter((e) => e.t === 'engine').map((e) => e.milestone);
      ok(['fetch', 'jvm', 'start', 'font', 'book'].every((m) => ms.includes(m)), `engine milestones ${ms.join(' → ')}`);
      ok(evs.some((e) => e.t === 'meta' && e.title === 'Greensleeves'), 'meta: the PDF\'s title');
      const done = evs.filter((e) => e.t === 'sheet' && e.state === 'done').map((e) => e.s);
      ok(done.join() === '1,2,3', `sheets done ${done}`);
      ok(['grid', 'sym', 'measures', 'words', 'notes', 'xml', 'done'].every((k) => kinds[k]), 'grid, sym, measures, words, notes, xml, done all there');
      const words = evs.filter((e) => e.t === 'words').flatMap((e) => e.words);
      const title = words.find((w) => w.text === 'Greensleeves');
      ok(title && title.x > 900 && title.x < 1400 && title.y > 100 && title.y < 250, `OCR words placed on the page (title at ${title?.x},${title?.y})`);
      const notes = evs.filter((e) => e.t === 'notes').flatMap((e) => e.notes);
      ok(notes.length > 50 && notes.every((n) => /^[A-G]$/.test(n.step) && Number.isFinite(n.oct)), `${notes.length} notes with pitch`);
      ok((await jobsLeft(p)) === 0 && !(await dbg(p)).flag, 'job deleted once saved, no flag');
      const order = evs.map((e) => e.t + (e.phase ? ':' + e.phase : ''));
      ok(order.indexOf('phase:engine') > order.lastIndexOf('page') && order.indexOf('done') > order.lastIndexOf('notes'), 'order: pages → engine → … → done');
      fs.writeFileSync('/home/user/tools/fixtures/import/greensleeves3.events.json', JSON.stringify({ name: 'greensleeves3.pdf (Chromium, real run)', recorded: new Date().toISOString(), events: evs }));
      fs.writeFileSync(`${OUT}/log.txt`, await logText(p));
      console.log('     fixture → /home/user/tools/fixtures/import/greensleeves3.events.json');
    } else if (SC === 'stub1') {
      await p.goto(`${BASE}/resonate/pdf-import.html?pdf=${PDF}`);
      await until(p, async (d) => JSON.parse(d.flag || '{}').done >= 1, 20 * 60000, 'to stub 1');
      const logA = await logText(p);
      ok(/End of Stub#1\b/.test(logA), 'sheet 1 stored before the reload');
      const before = await p.evaluate(() => window.resonateDebug().events);
      await p.goto(`${BASE}/resonate/pdf-import.html`); // a reload (no ?pdf)
      const early = await until(p, (d) => d.state === 'running' && d.events > 0, 60000, 'resumed');
      await p.screenshot({ path: `${OUT}/resumed.png` }).catch(() => {});
      ok(early && early.events >= 50, `the Reader shows the stored events at once (${early?.events} events; ${before} before the reload)`);
      const d = await until(p, finished, 30 * 60000, 'stub1');
      ok(d?.done, `finished after the reload: ${d?.err || 'saved'}`);
      const log = await logText(p);
      fs.writeFileSync(`${OUT}/log.txt`, log);
      const evs = await eventsOf(p);
      const book = evs.find((e) => e.t === 'engine' && e.milestone === 'book' && e.detail?.done?.length);
      ok(book && book.detail.done.join() === '1', `the book resumed with sheet 1 done (K ${JSON.stringify(book?.detail)})`);
      const live = after(log, '[resume]');
      ok(!/\[score#1\][^\n]*\| LOAD/.test(live) && /\[score#2\][^\n]*\| LOAD/.test(live), 'sheet 1 not loaded again; sheet 2 read from LOAD');
      ok(/book put back/.test(live), 'the book was put back in the engine\'s files');
      compareFull(await songXml(p));
      ok((await jobsLeft(p)) === 0, 'job deleted once saved');
    } else if (SC === 'prep' || SC === 'engine') {
      await p.goto(`${BASE}/resonate/pdf-import.html?pdf=${PDF}`);
      const when = SC === 'prep'
        ? (d) => d.events >= 3 // the job event, the phase, a page
        : async (d) => /engine/.test(d.stage || '') || (await logText(p)).includes('[ocr]') || (await p.evaluate(() => window.resonateDebug().eventList.some((e) => e.t === 'engine'))) ;
      await until(p, when, 10 * 60000, `to ${SC}`);
      if (SC === 'engine') await p.waitForTimeout(1500); // the pages kept
      await p.goto(`${BASE}/resonate/pdf-import.html`);
      const d = await until(p, finished, 30 * 60000, SC);
      ok(d?.done, `finished after a reload during ${SC}: ${d?.err || 'saved'}`);
      const log = await logText(p);
      fs.writeFileSync(`${OUT}/log.txt`, log);
      const live = after(log, '[resume]');
      if (SC === 'prep') {
        ok(/pages weren't all found yet; starting over/.test(log) && /^page 4\/4:/m.test(live), 'page prep done again from the stored PDF');
      } else {
        ok(/0 of 3 pages already read; drawing 3 again/.test(log) && !/^page \d+\/4:/m.test(live), 'the engine read from sheet 1 with the pages already found (no page prep again)');
      }
      compareFull(await songXml(p));
    } else if (SC === 'crash') {
      let cdp = await ctx.newCDPSession(p);
      await p.goto(`${BASE}/resonate/pdf-import.html?pdf=${PDF}`);
      for (let k = 1; k <= 2; k++) {
        await until(p, async () => /\[score#2\][^\n]*\| (HEADERS|BEAMS|HEADS)/.test(await logText(p)), 25 * 60000, `to sheet 2 (#${k})`);
        console.log(stamp(), `crash #${k}`);
        await Promise.race([cdp.send('Page.crash').catch(() => {}), new Promise((r) => setTimeout(r, 3000))]); // never answers: the page is gone
        await new Promise((r) => setTimeout(r, 1500));
        p = await ctx.newPage();
        watch(p, `crash${k}`);
        cdp = await ctx.newCDPSession(p);
        await p.goto(`${BASE}/resonate/pdf-import.html`);
      }
      const d = await until(p, (x) => x.state === 'stuck' || finished(x), 3 * 60000, 'stuck?');
      ok(d?.state === 'stuck' && /Page 3 stopped twice/.test(d.bar || ''), `crash-loop guard: "${d?.bar}"`);
      await p.screenshot({ path: `${OUT}/stuck.png` }).catch(() => {});
      await p.click('#job-skip');
      const e = await until(p, finished, 25 * 60000, 'skip');
      ok(e?.done, `finished with the page skipped: ${e?.err || 'saved'}`);
      const detail = await p.evaluate(() => document.getElementById('result-missing').textContent);
      ok(/Page 3 couldn't be read/.test(detail), `result says page 3 left out ("${detail}")`);
      fs.writeFileSync(`${OUT}/log.txt`, await logText(p));
    } else if (SC === 'discard') {
      await p.goto(`${BASE}/resonate/pdf-import.html?pdf=${PDF}`);
      await until(p, async (d) => (await logText(p)).includes('| BINARY'), 10 * 60000, 'to BINARY');
      await p.click('.rd-stop'); // (the Reader's ✕: a second tap confirms)
      await p.click('.rd-stop');
      await p.waitForTimeout(3000);
      const d = await dbg(p);
      ok(!(await p.evaluate(() => document.getElementById('pick').hidden)) && (await jobsLeft(p)) === 0 && !d.flag, 'discarded: the picker back, no job, no flag');
      await p.waitForTimeout(4000);
      ok(!(await p.evaluate(() => window.resonateDebug().import.state === 'running')), 'nothing runs after ✕');
    } else if (SC === 'tabs') {
      await p.goto(`${BASE}/resonate/pdf-import.html?pdf=${PDF}`);
      await until(p, async (d) => JSON.parse(d.flag || '{}').done >= 1, 20 * 60000, 'A to stub 1');
      const s = await ctx.newPage(); watch(s, 'sing');
      await s.goto(`${BASE}/resonate/sing.html`);
      await s.waitForTimeout(2500);
      const pill = await s.evaluate(() => { const a = document.getElementById('import-pill'); return a ? [a.textContent, a.getAttribute('href')] : null; });
      // (tab A reads — it holds the engine's lock: ⟳, not paused; counted as the Reader: PDF page 3 of 4)
      ok(pill && /⟳ PDF → Song 3\/4/.test(pill[0]) && pill[1] === 'pdf-import.html', `the Sing page's pill: ${JSON.stringify(pill)}`);
      await s.screenshot({ path: `${OUT}/sing-pill.png` }).catch(() => {});
      const q = await ctx.newPage(); watch(q, 'b');
      await q.goto(`${BASE}/resonate/pdf-import.html`);
      const w = await until(q, (d) => d.state === 'waiting', 30000, 'B waiting');
      ok(w?.bar === 'Running in another tab' && w.events > 40, `tab B: "${w?.bar}", ${w?.events} stored events shown`);
      ok(await q.evaluate(() => document.querySelector('.rd-stop').hidden && window.resonateDebug().readerDebug.held), 'tab B: no ✕ (A runs it), the Reader held (clocks stopped)');
      await q.screenshot({ path: `${OUT}/tab-b-waiting.png` }).catch(() => {});
      await p.close(); // tab A goes away mid-read
      const d = await until(q, finished, 30 * 60000, 'B continues');
      ok(d?.done, `tab B continued and finished: ${d?.err || 'saved'}`);
      const log = await logText(q);
      ok(/\[resume\]/.test(log) && !/\[score#1\][^\n]*\| LOAD/.test(after(log, 'book put back')), 'B continued from A\'s book');
      compareFull(await songXml(q));
      await s.waitForTimeout(1500);
      ok(!(await s.evaluate(() => !!document.getElementById('import-pill'))), 'the pill goes when the import is saved');
    } else if (SC === 'engineid') {
      // A job made by another engine (lib/ changed between the interruption and the reload): over from the stored PDF.
      await p.goto(`${BASE}/imptest.html?pdf=/imp/amazing-grace1.pdf`);
      await p.waitForFunction(() => JSON.parse(localStorage.getItem('resonate.import') || '{}').done >= 1 || window.__err, null, { timeout: 15 * 60000, polling: 2000 });
      await p.evaluate(async () => {
        const J = await import('/resonate/omr/jobs.js?v=80');
        const j = (await J.listJobs())[0];
        j.engine = 'older-engine'; await J.putJob(j);
      });
      await p.goto(`${BASE}/imptest.html?resume=1`);
      await p.waitForFunction(() => window.__res || window.__err, null, { timeout: 15 * 60000, polling: 2000 });
      const r = await p.evaluate(() => ({ res: window.__res && { title: window.__res.title, notes: window.__res.notes }, err: window.__err, log: window.__log.join('\n') }));
      ok(/another engine made this job \(older-engine\); starting over/.test(r.log) && /\| LOAD/.test(r.log) && !/book put back/.test(r.log), 'another engine: over from the stored PDF (page read again, no book put back)');
      ok(r.res && r.res.notes > 20, `finished: ${JSON.stringify(r.res || r.err)}`);
    } else if (SC === 'again') {
      await p.goto(`${BASE}/imptest.html?pdf=/imp/amazing-grace1.pdf`);
      await p.waitForFunction(() => window.__res || window.__err, null, { timeout: 15 * 60000, polling: 2000 });
      ok(await p.evaluate(() => !!window.__res), `first import: ${await p.evaluate(() => window.__err || window.__res.title)}`);
      await p.evaluate(async () => {
        window.__res = null; window.__err = null;
        const b = await (await fetch('/imp/amazing-grace1.pdf')).blob();
        window.__imp.start(new File([b], 'second.pdf', { type: 'application/pdf' })).then((r) => { window.__res = { title: r.title, notes: r.score.notes.length }; }).catch((e) => { window.__err = e.message; });
      });
      await p.waitForFunction(() => window.__res || window.__err, null, { timeout: 15 * 60000, polling: 2000 });
      const r = await p.evaluate(() => ({ res: window.__res, err: window.__err }));
      ok(r.res && r.res.notes > 20, `a second import in the same page, no reload: ${JSON.stringify(r)}`);
    }
  } catch (err) {
    ok(false, `threw: ${err.stack || err}`);
  }
  await b.close();
  console.log(fails ? `${fails} FAILED (${SC})` : `all passed (${SC}) in ${stamp()}`);
  process.exit(fails ? 1 : 0);
})();
