// Note chips as piano keys: sound on press, until release; touch holds, two fingers, scroll cancel, keyboard.
const { chromium } = require('playwright'); const fs = require('fs');
const SP = '/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/';
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => {
    window.__ev = [];
    const log = (type, ctx, extra) => window.__ev.push({ type, now: ctx ? +ctx.currentTime.toFixed(3) : null, ...extra });
    const S = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when, off) { log('piano', this.context, { when: +(+when).toFixed(3), rate: +this.playbackRate.value.toFixed(4) }); return S.apply(this, arguments); };
    const O = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (when) { log('sustain', this.context, { when: +(+when || 0).toFixed(3), f: +this.frequency.value.toFixed(1) }); return O.apply(this, arguments); };
    const C = AudioParam.prototype.cancelScheduledValues;
    AudioParam.prototype.cancelScheduledValues = function (t) { window.__ev.push({ type: 'release', at: +t.toFixed(3) }); return C.apply(this, arguments); };
  });
  await p.goto('http://localhost:8097/resonate/sing.html'); await p.waitForTimeout(1500);
  const cdp = await ctx.newCDPSession(p);
  const notes = await p.evaluate(() => window.resonateDebug().notes.map((n) => ({ midi: n.midi, d: +n.d.toFixed(3), text: n.text })));
  const chipXY = async (i) => { const r = await p.evaluate((i) => { const c = document.querySelectorAll('#chips .chip')[i]; c.scrollIntoView({ block: 'nearest' }); const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, i); await p.waitForTimeout(250); return r; };
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const take = async () => { const e = await p.evaluate(() => window.__ev.splice(0)); return e; };
  const state = () => p.evaluate(() => ({ playing: [...document.querySelectorAll('#chips .chip')].map((c, i) => (c.dataset.playing === 'true' ? i : -1)).filter((i) => i >= 0), syl: [...document.querySelectorAll('#lyric-now .syl')].find((s) => s.dataset.state === 'current')?.textContent || '' }));
  const now = () => p.evaluate(() => window.resonateDebug && 0);
  const fmt = (ev) => ev.map((e) => e.type === 'release' ? `release@${e.at}` : `${e.type}@${e.when} (now ${e.now})${e.rate ? ' r' + e.rate : ''}${e.f ? ' f' + e.f : ''}`).join(' | ');

  // 1. First touch: piano not loaded yet → press, quick release.
  let c = await chipXY(2);
  await touch('touchStart', [{ x: c.x, y: c.y, id: 1 }]); await p.waitForTimeout(80);
  await touch('touchEnd', []); await p.waitForTimeout(2500);
  console.log('1 first quick touch (piano loading), note', notes[2], ':', fmt(await take()));
  // 2. Touch hold 1.5 s.
  c = await chipXY(5);
  await touch('touchStart', [{ x: c.x, y: c.y, id: 1 }]); await p.waitForTimeout(200);
  const held = await state(); await p.waitForTimeout(1300);
  const t2 = await p.evaluate(() => 0);
  await touch('touchEnd', []); await p.waitForTimeout(100);
  const after = await state();
  console.log('2 touch hold 1.5 s, note', notes[5], ':', fmt(await take()), '| while held', JSON.stringify(held), '| after', JSON.stringify(after));
  await p.waitForTimeout(500);
  console.log('  0.5 s later', JSON.stringify(await state()));
  // 3. Quick tap 30 ms.
  c = await chipXY(6);
  await touch('touchStart', [{ x: c.x, y: c.y, id: 1 }]); await p.waitForTimeout(30); await touch('touchEnd', []); await p.waitForTimeout(600);
  console.log('3 quick tap:', fmt(await take()));
  // 4. Two fingers: hold chip 7, add chip 9, lift 9 then 7.
  const a = await chipXY(7), b2 = await chipXY(9);
  await touch('touchStart', [{ x: a.x, y: a.y, id: 1 }]); await p.waitForTimeout(400);
  await touch('touchStart', [{ x: a.x, y: a.y, id: 1 }, { x: b2.x, y: b2.y, id: 2 }]); await p.waitForTimeout(150);
  const both = await state(); await p.waitForTimeout(450);
  await touch('touchEnd', [{ x: a.x, y: a.y, id: 1 }]); await p.waitForTimeout(400);
  const one = await state();
  await touch('touchEnd', []); await p.waitForTimeout(500);
  console.log('4 two fingers:', fmt(await take()), '| both down', JSON.stringify(both), '| one down', JSON.stringify(one), '| none', JSON.stringify(await state()));
  // 5. Scroll the chip list starting on a chip → pointercancel → stops at once.
  c = await chipXY(12);
  const st0 = await p.evaluate(() => document.getElementById('chips').scrollTop);
  await touch('touchStart', [{ x: c.x, y: c.y, id: 1 }]);
  for (let k = 1; k <= 8; k++) { await touch('touchMove', [{ x: c.x, y: c.y - k * 12, id: 1 }]); await p.waitForTimeout(16); }
  await touch('touchEnd', []); await p.waitForTimeout(400);
  console.log('5 scroll from a chip:', fmt(await take()), '| scrolled', st0, '→', await p.evaluate(() => document.getElementById('chips').scrollTop), JSON.stringify(await state()));
  // 6. Mouse hold 1 s (desktop).
  c = await chipXY(3);
  await p.mouse.move(c.x, c.y); await p.mouse.down(); await p.waitForTimeout(1000); await p.mouse.up(); await p.waitForTimeout(300);
  console.log('6 mouse hold 1 s:', fmt(await take()));
  // 7. Keyboard: Enter on a focused chip → the note for its song length.
  await p.evaluate(() => document.querySelectorAll('#chips .chip')[4].focus()); await p.keyboard.press('Enter'); await p.waitForTimeout(800);
  console.log('7 keyboard Enter, note', notes[4], ':', fmt(await take()));
  // 8. Press, then Listen starts while held → the key is silenced.
  c = await chipXY(8);
  await touch('touchStart', [{ x: c.x, y: c.y, id: 1 }]); await p.waitForTimeout(300);
  await p.evaluate(() => document.getElementById('listen').click()); await p.waitForTimeout(300);
  const ev8 = await take();
  await touch('touchEnd', []); await p.waitForTimeout(200);
  console.log('8 Listen during a hold: first events', fmt(ev8.slice(0, 4)), '… session', JSON.stringify(await p.evaluate(() => window.resonateDebug().session)));
  await p.evaluate(() => document.getElementById('listen').click());
  await p.waitForTimeout(200);
  // 9. Scroll from a chip while idle: cursor goes back.
  await take();
  const before9 = await p.evaluate(() => window.resonateDebug().scrollT);
  c = await chipXY(14);
  await touch('touchStart', [{ x: c.x, y: c.y, id: 1 }]);
  for (let k = 1; k <= 8; k++) { await touch('touchMove', [{ x: c.x, y: c.y - k * 12, id: 1 }]); await p.waitForTimeout(16); }
  await touch('touchEnd', []); await p.waitForTimeout(300);
  const ev9 = await take();
  console.log('9 idle scroll: cursor', before9.toFixed(2), '→', (await p.evaluate(() => window.resonateDebug().scrollT)).toFixed(2), '|', fmt(ev9));
  // 10. During Listen, scroll from a chip: playback must not jump; a tap does.
  await p.evaluate(() => document.getElementById('listen').click()); await p.waitForTimeout(1200);
  const n0 = await p.evaluate(() => window.resonateDebug().nowT);
  c = await chipXY(30);
  await touch('touchStart', [{ x: c.x, y: c.y, id: 1 }]);
  for (let k = 1; k <= 8; k++) { await touch('touchMove', [{ x: c.x, y: c.y - k * 12, id: 1 }]); await p.waitForTimeout(16); }
  await touch('touchEnd', []); await p.waitForTimeout(300);
  const n1 = await p.evaluate(() => window.resonateDebug().nowT);
  c = await chipXY(30);
  await touch('touchStart', [{ x: c.x, y: c.y, id: 1 }]); await p.waitForTimeout(40); await touch('touchEnd', []); await p.waitForTimeout(300);
  const n2 = await p.evaluate(() => window.resonateDebug().nowT);
  console.log(`10 Listen: before ${n0.toFixed(2)}, after scroll ${n1.toFixed(2)} (should just advance), after tap ${n2.toFixed(2)} (note 30 at ${(await p.evaluate(() => window.resonateDebug().notes[30].t)).toFixed(2)})`);
  await p.evaluate(() => document.getElementById('listen').click()); await p.waitForTimeout(200); await take();
  // 11. Keyboard auto-repeat: 10 clicks on a long note, then Listen: every note must be damped.
  const long = notes.reduce((b, n, i) => (n.d > notes[b].d ? i : b), 0);
  await p.evaluate((i) => document.querySelectorAll('#chips .chip')[i].focus(), long);
  for (let k = 0; k < 10; k++) { await p.keyboard.press('Enter'); await p.waitForTimeout(40); }
  const ev11 = await take();
  console.log(`11 Enter ×10 on a ${notes[long].d}s note: ${ev11.filter((e) => e.type === 'piano').length} notes, releases`, ev11.filter((e) => e.type === 'release').map((e) => e.at).join(','));
  await p.screenshot({ path: SP + 'chipkeys.png' });
  console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'no page errors');
  await b.close();
})();
