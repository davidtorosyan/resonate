// The shell's modules (v87): Sing · Score · Piano toggles beside Songs, any combination, on an iPhone
// 390×844, an iPad 820×1180 and a desktop 1280×800. What shows for each of the 8 sets, the pref kept
// per device class across a reload, none → the full tuner with the song's pill, the pill's ✕ closes;
// the Piano on its own (a press sounds — a source started — with the tuner parked first, the tuner
// back ~300 ms after the lift, silent during a take, cut when the page is hidden), one keyboard with
// the Score on; the chrome (avatar, Songs, the toggles) never moves — sampled every frame while a song
// opens and closes and while modules change; no blank frame; reduced motion = a crossfade only.
// `linked` (A5, the owner: "Piano and Score are linked but independent"): one keyboard — the Piano's,
// never Play's docked one — where it was whether the Score comes or goes (sampled every frame), the
// Score above it; with the Score its range is the Score's view, a key pressed strikes through the
// Score (Play's peekLog), lit there, ▶ lights what it plays, what ▶ plays has its chips at its left end;
// the Score off: its own range and presses again, no chips.
// The v87 review: `race` — a second song opened while the first still loads is laid out (it used to
// leave the song open with nothing shown); `pitch` — a Piano press closes Sing's 🎤 Pitch mic first
// (no live track at the press) and it listens again after the lift; `gate` — an iOS-like gate (the
// Piano's contexts start only from a resume in a touch end / click): after an interruption the next
// press starts its new context at the lift and sounds there, and the press after sounds at once.
//   node shellmods.cjs              (http://localhost:8097/resonate/; SHOTS=dir for the 5 screenshots)
//   ONLY=phone,ipad node shellmods.cjs
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:8097/resonate/';
const SHOTS = process.env.SHOTS === '0' ? null : process.env.SHOTS || '/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/v87'; // ("0": no screenshots, as shell.cjs)
const FX = '/home/user/tools/fixtures';
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

