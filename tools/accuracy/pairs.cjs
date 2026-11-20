// Engine-accuracy review: a converted song's systems, one by one, as Resonate draws them (Play,
// the Full score view when offered, else Both; note names and chord names off) next to the same
// bars on the original PDF. Each system of the PDF (as the MusicXML Audiveris exported says: a
// system starts at bar 1 and at every <print new-system|new-page>) gives
//
//   s<NN>-score.png   Play's drawing of those bars (play.js scoreCrop: the selection's bands, ≥ 1400 px wide
//                     where the bars allow), stacked when the bars wrap onto two of Play's systems / pages
//   s<NN>-pdf.png     the same bars on the PDF (play.js pdfCrop, the system's rect from pdfmap.js —
//                     readLayout / matchMeasures / focusRects — with the red border, at the PDF's 300 dpi)
//   s<NN>-notes.txt   the bars' notes as text (play.js focusData → scoretext.js barsText)
//   legend.txt        how the notes text reads (scoretext.js TEXT_LEGEND)
//   run.json          the run: view, Play's size, bars matched, systems written / missing
//   index.json        [{ sys, from, to, pdfPage, score, pdf, notes, … }] (from/to: bar numbers as written
//                     in the MusicXML; play: Play's bars; check: Play's own focus vs the system)
//
// The song goes into a fresh browser profile's library the way PDF → Song stores one: the RAW
// MusicXML from the .mxl (so pdfmap's layout reads Audiveris's own export; catalog.js cleans it on
// load as the site does), the PDF, and `pages` (the PDF page of each music sheet) so the map is the
// song's own record. Nothing is written but the outdir. The outputs carry the score's text (lyrics):
// keep them outside the repo.
//
// usage: node pairs.cjs <slug> [mxl] [outdir]
//   mxl     default $ACC/v10/<slug>/<slug>.mxl
//   outdir  default $ACC/pairs/<slug>/
//   env: ACC (the accuracy run's folder), PDF (default /home/user/sitetest/<slug>.pdf),
//        PAGES (default $ACC/tif/<slug>.pages.txt: "page N: WxH, staves K" lines — pages with staves 0
//        are left out; missing → Play finds the music pages itself), BASE (the site,
//        http://localhost:8097/resonate/), VIEW (score | both | rh | lh | melody: instead of the
//        default), W / H / DPR (the window: 1600 × 1200, 2), SCORE_W (the score picture's width at most,
//        2400), PDF_W (the PDF picture's, 3000 — 300 dpi caps it), ONLY (systems, e.g. "3,7-9"),
//        CHORDS=1 (keep Resonate's chord names), TEXT=0 (no notes text: skips focusData's pictures)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const ACC = process.env.ACC || "/tmp/claude-0/-home-user-resonate/ff8222dc-0c50-507b-b424-c024937f0d1b/scratchpad/acc";
const BASE = (process.env.BASE || "http://localhost:8097/resonate/").replace(/\/?$/, "/");
const [slug, mxlArg, outArg] = process.argv.slice(2);
if (!slug || /^-/.test(slug)) {
  console.error("usage: node pairs.cjs <slug> [mxl] [outdir]");
  process.exit(2);
}
const MXL = mxlArg || path.join(ACC, "v10", slug, slug + ".mxl");
const OUT = outArg || path.join(ACC, "pairs", slug);
const PDF = process.env.PDF || `/home/user/sitetest/${slug}.pdf`;
const PAGES = process.env.PAGES || path.join(ACC, "tif", slug + ".pages.txt");
const W = Number(process.env.W) || 1600, H = Number(process.env.H) || 1200, DPR = Number(process.env.DPR) || 2;
const SCORE_W = Number(process.env.SCORE_W) || 2400, PDF_W = Number(process.env.PDF_W) || 3000;
const WANT_VIEW = process.env.VIEW || null;
const TEXT = process.env.TEXT !== "0";
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",").flatMap((r) => {
  const [a, b] = r.split("-").map(Number);
  return Array.from({ length: (b || a) - a + 1 }, (_, i) => a + i);
})) : null;
const sleep = (t) => new Promise((r) => setTimeout(r, t));
const log = (...a) => console.log(`[${slug}]`, ...a);

