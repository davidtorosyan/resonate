// WebKitGTK: open the Sing page, tap Listen with a real (WebDriver) click, report what was scheduled.
const [url] = process.argv.slice(2);
const W = 'http://127.0.0.1:4444';
const j = async (method, path, body) => (await fetch(W + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })).json();
const s = await j('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'MiniBrowser', 'webkitgtk:browserOptions': { binary: '/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser', args: ['--automation'] } } } });
const sid = s.value.sessionId;
await j('POST', `/session/${sid}/url`, { url });
await j('POST', `/session/${sid}/timeouts`, { script: 60000 });
const ex = async (script) => (await j('POST', `/session/${sid}/execute/sync`, { script, args: [] })).value;
await ex('window.__n = []; window.__errs = []; window.addEventListener("error", (e) => window.__errs.push(e.message)); const S = AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start = function (w) { window.__n.push(+(w - this.context.currentTime).toFixed(2)); return S.apply(this, arguments); }; return 1;');
await new Promise((r) => setTimeout(r, 2500));
const el = await j('POST', `/session/${sid}/element`, { using: 'css selector', value: '#listen' });
const id = Object.values(el.value)[0];
await j('POST', `/session/${sid}/element/${id}/click`, {});
await new Promise((r) => setTimeout(r, 9000));
console.log(JSON.stringify(await ex('const d = window.resonateDebug(); return { sess: d.session && d.session.kind, nowT: +d.nowT.toFixed(2), status: document.getElementById("status").textContent, scheduled: window.__n.length, maxAhead: Math.max(...window.__n), errs: window.__errs.filter((e) => !/ResizeObserver/.test(e)) };')));
await j('DELETE', `/session/${sid}`);
