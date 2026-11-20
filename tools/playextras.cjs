// Play page extras: peek (names, sound, keyboard strip), the fading offer (practice days), the
// original PDF view (📄). Chromium with touch (CDP), an iOS-like audio gate, Playwright's clock.
// usage: node playextras.cjs   (BASE=http://localhost:8097/resonate/, SHOTS=<dir>,
//   PLAY_PDFS=<dir with a scanned (JBIG2) PDF, e.g. the owner's Songbird — never committed>)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { pdfmini } = require("./pdfmini.cjs");
const BASE = process.env.BASE || "http://localhost:8097/resonate/";
const SCRATCH = "/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad";
const SHOTS = process.env.SHOTS || path.join(SCRATCH, "playshots");
const PDFS = process.env.PLAY_PDFS ?? "/root/.claude/uploads/6042bc19-5f16-52ea-a295-8ea17a932323";
const FIX = path.join(__dirname, "fixtures/play");
fs.mkdirSync(SHOTS, { recursive: true });

let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) passes++; else { fails++; console.log("FAIL", msg); } };
const read = (f) => fs.readFileSync(f, "utf8");
const FIXT = Object.fromEntries(["synth-pvg", "synth-longest", "synth-voice"].map((n) => [n, read(path.join(FIX, n + ".musicxml"))]));

// iOS-like audio: the context Play makes (freshCtx) starts suspended and only starts from a
// resume() called in a touch end / click / key (one outside waits for the next); __block refuses
// every start. Records the session type when each context is made, and the piano's starts.
const GATE = () => {
  window.__session = "auto";
  Object.defineProperty(navigator, "audioSession", { value: { get type() { return window.__session; }, set type(v) { window.__session = v; } }, configurable: true });
  window.__gesture = false; window.__block = false; window.__ctx = []; window.__starts = [];
  for (const t of ["pointerup", "click", "touchend", "keydown"]) window.addEventListener(t, () => { window.__gesture = true; setTimeout(() => { window.__gesture = false; }, 0); }, true);
  const AC = window.AudioContext;
  window.AudioContext = class extends AC {
    constructor(...a) {
      super(...a);
      this.__gated = /freshCtx/.test(new Error().stack);
      if (!this.__gated) return;
      this.__id = window.__ctx.length;
      window.__ctx.push({ ctx: this, session: navigator.audioSession.type });
      this.__susp = true; this.__waiters = []; super.suspend();
    }
    get state() { const s = super.state; return this.__gated && this.__susp && s !== "closed" ? "suspended" : s; }
    resume() {
      if (!this.__gated || !this.__susp) return super.resume();
      if (window.__gesture && !window.__block) { this.__susp = false; const r = super.resume(); r.then(() => { this.dispatchEvent(new Event("statechange")); this.__waiters.splice(0).forEach((f) => f()); }); return r; }
      return new Promise((res) => this.__waiters.push(res));
    }
  };
  const S = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function () { if (this.context.__gated) window.__starts.push({ id: this.context.__id, running: this.context.state === "running", t: performance.now() }); return S.apply(this, arguments); };
};