for (const [what, f] of [["mxl", MXL], ["pdf", PDF]]) {
  if (!fs.existsSync(f)) {
    const dir = path.dirname(f);
    const mvts = what === "mxl" && fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /\.mvt\d+\.mxl$/.test(n)) : [];
    console.error(`[${slug}] no ${what}: ${f}${mvts.length ? ` (movements there: ${mvts.join(", ")} — join them first)` : ""}`);
    process.exit(1);
  }
}
// The PDF pages with music, in sheet order (pages.txt from the run's page prep).
let pages = null;
if (fs.existsSync(PAGES)) {
  pages = fs.readFileSync(PAGES, "utf8").split("\n")
    .map((l) => /^page (\d+):.*staves (\d+)/.exec(l)).filter((m) => m && Number(m[2]) > 0).map((m) => Number(m[1]));
  if (!pages.length) pages = null;
}

// The PNG's size, from its header.
const pngSize = (buf) => (buf && buf.length > 24 && buf.toString("ascii", 1, 4) === "PNG" ? [buf.readUInt32BE(16), buf.readUInt32BE(20)] : null);
const b64 = (s) => (s ? Buffer.from(s.replace(/^data:[^,]*,/, ""), "base64") : null);

function INIT({ chords }) {
  try { if (!navigator.audioSession) Object.defineProperty(navigator, "audioSession", { configurable: true, value: { type: "auto" } }); } catch {}
  try {
    // (device prefs, before the page reads them: no note names on new songs, no keyboard under the
    // music — the page's height for it — and, unless asked, no chord names under the piano)
    localStorage.setItem("resonate.play.names", "off");
    localStorage.setItem("resonate.play.keys", "off");
    if (!chords) localStorage.setItem("resonate.play.chords", "off");
  } catch {}
}

async function openPlay(browser) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
  await ctx.addInitScript(INIT, { chords: process.env.CHORDS === "1" });
  // (the inputs, served from disk at addresses of the site's own origin)
  await ctx.route(BASE + "__acc/score.mxl", (r) => r.fulfill({ path: MXL, contentType: "application/octet-stream" }));
  await ctx.route(BASE + "__acc/score.pdf", (r) => r.fulfill({ path: PDF, contentType: "application/pdf" }));
  try { return await openSong(ctx); } catch (err) { await ctx.close().catch(() => {}); throw err; }
}
async function openSong(ctx) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console.error " + m.text().slice(0, 300)); });
  await page.goto(BASE + "play.html");
  await page.waitForFunction(() => window.resonateDebug?.().play?.ready, null, { timeout: 90000 });
  // the song: raw MusicXML (readScoreFile — the site's own .mxl reader), its PDF, its pages
  const id = await page.evaluate(async ({ slug, pages }) => {
    const v = document.getElementById("version").textContent.trim().replace(/^v/, "");
    const L = await import(`./library.js?v=${v}`), M = await import(`./musicxml.js?v=${v}`);
    const mxl = await (await fetch("__acc/score.mxl")).blob();
    const xml = await M.readScoreFile(new File([mxl], slug + ".mxl"));
    const pdf = await (await fetch("__acc/score.pdf")).arrayBuffer();
    const id = await L.addSong("acc " + slug, xml, { source: "pdf", pdf, pdfName: slug + ".pdf", ...(pages ? { pages } : {}) });
    localStorage.setItem("resonate.sing.song", id);
    return id;
  }, { slug, pages });
  await page.reload();
  await page.waitForFunction((id) => { const d = window.resonateDebug?.().play; return d && d.ready && d.song === id && d.pdf.has; }, id, { timeout: 120000 });
  const d = await page.evaluate(() => { const p = window.resonateDebug().play; return { view: p.view, views: p.views, names: p.names, sp: p.sp, pages: p.pages, mode: p.mode }; });
  const view = WANT_VIEW || (d.views.includes("score") ? "score" : "both");
  if (!d.views.includes(view)) throw new Error(`no ${view} view (views: ${d.views.join(", ")})`);
  if (d.view !== view) {
    const r = await page.evaluate((view) => window.resonatePlay.scoreRun("score_view", { view }), view);
    if (!r.ok) throw new Error("score_view: " + r.error);
  }
  if (d.names !== "off") throw new Error("note names are " + d.names);
  return { ctx, page, id, errors, views: d.views, view };
}

