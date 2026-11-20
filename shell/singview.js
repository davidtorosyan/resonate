// Sing inside the shell: today's Sing page mounted in place, not rewritten. sing.html's markup is
// read once (its main content into the song region, Listen / Sing into the dock, its sheets into a
// layer at the end of the body, 📡 into the top bar — never its page header), its CSS is scoped
// under .sing-scope (sing.html styles body, header, main, footer… directly), and sing.js is imported
// once; another song goes through sing.js's own song switch (resonateSing.open → selectSong).
// Sing's ✕ (remove the song) isn't shown here: the song list's ⋯ deletes (forget.js), and closes the
// song first — Sing's own would leave the shell on a song that's gone.
// The song page around it (songview.js) opens and closes it; a touch that can start sound or a mic
// in Sing parks the tuner and stops the Score first (beforeSound), synchronously, so Sing's handler
// finds no live track and sets its own audio session.
import { scopeCss } from "./scopecss.js?v=90";

const $ = (id) => document.getElementById(id);
// Controls in Sing that can't start sound or a mic: a touch there leaves the tuner listening.
const SILENT = "select, #options-btn, #op-close, #co-more, #mo-close, #rv-close, #rv-save, #tt-close, #ta-close, #save-song, #remove-song, #review-btn, #map, #remote-btn, #tt-pad, #ta-pad, #ta-undo, #ta-prevline, #ta-nextline";

// The shell's own look for Sing's insides (after the scoped sing.html CSS: same specificity, later wins).
const OVERRIDES = `
.sing-root { font-family: var(--font); background: none; padding: 0; flex: 1; min-height: 0; overflow: hidden; }
.sing-root .s-main { padding: 0 0 6px; gap: 8px; max-width: 900px; }
.sing-scope .overlay .sheet { position: static; display: block; overflow-x: hidden; left: auto; right: auto; bottom: auto; z-index: auto; }
.sing-scope #getready { z-index: 65; }
.sing-root .controls:first-child, .sing-scope #remove-song { display: none !important; }
.sing-root .controls { gap: 6px; align-items: center; }
.sing-root .controls select { min-height: 44px; border-radius: 12px; background: var(--control); border: 1px solid var(--line-2); font-size: 14px; padding: 0 8px; }
.sing-root .tool-btn, .sing-scope .rv-head .tool-btn { min-height: 44px; min-width: 44px; border-radius: 12px; background: var(--control); border-color: var(--line-2); font-size: 14px; display: inline-grid; place-items: center; }
.sing-root #status { flex: 0 1 auto; min-width: 0; max-width: 30%; font: 600 11px/1.2 var(--mono); color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sing-root #status:empty { display: none; }
.sing-root .controls .tool-btn { width: 44px; padding: 0; flex: none; }
@media (max-width: 699px) { .sing-root .controls select { font-size: 13px; padding: 0 2px 0 6px; } }
.sing-root #lane { min-height: 150px; border-radius: 16px; }
.sing-root #coach { border-radius: 16px; }
.sing-root .co-link, .sing-root .co-chip, .sing-root #co-btns button, .sing-root #play, .sing-root .seg button,
.sing-scope .rv-btns button, .sing-scope .mo-row button.mo-from, .sing-scope .mo-tools button, .sing-scope .mo-text { min-height: 44px; }
.sing-scope .overlay .sheet { padding-bottom: calc(1rem + var(--sab)); }
.sing-top { display: inline-flex; align-items: center; gap: 6px; }
.sing-top .remote-btn { min-height: 44px; min-width: 44px; border-radius: 12px; font-size: 14px; }
@media (max-height: 860px) { .sing-root #chips { max-height: 92px; } }
`;

