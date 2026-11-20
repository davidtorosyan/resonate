// Play page (v79 part B): ▶ — a stretch dragged on the page (once / ⟳ loop / speed), or from the
// shown page to the end in Sing's performance order; the notes lit as they sound, the strip, auto
// page turns, the stops; and the gestures that pick the stretch.
//
//   G  gestures: press-hold on a note peeks (no stretch); press + drag from a note cuts the peek's
//      sound and picks; drag from blank staff; backwards; across systems; a tap on paper lets go
//      (not while playing); the bands drawn again after −/+, names, a rotation, a turn and back,
//      another view; another song lets go; the controls (≥ 44 px, clear of the bands)
//   P  the schedule against the score: a stretch plays exactly its notes (ids, MIDI) at their times
//      for the tempo × speed — Verovio's own written-order timemap of the view as the reference —
//      ties joined, durations cut at the stretch's end; ⟳ rounds exactly one stretch apart (≥ 3);
//      speed 50% doubles every gap; a fixture with a tempo change, a grace note, a tie, a triplet
//   O  ▶ from a page follows Sing's measureOf (parseMusicXml, imported apart): Killing Me Softly
//      69 → 107 bars, Wichita Lineman (D.S. / Coda / endings) from page 1 and from a later page;
//      Piano Man at ♩=174 with its own tempo set (Sing's resonate.sing.timing bpm), 90 without
//   L  lit: heads and the strip's keys match what's scheduled at a few sampled times; auto turn
//      forward and back on a repeat; a turn by hand while playing isn't fought
//   S  stops: ■, the stretch's ■, song change, view change, 📄, the page hidden — nothing sounds
//      after (every source started later is stopped at its start, none made later); a peek while
//      playing; a −/+ while playing keeps playing
//   I  an iOS-like gate (the page's context starts only from a resume in a touch end / click): ▶ plays
//
// usage: node playback.cjs   (BASE=http://localhost:8097/resonate/, PLAY_SCORES=<dir of the owner's
//   converted .musicxml — never copied into the repo>, ONLY=G,P,O,L,S,I, SHOTS=<dir>)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { pdfmini } = require("./pdfmini.cjs");
const BASE = process.env.BASE || "http://localhost:8097/resonate/";
const SCRATCH = "/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad";
const SCORES = process.env.PLAY_SCORES ?? path.join(SCRATCH, "play/scores");
const SHOTS = process.env.SHOTS || path.join(SCRATCH, "playback/shots");
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

