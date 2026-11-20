const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  for (const target of ['#lyrics', '#sing']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, permissions: [] });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    let mp3 = 0; p.on('request', (r) => { if (r.url().includes('/piano/')) mp3++; });
    await p.goto('http://localhost:8097/resonate/sing.html'); await p.waitForTimeout(1000);
    const before = mp3;
    await p.tap(target); await p.waitForTimeout(1200);
    console.log(`first tap on ${target}: piano samples fetched ${before} → ${mp3}`, errs.length ? 'ERRORS ' + errs.join(' | ') : 'no page errors');
    await ctx.close();
  }
  await b.close();
})();
