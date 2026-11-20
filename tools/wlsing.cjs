const { chromium } = require('playwright'); const fs = require('fs');
const SP = '/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/';
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:8097/resonate/sing.html');
  const xml = fs.readFileSync(process.argv[2], 'utf8');
  await p.evaluate(async (xml) => { localStorage.clear(); const lib = await import('/resonate/library.js'); const id = await lib.addSong('Wichita Lineman', xml); localStorage.setItem('resonate.sing.song', id); }, xml);
  await p.reload(); await p.waitForTimeout(1500);
  const r = await p.evaluate(() => {
    const d = window.resonateDebug(); const ns = d.notes;
    const i = ns.findIndex((n) => n.text === 'va');
    return { verseHidden: document.getElementById('verse-select').hidden, summary: document.getElementById('summary').textContent, n: ns.length,
      around: ns.slice(i - 3, i + 6).map((n) => `${n.text || '‿'}@${n.t.toFixed(1)}s`).join(' '), end: ns[ns.length - 1].t.toFixed(0) + 's' };
  });
  console.log(JSON.stringify(r, null, 1));
  // Seek the lane to "va" and screenshot the lyric lines.
  await p.evaluate(() => { const ns = window.resonateDebug().notes; const i = ns.findIndex((n) => n.text === 'va'); document.querySelectorAll('#chips .chip')[i + 1].dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })); });
  await p.waitForTimeout(500);
  await p.screenshot({ path: SP + 'wl-sing.png' });
  console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'no page errors');
  await b.close();
})();
