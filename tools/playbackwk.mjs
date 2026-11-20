// WebKitGTK (Safari stand-in) smoke for ▶ on the Play page (v79 part B): play.html copied to
// /home/user/sitetest/tmp/playback-wk.html with an error recorder and <base href="/resonate/">.
// ▶ (a WebDriver click: a user gesture) → playing on a running context, notes scheduled, heads lit
// on the page, the strip's keys lit; ■ → idle, nothing lit; a mouse drag over the music → a
// stretch with its bands and controls; its ▶ plays exactly the stretch (once, then idle); ⟳ loops
// (rounds one stretch-length apart); ✕ lets go; the bus's soft limiter holds a thick moment under
// full scale (an OfflineAudioContext in WebKit); + then − is the default again; no errors.
// Needs Xvfb :99 + WebKitWebDriver on :4444 (/home/user/xb).
// usage: node playbackwk.mjs   (BASE=http://localhost:8097/)
import fs from "node:fs";
const ROOT = process.env.BASE || "http://localhost:8097/";
const SRC = "/home/user/resonate/public/play.html", OUT = "/home/user/sitetest/tmp/playback-wk.html";
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
const find = async (css) => (await j("POST", `/session/${sid}/element`, { using: "css selector", value: css })).value;
const click = async (css) => { const e = await find(css); const id = e && Object.values(e)[0]; return j("POST", `/session/${sid}/element/${id}/click`, {}); };
const exa = async (script) => (await j("POST", `/session/${sid}/execute/async`, { script, args: [] })).value;
const pb = () => ex(`const x = window.resonateDebug().play.playback; return { state: x.state, kind: x.kind, starting: x.starting, n: x.scheduled.length, rounds: [...new Set(x.scheduled.map((e) => e.round))], len: x.len, span: x.span, lit: x.lit.length, litEls: x.litEls.length, strip: x.strip.length, bands: x.bands.length, selbar: x.selbar, audio: window.resonateDebug().play.audio, tempo: x.tempo };`);
const waitFor = async (script, ms = 15000) => { const t0 = Date.now(); for (;;) { if (await ex(script)) return true; if (Date.now() - t0 > ms) return false; await sleep(150); } };
try {
  await j("POST", `/session/${sid}/window/rect`, { width: 1024, height: 1300 }).catch(() => {});
  await j("POST", `/session/${sid}/url`, { url: ROOT + "tmp/playback-wk.html" });
  ok(await waitFor("const d = window.resonateDebug && window.resonateDebug().play; return !!(d && d.ready);", 40000), "ready on Amazing Grace");
  console.log("UA", await ex("return navigator.userAgent"));
  // ▶ from the page
  await click("#play");
  const played = await waitFor("const x = window.resonateDebug().play.playback; return x.state === 'playing' && x.litEls.length > 0;", 15000);
  let x = await pb();
  console.log(JSON.stringify(x));
  ok(played && x.audio?.state === "running" && x.n > 0 && x.litEls === x.lit && x.strip > 0, `▶: playing on a running context, ${x.n} notes scheduled, ${x.litEls} heads and ${x.strip} keys lit`);
  ok(Math.abs((await ex("return window.resonateDebug().play.playback.bus")) - 0.8) < 1e-6, "▶ through the bus (gain 0.8, a soft limiter)");
  await sleep(1200);
  const y = await pb();
  ok(y.state === "playing" && y.n > x.n, `still playing, more scheduled (${x.n} → ${y.n})`);
  await click("#play");
  await sleep(300);
  x = await pb();
  ok(x.state === "idle" && x.lit === 0 && x.litEls === 0, `■: idle, nothing lit (${x.state})`);
  // a mouse drag over the first system: a stretch
  const pts = await ex(`const g = window.resonateDebug().play.playback.geo()[0]; const s = g.systems[0]; const c = (i) => [g.rect[0] + (s.cols[i][1] + s.cols[i][2]) / 2, g.rect[1] + (s.top + s.bottom) / 2]; return [c(2), c(Math.min(s.cols.length - 1, 9))];`);
  const steps = Array.from({ length: 8 }, (_, i) => ({ type: "pointerMove", x: Math.round(pts[0][0] + ((pts[1][0] - pts[0][0]) * (i + 1)) / 8), y: Math.round(pts[0][1] + ((pts[1][1] - pts[0][1]) * (i + 1)) / 8), duration: 30 }));
  await j("POST", `/session/${sid}/actions`, { actions: [{ type: "pointer", id: "m", parameters: { pointerType: "mouse" }, actions: [
    { type: "pointerMove", x: Math.round(pts[0][0]), y: Math.round(pts[0][1]), duration: 0 }, { type: "pointerDown", button: 0 }, ...steps, { type: "pause", duration: 100 }, { type: "pointerUp", button: 0 }] }] });
  await sleep(300);
  x = await pb();
  console.log(JSON.stringify(x));
  ok(x.span && x.bands >= 1 && x.selbar, `a mouse drag: a stretch ${JSON.stringify(x.span)}, ${x.bands} band(s), its controls`);
  await click("#sel-play");
  ok(await waitFor("return window.resonateDebug().play.playback.state === 'playing'", 8000), "its ▶ plays");
  ok(await waitFor("return window.resonateDebug().play.playback.state === 'idle'", 30000), "… once, then stops");
  x = await pb();
  ok(x.span && x.kind === null, `the stretch kept (${JSON.stringify(x.span)})`);
  await click("#sel-loop");
  ok(await waitFor("return window.resonateDebug().play.playback.round >= 2", 30000), "⟳: round after round");
  const r = await ex(`const x = window.resonateDebug().play.playback; const a = x.scheduled.filter((e) => e.round === 0), b = x.scheduled.filter((e) => e.round === 1); return { len: x.len, d: b.length && a.length ? b[0].when - a[0].when : null, n0: a.length, n1: b.length, state: x.state };`);
  ok(r.state === "looping" && Math.abs(r.d - r.len) < 1e-6 && r.n0 === r.n1, `rounds one stretch apart: ${JSON.stringify(r)}`);
  await click("#sel-clear");
  await sleep(300);
  x = await pb();
  ok(x.state === "idle" && !x.span && !x.selbar && x.bands === 0, `✕: stopped, let go (${x.state})`);
  // the bus in WebKit (v79 review): a thick moment — six keys struck twice each, at the levels ▶
  // gives them — straight to the output goes past full scale; through pianoBus it doesn't
  const lim = await exa(`const done = arguments[arguments.length - 1];
    (async () => {
      const { loadPiano, playPiano, pianoBus } = await import("./piano.js?v=78");
      const render = async (bus) => {
        const ac = new OfflineAudioContext(1, 44100, 44100), piano = await loadPiano(ac);
        const dest = bus ? pianoBus(ac, 0.8) : ac.destination;
        for (const m of [48, 55, 60, 64, 67, 72]) for (let k = 0; k < 2; k++) playPiano(ac, piano, 0.05, 0.8, m, Math.min(1.2, 4 / 13), [], dest);
        for (const m of [60, 64, 67, 72]) playPiano(ac, piano, 0.05, 0.8, m, 1.2, [], dest);
        const x = (await ac.startRendering()).getChannelData(0);
        let p = 0; for (const v of x) p = Math.max(p, Math.abs(v));
        return p;
      };
      done({ raw: await render(false), bus: await render(true) });
    })().catch((e) => done({ err: String(e) }));`);
  ok(lim && lim.raw > 1 && lim.bus < 1, `WebKit: a thick moment peaks ${lim?.raw?.toFixed(3)} straight out, ${lim?.bus?.toFixed(3)} through the bus ${lim?.err || ""}`);
  // − / + are steps from the default: + then − is the default again, its pref removed
  const sz0 = await ex("const d = window.resonateDebug().play; return { sp: d.sp, step: d.step };");
  await click("#bigger");
  await waitFor("return window.resonateDebug().play.step === 1 && window.resonateDebug().play.ready", 15000);
  const sz1 = await ex("const d = window.resonateDebug().play; return { sp: d.sp, step: d.step, key: localStorage.getItem('resonate.play.zoom') };");
  await click("#smaller");
  await waitFor("return window.resonateDebug().play.step === 0 && window.resonateDebug().play.ready", 15000);
  const sz2 = await ex("const d = window.resonateDebug().play; return { sp: d.sp, step: d.step, key: localStorage.getItem('resonate.play.zoom') };");
  ok(sz1.step === 1 && sz1.key === "+1" && sz1.sp > sz0.sp && sz2.step === 0 && sz2.key === null && Math.abs(sz2.sp - sz0.sp) < 1e-6, `− / + steps: ${JSON.stringify([sz0, sz1, sz2])}`);
  const err = await ex("return window.__err");
  ok(Array.isArray(err) && !err.length, `no errors: ${JSON.stringify(err)}`);
} finally {
  await j("DELETE", `/session/${sid}`);
}
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
