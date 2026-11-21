// Play page (v79): the default size at the printed page's density, and page turns from ‹ › and keys only.
//
//   S  survey: every device × owner song × view with no size chosen — staff space, pages, systems a
//      page, bars a system, nothing past the stage, no spread; the table (SURVEY=1 prints it all)
//   K  Killing Me Softly's full score on an 11" iPad Air in portrait: the printed page's density
//      (three or four systems a page, 3 bars a system as the median — the print's)
//   Z  − / + as steps from the default (×1.15; the default is step 0), the prefs (resonate.play.zoom
//      / .zoom.score: "+1" …), the old v77–78 prefs removed on load, spreads only with ≥ 110 staff
//      spaces a page, a phone and a desktop
//   T  turns: a tap (outer quarters, middle), a swipe, a drag from a note never turn the page; ‹ ›
//      (≥ 44 px on a touch screen, shown on a phone) and the keys do; the PDF view the same
//   N  small sizes: badge letters ≥ 8 px on the iPad defaults, a finger's press 15–20 px off a head
//      at 6 px still peeks it (the nearest), the Some floor and key marks still drawn
//
// usage: node playpaper.cjs   (BASE=http://localhost:8097/resonate/, PLAY_SCORES=<dir of the owner's
//   converted .musicxml — never copied into the repo>, ONLY=S,K,Z,T,N, DEVS=air-p,…, SHOTS=<dir>,
//   SURVEY=1)
const { chromium } = require("playwright");
const { AG_BOTH } = require("./lib/both.cjs");
const fs = require("fs");
const path = require("path");
const { pdfmini } = require("./pdfmini.cjs");
const BASE = process.env.BASE || "http://localhost:8097/resonate/";
const SCRATCH = "/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad";
const SCORES = process.env.PLAY_SCORES ?? path.join(SCRATCH, "play/scores");
const FIX = path.join(__dirname, "fixtures/play");
const SHOTS = process.env.SHOTS || path.join(SCRATCH, "playshots/paper");
fs.mkdirSync(SHOTS, { recursive: true });
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const run = (s) => !ONLY || ONLY.has(s);
let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) passes++; else { fails++; console.log("FAIL", msg); } };
const info = (...a) => console.log("  ", ...a);
const sleep = (t) => new Promise((r) => setTimeout(r, t));
const read = (f) => fs.readFileSync(f, "utf8");
const OWNER = SCORES && fs.existsSync(SCORES) ? fs.readdirSync(SCORES).filter((f) => f.endsWith(".musicxml") && !/amazing/i.test(f)).map((f) => f.replace(/\.musicxml$/, "")) : [];
const PAPER = 90, SPREAD = 110, STEP = 1.15;
const stepKey = (n) => (n ? (n > 0 ? "+" : "") + n : null);
// [name, w, h, touch]
const DEVICES = [
  ["air-p", 820, 1180, true], ["air-l", 1180, 820, true], ["mini-p", 744, 1133, true], ["mini-l", 1133, 744, true],
  ["13-p", 1024, 1366, true], ["13-l", 1366, 1024, true], ["phone-p", 390, 844, true], ["phone-l", 844, 390, true],
  ["desk", 1440, 900, false], ["desk-s", 1100, 760, false],
].filter(([n]) => !process.env.DEVS || process.env.DEVS.split(",").includes(n));

function INIT() {
  try { if (!navigator.audioSession) Object.defineProperty(navigator, "audioSession", { configurable: true, value: { type: "auto" } }); } catch {}
  window.__key = (key) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}
