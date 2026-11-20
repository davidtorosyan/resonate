// A playback context whose resume never settles (iOS) and one left "interrupted": Play recovers.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => {
    window.__ctxs = []; window.__hang = false; window.__starts = 0;
    const AC = window.AudioContext;
    window.AudioContext = class extends AC { constructor(...a) { super(...a); window.__ctxs.push(this); } resume() { return window.__hang ? new Promise(() => {}) : super.resume(); } };
    const S = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function () { if (this.context.state === 'running') window.__starts++; return S.apply(this, arguments); };
  });
  await p.goto('http://localhost:8097/resonate/sing.html'); await p.waitForTimeout(1500);
  const state = (label) => p.evaluate((label) => ({ label, made: window.__ctxs.length, sess: window.resonateDebug().session?.kind || null, status: document.getElementById('status').textContent, listen: document.getElementById('listen').textContent, sounding: window.__starts }), label);
  const out = [];
  await p.click('#listen'); await p.waitForTimeout(1500); out.push(await state('listen plays')); await p.click('#listen'); await p.waitForTimeout(300);
  // resume hangs on a suspended context
  await p.evaluate(async () => { window.__hang = true; for (const c of window.__ctxs) if (c.state === 'running') await c.suspend(); window.__starts = 0; });
  await p.click('#listen'); await p.waitForTimeout(2300); out.push(await state('resume hangs'));
  await p.evaluate(() => { window.__hang = false; window.__starts = 0; });
  await p.click('#listen'); await p.waitForTimeout(1800); out.push(await state('next tap: new context')); await p.click('#listen'); await p.waitForTimeout(300);
  // interrupted
  await p.evaluate(() => { const c = window.__ctxs[window.__ctxs.length - 1]; Object.defineProperty(c, 'state', { get: () => 'interrupted', configurable: true }); window.__starts = 0; });
  await p.click('#listen'); await p.waitForTimeout(1800); out.push(await state('interrupted → new context'));
  for (const o of out) console.log(JSON.stringify(o));
  const ok = out[0].sounding > 0 && out[1].sess === null && /didn't start/.test(out[1].status) && out[2].made > out[1].made && out[2].sounding > 0 && out[3].made > out[2].made && out[3].sounding > 0;
  console.log(ok ? 'PASS' : 'FAIL', 'errors:', errs);
  await b.close();
})();
