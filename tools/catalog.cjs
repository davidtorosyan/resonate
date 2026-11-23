// catalog.js (SAMPLES, cleanXml, songXml, loadSong, songChoices) and musicxml.js pickMelody, in the
// browser; and the Sing page still opening a converted song through them (clean-up cache kept).
// usage: node catalog.cjs [scores dir with the owner's converted *.musicxml]   (server: 8097)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8097/resonate/';
const SCORES = process.argv[2] || '/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/play/scores';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(BASE + 'tools.html');
  const scores = fs.existsSync(SCORES) ? fs.readdirSync(SCORES).filter((f) => f.endsWith('.musicxml')).map((f) => ({ name: f, xml: fs.readFileSync(path.join(SCORES, f), 'utf8') })) : [];
  const r = await page.evaluate(async (scores) => {
    const C = await import('./catalog.js?v=76');
    const L = await import('./library.js?v=76');
    const M = await import('./musicxml.js?v=76');
    const out = {};
    out.samples = C.SAMPLES;
    const s = await C.loadSong('amazing-grace');
    out.sample = { id: s.id, title: s.title, source: s.source, len: s.xml.length, partwise: /<score-partwise/.test(s.xml) };
    out.missing = await C.loadSong('s-nope-404');
    out.none = await C.loadSong('');
    // A converted (Audiveris) song: cleaned on first load and the clean copy saved, tagged with the version badge.
    const conv = scores.find((x) => /<software>\s*Audiveris/.test(x.xml.slice(0, 4000)));
    if (conv) {
      const id = await L.addSong('Catalog test ' + conv.name, conv.xml, { source: 'pdf' });
      const a = await C.loadSong(id);
      await new Promise((r) => setTimeout(r, 300));
      const stored = await L.getSong(id);
      const b = await C.loadSong(id);
      out.conv = { id, title: a.title, source: a.source, cleanedDiffers: a.xml !== conv.xml, sameTwice: a.xml === b.xml,
        cleanVer: stored.clean?.ver, cleanMatches: (stored.clean?.xml ?? stored.xml) === a.xml, equalsCleanXml: a.xml === C.cleanXml(conv.xml) };
      const ch = await C.songChoices();
      out.choices = { samples: ch.samples, mineHas: ch.mine.some((m) => m.id === id), mineFields: Object.keys(ch.mine[0] || {}) };
      await L.removeSong(id);
    }
    // pickMelody on every score (as Sing cleans them) + the bundled one.
    const pick = (xml) => { const doc = new DOMParser().parseFromString(xml, 'application/xml'); const p = M.pickMelody(doc.documentElement); return p && { partId: p.partId, voice: p.voice, staff: p.staff, partEl: p.part?.nodeName }; };
    out.melody = { 'amazing-grace': pick(s.xml) };
    for (const x of scores) out.melody[x.name] = pick(C.cleanXml(x.xml));
    out.noParts = M.pickMelody(new DOMParser().parseFromString('<score-partwise/>', 'application/xml').documentElement);
    return out;
  }, scores);
  console.log(JSON.stringify(r.melody));
  ok(r.samples['amazing-grace']?.url === 'songs/amazing-grace.musicxml', 'SAMPLES');
  ok(r.sample.id === 'amazing-grace' && r.sample.title === 'Amazing Grace' && r.sample.source === 'sample' && r.sample.partwise, 'loadSong(sample) ' + JSON.stringify(r.sample));
  ok(r.missing === null && r.none === null, 'loadSong(missing) → null');
  if (r.conv) {
    ok(r.conv.source === 'pdf' && r.conv.title.startsWith('Catalog test'), 'loadSong(library) title/source');
    const badge = (await page.textContent("#version")).trim(); // (the clean-up is tagged with the page's version badge)
    ok(r.conv.cleanVer === badge && r.conv.cleanMatches, `clean-up saved with the song, tagged ${badge}: ${r.conv.cleanVer}`);
    ok(r.conv.sameTwice && r.conv.equalsCleanXml, 'cached copy = cleanXml(original)');
    ok(r.choices.samples.length === 1 && r.choices.samples[0].id === 'amazing-grace' && r.choices.mineHas, 'songChoices ' + JSON.stringify(r.choices));
  }
  ok(r.melody['amazing-grace']?.partId === 'P1' && r.melody['amazing-grace'].voice === '1' && r.melody['amazing-grace'].partEl === 'part', 'pickMelody hymn = P1 voice 1');
  if (r.melody['longest.musicxml']) ok(r.melody['longest.musicxml'].partId === 'P1' && r.melody['longest.musicxml'].staff === '1' && r.melody['longest.musicxml'].voice === '1', 'pickMelody Longest Time = P1 staff 1 voice 1');
  ok(r.noParts === null, 'pickMelody with no parts → null');

  // The Sing page opens a converted song through catalog.js (and keeps the cache).
  const conv = scores.find((x) => /<software>\s*Audiveris/.test(x.xml.slice(0, 4000)) && x.name.startsWith('wichita')) || scores[0];
  if (conv) {
    const id = await page.evaluate(async (xml) => { const L = await import('./library.js?v=76'); return L.addSong('Catalog sing test', xml); }, conv.xml);
    await page.evaluate((id) => { localStorage.setItem('resonate.sing.song', id); localStorage.setItem('resonate.sing.ear', 'off'); }, id);
    await page.goto(BASE + 'sing.html');
    await page.waitForFunction(() => window.resonateDebug?.()?.notes?.length > 0, null, { timeout: 30000 }).catch(() => {});
    const d = await page.evaluate(async (id) => { const L = await import('./library.js?v=76'); await new Promise((r) => setTimeout(r, 500)); const s = await L.getSong(id); const dbg = window.resonateDebug(); return { notes: dbg.notes.length, title: dbg.title ?? document.querySelector('#song-select option:checked')?.textContent, ver: s.clean?.ver }; }, id);
    ok(d.notes > 0 && d.ver === (await page.textContent("#version")).trim(), `Sing opens the converted song (${conv.name}): ${d.notes} notes, clean ${d.ver}`);
    // ⤓ (download) uses songXml too: the remove button hidden for samples only.
    const rm = await page.evaluate(() => document.getElementById('remove-song').hidden);
    ok(rm === false, 'remove button shown for a library song (SAMPLES check)');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }).catch(() => null), page.click('#save-song')]);
    const dlText = dl ? fs.readFileSync(await dl.path(), 'utf8') : '';
    const cleanNow = await page.evaluate(async (id) => { const L = await import('./library.js?v=76'); const s = await L.getSong(id); return s.clean?.xml ?? s.xml; }, id);
    ok(!!dl && dlText === cleanNow && /\.musicxml$/.test(dl.suggestedFilename()), `⤓ downloads the cleaned song (${dl?.suggestedFilename()}, ${dlText.length} B)`);
    await page.evaluate(async (id) => { const L = await import('./library.js?v=76'); await L.removeSong(id); localStorage.removeItem('resonate.sing.song'); localStorage.removeItem('resonate.sing.ear'); }, id);
  }
  ok(!errs.length, 'no page errors ' + JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
