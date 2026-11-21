// Does Play play after a take? Many paths: practice/perform, quick Play after Stop, review open, monitor, count-in stop, after Listen.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const src = fs.readFileSync(require('path').join(__dirname, 'review.cjs'), 'utf8');
  const init = eval(src.slice(src.indexOf('await p.addInitScript(() => {') + 'await p.addInitScript('.length, src.indexOf('  });\n  await p.goto') + 3));
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const results = [];
  const scenario = async (name, steps) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.addInitScript(init);
    await p.addInitScript(() => {
      window.__session = 'auto';
      Object.defineProperty(navigator, 'audioSession', { value: { get type() { return window.__session; }, set type(v) { window.__session = v; } } });
      window.__starts = []; window.__mics = [];
      const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (...a) => { const st = await g(...a); window.__mics.push(st); return st; };
      const live = () => window.__mics.some((st) => st.getTracks().some((t) => t.readyState === 'live'));
      const S = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (when) { if (this.buffer && this.buffer.duration > 0.05) window.__starts.push({ t: performance.now(), dur: +this.buffer.duration.toFixed(1), ctx: this.context.state, live: live(), session: window.__session }); return S.apply(this, arguments); };
    });
    await p.goto('http://localhost:8097/resonate/sing.html'); await p.waitForTimeout(1500);
    const take = async (sec) => { await p.click('#sing'); await p.waitForTimeout(sec * 1000); await p.click('#sing'); };
    const play = async (via = 'click') => {
      await p.evaluate(() => { window.__starts.length = 0; });
      if (via === 'click') await p.click('#play', { force: true, noWaitAfter: true, timeout: 3000 }).catch((e) => errs.push('click: ' + e.message.split('\n')[0]));
      else if (via === 'peek' || via === 'lane') {
        const r = await p.evaluate(() => { const b = document.getElementById('play').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + 5 }; });
        if (via === 'lane') r.y -= 250;
        await p.mouse.click(r.x, r.y);
      } else await p.evaluate(() => document.getElementById('play').click());
      await p.waitForTimeout(1500);
      return p.evaluate(() => ({ sess: window.resonateDebug().session?.kind || null, nowT: +window.resonateDebug().nowT.toFixed(2), starts: window.__starts.length, voice: window.__starts.filter((s) => s.dur > 3.5).length, liveMic: window.__starts.filter((s) => s.live).length, notPlayback: window.__starts.filter((s) => s.session !== 'playback').length, btn: document.getElementById('play').textContent, review: !document.getElementById('review').hidden, audioSession: window.__session }));
    };
    try { const r = await steps(p, take, play); results.push({ name, ...r, errs }); } catch (e) { results.push({ name, error: e.message.split('\n')[0], errs }); }
    await ctx.close();
  };
  const closeReview = async (p) => { if (!(await p.$('#review[hidden]'))) await p.click('#rv-close'); await p.waitForTimeout(200); };
  await scenario('practice take → close review → Play', async (p, take, play) => { await take(8); await p.waitForTimeout(1500); await closeReview(p); return play(); });
  await scenario('perform take → close review → Play', async (p, take, play) => {
    await p.click('#options-btn'); await p.click('input[name="view"][value="perform"]'); await p.click('#op-close');
    await take(8); await p.waitForTimeout(1500); await closeReview(p); return play();
  });
  await scenario('Play right after Stop (before the review)', async (p, take, play) => { await take(8); await p.waitForTimeout(50); return play('js'); });
  await scenario('Stop and Play in the same instant', async (p, take, play) => {
    await p.click('#sing'); await p.waitForTimeout(8000);
    await p.evaluate(() => { window.__starts.length = 0; document.getElementById('sing').click(); document.getElementById('play').click(); });
    await p.waitForTimeout(1500);
    return p.evaluate(() => ({ sess: window.resonateDebug().session?.kind || null, starts: window.__starts.length, liveMic: window.__starts.filter((s) => s.live).length, sessions: [...new Set(window.__starts.map((s) => s.session))].join(','), audioSession: window.__session }));
  });
  await scenario('tap Play while the review is open', async (p, take, play) => { await take(8); await p.waitForTimeout(1500); return play('click'); });
  // The part of Play that shows above a short review sheet is the sheet's backdrop.
  await scenario('tap the top of Play, showing above the review', async (p, take, play) => { await take(8); await p.waitForTimeout(1500); return play('peek'); });
  await scenario('tap the dim lane above the review: closes it, nothing plays', async (p, take, play) => { await take(8); await p.waitForTimeout(1500); return play('lane'); });
  await scenario('take stopped in the count-in → Play', async (p, take, play) => { await take(1.2); await p.waitForTimeout(1500); await closeReview(p); return play(); });
  await scenario('Voice mode: take stopped in the count-in → Play plays the melody', async (p, take, play) => {
    await p.evaluate(() => localStorage.setItem('resonate.sing.playMode', JSON.stringify('voice'))).catch(() => {});
    await take(8); await p.waitForTimeout(1500); await closeReview(p);
    await p.click('#play-modes button[data-mode="voice"]').catch(() => {});
    await take(1.2); await p.waitForTimeout(1500); await closeReview(p); return play();
  });
  await scenario('Pitch on → take → Play', async (p, take, play) => { await p.click('#monitor'); await p.waitForTimeout(500); await take(8); await p.waitForTimeout(1500); await closeReview(p); return play(); });
  await scenario('take → Listen → stop → Play', async (p, take, play) => { await take(8); await p.waitForTimeout(1500); await closeReview(p); await p.click('#listen'); await p.waitForTimeout(1200); await p.click('#listen'); await p.waitForTimeout(300); return play(); });
  await scenario('take → Play twice (stop, play again)', async (p, take, play) => { await take(8); await p.waitForTimeout(1500); await closeReview(p); await play(); await p.click('#play'); await p.waitForTimeout(300); return play(); });
  // (While a line plays, Play reads ■ Stop and a tap on it stops the line: the line is stopped on its own button first.)
  await scenario('take → review ▶ You on a line → Play', async (p, take, play) => { await take(8); await p.waitForTimeout(1500); await p.click('#rv-lines .rv-line button[data-mode="voice"]'); await p.waitForTimeout(800); await p.click('#rv-lines .rv-line button[data-mode="voice"]'); await p.waitForTimeout(300); await closeReview(p); return play(); });
  // Every path sounds (on the playback session, no live mic, no page error); the dim lane only closes the review.
  let fails = 0;
  for (const r of results) {
    const silent = /nothing plays/.test(r.name);
    const good = !r.error && !r.errs.length && r.liveMic === 0 && !r.notPlayback
      && (silent ? r.starts === 0 && r.sess === null && r.review === false : r.starts > 0 && r.sess === 'playback' && r.audioSession === 'playback');
    if (!good) fails++;
    console.log(`${good ? 'PASS' : 'FAIL'} ${r.name}: ${JSON.stringify(r)}`);
  }
  await b.close();
  console.log(fails ? `${fails} FAILED` : `all ${results.length} ok`);
  process.exit(fails ? 1 : 0);
})();
