// buildView's MusicXML for every view the working tree shares with another build (default: HEAD,
// extracted and served by this script) — byte for byte, on every fixture and owner score.
//   node playxmlsame.cjs   (BASE=http://localhost:8097/resonate/  REF=<dir holding the reference
//   public/ — default: git archive HEAD into a temp dir>  PLAY_SCORES=<dir>)
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http");
const { execSync } = require("child_process");
const BASE = process.env.BASE || "http://localhost:8097/resonate/";
const SCORES = process.env.PLAY_SCORES ?? "/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/play/scores";
const FIX = path.join(__dirname, "fixtures/play");
let REF = process.env.REF;
if (!REF) {
  REF = fs.mkdtempSync(path.join(os.tmpdir(), "playref-"));
  execSync(`git -C /home/user/resonate archive HEAD public | tar -x -C ${REF}`);
  REF = path.join(REF, "public");
}
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log("FAIL", m); } };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (e) => ok(false, "pageerror " + e.message));
  const origin = new URL(BASE).origin;
  // the reference build's modules under /__ref/
  await page.route(origin + "/__ref/**", (r) => {
    const p = decodeURIComponent(new URL(r.request().url()).pathname).replace(/^\/__ref\//, "");
    const f = path.join(REF, p);
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: "" });
    r.fulfill({ contentType: /\.m?js$/.test(f) ? "text/javascript" : "application/octet-stream", body: fs.readFileSync(f) });
  });
  await page.route(origin + "/__fx/*", (r) => r.fulfill({ contentType: "application/xml", body: fs.readFileSync(path.join(FIX, path.basename(new URL(r.request().url()).pathname))) }));
  await page.route(origin + "/__scores/*", (r) => r.fulfill({ contentType: "application/xml", body: fs.readFileSync(path.join(SCORES, decodeURIComponent(path.basename(new URL(r.request().url()).pathname)))) }));
  await page.route(origin + "/__same.html", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><meta charset=utf-8><body>same</body>" }));
  await page.goto(origin + "/__same.html");
  const list = fs.readdirSync(FIX).filter((f) => f.endsWith(".musicxml")).map((f) => "/__fx/" + f);
  list.push(BASE + "songs/amazing-grace.musicxml");
  if (SCORES && fs.existsSync(SCORES)) for (const f of fs.readdirSync(SCORES).filter((f) => f.endsWith(".musicxml"))) list.push("/__scores/" + encodeURIComponent(f));
  const r = await page.evaluate(async ({ list, base }) => {
    const now = await import(base + "playprep.js?v=78s"), ref = await import("/__ref/playprep.js?v=77r");
    const fix = await import(base + "omr/fixscore.js?v=78s");
    const out = [];
    for (const url of list) {
      let xml = await (await fetch(url)).text();
      if (/<software>\s*Audiveris/.test(xml.slice(0, 4000))) xml = fix.fixOmrScore(xml).xml;
      const A = now.prepare(xml), B = ref.prepare(xml);
      const shared = Object.keys(B.views);
      const row = { url, nowViews: Object.keys(A.views).join(","), refViews: shared.join(","), diff: [], same: 0, facts: 0 };
      for (const k of shared) {
        if (!A.views[k]) { row.diff.push(k + ": missing now"); continue; }
        const a = now.buildView(A.doc, A.views[k]).xml, b = ref.buildView(B.doc, B.views[k]).xml;
        if (a === b) row.same++; else { let i = 0; while (a[i] === b[i]) i++; row.diff.push(`${k}: differs at ${i}: …${a.slice(i - 40, i + 60)}… vs …${b.slice(i - 40, i + 60)}…`); }
        // the plan: the same but for what's new (low, v78 — when the reference predates it)
        const { low, ...pa0 } = A.views[k], pa = "low" in B.views[k] ? A.views[k] : pa0;
        if (JSON.stringify(pa) !== JSON.stringify(B.views[k])) row.diff.push(k + ": plan " + JSON.stringify(pa) + " vs " + JSON.stringify(B.views[k]));
      }
      // facts identical
      const fa = JSON.stringify([...A.facts]), fb = JSON.stringify([...B.facts]);
      row.facts = fa === fb;
      out.push(row);
    }
    return out;
  }, { list, base: BASE });
  for (const row of r) {
    const name = decodeURIComponent(row.url.split("/").pop());
    ok(!row.diff.length, `${name}: ${row.diff.join(" | ").slice(0, 600)}`);
    ok(row.facts, `${name}: facts differ`);
    console.log(`${name.padEnd(28)} views now ${row.nowViews.padEnd(28)} ref ${row.refViews.padEnd(24)} byte-identical ${row.same}/${row.refViews.split(",").length} facts ${row.facts ? "same" : "DIFFER"}`);
  }
  console.log(`${passes} passed, ${fails} failed`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
