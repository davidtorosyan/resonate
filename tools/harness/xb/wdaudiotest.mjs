const [url] = process.argv.slice(2);
const W = 'http://127.0.0.1:4444';
const j = async (method, path, body) => (await fetch(W + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })).json();
const s = await j('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'MiniBrowser', 'webkitgtk:browserOptions': { binary: '/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser', args: ['--automation'] } } } });
const sid = s.value.sessionId;
await j('POST', `/session/${sid}/url`, { url });
const ex = async (script) => (await j('POST', `/session/${sid}/execute/sync`, { script, args: [] })).value;
await ex('window.__errs = []; window.addEventListener("error", (e) => window.__errs.push(e.message)); window.addEventListener("unhandledrejection", (e) => window.__errs.push(String(e.reason))); return 1;');
await new Promise((r) => setTimeout(r, 3000));
const els = await j('POST', `/session/${sid}/elements`, { using: 'css selector', value: '.test button' });
for (let i = 0; i < els.value.length; i++) {
  const id = Object.values(els.value[i])[0];
  await j('POST', `/session/${sid}/element/${id}/click`, {});
  for (let k = 0; k < 40; k++) { await new Promise((r) => setTimeout(r, 300)); if (!(await ex('return window.resonateDebug().running;'))) break; }
  console.log(i + 1, await ex(`return document.querySelectorAll('.test .out')[${i}].textContent;`));
}
console.log(JSON.stringify(await ex('return window.__errs.filter((e) => !/ResizeObserver/.test(e));')));
await j('DELETE', `/session/${sid}`);
