const W = 'http://127.0.0.1:4444';
const j = async (method, path, body) => (await fetch(W + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })).json();
const s = await j('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'MiniBrowser',
  'webkitgtk:browserOptions': { binary: '/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser', args: ['--automation'] } } } });
const sid = s.value?.sessionId;
console.log('session', sid ? 'ok' : JSON.stringify(s).slice(0, 300));
try {
  await j('POST', `/session/${sid}/timeouts`, { script: 30000, pageLoad: 30000 });
  const run = async (script) => (await j('POST', `/session/${sid}/execute/async`, { script, args: [] })).value;
  const go = async (u) => { await j('POST', `/session/${sid}/url`, { url: u }); await new Promise((r) => setTimeout(r, 2500)); };
  await go('http://localhost:8097/resonate/tools.html');
  console.log('at:', JSON.stringify(await run(`arguments[arguments.length - 1](location.href + ' secure=' + isSecureContext + ' ls=' + (() => { try { localStorage.setItem('x','1'); return 'ok'; } catch (e) { return e.name; } })() + ' idb=' + (() => { try { indexedDB.open('t'); return 'ok'; } catch (e) { return e.name + ':' + e.message; } })())`)));
} finally {
  await j('DELETE', `/session/${sid}`);
}
