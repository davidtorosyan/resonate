// WebKitGTK (Safari stand-in) for the Play page's extras: a peek (names, strip, sound through a real
// AudioContext, hidden 2 s after the lift), the fading chip, the PDF view (pdf.js in WebKit — with a
// scanned JBIG2 PDF when PLAY_PDFS has one, the owner's, never committed). Needs Xvfb :99 +
// WebKitWebDriver on :4444 (/home/user/xb).
// usage: node playextraswk.mjs   (BASE=http://localhost:8097/resonate/)
import fs from "fs";
import path from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { pdfmini } = require("./pdfmini.cjs");
const BASE = process.env.BASE || "http://localhost:8097/resonate/";
const PDFS = process.env.PLAY_PDFS ?? "/root/.claude/uploads/6042bc19-5f16-52ea-a295-8ea17a932323";
const FIX = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures/play");
const W = "http://127.0.0.1:4444";
const j = async (method, p, body) => (await fetch(W + p, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) })).json();
const s = await j("POST", "/session", { capabilities: { alwaysMatch: { browserName: "MiniBrowser", "webkitgtk:browserOptions": { binary: "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser", args: ["--automation"] } } } });
const sid = s.value.sessionId;
const ex = async (script, args = []) => (await j("POST", `/session/${sid}/execute/sync`, { script, args })).value;
const exa = async (script, args = []) => (await j("POST", `/session/${sid}/execute/async`, { script, args })).value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fails++; };
const mouse = (acts) => j("POST", `/session/${sid}/actions`, { actions: [{ type: "pointer", id: "m", parameters: { pointerType: "mouse" }, actions: acts }] });
const key = (value) => j("POST", `/session/${sid}/actions`, { actions: [{ type: "key", id: "k", actions: [{ type: "keyDown", value }, { type: "keyUp", value }] }] });
async function load(url) {
  await j("POST", `/session/${sid}/url`, { url });
  await ex(`window.__err = []; window.addEventListener("error", (e) => window.__err.push(e.message)); window.addEventListener("unhandledrejection", (e) => window.__err.push("rejection " + (e.reason && e.reason.message))); return 1;`);
  for (let i = 0; i < 160; i++) {
    const d = await ex(`const d = window.resonateDebug && window.resonateDebug().play; return d && { ready: d.ready, failed: d.failed, song: d.song };`);
    if (d && (d.ready || d.failed)) return d;
    await sleep(250);
  }
  return null;
}
const seed = (name, xml, pdfB64) => exa(`const [name, xml, b64, done] = arguments;
  import("./library.js?v=76").then(async (L) => {
    const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const id = await L.addSong(name, xml, { source: "pdf", pdf: u.buffer, pdfName: name + ".pdf" });
    localStorage.setItem("resonate.sing.song", id);
    done(id);
  }).catch((e) => done("ERR " + e.message));`, [name, xml, pdfB64]);

