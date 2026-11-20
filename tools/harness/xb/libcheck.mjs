// WebKitGTK: songs saved the old way (no index), then open the Sing page: does My songs list them?
const W = 'http://127.0.0.1:4444';
const j = async (method, path, body) => (await fetch(W + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })).json();
const s = await j('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'MiniBrowser',
  'webkitgtk:browserOptions': { binary: '/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser', args: ['--automation'] } } } });
const sid = s.value.sessionId;
await j('POST', `/session/${sid}/timeouts`, { script: 120000 });
const run = async (script) => (await j('POST', `/session/${sid}/execute/async`, { script, args: [] })).value;
const url = 'http://localhost:8097/resonate/sing.html';
await j('POST', `/session/${sid}/url`, { url });
await new Promise((r) => setTimeout(r, 3000));
console.log('at:', JSON.stringify(await run(`arguments[arguments.length - 1](location.href + ' secure=' + isSecureContext)`)));
console.log('seed:', JSON.stringify(await run(`const done = arguments[arguments.length - 1];
  try { localStorage.removeItem('resonate.songs.index'); } catch {}
  const q = indexedDB.open('resonate', 1);
  q.onupgradeneeded = () => q.result.createObjectStore('songs', { keyPath: 'id' });
  q.onsuccess = () => { const db = q.result; const tx = db.transaction('songs', 'readwrite');
    const big = '<score-partwise><work><work-title>x</work-title></work>' + 'x'.repeat(800000) + '</score-partwise>';
    for (let i = 0; i < 4; i++) tx.objectStore('songs').put({ id: 'old' + i, title: 'Old song ' + i, xml: big, added: Date.now() + i });
    tx.oncomplete = () => { db.close(); done('seeded'); };
    tx.onerror = () => done('seed error ' + tx.error); };
  q.onerror = () => done('open error ' + q.error);`)));
await j('POST', `/session/${sid}/url`, { url });
await new Promise((r) => setTimeout(r, 4000));
console.log('list:', JSON.stringify(await run(`const done = arguments[arguments.length - 1];
  (async () => {
    const opts = [...document.querySelectorAll('#my-songs option')].map((o) => o.textContent);
    let lib = null, err = null;
    try { const L = await import('/resonate/library.js'); lib = (await L.listSongs()).map((s) => s.title); } catch (e) { err = String(e && e.stack || e); }
    done({ opts, lib, err, status: document.getElementById('status').textContent, msg: document.getElementById('song-msg').textContent, ua: navigator.userAgent.slice(-40) });
  })();`)));
await j('DELETE', `/session/${sid}`);
