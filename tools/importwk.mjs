// WebKitGTK (Safari stand-in) smoke for PDF → Song as a resumable job: the importer harness
// (sitetest/imptest.html) converts amazing-grace1.pdf (1 page) — trace events, OCR words, the book copy
// after the page — then the page is reloaded right after the page was stored and the job is resumed:
// the book is put back (CheerpJ library mode) and Audiveris exports without reading the page again.
// Needs Xvfb :99 + WebKitWebDriver on :4444 (/home/user/xb).   usage: node importwk.mjs
const W = 'http://127.0.0.1:4444';
const j = async (method, path, body) => (await fetch(W + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })).json();
const s = await j('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'MiniBrowser', 'webkitgtk:browserOptions': { binary: '/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser', args: ['--automation'] } } } });
const sid = s.value.sessionId;
const ex = async (script) => (await j('POST', `/session/${sid}/execute/sync`, { script, args: [] })).value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fails++; };
const t0 = Date.now();
const until = async (cond, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await ex(cond).catch(() => null); if (v) return v; await sleep(2000); } return null; };
try {
  await j('POST', `/session/${sid}/url`, { url: 'http://localhost:8097/imptest.html?pdf=/imp/amazing-grace1.pdf' });
  // clean slate: no job left from an earlier run (the harness started one already — its id is kept)
  console.log('UA', await ex('return navigator.userAgent'));
  const kept = await until(`const f = JSON.parse(localStorage.getItem('resonate.import') || 'null'); return f && f.done >= 1 ? f : (window.__err ? { err: window.__err } : null)`, 20 * 60000);
  ok(kept && kept.done === 1, `page read and its book kept: ${JSON.stringify(kept)} (${Math.round((Date.now() - t0) / 1000)} s)`);
  const ev = await ex(`const k = {}; for (const e of window.__ev) k[e.t] = (k[e.t] || 0) + 1; const p = window.__ev.find((e) => e.t === 'page'); return { k, preview: p && p.preview && p.preview.type, size: p && p.preview && p.preview.size, staves: p && p.staves.length, words: window.__ev.filter((e) => e.t === 'words').reduce((a, e) => a + e.words.length, 0) }`);
  console.log(JSON.stringify(ev));
  ok(ev.k.sym > 20 && ev.k.notes >= 1 && ev.k.grid === 1 && ev.words > 20, `trace + OCR events in WebKit (${ev.k.sym} sym, ${ev.k.notes} notes, ${ev.words} words)`);
  ok(/image\/(webp|png)/.test(ev.preview || '') && ev.size > 5000 && ev.staves >= 3, `page preview ${ev.preview} ${ev.size} B, ${ev.staves} staves`);
  await sleep(1500);
  await j('POST', `/session/${sid}/url`, { url: 'http://localhost:8097/imptest.html?resume=1' });
  const res = await until(`return window.__res ? { notes: window.__res.notes, title: window.__res.title } : window.__err ? { err: window.__err } : null`, 15 * 60000);
  const log = await ex(`return window.__log.join('\\n')`);
  ok(res && res.notes > 20, `resumed in WebKit: ${JSON.stringify(res)}`);
  ok(/book put back/.test(log) && !/\| LOAD/.test(log) && /K 1 1|exported to/.test(log), 'the book put back; the page not read again');
  console.log(log.split('\n').filter((l) => /resume|Book reaching|Nothing|exported to|LOAD/.test(l)).slice(0, 12).join('\n'));
  ok(await ex(`return window.__stored`) > 50, `stored events for the Reader: ${await ex('return window.__stored')}`);
  ok(!(await ex(`return localStorage.getItem('resonate.import')`)), 'job gone once saved');
} catch (err) {
  ok(false, `threw ${err.stack || err}`);
}
await j('DELETE', `/session/${sid}`);
console.log(fails ? `${fails} FAILED` : `all passed in ${Math.round((Date.now() - t0) / 1000)} s`);
process.exit(fails ? 1 : 0);