let passes = 0, fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`); if (c) passes++; else fails++; return c; };

const SIZES = [
  { n: 'phone', w: 390, h: 844, touch: true, dev: 'phone', def: 'sing' },
  { n: 'ipad', w: 820, h: 1180, touch: true, dev: 'tablet', def: 'score,piano' },
  { n: 'desktop', w: 1280, h: 800, touch: false, dev: 'desktop', def: 'score,piano', cols: true },
];
const PROFILE = { active: 'p1', list: [{ id: 'p1', name: 'Dave', vol: { floor: -50, ceiling: -10 }, range: { low: 45, high: 67, comfortLow: 48, comfortHigh: 64, at: 1 } }] };
// (the 8 sets, one toggle at a time: sing score piano)
const GRAY = ['000', '001', '011', '010', '110', '111', '101', '100'];
const setOf = (b) => ({ sing: b[0] === '1', score: b[1] === '1', piano: b[2] === '1' });
const bitsOf = (s) => `${+!!s.sing}${+!!s.score}${+!!s.piano}`;
const nameOf = (b) => ['sing', 'score', 'piano'].filter((k, i) => b[i] === '1').join('+') || 'none';

// In the page: every source started, and a frame sampler for the chrome.
function instrument() {
  if (location.protocol === 'about:') return;
  window.__starts = [];
  const S = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function () { window.__starts.push({ at: performance.now(), state: this.context.state }); return S.apply(this, arguments); };
  window.__pressLive = [];
  window.__pressMon = [];
  window.__tracks = [];
  if (navigator.mediaDevices) {
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => gum(c).then((s) => { window.__tracks.push(...s.getAudioTracks()); return s; });
  }
  // (bubbling: after the key's own pointerdown — what was live when the press sounded)
  addEventListener('pointerdown', (e) => {
    if (!e.composedPath().some((n) => n.id === 'piano-region')) return;
    window.__pressLive.push(!!window.resonateDebug?.().tuner.live);
    window.__pressMon.push({ mon: !!window.resonateSing?.debug?.()?.monitor?.listening, live: window.__tracks.filter((t) => t.readyState === 'live').length });
  });
  const CHROME = ['#avatar', '#songs-btn', '#mod-piano', '#mod-sing', '#mod-score', '#piano-region', '.dock'];
  const rectOf = (s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 10) / 10); };
  const seen = (e) => { if (!e.getClientRects().length) return false; const r = e.getBoundingClientRect(); if (r.bottom <= 60 || r.top >= innerHeight - 60 || r.height < 20) return false; let o = 1; for (let n = e; n && n.nodeType === 1; n = n.parentElement) o *= +getComputedStyle(n).opacity; return o > 0.05; };
  // Every frame until `done()` (or ms): the chrome's rects, how many animations run, any with a
  // transform, and whether any content (the tuner, its ghost, a module) is on screen.
  window.__sample = (ms, doneSrc) => new Promise((res) => {
    const done = doneSrc ? new Function(`return (${doneSrc})`)() : () => false;
    const out = [], t0 = performance.now();
    (function f() {
      const anims = document.getAnimations();
      out.push({ t: Math.round(performance.now() - t0), rects: CHROME.map(rectOf), n: anims.length,
        tf: anims.some((a) => a.effect?.getKeyframes?.().some((k) => k.transform && k.transform !== 'none')),
        long: anims.some((a) => (a.effect?.getTiming?.().duration || 0) > 200),
        content: [...document.querySelectorAll('#tuner, .ghost.tuner, #sing-region, #score-region, #piano-region')].some(seen) });
      if (performance.now() - t0 > ms || (performance.now() - t0 > 500 && done())) res(out); else requestAnimationFrame(f);
    })();
  });
  window.__rects = () => Object.fromEntries(CHROME.map((s) => [s, rectOf(s)]));
  window.__hide = (h) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  };
}
const SETTLED = `() => { const d = window.resonateDebug?.().song; return d && d.open && !d.moving && !d.switching; }`;
const CLOSED = `() => { const d = window.resonateDebug?.().song; return d && !d.open && !d.moving && !d.closing; }`;
const IDLE = `() => { const d = window.resonateDebug?.().song; return d && !d.moving && !d.switching; }`;

let browser;
async function context(sz, seed = {}, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: sz.w, height: sz.h }, deviceScaleFactor: 1, ...(sz.touch ? { isMobile: true, hasTouch: true } : {}), ...opts });
  await ctx.route('**/*.supabase.co/**', (r) => r.abort());
  await ctx.addInitScript((seed) => {
    try {
      if (location.protocol === 'about:' || sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    } catch {}
  }, seed);
  await ctx.addInitScript(instrument);
  ctx.errors = [];
  ctx.on('page', (p) => {
    p.on('pageerror', (e) => ctx.errors.push(`${p.url().split('/').pop()}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|supabase|Failed to fetch|sync/i.test(m.text())) ctx.errors.push(`${p.url().split('/').pop()}: ${m.text()}`); });
  });
  return ctx;
}
const dbg = (p) => p.evaluate(() => { const d = window.resonateDebug?.(); return d && { song: d.song, tuner: d.tuner, piano: d.piano, overlay: d.overlay }; }).catch(() => null);
async function until(p, pred, ms = 15000) {
  const end = Date.now() + ms;
  let d = null;
  while (Date.now() < end) { d = await dbg(p); try { if (d && pred(d)) return d; } catch {} await p.waitForTimeout(100); }
  return d;
}
const waitFn = (p, src, ms = 20000) => p.waitForFunction(`(${src})()`, null, { timeout: ms, polling: 100 }).then(() => true, () => false);
const shot = (p, name) => SHOTS && p.screenshot({ path: `${SHOTS}/${name}.png` });
// What shows (a module sliding out isn't "shown").
const state = (p) => p.evaluate(() => {
  const vis = (s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0 && !e.closest('[data-leaving]') && getComputedStyle(e).visibility !== 'hidden'; };
  const r = (s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const se = document.scrollingElement;
  const small = [...document.querySelectorAll('.top button, .top a, .dock button, .dock a')].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
    .map((e) => ({ e, b: e.getBoundingClientRect() })).filter(({ b }) => b.width && (b.width < 43.5 || b.height < 43.5)).map(({ e, b }) => `${e.id || e.className}:${Math.round(b.width)}×${Math.round(b.height)}`);
  return { sing: vis('#sing-region'), score: vis('#score-region'), piano: vis('#piano-region'), scoreKeys: vis('#score-region #dock'), keysBtn: vis('#score-region #keys'),
    pill: vis('#song-pill'), close: r('#song-close'), gauge: vis('#tuner .gauge'), start: vis('#main-btn'), listen: vis('#listen-w'), nextup: vis('#nextup'),
    pressed: ['sing', 'score', 'piano'].map((k) => document.getElementById(`mod-${k}`).getAttribute('aria-pressed') === 'true' ? '1' : '0').join(''),
    singTog: vis('#mod-sing'), scoreTog: vis('#mod-score'), pianoTog: vis('#mod-piano'),
    rs: r('#sing-region'), rc: r('#score-region'), rp: r('#piano-region'), dock: r('.dock'), songs: r('#songs-btn'),
    singScroll: getComputedStyle(document.getElementById('sing-region')).overflowY,
    scroll: [se.scrollWidth, se.scrollHeight, innerWidth, innerHeight], small,
    pref: (() => { try { return JSON.parse(localStorage.getItem('resonate.shell.modules') || '{}'); } catch { return {}; } })(),
    playKeys: localStorage.getItem('resonate.play.keys'), scoreKb: window.resonatePlay?.keys?.() ?? null };
});
const same = (a, b) => !!a && !!b && a.every((v, i) => Math.abs(v - b[i]) <= 0.6);
// Every sample's chrome rects equal the reference (null = not shown: skipped).
function steady(samples, ref, label, keys = [0, 1, 2]) {
  const names = ['avatar', 'Songs', 'Piano', 'Sing', 'Score', 'the keyboard'];
  for (const i of keys) {
    const bad = samples.find((s) => s.rects[i] && !same(s.rects[i], ref[i]));
    ok(!bad && samples.some((s) => s.rects[i]), `${label}: ${names[i]} never moved (${samples.length} frames${bad ? `; at ${bad.t} ms ${JSON.stringify(bad.rects[i])} ≠ ${JSON.stringify(ref[i])}` : ''})`);
  }
}
// The Piano on before and after a change (the Score or Sing came or went): the same keyboard — its
// size never changes, it never jumps (≤ 12 px a frame: it glides with the dock under it, when Start
// leaves the dock or comes back), and where the dock didn't change it never moved at all.
function kbSteady(samples, r0, r1, label) {
  const K = 5, D = 6, kb0 = r0['#piano-region'], kb1 = r1['#piano-region'];
  const seen = samples.map((x) => x.rects[K]).filter(Boolean);
  const sized = seen.every((r) => Math.abs(r[2] - kb0[2]) < 0.6 && Math.abs(r[3] - kb0[3]) < 0.6 && Math.abs(r[0] - kb0[0]) < 0.6);
  let jump = 0;
  for (let i = 1; i < seen.length; i++) jump = Math.max(jump, Math.abs(seen[i][1] - seen[i - 1][1]));
  const dockSame = Math.abs(r0['.dock'][1] - r1['.dock'][1]) < 0.6;
  ok(seen.length && sized && jump <= 12 && (!dockSame || seen.every((r) => Math.abs(r[1] - kb0[1]) < 0.6)) && Math.abs(r1['.dock'][1] - (kb1[1] + kb1[3])) < Math.abs(r0['.dock'][1] - (kb0[1] + kb0[3])) + 0.6,
    `${label}: the keyboard stayed — its size kept, ${dockSame ? 'never moved' : `glided with the dock (≤ ${Math.round(jump)} px a frame)`} (${seen.length} frames)`);
}
// A press on the standalone keyboard's key (held ms): a finger, or the mouse.
async function pressKey(p, sz, midi = 60, ms = 300, during = null) {
  const pt = await p.evaluate((m) => {
    const k = document.querySelector(`#piano-region rect.key[data-midi="${m}"]`);
    if (!k) return null;
    const b = k.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height * 0.8 };
  }, midi);
  if (!pt) return false;
  if (sz.touch) {
    const cdp = await p.context().newCDPSession(p);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y, id: 1 }] });
    await p.waitForTimeout(ms);
    if (during) await during();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await p.mouse.move(pt.x, pt.y); await p.mouse.down(); await p.waitForTimeout(ms);
    if (during) await during();
    await p.mouse.up();
  }
  return true;
}
const starts = (p) => p.evaluate(() => window.__starts.length);

