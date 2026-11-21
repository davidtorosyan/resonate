// Play (v80): choose what ▶ and ⟳ play — "I want to see the full score so I can see the lyrics and
// the vocal melody, but I only want to play the piano part". A chip a part (coloured as its keys),
// at the keyboard's left end, or in the stretch's controls when the keyboard is off.
//
//   A  the chips per view on every owner score and the fixtures: the Full score's Voice / Piano /
//      other parts (Piano Man's P3 "Part 3", a guitar by its name), a full score that is the piano
//      alone (The Longest Time, score-tunein) or a hymn: RH / LH; Both: RH / LH; one hand, Melody,
//      a voice-only song: none — in the dock left of the keys, ≥ 44 px, in their keys' colours, all
//      pressed; the dock's height unchanged; the keys lit in the chip's colour (Part 3 pink)
//   B  the schedule (playtime track with hear): Voice muted → no voice note struck, the piano's
//      copies of the tune struck (unisons the voice used to take), every chord's level from the keys
//      really struck (n = distinct heard keys struck together; some chords softer by one key less);
//      Piano muted → only the voice; Piano Man: Part 3 muted, then Voice + Part 3; Killing's Both:
//      LH muted → only the right hand; nothing muted = v79's schedule (hear null)
//   C  remembered: resonate.play[id].hear per view, across a reload and a song switch; at least one
//      stays on; a record muting everything hears everything
//   D  a change while playing: mute the voice mid-song → nothing of it starts after, what it sounded
//      damped, the piano's tune comes in; unmute → it's struck again; mid-loop: Piano muted between
//      rounds → the next rounds only the voice, still one stretch-length apart; audible sources
//      (the Web Audio graph) = the schedule's log after the change
//   E  lit: sampled while ▶ plays with the voice muted — the keyboard lights exactly the heard lit
//      notes' keys (never a voice key), the page .play = heard; a muted note never lit (v86: v80 lit
//      them lighter, .hush — the owner: "I would expect it to not highlight those notes")
//   F  a press always sounds: the voice muted, a press on a voice note strikes it
//   G  the keyboard off: the chips in the stretch's controls (hidden idle with no stretch; with ▶
//      and with a stretch), a tap there mutes while playing, 🎹 on moves them to the dock (on a phone
//      they stay in the controls where the keys would get under 8 px a white key beside them); a
//      phone (390 wide): the controls with the chips inside the stage, wrapped with a stretch
//
// usage: node playhear.cjs   (BASE=http://localhost:8097/resonate/, PLAY_SCORES=<the owner's
//   converted .musicxml — never copied into the repo>, ONLY=A,B,…, SHOTS=<dir>)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8097/resonate/";
const SCRATCH = "/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad";
const SCORES = process.env.PLAY_SCORES ?? path.join(SCRATCH, "play/scores");
const FIX = path.join(__dirname, "fixtures/play");
const SHOTS = process.env.SHOTS || path.join(SCRATCH, "playshots/hear");
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

