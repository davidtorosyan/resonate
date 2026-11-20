// The Reader tray: PDF → Song in the background, never leaving the page. The importer
// (omr/importer.js, its jobs in omr/jobs.js) runs the conversion in its worker; the Reader
// (omr/reader.js) draws it — as a sheet on a phone, a panel above the dock on a tablet — and ⌄
// folds it into a tile (a pill on a wide screen) beside Songs. Done: "✓ Title · ready  Open ✕", and
// the Reader's own Sing it / Play it open the song in place with Sing / the Score shown.
// As pdf-import.js: a reload continues an unfinished import of this space, the Reader's ✕ (two
// taps) stops and forgets it, a stage that stopped twice offers Skip / Retry, the importer holds the
// engine's Web Lock and the screen wake lock, and pagehide stops the engine.
// A song's stored PDF read again (the Score's 📄 → resonatePlay.reprocess): the same run in the tray;
// its result replaces the song's MusicXML under its id, and an open song loads it again (onReplaced).
import { createImporter } from "../omr/importer.js?v=89";
import { mount as mountReader } from "../omr/reader.js?v=89";
import { readFlag } from "../omr/jobs.js?v=89";
import { activeSpace, activeDb } from "../space.js?v=89";
import { etaText } from "../omr/readerstate.js?v=89";
import { ic, esc, openOverlay, closeOverlay, overlayOpen, pageOpen } from "./chrome.js?v=89";

const $ = (id) => document.getElementById(id);
const STAGE = { prep: "pages", boot: "engine", export: "MusicXML", save: "saving" };
const RING = 2 * Math.PI * 17;

