// My songs index (localStorage) stays right; the cleaned-up copy is reused.
const { chromium } = require('playwright'); const fs = require('fs');
const SP = '/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad';
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const infos = []; p.on('console', (m) => { if (/OMR clean-ups on load/.test(m.text())) infos.push(m.text()); });
  await p.goto('http://localhost:8097/resonate/sing.html'); await p.waitForTimeout(1200);
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const big = fs.readFileSync(`${SP}/pm/x/pm.xml`, 'utf8'); // raw Audiveris export: needs clean-ups
  const r = await p.evaluate(async (big) => {
    const L = await import('/resonate/library.js');
    const out = {};
    const a = await L.addSong('A', '<score-partwise/>');
    await new Promise((r) => setTimeout(r, 5));
    const bb = await L.addSong('B', '<score-partwise/><!--b-->');
    await new Promise((r) => setTimeout(r, 5));
    const c = await L.addSong('C', big);
    out.list = (await L.listSongs()).map((s) => s.title).join(',');
    out.dup = (await L.addSong('A', '<score-partwise/>')) === a;
    localStorage.removeItem('resonate.songs.index');
    out.rebuilt = (await L.listSongs()).map((s) => s.title).join(',');
    await L.removeSong(bb);
    out.afterRemove = (await L.listSongs()).map((s) => s.title).join(',');
    // Deleted behind the index's back (another tab, a failed write): dropped when found missing.
    const db = await new Promise((res) => { const q = indexedDB.open('resonate'); q.onsuccess = () => res(q.result); });
    await new Promise((res) => { const tx = db.transaction('songs', 'readwrite'); tx.objectStore('songs').delete(a); tx.oncomplete = res; });
    out.missing = (await L.getSong(a)) === undefined;
    out.afterMissing = (await L.listSongs()).map((s) => s.title).join(',');
    out.c = c;
    return out;
  }, big);
  console.log(JSON.stringify(r));
  ok(r.list === 'C,B,A', 'newest first');
  ok(r.dup, 'saving the same song again keeps one copy');
  ok(r.rebuilt === 'C,B,A', 'index rebuilt when missing');
  ok(r.afterRemove === 'C,A', 'removed song leaves the index');
  ok(r.missing && r.afterMissing === 'C', 'a song gone from the database is dropped from the index');
  // Open the Audiveris song twice: cleaned once, then the saved clean copy is used.
  await p.evaluate((id) => localStorage.setItem('resonate.sing.song', id), r.c);
  await p.reload(); await p.waitForFunction(() => window.resonateDebug?.().notes?.length > 100, null, { timeout: 30000 }); await p.waitForTimeout(800);
  const first = infos.length;
  const clean = await p.evaluate(async (id) => { const L = await import('/resonate/library.js'); const s = await L.getSong(id); return { ver: s.clean?.ver, changed: !!s.clean?.xml, badge: document.getElementById('version').textContent }; }, r.c);
  const notes1 = await p.evaluate(() => window.resonateDebug().notes.map((n) => `${n.midi}:${n.text}`).join('|'));
  await p.reload(); await p.waitForFunction(() => window.resonateDebug?.().notes?.length > 100, null, { timeout: 30000 }); await p.waitForTimeout(500);
  const notes2 = await p.evaluate(() => window.resonateDebug().notes.map((n) => `${n.midi}:${n.text}`).join('|'));
  console.log('clean copy', JSON.stringify(clean), 'clean-up runs: first load', first, 'total', infos.length);
  ok(clean.ver === clean.badge && clean.changed, 'cleaned copy saved with the app version');
  ok(first === 1 && infos.length === 1, 'second load reuses it (no clean-up run)');
  ok(notes1 === notes2, 'same song either way');
  console.log('errors', errs);
  await b.close();
})();
