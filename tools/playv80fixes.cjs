// Play (v80): one check per confirmed finding of the v80 review round (presses, the docked keyboard,
// what ▶ plays).
//
//   P  a key another finger still holds keeps sounding when a second strike on it lifts: a bass chord
//      held + the treble's C4 tapped; the same chord struck by two fingers, the later lifted first;
//      the voice's F♯4 tapped under Killing's held piano chord (Full score) — and nothing left
//      sounding once every finger is up
//   N  no keyboard where 🎹 can't be: an iPad's Slide Over (320 wide), a ⅓ Split View, a 340-px
//      desktop window — hidden, default or pref "on"; back with the room (375 wide, 🎹 shown and
//      enabled); a phone in landscape with the pref on: hidden, 🎹 disabled, the music the size it is
//      with the keyboard off; portrait again: shown
//   R  the PDF drawn once a visit with the keyboard on (and off); a rotation in the PDF view draws again
//   L  a song switch and a view switch keep the dock's chips and keys until the new view shows: every
//      frame's dock is the old one or the new one (no chips gone, no C3–B5 placeholder)
//   K  the chips leave the keys ≥ 8 px a white key, else they go in the stretch's controls: a phone
//      with 🎹 on (Piano Man's Full score: the controls; Killing's at 430: the dock), an iPad (the dock),
//      a Split View; ▶ on the phone shows them in the controls and a tap there mutes
//   B  the view menu's whole name on every iPad with 📄 (an iPad mini in portrait showed "Full…"),
//      the bar as tall as without 📄
//   H  a chip tapped just before a muted part's note: that note silent (an analyser on its gain), not
//      in the log, the heard twin on the same key struck (Killing's Full score: Voice, then Piano)
//   M  pressing a note on page after page and turning keeps no page in memory (DOM nodes after GC)
//
// usage: node playv80fixes.cjs   (BASE=http://localhost:8097/resonate/, PLAY_SCORES=<the owner's
//   converted .musicxml — never copied into the repo>, ONLY=P,N,…)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { pdfmini } = require("./pdfmini.cjs");
const BASE = process.env.BASE || "http://localhost:8097/resonate/";
const SCRATCH = "/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad";
const SCORES = process.env.PLAY_SCORES ?? path.join(SCRATCH, "play/scores");
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const run = (s) => !ONLY || ONLY.has(s);
let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) passes++; else { fails++; console.log("FAIL", msg); } };
const info = (...a) => console.log("  ", ...a);
const sleep = (t) => new Promise((r) => setTimeout(r, t));
const read = (f) => fs.readFileSync(f, "utf8");
const OWNER = (n) => path.join(SCORES, n + ".musicxml");
const HAVE = (n) => !!SCORES && fs.existsSync(OWNER(n));