try {
  await j("POST", `/session/${sid}/window/rect`, { width: 1024, height: 1200 }).catch(() => {});
  let d = await load(BASE + "play.html");
  ok(d && d.ready, "ready");
  const xml = fs.readFileSync(path.join(FIX, "synth-pvg.musicxml"), "utf8");
  const id = await seed("synth-pvg", xml, pdfmini(3).toString("base64"));
  ok(/^s/.test(id), `seeded ${id}`);
  // the chip: 3 practice days at All (in Both, as written: E1 opens a song with no view chosen in its Full score)
  await ex(`localStorage.setItem("resonate.play", JSON.stringify({ [arguments[0]]: { view: "both", days: { n: 3, ask: 3 } } })); return 1;`, [id]);
  d = await load(BASE + "play.html");
  ok(d && d.ready && d.song === id, "synth-pvg open");
  const offer = await ex(`return { shown: !document.getElementById("offer").hidden, text: document.getElementById("offer").textContent }`);
  ok(offer.shown && offer.text === "Fewer names?Some✕", `chip ${JSON.stringify(offer)}`);
  // a peek: press (mouse) on the chord E♭4 G4 B♭4, hold, lift
  const c = await ex(`const F = window.resonateDebug().play.facts;
    for (const ch of document.querySelectorAll("#stage .page g.chord")) {
      const ns = [...ch.querySelectorAll("g.note")];
      const ms = ns.map((g) => F[g.id] && F[g.id].midi).sort();
      if (ms.join() === "63,67,70") { const b = ns[1].querySelector("g.notehead").getBoundingClientRect(); return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)]; }
    }
    return null;`);
  ok(!!c, `chord at ${c}`);
  await mouse([{ type: "pointerMove", x: c[0], y: c[1], duration: 0 }, { type: "pointerDown", button: 0 }, { type: "pause", duration: 700 }]);
  let p = await ex(`const d = window.resonateDebug().play; return { peek: d.peek, audio: d.audio, log: d.peekLog, bubble: document.getElementById("bubble").textContent, on: !document.getElementById("dock").hidden && document.querySelectorAll("#strip rect.lit").length > 0, mc: !!document.querySelector("#strip circle.mc") }`);
  console.log("held", JSON.stringify(p));
  ok(p.peek && p.peek.names === "E♭4 G4 B♭4" && p.bubble === "E♭4 G4 B♭4", "bubble names");
  ok(p.on && p.mc && p.peek.lit.map((k) => k.midi).sort().join() === "63,67,70", "strip lit, middle C dot");
  await mouse([{ type: "pointerUp", button: 0 }]);
  await sleep(400);
  p = await ex(`const d = window.resonateDebug().play; return { peek: d.peek, audio: d.audio, log: d.peekLog, page: d.page }`);
  console.log("lift", JSON.stringify(p));
  ok(p.log.length >= 1 && p.audio && p.audio.state === "running", `the chord sounded (${JSON.stringify(p.log)}, ${p.audio && p.audio.state})`);
  ok(p.page === 1, "no page turn");
  await sleep(2300);
  p = await ex(`return { peek: window.resonateDebug().play.peek, on: document.querySelectorAll("#strip rect.lit").length > 0, n: document.querySelectorAll("#stage .peek").length }`);
  ok(!p.peek && !p.on && p.n === 0, "hidden 2 s after the lift");
  // PDF view
  ok(await ex(`return !document.getElementById("pdf").hidden`), "📄 shown");
  await ex(`document.getElementById("pdf").click(); return 1`);
  let q = null;
  for (let i = 0; i < 80; i++) { q = await ex(`const d = window.resonateDebug().play; return { pdf: d.pdf, t: d.t.pdf }`); if (q.pdf.on && q.t > 0 && q.pdf.canvas) break; await sleep(250); }
  const ink = () => ex(`const c = document.getElementById("pdfview"); const x = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < x.length; i += 28) if (x[i] < 128) n++; return n / (x.length / 28);`);
  ok(q.pdf.on && q.pdf.canvas && q.pdf.canvas[0] > 0, `PDF canvas ${JSON.stringify(q.pdf.canvas)} in ${q.t} ms`);
  const k = await ink();
  ok(k > 0.003, `PDF drawn (ink ${k.toFixed(4)})`);
  await key(""); // ArrowRight
  await sleep(600);
  q = await ex(`return { page: window.resonateDebug().play.pdf.page, pg: document.getElementById("pg").textContent }`);
  ok(q.page === 2 && q.pg === "2 / 3", `ArrowRight → PDF page 2 (${q.pg})`);
  await ex(`document.getElementById("pdf").click(); return 1`);
  await sleep(200);
  q = await ex(`const d = window.resonateDebug().play; return { on: d.pdf.on, page: d.page, vis: getComputedStyle(document.querySelector("#stage .page")).visibility, c: document.getElementById("pdfview") }`);
  ok(!q.on && q.page === 1 && q.vis === "visible" && !q.c, "📄 back to the sheet, canvas gone");
  // a scanned (JBIG2) PDF
  const scan = fs.existsSync(PDFS) ? fs.readdirSync(PDFS).find((f) => /Songbird.*\.pdf$/i.test(f)) : null;
  if (scan) {
    const sid2 = await seed("scan", xml, fs.readFileSync(path.join(PDFS, scan)).toString("base64"));
    d = await load(BASE + "play.html");
    ok(d && d.song === sid2, "scan song open");
    await ex(`document.getElementById("pdf").click(); return 1`);
    for (let i = 0; i < 160; i++) { q = await ex(`const d = window.resonateDebug().play; return { pdf: d.pdf, t: d.t.pdf }`); if (q.pdf.on && q.t > 0) break; await sleep(250); }
    const k2 = await ink();
    ok(k2 > 0.01, `scanned PDF drawn in WebKit (ink ${(k2 * 100).toFixed(1)}%, ${q.t} ms, ${q.pdf.pages} pages)`);
  } else console.log("(no scanned PDF here: skipped)");
  const err = await ex("return window.__err");
  ok(!err.length, `no errors: ${JSON.stringify(err)}`);
} finally {
  await j("DELETE", `/session/${sid}`);
}
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
