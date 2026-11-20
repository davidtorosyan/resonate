// Play page core (play.html + play.js): layout, paging, anchor, size, hands, names, wake lock,
// at the iPad / Split View / phone sizes, with screenshots.
// usage: node playcore.cjs [quick]   (BASE=http://localhost:8097/resonate/, SHOTS=<dir>, PLAY_SCORES=<dir>)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8097/resonate/";
const SCRATCH = "/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad";
const SCORES = process.env.PLAY_SCORES ?? path.join(SCRATCH, "play/scores");
const SHOTS = process.env.SHOTS || path.join(SCRATCH, "playshots");
const FIX = path.join(__dirname, "fixtures/play");
fs.mkdirSync(SHOTS, { recursive: true });

let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) passes++; else { fails++; console.log("FAIL", msg); } };
const SIZES = [[820, 1180], [1024, 1366], [1366, 1024], [1180, 820], [507, 1180], [390, 844]];

const WAKE_STUB = () => {
  window.__wake = { requests: 0, released: 0 };
  const req = async () => {
    window.__wake.requests++;
    const s = { released: false, type: "screen", _l: [], addEventListener(t, f) { this._l.push(f); }, async release() { this.released = true; window.__wake.released++; } };
    return s;
  };
  try { Object.defineProperty(navigator, "wakeLock", { value: { request: req }, configurable: true }); } catch {}
};