// Turn toggles until the set is `bits` (one click per toggle that differs), then wait for it.
async function toSet(p, bits) {
  const cur = (await state(p)).pressed;
  for (let i = 0; i < 3; i++) {
    if (cur[i] === bits[i]) continue;
    await p.click(`#mod-${['sing', 'score', 'piano'][i]}`);
    await waitFn(p, IDLE, 20000);
  }
  await waitFn(p, IDLE, 20000);
}
async function checkSet(p, sz, bits, label, { dflt = false } = {}) {
  const want = setOf(bits);
  // (the modules loaded: Sing's song, the Score drawn)
  if (want.sing) await waitFn(p, `() => window.resonateSing?.state?.().song === 'amazing-grace'`, 20000);
  if (want.score) await waitFn(p, `() => window.resonatePlay?.state?.().ready`, 30000);
  await p.waitForTimeout(250);
  const s = await state(p), d = await dbg(p);
  ok(s.pressed === bits, `${label}: toggles pressed ${s.pressed}`);
  ok(s.sing === want.sing && s.score === want.score, `${label}: Sing ${s.sing ? 'shown' : 'hidden'}, the Score ${s.score ? 'shown' : 'hidden'}`);
  ok(s.piano === !!want.piano && !s.scoreKeys, `${label}: one keyboard at most, the Piano's — shown ${s.piano}, Play's docked one ${s.scoreKeys}`);
  ok(!s.keysBtn, `${label}: no 🎹 in the Score's bar`);
  if (want.score) ok(s.scoreKb === false && s.playKeys === null, `${label}: Play's own keyboard off (${s.scoreKb}), play.html's 🎹 setting untouched (${s.playKeys})`);
  ok(d.piano.linked === !!(want.score && want.piano), `${label}: the keyboard ${d.piano.linked ? "the Score's" : 'its own'}`);
  if (!want.sing && !want.score) ok(d.song.form === 'full' && s.gauge && s.start && s.pill && d.song.open, `${label}: the full tuner, Start, the song's pill (${d.song.form})`);
  else ok(d.song.form !== 'full' && s.pill, `${label}: the tuner ${d.song.form} (${d.song.tin}), the pill`);
  if (want.sing && want.score) {
    if (sz.cols) ok(s.rs.r <= s.rc.x + 0.5 && Math.abs(s.rs.y - s.rc.y) < 2, `${label}: two columns (Sing ${Math.round(s.rs.w)} px | the Score ${Math.round(s.rc.w)} px)`);
    else ok(s.rs.b <= s.rc.y + 0.5 && s.rs.h >= 200 && s.rc.h >= 220, `${label}: stacked — Sing ${Math.round(s.rs.h)} px above the Score ${Math.round(s.rc.h)} px`);
    if (sz.dev === 'phone') ok(s.singScroll === 'auto', `${label}: Sing scrolls in its own region (${s.singScroll})`);
  }
  if (want.piano) ok(s.rp && s.dock && s.rp.b <= s.dock.y + 0.5 && s.rp.h >= 56, `${label}: the keyboard above the dock (${s.rp && Math.round(s.rp.h)} px)`);
  if (want.piano && want.score) ok(s.rc && s.rc.b <= s.rp.y + 0.5, `${label}: the Score laid out above the keyboard (${s.rc && Math.round(s.rc.b)} ≤ ${Math.round(s.rp.y)})`);
  const pref = (s.pref[sz.dev] || []).slice().sort().join(',');
  if (dflt && !s.pref[sz.dev]) ok(true, `${label}: the default (nothing saved yet)`);
  else ok(pref === ['piano', 'score', 'sing'].filter((k) => want[k]).join(','), `${label}: kept for this device class (${pref || 'none'})`);
  ok(s.scroll[0] <= s.scroll[2] && s.scroll[1] <= s.scroll[3], `${label}: no page scroll (${s.scroll.join('×')})`);
  ok(!s.small.length, `${label}: the top bar's and dock's targets ≥ 44 px${s.small.length ? ': ' + s.small.join(', ') : ''}`);
  return s;
}

