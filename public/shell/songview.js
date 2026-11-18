// A song open in the shell, and the modules: Sing (singview.js), the Score (scoreview.js) and the
// Piano (pianoview.js), each on or off with its toggle in the dock beside Songs — any combination,
// none included (the full tuner, the song still open: its pill stays). Which are on is a device pref
// per device class (resonate.shell.modules: a set; a phone opens Sing, a tablet / desktop the
// Score with its keyboard); the Piano toggle shows the keyboard with or without a song: on its own
// above the dock, or — the Score shown — the Score's own docked keyboard (one keyboard, never two).
// Sing and the Score both: side by side from 1024 px, else Sing above. The tuner's form follows
// (REDESIGN §5): no Sing or Score → full; Sing → strip (phone) or docked; both → a strip in the top
// bar (a phone: above the modules); the Score alone → a mic chip in the Score's bar.
// A change stops what sounds first, never during a take. One sound at a time: a touch or a start
// in one module parks the tuner and stops the others first (beforeSound); a press on the Score or
// the Piano while Sing records stays silent. ◎, the pill's ✕, Back and another song stop all first.
// Motion (motion.js): a song's modules slide up from the bottom once they're ready (no blank frame),
// the tuner shrinks into its small form, the wordmark folds; closing reverses it. The avatar, Songs
// and the toggles never move.
import { openPage, closePage, openOverlay, closeOverlay, overlayOpen, device } from "./chrome.js?v=87";
import { mountSing } from "./singview.js?v=87";
import { mountScore } from "./scoreview.js?v=87";
import { mountPiano, rangeOf } from "./pianoview.js?v=87";
import { settle, slideIn, slideOut, fadeIn, fadeOut, ghost, morph, glide, drop, running } from "./motion.js?v=87";
import { loadSong } from "../catalog.js?v=87";
import { parseMusicXml } from "../musicxml.js?v=87";
import { titleOf } from "./songlist.js?v=87";

const $ = (id) => document.getElementById(id);
const PREF = "resonate.shell.modules"; // { phone | tablet | desktop: ["sing", "score", "piano"] } — this device's
const DEFAULTS = { phone: ["sing"], tablet: ["score", "piano"], desktop: ["score", "piano"] };
const KEYS = ["sing", "score", "piano"];
const READY_MS = 2500; // a module's first load is waited for this long before it slides in
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
const sleep = (t) => new Promise((r) => setTimeout(r, t));

function readPref() { try { return JSON.parse(localStorage.getItem(PREF) || "{}") || {}; } catch { return {}; } }
// (v86 kept "sing" | "score" | "both"; the Score's keyboard was its 🎹 setting — on a tablet or a
// desktop unless turned off — so it becomes the Piano)
export function savedMods(dev) {
  const v = readPref()[dev];
  let list = null;
  if (Array.isArray(v)) list = v.filter((k) => KEYS.includes(k));
  else if (v === "sing" || v === "score" || v === "both") {
    let k = null;
    try { k = localStorage.getItem("resonate.play.keys"); } catch {}
    list = v === "sing" ? ["sing"] : v === "score" ? ["score"] : ["sing", "score"];
    if (v !== "sing" && (k === "on" || (k !== "off" && dev !== "phone"))) list.push("piano");
  }
  const set = list || DEFAULTS[dev] || DEFAULTS.desktop;
  return { sing: set.includes("sing"), score: set.includes("score"), piano: set.includes("piano") };
}
function saveMods(dev, m) {
  try {
    const o = readPref();
    o[dev] = KEYS.filter((k) => m[k]);
    localStorage.setItem(PREF, JSON.stringify(o));
  } catch {}
}

