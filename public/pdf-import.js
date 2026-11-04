// PDF → Song: run Audiveris in the browser (omr/omr.js) on a PDF and save the
// resulting MusicXML to My songs. No settings: pages without staves are skipped
// automatically, English OCR for lyrics, the title is taken from the score.

import { readScoreFile, parseMusicXml } from "./musicxml.js";
import { addSong } from "./library.js";

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
let mxlBytes = null;
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

function appendLog(line) {
  const log = $("log");
  log.textContent += line + "\n";
  if (log.textContent.length > 400000) log.textContent = log.textContent.slice(-300000);
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

// The score's visual title: the largest-font credit on the first page. Audiveris's
// movement-title is often OCR noise; fall back to the PDF's file name.
function pickTitle(xml, fallback) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  let best = null, size = 0;
  for (const c of doc.querySelectorAll("credit")) {
    if ((c.getAttribute("page") || "1") !== "1") continue;
    for (const w of c.querySelectorAll("credit-words")) {
      const t = (w.textContent || "").trim();
      const s = parseFloat(w.getAttribute("font-size")) || 0;
      if (s > size && /[A-Za-z]{2}/.test(t) && t.length >= 3 && t.length <= 80) { size = s; best = t; }
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

  try {
    const omr = await import("./omr/omr.js");
    const res = await omr.convertPdf(file, { onProgress, onLog: appendLog });
    mxlBytes = res.mxl;

    setStep("save");
    $("stage").textContent = "Saving to My songs";
    const xml = await readScoreFile(new File([res.mxl], `${baseName}.mxl`));
    const title = pickTitle(xml, baseName);
    const finalXml = setTitle(xml, title);
    const score = parseMusicXml(finalXml, title);
    const id = await addSong(score.title, finalXml);
    try { localStorage.setItem("resonate.sing.song", id); localStorage.removeItem("resonate.sing.verse"); } catch {}
    setBar(1);

    const lyrics = score.notes.filter((n) => Object.keys(n.verses).length).length;
    $("progress").hidden = true;
    $("result").hidden = false;
    $("result-title").textContent = `“${score.title}”`;
    $("result-detail").textContent =
      `${score.notes.length} melody notes, ${lyrics} with lyrics${score.verses.length > 1 ? ` (${score.verses.length} verses)` : ""}, ` +
      `from ${res.pages.length} page${res.pages.length === 1 ? "" : "s"} (${res.pages.join(", ")}) in ${fmt((performance.now() - t0) / 1000)}. Saved to My songs.`;
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
  if (!mxlBytes) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([mxlBytes], { type: "application/vnd.recordare.musicxml" }));
  a.download = `${baseName}.mxl`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
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
window.resonateDebug = () => ({ running, lastFraction, sheetTimes, hasResult: !!mxlBytes });
