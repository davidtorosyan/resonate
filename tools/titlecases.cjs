const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  let fails = 0;
  const check = (label, got, want) => { const good = got === want; if (!good) fails++; console.log(`${good ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(got)}${good ? '' : ` (want ${JSON.stringify(want)})`}`); };
  p.on('pageerror', (e) => { fails++; console.log('FAIL page error', e.message); });
  await p.goto('http://localhost:8097/resonate/tools.html'); await p.waitForTimeout(300);
  // pdfTitle on synthetic pages (Musicnotes template + others)
  const L = (text, size) => ({ text, size });
  const cases = {
    'Phoenix (title starts with By)': [{ index: 1, lines: [L('By the Time I Get to Phoenix', 18.1), L('Authorized for use by A. Buyer', 13), L('Universal Music Publishing Group', 12.4), L('by', 10.8), L('JIMMY WEBB', 10.8)] }, { index: 2, lines: [L('BY THE TIME I GET TO PHOENIX', 22), L('Words and Music by', 10), L('JIMMY WEBB', 10)] }],
    'MacArthur Park (caps heading, mixed title page)': [{ index: 1, lines: [L('MacArthur Park', 18.1), L('Authorized for use by A. Buyer', 13)] }, { index: 2, lines: [L('MACARTHUR PARK', 22)] }],
    'SOS (caps only)': [{ index: 2, lines: [L('SOS', 22), L('Words and Music by Benny Andersson', 10)] }],
    'Title filtered (contains "Copyright"), only credits left': [{ index: 1, lines: [L('Copyright Love Song', 18), L('Authorized for use by A. Buyer', 13), L('Some Publisher Group', 12.4)] }],
    'Hal Leonard style: title, subtitle, composer': [{ index: 1, lines: [L('Hallelujah', 24), L('from SHREK', 12), L('Words and Music by Leonard Cohen', 10), L('Moderately slow', 9)] }],
    'Wichita (real lines)': null, 
  };
  const want = {
    'Phoenix (title starts with By)': 'By the Time I Get to Phoenix',
    'MacArthur Park (caps heading, mixed title page)': 'MacArthur Park',
    'SOS (caps only)': 'SOS',
    'Title filtered (contains "Copyright"), only credits left': null,
    'Hal Leonard style: title, subtitle, composer': 'Hallelujah',
  };
  for (const [name, pages] of Object.entries(cases)) {
    if (!pages) continue;
    const t = await p.evaluate(async (pages) => { const { pdfTitle } = await import('/resonate/omr/omr.js?' + Math.random()); return pdfTitle(pages, Math.max(...pages.map((x) => x.index))); }, pages);
    check(`pdfTitle ${name}`, t, want[name]);
  }
  // The owner's PDFs (never in the repo): checked when /home/user/sitetest has them; a scan has no text layer.
  const wantPdf = { '/wl.pdf': 'Wichita Lineman', '/wichita.pdf': 'Wichita Lineman', '/killing.pdf': 'Killing Me Softly With His Song', '/songbird.pdf': null };
  for (const pdf of ['/wl.pdf', '/wichita.pdf', '/killing.pdf', '/songbird.pdf']) {
    if (!(await p.evaluate(async (pdf) => (await fetch(pdf, { method: 'HEAD' })).ok, pdf))) { console.log(`skip pdfTitle ${pdf}: not here`); continue; }
    const t = await p.evaluate(async (pdf) => {
      const { renderPdf } = await import('/resonate/omr/pdfprep.js');
      const { pdfTitle } = await import('/resonate/omr/omr.js');
      const pages = await renderPdf(new Uint8Array(await (await fetch(pdf)).arrayBuffer()), { pdfjsBase: '/resonate/omr/pdfjs' });
      return pdfTitle(pages, pages.find((x) => x.staves > 0).index);
    }, pdf);
    check(`pdfTitle ${pdf}`, t, wantPdf[pdf]);
  }
  const src = fs.readFileSync('/home/user/resonate/public/omr/importer.js', 'utf8'); // v81: moved from pdf-import.js
  const chunk = src.slice(src.indexOf('const NOT_TITLE'), src.indexOf('export function setTitle')).replace(/^export /gm, '');
  const credits = (pairs) => `<score-partwise>${pairs.map(([t, s]) => `<credit page="1"><credit-words font-size="${s}">${t}</credit-words></credit>`).join('')}</score-partwise>`;
  const songbirdCredits = credits([['(Hadestown)', 9], ['Hey, Little Songbird', 14], ['Authorized for use by: A. Buyer', 10]]);
  for (const [name, xml, title] of [
    ['Wichita_Lineman_-_F_Major_-_MN0305807', credits([['Blzmaj7', 18], ['Authorized for use by: A. Buyer', 10]]), 'Wichita Lineman'],
    ['Hey_Little_Songbird_-_C_Minor_-_MN0230233', songbirdCredits, 'Hey Little Songbird'],
    ['1999_-_C_Major_-_MN0230233', songbirdCredits, '1999'],
    ['Scanned Document 2', songbirdCredits, 'Hey, Little Songbird'], // a scanner's default name: the credits
    ['IMG_0042', songbirdCredits, 'Hey, Little Songbird'],
    ['scan0001', credits([['Blzmaj7', 18], ['1999', 14]]), 'scan0001'], // OCR junk only: the file name
    ['Moon River', songbirdCredits, 'Moon River'],
  ]) {
    const t = await p.evaluate(([chunk, name, xml]) => new Function('name', 'xml', `let baseName = name; ${chunk}; return chooseTitle({ title: null }, xml, false, baseName);`)(name, xml), [chunk, name, xml]);
    check(`chooseTitle "${name}"`, t, title);
  }
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'all ok');
  process.exit(fails ? 1 : 0);
})();
