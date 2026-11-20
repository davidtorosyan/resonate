// WebKitGTK (Safari stand-in): a press on a note sounds at once (Play v80). play.html copied to
// <site>/tmp/press-wk.html with an error recorder, <base href="/resonate/"> and footprints (the
// pointerdown's timeStamp and dispatch, every buffer source's start, every .peek class and layout
// read); mouse presses via WebDriver actions on the owner's Full scores (Killing Me Softly, Piano
// Man) at 820×1180 — or Amazing Grace when PLAY_SCORES is empty. Checks: each press strikes inside
// its pointerdown's dispatch, at the context's current time, before any class written or rect read;
// the keep-awake source on after the first press; no errors. Prints the lag (event timeStamp →
// the source's start). SITE/ROOT point it at another version (e.g. v79) to measure that from
// outside (checks off: CHECK=0).
// Needs Xvfb :99 + WebKitWebDriver on :4444 (/home/user/xb).
// usage: node playpresswk.mjs   (ROOT=http://localhost:8097/ SITE=/home/user/sitetest PLAY_SCORES=… CHECK=1)
import fs from "node:fs";
const SITE = process.env.SITE || "/home/user/sitetest";
const ROOT = process.env.ROOT || "http://localhost:8097/";
const SCORES = process.env.PLAY_SCORES ?? "/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/play/scores";
const CHECK = process.env.CHECK !== "0";
const N = Number(process.env.N || 16);
const INSTR = `<base href="/resonate/"><script>
window.__err=[];addEventListener("error",(e)=>__err.push("error "+e.message+" @"+e.filename+":"+e.lineno));addEventListener("unhandledrejection",(e)=>__err.push("rejection "+(e.reason&&(e.reason.stack||e.reason.message)||e.reason)));const __ce=console.error;console.error=(...a)=>{__err.push("console.error "+a.map(String).join(" "));__ce.apply(console,a)};
window.__m = { seq: 0, pd: [], starts: [], adds: [], reads: [], cs: 0 };
addEventListener("pointerdown", (e) => { __m.pd.push({ ts: e.timeStamp, cap: performance.now(), seq: ++__m.seq }); }, true);
addEventListener("pointerdown", () => { const p = __m.pd[__m.pd.length - 1]; if (p) { p.bub = performance.now(); p.bseq = ++__m.seq; } }, false);
const __S = AudioBufferSourceNode.prototype.start;
AudioBufferSourceNode.prototype.start = function (when = 0, ...a) { __m.starts.push({ t: performance.now(), when, ct: this.context.currentTime, seq: ++__m.seq }); return __S.call(this, when, ...a); };
const __A = DOMTokenList.prototype.add;
DOMTokenList.prototype.add = function (...t) { if (t.includes("peek")) __m.adds.push({ seq: ++__m.seq }); return __A.apply(this, t); };
const __R = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function () { __m.reads.push({ seq: ++__m.seq }); return __R.call(this); };
if (window.ConstantSourceNode) { const __C = ConstantSourceNode.prototype.start; ConstantSourceNode.prototype.start = function (...a) { __m.cs++; return __C.apply(this, a); }; }
</script>`;
fs.mkdirSync(SITE + "/tmp", { recursive: true });
fs.writeFileSync(SITE + "/tmp/press-wk.html", fs.readFileSync(SITE + "/resonate/play.html", "utf8").replace(/<head>/i, "<head>" + INSTR));

