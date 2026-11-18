// Play: a song's piano part as sheet music, one screen at a time, with each note's name on its
// head (All → Some → Off), for reading at the piano on an iPad.
//
//   song (catalog.js) → prepare (playprep.js: parts, views, pitch facts) → buildView (the view's
//   MusicXML, cached per song) → Verovio (one toolkit per page load; one page laid out to the
//   stage's exact size, only the shown pages drawn) → decorate (playnames.js: the badges).
//
// The place is kept by written measure (S.at): rotation, −/+, a hands switch and reopening the
// song all come back to the page holding that bar.
//
// ▶ plays the view (playtime.js: the song's written timeline, Sing's performance order): a
// stretch dragged on the page — once or round after round — or from the page's first bar to the
// end, its notes lit as they sound and the page turning with the music.
import { spaceChanged } from "./nav.js?v=82";
import { SAMPLES, loadSong, songChoices } from "./catalog.js?v=82";
import { prepare, buildView, VIEW_LABELS, keeps } from "./playprep.js?v=82";
import { decorate, fullName, labelOf } from "./playnames.js?v=82";
import { loadPiano, pianoNow, holdPiano, primeHold, playPiano, keepAlive, pianoBus } from "./piano.js?v=82";
import { parseMusicXml, DEFAULT_TEMPO } from "./musicxml.js?v=82";
import { timeline, track, onsets, nextOnset, barAt } from "./playtime.js?v=82";
import { listPdfIds, getPdf, persistent, dbGen } from "./library.js?v=82";

const $ = (id) => document.getElementById(id);
const stage = $("stage"), msgEl = $("msg"), pgEl = $("pg");
const songSel = $("song"), samplesEl = $("samples"), mineEl = $("mine"), handsSel = $("hands");
const namesBtn = $("names"), smallerBtn = $("smaller"), biggerBtn = $("bigger"), prevBtn = $("prev"), nextBtn = $("next");
const pdfBtn = $("pdf"), offerEl = $("offer"), stripEl = $("strip"), bubbleEl = $("bubble"), keysBtn = $("keys"), dockEl = $("dock");
const playBtn = $("play"), selbar = $("selbar"), selPlayBtn = $("sel-play"), selLoopBtn = $("sel-loop"), speedSel = $("speed"), selClearBtn = $("sel-clear");
const hearEl = $("hear");

const K = {
  play: "resonate.play",        // { songId: { names, view, at, pdfPage, speed, hear, days } } — the account's (space.js DATA_KEYS)
  zoom: "resonate.play.zoom",   // − / +: steps from the default ("+1" … "+8", "-1" … "-8"; none: the default) — this device's (the piano views)
  zoomScore: "resonate.play.zoom.score", // the same for the full score: a size picked for the piano
                                // doesn't change the score, nor the other way round — this device's
  names: "resonate.play.names", // the level a song opened for the first time starts at — this device's
  keys: "resonate.play.keys",   // the keyboard under the music (🎹): "on" | "off" (none: on a tablet or a desktop, off on a phone) — this device's
  gen: "resonate.play.gen",     // the songs' database generation seen at the last visit — this device's
  song: "resonate.sing.song",   // the song open, shared with Sing
  timing: "resonate.sing.timing", // Sing's: { songId: { bpm (a tempo typed or tapped for the song), … } } — read only
};
// v77–78's size prefs: a size chosen then (on a tablet 16 was the default) would hide the
// printed-page default — removed, so every device starts at it.
const OLD_SIZE_KEYS = ["resonate.play.size", "resonate.play.size.score"];
// The default on a tablet and a desktop: the printed page's density — PAPER staff spaces across
// the page (margins in), as many bars a system as the printed piano/vocal sheets. Calibrated on the
// owner's five converted songs against their own printed system breaks (Audiveris keeps them:
// <print new-system>): at 90 across, bars a system (mean over each whole song) come out within
// −21%…+9% of print, 0.97× overall — Killing Me Softly 3.14–3.29 (print 3.14), Songbird 4.41
// (4.41), The Longest Time 4.05 (3.71), Piano Man 4.9–5.0 (5.26), Wichita Lineman 2.43 (3.09) —
// and the median the print's on four of five; 100 across put 1.16× print's bars in a system. On
// an 11" iPad Air in portrait that is 9.11 px a staff space, ~1.74 mm: the printed size. The
// width only (rotated, the same density across the long side); a desktop's clamped to DESK; a
// phone — or a tablet window narrower than TABLET_W (Split View, Slide Over: 5 px at 320 wide) —
// shows what fits (PHONE).
const PAPER = 90, DESK = [9.5, 12.5], PHONE = 9.5, TABLET_W = 700;
// Two pages side by side only when each holds a system at about the printed density.
const SPREAD = 110;
// − / +: a step is ×STEP from the default (the size it shows: the printed density, or its fit),
// up to STEPS either way, never under MIN_SP; the default itself is step 0. Kept as steps — the
// same steps from the default in either orientation, on any iPad: "+" in portrait is one step
// bigger in landscape too, not one absolute size (v79's 8 px from portrait made landscape smaller
// than its default, and − / + never came back to the default).
const STEP = 1.15, STEPS = 8, MIN_SP = 5;
// The smallest name letter on screen (CSS px): − to 6 or 5 px a staff space makes heads ~6 px —
// a pill grows to hold a letter this size where it touches no other pill (playnames growPills).
const MIN_LETTER = 8;
// Two systems a page where the stage allows (in landscape): the default steps down by FIT_STEP,
// not under FIT_FLOOR of the device's portrait density on a tablet (two systems of voice + piano +
// one more staff need ~85 staff spaces of the short side less the bar: about 0.9 of it — Piano Man's
// 4-staff score two a page at 8.85 on an 11" Air, 7.51 on a mini; v79's 0.75 of the landscape size
// stopped at 8.5 on a mini: one system a page, 36 pages), of the default on a desktop; else one
// system a page. The keyboard (🎹) takes part of that height (~10% in landscape): with it on, the
// floor shrinks with the stage — the music gives up a little size, not its second system (Piano
// Man's Full score went to one system a page, 41–42 pages, on every iPad with the floor kept).
const FIT_STEP = 0.93, FIT_FLOOR = { tablet: 0.9, desktop: 0.75 };
// The largest step ≤ x (the smallest step when none is), of a step list.
const stepDown = (x, list) => [...list].reverse().find((s) => s <= x + 0.01) ?? list[0];
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
  // (note@staff / chord@staff: a cross-staff note's staff; staff@n: each staff's number)
  svgAdditionalAttribute: ["note@pname", "note@oct", "note@oct.ges", "accid@accid", "accid@accid.ges", "note@staff", "chord@staff", "staff@n"],
  pageMarginLeft: 60, pageMarginRight: 60, pageMarginTop: 40, pageMarginBottom: 20,
  spacingStaff: 8, spacingBraceGroup: 8,
  justifyVertically: true, justificationStaff: 0.2, justificationBraceGroup: 0.2,
  lyricWordSpace: 3,
};
// The full score leaves a staff that rests through a whole system out of it, as printed (the voice
// through a piano interlude, an accordion where it doesn't play): Verovio's "auto" condensing,
// which runs only with more than one group symbol (playprep gives each single staff an unmarked
// group; the piano's brace keeps its two staves together). The first system shows every staff
// (condenseFirstPage off — and its marks: the tempo over a piano intro is the voice's), and
// systems with a tempo or a fermata are condensed too (condenseTempoPages on would show every
// staff there, despite its name). A staff keeps a system where it has a note, a clef or a mark
// (playprep keepMarks). No system dividers (Verovio's "auto" draws a heavy "//" between systems
// of more than one group; piano/vocal music has none). The other views: Verovio's defaults.
const CONDENSE = {
  score: { condense: "auto", condenseFirstPage: false, condenseTempoPages: false, systemDivider: "none" },
  other: { condense: "auto", condenseFirstPage: false, condenseTempoPages: false, systemDivider: "auto" },
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

// "tablet" (a coarse pointer, the screen's short side ≥ 700), "phone" (coarse, smaller), "desktop".
function device() {
  if (!matchMedia("(any-pointer: coarse)").matches) return "desktop";
  return Math.min(screen.width, screen.height) >= 700 ? "tablet" : "phone";
}
// The size pref of a view: the full score has its own. → { key, step (− / +: steps from the
// default, 0 = the default) }
const sizeKind = (view) => (view === "score" ? "score" : "piano");
function savedSize(kind) {
  const key = kind === "score" ? K.zoomScore : K.zoom, v = recall(key);
  return { key, step: /^[+-][1-8]$/.test(v || "") ? Number(v) : 0 };
}
for (const k of OLD_SIZE_KEYS) keep(k, null);

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
  sizes: { piano: savedSize("piano"), score: savedSize("score") }, // this device's size prefs
  step: 0,          // the shown view's steps from the default (− / +; 0: the default — useSize)
  W: 0, H: 0, spread: false, sp: 0, scale: 0,
  cap: 0,           // the largest staff space the screen allows (≥ 40 across, a whole system a page)
  base: 0,          // the default's staff space before the two-systems fit (the printed density)
  auto: 0,          // the default's staff space (after its fit): what a step is taken from
  mode: "",         // how sp was chosen: "set" (− / +; a phone's piano views), "fit" / "fitted" (the default), "one" (one system a page), "two" (a phone's score)
  pages: 0, page: 1,
  at: 0,            // written measure index the shown place is anchored to
  items: [],        // decorate() items of the shown pages (heads with their facts and boxes)
  counted: new Map(), // page → notes with a head drawn (this layout)
  lgen: 0,          // layout generation: the page cache and prefetches belong to one
  mine: new Set(),  // library song ids
  t: {},            // timings (ms)
  fitLog: [],       // the two-system sizes tried for the default: [{ sp, share }] (tests)
  xml: "",          // the song's MusicXML (as catalog.js gives it: Sing's order is read from it)
  T: null,          // playtime timeline(): every note and rest at its written place (built once a song)
  Tid: null,        // id → its timeline element
  sing: undefined,  // Sing's parse: { order (written bar per played bar) | null, tempo } (null: failed)
  qs: null,         // { view, qs }: the view's onsets (written q) — the columns a stretch is picked by
  sel: null,        // the stretch picked: { q0, q1 (its last onset), end (where it stops) } in written q
  speed: 1,         // ▶'s speed (resonate.play[id].speed)
  showGen: 0,       // bumped by every drawing of the shown pages
  hear: null,       // { P, view, groups }: what ▶ can play in the view, a chip each (hearGroups)
};
useSize();
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

// A song's record goes with the song (Sing's ✕ and the sync's deletion remove it). What's left —
// a song deleted in another tab while this one still wrote its record — goes here, only when the
// list can be trusted: the songs are really kept (a library that failed to open lists none) and
// their database is the one seen on the last visit (one the browser cleared starts empty; the
// sync brings its songs back under the same ids).
async function prune() {
  if (spaceChanged() || !(await persistent())) return;
  const gen = dbGen(), seen = recall(K.gen);
  if (spaceChanged()) return;
  keep(K.gen, gen);
  if (!gen || seen !== gen) return;
  const all = readPlay();
  let n = 0;
  for (const id of Object.keys(all)) if (!(id in SAMPLES) && !S.mine.has(id) && id !== S.song) { delete all[id]; n++; }
  if (n) writePlay(all);
}

// ---------------------------------------------------------------------------
// The engine: Verovio, imported in parallel with the song list and the song.

let engineP = null, engineFails = 0;
function engine() {
  return (engineP ||= (async () => {
    const t0 = performance.now();
    // (a browser keeps a failed module import for the page's life: a retry asks for a new address)
    const q = engineFails ? `?r=${engineFails}` : "";
    const [{ default: createVerovioModule }, { VerovioToolkit }] = await Promise.all([
      import(`./vendor/verovio-6.4.0/verovio-module.mjs${q}`), import(`./vendor/verovio-6.4.0/verovio.mjs${q}`)]);
    const t = new VerovioToolkit(await createVerovioModule());
    t.setOptions(VRV);
    S.t.engine = ms(t0);
    tk = t;
    return t;
  })().catch((err) => { engineP = null; engineFails++; throw err; }));
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
    for (const b of [smallerBtn, biggerBtn, prevBtn, nextBtn, playBtn]) b.disabled = true;
    placeSelbar(); // (the stretch's controls wait for the drawing)
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
  stopPlay();
  S.ready = false;
  S.failed = kind;
  renderHear();
  clearPages();
  setBusy(false);
  pgEl.textContent = "";
  showMsg(kind === "engine" ? "Couldn't load the music — check the connection." : "Couldn't open this song.");
  placeSelbar();
}

async function open(id) {
  const gen = ++S.gen;
  if (S.song && S.song !== id) { saveState(); songClosed(); }
  clearPeek();
  stopPlay();
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
  S.xml = "";
  S.T = S.Tid = S.qs = S.sel = null;
  S.sing = undefined;
  renderHear();
  placeSelbar();
  S.st = readPlay()[id] || {};
  if (!S.st || typeof S.st !== "object") S.st = {};
  S.speed = SPEEDS.includes(S.st.speed) ? S.st.speed : 1;
  speedSel.value = String(S.speed);
  S.at = Number.isInteger(S.st.at) && S.st.at >= 0 ? S.st.at : 0;
  // (a song opened for the first time starts at the level chosen last, and keeps it: a level
  // chosen later on another song leaves this one alone)
  const last = recall(K.names);
  setNames(LEVELS.includes(S.st.names) ? S.st.names : LEVELS.includes(last) ? last : "all");
  if (!LEVELS.includes(S.st.names)) S.st.names = S.names;
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
  S.xml = song.xml;
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
  if (!ac) idle(() => { if (!ac) warmAudio(); }); // (the piano ready for the first press)
  // (what ▶ needs, read while the page waits for a hand: the timeline, Sing's order)
  idle(() => { if (S.song === id && S.P) { songTime(); songSing(); } });
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
  useSize();
  setBusy(true);
  await paint();
  if (gen !== S.gen) return;
  const L = measure();
  if (!L) { S.waiting = true; return; } // no stage yet: the resize observer loads it
  setPageSize(L);
  const t = performance.now();
  let ok = false;
  // (a B♭ clarinet's or a horn's part at the pitch a pianist plays — only where a part transposes:
  // the option moves positioned rests in any score, Songbird's bass rests into the gap above)
  const score = S.P.views[S.view]?.kind === "score";
  const tr = /<transpose\b/.test(v.xml);
  // (the MEI below is already at sounding pitch: loaded without transposing again)
  tk.setOptions({ transposeToSoundingPitch: tr && !v.mei, ...(score ? CONDENSE.score : CONDENSE.other) });
  try {
    ok = tk.loadData(v.mei || v.xml);
    // The full score's endings once, over the top staff, as printed: Verovio draws an ending over
    // the first staff of every staff group (the voice's, the piano's, an accordion's) unless the
    // score definition says ending.rend="top", which MusicXML can't say — so a full score with
    // endings goes through MEI once (~5–20 ms out, MEI loads faster than MusicXML; ids kept). With
    // a transposing part the MEI is at sounding pitch (Verovio drops trans.* once it has
    // transposed): it's loaded with transposing off.
    if (ok && score && !v.mei && /<ending\b/.test(v.xml)) {
      let mei = null;
      try { mei = tk.getMEI().replace(/<scoreDef\b/, '<scoreDef ending.rend="top"'); } catch {}
      if (mei) tk.setOptions({ transposeToSoundingPitch: false });
      if (mei && tk.loadData(mei)) v.mei = mei;
      else { tk.setOptions({ transposeToSoundingPitch: tr }); ok = tk.loadData(v.xml); }
    }
  } catch (err) { console.warn("loadData", err); }
  S.t.data = ms(t);
  S.loaded = ok ? v : null;
  if (!ok || !tk.getPageCount()) return fail("song");
  placed(settle(L));
}

