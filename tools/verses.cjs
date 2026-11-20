const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('http://localhost:8097/resonate/tools.html');
  for (const f of process.argv.slice(2)) {
    const out = await p.evaluate(async (f) => {
      const M = await import('/resonate/musicxml.js');
      const s = M.parseMusicXml(await (await fetch(f)).text(), 'x');
      const c = {};
      for (const n of s.notes) for (const [v, x] of Object.entries(n.verses)) (c[v] ||= []).push(x.text);
      return Object.fromEntries(Object.entries(c).map(([v, t]) => [v, t.length + ': ' + t.slice(0, 12).join(' ')]));
    }, f);
    console.log(f, JSON.stringify(out, null, 1));
  }
  await b.close();
})();
