// The core of the PDF-first song library (v90, docs/LIBRARY.md §1–3), in Chromium's real IndexedDB:
// library.js (addPdfSong, the index's k / eng / fail and its rebuild from a v89 index, addSong's engine,
// replaceSong, markConvFailed), catalog.js (cleanXml / songXml with null, loadSong pdfOnly / engine,
// songInfo, songChoices), omr/queue.js (enqueue, dropFromQueue, the batch's counts, another space's queue
// unread), forget.js forgetSong (the song, its take, per-song settings, session, open song, queue, its
// stored conversions; samples refused), omr/jobs.js deleteJobsFor, importer.js titleFromFileName /
// holdWake, omr/engine.js ENGINE_N. No conversion runs.
//   node libcore.cjs                    (http://localhost:8097; BASE=… for another server)
const { chromium } = require('playwright');
const BASE = (process.env.BASE || 'http://localhost:8097').replace(/\/$/, '') + '/resonate/';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(BASE + 'tools.html');
  const r = await page.evaluate(async () => {
    const V = '?v=' + document.getElementById('version').textContent.trim().replace(/^v/, ''); // (the page's own modules)
    const L = await import('./library.js' + V);
    const C = await import('./catalog.js' + V);
    const Q = await import('./omr/queue.js' + V);
    const F = await import('./forget.js' + V);
    const J = await import('./omr/jobs.js' + V);
    const E = await import('./omr/engine.js' + V);
    const I = await import('./omr/importer.js' + V);
    const out = {};
    const events = [];
    addEventListener('resonate:data', (e) => events.push(['data', e.detail]));
    addEventListener('resonate:remote', (e) => events.push(['remote', e.detail]));
    const pdf = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10]).buffer; // "%PDF-1.4\n"
    // addPdfSong
    const ev0 = events.length;
    const a = await L.addPdfSong(pdf, { name: 'Wichita_Lineman_-_F_Major_-_MN0305807.pdf', title: I.titleFromFileName('Wichita_Lineman_-_F_Major_-_MN0305807.pdf') });
    out.addEvents = events.slice(ev0).map((x) => x[1].what);
    const b = await L.addPdfSong(pdf.slice(0), { name: 'x.pdf', title: 'Wichita Lineman' });
    out.twoSongs = a !== b;
    const ra = await L.getSong(a);
    out.recA = { xml: ra.xml, title: ra.title, source: ra.source, titleAuto: ra.titleAuto, added: typeof ra.added };
    const pa = await L.getPdf(a);
    out.pdfA = { name: pa.name, bytes: pa.bytes };
    const list = await L.listSongs();
    out.entryA = list.find((x) => x.id === a);
    // MusicXML songs: from a file, converted with an engine, converted before v90.
    const xml = '<score-partwise><part-list/></score-partwise>';
    const f = await L.addSong('File song', xml, { source: 'file' });
    const c = await L.addSong('Conv song', xml + '<!--c-->', { source: 'pdf', engine: { n: E.ENGINE_N, id: 'x', at: 1 } });
    const o = await L.addSong('Old conv', xml + '<!--o-->', { source: 'pdf' });
    const l2 = await L.listSongs();
    out.entries = Object.fromEntries([['f', f], ['c', c], ['o', o]].map(([k, id]) => [k, l2.find((x) => x.id === id)]));
    out.dupEngine = (await L.addSong('Old conv', xml + '<!--o-->', { source: 'pdf', engine: { n: 10, id: 'y', at: 2 } })) === o && (await L.getSong(o)).engine?.n === 10;
    await L.putSong({ ...(await L.getSong(o)), engine: undefined }, { quiet: true }); // (back to "before v90")
    delete (await L.getSong(o)).engine;
    // An index from v89 (no k): rebuilt.
    const idx = JSON.parse(localStorage.getItem('resonate.songs.index'));
    localStorage.setItem('resonate.songs.index', JSON.stringify(idx.map(({ id, title, added, rev }) => (rev ? { id, title, added, rev } : { id, title, added }))));
    const l3 = await L.listSongs();
    out.rebuiltK = l3.every((x) => x.k) && JSON.parse(localStorage.getItem('resonate.songs.index')).every((x) => x.k);
    out.rebuiltOld = l3.find((x) => x.id === o);
    // One v89-style entry among v90 ones (a v89 tab's putSong): rebuilt too.
    const idx2 = JSON.parse(localStorage.getItem('resonate.songs.index'));
    localStorage.setItem('resonate.songs.index', JSON.stringify(idx2.map((x) => (x.id === a ? { id: x.id, title: x.title, added: x.added } : x))));
    out.oneMissing = (await L.listSongs()).find((x) => x.id === a)?.k === 'pdf';
    localStorage.removeItem('resonate.songs.index');
    out.noIndex = (await L.listSongs()).map((x) => x.k).join(',');
    // markConvFailed → fail; replaceSong clears it and the title-from-name and stamps the engine.
    const ev1 = events.length;
    await L.markConvFailed(b, { kind: 'nomusic', message: 'No music' });
    out.failEvent = events.slice(ev1).map((x) => x[1].what);
    out.failEntry = (await L.listSongs()).find((x) => x.id === b);
    out.failRec = (await L.getSong(b)).conv?.kind;
    const rep = await L.replaceSong(b, xml + '<!--b-->', { title: 'Better', engine: { n: 10, id: 'z', at: 3 }, pages: [1] });
    out.replaced = { titleAuto: rep.titleAuto, conv: rep.conv, engine: rep.engine?.n, title: rep.title, rev: !!rep.rev, pages: rep.pages, source: rep.source };
    out.replacedEntry = (await L.listSongs()).find((x) => x.id === b);
    const rep2 = await L.replaceSong(b, xml + '<!--b2-->');
    out.replaced2 = { engine: rep2.engine, pages: rep2.pages, title: rep2.title };
    out.replacedEntry2 = (await L.listSongs()).find((x) => x.id === b);
    out.pdfKept = !!(await L.getPdf(b));
    // catalog
    out.cleanNull = C.cleanXml(null) === null;
    out.songXmlNull = C.songXml({ id: a, xml: null }) === null;
    const la = await C.loadSong(a);
    out.loadPdf = la;
    const lc = await C.loadSong(c);
    out.loadConv = { pdfOnly: lc.pdfOnly, engine: lc.engine, xml: typeof lc.xml };
    const ls = await C.loadSong('amazing-grace');
    out.loadSample = { pdfOnly: ls.pdfOnly, engine: ls.engine, source: ls.source };
    out.info = { sample: await C.songInfo('amazing-grace'), none: await C.songInfo('s-nope'), empty: await C.songInfo(''), pdf: await C.songInfo(a) };
    const ch = await C.songChoices();
    out.choiceK = ch.mine.find((x) => x.id === a)?.k;
    // A song a v89 device stored with xml "null" (a PDF-only song it pulled from a v90 one) — or any text
    // that isn't MusicXML — is a PDF only: the index, songXml, loadSong (v90 review).
    const nul = 's0nullxml1';
    await L.putSong({ id: nul, title: 'From v89', xml: 'null', added: 5, source: 'pdf' }, { quiet: true });
    await L.putPdf(nul, pdf.slice(0), 'v89.pdf', { quiet: true });
    out.nullEntry = (await L.listSongs()).find((x) => x.id === nul);
    const idxN = JSON.parse(localStorage.getItem('resonate.songs.index'));
    localStorage.setItem('resonate.songs.index', JSON.stringify(idxN.map(({ id, title, added }) => ({ id, title, added })))); // (a v89 index: rebuilt)
    out.nullRebuilt = (await L.listSongs()).find((x) => x.id === nul)?.k;
    out.nullXml = C.songXml(await L.getSong(nul));
    const ln = await C.loadSong(nul);
    out.nullLoad = { xml: ln.xml, pdfOnly: ln.pdfOnly, engine: ln.engine };
    out.nullInfo = (await C.songInfo(nul))?.k;
    out.isMx = [L.isMusicXml('<?xml version="1.0"?>\n<!DOCTYPE score-partwise>\n<score-partwise version="4.0"/>'), L.isMusicXml('<score-timewise>'),
      L.isMusicXml('null'), L.isMusicXml(null), L.isMusicXml('<not-music/>'), L.isMusicXml(' '.repeat(70000) + '<score-partwise>')];
    await L.removeSong(nul, { quiet: true });
    // queue
    Q.clearQueue();
    out.q0 = Q.readQueue();
    out.q1 = Q.enqueue([a, b, a, c]);
    out.q2 = Q.enqueue([b, o]);
    const taken = Q.readQueue(); // the tray takes ids[0]
    Q.writeQueue({ ...taken, ids: taken.ids.slice(1) });
    out.q3 = Q.readQueue();
    out.dropRunning = Q.dropFromQueue(a); // (running: not in ids)
    out.dropQueued = Q.dropFromQueue(c);
    out.q4 = Q.readQueue();
    const q4 = Q.readQueue();
    Q.writeQueue({ ...q4, done: q4.done + 1 }); // a done
    const q5 = Q.readQueue();
    Q.writeQueue({ ...q5, ids: q5.ids.slice(1) }); // b taken
    const q6 = Q.readQueue();
    Q.writeQueue({ ...q6, done: q6.done + 1 }); // b done
    const q7 = Q.readQueue();
    Q.writeQueue({ ...q7, ids: [] }); // o taken
    out.q8 = Q.readQueue();
    out.q9 = Q.writeQueue({ ...Q.readQueue(), done: Q.readQueue().done + 1 }); // o done → reset
    out.q9stored = localStorage.getItem('resonate.convert');
    // another space's queue isn't read
    localStorage.setItem('resonate.convert', JSON.stringify({ db: 'other-db', ids: ['x'], total: 1, done: 0 }));
    out.qOther = Q.readQueue();
    Q.clearQueue();
    // forget
    for (const k of ['resonate.sing.keys', 'resonate.sing.rates', 'resonate.sing.timing', 'resonate.sing.history', 'resonate.sing.practice', 'resonate.play']) {
      localStorage.setItem(k, JSON.stringify({ [c]: 1, keepme: 2 }));
    }
    localStorage.setItem('resonate.sing.session', JSON.stringify({ songId: c, at: 1 }));
    localStorage.setItem('resonate.sing.song', c);
    Q.enqueue([o, c, b]);
    const job = { id: J.newId(), space: 'anon', db: (await import('./space.js' + V)).activeDb(), name: 'c.pdf', engine: 'x', created: Date.now(), phase: 'read', replace: c };
    await J.createJob(job, pdf.slice(0));
    const other = { id: J.newId(), space: 'anon', db: job.db, name: 'o.pdf', engine: 'x', created: Date.now(), phase: 'read', replace: o };
    await J.createJob(other, pdf.slice(0));
    J.setFlag(job);
    await L.putTake({ songId: c, takeId: 't1', at: 1, data: {} });
    const ev2 = events.length;
    out.cId = c;
    out.forgot = await F.forgetSong(c);
    out.forgetEvents = events.slice(ev2);
    out.afterForget = {
      song: await L.getSong(c), take: await L.getTake(c), inList: (await L.listSongs()).some((x) => x.id === c),
      maps: ['resonate.sing.keys', 'resonate.sing.rates', 'resonate.sing.timing', 'resonate.sing.history', 'resonate.sing.practice', 'resonate.play'].map((k) => localStorage.getItem(k)),
      session: localStorage.getItem('resonate.sing.session'), open: localStorage.getItem('resonate.sing.song'),
      queue: Q.readQueue(), jobs: (await J.listJobs()).map((j) => j.replace), flag: localStorage.getItem('resonate.import'),
    };
    out.forgetSample = await F.forgetSong('amazing-grace');
    // jobs.deleteJobsFor
    out.delOther = await J.deleteJobsFor(o);
    out.jobsLeft = (await J.listJobs()).length;
    // titles
    out.titles = ['Wichita_Lineman_-_F_Major_-_MN0305807.pdf', 'Killing Me Softly.PDF', 'Scanned Document 2.pdf', '', 'IMG_0042.pdf'].map(I.titleFromFileName);
    // holdWake on an importer (no job): asks, keeps, lets go
    const imp = I.createImporter({});
    out.hold = typeof imp.holdWake === 'function';
    imp.holdWake(true); imp.holdWake(false);
    out.engineN = E.ENGINE_N;
    // clean up
    for (const id of [a, b, f, o]) await L.removeSong(id);
    Q.clearQueue();
    return out;
  });
  if (process.env.VERBOSE) console.log(JSON.stringify(r, null, 1).slice(0, 6000));
  ok(r.addEvents.length === 1 && r.addEvents[0] === 'song', 'addPdfSong: one song event');
  ok(r.twoSongs, 'two PDFs, same title: two songs (no dedupe)');
  ok(r.recA.xml === null && r.recA.title === 'Wichita Lineman' && r.recA.source === 'pdf' && r.recA.titleAuto === true, 'PDF-only record');
  ok(r.pdfA.name === 'Wichita_Lineman_-_F_Major_-_MN0305807.pdf' && r.pdfA.bytes === 9, 'its PDF stored with the file name');
  ok(r.entryA.k === 'pdf' && !('eng' in r.entryA) && !('fail' in r.entryA), 'index: k pdf');
  ok(r.entries.f.k === 'xml' && !('eng' in r.entries.f), 'index: k xml');
  ok(r.entries.c.k === 'conv' && r.entries.c.eng === 10, 'index: k conv eng 10');
  ok(r.entries.o.k === 'conv' && r.entries.o.eng === 0, 'index: k conv eng 0 (before v90)');
  ok(r.dupEngine, 'same MusicXML again: the engine added to the old copy');
  ok(r.rebuiltK && r.rebuiltOld.eng === 0, 'a v89 index (no k) is rebuilt');
  ok(r.oneMissing, 'one entry without k: rebuilt');
  ok(r.noIndex.split(',').length >= 5, 'no index: rebuilt with a cursor ' + r.noIndex);
  ok(r.failEvent.includes('song') && r.failEntry.fail === 1 && r.failRec === 'nomusic', 'markConvFailed: fail 1 + event');
  ok(r.replaced.titleAuto === undefined && r.replaced.conv === undefined && r.replaced.engine === 10 && r.replaced.title === 'Better' && r.replaced.rev && r.replaced.pages?.[0] === 1 && r.replaced.source === 'pdf', 'replaceSong: titleAuto/conv cleared, engine/title/pages set');
  ok(r.replacedEntry.k === 'conv' && r.replacedEntry.eng === 10 && !r.replacedEntry.fail, 'index after replace: conv 10');
  ok(r.replaced2.engine === undefined && r.replaced2.pages === undefined && r.replaced2.title === 'Better' && r.replacedEntry2.eng === 0, 'replaceSong without engine: engine dropped');
  ok(r.pdfKept, 'PDF kept through replace');
  ok(r.cleanNull && r.songXmlNull, 'cleanXml / songXml with null');
  ok(r.loadPdf.xml === null && r.loadPdf.pdfOnly === true && r.loadPdf.engine === null && r.loadPdf.title === 'Wichita Lineman' && r.loadPdf.source === 'pdf', 'loadSong PDF-only');
  ok(r.loadConv.pdfOnly === false && r.loadConv.engine === 10 && r.loadConv.xml === 'string', 'loadSong converted: engine 10');
  ok(r.loadSample.pdfOnly === false && r.loadSample.engine === null && r.loadSample.source === 'sample', 'loadSong sample');
  ok(r.info.sample.k === 'sample' && r.info.none === null && r.info.empty === null && r.info.pdf.k === 'pdf', 'songInfo');
  ok(r.choiceK === 'pdf', 'songChoices mine carries k');
  ok(r.nullEntry?.k === 'pdf' && !('eng' in r.nullEntry) && r.nullRebuilt === 'pdf', `xml "null" (a v89 device's): index k pdf, also rebuilt (${JSON.stringify(r.nullEntry)}, ${r.nullRebuilt})`);
  ok(r.nullXml === null && r.nullLoad.xml === null && r.nullLoad.pdfOnly === true && r.nullLoad.engine === null && r.nullInfo === 'pdf', `xml "null": songXml null, loadSong pdfOnly, songInfo pdf (${JSON.stringify(r.nullLoad)})`);
  ok(JSON.stringify(r.isMx) === '[true,true,false,false,false,false]', `isMusicXml: the root element in the first 64 KB (${JSON.stringify(r.isMx)})`);
  ok(r.q0.ids.length === 0 && r.q0.total === 0, 'queue empty');
  ok(r.q1.ids.length === 3 && r.q1.total === 3, 'enqueue unique ' + JSON.stringify(r.q1));
  ok(r.q2.ids.join() === [r.q1.ids[0], r.q1.ids[1], r.q1.ids[2], r.q2.ids[3]].join() && r.q2.total === 4, 'enqueue appends only new ids');
  ok(r.q3.ids.length === 3 && r.q3.total === 4 && r.q3.done === 0, 'take ids[0]: total kept ' + JSON.stringify(r.q3));
  ok(r.dropRunning === false && r.dropQueued === true && r.q4.ids.length === 2 && r.q4.total === 3, 'dropFromQueue: queued out of total, running unchanged ' + JSON.stringify(r.q4));
  ok(r.q8.ids.length === 0 && r.q8.total === 3 && r.q8.done === 2, 'last running: kept ' + JSON.stringify(r.q8));
  ok(r.q9.total === 0 && r.q9stored === null, 'all done: reset');
  ok(r.qOther.ids.length === 0, "another space's queue isn't read");
  ok(r.forgot === true && r.afterForget.song === undefined && r.afterForget.take === undefined && !r.afterForget.inList, 'forgetSong: song, take, index gone');
  ok(r.afterForget.maps.every((m) => m === '{"keepme":2}'), 'forgetSong: per-song maps ' + JSON.stringify(r.afterForget.maps));
  ok(r.afterForget.session === null && r.afterForget.open === null, 'forgetSong: session, open song');
  ok(!r.afterForget.queue.ids.includes(r.cId) && r.afterForget.queue.ids.length === 2, 'forgetSong: out of the queue ' + JSON.stringify(r.afterForget.queue));
  ok(r.afterForget.jobs.length === 1 && r.afterForget.flag === null, 'forgetSong: its job and flag gone, the other kept ' + JSON.stringify(r.afterForget.jobs));
  const kinds = r.forgetEvents.map((e) => `${e[0]}:${e[1].what || ''}${e[1].songs ? 'songs' : ''}${(e[1].gone || []).length}`);
  ok(kinds.includes('data:settings0') && kinds.includes('remote:songs1') && kinds.includes('data:song0'), 'forgetSong events ' + kinds.join(' '));
  ok(r.forgetSample === false, 'forgetSong refuses a sample');
  ok(r.delOther === 1 && r.jobsLeft === 0, 'deleteJobsFor');
  ok(JSON.stringify(r.titles) === JSON.stringify(['Wichita Lineman', 'Killing Me Softly', 'Scanned Document 2', 'Song', 'IMG 0042']), 'titleFromFileName ' + JSON.stringify(r.titles));
  ok(r.hold && r.engineN === 15, 'holdWake, ENGINE_N');
  ok(!errs.length, 'no page errors ' + JSON.stringify(errs.slice(0, 3)));
  if (fails && !process.env.VERBOSE) console.log(JSON.stringify(r).slice(0, 4000));
  await browser.close();
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