// A fixture: a tempo change (♩=120 → 60 at bar 3), a grace note, a tie over a barline, a triplet,
// a whole-bar rest — in a piano part.
const N = (step, oct, dur, staff, type, extra = "") => `<note>${extra.includes("<grace") ? "<grace/>" : ""}<pitch><step>${step}</step><octave>${oct}</octave></pitch>${extra.includes("<grace") ? "" : `<duration>${dur}</duration>`}<voice>${staff === 1 ? 1 : 5}</voice><type>${type}</type>${extra.replace("<grace/>", "")}<staff>${staff}</staff></note>`;
const TIMING_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1"><work><work-title>Timing fixture</work-title></work>
<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1">
<measure number="1"><attributes><divisions>6</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type><staff>1</staff><sound tempo="120"/></direction>
${N("C", 5, 6, 1, "quarter")}${N("D", 5, 6, 1, "quarter")}${N("E", 5, 0, 1, "eighth", "<grace/>")}${N("F", 5, 6, 1, "quarter")}${N("G", 5, 6, 1, "quarter", '<tie type="start"/><notations><tied type="start"/></notations>')}
<backup><duration>24</duration></backup>${N("C", 3, 24, 2, "whole")}</measure>
<measure number="2">${N("G", 5, 6, 1, "quarter", '<tie type="stop"/><notations><tied type="stop"/></notations>')}${["A", "B", "C"].map((s, i) => N(s, i === 2 ? 6 : 5, 2, 1, "eighth", "<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>")).join("")}${N("C", 6, 12, 1, "half")}
<backup><duration>24</duration></backup>${N("G", 2, 24, 2, "whole")}</measure>
<measure number="3"><direction placement="above"><direction-type><words>Slower</words></direction-type><staff>1</staff><sound tempo="60"/></direction>${N("C", 5, 24, 1, "whole")}<backup><duration>24</duration></backup>${N("C", 3, 24, 2, "whole")}</measure>
<measure number="4">${N("D", 5, 12, 1, "half")}${N("E", 5, 12, 1, "half")}<backup><duration>24</duration></backup><note><rest measure="yes"/><duration>24</duration><voice>5</voice><staff>2</staff></note><barline location="right"><bar-style>light-heavy</bar-style></barline></measure>
</part></score-partwise>`;

function INIT() {
  try { if (!navigator.audioSession) Object.defineProperty(navigator, "audioSession", { configurable: true, value: { type: "auto" } }); } catch {}
  window.__key = (key) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  // every buffer source: when it starts, every stop asked of it, when it was made (page clock)
  window.__src = [];
  const S = AudioBufferSourceNode.prototype.start, P = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.start = function (when = 0, ...a) { this.__rec = { when, stops: [], made: performance.now(), ctx: this.context }; window.__src.push(this.__rec); return S.call(this, when, ...a); };
  AudioBufferSourceNode.prototype.stop = function (when = 0) { this.__rec?.stops.push(when); return P.call(this, when); };
  // the page hidden / shown (visibilitychange with the state the page reads)
  window.__hide = (hidden) => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") }); document.dispatchEvent(new Event("visibilitychange")); };
}
const D = (page) => page.evaluate(() => { const d = window.resonateDebug?.().play; if (!d) return null; const { facts, countAll, playback, ...rest } = d; return rest; });
const PBD = (page, all = false) => page.evaluate((all) => { const x = window.resonateDebug().play.playback; const { geo, onsets, timeline, singOrder, pageOf, ...rest } = x; if (!all) { rest.items = rest.items.length; rest.scheduled = rest.scheduled.length; } return rest; }, all);
const ready = (page, song, view) => page.waitForFunction(([s, v]) => { const d = window.resonateDebug?.().play; return d && d.ready && (!s || d.song === s) && (!v || d.view === v); }, [song, view], { timeout: 120000 });
const until = async (page, fn, arg, ms = 20000) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
async function newPage(browser, w, h, errors, { touch = true, before = null, gate = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  await ctx.addInitScript(INIT);
  if (gate) await ctx.addInitScript(GATE);
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
// CDP touch: a press, moves, a lift (client px)
async function touchPath(ctx, page, pts, { hold = 0, step = 16 } = {}) {
  const cdp = await ctx.newCDPSession(page);
  const t = (type, p) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ x: p[0], y: p[1], id: 1 }] : [] });
  await t("touchStart", pts[0]);
  if (hold) await sleep(hold);
  for (const p of pts.slice(1)) { await t("touchMove", p); await sleep(step); }
  // (the finger rests before it lifts: a lift at speed is a fling to Chrome, and its next tap only
  // stops the fling — no click)
  if (pts.length > 1) { await t("touchMove", pts[pts.length - 1]); await sleep(150); }
  await t("touchEnd");
  await cdp.detach().catch(() => {});
}
// points from a to b (n steps)
const line = (a, b, n = 10) => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
// the drawn systems: [{ page, sys: [{ top, bottom, left, right, cols: [[q, x0, x1]] }] }], client px
async function geo(page) {
  const g = await page.evaluate(() => window.resonateDebug().play.playback.geo());
  return g.map((pg) => ({ page: pg.page, systems: pg.systems.map((s) => ({ ...s, top: s.top + pg.rect[1], bottom: s.bottom + pg.rect[1], left: s.left + pg.rect[0], right: s.right + pg.rect[0], cols: s.cols.map(([q, x0, x1]) => [q, x0 + pg.rect[0], x1 + pg.rect[0]]) })) }));
}
const colPt = (s, i) => [(s.cols[i][1] + s.cols[i][2]) / 2, (s.top + s.bottom) / 2];
// a point on a system's staff lines, between two columns
const gapPt = (s, i) => [(s.cols[i][2] + s.cols[i + 1][1]) / 2, s.top + 0.3 * (s.bottom - s.top)];
// blank paper: no notehead within 40 px (below the first system, or wherever there's room)
async function blankPt(page) {
  return page.evaluate(() => {
    const heads = [...document.querySelectorAll("#stage .page g.notehead")].map((g) => { const r = g.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    const st = document.getElementById("stage").getBoundingClientRect();
    for (let y = st.top + 60; y < st.bottom - 140; y += 17) for (let x = st.left + 80; x < st.right - 80; x += 23) {
      if (heads.every(([hx, hy]) => Math.hypot(hx - x, hy - y) > 40)) return [x, y];
    }
    return null;
  });
}

// The reference schedule of a stretch [q0, end) of a view: Verovio's own timemap of that view in
// written order (a toolkit of its own, expandNever — in a page of its own: the Verovio wrapper
// keeps one module a page, a second toolkit would take the Play page's over), ties joined from the
// MusicXML's tie marks, cut at end, a key struck twice at once struck once (v79 review). → [{ id, midi, at (quarters from q0), dur (quarters) }] for
// the struck notes.
let refPage = null;
async function reference(browser, xml, view, q0, end) {
  if (!refPage) { refPage = await (await browser.newContext()).newPage(); await refPage.goto(BASE + "tools.html"); }
  return refPage.evaluate(async ([xml, view, q0, end]) => {
    const { cleanXml } = await import("./catalog.js?v=78");
    const { prepare, buildView } = await import("./playprep.js?v=78");
    const [{ default: cvm }, { VerovioToolkit }] = await Promise.all([import("./vendor/verovio-6.4.0/verovio-module.mjs"), import("./vendor/verovio-6.4.0/verovio.mjs")]);
    const tk = (window.__reftk ||= new VerovioToolkit(await cvm()));
    tk.setOptions({ expandNever: true });
    const P = prepare(cleanXml(xml));
    const v = buildView(P.doc, P.views[view]);
    tk.loadData(v.xml);
    const tm = tk.renderToTimemap({ includeMeasures: true });
    const on = new Map(), off = new Map();
    for (const e of tm) { for (const id of e.on || []) on.set(id, e.qstamp); for (const id of e.off || []) off.set(id, e.qstamp); }
    const el = new Map([...P.doc.querySelectorAll("note")].map((n) => [n.getAttribute("id"), n]));
    const ties = (id, t) => [...(el.get(id)?.querySelectorAll(`:scope > tie[type="${t}"], :scope > notations > tied[type="${t}"]`) || [])].length > 0;
    const notes = v.ids.filter((id) => on.has(id) && !el.get(id)?.querySelector(":scope > grace")).map((id) => ({ id, midi: P.facts.get(id).midi, part: P.facts.get(id).part, on: on.get(id), off: off.get(id) })).sort((a, b) => a.on - b.on);
    const out = [], open = new Map();
    for (const n of notes) {
      if (n.on < q0 - 1e-6 || n.on >= end - 1e-6) continue;
      const k = n.part + "|" + n.midi, o = ties(n.id, "stop") ? open.get(k) : null;
      if (o && Math.abs(o.on + o.dur - n.on) < 1e-6) { o.dur = Math.min(n.off, end) - o.on; if (!ties(n.id, "start")) open.delete(k); continue; }
      const it = { id: n.id, midi: n.midi, on: n.on, dur: Math.min(n.off, end) - n.on };
      out.push(it);
      if (ties(n.id, "start")) open.set(k, it); else open.delete(k);
    }
    // (a key struck twice at once — the voice and the piano's tune, two voices on a unison — is
    // struck once, the longer; the first on a tie: as playtime's track)
    const kept = [];
    for (const x of out) {
      const k = kept.find((y) => y.midi === x.midi && Math.abs(y.on - x.on) < 1e-6);
      if (!k) kept.push(x);
      else if (x.dur > k.dur + 1e-9) kept[kept.indexOf(k)] = x;
    }
    return kept.map((x) => ({ id: x.id, midi: x.midi, at: x.on - q0, dur: x.dur }));
  }, [xml, view, q0, end]);
}
// Compare a stretch's schedule (playback.scheduled, round 0) with the reference at spq s a quarter.
function sameSchedule(tag, got, ref, spq, t0) {
  const g = got.filter((x) => x.round === 0);
  const ids = (l) => l.map((x) => x.id).sort().join(",");
  ok(ids(g) === ids(ref), `${tag}: the notes struck = the reference's (${g.length} vs ${ref.length})`);
  const byId = new Map(g.map((x) => [x.id, x]));
  let worstAt = 0, worstDur = 0, midi = 0;
  for (const r of ref) {
    const x = byId.get(r.id);
    if (!x) continue;
    worstAt = Math.max(worstAt, Math.abs(x.when - t0 - r.at * spq));
    worstDur = Math.max(worstDur, Math.abs(x.dur - r.dur * spq));
    if (x.midi !== r.midi) midi++;
  }
  ok(worstAt < 0.002 && worstDur < 0.002 && !midi, `${tag}: times within ${(worstAt * 1000).toFixed(2)} ms, durations ${(worstDur * 1000).toFixed(2)} ms, MIDI wrong ${midi}`);
}

