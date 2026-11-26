// Songs (bottom right): My songs and the samples, + Add (PDF, MusicXML, a link), and home's
// Next-up card (the song open last). Choosing a song makes it the open song the way Sing does
// (resonate.sing.song) and opens it in place (songview.js, set by boot.js): with Sing, or — a PDF
// not converted yet — with the Score on its PDF.
// v90 (docs/LIBRARY.md §4): a PDF added is a song at once (its PDF only: no 5-minute wait); each
// row's ⋯ converts it (or reads it again with the newest engine) and deletes it; the header converts
// them all. The conversions run one after another in the tray (tray.js: its queue), each row says
// what its song is and where it is: "PDF only · 2d", "PDF · 2d" (converted), "queued", "converting
// 3/7" — and, only when a newer engine would read it again, a quiet "v9 → v10" beside that.
import { listSongs, addSong, addPdfSong, listPdfIds } from "../library.js?v=119";
import { SAMPLES, songInfo } from "../catalog.js?v=119";
import { readScoreFile, parseMusicXml } from "../musicxml.js?v=119";
import { spaceChanged } from "../nav.js?v=119";
import { forgetSong } from "../forget.js?v=119";
import { titleFromFileName } from "../omr/importer.js?v=119";
import { ENGINE_N } from "../omr/engine.js?v=119";
import { ic, fic, esc, openOverlay, closeOverlay, overlayOpen } from "./chrome.js?v=119";

const SONG_KEY = "resonate.sing.song";
const $ = (id) => document.getElementById(id);
const openSongId = () => { try { return localStorage.getItem(SONG_KEY); } catch { return null; } };
// (DATA_KEYS: not written after another tab switched whose data this device shows — as sing.js store)
export function setOpenSong(id, { newSong = false } = {}) {
  if (spaceChanged()) return;
  try {
    localStorage.setItem(SONG_KEY, id);
    if (newSong) localStorage.removeItem("resonate.sing.verse"); // (as Sing's import)
  } catch {}
}
let opener = null; // (boot.js: the song in place — Sing, the Score; opts { sing, score }: shown for it — set before any UI exists)
export const setOpener = (fn) => { opener = fn; };
export function openSong(id, opts = {}) {
  setOpenSong(id);
  opener?.(id, opts);
}

