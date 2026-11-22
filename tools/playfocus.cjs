// Play (E3): highlights for assistants at note / beat resolution. A drag picks a stretch between
// onsets; a double-tap on a note picks that note — its chord on that staff, what the press strikes.
// What an assistant gets (play.js focusData → score_focus → get_score_view) names the exact span —
// start and end as bar + beat, its first and last notes — and lists only its notes, the rest of its
// bars as context; the score picture keeps those bars whole with the band inside.
//
//   F  a drag mid-bar: the focus' span (start / end beats, first / last notes, only the notes inside,
//      the rest marked as context), the device state's selection, the picture's whole bars
//   N  a double-tap: one chord on one staff (both taps sound in their press), its band on its staff,
//      the focus; ▶ plays just it for its length, ⟳ round after round; single taps, two notes, a
//      held second tap, a drag after it, a tap on paper, another view, a mouse's double-click
//   C  a stretch across systems (a drag) and across pages (score_select with beats, a phone)
//   S  score_select with from_beat / to_beat: a focus' span round trip, between onsets, refusals,
//      the old bars-only call
//   R  the v97 review's E3 fixes: a chip muted while a picked chord loops leaves it sounding and lit
//      (R1); a view drawing only part of the chord keeps only those notes, ▶ plays only them (R2);
//      a turn held back by the second tap's press isn't taken at its lift (R3, a phone); the device
//      state names the picked chord's staff and part, as the focus does (R4); beats named to 3
//      decimals (a triplet's @3.667) select exactly their note, as from and as to (R5)
//
// usage: node playfocus.cjs   (BASE=http://localhost:8097/resonate/, ONLY=F,N,C,S,R, SHOTS=0|<dir>)
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

