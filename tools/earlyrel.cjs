// holdPiano released before its start time: no full-gain blip.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('http://localhost:8097/resonate/sing.html'); await p.waitForTimeout(500);
  console.log(await p.evaluate(async () => {
    const { loadPiano, holdPiano } = await import('/resonate/piano.js?' + Math.random());
    const sr = 44100, ac = new OfflineAudioContext(1, sr * 1, sr);
    const piano = await loadPiano(ac);
    holdPiano(ac, piano, 0.1, 69, 1.4).release(0.05, 0.01); // cut before it starts
    const d = (await ac.startRendering()).getChannelData(0);
    let peak = 0; for (const x of d) peak = Math.max(peak, Math.abs(x));
    return `early cut: peak ${peak.toFixed(3)} (a normal press peaks ~0.34)`;
  }));
  await b.close();
})();
