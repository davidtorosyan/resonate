// The Sing page's rhythm analysis end to end (simulated singer through a fake mic): a take on
// time and one 0.2 s late both get take.rhythm; the late one reads later. (The fake mic hears
// no speaker, like headphones: no calibration, so only the relative timing is judged.)
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const src = fs.readFileSync('/home/user/tools/review.cjs', 'utf8');
  const init = eval(src.slice(src.indexOf('await p.addInitScript(() => {') + 'await p.addInitScript('.length, src.indexOf('  });\n  await p.goto') + 3));
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  let fails = 0;
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') errs.push(m.text()); });
  await p.addInitScript(init);
  await p.goto('http://localhost:8097/resonate/sing.html'); await p.waitForTimeout(1200);
  const res = [];
  for (const offset of [0, 0.2]) {
    await p.evaluate((o) => { window.__plan = { wrong: [], silent: [], noise: [], offset: o }; }, offset);
    await p.click('#sing'); await p.waitForTimeout(14000); await p.click('#sing'); await p.waitForTimeout(2500);
    const r = await p.evaluate(() => { const t = window.resonateDebug().take; const rh = t.rhythm; return rh && { cal: rh.calibrated, lead: rh.lead, found: rh.notes.filter(Boolean).length, sung: t.grades.filter((g) => g && g.status !== 'unsung').length, kinds: rh.notes.filter(Boolean).map((x) => x.kind[0]).join(''), obs: rh.obs.map((o) => o.kind + (o.tone === 'good' ? '+' : '')) }; });
    console.log('offset', offset, JSON.stringify(r));
    res.push(r);
    if (await p.$('#review:not([hidden])')) await p.click('#rv-close');
  }
  ok(res.every((r) => r && r.found >= r.sung * 0.5), 'take.rhythm found onsets for at least half the sung notes');
  ok(res[1].lead - res[0].lead > 0.12, `late take reads later: lead ${res[0].lead?.toFixed(3)} → ${res[1].lead?.toFixed(3)}`);
  ok(!errs.length, 'no errors ' + JSON.stringify(errs.slice(0, 3)));
  await b.close();
  process.exitCode = fails ? 1 : 0;
})();
