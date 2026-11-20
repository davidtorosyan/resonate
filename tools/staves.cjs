// Run Resonate's pdfprep (pdf.js render + staff count) on a PDF in Chromium; save page PNGs (downscaled).
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const [pdf, outdir] = process.argv.slice(2);
  fs.mkdirSync(outdir, { recursive: true });
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('console', (m) => console.log('[page]', m.text()));
  await p.goto('http://localhost:8097/resonate/tools.html');
  const res = await p.evaluate(async (pdf) => {
    const { renderPdf } = await import('/resonate/omr/pdfprep.js');
    const data = new Uint8Array(await (await fetch(pdf)).arrayBuffer());
    const t0 = performance.now();
    const pages = await renderPdf(data, { pdfjsBase: '/resonate/omr/pdfjs' });
    const out = [];
    for (const pg of pages) {
      let dark = 0; for (let i = 0; i < pg.gray.length; i += 7) if (pg.gray[i] === 0) dark++;
      // downscaled preview
      const s = 4, w = Math.floor(pg.width / s), h = Math.floor(pg.height / s);
      const c = new OffscreenCanvas(w, h), ctx = c.getContext('2d'), im = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = pg.gray[(y * s) * pg.width + x * s]; const q = (y * w + x) * 4; im.data[q] = im.data[q + 1] = im.data[q + 2] = v; im.data[q + 3] = 255; }
      ctx.putImageData(im, 0, 0);
      const blob = await c.convertToBlob({ type: 'image/png' });
      const b64 = btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
      out.push({ i: pg.index, w: pg.width, h: pg.height, staves: pg.staves, darkPct: +(100 * dark * 7 / pg.gray.length).toFixed(2), png: b64 });
    }
    return { ms: Math.round(performance.now() - t0), out };
  }, pdf);
  for (const o of res.out) { fs.writeFileSync(`${outdir}/p${o.i}.png`, Buffer.from(o.png, 'base64')); console.log(`page ${o.i}: ${o.w}x${o.h} staves=${o.staves} dark=${o.darkPct}%`); }
  console.log('ms', res.ms);
  await b.close();
})();
