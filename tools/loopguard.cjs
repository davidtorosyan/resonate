// v50 review fixes: loop guards, stop while loading, hide; history per verse; an on-time line in a late take isn't flagged.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const src = fs.readFileSync('/home/user/tools/review.cjs', 'utf8');
  const init = eval(src.slice(src.indexOf('await p.addInitScript(() => {') + 'await p.addInitScript('.length, src.indexOf('  });\n  await p.goto') + 3));
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const errs = [];
  // Slow piano on the first page so a Stop lands while it loads.
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('**/piano/*.mp3', async (r) => { await new Promise((res) => setTimeout(res, 2500)); r.continue(); });
  let p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(init);
  await p.goto('http://localhost:8097/resonate/sing.html'); await p.waitForTimeout(1500);
  await p.evaluate(() => { const d = window.resonateDebug(); }); 
  await p.click('#loop-btn'); await p.waitForTimeout(400);
  let st = await p.evaluate(() => ({ song: document.getElementById('song-select').disabled, tempo: document.getElementById('tempo-select').disabled, key: document.getElementById('key-select').disabled, verse: document.getElementById('verse-select').disabled }));
  ok(st.song && st.tempo && st.key && st.verse, 'during a loop the song, verse, key and tempo menus are locked');
  await p.click('#sing'); // Stop loop while the piano is still loading
  await p.waitForTimeout(3500);
  st = await p.evaluate(() => ({ sess: window.resonateDebug().session, bar: !document.getElementById('loopbar').hidden, sing: document.getElementById('sing').textContent, listen: document.getElementById('listen').textContent, song: document.getElementById('song-select').disabled }));
  ok(!st.sess && !st.bar && /● Sing/.test(st.sing) && /Listen/.test(st.listen) && !st.song, 'Stop loop while loading: nothing plays later, menus back ' + JSON.stringify(st));
  // Hide the page mid-loop.
  await p.click('#loop-btn'); await p.waitForTimeout(3000);
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForTimeout(800);
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); });
  await p.waitForTimeout(2500);
  st = await p.evaluate(() => ({ sess: window.resonateDebug().session, bar: !document.getElementById('loopbar').hidden }));
  ok(!st.sess && !st.bar, 'hidden page: loop stopped, no session left ' + JSON.stringify(st));
  await p.close();
  // History per verse + on-time line.
  p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage(); p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(init);
  await p.goto('http://localhost:8097/resonate/sing.html'); await p.waitForTimeout(1500);
  const lines = await p.evaluate(() => window.resonateDebug().lines);
  const take = async (sec) => {
    await p.click('#sing');
    if (sec) { await p.waitForTimeout(sec * 1000); await p.click('#sing'); }
    else { await p.waitForTimeout(2000); for (let i = 0; i < 120 && (await p.evaluate(() => window.resonateDebug().session?.kind === 'sing')); i++) await p.waitForTimeout(500); }
    await p.waitForTimeout(1500);
  };
  // Late everywhere except line 3 sung on time.
  await p.evaluate((L) => { window.__plan = { wrong: [], silent: [], noise: [], offset: 0.2 }; window.__onTime = L[3]; }, lines);
  await p.evaluate(() => { const P = window.__plan; Object.defineProperty(P, 'offset', { get() { const d = window.resonateDebug?.(); if (!d?.session) return 0.2; const i = d.notes.findIndex((n) => n.t <= d.nowT && d.nowT < n.t + n.d + 0.3); return window.__onTime.includes(i) ? 0 : 0.2; } }); });
  await take(0);
  const work = await p.evaluate(() => [...document.querySelectorAll('#rv-work .rv-line')].map((e) => e.innerText.replace(/\n+/g, ' / ')));
  const tip = await p.evaluate(() => document.getElementById('rv-tip').hidden ? '' : document.getElementById('rv-tip').textContent);
  console.log('work:', JSON.stringify(work), '| tip:', tip);
  ok(!work.some((w) => /Come in on time|Wait a moment/.test(w)), 'the on-time line is not a next step');
  ok(!/behind|ahead/.test(tip), 'no click in the mic (headphones-like): nothing claimed about the whole take being late');
  await p.click('#rv-close');
  // Verse 2 take, then verse 1 again: compared with the first verse-1 take.
  await p.selectOption('#verse-select', '2'); await p.waitForTimeout(300);
  await p.evaluate(() => { window.__plan = { wrong: [], silent: [], noise: [], offset: 0 }; });
  await take(8); await p.click('#rv-close');
  await p.selectOption('#verse-select', '1'); await p.waitForTimeout(300);
  await take(0);
  const prev = await p.evaluate(() => { const t = window.resonateDebug().take; return t.prev && { pct: t.prev.pct, sig: t.prev.sig }; });
  ok(prev && /^1\|/.test(prev.sig), 'verse 1 is compared with the earlier verse-1 take: ' + JSON.stringify(prev));
  // A partial take isn't "the last take".
  await p.click('#rv-close');
  await take(6);
  const part = await p.evaluate(() => ({ whole: window.resonateDebug().take.whole, headline: document.getElementById('rv-headline').textContent, text: document.querySelector('#review .sheet').innerText }));
  ok(part.whole === false && !/\d\s*%/.test(part.text), 'a short take is "part of the song" (data), still no scores: ' + part.headline);
  ok(!errs.length, 'no page errors ' + JSON.stringify(errs));
  await b.close();
})();
