// PDF → Song: run Audiveris in the browser (omr/omr.js) on a PDF and save the
// resulting MusicXML to My songs. No settings: pages without staves are skipped
// automatically, English OCR for lyrics, the title is taken from the score.

import { readScoreFile, parseMusicXml } from "./musicxml.js?v=56";
import { addSong } from "./library.js?v=56";
import { fixOmrScore, joinMovements } from "./omr/fixscore.js?v=56";

const $ = (id) => document.getElementById(id);
const chooseBtn = $("choose");
const fileInput = $("file");

let wakeLock = null;
let running = false;
let t0 = 0;
let timer = null;
let lastFraction = 0;
let sheetStart = { sheet: 0, at: 0 };
let sheetTimes = [];
let finalXml = null;
let baseName = "song";

const STEP_LABELS = {
  LOAD: "loading the page", BINARY: "black & white", SCALE: "measuring staff size", GRID: "finding staves & systems",
  HEADERS: "clefs, keys, time signatures", STEM_SEEDS: "stems", BEAMS: "beams", LEDGERS: "ledger lines",
  HEADS: "note heads", STEMS: "stems", REDUCTION: "resolving conflicts", CUE_BEAMS: "cue notes", TEXTS: "reading lyrics & text (OCR)",
  MEASURES: "measures", CHORDS: "chords", CURVES: "ties & slurs", SYMBOLS: "symbols", LINKS: "linking symbols",
  RHYTHMS: "rhythms", PAGE: "finishing the page",
};

