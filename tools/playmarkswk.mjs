// WebKitGTK (Safari stand-in) smoke for Play's bookmarks (E6): play.html copied to
// /home/user/sitetest/tmp/playmarks-wk.html with an error recorder and <base href="/resonate/">.
// A mouse drag picks a stretch → the stretch's 🔖 saves it (the record, pressed, a tab over its system, clear of its ink,
// the bar's 🔖 shown); a tap on paper lets go; a click on the tab selects it again and strikes nothing;
// the bar's 🔖 opens the list (a row, its placeholder), a label typed and Enter saved, Escape closes it;
// the 🔖 twice removes the mark (the bar's 🔖 hidden again); no errors.
// Needs Xvfb :99 + WebKitWebDriver on :4444 (CLAUDE.md "a fresh container").
// usage: node playmarkswk.mjs   (BASE=http://localhost:8097/)
import fs from "node:fs";
const ROOT = process.env.BASE || "http://localhost:8097/";
const SRC = new URL("../public/play.html", import.meta.url).pathname, OUT = "/home/user/sitetest/tmp/playmarks-wk.html";
const REC = `<base href="/resonate/"><script>window.__err=[];addEventListener("error",(e)=>__err.push("error "+e.message+" @"+e.filename+":"+e.lineno));addEventListener("unhandledrejection",(e)=>__err.push("rejection "+(e.reason&&(e.reason.stack||e.reason.message)||e.reason)));const __ce=console.error;console.error=(...a)=>{__err.push("console.error "+a.map(String).join(" "));__ce.apply(console,a)};</script>`;
fs.mkdirSync("/home/user/sitetest/tmp", { recursive: true });
fs.writeFileSync(OUT, fs.readFileSync(SRC, "utf8").replace(/<head>/i, "<head>" + REC));