const W = "http://127.0.0.1:4444";
const j = async (method, path, body) => (await fetch(W + path, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { if (!CHECK) return; console.log(c ? "PASS" : "FAIL", m); if (!c) fails++; };
const s = await j("POST", "/session", { capabilities: { alwaysMatch: { browserName: "MiniBrowser", "webkitgtk:browserOptions": { binary: "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser", args: ["--automation"] } } } });
const sid = s.value?.sessionId;
if (!sid) { console.log("no WebDriver session", JSON.stringify(s).slice(0, 300)); process.exit(2); }
const ex = async (script, args = []) => (await j("POST", `/session/${sid}/execute/sync`, { script, args })).value;
const exa = async (script, args = []) => (await j("POST", `/session/${sid}/execute/async`, { script, args })).value;
const press = (x, y, hold = 200) => j("POST", `/session/${sid}/actions`, { actions: [{ type: "pointer", id: "m", parameters: { pointerType: "mouse" }, actions: [
  { type: "pointerMove", x: Math.round(x), y: Math.round(y), duration: 0 }, { type: "pointerDown", button: 0 }, { type: "pause", duration: hold }, { type: "pointerUp", button: 0 }] }] });
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const r1 = (x) => Math.round(x * 10) / 10;
try {
  await j("POST", `/session/${sid}/window/rect`, { width: 820, height: 1180 }).catch(() => {});
  console.log("UA", await (async () => { await j("POST", `/session/${sid}/url`, { url: ROOT + "resonate/tools.html" }); await sleep(1200); return ex("return navigator.userAgent"); })());
  const songs = SCORES && fs.existsSync(SCORES + "/killing.musicxml") ? ["killing", "pianoman"] : [];
  const ids = songs.length ? await exa(`const done = arguments[arguments.length - 1]; (async () => {
    const v = document.getElementById("version").textContent.trim().slice(1);
    const L = await import("./library.js?v=" + v);
    const out = {};
    for (const [n, xml] of arguments[0]) out[n] = await L.addSong(n, xml, { source: "file" });
    done(out);
  })().catch((e) => done("ERR " + e.message));`, [songs.map((n) => [n, fs.readFileSync(`${SCORES}/${n}.musicxml`, "utf8")])]) : {};
  for (const name of songs.length ? songs : ["amazing-grace"]) {
    const id = ids[name] || name, view = songs.length ? "score" : "both";
    await ex(`const [id, view] = arguments; localStorage.setItem("resonate.sing.song", id); const all = JSON.parse(localStorage.getItem("resonate.play") || "{}"); all[id] = { ...(all[id] || {}), view }; localStorage.setItem("resonate.play", JSON.stringify(all));`, [id, view]);
    await j("POST", `/session/${sid}/url`, { url: ROOT + "tmp/press-wk.html" });
    let rd = false;
    for (let i = 0; i < 240 && !rd; i++) { rd = await ex(`const d = window.resonateDebug && window.resonateDebug().play; return !!(d && d.ready && d.view === arguments[0]);`, [view]); if (!rd) await sleep(250); }
    ok(rd, `${name}: ready in ${view}`);
    await sleep(900);
    const spot = await ex(`const st = document.getElementById("stage").getBoundingClientRect();
      const hs = [...document.querySelectorAll("#stage g.note > g.notehead")].map((h) => { const b = h.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
      for (let y = st.top + 20; y < st.bottom - 20; y += 7) for (const x of [st.left + st.width * 0.95, st.left + 8]) if (hs.every(([hx, hy]) => Math.hypot(hx - x, hy - y) >= 40)) return { x, y };
      return null;`);
    await press(spot.x, spot.y, 50);
    await sleep(1500);
    const cs0 = await ex(`return __m.cs`);
    const heads = await ex(`const n = arguments[0]; const all = [...document.querySelectorAll("#stage g.note > g.notehead")].map((h) => { const b = h.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
      const step = Math.max(1, Math.floor(all.length / n)); return all.filter((_, i) => i % step === 0).slice(0, n);`, [N]);
    const rows = [];
    for (const h of heads) {
      const m0 = await ex(`return { pd: __m.pd.length, st: __m.starts.length, ad: __m.adds.length, rd: __m.reads.length };`);
      await press(h.x, h.y, 200);
      await sleep(350);
      const r = await ex(`const m0 = arguments[0]; const pd = __m.pd[m0.pd], st = __m.starts[m0.st];
        if (!pd || !st) return null;
        const between = (l) => l.filter((x) => x.seq > pd.seq && x.seq < st.seq).length;
        const log = window.resonateDebug().play.peekLog; const l = log[log.length - 1];
        return { lag: st.t - pd.ts, ahead: st.when - st.ct, handler: pd.bub - pd.cap, inDispatch: pd.bseq != null && st.seq < pd.bseq, adds: between(__m.adds), reads: between(__m.reads), log: l };`, [m0]);
      if (r) rows.push(r);
    }
    const L = rows.map((r) => r.lag);
    const d = await ex(`const d = window.resonateDebug().play; return { audio: d.audio, awake: d.awake || null, t: d.t, err: window.__err, cs: __m.cs };`);
    console.log(`${name} ${view}: n ${rows.length}, lag med/p90/max ${r1(q(L, 0.5))}/${r1(q(L, 0.9))}/${r1(Math.max(...L))} ms, handler med ${r1(q(rows.map((r) => r.handler), 0.5))} ms, ahead ${r1(q(rows.map((r) => r.ahead * 1000), 0.5))} ms, .peek before the sound ${rows.filter((r) => r.adds).length}, rects read before ${rows.filter((r) => r.reads).length}, in the dispatch ${rows.filter((r) => r.inDispatch).length}${rows[0]?.log?.hit != null ? `, nearHead ${r1(q(rows.map((r) => r.log.hit), 0.5))} ms, peek drawing ${d.t?.peek} ms` : ""}; audio ${JSON.stringify(d.audio)}`);
    const bad = rows.filter((r) => !(r.inDispatch && !r.adds && !r.reads && r.ahead <= 0.0005 && r.ahead > -0.01 && r.log?.how === "hold"));
    ok(rows.length >= N - 2 && !bad.length, `${name}: every press strikes in its pointerdown, at the current time, before anything on screen ${bad.length ? JSON.stringify(bad) : ""}`);
    ok(q(L, 0.5) <= 8, `${name}: lag median ${r1(q(L, 0.5))} ms`);
    ok(d.awake?.on && d.cs - cs0 === 1, `${name}: one keep-awake source from the first press (${JSON.stringify(d.awake)}, ${d.cs - cs0} made)`);
    ok(!d.err.length, `${name}: no errors ${JSON.stringify(d.err)}`);
  }
} finally {
  await j("DELETE", `/session/${sid}`);
}
console.log(CHECK ? (fails ? `${fails} failed` : "all passed") : "measured");
process.exit(fails ? 1 : 0);
