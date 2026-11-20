// Compare old vs new Sing parser on several scores: note counts and the notes that changed.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('http://localhost:8097/resonate/tools.html');
  const files = process.argv.slice(2);
  const out = await p.evaluate(async (files) => {
    const NEW = await import('/resonate/musicxml.js');
    const OLD = await import('/tmp/musicxml-old.js');
    const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const res = [];
    for (const f of files) {
      const buf = await (await fetch(f)).arrayBuffer();
      const file = new File([buf], f.split('/').pop());
      const xml = await NEW.readScoreFile(file);
      const a = OLD.parseMusicXml(xml, 'x'), c = NEW.parseMusicXml(xml, 'x');
      const key = (n) => `${n.onset}`;
      const newOn = new Set(c.notes.map(key));
      const merged = a.notes.filter((n) => !newOn.has(key(n))).map((n) => `m${n.measure} ${names[n.midi % 12]}${Math.floor(n.midi / 12) - 1}`);
      res.push(`${f.split('/').pop()}: old ${a.notes.length} → new ${c.notes.length}${merged.length ? ' merged: ' + merged.join(', ') : ''}`);
    }
    return res;
  }, files);
  console.log(out.join('\n'));
  await b.close();
})();
