// Play page (v79): one check per confirmed finding of the ▶ / paper-density review round.
//
//   M  a whole-bar rest doesn't stretch its column (Killing bar 1 in the Full score: the left hand
//      rests while the tune plays eighths): columns in x order, every eighth pickable, the band of
//      a stretch from the 2nd eighth starts at that eighth
//   T  an auto turn waits for a finger on the music: a drag in progress keeps its page (no stretch
//      grown by a page), the turn is skipped after a drag; a held peek isn't cut, the page turns at
//      the lift
//   K  the stretch's controls move clear of the peek's chord and its names (and the keyboard), and back
//   D  a tap on the PDF view (📄) leaves the stretch alone
//   R  while ▶ plays: the controls stay where they were placed (v86: v79–80 moved them off the line
//      playing at every new line — "sometimes it will jump suddenly during playback"); the keyboard
//      (v80: docked under the music) is there in every sample, at one place, never over the music —
//      across auto turns and a loop over two lines (v79's strip took a side, or none, per page)
//   A  grace notes: a stretch starting on a note with a grace plays the grace GRACE before it (the
//      schedule starts that much earlier; a loop's next round has it at the end of the round
//      before), a grace chord's notes together, the band covers the grace
//   U  a key struck twice at once is struck once (Killing's Full score: voice + piano tune), both
//      lit; rendered offline through the bus, no sample over full scale (Killing Full score,
//      Wichita Both — the loudest two)
//   Z  − / + are steps from the default: + then − is the default again (its pref removed), a step
//      in one orientation is the same step in the other, reload keeps it
//   C  the default's density against the printed system breaks of the owner's songs (Full score,
//      iPad Air portrait): bars a system within ±25% of print per song, ±10% overall
//   F  landscape: two systems a page down to 0.9 of the device's portrait density (Piano Man's
//      Full score on an iPad mini and an Air: not one a page)
//   V  a tablet window narrower than 700 px (Split View, Slide Over) shows what fits (9.5), not 5
//   E  a stretch played once that ends at a page's last bar doesn't turn the page at its end
//   B  a finger lifted just short of a barline ends the stretch in that bar
//   H  the bar no taller than v78's at 300–1180 px, with and without the fewer-names chip (v78's
//      heights measured on HEAD's page in this Chromium)
//   O  an OMR-overfilled note is cut at the barline (as documented)
//
// usage: node playbackfixes.cjs   (BASE=http://localhost:8097/resonate/, PLAY_SCORES=<the owner's
//   converted .musicxml — never copied into the repo>, ONLY=M,T,…, SHOTS=<dir>)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { pdfmini } = require("./pdfmini.cjs");
const BASE = process.env.BASE || "http://localhost:8097/resonate/";
const SCRATCH = "/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad";
const SCORES = process.env.PLAY_SCORES ?? path.join(SCRATCH, "play/scores");
const SHOTS = process.env.SHOTS || path.join(SCRATCH, "playback/shots-fixes");
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

