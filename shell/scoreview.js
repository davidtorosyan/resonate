// The Score inside the shell: today's Play page mounted in place, not rewritten — as singview.js
// does for Sing. play.html's bar (view menu, ▶, ABC, 🎹, − / +, ‹ ›; not its page header: the title,
// links, song menu and badge), its paper (#stage) and its keyboard (#dock) go into the Score's
// region with every id play.js and its tests use; its CSS is scoped under .play-scope (play.html
// styles body and the bar's buttons directly); play.js — and with it Verovio — is imported the
// first time the Score is shown, never before. Another song goes through play.js's own open
// (resonatePlay.open). play.js lays the music out to its stage's box; the shell tells it when the
// region changed size (resize), and play.js's own ResizeObserver catches the rest (a rotation).
import { scopeCss } from "./scopecss.js?v=87";

const $ = (id) => document.getElementById(id);
const sleep = (t) => new Promise((r) => setTimeout(r, t));

// The shell's look for the Score's bar (after the scoped play.html CSS: equal or higher specificity,
// later wins). The paper and the keyboard stay as play.html draws them.
const OVERRIDES = `
.score-root { height: auto; min-height: 0; min-width: 0; flex: 1 1 auto; padding: 0; background: none; display: flex; flex-direction: column; font-family: var(--font); }
.score-root #bar { padding-top: 0; padding-bottom: 8px; gap: 6px; row-gap: 6px; flex-wrap: wrap; }
.score-root #bar .brk, .score-root #bar #song { display: none !important; }
.score-root #bar .ctl { display: flex; order: 0; flex: 1 1 auto; gap: 6px; flex-wrap: wrap; min-width: 0; }
.score-root #bar > *, .score-root #bar .ctl > * { order: 0; margin-top: 0; }
.score-root #bar .pager { margin-left: auto; }
.score-root #bar select, .score-root #bar button { min-height: 44px; border-radius: 12px; background: var(--control); border-color: var(--line-2); font-size: 14px; }
.score-root #bar button { min-width: 44px; }
.score-root #bar #play { background: var(--grad-primary); border-color: transparent; color: #fff; }
.score-root #bar #play[data-icon="stop"] { background: var(--grad-live); }
.score-root #bar #names[data-level="all"] { background: #a64fff; border-color: #a64fff; }
.score-root #bar #names[data-level="some"], .score-root #bar #names[data-level="off"] { background: transparent; }
.score-root #bar #keys[aria-pressed="true"], .score-root #bar #pdf[aria-pressed="true"] { background: rgba(166,79,255,0.28); border-color: #a64fff; }
.score-root #bar #keys { display: none !important; } /* (the dock's Piano toggle drives the keyboard) */
.score-root #stage { border-radius: 0; }
/* (the tuner's chip and Songs in the bar: not play.html's bar buttons) */
.score-root #bar .tuner .tmic { padding: 0; border: 0; background: none; min-width: 44px; min-height: 44px; border-radius: 50%; }
.score-root .corner { flex: none; display: flex; align-items: center; gap: 8px; align-self: center; }
.score-root .corner .round.songs { width: auto; }
.score-root .corner .round .l { display: none; }
.score-root .corner .round .b { width: 48px; height: 48px; }
.score-root #bar .corner .round { padding: 0; border: 0; background: none; min-width: 0; min-height: 0; }
.score-root #bar .corner .round .b { width: 44px; height: 44px; }
.score-root #bar .corner .imptile { border: 0; min-height: 0; background: linear-gradient(180deg,#24244c,#1b1b3a); border-radius: 14px; }
`;

// hooks: { beforeSound() — the tuner parks and Sing stops, before a press or ▶ sounds; quiet() —
// true while Sing records (a press stays silent, ▶ doesn't start); turnKeys() — false when the
// page-turn keys aren't the Score's (it isn't shown, a sheet is open) }; keys(): whether the
// keyboard is on (the dock's Piano toggle) — play.js reads it as its 🎹 setting when it loads
export function mountScore({ version, hooks, keys = () => null, onLoad = () => {} }) {
  const region = $("score-region");
  let mounting = null, loading = null, P = null, playDebug = null;
  const el = {};

  // --- mount play.html once: markup + CSS, no script ------------------------------------------------
  function mount() {
    return (mounting ||= (async () => {
      const res = await fetch(`play.html?v=${encodeURIComponent(version.replace(/^v/, ""))}`);
      if (!res.ok) throw new Error(`The Score didn't load (${res.status})`);
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      const style = document.createElement("style");
      style.id = "play-css";
      style.textContent = scopeCss(doc.querySelector("style")?.textContent || "", { root: ".score-root", scope: ".play-scope" }) + OVERRIDES;
      document.head.append(style);
      const bar = doc.getElementById("bar");
      for (const n of bar.querySelectorAll(".nav, #version, .brk")) n.remove(); // (the page header's: the shell has its own)
      region.append(document.importNode(bar, true), document.importNode(doc.getElementById("stage"), true), document.importNode(doc.getElementById("dock"), true));
      Object.assign(el, { bar: $("bar"), ctl: $("bar").querySelector(".ctl"), pager: $("bar").querySelector(".pager"), play: $("bar").querySelector("#play"),
        hands: $("hands"), names: $("names"), dock: $("dock"), stage: $("stage") });
    })().catch((err) => { mounting = null; throw err; }));
  }
  // --- play.js, the first time the Score is shown -----------------------------------------------------
  function load() {
    return (loading ||= (async () => {
      await mount();
      window.resonatePlay = Object.assign(window.resonatePlay || {}, hooks, { region: true, playBtn: el.play });
      window.resonatePlay.keysOn = !!keys(); // (play.js starts with the Piano toggle's keyboard, so it lays out once — play.html's own 🎹 setting untouched)
      await import("../play.js?v=87");
      P = window.resonatePlay;
      playDebug = window.resonateDebug;
      P.debug = playDebug; // (tests: Play's own resonateDebug, as on play.html)
      onLoad(); // (boot.js puts its own resonateDebug back, with the Score's inside)
      for (let i = 0; i < 100 && !P.state().song; i++) await sleep(100); // (play.js opens the saved song itself)
    })().catch((err) => { if (!P) loading = null; throw err; }));
  }
  // The Score on the song; another song goes through play.js's own open.
  async function open(id) {
    await load();
    if (P.state().song !== id) await P.open(id);
  }
  const stopAll = async () => { try { await P?.stopAll(); } catch (err) { console.warn("score stop", err); } };
  function show(on) { region.hidden = !on; }

  return {
    mount, load, open, stopAll, show, el,
    get loaded() { return !!P; },
    // (synchronous: Sing is about to sound)
    stopSound: () => { if (P) P.stopAll(); },
    state: () => P?.state() || null,
    resize: () => P?.resize(),
    // The keyboard on / off (the Piano toggle); before play.js runs, load() hands it keys().
    setKeys: (on) => { if (P?.keys) P.keys(on); },
    debug: () => (P ? playDebug() : null),
  };
}
