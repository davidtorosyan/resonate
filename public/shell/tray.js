// The Reader tray: PDF → Song in the background, never leaving the page. The importer
// (omr/importer.js, its jobs in omr/jobs.js) runs the conversion in its worker; the Reader
// (omr/reader.js) draws it — as a sheet on a phone, a panel above the dock on a tablet — and ⌄
// folds it into a tile (a pill on a wide screen) beside Songs. Done: "✓ Title · ready  Open ✕", and
// the Reader's own Sing it / Play it open the song in place with Sing / the Score shown.
// As pdf-import.js: a reload continues an unfinished import of this space, the Reader's ✕ (two
// taps) stops and forgets it, a stage that stopped twice offers Skip / Retry, the importer holds the
// engine's Web Lock and the screen wake lock, and pagehide stops the engine.
// v90 (docs/LIBRARY.md §4): a PDF is a song as soon as it's added (songlist.js); converting it is a
// queue (omr/queue.js, stored per space: a reload goes on with it) — Convert, Convert all, Reconvert
// all, the Score's 📄 Convert / ⟳ — run here one song at a time, folded (the tile says "song 2/5").
// Each converts the song's stored PDF under its id (the importer's reprocess: replaceSong), and an
// open song loads it again (onReplaced). A song that can't be read (the same would happen again) is
// marked and passed by; one that stopped for another reason pauses the queue with the bar (Try
// again / Retry / Skip go on, Close passes it by); the Reader's ✕ stops it and the rest. One done
// row at the end: the song, or "✓ N converted". The screen is kept awake from the tap to the end.
import { createImporter } from "../omr/importer.js?v=89";
import { mount as mountReader } from "../omr/reader.js?v=89";
import { readFlag } from "../omr/jobs.js?v=89";
import { readQueue, writeQueue, enqueue, dropFromQueue, clearQueue } from "../omr/queue.js?v=89";
import { ENGINE_N } from "../omr/engine.js?v=89";
import { activeSpace, activeDb } from "../space.js?v=89";
import { etaText } from "../omr/readerstate.js?v=89";
import { songInfo } from "../catalog.js?v=89";
import { listPdfIds, markConvFailed } from "../library.js?v=89";
import { ic, esc, openOverlay, closeOverlay, overlayOpen, pageOpen } from "./chrome.js?v=89";

const $ = (id) => document.getElementById(id);
const STAGE = { prep: "pages", boot: "engine", export: "MusicXML", save: "saving" };
const RING = 2 * Math.PI * 17;
// The importer's errors that would come back the same on another try (importer.js SAME_AGAIN, and
// 'nopdf': the song or its PDF isn't on this device): the song is marked and the queue goes on.
const SAME_AGAIN = ["pdf", "nomusic", "blank", "unread", "missing", "nopdf"];
const sleep = (t) => new Promise((r) => setTimeout(r, t));

