// The song as the Sing page will play it: lyrics in order, with measure numbers and passes.
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('pageerror', (e) => console.log('ERR', e.message));
  await p.goto('http://localhost:8097/resonate/sing.html'); await p.waitForTimeout(300);
  const xml = fs.readFileSync(process.argv[2], 'utf8');
  console.log(await p.evaluate(async (xml) => {
    const { parseMusicXml, notesForVerse, lyricLines } = await import('/resonate/musicxml.js?' + Math.random());
    const { fixOmrScore } = await import('/resonate/omr/fixscore.js');
    const sc = parseMusicXml(/<software>\s*Audiveris/.test(xml.slice(0, 4000)) ? fixOmrScore(xml).xml : xml);
    const ns = notesForVerse(sc, sc.verses[0] || '1');
    const lines = lyricLines(ns);
    const out = [`"${sc.title}" ${sc.notes.length} notes, ${sc.measures.length} measures played${sc.unfolded ? ` (written ${sc.unfolded.written}, up to ${sc.unfolded.passes} passes)` : ' (as written)'}, verses: ${sc.verses.join(',')}, length ${sc.length} quarters`];
    for (const l of lines) {
      const f = sc.notes[l[0]];
      out.push(`  m${f.measure}${f.pass > 1 ? ' (pass ' + f.pass + ')' : ''}: ` + l.map((i) => ns[i].melisma ? '‿' : ns[i].text || '·').join(' '));
    }
    return out.join('\n');
  }, xml));
  await b.close();
})();
