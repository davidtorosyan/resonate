// Play: a song's piano part as sheet music, one screen at a time, with each note's name on its
// head (All → Some → Off), for reading at the piano on an iPad.
//
//   song (catalog.js) → prepare (playprep.js: parts, views, pitch facts) → buildView (the view's
//   MusicXML, cached per song) → Verovio (one toolkit per page load; one page laid out to the
//   stage's exact size, only the shown pages drawn) → decorate (playnames.js: the badges).
//
// The place is kept by written measure (S.at): rotation, −/+, a hands switch and reopening the
// song all come back to the page holding that bar.
import { spaceChanged } from "./nav.js?v=76";
import { SAMPLES, loadSong, songChoices } from "./catalog.js?v=76";
import { prepare, buildView, VIEW_LABELS } from "./playprep.js?v=76";
import { decorate, fullName, labelOf } from "./playnames.js?v=76";
import { loadPiano, holdPiano } from "./piano.js?v=76";
import { listPdfIds, getPdf } from "./library.js?v=76";

const $ = (id) => document.getElementById(id);
const stage = $("stage"), msgEl = $("msg"), pgEl = $("pg");
const songSel = $("song"), samplesEl = $("samples"), mineEl = $("mine"), handsSel = $("hands");
const namesBtn = $("names"), smallerBtn = $("smaller"), biggerBtn = $("bigger"), prevBtn = $("prev"), nextBtn = $("next");
const pdfBtn = $("pdf"), offerEl = $("offer"), stripEl = $("strip"), bubbleEl = $("bubble");

const K = {
  play: "resonate.play",        // { songId: { names, view, at, pdfPage, days } } — the account's (space.js DATA_KEYS)
  size: "resonate.play.size",   // staff space in CSS px — this device's
  names: "resonate.play.names", // the level a song opened for the first time starts at — this device's
  song: "resonate.sing.song",   // the song open, shared with Sing
};
// Staff space (CSS px) steps for − / +. Defaults: ~3 mm on a tablet on the music desk, smaller
// on a desktop screen, a phone shows what fits.
const SIZES = [7, 8, 9.5, 11, 12.5, 14, 16, 18, 20, 23];
const LEVELS = ["all", "some", "off"];
const FIRST = Object.keys(SAMPLES)[0];
// (header "none": "auto" prints every OCR'd credit, "Authorized for use by: …" included.
// spacingStaff / spacingBraceGroup 8 instead of 12: three grand staves on an iPad page in portrait
// at size 16 instead of two — Piano Man 40 → 31 pages; the justification spreads a full page's
// systems over it and keeps a grand staff's two staves together.
// Melody: Verovio packed the words of a narrow bar ~2 px apart — "Forthelong est", a hymn's
// eight verses "taughtmy", "snaresI"; a word space of 3: at 16 on an iPad, The Longest Time 34 →
// 0 crowded pairs, Amazing Grace 18 → 4 touching, at most one more page.)
const VRV = {
  header: "none", footer: "none", breaks: "auto", mnumInterval: 0, adjustPageHeight: false,
  svgAdditionalAttribute: ["note@pname", "note@oct", "note@oct.ges", "accid@accid", "accid@accid.ges"],
  pageMarginLeft: 60, pageMarginRight: 60, pageMarginTop: 40, pageMarginBottom: 20,
  spacingStaff: 8, spacingBraceGroup: 8,
  justifyVertically: true, justificationStaff: 0.2, justificationBraceGroup: 0.2,
  lyricWordSpace: 3,
};

const recall = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const keep = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
const ms = (t0) => Math.round(performance.now() - t0);
// (Safari has no requestIdleCallback.)
const idle = (f) => (window.requestIdleCallback ? window.requestIdleCallback(f, { timeout: 500 }) : setTimeout(f, 50));
// Let "…" reach the screen before a long synchronous step (a hidden tab has no frames: the timer).
const paint = () => new Promise((resolve) => {
  let done = false;
  const go = () => { if (!done) { done = true; setTimeout(resolve, 0); } };
  requestAnimationFrame(go);
  setTimeout(go, 100);
});

function defaultSize() {
  const coarse = matchMedia("(any-pointer: coarse)").matches;
  if (!coarse) return 12.5;
  return Math.min(screen.width, screen.height) >= 700 ? 16 : 9.5;
}
function savedSize() {
  const v = Number(recall(K.size));
  return SIZES.includes(v) ? v : defaultSize();
}

const S = {
  gen: 0,           // bumped by every song open / hands switch: a newer one wins
  ready: false,     // a song is shown
  failed: null,     // "engine" | "song"
  song: null, title: "",
  P: null,          // prepare(): { doc, parts, views, facts }
  waiting: false,   // the view waits for the stage to get a size
  view: "both",
  built: new Map(), // view key → buildView() result (its XML is what Verovio loads)
  v: null,          // the shown view's buildView()
  loaded: null,     // the buildView() result Verovio holds
  st: {},           // the song's own record in resonate.play
  names: LEVELS.includes(recall(K.names)) ? recall(K.names) : "all",
  size: savedSize(),
  W: 0, H: 0, spread: false, sp: 0, scale: 0,
  pages: 0, page: 1,
  at: 0,            // written measure index the shown place is anchored to
  items: [],        // decorate() items of the shown pages (heads with their facts and boxes)
  counted: new Map(), // page → notes with a head drawn (this layout)
  lgen: 0,          // layout generation: the page cache and prefetches belong to one
  mine: new Set(),  // library song ids
  t: {},            // timings (ms)
};
let tk = null;            // the Verovio toolkit (one per page load)
const cache = new Map();  // page → SVG string, for the current layout only

// ---------------------------------------------------------------------------
// The song's record (resonate.play[songId]); written only into this device's own space.

function readPlay() {
  try {
    const o = JSON.parse(recall(K.play) || "{}");
    return o && typeof o === "object" && !Array.isArray(o) ? o : {};
  } catch { return {}; }
}
function writePlay(all) {
  if (spaceChanged()) return;
  keep(K.play, JSON.stringify(all));
}
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  if (!S.song || !Object.keys(S.st).length || spaceChanged()) return;
  const all = readPlay();
  all[S.song] = S.st;
  writePlay(all);
}
let saveTimer = 0;
const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveState, 1000); };

// Entries of songs that are gone (not a sample, not in My songs).
function prune() {
  if (spaceChanged()) return;
  const all = readPlay();
  let n = 0;
  for (const id of Object.keys(all)) if (!(id in SAMPLES) && !S.mine.has(id)) { delete all[id]; n++; }
  if (n) writePlay(all);
}

// ---------------------------------------------------------------------------
// The engine: Verovio, imported in parallel with the song list and the song.

