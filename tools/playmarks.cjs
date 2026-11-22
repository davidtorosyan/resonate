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
//
// usage: node playmarks.cjs   (BASE=http://localhost:8097/resonate/, ONLY=M,P,H, SHOTS=0|<dir>)
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
// onset in the view (q), centred on that onset's column. → { ok, why }
async function tabPlaced(page, id, q) {
  const [mk, G, d] = await Promise.all([MK(page), geo(page), PD(page)]);
  const t = mk.tabs.find((x) => x.id === id);
  let sys = null, col = null;
  for (const pg of G) for (const s of pg.systems) { const c = s.cols.find((c) => Math.abs(c[0] - q) < EPS); if (c && !sys) { sys = s; col = c; } }
  if (!t || !sys) return { ok: false, why: `tab ${!!t}, system ${!!sys}` };
  const [x, y, w, h] = t.ribbon, cx = x + w / 2, want = (col[1] + col[2]) / 2;
  const bottom = y + h;
  const good = Math.abs(cx - want) < 1.5 && bottom <= sys.top + 0.5 && bottom >= sys.top - 1.2 * d.sp && w >= 12;
  return { ok: good, why: `ribbon x ${cx.toFixed(1)} (column ${want.toFixed(1)}), bottom ${bottom.toFixed(1)} over the system's top ${sys.top.toFixed(1)} (sp ${d.sp.toFixed(2)}), ${w}×${h}` };
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
    await tap(ctx, page, await blank(page)); await sleep(250);
    ok(!(await MK(page)).open, "M10 a tap outside closes it");
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
      all["amazing-grace"].marks = [{ q0: 4, end: 2 }, { id: "s0", q0: "x" }, ...list];
      localStorage.setItem("resonate.play", JSON.stringify(all));
    }, A);
    await page.goto(BASE + "play.html"); await ready(page); await sleep(300);
    mk = await MK(page);
    ok(mk.list.length === 50 && new Set(mk.list.map((m) => m.id)).size === 50, `M16 a stored list read back checked: the broken entries left out, 50 (${mk.list.length})`);
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
    const inBar = await page.evaluate(() => !!document.querySelector("#score-region #bar .ctl #marks") && !!document.querySelector("#score-region #bar #marklist"));
    await page.tap("#score-region #marks"); await sleep(300);
    mk = await MK(page);
    const top = await page.evaluate(() => {
      const l = document.getElementById("marklist").getBoundingClientRect();
      const hit = document.elementFromPoint(l.left + l.width / 2, l.top + Math.min(l.height - 4, 26));
      const r = document.getElementById("marks").getBoundingClientRect();
      return { inside: !!hit?.closest("#marklist"), z: getComputedStyle(document.getElementById("marklist")).zIndex, under: l.top >= r.bottom - 1, rect: [l.left, l.top, l.width, l.height] };
    });
    ok(inBar && mk.open && mk.rows.length === 1 && top.inside && top.under, `H3 its list opens under the bar's 🔖, on top (z ${top.z}, ${JSON.stringify(top.rect)})`);
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

  await browser.close();
  ok(!errors.length, `no page errors: ${errors.slice(0, 4).join(" | ")}`);
  done();
})().catch(fail);