// The shown view's size pref: S.step (steps from the default; 0: the default).
function useSize() {
  S.step = S.sizes[sizeKind(S.view)].step;
}

// Systems' heights in staff spaces, measured on the owner's songs (laid out unjustified, the page
// margins in). The tallest, which a page must hold: 12 a staff in a piano view; a full score's
// 3 staves SCORE_SYS, SCORE_STAFF less for a staff less and SCORE_EXTRA more for each staff beyond
// (the accordion's system, 53 — at 7.5 Piano Man's ran off the foot of the page). Two systems,
// for the default's fit (twoNeed, about the 3rd quartile; the fit checks the real layout): voice +
// piano 61–73 (Songbird's dynamics and hairpins 78), with the accordion 81–93, a hymn or a tune in
// the piano 52–63, a grand staff 38–57, one staff 24–43.
const SCORE_SYS = 38, SCORE_STAFF = 7.5, SCORE_EXTRA = 15;
function tallest(plan) {
  const staves = plan?.staves || 1;
  if (plan?.kind !== "score") return 12 * staves;
  return SCORE_SYS + (staves > 3 ? SCORE_EXTRA : SCORE_STAFF) * (staves - 3);
}
function twoNeed(plan) {
  const staves = plan?.staves || 1;
  if (plan?.kind === "score") return 70 + (staves > 3 ? 15 : 8) * (staves - 3);
  return staves > 1 ? 50 : 36;
}
const scaleOf = (sp) => Math.max(5, Math.round(sp / 0.18)); // (Verovio's scale: a whole percent)

// The page size for the stage: the default (none chosen) — on a tablet the printed page's density
// across the stage's width (PAPER), on a desktop the same within DESK, then two systems a page
// where the stage allows (fit — in landscape); a phone, or a tablet window narrower than TABLET_W,
// shows what fits (phoneSize, v78's rules) — or S.step steps from it (stepped: − / +), as two pages
// side by side when each still holds SPREAD staff spaces (zoomed well out, in landscape). Always
// ≥ 40 staff spaces across a system and a whole system on a page (S.cap).
// single: no spread (a view that fits on one page is laid out at the stage's full width).
// → { W, H, spread, pw (page width), cap, sp, scale, mode ("fit" | "fitted" | "set" | the phone's
//   "two" / "one"), base (the default before the fit), auto (stepped: the default's size) }
// The stage's inner size (px, floored).
function stageSize() {
  const cs = getComputedStyle(stage);
  return {
    W: Math.floor(stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)),
    H: Math.floor(stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)),
  };
}
function measure(single = false) {
  const { W, H } = stageSize();
  if (W < 60 || H < 60 || !S.P) return null;
  const plan = S.P.views[S.view];
  const cap = Math.min(W / 40, H / tallest(plan));
  const at = (sp, mode, more) => ({ W, H, spread: false, pw: W, cap, sp, scale: scaleOf(sp), mode, base: sp, ...more });
  const dev = device();
  let L;
  if (dev === "phone" || (dev === "tablet" && W < TABLET_W)) L = phoneSize(plan, at, W, H, cap);
  else {
    const paper = W / PAPER;
    const base = Math.min(cap, dev === "tablet" ? Math.max(MIN_SP, paper) : Math.min(DESK[1], Math.max(DESK[0], paper)));
    // (a page size this view was already fitted to: laid out once — a rotation back)
    const hit = S.v?.fit?.get(fitKey(W, H));
    L = hit ? at(hit.sp, "fitted", { base }) : at(base, "fit", { base });
  }
  // (a step from the default needs the default's size: known unless it's still to be fitted)
  return S.step && !needsFit(L) ? stepped(L, single) : L;
}
// The default still to be checked on the layout (fit, phoneFit).
function needsFit(L) {
  if (L.mode === "two") return true;
  return L.mode === "fit" && L.H / L.sp < 1.3 * twoNeed(S.P.views[S.view]);
}
// S.step steps from the default L (laid out, fitted): ×STEP a step, ≥ MIN_SP, ≤ the cap — a spread
// when zoomed out in landscape so far that each half holds SPREAD staff spaces.
function stepped(L, single = false) {
  if (!S.step || L.stepped) return L;
  const want = Math.max(MIN_SP, L.sp * STEP ** S.step);
  const spread = !single && S.step < 0 && L.W > L.H && L.W / 2 / want >= SPREAD;
  const pw = spread ? Math.floor(L.W / 2) : L.W;
  const cap = Math.min(pw / 40, L.H / tallest(S.P.views[S.view]));
  const sp = Math.min(want, cap);
  return { W: L.W, H: L.H, spread, pw, cap, sp, scale: scaleOf(sp), mode: "set", base: L.base, auto: L.sp, stepped: true };
}
// After a layout at L (measure): the default's fit, then the step from it — laid out again when
// the step changes the page.
function settle(L, single = false) {
  L = fit(L);
  const s = stepped(L, single);
  if (s !== L && (s.scale !== L.scale || s.pw !== L.pw)) {
    setPageSize(s);
    tk.redoLayout();
  }
  return s;
}

// A phone (v78's rules, unchanged): PHONE as far as the screen allows; the full score two systems a
// page where that leaves ≥ SCORE_MIN px a staff space (checked on the layout: phoneFit), else one
// as large as fits — or, where one would leave a third of the page blank, two smaller (checked too).
const V78 = [7, 8, 9.5, 11, 12.5, 14, 16, 18, 20, 23], SCORE_OPT = 34, SCORE_MIN = 9.5;
function phoneSize(plan, at, pw, H, cap) {
  const c = Math.min(PHONE, cap);
  if (plan?.kind !== "score") return at(c, "set");
  const more = (plan.staves > 3 ? SCORE_EXTRA : SCORE_STAFF) * (plan.staves - 3);
  const opt = SCORE_OPT + Math.min(0, more), typ = SCORE_SYS + Math.min(0, more);
  const one = Math.min(c, stepDown(H / tallest(plan), V78)), two = Math.min(c, stepDown(H / (2 * opt), V78));
  const hit = S.v?.fit?.get(fitKey(pw, H));
  const L = two >= SCORE_MIN - 0.01 || one * typ < (2 / 3) * H ? at(two, "two", { one, typ }) : at(one, "one");
  return hit && L.mode === "two" ? at(hit.sp, "fitted") : L;
}

const fitKey = (pw, H) => pw + "x" + H;
// The default's two systems a page, checked on the layout just made: Verovio's page-based MEI lists
// each page's systems (~15 ms; no check where two fit with room to spare — in portrait). From the
// estimate (twoNeed) down by FIT_STEP while fewer than 3 pages in 4 (the last aside) hold two, not
// under the floor (FIT_FLOOR); else one system a page at the default. → the layout kept.
function fit(L) {
  S.fitLog = [];
  if (L.mode === "two") return phoneFit(L);
  if (L.mode !== "fit") return L;
  const need = twoNeed(S.P.views[S.view]);
  if (L.H / L.sp >= 1.3 * need) return L;
  const t = performance.now();
  const kb = dockEl.hidden ? 0 : dockEl.offsetHeight, room = L.H / (L.H + kb); // (the keyboard's share of the height)
  const floor = room * (device() === "tablet" ? Math.min(L.base, FIT_FLOOR.tablet * Math.min(screen.width, screen.height) / PAPER) : FIT_FLOOR.desktop * L.base);
  let sp = Math.max(floor, Math.min(L.sp, L.H / need));
  for (let i = 0; i < 8; i++) {
    if (scaleOf(sp) !== L.scale) {
      L = { ...L, sp, scale: scaleOf(sp) };
      setPageSize(L);
      tk.redoLayout();
    } else L = { ...L, sp };
    const share = twoShare();
    S.fitLog.push({ sp: Math.round(L.sp * 100) / 100, share: Math.round(share * 100) / 100 });
    if (share >= 0.75) break;
    if (sp <= floor + 0.01) {
      // (two don't fit even a little smaller: one a page, at the printed density)
      if (L.scale !== scaleOf(L.base)) {
        L = { ...L, sp: L.base, scale: scaleOf(L.base) };
        setPageSize(L);
        tk.redoLayout();
      }
      L = { ...L, sp: L.base, mode: "one" };
      break;
    }
    sp = Math.max(floor, sp * FIT_STEP);
  }
  return remember(L, t);
}
// v78's full-score fit on a phone: stepped down while fewer than 3 pages in 4 hold two systems,
// not under SCORE_MIN; then one system a page — or, where one would leave a third of the page
// blank, two at the next size down.
function phoneFit(L) {
  const t = performance.now();
  for (;;) {
    const share = twoShare();
    S.fitLog.push({ sp: L.sp, share: Math.round(share * 100) / 100 });
    if (share >= 0.75) break;
    const next = [...V78].reverse().find((s) => s < L.sp - 0.01);
    const sp = next >= SCORE_MIN - 0.01 ? next : L.one * L.typ < (2 / 3) * L.H && next ? next : L.one;
    L = { ...L, sp, scale: scaleOf(sp), mode: next >= SCORE_MIN - 0.01 ? "two" : "one" };
    setPageSize(L);
    tk.redoLayout();
    if (L.mode !== "two") break;
  }
  return remember(L, t);
}
// (remembered for this view and page size: a rotation back lays out once — Piano Man's landscape
// tried three sizes, ~0.4 s, on every rotation)
function remember(L, t) {
  S.t.fit = ms(t);
  if (S.v) (S.v.fit ||= new Map()).set(fitKey(L.pw, L.H), { sp: L.sp });
  return L;
}
// The share of pages (the last aside) holding two systems or more.
function twoShare() {
  let mei;
  try { mei = tk.getMEI({ scoreBased: false }); } catch { return 1; }
  const per = mei.split(/<page\b/).slice(1).map((p) => (p.match(/<system\b/g) || []).length);
  const judged = per.length > 1 ? per.slice(0, -1) : per;
  return judged.length ? judged.filter((n) => n >= 2).length / judged.length : 1;
}
function setPageSize(L) {
  // (floored: the drawing never comes out a pixel larger than the stage)
  tk.setOptions({ scale: L.scale, pageWidth: Math.floor((L.pw * 100) / L.scale), pageHeight: Math.floor((L.H * 100) / L.scale) });
}

// After a layout: pages, the anchor's page (odd in a spread), show.
function placed(L) {
  if (L.spread && tk.getPageCount() === 1) {
    // (one page: no spread — the stage's full width, not a narrow column in its middle)
    L = measure(true) || { ...L, spread: false, pw: L.W };
    setPageSize(L);
    tk.redoLayout();
    L = settle(L, true);
  }
  S.W = L.W; S.H = L.H; S.spread = L.spread; S.sp = L.sp; S.cap = L.cap; S.base = L.base; S.scale = L.scale; S.mode = L.mode;
  S.auto = L.auto ?? L.sp;
  cache.clear();
  PB.pageOf = new Map(); // (the bars' pages: this layout's)
  PB.musicPage = 0;
  S.counted = new Map();
  S.lgen++;
  S.pages = tk.getPageCount();
  stage.classList.toggle("spread", S.spread && S.pages > 1); // (a lone last page stays in its half)
  let p = tk.getPageWithElement("m" + S.v.firstMeasureAtOrAfter(S.at)) || 1;
  if (S.spread && p % 2 === 0) p--;
  S.page = Math.max(1, Math.min(S.pages, p));
  // (a score Verovio loads but draws nothing of — notes kept, no staff on the page: say so, not
  // blank paper with "1 / 1")
  if (S.v?.pitched && !/<g [^>]*class="staff[" ]/.test(svgOf(S.page))) return fail("song");
  showMsg("");
  S.ready = true;
  S.failed = null;
  handsSel.disabled = pdf.on;
  show();
  renderHear(); // (the view's chips for ▶)
  KB.w = 0; // (measured again after the chips: the keys take what they leave)
  drawKeys(); // (the keyboard's range: the view's)
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
  placed(settle(L));
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
    const r = decorate(d, S.P.facts, { low: S.P.views[S.view]?.low, minPx: MIN_LETTER });
    for (const it of r.items) S.items.push(it);
    S.counted.set(Number(d.dataset.page), r.items.length);
  }
  S.t.badges = ms(t1);
  S.showGen++;
  PB.lit = new Map(); // (new elements: what sounds is lit again on the next frame)
  PB.litKey = "";
  drawSel();
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
  const p = Math.max(1, Math.min(lastPage(), S.page + d * (S.spread ? 2 : 1)));
  if (p === S.page) return false;
  goPage(p);
  activity("turn");
  return true;
}
// Show page p (odd in a spread) and keep the place there.
function goPage(p) {
  clearPeek();
  S.page = p;
  show();
  const mi = firstMeasureShown();
  if (mi != null) { S.at = mi; S.st.at = mi; saveSoon(); }
}

// The notehead nearest a point (client px), within max(HIT px, 1.2 × the head's height): a finger
// (~40 px) on the printed-density page (a head ~8 px) means the nearest head under it — 22 px
// round its point, 16 for a mouse. → { item (a decorate() item: g, fact, …), x, y (its centre,
// client px), d } or null.
const HIT = { touch: 22, pen: 16, mouse: 16 };
function nearHead(x, y, type = "touch") {
  const r0 = HIT[type] ?? HIT.touch;
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
    if (d <= Math.max(r0, 1.2 * it.h * Math.hypot(m.b, m.d)) && (!best || d < best.d)) best = { item: it, x: px, y: py, d };
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

// − / +: the next step from the default (S.step ± 1, or further while it's under 3% from the size
// shown, or the cap or MIN_SP leave it there) — the default 9.11 on an iPad Air in portrait:
// − 7.92, + 10.48 — as far as the screen allows (a step past the cap shows the cap). Step 0 is the
// default again (its pref removed). The steps are this device's pref for the view's kind.
function nextStep(dir) {
  const auto = S.auto || S.sp;
  if (!S.ready || !auto) return null;
  for (let n = S.step + dir; Math.abs(n) <= STEPS; n += dir) {
    if (n === 0) return 0;
    const raw = auto * STEP ** n, sp = Math.min(S.cap, Math.max(MIN_SP, raw));
    if (dir > 0 ? raw > S.sp * 1.03 && sp > S.sp + 0.01 : raw < S.sp * 0.97 && sp < S.sp - 0.01) return n;
  }
  return null;
}
function sizeButtons() {
  smallerBtn.disabled = !S.ready || pdf.on || nextStep(-1) == null;
  biggerBtn.disabled = !S.ready || pdf.on || nextStep(1) == null;
  namesBtn.disabled = pdf.on;
  keysBtn.disabled = pdf.on || !keysRoom();
  playButtons();
}
function resize(dir) {
  if (!S.ready || pdf.on) return;
  const n = nextStep(dir);
  if (n == null) return;
  S.step = n;
  const z = S.sizes[sizeKind(S.view)];
  z.step = n;
  keep(z.key, n ? (n > 0 ? "+" : "") + n : null);
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
  const gen = ++S.gen;
  S.view = handsSel.value;
  clearPeek();
  stopPlay(); // (the stretch picked stays: it's a stretch of the song, drawn again in this view)
  S.ready = false;
  renderHear();
  S.failed = null; // (an earlier view's failure: this one may draw)
  showMsg("");
  setBusy(true);
  try { await engine(); } catch (err) { if (gen === S.gen) fail("engine", err); return; } // (tried again after a failed load)
  if (gen !== S.gen) return;
  await loadView(gen);
  // (kept once drawn: a view that fails isn't the one the song reopens at)
  if (gen === S.gen && (S.ready || S.waiting)) { S.st.view = S.view; saveState(); }
});
// A focused control keeps the pedal's keys (a select's arrows, a button's Space/Enter): let go.
// (the bar's and the stretch's controls over the music)
const bar = $("bar");
let tappedSel = null;
for (const box of [bar, selbar, dockEl]) {
  box.addEventListener("change", (e) => { if (e.target.matches?.("select")) e.target.blur(); });
  box.addEventListener("click", (e) => e.target.closest?.("button")?.blur());
  // A menu closed with no new pick (a tap outside, the same song, Escape) fires no change and keeps
  // focus — an iPad never blurs it — so the pedal's next arrow / Page key would pick the next song
  // or hands view. A select focused by a tap lets go of the page-turn keys; one reached with Tab
  // keeps them.
  box.addEventListener("pointerdown", (e) => { tappedSel = e.target.closest?.("select") || null; });
  box.addEventListener("focusin", (e) => { if (e.target !== tappedSel) tappedSel = null; });
  box.addEventListener("focusout", (e) => { if (e.target === tappedSel) tappedSel = null; });
}

