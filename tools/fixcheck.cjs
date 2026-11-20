// Run fixOmrScore on converted songs (+ their engine logs) and show the effect on the Sing parser.
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('http://localhost:8097/resonate/tools.html');
  for (const [f, logf] of [['/tmp/sb.musicxml', '/home/user/cjruns/e2e-songbird/console.log'], ['/tmp/km.musicxml', '/home/user/cjruns/e2e-v24/console.log'], ['/tmp/gt.musicxml', null]]) {
    const log = logf ? fs.readFileSync(logf, 'utf8').split('\n') : [];
    const out = await p.evaluate(async ([f, log]) => {
      const M = await import('/resonate/musicxml.js');
      const { fixOmrScore } = await import('/resonate/omr/fixscore.js');
      const xml = await (await fetch(f)).text();
      const r = fixOmrScore(xml, log);
      const s = M.parseMusicXml(r.xml, 'x');
      const ns = M.notesForVerse(s, s.verses[0]);
      const line = M.lyricLines(ns).map((idx) => idx.map((i) => (ns[i].melisma ? '~' : ns[i].text)).join(' ')).find((l) => /people|See,/.test(l));
      return { changes: r.changes, verses: s.verses, tempo: s.tempo, tempoFromScore: s.tempoFromScore, notes: s.notes.length, line };
    }, [f, log]);
    console.log(f, JSON.stringify(out));
  }
  await b.close();
})();
