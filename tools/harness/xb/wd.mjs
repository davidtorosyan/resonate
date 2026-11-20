// Minimal WebDriver client for WebKitWebDriver: open a URL with the proxy, keep the session for N minutes.
const [url, minutes = 15] = process.argv.slice(2);
const W = 'http://127.0.0.1:4444';
const j = async (method, path, body) => { const r = await fetch(W + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }); return r.json(); };
const proxy = new URL(process.env.HTTPS_PROXY);
const caps = { capabilities: { alwaysMatch: { browserName: 'MiniBrowser', acceptInsecureCerts: false,

  'webkitgtk:browserOptions': { binary: '/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser', args: ['--automation'] } } } };
const s = await j('POST', '/session', caps);
console.log(JSON.stringify(s).slice(0, 400));
const sid = s.value?.sessionId; if (!sid) process.exit(1);
console.log(JSON.stringify(await j('POST', `/session/${sid}/url`, { url })).slice(0, 200));
const ua = await j('POST', `/session/${sid}/execute/sync`, { script: 'return navigator.userAgent + " | mem " + (navigator.deviceMemory||"?") + " | cores " + navigator.hardwareConcurrency', args: [] });
console.log('UA', ua.value);
await new Promise((r) => setTimeout(r, minutes * 60000));
await j('DELETE', `/session/${sid}`);
