// The last take of a song is kept (signed out too): after a reload it's back — lane, review,
// and the recording (Play: your voice). A different key: it doesn't fit, so it isn't shown.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const src = fs.readFileSync('/home/user/tools/review.cjs', 'utf8');
  const singer = eval(src.slice(src.indexOf('await p.addInitScript(() => {') + 'await p.addInitScript('.length, src.indexOf('  });\n  await p.goto') + 3));
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(singer);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  let fails = 0; const check = (ok, m) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${m}`); if (!ok) fails++; };
  await p.goto('http://localhost:8097/resonate/sing.html'); await p.waitForTimeout(1500);
  await p.click('#sing'); await p.waitForTimeout(9000); await p.click('#sing'); await p.waitForTimeout(2500);
  const before = await p.evaluate(() => { const d = window.resonateDebug(); return { at: d.take.at, frames: d.take.frames.length, graded: d.take.grades.filter((g) => g && g.status !== 'unsung').length, voice: !!d.take.voice }; });
  await p.reload(); await p.waitForTimeout(2500);
  const after = await p.evaluate(() => { const d = window.resonateDebug(); const t = d.take; return t && { at: t.at, frames: t.frames.length, graded: t.grades.filter((g) => g && g.status !== 'unsung').length, voice: !!t.voice, disp: t.frames.filter((f) => f.disp !== null).length, review: !document.getElementById('review-btn').hidden, play: !document.getElementById('playbar').hidden }; });
  console.log(JSON.stringify({ before, after }));
  check(after && after.at === before.at && after.frames === before.frames && after.graded === before.graded, 'after a reload the take is back (same frames and grades)');
  check(after?.voice && after.disp > 0 && after.review && after.play, 'with its recording, pitch line, Review and Play');
  await p.click('#review-btn'); await p.waitForTimeout(500);
  check(await p.evaluate(() => !document.getElementById('review').hidden && document.querySelectorAll('#rv-lines .rv-line').length > 0), 'the review opens with its lines');
  await p.click('#rv-close').catch(() => {});
  await p.evaluate(() => { document.getElementById('playmodes')?.querySelector('[data-mode="voice"]')?.click(); });
  await p.click('#play'); await p.waitForTimeout(1500);
  check(await p.evaluate(() => window.resonateDebug().session?.kind === 'playback'), 'Play plays');
  await p.click('#play').catch(() => {});
  await p.evaluate(() => { const k = document.getElementById('key-select'); k.value = '2'; k.dispatchEvent(new Event('change')); }); await p.waitForTimeout(800);
  check(await p.evaluate(() => !window.resonateDebug().take), 'another key: the take doesn\'t fit (not shown)');
  await p.evaluate(() => { const k = document.getElementById('key-select'); k.value = '0'; k.dispatchEvent(new Event('change')); }); await p.reload(); await p.waitForTimeout(2500);
  check(await p.evaluate(() => !!window.resonateDebug().take), 'back in its key (after a reload): it\'s back');
  check(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'all ok'); process.exit(fails ? 1 : 0);
})();
