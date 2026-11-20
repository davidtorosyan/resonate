// Play's PDF-only mode (docs/LIBRARY.md §5): a PDF-only song opens straight into its PDF, no Verovio,
// the notes' controls hidden, the keyboard under it and pressable, ‹ › / keys turn pages, ⟳ = Convert
// (no question) → resonatePlay.reprocess(id) or pdf-import.html?reprocess=id, scoreState / scoreRun,
// state() pdfOnly / shown, a missing / broken PDF says so, forget(id), then a normal song as before.
// A page that can't be drawn (v90 review): back to the last page that drew, the PDF and its bar kept,
// that page not saved — also when it's the one saved to open at —, every page failing ends failed (no
// loop); pdf.js not loaded once (offline) → the next open asks for it again (?r=1); the shell opens a
// song its Score holds failed again (its PDF come since → shown).
// Synthetic PDFs only (pdfmini.cjs); no screenshots.
//   node playpdfonly.cjs                (http://localhost:8097; BASE=… for another server)
const { chromium } = require("playwright");
const path = require("path");
const { pdfmini } = require(path.join(__dirname, "pdfmini.cjs"));
const BASE = (process.env.BASE || "http://localhost:8097").replace(/\/$/, "") + "/resonate/";
let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) passes++; else fails++; console.log(`${c ? "ok  " : "FAIL"} ${msg}`); return c; };
const sleep = (t) => new Promise((r) => setTimeout(r, t));
function INIT() {
  try { if (!navigator.audioSession) Object.defineProperty(navigator, "audioSession", { configurable: true, value: { type: "auto" } }); } catch {}
}
const D = (page) => page.evaluate(() => window.resonateDebug().play);
const shownPdf = (page, id) => page.waitForFunction((id) => { const d = window.resonateDebug?.().play; return d && d.song === id && d.pdfOnly && d.onScreen; }, id, { timeout: 30000 });
const vis = (page, sel) => page.evaluate((sel) => { const e = document.querySelector(sel); return !!e && e.getClientRects().length > 0; }, sel);

// A PDF whose page 3 pdf.js can't draw (its page reference points at nothing: getPage(3) rejects).
const tornPdf = () => Buffer.from(pdfmini(3).toString("latin1").replace(/(\/Kids \[\d+ 0 R \d+ 0 R )\d+ 0 R\]/, "$199 0 R]"), "latin1");
// The play record of a song (resonate.play[id]).
const playRec = (page, id) => page.evaluate((id) => JSON.parse(localStorage.getItem("resonate.play") || "{}")[id] || null, id);
const msg = (page) => page.evaluate(() => document.getElementById("msg").textContent);