export function mountTray({ version, spaceChanged, openSong, onChange = () => {}, onReplaced = () => {} }) {
  const sheet = $("tray"), host = $("reader-host"), bar = $("tray-bar"), barMsg = $("tray-msg");
  const mini = $("imp-mini"), doneRow = $("imp-done");
  let reader = null, running = false, unsaved = false, state = "idle", jobId = null, jobName = "";
  let title = "", result = null, error = null, resumable = false, stuck = null;
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
  function ensureReader({ minimized = false } = {}) {
    if (reader) return reader;
    reader = mountReader(host, {
      minimized, onStop: stopImport,
      links: { sing: "sing.html", play: "play.html" },
      onMinimize: () => { if (overlayOpen("tray")) closeOverlay(); sheet.hidden = true; renderMini(); },
      onExpand: () => {
        sheet.hidden = false;
        openOverlay("tray", () => { sheet.hidden = true; if (reader?.mode === "open") reader.minimize(); renderMini(); });
        renderMini();
      },
    });
    if (!minimized) { sheet.hidden = false; openOverlay("tray", () => { sheet.hidden = true; if (reader?.mode === "open") reader.minimize(); renderMini(); }); }
    return reader;
  }
  function expand() {
    if (!reader) return;
    if (reader.mode === "open") { sheet.hidden = false; return; }
    reader.expand();
  }
  function clear() {
    if (overlayOpen("tray")) closeOverlay();
    reader?.destroy();
    reader = null;
    sheet.hidden = true;
    events.length = 0;
    result = null; error = null; stuck = null; resumable = false; title = ""; jobName = ""; jobId = null;
    renderMini();
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
    renderBar();
    renderMini();
  }
  function renderBar() {
    const btns = [];
    let text = "";
    if (state === "waiting") text = "Running in another tab";
    else if (stuck) {
      text = stuck.page ? `Page ${stuck.page} stopped twice` : `Stopped twice: ${STAGE[stuck.stage] || stuck.stage}`;
      if (stuck.page) btns.push(`<button type="button" class="chip" data-act="skip">Skip page ${stuck.page}</button>`);
      btns.push(`<button type="button" class="chip" data-act="retry">Retry</button>`);
    } else if (error) {
      text = error;
      if (resumable) btns.push(`<button type="button" class="chip" data-act="again">Try again</button>`);
      btns.push(`<button type="button" class="chip" data-act="dismiss">Close</button>`);
    }
    bar.hidden = !text;
    barMsg.textContent = text;
    bar.querySelector(".btns").innerHTML = btns.join("");
  }
  // The Reader's Sing it / Play it: the new song in place, with Sing or the Score shown.
  host.addEventListener("click", (e) => {
    const a = e.target.closest?.(".rd-sing, .rd-play");
    const id = result?.songId;
    if (!a || !id || e.button || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    if (overlayOpen("tray")) closeOverlay({ keepHistory: !pageOpen() }); // (its history entry becomes the song's — openPage — unless a song has its own)
    clear();
    openSong(id, a.classList.contains("rd-play") ? { score: true } : { sing: true });
  });
  bar.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "skip" || act === "retry") { running = false; continueJob({ id: jobId, name: jobName, size: 0 }, { [act]: true }); }
    else if (act === "again") again();
    else if (act === "dismiss") dismiss();
  });

  // --- runs (pdf-import.js drive / continueJob) -----------------------------------------------
  async function drive(job, go, { minimized = false } = {}) {
    if (running) return;
    running = true;
    error = null; result = null;
    if (job.id) jobId = job.id;
    if (job.name) jobName = job.name;
    ensureReader({ minimized });
    renderBar();
    try {
      const res = await go();
      if (res) done(res);
      else if (state === "idle") clear(); // (finished or forgotten in another tab)
    } catch (err) {
      if (err?.name !== "AbortError") fail(err);
    } finally {
      running = false;
      renderMini();
      onChange();
    }
  }
  function start(file) {
    if (running || imp.busy()) { flash("One PDF at a time"); return; }
    clear();
    log.length = 0;
    log.push(`Resonate ${version} · ${new Date().toISOString()}`, navigator.userAgent, `PDF ${((file.size || 0) / 1e6).toFixed(1)} MB · ${file.name}`);
    return drive({ name: file.name }, () => imp.start(file));
  }
  // A song's PDF read again — one PDF at a time: while another is read, it says so and starts nothing.
  async function reprocess(id) {
    if (running || imp.busy()) { flash("Another PDF is being read — try again once it's done"); return false; }
    // (an import waiting on Skip / Retry isn't running, but it's this space's job: finish or ✕ it first)
    if (await imp.pending().catch(() => null)) { flash("Another PDF is waiting — finish or ✕ it first"); return false; }
    if (running || imp.busy()) return false;
    clear();
    log.length = 0;
    log.push(`Resonate ${version} · ${new Date().toISOString()}`, navigator.userAgent, `[reprocess] song ${id}`);
    drive({ name: "" }, () => imp.reprocess(id));
    return true;
  }
  function continueJob(job, opts = {}, { minimized = false } = {}) {
    return drive(job, async () => {
      if (!events.length || events.every((e) => e.t === "job")) {
        const stored = await imp.storedEvents(job.id);
        events.length = 0;
        events.push(...stored);
        reader.load(stored);
        renderMini();
      }
      return imp.resume(job.id, opts);
    }, { minimized });
  }
  // An unfinished import of this space: the tile at once (the flag names the job), its stored events
  // as soon as the database answers, then it goes on — minimized: home stays the tuner.
  async function resumePending({ minimized = true } = {}) {
    const flag = readFlag();
    if (flag?.id && (flag.db ? flag.db === activeDb() : flag.space === activeSpace())) {
      ensureReader({ minimized });
      push({ t: "job", id: flag.id, name: flag.name || "", resumed: true });
    }
    try {
      const job = await imp.pending();
      if (job) await continueJob(job, {}, { minimized });
      else if (!running) clear();
    } catch (err) {
      console.warn("import jobs", err);
      if (!running) clear();
    }
  }
  function again() {
    const open = reader?.mode === "open";
    if (overlayOpen("tray")) closeOverlay({ keepHistory: true });
    reader?.destroy(); reader = null; events.length = 0; error = null; renderBar();
    resumePending({ minimized: !open });
  }
  async function dismiss() {
    const id = jobId;
    if (resumable && id) { try { await imp.discard(id); } catch {} }
    clear();
    onChange();
  }
  // The Reader's ✕ (two taps): stop and forget it.
  async function stopImport() {
    const id = imp.current?.id || jobId;
    try { if (id) await imp.discard(id); } catch (err) { console.warn("discard", err); }
    clear();
    onChange();
  }
  function done(res) {
    result = res;
    unsaved = !!res.unsaved;
    title = res.title || title;
    renderBar();
    renderMini();
    if (res.replaced && res.songId) { try { onReplaced(res.songId); } catch (err) { console.warn("replaced", err); } }
  }
  function fail(err) {
    console.warn(err);
    if (events.at(-1)?.t !== "error") push({ t: "error", message: err?.message || String(err) });
    error = err?.message || String(err);
    renderBar();
    renderMini();
  }
  function flash(text) {
    const t = $("toast");
    t.textContent = text; t.hidden = false;
    clearTimeout(flash.timer);
    flash.timer = setTimeout(() => { t.hidden = true; }, 2400);
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
      doneRow.querySelector(".t").textContent = result.title || title || "Song";
      doneRow.querySelector(".s").innerHTML = result.songId ? `<b>${result.replaced ? "updated" : "ready"}</b> · ${result.pages.length} page${result.pages.length === 1 ? "" : "s"}` : "not saved — signed in or out elsewhere";
      doneRow.querySelector(".openbtn").hidden = !result.songId;
    }
    if (!folded || result) return;
    const f = phase === "done" ? 1 : st?.fraction ?? 0;
    const name = (title || jobName || "PDF").replace(/\.pdf$/i, "");
    const count = st?.page && st?.of ? `${st.page}/${st.of}` : "";
    const held = state === "waiting" || state === "stuck" || reader?.held;
    mini.dataset.phase = phase;
    mini.querySelector(".arc").setAttribute("stroke-dasharray", `${(RING * Math.max(0.02, f)).toFixed(1)} ${RING.toFixed(1)}`);
    mini.querySelector(".arc").classList.toggle("spin", !held && (phase === "engine" || (phase === "pages" && !st?.of)));
    mini.querySelector(".g").textContent = phase === "error" || phase === "stuck" ? "!" : held ? "⏸" : st?.glyph || "·";
    mini.querySelector(".n").textContent = count;
    mini.querySelector(".n").hidden = !count;
    mini.querySelector(".pt").textContent = name;
    mini.querySelector(".ps").textContent = phase === "error" ? "stopped" : stuck ? "stopped twice" : [count, st?.label, etaText(st?.eta)].filter(Boolean).join(" · ");
    mini.setAttribute("aria-label", `Reading ${name}${count ? `, page ${st.page} of ${st.of}` : ""} — show`);
  }
  setInterval(() => { if (reader && reader.mode === "min" && !result) renderMini(); }, 1000);
  mini.addEventListener("click", expand);
  doneRow.querySelector(".openbtn").addEventListener("click", () => { const id = result?.songId; if (id) { clear(); openSong(id); } });
  doneRow.querySelector(".x").addEventListener("click", () => { clear(); onChange(); });

  // The song list's first row while a PDF is read (a tap opens the Reader).
  function readingRow() {
    if (!reader || result) return "";
    const st = reader.status();
    const name = esc((title || jobName || "PDF").replace(/\.pdf$/i, ""));
    const f = st?.fraction ?? 0;
    const C = 2 * Math.PI * 18;
    return `<button class="song reading" type="button"><span class="tile" data-src="reading"><svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="2.5"/><circle cx="20" cy="20" r="18" fill="none" stroke="#ffe6a0" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${(C * Math.max(0.02, f)).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 20 20)"/></svg>${ic("doc")}</span>
      <span class="mid"><span class="t">${name}</span><span class="s mono"><b>${error ? "stopped" : `reading${st?.page && st?.of ? ` ${st.page}/${st.of}` : ""}`}</b>${st?.label ? ` · ${esc(st.label)}` : ""}</span></span>${ic("expand", "chev")}</button>`;
  }

  // (Back from the back/forward cache — the engine stopped on pagehide: boot.js reloads the page.)

  return {
    start, reprocess, resumePending, expand, readingRow,
    busy: () => running || unsaved,
    debug: () => ({
      state, running, mode: reader?.mode || null, events: events.length, result: result && { songId: result.songId, title: result.title },
      error, stuck, reader: reader?.status() || null, mini: !mini.hidden, done: !doneRow.hidden, jobId, replaced: !!result?.replaced,
    }),
    eventList: events,
  };
}
