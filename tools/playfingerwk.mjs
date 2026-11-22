// Piano fingering in WebKitGTK (Safari stand-in; E7 stage 2, docs/FINGERING.md §8): the shell (index.html
// copied to <site>/tmp/finger-wk.html with an error recorder and <base href="/resonate/">) on the generated
// fixture (fingerfixture.cjs r6: G3 + B4 on the treble staff over the left hand's held C3), the Score with the
// Piano. Checks: the fingering worked out in the Worker (a module Worker in WebKit), kept with the song; a
// press on G3 + B4 (WebDriver mouse actions) lights G3 blue with LH 1 and B4 purple with its digit; the
// ghost hand's rings on a press; while ▶ plays with the rings, no SVG element ever animating (sampled every
// 100 ms, as importfixes.cjs S's svgAnim) — the rings' crossfades are HTML animations; no page errors.
// Needs Xvfb :99 + WebKitWebDriver on :4444 (CLAUDE.md "A fresh container").
// usage: node playfingerwk.mjs   (ROOT=http://localhost:8097/ SITE=/home/user/sitetest)
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const FX = require("./fingerfixture.cjs");
const SITE = process.env.SITE || "/home/user/sitetest";
const ROOT = process.env.ROOT || "http://localhost:8097/";
const INSTR = `<base href="/resonate/"><script>
window.__err=[];addEventListener("error",(e)=>__err.push("error "+e.message+" @"+e.filename+":"+e.lineno));addEventListener("unhandledrejection",(e)=>__err.push("rejection "+(e.reason&&(e.reason.stack||e.reason.message)||e.reason)));const __ce=console.error;console.error=(...a)=>{__err.push("console.error "+a.map(String).join(" "));__ce.apply(console,a)};
</script>`;
fs.mkdirSync(SITE + "/tmp", { recursive: true });
fs.writeFileSync(SITE + "/tmp/finger-wk.html", fs.readFileSync(SITE + "/resonate/index.html", "utf8").replace(/<head>/i, "<head>" + INSTR));

