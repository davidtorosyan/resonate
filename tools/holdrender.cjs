const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('http://localhost:8097/resonate/sing.html'); await p.waitForTimeout(500);
  console.log(await p.evaluate(async () => {
    const { loadPiano, holdPiano } = await import('/resonate/piano.js');
    const out = [];
    for (const [midi, rel] of [[69, 2.5], [48, 2.5], [40, 2.5], [69, 0.25]]) {
      const sr = 44100, ac = new OfflineAudioContext(1, sr * 3.5, sr);
      const piano = await loadPiano(ac);
      holdPiano(ac, piano, 0, midi, 1.4).release(rel);
      const d = (await ac.startRendering()).getChannelData(0);
      const db = (a, z) => { let s = 0; for (let i = Math.floor(a * sr); i < Math.floor(z * sr); i++) s += d[i] * d[i]; return (10 * Math.log10(s / ((z - a) * sr) + 1e-12)).toFixed(0); };
      let peak = 0; for (const x of d) peak = Math.max(peak, Math.abs(x));
      out.push(`midi ${midi}, release ${rel}s, peak ${peak.toFixed(2)}: ` + [0, 0.25, 0.5, 1, 1.5, 2, 2.4, 2.6, 2.8, 3.2].map((t) => `${t}s ${db(t, t + 0.1)}dB`).join(' '));
    }
    return out.join('\n');
  }));
  await b.close();
})();
