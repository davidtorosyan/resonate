// E4: a quiet, distant singer — an iPad on the piano's music stand — and a room with only noise.
// The simulated singer (a sawtooth, as voicetest's) sings 25 dB under voicetest's (quiet −65, singing −43,
// loud −37 dB RMS) over room noise at −72 dB; the noise cases are a fan (−45 dB) switched on after the
// room's silence, and one on from the start. Checks:
//   N  noise alone never calibrates (fan on after the silence; a steady fan) — today's −50 dB count took it
//   U  uncalibrated, the tuner keeps today's gate (MIN_RMS): the distant singer isn't heard yet
//   C  Voice's calibration picks the distant singer up: the room first, then the holds; this device's gate
//      set from them; the Volume card names this device
//   T  with it the tuner hears the distant singer; the fan alone reads no note
//   R  the range test hears the distant singer (and finds the range)
//   S  a Sing take grades the distant singer's notes; the fan alone sings nothing
//   D  this device's name is renamed from the Volume card, signed out (resonate.device)
//   P  the Piano's own note: its tail after a key lift isn't read by the tuner as sung (its own sound heard
//      at MIN_RMS until it's gone); a distant singer after it is
//   H  the range test: the reference note's tail isn't counted as the singer holding it
//   S  a fan that starts mid-take, nobody singing: skipped notes "missed", not "unclear" (the noise floor)
// (N, C, T, R, S, D fail on the build before E4 — there the fan calibrated; U and the noise checks pass on both;
// P, H and the mid-take fan fail on E4's first build, whose low gate heard our own sound and lost the floor.)
// P and H play with BLEED: what the page plays — any of its contexts — reaches the mic 10 dB down, 60 ms later
// (guided.cjs's model, across contexts: the Piano's and the range test's notes have a context of their own).
//   node quietvoice.cjs          (BASE: the test server; SHOTS=0 none)
const { chromium } = require('playwright');
const { ok, done, fail } = require('./lib/check.cjs');
const { BASE, SHOTS } = require('./lib/paths.cjs');

const LO = 50, HI = 55, ANCHOR = 52; // the range test's singer (short: D3–G3)
const LEVEL = { quiet: -65, sing: -43, loud: -37, room: -72, fan: -45 };
const BLEED = -10; // dB: the page's own sound at the mic (P, H)

function sim() { // (in the page)
  // dB RMS → gain: the sawtooth through its 2.5 kHz low-pass, the white noise through 1.2 kHz (measured).
  const vg = (db) => 10 ** ((db + 6.16) / 20), ng = (db) => 10 ** ((db + 15.1) / 20);
  window.__sim = { mode: 'distant', midi: null, L: null, bleed: null };
  // (bleed: every context's output into a stream of its own, which the fake mic mixes in)
  const taps = [], onTap = [], oc = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (t, ...a) {
    const r = oc.call(this, t, ...a);
    try {
      const c = this.context;
      if (t === c.destination && window.__sim.bleed != null && !c.__mic && !(this instanceof ConstantSourceNode)) {
        if (!c.__tap) { c.__tap = c.createMediaStreamDestination(); taps.push(c.__tap.stream); onTap.forEach((f) => f(c.__tap.stream)); }
        oc.call(this, c.__tap);
      }
    } catch {}
    return r;
  };
  let shared = null;
  navigator.mediaDevices.getUserMedia = async () => {
    if (!shared) {
      const ac = new AudioContext();
      ac.__mic = true;
      const osc = ac.createOscillator(); osc.type = 'sawtooth';
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2500;
      const g = ac.createGain(); g.gain.value = 0;
      const nb = ac.createBuffer(1, ac.sampleRate * 3, ac.sampleRate), d = nb.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const ns = ac.createBufferSource(); ns.buffer = nb; ns.loop = true;
      const nlp = ac.createBiquadFilter(); nlp.type = 'lowpass'; nlp.frequency.value = 1200;
      const n = ac.createGain(); n.gain.value = 0;
      const dest = ac.createMediaStreamDestination();
      osc.connect(lp).connect(g).connect(dest); osc.start();
      ns.connect(nlp).connect(n).connect(dest); ns.start();
      if (window.__sim.bleed != null) {
        const bl = ac.createGain(); bl.gain.value = 10 ** (window.__sim.bleed / 20);
        const dl = ac.createDelay(1); dl.delayTime.value = 0.06;
        bl.connect(dl).connect(dest);
        const add = (st) => ac.createMediaStreamSource(st).connect(bl);
        taps.forEach(add); onTap.push(add);
      }
      const set = (node, v) => node.gain.setTargetAtTime(v, ac.currentTime, 0.01);
      setInterval(() => {
        const S = window.__sim, L = S.L, dbg = window.resonateDebug?.(), run = dbg?.run;
        let m = null, lvl = null;
        if (run?.kind === 'vol') { if (run.phase === 'quiet' || run.phase === 'loud') { m = 52; lvl = L[run.phase]; } }
        else if (run?.kind === 'range') {
          if (run.phase === 'anchor') m = S.anchor;
          else if (run.phase === 'listen' && run.target >= S.lo && run.target <= S.hi) m = run.target;
        } else if (dbg?.session?.kind === 'sing') {
          const i = dbg.notes.findIndex((x) => x.t <= dbg.nowT && dbg.nowT < x.t + x.d);
          if (i >= 0) m = dbg.notes[i].midi;
        } else m = S.midi;
        if (S.mode !== 'distant') m = null; // (noise only)
        const roomPhase = run?.kind === 'vol' && (run.phase === 'room' || run.phase === '');
        const late = S.mode === 'fanlate' && dbg?.session?.kind === 'sing' && dbg.nowT >= dbg.notes[0].t + 0.3; // (after the count-in)
        const noise = S.mode === 'fan' || (S.mode === 'fanon' && !roomPhase) || late ? L.fan : L.room;
        set(n, ng(noise));
        if (m === null) set(g, 0);
        else { osc.frequency.setValueAtTime(440 * 2 ** ((m - 69) / 12), ac.currentTime); set(g, vg(lvl ?? L.sing)); }
      }, 20);
      shared = dest.stream;
    }
    return shared.clone();
  };
}

