// Record, Voice and Assistants in place: each page's markup mounted once in a full-height sheet
// over the shell — its <main> (and Record's footer, Voice's test card), never its page header —
// with its CSS scoped under the sheet (scopecss.js, as Sing and the Score are), and its script
// imported the first time it opens. One history entry (chrome.js openOverlay): Back, ✕ or Escape
// close it, and closing stops what it was doing — a Record take stops and is kept, Voice's range
// or volume test stops, a note that sounds is cut. Before Record or Voice can open the mic the
// tuner parks and every other sound stops (the sheet covers the rest of the shell); each sleeps
// when the page is hidden on its own (record.js / voice.js visibilitychange, as on their pages).
// Their scripts look their elements up in the sheet first (window.resonateRecord / resonateVoice /
// resonateAssistants .root — sing.html has a #play and a #status, play.html a #strip).
import { scopeCss } from "./scopecss.js?v=95";
import { ic, openOverlay, closeOverlay, overlayOpen, staleShell, pageOpen } from "./chrome.js?v=95";
import { reduced } from "./motion.js?v=95";

const $ = (id) => document.getElementById(id);
const PROFILES = "resonate.profiles";
const setSession = (type) => { try { if (navigator.audioSession) navigator.audioSession.type = type; } catch {} };
const readProfiles = () => { try { return localStorage.getItem(PROFILES); } catch { return null; } };

