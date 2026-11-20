// Record page: a take's notes play back on piano a few seconds ahead at a time, each on time.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await (await b.newContext()).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => {
    localStorage.setItem('resonate.playMode', 'notes');
    // A simulated singer: a new note every 0.3 s.
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext();
      const osc = ac.createOscillator(); osc.type = 'sawtooth';
      const g = ac.createGain(); g.gain.value = 0.25;
      const dest = ac.createMediaStreamDestination();
      osc.connect(g); g.connect(dest); osc.start();
      const seq = [60, 62, 64, 65, 67, 69, 71, 72];
      for (let k = 0; k < 120; k++) {
        const t = ac.currentTime + k * 0.3;
        osc.frequency.setValueAtTime(220 * 2 ** ((seq[k % 8] - 57) / 12), t);
        g.gain.setValueAtTime(0.25, t); g.gain.setValueAtTime(0, t + 0.24);
      }
      return dest.stream;
    };
    window.__src = [];
    const S = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when = 0) { window.__src.push({ when, at: this.context.currentTime, dur: this.buffer?.duration || 0, ctx: this.context }); return S.apply(this, arguments); };
  });
  await p.goto('http://localhost:8097/resonate/record.html'); await p.waitForTimeout(800);
  await p.click('#rec'); await p.waitForTimeout(25000); await p.click('#rec'); await p.waitForTimeout(1000);
  await p.evaluate(() => { window.__src.length = 0; });
  await p.click('#play'); await p.waitForTimeout(9000);
  const r = await p.evaluate(() => {
    const d = window.resonateDebug();
    const piano = window.__src.filter((s) => s.dur > 2.5 && s.dur < 3.5);
    const t0 = piano[0].when - (d.segments[0].start - 0.05); // ANALYSIS_LAG
    const now = piano[0].ctx.currentTime - t0;
    const due = d.segments.filter((s) => s.start - 0.05 < now + 4);
    const miss = due.filter((s) => !piano.some((x) => Math.abs(x.when - (t0 + s.start - 0.05)) < 0.002));
    return { segs: d.segments.length, due: due.length, miss: miss.length, scheduled: piano.length, ahead: +Math.max(...piano.map((s) => s.when - s.at)).toFixed(2), playing: d.playing };
  });
  console.log(JSON.stringify(r), errs);
  const ok = r.playing && r.segs > 40 && r.due > 15 && r.miss === 0 && r.scheduled < r.segs && r.ahead <= 5.6 && !errs.length;
  console.log(ok ? 'PASS record playback scheduled ahead, every note on time' : 'FAIL');
  await b.close();
  process.exit(ok ? 0 : 1);
})();
