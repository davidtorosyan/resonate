// Sing page loads the converted song from My songs with the new parser; report summary + held notes.
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext(); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:8097/resonate/sing.html');
  const xml = fs.readFileSync('/home/user/cjruns/e2e-v24/song.musicxml', 'utf8');
  await p.evaluate(async (xml) => { const lib = await import('/resonate/library.js'); const id = await lib.addSong('Killing Me Softly', xml); localStorage.setItem('resonate.sing.song', id); }, xml);
  await p.reload(); await p.waitForTimeout(2500);
  const st = await p.evaluate(() => ({ summary: document.getElementById('summary')?.textContent, lyric: document.getElementById('lyric-now')?.textContent,
    dbg: (() => { try { const d = window.resonateDebug(); return { notes: d.score?.notes?.length, his: d.score?.notes?.filter((n) => n.measure === '9' || n.measure === '10').map((n) => `${n.measure}:${n.midi}:${n.dur}:${n.verses['1']?.text || ''}`) }; } catch (e) { return String(e); } })() }));
  console.log(JSON.stringify(st), errs.length ? 'ERRORS ' + errs.join(' | ') : 'no page errors');
  await b.close();
})();
