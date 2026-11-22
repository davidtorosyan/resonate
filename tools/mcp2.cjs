// Assistants and the Score (v88), live project, the approved test user (TEST_EMAIL / TEST_PW):
//  1 an assistant connects (as mcp1: DCR → consent → token); tools/list has get_score_view,
//    get_score_xml, get_score_pdf (read-only) and control_resonate's score_* actions
//  2 a synthetic song with a PDF (fixtures: Greensleeves' MusicXML + greensleeves3.pdf, never the
//    owner's files) added on the device goes up with the sync → get_score_xml slices measures 3–5,
//    get_score_pdf gives page 2 as a one-page PDF; a bundled sample has no files: said so
//  3 play.html signed in: the device's state shows the Score (song, page, bars); a stretch dragged
//    on the music → a score_focus row → get_score_view has the bars' notes as text + 2 pictures;
//    E3: the exact span (start / end as bar + beat, first / last notes), score_select with beats
//  4 📡 on play.html: score_select, score_play (a note is scheduled on the page's context),
//    score_stop, score_go, score_view, score_pdf on; with a Sing tab and a Play tab open on one device
//    each command goes to the page that runs it — and sing.html alone refuses a score action politely
//  5 the one-page shell: score_open opens the song in place with the Score shown; its state carries it
// Cleans up after itself (the song deleted through the sync, focus, devices, takes, the grant).
// usage: TEST_EMAIL=… TEST_PW=… node mcp2.cjs   (MCP_URL=… to call a local copy of the function)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const EMAIL = process.env.TEST_EMAIL, PW = process.env.TEST_PW;
const SB = "https://ltyadhjhnfxdlgsmrcds.supabase.co", KEY = "sb_publishable_8FEg0aiW9Ir-RrrND8kfQw_IBirLBai";
const RESOURCE = `${SB}/functions/v1/mcp`;
const MCP = process.env.MCP_URL || RESOURCE;
const LOCAL = process.env.BASE || "http://localhost:8097/resonate/";
const PUB = "/home/user/resonate/public";
const CB = "http://localhost:9911/cb";
const SCRATCH = "/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad";
const SHOTS = path.join(SCRATCH, "v88");
fs.mkdirSync(SHOTS, { recursive: true });
let fails = 0, passes = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (ok) passes++; else fails++; return ok; };
const b64url = (b) => Buffer.from(b).toString("base64url");
const sleep = (t) => new Promise((r) => setTimeout(r, t));

// --- fixtures (synthetic) ------------------------------------------------------------------------
const FIX = path.join(__dirname, "fixtures");
const unzip = (f) => { const out = fs.mkdtempSync(path.join(SCRATCH, "mxl-")); require("child_process").execFileSync("unzip", ["-o", "-q", f, "-d", out]); const x = fs.readdirSync(out).find((n) => n.endsWith(".xml")); return fs.readFileSync(path.join(out, x), "utf8"); };
const GS_XML = unzip(path.join(FIX, "trace/greensleeves.mxl"));
// greensleeves3.pdf = a title page + the first 3 sheets: the MusicXML without its 4th page
const GS3_XML = GS_XML.replace(/<measure number="49"[\s\S]*?(?=<\/part>)/g, "").replace(/<miscellaneous-field name="source-sheet-4">[^<]*<\/miscellaneous-field>/, "");
const GS3_PDF = fs.readFileSync(path.join(FIX, "import/greensleeves3.pdf"));
const TITLE = `MCP2 Greensleeves ${crypto.randomBytes(3).toString("hex")}`;

let rpcId = 0;
async function mcp(token, method, params = {}) {
  const r = await fetch(MCP, { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) });
  const text = await r.text();
  let msg = null;
  if ((r.headers.get("content-type") || "").includes("text/event-stream")) {
    for (const line of text.split("\n")) if (line.startsWith("data:")) { try { const m = JSON.parse(line.slice(5)); if (m.id === rpcId) msg = m; } catch {} }
  } else { try { msg = JSON.parse(text); } catch {} }
  return { status: r.status, msg, text };
}
async function tool(token, name, args = {}) {
  const { status, msg, text } = await mcp(token, "tools/call", { name, arguments: args });
  const content = msg?.result?.content || [];
  const t = content[0]?.text;
  let data = null; try { data = JSON.parse(t); } catch {}
  return { status, error: msg?.result?.isError || !!msg?.error, data, content, raw: t || text };
}
const pngSize = (b) => (b.slice(1, 4).toString() === "PNG" ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null);