let engineP = null;
function engine() {
  return (engineP ||= (async () => {
    const t0 = performance.now();
    const [{ default: createVerovioModule }, { VerovioToolkit }] = await Promise.all([
      import("./vendor/verovio-6.4.0/verovio-module.mjs"), import("./vendor/verovio-6.4.0/verovio.mjs")]);
    const t = new VerovioToolkit(await createVerovioModule());
    t.setOptions(VRV);
    S.t.engine = ms(t0);
    tk = t;
    return t;
  })().catch((err) => { engineP = null; throw err; }));
}

// ---------------------------------------------------------------------------
// Songs

const known = (id) => !!id && (id in SAMPLES || S.mine.has(id));

// → true when My songs could be listed.
async function fillSongs() {
  let samples = Object.entries(SAMPLES).map(([id, s]) => ({ id, title: s.title }));
  let mine = [], listed = true;
  try { ({ samples, mine } = await songChoices()); } catch (err) { console.warn("song list", err); listed = false; }
  samplesEl.replaceChildren(...samples.map((s) => new Option(s.title, s.id)));
  mineEl.replaceChildren(...mine.map((s) => new Option(s.title, s.id)));
  mineEl.hidden = !mine.length;
  if (listed) S.mine = new Set(mine.map((s) => s.id));
  if (S.song) songSel.value = S.song;
  return listed;
}

function setBusy(busy) {
  handsSel.disabled = busy || pdf.on;
  if (busy) {
    pgEl.textContent = "…";
    for (const b of [smallerBtn, biggerBtn, prevBtn, nextBtn]) b.disabled = true;
  }
}
function showMsg(text) {
  msgEl.textContent = text || "";
  msgEl.hidden = !text;
}
function clearPages() {
  for (const p of stage.querySelectorAll(".page")) p.remove();
  S.items = [];
}
function fail(kind, err) {
  if (err) console.warn(kind === "engine" ? "music engine" : "song", err);
  S.ready = false;
  S.failed = kind;
  clearPages();
  setBusy(false);
  pgEl.textContent = "";
  showMsg(kind === "engine" ? "Couldn't load the music — check the connection." : "Couldn't open this song.");
}

async function open(id) {
  const gen = ++S.gen;
  if (S.song && S.song !== id) { saveState(); songClosed(); }
  clearPeek();
  if (pdf.on) pdfOff();
  pdf.has = false;
  pdfBtn.hidden = true;
  S.ready = false;
  S.failed = null;
  S.song = id;
  S.title = "";
  S.P = null;
  S.v = null;
  S.built = new Map();
  S.st = readPlay()[id] || {};
  if (!S.st || typeof S.st !== "object") S.st = {};
  S.at = Number.isInteger(S.st.at) && S.st.at >= 0 ? S.st.at : 0;
  // (a song opened for the first time starts at the level chosen last)
  const last = recall(K.names);
  setNames(LEVELS.includes(S.st.names) ? S.st.names : LEVELS.includes(last) ? last : "all");
  songSel.value = id;
  handsSel.hidden = true;
  showMsg("");
  clearPages();
  setBusy(true);
  const t0 = performance.now();
  engine().catch(() => {}); // (started at load; a failed one is tried again)
  let song;
  try { song = await loadSong(id); } catch (err) { if (gen === S.gen) fail("song", err); return; }
  if (gen !== S.gen) return;
  if (!song) {
    if (id !== FIRST) return open(FIRST);
    return fail("song");
  }
  S.t.song = ms(t0);
  S.title = song.title;
  pdfCheck(id, song.source);
  await paint();
  if (gen !== S.gen) return;
  try {
    const t1 = performance.now();
    S.P = prepare(song.xml);
    S.t.prep = ms(t1);
  } catch (err) { return fail("song", err); }
  const views = S.P.views;
  S.view = S.st.view in views ? S.st.view : "both";
  handsSel.replaceChildren(...Object.keys(views).map((k) => new Option(VIEW_LABELS[k] || k, k)));
  handsSel.value = S.view;
  handsSel.hidden = Object.keys(views).length < 2;
  showOffer(); // (before the layout: the bar's height is final when the music is laid out)
  try { await engine(); } catch (err) { if (gen === S.gen) fail("engine", err); return; }
  if (gen !== S.gen) return;
  await loadView(gen);
  if (gen !== S.gen || !S.ready) return;
  S.t.open = ms(t0);
  songShown();
}

// Load the current view into Verovio (its MusicXML built once per song) and show the anchor's page.
async function loadView(gen) {
  let v = S.built.get(S.view);
  if (!v) {
    try {
      const t = performance.now();
      v = buildView(S.P.doc, S.P.views[S.view]);
      S.t.build = ms(t);
    } catch (err) { return fail("song", err); }
    S.built.set(S.view, v);
  }
  S.v = v;
  S.waiting = false;
  setBusy(true);
  await paint();
  if (gen !== S.gen) return;
  const L = measure();
  if (!L) { S.waiting = true; return; } // no stage yet: the resize observer loads it
  setPageSize(L);
  const t = performance.now();
  let ok = false;
  try { ok = tk.loadData(v.xml); } catch (err) { console.warn("loadData", err); }
  S.t.data = ms(t);
  S.loaded = ok ? v : null;
  if (!ok || !tk.getPageCount()) return fail("song");
  placed(L);
}

