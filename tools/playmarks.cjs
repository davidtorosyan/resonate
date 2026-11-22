// Play (E6): bookmarks — a stretch or a chord picked, saved with the stretch's 🔖 (#sel-mark), kept in
// the song's record (resonate.play[id].marks), a tab at each mark's start over its system's top staff
// (a tap selects it, never strikes), listed by the bar's 🔖 (#marks, hidden with no marks), and named
// to assistants in scoreState().marks.
//
//   M  play.html, an iPad in portrait (Amazing Grace in Both): no marks → no 🔖 in the bar; a drag's
//      stretch and a double-tap's chord saved, 🔖 pressed; a tap on a tab selects without a strike;
//      "Remove?" lapses after 3 s, two taps remove; the tab on the right system after − / + and a
//      rotation; scoreState().marks; the list (rows in score order, placeholders, ages, a label kept
//      across a reload, ▶ plays it — `used` —, ✕ two taps, Escape, a tap outside); another view still
//      shows a stretch mark; marks per song; at most 50; the bar back to its height with none
//   P  a phone: a mark on page 2, the list a bottom sheet, a row tap turns to page 2 and selects it
//   H  the one-page shell's Score (an iPad): a mark made there, the bar's 🔖, its list above the dock,
//      Escape, the device state
// The E6 review's fixes (each fails on 02823de):
//   V  a chord mark in Both, Melody draws part of it, back in Both: the whole chord, 🔖 pressed — no duplicate
//   K  notes above the staff (a ledger-line C6) at marks' starts: the tabs above their ink, a press on each
//      head strikes it, a double-tap picks C6; a press on a tab's edge nearer a head than the ribbon strikes
//   R  the song read again (one more note in bar 1: every later id moves): a chord mark found by its notes'
//      facts; one stored with ids only, and one whose note is gone, act as their stretches
//   E  two tabs: a mark made in one shows in the other, the other's saves keep it, a removal stays removed
//   X  Escape after a tap leaves the focus off 🔖 (Space doesn't reopen); the phone's sheet follows the
//      visual viewport's pan and a focused label; a mouse click on a tab after typing a label; assistants
//      get a chord's staff / part and from / to as the song is now
//   W  the bar with marks as tall as without: play.html and the shell's Score, 300–1440 px (STEP, 20) ×
//      chip / 📄 × touch / mouse
//   (M10: a tap on a note outside the list only closes it; M16: two marks with one id both kept)
//
// usage: node playmarks.cjs   (BASE=http://localhost:8097/resonate/, ONLY=M,P,H,V,K,R,E,X,W, STEP=20, SHOTS=0|<dir>)
const { chromium } = require("playwright");
const { ok, done, fail } = require("./lib/check.cjs");
const { BASE, SHOTS } = require("./lib/paths.cjs");
const { AG_BOTH } = require("./lib/both.cjs");
const path = require("path");
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const run = (s) => !ONLY || ONLY.has(s);
const sleep = (t) => new Promise((r) => setTimeout(r, t));
const EPS = 1e-6;
const shot = (page, name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, name + ".png") }) : null);

