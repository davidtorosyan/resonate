const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:8097/resonate/sing.html');
  const xml = fs.readFileSync('/home/user/cjruns/e2e-songbird4/song.musicxml', 'utf8');
  await p.evaluate(async (xml) => { const lib = await import('/resonate/library.js'); const id = await lib.addSong('Hey, Little Songbird', xml); localStorage.setItem('resonate.sing.song', id); }, xml);
  await p.reload(); await p.waitForTimeout(2000);
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.click('#save-song')]);
  const path = '/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/' + dl.suggestedFilename();
  await dl.saveAs(path);
  const got = fs.readFileSync(path, 'utf8');
  console.log('download:', dl.suggestedFilename(), got.length, 'bytes, same as saved:', got === xml);
  await p.screenshot({ path: '/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/sing-save.png', clip: { x: 0, y: 0, width: 390, height: 200 } });
  console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'no page errors');
  await b.close();
})();
