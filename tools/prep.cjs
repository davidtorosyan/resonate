const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('pageerror', e => console.log('ERR', e.message)); p.on('console', m => m.type() === 'error' && console.log('console', m.text()));
  await p.goto('http://localhost:8098/aud/prep.html');
  await p.waitForFunction(() => document.getElementById('out').textContent.includes('DONE'), null, { timeout: 180000 });
  console.log((await p.textContent('#out')).trim());
  const len = await p.evaluate(() => window.__tiff.length);
  const out = fs.openSync('/home/user/cjruns/killing-music.tif', 'w');
  for (let off = 0; off < len; off += 4 << 20) {
    const b64 = await p.evaluate(([o, n]) => { const s = window.__tiff.subarray(o, o + n); let bin = ''; for (let i = 0; i < s.length; i += 32768) bin += String.fromCharCode.apply(null, s.subarray(i, i + 32768)); return btoa(bin); }, [off, 4 << 20]);
    fs.writeSync(out, Buffer.from(b64, 'base64'));
  }
  fs.closeSync(out);
  await b.close();
})();