// (scope: the class the page's CSS is scoped under; main: what its <main> becomes; body: a scroller
// around it — Record lays its page out to the height, the others scroll)
const PLACES = {
  record: { page: "record.html", title: "Record", hook: "resonateRecord", scope: "rec", mic: true, body: false, extra: ["footer"],
    load: () => import("../record.js?v=95") },
  voice: { page: "voice.html", title: "Voice", hook: "resonateVoice", scope: "voice", mic: true, body: true, extra: ["#test"],
    load: () => import("../voice.js?v=95") },
  assistants: { page: "assistants.html", title: "Assistants", hook: "resonateAssistants", scope: "asst", mic: false, body: true, extra: [],
    load: () => import("../assistants.js?v=95") },
};
// A link's place: the shell's own address for it (./?open=voice), or — for one more release — its
// old page (voice.html).
export function placeOf(href) {
  const h = String(href || "").replace(/^\.\//, "");
  const m = /^(?:index\.html)?\?(?:[^#]*&)?open=([a-z]+)(?:[&#]|$)/.exec(h);
  const name = m ? m[1] : Object.keys(PLACES).find((k) => PLACES[k].page === h.split(/[?#]/)[0]);
  return name && Object.hasOwn(PLACES, name) ? name : null;
}

// The shell's frame for a page (after its scoped CSS: higher specificity, so it wins).
const CSS = `
.sheet.place { top: 0; z-index: 62; border-radius: 0; box-shadow: none; padding-bottom: 0; font-family: var(--font); }
.sheet.place .place-head { display: flex; align-items: center; gap: 10px; flex: none; min-height: 56px;
  padding: 6px calc(var(--gutter) + env(safe-area-inset-right)) 4px calc(16px + env(safe-area-inset-left)); }
.sheet.place .place-head h2 { margin: 0; font: 800 24px/1 var(--display); letter-spacing: -.02em; color: var(--text); opacity: 1; }
.sheet.place .place-head .pst { flex: 1; min-width: 0; font: 600 11px/1.2 var(--mono); color: var(--text-3); opacity: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sheet.place .place-x { width: 44px; height: 44px; min-width: 44px; padding: 0; margin-left: auto; display: grid; place-items: center; flex: none;
  border-radius: 12px; border: 1px solid var(--line-2); background: var(--control); color: var(--text); }
.sheet.place .place-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
.sheet.place .r-main { padding-left: calc(1rem + env(safe-area-inset-left)); padding-right: calc(1rem + env(safe-area-inset-right)); }
.rec-scope #rec { min-height: 52px; }
.rec-scope .chip-btn, .rec-scope .seg button, .rec-scope #play { min-height: 40px; }
.voice-scope .primary, .asst-scope .primary { display: inline-block; height: auto; font: inherit; font-weight: 600; }
.voice-scope button, .voice-scope select, .voice-scope input { min-height: 40px; }
.asst-scope button, .asst-scope select { min-height: 40px; }
`;

// onBefore(): the tuner parks and every other sound stops (Record and Voice: the mic is theirs now);
// onLoad(): a page's script ran (boot.js puts its own resonateDebug back).
// idle(): nothing else has the mic or the sound now (the audio session may go back to "auto").
export function mountPlaces({ onBefore = () => {}, onLoad = () => {}, onClose = () => {}, idle = () => true } = {}) {
  const host = $("places");
  const els = {}, mounting = {}, loading = {}, debugs = {};
  let current = null, gen = 0, profiles0 = null;
  const anims = new Map(); // (each sheet's slide now)

  async function mount(name) {
    const P = PLACES[name];
    return (mounting[name] ||= (async () => {
      const v = ($("version")?.textContent || "").trim().replace(/^v/, "");
      const res = await fetch(`${P.page}?v=${encodeURIComponent(v)}`);
      if (!res.ok) throw new Error(`${P.title} didn't load (${res.status})`);
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      // (another version: reloading — not with a song open: the address can't carry the song and the
      // place both, and the song would be gone; mounted in place then, as before)
      if (!pageOpen() && staleShell(doc, name)) return new Promise(() => {});
      if (!$("place-css")) {
        const st = document.createElement("style");
        st.id = "place-css";
        document.head.append(st);
      }
      const style = document.createElement("style");
      style.id = `place-css-${name}`;
      style.textContent = scopeCss(doc.querySelector("style")?.textContent || "", { root: `.${P.scope}-root`, scope: `.${P.scope}-scope`, main: `.${P.scope}-main` });
      $("place-css").before(style); // (the shell's frame stays last: it wins)
      $("place-css").textContent = CSS;
      const el = document.createElement("section");
      el.className = `sheet place ${P.scope}-root ${P.scope}-scope`;
      el.id = `place-${name}`;
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-label", P.title);
      el.hidden = true;
      const head = document.createElement("div");
      head.className = "place-head";
      const h = document.createElement("h2");
      h.textContent = P.title;
      head.append(h);
      const status = doc.getElementById("status");
      if (status) { const s = document.importNode(status, true); s.classList.add("pst"); head.append(s); }
      const x = document.createElement("button");
      x.type = "button";
      x.className = "place-x";
      x.setAttribute("aria-label", "Close");
      x.innerHTML = ic("close");
      x.addEventListener("click", () => close());
      head.append(x);
      const main = document.createElement("div");
      main.className = `${P.scope}-main`;
      for (const n of doc.querySelector("main").childNodes) main.append(document.importNode(n, true));
      el.append(head);
      if (P.body) {
        const body = document.createElement("div");
        body.className = "place-body";
        body.append(main);
        el.append(body);
      } else el.append(main);
      for (const sel of P.extra) { const n = doc.querySelector(sel); if (n) el.append(document.importNode(n, true)); }
      host.append(el);
      els[name] = el;
      return el;
    })().catch((err) => { mounting[name] = null; throw err; }));
  }
  // The page's script, once (it binds its elements as it runs: never twice).
  function load(name) {
    const P = PLACES[name];
    return (loading[name] ||= (async () => {
      window[P.hook] = Object.assign(window[P.hook] || {}, { root: els[name], gone: () => current !== name });
      await P.load();
      debugs[name] = window.resonateDebug;
      onLoad();
    })().catch((err) => { loading[name] = null; throw err; }));
  }

  // In from the bottom, or out and then hidden (`after`); reduced motion: a fade.
  function slide(el, inn, after = null) {
    anims.get(el)?.cancel();
    const kf = reduced() ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: "translateY(100%)" }, { transform: "none" }];
    const a = el.animate(inn ? kf : kf.slice().reverse(), { duration: reduced() ? 150 : inn ? 300 : 240, easing: inn ? "cubic-bezier(.22,.8,.24,1)" : "cubic-bezier(.5,0,.75,.4)", fill: inn ? "backwards" : "forwards" });
    anims.set(el, a);
    a.oncancel = () => { if (anims.get(el) === a) anims.delete(el); };
    a.onfinish = () => {
      if (anims.get(el) === a) anims.delete(el);
      after?.();
      if (!inn) a.cancel(); // (hidden first: no frame of it back in place)
    };
  }

  // Open a place (from the dock, the account menu, a link to its page).
  async function open(name) {
    const P = PLACES[name];
    if (!P) return;
    if (current === name && overlayOpen(name)) return;
    const g = ++gen;
    if (P.mic) onBefore(); // (synchronously: the tuner's tracks stop now)
    const el = await mount(name);
    if (g !== gen) return;
    current = name;
    if (name === "voice") profiles0 = readProfiles();
    el.hidden = false;
    openOverlay(name, () => hide(name));
    if (!document.hidden) slide(el, true);
    el.querySelector(".place-x").focus({ preventScroll: true });
    if (loading[name]) { // (opened before: shown as it is now)
      await loading[name].catch(() => {});
      if (name === "voice") window.resonateVoice?.render?.();
      if (name === "assistants") window.resonateAssistants?.refresh?.();
      return;
    }
    try { await load(name); } catch (err) { console.error(err); }
  }
  // Closed (✕, Back, Escape, another sheet or a song taking its place): what it does stops.
  function hide(name) {
    const P = PLACES[name], el = els[name];
    if (current === name) current = null;
    gen++;
    const stopped = Promise.resolve(window[P.hook]?.stopAll?.()).catch((err) => console.warn(name, err));
    if (P.mic) stopped.then(() => { if (!PLACES[current]?.mic && idle()) setSession("auto"); }); // (as its page does on pagehide — unless a take started meanwhile)
    if (name === "voice" && readProfiles() !== profiles0) stopped.then(() => onClose("profiles"));
    if (!el) return;
    if (document.hidden || el.hidden) { anims.get(el)?.cancel(); el.hidden = true; return; }
    slide(el, false, () => { if (current !== name) el.hidden = true; });
  }
  function close() { if (current && overlayOpen(current)) closeOverlay(); }

  // A link to one of these pages anywhere in the shell (the dock's Record, the account menu, the
  // tuner's range and level, Sing's "Set your range") opens it here instead.
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.("a[href]");
    const name = a && !a.target && placeOf(a.getAttribute("href"));
    if (!name || a.closest(".sheet.place")) return;
    e.preventDefault();
    e.stopPropagation();
    open(name);
  }, true);

  return {
    open, close,
    get current() { return current; },
    debug: () => ({ open: current, shown: Object.keys(els).filter((k) => !els[k].hidden), loaded: Object.keys(loading).filter((k) => debugs[k]),
      record: debugs.record && window.resonateRecord?.state?.(), voice: debugs.voice && { ...window.resonateVoice?.state?.(), ...debugs.voice() },
      assistants: debugs.assistants && debugs.assistants() }),
  };
}