export function mountTray({ version, spaceChanged, openSong, onChange = () => {}, onReplaced = () => {} }) {
  const sheet = $("tray"), host = $("reader-host"), bar = $("tray-bar"), barMsg = $("tray-msg");
  const mini = $("imp-mini"), doneRow = $("imp-done");
  let reader = null, running = false, unsaved = false, state = "idle", jobId = null, jobName = "";
  let title = "", result = null, error = null, resumable = false, stuck = null, busyErr = false;
  // The song this run converts ({ id, title, wasPdf }; null: a new PDF read from a file — the ?pdf=
  // test hook, an import begun before v90), kept while it's paused on the bar.
  let cur = null;
  let runP = null;          // the run under way (drive's promise)
  let batchOk = 0;          // songs converted in this batch (this page's count)
  let lastOk = null;        // the last song converted (the Reader's Sing it / Play it at a batch's end)
  const forced = new Set(); // asked for one by one (Convert, the Score's ⟳): converted even with this engine
  const forgetting = new Set(); // being deleted: a save that finishes anyway isn't announced
  const events = [];
  const log = [];

  const imp = createImporter({
    app: version, spaceChanged,
    onEvent: push,
    onLog: (l) => { log.push(l); if (log.length > 4000) log.splice(0, 1000); },
    onState: showState,
  });

  function push(ev) {
    const e = Number.isFinite(ev.at) ? ev : { ...ev, at: Date.now() };
    events.push(e);
    if (e.t === "job" && e.name) jobName = e.name;
    if (e.t === "meta" && e.title) title = e.title;
    reader?.push(e);
    renderMini();
  }

  // --- the Reader, in the tray ----------------------------------------------------------------
  const onTrayClose = () => { sheet.hidden = true; if (reader?.mode === "open") reader.minimize(); renderMini(); };
  function ensureReader({ minimized = false } = {}) {
    if (reader) return reader;
    reader = mountReader(host, {
      minimized, onStop: stopImport,
      links: { sing: "sing.html", play: "play.html" },
      onMinimize: () => { if (overlayOpen("tray")) closeOverlay(); sheet.hidden = true; renderMini(); },
      onExpand: () => {
        sheet.hidden = false;
        openOverlay("tray", onTrayClose);
        renderMini();
      },
    });
    if (!minimized) { sheet.hidden = false; openOverlay("tray", onTrayClose); }
    return reader;
  }
  function expand() {
    if (!reader) return;
    if (reader.mode === "open") { sheet.hidden = false; return; }
    reader.expand();
  }
  // The Reader and what it showed gone (the tray closed).
  function dropReader() {
    if (overlayOpen("tray")) closeOverlay();
    reader?.destroy();
    reader = null;
    sheet.hidden = true;
    events.length = 0;
  }
  function clear() {
    dropReader();
    result = null; error = null; stuck = null; resumable = false; busyErr = false; title = ""; jobName = ""; jobId = null;
    renderBar();
    renderMini();
  }
  // The next song of a queue: a new Reader in the same place — open stays open (the tray and its
  // history entry kept), folded stays folded.
  function freshReader() {
    const open = reader?.mode === "open" && overlayOpen("tray");
    reader?.destroy();
    reader = null;
    events.length = 0;
    result = null; error = null; stuck = null; resumable = false; busyErr = false; title = ""; jobName = ""; jobId = null;
    renderBar();
    return open;
  }

  // The importer's state → the Reader and the bar under it (pdf-import.js showState).
  function showState({ state: s, job, resumable: r }) {
    state = s;
    if (s === "stuck" || s === "waiting" || s === "idle") reader?.hold(true);
    reader?.canStop(s !== "waiting");
    if (job?.id) jobId = job.id;
    if (job?.name) jobName = job.name;
    stuck = s === "stuck" ? job?.stuck || null : null;
    if (s === "error") resumable = !!r;
    if (s === "stuck") imp.holdWake?.(false); // (waiting for a tap: the screen may sleep — Skip / Retry ask again)
    renderBar();
    renderMini();
  }
  function renderBar() {
    const btns = [];
    let text = "";
    if (state === "waiting" && running) text = "Running in another tab";
    else if (stuck) {
      text = stuck.page ? `Page ${stuck.page} stopped twice` : `Stopped twice: ${STAGE[stuck.stage] || stuck.stage}`;
      if (stuck.page) btns.push(`<button type="button" class="chip" data-act="skip">Skip page ${stuck.page}</button>`);
      btns.push(`<button type="button" class="chip" data-act="retry">Retry</button>`);
    } else if (error) {
      text = error;
      if (resumable || busyErr) btns.push(`<button type="button" class="chip" data-act="again">Try again</button>`);
      btns.push(`<button type="button" class="chip" data-act="dismiss">Close</button>`);
    }
    bar.hidden = !text;
    barMsg.textContent = text;
    bar.querySelector(".btns").innerHTML = btns.join("");
  }
  // The Reader's Sing it / Play it: the new song in place, with Sing or the Score shown (never a
  // page of its own: in a queue the song just converted).
  host.addEventListener("click", (e) => {
    const a = e.target.closest?.(".rd-sing, .rd-play");
    if (!a || e.button || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    const id = result?.songId || lastOk?.songId;
    if (!id) return;
    if (overlayOpen("tray")) closeOverlay({ keepHistory: !pageOpen() }); // (its history entry becomes the song's — openPage — unless a song has its own)
    if (!running && !cur) clear();
    openSong(id, a.classList.contains("rd-play") ? { score: true } : { sing: true });
  });
  bar.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act && act !== "dismiss" && readQueue().ids.length + (cur ? 1 : 0)) imp.holdWake?.(true); // (in the tap: a queue goes on)
    if (act === "skip" || act === "retry") { if (!running) continueJob({ id: jobId, name: jobName, size: 0, replace: cur?.id || null }, { [act]: true }); }
    else if (act === "again") again();
    else if (act === "dismiss") dismiss();
  });

  // --- runs (pdf-import.js drive / continueJob) -----------------------------------------------
  // song: the song this run converts (a queue's), or null (a new PDF from a file).
  function drive(job, go, { minimized = false, song = null } = {}) {
    if (running) return runP;
    running = true;
    cur = song;
    error = null; result = null; busyErr = false;
    if (job.id) jobId = job.id;
    if (job.name) jobName = job.name;
    ensureReader({ minimized });
    renderBar();
    onChange(); // (the song list: "converting")
    return (runP = (async () => {
      try {
        const res = await go();
        if (res) done(res);
        else if (state === "idle") { // (finished or forgotten in another tab)
          clear();
          if (cur) songEnded(false);
        }
      } catch (err) {
        if (err?.name !== "AbortError") fail(err);
      } finally {
        running = false;
        runP = null;
        renderMini();
        onChange();
        setTimeout(pump, 0);
      }
    })());
  }
  function start(file) {
    if (running || imp.busy()) { flash("One PDF at a time"); return; }
    clear();
    log.length = 0;
    log.push(`Resonate ${version} · ${new Date().toISOString()}`, navigator.userAgent, `PDF ${((file.size || 0) / 1e6).toFixed(1)} MB · ${file.name}`);
    return drive({ name: file.name }, () => imp.start(file));
  }
  async function songOf(id) {
    const info = await songInfo(id).catch(() => null);
    return { id, title: info?.title || "", wasPdf: info?.k === "pdf" };
  }
  function continueJob(job, opts = {}, { minimized = false } = {}) {
    const go = (song) => drive(job, async () => {
      if (!events.length || events.every((e) => e.t === "job")) {
        const stored = await imp.storedEvents(job.id);
        events.length = 0;
        events.push(...stored);
        reader.load(stored);
        renderMini();
      }
      return imp.resume(job.id, opts);
    }, { minimized, song });
    if (!job.replace) return go(null);
    if (cur?.id === job.replace) return go(cur);
    return songOf(job.replace).then(go);
  }
  // An unfinished import of this space: the tile at once (the flag names the job), its stored events
  // as soon as the database answers, then it goes on — minimized: home stays the tuner. Then the
  // queue goes on (a reload between two songs of a batch).
  async function resumePending({ minimized = true } = {}) {
    if (readQueue().ids.length) imp.holdWake?.(true); // (Safari wants a tap: the importer asks again at the next one)
    const flag = readFlag();
    if (flag?.id && (flag.db ? flag.db === activeDb() : flag.space === activeSpace())) {
      ensureReader({ minimized });
      push({ t: "job", id: flag.id, name: flag.name || "", resumed: true });
    }
    try {
      const job = await imp.pending();
      if (job) await continueJob(job, {}, { minimized });
      else if (!running) { clear(); if (cur) songEnded(false); } // (a song paused on the bar whose import is gone: passed by)
    } catch (err) {
      console.warn("import jobs", err);
      if (!running) clear();
    }
    pump();
  }
  function again() {
    if (busyErr) { // (another tab had the engine: this song is first in the queue again)
      const open = freshReader();
      if (!open) dropReader();
      renderMini();
      pump({ minimized: !open });
      return;
    }
    const open = reader?.mode === "open";
    if (overlayOpen("tray")) closeOverlay({ keepHistory: true });
    reader?.destroy(); reader = null; events.length = 0; error = null; renderBar();
    resumePending({ minimized: !open });
  }
  // Close: the import forgotten; a queue's song is passed by and the next one goes.
  async function dismiss() {
    const id = jobId;
    if (busyErr) { await cancelQueue(); return; } // (the engine is another tab's: the rest would wait the same)
    if (resumable && id) { try { await imp.discard(id); } catch {} }
    const s = cur;
    clear();
    if (s) songEnded(false);
    renderMini();
    onChange();
    pump();
  }
  // The Reader's ✕ (two taps): stop and forget it — and the rest of the queue.
  async function stopImport() {
    const id = imp.current?.id || jobId;
    if (!spaceChanged()) clearQueue(); // (first: the run's end would start the next one)
    forced.clear(); batchOk = 0; cur = null;
    imp.holdWake?.(false);
    try { if (id) await imp.discard(id); } catch (err) { console.warn("discard", err); }
    clear();
    onChange();
  }
  function done(res) {
    unsaved = !!res.unsaved;
    title = res.title || title;
    const s = cur;
    if (res.replaced && res.songId && !forgetting.has(res.songId)) { try { onReplaced(res.songId); } catch (err) { console.warn("replaced", err); } }
    if (s) songEnded(!forgetting.has(s.id), res); // (no done row between two songs of a queue, nor for one being deleted)
    else result = res;
    renderBar();
    renderMini();
  }
  // A queue's song is over (converted or not): counted, and the queue goes on — or, the last one,
  // the done row: the song ("✓ Title · ready"), or the batch ("✓ 3 converted").
  function songEnded(ok, res = null) {
    const s = cur;
    cur = null;
    if (ok) { batchOk++; lastOk = { songId: res?.songId || s?.id, title: res?.title || s?.title }; }
    let q = readQueue();
    const total = q.total;
    if (!spaceChanged()) q = writeQueue({ ...q, done: q.done + 1 });
    if (q.ids.length) return "more";
    imp.holdWake?.(false);
    const n = batchOk;
    batchOk = 0;
    forced.clear();
    if (!n) { result = null; return "end"; }
    result = total > 1 ? { batch: n, songId: lastOk?.songId, title: "" } : { ...(res || {}), songId: res?.songId || lastOk?.songId, first: !!s?.wasPdf };
    return "end";
  }
  function fail(err) {
    console.warn(err);
    const kind = err?.kind || null;
    if (cur && SAME_AGAIN.includes(kind)) {
      // (the same PDF would fail the same way: marked — Convert all passes it by — and the queue goes on)
      const s = cur;
      markConvFailed(s.id, { kind, message: err?.message || String(err) }).catch((e) => console.warn("mark", e));
      flash(`“${s.title || "Song"}” couldn't be read`);
      dropReader();
      error = null; stuck = null; resumable = false;
      songEnded(false);
      renderBar();
      renderMini();
      return;
    }
    if (cur && kind === "busy" && !spaceChanged()) {
      // (another tab holds the engine: this song waits first in the queue)
      const q = readQueue();
      writeQueue({ ...q, ids: [cur.id, ...q.ids.filter((x) => x !== cur.id)] });
      busyErr = true;
      cur = null;
    }
    if (events.at(-1)?.t !== "error") push({ t: "error", message: err?.message || String(err) });
    error = err?.message || String(err);
    imp.holdWake?.(false); // (paused for a tap: Try again asks again)
    renderBar();
    renderMini();
  }
  function flash(text) {
    const t = $("toast");
    t.textContent = text; t.hidden = false;
    clearTimeout(flash.timer);
    flash.timer = setTimeout(() => { t.hidden = true; }, 2400);
  }

  // --- the queue ------------------------------------------------------------------------------
  // Songs to convert, in this order, after any already waiting (a tap: the screen is kept awake
  // from here — Safari wants the gesture). force: converted even when this engine read it already.
  function convert(ids, { force = false } = {}) {
    const list = [...new Set((ids || []).filter((id) => typeof id === "string" && id && id !== cur?.id))];
    if (!list.length || spaceChanged()) return false;
    imp.holdWake?.(true);
    if (!cur && !running && !readQueue().ids.length) batchOk = 0; // (a new batch)
    if (force) for (const id of list) forced.add(id);
    enqueue(list);
    onChange();
    pump();
    return true;
  }
  // A song's PDF read (again) — the Score's 📄 Convert / ⟳: queued, one at a time.
  function reprocess(id) {
    if (id && (cur?.id === id || readQueue().ids.includes(id))) { flash(cur?.id === id ? "Already converting" : "Already queued"); return false; }
    const later = running || !!cur || readQueue().ids.length > 0;
    const ok = convert([id], { force: true });
    if (ok && later) flash("Queued");
    return ok;
  }
  // Stop: nothing more to convert, and the song being converted stops too (stays as it was).
  async function cancelQueue() {
    if (!spaceChanged()) clearQueue();
    forced.clear(); batchOk = 0;
    imp.holdWake?.(false);
    if (cur || busyErr) {
      const id = imp.current?.id || jobId;
      cur = null;
      try { if (id && (running || resumable || stuck)) await imp.discard(id); } catch (err) { console.warn("discard", err); }
      clear();
    }
    onChange();
  }
  // A song deleted (songlist.js, before forget.js forgetSong): out of the queue, and its conversion
  // stopped and forgotten — waited for, so a save under way lands before the song goes.
  async function forget(id) {
    forced.delete(id);
    if (!spaceChanged()) dropFromQueue(id);
    if (cur?.id !== id) return;
    forgetting.add(id);
    try {
      if (running) {
        for (let i = 0; i < 40 && running && !imp.current; i++) await sleep(50); // (the job a moment from starting)
        const end = runP;
        const jid = imp.current?.id || jobId;
        try { if (jid) await imp.discard(jid); } catch (err) { console.warn("discard", err); }
        await end?.catch(() => {});
      } else if (jobId) { try { await imp.discard(jobId); } catch {} } // (paused on the bar)
      if (cur?.id === id) { // (stopped: not counted — it leaves the batch)
        cur = null;
        if (!spaceChanged()) { const q = readQueue(); writeQueue({ ...q, total: Math.max(q.done, q.total - 1) }); }
      }
      if (!running) { // (its Reader goes; a batch's done row stays)
        const keep = result?.batch ? result : null;
        clear();
        result = keep;
        renderMini();
      }
    } finally { forgetting.delete(id); }
    onChange();
    setTimeout(pump, 0);
  }
  // The next song, when nothing runs, nothing waits on the bar and no import of this space is kept:
  // the queue's first — passed by when it's gone, has no PDF here, or (Reconvert all) this engine
  // read it already. Folded, unless the Reader is open.
  let pumping = false;
  async function pump({ minimized = true } = {}) {
    if (pumping) return;
    pumping = true;
    try {
      for (let n = 0; n < 1000; n++) {
        const paused = () => running || imp.busy() || !!cur || !bar.hidden || !!error || !!stuck;
        if (paused() || spaceChanged()) return;
        if (await imp.pending().catch(() => null)) return; // (a kept import: its bar or the tile says so)
        const q = readQueue();
        const id = q.ids[0];
        if (!id) {
          if (q.total) clearQueue(); // (counters left over: nothing waits)
          imp.holdWake?.(false);
          return;
        }
        const [info, pdfs] = await Promise.all([songInfo(id).catch(() => null), listPdfIds().catch(() => [])]);
        if (paused() || spaceChanged() || readQueue().ids[0] !== id) continue; // (something changed meanwhile)
        const skip = !info || info.k === "sample" || !pdfs.includes(id) || (info.k === "conv" && (info.eng || 0) >= ENGINE_N && !forced.has(id));
        if (skip) { dropFromQueue(id); forced.delete(id); onChange(); continue; }
        const q2 = readQueue();
        writeQueue({ ...q2, ids: q2.ids.filter((x) => x !== id) }); // (running: the importer's job now, not the queue's)
        forced.delete(id);
        const open = freshReader();
        log.length = 0;
        log.push(`Resonate ${version} · ${new Date().toISOString()}`, navigator.userAgent, `[convert] song ${id} · engine ${ENGINE_N}`);
        drive({ name: "" }, () => imp.reprocess(id), { minimized: minimized && !open, song: { id, title: info.title || "", wasPdf: info.k === "pdf" } });
        return;
      }
    } finally { pumping = false; }
  }
  // What the song list shows: the queue, the song being converted (running even while paused on
  // the bar: paused), and where its PDF is.
  function queueInfo() {
    const q = readQueue();
    const st = cur ? reader?.status?.() || null : null;
    return {
      ids: q.ids, running: cur?.id || null, total: q.total, done: q.done, paused: !!cur && !running,
      page: st?.page || null, of: st?.of || null, label: st?.label || "", fraction: st?.fraction ?? 0,
    };
  }

  // --- folded: the tile / pill beside Songs, the done row ----------------------------------------
  function renderMini() {
    const folded = !!reader && reader.mode === "min";
    const st = reader?.status?.() || null;
    const phase = result ? "done" : error ? "error" : stuck ? "stuck" : st?.phase || "pages";
    mini.hidden = !folded || !!result;
    doneRow.hidden = !result || (reader && reader.mode === "open");
    document.body.toggleAttribute("data-done", !!result); // (a green ring on Songs)
    if (result) {
      const s = doneRow.querySelector(".s");
      if (result.batch) {
        doneRow.querySelector(".t").textContent = `${result.batch} converted`;
        s.textContent = "";
      } else {
        const pages = result.pages?.length || 0;
        doneRow.querySelector(".t").textContent = result.title || title || "Song";
        s.innerHTML = result.songId ? `<b>${result.replaced && !result.first ? "updated" : "ready"}</b>${pages ? ` · ${pages} page${pages === 1 ? "" : "s"}` : ""}` : "not saved — signed in or out elsewhere";
      }
      s.hidden = !s.textContent;
      doneRow.querySelector(".openbtn").hidden = !result.songId || !!result.batch;
    }
    if (!folded || result) return;
    const f = phase === "done" ? 1 : st?.fraction ?? 0;
    const name = (cur?.title || title || jobName || "PDF").replace(/\.pdf$/i, "");
    const count = st?.page && st?.of ? `${st.page}/${st.of}` : "";
    const q = cur ? readQueue() : null;
    const song = q && q.total > 1 ? `song ${Math.min(q.done + 1, q.total)}/${q.total}` : "";
    const held = state === "waiting" || state === "stuck" || reader?.held;
    mini.dataset.phase = phase;
    mini.querySelector(".arc").setAttribute("stroke-dasharray", `${(RING * Math.max(0.02, f)).toFixed(1)} ${RING.toFixed(1)}`);
    mini.querySelector(".arc").classList.toggle("spin", !held && (phase === "engine" || (phase === "pages" && !st?.of)));
    mini.querySelector(".g").textContent = phase === "error" || phase === "stuck" ? "!" : held ? "⏸" : st?.glyph || "·";
    mini.querySelector(".n").textContent = count;
    mini.querySelector(".n").hidden = !count;
    mini.querySelector(".pt").textContent = name;
    mini.querySelector(".ps").textContent = phase === "error" ? "stopped" : stuck ? "stopped twice" : [song, count, st?.label, song ? "" : etaText(st?.eta)].filter(Boolean).join(" · ");
    mini.setAttribute("aria-label", `Reading ${name}${count ? `, page ${st.page} of ${st.of}` : ""} — show`);
  }
  setInterval(() => { if (reader && reader.mode === "min" && !result) renderMini(); }, 1000);
  mini.addEventListener("click", expand);
  doneRow.querySelector(".openbtn").addEventListener("click", () => { const id = result?.songId; if (id) { clear(); openSong(id); } });
  doneRow.querySelector(".x").addEventListener("click", () => { clear(); onChange(); });

  // The song list's first row while a PDF that isn't a song yet is read (a tap opens the Reader);
  // a song's own conversion shows on its row (songlist.js, queueInfo).
  function readingRow() {
    if (!reader || result || cur) return "";
    const st = reader.status();
    const name = esc((title || jobName || "PDF").replace(/\.pdf$/i, ""));
    const f = st?.fraction ?? 0;
    const C = 2 * Math.PI * 18;
    return `<button class="song reading" type="button"><span class="tile" data-src="reading"><svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="2.5"/><circle cx="20" cy="20" r="18" fill="none" stroke="#ffe6a0" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${(C * Math.max(0.02, f)).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 20 20)"/></svg>${ic("doc")}</span>
      <span class="mid"><span class="t">${name}</span><span class="s mono"><b>${error ? "stopped" : `reading${st?.page && st?.of ? ` ${st.page}/${st.of}` : ""}`}</b>${st?.label ? ` · ${esc(st.label)}` : ""}</span></span>${ic("expand", "chev")}</button>`;
  }

  // (Back from the back/forward cache — the engine stopped on pagehide: boot.js reloads the page.)

  return {
    start, reprocess, convert, cancelQueue, queueInfo, forget, resumePending, expand, readingRow,
    busy: () => running || unsaved,
    debug: () => ({
      state, running, mode: reader?.mode || null, events: events.length, result: result && { songId: result.songId, title: result.title, batch: result.batch || 0 },
      error, stuck, reader: reader?.status() || null, mini: !mini.hidden, done: !doneRow.hidden, jobId, replaced: !!result?.replaced,
      song: cur && { ...cur }, queue: queueInfo(), batchOk, busyErr,
    }),
    eventList: events,
  };
}
