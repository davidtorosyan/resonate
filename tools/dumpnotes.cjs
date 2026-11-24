// Fixtures for practice.js (guided practice): the notes and lines the Sing page builds in
// applySong(), per song and verse, as JSON in tools/fixtures/ — for node tests and the
// practice simulator. Built inside the page from the page's own modules (musicxml.js,
// music.js, omr/fixscore.js), at the score's tempo (rate 1, no tapped map), no transpose.
//
// usage: [OUT=<dir>] node dumpnotes.cjs [file.musicxml …]
//   no arguments: the bundled samples + the owner's converted scores found under /tmp/claude-0
//   (Audiveris output with a real title, newest file per title). Those are local fixtures only:
//   never copy them into the repo.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:8097/resonate/';
const OUT = process.env.OUT || path.join(__dirname, 'fixtures'); // (OUT=<dir>: the owner's songs dumped outside the repo — earcases.mjs PLAY_SCORES)
const BUNDLED = [{ id: 'amazing-grace', title: 'Amazing Grace', url: 'songs/amazing-grace.musicxml' }];

function findConverted() {
  const files = [];
  const walk = (d, depth) => {
    if (depth > 7) return;
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!/node_modules|survey/.test(e.name)) walk(p, depth + 1); }
      else if (/\.musicxml$/i.test(e.name)) files.push(p);
    }
  };
  walk('/tmp/claude-0', 0);
  const best = new Map();
  for (const f of files) {
    const head = fs.readFileSync(f, 'utf8').slice(0, 6000);
    if (!/<software>\s*Audiveris/.test(head)) continue;
    const title = (/<movement-title>([^<]*)/.exec(head) || [])[1]?.trim();
    if (!title || /authorized|©|copyright/i.test(title)) continue;
    const m = fs.statSync(f).mtimeMs;
    if (!best.has(title) || best.get(title).m < m) best.set(title, { f, m, title });
  }
  return [...best.values()];
}

const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

(async () => {
  const args = process.argv.slice(2);
  const sources = [];
  if (args.length) for (const f of args) sources.push({ file: f });
  else {
    for (const b of BUNDLED) sources.push({ id: b.id, title: b.title, url: b.url });
    for (const c of findConverted()) sources.push({ file: c.f, title: c.title });
  }
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('page error:', e.message));
  await page.goto(BASE + 'tools.html');
  for (const src of sources) {
    const xml = src.file ? fs.readFileSync(src.file, 'utf8') : null;
    const data = await page.evaluate(async ({ xml, url, title }) => {
      const r = Math.random();
      const { parseMusicXml, notesForVerse, lyricLines } = await import('/resonate/musicxml.js?' + r);
      const { spellTransposed, transposeKey } = await import('/resonate/music.js?' + r);
      const { fixOmrScore } = await import('/resonate/omr/fixscore.js?' + r);
      let text = xml;
      if (!text) text = await (await fetch('/resonate/' + url)).text();
      // (as sing.js songXml: Audiveris scores get the clean-ups on load)
      if (/<software>\s*Audiveris/.test(text.slice(0, 4000))) text = fixOmrScore(text).xml;
      const score = parseMusicXml(text, title);
      if (title) score.title = title;
      // sing.js helpers, at rate 1 with no tapped map
      const spq = 60 / score.tempo;
      const qToT = (q) => q * spq;
      const meterAt = (mi) => score.meters?.[mi] || [score.beats, score.beatType];
      const measureAt = (q) => { let m = 0; score.measures.forEach((x, i) => { if (x <= q + 1e-6) m = i; }); return m; };
      const barQOf = (mi) => { const [b, t] = meterAt(mi); return (b * 4) / t; };
      const flats = transposeKey(score.fifths, 0).fifths < 0;
      const verses = score.verses.length ? score.verses : ['1'];
      const byVerse = {};
      for (const verse of verses) {
        const ns = notesForVerse(score, verse);
        const notes = ns.map((n) => {
          const mi = measureAt(n.onset);
          return {
            wmidi: n.midi,
            midi: n.midi,
            name: spellTransposed(n, 0, transposeKey(score.fifths, 0).steps, flats).name,
            q: n.onset,
            dq: n.dur,
            t: qToT(n.onset),
            d: qToT(n.onset + n.dur) - qToT(n.onset),
            text: n.text,
            syllabic: n.syllabic,
            melisma: n.melisma,
            restBefore: n.restBefore,
            pass: n.pass ?? 1,
            measure: n.measure,
            mi,
            barQ: barQOf(mi),
            fermata: n.fermata || undefined,
          };
        });
        byVerse[verse] = { notes, lines: lyricLines(ns) };
      }
      return {
        title: score.title, tempo: score.tempo, spq, fifths: score.fifths, verses,
        measures: score.measures, meters: score.meters || null, measureOf: score.measureOf || null,
        barQ: score.measures.map((_, mi) => barQOf(mi)), length: score.length,
        unfolded: score.unfolded || null, byVerse,
      };
    }, { xml, url: src.url, title: src.title });
    const name = src.id || slug(data.title || path.basename(src.file, '.musicxml'));
    data.id = name;
    data.source = src.file ? 'converted' : 'bundled';
    const out = path.join(OUT, `${name}.json`);
    fs.writeFileSync(out, JSON.stringify(data));
    const v1 = data.byVerse[data.verses[0]];
    console.log(`${out}: "${data.title}" ♩=${Math.round(data.tempo)} · ${data.verses.length} verse(s) · ${v1.notes.length} notes · ${v1.lines.length} lines${data.unfolded ? ` · ${data.unfolded.played} played measures` : ''}`);
  }
  await browser.close();
})();
