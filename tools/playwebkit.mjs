// WebKitGTK (Safari stand-in) smoke for the Play page, catching errors from the very first
// script: play.html is copied to /home/user/sitetest/tmp/play-wk.html with an error recorder and
// <base href="/resonate/"> put first in <head> (WebDriver can't listen before the page's own
// scripts run). Open, ready, notes drawn with badges, ArrowRight → page 2, names cycle, a hands
// switch, a mouse peek (bubble + lit keys, no turn), the docked keyboard (🎹 off / on), a click in the left quarter (no turn), ‹ → back, no errors.
// Needs Xvfb :99 + WebKitWebDriver on :4444 (/home/user/xb).
// usage: node playwebkit.mjs   (BASE=http://localhost:8097/)
import fs from "node:fs";
const ROOT = process.env.BASE || "http://localhost:8097/";
const SRC = "/home/user/resonate/public/play.html", OUT = "/home/user/sitetest/tmp/play-wk.html";
const REC = `<base href="/resonate/"><script>window.__err=[];addEventListener("error",(e)=>__err.push("error "+e.message+" @"+e.filename+":"+e.lineno));addEventListener("unhandledrejection",(e)=>__err.push("rejection "+(e.reason&&(e.reason.stack||e.reason.message)||e.reason)));const __ce=console.error;console.error=(...a)=>{__err.push("console.error "+a.map(String).join(" "));__ce.apply(console,a)};</script>`;
fs.mkdirSync("/home/user/sitetest/tmp", { recursive: true });
fs.writeFileSync(OUT, fs.readFileSync(SRC, "utf8").replace(/<head>/i, "<head>" + REC));