const D = (page) => page.evaluate(() => { const d = window.resonateDebug?.().play; if (!d) return null; const { facts, countAll, ...rest } = d; return rest; });
const ready = (page, song, view) => page.waitForFunction(([s, v]) => { const d = window.resonateDebug?.().play; return d && d.ready && (!s || d.song === s) && (!v || d.view === v); }, [song, view], { timeout: 120000 });
async function newPage(browser, w, h, errors, touch = true, before) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  await ctx.addInitScript(INIT);
  if (before) await ctx.addInitScript(before);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror " + e.message));
  page.on("console", (m) => { const t = m.text(); if (m.type() === "error") errors.push("console.error " + t.slice(0, 200)); else if (m.type() === "warning" && /^(song|music engine|loadData|pdf|piano)\b/.test(t)) errors.push("console.warn " + t.slice(0, 200)); });
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
// A score's bars three times over in every part (numbered on), for a song longer than a fixture.
const thrice = (xml) => xml.replace(/(<part id="[^"]+">)([\s\S]*?)(<\/part>)/g, (m, open, body, close) => {
  const n = (body.match(/<measure /g) || []).length;
  const again = (k) => body.replace(/<measure number="(\d+)"/g, (x, num) => `<measure number="${Number(num) + k * n}"`);
  return open + body + again(1) + again(2) + close;
});
const songList = (names) => names.map((n) => ({ name: n, xml: read(fs.existsSync(path.join(FIX, n + ".musicxml")) ? path.join(FIX, n + ".musicxml") : path.join(SCORES, n + ".musicxml")) }));
async function openSong(page, id, view) {
  if ((await D(page)).song !== id) { await page.selectOption("#song", id); await ready(page, id); }
  if (view && (await D(page)).view !== view) { await page.selectOption("#hands", view); await ready(page, id, view); }
}
// Every page from the first: systems (with their bars' written numbers), the lowest ink's bottom
// (share of the stage height), the page's right edge vs the stage
async function pagesOf(page) {
  await page.evaluate(() => { for (let i = 0; i < 400 && window.resonateDebug().play.page > 1; i++) window.__key("ArrowLeft"); });
  const rows = [];
  for (let guard = 0; guard < 400; guard++) {
    rows.push(...(await page.evaluate(() => {
      const st = document.getElementById("stage").getBoundingClientRect();
      return [...document.querySelectorAll("#stage .page")].map((pg) => {
        const sys = [...pg.querySelectorAll("g.system")];
        let bottom = 0, right = 0;
        for (const g of pg.querySelectorAll("g.system")) { const b = g.getBoundingClientRect(); bottom = Math.max(bottom, b.bottom); right = Math.max(right, b.right); }
        return {
          n: sys.length, bars: sys.map((s) => [...s.querySelectorAll("g.measure")].map((m) => (/^m(\d+)$/.exec(m.id) || [])[1]).filter(Boolean).map(Number)),
          fill: (bottom - st.top) / st.height, over: bottom - st.bottom, overR: right - st.right,
        };
      });
    })));
    const before = (await D(page)).page;
    await page.evaluate(() => window.__key("ArrowRight"));
    if ((await D(page)).page === before) break;
  }
  await page.evaluate(() => { for (let i = 0; i < 400 && window.resonateDebug().play.page > 1; i++) window.__key("ArrowLeft"); });
  return rows;
}
const share2 = (rows) => { const j = rows.length > 1 ? rows.slice(0, -1) : rows; return j.filter((r) => r.n >= 2).length / Math.max(1, j.length); };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

// ---------------------------------------------------------------------------------------------
// S + K: the survey (and Killing Me Softly's first page)