const age = (t) => {
  const d = (Date.now() - t) / 864e5;
  return d < 1 ? "new" : d < 7 ? `${Math.floor(d)}d` : d < 60 ? `${Math.floor(d / 7)}w` : `${Math.floor(d / 30)}mo`;
};
// A song's title without reading it: the library's index, or a sample's.
export async function titleOf(id) {
  if (SAMPLES[id]) return SAMPLES[id].title;
  try { return (await listSongs()).find((s) => s.id === id)?.title || null; } catch { return null; }
}
// The engine that read a converted song — shown only when it's older than this release's (Reconvert
// would read it again): "v9 → v10" (index eng 0: before v90, unrecorded — "≤v9").
const isOld = (s) => s.k === "conv" && (s.eng || 0) < ENGINE_N;
const engOf = (n) => (n ? `v${n}` : "≤v9");
const isPdfFile = (f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf";
const MORE = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.7" fill="currentColor" stroke="none"/></svg>';
const AGAIN = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4v4.5H15"/></svg>';
const BIN = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/></svg>';
const RC = 2 * Math.PI * 18;
const ring = (f) => `<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="2.5"/><circle class="arc" cx="20" cy="20" r="18" fill="none" stroke="#ffe6a0" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${(RC * Math.max(0.02, f || 0)).toFixed(1)} ${RC.toFixed(1)}" transform="rotate(-90 20 20)"/></svg>`;

// tray: tray.js's mount (the queue); view(): songview.js's (the song open, closeSong); onDeleted(id):
// a song deleted (boot.js: Next-up again).
export function mountSongs({ tray, view = () => null, onDeleted = () => {} }) {
  const sheet = $("songs"), body = $("songs-body"), addBtn = $("add-btn"), addMenu = $("add-menu");
  const linkRow = $("link-form"), linkInput = $("link-url"), msg = $("songs-msg");
  const xmlInput = $("xml-input"), pdfInput = $("pdf-input"), songsBtn = $("songs-btn"), rowMenu = $("row-menu");

  function say(text, kind = "") {
    msg.textContent = text;
    msg.dataset.kind = kind;
    msg.hidden = !text;
  }

  // --- the list ----------------------------------------------------------------------------
  // What a row says, in few words: what the song is and where its conversion is.
  const runningFact = (q) => (q.paused ? "stopped" : `converting${q.page && q.of ? ` ${q.page}/${q.of}` : ""}`);
  function factOf(s, q) {
    if (q.running === s.id) return runningFact(q);
    const when = q.ids.includes(s.id) ? "queued" : age(s.added);
    if (s.k === "pdf") return `PDF only · ${s.fail && when !== "queued" ? "couldn't read" : when}`;
    if (s.k === "conv") return `PDF · ${when}`;
    return `MusicXML · ${age(s.added)}`;
  }
  let rendering = 0;
  let known = new Map(); // id → index entry (the list as drawn: the menu's choices)
  let pdfIds = new Set();
  // A render asked for while a row's ⋯ menu is open (the tray at a song's start or end, the sync, a
  // library write) waits until it closes: the menu stays where it is — an armed Delete too — and its
  // row isn't redrawn under it (the confirming tap would land on the row below and open that song).
  let stale = false;
  async function render() {
    const gen = ++rendering;
    let mine = [], pdfs = new Set();
    try { mine = await listSongs(); } catch (err) { console.warn("songs", err); }
    try { pdfs = new Set(await listPdfIds()); } catch {}
    if (gen !== rendering) return;
    if (!rowMenu.hidden) { stale = true; return; }
    stale = false;
    known = new Map(mine.map((s) => [s.id, s]));
    pdfIds = pdfs;
    const cur = openSongId();
    const q = tray.queueInfo();
    // (old: the engine's badge after the fact — "v9 → v10")
    const row = (id, title, { src = "xml", fact = "", menu = true, old = null, conv = false, f = 0 } = {}) => `<div class="songrow" data-id="${esc(id)}"><button class="song" type="button" data-id="${esc(id)}" ${id === cur ? "data-current" : ""} ${old ? "data-old" : ""}>
      <span class="tile" data-src="${conv ? "reading" : src}">${conv ? ring(f) : ""}${ic(src === "pdf" ? "doc" : "score")}</span>
      <span class="mid"><span class="t">${esc(title)}</span>${fact ? `<span class="sl"><span class="s mono">${esc(fact)}</span>${old ? `<span class="eng mono" title="Read by an older engine — Reconvert reads it with v${ENGINE_N}">${esc(old)} → v${ENGINE_N}</span>` : ""}</span>` : ""}</span></button>${menu ? `<button class="more" type="button" data-act="menu" aria-label="Song options" aria-haspopup="menu" aria-expanded="false">${MORE}</button>` : ""}</div>`;
    const reading = tray.readingRow();
    const mineHtml = mine.map((s) => row(s.id, s.title, {
      src: s.k === "pdf" ? "pdf" : s.k === "conv" ? "conv" : "xml", fact: factOf(s, q),
      old: isOld(s) && q.running !== s.id ? engOf(s.eng) : null, conv: q.running === s.id, f: q.fraction,
    })).join("");
    // The header: convert them all — or, while a queue runs, where it is and Stop.
    const waiting = new Set([...q.ids, q.running].filter(Boolean));
    const nConv = mine.filter((s) => s.k === "pdf" && !s.fail && !waiting.has(s.id) && pdfs.has(s.id)).length;
    const nRe = mine.filter((s) => isOld(s) && !waiting.has(s.id) && pdfs.has(s.id)).length;
    const acts = waiting.size
      ? `<span class="qstat mono">Converting${q.total > 1 ? ` ${Math.min(q.done + 1, q.total)}/${q.total}` : ""}</span><button class="secbtn" type="button" data-act="stop">Stop</button>`
      : (nConv ? `<button class="secbtn" type="button" data-act="convert-all">Convert all · ${nConv}</button>` : "") +
        (nRe ? `<button class="secbtn" type="button" data-act="reconvert-all">Reconvert all · ${nRe}</button>` : "");
    // (a row's ⋯ focused — the menu closed with Escape — keeps the focus across the redraw)
    const fa = document.activeElement, refocus = fa?.matches?.(".songrow .more") && body.contains(fa) ? fa.closest(".songrow").dataset.id : null;
    body.innerHTML =
      (reading || mine.length ? `<div class="sec"><span class="sh">My songs <span class="mono">${mine.length || ""}</span></span>${acts ? `<span class="sacts">${acts}</span>` : ""}</div><div class="rows">${reading}${mineHtml}</div>` : "") +
      `<div class="sec"><span class="sh">Samples</span></div><div class="rows">${Object.entries(SAMPLES).map(([id, s]) => row(id, s.title, { src: "sample", menu: false })).join("")}</div>`;
    if (refocus) body.querySelector(`.songrow[data-id="${CSS.escape(refocus)}"] .more`)?.focus({ preventScroll: true });
  }
  // The song being converted: its row's words and ring every second (not the whole list).
  function tick() {
    const q = tray.queueInfo();
    if (!q.running) return;
    const b = body.querySelector(`.song[data-id="${CSS.escape(q.running)}"]`);
    if (!b) return;
    const s = b.querySelector(".s"), text = runningFact(q);
    if (s && s.textContent !== text) s.textContent = text;
    b.querySelector(".tile .arc")?.setAttribute("stroke-dasharray", `${(RC * Math.max(0.02, q.fraction || 0)).toFixed(1)} ${RC.toFixed(1)}`);
  }
  setInterval(() => { if (!sheet.hidden) tick(); }, 1000);

  body.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    if (act) { onAct(act.dataset.act, act); return; }
    if (e.target.closest(".song.reading")) { closeOverlay({ keepHistory: true }); tray.expand(); return; }
    const b = e.target.closest(".song[data-id]");
    if (b) openSong(b.dataset.id);
  });
  function onAct(act, el) {
    if (act === "menu") {
      const id = el.closest(".songrow")?.dataset.id;
      if (rowMenu.dataset.id === id && !rowMenu.hidden) closeMenu();
      else openMenu(id, el);
    } else if (act === "convert-all" || act === "reconvert-all") {
      const q = tray.queueInfo(), waiting = new Set([...q.ids, q.running].filter(Boolean));
      const ids = [...known.values()].filter((s) => !waiting.has(s.id) && pdfIds.has(s.id) &&
        (act === "convert-all" ? s.k === "pdf" && !s.fail : isOld(s))).map((s) => s.id);
      tray.convert(ids); // (in the tap: the screen stays awake)
      render();
    } else if (act === "stop") tray.cancelQueue().finally(render);
  }

  // --- a row's ⋯: Convert / Reconvert, Delete (a popover in the sheet, beside the row) ----------
  let armed = null;
  function closeMenu() {
    if (rowMenu.hidden) return;
    rowMenu.hidden = true;
    clearTimeout(armed);
    armed = null;
    body.querySelector(`.more[aria-expanded="true"]`)?.setAttribute("aria-expanded", "false");
    delete rowMenu.dataset.id;
    if (stale) render(); // (what changed while it was open)
  }
  function openMenu(id, btn) {
    const s = known.get(id);
    if (!s) return;
    closeAdd();
    closeMenu();
    const q = tray.queueInfo();
    const waiting = q.running === id || q.ids.includes(id);
    const item = (act, lead, text) => `<button class="prow" type="button" role="menuitem" data-act="${act}"><span class="lead ${lead}">${act === "delete" ? BIN : act === "convert" ? ic("score") : AGAIN}</span><span class="pl">${text}</span></button>`;
    const items = [];
    if (!waiting && pdfIds.has(id)) {
      if (s.k === "pdf") items.push(item("convert", "l-pdf", "Convert"));
      else if (s.k === "conv") items.push(item("reconvert", "l-xml", "Reconvert"));
    }
    items.push(item("delete", "l-del", "Delete"));
    rowMenu.innerHTML = items.join("");
    rowMenu.dataset.id = id;
    rowMenu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    // beside the row: below it, or above when the sheet has no room under it
    const sr = sheet.getBoundingClientRect(), br = btn.getBoundingClientRect(), mh = rowMenu.offsetHeight;
    let top = br.bottom - sr.top + 4;
    if (top + mh > sr.height - 8) top = Math.max(8, br.top - sr.top - mh - 4);
    rowMenu.style.top = `${Math.round(top)}px`;
    rowMenu.style.right = `${Math.max(8, Math.round(sr.right - br.right))}px`;
    rowMenu.querySelector(".prow")?.focus({ preventScroll: true });
  }
  rowMenu.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"), id = rowMenu.dataset.id;
    if (!b || !id) return;
    const act = b.dataset.act;
    if (act === "convert" || act === "reconvert") {
      closeMenu();
      tray.convert([id], { force: true }); // (in the tap: the screen stays awake)
      render();
    } else if (act === "delete") {
      if (!b.hasAttribute("data-armed")) { // (two taps, as the Reader's ✕: a stray one never deletes)
        b.toggleAttribute("data-armed", true);
        b.querySelector(".pl").textContent = "Delete?";
        clearTimeout(armed);
        armed = setTimeout(() => { b.removeAttribute("data-armed"); b.querySelector(".pl").textContent = "Delete"; }, 3000);
        return;
      }
      closeMenu();
      del(id);
    }
  });
  body.addEventListener("scroll", closeMenu, { passive: true });

  // Delete: its conversion stopped, the song closed if it's the one open (Songs comes back), then
  // everything kept for it (forget.js); the list again.
  const popped = () => new Promise((r) => {
    const t = setTimeout(r, 500);
    addEventListener("popstate", () => { clearTimeout(t); setTimeout(r, 0); }, { once: true });
  });
  let deleting = null;
  async function del(id) {
    if (deleting || SAMPLES[id]) return;
    deleting = id;
    try {
      try { await tray.forget(id); } catch (err) { console.warn("forget", err); }
      const v = view();
      const wasOpen = !!v && v.current === id;
      if (wasOpen) { const back = popped(); await v.closeSong(id); await back; } // (its history entry goes, the sheet's with it)
      try { window.resonatePlay?.forget?.(id); } catch {} // (the Score doesn't write its record back)
      try { await forgetSong(id); }
      catch (err) { console.warn("delete", err); say(`Couldn't delete: ${err.message}`, "error"); }
      if (wasOpen) open(); else render();
      try { onDeleted(id); } catch {}
    } finally { deleting = null; }
  }

  function open() {
    say("");
    closeAdd();
    render();
    sheet.hidden = false;
    songsBtn.setAttribute("aria-expanded", "true");
    openOverlay("songs", () => { sheet.hidden = true; closeAdd(); closeMenu(); songsBtn.setAttribute("aria-expanded", "false"); });
  }
  songsBtn.addEventListener("click", () => (overlayOpen("songs") ? closeOverlay() : open()));
  addEventListener("resonate:data", () => { if (!sheet.hidden) render(); });
  addEventListener("resonate:remote", (e) => { if (!sheet.hidden && (e.detail?.songs || e.detail?.replaced)) render(); });

  // --- + Add ------------------------------------------------------------------------------
  function closeAdd() {
    addMenu.hidden = true;
    linkRow.hidden = true;
    addBtn.setAttribute("aria-expanded", "false");
  }
  addBtn.addEventListener("click", () => {
    const show = addMenu.hidden;
    closeAdd();
    closeMenu();
    addMenu.hidden = !show;
    addBtn.setAttribute("aria-expanded", String(show));
  });
  sheet.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!rowMenu.hidden) { e.preventDefault(); const id = rowMenu.dataset.id; closeMenu(); body.querySelector(`.songrow[data-id="${CSS.escape(id || "")}"] .more`)?.focus(); }
    else if (!addMenu.hidden || !linkRow.hidden) { e.preventDefault(); closeAdd(); }
  });
  sheet.addEventListener("click", (e) => {
    if (!addMenu.hidden && !e.target.closest("#add-menu, #add-btn")) closeAdd();
  });
  // A tap outside an open ⋯ menu only closes it (LIBRARY.md: "closes on outside tap"): the row, the
  // header's Convert all / Stop or + Add under the finger isn't acted on — a dismissing tap. Another
  // row's ⋯ goes to that row's menu.
  sheet.addEventListener("click", (e) => {
    if (rowMenu.hidden || e.target.closest("#row-menu, [data-act=menu]")) return;
    e.preventDefault();
    e.stopPropagation();
    closeMenu();
  }, true);
  // iOS opens a file picker only from a direct tap: each row is its own button.
  $("add-pdf").addEventListener("click", () => { closeAdd(); pdfInput.click(); });
  $("add-xml").addEventListener("click", () => { closeAdd(); xmlInput.click(); });
  $("add-link").addEventListener("click", () => {
    closeAdd();
    linkRow.hidden = false;
    say("");
    linkInput.focus();
  });
  // PDFs: each a song at once (its PDF only — converting it is a tap on its ⋯, or Convert all); one
  // opens in place on its PDF.
  pdfInput.addEventListener("change", () => {
    const files = [...pdfInput.files];
    pdfInput.value = "";
    if (files.length) addPdfs(files);
  });
  async function addPdfs(files) {
    const pdfs = files.filter(isPdfFile), others = files.length - pdfs.length;
    if (!pdfs.length) return say(files.length > 1 ? "Those aren't PDFs." : "That isn't a PDF.", "error");
    say(pdfs.length > 1 ? `Adding ${pdfs.length} PDFs…` : `Adding “${pdfs[0].name}”…`);
    const ids = [];
    let failed = 0;
    for (const f of pdfs) {
      try { ids.push(await addPdfSong(await f.arrayBuffer(), { name: f.name, title: titleFromFileName(f.name) })); }
      catch (err) { console.warn("add pdf", err); failed++; }
    }
    if (ids.length === 1 && files.length === 1) {
      say("");
      setOpenSong(ids[0], { newSong: true });
      openSong(ids[0], { score: true });
      return;
    }
    render();
    const bits = [ids.length ? `✓ ${ids.length} added` : "Not added", failed && ids.length ? `${failed} not added` : "", others ? `${others} not PDF${others === 1 ? "" : "s"}` : ""];
    say(bits.filter(Boolean).join(" · "), ids.length ? "ok" : "error");
  }
  xmlInput.addEventListener("change", () => {
    const f = xmlInput.files[0];
    xmlInput.value = "";
    if (f) importFile(f);
  });
  $("link-form").addEventListener("submit", (e) => { e.preventDefault(); importLink(linkInput.value); });

  // Validate, save to My songs, open it (sing.js importXml).
  async function importXml(xml, name, source) {
    const sc = parseMusicXml(xml, name);
    const id = await addSong(sc.title, xml, { source });
    setOpenSong(id, { newSong: true });
    say(`✓ ${sc.title}`, "ok");
    openSong(id);
  }
  async function importFile(file) {
    say(`Opening “${file.name}”…`);
    try {
      const hint = formatHint(file.name);
      if (hint) throw new Error(hint);
      if (file.size > 20 * 1024 * 1024) throw new Error("over 20 MB — not a song score");
      await importXml(await readScoreFile(file), file.name, "file");
    } catch (err) {
      console.warn(err);
      say(`Couldn't open “${file.name}”: ${err.message}`, "error");
    }
  }
  async function importLink(raw) {
    if (!raw || !raw.trim()) return;
    let url;
    try { url = normalizeLink(raw.trim()); } catch { return say("Not a link.", "error"); }
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "Linked song");
    say(`Downloading ${name}…`);
    try {
      const hint = formatHint(name);
      if (hint) throw new Error(hint);
      let res;
      try { res = await fetch(url); } catch { throw new Error("the site blocks this — download the file and use MusicXML."); }
      if (!res.ok) throw new Error(`the link returned ${res.status}`);
      const xml = await readScoreFile(new File([await res.blob()], name));
      if (/^\s*<!doctype html|^\s*<html/i.test(xml)) throw new Error("that's a web page — use the direct download link.");
      await importXml(xml, name, "link");
    } catch (err) {
      console.warn(err);
      say(`Couldn't load the link: ${err.message}`, "error");
    }
  }

  return { open, render, close: () => overlayOpen("songs") && closeOverlay(), debug: () => ({ menu: rowMenu.hidden ? null : rowMenu.dataset.id || null, deleting }) };
}

