// PDF → Song as a job: convert (omr.js), clean up (fixscore.js), title, save to My songs — and
// survive a reload, a crash or leaving the page (jobs.js keeps the PDF, what page prep found, the
// engine's book after every finished page and the events shown). No DOM: the host page draws the
// events (the Reader, omr/reader.js) and its own buttons.
//
//   import { createImporter } from './omr/importer.js?v=80';
//   const imp = createImporter({ onEvent, onLog, onState, onProgress, app: 'v80', spaceChanged });
//   const job = await imp.pending();            // an unfinished import of this space, or null:
//                                               //   { id, name, size, done, of, page, stuck: { s, page } | null, phase }
//   reader.load(await imp.storedEvents(job.id)); // what it showed so far (pages, finished sheets)
//   const res = await imp.resume(job.id);       // continue it: the same result as start()
//   const res = await imp.start(file);          // a new import (a File from the picker)
//     → { songId | null, title, score, xml, pages, failed, unsaved, log }
//   imp.resume(id, { skip: true })              // a page that stopped the engine twice: leave it out
//   imp.restart(id)                             // the same PDF from the beginning
//   imp.discard(id); imp.stop(); imp.busy(); imp.current
//
// onEvent gets the Reader's events (readerstate.js has the contract), each stamped with `at`. A resume
// passes only the live run's: the host shows the stored ones first, storedEvents() (a job event with
// resumed: true, the pages with their previews, meta, every finished sheet), e.g. Reader.load(). onState({ state, job }) — 'idle' | 'waiting' (another tab holds the engine) |
// 'running' | 'stuck' (the same page began twice without finishing: crash-loop guard) | 'done' |
// 'error' (job kept when it can be resumed: job.resumable).
//
// Resume: a run after a reload renders only the pages the stored book hasn't finished (the others
// are 1×1 placeholders), puts the book back in the engine's /files and runs Audiveris on it with
// the same settings: it skips the finished sheets (the engine side is in omr-build/README.md 0009).
// At most the page under way is read again. A job made by another engine (ENGINE) starts over from
// the stored PDF.

import { convertPdf, ENGINE, LOCK, BUSY, STEPS } from './omr.js?v=80';
import * as J from './jobs.js?v=80';
import { readScoreFile, parseMusicXml } from '../musicxml.js?v=80';
import { addSong } from '../library.js?v=80';
import { fixOmrScore, joinMovements } from './fixscore.js?v=80';
import { activeSpace, dbName, knownDbs } from '../space.js?v=80';

const LEFT = 'resonate.import.left'; // { id, stage, at }: the page was left (reload, navigation, hidden) in that stage — not a crash
const WAIT_MS = 6000;                // a reload's old page releases the engine lock as it unloads