async function partS(browser) {
  console.log("== S survey: the default on every device, song and view");
  const errors = [];
  const songs = ["amazing-grace", "synth-pvg", ...OWNER];
  const table = [];
  for (const [dev, w, h, touch] of DEVICES) {
    const { ctx, page } = await newPage(browser, w, h, errors, touch);
    const ids = { "amazing-grace": "amazing-grace", ...(await seed(page, songList(songs.filter((s) => s !== "amazing-grace")))) };
    for (const name of songs) {
      await openSong(page, ids[name]);
      const views = (await D(page)).views;
      for (const view of views) {
        await openSong(page, ids[name], view);
        const d = await D(page);
        const rows = await pagesOf(page);
        const bars = rows.flatMap((r) => r.bars.map((b) => b.length));
        const two = share2(rows), over = Math.max(...rows.map((r) => r.over)), overR = Math.max(...rows.map((r) => r.overR));
        const row = { dev, name, view, sp: Math.round(d.sp * 100) / 100, base: Math.round(d.base * 100) / 100, mode: d.mode, pages: d.pages, two: Math.round(100 * two), sysMed: median(rows.map((r) => r.n)), barsMed: median(bars), barsPage: (bars.reduce((a, b) => a + b, 0) / Math.max(1, rows.length)).toFixed(1), fill: Math.round(100 * median(rows.slice(0, -1).map((r) => r.fill))), spread: d.spread, tried: d.fitLog.length, fitMs: d.t.fit ?? null };
        table.push(row);
        if (process.env.SURVEY) console.log(JSON.stringify(row));
        const tag = `S ${dev} ${name}/${view}`;
        ok(!d.spread, `${tag}: no spread at the default`);
        ok(d.sizeAuto && d.size == null, `${tag}: no size chosen`);
        ok(over <= 2 && overR <= 2, `${tag}: nothing past the stage (bottom ${over.toFixed(1)}, right ${overR.toFixed(1)})`);
        if (touch && Math.min(w, h) >= 700) {
          // the printed density across the width; two systems a page where the stage allows, else one
          const paper = Math.max(5, w / PAPER);
          ok(d.base <= paper + 0.01 && (d.base >= paper - 0.01 || Math.abs(d.base - d.cap) < 0.01), `${tag}: the default from ${paper.toFixed(2)} (base ${d.base}, cap ${d.cap.toFixed(2)})`);
          // (v80: with the keyboard docked under the music the floor shrinks with the stage)
          const room = d.keys?.shown ? d.H / (d.H + d.keys.rect[3]) : 1;
          const floor = room * Math.min(d.base, (0.9 * Math.min(w, h)) / PAPER);
          if (h > w) ok(Math.abs(d.sp - d.base) < 0.01, `${tag}: portrait at the printed density (sp ${d.sp}, base ${d.base})`);
          else ok(d.mode === "one" ? Math.abs(d.sp - d.base) < 0.01 : d.sp >= floor - 0.01 && d.sp <= d.base + 0.01, `${tag}: landscape ${d.mode} at ${d.sp} (base ${d.base}, floor ${floor.toFixed(2)})`);
          if (d.mode !== "one" && rows.length > 1) ok(two >= 0.75, `${tag}: two systems on ${Math.round(100 * two)}% of the pages`);
        } else if (!touch) {
          ok(d.base >= 9.5 - 0.01 && d.base <= 12.5 + 0.01, `${tag}: desktop default ${d.base} within 9.5–12.5`);
        } else if (view !== "score") ok(Math.abs(d.sp - Math.min(9.5, d.cap)) < 0.01, `${tag}: a phone at 9.5 or what fits (${d.sp})`);
        if (["air-p", "air-l", "mini-p", "13-l", "phone-p", "desk"].includes(dev) && ["killing", "pianoman", "amazing-grace", "longest"].includes(name) && ["score", "both"].includes(view)) {
          await page.screenshot({ path: path.join(SHOTS, `S-${dev}-${name}-${view}.png`) });
        }
        // K: Killing Me Softly's full score on the Air in portrait = the printed page's first systems
        if (dev === "air-p" && name === "killing" && view === "score") {
          const first = rows[0].bars.map((b) => `${b[0] + 1}–${b[b.length - 1] + 1}`);
          info(`K killing score air-p: sp ${d.sp}, page 1 systems ${first.join(" | ")}, ${d.pages} pages`);
          ok(rows[0].bars[0][0] === 0 && rows[0].bars[0].length >= 2 && rows[0].bars[0].length <= 3, `K the first system holds bars 1–2 or 1–3 (${first[0]})`);
          ok(rows[0].n >= 3 && rows[0].n <= 4, `K three or four systems a page (${rows[0].n})`);
          ok(median(bars) === 3, `K 3 bars a system, the print's median (median ${median(bars)})`);
        }
      }
    }
    await ctx.close();
  }
  // the table: one line per device / song, the views side by side (sp · systems a page · bars a system)
  console.log("\n   sizes chosen (staff space px · median systems a page · median bars a system; * one system a page)");
  const views = ["score", "both", "rh", "lh", "melody"];
  console.log("   " + "device".padEnd(8) + "song".padEnd(15) + views.map((v) => v.padEnd(15)).join(""));
  for (const [dev] of DEVICES) for (const name of songs) {
    const cell = (v) => { const r = table.find((x) => x.dev === dev && x.name === name && x.view === v); return (r ? `${r.sp}${r.mode === "one" ? "*" : ""} ·${r.sysMed}·${r.barsMed}` : "—").padEnd(15); };
    console.log("   " + dev.padEnd(8) + name.padEnd(15) + views.map(cell).join(""));
  }
  fs.writeFileSync(path.join(SHOTS, "survey.json"), JSON.stringify(table, null, 1));
  ok(!errors.length, `S no page errors ${errors.slice(0, 3)}`);
}

