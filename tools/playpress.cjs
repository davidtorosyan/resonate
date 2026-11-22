// Play (v80): a press on a note sounds at once — "almost so I could play it on the screen".
//   A  sound before sight: the strike (holdPiano → the piano's source start) runs inside the
//      pointerdown's own dispatch, before any change on screen (no class, innerHTML or text written,
//      no rect or offset read between the press and the start), at the context's current time
//      (ahead 0); the colours, names and strip follow on the next frame
//   B  two fingers at once: two strikes, both held and sounding, both lit, the strip lights both;
//      the first lifted, the second goes on
//   C  a second finger doesn't cut the first (no stop / no damping of its sources until its lift)
//   D  rapid alternate taps (overlapping, 70 ms apart): every one sounds at its press
//   E  the same key again while it still sounds: the old note is damped as the new starts (τ 15 ms)
//   F  only the first finger drags: another finger moving keeps its note and picks nothing; the
//      first finger's drag cuts its own strike and picks a stretch; a second finger on paper: nothing
//   G  keep-awake: one inaudible source from the first strike, shared with ▶ (none made for ▶), on
//      after ■, stopped when the page is hidden, back at the next press; the idle timeout (Playwright
//      clock: on before AWAKE, off after; a held finger keeps it on); v86 asleep in the background:
//      hidden → the context suspended, the session "auto"; visible → nothing by itself (still
//      suspended, still "auto": music started in another app meanwhile isn't stopped); the first
//      press sets "playback" and sounds once the context runs; the next strikes in its pointerdown
//   H  the audio session set once ("playback" at the first press), never again per press — but for
//      the sleep: "auto" when hidden, "playback" at the first press after the return
//   I  an iOS-like gate (audio starts only from a touch end / click): the context is made at load
//      with the session untouched; a first press held: silent while held, sounds at the lift; then
//      presses sound at the press; two fingers before any unlock both sound at their lifts; a lift
//      that never starts is dropped (LATE), not played late
//   J  the stage's touch-action is none (no double-tap zoom / pan delay or swallowed pointerdown)
//   K  measured on the owner's Full scores (Killing Me Softly, Piano Man) at 820×1180, CPU ×1 and
//      ×4: the JS lag pointer timeStamp → holdPiano (peekLog.lag, and from outside: → the source's
//      start), the handler's time, nearHead's, ahead; a press while ▶ plays. HEAD_BASE=<a v79
//      server> measures that version from outside the same way (printed, not judged).
// usage: node playpress.cjs   (BASE=http://localhost:8097/resonate/, PLAY_SCORES=<owner's scores>,
//   HEAD_BASE=http://localhost:81xx/resonate/, SHOTS=<dir>)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8097/resonate/";
const HEAD_BASE = process.env.HEAD_BASE || "";
const SCRATCH = "/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad";
const SCORES = process.env.PLAY_SCORES ?? path.join(SCRATCH, "play/scores");
const SHOTS = process.env.SHOTS || path.join(SCRATCH, "playshots");
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) passes++; else { fails++; console.log("FAIL", msg); } };
const info = (...a) => console.log("info", ...a);
const q = (a, p) => { const s = [...a].filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const r1 = (x) => Math.round(x * 10) / 10;

// Piano, 4/4: staff 1 C5 D5 E5 F5 | G5 A5 B5 C6 | …, staff 2 C3 D3 E3 F3 | G3 A3 B3 C4 | … — single
// notes, every key known, the two staves' keys apart.
const N = (step, oct, staff) => `<note><pitch><step>${step}</step><octave>${oct}</octave></pitch><duration>2</duration><voice>${staff === 1 ? 1 : 5}</voice><type>quarter</type><staff>${staff}</staff></note>`;
const bar = (n, hi, lo, first) => `<measure number="${n}">${first ? '<attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>100</per-minute></metronome></direction-type><staff>1</staff><sound tempo="100"/></direction>' : ""}${hi.map(([s, o]) => N(s, o, 1)).join("")}<backup><duration>8</duration></backup>${lo.map(([s, o]) => N(s, o, 2)).join("")}</measure>`;
const UP = [["C", 5], ["D", 5], ["E", 5], ["F", 5]], UP2 = [["G", 5], ["A", 5], ["B", 5], ["C", 6]];
const LO = [["C", 3], ["D", 3], ["E", 3], ["F", 3]], LO2 = [["G", 3], ["A", 3], ["B", 3], ["C", 4]];
const XML = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><work><work-title>Press fixture</work-title></work>
<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">
${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => bar(n, n % 2 ? UP : UP2, n % 2 ? LO : LO2, n === 1)).join("\n")}
</part></score-partwise>`;

// Every page: a fake audio session counting its sets; the strike's footprints with one sequence —
// the pointerdown (capture, and its bubble on window: the end of its dispatch), each buffer
// source's start / stop, every DOM write the peek makes (class, innerHTML, text) and layout read
// (getBoundingClientRect, offset*); the keep-alive ConstantSources; AudioParam damping.
function INIT() {
  window.__session = "auto";
  window.__sets = [];
  if (!window.__gated) Object.defineProperty(navigator, "audioSession", { configurable: true, value: { get type() { return window.__session; }, set type(v) { window.__sets.push(v); window.__session = v; } } });
  const M = (window.__m = { seq: 0, pd: [], starts: [], stops: [], dom: [], reads: [], params: [], cs: { starts: 0, stops: 0, live: 0 } });
  const tick = () => ++M.seq;
  addEventListener("pointerdown", (e) => { M.pd.push({ ts: e.timeStamp, cap: performance.now(), seq: tick(), id: e.pointerId }); }, true);
  addEventListener("pointerdown", (e) => { const p = M.pd.findLast((x) => x.id === e.pointerId); if (p) { p.bub = performance.now(); p.bseq = tick(); } }, false);
  const S = AudioBufferSourceNode.prototype.start, P = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.start = function (when = 0, ...a) { this.__rec = { t: performance.now(), when, ct: this.context.currentTime, seq: tick(), stops: [] }; M.starts.push(this.__rec); return S.call(this, when, ...a); };
  AudioBufferSourceNode.prototype.stop = function (when = 0) { this.__rec?.stops.push({ when, ct: this.context.currentTime, t: performance.now() }); return P.call(this, when); };
  const C0 = ConstantSourceNode.prototype.start, C1 = ConstantSourceNode.prototype.stop;
  ConstantSourceNode.prototype.start = function (...a) { M.cs.starts++; M.cs.live++; this.__live = true; return C0.apply(this, a); };
  ConstantSourceNode.prototype.stop = function (...a) { M.cs.stops++; if (this.__live) { this.__live = false; M.cs.live--; } return C1.apply(this, a); };
  const T = AudioParam.prototype.setTargetAtTime;
  AudioParam.prototype.setTargetAtTime = function (v, t, tc) { M.params.push({ v, t, tc, seq: tick() }); return T.call(this, v, t, tc); };
  const D = DOMTokenList.prototype;
  for (const k of ["add", "remove", "toggle"]) { const f = D[k]; D[k] = function (...a) { M.dom.push({ k, a: a.join(" "), seq: tick() }); return f.apply(this, a); }; }
  for (const [proto, prop] of [[Element.prototype, "innerHTML"], [Node.prototype, "textContent"]]) {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    Object.defineProperty(proto, prop, { configurable: true, get: d.get, set(v) { M.dom.push({ k: prop, seq: tick() }); return d.set.call(this, v); } });
  }
  const R = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () { M.reads.push({ k: "rect", seq: tick() }); return R.call(this); };
  for (const prop of ["offsetWidth", "offsetHeight"]) {
    const d = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get() { M.reads.push({ k: prop, seq: tick() }); return d.get.call(this); } });
  }
  window.__hide = (hidden) => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") }); document.dispatchEvent(new Event("visibilitychange")); };
}
// iOS-like audio (as playextras.cjs): the contexts Play makes (freshCtx) start suspended and only
// start from a resume() called in a touch end / click / key; __block refuses every start.
function GATE() {
  window.__gated = true;
  window.__session = "auto";
  window.__sets = [];
  Object.defineProperty(navigator, "audioSession", { configurable: true, value: { get type() { return window.__session; }, set type(v) { window.__sets.push(v); window.__session = v; } } });
  window.__gesture = false; window.__block = false; window.__ctx = [];
  for (const t of ["pointerup", "click", "touchend", "keydown"]) window.addEventListener(t, () => { window.__gesture = true; setTimeout(() => { window.__gesture = false; }, 0); }, true);
  const AC = window.AudioContext;
  window.AudioContext = class extends AC {
    constructor(...a) {
      super(...a);
      this.__gated = /freshCtx/.test(new Error().stack);
      if (!this.__gated) return;
      this.__id = window.__ctx.length;
      window.__ctx.push({ ctx: this, session: navigator.audioSession.type, at: performance.now(), touched: !!window.__touched });
      this.__susp = true; this.__waiters = []; super.suspend();
    }
    get state() { const s = super.state; return this.__gated && this.__susp && s !== "closed" ? "suspended" : s; }
    resume() {
      if (!this.__gated || !this.__susp) return super.resume();
      if (window.__gesture && !window.__block) { this.__susp = false; const r = super.resume(); r.then(() => { this.dispatchEvent(new Event("statechange")); this.__waiters.splice(0).forEach((f) => f()); }); return r; }
      return new Promise((res) => this.__waiters.push(res));
    }
  };
  addEventListener("pointerdown", () => { window.__touched = true; }, true);
}

const D = (page) => page.evaluate(() => { const d = window.resonateDebug?.().play; if (!d) return null; const { facts, countAll, playback, ...rest } = d; return rest; });
const ready = (page, song, view) => page.waitForFunction(([s, v]) => { const d = window.resonateDebug?.().play; return d && d.ready && (!s || d.song === s) && (!v || d.view === v); }, [song, view], { timeout: 120000 });
async function newPage(browser, errors, { w = 820, h = 1180, gate = false, clock = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  if (gate) await ctx.addInitScript(GATE);
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  if (clock) await page.clock.install({ time: clock });
  page.on("pageerror", (e) => errors.push("pageerror " + e.message));
  page.on("console", (m) => { const t = m.text(); if (m.type() === "error") errors.push("console.error " + t.slice(0, 200)); else if (m.type() === "warning" && /^(song|music engine|loadData|pdf|piano|play)\b/.test(t)) errors.push("console.warn " + t.slice(0, 200)); });
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp };
}
// The songs (once per browser context's origin storage) → ids; opens `open` in `view`.
async function seed(page, list, open, view) {
  await page.goto(BASE + "tools.html");
  const ids = await page.evaluate(async (list) => {
    const v = document.getElementById("version")?.textContent.trim().slice(1) || "";
    const L = await import(`./library.js?v=${v}`);
    const out = {};
    for (const [n, xml] of list) out[n] = await L.addSong(n, xml, { source: "file" });
    return out;
  }, list);
  if (open) await show(page, ids[open], view);
  return ids;
}
async function show(page, id, view) {
  await page.evaluate(([id, view]) => {
    localStorage.setItem("resonate.sing.song", id);
    if (view) { const all = JSON.parse(localStorage.getItem("resonate.play") || "{}"); all[id] = { ...(all[id] || {}), view }; localStorage.setItem("resonate.play", JSON.stringify(all)); }
  }, [id, view]);
  await page.goto(BASE + "play.html");
  await ready(page, id, view);
  await sleep(600);
}
// CDP touches: the active points (id → [x, y]) after each change.
function fingers(cdp) {
  const on = new Map();
  const send = (type) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: [...on].map(([id, [x, y]]) => ({ x, y, id })) });
  return {
    down: (id, x, y) => { on.set(id, [x, y]); return send("touchStart"); },
    move: (id, x, y) => { on.set(id, [x, y]); return send("touchMove"); },
    // (CDP's touchEnd releases the points it lists)
    up: (id) => { const pt = on.get(id); on.delete(id); return cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: pt ? [{ x: pt[0], y: pt[1], id }] : [] }); },
  };
}
// The fixture's heads: key → { id, x, y, midi } ("C5@0": step+octave @ written bar index).
const heads = (page) => page.evaluate(() => {
  const F = window.resonateDebug().play.facts, out = {};
  for (const g of document.querySelectorAll("#stage .page g.note")) {
    const f = F[g.id], h = g.querySelector(":scope > g.notehead");
    if (!f || !h) continue;
    const b = h.getBoundingClientRect();
    out[`${f.step}${f.oct}@${f.mi}`] = { id: g.id, x: b.left + b.width / 2, y: b.top + b.height / 2, midi: f.midi };
  }
  return out;
});
// A spot on paper (no head within 40 px), away from the strip's foot.
const paper = (page) => page.evaluate(() => {
  const st = document.getElementById("stage").getBoundingClientRect();
  const hs = [...document.querySelectorAll("#stage g.note > g.notehead")].map((h) => { const b = h.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
  for (let y = st.top + 20; y < st.bottom - 160; y += 7) for (const x of [st.left + st.width * 0.95, st.left + 8, st.left + st.width / 2]) if (hs.every(([hx, hy]) => Math.hypot(hx - x, hy - y) >= 40)) return { x, y };
  return null;
});
const M = (page) => page.evaluate(() => ({ pd: window.__m.pd.length, st: window.__m.starts.length, dom: window.__m.dom.length, reads: window.__m.reads.length, params: window.__m.params.length }));
// What one press left (from the marks m0 on): its pointerdown, its first start, the DOM writes and
// layout reads between them, the strike's log.
const pressFacts = (page, m0) => page.evaluate((m0) => {
  const W = window.__m, pd = W.pd[m0.pd], st = W.starts[m0.st];
  if (!pd || !st) return { pd: !!pd, st: !!st };
  const between = (list) => list.filter((x) => x.seq > pd.seq && x.seq < st.seq);
  return {
    lag: st.t - pd.ts, ahead: st.when - st.ct, inDispatch: pd.bseq != null && st.seq < pd.bseq, handler: pd.bub - pd.cap,
    writes: between(W.dom).map((x) => x.k + (x.a ? ":" + x.a : "")), reads: between(W.reads).map((x) => x.k),
    log: window.resonateDebug().play.peekLog.at(-1),
  };
}, m0);
const unlock = async (page, cdp) => { const p = await paper(page); const f = fingers(cdp); await f.down(1, p.x, p.y); await sleep(50); await f.up(1); await sleep(900); };

(async () => {
  const browser = await chromium.launch();

  // ---- A–H, J on the fixture
  {
    const errors = [];
    const { ctx, page, cdp } = await newPage(browser, errors);
    const ids = await seed(page, [["press", XML]], "press");
    const H = await heads(page);
    const need = ["C5@0", "E5@0", "C3@0", "E3@0", "G5@1", "G3@1", "C5@2", "C3@2"];
    ok(need.every((k) => H[k]), `fixture heads ${need.filter((k) => !H[k])}`);
    const f = fingers(cdp);
    await unlock(page, cdp);
    let d = await D(page);
    ok(d.audio?.state === "running" && d.audio.piano, `after the first tap: running, piano decoded (${JSON.stringify(d.audio)})`);
    ok(!d.awake.on, `no keep-awake before a press (${JSON.stringify(d.awake)})`);

    // A. sound before sight
    let m0 = await M(page);
    await f.down(1, H["C5@0"].x, H["C5@0"].y);
    let p = await pressFacts(page, m0);
    ok(p.inDispatch, `A the strike runs inside the pointerdown's dispatch (${JSON.stringify(p)})`);
    ok(p.writes && !p.writes.length && !p.reads.length, `A nothing written or measured on screen before the sound (writes ${JSON.stringify(p.writes)}, reads ${JSON.stringify(p.reads)})`);
    ok(p.ahead <= 0.0005 && p.ahead > -0.01 && p.log?.ahead <= 0.0005 && p.log.how === "hold", `A started at the context's current time (ahead ${p.ahead}, log ${JSON.stringify(p.log)})`);
    ok(p.lag < 30 && p.log.lag < 30, `A lag ${r1(p.lag)} ms (log ${p.log?.lag})`);
    await sleep(120);
    d = await D(page);
    let vis = await page.evaluate((id) => ({ peek: document.querySelector(`#stage g.note#${id}`)?.classList.contains("peek"), bubble: document.getElementById("bubble").classList.contains("on") && document.getElementById("bubble").textContent, strip: document.querySelectorAll("#strip rect.lit").length > 0 }), H["C5@0"].id);
    ok(vis.peek && vis.bubble === "C5" && vis.strip && d.peek?.lit.map((k) => k.midi).join() === "72", `A then on screen: head lit, "${vis.bubble}", strip ${JSON.stringify(d.peek?.lit)}`);
    ok(d.awake.on && d.awake.same, `G the first strike keeps the output awake (${JSON.stringify(d.awake)})`);
    await f.up(1);
    await sleep(300);

    // B. two fingers at once
    m0 = await M(page);
    await f.down(1, H["E5@0"].x, H["E5@0"].y);
    await f.down(2, H["G3@1"].x, H["G3@1"].y);
    await sleep(150);
    d = await D(page);
    let log = d.peekLog.slice(-2);
    ok(log.length === 2 && log.every((x) => x.how === "hold") && log[0].pid !== log[1].pid && log.map((x) => x.midis.join()).join("|") === "76|55", `B two fingers: two strikes (${JSON.stringify(log.map((x) => [x.pid, x.midis, x.how]))})`);
    ok(d.peeks.length === 2 && d.peeks.every((x) => x.held && x.sounding.length === 1), `B both held and sounding (${JSON.stringify(d.peeks)})`);
    vis = await page.evaluate((ids) => ({ lit: ids.map((id) => document.querySelector(`#stage g.note#${id}`)?.classList.contains("peek")), bubble: document.getElementById("bubble").textContent }), [H["E5@0"].id, H["G3@1"].id]);
    ok(vis.lit.every(Boolean) && JSON.stringify(d.peek.lit.map((k) => k.midi).sort()) === "[55,76]" && vis.bubble === "G3", `B both heads lit, the strip lights both, the names of the newest (${JSON.stringify(vis)}, ${JSON.stringify(d.peek.lit)})`);
    await page.screenshot({ path: path.join(SHOTS, "press-two-fingers.png") });
    await f.up(1);
    await sleep(120);
    d = await D(page);
    ok(d.peeks.length === 2 && !d.peeks[0].held && d.peeks[1].held && d.peeks[1].sounding.join() === "55", `B finger 1 lifted: finger 2's note goes on (${JSON.stringify(d.peeks)})`);
    await f.up(2);
    await sleep(300);

    // C. a second finger doesn't cut the first
    m0 = await M(page);
    await f.down(1, H["C3@0"].x, H["C3@0"].y);
    await sleep(150);
    await f.down(2, H["G5@1"].x, H["G5@1"].y);
    await sleep(300);
    let r = await page.evaluate((m0) => {
      const W = window.__m, first = W.starts[m0.st];
      return { stops: first ? first.stops.filter((s) => s.when < first.ct + 10) : null, peeks: window.resonateDebug().play.peeks };
    }, m0);
    ok(r.stops && !r.stops.length && r.peeks.length === 2 && r.peeks[0].held && r.peeks[0].sounding.join() === "48", `C the first finger's note isn't cut by the second (${JSON.stringify(r)})`);
    await f.up(2);
    await sleep(200);
    d = await D(page);
    ok(d.peeks.find((x) => x.held)?.sounding.join() === "48", `C the second lifted first: the first still sounds (${JSON.stringify(d.peeks)})`);
    await f.up(1);
    await sleep(400);

    // D. rapid alternate taps, overlapping
    const n0 = (await D(page)).peekLog.length;
    const s0 = (await M(page)).st;
    const A_ = H["D5@0"] || H["E5@0"], B_ = H["D3@0"] || H["E3@0"];
    for (let i = 0; i < 12; i++) {
      const h = i % 2 ? B_ : A_, id = 1 + (i % 2);
      await f.down(id, h.x, h.y);
      await sleep(35);
      if (i > 0) await f.up(1 + ((i + 1) % 2));
      await sleep(35);
    }
    await f.up(1 + (11 % 2));
    await sleep(200);
    d = await D(page);
    log = d.peekLog.slice(n0);
    const s1 = (await M(page)).st;
    ok(log.length === 12 && log.every((x) => x.how === "hold" && x.ahead <= 0.0005) && s1 - s0 >= 12, `D 12 rapid alternate taps: 12 strikes at their presses (${log.length}, ${log.map((x) => x.how).join(",")}, ${s1 - s0} sources)`);
    info("D lags", log.map((x) => x.lag).join(" "));
    await sleep(2500);

    // E. the same key again while it still sounds (a quick tap rings MIN_PRESS)
    m0 = await M(page);
    await f.down(1, H["C5@2"].x, H["C5@2"].y);
    await sleep(40);
    await f.up(1);
    await sleep(60);
    await f.down(1, H["C5@2"].x, H["C5@2"].y);
    await sleep(40);
    d = await D(page);
    r = await page.evaluate((m0) => {
      const W = window.__m, st = W.starts.slice(m0.st);
      const second = st[st.length - 1];
      return { n: st.length, damp: W.params.slice(m0.params).filter((x) => x.v === 0 && Math.abs(x.tc - 0.015) < 1e-6 && second && Math.abs(x.t - second.when) < 0.02).length };
    }, m0);
    ok(d.peekLog.at(-1).again?.join() === "72" && r.damp >= 1, `E the same key struck again: the old note damped as the new starts (again ${JSON.stringify(d.peekLog.at(-1).again)}, ${r.damp} damped at τ 15 ms)`);
    await f.up(1);
    await sleep(300);
    // (E3: two quick taps on one note are a double-tap — both struck in their press, as above — and
    // pick that chord; a tap on paper lets go of it before F)
    const picked = await page.evaluate(() => window.resonateDebug().play.playback.span);
    ok(picked?.note?.ids?.length >= 1, `E …and the two quick taps picked that chord (a double-tap, E3: ${JSON.stringify(picked)})`);
    const pe = await paper(page);
    await f.down(1, pe.x, pe.y); await sleep(40); await f.up(1); await sleep(200);

    // F. only the first finger drags
    m0 = await M(page);
    await f.down(1, H["E5@0"].x, H["E5@0"].y);
    await f.down(2, H["C3@2"].x, H["C3@2"].y);
    await sleep(100);
    for (let i = 1; i <= 5; i++) { await f.move(2, H["C3@2"].x + 14 * i, H["C3@2"].y + 2); await sleep(20); }
    await sleep(100);
    d = await D(page);
    let pb = await page.evaluate(() => window.resonateDebug().play.playback.span);
    ok(!pb && d.peeks.length === 2 && d.peeks.every((x) => x.held && x.sounding.length) && !d.peekLog.slice(-2).some((x) => x.cut), `F another finger moving: no stretch, its note held (${JSON.stringify(pb)}, ${JSON.stringify(d.peeks)})`);
    for (let i = 1; i <= 8; i++) { await f.move(1, H["E5@0"].x + 20 * i, H["E5@0"].y + 1); await sleep(20); }
    await sleep(100);
    d = await D(page);
    pb = await page.evaluate(() => window.resonateDebug().play.playback.span);
    const lg = d.peekLog.slice(-2);
    ok(pb && lg[0].cut && !lg[1].cut && d.peeks.length === 1 && d.peeks[0].held && d.peeks[0].sounding.join() === "48", `F the first finger's drag: a stretch, its strike cut, the other's still held (${JSON.stringify(pb)}, ${JSON.stringify(lg.map((x) => [x.midis, x.cut]))}, ${JSON.stringify(d.peeks)})`);
    await f.up(1);
    await f.up(2);
    await sleep(300);
    // a second finger on paper: nothing
    const pp = await paper(page);
    const nb = (await D(page)).peekLog.length;
    const span0 = await page.evaluate(() => window.resonateDebug().play.playback.span);
    await f.down(1, H["G5@1"].x, H["G5@1"].y);
    await f.down(2, pp.x, pp.y);
    for (let i = 1; i <= 5; i++) { await f.move(2, pp.x - 15 * i, pp.y); await sleep(20); }
    await f.up(2);
    await f.up(1);
    await sleep(150);
    d = await D(page);
    pb = await page.evaluate(() => window.resonateDebug().play.playback.span);
    ok(d.peekLog.length === nb + 1 && pb && JSON.stringify(pb) === JSON.stringify(span0), `F a second finger on paper: nothing — no strike, the stretch kept (${d.peekLog.length - nb}, ${JSON.stringify(pb)})`);
    await page.click("#sel-clear").catch(() => {});
    await sleep(2300);

    // G. keep-awake shared with ▶, hidden, back at the next press
    let cs = await page.evaluate(() => ({ ...window.__m.cs }));
    ok(cs.live === 1 && cs.starts === 1, `G one keep-awake source so far (${JSON.stringify(cs)})`);
    await page.click("#play");
    await page.waitForFunction(() => window.resonateDebug().play.playback.state === "playing", null, { timeout: 8000 }).catch(() => {});
    await sleep(400);
    cs = await page.evaluate(() => ({ ...window.__m.cs }));
    ok(cs.live === 1 && cs.starts === 1, `G ▶ uses the same source, none made for it (${JSON.stringify(cs)})`);
    // a press while ▶ plays: still at once
    m0 = await M(page);
    await f.down(1, H["C3@2"].x, H["C3@2"].y);
    p = await pressFacts(page, m0);
    ok(p.inDispatch && !p.writes.length && p.log?.ahead <= 0.0005, `G a press while ▶ plays strikes at once (${JSON.stringify({ lag: p.lag, writes: p.writes, reads: p.reads })})`);
    await f.up(1);
    await page.click("#play");
    await sleep(300);
    d = await D(page);
    cs = await page.evaluate(() => ({ ...window.__m.cs }));
    ok(d.awake.on && cs.live === 1, `G ■: still awake (${JSON.stringify(d.awake)}, ${JSON.stringify(cs)})`);
    await page.evaluate(() => window.__hide(true));
    await sleep(100);
    d = await D(page);
    cs = await page.evaluate(() => ({ ...window.__m.cs }));
    ok(!d.awake.on && cs.live === 0, `G hidden: the source stops (${JSON.stringify(d.awake)}, ${JSON.stringify(cs)})`);
    ok(d.audio?.state === "suspended" && (await page.evaluate(() => navigator.audioSession.type)) === "auto", `G hidden: asleep — the context ${d.audio?.state}, the session ${await page.evaluate(() => navigator.audioSession.type)}`);
    const setsHidden = (await page.evaluate(() => window.__sets.slice())).length;
    await page.evaluate(() => window.__hide(false));
    await sleep(600);
    d = await D(page);
    r = await page.evaluate(() => ({ session: navigator.audioSession.type, sets: window.__sets.slice() }));
    ok(!d.awake.on, `G visible again: not until a press (${JSON.stringify(d.awake)})`);
    ok(d.audio?.state === "suspended" && r.session === "auto" && r.sets.length === setsHidden, `G visible again: nothing starts by itself — the context ${d.audio?.state}, the session ${r.session} (${JSON.stringify(r.sets)})`);
    m0 = await M(page);
    await f.down(1, H["E3@0"].x, H["E3@0"].y);
    await page.waitForFunction((n) => window.__m.starts.length > n, m0.st, { timeout: 3000 }).catch(() => {});
    p = await pressFacts(page, m0);
    r = await page.evaluate(() => ({ session: navigator.audioSession.type, state: window.resonateDebug().play.audio?.state }));
    ok(p.lag != null && p.log?.how === "hold" && p.lag < 300 && r.session === "playback" && r.state === "running", `G the first press after the return: "playback", the context resumed, sounds ${r1(p.lag)} ms after its press (${JSON.stringify(p.log)}, ${JSON.stringify(r)})`);
    await sleep(80);
    await f.up(1);
    await sleep(200);
    m0 = await M(page);
    await f.down(1, H["C3@0"].x, H["C3@0"].y);
    p = await pressFacts(page, m0);
    ok(p.inDispatch && p.log?.how === "hold" && p.log.ahead <= 0.0005 && p.lag < 30, `G the next press strikes in its pointerdown (lag ${r1(p.lag)} ms)`);
    await sleep(80);
    await f.up(1);
    d = await D(page);
    cs = await page.evaluate(() => ({ ...window.__m.cs }));
    ok(d.awake.on && cs.live === 1 && cs.starts === 2, `G the next press: awake again (${JSON.stringify(cs)})`);

    // H. the session set once
    const sets = await page.evaluate(() => window.__sets.slice());
    ok(sets.join() === "playback,auto,playback", `H the session set once at the first press — then "auto" asleep, "playback" at the first press back (${JSON.stringify(sets)})`);

    // J. touch-action
    const ta = await page.evaluate(() => ({ stage: getComputedStyle(document.getElementById("stage")).touchAction, page: getComputedStyle(document.querySelector("#stage .page")).touchAction }));
    ok(ta.stage === "none", `J the stage's touch-action is none (${JSON.stringify(ta)})`);

    // pagehide: the context closed, the session back to auto, no source
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
    r = await page.evaluate(() => ({ session: navigator.audioSession.type, cs: { ...window.__m.cs }, audio: window.resonateDebug().play.audio, awake: window.resonateDebug().play.awake }));
    ok(r.session === "auto" && r.cs.live === 0 && !r.audio && !r.awake.on, `pagehide: session auto, nothing awake (${JSON.stringify(r)})`);
    ok(!errors.length, `A–J no errors: ${errors.join(" | ")}`);
    await ctx.close();
  }

  // ---- G2. the idle timeout (Playwright clock)
  {
    const errors = [];
    const { ctx, page, cdp } = await newPage(browser, errors, { clock: new Date("2026-11-17T10:00:00") });
    await seed(page, [["press", XML]], "press");
    const H = await heads(page);
    const f = fingers(cdp);
    await unlock(page, cdp);
    await f.down(1, H["C5@0"].x, H["C5@0"].y);
    await sleep(80);
    await f.up(1);
    await sleep(100);
    let d = await D(page);
    const AW = d.awake.ms;
    ok(d.awake.on && AW >= 60000 && AW <= 120000, `G2 awake after a press (${JSON.stringify(d.awake)})`);
    await page.clock.fastForward(AW - 5000);
    d = await D(page);
    ok(d.awake.on, `G2 still awake ${(AW - 5000) / 1000} s after (${JSON.stringify(d.awake)})`);
    await page.clock.fastForward(10000);
    d = await D(page);
    let cs = await page.evaluate(() => ({ ...window.__m.cs }));
    ok(!d.awake.on && cs.live === 0, `G2 asleep ${(AW + 5000) / 1000} s after the last press (${JSON.stringify(d.awake)}, ${JSON.stringify(cs)})`);
    // a finger held keeps it awake (MAX_HOLD lets go at 60 s: then AWAKE from that lift)
    await f.down(1, H["E5@0"].x, H["E5@0"].y);
    await sleep(80);
    await page.clock.fastForward(AW + 10000);
    d = await D(page);
    ok(d.awake.on, `G2 a held note keeps it awake past ${AW / 1000} s (${JSON.stringify(d.awake)})`);
    await f.up(1);
    ok(!errors.length, `G2 no errors: ${errors.join(" | ")}`);
    await ctx.close();
  }

  // ---- I. an iOS-like gate
  {
    const errors = [];
    const { ctx, page, cdp } = await newPage(browser, errors, { gate: true });
    await seed(page, [["press", XML]], "press");
    const H = await heads(page);
    const f = fingers(cdp);
    await page.waitForFunction(() => window.__ctx.length > 0, null, { timeout: 5000 }).catch(() => {});
    let r = await page.evaluate(() => ({ ctx: window.__ctx.map((c) => ({ s: c.session, st: c.ctx.state, touched: c.touched })), piano: window.resonateDebug().play.audio?.piano }));
    ok(r.ctx.length === 1 && r.ctx[0].s === "auto" && !r.ctx[0].touched && r.ctx[0].st === "suspended", `I the context is made at load, session untouched (${JSON.stringify(r)})`);
    await page.waitForFunction(() => window.resonateDebug().play.audio?.piano, null, { timeout: 8000 }).catch(() => {});
    ok((await D(page)).audio?.piano, "I the piano decoded on the suspended context before any touch");
    // first touch: a 0.8 s hold — silent while held, sounds at the lift
    let m0 = await M(page);
    await f.down(1, H["C5@0"].x, H["C5@0"].y);
    await sleep(800);
    r = await page.evaluate((m0) => ({ starts: window.__m.starts.length - m0.st, sets: window.__sets.slice(), log: window.resonateDebug().play.peekLog.length }), m0);
    ok(r.starts === 0 && r.log === 0 && r.sets.join() === "playback", `I held before the unlock: silent, the session "playback" (${JSON.stringify(r)})`);
    await f.up(1);
    await sleep(300);
    let d = await D(page);
    ok(d.peekLog.length === 1 && d.peekLog[0].how === "lift" && d.audio.state === "running", `I at the lift it sounds (${JSON.stringify(d.peekLog)}, ${d.audio.state})`);
    await sleep(400);
    // then at the press
    m0 = await M(page);
    await f.down(1, H["E3@0"].x, H["E3@0"].y);
    let p = await pressFacts(page, m0);
    ok(p.inDispatch && p.log?.how === "hold" && p.log.ahead <= 0.0005 && !p.writes.length, `I then a press sounds at the press (${JSON.stringify({ lag: p.lag, how: p.log?.how, writes: p.writes })})`);
    await f.up(1);
    await sleep(300);
    r = await page.evaluate(() => ({ n: window.__ctx.length, sets: window.__sets.slice() }));
    ok(r.n === 1 && r.sets.length === 1, `I one context, the session set once (${JSON.stringify(r)})`);
    // LATE: a lift whose context never starts is dropped
    await page.evaluate(() => { const c = window.__ctx.at(-1).ctx; Object.defineProperty(c, "state", { get: () => "suspended", configurable: true }); c.resume = () => new Promise(() => {}); window.__block = true; });
    const n0 = (await D(page)).peekLog.length;
    await f.down(1, H["G5@1"].x, H["G5@1"].y); await sleep(100); await f.up(1);
    await sleep(2300);
    d = await D(page);
    ok(d.peekLog.length === n0 && d.audio.stuck, `I a lift that never starts: nothing plays late (${d.peekLog.length - n0}, stuck ${d.audio.stuck})`);
    ok(!errors.length, `I no errors: ${errors.join(" | ")}`);
    await ctx.close();
  }
  // two fingers before any unlock: both sound at their lifts
  {
    const errors = [];
    const { ctx, page, cdp } = await newPage(browser, errors, { gate: true });
    await seed(page, [["press", XML]], "press");
    const H = await heads(page);
    const f = fingers(cdp);
    await sleep(500);
    await f.down(1, H["C5@0"].x, H["C5@0"].y);
    await f.down(2, H["C3@2"].x, H["C3@2"].y);
    await sleep(500);
    await f.up(1);
    await sleep(150);
    await f.up(2);
    await sleep(500);
    const d = await D(page);
    // (the first lift starts the audio: the finger still down sounds then, held)
    const by = Object.fromEntries(d.peekLog.map((x) => [x.midis.join(), x]));
    ok(d.peekLog.length === 2 && by["72"]?.how === "lift" && by["48"]?.how === "hold" && Math.abs(by["72"].at - by["48"].at) < 200, `I two fingers before the unlock: the first sounds at its lift, the other — still held — with it (${JSON.stringify(d.peekLog.map((x) => [x.midis, x.how, x.at]))})`);
    ok(!errors.length, `I2 no errors: ${errors.join(" | ")}`);
    await ctx.close();
  }

  // ---- K. measured on the owner's Full scores (and HEAD_BASE's, from outside)
  const have = (n) => SCORES && fs.existsSync(path.join(SCORES, n + ".musicxml"));
  if (have("killing") && have("pianoman")) {
    const list = ["killing", "pianoman"].map((n) => [n, fs.readFileSync(path.join(SCORES, n + ".musicxml"), "utf8")]);
    const runs = [["this", BASE], ...(HEAD_BASE ? [["head", HEAD_BASE]] : [])];
    for (const [tag, base] of runs) {
      const errors = [];
      const { ctx, page, cdp } = await newPage(browser, errors);
      const ids = await (async () => {
        await page.goto(base + "tools.html");
        return page.evaluate(async (list) => {
          const v = document.getElementById("version")?.textContent.trim().slice(1) || "";
          const L = await import(`./library.js?v=${v}`);
          const out = {};
          for (const [n, xml] of list) out[n] = await L.addSong(n, xml, { source: "file" });
          return out;
        }, list);
      })();
      for (const name of ["killing", "pianoman"]) {
        await page.evaluate(([id]) => { localStorage.setItem("resonate.sing.song", id); const all = JSON.parse(localStorage.getItem("resonate.play") || "{}"); all[id] = { ...(all[id] || {}), view: "score" }; localStorage.setItem("resonate.play", JSON.stringify(all)); }, [ids[name]]);
        await page.goto(base + "play.html");
        await ready(page, ids[name], "score");
        await sleep(800);
        await unlock(page, cdp);
        let med1 = null;
        for (const cpu of [1, 4]) {
          if (cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
          const hs = await page.evaluate(() => {
            const all = [...document.querySelectorAll("#stage g.note > g.notehead")].map((h) => { const b = h.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
            const step = Math.max(1, Math.floor(all.length / 20));
            return all.filter((_, i) => i % step === 0).slice(0, 20);
          });
          const rows = [];
          const f = fingers(cdp);
          for (const h of hs) {
            const m0 = await M(page);
            await f.down(1, h.x, h.y);
            await sleep(150);
            await f.up(1);
            await sleep(250);
            const p = await pressFacts(page, m0);
            if (p.lag != null) rows.push(p);
          }
          if (cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
          const L = rows.map((x) => x.lag), Hd = rows.map((x) => x.handler);
          const res = {
            n: rows.length, lag: [r1(q(L, 0.5)), r1(q(L, 0.9)), r1(Math.max(...L))], handler: [r1(q(Hd, 0.5)), r1(q(Hd, 0.9))],
            ahead_ms: r1(q(rows.map((x) => x.ahead * 1000), 0.5)), domBefore: rows.filter((x) => x.writes.length).length, readsBefore: rows.filter((x) => x.reads.length).length,
            log: rows[0]?.log?.lag != null ? { lag: r1(q(rows.map((x) => x.log.lag), 0.5)), hit: r1(q(rows.map((x) => x.log.hit), 0.5)), hitMax: r1(Math.max(...rows.map((x) => x.log.hit))) } : null,
          };
          if (cpu === 1) med1 = res.lag[0];
          info(`K ${tag} ${name} Full score CPU×${cpu}: lag med/p90/max ${res.lag.join("/")} ms, handler ${res.handler.join("/")} ms, ahead ${res.ahead_ms} ms, DOM before the sound ${res.domBefore}/${res.n}, reads before ${res.readsBefore}/${res.n}${res.log ? `, peekLog lag ${res.log.lag}, nearHead ${res.log.hit} (max ${res.log.hitMax}) ms` : ""}`);
          if (tag === "this") {
            ok(res.n >= 15 && res.domBefore === 0 && res.readsBefore === 0 && res.ahead_ms <= 0.5, `K ${name} ×${cpu}: every press sounds before anything on screen (${JSON.stringify(res)})`);
            ok(res.lag[0] <= (cpu > 1 ? 25 : 8) && res.log && res.log.hit <= (cpu > 1 ? 6 : 2), `K ${name} ×${cpu}: lag med ${res.lag[0]} ms, nearHead ${res.log?.hit} ms`);
          }
        }
        // v86: back from the background (hidden, then shown: the context suspended and left so until
        // a gesture) — the first press resumes it and pays the wake-up once; the rest as fast as before
        if (tag === "this") {
          await page.evaluate(() => window.__hide(true));
          await sleep(300);
          await page.evaluate(() => window.__hide(false));
          await sleep(300);
          const back = await page.evaluate(() => window.resonateDebug().play.audio?.state);
          const hs = await page.evaluate(() => [...document.querySelectorAll("#stage g.note > g.notehead")].slice(5, 400).filter((_, i) => i % 10 === 0).slice(0, 12).map((h) => { const b = h.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }));
          const rows = [], f = fingers(cdp);
          for (const h of hs) {
            const m0 = await M(page);
            await f.down(1, h.x, h.y); await sleep(150); await f.up(1); await sleep(250);
            const p = await pressFacts(page, m0);
            if (p.lag != null) rows.push(p);
          }
          const first = rows[0], rest = rows.slice(1);
          const med = r1(q(rest.map((x) => x.lag), 0.5));
          info(`K ${name} after a return from the background: the context ${back} until a press; the first press ${r1(first?.lag)} ms (resumed in it), then lag med ${med} ms (before ${med1}), ${rest.map((x) => r1(x.lag)).join(" ")}`);
          ok(back === "suspended" && first?.log?.how === "hold" && first.lag < 300, `K ${name}: the first press after a return resumes and sounds (${r1(first?.lag)} ms; the context ${back} before it)`);
          ok(rest.length >= 6 && rest.every((x) => x.inDispatch && !x.writes.length && x.log?.how === "hold") && med <= Math.max(8, med1 * 1.5 + 1), `K ${name}: the presses after it as fast as before (med ${med} vs ${med1} ms, ${rest.length} in their pointerdowns)`);
        }
        // quick taps, one finger, 90 ms apart (every version handles those)
        {
          const hs = await page.evaluate(() => [...document.querySelectorAll("#stage g.note > g.notehead")].slice(10, 60).filter((_, i) => i % 4 === 0).map((h) => { const b = h.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }));
          const m0s = [], f = fingers(cdp);
          for (const h of hs) { m0s.push(await M(page)); await f.down(1, h.x, h.y); await sleep(40); await f.up(1); await sleep(50); }
          await sleep(300);
          const rows = [];
          for (const m0 of m0s) { const p = await pressFacts(page, m0); if (p.lag != null) rows.push(p); }
          info(`K ${tag} ${name} quick taps 90 ms apart: lag med/max ${r1(q(rows.map((x) => x.lag), 0.5))}/${r1(Math.max(...rows.map((x) => x.lag)))} ms over ${rows.length} (handler med ${r1(q(rows.map((x) => x.handler), 0.5))})`);
          await sleep(2500);
        }
        // a press while ▶ plays the page (heads lit every frame)
        {
          await page.click("#play");
          await page.waitForFunction(() => window.resonateDebug().play.playback.litEls.length > 0, null, { timeout: 10000 }).catch(() => {});
          const hs = await page.evaluate(() => [...document.querySelectorAll("#stage g.note > g.notehead")].slice(40, 200).filter((_, i) => i % 16 === 0).map((h) => { const b = h.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }));
          const rows = [];
          const f = fingers(cdp);
          for (const h of hs) {
            const m0 = await M(page);
            await f.down(1, h.x, h.y);
            await sleep(120);
            await f.up(1);
            await sleep(200);
            const p = await pressFacts(page, m0);
            if (p.lag != null) rows.push(p);
          }
          await page.click("#play").catch(() => {});
          info(`K ${tag} ${name} while ▶ plays: lag ${rows.map((x) => r1(x.lag)).join(" ")} ms (handler ${rows.map((x) => r1(x.handler)).join(" ")}); nearHead ${rows.map((x) => x.log?.hit).join(" ")} ms`);
          if (tag === "this") ok(rows.length >= 4 && rows.every((x) => !x.writes.length && x.inDispatch), `K ${name}: presses while ▶ plays sound before anything on screen (${rows.length})`);
        }
      }
      ok(!errors.length, `K ${tag} no errors: ${errors.join(" | ")}`);
      await ctx.close();
    }
  } else info("K skipped: no owner scores in", SCORES);

  console.log(`${passes} passed, ${fails} failed`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