// The page size for the stage, from the staff size wanted: two pages side by side when each still
// holds ≥ 48 staff spaces; ≥ 40 staff spaces across a system; ≥ one system a page.
function measure() {
  const cs = getComputedStyle(stage);
  const W = Math.floor(stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
  const H = Math.floor(stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
  if (W < 60 || H < 60 || !S.P) return null;
  const staves = S.P.views[S.view]?.staves || 1;
  const want = S.size;
  const spread = W > H && W / 2 / want >= 48;
  const pw = spread ? Math.floor(W / 2) : W;
  const sp = Math.min(want, pw / 40, H / (12 * staves));
  const scale = Math.max(5, Math.round(sp / 0.18));
  return { W, H, spread, pw, sp, scale };
}
function setPageSize(L) {
  // (floored: the drawing never comes out a pixel larger than the stage)
  tk.setOptions({ scale: L.scale, pageWidth: Math.floor((L.pw * 100) / L.scale), pageHeight: Math.floor((L.H * 100) / L.scale) });
}

// After a layout: pages, the anchor's page (odd in a spread), show.
function placed(L) {
  S.W = L.W; S.H = L.H; S.spread = L.spread; S.sp = L.sp; S.scale = L.scale;
  cache.clear();
  S.counted = new Map();
  S.lgen++;
  S.pages = tk.getPageCount();
  stage.classList.toggle("spread", S.spread && S.pages > 1); // (a lone last page stays in its half)
  let p = tk.getPageWithElement("m" + S.v.firstMeasureAtOrAfter(S.at)) || 1;
  if (S.spread && p % 2 === 0) p--;
  S.page = Math.max(1, Math.min(S.pages, p));
  showMsg("");
  S.ready = true;
  handsSel.disabled = pdf.on;
  show();
  holdWake();
}

// Rotation, a resize, −/+: same data, a new page size.
function relayout() {
  if (!S.ready || !tk || S.loaded !== S.v) return;
  const L = measure();
  if (!L) return;
  clearPeek();
  setPageSize(L);
  const t = performance.now();
  tk.redoLayout();
  S.t.layout = ms(t);
  placed(L);
}

// ---------------------------------------------------------------------------
// Pages

function svgOf(p) {
  let s = cache.get(p);
  if (s == null) {
    const t = performance.now();
    s = tk.renderToSVG(p);
    S.t.render = ms(t);
    cache.set(p, s);
  }
  return s;
}
const shownPages = () => (S.spread ? [S.page, S.page + 1].filter((p) => p <= S.pages) : [S.page]);
const lastPage = () => (S.spread ? (S.pages % 2 ? S.pages : S.pages - 1) : S.pages);

function show() {
  const list = shownPages();
  const step = S.spread ? 2 : 1;
  // (the cache holds the shown pages and the ones a turn either way would show)
  for (const p of [...cache.keys()]) if (p < S.page - step || p >= S.page + 2 * step) cache.delete(p);
  const t0 = performance.now();
  const els = list.map((p) => {
    const d = document.createElement("div");
    d.className = "page";
    d.dataset.page = p;
    d.innerHTML = svgOf(p);
    return d;
  });
  clearPages();
  stage.append(...els);
  S.t.show = ms(t0);
  const t1 = performance.now();
  for (const d of els) {
    const r = decorate(d, S.P.facts);
    for (const it of r.items) S.items.push(it);
    S.counted.set(Number(d.dataset.page), r.items.length);
  }
  S.t.badges = ms(t1);
  pager();
  // the next page(s), ready for the turn
  const lg = S.lgen;
  idle(() => {
    if (lg !== S.lgen || !S.ready) return;
    const from = S.page + step;
    for (let p = from; p < from + step && p <= S.pages; p++) svgOf(p);
  });
}

function pager() {
  if (pdf.on) return pdfPager();
  const list = shownPages();
  pgEl.textContent = (list.length > 1 ? `${list[0]}–${list[1]}` : `${list[0]}`) + ` / ${S.pages}`;
  prevBtn.disabled = S.page <= 1;
  nextBtn.disabled = S.page >= lastPage();
  sizeButtons();
}

// The written measure index of the first bar on the shown page.
function firstMeasureShown() {
  for (const g of stage.querySelectorAll(".page g.measure")) {
    const m = /^m(\d+)$/.exec(g.id);
    if (m) return Number(m[1]);
  }
  return null;
}

// d = +1 forward, −1 back (by two in a spread). No wrap at the ends.
function turn(d) {
  if (pdf.on) return pdfTurn(d);
  if (!S.ready) return false;
  clearPeek();
  const p = Math.max(1, Math.min(lastPage(), S.page + d * (S.spread ? 2 : 1)));
  if (p === S.page) return false;
  S.page = p;
  show();
  const mi = firstMeasureShown();
  if (mi != null) { S.at = mi; S.st.at = mi; saveSoon(); }
  activity("turn");
  return true;
}

// The notehead nearest a point (client px), within max(16 px, 1.2 × the head's height):
// → { item (a decorate() item: g, fact, …), x, y (its centre, client px), d } or null.
function nearHead(x, y) {
  let best = null;
  const ctms = new Map(); // (one screen matrix per layer)
  for (const it of S.items) {
    if (!it.w) continue;
    const key = it.g.parentNode;
    let m = ctms.get(key);
    if (m === undefined) { m = it.g.getScreenCTM(); ctms.set(key, m); }
    if (!m) continue;
    const px = m.a * it.cx + m.c * it.cy + m.e, py = m.b * it.cx + m.d * it.cy + m.f;
    const d = Math.hypot(x - px, y - py);
    if (d <= Math.max(16, 1.2 * it.h * Math.hypot(m.b, m.d)) && (!best || d < best.d)) best = { item: it, x: px, y: py, d };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Controls

function setNames(level, byHand = false) {
  S.names = level;
  stage.dataset.names = level;
  namesBtn.dataset.level = level;
  namesBtn.textContent = level === "some" ? "A·C" : "ABC";
  const label = "Note names: " + level;
  namesBtn.setAttribute("aria-label", label);
  namesBtn.title = label;
  if (!byHand) return;
  S.st.names = level;
  levelChanged(level);
  saveState();
  keep(K.names, level);
}
namesBtn.addEventListener("click", () => !pdf.on && setNames(LEVELS[(LEVELS.indexOf(S.names) + 1) % LEVELS.length], true));

// − / +: the staff size, as far as the screen allows (+ stops where the width caps it).
const clamped = () => S.sp < S.size - 0.01;
function sizeButtons() {
  const shown = Math.min(S.size, S.sp || S.size);
  smallerBtn.disabled = !S.ready || pdf.on || shown <= SIZES[0] + 0.01;
  biggerBtn.disabled = !S.ready || pdf.on || S.size >= SIZES[SIZES.length - 1] || clamped();
  namesBtn.disabled = pdf.on;
}
function resize(dir) {
  if (!S.ready || pdf.on) return;
  if (dir > 0) {
    const next = SIZES.find((s) => s > S.size + 0.01);
    if (!next || clamped()) return;
    S.size = next;
  } else {
    const shown = Math.min(S.size, S.sp);
    const prev = [...SIZES].reverse().find((s) => s < shown - 0.01);
    if (!prev) return;
    S.size = prev;
  }
  keep(K.size, String(S.size));
  relayout();
}
smallerBtn.addEventListener("click", () => resize(-1));
biggerBtn.addEventListener("click", () => resize(1));
prevBtn.addEventListener("click", () => turn(-1));
nextBtn.addEventListener("click", () => turn(1));

songSel.addEventListener("change", () => {
  const id = songSel.value;
  if (!spaceChanged()) keep(K.song, id);
  open(id);
});
handsSel.addEventListener("change", async () => {
  if (!S.P || !(handsSel.value in S.P.views)) return;
  S.view = handsSel.value;
  S.st.view = S.view;
  saveState();
  const gen = ++S.gen;
  clearPeek();
  S.ready = false;
  await loadView(gen);
});
// A focused control keeps the pedal's keys (a select's arrows, a button's Space/Enter): let go.
const bar = $("bar");
bar.addEventListener("change", (e) => { if (e.target.matches?.("select")) e.target.blur(); });
bar.addEventListener("click", (e) => e.target.closest?.("button")?.blur());

// ---------------------------------------------------------------------------
// Turning pages: keys (Bluetooth page turners send these), a tap on the outer quarters, a swipe.

const FWD = new Set(["ArrowRight", "ArrowDown", "PageDown", " ", "Spacebar", "Enter"]);
const BACK = new Set(["ArrowLeft", "ArrowUp", "PageUp", "Backspace"]);
window.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target instanceof Element ? e.target : null;
  if (t && (t.closest("select, input, textarea") || t.isContentEditable)) return;
  let d = FWD.has(e.key) ? 1 : BACK.has(e.key) ? -1 : 0;
  if (!d) return;
  const own = e.key === " " || e.key === "Spacebar" || e.key === "Enter";
  if (own && t?.closest("button, a")) return; // (a control reached with Tab keeps its keys)
  if (d > 0 && e.key !== "Enter" && own && e.shiftKey) d = -1;
  e.preventDefault();
  turn(d);
});

let gest = null; // { id, x, y, t, hit, peek }
stage.addEventListener("pointerdown", (e) => {
  if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
  const hit = S.ready && !pdf.on ? nearHead(e.clientX, e.clientY) : null;
  gest = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, hit, peek: null };
  if (hit) gest.peek = peekStart(hit, e);
  try { stage.setPointerCapture(e.pointerId); } catch {}
});
stage.addEventListener("pointermove", (e) => {
  const g = gest;
  if (!g || e.pointerId !== g.id || !g.peek) return;
  if (e.timeStamp - g.t <= 200 && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 12) {
    peekCancel(g.peek);
    g.peek = null;
  }
});
stage.addEventListener("pointerup", (e) => {
  const g = gest;
  if (!g || e.pointerId !== g.id) return;
  gest = null;
  if (g.peek) { peekEnd(g.peek, e); return; } // (a peek never turns the page)
  const dx = e.clientX - g.x, dy = e.clientY - g.y;
  if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) { turn(dx < 0 ? 1 : -1); return; }
  if (g.hit || Math.hypot(dx, dy) >= 10 || e.timeStamp - g.t > 500) return;
  const r = stage.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width;
  if (fx >= 0.75) turn(1);
  else if (fx <= 0.25) turn(-1);
});
stage.addEventListener("pointercancel", (e) => {
  const g = gest;
  if (!g || e.pointerId !== g.id) return;
  gest = null;
  if (g.peek) peekCancel(g.peek);
});
stage.addEventListener("contextmenu", (e) => e.preventDefault());

