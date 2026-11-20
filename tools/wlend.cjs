const { chromium } = require('playwright'); const fs = require('fs');
const SP = '/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/';
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:8097/resonate/sing.html');
  const xml = fs.readFileSync(process.argv[2], 'utf8');
  await p.evaluate(async (xml) => { localStorage.clear(); const lib = await import('/resonate/library.js'); const id = await lib.addSong('Wichita Lineman', xml); localStorage.setItem('resonate.sing.song', id); }, xml);
  await p.reload(); await p.waitForTimeout(1500);
  const info = await p.evaluate(() => { const ns = window.resonateDebug().notes; return ns.slice(-14).map((n) => `${n.text || (n.melisma ? '‿' : '·')}:${n.name}:${n.d.toFixed(2)}s${n.syllabic ? '/' + n.syllabic : ''}`).join(' '); });
  console.log(info);
  // Move the cursor to the last "Is still on the line" and screenshot.
  await p.evaluate(() => { const ns = window.resonateDebug().notes; const i = ns.map((n) => n.text).lastIndexOf('Is'); const c = document.querySelectorAll('#chips .chip')[i]; c.scrollIntoView({ block: 'center' }); c.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })); });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: SP + 'wl-end.png' });
  console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'no page errors');
  await b.close();
})();