async function runSize(sz) {
  console.log(`\n=== ${sz.n} ${sz.w}×${sz.h}`);
  const ctx = await context(sz, { 'resonate.profiles': JSON.stringify(PROFILE), 'resonate.sing.song': 'amazing-grace' });
  const p = await ctx.newPage();
  await p.goto(BASE + 'index.html');
  await p.waitForFunction(() => window.resonateDebug?.().tuner);
  await p.waitForTimeout(500);

  // --- home: Piano beside Songs (Sing / Score only with a song), the default modules ----------------
  let s = await state(p);
  const R0 = Object.values(await p.evaluate(() => window.__rects()));
  ok(s.pianoTog && !s.singTog && !s.scoreTog, 'home: Piano beside Songs; no Sing or Score toggle without a song');
  ok(s.piano === sz.def.includes('piano'), `home: the Piano on its own ${s.piano ? 'shown' : 'hidden'} (default ${sz.def})`);
  ok(s.nextup && s.songs && (await p.evaluate(() => { const n = document.getElementById('nextup').getBoundingClientRect(), b = document.getElementById('songs-btn').getBoundingClientRect(); return n.bottom <= b.top + 1 && Math.abs(n.right - b.right) < 2; })),
    'Next-up: a chip just above Songs, right-aligned with it');
  ok(/Amazing Grace/.test(await p.textContent('#nextup')) && (await p.textContent('#nextup')).trim().length < 24, `Next-up: "${(await p.textContent('#nextup')).trim()}"`);
  const sb = s.songs;
  ok(sb.r >= sz.w - 50 && sb.b >= sz.h - 30, `Songs bottom right (${Math.round(sb.x)},${Math.round(sb.y)})`);
  if (sz.n === 'phone') await shot(p, 'phone-home');

  // --- a song opens: the modules come up from the bottom; nothing of the chrome moves ---------------
  await p.click('#songs-btn');
  await p.waitForSelector('#songs-body .song[data-id="amazing-grace"]', { timeout: 5000 });
  const ref = Object.values(await p.evaluate(() => window.__rects()));
  ok(same(ref[0], R0[0]) && same(ref[1], R0[1]) && same(ref[2], R0[2]), 'the Songs sheet open: the chrome where it was');
  const sOpen = p.evaluate((src) => window.__sample(8000, src), SETTLED);
  await p.click('#songs-body .song[data-id="amazing-grace"]');
  const samples = await sOpen;
  let d = await dbg(p);
  ok(d.song.open && /index\.html$/.test(p.url()), `the song opened in place (${p.url().split('/').pop()})`);
  steady(samples, R0, 'opening');
  ok(samples.some((x) => x.n > 0 && x.tf), `opening: transforms ran (${samples.filter((x) => x.tf).length} frames with a slide or morph)`);
  ok(samples.every((x) => x.content), `opening: no blank frame (${samples.filter((x) => !x.content).length} of ${samples.length} without content)`);
  ok(d.song.mods === (sz.dev === 'phone' ? 'sing' : 'score') && d.song.set.piano === sz.def.includes('piano'), `the default modules: ${d.song.mods}${d.song.set.piano ? ' + piano' : ''}`);
  s = await state(p);
  ok(s.pill && s.close && s.close.w >= 44 && s.close.h >= 44, `the pill has its ✕ (${s.close && `${Math.round(s.close.w)}×${Math.round(s.close.h)}`})`);
  ok(s.singTog && s.scoreTog && !s.nextup, 'Sing and Score toggles beside Piano; Next-up gone');

  // --- every combination, one toggle at a time ------------------------------------------------------
  const start = bitsOf(d.song.set);
  const i0 = GRAY.indexOf(start);
  const order = [...GRAY.slice(i0), ...GRAY.slice(0, i0)];
  let R1 = null;
  for (let i = 0; i < order.length; i++) {
    const bits = order[i];
    if (i) {
      const both = order[i - 1][2] === '1' && bits[2] === '1';
      const r0 = both ? await p.evaluate(() => window.__rects()) : null;
      const smp = p.evaluate((src) => window.__sample(8000, src), SETTLED);
      await toSet(p, bits);
      const sm = await smp;
      steady(sm, R1, `→ ${nameOf(bits)}`, [0, 1, 2, 3, 4]);
      if (both) kbSteady(sm, r0, await p.evaluate(() => window.__rects()), `→ ${nameOf(bits)}`);
      ok(sm.every((x) => x.content), `→ ${nameOf(bits)}: no blank frame`);
    }
    await checkSet(p, sz, bits, nameOf(bits), { dflt: i === 0 });
    if (!R1) R1 = Object.values(await p.evaluate(() => window.__rects()));
    if (sz.n === 'phone' && bits === '110') await shot(p, 'phone-sing-score');
    if (sz.n === 'ipad' && bits === '011') await shot(p, 'ipad-score-piano');
  }
  // (the last set: the one before the start — kept for the reload)
  const lastBits = order[order.length - 1];

  await linked(p, sz);

  // --- the Piano on its own with the song: the song's range -----------------------------------------
  await toSet(p, '001');
  await checkSet(p, sz, '001', 'piano alone');
  d = await until(p, (x) => x.piano.shown && x.piano.range, 4000);
  ok(d.piano.range[0] <= 48 && d.piano.range[1] >= 83 && d.piano.range[0] % 12 === 0 && d.piano.range[1] % 12 === 11, `its range: whole octaves, C3–B5 at least (${d.piano.range})`);

  // --- ✕ closes the song: home, the Piano stays; the chrome never moved ------------------------------
  const sClose = p.evaluate((src) => window.__sample(6000, src), CLOSED);
  await p.click('#song-close');
  const cs = await sClose;
  d = await dbg(p);
  s = await state(p);
  ok(!d.song.open && !s.pill && d.tuner.form === 'full' && s.start, '✕: the song closed — home, the full tuner, Start');
  steady(cs, R0, 'closing');
  ok(cs.every((x) => x.content), 'closing: no blank frame');
  await p.waitForTimeout(400);
  s = await state(p);
  ok(s.nextup && s.piano && !s.singTog && !s.scoreTog, 'home again: Next-up, the Piano still on, no Sing / Score toggles');
  ok(await p.evaluate(() => !history.state?.shellPage), "the song's history entry gone");
  if (sz.n === 'desktop') await shot(p, 'desktop-tuner-piano');

  // --- a press sounds, the tuner parked first and back after the lift --------------------------------
  await p.click('#main-btn');
  d = await until(p, (x) => x.tuner.state === 'listening' && x.tuner.live, 6000);
  ok(d?.tuner.state === 'listening', 'the tuner listens');
  let n0 = await starts(p);
  let litHeld = null;
  await pressKey(p, sz, 60, 350, async () => { litHeld = (await dbg(p)).piano; });
  const n1 = await starts(p);
  const live = await p.evaluate(() => window.__pressLive.slice());
  ok(n1 > n0, `a press sounds (${n1 - n0} source(s) started)`);
  ok(live.length && live.every((x) => !x), `the tuner had no live track at the press (${JSON.stringify(live)})`);
  ok(litHeld && litHeld.held.includes(60) && litHeld.lit.includes(60), `lit while held (${JSON.stringify(litHeld?.held)})`);
  ok(litHeld?.log.at(-1)?.how === 'hold', `struck in the press (${JSON.stringify(litHeld?.log.at(-1))})`);
  d = await until(p, (x) => x.tuner.state === 'listening' && x.tuner.live, 3000);
  ok(d?.tuner.state === 'listening' && d.piano.held.length === 0, `~300 ms after the lift the tuner listens again (${d?.tuner.state})`);
  await p.click('#main-btn');
  await until(p, (x) => x.tuner.state === 'off', 3000);
  n0 = await starts(p);
  await pressKey(p, sz, 64, 200);
  await p.waitForTimeout(900);
  d = await dbg(p);
  ok((await starts(p)) > n0 && d.tuner.state === 'off', `with the tuner off: a press sounds, the tuner stays parked (${d.tuner.state})`);

  // --- the pref across a reload --------------------------------------------------------------------------
  await p.reload();
  await p.waitForFunction(() => window.resonateDebug?.().tuner);
  await p.waitForTimeout(400);
  s = await state(p);
  ok(s.piano && s.pressed[2] === '1', 'reload: the Piano still on at home');
  await p.click('#songs-btn');
  await p.waitForSelector('#songs-body .song[data-id="amazing-grace"]', { timeout: 5000 });
  await p.click('#songs-body .song[data-id="amazing-grace"]');
  await waitFn(p, SETTLED, 20000);
  d = await dbg(p);
  ok(bitsOf(d.song.set) === '001', `reload, the song again: the same modules (${nameOf(bitsOf(d.song.set))})`);
  // (and the set the cycle ended on, across a reload)
  await toSet(p, lastBits);
  await p.reload();
  await p.waitForFunction(() => window.resonateDebug?.().tuner);
  await p.click('#songs-btn');
  await p.waitForSelector('#songs-body .song[data-id="amazing-grace"]', { timeout: 5000 });
  await p.click('#songs-body .song[data-id="amazing-grace"]');
  await waitFn(p, SETTLED, 20000);
  d = await dbg(p);
  ok(bitsOf(d.song.set) === lastBits, `reload: ${nameOf(lastBits)} kept (${nameOf(bitsOf(d.song.set))})`);

  // --- hidden: a held key is cut, the context asleep ----------------------------------------------------
  if (sz.n === 'ipad') {
    await toSet(p, '001');
    await p.waitForTimeout(300);
    let mid = null;
    await pressKey(p, sz, 67, 300, async () => {
      mid = (await dbg(p)).piano;
      await p.evaluate(() => window.__hide(true));
      await p.waitForTimeout(150);
    });
    const after = (await dbg(p)).piano;
    ok(mid?.held.includes(67) && after.held.length === 0 && after.lit.length >= 0 && after.ctx === 'suspended' && !after.awake,
      `hidden while held: the note cut, nothing lit, the context ${after.ctx}, no keep-awake`);
    await p.evaluate(() => window.__hide(false));
    await p.waitForTimeout(200);
    n0 = await starts(p);
    await pressKey(p, sz, 67, 200);
    await p.waitForTimeout(600);
    ok((await starts(p)) > n0, 'back: the next press sounds again');
  }

  ok(!ctx.errors.length, `no console errors${ctx.errors.length ? ': ' + ctx.errors.slice(0, 4).join(' | ') : ''}`);
  await ctx.close();
}

