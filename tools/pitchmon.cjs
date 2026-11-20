// Sing page pitch monitor (🎤 Pitch): simulated singer as the mic, fake iOS audio session.
const { chromium } = require('playwright');
const SP = '/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/';
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.addInitScript(() => {
    window.__session = 'auto'; window.__notes = []; window.__streams = []; window.__gum = 0; window.__sing = null; window.__states = [];
    const tick = () => { const y = document.getElementById('you'); const d = window.resonateDebug?.(); if (y && d?.session?.kind === 'sing' && d.nowT > 0.3) window.__states.push({ t: d.nowT, st: y.dataset.state || '', note: document.getElementById('you-note').textContent, vs: document.getElementById('you-vs').textContent }); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
    Object.defineProperty(navigator, 'audioSession', { value: { get type() { return window.__session; }, set type(v) { window.__session = v; } } });
    const live = () => window.__streams.some((s) => s.getTracks().some((t) => t.readyState === 'live'));
    window.__live = live;
    const S = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function () {
      if (this.buffer && this.buffer.duration > 1) window.__notes.push({ session: window.__session, micLive: live() });
      return S.apply(this, arguments);
    };
    let shared = null;
    navigator.mediaDevices.getUserMedia = async () => {
      window.__gum++;
      // Like WebKit: no capture while the session is set to playback.
      if (window.__session === 'playback') throw new DOMException('playback session', 'InvalidAccessError');
      await new Promise((r) => setTimeout(r, window.__gumDelay || 60));
      if (!shared) {
        const ac = new AudioContext();
        const osc = ac.createOscillator(); osc.type = 'sawtooth';
        const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2500;
        const g = ac.createGain(); g.gain.value = 0;
        const dest = ac.createMediaStreamDestination();
        osc.connect(lp); lp.connect(g); g.connect(dest); osc.start();
        setInterval(() => {
          const m = window.__sing;
          if (m === null) g.gain.setTargetAtTime(0, ac.currentTime, 0.01);
          else { osc.frequency.setValueAtTime(440 * 2 ** ((m - 69) / 12), ac.currentTime); g.gain.setTargetAtTime(0.25, ac.currentTime, 0.01); }
        }, 20);
        shared = dest.stream;
      }
      const c = shared.clone(); window.__streams.push(c); return c;
    };
  });
  await p.goto('http://localhost:8097/resonate/sing.html'); await p.waitForTimeout(1500);
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const chipXY = async (i) => { const r = await p.evaluate((i) => { const c = document.querySelectorAll('#chips .chip')[i]; c.scrollIntoView({ block: 'nearest' }); const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, i); await p.waitForTimeout(250); return r; };
  const st = () => p.evaluate(() => {
    const d = window.resonateDebug();
    return { mon: d.monitor, you: d.you === null ? null : +d.you.toFixed(2), practiceJ: d.practiceJ, session: window.__session, live: window.__live(),
      shown: !document.getElementById('you').hidden && document.getElementById('you').style.visibility !== 'hidden', state: document.getElementById('you').dataset.state || '',
      text: [...document.querySelectorAll('#you-note, #you-cents, #you-vs')].map((e) => e.textContent).join(' | '), btn: document.getElementById('monitor').getAttribute('aria-pressed') };
  });
  const notes = await p.evaluate(() => window.resonateDebug().notes.map((n) => ({ midi: n.midi, name: n.name })));
  const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };

  console.log('0 off:', JSON.stringify(await st()));
  // 1. Turn on, sing A3 with no target.
  await p.tap('#monitor'); await p.waitForTimeout(400);
  await p.evaluate(() => { window.__sing = 57; }); await p.waitForTimeout(500);
  let s = await st(); console.log('1 on, singing A3:', JSON.stringify(s));
  ok(s.mon?.listening && s.shown && s.text.startsWith('A3') && s.text.includes('tap a note') && s.session === 'play-and-record', 'monitor listens, shows A3, asks for a target');
  // 2. Press chip 2 and hold 700 ms: mic closed, note at full volume (playback session, no live track).
  const target = notes[2];
  let c = await chipXY(2);
  await touch('touchStart', [{ x: c.x, y: c.y, id: 1 }]); await p.waitForTimeout(300);
  s = await st(); console.log('2 key held:', JSON.stringify(s));
  ok(!s.mon.listening && !s.live && s.state === 'hear' && s.text.startsWith(target.name), 'mic closed while the key sounds; readout shows the note to match');
  await p.waitForTimeout(400);
  await touch('touchEnd', []); await p.waitForTimeout(150);
  s = await st(); ok(!s.mon.listening, 'still closed right after the release (note dying away)');
  await p.waitForTimeout(700);
  const n = await p.evaluate(() => window.__notes.splice(0));
  console.log('  piano notes started:', JSON.stringify(n));
  ok(n.length >= 1 && n.every((x) => x.session === 'playback' && !x.micLive), 'every piano note started with the mic closed, session playback');
  // 3. Sing the target an octave down → good.
  await p.evaluate((m) => { window.__sing = m; }, target.midi - 12); await p.waitForTimeout(500);
  s = await st(); console.log('3 sing target 8vb:', JSON.stringify(s));
  ok(s.mon.listening && s.state === 'good' && s.text.includes('✓ ' + target.name) && s.practiceJ === 2, 'matching the note (any octave) is green ✓');
  // 4. A semitone sharp → off, ↓; 35 cents flat → ok.
  await p.evaluate((m) => { window.__sing = m; }, target.midi + 1); await p.waitForTimeout(500);
  s = await st(); console.log('4a semitone sharp:', JSON.stringify(s));
  ok(s.state === 'off' && s.text.includes('↓ ' + target.name), 'sharp → red, sing lower');
  await p.evaluate((m) => { window.__sing = m; }, target.midi - 2); await p.waitForTimeout(500);
  s = await st(); ok(s.state === 'off' && s.text.includes('↑ ' + target.name), 'flat by a tone → sing higher');
  await p.evaluate((m) => { window.__sing = m; }, target.midi - 0.35); await p.waitForTimeout(500);
  s = await st(); console.log('4c 35¢ flat:', JSON.stringify(s));
  ok(s.state === 'ok' && s.text.includes('-35¢') || s.text.includes('−35¢') || s.state === 'ok', '35¢ flat → close (purple)');
  await p.screenshot({ path: SP + 'pitchmon.png' });
  // 5. Silence → "sing X".
  await p.evaluate(() => { window.__sing = null; }); await p.waitForTimeout(500);
  s = await st(); ok(s.text.startsWith('–') && s.text.includes('sing ' + target.name), 'silence → prompt to sing the note');
  // 6. Listen closes the mic; stopping it reopens.
  await p.tap('#listen'); await p.waitForTimeout(1500);
  s = await st(); console.log('6 listening:', JSON.stringify(s));
  ok(!s.mon.listening && !s.live && !s.shown, 'Listen: mic closed, readout hidden');
  const ln = await p.evaluate(() => window.__notes.splice(0));
  ok(ln.length > 0 && ln.every((x) => !x.micLive), 'Listen notes start with the mic closed');
  await p.tap('#listen'); await p.waitForTimeout(900);
  s = await st(); ok(s.mon.listening && s.shown, 'after Listen the monitor listens again');
  // 7. Sing: the take's mic drives the readout; monitor mic closed; resumes after.
  await p.evaluate((m) => { window.__sing = m; }, notes[0].midi);
  await p.tap('#sing'); await p.waitForTimeout(2500);
  s = await st(); console.log('7 singing:', JSON.stringify(s));
  ok(!s.mon.listening && s.shown, 'during a take: monitor mic closed, readout shown');
  await p.waitForTimeout(3000);
  s = await st(); console.log('  later:', JSON.stringify(s));
  await p.tap('#sing'); await p.waitForTimeout(1200);
  if (!(await p.$('#review[hidden]'))) await p.tap('#rv-close');
  s = await st(); console.log('7b after take:', JSON.stringify(s));
  ok(s.mon.listening && s.shown, 'after the take the monitor listens again');
  // 8. Off: tracks stopped, session auto.
  await p.tap('#monitor'); await p.waitForTimeout(300);
  s = await st(); console.log('8 off:', JSON.stringify(s));
  ok(!s.mon && !s.shown && !s.live && s.session === 'auto' && s.btn === 'false', 'off: no live track, session auto, readout hidden');
  // 9. On again, then hide the page → off.
  await p.tap('#monitor'); await p.waitForTimeout(500);
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForTimeout(200);
  s = await st(); ok(!s.mon && !s.live, 'backgrounded: monitor off');
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); });

  // 11. Pitch turned on during Listen: playback stays loud (session playback).
  await p.tap('#listen'); await p.waitForTimeout(1200);
  await p.tap('#monitor'); await p.waitForTimeout(400);
  s = await st(); console.log('11 on during Listen:', JSON.stringify(s));
  ok(s.session === 'playback' && !s.live && !s.mon.listening, 'Pitch on during Listen leaves the session on playback, mic closed');
  await p.tap('#listen'); await p.waitForTimeout(900);
  s = await st(); ok(s.mon.listening && s.session === 'play-and-record', 'listening after Listen stops');
  // 12. A chip tapped while the mic is reopening (slow getUserMedia): no error, monitor stays on and listens again.
  await p.evaluate(() => { window.__gumDelay = 600; });
  c = await chipXY(4);
  await touch('touchStart', [{ x: c.x, y: c.y, id: 1 }]); await p.waitForTimeout(400); await touch('touchEnd', []);
  await p.waitForTimeout(380); // the reopen has started (300 ms) and getUserMedia is pending
  c = await chipXY(5);
  const opening = (await st()).mon.opening;
  await touch('touchStart', [{ x: c.x, y: c.y, id: 1 }]); await p.waitForTimeout(40); await touch('touchEnd', []);
  await p.waitForTimeout(2500);
  s = await st(); const msg = await p.evaluate(() => { const m = document.getElementById('song-msg'); return m.hidden ? '' : m.textContent; });
  console.log('12 tap during reopen (opening was', opening, '):', JSON.stringify(s), 'msg:', msg);
  ok(opening && s.mon && s.mon.listening && !msg && s.session === 'play-and-record', 'a tap during the reopen: no error, listening again');
  const n12 = await p.evaluate(() => window.__notes.splice(0));
  ok(n12.every((x) => !x.micLive), 'notes start with no live mic track: ' + JSON.stringify(n12));
  await p.evaluate(() => { window.__gumDelay = 60; });
  // 13. A take sung exactly in time: the readout should rarely be red.
  await p.evaluate(() => {
    window.__states.length = 0;
    clearInterval(window.__follow);
    window.__follow = setInterval(() => {
      const d = window.resonateDebug(); if (d.session?.kind !== 'sing') { window.__sing = null; return; }
      const i = d.notes.findIndex((n) => n.t <= d.nowT && d.nowT < n.t + n.d); window.__sing = i >= 0 ? d.notes[i].midi : null;
    }, 5);
  });
  await p.tap('#sing'); await p.waitForTimeout(15000); await p.tap('#sing'); await p.waitForTimeout(1500);
  if (!(await p.$('#review[hidden]'))) await p.tap('#rv-close');
  const states = await p.evaluate(() => window.__states.filter((x) => x.note !== '–'));
  const pct = (await p.textContent('#score-pct'));
  const off = states.filter((x) => x.st === 'off');
  console.log('13 take', pct, 'voiced readout frames', states.length, 'off', off.length, off.slice(0, 6).map((x) => `${x.t.toFixed(2)} ${x.note} ${x.vs}`).join(' | '));
  ok(states.length > 100 && off.length / states.length < 0.05, 'exact singing: readout red < 5% of the time');
  await p.evaluate(() => clearInterval(window.__follow));
  // 14. Layout on a short phone (390×664) after a take with Pitch on: chips stay above the footer.
  await p.setViewportSize({ width: 390, height: 664 }); await p.waitForTimeout(500);
  const lay = await p.evaluate(() => { const c = document.getElementById('chips').getBoundingClientRect(), f = document.querySelector('footer').getBoundingClientRect(), h = document.querySelector('.results-head').getBoundingClientRect(), l = document.getElementById('lane').getBoundingClientRect(); return { chipsBottom: Math.round(c.bottom), chipsH: Math.round(c.height), footerTop: Math.round(f.top), headH: Math.round(h.height), laneH: Math.round(l.height) }; });
  console.log('14 layout 390×664:', JSON.stringify(lay));
  ok(lay.chipsBottom <= lay.footerTop + 1 && lay.chipsH >= 40, 'chips end above the footer');
  await p.screenshot({ path: SP + 'pitchmon-review.png' });
  await p.setViewportSize({ width: 390, height: 844 });
  // 10. pagehide resets the audio session.
  await p.tap('#monitor'); await p.waitForTimeout(500);
  await p.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  s = await st(); ok(!s.mon && !s.live && s.session === 'auto', 'pagehide: monitor off, session auto');
  console.log('getUserMedia calls:', await p.evaluate(() => window.__gum), 'errors:', errs);
  await b.close();
})();
