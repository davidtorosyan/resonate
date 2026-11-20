// Count-in and click grid: an eighth pickup in 4/4 and a 6/8 song (felt in dotted quarters).
// Every click, count-in and guide, must sit on one grid with the bar-1 downbeat.
const { chromium } = require('playwright');
const fs = require('fs');
const XML = '/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/xml/';
(async () => {
  const src = fs.readFileSync('/home/user/tools/review.cjs', 'utf8');
  const init = eval(src.slice(src.indexOf('await p.addInitScript(() => {') + 'await p.addInitScript('.length, src.indexOf('  });\n  await p.goto') + 3));
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  let fails = 0;
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
  for (const [file, expect] of [['pickup8.musicxml', { clicksIn: 8, beat: 0.6, downQ: 0.5 }], ['six8.musicxml', { clicksIn: 2 + 5 / 3, beat: 0.75, downQ: 0.5 }]]) {
    const p = await b.newPage();
    await p.addInitScript(init);
    await p.addInitScript(() => {
      window.__clicks = [];
      const S = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (when) { if (this.buffer && this.buffer.duration < 0.05) window.__clicks.push(+when); return S.apply(this, arguments); };
    });
    await p.goto('http://localhost:8097/resonate/sing.html'); await p.waitForTimeout(1000);
    await p.setInputFiles('#file-input', XML + file); await p.waitForTimeout(800);
    await p.evaluate(() => { localStorage.setItem('resonate.sing.guide', 'click'); });
    const g = await p.evaluate(() => document.querySelector('#options input[value="click"]') && (document.querySelector('#options input[value="click"]').checked = true, document.querySelector('#options input[value="click"]').dispatchEvent(new Event('change', { bubbles: true }))));
    await p.click('#sing'); await p.waitForTimeout(800);
    const r = await p.evaluate(() => { const d = window.resonateDebug(); return { songT0: d.take.songT0, count: d.session.count, beatSec: d.session.beatSec, notes: d.notes.map((n) => ({ t: n.t, q: n.q })), clicks: window.__clicks }; });
    await p.click('#sing'); await p.waitForTimeout(300);
    const rel = r.clicks.map((c) => +(c - r.songT0).toFixed(4)).sort((a, b) => a - b);
    const down = r.notes.find((n) => Math.abs(n.q - expect.downQ) < 1e-6).t; // bar 1's downbeat
    const offGrid = rel.filter((x) => Math.abs((x - down) / r.beatSec - Math.round((x - down) / r.beatSec)) > 0.01);
    console.log(file, 'count', r.count, 'beat', r.beatSec, 'pickup at', r.notes[0].t.toFixed(3), 'downbeat', down.toFixed(3), 'clicks', rel.slice(0, 12).join(' '));
    ok(Math.abs(r.beatSec - expect.beat) < 1e-6, `${file}: felt beat ${r.beatSec}`);
    ok(offGrid.length === 0, `${file}: every click on the downbeat's grid (${offGrid.length} off)`);
    ok(rel.filter((x) => x < r.notes[0].t - 1e-6).length === Math.ceil(expect.clicksIn), `${file}: ${Math.ceil(expect.clicksIn)} clicks before the pickup`);
    await p.close();
  }
  await b.close();
  process.exitCode = fails ? 1 : 0;
})();