// The Piano and the Score linked (A5): one keyboard, the Piano's — where it was; the Score's keys on it.
async function linked(p, sz) {
  const pd = () => p.evaluate(() => { const d = window.resonateDebug(); return { piano: d.piano, play: d.score?.play && { keys: d.score.play.keys, peeks: d.score.play.peekLog.length, last: d.score.play.peekLog.at(-1) || null, hear: d.score.play.playback.hear, pb: d.score.play.playback.state } }; });
  await toSet(p, '001');
  await p.waitForTimeout(300);
  const s0 = await state(p), alone = { ...s0.rp, dock: s0.dock.y }, own = (await pd()).piano.range;
  await toSet(p, '011');
  await waitFn(p, `() => window.resonatePlay?.state?.().ready`, 30000);
  await p.waitForTimeout(500);
  let s = await state(p), x = await pd();
  ok(s.rp && alone && ['x', 'w', 'h'].every((k) => Math.abs(s.rp[k] - alone[k]) < 0.6) && Math.abs((s.dock.y - s.rp.b) - (alone.dock - alone.b)) < 0.6,
    `linked: the same keyboard, on the dock as without the Score (${s.rp && Math.round(s.rp.y)} / ${alone && Math.round(alone.y)}: the dock's Start gone)`);
  ok(x.piano.linked && !s.scoreKeys && x.play.keys.shell && !x.play.keys.shown, "linked: the Piano's keyboard is the Score's — Play's docked keyboard not shown");
  ok(s.rc && Math.abs(s.rc.b - s.rp.y) < 1, `linked: the keyboard right under the paper (${s.rc && Math.round(s.rc.b)} / ${Math.round(s.rp.y)})`);
  ok(JSON.stringify(x.piano.range) === JSON.stringify(x.play.keys.view), `linked: its range is the Score's view (${x.piano.range} = ${x.play.keys.view})`);
  ok(x.piano.chips >= 2 && x.play.hear.home === 'keys', `linked: what ▶ plays — ${x.piano.chips} chips at its left end (${x.play.hear.home})`);
  const chip = await p.evaluate(() => { const c = document.querySelector('#piano-region #hear button'), k = document.querySelector('#piano-region .kb'); if (!c) return null; const a = c.getBoundingClientRect(), b = k.getBoundingClientRect(); return { w: a.width, h: a.height, right: a.right, kb: b.left }; });
  ok(chip && chip.h >= 44 && chip.right <= chip.kb + 0.5, `linked: the chips ≥ 44 px, left of the keys (${JSON.stringify(chip)})`);
  // a key pressed: struck through the Score, lit on the keyboard while held
  const n0 = x.play.peeks;
  let mid = null;
  await pressKey(p, sz, 60, 350, async () => { mid = await pd(); });
  await p.waitForTimeout(300);
  x = await pd();
  ok(x.play.peeks > n0 && x.play.last?.midis?.join() === '60' && x.piano.log.length === (mid?.piano.log.length ?? -1), `linked: a key pressed strikes through the Score (${JSON.stringify(x.play.last?.midis)}, ${x.play.last?.how}), not the keyboard's own path`);
  ok(mid && mid.piano.lit.includes(60) && mid.piano.litHands.some(([m, h]) => m === 60 && h === 'rh'), `linked: lit while held (${JSON.stringify(mid?.piano.litHands)})`);
  ok(!x.piano.lit.length, `linked: and not after the lift (${JSON.stringify(x.piano.lit)})`);
  // ▶ lights what it plays
  await p.click('.dock .row #play');
  const lit = await waitFn(p, `() => (window.resonateDebug().piano.lit || []).length > 0 && window.resonateDebug().score.play.playback.state === 'playing'`, 8000);
  ok(lit, `linked: ▶ lights what it plays on the keyboard (${JSON.stringify((await pd()).piano.lit)})`);
  if (sz.n === 'ipad') await shot(p, 'ipad-linked-playing');
  await p.click('.dock .row #play');
  await waitFn(p, `() => window.resonateDebug().score.play.playback.state === 'idle'`, 5000);
  await p.waitForTimeout(300);
  ok(!(await pd()).piano.lit.length, 'linked: ■ — nothing lit');
  // the Score off: the keyboard its own again — where it was, the song's range, no chips
  await toSet(p, '001');
  await p.waitForTimeout(300);
  s = await state(p); x = await pd();
  ok(!x.piano.linked && x.piano.chips === 0 && JSON.stringify(x.piano.range) === JSON.stringify(own) && s.rp && ['x', 'y', 'w', 'h'].every((k) => Math.abs(s.rp[k] - alone[k]) < 0.6),
    `the Score off: its own again — where it was, the song's range (${x.piano.range}), no chips (${x.piano.chips})`);
  const n1 = x.piano.log.length;
  await pressKey(p, sz, 62, 200);
  await p.waitForTimeout(400);
  ok((await pd()).piano.log.length > n1, "the Score off: a key sounds through the keyboard's own path");
}