// Grace notes: B4 grace before C5; a grace chord E5 G5 B5 before D5; E5; bar 2: D5 grace, C5. ♩=60.
const GRACE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1"><work><work-title>Grace fixture</work-title></work>
<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1">
<measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>60</per-minute></metronome></direction-type><sound tempo="60"/></direction>
<note><grace slash="yes"/><pitch><step>B</step><octave>4</octave></pitch><voice>1</voice><type>eighth</type></note>
<note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
<note><grace/><pitch><step>E</step><octave>5</octave></pitch><voice>1</voice><type>eighth</type></note>
<note><grace/><chord/><pitch><step>G</step><octave>5</octave></pitch><voice>1</voice><type>eighth</type></note>
<note><grace/><chord/><pitch><step>B</step><octave>5</octave></pitch><voice>1</voice><type>eighth</type></note>
<note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
<note><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>half</type></note>
</measure>
<measure number="2">
<note><grace slash="yes"/><pitch><step>D</step><octave>5</octave></pitch><voice>1</voice><type>eighth</type></note>
<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note>
<barline location="right"><bar-style>light-heavy</bar-style></barline>
</measure>
</part></score-partwise>`;

function INIT() {
  try { if (!navigator.audioSession) Object.defineProperty(navigator, "audioSession", { configurable: true, value: { type: "auto" } }); } catch {}
  window.__key = (key) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}
const D = (page) => page.evaluate(() => { const d = window.resonateDebug?.().play; if (!d) return null; const { facts, countAll, playback, ...rest } = d; return rest; });
const PBD = (page, all = false) => page.evaluate((all) => { const x = window.resonateDebug().play.playback; const { geo, onsets, timeline, singOrder, pageOf, ...rest } = x; if (!all) { rest.items = rest.items.length; rest.scheduled = rest.scheduled.length; } return rest; }, all);
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
// CDP touch: a press, moves, a lift (client px); hold before moving; rest before the lift
async function touchPath(ctx, page, pts, { hold = 0, step = 16, rest = 150, mid = null } = {}) {
  const cdp = await ctx.newCDPSession(page);
  const t = (type, p) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ x: p[0], y: p[1], id: 1 }] : [] });
  await t("touchStart", pts[0]);
  if (hold) await sleep(hold);
  for (const p of pts.slice(1)) { await t("touchMove", p); await sleep(step); }
  if (mid) await mid();
  if (pts.length > 1) { await t("touchMove", pts[pts.length - 1]); await sleep(rest); }
  await t("touchEnd");
  await cdp.detach().catch(() => {});
}
const line = (a, b, n = 10) => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
async function geo(page) {
  const g = await page.evaluate(() => window.resonateDebug().play.playback.geo());
  return g.map((pg) => ({ page: pg.page, systems: pg.systems.map((s) => ({ ...s, top: s.top + pg.rect[1], bottom: s.bottom + pg.rect[1], left: s.left + pg.rect[0], right: s.right + pg.rect[0], cols: s.cols.map(([q, x0, x1]) => [q, x0 + pg.rect[0], x1 + pg.rect[0]]) })) }));
}
const colPt = (s, i) => [(s.cols[i][1] + s.cols[i][2]) / 2, s.top + 0.3 * (s.bottom - s.top)];
const headPt = (page, id) => page.evaluate((id) => { const g = document.querySelector(`#stage g.note[id="${id}"] > g.notehead`); if (!g) return null; const r = g.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.left, r.right]; }, id);
const rectOf = (page, sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }, sel);
const overlap = (a, b) => a && b && Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 1 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 1;
const vOverlap = (a, b) => a && b && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 1;
// While ▶ plays: the keyboard's rect (null: not shown), the stage's, the lit system and the next one
// on the shown page(s)
const playScene = (page) => page.evaluate(() => {
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
  const strip = document.getElementById("dock");
  const on = !strip.hidden;
  const lit = document.querySelector("#stage .page g.note.play");
  const sys = lit?.closest("g.system");
  const all = [...document.querySelectorAll("#stage .page g.system")];
  const next = sys ? all[all.indexOf(sys) + 1] : null;
  const sb = document.getElementById("selbar");
  const pb = window.resonateDebug().play.playback;
  // (the lines' ink: each bar's staves with their notes and words, its marks)
  const ink = [sys, next].filter(Boolean).flatMap((s) => [...s.querySelectorAll("g.measure > g")].map(r));
  return { strip: on ? r(strip) : null, stage: r(document.getElementById("stage")), keys: window.resonateDebug().play.keys.lit.length, sys: r(sys), next: r(next), ink, nsys: all.length, selbar: sb.hidden ? null : r(sb), page: window.resonateDebug().play.page, mi: pb.mi, state: pb.state, turns: pb.turns.length, bands: [...document.querySelectorAll(".page .sel")].map(r) };
});
// the printed system breaks (Audiveris keeps them): bars per system
function printed(xml) {
  const part = /<part id="[^"]+">([\s\S]*?)<\/part>/.exec(xml)[1];
  const meas = [...part.matchAll(/<measure\b[^>]*>([\s\S]*?)<\/measure>/g)].map((m) => m[1]);
  const sys = []; let cur = 0;
  meas.forEach((x, i) => { if (i && /<print[^>]*new-(system|page)="yes"/.test(x)) { sys.push(cur); cur = 0; } cur++; });
  sys.push(cur);
  return sys;
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const errors = [];
  const have = ["killing", "wichita", "pianoman", "longest", "songbird"].filter(HAVE);
  if (have.length < 5) console.log("(owner scores missing — PLAY_SCORES:", SCORES, ") — running what's there:", have.join(", "));
  const K = HAVE("killing");

  // ---------------------------------------------------------------- M whole-bar rests and columns
  if (run("M") && K) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await seed(page, [{ name: "killing", xml: read(OWNER("killing")) }]);
    await openSong(page, ids.killing, "score");
    const g = await geo(page);
    let ordered = true, n = 0;
    for (const pg of g) for (const s of pg.systems) for (let i = 0; i + 1 < s.cols.length; i++) { n++; if (s.cols[i][2] > s.cols[i + 1][1] + 1) ordered = false; }
    ok(ordered, `M1 every column in x order (${n} pairs on page 1)`);
    const s0 = g[0].systems[0];
    ok(Math.abs(s0.cols[0][0]) < 1e-6 && s0.cols[0][2] - s0.cols[0][1] < 3 * (await D(page)).sp, `M1 bar 1's first column is its eighths' heads, not the left hand's whole-bar rest: ${JSON.stringify(s0.cols[0].map(Math.round))}`);
    // every one of bar 1's first six onsets picked by pressing it and dragging to the next
    let picks = 0;
    for (let i = 0; i < 6; i++) {
      await touchPath(ctx, page, line(colPt(s0, i), colPt(s0, i + 1), 8));
      const p = await PBD(page);
      if (p.span && Math.abs(p.span.q0 - s0.cols[i][0]) < 1e-6 && Math.abs(p.span.q1 - s0.cols[i + 1][0]) < 1e-6) picks++;
      else info(`M2 col ${i}: ${JSON.stringify(p.span)} want ${s0.cols[i][0]}–${s0.cols[i + 1][0]}`);
    }
    ok(picks === 6, `M2 bar 1's onsets each picked where pressed (${picks}/6)`);
    // the 2nd eighth (q 0.5) by its head
    const h1 = await headPt(page, "n341"), h3 = await headPt(page, "n343");
    if (h1 && h3) {
      await touchPath(ctx, page, line(h1, h3, 8));
      let p = await PBD(page);
      ok(p.span && Math.abs(p.span.q0 - 0.5) < 1e-6, `M3 pressing the 2nd eighth (n341) starts the stretch there: ${JSON.stringify(p.span)}`);
      await touchPath(ctx, page, line(h3, h1, 8));
      p = await PBD(page);
      ok(p.span && Math.abs(p.span.q0 - 0.5) < 1e-6, `M3 backwards too: ${JSON.stringify(p.span)}`);
      ok(p.bands.length && p.bands[0].left <= h1[2] - (await page.evaluate(() => document.querySelector("#stage .page").getBoundingClientRect().left)) + 1, `M4 its band starts at the 2nd eighth's head (${p.bands[0]?.left} ≤ ${Math.round(h1[2])})`);
    } else ok(false, "M3 n341/n343 not drawn");
    await page.screenshot({ path: path.join(SHOTS, "M-killing-bar1.png") });
    await ctx.close();
  }

  // ---------------------------------------------------------------- T an auto turn under a finger
  if (run("T") && K) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await seed(page, [{ name: "killing", xml: read(OWNER("killing")) }]);
    await page.evaluate((id) => localStorage.setItem("resonate.sing.timing", JSON.stringify({ [id]: { bpm: 400 } })), ids.killing);
    await openSong(page, ids.killing, "both");
    const lastBar = await page.evaluate(() => { const ms = [...document.querySelectorAll("#stage .page g.measure")]; return Number(/^m(\d+)$/.exec(ms[ms.length - 1].id)[1]); });
    // (A) a drag in progress across the turn
    let g = await geo(page);
    const sys = g[0].systems[g[0].systems.length - 1];
    const a = colPt(sys, 1), b = colPt(sys, 4);
    await page.tap("#play");
    await until(page, (m) => window.resonateDebug().play.playback.mi >= m - 1, lastBar, 30000);
    let sawDefer = false;
    {
      const cdp = await ctx.newCDPSession(page);
      const t = (type, p) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ x: p[0], y: p[1], id: 1 }] : [] });
      await t("touchStart", a);
      for (const pt of line(a, [a[0] + 30, a[1]], 3).slice(1)) { await t("touchMove", pt); await sleep(30); }
      await until(page, (m) => window.resonateDebug().play.playback.mi > m, lastBar, 15000);
      await sleep(300);
      const p0 = await PBD(page);
      sawDefer = !!p0.defer && p0.musicPage === 2 && (await D(page)).page === 1;
      for (const pt of line([a[0] + 30, a[1]], b, 5).slice(1)) { await t("touchMove", pt); await sleep(20); }
      await sleep(150);
      await t("touchEnd");
      await cdp.detach().catch(() => {});
    }
    await sleep(300);
    let p = await PBD(page);
    const onPage1 = sys.cols.map((c) => c[0]);
    ok(sawDefer, "T1 the music moved on to page 2 under the finger: the page stayed (a turn deferred)");
    ok(p.span && Math.abs(p.span.q0 - sys.cols[1][0]) < 1e-6 && p.span.q1 <= onPage1[onPage1.length - 1] + 1e-6, `T1 the stretch is what the finger dragged on page 1: ${JSON.stringify(p.span)} (page 1's last onset ${onPage1[onPage1.length - 1]})`);
    ok((await D(page)).page === 1 && !p.defer, `T1 after the drag the page stays (${(await D(page)).page})`);
    await page.tap("#play"); await sleep(200);
    // (B) a held peek across the turn: not cut, the page turns at the lift
    await page.tap("#sel-clear").catch(() => {});
    await page.evaluate(() => { for (let i = 0; i < 20; i++) window.__key("ArrowLeft"); });
    await sleep(300);
    g = await geo(page);
    const lastSys = g[0].systems[g[0].systems.length - 1];
    const heads = await page.evaluate((top) => [...document.querySelectorAll("#stage .page g.note > g.notehead")].map((h) => { const r = h.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, h.parentElement.id]; }).filter((x) => x[1] > top), lastSys.top - 30);
    await page.tap("#play");
    await until(page, (m) => window.resonateDebug().play.playback.mi >= m - 1, lastBar, 30000);
    let peekHeld = false, pageHeld = false;
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: heads[0][0], y: heads[0][1], id: 1 }] });
    await until(page, (m) => window.resonateDebug().play.playback.mi > m, lastBar, 15000);
    await sleep(400);
    const dd = await D(page);
    peekHeld = !!dd.peek && dd.peek.held;
    pageHeld = dd.page === 1;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
    await sleep(300);
    p = await PBD(page);
    ok(peekHeld && pageHeld, `T2 a held peek across the music's page change: still held (${peekHeld}), the page stayed (${pageHeld})`);
    ok((await D(page)).page === 2 && p.turns.some((t) => t.page === 2), `T2 at the lift the page turns to the music (${(await D(page)).page}, turns ${JSON.stringify(p.turns.map((t) => t.page))})`);
    await page.tap("#play"); await sleep(200);
    await ctx.close();
  }

  // ---------------------------------------------------------------- K the controls vs the peek's strip
  if (run("K")) {
    for (const [w, h] of [[820, 1180], [1180, 820], [390, 844]]) {
      const { ctx, page } = await newPage(browser, w, h, errors);
      const g = await geo(page);
      const s0 = g[0].systems[0];
      await touchPath(ctx, page, line(colPt(s0, 1), colPt(s0, 4), 8));
      const before = await rectOf(page, "#selbar");
      const head = await headPt(page, "n0") || await headPt(page, "n4");
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: head[0], y: head[1], id: 1 }] });
      await sleep(400);
      const strip = await rectOf(page, "#strip"), bar = await rectOf(page, "#selbar"), bubble = await rectOf(page, "#bubble");
      const d = await D(page);
      ok(d.peek && !overlap(bar, strip) && !overlap(bar, [head[2], head[1] - 6, head[3], head[1] + 6]) && !overlap(bar, bubble), `K1 ${w}×${h}: with the peek's strip up the controls are clear of it, the chord and its names (bar ${bar.map(Math.round)}, strip ${strip.map(Math.round)})`);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await cdp.detach();
      await sleep(2600);
      const after = await rectOf(page, "#selbar");
      ok(Math.abs(after[1] - before[1]) < 2, `K2 ${w}×${h}: the peek gone, the controls back (${Math.round(before[1])} → ${Math.round(after[1])})`);
      await ctx.close();
    }
  }

  // ---------------------------------------------------------------- D a tap on the PDF view
  if (run("D")) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await seed(page, [{ name: "pdfsong", xml: read("/home/user/resonate/public/songs/amazing-grace.musicxml"), pdf: Buffer.from(pdfmini(3)).toString("base64") }]);
    await openSong(page, ids.pdfsong, "both");
    const g = await geo(page);
    await touchPath(ctx, page, line(colPt(g[0].systems[0], 1), colPt(g[0].systems[0], 5), 8));
    const span = (await PBD(page)).span;
    await page.tap("#pdf");
    await until(page, () => window.resonateDebug().play.pdf.canvas);
    const cv = await rectOf(page, "#pdfview");
    await touchPath(ctx, page, [[(cv[0] + cv[2]) / 2, (cv[1] + cv[3]) / 2]]);
    await sleep(200);
    const mid = await PBD(page);
    await page.tap("#pdf"); await sleep(400);
    const p = await PBD(page);
    ok(span && mid.span && p.span && p.span.q0 === span.q0 && p.span.end === span.end && p.bands.length >= 1 && p.selbar, `D1 a tap on the PDF leaves the stretch (${JSON.stringify(mid.span)}); back on the sheet it's drawn (${p.bands.length} bands, controls ${!!p.selbar})`);
    await ctx.close();
  }

  // ---------------------------------------------------------------- R the strip and the controls while playing
  if (run("R") && K) {
    for (const [w, h, view] of [[1180, 820, "score"], [820, 1180, "score"], [1180, 820, "both"]]) {
      const { ctx, page } = await newPage(browser, w, h, errors);
      const ids = await seed(page, [{ name: "killing", xml: read(OWNER("killing")) }]);
      await page.evaluate((id) => localStorage.setItem("resonate.sing.timing", JSON.stringify({ [id]: { bpm: 400 } })), ids.killing);
      await openSong(page, ids.killing, view);
      await page.tap("#play");
      await until(page, () => window.resonateDebug().play.playback.state === "playing" && window.resonateDebug().play.playback.lit.length > 0);
      const rects = new Set();
      let samples = 0, stripBad = 0, barBad = 0, strips = 0, turnSeen = 0, afterTurnBad = 0, lastTurns = 0, litKeys = 0;
      const barAt = new Set();
      const t0 = Date.now();
      while (Date.now() - t0 < 26000) {
        const s = await playScene(page);
        if (s.state === "idle") break;
        if (!s.sys) { await sleep(40); continue; }
        samples++;
        if (s.strip) { strips++; rects.add(s.strip.map(Math.round).join()); if (s.keys) litKeys++; if (vOverlap(s.strip, s.stage) || vOverlap(s.strip, s.sys) || vOverlap(s.strip, s.next)) { stripBad++; if (stripBad < 3) info(`R ${w}×${h} ${view}: keyboard ${s.strip.map(Math.round)} over the music ${s.stage.map(Math.round)} / the line ${s.sys.map(Math.round)} (bar ${s.mi})`); } }
        if (s.selbar) { barAt.add(s.selbar.map(Math.round).join()); if (s.ink.some((b) => overlap(s.selbar, b))) barBad++; }
        if (s.turns > lastTurns) {
          turnSeen++; lastTurns = s.turns; await sleep(120); const x = await playScene(page); if (!x.strip || (x.sys && vOverlap(x.strip, x.sys)) || rects.size > 1) afterTurnBad++;
          if (turnSeen === 3) await page.screenshot({ path: path.join(SHOTS, `R-${w}x${h}-${view}-p${x.page}.png`) });
        }
        await sleep(60);
      }
      ok(samples > 50 && stripBad === 0 && strips === samples && litKeys > samples / 2, `R1 ${w}×${h} ${view}: the keyboard there in every sample (${strips} of ${samples}), never over the music (${stripBad}), keys lit in ${litKeys}`);
      ok(barAt.size === 1, `R2 ${w}×${h} ${view}: the controls at one place throughout (${[...barAt].join(" | ")}; over the line playing in ${barBad} of ${samples} samples — where the page leaves no free paper)`);
      ok(turnSeen >= 1 && afterTurnBad === 0, `R3 ${w}×${h} ${view}: after ${turnSeen} auto turns the keyboard is where it was (${afterTurnBad})`);
      ok(rects.size === 1, `R4 ${w}×${h} ${view}: the keyboard never moved (${[...rects].join(" | ")})`);
      await page.screenshot({ path: path.join(SHOTS, `R-${w}x${h}-${view}.png`) });
      await page.tap("#play"); await sleep(200);
      // a loop over two lines (portrait Both: lines 3–4): the strip off the stretch every round
      if (w < h || view === "both") {
        await page.evaluate(() => { for (let i = 0; i < 20; i++) window.__key("ArrowLeft"); });
        await sleep(300);
        const g = await geo(page);
        const sy = g[0].systems, i = Math.max(0, sy.length - 2);
        await touchPath(ctx, page, line(colPt(sy[i], 1), colPt(sy[i + 1], Math.min(3, sy[i + 1].cols.length - 1)), 10));
        await page.tap("#sel-loop");
        await until(page, () => window.resonateDebug().play.playback.state === "looping" && window.resonateDebug().play.playback.lit.length > 0);
        let bad = 0, n = 0, sides = new Set();
        const t1 = Date.now();
        while (Date.now() - t1 < 6000) {
          const s = await playScene(page);
          if (s.strip) { sides.add(s.strip.map(Math.round).join()); for (const b of s.bands) if (vOverlap(s.strip, b)) bad++; } else bad++;
          n++;
          await sleep(60);
        }
        ok(bad === 0 && sides.size === 1, `R5 ${w}×${h} ${view}: a loop over two lines — the keyboard there all along, never over the stretch (${bad} of ${n}), one place (${[...sides]})`);
        await page.tap("#play"); await sleep(200);
      }
      await ctx.close();
    }
  }

  // ---------------------------------------------------------------- A grace notes
  if (run("A")) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await seed(page, [{ name: "grace", xml: GRACE_XML }]);
    await openSong(page, ids.grace);
    // the schedule (pure): a stretch starting on the grace chord's note, the whole piece
    const u = await page.evaluate(async () => {
      const PT = await import("./playtime.js?v=78");
      const T = window.resonateDebug().play.playback.timeline();
      const all = PT.track(T, { bars: [0, 1], keep: () => true, base: 60 });
      const span = PT.track(T, { bars: [0], span: { q0: 1, q1: 2 }, keep: () => true, base: 60 });
      const f = (tr) => tr.items.map((x) => [x.midi, +x.sec.toFixed(3), !!x.grace, x.n]);
      return { all: f(all), span: f(span), pre: span.pre, allPre: all.pre, len: span.len };
    });
    const chord = u.all.filter((x) => [76, 79, 83].includes(x[0]) && x[2]);
    ok(chord.length === 3 && chord.every((x) => x[1] === chord[0][1]) && Math.abs(chord[0][1] - 0.93) < 1e-3, `A1 a grace chord's notes together, 70 ms before their note: ${JSON.stringify(chord)}`);
    const sg = u.span.filter((x) => x[2]), main = u.span.find((x) => x[0] === 74);
    ok(sg.length === 3 && sg.every((x) => Math.abs(x[1] + 0.07) < 1e-3) && main && main[1] === 0 && Math.abs(u.pre - 0.07) < 1e-6, `A2 a stretch starting on that note: the grace chord at −70 ms, its note at 0, pre ${u.pre}: ${JSON.stringify(u.span)}`);
    ok(Math.abs(u.allPre - 0.07) < 1e-6 && u.all[0][2] && u.all[0][1] === -0.07, `A2 from the start: the first grace at −70 ms (pre ${u.allPre})`);
    // on the page: drag from C5's onset (q 0) … the grace B4 struck 70 ms before C5, every round
    const g = await geo(page);
    const s = g[0].systems[0];
    await touchPath(ctx, page, line(colPt(s, 0), colPt(s, 2), 8));
    let p = await PBD(page);
    ok(p.span && p.span.q0 === 0, `A3 a stretch from the first note: ${JSON.stringify(p.span)}`);
    const band = await page.evaluate(() => { const b = document.querySelector(".page .sel").getBoundingClientRect(); const gr = document.querySelector('#stage g.note[id="n0"] > g.notehead') || document.querySelector("#stage g.graceGrp g.notehead, #stage g.note g.notehead"); const r = gr.getBoundingClientRect(); return { band: b.left, grace: r.left }; });
    ok(band.band <= band.grace + 0.5, `A3 the band covers the grace (${band.band.toFixed(1)} ≤ ${band.grace.toFixed(1)})`);
    await page.tap("#sel-loop");
    await until(page, () => window.resonateDebug().play.playback.scheduled.filter((x) => x.round === 2).length > 0, null, 20000);
    p = await PBD(page, true);
    const byRound = (r) => p.scheduled.filter((x) => x.round === r);
    const r0 = byRound(0), r1 = byRound(1);
    const gr = (l) => l.find((x) => x.midi === 71), c5 = (l) => l.find((x) => x.midi === 72);
    ok(gr(r0) && c5(r0) && Math.abs(c5(r0).when - gr(r0).when - 0.07) < 0.002, `A4 played: the grace 70 ms before its note (${gr(r0) && (c5(r0).when - gr(r0).when).toFixed(3)})`);
    ok(gr(r1) && c5(r1) && Math.abs(c5(r1).when - gr(r1).when - 0.07) < 0.002 && Math.abs(c5(r1).when - c5(r0).when - p.len) < 0.002, `A4 round 2: the grace at the end of round 1, its note one stretch after the first (${c5(r1) && (c5(r1).when - c5(r0).when).toFixed(3)} vs ${p.len})`);
    await page.tap("#play"); await sleep(200);
    await ctx.close();
  }

  // ---------------------------------------------------------------- U unisons and loudness
  if (run("U") && K) {
    const { ctx, page } = await newPage(browser, 1180, 820, errors, { touch: false });
    const list = [{ name: "killing", xml: read(OWNER("killing")) }];
    if (HAVE("wichita")) list.push({ name: "wichita", xml: read(OWNER("wichita")) });
    const ids = await seed(page, list);
    for (const [song, view] of [["killing", "score"], ["wichita", "both"]]) {
      if (!ids[song]) continue;
      await openSong(page, ids[song], view);
      await page.click("#play");
      await until(page, () => window.resonateDebug().play.playback.items.length > 0);
      await page.click("#play"); await sleep(200);
      const r = await page.evaluate(async () => {
        const pb = window.resonateDebug().play.playback;
        const items = pb.items.filter((x) => x.sound);
        let dups = 0;
        const s = [...items].sort((a, b) => a.sec - b.sec);
        for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length && s[j].sec < s[i].sec + 0.01; j++) if (s[j].midi === s[i].midi) dups++;
        const quiet = pb.items.filter((x) => !x.sound && !s.some((y) => y.midi === x.midi && Math.abs(y.sec - x.sec) < 0.01)).length;
        const { loadPiano, playPiano, pianoBus } = await import("./piano.js?v=78");
        const level = (n) => Math.min(1.2, 4 / ((n || 1) + 1));
        const SR = 44100, LEAD = 0.12 + (pb.pre || 0);
        const ac = new OfflineAudioContext(1, Math.ceil((pb.len + 4) * SR), SR);
        const piano = await loadPiano(ac);
        const bus = pianoBus(ac, pb.bus ?? 0.8);
        for (const it of items) playPiano(ac, piano, LEAD + it.sec, it.hold, it.midi, level(it.n), [], bus);
        const x = (await ac.startRendering()).getChannelData(0);
        let peak = 0, over = 0;
        for (const v of x) { const a = Math.abs(v); if (a > peak) peak = a; if (a > 1) over++; }
        return { struck: items.length, dups, peak, over, len: pb.len, unisons: pb.items.length - items.length };
      });
      ok(r.dups === 0, `U1 ${song} ${view}: no key struck twice at once (${r.dups}; ${r.struck} struck)`);
      ok(r.peak < 1 && r.over === 0, `U2 ${song} ${view}: rendered through the bus, ${r.len.toFixed(0)} s, peak ${r.peak.toFixed(3)} (${r.over} samples over 1)`);
    }
    // both copies of a unison lit: the voice's and the piano's heads
    await openSong(page, ids.killing, "score");
    const u = await page.evaluate(() => {
      const pb = window.resonateDebug().play.playback;
      return pb.items.filter((x) => x.sec < 2).map((x) => [x.id, x.midi, +x.sec.toFixed(3), x.sound]);
    });
    info("U3 first notes:", JSON.stringify(u.slice(0, 6)));
    await page.click("#play");
    await until(page, () => window.resonateDebug().play.playback.litEls.length >= 2);
    const lit = (await PBD(page)).litEls;
    ok(lit.includes("n0") && lit.includes("n340"), `U3 the voice's G4 and the piano's both lit, struck once (${lit.slice(0, 6)})`);
    await page.click("#play"); await sleep(200);
    await ctx.close();
  }

  // ---------------------------------------------------------------- Z − / + are steps from the default
  if (run("Z")) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    let d = await D(page);
    const auto0 = d.sp;
    ok(d.step === 0 && d.mode === "fit" && Math.abs(auto0 - 820 / 90) < 0.01, `Z1 the default on an iPad Air in portrait: ${auto0} (${d.mode})`);
    await page.tap("#bigger"); await sleep(600);
    d = await D(page);
    ok(d.step === 1 && Math.abs(d.sp - auto0 * 1.15) < 0.02 && (await page.evaluate(() => localStorage.getItem("resonate.play.zoom"))) === "+1", `Z2 + : one step (${d.sp}), kept as "+1"`);
    await page.tap("#smaller"); await sleep(600);
    d = await D(page);
    ok(d.step === 0 && Math.abs(d.sp - auto0) < 1e-6 && (await page.evaluate(() => localStorage.getItem("resonate.play.zoom"))) === null, `Z3 + then − : the default again (${d.sp}), the pref removed`);
    await page.setViewportSize({ width: 1180, height: 820 }); await sleep(900);
    d = await D(page);
    const autoL = d.sp;
    await page.tap("#smaller"); await sleep(600);
    d = await D(page);
    ok(d.step === -1 && d.sp < autoL && Math.abs(d.sp - Math.max(5, autoL / 1.15)) < 0.02, `Z4 − in landscape: ${autoL} → ${d.sp}`);
    await page.setViewportSize({ width: 820, height: 1180 }); await sleep(900);
    d = await D(page);
    ok(d.step === -1 && Math.abs(d.sp - auto0 / 1.15) < 0.02 && d.sp < auto0, `Z5 … and portrait is one step under its own default too: ${d.sp} < ${auto0}`);
    await page.reload(); await ready(page);
    d = await D(page);
    ok(d.step === -1 && Math.abs(d.sp - auto0 / 1.15) < 0.02, `Z6 reloaded: still one step under (${d.sp})`);
    await page.tap("#bigger"); await sleep(600);
    d = await D(page);
    ok(d.step === 0 && Math.abs(d.sp - auto0) < 1e-6 && (await page.evaluate(() => localStorage.getItem("resonate.play.zoom"))) === null, `Z7 + : back to the default (${d.sp})`);
    // the full score has its own steps; a stale absolute size ("16", v79's first form) is ignored
    await page.evaluate(() => { localStorage.setItem("resonate.play.zoom", "16"); localStorage.setItem("resonate.play.size", "16"); });
    await page.reload(); await ready(page);
    d = await D(page);
    ok(d.step === 0 && Math.abs(d.sp - auto0) < 1e-6 && (await page.evaluate(() => localStorage.getItem("resonate.play.size"))) === null, `Z8 a stale "16" ignored, v78's pref removed (${d.sp})`);
    // the most steps: + to the cap disables +, − to 5 px disables −
    for (let i = 0; i < 12; i++) { if (await page.isDisabled("#bigger")) break; await page.tap("#bigger"); await sleep(350); }
    d = await D(page);
    ok(await page.isDisabled("#bigger") && d.sp <= d.cap + 0.01, `Z9 + up to the cap (${d.sp} ≤ ${d.cap.toFixed(2)}), then disabled`);
    for (let i = 0; i < 20; i++) { if (await page.isDisabled("#smaller")) break; await page.tap("#smaller"); await sleep(350); }
    d = await D(page);
    ok(await page.isDisabled("#smaller") && d.sp >= 5 - 1e-6 && d.sp < 5 * 1.16, `Z9 − down to 5 px (${d.sp}), then disabled`);
    await page.evaluate(() => localStorage.removeItem("resonate.play.zoom"));
    await ctx.close();
  }

  // ---------------------------------------------------------------- C the density against print
  if (run("C") && have.length) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await seed(page, have.map((n) => ({ name: n, xml: read(OWNER(n)) })));
    const ratios = [];
    for (const n of have) {
      await openSong(page, ids[n], "score");
      await page.evaluate(() => { for (let i = 0; i < 400 && window.resonateDebug().play.page > 1; i++) window.__key("ArrowLeft"); });
      const per = [];
      for (let k = 0; k < 200; k++) {
        await sleep(15);
        per.push(...(await page.evaluate(() => [...document.querySelectorAll("#stage .page g.system")].map((s) => s.querySelectorAll("g.measure").length))));
        const before = (await D(page)).page;
        await page.evaluate(() => window.__key("ArrowRight"));
        if ((await D(page)).page === before) break;
      }
      const pr = printed(read(OWNER(n)));
      const r = mean(per) / mean(pr);
      ratios.push(r);
      info(`C1 ${n}: ${mean(per).toFixed(2)} bars a system (print ${mean(pr).toFixed(2)}) ×${r.toFixed(2)}`);
      ok(r > 0.75 && r < 1.25, `C1 ${n}: ${mean(per).toFixed(2)} bars a system (print ${mean(pr).toFixed(2)}): ×${r.toFixed(2)}`);
    }
    const gm = Math.exp(mean(ratios.map(Math.log)));
    info(`C2 overall ×${gm.toFixed(3)}`);
    ok(gm > 0.9 && gm < 1.1, `C2 overall ×${gm.toFixed(3)} the printed bars a system`);
    await ctx.close();
  }

  // ---------------------------------------------------------------- F two systems a page in landscape
  if (run("F") && HAVE("pianoman")) {
    for (const [w, h] of [[1133, 744], [1180, 820]]) {
      const { ctx, page } = await newPage(browser, w, h, errors);
      const ids = await seed(page, [{ name: "pianoman", xml: read(OWNER("pianoman")) }]);
      await openSong(page, ids.pianoman, "score");
      const d = await D(page);
      let two = 0, n = 0;
      await page.evaluate(() => { for (let i = 0; i < 400 && window.resonateDebug().play.page > 1; i++) window.__key("ArrowLeft"); });
      for (let k = 0; k < 80; k++) {
        await sleep(10);
        const s = await page.evaluate(() => document.querySelectorAll("#stage .page g.system").length);
        n++; if (s >= 2) two++;
        const before = (await D(page)).page;
        await page.evaluate(() => window.__key("ArrowRight"));
        if ((await D(page)).page === before) break;
      }
      const floor = (d.keys?.shown ? d.H / (d.H + d.keys.rect[3]) : 1) * 0.9 * Math.min(w, h) / 90; // (v80: the keyboard's share of the height)
      info(`F1 ${w}×${h}: ${d.sp.toFixed(2)} px, ${d.mode}, ${two}/${n} two-system pages, ${d.pages} pages, fit ${JSON.stringify(d.fitLog)}`);
      ok(d.mode !== "one" && two / n >= 0.7 && d.sp >= floor - 0.01, `F1 Piano Man's Full score ${w}×${h}: ${d.sp.toFixed(2)} px (floor ${floor.toFixed(2)}), ${d.mode}, ${two}/${n} pages with two systems, ${d.pages} pages; fit ${JSON.stringify(d.fitLog)}`);
      await ctx.close();
    }
  }

  // ---------------------------------------------------------------- V narrow tablet windows
  if (run("V")) {
    for (const [w, h, sw, sh] of [[320, 1180, 820, 1180], [507, 1180, 820, 1180], [375, 760, 820, 1180], [590, 820, 1180, 820], [694, 1024, 1366, 1024], [820, 1180, 820, 1180]]) {
      const { ctx, page } = await newPage(browser, w, h, errors, { screen: { width: sw, height: sh } });
      const d = await D(page);
      const want = w < 700 ? Math.min(9.5, d.cap) : w / 90;
      ok(d.device === "tablet" && Math.abs(d.sp - want) < 0.02, `V1 an iPad window ${w}×${h} (screen ${sw}×${sh}): ${d.sp} (want ${want.toFixed(2)})`);
      await ctx.close();
    }
  }

  // ---------------------------------------------------------------- E a stretch ending at a page's last bar
  if (run("E") && K) {
    for (const view of ["score", "both"]) {
      const { ctx, page } = await newPage(browser, 820, 1180, errors);
      const ids = await seed(page, [{ name: "killing", xml: read(OWNER("killing")) }]);
      await page.evaluate((id) => localStorage.setItem("resonate.sing.timing", JSON.stringify({ [id]: { bpm: 300 } })), ids.killing);
      await openSong(page, ids.killing, view);
      const g = await geo(page);
      const sy = g[0].systems[g[0].systems.length - 1];
      const at0 = (await D(page)).at;
      await touchPath(ctx, page, line(colPt(sy, Math.max(0, sy.cols.length - 8)), colPt(sy, sy.cols.length - 1), 10));
      const span = (await PBD(page)).span;
      await page.tap("#play");
      await until(page, () => window.resonateDebug().play.playback.state === "playing");
      await until(page, () => window.resonateDebug().play.playback.state === "idle", null, 30000);
      await sleep(300);
      const d = await D(page), p = await PBD(page);
      ok(d.page === 1 && p.turns.length === 0 && d.at === at0 && p.bands.length >= 1, `E1 ${view}: a stretch to page 1's last onset (${JSON.stringify(span)}) played once: still page 1 (${d.page}), no turn (${JSON.stringify(p.turns)}), its band shown`);
      ok(!p.order || p.order.every((mi) => mi < 99), `E1 ${view}: its bars ${JSON.stringify(p.order)}`);
      await ctx.close();
    }
  }

  // ---------------------------------------------------------------- B lifted just short of a barline
  if (run("B") && K) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await seed(page, [{ name: "killing", xml: read(OWNER("killing")) }]);
    for (const view of ["both", "score"]) {
      await openSong(page, ids.killing, view);
      const g = await geo(page);
      const T = await page.evaluate(() => window.resonateDebug().play.playback.timeline().bars);
      const bl = await page.evaluate(() => {
        // each bar's right end on page 1 (its staff lines), and its system
        return [...document.querySelectorAll("#stage .page g.measure")].map((m) => { const p = m.querySelector(":scope > g.staff > path"); const r = p.getBoundingClientRect(); return { mi: Number(/^m(\d+)$/.exec(m.id)?.[1]), right: r.right, sys: [...document.querySelectorAll("#stage .page g.system")].indexOf(m.closest("g.system")) }; });
      });
      let good = 0, tried = 0;
      for (const sysI of [0, 1]) {
        const s = g[0].systems[sysI];
        const bars = bl.filter((b) => b.sys === sysI);
        for (const b of bars.slice(0, -1)) {
          for (const off of [-12, -6, -3]) {
            tried++;
            await touchPath(ctx, page, line(colPt(s, 0), [b.right + off, colPt(s, 0)[1]], 10));
            const p = await PBD(page);
            const nextStart = T[b.mi + 1].q;
            if (p.span && p.span.q1 < nextStart - 1e-6) good++;
            else info(`B1 ${view}: lifted ${off} px before bar ${b.mi + 1}'s barline: ${JSON.stringify(p.span)} (bar ${b.mi + 2} starts at ${nextStart})`);
          }
        }
      }
      ok(tried > 0 && good === tried, `B1 ${view}: lifted 3–12 px short of a barline, the stretch ends in that bar (${good}/${tried})`);
    }
    await ctx.close();
  }

  // ---------------------------------------------------------------- H the bar with the fewer-names chip
  // (v78's bar heights, measured on HEAD's play.html in this Chromium: [without, with the chip])
  if (run("H")) {
    const V78 = { 300: [165.9, 214.7], 320: [146.5, 195.3], 375: [146.5, 195.3], 390: [146.5, 195.3], 422: [149.7, 149.7], 430: [149.7, 149.7], 440: [149.7, 149.7], 442: [149.7, 149.7], 480: [184.9, 184.9], 626: [115.2, 115.2], 667: [115.2, 115.2], 674: [99.3, 115.2], 744: [99.3, 115.2], 820: [99.3, 115.2], 1024: [99.3, 115.2], 1133: [58.4, 58.4], 1180: [58.4, 58.4] };
    for (const [w, ref] of Object.entries(V78).map(([w, r]) => [Number(w), r])) {
      const hs = [];
      for (const chip of [false, true]) {
        const { ctx, page } = await newPage(browser, w, 900, errors, { before: chip ? () => localStorage.setItem("resonate.play", JSON.stringify({ "amazing-grace": { names: "all", days: { n: 5, ask: 3 } } })) : null });
        await sleep(200);
        hs.push(await page.evaluate(() => ({ bar: document.getElementById("bar").getBoundingClientRect().height, offer: !document.getElementById("offer").hidden, yes: document.getElementById("offer-yes")?.getAttribute("aria-label") || null })));
        if (chip && (w === 430 || w === 667)) await page.screenshot({ path: path.join(SHOTS, `H-${w}-chip.png`), clip: { x: 0, y: 0, width: w, height: 220 } });
        await ctx.close();
      }
      ok(hs[1].offer && hs[0].bar <= ref[0] + 0.5 && hs[1].bar <= ref[1] + 0.5 && hs[1].yes === "Fewer names: Some", `H1 ${w} px: the bar no taller than v78's, without / with the chip (${hs[0].bar.toFixed(1)} / ${hs[1].bar.toFixed(1)} vs ${ref}), the chip's button says what it does`);
    }
  }

  // ---------------------------------------------------------------- O an overfilled note is cut at the barline
  if (run("O") && K) {
    const { ctx, page } = await newPage(browser, 1180, 820, errors, { touch: false });
    const ids = await seed(page, [{ name: "killing", xml: read(OWNER("killing")) }]);
    await openSong(page, ids.killing, "score");
    const r = await page.evaluate(async () => {
      const PT = await import("./playtime.js?v=78");
      const T = window.resonateDebug().play.playback.timeline();
      const tr = PT.track(T, { bars: T.bars.map((_, i) => i), keep: () => true, base: 60 });
      const byId = new Map(tr.items.map((x) => [x.id, x]));
      const out = [];
      for (const e of T.els) {
        if (e.rest || e.grace || e.cue || e.midi == null || e.tieStart) continue;
        if (e.o + e.d > T.bars[e.mi].len + 1e-6) { const it = byId.get(e.id); const nb = tr.bars.find((m) => m.mi === e.mi + 1); out.push({ mi: e.mi, end: it && +(it.sec + it.hold).toFixed(3), next: nb?.sec }); }
      }
      return out;
    });
    ok(r.length > 0 && r.every((x) => x.end != null && Math.abs(x.end - x.next) < 0.002), `O1 Killing's overfilled notes end at the barline: ${JSON.stringify(r)}`);
    await ctx.close();
  }

  await browser.close();
  const real = errors.filter((e) => !/favicon|ERR_|net::/.test(e));
  ok(real.length === 0, `no page errors: ${JSON.stringify(real.slice(0, 5))}`);
  console.log(`${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
