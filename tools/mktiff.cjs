// PDF → the exact TIFF the browser hands Audiveris (public/omr/pdfprep.js). usage: node mktiff.cjs /wl.pdf out.tif
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const [pdf, out] = process.argv.slice(2);
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('pageerror', (e) => console.log('ERR', e.message));
  await p.goto('http://localhost:8097/resonate/pdf-import.html');
  const info = await p.evaluate(async (pdf) => {
    const { renderPdf, buildTiff } = await import('/resonate/omr/pdfprep.js');
    const data = new Uint8Array(await (await fetch(pdf)).arrayBuffer());
    const pages = await renderPdf(data, { pdfjsBase: '/resonate/omr/pdfjs' });
    const keep = pages.filter((x) => x.staves > 0);
    window.__tiff = buildTiff(keep);
    return pages.map((x) => `page ${x.index}: ${x.width}x${x.height}, staves ${x.staves}${x.blank ? ' blank' : ''}`).join('\n') + `\nTIFF ${window.__tiff.length} bytes`;
  }, pdf);
  console.log(info);
  const len = await p.evaluate(() => window.__tiff.length);
  const fd = fs.openSync(out, 'w');
  for (let off = 0; off < len; off += 4 << 20) {
    const b64 = await p.evaluate(([o, n]) => { const s = window.__tiff.subarray(o, o + n); let bin = ''; for (let i = 0; i < s.length; i += 32768) bin += String.fromCharCode.apply(null, s.subarray(i, i + 32768)); return btoa(bin); }, [off, 4 << 20]);
    fs.writeSync(fd, Buffer.from(b64, 'base64'));
  }
  fs.closeSync(fd);
  await b.close();
})();
