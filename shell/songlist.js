// Songs (bottom right): My songs and the samples, + Add (PDF in the background, MusicXML, a link),
// and home's Next-up card (the song open last). Choosing a song makes it the open song the way Sing
// does (resonate.sing.song) and opens today's Sing page — Play on a tablet.
import { listSongs, addSong, listPdfIds } from "../library.js?v=83";
import { SAMPLES } from "../catalog.js?v=83";
import { readScoreFile, parseMusicXml } from "../musicxml.js?v=83";
import { spaceChanged } from "../nav.js?v=83";
import { ic, fic, esc, openOverlay, closeOverlay, overlayOpen, go, songPage } from "./chrome.js?v=83";

const SONG_KEY = "resonate.sing.song";
const $ = (id) => document.getElementById(id);
const openSongId = () => { try { return localStorage.getItem(SONG_KEY); } catch { return null; } };
// (DATA_KEYS: not written after another tab switched whose data this device shows — as sing.js store)
function setOpenSong(id, { newSong = false } = {}) {
  if (spaceChanged()) return;
  try {
    localStorage.setItem(SONG_KEY, id);
    if (newSong) localStorage.removeItem("resonate.sing.verse"); // (as Sing's import)
  } catch {}
}
export function openSong(id, page = songPage()) {
  setOpenSong(id);
  go(page);
}

const age = (t) => {
  const d = (Date.now() - t) / 864e5;
  return d < 1 ? "new" : d < 7 ? `${Math.floor(d)}d` : d < 60 ? `${Math.floor(d / 7)}w` : `${Math.floor(d / 30)}mo`;
};
// A seeded little melody, drawn like a lane: the song's tile art (no score is read for it).
function contour(seed) {
  let r = 0;
  for (const c of String(seed)) r = (r * 31 + c.charCodeAt(0)) % 2147483647;
  r = r || 7;
  const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
  let m = 6, t = 0, out = "";
  while (t < 108) {
    const d = [8, 8, 14, 14, 20][Math.floor(rnd() * 5)];
    m = Math.max(1, Math.min(11, m + Math.round((rnd() - 0.5) * 5)));
    out += `<rect x="${6 + t}" y="${4 + m * 4.4}" width="${d - 2}" height="4" rx="2"/>`;
    t += d + (rnd() < 0.15 ? 6 : 0);
  }
  return `<svg viewBox="0 0 120 64" preserveAspectRatio="none" aria-hidden="true"><g fill="rgba(255,255,255,.88)">${out}</g></svg>`;
}
const GRADS = ["#2a1f63,#5b34a8 70%,#8c4fe8", "#45163b,#93306a 70%,#d84a8e", "#13285a,#2a50a8 70%,#4473e6", "#123c34,#1f7a66 70%,#2fb894"];
const gradFor = (id) => { let h = 0; for (const c of String(id)) h = (h + c.charCodeAt(0)) % GRADS.length; return `linear-gradient(150deg,${GRADS[h]})`; };

// A song's title without reading it: the library's index, or a sample's.
async function titleOf(id) {
  if (SAMPLES[id]) return SAMPLES[id].title;
  try { return (await listSongs()).find((s) => s.id === id)?.title || null; } catch { return null; }
}

