// Resonate on one page — the site's root since v92 (index.html; the old pages land here, away.js):
// the shell's entry. Home is the full tuner, Next-up a chip above Songs; Songs (bottom right) holds
// the song list and + Add, the module toggles (Sing · Score · Piano) sit beside it; a PDF is a song
// as soon as it's added, converted in the background (one song after another: the Reader tray); the
// avatar (top right) opens the account menu. nav.js ran first, so whose data the device shows is
// settled before anything here reads it.
import { spaceChanged, handing } from "../nav.js?v=118";
import { mountTuner, tunerHtml } from "./tuner.js?v=118";
import { mountSongs, mountNextUp, openSong, setOpener } from "./songlist.js?v=118";
import { mountSongView } from "./songview.js?v=118";
import { mountTray } from "./tray.js?v=118";
import { mountAccount } from "./account-menu.js?v=118";
import { ic, fic, device, overlayOpen, setUnderWay } from "./chrome.js?v=118";
import { fadeIn } from "./motion.js?v=118";
import { mountPlaces } from "./places.js?v=118";
import { mountRemote } from "./remote.js?v=118";
import { songInfo } from "../catalog.js?v=118";
import { readFlag } from "../omr/jobs.js?v=118";
import { activeSpace, activeDb } from "../space.js?v=118";

// An email link at the root, handed to account.html (nav.js): nothing here starts. (nav.js waits
// forever then, which holds this module back in Chromium — not in WebKit, which runs a module whose
// import another <script> started.)
if (handing) await new Promise(() => {});

const $ = (id) => document.getElementById(id);
const version = $("version").textContent.trim();

// --- what the address asks for -------------------------------------------------------------------
// The old pages land here (away.js: sing.html → ./?open=sing, play.html → score, record.html,
// voice.html, assistants.html → their place, pdf-import.html → import — with its own ?reprocess= /
// ?pdf=); the address loses them at once (before any sheet or song takes a history entry), so a
// reload or Back comes home instead of doing it again.
const params = new URLSearchParams(location.search);
const want = params.get("open"), reprocessId = params.get("reprocess"), testPdf = params.get("pdf");
if (["open", "reprocess", "pdf"].some((k) => params.has(k))) {
  for (const k of ["open", "reprocess", "pdf"]) params.delete(k);
  const q = params.toString();
  try { history.replaceState(history.state, "", location.pathname + (q ? `?${q}` : "") + location.hash); } catch {}
}

// --- the tuner and the dock's main button ------------------------------------------------------
const tunerEl = $("tuner");
tunerEl.innerHTML = tunerHtml();
const main = $("main-btn");
const WORD = { off: "Start", starting: "Starting…", listening: "Listening", blocked: "Start", noanswer: "Start", error: "Start" };
const tuner = mountTuner(tunerEl, {
  onState: (s) => {
    main.dataset.mic = s;
    main.querySelector(".b").innerHTML = s === "listening" || s === "starting" ? '<span class="sq"></span>' : ic(s === "blocked" ? "micoff" : "mic");
    main.querySelector(".l").textContent = WORD[s] || "Start";
    main.setAttribute("aria-label", s === "listening" ? "Listening — tap to stop" : s === "starting" ? "Starting the mic — tap to cancel" : "Start listening");
    main.setAttribute("aria-pressed", String(s === "listening"));
  },
});
main.addEventListener("click", () => tuner.toggle());
$("rec-btn").querySelector(".b").innerHTML = fic("rec");

// --- songs, the import tray, the account corner -------------------------------------------------
const tray = mountTray({ version, spaceChanged, openSong: (id, opts) => openSong(id, opts), onChange: () => songs.render(), onReplaced: (id) => song.reload(id) });
const songs = mountSongs({ tray, view: () => song, onDeleted: () => showNextUp() });
const nextUp = $("nextup");
let nextUpShown = 0;
const showNextUp = () => {
  const n = ++nextUpShown;
  return mountNextUp(nextUp).then(() => {
    if (n !== nextUpShown || song?.isOpen) { nextUp.hidden = true; return; }
    if (!nextUp.hidden) fadeIn(nextUp, { from: "translateY(6px)" });
  }).catch(() => { nextUp.hidden = true; });
};
showNextUp();
mountAccount({ version });