// ---------------------------------------------------------------------------
// Peek: press a note — at any level, Off included — to see its chord's names (with octaves),
// hear it until the finger lifts and see its keys on a keyboard strip. Moving off quickly
// (> 12 px within 200 ms) cancels it and the gesture is a swipe; a peek never turns the page.
//
// Sound follows the Sing page's chip keys: the session is set to "playback" in the press before
// a context is made; a context iOS closed or left "interrupted" (or whose resume in a tap never
// settled) is replaced in a touch, which can then start it. iOS only lets audio start at a
// touch's end, so the first tap anywhere resumes the context and loads the piano (leaving the
// session alone: other apps' music isn't stopped before a note plays); a press that couldn't
// sound at once plays its chord for LIFT_PLAY at the lift, and one that still can't start
// LATE ms after the lift is dropped rather than played late.

const MIN_PRESS = 0.25;  // s: a quick tap still sounds this long
const LIFT_PLAY = 0.8;   // s: a press that could only sound at the lift
const LATE = 1500;       // ms
const MAX_HOLD = 60000;  // ms: a release that never came lets go by itself
const HIDE_AFTER = 2000; // ms after the lift: the names, the strip and the colour go
const CUT = 0.01;        // s: time constant when a press becomes a swipe
const HAND = { rh: "#a64fff", lh: "#4f7cff" };
const WHITE = new Set([0, 2, 4, 5, 7, 9, 11]);
const sleep = (t) => new Promise((r) => setTimeout(r, t));

let ac = null, acStuck = false;
const setSession = (type) => { try { if (navigator.audioSession) navigator.audioSession.type = type; } catch {} };
// (Synchronous, so a touch can make the context it may then start.)
function freshCtx() {
  if (ac?.state === "running") acStuck = false;
  if (!ac || ac.state === "closed" || ac.state === "interrupted" || acStuck) {
    if (ac && ac.state !== "closed") ac.close().catch(() => {});
    ac = new (window.AudioContext || window.webkitAudioContext)();
    acStuck = false;
  }
  return ac;
}
// how: "press" (a touch-down: iOS starts audio only at the lift, so a long hold isn't stuck) or
// "tap" (a lift: a resume still pending after 1.5 s marks the context stuck — the next touch
// starts over with a new one).
function getCtx(how) {
  setSession("playback");
  const a = freshCtx();
  if (a.state !== "running") {
    Promise.race([a.resume().catch(() => {}), sleep(1500)]).then(() => {
      if (a === ac) acStuck = how !== "press" && a.state !== "running";
    });
  }
  return a;
}
const UNLOCK = ["pointerup", "click", "keydown"];
function unlockPlay(e) {
  if (!e.isTrusted) return;
  for (const t of UNLOCK) document.removeEventListener(t, unlockPlay, true);
  const a = freshCtx();
  if (a.state !== "running") a.resume().catch(() => {});
  loadPiano(a).catch(() => {});
}
for (const t of UNLOCK) document.addEventListener(t, unlockPlay, true);

// The peek on screen (or fading out): { items, names, midis, lit, held, lift, dead, hidden,
// a (its context), notes (holdPiano handles), t0, end (s: when the sound was let go) }.
let peek = null;
const peekLog = []; // what sounded: { midis, how: "hold" | "lift" } (tests)

// (Melody is the right hand; a hymn's treble part is, its bass part the left.)
function handOf(f) {
  const plan = S.P?.views[S.view], both = S.P?.views.both;
  if (!plan || plan.kind === "melody" || !both) return "rh";
  if (both.kind === "hymn") return f.part === both.parts[1] ? "lh" : "rh";
  if (both.kind === "parts") return "rh";
  return Number(f.staff) >= 2 ? "lh" : "rh";
}