export function mountSongs({ tray }) {
  const sheet = $("songs"), body = $("songs-body"), addBtn = $("add-btn"), addMenu = $("add-menu");
  const linkRow = $("link-form"), linkInput = $("link-url"), msg = $("songs-msg");
  const xmlInput = $("xml-input"), pdfInput = $("pdf-input"), songsBtn = $("songs-btn");

  function say(text, kind = "") {
    msg.textContent = text;
    msg.dataset.kind = kind;
    msg.hidden = !text;
  }

  // --- the list ----------------------------------------------------------------------------
  let rendering = 0;
  async function render() {
    const gen = ++rendering;
    let mine = [], pdfs = new Set();
    try { mine = await listSongs(); } catch (err) { console.warn("songs", err); }
    try { pdfs = new Set(await listPdfIds()); } catch {}
    if (gen !== rendering) return;
    const cur = openSongId();
    const row = (id, title, src, fact) => `<button class="song" type="button" data-id="${esc(id)}" ${id === cur ? "data-current" : ""}>
      <span class="tile" data-src="${src}">${ic(src === "pdf" ? "doc" : src === "xml" ? "xml" : "score")}</span>
      <span class="mid"><span class="t">${esc(title)}</span>${fact ? `<span class="s mono">${esc(fact)}</span>` : ""}</span></button>`;
    const reading = tray.readingRow();
    const mineHtml = mine.map((s) => row(s.id, s.title, pdfs.has(s.id) ? "pdf" : "xml", `${pdfs.has(s.id) ? "PDF" : "MusicXML"} · ${age(s.added)}`)).join("");
    body.innerHTML =
      (reading || mine.length ? `<div class="sec">My songs <span class="mono">${mine.length || ""}</span></div><div class="rows">${reading}${mineHtml}</div>` : "") +
      `<div class="sec">Samples</div><div class="rows">${Object.entries(SAMPLES).map(([id, s]) => row(id, s.title, "sample", "")).join("")}</div>`;
  }
  body.addEventListener("click", (e) => {
    if (e.target.closest(".song.reading")) { closeOverlay({ keepHistory: true }); tray.expand(); return; }
    const b = e.target.closest(".song[data-id]");
    if (b) openSong(b.dataset.id);
  });

  function open() {
    say("");
    closeAdd();
    render();
    sheet.hidden = false;
    songsBtn.setAttribute("aria-expanded", "true");
    openOverlay("songs", () => { sheet.hidden = true; closeAdd(); songsBtn.setAttribute("aria-expanded", "false"); });
  }
  songsBtn.addEventListener("click", () => (overlayOpen("songs") ? closeOverlay() : open()));
  addEventListener("resonate:data", () => { if (!sheet.hidden) render(); });

  // --- + Add ------------------------------------------------------------------------------
  function closeAdd() {
    addMenu.hidden = true;
    linkRow.hidden = true;
    addBtn.setAttribute("aria-expanded", "false");
  }
  addBtn.addEventListener("click", () => {
    const show = addMenu.hidden;
    closeAdd();
    addMenu.hidden = !show;
    addBtn.setAttribute("aria-expanded", String(show));
  });
  sheet.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && (!addMenu.hidden || !linkRow.hidden)) { e.preventDefault(); closeAdd(); }
  });
  sheet.addEventListener("click", (e) => {
    if (!addMenu.hidden && !e.target.closest("#add-menu, #add-btn")) closeAdd();
  });
  // iOS opens a file picker only from a direct tap: each row is its own button.
  $("add-pdf").addEventListener("click", () => { closeAdd(); pdfInput.click(); });
  $("add-xml").addEventListener("click", () => { closeAdd(); xmlInput.click(); });
  $("add-link").addEventListener("click", () => {
    closeAdd();
    linkRow.hidden = false;
    say("");
    linkInput.focus();
  });
  pdfInput.addEventListener("change", () => {
    const f = pdfInput.files[0];
    pdfInput.value = "";
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") return say("That isn't a PDF.", "error");
    tray.start(f); // (the tray takes the overlay's place)
  });
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
    go(songPage());
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

  return { open, render, close: () => overlayOpen("songs") && closeOverlay() };
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

// Home's Next-up card: the song open last, ▶ into Sing (it advertises a singing step).
export async function mountNextUp(el) {
  const id = openSongId();
  const title = id ? await titleOf(id) : null;
  el.hidden = !title;
  if (!title) return;
  el.innerHTML = `<span class="thumb" style="background:${gradFor(id)}">${contour(id)}</span>
    <span class="mid"><span class="t"></span><span class="s">Last song</span></span><span class="go">${fic("play")}</span>`;
  el.querySelector(".t").textContent = title;
  el.setAttribute("aria-label", `${title} — sing`);
  el.onclick = () => openSong(id, "sing.html");
}