// --- a song opens in place; Sing, the Score and the Piano on or off beside Songs ----------------
let places = null, remoteHome = null;
const song = mountSongView({ tuner, version, onLoad: hooks, onLeave: showNextUp, reprocess: (id) => tray.reprocess(id) });
setOpener((id, opts) => song.open(id, opts));
function hooks() { // (sing.js, play.js, record.js… set their own when they load: the shell's go back on top, with theirs inside)
  window.resonateBusy = () => tray.busy() || song.busy(); // (nav.js: a reload for another tab's sign-in/out waits for it)
  window.resonateDebug = () => {
    const sc = song.scoreDebug();
    return {
      device: device(), tuner: tuner.debug(), import: tray.debug(), eventList: tray.eventList, songs: songs.debug(), song: song.debug(), sing: song.singDebug(), score: sc, piano: song.pianoDebug(),
      play: sc?.play, // (the Score's, as play.html's resonateDebug().play: the suites read it alike — docs/CLEANUP-PHASE8.md §2)
      place: places?.debug(), remote: remoteHome?.debug(),
      overlay: document.querySelector("body > .sheet:not([hidden]), #places > .sheet:not([hidden]), .pop:not([hidden])")?.id || (overlayOpen("tuner") ? "tuner" : null),
    };
  };
  remoteHome?.adopt(); // (Sing just loaded: its remote hooks go inside the shell's)
}

// --- Record, Voice and Assistants in place; the AI button from home -------------------------------
places = mountPlaces({
  onBefore: () => { tuner.park(); song.stopAll(); }, // (Record and Voice: the mic is theirs)
  onLoad: hooks,
  idle: () => tuner.state === "off" && !song.busy(),
  onClose: (what) => { // (a profile changed in Voice: the tuner's range, Sing's key menu)
    if (what !== "profiles") return;
    tuner.refresh();
    dispatchEvent(new CustomEvent("resonate:remote", { detail: { profiles: true } }));
  },
});
remoteHome = mountRemote({ sing: song.sing, song, places });
hooks();
// A stale shell's reload (chrome.js staleShell) waits for these — not for the module change or the
// song switch that mounts the page (song.busy() counts those: nav.js's reload waits for them too).
setUnderWay(() => tray.busy() || song.soundBusy() || remoteHome.busy());

// Test hook: read a PDF from a URL (?pdf=…) without the picker; else continue an unfinished import
// — shown when the address asked for it (pdf-import.html, its pill on the old pages), else folded.
// ?reprocess=<song>: that song's PDF read again (the old Play's ⟳), queued as the Score's would be.
if (testPdf) {
  fetch(testPdf).then((r) => r.blob()).then((b) => tray.start(new File([b], testPdf.split("/").pop(), { type: "application/pdf" })));
} else {
  const f = readFlag();
  const pending = !!f?.id && (f.db ? f.db === activeDb() : f.space === activeSpace());
  tray.resumePending({ minimized: want !== "import" });
  if (reprocessId) tray.reprocess(reprocessId);
  if (want === "import" && !pending) songs.open(); // (nothing to show: the songs — a reprocess's row says "converting")
}
// ?open=sing / score: the song open last with Sing / the Score shown for it only (as Next-up), else
// Songs; record / voice / assistants: that place's sheet over home.
if (want === "sing" || want === "score") {
  let id = null;
  try { id = localStorage.getItem("resonate.sing.song"); } catch {}
  (id ? songInfo(id).catch(() => null) : Promise.resolve(null)).then((info) => {
    if (info) openSong(id, { [want]: true });
    else songs.open();
  });
} else if (want === "record" || want === "voice" || want === "assistants") places.open(want);

// Back from the back/forward cache (a song page's Back): the page as left — sheets closed.
addEventListener("pageshow", (e) => { if (e.persisted) location.reload(); });

// The open song read again on another device (the sync's pull: resonate:remote replaced) — as the
// tray's own conversion does (onReplaced): a PDF only gets its notes and its modules back (Sing
// included), the Piano's range follows. Sing and the Score load the new notes on their own.
addEventListener("resonate:remote", (e) => {
  const r = e.detail?.replaced, id = song.current;
  if (id && r && (typeof r.has === "function" ? r.has(id) : Array.isArray(r) && r.includes(id))) song.reload(id, { self: true });
});