// every buffer source started (a strike or ▶), as playfocus.cjs
function INIT() {
  try { if (!navigator.audioSession) Object.defineProperty(navigator, "audioSession", { configurable: true, value: { type: "auto" } }); } catch {}
  window.__src = [];
  const S = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when = 0, ...a) { window.__src.push({ when, made: performance.now() }); return S.call(this, when, ...a); };
}
// play.js's own debug (play.html: resonateDebug; the shell: resonatePlay.debug)
const PD = (page) => page.evaluate(() => (window.resonatePlay?.debug || window.resonateDebug)().play);
const MK = (page) => page.evaluate(() => (window.resonatePlay?.debug || window.resonateDebug)().play.marks);
const PBD = (page) => page.evaluate(() => { const x = (window.resonatePlay?.debug || window.resonateDebug)().play.playback; return { state: x.state, kind: x.kind, span: x.span, bands: x.bands, scheduled: x.scheduled.length }; });
const ready = (page, view) => page.waitForFunction((v) => { const d = (window.resonatePlay?.debug || window.resonateDebug)?.().play; return d && d.ready && (!v || d.view === v); }, view, { timeout: 120000 });
const until = async (page, fn, arg, ms = 20000) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
const record = (page, id = "amazing-grace") => page.evaluate((id) => JSON.parse(localStorage.getItem("resonate.play") || "{}")[id] || null, id);
async function newPage(browser, w, h, { touch = true, url = "play.html", init = [] } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  await ctx.route("**/*.supabase.co/**", (r) => r.abort());
  await ctx.addInitScript(INIT);
  for (const f of init) await ctx.addInitScript(f);
  await ctx.addInitScript(AG_BOTH); // (Amazing Grace in Both: two staves, a hymn's two parts)
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|supabase|Failed to fetch|sync/i.test(m.text())) errors.push("console.error " + m.text().slice(0, 200)); });
  await page.goto(BASE + url);
  await ready(page);
  return { ctx, page, errors };
}
// CDP touch: a finger down, moves, up (client px)
async function touch(ctx, page, pts, { hold = 0, step = 16 } = {}) {
  const cdp = await ctx.newCDPSession(page);
  const t = (type, p) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ x: p[0], y: p[1], id: 1 }] : [] });
  await t("touchStart", pts[0]);
  if (hold) await sleep(hold);
  for (const p of pts.slice(1)) { await t("touchMove", p); await sleep(step); }
  if (pts.length > 1) { await t("touchMove", pts[pts.length - 1]); await sleep(150); }
  await t("touchEnd");
  await cdp.detach().catch(() => {});
}
const tap = (ctx, page, p, hold = 60) => touch(ctx, page, [p], { hold });
async function doubleTap(ctx, page, p) { await tap(ctx, page, p); await sleep(120); await tap(ctx, page, p); await sleep(250); }
const line = (a, b, n = 10) => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
// the drawn systems, client px: [{ page, systems: [{ top, bottom, left, right, cols: [[q, x0, x1]] }] }]
async function geo(page) {
  const g = await page.evaluate(() => (window.resonatePlay?.debug || window.resonateDebug)().play.playback.geo());
  return g.map((pg) => ({ page: pg.page, systems: pg.systems.map((s) => ({ ...s, top: s.top + pg.rect[1], bottom: s.bottom + pg.rect[1], left: s.left + pg.rect[0], right: s.right + pg.rect[0], cols: s.cols.map(([q, x0, x1]) => [q, x0 + pg.rect[0], x1 + pg.rect[0]]) })) }));
}
const colPt = (s, i) => [(s.cols[i][1] + s.cols[i][2]) / 2, s.top + 0.25 * (s.bottom - s.top)];
const onsets = (page) => page.evaluate(() => (window.resonatePlay?.debug || window.resonateDebug)().play.playback.onsets());
const headOf = (page, id) => page.evaluate((id) => { const g = document.querySelector(`#stage g.note[id="${id}"] > g.notehead`); const r = g.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, id);
// paper with no head within 40 px (a tap there lets go of the selection)
const blank = (page) => page.evaluate(() => {
  const heads = [...document.querySelectorAll("#stage .page g.notehead")].map((g) => { const r = g.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  const tabs = [...document.querySelectorAll("#stage .mtab, #selbar")].map((t) => t.getBoundingClientRect());
  const st = document.getElementById("stage").getBoundingClientRect();
  for (let y = st.top + 60; y < st.bottom - 140; y += 17) for (let x = st.left + 80; x < st.right - 80; x += 23)
    if (heads.every(([hx, hy]) => Math.hypot(hx - x, hy - y) > 40) && tabs.every((r) => x < r.left - 10 || x > r.right + 10 || y < r.top - 10 || y > r.bottom + 10)) return [x, y];
  return null;
});
// The tab of mark `id` placed where it belongs: over the top staff of the system holding its first
// onset in the view (q), centred on that onset's column, covering no head, name pill or accidental,
// and not into the system above (its bottom staff line). → { ok, why }
async function tabPlaced(page, id, q) {
  const [mk, G, d] = await Promise.all([MK(page), geo(page), PD(page)]);
  const t = mk.tabs.find((x) => x.id === id);
  let sys = null, col = null, prev = null;
  for (const pg of G) pg.systems.forEach((s, i) => { const c = s.cols.find((c) => Math.abs(c[0] - q) < EPS); if (c && !sys) { sys = s; col = c; prev = pg.systems[i - 1] || null; } });
  if (!t || !sys) return { ok: false, why: `tab ${!!t}, system ${!!sys}` };
  const [x, y, w, h] = t.ribbon, cx = x + w / 2, want = (col[1] + col[2]) / 2;
  const bottom = y + h;
  const covers = await page.evaluate((rb) => [...document.querySelectorAll("#stage .page g.notehead, #stage .page .nn, #stage .page g.accid")]
    .filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.left < rb[0] + rb[2] && r.right > rb[0] && r.top < rb[1] + rb[3] && r.bottom > rb[1]; }).length, t.ribbon);
  const good = Math.abs(cx - want) < 1.5 && bottom <= sys.top + 0.5 && bottom >= sys.top - 6 * d.sp && w >= 8 && !covers && (!prev || y > prev.bottom);
  return { ok: good, why: `ribbon x ${cx.toFixed(1)} (column ${want.toFixed(1)}), bottom ${bottom.toFixed(1)} over the system's top ${sys.top.toFixed(1)} (sp ${d.sp.toFixed(2)}), ${w}×${h}, covering ${covers} heads / pills / accidentals` };
}
const ribbonPt = (t) => [t.ribbon[0] + t.ribbon[2] / 2, t.ribbon[1] + t.ribbon[3] / 2];
const lgen = (page) => page.evaluate(() => window.resonatePlay.state().lgen);

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const errors = [];

  // ---------------------------------------------------------------- M play.html, an iPad in portrait
  if (run("M")) {
    let { ctx, page, errors: errs } = await newPage(browser, 820, 1180);
    errors.push(...errs);
    const barH = () => page.evaluate(() => document.getElementById("bar").getBoundingClientRect().height);
    let mk = await MK(page);
    const h0 = await barH();
    ok(!mk.list.length && !mk.listBtn.shown && !mk.tabs.length && await page.evaluate(() => document.getElementById("marks").hidden), `M0 no marks: the bar's 🔖 hidden, no tabs (bar ${h0} px)`);
    // a stretch on the first system's second half
    const s0 = (await geo(page))[0].systems[0];
    const n = s0.cols.length, ai = Math.floor(n / 2), zi = n - 2;
    await touch(ctx, page, line(colPt(s0, ai), colPt(s0, zi), 10));
    let p = await PBD(page);
    mk = await MK(page);
    ok(p.span && !p.span.note && mk.button.shown && !mk.button.pressed && mk.button.label === "Bookmark", `M1 a drag picks a stretch: 🔖 in its controls, not pressed (${JSON.stringify(p.span)})`);
    const t0 = Date.now();
    await page.tap("#sel-mark");
    await sleep(150);
    mk = await MK(page);
    let rec = await record(page);
    const A = mk.list[0], st = await page.evaluate(() => window.resonatePlay.scoreState().selection);
    ok(mk.list.length === 1 && Math.abs(A.q0 - p.span.q0) < EPS && Math.abs(A.end - p.span.end) < EPS && !A.ids && A.label === "" && A.at >= t0 - 1000 && A.used === 0 && /^[a-z0-9]{4,}$/.test(A.id),
      `M1 a tap saves it at once: ${JSON.stringify(A)}`);
    ok(JSON.stringify(A.from) === JSON.stringify(st.start) && JSON.stringify(A.to) === JSON.stringify(st.end), `M1 from / to as the selection's start / end (bar number, beat): ${JSON.stringify([A.from, A.to])} vs ${JSON.stringify([st.start, st.end])}`);
    ok(rec?.marks?.length === 1 && rec.marks[0].id === A.id && rec.view === "both", `M1 written in the song's record (resonate.play["amazing-grace"].marks)`);
    ok(mk.button.pressed && mk.sel === A.id && mk.listBtn.shown && mk.tabs.length === 1 && mk.tabs[0].on, `M1 🔖 pressed, the bar's 🔖 shown, one tab, lit (${JSON.stringify(mk.tabs)})`);
    let tp = await tabPlaced(page, A.id, p.span.q0);
    ok(tp.ok, `M1 the tab over the system's top staff at its first onset: ${tp.why}`);
    await shot(page, "M1-stretch");
    // a chord: a double-tap on n4 (the hymn's first full bar, treble), then 🔖
    await tap(ctx, page, await headOf(page, "n12")); await sleep(600); // (the audio started by a first tap)
    await doubleTap(ctx, page, await headOf(page, "n4"));
    p = await PBD(page);
    mk = await MK(page);
    ok(p.span?.note && !mk.button.pressed, `M2 a double-tap picks a chord: not a mark yet (${JSON.stringify(p.span?.note)})`);
    await page.tap("#sel-mark");
    await sleep(150);
    mk = await MK(page);
    const B = mk.list.find((m) => m.ids);
    ok(mk.list.length === 2 && B && JSON.stringify([...B.ids].sort()) === JSON.stringify([...p.span.note.ids].sort()) && Math.abs(B.q0 - p.span.q0) < EPS && Math.abs(B.end - p.span.end) < EPS && mk.button.pressed && mk.sel === B.id,
      `M2 a chord mark: its notes kept (${JSON.stringify(B)}), 🔖 pressed`);
    // a tap on paper lets go; a tap on the stretch's tab selects it — no strike
    await tap(ctx, page, await blank(page)); await sleep(300);
    ok(!(await PBD(page)).span, "M3 a tap on paper lets go");
    await sleep(500);
    const tabA = (await MK(page)).tabs.find((t) => t.id === A.id);
    const before = await page.evaluate(() => ({ peeks: (window.resonateDebug)().play.peekLog.length, src: window.__src.length }));
    const near = await page.evaluate(([x, y]) => Math.min(...[...document.querySelectorAll("#stage .page g.notehead")].map((g) => { const r = g.getBoundingClientRect(); return Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y); })), ribbonPt(tabA));
    await tap(ctx, page, ribbonPt(tabA));
    await sleep(400);
    p = await PBD(page);
    mk = await MK(page);
    const after = await page.evaluate(() => ({ peeks: (window.resonateDebug)().play.peekLog.length, src: window.__src.length, peek: (window.resonateDebug)().play.peek }));
    ok(p.span && !p.span.note && Math.abs(p.span.q0 - A.q0) < EPS && Math.abs(p.span.end - A.end) < EPS && p.bands.length >= 1 && mk.sel === A.id && mk.button.pressed,
      `M3 a tap on its tab selects the stretch, as a drag picking it (${JSON.stringify(p.span)}, ${p.bands.length} band)`);
    ok(after.peeks === before.peeks && after.src === before.src, `M3 …and strikes nothing (peeks ${before.peeks} → ${after.peeks}, sources ${before.src} → ${after.src}; the nearest head ${near.toFixed(0)} px away)`);
    // the chord's tab: its chord selected
    const tabB = (await MK(page)).tabs.find((t) => t.id === B.id);
    await tap(ctx, page, ribbonPt(tabB)); await sleep(400);
    p = await PBD(page);
    ok(p.span?.note && JSON.stringify([...p.span.note.ids].sort()) === JSON.stringify([...B.ids].sort()) && (await MK(page)).sel === B.id, `M3 the chord's tab selects the chord (${JSON.stringify(p.span?.note)})`);
    // two taps to remove: one lapses after 3 s, two within 3 s remove
    await page.tap("#sel-mark"); await sleep(100);
    mk = await MK(page);
    const armedNow = mk.button.armed && mk.button.label === "Remove?" && mk.list.length === 2;
    await sleep(3300);
    mk = await MK(page);
    ok(armedNow && !mk.button.armed && mk.button.label === "Bookmark" && mk.button.pressed && mk.list.length === 2, `M4 a tap on a pressed 🔖 reads "Remove?"; it lapses after 3 s (${JSON.stringify(mk.button)})`);
    await page.tap("#sel-mark"); await sleep(400); await page.tap("#sel-mark"); await sleep(150);
    mk = await MK(page);
    rec = await record(page);
    ok(mk.list.length === 1 && mk.list[0].id === A.id && !mk.button.pressed && !mk.button.armed && rec.marks.length === 1 && !mk.tabs.some((t) => t.id === B.id) && (await PBD(page)).span?.note,
      `M4 two taps within 3 s remove it: the stretch's left, the chord still picked, 🔖 not pressed`);
    // −/+ and a rotation: the tab on the right system
    let g = await lgen(page);
    await page.click("#bigger");
    await until(page, (g) => window.resonatePlay.state().lgen !== g && window.resonatePlay.state().ready, g);
    await sleep(300);
    tp = await tabPlaced(page, A.id, A.q0);
    ok(tp.ok, `M5 after +: ${tp.why}`);
    g = await lgen(page);
    await page.click("#smaller");
    await until(page, (g) => window.resonatePlay.state().lgen !== g && window.resonatePlay.state().ready, g);
    await sleep(300);
    // a stretch mark on a later system too
    let G = (await geo(page))[0].systems;
    const s2 = G[Math.min(2, G.length - 1)];
    await touch(ctx, page, line(colPt(s2, 1), colPt(s2, Math.min(4, s2.cols.length - 1)), 8));
    await page.tap("#sel-mark"); await sleep(150);
    mk = await MK(page);
    const C = mk.list.find((m) => m.id !== A.id);
    tp = await tabPlaced(page, C.id, C.q0);
    ok(mk.list.length === 2 && tp.ok, `M5 a mark on system ${G.indexOf(s2) + 1}: ${tp.why}`);
    g = await lgen(page);
    await page.setViewportSize({ width: 1180, height: 820 });
    await until(page, (g) => window.resonatePlay.state().lgen !== g && window.resonatePlay.state().ready, g);
    await sleep(500);
    for (const m of [A, C]) {
      const shownQs = (await geo(page)).flatMap((x) => x.systems.flatMap((s) => s.cols.map((c) => c[0])));
      if (!shownQs.some((q) => Math.abs(q - m.q0) < EPS)) { ok(!(await MK(page)).tabs.some((t) => t.id === m.id), `M5 rotated: ${m.id}'s start isn't on the page shown — no tab`); continue; }
      tp = await tabPlaced(page, m.id, m.q0);
      ok(tp.ok, `M5 rotated (1180×820): ${m.id} ${tp.why}`);
    }
    await shot(page, "M5-landscape");
    g = await lgen(page);
    await page.setViewportSize({ width: 820, height: 1180 });
    await until(page, (g) => window.resonatePlay.state().lgen !== g && window.resonatePlay.state().ready, g);
    await sleep(400);
    // scoreState().marks: kind, from / to, label, used (none yet)
    let ss = await page.evaluate(() => window.resonatePlay.scoreState().marks);
    ok(Array.isArray(ss) && ss.length === 2 && ss.every((x) => x.kind === "stretch" && x.from?.bar && x.to?.bar && x.label === "" && x.used === null && Object.keys(x).sort().join() === "from,kind,label,to,used")
      && JSON.stringify(ss[0].from) === JSON.stringify(A.from), `M6 scoreState().marks: ${JSON.stringify(ss)}`);
    // a chord mark again (for the list), then the list
    await sleep(500);
    await doubleTap(ctx, page, await headOf(page, "n4"));
    await page.tap("#sel-mark"); await sleep(150);
    mk = await MK(page);
    const B2 = mk.list.find((m) => m.ids);
    await page.tap("#marks"); await sleep(250);
    mk = await MK(page);
    const order = [...mk.list].sort((a, b) => a.q0 - b.q0 || a.end - b.end).map((m) => m.id);
    const nums = await page.evaluate(() => fetch("songs/amazing-grace.musicxml").then((r) => r.text()).then((x) => {
      const d = new DOMParser().parseFromString(x, "application/xml"), p = d.querySelector("part");
      return [...p.children].filter((c) => c.nodeName === "measure").map((m, i) => m.getAttribute("number") || String(i + 1));
    }));
    const T = await page.evaluate(() => window.resonateDebug().play.playback.timeline());
    const barAt = (q) => { let i = 0; while (i + 1 < T.bars.length && T.bars[i + 1].q <= q + EPS) i++; return i; };
    const wantPh = (m) => m.ids ? `Bar ${m.from.bar} · beat ${m.from.beat}` : barAt(m.q0) === barAt(m.end - 1e-4) ? `Bar ${nums[barAt(m.q0)]}` : `Bars ${nums[barAt(m.q0)]}–${nums[barAt(m.end - 1e-4)]}`;
    ok(mk.open && !mk.sheet && mk.rows.length === 3 && JSON.stringify(mk.rows.map((r) => r.id)) === JSON.stringify(order), `M7 the list: 3 rows in score order (${mk.rows.map((r) => r.placeholder).join(" | ")})`);
    ok(mk.rows.every((r) => r.placeholder === wantPh(mk.list.find((m) => m.id === r.id)) && r.age === "today" && r.label === "" && r.del === "✕") && mk.rows.find((r) => r.id === B2.id).on,
      `M7 each row: the bars as its placeholder, its age, the selection's row lit (${JSON.stringify(mk.rows.map((r) => [r.placeholder, r.age, r.on]))})`);
    const btn = await page.evaluate(() => { const b = document.getElementById("marks").getBoundingClientRect(), l = document.getElementById("marklist").getBoundingClientRect(); return { b: [b.left, b.bottom, b.right], l: [l.left, l.top, l.right, l.bottom], vw: innerWidth, vh: innerHeight }; });
    ok(btn.l[1] >= btn.b[1] && btn.l[1] - btn.b[1] < 20 && btn.l[0] >= 0 && btn.l[2] <= btn.vw && btn.l[3] <= btn.vh, `M7 a popover under the bar's 🔖, inside the window (${JSON.stringify(btn)})`);
    const small = await page.evaluate(() => [...document.querySelectorAll("#marklist button")].filter((b) => { const r = b.getBoundingClientRect(); return r.width < 43.5 || r.height < 43.5; }).length);
    ok(!small, `M7 its buttons ≥ 44 px (${small} smaller)`);
    await shot(page, "M7-list");
    // a label typed, Enter: saved; a reload keeps it
    const firstRow = `#marklist .mrow[data-id="${order[0]}"] input`;
    await page.tap(firstRow);
    await page.fill(firstRow, "  Verse   one opening ");
    await page.press(firstRow, "Enter");
    await sleep(150);
    rec = await record(page);
    mk = await MK(page);
    const focusedOut = await page.evaluate(() => !document.activeElement?.matches?.("#marklist input"));
    ok(rec.marks.find((m) => m.id === order[0])?.label === "Verse one opening" && focusedOut && mk.tabs.find((t) => t.id === order[0]) && await page.evaluate((id) => document.querySelector(`#stage .mtab[data-id="${id}"]`)?.title, order[0]) === "Verse one opening",
      `M8 a label typed, Enter: blurred, saved (trimmed), the tab named by it`);
    // ▶ in a row: selected, played once, used
    const t1 = Date.now();
    await page.tap(`#marklist .mrow[data-id="${order[0]}"] .mplay`);
    await until(page, () => window.resonateDebug().play.playback.state === "playing" && window.resonateDebug().play.playback.scheduled.length > 0, null, 8000);
    p = await PBD(page);
    mk = await MK(page);
    const M0 = mk.list.find((m) => m.id === order[0]);
    ok(!mk.open && p.state === "playing" && p.kind === "span" && Math.abs(p.span.q0 - M0.q0) < EPS && Math.abs(p.span.end - M0.end) < EPS && mk.sel === M0.id, `M9 a row's ▶: the list closes, the mark selected and played once (${p.state}, ${p.kind}, ${JSON.stringify(p.span)})`);
    ok(M0.used >= t1 - 1000 && (await record(page)).marks.find((m) => m.id === M0.id).used === M0.used, `M9 …its "used" kept (${M0.used})`);
    ss = await page.evaluate(() => window.resonatePlay.scoreState().marks);
    ok(ss.length === 3 && ss.some((x) => x.label === "Verse one opening" && x.used && !isNaN(Date.parse(x.used))) && ss.some((x) => x.kind === "note"), `M9 scoreState().marks: its label and used (ISO), the chord as "note" (${JSON.stringify(ss)})`);
    await page.click("#play"); await sleep(200); // (■)
    // ⟳ on a mark: used too
    await sleep(1100);
    const used0 = (await MK(page)).list.find((m) => m.id === M0.id).used;
    await page.tap("#sel-loop"); await sleep(300);
    const used1 = (await MK(page)).list.find((m) => m.id === M0.id).used;
    await page.tap("#sel-loop"); await sleep(200);
    ok(used1 > used0, `M9 ⟳ on it counts as played too (${used0} → ${used1})`);
    // Escape and a tap outside close it
    await page.tap("#marks"); await sleep(200);
    const opened = (await MK(page)).open;
    await page.keyboard.press("Escape"); await sleep(150);
    mk = await MK(page);
    ok(opened && !mk.open && (await PBD(page)).span, `M10 Escape closes the list (the selection stays)`);
    await page.tap("#marks"); await sleep(200);
    const spanBefore = (await PBD(page)).span, src0 = await page.evaluate(() => ({ src: window.__src.length, peeks: window.resonateDebug().play.peekLog.length }));
    const outside = await page.evaluate(() => {
      const l = document.getElementById("marklist").getBoundingClientRect();
      for (const g of document.querySelectorAll("#stage .page g.note > g.notehead")) { const r = g.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; if (y > l.bottom + 30) return [x, y]; }
      return null;
    });
    await tap(ctx, page, outside); await sleep(300);
    const src1 = await page.evaluate(() => ({ src: window.__src.length, peeks: window.resonateDebug().play.peekLog.length }));
    ok(!(await MK(page)).open && src1.src === src0.src && src1.peeks === src0.peeks && JSON.stringify((await PBD(page)).span) === JSON.stringify(spanBefore),
      `M10 a tap on a note outside the list only closes it: nothing struck (sources ${src0.src} → ${src1.src}, peeks ${src0.peeks} → ${src1.peeks}), the selection kept`);
    await sleep(500);
    // a row's ✕: two taps (one lapses)
    await page.tap("#marks"); await sleep(200);
    const delSel = `#marklist .mrow[data-id="${order[2]}"] .mdel`;
    await page.tap(delSel); await sleep(100);
    mk = await MK(page);
    const armedRow = mk.rows.find((r) => r.id === order[2]).del === "Remove?";
    await sleep(3300);
    mk = await MK(page);
    ok(armedRow && mk.rows.find((r) => r.id === order[2])?.del === "✕" && mk.list.length === 3, `M11 a row's ✕ reads "Remove?", lapses after 3 s`);
    await page.tap(delSel); await sleep(300); await page.tap(delSel); await sleep(200);
    mk = await MK(page);
    ok(mk.list.length === 2 && !mk.list.some((m) => m.id === order[2]) && mk.open && mk.rows.length === 2, `M11 two taps remove it; the list stays open (${mk.rows.length} rows)`);
    // a row tap (not its controls): closes, selects
    await page.tap(`#marklist .mrow[data-id="${order[1]}"] .mgo`); await sleep(300);
    mk = await MK(page);
    p = await PBD(page);
    const M1 = mk.list.find((m) => m.id === order[1]);
    ok(!mk.open && mk.sel === order[1] && Math.abs(p.span.q0 - M1.q0) < EPS, `M12 a tap on the row selects it (${JSON.stringify(p.span)})`);
    // another view: a stretch mark still shown and selectable
    const stretch = mk.list.find((m) => !m.ids);
    await page.selectOption("#hands", "rh"); await ready(page, "rh"); await sleep(400);
    const rhQs = await onsets(page);
    const firstRh = rhQs.find((q) => q >= stretch.q0 - EPS);
    tp = await tabPlaced(page, stretch.id, firstRh);
    mk = await MK(page);
    ok(tp.ok, `M13 Right hand: the stretch mark's tab at its first onset there — ${tp.why}`);
    await tap(ctx, page, await blank(page)); await sleep(500);
    const tabR = mk.tabs.find((t) => t.id === stretch.id);
    await tap(ctx, page, ribbonPt(tabR)); await sleep(300);
    p = await PBD(page);
    mk = await MK(page);
    ok(p.span && !p.span.note && Math.abs(p.span.q0 - stretch.q0) < EPS && Math.abs(p.span.end - stretch.end) < EPS && mk.sel === stretch.id && mk.button.pressed, `M13 …a tap selects it there (${JSON.stringify(p.span)})`);
    await page.selectOption("#hands", "both"); await ready(page, "both"); await sleep(300);
    // a reload: the label and the marks kept
    await page.reload(); await ready(page); await sleep(300);
    await page.tap("#marks"); await sleep(250);
    mk = await MK(page);
    ok(mk.list.length === 2 && mk.rows.find((r) => r.id === order[0])?.label === "Verse one opening" && mk.tabs.length >= 1, `M14 a reload: the marks and the label kept (${JSON.stringify(mk.rows.map((r) => r.label || r.placeholder))})`);
    await page.keyboard.press("Escape");
    // marks per song: another song has none
    const id2 = await page.evaluate(async () => {
      const v = document.getElementById("version").textContent.trim().replace(/^v/, "");
      const L = await import(`./library.js?v=${v}`);
      const xml = await fetch("songs/amazing-grace.musicxml").then((r) => r.text());
      const id = await L.addSong("Second song", xml, { source: "file" });
      const all = JSON.parse(localStorage.getItem("resonate.play") || "{}");
      all[id] = { view: "both" };
      localStorage.setItem("resonate.play", JSON.stringify(all));
      return id;
    });
    await page.reload(); await ready(page); await sleep(300);
    await page.selectOption("#song", id2);
    await until(page, (id) => { const d = window.resonateDebug().play; return d.song === id && d.ready; }, id2, 60000);
    await sleep(300);
    mk = await MK(page);
    ok(!mk.list.length && !mk.listBtn.shown && !mk.tabs.length, "M15 another song: no marks, no 🔖 in the bar, no tabs");
    const s0b = (await geo(page))[0].systems[0];
    await touch(ctx, page, line(colPt(s0b, 1), colPt(s0b, 3), 6));
    await page.tap("#sel-mark"); await sleep(150);
    const r2 = await record(page, id2), r1 = await record(page);
    ok(r2?.marks?.length === 1 && r1.marks.length === 2 && !r1.marks.some((m) => m.id === r2.marks[0].id), `M15 a mark made there is that song's (${r2?.marks?.length} / ${r1.marks.length})`);
    await page.selectOption("#song", "amazing-grace");
    await until(page, () => { const d = window.resonateDebug().play; return d.song === "amazing-grace" && d.ready; }, null, 60000);
    await sleep(300);
    mk = await MK(page);
    ok(mk.list.length === 2 && mk.listBtn.shown, `M15 back: Amazing Grace's two marks`);
    // at most 50: seeded (with a broken entry and a duplicate id) while the page is away (its pagehide
    // writes the record it holds), then back; the 51st is refused
    await page.goto(BASE + "no-such-page.html"); // (this origin, no play.js)
    await page.evaluate((A) => {
      const all = JSON.parse(localStorage.getItem("resonate.play"));
      const list = Array.from({ length: 50 }, (_, i) => ({ ...A, id: "s" + i, q0: A.q0, end: A.end + 0.0001 * (i + 1) }));
      all["amazing-grace"].marks = [{ q0: 4, end: 2 }, { id: "s0", q0: "x" }, { ...A, id: "dup" }, { ...A, id: "dup", end: A.end + 1 }, ...list];
      localStorage.setItem("resonate.play", JSON.stringify(all));
    }, A);
    await page.goto(BASE + "play.html"); await ready(page); await sleep(300);
    mk = await MK(page);
    const dups = mk.list.filter((m) => Math.abs(m.q0 - A.q0) < EPS && (Math.abs(m.end - A.end) < EPS || Math.abs(m.end - A.end - 1) < EPS));
    ok(mk.list.length === 50 && new Set(mk.list.map((m) => m.id)).size === 50 && dups.length === 2 && dups[0].id !== dups[1].id && dups.some((m) => m.id === "dup"),
      `M16 a stored list read back checked: the broken entries left out, two marks with one id both kept under two ids (${JSON.stringify(dups.map((m) => m.id))}), 50 (${mk.list.length})`);
    G = (await geo(page))[0].systems;
    const s1 = G[1];
    await touch(ctx, page, line(colPt(s1, 0), colPt(s1, 2), 6));
    await page.tap("#sel-mark"); await sleep(150);
    mk = await MK(page);
    ok(mk.list.length === 50 && !mk.button.pressed, "M16 …the 51st isn't saved (a shake)");
    // none left: the bar as it was
    await page.goto(BASE + "no-such-page.html"); // (this origin, no play.js)
    await page.evaluate(() => { const all = JSON.parse(localStorage.getItem("resonate.play")); delete all["amazing-grace"].marks; localStorage.setItem("resonate.play", JSON.stringify(all)); });
    await page.goto(BASE + "play.html"); await ready(page); await sleep(300);
    mk = await MK(page);
    ok(!mk.listBtn.shown && !mk.tabs.length && await barH() === h0, `M17 no marks again: no 🔖, the bar's height as before (${await barH()} vs ${h0})`);
    errors.push(...errs.filter((e) => !errors.includes(e)));
    await ctx.close();
  }

  // ---------------------------------------------------------------- P a phone: the list as a bottom sheet, a row turns the page
  if (run("P")) {
    const { ctx, page, errors: errs } = await newPage(browser, 390, 844);
    const d0 = await PD(page);
    await page.click("#next"); await sleep(400);
    const s0 = (await geo(page))[0].systems[0];
    await touch(ctx, page, line(colPt(s0, 1), colPt(s0, Math.min(4, s0.cols.length - 1)), 8));
    // (the keyboard off on a phone: the chips for ▶ in the stretch's controls, before the 🔖)
    const sb = await page.evaluate(() => {
      const r = (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
      const st = r(document.getElementById("stage")), bar = r(document.getElementById("selbar")), mark = r(document.getElementById("sel-mark"));
      const kids = [...document.getElementById("selbar").children].filter((e) => !e.hidden).map((e) => e.id);
      return { st, bar, mark, kids, chips: document.querySelectorAll("#selbar #hear button").length };
    });
    const inside = (a, b) => a[0] >= b[0] - 0.5 && a[1] >= b[1] - 0.5 && a[2] <= b[2] + 0.5 && a[3] <= b[3] + 0.5;
    ok(sb.chips === 2 && JSON.stringify(sb.kids) === JSON.stringify(["sel-loop", "speed", "hear", "sel-mark", "sel-clear"]) && inside(sb.bar, sb.st) && inside(sb.mark, sb.bar) && sb.mark[2] - sb.mark[0] >= 43.5,
      `P0 a phone: ⟳ speed, the chips, 🔖, ✕ — inside the stage (${JSON.stringify(sb)})`);
    await page.tap("#sel-mark"); await sleep(150);
    let mk = await MK(page);
    const m = mk.list[0];
    const p2 = (await PD(page)).page;
    await tap(ctx, page, await blank(page)); await sleep(200);
    await page.click("#prev"); await sleep(400);
    ok(d0.pages >= 2 && p2 === 2 && mk.list.length === 1 && (await PD(page)).page === 1 && !(await MK(page)).tabs.length, `P1 a mark on page 2 of ${d0.pages}; on page 1 no tab`);
    await page.tap("#marks"); await sleep(250);
    mk = await MK(page);
    const vw = 390, vh = await page.evaluate(() => innerHeight);
    ok(mk.open && mk.sheet && Math.abs(mk.rect[0]) < 1 && Math.abs(mk.rect[2] - vw) < 1 && Math.abs(mk.rect[1] + mk.rect[3] - vh) < 1, `P2 a phone: a bottom sheet (${JSON.stringify(mk.rect)})`);
    await shot(page, "P2-sheet");
    await page.tap(`#marklist .mrow[data-id="${m.id}"] .mage`); await sleep(400);
    const d = await PD(page), p = await PBD(page);
    mk = await MK(page);
    ok(!mk.open && d.page === 2 && p.span && Math.abs(p.span.q0 - m.q0) < EPS && Math.abs(p.span.end - m.end) < EPS && mk.sel === m.id && mk.tabs.some((t) => t.id === m.id && t.on),
      `P3 a row tap turns to page 2 and selects it (page ${d.page}, ${JSON.stringify(p.span)})`);
    errors.push(...errs);
    await ctx.close();
  }

  // ---------------------------------------------------------------- H the one-page shell's Score (an iPad)
  if (run("H")) {
    const seed = () => { try { if (location.protocol !== "about:" && !sessionStorage.getItem("__seeded")) { sessionStorage.setItem("__seeded", "1"); localStorage.setItem("resonate.sing.song", "amazing-grace"); } } catch {} };
    const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    await ctx.route("**/*.supabase.co/**", (r) => r.abort());
    await ctx.addInitScript(INIT);
    await ctx.addInitScript(seed);
    await ctx.addInitScript(AG_BOTH);
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push("pageerror " + e.message));
    await page.goto(BASE + "index.html?open=score");
    const shown = await until(page, () => { const P = window.resonatePlay; return P?.debug && P.state?.().ready && P.state().song === "amazing-grace"; }, null, 90000);
    await sleep(1200); // (the modules slid in)
    let mk = shown ? await MK(page) : null;
    ok(shown && mk && !mk.listBtn.shown, "H1 the shell's Score: Amazing Grace drawn, no marks — no 🔖 in its bar");
    const s0 = (await geo(page))[0].systems[0];
    await touch(ctx, page, line(colPt(s0, 2), colPt(s0, Math.min(6, s0.cols.length - 1)), 8));
    await page.tap("#score-region #sel-mark"); await sleep(200);
    mk = await MK(page);
    const st = await page.evaluate(() => window.resonatePlay.scoreState());
    ok(mk.list.length === 1 && mk.button.pressed && mk.tabs.length === 1 && mk.listBtn.shown && st.marks.length === 1 && st.marks[0].kind === "stretch",
      `H2 a mark made in the shell: saved, 🔖 pressed, its tab, the bar's 🔖, the device state (${JSON.stringify(st.marks)})`);
    const inBar = await page.evaluate(() => !!document.querySelector("#score-region #bar .pager #marks") && !!document.querySelector("#score-region #bar #marklist"));
    await page.tap("#score-region #marks"); await sleep(300);
    mk = await MK(page);
    const top = await page.evaluate(() => {
      const l = document.getElementById("marklist").getBoundingClientRect();
      const hit = document.elementFromPoint(l.left + l.width / 2, l.top + Math.min(l.height - 4, 26));
      const r = document.getElementById("marks").getBoundingClientRect();
      return { hit: hit?.id || hit?.className?.baseVal || hit?.className || hit?.tagName, inside: !!hit?.closest("#marklist"), z: getComputedStyle(document.getElementById("marklist")).zIndex, under: l.top >= r.bottom - 1, rect: [l.left, l.top, l.width, l.height] };
    });
    ok(inBar && mk.open && mk.rows.length === 1 && top.inside && top.under, `H3 its list opens under the bar's 🔖, on top (z ${top.z}, ${JSON.stringify(top.rect)}, inside ${top.inside}, under ${top.under}, hit ${top.hit})`);
    await shot(page, "H3-shell-list");
    await page.keyboard.press("Escape"); await sleep(200);
    const still = await page.evaluate(() => window.resonatePlay.state().song);
    ok(!(await MK(page)).open && still === "amazing-grace", "H4 Escape closes it (the song stays open)");
    // a tap on its tab, after letting go: selected, nothing struck
    await tap(ctx, page, await blank(page)); await sleep(500);
    mk = await MK(page);
    const before = await page.evaluate(() => window.__src.length);
    await tap(ctx, page, ribbonPt(mk.tabs[0])); await sleep(300);
    const p = await PBD(page);
    ok(p.span && Math.abs(p.span.q0 - mk.list[0].q0) < EPS && (await page.evaluate(() => window.__src.length)) === before, `H5 a tap on its tab selects it, no strike (${JSON.stringify(p.span)})`);
    errors.push(...errs);
    await ctx.close();
  }

  // ---------------------------------------------------------------- V a chord mark across views (Both → Melody → Both)
  if (run("V")) {
    const { ctx, page, errors: errs } = await newPage(browser, 820, 1180);
    await tap(ctx, page, await headOf(page, "n12")); await sleep(600);
    await doubleTap(ctx, page, await headOf(page, "n4"));
    await page.tap("#sel-mark"); await sleep(150);
    let mk = await MK(page);
    const m = mk.list[0];
    await page.selectOption("#hands", "melody"); await ready(page, "melody"); await sleep(300);
    let p = await PBD(page);
    mk = await MK(page);
    const inMelody = p.span?.note?.ids?.join() === "n4" && mk.sel === m.id && mk.button.pressed;
    await page.selectOption("#hands", "both"); await ready(page, "both"); await sleep(300);
    p = await PBD(page);
    mk = await MK(page);
    ok(inMelody && JSON.stringify([...(p.span?.note?.ids || [])].sort()) === JSON.stringify([...m.ids].sort()) && mk.sel === m.id && mk.button.pressed,
      `V1 a chord mark in Both, Melody draws its tune note (pressed), back in Both the whole chord again, pressed (${JSON.stringify(p.span?.note)})`);
    await page.tap("#sel-mark"); await sleep(150);
    mk = await MK(page);
    ok(mk.list.length === 1 && mk.button.armed, `V1 …so 🔖 offers "Remove?", no second mark (${mk.list.length} mark)`);
    await sleep(3200);
    errors.push(...errs);
    await ctx.close();
  }

  // ---------------------------------------------------------------- K notes above the staff under a mark's tab
  if (run("K")) {
    const { ctx, page, errors: errs } = await newPage(browser, 820, 1180);
    // (a flute part, high: A5 G5 C6 B5 E5 …; marks starting at A5, G5, C6, B5)
    const note = (step, oct, id) => `<note id="${id}"><pitch><step>${step}</step><octave>${oct}</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>`;
    const seq = [["C", 5], ["A", 5], ["G", 5], ["C", 6], ["E", 5], ["B", 5], ["D", 5], ["C", 6]];
    let n = 0;
    const bars = [];
    for (let b = 1; b <= 8; b++) bars.push(`<measure number="${b}">${b === 1 ? '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' : ""}${[0, 1, 2, 3].map((i) => { const [st, o] = seq[((b - 1) * 4 + i) % seq.length]; return note(st, o, "x" + ++n); }).join("")}</measure>`);
    const xml = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><work><work-title>High</work-title></work><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list><part id="P1">${bars.join("")}</part></score-partwise>`;
    const id = await page.evaluate(async (xml) => {
      const v = document.getElementById("version").textContent.trim().slice(1);
      const L = await import(`./library.js?v=${v}`);
      const id = await L.addSong("High", xml, { source: "file" });
      const all = JSON.parse(localStorage.getItem("resonate.play") || "{}");
      all[id] = { names: "some", marks: [1, 2, 3, 5].map((q, i) => ({ id: "hi" + i, q0: q, end: q + 1, label: "", at: Date.now(), used: 0 })) };
      localStorage.setItem("resonate.play", JSON.stringify(all));
      return id;
    }, xml);
    await page.reload(); await ready(page);
    await page.selectOption("#song", id);
    await until(page, (id) => { const d = window.resonateDebug().play; return d.song === id && d.ready; }, id, 60000);
    await sleep(400);
    const heads = ["x2", "x3", "x4", "x6"];
    let bad = [];
    for (const [i, h] of heads.entries()) { const tp = await tabPlaced(page, "hi" + i, i === 3 ? 5 : i + 1); if (!tp.ok) bad.push(`${h}: ${tp.why}`); }
    const hitTab = await page.evaluate((ids) => ids.filter((id) => { const r = document.querySelector(`#stage g.note[id="${id}"] .notehead`).getBoundingClientRect(); return !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest(".mtab"); }), heads);
    ok(!bad.length && !hitTab.length, `K1 tabs over A5, G5, C6 (two ledger lines), B5: above their heads and pills, none under a head's centre (${bad.join("; ") || "ok"}; covered ${JSON.stringify(hitTab)})`);
    await shot(page, "K1-high");
    // a press on each head strikes it; a double-tap on C6 picks it
    await tap(ctx, page, await headOf(page, "x9")); await sleep(700);
    const struck = [];
    for (const h of heads) {
      const n0 = await page.evaluate(() => window.resonateDebug().play.peekLog.length);
      await tap(ctx, page, await headOf(page, h)); await sleep(450);
      const n1 = await page.evaluate(() => window.resonateDebug().play.peekLog.length);
      if (n1 > n0) struck.push(h);
    }
    ok(struck.length === heads.length, `K2 a press on each of those heads strikes it (${JSON.stringify(struck)})`);
    await sleep(500);
    await doubleTap(ctx, page, await headOf(page, "x4"));
    let p = await PBD(page);
    ok(p.span?.note?.ids?.join() === "x4", `K2 a double-tap on C6 still picks it (${JSON.stringify(p.span)})`);
    // the safety net: a tab where it can't be lifted clear of a head (moved here over C6, its ribbon's
    // centre 5 px above the head's): a press on the head strikes it, a tap on the ribbon selects the mark
    await tap(ctx, page, await blank(page)); await sleep(500);
    const hc = await headOf(page, "x4");
    const near = await page.evaluate(([x, y]) => {
      const t = document.querySelector('#stage .mtab[data-id="hi2"]'), i = t.firstChild.getBoundingClientRect();
      t.style.top = parseFloat(t.style.top) + (y - 5 - (i.top + i.height / 2)) + "px";
      t.style.left = parseFloat(t.style.left) + (x - (i.left + i.width / 2)) + "px";
      return { on: !!document.elementFromPoint(x, y)?.closest(".mtab") };
    }, hc);
    const n0 = await page.evaluate(() => window.resonateDebug().play.peekLog.length);
    await tap(ctx, page, hc); await sleep(450);
    const d = await PD(page);
    ok(near.on && d.peekLog.length === n0 + 1 && d.marks.sel !== "hi2", `K3 a tab over C6's head: a press on the head strikes it (peeks ${n0} → ${d.peekLog.length}), the mark not selected (${d.marks.sel})`);
    const t = (await MK(page)).tabs.find((x) => x.id === "hi2");
    await tap(ctx, page, ribbonPt(t)); await sleep(400);
    ok((await MK(page)).sel === "hi2", "K3 …a tap on its ribbon still selects the mark");
    errors.push(...errs);
    await ctx.close();
  }

  // ---------------------------------------------------------------- R chord marks after the song is read again (ids moved)
  if (run("R")) {
    const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    await ctx.route("**/*.supabase.co/**", (r) => r.abort());
    await ctx.addInitScript(INIT);
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push("pageerror " + e.message));
    await page.goto(BASE + "play.html"); await ready(page);
    const song = await page.evaluate(async () => {
      const v = document.getElementById("version").textContent.trim().slice(1);
      const L = await import(`./library.js?v=${v}`);
      const x = await (await fetch("songs/amazing-grace.musicxml")).text();
      const id = await L.addSong("AG copy", x, { source: "file" });
      const all = JSON.parse(localStorage.getItem("resonate.play") || "{}");
      all[id] = { view: "both" };
      localStorage.setItem("resonate.play", JSON.stringify(all));
      return id;
    });
    await page.reload(); await ready(page);
    await page.selectOption("#song", song);
    await until(page, (id) => { const d = window.resonateDebug().play; return d.song === id && d.ready; }, song, 60000);
    await sleep(300);
    // two-note chords on one staff from bar 3 on: [a] a mark made here (its notes' facts kept), [b] one
    // stored as 02823de stored it (ids only), [c] one whose notes the song read again won't have
    const chords = await page.evaluate(() => {
      const T = window.resonateDebug().play.playback.timeline(), by = new Map();
      for (const e of T.els) { if (e.rest || e.grace) continue; const k = e.part + "|" + e.staff + "|" + e.q; (by.get(k) || by.set(k, []).get(k)).push(e); }
      return [...by.values()].filter((l) => l.length === 2 && l[0].q >= 8).slice(0, 3).map((l) => ({ q: l[0].q, ids: l.map((e) => e.id), d: Math.max(...l.map((e) => e.d)) }));
    });
    const [a, b, c] = chords;
    await tap(ctx, page, await headOf(page, "n12")); await sleep(600);
    for (const ch of [a, c]) {
      await doubleTap(ctx, page, await headOf(page, ch.ids[0]));
      await page.tap("#sel-mark"); await sleep(200);
      await sleep(400);
    }
    let mk = await MK(page);
    const A = mk.list.find((m) => Math.abs(m.q0 - a.q) < EPS), C = mk.list.find((m) => Math.abs(m.q0 - c.q) < EPS);
    ok(A?.notes?.length === 2 && A.notes.every((n) => n.part && n.staff && Number.isFinite(n.midi)) && C?.notes, `R0 a chord mark keeps its notes' facts (${JSON.stringify(A?.notes)})`);
    // the song read again: one more note in bar 1 (every later id moves by one), [c]'s first note a tone higher
    await page.goto(BASE + "no-such-page.html");
    await page.evaluate(async ([song, b, c]) => {
      const all = JSON.parse(localStorage.getItem("resonate.play"));
      all[song].marks.push({ id: "old000", q0: b.q, end: b.q + b.d, ids: b.ids, label: "", at: Date.now(), used: 0 });
      localStorage.setItem("resonate.play", JSON.stringify(all));
      const v = await (await fetch("play.html")).text().then((t) => /id="version"[^>]*>v(\d+)/.exec(t)[1]);
      const L = await import(`./library.js?v=${v}`);
      const d = new DOMParser().parseFromString(await (await fetch("songs/amazing-grace.musicxml")).text(), "application/xml");
      const notes = d.getElementsByTagName("note");
      const cn = notes[Number(c.ids[0].slice(1))];
      const step = cn.querySelector("pitch > step");
      step.textContent = { C: "D", D: "E", E: "F", F: "G", G: "A", A: "B", B: "C" }[step.textContent];
      const n0 = [...notes].find((n) => n.querySelector("pitch"));
      const x = n0.cloneNode(true);
      x.insertBefore(d.createElement("chord"), x.firstChild);
      x.querySelector("pitch > step").textContent = "B";
      n0.after(x);
      await L.replaceSong(song, new XMLSerializer().serializeToString(d));
    }, [song, b, c]);
    await page.goto(BASE + "play.html"); await ready(page); await sleep(400);
    mk = await MK(page);
    const moved = await page.evaluate((ids) => ids.map((i) => window.resonateDebug().play.playback.timeline().els.find((e) => e.id === i)?.q), a.ids);
    // [a]: found again by its facts — its tab at its place, a tap selects its notes (ids now one on), 🔖 pressed
    const tA = mk.tabs.find((t) => t.id === A.id);
    await tap(ctx, page, await headOf(page, "n13")); await sleep(600);
    await tap(ctx, page, ribbonPt(tA)); await sleep(400);
    let p = await PBD(page);
    const want = a.ids.map((i) => "n" + (Number(i.slice(1)) + 1)).sort();
    mk = await MK(page);
    ok(moved.some((q) => Math.abs(q - a.q) > EPS) && p.span?.note && JSON.stringify([...p.span.note.ids].sort()) === JSON.stringify(want) && Math.abs(p.span.q0 - a.q) < EPS && mk.sel === A.id && mk.button.pressed,
      `R1 a chord mark after its ids moved (its old ids now at q ${JSON.stringify(moved)}): found by its notes, selected as ${JSON.stringify(p.span?.note?.ids)} at q ${p.span?.q0}, 🔖 pressed`);
    // [b] (ids only, now naming other notes) and [c] (a note gone): their stretches
    for (const [m, what] of [[mk.list.find((x) => x.id === "old000"), "R2 a mark stored with ids only, the ids moved"], [C, "R3 a chord mark one of whose notes is gone"]]) {
      const t = (await MK(page)).tabs.find((x) => x.id === m.id);
      if (!t) { ok(false, `${what}: no tab`); continue; }
      await tap(ctx, page, ribbonPt(t)); await sleep(400);
      p = await PBD(page);
      const mm = await MK(page);
      ok(p.span && !p.span.note && Math.abs(p.span.q0 - m.q0) < EPS && Math.abs(p.span.end - m.end) < EPS && mm.sel === m.id && mm.button.pressed,
        `${what}: its stretch — its tab at its place, selected as [${p.span?.q0}, ${p.span?.end}), 🔖 pressed`);
    }
    const kinds = (await page.evaluate(() => window.resonatePlay.scoreState().marks)).map((x) => x.kind).sort();
    ok(JSON.stringify(kinds) === '["note","stretch","stretch"]', `R4 for assistants: the chord found a "note", the two others "stretch" (${JSON.stringify(kinds)})`);
    errors.push(...errs);
    await ctx.close();
  }

  // ---------------------------------------------------------------- E two tabs on one song
  if (run("E")) {
    const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    await ctx.route("**/*.supabase.co/**", (r) => r.abort());
    await ctx.addInitScript(INIT);
    await ctx.addInitScript(AG_BOTH);
    const B = await ctx.newPage();
    await B.goto(BASE + "play.html"); await ready(B);
    const A = await ctx.newPage();
    await A.goto(BASE + "play.html"); await ready(A);
    const s0 = (await geo(A))[0].systems[0];
    await touch(ctx, A, line(colPt(s0, 2), colPt(s0, 6), 8));
    await A.tap("#sel-mark"); await sleep(300);
    const stored = () => A.evaluate(() => (JSON.parse(localStorage.getItem("resonate.play"))["amazing-grace"].marks || []).length);
    await B.bringToFront(); await sleep(300);
    let mb = await MK(B);
    ok(await stored() === 1 && mb.list.length === 1 && mb.listBtn.shown && mb.tabs.length === 1, `E1 a mark made in tab A shows in tab B (the storage event): ${mb.list.length} mark, its tab`);
    await B.selectOption("#hands", "rh"); await ready(B, "rh"); await sleep(300);
    await B.selectOption("#hands", "both"); await ready(B, "both"); await sleep(300);
    ok(await stored() === 1, `E2 tab B saving its record (a view changed) keeps it (${await stored()} stored)`);
    // B removes it; A, then left, doesn't bring it back
    const tb = (await MK(B)).tabs[0];
    if (tb) {
      await tap(ctx, B, ribbonPt(tb)); await sleep(300);
      await B.tap("#sel-mark"); await sleep(200); await B.tap("#sel-mark"); await sleep(300);
    }
    await A.bringToFront(); await sleep(300);
    const ma = await MK(A);
    await A.goto(BASE + "no-such-page.html"); await sleep(200);
    ok(!ma.list.length && !ma.listBtn.shown && !ma.tabs.length && await B.evaluate(() => (JSON.parse(localStorage.getItem("resonate.play"))["amazing-grace"].marks || []).length) === 0,
      "E3 removed in tab B: gone from tab A, and A leaving (its pagehide save) doesn't bring it back");
    await ctx.close();
  }

  // ---------------------------------------------------------------- X Escape, the sheet and the keyboard, a mouse click after typing, assistants
  if (run("X")) {
    // X1 Escape after a tap: the focus off the bar (a pedal's Space doesn't reopen the list); from the keyboard: back on 🔖
    let { ctx, page, errors: errs } = await newPage(browser, 820, 1180);
    const s0 = (await geo(page))[0].systems[0];
    await touch(ctx, page, line(colPt(s0, 2), colPt(s0, 6), 8));
    await page.tap("#sel-mark"); await sleep(200);
    await page.tap("#marks"); await sleep(200);
    await page.keyboard.press("Escape"); await sleep(150);
    const act = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
    await page.keyboard.press(" "); await sleep(250);
    let mk = await MK(page);
    ok(act !== "marks" && !mk.open, `X1 the list opened by a tap, Escape: the focus not on 🔖 (${act}), Space doesn't open it again`);
    await page.focus("#marks"); await page.keyboard.press("Enter"); await sleep(200);
    const openK = (await MK(page)).open;
    await page.keyboard.press("Escape"); await sleep(150);
    ok(openK && !(await MK(page)).open && await page.evaluate(() => document.activeElement?.id) === "marks", "X1 opened from the keyboard, Escape: the focus back on 🔖");
    // X4 assistants: a chord mark's staff and part; from / to from the song as it is now
    await page.evaluate(() => {
      const all = JSON.parse(localStorage.getItem("resonate.play"));
      all["amazing-grace"].marks[0].from = { bar: "99", beat: 1 };
      localStorage.setItem("resonate.play", JSON.stringify(all));
    });
    await page.goto(BASE + "no-such-page.html");
    await page.goto(BASE + "play.html"); await ready(page); await sleep(300);
    await tap(ctx, page, await headOf(page, "n12")); await sleep(600);
    await doubleTap(ctx, page, await headOf(page, "n91"));
    await page.tap("#sel-mark"); await sleep(200);
    const [st, sel] = await page.evaluate(() => [window.resonatePlay.scoreState().marks, window.resonatePlay.scoreState().selection]);
    const chord = st.find((x) => x.kind === "note"), str = st.find((x) => x.kind === "stretch");
    ok(chord && chord.staff === sel.staff && chord.part === "P2" && str && str.from.bar !== "99", `X4 scoreState().marks: the chord's staff and part, as the selection's (${JSON.stringify(chord)}); from / to as the song is now (${JSON.stringify(str?.from)}, stored "99")`);
    errors.push(...errs);
    await ctx.close();
    // X2 a phone's sheet follows the visual viewport (its pan, a label focused)
    ({ ctx, page, errors: errs } = await newPage(browser, 390, 844));
    const s1 = (await geo(page))[0].systems[0];
    await touch(ctx, page, line(colPt(s1, 1), colPt(s1, 3), 6));
    await page.tap("#sel-mark"); await sleep(200);
    await page.tap("#marks"); await sleep(250);
    const vv = (h, top) => page.evaluate(([h, top]) => {
      const v = window.visualViewport;
      Object.defineProperty(v, "height", { configurable: true, get: () => h });
      Object.defineProperty(v, "offsetTop", { configurable: true, get: () => top });
    }, [h, top]);
    const bottom = () => page.evaluate(() => innerHeight - document.getElementById("marklist").getBoundingClientRect().bottom);
    await vv(500, 120);
    await page.evaluate(() => window.visualViewport.dispatchEvent(new Event("scroll")));
    await sleep(100);
    const b1 = await bottom(), H = await page.evaluate(() => innerHeight);
    await vv(480, 60);
    await page.focus("#marklist input"); await sleep(150);
    const b2 = await bottom();
    ok(Math.abs(b1 - (H - 620)) < 1.5 && Math.abs(b2 - (H - 540)) < 1.5, `X2 the sheet above the keyboard: after the visual viewport's pan (${b1.toFixed(0)} px up, want ${H - 620}), after a label is focused (${b2.toFixed(0)}, want ${H - 540})`);
    errors.push(...errs);
    await ctx.close();
    // X3 a mouse: a label typed (not left), then a click on another mark's tab — the click selects it, the label saved
    ({ ctx, page, errors: errs } = await newPage(browser, 1280, 900, { touch: false }));
    const G = (await geo(page))[0].systems;
    const mouseDrag = async (a, b) => { await page.mouse.move(a[0], a[1]); await page.mouse.down(); for (const p of line(a, b, 8)) await page.mouse.move(p[0], p[1]); await page.mouse.up(); await sleep(200); };
    await mouseDrag(colPt(G[0], 1), colPt(G[0], 3));
    await page.click("#sel-mark"); await sleep(150);
    await mouseDrag(colPt(G[1], 1), colPt(G[1], 3));
    await page.click("#sel-mark"); await sleep(150);
    mk = await MK(page);
    const [m1, m2] = [...mk.list].sort((x, y) => x.q0 - y.q0);
    await page.click("#marks"); await sleep(200);
    await page.click(`#marklist .mrow[data-id="${m2.id}"] input`);
    await page.keyboard.type("Second line");
    const t1 = (await MK(page)).tabs.find((t) => t.id === m1.id);
    await page.mouse.click(...ribbonPt(t1)); await sleep(300);
    mk = await MK(page);
    ok(mk.sel === m1.id && mk.list.find((m) => m.id === m2.id)?.label === "Second line" && !mk.open, `X3 a mouse: a label typed, then a click on another mark's tab — that mark selected (${mk.sel} vs ${m1.id}), the label saved, the list closed`);
    errors.push(...errs);
    await ctx.close();
  }

  // ---------------------------------------------------------------- W the bar with marks: its height as without, both hosts
  if (run("W")) {
    const STEP = Number(process.env.STEP || 20);
    const widths = [];
    for (let w = 300; w <= 1440; w += STEP) widths.push(w);
    const groups = (touch) => (touch ? [[393, widths.filter((w) => w < 700)], [820, widths.filter((w) => w >= 700)]] : [[1280, widths]]);
    for (const host of ["play", "shell"]) {
      const bad = [];
      let n = 0;
      for (const ptr of ["touch", "mouse"]) for (const v of ["none", "chip", "pdf", "both"]) for (const [w0, ws] of groups(ptr === "touch")) {
        const t = ptr === "touch";
        const ctx = await browser.newContext({ viewport: { width: w0, height: 1000 }, hasTouch: t, isMobile: t, deviceScaleFactor: 1 });
        await ctx.route("**/*.supabase.co/**", (r) => r.abort());
        await ctx.addInitScript((v) => {
          if (location.protocol === "about:" || sessionStorage.getItem("__s")) return;
          sessionStorage.setItem("__s", "1");
          localStorage.setItem("resonate.sing.song", "amazing-grace");
          localStorage.setItem("resonate.shell.modules", JSON.stringify({ phone: ["score"], tablet: ["score", "piano"], desktop: ["score", "piano"] }));
          const rec = { view: "both", names: "all", marks: [{ id: "abcdef", q0: 3, end: 6, label: "", at: Date.now(), used: 0 }] };
          if (v === "chip" || v === "both") rec.days = { n: 5, ask: 3 }; // (the fewer-names chip)
          localStorage.setItem("resonate.play", JSON.stringify({ "amazing-grace": rec }));
        }, v);
        const page = await ctx.newPage();
        await page.goto(BASE + (host === "play" ? "play.html" : "index.html?open=score"));
        await page.waitForFunction(() => window.resonatePlay?.state?.().ready, null, { timeout: 90000 });
        await sleep(host === "shell" ? 1500 : 300);
        if (v === "pdf" || v === "both") await page.evaluate(() => { document.getElementById("pdf").hidden = false; }); // (📄: a song from a PDF)
        for (const w of ws) {
          await page.setViewportSize({ width: w, height: 1000 });
          await sleep(40);
          const r = await page.evaluate(() => {
            const bar = document.querySelector("#score-region #bar") || document.getElementById("bar"), mb = document.getElementById("marks");
            if (!bar.getClientRects().length) return null;
            const shown = bar.getBoundingClientRect().height, vis = !!mb.offsetParent;
            mb.hidden = true;
            const hid = bar.getBoundingClientRect().height;
            mb.hidden = false;
            return { shown, hid, vis, sw: document.scrollingElement.scrollWidth };
          });
          if (!r) { bad.push(`${ptr} ${v} ${w}: no bar`); continue; }
          n++;
          if (r.shown > r.hid + 0.5 || !r.vis || r.sw > w) bad.push(`${ptr} ${v} ${w}: ${r.hid.toFixed(0)}→${r.shown.toFixed(0)}${r.vis ? "" : " (no 🔖)"}${r.sw > w ? " (scrolls)" : ""}`);
        }
        await ctx.close();
      }
      ok(!bad.length && n > 100, `W ${host === "play" ? "play.html" : "the shell's Score"}: the bar with marks as tall as without at ${n} widths (300–1440 px every ${STEP} × none / chip / 📄 / both × touch / mouse)${bad.length ? ": " + bad.slice(0, 8).join("; ") : ""}`);
    }
  }

  await browser.close();
  ok(!errors.length, `no page errors: ${errors.slice(0, 4).join(" | ")}`);
  done();
})().catch(fail);
