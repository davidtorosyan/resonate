// WebKitGTK (Safari stand-in) smoke for the Reader (public/omr/reader.js) through the dev harness
// /home/user/sitetest/readerdev.html: a 10× replay of the greensleeves fixture to the end (no
// errors, done, links), a 1× stretch mid-HEADS (lens on a system, scan line, symbols drawn), the
// real 0009 trace (greensleeves-trace) and the real recorded Chromium run (greensleeves3-real) to the end, minimize → pill → expand, screenshots.
// Needs Xvfb :99 + WebKitWebDriver on :4444 (/home/user/xb).   usage: node readerwk.mjs
import fs from "node:fs";
const ROOT = process.env.BASE || "http://localhost:8097/";
const OUT = process.env.OUT || "/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/import/shots";
const W = "http://127.0.0.1:4444";
const j = async (method, path, body) => (await fetch(W + path, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fails++; };
const s = await j("POST", "/session", { capabilities: { alwaysMatch: { browserName: "MiniBrowser", "webkitgtk:browserOptions": { binary: "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser", args: ["--automation"] } } } });
const sid = s.value?.sessionId;
if (!sid) { console.log("no WebDriver session", JSON.stringify(s).slice(0, 300)); process.exit(2); }
const ex = async (script, args = []) => (await j("POST", `/session/${sid}/execute/sync`, { script, args })).value;
const waitFor = async (script, ms = 15000) => { const t0 = Date.now(); for (;;) { if (await ex(script)) return true; if (Date.now() - t0 > ms) return false; await sleep(200); } };
const shot = async (name) => { const r = await j("GET", `/session/${sid}/screenshot`); if (r.value) fs.writeFileSync(`${OUT}/wk-${name}.png`, Buffer.from(r.value, "base64")); };
try {
  fs.mkdirSync(OUT, { recursive: true });
  await j("POST", `/session/${sid}/window/rect`, { width: 820, height: 1180 }).catch(() => {});
  await j("POST", `/session/${sid}/url`, { url: ROOT + "readerdev.html?fx=greensleeves&speed=1&load=41&bare" });
  ok(await waitFor("return !!(window.__harness && window.__harness.started)", 30000), "harness started (41 stored events loaded)");
  await sleep(2400);
  let d = await ex("return { dbg: window.__rd.debug(), sweep: !!document.querySelector('.rd-sweep.on'), lens: document.querySelector('.rd-page').dataset.lens, err: window.__err }");
  ok(d.dbg.svgNodes > 50 && d.dbg.hero.look === "engine", `mid HEADS: engine view, ${d.dbg.svgNodes} svg nodes, lens ${d.lens}`);
  await shot("heads");
  await ex("document.querySelector('.rd-min').click(); return 1");
  await sleep(500);
  d = await ex("const p = document.querySelector('.rd-pill'); const r = p.getBoundingClientRect(); return { pill: !p.hidden, card: document.querySelector('.rd-card').hidden, r: [r.left, r.top, r.width, r.height], text: p.textContent.trim(), w: innerWidth, h: innerHeight }");
  ok(d.pill && d.card && d.r[0] + d.r[2] <= d.w && d.r[1] + d.r[3] <= d.h, `minimized: pill “${d.text.replace(/\s+/g, " ")}” at ${d.r.map(Math.round)}`);
  await shot("pill");
  await ex("document.querySelector('.rd-pill').click(); return 1");
  await sleep(500);
  d = await ex("return window.__rd.debug()");
  ok(d.mode === "open" && d.drawnN === d.gotN, `expanded: caught up (${d.drawnN}/${d.gotN})`);
  for (const fx of ["greensleeves", "greensleeves-trace", "greensleeves3-real"]) {
    await j("POST", `/session/${sid}/url`, { url: ROOT + `readerdev.html?fx=${fx}&speed=10&bare` });
    ok(await waitFor("return !!(window.__harness && window.__harness.done)", 240000), `${fx}: 10× replay to the end`);
    await waitFor("const d = window.__rd.debug(); return d.drawnN === d.gotN && !d.timer;", 20000);
    await sleep(1500);
    d = await ex("return { st: window.__rd.status(), dbg: window.__rd.debug(), links: [...document.querySelectorAll('.rd-done a')].map((a) => a.textContent), err: window.__err, over: document.documentElement.scrollWidth - innerWidth }");
    ok(d.st.phase === "done" && d.links.join() === "Sing it,Play it" && d.over <= 0, `${fx}: done, Sing it / Play it, no sideways scroll (${d.dbg.beats} beats, ${d.dbg.ff} catch-ups, slowest event ${d.dbg.slow[0]} ms, catch-up ${d.dbg.staticMs} ms)`);
    ok(!d.err.length, `${fx}: no errors ${d.err.slice(0, 3).join(" | ")}`);
    await shot(`${fx}-done`);
  }
} finally {
  await j("DELETE", `/session/${sid}`);
}
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
