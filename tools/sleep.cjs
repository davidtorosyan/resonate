// Asleep in the background (v86): the owner — "once you take audio context and the page starts
// playing, it stays that way even when I background the app … the app needs to go to sleep when I
// background Safari". Every AudioContext the page makes, every source started and stopped, the mic
// tracks handed out and a fake navigator.audioSession are recorded from before load; the page is
// sent to the background (document.hidden / visibilityState overridden + visibilitychange, or a
// pagehide) while it plays or listens, and then: every context suspended or closed, no keep-alive
// source running, no live mic track, the session "auto", nothing scheduled to sound later. Back in
// front (visible) nothing sounds by itself; a tap → a note sounds again (a source started on a
// running context) / the mic listens again.
//   tuner.html Start · sing.html Listen, a chip key held, a take (kept, as Stop), 🎤 Pitch ·
//   voice.html range test · record.html a take · index.html the tuner, then Sing's Listen, then the
//   Score (a press; back: its context suspended and the session "auto" until the next press)
//   node sleep.cjs   (screenshots into SHOTS)
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:8097/resonate/';
const SHOTS = process.env.SHOTS === '0' ? null : process.env.SHOTS || '/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/sleep'; // ("0": no screenshots, as shell.cjs)
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let passes = 0, fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`); if (c) passes++; else fails++; return c; };
const PROFILE = { active: 'p1', list: [{ id: 'p1', name: 'Dave', vol: { floor: -50, ceiling: -10 }, range: { low: 43, high: 64, comfortLow: 46, comfortHigh: 61, at: 1 } }] };

// In the page, before anything loads.
function instrument() {
  if (location.protocol === 'about:') return;
  const W = window.__z = { ctxs: [], srcs: [], streams: [], session: 'auto' };
  Object.defineProperty(navigator, 'audioSession', { configurable: true, value: { get type() { return W.session; }, set type(v) { W.session = v; } } });
  const Orig = window.AudioContext;
  class Tracked extends Orig { constructor(...a) { super(...a); W.ctxs.push(this); } }
  window.AudioContext = Tracked;
  window.webkitAudioContext = Tracked;
  for (const C of [AudioBufferSourceNode, OscillatorNode, ConstantSourceNode]) {
    const S = C.prototype.start, P = C.prototype.stop;
    C.prototype.start = function (when) {
      const ac = this.context;
      const r = { kind: C.name, ac, node: this, start: Math.max(+when || 0, ac.currentTime), stop: undefined, ended: false, at: performance.now() };
      this.__r = r;
      W.srcs.push(r);
      this.addEventListener('ended', () => { r.ended = true; });
      return S.apply(this, arguments);
    };
    C.prototype.stop = function (when) {
      if (this.__r) this.__r.stop = Math.max(+when || 0, this.context.currentTime);
      return P.apply(this, arguments);
    };
  }
  // The graph's connections (node → nodes), so a source whose path to the output was cut off — a
  // note's damping tail behind a gate the page disconnected when it went to sleep — isn't "sounding".
  const C0 = AudioNode.prototype.connect, D0 = AudioNode.prototype.disconnect;
  AudioNode.prototype.connect = function (dest, ...a) { if (dest instanceof AudioNode) (this.__outs ||= new Set()).add(dest); return C0.call(this, dest, ...a); };
  AudioNode.prototype.disconnect = function (...a) { if (!a.length || !(a[0] instanceof AudioNode)) this.__outs?.clear(); else this.__outs?.delete(a[0]); return D0.apply(this, a); };
  W.audible = (node) => {
    const seen = new Set(), todo = [node];
    while (todo.length) {
      const n = todo.pop();
      if (n === n.context.destination) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const o of n.__outs || []) todo.push(o);
    }
    return false;
  };
  // The simulated singer (its own context, not the page's): the voice page's test as voicetest.cjs,
  // a take's notes as shellsing.cjs, else an A3 for the tuners.
  let shared = null;
  navigator.mediaDevices.getUserMedia = async () => {
    if (!shared) {
      const ac = new Orig();
      const osc = ac.createOscillator(); osc.type = 'sawtooth';
      const g = ac.createGain(); g.gain.value = 0;
      const dest = ac.createMediaStreamDestination();
      osc.connect(g); g.connect(dest); osc.start();
      setInterval(() => {
        let m = 57, d = null;
        try { d = (window.resonateSing?.debug || window.resonateDebug)?.(); } catch {}
        if (d?.run) {
          const r = d.run;
          m = r.kind === 'range' && r.phase === 'anchor' ? 52 : r.kind === 'range' && r.phase === 'listen' && r.target >= 43 && r.target <= 64 ? r.target : null;
        } else if (d?.session?.kind === 'sing') {
          const i = d.notes.findIndex((n) => n.t <= d.nowT && d.nowT < n.t + n.d - 0.04);
          m = i >= 0 ? d.notes[i].midi : null;
        }
        if (m === null) g.gain.setTargetAtTime(0, ac.currentTime, 0.005);
        else { osc.frequency.setValueAtTime(440 * 2 ** ((m - 69) / 12), ac.currentTime); g.gain.setTargetAtTime(0.25, ac.currentTime, 0.005); }
      }, 20);
      shared = dest.stream;
    }
    const s = shared.clone();
    W.streams.push(s);
    return s;
  };
  W.setHidden = (h) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  W.pagehide = () => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
  W.state = () => {
    const mine = (r) => W.ctxs.includes(r.ac);
    const later = (r) => !r.ended && r.ac.state !== 'closed' && (r.stop === undefined || r.stop > Math.max(r.start, r.ac.currentTime) + 0.05) && W.audible(r.node);
    return {
      ctxs: W.ctxs.map((c) => c.state),
      keep: W.srcs.filter((r) => mine(r) && r.kind === 'ConstantSourceNode' && later(r)).length,
      later: W.srcs.filter((r) => mine(r) && r.kind !== 'ConstantSourceNode' && later(r)).map((r) => `${r.kind} start ${r.start.toFixed(2)} stop ${r.stop?.toFixed(2)} now ${r.ac.currentTime.toFixed(2)} ${r.ac.state}`),
      live: W.streams.filter((s) => s.getTracks().some((t) => t.readyState === 'live')).length,
      session: W.session,
      nSrcs: W.srcs.filter(mine).length,
    };
  };
  // Sources started since index n on a running context of the page's.
  W.soundsSince = (n) => W.srcs.slice(n).filter((r) => W.ctxs.includes(r.ac) && r.kind !== 'ConstantSourceNode' && r.ac.state === 'running').length;
}

let browser;
async function page(seed = {}) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await ctx.route('**/*.supabase.co/**', (r) => r.abort());
  await ctx.addInitScript((seed) => {
    try {
      if (location.protocol === 'about:' || sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    } catch {}
  }, seed);
  await ctx.addInitScript(instrument);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  p.cdp = await ctx.newCDPSession(p);
  return p;
}
const st = (p) => p.evaluate(() => window.__z.state());
const until = async (p, fn, ms = 10000, arg) => { const end = Date.now() + ms; while (Date.now() < end) { if (await p.evaluate(fn, arg).catch(() => false)) return true; await p.waitForTimeout(100); } return false; };
const hide = (p) => p.evaluate(() => window.__z.setHidden(true));
const show = (p) => p.evaluate(() => window.__z.setHidden(false));
// The page asleep: what the brief asks of it.
async function asleep(p, label, wait = 1200) {
  await p.waitForTimeout(wait);
  const s = await st(p);
  ok(s.ctxs.length > 0 && s.ctxs.every((x) => x === 'suspended' || x === 'closed'), `${label}: every context suspended or closed (${s.ctxs.join(',')})`);
  ok(s.keep === 0, `${label}: no keep-alive source running (${s.keep})`);
  ok(s.live === 0, `${label}: no live mic track (${s.live})`);
  ok(s.session === 'auto', `${label}: session "${s.session}"`);
  ok(s.later.length === 0, `${label}: nothing scheduled to sound later${s.later.length ? ': ' + s.later.slice(0, 3).join(' | ') : ''}`);
  return s;
}
// Back in front: nothing starts by itself.
async function front(p, label) {
  const n = (await st(p)).nSrcs;
  await show(p);
  await p.waitForTimeout(800);
  const s = await st(p);
  ok(s.nSrcs === n && s.live === 0 && s.ctxs.every((x) => x !== 'running'), `${label}: visible again — nothing started by itself (${s.ctxs.join(',')}, live ${s.live})`);
  return n;
}
async function sounds(p, label, n, ms = 6000) {
  const got = await until(p, (n) => window.__z.soundsSince(n) > 0, ms, n);
  const s = await st(p);
  ok(got && s.ctxs.some((x) => x === 'running'), `${label}: a tap → a note sounds (${await p.evaluate((n) => window.__z.soundsSince(n), n)} sources, ${s.ctxs.join(',')})`);
}
const touch = (p, type, pts) => p.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
const center = (p, sel) => p.$eval(sel, (e) => { e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });

async function tuner() {
  console.log('\n=== tuner.html (the Tuner)');
  const p = await page();
  await p.goto(BASE + 'tuner.html');
  await p.waitForTimeout(500);
  await p.click('#toggle');
  ok(await until(p, () => document.getElementById('toggle').dataset.recording === 'true'), 'Start listens');
  await p.waitForTimeout(500);
  await hide(p);
  await asleep(p, 'tuner hidden');
  ok(/backgrounded/.test(await p.textContent('#status')), `tuner: "${await p.textContent('#status')}"`);
  await front(p, 'tuner');
  await p.click('#toggle');
  ok(await until(p, () => document.getElementById('toggle').dataset.recording === 'true' && window.__z.ctxs.some((c) => c.state === 'running') && window.__z.state().live === 1), 'tuner: a tap → listening again (a running context, a live track)');
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/tuner-back.png` });
  // A Start still waiting for the mic when the page is hidden stands down.
  await p.click('#toggle');
  await p.waitForTimeout(300);
  await p.evaluate(() => { const g = navigator.mediaDevices.getUserMedia; navigator.mediaDevices.getUserMedia = (c) => new Promise((r) => setTimeout(() => r(g(c)), 1500)); });
  await p.click('#toggle');
  await p.waitForTimeout(200);
  await hide(p);
  await asleep(p, 'tuner hidden while the mic opened', 2500);
  await show(p);
  // pagehide while listening.
  await p.click('#toggle');
  await until(p, () => document.getElementById('toggle').dataset.recording === 'true');
  await p.evaluate(() => window.__z.pagehide());
  await asleep(p, 'tuner pagehide');
  ok(!p.errors.length, `tuner: no page errors ${p.errors.join(' | ')}`);
  await p.context().close();
}

