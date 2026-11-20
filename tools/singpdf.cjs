// Sing and a PDF-only song (v90, docs/LIBRARY.md §6), offline: resonateSing.open(id) → true for a
// MusicXML song, false for a PDF only (nothing changes: "“Title” is a PDF — convert it in Songs."), the
// menu lists it disabled as "Title · PDF", the remote's open_song answers pdf_only, a boot with a PDF-only
// song saved opens Amazing Grace and keeps the saved choice, a song that can't be read rolls back, and
// ✕ forgets a song (forget.js: its per-song settings go, Amazing Grace opens). A song Sing holds deleted
// elsewhere (the shell's Delete while its Score is on another song) → Amazing Grace stands in, the saved
// song (that other one) left alone.
//   node singpdf.cjs                    (http://localhost:8097; BASE=… for another server)
const { chromium } = require('playwright');
const U = (process.env.BASE || 'http://localhost:8097').replace(/\/$/, '') + '/resonate/';
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  await p.goto(U + 'sing.html');
  await p.waitForFunction(() => window.resonateSing?.state?.().song, null, { timeout: 15000 });
  const V = await p.evaluate(() => document.getElementById('version').textContent.trim().replace(/^v/, '')); // (the page's own modules)
  const ids = await p.evaluate(async (V) => {
    const L = await import(`/resonate/library.js?v=${V}`);
    const xml = await (await fetch('/resonate/songs/amazing-grace.musicxml')).text();
    const m = await L.addSong('My Grace', xml, { source: 'file' });
    const pdf = await L.addPdfSong(new Uint8Array([37, 80, 68, 70, 1, 2, 3]).buffer, { name: 'Some_Song.pdf', title: 'Some Song' });
    return { m, pdf };
  }, V);
  // open(M) → true
  let r = await p.evaluate((id) => window.resonateSing.open(id), ids.m);
  let st = await p.evaluate(() => ({ ...window.resonateSing.state(), saved: localStorage.getItem('resonate.sing.song'), value: document.getElementById('song-select').value }));
  check(r === true && st.song === ids.m && st.saved === ids.m && st.value === ids.m, `open(M) → true (${r}, ${JSON.stringify(st)})`);
  // menu: P disabled "· PDF"
  const opt = await p.evaluate((id) => { const o = document.querySelector(`#my-songs option[value="${id}"]`); return o && { text: o.textContent, disabled: o.disabled }; }, ids.pdf);
  check(opt && opt.disabled && opt.text === 'Some Song · PDF', `menu lists it disabled (${JSON.stringify(opt)})`);
  // open(P) → false, nothing changes
  r = await p.evaluate((id) => window.resonateSing.open(id), ids.pdf);
  st = await p.evaluate(() => ({ ...window.resonateSing.state(), saved: localStorage.getItem('resonate.sing.song'), value: document.getElementById('song-select').value, msg: document.getElementById('song-msg').textContent, notes: window.resonateDebug().notes.length }));
  check(r === false && st.song === ids.m && st.saved === ids.m && st.value === ids.m && /“Some Song” is a PDF — convert it in Songs\./.test(st.msg) && st.notes > 0, `open(P) → false, nothing changes (${JSON.stringify(st)})`);
  // remote open_song
  const rr = await p.evaluate(async (V) => { const { remote } = await import(`/resonate/assist.js?v=${V}`); return remote.hooks.run('open_song', { song: 'some song' }); }, V);
  check(rr.ok === false && rr.pdf_only === true && rr.id === ids.pdf && /only a PDF/.test(rr.error), `remote open_song → pdf_only (${JSON.stringify(rr)})`);
  const rr2 = await p.evaluate(async (V) => { const { remote } = await import(`/resonate/assist.js?v=${V}`); return remote.hooks.run('open_song', { song: 'amazing grace' }); }, V);
  check(rr2.ok === true && rr2.song?.id === 'amazing-grace', `remote open_song AG → ok (${JSON.stringify(rr2.song)})`);
  // boot with the PDF-only song saved → Amazing Grace, saved choice kept
  await p.evaluate((id) => localStorage.setItem('resonate.sing.song', id), ids.pdf);
  await p.reload();
  await p.waitForFunction(() => window.resonateSing?.state?.().song, null, { timeout: 15000 });
  st = await p.evaluate(() => ({ ...window.resonateSing.state(), saved: localStorage.getItem('resonate.sing.song') }));
  check(st.song === 'amazing-grace' && st.saved === ids.pdf, `boot: Amazing Grace, saved kept (${JSON.stringify(st)})`);
  // a choice of M after it: saved
  r = await p.evaluate((id) => window.resonateSing.open(id), ids.m);
  check(r === true && (await p.evaluate(() => localStorage.getItem('resonate.sing.song'))) === ids.m, 'then M is saved');
  // a song that can't be read: rollback
  r = await p.evaluate(() => window.resonateSing.open('s0000nothere'));
  st = await p.evaluate(() => ({ ...window.resonateSing.state(), saved: localStorage.getItem('resonate.sing.song'), value: document.getElementById('song-select').value, msg: document.getElementById('song-msg').textContent }));
  check(r === false && st.song === ids.m && st.saved === ids.m && st.value === ids.m, `unreadable → false, back to M (${JSON.stringify(st)})`);
  // ✕ on M: forgetSong (keys / practice / play gone), Amazing Grace opens
  await p.evaluate((id) => {
    for (const k of ['resonate.sing.keys', 'resonate.sing.practice', 'resonate.play', 'resonate.sing.history']) localStorage.setItem(k, JSON.stringify({ [id]: 1, other: 2 }));
  }, ids.m);
  await p.evaluate((id) => window.resonateSing.open(id), ids.m);
  await p.evaluate(() => { const x = document.getElementById('remove-song'); x.hidden = false; x.click(); });
  await p.waitForFunction(() => window.resonateSing.state().song === 'amazing-grace', null, { timeout: 10000 });
  await p.waitForTimeout(500);
  st = await p.evaluate(async ({ id, V }) => {
    const L = await import(`/resonate/library.js?v=${V}`);
    return { gone: !(await L.getSong(id)), keys: ['resonate.sing.keys', 'resonate.sing.practice', 'resonate.play', 'resonate.sing.history'].map((k) => JSON.parse(localStorage.getItem(k))), saved: localStorage.getItem('resonate.sing.song'), opt: !!document.querySelector(`#my-songs option[value="${id}"]`), value: document.getElementById('song-select').value };
  }, { id: ids.m, V });
  check(st.gone && st.keys.every((o) => !(ids.m in o) && o.other === 2) && st.saved === 'amazing-grace' && !st.opt && st.value === 'amazing-grace', `✕ forgets it (${JSON.stringify(st)})`);
  // Sing holds M2 while the saved song is another (the shell: its Score opened Y, Sing stayed on M2 —
  // hidden); M2 deleted (forget.js, the shell's Delete) → Amazing Grace stands in, the saved song
  // stays Y — not Amazing Grace (a reload or Next-up would have opened that)
  const m2 = await p.evaluate(async (V) => {
    const L = await import(`/resonate/library.js?v=${V}`);
    return L.addSong('My Grace 2', (await (await fetch('/resonate/songs/amazing-grace.musicxml')).text()) + ' ', { source: 'file' });
  }, V);
  r = await p.evaluate((id) => window.resonateSing.open(id), m2);
  await p.evaluate((id) => localStorage.setItem('resonate.sing.song', id), ids.pdf);
  await p.evaluate(async ({ id, V }) => (await import(`/resonate/forget.js?v=${V}`)).forgetSong(id), { id: m2, V });
  await p.waitForFunction(() => window.resonateSing.state().song === 'amazing-grace', null, { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(500);
  st = await p.evaluate(() => ({ ...window.resonateSing.state(), saved: localStorage.getItem('resonate.sing.song'), value: document.getElementById('song-select').value }));
  check(r === true && st.song === 'amazing-grace' && st.value === 'amazing-grace' && st.saved === ids.pdf, `held song deleted elsewhere → Amazing Grace, the saved song left alone (${JSON.stringify(st)})`);
  // and when the saved song was the one deleted: cleared (forget.js), not set to Amazing Grace
  const m3 = await p.evaluate(async (V) => {
    const L = await import(`/resonate/library.js?v=${V}`);
    return L.addSong('My Grace 3', (await (await fetch('/resonate/songs/amazing-grace.musicxml')).text()) + '  ', { source: 'file' });
  }, V);
  await p.evaluate((id) => window.resonateSing.open(id), m3);
  await p.evaluate(async ({ id, V }) => (await import(`/resonate/forget.js?v=${V}`)).forgetSong(id), { id: m3, V });
  await p.waitForFunction(() => window.resonateSing.state().song === 'amazing-grace', null, { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(500);
  st = await p.evaluate(() => ({ ...window.resonateSing.state(), saved: localStorage.getItem('resonate.sing.song') }));
  check(st.song === 'amazing-grace' && st.saved === null, `the saved song deleted → cleared, Amazing Grace stands in (${JSON.stringify(st)})`);
  await p.evaluate(async ({ id, V }) => (await import(`/resonate/library.js?v=${V}`)).removeSong(id), { id: ids.pdf, V });
  check(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'all ok');
  process.exit(fails ? 1 : 0);
})();
