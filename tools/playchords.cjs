// Play (v86): chord names under the piano, the stretch's controls steady while ▶ plays, muted parts
// not lit, the docked keyboard pressable, asleep in the background.
//
//   U  chords.js (node): nameChord — every quality, inversions (slash bass), the written spelling
//      (A♭ not G♯), a 7th with its fifth left out only over its root, symmetric chords by the bass,
//      two readings (Am7 over C6/E, Asus4/E over Dsus2/E), < 3 pitch classes or unknown → none;
//      chordMoments — a chord struck, a tune moving over a held chord (no moment), a new bass, held
//      notes counted, a tie's continuation not a strike
//   C  the chord button: aria-pressed, ≥ 44 px on touch, the pref (on by default; off kept across a
//      reload); names on Amazing Grace (Both, Right hand) and the owner's Killing Me Softly / Piano
//      Man (Full score, Both), none on Melody; every name inside its page, never over a note name
//      (≤ 1 px) nor another chord name; off → none drawn; the PDF view disables it; the bar's height
//      = v85's (HEAD_BASE, default the scratch copy) at 300–1440 × chip × 📄 × touch / mouse
//   S  the stretch's controls while ▶ plays: a stretch on page 1 played from page 2 (the music turns
//      back to it) — the rect sampled every 50 ms changes at most once, at that turn, sliding, and
//      only off the bands; a press while playing doesn't move it; ⟳ two rounds: never moves; the page
//      played from its first bar with the keyboard off (chips in the controls): one place throughout
//   M  muted parts: Killing's Full score, the voice muted — no voice note ever lit (.play or .hush),
//      the piano's lit; Both with LH muted: no LH note lit
//   K  the keyboard: a key pressed strikes in its own pointerdown (peekLog), lit while held, two
//      fingers two keys, the same key again damps the old note, the lift lets go (unlit), the bubble
//      stays off; the shell's quiet() → silent, beforeSound() called; a held key survives a page turn
//   Z  asleep: hidden → ▶ stopped, a held key cut, the keep-awake source off, the context suspended,
//      the session "auto"; the held key's finger lifted while hidden starts nothing; visible →
//      nothing by itself (suspended, "auto", no session set: another
//      app's music isn't stopped); a tap on paper resumes it with the session still "auto"; then
//      presses sound in their pointerdowns, "playback" set at the first
//
// usage: node playchords.cjs   (BASE=http://localhost:8097/resonate/, HEAD_BASE=<a v85 copy>,
//   PLAY_SCORES=<the owner's converted .musicxml — never copied into the repo>, ONLY=U,C,…, SHOTS=<dir>)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { pdfmini } = require("./pdfmini.cjs");
const BASE = process.env.BASE || "http://localhost:8097/resonate/";
const HEAD_BASE = process.env.HEAD_BASE ?? "http://localhost:8097/tmp/v85head/public/";
const ROOT = process.env.ROOT || "/home/user/resonate/public";
const SCRATCH = "/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad";
const SCORES = process.env.PLAY_SCORES ?? path.join(SCRATCH, "play/scores");
const SHOTS = process.env.SHOTS || path.join(SCRATCH, "v86");
fs.mkdirSync(SHOTS, { recursive: true });
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const run = (s) => !ONLY || ONLY.has(s);
let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) passes++; else { fails++; console.log("FAIL", msg); } };
const info = (...a) => console.log("  ", ...a);
const sleep = (t) => new Promise((r) => setTimeout(r, t));
const read = (f) => fs.readFileSync(f, "utf8");
const OWNER = (n) => path.join(SCORES, n + ".musicxml");
const HAVE = (n) => !!SCORES && fs.existsSync(OWNER(n));