function peekStart(hit, e) {
  if (pdf.on || !hit) return null;
  clearPeek();
  const chord = hit.item.g.closest("g.chord") || hit.item.g;
  const items = S.items.filter((it) => it.w && (it.g === chord || chord.contains(it.g)))
    .sort((a, b) => a.fact.midi - b.fact.midi);
  if (!items.length) return null;
  const names = [...new Set(items.map((it) => fullName(it.fact)))];
  const lit = new Map();
  for (const it of items) if (!lit.has(it.fact.midi)) lit.set(it.fact.midi, { hand: handOf(it.fact), label: labelOf(it.fact) });
  const pk = { items, names, midis: [...lit.keys()], lit, held: true, lift: 0, dead: false, hidden: false, a: null, notes: null, t0: 0, end: Infinity, cap: 0, hide: 0 };
  peek = pk;
  drawPeek(pk);
  activity("peek");
  // the sound: the session first, then a context (loading the piano works before audio may start)
  loadPiano(getCtx("press")).catch(() => {});
  pk.cap = setTimeout(() => peekEnd(pk), MAX_HOLD);
  sound(pk);
  return pk;
}

// Start the chord once a context runs and the piano is in: held until the lift if the finger is
// still down, else for LIFT_PLAY — unless the lift was LATE ms ago.
async function sound(pk) {
  const late = () => !pk.held && performance.now() - pk.lift > LATE;
  for (;;) {
    if (pk.dead || late()) return;
    const a = ac;
    if (a && a.state === "running") {
      let piano;
      try { piano = await loadPiano(a); } catch (err) { console.warn("piano", err); return; }
      if (pk.dead || late()) return;
      if (a !== ac || a.state !== "running") continue; // (replaced meanwhile)
      const n = pk.midis.length, level = n === 1 ? 1.4 : Math.min(1, 4 / n); // (as Sing's keys; a big chord doesn't clip)
      pk.a = a;
      pk.t0 = a.currentTime + 0.01;
      pk.notes = pk.midis.map((m) => holdPiano(a, piano, pk.t0, m, level, { sustain: pk.held }));
      peekLog.push((pk.log = { midis: pk.midis, how: pk.held ? "hold" : "lift", cut: false }));
      if (peekLog.length > 20) peekLog.shift();
      if (!pk.held) letGo(pk, pk.t0 + LIFT_PLAY);
      return;
    }
    await sleep(30);
  }
}
function letGo(pk, at, tc) {
  if (!pk.notes || at >= pk.end) return;
  for (const n of pk.notes) n.release(at, tc);
  pk.end = Math.max(at, pk.a.currentTime);
  if (pk.log) pk.log.cut = tc === CUT;
}

// The finger lifted (or MAX_HOLD passed).
function peekEnd(pk) {
  if (!pk || pk.dead || !pk.held) return;
  pk.held = false;
  pk.lift = performance.now();
  clearTimeout(pk.cap);
  // (a touch's end is where iOS lets audio start: resume here if the press couldn't)
  if (!ac || ac.state !== "running") getCtx("tap");
  if (pk.notes) letGo(pk, Math.max(pk.a.currentTime, pk.t0 + MIN_PRESS));
  pk.hide = setTimeout(() => hidePeek(pk), HIDE_AFTER);
}
// The press moved off quickly: it's a swipe — cut the sound, hide at once.
function peekCancel(pk) {
  if (!pk || pk.dead) return;
  pk.dead = true;
  clearTimeout(pk.cap);
  clearTimeout(pk.hide);
  if (pk.notes) letGo(pk, pk.a.currentTime, CUT);
  hidePeek(pk);
  if (peek === pk) peek = null;
}
// Any page turn, a new layout, another song, the page hidden: let go and hide.
function clearPeek() {
  const pk = peek;
  if (!pk) return;
  peek = null;
  pk.dead = true;
  clearTimeout(pk.cap);
  clearTimeout(pk.hide);
  if (pk.notes) letGo(pk, pk.a.currentTime);
  hidePeek(pk);
}

function drawPeek(pk) {
  for (const it of pk.items) {
    it.g.classList.add("peek");
    it.badge?.classList.add("peek");
  }
  const st = stage.getBoundingClientRect();
  let top = Infinity, bottom = -Infinity, cx = 0;
  for (const it of pk.items) {
    const b = it.head.getBoundingClientRect();
    top = Math.min(top, b.top);
    bottom = Math.max(bottom, b.bottom);
    cx += b.left + b.width / 2;
  }
  cx /= pk.items.length;
  // The strip over the stage's foot — or its head when the chord sits low.
  const sh = stripEl.offsetHeight;
  const side = bottom > st.bottom - sh - 12 && top - st.top > sh + 12 ? "top" : "bottom";
  stripEl.dataset.side = side;
  drawStrip(pk);
  stripEl.classList.add("on");
  // The names just above the chord (below it when there's no room), clear of the strip.
  bubbleEl.textContent = pk.names.join(" ");
  bubbleEl.classList.add("on");
  const bw = bubbleEl.offsetWidth, bh = bubbleEl.offsetHeight;
  const minY = side === "top" ? sh + 6 : 6, maxY = (side === "bottom" ? st.height - sh - 6 : st.height - 6) - bh;
  let y = top - st.top - bh - 10;
  if (y < minY) y = bottom - st.top + 10;
  y = Math.max(minY, Math.min(maxY, y));
  const x = Math.max(6, Math.min(st.width - bw - 6, cx - st.left - bw / 2));
  bubbleEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}
function hidePeek(pk) {
  if (pk.hidden) return;
  pk.hidden = true;
  for (const it of pk.items) {
    it.g.classList.remove("peek");
    it.badge?.classList.remove("peek");
  }
  if (peek === pk || !peek || peek.hidden) {
    stripEl.classList.remove("on");
    bubbleEl.classList.remove("on");
  }
}