async function newPage(browser, w, h, errors, { gate = false, clock = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  if (gate) await ctx.addInitScript(GATE);
  const page = await ctx.newPage();
  if (clock) await page.clock.install({ time: clock });
  page.on("pageerror", (e) => errors.push(`pageerror ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console ${m.text()}`); });
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp };
}
const dbg = (page) => page.evaluate(() => { const d = window.resonateDebug?.().play; if (!d) return null; const { facts, countAll, ...rest } = d; return rest; });
const waitReady = (page, song) => page.waitForFunction((s) => { const d = window.resonateDebug?.().play; return d && d.ready && (!s || d.song === s); }, song, { timeout: 60000 });
async function seed(page, list) {
  return page.evaluate(async (list) => {
    const L = await import("./library.js?v=76");
    const ids = {};
    for (const { name, xml, source, pdf } of list) ids[name] = await L.addSong(name, xml, { source, ...(pdf ? { pdf: new Uint8Array(pdf).buffer, pdfName: name + ".pdf" } : {}) });
    return ids;
  }, list);
}
async function openSong(page, id) {
  await page.evaluate((id) => localStorage.setItem("resonate.sing.song", id), id);
  await page.reload();
  await waitReady(page, id);
}
// Touch helpers (CDP): a hold, a drag.
const touch = (cdp, type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
// The centre of note ids' first head (client px).
const headAt = (page, id) => page.evaluate((id) => { const g = document.getElementById(id); if (!g) return null; const b = g.querySelector(":scope > g.notehead").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, id);
// A note id on the shown page matching a fact filter (part, staff, midi…; "right": in the right quarter).
const findNote = (page, want) => page.evaluate((want) => {
  const F = window.resonateDebug().play.facts;
  const st = document.getElementById("stage").getBoundingClientRect();
  for (const g of document.querySelectorAll("#stage .page g.note")) {
    const f = F[g.id], h = g.querySelector(":scope > g.notehead");
    if (!f || !h) continue;
    if (want.part && f.part !== want.part) continue;
    if (want.staff && f.staff !== want.staff) continue;
    if (want.midi && f.midi !== want.midi) continue;
    const b = h.getBoundingClientRect();
    if (want.right && b.left < st.left + st.width * 0.78) continue;
    if (want.low && b.bottom < st.bottom - document.getElementById("strip").offsetHeight - 12) continue;
    if (b.bottom > st.bottom - 130 && !want.low) continue; // (clear of the strip)
    return g.id;
  }
  return null;
}, want);
const visibleOf = (page, sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((n) => getComputedStyle(n).display !== "none").length, sel);
const peekState = (page) => page.evaluate(() => ({
  peek: window.resonateDebug().play.peek, log: window.resonateDebug().play.peekLog,
  bubble: document.getElementById("bubble").classList.contains("on") ? document.getElementById("bubble").textContent : null,
  strip: document.querySelectorAll("#strip rect.lit").length, // (v80: the keyboard is docked; a peek lights its keys)
  classes: document.querySelectorAll("#stage .peek").length,
}));

(async () => {
  const browser = await chromium.launch();

  // ---- A. peek on synth-pvg at 820×1180: names at Off, bubble, strip, sound, hide, swipe, turns
  {
    const errors = [];
    const { ctx, page, cdp } = await newPage(browser, 820, 1180, errors);
    await page.goto(BASE + "play.html");
    await waitReady(page, "amazing-grace");
    const ids = await seed(page, [{ name: "synth-pvg", xml: FIXT["synth-pvg"], source: "file" }]);
    await openSong(page, ids["synth-pvg"]);
    await page.click("#names"); await page.click("#names");
    ok((await dbg(page)).names === "off", "names Off");
    const chord = await page.evaluate(() => {
      const F = window.resonateDebug().play.facts;
      const want = [63, 67, 70];
      for (const c of document.querySelectorAll("#stage .page g.chord")) {
        const ns = [...c.querySelectorAll("g.note")].map((g) => F[g.id]).filter(Boolean);
        if (ns.length === 3 && ns.every((f) => f.part === "P2" && f.mi === 0 && f.staff === 1) && want.every((m) => ns.some((f) => f.midi === m))) return [...c.querySelectorAll("g.note")].map((g) => g.id);
      }
      return null;
    });
    ok(!!chord, `the designed chord E♭4 G4 B♭4 is on page 1 (${chord})`);
    const at = await headAt(page, chord[1]);
    await touch(cdp, "touchStart", at.x, at.y);
    await page.waitForTimeout(350);
    let p = await peekState(page);
    const shown = await page.evaluate(() => [...document.querySelectorAll("#stage .nn")].filter((n) => getComputedStyle(n).display !== "none").map((n) => n.parentNode.id));
    ok(shown.length === 3 && chord.every((id) => shown.includes(id)), `at Off only the chord's badges show (${shown})`);
    const fill = await page.evaluate((id) => getComputedStyle(document.querySelector(`#${id} > g.notehead use`)).fill, chord[0]);
    ok(/216, 107, 0/.test(fill), `heads orange (${fill})`);
    ok(p.bubble === "E♭4 G4 B♭4", `bubble "${p.bubble}"`);
    ok(p.strip && JSON.stringify(p.peek.lit.map((k) => k.midi).sort()) === "[63,67,70]" && p.peek.lit.every((k) => k.hand === "rh"), `strip lit 63/67/70 RH (${JSON.stringify(p.peek.lit)})`);
    ok(await page.evaluate(() => !!document.querySelector("#strip circle.mc")), "middle-C dot");
    const keys = await page.evaluate(() => [...document.querySelectorAll("#strip rect.key")].map((r) => Number(r.dataset.midi)));
    const lo = Math.min(...keys), hi = Math.max(...keys);
    ok(lo % 12 === 0 && hi % 12 === 11 && lo <= 48 && hi >= 83, `strip range whole octaves, ≥ C3–B5 (${lo}–${hi})`);
    ok(JSON.stringify(p.peek.sounding) === "[63,67,70]" && p.log.at(-1)?.how === "hold", `sounding while held ${JSON.stringify(p.peek.sounding)} (${JSON.stringify(p.log.at(-1))})`);
    ok(await page.evaluate(() => getComputedStyle(document.getElementById("strip")).pointerEvents === "auto" && getComputedStyle(document.getElementById("bubble")).pointerEvents === "none"), "the bubble takes no touches; the keyboard does (v86: pressable)");
    // bubble near the chord, inside the stage
    const bb = await page.evaluate(() => { const b = document.getElementById("bubble").getBoundingClientRect(), s = document.getElementById("stage").getBoundingClientRect(); return { b: [b.left, b.top, b.right, b.bottom], s: [s.left, s.top, s.right, s.bottom] }; });
    ok(bb.b[0] >= bb.s[0] && bb.b[2] <= bb.s[2] && bb.b[1] >= bb.s[1] && Math.abs((bb.b[1] + bb.b[3]) / 2 - at.y) < 120, `bubble by the chord (${bb.b.map(Math.round)})`);
    await page.screenshot({ path: path.join(SHOTS, "extras-peek-820-off.png") });
    await touch(cdp, "touchEnd");
    await page.waitForTimeout(150);
    p = await peekState(page);
    ok(p.bubble && p.strip && (await dbg(page)).page === 1, "lifted: still shown, no page turn");
    await page.waitForTimeout(2400);
    p = await peekState(page);
    ok(!p.peek && !p.bubble && !p.strip && p.classes === 0, `2 s after the lift all hidden (${JSON.stringify({ b: p.bubble, s: p.strip, c: p.classes })})`);
    ok((await visibleOf(page, "#stage .nn")) === 0, "Off again: no badges");

    // a press on a note in the right quarter never turns the page (held and lifted)
    await page.click("#names"); // → All
    const rid = await findNote(page, { right: true });
    if (rid) {
      const r = await headAt(page, rid);
      await touch(cdp, "touchStart", r.x, r.y); await page.waitForTimeout(250); await touch(cdp, "touchEnd");
      await page.waitForTimeout(80);
      ok((await dbg(page)).page === 1, "a peek in the right quarter doesn't turn");
      await touch(cdp, "touchStart", r.x, r.y); await page.waitForTimeout(40); await touch(cdp, "touchEnd");
      await page.waitForTimeout(80);
      ok((await dbg(page)).page === 1, "a quick tap on a right-quarter note doesn't turn");
    } else ok(false, "no right-quarter note");

    // a second peek within the 2 s replaces the first at once
    const a2 = await headAt(page, chord[0]);
    await touch(cdp, "touchStart", a2.x, a2.y); await page.waitForTimeout(120); await touch(cdp, "touchEnd");
    const other = await findNote(page, { staff: 2 });
    const o = await headAt(page, other);
    await touch(cdp, "touchStart", o.x, o.y); await page.waitForTimeout(200);
    p = await peekState(page);
    const ofact = await page.evaluate((id) => window.resonateDebug().play.facts[id], other);
    ok(p.peek && p.peek.ids.includes(other) && !p.peek.ids.includes(chord[0]) && p.peek.lit.every((k) => k.hand === "lh"), `a new peek replaces the old; LH note lit LH (${JSON.stringify(p.peek?.lit)} ${ofact.step}${ofact.oct})`);
    ok(await page.evaluate((id) => !document.getElementById(id).classList.contains("peek"), chord[0]), "the old chord's colour is gone");
    await touch(cdp, "touchEnd");
    await page.waitForTimeout(100);

    // a drag that starts on a note: the peek is cancelled (sound cut), no turn (v79: only ‹ › and keys)
    const n0 = (await dbg(page)).peekLog.length;
    const d0 = await headAt(page, chord[1]);
    await touch(cdp, "touchStart", d0.x, d0.y);
    await page.waitForTimeout(60);
    for (let i = 1; i <= 6; i++) { await touch(cdp, "touchMove", d0.x - 22 * i, d0.y + i); await page.waitForTimeout(14); }
    await touch(cdp, "touchEnd");
    await page.waitForTimeout(80);
    let d = await dbg(page);
    ok(d.page === 1 && !d.peek, `a drag from a note drops the peek, no turn (page ${d.page})`);
    ok(d.peekLog.length === n0 + 1 && d.peekLog.at(-1).cut === true, `its sound was cut (${JSON.stringify(d.peekLog.at(-1))})`);
    ok((await peekState(page)).classes === 0 && !(await peekState(page)).strip, "nothing left on screen");

    // any page turn clears a peek: hold a note, press a pedal key
    const hid = await findNote(page, {});
    const h = await headAt(page, hid);
    await touch(cdp, "touchStart", h.x, h.y);
    await page.waitForTimeout(200);
    ok(!!(await dbg(page)).peek, "holding a note");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(60);
    d = await dbg(page);
    p = await peekState(page);
    ok(d.page === 2 && !d.peek && !p.bubble && !p.strip, `a pedal turn clears it (page ${d.page})`);
    await touch(cdp, "touchEnd");
    await page.waitForTimeout(80);
    ok((await dbg(page)).page === 2, "the lift after that doesn't turn");
    // a chord low on the page: the keyboard stays docked under the music (v79's strip went to the
    // stage's head), the bubble on the music
    const low = await findNote(page, { low: true });
    if (low) {
      const l = await headAt(page, low);
      const dock0 = await page.evaluate(() => { const r = document.getElementById("dock").getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round).join(); });
      await touch(cdp, "touchStart", l.x, l.y); await page.waitForTimeout(250);
      const side = await page.evaluate(() => { const s = document.getElementById("dock").getBoundingClientRect(), t = document.getElementById("stage").getBoundingClientRect(), b = document.getElementById("bubble").getBoundingClientRect(); return { dock: [s.left, s.top, s.width, s.height].map(Math.round).join(), under: s.top >= t.bottom - 1, bubble: b.bottom <= t.bottom + 1 && b.top >= t.top - 1, lit: document.querySelectorAll("#strip rect.lit").length }; });
      ok(side.dock === dock0 && side.under && side.bubble && side.lit > 0, `low chord → the keyboard stays under the music, lit (${JSON.stringify(side)} vs ${dock0})`);
      await page.screenshot({ path: path.join(SHOTS, "extras-peek-820-low.png") });
      await touch(cdp, "touchEnd");
    }
    ok(!errors.length, `A: no errors: ${errors.join(" | ")}`);
    await ctx.close();
  }

  // ---- B. hands: the hymn (Amazing Grace) Both / LH / Melody, and bigger screens
  for (const [w, h] of [[1366, 1024], [390, 844]]) {
    const errors = [];
    const { ctx, page, cdp } = await newPage(browser, w, h, errors);
    await page.goto(BASE + "play.html");
    await waitReady(page, "amazing-grace");
    // (v80: the keyboard is off on a phone by default — turned on here, the hands' colours checked on it)
    const kb0 = (await dbg(page)).keys;
    ok(kb0.on === (w >= 700 && h >= 700), `${w}: the keyboard ${kb0.on ? "on" : "off"} by default`);
    if (!kb0.on) { await page.click("#keys"); await waitReady(page); }
    ok((await dbg(page)).keys.shown, `${w}: the keyboard on`);
    const hold = async (want, label) => {
      const id = await findNote(page, want);
      if (!id) { ok(false, `${w}: no note for ${label}`); return null; }
      const at = await headAt(page, id);
      await touch(cdp, "touchStart", at.x, at.y);
      await page.waitForTimeout(250);
      const p = await peekState(page);
      return { id, p, done: async () => { await touch(cdp, "touchEnd"); await page.waitForTimeout(60); } };
    };
    let r = await hold({ part: "P2" }, "AG bass");
    if (r) { ok(r.p.peek.lit.every((k) => k.hand === "lh"), `${w} hymn Both: bass part lit LH`); await r.done(); }
    if (w === 1366) await page.screenshot({ path: path.join(SHOTS, `extras-peek-${w}.png`) });
    r = await hold({ part: "P1" }, "AG treble");
    if (r) { ok(r.p.peek.lit.every((k) => k.hand === "rh"), `${w} hymn Both: treble part lit RH`); await r.done(); }
    await page.selectOption("#hands", "lh");
    await waitReady(page);
    r = await hold({}, "LH");
    if (r) { ok(r.p.peek.lit.every((k) => k.hand === "lh"), `${w} LH view: lit LH`); await r.done(); }
    await page.selectOption("#hands", "melody");
    await waitReady(page);
    r = await hold({}, "melody");
    if (r) {
      ok(r.p.peek.lit.every((k) => k.hand === "rh") && r.p.peek.lit.length === 1, `${w} Melody: one key, RH (${JSON.stringify(r.p.peek.lit)})`);
      if (w === 390) await page.screenshot({ path: path.join(SHOTS, `extras-peek-${w}-melody.png`) });
      await r.done();
    }
    const sw = await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth);
    ok(sw, `${w}: no horizontal overflow`);
    await page.selectOption("#hands", "both");
    await waitReady(page);
    ok(!errors.length, `B ${w}: no errors: ${errors.join(" | ")}`);
    await ctx.close();
  }

  // ---- C. iOS-like audio: the press can't start the sound; the lift can
  {
    const errors = [];
    const { ctx, page, cdp } = await newPage(browser, 820, 1180, errors, { gate: true });
    await page.goto(BASE + "play.html");
    await waitReady(page, "amazing-grace");
    await page.waitForTimeout(300);
    // C1: the very first touch is a 1.2 s hold on a note
    let id = await findNote(page, { part: "P1" });
    let at = await headAt(page, id);
    await touch(cdp, "touchStart", at.x, at.y);
    await page.waitForTimeout(1200);
    let r = await page.evaluate(() => ({ ctx: window.__ctx.map((c) => ({ s: c.session, st: c.ctx.state })), starts: window.__starts.length, session: navigator.audioSession.type, d: window.resonateDebug().play }));
    // (v80: the context is made, and the piano decoded on it, once the song shows — the session left
    // alone until a press; v79 made it in the press, after setting "playback")
    ok(r.ctx.length === 1 && r.session === "playback", `one context; the press set "playback" (${JSON.stringify(r.ctx)}, ${r.session})`);
    ok(r.starts === 0 && JSON.stringify(r.d.peek.sounding) === "[]", "no sound while the context can't start");
    await touch(cdp, "touchEnd");
    await page.waitForTimeout(400);
    r = await page.evaluate(() => ({ ctx: window.__ctx.map((c) => c.ctx.state), starts: window.__starts, log: window.resonateDebug().play.peekLog }));
    ok(r.log.length === 1 && r.log[0].how === "lift" && r.starts.length > 0 && r.starts.every((s) => s.running), `at the lift the chord plays (${JSON.stringify(r.log)}, ${r.starts.length} starts on a running context)`);
    // C2: now running: the next press sounds at once and holds
    await page.waitForTimeout(2200);
    id = await findNote(page, { part: "P2" });
    at = await headAt(page, id);
    await touch(cdp, "touchStart", at.x, at.y);
    await page.waitForTimeout(250);
    r = await page.evaluate(() => ({ n: window.__ctx.length, log: window.resonateDebug().play.peekLog, sounding: window.resonateDebug().play.peek?.sounding }));
    ok(r.n === 1 && r.log.at(-1).how === "hold" && r.sounding.length >= 1, `second press: sounds at the press, same context (${JSON.stringify(r)})`);
    await touch(cdp, "touchEnd");
    await page.waitForTimeout(300);
    // C3: an iOS-"interrupted" context is replaced in the next press, and plays at the lift
    await page.evaluate(() => { const c = window.__ctx.at(-1).ctx; Object.defineProperty(c, "state", { get: () => "interrupted", configurable: true }); });
    await touch(cdp, "touchStart", at.x, at.y); await page.waitForTimeout(200); await touch(cdp, "touchEnd");
    await page.waitForTimeout(500);
    r = await page.evaluate(() => ({ ctx: window.__ctx.map((c) => c.session), log: window.resonateDebug().play.peekLog }));
    ok(r.ctx.length === 2 && r.ctx[1] === "playback" && r.log.at(-1).how === "lift", `interrupted → a new context in the press, played at the lift (${JSON.stringify(r)})`);
    // C4: a lift whose context never starts: dropped, not played late; the next press starts over
    await page.waitForTimeout(2200);
    await page.evaluate(() => { const c = window.__ctx.at(-1).ctx; Object.defineProperty(c, "state", { get: () => "suspended", configurable: true }); c.resume = () => new Promise(() => {}); window.__block = true; });
    const n0 = (await dbg(page)).peekLog.length;
    await touch(cdp, "touchStart", at.x, at.y); await page.waitForTimeout(150); await touch(cdp, "touchEnd");
    await page.waitForTimeout(2300);
    r = await dbg(page);
    ok(r.peekLog.length === n0 && r.audio.stuck === true, `a lift that never starts: nothing plays late, the context is marked stuck (${r.peekLog.length - n0}, stuck ${r.audio.stuck})`);
    await page.evaluate(() => { window.__block = false; });
    await touch(cdp, "touchStart", at.x, at.y); await page.waitForTimeout(150); await touch(cdp, "touchEnd");
    await page.waitForTimeout(500);
    r = await page.evaluate(() => ({ n: window.__ctx.length, log: window.resonateDebug().play.peekLog }));
    ok(r.n === 3 && r.log.length === n0 + 1, `the next press makes a new context and sounds (${r.n} contexts)`);
    // C5: the first tap anywhere starts the audio (a fresh page): a tap on paper (no turn), then a press sounds at once
    await page.reload();
    await waitReady(page, "amazing-grace");
    const spot = await page.evaluate(() => {
      const st = document.getElementById("stage").getBoundingClientRect();
      const heads = [...document.querySelectorAll("#stage g.note > g.notehead")].map((h) => { const b = h.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
      const x = st.left + st.width * 0.9;
      for (let y = st.top + 20; y < st.bottom - 20; y += 7) if (heads.every(([hx, hy]) => Math.hypot(hx - x, hy - y) >= 40)) return { x, y };
      return null;
    });
    await page.touchscreen.tap(spot.x, spot.y);
    await page.waitForTimeout(600);
    r = await page.evaluate(() => ({ ctx: window.__ctx.map((c) => ({ s: c.session, st: c.ctx.state })), page: window.resonateDebug().play.page, session: navigator.audioSession.type }));
    ok(r.page === 1 && r.ctx.length === 1 && r.ctx[0].st === "running" && r.session === "auto", `the first tap (on paper, no turn) starts the audio without taking the session (${JSON.stringify(r)})`);
    id = await findNote(page, {});
    at = await headAt(page, id);
    await touch(cdp, "touchStart", at.x, at.y); await page.waitForTimeout(250);
    r = await page.evaluate(() => ({ n: window.__ctx.length, log: window.resonateDebug().play.peekLog, session: navigator.audioSession.type }));
    ok(r.n === 1 && r.log.at(-1)?.how === "hold" && r.session === "playback", `then a press sounds at once, session "playback" (${JSON.stringify(r)})`);
    await touch(cdp, "touchEnd");
    // pagehide: the context closed, the session back to "auto"
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
    r = await page.evaluate(() => ({ st: window.__ctx[0].ctx.state, session: navigator.audioSession.type, audio: window.resonateDebug().play.audio }));
    ok(r.st === "closed" && r.session === "auto" && r.audio === null, `pagehide: context closed, session auto (${JSON.stringify(r)})`);
    ok(!errors.length, `C: no errors: ${errors.join(" | ")}`);
    await ctx.close();
  }

  // ---- D. fading: practice days (Playwright clock), the offer chip
  {
    const errors = [];
    const { ctx, page, cdp } = await newPage(browser, 820, 1180, errors, { clock: new Date("2026-11-16T09:00:00") });
    await page.goto(BASE + "play.html");
    await waitReady(page, "amazing-grace");
    const ids = await seed(page, [{ name: "synth-pvg", xml: FIXT["synth-pvg"], source: "file" }]);
    const S = ids["synth-pvg"];
    await page.evaluate(() => localStorage.setItem("resonate.play.zoom", "+4")); // (pages to turn on each day)
    await openSong(page, S);
    const stored = () => page.evaluate((id) => (JSON.parse(localStorage.getItem("resonate.play") || "{}")[id] || {}).days || null, S);
    const live = async () => (await dbg(page)).offer;
    // day 1: 4 min, no turn → nothing; a turn, 1.5 min more → a day
    await page.clock.runFor(4 * 60e3);
    let o = await live();
    ok(o.days && o.days.n === 0 && !o.days.act && o.days.ms >= 235e3, `day 1, 4 min, no turn: no day yet (${JSON.stringify(o.days)})`);
    await page.keyboard.press("ArrowRight");
    await page.clock.runFor(60e3);
    ok((await live()).days.n === 0, "5 min not reached");
    await page.clock.runFor(45e3);
    o = await live();
    let st = await stored();
    ok(o.days.n === 1 && o.days.done && st && st.n === 1, `≥ 5 min + a turn: day 1 counted and stored (${JSON.stringify(st)})`);
    await page.clock.runFor(10 * 60e3);
    ok((await live()).days.n === 1, "one day per calendar day");
    // hidden time doesn't count
    await page.clock.setSystemTime(new Date("2026-11-17T09:00:00"));
    await page.clock.runFor(16e3);
    const ms0 = (await live()).days.ms;
    ok((await live()).days.d === "2026-11-17" && ms0 > 0 && ms0 <= 15e3, `a new day starts its own time (${ms0})`);
    await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
    await page.clock.runFor(8 * 60e3);
    o = await live();
    ok(o.days.ms === ms0, `hidden: no time counted (${JSON.stringify(o.days)})`);
    await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
    // day 2: 6 min, then a peek → counted at the peek
    await page.clock.runFor(6 * 60e3);
    ok((await live()).days.n === 1, "day 2: time alone isn't a day");
    const nid = await findNote(page, {});
    const at = await headAt(page, nid);
    await touch(cdp, "touchStart", at.x, at.y); await page.clock.runFor(150); await touch(cdp, "touchEnd");
    await page.clock.runFor(31e3);
    st = await stored();
    ok(st.n === 2 && st.d === "2026-11-17", `a peek makes day 2 (${JSON.stringify(st)})`);
    // day 3 → the chip on the next open
    await page.clock.setSystemTime(new Date("2026-11-18T20:00:00"));
    await page.keyboard.press("ArrowRight");
    await page.clock.runFor(5.5 * 60e3);
    st = await stored();
    ok(st.n === 3 && (await page.isHidden("#offer")), `day 3 counted (${st.n}); no chip mid-session`);
    await page.reload();
    await waitReady(page, S);
    o = await live();
    ok(o.shown && o.to === "some" && (await page.textContent("#offer")).replace(/\s+/g, " ").trim() === "Fewer names?Some✕", `chip "Fewer names? [Some] ✕" (${await page.textContent("#offer")})`);
    const inView = await page.evaluate(() => [...document.querySelectorAll("#offer, #offer button")].every((e) => { const b = e.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth && b.height > 0; }));
    ok(inView, "chip inside the viewport");
    await page.screenshot({ path: path.join(SHOTS, "extras-offer-820.png"), clip: { x: 0, y: 0, width: 820, height: 200 } });
    await page.click("#offer-yes");
    o = await live();
    st = await stored();
    ok(o.days.n === 0 && !o.shown && (await dbg(page)).names === "some" && st.n === 0 && st.ask === 3, `[Some]: level Some, count reset (${JSON.stringify(st)})`);
    ok((await page.evaluate(() => localStorage.getItem("resonate.play.names"))) === "some", "device's last level = some");
    // seeded again at Some → [Off]; ✕ → ask again after 3 more days
    // (seeded from another page of the site: Play saves its own record on pagehide)
    const seedDays = async (days) => {
      await page.goto(BASE + "tools.html");
      await page.evaluate(({ id, days }) => { const all = JSON.parse(localStorage.getItem("resonate.play") || "{}"); all[id] = { ...(all[id] || {}), days }; localStorage.setItem("resonate.play", JSON.stringify(all)); }, { id: S, days });
      await page.goto(BASE + "play.html");
    };
    await seedDays({ n: 3, ask: 3 });
    await page.reload();
    await waitReady(page, S);
    o = await live();
    ok(o.shown && o.to === "off" && (await page.textContent("#offer-yes")) === "Off", "at Some the chip offers Off");
    await page.click("#offer-no");
    st = await stored();
    ok(!(await live()).shown && st.ask === 6 && st.n === 3, `✕ → ask at 6 (${JSON.stringify(st)})`);
    await page.reload();
    await waitReady(page, S);
    ok(!(await live()).shown && (await dbg(page)).names === "some", "after a reload: no chip, still Some");
    // the level by hand resets the count; no chip at Off
    await seedDays({ n: 5, ask: 3 });
    await page.reload();
    await waitReady(page, S);
    ok((await live()).shown, "chip at n 5");
    await page.click("#names"); // some → off
    st = await stored();
    ok(st.n === 0 && st.ask === 3 && !(await live()).shown, `a level by hand: count reset, chip gone (${JSON.stringify(st)})`);
    await seedDays({ n: 9, ask: 3 });
    await page.reload();
    await waitReady(page, S);
    ok(!(await live()).shown, "no chip at Off");
    // a new song starts at the level chosen last; the chip goes with the song
    await page.click("#names"); // off → all
    await seedDays({ n: 3, ask: 3 });
    await page.reload();
    await waitReady(page, S);
    ok((await live()).shown, "chip shown");
    await page.selectOption("#song", "amazing-grace");
    await waitReady(page, "amazing-grace");
    ok(!(await live()).shown && (await dbg(page)).names === "all", "another song: chip gone; it opens at the last level (all)");
    // the chip in a phone's bar
    await page.selectOption("#song", S);
    await waitReady(page, S);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.runFor(600);
    await waitReady(page, S);
    const lay = await page.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, iw: innerWidth, out: [...document.querySelectorAll("#offer span, #offer button")].filter((e) => { const b = e.getBoundingClientRect(); return b.left < 0 || b.right > innerWidth; }).length, bar: Math.round(document.getElementById("bar").getBoundingClientRect().height) }));
    ok(lay.sw <= lay.iw && lay.out === 0, `390: chip fits (bar ${lay.bar}px)`);
    await page.screenshot({ path: path.join(SHOTS, "extras-offer-390.png"), clip: { x: 0, y: 0, width: 390, height: 260 } });
    ok(!errors.length, `D: no errors: ${errors.join(" | ")}`);
    await ctx.close();
  }

  // ---- E. the PDF view
  {
    const errors = [];
    const { ctx, page, cdp } = await newPage(browser, 820, 1180, errors);
    await page.goto(BASE + "play.html");
    await waitReady(page, "amazing-grace");
    ok(await page.isHidden("#pdf"), "sample: no 📄");
    const mini = [...pdfmini(3)];
    const ids = await seed(page, [
      { name: "synth-pvg", xml: FIXT["synth-pvg"], source: "pdf", pdf: mini },
      { name: "synth-longest", xml: FIXT["synth-longest"], source: "file" },
      { name: "synth-voice", xml: FIXT["synth-voice"], source: "pdf" }, // (its PDF isn't here)
    ]);
    await openSong(page, ids["synth-longest"]);
    ok(await page.isHidden("#pdf"), "a song from a file: no 📄");
    await page.selectOption("#song", ids["synth-voice"]);
    await waitReady(page, ids["synth-voice"]);
    await page.waitForTimeout(200);
    ok(await page.isHidden("#pdf"), "a PDF song whose PDF isn't on this device: no 📄");
    await page.selectOption("#song", ids["synth-pvg"]);
    await waitReady(page, ids["synth-pvg"]);
    await page.waitForSelector("#pdf:not([hidden])");
    ok(true, "📄 shown");
    await page.keyboard.press("ArrowRight");
    let d = await dbg(page);
    const at = d.at, sheetPage = d.page;
    const pdfReady = (pg) => page.waitForFunction((pg) => { const p = window.resonateDebug().play.pdf; return p.on && !p.busy && p.canvas && p.canvas[0] > 0 && (!pg || p.page === pg); }, pg, { timeout: 30000 });
    const ink = () => page.evaluate(() => { const c = document.getElementById("pdfview"); const x = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < x.length; i += 4 * 7) if (x[i] < 128) n++; return n / (x.length / 28); });
    await page.click("#pdf");
    await pdfReady(1);
    // (the canvas's first draw may still be going)
    await page.waitForTimeout(300);
    d = await dbg(page);
    const cv = await page.evaluate(() => { const c = document.getElementById("pdfview"), s = document.getElementById("stage").getBoundingClientRect(), b = c.getBoundingClientRect(); return { w: c.width, h: c.height, css: [b.width, b.height], fits: b.left >= s.left - 0.5 && b.right <= s.right + 0.5 && b.top >= s.top - 0.5 && b.bottom <= s.bottom + 0.5 }; });
    ok(cv.w > 0 && cv.h > 0 && cv.fits, `canvas ${cv.w}×${cv.h}, fits the stage (${cv.css.map(Math.round)})`);
    ok((await ink()) > 0.003, `PDF page drawn (ink ${(await ink()).toFixed(4)})`);
    ok((await page.textContent("#pg")).trim() === "1 / 3" && (await page.getAttribute("#pdf", "aria-pressed")) === "true", `pager "${await page.textContent("#pg")}"`);
    ok(await page.evaluate(() => ["names", "smaller", "bigger", "hands"].every((id) => document.getElementById(id).disabled)), "names, size and hands disabled");
    ok(await page.evaluate(() => getComputedStyle(document.querySelector("#stage .page")).visibility === "hidden"), "the sheet hidden underneath");
    await page.screenshot({ path: path.join(SHOTS, "extras-pdf-820.png") });
    await page.keyboard.press("ArrowRight");
    await pdfReady(2);
    ok((await page.textContent("#pg")).trim() === "2 / 3", "ArrowRight → PDF page 2");
    // ‹ › and keys turn, a tap or a swipe doesn't (v79); a press where a sheet note lies under the
    // PDF doesn't peek
    const tapX = async (fx) => { const s = await page.evaluate(() => { const r = document.getElementById("stage").getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }); await page.touchscreen.tap(s[0] + s[2] * fx, s[1] + s[3] * 0.5); await page.waitForTimeout(150); };
    await tapX(0.92);
    ok((await dbg(page)).pdf.page === 2, "a tap at the right: no turn");
    await page.click("#next");
    await pdfReady(3);
    ok((await dbg(page)).pdf.page === 3, "› → 3");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(150);
    ok((await dbg(page)).pdf.page === 3, "no wrap at the end");
    await touch(cdp, "touchStart", 300, 600);
    for (let i = 1; i <= 6; i++) { await touch(cdp, "touchMove", 300 + 22 * i, 600); await page.waitForTimeout(16); }
    await touch(cdp, "touchEnd");
    await page.waitForTimeout(150);
    ok((await dbg(page)).pdf.page === 3, "a swipe right: no turn");
    await page.click("#prev");
    await pdfReady(2);
    await page.click("#prev");
    await pdfReady(1);
    ok(await page.isDisabled("#prev"), "‹ → 1, disabled");
    const sheetHead = await page.evaluate(() => { const h = document.querySelector("#stage .page g.note > g.notehead"); if (!h) return null; const b = h.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    if (sheetHead) {
      await touch(cdp, "touchStart", sheetHead.x, sheetHead.y); await page.waitForTimeout(150);
      ok(!(await dbg(page)).peek, "no peek through the PDF");
      await touch(cdp, "touchEnd");
    }
    await page.keyboard.press("ArrowRight");
    await pdfReady(2);
    // back to the sheet: same page, same bar; the canvas emptied and gone
    const canvasHandle = await page.$("#pdfview");
    await page.click("#pdf");
    d = await dbg(page);
    const cw = await canvasHandle.evaluate((c) => [c.width, c.height, c.isConnected]);
    ok(!d.pdf.on && d.page === sheetPage && d.at === at && cw[0] === 0 && cw[1] === 0 && !cw[2], `📄 back: sheet page ${d.page}, m${d.at}; canvas ${cw}`);
    ok(await page.evaluate((at) => { const g = document.querySelector(`#stage .page g#m${at}`); return !!g && getComputedStyle(g.closest(".page")).visibility === "visible"; }, at), "the sheet's bar is visible again");
    ok(await page.evaluate(() => !document.getElementById("names").disabled && !document.getElementById("hands").disabled), "controls back");
    ok((await page.textContent("#pg")).trim() === `${sheetPage} / ${d.pages}`, "sheet pager back");
    // the PDF page is remembered per song
    await page.waitForTimeout(1100);
    await page.reload();
    await waitReady(page, ids["synth-pvg"]);
    await page.waitForSelector("#pdf:not([hidden])");
    await page.click("#pdf");
    await pdfReady();
    ok((await dbg(page)).pdf.page === 2, `PDF page remembered (${(await dbg(page)).pdf.page})`);
    // rotation in the PDF view: drawn again for the new stage; landscape 1180 → two pages side by
    // side (a Letter page is limited by the height there: each is as big as one alone would be)
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.waitForTimeout(500);
    await pdfReady();
    let r = await page.evaluate(() => { const c = document.getElementById("pdfview").getBoundingClientRect(), s = document.getElementById("stage").getBoundingClientRect(); return { c: [c.width, c.height], s: [s.width, s.height], pdf: window.resonateDebug().play.pdf, pg: document.getElementById("pg").textContent }; });
    ok(r.pdf.spread && r.c[1] <= r.s[1] + 0.5 && r.c[0] <= r.s[0] && r.c[0] > 0.9 * r.s[0] && r.pg === "1–2 / 3", `1180×820: two pages fitted (${r.c.map(Math.round)} in ${r.s.map(Math.round)}, ${r.pg})`);
    await page.setViewportSize({ width: 1366, height: 1024 });
    await page.waitForTimeout(500);
    await pdfReady();
    r = await page.evaluate(() => ({ pdf: window.resonateDebug().play.pdf, pg: document.getElementById("pg").textContent }));
    ok(r.pdf.spread && r.pdf.page === 1 && r.pg === "1–2 / 3", `1366×1024: a spread, odd page left (${r.pg})`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, "extras-pdf-1366-spread.png") });
    const halves = await page.evaluate(() => { const c = document.getElementById("pdfview"); const x = c.getContext("2d"); const f = (x0) => { const d = x.getImageData(x0, 0, c.width / 2, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 28) if (d[i] < 128) n++; return n; }; return [f(0), f(c.width / 2)]; });
    ok(halves[0] > 0 && halves[1] > 0, `both pages of the spread drawn (${halves})`);
    await page.keyboard.press("ArrowRight");
    await pdfReady(3);
    ok((await page.textContent("#pg")).trim() === "3 / 3", "spread turns by two");
    // a song whose sheet can't be drawn still shows its PDF
    const bad = await page.evaluate(async (pdf) => { const L = await import("./library.js?v=76"); return L.addSong("Broken", "<score-partwise><broken", { source: "pdf", pdf: new Uint8Array(pdf).buffer }); }, mini);
    await page.evaluate(async () => { const m = await import("./catalog.js?v=76"); window.dispatchEvent(new CustomEvent("resonate:remote", { detail: { songs: true } })); });
    await page.waitForTimeout(300);
    await page.selectOption("#song", bad);
    await page.waitForFunction(() => window.resonateDebug().play.failed === "song");
    await page.waitForSelector("#pdf:not([hidden])");
    await page.click("#pdf");
    await pdfReady();
    ok((await page.textContent("#pg")).trim() === "1–2 / 3", `broken sheet: the PDF still opens (${await page.textContent("#pg")})`);
    await page.click("#pdf");
    ok((await page.textContent("#pg")).trim() === "" && (await page.textContent("#msg")) === "Couldn't open this song." && (await page.isDisabled("#next")), "back: the song's message, no pager");
    // another song closes the PDF view
    await page.selectOption("#song", "amazing-grace");
    await waitReady(page, "amazing-grace");
    d = await dbg(page);
    ok(!d.pdf.on && !d.pdf.canvas && (await page.isHidden("#pdf")), "another song: PDF view closed, no 📄");
    ok(!errors.filter((e) => !/Not valid XML|partwise|song /.test(e)).length, `E: no errors: ${errors.join(" | ")}`);
    await ctx.close();
  }

  // ---- F. a scanned (JBIG2) PDF renders (pdf.js's wasm decoders) — the owner's file, local only
  {
    const scan = fs.existsSync(PDFS) ? fs.readdirSync(PDFS).find((f) => /Songbird.*\.pdf$/i.test(f)) : null;
    if (scan) {
      const errors = [];
      const { ctx, page } = await newPage(browser, 820, 1180, errors);
      await page.goto(BASE + "play.html");
      await waitReady(page, "amazing-grace");
      const ids = await seed(page, [{ name: "scan", xml: FIXT["synth-pvg"], source: "pdf", pdf: [...fs.readFileSync(path.join(PDFS, scan))] }]);
      await openSong(page, ids.scan);
      await page.waitForSelector("#pdf:not([hidden])");
      await page.click("#pdf");
      await page.waitForFunction(() => { const p = window.resonateDebug().play.pdf; return p.on && !p.busy && p.canvas; }, null, { timeout: 60000 });
      await page.waitForFunction(() => window.resonateDebug().play.t.pdf > 0, null, { timeout: 60000 });
      const n = await page.evaluate(() => { const c = document.getElementById("pdfview"); const x = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let k = 0; for (let i = 0; i < x.length; i += 28) if (x[i] < 128) k++; return k / (x.length / 28); });
      const d = await dbg(page);
      ok(n > 0.01, `scanned PDF page drawn (ink ${(n * 100).toFixed(1)}%, ${d.pdf.pages} pages, ${d.t.pdf} ms)`);
      await page.screenshot({ path: path.join(SHOTS, "extras-pdf-scan.png") });
      ok(!errors.length, `F: no errors: ${errors.join(" | ")}`);
      await ctx.close();
    } else console.log("(no scanned PDF: F skipped)");
  }

  console.log(`${passes} passed, ${fails} failed`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
