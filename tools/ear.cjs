// Ear (E8 prototype, sing.js "Ear", ear.js; docs/EAR.md) with a simulated singer (a sawtooth through a fake
// getUserMedia: tools/lib/earsinger.cjs, the probes' singer), on Amazing Grace's first phrase, sing.html (the shell
// mounts the same page):
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
const { SINGER } = require('./lib/earsinger.cjs');
const sleep = (t) => new Promise((r) => setTimeout(r, t));
(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => {
    if (location.protocol === 'about:') return;
    try { localStorage.setItem('resonate.sing.song', 'amazing-grace'); localStorage.setItem('resonate.shell.modules', JSON.stringify({ phone: ['sing'], tablet: ['sing'], desktop: ['sing'] })); } catch {}
  });
  await ctx.addInitScript(SINGER); // (window.__sing: the plan sung; indices in the phrase)
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console ' + m.text().slice(0, 200)); });
  await page.goto(BASE + 'sing.html');
  await page.waitForFunction(() => window.resonateDebug?.().ear?.on && document.getElementById('ear-words').textContent, null, { timeout: 30000 });
  const ear = () => page.evaluate(() => ({ ...window.resonateDebug().ear, ui: document.getElementById('ear-res').innerText.replace(/\n/g, ' | '), notesUi: document.getElementById('ear-notes').innerText.replace(/\n/g, ' ') }));
  // 1. the free attempt: 1.5 s after the tap, 15% slower, the 3rd note flat
  await page.click('#sing');
  await page.waitForFunction(() => document.getElementById('sing').textContent === '■ Done', null, { timeout: 10000 });
  await page.evaluate(() => { window.__sing = { mode: 'free', at: performance.now() + 1500, f: 1.15, cents: { 2: -200 } }; });
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
  ok(r.cue?.kind === 'pitch' && r.cue.dir === 'higher' && r.grades?.length === 11, `1: the result as debug shows it — cue ${r.cue?.kind} ${r.cue?.dir}, ${r.grades?.length} grades`);
  // (the singer's plan, indices in the phrase: only its note 2 sung low, every start where it's written)
  const sung = await page.evaluate(() => { const u = window.__sung, d = window.resonateDebug(), a = d.ear.ph.j0; return u && u.segs.map((o) => ({ i: o.i, moved: o.s - o.w, off: Math.round((o.m - d.notes[a + o.i].midi) * 100) })); });
  ok(sung && sung.length === 11 && sung.every((o) => Math.abs(o.moved) < 1e-9 && o.off === (o.i === 2 ? -200 : 0)), `1: the singer sang the plan (${JSON.stringify(sung?.filter((o) => o.off || o.moved))})`);
  ok(r.counts?.beats >= 7, `1: ♩ ${r.counts?.beats} (a steady singer, one note flat)`);
  ok(ms < 1500, `1: the answer in ${ms} ms`);
  ok(!(await page.evaluate(() => getComputedStyle(document.getElementById('lane')).display !== 'none')), '1: no lane shown');
  // 2. again, all right → ↑ / all of them
  await page.evaluate(() => { window.__sing = null; });
  await page.click('#sing');
  await page.waitForFunction(() => document.getElementById('sing').textContent === '■ Done', null, { timeout: 10000 });
  await page.evaluate(() => { window.__sing = { mode: 'free', at: performance.now() + 900, f: 0.9 }; });
  await sleep(900 + dur * 0.9 * 1000 + 800);
  await page.click('#sing');
  await page.waitForFunction(() => { const e = window.resonateDebug().ear; return e.res && e.run === null; }, null, { timeout: 15000 });
  r = (await ear()).res;
  ok(r.counts?.notesAll && r.counts?.beatsAll && /all of them.*all of them/.test((await ear()).ui), `2: every note right — “${(await ear()).ui}”`);
    // 3. Beats: the click take
  await page.evaluate(() => { window.__sing = { mode: 'beats' }; });
  await page.click('.ear-modes button[data-ear="beats"]');
  await page.click('#sing');
  await page.waitForFunction(() => { const e = window.resonateDebug().ear; return e.res?.kind === 'beats'; }, null, { timeout: 40000 });
  r = (await ear()).res;
  ok(r.counts?.beatsAll && /^In on/.test(r.win?.text || ''), `3: Beats with the click — “${(await ear()).ui}”`);
  ok(r.win?.kind === 'entry' && r.onsets?.of === 8 && r.onsets.measured === 8, `3: every start measured (${JSON.stringify(r.onsets)})`);
    // 4. Notes: hold the first target an octave down, the second on pitch
  await page.click('.ear-modes button[data-ear="notes"]');
  await page.evaluate(() => { window.__sing = { mode: 'hold', by: -12 }; });
  await page.click('#sing');
  await page.waitForFunction(() => (window.resonateDebug().ear.notes?.done || []).length >= 1, null, { timeout: 15000 });
  await sleep(900);
  ok(/octave down — fine/.test((await ear()).notes?.msg || ''), `4: the first target matched an octave down — “${(await ear()).notes?.msg}”`);
  await page.evaluate(() => { window.__sing = { mode: 'hold', by: 0 }; });
  await page.click('#sing');
  await page.waitForFunction(() => { const e = window.resonateDebug().ear; return (e.notes?.done || []).length >= 2 || e.mode === 'sing'; }, null, { timeout: 15000 });
  await sleep(1200);
  const e = await ear();
  ok(e.mode === 'sing' && /now the phrase/.test(e.res?.win?.text || ''), `4: every target matched → back to Sing (“${e.res?.win?.text}”)`);
    ok(!errs.length, `no page errors ${JSON.stringify(errs.slice(0, 3))}`);
  await browser.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
