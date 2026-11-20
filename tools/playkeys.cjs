// Play (v80): the keyboard (🎹) docked under the music — a stable, toggleable panel instead of v79's
// strip that slid in on a press and jumped between the stage's foot and head while ▶ played ("it'll
// show up and disappear at random times").
//
//   D  defaults per device: on for a tablet (an iPad window in Split View too) and a desktop, off on
//      a phone; no pref written; 🎹 aria-pressed; the dock's height clamp(56, 9vh, 110) + its padding;
//      the 🎹 button ≥ 44 × 44 on a touch screen
//   U  the music never under the keyboard: every page of Amazing Grace (Both), Killing Me Softly
//      (Full score, Both) and Piano Man (Full score) on every playpaper device, keyboard on and off —
//      the stage ends where the dock starts, every page and system inside the stage; the stage with
//      it on is the stage without it less the dock; a phone in landscape (no room: < 500 px tall)
//      never shows it
//   T  the toggle: the pref ("on"/"off"), aria-pressed, the page laid out again at once at the new
//      height (not after the resize observer), the place kept (S.at's bar shown), a reload keeps it;
//      a phone turned on and off; a toggle while ▶ plays keeps playing
//   S  it stays: one rect, never hidden, across a press and its lift (+ 2.3 s), two fingers, ▶ from
//      the page with auto turns, ■, ‹ ›, a stretch looped, − / + (the music re-laid out above it) —
//      sampled every animation frame; and nothing over the music
//   L  lit keys: idle none; a press lights its chord (hand colours, letters) and 2.4 s after the lift
//      none; while ▶ plays the keys are what sounds (sampled), with a press during ▶ both; ■ → none;
//      the range is the view's (whole octaves, ≥ C3–B5)
//   P  the PDF view (📄): the dock hidden there and the PDF gets the height, 🎹 disabled; back on the
//      sheet the dock is back and the music isn't laid out again (same size, place); a rotation in
//      the PDF view → back: laid out at once at the new size
//   B  the bar no taller than v78's at 300–1180 px with and without the fewer-names chip (v78's
//      heights as playbackfixes H); 🎹 shown from 360 px; HEAD_BASE=<a v79 server>: every width
//      300–1440 × chip × 📄 × touch no taller than v79's
//
// usage: node playkeys.cjs   (BASE=http://localhost:8097/resonate/, PLAY_SCORES=<the owner's
//   converted .musicxml — never copied into the repo>, ONLY=D,U,…, SHOTS=<dir>, HEAD_BASE=…)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { pdfmini } = require("./pdfmini.cjs");
const BASE = process.env.BASE || "http://localhost:8097/resonate/";
const HEAD_BASE = process.env.HEAD_BASE || "";
const SCRATCH = "/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad";
const SCORES = process.env.PLAY_SCORES ?? path.join(SCRATCH, "play/scores");
const FIX = path.join(__dirname, "fixtures/play");
const SHOTS = process.env.SHOTS || path.join(SCRATCH, "playshots/keys");
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
// [name, w, h, touch, screen]
const DEVICES = [
  ["air-p", 820, 1180, true], ["air-l", 1180, 820, true], ["mini-p", 744, 1133, true], ["mini-l", 1133, 744, true],
  ["13-p", 1024, 1366, true], ["13-l", 1366, 1024, true], ["phone-p", 390, 844, true], ["phone-l", 844, 390, true],
  ["desk", 1440, 900, false], ["desk-s", 1100, 760, false],
];
const SPLIT = ["split", 507, 1180, true, { width: 820, height: 1180 }];
const kind = (w, h, touch, screen) => (!touch ? "desktop" : Math.min(screen?.width ?? w, screen?.height ?? h) >= 700 ? "tablet" : "phone");