export function createImporter(opts = {}) {
  const host = {
    onEvent: opts.onEvent || (() => {}), onLog: opts.onLog || (() => {}), onState: opts.onState || (() => {}),
    onProgress: opts.onProgress || null, app: opts.app || '', spaceChanged: opts.spaceChanged || (() => false),
  };
  let current = null;   // { job, ctl, stage, buckets, saving, discarded, … } while a job runs
  let state = 'idle';
  let wake = null;

  const setState = (s, extra = {}) => { state = s; try { host.onState({ state: s, ...extra }); } catch (err) { console.warn(err); } };
  const emit = (ev) => {
    if (!Number.isFinite(ev.at)) ev = { ...ev, at: Date.now() };
    try { host.onEvent(ev); } catch (err) { console.warn('onEvent', err); }
    return ev;
  };

  // --- engine lock (one conversion per browser) -----------------------------------------
  // Resolves with a release function; waits for another tab (state 'waiting') unless `wait` is 0.
  function takeLock(wait, onWaiting) {
    if (!navigator.locks) return Promise.resolve(() => {});
    return new Promise((resolve, reject) => {
      let release;
      const held = new Promise((r) => { release = r; });
      let waitingTimer = null;
      const ctl = new AbortController();
      const timer = wait > 0 && Number.isFinite(wait) ? setTimeout(() => ctl.abort(), wait) : null;
      if (onWaiting) waitingTimer = setTimeout(onWaiting, 1500);
      navigator.locks.request(LOCK, { signal: wait === Infinity ? undefined : ctl.signal }, () => {
        clearTimeout(timer); clearTimeout(waitingTimer);
        resolve(() => release());
        return held;
      }).catch((err) => {
        clearTimeout(waitingTimer);
        reject(err?.name === 'AbortError' ? Object.assign(new Error(BUSY), { kind: 'busy' }) : err);
      });
    });
  }

  // --- screen wake lock (Safari wants a gesture: retried on the next tap) -----------------
  // Held while a job runs (asked for in the tap that picks the file: `force`); let go when it ends —
  // saved, failed, stopped or refused — also when it ends while the request is still pending.
  let wantWake = false;
  async function keepAwake(force = false) {
    if (force) wantWake = true;
    if (wake || !navigator.wakeLock || document.hidden || !(current || wantWake)) return;
    try {
      const w = await navigator.wakeLock.request('screen');
      if (!(current || wantWake)) { w.release().catch(() => {}); return; }
      wake = w;
      w.addEventListener('release', () => { if (wake === w) wake = null; });
    } catch {}
  }
  function releaseWake() {
    wantWake = false;
    const w = wake;
    wake = null;
    try { w?.release()?.catch?.(() => {}); } catch {}
  }
  const onVisible = () => { if (!document.hidden) keepAwake(); };
  const onTap = () => keepAwake();
  document.addEventListener('visibilitychange', onVisible);
  document.addEventListener('pointerdown', onTap, true);

  // --- where a job is (the crash-loop guard) ------------------------------------------------
  // A run goes through stages — 'prep' (page prep, or a resumed run drawing its unread pages),
  // 'boot' (the engine starting), each sheet ('1', '2', …), 'export', 'save' — and each start of one
  // is counted in the job (starts[stage]). A run that ends inside a stage without the page being left
  // on purpose (a renderer crash, iOS ending a tab that took too much memory) leaves that count up;
  // the stage it was in begun twice without finishing → no auto-resume: 'stuck' (Retry, or Skip for a
  // page). A stage a run passed is cleared (the next run's boot isn't the last one's).
  const isSheet = (key) => /^\d+$/.test(String(key ?? ''));
  function enterStage(cur, key) {
    const job = cur.job;
    const prev = cur.stage; // (the stage this run was in: passed now — not one an earlier run ended in)
    job.starts = job.starts || {};
    job.lefts = job.lefts || {};
    if (prev && prev !== key && !isSheet(prev)) { delete job.starts[prev]; delete job.lefts[prev]; }
    job.stage = key;
    job.starts[key] = (job.starts[key] || 0) + 1;
    cur.stage = key;
    if (document.hidden) noteLeft(); // (hidden still: it's this stage an end would be in)
    write(cur, () => J.putJob(job));
  }
  // Every write of a running job goes through here, in order — none after ✕ forgot it.
  function write(cur, fn) {
    cur.saving = (cur.saving || Promise.resolve()).then(async () => {
      if (cur.discarded) return;
      try { await fn(); } catch (err) { console.warn('[import] store', err); }
    });
    return cur.saving;
  }

  // Leaving the page (reload, navigation, back/forward cache): note the stage under way as left on
  // purpose — not a crash — and stop the engine so the lock is free for the next page. A page hidden
  // (another app, the home screen) is noted the same way while it stays hidden, kept up to date as
  // the run moves on: iOS may end a background tab, which isn't the page's fault either.
  const noteLeft = () => {
    try { localStorage.setItem(LEFT, JSON.stringify({ id: current.job?.id, stage: current.stage || null, at: Date.now() })); } catch {}
  };
  window.addEventListener('pagehide', () => {
    if (!current) return;
    noteLeft();
    current.ctl.abort();
  });
  document.addEventListener('visibilitychange', () => {
    if (!current) return;
    if (document.hidden) noteLeft();
    else { try { if (JSON.parse(localStorage.getItem(LEFT) || 'null')?.id === current.job?.id) localStorage.removeItem(LEFT); } catch {} }
  });

  // --- jobs ---------------------------------------------------------------------------------
  // A job belongs to the songs' database its song goes into (space.js dbName): the data it follows
  // through sign-up (adopt), sign-in (shelved), a session ending (parked) and Sign out (gone). Jobs
  // whose database no space has any more, and jobs untouched for MAX_AGE, are dropped — with any data
  // left under an id no job has (an import that couldn't finish being stored).
  const mine = (j) => (j.db ? j.db === dbName() : j.space === activeSpace());
  async function prune() {
    let jobs = [];
    try { jobs = await J.listJobs(); } catch { return []; }
    const now = Date.now(), dbs = knownDbs();
    const keep = [];
    for (const j of jobs) {
      const gone = j.db ? !dbs.has(j.db)
        : j.space !== 'anon' && j.space !== activeSpace() && !localStorage.getItem(`resonate.parked.${j.space}`);
      if (now - (j.updated || j.created || 0) > J.MAX_AGE || gone) { try { await J.deleteJob(j.id); } catch {} }
      else keep.push(j);
    }
    try { await J.dropOrphans(keep.map((j) => j.id).concat(current ? [current.job.id] : [])); } catch {}
    return keep;
  }
  const summary = (j) => {
    const stuck = stuckStage(j);
    return {
      id: j.id, name: j.name, size: j.size, phase: j.phase, of: j.music?.length || 0, done: (j.done || []).length,
      failed: (j.failed || []).length, engine: j.engine === ENGINE, updated: j.updated,
      stuck: stuck ? { stage: stuck.key, s: stuck.s, page: stuck.s ? pageOf(j, stuck.s) : null } : null,
    };
  };
  const pageOf = (j, s) => j.music?.find((m) => m.s === s)?.page ?? s;
  const nextSheet = (j) => (j.music || []).map((m) => m.s).find((s) => !(j.done || []).includes(s) && !(j.skip || []).includes(s)) ?? null;
  // The stage a run of this job would be in when it ended: the one it last began (a job stored before
  // stages were kept: the next sheet to read).
  function stageOf(j) {
    if (j.stage) return String(j.stage);
    if (j.phase !== 'read') return null;
    const s = nextSheet(j);
    return s ? String(s) : null;
  }
  function stuckStage(j) {
    const key = stageOf(j);
    if (!key) return null;
    if (isSheet(key) && ((j.done || []).includes(+key) || (j.skip || []).includes(+key) || !(j.music || []).some((m) => m.s === +key))) return null;
    const crashes = (j.starts?.[key] || 0) - (j.lefts?.[key] || 0);
    return crashes >= 2 ? { key, s: isSheet(key) ? +key : null } : null;
  }
  // A stage left on purpose (pagehide, a hidden tab) doesn't count as a crash.
  function foldLeft(j) {
    try {
      const l = JSON.parse(localStorage.getItem(LEFT) || 'null');
      if (l && l.id === j.id) {
        const key = l.stage ?? (l.s ? String(l.s) : null);
        if (key) { j.lefts = j.lefts || {}; j.lefts[key] = (j.lefts[key] || 0) + 1; }
        localStorage.removeItem(LEFT);
        return true;
      }
    } catch {}
    return false;
  }

  async function pending() {
    const jobs = (await prune()).filter((j) => mine(j) && j.phase !== 'gone');
    jobs.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const j = jobs[0];
    if (!j) { J.clearFlag(); try { localStorage.removeItem(LEFT); } catch {} return null; }
    if (foldLeft(j)) await J.putJob(j);
    J.setFlag(j);
    return summary(j);
  }

  // What the Reader showed so far that a resume goes on from — only that: a job made by another engine
  // (or whose pages weren't all found) starts over, so it gets just the job; a sheet the stored book
  // doesn't hold any more is read again, so its events stay out (the Reader never shows a page read
  // and then has it read again: its progress only goes forward).
  async function storedEvents(id) {
    const j = await J.getJob(id);
    if (!j) return [];
    const jobEv = { t: 'job', id: j.id, name: j.name, size: j.size, resumed: true, at: j.created };
    if (j.engine !== ENGINE || !j.music?.length) return [jobEv];
    let keep = null; // (null: every stored sheet)
    if (j.phase !== 'save') {
      const book = await J.getData(id, 'book');
      const chk = book?.bytes ? await J.checkBook(book.bytes) : { done: [], invalid: [] };
      keep = [...chk.done, ...chk.invalid];
    }
    return [jobEv, ...(await J.loadEvents(id, keep))];
  }

  async function discard(id) {
    const cur = current?.job?.id === id ? current : null;
    if (cur) {
      cur.discarded = true; // (a book being checked or stored right now isn't written after all)
      stop();
      await cur.saving;
    }
    await J.deleteJob(id);
    try { localStorage.removeItem(LEFT); } catch {}
  }

  function stop() {
    current?.ctl.abort();
  }

  // --- a run ----------------------------------------------------------------------------------
  let starting = false;
  async function start(file) {
    if (current || starting) throw new Error('An import is already running here.');
    starting = true;
    try { return await begin(file); } finally { starting = false; }
  }
  async function begin(file) {
    keepAwake(true); // while the tap that picked the file still counts (Safari wants one)
    const job = {
      id: J.newId(), space: activeSpace(), db: dbName(), name: file.name || 'song.pdf', size: file.size ?? null,
      lastModified: file.lastModified ?? null, type: file.type || 'application/pdf', engine: ENGINE, app: host.app,
      created: Date.now(), phase: 'prep', music: null, of: null, title: null, tempo: null,
      done: [], failed: [], starts: {}, lefts: {}, fails: {}, stage: null, runs: 0, skip: [],
    };
    const bytes = await file.arrayBuffer();
    let stored = true;
    try {
      await J.createJob(job, bytes);
      J.setFlag(job);
    } catch (err) {
      stored = false;
      host.onLog(`[resume] the import can't be kept on this device (${err?.message || err}); a reload starts over`);
    }
    return run(job, { bytes, stored, file });
  }

  async function resume(id, { skip = false, retry = false } = {}) {
    if (current || starting) throw new Error('An import is already running here.');
    let release;
    try {
      release = await takeLock(Infinity, () => setState('waiting', { job: null, why: 'tab' }));
    } catch (err) {
      setState('error', { error: err });
      throw err;
    }
    let j;
    try {
      j = await J.getJob(id);
      if (!j) { release(); setState('idle', { job: null, why: 'gone' }); return null; } // finished in another tab
      foldLeft(j);
      const stuck = stuckStage(j);
      if (stuck && !(skip && stuck.s) && !retry) {
        await J.putJob(j);
        release();
        setState('stuck', { job: summary(j) });
        return null;
      }
      if (stuck && skip && stuck.s) j.skip = [...new Set([...(j.skip || []), stuck.s])];
      if (stuck && retry) { j.lefts = j.lefts || {}; j.lefts[stuck.key] = (j.starts?.[stuck.key] || 0); }
      const bytes = await J.getData(id, 'pdf');
      if (!bytes) { release(); await J.deleteJob(id); setState('idle', { job: null, why: 'nopdf' }); return null; }
      return await run(j, { bytes, stored: true, release, resumed: true });
    } catch (err) {
      release?.();
      throw err;
    }
  }

  async function restart(id) {
    const j = await J.getJob(id);
    if (!j) return null;
    resetJob(j);
    await J.putJob(j);
    await J.dropSheetEvents(id, []);
    return resume(id);
  }
  function resetJob(j) {
    Object.assign(j, { engine: ENGINE, app: host.app, phase: 'prep', music: null, of: null, title: null, tempo: null,
      done: [], failed: [], starts: {}, lefts: {}, fails: {}, stage: null, skip: [] });
  }

  // An error: keep the job (Try again continues it) only when another try could do better — not a
  // file that can't be read (pdf.js refused it, no music, blank, no page the engine could read) — and
  // only once per stage: the same error twice and it's dropped (Try again → the picker).
  const SAME_AGAIN = ['pdf', 'nomusic', 'blank', 'unread', 'missing'];
  function keepAfter(job, err, stored) {
    if (!stored || SAME_AGAIN.includes(err?.kind)) return false;
    const key = job.stage || 'prep';
    job.fails = job.fails || {};
    job.fails[key] = (job.fails[key] || 0) + 1;
    return job.fails[key] < 2;
  }
  // The run is over (an error, refused, stopped): nothing more to keep awake for.
  function ended(cur) {
    if (current === cur) current = null;
    releaseWake();
  }

  async function run(job, { bytes, stored, release = null, resumed = false }) {
    const ctl = new AbortController();
    const cur = current = { job, ctl, stage: null, buckets: new Map(), pre: [], stored, saving: null, discarded: false };
    const log = [];
    const onLog = (l) => { log.push(l); host.onLog(l); };
    setState('running', { job: summary(job) });
    keepAwake();
    try {
      if (!release) release = await takeLock(WAIT_MS);
    } catch (err) {
      // Another tab is converting: a new import is refused (and not kept); a resumed one stays.
      ended(cur);
      if (!resumed && stored) { try { await J.deleteJob(job.id); } catch {} }
      emit({ t: 'error', message: err.message, kind: err.kind || 'busy' });
      setState('error', { error: err, job: summary(job), resumable: resumed && stored });
      throw err;
    }
    // What the book can continue from (a resumed job), or a fresh engine run.
    let plan = null;
    if (resumed) {
      // (The host showed the stored events already: storedEvents() — only what this run goes on from.)
      if (job.engine !== ENGINE) {
        onLog(`[resume] another engine made this job (${job.engine}); starting over from the stored PDF`);
        resetJob(job);
        await J.putJob(job);
        await J.dropSheetEvents(job.id, []);
        try { await J.putData(job.id, 'book', null); } catch {}
      }
      plan = await planResume(job, onLog);
    } else {
      emit({ t: 'job', id: job.id, name: job.name, size: job.size, resumed: false });
    }
    if (plan?.finishOnly) return finish(cur, job, plan.res, log, release, bytes);

    job.runs = (job.runs || 0) + 1;
    if (stored) enterStage(cur, 'prep');

    // Live events: stamped, passed on, and kept per sheet until the book holds that sheet.
    const onEvent = (ev) => {
      ev = emit(ev);
      if (!stored) return;
      if (ev.t === 'page' || ev.t === 'meta' || (ev.t === 'phase' && ev.phase === 'pages')) cur.pre.push(ev);
      else if (Number.isFinite(ev.s) && ['sheet', 'step', 'grid', 'sym', 'measures', 'words', 'notes'].includes(ev.t)) {
        if (!cur.buckets.has(ev.s)) cur.buckets.set(ev.s, []);
        cur.buckets.get(ev.s).push(ev);
      }
      if (ev.t === 'phase' && ev.phase === 'engine') {
        if (!plan) prepDone(cur, job);
        enterStage(cur, 'boot');
      }
      if (ev.t === 'sheet' && ev.state === 'start') enterStage(cur, String(ev.s));
      if (ev.t === 'sheet' && ev.state === 'failed') {
        job.failed = [...(job.failed || []).filter((f) => f.sheet !== ev.s), { sheet: ev.s, page: pageOf(job, ev.s), step: ev.step || '?', reason: ev.reason || '' }];
      }
      if (ev.t === 'phase' && ev.phase === 'export') { job.phase = 'export'; enterStage(cur, 'export'); }
    };
    const onBook = (s, bytes) => { if (stored) keepBook(cur, job, s, bytes, onLog); };

    let res;
    try {
      res = await convertPdf(bytes, {
        locked: true, previews: !plan, dir: `/files/omr-${job.id}`, signal: ctl.signal,
        onEvent, onBook, onLog, onProgress: host.onProgress,
        ...(plan ? { resume: plan } : {}),
      });
    } catch (err) {
      await cur.saving;
      ended(cur);
      release();
      if (err?.name === 'AbortError') { setState('idle', { job: summary(job), stopped: true }); throw err; }
      const keep = !cur.discarded && keepAfter(job, err, stored);
      if (stored && !cur.discarded) {
        if (keep) { try { await J.putJob(job); } catch {} } else { try { await J.deleteJob(job.id); } catch {} }
      }
      emit({ t: 'error', message: err?.message || String(err), kind: err?.kind || 'engine' });
      setState('error', { error: err, job: summary(job), resumable: keep });
      throw err;
    }
    if (stored) {
      await write(cur, async () => {
        job.phase = 'save';
        await J.putData(job.id, 'mxl', {
          mxls: res.mxls.map((u) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength)),
          log: res.log.filter((l) => /No beat unit|failed at|Music font|exported to|Error visiting Measure/.test(l)),
          lost: res.lost || [],
        });
        await J.putJob(job);
      });
    }
    await cur.saving;
    return finish(cur, job, res, log, release, bytes);
  }

  // Page prep is done (the engine starts): keep what it found — the pages (with their previews),
  // title, tempo, which pages are music — so a reload doesn't draw them again for the Reader.
  function prepDone(cur, job) {
    if (!cur.stored) return;
    const pages = cur.pre.filter((e) => e.t === 'page');
    job.music = pages.filter((p) => p.music).map((p) => ({ page: p.page, s: p.s, w: p.w, h: p.h }));
    job.of = pages[0]?.of ?? pages.length;
    const meta = cur.pre.find((e) => e.t === 'meta');
    job.title = meta?.title ?? null;
    job.tempo = meta?.tempo ?? null;
    job.phase = 'read';
    const evs = cur.pre.slice();
    write(cur, async () => { await J.saveEvents(job.id, 'pre', evs); await J.putJob(job); J.setFlag(job); });
  }

  // The engine's book after sheet s: checked (a zip whose book.xml has sheet s read), then kept with
  // that sheet's events in one transaction.
  function keepBook(cur, job, s, bytes, onLog) {
    write(cur, async () => {
      const chk = await J.checkBook(bytes, s);
      if (!chk.ok) { onLog(`[resume] book after sheet ${s} not kept: ${chk.why}`); return; }
      if (cur.discarded) return;
      job.done = [...new Set([...chk.done, ...chk.invalid])].sort((a, b) => a - b);
      const evs = cur.buckets.get(s) || [];
      cur.buckets.delete(s);
      await J.saveSheet(job, s, { s, done: job.done, bytes }, evs);
      J.setFlag(job);
    });
  }

  // How a stored job goes on: its exported MusicXML (only the save was left), the book (the engine
  // continues it), or the engine from the first sheet with the pages already found; null = all over.
  async function planResume(job, onLog) {
    if (job.phase === 'save') {
      const mx = await J.getData(job.id, 'mxl');
      if (mx?.mxls?.length) {
        onLog('[resume] the MusicXML was already made; saving it');
        return { finishOnly: true, res: { mxls: mx.mxls.map((b) => new Uint8Array(b)), pages: job.music.map((m) => m.page), music: job.music, title: job.title, tempo: job.tempo, failed: job.failed || [], lost: mx.lost || [], log: mx.log || [] } };
      }
    }
    if (!job.music?.length) { onLog('[resume] the pages weren\'t all found yet; starting over'); resetJob(job); return null; }
    const book = await J.getData(job.id, 'book');
    let done = [];
    let bytes = null;
    if (book?.bytes) {
      const chk = await J.checkBook(book.bytes);
      if (chk.done.length || chk.invalid.length) { done = [...new Set([...chk.done, ...chk.invalid])]; bytes = book.bytes; }
      else onLog('[resume] the stored book holds no finished page; reading from the first page');
    }
    job.done = done;
    await J.dropSheetEvents(job.id, done); // a sheet's events stay only with the book that has it
    // A page skipped after it stopped the engine twice: drawn blank, so the engine leaves it out.
    const blank = (job.skip || []).filter((s) => !done.includes(s));
    onLog(`[resume] ${job.name}: ${done.length} of ${job.music.length} pages read${blank.length ? `; skipping page ${blank.map((s) => pageOf(job, s)).join(', ')}` : ''}`);
    return { book: bytes ? bytes.slice(0) : null, music: job.music, done, blank, failed: job.failed || [], title: job.title, tempo: job.tempo };
  }

  // MusicXML → cleaned, titled song in My songs (as pdf-import.js did before v81).
  async function finish(cur, job, res, log, release, pdfBytes = null) {
    try {
      if (cur.stored) enterStage(cur, 'save');
      emit({ t: 'phase', phase: 'clean' });
      const base = job.name.replace(/\.pdf$/i, '') || 'song';
      const xmls = [];
      for (const [i, b] of res.mxls.entries()) xmls.push(await readScoreFile(new File([b], `${base}-${i + 1}.mxl`)));
      const joined = joinMovements(xmls);
      const fixLog = (m) => { host.onLog(`[fix] ${m}`); emit({ t: 'fix', msg: m }); };
      if (xmls.length > 1) fixLog(`${xmls.length} scores (movements) joined into one`);
      const fixed = fixOmrScore(joined, res.log.length ? res.log : log, { tempo: res.tempo });
      for (const c of fixed.changes) fixLog(c);
      // A page skipped after it stopped the engine twice failed on purpose (drawn blank): say so.
      res.failed = res.failed.map((f) => ((job.skip || []).includes(f.sheet) ? { ...f, step: 'skip', reason: 'left out: it stopped the engine twice' } : f));
      const firstFailed = res.failed.some((f) => f.sheet === 1);
      const title = chooseTitle(res, fixed.xml, firstFailed, base);
      let xml = setTitle(fixed.xml, title);
      const mode = modeFromFileName(base);
      if (mode) { xml = setMode(xml, mode); fixLog(`key mode from the file name: ${mode}`); }
      const score = parseMusicXml(xml, title);
      emit({ t: 'meta', title: score.title });
      for (const t of excerpts(xml)) emit({ t: 'xml', text: t });
      emit({ t: 'phase', phase: 'save' });
      const unsaved = host.spaceChanged();
      let songId = null;
      if (!unsaved) {
        // The original PDF goes with the song (Play's 📄): the job's copy, else the bytes this run had.
        const pdf = (cur.stored ? await J.getData(job.id, 'pdf') : null) || pdfBytes;
        songId = await addSong(score.title, xml, { source: 'pdf', ...(pdf ? { pdf, pdfName: job.name } : {}) });
        try { localStorage.setItem('resonate.sing.song', songId); localStorage.removeItem('resonate.sing.verse'); } catch {}
      }
      if (cur.stored) { cur.discarded = true; await cur.saving; try { await J.deleteJob(job.id); } catch {} }
      emit({ t: 'done', songId, title: score.title });
      ended(cur);
      release?.();
      const out = { songId, title: score.title, score, xml, pages: res.pages, failed: res.failed, lost: res.lost || [], unsaved, log: res.log, jobId: job.id };
      setState('done', { job: null, result: out });
      return out;
    } catch (err) {
      ended(cur);
      release?.();
      const keep = keepAfter(job, err, cur.stored && !cur.discarded);
      if (cur.stored && !cur.discarded) {
        if (keep) { try { await J.putJob(job); } catch {} } else { try { await J.deleteJob(job.id); } catch {} }
      }
      emit({ t: 'error', message: err?.message || String(err), kind: 'save' });
      setState('error', { error: err, job: summary(job), resumable: keep });
      throw err;
    } finally {
      releaseWake();
    }
  }

  return {
    pending, storedEvents, start, resume, restart, discard, stop,
    busy: () => !!current,
    resumable: () => !!current?.stored, // a reload now continues the import (it's kept on this device)
    get current() { return current ? summary(current.job) : null; },
    get state() { return state; },
  };
}

