// Header pieces' widths (debugging the wrap): node hdrwidths.cjs <page> <width> [remote] [shot.png]
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8097/resonate/';
(async () => {
  const [pg, w, remote, shot] = process.argv.slice(2);
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: +w, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(BASE + pg); await p.waitForTimeout(500);
  const r = await p.evaluate((remote) => {
    if (remote === 'remote') { const x = document.getElementById('remote-btn'); x.hidden = false; }
    const h = document.querySelector('header'); const cs = getComputedStyle(h);
    const kids = [...h.children].map((k) => ({ cls: k.className || k.tagName, w: Math.round(k.getBoundingClientRect().width), top: Math.round(k.getBoundingClientRect().top),
      parts: [...k.children].map((c) => `${c.textContent.trim().slice(0, 8)}:${Math.round(c.getBoundingClientRect().width)}@${Math.round(c.getBoundingClientRect().top)}`).join(' ') }));
    return { pad: cs.paddingLeft + '/' + cs.paddingRight, gap: cs.columnGap, kids, h: h.getBoundingClientRect().height };
  }, remote);
  console.log(JSON.stringify(r, null, 1));
  if (shot) await p.screenshot({ path: shot });
  await b.close();
})();
