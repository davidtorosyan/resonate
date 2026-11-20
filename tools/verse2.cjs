const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('http://localhost:8097/resonate/tools.html');
  const out = await p.evaluate(async (f) => {
    const M = await import('/resonate/musicxml.js');
    const s = M.parseMusicXml(await (await fetch(f)).text(), 'x');
    return s.notes.map((n, i) => ({ i, m: n.measure, v: n.verses })).filter((x) => x.v['2'] || x.v['3'] || (s.notes[x.i + 1]?.verses['2'] && true) || (s.notes[x.i - 1]?.verses['2'] && true))
      .map((x) => `#${x.i} m${x.m} v1=${x.v['1']?.text ?? '-'} v2=${x.v['2']?.text ?? '-'} v3=${x.v['3']?.text ?? '-'}`);
  }, process.argv[2]);
  console.log(out.join('\n'));
  await b.close();
})();
