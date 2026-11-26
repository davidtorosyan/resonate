// A song open in the shell, and the modules: Sing (singview.js), the Score (scoreview.js) and the
// Piano (pianoview.js), each on or off with its toggle in the dock beside Songs — any combination,
// none included (the full tuner, the song still open: its pill stays). Which are on is a device pref
// per device class (resonate.shell.modules: a set; a phone opens Sing, a tablet / desktop the
// Score with the Piano); the Piano toggle shows the keyboard with or without a song, above the dock:
// one keyboard, where it is whether the Score comes or goes (the Score is laid out above it, as Sing
// is) — linked to the Score while the Score shows (pianoview.js: the Score's keys, range and ▶),
// its own otherwise. The Piano coming or going under the Score keeps what's shown (play.js holds the
// layout, drawn smaller: the same bars on the same page — Sing's narrower column does the same).
// Sing and the Score both: side by side from 1024 px, else Sing above. The tuner's form follows
// (REDESIGN §5): no Sing or Score → full; Sing → strip (phone) or docked; both → a strip in the top
// bar (a phone: above the modules); the Score alone → a mic chip in the Score's bar.
// A change stops what sounds first, never during a take. One sound at a time: a touch or a start
// in one module parks the tuner and stops the others first (beforeSound); a press on the Score or
// the Piano while Sing records stays silent. ◎, the pill's ✕, Back and another song stop all first.
// Motion (motion.js): a song's modules slide up from the bottom once they're ready (no blank frame),
// the tuner shrinks into its small form, the wordmark folds; closing reverses it. The avatar, Songs
// and the toggles never move; the keyboard moves only with the dock under it (gliding).
// A PDF not converted yet (v90, docs/LIBRARY.md §4: catalog songInfo k "pdf") opens with the Score
// alone, on its PDF — on every device, unsaved, whatever opened it (Next-up, the Reader's links, an
// assistant): no Sing toggle, the Score's ▶ stays in its bar (hidden: nothing to play), the Piano as
// saved (its keyboard under the PDF, the Score's). Converted (reload), the saved modules come back.
import { openPage, closePage, openOverlay, closeOverlay, overlayOpen, device } from "./chrome.js?v=113";
import { mountSing } from "./singview.js?v=113";
import { mountScore } from "./scoreview.js?v=113";
import { mountPiano, rangeOf } from "./pianoview.js?v=113";
import { settle, slideIn, slideOut, fadeIn, fadeOut, ghost, morph, glide, drop, running } from "./motion.js?v=113";
import { loadSong, songInfo } from "../catalog.js?v=113";
import { parseMusicXml } from "../musicxml.js?v=113";
import { titleOf } from "./songlist.js?v=113";

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

