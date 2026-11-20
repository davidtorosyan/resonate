// WebKitGTK (Safari stand-in) smoke for the Play page: open, ready, notes drawn, ArrowRight → page 2,
// a tap in the right quarter → page 3, no errors. Needs Xvfb :99 + WebKitWebDriver on :4444 (/home/user/xb).
// usage: node playwk.mjs   (BASE=http://localhost:8097/resonate/)
const BASE = process.env.BASE || "http://localhost:8097/resonate/";
const W = "http://127.0.0.1:4444";
const j = async (method, path, body) => (await fetch(W + path, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) })).json();
const s = await j("POST", "/session", { capabilities: { alwaysMatch: { browserName: "MiniBrowser", "webkitgtk:browserOptions": { binary: "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser", args: ["--automation"] } } } });
const sid = s.value.sessionId;
const ex = async (script) => (await j("POST", `/session/${sid}/execute/sync`, { script, args: [] })).value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fails++; };
try {
  await j("POST", `/session/${sid}/window/rect`, { width: 1024, height: 1200 }).catch(() => {});
  // errors from the very start: an init page records them, then navigates
  await j("POST", `/session/${sid}/url`, { url: BASE + "play.html" });
  await ex(`window.__err = []; window.addEventListener("error", (e) => window.__err.push(e.message)); window.addEventListener("unhandledrejection", (e) => window.__err.push("rejection " + (e.reason && e.reason.message))); return 1;`);
  let d = null;
  for (let i = 0; i < 120; i++) {
    d = await ex(`const d = window.resonateDebug && window.resonateDebug().play; return d && { ready: d.ready, failed: d.failed, page: d.page, pages: d.pages, rendered: d.counts.rendered, pitched: d.counts.pitched, t: d.t, sp: d.sp, W: d.W, H: d.H, song: d.song };`);
    if (d && (d.ready || d.failed)) break;
    await sleep(250);
  }
  console.log("UA", await ex("return navigator.userAgent"));
  console.log(JSON.stringify(d));
  ok(d && d.ready && !d.failed, "ready");
  ok(d && d.rendered > 0, `notes drawn: ${d && d.rendered}`);
  const badges = await ex(`return document.querySelectorAll("#stage .nn").length`);
  ok(badges > 0, `badges: ${badges}`);
  // ArrowRight via WebDriver key actions (a real key event)
  await j("POST", `/session/${sid}/actions`, { actions: [{ type: "key", id: "k", actions: [{ type: "keyDown", value: "" }, { type: "keyUp", value: "" }] }] });
  await sleep(400);
  d = await ex(`const d = window.resonateDebug().play; return { page: d.page, at: d.at, rendered: d.counts.rendered }`);
  ok(d.page === 2, `ArrowRight → page ${d.page}`);
  // a click in the left quarter (back to 1), then the right quarter (2), away from the notes
  const tap = async (fx, want) => {
    const pt = await ex(`const st = document.getElementById("stage").getBoundingClientRect();
      const heads = [...document.querySelectorAll("#stage g.note > g.notehead")].map((h) => { const b = h.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
      const x = st.left + st.width * ${fx};
      for (let y = st.top + 20; y < st.bottom - 20; y += 7) if (heads.every(([hx, hy]) => Math.hypot(hx - x, hy - y) >= 40)) return [Math.round(x), Math.round(y)];
      return null;`);
    if (!pt) return ok(false, "no off-note spot at " + fx);
    await j("POST", `/session/${sid}/actions`, { actions: [{ type: "pointer", id: "m", parameters: { pointerType: "mouse" }, actions: [
      { type: "pointerMove", x: pt[0], y: pt[1], duration: 0 }, { type: "pointerDown", button: 0 }, { type: "pause", duration: 60 }, { type: "pointerUp", button: 0 }] }] });
    await sleep(400);
    const p = await ex(`return window.resonateDebug().play.page`);
    ok(p === want, `tap at ${fx} W → page ${p} (want ${want})`);
  };
  await tap(0.08, 1);
  await tap(0.92, 2);
  const err = await ex("return window.__err");
  ok(!err.length, `no errors: ${JSON.stringify(err)}`);
} finally {
  await j("DELETE", `/session/${sid}`);
}
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
