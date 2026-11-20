const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('http://localhost:8097/resonate/tools.html');
  for (const f of process.argv.slice(2)) {
    const out = await p.evaluate(async (f) => {
      const M = await import('/resonate/musicxml.js');
      const { fixOmrScore } = await import('/resonate/omr/fixscore.js');
      const xml = await (await fetch(f)).text();
      const r = fixOmrScore(xml, []);
      const a = M.parseMusicXml(xml, 'x'), c = M.parseMusicXml(r.xml, 'x');
      return { changes: r.changes, notes: [a.notes.length, c.notes.length], length: [a.length, c.length] };
    }, f);
    console.log(f, JSON.stringify(out, null, 1));
  }
  await b.close();
})();
