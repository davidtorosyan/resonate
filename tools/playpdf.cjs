// Play's PDF view (📄, v88): where the bars are on the original PDF, zoom and pan, the focus border,
// ⟳ Reprocess, and the hooks for an assistant.
//
//   M  the map (pdfmap.js) against the engine's own geometry: tools/fixtures/trace/greensleeves —
//      Audiveris's MusicXML vs the Reader's grid (system boxes) and measures (barline x) events of
//      the same run, every system and bar of 4 sheets; greensleeves3.pdf (a title page + the first 3
//      sheets) → its music pages found (2, 3, 4); gs.pdf (4 pages = 4 sheets) → the same pages; the
//      owner's Killing Me Softly (PLAY_SCORES / uploads, never in the repo) → pages 2–7, 69/69 bars;
//      Piano Man (sheet 1 read at another interline than the rest) → every system on the PDF's staves
//   O  📄 with a stretch picked (desktop 1280×800, mouse drag over bars 5–6): opens on PDF page 2,
//      zoomed (> 1.5×), one rect on the second system, its x / y on the engine's barlines and
//      staff lines, its border on screen around it (3 px, outside); ⌖ comes back to it after a pan
//   Z  iPad 820×1180 (touch): no stretch → the score page's bars, borders on each of its systems; a
//      pinch (two CDP fingers) zooms about their middle, a finger pans, − / + step ×1.5, a double
//      tap toggles fitted ⇄ ×2.5; the part on screen drawn again sharp (its pixels a CSS px = the
//      zoom × the pixel ratio, more than the base canvas's) and in register with the base; desktop:
//      ctrl + wheel zooms at the pointer, the wheel pans
//   T  ‹ › and ArrowRight / Left still turn while zoomed (the zoom kept, the new page from its top);
//      taps on the PDF sound nothing; ▶ off there
//   R  ⟳ Reprocess: there, confirm → pdf-import.html?reprocess=<id>; Cancel → stays;
//      resonatePlay.reprocess set → called with the id, after the same question
//   F  resonatePlay.focus() → { song, view, measures, numbers, selection, pdf: { page, rects } };
//      pdfCrop() → a PNG with the red border (without the PDF view open, too)
//   S  the one-page shell (shell.html, iPad): the Score's 📄 opens the same view, zoomed, borders
//   K  the owner's Killing Me Softly: screenshots of the border on a stretch and a page (looked at)
//
// usage: node playpdf.cjs   (BASE=http://localhost:8097/resonate/, ONLY=M,O,…, SHOTS=<dir>)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8097/resonate/";
const SCRATCH = "/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad";
const SHOTS = process.env.SHOTS || path.join(SCRATCH, "v88");
fs.mkdirSync(SHOTS, { recursive: true });
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const run = (s) => !ONLY || ONLY.has(s);
let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) passes++; else fails++; console.log(`${c ? "ok  " : "FAIL"} ${msg}`); return c; };
const sleep = (t) => new Promise((r) => setTimeout(r, t));

// --- fixtures -------------------------------------------------------------------------------------
const FIX = path.join(__dirname, "fixtures");
const unzip = (f) => { const out = fs.mkdtempSync(path.join(SCRATCH, "mxl-")); require("child_process").execFileSync("unzip", ["-o", "-q", f, "-d", out]); const x = fs.readdirSync(out).find((n) => n.endsWith(".xml")); return fs.readFileSync(path.join(out, x), "utf8"); };
const GS_XML = unzip(path.join(FIX, "trace/greensleeves.mxl"));
const GS_EV = require(path.join(FIX, "trace/greensleeves.events.json")).events.map((x) => x.ev);
// greensleeves3.pdf = a title page + the first 3 sheets: the MusicXML without its 4th page
const GS3_XML = GS_XML.replace(/<measure number="49"[\s\S]*?(?=<\/part>)/g, "").replace(/<miscellaneous-field name="source-sheet-4">[^<]*<\/miscellaneous-field>/, "");
const GS3_PDF = fs.readFileSync(path.join(FIX, "import/greensleeves3.pdf"));
const GS4_PDF = fs.existsSync("/home/user/sitetest/gs.pdf") ? fs.readFileSync("/home/user/sitetest/gs.pdf") : null;
const UP = "/root/.claude/uploads/6042bc19-5f16-52ea-a295-8ea17a932323/";
const K_XML = path.join(UP, "06ccb3dd-Killing_Me_Softly_With_His_Song.musicxml");
const K_PDF = "/home/user/sitetest/killing.pdf";
const HAVE_K = fs.existsSync(K_XML) && fs.existsSync(K_PDF);
// Piano Man: sheet 1 read at an interline of 18 px, every later sheet at 17 — each page's tenths are
// its own (the review: every later page's rects scaled ×1.059 about the corner)
const PM_XML = path.join(process.env.PLAY_SCORES || path.join(SCRATCH, "play/scores"), "pianoman.musicxml"), PM_PDF = "/home/user/sitetest/pm.pdf";
const HAVE_PM = fs.existsSync(PM_XML) && fs.existsSync(PM_PDF);
const GW = 2550, GH = 3300; // the run's sheets (300 dpi, letter)
const grid = (s) => GS_EV.find((e) => e.t === "grid" && e.s === s);
const bars = (s, sys) => GS_EV.find((e) => e.t === "measures" && e.s === s && e.sys === sys)?.xs || [];

