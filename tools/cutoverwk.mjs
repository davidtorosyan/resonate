// The cut-over (v92) in WebKitGTK (Safari stand-in): the root is the shell; sing.html, play.html and
// voice.html land in it in their state (localStorage resonate.redirect = "1": WebDriver sets
// navigator.webdriver); shell.html carries ?search and #hash without a history entry; an email
// link's error at the root reaches account.html; without resonate.redirect sing.html stays itself;
// and sing / play / pdf-import.html on their way out with the answer never coming (away.js inlined,
// its navigation a no-op; served from /home/user/sitetest/tmp with <base href="/resonate/">) run
// none of their modules — away.js stops the page: nav.js's top-level await alone doesn't hold them
// back in WebKit (reported as INFO).
// Needs Xvfb :99 + WebKitWebDriver on :4444 (CLAUDE.md "A fresh container").
// usage: node cutoverwk.mjs   (BASE=http://localhost:8097/)
import fs from "node:fs";
const ROOT = process.env.BASE || "http://localhost:8097/";
const APP = ROOT + "resonate/";
const W = "http://127.0.0.1:4444";
const j = async (method, path, body) => (await fetch(W + path, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0, passes = 0;
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (c) passes++; else fails++; };

// The old pages on their way out but never gone: away.js inlined with its location.replace a no-op
// (stay-*.html: what a slow answer leaves behind — the page stopped, nothing of it runs), and only
// the marker nav.js reads (mark-*.html: nav.js's wait alone — WebKit runs sing.js / play.js /
// pdf-import.js anyway, a module whose import another <script> started: reported, not judged).
fs.mkdirSync("/home/user/sitetest/tmp", { recursive: true });
const AWAY = fs.readFileSync("/home/user/resonate/public/away.js", "utf8").replace("location.replace(", "(function () {})(");
for (const pg of ["sing", "play", "pdf-import"]) {
  const src = fs.readFileSync(`/home/user/resonate/public/${pg}.html`, "utf8").replace(/<head>/i, '<head><base href="/resonate/">');
  const tag = /<script src="away\.js[^"]*" data-open="([a-z]+)"><\/script>/;
  fs.writeFileSync(`/home/user/sitetest/tmp/stay-${pg}.html`, src.replace(tag, (m, o) => `<script data-open="${o}">${AWAY}</script>`));
  fs.writeFileSync(`/home/user/sitetest/tmp/mark-${pg}.html`, src.replace(tag, '<script>document.documentElement.setAttribute("data-away", "")</script>'));
}

