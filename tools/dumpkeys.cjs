// The keyboard part's notes as public/finger.js takes them (E7, docs/FINGERING.md §3 "Input", §8):
// fingering.js keyboardNotes on the song as the Score reads it — ▶'s schedule in written order at the
// song's tempo, each note's staff and staff hand — dumped as JSON for tools/fingersurvey.mjs (node).
// Built inside the page from its own modules (playprep, playtime, fingering), in Chromium.
//
// usage: node dumpkeys.cjs          the bundled sample → tools/fixtures/finger/amazing-grace.json
//        PLAY_SCORES=<dir> node dumpkeys.cjs
//                                   also every <dir>/*.musicxml (the owner's converted scores) →
//                                   OUT/<name>.json (lib/paths.cjs: OUT, default <tmpdir>/resonate-dumpkeys)
//                                   — never into the repo
// Needs the page server (BASE, the harness's http://localhost:8097/resonate/).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { BASE, FIX, OUT, PUBLIC } = require('./lib/paths.cjs');

const SCORES = process.env.PLAY_SCORES || '';
const songs = [{ id: 'amazing-grace', name: 'amazing-grace', title: 'Amazing Grace', xml: fs.readFileSync(path.join(PUBLIC, 'songs/amazing-grace.musicxml'), 'utf8'), out: path.join(FIX, 'finger/amazing-grace.json') }];
if (SCORES && fs.existsSync(SCORES)) {
  for (const f of fs.readdirSync(SCORES).filter((f) => /\.musicxml$/i.test(f)).sort()) {
    const name = f.replace(/\.musicxml$/i, '');
    songs.push({ id: 's-' + name, name, xml: fs.readFileSync(path.join(SCORES, f), 'utf8'), out: path.join(OUT, name + '.json') });
  }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(BASE + 'tools.html');
  for (const s of songs) {
    const r = await page.evaluate(async ({ id, xml }) => {
      const v = '?v=' + document.getElementById('version').textContent.trim().replace(/^v/, '');
      const { prepare } = await import('./playprep.js' + v);
      const { timeline } = await import('./playtime.js' + v);
      const { cleanXml } = await import('./catalog.js' + v);
      const F = await import('./fingering.js' + v);
      const x = cleanXml(xml); // (as the Score reads it: a converted song's clean-ups)
      const P = prepare(x);
      const T = timeline(P.doc, P.facts);
      const kb = F.keyboardOf(P);
      const bpm = F.songTempo(id, x, T);
      const title = (/<movement-title>([^<]*)/.exec(x) || /<work-title>([^<]*)/.exec(x) || [])[1]?.trim() || id;
      // (each note's bar — its number in the MusicXML — and beat, 1 = the downbeat: where to look on the PDF)
      const nums = [...[...P.doc.documentElement.children].find((c) => c.nodeName === 'part')?.children || []].filter((c) => c.nodeName === 'measure').map((m, i) => m.getAttribute('number') || String(i + 1));
      const byId = new Map(T.els.map((e) => [e.id, e]));
      const items = F.keyboardNotes(P, T, bpm, kb).map((it) => { const e = byId.get(it.id); return { ...it, bar: nums[e.mi] ?? String(e.mi + 1), beat: Math.round((1 + e.o) * 1000) / 1000 }; });
      return { title, bpm, sig: F.xmlSig(x), alg: F.ALG, kind: P.views.both?.kind ?? null, parts: kb?.parts ?? null, items };
    }, { id: s.id, xml: s.xml });
    fs.mkdirSync(path.dirname(s.out), { recursive: true });
    fs.writeFileSync(s.out, JSON.stringify({ song: s.name, ...r, title: s.title || r.title }) + '\n');
    console.log(`${s.name}: ${r.items.length} notes (${r.kind}, ♩=${r.bpm}) → ${s.out}`);
  }
  await browser.close();
})().catch((err) => { console.error(err); process.exit(2); });