function fmt(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function setStep(name) {
  const order = ["pages", "engine", "recognize", "save"];
  const idx = order.indexOf(name);
  for (const li of $("steps").children) {
    const i = order.indexOf(li.dataset.step);
    li.dataset.state = i < idx ? "done" : i === idx ? "active" : "";
  }
}

function setBar(fraction) {
  lastFraction = Math.max(lastFraction, Math.min(1, fraction));
  $("bar").style.width = `${(lastFraction * 100).toFixed(1)}%`;
}

function tick() {
  $("elapsed").textContent = `elapsed ${fmt((performance.now() - t0) / 1000)}`;
}

// The first lines (browser/device) are kept when the log is trimmed: they're what
// makes a pasted failure report diagnosable.
let logHead = "";
function appendLog(line) {
  const log = $("log");
  log.textContent += line + "\n";
  if (log.textContent.length > 400000) log.textContent = logHead + "…\n" + log.textContent.slice(-300000);
  if ($("log-wrap").open) log.scrollTop = log.scrollHeight;
}

function onProgress(p) {
  if (p.phase === "pages") {
    setStep("pages");
    $("stage").textContent = "Finding the music pages";
    $("detail").textContent = p.page ? `page ${p.page} of ${p.pages}` : "opening the PDF";
    setBar(0.02 * (p.fraction || 0));
  } else if (p.phase === "engine") {
    setStep("engine");
    $("stage").textContent = "Starting the recognition engine";
    $("detail").textContent = "first time: downloading — later runs start faster";
    setBar(0.03);
  } else if (p.phase === "recognize") {
    setStep("recognize");
    const now = performance.now();
    if (p.sheet !== sheetStart.sheet) {
      if (sheetStart.sheet) sheetTimes.push((now - sheetStart.at) / 1000);
      sheetStart = { sheet: p.sheet, at: now };
    }
    $("stage").textContent = `Recognizing page ${p.sheet} of ${p.sheets}`;
    $("detail").textContent = STEP_LABELS[p.step] || p.step || "";
    setBar(0.05 + 0.93 * p.fraction);
    if (sheetTimes.length) {
      const avg = sheetTimes.reduce((a, b) => a + b, 0) / sheetTimes.length;
      const left = avg * (p.sheets - p.sheet + 1) - (now - sheetStart.at) / 1000;
      $("eta").textContent = `about ${fmt(left)} left`;
    } else {
      $("eta").textContent = "estimating time…";
    }
  } else if (p.phase === "export") {
    $("detail").textContent = "writing MusicXML";
    setBar(0.99);
  }
}

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
function modeFromFileName(name) {
  const m = /[\s_]-[\s_]+[A-G][b#♭♯]?[\s_]*(major|minor)\b/i.exec(name);
  return m ? m[1].toLowerCase() : null;
}

// Write <mode> into every <key> that has none (the Sing page names keys "F" vs "Dm").
function setMode(xml, mode) {
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

function chooseTitle(res, xml, firstFailed) {
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

function setTitle(xml, title) {
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

function fail(err) {
  console.error(err);
  $("progress").hidden = true;
  $("error").hidden = false;
  $("error-msg").textContent = err?.message || String(err);
  $("log-wrap").hidden = false;
}

async function run(file) {
  running = true;
  baseName = file.name.replace(/\.pdf$/i, "") || "song";
  $("pick").hidden = true;
  $("warning").hidden = true;
  $("progress").hidden = false;
  $("log-wrap").hidden = false;
  t0 = performance.now();
  timer = setInterval(tick, 1000);
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
  document.addEventListener("visibilitychange", async () => {
    if (!document.hidden && running && !wakeLock) {
      try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
    }
  });

  const mem = navigator.deviceMemory ? `${navigator.deviceMemory} GB RAM` : "RAM unknown";
  logHead = `Resonate ${$("version").textContent} · ${new Date().toISOString()}\n` +
    `${navigator.userAgent}\n${navigator.hardwareConcurrency || "?"} CPU threads · ${mem} · ` +
    `PDF ${(file.size / 1e6).toFixed(1)} MB\n`;
  appendLog(logHead.trimEnd());

  try {
    const omr = await import("./omr/omr.js?v=56");
    const res = await omr.convertPdf(file, { onProgress, onLog: appendLog });

    setStep("save");
    $("stage").textContent = "Saving to My songs";
    const xmls = [];
    for (const [i, b] of res.mxls.entries()) xmls.push(await readScoreFile(new File([b], `${baseName}-${i + 1}.mxl`)));
    const joined = joinMovements(xmls);
    if (xmls.length > 1) appendLog(`[fix] ${xmls.length} scores (movements) joined into one`);
    const fixed = fixOmrScore(joined, res.log, { tempo: res.tempo });
    for (const c of fixed.changes) appendLog(`[fix] ${c}`);
    const xml = fixed.xml;
    // Page 1's credits (title) are gone when the first music page failed; don't take page 2's.
    const firstFailed = res.failed.some((f) => f.sheet === 1);
    const title = chooseTitle(res, xml, firstFailed);
    finalXml = setTitle(xml, title);
    const mode = modeFromFileName(baseName);
    if (mode) {
      finalXml = setMode(finalXml, mode);
      appendLog(`[fix] key mode from the file name: ${mode}`);
    }
    const score = parseMusicXml(finalXml, title);
    const id = await addSong(score.title, finalXml);
    try { localStorage.setItem("resonate.sing.song", id); localStorage.removeItem("resonate.sing.verse"); } catch {}
    setBar(1);

    const lyrics = score.notes.filter((n) => Object.keys(n.verses).length).length;
    $("progress").hidden = true;
    $("result").hidden = false;
    $("result-title").textContent = `“${score.title}”`;
    const read = res.pages.filter((p) => !res.failed.some((f) => f.page === p));
    $("result-detail").textContent =
      `${score.notes.length} melody notes, ${lyrics} with lyrics${score.verses.length > 1 ? ` (${score.verses.length} verses)` : ""}, ` +
      `from ${read.length} page${read.length === 1 ? "" : "s"} (${read.join(", ")}) in ${fmt((performance.now() - t0) / 1000)}. Saved to My songs.`;
    if (res.failed.length) {
      const pages = res.failed.map((f) => f.page);
      $("result-missing").hidden = false;
      $("result-missing").textContent =
        `Couldn't read page${pages.length === 1 ? "" : "s"} ${pages.join(", ")}, so ${pages.length === 1 ? "it's" : "they're"} ` +
        "left out of the song" + (firstFailed ? " (the title, tempo and time signature come from the first page, so they may be off)" : "") +
        ". Details → Copy log says why.";
    }
  } catch (err) {
    fail(err);
  } finally {
    running = false;
    clearInterval(timer);
    tick();
    try { await wakeLock?.release(); } catch {}
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
window.addEventListener("beforeunload", (e) => {
  if (running) { e.preventDefault(); e.returnValue = ""; }
});

// Test hook: start a conversion from a URL (?pdf=...) without the file picker.
const testPdf = new URLSearchParams(location.search).get("pdf");
if (testPdf) {
  fetch(testPdf).then((r) => r.blob()).then((b) => run(new File([b], testPdf.split("/").pop())));
}
window.resonateDebug = () => ({ running, lastFraction, sheetTimes, hasResult: !!finalXml });
