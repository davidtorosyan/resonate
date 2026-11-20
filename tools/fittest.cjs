// fitToRange on real scores × voice types.
const { chromium } = require('playwright'); const fs = require('fs');
const files = {
  songbird: '/root/.claude/uploads/6042bc19-5f16-52ea-a295-8ea17a932323/c6b79cee-Hey_Little_Songbird_-_C_Minor_-_MN0230233_3.musicxml',
  killing: '/home/user/sitetest/tmp/km.musicxml',
  grace: '/home/user/resonate/public/songs/amazing-grace.musicxml',
  susanna: '/home/user/sitetest/tmp/gt-oh-susanna.musicxml',
};
const voices = { bass: [40, 64, 43, 60], baritone: [43, 67, 46, 63], tenor: [48, 72, 50, 69], alto: [53, 77, 55, 72], soprano: [60, 84, 62, 79] };
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('http://localhost:8097/resonate/sing.html'); await p.waitForTimeout(500);
  for (const [name, f] of Object.entries(files)) {
    const xml = fs.readFileSync(f, 'utf8');
    const out = await p.evaluate(async ({ xml, voices }) => {
      const { parseMusicXml } = await import('/resonate/musicxml.js');
      const { fixOmrScore } = await import('/resonate/omr/fixscore.js');
      const { fitToRange } = await import('/resonate/fit.js?' + Date.now());
      const { noteName } = await import('/resonate/music.js');
      const x = /<software>\s*Audiveris/.test(xml.slice(0, 4000)) ? fixOmrScore(xml).xml : xml;
      const sc = parseMusicXml(x);
      const ms = sc.notes.map((n) => n.midi);
      const lines = [`${sc.title}: ${sc.notes.length} notes, ${noteName(Math.min(...ms))}–${noteName(Math.max(...ms))}`];
      for (const [v, [low, high, cl, ch]] of Object.entries(voices)) {
        const t0 = performance.now();
        const r = fitToRange(sc.notes, { low, high, comfortLow: cl, comfortHigh: ch });
        const shifted = sc.notes.map((n, i) => n.midi + r.shifts[i]);
        lines.push(`  ${v.padEnd(8)} comfy ${noteName(cl)}–${noteName(ch)}: key ${r.key > 0 ? '+' : ''}${r.key}, phrases ${r.phrases}, moves ${r.moves.map((m) => `${m.shift > 0 ? "+" : ""}${m.shift}×${m.phrases}`).join(" ")}, now ${noteName(Math.min(...shifted))}–${noteName(Math.max(...shifted))}, outside ${(r.outside * 100).toFixed(0)}%, beyond ${(r.beyond * 100).toFixed(0)}% (${(performance.now() - t0).toFixed(0)} ms)`);
      }
      return lines.join('\n');
    }, { xml, voices });
    console.log(out);
  }
  await b.close();
})();