const W = "http://127.0.0.1:4444";
const j = async (method, path, body) => (await fetch(W + path, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0, passes = 0;
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (c) passes++; else fails++; return c; };
const s = await j("POST", "/session", { capabilities: { alwaysMatch: { browserName: "MiniBrowser", "webkitgtk:browserOptions": { binary: "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser", args: ["--automation"] } } } });
const sid = s.value?.sessionId;
if (!sid) { console.log("no WebDriver session", JSON.stringify(s).slice(0, 300)); process.exit(2); }
const ex = async (script, args = []) => (await j("POST", `/session/${sid}/execute/sync`, { script, args })).value;
const exa = async (script, args = []) => (await j("POST", `/session/${sid}/execute/async`, { script, args })).value;
const go = (url) => j("POST", `/session/${sid}/url`, { url });
const until = async (script, ms = 30000, args = []) => {
  let v = null;
  for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) { v = await ex(script, args).catch(() => null); if (v && v.ok) return v; }
  return v;
};
// A mouse press at (x, y): down, `during` (a script run while held), up.
async function press(x, y, during = null, hold = 300) {
  await j("POST", `/session/${sid}/actions`, { actions: [{ type: "pointer", id: "m", parameters: { pointerType: "mouse" }, actions: [{ type: "pointerMove", x: Math.round(x), y: Math.round(y), duration: 0 }, { type: "pointerDown", button: 0 }, { type: "pause", duration: hold }] }] });
  const out = during ? await ex(during) : null;
  await j("POST", `/session/${sid}/actions`, { actions: [{ type: "pointer", id: "m", parameters: { pointerType: "mouse" }, actions: [{ type: "pointerUp", button: 0 }] }] });
  await j("DELETE", `/session/${sid}/actions`).catch(() => {});
  return out;
}
const KEYS = `const s = document.querySelector("#piano-region .kb > svg"); return { lit: [...s.querySelectorAll("rect.lit")].map((r) => [Number(r.dataset.midi), r.dataset.hand, r.getAttribute("fill")]), fd: [...s.querySelectorAll("text.fd")].map((t) => [Number(t.dataset.midi), Number(t.textContent)]), rings: document.querySelectorAll("#piano-region .kb-ghost .kb-gh:not([data-out]) .kb-ring").length };`;
const HEAD = `const g = document.getElementById("nG3"); const h = g && (g.querySelector(".notehead") || g); if (!h) return null; const b = h.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };`;
try {
  await j("POST", `/session/${sid}/window/rect`, { width: 1280, height: 800 }).catch(() => {});
  await go(ROOT + "resonate/tools.html");
  await sleep(1200);
  console.log("UA", await ex("return navigator.userAgent"));
  const id = await exa(`const done = arguments[arguments.length - 1]; (async () => {
    const v = document.getElementById("version").textContent.trim().slice(1);
    const L = await import("./library.js?v=" + v);
    const id = await L.addSong("Fingering R6 (WebKit)", arguments[0], { source: "file" });
    localStorage.setItem("resonate.sing.song", id);
    localStorage.setItem("resonate.shell.modules", JSON.stringify({ phone: ["score", "piano"], tablet: ["score", "piano"], desktop: ["score", "piano"] }));
    localStorage.removeItem("resonate.play.fingers");
    const all = JSON.parse(localStorage.getItem("resonate.play") || "{}"); all[id] = { view: "both" }; localStorage.setItem("resonate.play", JSON.stringify(all));
    done(id);
  })().catch((e) => done("ERR " + e.message));`, [FX.r6({ bpm: 140 })]);
  ok(typeof id === "string" && !id.startsWith("ERR"), `the fixture added (${id})`);
  await go(ROOT + "tmp/finger-wk.html?open=score");
  const r = await until(`const d = window.resonateDebug && window.resonateDebug(); const f = d && d.play && d.play.fing; return f && d.play.ready && (f.state === "ready" || f.state === "none") ? { ok: true, state: f.state, from: f.from, worker: f.worker, main: f.main, notes: f.notes, moved: f.moved, mode: f.mode, shown: d.piano.fing.shown, ww: d.piano.fing.geo && d.piano.fing.geo.ww } : { ok: false, ready: d && d.play && d.play.ready, state: f && f.state };`, 60000);
  ok(r?.ok && r.state === "ready" && r.from === "computed" && r.worker >= 1 && r.main === 0 && r.notes === 26 && r.moved === 1 && r.shown, `the fingering worked out in the Worker, #fing shown (${JSON.stringify(r)})`);
  const kept = await exa(`const done = arguments[arguments.length - 1]; (async () => { const v = document.getElementById("version").textContent.trim().slice(1); const L = await import("./library.js?v=" + v); const s = await L.getSong(arguments[0]); done(s.fing ? Object.keys(s.fing.n).length : 0); })().catch((e) => done("ERR " + e.message));`, [id]);
  ok(kept === 26, `kept with the song (${kept} notes)`);
  // a press on G3 + B4 (numbers)
  let pt = await ex(HEAD);
  const k = pt && await press(pt.x, pt.y, KEYS);
  const fg = await ex(`return window.resonatePlay.fingering().n;`);
  const g3 = (k?.lit || []).find((x) => x[0] === 55), b4 = (k?.lit || []).find((x) => x[0] === 71);
  ok(g3 && g3[1] === "lh" && g3[2] === "#4f7cff" && b4 && b4[1] === "rh", `a press on G3 + B4: G3 blue (left hand), B4 purple (${JSON.stringify(k?.lit)})`);
  ok(JSON.stringify((k?.fd || []).slice().sort((a, b) => a[0] - b[0])) === JSON.stringify([[55, 1], [71, fg.nB4[1]]]), `… G3 LH 1, B4 ${fg.nB4[1]} on the keys (${JSON.stringify(k?.fd)})`);
  await sleep(2600);
  // the ghost hand: a press, then ▶ — no SVG element animating
  await ex(`document.getElementById("fing").click(); return 1;`);
  const mode = await ex(`return document.getElementById("fing").dataset.mode;`);
  pt = await ex(HEAD);
  const kh = await press(pt.x, pt.y, KEYS);
  ok(mode === "hand" && kh?.rings === 10 && !kh.fd.length, `the ghost hand on a press: ${kh?.rings} rings, no discs (${mode})`);
  await sleep(2600);
  const anim = await exa(`const done = arguments[arguments.length - 1]; (async () => {
    window.resonatePlay.playBtn.click();
    let svgAnim = 0, htmlAnim = 0, n = 0;
    const end = performance.now() + 9000;
    while (performance.now() < end) {
      const a = document.getAnimations().filter((x) => x.playState === "running");
      if (a.some((x) => x.effect && x.effect.target instanceof SVGElement)) svgAnim++;
      if (a.some((x) => x.effect && x.effect.target && x.effect.target.classList && x.effect.target.classList.contains("kb-gh"))) htmlAnim++;
      n++;
      await new Promise((r) => setTimeout(r, 100));
    }
    const g = window.resonateDebug().piano.fing.ghost, pb = window.resonateDebug().play.playback;
    done({ svgAnim, htmlAnim, n, frames: g.frames, builds: g.builds, played: pb.scheduled.length, state: pb.state });
  })().catch((e) => done({ err: e.message }));`);
  ok(anim && anim.n > 50 && anim.svgAnim === 0 && anim.played > 10, `▶ with the ghost hand: an SVG element animating in ${anim?.svgAnim} of ${anim?.n} samples (${anim?.played} notes struck)`);
  ok(anim && anim.frames >= 3 && anim.builds === anim.frames, `… the rings built again once per frame change (${anim?.frames} frames, ${anim?.builds} builds; a crossfade seen in ${anim?.htmlAnim} samples)`);
  const errs = await ex("return window.__err || [];");
  ok(!errs.length, `no page errors ${JSON.stringify(errs.slice(0, 3))}`);
} catch (err) {
  console.log("FAIL crashed:", err?.stack || err);
  fails++;
} finally {
  await j("DELETE", `/session/${sid}`).catch(() => {});
}
console.log(fails ? `${fails} failed, ${passes} passed` : `all ${passes} passed`);
process.exit(fails ? 1 : 0);