export function mountSongView({ tuner, version, onLoad = () => {}, onLeave = () => {}, reprocess = null }) {
  const app = $("app"), pill = $("song-pill"), brand = $("brand"), tEl = $("tuner"), home = document.querySelector(".home"), stack = $("stack");
  const singEl = $("sing-region"), scoreEl = $("score-region");
  const tog = { sing: $("mod-sing"), score: $("mod-score"), piano: $("mod-piano") };
  const dockRow = document.querySelector(".dock .row"), corner = dockRow.querySelector(".corner"), nextup = $("nextup");
  let isOpen = false, closing = null, switching = null, watch = 0, title = "", titleId = null, current = null, gen = 0;
  let pdfOnly = false; // (the song open is a PDF only: the Score alone, no Sing)
  let dev = device(), mods = savedMods(dev);
  let intent = mods, queued = null; // (the set the toggles show — taps while a change runs queue the latest)

  const sing = mountSing({
    version, onLoad,
    beforeSound: () => { tuner.park(); score.stopSound(); piano.stopAll(); },
    onSong: (id, t) => { if (id === current) setTitle(t, id); },
  });
  const score = mountScore({
    version, onLoad,
    hooks: {
      beforeSound: () => { tuner.park(); sing.hush(true); if (sing.state()?.busy) sing.stopAll(); },
      quiet: () => !!sing.state()?.take,
      turnKeys: () => isOpen && mods.score && !overlayOpen() && !sing.sheetOpen(),
      ...(reprocess ? { reprocess } : {}), // (the Score's 📄: the song's PDF read again, in the import tray)
      shellKeys: () => piano.forScore(), // (the Piano's keyboard, the Score's while it shows)
    },
  });
  const piano = mountPiano($("piano-region"), {
    tuner,
    beforeSound: () => { sing.hush(true); if (sing.state()?.busy) sing.stopAll(); }, // (Sing's 🎤 Pitch mic too: iOS plays quietly while it's open)
    quiet: () => !!sing.state()?.take,
    busy: () => !!(sing.state()?.busy || score.state()?.busy),
    score: { press: (m, e) => score.press(m, e), lift: (pk) => score.lift(pk), changed: () => score.keysChanged(), fingers: () => score.fingersChanged() },
    resized: () => { if (isOpen && mods.score) frame().then(() => score.resize({ keep: true })); }, // (the drawn hand's band came or went: the Score's bars kept)
  });
  const setTitle = (t, id = current) => { title = t || ""; titleId = title ? id : null; pill.querySelector(".t").textContent = title || "…"; };

  // --- what shows -------------------------------------------------------------------------------
  // (sing / score: the regions; piano: the keyboard — the Score's while the Score shows)
  const want = () => {
    const s = isOpen && mods.sing && !pdfOnly, c = isOpen && mods.score;
    return { sing: s, score: c, piano: mods.piano };
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
  // The Score alone: its ▶ Play is the dock's primary (with Sing shown it stays in the Score's bar;
  // a PDF only has nothing to play: Play hides it there).
  function placePlay(w) {
    const { play, hands } = score.el;
    if (!play) return;
    const inDock = w.score && !w.sing && !pdfOnly;
    if (inDock && play.parentNode !== dockRow) corner.before(play);
    else if (!inDock && play.parentNode === dockRow) hands.after(play);
  }
  // Everything for `w`, at once (no motion: render() wraps it).
  let laid = null; // (what apply() last laid out: an open overtaken before its render leaves it behind)
  const laidOut = () => { const w = want(); return !!laid && laid.open === isOpen && ["sing", "score", "piano"].every((k) => laid[k] === w[k]); };
  function apply(w) {
    laid = { ...w, open: isOpen };
    dev = device();
    app.toggleAttribute("data-song", isOpen);
    app.toggleAttribute("data-sing", w.sing);
    app.toggleAttribute("data-score", w.score);
    app.toggleAttribute("data-piano", w.piano);
    app.dataset.dev = dev;
    sing.show(w.sing);
    score.show(w.score);
    piano.show(w.piano);
    if (piano.link(w.score && w.piano)) score.keysChanged(); // (the Score's keys and its ▶ chips on the keyboard — or back in the stretch's controls)
    earShows(sing.state(), w);
    placeTuner(w);
    placePlay(w);
    pill.hidden = !isOpen;
    if (isOpen) nextup.hidden = true;
    tog.score.hidden = !isOpen;
    tog.sing.hidden = !isOpen || pdfOnly;
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
    const form0 = app.dataset.form, place0 = app.dataset.tin, r0 = tEl.getBoundingClientRect(), k0 = was.piano ? piano.el.getBoundingClientRect() : null;
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
    // (the keyboard stays: it moves only with the dock under it — Start leaves the dock as a module
    // comes, ▶ joins it — gliding there, never a jump)
    else if (k0 && w.piano) glide(piano.el, k0);
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
    if (mods.sing && !pdfOnly) jobs.push(sing.open(id));
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
      // (only the Piano came or went under the Score: what the Score shows stays — play.js holds its layout)
      const keep = !!laid?.score && isOpen && !!next.score && !!laid.piano !== !!next.piano && !!laid.sing === !!(next.sing && !pdfOnly);
      render();
      await frame();
      score.resize({ keep }); // (laid out once at the region's new size, not 150 ms later)
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
      try { const s = await loadSong(id); midis = s?.xml ? parseMusicXml(s.xml, s.title).notes.map((n) => n.midi) : []; } catch { midis = []; }
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
  // The modules a song opens with: `base` with Sing / the Score shown when asked — a PDF only: the
  // Score, never Sing.
  const modsFor = (base, pdf, withSing, withScore) =>
    (pdf ? { ...base, sing: false, score: true } : withSing && !base.sing ? withMod(base, "sing") : withScore && !base.score ? withMod(base, "score") : base);
  const differ = (a, b) => KEYS.some((k) => !!a[k] !== !!b[k]);
  const isPdf = async (id) => (await songInfo(id).catch(() => null))?.k === "pdf";
  async function open(id, { sing: withSing = false, score: withScore = false } = {}) {
    const pdf = await isPdf(id);
    if (closing) await closing;
    if (switching) await switching;
    openPage("song", { close: leave, back: closeSheet });
    if (isOpen) {
      if (current === id) {
        const was = pdfOnly;
        pdfOnly = pdf;
        const next = modsFor(was && !pdf ? savedMods(dev) : mods, pdf, withSing, withScore);
        if (differ(next, mods)) await setMods(next, { save: false });
        else if (was !== pdf) render();
        return;
      }
      const g = ++gen;
      await stopSounds();
      while (switching) await switching.catch(() => {}); // (a change under way gives way to this open — or finishes — first)
      if (g !== gen) return;
      // (from a PDF only: the saved set again; else the set shown stays — with what this song asks for)
      const next = modsFor(pdfOnly && !pdf ? savedMods(dev) : mods, pdf, withSing, withScore);
      current = id;
      pdfOnly = pdf;
      setTitle(titleId === id ? title : "");
      nameIt(id);
      updateRange();
      if (differ(next, mods)) return setMods(next, { save: false }); // (its modules open the new song)
      if (!laidOut()) return layOut(g, id); // (an open — or a change — still waiting to lay out was overtaken: this one does it)
      apply(want()); // (the Sing toggle: shown or not for this song)
      return ensure();
    }
    const g = ++gen;
    isOpen = true;
    current = id;
    pdfOnly = pdf;
    dev = device();
    mods = modsFor(savedMods(dev), pdf, withSing, withScore);
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
  // A song's MusicXML replaced (its PDF read again): Sing and the Score that hold it load it again,
  // in place — once nothing sounds (a take is never cut for it).
  // A PDF only that got its MusicXML (converted): the saved modules again, Sing included.
  // self: Sing and the Score load it on their own (the sync's resonate:remote replaced — another
  // device converted it: sing.js and play.js listen to it): only the shell's part here.
  async function reload(id, { self = false } = {}) {
    ranges.delete(id);
    if (rangeFor === id) rangeFor = undefined;
    for (let i = 0; i < 1200 && (sing.busy() || sing.state()?.busy || score.state()?.busy || switching || closing); i++) await sleep(500);
    const S = window.resonateSing;
    const jobs = [];
    if (!self && sing.loaded && S?.state?.().song === id) jobs.push(S.open(id));
    if (!self && score.loaded) jobs.push(score.reload(id));
    for (const r of await Promise.allSettled(jobs)) if (r.status === "rejected") console.error(r.reason);
    if (isOpen && current === id) { titleId = null; nameIt(id); } // (a first conversion may name it: titleAuto)
    if (isOpen && current === id && pdfOnly && !(await isPdf(id)) && isOpen && current === id) {
      pdfOnly = false;
      const next = savedMods(dev);
      if (differ(next, mods)) await setMods(next, { save: false });
      else { render(); await ensure(); }
    }
    updateRange();
  }
  // A song deleted (songlist.js): closed if it's the one open — what runs stops first (a take is
  // finished and saved, as ◎ does), its history entry goes (and the sheet's above it).
  async function closeSong(id) {
    if (!isOpen || (id && current !== id)) return false;
    closePage();
    await (closing || leave());
    return true;
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
      pdfOnly = false;
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
  // Sing's Ear shows (one line at a time, by ear): the tuner — a live pitch readout — is hidden (index.html
  // .app[data-ear]); it comes back with Ear off (⚙) or Sing gone, the song closed.
  // (w: what's laid out — apply's; follow goes by the page as it is, never ahead of the layout)
  function earShows(st, w = { sing: app.hasAttribute("data-sing") }) {
    const on = !!(st?.ear && w.sing);
    if (app.hasAttribute("data-ear") !== on) app.toggleAttribute("data-ear", on);
  }
  // While a module holds the sound the tuner's mic button is off: "take" (red) or "paused".
  function follow() {
    const st = sing.state(), sc = score.state();
    const busy = !!(st?.busy || sc?.busy);
    earShows(st);
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
  // (the title is a label: Songs, bottom right, is the one way to the list — the pill dropped it down too)
  $("song-close").addEventListener("click", () => closePage());
  // A rotation or a window crossing a size class: that class's modules, laid out again.
  addEventListener("resize", () => {
    if (switching || closing) return;
    if (device() !== dev) { const base = savedMods(device()); mods = intent = isOpen && pdfOnly ? modsFor(base, true) : base; render({ motion: false }); updateRange(); }
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
    open, leave, setMods, reload, closeSong, stopAll: stopSounds,
    get isOpen() { return isOpen; },
    get current() { return isOpen ? current : null; },
    get pdfOnly() { return isOpen && pdfOnly; },
    get title() { return title; },
    get mods() { return { ...mods }; },
    sing,
    busy: () => !!(sing.busy() || score.state()?.busy || closing || switching),
    // (what sounds — Sing's take, loop, playback or get-ready, the Score's ▶ — without the change
    // under way: chrome.js staleShell)
    soundBusy: () => !!(sing.busy() || sing.state()?.busy || score.state()?.busy),
    debug: () => {
      const st = sing.state(), sc = score.state();
      return { open: isOpen, loaded: sing.loaded, scoreLoaded: score.loaded, title, drop: dropped, form: app.dataset.form || "full", tin: app.dataset.tin,
        moving: running(), switching: !!switching, closing: !!closing, laid: app.hasAttribute("data-song"),
        mods: isOpen ? (mods.sing && mods.score ? "both" : mods.sing ? "sing" : mods.score ? "score" : "none") : null, set: { ...mods }, dev, pdfOnly: isOpen && pdfOnly, ear: app.hasAttribute("data-ear"),
        state: isOpen || st ? { ...(st || {}), song: current ?? st?.song ?? null, busy: !!(st?.busy || sc?.busy), take: !!st?.take, ear: !!st?.ear } : null, score: sc };
    },
    singDebug: () => (isOpen ? sing.debug() : null),
    scoreDebug: () => score.debug(),
    pianoDebug: () => piano.debug(),
  };
}