function INIT() {
  try { if (!navigator.audioSession) Object.defineProperty(navigator, "audioSession", { configurable: true, value: { type: "auto" } }); } catch {}
  window.__key = (key) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  // the dock sampled every frame (S): its rect and whether it's shown
  window.__dock = new Map();
  window.__sampling = false;
  const tick = () => {
    if (window.__sampling) {
      const d = document.getElementById("dock");
      if (d) {
        const r = d.getBoundingClientRect(), st = document.getElementById("stage").getBoundingClientRect();
        const k = d.hidden ? "hidden" : [r.left, r.top, r.width, r.height].map((x) => Math.round(x)).join();
        window.__dock.set(k, (window.__dock.get(k) || 0) + 1);
        if (!d.hidden && st.bottom > r.top + 0.5) window.__dock.set("over", (window.__dock.get("over") || 0) + 1);
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
const D = (page) => page.evaluate(() => { const d = window.resonateDebug?.().play; if (!d) return null; const { facts, countAll, playback, ...rest } = d; return rest; });
const PBD = (page) => page.evaluate(() => { const x = window.resonateDebug().play.playback; const { geo, onsets, timeline, singOrder, pageOf, ...rest } = x; rest.items = rest.items.length; rest.scheduled = rest.scheduled.length; return rest; });
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
    const L = await import("./library.js?v=78");
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
// the stage, the dock and every page / system's rect (client px)
const scene = (page) => page.evaluate(() => {
  const r = (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
  const st = document.getElementById("stage"), dock = document.getElementById("dock"), cs = getComputedStyle(st);
  const s = r(st);
  return {
    stage: s, inner: s[3] - parseFloat(cs.paddingBottom), dock: dock.hidden ? null : r(dock),
    pages: [...st.querySelectorAll(".page")].map((p) => r(p)), systems: [...st.querySelectorAll(".page g.system")].map((g) => r(g)),
    bubble: document.getElementById("bubble").classList.contains("on") ? r(document.getElementById("bubble")) : null,
  };
});
// CDP touches
async function touchPath(ctx, page, pts, { hold = 0, step = 16, rest = 150 } = {}) {
  const cdp = await ctx.newCDPSession(page);
  const t = (type, p) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ x: p[0], y: p[1], id: 1 }] : [] });
  await t("touchStart", pts[0]);
  if (hold) await sleep(hold);
  for (const p of pts.slice(1)) { await t("touchMove", p); await sleep(step); }
  if (pts.length > 1) { await t("touchMove", pts[pts.length - 1]); await sleep(rest); }
  await t("touchEnd");
  await cdp.detach().catch(() => {});
}
const line = (a, b, n = 10) => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
// heads on the shown page(s): [x, y, id] (client px)
const heads = (page) => page.evaluate(() => [...document.querySelectorAll("#stage .page g.note > g.notehead")].map((h) => { const r = h.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, h.parentElement.id]; }));
const toFirst = (page) => page.evaluate(() => { for (let i = 0; i < 400 && window.resonateDebug().play.page > 1; i++) window.__key("ArrowLeft"); });
const midisOf = (page, ids) => page.evaluate((ids) => [...new Set(ids.map((id) => window.resonateDebug().play.facts[id]?.midi))].sort((a, b) => a - b), ids);

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const errors = [];
  const K = HAVE("killing"), PM = HAVE("pianoman");
  if (!K) console.log("(owner scores missing — PLAY_SCORES:", SCORES, ") — the owner-song checks are skipped");

  // ---------------------------------------------------------------- D defaults per device
  if (run("D")) {
    for (const [name, w, h, touch, screen] of [...DEVICES, SPLIT]) {
      const { ctx, page } = await newPage(browser, w, h, errors, { touch, screen });
      const d = await D(page);
      const want = kind(w, h, touch, screen) !== "phone";
      const x = await page.evaluate(() => {
        const b = document.getElementById("keys"), r = b.getBoundingClientRect(), dock = document.getElementById("dock");
        return { pressed: b.getAttribute("aria-pressed"), btn: [r.width, r.height], visible: !!b.offsetParent, dockH: dock.hidden ? 0 : dock.getBoundingClientRect().height, strip: document.getElementById("strip").getBoundingClientRect().height, body: document.body.dataset.keys || null, pref: localStorage.getItem("resonate.play.keys") };
      });
      const kbH = Math.min(110, Math.max(56, 0.09 * h));
      ok(d.keys.on === want && d.keys.shown === want && x.pressed === String(want) && x.pref === null && (want ? x.body === "on" : x.body !== "on"), `D ${name} ${w}×${h}: the keyboard ${want ? "on" : "off"} by default (${JSON.stringify(d.keys)} ${JSON.stringify(x)})`);
      if (want) ok(Math.abs(x.strip - kbH) < 1 && Math.abs(x.dockH - kbH - 12) < 1, `D ${name}: the keys ${x.strip.toFixed(1)} px high (clamp(56, 9vh, 110) = ${kbH.toFixed(1)}), the dock ${x.dockH.toFixed(1)}`);
      ok(x.visible && (touch ? x.btn[0] >= 44 && x.btn[1] >= 44 : x.btn[0] >= 40 && x.btn[1] >= 40), `D ${name}: 🎹 shown, ${x.btn.map(Math.round).join("×")} px`);
      ok(want ? d.keys.range && d.keys.range[0] % 12 === 0 && d.keys.range[1] % 12 === 11 && d.keys.range[0] <= 48 && d.keys.range[1] >= 83 && d.keys.lit.length === 0 : !d.keys.range, `D ${name}: range ${JSON.stringify(d.keys.range)}, idle: nothing lit (${d.keys.lit.length})`);
      if (["air-p", "air-l", "phone-p", "desk"].includes(name)) await page.screenshot({ path: path.join(SHOTS, `D-${name}.png`) });
      await ctx.close();
    }
  }

  // ---------------------------------------------------------------- U the music never under the keyboard
  if (run("U")) {
    const list = [["amazing-grace", "both"]];
    if (K) list.push(["killing", "score"], ["killing", "both"]);
    if (PM) list.push(["pianoman", "score"]);
    for (const [name, w, h, touch, screen] of [...DEVICES, SPLIT]) {
      for (const on of [true, false]) {
        // (no room — under 360 px wide or 500 px tall, a phone in landscape: not shown whatever the pref)
        const shown = on && w >= 360 && h >= 500;
        const { ctx, page } = await newPage(browser, w, h, errors, { touch, screen, before: on ? () => localStorage.setItem("resonate.play.keys", "on") : () => localStorage.setItem("resonate.play.keys", "off") });
        const seeds = [];
        if (K) seeds.push({ name: "killing", xml: read(OWNER("killing")) });
        if (PM) seeds.push({ name: "pianoman", xml: read(OWNER("pianoman")) });
        const ids = { "amazing-grace": "amazing-grace", ...(seeds.length ? await seed(page, seeds) : {}) };
        for (const [song, view] of list) {
          await openSong(page, ids[song], view);
          await toFirst(page);
          let bad = 0, pages = 0, worst = -Infinity;
          for (let k = 0; k < 120; k++) {
            const s = await scene(page);
            pages++;
            const bottom = Math.max(...s.pages.map((p) => p[3]), ...s.systems.map((g) => g[3]));
            worst = Math.max(worst, bottom - s.inner);
            if (bottom > s.inner + 1 || (shown && (!s.dock || s.stage[3] > s.dock[1] + 0.5)) || (!shown && s.dock)) { bad++; if (bad < 3) info(`U ${name} ${song}/${view} keys ${on}: page bottom ${bottom.toFixed(1)} vs stage ${s.inner.toFixed(1)}, dock ${JSON.stringify(s.dock)}`); }
            const before = (await D(page)).page;
            await page.evaluate(() => window.__key("ArrowRight"));
            if ((await D(page)).page === before) break;
          }
          ok(bad === 0, `U ${name} ${w}×${h} ${song}/${view}, keyboard ${on ? "on" : "off"}${on && !shown ? " (no room: not shown)" : ""}: on all ${pages} pages the music inside the stage, the keyboard under it (worst ${worst.toFixed(1)} px from the stage's foot)`);
          if (on && name === "air-l" && song === "killing" && view === "score") { await toFirst(page); await page.screenshot({ path: path.join(SHOTS, `U-${name}-${song}-${view}.png`) }); }
        }
        await ctx.close();
      }
    }
  }

  // ---------------------------------------------------------------- T the toggle
  if (run("T") && K) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await seed(page, [{ name: "killing", xml: read(OWNER("killing")) }]);
    await openSong(page, ids.killing, "score");
    await page.evaluate(() => { window.__key("ArrowRight"); window.__key("ArrowRight"); });
    await sleep(200);
    let d = await D(page);
    const at = d.at, H0 = d.H, page0 = d.page, dockH = d.keys.rect[3];
    const shownBars = () => page.evaluate(() => [...document.querySelectorAll("#stage .page g.measure")].map((m) => Number(/^m(\d+)$/.exec(m.id)?.[1])));
    ok(d.keys.on && page0 === 3, `T Killing's Full score, page 3, the keyboard on (bar ${at})`);
    // off: laid out again in the click (no 150 ms wait), the place kept
    const r = await page.evaluate(() => { document.getElementById("keys").click(); const d = window.resonateDebug().play; return { H: d.H, on: d.keys.on, shown: d.keys.shown, pressed: document.getElementById("keys").getAttribute("aria-pressed"), pref: localStorage.getItem("resonate.play.keys") }; });
    let bars = await shownBars();
    ok(!r.on && !r.shown && r.pressed === "false" && r.pref === "off", `T 🎹 off: hidden, aria-pressed false, pref "off" (${JSON.stringify(r)})`);
    ok(Math.abs(r.H - (H0 + dockH)) <= 1, `T laid out again at once at the stage's new height: ${H0} → ${r.H} (+ the dock's ${dockH.toFixed(1)})`);
    ok(bars.includes(at), `T the place kept: bar ${at} shown (${bars[0]}–${bars[bars.length - 1]}, page ${(await D(page)).page})`);
    await page.screenshot({ path: path.join(SHOTS, "T-off.png") });
    await page.tap("#keys");
    await sleep(100);
    d = await D(page);
    bars = await shownBars();
    ok(d.keys.on && d.keys.shown && d.H === H0 && bars.includes(at) && (await page.evaluate(() => localStorage.getItem("resonate.play.keys"))) === "on", `T 🎹 on again: H ${d.H}, bar ${at} shown, pref "on"`);
    await page.tap("#keys");
    await page.reload(); await ready(page);
    d = await D(page);
    ok(!d.keys.on && !d.keys.shown && d.keys.pref === "off", `T a reload keeps "off" (${JSON.stringify(d.keys)})`);
    await page.tap("#keys");
    await page.reload(); await ready(page);
    d = await D(page);
    ok(d.keys.on && d.keys.shown && d.keys.pref === "on", `T a reload keeps "on"`);
    // a toggle while ▶ plays: it plays on
    await openSong(page, ids.killing, "score");
    await page.tap("#play");
    await until(page, () => window.resonateDebug().play.playback.state === "playing" && window.resonateDebug().play.playback.lit.length > 0);
    await page.tap("#keys"); await sleep(400);
    let p = await PBD(page);
    ok(p.state === "playing" && p.lit.length > 0 && !(await D(page)).keys.shown, `T 🎹 off while ▶ plays: still playing (${p.state}, ${p.lit.length} lit)`);
    await page.tap("#keys"); await sleep(400);
    p = await PBD(page);
    d = await D(page);
    ok(p.state === "playing" && d.keys.shown && d.keys.lit.length > 0, `T 🎹 on while ▶ plays: playing, ${d.keys.lit.length} keys lit at once`);
    await page.tap("#play"); await sleep(200);
    await ctx.close();
    // a phone: off by default; on, reload, off
    {
      const { ctx, page } = await newPage(browser, 390, 844, errors);
      let d = await D(page);
      const H0 = d.H;
      ok(!d.keys.on && !d.keys.shown, "T a phone: off by default");
      await page.tap("#keys"); await ready(page);
      d = await D(page);
      ok(d.keys.on && d.keys.shown && d.H < H0 && d.keys.pref === "on", `T a phone turned on: the music ${H0} → ${d.H} px high`);
      await page.screenshot({ path: path.join(SHOTS, "T-phone-on.png") });
      await page.reload(); await ready(page);
      d = await D(page);
      ok(d.keys.on && d.keys.shown, "T a phone: on after a reload");
      await page.tap("#keys"); await ready(page);
      d = await D(page);
      ok(!d.keys.shown && d.H === H0 && d.keys.pref === "off", `T a phone turned off: ${d.H}`);
      await ctx.close();
    }
  }

  // ---------------------------------------------------------------- S it stays
  if (run("S") && K) {
    for (const [w, h] of [[820, 1180], [1180, 820]]) {
      const { ctx, page } = await newPage(browser, w, h, errors);
      const ids = await seed(page, [{ name: "killing", xml: read(OWNER("killing")) }]);
      await page.evaluate((id) => localStorage.setItem("resonate.sing.timing", JSON.stringify({ [id]: { bpm: 400 } })), ids.killing);
      await openSong(page, ids.killing, "score");
      await page.evaluate(() => { window.__dock.clear(); window.__sampling = true; });
      const draws0 = (await D(page)).keys.draws;
      // a press held, its lift, 2.3 s
      let hs = await heads(page);
      const cdp = await ctx.newCDPSession(page);
      const tp = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) });
      const a = hs[Math.floor(hs.length / 3)], b = hs[Math.floor((2 * hs.length) / 3)];
      await tp("touchStart", [a]); await sleep(400);
      let d = await D(page);
      const pressLit = d.keys.lit.length;
      await tp("touchEnd", []); await sleep(2300);
      // two fingers
      await tp("touchStart", [a]); await sleep(60); await tp("touchStart", [a, b]); await sleep(300);
      d = await D(page);
      const twoLit = d.keys.lit.length;
      await tp("touchEnd", []); await sleep(300);
      // ▶ from the page with auto turns, ■
      await page.tap("#play");
      await until(page, () => window.resonateDebug().play.playback.turns.length >= 2, null, 30000);
      const turns = (await PBD(page)).turns.length;
      await page.tap("#play"); await sleep(300);
      // ‹ ›
      await page.tap("#prev"); await sleep(150); await page.tap("#next"); await sleep(150); await page.tap("#prev"); await sleep(150);
      await toFirst(page); await sleep(150);
      // a stretch, looped, ■
      hs = await heads(page);
      const g = await page.evaluate(() => window.resonateDebug().play.playback.geo());
      const s0 = g[0].systems[1] || g[0].systems[0], pr = g[0].rect;
      const pt = (i) => [pr[0] + (s0.cols[i][1] + s0.cols[i][2]) / 2, pr[1] + s0.top + 0.3 * (s0.bottom - s0.top)];
      await touchPath(ctx, page, line(pt(1), pt(Math.min(6, s0.cols.length - 1)), 10));
      await page.tap("#sel-loop").catch(() => {});
      await until(page, () => window.resonateDebug().play.playback.state === "looping" && window.resonateDebug().play.playback.lit.length > 0);
      await sleep(1500);
      await page.tap("#sel-play").catch(() => {}); await sleep(200);
      // − / +: the music laid out again above it
      await page.tap("#smaller"); await ready(page); await sleep(200);
      await page.tap("#bigger"); await ready(page); await sleep(200);
      const log = await page.evaluate(() => { window.__sampling = false; return [...window.__dock]; });
      const rects = log.filter(([k]) => k !== "over");
      const over = log.find(([k]) => k === "over")?.[1] || 0;
      ok(pressLit > 0 && twoLit >= 2 && turns >= 2, `S ${w}×${h}: a press lit ${pressLit} keys, two fingers ${twoLit}, ▶ turned ${turns} pages`);
      ok(rects.length === 1 && rects[0][0] !== "hidden" && over === 0, `S ${w}×${h}: the keyboard never hid or moved over ${rects.reduce((n, [, c]) => n + c, 0)} frames — presses, lifts, ▶ with auto turns, ■, ‹ ›, a loop, − / + (${JSON.stringify(log)})`);
      info(`S ${w}×${h}: ${(await D(page)).keys.draws - draws0} keyboard drawings`);
      await cdp.detach().catch(() => {});
      await ctx.close();
    }
  }

  // ---------------------------------------------------------------- L lit keys
  if (run("L")) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const seeds = [{ name: "synth-pvg", xml: read(path.join(FIX, "synth-pvg.musicxml")) }];
    if (K) seeds.push({ name: "killing", xml: read(OWNER("killing")) });
    const ids = await seed(page, seeds);
    // the range: Amazing Grace's Both, Right hand, Left hand (whole octaves of the view's notes)
    for (const view of ["both", "rh", "lh"]) {
      await openSong(page, "amazing-grace", view);
      const d = await D(page);
      const want = await page.evaluate(() => { const d = window.resonateDebug().play; const m = d.keep.ids.map((id) => d.facts[id]?.midi).filter(Number.isFinite); return [Math.min(48, 12 * Math.floor(Math.min(...m) / 12)), Math.max(83, 12 * Math.floor(Math.max(...m) / 12) + 11)]; });
      ok(JSON.stringify(d.keys.range) === JSON.stringify(want), `L Amazing Grace ${view}: the keyboard's range ${JSON.stringify(d.keys.range)} = the view's ${JSON.stringify(want)}`);
    }
    // a press: its chord lit, 2.4 s after the lift none
    await openSong(page, ids["synth-pvg"], "both");
    const chord = await page.evaluate(() => {
      const F = window.resonateDebug().play.facts;
      for (const c of document.querySelectorAll("#stage .page g.chord")) {
        const ns = [...c.querySelectorAll("g.note")].map((g) => [g.id, F[g.id]]).filter(([, f]) => f);
        if (ns.length === 3 && ns.every(([, f]) => f.part === "P2" && f.mi === 0 && f.staff === 1)) { const r = c.querySelector("g.notehead").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
      }
      return null;
    });
    ok((await D(page)).keys.lit.length === 0, "L idle: nothing lit");
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: chord.x, y: chord.y }] });
    await sleep(300);
    let d = await D(page);
    const fills = await page.evaluate(() => [...document.querySelectorAll("#strip rect.lit")].map((r) => getComputedStyle(r).fill));
    const letters = await page.evaluate(() => [...document.querySelectorAll("#strip text")].map((t) => t.textContent));
    ok(JSON.stringify(d.keys.lit.map((k) => [k.midi, k.hand]).sort((a, b) => a[0] - b[0])) === JSON.stringify([[63, "rh"], [67, "rh"], [70, "rh"]]) && fills.every((f) => f === "rgb(166, 79, 255)") && letters.length === 3, `L a press lights its chord E♭4 G4 B♭4 in the right hand's colour, named (${JSON.stringify(d.keys.lit)} ${fills} ${letters})`);
    const s = await scene(page);
    ok(s.bubble && s.bubble[3] <= s.stage[3] + 0.5 && s.dock && s.bubble[3] <= s.dock[1], `L the names bubble on the music, clear of the keyboard (${s.bubble?.map(Math.round)} / ${s.dock?.map(Math.round)})`);
    await page.screenshot({ path: path.join(SHOTS, "L-press.png") });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(500);
    ok((await D(page)).keys.lit.length === 3, "L lit a while after the lift");
    await sleep(1900);
    ok((await D(page)).keys.lit.length === 0, "L 2.4 s after the lift: none lit");
    // ▶: the keys lit = what sounds now (sampled)
    if (K) {
      await openSong(page, ids.killing, "score");
      await page.tap("#play");
      await until(page, () => window.resonateDebug().play.playback.lit.length > 0);
      let bad = 0, n = 0;
      for (let i = 0; i < 10; i++) {
        await sleep(270);
        const x = await page.evaluate(() => { const p = window.resonateDebug().play; return { lit: p.playback.lit.slice(), keys: p.keys.lit.map((k) => k.midi).sort((a, b) => a - b), hands: p.keys.lit.map((k) => k.hand) }; });
        const m = await midisOf(page, x.lit);
        n++;
        if (JSON.stringify(m) !== JSON.stringify(x.keys)) { bad++; info("L ▶", JSON.stringify({ m, keys: x.keys })); }
      }
      ok(bad <= 1, `L ▶: the keys lit = the midis sounding (${n - bad} of ${n} samples; a frame apart allowed once)`);
      await page.screenshot({ path: path.join(SHOTS, "L-play.png") });
      // a press during ▶: its keys with ▶'s
      const hs = await heads(page);
      const hd = hs[Math.floor(hs.length / 2)];
      const hm = (await midisOf(page, [hd[2]]))[0];
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: hd[0], y: hd[1] }] });
      await sleep(250);
      d = await D(page);
      const p = await PBD(page);
      const playM = await midisOf(page, p.lit);
      ok(d.keys.lit.some((k) => k.midi === hm) && playM.every((m) => d.keys.lit.some((k) => k.midi === m)), `L a press while ▶ plays: its key ${hm} lit with ▶'s ${JSON.stringify(playM)} (${JSON.stringify(d.keys.lit.map((k) => k.midi))})`);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.tap("#play");
      await sleep(2600);
      d = await D(page);
      ok((await PBD(page)).state === "idle" && d.keys.lit.length === 0, `L ■: nothing lit (${JSON.stringify(d.keys.lit)})`);
    }
    await ctx.close();
  }

  // ---------------------------------------------------------------- P the PDF view
  if (run("P")) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await seed(page, [{ name: "pdfsong", xml: read("/home/user/resonate/public/songs/amazing-grace.musicxml"), pdf: Buffer.from(pdfmini(3)).toString("base64") }]);
    await openSong(page, ids.pdfsong, "both");
    let d = await D(page);
    const H0 = d.H, sp0 = d.sp, at0 = d.at, layout0 = d.t.layout, dockH = d.keys.rect[3];
    await page.tap("#pdf");
    await until(page, () => window.resonateDebug().play.pdf.canvas && !window.resonateDebug().play.pdf.busy);
    await sleep(400);
    d = await D(page);
    const st = await scene(page);
    const cv = await page.evaluate(() => { const r = document.getElementById("pdfview").getBoundingClientRect(); return [r.width, r.height]; });
    ok(!d.keys.shown && (await page.isDisabled("#keys")), `P 📄: the keyboard hidden, 🎹 disabled`);
    ok(Math.abs(st.stage[3] - st.stage[1] - (H0 + dockH)) <= 1.5 && cv[1] > H0 + 1, `P the PDF page gets the height: stage ${(st.stage[3] - st.stage[1]).toFixed(0)} (the sheet's ${H0} + ${dockH.toFixed(0)}), the page ${cv.map(Math.round).join("×")}`);
    ok(d.H === H0 && d.t.layout === layout0, `P the sheet under the PDF isn't laid out again (H ${d.H}, layout ${d.t.layout})`);
    await page.screenshot({ path: path.join(SHOTS, "P-pdf.png") });
    await page.tap("#pdf");
    await sleep(60);
    d = await D(page);
    ok(d.keys.shown && !(await page.isDisabled("#keys")) && d.H === H0 && d.sp === sp0 && d.at === at0 && d.t.layout === layout0, `P back on the sheet: the keyboard back, the music as it was — no new layout (H ${d.H}, sp ${d.sp}, at ${d.at})`);
    // a rotation in the PDF view: laid out at once on the way back
    await page.tap("#pdf");
    await until(page, () => window.resonateDebug().play.pdf.canvas && !window.resonateDebug().play.pdf.busy);
    await page.setViewportSize({ width: 1180, height: 820 });
    await sleep(500);
    await page.tap("#pdf");
    await sleep(60);
    d = await D(page);
    const s2 = await scene(page);
    ok(d.keys.shown && Math.abs(d.H - (s2.inner - s2.stage[1])) <= 1 && d.W > 1000, `P rotated in the PDF view, back: laid out at once for the new stage (H ${d.H}, stage ${(s2.inner - s2.stage[1]).toFixed(0)}, W ${d.W})`);
    await ctx.close();
  }

  // ---------------------------------------------------------------- B the bar
  if (run("B")) {
    // (v78's bar heights, as playbackfixes H: [without, with the chip])
    const V78 = { 300: [165.9, 214.7], 320: [146.5, 195.3], 375: [146.5, 195.3], 390: [146.5, 195.3], 422: [149.7, 149.7], 430: [149.7, 149.7], 440: [149.7, 149.7], 442: [149.7, 149.7], 480: [184.9, 184.9], 626: [115.2, 115.2], 667: [115.2, 115.2], 674: [99.3, 115.2], 744: [99.3, 115.2], 820: [99.3, 115.2], 1024: [99.3, 115.2], 1133: [58.4, 58.4], 1180: [58.4, 58.4] };
    for (const chip of [false, true]) {
      const { ctx, page } = await newPage(browser, 1180, 900, errors, { before: chip ? () => localStorage.setItem("resonate.play", JSON.stringify({ "amazing-grace": { names: "all", days: { n: 5, ask: 3 } } })) : null });
      for (const [w, ref] of Object.entries(V78).map(([w, r]) => [Number(w), r])) {
        await page.setViewportSize({ width: w, height: 900 });
        await sleep(30);
        const x = await page.evaluate(() => { const k = document.getElementById("keys"), r = k.getBoundingClientRect(); return { bar: document.getElementById("bar").getBoundingClientRect().height, keys: k.offsetParent ? [r.width, r.height] : null, hands: document.getElementById("hands").getBoundingClientRect().width, offer: !document.getElementById("offer").hidden }; });
        const want = chip ? ref[1] : ref[0];
        ok(x.bar <= want + 0.5 && x.offer === chip, `B ${w} px${chip ? " with the chip" : ""}: the bar ${x.bar.toFixed(1)} ≤ v78's ${want}`);
        ok(w < 360 ? !x.keys : x.keys && x.keys[0] >= 44 && x.keys[1] >= 44, `B ${w} px: 🎹 ${x.keys ? x.keys.map(Math.round).join("×") : "hidden (under 360 px)"}; the view menu ${Math.round(x.hands)} px`);
        if (!chip && [375, 390, 480, 744, 820, 1180].includes(w)) await page.screenshot({ path: path.join(SHOTS, `B-${w}.png`), clip: { x: 0, y: 0, width: w, height: 200 } });
      }
      await ctx.close();
    }
    if (HEAD_BASE) {
      const W = [300, 320, 340, 360, 375, 390, 402, 414, 420, 421, 428, 440, 460, 479, 480, 507, 540, 600, 626, 667, 669, 670, 694, 700, 740, 744, 800, 820, 900, 1024, 1099, 1100, 1112, 1133, 1140, 1180, 1280, 1366, 1440];
      const heights = async (base, touch, chip) => {
        const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
        if (chip) await ctx.addInitScript(() => localStorage.setItem("resonate.play", JSON.stringify({ "amazing-grace": { names: "all", days: { n: 5, ask: 3 } } })));
        const page = await ctx.newPage();
        await page.goto(base + "play.html");
        await ready(page);
        const out = {};
        for (const w of W) {
          await page.setViewportSize({ width: w, height: 900 });
          for (const pdf of [false, true]) out[w + (pdf ? "+pdf" : "")] = await page.evaluate((pdf) => { document.getElementById("pdf").hidden = !pdf; return document.getElementById("bar").getBoundingClientRect().height; }, pdf);
        }
        await ctx.close();
        return out;
      };
      let worse = [], n = 0;
      for (const touch of [true, false]) for (const chip of [false, true]) {
        const [a, b] = [await heights(HEAD_BASE, touch, chip), await heights(BASE, touch, chip)];
        for (const k of Object.keys(a)) { n++; if (b[k] > a[k] + 0.5) worse.push(`${touch ? "touch" : "mouse"} ${k}${chip ? " chip" : ""}: ${a[k].toFixed(1)} → ${b[k].toFixed(1)}`); }
      }
      ok(worse.length === 0, `B the bar no taller than v79's at ${n} width × chip × 📄 × pointer settings (${worse.slice(0, 6).join("; ")})`);
    }
  }

  await browser.close();
  const real = errors.filter((e) => !/favicon|ERR_|net::/.test(e));
  ok(real.length === 0, `no page errors: ${JSON.stringify(real.slice(0, 5))}`);
  console.log(`playkeys: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
