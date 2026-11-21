// A playback context whose resume never settles (iOS) and one left "interrupted": Sing's Listen recovers;
// and the shell's Piano at home on an iPad (cleanup C 5.4): a tap whose resume hangs, then the next tap sounds
// on a new context. A context whose resume once hung stays dead (only a new one can start), as on iOS.
const { chromium } = require('playwright');
const { ok, done, fail } = require('./lib/check.cjs');
const { BASE } = require('./lib/paths.cjs');
const INIT = () => {
  window.__ctxs = []; window.__hang = false; window.__starts = 0;
  const AC = window.AudioContext;
  window.AudioContext = class extends AC {
    constructor(...a) { super(...a); window.__ctxs.push(this); }
    resume() { if (window.__hang) this.__dead = true; return this.__dead ? new Promise(() => {}) : super.resume(); }
  };
  const S = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function () { if (this.context.state === 'running') window.__starts++; return S.apply(this, arguments); };
};

async function sing(b) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(INIT);
  await p.goto(BASE + 'sing.html'); await p.waitForTimeout(1500);
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
  ok(out[0].sounding > 0, 'Sing: Listen plays');
  ok(out[1].sess === null && /didn't start/.test(out[1].status), `Sing: a resume that hangs → "didn't start" (${out[1].status})`);
  ok(out[2].made > out[1].made && out[2].sounding > 0, 'Sing: the next tap plays on a new context');
  ok(out[3].made > out[2].made && out[3].sounding > 0, 'Sing: an interrupted context is replaced and plays');
  ok(!errs.length, `Sing: no page errors ${JSON.stringify(errs)}`);
  await ctx.close();
}

// The shell's Piano on its own at home (an iPad's default modules: Score + Piano, no song open → the Piano).
async function piano(b) {
  const ctx = await b.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await ctx.route('**/*.supabase.co/**', (r) => r.abort());
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(INIT);
  await p.goto(BASE + 'index.html');
  await p.waitForFunction(() => window.resonateDebug?.().piano?.shown, null, { timeout: 20000 });
  await p.waitForTimeout(800);
  const cdp = await ctx.newCDPSession(p);
  const tap = async (midi, ms = 250) => { // a finger on a key, lifted after ms
    const pt = await p.evaluate((m) => { const k = document.querySelector(`#piano-region rect.key[data-midi="${m}"]`); if (!k) return null; const r = k.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.8 }; }, midi);
    if (!pt) return false;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y, id: 1 }] });
    await p.waitForTimeout(ms);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return true;
  };
  const state = (label) => p.evaluate((label) => { const d = window.resonateDebug().piano; return { label, made: window.__ctxs.length, ctx: d.ctx, stuck: d.stuck, sounding: window.__starts, log: d.log.length, awakeHere: d.awakeHere }; }, label);
  const out = [];
  ok(await tap(60), 'Piano: a key under the finger');
  await p.waitForTimeout(800); out.push(await state('a tap sounds'));
  // the context suspended, and its resume never settles from now on (that context: dead)
  await p.evaluate(async () => { window.__hang = true; for (const c of window.__ctxs) if (c.state === 'running') await c.suspend(); window.__starts = 0; });
  await tap(62); await p.waitForTimeout(2300); out.push(await state('resume hangs'));
  await p.evaluate(() => { window.__hang = false; window.__starts = 0; });
  await tap(64); await p.waitForTimeout(1200); out.push(await state('next tap'));
  for (const o of out) console.log(JSON.stringify(o));
  ok(out[0].sounding > 0 && out[0].ctx === 'running', `Piano: a tap sounds (${out[0].sounding} sources, ${out[0].ctx})`);
  ok(out[1].sounding === 0 && out[1].ctx !== 'running' && out[1].stuck === true, `Piano: the resume hangs — silent, the context marked stuck (${out[1].ctx}, stuck ${out[1].stuck})`);
  ok(out[2].made > out[1].made && out[2].sounding > 0 && out[2].ctx === 'running' && !out[2].stuck, `Piano: the next tap sounds on a new context (${out[1].made} → ${out[2].made} made, ${out[2].sounding} sources, ${out[2].ctx})`);
  ok(out[2].awakeHere === true, `Piano: the keep-awake source follows to the new context (${out[2].awakeHere})`);
  ok(!errs.length, `Piano: no page errors ${JSON.stringify(errs)}`);
  await cdp.detach();
  await ctx.close();
}

(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  if (process.env.ONLY !== 'piano') await sing(b);
  if (process.env.ONLY !== 'sing') await piano(b);
  await b.close();
  done();
})().catch(fail);
