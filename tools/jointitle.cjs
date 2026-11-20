const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('pageerror', (e) => console.log('ERR', e.message));
  await p.goto('http://localhost:8097/resonate/sing.html'); await p.waitForTimeout(300);
  const x1 = fs.readFileSync('/home/user/cjruns/wl-native/wl.mvt1/' + fs.readdirSync('/home/user/cjruns/wl-native/wl.mvt1').find((f) => f.endsWith('.xml') && f !== 'container.xml'), 'utf8');
  const x2 = fs.readFileSync('/home/user/cjruns/wl-native/wl.mvt2/' + fs.readdirSync('/home/user/cjruns/wl-native/wl.mvt2').find((f) => f.endsWith('.xml') && f !== 'container.xml'), 'utf8');
  console.log(await p.evaluate(async ([x1, x2]) => {
    const { joinMovements, fixOmrScore } = await import('/resonate/omr/fixscore.js');
    const { parseMusicXml } = await import('/resonate/musicxml.js');
    const j = joinMovements([x1, x2]);
    const f = fixOmrScore(j);
    const sc = parseMusicXml(f.xml);
    const s1 = parseMusicXml(x1), s2 = parseMusicXml(x2);
    return `mvt1 ${s1.notes.length} notes/${s1.measures.length} measures, mvt2 ${s2.notes.length}/${s2.measures.length} → joined ${sc.notes.length} notes/${sc.measures.length} measures, ${sc.beats}/${sc.beatType}, key ${sc.fifths}; fixes: ${f.changes.join(' | ')}`;
  }, [x1, x2]));
  for (const pdf of ['/wl.pdf', '/killing.pdf', '/songbird.pdf', '/two.pdf']) {
    const r = await p.evaluate(async (pdf) => {
      const { renderPdf } = await import('/resonate/omr/pdfprep.js');
      const { pdfTitle } = await import('/resonate/omr/omr.js');
      const data = new Uint8Array(await (await fetch(pdf)).arrayBuffer());
      const pages = await renderPdf(data, { pdfjsBase: '/resonate/omr/pdfjs' });
      const first = pages.find((x) => x.staves > 0)?.index ?? 1;
      return { title: pdfTitle(pages, first), lines: pages.filter((x) => x.index <= first).map((x) => `p${x.index}: ` + x.lines.slice(0, 4).map((l) => `${l.text}(${l.size})`).join(' | ')) };
    }, pdf);
    console.log(pdf, '→', JSON.stringify(r.title), '\n   ' + r.lines.join('\n   '));
  }
  await b.close();
})();
