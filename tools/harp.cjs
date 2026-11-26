// Harp (Tools → Harp): strings tuned by length.
//   L  iPad landscape: two F♯3 strings, a tap plucks (185 Hz), a strum across plucks both, a bridge dragged near ⅔
//      snaps there (strong) and sounds a pure fifth (277.5 Hz), gentle / off snapping, the pendant at ½ and ⅓
//      (only the even / every third harmonic rings), off a string → back to its tray, 123 shows lengths and beats,
//      + string, a long press removes one, presets (Pentatonic: 1, 8/9, 64/81, 2/3, 16/27; Reset), another open
//      note, the state across a reload
//   P  iPhone portrait: strings stand up, the same pluck and bridge snap
//   G  an iOS-like gate (a context starts only from a resume in a finger's lift): the harp grey with ▶ Start, a tap wakes
//      it (strings ring softly), a string sounds, back from hidden → ▶ Start again
//   (L also: ▶ Start only when the sound can't start by itself, none on coming back when it can, a grip moves a string,
//    a pluck rings ≥ 5 s and fades to nothing, ■ damps every string with a clink)
// usage: node harp.cjs   (BASE=…)
const { chromium } = require('playwright');
const { ok, done, fail } = require('./lib/check.cjs');
const { BASE } = require('./lib/paths.cjs');
const sleep = (t) => new Promise((r) => setTimeout(r, t));
const D = (page) => page.evaluate(() => { const d = window.resonateDebug(); delete d.pt; delete d.partials; return d; });
const P = (page, i, a) => page.evaluate(([i, a]) => { const r = document.getElementById('stage').getBoundingClientRect(); const p = window.resonateDebug().pt(i, a); return { x: p.x + r.left, y: p.y + r.top }; }, [i, a]);
const near = (a, b, tol) => Math.abs(a - b) <= tol;
async function hideShow(page) {
  const set = (h) => page.evaluate((h) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') }); document.dispatchEvent(new Event('visibilitychange')); }, h);
  await set(true); await sleep(200); await set(false); await sleep(700);
}

async function drag(page, from, to, steps = 12) {
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  for (let k = 1; k <= steps; k++) await page.mouse.move(from.x + (to.x - from.x) * k / steps, from.y + (to.y - from.y) * k / steps);
  await page.mouse.up(); await sleep(80);
}

async function main() {
  const browser = await chromium.launch();
  const errors = [];
  {
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + 'harp.html');
    await page.waitForFunction(() => window.resonateDebug);
    let d = await D(page);
    ok(d.land && d.state.strings.length === 2 && d.state.base === 54 && d.state.strings.every((s) => s.L === 1), 'L two strings, full length, open F♯3, laid across');
    ok(!d.state.info && (await page.$eval('#beats', (e) => e.textContent)) === '', 'L the numbers hidden');
    await sleep(700); d = await D(page);
    ok(d.lockShown === (d.audio !== 'running'), `L ▶ Start only when the sound can't start by itself (${d.audio}, start ${d.lockShown ? 'shown' : 'not shown'})`);
    if (d.lockShown) { await page.click('#start'); await sleep(500); }
    d = await D(page);
    ok(!d.locked && d.audio === 'running' && !(await page.$eval('#stage', (e) => 'locked' in e.dataset)), 'L the harp awake, in colour');
    await hideShow(page); d = await D(page);
    ok(d.audio === 'running' && !d.lockShown, 'L back from hidden with the sound able to start: no ▶ Start');
    const e185 = await page.evaluate(() => window.resonateDebug().ending(185));
    ok(e185.dur >= 5 && e185.end < 0.002, `L a pluck rings ${e185.dur.toFixed(1)} s and fades to nothing (its last 1 % at ${(e185.end * 100).toFixed(2)} % of its peak)`);
    const s0 = await P(page, 0, 0.5);
    await page.mouse.click(s0.x, s0.y); await sleep(100);
    d = await D(page);
    ok(d.plucks.length === 1 && d.plucks[0].i === 0 && near(d.plucks[0].f, 185.0, 0.1) && d.audio, `L a tap plucks string 1 at ${d.plucks[0]?.f.toFixed(1)} Hz`);
    const a1 = await P(page, 1, 0.4), a0 = await P(page, 0, 0.4);
    await drag(page, { x: a1.x, y: a1.y - 30 }, { x: a0.x, y: a0.y + 30 });
    d = await D(page);
    ok(d.plucks.slice(1).map((p) => p.i).join() === '1,0', `L a strum down plucks string 2 then 1 (${d.plucks.slice(1).map((p) => p.i)})`);
    // the bridge near ⅔
    const b = await P(page, 1, 1), t = await P(page, 1, 0.672);
    await drag(page, b, t);
    d = await D(page);
    ok(near(d.state.strings[1].L, 2 / 3, 1e-9) && near(d.freqs[1], d.freqs[0] * 1.5, 1e-6), `L strong snap: the bridge dropped near ⅔ rests on it (${d.state.strings[1].L.toFixed(4)}, ${d.freqs[1].toFixed(1)} Hz)`);
    // a grip drags a string to another place
    const g0 = await page.evaluate(() => { const r = document.getElementById('stage').getBoundingClientRect(); const q = window.resonateDebug().grip(0); return { x: q.x + r.left, y: q.y + r.top }; });
    const to = await P(page, 1, 0);
    await drag(page, g0, { x: g0.x, y: to.y });
    d = await D(page);
    ok(near(d.state.strings[0].L, 2 / 3, 1e-9) && d.state.strings[1].L === 1, `L a string's grip moves it (lengths now ${d.state.strings.map((s) => s.L.toFixed(3))})`);
    await drag(page, await page.evaluate(() => { const r = document.getElementById('stage').getBoundingClientRect(); const q = window.resonateDebug().grip(1); return { x: q.x + r.left, y: q.y + r.top }; }), { x: g0.x, y: g0.y });
    d = await D(page);
    ok(d.state.strings[0].L === 1 && near(d.state.strings[1].L, 2 / 3, 1e-9), 'L and back');
    await page.click('#snap'); // gentle
    let b2 = await P(page, 1, 2 / 3), t2 = await P(page, 1, 0.672);
    await drag(page, b2, t2);
    d = await D(page);
    ok(d.state.snap === 'gentle' && d.state.strings[1].L > 2 / 3 && d.state.strings[1].L < 0.672, `L gentle: drawn towards ⅔, not onto it (${d.state.strings[1].L.toFixed(4)})`);
    await page.click('#snap'); // off
    b2 = await P(page, 1, d.state.strings[1].L); t2 = await P(page, 1, 0.672);
    await drag(page, b2, t2);
    d = await D(page);
    ok(d.state.snap === 'off' && near(d.state.strings[1].L, 0.672, 0.003), `L off: where it's dropped (${d.state.strings[1].L.toFixed(4)})`);
    await page.click('#snap'); // strong again
    b2 = await P(page, 1, d.state.strings[1].L); t2 = await P(page, 1, 0.665);
    await drag(page, b2, t2);
    // the pendant at ½ on string 1
    const dock = await page.evaluate(() => { const r = document.getElementById('stage').getBoundingClientRect(); const k = window.resonateDebug().dock; return { x: k.x + r.left, y: k.y + r.top }; });
    await drag(page, dock, await P(page, 0, 0.51));
    d = await D(page);
    ok(d.state.pendant && d.state.pendant.s === 0 && near(d.state.pendant.a, 0.5, 1e-9), `L the pendant rests on string 1 at ½ (${d.state.pendant?.a})`);
    const s1 = await P(page, 0, 0.2);
    await page.mouse.click(s1.x, s1.y); await sleep(80);
    d = await D(page);
    let last = d.plucks[d.plucks.length - 1];
    ok(last.x === 0.5 && last.kept.length && last.kept.every((n) => n % 2 === 0), `L at ½ only the even harmonics ring (${last.kept.join(' ')})`);
    // move it to ⅓
    await drag(page, await P(page, 0, 0.5), await P(page, 0, 0.34));
    await page.mouse.click(s1.x, s1.y); await sleep(80);
    d = await D(page); last = d.plucks[d.plucks.length - 1];
    ok(near(last.x, 1 / 3, 1e-9) && last.kept.length && last.kept.every((n) => n % 3 === 0), `L at ⅓ every third harmonic (${last.kept.join(' ')})`);
    // string 2 plucked open, the pendant off it
    const s2 = await P(page, 1, 0.3);
    await page.mouse.click(s2.x, s2.y); await sleep(80);
    d = await D(page); last = d.plucks[d.plucks.length - 1];
    ok(last.i === 1 && last.x == null && last.kept[0] === 1, 'L another string sounds open');
    // off the strings → back to the tray
    await drag(page, await P(page, 0, 1 / 3), { x: dock.x - 40, y: dock.y + 300 });
    d = await D(page);
    ok(d.state.pendant === null, 'L the pendant dropped off a string goes back to its tray');
    await page.mouse.click(s0.x, s0.y); await sleep(50); await page.mouse.click(s2.x, s2.y); await sleep(80);
    ok((await D(page)).voices === 2, 'L two strings ringing');
    await page.click('#stop'); await sleep(150);
    d = await D(page);
    ok(d.voices === 0 && d.clinks === 1, 'L ■ damps them all, with a clink');
    // 123
    await page.click('#info'); await sleep(80);
    await page.mouse.click(s0.x, s0.y); await sleep(50); await page.mouse.click(s2.x, s2.y); await sleep(80);
    d = await D(page);
    ok(d.state.info && /no beats/.test(d.beats), `L 123: a pure fifth has no beats ("${d.beats}")`);
    // + and a long press removes
    await page.click('#add'); await sleep(80);
    d = await D(page);
    ok(d.state.strings.length === 3 && d.state.strings[2].L === 1, 'L + adds a full-length string');
    const s3 = await P(page, 2, 0.3);
    await page.mouse.move(s3.x, s3.y); await page.mouse.down(); await sleep(800); await page.mouse.up();
    ok(await page.$eval('#remove', (e) => e.style.display === 'block'), 'L a long press offers ✕ remove');
    await page.click('#remove'); await sleep(80);
    d = await D(page);
    ok(d.state.strings.length === 2, 'L ✕ removes it');
    // presets
    await page.selectOption('#preset', 'penta'); await sleep(100);
    d = await D(page);
    const want = [1, 8 / 9, 64 / 81, 2 / 3, 16 / 27];
    ok(d.state.strings.length === 5 && d.state.strings.every((s, i) => near(s.L, want[i], 1e-12)), 'L Pentatonic: five folded pure fifths');
    ok(await page.evaluate(() => window.resonateDebug().frac(64 / 81)) === '64/81', 'L 123 names 64/81 exactly');
    await page.selectOption('#note', '60'); await sleep(50);
    d = await D(page);
    ok(near(d.freqs[0], 261.63, 0.01) && near(d.freqs[3], 261.63 * 1.5, 0.02), 'L another open note (C4) moves every string');
    await page.reload(); await page.waitForFunction(() => window.resonateDebug); await sleep(100);
    d = await D(page);
    ok(d.state.strings.length === 5 && d.state.base === 60 && d.state.info, 'L kept across a reload');
    await page.selectOption('#preset', 'reset'); await sleep(80);
    d = await D(page);
    ok(d.state.strings.length === 2 && d.state.base === 54 && d.state.strings.every((s) => s.L === 1), 'L Reset: two F♯3 strings');
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + 'harp.html');
    await page.waitForFunction(() => window.resonateDebug);
    let d = await D(page);
    ok(!d.land, 'P strings stand up on a phone');
    await sleep(700); if ((await D(page)).lockShown) { await page.tap('#start'); await sleep(500); }
    const s = await P(page, 0, 0.5);
    await page.touchscreen.tap(s.x, s.y); await sleep(100);
    d = await D(page);
    ok(d.plucks.length === 1 && d.plucks[0].i === 0, 'P a tap plucks');
    const cdp = await ctx.newCDPSession(page);
    const b = await P(page, 1, 1), t = await P(page, 1, 0.505);
    const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: p.x, y: p.y, id: 1 }] });
    await touch('touchStart', b);
    for (let k = 1; k <= 10; k++) await touch('touchMove', { x: b.x, y: b.y + (t.y - b.y) * k / 10 });
    await touch('touchEnd'); await sleep(80);
    d = await D(page);
    ok(near(d.state.strings[1].L, 0.5, 1e-9), `P the bridge dragged near ½ snaps to the octave (${d.state.strings[1].L.toFixed(4)})`);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'P no sideways scroll');
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await ctx.addInitScript(() => {
      const AC = window.AudioContext, resume = AC.prototype.resume;
      window.AudioContext = class extends AC { constructor(o) { super(o); AC.prototype.suspend.call(this); } };
      AC.prototype.resume = function () { const t = window.event?.type; return ['pointerup', 'touchend', 'click'].includes(t) ? resume.call(this) : Promise.resolve(); };
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + 'harp.html');
    await page.waitForFunction(() => window.resonateDebug);
    await sleep(700);
    let d = await D(page);
    ok(d.lockShown && d.locked && (await page.$eval('#stage', (e) => 'locked' in e.dataset)), 'G the harp grey, ▶ Start over it');
    await page.tap('#start'); await sleep(700);
    d = await D(page);
    ok(d.audio === 'running' && !d.locked && !(await page.$eval('#stage', (e) => 'locked' in e.dataset)), `G ▶ Start wakes it behind an iOS-like gate (${d.audio})`);
    ok(d.voices >= 1 && d.plucks.length === 0, `G the strings ring softly as it wakes (${d.voices} sounding)`);
    const s = await P(page, 0, 0.5);
    await page.touchscreen.tap(s.x, s.y); await sleep(300);
    d = await D(page);
    ok(d.plucks.length === 1, 'G then a string sounds');
    await hideShow(page); d = await D(page);
    ok(d.lockShown && d.locked, 'G back from hidden, the sound unable to start by itself: ▶ Start again');
    await ctx.close();
  }
  ok(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
  done();
}
main().catch(fail);
