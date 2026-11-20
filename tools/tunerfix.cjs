// Tuner Start after another page left the (iOS) audio session on "playback"; errors visible; hung mic.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };
  const page = async (mode) => {
    const p = await b.newPage({ viewport: { width: 390, height: 844 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.addInitScript((mode) => {
      window.__session = 'playback'; // what the Sing page left behind
      window.__gum = 0;
      Object.defineProperty(navigator, 'audioSession', { value: { get type() { return window.__session; }, set type(v) { window.__session = v; } } });
      navigator.mediaDevices.getUserMedia = async () => {
        window.__gum++;
        if (window.__session === 'playback') throw new DOMException('playback session', 'InvalidAccessError');
        if (mode === 'denied') throw new DOMException('denied', 'NotAllowedError');
        if (mode === 'hang' && window.__gum === 1) return new Promise(() => {});
        const ac = new AudioContext(); const osc = ac.createOscillator(); const d = ac.createMediaStreamDestination();
        osc.frequency.value = 220; osc.connect(d); osc.start(); return d.stream;
      };
    }, mode);
    await p.goto('http://localhost:8097/resonate/index.html'); await p.waitForTimeout(500);
    return { p, errs };
  };
  const st = (p) => p.evaluate(() => ({ status: document.getElementById('status').textContent, rec: document.getElementById('toggle').dataset.recording, disabled: document.getElementById('toggle').disabled, session: window.__session, gum: window.__gum, note: document.getElementById('note')?.textContent }));

  let { p, errs } = await page('ok');
  await p.click('#toggle'); await p.waitForTimeout(1500);
  let s = await st(p); console.log('start after Sing:', JSON.stringify(s));
  ok(s.rec === 'true' && s.session === 'play-and-record', 'Start works after the session was left on playback');
  await p.click('#toggle'); await p.waitForTimeout(300);
  s = await st(p); console.log('stop:', JSON.stringify(s));
  ok(s.rec === 'false' && s.session === 'auto' && !s.disabled, 'Stop gives the session back (auto)');
  await p.click('#toggle'); await p.waitForTimeout(800);
  s = await st(p); ok(s.rec === 'true', 'Start again works');
  await p.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await p.waitForTimeout(200);
  s = await st(p); ok(s.rec === 'false' && s.session === 'auto', 'pagehide stops and resets the session');
  console.log('errors:', errs); await p.close();

  ({ p, errs } = await page('denied'));
  await p.click('#toggle'); await p.waitForTimeout(800);
  s = await st(p); console.log('denied:', JSON.stringify(s));
  ok(s.status.includes('mic blocked') && !s.disabled && s.rec === 'false', 'a denied mic says so (not "idle")');
  await p.close();

  ({ p, errs } = await page('hang'));
  await p.click('#toggle'); await p.waitForTimeout(2000);
  s = await st(p); ok(s.disabled && s.status.includes('requesting'), 'waiting for the mic: button disabled');
  await p.waitForTimeout(6800);
  s = await st(p); console.log('hung 8.8 s:', JSON.stringify(s));
  ok(!s.disabled && s.status.includes('not answering'), 'a mic that never answers: Start can be tapped again');
  await p.click('#toggle'); await p.waitForTimeout(1000);
  s = await st(p); console.log('retry:', JSON.stringify(s));
  ok(s.rec === 'true', 'the retry starts');
  console.log('errors:', errs);
  await b.close();
})();
