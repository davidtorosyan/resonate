// Compare merged notes (Sing parser) of the OMR song vs the hand transcription; list unmerged continuations.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('http://localhost:8097/resonate/tools.html');
  const out = await p.evaluate(async () => {
    const { parseMusicXml } = await import('/resonate/musicxml.js');
    const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const nm = (m) => names[m % 12] + (Math.floor(m / 12) - 1);
    const res = {};
    for (const f of ['km', 'gt']) {
      const s = parseMusicXml(await (await fetch(`/tmp/${f}.musicxml`)).text(), f);
      const sus = [];
      s.notes.forEach((n, i) => {
        const prev = s.notes[i - 1];
        const sung = (x) => x && Object.keys(x.verses).length > 0;
        if (prev && !sung(n) && prev.midi === n.midi && !n.restBefore && Math.abs(prev.onset + prev.dur - n.onset) < 1e-6)
          sus.push(`m${n.measure} ${nm(n.midi)} after '${Object.values(prev.verses).map((v) => v.text).join('/')}'`);
      });
      res[f] = { notes: s.notes.length, sameNoSyllable: sus };
    }
    return res;
  });
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
