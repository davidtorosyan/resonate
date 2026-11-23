// Each dumped song's fingering as text (public/fingertext.js), one file a song (tools/fingerjudge/README.md).
// usage: node text.cjs <xmldir> <outdir> [prefix]   (BASE = the page server)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const BASE = process.env.BASE || 'http://localhost:8097/resonate/';
const [dir, out, prefix = ''] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch(); const page = await b.newPage();
  await page.goto(BASE + 'tools.html');
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.musicxml') && f.startsWith(prefix)).sort()) {
    const xml = fs.readFileSync(path.join(dir, f), 'utf8');
    const r = await page.evaluate(async ({ xml, id }) => {
      const v = '?v=' + document.getElementById('version').textContent.trim().replace(/^v/, '');
      const { prepare } = await import('./playprep.js' + v);
      const { timeline } = await import('./playtime.js' + v);
      const { cleanXml } = await import('./catalog.js' + v);
      const F = await import('./fingering.js' + v);
      const { fingerNotes } = await import('./finger.js' + v);
      const { fingerText } = await import('./fingertext.js' + v);
      const x = cleanXml(xml); const P = prepare(x); const T = timeline(P.doc, P.facts);
      const kb = F.keyboardOf(P); const bpm = F.songTempo(id, x, T);
      const items = F.keyboardNotes(P, T, bpm, kb);
      const res = fingerNotes(items, { hand: F.HAND });
      const nums = [...[...P.doc.documentElement.children].find((c) => c.nodeName === 'part')?.children || []].filter((c) => c.nodeName === 'measure').map((m, i) => m.getAttribute('number') || String(i + 1));
      const data = fingerText({ fing: res, T, numberOf: (mi) => nums[mi] ?? String(mi + 1), title: id, song: id, facts: P.facts, doc: P.doc, hand: F.HAND, bpm, sig: F.xmlSig(x) });
      const ts = (/<time[^>]*>\s*<beats>(\d+)<\/beats>\s*<beat-type>(\d+)/.exec(x) || []).slice(1).join('/');
      const fifths = (/<fifths>(-?\d+)/.exec(x) || [])[1];
      return { bpm, ts, fifths, n: items.length, data };
    }, { xml, id: f.replace('.musicxml', '') });
    const d = r.data;
    const lines = [`# ${f.replace('.musicxml', '')} — ♩=${r.bpm}, time ${r.ts}, key fifths ${r.fifths}, ${r.n} keyboard notes, small hand`, ''];
    for (const bar of d.bars) lines.push(bar.text);
    lines.push('', `## moved to the other hand (${d.moved.length})`, ...d.moved.map((m) => JSON.stringify(m)));
    lines.push('', `## out of reach (${d.wide.length})`, ...d.wide.map((m) => JSON.stringify(m)));
    fs.writeFileSync(path.join(out, f.replace('.musicxml', '.txt')), lines.join('\n') + '\n');
    console.log(f, d.bars.length, 'bars', d.moved.length, 'moved', d.wide.length, 'wide');
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(2); });
