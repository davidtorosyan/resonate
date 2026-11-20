// Sing page grading with a simulated singer: OFFSET s early/late, optional noise (loud, no pitch) on some notes.
const { chromium } = require('playwright');
const OFFSET = Number(process.env.OFFSET ?? -0.15), NOISE = (process.env.NOISE || '').split(',').filter(Boolean).map(Number);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(({ OFFSET, NOISE }) => {
    let shared = null;
    navigator.mediaDevices.getUserMedia = async () => {
      if (!shared) {
        const ac = new AudioContext();
        const osc = ac.createOscillator(); osc.type = 'sawtooth';
        const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2500;
        const g = ac.createGain(); g.gain.value = 0;
        const nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate); const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        const ns = ac.createBufferSource(); ns.buffer = nb; ns.loop = true; const ng = ac.createGain(); ng.gain.value = 0;
        const dest = ac.createMediaStreamDestination();
        osc.connect(lp); lp.connect(g); g.connect(dest); osc.start(); ns.connect(ng); ng.connect(dest); ns.start();
        setInterval(() => {
          const dbg = window.resonateDebug?.(); let m = null, noise = false;
          if (dbg?.session?.kind === 'sing') {
            const t = dbg.nowT - OFFSET; // sing what's due OFFSET later (early when negative)
            const i = dbg.notes.findIndex((n) => n.t <= t && t < n.t + n.d);
            if (i >= 0) { if (NOISE.includes(i)) noise = true; else m = dbg.notes[i].midi; }
          }
          ng.gain.setTargetAtTime(noise ? 0.3 : 0, ac.currentTime, 0.005);
          if (m === null) g.gain.setTargetAtTime(0, ac.currentTime, 0.005);
          else { osc.frequency.setValueAtTime(440 * 2 ** ((m - 69) / 12), ac.currentTime); g.gain.setTargetAtTime(0.25, ac.currentTime, 0.005); }
        }, 5);
        shared = dest.stream;
      }
      return shared.clone();
    };
  }, { OFFSET, NOISE });
  await p.goto('http://localhost:8097/resonate/sing.html'); await p.waitForTimeout(1500);
  await p.click('#sing'); await p.waitForTimeout(19000); await p.click('#sing'); await p.waitForTimeout(1500);
  const r = await p.evaluate(() => ({ pct: document.getElementById('score-pct').textContent, sum: document.getElementById('summary').textContent,
    g: window.resonateDebug().take.grades.map((g) => g ? g.status[0] + (g.shift !== undefined ? Math.round(g.shift * 100) : '') : '-').join(' ') }));
  console.log(`offset ${OFFSET} noise [${NOISE}]:`, r.pct, '|', r.sum, '\n  ', r.g);
  if (errs.length) console.log('errors', errs);
  await p.screenshot({ path: '/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/gradeearly.png' });
  await b.close();
})();
