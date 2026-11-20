// usage: node slurrun.cjs '<json args array>' <outfile>
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const [args, out, props = '[]', files = '[]'] = process.argv.slice(2);
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
  const p = await b.newPage();
  const t0 = Date.now();
  await p.goto('http://localhost:8097/slur/index.html?args=' + encodeURIComponent(args));
  try { await p.waitForFunction(() => window.done, null, { timeout: 900000, polling: 2000 }); } catch { console.log('TIMEOUT'); }
  const lines = await p.evaluate(() => window.lines);
  fs.writeFileSync(out, lines.join('\n'));
  console.log(Math.round((Date.now() - t0) / 1000) + 's', lines.filter((l) => /Slurs:|Segments:|END|ERROR|Exception/.test(l)).map((l) => l.replace(/^.*\| /, '')).join(' ; '));
  await b.close();
})();
