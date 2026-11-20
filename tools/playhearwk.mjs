// WebKitGTK (Safari stand-in) smoke for what ▶ plays (v80, the chips): play.html copied to
// /home/user/sitetest/tmp/playhear-wk.html with an error recorder and <base href="/resonate/">.
// Amazing Grace's Both: RH / LH chips in the dock left of the keys (a desktop: the keyboard on);
// a click on LH mutes it (saved per song and view); ▶ → only the right hand struck, the left hand's
// notes never lit (v86: v80 lit them lighter, .hush), never on the keyboard; a click on LH while
// playing unmutes it — the left
// hand struck again; the last one heard can't be muted; the score-pvg fixture's Full score: Voice /
// Piano / Guitar chips, Voice and Guitar muted → only the piano; the keyboard off: the chips in the
// stretch's controls while ▶ plays; no errors.
// Needs Xvfb :99 + WebKitWebDriver on :4444 (/home/user/xb).
// usage: node playhearwk.mjs   (BASE=http://localhost:8097/)
import fs from "node:fs";
const ROOT = process.env.BASE || "http://localhost:8097/";
const SRC = "/home/user/resonate/public/play.html", OUT = "/home/user/sitetest/tmp/playhear-wk.html";
const FIX = "/home/user/tools/fixtures/play/score-pvg.musicxml";
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
const ex = async (script, args = []) => (await j("POST", `/session/${sid}/execute/sync`, { script, args })).value;
const exa = async (script, args = []) => (await j("POST", `/session/${sid}/execute/async`, { script, args })).value;
const find = async (css) => (await j("POST", `/session/${sid}/element`, { using: "css selector", value: css })).value;
const click = async (css) => { const e = await find(css); const id = e && Object.values(e)[0]; return j("POST", `/session/${sid}/element/${id}/click`, {}); };
const waitFor = async (script, ms = 15000) => { const t0 = Date.now(); for (;;) { if (await ex(script)) return true; if (Date.now() - t0 > ms) return false; await sleep(150); } };
const hear = () => ex("const h = window.resonateDebug().play.playback.hear; return { groups: h.groups, muted: h.muted, home: h.home, shown: h.shown, chips: h.chips, saved: h.saved };");
const setView = async (v) => { await ex(`const h = document.getElementById("hands"); h.value = "${v}"; h.dispatchEvent(new Event("change", { bubbles: true })); return 1`); return waitFor(`const d = window.resonateDebug().play; return d.ready && d.view === "${v}";`, 30000); };
const struckParts = () => ex("const p = window.resonateDebug().play; return p.playback.scheduled.map((e) => p.facts[e.id]?.part + '|' + p.facts[e.id]?.staff);");
try {
  await j("POST", `/session/${sid}/window/rect`, { width: 1024, height: 1300 }).catch(() => {});
  await j("POST", `/session/${sid}/url`, { url: ROOT + "tmp/playhear-wk.html" });
  ok(await waitFor("const d = window.resonateDebug && window.resonateDebug().play; return !!(d && d.ready);", 40000), "ready on Amazing Grace");
  await ex("localStorage.removeItem('resonate.play'); return 1");
  // Both: RH / LH in the dock
  await setView("both");
  let h = await hear();
  const geo = await ex(`const r = (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; }; return { strip: r(document.getElementById("strip")), dock: r(document.getElementById("dock")) };`);
  ok(JSON.stringify(h.groups.map((g) => g.label + ":" + g.key)) === '["RH:P1","LH:P2"]' && h.home === "dock" && h.shown && h.chips.every((c) => c.pressed && c.rect[0] + c.rect[2] <= geo.strip[0] + 0.5 && c.rect[3] >= 43.5), `Both: RH / LH chips in the dock left of the keys (${JSON.stringify(h.chips.map((c) => [c.label, c.rect.map(Math.round)]))})`);
  await click('#hear button[data-key="P2"]');
  h = await hear();
  ok(JSON.stringify(h.muted) === '["P2"]' && JSON.stringify(h.saved) === '{"both":["P2"]}' && !h.chips.find((c) => c.key === "P2").pressed, `LH muted, saved ${JSON.stringify(h.saved)}`);
  await click('#hear button[data-key="P1"]');
  h = await hear();
  ok(JSON.stringify(h.muted) === '["P2"]' && h.chips.find((c) => c.key === "P1").pressed, "the last one heard stays on");
  // ▶: only the right hand; the left hand never lit, on the page or the keyboard
  await click("#play");
  ok(await waitFor("const x = window.resonateDebug().play.playback; return x.state === 'playing' && x.scheduled.length > 3;", 15000), "▶ playing");
  let hushSeen = 0, lhKey = 0, lhLit = 0, lit = 0;
  for (let i = 0; i < 16; i++) {
    await sleep(150);
    const x = await ex("const p = window.resonateDebug().play, x = p.playback; return { hush: x.hushEls.length, keys: x.strip.map((k) => k.hand), lh: x.litEls.filter((id) => p.facts[id]?.part === 'P2').length, lit: x.litEls.length };");
    if (x.hush) hushSeen++;
    lhLit += x.lh;
    lit += x.lit;
    if (x.keys.includes("lh")) lhKey++;
  }
  let parts = await struckParts();
  ok(parts.length > 0 && parts.every((p) => p.startsWith("P1|")) && hushSeen === 0 && lhLit === 0 && lit > 0 && lhKey === 0, `only the right hand struck (${parts.length}) and lit (${lit}), the left hand never lit (${hushSeen} .hush samples, ${lhLit} .play), never on the keyboard (${lhKey})`);
  // unmute while playing: the left hand struck again
  const tu = await ex("return window.resonateDebug().play.playback.now");
  await click('#hear button[data-key="P2"]');
  await sleep(2500);
  const after = await ex(`const p = window.resonateDebug().play; return p.playback.scheduled.filter((e) => e.when > ${tu} + 0.06).map((e) => p.facts[e.id]?.part);`);
  ok(after.includes("P2") && after.includes("P1"), `LH unmuted while playing: struck again (${after.filter((x) => x === "P2").length} LH, ${after.filter((x) => x === "P1").length} RH)`);
  await click("#play");
  await sleep(300);
  ok(await ex("const x = window.resonateDebug().play.playback; return x.state === 'idle' && !x.litEls.length && !x.hushEls.length;"), "■: idle, nothing lit");
  // the score-pvg fixture's Full score: Voice / Piano / Guitar
  const xml = fs.readFileSync(FIX, "utf8");
  const id = await exa(`const done = arguments[arguments.length - 1]; import("./library.js?v=79").then((L) => L.addSong("score-pvg", arguments[0], { source: "file" })).then(done, (e) => done("ERR " + e));`, [xml]);
  await ex(`localStorage.setItem("resonate.sing.song", "${id}"); return 1`);
  await j("POST", `/session/${sid}/url`, { url: ROOT + "tmp/playhear-wk.html" });
  ok(await waitFor(`const d = window.resonateDebug && window.resonateDebug().play; return !!(d && d.ready && d.song === "${id}");`, 40000), "score-pvg open");
  await setView("score");
  h = await hear();
  ok(JSON.stringify(h.groups.map((g) => g.label + ":" + g.hand)) === '["Voice:voice","Piano:piano","Guitar:part"]', `Full score: ${JSON.stringify(h.groups.map((g) => g.label + ":" + g.hand))}`);
  await click('#hear button[data-key="P1"]');
  await click('#hear button[data-key="P3"]');
  await click("#play");
  await waitFor("const x = window.resonateDebug().play.playback; return x.state === 'playing' && x.scheduled.length > 3;", 15000);
  await sleep(1500);
  parts = await struckParts();
  ok(parts.length > 0 && parts.every((p) => p.startsWith("P2|")), `Voice and Guitar muted: only the piano struck (${parts.length})`);
  await click("#play");
  await sleep(200);
  // the keyboard off: the chips in the stretch's controls while ▶ plays
  await click("#keys");
  await waitFor("return window.resonateDebug().play.ready && !window.resonateDebug().play.keys.shown", 15000);
  h = await hear();
  ok(h.home === "selbar" && !h.shown, `🎹 off, idle: the chips wait in the stretch's controls (${h.home}, shown ${h.shown})`);
  await click("#play");
  await waitFor("return window.resonateDebug().play.playback.state === 'playing'", 15000);
  h = await hear();
  ok(h.home === "selbar" && h.shown && h.chips.length === 3, `▶ with 🎹 off: the chips in the controls (${h.home}, ${h.shown})`);
  await click('#hear button[data-key="P1"]');
  h = await hear();
  ok(JSON.stringify(h.muted) === '["P3"]', `a click there unmutes the voice while playing (${JSON.stringify(h.muted)})`);
  await click("#play");
  await click("#keys");
  await waitFor("return window.resonateDebug().play.ready && window.resonateDebug().play.keys.shown", 15000);
  await ex("localStorage.removeItem('resonate.play'); localStorage.removeItem('resonate.sing.song'); return 1");
  const err = await ex("return window.__err");
  ok(Array.isArray(err) && !err.length, `no errors: ${JSON.stringify(err)}`);
} finally {
  await j("DELETE", `/session/${sid}`);
}
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
