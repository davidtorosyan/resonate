// Sing inside the shell: today's Sing page mounted in place, not rewritten. sing.html's markup is
// read once (its main content into the song region, Listen / Sing into the dock, its sheets into a
// layer at the end of the body, 📡 into the top bar — never its page header), its CSS is scoped
// under .sing-scope (sing.html styles body, header, main, footer… directly), and sing.js is imported
// once; another song goes through sing.js's own song switch (resonateSing.open → selectSong).
// The tuner shrinks while a song is open (strip on a phone, docked elsewhere — only when a song
// opens or closes) and starts parked: a touch that can start sound or a mic in Sing parks it first,
// synchronously, so Sing's handler finds no live track and sets its own audio session.
import { openPage, closePage, openOverlay, closeOverlay, overlayOpen, go, ic, device } from "./chrome.js?v=84";

const $ = (id) => document.getElementById(id);
// Controls in Sing that can't start sound or a mic: a touch there leaves the tuner listening.
const SILENT = "select, #options-btn, #op-close, #co-more, #mo-close, #rv-close, #rv-save, #tt-close, #ta-close, #save-song, #remove-song, #score-btn, #review-btn, #map, #remote-btn, #tt-pad, #ta-pad, #ta-undo, #ta-prevline, #ta-nextline";

// The shell's own look for Sing's insides (after the scoped sing.html CSS: same specificity, later wins).
const OVERRIDES = `
.sing-root { font-family: var(--font); background: none; padding: 0; flex: 1; min-height: 0; overflow: hidden; }
.sing-root .s-main { padding: 0 0 6px; gap: 8px; max-width: 900px; }
.sing-scope .overlay .sheet { position: static; display: block; overflow-x: hidden; left: auto; right: auto; bottom: auto; z-index: auto; }
.sing-scope #getready { z-index: 65; }
.sing-root .controls:first-child { display: none; }
.sing-root .controls { gap: 6px; align-items: center; }
.sing-root .controls select { min-height: 44px; border-radius: 12px; background: var(--control); border: 1px solid var(--line-2); font-size: 14px; padding: 0 8px; }
.sing-root .tool-btn, .sing-scope .rv-head .tool-btn { min-height: 44px; min-width: 44px; border-radius: 12px; background: var(--control); border-color: var(--line-2); font-size: 14px; display: inline-grid; place-items: center; }
.sing-root #status { flex: 0 1 auto; min-width: 0; max-width: 30%; font: 600 11px/1.2 var(--mono); color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sing-root #status:empty { display: none; }
.sing-root .controls .tool-btn { width: 44px; padding: 0; flex: none; }
@media (max-width: 699px) { .sing-root .controls select { font-size: 13px; padding: 0 2px 0 6px; } }
.sing-root #score-btn { gap: 6px; display: inline-flex; align-items: center; justify-content: center; padding: 0 10px; color: var(--text-2); }
.sing-root #score-btn svg { width: 19px; height: 19px; }
.sing-root #score-btn .sl { display: none; }
.sing-root #lane { min-height: 150px; border-radius: 16px; }
.sing-root #coach { border-radius: 16px; }
.sing-root .co-link, .sing-root .co-chip, .sing-root #co-btns button, .sing-root #play, .sing-root .seg button,
.sing-scope .rv-btns button, .sing-scope .mo-row button.mo-from, .sing-scope .mo-tools button, .sing-scope .mo-text { min-height: 44px; }
.sing-scope .overlay .sheet { padding-bottom: calc(1rem + var(--sab)); }
.sing-top { display: inline-flex; align-items: center; gap: 6px; }
.sing-top .remote-btn { min-height: 44px; min-width: 44px; border-radius: 12px; font-size: 14px; }
@media (max-height: 860px) { .sing-root #chips { max-height: 92px; } }
@media (min-width: 700px) { .sing-root #score-btn { width: auto; padding: 0 12px; } .sing-root #score-btn .sl { display: inline; } }
`;