// ---------------------------------------------------------------------------
// Turning pages: the ‹ › buttons and the keys (Bluetooth page turners send these). Nothing on the
// music turns a page: a press there sounds a note, a drag is for picking notes (below).

const FWD = new Set(["ArrowRight", "ArrowDown", "PageDown", " ", "Spacebar", "Enter"]);
const BACK = new Set(["ArrowLeft", "ArrowUp", "PageUp", "Backspace"]);
window.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target instanceof Element ? e.target : null;
  let d = FWD.has(e.key) ? 1 : BACK.has(e.key) ? -1 : 0;
  const own = e.key === " " || e.key === "Spacebar" || e.key === "Enter";
  if (d > 0 && e.key !== "Enter" && own && e.shiftKey) d = -1;
  const sel = t?.closest("select");
  if (sel && d && sel === tappedSel) { e.preventDefault(); sel.blur(); tappedSel = null; turn(d); return; }
  if (t && (t.closest("select, input, textarea") || t.isContentEditable)) return;
  if (!d) return;
  if (own && t?.closest("button, a")) return; // (a control reached with Tab keeps its keys)
  e.preventDefault();
  turn(d);
});

// A press on the music: on a note (nearHead) it strikes — every finger its own (two fingers, two
// strikes; a trill sounds every note). Moving the first finger (the primary pointer) more than MOVE
// px — at any time in the press — makes it a drag, which cuts its strike and picks a stretch of the
// music: from the onset nearest the press to the one nearest the finger, either way, across systems
// and the two pages of a spread (pickSel). Another finger never drags: it holds its notes. A tap on
// paper (no note) lets go of the stretch, unless something is playing; a tap on a note strikes and
// keeps it. Nothing on the PDF (📄): a tap there does nothing. While a finger is on the music ▶'s
// page turn waits for the last lift (afterPress).
const MOVE = 12;
// pointerId → { id, primary, x, y, t, hit, peek, drag, anchor (the onset the press picked), fx, fy, raf }
const gests = new Map();
stage.addEventListener("pointerdown", (e) => {
  if (e.target.closest?.("#selbar")) return; // (the stretch's own controls)
  if ((e.pointerType === "mouse" && e.button !== 0) || pdf.on) { letGoMenu(); return; }
  // (sound before sight: the note under the finger and its strike before any change on screen)
  const t0 = performance.now();
  const hit = S.ready ? nearHead(e.clientX, e.clientY, e.pointerType) : null;
  const hitMs = performance.now() - t0;
  if (!e.isPrimary && !hit) { letGoMenu(); return; } // (another finger on paper: nothing)
  const old = gests.get(e.pointerId);
  if (old) { gests.delete(e.pointerId); if (old.peek) peekEnd(old.peek); } // (a lift never heard)
  const g = { id: e.pointerId, primary: e.isPrimary, x: e.clientX, y: e.clientY, t: e.timeStamp, hit, peek: null, drag: false, anchor: null, fx: 0, fy: 0, raf: 0 };
  gests.set(e.pointerId, g);
  if (hit) g.peek = peekStart(hit, e, hitMs);
  letGoMenu();
  try { stage.setPointerCapture(e.pointerId); } catch {}
});
// (a tap on the music lets go of a menu)
const letGoMenu = () => document.activeElement?.closest?.("#bar select, #selbar select")?.blur();
stage.addEventListener("pointermove", (e) => {
  const g = gests.get(e.pointerId);
  if (!g || !g.primary) return;
  if (!g.drag) {
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) <= MOVE) return;
    g.drag = true;
    if (g.peek) { peekCancel(g.peek); g.peek = null; }
    if (!S.ready || pdf.on) return;
    g.anchor = colAt(g.x, g.y);
    // (a new stretch: the old one's playing stops; playing from the page goes on)
    if (g.anchor && PB.kind === "span" && PB.state !== "idle") stopPlay();
  }
  if (!g.anchor) return;
  g.fx = e.clientX; g.fy = e.clientY;
  if (!g.raf) g.raf = requestAnimationFrame(() => { g.raf = 0; if (gests.get(g.id) === g) pickSel(g); });
});
stage.addEventListener("pointerup", (e) => {
  const g = gests.get(e.pointerId);
  if (!g) return;
  gests.delete(e.pointerId);
  if (g.drag) {
    if (g.anchor) { cancelAnimationFrame(g.raf); g.fx = e.clientX; g.fy = e.clientY; pickSel(g); }
  } else if (g.peek) peekEnd(g.peek);
  else if (g.primary && !g.hit && S.ready && !pdf.on && S.sel && PB.state === "idle" && !PB.starting) clearSel();
  afterPress(g);
});
stage.addEventListener("pointercancel", (e) => {
  const g = gests.get(e.pointerId);
  if (!g) return;
  gests.delete(e.pointerId);
  cancelAnimationFrame(g.raf);
  if (g.peek) peekCancel(g.peek);
  afterPress(g);
});
stage.addEventListener("contextmenu", (e) => e.preventDefault());

// ---------------------------------------------------------------------------
// Peek: press a note — at any level, Off included — to hear its chord (everything struck on that
// staff then) until the finger lifts, see its names (with octaves) and its keys lit on the
// keyboard (🎹). Each finger's press is a strike of its own: a second finger doesn't cut the first,
// the same key struck again damps the old note as the new one starts (a clean restrike, no doubled
// sample).
//
// Sound before sight (v80): when the context runs and the piano is decoded for it (pianoNow), the
// press strikes in its own pointerdown — holdPiano at the context's current time, before anything
// on screen changes; the colours, the names and the keys follow on the next frame (drawSoon). (v79
// coloured the heads, measured the stage, the chord, the strip and the bubble — forced style and
// layout on a page-sized SVG — then awaited the piano, then started 10 ms ahead.)
//
// Sound follows the Sing page's chip keys: the session is set to "playback" in the press (only when
// it says something else); a context iOS closed or left "interrupted" (or whose resume in a tap
// never settled) is replaced in a touch, which can then start it. The context is made, and the
// piano decoded on it, as soon as the first song is shown (warmAudio; decodeAudioData works on a
// suspended context, and making one changes nothing until it starts) — so the first press after
// the first tap has it ready. iOS only lets audio start at a touch's end, so the first tap anywhere
// resumes the context (leaving the session alone: other apps' music isn't stopped before a note
// plays); a press that couldn't sound at once plays its chord for LIFT_PLAY at the lift, and one
// that still can't start LATE ms after the lift is dropped rather than played late.
//
// From the first strike or ▶ on, an inaudible source keeps the output awake (keepAwake) — WebKit
// otherwise flips the page in and out of "playing audio" at every silent gap, and each flip goes
// round the page, the media session and the UI process just as the next note should start.

const MIN_PRESS = 0.25;  // s: a quick tap still sounds this long
const LIFT_PLAY = 0.8;   // s: a press that could only sound at the lift
const LATE = 1500;       // ms
const MAX_HOLD = 60000;  // ms: a release that never came lets go by itself
const HIDE_AFTER = 2000; // ms after the lift: the names, the lit keys and the colour go
const CUT = 0.01;        // s: time constant when a press becomes a drag
const RESTRIKE = 0.015;  // s: time constant of a key's old note when it's struck again
// The output kept awake this long after the last press, lift or ▶ (see keepAwake): two minutes
// covers playing a passage on the real keys between two looks at a note; past it the next press
// pays the wake-up once. Its cost is the audio route staying on — small beside the screen, which
// the wake lock keeps on anyway — and it stops at once when the page is hidden or left.
const AWAKE = 120000;    // ms
// (the voice: the full score's sung part — its own colour, clear of both hands and the orange of
// the pressed note; part: another part that plays — Piano Man's accordion cue staff, a guitar)
const HAND = { rh: "#a64fff", lh: "#4f7cff", voice: "#0b8f78", part: "#d6336c" };
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
// starts over with a new one). The session is set only when it isn't "playback" already.
function getCtx(how) {
  try { if (navigator.audioSession && navigator.audioSession.type !== "playback") setSession("playback"); } catch {}
  const a = freshCtx();
  if (a.state !== "running") {
    Promise.race([a.resume().catch(() => {}), sleep(1500)]).then(() => {
      if (a === ac) acStuck = how !== "press" && a.state !== "running";
    });
  }
  return a;
}
// The context and the piano on it, ready before the first press (the session left alone).
function warmAudio() {
  try {
    const a = freshCtx();
    pianoBus(a, BUS);
    primeHold(a);
    loadPiano(a).catch(() => {});
  } catch (err) { console.info("play: audio", err?.message); }
}
const UNLOCK = ["pointerup", "click", "keydown"];
function unlockPlay(e) {
  if (!e.isTrusted) return;
  for (const t of UNLOCK) document.removeEventListener(t, unlockPlay, true);
  const a = freshCtx();
  if (a.state !== "running") a.resume().catch(() => {});
  loadPiano(a).catch(() => {});
  try { pianoBus(a, BUS); primeHold(a); } catch {} // (made now, not in the first press)
}
for (const t of UNLOCK) document.addEventListener(t, unlockPlay, true);
// A context's change of state, or ms — whichever comes first.
const stateOrSleep = (a, ms) => new Promise((resolve) => {
  const done = () => { clearTimeout(t); a?.removeEventListener?.("statechange", done); resolve(); };
  const t = setTimeout(done, ms);
  a?.addEventListener?.("statechange", done);
});

// One inaudible source (piano.js keepAlive) on the context in use, from the first strike or ▶ until
// AWAKE ms after the last of them (or a lift) with nothing held or playing; never while hidden.
const awake = { a: null, src: null, timer: 0, at: 0 };
function keepAwake(a) {
  if (!a || a.state === "closed" || document.visibilityState !== "visible") return;
  if (awake.a !== a || !awake.src) {
    sleepAudio();
    const nodes = [];
    try { keepAlive(a, nodes); } catch {}
    awake.a = a;
    awake.src = nodes[0] || null;
  }
  awake.at = performance.now();
  clearTimeout(awake.timer);
  awake.timer = setTimeout(quiet, AWAKE);
}
function quiet() {
  awake.timer = 0;
  if (PB.state !== "idle" || PB.starting || peeks.some((pk) => pk.held)) { awake.timer = setTimeout(quiet, AWAKE); return; }
  sleepAudio();
}
function sleepAudio() {
  clearTimeout(awake.timer);
  awake.timer = 0;
  try { awake.src?.stop(); } catch {}
  awake.src = awake.a = null;
}

// The strikes on screen — held (a finger down) or fading out after the lift — oldest first:
// { pid (the pointer), items, names, midis, lit (midi → { hand, label }), held, lift, dead, hidden,
//   a (its context), notes (midi → holdPiano handle), t0, end (s: when the sound was let go), cap,
//   hide, log }.
let peeks = [];
const peekLog = []; // what sounded: { midis, how: "hold" | "lift", cut, lag, ahead, hit, ... } (tests)
// The key's newest note (midi → { pk, h }): struck again, the old one is damped as the new starts.
let voices = new Map(), voicesOf = null;

// (Melody is the right hand; a hymn's treble part is, its bass part the left. In the full score
// the sung part is the voice, the piano's staves its hands and another part is a part of its own
// (v80: its own colour, as its chip — Piano Man's accordion cue staff was lit as the right hand).
// A view with chips for ▶ (hearGroups) colours each key as its chip.)
function handOf(f) {
  const plan = S.P?.views[S.view], both = S.P?.views.both;
  if (!plan || plan.kind === "melody" || !both) return "rh";
  const g = groupOf(f.part, Number(f.staff) || 1);
  if (g) return g.hand === "piano" ? (plan.low.includes(f.part + "|" + f.staff) ? "lh" : "rh") : g.hand;
  if (plan.kind === "score") {
    if (plan.sung?.includes(f.part)) return "voice";
    return plan.low.includes(f.part + "|" + f.staff) ? "lh" : "rh";
  }
  if (both.kind === "hymn") return f.part === both.parts[1] ? "lh" : "rh";
  if (both.kind === "parts") return "rh";
  return Number(f.staff) >= 2 ? "lh" : "rh";
}

// A press on a note (hit: nearHead's; e: its pointerdown; hitMs: nearHead's time) → its strike.
function peekStart(hit, e, hitMs = 0) {
  if (pdf.on || !hit) return null;
  const it0 = hit.item, f0 = it0.fact;
  const chord = it0.g.closest("g.chord") || it0.g;
  // Everything struck on that staff at that moment: the chord, and the other voices' notes starting
  // there (a converted score splits a chord's notes into voices loosely — a press used to sound only
  // the pressed note's voice), a tied-over head drawn there too. Not a grace note's neighbours, not a
  // note started earlier and still held (drawn elsewhere).
  const at = f0.onset != null && !f0.grace;
  const together = (it) => at && it.staff === it0.staff && it.fact.mi === f0.mi && !it.fact.grace && it.fact.onset != null && Math.abs(it.fact.onset - f0.onset) < 1e-6;
  const items = S.items.filter((it) => it.w && (it.g === chord || chord.contains(it.g) || together(it)))
    .sort((a, b) => a.fact.midi - b.fact.midi);
  if (!items.length) return null;
  const lit = new Map();
  for (const it of items) if (!lit.has(it.fact.midi)) lit.set(it.fact.midi, { hand: handOf(it.fact), label: labelOf(it.fact) });
  const pk = { pid: e.pointerId, items, names: null, midis: [...lit.keys()], lit, held: true, lift: 0, dead: false, hidden: false, a: null, notes: null, t0: 0, end: Infinity, cap: 0, hide: 0, log: null };
  // the sound: the session, a context — struck now when it runs with the piano in, else as soon as
  // it can (iOS: at the lift)
  const a = getCtx("press");
  const piano = a.state === "running" ? pianoNow(a) : null;
  if (piano) strike(pk, a, piano, e.timeStamp, hitMs);
  else { loadPiano(a).catch(() => {}); sound(pk, e.timeStamp, hitMs); }
  // then the screen: strikes already let go give way to this one (their sound rings on)
  pk.names = [...new Set(items.map((it) => fullName(it.fact)))];
  for (const o of peeks) if (!o.held) hidePeek(o, false);
  peeks.push(pk);
  drawSoon();
  activity("peek");
  pk.cap = setTimeout(() => peekEnd(pk), MAX_HOLD);
  return pk;
}

