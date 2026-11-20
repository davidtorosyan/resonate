const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('http://localhost:8097/resonate/tools.html');
  const out = await p.evaluate(async (f) => {
    const M = await import('/resonate/musicxml.js');
    const s = M.parseMusicXml(await (await fetch(f)).text(), 'x');
    const res = { part: s.partName, notes: s.notes.length, verses: s.verses, tempo: s.tempo, fifths: s.fifths };
    for (const v of s.verses) { const ns = M.notesForVerse(s, v); res['v' + v] = M.lyricLines(ns).slice(0, 40).map((idx) => idx.map((i) => ns[i].melisma ? '~' : ns[i].text + (ns[i].syllabic === 'begin' || ns[i].syllabic === 'middle' ? '-' : '')).join(' ')); }
    return res;
  }, process.argv[2]);
  console.log(JSON.stringify(out, null, 1).slice(0, 4000));
  await b.close();
})();