// The PDF's systems (the stored, raw MusicXML's layout) and Play's bars in each.
const planSystems = (page, id) => page.evaluate(async (id) => {
  const v = document.getElementById("version").textContent.trim().replace(/^v/, "");
  const L = await import(`./library.js?v=${v}`), P = await import(`./pdfmap.js?v=${v}`), C = await import(`./catalog.js?v=${v}`);
  const raw = (await L.getSong(id)).xml, rec = await L.getPages(id);
  const layout = P.readLayout(raw);
  // Play's bars: the song as catalog.js gives it (cleaned), its first part's measures
  const song = await C.loadSong(id);
  const doc = new DOMParser().parseFromString(song.xml, "application/xml");
  const first = [...doc.documentElement.children].find((c) => c.nodeName === "part");
  const nums = [...first.children].filter((c) => c.nodeName === "measure").map((m, i) => m.getAttribute("number") || String(i + 1));
  const state = window.resonatePlay.scoreState();
  // (no layout — not an Audiveris export: the raw bars by their prints, no PDF rects)
  const rawDoc = new DOMParser().parseFromString(raw, "application/xml");
  const rawFirst = [...rawDoc.documentElement.children].find((c) => c.nodeName === "part");
  const rawBars = [...rawFirst.children].filter((c) => c.nodeName === "measure");
  const measures = layout ? layout.measures : (() => {
    let sys = -1, pg = 0;
    return rawBars.map((m, i) => {
      const pr = [...m.children].find((c) => c.nodeName === "print");
      if (pr?.getAttribute("new-page") === "yes" && i) pg++;
      if (!i || pr?.getAttribute("new-page") === "yes" || pr?.getAttribute("new-system") === "yes") sys++;
      return { n: m.getAttribute("number") || String(i + 1), page: pg, sys };
    });
  })();
  const idx = layout ? P.matchMeasures(layout, nums) : nums.map((n) => measures.findIndex((m) => m.n === n));
  const pdfPages = layout ? P.sheetPages(layout, { pages: rec }) : [];
  const systems = [];
  for (let j = 0; j < measures.length; j++) {
    const m = measures[j], last = systems[systems.length - 1];
    if (last && last.page === m.page && last.s === m.sys) { last.j1 = j; continue; }
    systems.push({ page: m.page, s: m.sys, j0: j, j1: j });
  }
  return {
    layout: !!layout, how: rec ? "record" : "none", sheets: layout?.sheets ?? null, pdfPages, bars: nums.length, barsState: state?.bars ?? null,
    matched: idx.filter((j) => j >= 0).length, raw: measures.length,
    systems: systems.map((s, k) => {
      const play = [];
      idx.forEach((j, mi) => { if (j >= s.j0 && j <= s.j1) play.push(mi); });
      const js = Array.from({ length: s.j1 - s.j0 + 1 }, (_, i) => s.j0 + i);
      const rects = layout ? P.focusRects(layout, js, pdfPages, 1.5) : [];
      return {
        sys: k + 1, sheetPage: s.page + 1, sheet: layout?.sheets?.[s.page] ?? null, from: measures[s.j0].n, to: measures[s.j1].n,
        raw: [s.j0, s.j1], play, playNumbers: play.map((mi) => nums[mi]), pdfPage: rects[0]?.page ?? pdfPages[s.page] ?? null, rects,
      };
    }),
  };
}, id);

