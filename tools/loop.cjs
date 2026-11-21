// Phrase loop: listen → count-in → sing → result, round after round; Stop puts the song take back.
const { chromium } = require('playwright');
const fs = require('fs');
const SP = '/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/';
(async () => {
  const src = fs.readFileSync('/home/user/tools/review.cjs', 'utf8');
  const init = eval(src.slice(src.indexOf('await p.addInitScript(() => {') + 'await p.addInitScript('.length, src.indexOf('  });\n  await p.goto') + 3));
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(init);
  await p.addInitScript(() => {
    window.__notes = []; window.__session = 'auto'; window.__live = 0;
    Object.defineProperty(navigator, 'audioSession', { value: { get type() { return window.__session; }, set type(v) { window.__session = v; } } });
    const S = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when) { if (this.buffer && this.buffer.duration > 1) { const d = window.resonateDebug?.(); window.__notes.push(window.__session + ':' + (d?.session?.kind || '-') + ':' + (this.context.currentTime).toFixed(2) + '>' + (+when).toFixed(2)); } return S.apply(this, arguments); };
  });
  await p.goto('http://localhost:8097/resonate/sing.html'); await p.waitForTimeout(1500);
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const lines = await p.evaluate(() => window.resonateDebug().lines);
  // A whole-song take first (short), to check it comes back after the loop.
  await p.click('#sing'); await p.waitForTimeout(11000); await p.click('#sing'); await p.waitForTimeout(1500);
  const songTake = await p.evaluate(() => window.resonateDebug().take.endT);
  await p.click('#rv-close');
  // Loop line 1 from the review? Use the lyrics button on line 1: move the cursor there first.
  await p.evaluate((L) => { window.__plan = { wrong: L[1].slice(0, 2), silent: [], noise: [], offset: 0 }; }, lines);
  await p.click('#review-btn'); await p.waitForTimeout(200);
  await p.click('#rv-lines .rv-line[data-li="1"] .rv-btns button:last-child'); // ⟳ Loop on line 1
  await p.waitForTimeout(400);
  let st = await p.evaluate(() => ({ sess: window.resonateDebug().session, bar: !document.getElementById('loopbar').hidden, text: document.getElementById('lp-text').textContent, sing: document.getElementById('sing').textContent }));
  console.log('start:', JSON.stringify(st));
  ok(st.bar && /listen/.test(st.text) && st.sess?.kind === 'listen' && /Stop loop/.test(st.sing), 'loop starts with listening');
  await p.screenshot({ path: SP + 'loop-listen.png' });
  const waitFor = async (re, ms = 20000) => { const t0 = Date.now(); for (;;) { const t = await p.textContent('#lp-text'); if (re.test(t)) return t; if (Date.now() - t0 > ms) return 'TIMEOUT ' + t; await p.waitForTimeout(100); } };
  let t = await waitFor(/your turn/);
  st = await p.evaluate(() => window.resonateDebug().session);
  ok(/your turn/.test(t), 'then your turn: ' + JSON.stringify(st));
  await p.waitForTimeout(1500);
  await p.screenshot({ path: SP + 'loop-sing.png' });
  const result = /That's it|aim for|Again|Sing out|Closer|lift|ease|Come in|Wait|Count|Hold|Keep|sooner|Let/;
  t = await waitFor(result);
  console.log('round 1 result:', t);
  ok(/aim for/.test(t) && !/%/.test(t), 'round 1 (two wrong notes): says which note to aim for, no score');
  await p.evaluate(() => { window.__plan = { wrong: [], silent: [], noise: [], offset: 0 }; });
  await p.screenshot({ path: SP + 'loop-result.png' });
  t = await waitFor(/Round 2 · your turn/, 25000);
  t = await waitFor(result, 25000);
  console.log('round 2 result:', t);
  ok(/✓ That's it/.test(t), 'round 2 (sung right): ✓, no numbers');
  const sessions = await p.evaluate(() => window.__notes.filter((x) => !x.endsWith('NaN')));
  console.log(JSON.stringify(await p.evaluate(() => window.__notes))); ok(sessions.every((x) => x.startsWith('playback')), 'listen notes play in the playback session');
  await p.click('#sing'); await p.waitForTimeout(1500);
  st = await p.evaluate(() => ({ bar: !document.getElementById('loopbar').hidden, sess: window.resonateDebug().session, sing: document.getElementById('sing').textContent }));
  console.log('stopped:', JSON.stringify(st));
  const back = await p.evaluate(() => window.resonateDebug().take);
  ok(!st.bar && !st.sess && back.endT === songTake && !back.part && /again/.test(st.sing), 'Stop: loop gone, the whole-song take is back');
  // Lyrics loop button.
  ok(!(await p.$('#loop-btn[hidden]')), 'Loop line button visible when idle');
  ok(!errs.length, 'no page errors ' + JSON.stringify(errs));
  await b.close();
})();
