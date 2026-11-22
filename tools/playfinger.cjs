// Piano fingering on the shell's Piano (E7 stage 2, docs/FINGERING.md §5, §8 "Browser"), in the shell
// (index.html, the Score with the Piano: tools/lib/shell.cjs), on an iPad 820×1180, a phone 390×844 and a
// desktop 1280×800 (touch / mouse), on a generated piano/vocal fixture with the owner's case (fingerfixture
// r6: G3 + B4 on the treble staff over the left hand's held C3) and on Amazing Grace:
//   A  #fing: at the Piano row's right end, 44 × 44, shown where the view draws fingered notes (Full score,
//      Both, RH, LH, a hymn's views) — not on a separate voice's Melody, the Piano off, over 📄, a PDF only,
//      nor before the fingering is ready; a tap cycles numbers → hand → off → numbers (aria-label, the pref
//      resonate.play.fingers, kept across a reload); scoreState().fingering
//   B  a press on G3 + B4: B4 purple with its digit, G3 blue with LH 1 (the fingering's hand)
//   C  ▶ (numbers): a digit only on each hand's first notes in a new position — every decision as the rule
//      says from the stored frames, the digits drawn are those notes' fingers, most lit notes have none
//   D  muting LH silences G3 (it's the left hand's now) and the LH view plays it; the RH view leaves it out
//   E  the ghost hand (hand): its rings built again once per frame change (a class for the fingers down),
//      on the stored frame's keys; no digit on a ringed key
//   F  the SVG written only when what it shows changes (the rings are their own layer)
//   G  no long task while a long piece's fingering is worked out (the Worker; this task's share < 50 ms)
//   H  a phone: no digits where a white key is under 12 px (Both with its chips, a wide piece);
//      digits and rings in the RH view (~15 px)
//   I  the cache: a reload works nothing out (stored); an ALG bump (finger.js served with ALG 2), a typed
//      tempo, a clean-up change (a converted song's cleaned MusicXML read differently), a Reprocess (the
//      tray, a scripted engine: the importer works it out after the save, the Score reuses it) do
//   J  off = today: with the mode off the schedules, a press's lit keys and ▶'s keyboard drawings equal those
//      of a page whose fingering never came (its Worker never answers)
//   K  Amazing Grace (a hymn): fingered on every view, #fing shown, a press shows digits
//   node playfinger.cjs                (BASE: the harness, http://localhost:8097/resonate/)
//   ONLY=desktop,phone node playfinger.cjs     PARTS=A,B,… (the desktop's), SHOTS=0
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { ok, skip, done, fail } = require('./lib/check.cjs');
const { BASE, SHOTS } = require('./lib/paths.cjs');
const SH = require('./lib/shell.cjs');
const FX = require('./fingerfixture.cjs');

const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const PARTS = process.env.PARTS ? new Set(process.env.PARTS.split(',')) : null;
const part = (k) => !PARTS || PARTS.has(k);
const DEVICES = [
  { n: 'desktop', w: 1280, h: 800, touch: false },
  { n: 'ipad', w: 820, h: 1180, touch: true },
  { n: 'phone', w: 390, h: 844, touch: true },
];
const sleep = (t) => new Promise((r) => setTimeout(r, t));
const ROOT = new URL('../', BASE).href; // (the harness's root: /imp/ beside /resonate/)