// ---------------------------------------------------------------- U: chords.js
async function unit() {
  const { nameChord, chordMoments } = await import(path.join(ROOT, "chords.js"));
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const N = (s) => { const m = /^([A-G])(bb|b|##|#|)(-?\d)$/.exec(s); const alter = { bb: -2, b: -1, "": 0, "#": 1, "##": 2 }[m[2]]; return { step: m[1], alter, midi: (Number(m[3]) + 1) * 12 + PC[m[1]] + alter }; };
  const name = (...ns) => nameChord(ns.map(N))?.name ?? null;
  const cases = [
    [["C3", "E3", "G3"], "C"], [["E3", "G3", "B3"], "Em"], [["E3", "C4", "G4"], "C/E"], [["G2", "C4", "E4"], "C/G"],
    [["Ab2", "C3", "Eb3"], "A♭"], [["G#2", "B#2", "D#3"], "G♯"], [["Bb2", "D3", "F3", "A3"], "B♭maj7"],
    [["G2", "B2", "D3", "F3"], "G7"], [["D3", "F3", "A3", "C4"], "Dm7"], [["B2", "D3", "F3"], "Bdim"],
    [["B2", "D3", "F3", "Ab3"], "Bdim7"], [["B2", "D3", "F3", "A3"], "Bm7♭5"], [["C3", "E3", "G#3"], "Caug"],
    [["D3", "G3", "A3"], "Dsus4"], [["D3", "E3", "A3"], "Dsus2"], [["C3", "E3", "G3", "A3"], "C6"],
    [["C3", "Eb3", "G3", "A3"], "Cm6"], [["C3", "D3", "E3", "G3"], "Cadd9"], [["C3", "E3", "G3", "Bb3", "D4"], "C9"],
    [["A2", "C3", "E3", "G3"], "Am7"], [["E2", "A2", "C3", "G3"], "Am7/E"], [["E2", "A3", "D4"], "Asus4/E"],
    [["C2", "E3", "Bb3"], "C7"], [["E2", "C3", "Bb3"], null], [["F2", "A2", "E3"], "Fmaj7"],
    [["Eb2", "G3", "Bb3", "Eb4"], "E♭"], [["F#3", "A3", "C4", "Eb4"], "F♯dim7"],
    [["C3", "E3"], null], [["C3", "C4", "G4"], null], [["C3", "D3", "F#3", "G#3"], null], [[], null],
  ];
  for (const [ns, want] of cases) { const got = name(...ns); ok(got === want, `U nameChord ${ns.join(" ")} → ${want} (${got})`); }
  // moments: q in quarters; ends exclusive
  const M = (q, d, s, id, struck = true) => ({ ...N(s), q, end: q + d, id, struck });
  let ms = chordMoments([M(0, 2, "C3", "a"), M(0, 2, "E3", "b"), M(0, 2, "G3", "c"), M(0, 0.5, "C5", "t1"), M(0.5, 0.5, "D5", "t2"), M(1, 1, "E5", "t3"), M(2, 2, "F3", "d"), M(2, 2, "A3", "e"), M(2, 2, "C4", "f")]);
  ok(JSON.stringify(ms.map((m) => [m.q, m.name])) === JSON.stringify([[0, "C"], [2, "F"]]), `U a tune over a held chord isn't a moment: ${JSON.stringify(ms.map((m) => [m.q, m.name]))}`);
  ms = chordMoments([M(0, 4, "E4", "a"), M(0, 4, "G4", "b"), M(0, 4, "B4", "c"), M(0, 2, "E2", "d"), M(2, 2, "C2", "e")]);
  ok(JSON.stringify(ms.map((m) => [m.q, m.name])) === JSON.stringify([[0, "Em"], [2, "Cmaj7"]]), `U a new bass under held notes: ${JSON.stringify(ms.map((m) => [m.q, m.name]))}`);
  ms = chordMoments([M(0, 2, "C3", "a"), M(0, 2, "E3", "b"), M(0, 2, "G3", "c"), M(2, 2, "C3", "a2", false), M(2, 2, "E3", "b2", false), M(2, 2, "G3", "c2", false)]);
  ok(ms.length === 1 && ms[0].ids.join() === "a,b,c", `U a tie's continuation isn't struck again: ${JSON.stringify(ms)}`);
  ms = chordMoments([M(0, 1, "C3", "a"), M(1, 1, "E3", "b"), M(2, 1, "G3", "c")]);
  ok(ms.length === 0, `U a broken chord, nothing held: no name (${ms.length})`);
}

function INIT() {
  window.__session = "auto";
  window.__sets = [];
  Object.defineProperty(navigator, "audioSession", { configurable: true, value: { get type() { return window.__session; }, set type(v) { window.__sets.push(v); window.__session = v; } } });
  window.__key = (key) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  window.__hide = (hidden) => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") }); document.dispatchEvent(new Event("visibilitychange")); };
  // every buffer source's start and stops; the keep-alive sources; the pointerdowns (strikes inside them)
  const M = (window.__m = { seq: 0, pd: [], starts: [], cs: { live: 0, starts: 0 } });
  addEventListener("pointerdown", (e) => M.pd.push({ seq: ++M.seq, id: e.pointerId, ts: e.timeStamp }), true);
  addEventListener("pointerdown", (e) => { const p = M.pd.findLast((x) => x.id === e.pointerId); if (p) p.bseq = ++M.seq; }, false);
  const S = AudioBufferSourceNode.prototype.start, P = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.start = function (when = 0, ...a) { this.__rec = { seq: ++M.seq, when, ct: this.context.currentTime, t: performance.now(), stops: [] }; M.starts.push(this.__rec); return S.call(this, when, ...a); };
  AudioBufferSourceNode.prototype.stop = function (when = 0) { this.__rec?.stops.push({ when, ct: this.context.currentTime }); return P.call(this, when); };
  const C0 = ConstantSourceNode.prototype.start, C1 = ConstantSourceNode.prototype.stop;
  ConstantSourceNode.prototype.start = function (...a) { M.cs.starts++; M.cs.live++; this.__live = true; return C0.apply(this, a); };
  ConstantSourceNode.prototype.stop = function (...a) { if (this.__live) { this.__live = false; M.cs.live--; } return C1.apply(this, a); };
}
const D = (page) => page.evaluate(() => { const d = window.resonateDebug?.().play; if (!d) return null; const { facts, countAll, playback, ...rest } = d; return rest; });
const PBD = (page) => page.evaluate(() => { const x = window.resonateDebug().play.playback; const { geo, onsets, timeline, singOrder, pageOf, ...rest } = x; rest.items = rest.items.length; rest.scheduled = rest.scheduled.length; return rest; });
const ready = (page, song, view) => page.waitForFunction(([s, v]) => { const d = window.resonateDebug?.().play; return d && d.ready && (!s || d.song === s) && (!v || d.view === v); }, [song, view], { timeout: 120000 });
const until = async (page, fn, arg, ms = 20000) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
async function newPage(browser, w, h, errors, { touch = true, before = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
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
    const v = document.getElementById("version")?.textContent.trim().slice(1) || "";
    const L = await import(`./library.js?v=${v}`);
    const ids = {};
    for (const s of list) ids[s.name] = await L.addSong(s.name, s.xml, { source: "file" });
    return ids;
  }, list);
  await page.reload();
  await ready(page);
  return ids;
}
async function openSong(page, id, view) {
  if ((await D(page)).song !== id) { await page.selectOption("#song", id); await ready(page, id); }
  if (view && (await D(page)).view !== view) { await page.selectOption("#hands", view); await ready(page, id, view); }
  await sleep(300);
}
async function touch(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  const on = new Map();
  const send = (type) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: [...on].map(([id, [x, y]]) => ({ x, y, id })) });
  return {
    down: (id, x, y) => { on.set(id, [x, y]); return send("touchStart"); },
    move: (id, x, y) => { on.set(id, [x, y]); return send("touchMove"); },
    up: (id) => { const pt = on.get(id); on.delete(id); return cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: pt ? [{ x: pt[0], y: pt[1], id }] : [] }); },
    path: async (pts, step = 16) => {
      on.set(1, pts[0]);
      await send("touchStart");
      for (const p of pts.slice(1)) { on.set(1, p); await send("touchMove"); await sleep(step); }
      await sleep(120);
      on.delete(1);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    },
  };
}
const line = (a, b, n = 10) => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
async function geo(page) {
  const g = await page.evaluate(() => window.resonateDebug().play.playback.geo());
  return g.map((pg) => ({ page: pg.page, systems: pg.systems.map((s) => ({ ...s, top: s.top + pg.rect[1], bottom: s.bottom + pg.rect[1], cols: s.cols.map(([q, x0, x1]) => [q, x0 + pg.rect[0], x1 + pg.rect[0]]) })) }));
}
const colPt = (s, i) => [(s.cols[i][1] + s.cols[i][2]) / 2, s.top + 0.3 * (s.bottom - s.top)];
const unlock = async (page) => { await page.evaluate(() => { const r = document.getElementById("stage").getBoundingClientRect(); window.__unlockAt = [r.right - 6, r.top + 6]; }); const [x, y] = await page.evaluate(() => window.__unlockAt); await page.touchscreen.tap(x, y); await sleep(700); };
// The stretch's controls sampled every 50 ms while ▶ plays: where they are now (stage px), where
// they're going (x), sliding, the turns made, the page.
async function sampleSelbar(page, ms) {
  const out = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await page.evaluate(() => {
      const x = window.resonateDebug().play.playback, st = document.getElementById("stage").getBoundingClientRect(), r = document.getElementById("selbar").getBoundingClientRect();
      return { r: [Math.round(r.left - st.left), Math.round(r.top - st.top)], x: x.selbar ? [x.selbar.x, x.selbar.y] : [], sliding: x.selbar?.sliding, state: x.state, turns: x.turns.length, page: window.resonateDebug().play.page };
    });
    if (s.state === "idle") break;
    out.push(s);
    await sleep(50);
  }
  return out;
}
const selbarOnBands = (page) => page.evaluate(() => { const sb = document.getElementById("selbar").getBoundingClientRect(); return [...document.querySelectorAll(".page .sel")].some((s) => { const b = s.getBoundingClientRect(); return b.left < sb.right && b.right > sb.left && b.top < sb.bottom && b.bottom > sb.top; }); });
// The chord names drawn and the note names, as boxes on screen (client px)
const scene = (page) => page.evaluate(() => {
  const r = (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
  // (a name's ink: its box across, from its capitals' top to its descenders — not the font's box)
  const ink = (t) => { const b = t.getBoundingClientRect(), m = t.getScreenCTM(), fs = Number(t.parentNode.getAttribute("font-size")) * m.d, base = m.f + Number(t.getAttribute("y")) * m.d; return [b.left, base - 0.74 * fs, b.right, base + 0.22 * fs]; };
  const names = [...document.querySelectorAll("#stage .page g.chn text")].map((t) => ({ name: t.textContent, box: ink(t), page: r(t.closest(".page")) }));
  const badges = [...document.querySelectorAll("#stage .page .nn rect")].filter((x) => x.getClientRects().length && getComputedStyle(x.parentNode).display !== "none").map(r);
  return { names, badges, stage: r(document.getElementById("stage")) };
});
const overlap = (a, b, tol = 1) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > tol && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > tol;
function checkScene(tag, sc) {
  let outside = 0, onBadge = 0, onName = 0;
  for (const [i, n] of sc.names.entries()) {
    const [l, t, rr, b] = n.box;
    if (l < n.page[0] - 1 || rr > n.page[2] + 1 || t < n.page[1] - 1 || b > n.page[3] + 1) outside++;
    if (sc.badges.some((x) => overlap(n.box, x))) { onBadge++; if (onBadge < 3) info(`${tag}: "${n.name}" ${n.box.map(Math.round)} over a note name`); }
    if (sc.names.some((m, j) => j !== i && overlap(n.box, m.box))) onName++;
  }
  ok(!outside && !onBadge && !onName, `${tag}: ${sc.names.length} chord names inside the page (${outside} out), none over a note name (${onBadge}) or another (${onName})`);
}

(async () => {
  if (run("U")) await unit();
  const browser = await chromium.launch();
  const errors = [];

  // ---------------------------------------------------------------- C the chord names
  if (run("C")) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    let d = await D(page);
    const btn = await page.evaluate(() => { const b = document.getElementById("chords"), r = b.getBoundingClientRect(); return { pressed: b.getAttribute("aria-pressed"), w: r.width, h: r.height, next: b.previousElementSibling?.id }; });
    ok(d.chords.on && btn.pressed === "true" && btn.w >= 44 && btn.h >= 44 && btn.next === "names", `C the chord button beside ABC, on by default, ${btn.w}×${btn.h} (${JSON.stringify(btn)})`);
    ok(d.view === "both" && d.chords.drawn.length >= 10 && d.chords.drawn.some((x) => /^A♭/.test(x.name)), `C Amazing Grace, Both: ${d.chords.drawn.length} names (${d.chords.drawn.map((x) => x.name).join(" ")})`);
    checkScene("C Amazing Grace Both 820", await scene(page));
    await page.screenshot({ path: path.join(SHOTS, "chords-ipad-amazing-grace.png") });
    // a hand: its own notes (fewer — the left hand alone isn't a chord most of the time)
    await page.selectOption("#hands", "rh"); await ready(page, null, "rh"); await sleep(300);
    d = await D(page);
    info(`C Amazing Grace, Right hand: ${d.chords.moments.length} moments, drawn ${d.chords.drawn.map((x) => x.name).join(" ")}`);
    checkScene("C Amazing Grace RH", await scene(page));
    await page.selectOption("#hands", "melody"); await ready(page, null, "melody"); await sleep(300);
    d = await D(page);
    ok(d.chords.moments.length === 0 && d.chords.drawn.length === 0, `C Melody: no names (${d.chords.moments.length})`);
    // off: none; the pref kept across a reload
    await page.selectOption("#hands", "both"); await ready(page, null, "both"); await sleep(300);
    await page.tap("#chords"); await sleep(200);
    d = await D(page);
    ok(!d.chords.on && d.chords.pref === "off" && d.chords.drawn.length === 0 && (await page.getAttribute("#chords", "aria-pressed")) === "false", `C off: none drawn, pref "off" (${d.chords.pref})`);
    await page.reload(); await ready(page); await sleep(300);
    d = await D(page);
    ok(!d.chords.on && d.chords.drawn.length === 0, "C off kept across a reload");
    await page.tap("#chords"); await sleep(200);
    d = await D(page);
    ok(d.chords.on && d.chords.pref === "on" && d.chords.drawn.length >= 10, `C on again (${d.chords.drawn.length})`);
    // −/+: drawn again at the new size
    await page.tap("#bigger"); await until(page, () => window.resonateDebug().play.step === 1); await sleep(300);
    checkScene("C Amazing Grace Both + (bigger)", await scene(page));
    await page.tap("#smaller"); await sleep(400);
    await ctx.close();

    // the owner's songs
    for (const [nm, views] of [["killing", ["score", "both"]], ["pianoman", ["score", "both"]]]) {
      if (!HAVE(nm)) { info("C skipped (no owner score)", nm); continue; }
      const { ctx, page } = await newPage(browser, 820, 1180, errors);
      const ids = await seed(page, [{ name: nm, xml: read(OWNER(nm)) }]);
      for (const view of views) {
        await openSong(page, ids[nm], view);
        d = await D(page);
        let drawn = 0, pages = Math.min(d.pages, 6);
        for (let p = 1; p <= pages; p++) {
          if (p > 1) { await page.tap("#next"); await until(page, (p) => window.resonateDebug().play.page === p, p); await sleep(250); }
          const sc = await scene(page);
          drawn += sc.names.length;
          checkScene(`C ${nm} ${view} p${p}`, sc);
          if (nm === "killing" && view === "score" && p === 4) await page.screenshot({ path: path.join(SHOTS, "chords-ipad-killing-score-p4.png") });
        }
        d = await D(page);
        ok(d.chords.moments.length > 20 && drawn > 10, `C ${nm} ${view}: ${d.chords.moments.length} moments, ${drawn} names drawn on pages 1–${pages}`);
        info(`C ${nm} ${view}: ${d.chords.moments.slice(0, 24).map((m) => m[1]).join(" ")} … placements ${JSON.stringify(d.chords.why.map((w) => w.how))}`);
        for (let p = 1; p < pages; p++) await page.tap("#prev");
        await sleep(300);
      }
      await ctx.close();
    }
    // a phone (390 wide): drawn, inside the page; the button on the song's row above ABC
    {
      const { ctx, page } = await newPage(browser, 390, 844, errors);
      const sc = await scene(page);
      checkScene("C phone 390 Amazing Grace", sc);
      const pos = await page.evaluate(() => { const r = (id) => document.getElementById(id).getBoundingClientRect(); return { chords: [r("chords").left, r("chords").top, r("chords").width], names: [r("names").left, r("names").top], song: r("song").top }; });
      ok(sc.names.length > 5 && Math.abs(pos.chords[1] - pos.song) < 2 && pos.chords[0] < pos.names[0] + 44 && pos.chords[0] + pos.chords[2] > pos.names[0], `C phone: ${sc.names.length} names; the button on the song's row above ABC (${JSON.stringify(pos)})`);
      await page.screenshot({ path: path.join(SHOTS, "chords-iphone-amazing-grace.png") });
      await ctx.close();
    }
    // the PDF view disables it
    {
      const { ctx, page } = await newPage(browser, 820, 1180, errors);
      const id = await page.evaluate(async ([xml, pdf]) => {
        const v = document.getElementById("version")?.textContent.trim().slice(1) || "";
        const L = await import(`./library.js?v=${v}`);
        const id = await L.addSong("pdfsong", xml, { source: "pdf" });
        await L.putPdf(id, Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0)).buffer, "pdfsong.pdf");
        return id;
      }, [read(path.join(ROOT, "songs/amazing-grace.musicxml")), Buffer.from(pdfmini(2)).toString("base64")]);
      await page.reload(); await ready(page);
      await openSong(page, id, "both");
      await until(page, () => !document.getElementById("pdf").hidden);
      await page.tap("#pdf");
      await until(page, () => window.resonateDebug().play.pdf.canvas && !window.resonateDebug().play.pdf.busy);
      const off = await page.evaluate(() => document.getElementById("chords").disabled);
      await page.tap("#pdf"); await sleep(400);
      const on = await page.evaluate(() => !document.getElementById("chords").disabled && window.resonateDebug().play.chords.drawn.length > 0);
      ok(off && on, `C the PDF view: the button disabled (${off}); back on the sheet: enabled, names drawn (${on})`);
      await ctx.close();
    }
    // the bar's height vs v85 (HEAD_BASE)
    const headOk = HEAD_BASE && (await fetch(HEAD_BASE + "play.html").then((r) => r.ok).catch(() => false));
    if (headOk) {
      const W = [300, 320, 340, 360, 375, 390, 402, 414, 420, 421, 428, 440, 460, 479, 480, 507, 540, 600, 626, 667, 669, 670, 694, 700, 740, 744, 800, 820, 900, 1024, 1099, 1100, 1112, 1133, 1140, 1180, 1280, 1366, 1440];
      const heights = async (base, touchy, chip) => {
        const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 }, hasTouch: touchy, isMobile: touchy, deviceScaleFactor: 1 });
        if (chip) await ctx.addInitScript(() => localStorage.setItem("resonate.play", JSON.stringify({ "amazing-grace": { names: "all", days: { n: 5, ask: 3 } } })));
        const page = await ctx.newPage();
        await page.goto(base + "play.html");
        await ready(page);
        const out = {};
        for (const w of W) {
          await page.setViewportSize({ width: w, height: 900 });
          for (const pdf of [false, true]) out[w + (pdf ? "+pdf" : "")] = await page.evaluate((pdf) => { document.getElementById("pdf").hidden = !pdf; const c = document.getElementById("chords"); return { h: document.getElementById("bar").getBoundingClientRect().height, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, chords: c ? c.getBoundingClientRect().right <= innerWidth + 0.5 && c.getClientRects().length > 0 : null }; }, pdf);
        }
        await ctx.close();
        return out;
      };
      let worse = [], n = 0, lost = [];
      for (const touchy of [true, false]) for (const chip of [false, true]) {
        const [a, b] = [await heights(HEAD_BASE, touchy, chip), await heights(BASE, touchy, chip)];
        for (const k of Object.keys(a)) {
          n++;
          if (b[k].h > a[k].h + 0.5) worse.push(`${touchy ? "touch" : "mouse"} ${k}${chip ? " chip" : ""}: ${a[k].h.toFixed(1)} → ${b[k].h.toFixed(1)}`);
          if (!b[k].chords || b[k].sw > b[k].cw) lost.push(`${touchy ? "T" : "M"} ${k}${chip ? " chip" : ""}`);
        }
      }
      ok(worse.length === 0, `C the bar no taller than v85's at ${n} width × chip × 📄 × pointer settings (${worse.slice(0, 6).join("; ")})`);
      ok(lost.length === 0, `C the chord button shown and inside at every one, no sideways scroll (${lost.slice(0, 6).join("; ")})`);
    } else info("C bar heights skipped: no v85 copy at", HEAD_BASE);
  }

  // ---------------------------------------------------------------- S the stretch's controls while ▶ plays
  if (run("S") && HAVE("killing")) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await seed(page, [{ name: "killing", xml: read(OWNER("killing")) }]);
    await page.evaluate((id) => localStorage.setItem("resonate.sing.timing", JSON.stringify({ [id]: { bpm: 200 } })), ids.killing);
    await openSong(page, ids.killing, "both");
    await unlock(page);
    const T = await touch(ctx, page);
    // a stretch over page 1's last two lines, then page 2 by hand: ▶ turns back to it
    let g = await geo(page);
    const sys = g[0].systems, a = sys[sys.length - 2], b = sys[sys.length - 1];
    await T.path(line(colPt(a, 1), colPt(b, Math.min(4, b.cols.length - 1)), 10));
    let p = await PBD(page);
    ok(p.span && p.bands.length >= 2 && p.selbar, `S a stretch over two lines (${p.bands.length} bands)`);
    await page.tap("#next"); await until(page, () => window.resonateDebug().play.page === 2); await sleep(300);
    p = await PBD(page);
    const placed = p.selbar.rect;
    await page.tap("#sel-play");
    let rects = await sampleSelbar(page, 9000);
    let targets = [...new Set(rects.map((s) => s.x.join()))];
    info(`S placed on page 2 at ${placed.map(Math.round)}; targets ${targets.join(" → ")}; pages ${[...new Set(rects.map((s) => s.page))]}`);
    ok(rects.some((s) => s.turns) && rects.length > 40 && targets.length === 1 && !(await selbarOnBands(page)), `S a stretch played from page 2: ${rects.length} samples, the music turned back, the controls not over its bands there — never moved (${targets.join(" → ")})`);
    await page.tap("#sel-play").catch(() => {}); await sleep(200);
    // the slide: the Full score's last lines reach the stage's foot — a stretch over page 1's last two
    // lines, page 2 by hand (the controls at its foot: nothing there), ▶: the turn back to page 1 would
    // leave them over the bands — they slide off, once
    await page.selectOption("#hands", "score"); await ready(page, null, "score"); await sleep(300);
    if ((await D(page)).page !== 1) { await page.evaluate(() => { for (let i = 0; i < 9; i++) window.__key("ArrowLeft"); }); await sleep(400); }
    g = await geo(page);
    const z = g[0].systems, s0 = z[z.length - 2], s1 = z[z.length - 1];
    await T.path(line(colPt(s0, 1), colPt(s1, s1.cols.length - 2), 12));
    await page.evaluate(() => window.__key("ArrowRight")); await until(page, () => window.resonateDebug().play.page === 2); await sleep(300);
    p = await PBD(page);
    const foot = p.selbar && p.selbar.at === "bottom";
    await page.tap("#sel-play");
    rects = await sampleSelbar(page, 5000);
    targets = [...new Set(rects.map((s) => s.x.join()))];
    const at = rects.findIndex((s) => s.x.join() === targets[1]);
    ok(foot && targets.length === 2 && at >= 0 && rects[at].turns >= 1 && rects.slice(at, at + 3).some((s) => s.sliding) && !(await selbarOnBands(page)), `S at the turn back over the bands: one move, sliding, off them (at the foot on page 2 ${foot}; ${targets.join(" → ")}; sliding ${rects.slice(Math.max(0, at), at + 3).map((s) => s.sliding)})`);
    info(`S slide: bands ${JSON.stringify((await PBD(page)).bands.map((b) => [b.page, b.top, b.top + b.height]))}, selbar ${JSON.stringify((await PBD(page)).selbar)}, on bands ${await selbarOnBands(page)}, pages ${[...new Set(rects.map((s) => s.page))]}`);
    if (at >= 0) info(`S frames caught mid-slide: ${rects.slice(at, at + 6).filter((s) => s.r.join() !== s.x.join()).length}`);
    await page.screenshot({ path: path.join(SHOTS, "selbar-playing-ipad.png") });
    // ⟳ two rounds, a press while it loops: never moves
    p = await PBD(page);
    const before = p.selbar.x.toString() + p.selbar.y;
    await page.tap("#sel-loop");
    await until(page, () => window.resonateDebug().play.playback.state === "looping");
    const hs = await page.evaluate(() => [...document.querySelectorAll("#stage g.note > g.notehead")].slice(3, 6).map((h) => { const r = h.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }));
    const seen = new Set();
    const t1 = Date.now();
    let pressed = false;
    while (Date.now() - t1 < 7000) {
      const x = await PBD(page);
      if (x.selbar) seen.add(x.selbar.x + "," + x.selbar.y);
      if (!pressed && Date.now() - t1 > 1500 && hs[0]) { pressed = true; await T.down(5, hs[0][0], hs[0][1]); await sleep(300); await T.up(5); }
      await sleep(80);
    }
    p = await PBD(page);
    ok(seen.size === 1 && [...seen][0].replace(",", "") === before && p.round >= 1, `S ⟳ ${p.round + 1} rounds with a press: the controls never moved (${[...seen].join(" | ")})`);
    await page.tap("#sel-play"); await sleep(200);
    // the page played from its first bar, the keyboard off (the chips in the controls), one place throughout
    await page.tap("#sel-clear"); await sleep(200);
    await page.tap("#keys"); await sleep(500);
    await page.selectOption("#hands", "score"); await ready(page, null, "score"); await sleep(300);
    await page.tap("#play");
    await until(page, () => window.resonateDebug().play.playback.state === "playing");
    const seen2 = new Set();
    let turns = 0;
    const t2 = Date.now();
    while (Date.now() - t2 < 12000) {
      const x = await PBD(page);
      if (x.state === "idle") break;
      if (x.selbar) seen2.add(x.selbar.x + "," + x.selbar.y);
      turns = x.turns.length;
      await sleep(60);
    }
    const hr = (await PBD(page)).hear;
    ok(seen2.size === 1 && hr.home === "selbar", `S the page played (${turns} auto turns), the keyboard off: the controls (with the chips) at one place (${[...seen2].join(" | ")})`);
    await page.tap("#play").catch(() => {}); await sleep(200);
    await ctx.close();
  }

  // ---------------------------------------------------------------- M muted parts aren't lit
  if (run("M") && HAVE("killing")) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await seed(page, [{ name: "killing", xml: read(OWNER("killing")) }]);
    await openSong(page, ids.killing, "score");
    await unlock(page);
    await page.tap('#hear button[data-key="P1"]'); await sleep(200);
    await page.tap("#play");
    await until(page, () => window.resonateDebug().play.playback.litEls.length > 0);
    let samples = 0, voiceLit = 0, hush = 0, piano = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 5000) {
      const s = await page.evaluate(() => {
        const p = window.resonateDebug().play, x = p.playback;
        const lit = [...document.querySelectorAll("#stage .page g.note.play, #stage .page g.note.hush")];
        return { parts: lit.map((g) => p.facts[g.id]?.part), hush: document.querySelectorAll("#stage .page .hush").length, words: [...document.querySelectorAll("#stage .page g.note.play > g.verse")].length };
      });
      samples++;
      voiceLit += s.parts.filter((x) => x === "P1").length;
      piano += s.parts.filter((x) => x !== "P1").length ? 1 : 0;
      hush += s.hush;
      await sleep(100);
    }
    await page.tap("#play"); await sleep(200);
    ok(samples > 20 && voiceLit === 0 && hush === 0 && piano > samples / 2, `M Full score, the voice muted: no voice note lit in ${samples} samples (${voiceLit}), nothing .hush (${hush}), the piano lit in ${piano}`);
    await page.tap('#hear button[data-key="P1"]'); await sleep(200);
    // Both, LH muted
    await page.selectOption("#hands", "both"); await ready(page, null, "both"); await sleep(300);
    const lh = await page.evaluate(() => window.resonateDebug().play.playback.hear.groups.find((g) => g.label === "LH")?.key);
    await page.tap(`#hear button[data-key="${lh}"]`); await sleep(200);
    await page.tap("#play");
    await until(page, () => window.resonateDebug().play.playback.litEls.length > 0);
    let lhLit = 0, n = 0;
    const t1 = Date.now();
    while (Date.now() - t1 < 3000) {
      lhLit += await page.evaluate(() => { const p = window.resonateDebug().play; return [...document.querySelectorAll("#stage .page g.note.play")].filter((g) => p.facts[g.id]?.staff === 2).length; });
      n++;
      await sleep(100);
    }
    await page.tap("#play"); await sleep(200);
    ok(n > 10 && lhLit === 0, `M Both, LH muted: no left-hand note lit (${lhLit} in ${n} samples)`);
    await page.tap(`#hear button[data-key="${lh}"]`); await sleep(100);
    await ctx.close();
  }

  // ---------------------------------------------------------------- K the keyboard is pressable
  if (run("K")) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    await unlock(page);
    const T = await touch(ctx, page);
    const key = (m) => page.evaluate((m) => { const r = document.querySelector(`#strip rect.key[data-midi="${m}"]`)?.getBoundingClientRect(); return r ? [r.left + r.width / 2, r.top + r.height * (r.height > 50 ? 0.85 : 0.5)] : null; }, m);
    const blackKey = (m) => page.evaluate((m) => { const r = document.querySelector(`#strip rect.key[data-midi="${m}"]`)?.getBoundingClientRect(); return r ? [r.left + r.width / 2, r.top + r.height * 0.4] : null; }, m);
    const c4 = await key(60), e4 = await key(64), cs4 = await blackKey(61);
    ok(c4 && e4 && cs4, `K keys found (${JSON.stringify([c4, e4, cs4])})`);
    let m0 = await page.evaluate(() => ({ pd: window.__m.pd.length, st: window.__m.starts.length }));
    await T.down(1, ...c4);
    let r = await page.evaluate((m0) => { const M = window.__m, pd = M.pd[m0.pd], st = M.starts[m0.st]; return { inDispatch: !!pd && !!st && st.seq > pd.seq && st.seq < pd.bseq, ahead: st ? st.when - st.ct : null, log: window.resonateDebug().play.peekLog.at(-1) }; }, m0);
    ok(r.inDispatch && r.ahead <= 0.0005 && r.log?.midis.join() === "60" && r.log.how === "hold", `K a key pressed strikes in its own pointerdown (${JSON.stringify(r)})`);
    await sleep(150);
    let d = await D(page);
    ok(d.keys.lit.some((k) => k.midi === 60) && d.keys.held.join() === "60" && !(await page.evaluate(() => document.getElementById("bubble").classList.contains("on"))), `K lit while held, no bubble (${JSON.stringify(d.keys.lit)})`);
    await T.down(2, ...e4);
    await sleep(150);
    d = await D(page);
    ok(d.peeks.length === 2 && d.peeks.every((x) => x.held && x.sounding.length === 1) && JSON.stringify(d.keys.lit.map((k) => k.midi).sort()) === "[60,64]", `K two fingers, two keys held and lit (${JSON.stringify(d.peeks)})`);
    await T.up(1);
    await sleep(150);
    d = await D(page);
    ok(d.keys.lit.map((k) => k.midi).join() === "64" && d.peeks.length === 1 && d.peeks[0].held, `K C lifted: unlit at once, E still held (${JSON.stringify(d.keys.lit)})`);
    await T.up(2);
    await sleep(100);
    // a black key; the same key again while it sounds: damped as the new one starts
    await T.down(1, ...cs4); await sleep(60); await T.up(1); await sleep(60);
    await T.down(1, ...cs4); await sleep(80);
    d = await D(page);
    ok(d.peekLog.at(-1).midis.join() === "61" && d.peekLog.at(-1).again?.join() === "61", `K C♯ struck again: the old note damped (${JSON.stringify(d.peekLog.slice(-2))})`);
    const lab = await page.evaluate(() => [...document.querySelectorAll("#strip text")].map((t) => t.textContent).join(" "));
    ok(/C♯|D♭/.test(lab), `K the black key's name on it (${lab})`);
    await T.up(1); await sleep(150);
    // a held key survives a page turn by hand (it isn't on the page); a press on the music meanwhile doesn't cut it
    await T.down(1, ...c4); await sleep(100);
    await page.evaluate(() => window.__key("ArrowRight")); await sleep(300);
    d = await D(page);
    ok(d.peeks.some((x) => x.held && x.sounding.join() === "60"), `K a held key goes on across a page turn (${JSON.stringify(d.peeks)})`);
    await T.up(1); await sleep(200);
    // the shell's hooks: quiet → silent; beforeSound called
    await page.evaluate(() => { window.__before = 0; window.resonatePlay.beforeSound = () => window.__before++; window.resonatePlay.quiet = () => window.__quiet; window.__quiet = true; });
    const n0 = (await D(page)).peekLog.length;
    await T.down(1, ...e4); await sleep(120); await T.up(1); await sleep(100);
    d = await D(page);
    ok(d.peekLog.length === n0 && !d.keys.lit.length, `K quiet(): a key stays silent (${d.peekLog.length - n0})`);
    await page.evaluate(() => { window.__quiet = false; });
    await T.down(1, ...e4); await sleep(120); await T.up(1); await sleep(100);
    d = await D(page);
    ok(d.peekLog.length === n0 + 1 && (await page.evaluate(() => window.__before)) === 1, `K beforeSound() before a key sounds (${await page.evaluate(() => window.__before)})`);
    await page.evaluate(() => { delete window.resonatePlay.beforeSound; delete window.resonatePlay.quiet; });
    await page.screenshot({ path: path.join(SHOTS, "keyboard-ipad.png") });
    await ctx.close();
  }

  // ---------------------------------------------------------------- Z asleep in the background
  if (run("Z")) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    await unlock(page);
    const T = await touch(ctx, page);
    const c4 = await page.evaluate(() => { const r = document.querySelector('#strip rect.key[data-midi="60"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height * 0.85]; });
    await page.tap("#play");
    await until(page, () => window.resonateDebug().play.playback.state === "playing" && window.resonateDebug().play.playback.lit.length > 0);
    await T.down(1, ...c4); await sleep(200);
    let d = await D(page);
    ok(d.audio.state === "running" && d.awake.on && d.peeks.some((x) => x.held), `Z before: running, awake, a key held, ▶ playing`);
    const sets0 = (await page.evaluate(() => window.__sets.slice())).length;
    await page.evaluate(() => window.__hide(true));
    await sleep(300);
    d = await D(page);
    let x = await PBD(page);
    let r = await page.evaluate(() => ({ cs: { ...window.__m.cs }, session: navigator.audioSession.type }));
    ok(x.state === "idle" && !d.peeks.length && !d.awake.on && r.cs.live === 0 && d.audio.state === "suspended" && r.session === "auto", `Z hidden: ▶ stopped, the key cut, nothing awake, the context ${d.audio.state}, the session ${r.session}`);
    await T.up(1);
    const setsHidden = (await page.evaluate(() => window.__sets.slice())).length;
    await page.evaluate(() => window.__hide(false));
    await sleep(600);
    d = await D(page);
    r = await page.evaluate(() => ({ session: navigator.audioSession.type, sets: window.__sets.slice() }));
    ok(d.audio.state === "suspended" && r.session === "auto" && r.sets.length === setsHidden, `Z visible again: nothing by itself — the context ${d.audio.state}, the session ${r.session} (${JSON.stringify(r.sets)})`);
    await unlock(page);
    d = await D(page);
    r = await page.evaluate(() => ({ session: navigator.audioSession.type, sets: window.__sets.slice() }));
    ok(d.audio.state === "running" && r.session === "auto" && r.sets.length === setsHidden, `Z a tap on paper: the context ${d.audio.state}, the session still ${r.session} (${JSON.stringify(r.sets)})`);
    const hs = await page.evaluate(() => [...document.querySelectorAll("#stage g.note > g.notehead")].slice(2, 8).map((h) => { const b = h.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }));
    const lags = [];
    for (const h of hs) {
      const m0 = await page.evaluate(() => ({ pd: window.__m.pd.length, st: window.__m.starts.length }));
      await T.down(1, ...h); await sleep(120); await T.up(1); await sleep(150);
      const p = await page.evaluate((m0) => { const M = window.__m, pd = M.pd[m0.pd], st = M.starts[m0.st]; return pd && st ? { lag: st.t - pd.ts, inDispatch: st.seq < pd.bseq, how: window.resonateDebug().play.peekLog.at(-1)?.how } : null; }, m0);
      if (p) lags.push(p);
    }
    r = await page.evaluate(() => ({ session: navigator.audioSession.type }));
    ok(lags.length === hs.length && lags.every((p) => p.inDispatch && p.how === "hold") && r.session === "playback", `Z the presses after the return sound in their pointerdowns (${lags.map((p) => Math.round(p.lag * 10) / 10).join(" ")} ms), the session ${r.session}`);
    await ctx.close();
  }

  await browser.close();
  const real = errors.filter((e) => !/favicon|ERR_|net::/.test(e));
  ok(real.length === 0, `no page errors: ${JSON.stringify(real.slice(0, 5))}`);
  console.log(`playchords: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
