// Resonate on one page (preview): the shell's entry. Home is the full tuner with the Next-up card;
// Songs (bottom right) holds the song list and + Add; a PDF is read in the background (the Reader
// tray); the avatar (top right) opens the account menu. nav.js ran first (shell.html), so whose
// data the device shows is settled before anything here reads it.
import { spaceChanged } from "../nav.js?v=84";
import { mountTuner, tunerHtml } from "./tuner.js?v=84";
import { mountSongs, mountNextUp, openSong, setOpener } from "./songlist.js?v=84";
import { mountSingView } from "./singview.js?v=84";
import { mountTray } from "./tray.js?v=84";
import { mountAccount } from "./account-menu.js?v=84";
import { ic, fic, device, overlayOpen } from "./chrome.js?v=84";

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
const tray = mountTray({ version, spaceChanged, openSong: (id) => openSong(id), onChange: () => songs.render() });
const songs = mountSongs({ tray });
const nextUp = $("nextup");
const showNextUp = () => mountNextUp(nextUp).catch(() => { nextUp.hidden = true; });
showNextUp();
mountAccount({ version });

// --- a song opens in place with Sing ------------------------------------------------------------
const sing = mountSingView({ tuner, version, onLoad: hooks, onLeave: showNextUp, openSongs: () => songs.open() });
setOpener((id) => sing.open(id));
function hooks() { // (sing.js sets its own when it loads: the shell's go back on top, with Sing's inside)
  window.resonateBusy = () => tray.busy() || sing.busy(); // (nav.js: a reload for another tab's sign-in/out waits for it)
  window.resonateDebug = () => ({
    device: device(), tuner: tuner.debug(), import: tray.debug(), eventList: tray.eventList, song: sing.debug(), sing: sing.singDebug(),
    overlay: document.querySelector("body > .sheet:not([hidden]), .pop:not([hidden])")?.id || (overlayOpen("tuner") ? "tuner" : null),
  });
}
hooks();

// Test hook: read a PDF from a URL (?pdf=…) without the picker; else continue an unfinished import.
const testPdf = new URLSearchParams(location.search).get("pdf");
if (testPdf) {
  fetch(testPdf).then((r) => r.blob()).then((b) => tray.start(new File([b], testPdf.split("/").pop(), { type: "application/pdf" })));
} else tray.resumePending();

// Back from the back/forward cache (a song page's Back): the page as left — sheets closed.
addEventListener("pageshow", (e) => { if (e.persisted) location.reload(); });