async function newPage(browser, w, h, errors) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  await ctx.addInitScript(WAKE_STUB);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console ${m.text()}`); });
  return { ctx, page };
}
const dbg = (page) => page.evaluate(() => { const d = window.resonateDebug?.().play; if (!d) return null; const { facts, countAll, ...rest } = d; return rest; });
const waitReady = (page, song) => page.waitForFunction((s) => { const d = window.resonateDebug?.().play; return d && d.ready && (!s || d.song === s); }, song, { timeout: 60000 });

async function seed(page, list) {
  return page.evaluate(async (list) => {
    const L = await import("./library.js?v=76");
    const ids = {};
    for (const { name, xml, source } of list) ids[name] = await L.addSong(name, xml, { source });
    return ids;
  }, list);
}
const read = (f) => fs.readFileSync(f, "utf8");

async function layoutChecks(page, tag) {
  const r = await page.evaluate(() => {
    const out = { sw: document.scrollingElement.scrollWidth, iw: innerWidth, ih: innerHeight, out: [] };
    for (const el of document.querySelectorAll("#bar select, #bar button, #bar a, #version, #pg")) {
      const cs = getComputedStyle(el);
      if (el.hidden || cs.display === "none") continue;
      const b = el.getBoundingClientRect();
      if (b.left < -0.5 || b.right > innerWidth + 0.5 || b.top < -0.5 || b.bottom > innerHeight + 0.5) out.out.push(el.id || el.textContent);
      if ((el.tagName === "BUTTON" || el.tagName === "SELECT") && b.height < 39.5) out.out.push("short:" + (el.id || el.textContent) + ":" + b.height);
    }
    out.bar = Math.round(document.getElementById("bar").getBoundingClientRect().height);
    const st = document.getElementById("stage").getBoundingClientRect();
    out.stage = [Math.round(st.width), Math.round(st.height)];
    out.pages = [...document.querySelectorAll("#stage .page")].map((p) => { const b = p.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.width), Math.round(b.height)]; });
    return out;
  });
  ok(r.sw <= r.iw, `${tag}: no horizontal overflow (${r.sw} > ${r.iw})`);
  ok(!r.out.length, `${tag}: bar controls inside the viewport and ≥ 40 px: ${r.out.join(", ")}`);
  return r;
}

(async () => {
  const quick = process.argv[2] === "quick";
  const browser = await chromium.launch();
  const scores = fs.existsSync(SCORES) ? fs.readdirSync(SCORES).filter((f) => /\.musicxml$/.test(f) && !/amazing/.test(f)) : [];
  const fixtures = fs.readdirSync(FIX).filter((f) => /\.musicxml$/.test(f));
  const list = [
    ...fixtures.map((f) => ({ name: f.replace(/\.musicxml$/, ""), xml: read(path.join(FIX, f)), source: "file" })),
    ...scores.map((f) => ({ name: f.replace(/\.musicxml$/, ""), xml: read(path.join(SCORES, f)), source: "pdf" })),
  ];

  // ---- every size: Amazing Grace + Piano Man (+ Songbird) — layout, counts, shots
  for (const [w, h] of quick ? SIZES.slice(0, 1) : SIZES) {
    const errors = [];
    const { ctx, page } = await newPage(browser, w, h, errors);
    await page.goto(BASE + "play.html");
    await waitReady(page, "amazing-grace");
    const ids = await seed(page, list);
    await page.reload();
    await waitReady(page, "amazing-grace");
    let d = await dbg(page);
    ok(d.counts.rendered > 0 && d.view === "both", `${w}x${h} AG: rendered ${d.counts.rendered}`);
    const lay = await layoutChecks(page, `${w}x${h} AG`);
    console.log(`${w}x${h}: bar ${lay.bar}px stage ${lay.stage} pages ${JSON.stringify(lay.pages)} size ${d.size} sp ${d.sp.toFixed(1)} scale ${d.scale} spread ${d.spread} pages ${d.pages} t ${JSON.stringify(d.t)}`);
    await page.screenshot({ path: path.join(SHOTS, `core-${w}x${h}-ag.png`) });
    for (const name of ["pianoman", "songbird", "synth-pvg"]) {
      if (!ids[name]) continue;
      await page.selectOption("#song", ids[name]);
      await waitReady(page, ids[name]);
      d = await dbg(page);
      const all = await page.evaluate(() => window.resonateDebug().play.countAll());
      ok(all.rendered === all.pitched, `${w}x${h} ${name}: rendered ${all.rendered} = pitched ${all.pitched}`);
      console.log(`  ${name}: pages ${d.pages} spread ${d.spread} sp ${d.sp.toFixed(1)} t ${JSON.stringify(d.t)}`);
      await layoutChecks(page, `${w}x${h} ${name}`);
      await page.screenshot({ path: path.join(SHOTS, `core-${w}x${h}-${name}.png`) });
    }
    ok(!errors.length, `${w}x${h}: no errors: ${errors.join(" | ")}`);
    await ctx.close();
  }
  if (quick) { await browser.close(); console.log(`${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0); }

  // ---- behaviour at 820×1180 (synth-pvg: 7 pages; Piano Man when present)
  {
    const errors = [];
    let { ctx, page } = await newPage(browser, 820, 1180, errors);
    await page.goto(BASE + "play.html");
    await waitReady(page, "amazing-grace");
    const ids = await seed(page, list);
    // a stale entry (no such song) and a sample's: the stale one is pruned on load
    // ("+4": four steps over the printed-density default, ~16 — enough pages to turn; the default is
    // playpaper.cjs's)
    await page.evaluate((id) => {
      localStorage.setItem("resonate.play", JSON.stringify({ sGONE123: { at: 4 }, "amazing-grace": { names: "all" } }));
      localStorage.setItem("resonate.sing.song", id);
      localStorage.setItem("resonate.play.zoom", "+4");
    }, ids["synth-pvg"]);
    await page.reload();
    await waitReady(page, ids["synth-pvg"]);
    const st0 = await page.evaluate(() => JSON.parse(localStorage.getItem("resonate.play") || "{}"));
    ok(!("sGONE123" in st0) && "amazing-grace" in st0, `prune: stale entry gone, sample kept (${Object.keys(st0)})`);
    let d = await dbg(page);
    ok(d.pages >= 4 && d.page === 1, `synth-pvg opens at page 1 of ${d.pages}`);
    // (v78: the Full score first; a song with no saved view still opens in Both)
    ok(JSON.stringify(d.views) === JSON.stringify(["score", "both", "rh", "lh", "melody"]) && d.view === "both", `views ${d.views}, open in ${d.view}`);
    const handsOpts = await page.evaluate(() => [...document.querySelectorAll("#hands option")].map((o) => o.textContent));
    ok(handsOpts.join("|") === "Full score|Both hands|Right hand|Left hand|Melody", `hands labels ${handsOpts}`);
    const pg = () => page.evaluate(() => window.resonateDebug().play.page);
    const key = async (k, want) => { await page.keyboard.press(k); await page.waitForTimeout(30); const p = await pg(); ok(p === want, `${k} → page ${p} (want ${want})`); };
    await key("ArrowLeft", 1); // (no wrap at the start)
    await key("ArrowRight", 2); await key("PageDown", 3); await key("Space", 4); await key("Enter", 5); await key("ArrowDown", 6);
    await key("ArrowLeft", 5); await key("PageUp", 4); await key("ArrowUp", 3); await key("Backspace", 2);
    for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowRight");
    ok((await pg()) === d.pages, `no wrap past the end (${await pg()} of ${d.pages})`);
    await page.keyboard.press("ArrowRight");
    ok((await pg()) === d.pages, "end stays");
    ok((await page.textContent("#pg")).trim() === `${d.pages} / ${d.pages}`, "pager text");
    ok(await page.isDisabled("#next"), "› disabled at the end");
    await page.click("#prev");
    ok((await pg()) === d.pages - 1, "‹ goes back");
    await page.click("#next");
    ok((await pg()) === d.pages, "› goes forward");
    // ‹ › leave no focus behind (a pedal's Space would press them again)
    ok(await page.evaluate(() => document.activeElement === document.body || !document.activeElement.matches("button,select")), "buttons blur");
    for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowLeft");
    ok((await pg()) === 1, "back to page 1");

    // taps: an off-note spot at 0.9 W / 0.1 W / 0.5 W (≥ 40 px from every head) — no turn (v79: a
    // press on the music sounds a note or, later, picks notes; ‹ › and the keys turn)
    const spot = (fx) => page.evaluate((fx) => {
      const st = document.getElementById("stage").getBoundingClientRect();
      const heads = [...document.querySelectorAll("#stage g.note > g.notehead")].map((h) => { const b = h.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
      const x = st.left + st.width * fx;
      for (let y = st.top + 20; y < st.bottom - 20; y += 7) if (heads.every(([hx, hy]) => Math.hypot(hx - x, hy - y) >= 40)) return { x, y };
      return null;
    }, fx);
    const tapAt = async (fx, want, what) => { const s = await spot(fx); if (!s) { ok(false, "no off-note spot at " + fx); return; } await page.touchscreen.tap(s.x, s.y); await page.waitForTimeout(40); const p = await pg(); ok(p === want, `${what}: tap at ${fx}W → page ${p} (want ${want})`); };
    await page.keyboard.press("ArrowRight");
    await tapAt(0.9, 2, "right quarter");
    await tapAt(0.9, 2, "right quarter again");
    await tapAt(0.1, 2, "left quarter");
    await tapAt(0.5, 2, "middle");
    // a tap right on a head doesn't turn
    const head = await page.evaluate(() => { const st = document.getElementById("stage").getBoundingClientRect(); for (const h of document.querySelectorAll("#stage g.note > g.notehead")) { const b = h.getBoundingClientRect(); const x = b.left + b.width / 2; if (x > st.left + st.width * 0.8) return { x, y: b.top + b.height / 2 }; } return null; });
    if (head) { await page.touchscreen.tap(head.x, head.y); await page.waitForTimeout(40); ok((await pg()) === 2, "a tap on a note in the right quarter doesn't turn"); }
    // swipe: CDP touch, −120 px / +120 px, and a drag that starts on a note: no turn
    const cdp = await ctx.newCDPSession(page);
    const swipe = async (x0, y0, dx) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
      for (let i = 1; i <= 6; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + (dx * i) / 6, y: y0 + i }] }); await page.waitForTimeout(16); }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(50);
    };
    await swipe(500, 600, -120);
    ok((await pg()) === 2, `swipe left: no turn (${await pg()})`);
    await swipe(300, 600, 120);
    ok((await pg()) === 2, `swipe right: no turn (${await pg()})`);
    if (head) { const h2 = await page.evaluate(() => { const b = document.querySelector("#stage g.note > g.notehead").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }); await swipe(h2.x, h2.y, -130); ok((await pg()) === 2, `a swipe starting on a note: no turn (${await pg()})`); }

    // names: All → Some → Off, per song, and the device's last level for a new song
    const lvl = () => page.evaluate(() => [document.getElementById("stage").dataset.names, document.getElementById("names").textContent, document.getElementById("names").getAttribute("aria-label")]);
    ok((await lvl()).join("|") === "all|ABC|Note names: all", "names all");
    await page.click("#names");
    ok((await lvl()).join("|") === "some|A·C|Note names: some", `names some ${await lvl()}`);
    const vis = await page.evaluate(() => { let all = 0, shown = 0; for (const n of document.querySelectorAll("#stage .nn")) { all++; if (getComputedStyle(n).display !== "none") shown++; } return { all, shown, km: [...document.querySelectorAll("#stage .km")].filter((k) => getComputedStyle(k).display !== "none").length }; });
    ok(vis.shown > 0 && vis.shown < vis.all, `Some shows some badges (${vis.shown}/${vis.all}, ${vis.km} marks)`);
    await page.click("#names");
    ok((await lvl())[0] === "off", "names off");
    const shownOff = await page.evaluate(() => [...document.querySelectorAll("#stage .nn, #stage .km")].filter((n) => getComputedStyle(n).display !== "none").length);
    ok(shownOff === 0, "Off shows nothing");
    await page.keyboard.press("ArrowRight");
    ok(await page.evaluate(() => [...document.querySelectorAll("#stage .nn")].every((n) => getComputedStyle(n).display === "none")), "a new page at Off: nothing");
    let st = await page.evaluate((id) => JSON.parse(localStorage.getItem("resonate.play"))[id], ids["synth-pvg"]);
    ok(st && st.names === "off", "level kept per song");
    ok((await page.evaluate(() => localStorage.getItem("resonate.play.names"))) === "off", "device's last level");

    // the select gives the pedal's keys back after a choice
    await page.selectOption("#hands", "rh");
    await waitReady(page);
    d = await dbg(page);
    ok(d.view === "rh" && d.keep.staff === 1, `RH view (${d.view})`);
    const p0 = d.page;
    await page.keyboard.press("ArrowRight");
    ok((await pg()) === Math.min(d.pages, p0 + 1), `a pedal key right after the hands menu turns (${p0} → ${await pg()})`);
    await page.selectOption("#hands", "both");
    await waitReady(page);

    // anchor: page 3 → rotate → back; −/+; hands; reload
    for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight");
    d = await dbg(page);
    const at = d.at;
    ok(d.page === 3 && at > 0, `page 3 anchored at m${at}`);
    const onScreen = () => page.evaluate((at) => { const g = document.querySelector(`#stage .page g#m${at}`); if (!g) return false; const b = g.getBoundingClientRect(); return b.width > 0 && b.left >= -1 && b.right <= innerWidth + 1; }, at);
    const settle = async () => { await page.waitForTimeout(450); await waitReady(page); };
    ok(await onScreen(), "m<at> on screen at 820×1180");
    await page.setViewportSize({ width: 1180, height: 820 });
    await settle();
    d = await dbg(page);
    ok(d.W === 1180 && (await onScreen()) && d.at === at, `rotated 1180×820: m${at} on screen (page ${d.page}, at ${d.at})`);
    await page.setViewportSize({ width: 820, height: 1180 });
    await settle();
    d = await dbg(page);
    ok(d.page === 3 && (await onScreen()), `back to portrait: page ${d.page}, m${at} on screen`);
    const sp0 = d.sp;
    await page.click("#bigger");
    await waitReady(page);
    d = await dbg(page);
    ok(d.sp > sp0 && (await onScreen()), `+ raises sp ${sp0} → ${d.sp}, m${at} on screen`);
    await page.click("#smaller"); await waitReady(page);
    await page.click("#smaller"); await waitReady(page);
    d = await dbg(page);
    ok(d.sp < sp0 && (await onScreen()), `− lowers sp → ${d.sp}, m${at} on screen`);
    ok((await page.evaluate(() => localStorage.getItem("resonate.play.zoom"))) === (d.step ? (d.step > 0 ? "+" : "") + d.step : null), `size kept (device): step ${d.step}`);
    for (const v of ["lh", "melody", "both"]) {
      await page.selectOption("#hands", v);
      await waitReady(page);
      const vv = await dbg(page);
      const mi = await page.evaluate(({ at }) => { const g = [...document.querySelectorAll("#stage .page g.measure")].map((x) => Number(x.id.slice(1))); return g; }, { at });
      ok(vv.at === at && mi.some((m) => m >= at) && mi[0] <= at + 4, `${v}: still at m${at} (bars ${mi[0]}–${mi[mi.length - 1]})`);
    }
    await page.reload();
    await waitReady(page, ids["synth-pvg"]);
    d = await dbg(page);
    ok(d.at === at && (await onScreen()) && d.names === "off" && d.view === "both", `reload: at m${d.at}, names ${d.names}, view ${d.view}`);
    // size clamp: + stops where the width caps it (390 px wide: pw/40 ≈ 9.75)
    await page.setViewportSize({ width: 390, height: 844 });
    await settle();
    for (let i = 0; i < 8; i++) { if (await page.isDisabled("#bigger")) break; await page.click("#bigger"); await waitReady(page); }
    d = await dbg(page);
    ok(await page.isDisabled("#bigger"), `+ disabled when capped (size ${d.size}, sp ${d.sp.toFixed(2)})`);
    ok(d.sp <= 390 / 40 + 0.01, `sp capped by the width (${d.sp})`);
    await page.click("#smaller"); await waitReady(page);
    const d2 = await dbg(page);
    ok(d2.sp < d.sp - 0.1, `− from a capped size shows smaller (${d.sp.toFixed(2)} → ${d2.sp})`);
    await page.setViewportSize({ width: 820, height: 1180 });
    await settle();

    // a new song starts at the device's last level; resonate.sing.song follows the choice
    await page.selectOption("#song", ids["synth-longest"]);
    await waitReady(page, ids["synth-longest"]);
    ok((await dbg(page)).names === "off", "new song at the last chosen level");
    ok((await page.evaluate(() => localStorage.getItem("resonate.sing.song"))) === ids["synth-longest"], "resonate.sing.song = the choice");
    // voice-only song: one view, the hands menu hidden
    await page.selectOption("#song", ids["synth-voice"]);
    await waitReady(page, ids["synth-voice"]);
    ok(await page.evaluate(() => document.getElementById("hands").hidden), "voice-only: hands hidden");
    // wake lock: requested once shown, again when the page is visible again
    const wk = await page.evaluate(() => window.__wake.requests);
    ok(wk >= 1, `wake lock requested (${wk})`);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForTimeout(50);
    ok((await page.evaluate(() => window.__wake.requests)) > wk, "again after visibilitychange");
    // the cloud brings a song: the list follows; the open song removed → the first sample
    const nid = await page.evaluate(async (xml) => { const L = await import("./library.js?v=76"); const id = await L.addSong("Remote one", xml); window.dispatchEvent(new CustomEvent("resonate:remote", { detail: { songs: true } })); return id; }, list[0].xml);
    await page.waitForTimeout(300);
    ok(await page.evaluate((id) => !!document.querySelector(`#mine option[value="${id}"]`), nid), "resonate:remote refreshes My songs");
    await page.evaluate(async (id) => { const L = await import("./library.js?v=76"); await L.removeSong(id); window.dispatchEvent(new CustomEvent("resonate:remote", { detail: { songs: true } })); }, ids["synth-voice"]);
    await waitReady(page, "amazing-grace");
    ok(true, "open song removed → Amazing Grace");
    // a song that isn't music: the one line
    const bad = await page.evaluate(async () => { const L = await import("./library.js?v=76"); return L.addSong("Broken", "<not-music/>"); });
    await page.reload();
    await waitReady(page, "amazing-grace");
    await page.selectOption("#song", bad);
    await page.waitForFunction(() => window.resonateDebug().play.failed === "song");
    ok((await page.textContent("#msg")) === "Couldn't open this song.", "bad song → one line");
    await page.selectOption("#song", "amazing-grace");
    await waitReady(page, "amazing-grace");
    ok(await page.evaluate(() => document.getElementById("msg").hidden), "message gone with the next song");
    ok(!errors.filter((e) => !/Not valid XML|partwise|song /.test(e)).length, `behaviour: no errors: ${errors.join(" | ")}`);
    await ctx.close();
  }

  // ---- spread: 1366×1024 zoomed all the way out (5 px: two pages, by two, odd left: each ≥ 110
  // staff spaces) and none once + brings a page under 110
  {
    const errors = [];
    const { ctx, page } = await newPage(browser, 1366, 1024, errors);
    await page.goto(BASE + "play.html");
    await waitReady(page, "amazing-grace");
    const ids = await seed(page, list.filter((x) => x.name === "synth-pvg" || x.name === "pianoman"));
    const big = ids.pianoman || ids["synth-pvg"];
    await page.evaluate((id) => { localStorage.setItem("resonate.play.zoom", "-8"); localStorage.setItem("resonate.sing.song", id); }, big);
    await page.reload();
    await waitReady(page, big);
    let d = await dbg(page);
    let n = await page.locator("#stage .page").count();
    ok(d.spread && n === 2 && d.page === 1, `spread at ${d.sp}: ${n} pages shown, page ${d.page}`);
    ok((await page.textContent("#pg")).trim() === `1–2 / ${d.pages}`, `spread pager ${await page.textContent("#pg")}`);
    await page.keyboard.press("ArrowRight");
    d = await dbg(page);
    ok(d.page === 3 && JSON.stringify(d.shown) === "[3,4]", `turns by two (${d.shown})`);
    await page.screenshot({ path: path.join(SHOTS, "core-1366x1024-spread.png") });
    const lay = await layoutChecks(page, "spread");
    ok(lay.pages.length === 2 && lay.pages[0][1] + lay.pages[1][1] <= 1366, `spread pages fit (${JSON.stringify(lay.pages)})`);
    for (let i = 0; i < 60; i++) await page.keyboard.press("ArrowRight");
    d = await dbg(page);
    ok(d.page % 2 === 1 && d.page >= d.pages - 1, `spread end: left page ${d.page} odd of ${d.pages}`);
    for (let i = 0; i < 4 && (await dbg(page)).spread; i++) { await page.click("#bigger"); await waitReady(page); }
    d = await dbg(page);
    n = await page.locator("#stage .page").count();
    ok(!d.spread && n === 1 && d.W / 2 / d.sp < 110 && d.step > -8, `no spread once a page would hold < 110 staff spaces (${d.sp}, step ${d.step}, ${n})`);
    ok(!errors.length, `spread: no errors: ${errors.join(" | ")}`);
    await ctx.close();
  }

  // ---- engine missing (offline): the one line
  {
    const errors = [];
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    await page.route(/verovio-module\.mjs/, (r) => r.abort()); // (a retry asks for verovio-module.mjs?r=1)
    await page.goto(BASE + "play.html");
    await page.waitForFunction(() => window.resonateDebug?.().play.failed === "engine", null, { timeout: 30000 });
    ok((await page.textContent("#msg")) === "Couldn't load the music — check the connection.", "engine failure → one line");
    ok((await page.textContent("#pg")).trim() === "", "no pager text then");
    await ctx.close();
  }

  console.log(`${passes} passed, ${fails} failed`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
