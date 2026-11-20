const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
  const p = await b.newPage();
  await p.goto('http://localhost:8097/jama/index.html?args=' + encodeURIComponent(process.argv[2]) + '&cj=' + (process.argv[3] || '4.2') + '&jama=' + (process.argv[4] || ''));
  try { await p.waitForFunction(() => /EXIT|PROBE DONE|PROBE /.test(document.getElementById('out').textContent), null, { timeout: 600000 }); } catch { console.log('TIMEOUT'); }
  console.log((await p.textContent('#out')).trim());
  const errs = (await p.evaluate(() => window.lines)).filter((l) => /Exception|Error/.test(l)).slice(0, 5);
  if (errs.length) console.log(errs.join('\n'));
  await b.close();
})();
