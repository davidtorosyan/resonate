const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
  const p = await (await b.newContext()).newPage();
  const logs = []; p.on('console', (m) => { if (/sync|error|warn/i.test(m.type() + m.text())) logs.push(`${m.type()}: ${m.text()}`); });
  p.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  await p.goto('http://localhost:8097/resonate/account.html');
  await p.waitForFunction(() => window.resonateDebug?.().view === 'out');
  await p.fill('#email', process.env.TEST_EMAIL); await p.fill('#password', process.env.TEST_PW); await p.click('#signin');
  await p.waitForFunction(() => window.resonateDebug?.().view === 'in', null, { timeout: 20000 });
  await p.waitForTimeout(4000);
  await p.evaluate(() => { localStorage.setItem('resonate.sing.keys', JSON.stringify({ 'amazing-grace': 3 })); });
  const r = await p.evaluate(async () => { const m = await import('/resonate/sync.js?v=71'); const x = await m.syncNow(); return { x, meta: window.resonateSync().meta }; });
  console.log(JSON.stringify(r, null, 1).slice(0, 3000));
  console.log(logs.join('\n'));
  await b.close();
})();
