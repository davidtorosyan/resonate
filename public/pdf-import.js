// PDF → Song: run Audiveris in the browser (omr/omr.js) on a PDF and save the
// resulting MusicXML to My songs. No settings: pages without staves are skipped
// automatically, English OCR for lyrics, the title is taken from the score.
// The import is a job (omr/importer.js) kept on this device as it goes: a reload, a crash or
// leaving the page and coming back continues it where it was (at most the page under way is read
// again); the Reader (omr/reader.js) draws it.

import { spaceChanged } from "./nav.js?v=85";
import { activeSpace, activeDb } from "./space.js?v=85";
import { mount as mountReader } from "./omr/reader.js?v=85";
import { createImporter } from "./omr/importer.js?v=85";
import { readFlag } from "./omr/jobs.js?v=85";

const $ = (id) => document.getElementById(id);
const chooseBtn = $("choose");
const fileInput = $("file");

let running = false;
let unsaved = false; // a finished conversion not saved (another tab signed in or out meanwhile)
window.resonateBusy = () => running || unsaved; // (nav.js: a reload for another tab's sign-in/out waits for it)
let finalXml = null;
let baseName = "song";
let reader = null;
let importState = "idle";
let jobId = null;
const events = []; // every event of this run, as the Reader got them (what a resume would replay)

// The first lines (browser/device) are kept when the log is trimmed: they're what
// makes a pasted failure report diagnosable.
let logHead = "";
function appendLog(line) {
  const log = $("log");
  log.textContent += line + "\n";
  if (log.textContent.length > 400000) log.textContent = logHead + "…\n" + log.textContent.slice(-300000);
  if ($("log-wrap").open) log.scrollTop = log.scrollHeight;
}

// --- The Reader: the run as events (omr/readerstate.js has the contract) ---------------------
function push(ev) {
  const e = Number.isFinite(ev.at) ? ev : { ...ev, at: Date.now() };
  events.push(e);
  reader?.push(e);
}

const imp = createImporter({
  app: $("version").textContent, spaceChanged, onEvent: push, onLog: appendLog, onState: showState,
});

// The import's state → the Reader and the job bar under it. The Reader's ✕ (two taps) stops and
// forgets the import — also after an error that kept it (Try again continues it) — except while
// another tab runs it. The job bar says what isn't on the Reader: another tab is reading it, or a stage
// stopped twice (a crash loop — iOS ends a tab that uses too much memory): Retry, and Skip for a page.
const STAGE = { prep: "pages", boot: "engine", export: "MusicXML", save: "saving" };
function showState({ state, job }) {
  importState = state;
  // Not reading here (stuck on a page, another tab reading, stopped): the Reader's clocks stop and
  // nothing breathes until the next event.
  if (state === "stuck" || state === "waiting" || state === "idle") reader?.hold(true);
  reader?.canStop(state !== "waiting");
  if (job?.id) jobId = job.id;
  const stuck = state === "stuck" && job?.stuck;
  $("job-bar").hidden = !(state === "waiting" || stuck);
  $("job-msg").textContent = !stuck ? (state === "waiting" ? "Running in another tab" : "")
    : stuck.page ? `Page ${stuck.page} stopped twice` : `Stopped twice: ${STAGE[stuck.stage] || stuck.stage}`;
  $("job-retry").hidden = !stuck;
  $("job-skip").hidden = !stuck?.page;
  if (stuck?.page) $("job-skip").textContent = `Skip page ${stuck.page}`;
}