// The keyboard under the music: the view's range in whole octaves C…B (C3–B5 at least).
function stripRange() {
  const v = S.v;
  if (!v) return [48, 83];
  if (!v.range) {
    let lo = Infinity, hi = -Infinity;
    for (const id of v.ids || []) {
      const f = S.P.facts.get(id);
      if (f && Number.isFinite(f.midi)) { lo = Math.min(lo, f.midi); hi = Math.max(hi, f.midi); }
    }
    v.range = [lo, hi];
  }
  let [lo, hi] = v.range;
  for (const m of peek?.midis || []) { lo = Math.min(lo, m); hi = Math.max(hi, m); }
  lo = Math.min(48, Number.isFinite(lo) ? 12 * Math.floor(lo / 12) : 48);
  hi = Math.max(83, Number.isFinite(hi) ? 12 * Math.floor(hi / 12) + 11 : 83);
  return [Math.max(0, lo), Math.min(127, hi)];
}
function drawStrip(pk) {
  const NS = "http://www.w3.org/2000/svg";
  let svg = stripEl.firstElementChild;
  if (!svg) { svg = document.createElementNS(NS, "svg"); stripEl.appendChild(svg); }
  const r = svg.getBoundingClientRect();
  const W = Math.max(60, Math.round(r.width)), H = Math.max(30, Math.round(r.height));
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const [lo, hi] = stripRange();
  const whites = [];
  for (let m = lo; m <= hi; m++) if (WHITE.has(m % 12)) whites.push(m);
  const ww = Math.min(48, W / whites.length), x0 = (W - ww * whites.length) / 2;
  const xOf = new Map(whites.map((m, i) => [m, x0 + i * ww]));
  const f1 = (x) => Math.round(x * 10) / 10;
  const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const label = (L, cx, y, fs) => `<text x="${f1(cx)}" y="${f1(y)}" font-size="${f1(fs)}" text-anchor="middle" font-weight="700" fill="#fff" font-family="-apple-system, system-ui, 'Segoe UI', 'Apple Symbols', sans-serif">${esc(L.letter)}${L.acc ? `<tspan font-size="${f1(fs * 0.8)}">${esc(L.acc)}</tspan>` : ""}</text>`;
  const r0 = Math.max(2, Math.min(ww * 0.11, 4)), dotY = H - r0 - 3;
  let s = "", tops = "";
  for (const m of whites) {
    const x = xOf.get(m), L = pk.lit.get(m);
    s += `<rect class="key${L ? " lit" : ""}" data-midi="${m}"${L ? ` data-hand="${L.hand}"` : ""} x="${f1(x + 0.5)}" y="0" width="${f1(ww - 1)}" height="${H}" rx="${f1(Math.min(3, ww * 0.12))}" fill="${L ? HAND[L.hand] : "#f3f0e8"}"/>`;
    if (L) s += label(L.label, x + ww / 2, dotY - r0 - 3, Math.min(ww * 0.58, H * 0.22));
    if (m === 60) s += `<circle class="mc" cx="${f1(x + ww / 2)}" cy="${f1(dotY)}" r="${f1(r0)}" fill="${L ? "#e8e4ff" : "#9b9aa6"}"/>`;
  }
  const bw = ww * 0.58, bh = H * 0.6;
  for (let m = lo; m <= hi; m++) {
    if (WHITE.has(m % 12) || !xOf.has(m + 1)) continue;
    const x = xOf.get(m + 1) - bw / 2, L = pk.lit.get(m);
    tops += `<rect class="key${L ? " lit" : ""}" data-midi="${m}"${L ? ` data-hand="${L.hand}"` : ""} x="${f1(x)}" y="0" width="${f1(bw)}" height="${f1(bh)}" rx="${f1(Math.min(2, bw * 0.15))}" fill="${L ? HAND[L.hand] : "#101018"}" stroke="#14142c" stroke-width="1"/>`;
    if (L) {
      // (a black key is too narrow for its name: a tag in its colour just under it)
      const fs = Math.min(ww * 0.6, H * 0.2), tw = fs * (L.label.acc ? 1.35 : 0.85) + 4, th = fs * 1.25;
      tops += `<rect class="tag" x="${f1(x + bw / 2 - tw / 2)}" y="${f1(bh + 2)}" width="${f1(tw)}" height="${f1(th)}" rx="${f1(th / 3)}" fill="${HAND[L.hand]}" stroke="#14142c" stroke-width="1"/>`;
      tops += label(L.label, x + bw / 2, bh + 2 + th * 0.78, fs);
    }
  }
  svg.innerHTML = s + tops;
}

// ---------------------------------------------------------------------------
// Fading: after a few practice days at a level, the bar offers fewer names — never by itself,
// never scored. A practice day: a calendar day the song was on screen (the page visible) for
// ≥ 5 minutes, with a page turn or a peek. Kept per song in resonate.play[id].days =
// { n (days at this level), ask (offer at n ≥ ask), d (today), ms (visible today), act, done }.

const DAY_MS = 5 * 60 * 1000;
const TICK = 15000;
const ASK = 3;
let lastTick = performance.now(), daysSaved = 0;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const count = (v, dflt) => (Number.isInteger(v) && v >= 0 ? v : dflt);
function days() {
  let x = S.st.days;
  if (!x || typeof x !== "object" || Array.isArray(x)) x = S.st.days = {};
  x.n = count(x.n, 0);
  x.ask = count(x.ask, ASK);
  const t = today();
  if (x.d !== t) Object.assign(x, { d: t, ms: 0, act: false, done: false });
  x.ms = Number.isFinite(x.ms) && x.ms > 0 ? x.ms : 0;
  return x;
}
function countDay(x) {
  if (!x.done && x.act && x.ms >= DAY_MS) { x.n++; x.done = true; }
}
// A page turn or a peek on the open song.
function activity() {
  if (!S.song || !S.ready) return;
  const x = days();
  if (x.act) return;
  x.act = true;
  countDay(x);
  if (x.done) saveState(); // (the day counted just now)
}
setInterval(() => {
  const now = performance.now(), dt = Math.min(TICK, now - lastTick);
  lastTick = now;
  if (!S.song || !S.ready || pdf.on || document.visibilityState !== "visible") return;
  const x = days();
  if (x.done) return; // (today is counted: nothing more to keep)
  x.ms += dt;
  countDay(x);
  if (x.done || Date.now() - daysSaved >= 30000) { daysSaved = Date.now(); saveState(); } // (≤ every 30 s, and at pagehide)
}, TICK);

// The level was changed by hand: the count starts again.
function levelChanged() {
  if (!S.song) return;
  const x = days();
  x.n = 0;
  x.ask = ASK;
  hideOffer();
}
function songShown() {
  lastTick = performance.now();
  showOffer();
}
function songClosed() { hideOffer(); }

let offerTo = null; // the level the chip offers
function showOffer() {
  const x = S.st.days;
  const due = S.names !== "off" && x && typeof x === "object" && count(x.n, 0) >= count(x.ask, ASK);
  if (!due) return hideOffer();
  offerTo = S.names === "all" ? "some" : "off";
  const yes = document.createElement("button");
  yes.type = "button";
  yes.id = "offer-yes";
  yes.textContent = offerTo === "some" ? "Some" : "Off";
  yes.addEventListener("click", () => { const to = offerTo; hideOffer(); if (to) setNames(to, true); });
  const no = document.createElement("button");
  no.type = "button";
  no.id = "offer-no";
  no.textContent = "✕";
  no.setAttribute("aria-label", "Not now");
  no.title = "Not now";
  no.addEventListener("click", () => {
    const d = days();
    d.ask = d.n + ASK;
    hideOffer();
    saveState();
  });
  const t = document.createElement("span");
  t.textContent = "Fewer names?";
  yes.disabled = no.disabled = pdf.on;
  offerEl.replaceChildren(t, yes, no);
  offerEl.hidden = false;
}
function hideOffer() {
  offerTo = null;
  offerEl.hidden = true;
  offerEl.replaceChildren();
}