(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 820, height: 1180 } });
  const errs = [];
  await ctx.addInitScript(sim);
  await ctx.addInitScript(() => { try { localStorage.setItem('resonate.sing.ear', 'off'); } catch {} });
  const page = async (url, mode, more = {}) => {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(`${url}: ${e.message}`));
    await p.addInitScript((o) => { window.__sim && Object.assign(window.__sim, o); }, { mode, L: LEVEL, lo: LO, hi: HI, anchor: ANCHOR, ...more });
    await p.goto(BASE + url);
    return p;
  };
  const vdbg = (p) => p.evaluate(() => window.resonateDebug());
  const vol = async (p) => (await vdbg(p)).profiles.list[0]?.vol ?? null;

  // --- Voice: a profile, then noise alone --------------------------------------------------------
  let p = await page('voice.html', 'fanon');
  await p.waitForSelector('#create-name');
  await p.fill('#create-name', 'Dave'); await p.click('#create-btn');
  for (const mode of ['fanon', 'fan']) {
    await p.evaluate((m) => { window.__sim.mode = m; }, mode);
    await p.click('#vol-btn');
    let seen = [], d = null;
    for (let i = 0; i < 32; i++) { await p.waitForTimeout(300); d = await vdbg(p); if (!d.run) break; seen.push(`${d.run.phase}:${(await p.textContent('#t-you')).trim()}`); }
    const v = await vol(p), hint = await p.textContent('#t-hint');
    console.log(`  ${mode}: ${seen.filter((_, i) => i % 6 === 0).join(' ')} | gate ${d?.run?.gate} room ${d?.run?.room} counted ${d?.run?.activeMs} ms | hint "${hint}"`);
    ok(!v, `N noise alone never calibrates (${mode === 'fanon' ? 'a fan switched on after the silence' : 'a fan on from the start'}): ${v ? 'saved ' + JSON.stringify(v) : 'nothing saved'}`);
    if (mode === 'fanon') ok(/louder/.test(hint), `N the hold says so: "${hint}"`);
    if (d?.run) await p.click('#t-stop');
    await p.waitForTimeout(300);
  }
  await p.close();

  // --- uncalibrated: the tuner keeps today's gate -----------------------------------------------
  const tunerHears = async (mode, ms = 4000) => {
    const t = await page('index.html', mode);
    await t.waitForFunction(() => window.resonateDebug?.().tuner);
    await t.evaluate(() => { window.__sim.midi = 57; });
    await t.click('#main-btn');
    let d = null, note = null;
    const end = Date.now() + ms;
    while (Date.now() < end) { await t.waitForTimeout(200); d = (await t.evaluate(() => window.resonateDebug())).tuner; if (d.note !== null) { note = d.note; if (mode === 'distant') break; } }
    await t.close();
    return { note, d };
  };
  let r = await tunerHears('distant', 3000);
  ok(r.note === null && (r.d.gate === undefined || Math.abs(r.d.gate - -38.4) < 0.1), `U uncalibrated: today's gate (${r.d.gate ?? 'MIN_RMS'} dB), the distant singer not heard yet (note ${r.note})`);

  // --- Voice: the distant singer calibrates -----------------------------------------------------
  p = await page('voice.html', 'distant');
  await p.waitForSelector('#vol-btn:not([hidden])', { state: 'attached' });
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('resonate.profiles')); s.list[0].vol = null; localStorage.setItem('resonate.profiles', JSON.stringify(s)); }); // (what noise left, before E4)
  await p.click('#vol-btn');
  let d = null; const t0 = Date.now(); const phases = [];
  while (Date.now() - t0 < 20000) { await p.waitForTimeout(250); d = await vdbg(p); if (!d.run) break; const s = `${d.run.phase} ${(await p.textContent('#t-you')).trim()}`; if (!phases.length || phases[phases.length - 1].split(' ')[0] !== d.run.phase) phases.push(s); }
  console.log(`  calibration: ${phases.join(' → ')} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  let v = await vol(p);
  console.log('  vol:', JSON.stringify(v), '| card:', (await p.textContent('#vol-text').catch(() => '')).trim());
  ok(v && Math.abs(v.floor - LEVEL.quiet) < 3 && Math.abs(v.ceiling - LEVEL.loud) < 3, `C the distant singer calibrates: quiet ${v && Math.round(v.floor)}, loud ${v && Math.round(v.ceiling)} dB (sung ${LEVEL.quiet} / ${LEVEL.loud})`);
  ok(v && Math.abs(v.room - LEVEL.room) < 3 && v.gate <= v.floor - 1 && v.gate >= v.room + 3, `C this device's gate between the room and the quiet hold: room ${v?.room}, gate ${v?.gate} dB`);
  if (d?.run) await p.click('#t-stop');
  const dev = await p.evaluate(() => JSON.parse(localStorage.getItem('resonate.device') || 'null'));
  const card = await p.evaluate(() => ({ name: document.getElementById('device-name')?.textContent ?? null, facts: document.getElementById('vol-facts')?.textContent ?? null }));
  ok(dev && card.name === dev.name && /room -7\d · quiet -6\d · loud -3\d dB/.test(card.facts || ''), `C the Volume card: this device's name and what it measured ("${card.name} · ${card.facts}")`);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/quietvoice-card.png` });
  if (!v) { // (the build before E4: seed what a calibration would give, so T / R / S test the detection itself)
    await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('resonate.profiles')); s.list[0].vol = { floor: -65, ceiling: -37, room: -72, gate: -66 }; localStorage.setItem('resonate.profiles', JSON.stringify(s)); });
    console.log('  (seeded vol: the calibration did not save)');
  }
  await p.close();

  // --- the tuner with it ---------------------------------------------------------------------------
  r = await tunerHears('distant', 5000);
  ok(r.note === 57, `T the tuner hears the distant singer's A3 (note ${r.note}, gate ${r.d.gate} dB)`);
  r = await tunerHears('fan', 3000);
  ok(r.note === null, `T the fan alone reads no note (note ${r.note}, gate ${r.d.gate} dB)`);

  // --- the Piano's own note: the tuner listens again 300 ms after the lift; its tail isn't sung ----------
  {
    const t = await page('index.html', 'distant', { bleed: BLEED });
    await t.waitForFunction(() => window.resonateDebug?.().piano?.shown && document.querySelector('#piano-region rect.key[data-midi="60"]'), null, { timeout: 15000 });
    await t.evaluate(() => { addEventListener('pointerup', () => { window.__lift = performance.now(); }, true); });
    await t.click('#main-btn');
    await t.waitForFunction(() => window.resonateDebug().tuner.state === 'listening', null, { timeout: 8000 });
    await t.waitForTimeout(600);
    const lift = async (singAt = null) => {
      const pt = await t.evaluate(() => { const b = document.querySelector('#piano-region rect.key[data-midi="60"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height * 0.8 }; });
      await t.mouse.move(pt.x, pt.y); await t.mouse.down(); await t.waitForTimeout(300); await t.mouse.up();
      return t.evaluate(async (singAt) => { // (sampled in the page, from the lift)
        const t0 = window.__lift, seen = [];
        while (performance.now() < t0 + 2600) {
          const now = performance.now(), d = window.resonateDebug().tuner;
          if (singAt !== null && now >= t0 + singAt) window.__sim.midi = 57;
          if (d.note !== null) seen.push([Math.round(now - t0), d.note]);
          await new Promise((r) => setTimeout(r, 25));
        }
        window.__sim.midi = null;
        const d = window.resonateDebug().tuner, rel = (x) => (Number.isFinite(x) ? Math.round(x - t0) : null);
        return { seen, state: d.state, until: rel(d.settle?.until), loud: rel(d.settle?.loud), held: d.settle?.held ?? null, reopen: rel(window.resonateDebug().piano.reopenAt) };
      }, singAt);
    };
    const trials = [];
    for (let i = 0; i < 3; i++) { trials.push(await lift()); await t.waitForTimeout(400); }
    for (const x of trials) console.log(`  key lift: tuner back at +${x.reopen} ms, the tail above this device's gate until +${x.loud} ms (${x.held} frames held back), the settle window to +${x.until} ms; notes shown ${x.seen.length ? x.seen[0][0] + '–' + x.seen.at(-1)[0] + ' ms: ' + [...new Set(x.seen.map((s) => s[1]))].join(',') : 'none'}`);
    ok(trials.every((x) => x.state === 'listening' && !x.seen.length), `P the tuner reads no note from the Piano's tail after a key lift, 3 of 3 (gate ${r.d.gate} dB, bleed ${BLEED} dB; shown: ${trials.map((x) => x.seen.length).join(' ')})`);
    ok(trials.every((x) => x.loud === null || (x.until !== null && x.loud < x.until)), `P its tail ends inside the settle window (${trials.map((x) => `${x.loud} < ${x.until}`).join(', ')} ms after the lift)`);
    const sang = await lift(1000);
    console.log(`  key lift, then the singer at +1000 ms: ${sang.seen.length ? sang.seen[0][0] + ' ms: ' + sang.seen[0][1] : 'nothing'}`);
    ok(sang.seen.length && sang.seen.every((s) => s[1] === 57) && sang.seen[0][0] < 2000, `P after it the distant singer is heard (A3 from +${sang.seen[0]?.[0]} ms)`);
    await t.close();
  }

  // --- the range test with it ----------------------------------------------------------------------
  p = await page('voice.html', 'distant');
  await p.waitForSelector('#range-btn');
  await p.click('#range-btn');
  const t1 = Date.now(); let stuck = false;
  for (;;) {
    await p.waitForTimeout(400);
    d = await vdbg(p);
    if (!d.run) break;
    if (d.run.phase === 'anchor' && Date.now() - t1 > 15000) { stuck = true; console.log('  range: still listening for the anchor after 15 s, hint:', await p.textContent('#t-hint')); break; }
    if (Date.now() - t1 > 120000) { stuck = true; break; }
  }
  const range = (await vdbg(p)).profiles.list[0].range;
  ok(!stuck && range?.low === LO && range?.high === HI, `R the range test hears the distant singer: ${range ? `${range.low}–${range.high}` : 'nothing'} (want ${LO}–${HI}, ${((Date.now() - t1) / 1000).toFixed(0)} s)`);
  if (d?.run) await p.click('#t-stop');
  await p.close();

  // --- the range test: the reference note's tail isn't the singer holding it ------------------------------
  p = await page('voice.html', 'distant', { bleed: BLEED, lo: 999, hi: 999 }); // (the singer sings the anchor only)
  await p.waitForSelector('#range-btn');
  await p.click('#range-btn');
  const heard = await p.evaluate(async () => { // (sampled in the page: every listen phase from its start)
    const out = [], end = performance.now() + 24000;
    let cur = null;
    while (performance.now() < end) {
      const r = window.resonateDebug().run;
      if (!r) break;
      if (r.phase === 'listen') {
        if (!cur) { cur = { target: r.target, on: 0, you: '', t0: performance.now() }; out.push(cur); }
        const w = parseFloat(document.getElementById('t-meter').firstElementChild.style.width) || 0;
        cur.on = Math.max(cur.on, r.onMs ?? (w / 100) * 800);
        const y = document.getElementById('t-you').textContent.trim();
        if (y && !cur.you) cur.you = y;
        if (r.settle) cur.settle = r.settle;
      } else cur = null;
      await new Promise((res) => setTimeout(res, 25));
    }
    return out.map((x) => ({ ...x, settle: x.settle && { until: Math.round(x.settle.until - x.settle.release), loud: x.settle.loud === null ? null : Math.round(x.settle.loud - x.settle.release), listen: Math.round(x.t0 - x.settle.release) } }));
  });
  for (const x of heard) console.log(`  listen ${x.target}: on-pitch ${Math.round(x.on)} ms, "${x.you}"${x.settle ? `; after the release: listening +${x.settle.listen}, the tail above this device's gate until ${x.settle.loud === null ? '—' : '+' + x.settle.loud}, the settle window to +${x.settle.until} ms` : ''}`);
  ok(heard.length >= 2 && heard.every((x) => x.on === 0 && !x.you), `H the range test doesn't count the reference note's tail as held (${heard.length} listens, on-pitch ${heard.map((x) => Math.round(x.on)).join(' ')} ms, nobody singing)`);
  if ((await vdbg(p)).run) await p.click('#t-stop');
  await p.close();

  // --- a Sing take with it -------------------------------------------------------------------------
  const take = async (mode, secs) => {
    const s = await page('sing.html', mode);
    await s.waitForFunction(() => window.resonateDebug?.().notes?.length > 0);
    await s.waitForTimeout(800);
    await s.click('#sing');
    await s.waitForFunction(() => window.resonateDebug().session?.kind === 'sing', null, { timeout: 8000 });
    await s.waitForTimeout(secs * 1000);
    const live = await s.evaluate(() => { const t = window.resonateDebug().take; return { frames: t.frames.length, voiced: t.frames.filter((f) => f.midi !== null).length }; });
    await s.click('#sing');
    await s.waitForTimeout(1500);
    const g = await s.evaluate(() => (window.resonateDebug().take?.grades || []).filter(Boolean).map((x) => x.status));
    await s.close();
    return { ...live, g };
  };
  let tk = await take('distant', 11);
  const sung = tk.g.filter((s) => s !== 'unsung'), good = sung.filter((s) => s === 'good' || s === 'ok' || s === 'close');
  console.log(`  take (distant): ${tk.voiced} of ${tk.frames} frames voiced; grades ${tk.g.join(' ')}`);
  ok(sung.length >= 4 && good.length >= sung.length - 1, `S a Sing take grades the distant singer's notes (${good.length} of ${sung.length} in tune)`);
  tk = await take('fan', 6);
  console.log(`  take (fan): ${tk.voiced} of ${tk.frames} frames voiced; grades ${tk.g.join(' ')}`);
  ok(tk.frames > 50 && tk.voiced === 0 && !tk.g.some((s) => s === 'good' || s === 'ok' || s === 'close'), `S the fan alone sings no note (${tk.voiced} frames with a pitch)`);
  tk = await take('fanlate', 9);
  const skipped = tk.g.filter((s) => s !== 'unsung');
  console.log(`  take (a fan from the first note, nobody singing): ${tk.voiced} of ${tk.frames} frames voiced; grades ${skipped.join(' ')}`);
  ok(skipped.length >= 3 && skipped.every((s) => s === 'missed'), `S a fan that starts mid-take: the skipped notes "missed", not "unclear" (${skipped.filter((s) => s === 'unclear').length} unclear of ${skipped.length})`);

  // --- this device's name, signed out --------------------------------------------------------------
  p = await page('voice.html', 'distant');
  await p.waitForSelector('#vol-btn');
  p.once('dialog', (dl) => dl.accept('Piano iPad'));
  await p.click('#device-name', { timeout: 3000 }).catch(() => {});
  await p.waitForTimeout(300);
  const after = await p.evaluate(() => ({ ls: JSON.parse(localStorage.getItem('resonate.device') || 'null'), shown: document.getElementById('device-name')?.textContent ?? null }));
  ok(after.ls?.name === 'Piano iPad' && after.shown === 'Piano iPad' && after.ls.id === dev?.id, `D renamed from the Volume card, signed out: "${after.shown}" (resonate.device ${JSON.stringify(after.ls)})`);
  await p.close();

  ok(!errs.length, `no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await b.close();
  done();
})().catch(fail);