function INIT() {
  if (location.protocol === 'about:') return;
  try { if (!navigator.audioSession) Object.defineProperty(navigator, 'audioSession', { configurable: true, value: { type: 'auto' } }); } catch {}
  window.__lt = [];
  window.__fingEv = [];
  addEventListener('resonate:fingering', (e) => window.__fingEv.push({ song: e.detail.song, computed: e.detail.computed, from: e.detail.from, bpm: e.detail.fing?.bpm }));
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ start: e.startTime, dur: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch {}
  // The Piano's keyboard while something plays: every frame — the keys lit (hand), the digits drawn, the
  // rings — every write of its SVG (what it shows then) and every ring group built.
  window.__kb = {
    start() {
      const kb = document.querySelector('#piano-region .kb');
      const svg = () => kb.querySelector(':scope > svg');
      const sig = () => { const s = svg(); return [...s.querySelectorAll('rect.lit')].map((r) => r.dataset.midi + r.dataset.hand).join(',') + '|' + [...s.querySelectorAll('text.fd')].map((t) => t.dataset.midi + ':' + t.textContent).join(',') + '|' + s.querySelectorAll('text').length; };
      const S = { frames: [], svg: [], builds: [], on: true };
      const rings = () => { const o = {}; for (const g of kb.querySelectorAll('.kb-ghost .kb-gh:not([data-out])')) o[g.dataset.h] = { keys: [...g.children].map((r) => Number(r.dataset.midi)), down: [...g.children].filter((r) => r.classList.contains('down')).map((r) => Number(r.dataset.f)) }; return o; };
      S.mo = new MutationObserver((ms) => {
        for (const m of ms) {
          if (m.target === svg()) S.svg.push(sig());
          else if (m.target.classList?.contains('kb-ghost')) for (const n of m.addedNodes) if (n.classList?.contains('kb-gh')) S.builds.push({ h: n.dataset.h, keys: [...n.children].map((r) => Number(r.dataset.midi)), t: performance.now() });
        }
      });
      S.mo.observe(kb, { childList: true, subtree: true });
      const tick = () => {
        if (!S.on) return;
        const s = svg();
        S.frames.push({ t: performance.now(), lit: [...s.querySelectorAll('rect.lit')].map((r) => [Number(r.dataset.midi), r.dataset.hand]), fd: [...s.querySelectorAll('text.fd')].map((t) => [Number(t.dataset.midi), Number(t.textContent)]), rings: rings() });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      window.__kb.S = S;
    },
    stop() { const S = window.__kb.S; S.on = false; S.mo.disconnect(); const { mo, ...out } = S; return out; },
  };
}

let browser;
async function newCtx(dev, { worker = null, seed = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width: dev.w, height: dev.h }, deviceScaleFactor: 1, ...(dev.touch ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.route('**/*.supabase.co/**', (r) => r.abort());
  if (worker) await ctx.route('**/finger-worker.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: worker }));
  await SH.seedShell(ctx, { song: 'amazing-grace', mods: SH.MODS });
  await ctx.addInitScript((seed) => { try { if (location.protocol !== 'about:' && !sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v); } } catch {} }, seed);
  await ctx.addInitScript(INIT);
  ctx.errors = [];
  ctx.on('page', (p) => {
    p.on('pageerror', (e) => ctx.errors.push(`pageerror ${e.message}`));
    p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/Failed to load resource|supabase|Failed to fetch|sync/i.test(t)) ctx.errors.push(`console.error ${t.slice(0, 200)}`); else if (m.type() === 'warning' && /^fingering|^play\b|^piano/.test(t)) ctx.errors.push(`console.warn ${t.slice(0, 200)}`); });
  });
  return ctx;
}
// Songs added on this device (My songs), each with its record's view; → { name: id }.
async function addSongs(page, list) {
  await page.goto(BASE + 'index.html');
  await page.waitForFunction(() => window.resonateDebug?.().tuner);
  return page.evaluate(async ({ list, root }) => {
    const v = document.getElementById('version').textContent.trim().replace(/^v/, '');
    const L = await import(`./library.js?v=${v}`);
    const out = {};
    const all = JSON.parse(localStorage.getItem('resonate.play') || '{}');
    for (const s of list) {
      if (s.pdfOnly) out[s.name] = await L.addPdfSong(await (await fetch(root + 'imp/amazing-grace1.pdf')).arrayBuffer(), { name: 'only.pdf', title: s.name });
      else out[s.name] = await L.addSong(s.name, s.xml, { source: s.pdf ? 'pdf' : 'file' });
      if (s.pdf) await L.putPdf(out[s.name], await (await fetch(root + 'imp/amazing-grace1.pdf')).arrayBuffer(), 'a.pdf');
      if (s.view) all[out[s.name]] = { ...(all[out[s.name]] || {}), view: s.view };
    }
    localStorage.setItem('resonate.play', JSON.stringify(all));
    return out;
  }, { list, root: ROOT });
}
const D = (page) => page.evaluate(() => {
  const d = window.resonateDebug();
  return { fing: d.play?.fing, pf: d.piano?.fing, lit: d.piano?.litHands, plit: d.piano?.lit, view: d.play?.view, ready: d.play?.ready, song: d.play?.song, pdf: d.play?.pdf?.on, state: window.resonatePlay?.scoreState?.() };
});
async function fingReady(page, ms = 30000) {
  return page.waitForFunction(() => { const f = window.resonateDebug?.().play?.fing; return f && (f.state === 'ready' || f.state === 'none'); }, null, { timeout: ms, polling: 100 }).then(() => true, () => false);
}
async function openOn(page, id, view = null) {
  const cur = await page.evaluate(() => window.resonateDebug?.().play?.song).catch(() => null);
  if (cur !== id) await SH.openSong(page, id);
  if (view) await setView(page, view);
  await fingReady(page);
  await sleep(300);
}
async function setView(page, view) {
  if ((await D(page)).view === view) return;
  await page.selectOption('#hands', view);
  await page.waitForFunction((v) => { const p = window.resonateDebug().play; return p.ready && p.view === v; }, view, { timeout: 30000 });
  await sleep(300);
}
async function setMode(page, mode) {
  for (let i = 0; i < 4 && (await page.$eval('#fing', (b) => b.dataset.mode)) !== mode; i++) { await page.click('#fing'); await sleep(120); }
  return page.$eval('#fing', (b) => b.dataset.mode);
}
// A press on a note's head (touch or mouse), `during()` while held.
async function pressNote(page, dev, id, { ms = 300, during = null } = {}) {
  const pt = await page.evaluate((id) => { const g = document.getElementById(id); const h = g?.querySelector('.notehead') || g; if (!h) return null; const b = h.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, id);
  if (!pt) return null;
  let out = null;
  if (dev.touch) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y, id: 1 }] });
    await sleep(ms);
    if (during) out = await during();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach().catch(() => {});
  } else {
    await page.mouse.move(pt.x, pt.y); await page.mouse.down(); await sleep(ms);
    if (during) out = await during();
    await page.mouse.up();
  }
  return out ?? true;
}
const keysNow = (page) => page.evaluate(() => {
  const s = document.querySelector('#piano-region .kb > svg');
  return { lit: [...s.querySelectorAll('rect.lit')].map((r) => [Number(r.dataset.midi), r.dataset.hand, r.getAttribute('fill')]), fd: [...s.querySelectorAll('text.fd')].map((t) => [Number(t.dataset.midi), Number(t.textContent)]),
    rings: [...document.querySelectorAll('#piano-region .kb-ghost .kb-gh:not([data-out]) .kb-ring')].map((r) => [r.parentElement.dataset.h, Number(r.dataset.f), Number(r.dataset.midi), r.classList.contains('down')]) };
});
const fingering = (page) => page.evaluate(() => window.resonatePlay.fingering());
const playBtn = async (page) => (await page.evaluateHandle(() => window.resonatePlay.playBtn)).asElement();
// ▶ from page 1 for a moment, then ■: the schedule (items with their muted flags).
async function schedule(page) {
  await (await playBtn(page)).click();
  await page.waitForFunction(() => { const p = window.resonateDebug().play.playback; return p.scheduled.length > 0 && !p.starting; }, null, { timeout: 20000 });
  const items = await page.evaluate(() => window.resonateDebug().play.playback.items);
  await (await playBtn(page)).click();
  await page.waitForFunction(() => window.resonateDebug().play.playback.state === 'idle', null, { timeout: 10000 });
  await sleep(150);
  return items;
}
// ▶ to the end, the keyboard sampled → { S (the sampler's), scheduled, items }.
async function playAll(page, ms = 30000) {
  await page.evaluate(() => window.__kb.start());
  await (await playBtn(page)).click();
  await page.waitForFunction(() => { const p = window.resonateDebug().play.playback; return p.state === 'playing' && !p.starting; }, null, { timeout: 20000 });
  const pb = await page.evaluate(() => { const p = window.resonateDebug().play.playback; return { items: p.items }; });
  await page.waitForFunction(() => window.resonateDebug().play.playback.state === 'idle', null, { timeout: ms, polling: 200 });
  const scheduled = await page.evaluate(() => window.resonateDebug().play.playback.scheduled);
  await sleep(200);
  const S = await page.evaluate(() => window.__kb.stop());
  return { S, scheduled, items: pb.items };
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }).catch(() => {}); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- the checks a device runs on the r6 fixture -------------------------------------------------------
// B: a press on G3 + B4 lights B4 purple with its digit, G3 blue with LH 1.
async function checkPress(page, dev, label, { digits = true } = {}) {
  const fg = await fingering(page);
  const g3 = fg?.n?.nG3, b4 = fg?.n?.nB4;
  ok(g3 && g3[0] === 'l' && g3[1] === 1 && g3[3].includes('m') && b4 && b4[0] === 'r' && b4[1] > 0, `${label}: the fingering moves G3 to the left hand, 1 (m) — B4 right ${b4?.[1]} (${JSON.stringify(g3)} ${JSON.stringify(b4)})`);
  const k = await pressNote(page, dev, 'nG3', { during: () => keysNow(page) });
  const l55 = k?.lit.find((x) => x[0] === 55), l71 = k?.lit.find((x) => x[0] === 71);
  ok(l55 && l55[1] === 'lh' && l55[2] === '#4f7cff' && l71 && l71[1] === 'rh' && l71[2] === '#a64fff', `${label}: a press on G3 + B4 — G3 blue (left hand), B4 purple (${JSON.stringify(k?.lit)})`);
  if (digits) ok(eq(k?.fd.slice().sort((a, b) => a[0] - b[0]), [[55, 1], [71, b4?.[1]]]), `${label}: … G3 LH 1, B4 ${b4?.[1]} on the keys (${JSON.stringify(k?.fd)})`);
  else ok(k && !k.fd.length, `${label}: … no digits (${JSON.stringify(k?.fd)})`);
  await sleep(2400); // (the press's keys go 2 s after the lift)
  return k;
}
// C: ▶'s digits only at position changes (numbers).
async function checkPlayDigits(page, label) {
  const fg = await fingering(page);
  const { S, scheduled } = await playAll(page);
  const n = (id) => fg.n[id];
  const struck = scheduled.filter((x) => n(x.id)).sort((a, b) => a.when - b.when || a.midi - b.midi);
  // the rule, from the stored frames: a hand's notes where its frame index changes (or its first)
  const cur = {}, want = new Map();
  for (const x of struck) {
    const [h, f, p] = n(x.id), c = cur[h];
    let fd;
    if (!c || c.p !== p || c.round !== x.round) { cur[h] = { p, when: x.when, round: x.round }; fd = f > 0; } else fd = f > 0 && Math.abs(x.when - c.when) < 0.02;
    want.set(x.id + '@' + x.round, fd);
  }
  const bad = struck.filter((x) => x.fd !== want.get(x.id + '@' + x.round));
  const shown = struck.filter((x) => x.fd), hidden = struck.filter((x) => !x.fd && n(x.id)[1] > 0);
  ok(struck.length > 0 && !bad.length, `${label}: ▶ — every note's digit decided as the rule says (${struck.length} notes, ${bad.length} not: ${JSON.stringify(bad.slice(0, 3))})`);
  ok(shown.length >= 2 && hidden.length > shown.length, `${label}: ▶ — digits sparse: ${shown.length} notes with one, ${hidden.length} without`);
  // what the keys drew: every digit is a shown note's finger on its key
  const allowed = new Set(shown.map((x) => x.midi + ':' + n(x.id)[1]));
  const drawn = new Set(S.frames.flatMap((f) => f.fd.map(([m, d]) => m + ':' + d)));
  const stray = [...drawn].filter((x) => !allowed.has(x));
  ok(drawn.size > 0 && !stray.length, `${label}: ▶ — the digits drawn are those notes' fingers (${[...drawn].join(' ')}${stray.length ? '; stray ' + stray.join(' ') : ''})`);
  const litNoDigit = S.frames.some((f) => f.lit.some(([m]) => !f.fd.some(([d]) => d === m)));
  ok(litNoDigit, `${label}: ▶ — keys lit without a digit (same position)`);
  return { S, scheduled };
}
// E + F: the ghost hand while ▶ plays (hand).
async function checkGhost(page, label) {
  const fg = await fingering(page);
  const g0 = (await D(page)).pf.ghost;
  const { S } = await playAll(page);
  const g1 = (await D(page)).pf.ghost;
  const frames = g1.frames - g0.frames, builds = g1.builds - g0.builds, downs = g1.downs - g0.downs;
  ok(frames >= 3 && builds === frames && downs >= frames, `${label}: ▶ (hand) — the rings built again once per frame change (${frames} frames, ${builds} builds, ${downs} fingers-down changes)`);
  ok(S.builds.length === builds, `${label}: … the layer's groups added = the builds (${S.builds.length})`);
  const frameKeys = { r: fg.fr.r.map((x) => x.slice(1).join()), l: fg.fr.l.map((x) => x.slice(1).join()) };
  const off = S.frames.flatMap((f) => Object.entries(f.rings).filter(([h, r]) => !frameKeys[h].includes(r.keys.join())).map(([h, r]) => h + ':' + r.keys.join()));
  ok(S.frames.some((f) => f.rings.r || f.rings.l) && !off.length, `${label}: … every ring set is a stored frame's keys (${off.slice(0, 3).join(' ') || 'all'})`);
  const downOk = S.frames.some((f) => Object.values(f.rings).some((r) => r.down.length));
  ok(downOk, `${label}: … a finger that plays filled`);
  const ringedDigit = S.frames.filter((f) => f.fd.some(([m]) => Object.values(f.rings).some((r) => r.keys.includes(m))));
  ok(!ringedDigit.length, `${label}: … no digit disc on a ringed key (${ringedDigit.length} frames)`);
  let dup = 0;
  for (let i = 1; i < S.svg.length; i++) if (S.svg[i] === S.svg[i - 1]) dup++;
  ok(S.svg.length > 0 && !dup && S.svg.length < S.frames.length / 2, `${label}: the SVG written only when what it shows changed (${S.svg.length} writes over ${S.frames.length} frames, ${dup} the same as before)`);
  return S;
}
// D: muting LH silences G3; the LH view plays it, the RH view leaves it out.
async function checkHands(page, label) {
  await setView(page, 'both');
  await page.click('#hear button[data-key="P2|2"]');
  await sleep(200);
  const items = await schedule(page);
  const g3 = items.find((x) => x.id === 'nG3'), b4 = items.find((x) => x.id === 'nB4'), c3 = items.find((x) => x.id === 'nC3');
  ok(g3 && g3.muted && !g3.sound && b4 && b4.sound && c3 && c3.muted, `${label}: LH muted — G3 silenced with it, B4 struck (G3 ${JSON.stringify(g3)}, B4 sound ${b4?.sound})`);
  await page.click('#hear button[data-key="P2|2"]');
  await sleep(200);
  await setView(page, 'lh');
  const lh = await schedule(page);
  ok(lh.some((x) => x.id === 'nG3' && x.sound) && lh.some((x) => x.id === 'nC3') && !lh.some((x) => x.id === 'nB4'), `${label}: the LH view plays G3 (${lh.filter((x) => ['nG3', 'nC3', 'nB4'].includes(x.id)).map((x) => x.id).join(' ')})`);
  await setView(page, 'rh');
  const rh = await schedule(page);
  ok(!rh.some((x) => x.id === 'nG3') && rh.some((x) => x.id === 'nB4'), `${label}: the RH view leaves it out (${rh.filter((x) => ['nG3', 'nB4'].includes(x.id)).map((x) => x.id).join(' ')})`);
  await setView(page, 'both');
}