// Minimized or not is a device pref (resonate.import.min) for a reload: the page comes back the way
// the singer left it. Arriving here (the pill on another page, a link) or picking a file opens it —
// minimized, this page would be empty but for the corner pill. Only the singer's own taps change the
// pref (the page's expand at the end doesn't).
const MIN_PREF = "resonate.import.min";
const NAV = performance.getEntriesByType?.("navigation")?.[0]?.type || "navigate";
let autoExpand = false;
function showReader({ fresh = false } = {}) {
  $("pick").hidden = true;
  $("warning").hidden = true;
  $("log-wrap").hidden = false;
  document.documentElement.removeAttribute("data-resume");
  document.querySelector("main").classList.add("reading");
  const host = $("reader-host");
  host.hidden = false;
  if (reader) return;
  let min = false;
  try { min = !fresh && (NAV === "reload" || NAV === "back_forward") && localStorage.getItem(MIN_PREF) === "1"; } catch {}
  const remember = (v) => { if (autoExpand) return; try { v ? localStorage.setItem(MIN_PREF, "1") : localStorage.removeItem(MIN_PREF); } catch {} };
  reader = mountReader(host, {
    minimized: min, onStop: stopImport,
    onMinimize: () => { remember(true); document.querySelector("main").classList.add("min"); },
    onExpand: () => { remember(false); document.querySelector("main").classList.remove("min"); },
  });
  document.querySelector("main").classList.toggle("min", min);
}
// ✕ on the Reader: stop and forget this import, back to the picker.
let leaving = false;
async function stopImport() {
  leaving = true; // (no "leave the page?" prompt for an import being thrown away)
  const id = imp.current?.id || jobId;
  try { if (id) await imp.discard(id); } catch (err) { console.warn("discard", err); }
  location.replace(location.pathname);
}
// The picker again (a job the flag named was gone: finished or forgotten in another tab).
function showPicker() {
  reader?.destroy();
  reader = null;
  events.length = 0;
  document.documentElement.removeAttribute("data-resume");
  document.querySelector("main").classList.remove("reading");
  $("reader-host").hidden = true;
  $("log-wrap").hidden = true;
  $("pick").hidden = false;
  $("warning").hidden = false;
}

function writeLogHead(name, size) {
  const mem = navigator.deviceMemory ? `${navigator.deviceMemory} GB RAM` : "RAM unknown";
  logHead = `Resonate ${$("version").textContent} · ${new Date().toISOString()}\n` +
    `${navigator.userAgent}\n${navigator.hardwareConcurrency || "?"} CPU threads · ${mem} · ` +
    `PDF ${((size || 0) / 1e6).toFixed(1)} MB${name ? ` · ${name}` : ""}\n`;
  appendLog(logHead.trimEnd());
}

function fail(err) {
  console.error(err);
  if (events.at(-1)?.t !== "error") push({ t: "error", message: err?.message || String(err) }); // (the importer's own, usually)
  $("error").hidden = false;
  $("error-msg").textContent = err?.message || String(err);
  $("log-wrap").hidden = false;
}

// One path for a new import and a stored one: the Reader shows (a stored one first draws what it
// showed so far, at once — reader.load), the importer runs, the result shows.
async function drive(job, go, fresh = false) {
  if (running) return;
  running = true;
  baseName = (job.name || "").replace(/\.pdf$/i, "") || "song";
  if (job.id) jobId = job.id;
  showReader({ fresh });
  try {
    const res = await go();
    if (res) showResult(res);
    else if (importState === "idle") location.reload(); // finished (or forgotten) in another tab
  } catch (err) {
    if (err?.name !== "AbortError") fail(err);
  } finally {
    running = false;
  }
}

function run(file) {
  return drive({ name: file.name }, () => {
    writeLogHead(file.name, file.size);
    return imp.start(file);
  }, true);
}

// An import left unfinished on this device: shown at once as far as it got, then continued.
function continueJob(job, opts = {}) {
  return drive(job, async () => {
    if (!events.length || events.every((e) => e.t === "job")) {
      const stored = await imp.storedEvents(job.id);
      events.length = 0;
      events.push(...stored);
      reader.load(stored);
      writeLogHead(job.name, job.size);
      appendLog(`[resume] ${job.name}: ${job.done} of ${job.of || "?"} pages read before`);
    }
    return imp.resume(job.id, opts);
  });
}

function showResult(res) {
  finalXml = res.xml;
  unsaved = res.unsaved;
  $("job-bar").hidden = true;
  autoExpand = true; // (the end shows itself; the singer's minimized pref stays)
  reader?.expand();
  autoExpand = false;
  const score = res.score;
  const lyrics = score.notes.filter((n) => Object.keys(n.verses).length).length;
  $("result").hidden = false;
  const read = res.pages.filter((p) => !res.failed.some((f) => f.page === p));
  $("result-detail").textContent =
    `${score.notes.length} notes · ${lyrics} with lyrics${score.verses.length > 1 ? ` · ${score.verses.length} verses` : ""} · ` +
    `page${read.length === 1 ? "" : "s"} ${read.join(", ")} · ${unsaved ? "not saved (signed in or out in another tab) — download it" : "saved to My songs"}`;
  // Pages the engine gave up on; bars of read pages the export couldn't write (their notes are missing).
  const missing = [];
  if (res.failed.length) {
    const pages = res.failed.map((f) => f.page);
    const firstFailed = res.failed.some((f) => f.sheet === 1);
    missing.push(`Page${pages.length === 1 ? "" : "s"} ${pages.join(", ")} couldn't be read, left out` +
      (firstFailed ? "; title, tempo and time signature may be off" : ""));
  }
  const lostBars = new Map();
  for (const l of res.lost || []) {
    if (!lostBars.has(l.page)) lostBars.set(l.page, new Set());
    lostBars.get(l.page).add(l.measure);
  }
  for (const [page, bars] of lostBars) missing.push(`Page ${page}: ${bars.size} bar${bars.size === 1 ? "" : "s"} left out`);
  if (missing.length) {
    $("result-missing").hidden = false;
    $("result-missing").textContent = `${missing.join(". ")}. Why: Details → Copy log.`;
  }
}

chooseBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const f = fileInput.files[0];
  fileInput.value = "";
  if (f) run(f);
});
$("download").addEventListener("click", () => {
  if (!finalXml) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([finalXml], { type: "application/vnd.recordare.musicxml+xml" }));
  a.download = `${baseName}.musicxml`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
});
$("copy-log").addEventListener("click", async () => {
  const btn = $("copy-log");
  try {
    await navigator.clipboard.writeText($("log").textContent);
    btn.textContent = "Copied";
  } catch {
    // No clipboard permission: select the text so a long-press / Ctrl+C copies it.
    getSelection().selectAllChildren($("log"));
    btn.textContent = "Selected — copy it";
  }
  setTimeout(() => { btn.textContent = "Copy log"; }, 2500);
});
for (const b of document.querySelectorAll(".again")) b.addEventListener("click", () => location.reload());
// A reload continues a kept import; only one that couldn't be kept (storage full) asks first.
window.addEventListener("beforeunload", (e) => {
  if (running && !leaving && imp.busy() && !imp.resumable()) { e.preventDefault(); e.returnValue = ""; }
});
// Another page of the site, from this page's header, while it reads: the engine stops with this page
// (a page of its own), so ask once — the import goes on where it was when the singer comes back (the
// pill on the other pages says it's paused).
document.querySelector("header")?.addEventListener("click", (e) => {
  const a = e.target.closest?.("a[href]");
  if (!a || !running || leaving || !imp.busy() || !imp.resumable() || a.target === "_blank") return;
  if (new URL(a.href, location.href).origin !== location.origin) return;
  if (!confirm("Pause the import? It picks up where it was when you come back.")) e.preventDefault();
});
// Back from the back/forward cache: the engine was stopped on pagehide — start the page afresh.
window.addEventListener("pageshow", (e) => { if (e.persisted && jobId) location.reload(); });
$("job-skip")?.addEventListener("click", () => { running = false; continueJob({ id: jobId, name: baseName, size: 0 }, { skip: true }); });
$("job-retry")?.addEventListener("click", () => { running = false; continueJob({ id: jobId, name: baseName, size: 0 }, { retry: true }); });

// Test hook: start a conversion from a URL (?pdf=...) without the file picker.
const testPdf = new URLSearchParams(location.search).get("pdf");
if (testPdf) {
  fetch(testPdf).then((r) => r.blob()).then((b) => run(new File([b], testPdf.split("/").pop(), { type: "application/pdf" })));
} else {
  // An unfinished import of this space: the Reader at once (the flag names the job — no picker in
  // between; the head's script hid it already), its stored events as soon as the database answers.
  const flag = readFlag();
  if (flag?.id && (flag.db ? flag.db === activeDb() : flag.space === activeSpace())) {
    showReader();
    reader.push({ t: "job", id: flag.id, name: flag.name || "", resumed: true });
  }
  // No job after all (gone, or the flag the head's script saw was another space's — nav.js put the
  // account away before this ran): the picker, whether the Reader showed or not.
  imp.pending().then((job) => {
    if (job) continueJob(job);
    else if (!running) showPicker();
  }).catch((err) => { console.warn("import jobs", err); if (!running) showPicker(); });
}
window.resonateDebug = () => {
  const st = reader?.status();
  return {
    running, hasResult: !!finalXml, events: events.length, reader: st || null, readerDebug: reader?.debug() || null,
    import: { state: importState, job: imp.current, jobId, resumable: imp.resumable() },
    eventList: events, // (tests: the events as the Reader got them)
    // One line for test logs: "phase page/of label · eta".
    stage: st ? `${st.phase} ${st.page ?? ""}/${st.of} ${st.label}${st.eta != null ? ` · ${Math.round(st.eta)} s left` : ""}` : "",
    fraction: st?.fraction ?? 0,
  };
};
