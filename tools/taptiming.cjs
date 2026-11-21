// Tempo menu: tap tempo → steady ♩; tap along with a "recording" 25% slower with a held note → notes follow it; slow it to 90%; forget;
// Tap the beat in 4/4, 6/8, 3/8 and 12/16 (one tap a felt beat — the beat the count-in clicks).
const { chromium } = require('playwright');
const path = require('path');
const { ok, done, fail } = require('./lib/check.cjs');
const { BASE, FIX, SHOTS } = require('./lib/paths.cjs');
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  await p.goto(BASE + 'sing.html'); await p.waitForTimeout(1500);
  await p.evaluate(() => { localStorage.removeItem('resonate.sing.timing'); });
  await p.reload(); await p.waitForTimeout(1500);
  const opts = () => p.evaluate(() => [...document.querySelectorAll('#tempo-select option')].map((o) => `${o.value}=${o.textContent}`));
  console.log('menu:', (await opts()).join(' | '));
  const scoreTempo = await p.evaluate(() => window.resonateDebug().score.tempo);
  // 1. Tap tempo at 120.
  await p.selectOption('#tempo-select', 'tap'); await p.waitForTimeout(200);
  ok(!(await p.$('#taptempo[hidden]')), 'Tap the beat opens');
  const pad = await p.$('#tt-pad'); const bx = await pad.boundingBox();
  for (let i = 0; i < 7; i++) { await p.dispatchEvent('#tt-pad', 'pointerdown', { isPrimary: true }); await p.waitForTimeout(500); }
  const bpm = await p.textContent('#tt-bpm');
  ok(/= 1(19|20|21)$/.test(bpm), 'tapping every 0.5 s reads ♩ = 120: ' + bpm);
  await p.click('#tt-use'); await p.waitForTimeout(300);
  let d = await p.evaluate(() => ({ v: document.getElementById('tempo-select').value, label: document.getElementById('tempo-select').selectedOptions[0].textContent, sum: document.getElementById('summary').textContent }));
  console.log('after tap tempo:', JSON.stringify(d), 'score tempo', scoreTempo);
  ok(/♩=1(19|20|21) \(yours\)/.test(d.label) && /♩=1(19|20|21)/.test(d.sum), 'steady tempo set to the tapped one');
  // 2. Tap along: first two lines, recording 25% slower than the score at 100%, note 3 ("grace") held 1 s longer.
  await p.selectOption('#tempo-select', 'r:1'); await p.waitForTimeout(300);
  const base = await p.evaluate(() => { const d = window.resonateDebug(); return d.notes.map((n) => ({ t: n.t, q: n.q, text: n.text, mel: n.melisma })); });
  await p.selectOption('#tempo-select', 'tapmap'); await p.waitForTimeout(200);
  ok(!(await p.$('#tapalong[hidden]')), 'Tap along opens');
  const targets = await p.evaluate(() => window.resonateDebug().tapTargets);
  const spq0 = base[1].t / base[1].q || 60 / scoreTempo;
  const lineEnd = 11; // notes 0..10 = lines 0 and 1
  const tgt = targets.filter((j) => j < lineEnd);
  const t0 = Date.now();
  const when = (j) => base[j].t * 1.25 + (j > 3 ? 1.0 : 0); // held "grace"
  for (const j of tgt) {
    const wait = when(j) * 1000 - (Date.now() - t0) + 300;
    if (wait > 0) await p.waitForTimeout(wait);
    await p.dispatchEvent('#ta-pad', 'pointerdown', { isPrimary: true });
  }
  if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'tapalong.png') });
  await p.click('#ta-save'); await p.waitForTimeout(400);
  d = await p.evaluate(() => ({ notes: window.resonateDebug().notes.map((n) => n.t), label: document.getElementById('tempo-select').selectedOptions[0].textContent, sum: document.getElementById('summary').textContent, msg: document.getElementById('song-msg').textContent }));
  console.log('after tap along:', d.label, '|', d.sum);
  const j0 = tgt[0];
  const errsT = tgt.map((j) => Math.abs((d.notes[j] - d.notes[j0]) - (when(j) - when(j0))));
  ok(Math.max(...errsT) < 0.06, `tapped notes land where tapped (max err ${Math.max(...errsT).toFixed(3)} s)`);
  // A held note: "grace" lasts ~1 s longer than at the steady pace ×1.25.
  ok(d.label === 'Tapped' && /TAPPED TIMING/.test(d.sum), 'menu shows Tapped, summary says so');
  // After the tapped part, the pace continues (no jump): gaps after line 1 ≈ the average pace.
  const after = (d.notes[lineEnd + 2] - d.notes[lineEnd + 1]) / (base[lineEnd + 2].t - base[lineEnd + 1].t);
  ok(after > 1.1 && after < 1.6, 'after the tapped part the average pace continues: ×' + after.toFixed(2));
  // 3. Tapped · 90% is slower.
  await p.selectOption('#tempo-select', 'm:0.9'); await p.waitForTimeout(300);
  const slow = await p.evaluate(() => window.resonateDebug().notes.map((n) => n.t));
  ok(Math.abs((slow[10] - slow[0]) / (d.notes[10] - d.notes[0]) - 1 / 0.9) < 0.01, 'Tapped · 90% stretches the timing by 1/0.9');
  // 4. Persisted across reload.
  await p.reload(); await p.waitForTimeout(1500);
  const lab = await p.evaluate(() => document.getElementById('tempo-select').selectedOptions[0].textContent);
  ok(lab === 'Tapped · 90%', 'remembered after reload: ' + lab);
  // 5. Forget.
  await p.selectOption('#tempo-select', 'clearmap'); await p.waitForTimeout(300);
  const after2 = await opts();
  ok(!after2.some((o) => o.startsWith('m:')), 'forgotten: no Tapped options');
  // 6. Tap the beat taps the felt beat (cleanup C 5.2; the default song above is in 3/4): 4/4 and 6/8 as before, 3/8 in
  //    eighths (it expected one tap a bar while the count-in clicked eighths), 12/16 in dotted eighths (it expected sixteenths).
  for (const [file, glyph, quarters] of [['pickup8.musicxml', '♩', 120], ['six8.musicxml', '♩.', 180], ['three8.musicxml', '♪', 60], ['twelve16.musicxml', '♪.', 90]]) {
    await p.setInputFiles('#file-input', path.join(FIX, 'sing', file)); await p.waitForTimeout(800);
    const sum = await p.textContent('#summary');
    await p.selectOption('#tempo-select', 'tap'); await p.waitForTimeout(200);
    await p.evaluate(async () => { // a tap every 0.5 s, timed in the page
      const pad = document.getElementById('tt-pad');
      for (let i = 0; i < 7; i++) { pad.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, isPrimary: true })); await new Promise((r) => setTimeout(r, 500)); }
    });
    const read = await p.textContent('#tt-bpm');
    await p.click('#tt-use'); await p.waitForTimeout(300);
    const label = await p.evaluate(() => document.getElementById('tempo-select').selectedOptions[0].textContent);
    const got = Number((label.match(/♩=(\d+)/) || [])[1]);
    console.log(file, '|', sum, '|', read, '|', label);
    ok(read.startsWith(glyph + ' = ') && /= 1(19|20|21)$/.test(read), `${file}: a tap a felt beat every 0.5 s reads ${glyph} = 120: ${read}`);
    ok(Math.abs(got - quarters) <= quarters * 0.02 + 0.5, `${file}: the steady tempo ♩=${quarters} (yours): ${label}`);
  }
  ok(!errs.length, 'no page errors ' + JSON.stringify(errs));
  await b.close();
  done();
})().catch(fail);