// ---- the devices --------------------------------------------------------------------------------------
async function desktop(dev) {
  console.log(`\n=== ${dev.n} ${dev.w}×${dev.h}`);
  const ctx = await newCtx(dev);
  const page = await ctx.newPage();
  const ids = await addSongs(page, [
    { name: 'Fingering R6', xml: FX.r6(), view: 'both', pdf: true },
    { name: 'Fingering Long', xml: FX.big(150), view: 'both' },
    { name: 'Only PDF', pdfOnly: true },
  ]);
  const R6 = ids['Fingering R6'];
  await page.evaluate((id) => localStorage.setItem('resonate.sing.song', id), R6);
  await SH.openScore(page, { id: R6 });
  ok(await fingReady(page), 'the fingering worked out on open');
  let d = await D(page);
  ok(d.fing.state === 'ready' && d.fing.from === 'computed' && d.fing.alg === 1 && d.fing.hand === 'sb' && d.fing.bpm === 160 && d.fing.worker >= 1 && d.fing.main === 0, `in the Worker, hand "sb", ♩=160 (${JSON.stringify({ s: d.fing.state, from: d.fing.from, alg: d.fing.alg, hand: d.fing.hand, bpm: d.fing.bpm, worker: d.fing.worker, main: d.fing.main })})`);
  ok(d.fing.notes === 26 && d.fing.moved === 1 && d.fing.wide === 0, `26 notes, 1 moved (G3), none too wide (${d.fing.notes}, ${d.fing.moved}, ${d.fing.wide})`);
  const rec = await page.evaluate(async (id) => { const v = document.getElementById('version').textContent.trim().replace(/^v/, ''); const L = await import(`./library.js?v=${v}`); const s = await L.getSong(id); return s.fing ? { alg: s.fing.alg, hand: s.fing.hand, bpm: s.fing.bpm, sig: s.fing.sig, n: Object.keys(s.fing.n).length, clean: 'clean' in s } : null; }, R6);
  ok(rec && rec.alg === 1 && rec.n === 26 && rec.sig === d.fing.sig, `kept with the song (library.js fing: ${JSON.stringify(rec)})`);

  if (part('A')) {
    const r = await page.evaluate(() => { const f = document.getElementById('fing'), kb = document.querySelector('#piano-region .kb'), row = document.getElementById('piano-region'); const a = f.getBoundingClientRect(), k = kb.getBoundingClientRect(), w = row.getBoundingClientRect(); return { w: a.width, h: a.height, right: a.right, left: a.left, kbRight: k.right, rowRight: w.right, after: kb.nextElementSibling === f, label: f.getAttribute('aria-label'), mode: f.dataset.mode, pref: localStorage.getItem('resonate.play.fingers') }; });
    ok(!d.pf.shown === false && r.w === 44 && r.h === 44 && r.after && r.left >= r.kbRight && r.rowRight - r.right <= 12, `A: #fing shown at the Piano row's right end, 44 × 44 (${JSON.stringify(r)})`);
    ok(r.label === 'Fingering: numbers' && r.mode === 'num' && r.pref === null && d.state.fingering === 'num', `A: numbers by default (${r.label}, pref ${r.pref}, scoreState ${d.state.fingering})`);
    const cyc = [];
    for (let i = 0; i < 3; i++) { await page.click('#fing'); await sleep(150); cyc.push(await page.evaluate(() => [document.getElementById('fing').getAttribute('aria-label'), localStorage.getItem('resonate.play.fingers'), window.resonatePlay.scoreState().fingering])); }
    ok(eq(cyc, [['Fingering: hand', 'hand', 'hand'], ['Fingering: off', 'off', 'off'], ['Fingering: numbers', 'num', 'num']]), `A: a tap cycles numbers → hand → off → numbers, the pref and scoreState follow (${JSON.stringify(cyc)})`);
    for (const [v, want] of [['score', true], ['melody', false], ['rh', true], ['lh', true], ['both', true]]) {
      await setView(page, v);
      d = await D(page);
      ok(d.pf.shown === want && (d.state.fingering != null) === want, `A: ${v} — #fing ${want ? 'shown' : 'hidden'} (${d.pf.shown}, scoreState ${d.state.fingering})`);
    }
    await SH.piano(page, false);
    d = await D(page);
    ok(!d.pf.shown && d.state.fingering === null && d.fing.mode === 'off', `A: the Piano off — no #fing, no fingering in effect (${d.state.fingering}, ${d.fing.mode})`);
    await SH.piano(page, true);
    await sleep(400);
    ok((await D(page)).pf.shown, 'A: the Piano on again — #fing back');
    await page.click('#pdf');
    await page.waitForFunction(() => window.resonateDebug().play.pdf.on, null, { timeout: 20000 });
    await sleep(300);
    d = await D(page);
    ok(!d.pf.shown && d.state.fingering === null, `A: over 📄 — no #fing (${d.pf.shown})`);
    await page.click('#pdf');
    await page.waitForFunction(() => !window.resonateDebug().play.pdf.on && window.resonateDebug().play.ready, null, { timeout: 20000 });
    await sleep(300);
    ok((await D(page)).pf.shown, 'A: back from 📄 — #fing back');
    await SH.openSong(page, ids['Only PDF']).catch(() => {});
    await page.waitForFunction(() => window.resonateDebug().play.pdfOnly, null, { timeout: 20000 }).catch(() => {});
    await sleep(800);
    d = await D(page);
    ok(!d.pf.shown && d.fing.state !== 'ready' && d.state?.fingering == null, `A: a PDF only — no #fing (${d.fing.state})`);
    await openOn(page, R6, 'both');
    await setMode(page, 'hand');
    await SH.reopenScore(page, { id: R6 });
    await fingReady(page);
    await sleep(300);
    d = await D(page);
    ok(d.pf.mode === 'hand' && d.fing.mode === 'hand' && d.fing.from === 'stored', `A/I: a reload keeps the mode (${d.pf.mode}) and works nothing out (${d.fing.from}, computed here ${d.fing.total})`);
    ok(d.fing.total === 0, `I: a reload computes nothing (${d.fing.total})`);
    await setMode(page, 'num');
  }
  if (part('B')) {
    await openOn(page, R6, 'both');
    await checkPress(page, dev, 'B');
    await shot(page, 'finger-desktop-press');
    // a key pressed on the Piano itself: lit, no digit
    const kp = await SH.kbKey(page, 55);
    await page.mouse.move(kp.x, kp.y); await page.mouse.down(); await sleep(300);
    const kk = await keysNow(page);
    await page.mouse.up();
    ok(kk.lit.some((x) => x[0] === 55) && !kk.fd.length, `B: a key pressed on the Piano (G3) — lit, no digit (${JSON.stringify(kk)})`);
    await sleep(400);
  }
  if (part('C')) { await openOn(page, R6, 'both'); await setMode(page, 'num'); await checkPlayDigits(page, 'C'); }
  if (part('D')) { await openOn(page, R6, 'both'); await setMode(page, 'num'); await checkHands(page, 'D'); }
  if (part('E')) {
    await openOn(page, R6, 'both');
    await setMode(page, 'hand');
    const k = await pressNote(page, dev, 'nG3', { during: () => keysNow(page) });
    const lr = k.rings.filter((x) => x[0] === 'l'), rr = k.rings.filter((x) => x[0] === 'r');
    ok(lr.length === 5 && rr.length === 5 && lr.some((x) => x[1] === 1 && x[2] === 55 && x[3]) && rr.some((x) => x[2] === 71 && x[3]) && !k.fd.length, `E: a press (hand) — five rings a hand, G3 under the left thumb filled, B4's filled, no discs (${JSON.stringify(k.rings)})`);
    await shot(page, 'finger-desktop-hand');
    await sleep(2400);
    await checkGhost(page, 'E/F');
    // the stretch picked: its first onset's frame, idle
    await page.evaluate(() => window.resonatePlay.scoreRun('score_select', { from_measure: 4, to_measure: 4 }));
    await sleep(400);
    const gs = (await D(page)).fing.ghost, fg = await fingering(page);
    ok(gs?.r && eq(gs.r.keys, fg.fr.r[gs.r.p].slice(1)) && fg.fr.r[gs.r.p][0] <= 12, `E: idle with a stretch (bar 4) — the right hand's frame at its first onset (${JSON.stringify(gs?.r)})`);
    await setMode(page, 'num');
  }
  if (part('J')) await offIsToday(dev, R6);
  if (part('I')) await cache(dev, ctx, page, R6);
  if (part('G')) {
    await SH.reopenScore(page);
    const t0 = await page.evaluate(() => performance.now());
    await SH.openSong(page, ids['Fingering Long'], 120000);
    ok(await fingReady(page, 60000), 'G: the long piece fingered');
    d = await D(page);
    const lt = await page.evaluate(() => window.__lt);
    const t = d.fing.t;
    const during = lt.filter((x) => x.start + x.dur > t.start && x.start < t.ready);
    ok(d.fing.notes > 2000 && d.fing.from === 'computed' && d.fing.last.sync < 50, `G: ${d.fing.notes} notes worked out in the Worker in ${d.fing.ms} ms; this task's share ${d.fing.last.sync} ms (the notes ${d.fing.last.built} ms)`);
    ok(!during.length, `G: no long task while it's worked out (${(t.ready - t.start).toFixed(0)} ms: ${JSON.stringify(during)})`);
    console.log(`  info: long tasks since the open: ${lt.filter((x) => x.start > t0).map((x) => Math.round(x.dur)).join(' ') || 'none'} ms (Verovio's are expected)`);
  }
  ok(!ctx.errors.length, `${dev.n}: no page errors ${JSON.stringify(ctx.errors.slice(0, 3))}`);
  await ctx.close();
}