// Rewrite sing.html's CSS under the scope: `body` → the region, `body[…] x` → `body[…] .sing-scope x`,
// `main` → .s-main, everything else → `.sing-scope x`; html / :root / * rules are the shell's.
function scopeCss(text) {
  const tmp = document.createElement("style");
  tmp.media = "not all"; // (parsed, never applied)
  tmp.textContent = text;
  document.head.append(tmp);
  const fix = (s) => s.replace(/(^|[\s>+~(])main(?=$|[\s.#:[>+~),])/g, "$1.s-main");
  const one = (s) => {
    s = s.trim();
    if (s === ":root" || s === "*") return null;
    if (s === "body") return ".sing-root";
    const m = s.match(/^body((?:\[[^\]]*\])*)\s+(.+)$/);
    if (m) return `body${m[1]} .sing-scope ${fix(m[2])}`;
    return /^(html|body)\b/.test(s) ? null : `.sing-scope ${fix(s)}`;
  };
  const split = (sel) => { // top-level commas only
    const out = [];
    let depth = 0, cur = "";
    for (const c of sel) {
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      if (c === "," && !depth) { out.push(cur); cur = ""; } else cur += c;
    }
    return [...out, cur];
  };
  const walk = (rules) => {
    let out = "";
    for (const r of rules) {
      if (r instanceof CSSStyleRule) {
        const parts = split(r.selectorText);
        if (parts.some((p) => p.trim() === "html")) continue; // (html, body: the shell's)
        const sels = parts.map(one).filter(Boolean);
        if (sels.length) out += `${sels.join(", ")} { ${r.style.cssText} }\n`;
      } else if (r instanceof CSSMediaRule) out += `@media ${r.conditionText || r.media.mediaText} {\n${walk(r.cssRules)}}\n`;
      else out += `${r.cssText}\n`; // (keyframes)
    }
    return out;
  };
  const out = walk(tmp.sheet.cssRules);
  tmp.remove();
  return out;
}

export function mountSingView({ tuner, version, onLoad = () => {}, onLeave = () => {}, openSongs = () => {} }) {
  const app = $("app"), region = $("sing-region"), pill = $("song-pill"), brand = $("brand"), top = $("sing-top");
  let loaded = null;   // the load's promise (markup + CSS + sing.js)
  let S = null;        // window.resonateSing once sing.js runs
  let singDebug = null, singBusy = null;
  let isOpen = false, closing = null, watch = 0, title = "";
  const formFor = () => (device() === "phone" ? "strip" : "docked");

  // --- mount sing.html once ------------------------------------------------------------------------
  let mounted = false;
  async function load() {
    if (!mounted) await mount();
    mounted = true;
    await import("../sing.js?v=84");
    S = window.resonateSing;
    singDebug = window.resonateDebug;
    singBusy = window.resonateBusy;
    S.debug = singDebug; // (tests: Sing's own resonateDebug, as on sing.html)
    onLoad(); // (boot.js puts its own resonateDebug / resonateBusy back, with Sing's inside)
  }
  async function mount() {
    const res = await fetch(`sing.html?v=${encodeURIComponent(version.replace(/^v/, ""))}`);
    if (!res.ok) throw new Error(`Sing didn't load (${res.status})`);
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    const style = document.createElement("style");
    style.id = "sing-css";
    style.textContent = scopeCss(doc.querySelector("style")?.textContent || "") + OVERRIDES;
    document.head.append(style);
    const take = (sel) => document.importNode(doc.querySelector(sel), true);
    // The region: Sing's main content; its first row (song menu, Open, Link) stays hidden but works.
    const main = document.createElement("div");
    main.className = "s-main";
    for (const n of doc.querySelector("main").childNodes) main.append(document.importNode(n, true));
    region.append(main);
    const rows = main.querySelectorAll(".controls");
    const head = rows[1];
    head.append($("save-song"), $("remove-song"));
    const score = document.createElement("button");
    score.id = "score-btn";
    score.className = "tool-btn";
    score.type = "button";
    score.title = "Score";
    score.setAttribute("aria-label", "Score");
    score.innerHTML = `${ic("score")}<span class="sl">Score</span>`;
    head.append(score);
    head.append(take("#status"));
    // 📡 and the assistant's chip: the top bar.
    top.append(take("#assistant-chip"), take("#remote-btn"));
    // Listen and Sing: the dock (Songs stays at the right).
    const listen = take("#listen"), sing = take("#sing");
    const lw = document.createElement("span");
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
    document.body.append(layer);

    score.addEventListener("click", async () => { await S?.stopAll(); go("play.html"); });
    // A touch that can start sound or a mic parks the tuner first (capture: before Sing's handlers).
    const park = (e) => {
      if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
      const t = e.target.closest?.("button, a, .chip, .syl, [role=button], input");
      if (t && !t.matches(SILENT)) tuner.park();
    };
    for (const el of [region, layer, lw, sing]) for (const t of ["pointerdown", "keydown"]) el.addEventListener(t, park, true);
    // (and Sing's own starts — a guided round, an assistant's command — call beforeSound)
    window.resonateSing = Object.assign(window.resonateSing || {}, {
      beforeSound: () => tuner.park(),
      onSong: (id, t) => { title = t || ""; pill.querySelector(".t").textContent = title; },
    });
  }

  // --- open / close ---------------------------------------------------------------------------------
  async function open(id) {
    if (closing) await closing;
    openPage("song", { close: leave, back: closeSheet });
    if (isOpen) {
      if (S?.state().song === id) return;
      await S?.stopAll();
      return S?.open(id);
    }
    isOpen = true;
    tuner.park(); // (a song open: the tuner starts parked)
    const form = formFor();
    app.dataset.song = "";
    app.dataset.form = form;
    tuner.setForm(form);
    region.hidden = false;
    top.hidden = false;
    pill.hidden = false;
    pill.querySelector(".t").textContent = title || "…";
    clearInterval(watch);
    watch = setInterval(follow, 100);
    try {
      if (!loaded) {
        loaded = load();
        await loaded;
        for (let i = 0; i < 100 && !S.state().song; i++) await new Promise((r) => setTimeout(r, 100)); // (sing.js opens the saved song itself)
      }
      await loaded;
      if (isOpen && S.state().song !== id) await S.open(id);
    } catch (err) {
      console.error(err);
      if (!S) { loaded = null; closePage(); } // (offline before Sing ever loaded: home again; the next open tries again)
    }
  }
  // Back: Sing's own topmost sheet first (the page stays), then the song.
  function closeSheet() {
    if (overlayOpen()) return false;
    for (const [sheet, btn] of [["getready", null], ["tapalong", "ta-close"], ["taptempo", "tt-close"], ["options", "op-close"], ["more", "mo-close"], ["review", "rv-close"]]) {
      const el = $(sheet);
      if (el && !el.hidden) { btn ? $(btn).click() : el.click(); return true; }
    }
    return false;
  }
  // Leave the song (◎, Back, Close): whatever Sing runs stops first — a take being stopped is
  // finished and saved as on sing.html — then home.
  function leave() {
    if (!isOpen || closing) return closing;
    closing = (async () => {
      try { await S?.stopAll(); } catch (err) { console.warn("sing stop", err); }
      isOpen = false;
      clearInterval(watch);
      dropClose();
      tuner.setHold(null);
      tuner.setForm("full");
      delete app.dataset.song;
      delete app.dataset.form;
      region.hidden = true;
      top.hidden = true;
      pill.hidden = true;
      onLeave();
    })().finally(() => { closing = null; });
    return closing;
  }
  // While Sing holds the sound the tuner's mic button is off: "take" (red) or "paused".
  function follow() {
    if (!S) return;
    const st = S.state();
    tuner.setHold(st.take ? "take" : st.busy ? "paused" : null);
    if (st.busy && tuner.state !== "off") tuner.park(); // (a safety net: every start parks it already)
  }

  brand.addEventListener("click", (e) => {
    if (!isOpen) return;
    e.preventDefault();
    closePage();
  });
  pill.addEventListener("click", () => openSongs());

  // --- the tuner drop: the rest of the strip / docked tuner drops the full tuner over the song -----
  const tEl = $("tuner");
  let dropped = false;
  function dropOpen() {
    if (dropped) return;
    dropped = true;
    tEl.dataset.drop = "";
    tuner.setForm("full");
    openOverlay("tuner", () => { dropped = false; delete tEl.dataset.drop; tuner.setForm(isOpen ? formFor() : "full"); });
  }
  function dropClose() { if (dropped) overlayOpen("tuner") ? closeOverlay() : (dropped = false, delete tEl.dataset.drop); }
  let y0 = null, swiped = 0; // (a swipe up closes it)
  tEl.addEventListener("click", (e) => {
    if (!isOpen || e.target.closest(".tmic, a") || performance.now() - swiped < 500) return;
    dropped ? closeOverlay() : dropOpen();
  });
  tEl.addEventListener("pointerdown", (e) => { y0 = dropped ? e.clientY : null; });
  tEl.addEventListener("pointerup", (e) => {
    if (dropped && y0 !== null && e.clientY - y0 < -40 && overlayOpen("tuner")) { swiped = performance.now(); closeOverlay(); }
    y0 = null;
  });

  return {
    open, leave,
    get isOpen() { return isOpen; },
    busy: () => !!(singBusy?.() || closing),
    debug: () => ({ open: isOpen, loaded: !!S, title, drop: dropped, form: app.dataset.form || "full", state: S?.state() || null }),
    singDebug: () => (isOpen && singDebug ? singDebug() : null),
  };
}
