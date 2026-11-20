// WebKitGTK: the focus's score picture (SVG → canvas → PNG) and the text, on the Amazing Grace sample.
const W = "http://127.0.0.1:4444", BASE = "http://localhost:8097/resonate/";
const j = async (method, p, body) => (await fetch(W + p, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) })).json();
const s = await j("POST", "/session", { capabilities: { alwaysMatch: { browserName: "MiniBrowser", "webkitgtk:browserOptions": { binary: "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser", args: ["--automation"] } } } });
const sid = s.value.sessionId;
const ex = async (script, args = []) => (await j("POST", `/session/${sid}/execute/sync`, { script, args })).value;
const exa = async (script, args = []) => (await j("POST", `/session/${sid}/execute/async`, { script, args })).value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fails++; };
try {
  await j("POST", `/session/${sid}/window/rect`, { width: 1000, height: 900 }).catch(() => {});
  await j("POST", `/session/${sid}/url`, { url: BASE + "play.html" });
  for (let t = 0; t < 40000; t += 250) { if (await ex("return !!(window.resonateDebug && window.resonateDebug().play.ready)")) break; await sleep(250); }
  const sel = await exa(`const done = arguments[0]; window.resonatePlay.scoreRun("score_select", { from_measure: 3, to_measure: 5 }).then((r) => done(r.ok && r.score.selection), (e) => done(String(e)));`);
  ok(sel && sel.from === "3" && sel.to === "5", "score_select 3–5 " + JSON.stringify(sel));
  const r = await exa(`const done = arguments[0]; window.resonatePlay.focusData().then((d) => done({ text: d.data.text.slice(0, 120), xml: d.data.xml && d.data.xml.length, score: d.pics.score && d.pics.score.slice(0, 22), n: d.pics.score && d.pics.score.length }), (e) => done({ err: String(e) }));`);
  ok(r && /^Bar 3/.test(r.text) && r.xml > 1000 && r.score === "data:image/png;base64," && r.n > 5000, "focusData in WebKit: text, xml, a PNG of the bars " + JSON.stringify(r));
  const px = await exa(`const done = arguments[0]; window.resonatePlay.scoreCrop().then(async (b) => { const bmp = await createImageBitmap(b); const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height; const x = c.getContext("2d"); x.drawImage(bmp, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let ink = 0, blue = 0, purple = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] < 80 && d[i+1] < 80 && d[i+2] < 80) ink++; if (d[i] > 200 && d[i+2] > 240 && d[i+1] > 215) blue++; if (d[i] > 70 && d[i] < 120 && d[i+1] < 70 && d[i+2] > 160) purple++; } done({ w: c.width, h: c.height, ink, blue, purple }); }, (e) => done({ err: String(e) }));`);
  ok(px && px.ink > 500 && px.blue > 1000 && px.purple > 100, "the picture has ink, the blue band and the purple names " + JSON.stringify(px));
} finally {
  await j("DELETE", `/session/${sid}`);
  console.log(fails ? `${fails} failed` : "all passed");
}