// The common wrong formats, said plainly (sing.js formatHint; a PDF goes to Add → PDF).
function formatHint(name) {
  const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
  const hints = {
    mscz: "MuseScore file — in MuseScore: File → Export → MusicXML.",
    mscx: "MuseScore file — in MuseScore: File → Export → MusicXML.",
    mid: "MIDI has no lyrics — export MusicXML instead.",
    midi: "MIDI has no lyrics — export MusicXML instead.",
    pdf: "a PDF — use Add → PDF.",
    sib: "Sibelius file — export it as MusicXML.",
    gp: "Guitar Pro file — export it as MusicXML.",
  };
  return hints[ext] || null;
}
// GitHub page links → the raw file; Dropbox share links → direct download (sing.js normalizeLink).
export function normalizeLink(url) {
  const u = new URL(url);
  if (u.hostname === "github.com") {
    const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
    if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
  }
  if (u.hostname.endsWith("dropbox.com")) {
    u.searchParams.set("dl", "1");
    return u.toString();
  }
  return u.toString();
}

// Home's Next-up: a small chip just above Songs — "▶ Amazing Grace", the song open last; a tap opens
// it with Sing (it advertises a singing step) — a PDF not converted yet, on its PDF (songview.js).
export async function mountNextUp(el) {
  const id = openSongId();
  const info = id ? await songInfo(id).catch(() => null) : null;
  const title = info?.title || null;
  el.hidden = !title;
  if (!title) return;
  el.innerHTML = `<span class="go">${fic("play")}</span><span class="t"></span>`;
  el.querySelector(".t").textContent = title;
  el.title = title;
  el.setAttribute("aria-label", info.k === "pdf" ? title : `${title} — sing`);
  el.onclick = () => openSong(id, { sing: true });
}