// Start the chord once a context runs and the piano is in: held until the lift if the finger is
// still down, else for LIFT_PLAY — unless the lift was LATE ms ago.
async function sound(pk, ts, hitMs) {
  const late = () => !pk.held && performance.now() - pk.lift > LATE;
  for (;;) {
    if (pk.dead || late()) return;
    const a = ac;
    if (a && a.state === "running") {
      let piano = pianoNow(a);
      if (!piano) {
        try { piano = await loadPiano(a); } catch (err) { console.warn("piano", err); return; }
        if (pk.dead || late()) return;
        if (a !== ac || a.state !== "running") continue; // (replaced meanwhile)
      }
      strike(pk, a, piano, ts, hitMs);
      return;
    }
    await stateOrSleep(a, 30);
  }
}
// The strike itself: its keys at a.currentTime (as soon as the audio can), into the bus ▶ uses (one
// soft limiter for every finger and ▶: two hands' chords don't clip) at the level they had going
// straight out (×1/BUS); a key another strike still sounds is damped as this one starts.
function strike(pk, a, piano, ts, hitMs) {
  const n = pk.midis.length, lvl = (n === 1 ? 1.4 : Math.min(1, 4 / n)) / BUS; // (as Sing's keys; a big chord doesn't clip)
  const bus = pianoBus(a, BUS);
  pk.a = a;
  pk.t0 = a.currentTime;
  const t = performance.now();
  pk.notes = new Map(pk.midis.map((m) => [m, holdPiano(a, piano, pk.t0, m, lvl, { sustain: pk.held, dest: bus })]));
  if (voicesOf !== a) { voices = new Map(); voicesOf = a; }
  // (keys whose note is long over: forgotten)
  for (const [m, v] of voices) if (!v.pk.held && v.pk.end < pk.t0 - 5) voices.delete(m);
  const again = [];
  for (const [m, h] of pk.notes) {
    const v = voices.get(m);
    if (v && v.pk !== pk && !v.pk.dead && v.pk.end > pk.t0) { v.h.release(pk.t0, RESTRIKE); again.push(m); }
    voices.set(m, { pk, h });
  }
  pk.log = { midis: pk.midis, how: pk.held ? "hold" : "lift", cut: false, pid: pk.pid, lag: Math.round((t - ts) * 10) / 10, ahead: Math.round((pk.t0 - a.currentTime) * 1e4) / 1e4, hit: Math.round(hitMs * 100) / 100, again, at: Math.round(t) };
  peekLog.push(pk.log);
  if (peekLog.length > 40) peekLog.shift();
  keepAwake(a);
  if (!pk.held) letGo(pk, pk.t0 + LIFT_PLAY);
}
// Let a strike's keys go at `at` — except a key another finger still holds: the note sounding on it
// (this strike's, the newest) becomes that finger's and goes at its lift, as a real key sounds until
// the last finger on it lets go. (v80's first build released it: a second finger tapping a key the
// first held — the same chord again, the voice's note under a held piano chord — silenced it 0.25 s
// after its lift with the first finger still down.)
function letGo(pk, at, tc) {
  if (!pk.notes || at >= pk.end) return;
  for (const [m, h] of pk.notes) {
    const v = voices.get(m), z = v && v.h === h && v.pk === pk ? holderOf(m, pk) : null;
    if (z) { voices.set(m, { pk: z, h }); z.notes.set(m, h); continue; }
    h.release(at, tc);
  }
  pk.end = Math.max(at, pk.a.currentTime);
  if (pk.log) pk.log.cut = tc === CUT;
}
// Another strike still held on key m (its finger down, its sound started on the same context).
const holderOf = (m, pk) => peeks.findLast((o) => o !== pk && o.held && !o.dead && o.notes && o.a === pk.a && o.midis.includes(m)) || null;

// The finger lifted (or MAX_HOLD passed).
function peekEnd(pk) {
  if (!pk || pk.dead || !pk.held) return;
  pk.held = false;
  pk.lift = performance.now();
  clearTimeout(pk.cap);
  // (a touch's end is where iOS lets audio start: resume here if the press couldn't)
  if (!ac || ac.state !== "running") getCtx("tap");
  if (pk.notes) { letGo(pk, Math.max(pk.a.currentTime, pk.t0 + MIN_PRESS)); keepAwake(pk.a); }
  pk.hide = setTimeout(() => hidePeek(pk), HIDE_AFTER);
}
// The press moved off: it's a drag — cut the sound, hide at once.
function peekCancel(pk) {
  if (!pk || pk.dead) return;
  pk.dead = true;
  clearTimeout(pk.cap);
  if (pk.notes) letGo(pk, pk.a.currentTime, CUT);
  hidePeek(pk);
}
// Any page turn, a new layout, another song, the page hidden: let every strike go and hide.
function clearPeek() {
  if (!peeks.length) return;
  const all = peeks;
  peeks = [];
  for (const pk of all) {
    pk.dead = true;
    clearTimeout(pk.cap);
    if (pk.notes) letGo(pk, pk.a.currentTime);
    hidePeek(pk, false);
  }
  drawPeeks();
}
// Off the screen (its sound goes on until let go). draw: now (else the caller draws).
function hidePeek(pk, draw = true) {
  if (pk.hidden) return;
  pk.hidden = true;
  clearTimeout(pk.hide);
  peeks = peeks.filter((x) => x !== pk);
  if (draw) drawPeeks();
  // (off the screen for good: its heads aren't kept — `voices` keeps a strike until its keys are
  // struck again, and with its items every page pressed on stayed in memory, a detached SVG each)
  pk.items = [];
}
const peekShown = () => peeks.length > 0;

// The keys of every strike on screen (midi → { hand, label }; the newest strike's on a shared key) —
// what the keyboard lights.
function peekKeys() {
  const keys = new Map();
  for (const pk of peeks) for (const [m, L] of pk.lit) keys.set(m, L);
  return keys;
}

// What's on screen follows the strikes on the next frame (or at once: drawPeeks).
let drawRaf = 0;
function drawSoon() {
  if (!drawRaf) drawRaf = requestAnimationFrame(() => { drawRaf = 0; drawPeeks(); });
}
let peekEls = new Set(); // the heads and badges coloured
function drawPeeks() {
  if (drawRaf) { cancelAnimationFrame(drawRaf); drawRaf = 0; }
  const t0 = performance.now();
  const want = new Set();
  for (const pk of peeks) for (const it of pk.items) { want.add(it.g); if (it.badge) want.add(it.badge); }
  for (const el of peekEls) if (!want.has(el)) el.classList.remove("peek");
  for (const el of want) if (!peekEls.has(el)) el.classList.add("peek");
  peekEls = want;
  drawKeys(); // (the keyboard: every strike's keys, with what ▶ sounds)
  const top = peeks.at(-1);
  if (!top) {
    bubbleEl.classList.remove("on");
    placeSelbar();
    return;
  }
  const st = stage.getBoundingClientRect();
  let ctop = Infinity, cbottom = -Infinity, cx = 0;
  for (const it of top.items) {
    const b = it.head.getBoundingClientRect();
    ctop = Math.min(ctop, b.top);
    cbottom = Math.max(cbottom, b.bottom);
    cx += b.left + b.width / 2;
  }
  cx /= top.items.length || 1;
  // The newest strike's names just above its chord (below it when there's no room), on the music
  // (the keyboard is under the stage: never in the way).
  bubbleEl.textContent = top.names.join(" ");
  bubbleEl.classList.add("on");
  const bw = bubbleEl.offsetWidth, bh = bubbleEl.offsetHeight;
  const minY = 6, maxY = st.height - 6 - bh;
  let y = ctop - st.top - bh - 10;
  if (y < minY) y = cbottom - st.top + 10;
  y = Math.max(minY, Math.min(maxY, y));
  const x = Math.max(6, Math.min(st.width - bw - 6, cx - st.left - bw / 2));
  bubbleEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  placeSelbar(); // (the stretch's controls clear of the chords and the names)
  S.t.peek = ms(t0);
}

// ---------------------------------------------------------------------------
// The keyboard (🎹): docked under the music in a space of its own — the stage ends where it starts,
// so the music is laid out above it and never drawn under it — and it stays put: nothing slides in
// with a press, switches sides or goes while ▶ plays. (v79's strip was an overlay that slid in on a
// press, out 2 s after the lift, and while ▶ played jumped between the stage's foot and head or
// left the page when neither was clear — "it'll show up and disappear at random times".) The 🎹
// button shows or hides it — this device's pref, by default on a tablet and a desktop, off on a
// phone (a short screen: its height is the music's) — and the page is laid out again at the new
// height, at the same place, as a rotation does. Hidden in the PDF view (📄): nothing there lights
// it (no presses, no ▶), and the PDF's page gets the height (a page in portrait is fitted by it).
//
// What it shows: the view's range in whole octaves (C3–B5 at least), a dot on middle C, and lit —
// by hand, a letter on each — the keys of the strikes on screen (held, and HIDE_AFTER after the
// lift) and of what ▶ sounds now. Idle: none. It's a flex row (#dock): what ▶ plays can be chosen
// at its left end; the keys take the rest of the width (drawn to the size they're given).

const KB = {
  on: false,       // the 🎹 setting
  play: new Map(), // what ▶ sounds now: midi → { hand, label }
  drawn: "",       // what's drawn: range, size, lit keys
  range: null,     // the range drawn [lo, hi] (kept while a song or a view loads)
  w: 0, h: 0,      // the keys' size (px; 0: measure)
  draws: 0,        // drawings (tests)
};
const keysDefault = () => device() !== "phone";
// Room for the keyboard: a window ≥ 360 px wide (narrower, the bar has no place for 🎹 — an iPad's
// Slide Over, a ⅓ Split View) and ≥ 500 px tall (a phone in landscape: its ~68 px were a quarter of
// the music's height — Piano Man's full score at 4.2 px a staff space). Without it the keyboard
// isn't shown whatever the setting, and 🎹 is hidden / disabled — so the keyboard is never on
// where it can't be turned off (v80's first build kept it on by default in an iPad's 320-px Slide
// Over, with 🎹 hidden). It comes back with the room (a rotation, a wider window).
const ROOM = matchMedia("(min-width: 360px) and (min-height: 500px)");
const keysRoom = () => ROOM.matches;
function setKeys(on, byHand = false) {
  KB.on = on;
  keysBtn.setAttribute("aria-pressed", String(on));
  if (byHand) keep(K.keys, on ? "on" : "off");
  dock(byHand);
}
keysBtn.addEventListener("click", () => { if (!pdf.on && keysRoom()) setKeys(!KB.on, true); });
{
  const onRoom = () => { dock(); sizeButtons(); }; // (the stage's resize lays the music out again)
  if (ROOM.addEventListener) ROOM.addEventListener("change", onRoom); else ROOM.addListener?.(onRoom);
}
// The dock shown when the keyboard is on, has room and the sheet is shown (not the PDF). relay: lay
// the music out again at the stage's new height now (the 🎹 tap; the resize observer would, 150 ms
// later).
function dock(relay = false) {
  const show = KB.on && !pdf.on && keysRoom();
  if (dockEl.hidden !== show) return;
  dockEl.hidden = !show;
  document.body.dataset.keys = show ? "on" : "off";
  if (show) KB.w = KB.h = 0; // (measured again: its size may have changed while hidden)
  renderHear(); // (the chips for ▶: at the keyboard's left end, or in the stretch's controls)
  if (show) drawKeys();
  if (relay && S.ready && !pdf.on) { clearTimeout(resizeTimer); relayout(); }
}
// The keys lit: what ▶ sounds, and every strike on screen (a strike's on a key both have).
function keysLit() {
  const keys = new Map(KB.play);
  for (const [m, L] of peekKeys()) keys.set(m, L);
  return keys;
}
// Draw the keyboard when what it shows changed (and it's shown). While a song or a view loads it
// stays as it is (v80's first build drew a C3–B5 placeholder while a song loaded, and the old view's
// range at another width while a view did) — only what's lit may change: the next range is the new
// view's (placed).
function drawKeys() {
  if (dockEl.hidden) { KB.drawn = ""; return; }
  if (!KB.w) { const r = stripEl.getBoundingClientRect(); KB.w = Math.round(r.width); KB.h = Math.round(r.height); }
  const lit = keysLit(), [lo, hi] = loading() && KB.range ? KB.range : stripRange(lit);
  KB.range = [lo, hi];
  const key = `${lo}-${hi} ${KB.w}x${KB.h} ` + [...lit].map(([m, L]) => m + L.hand + L.label.letter + (L.label.acc || "")).join(",");
  if (key === KB.drawn) return;
  KB.drawn = key;
  KB.draws++;
  drawStrip(lit, lo, hi);
}
// (its size: a rotation, the 🎹 shown, the chips beside it moved)
new ResizeObserver((es) => {
  const r = es[es.length - 1].contentRect;
  KB.w = Math.round(r.width);
  KB.h = Math.round(r.height);
  if (!dockEl.hidden && !hearEl.hidden && !loading()) placeHear(); // (the chips: as many rows as its height holds; still room beside the keys?)
  drawKeys();
}).observe(stripEl);
// A song or a view on its way (shown: placed()).
const loading = () => !!S.song && !S.ready && !S.failed && !pdf.on;

