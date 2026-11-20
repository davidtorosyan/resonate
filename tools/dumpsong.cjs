// Dump a MusicXML through the Sing parser (+ OMR clean-ups): per measure, the melody with lyrics.
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('http://localhost:8097/resonate/sing.html'); await p.waitForTimeout(300);
  const xml = fs.readFileSync(process.argv[2], 'utf8');
  console.log(await p.evaluate(async (xml) => {
    const { parseMusicXml } = await import('/resonate/musicxml.js');
    const { fixOmrScore } = await import('/resonate/omr/fixscore.js');
    const { noteName } = await import('/resonate/music.js');
    const f = fixOmrScore(xml);
    const sc = parseMusicXml(f.xml);
    const by = new Map();
    for (const n of sc.notes) { if (!by.has(n.measure)) by.set(n.measure, []); by.get(n.measure).push(`${n.verses['1']?.text ?? (n.verses['2']?.text ? '/' + n.verses['2'].text : '~')}:${noteName(n.midi, true)}${n.dur !== 1 ? '(' + n.dur + ')' : ''}`); }
    return `title "${sc.title}" ${sc.beats}/${sc.beatType} tempo ${sc.tempo}${sc.tempoFromScore ? '' : ' (default)'} fifths ${sc.fifths}, ${sc.notes.length} notes, verses ${sc.verses.join(',')}, measures ${sc.measures.length}\nfixes: ${f.changes.join(' | ') || 'none'}\n` +
      [...by].map(([m, ns]) => `m${m}: ${ns.join(' ')}`).join('\n');
  }, xml));
  await b.close();
})();
