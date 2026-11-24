// The cloud sync of the PDF-first song library (v90, docs/LIBRARY.md §7), offline: the real public/sync.js
// against a fake cloud (synclib/fake-auth.mjs: sync_items rows and the songs bucket in memory) and fake
// devices (synclib/fake-library.mjs, a localStorage each), its imports of auth.js / space.js / library.js
// redirected by module hooks (synclib/hooks.mjs). Checks: a v89 device's songs don't go up again (meta v2,
// the cursor rewound once); a PDF-only song goes up as its PDF (sha null, no xml.gz; the PDF required — an
// upload failing holds the row back); another device gets it as a PDF only; a conversion goes up with its
// engine {n, id} and comes down with it; a "null" xml.gz from a v89 tab is refused and the row put right;
// a local conversion beats a newer PDF-only row; the rewind brings a row a v89 device passed by; a PDF over
// 10 MB is held (pdf-large) until the song is converted; a delete elsewhere; SONG_LIMIT 20. Nothing echoes.
// v90 review: the engine isn't in a song's fingerprint (a v89 tab's form is the same); a delete pulled
// takes the song out of the conversion queue and its stored jobs (omr/queue.js, omr/jobs.js — faked), not
// once the space changed; a v89 tab (its sync.js vendored from 4b0ec14: fixtures/sync/v89-sync.js) and a v90 tab taking turns on one
// device send nothing up again; a song a v89 device stored as "null" is a PDF only — never sent up as that
// text, no ping-pong with the PDF-only row. v94 review: a later delete of ours met by the cloud's earlier
// one still goes up with its own stamp, so a change made between them doesn't bring the song back (13).
// E7: a song's piano fingering (fing) never syncs — not in the row, the file or another device (14).
//   node synclib.mjs
import { register } from 'node:module';
register('./synclib/hooks.mjs', import.meta.url);
const { W, device, UID } = await import('./synclib/world.mjs');
const S = await import(new URL('../public/sync.js', import.meta.url).href);
W.limit = S.SONG_LIMIT;
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const meta = () => JSON.parse(localStorage.getItem('resonate.sync'));
const sha256 = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const gz = async (t) => new Uint8Array(await new Response(new Blob([t]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
const XML = (t) => `<?xml version="1.0"?>\n<!DOCTYPE score-partwise>\n<score-partwise version="4.0"><work><work-title>${t}</work-title></work></score-partwise>`;
const pdfBytes = (n = 100, b = 7) => new Uint8Array(n).fill(b).buffer;
let events = [];
window.addEventListener('resonate:remote', (e) => events.push(e.detail));
const pass = async () => { const r = await S.syncNow(); if (r?.error) console.log('  pass error', r.error); return r; };
const since = (i) => W.cloud.log.slice(i);
const row = (kind, id) => W.cloud.rows.get(`${kind}:${id}`);
const lib = await import('./synclib/fake-library.mjs'); // (the same module the hooks give sync.js)

// 1. A v89 device: its songs' fingerprints don't change (nothing goes up again); meta v2, cursor rewound once.
let A = device('A');
const conv = { id: 's000aaa1', title: 'Old Conv', xml: XML('Old Conv'), added: 1000, source: 'pdf' };
const mx = { id: 's000aaa2', title: 'A File', xml: XML('A File'), added: 2000, source: 'file' };
A.songs.set(conv.id, conv); A.songs.set(mx.id, mx); A.pdfs.set(conv.id, { id: conv.id, pdf: pdfBytes(), name: 'old.pdf', bytes: 100 });
const oldForm = async (s, pdf) => ({ title: s.title, added: s.added, source: s.source, sha: await sha256(s.xml), pdf });
const t0 = '2026-11-19T00:00:00.000Z';
for (const [s, pdf] of [[conv, true], [mx, false]]) {
  W.cloud.rows.set(`song:${s.id}`, { kind: 'song', id: s.id, data: { ...(await oldForm(s, pdf)), xml: { path: `${UID}/${s.id}.xml.gz`, bytes: 1 }, pdf: pdf ? { path: `${UID}/${s.id}.pdf`, bytes: 100, name: 'old.pdf' } : null }, deleted: false, modified_at: t0, updated_at: '2026-11-19T00:00:01.000Z' });
  W.cloud.files.set(`${UID}/${s.id}.xml.gz`, await gz(s.xml));
}
const items = {}, info = {};
for (const [s, pdf] of [[conv, true], [mx, false]]) {
  items[`song:${s.id}`] = { h: S.fingerprint(await oldForm(s, pdf)), m: Date.parse(t0), up: true };
  info[s.id] = { sha: await sha256(s.xml), source: s.source, pdf, rev: null };
}
localStorage.setItem('resonate.sync', JSON.stringify({ uid: UID, gen: 'g1', cursor: '2026-11-19T00:00:01.000Z', items, info, held: {}, missing: {}, orphans: [] }));
let L = W.cloud.log.length;
await pass();
check(since(L).length === 0, `1: a v89 device's songs don't go up again (${JSON.stringify(since(L))})`);
check(meta().v === 2 && meta().cursor === '2026-11-19T00:00:01.000Z', `1: meta v2, the cursor rewound and read to the end (${meta().v}, ${meta().cursor})`);

// 2. A PDF-only song goes up as its PDF: no xml.gz, sha null, the PDF required.
const P1 = { id: 's000aaa3', title: 'Pdf One', xml: null, added: 3000, source: 'pdf', titleAuto: true };
A.songs.set(P1.id, P1); A.pdfs.set(P1.id, { id: P1.id, pdf: pdfBytes(200, 3), name: 'Pdf_One.pdf', bytes: 200 });
W.failUpload = (p) => p.endsWith('.pdf');
L = W.cloud.log.length;
await pass();
check(!row('song', P1.id) && meta().items[`song:${P1.id}`]?.up === false, '2: PDF upload failing → no song row, tried again');
W.failUpload = null;
await pass();
const r2 = row('song', P1.id);
check(r2 && r2.data.sha === null && r2.data.xml === null && r2.data.pdf?.path === `${UID}/${P1.id}.pdf` && W.cloud.files.has(`${UID}/${P1.id}.pdf`) && !W.cloud.files.has(`${UID}/${P1.id}.xml.gz`) && !('engine' in r2.data), `2: PDF-only row (${JSON.stringify(r2?.data)})`);
L = W.cloud.log.length; await pass();
check(since(L).length === 0, '2: nothing echoes');

// 3. Device B (fresh) gets it as a PDF only, titleAuto; nothing echoes.
let B = device('B');
await pass();
const b1 = B.songs.get(P1.id);
check(b1 && b1.xml === null && b1.titleAuto === true && B.pdfs.get(P1.id)?.bytes === 200 && B.songs.get(conv.id)?.xml === conv.xml, `3: B has the PDF only (${JSON.stringify(b1)}) and the others`);
L = W.cloud.log.length; await pass(); await pass();
check(since(L).length === 0, `3: nothing echoes from B (${JSON.stringify(since(L))})`);

// 4. B converts it (engine 10) → up with sha, xml, engine; A gets the conversion and its engine; no echo.
await lib.replaceSong(P1.id, XML('Pdf One'), { title: 'Pdf One (named)', engine: { n: 10, id: 'eng10', at: 5 } });
await pass();
const r4 = row('song', P1.id);
check(r4.data.sha === await sha256(XML('Pdf One')) && r4.data.xml?.path && r4.data.engine?.n === 10 && r4.data.engine.id === 'eng10' && !('at' in r4.data.engine), `4: B's conversion goes up with its engine (${JSON.stringify(r4.data)})`);
device('A'); events = [];
await pass();
const a4 = A.songs.get(P1.id);
check(a4.xml === XML('Pdf One') && a4.engine?.n === 10 && a4.engine.id === 'eng10' && a4.title === 'Pdf One (named)' && !a4.titleAuto && events.some((e) => e.replaced?.has(P1.id)), `4: A gets it (${JSON.stringify({ ...a4, xml: undefined })})`);
L = W.cloud.log.length; await pass(); device('B'); await pass(); device('A'); await pass();
check(since(L).length === 0, `4: nothing echoes (${JSON.stringify(since(L))})`);
// (the engine goes with the row, not the fingerprint: v89's form {title, added, source, sha, pdf} exactly)
const v89form = (s, pdf) => S.fingerprint({ title: s.title, added: s.added, source: s.source ?? null, sha: meta().info[s.id]?.sha ?? null, pdf });
check(meta().items[`song:${P1.id}`].h === v89form(a4, true) && a4.engine?.n === 10, `4: the engine isn't in the fingerprint (h = v89's form: ${meta().items[`song:${P1.id}`].h} vs ${v89form(a4, true)})`);

// 5. A "null" file from a v89 tab: a fresh device keeps the song as a PDF only and puts the row right.
const P2 = 's000aaa4';
W.cloud.files.set(`${UID}/${P2}.xml.gz`, await gz('null'));
W.cloud.files.set(`${UID}/${P2}.pdf`, new Uint8Array(pdfBytes(50, 9)));
W.cloud.rows.set(`song:${P2}`, { kind: 'song', id: P2, data: { title: 'Bogus', added: 4000, source: 'pdf', sha: await sha256('null'), xml: { path: `${UID}/${P2}.xml.gz`, bytes: 24 }, pdf: { path: `${UID}/${P2}.pdf`, bytes: 50, name: 'b.pdf' } }, deleted: false, modified_at: new Date(Date.now() - 1000).toISOString(), updated_at: new Date(Date.UTC(2026, 10, 20) + ++W.cloud.t * 1000).toISOString() });
let C = device('C');
await pass();
check(C.songs.get(P2)?.xml === null && C.pdfs.get(P2)?.bytes === 50, `5: C keeps it as a PDF only (${JSON.stringify(C.songs.get(P2))})`);
check(row('song', P2).data.sha === null && row('song', P2).data.xml === null, `5: the row put right (${JSON.stringify(row('song', P2).data)})`);
device('A'); await pass();
check(A.songs.get(P2)?.xml === null, `5: A gets the PDF only too (${JSON.stringify(A.songs.get(P2))})`);
L = W.cloud.log.length; await pass(); device('C'); await pass();
check(since(L).length === 0, `5: nothing echoes (${JSON.stringify(since(L))})`);

// 6. A conversion here meets a newer PDF-only row (renamed elsewhere): ours stays and goes up, with the new title.
device('A');
await lib.replaceSong(P2, XML('Bogus'), { engine: { n: 10, id: 'eng10', at: 6 } });
const r6 = row('song', P2);
W.cloud.rows.set(`song:${P2}`, { ...r6, data: { ...r6.data, title: 'Renamed' }, modified_at: new Date(Date.now() + 3600e3).toISOString(), updated_at: new Date(Date.UTC(2026, 10, 20) + ++W.cloud.t * 1000).toISOString() });
await pass();
const r6b = row('song', P2);
check(A.songs.get(P2).xml === XML('Bogus') && A.songs.get(P2).title === 'Renamed' && r6b.data.sha === await sha256(XML('Bogus')) && r6b.data.xml?.path && r6b.data.engine?.n === 10 && r6b.data.title === 'Renamed', `6: ours kept and pushed (${JSON.stringify(r6b.data)})`);
device('C'); await pass();
check(C.songs.get(P2).xml === XML('Bogus') && C.songs.get(P2).engine?.n === 10, '6: C follows');
L = W.cloud.log.length; await pass(); device('A'); await pass();
check(since(L).length === 0, `6: nothing echoes (${JSON.stringify(since(L))})`);

// 7. A v89 device that passed a PDF-only row by: the rewind brings it.
const D = device('D');
// (D synced everything but P3, which v89 passed by)
const P3 = 's000aaa5';
W.cloud.files.set(`${UID}/${P3}.pdf`, new Uint8Array(pdfBytes(30, 1)));
W.cloud.rows.set(`song:${P3}`, { kind: 'song', id: P3, data: { title: 'Passed by', added: 5000, source: 'pdf', sha: null, xml: null, pdf: { path: `${UID}/${P3}.pdf`, bytes: 30, name: 'p.pdf' } }, deleted: false, modified_at: '2026-11-19T00:00:00.000Z', updated_at: '2026-11-19T00:00:02.000Z' });
localStorage.setItem('resonate.sync', JSON.stringify({ uid: UID, gen: 'g1', cursor: '2026-11-21T00:00:00.000Z', items: {}, info: {}, held: {}, missing: {}, orphans: [] }));
await pass();
check(D.songs.get(P3)?.xml === null && D.pdfs.get(P3)?.bytes === 30 && meta().v === 2, `7: the rewind brings the PDF only (${JSON.stringify(D.songs.get(P3))})`);

// 8. pdf-large: held, then converted → goes up without its PDF.
device('A');
const P4 = { id: 's000aaa6', title: 'Huge', xml: null, added: 6000, source: 'pdf', titleAuto: true };
A.songs.set(P4.id, P4); A.pdfs.set(P4.id, { id: P4.id, pdf: pdfBytes(10), name: 'huge.pdf', bytes: 11 * 1024 * 1024 });
await pass();
check(meta().held[P4.id] === 'pdf-large' && !row('song', P4.id), `8: held pdf-large (${JSON.stringify(meta().held)})`);
await lib.replaceSong(P4.id, XML('Huge'), { engine: { n: 10, id: 'eng10', at: 7 } });
await pass();
check(!meta().held[P4.id] && row('song', P4.id)?.data.xml?.path && row('song', P4.id).data.pdf === null, `8: converted → up without its PDF (${JSON.stringify(row('song', P4.id)?.data)})`);

// 9. A delete elsewhere: gone in the event, practice cleared.
device('C');
localStorage.setItem('resonate.sing.practice', JSON.stringify({ [P1.id]: { x: 1 } }));
localStorage.setItem('resonate.sing.eardata', JSON.stringify({ [P1.id]: { v: 1, p: 'x' }, keep: { v: 1 } })); // (Ear's store: device-only, goes with the song)
device('A');
await lib.removeSong(P1.id);
await pass();
check(row('song', P1.id)?.deleted, '9: tombstone up');
device('C'); events = [];
C.queue = [P1.id, 's000zzz1']; C.jobs = [{ id: 'j1', replace: P1.id }, { id: 'j2', replace: 's000zzz1' }]; // (Convert all waiting for it; a kept job of it)
await pass();
check(!C.songs.has(P1.id) && events.some((e) => e.gone?.includes(P1.id)) && !(P1.id in JSON.parse(localStorage.getItem('resonate.sing.practice'))), `9: C deletes it, says gone, drops practice (${JSON.stringify(events.map((e) => e.gone))})`);
check(!(P1.id in JSON.parse(localStorage.getItem('resonate.sing.eardata'))) && 'keep' in JSON.parse(localStorage.getItem('resonate.sing.eardata')), `9: …and Ear's store of it, the others kept (${localStorage.getItem('resonate.sing.eardata')})`);
check(JSON.stringify(C.queue) === '["s000zzz1"]' && JSON.stringify(C.jobs.map((j) => j.id)) === '["j2"]', `9: out of C's conversion queue, its stored job deleted, the others kept (${JSON.stringify(C.queue)}, ${JSON.stringify(C.jobs)})`);

// 9b. The space changes while the delete is applied (signed out in another tab): the queue and jobs are
// another space's then — left alone; back in that space, the next pass clears them.
device('A');
const P8 = { id: 's000aaa9', title: 'Short Lived', xml: XML('Short Lived'), added: 9000, source: 'file' };
A.songs.set(P8.id, P8);
await pass();
device('C'); await pass();
check(C.songs.has(P8.id), '9b: C has the song');
C.queue = [P8.id]; C.jobs = [{ id: 'j8', replace: P8.id }];
device('A'); await lib.removeSong(P8.id); await pass();
device('C'); events = [];
W.onRemove = (id) => { if (id === P8.id) W.space = 'anon'; };
await pass();
W.onRemove = null;
check(!C.songs.has(P8.id) && JSON.stringify(C.queue) === `["${P8.id}"]` && C.jobs.length === 1, `9b: the space changed mid-delete: queue and jobs left alone (${JSON.stringify(C.queue)}, ${C.jobs.length} jobs)`);
W.space = undefined;
await pass();
check(!C.queue.length && !C.jobs.length && events.some((e) => e.gone?.includes(P8.id)), `9b: back in the space, the next pass clears them and says gone (${JSON.stringify(C.queue)}, ${C.jobs.length} jobs)`);

// 11. A v89 tab open next to a v90 tab on one device (they share resonate.sync): taking turns, nothing goes
// up again — not the engine-stamped songs (v90's form once had the engine, v89's not: each pass re-uploaded
// them), and a fresh PDF only that the v89 tab sent first as "null" is put right once, then left alone.
device('A');
let V89 = null;
V89 = await import(new URL('fixtures/sync/v89-sync.js', import.meta.url).href); // (v89's sync.js, vendored from 4b0ec14; the hooks fake its imports too)
if (V89) {
  const P5 = { id: 's000aab1', title: 'Fresh Pdf', xml: null, added: 7000, source: 'pdf', titleAuto: true };
  A.songs.set(P5.id, P5); A.pdfs.set(P5.id, { id: P5.id, pdf: pdfBytes(60, 5), name: 'Fresh_Pdf.pdf', bytes: 60 });
  const stamped = [...A.songs.values()].filter((s) => s.engine).map((s) => s.id);
  const v89pass = async () => { const r = await V89.syncNow(); if (r?.error) console.log('  v89 pass error', r.error); };
  L = W.cloud.log.length;
  await v89pass(); // (the v89 tab first: its sha256("null") form for the new PDF only, a "null" xml.gz — v89's way)
  await pass();    // (v90: the PDF-only form)
  const first = since(L);
  const L2 = W.cloud.log.length;
  await v89pass(); await pass(); await v89pass(); await pass();
  check(stamped.length >= 2 && !first.some((e) => stamped.some((id) => e[1].includes(id))), `11: the engine-stamped songs (${stamped.length}) never go up again (${JSON.stringify(first.map((e) => e.slice(0, 2)))})`);
  check(row('song', P5.id)?.data.sha === null && row('song', P5.id).data.xml === null && row('song', P5.id).data.pdf?.path, `11: the PDF only the v89 tab sent first: put right (${JSON.stringify(row('song', P5.id)?.data)})`);
  check(since(L2).length === 0, `11: then the two tabs take turns and nothing goes up (${JSON.stringify(since(L2).map((e) => e.slice(0, 2)))})`);
  check(meta().info[P5.id].sha === null, `11: the PDF only's cached sha reset (${meta().info[P5.id].sha})`);
}

// 12. A song a v89 device stored as "null" (a PDF only it pulled from a v90 device), on that device now on
// v90: a PDF only — it meets the PDF-only row (sha null) with nothing to send (it used to push "null" and its
// PDF back up, every pass, against the other devices); the v89 form in the cloud is put right with its PDF.
const E = device('E');
const P6 = 's000aab2';
const nullSha = await sha256('null');
E.songs.set(P6, { id: P6, title: 'From v89', xml: 'null', added: 8000, source: 'pdf' });
E.pdfs.set(P6, { id: P6, pdf: pdfBytes(40, 4), name: 'v89.pdf', bytes: 40 });
W.cloud.files.set(`${UID}/${P6}.pdf`, new Uint8Array(pdfBytes(40, 4)));
const next = () => new Date(Date.UTC(2026, 10, 20) + ++W.cloud.t * 1000).toISOString();
const before6 = next();
W.cloud.rows.set(`song:${P6}`, { kind: 'song', id: P6, data: { title: 'From v89', added: 8000, source: 'pdf', sha: null, xml: null, pdf: { path: `${UID}/${P6}.pdf`, bytes: 40, name: 'v89.pdf' } }, deleted: false, modified_at: new Date(Date.now() + 3600e3).toISOString(), updated_at: next() });
localStorage.setItem('resonate.sync', JSON.stringify({ v: 2, uid: UID, gen: 'g1', cursor: before6, items: { [`song:${P6}`]: { h: S.fingerprint({ title: 'From v89', added: 8000, source: 'pdf', sha: nullSha, pdf: true }), m: Date.now() - 60000, up: true } }, info: { [P6]: { sha: nullSha, source: 'pdf', pdf: true, rev: null } }, held: {}, missing: {}, orphans: [] }));
L = W.cloud.log.length;
await pass();
check(!since(L).some((e) => e[1].includes(P6)) && row('song', P6).data.sha === null && !W.cloud.files.has(`${UID}/${P6}.xml.gz`), `12: the PDF-only row met: nothing of it goes up, no "null" file (${JSON.stringify(since(L).map((e) => e.slice(0, 2)))})`);
check(meta().items[`song:${P6}`].h === S.fingerprint({ title: 'From v89', added: 8000, source: 'pdf', sha: null, pdf: true }) && meta().info[P6].sha === null, '12: known as a PDF only (sha null)');
const F = device('F');
await pass();
check(F.songs.get(P6)?.xml === null && F.pdfs.get(P6)?.bytes === 40, '12: another device has it as a PDF only');
L = W.cloud.log.length;
device('E'); await pass(); device('F'); await pass(); device('E'); await pass();
check(since(L).length === 0, `12: no ping-pong between them (${JSON.stringify(since(L).map((e) => e.slice(0, 2)))})`);
// (the cloud holding v89's form of it — sha256("null"), a "null" file — newer: put right with the PDF, not that text)
const r12 = row('song', P6);
W.cloud.files.set(`${UID}/${P6}.xml.gz`, await gz('null'));
W.cloud.rows.set(`song:${P6}`, { ...r12, data: { ...r12.data, sha: nullSha, xml: { path: `${UID}/${P6}.xml.gz`, bytes: 24 } }, modified_at: new Date(Date.now() + 7200e3).toISOString(), updated_at: next() });
device('E');
L = W.cloud.log.length;
await pass();
const up12 = since(L).filter((e) => e[0] === 'upload').map((e) => e[1]);
check(row('song', P6).data.sha === null && row('song', P6).data.xml === null && !up12.some((p) => p.endsWith('.xml.gz')) && E.songs.get(P6).xml === 'null', `12: v89's form in the cloud: put right as the PDF only, no "null" sent (uploads ${JSON.stringify(up12)}, row ${JSON.stringify(row('song', P6).data)})`);
L = W.cloud.log.length; await pass(); device('F'); await pass(); device('E'); await pass();
check(since(L).length === 0, `12: then nothing (${JSON.stringify(since(L).map((e) => e.slice(0, 2)))})`);

// 13. Two deletes with a change between them (v94 review): G deletes a song (up); H reads it again
// (stamped after G's delete, its upload failing: still to go up); I, not synced since, deletes it
// later. I's delete goes up with its own stamp (it used to take G's earlier one and send nothing),
// so H's change, sent at last, is the older: the song stays gone on every device.
const X13 = { id: 's000aac1', title: 'Twice Gone', xml: XML('Twice Gone'), added: 9100, source: 'file' };
const tick = () => new Promise((r) => setTimeout(r, 5));
const G13 = device('G'); G13.songs.set(X13.id, structuredClone(X13)); await pass();
const H13 = device('H'); await pass();
const I13 = device('I'); await pass();
check(H13.songs.has(X13.id) && I13.songs.has(X13.id), '13: three devices have the song');
await tick(); device('G'); await lib.removeSong(X13.id); await pass();
await tick(); device('H'); await lib.replaceSong(X13.id, XML('Twice Gone v2'));
W.failUpload = (path) => path.includes(X13.id); await pass(); W.failUpload = null;
check(H13.songs.has(X13.id) && !meta().items[`song:${X13.id}`].up, '13: H\'s change waits to go up');
await tick(); device('I'); await lib.removeSong(X13.id);
L = W.cloud.log.length; await pass();
const up13 = since(L).filter((e) => e[1]?.includes(X13.id));
check(up13.length > 0 && meta().items[`song:${X13.id}`].up && meta().items[`song:${X13.id}`].del, `13: I's later delete goes up (${JSON.stringify(up13)})`);
device('H'); await pass(); device('G'); await pass(); device('I'); await pass(); device('H'); await pass();
check(row('song', X13.id)?.deleted && !G13.songs.has(X13.id) && !H13.songs.has(X13.id) && !I13.songs.has(X13.id),
  `13: H's change, sent at last, is older: gone everywhere (cloud ${row('song', X13.id)?.deleted ? 'deleted' : 'live'}; G ${G13.songs.has(X13.id)}, H ${H13.songs.has(X13.id)}, I ${I13.songs.has(X13.id)})`);
L = W.cloud.log.length; device('G'); await pass(); device('I'); await pass();
check(!since(L).some((e) => e[1]?.includes(X13.id)), '13: then nothing more of it goes up');

// 14. The piano fingering (E7: library.js `fing`, derived like `clean`) never syncs: not in the row, not in
// the file, not to another device; a new fingering alone sends nothing.
const ungz = async (b) => new TextDecoder().decode(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
const FG = { id: 's000aad1', title: 'Fingered', xml: XML('Fingered'), added: 9200, source: 'file', clean: { xml: null, ver: 'v98' },
  fing: { v: 1, alg: 1, hand: 'sb', bpm: 90, sig: '1:x', at: 1, ms: 1, n: { n0: ['l', 1, 0, 'm'] }, fr: { r: [], l: [[0, 55, 53, 52, 50, 48]] } } };
const J14 = device('J'); J14.songs.set(FG.id, structuredClone(FG));
L = W.cloud.log.length; await pass();
const r14 = row('song', FG.id), f14 = W.cloud.files.get(`${UID}/${FG.id}.xml.gz`);
const text14 = f14 ? await ungz(f14) : '';
check(r14 && !JSON.stringify(r14.data).includes('fing') && !/"n0"|"fr"/.test(JSON.stringify(r14.data)) && text14 === FG.xml, `14: a fingered song goes up without its fingering (row ${JSON.stringify(r14?.data)}, file = its MusicXML: ${text14 === FG.xml})`);
const K14 = device('K'); await pass();
check(K14.songs.has(FG.id) && !('fing' in K14.songs.get(FG.id)), `14: another device gets it without one (${JSON.stringify(Object.keys(K14.songs.get(FG.id) || {}))})`);
device('J'); J14.songs.get(FG.id).fing = { ...FG.fing, at: 2, alg: 2 };
L = W.cloud.log.length; await pass();
check(since(L).length === 0, `14: a new fingering alone sends nothing (${JSON.stringify(since(L).map((e) => e.slice(0, 2)))})`);

// 10. Limit 20.
check(S.SONG_LIMIT === 20, '10: SONG_LIMIT 20');
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