// The keyboard's range: the view's notes in whole octaves C…B (C3–B5 at least) — and the keys lit
// (midis), which are the view's anyway.
function stripRange(lit) {
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
  for (const m of lit.keys()) { lo = Math.min(lo, m); hi = Math.max(hi, m); }
  lo = Math.min(48, Number.isFinite(lo) ? 12 * Math.floor(lo / 12) : 48);
  hi = Math.max(83, Number.isFinite(hi) ? 12 * Math.floor(hi / 12) + 11 : 83);
  return [Math.max(0, lo), Math.min(127, hi)];
}
// lit: midi → { hand, label } (the strikes' keys and what ▶ sounds now); lo…hi: the range.
function drawStrip(lit, lo, hi) {
  const NS = "http://www.w3.org/2000/svg";
  let svg = stripEl.firstElementChild;
  if (!svg) { svg = document.createElementNS(NS, "svg"); stripEl.appendChild(svg); }
  const W = Math.max(60, KB.w), H = Math.max(30, KB.h);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
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
    const x = xOf.get(m), L = lit.get(m);
    s += `<rect class="key${L ? " lit" : ""}" data-midi="${m}"${L ? ` data-hand="${L.hand}"` : ""} x="${f1(x + 0.5)}" y="0" width="${f1(ww - 1)}" height="${H}" rx="${f1(Math.min(3, ww * 0.12))}" fill="${L ? HAND[L.hand] : "#f3f0e8"}"/>`;
    if (L) s += label(L.label, x + ww / 2, dotY - r0 - 3, Math.min(ww * 0.58, H * 0.22));
    if (m === 60) s += `<circle class="mc" cx="${f1(x + ww / 2)}" cy="${f1(dotY)}" r="${f1(r0)}" fill="${L ? "#e8e4ff" : "#9b9aa6"}"/>`;
  }
  const bw = ww * 0.58, bh = H * 0.6;
  for (let m = lo; m <= hi; m++) {
    if (WHITE.has(m % 12) || !xOf.has(m + 1)) continue;
    const x = xOf.get(m + 1) - bw / 2, L = lit.get(m);
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
// What ▶ plays (v80): the owner — "I want to see the full score so I can see the lyrics and the
// vocal melody, but I only want to play the piano part". In a view with more than one thing to
// hear, a chip each, coloured as the keys it lights — the Full score: the sung part(s) "Voice"
// (several: their names, else Voice 1, 2), the piano "Piano" (both hands' colours) and any other
// part that plays by its name (a generic one — Piano Man's accordion cue staff, which the converter
// calls "Voice" — by its place: "Part 3"); a full score that is only the piano (the tune inside it,
// The Longest Time) or a hymn's pair: RH / LH; Both: RH / LH (a hymn's two parts too); one hand and
// Melody: none. A tap mutes or unmutes it for ▶ and ⟳ (pressed = heard); at least one stays on.
// Kept per song and view in resonate.play[id].hear = { score: [muted keys], both: [...] } (keys:
// a part id, or part|staff for a hand). Where: the keyboard's left end (🎹 on: always there, beside
// the keys they colour — reachable before ▶), else the stretch's controls (#selbar: with a stretch,
// and while ▶ plays). A muted part's notes stay on the schedule — lit lighter as the music passes
// (.hush; their words too), so the words and the tune can be followed — but aren't struck and count
// neither in a unison nor in a chord's loudness (playtime track's hear). A change while playing
// takes effect at once: what hasn't started is scheduled again, what a newly muted part sounds is
// damped (a part unmuted comes in at its next note). A press (peek) sounds what is pressed, always.

const GENERIC = /^(?:|voice|voices|vocals?|voice oohs|vox|melody|tune|piano|keyboard|part|part \d+|staff|staff \d+|instrument|instrument \d+|untitled.*|p\d+)$/i;
// The view's groups: [{ key, label, hand (voice | piano | rh | lh | part), test(part, staff) }]
// in score order — none when there's one thing to hear.
function hearGroups() {
  const P = S.P, plan = P?.views[S.view];
  if (!plan) return [];
  if (S.hear && S.hear.P === P && S.hear.view === S.view) return S.hear.groups;
  const both = P.views.both, info = new Map(P.parts.map((p) => [p.id, p]));
  const staves = (pid) => info.get(pid)?.staves || 1;
  const hands = (pid) => [
    { key: pid + "|1", label: "RH", hand: "rh", test: (p, s) => p === pid && s < 2 },
    { key: pid + "|2", label: "LH", hand: "lh", test: (p, s) => p === pid && s >= 2 },
  ];
  const whole = (pid, o) => ({ key: pid, test: (p) => p === pid, ...o });
  let groups = [];
  if (plan.kind === "score" || (plan.kind === "parts" && plan.parts.length > 1)) {
    const keyboard = plan.kind === "score" && both && (both.kind === "piano" || both.kind === "hymn") ? both.parts : [];
    const sung = (plan.kind === "score" ? plan.sung : P.views.score?.sung) || [];
    const voices = plan.parts.filter((pid) => sung.includes(pid) && !keyboard.includes(pid));
    const named = (pid) => { const n = (info.get(pid)?.name || "").replace(/\s+/g, " ").trim(); return GENERIC.test(n) ? "" : n; };
    // (several singers: their names when each has its own, else Voice 1, 2 …)
    const vn = voices.map(named);
    const vnames = voices.length > 1 && vn.every((n, i) => n && vn.indexOf(n) === i) ? vn : voices.map((_, i) => (voices.length > 1 ? `Voice ${i + 1}` : "Voice"));
    plan.parts.forEach((pid, i) => {
      if (voices.includes(pid)) groups.push(whole(pid, { label: vnames[voices.indexOf(pid)], hand: "voice" }));
      else if (keyboard.includes(pid)) {
        if (both.kind === "piano") groups.push(whole(pid, { label: "Piano", hand: "piano" }));
        else groups.push(whole(pid, pid === both.parts[1] ? { label: "LH", hand: "lh" } : { label: "RH", hand: "rh" }));
      } else groups.push(whole(pid, { label: named(pid) || `Part ${i + 1}`, hand: "part" }));
    });
    // (a name another chip already has — "Voice" twice, "Piano" — goes by its place instead)
    for (const [i, g] of groups.entries()) if (groups.some((o, j) => j < i && o.label.toLowerCase() === g.label.toLowerCase())) g.label = `Part ${plan.parts.indexOf(g.key) + 1}`;
    // (the full score is the piano alone — the tune inside it: its hands)
    if (groups.length === 1 && groups[0].hand === "piano" && staves(groups[0].key) >= 2) groups = hands(groups[0].key);
  } else if (plan.kind === "piano" && plan.staff == null && plan.parts.length === 1 && staves(plan.parts[0]) >= 2) {
    groups = hands(plan.parts[0]);
  } else if (plan.kind === "hymn" && plan.parts.length === 2) {
    groups = plan.parts.map((pid, i) => whole(pid, i ? { label: "LH", hand: "lh" } : { label: "RH", hand: "rh" }));
  }
  if (groups.length < 2) groups = [];
  S.hear = { P, view: S.view, groups };
  return groups;
}
// The group a note (part, staff number) belongs to, or null.
function groupOf(part, staff) {
  for (const g of hearGroups()) if (g.test(part, staff)) return g;
  return null;
}
// The muted groups' keys in the shown view (never all of them: a record that says so hears all).
function mutedKeys() {
  const groups = hearGroups();
  const list = groups.length ? S.st.hear?.[S.view] : null;
  const keys = new Set(Array.isArray(list) ? list.filter((k) => groups.some((g) => g.key === k)) : []);
  return keys.size >= groups.length ? new Set() : keys;
}
// For playtime track: (el) → heard; null when everything is heard (v79's schedule exactly).
function hearOf() {
  const muted = mutedKeys();
  if (!muted.size) return null;
  return (e) => !muted.has(groupOf(e.part, e.staff)?.key);
}

// The chips: in the dock beside the keys when the keyboard shows and the keys keep room, else in
// the stretch's controls (shown with them). While a song or a view loads the chips stay as they
// are (v80's first build hid them for the load — the keys redrawn wider, then narrower again).
let hearDrawn = "", hearShape = ""; // (the chips drawn — with their state; without it)
function renderHear() {
  if (loading()) return;
  const groups = S.ready && !pdf.on ? hearGroups() : [];
  const muted = mutedKeys();
  hearEl.hidden = groups.length < 2;
  hearShape = groups.map((g) => g.key + "=" + g.label + "=" + g.hand).join(",");
  const key = groups.map((g) => g.key + (muted.has(g.key) ? "-" : "+")).join(",") + " " + hearShape;
  if (key !== hearDrawn) {
    hearDrawn = key;
    hearEl.replaceChildren(...groups.map((g) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.key = g.key;
      b.dataset.hand = g.hand;
      b.textContent = g.label;
      b.title = g.label;
      b.setAttribute("aria-pressed", String(!muted.has(g.key)));
      return b;
    }));
  }
  placeHear();
}
// Where the chips go: beside the keys while the keys keep KEY_MIN px a white key there (the view's
// range across what the chips leave of the dock) — on a phone with 🎹 on, or a narrow Split View,
// three chips left Piano Man's six octaves 2.6–3.7 px a key: there they go in the stretch's controls,
// as with the keyboard off. The rule reads the dock's width, never where the chips are now, so a
// move can't undo itself.
const KEY_MIN = 8;
let hearFit = { key: "", fit: true };
function placeHear() {
  let home = selbar;
  if (!dockEl.hidden && !hearEl.hidden) {
    const cs = getComputedStyle(dockEl);
    const inner = dockEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const rows = hearRowsFor(KB.h || stripEl.getBoundingClientRect().height);
    const [lo, hi] = stripRange(new Map());
    const key = `${Math.round(inner)} ${rows} ${lo}-${hi} ${hearShape}`;
    if (hearFit.key !== key) {
      if (hearEl.parentNode !== dockEl) dockEl.insertBefore(hearEl, stripEl);
      setRows(rows);
      let whites = 0;
      for (let m = lo; m <= hi; m++) if (WHITE.has(m % 12)) whites++;
      const keysW = inner - hearEl.getBoundingClientRect().width - (parseFloat(cs.columnGap) || 0);
      hearFit = { key, fit: keysW >= KEY_MIN * whites };
    }
    if (hearFit.fit) home = dockEl;
  }
  if (hearEl.parentNode !== home) {
    if (home === dockEl) dockEl.insertBefore(hearEl, stripEl);
    else selbar.insertBefore(hearEl, selClearBtn);
  }
  setRows(home === dockEl ? hearRowsFor(KB.h || stripEl.getBoundingClientRect().height) : 1);
  if (home === selbar && !selbar.hidden) placeSelbar();
}
// In the dock the chips fill the keys' height in rows of 44 px (two in portrait), then columns.
const hearRowsFor = (h) => Math.max(1, Math.floor((h + 6) / 50));
function setRows(n) {
  if (hearEl.style.getPropertyValue("--rows") !== String(n)) hearEl.style.setProperty("--rows", String(n));
}
hearEl.addEventListener("click", (e) => {
  const b = e.target.closest?.("button[data-key]");
  if (!S.ready) return; // (a song or a view loading: the chips shown are the last one's)
  if (b && !toggleHear(b.dataset.key)) {
    // (the one heard can't be muted: a shake says so, no words)
    b.classList.remove("nope");
    void b.offsetWidth;
    b.classList.add("nope");
  }
});
// → false when refused (the last one heard).
function toggleHear(key) {
  const groups = hearGroups();
  if (!groups.some((g) => g.key === key)) return true;
  const muted = mutedKeys();
  if (muted.has(key)) muted.delete(key);
  else if (muted.size + 1 < groups.length) muted.add(key);
  else return false; // (at least one heard)
  const h = S.st.hear && typeof S.st.hear === "object" && !Array.isArray(S.st.hear) ? { ...S.st.hear } : {};
  if (muted.size) h[S.view] = groups.filter((g) => muted.has(g.key)).map((g) => g.key);
  else delete h[S.view];
  if (Object.keys(h).length) S.st.hear = h;
  else delete S.st.hear;
  saveState();
  renderHear();
  rehear();
  return true;
}

// ---------------------------------------------------------------------------
// A stretch of the music (S.sel), picked by dragging over the page: written time [q0, end) — from
// an onset (a column: where the view's notes or rests start, every staff of a system) to the
// onset after the last one picked, so its rhythm, a rest at its end too, is kept. Drawn like a
// text selection, a band a system over all its staves, from the written times again after every
// drawing (a new layout, a turn, another view — where that view has onsets in it). Another song
// lets go of it. A new drag picks only on the page(s) shown.

const EPS = 1e-6;
const geoCache = new WeakMap(); // a .page element → its systems (pageGeo)

// The song's timeline (playtime.js), built once a song.
function songTime() {
  if (!S.T && S.P) {
    const t = performance.now();
    S.T = timeline(S.P.doc, S.P.facts);
    S.Tid = new Map(S.T.els.map((e) => [e.id, e]));
    S.t.timeline = ms(t);
  }
  return S.T;
}
// Sing's reading of the song (musicxml.js parseMusicXml): its performance order — the written bar
// of each bar it sings, repeats, endings, D.S. / To Coda / Fine taken — and its tempo at 100%.
// null: Sing can't read it (the written order, the score's own tempo).
function songSing() {
  if (S.sing === undefined && S.xml) {
    const t = performance.now();
    try {
      const sc = parseMusicXml(S.xml);
      S.sing = { order: sc.measureOf || null, tempo: sc.tempo };
    } catch (err) { console.info("play: Sing's order", err?.message); S.sing = null; }
    S.t.order = ms(t);
  }
  return S.sing;
}
const viewKeep = () => { const plan = S.P.views[S.view]; return (e) => keeps(plan, e.part, e.staff, e.voice); };
function viewOnsets() {
  if (!S.qs || S.qs.view !== S.view) S.qs = { view: S.view, qs: onsets(songTime(), viewKeep()) };
  return S.qs.qs;
}

// A shown page's systems, top to bottom: { top, bottom (its staves' outer lines), left, right,
// cols: [{ q, x0, x1, br (the right end of its bar) }] (each onset's heads and rests, accidentals
// and grace notes in) left to right } in px from the page element's corner. A whole-bar rest is
// drawn in the middle of its bar but starts it: it makes a column only where nothing else starts
// with the bar (a bar all staves rest), kept between its neighbours — else Killing's intro, the
// left hand resting under the tune, stretched the bar's first column over half the bar.
function pageGeo(pg) {
  let out = geoCache.get(pg);
  if (out) return out;
  songTime();
  const t0 = performance.now();
  const pr = pg.getBoundingClientRect();
  const bySys = new Map(); // g.system → { cols, whole (whole-bar rests), graces } by onset
  const ends = new Map();  // g.measure → the x its staff lines end at (its barline)
  const barEnd = (m) => {
    let x = ends.get(m);
    if (x === undefined) {
      x = null;
      for (const st of m.querySelectorAll(":scope > g.staff")) {
        const line = st.querySelector(":scope > path");
        if (line) { const r = line.getBoundingClientRect(); if (r.width) x = Math.max(x ?? -Infinity, r.right - pr.left); }
      }
      ends.set(m, x);
    }
    return x;
  };
  for (const el of pg.querySelectorAll("g.note, g.rest, g.mRest, g.multiRest")) {
    const e = S.Tid.get(el.id);
    if (!e || el.getAttribute("visibility") === "hidden") continue;
    const sys = el.closest("g.system");
    if (!sys) continue;
    const note = el.matches("g.note");
    const r = ((note && el.querySelector(":scope > g.notehead")) || el).getBoundingClientRect();
    if (!r.width && !r.height) continue;
    let x0 = r.left;
    const ac = note && el.querySelector(":scope > g.accid");
    if (ac) { const a = ac.getBoundingClientRect(); if (a.width) x0 = Math.min(x0, a.left); }
    let o = bySys.get(sys);
    if (!o) bySys.set(sys, (o = { cols: new Map(), whole: new Map(), graces: [] }));
    const key = Math.round(e.q * 1e4);
    if (e.grace) { o.graces.push({ key, x0: x0 - pr.left }); continue; }
    const into = e.mrest || (!note && el.matches("g.mRest, g.multiRest")) ? o.whole : o.cols;
    const c = into.get(key);
    if (c) { c.x0 = Math.min(c.x0, x0 - pr.left); c.x1 = Math.max(c.x1, r.right - pr.left); }
    else into.set(key, { q: e.q, x0: x0 - pr.left, x1: r.right - pr.left, m: el.closest("g.measure") });
  }
  out = [];
  for (const sys of pg.querySelectorAll("g.system")) {
    const bars = sys.querySelectorAll("g.measure");
    if (!bars.length) continue;
    let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
    for (const m of [bars[0], bars[bars.length - 1]]) {
      for (const st of m.querySelectorAll(":scope > g.staff")) {
        const lines = [];
        for (const c of st.children) { if (c.nodeName.toLowerCase() !== "path" || lines.length === 5) break; lines.push(c); }
        if (!lines.length) continue;
        const a = lines[0].getBoundingClientRect(), b = lines[lines.length - 1].getBoundingClientRect();
        top = Math.min(top, a.top, b.top); bottom = Math.max(bottom, a.bottom, b.bottom);
        left = Math.min(left, a.left); right = Math.max(right, a.right, b.right);
      }
    }
    if (!(bottom > top)) continue;
    const o = bySys.get(sys) || { cols: new Map(), whole: new Map(), graces: [] };
    for (const [key, c] of o.whole) if (!o.cols.has(key)) o.cols.set(key, { ...c, whole: true });
    for (const g of o.graces) { const c = o.cols.get(g.key); if (c) c.x0 = Math.min(c.x0, g.x0); }
    const cols = [...o.cols.values()].sort((a, b) => a.q - b.q);
    cols.forEach((c, i) => {
      // (a whole-bar rest's column between its neighbours, as near its rest as they allow)
      if (c.whole) {
        const lo = i > 0 ? cols[i - 1].x1 + 1 : -Infinity, hi = i + 1 < cols.length ? cols[i + 1].x0 - 1 : Infinity;
        const w = Math.min(c.x1 - c.x0, Math.max(1, hi - lo));
        if (c.x1 > hi) { c.x1 = hi; c.x0 = hi - w; }
        if (c.x0 < lo) { c.x0 = lo; c.x1 = lo + w; }
      }
      c.br = c.m ? barEnd(c.m) : null;
    });
    out.push({ el: sys, top: top - pr.top, bottom: bottom - pr.top, left: left - pr.left, right: right - pr.left, cols });
  }
  out.sort((a, b) => a.top - b.top);
  geoCache.set(pg, out);
  S.t.geo = ms(t0);
  return out;
}
// Where two columns' shares of the line meet: their bar's barline when they're in two bars (a
// finger lifted just short of a barline ends the stretch in that bar — v79 took the next bar's
// first beat in), else halfway.
const edge = (a, b) => (a.m !== b.m && a.br != null && a.br >= a.x1 - 1 && a.br <= b.x0 + 1 ? a.br : (a.x1 + b.x0) / 2);

