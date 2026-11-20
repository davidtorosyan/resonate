// Drive the importer harness (sitetest/imptest.html) in Chromium: start a job and optionally reload
// at a point, then resume. usage: node importrun.cjs <pdf url> <outdir> [reloadAt: 'stub1'|'prep'|'engine'|''] [timeoutMin]
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [pdf, out, reloadAt = '', tmo = '40'] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const logf = fs.createWriteStream(out + '/console.log');
  p.on('console', (m) => logf.write(`[${m.type()}] ${m.text()}\n`));
  p.on('pageerror', (e) => { logf.write(`[pageerror] ${e.message}\n`); console.log('pageerror', e.message); });
  const t0 = Date.now(); const stamp = () => `${Math.round((Date.now() - t0) / 1000)}s`;
  await p.goto(`http://localhost:8097/imptest.html?pdf=${encodeURIComponent(pdf)}`);
  const deadline = t0 + Number(tmo) * 60000;
  let reloaded = !reloadAt, last = '';
  const save = async (tag) => {
    const d = await p.evaluate(() => ({ ev: window.__ev, log: window.__log, state: window.__state, res: window.__res, err: window.__err, stored: window.__stored, pending: window.__pending })).catch(() => null);
    if (d) {
      for (const e of d.ev) if (e.preview) e.preview = '[blob]';
      fs.writeFileSync(`${out}/${tag}.json`, JSON.stringify(d));
    }
    return d;
  };
  while (Date.now() < deadline) {
    await p.waitForTimeout(2000);
    const st = await p.evaluate(() => ({ n: window.__ev?.length, last: window.__ev?.at(-1), res: !!window.__res, err: window.__err, log: window.__log?.slice(-1)[0], stub: (window.__log || []).some((l) => /End of Stub#1\b/.test(l)), eng: (window.__ev || []).some((e) => e.t === 'phase' && e.phase === 'engine'), pages: (window.__ev || []).filter((e) => e.t === 'page').length })).catch(() => ({}));
    const line = `${st.n} ${JSON.stringify(st.last || {}).slice(0, 100)} | ${String(st.log || '').slice(0, 120)}`;
    if (line !== last) { console.log(stamp(), line); last = line; }
    if (!reloaded && ((reloadAt === 'stub1' && st.stub) || (reloadAt === 'prep' && st.pages >= 1) || (reloadAt === 'engine' && st.eng))) {
      if (reloadAt === 'stub1') await p.waitForTimeout(3000); // let the book copy be kept
      await save('before-reload');
      console.log(stamp(), `RELOAD at ${reloadAt}`);
      reloaded = true;
      await p.goto('http://localhost:8097/imptest.html?resume=1');
      continue;
    }
    if (st.res || st.err) break;
  }
  const d = await save('final');
  console.log(stamp(), 'result', d?.err || JSON.stringify({ ...(d?.res || {}), xml: undefined }), 'stored events', d?.stored, 'pending', JSON.stringify(d?.pending));
  if (d?.res?.xml) fs.writeFileSync(`${out}/song.musicxml`, d.res.xml);
  await b.close();
})();
