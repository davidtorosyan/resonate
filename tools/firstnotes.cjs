const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('http://localhost:8097/resonate/tools.html');
  const out = await p.evaluate(async (f) => {
    const M = await import('/resonate/musicxml.js');
    const s = M.parseMusicXml(await (await fetch(f)).text(), 'x');
    const nm = (m) => ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'][m % 12] + (Math.floor(m / 12) - 1);
    const pick = (lo, hi) => s.notes.filter((n) => +n.measure >= lo && +n.measure <= hi).map((n) => `${nm(n.midi)}:${n.verses['1']?.text || '~'}`).join(' ');
    return { first: pick(1, 12), m33to40: pick(33, 40), eurydice: pick(60, 62), range: [nm(Math.min(...s.notes.map((n) => n.midi))), nm(Math.max(...s.notes.map((n) => n.midi)))] };
  }, process.argv[2]);
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