// A Sing take: the Piano stays silent (a phone, guiding off).
async function takeSilent() {
  const sz = SIZES[0];
  console.log('\n=== take (phone)');
  const ctx = await context(sz, { 'resonate.sing.song': 'amazing-grace', 'resonate.sing.guided': 'off', 'resonate.shell.modules': JSON.stringify({ phone: ['sing', 'piano'] }) });
  const p = await ctx.newPage();
  await p.goto(BASE + 'index.html');
  await p.waitForFunction(() => window.resonateDebug?.().tuner);
  await p.click('#nextup');
  await waitFn(p, SETTLED, 20000);
  await waitFn(p, `() => window.resonateSing?.state?.().song === 'amazing-grace'`, 20000);
  let s = await state(p);
  ok(s.sing && s.piano, 'Sing and the Piano');
  await p.click('#sing');
  const take = await waitFn(p, `() => window.resonateSing?.state?.().take`, 10000);
  ok(take, 'a take runs');
  await p.waitForTimeout(500);
  const n0 = await starts(p);
  let held = null;
  await pressKey(p, sz, 60, 300, async () => { held = (await dbg(p)).piano; });
  await p.waitForTimeout(300);
  const extra = await p.evaluate((n) => window.__starts.slice(n).length, n0);
  // (the take's own count-in clicks are buffers too: only a press's would start while it's held on 60)
  ok(held && held.held.length === 0 && held.lit.length === 0 && !held.log.length, `a press during the take: silent, not lit (${JSON.stringify(held?.held)}, log ${held?.log.length}, ${extra} sources meanwhile)`);
  ok((await state(p)).pressed[1] === '0', 'the take: modules unchanged');
  await p.click('#mod-score');
  await p.waitForTimeout(400);
  ok((await state(p)).pressed === '101' && !(await state(p)).score, 'a toggle during the take is refused');
  await p.click('#sing');
  await waitFn(p, `() => !window.resonateSing?.state?.().busy`, 15000);
  ok(!ctx.errors.length, `no console errors${ctx.errors.length ? ': ' + ctx.errors.slice(0, 4).join(' | ') : ''}`);
  await ctx.close();
}