// The onset under a point (client px): on the page under it (the nearer of a spread's two), the
// system nearest it, the column whose share of the line holds it. → { q, page, col } or null
// (nothing drawn there).
function colAt(x, y) {
  let best = null;
  for (const pg of stage.querySelectorAll(".page")) {
    const r = pg.getBoundingClientRect();
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    if (!best || dx < best.dx) best = { pg, r, dx };
  }
  if (!best) return null;
  const px = x - best.r.left, py = y - best.r.top;
  let sys = null, sd = Infinity;
  for (const s of pageGeo(best.pg)) {
    if (!s.cols.length) continue;
    const d = py < s.top ? s.top - py : py > s.bottom ? py - s.bottom : 0;
    if (d < sd) { sd = d; sys = s; }
  }
  if (!sys) return null;
  const c = sys.cols;
  let i = 0;
  while (i + 1 < c.length && px >= edge(c[i], c[i + 1])) i++;
  return { q: c[i].q, page: Number(best.pg.dataset.page), col: i };
}

// The finger moved (g: the press): from the press's onset to the finger's, either way.
function pickSel(g) {
  const f = colAt(g.fx, g.fy);
  if (!f || !g.anchor) return;
  setSel(Math.min(g.anchor.q, f.q), Math.max(g.anchor.q, f.q));
}
function setSel(q0, q1) {
  const end = nextOnset(viewOnsets(), q1, songTime().length);
  if (S.sel && Math.abs(S.sel.q0 - q0) < EPS && Math.abs(S.sel.end - end) < EPS) return;
  S.sel = { q0, q1, end };
  drawSel();
}
function clearSel() {
  if (!S.sel) return;
  S.sel = null;
  drawSel();
}

// The bands: a system's share of [q0, end) — from where its first onset's share of the line
// starts (halfway from the onset before, or the barline; the line's start when the stretch began
// on an earlier line) to where its last one's ends (the line's end when it goes on).
function drawSel() {
  for (const b of stage.querySelectorAll(".page .sel")) b.remove();
  const sel = S.sel;
  if (sel && S.ready) {
    const pad = 0.6 * S.sp, vpad = 1.2 * S.sp;
    for (const pg of stage.querySelectorAll(".page")) {
      const ph = pg.getBoundingClientRect().height;
      for (const sys of pageGeo(pg)) {
        const c = sys.cols;
        const i = c.findIndex((x) => x.q >= sel.q0 - EPS);
        if (i < 0 || c[i].q >= sel.end - EPS) continue;
        let j = i;
        while (j + 1 < c.length && c[j + 1].q < sel.end - EPS) j++;
        const left = i > 0 ? edge(c[i - 1], c[i]) : sel.q0 < c[0].q - EPS ? sys.left : Math.max(sys.left, c[0].x0 - pad);
        const right = j < c.length - 1 ? edge(c[j], c[j + 1]) : sys.right;
        const top = Math.max(0, sys.top - vpad), bottom = Math.min(ph, sys.bottom + vpad);
        const d = document.createElement("div");
        d.className = "sel";
        d.style.cssText = `left:${left.toFixed(1)}px;top:${top.toFixed(1)}px;width:${Math.max(2, right - left).toFixed(1)}px;height:${(bottom - top).toFixed(1)}px`;
        pg.appendChild(d);
      }
    }
  }
  playButtons();
  placeSelbar();
}

// ---------------------------------------------------------------------------
// ▶ — the view's notes on the peek's piano and context: the stretch picked (once, or ⟳ round after
// round, each round starting one stretch-length after the last began), else from the shown page's
// first bar (a spread's left page) to the end in Sing's order. At 100% the song's tempo as Sing
// plays it — its own (typed or tapped there), else the score's — with the score's tempo changes
// as ratios; speed 50–100% (per song). Sounds are scheduled ≤ AHEAD s ahead (piano.js
// scheduleAhead: WebKit's cost grows with the sources waiting to start); what sounds is lit — its
// heads and names in the peek's orange, its keys on the keyboard by hand — from the audio clock every
// frame; the page turns to the music's page whenever the music moves onto another one (a turn by
// hand isn't fought: the music's next page change is followed).

const SPEEDS = [1, 0.9, 0.8, 0.7, 0.6, 0.5];
const AHEAD = 4, PUMP = 400; // s scheduled ahead; ms between top-ups
const LEAD = 0.12;           // s from the tap to the first note
const MIN_LIT = 0.09;        // s: a short note stays lit at least this long
const STOP_TC = 0.04;        // s: ■ damps what sounds this fast
const PB = {
  state: "idle",    // "idle" | "playing" | "looping"
  kind: null,       // "span" (the stretch picked) | "page" (from the page to the end)
  gen: 0, starting: false,
  a: null, piano: null, bus: null,
  args: null, tr: null, ev: null, base: 0, from: null, // what plays (trackArgs), the schedule (playtime track), its events (bars + notes), tempo, Sing-order index
  t0: 0, s0: 0, speed: 1, // the clock: audio time t0 ↔ schedule time s0 (s at 100%; a loop's rounds add up)
  round: 0, idx: 0, // the next event to schedule
  sched: [],        // scheduled: { id, midi, when, end, sound, muted (lit lighter, not heard), X, round, g, src, off, stop, damped } and bar marks { bar, when, k, mi, round }
  log: [],          // every note struck: { id, midi, when, dur, X, round } (tests)
  timer: 0, raf: 0,
  lit: new Map(), litKey: "", sysEl: null, // what's lit (id → "play" | "hush"); the line playing
  k: -1, kr: -1, mi: -1, // the bar the music is in (index in the schedule's bars, its round, its written bar)
  pageOf: new Map(), musicPage: 0, turns: [], defer: null, // defer: a turn waiting for a finger to lift
  busyInk: [],      // what the controls keep off while playing (stage px): the ink of the line playing, the next, the stretch
};
// A note's level, n keys struck together (a big chord softer: 1 → 1.2, 3 → 1, 6 → 0.57), into a
// bus at BUS with a soft limiter (piano.js pianoBus): the full score's thickest moments, chords
// over the tune with the last ones still ringing, went past full scale (crackles).
const level = (n) => Math.min(1.2, 4 / ((n || 1) + 1));
const BUS = 0.8;
const whenOf = (X) => PB.t0 + (X - PB.s0) / PB.speed;

// The song's own tempo (Sing's "Type a tempo" / "Tap the beat": quarter notes a minute).
function songBpm() {
  try {
    const b = Number(JSON.parse(recall(K.timing) || "{}")?.[S.song]?.bpm);
    return b >= 20 && b <= 400 ? b : null;
  } catch { return null; }
}
const tempoBase = () => songBpm() || songSing()?.tempo || songTime()?.first || DEFAULT_TEMPO;

// What ▶ plays: { bars, span, base, from } — kept while it plays, so a change of what's heard
// (hear) schedules the same music again (trackOf).
function trackArgs(kind) {
  const T = songTime(), base = tempoBase();
  if (kind === "span") {
    const { q0, end } = S.sel, bars = [];
    // (to the bar its last note is in: a stretch ending at a barline has nothing of the next one)
    for (let m = barAt(T, q0); m <= barAt(T, end - 1e-3); m++) bars.push(m);
    return { bars, span: { q0, q1: end }, base, from: null };
  }
  // (from the first played bar that is the page's first written one)
  const order = songSing()?.order || T.bars.map((_, i) => i);
  const first = firstMeasureShown() ?? 0;
  let from = order.indexOf(first);
  if (from < 0) from = order.findIndex((m) => m > first);
  if (from < 0) from = 0;
  return { bars: order.slice(from), span: null, base, from };
}
// The schedule (playtime track) for those, with what's heard now.
function trackOf(args) {
  const tr = track(songTime(), { bars: args.bars, span: args.span, keep: viewKeep(), base: args.base, hear: hearOf() });
  return { ...tr, base: args.base, from: args.from };
}
// Its events: the bar marks and the notes, in time (a bar's mark before its notes).
const eventsOf = (tr) => [...tr.bars.map((b) => ({ bar: true, ...b })), ...tr.items].sort((x, y) => x.sec - y.sec || (y.bar ? 1 : 0) - (x.bar ? 1 : 0));

async function playStart(kind, loop = false) {
  if (pdf.on || !S.ready || (kind === "span" && !S.sel)) return;
  stopPlay();
  const gen = ++PB.gen;
  const a = getCtx("tap"); // (in the tap: iOS starts audio only from one — the session first)
  let tr, args;
  const tb = performance.now();
  try { args = trackArgs(kind); tr = trackOf(args); } catch (err) { console.warn("play", err); return; }
  S.t.track = ms(tb);
  if (!(tr.len > 0)) return;
  const ev = eventsOf(tr);
  Object.assign(PB, {
    state: loop ? "looping" : "playing", kind, starting: true, a, piano: null, args, tr, ev, base: tr.base, from: tr.from,
    speed: S.speed, t0: 0, s0: 0, round: 0, idx: 0, sched: [], log: [],
    lit: new Map(), litKey: "", sysEl: null, k: -1, kr: -1, mi: -1, musicPage: 0, turns: [], defer: null,
    busyInk: [], drawn: -1,
  });
  activity("play");
  playButtons();
  placeSelbar();
  // the context running (iOS: from the tap's resume) and the piano in
  const t0 = performance.now();
  for (;;) {
    if (gen !== PB.gen) return;
    if (a.state === "running") {
      let piano;
      try { piano = await loadPiano(a); } catch (err) { console.warn("piano", err); if (gen === PB.gen) stopPlay(); return; }
      if (gen !== PB.gen) return;
      if (a.state !== "running") continue;
      PB.piano = piano;
      break;
    }
    // (a context that won't start is given up: the next tap starts over with a new one)
    if (a.state === "closed" || a !== ac || performance.now() - t0 > 3000) { if (gen === PB.gen) stopPlay(); return; }
    await sleep(30);
  }
  PB.starting = false;
  PB.bus = pianoBus(a, BUS);
  PB.t0 = a.currentTime + LEAD + (PB.tr.pre || 0); // (grace notes before the first note: before 0; PB.tr: what's heard may have changed meanwhile)
  keepAwake(a); // (the presses' source: one for both)
  pump();
  PB.timer = setInterval(pump, PUMP);
  PB.raf = requestAnimationFrame(frame);
  playButtons();
}

// Schedule what starts within AHEAD s (round after round in a loop).
function pump() {
  if (PB.state === "idle" || !PB.piano) return;
  const a = PB.a, now = a.currentTime, until = now + AHEAD, ev = PB.ev, len = PB.tr.len;
  for (let guard = 0; guard < 50000; guard++) {
    if (PB.idx >= ev.length) {
      if (PB.state !== "looping") break;
      PB.round++;
      PB.idx = 0;
      continue;
    }
    const e = ev[PB.idx], X = PB.round * len + e.sec, when = whenOf(X);
    if (when >= until) break;
    PB.idx++;
    if (when < now - 0.05) continue; // (missed: the page was held up longer than the lookahead)
    if (e.bar) { PB.sched.push({ bar: true, when, k: e.k, mi: e.mi, round: PB.round }); continue; }
    const x = { id: e.id, midi: e.midi, when, end: when + Math.max(e.dur / PB.speed, MIN_LIT), sound: e.sound, muted: !!e.muted, X, round: PB.round, hand: e.hand ??= handOf(S.P.facts.get(e.id) || {}) };
    if (e.sound) {
      const hold = e.hold / PB.speed, tmp = [];
      x.g = playPiano(a, PB.piano, Math.max(when, now), hold, e.midi, level(e.n), tmp, PB.bus);
      x.src = tmp[0];
      x.off = when + hold;
      x.stop = when + Math.max(0.12, hold) + 0.8;
      x.log = { id: e.id, midi: e.midi, when, dur: hold, X, round: PB.round, n: e.n };
      PB.log.push(x.log);
    }
    PB.sched.push(x);
  }
  // (forget what's long over: notes rung out, bar marks older than a long bar)
  const old = now - 1;
  PB.sched = PB.sched.filter((x) => (x.bar ? x.when > now - 30 : Math.max(x.end, x.stop || 0) > old));
  if (PB.log.length > 8000) PB.log.splice(0, PB.log.length - 8000);
}

// Every frame: what sounds (lit), the bar the music is in (the page follows), the end.
function frame() {
  PB.raf = 0;
  if (PB.state === "idle") return;
  const a = PB.a;
  if (!a || a.state === "closed") { stopPlay(); return; }
  const now = a.currentTime - (a.outputLatency || a.baseLatency || 0); // (what is heard now)
  if (PB.state === "playing" && now >= whenOf(PB.tr.len) + 0.05) { stopPlay(true); return; }
  const lit = new Map();
  let bar = null;
  for (const e of PB.sched) {
    if (e.bar) { if (e.when <= now + 0.001 && (!bar || e.when >= bar.when)) bar = e; }
    else if (e.when <= now && now < e.end) lit.set(e.id, e);
  }
  if (bar && (bar.k !== PB.k || bar.round !== PB.kr)) {
    PB.k = bar.k; PB.kr = bar.round; PB.mi = bar.mi;
    follow(bar.mi);
  }
  setLit(lit);
  PB.raf = requestAnimationFrame(frame);
}

// The music moved into written bar mi: turn to its page when it's another page and not shown —
// not under a finger: while one is on the music (a peek held, a stretch being dragged) the turn
// waits for the lift (afterPress).
function follow(mi) {
  if (!S.ready || pdf.on || !S.v || S.loaded !== S.v) return;
  let p = PB.pageOf.get(mi);
  if (p === undefined) {
    try { p = tk.getPageWithElement("m" + S.v.firstMeasureAtOrAfter(mi)) || 0; } catch { p = 0; }
    PB.pageOf.set(mi, p);
  }
  if (!p || p === PB.musicPage) return;
  PB.musicPage = p;
  PB.defer = null;
  if (shownPages().includes(p)) return;
  if (gests.size) { PB.defer = { mi, page: p }; return; }
  turnWith(mi, p);
}
function turnWith(mi, p) {
  goPage(S.spread && p % 2 === 0 ? p - 1 : p);
  PB.turns.push({ mi, page: p, k: PB.k, round: PB.kr, t: Math.round(performance.now()) });
  if (PB.turns.length > 50) PB.turns.shift();
}
// A press ended (g): the turn it held back is taken at the last finger's lift — unless a press
// picked a stretch (it's on the page shown: the page stays, as after a turn by hand; the music's
// next page is followed).
function afterPress(g) {
  if (g.drag && g.anchor) PB.defer = null;
  if (gests.size) return;
  const d = PB.defer;
  PB.defer = null;
  if (!d || PB.state === "idle" || !S.ready || pdf.on) return;
  if (d.page === PB.musicPage && !shownPages().includes(d.page)) turnWith(d.mi, d.page);
}

