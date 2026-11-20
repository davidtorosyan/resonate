const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('pageerror', (e) => console.log('ERR', e.message));
  await p.goto('http://localhost:8097/resonate/sing.html'); await p.waitForTimeout(300);
  // pdfTitle on synthetic pages (Musicnotes template + others)
  const L = (text, size) => ({ text, size });
  const cases = {
    'Phoenix (title starts with By)': [{ index: 1, lines: [L('By the Time I Get to Phoenix', 18.1), L('Authorized for use by David Torosyan', 13), L('Universal Music Publishing Group', 12.4), L('by', 10.8), L('JIMMY WEBB', 10.8)] }, { index: 2, lines: [L('BY THE TIME I GET TO PHOENIX', 22), L('Words and Music by', 10), L('JIMMY WEBB', 10)] }],
    'MacArthur Park (caps heading, mixed title page)': [{ index: 1, lines: [L('MacArthur Park', 18.1), L('Authorized for use by David Torosyan', 13)] }, { index: 2, lines: [L('MACARTHUR PARK', 22)] }],
    'SOS (caps only)': [{ index: 2, lines: [L('SOS', 22), L('Words and Music by Benny Andersson', 10)] }],
    'Title filtered (contains "Copyright"), only credits left': [{ index: 1, lines: [L('Copyright Love Song', 18), L('Authorized for use by David Torosyan', 13), L('Some Publisher Group', 12.4)] }],
    'Hal Leonard style: title, subtitle, composer': [{ index: 1, lines: [L('Hallelujah', 24), L('from SHREK', 12), L('Words and Music by Leonard Cohen', 10), L('Moderately slow', 9)] }],
    'Wichita (real lines)': null, 
  };
  for (const [name, pages] of Object.entries(cases)) {
    if (!pages) continue;
    const t = await p.evaluate(async (pages) => { const { pdfTitle } = await import('/resonate/omr/omr.js?' + Math.random()); return pdfTitle(pages, Math.max(...pages.map((x) => x.index))); }, pages);
    console.log(`pdfTitle ${name}: ${JSON.stringify(t)}`);
  }
  for (const pdf of ['/wl.pdf', '/killing.pdf', '/songbird.pdf']) {
    const t = await p.evaluate(async (pdf) => {
      const { renderPdf } = await import('/resonate/omr/pdfprep.js');
      const { pdfTitle } = await import('/resonate/omr/omr.js');
      const pages = await renderPdf(new Uint8Array(await (await fetch(pdf)).arrayBuffer()), { pdfjsBase: '/resonate/omr/pdfjs' });
      return pdfTitle(pages, pages.find((x) => x.staves > 0).index);
    }, pdf);
    console.log(`pdfTitle ${pdf}: ${JSON.stringify(t)}`);
  }
  const src = fs.readFileSync('/home/user/resonate/public/omr/importer.js', 'utf8'); // v81: moved from pdf-import.js
  const chunk = src.slice(src.indexOf('const NOT_TITLE'), src.indexOf('export function setTitle')).replace(/^export /gm, '');
  const credits = (pairs) => `<score-partwise>${pairs.map(([t, s]) => `<credit page="1"><credit-words font-size="${s}">${t}</credit-words></credit>`).join('')}</score-partwise>`;
  const songbirdCredits = credits([['(Hadestown)', 9], ['Hey, Little Songbird', 14], ['Authorized for use by: David Torosyan', 10]]);
  for (const [name, xml] of [
    ['Wichita_Lineman_-_F_Major_-_MN0305807', credits([['Blzmaj7', 18], ['Authorized for use by: David Torosyan', 10]])],
    ['Hey_Little_Songbird_-_C_Minor_-_MN0230233', songbirdCredits],
    ['1999_-_C_Major_-_MN0230233', songbirdCredits],
    ['Scanned Document 2', songbirdCredits],
    ['IMG_0042', songbirdCredits],
    ['scan0001', credits([['Blzmaj7', 18], ['1999', 14]])],
    ['Moon River', songbirdCredits],
  ]) {
    const t = await p.evaluate(([chunk, name, xml]) => new Function('name', 'xml', `let baseName = name; ${chunk}; return chooseTitle({ title: null }, xml, false, baseName);`)(name, xml), [chunk, name, xml]);
    console.log(`chooseTitle "${name}" → ${JSON.stringify(t)}`);
  }
  await b.close();
})();
