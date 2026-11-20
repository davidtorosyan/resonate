const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined });
  for (const [v, jar] of [[8, 'hello8.jar'], [11, 'hello11.jar'], [17, 'hello17.jar'], [21, 'hello21.jar'], [11, 'hello17.jar']]) {
    const p = await b.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
    await p.goto(`http://localhost:8098/index.html?v=${v}&jar=${jar}`);
    try { await p.waitForFunction(() => document.getElementById('out').textContent.includes('DONE'), null, { timeout: 120000 }); } catch {}
    console.log(`--- v=${v} ${jar}\n` + (await p.textContent('#out')).trim() + (errs.length ? '\n  errors: ' + errs.slice(0, 3).join(' | ') : ''));
    await p.close();
  }
  await b.close();
})();
