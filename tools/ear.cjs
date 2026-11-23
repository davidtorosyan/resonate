// Ear (E8 prototype, sing.js "Ear"; docs/EAR.md) with a simulated singer (a sawtooth through a fake getUserMedia),
// on Amazing Grace's first phrase, sing.html (the shell mounts the same page):
//   1 the free attempt — on its own time, 15 % slower, its 3rd note 2 semitones flat: the tempo found
//     (within 6 %), ♪ one short with the cue on that note ("· higher"), ♩ 7 or more, an answer in < 1 s
//   2 again, 10 % faster, every note right: "♩ all of them · ♪ all of them"
//   3 Beats — sing with the click (the guided take path): ♩ all of them, "In on …"
//   4 Notes — the first target held an octave down (matched, "an octave down — fine"), the next on pitch:
//     every target done → back to Sing
//   no lane shown, no page errors
//   node ear.cjs   (BASE: the harness, http://localhost:8097/resonate/)
const { chromium } = require('playwright');
const { ok, done } = require('./lib/check.cjs');
const { BASE } = require('./lib/paths.cjs');
const sleep = (t) => new Promise((r) => setTimeout(r, t));
(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => {
    if (location.protocol === 'about:') return;
    try { localStorage.setItem('resonate.sing.song', 'amazing-grace'); localStorage.setItem('resonate.shell.modules', JSON.stringify({ phone: ['sing'], tablet: ['sing'], desktop: ['sing'] })); } catch {}
    if (!navigator.audioSession) Object.defineProperty(navigator, 'audioSession', { configurable: true, value: { type: 'auto' } });
    window.__plan = { free: null, wrong: [], hold: false, holdBy: 0 };
    let shared = null;
    navigator.mediaDevices.getUserMedia = async () => {
      if (!shared) {
        const ac = new AudioContext();
        const osc = ac.createOscillator(); osc.type = 'sawtooth';
        const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2500;
        const g = ac.createGain(); g.gain.value = 0;
        const dest = ac.createMediaStreamDestination();
        osc.connect(lp); lp.connect(g); g.connect(dest); osc.start();
        setInterval(() => {
          const d = window.resonateDebug?.(); const P = window.__plan; let m = null;
          if (!d) return;
          if (d.ear.run === 'free' && P.free) {
            const t = (performance.now() - P.free.at) / 1000 / P.free.f; // (song seconds since the phrase's start, slower)
            const [a, z] = [d.ear.ph.j0, d.ear.ph.j1], T0 = d.notes[a].t;
            const i = d.notes.findIndex((n, k) => k >= a && k < z && n.t - T0 <= t && t < n.t - T0 + n.d - 0.04);
            if (i >= 0) m = d.notes[i].midi + (P.wrong.includes(i) ? -2 : 0);
          } else if (d.session?.kind === 'sing') {
            const t = d.nowT, [a, z] = d.take?.range || [0, d.notes.length];
            const i = d.notes.findIndex((n, k) => k >= a && k < z && n.t <= t && t < n.t + n.d - 0.04);
            if (i >= 0) m = d.notes[i].midi;
          } else if (d.ear.run === 'hold' && P.hold) {
            const N = d.ear.notes; m = d.notes[N.targets[N.i]].midi + P.holdBy;
          }
          if (m === null) g.gain.setTargetAtTime(0, ac.currentTime, 0.005);
          else { osc.frequency.setValueAtTime(440 * 2 ** ((m - 69) / 12), ac.currentTime); g.gain.setTargetAtTime(0.25, ac.currentTime, 0.005); }
        }, 5);
        shared = dest.stream;
      }
      return shared.clone();
    };
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console ' + m.text().slice(0, 200)); });
  await page.goto(BASE + 'sing.html');
  await page.waitForFunction(() => window.resonateDebug?.().ear?.on && document.getElementById('ear-words').textContent, null, { timeout: 30000 });
  const ear = () => page.evaluate(() => ({ ...window.resonateDebug().ear, ui: document.getElementById('ear-res').innerText.replace(/\n/g, ' | '), notesUi: document.getElementById('ear-notes').innerText.replace(/\n/g, ' ') }));
  // 1. the free attempt: 1.5 s after the tap, 15% slower, the 3rd note flat
  let d = await ear();
  await page.evaluate((ph) => { window.__plan.wrong = [ph.j0 + 2]; }, d.ph);
  await page.click('#sing');
  await page.waitForFunction(() => document.getElementById('sing').textContent === '■ Done', null, { timeout: 10000 });
  await page.evaluate(() => { window.__plan.free = { at: performance.now() + 1500, f: 1.15 }; });
  const dur = await page.evaluate(() => { const d = window.resonateDebug(); const a = d.ear.ph.j0, z = d.ear.ph.j1; return d.notes[z - 1].t + d.notes[z - 1].d - d.notes[a].t; });
  await sleep(1500 + dur * 1.15 * 1000 + 800);
  const t0 = Date.now();
  await page.click('#sing');
  await page.waitForFunction(() => { const e = window.resonateDebug().ear; return e.res && e.run === null; }, null, { timeout: 15000 });
  const ms = Date.now() - t0;
  let r = (await ear()).res;
  const flat = await page.evaluate(() => window.resonateDebug().ear.ph.j0 + 2);
  ok(r.fit && Math.abs(r.fit.b - 1.15) <= 0.07, `1: the singer's own tempo found (×${r.fit?.b.toFixed(2)}, sung ×1.15)`);
  ok(r.counts && !r.counts.notesAll && r.cue?.j === flat && /higher/.test(r.cue.text), `1: ♪ ${r.counts?.notes}, the cue on the flat note: “${r.cue?.text}”`);
  ok(r.counts?.beats >= 7, `1: ♩ ${r.counts?.beats} (a steady singer, one note flat)`);
  ok(ms < 1500, `1: the answer in ${ms} ms`);
  ok(!(await page.evaluate(() => getComputedStyle(document.getElementById('lane')).display !== 'none')), '1: no lane shown');
  // 2. again, all right → ↑ / all of them
  await page.evaluate(() => { window.__plan.wrong = []; window.__plan.free = null; });
  await page.click('#sing');
  await page.waitForFunction(() => document.getElementById('sing').textContent === '■ Done', null, { timeout: 10000 });
  await page.evaluate(() => { window.__plan.free = { at: performance.now() + 900, f: 0.9 }; });
  await sleep(900 + dur * 0.9 * 1000 + 800);
  await page.click('#sing');
  await page.waitForFunction(() => { const e = window.resonateDebug().ear; return e.res && e.run === null; }, null, { timeout: 15000 });
  r = (await ear()).res;
  ok(r.counts?.notesAll && r.counts?.beatsAll && /all of them.*all of them/.test((await ear()).ui), `2: every note right — “${(await ear()).ui}”`);
    // 3. Beats: the click take
  await page.click('.ear-modes button[data-ear="beats"]');
  await page.click('#sing');
  await page.waitForFunction(() => { const e = window.resonateDebug().ear; return e.res?.kind === 'beats'; }, null, { timeout: 40000 });
  r = (await ear()).res;
  ok(r.counts?.beatsAll && /^In on/.test(r.win?.text || ''), `3: Beats with the click — “${(await ear()).ui}”`);
    // 4. Notes: hold the first target an octave down, the second on pitch
  await page.click('.ear-modes button[data-ear="notes"]');
  await page.evaluate(() => { window.__plan.hold = true; window.__plan.holdBy = -12; });
  await page.click('#sing');
  await page.waitForFunction(() => (window.resonateDebug().ear.notes?.done || []).length >= 1, null, { timeout: 15000 });
  await sleep(900);
  ok(/octave down — fine/.test((await ear()).notes?.msg || ''), `4: the first target matched an octave down — “${(await ear()).notes?.msg}”`);
  await page.evaluate(() => { window.__plan.holdBy = 0; });
  await page.click('#sing');
  await page.waitForFunction(() => { const e = window.resonateDebug().ear; return (e.notes?.done || []).length >= 2 || e.mode === 'sing'; }, null, { timeout: 15000 });
  await sleep(1200);
  const e = await ear();
  ok(e.mode === 'sing' && /now the phrase/.test(e.res?.win?.text || ''), `4: every target matched → back to Sing (“${e.res?.win?.text}”)`);
    ok(!errs.length, `no page errors ${JSON.stringify(errs.slice(0, 3))}`);
  await browser.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
