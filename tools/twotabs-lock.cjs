// Tab A converts; tab B starts 15 s later in the same profile and must be refused; A must still finish.
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const [prof, base = 'http://localhost:8097/resonate'] = process.argv.slice(2);
  const ctx = await chromium.launchPersistentContext(prof, { proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
  const state = (p) => p.evaluate(() => ({ s: document.getElementById('stage')?.textContent ?? (window.resonateDebug?.().stage || ''), done: !document.getElementById('result').hidden,
    err: document.getElementById('error').hidden ? '' : document.getElementById('error-msg').textContent,
    detail: document.getElementById('result-detail').textContent, head: document.getElementById('log').textContent.split('\n').slice(0, 4).join(' / ') }));
  const a = await ctx.newPage(); await a.goto(`${base}/pdf-import.html?pdf=/killing.pdf`);
  await a.waitForTimeout(15000);
  const b = await ctx.newPage(); await b.goto(`${base}/pdf-import.html?pdf=/killing.pdf`);
  for (let i = 0; i < 12; i++) { const s = await state(b); if (s.err || s.done) break; await b.waitForTimeout(5000); }
  console.log('B:', JSON.stringify(await state(b)));
  const t0 = Date.now();
  while (Date.now() - t0 < 15 * 60000) { const s = await state(a); if (s.err || s.done) break; await a.waitForTimeout(10000); }
  console.log('A:', JSON.stringify(await state(a)));
  await ctx.close();
})();
