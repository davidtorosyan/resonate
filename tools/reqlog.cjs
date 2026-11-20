// Log every URL the PDF→Song page (and its worker) fetches until HEADERS of page 2 or timeout.
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const out = process.argv[2]; const base = process.argv[3] || 'http://localhost:8097/resonate';
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
  const ctx = await b.newContext();
  const urls = [];
  ctx.on('request', (r) => urls.push(r.url()));
  const p = await ctx.newPage();
  p.on('worker', (w) => { w.on('console', () => {}); });
  const log = fs.createWriteStream(out + '/console.log');
  p.on('console', (m) => log.write(m.text() + '\n'));
  await p.goto(`${base}/pdf-import.html?pdf=/killing.pdf`);
  const t0 = Date.now();
  while (Date.now() - t0 < 240000) {
    const s = await p.evaluate(() => document.getElementById('stage')?.textContent ?? (window.resonateDebug?.().stage || ''));
    if (/page 2/.test(s)) break;
    await p.waitForTimeout(5000);
  }
  fs.writeFileSync(out + '/urls.txt', urls.join('\n'));
  console.log(urls.length, 'requests');
  await b.close();
})();