async function sing() {
  console.log('\n=== sing.html');
  const p = await page({ 'resonate.sing.guided': 'off', 'resonate.profiles': JSON.stringify(PROFILE) });
  await p.goto(BASE + 'sing.html');
  await until(p, () => window.resonateDebug?.().notes?.length > 0);
  await p.waitForTimeout(500);
  // Listen playing.
  await p.click('#listen');
  ok(await until(p, () => window.resonateDebug().session?.kind === 'listen' && window.resonateDebug().nowT > 2), 'Listen plays');
  await hide(p);
  let s = await asleep(p, 'Listen hidden');
  ok(!(await p.evaluate(() => window.resonateDebug().session)), 'Listen stopped');
  let n = await front(p, 'Listen');
  await p.click('#listen');
  await sounds(p, 'Listen', n);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/sing-listen-back.png` });
  await p.click('#listen'); // ■
  await p.waitForTimeout(300);
  // A chip key held.
  const c = await center(p, '#chips .chip:nth-child(4)');
  await touch(p, 'touchStart', [{ x: c.x, y: c.y, id: 1 }]);
  ok(await until(p, () => [...document.querySelectorAll('#chips .chip')].some((e) => e.dataset.playing === 'true'), 3000), 'a chip key held sounds');
  await p.waitForTimeout(600);
  await hide(p);
  await asleep(p, 'key held, hidden');
  await touch(p, 'touchEnd', []);
  n = await front(p, 'key');
  await touch(p, 'touchStart', [{ x: c.x, y: c.y, id: 2 }]);
  await sounds(p, 'key', n, 3000);
  await p.waitForTimeout(300);
  await touch(p, 'touchEnd', []);
  await p.waitForTimeout(800);
  // 🎤 Pitch listening.
  await p.click('#monitor');
  ok(await until(p, () => window.resonateDebug().monitor?.listening), '🎤 Pitch listens');
  await hide(p);
  await asleep(p, '🎤 Pitch hidden');
  ok(!(await p.evaluate(() => window.resonateDebug().monitor)), '🎤 Pitch off');
  await show(p);
  // A take: stopped as Stop does — kept.
  await p.click('#sing');
  ok(await until(p, () => { const d = window.resonateDebug(); return d.session?.kind === 'sing' && d.nowT > d.notes[0].t + 4; }, 20000), 'a take sings');
  await hide(p);
  s = await asleep(p, 'take hidden', 2000);
  const tk = await p.evaluate(() => { const t = window.resonateDebug().take; return t && { endT: t.endT, frames: t.frames.length, graded: t.grades.filter(Boolean).length, voice: !!t.voice }; });
  ok(tk && tk.endT !== null && tk.frames > 50 && tk.graded > 0 && tk.voice, `the take is kept as Stop keeps it (${JSON.stringify(tk)})`);
  const hist = await p.evaluate(() => JSON.parse(localStorage.getItem('resonate.sing.history') || '{}'));
  ok(Object.values(hist).some((v) => JSON.stringify(v).includes('"at"')), 'its history entry is saved');
  await p.evaluate(() => document.getElementById('rv-close')?.click());
  n = await front(p, 'take');
  await p.click('#listen');
  await sounds(p, 'after the take, Listen', n);
  await p.click('#listen');
  await p.waitForTimeout(300);
  // pagehide during Listen.
  await p.click('#listen');
  await until(p, () => window.resonateDebug().session?.kind === 'listen' && window.resonateDebug().nowT > 1);
  await p.evaluate(() => window.__z.pagehide());
  await asleep(p, 'Listen pagehide');
  ok(!p.errors.length, `sing: no page errors ${p.errors.join(' | ')}`);
  await p.context().close();
}

async function voice() {
  console.log('\n=== voice.html');
  const p = await page({ 'resonate.profiles': JSON.stringify(PROFILE) });
  await p.goto(BASE + 'voice.html');
  await p.waitForTimeout(600);
  const noteBtn = '.stepper[data-k="comfortLow"] .note';
  let n = (await st(p)).nSrcs;
  await p.click(noteBtn);
  await sounds(p, 'voice: a note before the test', n);
  await p.click('#range-btn');
  ok(await until(p, () => window.resonateDebug().run?.phase === 'listen', 15000), 'the range test runs (a reference note played, listening)');
  await p.waitForTimeout(300);
  await p.click(noteBtn).catch(() => {}); // (ignored while a test runs)
  await hide(p);
  await asleep(p, 'range test hidden');
  ok(!(await p.evaluate(() => window.resonateDebug().run)), 'the range test stopped');
  n = await front(p, 'voice');
  await p.click(noteBtn);
  await sounds(p, 'voice: a stepper note', n);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/voice-back.png` });
  // pagehide during the test.
  await p.click('#range-btn');
  await until(p, () => window.resonateDebug().run?.phase === 'anchor', 5000);
  await p.waitForTimeout(400);
  await p.evaluate(() => window.__z.pagehide());
  await asleep(p, 'range test pagehide');
  ok(!p.errors.length, `voice: no page errors ${p.errors.join(' | ')}`);
  await p.context().close();
}

