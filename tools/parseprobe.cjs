const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('http://localhost:8097/resonate/tools.html');
  const out = await p.evaluate(async () => {
    const { parseMusicXml } = await import('/resonate/musicxml.js');
    const xml = await (await fetch('/tmp/km.musicxml')).text();
    const s = parseMusicXml(xml, 'x');
    const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    return { tempo: s.tempo, beats: s.beats, n: s.notes.length, verses: s.verses,
      first: s.notes.slice(0, 40).map((n) => `m${n.measure} ${names[n.midi % 12]}${Math.floor(n.midi / 12) - 1} on=${n.onset} dur=${n.dur} '${n.verses['1']?.text ?? ''}'`) };
  });
  console.log(JSON.stringify({ tempo: out.tempo, beats: out.beats, n: out.n, verses: out.verses }));
  console.log(out.first.join('\n'));
  await b.close();
})();
