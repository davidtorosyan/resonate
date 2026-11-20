// Tap-to-hear chips on the Sing page: a tap plays that note (right pitch, length), lights the chip and
// syllable, keeps the chip list's scroll; a 2nd tap damps the 1st; during Listen a tap seeks.
const { chromium } = require('playwright'); const fs = require('fs');
const SP = '/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/';
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => {
    window.__starts = [];
    const orig = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when, off) {
      window.__starts.push({ when, now: this.context.currentTime, rate: this.playbackRate.value, len: this.buffer && this.buffer.duration });
      return orig.apply(this, arguments);
    };
  });
  await p.goto('http://localhost:8097/resonate/sing.html');
  const xml = fs.readFileSync(process.env.XML || '/home/user/cjruns/e2e-songbird4/song.musicxml', 'utf8');
  await p.evaluate(async (xml) => { const lib = await import('/resonate/library.js'); const id = await lib.addSong('Songbird', xml); localStorage.setItem('resonate.sing.song', id); }, xml);
  await p.reload(); await p.waitForTimeout(1500);
  const notes = await p.evaluate(() => window.resonateDebug().notes.map((n) => ({ midi: n.midi, d: n.d, t: n.t, text: n.text })));
  console.log('notes', notes.length);
  // Scroll the chip list down, tap a chip in the middle.
  const j = 120;
  await p.evaluate((j) => { const c = document.querySelectorAll('#chips .chip')[j]; c.scrollIntoView({ block: 'center' }); }, j);
  const before = await p.evaluate(() => document.getElementById('chips').scrollTop);
  await p.locator('#chips .chip').nth(j).click();
  await p.waitForTimeout(2500); // piano load
  const st = await p.evaluate(() => ({ starts: window.__starts.slice(), scroll: document.getElementById('chips').scrollTop,
    playing: [...document.querySelectorAll('#chips .chip')].findIndex((c) => c.dataset.playing === 'true'),
    cur: [...document.querySelectorAll('#lyric-now .syl')].map((s) => (s.dataset.state === 'current' ? '[' + s.textContent + ']' : s.textContent)).join(''),
    status: document.getElementById('status').textContent }));
  const keys = [33, ...[2, 3, 4, 5, 6].flatMap((o) => [0, 3, 6, 9].map((pc) => (o + 1) * 12 + pc)), 96];
  const rateFor = (m) => { let k = keys[0]; for (const x of keys) if (Math.abs(x - m) < Math.abs(k - m)) k = x; return 2 ** ((m - k) / 12); };
  console.log('tapped', j, notes[j], 'scroll', before, '->', st.scroll, 'playing chip', st.playing, 'status', st.status);
  console.log('lyric line:', st.cur);
  const s0 = st.starts[0];
  console.log('starts', st.starts.length, s0 && { rate: s0.rate.toFixed(4), expect: rateFor(notes[j].midi).toFixed(4) });
  await p.waitForTimeout(Math.max(0, notes[j].d * 1000 - 2000) + 600);
  console.log('after its length: playing chip', await p.evaluate(() => [...document.querySelectorAll('#chips .chip')].findIndex((c) => c.dataset.playing === 'true')));
  // Rapid taps: two different chips.
  await p.locator('#chips .chip').nth(j + 1).click();
  await p.waitForTimeout(100);
  await p.locator('#chips .chip').nth(j + 2).click();
  await p.waitForTimeout(300);
  const st2 = await p.evaluate(() => ({ n: window.__starts.length, rates: window.__starts.slice(-2).map((s) => s.rate.toFixed(4)), playing: [...document.querySelectorAll('#chips .chip')].findIndex((c) => c.dataset.playing === 'true') }));
  console.log('two taps:', st2, 'expect', rateFor(notes[j + 1].midi).toFixed(4), rateFor(notes[j + 2].midi).toFixed(4));
  await p.screenshot({ path: SP + 'chiptap.png' });
  // During Listen: a tap seeks.
  await p.click('#listen'); await p.waitForTimeout(800);
  await p.locator('#chips .chip').nth(j + 10).click(); await p.waitForTimeout(600);
  const d = await p.evaluate(() => window.resonateDebug());
  console.log('listen + tap: session', d.session, 'nowT', d.nowT.toFixed(2), 'note t', notes[j + 10].t.toFixed(2));
  await p.click('#listen');
  console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'no page errors');
  await b.close();
})();