const W = "http://127.0.0.1:4444";
const j = async (method, path, body) => (await fetch(W + path, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0, passes = 0;
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (c) passes++; else fails++; };
const s = await j("POST", "/session", { capabilities: { alwaysMatch: { browserName: "MiniBrowser", "webkitgtk:browserOptions": { binary: "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser", args: ["--automation"] } } } });
const sid = s.value?.sessionId;
if (!sid) { console.log("no WebDriver session", JSON.stringify(s).slice(0, 300)); process.exit(2); }
const ex = async (script) => (await j("POST", `/session/${sid}/execute/sync`, { script, args: [] })).value;
const find = async (css) => (await j("POST", `/session/${sid}/element`, { using: "css selector", value: css })).value;
const elId = async (css) => { const e = await find(css); return e && Object.values(e)[0]; };
const click = async (css) => j("POST", `/session/${sid}/element/${await elId(css)}/click`, {});
const at = (x, y) => j("POST", `/session/${sid}/actions`, { actions: [{ type: "pointer", id: "m", parameters: { pointerType: "mouse" }, actions: [
  { type: "pointerMove", x: Math.round(x), y: Math.round(y), duration: 0 }, { type: "pointerDown", button: 0 }, { type: "pause", duration: 60 }, { type: "pointerUp", button: 0 }] }] });
const key = (k) => j("POST", `/session/${sid}/actions`, { actions: [{ type: "key", id: "k", actions: [{ type: "keyDown", value: k }, { type: "keyUp", value: k }] }] });
const waitFor = async (script, ms = 15000) => { const t0 = Date.now(); for (;;) { if (await ex(script)) return true; if (Date.now() - t0 > ms) return false; await sleep(150); } };
const MK = () => ex(`const d = window.resonateDebug().play; return { marks: d.marks, span: d.playback.span, peeks: d.peekLog.length, rec: (JSON.parse(localStorage.getItem("resonate.play") || "{}")["amazing-grace"] || {}).marks || null };`);
try {
  await j("POST", `/session/${sid}/window/rect`, { width: 1024, height: 1300 }).catch(() => {});
  // (Amazing Grace in Both, no marks — written from another page of the site: Play writes its record when it's left)
  await j("POST", `/session/${sid}/url`, { url: ROOT + "resonate/tools.html" });
  await ex(`const all = JSON.parse(localStorage.getItem("resonate.play") || "{}"); all["amazing-grace"] = { ...(all["amazing-grace"] || {}), view: "both" }; delete all["amazing-grace"].marks; localStorage.setItem("resonate.play", JSON.stringify(all)); return 1`);
  await j("POST", `/session/${sid}/url`, { url: ROOT + "tmp/playmarks-wk.html" });
  ok(await waitFor("const d = window.resonateDebug && window.resonateDebug().play; return !!(d && d.ready);", 40000), "ready on Amazing Grace");
  console.log("UA", await ex("return navigator.userAgent"));
  let m = await MK();
  ok(!m.marks.list.length && !m.marks.listBtn.shown, "no marks: no 🔖 in the bar");
  // a mouse drag over the first system's middle
  const pts = await ex(`const g = window.resonateDebug().play.playback.geo()[0]; const s = g.systems[0]; const c = (i) => [g.rect[0] + (s.cols[i][1] + s.cols[i][2]) / 2, g.rect[1] + (s.top + s.bottom) / 2]; return [c(3), c(Math.min(s.cols.length - 1, 8))];`);
  const steps = Array.from({ length: 8 }, (_, i) => ({ type: "pointerMove", x: Math.round(pts[0][0] + ((pts[1][0] - pts[0][0]) * (i + 1)) / 8), y: Math.round(pts[0][1] + ((pts[1][1] - pts[0][1]) * (i + 1)) / 8), duration: 30 }));
  await j("POST", `/session/${sid}/actions`, { actions: [{ type: "pointer", id: "m", parameters: { pointerType: "mouse" }, actions: [
    { type: "pointerMove", x: Math.round(pts[0][0]), y: Math.round(pts[0][1]), duration: 0 }, { type: "pointerDown", button: 0 }, ...steps, { type: "pause", duration: 120 }, { type: "pointerUp", button: 0 }] }] });
  await sleep(300);
  m = await MK();
  const span = m.span;
  ok(span && !span.note && m.marks.button.shown && !m.marks.button.pressed, `a drag: a stretch, 🔖 in its controls (${JSON.stringify(span)})`);
  await click("#sel-mark");
  await sleep(250);
  m = await MK();
  const A = m.marks.list[0];
  ok(m.marks.list.length === 1 && Math.abs(A.q0 - span.q0) < 1e-6 && Math.abs(A.end - span.end) < 1e-6 && m.rec?.length === 1 && m.marks.button.pressed && m.marks.listBtn.shown && m.marks.tabs.length === 1,
    `🔖 saves it: the record, pressed, a tab, the bar's 🔖 (${JSON.stringify(A)})`);
  const sys = await ex(`const g = window.resonateDebug().play.playback.geo()[0]; return g.rect[1] + g.systems[0].top;`);
  const t = m.marks.tabs[0];
  const covers = await ex(`const rb = ${JSON.stringify(t.ribbon)}; return [...document.querySelectorAll("#stage .page g.notehead, #stage .page .nn, #stage .page g.accid")].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.left < rb[0] + rb[2] && r.right > rb[0] && r.top < rb[1] + rb[3] && r.bottom > rb[1]; }).length;`);
  ok(t.ribbon[1] + t.ribbon[3] <= sys + 0.5 && t.ribbon[1] + t.ribbon[3] > sys - 80 && !covers, `the tab over the first system's top staff, above the ink there (ribbon bottom ${(t.ribbon[1] + t.ribbon[3]).toFixed(1)}, staff top ${sys.toFixed(1)}, covering ${covers} heads / pills / accidentals)`);
  // a tap on paper lets go; a click on the tab selects it, no strike
  const blank = await ex(`const st = document.getElementById("stage").getBoundingClientRect(); return [st.left + 30, st.bottom - 40];`);
  await at(blank[0], blank[1]);
  await sleep(300);
  m = await MK();
  const peeks = m.peeks;
  ok(!m.span, "a click on paper lets go");
  await at(t.ribbon[0] + t.ribbon[2] / 2, t.ribbon[1] + t.ribbon[3] / 2);
  await sleep(400);
  m = await MK();
  ok(m.span && Math.abs(m.span.q0 - A.q0) < 1e-6 && Math.abs(m.span.end - A.end) < 1e-6 && m.marks.sel === A.id && m.peeks === peeks, `a click on its tab selects it, nothing struck (${JSON.stringify(m.span)}, peeks ${peeks} → ${m.peeks})`);
  // the list: a row, a label typed + Enter, Escape
  await click("#marks");
  await sleep(300);
  m = await MK();
  ok(m.marks.open && m.marks.rows.length === 1 && /^Bars? \d/.test(m.marks.rows[0].placeholder) && m.marks.rows[0].age === "today", `the bar's 🔖: the list (${JSON.stringify(m.marks.rows)})`);
  const inp = await elId("#marklist .mlabel");
  await j("POST", `/session/${sid}/element/${inp}/click`, {});
  await j("POST", `/session/${sid}/element/${inp}/value`, { text: "Opening" });
  await key(""); // (Enter)
  await sleep(250);
  m = await MK();
  ok(m.rec?.[0]?.label === "Opening" && !(await ex(`return document.activeElement?.matches?.("#marklist input") || false`)), `a label typed, Enter: saved (${m.rec?.[0]?.label})`);
  await key(""); // (Escape)
  await sleep(200);
  m = await MK();
  ok(!m.marks.open && m.span, "Escape closes the list");
  // 🔖 twice: removed
  await click("#sel-mark"); await sleep(200);
  const armed = (await MK()).marks.button.armed;
  await click("#sel-mark"); await sleep(250);
  m = await MK();
  ok(armed && !m.marks.list.length && !m.rec && !m.marks.listBtn.shown && !m.marks.tabs.length, "🔖 twice (\"Remove?\" then again): removed, the bar's 🔖 hidden");
  const errs = await ex("return window.__err || []");
  ok(!errs.length, `no errors (${errs.slice(0, 3).join(" | ")})`);
} catch (e) {
  ok(false, "crashed: " + (e.stack || e));
} finally {
  await j("DELETE", `/session/${sid}`).catch(() => {});
}
console.log(fails ? `${fails} failed, ${passes} passed` : `all ${passes} passed`);
process.exit(fails ? 1 : 0);
