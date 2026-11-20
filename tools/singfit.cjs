// Sing page "Fit" with a voice profile: Songbird (duet) and Amazing Grace.
const { chromium } = require('playwright'); const fs = require('fs');
const SP = '/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/';
const XML = '/root/.claude/uploads/6042bc19-5f16-52ea-a295-8ea17a932323/c6b79cee-Hey_Little_Songbird_-_C_Minor_-_MN0230233_3.musicxml';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:8097/resonate/sing.html');
  const xml = fs.readFileSync(XML, 'utf8');
  const id = await p.evaluate(async (xml) => {
    localStorage.clear();
    const lib = await import('/resonate/library.js'); const id = await lib.addSong('Songbird', xml); localStorage.setItem('resonate.sing.song', id); return id;
  }, xml);
  await p.reload(); await p.waitForTimeout(1500);
  const st = () => p.evaluate(() => ({ key: document.getElementById('key-select').selectedOptions[0]?.textContent, first: document.getElementById('key-select').options[0].textContent,
    msg: document.getElementById('song-msg').hidden ? '' : document.getElementById('song-msg').textContent, summary: document.getElementById('summary').textContent,
    chips: [...document.querySelectorAll('#chips .chip')].filter((c, i) => [0, 9, 10, 100, 101, 150].includes(i)).map((c) => c.querySelector('i').textContent + ':' + c.querySelector('b').textContent).join(' ') }));
  console.log('no profile:', await st());
  await p.selectOption('#key-select', 'fit'); await p.waitForTimeout(300);
  console.log('fit, no profile:', await st());
  await p.evaluate(() => localStorage.setItem('resonate.profiles', JSON.stringify({ active: 'a', list: [{ id: 'a', name: 'Dave', vol: null, range: { low: 46, high: 67, comfortLow: 48, comfortHigh: 64, at: 1 } }] })));
  await p.reload(); await p.waitForTimeout(1500);
  console.log('fit, baritone Dave:', await st());
  await p.screenshot({ path: SP + 'sing-fit.png' });
  // Listen schedules the fitted pitches.
  const d = await p.evaluate(() => { const n = window.resonateDebug().notes; return { min: Math.min(...n.map((x) => x.midi)), max: Math.max(...n.map((x) => x.midi)) }; });
  console.log('notes now', d);
  await p.selectOption('#key-select', '0'); await p.waitForTimeout(300);
  console.log('back to Key Cm:', await st());
  await p.selectOption('#song-select', 'amazing-grace'); await p.waitForTimeout(800);
  await p.selectOption('#key-select', 'fit'); await p.waitForTimeout(300);
  console.log('AG fit:', await st());
  console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'no page errors');
  await b.close();
})();
