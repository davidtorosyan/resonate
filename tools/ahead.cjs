// Sounds are scheduled a few seconds ahead (piano.js scheduleAhead), not a whole song at once:
// Listen, a take's click / melody guide, line playback, Stop. Every note still starts on time.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const src = fs.readFileSync(require('path').join(__dirname, 'review.cjs'), 'utf8');
  const init = eval(src.slice(src.indexOf('await p.addInitScript(() => {') + 'await p.addInitScript('.length, src.indexOf('  });\n  await p.goto') + 3));
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const fails = [];
  const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
  // 125%: the tempo is per song since v71 (resonate.sing.rate, the old global one, is deleted on load).
  const AT125 = { 'resonate.sing.song': 'amazing-grace', 'resonate.sing.rates': JSON.stringify({ 'amazing-grace': 1.25 }) };
  const page = async (store = {}) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.addInitScript(init);
    await p.addInitScript((store) => {
      for (const [k, v] of Object.entries(store)) localStorage.setItem(k, String(v));
      window.__src = []; window.__const = 0;
      const S = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (when = 0) {
        const now = this.context.currentTime;
        const rec = { when, at: now, dur: this.buffer?.duration || 0, ctx: this.context };
        window.__src.push(rec);
        return S.apply(this, arguments);
      };
      const C = ConstantSourceNode.prototype.start;
      ConstantSourceNode.prototype.start = function () { window.__const++; return C.apply(this, arguments); };
      const CS = ConstantSourceNode.prototype.stop; window.__constStops = 0;
      ConstantSourceNode.prototype.stop = function () { window.__constStops++; return CS.apply(this, arguments); };
      // the simulated mic can be made slow to open (a permission prompt)
      window.__micDelay = 0;
      const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (...a) => { const st = await g(...a); if (window.__micDelay) await new Promise((r) => setTimeout(r, window.__micDelay)); return st; };
      // waiting (scheduled, not started) sources at each scheduling call
      window.__waiting = () => window.__src.filter((r) => r.when > r.ctx.currentTime).length;
      window.__maxWaiting = 0;
      setInterval(() => { window.__maxWaiting = Math.max(window.__maxWaiting, window.__waiting()); }, 50);
    }, store);
    await p.goto('http://localhost:8097/resonate/sing.html'); await p.waitForTimeout(1500);
    return { p, ctx, errs };
  };

  // 1. Listen: every note in the span played starts at songT0 + n.t; only a few seconds wait.
  {
    const { p, ctx, errs } = await page(AT125);
    await p.click('#listen');
    await p.waitForTimeout(16000);
    const r = await p.evaluate(() => {
      const d = window.resonateDebug();
      const piano = window.__src.filter((s) => s.dur > 2.5 && s.dur < 3.5);
      const first = piano[0];
      const entry = d.notes.findIndex((n) => n.t + n.d > d.notes[0].t); // from the entry
      const songT0 = first.when - d.notes[0].t;
      const now = first.ctx.currentTime - songT0;
      const due = d.notes.filter((n) => n.t < now + 4); // must be scheduled by now (5 s ahead)
      const miss = due.filter((n) => !piano.some((s) => Math.abs(s.when - (songT0 + n.t)) < 0.002));
      const ahead = Math.max(...piano.map((s) => s.when - s.at));
      return { notes: d.notes.length, due: due.length, miss: miss.length, scheduled: piano.length, ahead: +ahead.toFixed(2), maxWaiting: window.__maxWaiting, keep: window.__const, sess: d.session?.kind, entry, rate: d.rate };
    });
    console.log(JSON.stringify(r));
    check(r.rate === 1.25, `the song's own tempo: 125% (${r.rate})`);
    check(r.sess === 'listen', 'Listen still playing after 16 s');
    check(r.due > 20 && r.miss === 0, `every note due so far is scheduled on time (${r.due} due, ${r.miss} missing)`);
    check(r.scheduled < r.notes, `not the whole song at once (${r.scheduled} of ${r.notes})`);
    check(r.ahead <= 5.6, `nothing scheduled more than ~5 s ahead (${r.ahead} s)`);
    check(r.maxWaiting <= 30, `few sources waiting at once (max ${r.maxWaiting})`);
    check(r.keep === 1, 'one keep-alive source');
    // Stop: no more scheduling.
    await p.click('#listen');
    await p.waitForTimeout(300);
    const n0 = await p.evaluate(() => window.__src.length);
    await p.waitForTimeout(2500);
    const n1 = await p.evaluate(() => window.__src.length);
    check(n1 === n0, `Stop ends the scheduling (${n1 - n0} sources after Stop)`);
    check(!errs.length, 'no page errors ' + errs.join('; '));
    await ctx.close();
  }

  // 2. A take with the click guide: clicks on the beat grid, a few seconds ahead.
  {
    const { p, ctx, errs } = await page({ 'resonate.sing.guide': 'click' });
    await p.click('#sing');
    await p.waitForTimeout(14000);
    const r = await p.evaluate(() => {
      const d = window.resonateDebug();
      const clicks = window.__src.filter((s) => s.dur > 0 && s.dur < 0.05);
      const gaps = clicks.slice(1).map((c, i) => c.when - clicks[i].when);
      const beat = d.session.beatSec;
      const offGrid = gaps.filter((g) => Math.abs(g / beat - Math.round(g / beat)) > 0.01).length;
      return { clicks: clicks.length, beat, offGrid, ahead: +Math.max(...clicks.map((s) => s.when - s.at)).toFixed(2), maxWaiting: window.__maxWaiting, sess: d.session?.kind, keep: window.__const };
    });
    console.log(JSON.stringify(r));
    check(r.sess === 'sing', 'take still running');
    check(r.clicks > 14 && r.offGrid === 0, `clicks keep the beat (${r.clicks} clicks, ${r.offGrid} off the grid)`);
    check(r.ahead <= 5.6, `clicks scheduled ≤ ~5 s ahead (${r.ahead} s)`);
    check(r.keep === 1, 'one keep-alive source in the take');
    await p.click('#sing');
    await p.waitForTimeout(500);
    const n0 = await p.evaluate(() => window.__src.length);
    await p.waitForTimeout(2000);
    const n1 = await p.evaluate(() => window.__src.length);
    check(n1 === n0, `Stop ends the guide (${n1 - n0} sources after Stop)`);
    check(!errs.length, 'no page errors ' + errs.join('; '));
    await ctx.close();
  }

  // 3. The melody guide in a take: its notes on time too.
  {
    const { p, ctx, errs } = await page({ 'resonate.sing.guide': 'melody' });
    await p.click('#sing');
    await p.waitForTimeout(14000);
    const r = await p.evaluate(() => {
      const d = window.resonateDebug();
      const piano = window.__src.filter((s) => s.dur > 2.5 && s.dur < 3.5);
      const songT0 = piano[0].when - d.notes[0].t;
      const now = piano[0].ctx.currentTime - songT0;
      const due = d.notes.filter((n) => n.t < now + 4);
      const miss = due.filter((n) => !piano.some((s) => Math.abs(s.when - (songT0 + n.t)) < 0.002));
      return { due: due.length, miss: miss.length, scheduled: piano.length, notes: d.notes.length };
    });
    console.log(JSON.stringify(r));
    check(r.due > 5 && r.miss === 0 && r.scheduled < r.notes, `melody guide notes on time, not all at once (${r.due} due, ${r.miss} missing, ${r.scheduled}/${r.notes})`);
    await p.click('#sing');
    check(!errs.length, 'no page errors ' + errs.join('; '));
    await ctx.close();
  }
  // 4. The page held up longer than the lookahead (a prompt() open): sounds that missed their
  // start are skipped, not started late; scheduling picks up again after.
  {
    const { p, ctx, errs } = await page(AT125);
    await p.click('#listen');
    await p.waitForTimeout(2000);
    await p.evaluate(() => { const t = performance.now(); while (performance.now() - t < 6500) {} });
    await p.waitForTimeout(3000);
    const r = await p.evaluate(() => {
      const piano = window.__src.filter((s) => s.dur > 2.5 && s.dur < 3.5);
      return { late: piano.filter((s) => s.when < s.at - 0.05).length, after: piano.filter((s) => s.at > piano[0].at + 8).length, sess: window.resonateDebug().session?.kind };
    });
    console.log(JSON.stringify(r));
    check(r.late === 0, `no sound started late after a 6.5 s stall (${r.late})`);
    check(r.sess === 'listen' && r.after > 0, `Listen goes on after it (${r.after} scheduled since)`);
    check(!errs.length, 'no page errors ' + errs.join('; '));
    await ctx.close();
  }

  // 5. Play tapped while a take's mic is opening: the Play bar is gone, and a Play started
  // anyway (script) is stopped when the take begins — its sounds and keep-alive don't run on.
  {
    const { p, ctx, errs } = await page({ 'resonate.sing.guide': 'click' });
    await p.click('#sing'); await p.waitForTimeout(6000); await p.click('#sing'); await p.waitForTimeout(1500);
    if (!(await p.$('#review[hidden]'))) await p.click('#rv-close');
    const before = await p.evaluate(() => !document.getElementById('playbar').hidden);
    await p.evaluate(() => { window.__micDelay = 2000; });
    await p.click('#sing');
    await p.waitForTimeout(300);
    const during = await p.evaluate(() => !document.getElementById('playbar').hidden);
    await p.evaluate(() => document.getElementById('play').click());
    await p.waitForTimeout(800);
    const mid = await p.evaluate(() => window.resonateDebug().session?.kind || null);
    await p.waitForTimeout(3500);
    const r = await p.evaluate(() => ({ sess: window.resonateDebug().session?.kind || null, live: window.__const - window.__constStops }));
    console.log(JSON.stringify({ before, during, mid, ...r }));
    check(before && !during, `Play bar hidden while the take sets up (before ${before}, during ${during})`);
    check(r.sess === 'sing' && r.live === 1, `the take runs; the Play started meanwhile was stopped (session ${r.sess}, ${r.live} keep-alive live; mid ${mid})`);
    await p.click('#sing');
    check(!errs.length, 'no page errors ' + errs.join('; '));
    await ctx.close();
  }
  await b.close();
  console.log(fails.length ? `${fails.length} FAILED` : 'all ok');
  process.exit(fails.length ? 1 : 0);
})();
