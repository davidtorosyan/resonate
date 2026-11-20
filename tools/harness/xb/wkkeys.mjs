// WebKitGTK: hold a Sing chip with the mouse via WebDriver actions; log audio scheduling calls and errors.
const W = 'http://127.0.0.1:4444';
const j = async (method, path, body) => (await fetch(W + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })).json();
const s = await j('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'MiniBrowser', 'webkitgtk:browserOptions': { binary: '/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser', args: ['--automation'] } } } });
const sid = s.value.sessionId;
const ex = async (script) => (await j('POST', `/session/${sid}/execute/sync`, { script, args: [] })).value;
try {
  await j('POST', `/session/${sid}/url`, { url: 'http://localhost:8097/resonate/sing.html' });
  await new Promise((r) => setTimeout(r, 2500));
  console.log('UA', await ex('return navigator.userAgent'));
  await ex(`window.__ev = []; window.__err = [];
    const log = (t, x) => window.__ev.push(t + (x ? ' ' + x : ''));
    for (const [proto, name] of [[AudioBufferSourceNode.prototype, 'piano'], [OscillatorNode.prototype, 'sustain']]) {
      const S = proto.start; proto.start = function (w) { log(name + '.start', (+w).toFixed(3) + ' now ' + this.context.currentTime.toFixed(3) + ' state ' + this.context.state); return S.apply(this, arguments); };
      const T = proto.stop; proto.stop = function (w) { try { return T.apply(this, arguments); } catch (e) { window.__err.push(name + '.stop: ' + e.name + ' ' + e.message); throw e; } };
    }
    const C = AudioParam.prototype.cancelScheduledValues; AudioParam.prototype.cancelScheduledValues = function (t) { log('release', (+t).toFixed(3)); return C.apply(this, arguments); };
    window.addEventListener('error', (e) => window.__err.push(e.message));
    return 1;`);
  const rect = await ex(`const c = document.querySelectorAll('#chips .chip')[5]; c.scrollIntoView({block:'nearest'}); const r = c.getBoundingClientRect(); return [Math.round(r.x + r.width/2), Math.round(r.y + r.height/2)];`);
  const act = (pauseMs) => ({ actions: [{ type: 'pointer', id: 'm', parameters: { pointerType: 'mouse' }, actions: [
    { type: 'pointerMove', x: rect[0], y: rect[1], duration: 0 }, { type: 'pointerDown', button: 0 }, { type: 'pause', duration: pauseMs }, { type: 'pointerUp', button: 0 }] }] });
  // First press loads the piano; second is the real hold test.
  await j('POST', `/session/${sid}/actions`, act(100)); await new Promise((r) => setTimeout(r, 3000));
  await ex('window.__ev.length = 0; return 1');
  const t0 = Date.now();
  const r = await j('POST', `/session/${sid}/actions`, act(1500));
  console.log('actions took', Date.now() - t0, 'ms', JSON.stringify(r).slice(0, 200));
  await new Promise((r) => setTimeout(r, 600));
  console.log(JSON.stringify(await ex('return { ev: window.__ev, err: window.__err, ctx: (window.resonateDebug && 1), playing: [...document.querySelectorAll("#chips .chip")].filter(c => c.dataset.playing === "true").length }'), null, 1));
} finally { await j('DELETE', `/session/${sid}`); }
