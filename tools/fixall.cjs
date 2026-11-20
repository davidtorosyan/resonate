// fixOmrScore changes on every test score (should be none for the key rule except where keys were missed).
const { chromium } = require('playwright'); const fs = require('fs');
const files = process.argv.slice(2);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('http://localhost:8097/resonate/sing.html'); await p.waitForTimeout(300);
  for (const f of files) {
    const xml = fs.readFileSync(f, 'utf8');
    const r = await p.evaluate(async (xml) => { const { fixOmrScore } = await import('/resonate/omr/fixscore.js?' + Math.random()); const a = fixOmrScore(xml); const b2 = fixOmrScore(a.xml); return { changes: a.changes, again: b2.changes }; }, xml);
    console.log(f.split('/').slice(-2).join('/'), '\n  ', r.changes.join('\n   ') || '(none)', '\n   idempotent:', r.again.filter((c) => /key/.test(c)).length === 0 ? 'yes' : 'NO ' + r.again.join(' | '));
  }
  await b.close();
})();
