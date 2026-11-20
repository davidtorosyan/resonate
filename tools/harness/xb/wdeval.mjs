// Open url, then run an async script and print the result.
const [url, script] = process.argv.slice(2);
const W = 'http://127.0.0.1:4444';
const j = async (method, path, body) => (await fetch(W + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })).json();
const proxy = new URL(process.env.HTTPS_PROXY);
const s = await j('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'MiniBrowser',

  'webkitgtk:browserOptions': { binary: '/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser', args: ['--automation'] } } } });
const sid = s.value.sessionId;
await j('POST', `/session/${sid}/url`, { url });
const r = await j('POST', `/session/${sid}/timeouts`, { script: 120000 });
console.log(JSON.stringify(await j('POST', `/session/${sid}/execute/async`, { script, args: [] })).slice(0, 2000));
await j('DELETE', `/session/${sid}`);
