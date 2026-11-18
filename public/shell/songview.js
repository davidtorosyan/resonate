// A song open in the shell: Sing (singview.js) and the Score (scoreview.js), one or both, under the
// top bar. Which show is a device pref per device class (resonate.shell.modules: REDESIGN D2) — a
// phone opens Sing alone, a tablet and a desktop the desk (the Score alone, its keyboard docked) —
// changed with the top bar's Sing · Score (a tablet, a desktop: both, side by side from 1024 px,
// else Sing above the Score) or, on a phone, the Score button in Sing's head and Sing in the
// Score's bar (one at a time). The tuner's form follows (REDESIGN §5): Sing alone → strip (phone)
// or docked; both → a strip in the top bar; the Score alone → a mic chip in the Score's bar. Forms
// and regions change only when a song opens or closes or a module is turned on or off; a change
// stops what sounds first, never during a take. One sound at a time: a touch or a start in one
// module parks the tuner and stops the other first (beforeSound); a press on the Score while Sing
// records stays silent. ◎, Back and another song stop both first.
import { openPage, closePage, openOverlay, closeOverlay, overlayOpen, device } from "./chrome.js?v=85";
import { mountSing } from "./singview.js?v=85";
import { mountScore } from "./scoreview.js?v=85";

const $ = (id) => document.getElementById(id);
const PREF = "resonate.shell.modules"; // { phone | tablet | desktop: "sing" | "score" | "both" } — this device's
const DEFAULTS = { phone: "sing", tablet: "score", desktop: "score" };
const MODS = ["sing", "score", "both"];
function savedMods(dev) {
  try {
    const v = JSON.parse(localStorage.getItem(PREF) || "{}")?.[dev];
    if (MODS.includes(v) && !(dev === "phone" && v === "both")) return v;
  } catch {}
  return DEFAULTS[dev];
}
function saveMods(dev, m) {
  try {
    const o = JSON.parse(localStorage.getItem(PREF) || "{}") || {};
    o[dev] = m;
    localStorage.setItem(PREF, JSON.stringify(o));
  } catch {}
}

