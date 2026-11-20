// Verovio vendored files: import from the site, make a toolkit, render the bundled song.
// usage: node vrvsmoke.cjs   (server: serve.mjs on 8097)
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8097/resonate/';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(BASE + 'tools.html');
  const r = await page.evaluate(async () => {
    const t0 = performance.now();
    const [{ default: createVerovioModule }, { VerovioToolkit }] = await Promise.all([
      import('./vendor/verovio-6.4.0/verovio-module.mjs'), import('./vendor/verovio-6.4.0/verovio.mjs')]);
    const tk = new VerovioToolkit(await createVerovioModule());
    const t1 = performance.now();
    const xml = await (await fetch('songs/amazing-grace.musicxml')).text();
    tk.setOptions({ header: 'none', footer: 'none', breaks: 'auto', pageWidth: 2100, pageHeight: 2970, scale: 40 });
    const loaded = tk.loadData(xml);
    const svg = tk.renderToSVG(1);
    const t2 = performance.now();
    const d = document.createElement('div'); d.innerHTML = svg; document.body.append(d);
    return { version: tk.getVersion(), loaded, pages: tk.getPageCount(), notes: d.querySelectorAll('g.note').length,
      heads: d.querySelectorAll('g.note .notehead').length, svgLen: svg.length, engineMs: Math.round(t1 - t0), renderMs: Math.round(t2 - t1) };
  });
  console.log(JSON.stringify(r));
  const pitched = (await (await fetch(BASE + 'songs/amazing-grace.musicxml')).text()).match(/<pitch>/g).length;
  ok(r.version.startsWith('6.4.0'), 'toolkit version ' + r.version);
  ok(!!r.loaded, 'loadData ' + r.loaded);
  ok(r.pages >= 1, 'pages ' + r.pages);
  ok(r.notes > 0 && r.heads > 0, `page 1 notes ${r.notes} (song has ${pitched} pitched)`);
  const mime = await page.evaluate(async () => (await fetch('vendor/verovio-6.4.0/verovio.mjs', { method: 'HEAD' })).headers.get('content-type'));
  ok(/javascript/.test(mime), 'mime ' + mime);
  ok(!errs.length, 'no page errors ' + JSON.stringify(errs));
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