const s = await j("POST", "/session", { capabilities: { alwaysMatch: { browserName: "MiniBrowser", "webkitgtk:browserOptions": { binary: "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser", args: ["--automation"] } } } });
const sid = s.value?.sessionId;
if (!sid) { console.log("no WebDriver session", JSON.stringify(s).slice(0, 300)); process.exit(2); }
const ex = async (script) => (await j("POST", `/session/${sid}/execute/sync`, { script, args: [] })).value;
const go = (url) => j("POST", `/session/${sid}/url`, { url });
const until = async (script, ms = 15000) => {
  let v = null;
  for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) { v = await ex(script).catch(() => null); if (v && v.ok) return v; }
  return v;
};
const SHELL = `const d = window.resonateDebug && window.resonateDebug(); return d && d.tuner ? { path: location.pathname, search: location.search, hash: location.hash, shell: document.documentElement.hasAttribute("data-shell"), open: d.song.open, set: d.song.set, song: d.song.state && d.song.state.song, place: d.place && d.place.open, overlay: d.overlay, hist: history.length, ok: true } : null;`;
try {
  await j("POST", `/session/${sid}/window/rect`, { width: 820, height: 1180 }).catch(() => {});
  console.log("UA", await ex("return navigator.userAgent + ' webdriver=' + navigator.webdriver"));
  await go(APP);
  let d = await until(SHELL);
  ok(d?.ok && d.shell && d.path === "/resonate/" && !d.open, `the root is the shell (${JSON.stringify(d)})`);
  await ex(`localStorage.setItem("resonate.redirect", "1"); localStorage.setItem("resonate.sing.song", "amazing-grace"); return 1;`);

  await go(APP + "sing.html");
  d = await until(SHELL.replace("ok: true", "ok: !!(d.song.open && d.song.set.sing && d.song.loaded)"), 25000);
  ok(d?.ok && d.path === "/resonate/" && !d.search && d.song === "amazing-grace", `sing.html → the shell, the last song with Sing (${JSON.stringify(d)})`);
  await go(APP + "play.html");
  d = await until(SHELL.replace("ok: true", "ok: !!(d.song.open && d.song.set.score && d.song.scoreLoaded)"), 30000);
  ok(d?.ok && d.path === "/resonate/" && !d.search, `play.html → the shell, the last song with the Score (${JSON.stringify(d && { ...d, hist: undefined })})`);
  await go(APP + "voice.html");
  d = await until(SHELL.replace("ok: true", 'ok: d.place && d.place.open === "voice"'), 15000);
  ok(d?.ok && d.path === "/resonate/", `voice.html → the shell with Voice in place (${d?.place})`);

  await go(APP + "tools.html");
  await sleep(500);
  const h0 = await ex("return history.length");
  await go(APP + "shell.html?x=1#f");
  d = await until(SHELL, 15000);
  ok(d?.ok && d.path === "/resonate/" && d.search === "?x=1" && d.hash === "#f" && d.hist === h0 + 1, `shell.html → the root with ?x=1#f, no entry of its own (${d?.path}${d?.search}${d?.hash}, history ${h0} → ${d?.hist})`);

  await go(APP + "#error=access_denied&error_code=otp_expired&error_description=x");
  const a = await until(`const m = document.getElementById("msg"); return /account\\.html$/.test(location.pathname) && m && /expired/.test(m.textContent) ? { ok: true, msg: m.textContent } : { path: location.pathname };`, 15000);
  ok(a?.ok, `an email link's error at the root → account.html (${JSON.stringify(a)})`);

  const LEFT = `return { away: document.documentElement.hasAttribute("data-away"), dbg: typeof window.resonateDebug, busy: typeof window.resonateBusy, play: typeof window.resonatePlay, path: location.pathname };`;
  for (const pg of ["sing", "play", "pdf-import"]) {
    await go(ROOT + `tmp/stay-${pg}.html`);
    await sleep(3300);
    const g = await ex(LEFT);
    ok(g?.away && g.dbg === "undefined" && g.busy === "undefined" && g.play === "undefined" && /stay-/.test(g.path), `${pg}.html on its way out (away.js, the answer never coming), 3 s later: none of its modules ran (${JSON.stringify(g)})`);
    const l = await ex(`const a = document.querySelector('a[href^="./?open="]'); return a && { href: a.getAttribute("href"), shown: getComputedStyle(document.documentElement).visibility };`);
    ok(l && /^\.\/\?open=[a-z]+$/.test(l.href) && l.shown === "visible", `${pg}.html: the shell not there after 3 s — a plain link to it (${JSON.stringify(l)})`);
  }
  for (const pg of ["sing", "play", "pdf-import"]) {
    await go(ROOT + `tmp/mark-${pg}.html`);
    await sleep(3000);
    const g = await ex(LEFT);
    console.log("INFO", `${pg}.html marked leaving, nav.js's wait alone: ${g?.dbg === "undefined" && g?.busy === "undefined" && g?.play === "undefined" ? "held back" : "ran anyway (WebKit)"} ${JSON.stringify(g)}`);
  }

  await ex(`localStorage.removeItem("resonate.redirect"); return 1;`);
  await go(APP + "sing.html");
  const st = await until(`return /sing\\.html$/.test(location.pathname) && window.resonateDebug ? { ok: true, away: document.documentElement.hasAttribute("data-away") } : null;`, 15000);
  ok(st?.ok && !st.away, "without resonate.redirect an automated browser stays on sing.html");
} finally {
  await j("DELETE", `/session/${sid}`);
}
console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