async function record() {
  console.log('\n=== record.html');
  const p = await page();
  await p.goto(BASE + 'record.html');
  await p.waitForTimeout(500);
  // A first take and its playback (the page's playback context exists).
  await p.click('#rec');
  await p.waitForTimeout(2500);
  await p.click('#rec');
  await until(p, () => !!window.resonateDebug().voice);
  await p.click('#play');
  ok(await until(p, () => window.resonateDebug().playing), 'a take plays back');
  await p.waitForTimeout(500);
  // The second take, hidden while it records.
  await p.click('#rec');
  ok(await until(p, () => document.getElementById('rec').dataset.recording === 'true'), 'recording');
  await p.waitForTimeout(2000);
  await hide(p);
  await asleep(p, 'record hidden');
  const d = await p.evaluate(() => ({ rec: document.getElementById('rec').dataset.recording, dur: window.resonateDebug().duration, voice: !!window.resonateDebug().voice }));
  ok(d.rec === 'false' && d.dur > 1 && d.voice, `the take stopped and kept (${JSON.stringify(d)})`);
  const n = await front(p, 'record');
  await p.click('#play');
  await sounds(p, 'record: Play', n);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/record-back.png` });
  await p.waitForTimeout(500);
  await hide(p);
  await asleep(p, 'record playback hidden');
  ok(!(await p.evaluate(() => window.resonateDebug().playing)), 'playback stopped');
  await show(p);
  ok(!p.errors.length, `record: no page errors ${p.errors.join(' | ')}`);
  await p.context().close();
}

async function shell() {
  console.log('\n=== index.html');
  const p = await page({ 'resonate.profiles': JSON.stringify(PROFILE), 'resonate.sing.song': 'amazing-grace', 'resonate.shell.modules': JSON.stringify({ phone: 'sing', tablet: 'sing', desktop: 'sing' }) });
  await p.goto(BASE + 'index.html');
  await until(p, () => !!window.resonateDebug?.().tuner);
  await p.waitForTimeout(300);
  await p.click('#main-btn');
  ok(await until(p, () => window.resonateDebug().tuner.state === 'listening' && window.resonateDebug().tuner.live), 'the tuner listens');
  await p.waitForTimeout(300);
  await hide(p);
  await asleep(p, 'shell tuner hidden');
  ok(await p.evaluate(() => window.resonateDebug().tuner.state === 'off'), 'the tuner is off');
  await front(p, 'shell tuner');
  await p.click('#main-btn');
  ok(await until(p, () => window.resonateDebug().tuner.live && window.__z.ctxs.some((c) => c.state === 'running')), 'shell tuner: a tap → listening again');
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/shell-tuner-back.png` });
  await p.click('#songs-btn');
  await p.waitForSelector('#songs-body .song[data-id="amazing-grace"]', { timeout: 5000 });
  await p.click('#songs-body .song[data-id="amazing-grace"]');
  ok(await until(p, () => window.resonateDebug().song?.open && window.resonateSing?.debug?.().score?.title === 'Amazing Grace', 15000), 'Amazing Grace opens with Sing');
  await p.waitForTimeout(500);
  await p.click('#listen');
  ok(await until(p, () => window.resonateSing.debug().session?.kind === 'listen' && window.resonateSing.debug().nowT > 1.5), "Sing's Listen plays");
  await hide(p);
  await asleep(p, 'shell Listen hidden');
  const n = await front(p, 'shell Listen');
  await p.click('#listen');
  await sounds(p, 'shell Listen', n);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/shell-listen-back.png` });
  // The Score in place (play.js): a press, then the background; back, nothing starts by itself — its
  // context stays suspended and the session isn't raised to "playback" (music the user started in
  // another app meanwhile isn't stopped); the next press sounds and sets "playback".
  // (v87: the dock's toggles — the Score on, then Sing off: the Score alone, as v86's Score button in Sing)
  await p.click('#mod-score');
  await until(p, () => window.resonateDebug().song?.mods === 'both' && !window.resonateDebug().song.switching, 30000);
  await p.click('#mod-sing');
  ok(await until(p, () => window.resonatePlay?.state?.() && window.resonateDebug().song?.mods === 'score' && !window.resonateDebug().song.switching && !window.resonateDebug().song.moving && document.querySelector('#stage g.note > g.notehead'), 30000), 'the Score shows');
  await p.waitForTimeout(800);
  const head = () => p.evaluate(() => { const h = [...document.querySelectorAll('#stage g.note > g.notehead')][3]; const r = h.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  let h = await head(), n0 = (await st(p)).nSrcs;
  await touch(p, 'touchStart', [{ x: h.x, y: h.y, id: 1 }]); await p.waitForTimeout(150); await touch(p, 'touchEnd', []);
  ok(await until(p, (n) => window.__z.soundsSince(n) > 0, 4000, n0) && (await st(p)).session === 'playback', 'shell Score: a press sounds ("playback")');
  await p.waitForTimeout(300);
  await hide(p);
  await asleep(p, 'shell Score hidden');
  const n1 = await front(p, 'shell Score');
  ok((await st(p)).session === 'auto', `shell Score: visible again — the session left "${(await st(p)).session}"`);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/shell-score-back.png` });
  h = await head();
  await touch(p, 'touchStart', [{ x: h.x, y: h.y, id: 1 }]); await p.waitForTimeout(150); await touch(p, 'touchEnd', []);
  await sounds(p, 'shell Score', n1);
  ok((await st(p)).session === 'playback', `shell Score: the press set "playback" (${(await st(p)).session})`);
  await p.evaluate(() => window.__z.pagehide());
  await asleep(p, 'shell pagehide');
  ok(!p.errors.length, `shell: no page errors ${p.errors.join(' | ')}`);
  await p.context().close();
}

(async () => {
  browser = await chromium.launch();
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  for (const [name, fn] of Object.entries({ tuner, sing, voice, record, shell })) {
    if (only && !only.includes(name)) continue;
    try { await fn(); } catch (err) { ok(false, `${name}: ${err.message.split('\n')[0]}`); }
  }
  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