async function run(browser, { w, h, touch, label }) {
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console.error " + m.text().slice(0, 200)); });
  let dialogs = 0;
  page.on("dialog", (d) => { dialogs++; d.dismiss(); });
  await page.goto(BASE + "play.html");
  await page.waitForFunction(() => window.resonateDebug?.().play.ready, null, { timeout: 90000 });
  // seed: a PDF only (3 pages), a broken one, one whose PDF is gone
  const ids = await page.evaluate(async ({ pdf, torn }) => {
    const v = document.getElementById("version").textContent.trim().replace(/^v/, "");
    const L = await import("./library.js?v=" + v), Sp = await import("./space.js?v=" + v);
    const buf = Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0)).buffer;
    const mini = await L.addPdfSong(buf, { name: "mini.pdf", title: "Mini" });
    const tornId = await L.addPdfSong(Uint8Array.from(atob(torn), (c) => c.charCodeAt(0)).buffer, { name: "torn.pdf", title: "Torn" });
    const bad = await L.addPdfSong(new TextEncoder().encode("not a pdf at all").buffer, { name: "bad.pdf", title: "Bad" });
    const lost = await L.addPdfSong(buf.slice(0), { name: "lost.pdf", title: "Lost" });
    await new Promise((res, rej) => { const r = indexedDB.open(Sp.dbName() + "-files"); r.onsuccess = () => { const tx = r.result.transaction("pdfs", "readwrite"); tx.objectStore("pdfs").delete(lost); tx.oncomplete = () => { r.result.close(); res(); }; tx.onerror = rej; }; r.onerror = rej; });
    localStorage.setItem("resonate.sing.song", mini);
    return { mini, bad, lost, torn: tornId };
  }, { pdf: pdfmini(3).toString("base64"), torn: tornPdf().toString("base64") });
  await page.reload();
  await shownPdf(page, ids.mini);
  let d = await D(page);
  const verovio = await page.evaluate(() => performance.getEntriesByType("resource").some((e) => /verovio/.test(e.name)));
  ok(!verovio, `${label}: opened at load as a PDF only — no Verovio fetched`);
  ok(d.pdf.on && d.pdf.pages === 3 && d.pdf.canvas && !d.ready && !d.failed, `${label}: its PDF shown (3 pages), not ready, not failed`);
  ok(await page.evaluate(() => document.getElementById("bar").hasAttribute("data-pdfonly")), `${label}: #bar[data-pdfonly]`);
  for (const sel of ["#hands", "#play", "#names", "#chords", ".size", "#offer", "#pdf"]) ok(!(await vis(page, sel)), `${label}: ${sel} hidden`);
  ok(await page.evaluate(() => [...document.querySelectorAll("#mine option")].some((o) => o.textContent === "Mini · PDF")), `${label}: menu "Mini · PDF"`);
  ok(d.keys.shown && !(await page.evaluate(() => document.getElementById("keys").disabled)), `${label}: the keyboard under the PDF, 🎹 enabled`);
  ok(JSON.stringify(d.keys.range) === "[48,83]", `${label}: keyboard range C3–B5 (${JSON.stringify(d.keys.range)})`);
  const dock = d.keys.rect, wrap = await page.evaluate(() => { const r = document.getElementById("pdfwrap").getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
  ok(wrap[1] + wrap[3] <= dock[1] + 1, `${label}: the PDF above the keyboard (${wrap[1] + wrap[3]} ≤ ${dock[1]})`);
  const bar = await page.evaluate(() => { const r = document.getElementById("pdfbar").getBoundingClientRect(); return [r.top, r.bottom]; });
  ok(bar[1] <= dock[1] && bar[1] >= dock[1] - 30, `${label}: ⟳'s bar just above the keyboard (${bar[1]} / ${dock[1]})`);
  ok(d.pdf.bar?.label === "Convert", `${label}: ⟳ reads Convert (${d.pdf.bar?.label})`);
  // the keyboard: pressed, it sounds
  const n0 = d.peekLog.length;
  const k = await page.evaluate(() => { const r = document.querySelector("#strip rect.key")?.getBoundingClientRect(); return r ? [r.left + r.width / 2, r.top + r.height * 0.8] : null; });
  if (touch) { const cdp = await ctx.newCDPSession(page); await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: k[0], y: k[1] }] }); await sleep(250); await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); }
  else { await page.mouse.move(k[0], k[1]); await page.mouse.down(); await sleep(250); await page.mouse.up(); }
  await page.waitForFunction((n) => window.resonateDebug().play.peekLog.length > n, n0, { timeout: 5000 }).catch(() => {});
  d = await D(page);
  ok(d.peekLog.length > n0, `${label}: a key pressed sounds (${d.peekLog.length - n0})`);
  // turns: › and ArrowRight, ‹ (a spread — two pages side by side in landscape — turns by two)
  const sp = (await D(page)).pdf.spread, st1 = sp ? 3 : 2;
  await page.click("#next");
  await page.waitForFunction((p) => window.resonateDebug().play.pdf.page === p, st1, { timeout: 5000 }).catch(() => {});
  ok((await D(page)).pdf.page === st1, `${label}: › → PDF page ${st1}${sp ? " (a spread)" : ""}`);
  if (!sp) {
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })));
    await page.waitForFunction(() => window.resonateDebug().play.pdf.page === 3, null, { timeout: 5000 }).catch(() => {});
    ok((await D(page)).pdf.page === 3, `${label}: ArrowRight → page 3`);
  }
  ok(await page.evaluate(() => document.getElementById("pg").textContent === "3 / 3" && document.getElementById("next").disabled), `${label}: the pager "3 / 3", › off`);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true })));
  const back = sp ? 1 : 2;
  await page.waitForFunction((p) => window.resonateDebug().play.pdf.page === p, back, { timeout: 5000 }).catch(() => {});
  ok((await D(page)).pdf.page === back, `${label}: ArrowLeft → page ${back}`);
  // 🎹 off: the PDF gets the height, drawn again for it
  if (!touch) {
    await page.click("#keys");
    await page.waitForFunction(() => !window.resonateDebug().play.keys.shown, null, { timeout: 3000 }).catch(() => {});
    await sleep(400);
    const wr2 = await page.evaluate(() => { const r = document.getElementById("pdfwrap").getBoundingClientRect(); return r.height; });
    d = await D(page);
    ok(!d.keys.shown && wr2 > wrap[3] + 40 && d.pdf.on && d.pdf.page === back, `${label}: 🎹 off → the PDF taller (${wrap[3]} → ${wr2}), same page`);
    await page.click("#keys");
    await page.waitForFunction(() => window.resonateDebug().play.keys.shown, null, { timeout: 3000 }).catch(() => {});
  }
  // the assistant's view
  const st = await page.evaluate(() => ({ s: window.resonatePlay.state(), sc: window.resonatePlay.scoreState() }));
  ok(st.s.pdfOnly === true && st.s.shown === true && st.s.ready === false, `${label}: state() pdfOnly, shown`);
  ok(st.sc.pdf_only === true && st.sc.pages === 3 && st.sc.page === back && st.sc.views.length === 0 && st.sc.bars === null, `${label}: scoreState pdf_only, page ${back} / 3, no views, no bars`);
  const t0 = Date.now();
  const r = await page.evaluate(async (id) => ({
    state: await window.resonatePlay.scoreRun("score_state", {}),
    go: await window.resonatePlay.scoreRun("score_go", { measure: 1 }),
    play: await window.resonatePlay.scoreRun("score_play", {}),
    view: await window.resonatePlay.scoreRun("score_view", { view: "both" }),
    pdf: await window.resonatePlay.scoreRun("score_pdf", {}),
    off: await window.resonatePlay.scoreRun("score_pdf", { on: false }),
    open: await window.resonatePlay.scoreRun("score_open", { song: id }),
    stop: await window.resonatePlay.scoreRun("score_stop", {}),
  }), ids.mini);
  ok(Date.now() - t0 < 3000, `${label}: score_* answered at once (${Date.now() - t0} ms)`);
  ok(r.state.ok && r.pdf.ok && r.open.ok && r.stop.ok, `${label}: score_state / score_pdf / score_open / score_stop ok`);
  ok(!r.go.ok && !r.play.ok && !r.view.ok && !r.off.ok && /convert it first/.test(r.go.error), `${label}: score_go / play / view / pdf off refused: ${r.go.error}`);
  ok((await D(page)).pdf.on, `${label}: still on its PDF`);
  ok((await page.evaluate(() => window.resonatePlay.focus())) === null, `${label}: focus() null`);
  // Convert: the shell's hook, no question
  await page.evaluate(() => { window.__rep = []; window.resonatePlay.reprocess = (id) => { window.__rep.push(id); return true; }; });
  await page.click("#pdf-again");
  ok(JSON.stringify(await page.evaluate(() => window.__rep)) === JSON.stringify([ids.mini]) && dialogs === 0, `${label}: Convert → reprocess(id), no question`);
  // a broken PDF: said, stays (no empty stage)
  await page.selectOption("#song", ids.bad);
  await page.waitForFunction(() => window.resonateDebug().play.failed === "pdf", null, { timeout: 15000 }).catch(() => {});
  await sleep(3500);
  d = await D(page);
  ok(d.failed === "pdf" && d.pdfOnly && !d.pdf.on && (await page.evaluate(() => document.getElementById("msg").textContent)) === "Couldn't open the PDF.", `${label}: a broken PDF → "Couldn't open the PDF." (still there after 3.5 s)`);
  ok(d.keys.shown, `${label}: the keyboard still there`);
  // its PDF not on this device
  await page.selectOption("#song", ids.lost);
  await page.waitForFunction(() => window.resonateDebug().play.failed === "nopdf", null, { timeout: 15000 }).catch(() => {});
  d = await D(page);
  ok(d.failed === "nopdf" && (await page.evaluate(() => document.getElementById("msg").textContent)) === "This song's PDF isn't on this device.", `${label}: no PDF here → said`);
  const rl = await page.evaluate(() => window.resonatePlay.scoreRun("score_state", {}));
  ok(!rl.ok && /isn't on this device/.test(rl.error), `${label}: score_state there: ${rl.error}`);
  ok((await page.evaluate(() => window.resonatePlay.state().failed)) === "nopdf", `${label}: state() failed "nopdf"`);
  // a page that can't be drawn (page 3 of Torn): back to the last page that drew, the PDF and its bar
  // kept, the failing page never saved
  await page.selectOption("#song", ids.torn);
  await shownPdf(page, ids.torn);
  d = await D(page);
  const tsp = d.pdf.spread;
  if (!tsp) { await page.click("#next"); await page.waitForFunction(() => window.resonateDebug().play.pdf.drawn === 2, null, { timeout: 5000 }).catch(() => {}); }
  const good = tsp ? 1 : 2;
  ok((await D(page)).pdf.drawn === good, `${label}: Torn: page ${good} drawn`);
  await page.click("#next");
  await page.waitForFunction(() => /page 3/.test(document.getElementById("msg").textContent), null, { timeout: 8000 }).catch(() => {});
  await page.waitForFunction((p) => { const x = window.resonateDebug().play; return x.pdf.drawn === p && x.pdf.page === p && !x.pdf.busy; }, good, { timeout: 8000 }).catch(() => {});
  await sleep(1300); // (a page kept is saved a second later)
  d = await D(page);
  ok(d.pdf.on && !d.failed && d.onScreen && d.pdf.page === good && d.pdf.drawn === good, `${label}: page 3 fails → back on page ${good} (on ${d.pdf.on}, failed ${d.failed}, page ${d.pdf.page}, drawn ${d.pdf.drawn})`);
  ok((await msg(page)) === "Couldn't open page 3.", `${label}: said "${await msg(page)}"`);
  ok(d.pdf.bar?.label === "Convert" && (await vis(page, "#pdfbar")), `${label}: the PDF's bar still there (Convert)`);
  ok(await page.evaluate(() => document.getElementById("pg").textContent.startsWith(`${window.resonateDebug().play.pdf.page}`)), `${label}: the pager on page ${good} (${await page.evaluate(() => document.getElementById("pg").textContent)})`);
  let tr = await playRec(page, ids.torn);
  ok(tr?.pdfPage === good, `${label}: page ${good} kept to open at, never 3 (${JSON.stringify(tr)})`);
  await sleep(2000);
  ok((await msg(page)) === "", `${label}: the word goes after 3 s`);
  // the failing page saved as the one to open at (as before the fix): opens there, goes back to 1
  await page.selectOption("#song", ids.mini);
  await shownPdf(page, ids.mini);
  await page.evaluate((id) => { const all = JSON.parse(localStorage.getItem("resonate.play") || "{}"); all[id] = { ...(all[id] || {}), pdfPage: 3 }; localStorage.setItem("resonate.play", JSON.stringify(all)); }, ids.torn);
  await page.selectOption("#song", ids.torn);
  await page.waitForFunction(() => { const x = window.resonateDebug().play; return x.pdf.drawn === 1 || x.failed; }, null, { timeout: 15000 }).catch(() => {});
  await sleep(1300);
  d = await D(page);
  tr = await playRec(page, ids.torn);
  ok(d.pdf.on && !d.failed && d.onScreen && d.pdf.page === 1 && tr?.pdfPage === 1, `${label}: saved on page 3 → opens on page 1, kept (failed ${d.failed}, page ${d.pdf.page}, ${JSON.stringify(tr)})`);
  // every page failing (iOS: the canvas memory used up): back once, then failed, said — no loop
  await page.evaluate(() => {
    window.__noCtx = 0;
    const orig = (window.__getCtx = HTMLCanvasElement.prototype.getContext);
    HTMLCanvasElement.prototype.getContext = function (...a) { if (this.id === "pdfview") { window.__noCtx++; return null; } return orig.apply(this, a); };
  });
  await page.click("#next");
  await page.waitForFunction(() => window.resonateDebug().play.failed, null, { timeout: 8000 }).catch(() => {});
  await sleep(500);
  d = await D(page);
  const nctx = await page.evaluate(() => { HTMLCanvasElement.prototype.getContext = window.__getCtx; return window.__noCtx; });
  ok(d.failed === "pdf" && !d.pdf.on && (await msg(page)) === "Couldn't open the PDF." && nctx >= 1 && nctx <= 2, `${label}: no page draws → back once, then "Couldn't open the PDF." (${nctx} tries, failed ${d.failed})`);
  ok((await playRec(page, ids.torn))?.pdfPage === 1, `${label}: still page 1 to open at`);
  ok((await page.evaluate(() => window.resonatePlay.state().failed)) === "pdf", `${label}: state() failed "pdf"`);
  // forget: the record isn't written back
  await page.selectOption("#song", ids.mini);
  await shownPdf(page, ids.mini);
  await page.click("#next");
  await sleep(300);
  await page.evaluate((id) => window.resonatePlay.forget(id), ids.mini);
  await page.evaluate(() => { localStorage.setItem("resonate.play", JSON.stringify({})); });
  await page.selectOption("#song", "amazing-grace");
  await page.waitForFunction(() => window.resonateDebug().play.ready, null, { timeout: 60000 });
  await sleep(1300);
  const rec = await page.evaluate((id) => JSON.parse(localStorage.getItem("resonate.play") || "{}")[id], ids.mini);
  ok(rec === undefined, `${label}: forget(id) → its record not written back (${JSON.stringify(rec)})`);
  // a normal song after: everything back
  d = await D(page);
  ok(!d.pdfOnly && d.ready && !(await page.evaluate(() => document.getElementById("bar").hasAttribute("data-pdfonly"))), `${label}: Amazing Grace: not PDF-only`);
  for (const sel of ["#play", "#names", "#chords", ".size"]) ok(await vis(page, sel), `${label}: ${sel} back`);
  ok(d.pdf.bar === null && !(await vis(page, "#pdf")), `${label}: no PDF view / button for a sample`);
  const ag = await page.evaluate(() => window.resonatePlay.state());
  ok(ag.pdfOnly === false && ag.shown === true && ag.pages > 0, `${label}: state() shown = ready (${ag.pages} pages)`);
  ok(!(await page.evaluate(() => "pdf_only" in window.resonatePlay.scoreState())), `${label}: scoreState has no pdf_only for a normal song`);
  // without the hook: Convert goes to PDF → Song
  await page.evaluate(() => { delete window.resonatePlay.reprocess; });
  await page.route("**/pdf-import.html*", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>imp</title>" }));
  await page.selectOption("#song", ids.mini);
  await shownPdf(page, ids.mini);
  await Promise.all([page.waitForURL(/pdf-import\.html\?reprocess=/, { timeout: 5000 }).catch(() => {}), page.click("#pdf-again")]);
  ok(page.url().includes("pdf-import.html?reprocess=" + encodeURIComponent(ids.mini)) && dialogs === 0, `${label}: Convert → ${page.url().replace(BASE, "")}`);
  ok(!errors.length, `${label}: no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  // clean up
  await page.goto(BASE + "play.html");
  await page.evaluate(async (ids) => {
    const v = document.getElementById("version").textContent.trim().replace(/^v/, "");
    const L = await import("./library.js?v=" + v);
    for (const id of Object.values(ids)) await L.removeSong(id).catch(() => {});
    localStorage.removeItem("resonate.sing.song");
  }, ids);
  await ctx.close();
}

// Songs added through the page's own library module. list: [{ title, pdf: Buffer, drop: true = its PDF
// not on this device }]
function seed(page, list) {
  return page.evaluate(async (list) => {
    const v = document.getElementById("version").textContent.trim().replace(/^v/, "");
    const L = await import("./library.js?v=" + v), Sp = await import("./space.js?v=" + v);
    const ids = [];
    for (const s of list) {
      const id = await L.addPdfSong(Uint8Array.from(atob(s.pdf), (c) => c.charCodeAt(0)).buffer, { name: s.title + ".pdf", title: s.title });
      if (s.drop) await new Promise((res, rej) => { const r = indexedDB.open(Sp.dbName() + "-files"); r.onsuccess = () => { const tx = r.result.transaction("pdfs", "readwrite"); tx.objectStore("pdfs").delete(id); tx.oncomplete = () => { r.result.close(); res(); }; tx.onerror = rej; }; r.onerror = rej; });
      ids.push(id);
    }
    return ids;
  }, list.map((s) => ({ ...s, pdf: s.pdf.toString("base64") })));
}
const unseed = (page, ids) => page.evaluate(async (ids) => {
  const v = document.getElementById("version").textContent.trim().replace(/^v/, "");
  const L = await import("./library.js?v=" + v);
  for (const id of ids) await L.removeSong(id).catch(() => {});
  localStorage.removeItem("resonate.sing.song");
}, ids);
async function context(browser, errors) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(INIT);
  ctx.on("page", (p) => {
    p.on("pageerror", (e) => errors.push("pageerror " + e.message));
    p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Failed to fetch|supabase|sync|pdf\.min\.mjs/i.test(m.text())) errors.push("console.error " + m.text().slice(0, 200)); });
  });
  return ctx;
}

// pdf.js not loaded once (offline before it was cached): a browser may keep that import failed for the
// page's life, so the next open asks for it at another address (?r=1) — and the PDF shows.
async function libRetry(browser) {
  const label = "pdf.js retry", errors = [];
  const ctx = await context(browser, errors);
  const page = await ctx.newPage();
  await page.goto(BASE + "play.html");
  await page.waitForFunction(() => window.resonateDebug?.().play.ready, null, { timeout: 90000 });
  const [id] = await seed(page, [{ title: "Mini", pdf: pdfmini(3) }]);
  await page.evaluate(() => localStorage.setItem("resonate.sing.song", "amazing-grace"));
  await page.reload();
  await page.waitForFunction(() => window.resonateDebug?.().play.ready, null, { timeout: 90000 });
  const libs = () => page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /pdf\.min\.mjs/.test(n)).map((n) => n.replace(/^.*\//, "")));
  ok(!(await libs()).length, `${label}: pdf.js not loaded with a sample`);
  let blocked = 0;
  const lib0 = (url) => url.pathname.endsWith("/omr/pdfjs/pdf.min.mjs") && !url.search;
  await page.route(lib0, (r) => { blocked++; return r.abort("internetdisconnected"); });
  await page.selectOption("#song", id);
  await page.waitForFunction(() => window.resonateDebug().play.failed, null, { timeout: 15000 }).catch(() => {});
  let d = await D(page);
  ok(blocked >= 1 && d.failed === "pdf" && d.pdf.lib === 1 && (await msg(page)) === "Couldn't open the PDF.", `${label}: offline → "Couldn't open the PDF." (blocked ${blocked}, failed ${d.failed}, fails ${d.pdf.lib})`);
  await page.unroute(lib0); // (Chromium fetches a failed module again; WebKit's module map may not — hence another address)
  await page.selectOption("#song", "amazing-grace");
  await page.waitForFunction(() => window.resonateDebug().play.ready, null, { timeout: 60000 });
  await page.selectOption("#song", id);
  await shownPdf(page, id).catch(() => {});
  d = await D(page);
  const got = await libs();
  ok(d.onScreen && d.pdf.on && !d.failed && d.pdf.pages === 3, `${label}: opened again → its PDF shown (failed ${d.failed}, on ${d.pdf.on})`);
  ok(got.includes("pdf.min.mjs?r=1"), `${label}: asked at another address (${got.join(", ")})`);
  ok(!errors.length, `${label}: no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await unseed(page, [id]);
  await ctx.close();
}

// The shell: the Score holding a song that failed (its PDF not on this device) opens it again when the
// song is opened again — its PDF come since (the sync) → shown. (It used to stay failed until a reload.)
async function shellAgain(browser) {
  const label = "shell", errors = [];
  const ctx = await context(browser, errors);
  const page = await ctx.newPage();
  await page.goto(BASE + "index.html");
  await page.waitForFunction(() => window.resonateDebug?.().tuner, null, { timeout: 15000 });
  const buf = pdfmini(3);
  const [id] = await seed(page, [{ title: "Lost", pdf: buf, drop: true }]);
  const dbg = () => page.evaluate(() => window.resonateDebug?.()).catch(() => null);
  const until = async (pred, ms = 20000) => { const end = Date.now() + ms; let d = null; while (Date.now() < end) { d = await dbg(); try { if (d && pred(d)) return d; } catch {} await sleep(150); } return null; };
  const openIt = () => page.evaluate(async (id) => { const v = document.getElementById("version").textContent.trim().replace(/^v/, ""); (await import(`./shell/songlist.js?v=${v}`)).openSong(id); }, id);
  await openIt();
  let d = await until((x) => x.song.open && x.score?.play?.song === id && x.score.play.failed);
  ok(d?.score.play.failed === "nopdf", `${label}: its PDF not here → the Score says so (${d?.score.play.failed})`);
  await page.evaluate(async ({ id, pdf }) => {
    const v = document.getElementById("version").textContent.trim().replace(/^v/, "");
    const L = await import("./library.js?v=" + v);
    await L.putPdf(id, Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0)).buffer, "Lost.pdf", { quiet: true });
  }, { id, pdf: buf.toString("base64") });
  await page.goBack();
  d = await until((x) => !x.song.open, 8000);
  ok(!!d, `${label}: closed`);
  await openIt();
  d = await until((x) => x.song.open && x.score?.play?.song === id && x.score.play.pdfOnly && x.score.play.onScreen);
  ok(!!d && !d.score.play.failed && d.score.play.pdf.on && d.score.play.pdf.pages === 3, `${label}: opened again → its PDF shown (failed ${d?.score.play.failed ?? "?"})`);
  ok(!errors.length, `${label}: no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await unseed(page, [id]);
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    await run(browser, { w: 1280, h: 800, touch: false, label: "desktop" });
    await run(browser, { w: 820, h: 1180, touch: true, label: "iPad" });
    await libRetry(browser);
    await shellAgain(browser);
  } catch (err) { ok(false, "crashed: " + (err.stack || err)); }
  await browser.close();
  console.log(`\n${passes} ok, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