// ---------------------------------------------------------------------------------------------
// Z: − / +, prefs, spreads, phone, desktop

// (Z is the piano views' sizes, resonate.play.zoom: Amazing Grace in Both — AG_BOTH, lib/both.cjs; E1
// opens a song with no view chosen in the Full score, whose size is its own)

async function partZ(browser) {
  console.log("== Z − / +, prefs, spreads");
  const errors = [];
  // the old prefs (v77–78's sizes) are ignored; − / + steps from the default
  {
    const { ctx, page } = await newPage(browser, 820, 1180, errors, true, () => {
      if (!sessionStorage.getItem("seeded")) {
        sessionStorage.setItem("seeded", "1"); localStorage.setItem("resonate.play.size", "16"); localStorage.setItem("resonate.play.size.score", "14");
        localStorage.setItem("resonate.play", JSON.stringify({ "amazing-grace": { view: "both" } })); // (Both, as AG_BOTH)
      }
    });
    let d = await D(page);
    const auto = 820 / PAPER;
    ok(d.sizeAuto && Math.abs(d.sp - auto) < 0.01, `Z a v78 device with 16 saved starts at the default (${d.sp})`);
    const pg0 = d.pages;
    await page.click("#smaller");
    await ready(page);
    d = await D(page);
    ok(d.step === -1 && Math.abs(d.sp - auto / STEP) < 0.01 && !d.sizeAuto, `Z − from ${auto.toFixed(2)} → ${d.sp} (step ${d.step})`);
    ok((await page.evaluate(() => localStorage.getItem("resonate.play.zoom"))) === "-1", "Z kept as resonate.play.zoom");
    ok(d.pages <= pg0, `Z smaller: ${d.pages} pages (from ${pg0})`);
    const downs = [];
    for (let i = 0; i < 10 && !(await page.isDisabled("#smaller")); i++) { await page.click("#smaller"); await ready(page); d = await D(page); downs.push(d.sp); }
    ok(Math.abs(d.sp - 5) < 0.01 && downs.every((x, i) => i === 0 || x < downs[i - 1]), `Z − down to 5 (${downs.map((x) => x.toFixed(2))})`);
    ok(await page.isDisabled("#smaller"), "Z − disabled at 5");
    const ups = [];
    for (let i = 0; i < 10 && (await D(page)).step < 0; i++) { await page.click("#bigger"); await ready(page); d = await D(page); ups.push(d.sp); }
    ok(d.step === 0 && Math.abs(d.sp - auto) < 1e-6 && (await page.evaluate(() => localStorage.getItem("resonate.play.zoom"))) === null, `Z + back up to the default exactly (${ups.map((x) => x.toFixed(2))}), the pref gone`);
    await page.click("#bigger"); await ready(page);
    await page.reload(); await ready(page);
    d = await D(page);
    ok(d.step === 1 && Math.abs(d.sp - auto * STEP) < 0.01, `Z a reload keeps one step over (${d.sp})`);
    // the score keeps its own
    await page.selectOption("#hands", "score").catch(() => {});
    if ((await D(page)).views.includes("score")) {
      await ready(page, null, "score");
      ok((await D(page)).sizeAuto, "Z the score: its own pref (still the default)");
    }
    await page.evaluate(() => localStorage.removeItem("resonate.play.zoom"));
    await ctx.close();
  }
  // + / − from the default, the mini and a 13"
  for (const [w, h] of [[744, 1133], [1024, 1366]]) {
    const { ctx, page } = await newPage(browser, w, h, errors, true, AG_BOTH);
    let d = await D(page);
    const base = d.sp;
    await page.click("#bigger"); await ready(page); d = await D(page);
    ok(Math.abs(d.sp - Math.min(d.cap, base * STEP)) < 0.01, `Z ${w}x${h}: + from ${base} → ${d.sp}`);
    await page.evaluate(() => localStorage.removeItem("resonate.play.zoom"));
    await page.reload(); await ready(page);
    await page.click("#smaller"); await ready(page); d = await D(page);
    ok(Math.abs(d.sp - base / STEP) < 0.01, `Z ${w}x${h}: − from ${base} → ${d.sp}`);
    await page.evaluate(() => localStorage.removeItem("resonate.play.zoom"));
    await ctx.close();
  }
  for (const [w, h] of [[1180, 820], [1366, 1024], [1133, 744]]) {
    const { ctx, page } = await newPage(browser, w, h, errors);
    // (a song long enough for two pages at 5: a one-page view is laid out full width, no spread — the
    // owner's Piano Man, else synth-pvg's 40 bars three times over: synth-pvg alone is one page at 5)
    const long = OWNER.includes("pianoman") ? "pianoman" : "synth-pvg-x3";
    const ids = await seed(page, long === "pianoman" ? songList([long]) : [{ name: long, xml: thrice(read(path.join(FIX, "synth-pvg.musicxml"))) }]);
    await openSong(page, ids[long], "both");
    let d = await D(page);
    ok(!d.spread, `Z ${w}x${h}: the default, one page across (${d.sp})`);
    const seen = [];
    for (let i = 0; i < 12 && !(await page.isDisabled("#smaller")); i++) {
      await page.click("#smaller"); await ready(page); d = await D(page);
      const each = (d.spread ? Math.floor(d.W / 2) : d.W) / d.sp;
      seen.push(`${d.sp}${d.spread ? "s" : ""}`);
      ok(d.spread === (d.pages > 1 && d.W / 2 / d.size >= SPREAD) || (!d.spread && d.pages === 1), `Z ${w}x${h} at ${d.sp}: spread ${d.spread} (${Math.round(each)} staff spaces a page, ${d.pages} pages)`);
    }
    info(`Z ${w}x${h} −: ${seen.join(" ")}`);
    ok(seen.some((s) => s.endsWith("s")) === (w / 2 / 5 >= SPREAD), `Z ${w}x${h}: a spread only zoomed well out (${seen.join(" ")})`);
    if (seen.some((s) => s.endsWith("s"))) await page.screenshot({ path: path.join(SHOTS, `Z-spread-${w}x${h}.png`) });
    for (let i = 0; i < 14 && !(await page.isDisabled("#bigger")); i++) { await page.click("#bigger"); await ready(page); }
    d = await D(page);
    ok(d.sp >= d.cap - 0.01 || d.step === 8, `Z ${w}x${h}: + stops at the cap (${d.sp}, cap ${d.cap.toFixed(2)}, step ${d.step})`);
    await ctx.close();
  }
  // a phone: 9.5 as before (+/− steps from it); a desktop: 9.5–12.5
  {
    const { ctx, page } = await newPage(browser, 390, 844, errors, true, AG_BOTH);
    let d = await D(page);
    ok(d.device === "phone" && d.sp === 9.5 && d.view === "both", `Z a phone: ${d.device} ${d.sp} (${d.view})`);
    await page.click("#smaller"); await ready(page); d = await D(page);
    ok(Math.abs(d.sp - 9.5 / STEP) < 0.01, `Z a phone: − → ${d.sp}`);
    await ctx.close();
  }
  for (const [w, h] of [[1440, 900], [1100, 760], [900, 700]]) {
    const { ctx, page } = await newPage(browser, w, h, errors, false, AG_BOTH);
    const d = await D(page);
    const want = Math.min(12.5, Math.max(9.5, d.W / PAPER));
    ok(d.device === "desktop" && Math.abs(d.base - want) < 0.01, `Z desktop ${w}x${h}: base ${d.base} (want ${want}), sp ${d.sp}`);
    await ctx.close();
  }
  ok(!errors.length, `Z no page errors ${errors.slice(0, 3)}`);
}