// ---------------------------------------------------------------------------
// The original PDF (📄): for a song made with PDF → Song whose PDF is on this device. pdf.js
// (shipped for the OMR) draws one page — two side by side when each is still ≥ 75% of print
// size — into one reused canvas at the screen's pixel ratio; the same keys, taps and swipes
// turn its pages. The sheet stays laid out underneath (hidden), so going back is instant and
// at its place. There's no mapping between the two.

const PDFJS = new URL("./omr/pdfjs/", import.meta.url).href;
const PRINT = 96 / 72; // CSS px per pt at print size
const pdf = { has: false, on: false, gen: 0, doc: null, pages: 0, page: 1, spread: false, canvas: null, sizes: [], busy: false };
let pdfLib = null;
let pdfTask = null; // the page drawing under way (pdf.js RenderTask)
async function pdfjs() {
  if (!pdfLib) {
    const lib = await import("./omr/pdfjs/pdf.min.mjs");
    lib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.mjs";
    pdfLib = lib;
  }
  return pdfLib;
}

async function pdfCheck(id, source) {
  if (source !== "pdf") return;
  let has = false;
  try { has = (await listPdfIds()).includes(id); } catch {}
  if (S.song !== id) return;
  pdf.has = has;
  pdfBtn.hidden = !has;
}

pdfBtn.addEventListener("click", () => (pdf.on ? pdfOff() : pdfOn()));

function pdfControls() {
  pdfBtn.setAttribute("aria-pressed", String(pdf.on));
  if (pdf.on) stage.dataset.pdf = "";
  else delete stage.dataset.pdf;
  handsSel.disabled = pdf.on || !S.ready;
  for (const b of offerEl.querySelectorAll("button")) b.disabled = pdf.on; // (kept in place: the bar doesn't move)
  sizeButtons();
  // (the PDF also opens when the sheet couldn't be drawn)
  if (pdf.on || S.ready) pager();
  else {
    pgEl.textContent = S.failed ? "" : "…";
    prevBtn.disabled = nextBtn.disabled = true;
  }
}

async function pdfOn() {
  if (!pdf.has || pdf.on || !S.song) return;
  const id = S.song, g = ++pdf.gen;
  clearPeek();
  pdf.on = true;
  pdf.busy = true;
  pdfControls();
  try {
    const [lib, rec] = await Promise.all([pdfjs(), getPdf(id)]);
    if (!rec?.pdf) throw new Error("no PDF stored");
    const src = rec.pdf;
    const data = src instanceof Blob ? new Uint8Array(await src.arrayBuffer())
      : ArrayBuffer.isView(src) ? new Uint8Array(src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength))
      : new Uint8Array(src.slice(0)); // (a copy: pdf.js hands the data to its worker)
    const doc = await lib.getDocument({ data, wasmUrl: PDFJS + "wasm/", standardFontDataUrl: PDFJS + "standard_fonts/", iccUrl: PDFJS + "iccs/" }).promise;
    if (g !== pdf.gen) { doc.destroy().catch?.(() => {}); return; }
    pdf.doc = doc;
    pdf.pages = doc.numPages;
    const p0 = Number(S.st.pdfPage);
    pdf.page = Number.isInteger(p0) && p0 >= 1 && p0 <= pdf.pages ? p0 : 1;
    pdf.busy = false;
    await pdfRender();
  } catch (err) {
    if (g !== pdf.gen) return;
    console.warn("pdf", err);
    pdfOff();
    showMsg("Couldn't open the PDF.");
    setTimeout(() => { if (msgEl.textContent === "Couldn't open the PDF.") showMsg(""); }, 3000);
  }
}

function pdfOff() {
  pdf.gen++;
  pdf.on = false;
  pdf.busy = false;
  pdfTask?.cancel();
  if (pdf.canvas) {
    pdf.canvas.width = pdf.canvas.height = 0; // (iOS caps the canvas memory of a page)
    pdf.canvas.remove();
  }
  const doc = pdf.doc;
  pdf.doc = null;
  try { doc?.destroy()?.catch?.(() => {}); } catch {}
  pdfControls();
}

const pdfLast = () => (pdf.spread ? (pdf.pages % 2 ? pdf.pages : pdf.pages - 1) : pdf.pages);
function pdfPager() {
  if (pdf.busy || !pdf.doc) {
    pgEl.textContent = "…";
    prevBtn.disabled = nextBtn.disabled = true;
    return;
  }
  const two = pdf.spread && pdf.page < pdf.pages;
  pgEl.textContent = (two ? `${pdf.page}–${pdf.page + 1}` : `${pdf.page}`) + ` / ${pdf.pages}`;
  prevBtn.disabled = pdf.page <= 1;
  nextBtn.disabled = pdf.page >= pdfLast();
}
function pdfTurn(d) {
  if (!pdf.doc || pdf.busy) return false;
  const p = Math.max(1, Math.min(pdfLast(), pdf.page + d * (pdf.spread ? 2 : 1)));
  if (p === pdf.page) return false;
  pdf.page = p;
  S.st.pdfPage = p;
  saveSoon();
  pdfPager();
  pdfRender();
  return true;
}