(async () => {
  if (!EMAIL || !PW) { console.error("TEST_EMAIL / TEST_PW"); process.exit(2); }
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" }, args: ["--autoplay-policy=no-user-gesture-required"] });
  const errs = [];
  const appToken = async () => (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PW }) })).json()).access_token;
  const UT = await appToken();
  const UH = { apikey: KEY, Authorization: `Bearer ${UT}` };
  const rest = async (q) => (await fetch(`${SB}/rest/v1/${q}`, { headers: UH })).json();
  // (a clean slate: this test's tables)
  await fetch(`${SB}/rest/v1/score_focus?device_id=neq.__`, { method: "DELETE", headers: UH });
  await fetch(`${SB}/rest/v1/devices?id=neq.__`, { method: "DELETE", headers: UH });

  // --- 1: connect like an assistant ---
  const reg = await (await fetch(`${SB}/auth/v1/oauth/clients/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Resonate test assistant", redirect_uris: [CB], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }) })).json();
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const authz = `${SB}/auth/v1/oauth/authorize?` + new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: CB, code_challenge: challenge, code_challenge_method: "S256", state: "st8", scope: "openid offline_access", resource: RESOURCE });
  const A = await b.newContext({ viewport: { width: 390, height: 844 } });
  const ap = await A.newPage();
  ap.on("pageerror", (e) => console.log("  [consent error]", e.message));
  ap.on("response", async (res) => { if (res.status() >= 400) console.log("  [consent]", res.status(), res.url().slice(0, 160), (await res.text().catch(() => "")).slice(0, 200)); });
  await A.route("https://www.jimbo84.com/resonate/**", (r) => {
    let p = new URL(r.request().url()).pathname.replace(/^\/resonate\//, "");
    if (p === "oauth/consent") p = "oauth/consent.html";
    const f = path.join(PUB, p);
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: "not found" });
    r.fulfill({ status: 200, contentType: f.endsWith(".html") ? "text/html" : f.endsWith(".js") ? "text/javascript" : "application/octet-stream", body: fs.readFileSync(f) });
  });
  let codeUrl = null;
  await A.route("http://localhost:9911/**", (r) => { codeUrl = r.request().url(); r.fulfill({ status: 200, contentType: "text/plain", body: "ok" }); });
  const az = await fetch(authz, { redirect: "manual" });
  await ap.goto(az.headers.get("location"));
  await ap.waitForFunction(() => window.resonateDebug?.().view === "signin", null, { timeout: 20000 });
  await ap.fill("#email", EMAIL); await ap.fill("#password", PW); await ap.click("#v-signin button[type=submit]");
  await ap.waitForFunction(() => window.resonateDebug?.().view === "ask", null, { timeout: 20000 });
  await ap.click("#allow");
  for (let i = 0; i < 50 && !codeUrl; i++) await ap.waitForTimeout(200);
  const cu = new URL(codeUrl);
  const tok = await (await fetch(`${SB}/auth/v1/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: cu.searchParams.get("code") || "", redirect_uri: CB, client_id: reg.client_id, code_verifier: verifier, resource: RESOURCE }) })).json();
  const T = tok.access_token;
  check(!!T, `1 an assistant's token (${MCP === RESOURCE ? "the deployed function" : MCP})`);
  await A.close();

  const tl = await mcp(T, "tools/list");
  const tools = tl.msg?.result?.tools || [];
  const names = tools.map((t) => t.name);
  check(["get_score_view", "get_score_xml", "get_score_pdf"].every((n) => names.includes(n)) && ["get_score_view", "get_score_xml", "get_score_pdf"].every((n) => tools.find((t) => t.name === n).annotations?.readOnlyHint === true), `1 tools/list: the score tools, read-only (${names.length} tools)`);
  const ctlTool = tools.find((t) => t.name === "control_resonate");
  const acts = ctlTool?.inputSchema?.properties?.action?.enum || [];
  check(["score_open", "score_view", "score_go", "score_select", "score_play", "score_stop", "score_pdf"].every((a) => acts.includes(a)) && acts.includes("sing"), `1 control_resonate: score actions (${acts.filter((a) => a.startsWith("score_")).join(", ")})`);
  const init = await mcp(T, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } });
  check(/get_score_view/.test(init.msg?.result?.instructions || "") && /singing coach/i.test(init.msg?.result?.instructions || ""), "1 the instructions mention the score tools (and still the coach)");
  await tool(T, "get_status"); // (an assistant has called: the page sends highlights)

  // --- 2: the song with its PDF, through the sync ---
  const D = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await D.addInitScript(() => { try { if (!navigator.audioSession) Object.defineProperty(navigator, "audioSession", { configurable: true, value: { type: "auto" } }); } catch {} });
  const dp = await D.newPage();
  dp.on("pageerror", (e) => errs.push(e.message));
  dp.on("console", (m) => { if (m.type() === "error") errs.push("console " + m.text().slice(0, 200)); if (/assist|remote|focus/i.test(m.text())) console.log("  [page]", m.text().slice(0, 200)); });
  await dp.goto(LOCAL + "account.html"); await dp.waitForFunction(() => window.resonateDebug?.().view === "out", null, { timeout: 15000 });
  await dp.fill("#email", EMAIL); await dp.fill("#password", PW); await dp.click("#signin");
  await dp.waitForFunction(() => window.resonateDebug?.().view === "in", null, { timeout: 20000 });
  await dp.goto(LOCAL + "play.html");
  await dp.waitForFunction(() => window.resonateDebug?.().play?.ready, null, { timeout: 90000 });
  const id = await dp.evaluate(async ({ title, xml, pdf }) => {
    const L = await import("./library.js?v=" + document.getElementById("version").textContent.trim().replace(/^v/, ""));
    const id = await L.addSong(title, xml, { source: "pdf" });
    await L.putPdf(id, Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0)).buffer, title + ".pdf");
    return id;
  }, { title: TITLE, xml: GS3_XML, pdf: GS3_PDF.toString("base64") });
  let row = null;
  for (let i = 0; i < 60 && !row?.data?.pdf?.path; i++) { await sleep(1000); row = (await rest(`sync_items?kind=eq.song&id=eq.${id}&select=data,deleted`))[0]; }
  check(!!row?.data?.xml?.path && !!row?.data?.pdf?.path, `2 the song went up with its PDF (${id}: ${row?.data?.xml?.path ? "xml" : "-"} ${row?.data?.pdf?.path ? "pdf" : "-"})`);

  let r = await tool(T, "get_score_xml", { song: TITLE, from_measure: 3, to_measure: 5 });
  const xml = r.content[1]?.text || "";
  const parts = xml.match(/<part(?=[\s>])[^>]*>[\s\S]*?<\/part>/g) || [];
  const nums = parts.map((p) => (p.match(/<measure(?=[\s>])[^>]*>/g) || []).map((m) => /number="([^"]*)"/.exec(m)?.[1]).join(","));
  check(!r.error && parts.length >= 1 && nums.every((n) => n === "3,4,5") && /<part-list>/.test(xml) && /in effect from earlier bars: .*<divisions>.*<time>/.test(xml) && r.data?.shown?.from === "3" && r.data?.shown?.to === "5" && !/reminder/.test(r.content[0].text),
    `2 get_score_xml 3–5: ${parts.length} part(s), measures ${nums.join(" | ")}, part list + what's in effect; no coaching reminder (${xml.length} chars)`);
  fs.writeFileSync(path.join(SHOTS, "c-xml-3-5.xml"), xml);
  if (fails) console.log("  ", r.content[0]?.text.slice(0, 600));
  // the whole song: cut at the cap, the rest from next_from_measure
  r = await tool(T, "get_score_xml", { song: TITLE });
  let got = (r.content[1]?.text.match(/<measure(?=[\s>])/g) || []).length, asks = 1;
  while (!r.error && r.data?.next_from_measure && asks < 10) { r = await tool(T, "get_score_xml", { song: TITLE, from_measure: r.data.next_from_measure }); got += (r.content[1]?.text.match(/<measure(?=[\s>])/g) || []).length; asks++; }
  check(!r.error && got === (GS3_XML.match(/<measure(?=[\s>])/g) || []).length && asks > 1, `2 get_score_xml whole song: cut, then the rest from next_from_measure — ${got} measures in ${asks} answers`);
  r = await tool(T, "get_score_xml", { song: TITLE, from_measure: 7, to_measure: 7, part: "P1" });
  check(!r.error && (r.content[1]?.text.match(/<part(?=[\s>])/g) || []).length === 1 && (r.content[1]?.text.match(/<measure(?=[\s>])/g) || []).length === 1, "2 get_score_xml one bar of one part");
  r = await tool(T, "get_score_xml", { song: TITLE, from_measure: 999 });
  check(r.error && /No measure numbered/.test(r.raw), `2 a bar that isn't there: ${r.raw.slice(0, 80)}`);
  r = await tool(T, "get_score_pdf", { song: TITLE, page: 2 });
  const res = r.content.find((c) => c.type === "resource")?.resource;
  const one = res ? Buffer.from(res.blob, "base64") : Buffer.alloc(0);
  const pageObjs = (one.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
  check(!r.error && r.data?.pages === 4 && r.data?.page === 2 && res?.mimeType === "application/pdf" && one.slice(0, 5).toString() === "%PDF-" && pageObjs === 1,
    `2 get_score_pdf page 2: a one-page PDF (${one.length} bytes, ${pageObjs} page object) of ${r.data?.pages}`);
  fs.writeFileSync(path.join(SHOTS, "c-pdf-page2.pdf"), one);
  r = await tool(T, "get_score_pdf", { song: TITLE, page: 9 });
  check(r.error && /4 pages/.test(r.raw), `2 page 9 of 4: ${r.raw.slice(0, 70)}`);
  r = await tool(T, "get_score_xml", { song: "amazing grace" });
  check(r.error && /sample|No song/.test(r.raw), `2 a bundled sample: ${r.raw.slice(0, 110)}`);

  // --- 3: play.html shows the song: the device's state; a stretch dragged → the focus ---
  await dp.reload();
  await dp.waitForFunction(() => window.resonateDebug?.().play?.ready, null, { timeout: 90000 });
  await dp.selectOption("#song", id);
  await dp.waitForFunction((s) => { const d = window.resonateDebug().play; return d.ready && d.song === s && d.pdf.has; }, id, { timeout: 60000 });
  await dp.waitForFunction(() => !document.getElementById("remote-btn").hidden, null, { timeout: 20000 });
  const barH = await dp.evaluate(() => document.getElementById("bar").offsetHeight);
  await sleep(1500);
  let st = await tool(T, "get_status");
  let mine = st.data?.devices?.find((d) => d.showing?.score?.song?.id === id);
  check(!!mine && mine.showing.page === "play" && mine.showing.score.page === 1 && mine.showing.score.measures?.[0] === "1" && Number(mine.showing.score.measures?.[1]) > 4,
    `3 get_status: the device shows the Score (${JSON.stringify(mine?.showing?.score && { song: mine.showing.score.song.title, view: mine.showing.score.view, page: mine.showing.score.page, measures: mine.showing.score.measures, pdf: mine.showing.score.pdf })})`);
  r = await tool(T, "get_score_view");
  check(!r.error && r.data?.score_open_on?.length >= 1 && !r.data?.highlight && /drags across the notes/.test(r.data?.how || ""), "3 get_score_view with no highlight: what's shown and how to highlight");
  const pick = await dp.evaluate(() => {
    const ms = [...document.querySelectorAll("#stage .page g.measure")];
    const box = (gid) => { const g = ms.find((x) => x.id === gid); return g?.querySelector("g.staff")?.getBoundingClientRect(); };
    const a = box("m4"), c = box("m5");
    return a && c ? [a.left + 12, a.top + a.height / 2, c.right - 12, c.top + c.height / 2] : null;
  });
  await dp.mouse.move(pick[0], pick[1]); await dp.mouse.down();
  for (let i = 1; i <= 8; i++) { await dp.mouse.move(pick[0] + ((pick[2] - pick[0]) * i) / 8, pick[1] + ((pick[3] - pick[1]) * i) / 8); await sleep(20); }
  await dp.mouse.up();
  let fr = null;
  for (let i = 0; i < 30; i++) { await sleep(1000); fr = (await rest(`score_focus?song_id=eq.${id}&select=data,score_img,pdf_img`))[0]; if (fr) break; }
  check(!!fr && fr.data?.measures?.join() === "5,6", `3 the stretch dragged (bars 5–6) → a score_focus row (${fr ? fr.data.measures : "none"}; score ${fr?.score_img?.length || 0}, pdf ${fr?.pdf_img?.length || 0} chars)`);
  r = await tool(T, "get_score_view");
  const imgs = r.content.filter((c) => c.type === "image");
  const notes = r.content.find((c) => c.type === "text" && /highlighted bars' notes/.test(c.text))?.text || "";
  const sizes = imgs.map((c) => (c.mimeType === "image/png" ? pngSize(Buffer.from(c.data, "base64")) : { jpeg: Buffer.from(c.data, "base64").length }));
  check(!r.error && r.data?.highlight?.measures === "5–6" && r.data.highlight.still_highlighted === true && /Bar 5[\s\S]*Bar 6/.test(notes) && /@1 [A-G]/.test(notes) && r.data.highlight.pdf?.page === 2,
    `3 get_score_view: bars ${r.data?.highlight?.measures}, still highlighted, the notes as text, PDF page ${r.data?.highlight?.pdf?.page}`);
  check(imgs.length === 2 && imgs.every((c) => /^image\/(png|jpeg)$/.test(c.mimeType) && c.data.length > 2000) && sizes.every((s) => !s.w || s.w <= 1600), `3 …and 2 pictures (${JSON.stringify(sizes)})`);
  // (E3: the exact span — a drag over whole bars 5–6: from bar 5's downbeat to bar 7's, the notes starting in it)
  const span = r.data?.highlight?.span;
  check(span?.kind === "stretch" && span.start?.bar === "5" && span.start.beat === 1 && span.end?.bar === "7" && span.end.beat === 1 && span.bars?.join() === "5,6" && span.notes > 0 && span.first?.[0]?.notes?.length > 0
    && /^Highlighted: from bar 5 @1 to the end of bar 6/m.test(notes) && /whole bars/.test(r.data.highlight.pdf?.border_note || ""),
    `3 …the exact span (E3): ${JSON.stringify(span && { start: span.start, end: span.end, bars: span.bars, notes: span.notes })}, the PDF's border bar-level`);
  imgs.forEach((c, i) => fs.writeFileSync(path.join(SHOTS, `c-focus-${i ? "pdf" : "score"}.${c.mimeType === "image/png" ? "png" : "jpg"}`), Buffer.from(c.data, "base64")));
  console.log(notes.split("\n").slice(0, 8).join("\n"));
  // a picture over the table's limit is left out (the row would be refused whole), and a row refused
  // with its pictures (413 here) goes again without them — the notes still reach the assistant
  let refused = 0;
  await dp.route("**/rest/v1/score_focus*", (rt) => {
    if (rt.request().method() === "POST" && /"score_img":"data:/.test(rt.request().postData() || "")) { refused++; return rt.fulfill({ status: 413, contentType: "application/json", body: JSON.stringify({ message: "Payload too large" }) }); }
    return rt.continue();
  });
  const stored = await dp.evaluate(async (sid) => { const A = await import("./assist.js?v=" + document.getElementById("version").textContent.trim().replace(/^v/, "")); return A.shareFocus(sid, { v: 1, measures: ["7"], text: "Bar 7 …", legend: "" }, { score: "data:image/png;base64,AAAA", pdf: "data:image/png;base64," + "A".repeat(2100000) }); }, id);
  await dp.unroute("**/rest/v1/score_focus*");
  for (let i = errs.length - 1; i >= 0; i--) if (/status of 413/.test(errs[i])) errs.splice(i, 1); // (that 413 is this check's own)
  fr = (await rest(`score_focus?song_id=eq.${id}&select=data,score_img,pdf_img`))[0];
  check(stored === true && refused === 1 && fr?.data?.measures?.join() === "7" && !fr.score_img && !fr.pdf_img && fr.data.pictures_left_out?.join() === "score,pdf",
    `3 a focus refused with its pictures: stored again without them (${refused} refused; measures ${fr?.data?.measures}, left out ${fr?.data?.pictures_left_out})`);

  // --- 4: 📡 on play.html → score_* commands ---
  await dp.click("#remote-btn");
  await dp.waitForFunction(() => document.getElementById("remote-btn").dataset.on === "true", null, { timeout: 10000 });
  check(await dp.evaluate(() => document.getElementById("bar").offsetHeight) === barH, `4 📡 on: the bar's height unchanged (${barH} px)`);
  let c = await tool(T, "control_resonate", { action: "score_select", from_measure: 9, to_measure: 10 });
  check(!c.error && c.data?.score?.selection?.from === "9" && c.data.score.selection.to === "10" && !/reminder/.test(c.content[0]?.text || ""), `4 score_select 9–10 (${c.raw.slice(0, 160)})`);
  fr = null;
  for (let i = 0; i < 20; i++) { await sleep(1000); fr = (await rest(`score_focus?song_id=eq.${id}&select=data`))[0]; if (fr?.data?.measures?.join() === "9,10") break; }
  check(fr?.data?.measures?.join() === "9,10", `4 …the focus follows (${fr?.data?.measures})`);
  // (E3: a span within the bars, by beats — and the focus names it)
  c = await tool(T, "control_resonate", { action: "score_select", from_measure: 9, from_beat: 2, to_measure: 10, to_beat: 2 });
  const sb = c.data?.score?.selection;
  check(!c.error && sb?.from === "9" && sb.start?.bar === "9" && sb.start.beat >= 2 && sb.end?.bar === "10" && !c.data?.ignored_params, `4 score_select bar 9 beat 2 → bar 10 beat 2 (${JSON.stringify(sb)})`);
  fr = null;
  for (let i = 0; i < 20; i++) { await sleep(1000); fr = (await rest(`score_focus?song_id=eq.${id}&select=data`))[0]; if (fr?.data?.span?.start?.beat === sb?.start?.beat && fr?.data?.span?.start?.bar === "9") break; }
  check(fr?.data?.span?.kind === "stretch" && JSON.stringify(fr.data.span.start) === JSON.stringify(sb?.start) && JSON.stringify(fr.data.span.end) === JSON.stringify(sb?.end), `4 …the focus names that span (${JSON.stringify(fr?.data?.span && [fr.data.span.start, fr.data.span.end])})`);
  c = await tool(T, "control_resonate", { action: "score_select", from_measure: 9, to_measure: 10 });
  c = await tool(T, "control_resonate", { action: "score_play" });
  const pb = await dp.evaluate(() => { const p = window.resonateDebug().play.playback; return { state: p.state, kind: p.kind, n: p.scheduled.length, now: p.now }; });
  check(!c.error && c.data?.score?.playing === "selection" && pb.state === "playing" && pb.n > 0, `4 score_play: the stretch plays (${JSON.stringify(pb)})`);
  c = await tool(T, "control_resonate", { action: "score_stop" });
  check(!c.error && !c.data?.score?.playing && (await dp.evaluate(() => window.resonateDebug().play.playback.state)) === "idle", "4 score_stop");
  c = await tool(T, "control_resonate", { action: "score_play", from_measure: 2, to_measure: 3, speed: 70 });
  check(!c.error && c.data?.score?.selection?.from === "2" && c.data.score.speed === 70 && c.data.score.playing, `4 score_play 2–3 at 70% (${JSON.stringify(c.data?.score && { sel: c.data.score.selection, speed: c.data.score.speed, playing: c.data.score.playing })})`);
  await tool(T, "control_resonate", { action: "stop" });
  check((await dp.evaluate(() => window.resonateDebug().play.playback.state)) === "idle", "4 stop (the generic one) stops ▶ too");
  c = await tool(T, "control_resonate", { action: "score_go", measure: 40 });
  check(!c.error && Number(c.data?.score?.measures?.[0]) <= 40 && Number(c.data?.score?.measures?.[1]) >= 40, `4 score_go 40 → bars ${c.data?.score?.measures?.join("–")} shown`);
  c = await tool(T, "control_resonate", { action: "score_go", measure: 500 });
  check(c.error && /No bar/.test(c.raw), `4 score_go 500: ${c.raw.slice(0, 90)}`);
  const views = c.data?.score?.views || [];
  const other = views.find((v) => v !== c.data?.score?.view && v !== "score") || views.find((v) => v !== c.data?.score?.view);
  c = await tool(T, "control_resonate", { action: "score_view", view: other });
  check(!c.error && c.data?.score?.view === other && (await dp.evaluate(() => window.resonateDebug().play.view)) === other, `4 score_view ${other} (views ${views.join(", ")})`);
  c = await tool(T, "control_resonate", { action: "score_select", from_measure: 5, to_measure: 6 });
  c = await tool(T, "control_resonate", { action: "score_pdf", on: true });
  const pdfSt = await dp.evaluate(() => { const p = window.resonateDebug().play.pdf; return { on: p.on, page: p.page, focus: p.focus?.page, rects: p.focus?.rects?.length }; });
  check(!c.error && c.data?.score?.pdf?.on === true && pdfSt.on && pdfSt.focus === 2, `4 score_pdf on: the PDF, zoomed on the stretch (${JSON.stringify(pdfSt)})`);
  await dp.screenshot({ path: path.join(SHOTS, "c-remote-pdf.png") });
  await sleep(1500); // (the device's row follows 0.8 s after a change)
  st = await tool(T, "get_status");
  mine = st.data?.devices?.find((d) => d.remote_on);
  check(mine?.showing?.score?.pdf?.on === true && mine.showing.score.selection?.from === "5", `4 get_status follows (pdf on, stretch ${mine?.showing?.score?.selection?.from}–${mine?.showing?.score?.selection?.to})`);
  c = await tool(T, "control_resonate", { action: "score_pdf", on: false });
  check(!c.error && c.data?.score?.pdf?.on === false, "4 score_pdf off");
  c = await tool(T, "control_resonate", { action: "listen" });
  check(c.error && /Sing/.test(c.raw), `4 a Sing action on Play: refused (${c.raw.slice(0, 100)})`);

  // two pages of one device (tabs, Split View — one device id): each command goes to the page that
  // can run it, whichever is in front; the device says what the page in front shows (review: Play's
  // remote took Sing's commands about half the time and refused them, and the other way round)
  const dp2 = await D.newPage();
  dp2.on("pageerror", (e) => errs.push(e.message));
  await dp2.goto(LOCAL + "play.html");
  await dp2.waitForFunction((s) => { const d = window.resonateDebug?.().play; return d?.ready && d.song === s && document.getElementById("remote-btn").dataset.on === "true"; }, id, { timeout: 90000 });
  await dp.goto(LOCAL + "sing.html"); // (in front: the page loaded last)
  await dp.waitForFunction(() => document.getElementById("remote-btn")?.dataset.on === "true", null, { timeout: 30000 });
  await sleep(1000);
  const front = (pg) => pg.evaluate(() => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  const twoTabs = [];
  for (const m of [3, 9, 17]) { c = await tool(T, "control_resonate", { action: "score_go", measure: m }); twoTabs.push(!c.error && Number(c.data?.score?.measures?.[0]) <= m && Number(c.data?.score?.measures?.[1]) >= m ? "ok" : c.raw.slice(0, 60)); }
  await sleep(1500);
  st = await tool(T, "get_status");
  const shows1 = st.data?.devices?.find((d) => d.remote_on)?.showing?.page;
  await front(dp2); // the Play tab in front now: Sing's commands still go to the Sing tab
  for (const l of [1, 2, 3]) { c = await tool(T, "control_resonate", { action: "go_to_line", line: l }); twoTabs.push(!c.error && c.data?.page === "sing" ? "ok" : c.raw.slice(0, 60)); }
  await sleep(1800);
  st = await tool(T, "get_status");
  const shows2 = st.data?.devices?.find((d) => d.remote_on)?.showing?.page;
  await front(dp2);
  await sleep(1800);
  st = await tool(T, "get_status");
  const shows3 = st.data?.devices?.find((d) => d.remote_on)?.showing?.page;
  check(twoTabs.every((x) => x === "ok") && shows1 === "play" && shows2 === "sing" && shows3 === "play", `4 Sing + Play tabs on one device: score_go ×3 on Play, go_to_line ×3 on Sing (${twoTabs.join(" | ")}); the device shows the page that ran the last command, then the one touched (${shows1}, ${shows2}, ${shows3})`);
  await dp2.close();

  // sing.html alone: refuses a score action politely (after the 3 s it leaves another page)
  await sleep(500);
  const t0 = Date.now();
  c = await tool(T, "control_resonate", { action: "score_go", measure: 3 });
  check(c.error && /Score isn't open on this device/.test(c.raw), `4 sing.html: ${c.raw.slice(0, 110)} (${Date.now() - t0} ms)`);

  // --- 5: the one-page shell: score_open opens the song in place with the Score ---
  await dp.goto(LOCAL + "index.html");
  await dp.waitForFunction(() => window.resonateDebug?.().remote?.on, null, { timeout: 30000 }).catch(() => {});
  await sleep(1000);
  c = await tool(T, "control_resonate", { action: "score_open", song: TITLE });
  const sh = await dp.evaluate(() => { const d = window.resonateDebug(); return { open: d.song.open, mods: d.song.mods, song: window.resonatePlay?.scoreState?.()?.song?.id || null, set: localStorage.getItem("resonate.shell.modules") }; });
  check(!c.error && c.data?.score?.song?.id === id && sh.open && /score|both/.test(sh.mods) && sh.song === id, `5 shell: score_open → the song in place with the Score (${JSON.stringify(sh)})`);
  c = await tool(T, "control_resonate", { action: "score_select", from_measure: 3, to_measure: 4 });
  await sleep(1500);
  st = await tool(T, "get_status");
  mine = st.data?.devices?.find((d) => d.remote_on);
  check(!c.error && mine?.showing?.score?.selection?.from === "3" && mine.showing.page === "song", `5 shell: score_select 3–4, get_status has the Score (${JSON.stringify(mine?.showing?.score?.selection)}, page ${mine?.showing?.page})`);
  c = await tool(T, "control_resonate", { action: "score_play" });
  check(!c.error && c.data?.score?.playing, `5 shell: score_play (${c.raw.slice(0, 100)})`);
  await tool(T, "control_resonate", { action: "stop" });
  check(!(await dp.evaluate(() => window.resonatePlay.scoreState().playing)), "5 shell: stop stops the Score's ▶");

  // --- tidy: the song (through the sync), the focus, devices, takes, the grant ---
  await dp.evaluate(async (sid) => { const L = await import("./library.js?v=" + document.getElementById("version").textContent.trim().replace(/^v/, "")); await L.removeSong(sid); }, id);
  for (let i = 0; i < 40; i++) { await sleep(1000); row = (await rest(`sync_items?kind=eq.song&id=eq.${id}&select=deleted`))[0]; if (row?.deleted) break; }
  check(row?.deleted === true, "tidy: the song deleted in the cloud");
  await fetch(`${SB}/rest/v1/score_focus?device_id=neq.__`, { method: "DELETE", headers: UH });
  await fetch(`${SB}/rest/v1/coach_takes?id=neq.__`, { method: "DELETE", headers: UH });
  await fetch(`${SB}/rest/v1/devices?id=neq.__`, { method: "DELETE", headers: UH });
  await fetch(`${SB}/auth/v1/user/oauth/grants?client_id=${reg.client_id}`, { method: "DELETE", headers: UH });
  check(!errs.length, "no page errors " + errs.join("; "));
  await b.close();
  console.log(`${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