// ---------------------------------------------------------------------------------------------
// T: turns

async function partT(browser) {
  console.log("== T turns: ‹ › and keys only");
  const errors = [];
  for (const [w, h] of [[820, 1180], [1180, 820], [390, 844]]) {
    const { ctx, page } = await newPage(browser, w, h, errors);
    const ids = await seed(page, songList(["synth-pvg"]));
    await openSong(page, ids["synth-pvg"], "both");
    // a size with a few pages
    for (let i = 0; i < 4 && (await D(page)).pages < 3 && !(await page.isDisabled("#bigger")); i++) { await page.click("#bigger"); await ready(page); }
    let d = await D(page);
    const tag = `T ${w}x${h}`;
    ok(d.pages >= 2, `${tag}: ${d.pages} pages to turn`);
    const pg = async () => (await D(page)).page;
    const step = d.spread ? 2 : 1;
    // taps at 0.9 / 0.1 / 0.5 W, ≥ 40 px from every head; a swipe; a drag from a note
    const spot = (fx) => page.evaluate((fx) => {
      const st = document.getElementById("stage").getBoundingClientRect();
      const heads = [...document.querySelectorAll("#stage g.note > g.notehead")].map((h) => { const b = h.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
      const x = st.left + st.width * fx;
      for (let y = st.top + 20; y < st.bottom - 20; y += 5) if (heads.every(([hx, hy]) => Math.hypot(hx - x, hy - y) >= 40)) return { x, y };
      return null;
    }, fx);
    for (const fx of [0.92, 0.08, 0.5]) {
      const s = await spot(fx);
      if (!s) { ok(false, `${tag}: no paper at ${fx} W`); continue; }
      await page.touchscreen.tap(s.x, s.y);
      await sleep(80);
      ok((await pg()) === 1, `${tag}: a tap at ${fx} W doesn't turn (${await pg()})`);
    }
    const cdp = await ctx.newCDPSession(page);
    const swipe = async (x0, y0, dx) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
      for (let i = 1; i <= 6; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + (dx * i) / 6, y: y0 + i }] }); await sleep(14); }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await sleep(100);
    };
    await swipe(w * 0.7, h * 0.6, -160);
    ok((await pg()) === 1, `${tag}: a swipe left doesn't turn (${await pg()})`);
    await page.click("#next");
    ok((await pg()) === 1 + step, `${tag}: › turns (${await pg()})`);
    await swipe(w * 0.3, h * 0.6, 160);
    ok((await pg()) === 1 + step, `${tag}: a swipe right doesn't turn back (${await pg()})`);
    const head = await page.evaluate(() => { const b = document.querySelector("#stage g.note > g.notehead").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    const n0 = (await D(page)).peekLog.length;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: head.x, y: head.y }] });
    await sleep(60);
    for (let i = 1; i <= 6; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: head.x - 22 * i, y: head.y + 1 }] }); await sleep(12); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(150);
    d = await D(page);
    ok(d.page === 1 + step && !d.peek, `${tag}: a drag from a note doesn't turn, no peek left (${d.page})`);
    ok(d.peekLog.slice(n0).every((x) => x.cut), `${tag}: the drag cut the note ${JSON.stringify(d.peekLog.slice(n0))}`);
    await page.click("#prev");
    ok((await pg()) === 1, `${tag}: ‹ turns back (${await pg()})`);
    ok(await page.isDisabled("#prev"), `${tag}: ‹ disabled on page 1`);
    ok(await page.evaluate(() => !document.activeElement || !document.activeElement.matches("button, select")), `${tag}: ‹ › leave no focus`);
    // the buttons: shown, ≥ 44 px, inside the bar, nothing past the screen
    const b = await page.evaluate(() => ["prev", "next"].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { w: r.width, h: r.height, in: r.left >= 0 && r.right <= innerWidth && r.bottom <= document.getElementById("bar").getBoundingClientRect().bottom + 1 }; }).concat([{ sw: document.scrollingElement.scrollWidth, iw: innerWidth }]));
    ok(b[0].w >= 44 && b[0].h >= 44 && b[1].w >= 44 && b[1].h >= 44 && b[0].in && b[1].in && b[2].sw <= b[2].iw, `${tag}: ‹ › ${Math.round(b[0].w)}×${Math.round(b[0].h)} in the bar (${JSON.stringify(b)})`);
    // keys: forward / back, the end, no wrap
    for (const [k, want] of [["ArrowRight", 1 + step], ["ArrowLeft", 1], ["PageDown", 1 + step], ["PageUp", 1], [" ", 1 + step], ["Backspace", 1], ["Enter", 1 + step], ["ArrowUp", 1], ["ArrowDown", 1 + step]]) {
      await page.evaluate((k) => window.__key(k), k);
      ok((await pg()) === want, `${tag}: key ${JSON.stringify(k)} → ${await pg()} (want ${want})`);
    }
    await page.screenshot({ path: path.join(SHOTS, `T-bar-${w}x${h}.png`), clip: { x: 0, y: 0, width: w, height: 200 } });
    await ctx.close();
  }
  // the PDF view: ‹ › and keys turn it, a tap or a swipe doesn't
  {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await seed(page, [{ name: "pdf-song", xml: read(path.join(FIX, "synth-pvg.musicxml")), pdf: Buffer.from(pdfmini(3)).toString("base64") }]);
    await openSong(page, ids["pdf-song"]);
    await page.waitForFunction(() => !document.getElementById("pdf").hidden, null, { timeout: 10000 });
    await page.click("#pdf");
    const pdfReady = (p) => page.waitForFunction((p) => { const x = window.resonateDebug().play.pdf; return x.on && !x.busy && x.canvas && (!p || x.page === p); }, p, { timeout: 30000 });
    await pdfReady(1);
    const tapX = async (fx) => { const s = await page.evaluate(() => { const r = document.getElementById("stage").getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }); await page.touchscreen.tap(s[0] + s[2] * fx, s[1] + s[3] * 0.5); await sleep(200); };
    await tapX(0.92);
    ok((await D(page)).pdf.page === 1, `T PDF: a tap at the right doesn't turn (${(await D(page)).pdf.page})`);
    await page.click("#next"); await pdfReady(2);
    ok((await D(page)).pdf.page === 2, "T PDF: › turns");
    await tapX(0.08);
    ok((await D(page)).pdf.page === 2, "T PDF: a tap at the left doesn't turn back");
    await page.evaluate(() => window.__key("ArrowRight")); await pdfReady(3);
    ok((await D(page)).pdf.page === 3, "T PDF: a key turns");
    await page.click("#prev"); await pdfReady(2);
    ok((await D(page)).pdf.page === 2, "T PDF: ‹ turns back");
    await ctx.close();
  }
  ok(!errors.filter((e) => !/pdf|PDF|Invalid|XRef|Pages tree/i.test(e)).length, `T no page errors ${errors.slice(0, 3)}`);
}