// Light what sounds (ids → scheduled entries) on the shown pages (.play; a muted part's notes
// lighter, .hush) and on the keyboard (what's heard only); the line playing (its notes', else its
// bar's) for where the controls go — found again after every drawing (a turn, a new layout), rests
// and held notes included.
// (PB.lit: id → the class it has — an entry's muted flag can change under it: rehear)
function setLit(lit) {
  const cls = new Map([...lit].map(([id, e]) => [id, e.muted ? "hush" : "play"]));
  const key = [...cls].map(([id, c]) => id + c[0]).join(" ");
  if (key === PB.litKey && PB.drawn === S.showGen) return;
  PB.litKey = key;
  PB.drawn = S.showGen;
  const on = (id) => { const g = document.getElementById(id); return g && stage.contains(g) ? g : null; };
  for (const [id, c] of PB.lit) if (cls.get(id) !== c) on(id)?.classList.remove(c);
  let sys = null;
  for (const [id, c] of cls) {
    const g = on(id);
    if (!g) continue;
    g.classList.add(c);
    sys ||= g.closest("g.system");
  }
  PB.lit = cls;
  if (!sys && PB.mi >= 0 && S.v && PB.state !== "idle") {
    const m = on("m" + S.v.firstMeasureAtOrAfter(PB.mi));
    sys = m?.closest("g.system") || null;
  }
  if (sys !== PB.sysEl) {
    PB.sysEl = sys;
    busyNow();
    placeSelbar();
  }
  if (PB.state !== "idle") playKeys(lit);
}

// What the controls keep off while playing (PB.busyInk, stage px, [left, top, right, bottom]): the
// ink of the line playing, of the line after it on the page(s) shown (read next) and a stretch's
// bands (a loop comes back to them) — each bar's staves with their notes and words, and its marks
// (the paper above a line's last bar is free).
function busyNow() {
  const ink = [], sys = PB.sysEl;
  PB.busyInk = ink;
  if (!sys?.isConnected) return;
  const st = stage.getBoundingClientRect();
  const box = (el) => { const r = el.getBoundingClientRect(); return [r.left - st.left, r.top - st.top, r.right - st.left, r.bottom - st.top]; };
  const all = [...stage.querySelectorAll(".page g.system")];
  const next = all[all.indexOf(sys) + 1];
  for (const s of next ? [sys, next] : [sys]) {
    for (const g of s.querySelectorAll("g.measure > g")) { const b = box(g); if (b[2] > b[0] || b[3] > b[1]) ink.push(b); }
  }
  if (PB.kind === "span") for (const b of stage.querySelectorAll(".page .sel")) ink.push(box(b));
}

// The keys ▶ sounds now, by hand, on the keyboard (with the strikes') — not a muted part's.
function playKeys(lit) {
  const keys = new Map();
  for (const e of lit.values()) {
    if (e.muted || keys.has(e.midi)) continue;
    const f = S.P.facts.get(e.id);
    if (f) keys.set(e.midi, { hand: e.hand, label: labelOf(f) });
  }
  KB.play = keys;
  drawKeys();
}

// ■, the end, or anything that stops it (another ▶, song, view, 📄, the page hidden or left).
// natural: the music ran out (its last notes ring on).
function stopPlay(natural = false) {
  PB.gen++;
  const was = PB.state !== "idle" || PB.starting;
  clearInterval(PB.timer);
  PB.timer = 0;
  if (PB.raf) cancelAnimationFrame(PB.raf);
  PB.raf = 0;
  const a = PB.a;
  if (a && a.state !== "closed") {
    const now = a.currentTime;
    for (const e of PB.sched) {
      if (!e.src) continue;
      try {
        if (e.when > now + 0.005) {
          // (not started: never will — as holdPiano's release before the start)
          e.g.gain.cancelScheduledValues(0);
          e.g.gain.setValueAtTime(0, now);
          e.src.stop(e.when);
        } else if (!natural) {
          e.g.gain.cancelScheduledValues(now);
          e.g.gain.setTargetAtTime(0, now, STOP_TC);
          e.src.stop(now + STOP_TC * 8);
        }
      } catch {}
    }
  }
  Object.assign(PB, { state: "idle", kind: null, starting: false, piano: null, sched: [], busyInk: [], sysEl: null, defer: null });
  if (!was) return;
  if (a && awake.src && awake.a === a) keepAwake(a); // (awake AWAKE ms from the stop, as from a lift — never while hidden)
  setLit(new Map());
  KB.play = new Map();
  drawKeys();
  playButtons();
  placeSelbar();
}

// Change the speed: what hasn't started is taken back and scheduled again from here at the new one.
function setSpeed(v) {
  if (!SPEEDS.includes(v)) return;
  S.speed = v;
  speedSel.value = String(v);
  if (S.song) { S.st.speed = v; saveState(); }
  if (PB.state === "idle" || !PB.piano) { PB.speed = v; return; }
  reschedule(PB.a.currentTime + 0.05, v);
}
// From audio time `at`: what was scheduled to start later is taken back (silenced at its start) and
// the schedule (PB.ev) laid again from there — at `speed` (the clock stays continuous at `at`).
function reschedule(at, speed = PB.speed) {
  const now = PB.a.currentTime;
  const X = PB.s0 + (at - PB.t0) * PB.speed;
  PB.sched = PB.sched.filter((e) => {
    if (e.when <= at) return true;
    if (e.src) try { e.g.gain.cancelScheduledValues(0); e.g.gain.setValueAtTime(0, now); e.src.stop(e.when); } catch {}
    return false;
  });
  PB.log = PB.log.filter((e) => e.when <= at);
  PB.t0 = at;
  PB.s0 = X;
  PB.speed = speed;
  const len = PB.tr.len;
  PB.round = PB.state === "looping" && len > 0 ? Math.floor(X / len + 1e-9) : 0;
  const local = X - PB.round * len;
  PB.idx = PB.ev.findIndex((e) => e.sec > local + 1e-9);
  if (PB.idx < 0) PB.idx = PB.ev.length;
  pump();
}
// What's heard changed (a chip) while ▶ plays: the same music scheduled again with it from now —
// everything not yet started is taken back (silenced at its start, as ■ does) and laid again from
// the new schedule, a heard note due in the next instant included (the unison the muted part had
// taken is the piano's again); what a newly muted part already sounds is damped (STOP_TC) and lit
// lighter; a part unmuted comes in at its next note (a note half over isn't struck late). A key
// nothing heard sounds any more — a unison whose struck twin was the muted part's — is lit lighter
// too. (v80's first build kept what was due within 50 ms and damped a muted note there as if it
// sounded: the cancel took its level back to full, so it still started — a blip of the part just
// muted — and the heard twin it had beaten was never struck.)
function rehear() {
  if ((PB.state === "idle" && !PB.starting) || !PB.args) return;
  const t = performance.now();
  PB.tr = trackOf(PB.args);
  PB.ev = eventsOf(PB.tr);
  S.t.rehear = ms(t);
  if (!PB.piano) return; // (still starting: it schedules from the new one)
  const now = PB.a.currentTime;
  const muted = mutedKeys();
  const isMuted = (id) => { const e = S.Tid.get(id); return !!e && muted.has(groupOf(e.part, e.staff)?.key); };
  // (what has started: reschedule below takes back everything later)
  for (const e of PB.sched) {
    if (e.bar || e.when > now || !isMuted(e.id)) continue;
    e.muted = true;
    if (e.src && !e.damped) {
      e.damped = true;
      try { e.g.gain.cancelScheduledValues(now); e.g.gain.setTargetAtTime(0, now, STOP_TC); e.src.stop(now + STOP_TC * 8); } catch {}
      e.off = Math.min(e.off ?? now, now);
      if (e.log) e.log.cut = now; // (the log says when it was cut)
    }
  }
  for (const e of PB.sched) {
    if (e.bar || e.muted || e.src || e.when > now) continue;
    const live = PB.sched.some((x) => x.src && !x.damped && x.midi === e.midi && x.when <= now && x.off > now);
    if (!live) e.muted = true;
  }
  reschedule(now);
  S.t.rehear = Math.round((performance.now() - t) * 10) / 10;
}

const ICONS = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2z" fill="currentColor"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="1.6" fill="currentColor"/></svg>',
};
function setIcon(btn, kind, label) {
  if (btn.dataset.icon !== kind) { btn.dataset.icon = kind; btn.innerHTML = ICONS[kind]; }
  btn.setAttribute("aria-label", label);
  btn.title = label;
}
function playButtons() {
  const on = PB.state !== "idle" || PB.starting;
  setIcon(playBtn, on ? "stop" : "play", on ? "Stop" : "Play");
  playBtn.disabled = !on && (!S.ready || pdf.on);
  setIcon(selPlayBtn, on ? "stop" : "play", on ? "Stop" : "Play");
  selLoopBtn.setAttribute("aria-pressed", String(PB.state === "looping"));
}

// The stretch's controls (▶ ⟳ speed ✕; ■ and speed while the page plays): over the music where
// they cover none of the stretch's bands, the peeked chord and its names, nor — while playing —
// the ink of the line the music is on, the one after it and the stretch's lines (busyNow): at the
// stage's foot (just above the keyboard when it's on: it's under the stage), else its head, else a
// corner, else in free paper between two lines; where nothing is clear, the place covering least.
function placeSelbar() {
  const on = PB.state !== "idle" || PB.starting;
  const show = S.ready && !pdf.on && (!!S.sel || on);
  selbar.hidden = !show;
  if (!show) return;
  selLoopBtn.hidden = selClearBtn.hidden = !S.sel;
  const st = stage.getBoundingClientRect();
  const w = selbar.offsetWidth, h = selbar.offsetHeight, m = 10;
  const yB = st.height - h - m, yT = m;
  const xC = (st.width - w) / 2, xR = st.width - w - m, xL = m;
  const rel = (r) => [r.left - st.left, r.top - st.top, r.right - st.left, r.bottom - st.top];
  const busy = [];
  for (const b of stage.querySelectorAll(".page .sel")) busy.push(rel(b.getBoundingClientRect()));
  if (on) busy.push(...PB.busyInk);
  if (peekShown()) {
    for (const pk of peeks) for (const it of pk.items) busy.push(rel(it.head.getBoundingClientRect()));
    if (bubbleEl.classList.contains("on")) busy.push(rel(bubbleEl.getBoundingClientRect()));
  }
  const spots = [[xC, yB, "bottom"], [xC, yT, "top"], [xR, yB, "bottom-right"], [xL, yB, "bottom-left"], [xR, yT, "top-right"], [xL, yT, "top-left"]];
  // (else the free paper of a column — right, middle, left — between what's busy there: between
  // two lines, where the justified page leaves room)
  for (const [x, at] of [[xR, "gap-right"], [xC, "gap"], [xL, "gap-left"]]) {
    const cuts = busy.filter(([l, , r]) => r > x && l < x + w).map(([, t, , b]) => [t, b]).sort((a, b) => a[0] - b[0]);
    let y0 = m;
    for (const [t, b] of [...cuts, [st.height - m, st.height - m]]) {
      if (t - y0 >= h + 4) spots.push([x, (y0 + t - h) / 2, at]);
      y0 = Math.max(y0, b);
    }
  }
  let best = null;
  for (const [x, y, at] of spots) {
    let o = 0;
    for (const [l, t, r, b] of busy) o += Math.max(0, Math.min(r, x + w) - Math.max(l, x)) * Math.max(0, Math.min(b, y + h) - Math.max(t, y));
    if (!best || o < best.o - 0.5) best = { x, y, o, at };
    if (o === 0) break;
  }
  selbar.style.transform = `translate(${Math.round(best.x)}px, ${Math.round(best.y)}px)`;
  selbar.dataset.at = best.at;
}

playBtn.addEventListener("click", () => (PB.state !== "idle" || PB.starting ? stopPlay() : playStart(S.sel ? "span" : "page")));
selPlayBtn.addEventListener("click", () => (PB.state !== "idle" || PB.starting ? stopPlay() : playStart("span")));
selLoopBtn.addEventListener("click", () => (PB.state === "looping" ? stopPlay() : playStart("span", true)));
selClearBtn.addEventListener("click", () => { if (PB.kind === "span") stopPlay(); clearSel(); });
speedSel.addEventListener("change", () => setSpeed(Number(speedSel.value)));

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
// A page turn, a peek or a ▶ on the open song.
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
  yes.title = "Fewer names: " + yes.textContent; // (a big phone shows the button without the question)
  yes.setAttribute("aria-label", yes.title);
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
// size — into one reused canvas at the screen's pixel ratio; the same ‹ › and keys turn its
// pages (a tap on it does nothing). The sheet stays laid out underneath (hidden), so going back is instant and
// at its place. There's no mapping between the two.

const PDFJS = new URL("./omr/pdfjs/", import.meta.url).href;
const PRINT = 96 / 72; // CSS px per pt at print size
// (open: the opening under way — a newer one or pdfOff wins; gen: the drawing under way)
// (W, H: the stage the last drawing was made for)
const pdf = { has: false, on: false, open: 0, gen: 0, task: null, doc: null, pages: 0, page: 1, spread: false, canvas: null, sizes: [], busy: false, W: 0, H: 0 };
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

// (back from the PDF: the sheet is laid out again at once if the stage changed meanwhile — a rotation)
pdfBtn.addEventListener("click", () => { if (!pdf.on) return pdfOn(); pdfOff(); clearTimeout(resizeTimer); sized(); });

function pdfControls() {
  pdfBtn.setAttribute("aria-pressed", String(pdf.on));
  if (pdf.on) stage.dataset.pdf = "";
  else delete stage.dataset.pdf;
  dock(); // (the keyboard: hidden over the PDF — the page gets its height)
  renderHear();
  handsSel.disabled = pdf.on || !S.ready;
  for (const b of offerEl.querySelectorAll("button")) b.disabled = pdf.on; // (kept in place: the bar doesn't move)
  sizeButtons();
  placeSelbar(); // (the stretch's controls: not over the PDF)
  // (the PDF also opens when the sheet couldn't be drawn)
  if (pdf.on || S.ready) pager();
  else {
    pgEl.textContent = S.failed ? "" : "…";
    prevBtn.disabled = nextBtn.disabled = true;
  }
}

// (pdf.js 6: the document is freed — its worker ended — through its loading task)
const pdfFree = (task) => { try { task?.destroy()?.catch?.(() => {}); } catch {} };
function pdfFailed() {
  pdfOff();
  showMsg("Couldn't open the PDF.");
  setTimeout(() => { if (msgEl.textContent === "Couldn't open the PDF.") showMsg(""); }, 3000);
}

async function pdfOn() {
  if (!pdf.has || pdf.on || !S.song) return;
  const id = S.song, g = ++pdf.open;
  clearPeek();
  stopPlay();
  pdf.on = true;
  pdf.busy = true;
  pdfControls();
  try {
    const [lib, rec] = await Promise.all([pdfjs(), getPdf(id)]);
    if (g !== pdf.open) return;
    if (!rec?.pdf) throw new Error("no PDF stored");
    const src = rec.pdf;
    const data = src instanceof Blob ? new Uint8Array(await src.arrayBuffer())
      : ArrayBuffer.isView(src) ? new Uint8Array(src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength))
      : new Uint8Array(src.slice(0)); // (a copy: pdf.js hands the data to its worker)
    if (g !== pdf.open) return;
    const task = lib.getDocument({ data, wasmUrl: PDFJS + "wasm/", standardFontDataUrl: PDFJS + "standard_fonts/", iccUrl: PDFJS + "iccs/" });
    pdf.task = task;
    const doc = await task.promise;
    if (g !== pdf.open) { if (pdf.task === task) pdf.task = null; pdfFree(task); return; }
    pdf.doc = doc;
    pdf.pages = doc.numPages;
    const p0 = Number(S.st.pdfPage);
    pdf.page = Number.isInteger(p0) && p0 >= 1 && p0 <= pdf.pages ? p0 : 1;
    pdf.busy = false;
    if ((await pdfRender()) === "error") throw new Error("PDF page");
  } catch (err) {
    if (g !== pdf.open) return;
    console.warn("pdf", err);
    pdfFailed();
  }
}