// Sources started after `at` (audio time) that weren't stopped at their start; sources made after
// `perf` (page time). → { late, made }
async function afterStop(page, at, perf) {
  return page.evaluate(([at, perf]) => {
    const late = window.__src.filter((r) => r.when > at + 0.01 && !(r.stops.length && r.stops[r.stops.length - 1] <= r.when + 1e-6)).length;
    const made = window.__src.filter((r) => r.made > perf + 50).length;
    return { late, made };
  }, [at, perf]);
}
async function stopCheck(page, tag, act) {
  const before = await page.evaluate(() => ({ now: window.resonateDebug().play.playback.now, perf: performance.now(), n: window.__src.length }));
  await act();
  await sleep(150);
  const st = await PBD(page);
  await sleep(1200);
  const r = await afterStop(page, before.now + 0.15, before.perf + 150);
  ok(st.state === "idle", `${tag}: stopped (${st.state})`);
  ok(r.late === 0 && r.made === 0, `${tag}: nothing sounds after (${r.late} sources would start later, ${r.made} made later)`);
}

// The iOS-like gate: every AudioContext the page makes starts suspended and runs only from a
// resume() called in a touch end / click.
function GATE() {
  window.__gesture = false;
  window.__ctxs = [];
  for (const t of ["pointerup", "click", "touchend", "keydown"]) window.addEventListener(t, () => { window.__gesture = true; setTimeout(() => { window.__gesture = false; }, 0); }, true);
  const AC = window.AudioContext;
  window.AudioContext = class extends AC {
    constructor(...a) { super(...a); window.__ctxs.push(this); this.__susp = true; this.__waiters = []; super.suspend(); }
    get state() { const s = super.state; return this.__susp && s !== "closed" ? "suspended" : s; }
    resume() {
      if (!this.__susp) return super.resume();
      if (window.__gesture) { this.__susp = false; const r = super.resume(); r.then(() => this.__waiters.splice(0).forEach((f) => f())); return r; }
      return new Promise((res) => this.__waiters.push(res));
    }
  };
  window.webkitAudioContext = window.AudioContext;
}

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const errors = [];
  const owner = ["killing", "wichita", "pianoman", "longest", "songbird"].filter(HAVE);
  if (owner.length < 5) console.log("(owner scores missing — PLAY_SCORES:", SCORES, ") — running what's there:", owner.join(", "));
  const list = [...owner.map((n) => ({ name: n, xml: read(OWNER(n)) })), { name: "timing-fixture", xml: TIMING_XML }];
  const AG = read("/home/user/resonate/public/songs/amazing-grace.musicxml");

  // ---------------------------------------------------------------- G gestures (iPad Air portrait)
  if (run("G")) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    let g = await geo(page);
    const s0 = g[0].systems[0], s1 = g[0].systems[1];
    // press-hold on a note: the peek, no stretch
    const head = await page.evaluate(() => { const g = document.querySelector('#stage g.note[id="n4"] > g.notehead'); const r = g.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await touchPath(ctx, page, [head], { hold: 500 });
    let d = await D(page), p = await PBD(page);
    ok(d.peekLog.length === 1 && !d.peekLog[0].cut && !p.span, `G1 press-hold on a note: it sounds (${JSON.stringify(d.peekLog)}), no stretch (${JSON.stringify(p.span)})`);
    // press on a note + drag: the peek's sound cut at once, a stretch from that note's onset
    await sleep(2200);
    const nq = await page.evaluate(() => window.resonateDebug().play.playback.timeline().els.find((e) => e.id === "n4").q);
    await touchPath(ctx, page, [head, ...line(head, colPt(s1, 2), 12).slice(1)], { hold: 350 });
    d = await D(page); p = await PBD(page);
    ok(d.peekLog.length === 2 && d.peekLog[1].cut, `G2 press then drag: the peek sounded then was cut (${JSON.stringify(d.peekLog[1])})`);
    ok(p.span && Math.abs(p.span.q0 - nq) < 1e-6 && Math.abs(p.span.q1 - s1.cols[2][0]) < 1e-6, `G2 the stretch: from the pressed note (q ${nq}) to the finger's onset (${s1.cols[2][0]}): ${JSON.stringify(p.span)}`);
    ok(p.bands.length === 2 && p.bands.every((b) => b.page === 1), `G2 a band a system: ${p.bands.length}`);
    ok(!d.peek, "G2 no peek on screen");
    await page.screenshot({ path: path.join(SHOTS, "G2-drag.png") });
    // the controls: ≥ 44 px, clear of the bands
    const sb = await page.evaluate(() => { const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return [b.width, b.height]; }; const bar = document.getElementById("selbar").getBoundingClientRect(); const over = [...document.querySelectorAll(".page .sel")].some((s) => { const b = s.getBoundingClientRect(); return b.left < bar.right && b.right > bar.left && b.top < bar.bottom && b.bottom > bar.top; }); return { play: r("sel-play"), loop: r("sel-loop"), speed: r("speed"), clear: r("sel-clear"), over }; });
    ok(Object.values(sb).filter(Array.isArray).every(([w, h]) => w >= 44 && h >= 44) && !sb.over, `G3 the stretch's controls ≥ 44 px, clear of the bands: ${JSON.stringify(sb)}`);
    // backwards, from blank staff
    await touchPath(ctx, page, line(gapPt(s1, 4), gapPt(s0, 1), 10));
    p = await PBD(page);
    ok(p.span && Math.abs(p.span.q0 - s0.cols[1][0]) < 1e-6 || Math.abs(p.span.q0 - s0.cols[2][0]) < 1e-6, `G4 backwards from blank staff: starts at the finger's onset (${p.span && p.span.q0} ~ ${s0.cols[1][0]}/${s0.cols[2][0]})`);
    ok(p.span && (Math.abs(p.span.q1 - s1.cols[4][0]) < 1e-6 || Math.abs(p.span.q1 - s1.cols[5][0]) < 1e-6), `G4 … to the press's onset (${p.span && p.span.q1} ~ ${s1.cols[4][0]}/${s1.cols[5][0]})`);
    const onsets = await page.evaluate(() => window.resonateDebug().play.playback.onsets());
    ok(p.span && p.span.end === onsets.find((q) => q > p.span.q1 + 1e-6), `G4 its end is the next onset after its last (${p.span && p.span.end})`);
    const span0 = p.span;
    // a tap on paper (no note) lets go
    await touchPath(ctx, page, [await blankPt(page)]);
    p = await PBD(page);
    ok(!p.span && !p.bands.length && !p.selbar, `G5 a tap on paper lets go: ${JSON.stringify(p.span)} bands ${p.bands.length}`);
    // a stretch, then −, +, names, a rotation: drawn again, the same
    await touchPath(ctx, page, line(colPt(s0, 2), colPt(s1, 6), 10));
    p = await PBD(page);
    const span1 = p.span;
    const bandsOk = async (tag) => { const x = await PBD(page); ok(x.span && Math.abs(x.span.q0 - span1.q0) < 1e-6 && Math.abs(x.span.end - span1.end) < 1e-6 && x.bands.length >= 1, `${tag}: the stretch kept and drawn (${x.bands.length} bands)`); return x; };
    await page.click("#smaller"); await sleep(500); await bandsOk("G6 after −");
    await page.click("#bigger"); await sleep(500); await bandsOk("G6 after +");
    await page.click("#names"); await sleep(200); await bandsOk("G6 names Some");
    await page.click("#names"); await page.click("#names"); await sleep(200);
    await page.setViewportSize({ width: 1180, height: 820 }); await sleep(900);
    await bandsOk("G6 rotated to landscape");
    await page.screenshot({ path: path.join(SHOTS, "G6-landscape.png") });
    await page.setViewportSize({ width: 820, height: 1180 }); await sleep(900);
    await bandsOk("G6 back to portrait");
    // another view: drawn on its own onsets
    await page.selectOption("#hands", "rh"); await ready(page, null, "rh");
    let x = await PBD(page);
    ok(x.span && Math.abs(x.span.q0 - span1.q0) < 1e-6 && x.bands.length >= 1, `G8 Right hand: the stretch kept and drawn (${x.bands.length})`);
    await page.selectOption("#hands", "both"); await ready(page, null, "both");
    // the stretch while playing: a tap on paper keeps it
    await page.tap("#sel-play");
    await until(page, () => window.resonateDebug().play.playback.state === "playing");
    g = await geo(page);
    await touchPath(ctx, page, [await blankPt(page)]);
    x = await PBD(page);
    ok(x.span && x.state === "playing", `G9 a tap on paper while playing: the stretch kept, still playing (${x.state})`);
    await page.tap("#sel-clear"); await sleep(200);
    x = await PBD(page);
    ok(!x.span && x.state === "idle" && !x.selbar, `G9 ✕: let go, stopped (${x.state})`);
    // another song lets go
    const ids = await seed(page, [{ name: "timing-fixture", xml: TIMING_XML }]);
    g = await geo(page);
    await touchPath(ctx, page, line(colPt(g[0].systems[0], 1), colPt(g[0].systems[0], 5), 6));
    ok(!!(await PBD(page)).span, "G10 a stretch on Amazing Grace");
    await openSong(page, ids["timing-fixture"]);
    x = await PBD(page);
    ok(!x.span && !x.bands.length, `G10 another song: let go (${JSON.stringify(x.span)})`);
    // across a turn: a band only where the stretch is (Killing Me Softly's full score: pages)
    if (HAVE("killing")) {
      const k = await seed(page, [{ name: "killing", xml: read(OWNER("killing")) }]);
      await openSong(page, k.killing, "score");
      g = await geo(page);
      const sy = g[0].systems;
      await touchPath(ctx, page, line(colPt(sy[0], 1), colPt(sy[sy.length - 1], 2), 12));
      const sp = (await PBD(page)).span;
      ok(!!sp && (await PBD(page)).bands.length === sy.length, `G7 a stretch over page 1's ${sy.length} systems`);
      await page.click("#next"); await sleep(300);
      x = await PBD(page);
      ok(x.span && x.span.q0 === sp.q0 && x.bands.length === 0, `G7 page 2: the stretch kept, no band (${x.bands.length})`);
      await page.click("#prev"); await sleep(300);
      x = await PBD(page);
      ok(x.span && x.bands.length === sy.length, `G7 back on page 1: drawn again (${x.bands.length})`);
      await page.screenshot({ path: path.join(SHOTS, "G7-killing.png") });
      // the speed menu tapped, then a pedal's key: the page turns, the speed stays
      const before = await page.evaluate(() => [document.getElementById("speed").value, window.resonateDebug().play.page]);
      await page.tap("#speed");
      await page.keyboard.press("Escape"); // (closed with no new pick: it keeps focus — an iPad never blurs it)
      await page.keyboard.press("ArrowRight");
      await sleep(300);
      const after = await page.evaluate(() => [document.getElementById("speed").value, window.resonateDebug().play.page, document.activeElement?.id || ""]);
      ok(after[0] === before[0] && after[1] === before[1] + 1 && after[2] !== "speed", `G11 speed menu tapped, then → : the page turns (${before[1]} → ${after[1]}), the speed stays (${after[0]}), the menu let go`);
      await page.click("#prev");
    }
    await ctx.close();
  }

  // ---------------------------------------------------------------- P the schedule
  if (run("P")) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await seed(page, list);
    // Amazing Grace, Both: a stretch over two systems, at ♩=80
    let g = await geo(page);
    const sA = g[0].systems[0], sB = g[0].systems[1];
    await touchPath(ctx, page, line(colPt(sA, sA.cols.length - 4), colPt(sB, 5), 12));
    let p = await PBD(page);
    let ref = await reference(browser, AG, "both", p.span.q0, p.span.end);
    await page.tap("#sel-play");
    await until(page, () => window.resonateDebug().play.playback.scheduled.length > 0 && !window.resonateDebug().play.playback.starting);
    await until(page, () => window.resonateDebug().play.playback.state === "idle", null, 30000);
    p = await PBD(page, true);
    info("AG stretch", JSON.stringify(p.span), "len", p.len, "tempo", p.tempo, "notes", p.scheduled.length);
    ok(p.tempo === 80, `P1 Amazing Grace at its ♩=80: ${p.tempo}`);
    sameSchedule("P1 Amazing Grace Both stretch", p.scheduled, ref, 60 / 80, p.t0);
    ok(Math.abs(p.len - (p.span.end - p.span.q0) * 0.75) < 1e-6, `P1 its length = its written length at ♩=80 (${p.len})`);
    ok(p.state === "idle" && !!p.span, `P1 played once, then stops, the stretch kept (${p.state})`);
    // the same stretch at 50%: every gap doubled
    await page.selectOption("#speed", "0.5");
    await page.tap("#sel-play");
    await until(page, () => window.resonateDebug().play.playback.scheduled.length > 0 && !window.resonateDebug().play.playback.starting);
    await until(page, () => window.resonateDebug().play.playback.state === "idle", null, 40000);
    const p50 = await PBD(page, true);
    sameSchedule("P2 the stretch at 50%", p50.scheduled, ref, 2 * 60 / 80, p50.t0);
    const rec = await page.evaluate(() => JSON.parse(localStorage.getItem("resonate.play"))["amazing-grace"]?.speed);
    ok(rec === 0.5, `P2 the speed is the song's (resonate.play: ${rec})`);
    await page.selectOption("#speed", "1");
    // ⟳: rounds one stretch-length apart (a one-bar stretch)
    g = await geo(page);
    const bar1 = await page.evaluate(() => { const T = window.resonateDebug().play.playback.timeline(); return T.bars[2]; });
    const cols = g[0].systems[0].cols.filter((c) => c[0] >= bar1.q - 1e-6 && c[0] < bar1.q + bar1.len - 1e-6);
    await touchPath(ctx, page, line(colPt({ ...g[0].systems[0], cols }, 0), colPt({ ...g[0].systems[0], cols }, cols.length - 1), 6));
    p = await PBD(page);
    ok(Math.abs(p.span.q0 - bar1.q) < 1e-6 && Math.abs(p.span.end - (bar1.q + bar1.len)) < 1e-6, `P3 one bar picked: ${JSON.stringify(p.span)} (bar ${JSON.stringify(bar1)})`);
    await page.tap("#sel-loop");
    await until(page, () => window.resonateDebug().play.playback.scheduled.some((x) => x.round >= 4), null, 20000);
    p = await PBD(page, true);
    ok(p.state === "looping", `P3 looping (${p.state})`);
    const rounds = {};
    const top = Math.max(...p.scheduled.map((x) => x.round));
    for (const x of p.scheduled) if (x.round < top) (rounds[x.round] ||= []).push(x); // (whole rounds)
    const r0 = rounds[0] || [];
    let worst = 0, n = 0;
    for (const [r, l] of Object.entries(rounds)) {
      if (Number(r) === 0) continue;
      n++;
      ok(l.length === r0.length, `P3 round ${r} plays round 0's ${r0.length} notes (${l.length})`);
      for (let i = 0; i < Math.min(l.length, r0.length); i++) worst = Math.max(worst, Math.abs(l[i].when - r0[i].when - Number(r) * p.len));
    }
    ok(n >= 3 && worst < 1e-6 && Math.abs(p.len - bar1.len * 0.75) < 1e-9, `P3 ${n} more rounds, each exactly one stretch (${p.len} s) after the last (worst ${worst})`);
    await page.selectOption("#speed", "0.8"); await sleep(1800);
    p = await PBD(page, true);
    const last = p.scheduled.filter((x, i, a) => i > 0 && x.when - a[i - 1].when > 0.0001);
    ok(p.state === "looping" && p.playSpeed === 0.8, `P3 speed changed while looping: still looping at 80% (${p.playSpeed})`);
    await page.tap("#sel-loop"); await sleep(200);
    ok((await PBD(page)).state === "idle", "P3 ⟳ again stops");
    // the fixture: ♩=120, then ♩=60 from bar 3; a grace note, a tie, a triplet
    await openSong(page, ids["timing-fixture"]);
    await page.tap("#play");
    await until(page, () => window.resonateDebug().play.playback.scheduled.length > 0 && !window.resonateDebug().play.playback.starting);
    await sleep(300);
    p = await PBD(page, true);
    const it = p.items.map((x) => [x.midi, +x.sec.toFixed(4), +x.hold.toFixed(4), x.sound]);
    info("fixture items", JSON.stringify(it));
    const want = [[72, 0, 0.5, true], [48, 0, 2, true], [74, 0.5, 0.5, true], [76, 0.93, 0.07, true], [77, 1, 0.5, true], [79, 1.5, 1, true], [43, 2, 2, true], [79, 2, 0, false], [81, 2.5, 0.1667, true], [83, 2.6667, 0.1667, true], [84, 2.8333, 0.1667, true], [84, 3, 1, true], [48, 4, 4, true], [72, 4, 4, true], [74, 8, 2, true], [76, 10, 2, true]];
    const key = (l) => l.map((x) => x.join(":")).sort().join(" ");
    ok(key(it) === key(want), `P4 fixture: ♩=120 then 60, grace 70 ms early, the tie joined, the triplet in thirds:\n     got  ${key(it)}\n     want ${key(want)}`);
    ok(p.tempo === 120 && Math.abs(p.len - 12) < 1e-9, `P4 tempo ${p.tempo}, length ${p.len} s`);
    await page.click("#play");
    // Killing Me Softly, Full score: a stretch over a page's systems vs Verovio's timemap (♩=100)
    if (ids.killing) {
      await openSong(page, ids.killing, "score");
      g = await geo(page);
      const a = g[0].systems[1], b = g[0].systems[2] || g[0].systems[1];
      await touchPath(ctx, page, line(colPt(a, 1), colPt(b, b.cols.length - 2), 12));
      p = await PBD(page);
      ref = await reference(browser, read(OWNER("killing")), "score", p.span.q0, p.span.end);
      await page.tap("#sel-play");
      await until(page, () => window.resonateDebug().play.playback.scheduled.length > 0 && !window.resonateDebug().play.playback.starting);
      await sleep(4500);
      p = await PBD(page, true);
      const due = ref.filter((r) => r.at * 0.6 < 4.4 - 0.12);
      const got = p.scheduled.filter((x) => due.some((r) => r.id === x.id));
      sameSchedule(`P5 Killing Me Softly Full score stretch (first ${due.length} notes)`, got, due, 60 / 100, p.t0);
      ok(p.scheduled.every((x) => ref.some((r) => r.id === x.id)), "P5 nothing struck outside the reference");
      await page.click("#play");
    }
    await ctx.close();
  }

  // ---------------------------------------------------------------- O Sing's order; tempo
  if (run("O")) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await seed(page, list);
    const singOrder = (xml) => page.evaluate(async (xml) => {
      const { cleanXml } = await import("./catalog.js?v=78");
      const { parseMusicXml } = await import("./musicxml.js?v=78");
      const sc = parseMusicXml(cleanXml(xml));
      return { order: sc.measureOf || null, tempo: sc.tempo, written: sc.unfolded?.written ?? sc.measures.length };
    }, xml);
    for (const name of ["killing", "wichita"]) {
      if (!ids[name]) continue;
      await openSong(page, ids[name], "both");
      const so = await singOrder(read(OWNER(name)));
      await page.tap("#play");
      await until(page, () => window.resonateDebug().play.playback.order);
      let p = await PBD(page);
      ok(JSON.stringify(p.order) === JSON.stringify(so.order), `O1 ${name} from page 1: Sing's order (${p.order?.length} bars played of ${so.written}; Sing ${so.order?.length})`);
      await page.click("#play");
      // from a later page: the first time Sing plays that page's first bar
      const d = await D(page);
      if (d.pages > 2) {
        await page.click("#next"); await page.click("#next"); await sleep(300);
        const first = await page.evaluate(() => { const g = document.querySelector("#stage .page g.measure"); return Number(g.id.slice(1)); });
        await page.tap("#play");
        await until(page, () => window.resonateDebug().play.playback.order);
        p = await PBD(page);
        const k = so.order.indexOf(first);
        ok(p.from === k && JSON.stringify(p.order) === JSON.stringify(so.order.slice(k)), `O2 ${name} from page 3 (bar ${first}): Sing's order from its first time there (index ${p.from} = ${k})`);
        await page.click("#play");
        await page.click("#prev"); await page.click("#prev");
      }
    }
    if (ids.killing) ok((await singOrder(read(OWNER("killing")))).order.length === 107, "O1 Killing Me Softly: 69 written → 107 played");
    // Piano Man: no tempo in the score → Sing's 90; its own ♩=174 (Sing's typed tempo) → 174
    if (ids.pianoman) {
      await openSong(page, ids.pianoman, "both");
      await page.tap("#play");
      await until(page, () => window.resonateDebug().play.playback.scheduled.length > 5);
      let p = await PBD(page, true);
      ok(p.tempo === 90, `O3 Piano Man with no tempo of its own: Sing's ♩=${p.tempo}`);
      const gap90 = p.items.find((x, i, a) => i && x.sec > a[0].sec) ;
      await page.click("#play");
      await page.evaluate((id) => { const t = JSON.parse(localStorage.getItem("resonate.sing.timing") || "{}"); t[id] = { sig: "x", segs: [], use: false, bpm: 174 }; localStorage.setItem("resonate.sing.timing", JSON.stringify(t)); }, ids.pianoman);
      await page.tap("#play");
      await until(page, () => window.resonateDebug().play.playback.scheduled.length > 5);
      const p2 = await PBD(page, true);
      ok(p2.tempo === 174 && p2.bpm === 174, `O3 Piano Man with its own ♩=174: ${p2.tempo}`);
      const ratio = p.items.filter((x) => x.sec > 0).slice(0, 20).map((x, i) => p2.items.filter((y) => y.sec > 0)[i].sec / x.sec);
      ok(ratio.every((r) => Math.abs(r - 90 / 174) < 1e-9), `O3 every time × 90/174 (${ratio.slice(0, 3).map((r) => r.toFixed(4))})`);
      await page.click("#play");
    }
    await ctx.close();
  }

  // ---------------------------------------------------------------- L lit, strip, auto turn
  if (run("L")) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await seed(page, list);
    // Amazing Grace from the page: sample what's lit
    await page.tap("#play");
    await until(page, () => window.resonateDebug().play.playback.lit.length > 0);
    let bad = 0, samples = 0;
    for (let i = 0; i < 8; i++) {
      await sleep(330);
      const r = await page.evaluate(() => {
        const x = window.resonateDebug().play.playback;
        const now = x.now - x.latency;
        return { lit: x.lit.slice().sort(), els: x.litEls.slice().sort(), strip: x.strip.map((k) => k.midi).sort((a, b) => a - b), now, state: x.state };
      });
      const p = await PBD(page, true);
      // what the schedule says sounds at that moment (± a frame)
      const want = p.scheduled.filter((x) => x.when <= r.now - 0.02 && r.now + 0.02 < x.when + Math.max(x.dur, 0.09));
      const wantIds = new Set(want.map((x) => x.id));
      const missing = [...wantIds].filter((id) => !r.lit.includes(id));
      const els = r.lit.filter((id) => !r.els.includes(id));
      samples++;
      if (missing.length || els.length) { bad++; info("lit sample", JSON.stringify({ missing, els, lit: r.lit })); }
      const facts = await page.evaluate((ids) => ids.map((id) => window.resonateDebug().play.facts[id]?.midi), r.lit);
      const midis = [...new Set(facts)].sort((a, b) => a - b);
      if (r.lit.length && JSON.stringify(midis) !== JSON.stringify(r.strip)) { bad++; info("strip", JSON.stringify({ midis, strip: r.strip })); }
    }
    ok(bad === 0, `L1 the lit heads and the strip's keys = what's scheduled now (${samples} samples, ${bad} off)`);
    await page.screenshot({ path: path.join(SHOTS, "L1-playing.png") });
    await page.click("#play");
    // auto turn: Killing Me Softly, Full score at ♩=400 (its own tempo set for the test)
    if (ids.killing) {
      await page.evaluate((id) => { const t = JSON.parse(localStorage.getItem("resonate.sing.timing") || "{}"); t[id] = { sig: "x", segs: [], use: false, bpm: 400 }; localStorage.setItem("resonate.sing.timing", JSON.stringify(t)); }, ids.killing);
      await openSong(page, ids.killing, "score");
      const order = await page.evaluate(() => window.resonateDebug().play.playback.singOrder());
      const pageOf = await page.evaluate((o) => o.map((mi) => window.resonateDebug().play.playback.pageOf(mi)), order);
      // a jump back to an earlier page (a repeat), and the page it starts from
      const j = order.findIndex((mi, k) => k && pageOf[k] < pageOf[k - 1]);
      info("Killing pages", (await D(page)).pages, "jump back at", j, "from bar", order[j - 1], "(p", pageOf[j - 1], ") to bar", order[j], "(p", pageOf[j], ")");
      // ▶ from the page before the jump's page: a turn forward, then back
      const startPage = Math.max(1, pageOf[j - 1] - 1);
      while ((await D(page)).page < startPage) { await page.click("#next"); await sleep(150); }
      await page.tap("#play");
      const turned = await until(page, ([p]) => window.resonateDebug().play.playback.turns.length >= 2 || window.resonateDebug().play.playback.state === "idle", [startPage], 40000);
      let p = await PBD(page);
      info("turns", JSON.stringify(p.turns));
      ok(turned && p.turns.length >= 2 && p.turns[0].page > startPage, `L2 auto turn forward from page ${startPage}: ${JSON.stringify(p.turns.slice(0, 3).map((t) => [t.mi, t.page]))}`);
      const back = p.turns.find((t, i) => i && t.page < p.turns[i - 1].page) || (p.turns[0] && p.turns.find((t) => t.page < p.turns[0].page));
      await until(page, () => window.resonateDebug().play.playback.turns.some((t, i, a) => i && t.page < a[i - 1].page), null, 40000);
      p = await PBD(page);
      const backT = p.turns.find((t, i, a) => i && t.page < a[i - 1].page);
      ok(!!backT && backT.mi === order[j], `L3 back to page ${backT && backT.page} on the repeat (bar ${backT && backT.mi}; Sing's jump to bar ${order[j]})`);
      const dd = await D(page);
      ok(dd.shown.includes(p.musicPage) && dd.at === (await page.evaluate(() => Number(document.querySelector("#stage .page g.measure").id.slice(1)))), `L3 the place follows (page ${dd.page}, at bar ${dd.at})`);
      // a turn by hand while playing isn't fought: the music's page stays away until it moves
      const music = p.musicPage;
      await page.click(dd.page > 1 ? "#prev" : "#next");
      await sleep(80);
      const mine = (await D(page)).page;
      await sleep(200);
      const p2 = await PBD(page);
      const d2 = await D(page);
      ok(d2.page === mine || p2.musicPage !== music, `L4 a turn by hand: kept (${mine} → ${d2.page}) until the music moves on (music page ${music} → ${p2.musicPage})`);
      await until(page, ([m]) => window.resonateDebug().play.playback.musicPage !== m, [music], 20000);
      await sleep(100);
      const p3 = await PBD(page), d3 = await D(page);
      ok(d3.shown.includes(p3.musicPage), `L4 … then the music's next page is followed (shown ${d3.shown}, music ${p3.musicPage})`);
      await page.screenshot({ path: path.join(SHOTS, "L4-killing.png") });
      await page.click("#play");
    }
    await ctx.close();
  }

  // ---------------------------------------------------------------- S stops; a peek; −/+ while playing
  if (run("S")) {
    const pdf = pdfmini(3).toString("base64");
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await seed(page, [...list, { name: "withpdf", xml: list.find((x) => x.name === "killing")?.xml || AG, pdf }]);
    const start = async () => { await page.tap("#play"); await until(page, () => window.resonateDebug().play.playback.scheduled.length > 3); await sleep(400); };
    await start();
    await stopCheck(page, "S1 ■ in the bar", () => page.click("#play"));
    const g = await geo(page);
    await touchPath(ctx, page, line(colPt(g[0].systems[0], 2), colPt(g[0].systems[1], 4), 8));
    await page.tap("#sel-play"); await until(page, () => window.resonateDebug().play.playback.scheduled.length > 3); await sleep(400);
    await stopCheck(page, "S2 the stretch's ■", () => page.tap("#sel-play"));
    await page.tap("#sel-loop"); await until(page, () => window.resonateDebug().play.playback.scheduled.length > 3); await sleep(400);
    await stopCheck(page, "S3 ⟳ again", () => page.tap("#sel-loop"));
    // a peek while playing: it sounds, the music plays on
    await start();
    const head = await page.evaluate(() => { const g = [...document.querySelectorAll("#stage g.note:not(.play) > g.notehead")][20]; const r = g.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    const n0 = (await D(page)).peekLog.length;
    await touchPath(ctx, page, [head], { hold: 400 });
    let d = await D(page), p = await PBD(page);
    ok(d.peekLog.length === n0 + 1 && p.state === "playing", `S4 a peek while playing: it sounds (${d.peekLog.length - n0}), still playing (${p.state})`);
    // − while playing: plays on, lit again
    await page.click("#smaller"); await sleep(700);
    p = await PBD(page);
    ok(p.state === "playing" && p.litEls.length === p.lit.length, `S5 − while playing: still playing, lit on the new drawing (${p.litEls.length}/${p.lit.length})`);
    await page.click("#bigger"); await sleep(300);
    await stopCheck(page, "S6 another view", () => page.selectOption("#hands", "rh"));
    await ready(page, null, "rh");
    await start();
    await stopCheck(page, "S7 another song", () => page.selectOption("#song", ids["timing-fixture"]));
    await ready(page, ids["timing-fixture"]);
    await start();
    await stopCheck(page, "S8 the page hidden", () => page.evaluate(() => window.__hide(true)));
    await page.evaluate(() => window.__hide(false));
    await openSong(page, ids.withpdf);
    await until(page, () => !document.getElementById("pdf").hidden, null, 10000);
    await start();
    await stopCheck(page, "S9 📄", () => page.click("#pdf"));
    await until(page, () => window.resonateDebug().play.pdf.canvas, null, 15000);
    const pd = await page.evaluate(() => ({ play: document.getElementById("play").disabled, selbar: !document.getElementById("selbar").hidden }));
    ok(pd.play && !pd.selbar, `S9 in the PDF view ▶ is off, no controls over it (${JSON.stringify(pd)})`);
    await page.click("#pdf");
    await ctx.close();
  }

  // ---------------------------------------------------------------- I an iOS-like gate
  if (run("I")) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors, { gate: true });
    const s0 = await page.evaluate(() => window.__ctxs.map((c) => c.state));
    await page.tap("#play");
    const played = await until(page, () => window.resonateDebug().play.playback.scheduled.length > 0, null, 8000);
    const r = await page.evaluate(() => ({ ctxs: window.__ctxs.map((c) => c.state), state: window.resonateDebug().play.playback.state, live: window.__src.filter((s) => s.ctx.state === "running").length }));
    ok(played && r.state === "playing" && r.live > 0, `I1 iOS-like gate: ▶ tapped first → plays on a running context (${JSON.stringify(r)}; contexts before ${JSON.stringify(s0)})`);
    await page.click("#play");
    await ctx.close();
  }

  await browser.close();
  const errs = errors.filter((e) => !/Unsupported bar-style|could not be ended|ties left open|could not be set as running/.test(e));
  ok(!errs.length, `no page errors: ${errs.slice(0, 5).join(" | ")}`);
  console.log(`${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
