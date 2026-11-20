const { chromium } = require('playwright'); const fs = require('fs');
const SP = '/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/';
const SONGBIRD = '/root/.claude/uploads/6042bc19-5f16-52ea-a295-8ea17a932323/c6b79cee-Hey_Little_Songbird_-_C_Minor_-_MN0230233_3.musicxml';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:8097/resonate/sing.html');
  const ids = await p.evaluate(async ([sb, km]) => {
    localStorage.clear();
    const lib = await import('/resonate/library.js');
    const a = await lib.addSong('Songbird', sb); const k = await lib.addSong('Killing', km);
    localStorage.setItem('resonate.sing.song', 'amazing-grace');
    return { sb: a, km: k };
  }, [fs.readFileSync(SONGBIRD, 'utf8'), fs.readFileSync('/home/user/sitetest/tmp/km.musicxml', 'utf8')]);
  await p.reload(); await p.waitForTimeout(1200);
  const menu = () => p.evaluate(() => {
    const sel = document.getElementById('key-select');
    const out = []; let g = null;
    for (const o of sel.querySelectorAll('option')) {
      const gl = o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : '(top)';
      if (gl !== g) { out.push(`  [${gl}]`); g = gl; }
      out.push(`    ${o.selected ? '>' : ' '} ${o.textContent}  {${o.value}}`);
    }
    return out.join('\n');
  });
  const msg = () => p.evaluate(() => { const m = document.getElementById('song-msg'); return m.hidden ? '' : m.textContent; });
  const sum = () => p.evaluate(() => document.getElementById('summary').textContent);
  console.log('NO PROFILE, Amazing Grace:\n' + (await menu()).split('\n').slice(0, 5).join('\n') + '\n    …');
  await p.evaluate(() => localStorage.setItem('resonate.profiles', JSON.stringify({ active: 'a', list: [{ id: 'a', name: 'Dave', vol: null, range: { low: 46, high: 67, comfortLow: 48, comfortHigh: 64, at: 1 } }] })));
  await p.reload(); await p.waitForTimeout(1200);
  console.log('\nBARITONE (comfortable C3–E4), Amazing Grace:\n' + await menu());
  await p.selectOption('#key-select', '-12'); await p.waitForTimeout(300);
  console.log('picked −12:', await msg(), '|', await sum());
  await p.selectOption('#key-select', '-10'); await p.waitForTimeout(300);
  console.log('picked −10:', await msg(), '|', await sum());
  await p.selectOption('#key-select', '3'); await p.waitForTimeout(300);
  console.log('picked +3:', await msg());
  await p.selectOption('#song-select', ids.km); await p.waitForTimeout(1200);
  console.log('\nKilling Me Softly:\n' + await menu());
  // Songbird with the legacy "fit" saved.
  await p.evaluate((id) => { const k = JSON.parse(localStorage.getItem('resonate.sing.keys') || '{}'); k[id] = 'fit'; localStorage.setItem('resonate.sing.keys', JSON.stringify(k)); }, ids.sb);
  await p.selectOption('#song-select', ids.sb); await p.waitForTimeout(1500);
  console.log('\nSongbird (saved v32 "fit"):\n' + await menu());
  console.log('msg:', await msg(), '| saved:', await p.evaluate((id) => JSON.parse(localStorage.getItem('resonate.sing.keys'))[id], ids.sb));
  const sbOpts = await p.evaluate(() => [...document.querySelectorAll('#key-select option')].map((o) => o.value).filter((v) => v.startsWith('fit:')));
  if (sbOpts.includes('fit:0')) { await p.selectOption('#key-select', 'fit:0'); await p.waitForTimeout(400); console.log('picked fit:0:', await msg(), '|', await sum()); }
  await p.screenshot({ path: SP + 'fitmenu.png' });
  console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'no page errors');
  await b.close();
})();