// --- the song's title and key mode (moved from pdf-import.js in v81; tools/titlecases.cjs evaluates
// this stretch of the source, from the title regexes down to setTitle) ---------------------------
// The title, best source first: the PDF's own text (exact; vector PDFs only), the file
// name when it's clearly a title (a seller's name like Musicnotes'
// "Wichita_Lineman_-_F_Major_-_MN0305807" → "Wichita Lineman"; or anything that isn't a
// camera/scanner default like "Scanned Document 2" or "IMG_0042"), then the largest-font
// text Audiveris read on the first page (OCR: often a footer like "Authorized for use by:
// …" or a chord name, hence last), else the file name as it is.
const NOT_TITLE = /authori[sz]ed for use|musicnotes|copyright|©|all rights reserved|published (by|under)|words and music/i;
const GENERIC_NAME = /^((scanned )?(document|scan|img|image|photo|picture|page|untitled|score|sheet ?music|music|download|file|song|pdf|camscanner|adobe scan)\b)?[\s\d_\-().:,]*$/i;
const SELLER = /\s+-\s+[A-G][b#♭♯]?\s*(major|minor|maj|min)\b.*$|\s*-?\s*\bMN\d{5,}\b.*$/i;

function cleanFileName(name) {
  const plain = name.replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  const title = plain.replace(SELLER, "").trim();
  return { title: title || plain, seller: title !== plain && !!title };
}

// The key's mode a seller put in the file name ("…_-_F_Major_-_MN0305807"), or null.
export function modeFromFileName(name) {
  const m = /[\s_]-[\s_]+[A-G][b#♭♯]?[\s_]*(major|minor)\b/i.exec(name);
  return m ? m[1].toLowerCase() : null;
}

// Write <mode> into every <key> that has none (the Sing page names keys "F" vs "Dm").
export function setMode(xml, mode) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  let n = 0;
  for (const key of doc.querySelectorAll("key")) {
    if (key.querySelector("mode") || !key.querySelector("fifths")) continue;
    const m = doc.createElement("mode");
    m.textContent = mode;
    key.querySelector("fifths").after(m);
    n++;
  }
  return n ? new XMLSerializer().serializeToString(doc) : xml;
}

export function chooseTitle(res, xml, firstFailed, baseName) {
  if (res.title) return res.title;
  const file = cleanFileName(baseName);
  if (file.seller || (file.title && !GENERIC_NAME.test(file.title))) return file.title;
  return (!firstFailed && pickTitle(xml, null)) || file.title || baseName;
}

// The largest-font credit Audiveris read on the first page, if it looks like words.
function pickTitle(xml, fallback) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  let best = null, size = 0;
  for (const c of doc.querySelectorAll("credit")) {
    if ((c.getAttribute("page") || "1") !== "1") continue;
    for (const w of c.querySelectorAll("credit-words")) {
      const t = (w.textContent || "").trim();
      const s = parseFloat(w.getAttribute("font-size")) || 0;
      // Words (letters and digits not run together like "Blzmaj7", "C2"), not a publisher's line.
      if (s > size && /\p{L}{3}|^\d{2,}$/u.test(t) && !/\p{L}\d|\d\p{L}/u.test(t) && !NOT_TITLE.test(t) && t.length >= 2 && t.length <= 80) { size = s; best = t; }
    }
  }
  return best || fallback;
}

