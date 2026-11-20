const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
  const p = await b.newPage();
  await p.goto(process.argv[2]);
  try { await p.waitForFunction(() => /EXIT|SUMMARY/.test(document.getElementById('out').textContent), null, { timeout: 600000 }); } catch (e) { console.log('timeout'); }
  await p.waitForTimeout(1000);
  fs.writeFileSync(process.argv[3], (await p.evaluate(() => window.lines)).join('\n'));
  await b.close();
})();