const W = "http://127.0.0.1:4444";
const j = async (method, path, body) => (await fetch(W + path, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fails++; };
const s = await j("POST", "/session", { capabilities: { alwaysMatch: { browserName: "MiniBrowser", "webkitgtk:browserOptions": { binary: "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser", args: ["--automation"] } } } });
const sid = s.value?.sessionId;
if (!sid) { console.log("no WebDriver session", JSON.stringify(s).slice(0, 300)); process.exit(2); }
const ex = async (script) => (await j("POST", `/session/${sid}/execute/sync`, { script, args: [] })).value;
const key = (value) => j("POST", `/session/${sid}/actions`, { actions: [{ type: "key", id: "k", actions: [{ type: "keyDown", value }, { type: "keyUp", value }] }] });
const mouse = (x, y, hold = 60) => j("POST", `/session/${sid}/actions`, { actions: [{ type: "pointer", id: "m", parameters: { pointerType: "mouse" }, actions: [
  { type: "pointerMove", x: Math.round(x), y: Math.round(y), duration: 0 }, { type: "pointerDown", button: 0 }, { type: "pause", duration: hold }, { type: "pointerUp", button: 0 }] }] });
const dbg = () => ex(`const d = window.resonateDebug && window.resonateDebug().play; return d && { ready: d.ready, failed: d.failed, song: d.song, view: d.view, views: d.views, page: d.page, pages: d.pages, rendered: d.counts.rendered, pitched: d.counts.pitched, names: d.names, sp: d.sp, t: d.t, peek: d.peek, audio: d.audio, peekLog: d.peekLog };`);
const waitReady = async (view) => {
  let d = null;
  for (let i = 0; i < 160; i++) { d = await dbg(); if (d && (d.failed || (d.ready && (!view || d.view === view)))) break; await sleep(250); }
  return d;
};
// (Amazing Grace in Both, as these checks were written — E1 opens a song with no view chosen in its
// Full score: chosen from another page of the site, as Play writes its own record when it's left)
const agBoth = async () => {
  await j("POST", `/session/${sid}/url`, { url: ROOT + "resonate/tools.html" });
  await ex(`const all = JSON.parse(localStorage.getItem("resonate.play") || "{}"); all["amazing-grace"] = { ...(all["amazing-grace"] || {}), view: "both" }; localStorage.setItem("resonate.play", JSON.stringify(all)); return 1`);
};
try {
  await j("POST", `/session/${sid}/window/rect`, { width: 1024, height: 1300 }).catch(() => {});
  await agBoth();
  await j("POST", `/session/${sid}/url`, { url: ROOT + "tmp/play-wk.html" });
  let d = await waitReady();
  console.log("UA", await ex("return navigator.userAgent"));
  console.log(JSON.stringify({ ...d, peekLog: undefined }));
  ok(d && d.ready && !d.failed && d.song === "amazing-grace", "ready on Amazing Grace");
  ok(d && d.rendered > 0, `notes drawn: ${d && d.rendered}`);
  // v80: the keyboard docked under the music (a desktop: on), the music laid out above it; 🎹 off
  // and on again lays it out at the new height at once
  {
    const kb = await ex(`const d = window.resonateDebug().play, st = document.getElementById("stage").getBoundingClientRect(), dk = document.getElementById("dock").getBoundingClientRect(); let bottom = 0; for (const p of document.querySelectorAll("#stage .page")) bottom = Math.max(bottom, p.getBoundingClientRect().bottom); return { keys: d.keys, H: d.H, stage: st.bottom, dock: [dk.top, dk.height], bottom, hands: document.getElementById("hands").getBoundingClientRect().width }`);
    ok(kb.keys.on && kb.keys.shown && kb.stage <= kb.dock[0] + 0.5 && kb.bottom <= kb.stage + 0.5 && kb.keys.range && kb.keys.lit.length === 0, `keyboard docked: ${JSON.stringify(kb.keys.range)}, stage ends ${kb.stage.toFixed(1)} ≤ dock ${kb.dock[0].toFixed(1)}, pages end ${kb.bottom.toFixed(1)}`);
    const off = await ex(`document.getElementById("keys").click(); const d = window.resonateDebug().play; return { shown: d.keys.shown, H: d.H, pref: localStorage.getItem("resonate.play.keys") }`);
    ok(!off.shown && Math.abs(off.H - (kb.H + kb.dock[1])) <= 1 && off.pref === "off", `🎹 off: laid out at once at ${off.H} (${kb.H} + ${kb.dock[1].toFixed(1)})`);
    const on = await ex(`document.getElementById("keys").click(); const d = window.resonateDebug().play; return { shown: d.keys.shown, H: d.H }`);
    ok(on.shown && on.H === kb.H, `🎹 on again: ${on.H}`);
    await ex(`localStorage.removeItem("resonate.play.keys"); return 1`);
  }
  // bigger staves until there are pages to turn (the window may be large)
  for (let i = 0; i < 6 && d.pages < 3; i++) {
    const dis = await ex(`const b = document.getElementById("bigger"); if (b.disabled) return true; b.click(); return false;`);
    if (dis) break;
    await sleep(400);
    d = await dbg();
  }
  console.log("size", JSON.stringify({ sp: d.sp, pages: d.pages, W: await ex("return innerWidth"), H: await ex("return innerHeight") }));
  ok(d.pages >= 2, `pages to turn: ${d.pages}`);
  const all = await ex(`return window.resonateDebug().play.countAll()`);
  ok(all.rendered === all.pitched && all.pitched === 162, `every page: drawn ${all.rendered} = ${all.pitched}`);
  const badges = await ex(`return [...document.querySelectorAll("#stage .nn")].filter((n) => getComputedStyle(n).display !== "none").length`);
  ok(badges === d.rendered, `badges shown at All: ${badges}`);
  // (the screen wake lock: WebKit grants it only in a user gesture, or after one grant in this
  // document — opening the page and −/+ clicked from a script got none)
  const wake0 = await ex(`return window.resonateDebug().play.wake`);
  await key(""); // ArrowRight
  await sleep(300);
  d = await dbg();
  ok(d.page === 2, `ArrowRight → page ${d.page}`);
  if (await ex(`return !!navigator.wakeLock`)) {
    const wake1 = await ex(`return window.resonateDebug().play.wake`);
    ok(!wake0.held && wake0.requests >= 1 && wake1.held, `wake lock: not held after opening (${JSON.stringify(wake0)}), held after the pedal's key (${JSON.stringify(wake1)})`);
    await ex(`document.dispatchEvent(new Event("visibilitychange")); return 1`); // (dropped, asked again with no gesture)
    await sleep(400);
    const wake2 = await ex(`return window.resonateDebug().play.wake`);
    ok(wake2.held && wake2.requests > wake1.requests, `wake lock asked again with no gesture after one grant: held (${JSON.stringify(wake2)})`);
  } else console.log("(no navigator.wakeLock in this WebKit: skipped)");
  await ex(`document.getElementById("names").click(); return 1`);
  const some = await ex(`return [document.getElementById("stage").dataset.names, [...document.querySelectorAll("#stage .nn")].filter((n) => getComputedStyle(n).display !== "none").length, document.querySelectorAll("#stage .nn").length]`);
  ok(some[0] === "some" && some[1] < some[2], `names Some: ${some}`);
  await ex(`document.getElementById("names").click(); return 1`);
  await ex(`const h = document.getElementById("hands"); h.value = "rh"; h.dispatchEvent(new Event("change", { bubbles: true })); return 1`);
  d = await waitReady("rh");
  ok(d.ready && d.view === "rh" && d.rendered > 0, `RH: ${d.view} ${d.rendered} notes, page ${d.page}`);
  await ex(`const h = document.getElementById("hands"); h.value = "both"; h.dispatchEvent(new Event("change", { bubbles: true })); return 1`);
  d = await waitReady("both");
  ok(d.page === 2, `back to Both at page ${d.page}`);
  // a mouse press on a note: the peek (names, strip), no turn
  const h = await ex(`const st = document.getElementById("stage").getBoundingClientRect(); for (const g of document.querySelectorAll("#stage g.note > g.notehead")) { const b = g.getBoundingClientRect(); const x = b.left + b.width / 2; if (x > st.left + st.width * 0.8) return [x, b.top + b.height / 2]; } return null;`);
  if (!h) ok(false, "a note in the right quarter");
  else {
    await j("POST", `/session/${sid}/actions`, { actions: [{ type: "pointer", id: "m", parameters: { pointerType: "mouse" }, actions: [{ type: "pointerMove", x: Math.round(h[0]), y: Math.round(h[1]), duration: 0 }, { type: "pointerDown", button: 0 }, { type: "pause", duration: 900 }] }] });
    const pk = await ex(`const d = window.resonateDebug().play; return { peek: d.peek, bubble: document.getElementById("bubble").classList.contains("on") && document.getElementById("bubble").textContent, strip: !document.getElementById("dock").hidden && document.querySelectorAll("#strip rect.lit").length, audio: d.audio }`);
    await j("POST", `/session/${sid}/actions`, { actions: [{ type: "pointer", id: "m", parameters: { pointerType: "mouse" }, actions: [{ type: "pointerUp", button: 0 }] }] });
    console.log(JSON.stringify(pk));
    ok(pk.peek && pk.bubble && /\d/.test(pk.bubble) && pk.strip, `peek: "${pk.bubble}", strip ${pk.strip}`);
    await sleep(400);
    d = await dbg();
    ok(d.page === 2, `the peek's lift doesn't turn (page ${d.page})`);
    console.log("peekLog", JSON.stringify(d.peekLog), "audio", JSON.stringify(d.audio));
  }
  // a click in the left quarter, away from notes: no turn (v79: ‹ › and the keys turn); then ‹ → page 1
  const pt = await ex(`const st = document.getElementById("stage").getBoundingClientRect();
    const heads = [...document.querySelectorAll("#stage g.note > g.notehead")].map((h) => { const b = h.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    const x = st.left + st.width * 0.08;
    for (let y = st.top + 20; y < st.bottom - 20; y += 7) if (heads.every(([hx, hy]) => Math.hypot(hx - x, hy - y) >= 40)) return [x, y];
    return null;`);
  if (pt) {
    await mouse(pt[0], pt[1]); await sleep(300); d = await dbg(); ok(d.page === 2, `left-quarter click: no turn (page ${d.page})`);
    await ex(`document.getElementById("prev").click(); return 1`); await sleep(300); d = await dbg(); ok(d.page === 1, `‹ → page ${d.page}`);
  } else ok(false, "an off-note spot in the left quarter");
  const err = await ex("return window.__err");
  ok(Array.isArray(err) && !err.length, `no errors: ${JSON.stringify(err)}`);
} finally {
  await j("DELETE", `/session/${sid}`);
}
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