// ---------------------------------------------------------------------------------------------
// N: small sizes — badges, peeks, the Some floor, key marks

async function partN(browser) {
  console.log("== N small sizes");
  const errors = [];
  const songs = ["synth-pvg", ...OWNER];
  // (− three steps from 9.11: 5.99 px; five: 5, the smallest)
  for (const [w, h, size] of [[820, 1180, null], [744, 1133, null], [820, 1180, "-3"], [820, 1180, "-5"]]) {
    const { ctx, page } = await newPage(browser, w, h, errors, true, size ? `(() => { localStorage.setItem("resonate.play.zoom", "${size}"); localStorage.setItem("resonate.play.zoom.score", "${size}"); })()` : undefined);
    const ids = await seed(page, songList(songs));
    for (const name of songs) for (const view of ["score", "both"]) {
      await openSong(page, ids[name]);
      if (!(await D(page)).views.includes(view)) continue;
      await openSong(page, ids[name], view);
      const d = await D(page);
      const tag = `N ${w}x${h}${size ? "@" + size : ""} ${name}/${view} (sp ${d.sp})`;
      // badge letters: their size on screen (all shown)
      // (a chord's seconds and thirds keep small pills — 1.05 × the head: left out)
      const r = await page.evaluate(() => {
        const fs = [...document.querySelectorAll("#stage .nn")].filter((n) => {
          const head = n.parentNode.querySelector(":scope > g.notehead").getBBox(), pill = n.querySelector("rect");
          return Number(pill.getAttribute("height")) > 1.2 * head.height;
        }).map((n) => { const x = n.querySelector("text"); return Number(x.getAttribute("font-size")) * (x.getScreenCTM()?.d || 1); });
        return { n: fs.length, fs: fs.sort((a, b) => a - b) };
      });
      const lo = r.fs[Math.floor(r.fs.length * 0.1)] || 0, med = r.fs[r.fs.length >> 1] || 0;
      if (!size) ok(med >= 7.9 && lo >= 7.4, `${tag}: badge letters ${med.toFixed(1)} px (10th pct ${lo.toFixed(1)}; ${r.n} not in dense chords)`);
      info(`${tag}: badge letters median ${med.toFixed(1)} px, 10th pct ${lo.toFixed(1)}`);
      // overlapping pills: two badges of different heads whose pills cross by > 25% of the smaller
      // (two voices' unison — one head drawn twice — has its name twice in one place: one pill to
      // the eye, the same letter; not a clash — Killing's bars 6–8, at every size)
      const clash = await page.evaluate(() => {
        const R = [...document.querySelectorAll("#stage .nn")].map((n) => ({ b: n.querySelector("rect").getBoundingClientRect(), t: n.textContent }));
        let n = 0;
        for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
          const a = R[i].b, b = R[j].b, ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (R[i].t === R[j].t && ix * iy > 0.9 * Math.min(a.width * a.height, b.width * b.height)) continue;
          if (ix > 0 && iy > 0 && ix * iy > 0.25 * Math.min(a.width * a.height, b.width * b.height)) n++;
        }
        return { n, of: R.length };
      });
      info(`${tag}: ${clash.n} overlapping pill pairs of ${clash.of}`);
      ok(clash.n <= Math.max(2, 0.03 * clash.of), `${tag}: pills overlap ${clash.n} of ${clash.of}`);
      // a finger 15–18 px off a head (on paper, away from others' nearer heads) peeks that head
      if (name === "synth-pvg" || name === "killing") {
        const target = await page.evaluate(() => {
          const H = [...document.querySelectorAll("#stage g.note")].filter((g) => g.querySelector(":scope > g.notehead") && g.getAttribute("visibility") !== "hidden").map((g) => { const b = g.querySelector(":scope > g.notehead").getBoundingClientRect(); return { id: g.id, x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
          for (const h of H) for (const [dx, dy] of [[0, -17], [0, 17], [-16, 0], [16, -6]]) {
            const p = { x: h.x + dx, y: h.y + dy };
            const near = H.map((o) => [Math.hypot(o.x - p.x, o.y - p.y), o]).sort((a, b) => a[0] - b[0]);
            if (near[0][1] === h && (near.length < 2 || near[1][0] > near[0][0] + 4)) return { id: h.id, x: p.x, y: p.y, d: near[0][0] };
          }
          return null;
        });
        if (!target) ok(false, `${tag}: no lone head to aim near`);
        else {
          const cdp = await ctx.newCDPSession(page);
          await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: target.x, y: target.y }] });
          await page.waitForFunction(() => window.resonateDebug().play.peek, null, { timeout: 3000 }).catch(() => {});
          const pk = (await D(page)).peek;
          await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await sleep(100);
          ok(pk && pk.ids.includes(target.id), `${tag}: a press ${target.d.toFixed(0)} px off ${target.id} peeks it (${pk?.ids})`);
          await page.evaluate(() => window.__key("ArrowLeft"));
        }
      }
      if (name === "killing" || name === "synth-pvg") await page.screenshot({ path: path.join(SHOTS, `N-${w}x${h}${size ? "-" + size : ""}-${name}-${view}.png`) });
      // the Some floor and the key marks still come out
      await page.evaluate(() => { const b = document.getElementById("names"); for (let i = 0; i < 3 && window.resonateDebug().play.names !== "some"; i++) b.click(); });
      const some = await page.evaluate(() => ({ shown: [...document.querySelectorAll("#stage .nn")].filter((n) => getComputedStyle(n).display !== "none").length, km: document.querySelectorAll("#stage .km").length, kmBlocked: document.querySelectorAll("#stage [data-km=blocked]").length }));
      ok(some.shown > 0, `${tag}: Some names ${some.shown} (marks ${some.km}, ${some.kmBlocked} blocked)`);
      await page.evaluate(() => { const b = document.getElementById("names"); for (let i = 0; i < 3 && window.resonateDebug().play.names !== "all"; i++) b.click(); });
    }
    await ctx.close();
  }
  ok(!errors.length, `N no page errors ${errors.slice(0, 3)}`);
}

(async () => {
  const browser = await chromium.launch();
  const t0 = Date.now();
  try {
    if (run("S") || run("K")) await partS(browser);
    if (run("Z")) await partZ(browser);
    if (run("T")) await partT(browser);
    if (run("N")) await partN(browser);
  } catch (e) { fails++; console.log("FAIL exception", e.stack || e); }
  await browser.close();
  console.log(`\nplaypaper: ${passes} passed, ${fails} failed (${Math.round((Date.now() - t0) / 1000)} s)`);
  process.exit(fails ? 1 : 0);
})();
