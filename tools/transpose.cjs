// Transpose control: per-song, key names, spelled notes, legacy migration.
const { chromium } = require('playwright'); const fs = require('fs');
const SP = '/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:8097/resonate/sing.html');
  const xml = fs.readFileSync(process.env.XML || '/home/user/cjruns/e2e-songbird4/song.musicxml', 'utf8');
  const id = await p.evaluate(async (xml) => { const lib = await import('/resonate/library.js'); const id = await lib.addSong('Songbird', xml); localStorage.setItem('resonate.sing.song', id); localStorage.setItem('resonate.sing.transpose', '-2'); return id; }, xml);
  await p.reload(); await p.waitForTimeout(1500);
  const st = async () => p.evaluate(() => ({ key: document.getElementById('key-select').selectedOptions[0]?.textContent, keys: localStorage.getItem('resonate.sing.keys'), legacy: localStorage.getItem('resonate.sing.transpose'),
    summary: document.getElementById('summary').textContent, chips: [...document.querySelectorAll('#chips .chip')].slice(0, 12).map((c) => c.querySelector('i').textContent + ':' + c.querySelector('b').textContent).join(' ') }));
  console.log('migrated', await st());
  console.log('options', await p.evaluate(() => [...document.getElementById('key-select').options].map((o) => o.textContent).join(' | ')));
  await p.selectOption('#key-select', '0'); await p.waitForTimeout(300);
  console.log('0:', await st());
  await p.selectOption('#key-select', '2'); await p.waitForTimeout(300);
  console.log('+2:', await st());
  await p.screenshot({ path: SP + 'transpose.png' });
  await p.selectOption('#song-select', 'amazing-grace'); await p.waitForTimeout(800);
  console.log('AG:', await st());
  console.log('AG options', await p.evaluate(() => [...document.getElementById('key-select').options].map((o) => o.textContent).join(' | ')));
  await p.selectOption('#key-select', '-5'); await p.waitForTimeout(300);
  console.log('AG -5:', await st());
  await p.selectOption('#song-select', id); await p.waitForTimeout(800);
  console.log('back to Songbird:', await st());
  await p.reload(); await p.waitForTimeout(1500);
  console.log('after reload:', await st());
  console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'no page errors');
  await b.close();
})();