// beforeSound(): the tuner parks and the Score stops (a touch or a start that can sound);
// onSong(id, title): sing.js opened a song.
export function mountSing({ version, beforeSound, onSong, onLoad = () => {} }) {
  const region = $("sing-region"), top = $("sing-top");
  let loading = null;  // the load's promise (markup + CSS + sing.js)
  let S = null;        // window.resonateSing once sing.js runs
  let singDebug = null, singBusy = null, lw = null, singBtn = null;

  // --- mount sing.html once ------------------------------------------------------------------------
  let mounted = false;
  function load() {
    return (loading ||= (async () => {
      if (!mounted) await mount();
      mounted = true;
      await import("../sing.js?v=90");
      S = window.resonateSing;
      singDebug = window.resonateDebug;
      singBusy = window.resonateBusy;
      S.debug = singDebug; // (tests: Sing's own resonateDebug, as on sing.html)
      onLoad(); // (boot.js puts its own resonateDebug / resonateBusy back, with Sing's inside)
      for (let i = 0; i < 100 && !S.state().song; i++) await new Promise((r) => setTimeout(r, 100)); // (sing.js opens the saved song itself)
    })().catch((err) => { if (!S) loading = null; throw err; })); // (offline before Sing ever loaded: the next open tries again)
  }
  async function mount() {
    const res = await fetch(`sing.html?v=${encodeURIComponent(version.replace(/^v/, ""))}`);
    if (!res.ok) throw new Error(`Sing didn't load (${res.status})`);
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    const style = document.createElement("style");
    style.id = "sing-css";
    style.textContent = scopeCss(doc.querySelector("style")?.textContent || "", { root: ".sing-root", scope: ".sing-scope", main: ".s-main" }) + OVERRIDES;
    document.head.append(style);
    const take = (sel) => document.importNode(doc.querySelector(sel), true);
    // The region: Sing's main content; its first row (song menu, Open, Link) stays hidden but works.
    const main = document.createElement("div");
    main.className = "s-main";
    for (const n of doc.querySelector("main").childNodes) main.append(document.importNode(n, true));
    region.append(main);
    const rows = main.querySelectorAll(".controls");
    const head = rows[1];
    head.append($("save-song")); // (⤓; ✕ stays in the hidden first row)
    head.append(take("#status"));
    // 📡 and the assistant's chip: the top bar.
    top.append(take("#assistant-chip"), take("#remote-btn"));
    // Listen and Sing: the dock (Songs stays at the right).
    const listen = take("#listen"), sing = take("#sing");
    singBtn = sing;
    lw = document.createElement("span");
    lw.className = "round listen-w";
    lw.id = "listen-w";
    lw.innerHTML = '<span class="bw"></span><span class="l">Listen</span>';
    lw.firstChild.append(listen);
    const corner = document.querySelector(".dock .row .corner");
    corner.before(lw, sing);
    new MutationObserver(() => { // (sing.js writes "▶ Listen" / "■ Stop": the round button shows the glyph, the label the word)
      const stop = listen.textContent.includes("■");
      listen.toggleAttribute("data-stop", stop);
      lw.querySelector(".l").textContent = stop ? "Stop" : "Listen";
    }).observe(listen, { childList: true, characterData: true, subtree: true });
    // The sheets, get-ready and the drop zone: a layer of their own.
    const layer = document.createElement("div");
    layer.className = "sing-scope";
    layer.id = "sing-layer";
    for (const id of ["drop", "getready", "options", "taptempo", "tapalong", "more", "review"]) layer.append(take(`#${id}`));
    document.body.insertBefore(layer, $("places")); // (before Record / Voice / Assistants: sing.js finds its own ids first)

    // A touch that can start sound or a mic parks the tuner and stops the Score first (capture:
    // before Sing's handlers).
    const park = (e) => {
      if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
      const t = e.target.closest?.("button, a, .chip, .syl, [role=button], input");
      if (t && !t.matches(SILENT)) beforeSound();
    };
    for (const el of [region, layer, lw, sing]) for (const t of ["pointerdown", "keydown"]) el.addEventListener(t, park, true);
    // (and Sing's own starts — a guided round, an assistant's command — call beforeSound)
    window.resonateSing = Object.assign(window.resonateSing || {}, { beforeSound, onSong });
  }

  // Sing on the song (loaded the first time); another song goes through sing.js's own switch.
  // → false: Sing didn't open it (a PDF only, a song that can't be read — Sing says so).
  async function open(id) {
    await load();
    if (S.state().song === id) return true;
    return (await S.open(id)) !== false;
  }
  async function stopAll() {
    try { await S?.stopAll(); } catch (err) { console.warn("sing stop", err); }
  }
  // Back: Sing's own topmost sheet first (→ true: one closed, the page stays).
  function closeSheet() {
    for (const [sheet, btn] of [["getready", null], ["tapalong", "ta-close"], ["taptempo", "tt-close"], ["options", "op-close"], ["more", "mo-close"], ["review", "rv-close"]]) {
      const el = $(sheet);
      if (el && !el.hidden) { btn ? $(btn).click() : el.click(); return true; }
    }
    return false;
  }
  const sheetOpen = () => ["getready", "tapalong", "taptempo", "options", "more", "review"].some((id) => { const el = $(id); return el && !el.hidden; });
  // Shown or not (the region, its dock buttons, 📡): the shell's layout decides.
  function show(on) {
    region.hidden = !on;
    top.hidden = !on;
    if (lw) lw.hidden = !on;
    if (singBtn) singBtn.hidden = !on;
  }

  return {
    load, open, stopAll, closeSheet, sheetOpen, show,
    get loaded() { return !!S; },
    state: () => S?.state() || null,
    // (another module sounds: Sing's 🎤 Pitch mic closes now, and listens again once it's quiet)
    hush: (on) => { try { S?.hush?.(on); } catch {} },
    busy: () => !!singBusy?.(),
    debug: () => (S ? singDebug() : null),
  };
}
