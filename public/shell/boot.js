// Resonate on one page (preview): the shell's entry. Home is the full tuner, Next-up a chip above
// Songs; Songs (bottom right) holds the song list and + Add, the module toggles (Sing · Score ·
// Piano) sit beside it; a PDF is a song as soon as it's added, converted in the background (one
// song after another: the Reader tray); the avatar (top right) opens the account menu. nav.js ran
// first (shell.html), so whose data the device shows is settled before anything here reads it.
import { spaceChanged } from "../nav.js?v=90";
import { mountTuner, tunerHtml } from "./tuner.js?v=90";
import { mountSongs, mountNextUp, openSong, setOpener } from "./songlist.js?v=90";
import { mountSongView } from "./songview.js?v=90";
import { mountTray } from "./tray.js?v=90";
import { mountAccount } from "./account-menu.js?v=90";
import { ic, fic, device, overlayOpen } from "./chrome.js?v=90";
import { fadeIn } from "./motion.js?v=90";
import { mountPlaces } from "./places.js?v=90";
import { mountRemote } from "./remote.js?v=90";

const $ = (id) => document.getElementById(id);
const version = $("version").textContent.trim();

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
const song = mountSongView({ tuner, version, onLoad: hooks, onLeave: showNextUp, openSongs: () => songs.open(), reprocess: (id) => tray.reprocess(id) });
setOpener((id, opts) => song.open(id, opts));
function hooks() { // (sing.js, play.js, record.js… set their own when they load: the shell's go back on top, with theirs inside)
  window.resonateBusy = () => tray.busy() || song.busy(); // (nav.js: a reload for another tab's sign-in/out waits for it)
  window.resonateDebug = () => ({
    device: device(), tuner: tuner.debug(), import: tray.debug(), eventList: tray.eventList, songs: songs.debug(), song: song.debug(), sing: song.singDebug(), score: song.scoreDebug(), piano: song.pianoDebug(),
    place: places?.debug(), remote: remoteHome?.debug(),
    overlay: document.querySelector("body > .sheet:not([hidden]), #places > .sheet:not([hidden]), .pop:not([hidden])")?.id || (overlayOpen("tuner") ? "tuner" : null),
  });
  remoteHome?.adopt(); // (Sing just loaded: its 📡 hooks go inside the shell's)
}

// --- Record, Voice and Assistants in place; 📡 from home ------------------------------------------
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

// Test hook: read a PDF from a URL (?pdf=…) without the picker; else continue an unfinished import.
const testPdf = new URLSearchParams(location.search).get("pdf");
if (testPdf) {
  fetch(testPdf).then((r) => r.blob()).then((b) => tray.start(new File([b], testPdf.split("/").pop(), { type: "application/pdf" })));
} else tray.resumePending();

// Back from the back/forward cache (a song page's Back): the page as left — sheets closed.
addEventListener("pageshow", (e) => { if (e.persisted) location.reload(); });

// The open song read again on another device (the sync's pull: resonate:remote replaced) — as the
// tray's own conversion does (onReplaced): a PDF only gets its notes and its modules back (Sing
// included), the Piano's range follows. Sing and the Score load the new notes on their own.
addEventListener("resonate:remote", (e) => {
  const r = e.detail?.replaced, id = song.current;
  if (id && r && (typeof r.has === "function" ? r.has(id) : Array.isArray(r) && r.includes(id))) song.reload(id, { self: true });
});