export function mountSongView({ tuner, version, onLoad = () => {}, onLeave = () => {}, openSongs = () => {} }) {
  const app = $("app"), pill = $("song-pill"), brand = $("brand"), tEl = $("tuner"), home = document.querySelector(".home"), stack = $("stack");
  const singEl = $("sing-region"), scoreEl = $("score-region");
  const tog = { sing: $("mod-sing"), score: $("mod-score"), piano: $("mod-piano") };
  const dockRow = document.querySelector(".dock .row"), corner = dockRow.querySelector(".corner"), nextup = $("nextup");
  let isOpen = false, closing = null, switching = null, watch = 0, title = "", titleId = null, current = null, gen = 0;
  let dev = device(), mods = savedMods(dev);
  let intent = mods, queued = null; // (the set the toggles show — taps while a change runs queue the latest)

  const sing = mountSing({
    version, onLoad,
    beforeSound: () => { tuner.park(); score.stopSound(); piano.stopAll(); },
    onSong: (id, t) => { if (id === current) setTitle(t, id); },
  });
  const score = mountScore({
    version, onLoad,
    keys: () => mods.piano,
    hooks: {
      beforeSound: () => { tuner.park(); sing.hush(true); if (sing.state()?.busy) sing.stopAll(); },
      quiet: () => !!sing.state()?.take,
      turnKeys: () => isOpen && mods.score && !overlayOpen() && !sing.sheetOpen(),
    },
  });
  const piano = mountPiano($("piano-region"), {
    tuner,
    beforeSound: () => { sing.hush(true); if (sing.state()?.busy) sing.stopAll(); }, // (Sing's 🎤 Pitch mic too: iOS plays quietly while it's open)
    quiet: () => !!sing.state()?.take,
    busy: () => !!(sing.state()?.busy || score.state()?.busy),
  });
  const setTitle = (t, id = current) => { title = t || ""; titleId = title ? id : null; pill.querySelector(".t").textContent = title || "…"; };

  // --- what shows -------------------------------------------------------------------------------
  // (sing / score: the regions; piano: the keyboard on its own; keys: the Score's own keyboard)
  const want = () => {
    const s = isOpen && mods.sing, c = isOpen && mods.score;
    return { sing: s, score: c, piano: mods.piano && !c, keys: c && mods.piano };
  };
  const formOf = (w) => (!w.sing && !w.score ? "full" : !w.sing ? (score.el.names ? "chip" : "strip") : w.score ? "strip" : dev === "phone" ? "strip" : "docked");
  const placeOf = (w, form) => (form === "chip" ? "bar" : w.sing && w.score && innerWidth >= 700 ? "top" : "home");
  function placeTuner(w) {
    const form = formOf(w), place = placeOf(w, form);
    if (place === "bar") { if (tEl.previousElementSibling !== score.el.names) score.el.names.after(tEl); }
    else if (place === "top") { if (tEl.previousElementSibling !== pill) pill.after(tEl); }
    else if (tEl.parentNode !== home) home.prepend(tEl);
    if (!dropped) tuner.setForm(form);
    app.dataset.form = form;
    app.dataset.tin = place;
  }
  // The Score alone: its ▶ Play is the dock's primary (with Sing shown it stays in the Score's bar).
  function placePlay(w) {
    const { play, hands } = score.el;
    if (!play) return;
    const inDock = w.score && !w.sing;
    if (inDock && play.parentNode !== dockRow) corner.before(play);
    else if (!inDock && play.parentNode === dockRow) hands.after(play);
  }
  // Everything for `w`, at once (no motion: render() wraps it).
  let laid = null; // (what apply() last laid out: an open overtaken before its render leaves it behind)
  const laidOut = () => { const w = want(); return !!laid && laid.open === isOpen && ["sing", "score", "piano", "keys"].every((k) => laid[k] === w[k]); };
  function apply(w) {
    laid = { ...w, open: isOpen };
    dev = device();
    app.toggleAttribute("data-song", isOpen);
    app.toggleAttribute("data-sing", w.sing);
    app.toggleAttribute("data-score", w.score);
    app.toggleAttribute("data-piano", w.piano || w.keys);
    app.dataset.dev = dev;
    sing.show(w.sing);
    score.show(w.score);
    if (w.score) score.setKeys(w.keys);
    piano.show(w.piano);
    placeTuner(w);
    placePlay(w);
    pill.hidden = !isOpen;
    if (isOpen) nextup.hidden = true;
    tog.sing.hidden = tog.score.hidden = !isOpen;
    pressed();
  }
  function pressed() {
    for (const k of KEYS) tog[k].setAttribute("aria-pressed", String(!!intent[k]));
  }
  // The dock's and top bar's own: what may come or go with a change (faded, never slid).
  const fades = () => [$("rec-btn"), $("main-btn"), $("listen-w"), dockRow.querySelector("#sing"), nextup, pill, tog.sing, tog.score, $("sing-top"), $("home-remote")].filter(Boolean);
  const shown = (el) => !!el && el.getClientRects().length > 0;

  // Lay out for the state now, with motion: regions that go slide down (held where they were),
  // regions that come slide up from the bottom, the tuner shrinks or grows into its new form, the
  // dock's buttons fade; nothing of the chrome moves.
  function render({ motion = true } = {}) {
    settle();
    const w = want();
    const anim = motion && !document.hidden;
    if (!anim) { apply(w); return; }
    const was = { sing: !singEl.hidden, score: !scoreEl.hidden, piano: !piano.el.hidden };
    const form0 = app.dataset.form, place0 = app.dataset.tin, r0 = tEl.getBoundingClientRect();
    const formN = formOf(w), placeN = placeOf(w, formN);
    const tGhost = !dropped && (formN !== form0 || placeN !== place0) ? ghost(tEl, app) : null;
    const before = fades().map((el) => [el, shown(el), shown(el) ? ghost(el) : null]);
    const playParent = score.el.play?.parentNode;
    // what goes: held where it is and slid out
    if ((was.sing || was.score) && !w.sing && !w.score) {
      for (const el of [singEl, scoreEl]) if (!el.hidden) el.dataset.leaving = "";
      slideOut(stack, () => { delete singEl.dataset.leaving; delete scoreEl.dataset.leaving; });
    } else {
      if (was.sing && !w.sing) slideOut(singEl, () => {});
      if (was.score && !w.score) slideOut(scoreEl, () => {});
    }
    if (was.piano && !w.piano) slideOut(piano.el, () => {});
    apply(w);
    // what comes
    if (!was.sing && w.sing) slideIn(singEl);
    if (!was.score && w.score) slideIn(scoreEl, { delay: !was.sing && w.sing ? 40 : 0 });
    if (!was.piano && w.piano) slideIn(piano.el);
    if (tGhost) morph(tGhost, tEl);
    else if (!dropped) glide(tEl, r0);
    for (const [el, vis0, gh] of before) {
      if (shown(el)) { drop(gh); if (!vis0) fadeIn(el, { delay: 60 }); }
      else fadeOut(gh);
    }
    if (score.el.play && score.el.play.parentNode !== playParent && shown(score.el.play)) fadeIn(score.el.play, { delay: 60 });
  }

  // The modules shown, on the current song (each loaded the first time it shows: Verovio only then).
  async function ensure() {
    const id = current, jobs = [];
    if (mods.sing) jobs.push(sing.open(id));
    if (mods.score) jobs.push(score.mount().then(() => { if (isOpen && current === id) { placeTuner(want()); placePlay(want()); } return score.open(id); }));
    const res = await Promise.allSettled(jobs);
    for (const r of res) if (r.status === "rejected") console.error(r.reason);
    return res;
  }
  // Ready to slide in: Sing loaded with the song open, the Score's markup in (play.js follows) — or
  // READY_MS passed.
  async function ready(w, id) {
    const jobs = [];
    if (w.sing) jobs.push(sing.open(id));
    if (w.score) jobs.push(score.mount());
    if (!jobs.length) return;
    await Promise.race([Promise.allSettled(jobs), sleep(READY_MS)]);
  }
  const stopSounds = async () => {
    piano.stopAll();
    await Promise.all([sing.stopAll(), score.stopAll()]);
  };
  // (refused: a take runs — the toggle says so with a shake)
  const shake = (b) => { try { b.animate([{ transform: "translateX(0)" }, { transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "translateX(0)" }], { duration: 220 }); } catch {} };

  // Turn modules on or off: what sounds stops first; never during a take.
  async function setMods(next, { save = true, btn = null } = {}) {
    if (closing) return;
    if (sing.state()?.take) { intent = mods; pressed(); if (btn) shake(btn); return; }
    intent = next;
    pressed();
    if (save) saveMods(dev, save === true ? next : save); // (a tap: the saved set with that one change — a set opened for one song stays unsaved)
    if (switching) { queued = next; return; } // (the latest tap wins, once this change is done)
    switching = (async () => {
      const g = gen;
      await stopSounds();
      mods = next;
      pressed();
      if (isOpen) await ready({ sing: next.sing && !laid?.sing, score: next.score && !laid?.score }, current);
      if (g !== gen || mods !== next) return;
      render();
      await frame();
      score.resize(); // (laid out once at the region's new size, not 150 ms later)
      updateRange();
      if (isOpen) await ensure();
    })().finally(() => {
      switching = null;
      const q = queued;
      queued = null;
      if (q && KEYS.some((k) => !!q[k] !== !!mods[k])) setMods(q, { save: false });
    });
    return switching;
  }
  for (const k of KEYS) tog[k].addEventListener("click", () => { const on = !intent[k]; setMods({ ...intent, [k]: on }, { btn: tog[k], save: { ...savedMods(dev), [k]: on } }); });

  // --- the Piano's range: the open song's melody in whole octaves (C3–B5 at least) ------------------
  const ranges = new Map();
  let rangeFor = undefined;
  async function melodyRange(id) {
    if (ranges.has(id)) return ranges.get(id);
    let midis = null;
    try { if (window.resonateSing?.state?.().song === id) midis = window.resonateSing.debug?.()?.notes?.map((n) => n.midi); } catch {}
    if (!midis?.length) {
      try { const s = await loadSong(id); midis = s ? parseMusicXml(s.xml, s.title).notes.map((n) => n.midi) : []; } catch { midis = []; }
    }
    const r = rangeOf(midis);
    ranges.set(id, r);
    return r;
  }
  async function updateRange() {
    if (!piano.shown) return;
    const id = isOpen ? current : null;
    if (id === rangeFor) return;
    rangeFor = id;
    const r = id ? await melodyRange(id) : rangeOf([]);
    if (rangeFor === id) piano.setRange(r);
  }

  // --- open / close ---------------------------------------------------------------------------------
  // opts.sing / opts.score: open with Sing / the Score shown (Next-up advertises a singing step:
  // REDESIGN D2; the Reader's Sing it / Play it, an assistant's command) — for this song, not saved;
  // on a phone the other one gives way.
  // (the pill's title from the song list until Sing or the Score names it — with neither shown, nothing else would)
  const nameIt = (id) => { if (titleId !== id) titleOf(id).then((t) => { if (t && current === id && titleId !== id) setTitle(t, id); }); };
  const withMod = (m, k) => ({ ...m, [k]: true, ...(dev === "phone" ? { [k === "sing" ? "score" : "sing"]: false } : {}) });
  async function open(id, { sing: withSing = false, score: withScore = false } = {}) {
    if (closing) await closing;
    if (switching) await switching;
    openPage("song", { close: leave, back: closeSheet });
    if (isOpen) {
      const k = withSing && !mods.sing ? "sing" : withScore && !mods.score ? "score" : null;
      if (current === id) { if (k) await setMods(withMod(mods, k), { save: false }); return; }
      const g = ++gen;
      await stopSounds();
      while (switching) await switching.catch(() => {}); // (a change under way gives way to this open — or finishes — first)
      if (g !== gen) return;
      current = id;
      setTitle(titleId === id ? title : "");
      nameIt(id);
      updateRange();
      if (k) return setMods(withMod(mods, k), { save: false }); // (its modules open the new song)
      if (!laidOut()) return layOut(g, id); // (an open — or a change — still waiting to lay out was overtaken: this one does it)
      return ensure();
    }
    const g = ++gen;
    isOpen = true;
    current = id;
    dev = device();
    mods = savedMods(dev);
    if (withSing && !mods.sing) mods = withMod(mods, "sing");
    else if (withScore && !mods.score) mods = withMod(mods, "score");
    intent = mods;
    tuner.park(); // (a song open: the tuner starts parked)
    piano.stopAll();
    setTitle(titleId === id ? title : "");
    nameIt(id);
    // the pill at once; the modules (and their toggles) once they're ready
    pill.hidden = false;
    pill.toggleAttribute("data-loading", true);
    fadeIn(pill, { from: "translateX(-10px)" });
    clearInterval(watch);
    watch = setInterval(follow, 100);
    return layOut(g, id);
  }
  // Laid out once the modules are ready — by the newest open (an older one still waiting gives way).
  async function layOut(g, id) {
    pill.toggleAttribute("data-loading", true);
    await ready(want(), id);
    if (g !== gen || !isOpen) return;
    pill.removeAttribute("data-loading");
    render();
    await frame();
    score.resize();
    updateRange();
    const res = await ensure();
    if (g === gen && !sing.loaded && !score.loaded && res.some((r) => r.status === "rejected")) closePage(); // (offline before either ever loaded: home again)
  }
  // Back: Sing's own topmost sheet first (the page stays), then the song.
  function closeSheet() {
    if (overlayOpen()) return false;
    return sing.closeSheet();
  }
  // Leave the song (◎, ✕, Back): whatever runs stops first — a take being stopped is finished and
  // saved as on sing.html — then home: the modules slide down, the tuner grows back.
  function leave() {
    if (!isOpen || closing) return closing;
    closing = (async () => {
      gen++;
      if (switching) await switching.catch(() => {});
      await stopSounds();
      isOpen = false;
      mods = intent = savedMods(dev); // (a set opened for that song only ends with it)
      clearInterval(watch);
      dropClose();
      tuner.setHold(null);
      pill.removeAttribute("data-loading");
      render();
      updateRange();
      onLeave();
    })().finally(() => { closing = null; });
    return closing;
  }
  // While a module holds the sound the tuner's mic button is off: "take" (red) or "paused".
  function follow() {
    const st = sing.state(), sc = score.state();
    const busy = !!(st?.busy || sc?.busy);
    tuner.setHold(st?.take ? "take" : busy ? "paused" : null);
    sing.hush(piano.held() > 0 || !!(sc?.busy || sc?.held)); // (Sing's 🎤 Pitch listens again once the Piano and the Score are quiet)
    if (busy && tuner.state !== "off") tuner.park(); // (a safety net: every start parks it already)
    if (mods.score && !mods.sing && sc?.song === current && sc.title && titleId !== current) setTitle(sc.title); // (Sing names it when it shows)
  }
  brand.addEventListener("click", (e) => {
    if (!isOpen) return;
    e.preventDefault();
    closePage();
  });
  $("song-title").addEventListener("click", () => openSongs());
  $("song-close").addEventListener("click", () => closePage());
  // A rotation or a window crossing a size class: that class's modules, laid out again.
  addEventListener("resize", () => {
    if (switching || closing) return;
    if (device() !== dev) { mods = intent = savedMods(device()); render({ motion: false }); updateRange(); }
    else if (placeOf(want(), formOf(want())) !== app.dataset.tin) placeTuner(want());
  });

  // --- the tuner drop: the rest of a small tuner drops the full tuner over the song ------------------
  let dropped = false;
  function dropOpen() {
    if (dropped) return;
    dropped = true;
    tEl.dataset.drop = "";
    tuner.setForm("full");
    openOverlay("tuner", () => { dropped = false; delete tEl.dataset.drop; tuner.setForm(app.dataset.form || "full"); });
  }
  function dropClose() { if (dropped) overlayOpen("tuner") ? closeOverlay() : (dropped = false, delete tEl.dataset.drop); }
  let y0 = null, swiped = 0; // (a swipe up closes it)
  tEl.addEventListener("click", (e) => {
    if (!isOpen || e.target.closest(".tmic, a") || performance.now() - swiped < 500) return;
    if (!dropped && app.dataset.form === "full") return; // (the full tuner already)
    dropped ? closeOverlay() : dropOpen();
  });
  tEl.addEventListener("pointerdown", (e) => { y0 = dropped ? e.clientY : null; });
  tEl.addEventListener("pointerup", (e) => {
    if (dropped && y0 !== null && e.clientY - y0 < -40 && overlayOpen("tuner")) { swiped = performance.now(); closeOverlay(); }
    y0 = null;
  });

  // Home as the page loads: the Piano if it's on for this device class.
  apply(want());
  updateRange();

  return {
    open, leave, setMods, stopAll: stopSounds,
    get isOpen() { return isOpen; },
    get current() { return isOpen ? current : null; },
    get title() { return title; },
    get mods() { return { ...mods }; },
    sing,
    busy: () => !!(sing.busy() || score.state()?.busy || closing || switching),
    debug: () => {
      const st = sing.state(), sc = score.state();
      return { open: isOpen, loaded: sing.loaded, scoreLoaded: score.loaded, title, drop: dropped, form: app.dataset.form || "full", tin: app.dataset.tin,
        moving: running(), switching: !!switching, closing: !!closing, laid: app.hasAttribute("data-song"),
        mods: isOpen ? (mods.sing && mods.score ? "both" : mods.sing ? "sing" : mods.score ? "score" : "none") : null, set: { ...mods }, dev,
        state: isOpen || st ? { ...(st || {}), song: current ?? st?.song ?? null, busy: !!(st?.busy || sc?.busy), take: !!st?.take } : null, score: sc };
    },
    singDebug: () => (isOpen ? sing.debug() : null),
    scoreDebug: () => score.debug(),
    pianoDebug: () => piano.debug(),
  };
}
