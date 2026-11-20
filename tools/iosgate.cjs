// iOS-like audio gate: the page's playback context starts suspended and only starts from a resume()
// called in a touch end / click (a resume outside one waits for the next). Checks:
//  A. the first touch is a 2.2 s hold on a chip: the note sounds at the lift (on a live context);
//  B. phrase loop: the playback context goes "interrupted" during round 1's sing → round 2 keeps
//     the context the tap unlocked (a new one couldn't start without a tap) and listens again.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const src = fs.readFileSync('/home/user/tools/review.cjs', 'utf8');
  const init = eval(src.slice(src.indexOf('await p.addInitScript(() => {') + 'await p.addInitScript('.length, src.indexOf('  });\n  await p.goto') + 3));
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const page = async (touch) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: touch, isMobile: touch });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.addInitScript(init);
    await p.addInitScript(() => {
      window.__session = 'auto';
      Object.defineProperty(navigator, 'audioSession', { value: { get type() { return window.__session; }, set type(v) { window.__session = v; } } });
      window.__gesture = false; window.__play = []; window.__starts = [];
      for (const t of ['pointerup', 'click', 'touchend', 'keydown']) window.addEventListener(t, () => { window.__gesture = true; setTimeout(() => { window.__gesture = false; }, 0); }, true);
      const AC = window.AudioContext;
      window.AudioContext = class extends AC {
        constructor(...a) {
          super(...a);
          this.__gated = /freshPlayCtx/.test(new Error().stack);
          if (!this.__gated) return;
          this.__id = window.__play.length; window.__play.push(this);
          this.__susp = true; this.__waiters = []; super.suspend();
        }
        get state() { const s = super.state; return this.__gated && this.__susp && s !== 'closed' ? 'suspended' : s; }
        resume() {
          if (!this.__gated || !this.__susp) return super.resume();
          if (window.__gesture) { this.__susp = false; const r = super.resume(); r.then(() => this.__waiters.splice(0).forEach((f) => f())); return r; }
          return new Promise((res) => this.__waiters.push(res));
        }
      };
      const S = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function () { if (this.context.__gated) window.__starts.push({ id: this.context.__id, t: performance.now() }); return S.apply(this, arguments); };
    });
    await p.goto('http://localhost:8097/resonate/sing.html'); await p.waitForTimeout(1500);
    return { p, ctx, errs };
  };

  // A. first touch = a 2.2 s hold on a chip
  {
    const { p, ctx, errs } = await page(true);
    const cdp = await ctx.newCDPSession(p);
    const c = await p.evaluate(() => { const c = document.querySelectorAll('#chips .chip')[3]; const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y, id: 1 }] });
    await p.waitForTimeout(2200);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(900);
    const r = await p.evaluate(() => ({ made: window.__play.length, starts: window.__starts.map((s) => ({ id: s.id, state: window.__play[s.id].state })), status: document.getElementById('status').textContent }));
    console.log('A', JSON.stringify(r), errs);
    ok(r.starts.length > 0 && r.starts.every((s) => s.state === 'running'), 'A. first touch held 2.2 s: the note plays at the lift on a live context');
    await ctx.close();
  }

  // B. loop: playback context "interrupted" during round 1's sing
  {
    const { p, ctx, errs } = await page(false);
    const lines = await p.evaluate(() => window.resonateDebug().lines);
    await p.evaluate((L) => { window.__plan = { wrong: [], silent: [], noise: [], offset: 0 }; }, lines);
    await p.click('#loop-btn');
    const waitFor = async (re, ms = 25000) => { const t0 = Date.now(); for (;;) { const t = await p.textContent('#lp-text').catch(() => ''); if (re.test(t)) return t; if (Date.now() - t0 > ms) return 'TIMEOUT ' + t; await p.waitForTimeout(100); } };
    let t = await waitFor(/your turn/);
    await p.evaluate(() => { const c = window.__play[window.__play.length - 1]; const R = c.resume; Object.defineProperty(c, 'state', { get: () => 'interrupted', configurable: true }); c.resume = function () { delete this.state; delete this.resume; return this.resume(); }; });
    t = await waitFor(/%/);
    const r1 = await p.evaluate(() => window.__play.length);
    t = await waitFor(/listen/, 15000);
    await p.waitForTimeout(1500);
    const r = await p.evaluate(() => ({ made: window.__play.length, sess: window.resonateDebug().session?.kind || null, bar: !document.getElementById('loopbar').hidden, text: document.getElementById('lp-text').textContent, status: document.getElementById('status').textContent, live: window.__play.map((c) => c.state) }));
    console.log('B', JSON.stringify({ r1, ...r }), errs);
    ok(r.bar && r.sess === 'listen' && r.made === r1, 'B. loop round 2 listens on the context the tap started (no new context)');
    await p.click('#sing').catch(() => {});
    await ctx.close();
  }
  await b.close();
})();
