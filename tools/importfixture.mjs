// A real recorded import (the page's resonateDebug().eventList, saved by importresume.cjs as
// fixtures/import/<name>.events.json: absolute `at`, previews as data URLs) → a Reader fixture
// (fixtures/reader/<out>/events.json: { name, events: [{ at: ms from the start, ev }] } + p<N>.webp).
//   node importfixture.mjs [in.events.json] [out-name]
import fs from 'node:fs';
import path from 'node:path';
const src = process.argv[2] || '/home/user/tools/fixtures/import/greensleeves3.events.json';
const name = process.argv[3] || 'greensleeves3-real';
const out = path.join('/home/user/tools/fixtures/reader', name);
const j = JSON.parse(fs.readFileSync(src, 'utf8'));
const list = Array.isArray(j) ? j : j.events;
fs.mkdirSync(out, { recursive: true });
const t0 = list.find((e) => Number.isFinite(e.at))?.at ?? 0;
let last = 0;
const events = list.map((e) => {
  const { at, ...ev } = e;
  const t = Number.isFinite(at) ? at - t0 : last; // (pdfprep's page events carry no stamp of their own when replayed)
  last = t;
  if (ev.t === 'page' && typeof ev.preview === 'string' && ev.preview.startsWith('data:')) {
    const m = /^data:image\/(\w+);base64,(.*)$/.exec(ev.preview);
    const file = `p${ev.page}.${m[1] === 'png' ? 'png' : 'webp'}`;
    fs.writeFileSync(path.join(out, file), Buffer.from(m[2], 'base64'));
    ev.preview = file;
  }
  return { at: t, ev };
});
fs.writeFileSync(path.join(out, 'events.json'), JSON.stringify({ name: j.name || name, recorded: j.recorded || null, real: true, events }));
console.log(`${events.length} events, ${Math.round(last / 1000)} s → ${out}`);