export function mountSongView({ tuner, version, onLoad = () => {}, onLeave = () => {}, openSongs = () => {} }) {
  const app = $("app"), pill = $("song-pill"), brand = $("brand"), tEl = $("tuner"), home = document.querySelector(".home");
  const layers = $("layers"), laySing = $("lay-sing"), layScore = $("lay-score");
  const dockRow = document.querySelector(".dock .row"), corner = dockRow.querySelector(".corner");
  let isOpen = false, closing = null, switching = null, watch = 0, title = "", titleId = null, current = null, mods = "sing", dev = device();

  const sing = mountSing({
    version, onLoad,
    beforeSound: () => { tuner.park(); score.stopSound(); },
    onSong: (id, t) => { if (id === current) setTitle(t, id); },
    toScore: () => setMods("score"),
  });
  const score = mountScore({
    version, onLoad,
    hooks: {
      beforeSound: () => { tuner.park(); if (sing.state()?.busy) sing.stopAll(); },
      quiet: () => !!sing.state()?.take,
      turnKeys: () => isOpen && mods !== "sing" && !overlayOpen() && !sing.sheetOpen(),
    },
    toSing: () => setMods("sing"),
  });
  const setTitle = (t, id = current) => { title = t || ""; titleId = title ? id : null; pill.querySelector(".t").textContent = title || "…"; };

  // --- where everything goes for the modules shown ------------------------------------------------
  const formFor = () => (mods === "score" ? "chip" : mods === "both" ? "strip" : dev === "phone" ? "strip" : "docked");
  function placeTuner() {
    const form = formFor();
    if (form === "chip" && score.el.names) score.el.names.after(tEl);
    else if (mods === "both") pill.after(tEl);
    else if (tEl.parentNode !== home) home.prepend(tEl);
    if (!dropped) tuner.setForm(form);
    app.dataset.form = form;
  }
  // Songs (and a folded import): the dock's right end; on the desk the keyboard's right end, or the
  // Score's bar while the keyboard isn't shown.
  function placeCorner() {
    const desk = isOpen && mods === "score" && dev !== "phone" && score.el.dock;
    const to = !desk ? dockRow : score.el.dock.hidden ? score.el.bar : score.el.dock;
    if (corner.parentNode !== to) to.append(corner);
  }
  // The phone's Score alone: its ‹ › and ▶ in the dock (the bar keeps the view, names, the mic, 🎹).
  function placeTransport() {
    const { pager, play, hands, bar } = score.el;
    if (!pager) return;
    const inDock = isOpen && mods === "score" && dev === "phone";
    if (inDock && pager.parentNode !== dockRow) corner.before(pager, play);
    else if (!inDock && pager.parentNode === dockRow) { hands.after(play); bar.append(pager); }
  }
  function arrange() {
    dev = device();
    app.dataset.mods = mods;
    app.dataset.dev = dev;
    app.toggleAttribute("data-desk", mods === "score" && dev !== "phone");
    sing.show(mods !== "score");
    score.show(mods !== "sing");
    placeTuner();
    placeTransport();
    placeCorner();
    laySing.setAttribute("aria-pressed", String(mods !== "score"));
    layScore.setAttribute("aria-pressed", String(mods !== "sing"));
  }
  // The modules shown, on the current song (each loaded the first time it shows: Verovio only then).
  async function ensure() {
    const id = current, jobs = [];
    if (mods !== "score") jobs.push(sing.open(id));
    if (mods !== "sing") jobs.push(score.mount().then(() => { if (isOpen && current === id) arrange(); return score.open(id); }));
    const res = await Promise.allSettled(jobs);
    for (const r of res) if (r.status === "rejected") console.error(r.reason);
    return res;
  }
  // Turn modules on or off: what sounds stops first; never during a take.
  async function setMods(m, { save = true } = {}) {
    if (!isOpen || m === mods || switching || sing.state()?.take) return;
    switching = (async () => {
      await Promise.all([sing.state()?.busy ? sing.stopAll() : null, score.stopAll()]);
      mods = m;
      if (save) saveMods(dev, m);
      arrange();
      await new Promise((r) => requestAnimationFrame(() => r()));
      score.resize(); // (laid out once at the region's new size, not 150 ms later)
      await ensure();
    })().finally(() => { switching = null; });
    return switching;
  }
  // (each turns its module on or off; the last one on stays on)
  laySing.addEventListener("click", () => { if (mods !== "sing") setMods(mods === "both" ? "score" : "both"); });
  layScore.addEventListener("click", () => { if (mods !== "score") setMods(mods === "both" ? "sing" : "both"); });

  // --- open / close ---------------------------------------------------------------------------------
  // opts.sing: open with Sing shown (Next-up advertises a singing step: REDESIGN D2)
  async function open(id, { sing: withSing = false } = {}) {
    if (closing) await closing;
    if (switching) await switching;
    openPage("song", { close: leave, back: closeSheet });
    if (isOpen) {
      if (current === id) return;
      await Promise.all([sing.stopAll(), score.stopAll()]);
      current = id;
      setTitle(titleId === id ? title : "");
      return ensure();
    }
    isOpen = true;
    current = id;
    dev = device();
    mods = savedMods(dev);
    if (withSing && mods === "score") mods = dev === "phone" ? "sing" : "both";
    tuner.park(); // (a song open: the tuner starts parked)
    app.dataset.song = "";
    layers.hidden = dev === "phone";
    pill.hidden = false;
    setTitle(titleId === id ? title : "");
    arrange();
    clearInterval(watch);
    watch = setInterval(follow, 100);
    const res = await ensure();
    if (!sing.loaded && !score.loaded && res.some((r) => r.status === "rejected")) closePage(); // (offline before either ever loaded: home again)
  }
  // Back: Sing's own topmost sheet first (the page stays), then the song.
  function closeSheet() {
    if (overlayOpen()) return false;
    return sing.closeSheet();
  }
  // Leave the song (◎, Back, Close): whatever runs stops first — a take being stopped is finished
  // and saved as on sing.html — then home.
  function leave() {
    if (!isOpen || closing) return closing;
    closing = (async () => {
      if (switching) await switching.catch(() => {});
      await Promise.all([sing.stopAll(), score.stopAll()]);
      isOpen = false;
      clearInterval(watch);
      dropClose();
      tuner.setHold(null);
      placeTransport();
      placeCorner();
      if (tEl.parentNode !== home) home.prepend(tEl);
      tuner.setForm("full");
      for (const k of ["song", "form", "mods", "desk"]) delete app.dataset[k];
      sing.show(false);
      score.show(false);
      layers.hidden = true;
      pill.hidden = true;
      onLeave();
    })().finally(() => { closing = null; });
    return closing;
  }
  // While a module holds the sound the tuner's mic button is off: "take" (red) or "paused".
  function follow() {
    const st = sing.state(), sc = score.state();
    const busy = !!(st?.busy || sc?.busy);
    tuner.setHold(st?.take ? "take" : busy ? "paused" : null);
    if (busy && tuner.state !== "off") tuner.park(); // (a safety net: every start parks it already)
    if (mods === "score" && sc?.song === current && sc.title && titleId !== current) setTitle(sc.title); // (Sing names it when it shows)
    placeCorner(); // (🎹 on / off on the desk)
  }
  brand.addEventListener("click", (e) => {
    if (!isOpen) return;
    e.preventDefault();
    closePage();
  });
  pill.addEventListener("click", () => openSongs());
  // A rotation or a window crossing a size class: the same modules, laid out again.
  addEventListener("resize", () => { if (isOpen && device() !== dev && !switching) { mods = savedMods(device()); arrange(); } });

  // --- the tuner drop: the rest of a small tuner drops the full tuner over the song ------------------
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
    open, leave, setMods,
    get isOpen() { return isOpen; },
    busy: () => !!(sing.busy() || score.state()?.busy || closing || switching),
    debug: () => {
      const st = sing.state(), sc = score.state();
      return { open: isOpen, loaded: sing.loaded, scoreLoaded: score.loaded, title, drop: dropped, form: app.dataset.form || "full", mods: isOpen ? mods : null, dev,
        state: isOpen || st ? { ...(st || {}), song: current ?? st?.song ?? null, busy: !!(st?.busy || sc?.busy), take: !!st?.take } : null, score: sc };
    },
    singDebug: () => (isOpen ? sing.debug() : null),
    scoreDebug: () => score.debug(),
  };
}
