// Unit test of public/omr/trace.js (the browser's WebTrace → Reader events): every saved native trace
// (fixtures/trace/*.trace) through createTrace() gives the same events as tracecheck.mjs --events
// (fixtures/trace/*.events.json), and ocrWords / ocr() map Tesseract's page-wide words back by the margin.
//   node tracejs.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
const { createTrace, ocrWords, OCR_MARGIN } = await import('../public/omr/trace.js');
const TRACE = /^([KBEGYNSF] [0-9]|[difymnr] |[+-][0-9])/;
const HEADER = /^([KBEGYNSF]) /;
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };
const dir = new URL('fixtures/trace', import.meta.url).pathname;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.trace'))) {
  const lines = fs.readFileSync(`${dir}/${f}`, 'utf8').split('\n').filter((l) => TRACE.test(l));
  const blocks = [];
  for (const l of lines) { if (HEADER.test(l)) blocks.push([l]); else if (blocks.length) blocks.at(-1).push(l); }
  const tr = createTrace();
  const got = blocks.flatMap((b) => tr.block(b.join('\n')));
  const want = JSON.parse(fs.readFileSync(`${dir}/${f.replace('.trace', '.events.json')}`, 'utf8')).events.map((e) => e.ev);
  const norm = (e) => { const c = JSON.parse(JSON.stringify(e)); if (c.t === 'sheet') delete c.step; if (c.t === 'notes') for (const n of c.notes) if (!n.syl) delete n.syl; return c; };
  let same = got.length === want.length, first = -1;
  for (let i = 0; i < Math.min(got.length, want.length); i++) {
    try { assert.deepStrictEqual(norm(got[i]), norm(want[i])); } catch { same = false; if (first < 0) first = i; }
  }
  ok(same && tr.state.bad === 0, `${f}: ${got.length} events = tracecheck's ${want.length}, bad records ${tr.state.bad}${first >= 0 ? ` (first diff #${first}: ${JSON.stringify(got[first]).slice(0, 200)} vs ${JSON.stringify(want[first]).slice(0, 200)})` : ''}`);
  const kinds = {}; for (const e of got) kinds[e.t] = (kinds[e.t] || 0) + 1;
  console.log('     ', JSON.stringify(kinds));
}
// OCR words: records from ocr-engine.js, the page-wide call (sheet + margin) placed, a crop not.
const recs = ['L', ['W', 110, 60, 40, 20, 91, 0, 0, 0, 0, 1, 0, 12, '-', '-', '-', '-', encodeURIComponent('Green sleeves')].join('\t'), ['S', 110, 60, 8, 20, 'G'].join('\t')].join('\n');
const w = ocrWords(recs);
ok(w.length === 1 && w[0].text === 'Green sleeves' && w[0].x === 110, `ocrWords: ${JSON.stringify(w)}`);
const tr = createTrace();
tr.block('B 1 LOAD'); tr.block('E 1 LOAD 120\nd 2550 3300'); tr.block('B 1 TEXTS');
const ev = tr.ocr({ width: 2550 + 2 * OCR_MARGIN, height: 3300 + 2 * OCR_MARGIN, words: w });
ok(ev.length === 1 && ev[0].t === 'words' && ev[0].s === 1 && ev[0].words[0].x === 100 && ev[0].words[0].y === 50, `page-wide OCR words → sheet pixels: ${JSON.stringify(ev)}`);
ok(tr.ocr({ width: 800, height: 120, words: w }).length === 0, 'a crop (not the page + margin) is not placed');
ok(createTrace().ocr({ width: 2570, height: 3320, words: w }).length === 0, 'words before any LOAD size are not placed');
// Robustness: junk never throws, counted as bad.
const t2 = createTrace();
const junk = ['', 'Q 1', 'B x LOAD', 'B 1 NOPE', 'Y 1 HEADS z', 'Y 1 HEADS 1\n+1 head 1 2', 'N 1 1\nn 1', 'G 1 1\nf 1 1 1'];
let threw = false; try { for (const j of junk) t2.block(j); } catch { threw = true; }
ok(!threw && t2.state.bad >= 6, `junk blocks: no throw, bad=${t2.state.bad}`);
// A failed sheet and a resumed book.
const t3 = createTrace();
const k = t3.block('K 3 1,2 -'); const fl = t3.block(`F 3 HEADS ${encodeURIComponent('no staff: oops')}`);
ok(k[0].milestone === 'book' && k[0].detail.n === 3 && k[0].detail.done.join() === '1,2', `K → book ${JSON.stringify(k[0].detail)}`);
ok(fl[0].t === 'sheet' && fl[0].state === 'failed' && fl[0].reason === 'no staff: oops' && fl[0].step === 'HEADS', `F → failed ${JSON.stringify(fl[0])}`);
// The log fallback's step lines (no trace): a one-page book's tag has no "#N".
const { stepOfLine } = await import('../public/omr/omr.js');
const one = stepOfLine('INFO  [score]                      null 0    | HEADS');
const three = stepOfLine('INFO  [killing#3]   null 0    | BEAMS');
ok(one?.sheet === 1 && one.step === 'HEADS' && three?.sheet === 3 && three.step === 'BEAMS' && !stepOfLine('INFO  [score]  null 0    | Book reaching PAGE'),
  `stepOfLine: [score] → ${JSON.stringify(one)}, [killing#3] → ${JSON.stringify(three)}`);
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
