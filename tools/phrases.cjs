const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('http://localhost:8097/resonate/sing.html'); await p.waitForTimeout(500);
  const xml = fs.readFileSync(process.argv[2], 'utf8');
  console.log(await p.evaluate(async (xml) => {
    const { parseMusicXml } = await import('/resonate/musicxml.js');
    const { fixOmrScore } = await import('/resonate/omr/fixscore.js');
    const { noteName } = await import('/resonate/music.js');
    const sc = parseMusicXml(fixOmrScore(xml).xml);
    const ph = [];
    sc.notes.forEach((n, i) => { if (!i || n.restBefore) ph.push([]); ph[ph.length - 1].push(n); });
    return ph.map((p, k) => { const ms = p.map((n) => n.midi); return `${String(k).padStart(2)} m${p[0].measure} ${noteName(Math.min(...ms)).padEnd(4)}–${noteName(Math.max(...ms)).padEnd(4)} ${p.map((n) => (n.verses['1']?.text ?? '~') + ':' + noteName(n.midi)).join(' ')}`; }).join('\n');
  }, xml));
  await b.close();
})();
