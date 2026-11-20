const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:8097/resonate/tools.html');
  const out = await p.evaluate(async () => {
    const M = await import('/resonate/musicxml.js');
    const { fixOmrScore } = await import('/resonate/omr/fixscore.js');
    const load = async (f) => { const r = fixOmrScore(await (await fetch(f)).text(), []); return { r, s: M.parseMusicXml(r.xml, 'x') }; };
    const A = await load('/tmp/sb-tup.musicxml'), B = await load('/tmp/sb-notup.musicxml');
    const nm = (m) => ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'][m % 12] + (Math.floor(m / 12) - 1);
    const show = (s, lo, hi) => s.notes.filter((n) => +n.measure >= lo && +n.measure <= hi).map((n) => `m${n.measure}@${n.onset}+${n.dur}:${nm(n.midi)}:${Object.values(n.verses)[0]?.text || '~'}`).join(' ');
    // measure starts must be identical after the tuplet fix
    const diffStarts = A.s.measures.map((t, i) => [i, t, B.s.measures[i]]).filter(([, a, b]) => Math.abs(a - b) > 1e-9).slice(0, 5);
    return { changes: A.r.changes.filter((c) => /tuplet/.test(c)), notes: [A.s.notes.length, B.s.notes.length], length: [A.s.length, B.s.length],
      m22: show(A.s, 22, 23), diffStarts, ns: M.lyricLines(M.notesForVerse(A.s, '1')).slice(3, 4).map((idx) => idx.map((i) => M.notesForVerse(A.s, '1')[i].text).join(' ')) };
  });
  console.log(JSON.stringify(out, null, 1), errs.join(' '));
  await b.close();
})();