// every buffer source: when it starts (as tools/playback.cjs)
function INIT() {
  try { if (!navigator.audioSession) Object.defineProperty(navigator, "audioSession", { configurable: true, value: { type: "auto" } }); } catch {}
  window.__src = [];
  const S = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when = 0, ...a) { window.__src.push({ when, made: performance.now() }); return S.call(this, when, ...a); };
}
const PBD = (page) => page.evaluate(() => { const x = window.resonateDebug().play.playback; return { state: x.state, kind: x.kind, span: x.span, bands: x.bands, selbar: x.selbar, len: x.len, t0: x.t0, scheduled: x.scheduled, tempo: x.tempo }; });
const D = (page) => page.evaluate(() => { const d = window.resonateDebug().play; return { page: d.page, pages: d.pages, view: d.view, peek: d.peek, peekLog: d.peekLog, sp: d.sp }; });
const ready = (page, view) => page.waitForFunction((v) => { const d = window.resonateDebug?.().play; return d && d.ready && (!v || d.view === v); }, view, { timeout: 120000 });
const until = async (page, fn, arg, ms = 20000) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
async function newPage(browser, w, h, { touch = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  await ctx.addInitScript(INIT);
  await ctx.addInitScript(AG_BOTH); // (Amazing Grace in Both: two staves, a hymn's two parts)
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console.error " + m.text().slice(0, 200)); });
  await page.goto(BASE + "play.html");
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
async function doubleTap(ctx, page, p, { gap = 120, hold2 = 60 } = {}) {
  await tap(ctx, page, p);
  await sleep(gap);
  await tap(ctx, page, p, hold2);
  await sleep(250);
}
const line = (a, b, n = 10) => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
// the drawn systems, client px: [{ page, systems: [{ top, bottom, left, right, cols: [[q, x0, x1]] }] }]
async function geo(page) {
  const g = await page.evaluate(() => window.resonateDebug().play.playback.geo());
  return g.map((pg) => ({ page: pg.page, systems: pg.systems.map((s) => ({ ...s, top: s.top + pg.rect[1], bottom: s.bottom + pg.rect[1], left: s.left + pg.rect[0], right: s.right + pg.rect[0], cols: s.cols.map(([q, x0, x1]) => [q, x0 + pg.rect[0], x1 + pg.rect[0]]) })) }));
}
const colPt = (s, i) => [(s.cols[i][1] + s.cols[i][2]) / 2, s.top + 0.25 * (s.bottom - s.top)];
// The written facts the checks compare with: bars [{ q, len }], their numbers, the timeline's
// elements, the view's onsets.
const facts = (page) => page.evaluate(() => {
  const pb = window.resonateDebug().play.playback, T = pb.timeline();
  return { bars: T.bars, els: T.els, length: T.length, onsets: pb.onsets() };
});
const barAt = (bars, q) => { let i = 0; while (i + 1 < bars.length && bars[i + 1].q <= q + EPS) i++; return i; };
// The bar numbers as the MusicXML writes them (the page's first part).
const numbers = (page) => page.evaluate(() => fetch("songs/amazing-grace.musicxml").then((r) => r.text()).then((x) => {
  const d = new DOMParser().parseFromString(x, "application/xml"), p = d.querySelector("part");
  return [...p.children].filter((c) => c.nodeName === "measure").map((m, i) => m.getAttribute("number") || String(i + 1));
}));
const r3 = (x) => Math.round(x * 1000) / 1000;
const place = (F, nums, q, stop = false) => {
  const mi = barAt(F.bars, stop ? q - 1e-4 : q), b = F.bars[mi];
  if (stop && mi + 1 < F.bars.length && Math.abs(b.q + b.len - q) < EPS) return { bar: nums[mi + 1], beat: 1 };
  return { bar: nums[mi], beat: r3(q - b.q + 1) };
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const focusData = (page) => page.evaluate(() => window.resonatePlay.focusData().then((d) => d && d.data));
// The text's staff lines, by bar: { bar, inside: [[beat, text]], outside: [[beat, text]], nothing (staff lines with nothing highlighted) }
function readText(text) {
  const out = [];
  let cur = null, last = null;
  for (const ln of text.split("\n")) {
    const m = /^Bar (\S+)/.exec(ln);
    if (m) { cur = { bar: m[1], inside: [], outside: [], nothing: 0, staves: 0 }; out.push(cur); continue; }
    if (!cur) continue;
    const ev = (s) => s.split(" · ").map((x) => [Number((/^@([\d.]+)/.exec(x.trim()) || [])[1]), x.trim()]).filter(([b]) => Number.isFinite(b));
    if (/^ {4}outside the highlight: /.test(ln)) { if (last !== "chords") cur.outside.push(...ev(ln.replace(/^ {4}outside the highlight: /, ""))); continue; }
    if (/^ {2}Chords: /.test(ln)) { last = "chords"; continue; }
    if (/^ {2}\S/.test(ln)) {
      last = "staff";
      cur.staves++;
      const body = ln.slice(ln.indexOf(": ") + 2);
      if (/^\(nothing highlighted\)/.test(body)) cur.nothing++;
      else cur.inside.push(...ev(body));
    }
  }
  return out;
}
const NAME = /(?:^|[\s[])(?:←)?[A-G][♯♭𝄪𝄫]?-?\d/g;
const names = (s) => (s.replace(/"[^"]*"/g, "").match(NAME) || []).length;
// The score picture: how much of its width the blue band takes, and the ink left / right of it.
const cropStats = (page) => page.evaluate(() => window.resonatePlay.scoreCrop().then(async (b) => {
  const bmp = await createImageBitmap(b);
  const c = document.createElement("canvas");
  c.width = bmp.width; c.height = bmp.height;
  const x = c.getContext("2d");
  x.drawImage(bmp, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data, W = c.width, H = c.height;
  const blue = new Uint8Array(W), ink = new Uint8Array(W);
  for (let y = 0; y < H; y++) for (let i = 0; i < W; i++) {
    const k = (y * W + i) * 4;
    if (d[k] > 200 && d[k + 1] > 215 && d[k + 2] > 240 && d[k + 2] - d[k] > 20) blue[i] = 1;
    if (d[k] < 80 && d[k + 1] < 80 && d[k + 2] < 80) ink[i] = 1;
  }
  const bc = [...blue.keys()].filter((i) => blue[i]);
  const l = bc.length ? Math.min(...bc) : W, r = bc.length ? Math.max(...bc) : 0;
  let inkL = 0, inkR = 0;
  for (let i = 0; i < W; i++) if (ink[i]) { if (i < l) inkL++; else if (i > r) inkR++; }
  return { w: W, h: H, band: bc.length ? (r - l + 1) / W : 0, inkL, inkR };
}));

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const errors = [];

  // ---------------------------------------------------------------- F a drag mid-bar (iPad portrait)
  if (run("F")) {
    const { ctx, page, errors: errs } = await newPage(browser, 820, 1180);
    const F = await facts(page), nums = await numbers(page);
    const s0 = (await geo(page))[0].systems[0];
    // from an onset inside a bar (not its downbeat) to one inside a later bar
    const mid = s0.cols.map((c, i) => ({ i, q: c[0], mi: barAt(F.bars, c[0]) })).filter((c) => c.q > F.bars[c.mi].q + EPS);
    const a = mid[0], z = mid.find((c) => c.mi === a.mi + 1) || mid[mid.length - 1];
    await touch(ctx, page, line(colPt(s0, a.i), colPt(s0, z.i), 10));
    const p = await PBD(page);
    const end = F.onsets.find((q) => q > z.q + EPS);
    ok(p.span && Math.abs(p.span.q0 - a.q) < EPS && Math.abs(p.span.end - end) < EPS, `F0 the drag picked [${a.q}, ${end}) (${JSON.stringify(p.span)})`);
    const f = await focusData(page);
    const sp = f?.span;
    const want = { start: place(F, nums, a.q), end: place(F, nums, end, true) };
    ok(sp?.kind === "stretch" && same(sp.start, want.start) && same(sp.end, want.end), `F1 the focus names the span: ${JSON.stringify(sp && { kind: sp.kind, start: sp.start, end: sp.end })} (want ${JSON.stringify(want)})`);
    const bars = [];
    for (let mi = barAt(F.bars, a.q); mi <= barAt(F.bars, end - 1e-4); mi++) bars.push(nums[mi]);
    ok(f && same(f.measures, bars) && same(sp?.bars, [bars[0], bars[bars.length - 1]]), `F1 …the bars it's in stay, whole, for context: ${JSON.stringify(f?.measures)} (span.bars ${JSON.stringify(sp?.bars)})`);
    // the notes inside: the timeline's pitched notes starting in [q0, end)
    const inEls = F.els.filter((e) => !e.rest && !e.grace && e.midi != null && e.q >= a.q - EPS && e.q < end - EPS);
    ok(sp?.notes === inEls.length, `F2 span.notes = the notes starting in it (${sp?.notes} vs ${inEls.length})`);
    const firstQ = Math.min(...inEls.map((e) => e.q)), lastQ = Math.max(...inEls.map((e) => e.q));
    const at = (q) => inEls.filter((e) => Math.abs(e.q - q) < EPS).length;
    ok(sp && sp.first.reduce((n, x) => n + x.notes.length, 0) === at(firstQ) && same({ bar: sp.first[0].bar, beat: sp.first[0].beat }, place(F, nums, firstQ))
      && sp.last.reduce((n, x) => n + x.notes.length, 0) === at(lastQ) && same({ bar: sp.last[0].bar, beat: sp.last[0].beat }, place(F, nums, lastQ))
      && sp.first.every((x) => x.part && x.staff_name && x.voice && x.value),
      `F2 first / last: what starts at its first and last onset, each with its part, staff, voice, bar, beat and value (${JSON.stringify(sp && [sp.first.map((x) => x.notes.join(" ") + " " + x.staff_name + " @" + x.beat), sp.last.map((x) => x.notes.join(" ") + " @" + x.beat)])})`);
    const T = readText(f?.text || "");
    const inBar = (b) => { const mi = nums.indexOf(b.bar); return (beat) => F.bars[mi].q + beat - 1; };
    let wrongIn = 0, wrongOut = 0, nIn = 0;
    // (beats are written to 3 decimals: a triplet's 3.333)
    const TOL = 0.002;
    for (const b of T) {
      const q = inBar(b);
      for (const [beat, s] of b.inside) { if (q(beat) < a.q - TOL || q(beat) >= end - TOL) wrongIn++; if (!/^@[\d.]+ (rest|grace) /.test(s)) nIn += names(s); }
      for (const [beat] of b.outside) if (q(beat) >= a.q - TOL && q(beat) < end - TOL) wrongOut++;
    }
    const outside = T.reduce((n, b) => n + b.outside.length, 0);
    if (process.env.DEBUG) console.log(f?.text);
    ok(/^Highlighted: from bar \S+ @[\d.]+ (up to bar \S+ @[\d.]+ \(not included\)|to the end of bar \S+) — /.test(f?.text || "") && T.length === bars.length,
      `F3 the text names the highlight first, then every bar: ${(f?.text || "").split("\n")[0].slice(0, 200)}`);
    ok(!wrongIn && nIn === inEls.length, `F3 the staff lines list only the notes inside (${nIn} names, ${wrongIn} outside the span)`);
    ok(outside > 0 && !wrongOut, `F3 the rest of those bars is marked "outside the highlight" (${outside}, ${wrongOut} wrongly)`);
    ok(/outside the highlight/.test(f?.legend || "") && /bar @beat/.test(f?.legend || ""), "F3 the legend says how to read it");
    const st = await page.evaluate(() => [window.resonatePlay.scoreState().selection, window.resonatePlay.focus().then((x) => x.selection)]);
    const fsel = await page.evaluate(() => window.resonatePlay.focus().then((x) => x.selection));
    ok(st[0] && st[0].kind === "stretch" && same(st[0].start, want.start) && same(st[0].end, want.end) && st[0].from === bars[0], `F4 the device state's selection: ${JSON.stringify(st[0])}`);
    ok(fsel && fsel.kind === "stretch" && same(fsel.start, want.start) && same(fsel.end, want.end), `F4 resonatePlay.focus(): ${JSON.stringify(fsel && { kind: fsel.kind, start: fsel.start, end: fsel.end })}`);
    ok(f?.pdf === null || /whole bars/.test(f?.pdf?.border_note || ""), "F4 (no PDF here: the PDF's border is bar-level where there is one)");
    const cs = await cropStats(page);
    ok(cs.band > 0.15 && cs.band < 0.8 && cs.inkL > 15, `F5 the score picture: the bars whole, the band only the span (band ${Math.round(cs.band * 100)}% of ${cs.w} px, ink left of it ${cs.inkL} px, right ${cs.inkR})`);
    await shot(page, "F-drag");
    errors.push(...errs);
    await ctx.close();
  }

  // ---------------------------------------------------------------- N a double-tap (iPad portrait)
  if (run("N")) {
    const { ctx, page, errors: errs } = await newPage(browser, 820, 1180);
    const F = await facts(page), nums = await numbers(page);
    const headOf = (id) => page.evaluate((id) => { const g = document.querySelector(`#stage g.note[id="${id}"] > g.notehead`); const r = g.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, id);
    // a treble note with another voice on its staff at that moment (the hymn's alto): n4
    const head = await headOf("n4");
    // (a first tap elsewhere starts the page's audio — the first touch on a fresh page may only
    // sound at its lift, as on iOS: not what's measured here)
    await tap(ctx, page, await headOf("n12")); await sleep(600);
    await tap(ctx, page, head);
    const struck = (await D(page)).peek?.ids || [];
    await sleep(140);
    const log0 = (await D(page)).peekLog.length;
    await tap(ctx, page, head);
    await sleep(250);
    let d = await D(page), p = await PBD(page);
    const nlog = d.peekLog.slice(log0);
    ok(p.span?.note && same([...p.span.note.ids].sort(), [...struck].sort()) && struck.length >= 1, `N1 a double-tap picks the note's chord on its staff — what the press strikes (${JSON.stringify(p.span)}; struck ${struck})`);
    ok(nlog.length === 1 && nlog[0].how === "hold" && !nlog[0].cut && d.peekLog[log0 - 1]?.how === "hold", `N1 both taps sounded in their press (${JSON.stringify(d.peekLog.slice(log0 - 1).map((x) => ({ how: x.how, lag: x.lag, cut: x.cut })))})`);
    const els = F.els.filter((e) => struck.includes(e.id));
    const q0 = Math.min(...els.map((e) => e.q)), len = Math.max(...els.map((e) => e.d));
    ok(p.span && Math.abs(p.span.q0 - q0) < EPS && Math.abs(p.span.end - (q0 + len)) < EPS, `N1 …from its onset for its length: [${p.span?.q0}, ${p.span?.end}) (want [${q0}, ${q0 + len}))`);
    const s = (await geo(page))[0].systems.find((x) => x.top - 30 < head[1] && x.bottom + 30 > head[1]);
    const pr = await page.evaluate(() => { const r = document.querySelector("#stage .page").getBoundingClientRect(); return [r.left, r.top]; });
    const b = p.bands[0], bt = b && b.top + pr[1], bb = b && b.top + b.height + pr[1];
    ok(p.bands.length === 1 && bt <= head[1] && bb >= head[1] && b.left + pr[0] <= head[0] && b.left + b.width + pr[0] >= head[0] && b.height < 0.75 * (s.bottom - s.top + 40) && b.width < 80,
      `N2 one band, round the chord on its staff (${JSON.stringify(b)}; system ${Math.round(s.top)}–${Math.round(s.bottom)})`);
    ok(!!p.selbar && p.selbar.loop, "N2 the selection's controls (⟳ speed ✕)");
    await shot(page, "N-note");
    const f = await focusData(page);
    const T = readText(f?.text || "");
    const inside = T.flatMap((x) => x.inside);
    ok(f?.span?.kind === "note" && f.span.notes === struck.length && same(f.span.start, place(F, nums, q0)) && same(f.span.end, place(F, nums, q0 + len, true)) && f.span.staff && same(f.measures, [nums[barAt(F.bars, q0)]]),
      `N3 the focus: one chord (${JSON.stringify(f?.span && { kind: f.span.kind, notes: f.span.notes, start: f.span.start, end: f.span.end, staff: f.span.staff })}, bars ${f?.measures})`);
    ok(/^Highlighted: one (note|chord) only, on one staff — /.test(f?.text || "") && inside.reduce((n, [, x]) => n + names(x), 0) === struck.length && T[0]?.nothing >= 1 && T[0]?.outside.length > 0,
      `N3 the text: only that chord inside, the other staff "(nothing highlighted)", the rest as context: ${(f?.text || "").split("\n")[0]}`);
    // ▶: just that chord, for its length; then ⟳ round after round
    await page.tap("#play");
    await until(page, () => window.resonateDebug().play.playback.scheduled.length > 0 && !window.resonateDebug().play.playback.starting);
    await until(page, () => window.resonateDebug().play.playback.state === "idle", null, 10000);
    p = await PBD(page);
    const spq = 60 / p.tempo;
    const ids = [...new Set(p.scheduled.map((x) => x.id))].sort();
    const struckMidis = new Set(els.map((e) => e.midi));
    ok(p.scheduled.length === struckMidis.size && ids.every((id) => struck.includes(id)) && p.scheduled.every((x) => Math.abs(x.dur - (F.els.find((e) => e.id === x.id).d) * spq) < 0.002),
      `N4 ▶ plays just that chord, each note for its written length at ♩=${p.tempo} (${JSON.stringify(p.scheduled.map((x) => ({ id: x.id, dur: +x.dur.toFixed(3) })))})`);
    ok(p.state === "idle" && !!p.span?.note && Math.abs(p.len - len * spq) < 1e-6, `N4 …once (${p.len} s), the chord still picked`);
    const canLoop = await page.evaluate(() => !document.getElementById("sel-loop").hidden && !document.getElementById("selbar").hidden);
    if (canLoop) await page.tap("#sel-loop");
    await until(page, () => window.resonateDebug().play.playback.scheduled.some((x) => x.round >= 3), null, canLoop ? 15000 : 100);
    p = await PBD(page);
    const rounds = {};
    for (const x of p.scheduled) (rounds[x.round] ||= []).push(x);
    const r0 = rounds[0] || [];
    let worst = 0;
    for (const [r, l] of Object.entries(rounds)) for (let i = 0; i < Math.min(l.length, r0.length); i++) worst = Math.max(worst, Math.abs(l[i].when - r0[i].when - Number(r) * p.len));
    ok(p.state === "looping" && Object.keys(rounds).length >= 3 && Object.values(rounds).every((l) => l.length === r0.length) && worst < 1e-6,
      `N5 ⟳ loops it: ${Object.keys(rounds).length} rounds of ${r0.length} note(s), each one chord-length (${p.len.toFixed(3)} s) after the last (worst ${worst})`);
    if (canLoop) await page.tap("#sel-loop"); else await page.click("#play").catch(() => {});
    await sleep(200);
    ok(canLoop && (await PBD(page)).state === "idle", "N5 ⟳ again stops");
    // a tap on paper lets go
    const blank = await page.evaluate(() => {
      const heads = [...document.querySelectorAll("#stage .page g.notehead")].map((g) => { const r = g.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
      const st = document.getElementById("stage").getBoundingClientRect();
      for (let y = st.top + 60; y < st.bottom - 140; y += 17) for (let x = st.left + 80; x < st.right - 80; x += 23) if (heads.every(([hx, hy]) => Math.hypot(hx - x, hy - y) > 40)) return [x, y];
      return null;
    });
    await sleep(500);
    await tap(ctx, page, blank);
    p = await PBD(page);
    ok(!p.span && !p.bands.length, `N6 a tap on paper lets go of it (${JSON.stringify(p.span)})`);
    // two single taps (slow), and two quick taps on two chords: nothing picked
    await tap(ctx, page, head); await sleep(600); await tap(ctx, page, head); await sleep(300);
    ok(!(await PBD(page)).span, "N7 two taps 0.6 s apart: no selection");
    const other = await headOf("n12");
    await sleep(600);
    await tap(ctx, page, head); await sleep(120); await tap(ctx, page, other); await sleep(300);
    ok(!(await PBD(page)).span, "N7 two quick taps on two chords: no selection");
    // the second tap held: it sounds held, then picks at its lift
    await sleep(500);
    await tap(ctx, page, head); await sleep(120);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: head[0], y: head[1], id: 1 }] });
    await sleep(700);
    d = await D(page);
    const heldNow = d.peek?.held && d.peek.sounding.length > 0;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach().catch(() => {});
    await sleep(250);
    ok(heldNow && (await PBD(page)).span?.note, `N8 the second tap held 0.7 s: it sounds while held (${JSON.stringify(d.peek && { held: d.peek.held, sounding: d.peek.sounding })}), picked at the lift`);
    // a drag replaces it with a stretch
    const s0 = (await geo(page))[0].systems[0];
    await touch(ctx, page, line(colPt(s0, 2), colPt(s0, 5), 8));
    p = await PBD(page);
    ok(p.span && !p.span.note && p.bands.length >= 1, `N9 a drag after it: a stretch (${JSON.stringify(p.span)})`);
    // another view: a chord that view doesn't draw is let go; one it draws is kept
    const bass = await page.evaluate(() => { const els = window.resonateDebug().play.playback.timeline().els; const e = els.find((x) => x.part === "P2" && !x.rest && x.mi === 2); return e.id; });
    await sleep(500);
    await doubleTap(ctx, page, await headOf(bass));
    const pb = (await PBD(page)).span;
    await page.selectOption("#hands", "rh"); await ready(page, "rh"); await sleep(300);
    p = await PBD(page);
    ok(pb?.note && !p.span && !p.bands.length, `N10 the bass's chord picked, then Right hand (no bass there): let go (${JSON.stringify(pb)} → ${JSON.stringify(p.span)})`);
    await page.selectOption("#hands", "both"); await ready(page, "both"); await sleep(300);
    await doubleTap(ctx, page, await headOf("n4"));
    await page.selectOption("#hands", "rh"); await ready(page, "rh"); await sleep(300);
    p = await PBD(page);
    ok(p.span?.note && p.bands.length === 1, `N10 a treble chord picked, then Right hand: kept and drawn (${p.bands.length} band)`);
    errors.push(...errs);
    await ctx.close();
    // a mouse's double-click (a desktop)
    const M = await newPage(browser, 1280, 800, { touch: false });
    const mh = await M.page.evaluate(() => { const g = document.querySelector('#stage g.note[id="n4"] > g.notehead'); const r = g.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await M.page.mouse.dblclick(mh[0], mh[1]);
    await sleep(300);
    p = await PBD(M.page);
    ok(p.span?.note && p.span.note.ids.includes("n4") && p.bands.length === 1, `N11 a mouse's double-click picks the chord (${JSON.stringify(p.span)})`);
    errors.push(...M.errors);
    await M.ctx.close();
  }

  // ---------------------------------------------------------------- C across systems and pages
  if (run("C")) {
    const { ctx, page, errors: errs } = await newPage(browser, 820, 1180);
    const F = await facts(page), nums = await numbers(page);
    const g = (await geo(page))[0].systems;
    const s0 = g[0], s1 = g[1];
    // from a mid-bar onset of the first system's last bar to one mid-bar on the second system
    const lastBar = barAt(F.bars, s0.cols[s0.cols.length - 1][0]);
    const ai = s0.cols.findIndex((c) => barAt(F.bars, c[0]) === lastBar && c[0] > F.bars[lastBar].q + EPS);
    const zi = s1.cols.findIndex((c, i) => i > 0 && c[0] > F.bars[barAt(F.bars, c[0])].q + EPS);
    const a = ai >= 0 ? ai : s0.cols.length - 1;
    await touch(ctx, page, line(colPt(s0, a), colPt(s1, zi), 12));
    const p = await PBD(page);
    const q0 = s0.cols[a][0], end = F.onsets.find((q) => q > s1.cols[zi][0] + EPS);
    const f = await focusData(page);
    ok(p.bands.length === 2 && f?.span && same(f.span.start, place(F, nums, q0)) && same(f.span.end, place(F, nums, end, true)),
      `C1 a drag across two systems: two bands, the span ${JSON.stringify(f?.span && [f.span.start, f.span.end])} (want ${JSON.stringify([place(F, nums, q0), place(F, nums, end, true)])})`);
    const T = readText(f?.text || "");
    ok(T.length === f?.measures.length && T.length >= 2 && T[0].outside.length > 0, `C1 …its bars (${f?.measures}), the first one's start outside it`);
    const cs = await cropStats(page);
    ok(cs.h > 1.4 * (s0.bottom - s0.top) && cs.band < 0.95, `C1 the picture: both systems' bars, stacked (${cs.w}×${cs.h}, band ${Math.round(cs.band * 100)}% wide)`);
    errs.length && errors.push(...errs);
    await ctx.close();
    // a phone: Amazing Grace on 3 pages; a stretch from page 1's last bar into page 2's first
    const P = await newPage(browser, 390, 844);
    const d0 = await D(P.page);
    const shown = await P.page.evaluate(() => [...document.querySelectorAll("#stage .page g.measure")].map((m) => Number(m.id.slice(1))));
    const F2 = await facts(P.page), nums2 = await numbers(P.page);
    const m1 = Math.max(...shown), m2 = m1 + 1;
    const r = await P.page.evaluate(([a, b]) => window.resonatePlay.scoreRun("score_select", { from_measure: a, from_beat: 2, to_measure: b, to_beat: 2 }), [nums2[m1], nums2[m2]]);
    const sel = r?.score?.selection;
    const want0 = F2.onsets.find((q) => q >= F2.bars[m1].q + 1 - EPS);
    ok(d0.pages >= 2 && r?.ok && sel?.start?.bar === nums2[m1] && same(sel.start, place(F2, nums2, want0)) && sel.end.bar === nums2[m2],
      `C2 a phone, page 1 of ${d0.pages}: score_select bar ${nums2[m1]} beat 2 → bar ${nums2[m2]} beat 2 (${JSON.stringify(sel)})`);
    let x = await PBD(P.page);
    const b1 = x.bands.length;
    await P.page.click("#next"); await sleep(400);
    x = await PBD(P.page);
    ok(b1 === 1 && x.bands.length === 1 && (await D(P.page)).page === 2, `C2 a band on page 1's last system, one on page 2's first (${b1}, ${x.bands.length})`);
    await P.page.click("#prev"); await sleep(400);
    const f2 = await focusData(P.page);
    ok(f2 && same(f2.measures, [nums2[m1], nums2[m2]]) && /^Highlighted: from bar /.test(f2.text) && readText(f2.text).length === 2, `C2 the focus: bars ${f2?.measures}, ${f2?.text.split("\n")[0].slice(0, 160)}`);
    errors.push(...P.errors);
    await P.ctx.close();
  }

  // ---------------------------------------------------------------- S score_select with beats
  if (run("S")) {
    const { ctx, page, errors: errs } = await newPage(browser, 820, 1180);
    const F = await facts(page), nums = await numbers(page);
    const sel = (a) => page.evaluate((a) => window.resonatePlay.scoreRun("score_select", a), a);
    // a drag's span, given back by its start / end: the same stretch
    const s0 = (await geo(page))[0].systems[0];
    await touch(ctx, page, line(colPt(s0, 3), colPt(s0, 6), 8));
    const p0 = (await PBD(page)).span, f0 = await focusData(page);
    await tap(ctx, page, await page.evaluate(() => { const st = document.getElementById("stage").getBoundingClientRect(); return [st.left + 40, st.bottom - 160]; }));
    const sp0 = f0?.span || { start: {}, end: {} };
    let r = await sel({ from_measure: sp0.start.bar ?? "1", from_beat: sp0.start.beat, to_measure: sp0.end.bar, to_beat: sp0.end.beat });
    let p = (await PBD(page)).span;
    ok(f0?.span && r.ok && p && Math.abs(p.q0 - p0.q0) < EPS && Math.abs(p.end - p0.end) < EPS && same(r.score.selection.start, sp0.start) && same(r.score.selection.end, sp0.end),
      `S1 score_select with the focus' start / end: the same stretch (${JSON.stringify(p)} vs ${JSON.stringify(p0)})`);
    // a beat between two onsets: from the next onset
    const mi = F.bars.findIndex((b, i) => F.onsets.filter((q) => q >= b.q - EPS && q < b.q + b.len - EPS).length >= 3 && i > 0);
    const qs = F.onsets.filter((q) => q >= F.bars[mi].q - EPS && q < F.bars[mi].q + F.bars[mi].len - EPS);
    const between = r3((qs[1] + qs[2]) / 2 - F.bars[mi].q + 1);
    r = await sel({ from_measure: nums[mi], from_beat: between });
    p = (await PBD(page)).span;
    ok(r.ok && Math.abs(p.q0 - qs[2]) < EPS && Math.abs(p.end - (F.bars[mi].q + F.bars[mi].len)) < EPS, `S2 from_beat ${between} (between two onsets) in bar ${nums[mi]}: from the next onset to the bar's end (${JSON.stringify(p)})`);
    r = await sel({ from_measure: nums[mi], from_beat: 9 });
    ok(!r.ok && /isn't in bar/.test(r.error), `S3 from_beat 9 in a ${F.bars[mi].len}-beat bar: refused (${r.error})`);
    r = await sel({ from_measure: nums[mi], from_beat: 3, to_beat: 2 });
    ok(!r.ok && /after/.test(r.error), `S3 to_beat before from_beat: refused (${r.error})`);
    r = await sel({ from_measure: nums[mi], to_measure: nums[mi + 1] });
    p = (await PBD(page)).span;
    ok(r.ok && Math.abs(p.q0 - F.bars[mi].q) < EPS && Math.abs(p.end - (F.bars[mi + 1].q + F.bars[mi + 1].len)) < EPS && r.score.selection.kind === "stretch" && r.score.selection.start?.beat === 1,
      `S4 the bars-only call: whole bars, as before (${JSON.stringify(r.score.selection)})`);
    errors.push(...errs);
    await ctx.close();
  }

  // ---------------------------------------------------------------- R the review's fixes (v97, E3)
  if (run("R")) {
    const { ctx, page, errors: errs } = await newPage(browser, 820, 1180);
    const F = await facts(page), nums = await numbers(page);
    const headOf = (id) => page.evaluate((id) => { const g = document.querySelector(`#stage g.note[id="${id}"] > g.notehead`); const r = g.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, id);
    const X = () => page.evaluate(() => { const x = window.resonateDebug().play.playback; return { state: x.state, span: x.span, scheduled: x.scheduled, litEls: x.litEls, strip: x.strip, hear: x.hear, now: x.now }; });
    // (the hymn's first full bar: n4 / n8 the treble staff's chord, n91 / n93 the bass staff's — same onset, same length)
    await tap(ctx, page, await headOf("n12")); await sleep(600);
    // R1 ⟳ on the treble chord, then its chip (RH) muted mid-round: the chord sounds on, lit
    await doubleTap(ctx, page, await headOf("n4"));
    let x = await X();
    const chord = x.span?.note?.ids || [];
    const rh = x.hear.groups.find((g) => g.key === "P1");
    await page.tap("#sel-loop");
    await until(page, () => { const x = window.resonateDebug().play.playback; return x.state === "looping" && x.now != null && x.scheduled.some((e) => e.when < x.now - 0.2); });
    await page.tap(`#hear button[data-key="P1"]`);
    await sleep(200);
    x = await X();
    const cut = x.scheduled.filter((e) => e.cut != null);
    ok(rh && chord.length === 2 && x.hear.muted.includes("P1") && !cut.length && chord.every((id) => x.litEls.includes(id)),
      `R1 a chord picked loops; RH muted mid-round: nothing cut, the chord still lit (muted ${JSON.stringify(x.hear.muted)}, cut ${JSON.stringify(cut.map((e) => e.id))}, lit ${JSON.stringify(x.litEls)})`);
    await page.tap("#sel-loop"); await sleep(200);
    await page.tap(`#hear button[data-key="P1"]`); await sleep(200);
    // R4 the device state's selection names the chord's staff and part, as the focus' span does
    const st1 = await page.evaluate(() => window.resonatePlay.scoreState().selection);
    const f1 = await focusData(page);
    ok(st1?.kind === "note" && st1.staff && st1.staff === f1?.span?.staff && st1.part === "P1" && st1.part === f1?.span?.first?.[0]?.part,
      `R4 the device state's selection: ${JSON.stringify(st1)} (the focus: staff ${f1?.span?.staff}, part ${f1?.span?.first?.[0]?.part})`);
    await sleep(500);
    await doubleTap(ctx, page, await headOf("n91"));
    const st2 = await page.evaluate(() => window.resonatePlay.scoreState().selection);
    ok(st2?.kind === "note" && same(st2.start, st1?.start) && same(st2.end, st1?.end) && st2.part === "P2" && st2.staff && st2.staff !== st1?.staff,
      `R4 the bass staff's chord at that moment, as long: the same start / end, another staff and part (${JSON.stringify(st2)})`);
    // R2 the treble chord picked in Both, then Melody (the tune only): only the tune's note is kept, ▶ plays only it
    await sleep(500);
    await doubleTap(ctx, page, await headOf("n4"));
    const both = (await X()).span;
    await page.selectOption("#hands", "melody"); await ready(page, "melody"); await sleep(2300); // (the presses' keys unlit)
    x = await X();
    const n4 = F.els.find((e) => e.id === "n4");
    ok(both?.note?.ids.length === 2 && same(x.span?.note?.ids, ["n4"]) && Math.abs(x.span.q0 - n4.q) < EPS && Math.abs(x.span.end - (n4.q + n4.d)) < EPS,
      `R2 Both's chord ${JSON.stringify(both?.note?.ids)}, then Melody: only what it draws (${JSON.stringify(x.span)})`);
    await page.tap("#play");
    await until(page, () => window.resonateDebug().play.playback.strip.length > 0, null, 5000);
    x = await X();
    ok(x.scheduled.length && x.scheduled.every((e) => e.id === "n4") && x.strip.length && x.strip.every((k) => k.midi === n4.midi),
      `R2 ▶ plays only the note Melody draws (${JSON.stringify(x.scheduled.map((e) => e.id))}; keys lit ${JSON.stringify(x.strip.map((k) => k.midi))})`);
    await until(page, () => window.resonateDebug().play.playback.state === "idle", null, 10000);
    // R5 beats named to 3 decimals: bar 2's triplet eighths at @3.333 / @3.667
    const sel = (a) => page.evaluate((a) => window.resonatePlay.scoreRun("score_select", a), a);
    const b2 = F.bars[1], trip = F.onsets.filter((q) => q > b2.q + 2 + EPS && q < b2.q + b2.len - EPS);
    let r = await sel({ from_measure: nums[1], from_beat: r3(trip[1] - b2.q + 1) });
    let p = (await PBD(page)).span;
    ok(trip.length === 2 && r.ok && p && Math.abs(p.q0 - trip[1]) < EPS && r.score.selection.start.beat === r3(trip[1] - b2.q + 1),
      `R5 from_beat ${r3(trip[1] - b2.q + 1)} (a triplet's third eighth, ${trip[1]}): from that note (${r.error || JSON.stringify(p)})`);
    r = await sel({ from_measure: nums[1], from_beat: 3, to_measure: nums[1], to_beat: r3(trip[1] - b2.q + 1) });
    p = (await PBD(page)).span;
    ok(r.ok && p && Math.abs(p.q0 - (b2.q + 2)) < EPS && Math.abs(p.end - trip[1]) < EPS, `R5 to_beat ${r3(trip[1] - b2.q + 1)}: up to that note, not including it (${r.error || JSON.stringify(p)})`);
    // (a focus starting there, given back: the same stretch)
    const f5 = await focusData(page);
    r = await sel({ from_measure: f5.span.start.bar, from_beat: f5.span.start.beat, to_measure: f5.span.end.bar, to_beat: f5.span.end.beat });
    const p5 = (await PBD(page)).span;
    ok(r.ok && Math.abs(p5.q0 - p.q0) < EPS && Math.abs(p5.end - p.end) < EPS, `R5 that focus' start / end given back: the same stretch (${JSON.stringify(f5.span.start)}–${JSON.stringify(f5.span.end)} → ${JSON.stringify(p5)})`);
    errors.push(...errs);
    await ctx.close();
    // R3 a phone, ▶ from page 1: the second tap pressed in page 1's last bar and held while the music
    // moves on to page 2 — the chord is picked at the lift and the page stays
    const P = await newPage(browser, 390, 844);
    const shown = await P.page.evaluate(() => [...document.querySelectorAll("#stage .page g.measure")].map((m) => Number(m.id.slice(1))));
    const last = Math.max(...shown);
    const ph = await P.page.evaluate(() => { const g = document.querySelector("#stage .page g.note > g.notehead"); const r = g.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await tap(P.ctx, P.page, ph); await sleep(600);
    await P.page.tap("#play");
    const inLast = await until(P.page, (m) => window.resonateDebug().play.playback.mi === m, last, 60000);
    await tap(P.ctx, P.page, ph); await sleep(100);
    const cdp = await P.ctx.newCDPSession(P.page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: ph[0], y: ph[1], id: 1 }] });
    const held = await until(P.page, () => !!window.resonateDebug().play.playback.defer, null, 8000);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach().catch(() => {});
    await sleep(300);
    const q = await P.page.evaluate(() => { const d = window.resonateDebug().play, x = d.playback; return { page: d.page, defer: x.defer, span: x.span, state: x.state, musicPage: x.musicPage }; });
    ok(inLast && held && q.span?.note && q.page === 1 && !q.defer && q.state !== "idle", `R3 a turn held back by the second tap's press: the chord picked at the lift, the page stays (${JSON.stringify(q)})`);
    await P.page.click("#play").catch(() => {});
    errors.push(...P.errors);
    await P.ctx.close();
  }

  await browser.close();
  ok(!errors.length, `no page errors: ${errors.slice(0, 4).join(" | ")}`);
  done();
})().catch(fail);
