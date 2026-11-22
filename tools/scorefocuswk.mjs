// WebKitGTK: the focus's score picture (SVG → canvas → PNG) and the text, on the Amazing Grace sample;
// E3: a span within the bars (score_select with beats) named exactly, the picture's bars whole with
// the band inside, and a double-click on a note picking that chord.
import C from "./lib/check.cjs";
const { ok, done, fail } = C;
const W = "http://127.0.0.1:4444", BASE = process.env.BASE || "http://localhost:8097/resonate/";
const j = async (method, p, body) => (await fetch(W + p, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let sid = null, crash = null;
try {
  const s = await j("POST", "/session", { capabilities: { alwaysMatch: { browserName: "MiniBrowser", "webkitgtk:browserOptions": { binary: "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser", args: ["--automation"] } } } });
  sid = s.value.sessionId;
  const ex = async (script, args = []) => (await j("POST", `/session/${sid}/execute/sync`, { script, args })).value;
  const exa = async (script, args = []) => (await j("POST", `/session/${sid}/execute/async`, { script, args })).value;
  await j("POST", `/session/${sid}/window/rect`, { width: 1000, height: 900 }).catch(() => {});
  await j("POST", `/session/${sid}/url`, { url: BASE + "play.html" });
  for (let t = 0; t < 40000; t += 250) { if (await ex("return !!(window.resonateDebug && window.resonateDebug().play.ready)")) break; await sleep(250); }
  const sel = await exa(`const done = arguments[0]; window.resonatePlay.scoreRun("score_select", { from_measure: 3, to_measure: 5 }).then((r) => done(r.ok && r.score.selection), (e) => done(String(e)));`);
  ok(sel && sel.from === "3" && sel.to === "5", "score_select 3–5 " + JSON.stringify(sel));
  const r = await exa(`const done = arguments[0]; window.resonatePlay.focusData().then((d) => done({ text: d.data.text.slice(0, 2000), xml: d.data.xml && d.data.xml.length, score: d.pics.score && d.pics.score.slice(0, 22), n: d.pics.score && d.pics.score.length }), (e) => done({ err: String(e) }));`);
  ok(r && /(^|\n)Bar 3/.test(r.text) && r.xml > 1000 && r.score === "data:image/png;base64," && r.n > 5000, "focusData in WebKit: text, xml, a PNG of the bars " + JSON.stringify({ ...r, text: r?.text?.slice(0, 100) }));
  // the picture: ink, the blue band, the purple names — and how much of its width the band takes
  const PX = `const done = arguments[0]; window.resonatePlay.scoreCrop().then(async (b) => { const bmp = await createImageBitmap(b); const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height; const x = c.getContext("2d"); x.drawImage(bmp, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let ink = 0, blue = 0, purple = 0; const cols = new Uint8Array(c.width); for (let i = 0; i < d.length; i += 4) { if (d[i] < 80 && d[i+1] < 80 && d[i+2] < 80) ink++; if (d[i] > 200 && d[i+2] > 240 && d[i+1] > 215) blue++; if (d[i] > 190 && d[i+2] > 240 && d[i+2] - d[i] > 20) cols[(i / 4) % c.width] = 1; if (d[i] > 70 && d[i] < 120 && d[i+1] < 70 && d[i+2] > 160) purple++; } const bc = [...cols.keys()].filter((i) => cols[i]); done({ w: c.width, h: c.height, ink, blue, purple, band: bc.length ? (Math.max(...bc) - Math.min(...bc) + 1) / c.width : 0 }); }, (e) => done({ err: String(e) }));`;
  let px = await exa(PX);
  ok(px && px.ink > 500 && px.blue > 1000 && px.purple > 100, "the picture has ink, the blue band and the purple names " + JSON.stringify(px));
  // E3: a span within the bars, by beats
  const sb = await exa(`const done = arguments[0]; window.resonatePlay.scoreRun("score_select", { from_measure: 3, from_beat: 2, to_measure: 4, to_beat: 2 }).then((r) => done(r.ok ? r.score.selection : r.error), (e) => done(String(e)));`);
  ok(sb && sb.kind === "stretch" && sb.start?.bar === "3" && sb.start.beat >= 2 && sb.end?.bar === "4", "score_select bar 3 beat 2 → bar 4 beat 2: " + JSON.stringify(sb));
  const f = await exa(`const done = arguments[0]; window.resonatePlay.focusData().then((d) => done({ span: d.data.span, head: d.data.text.split("\\n")[0], outside: /outside the highlight/.test(d.data.text) }), (e) => done({ err: String(e) }));`);
  ok(f && f.span?.kind === "stretch" && JSON.stringify(f.span.start) === JSON.stringify(sb?.start) && /^Highlighted: from bar 3 @/.test(f.head) && f.outside && f.span.notes > 0 && f.span.first?.length > 0,
    "the focus names it exactly: " + JSON.stringify(f && { start: f.span?.start, end: f.span?.end, notes: f.span?.notes, head: f.head?.slice(0, 120) }));
  px = await exa(PX);
  ok(px && px.band > 0.1 && px.band < 0.8, `the picture: the bars whole, the band only the span (${JSON.stringify(px)})`);
  // E3: a double-click on a note picks its chord on that staff
  const head = await ex(`const g = document.querySelector('#stage g.note[id="n4"] > g.notehead'); const r = g.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)];`);
  await j("POST", `/session/${sid}/actions`, { actions: [{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions: [
    { type: "pointerMove", x: head[0], y: head[1], origin: "viewport", duration: 0 },
    { type: "pointerDown", button: 0 }, { type: "pause", duration: 60 }, { type: "pointerUp", button: 0 },
    { type: "pause", duration: 120 },
    { type: "pointerDown", button: 0 }, { type: "pause", duration: 60 }, { type: "pointerUp", button: 0 },
  ] }] });
  await j("DELETE", `/session/${sid}/actions`).catch(() => {});
  await sleep(400);
  const n = await ex(`const p = window.resonateDebug().play.playback; return { span: p.span, bands: p.bands.length, log: window.resonateDebug().play.peekLog.slice(-2).map((x) => x.how), state: window.resonatePlay.scoreState().selection };`);
  ok(n && n.span?.note?.ids?.includes("n4") && n.bands === 1 && n.state?.kind === "note", "a double-click on a note: its chord picked, one band " + JSON.stringify(n));
} catch (e) { crash = e; }
finally {
  if (sid) await j("DELETE", `/session/${sid}`).catch(() => {});
}
if (crash) fail(crash);
done();
