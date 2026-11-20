const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('http://localhost:8097/resonate/tools.html');
  for (const f of process.argv.slice(2)) {
    const out = await p.evaluate(async (f) => {
      const { fixOmrScore } = await import('/resonate/omr/fixscore.js');
      const M = await import('/resonate/musicxml.js');
      const xml = await (await fetch(f)).text();
      const r = fixOmrScore(xml, []);
      const before = M.parseMusicXml(xml, 'x'), after = M.parseMusicXml(r.xml, 'x');
      const lo = (s) => Math.min(...s.notes.map((n) => n.midi)), hi = (s) => Math.max(...s.notes.map((n) => n.midi));
      const m34 = (s) => s.notes.filter((n) => +n.measure >= 33 && +n.measure <= 40).map((n) => `${n.measure}:${n.midi}`).join(' ');
      return { changes: r.changes, range: [lo(before), hi(before), lo(after), hi(after)], before: m34(before), after: m34(after) };
    }, f);
    console.log(f, JSON.stringify(out, null, 1));
  }
  await b.close();
})();
