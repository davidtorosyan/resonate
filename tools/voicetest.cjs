// Voice page end to end with a simulated singer (oscillator as the mic): range G2–E4, anchor E3.
const { chromium } = require('playwright');
const SP = '/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/';
const LO = Number(process.env.LO || 43), HI = Number(process.env.HI || 64), ANCHOR = Number(process.env.ANCHOR || 52);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(({ LO, HI, ANCHOR }) => {
    window.__sim = { LO, HI, ANCHOR, sung: [] };
    // Fake iOS audio session + a record of what was true whenever a reference note started.
    window.__session = 'auto'; window.__notes = []; window.__streams = [];
    Object.defineProperty(navigator, 'audioSession', { value: { get type() { return window.__session; }, set type(v) { window.__session = v; } } });
    const S = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function () {
      window.__notes.push({ session: window.__session, micLive: window.__streams.some((s) => s.getTracks().some((t) => t.readyState === 'live')) });
      return S.apply(this, arguments);
    };
    let shared = null;
    navigator.mediaDevices.getUserMedia = async () => {
      if (shared) { const c = shared.clone(); window.__streams.push(c); return c; }
      const ac = new AudioContext();
      const osc = ac.createOscillator(); osc.type = 'sawtooth';
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2500;
      const g = ac.createGain(); g.gain.value = 0;
      const dest = ac.createMediaStreamDestination();
      osc.connect(lp); lp.connect(g); g.connect(dest); osc.start();
      const f = (m) => 440 * 2 ** ((m - 69) / 12);
      setInterval(() => {
        const d = window.resonateDebug?.(); const run = d?.run;
        let m = null, level = 0.25;
        if (run?.kind === 'range') {
          if (run.phase === 'anchor') m = ANCHOR;
          else if (run.phase === 'listen') m = run.target >= LO && run.target <= HI ? run.target : null;
        } else if (run?.kind === 'vol') {
          if (run.phase === 'quiet') { m = ANCHOR; level = 0.02; }
          if (run.phase === 'loud') { m = ANCHOR; level = 0.5; }
        }
        if (m === null) g.gain.setTargetAtTime(0, ac.currentTime, 0.01);
        else { osc.frequency.setValueAtTime(f(m), ac.currentTime); g.gain.setTargetAtTime(level, ac.currentTime, 0.01); }
      }, 30);
      shared = dest.stream;
      const c = shared.clone(); window.__streams.push(c); return c;
    };
  }, { LO, HI, ANCHOR });
  await p.goto('http://localhost:8097/resonate/voice.html');
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('resonate.volCal', JSON.stringify({ floor: -44, ceiling: -12 })); });
  await p.reload(); await p.waitForTimeout(500);
  await p.screenshot({ path: SP + 'voice-empty.png' });
  await p.fill('#create-name', 'Dave'); await p.click('#create-btn');
  console.log('created:', JSON.stringify((await p.evaluate(() => window.resonateDebug().profiles)).list[0]));
  await p.click('#range-btn');
  const t0 = Date.now(); let last = '';
  for (;;) {
    await p.waitForTimeout(500);
    const d = await p.evaluate(() => window.resonateDebug());
    const s = d.run ? `${d.run.phase} dir ${d.run.dir} target ${d.run.target}` : 'done';
    if (d.run?.phase === 'listen' && s !== last) { last = s; process.stdout.write(`${d.run.target}${d.run.dir < 0 ? '↓' : '↑'} `); }
    if (d.run?.phase === 'listen' && !(await p.$('#test[hidden]')) && !global.shot) { global.shot = 1; await p.screenshot({ path: SP + 'voice-test.png' }); }
    if (!d.run) break;
    if (Date.now() - t0 > 240000) { console.log('TIMEOUT', s); break; }
  }
  console.log(`\nrange test took ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const prof = (await p.evaluate(() => window.resonateDebug().profiles)).list[0];
  console.log('range:', JSON.stringify(prof.range), 'expected low', LO, 'high', HI);
  console.log('msg:', await p.textContent('#msg'));
  const notesLog = await p.evaluate(() => window.__notes);
  console.log('reference notes:', notesLog.length, 'with the mic live:', notesLog.filter((n) => n.micLive).length, 'sessions:', [...new Set(notesLog.map((n) => n.session))].join(','), 'streams opened:', await p.evaluate(() => window.__streams.length), 'still live:', await p.evaluate(() => window.__streams.filter((s) => s.getTracks().some((t) => t.readyState === 'live')).length));
  await p.screenshot({ path: SP + 'voice-range.png', fullPage: true });
  // Steppers: comfortable low +1, and an invalid move.
  await p.locator('.stepper[data-k="comfortLow"] button').last().click();
  console.log('after +1:', JSON.stringify((await p.evaluate(() => window.resonateDebug().profiles)).list[0].range));
  // Volume
  await p.click('#vol-btn');
  for (let i = 0; i < 40; i++) { await p.waitForTimeout(300); if (!(await p.evaluate(() => window.resonateDebug().run))) break; }
  console.log('vol:', JSON.stringify((await p.evaluate(() => window.resonateDebug().profiles)).list[0].vol), 'msg:', await p.textContent('#msg'));
  console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'no page errors');
  await b.close();
})();