function pdfOff() {
  pdf.open++;
  pdf.gen++;
  pdf.on = false;
  pdf.busy = false;
  pdf.W = pdf.H = 0;
  pdfTask?.cancel();
  if (pdf.canvas) {
    pdf.canvas.width = pdf.canvas.height = 0; // (iOS caps the canvas memory of a page)
    pdf.canvas.remove();
  }
  const task = pdf.task;
  pdf.task = null;
  pdf.doc = null;
  pdfFree(task); // (also ends an opening still under way)
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
  pdfRender().then((r) => { if (r === "error") pdfFailed(); });
  return true;
}

// Draw the shown page(s) fitted to the stage. A newer call wins: it cancels a drawing still under
// way first (pdf.js refuses a second render on a canvas in use — two quick pedal presses left the
// newer page undrawn and the older one finishing on the canvas). Never rejects: → true (drawn),
// false (overtaken, nothing to draw) or "error" (a page that can't be read, no canvas memory).
async function pdfRender() {
  const doc = pdf.doc;
  if (!doc || !pdf.on) return false;
  const g = ++pdf.gen;
  try {
    return await pdfDraw(doc, g);
  } catch (err) {
    if (g !== pdf.gen || err?.name === "RenderingCancelledException") return false;
    console.warn("pdf page", err);
    return "error";
  }
}
async function pdfDraw(doc, g) {
  const { W, H } = stageSize();
  if (W < 60 || H < 60) return false;
  pdf.W = W; // (the stage this drawing is for: sized() leaves it alone at this size)
  pdf.H = H;
  const t0 = performance.now();
  const first = await doc.getPage(1);
  if (g !== pdf.gen) return false;
  const v1 = first.getViewport({ scale: 1 });
  const fit = (w, vp) => Math.min(w / vp.width, H / vp.height);
  // (two side by side when each is still ≥ 75% of print size — or as big as one alone: a page
  // limited by the height, an 11" iPad or a mini in landscape)
  const one = fit(W, v1), two = fit(Math.floor(W / 2), v1);
  pdf.spread = W > H && pdf.pages > 1 && (two >= 0.75 * PRINT || two >= 0.97 * one);
  if (pdf.spread && pdf.page % 2 === 0) pdf.page--;
  const list = pdf.spread ? [pdf.page, pdf.page + 1].filter((p) => p <= pdf.pages) : [pdf.page];
  const each = pdf.spread ? Math.floor(W / 2) : W;
  const pages = await Promise.all(list.map((p) => (p === 1 ? first : doc.getPage(p))));
  if (g !== pdf.gen) return false;
  if (pdfTask) {
    const t = pdfTask;
    pdfTask = null;
    t.cancel();
    await t.promise.catch(() => {});
    if (g !== pdf.gen) return false;
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
  if (!ctx) throw new Error("no canvas context"); // (iOS: the page's canvas memory is used up)
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  pdfPager();
  // (one page after the other, each in its place: pdf.js fills the whole canvas with its
  // background before drawing, so it gets a transparent one and the canvas was made white)
  let x = 0;
  for (const b of boxes) {
    if (g !== pdf.gen) return false;
    const vp = b.pg.getViewport({ scale: b.s * dpr });
    const task = (pdfTask = b.pg.render({ canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, Math.round(x * dpr), 0], background: "rgba(0,0,0,0)" }));
    try { await task.promise; } finally { if (pdfTask === task) pdfTask = null; }
    x += b.w;
  }
  S.t.pdf = ms(t0);
  return true;
}

// ---------------------------------------------------------------------------
// Rotation / resize: the same bar stays on screen.

let resizeTimer = 0;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(sized, 150);
}).observe(stage);
function sized() {
  // (the PDF drawn again only for a stage of another size: opening it hides the keyboard, and the
  // stage's growth reached here after the opening had already drawn for it — a second drawing
  // blanked the page and drew it again)
  if (pdf.on) {
    const { W, H } = stageSize();
    if (W !== pdf.W || H !== pdf.H) pdfRender().then((r) => { if (r === "error") pdfFailed(); });
  }
  if (!S.P || !tk || S.failed) return;
  const L = measure();
  if (!L) return;
  if (S.waiting) { loadView(S.gen); return; } // (the stage had no size when it loaded)
  // (the sheet under the PDF isn't laid out for the stage the PDF has — the keyboard's height in:
  // back on the sheet it's the size it was, or laid out then)
  if (S.loaded !== S.v || pdf.on) return;
  if (Math.abs(L.W - S.W) < 2 && Math.abs(L.H - S.H) < 2) return;
  relayout();
}

// ---------------------------------------------------------------------------
// The screen stays on while a song is shown.

let wake = null, wakeRequests = 0, wakeAsking = false;
async function holdWake() {
  if (!S.ready || document.visibilityState !== "visible" || !navigator.wakeLock) return;
  if (wakeAsking || (wake && !wake.released)) return;
  wakeAsking = true;
  try {
    wakeRequests++;
    const w = await navigator.wakeLock.request("screen"); // (asked before the first await: a gesture's activation counts)
    wake = w;
    w?.addEventListener?.("release", () => { if (wake === w) wake = null; });
  } catch { wake = null; } finally { wakeAsking = false; }
}
// WebKit (Safari) grants the lock only in a user gesture, or after one grant in this document:
// opening the page, a reload and the re-request when the page shows again have none, and page
// turns don't ask — so every trusted tap or key asks until it's held.
for (const t of ["pointerup", "click", "keydown"]) document.addEventListener(t, (e) => { if (e.isTrusted) holdWake(); }, true);
function dropWake() {
  const w = wake;
  wake = null;
  try { w?.release?.()?.catch?.(() => {}); } catch {}
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") { lastTick = performance.now(); dropWake(); holdWake(); }
  else { clearPeek(); stopPlay(); sleepAudio(); saveState(); }
});
// Leaving the page: give the tab's audio session back (iOS keeps a page's type for the whole
// tab: a "playback" left behind kept the Tuner's microphone from starting) and the PDF's canvas.
window.addEventListener("pagehide", () => {
  clearPeek();
  stopPlay();
  sleepAudio();
  if (pdf.on) pdfOff();
  saveState();
  dropWake();
  if (ac) ac.close().catch(() => {});
  ac = null;
  voices = new Map();
  setSession("auto");
});
window.addEventListener("pageshow", (e) => {
  if (!e.persisted) return;
  holdWake();
  lastTick = performance.now();
  for (const t of UNLOCK) document.addEventListener(t, unlockPlay, true); // (the next tap starts the audio again)
  if (!ac && S.ready) idle(() => { if (!ac) warmAudio(); });
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
{ const k = recall(K.keys); setKeys(k === "on" ? true : k === "off" ? false : keysDefault()); }
(async () => {
  const listed = await fillSongs();
  const saved = recall(K.song);
  if (listed) prune().catch(() => {});
  await open(known(saved) ? saved : FIRST);
})();

// Every head of every page of the current layout, counted from the SVG (tests).
function countAll() {
  let rendered = 0;
  for (let p = 1; p <= S.pages; p++) {
    if (!S.counted.has(p)) {
      const had = cache.has(p);
      const doc = new DOMParser().parseFromString(svgOf(p), "image/svg+xml");
      S.counted.set(p, [...doc.querySelectorAll("g.note")].filter((g) => g.querySelector(":scope > g.notehead") && g.getAttribute("visibility") !== "hidden").length);
      if (!had) cache.delete(p);
    }
    rendered += S.counted.get(p);
  }
  return { rendered, pitched: S.v?.pitched ?? 0 };
}

// The keys lit on the keyboard (tests; none when it's hidden).
const litKeys = () => (dockEl.hidden ? [] : [...stripEl.querySelectorAll("rect.lit")].map((r) => ({ midi: Number(r.dataset.midi), hand: r.dataset.hand })));

// A strike for tests: its notes, names, finger, whether it's held and what it still sounds.
function peekInfo(pk) {
  const live = pk.notes && !pk.dead && (pk.held || (pk.a && pk.a.currentTime < pk.end + 0.3));
  return {
    ids: pk.items.map((it) => it.id), names: (pk.names || []).join(" "), held: pk.held, pid: pk.pid,
    sounding: live ? pk.midis.filter((m) => voices.get(m)?.pk === pk) : [],
  };
}

// ▶'s state for tests: what's scheduled and lit, the bar the music is in, the page turns.
function playDebug() {
  const a = PB.a;
  return {
    state: PB.state, kind: PB.kind, starting: PB.starting, speed: S.speed, playSpeed: PB.speed,
    span: S.sel ? { ...S.sel } : null, tempo: PB.base || (S.P ? tempoBase() : null), bpm: S.song ? songBpm() : null,
    from: PB.from, order: PB.tr ? PB.tr.bars.map((b) => b.mi) : null, len: PB.tr?.len ?? null,
    sing: S.sing ? { order: S.sing.order ? S.sing.order.length : null, tempo: S.sing.tempo } : S.sing,
    t0: PB.t0, s0: PB.s0, round: PB.round, now: a && a.state !== "closed" ? a.currentTime : null,
    latency: a ? a.outputLatency || a.baseLatency || 0 : 0,
    items: PB.tr ? PB.tr.items.map((x) => ({ id: x.id, midi: x.midi, sec: x.sec, dur: x.dur, hold: x.hold, sound: x.sound, k: x.k, n: x.n, ...(x.muted ? { muted: true } : {}) })) : [],
    scheduled: PB.log.map((x) => ({ ...x })),
    lit: [...PB.lit.keys()], litEls: [...stage.querySelectorAll(".page g.note.play")].map((g) => g.id),
    hushed: [...PB.lit].filter(([, c]) => c === "hush").map(([id]) => id), hushEls: [...stage.querySelectorAll(".page g.note.hush")].map((g) => g.id),
    // what ▶ plays: the view's chips (key, label, hand, heard), the muted keys, where the chips are
    hear: {
      groups: (S.P ? hearGroups() : []).map((g) => ({ key: g.key, label: g.label, hand: g.hand, heard: !mutedKeys().has(g.key) })),
      muted: S.P ? [...mutedKeys()] : [], saved: S.st.hear ? JSON.parse(JSON.stringify(S.st.hear)) : null,
      home: hearEl.hidden ? null : hearEl.parentNode === dockEl ? "dock" : "selbar",
      shown: !hearEl.hidden && !!hearEl.offsetParent,
      rect: hearEl.hidden || !hearEl.offsetParent ? null : (() => { const r = hearEl.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })(),
      chips: [...hearEl.querySelectorAll("button")].map((b) => { const r = b.getBoundingClientRect(); return { key: b.dataset.key, label: b.textContent, hand: b.dataset.hand, pressed: b.getAttribute("aria-pressed") === "true", rect: [r.left, r.top, r.width, r.height] }; }),
    },
    strip: litKeys(),
    k: PB.k, kr: PB.kr, mi: PB.mi, musicPage: PB.musicPage, turns: PB.turns.map((x) => ({ ...x })), defer: PB.defer ? { ...PB.defer } : null,
    pre: PB.tr?.pre ?? null, bus: PB.bus ? PB.bus.gain.value : null,
    busy: PB.busyInk.length,
    bands: [...stage.querySelectorAll(".page .sel")].map((b) => ({ page: Number(b.parentElement.dataset.page), left: b.offsetLeft, top: b.offsetTop, width: b.offsetWidth, height: b.offsetHeight })),
    selbar: selbar.hidden ? null : { at: selbar.dataset.at, loop: !selLoopBtn.hidden, rect: (() => { const r = selbar.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })() },
    geo: () => [...stage.querySelectorAll(".page")].map((pg) => ({ page: Number(pg.dataset.page), rect: (() => { const r = pg.getBoundingClientRect(); return [r.left, r.top]; })(), systems: pageGeo(pg).map((x) => ({ top: x.top, bottom: x.bottom, left: x.left, right: x.right, cols: x.cols.map((c) => [c.q, c.x0, c.x1]) })) })),
    onsets: () => (S.P ? viewOnsets().slice() : []),
    timeline: () => (S.P ? { bars: songTime().bars.map((b) => ({ ...b })), length: S.T.length, tempos: S.T.tempos, first: S.T.first, els: S.T.els.map((e) => ({ ...e })) } : null),
    singOrder: () => (S.P ? songSing()?.order?.slice() ?? null : null),
    pageOf: (mi) => (S.ready && S.v ? tk.getPageWithElement("m" + S.v.firstMeasureAtOrAfter(mi)) || 0 : 0),
  };
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
      pages: S.pages, page: S.page, shown: shownPages(), spread: S.spread, sp: S.sp, scale: S.scale, step: S.step, size: S.step ? S.sp : null,
      sizeAuto: !S.step, auto: S.auto, sizes: JSON.parse(JSON.stringify(S.sizes)), cap: S.cap, base: S.base, mode: S.mode, device: device(), fitLog: S.fitLog.map((x) => ({ ...x })),
      W: S.W, H: S.H, names: S.names, at: S.at,
      counts: { rendered, pitched: S.v?.pitched ?? 0, pages: S.counted.size }, countAll,
      get facts() { return S.P ? Object.fromEntries(S.P.facts) : {}; },
      state: { ...S.st },
      // the newest strike on screen (peeks: all of them, oldest first)
      peek: peeks.length ? {
        ...peekInfo(peeks.at(-1)),
        lit: litKeys(),
      } : null,
      // the keyboard (🎹): the setting, its pref, shown, its rect (client px), range and lit keys
      keys: {
        on: KB.on, pref: recall(K.keys), dflt: keysDefault(), shown: !dockEl.hidden,
        rect: dockEl.hidden ? null : (() => { const r = dockEl.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })(),
        range: dockEl.hidden ? null : (() => { const k = [...stripEl.querySelectorAll("rect.key")].map((r) => Number(r.dataset.midi)); return k.length ? [Math.min(...k), Math.max(...k)] : null; })(),
        lit: litKeys(), draws: KB.draws,
      },
      peeks: peeks.map(peekInfo),
      peekLog: peekLog.map((x) => ({ ...x })),
      audio: ac ? { state: ac.state, stuck: acStuck, session: navigator.audioSession?.type ?? null, rate: ac.sampleRate, base: ac.baseLatency ?? null, out: ac.outputLatency ?? null, piano: !!pianoNow(ac) } : null,
      awake: { on: !!awake.src, same: !!awake.src && awake.a === ac, idle: awake.src ? Math.round(performance.now() - awake.at) : null, ms: AWAKE },
      offer: { shown: !offerEl.hidden, to: offerTo, days: S.st.days ? { ...S.st.days } : null },
      pdf: {
        has: pdf.has, on: pdf.on, busy: pdf.busy, page: pdf.page, pages: pdf.pages, spread: pdf.spread,
        canvas: pdf.canvas?.isConnected ? [pdf.canvas.width, pdf.canvas.height] : null,
      },
      wake: { held: !!wake && !wake.released, requests: wakeRequests },
      playback: playDebug(),
      t: { ...S.t },
    },
  };
};