// Piano 4/4, whole notes: bar 1 staff 1 C4 | staff 2 the chord E3+C4; bar 2 G4 | C3.
const SHARED = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><work><work-title>Shared key</work-title></work>
<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">
<measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
<backup><duration>4</duration></backup>
<note><pitch><step>E</step><octave>3</octave></pitch><duration>4</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
<note><chord/><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
</measure>
<measure number="2">
<note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
<backup><duration>4</duration></backup>
<note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
</measure>
</part></score-partwise>`;

function INIT() {
  window.__session = "auto";
  try { Object.defineProperty(navigator, "audioSession", { configurable: true, value: { get type() { return window.__session; }, set type(v) { window.__session = v; } } }); } catch {}
  window.__key = (key) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  // every held tone (the oscillators holdPiano adds): midi, start, stop (context time)
  const O = (window.__osc = []);
  const S0 = OscillatorNode.prototype.start, P0 = OscillatorNode.prototype.stop;
  OscillatorNode.prototype.start = function (when = 0) { const f = this.frequency.value; this.__r = { midi: Math.round(69 + 12 * Math.log2(f / 440)), start: when, stop: Infinity, ctx: this.context }; O.push(this.__r); return S0.call(this, when); };
  OscillatorNode.prototype.stop = function (when = 0) { if (this.__r) this.__r.stop = Math.min(this.__r.stop, Math.max(when, this.context.currentTime)); return P0.call(this, when); };
  window.__oscAt = (ctx, t) => window.__osc.filter((o) => o.ctx === ctx && o.start <= t && o.stop > t).map((o) => o.midi).sort((a, b) => a - b);
  // every buffer source: when it starts, every stop, the gain it feeds; every automation on a gain
  window.__src = [];
  const S = AudioBufferSourceNode.prototype.start, P = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.start = function (when = 0, ...a) { this.__rec = { when, rate: this.playbackRate.value, buf: this.buffer, stops: [], node: this, ctx: this.context }; window.__src.push(this.__rec); return S.call(this, when, ...a); };
  AudioBufferSourceNode.prototype.stop = function (when = 0) { this.__rec?.stops.push(when); return P.call(this, when); };
  const C = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...a) { if (this instanceof AudioBufferSourceNode && dest instanceof GainNode) this.__gain = dest; return C.call(this, dest, ...a); };
  for (const name of ["setValueAtTime", "setTargetAtTime", "cancelScheduledValues"]) {
    const f = AudioParam.prototype[name];
    AudioParam.prototype[name] = function (...a) { (this.__calls ||= []).push([name, ...a]); return f.apply(this, a); };
  }
  // the PDF canvas's drawings: each width set (a drawing starts by setting it)
  window.__pdfDraws = [];
  const wd = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width");
  Object.defineProperty(HTMLCanvasElement.prototype, "width", { configurable: true, get: wd.get, set(v) { if (this.id === "pdfview" && v > 0) window.__pdfDraws.push(performance.now()); return wd.set.call(this, v); } });
  // the dock every frame (L): its chips, keys and drawing
  window.__dockSeq = null;
  const snap = () => {
    const seq = window.__dockSeq;
    if (seq) {
      const hear = document.getElementById("hear"), svg = document.querySelector("#strip svg"), dock = document.getElementById("dock");
      const s = `${dock.hidden ? "hidden" : "shown"} chips:${hear.hidden || !hear.offsetParent ? "-" : [...hear.children].map((b) => b.textContent).join("/")} keys:${document.querySelectorAll("#strip rect.key").length} vb:${svg?.getAttribute("viewBox")}`;
      if (seq.at(-1) !== s) seq.push(s);
    }
    requestAnimationFrame(snap);
  };
  requestAnimationFrame(snap);
}
const D = (page) => page.evaluate(() => { const d = window.resonateDebug?.().play; if (!d) return null; const { facts, countAll, playback, ...rest } = d; return rest; });
const HEAR = (page) => page.evaluate(() => window.resonateDebug().play.playback.hear);
const ready = (page, song, view) => page.waitForFunction(([s, v]) => { const d = window.resonateDebug?.().play; return d && d.ready && (!s || d.song === s) && (!v || d.view === v); }, [song, view], { timeout: 120000 });
const until = async (page, fn, arg, ms = 20000) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
async function newPage(browser, w, h, errors, { touch = true, before = null, screen = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(screen ? { screen } : {}), hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  await ctx.addInitScript(INIT);
  if (before) await ctx.addInitScript(before);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror " + e.message));
  page.on("console", (m) => { const t = m.text(); if (m.type() === "error") errors.push("console.error " + t.slice(0, 200)); else if (m.type() === "warning" && /^(song|music engine|loadData|pdf|piano|play)\b/.test(t)) errors.push("console.warn " + t.slice(0, 200)); });
  await page.goto(BASE + "play.html");
  await ready(page);
  return { ctx, page };
}
async function seed(page, list) {
  const ids = await page.evaluate(async (list) => {
    const L = await import(performance.getEntriesByType("resource").map((e) => e.name).find((n) => n.includes("/library.js?")) || "./library.js");
    const ids = {};
    for (const s of list) {
      ids[s.name] = await L.addSong(s.name, s.xml, { source: s.pdf ? "pdf" : "file" });
      if (s.pdf) await L.putPdf(ids[s.name], Uint8Array.from(atob(s.pdf), (c) => c.charCodeAt(0)).buffer, s.name + ".pdf");
    }
    return ids;
  }, list);
  await page.reload();
  await ready(page);
  return ids;
}
async function openSong(page, id, view) {
  if ((await D(page)).song !== id) { await page.selectOption("#song", id); await ready(page, id); }
  if (view && (await D(page)).view !== view) { await page.selectOption("#hands", view); await ready(page, id, view); }
}
// CDP fingers: down / up by id (every finger down is in each touch event)
function fingers(cdp) {
  const on = new Map();
  const send = (type) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: [...on].map(([id, [x, y]]) => ({ x, y, id })) });
  return {
    down: (id, x, y) => { on.set(id, [x, y]); return send("touchStart"); },
    up: (id) => { const pt = on.get(id); on.delete(id); return cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: pt ? [{ x: pt[0], y: pt[1], id }] : [] }); },
  };
}
// the heads shown: id, centre (client px), midi, part, staff, onset, bar
const heads = (page) => page.evaluate(() => {
  const F = window.resonateDebug().play.facts, out = [];
  for (const g of document.querySelectorAll("#stage .page g.note")) {
    const f = F[g.id], h = g.querySelector(":scope > g.notehead");
    if (!f || !h || g.getAttribute("visibility") === "hidden") continue;
    const b = h.getBoundingClientRect();
    out.push({ id: g.id, x: b.left + b.width / 2, y: b.top + b.height / 2, midi: f.midi, part: f.part, staff: String(f.staff), onset: f.onset, mi: f.mi, chord: !!g.closest("g.chord") && g.closest("g.chord").id });
  }
  return out;
});
// what sounds now (the held tones alive at the context's time) and the strikes
const sounding = (page) => page.evaluate(() => {
  const d = window.resonateDebug().play, ctx = window.__osc.at(-1)?.ctx;
  return { osc: ctx ? window.__oscAt(ctx, ctx.currentTime) : [], peeks: d.peeks.map((p) => ({ held: p.held, pid: p.pid, sounding: p.sounding })) };
});
const sameSet = (a, b) => JSON.stringify([...a].sort((x, y) => x - y)) === JSON.stringify([...b].sort((x, y) => x - y));

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const errors = [];
  const K = HAVE("killing"), PM = HAVE("pianoman");
  if (!K) console.log("(owner scores missing — PLAY_SCORES:", SCORES, ") — the owner-song checks are skipped");

  // ---------------------------------------------------------------- P a key held by another finger
  if (run("P")) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await seed(page, [{ name: "shared", xml: SHARED }]);
    await openSong(page, ids.shared, "both");
    await sleep(500);
    const cdp = await ctx.newCDPSession(page);
    const f = fingers(cdp);
    const H = await heads(page);
    const g4 = H.find((h) => h.midi === 67), e3 = H.find((h) => h.midi === 52);
    const c4t = H.find((h) => h.midi === 60 && h.staff === "1"), c4b = H.find((h) => h.midi === 60 && h.staff === "2");
    ok(g4 && e3 && c4t && c4b, `P the fixture's heads (${H.length})`);
    await f.down(9, g4.x, g4.y); await sleep(60); await f.up(9); await sleep(1500); // (the first tap: audio starts)
    // 1: the bass chord held, the treble's C4 tapped and lifted
    await f.down(1, e3.x, e3.y); await sleep(150);
    await f.down(2, c4t.x, c4t.y); await sleep(300);
    let s = await sounding(page);
    ok(sameSet(s.osc, [52, 60]) && s.peeks.find((p) => p.pid && p.held && p.sounding.join() === "60"), `P1 the chord held, C4 struck again by the other finger (${JSON.stringify(s)})`);
    await f.up(2); await sleep(900);
    s = await sounding(page);
    const held = s.peeks.find((p) => p.held);
    ok(sameSet(s.osc, [52, 60]) && held && sameSet(held.sounding, [52, 60]), `P1 the treble's C4 lifted 0.9 s ago, the chord still held: E3 and C4 both sound (${JSON.stringify(s)})`);
    await f.up(1); await sleep(1200);
    s = await sounding(page);
    ok(s.osc.length === 0, `P1 every finger up: nothing sounds (${JSON.stringify(s.osc)})`);
    // 2: the same chord with two fingers (each strikes it), the later one lifted first
    await f.down(3, e3.x, e3.y); await sleep(40);
    await f.down(4, c4b.x, c4b.y); await sleep(600);
    await f.up(4); await sleep(900);
    s = await sounding(page);
    const h2 = s.peeks.find((p) => p.held);
    ok(sameSet(s.osc, [52, 60]) && h2 && sameSet(h2.sounding, [52, 60]), `P2 the chord again with a second finger, that one lifted: the first still sounds both (${JSON.stringify(s)})`);
    await f.up(3); await sleep(1200);
    s = await sounding(page);
    ok(s.osc.length === 0, `P2 every finger up: nothing sounds (${JSON.stringify(s.osc)})`);
    // 3: the earlier finger lifted first: the later strike's keys go at its own lift (no transfer)
    await f.down(5, e3.x, e3.y); await sleep(40);
    await f.down(6, c4t.x, c4t.y); await sleep(300);
    await f.up(5); await sleep(900);
    s = await sounding(page);
    ok(sameSet(s.osc, [60]), `P3 the chord's finger lifted first: only the held C4 sounds (${JSON.stringify(s.osc)})`);
    await f.up(6); await sleep(1200);
    s = await sounding(page);
    ok(s.osc.length === 0, `P3 every finger up: nothing sounds`);
    await ctx.close();
  }
  if (run("P") && K) {
    // the voice's note tapped under the piano's held chord on the same key (Killing's Full score)
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await seed(page, [{ name: "killing", xml: read(OWNER("killing")) }]);
    await openSong(page, ids.killing, "score");
    await sleep(500);
    const sung = (await D(page)).keep.sung || [];
    const H = await heads(page);
    let pair = null;
    for (const v of H.filter((h) => sung.includes(h.part))) {
      const p = H.find((h) => !sung.includes(h.part) && h.midi === v.midi && h.chord && H.filter((o) => o.chord === h.chord).length >= 2);
      if (p) { pair = { v, p }; break; }
    }
    ok(!!pair, `P4 Killing: a voice note and a piano chord on the same key on page 1 (${pair ? `${pair.v.id} / ${pair.p.id} midi ${pair.v.midi}` : "none"})`);
    if (pair) {
      const cdp = await ctx.newCDPSession(page);
      const f = fingers(cdp);
      await f.down(9, 30, 30); await sleep(60); await f.up(9); await sleep(1200);
      await f.down(1, pair.p.x, pair.p.y); await sleep(200);
      const chord = (await sounding(page)).osc;
      await f.down(2, pair.v.x, pair.v.y); await sleep(250);
      await f.up(2); await sleep(900);
      const s = await sounding(page);
      ok(chord.includes(pair.v.midi) && sameSet(s.osc, chord), `P4 the voice's ${pair.v.midi} tapped and lifted under the held chord ${JSON.stringify(chord)}: still ${JSON.stringify(s.osc)}`);
      await f.up(1); await sleep(1200);
      ok((await sounding(page)).osc.length === 0, `P4 every finger up: nothing sounds`);
    }
    await ctx.close();
  }

  // ---------------------------------------------------------------- N no keyboard without its button
  if (run("N")) {
    const btn = (page) => page.evaluate(() => { const b = document.getElementById("keys"); return { visible: !!b.offsetParent, disabled: b.disabled }; });
    for (const [name, w, h, touch, screen] of [["slide-over", 320, 1100, true, { width: 820, height: 1180 }], ["split-third", 320, 1180, true, { width: 820, height: 1180 }], ["mini-third", 320, 1133, true, { width: 744, height: 1133 }], ["desk-340", 340, 800, false, null]]) {
      for (const pref of [null, "on"]) {
        const { ctx, page } = await newPage(browser, w, h, errors, { touch, screen, before: pref ? () => localStorage.setItem("resonate.play.keys", "on") : null });
        let d = await D(page), b = await btn(page);
        ok(!d.keys.shown && !b.visible && d.keys.on === true, `N ${name} ${w}×${h} pref ${pref}: the keyboard not shown, 🎹 hidden (on ${d.keys.on}, shown ${d.keys.shown}, 🎹 ${JSON.stringify(b)})`);
        await page.setViewportSize({ width: 375, height: h });
        await until(page, () => !document.getElementById("dock").hidden, null, 3000);
        await sleep(400);
        d = await D(page); b = await btn(page);
        ok(d.keys.shown && b.visible && !b.disabled && d.ready, `N ${name} wider (375): the keyboard back, 🎹 shown and enabled (${JSON.stringify(b)})`);
        await page.setViewportSize({ width: w, height: h });
        await sleep(600);
        d = await D(page); b = await btn(page);
        ok(!d.keys.shown && !b.visible, `N ${name} narrow again: hidden with its button`);
        await ctx.close();
      }
    }
    // a phone in landscape with the keyboard turned on: hidden, 🎹 disabled; the music as with it off
    const sizes = {};
    for (const pref of ["off", "on"]) {
      const { ctx, page } = await newPage(browser, 844, 390, errors, { screen: { width: 390, height: 844 }, before: pref === "on" ? () => localStorage.setItem("resonate.play.keys", "on") : () => localStorage.setItem("resonate.play.keys", "off") });
      let ids = {};
      if (PM) ids = await seed(page, [{ name: "pianoman", xml: read(OWNER("pianoman")) }]);
      if (PM) await openSong(page, ids.pianoman, "score");
      let d = await D(page);
      sizes[pref] = [d.H, d.sp];
      if (pref === "on") {
        const b = await btn(page);
        ok(!d.keys.shown && d.keys.on && b.visible && b.disabled, `N a phone in landscape, pref on: the keyboard not shown, 🎹 shown disabled (${JSON.stringify(d.keys)} ${JSON.stringify(b)})`);
        ok(sizes.on[0] === sizes.off[0] && sizes.on[1] === sizes.off[1] && d.sp >= 5, `N its music as with the keyboard off: H ${sizes.on[0]} / ${sizes.off[0]}, ${sizes.on[1]} / ${sizes.off[1]} px a staff space${PM ? " (Piano Man's Full score)" : ""}`);
        await page.setViewportSize({ width: 390, height: 844 });
        await until(page, () => !document.getElementById("dock").hidden, null, 3000);
        await sleep(500);
        d = await D(page);
        const b2 = await btn(page);
        ok(d.keys.shown && b2.visible && !b2.disabled, `N rotated to portrait: the keyboard shown, 🎹 enabled`);
        await page.tap("#keys"); await sleep(300);
        d = await D(page);
        ok(!d.keys.shown && d.keys.pref === "off", `N 🎹 turns it off there`);
      }
      await ctx.close();
    }
  }

  // ---------------------------------------------------------------- R the PDF drawn once
  if (run("R")) {
    for (const pref of ["on", "off"]) {
      const { ctx, page } = await newPage(browser, 820, 1180, errors, { before: pref === "on" ? () => localStorage.setItem("resonate.play.keys", "on") : () => localStorage.setItem("resonate.play.keys", "off") });
      const ids = await seed(page, [{ name: "pdfsong", xml: read("/home/user/resonate/public/songs/amazing-grace.musicxml"), pdf: Buffer.from(pdfmini(3)).toString("base64") }]);
      await openSong(page, ids.pdfsong, "both");
      await until(page, () => !document.getElementById("pdf").hidden);
      const counts = [];
      for (let k = 0; k < 3; k++) {
        await page.evaluate(() => { window.__pdfDraws = []; });
        await page.tap("#pdf");
        await until(page, () => window.resonateDebug().play.pdf.canvas && !window.resonateDebug().play.pdf.busy);
        await sleep(800);
        counts.push(await page.evaluate(() => window.__pdfDraws.length));
        await page.tap("#pdf");
        await sleep(400);
      }
      ok(counts.every((n) => n === 1), `R keyboard ${pref}: the PDF page drawn once each of 3 visits (${counts.join(", ")})`);
      // a rotation in the PDF view: drawn again for the new stage
      await page.tap("#pdf");
      await until(page, () => window.resonateDebug().play.pdf.canvas && !window.resonateDebug().play.pdf.busy);
      await sleep(600);
      await page.evaluate(() => { window.__pdfDraws = []; });
      await page.setViewportSize({ width: 1180, height: 820 });
      await sleep(900);
      const n = await page.evaluate(() => window.__pdfDraws.length);
      ok(n === 1, `R keyboard ${pref}: rotated in the PDF view — drawn again once (${n})`);
      await ctx.close();
    }
  }

  // ---------------------------------------------------------------- L the dock through a load
  if (run("L") && K && PM) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await seed(page, [{ name: "killing", xml: read(OWNER("killing")) }, { name: "pianoman", xml: read(OWNER("pianoman")) }]);
    await openSong(page, ids.killing, "score");
    await sleep(500);
    const steps = [["view", "both", ids.killing], ["view", "score", ids.killing], ["song", ids.pianoman, ids.pianoman], ["view", "both", ids.pianoman], ["song", ids.killing, ids.killing]];
    for (const [kind, to, song] of steps) {
      await page.evaluate(() => { window.__dockSeq = []; });
      await sleep(100);
      if (kind === "view") await page.selectOption("#hands", to);
      else await page.selectOption("#song", to);
      await ready(page, song, kind === "view" ? to : null);
      await sleep(500);
      const seq = await page.evaluate(() => { const s = window.__dockSeq; window.__dockSeq = null; return s; });
      const last = seq.at(-1);
      ok(seq.length <= 2 && !seq.some((s) => /chips:- /.test(s)) && !/chips:- /.test(last), `L ${kind} → ${kind === "view" ? to : "another song"}: the dock old → new, never without its chips (${JSON.stringify(seq)})`);
    }
    await ctx.close();
  }

  // ---------------------------------------------------------------- K the chips leave the keys room
  if (run("K")) {
    const keyW = (page) => page.evaluate(() => {
      const d = window.resonateDebug().play, r = d.keys.range;
      if (!r) return null;
      let whites = 0; for (let m = r[0]; m <= r[1]; m++) if ([0, 2, 4, 5, 7, 9, 11].includes(m % 12)) whites++;
      return document.getElementById("strip").getBoundingClientRect().width / whites;
    });
    const cases = [];
    if (PM) cases.push(["phone 390", 390, 844, { width: 390, height: 844 }, "pianoman", "selbar"], ["Air 820", 820, 1180, null, "pianoman", "dock"], ["Split 507", 507, 1180, { width: 820, height: 1180 }, "pianoman", null], ["mini 744", 744, 1133, null, "pianoman", "dock"]);
    if (K) cases.push(["phone 390", 390, 844, { width: 390, height: 844 }, "killing", null], ["phone 430", 430, 932, { width: 430, height: 932 }, "killing", "dock"], ["Air 820", 820, 1180, null, "killing", "dock"]);
    for (const [name, w, h, screen, song, want] of cases) {
      const { ctx, page } = await newPage(browser, w, h, errors, { screen, before: () => localStorage.setItem("resonate.play.keys", "on") });
      const ids = await seed(page, [{ name: song, xml: read(OWNER(song)) }]);
      await openSong(page, ids[song], "score");
      await sleep(300);
      const hr = await HEAR(page), ww = await keyW(page);
      ok((await D(page)).keys.shown && ww >= 8 && (!want || hr.home === want) && hr.groups.length >= 2, `K ${name} ${song} Full score, 🎹 on: the chips in the ${hr.home}${want ? ` (want ${want})` : ""}, the keys ${ww?.toFixed(1)} px a white key`);
      if (hr.home === "selbar" && name === "phone 390") {
        // ▶: the chips in the controls; a tap there mutes while playing
        await page.tap("#play");
        await until(page, () => window.resonateDebug().play.playback.state === "playing" && !window.resonateDebug().play.playback.starting);
        await sleep(300);
        let h2 = await HEAR(page);
        const k = h2.groups[0].key;
        ok(h2.shown && h2.home === "selbar", `K ${name} ▶: the chips shown in the controls`);
        await page.tap(`#hear button[data-key="${k}"]`);
        await sleep(300);
        h2 = await HEAR(page);
        ok(h2.muted.includes(k), `K ${name}: ${k} muted from the controls`);
        await page.tap(`#hear button[data-key="${k}"]`);
        await page.tap("#play");
        await sleep(200);
      }
      await ctx.close();
    }
  }

  // ---------------------------------------------------------------- B the view menu with 📄 on an iPad
  if (run("B")) {
    const { ctx, page } = await newPage(browser, 1440, 900, errors, { before: () => localStorage.setItem("resonate.play", JSON.stringify({ "amazing-grace": { names: "all", view: "score" } })) });
    await page.evaluate(() => { document.getElementById("pdf").hidden = false; });
    const whole = await page.evaluate(() => document.getElementById("hands").getBoundingClientRect().width);
    for (const [w, h] of [[744, 1133], [768, 1024], [810, 1080], [820, 1180], [834, 1194], [1024, 1366], [1080, 810], [1133, 744], [1180, 820], [1366, 1024]]) {
      await page.setViewportSize({ width: w, height: h });
      await sleep(60);
      const x = await page.evaluate(() => {
        const out = {};
        for (const pdf of [false, true]) {
          document.getElementById("pdf").hidden = !pdf;
          out[pdf ? "pdf" : "plain"] = { bar: document.getElementById("bar").getBoundingClientRect().height, hands: document.getElementById("hands").getBoundingClientRect().width, song: document.getElementById("song").getBoundingClientRect().width };
        }
        return out;
      });
      ok(x.pdf.hands >= whole - 1 && Math.abs(x.pdf.bar - x.plain.bar) < 0.5 && x.pdf.song >= 79, `B ${w}×${h} with 📄: the view menu ${x.pdf.hands.toFixed(0)} px (whole: ${whole.toFixed(0)}), the song menu ${x.pdf.song.toFixed(0)}, the bar ${x.pdf.bar.toFixed(1)} (without 📄 ${x.plain.bar.toFixed(1)})`);
    }
    await ctx.close();
  }

  // ---------------------------------------------------------------- H a chip just before a muted part's note
  if (run("H") && K) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await seed(page, [{ name: "killing", xml: read(OWNER("killing")) }]);
    await openSong(page, ids.killing, "score");
    const groups = (await HEAR(page)).groups;
    for (const label of ["Voice", "Voice", "Piano"]) {
      const key = groups.find((g) => g.label === label)?.key;
      await page.evaluate(() => { for (let i = 0; i < 40 && window.resonateDebug().play.page > 1; i++) window.__key("ArrowLeft"); });
      await page.tap("#play");
      await until(page, () => { const p = window.resonateDebug().play.playback; return p.state !== "idle" && !p.starting && p.scheduled.length > 0; });
      await sleep(1200);
      const r = await page.evaluate(async ([key]) => {
        const facts = window.resonateDebug().play.facts;
        const mine = (id) => { const f = facts[id]; return !!f && (key.includes("|") ? f.part + "|" + (f.staff < 2 ? 1 : 2) === key : f.part === key); };
        const ctx = window.__src.at(-1).ctx;
        const piano = await (await import(performance.getEntriesByType("resource").map((e) => e.name).find((n) => n.includes("/piano.js?")) || "./piano.js")).loadPiano(ctx);
        const midiOf = (rec) => { for (const [k, b] of piano.buffers) if (b === rec.buf) return Math.round(k + 12 * Math.log2(rec.rate)); return null; };
        // a note of the chip's part due in 12–40 ms whose key another part strikes at that moment
        // in the full schedule (its twin, which the muted part had beaten to the unison)
        const items = window.resonateDebug().play.playback.items;
        let target = null;
        for (let i = 0; i < 3000 && !target; i++) {
          await new Promise((res) => setTimeout(res, 2));
          const now = ctx.currentTime;
          target = window.resonateDebug().play.playback.scheduled.find((l) => mine(l.id) && l.when - now > 0.012 && l.when - now < 0.04
            && items.some((x) => !mine(x.id) && x.midi === l.midi && Math.abs(x.sec - l.X) < 1e-6)) || null;
        }
        if (!target) return { none: true };
        const src = window.__src.find((s) => s.ctx === ctx && Math.abs(s.when - target.when) < 1e-9 && midiOf(s) === target.midi);
        const an = ctx.createAnalyser(); an.fftSize = 2048;
        src.node.__gain.connect(an);
        document.querySelector(`#hear button[data-key="${key}"]`).click();
        const lead = target.when - ctx.currentTime;
        let peak = 0;
        const buf = new Float32Array(an.fftSize);
        const t0 = performance.now();
        while (performance.now() - t0 < 450) { an.getFloatTimeDomainData(buf); for (const v of buf) peak = Math.max(peak, Math.abs(v)); await new Promise((res) => setTimeout(res, 15)); }
        const log = window.resonateDebug().play.playback.scheduled;
        const twin = log.find((l) => !mine(l.id) && l.midi === target.midi && Math.abs(l.when - target.when) < 1e-6);
        const twinSrc = window.__src.filter((s) => s !== src && s.ctx === ctx && Math.abs(s.when - target.when) < 1e-6 && midiOf(s) === target.midi);
        return { lead: Math.round(lead * 1000), peak, inLog: log.some((l) => l.id === target.id && Math.abs(l.when - target.when) < 1e-9), twin: twin?.id || null, twinSrc: twinSrc.length, calls: src.node.__gain.gain.__calls.map((c) => c[0] + "(" + c.slice(1).map((v) => +(+v).toFixed(3)).join(",") + ")") };
      }, [key]);
      if (r.none) { info(`H ${label}: no note due at the right moment (skipped)`); }
      else {
        ok(r.peak < 1e-4 && !r.inLog, `H ${label} muted ${r.lead} ms before its note: the note silent (peak ${r.peak.toExponential(1)}), not in the log (${r.calls.join(" ")})`);
        ok(r.twin && r.twinSrc >= 1, `H ${label} muted: the heard twin on the same key struck (${r.twin}, ${r.twinSrc} source)`);
      }
      await page.tap("#play"); await sleep(200);
      await page.evaluate(([key]) => { const b = document.querySelector(`#hear button[data-key="${key}"]`); if (b.getAttribute("aria-pressed") === "false") b.click(); }, [key]);
      await sleep(200);
    }
    await ctx.close();
  }

  // ---------------------------------------------------------------- M no page kept by a press
  if (run("M") && PM) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await seed(page, [{ name: "pianoman", xml: read(OWNER("pianoman")) }]);
    await openSong(page, ids.pianoman, "score");
    await sleep(800);
    const cdp = await ctx.newCDPSession(page);
    const T = (type, tps) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: tps });
    await T("touchStart", [{ x: 5, y: 5, id: 9 }]); await T("touchEnd", []); await sleep(300);
    const count = async () => {
      await cdp.send("HeapProfiler.collectGarbage"); await sleep(300); await cdp.send("HeapProfiler.collectGarbage"); await sleep(200);
      return (await cdp.send("Memory.getDOMCounters")).nodes;
    };
    const n0 = await count();
    const pages = Math.min(16, (await D(page)).pages);
    for (let p = 0; p < pages - 1; p++) {
      const pt = await page.evaluate((k) => {
        const f = window.resonateDebug().play.facts;
        const hs = [...document.querySelectorAll(".page g.note")].filter((g) => g.querySelector(".notehead") && f[g.id]);
        const r = hs[(k * 7) % hs.length].querySelector(".notehead").getBoundingClientRect();
        return [r.left + r.width / 2, r.top + r.height / 2];
      }, p * 13);
      await T("touchStart", [{ x: pt[0], y: pt[1], id: 1 }]); await sleep(60); await T("touchEnd", []); await sleep(80);
      await page.keyboard.press("ArrowRight");
      await sleep(200);
    }
    await sleep(2500);
    const n1 = await count();
    const presses = (await D(page)).peekLog.length;
    ok(n1 - n0 < 5000 && presses >= pages - 2, `M ${presses} presses on ${pages} pages, turned: DOM nodes ${n0} → ${n1} (${n1 - n0 >= 0 ? "+" : ""}${n1 - n0}; v80's first build kept a page a press, +54k)`);
    await ctx.close();
  }

  await browser.close();
  const real = errors.filter((e) => !/favicon|ERR_|net::/.test(e));
  ok(real.length === 0, `no page errors: ${JSON.stringify(real.slice(0, 5))}`);
  console.log(`${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
