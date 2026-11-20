const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  if (process.env.SETUP) await p.addInitScript(process.env.SETUP);
  await p.goto(process.argv[2]); await p.waitForTimeout(Number(process.env.WAIT || 800));
  await p.screenshot({ path: process.argv[3], fullPage: !!process.env.FULL });
  console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'no page errors');
  await b.close();
})();