// Select Play's bars [mi0, mi1] as score_select does, and wait for the bands.
async function select(page, mi0, mi1) {
  const r = await page.evaluate(([a, b]) => window.resonatePlay.scoreRun("score_select", { from_measure: "m" + a, to_measure: "m" + b }), [mi0, mi1]);
  if (!r.ok) return r;
  await page.waitForFunction(() => document.querySelectorAll("#stage .page > .sel").length > 0, null, { timeout: 10000 });
  await sleep(60);
  return r;
}
// The selection as drawn: every page of Play holding some of its bars (turned to in turn), stacked.
const scorePicture = (page, bars) => page.evaluate(async ({ bars, maxW }) => {
  const nap = (t) => new Promise((r) => setTimeout(r, t));
  const shown = () => new Set([...document.querySelectorAll("#stage .page g.measure")].map((g) => /^m(\d+)$/.exec(g.id)).filter(Boolean).map((m) => Number(m[1])));
  const blobs = [], turns = [];
  const done = new Set();
  let bands = 0;
  for (let guard = 0; guard < 6; guard++) {
    const on = shown();
    const here = bars.filter((mi) => on.has(mi) && !done.has(mi));
    if (here.length && document.querySelector("#stage .page > .sel")) {
      const b = await window.resonatePlay.scoreCrop({ maxW });
      if (b) { blobs.push(b); bands += document.querySelectorAll("#stage .page > .sel").length; }
      for (const mi of here) done.add(mi);
    }
    const rest = bars.filter((mi) => !done.has(mi));
    if (!rest.length) break;
    // (the stretch goes on on another of Play's pages: turn there — the selection stays)
    const r = await window.resonatePlay.scoreRun("score_go", { measure: "m" + rest[0] });
    turns.push(rest[0]);
    if (!r.ok) break;
    await nap(80);
    if (!shown().has(rest[0])) break;
  }
  const missing = bars.filter((mi) => !done.has(mi));
  if (!blobs.length) return { png: null, turns, missing, bands };
  let out = blobs[0];
  if (blobs.length > 1) {
    const bmps = await Promise.all(blobs.map((b) => createImageBitmap(b)));
    const gap = 24, c = document.createElement("canvas");
    c.width = Math.max(...bmps.map((b) => b.width));
    c.height = bmps.reduce((a, b) => a + b.height, 0) + gap * (bmps.length - 1);
    const x = c.getContext("2d");
    x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
    let y = 0;
    for (const b of bmps) { x.drawImage(b, 0, y); y += b.height + gap; b.close(); }
    out = await new Promise((r) => c.toBlob(r, "image/png"));
    c.width = c.height = 0;
  }
  const png = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(out); });
  return { png, turns, missing, pieces: blobs.length, bands };
}, { bars, maxW: SCORE_W });

const pdfPicture = (page, rects) => page.evaluate(async ({ rects, maxW }) => {
  const info = {};
  const b = await window.resonatePlay.pdfCrop({ maxW, info, focus: { pdf: { page: rects[0].page, rects } } });
  if (!b) return null;
  const png = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
  return { png, info };
}, { rects, maxW: PDF_W });

// Play's own focus (resonatePlay.focus: the stretch's bars and their rects on the PDF) and the
// notes as text (focusData; its own pictures are left).
const playFocus = (page, text) => page.evaluate(async (text) => {
  const f = await window.resonatePlay.focus();
  let notes = null;
  if (text) { const d = await window.resonatePlay.focusData(); notes = d?.data ? { text: d.data.text, legend: d.data.legend, measures: d.data.measures } : null; }
  return { numbers: f?.numbers ?? null, measures: f?.measures ?? null, pdf: f?.pdf ?? null, notes };
}, text);

