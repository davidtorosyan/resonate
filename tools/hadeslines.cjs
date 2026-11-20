const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('http://localhost:8097/resonate/tools.html');
  const out = await p.evaluate(async (f) => {
    const M = await import('/resonate/musicxml.js');
    const s = M.parseMusicXml(await (await fetch(f)).text(), 'x');
    const nm = (m) => ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'][m % 12] + (Math.floor(m / 12) - 1);
    const ns = M.notesForVerse(s, s.verses[0]);
    return M.lyricLines(ns).slice(0, 16).map((idx) => `m${ns[idx[0]].measure}: ` + idx.map((i) => (ns[i].melisma ? '~' : ns[i].text) + '/' + nm(ns[i].midi)).join(' '));
  }, process.argv[2]);
  console.log(out.join('\n'));
  await b.close();
})();
