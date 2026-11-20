// Unit test of public/omr/jobs.js (the import job store) in Chromium's real IndexedDB, plus the
// ENGINE id against lib/audiveris.jar and the importer's crash-loop / pending logic without an engine.
//   node jobstore.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const crypto = require('crypto');
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.goto('http://localhost:8097/resonate/tools.html');
  const omr = fs.readFileSync('/home/user/tools/fixtures/import/greensleeves3-skip2.omr').toString('base64');
  const r = await p.evaluate(async (omrB64) => {
    const J = await import('/resonate/omr/jobs.js?v=80');
    const out = {};
    const id = J.newId();
    const job = { id, space: 'anon', name: 'x.pdf', created: Date.now(), phase: 'read', music: [{ page: 2, s: 1 }, { page: 3, s: 2 }, { page: 4, s: 3 }], done: [] };
    await J.putJob(job);
    out.got = (await J.getJob(id))?.name;
    await J.putData(id, 'pdf', new Uint8Array([1, 2, 3]).buffer);
    out.pdf = [...new Uint8Array(await J.getData(id, 'pdf'))];
    const blob = new Blob([new Uint8Array([9, 8, 7])], { type: 'image/webp' });
    await J.saveEvents(id, 'pre', [{ t: 'phase', phase: 'pages', at: 1 }, { t: 'page', page: 2, preview: blob, at: 2 }]);
    const bytes = Uint8Array.from(atob(omrB64), (c) => c.charCodeAt(0));
    job.done = [1];
    await J.saveSheet(job, 1, { s: 1, done: [1], bytes: bytes.buffer }, [{ t: 'sheet', s: 1, state: 'start', at: 3 }, { t: 'sheet', s: 1, state: 'done', at: 4 }]);
    await J.saveSheet(job, 3, null, [{ t: 'sheet', s: 3, state: 'done', at: 6 }]);
    await J.saveSheet(job, 2, null, [{ t: 'sheet', s: 2, state: 'failed', at: 5 }]);
    const evs = await J.loadEvents(id);
    out.order = evs.map((e) => e.at);
    out.preview = evs[1].preview instanceof Blob ? [evs[1].preview.type, [...new Uint8Array(await evs[1].preview.arrayBuffer())]] : null;
    out.book = (await J.getData(id, 'book'))?.bytes?.byteLength;
    await J.dropSheetEvents(id, [1]);
    out.afterDrop = (await J.loadEvents(id)).map((e) => e.at);
    out.chk = await J.checkBook(bytes);
    out.chk1 = (await J.checkBook(bytes, 1)).ok;
    out.chk2 = (await J.checkBook(bytes, 2)).ok; // invalid (failed) still counts as finished
    out.chk4 = await J.checkBook(bytes, 4);
    out.junk = await J.checkBook(new Uint8Array([1, 2, 3, 4]).buffer);
    J.setFlag(job);
    out.flag = J.readFlag();
    out.list = (await J.listJobs()).some((j) => j.id === id);
    await J.deleteJob(id);
    out.gone = [await J.getJob(id), await J.getData(id, 'pdf'), await J.getData(id, 'book'), (await J.loadEvents(id)).length, J.readFlag()];
    return out;
  }, omr);
  ok(r.got === 'x.pdf' && r.pdf.join() === '1,2,3', `job and data stored (${r.got}, ${r.pdf})`);
  ok(r.order.join() === '1,2,3,4,5,6', `events in order: pre, then sheets 1, 2, 3 (${r.order})`);
  ok(r.preview && r.preview[0] === 'image/webp' && r.preview[1].join() === '9,8,7', `a preview Blob survives (${JSON.stringify(r.preview)})`);
  ok(r.book === fs.statSync('/home/user/tools/fixtures/import/greensleeves3-skip2.omr').size, `the book kept with its sheet (${r.book} bytes)`);
  ok(r.afterDrop.join() === '1,2,3,4', `dropSheetEvents keeps pre + sheet 1 (${r.afterDrop})`);
  ok(r.chk.done.join() === '1,3' && r.chk.invalid.join() === '2' && /^[0-9a-f]{40}$/.test(r.chk.build || ''), `checkBook: done ${r.chk.done} invalid ${r.chk.invalid} build ${r.chk.build}`);
  ok(r.chk1 && r.chk2 && !r.chk4.ok, `checkBook(s): 1 ${r.chk1}, 2 (failed) ${r.chk2}, 4 ${r.chk4.ok} (${r.chk4.why})`);
  ok(!r.junk.ok && r.junk.done.length === 0, `junk isn't a book (${r.junk.why})`);
  ok(r.flag && r.flag.done === 1 && r.flag.of === 3 && r.list, `flag ${JSON.stringify(r.flag)}`);
  ok(r.gone.every((x) => x == null || x === 0), `deleteJob removes job, data, events and flag (${JSON.stringify(r.gone)})`);

  // ENGINE = <commit>-<sha256 of audiveris.jar, 8 hex>-cj<version>
  const src = fs.readFileSync('/home/user/resonate/public/omr/omr.js', 'utf8');
  const eng = /export const ENGINE = '([^']+)'/.exec(src)[1];
  const sha = crypto.createHash('sha256').update(fs.readFileSync('/home/user/resonate/public/omr/lib/audiveris.jar')).digest('hex');
  const cj = /cjrtnc\.leaningtech\.com\/([\d.]+)\//.exec(fs.readFileSync('/home/user/resonate/public/omr/omr-worker.js', 'utf8'))[1];
  ok(eng.split('-')[1] === sha.slice(0, 8) && eng.endsWith(`cj${cj}`), `ENGINE ${eng} matches lib/audiveris.jar (${sha.slice(0, 8)}) and CheerpJ ${cj} — change it with lib/`);

  // The importer without an engine: pending() of this space, the crash-loop guard, a page left on purpose.
  const g = await p.evaluate(async () => {
    const J = await import('/resonate/omr/jobs.js?v=80');
    const { createImporter } = await import('/resonate/omr/importer.js?v=80');
    const { ENGINE } = await import('/resonate/omr/omr.js?v=80');
    const states = [];
    const imp = createImporter({ onState: (s) => states.push(s.state) });
    for (const j of await J.listJobs()) await J.deleteJob(j.id);
    const mk = (over) => ({ id: J.newId(), space: 'anon', name: 'a.pdf', created: Date.now(), engine: ENGINE, phase: 'read', music: [{ page: 1, s: 1 }, { page: 2, s: 2 }], done: [1], starts: { 1: 1, 2: 1 }, lefts: {}, skip: [], ...over });
    const out = {};
    const a = mk({});
    await J.putJob(a); await J.putData(a.id, 'pdf', new ArrayBuffer(4));
    out.p1 = await imp.pending();
    a.starts[2] = 2; await J.putJob(a);
    out.p2 = await imp.pending();
    localStorage.setItem('resonate.import.left', JSON.stringify({ id: a.id, s: 2, at: Date.now() }));
    out.p3 = await imp.pending(); // left on purpose once: not stuck
    a.starts[2] = 3; a.lefts = { 2: 1 }; await J.putJob(a);
    out.stuckRes = await imp.resume(a.id); // stuck: no run, state 'stuck'
    out.states = states.slice();
    const other = mk({ space: 'uid-nobody' }); await J.putJob(other);
    const old = mk({ updated: Date.now() - 15 * 864e5 }); await J.putJob(old, { touch: false });
    await imp.pending();
    out.pruned = [await J.getJob(other.id), await J.getJob(old.id)];
    await imp.discard(a.id);
    out.afterDiscard = [await imp.pending(), J.readFlag()];
    return out;
  });
  ok(g.p1 && g.p1.of === 2 && g.p1.done === 1 && !g.p1.stuck, `pending(): ${JSON.stringify(g.p1)}`);
  ok(g.p2?.stuck?.s === 2 && g.p2.stuck.page === 2, `two starts of page 2 without finishing → stuck ${JSON.stringify(g.p2?.stuck)}`);
  ok(g.p3 && !g.p3.stuck, `a start that ended with the page being left (pagehide) isn't a crash (${JSON.stringify(g.p3?.stuck)})`);
  ok(g.stuckRes === null && g.states.includes('stuck'), `resume() of a stuck job stops and says so (${g.states})`);
  ok(g.pruned.every((x) => !x), `pruned: another account's job with nothing parked, a job older than 14 days`);
  ok(g.afterDiscard[0] === null && g.afterDiscard[1] === null, `discard: nothing pending, no flag`);
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
