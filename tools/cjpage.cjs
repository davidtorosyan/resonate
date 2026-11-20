const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
  const p = await b.newPage();
  await p.goto('http://localhost:8098/' + process.argv[2]);
  try { await p.waitForFunction(() => document.getElementById('out').textContent.includes('DONE'), null, { timeout: Number(process.argv[3] || 120) * 1000 }); } catch { console.log('TIMEOUT'); }
  console.log((await p.textContent('#out')).trim());
  await b.close();
})();
