// Perform view: lyrics-only take, count-in, previous line coloured, everything back after; options sheet.
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
  await p.goto('http://localhost:8097/resonate/sing.html'); await p.waitForTimeout(1500);
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  // Options: choose Perform, guide stays.
  await p.click('#options-btn'); await p.waitForTimeout(200);
  await p.screenshot({ path: SP + 'options.png' });
  await p.click('input[name="view"][value="perform"]'); await p.click('#op-close');
  ok((await p.textContent('#sing')).includes('Perform') && (await p.evaluate(() => localStorage.getItem('resonate.sing.view'))) === 'perform', 'Perform chosen: button says Perform, remembered');
  const lines = await p.evaluate(() => window.resonateDebug().lines);
  await p.evaluate((L) => { window.__plan = { wrong: L[1].slice(0, 3), silent: [], noise: [], offset: 0 }; }, lines);
  await p.click('#sing'); await p.waitForTimeout(800);
  let r = await p.evaluate(() => ({ perform: document.body.dataset.perform, lane: getComputedStyle(document.getElementById('lane')).display, results: getComputedStyle(document.getElementById('results')).display, countin: document.getElementById('countin').hidden ? '' : document.getElementById('countin').textContent }));
  ok(r.perform === 'true' && r.lane === 'none' && r.results === 'none' && /^\d$/.test(r.countin), 'take: lyrics only, count-in shown ' + JSON.stringify(r));
  await p.screenshot({ path: SP + 'perform-countin.png' });
  // Wait until line 2 is current, check line 1 (index 1) coloured once line 2 shows... line 0 first.
  const startOf = async (li) => p.evaluate((li) => { const d = window.resonateDebug(); return d.notes[d.lines[li][0]].t; }, li);
  const t2 = await startOf(2);
  for (;;) { const now = await p.evaluate(() => window.resonateDebug().nowT); if (now > t2 + 1) break; await p.waitForTimeout(200); }
  r = await p.evaluate(() => ({ prev: document.getElementById('lyric-prev').innerText, tune: document.getElementById('lyric-prev').dataset.tune, states: [...document.querySelectorAll('#lyric-now .syl')].map((s) => s.dataset.state).join(',') }));
  console.log('during line 2:', JSON.stringify(r));
  ok(/sweet/.test(r.prev) && r.tune === '' && !/%|✓/.test(r.prev), 'the line just sung (with wrong notes) shows above — no score, no mark');
  ok(!/good|off|ok|missed/.test(r.states), 'no note-by-note colours on the current line');
  await p.screenshot({ path: SP + 'perform-mid.png' });
  await p.waitForTimeout(3000);
  await p.click('#sing'); await p.waitForTimeout(1500);
  r = await p.evaluate(() => ({ perform: document.body.dataset.perform, lane: getComputedStyle(document.getElementById('lane')).display, review: !document.getElementById('review').hidden, prev: document.getElementById('lyric-prev').innerText }));
  ok(r.perform === 'false' && r.lane !== 'none' && r.review && !r.prev, 'after: lane back, review open, no previous-line display ' + JSON.stringify(r));
  // Back to practice: lane stays during a take.
  await p.click('#rv-close');
  await p.click('#options-btn'); await p.click('input[name="view"][value="practice"]'); await p.click('#op-close');
  await p.click('#sing'); await p.waitForTimeout(800);
  r = await p.evaluate(() => ({ perform: document.body.dataset.perform, lane: getComputedStyle(document.getElementById('lane')).display }));
  ok(r.perform === 'false' && r.lane !== 'none', 'Practice take shows the lane');
  await p.click('#sing'); await p.waitForTimeout(1200);
  ok(!errs.length, 'no page errors ' + JSON.stringify(errs));
  await b.close();
})();
