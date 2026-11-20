// The review's ⤓ saves the take as WAV + JSON; replaytake.mjs reads them back.
const { chromium } = require('playwright');
const fs = require('fs');
const { execSync } = require('child_process');
const SP = '/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/';
(async () => {
  const src = fs.readFileSync('/home/user/tools/review.cjs', 'utf8');
  const init = eval(src.slice(src.indexOf('await p.addInitScript(() => {') + 'await p.addInitScript('.length, src.indexOf('  });\n  await p.goto') + 3));
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(init);
  await p.goto('http://localhost:8097/resonate/sing.html'); await p.waitForTimeout(1200);
  await p.click('#sing'); await p.waitForTimeout(9000); await p.click('#sing'); await p.waitForTimeout(2000);
  const got = [];
  p.on('download', async (d) => { const path = SP + d.suggestedFilename(); await d.saveAs(path); got.push(path); });
  await p.click('#rv-save'); await p.waitForTimeout(2500);
  console.log('saved:', got.map((x) => x.split('/').pop()));
  const ok = got.some((x) => x.endsWith('.wav')) && got.some((x) => x.endsWith('.json'));
  console.log((ok ? 'PASS' : 'FAIL') + ' ⤓ saves the take as WAV + JSON', errs);
  if (ok) console.log(execSync(`node /home/user/tools/replaytake.mjs "${got.find((x) => x.endsWith('.json'))}"`).toString());
  await b.close();
  process.exitCode = ok && !errs.length ? 0 : 1;
})();
