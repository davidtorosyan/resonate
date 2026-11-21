// Review sheet after a take: simulated singer with wrong / silent / noisy lines; second take for progress.
const { chromium } = require('playwright');
const SP = '/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/';
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.addInitScript(() => {
    window.__plan = { wrong: [], silent: [], noise: [], offset: 0 };
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
          const dbg = window.resonateDebug?.(); let m = null, noise = false; const P = window.__plan;
          if (dbg?.session?.kind === 'sing') {
            const t = dbg.nowT - P.offset;
            const i = dbg.notes.findIndex((n) => n.t <= t && t < n.t + n.d);
            if (i >= 0 && !P.silent.includes(i)) { if (P.noise.includes(i)) noise = true; else m = dbg.notes[i].midi + (P.wrong.includes(i) ? -2 : 0); }
          }
          ng.gain.setTargetAtTime(noise ? 0.3 : 0, ac.currentTime, 0.005);
          if (m === null) g.gain.setTargetAtTime(0, ac.currentTime, 0.005);
          else { osc.frequency.setValueAtTime(440 * 2 ** ((m - 69) / 12), ac.currentTime); g.gain.setTargetAtTime(0.25, ac.currentTime, 0.005); }
        }, 5);
        shared = dest.stream;
      }
      return shared.clone();
    };
  });
  await p.goto('http://localhost:8097/resonate/sing.html'); await p.waitForTimeout(1500);
  await p.evaluate(() => localStorage.removeItem('resonate.sing.history'));
  const lines = await p.evaluate(() => window.resonateDebug().lines);
  console.log('lines:', lines.slice(0, 5).map((l) => l.join(',')).join(' | '));
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  // Take 1: line 1 two wrong notes, line 2 first two silent, line 3 noisy; 0.2 s late.
  await p.evaluate((L) => { window.__plan = { wrong: [L[1][1], L[1][2]], silent: [L[2][0], L[2][1], L[2][2]], noise: L[3].slice(0, 4), offset: 0.2 }; }, lines);
  const singFor = async () => {
    await p.click('#sing'); await p.waitForTimeout(2000);
    for (let i = 0; i < 120 && (await p.evaluate(() => window.resonateDebug().session?.kind === 'sing')); i++) await p.waitForTimeout(500);
    await p.waitForTimeout(1500);
  };
  const dur = await p.evaluate((L) => { const d = window.resonateDebug(); const last = d.notes[L[4][L[4].length - 1]]; return last.t + last.d; }, lines);
  await singFor(dur + 4.5);
  const sheet = () => p.evaluate(() => ({ open: !document.getElementById('review').hidden, headline: document.getElementById('rv-headline').textContent,
    wins: [...document.querySelectorAll('#rv-wins li')].map((e) => e.textContent), tip: document.getElementById('rv-tip').hidden ? '' : document.getElementById('rv-tip').textContent,
    work: [...document.querySelectorAll('#rv-work .rv-line')].map((e) => e.innerText.replace(/\n+/g, ' / ')), all: document.querySelectorAll('#rv-lines .rv-line').length,
    text: document.querySelector('#review .sheet').innerText, summary: document.getElementById('summary')?.textContent || '',
    rhythm: (() => { const r = window.resonateDebug().take.rhythm; return r && { cal: r.calibrated, lead: r.lead, obs: r.obs.map((o) => o.kind) }; })() }));
  let r = await sheet();
  console.log('take 1:', JSON.stringify(r, null, 1));
  ok(r.open && r.work.length >= 3, 'review opens after the take with lines to work on');
  ok(r.work.some((w) => /aim for/.test(w)) && r.work.some((w) => /Sing out on/.test(w)) && r.work.some((w) => /Closer to the mic/.test(w)), 'next steps: the note to aim for, sing out, closer to the mic');
  ok(!/\d\s*%/.test(r.text + r.summary) && !/GOOD|MISSED|▼/.test(r.text + r.summary), 'no scores, counts or ▼ anywhere');
  ok(r.rhythm && !r.rhythm.cal && !r.rhythm.obs.some((k) => k === 'behind' || k === 'ahead') && !/behind|ahead/.test(r.tip), 'no click in the mic (headphones-like): no claim about being behind overall');
  await p.screenshot({ path: SP + 'review1.png' });
  // Play a line: You, then Melody.
  await p.click('#rv-work .rv-line button[data-mode="voice"]'); await p.waitForTimeout(600);
  let s = await p.evaluate(() => ({ sess: window.resonateDebug().session, btn: document.querySelector('#rv-work .rv-line button[data-mode="voice"]').textContent }));
  ok(s.sess?.kind === 'playback' && s.sess.mode === 'voice' && s.btn.includes('Stop'), 'line playback (you) runs, button shows Stop: ' + JSON.stringify(s));
  await p.waitForTimeout(6000);
  s = await p.evaluate(() => window.resonateDebug().session);
  ok(!s, 'line playback stops at the end of the line');
  await p.click('#rv-work .rv-line button[data-mode="melody"]'); await p.waitForTimeout(400);
  await p.click('#rv-work .rv-line button[data-mode="melody"]'); await p.waitForTimeout(300);
  ok(!(await p.evaluate(() => window.resonateDebug().session)), 'tapping the playing button stops it');
  // Show on lane.
  await p.click('#rv-lines .rv-line:nth-child(3) .rv-text'); await p.waitForTimeout(300);
  r = await p.evaluate(() => ({ open: !document.getElementById('review').hidden, scrollT: window.resonateDebug().scrollT }));
  ok(!r.open && r.scrollT > 3, 'tapping a line closes the review and moves the lane there: ' + JSON.stringify(r));
  // Take 2: clean.
  await p.evaluate(() => { window.__plan = { wrong: [], silent: [], noise: [], offset: 0 }; });
  await singFor(dur + 4.5);
  r = await sheet();
  const ups = await p.evaluate(() => [...document.querySelectorAll('#rv-lines .rv-d')].map((e) => e.textContent));
  console.log('take 2:', JSON.stringify({ headline: r.headline, wins: r.wins, work: r.work, ups }));
  ok(r.wins.some((w) => /Better than last time|closer than last time/.test(w)) && ups.includes('↑'), 'progress said (no numbers): ' + JSON.stringify(r.wins));
  ok(!/\d\s*%/.test(r.text), 'still no scores');
  await p.screenshot({ path: SP + 'review2.png' });
  // Reopen via the Review button.
  await p.click('#rv-close'); await p.waitForTimeout(200); await p.click('#review-btn'); await p.waitForTimeout(200);
  ok(!(await p.$('#review[hidden]')), 'Review button reopens it');
  ok(!errs.length, 'no page errors ' + JSON.stringify(errs));
  await b.close();
})();