// Draw the shown page(s) fitted to the stage. A newer call wins: it cancels a drawing still under
// way first (pdf.js refuses a second render on a canvas in use — two quick pedal presses left the
// newer page undrawn and the older one finishing on the canvas).
async function pdfRender() {
  const doc = pdf.doc;
  if (!doc || !pdf.on) return;
  const g = ++pdf.gen;
  const cs = getComputedStyle(stage);
  const W = Math.floor(stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
  const H = Math.floor(stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
  if (W < 60 || H < 60) return;
  const t0 = performance.now();
  const first = await doc.getPage(1);
  if (g !== pdf.gen) return;
  const v1 = first.getViewport({ scale: 1 });
  const fit = (w, vp) => Math.min(w / vp.width, H / vp.height);
  pdf.spread = W > H && pdf.pages > 1 && fit(Math.floor(W / 2), v1) >= 0.75 * PRINT;
  if (pdf.spread && pdf.page % 2 === 0) pdf.page--;
  const list = pdf.spread ? [pdf.page, pdf.page + 1].filter((p) => p <= pdf.pages) : [pdf.page];
  const each = pdf.spread ? Math.floor(W / 2) : W;
  const pages = await Promise.all(list.map((p) => (p === 1 ? first : doc.getPage(p))));
  if (g !== pdf.gen) return;
  if (pdfTask) {
    const t = pdfTask;
    pdfTask = null;
    t.cancel();
    await t.promise.catch(() => {});
    if (g !== pdf.gen) return;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const boxes = pages.map((pg) => {
    const vp = pg.getViewport({ scale: 1 }), s = fit(each, vp);
    return { pg, s, w: Math.floor(vp.width * s), h: Math.floor(vp.height * s) };
  });
  const cw = boxes.reduce((a, b) => a + b.w, 0), ch = Math.max(...boxes.map((b) => b.h));
  const canvas = (pdf.canvas ||= Object.assign(document.createElement("canvas"), { id: "pdfview" }));
  if (!canvas.isConnected) stage.appendChild(canvas);
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  canvas.style.width = cw + "px";
  canvas.style.height = ch + "px";
  canvas.style.left = pdf.spread && list.length === 1 ? "25%" : ""; // (the last odd page in its half)
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  pdfPager();
  // (one page after the other, each in its place: pdf.js fills the whole canvas with its
  // background before drawing, so it gets a transparent one and the canvas was made white)
  let x = 0;
  for (const b of boxes) {
    if (g !== pdf.gen) return;
    const vp = b.pg.getViewport({ scale: b.s * dpr });
    const task = (pdfTask = b.pg.render({ canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, Math.round(x * dpr), 0], background: "rgba(0,0,0,0)" }));
    try {
      await task.promise;
    } catch (err) { if (g === pdf.gen && err?.name !== "RenderingCancelledException") console.warn("pdf page", err); return; }
    finally { if (pdfTask === task) pdfTask = null; }
    x += b.w;
  }
  S.t.pdf = ms(t0);
}

// ---------------------------------------------------------------------------
// Rotation / resize: the same bar stays on screen.

let resizeTimer = 0;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (pdf.on) pdfRender();
    if (!S.P || !tk || S.failed) return;
    const L = measure();
    if (!L) return;
    if (S.waiting) { loadView(S.gen); return; } // (the stage had no size when it loaded)
    if (S.loaded !== S.v) return;
    if (Math.abs(L.W - S.W) < 2 && Math.abs(L.H - S.H) < 2) return;
    relayout();
  }, 150);
}).observe(stage);

// ---------------------------------------------------------------------------
// The screen stays on while a song is shown.

let wake = null, wakeRequests = 0;
async function holdWake() {
  if (!S.ready || document.visibilityState !== "visible" || !navigator.wakeLock) return;
  if (wake && !wake.released) return;
  try {
    wakeRequests++;
    const w = await navigator.wakeLock.request("screen");
    wake = w;
    w?.addEventListener?.("release", () => { if (wake === w) wake = null; });
  } catch { wake = null; }
}
function dropWake() {
  const w = wake;
  wake = null;
  try { w?.release?.()?.catch?.(() => {}); } catch {}
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") { lastTick = performance.now(); dropWake(); holdWake(); }
  else { clearPeek(); saveState(); }
});
// Leaving the page: give the tab's audio session back (iOS keeps a page's type for the whole
// tab: a "playback" left behind kept the Tuner's microphone from starting) and the PDF's canvas.
window.addEventListener("pagehide", () => {
  clearPeek();
  if (pdf.on) pdfOff();
  saveState();
  dropWake();
  if (ac) ac.close().catch(() => {});
  ac = null;
  setSession("auto");
});
window.addEventListener("pageshow", (e) => {
  if (!e.persisted) return;
  holdWake();
  lastTick = performance.now();
  for (const t of UNLOCK) document.addEventListener(t, unlockPlay, true); // (the next tap starts the audio again)
});

// The cloud sync changed My songs: list again; the open song may be gone.
window.addEventListener("resonate:remote", async (e) => {
  if (!e.detail?.songs) return;
  await fillSongs();
  if (S.song && !known(S.song)) open(FIRST);
});

// ---------------------------------------------------------------------------
// Start: the engine, the song list and the song at once.

engine().catch(() => {});
setNames(S.names);
(async () => {
  const listed = await fillSongs();
  const saved = recall(K.song);
  if (listed) prune();
  await open(known(saved) ? saved : FIRST);
})();

// Every head of every page of the current layout, counted from the SVG (tests).
function countAll() {
  let rendered = 0;
  for (let p = 1; p <= S.pages; p++) {
    if (!S.counted.has(p)) {
      const had = cache.has(p);
      const doc = new DOMParser().parseFromString(svgOf(p), "image/svg+xml");
      S.counted.set(p, [...doc.querySelectorAll("g.note")].filter((g) => g.querySelector(":scope > g.notehead")).length);
      if (!had) cache.delete(p);
    }
    rendered += S.counted.get(p);
  }
  return { rendered, pitched: S.v?.pitched ?? 0 };
}

window.resonateDebug = () => {
  const plan = S.P?.views[S.view];
  let rendered = 0;
  for (const n of S.counted.values()) rendered += n;
  return {
    play: {
      ready: S.ready, failed: S.failed, song: S.song, title: S.title, view: S.view,
      views: S.P ? Object.keys(S.P.views) : [], parts: S.P?.parts ?? [],
      keep: plan ? { ...plan, ids: S.v?.ids ?? [] } : null,
      pages: S.pages, page: S.page, shown: shownPages(), spread: S.spread, sp: S.sp, scale: S.scale, size: S.size,
      W: S.W, H: S.H, names: S.names, at: S.at,
      counts: { rendered, pitched: S.v?.pitched ?? 0, pages: S.counted.size }, countAll,
      get facts() { return S.P ? Object.fromEntries(S.P.facts) : {}; },
      state: { ...S.st },
      peek: peek && !peek.hidden ? {
        ids: peek.items.map((it) => it.id), names: peek.names.join(" "), held: peek.held,
        sounding: peek.notes && (peek.held || (peek.a && peek.a.currentTime < peek.end + 0.3)) ? [...peek.midis] : [],
        lit: [...stripEl.querySelectorAll("rect.lit")].map((r) => ({ midi: Number(r.dataset.midi), hand: r.dataset.hand })),
        side: stripEl.dataset.side || "bottom",
      } : null,
      peekLog: peekLog.map((x) => ({ ...x })),
      audio: ac ? { state: ac.state, stuck: acStuck, session: navigator.audioSession?.type ?? null } : null,
      offer: { shown: !offerEl.hidden, to: offerTo, days: S.st.days ? { ...S.st.days } : null },
      pdf: {
        has: pdf.has, on: pdf.on, busy: pdf.busy, page: pdf.page, pages: pdf.pages, spread: pdf.spread,
        canvas: pdf.canvas?.isConnected ? [pdf.canvas.width, pdf.canvas.height] : null,
      },
      wake: { held: !!wake && !wake.released, requests: wakeRequests },
      t: { ...S.t },
    },
  };
};
