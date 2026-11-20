// Audio test page: the seven held-note tests and the mic + speaker rows A–H each run and report
// (Chromium with a fake mic; D and H pressed on their pads; an answer chip recorded).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const p = await (await b.newContext({ permissions: ['microphone'] })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:8097/resonate/audiotest.html'); await p.waitForTimeout(2500);
  const fails = [];
  const n = await p.$$eval('#tests .test', (r) => r.length);
  for (let i = 0; i < n; i++) {
    await p.click(`#tests .test:nth-child(${i + 1}) > button`);
    await p.waitForFunction(() => !window.resonateDebug().running, null, { timeout: 15000 });
    console.log(i + 1, await p.$eval(`#tests .test:nth-child(${i + 1}) .out`, (e) => e.textContent));
  }
  const keys = await p.$$eval('#mic .test > button', (bs) => bs.map((x) => x.textContent));
  for (const [i, k] of keys.entries()) {
    const row = `#mic .test:nth-child(${i + 1})`;
    await p.click(`${row} > button`);
    for (let t = 0; t < 400; t++) {
      if (!(await p.evaluate(() => window.resonateDebug().running))) break;
      if (await p.$eval(`${row} .pad`, (e) => !e.hidden)) { await p.dispatchEvent(`${row} .pad`, 'pointerdown', { pointerId: 1, isPrimary: true }); await p.waitForTimeout(120); }
      else await p.waitForTimeout(100);
    }
    const r = await p.evaluate((key) => window.resonateDebug().results[key], k);
    const chips = await p.$$(`${row} .ask button`);
    if (chips.length) await chips[0].click();
    const ans = await p.evaluate((key) => window.resonateDebug().results[key]?.answer, k);
    console.log(k, await p.$eval(`${row} .out`, (e) => e.textContent), ans ? `· answer ${ans}` : '');
    if (!r || r.error) fails.push(`${k}: ${r ? r.error : 'no result'}`);
    if (chips.length && !ans) fails.push(`${k}: the answer wasn't kept`);
  }
  const r = await p.evaluate(() => window.resonateDebug().results);
  if (!Object.values(r).slice(0, 6).every((x) => x.step > 0 && x.rate > 0)) fails.push('a held-note test reported no clock steps');
  if (r.C && typeof r.C.again !== 'number') fails.push(`C: mic didn't reopen (${r.C.again})`);
  if (r.D && !/5× lag/.test(r.D.on + r.D.off)) fails.push(`D: presses not counted (${r.D.on} / ${r.D.off})`);
  if (r.H && !(r.H.step > 0 && /^48000 Hz/.test(r.H.lat))) fails.push('H: the offline-decoded piano did not play on a 48 kHz context');
  if (errs.length) fails.push(...errs);
  console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `PASS ${n} held-note tests + ${keys.length} mic rows ran`);
  await b.close(); process.exit(fails.length ? 1 : 0);
})();
