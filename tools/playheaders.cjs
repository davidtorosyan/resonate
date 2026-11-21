// Page headers with the Play pill: no horizontal overflow, the Play pill present and inside the
// viewport, #version visible — on record, sing (📡 forced visible, and with
// the assistant chip too), voice and play at 375, 390, 744 and 820 px; tools, account, assistants,
// pdf-import and audiotest for overflow and the badge. Fails on a pageerror or a console error.
// usage: node playheaders.cjs [--no-play-pill]   (BASE env, default the test server on 8097)
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8097/resonate/';
const expectPill = !process.argv.includes('--no-play-pill');
const WIDTHS = [375, 390, 744, 820];
const PAGES = [
  { name: 'record', url: 'record.html' },
  { name: 'sing', url: 'sing.html' },
  { name: 'sing+📡', url: 'sing.html', remote: true },
  { name: 'sing+📡+chip', url: 'sing.html', remote: true, chip: true },
  { name: 'voice', url: 'voice.html' },
  { name: 'tools', url: 'tools.html', self: true }, // (v92: Resonate + the account link)
  { name: 'play', url: 'play.html', self: true },
  // (no Play pill: they link back to Tools)
  { name: 'account', url: 'account.html', self: true },
  { name: 'assistants', url: 'assistants.html', self: true },
  { name: 'pdf-import', url: 'pdf-import.html', self: true },
  { name: 'audiotest', url: 'audiotest.html', self: true },
];
let fails = 0;
const ok = (c, m) => { if (!c) { console.log('FAIL ' + m); fails++; } };
(async () => {
  const browser = await chromium.launch();
  const rows = [];
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 600 ? 844 : 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    for (const pg of PAGES) {
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error ' + m.text()); });
      const res = await page.goto(BASE + pg.url).catch(() => null);
      if (!res || res.status() === 404) { await page.close(); continue; }
      await page.waitForTimeout(400);
      const m = await page.evaluate(({ remote, chip }) => {
        if (remote) { const b = document.getElementById('remote-btn'); if (b) { b.hidden = false; b.dataset.on = 'true'; } }
        if (chip) { const c = document.getElementById('assistant-chip'); if (c) { c.hidden = false; c.dataset.active = 'true'; c.innerHTML = '<span class="dot"></span><span class="nm">ChatGPT</span>'; } }
        const hdr = document.querySelector('header');
        const r = (el) => el && el.getBoundingClientRect();
        const pill = [...document.querySelectorAll('header a')].find((a) => /(^|\/)play\.html$/.test(a.getAttribute('href') || ''));
        const ver = document.getElementById('version');
        const vr = r(ver), pr = r(pill);
        const inside = (b) => !!b && b.left >= -0.5 && b.right <= innerWidth + 0.5 && b.width > 0 && b.height > 0;
        const links = [...hdr.querySelectorAll('a, button:not([hidden]), #version')].filter((e) => e.offsetParent || e.getClientRects().length);
        const out = links.filter((e) => !inside(r(e))).map((e) => e.textContent.trim().slice(0, 12));
        return {
          iw: innerWidth, docW: document.scrollingElement.scrollWidth, hdrW: hdr.scrollWidth, hdrCW: hdr.clientWidth, hdrH: Math.round(r(hdr).height),
          pill: !!pill, pillIn: inside(pr), pillText: pill?.textContent.trim(), verIn: inside(vr) && getComputedStyle(ver).visibility !== 'hidden' && getComputedStyle(ver).display !== 'none',
          out, links: links.map((e) => e.textContent.trim().slice(0, 8)).join(' '),
          remoteShown: remote ? !!document.getElementById('remote-btn') && !document.getElementById('remote-btn').hidden : null,
        };
      }, pg);
      const row = { w, page: pg.name, ...m, errs: errs.length };
      rows.push(row);
      const tag = `${pg.name} @${w}`;
      ok(m.docW <= m.iw, `${tag}: page scrollWidth ${m.docW} > ${m.iw}`);
      ok(m.hdrW <= m.hdrCW + 0.5, `${tag}: header scrollWidth ${m.hdrW} > ${m.hdrCW}`);
      ok(m.verIn, `${tag}: #version not visible in the viewport`);
      ok(!m.out.length, `${tag}: header controls outside the viewport: ${m.out.join(', ')}`);
      if (expectPill && !pg.self) { ok(m.pill, `${tag}: no Play pill`); ok(m.pillIn, `${tag}: Play pill outside the viewport`); }
      ok(!errs.length, `${tag}: page errors ${errs.join(' | ')}`);
      await page.close();
    }
    await ctx.close();
  }
  for (const r of rows) console.log(`${String(r.w).padEnd(4)} ${r.page.padEnd(13)} doc ${r.docW}/${r.iw} header ${r.hdrW}/${r.hdrCW} h${r.hdrH} pill ${r.pill ? (r.pillIn ? 'in' : 'OUT') : '-'} version ${r.verIn ? 'in' : 'OUT'}  [${r.links}]`);
  console.log(fails ? `${fails} failed` : 'all passed');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
