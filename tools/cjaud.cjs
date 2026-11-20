// Run the CheerpJ Audiveris test page headless; save console + resulting .mxl.
// usage: node cjaud.cjs <query> <outdir> [timeoutSec]
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [q, outdir, tmo] = [process.argv[2] || '', process.argv[3] || '/tmp/cjaud', Number(process.argv[4] || 1800)];
  fs.mkdirSync(outdir, { recursive: true });
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' }, args: ['--js-flags=--max-old-space-size=4096'] });
  const p = await b.newPage();
  const logf = fs.createWriteStream(outdir + '/console.log');
  p.on('console', m => logf.write(`[${m.type()}] ${m.text()}\n`));
  p.on('pageerror', e => logf.write(`[pageerror] ${e.message}\n`));
  const t0 = Date.now();
  await p.goto('http://localhost:8098/aud/' + (process.env.PAGE || 'index.html') + '?' + q);
  try { await p.waitForFunction(() => window.__done, null, { timeout: tmo * 1000, polling: 2000 }); } catch (e) { console.log('TIMEOUT'); }
  console.log((await p.textContent('#out')).trim());
  const mxl = await p.evaluate(() => window.__mxl ? Array.from(window.__mxl) : null);
  if (mxl) { fs.writeFileSync(outdir + '/out.mxl', Buffer.from(mxl)); console.log('saved', outdir + '/out.mxl'); }
  const mem = await p.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) + 'MB used JS heap' : '');
  console.log('wall', Math.round((Date.now() - t0) / 1000) + 's', mem);
  await b.close();
})();