function INIT() {
  try { if (!navigator.audioSession) Object.defineProperty(navigator, "audioSession", { configurable: true, value: { type: "auto" } }); } catch {}
  window.__key = (key) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  // every buffer source: when it starts, every stop asked of it
  window.__src = [];
  const S = AudioBufferSourceNode.prototype.start, P = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.start = function (when = 0, ...a) { this.__rec = { when, stops: [], made: performance.now(), ctx: this.context }; window.__src.push(this.__rec); return S.call(this, when, ...a); };
  AudioBufferSourceNode.prototype.stop = function (when = 0) { this.__rec?.stops.push(when); return P.call(this, when); };
}
const D = (page) => page.evaluate(() => { const d = window.resonateDebug?.().play; if (!d) return null; const { facts, countAll, playback, ...rest } = d; return rest; });
const PBD = (page, all = false) => page.evaluate((all) => { const x = window.resonateDebug().play.playback; const { geo, onsets, timeline, singOrder, pageOf, ...rest } = x; if (!all) { rest.items = rest.items.length; rest.scheduled = rest.scheduled.length; } return rest; }, all);
const HEAR = (page) => page.evaluate(() => window.resonateDebug().play.playback.hear);
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
    const L = await import("./library.js?v=79");
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
}
// CDP touch: a press, moves, a lift (client px)
async function touchPath(ctx, page, pts, { hold = 0, step = 16 } = {}) {
  const cdp = await ctx.newCDPSession(page);
  const t = (type, p) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ x: p[0], y: p[1], id: 1 }] : [] });
  await t("touchStart", pts[0]);
  if (hold) await sleep(hold);
  for (const p of pts.slice(1)) { await t("touchMove", p); await sleep(step); }
  if (pts.length > 1) { await t("touchMove", pts[pts.length - 1]); await sleep(150); }
  await t("touchEnd");
  await cdp.detach().catch(() => {});
}
const line = (a, b, n = 10) => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
// a stretch dragged over system `si` of the first page shown, columns i → j
async function dragStretch(ctx, page, si, i, j) {
  const g = await page.evaluate(() => window.resonateDebug().play.playback.geo());
  const s = g[0].systems[si] || g[0].systems[0], pr = g[0].rect;
  const pt = (k) => [pr[0] + (s.cols[k][1] + s.cols[k][2]) / 2, pr[1] + s.top + 0.3 * (s.bottom - s.top)];
  await touchPath(ctx, page, line(pt(i), pt(Math.min(j, s.cols.length - 1)), 10));
  await sleep(200);
}
// a chip's tap (its button in #hear)
const chip = (page, key) => page.tap(`#hear button[data-key="${key}"]`);
// the full schedule of what ▶ would play from page 1 (played for a moment, then ■): items with
// their part / staff
async function schedule(page) {
  await page.evaluate(() => { for (let i = 0; i < 400 && window.resonateDebug().play.page > 1; i++) window.__key("ArrowLeft"); });
  await page.tap("#play");
  await until(page, () => window.resonateDebug().play.playback.scheduled.length > 0 && !window.resonateDebug().play.playback.starting);
  await page.tap("#play");
  await sleep(100);
  return page.evaluate(() => { const p = window.resonateDebug().play; return p.playback.items.map((x) => ({ ...x, part: p.facts[x.id]?.part, staff: p.facts[x.id]?.staff })); });
}
// clusters of keys struck together (playtime's STRUCK: within 10 ms of the cluster's first)
function clusters(items) {
  const out = [];
  for (let i = 0; i < items.length;) {
    let j = i;
    while (j < items.length && items[j].sec < items[i].sec + 0.01) j++;
    out.push(items.slice(i, j));
    i = j;
  }
  return out;
}
const near = (a, b) => Math.abs(a.sec - b.sec) < 0.002 && a.midi === b.midi;

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const errors = [];
  const K = HAVE("killing"), PM = HAVE("pianoman");
  if (!K) console.log("(owner scores missing — PLAY_SCORES:", SCORES, ") — the owner-song checks are skipped");
  const OWN = ["killing", "pianoman", "songbird", "wichita", "longest"].filter(HAVE);
  const FIXS = ["score-pvg", "score-guitar", "score-duet", "score-tunein", "synth-voice"];

  // ---------------------------------------------------------------- A the chips per view
  if (run("A")) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await seed(page, [...OWN.map((n) => ({ name: n, xml: read(OWNER(n)) })), ...FIXS.map((n) => ({ name: n, xml: read(path.join(FIX, n + ".musicxml")) }))]);
    ids["amazing-grace"] = "amazing-grace";
    const RL = (p) => [["RH", p + "|1", "rh"], ["LH", p + "|2", "lh"]];
    const want = {
      killing: { score: [["Voice", "P1", "voice"], ["Piano", "P2", "piano"]], both: RL("P2") },
      pianoman: { score: [["Voice", "P1", "voice"], ["Piano", "P2", "piano"], ["Part 3", "P3", "part"]], both: RL("P2") },
      songbird: { score: [["Voice 1", "P1", "voice"], ["Voice 2", "P2", "voice"], ["Piano", "P3", "piano"]], both: RL("P3") },
      wichita: { score: [["Voice", "P1", "voice"], ["Piano", "P2", "piano"]], both: RL("P2") },
      longest: { score: RL("P1"), both: RL("P1") },
      "amazing-grace": { score: [["RH", "P1", "rh"], ["LH", "P2", "lh"]], both: [["RH", "P1", "rh"], ["LH", "P2", "lh"]] },
      "score-pvg": { score: [["Voice", "P1", "voice"], ["Piano", "P2", "piano"], ["Guitar", "P3", "part"]], both: RL("P2") },
      "score-guitar": { score: [["Voice", "P1", "voice"], ["Guitar", "P2", "part"]], both: [["Voice", "P1", "voice"], ["Guitar", "P2", "part"]] },
      "score-duet": { score: [["Voice", "P2", "voice"], ["Piano", "P3", "piano"]], both: RL("P3") },
      "score-tunein": { score: RL("P1"), both: RL("P1") },
      "synth-voice": { both: [] },
    };
    const BG = { voice: "rgb(11, 143, 120)", rh: "rgb(166, 79, 255)", lh: "rgb(79, 124, 255)", part: "rgb(214, 51, 108)" };
    for (const song of Object.keys(want)) {
      if (!ids[song]) continue;
      await openSong(page, ids[song]);
      const views = (await D(page)).views;
      for (const view of views) {
        await openSong(page, ids[song], view);
        const h = await HEAR(page);
        const exp = want[song][view] || [];
        const got = h.groups.map((g) => [g.label, g.key, g.hand]);
        ok(JSON.stringify(got) === JSON.stringify(exp), `A ${song} ${view}: chips ${JSON.stringify(got)} (want ${JSON.stringify(exp)})`);
        if (!exp.length) { ok(h.home === null && !h.shown, `A ${song} ${view}: no chips shown (${h.home})`); continue; }
        const x = await page.evaluate(() => {
          const r = (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
          const dock = document.getElementById("dock"), strip = document.getElementById("strip");
          return {
            dock: r(dock), strip: r(strip),
            chips: [...document.querySelectorAll("#hear button")].map((b) => { const cs = getComputedStyle(b); return { r: r(b), bg: cs.backgroundColor, img: cs.backgroundImage, pressed: b.getAttribute("aria-pressed"), hand: b.dataset.hand }; }),
          };
        });
        const inDock = x.chips.every((c) => c.r[0] >= x.dock[0] && c.r[2] <= x.strip[0] + 0.5 && c.r[1] >= x.dock[1] - 0.5 && c.r[3] <= x.dock[3] + 0.5 && c.r[3] - c.r[1] >= 44 - 0.5);
        ok(h.home === "dock" && h.shown && inDock, `A ${song} ${view}: in the dock, left of the keys, ≥ 44 px (${JSON.stringify(x.chips.map((c) => c.r.map(Math.round)))} strip ${x.strip.map(Math.round)})`);
        ok(Math.abs(x.dock[3] - x.dock[1] - (x.strip[3] - x.strip[1]) - 12) < 1, `A ${song} ${view}: the dock's height is the keys' + its padding (${(x.dock[3] - x.dock[1]).toFixed(1)})`);
        const colours = x.chips.every((c) => (c.hand === "piano" ? /166, 79, 255/.test(c.img) && /79, 124, 255/.test(c.img) : c.bg === BG[c.hand]) && c.pressed === "true");
        ok(colours, `A ${song} ${view}: in their keys' colours, all heard (${JSON.stringify(x.chips.map((c) => [c.hand, c.bg, c.img.slice(0, 60), c.pressed]))})`);
        ok(!h.saved && h.muted.length === 0, `A ${song} ${view}: nothing muted, nothing saved`);
        if (song === "pianoman" && view === "score") await page.screenshot({ path: path.join(SHOTS, "A-pianoman-score.png") });
      }
    }
    // the keys in the chip's colour: Piano Man's Part 3 (pink), the voice (green), the piano (hands)
    if (PM) {
      await openSong(page, ids.pianoman, "score");
      // (Part 3 plays from bar 48 on: ▶ from its page)
      const target = await page.evaluate(() => { const p = window.resonateDebug().play; const mi = Math.min(...Object.values(p.facts).filter((f) => f.part === "P3").map((f) => f.mi)); return p.playback.pageOf(mi); });
      await page.evaluate((t) => { for (let i = 0; i < 400 && window.resonateDebug().play.page < t; i++) window.__key("ArrowRight"); }, target);
      await page.tap("#play");
      const seen = new Map();
      let wrong = 0;
      for (let i = 0; i < 100; i++) {
        await sleep(100);
        const s = await page.evaluate(() => { const p = window.resonateDebug().play; return p.playback.strip.map((k) => ({ hand: k.hand, of: p.playback.lit.map((id) => p.facts[id]).filter((f) => f?.midi === k.midi).map((f) => f.part + "|" + f.staff) })); });
        for (const k of s) {
          // (a key two parts strike shows one of their colours)
          const hands = k.of.map((pp) => (pp.startsWith("P3") ? "part" : pp.startsWith("P1") ? "voice" : pp.endsWith("|2") ? "lh" : "rh"));
          if (!hands.includes(k.hand)) wrong++;
          for (const pp of k.of) if (hands.length === 1) seen.set(pp + ">" + k.hand, (seen.get(pp + ">" + k.hand) || 0) + 1);
        }
        if ([...seen.keys()].some((k) => k.startsWith("P3|"))) break;
      }
      await page.tap("#play"); await sleep(150);
      const keys = [...seen.keys()];
      ok(wrong === 0 && keys.includes("P3|1>part") && keys.every((k) => !k.startsWith("P1") || k.endsWith(">voice")) && keys.some((k) => /^P2\|[12]>(rh|lh)$/.test(k)), `A Piano Man's Full score from page ${target}: Part 3's keys lit pink as its chip, the piano by hand, every shared key one of its parts' colours (${JSON.stringify([...seen])}, ${wrong} wrong)`);
    }
    await ctx.close();
  }

  // ---------------------------------------------------------------- B the schedule
  if (run("B") && K) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await seed(page, [{ name: "killing", xml: read(OWNER("killing")) }, ...(PM ? [{ name: "pianoman", xml: read(OWNER("pianoman")) }] : [])]);
    await openSong(page, ids.killing, "score");
    const all = await schedule(page);
    const struck = (xs) => xs.filter((x) => x.sound);
    ok(all.length > 1000 && all.every((x) => !x.muted) && struck(all).some((x) => x.part === "P1") && struck(all).some((x) => x.part === "P2"), `B Killing's Full score, all heard: ${all.length} items, ${struck(all).length} struck, voice and piano`);
    // the levels with everything heard
    const levels = (xs) => { let bad = 0; for (const c of clusters(xs)) { const n = new Set(c.filter((x) => x.sound).map((x) => x.midi)).size; for (const x of c) if (x.n !== n) bad++; } return bad; };
    ok(levels(all) === 0, `B all heard: every chord's n = the keys struck together (${levels(all)} off)`);
    // Voice muted
    await chip(page, "P1");
    const nv = await schedule(page);
    const p1 = nv.filter((x) => x.part === "P1");
    ok(nv.length === all.length && p1.length > 0 && p1.every((x) => x.muted && !x.sound), `B Voice muted: every voice note on the schedule, none struck (${p1.length} muted, ${p1.filter((x) => x.sound).length} struck)`);
    // the piano's copies of the tune: unisons the voice took are now struck
    const tookOver = struck(all).filter((x) => x.part === "P1").map((v) => nv.find((y) => y.part === "P2" && near(y, v))).filter(Boolean);
    ok(tookOver.length > 100 && tookOver.every((y) => y.sound), `B Voice muted: the piano's copy of the tune struck where the voice was (${tookOver.filter((y) => y.sound).length} of ${tookOver.length})`);
    ok(struck(nv).every((x) => x.part === "P2") && struck(nv).length === struck(all).filter((x) => x.part === "P2").length + tookOver.length, `B Voice muted: only the piano struck — its own ${struck(all).filter((x) => x.part === "P2").length} + the tune's ${tookOver.length} = ${struck(nv).length}`);
    info(`B numbers: voice items ${p1.length}; all heard: struck ${struck(all).length} (P1 ${struck(all).filter((x) => x.part === "P1").length}, P2 ${struck(all).filter((x) => x.part === "P2").length}); voice muted: struck ${struck(nv).length}, tune taken over ${tookOver.length}`);
    const softer = clusters(nv).filter((c) => { const a = all.find((x) => x.id === c[0].id); return a && c[0].n != null && a.n > c[0].n; }).length;
    info(`B numbers: ${softer} moments a key thinner`);
    ok(levels(nv) === 0 && softer > 0, `B Voice muted: every chord's n = the heard keys struck together (${levels(nv)} off); ${softer} moments a key less (the voice's own notes no longer count)`);
    // Piano muted (the voice heard again)
    await chip(page, "P1"); await chip(page, "P2");
    const np = await schedule(page);
    ok(struck(np).length > 0 && struck(np).every((x) => x.part === "P1") && np.filter((x) => x.part === "P2").every((x) => x.muted && !x.sound) && levels(np) === 0, `B Piano muted: only the voice struck (${struck(np).length}), the piano's ${np.filter((x) => x.part === "P2").length} notes muted`);
    // = what the Melody view strikes (the voice alone): its unisons with the piano struck now
    await openSong(page, ids.killing, "melody");
    const mel = await schedule(page);
    await openSong(page, ids.killing, "score");
    ok(JSON.stringify(struck(np).map((x) => [x.id, x.n, x.hold])) === JSON.stringify(struck(mel).map((x) => [x.id, x.n, x.hold])), `B Piano muted: struck = the Melody view's, levels and lengths too (${struck(np).length} vs ${struck(mel).length})`);
    await chip(page, "P2");
    const again = await schedule(page);
    ok(JSON.stringify(again.map((x) => [x.id, x.sound, x.n, x.hold])) === JSON.stringify(all.map((x) => [x.id, x.sound, x.n, x.hold])), "B everything heard again: the schedule is v79's (hear null) exactly");
    // Both: LH muted → only the right hand
    await openSong(page, ids.killing, "both");
    await chip(page, "P2|2");
    const nl = await schedule(page);
    ok(struck(nl).length > 0 && struck(nl).every((x) => x.staff === 1) && nl.filter((x) => x.staff === 2).every((x) => x.muted), `B Killing's Both, LH muted: only the right hand struck (${struck(nl).length}; ${nl.filter((x) => x.staff === 2).length} LH notes muted)`);
    await chip(page, "P2|2");
    if (PM) {
      await openSong(page, ids.pianoman, "score");
      const pa = await schedule(page);
      await chip(page, "P3");
      const n3 = await schedule(page);
      ok(pa.some((x) => x.part === "P3" && x.sound) && n3.every((x) => x.part !== "P3" || (x.muted && !x.sound)) && struck(n3).some((x) => x.part === "P1") && struck(n3).some((x) => x.part === "P2") && levels(n3) === 0, `B Piano Man: Part 3 muted → none of it struck, voice and piano are (${struck(n3).length} struck)`);
      await chip(page, "P1");
      const n13 = await schedule(page);
      ok(struck(n13).length > 0 && struck(n13).every((x) => x.part === "P2") && levels(n13) === 0, `B Piano Man: Voice + Part 3 muted → only the piano (${struck(n13).length})`);
      const h = await HEAR(page);
      ok(JSON.stringify(h.muted.sort()) === '["P1","P3"]' && h.groups.find((g) => g.key === "P2").heard, `B Piano Man: muted ${JSON.stringify(h.muted)}`);
      // the last one heard can't be muted
      await chip(page, "P2");
      const h2 = await HEAR(page);
      ok(JSON.stringify(h2.muted.sort()) === '["P1","P3"]' && h2.chips.find((c) => c.key === "P2").pressed, `B Piano Man: the last one heard stays on (${JSON.stringify(h2.muted)})`);
      await chip(page, "P1"); await chip(page, "P3");
    }
    await ctx.close();
  }

  // ---------------------------------------------------------------- C remembered
  if (run("C") && K && PM) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await seed(page, [{ name: "killing", xml: read(OWNER("killing")) }, { name: "pianoman", xml: read(OWNER("pianoman")) }]);
    const rec = (id) => page.evaluate((id) => JSON.parse(localStorage.getItem("resonate.play") || "{}")[id]?.hear ?? null, id);
    await openSong(page, ids.killing, "score");
    await chip(page, "P1");
    ok(JSON.stringify(await rec(ids.killing)) === '{"score":["P1"]}', `C Voice muted: saved ${JSON.stringify(await rec(ids.killing))}`);
    await openSong(page, ids.killing, "both");
    let h = await HEAR(page);
    ok(h.groups.every((g) => g.heard), `C Both: its own chips, all heard (${JSON.stringify(h.groups)})`);
    await chip(page, "P2|2");
    ok(JSON.stringify(await rec(ids.killing)) === '{"score":["P1"],"both":["P2|2"]}', `C LH muted in Both: saved ${JSON.stringify(await rec(ids.killing))}`);
    await page.reload(); await ready(page);
    await openSong(page, ids.killing, "both");
    h = await HEAR(page);
    ok(JSON.stringify(h.muted) === '["P2|2"]' && h.chips.find((c) => c.key === "P2|2").pressed === false, `C a reload: Both's LH still muted (${JSON.stringify(h.muted)})`);
    await openSong(page, ids.killing, "score");
    h = await HEAR(page);
    ok(JSON.stringify(h.muted) === '["P1"]', `C a reload: the Full score's voice still muted (${JSON.stringify(h.muted)})`);
    await openSong(page, ids.pianoman, "score");
    h = await HEAR(page);
    ok(h.muted.length === 0 && h.groups.length === 3 && !(await rec(ids.pianoman)), `C another song: its own chips, all heard (${JSON.stringify(h.groups.map((g) => g.label))})`);
    await openSong(page, ids.killing, "score");
    h = await HEAR(page);
    ok(JSON.stringify(h.muted) === '["P1"]', `C back to Killing: still the voice muted`);
    // unmuting removes the entry; nothing muted anywhere removes hear
    await chip(page, "P1");
    ok(JSON.stringify(await rec(ids.killing)) === '{"both":["P2|2"]}', `C the voice heard again: ${JSON.stringify(await rec(ids.killing))}`);
    await openSong(page, ids.killing, "both");
    await chip(page, "P2|2");
    ok((await rec(ids.killing)) === null, `C everything heard: no hear record (${JSON.stringify(await rec(ids.killing))})`);
    // a record that mutes everything (another version, a hand edit): everything heard
    await page.evaluate((id) => { const all = JSON.parse(localStorage.getItem("resonate.play") || "{}"); all[id] = { ...(all[id] || {}), hear: { score: ["P1", "P2"], both: ["X9"] } }; localStorage.setItem("resonate.play", JSON.stringify(all)); }, ids.killing);
    await page.reload(); await ready(page);
    await openSong(page, ids.killing, "score");
    h = await HEAR(page);
    ok(h.muted.length === 0 && h.chips.every((c) => c.pressed), `C a record muting everything: everything heard (${JSON.stringify(h.muted)})`);
    await openSong(page, ids.killing, "both");
    h = await HEAR(page);
    ok(h.muted.length === 0, `C a record naming no chip: everything heard`);
    await ctx.close();
  }

  // ---------------------------------------------------------------- D a change while playing
  if (run("D") && K) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await seed(page, [{ name: "killing", xml: read(OWNER("killing")) }]);
    await openSong(page, ids.killing, "score");
    const allItems = await schedule(page);
    await page.tap("#play");
    await until(page, () => window.resonateDebug().play.playback.scheduled.length > 3);
    await sleep(2000);
    const tm = await page.evaluate(() => window.resonateDebug().play.playback.now);
    await chip(page, "P1");
    await sleep(2500);
    const tu = await page.evaluate(() => window.resonateDebug().play.playback.now);
    await chip(page, "P1");
    await sleep(2500);
    const r = await page.evaluate(([tm]) => {
      const p = window.resonateDebug().play, x = p.playback;
      const log = x.scheduled.map((e) => ({ ...e, part: p.facts[e.id]?.part }));
      const ctxs = new Set(window.__src.map((s) => s.ctx));
      const a = [...ctxs].pop();
      const audible = window.__src.filter((s) => s.ctx === a && s.when > tm + 0.06 && !s.stops.some((t) => t <= s.when + 1e-6));
      return { log, audible: audible.length, state: x.state };
    }, [tm]);
    const after = (t0, t1) => r.log.filter((e) => e.when > t0 + 0.06 && e.when < t1);
    const mutedSpan = after(tm, tu);
    ok(mutedSpan.length > 0 && mutedSpan.every((e) => e.part === "P2"), `D the voice muted at ${tm.toFixed(2)} s: ${mutedSpan.length} notes struck after it, all the piano's`);
    const sounding = r.log.filter((e) => e.part === "P1" && e.when <= tm && e.when + e.dur > tm + 0.06);
    ok(sounding.every((e) => e.cut != null && e.cut >= tm - 0.01 && e.cut <= tm + 0.3), `D what the voice sounded then was damped (${JSON.stringify(sounding.map((e) => [e.id, e.cut && e.cut.toFixed(2)]))})`);
    // the piano's copy of the tune struck in the muted stretch (unisons the voice took)
    const tuneIn = mutedSpan.filter((e) => allItems.some((v) => v.part === "P1" && v.sound && v.midi === e.midi && allItems.some((y) => y.id === e.id && Math.abs(y.sec - v.sec) < 0.002)));
    ok(tuneIn.length > 0, `D the piano's tune came in (${tuneIn.length} unisons struck by the piano)`);
    const back = after(tu, Infinity);
    ok(back.some((e) => e.part === "P1") && back.some((e) => e.part === "P2"), `D unmuted at ${tu.toFixed(2)} s: the voice struck again (${back.filter((e) => e.part === "P1").length}) with the piano`);
    const logged = r.log.filter((e) => e.when > tm + 0.06).length;
    ok(Math.abs(r.audible - logged) <= 1, `D audible sources started after the change = the log's (${r.audible} vs ${logged})`);
    await page.tap("#play"); await sleep(200);
    // mid-loop: a stretch looped, the piano muted between rounds
    await dragStretch(ctx, page, 1, 1, 8); // (the 2nd line: the piano's chords under the tune — the 1st line's piano doubles it)
    await page.tap("#sel-loop");
    // (in round 1 by the audio clock — the schedule runs 4 s ahead of it)
    await until(page, () => { const x = window.resonateDebug().play.playback; const r1 = x.scheduled.find((e) => e.round === 1); return r1 && x.now > r1.when + 0.3; }, null, 30000);
    const t2 = await page.evaluate(() => window.resonateDebug().play.playback.now);
    await chip(page, "P2");
    await until(page, () => { const x = window.resonateDebug().play.playback; const r = x.scheduled.find((e) => e.round === 4); return r && x.now > r.when; }, null, 40000);
    const L = await page.evaluate(() => { const p = window.resonateDebug().play, x = p.playback; return { len: x.len, speed: x.playSpeed, state: x.state, log: x.scheduled.map((e) => ({ ...e, part: p.facts[e.id]?.part })) }; });
    const late = L.log.filter((e) => e.when > t2 + 0.06);
    const byRound = (k) => L.log.filter((e) => e.round === k);
    const r0 = byRound(0), rLast = byRound(Math.max(...L.log.map((e) => e.round)) - 1);
    ok(L.state === "looping" && late.length > 0 && late.every((e) => e.part === "P1"), `D mid-loop, Piano muted at ${t2.toFixed(2)} s: ${late.length} notes after, all the voice's`);
    ok(r0.some((e) => e.part === "P2") && rLast.length > 0 && rLast.every((e) => e.part === "P1"), `D round 0 had the piano (${r0.filter((e) => e.part === "P2").length}), a later round only the voice (${rLast.length})`);
    const v0 = r0.filter((e) => e.part === "P1"), vl = rLast;
    const k = vl[0]?.round;
    ok(v0.length === vl.length && v0.every((e, i) => Math.abs(vl[i].when - e.when - (k * L.len) / L.speed) < 1e-6), `D the rounds still one stretch-length apart (${v0.length} voice notes a round, round ${k})`);
    await page.tap("#play").catch(() => {}); await sleep(200);
    await chip(page, "P2");
    await ctx.close();
  }

  // ---------------------------------------------------------------- E lit: what sounds, what's muted
  if (run("E") && K) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await seed(page, [{ name: "killing", xml: read(OWNER("killing")) }]);
    await openSong(page, ids.killing, "score");
    await chip(page, "P1");
    await page.tap("#play");
    await until(page, () => window.resonateDebug().play.playback.lit.length > 0);
    let samples = 0, bad = 0, voiceKey = 0, voicePlay = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 6000) {
      const s = await page.evaluate(() => {
        const p = window.resonateDebug().play, x = p.playback;
        const shown = new Set([...document.querySelectorAll("#stage .page g.note")].map((g) => g.id));
        const heard = x.lit;
        return {
          keys: x.strip.map((k) => k.midi).sort((a, b) => a - b), hands: x.strip.map((k) => k.hand),
          want: [...new Set(heard.map((id) => p.facts[id]?.midi))].sort((a, b) => a - b),
          playEls: x.litEls.slice().sort(), wantPlay: heard.filter((id) => shown.has(id)).sort(),
          voiceLit: x.litEls.filter((id) => p.facts[id]?.part === "P1").length,
        };
      });
      samples++;
      if (JSON.stringify(s.keys) !== JSON.stringify(s.want) || JSON.stringify(s.playEls) !== JSON.stringify(s.wantPlay)) { bad++; if (bad < 4) info("E off:", JSON.stringify(s)); }
      voicePlay += s.voiceLit;
      if (s.hands.includes("voice")) voiceKey++;
      if (samples === 10) await page.screenshot({ path: path.join(SHOTS, "E-muted-unlit.png") });
      await sleep(120);
    }
    await page.tap("#play"); await sleep(200);
    ok(bad <= 1 && samples > 15, `E the keyboard = the heard lit notes' keys, .play = heard (${samples} samples, ${bad} off — a frame between two reads)`);
    ok(voicePlay === 0 && voiceKey === 0, `E the muted voice never lit on the page (${voicePlay} voice notes .play), never on the keyboard (${voiceKey})`);
    const st = await PBD(page);
    ok(st.litEls.length === 0 && st.strip.length === 0, `E ■: nothing lit (${st.litEls.length} ${st.strip.length})`);
    // the lighter look: a muted head's colour and its pill's
    await ctx.close();
  }

  // ---------------------------------------------------------------- F a press always sounds
  if (run("F") && K) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await seed(page, [{ name: "killing", xml: read(OWNER("killing")) }]);
    await openSong(page, ids.killing, "score");
    await chip(page, "P1");
    await page.tap("#prev").catch(() => {}); // (a first tap: the context unlocked)
    await sleep(300);
    const pt = await page.evaluate(() => {
      const p = window.resonateDebug().play;
      for (const g of document.querySelectorAll("#stage .page g.note")) {
        if (p.facts[g.id]?.part !== "P1") continue;
        const h = g.querySelector(":scope > g.notehead"), r = h?.getBoundingClientRect();
        if (r && r.width) return { x: r.left + r.width / 2, y: r.top + r.height / 2, id: g.id, midi: p.facts[g.id].midi };
      }
      return null;
    });
    await touchPath(ctx, page, [[pt.x, pt.y]], { hold: 400 });
    await sleep(100);
    const d = await page.evaluate(() => { const p = window.resonateDebug().play; return { log: p.peekLog.at(-1), muted: p.playback.hear.muted }; });
    ok(d.log && d.log.midis.includes(pt.midi) && JSON.stringify(d.muted) === '["P1"]', `F the voice muted, a press on a voice note (${pt.id}) strikes it: ${JSON.stringify(d.log)}`);
    await ctx.close();
  }

  // ---------------------------------------------------------------- G the keyboard off: the chips in the stretch's controls
  if (run("G") && K) {
    for (const [w, h] of [[820, 1180], [390, 844]]) {
      const { ctx, page } = await newPage(browser, w, h, errors, { before: () => localStorage.setItem("resonate.play.keys", "off") });
      const ids = await seed(page, [{ name: "killing", xml: read(OWNER("killing")) }, ...(PM ? [{ name: "pianoman", xml: read(OWNER("pianoman")) }] : [])]);
      const song = PM ? ids.pianoman : ids.killing;
      await openSong(page, song, "score");
      let hr = await HEAR(page);
      ok(!(await D(page)).keys.shown && hr.home === "selbar" && !hr.shown, `G ${w}×${h} keyboard off, idle, no stretch: the chips not shown (${hr.home}, ${hr.shown})`);
      await page.tap("#play");
      await until(page, () => window.resonateDebug().play.playback.state === "playing" && !window.resonateDebug().play.playback.starting);
      hr = await HEAR(page);
      let p = await PBD(page);
      const st = await page.evaluate(() => { const r = document.getElementById("stage").getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; });
      const inside = (r) => r[0] >= st[0] - 0.5 && r[0] + r[2] <= st[2] + 0.5 && r[1] >= st[1] - 0.5 && r[1] + r[3] <= st[3] + 0.5;
      ok(hr.shown && hr.home === "selbar" && p.selbar && inside(p.selbar.rect) && hr.chips.every((c) => c.rect[3] >= 43.5 && inside(c.rect)), `G ${w}×${h} ▶: the chips in the controls (${JSON.stringify(p.selbar?.rect.map(Math.round))}), inside the stage`);
      if (w === 390) await page.screenshot({ path: path.join(SHOTS, "G-phone-play.png") });
      // a tap there mutes while playing
      const k = hr.groups[0].key;
      await chip(page, k);
      await sleep(1200);
      p = await PBD(page, true);
      const parts = await page.evaluate((ids) => ids.map((id) => window.resonateDebug().play.facts[id]?.part), p.scheduled.slice(-8).map((e) => e.id));
      ok(p.state === "playing" && p.hear.muted.includes(k) && parts.every((x) => x !== k), `G ${w}×${h}: ${k} muted from the controls while playing (${JSON.stringify(parts)})`);
      await chip(page, k);
      await page.tap("#play"); await sleep(200);
      hr = await HEAR(page);
      ok(!hr.shown && !(await PBD(page)).selbar, `G ${w}×${h} ■: the controls and the chips gone`);
      // a stretch: the controls with ⟳ ✕ and the chips
      await dragStretch(ctx, page, 1, 1, 6);
      hr = await HEAR(page);
      p = await PBD(page);
      ok(p.span && p.selbar && p.selbar.loop && hr.shown && hr.home === "selbar" && inside(p.selbar.rect) && hr.chips.every((c) => inside(c.rect)), `G ${w}×${h} a stretch: the controls with ⟳ ✕ and the chips, inside the stage (${JSON.stringify(p.selbar?.rect.map(Math.round))})`);
      if (w === 390) await page.screenshot({ path: path.join(SHOTS, "G-phone-stretch.png") });
      // 🎹 on: the chips move to the dock — where the keys keep ≥ 8 px a white key beside them (an
      // iPad); on a phone Piano Man's three chips would leave its six octaves ~3.6 px a key: they
      // stay in the controls and the keys get the dock's width
      await page.tap("#keys"); await ready(page); await sleep(200);
      hr = await HEAR(page);
      p = await PBD(page);
      const kw = await page.evaluate(() => { const r = window.resonateDebug().play.keys.range; let n = 0; for (let m = r[0]; m <= r[1]; m++) if ([0, 2, 4, 5, 7, 9, 11].includes(m % 12)) n++; return document.getElementById("strip").getBoundingClientRect().width / n; });
      if (w === 390 && PM) ok(hr.home === "selbar" && hr.shown && kw >= 8, `G ${w}×${h} 🎹 on: the chips stay in the controls, the keys ${kw.toFixed(1)} px a white key (${hr.home})`);
      else ok(hr.home === "dock" && hr.shown && p.selbar && kw >= 8 && !(await page.evaluate(() => !!document.querySelector("#selbar #hear"))), `G ${w}×${h} 🎹 on: the chips in the dock, not in the controls (${hr.home}), the keys ${kw.toFixed(1)} px a white key`);
      await page.tap("#keys"); await ready(page); await sleep(200);
      hr = await HEAR(page);
      ok(hr.home === "selbar" && hr.shown, `G ${w}×${h} 🎹 off again: back in the controls`);
      await ctx.close();
    }
  }

  await browser.close();
  const real = errors.filter((e) => !/favicon|ERR_|net::/.test(e));
  ok(real.length === 0, `no page errors: ${JSON.stringify(real.slice(0, 5))}`);
  console.log(`\nplayhear: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