const close = (a, b, t = 0.004) => Math.abs(a - b) <= t;
const sameRects = (a, b) => a.length === b.length && a.every((r, i) => r.page === b[i].page && close(r.x0, b[i].x0) && close(r.x1, b[i].x1) && close(r.y0, b[i].y0) && close(r.y1, b[i].y1));

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  let tries = 0, opened;
  try {
    // (Play may be mid-edit by someone else: a page that doesn't come up is tried again a minute later)
    for (;;) {
      try { opened = await openPlay(browser); break; } catch (err) {
        if (++tries >= 4) throw err;
        log(`Play didn't open (${err.message.split("\n")[0]}) — again in a minute`);
        await sleep(60000);
      }
    }
    const { page, id, errors, view, views } = opened;
    const plan = await planSystems(page, id);
    const st = await page.evaluate(() => { const p = window.resonateDebug().play; return { sp: p.sp, pages: p.pages, mode: p.mode, W: p.W, H: p.H }; });
    log(`view ${view} (of ${views.join(", ")}) · Play ${st.pages} pages at ${st.sp.toFixed(2)} px a staff space · ${plan.raw} bars in the export, ${plan.bars} in Play (${plan.matched} matched) · ` +
      `${plan.systems.length} systems · PDF pages ${plan.layout ? JSON.stringify(plan.pdfPages) : "— no layout (not an Audiveris export): no PDF rects"}${pages ? "" : " (no pages list: the map's own guess)"}`);
    const index = [];
    let wrote = 0, noPdf = 0, noScore = 0, disagree = 0;
    for (const s of plan.systems) {
      if (ONLY && !ONLY.has(s.sys)) continue;
      const NN = String(s.sys).padStart(2, "0");
      const rec = { sys: s.sys, from: s.from, to: s.to, pdfPage: s.pdfPage, sheet: s.sheet, sheetPage: s.sheetPage, score: null, pdf: null, notes: null,
        play: s.play.length ? { from: "m" + s.play[0], to: "m" + s.play[s.play.length - 1], numbers: [s.playNumbers[0], s.playNumbers[s.playNumbers.length - 1]] } : null,
        rects: s.rects, check: {}, warnings: [] };
      const say = [];
      try {
        // the score: Play's bars of this system, selected and drawn
        if (s.play.length) {
          const mi0 = Math.min(...s.play), mi1 = Math.max(...s.play);
          if (mi1 - mi0 + 1 !== s.play.length) rec.warnings.push(`Play's bars of this system aren't contiguous (${s.play.join(",")})`);
          const r = await select(page, mi0, mi1);
          if (!r.ok) rec.warnings.push("score_select: " + r.error);
          else {
            const pic = await scorePicture(page, Array.from({ length: mi1 - mi0 + 1 }, (_, i) => mi0 + i));
            if (pic.missing.length) rec.warnings.push(`bars not drawn: m${pic.missing.join(", m")}`);
            if (pic.png) {
              const buf = b64(pic.png), f = `s${NN}-score.png`;
              fs.writeFileSync(path.join(OUT, f), buf);
              rec.score = f;
              rec.scoreSize = pngSize(buf);
              rec.check.bands = pic.bands; // (Play's systems the bars are on: > 1 — the picture stacks them)
              if (pic.pieces > 1) rec.check.scorePieces = pic.pieces;
              say.push(`score ${rec.scoreSize.join("×")}${pic.bands > 1 ? ` (${pic.bands} of Play's systems${pic.pieces > 1 ? `, ${pic.pieces} pages` : ""})` : ""}`);
            }
            // Play's own focus: the same bars, the same place on the PDF?
            const f = await playFocus(page, TEXT);
            rec.check.bars = f.numbers ? [f.numbers[0], f.numbers[f.numbers.length - 1]] : null;
            rec.check.barsAgree = !!f.numbers && f.numbers[0] === s.playNumbers[0] && f.numbers[f.numbers.length - 1] === s.playNumbers[s.playNumbers.length - 1];
            rec.check.playRects = f.pdf ? f.pdf.rects.length : 0;
            rec.check.rectsAgree = !!f.pdf && sameRects(f.pdf.rects, s.rects);
            if (!rec.check.barsAgree) rec.warnings.push(`Play's focus is bars ${rec.check.bars?.join("–")}, the system ${s.playNumbers[0]}–${s.playNumbers[s.playNumbers.length - 1]}`);
            if (s.rects.length && !rec.check.rectsAgree) rec.warnings.push(`Play's focus on the PDF differs (${rec.check.playRects} rect(s))`);
            if (!rec.check.barsAgree || (s.rects.length && !rec.check.rectsAgree)) disagree++;
            if (f.notes) {
              if (!fs.existsSync(path.join(OUT, "legend.txt"))) fs.writeFileSync(path.join(OUT, "legend.txt"), f.notes.legend + "\n");
              const fn = `s${NN}-notes.txt`;
              fs.writeFileSync(path.join(OUT, fn), `${f.notes.text}\n`);
              rec.notes = fn;
            }
          }
        } else rec.warnings.push("no bar of this system in Play (left out by the clean-ups: a boxed fill?)");
        if (!rec.score) noScore++;
        // the PDF: the system's rect(s) on its page, red border
        if (s.rects.length) {
          if (s.rects.length > 1) rec.warnings.push(`${s.rects.length} rects for one system`);
          const p = await pdfPicture(page, s.rects);
          if (p?.png) {
            const buf = b64(p.png), f = `s${NN}-pdf.png`;
            fs.writeFileSync(path.join(OUT, f), buf);
            rec.pdf = f;
            rec.pdfSize = pngSize(buf);
            say.push(`pdf p${s.pdfPage} ${rec.pdfSize.join("×")}`);
          } else rec.warnings.push("pdfCrop gave nothing");
        } else rec.warnings.push("no PDF rect (no map for this system)");
        if (!rec.pdf) noPdf++;
      } catch (err) {
        rec.warnings.push("error: " + (err.message || String(err)).split("\n")[0]);
        if (!rec.score) noScore++;
        if (!rec.pdf) noPdf++;
      }
      if (rec.score || rec.pdf) wrote++;
      index.push(rec);
      log(`s${NN} bars ${s.from}–${s.to} (Play ${rec.play ? `${rec.play.from}–${rec.play.to}` : "—"}) sheet ${s.sheetPage} → ${say.join(", ") || "nothing"}${rec.warnings.length ? " · " + rec.warnings.join(" · ") : ""}`);
      fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 1));
    }
    const meta = { slug, mxl: MXL, pdf: PDF, pages, view, views, sp: st.sp, playPages: st.pages, viewport: [W, H, DPR], bars: { export: plan.raw, play: plan.bars, matched: plan.matched },
      pdfPages: plan.pdfPages, systems: plan.systems.length, wrote, noPdf, noScore, disagree, errors: errors.slice(0, 50), at: new Date().toISOString() };
    fs.writeFileSync(path.join(OUT, "run.json"), JSON.stringify(meta, null, 1));
    log(`done: ${wrote} of ${index.length} systems written · missing PDF rects/pictures ${noPdf} · missing score pictures ${noScore} · Play's focus disagreed ${disagree}` +
      `${errors.length ? ` · ${errors.length} page error(s), first: ${errors[0]}` : ""} → ${OUT}`);
    await opened.ctx.close();
    return noPdf || noScore || disagree ? 3 : 0;
  } finally {
    await browser.close();
  }
}

run().then((code) => process.exit(code), (err) => { console.error(`[${slug}] failed:`, err); process.exit(1); });
