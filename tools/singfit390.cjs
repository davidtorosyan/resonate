// Sing page full-height layout with the header as it is: lane height, footer inside the viewport.
// usage: node singfit390.cjs <outdir> [w] [h]   (BASE env)
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8097/resonate/';
(async () => {
  const [out, w = 390, h = 844] = process.argv.slice(2);
  const b = await chromium.launch();
  for (const remote of [false, true]) for (const guided of ['on', 'off']) {
    const ctx = await b.newContext({ viewport: { width: +w, height: +h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    if (guided === 'off') await p.addInitScript(() => localStorage.setItem('resonate.sing.guided', 'off'));
    await p.goto(BASE + 'sing.html');
    await p.waitForFunction(() => window.resonateDebug?.()?.notes?.length > 0 || document.querySelectorAll('#chips .chip, #chips > *').length > 0, null, { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(800);
    const m = await p.evaluate((remote) => {
      if (remote) document.getElementById('remote-btn').hidden = false;
      const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height), shown: !!e.getClientRects().length }; };
      return { ih: innerHeight, docH: document.scrollingElement.scrollHeight, docW: document.scrollingElement.scrollWidth, header: r('header'), lane: r('#lane'), footer: r('footer'), coach: r('#coach'), chips: r('#chips') };
    }, remote);
    const tag = `${remote ? '📡' : 'no📡'}-guided-${guided}`;
    console.log(tag, JSON.stringify(m), errs.length ? 'ERRS ' + errs.join('|') : '');
    await p.screenshot({ path: `${out}/sing-${w}-${tag}.png` });
    await ctx.close();
  }
  await b.close();
})();