// Reduced motion: a short crossfade only — no slide, no morph — and still nothing of the chrome moves.
async function reducedMotion() {
  const sz = SIZES[0];
  console.log('\n=== reduced motion (phone)');
  const ctx = await context(sz, { 'resonate.sing.song': 'amazing-grace', 'resonate.shell.modules': JSON.stringify({ phone: ['sing', 'piano'] }) }, { reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  await p.goto(BASE + 'index.html');
  await p.waitForFunction(() => window.resonateDebug?.().tuner);
  await p.waitForTimeout(400);
  const R0 = Object.values(await p.evaluate(() => window.__rects()));
  const so = p.evaluate((src) => window.__sample(8000, src), SETTLED);
  await p.click('#nextup');
  const a = await so;
  ok(a.some((x) => x.n > 0) && !a.some((x) => x.tf) && !a.some((x) => x.long), `opening: fades only (${a.filter((x) => x.n).length} frames animating, none with a transform or longer than 200 ms)`);
  steady(a, R0, 'reduced, opening');
  ok(a.every((x) => x.content), 'reduced: no blank frame');
  const sc = p.evaluate((src) => window.__sample(6000, src), CLOSED);
  await p.click('#song-close');
  const c = await sc;
  ok(!c.some((x) => x.tf) && !c.some((x) => x.long), 'closing: fades only');
  steady(c, R0, 'reduced, closing');
  ok(!ctx.errors.length, `no console errors${ctx.errors.length ? ': ' + ctx.errors.slice(0, 4).join(' | ') : ''}`);
  await ctx.close();
}

// A second song opened 30 ms after Next-up, while the first is still loading: laid out, not left
// open with nothing shown (the overtaken open used to skip its render, and the newer one only opened
// the modules). (Without the fix: open, laid false, the form full, #sing-region hidden.)
async function raceOpen() {
  const sz = SIZES[0];
  console.log('\n=== race (phone)');
  const ctx = await context(sz, { 'resonate.sing.song': 'amazing-grace', 'resonate.sing.guided': 'off', 'resonate.shell.modules': JSON.stringify({ phone: ['sing'] }) });
  const p = await ctx.newPage();
  await p.goto(BASE + 'index.html');
  await p.waitForFunction(() => window.resonateDebug?.().tuner);
  const id = await p.evaluate(async () => {
    const lib = await import(`./library.js?v=${document.getElementById('version').textContent.trim().replace(/^v/, '')}`);
    const xml = await (await fetch('songs/amazing-grace.musicxml')).text();
    return lib.addSong('Grace Again', xml.replace(/Amazing [Gg]race/g, 'Grace Again'));
  });
  await p.evaluate((sid) => {
    document.getElementById('nextup').click();
    setTimeout(() => import(`./shell/songlist.js?v=${document.getElementById('version').textContent.trim().replace(/^v/, '')}`).then((m) => m.openSong(sid)), 30);
  }, id);
  await p.waitForTimeout(500);
  await waitFn(p, `() => { const d = window.resonateDebug?.().song; return d && d.open && d.laid && !d.moving && !d.switching; }`, 15000);
  await waitFn(p, `() => window.resonateSing?.state?.().song === ${JSON.stringify(id)}`, 15000);
  await p.waitForTimeout(400);
  const d = await dbg(p), s = await state(p);
  ok(d.song.open && d.song.laid && d.song.form !== 'full', `the second song laid out (open ${d.song.open}, laid ${d.song.laid}, the tuner ${d.song.form})`);
  ok(s.sing && s.singTog && s.scoreTog && s.pill && !s.nextup, `Sing shown, its toggles and the pill (Sing ${s.sing}, toggles ${s.singTog}/${s.scoreTog})`);
  ok(d.song.state?.song === id && /Grace Again/.test(await p.textContent('#song-pill .t')), `on the second song (${d.song.state?.song}, "${(await p.textContent('#song-pill .t')).trim()}")`);
  ok(!(await p.evaluate(() => document.getElementById('song-pill').hasAttribute('data-loading'))), 'the pill no longer loading');
  await shot(p, 'phone-race-open');
  // and a queued change caught by a newer open: Piano on, Sing off (queued behind it), another song
  await p.evaluate(() => {
    document.getElementById('mod-piano').click();
    document.getElementById('mod-sing').click();
    setTimeout(() => import(`./shell/songlist.js?v=${document.getElementById('version').textContent.trim().replace(/^v/, '')}`).then((m) => m.openSong('amazing-grace')), 0);
  });
  await p.waitForTimeout(500);
  await waitFn(p, `() => { const d = window.resonateDebug?.().song; return d && d.open && !d.moving && !d.switching && d.set.piano && !d.set.sing; }`, 15000);
  await p.waitForTimeout(600);
  const d2 = await dbg(p), s2 = await state(p);
  ok(s2.pressed === '001' && s2.piano && !s2.sing && d2.song.form === 'full' && s2.pill, `toggles, then another song: laid out as the toggles say — the Piano alone, the full tuner, the pill (${s2.pressed}, piano ${s2.piano}, Sing ${s2.sing}, ${d2.song.form})`);
  ok(!ctx.errors.length, `no console errors${ctx.errors.length ? ': ' + ctx.errors.slice(0, 4).join(' | ') : ''}`);
  await ctx.close();
}

// Sing's 🎤 Pitch on, then a Piano press: the monitor's mic closed at the press (no live track — iOS
// plays quietly while the page has the mic open), "listen…" meanwhile, listening again after the lift.
async function pitchHush() {
  const sz = SIZES[0];
  console.log('\n=== pitch (phone)');
  const ctx = await context(sz, { 'resonate.sing.song': 'amazing-grace', 'resonate.sing.guided': 'off', 'resonate.shell.modules': JSON.stringify({ phone: ['sing', 'piano'] }) });
  const p = await ctx.newPage();
  await p.goto(BASE + 'index.html');
  await p.waitForFunction(() => window.resonateDebug?.().tuner);
  await p.click('#nextup');
  await waitFn(p, SETTLED, 20000);
  await waitFn(p, `() => window.resonateSing?.state?.().song === 'amazing-grace'`, 20000);
  await p.click('#monitor');
  const on = await waitFn(p, `() => window.resonateSing?.debug?.()?.monitor?.listening`, 8000);
  ok(on, '🎤 Pitch listens');
  const n0 = await starts(p);
  let mid = null;
  await pressKey(p, sz, 60, 400, async () => { mid = await p.evaluate(() => ({ mon: window.resonateSing.debug().monitor, you: document.getElementById('you')?.textContent || '' })); });
  const at = await p.evaluate(() => window.__pressMon.slice());
  ok((await starts(p)) > n0, 'the press sounds');
  ok(at.length && at.every((x) => !x.mon && x.live === 0), `at the press: the monitor's mic closed, no live track (${JSON.stringify(at)})`);
  ok(mid && !mid.mon.listening && /listen/.test(mid.you), `while held: not listening, "listen…" (${JSON.stringify(mid?.mon)}, "${mid?.you.replace(/\s+/g, ' ').trim()}")`);
  const back = await waitFn(p, `() => window.resonateSing?.debug?.()?.monitor?.listening`, 4000);
  ok(back && (await p.getAttribute('#monitor', 'aria-pressed')) === 'true', '~300 ms after the lift: 🎤 Pitch listens again, still on');
  await shot(p, 'phone-pitch-piano');
  ok(!ctx.errors.length, `no console errors${ctx.errors.length ? ': ' + ctx.errors.slice(0, 4).join(' | ') : ''}`);
  await ctx.close();
}

// iOS-like audio for the Piano's own contexts (made in pianoview.js): they start suspended and only
// start from a resume() called in a touch end / click / key; __interrupt() makes them "interrupted".
function GATE() {
  if (location.protocol === 'about:') return;
  window.__gesture = false;
  window.__pctx = [];
  for (const t of ['pointerup', 'click', 'touchend', 'keydown']) window.addEventListener(t, () => { window.__gesture = true; setTimeout(() => { window.__gesture = false; }, 0); }, true);
  const AC = window.AudioContext;
  window.AudioContext = class extends AC {
    constructor(...a) {
      super(...a);
      this.__gated = /pianoview/.test(new Error().stack);
      if (!this.__gated) return;
      window.__pctx.push(this);
      this.__susp = true; this.__waiters = []; super.suspend();
    }
    get state() { const s = super.state; return this.__gated && s !== 'closed' ? (this.__intr ? 'interrupted' : this.__susp ? 'suspended' : s) : s; }
    resume() {
      if (!this.__gated || (!this.__susp && !this.__intr)) return super.resume();
      if (window.__gesture && !this.__intr) { this.__susp = false; const r = super.resume(); r.then(() => this.__waiters.splice(0).forEach((f) => f())); return r; }
      return new Promise((res) => this.__waiters.push(res));
    }
  };
  window.__interrupt = () => { for (const c of window.__pctx) c.__intr = true; };
}
async function gateLift() {
  const sz = SIZES[0];
  console.log('\n=== gate (phone, iOS-like)');
  const ctx = await context(sz, { 'resonate.shell.modules': JSON.stringify({ phone: ['piano'] }) });
  await ctx.addInitScript(GATE);
  const p = await ctx.newPage();
  await p.goto(BASE + 'index.html');
  await p.waitForFunction(() => window.resonateDebug?.().piano?.shown);
  await p.waitForTimeout(600);
  const last = () => p.evaluate(() => window.resonateDebug().piano.log.at(-1) || null);
  const n = () => p.evaluate(() => window.resonateDebug().piano.log.length);
  ok((await dbg(p)).piano.ctx === 'suspended', 'the Piano at home, its context suspended (gated)');
  await pressKey(p, sz, 60, 250);
  await p.waitForTimeout(800);
  ok((await last())?.how === 'lift', `the first press sounds at its lift (${JSON.stringify(await last())})`);
  let c = await n();
  await pressKey(p, sz, 62, 250);
  await p.waitForTimeout(500);
  ok((await n()) > c && (await last()).how === 'hold', `then in the press (${JSON.stringify(await last())})`);
  await p.evaluate(() => window.__interrupt());
  ok((await dbg(p)).piano.ctx === 'interrupted', 'interrupted (an alarm, Siri)');
  c = await n();
  await pressKey(p, sz, 64, 250);
  await p.waitForTimeout(900);
  const d = await dbg(p);
  ok((await n()) > c && (await last()).how === 'lift' && d.piano.ctx === 'running', `after the interruption: a new context started at the lift, the press sounds there (${JSON.stringify(await last())}, ${d.piano.ctx})`);
  c = await n();
  await pressKey(p, sz, 65, 250);
  await p.waitForTimeout(500);
  ok((await n()) > c && (await last()).how === 'hold', `and the next press sounds in the press (${JSON.stringify(await last())})`);
  ok(!ctx.errors.length, `no console errors${ctx.errors.length ? ': ' + ctx.errors.slice(0, 4).join(' | ') : ''}`);
  await ctx.close();
}

(async () => {
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${FX}/shell/a3.wav`, '--autoplay-policy=no-user-gesture-required'] });
  const runs = [...SIZES.map((sz) => [sz.n, () => runSize(sz)]), ['take', takeSilent], ['reduced', reducedMotion], ['race', raceOpen], ['pitch', pitchHush], ['gate', gateLift]];
  for (const [n, fn] of runs) {
    if (ONLY && !ONLY.has(n)) continue;
    const before = fails;
    try { await fn(); } catch (e) { ok(false, `${n}: ${e.message.split('\n')[0]}`); }
    for (const c of browser.contexts()) await c.close().catch(() => {});
    if (fails === before) console.log(`(${n}: all passed)`);
  }
  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