export function setTitle(xml, title) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const root = doc.documentElement;
  let mt = root.querySelector(":scope > movement-title");
  if (!mt) {
    mt = doc.createElement("movement-title");
    root.insertBefore(mt, root.firstElementChild);
  }
  mt.textContent = title;
  return new XMLSerializer().serializeToString(doc);
}

// A few real stretches of the saved MusicXML for the Reader's code column: the head (title,
// parts), the first measure that has words, the last measure — each cut to a screenful at the end of
// a line that closes an element (never mid-tag: "<voic" … read as a broken file at the very moment
// it's done), "…" after a cut.
export function excerpts(xml, max = 1400) {
  const out = [];
  const cut = (s) => {
    if (s.length <= max) return s;
    const lines = s.split('\n');
    let n = 0, end = 0, closed = 0;
    for (let i = 0; i < lines.length; i++) {
      n += lines[i].length + 1;
      if (n > max) break;
      end = i + 1;
      if (/^\s*<\/|\/>\s*$|<\/[\w:.-]+>\s*$/.test(lines[i])) closed = i + 1;
    }
    const keep = closed || end;
    return keep ? `${lines.slice(0, keep).join('\n')}\n…` : `${lines[0].slice(0, max).replace(/<[^>]*$/, '')}\n…`;
  };
  const head = /<score-partwise[\s\S]*?<\/part-list>/.exec(xml);
  if (head) out.push(cut(head[0]));
  const measures = [...xml.matchAll(/<measure\b[\s\S]*?<\/measure>/g)].map((m) => m[0]);
  const sung = measures.find((m) => /<lyric\b/.test(m));
  if (sung) out.push(cut(sung));
  const last = measures[measures.length - 1];
  if (last && last !== sung) out.push(cut(last));
  return out;
}