function INIT() {
  try { if (!navigator.audioSession) Object.defineProperty(navigator, "audioSession", { configurable: true, value: { type: "auto" } }); } catch {}
  window.__key = (key) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}
const D = (page) => page.evaluate(() => { const d = window.resonateDebug().play; return { ready: d.ready, song: d.song, page: d.page, pdf: d.pdf, peeks: d.peekLog.length, t: d.t }; });
const ready = (page, song) => page.waitForFunction((s) => { const d = window.resonateDebug?.().play; return d && d.ready && (!s || d.song === s); }, song, { timeout: 90000 });
const pdfReady = (page, more = "true") => page.waitForFunction(`(() => { const p = window.resonateDebug().play.pdf; return p.on && !p.busy && p.canvas && p.fit && (${more}); })()`, null, { timeout: 60000 });
const settled = async (page, ms = 700) => { await sleep(ms); return (await D(page)).pdf; };
async function newPage(browser, w, h, touch, errors) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror " + e.message));
  page.on("console", (m) => { const t = m.text(); if (m.type() === "error") errors.push("console.error " + t.slice(0, 200)); else if (m.type() === "warning" && /^(pdf|song|play)\b/.test(t)) errors.push("console.warn " + t.slice(0, 200)); });
  await page.goto(BASE + "play.html");
  await ready(page);
  return { ctx, page };
}
async function seed(page, list) {
  const ids = await page.evaluate(async (list) => {
    const L = await import("./library.js?v=" + document.getElementById("version").textContent.trim().replace(/^v/, ""));
    const ids = {};
    for (const s of list) {
      ids[s.name] = await L.addSong(s.name, s.xml, { source: "pdf", ...(s.pages ? { pages: s.pages } : {}) });
      await L.putPdf(ids[s.name], Uint8Array.from(atob(s.pdf), (c) => c.charCodeAt(0)).buffer, s.name + ".pdf");
    }
    return ids;
  }, list.map((s) => ({ ...s, pdf: s.pdf.toString("base64") })));
  await page.reload();
  await ready(page);
  return ids;
}
async function openSong(page, id) {
  if ((await D(page)).song !== id) { await page.selectOption("#song", id); await ready(page, id); }
  await page.waitForFunction(() => window.resonateDebug().play.pdf.has, null, { timeout: 10000 });
}
const pdfOn = async (page, more) => { await page.click("#pdf"); await pdfReady(page, more); return settled(page); };
const pdfOff = async (page) => { await page.click("#pdf"); await page.waitForFunction(() => !window.resonateDebug().play.pdf.on); };
const wrapRect = (page) => page.evaluate(() => { const r = document.getElementById("pdfwrap").getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
async function touches(ctx, page, frames, dt = 16) {
  const cdp = await ctx.newCDPSession(page);
  for (let i = 0; i < frames.length; i++) {
    const pts = frames[i].map(([x, y], id) => ({ x, y, id }));
    const type = i === 0 ? "touchStart" : i === frames.length - 1 && !pts.length ? "touchEnd" : "touchMove";
    await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
    await sleep(dt);
  }
  await cdp.detach().catch(() => {});
}
const tap = async (ctx, page, x, y) => touches(ctx, page, [[[x, y]], []], 40);
// the sheet point (CSS px at zoom 1) under a client point
const sheetAt = (pdf, wr, x, y) => [(x - wr[0] - pdf.tx) / pdf.z, (y - wr[1] - pdf.ty) / pdf.z];
// base vs the sharp copy: the copy drawn down to the base's pixels, the shift (−3…3 px both ways)
// where the two match best — 0, 0 when it's in register
const register = (page) => page.evaluate(() => {
  const p = window.resonateDebug().play.pdf, base = document.getElementById("pdfview"), det = document.querySelector("#pdfwrap .pdfdetail");
  if (!det || !p.detail) return null;
  const k0 = base.width / p.fit.bw;
  const w = Math.floor(Math.min(240, (p.detail.x1 - p.detail.x0 - 8) * k0)), h = Math.floor(Math.min(240, (p.detail.y1 - p.detail.y0 - 8) * k0));
  const bx = Math.round((p.detail.x0 + 4) * k0), by = Math.round((p.detail.y0 + 4) * k0);
  const c = new OffscreenCanvas(w + 8, h + 8), x = c.getContext("2d");
  x.fillStyle = "#fff"; x.fillRect(0, 0, w + 8, h + 8);
  // (the copy's pixels for the base's [bx − 4, bx + w + 4) × [by − 4, by + h + 4))
  const kd = p.detail.k / k0;
  x.drawImage(det, (bx - 4 - p.detail.x0 * k0) * kd, (by - 4 - p.detail.y0 * k0) * kd, (w + 8) * kd, (h + 8) * kd, 0, 0, w + 8, h + 8);
  const D = x.getImageData(0, 0, w + 8, h + 8).data, B = base.getContext("2d").getImageData(bx, by, w, h).data;
  let best = null;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    let e = 0;
    for (let y = 0; y < h; y += 2) for (let xx = 0; xx < w; xx += 2) e += Math.abs(B[(y * w + xx) * 4] - D[((y + 4 + dy) * (w + 8) + xx + 4 + dx) * 4]);
    if (!best || e < best.e) best = { dx, dy, e };
  }
  return best;
});

(async () => {
  const browser = await chromium.launch();
  const errors = [];

  // ===== M: the map ================================================================================
  if (run("M")) {
    const { ctx, page } = await newPage(browser, 1280, 800, false, errors);
    const r = await page.evaluate(async (xml) => {
      const m = await import("./pdfmap.js?v=" + document.getElementById("version").textContent.trim().replace(/^v/, ""));
      return m.readLayout(xml);
    }, GS_XML);
    ok(r && r.sheets.join() === "1,2,3,4" && r.measures.length === 66, `M greensleeves: a layout, sheets ${r?.sheets}, ${r?.measures.length} bars`);
    let worstY = 0, worstX = 0, nsys = 0, nbars = 0, counts = true;
    for (let s = 1; s <= 4; s++) {
      grid(s).systems.forEach((sy, k) => {
        const ms = r.measures.filter((m) => m.page === s - 1 && m.sys === k), xs = bars(s, k + 1);
        if (ms.length !== xs.length - 1) counts = false;
        worstY = Math.max(worstY, Math.abs(ms[0].y0 * GH - sy.box[1]), Math.abs(ms[0].y1 * GH - sy.box[3]));
        xs.forEach((x, i) => { worstX = Math.max(worstX, Math.abs((i < ms.length ? ms[i].x0 : ms.at(-1).x1) * GW - x)); });
        nsys++; nbars += ms.length;
      });
    }
    ok(counts && nsys === 16 && nbars === 66, `M every system's bars where the engine has them (${nsys} systems, ${nbars} bars)`);
    ok(worstX <= 4, `M barlines within ${worstX.toFixed(1)} px of the engine's (of ${GW})`);
    ok(worstY <= 16, `M staff tops / bottoms within ${worstY.toFixed(1)} px of the engine's (of ${GH}: a system's height rounds its staves to 40 tenths)`);
    // the PDF pages: found by staves; the same pages; the owner's
    const ids = await seed(page, [{ name: "GS3", xml: GS3_XML, pdf: GS3_PDF }, { name: "GS3r", xml: GS3_XML, pdf: GS3_PDF, pages: [4, 3, 2] }, ...(GS4_PDF ? [{ name: "GS4", xml: GS_XML, pdf: GS4_PDF }] : []), ...(HAVE_K ? [{ name: "Killing", xml: fs.readFileSync(K_XML, "utf8"), pdf: fs.readFileSync(K_PDF) }] : [])]);
    fs.writeFileSync(path.join(SCRATCH, "v88/ids.json"), JSON.stringify(ids));
    await openSong(page, ids.GS3);
    let p = await pdfOn(page);
    await sleep(1200); // (kept with the song's record: saved a second later)
    ok(p.map?.how === (p.map?.how === "record" ? "record" : "staves") && p.map.pages.join() === "2,3,4" && p.map.matched === 48, `M greensleeves3.pdf (a title page first): sheets → PDF pages ${p.map?.pages} (${p.map?.how}), ${p.map?.matched}/${p.map?.bars} bars`);
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("resonate.play"))[window.resonateDebug().play.song]?.pdfMusic);
    ok(kept?.n === 4 && kept.music.join() === "2,3,4", `M the music pages kept with the song (${JSON.stringify(kept)}, found in ${(await D(page)).t.pdfMusic} ms)`);
    await pdfOff(page);
    // the song's own record of its pages (PDF → Song, v88: library getPages) wins — here a made-up order
    if (await page.evaluate(async () => typeof (await import("./library.js?v=" + document.getElementById("version").textContent.trim().replace(/^v/, ""))).getPages === "function")) {
      await openSong(page, ids.GS3r);
      p = await pdfOn(page);
      ok(p.map?.how === "record" && p.map.pages.join() === "4,3,2", `M the song's record of its pages: ${p.map?.pages} (${p.map?.how})`);
      await pdfOff(page);
    } else console.log("   (library.js has no getPages yet: the record's path not checked)");
    if (GS4_PDF) {
      await openSong(page, ids.GS4);
      p = await pdfOn(page);
      ok(["same", "record"].includes(p.map?.how) && p.map.pages.join() === "1,2,3,4" && p.map.matched === 66, `M gs.pdf (4 pages, 4 sheets): ${p.map?.pages} (${p.map?.how})`);
      await pdfOff(page);
    }
    if (HAVE_K) {
      await openSong(page, ids.Killing);
      p = await pdfOn(page);
      ok(p.map?.pages.join() === "2,3,4,5,6,7" && p.map.matched === p.map.bars && p.map.bars === 69, `M Killing (title page + 6 music pages): ${p.map?.pages} (${p.map?.how}), ${p.map?.matched}/${p.map?.bars} bars`);
      await pdfOff(page);
    }
    if (HAVE_PM) {
      // every system against the staves found on its PDF page (pdfprep findStaves, 150 dpi): its top
      // line on a staff's top line, its last barline on that staff's right end (300 dpi px). Systems
      // under half the page wide are Musicnotes' boxed fills (the shortest isn't found as a staff);
      // the song's first system is left out across (its bars add up short in the export itself).
      const fit = await page.evaluate(async ({ xml, pdf }) => {
        const M = await import("./pdfmap.js?v=" + document.getElementById("version").textContent.trim().replace(/^v/, ""));
        const L = M.readLayout(xml);
        const lib = await import("./omr/pdfjs/pdf.min.mjs");
        lib.GlobalWorkerOptions.workerSrc = new URL("./omr/pdfjs/pdf.worker.min.mjs", location.href).href;
        const doc = await lib.getDocument({ data: Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0)), wasmUrl: "./omr/pdfjs/wasm/" }).promise;
        const { findStaves } = await import("./omr/pdfprep.js?v=" + document.getElementById("version").textContent.trim().replace(/^v/, ""));
        const music = await M.musicPages(doc, findStaves, { need: Math.max(...L.sheets) });
        const pages = M.sheetPages(L, { numPages: doc.numPages, music });
        let dy = 0, dx = 0, n = 0;
        for (let k = 0; k < L.sheets.length; k++) {
          const pg = await doc.getPage(pages[k]), vp = pg.getViewport({ scale: 150 / 72 });
          const w = Math.round(vp.width), h = Math.round(vp.height);
          const c = new OffscreenCanvas(w, h), x = c.getContext("2d", { willReadFrequently: true });
          x.fillStyle = "#fff"; x.fillRect(0, 0, w, h);
          await pg.render({ canvasContext: x, canvas: c, viewport: vp }).promise;
          const d = x.getImageData(0, 0, w, h).data, gray = new Uint8Array(w * h);
          for (let i = 0, q = 0; i < gray.length; i++, q += 4) gray[i] = d[q] * 299 + d[q + 1] * 587 + d[q + 2] * 114 < 200000 ? 0 : 255;
          const st = findStaves(gray, w, h), sys = new Map();
          for (const m of L.measures.filter((m) => m.page === k)) { const g = sys.get(m.sys) || { y0: m.y0, x0: m.x0, x1: 0 }; g.x1 = Math.max(g.x1, m.x1); sys.set(m.sys, g); }
          for (const [si, g] of sys) {
            if (g.x1 - g.x0 < 0.5 || !st.length) continue;
            const s = st.reduce((a, s) => (Math.abs(s.y[0] - g.y0 * h) < Math.abs(a.y[0] - g.y0 * h) ? s : a));
            dy = Math.max(dy, 2 * Math.abs(s.y[0] - g.y0 * h));
            if (k || si) dx = Math.max(dx, 2 * Math.abs(s.x1 - g.x1 * w));
            n++;
          }
        }
        return { dy, dx, n, own: L.pages.slice(1).every((p) => Math.abs(p.w / L.sheetW - 1500 / 1417) < 0.01) };
      }, { xml: fs.readFileSync(PM_XML, "utf8"), pdf: fs.readFileSync(PM_PDF).toString("base64") });
      ok(fit.own && fit.n >= 40 && fit.dy <= 24 && fit.dx <= 10, `M Piano Man (sheet 1 at another interline): each page's own size (${fit.own}), ${fit.n} systems' top lines within ${fit.dy.toFixed(0)} px and right ends within ${fit.dx.toFixed(0)} px of the staves on the PDF`);
    }
    await ctx.close();
  }
  const ids = JSON.parse(fs.readFileSync(path.join(SCRATCH, "v88/ids.json"), "utf8"));

  // ===== O, T, R, F: desktop ============================================================================
  if (run("O") || run("T") || run("R") || run("F")) {
    const { ctx, page } = await newPage(browser, 1280, 800, false, errors);
    // (the library is per context: seed again)
    const id = (await seed(page, [{ name: "GS3", xml: GS3_XML, pdf: GS3_PDF }])).GS3;
    await openSong(page, id);
    // a stretch: the 5th and 6th bars (system 2 of sheet 1) — dragged on the score
    const pick = await page.evaluate(() => {
      const ms = [...document.querySelectorAll("#stage .page g.measure")];
      const box = (id) => { const g = ms.find((x) => x.id === id); const st = g.querySelector("g.staff"); const r = st.getBoundingClientRect(); return r; };
      const a = box("m4"), b = box("m5");
      return a && b ? [a.left + 12, a.top + a.height / 2, b.right - 12, b.top + b.height / 2] : null;
    });
    ok(!!pick, "O bars 5–6 on the score's first page");
    await page.mouse.move(pick[0], pick[1]);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(pick[0] + ((pick[2] - pick[0]) * i) / 8, pick[1] + ((pick[3] - pick[1]) * i) / 8); await sleep(20); }
    await page.mouse.up();
    await sleep(200);
    const f0 = await page.evaluate(() => window.resonatePlay.focus());
    ok(f0.selection && f0.measures.join() === "m4,m5" && f0.numbers.join() === "5,6", `O the stretch picked: ${f0.measures} (bars ${f0.numbers}), focus() without the PDF open has its place: page ${f0.pdf?.page}`);
    let p = await pdfOn(page);
    const wr = await wrapRect(page);
    const rr = p.focus?.rects || [];
    const g2 = grid(1).systems[1], xs = bars(1, 2);
    ok(p.fit.list.includes(2) && rr.length === 1 && rr[0].page === 2, `O 📄 opens on PDF page 2 (shown: ${p.fit.list}${p.spread ? ", a spread" : ""}), ${rr.length} rect`);
    if (rr[0]) {
      // the rect: the system's staff lines ± 1.5 interlines (19 px), its 1st bar's barlines ± 0.75 interline
      const e = [rr[0].x0 * GW - (xs[0] - 14), rr[0].x1 * GW - (xs[2] + 14), rr[0].y0 * GH - (g2.box[1] - 28.5), rr[0].y1 * GH - (g2.box[3] + 28.5)];
      ok(e.every((v) => Math.abs(v) <= 16), `O the rect on the engine's system 2, bars 1–2 (off by ${e.map((v) => v.toFixed(1)).join(", ")} px of 2550)`);
    }
    ok(p.z > 1.5 && p.z <= 4.01, `O zoomed onto it (×${p.z.toFixed(2)})`);
    const pb = p.fit?.boxes.find((b) => b.p === rr[0]?.page);
    const box = pb ? { x: wr[0] + p.tx + (pb.x + rr[0].x0 * pb.w) * p.z, y: wr[1] + p.ty + rr[0].y0 * pb.h * p.z, w: (rr[0].x1 - rr[0].x0) * pb.w * p.z, h: (rr[0].y1 - rr[0].y0) * pb.h * p.z } : null;
    const b0 = p.borders[0];
    ok(b0 && box && Math.abs(b0[0] - (box.x - 5)) < 1.5 && Math.abs(b0[1] - (box.y - 5)) < 1.5 && Math.abs(b0[2] - (box.w + 10)) < 1.5 && Math.abs(b0[3] - (box.h + 10)) < 1.5, `O its border just outside it on screen (${b0?.map(Math.round)})`);
    ok(b0 && b0[0] >= wr[0] - 1 && b0[1] >= wr[1] - 1 && b0[0] + b0[2] <= wr[0] + wr[2] + 1 && b0[1] + b0[3] <= wr[1] + wr[3] + 1, "O the focus whole in the view");
    const bw = await page.evaluate(() => getComputedStyle(document.querySelector("#pdfwrap .pdffocus")).borderTopWidth);
    ok(bw === "3px", `O the border 3 px (${bw})`);
    ok(p.bar?.focus && p.bar.again, "O the PDF's controls: − + ⌖ ⟳");
    await page.screenshot({ path: path.join(SHOTS, "o-stretch.png") });
    // the bar no taller with the PDF view on
    const barH = await page.evaluate(() => document.getElementById("bar").getBoundingClientRect().height);
    // ⌖ after a pan
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 300);
    await sleep(300);
    const panned = (await D(page)).pdf;
    ok(Math.abs(panned.ty - p.ty) > 50, `O the wheel pans (ty ${p.ty.toFixed(0)} → ${panned.ty.toFixed(0)})`);
    await page.click("#pdf-focus");
    p = await settled(page, 500);
    ok(Math.abs(p.ty - panned.ty) > 50 && p.borders[0][1] >= wr[1] - 1 && p.borders[0][1] + p.borders[0][3] <= wr[1] + wr[3] + 1, "O ⌖ comes back to the stretch");

    if (run("Z")) {
      // ctrl + wheel at a point: zooms there
      const z0 = p.z, at = [wr[0] + wr[2] * 0.3, wr[1] + wr[3] * 0.6];
      const s0 = sheetAt(p, wr, ...at);
      await page.mouse.move(...at);
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, -100);
      await page.keyboard.up("Control");
      p = await settled(page, 300);
      const s1 = sheetAt(p, wr, ...at);
      ok(p.z > z0 * 1.2 && Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) < 1, `Z ctrl + wheel zooms at the pointer (×${z0.toFixed(2)} → ×${p.z.toFixed(2)}, the point moved ${Math.hypot(s1[0] - s0[0], s1[1] - s0[1]).toFixed(2)} px)`);
    }

    if (run("T")) {
      const zk = (await D(page)).pdf.z;
      await page.click("#next");
      await pdfReady(page, "p.page === 3");
      p = await settled(page);
      ok(p.page === 3 && Math.abs(p.z - zk) < 0.01 && p.ty === 0 && !p.borders.length, `T › while zoomed: page 3${p.spread ? " (a spread: 3–4)" : ""}, ×${p.z.toFixed(2)} kept, from its top, no border there`);
      await page.evaluate(() => window.__key("ArrowLeft"));
      await pdfReady(page, "p.fit.list.includes(2)");
      p = await settled(page);
      ok(p.fit.list.includes(2) && p.borders.length === 1, `T ArrowLeft: back to page 2, its border (×${p.z.toFixed(2)})`);
      const n0 = (await D(page)).peeks;
      await page.mouse.click(wr[0] + wr[2] / 2, wr[1] + wr[3] / 2);
      await sleep(300);
      ok((await D(page)).peeks === n0 && (await page.isDisabled("#play")), "T a click on the PDF sounds nothing; ▶ off");
      ok(Math.abs(barH - (await page.evaluate(() => document.getElementById("bar").getBoundingClientRect().height))) < 0.5, `T the bar's height unchanged (${barH})`);
    }

    if (run("F")) {
      const f = await page.evaluate(() => window.resonatePlay.focus());
      ok(f.song === id && f.view && f.selection?.from === "m4" && f.selection.to === "m5" && f.pdf?.page === 2 && f.pdf.rects.length === 1, `F focus(): ${JSON.stringify({ view: f.view, measures: f.measures, selection: f.selection, page: f.pdf?.page })}`);
      const crop = await page.evaluate(async () => {
        const b = await window.resonatePlay.pdfCrop({ maxW: 800 });
        if (!b) return null;
        const bm = await createImageBitmap(b), c = new OffscreenCanvas(bm.width, bm.height), x = c.getContext("2d");
        x.drawImage(bm, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data;
        let red = 0, ink = 0;
        for (let i = 0; i < d.length; i += 4) { if (d[i] > 200 && d[i + 1] < 90 && d[i + 2] < 90) red++; else if (d[i] < 100 && d[i + 1] < 100) ink++; }
        return { type: b.type, w: bm.width, h: bm.height, red, ink };
      });
      ok(crop && crop.type === "image/png" && crop.w <= 800 && crop.w > 400 && crop.red > 500 && crop.ink > 500, `F pdfCrop(): ${JSON.stringify(crop)}`);
      // the whole song picked (PDF pages 2–4): the picture holds the first two pages, ≤ 8 M px and
      // ≤ 6000 px tall, and says so (review: every page stacked at 1600 px wide — Killing's six
      // pages ~19 M px, over iOS Safari's 16.7 M px canvas limit — and the picture lost)
      const long = await page.evaluate(async () => {
        const st = window.resonatePlay.scoreState();
        await window.resonatePlay.scoreRun("score_select", { from_measure: 1, to_measure: st.bars });
        const info = {};
        const b = await window.resonatePlay.pdfCrop({ maxW: 1600, info });
        const bm = b && await createImageBitmap(b);
        const fd = await window.resonatePlay.focusData();
        return { bars: st.bars, w: bm?.width, h: bm?.height, info, picture: fd?.data?.pdf?.picture ?? null };
      });
      ok(long.w && long.w * long.h <= 8e6 && long.h <= 6000 && long.info.pages?.join() === "2,3" && long.info.all?.join() === "2,3,4" && /pages 2–3 of the highlight's 2–4/.test(long.picture?.note || ""),
        `F a stretch over 3 PDF pages (bars 1–${long.bars}): the picture ${long.w}×${long.h} (${((long.w * long.h) / 1e6).toFixed(1)} M px, ×${long.info.scale}) of pages ${long.info.pages} of ${long.info.all}; "${long.picture?.note}"`);
      await page.evaluate(() => window.resonatePlay.scoreRun("score_select", { from_measure: 5, to_measure: 6 })); // (as before: bars 5–6)
    }

    if (run("R")) {
      await page.route("**/pdf-import.html*", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>stub</title>" }));
      let asked = null;
      page.once("dialog", (d) => { asked = d.message(); d.dismiss(); });
      await page.click("#pdf-again");
      await sleep(300);
      ok(/Reprocess the PDF\?/.test(asked || "") && /play\.html/.test(page.url()), `R ⟳ asks first; Cancel stays (${asked})`);
      await page.evaluate(() => { window.__re = []; window.resonatePlay.reprocess = (id) => window.__re.push(id); });
      let asked2 = null;
      page.once("dialog", (d) => { asked2 = d.message(); d.accept(); });
      await page.click("#pdf-again");
      await sleep(200);
      ok((await page.evaluate(() => window.__re)).join() === id && /play\.html/.test(page.url()) && /Reprocess the PDF\?/.test(asked2 || ""), "R resonatePlay.reprocess (the shell's) called with the song after the same question");
      await page.evaluate(() => { delete window.resonatePlay.reprocess; });
      page.once("dialog", (d) => d.accept());
      await Promise.all([page.waitForURL(/pdf-import\.html\?reprocess=/, { timeout: 5000 }).catch(() => {}), page.click("#pdf-again")]);
      ok(page.url().endsWith("pdf-import.html?reprocess=" + encodeURIComponent(id)), `R OK → ${page.url().replace(BASE, "")}`);
    }
    await ctx.close();
  }

  // ===== Z: iPad, touch ====================================================================================
  if (run("Z")) {
    const { ctx, page } = await newPage(browser, 820, 1180, true, errors);
    const id = (await seed(page, [{ name: "GS3", xml: GS3_XML, pdf: GS3_PDF }])).GS3;
    await openSong(page, id);
    const shown = await page.evaluate(() => [...new Set([...document.querySelectorAll("#stage .page g.measure")].map((g) => g.id))]);
    let p = await pdfOn(page);
    const wr = await wrapRect(page);
    const f = await page.evaluate(() => window.resonatePlay.focus());
    ok(!f.selection && f.measures.join() === shown.join() && p.borders.length === p.focus.rects.filter((r) => p.fit.list.includes(r.page)).length && p.borders.length >= 2, `Z no stretch: the score page's ${shown.length} bars, ${p.borders.length} borders on PDF page ${p.page}`);
    // each border on one of the engine's systems
    const sysOk = p.focus.rects.filter((r) => r.page === p.page).every((r) => grid(p.page - 1).systems.some((sy) => Math.abs(r.y0 * GH - (sy.box[1] - 28.5)) < 16 && Math.abs(r.y1 * GH - (sy.box[3] + 28.5)) < 16));
    ok(sysOk, "Z every rect on one of the engine's systems");
    await page.screenshot({ path: path.join(SHOTS, "z-open.png") });
    // fitted first (double tap toggles)
    const c = [wr[0] + wr[2] / 2, wr[1] + wr[3] / 2];
    await tap(ctx, page, ...c); await sleep(80); await tap(ctx, page, ...c);
    p = await settled(page, 500);
    const z1 = p.z;
    await tap(ctx, page, ...c); await sleep(80); await tap(ctx, page, ...c);
    p = await settled(page, 500);
    ok((z1 > 1.02 ? Math.abs(p.z - 1) < 0.01 : Math.abs(p.z - 2.5) < 0.01) || (z1 <= 1.02 && Math.abs(p.z - 2.5) < 0.01), `Z double tap: ×${z1.toFixed(2)} → ×${p.z.toFixed(2)}`);
    if (p.z > 1.02) { await tap(ctx, page, ...c); await sleep(80); await tap(ctx, page, ...c); p = await settled(page, 500); }
    ok(Math.abs(p.z - 1) < 0.01 && !p.detail, `Z fitted: ×${p.z.toFixed(2)}, no sharp copy needed`);
    // a pinch about a point: ×2
    const m = [wr[0] + wr[2] * 0.4, wr[1] + wr[3] * 0.35], s0 = sheetAt(p, wr, ...m);
    const frames = [];
    for (let i = 0; i <= 10; i++) { const d = 60 + (60 * i) / 10; frames.push([[m[0] - d, m[1]], [m[0] + d, m[1]]]); }
    frames.push([]);
    await touches(ctx, page, frames);
    p = await settled(page, 900);
    const s1 = sheetAt(p, wr, ...m);
    ok(Math.abs(p.z - 2) < 0.05 && Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) < 2, `Z a pinch ×2 about its middle (×${p.z.toFixed(2)}, the point moved ${Math.hypot(s1[0] - s0[0], s1[1] - s0[1]).toFixed(2)} px)`);
    ok(p.detail && Math.abs(p.detail.z - p.z) < 0.01 && p.detail.k >= p.z * 0.99 && p.detail.k > p.canvas[0] / p.fit.bw * 1.5, `Z drawn again sharp: ${p.detail?.w}×${p.detail?.h} px for ${(p.detail?.x1 - p.detail?.x0).toFixed(0)}×${(p.detail?.y1 - p.detail?.y0).toFixed(0)} sheet px (${p.detail?.k.toFixed(2)} a px; the base ${(p.canvas[0] / p.fit.bw).toFixed(2)})`);
    const reg = await register(page);
    ok(reg && Math.abs(reg.dx) <= 1 && Math.abs(reg.dy) <= 1, `Z the sharp copy in register with the page (best match at ${reg?.dx}, ${reg?.dy} px)`);
    // a finger pans
    const t0 = [p.tx, p.ty];
    await touches(ctx, page, [[[c[0], c[1]]], ...Array.from({ length: 8 }, (_, i) => [[c[0] - 15 * (i + 1), c[1] - 20 * (i + 1)]]), []]);
    p = await settled(page, 400);
    ok(Math.abs(p.tx - t0[0] + 120) < 3 && Math.abs(p.ty - t0[1] + 160) < 3, `Z a finger pans (${(p.tx - t0[0]).toFixed(0)}, ${(p.ty - t0[1]).toFixed(0)})`);
    // − / +
    const zb = p.z;
    await page.click("#pdf-in"); p = await settled(page, 500);
    const zi = p.z;
    await page.click("#pdf-out"); p = await settled(page, 500);
    ok(Math.abs(zi / zb - 1.5) < 0.02 && Math.abs(p.z - zb) < 0.02, `Z + then −: ×${zb.toFixed(2)} → ×${zi.toFixed(2)} → ×${p.z.toFixed(2)}`);
    const rb = await page.evaluate(() => [...document.querySelectorAll("#pdfbar button:not([hidden])")].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
    ok(rb.length === 4 && rb.every(([w, h]) => w >= 44 && h >= 44), `Z the PDF's buttons ≥ 44 px (${JSON.stringify(rb)})`);
    // a turn keeps the zoom; a tap sounds nothing
    const n0 = (await D(page)).peeks;
    await tap(ctx, page, c[0] + 100, c[1]);
    await page.click("#next");
    await pdfReady(page, "p.page === 3");
    p = await settled(page);
    ok(p.page === 3 && Math.abs(p.z - zb) < 0.02 && (await D(page)).peeks === n0, `T a turn on the iPad: page 3 at ×${p.z.toFixed(2)}; the tap sounded nothing`);
    // rotation: the zoom and the place kept
    await page.setViewportSize({ width: 1180, height: 820 });
    await pdfReady(page, "p.fit && Math.abs(p.fit.bh - window.resonateDebug().play.pdf.fit.bh) < 1");
    p = await settled(page, 900);
    ok(p.on && Math.abs(p.z - zb) < 0.02 && p.fit.bh < 800, `Z rotated: still ×${p.z.toFixed(2)} on the refitted page (${Math.round(p.fit.bw)}×${Math.round(p.fit.bh)}${p.spread ? ", a spread" : ""})`);
    await page.screenshot({ path: path.join(SHOTS, "z-rotated.png") });
    await ctx.close();
  }

  // ===== S: the one-page shell ===============================================================================
  if (run("S")) {
    const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    await ctx.addInitScript(INIT);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push("shell pageerror " + e.message));
    await page.goto(BASE + "play.html");
    await ready(page);
    const id = (await seed(page, [{ name: "GS3", xml: GS3_XML, pdf: GS3_PDF }])).GS3;
    await page.goto(BASE + "shell.html");
    await page.waitForFunction(() => window.resonateDebug?.().tuner, null, { timeout: 30000 });
    await page.click("#songs-btn");
    await page.waitForSelector(`#songs-body .song[data-id="${id}"]`, { timeout: 8000 });
    await page.click(`#songs-body .song[data-id="${id}"]`);
    await page.waitForFunction(() => window.resonatePlay?.state?.().ready, null, { timeout: 60000 });
    await page.waitForSelector("#score-region #pdf:not([hidden])", { timeout: 10000 });
    await sleep(800);
    await page.click("#score-region #pdf");
    await page.waitForFunction(() => document.querySelector("#score-region #pdfwrap .pdffocus") && !document.querySelector("#score-region #pdfbar").hidden, null, { timeout: 30000 });
    await sleep(700);
    const r = await page.evaluate(async () => {
      const w = document.querySelector("#score-region #pdfwrap").getBoundingClientRect(), b = document.querySelector("#score-region #pdfwrap .pdffocus").getBoundingClientRect();
      const tr = document.querySelector("#score-region #pdfwrap .pdfsheet").style.transform;
      const f = await window.resonatePlay.focus();
      return { w: [w.width, w.height], b: [b.left - w.left, b.top - w.top, b.width, b.height], tr, page: f?.pdf?.page, bars: f?.measures?.length, again: !document.getElementById("pdf-again").hidden };
    });
    ok(r.page === 2 && r.bars > 0 && r.w[0] > 300 && r.b[2] > 100 && r.again && /scale\(/.test(r.tr), `S the shell's Score: 📄 opens the same view (${JSON.stringify(r)})`);
    await page.screenshot({ path: path.join(SHOTS, "s-shell.png") });
    await ctx.close();
  }

  // ===== K: the owner's song, looked at ===========================================================================
  if (run("K") && HAVE_K) {
    const { ctx, page } = await newPage(browser, 820, 1180, false, errors);
    const id = (await seed(page, [{ name: "Killing", xml: fs.readFileSync(K_XML, "utf8"), pdf: fs.readFileSync(K_PDF) }])).Killing;
    await openSong(page, id);
    for (let i = 0; i < 2; i++) await page.click("#next");
    await sleep(400);
    // a stretch: the 2nd bar of the page's second line to the 1st of its third
    const pick = await page.evaluate(() => {
      const sys = [...document.querySelectorAll("#stage .page g.system")];
      const ms = (s) => [...s.querySelectorAll("g.measure")].map((g) => g.querySelector("g.staff").getBoundingClientRect());
      const a = ms(sys[1])[1], b = ms(sys[2])[0];
      return [a.left + 10, a.top + a.height / 2, b.right - 10, b.top + b.height / 2];
    });
    await page.mouse.move(pick[0], pick[1]); await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(pick[0] + ((pick[2] - pick[0]) * i) / 10, pick[1] + ((pick[3] - pick[1]) * i) / 10); await sleep(20); }
    await page.mouse.up();
    await sleep(300);
    const f = await page.evaluate(() => window.resonatePlay.focus());
    await page.screenshot({ path: path.join(SHOTS, "k-stretch-score.png") });
    const p = await pdfOn(page);
    ok(p.focus?.rects.length >= 1 && p.borders.length >= 1 && p.z > 1, `K a stretch over two lines (bars ${f.numbers}): ${p.focus?.rects.length} rects on PDF page ${p.page}, ×${p.z.toFixed(2)}`);
    await page.screenshot({ path: path.join(SHOTS, "k-stretch-pdf.png") });
    await ctx.close();
  }

  await browser.close();
  const errs = errors.filter((e) => !/Insufficient space to draw mixed beam/.test(e));
  ok(!errs.length, `no page errors (${errs.slice(0, 5).join(" | ")})`);
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