// I: what makes it work the fingering out again.
async function cache(dev, ctx, page, R6) {
  await openOn(page, R6, 'both');
  // an ALG bump: finger.js served with ALG 2 (the Worker's import too)
  const src = fs.readFileSync(path.join(__dirname, '../public/finger.js'), 'utf8').replace(/export const ALG = \d+;/, 'export const ALG = 2;');
  await ctx.route('**/finger.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: src }));
  await SH.reopenScore(page, { id: R6 });
  await fingReady(page);
  let d = await D(page);
  ok(d.fing.from === 'computed' && d.fing.alg === 2 && d.fing.total === 1, `I: an ALG bump — worked out again (alg ${d.fing.alg}, ${d.fing.from})`);
  await ctx.unroute('**/finger.js*');
  await SH.reopenScore(page, { id: R6 });
  await fingReady(page);
  d = await D(page);
  ok(d.fing.from === 'computed' && d.fing.alg === 1, `I: … and back (alg ${d.fing.alg}, ${d.fing.from})`);
  // a typed tempo (Sing's "Type a tempo"): another ♩ at 100%
  await page.evaluate((id) => { const t = JSON.parse(localStorage.getItem('resonate.sing.timing') || '{}'); t[id] = { bpm: 120 }; localStorage.setItem('resonate.sing.timing', JSON.stringify(t)); }, R6);
  await SH.reopenScore(page, { id: R6 });
  await fingReady(page);
  d = await D(page);
  ok(d.fing.from === 'computed' && d.fing.bpm === 120, `I: a typed tempo (♩=120) — worked out again (${d.fing.bpm}, ${d.fing.from})`);
  await SH.reopenScore(page, { id: R6 });
  await fingReady(page);
  d = await D(page);
  ok(d.fing.from === 'stored' && d.fing.bpm === 120 && d.fing.total === 0, `I: … then kept (${d.fing.from}, ${d.fing.total})`);
  await page.evaluate((id) => { const t = JSON.parse(localStorage.getItem('resonate.sing.timing') || '{}'); delete t[id]; localStorage.setItem('resonate.sing.timing', JSON.stringify(t)); }, R6);
  // a clean-up change: a converted song (Audiveris) whose cleaned MusicXML this release reads differently
  const cu = await page.evaluate(async (xml) => {
    const v = document.getElementById('version').textContent.trim().replace(/^v/, '');
    const L = await import(`./library.js?v=${v}`);
    const id = await L.addSong('Fingering CU', xml, { source: 'pdf' });
    localStorage.setItem('resonate.sing.song', id);
    return id;
  }, FX.r6({ title: 'Fingering CU' }).replace('<part-list>', '<identification><encoding><software>Audiveris 5.9</software></encoding></identification><part-list>'));
  await SH.reopenScore(page, { id: cu });
  await fingReady(page);
  const s1 = (await D(page)).fing;
  await page.evaluate(async (id) => {
    const v = document.getElementById('version').textContent.trim().replace(/^v/, '');
    const L = await import(`./library.js?v=${v}`);
    const s = await L.getSong(id);
    await L.putSong({ ...s, clean: { xml: (s.clean?.xml ?? s.xml).replace('</score-partwise>', '<!-- a newer clean-up --></score-partwise>'), ver: 'v' + v } }, { quiet: true });
  }, cu);
  await SH.reopenScore(page, { id: cu });
  await fingReady(page);
  const s2 = (await D(page)).fing;
  ok(s1.state === 'ready' && s2.from === 'computed' && s2.sig !== s1.sig, `I: a clean-up change (the cleaned MusicXML read differently) — worked out again (${s1.sig} → ${s2.sig}, ${s2.from})`);
  await page.evaluate((id) => localStorage.setItem('resonate.sing.song', id), R6);
  await SH.reopenScore(page, { id: R6 });
  await fingReady(page);
  // Reprocess: the song's PDF read again (a scripted engine whose MusicXML is the fixture at ♩=140) — the
  // importer works the fingering out after the save; the Score shows the new one
  await ctx.route('**/omr/omr-worker.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: fakeOmr(FX.r6({ bpm: 140 })) }));
  const before = await songFing(page, R6);
  const ev0 = await page.evaluate(() => window.__fingEv.length);
  await page.evaluate((id) => window.resonatePlay.reprocess(id), R6);
  const t0 = Date.now();
  let after = null;
  while (Date.now() - t0 < 90000) { after = await songFing(page, R6); if (after?.rev && after.rev !== before.rev && after.fing?.bpm === 140) break; await sleep(500); }
  ok(after?.rev !== before.rev && after?.fing?.bpm === 140 && after.fing.at > before.fing.at && after.fing.sig === after.sig, `I: Reprocess — the new MusicXML's fingering kept with it (♩=${after?.fing?.bpm}, sig ${after?.fing?.sig === after?.sig ? 'matches' : 'differs'})`);
  await sleep(1000);
  const evs = await page.evaluate(([i, id]) => window.__fingEv.slice(i).filter((e) => e.song === id), [ev0, R6]);
  ok(evs.some((e) => e.from === 'import' && e.bpm === 140) && evs.some((e) => e.from === 'score' && e.bpm === 140) && evs.filter((e) => e.computed).length === 1, `I: … worked out once — after the save, or by the Score's reload — the other reusing it (${JSON.stringify(evs)})`);
  await page.waitForFunction(() => { const f = window.resonateDebug().play.fing; return f.state === 'ready' && f.bpm === 140; }, null, { timeout: 60000 }).catch(() => {});
  d = await D(page);
  ok(d.fing.bpm === 140 && d.fing.state === 'ready', `I: the Score shows the new fingering (♩=${d.fing.bpm}, ${d.fing.from})`);
  // a song the Score isn't showing, converted again: the importer alone works its fingering out
  const id2 = await page.evaluate(async ([xml, root]) => {
    const v = document.getElementById('version').textContent.trim().replace(/^v/, '');
    const L = await import(`./library.js?v=${v}`);
    const id = await L.addSong('Fingering RP2', xml, { source: 'pdf' });
    await L.putPdf(id, await (await fetch(root + 'imp/amazing-grace1.pdf')).arrayBuffer(), 'b.pdf');
    return id;
  }, [FX.r6({ bpm: 100, title: 'Fingering RP2' }), ROOT]);
  const ev1 = await page.evaluate(() => window.__fingEv.length);
  await page.evaluate((id) => window.resonatePlay.reprocess(id), id2);
  let rp2 = null;
  for (const t1 = Date.now(); Date.now() - t1 < 90000; await sleep(500)) { rp2 = await songFing(page, id2); if (rp2?.fing) break; }
  const ev2 = await page.evaluate(([i, id]) => window.__fingEv.slice(i).filter((e) => e.song === id), [ev1, id2]);
  ok(rp2?.fing?.bpm === 140 && rp2.fing.sig === rp2.sig && ev2.length === 1 && ev2[0].from === 'import' && ev2[0].computed, `I: a song not shown, converted again — the importer worked its fingering out after the save (${JSON.stringify(ev2)}, ♩=${rp2?.fing?.bpm})`);
  await ctx.unroute('**/omr/omr-worker.js*');
}
const songFing = (page, id) => page.evaluate(async (id) => {
  const v = document.getElementById('version').textContent.trim().replace(/^v/, '');
  const L = await import(`./library.js?v=${v}`), C = await import(`./catalog.js?v=${v}`), F = await import(`./fingering.js?v=${v}`);
  const s = await L.getSong(id);
  const xml = C.songXml(s);
  return { rev: s.rev ?? null, sig: xml ? F.xmlSig(xml) : null, fing: s.fing ? { bpm: s.fing.bpm, at: s.fing.at, sig: s.fing.sig, alg: s.fing.alg } : null };
}, id);
// A scripted engine (reprocess.cjs's): its MusicXML is `xml`.
function fakeOmr(xml) {
  const b64 = Buffer.from(xml).toString('base64');
  return `
const buf = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;
self.onmessage = async (e) => {
  if (e.data.type !== 'run') return;
  const post = (m) => self.postMessage(m), wait = (t) => new Promise((r) => setTimeout(r, t));
  for (const m of ['fetch', 'jvm']) { post({ type: 'engine', milestone: m }); await wait(15); }
  post({ type: 'log', line: 'INFO  [score]                       Main 280  | Audiveris' }); post({ type: 'engine', milestone: 'start' });
  post({ type: 'engine', milestone: 'font', detail: '156 glyphs' }); await wait(15);
  post({ type: 'log', line: 'INFO  [score] PartwiseBuilder 2707 | Exporting sheet(s): [#1]' }); post({ type: 'export', at: 'write' }); await wait(15);
  post({ type: 'log', line: 'INFO  [score] Score 1 | Score score exported to /files/x/score.mxl' });
  const m = buf(${JSON.stringify(b64)}); post({ type: 'done', mxls: [m] }, [m]);
};`;
}

// J: with the mode off, what ▶ and a press do equals a page whose fingering never came.
async function offIsToday(dev, R6id) {
  const runOne = async (worker) => {
    const ctx = await newCtx(dev, { worker, seed: { 'resonate.play.fingers': 'off' } });
    const page = await ctx.newPage();
    const ids = await addSongs(page, [{ name: 'Fingering R6', xml: FX.r6(), view: 'both' }]);
    const id = ids['Fingering R6'];
    await page.evaluate((id) => localStorage.setItem('resonate.sing.song', id), id);
    await SH.openScore(page, { id });
    if (!worker) await fingReady(page);
    await sleep(1500);
    const f = (await D(page)).fing;
    const out = { state: f.state, mode: f.mode, shown: (await D(page)).pf.shown };
    out.press = (await pressNote(page, dev, 'nG3', { during: () => keysNow(page) })).lit;
    await sleep(2400);
    await page.click('#hear button[data-key="P2|2"]');
    await sleep(200);
    out.both = await schedule(page);
    const pa = await playAll(page);
    out.svg = pa.S.svg;
    out.scheduled = pa.scheduled.map(({ id, midi, round, n }) => ({ id, midi, round, n }));
    await page.click('#hear button[data-key="P2|2"]');
    await setView(page, 'lh');
    out.lh = await schedule(page);
    out.errors = ctx.errors.slice();
    await ctx.close();
    return out;
  };
  const base = await runOne('self.onmessage = () => {};'); // (the Worker never answers: no fingering, ever)
  const off = await runOne(null);
  ok(base.state === 'pending' && !base.shown && off.state === 'ready' && off.mode === 'off' && off.shown, `J: the baseline never fingered (${base.state}); the other fingered, off (${off.state}, ${off.mode}, #fing ${off.shown})`);
  ok(eq(base.press, off.press), `J: off — a press lights the same keys (${JSON.stringify(off.press)})`);
  ok(eq(base.both, off.both) && base.both.some((x) => x.id === 'nG3' && x.sound), `J: off — Both with LH muted schedules the same (${off.both.length} items, G3 heard: staff hands)`);
  ok(eq(base.lh, off.lh) && !off.lh.some((x) => x.id === 'nG3'), `J: off — the LH view schedules the same (${off.lh.length} items, no G3)`);
  ok(eq(base.scheduled, off.scheduled), `J: off — ▶ struck the same notes (${off.scheduled.length})`);
  ok(eq(base.svg, off.svg) && off.svg.length > 3, `J: off — ▶ drew the same keyboards, write for write (${off.svg.length} writes)`);
  ok(!base.errors.length && !off.errors.length, `J: no page errors ${JSON.stringify([...base.errors, ...off.errors].slice(0, 3))}`);
}

async function ipad(dev) {
  console.log(`\n=== ${dev.n} ${dev.w}×${dev.h}`);
  const ctx = await newCtx(dev);
  const page = await ctx.newPage();
  const ids = await addSongs(page, [{ name: 'Fingering R6', xml: FX.r6(), view: 'both' }]);
  const R6 = ids['Fingering R6'];
  await page.evaluate((id) => localStorage.setItem('resonate.sing.song', id), R6);
  await SH.openScore(page, { id: R6 });
  ok(await fingReady(page), 'the fingering worked out on open');
  const d = await D(page);
  ok(d.pf.shown && d.pf.geo.digits && d.pf.geo.rings, `#fing shown; digits and rings at ${d.pf.geo.ww.toFixed(1)} px a white key`);
  await checkPress(page, dev, 'B');
  await shot(page, 'finger-ipad-press');
  await checkPlayDigits(page, 'C');
  await checkHands(page, 'D');
  await setMode(page, 'hand');
  await checkGhost(page, 'E/F');
  await shot(page, 'finger-ipad-hand');
  await setMode(page, 'num');
  // K: Amazing Grace, a hymn — fingered on its views, a press shows digits
  await SH.openSong(page, 'amazing-grace');
  await fingReady(page);
  for (const v of ['score', 'both', 'rh', 'lh', 'melody']) {
    await setView(page, v);
    const x = await D(page);
    ok(x.fing.state === 'ready' && x.fing.available && x.pf.shown, `K: Amazing Grace ${v} — fingered, #fing shown (${x.fing.notes} notes, ${x.fing.from})`);
  }
  await setView(page, 'both');
  const head = await page.evaluate(() => [...document.querySelectorAll('#stage g.note')].find((g) => g.querySelector('.notehead'))?.id);
  const k = await pressNote(page, dev, head, { during: () => keysNow(page) });
  ok(k && k.lit.length && k.fd.length === k.lit.length, `K: a press on Amazing Grace's first chord — every key it lights has its digit (${JSON.stringify(k?.fd)})`);
  ok(!ctx.errors.length, `${dev.n}: no page errors ${JSON.stringify(ctx.errors.slice(0, 3))}`);
  await ctx.close();
}

async function phone(dev) {
  console.log(`\n=== ${dev.n} ${dev.w}×${dev.h}`);
  const ctx = await newCtx(dev);
  const page = await ctx.newPage();
  const ids = await addSongs(page, [{ name: 'Fingering R6', xml: FX.r6(), view: 'both' }, { name: 'Fingering Wide', xml: FX.wide(), view: 'both' }]);
  const R6 = ids['Fingering R6'];
  await page.evaluate((id) => localStorage.setItem('resonate.sing.song', id), R6);
  await SH.openScore(page, { id: R6 });
  ok(await fingReady(page), 'the fingering worked out on open');
  let d = await D(page);
  ok(d.pf.shown && !d.pf.geo.digits, `H: Both with its chips — #fing shown, a white key ${d.pf.geo.ww.toFixed(1)} px: no digits`);
  await checkPress(page, dev, 'H Both', { digits: false });
  await setView(page, 'rh');
  d = await D(page);
  ok(d.pf.geo.digits && d.pf.geo.rings, `H: the RH view (no chips) — ${d.pf.geo.ww.toFixed(1)} px a white key: digits and rings`);
  await checkPress(page, dev, 'H RH');
  await shot(page, 'finger-phone-press');
  await setMode(page, 'hand');
  const k = await pressNote(page, dev, 'nG3', { during: () => keysNow(page) });
  ok(k && k.rings.length === 10, `H: the RH view (hand) — rings on the phone (${k?.rings.length})`);
  await sleep(2400);
  await setMode(page, 'num');
  await SH.openSong(page, ids['Fingering Wide']);
  await fingReady(page);
  await setView(page, 'rh');
  d = await D(page);
  const head = await page.evaluate(() => [...document.querySelectorAll('#stage g.note')].find((g) => g.querySelector('.notehead'))?.id);
  const kw = await pressNote(page, dev, head, { during: () => keysNow(page) });
  ok(d.pf.shown && !d.pf.geo.digits && kw && kw.lit.length && !kw.fd.length, `H: a wide piece (its RH view's keys ${d.pf.geo.lo}–${d.pf.geo.hi}) — ${d.pf.geo.ww.toFixed(1)} px a white key: lit, no digits (${JSON.stringify(kw?.lit.map((x) => x[0]))})`);
  ok(!ctx.errors.length, `${dev.n}: no page errors ${JSON.stringify(ctx.errors.slice(0, 3))}`);
  await ctx.close();
}

(async () => {
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const dev of DEVICES) {
    if (ONLY && !ONLY.has(dev.n)) continue;
    if (dev.n === 'desktop') await desktop(dev);
    else if (dev.n === 'ipad') await ipad(dev);
    else await phone(dev);
  }
  await browser.close();
  done();
})().catch(fail);
