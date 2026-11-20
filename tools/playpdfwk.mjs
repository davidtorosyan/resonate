// WebKitGTK (Safari stand-in) for Play's PDF view (v88): the map's focus, zoomed open, the red
// borders, + (zoom) and its sharp redraw, a double click back to fitted, ‹ › while zoomed.
// Needs Xvfb :99 + WebKitWebDriver on :4444 (/home/user/xb). usage: node playpdfwk.mjs
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
const BASE = process.env.BASE || "http://localhost:8097/resonate/";
const DIR = path.dirname(new URL(import.meta.url).pathname);
const SCRATCH = "/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad";
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
const until = async (script, ms = 30000) => { for (let t = 0; t < ms; t += 250) { const v = await ex(script); if (v) return v; await sleep(250); } return null; };
async function load(url) {
  await j("POST", `/session/${sid}/url`, { url });
  return until(`const d = window.resonateDebug && window.resonateDebug().play; return d && (d.ready || d.failed) && d;`, 40000);
}
const out = fs.mkdtempSync(path.join(SCRATCH, "mxl-"));
execFileSync("unzip", ["-o", "-q", path.join(DIR, "fixtures/trace/greensleeves.mxl"), "-d", out]);
const xml = fs.readFileSync(path.join(out, fs.readdirSync(out).find((n) => n.endsWith(".xml"))), "utf8")
  .replace(/<measure number="49"[\s\S]*?(?=<\/part>)/g, "").replace(/<miscellaneous-field name="source-sheet-4">[^<]*<\/miscellaneous-field>/, "");
const pdf = fs.readFileSync(path.join(DIR, "fixtures/import/greensleeves3.pdf")).toString("base64");
const P = `const p = window.resonateDebug().play.pdf; return { on: p.on, busy: p.busy, page: p.page, z: p.z, list: p.fit && p.fit.list, borders: p.borders, focus: p.focus, detail: p.detail, map: p.map, canvas: p.canvas };`;
try {
  await j("POST", `/session/${sid}/window/rect`, { width: 900, height: 1200 }).catch(() => {});
  let d = await load(BASE + "play.html");
  ok(d && d.ready, "ready");
  const id = await exa(`const [xml, b64, done] = arguments;
    import("./library.js?v=" + document.getElementById("version").textContent.trim().replace(/^v/, "")).then(async (L) => {
      const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const id = await L.addSong("GS3", xml, { source: "pdf", pdf: u.buffer, pdfName: "gs3.pdf" });
      localStorage.setItem("resonate.sing.song", id);
      done(id);
    }).catch((e) => done("ERR " + e.message));`, [xml, pdf]);
  d = await load(BASE + "play.html");
  ok(d && d.ready && d.song === id, `GS3 open (${id})`);
  await until(`return !document.getElementById("pdf").hidden`, 10000);
  await ex(`document.getElementById("pdf").click(); return 1`);
  let p = await until(`const p = window.resonateDebug().play.pdf; return p.on && !p.busy && p.fit && p.canvas && p;`, 40000);
  await sleep(1000);
  p = await ex(P);
  ok(p.map && p.map.pages.join() === "2,3,4" && p.list.includes(2) && p.borders.length >= 2 && p.z >= 1, `opened on page 2 at ×${p.z.toFixed(2)}, ${p.borders.length} borders, map ${p.map && p.map.pages} (${p.map && p.map.how})`);
  await ex(`document.getElementById("pdf-in").click(); return 1`);
  await sleep(1200);
  const z0 = p.z;
  p = await ex(P);
  ok(Math.abs(p.z / z0 - 1.5) < 0.02 && p.detail && Math.abs(p.detail.z - p.z) < 0.01 && p.detail.w > 0, `+ → ×${p.z.toFixed(2)}, drawn again sharp (${p.detail && p.detail.w}×${p.detail && p.detail.h}, ${p.detail && p.detail.k.toFixed(2)} a px)`);
  const b = await ex(`const r = document.getElementById("pdfwrap").getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)];`);
  await mouse([{ type: "pointerMove", x: b[0], y: b[1], duration: 0 }, { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 }, { type: "pause", duration: 80 }, { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 }]);
  await sleep(900);
  p = await ex(P);
  ok(Math.abs(p.z - 1) < 0.01, `a double click → fitted (×${p.z.toFixed(2)})`);
  await ex(`document.getElementById("pdf-in").click(); return 1`);
  await sleep(700);
  const zk = (await ex(P)).z;
  await ex(`document.getElementById("next").click(); return 1`);
  await until(`const p = window.resonateDebug().play.pdf; return p.page === 3 && !p.busy && p;`, 20000);
  await sleep(600);
  p = await ex(P);
  ok(p.page === 3 && Math.abs(p.z - zk) < 0.02, `› while zoomed: page 3 at ×${p.z.toFixed(2)}`);
  const err = await ex(`return (window.__err || []).slice()`);
  ok(!err || !err.length, `no errors ${JSON.stringify(err)}`);
} finally {
  await j("DELETE", `/session/${sid}`).catch(() => {});
}
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
