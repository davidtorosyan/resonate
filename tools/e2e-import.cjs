// End-to-end test of the production PDF → Song page.
// usage: node e2e-import.cjs <outdir> [timeoutMin] [base=http://localhost:8097/resonate]
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const out = process.argv[2] || '/home/user/cjruns/e2e';
  const tmo = Number(process.argv[3] || 90);
  const base = process.argv[4] || 'http://localhost:8097/resonate';
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Network.enable');
  let bytes = 0; const byHost = {}; const urls = new Map();
  cdp.on('Network.responseReceived', (e) => urls.set(e.requestId, e.response.url));
  cdp.on('Network.loadingFinished', (e) => {
    bytes += e.encodedDataLength;
    const u = urls.get(e.requestId) || '';
    const key = u.includes('leaningtech') ? 'cheerpj-cdn' : u.includes('/omr/lib/') ? 'jars' : u.includes('tessdata') ? 'tessdata' : u.includes('tesseract') ? 'tesseract-core' : u.includes('pdfjs') ? 'pdfjs' : 'other';
    byHost[key] = (byHost[key] || 0) + e.encodedDataLength;
  });
  await p.addInitScript(() => {
    window.__gaps = []; let last = performance.now();
    setInterval(() => { const now = performance.now(); const g = now - last - 100; if (g > 250) window.__gaps.push(Math.round(g)); last = now; }, 100);
  });
  const logf = fs.createWriteStream(out + '/console.log');
  p.on('console', (m) => logf.write(`[${m.type()}] ${m.text()}\n`));
  p.on('pageerror', (e) => logf.write(`[pageerror] ${e.message}\n`));
  const t0 = Date.now();
  const stamp = () => `${Math.round((Date.now() - t0) / 1000)}s`;
  if (process.env.PICK) {
    // Real user flow: tap "Choose a PDF…" and pick the file.
    await p.goto(`${base}/pdf-import.html`);
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('#choose')]);
    await fc.setFiles(process.env.PICK);
  } else {
    await p.goto(`${base}/pdf-import.html?pdf=${process.env.PDF || '/killing.pdf'}`);
  }
  await p.screenshot({ path: out + '/start.png' });
  let last = '';
  const deadline = t0 + tmo * 60000;
  let shot = 0;
  while (Date.now() < deadline) {
    const st = await p.evaluate(() => {
      // v81: the Reader (omr/reader.js) replaced #stage/#detail/#bar/#eta; resonateDebug() has its status.
      const d = window.resonateDebug?.() || {};
      const old = document.getElementById('stage');
      return {
        stage: old ? old.textContent : d.stage || '', detail: old ? document.getElementById('detail').textContent : (d.reader?.label || ''),
        bar: old ? document.getElementById('bar').style.width : `${((d.fraction || 0) * 100).toFixed(1)}%`, eta: old ? document.getElementById('eta').textContent : (d.reader?.eta != null ? `~${Math.round(d.reader.eta)} s` : ''),
        done: !document.getElementById('result').hidden, err: !document.getElementById('error').hidden,
      };
    });
    const line = `${st.stage} | ${st.detail} | ${st.bar} | ${st.eta}`;
    if (line !== last) { console.log(stamp(), line); last = line; }
    if (shot++ === 6) await p.screenshot({ path: out + '/progress.png', timeout: 120000 }).catch((e) => console.log('screenshot failed:', e.message.split('\n')[0]));
    if (st.done || st.err) break;
    await p.waitForTimeout(20000);
  }
  console.log(stamp(), 'END', await p.evaluate(() => (document.getElementById('result').hidden ? '' : (document.getElementById('result-title').textContent || document.querySelector('.rd-done-t span')?.textContent || '') + ' — ' + document.getElementById('result-detail').textContent) || document.getElementById('error-msg').textContent));
  console.log('main-thread stalls:', await p.evaluate(() => { const g = window.__gaps.slice().sort((a, b) => b - a); return `${g.length} over 250ms, worst ${g.slice(0, 6).join(',')} ms`; }));
  await p.screenshot({ path: out + '/end.png', fullPage: true });
  const xml = await p.evaluate(async () => {
    const lib = await import('./library.js');
    const songs = await lib.listSongs();
    if (!songs.length) return null;
    return (await lib.getSong(songs[0].id)).xml;
  });
  if (xml) fs.writeFileSync(out + '/song.musicxml', xml);
  console.log('network MB total', (bytes / 1e6).toFixed(1), JSON.stringify(Object.fromEntries(Object.entries(byHost).map(([k, v]) => [k, +(v / 1e6).toFixed(2)]))));
  // Sing page picks the imported song up?
  await p.goto(`${base}/sing.html`);
  await p.waitForTimeout(2500);
  console.log('sing page:', await p.textContent('#summary'), '|', await p.textContent('#lyric-now'));
  await p.screenshot({ path: out + '/sing.png' });
  await b.close();
})();
