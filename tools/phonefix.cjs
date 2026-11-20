const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('http://localhost:8097/resonate/tools.html');
  const out = await p.evaluate(async () => {
    const M = await import('/resonate/musicxml.js');
    const { fixOmrScore } = await import('/resonate/omr/fixscore.js');
    const nm = (m) => ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'][m % 12] + (Math.floor(m / 12) - 1);
    const lines = (s) => { const ns = M.notesForVerse(s, s.verses[0]); return M.lyricLines(ns).map((idx) => `m${ns[idx[0]].measure}: ` + idx.map((i) => (ns[i].melisma ? '~' : ns[i].text) + '/' + nm(ns[i].midi)).join(' ')); };
    const res = {};
    for (const f of ['phone', 'sb4', 'km']) {
      const xml = await (await fetch(`/tmp/${f}.musicxml`)).text();
      const r = fixOmrScore(xml);
      const again = fixOmrScore(r.xml);
      const s = M.parseMusicXml(r.xml, 'x');
      res[f] = { changes: r.changes, secondPass: again.changes, notes: s.notes.length, lines: lines(s) };
    }
    const diff = res.phone.lines.map((l, i) => [l, res.sb4.lines[i]]).filter(([a, b]) => a !== b);
    return { phone: { changes: res.phone.changes, secondPass: res.phone.secondPass, notes: res.phone.notes }, sb4: { changes: res.sb4.changes, notes: res.sb4.notes },
      km: { changes: res.km.changes, notes: res.km.notes }, linesDiffering: diff.length, of: res.phone.lines.length, sample: diff.slice(0, 8), quell: res.phone.lines.filter((l) => /quell|busy|bu\//.test(l)).slice(0, 3) };
  });
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
