// Play page (play.html + play.js) — the spec's §8 checks, written by an independent tester (it
// computes its own expectations from the MusicXML and the drawing; it doesn't reuse the page's
// prep or naming code), at 8 sizes, plus bug hunts. Fails on any pageerror / console error.
//
//   1 part choice + views      2 nothing dropped (every page of every view: drawn ids = kept ids)
//   3 labels = pitch (badge text, fact = XML = SVG, the synth-pvg sidecar, display per level)
//   4 paging (keys, ‹ ›, no turn on a tap or a swipe, pedal after a select, spread)   5 anchor   6 size
//   7 peek   8 fading   9 wake lock   10 layout   11 PDF view
//   bugs: rotate mid-peek, a spread with an odd / even page count, a song switch while the next
//   page pre-renders, a one-page song, the open song deleted (resonate:remote, another tab),
//   reload on the last page, the hymn's Melody, a voice-only song, Split View / phone widths.
//
// usage: node play.cjs [WxH …] [--no-bugs] [--quick]
//   BASE (default http://localhost:8097/resonate/), PLAY_SCORES=<dir of the owner's converted
//   .musicxml> (seeded through library.js addSong in the page; skipped when unset), SHOTS=<dir>.
// Fixtures: node playfixture.mjs (tools/fixtures/play). Never copy licensed scores into the repo.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { pdfmini } = require("./pdfmini.cjs");

const BASE = process.env.BASE || "http://localhost:8097/resonate/";
const SCORES = process.env.PLAY_SCORES || "";
const SHOTS = process.env.SHOTS || "/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/playshots";
const FIX = path.join(__dirname, "fixtures/play");
fs.mkdirSync(SHOTS, { recursive: true });
const ALL = [[820, 1180], [1024, 1366], [744, 1133], [1180, 820], [1366, 1024], [507, 1180], [678, 1180], [390, 844]];
const args = process.argv.slice(2);
const pick = args.filter((a) => /^\d+x\d+$/.test(a)).map((a) => a.split("x").map(Number));
const SIZES = pick.length ? pick : ALL;
const QUICK = args.includes("--quick");
const BUGS = !args.includes("--no-bugs");
// The owner's scores' expected piano part (by file name).
const SHOT = new Set(["amazing-grace/both", "amazing-grace/melody", "synth-pvg/both", "pianoman/both", "songbird/both", "wichita/both", "longest/melody", "killing/rh", "synth-voice/both"]);
const PIANO_PART = { killing: "P2", wichita: "P2", pianoman: "P2", songbird: "P3", longest: "P1" };

let passes = 0, fails = 0;
const ok = (c, msg) => { if (c) passes++; else { fails++; console.log("FAIL", msg); } };
const info = (...a) => console.log("  ", ...a);
const sleep = (t) => new Promise((r) => setTimeout(r, t));

// ---------------------------------------------------------------------------------------------
// In-page helpers (an init script: before the page's own scripts, on every navigation)

function INIT() {
  // wake lock stub: counts requests
  window.__wake = { requests: 0, released: 0 };
  try {
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: async () => {
      window.__wake.requests++;
      return { released: false, type: "screen", addEventListener() {}, async release() { this.released = true; window.__wake.released++; } };
    } } });
  } catch {}
  // an audio session to watch (Chromium has none)
  try { if (!navigator.audioSession) Object.defineProperty(navigator, "audioSession", { configurable: true, value: { type: "auto" } }); } catch {}
  const C = (el, n) => { for (const c of el.children) if (c.nodeName === n) return c; return null; };
  const T = (el) => (el ? el.textContent.trim() : "");
  // The score as the tester reads it: every <note> → { part, mi, staff, voice, pitched, step, alter,
  // oct, k (document order among the pitched notes of its part/measure/staff), grace, lyric }.
  // Ids as the page gives them: the note's id, else "n<index among all notes>".
  window.__truth = (xml) => {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const out = {};
    let i = 0;
    const idOf = new Map();
    for (const n of doc.getElementsByTagName("note")) { idOf.set(n, n.getAttribute("id") || "n" + i); i++; }
    for (const part of doc.documentElement.children) {
      if (part.nodeName !== "part") continue;
      const pid = part.getAttribute("id");
      let mi = -1, div = 1;
      for (const m of part.children) {
        if (m.nodeName !== "measure") continue;
        mi++;
        const k = {};
        let pos = 0, last = 0; // (time in the bar, in divisions: onset = quarters from the bar's start)
        for (const n of m.children) {
          const dur = () => Number(T(C(n, "duration")) || 0);
          if (n.nodeName === "attributes") { const d = Number(T(C(n, "divisions"))); if (d > 0) div = d; continue; }
          if (n.nodeName === "backup") { pos -= dur(); continue; }
          if (n.nodeName === "forward") { pos += dur(); continue; }
          if (n.nodeName !== "note") continue;
          const chord = !!C(n, "chord"), onset = (chord ? last : pos) / div;
          if (!chord) { last = pos; if (!C(n, "grace")) pos += dur(); }
          const p = C(n, "pitch");
          const staff = Number(T(C(n, "staff")) || 1), voice = T(C(n, "voice")) || "1";
          const r = { part: pid, mi, staff, voice, pitched: !!p, grace: !!C(n, "grace"), lyric: !!C(n, "lyric"), onset };
          if (p) {
            r.step = T(C(p, "step")); r.alter = Number(T(C(p, "alter")) || 0); r.oct = Number(T(C(p, "octave")));
            r.k = k[staff] = (k[staff] ?? -1) + 1;
          }
          out[idOf.get(n)] = r;
        }
      }
    }
    return out;
  };
  // Ledger lines from the drawing (spec §4): the note's staff lines and the head's centre.
  // xmlStaff: in a one-part grand-staff view, the staff the XML puts the note on (a cross-staff
  // note sits in its voice's staff group but is drawn on that one).
  window.__ledgers = (g, xmlStaff = null) => {
    let staff = g.closest("g.staff");
    const head = g.querySelector(":scope > g.notehead");
    if (xmlStaff instanceof Element) staff = xmlStaff;
    else if (xmlStaff != null) {
      const sib = [...staff.parentNode.children].filter((c) => c.matches?.("g.staff"))[xmlStaff - 1];
      if (sib) staff = sib;
    }
    const ys = [];
    for (const c of staff.children) {
      if (c.nodeName.toLowerCase() !== "path") break;
      const m = /^M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*L\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/.exec(c.getAttribute("d") || "");
      if (!m || m[2] !== m[4]) break;
      ys.push(+m[2]);
    }
    if (ys.length < 5) return -1;
    const top = Math.min(...ys), bottom = Math.max(...ys), sp = (bottom - top) / 4;
    const b = head.getBBox(), cy = b.y + b.height / 2;
    return cy < top ? Math.floor((top - cy) / sp + 0.05) : cy > bottom ? Math.floor((cy - bottom) / sp + 0.05) : 0;
  };
  // Some's floor (spec change after the review): on a page where the rule names < 15% of the
  // heads, the first chord of each bar on each staff gets one name — its top note on a bar's first
  // staff, its bass note on the others; the first chord = the notes at the bar-staff's earliest
  // onset in the XML (grace notes aside), and a head another voice shares is named for both.
  // → Set of g.note. rule(g) → named by the rule; staffOf(g) → the drawn g.staff; T → __truth.
  // low (a Set of "part|staff", __lowOf): the staves read from the bottom — the left hand of a
  // grand staff, a bass-clef part but the tune's; the tune and the right hand from the top (v78:
  // not "the system's first staff", which in the full score is the voice's).
  window.__anchors = (pageEl, rule, staffOf, T, low = null) => {
    const heads = [...pageEl.querySelectorAll("g.note")].filter((g) => g.querySelector(":scope > g.notehead") && g.getAttribute("visibility") !== "hidden").map((g) => {
      const b = g.querySelector(":scope > g.notehead").getBBox();
      return { g, x0: b.x, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2, staff: staffOf(g), rule: rule(g), t: T && T[g.id] };
    }).filter((h) => h.w);
    const out = new Set();
    if (!heads.length || heads.filter((h) => h.rule).length >= 0.15 * heads.length) return out;
    const by = new Map();
    for (const h of heads) (by.get(h.staff) || by.set(h.staff, []).get(h.staff)).push(h);
    for (const [staff, list] of by) {
      const timed = list.filter((h) => h.t && !h.t.grace);
      let first;
      if (timed.length) { const t0 = Math.min(...timed.map((h) => h.t.onset)); first = timed.filter((h) => h.t.onset < t0 + 1e-6); }
      else { const x0 = Math.min(...list.map((h) => h.x0)); first = list.filter((h) => h.x0 <= x0 + 0.5 * h.w); }
      const home = low && list.find((h) => h.t && h.g.closest("g.staff") === staff);
      const top = home ? !low.has(home.t.part + "|" + home.t.staff) : staff === [...staff.parentNode.children].find((c) => c.matches?.("g.staff"));
      const pick = first.reduce((a, b) => ((top ? b.cy < a.cy : b.cy > a.cy) ? b : a));
      for (const h of list) if (h === pick || (Math.abs(h.cx - pick.cx) < 0.3 * Math.max(h.w, pick.w) && Math.abs(h.cy - pick.cy) < 0.15 * Math.max(h.h, pick.h))) out.add(h.g);
    }
    return out;
  };
  // The staves read from the bottom, from the XML: a part's 2nd+ staff (a grand staff's left hand),
  // a one-staff part whose clef is F unless it's the tune (the part with the most syllables).
  window.__lowOf = (xml) => {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const out = new Set();
    const parts = [...doc.documentElement.children].filter((c) => c.nodeName === "part");
    const words = (p) => p.querySelectorAll("note > lyric").length;
    const tune = parts.reduce((a, b) => (words(b) > words(a) ? b : a), parts[0]);
    for (const p of parts) {
      const id = p.getAttribute("id");
      const staves = Math.max(1, ...[...p.querySelectorAll("attributes > staves")].map((e) => Number(e.textContent)));
      if (staves > 1) { for (let s = 2; s <= staves; s++) out.add(id + "|" + s); continue; }
      const clef = p.querySelector("attributes > clef > sign");
      if (p !== tune && clef && clef.textContent.trim() === "F") out.add(id + "|1");
    }
    return out;
  };
  window.__key = (key, opts = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts }));
}

// ---------------------------------------------------------------------------------------------

const read = (f) => fs.readFileSync(f, "utf8");
function songList() {
  const out = [];
  for (const f of fs.readdirSync(FIX).filter((f) => /\.musicxml$/.test(f))) out.push({ name: f.replace(/\.musicxml$/, ""), xml: read(path.join(FIX, f)), source: "file" });
  // a one-page song (2 bars) and the PDF song (synth-pvg's music + a 3-page PDF)
  out.push({ name: "synth-one", xml: ONE_PAGE, source: "file" });
  out.push({ name: "synth-pdf", xml: read(path.join(FIX, "synth-pvg.musicxml")), source: "pdf", pdf: pdfmini(3, { heavy: 30000 }).toString("base64") }); // (slow pages: render races show)
  if (SCORES && fs.existsSync(SCORES)) {
    for (const f of fs.readdirSync(SCORES).filter((f) => /\.musicxml$/.test(f) && !/amazing/i.test(f))) out.push({ name: f.replace(/\.musicxml$/, ""), xml: read(path.join(SCORES, f)), source: "pdf", owner: true });
  }
  return out;
}
const ONE_PAGE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
<note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>half</type><staff>1</staff></note>
<note><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>half</type><staff>1</staff></note>
<backup><duration>4</duration></backup>
<note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>5</voice><type>whole</type><staff>2</staff></note></measure>
<measure number="2"><note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
<backup><duration>4</duration></backup>
<note><pitch><step>G</step><alter>-1</alter><octave>2</octave></pitch><duration>4</duration><voice>5</voice><type>whole</type><staff>2</staff><accidental>flat</accidental></note>
<barline location="right"><bar-style>light-heavy</bar-style></barline></measure></part></score-partwise>`;

async function newCtx(browser, w, h, errors) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  await ctx.addInitScript(INIT);
  ctx.on("page", (p) => watch(p, errors));
  return ctx;
}
// Any pageerror or console error fails; so do the page's own failure warnings.
function watch(page, errors) {
  page.on("pageerror", (e) => errors.push(`pageerror ${e.message}`));
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error") errors.push(`console.error ${t}`);
    else if (m.type() === "warning" && /^(song|music engine|loadData|pdf|piano|song list)\b/.test(t)) errors.push(`console.warn ${t}`);
  });
}
const D = (page) => page.evaluate(() => { const d = window.resonateDebug?.().play; if (!d) return null; const { facts, countAll, ...rest } = d; return rest; });
const ready = (page, song, view) => page.waitForFunction(([s, v]) => {
  const d = window.resonateDebug?.().play;
  return d && d.ready && (!s || d.song === s) && (!v || d.view === v);
}, [song, view], { timeout: 90000 });

async function seed(page, list) {
  return page.evaluate(async (list) => {
    const L = await import("./library.js?v=76");
    const ids = {};
    for (const s of list) {
      ids[s.name] = await L.addSong(s.name, s.xml, { source: s.source });
      if (s.pdf) await L.putPdf(ids[s.name], Uint8Array.from(atob(s.pdf), (c) => c.charCodeAt(0)).buffer, s.name + ".pdf");
    }
    return ids;
  }, list.map(({ owner, ...s }) => s));
}
// The song's MusicXML as the page reads it (catalog.js) → the tester's own reading of it.
const loadTruth = (page, id) => page.evaluate(async (id) => {
  const C = await import("./catalog.js?v=76");
  const s = await C.loadSong(id);
  (window.__T ||= {})[id] = window.__truth(s.xml);
  (window.__LOW ||= {})[id] = window.__lowOf(s.xml);
  return Object.keys(window.__T[id]).length;
}, id);

async function openSong(page, id) {
  const cur = await D(page);
  if (cur?.song === id && cur.ready) return;
  await page.focus("#song");
  await page.selectOption("#song", id);
  await ready(page, id);
}
async function openView(page, v) {
  const cur = await D(page);
  if (cur.view === v && cur.ready) return;
  await page.focus("#hands");
  await page.selectOption("#hands", v);
  await ready(page, null, v);
}
const pg = (page) => page.evaluate(() => window.resonateDebug().play.page);

// Check 10: the page doesn't scroll sideways, the bar's controls are inside the viewport, tall
// enough, and don't overlap each other.
async function layout(page, tag) {
  const r = await page.evaluate(() => {
    const coarse = matchMedia("(any-pointer: coarse)").matches;
    const out = { sw: document.scrollingElement.scrollWidth, iw: innerWidth, bad: [], overlap: [] };
    const els = [...document.querySelectorAll("#bar select, #bar button, #bar a, #version, #pg, #offer > span")]
      .filter((el) => el.getClientRects().length && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden");
    const rects = els.map((el) => [el, el.getBoundingClientRect()]);
    for (const [el, b] of rects) {
      const id = el.id || el.textContent.trim().slice(0, 10);
      if (b.left < -0.5 || b.right > innerWidth + 0.5 || b.top < -0.5 || b.bottom > innerHeight + 0.5) out.bad.push("outside:" + id);
      if ((el.tagName === "BUTTON" || el.tagName === "SELECT") && b.height < (coarse ? 43.5 : 39.5)) out.bad.push(`short:${id}:${b.height}`);
    }
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const [a, A] = rects[i], [b, B] = rects[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ix = Math.min(A.right, B.right) - Math.max(A.left, B.left), iy = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
      if (ix > 1 && iy > 1) out.overlap.push(`${a.id || a.textContent.trim().slice(0, 8)}×${b.id || b.textContent.trim().slice(0, 8)}`);
    }
    const bar = document.getElementById("bar").getBoundingClientRect(), st = document.getElementById("stage").getBoundingClientRect();
    out.bar = Math.round(bar.height);
    out.offer = !document.getElementById("offer").hidden;
    out.stage = [Math.round(st.width), Math.round(st.height)];
    out.stageFits = st.bottom <= innerHeight + 0.5 && st.top >= bar.bottom - 0.5;
    return out;
  });
  ok(r.sw <= r.iw, `${tag}: horizontal overflow ${r.sw} > ${r.iw}`);
  ok(!r.bad.length, `${tag}: bar controls ${r.bad.join(", ")}`);
  ok(!r.overlap.length, `${tag}: bar controls overlap ${r.overlap.join(", ")}`);
  ok(r.stageFits, `${tag}: the stage runs past the viewport`);
  // rows: one from 1100 px, two down to 480 (under 640 the chip may add one), three on a phone
  const maxBar = r.iw >= 1100 ? 62 : r.iw >= 640 ? 120 : r.iw >= 480 ? (r.offer ? 170 : 120) : r.offer ? 210 : 160;
  ok(r.bar <= maxBar, `${tag}: the bar is ${r.bar} px (≤ ${maxBar})`);
  return r;
}

// Checks 1–3 for the shown view: every page from the first to the last (turning with the keys),
// the drawn heads against the tester's reading of the XML, the page's facts and the SVG.
async function traverse(page, id, sidecar) {
  return page.evaluate(({ id, sidecar }) => {
    const T = window.__T[id];
    const play = window.resonateDebug().play;
    const facts = play.facts;
    const SYM = { "-2": "𝄫", "-1": "♭", 0: "", 1: "♯", 2: "𝄪" };
    const ACCID = { s: 1, f: -1, ss: 2, x: 2, ff: -2, n: 0 };
    const stage = document.getElementById("stage");
    const R = { errs: [], ids: [], measures: [], pages: 0, verse: 0, grp: 0, staves: new Set(), sys: [], verseN: new Set(), lv: 0, km: 0, heads: 0, side: 0, sideWant: 0, overlaps: 0, unisons: 0, ovl: [], crowd: 0, sylPairs: 0, clip: [], blank: [], perPage: [] };
    const err = (s) => { if (R.errs.length < 40) R.errs.push(s); };
    // sidecar: (part|mi|staff|k) → expectation
    const side = new Map();
    if (sidecar) for (const e of sidecar.notes) side.set(`${e.part}|${e.mi}|${e.staff}|${e.k}`, e);
    for (let i = 0; i < 400 && window.resonateDebug().play.page > 1; i++) window.__key("ArrowLeft");
    const seen = new Set();
    for (let guard = 0; guard < 400; guard++) {
      const d = window.resonateDebug().play;
      const st = stage.getBoundingClientRect();
      for (const p of stage.querySelectorAll(".page")) {
        const pn = Number(p.dataset.page);
        if (seen.has(pn)) continue;
        seen.add(pn);
        R.pages++;
        let n = 0;
        // what's drawn (staves, notes, badges, words) inside the stage: nothing clipped
        for (const s of p.querySelectorAll("g.staff, g.note, g.nn, g.verse, g.dir, g.dynam")) {
          const b = s.getBoundingClientRect();
          if (!b.width && !b.height) continue;
          if (b.top < st.top - 2 || b.bottom > st.bottom + 2 || b.left < st.left - 2 || b.right > st.right + 2) R.clip.push(`p${pn} ${s.getAttribute("class") || s.tagName}${s.id ? "#" + s.id : ""}: y ${Math.round(b.top - st.top)}..${Math.round(b.bottom - st.top)}/${Math.round(st.height)} x ${Math.round(b.left - st.left)}..${Math.round(b.right - st.left)}/${Math.round(st.width)}`);
        }
        const ms = p.querySelectorAll("g.measure");
        if (!ms.length) R.blank.push(pn);
        for (const m of ms) {
          const mm = /^m(\d+)$/.exec(m.id);
          if (mm) R.measures.push(Number(mm[1]));
          R.staves.add(m.querySelectorAll(":scope > g.staff").length);
        }
        R.verse += p.querySelectorAll("g.verse").length;
        // words: neighbours on one line ≥ 4 px apart
        const syl = [...p.querySelectorAll("g.verse g.syl text")].map((t) => t.getBoundingClientRect()).filter((r) => r.width);
        syl.sort((a, b) => Math.round(a.top) - Math.round(b.top) || a.left - b.left);
        for (let i = 1; i < syl.length; i++) if (Math.abs(syl[i].top - syl[i - 1].top) < 3) { R.sylPairs++; if (syl[i].left - syl[i - 1].right < 4) R.crowd++; }
        R.grp += p.querySelectorAll("g.grpSym").length;
        const pills = [];
        // (a one-part grand staff: the XML's staff is where a note is drawn)
        const grand = d.keep && d.keep.parts.length === 1 && d.keep.staff == null && d.keep.kind !== "melody";
        // (the full score: staff n = the staves of the parts above + the note's staff; staves a
        // system leaves out don't shift the numbers)
        const score = d.keep && d.keep.kind === "score";
        const offs = {};
        if (score) { let n0 = 0; for (const pid of d.keep.parts) { offs[pid] = n0; n0 += Math.max(1, ...Object.values(T).filter((t) => t.part === pid).map((t) => t.staff)); } }
        const xsOf = (g) => (score && T[g.id] ? g.closest("g.measure")?.querySelector(`:scope > g.staff[data-n="${offs[T[g.id].part] + T[g.id].staff}"]`) || null : grand && T[g.id] ? T[g.id].staff : null);
        const staffOf = (g) => { const h = g.closest("g.staff"), xs = xsOf(g); if (xs instanceof Element) return xs; return (xs != null && [...h.parentNode.children].filter((c) => c.matches?.("g.staff"))[xs - 1]) || h; };
        const anchors = window.__anchors(p, (g) => { const f = facts[g.id]; return !!f && (window.__ledgers(g, xsOf(g)) >= 2 || f.acc === "printed" || f.acc === "carried" || f.nat); }, staffOf, T, window.__LOW?.[id] || null);
        for (const sy of p.querySelectorAll("g.system")) R.sys.push([...(sy.querySelector("g.measure")?.querySelectorAll(":scope > g.staff") || [])].map((x) => x.getAttribute("data-n")).join(""));
        for (const vv of p.querySelectorAll("g.verse")) { const n = vv.closest("g.staff")?.getAttribute("data-n"); if (n) R.verseN.add(n); }
        for (const g of p.querySelectorAll("g.note")) {
          const head = g.querySelector(":scope > g.notehead");
          if (!head) continue;
          // (the full score's place-keepers: invisible grace notes, no pitch, no name)
          if (g.getAttribute("visibility") === "hidden") { if (!/^keep-/.test(g.id) || g.querySelector(".nn")) err(`${g.id}: a hidden note ${g.querySelector(".nn") ? "named" : "not a place-keeper"}`); continue; }
          n++;
          R.ids.push(g.id);
          const t = T[g.id], f = facts[g.id];
          if (!t || !t.pitched) { err(`drawn ${g.id} not a pitched note of the score`); continue; }
          if (!f) { err(`${g.id}: no fact`); continue; }
          if (f.step !== t.step || f.alter !== t.alter || f.oct !== t.oct || f.part !== t.part || f.staff !== t.staff || f.mi !== t.mi) err(`${g.id}: fact ${f.step}${f.alter}/${f.oct} ${f.part} s${f.staff} m${f.mi} ≠ XML ${t.step}${t.alter}/${t.oct} ${t.part} s${t.staff} m${t.mi}`);
          // the SVG's own pitch
          if (g.getAttribute("data-pname") !== t.step.toLowerCase()) err(`${g.id}: svg pname ${g.getAttribute("data-pname")} ≠ ${t.step}`);
          const ac = g.querySelector("g.accid");
          const code = ac ? ac.getAttribute("data-accid") || ac.getAttribute("data-accid.ges") : null;
          if ((ACCID[code] ?? 0) !== t.alter) err(`${g.id}: svg accid ${code} ≠ alter ${t.alter}`);
          const so = Number(g.getAttribute("data-oct.ges") ?? g.getAttribute("data-oct"));
          if (so !== t.oct) err(`${g.id}: svg oct ${so} ≠ ${t.oct}`);
          // the badge
          const nn = g.querySelector(":scope > g.nn");
          if (!nn) { err(`${g.id}: no badge`); continue; }
          R.heads++;
          const want = t.step.toUpperCase() + (f.nat ? "♮" : SYM[t.alter]);
          const text = nn.querySelector("text")?.textContent;
          if (text !== want) err(`${g.id}: badge "${text}" ≠ "${want}"`);
          if (/\d/.test(text || "")) err(`${g.id}: an octave number on the page`);
          const ks = !!nn.querySelector("tspan.ks"), wantKs = f.acc === "key" && t.alter !== 0 && !f.nat;
          if (ks !== wantKs) err(`${g.id}: ks ${ks} ≠ ${wantKs}`);
          const href = head.querySelector("use")?.getAttribute("xlink:href") || head.querySelector("use")?.getAttribute("href") || "";
          const hollow = /#E0A[23]/i.test(href);
          if (nn.classList.contains("nb-h") !== hollow || nn.classList.contains("nb-f") === hollow) err(`${g.id}: ${href} badge ${nn.getAttribute("class")}`);
          const led = window.__ledgers(g, xsOf(g));
          const some = led >= 2 || f.acc === "printed" || f.acc === "carried" || f.nat || anchors.has(g);
          const lv = nn.classList.contains("lv"), km = !!g.querySelector(":scope > .km");
          if (lv !== some) err(`${g.id} ${want}: Some ${lv} ≠ ${some} (ledgers ${led}, ${f.acc}${f.nat ? " nat" : ""})`);
          // (a mark with no clear side is left out, said on its badge)
          const wantKm = !some && f.acc === "key" && t.alter !== 0 && nn.getAttribute("data-km") !== "blocked";
          if (km !== wantKm) err(`${g.id} ${want}: mark ${km} ≠ ${wantKm}`);
          if (nn.getAttribute("data-km") === "blocked") R.kmBlocked = (R.kmBlocked || 0) + 1;
          if (lv) R.lv++;
          if (km) R.km++;
          const e = sidecar && side.get(`${t.part}|${t.mi}|${t.staff}|${t.k}`);
          if (e) {
            R.side++;
            if (text !== e.label) err(`sidecar m${t.mi} s${t.staff} #${t.k}: "${text}" ≠ "${e.label}"`);
            if (lv !== (e.some || anchors.has(g))) err(`sidecar m${t.mi} s${t.staff} #${t.k} ${e.label}: Some ${lv} ≠ ${e.some}`);
            if (km !== (e.km && !anchors.has(g) && nn.getAttribute("data-km") !== "blocked")) err(`sidecar m${t.mi} s${t.staff} #${t.k} ${e.label}: mark ${km} ≠ ${e.km}`);
            if (led !== e.ledgers) err(`sidecar m${t.mi} s${t.staff} #${t.k} ${e.p}: ledgers ${led} ≠ ${e.ledgers}`);
          }
          const rb = nn.querySelector("rect").getBoundingClientRect();
          pills.push([rb, g]);
        }
        // pills of different chords overlapping by > 40% of the smaller one
        pills.sort((a, b) => a[0].left - b[0].left);
        for (let i = 0; i < pills.length; i++) for (let j = i + 1; j < pills.length && pills[j][0].left < pills[i][0].right; j++) {
          const A = pills[i][0], B = pills[j][0];
          const ix = Math.min(A.right, B.right) - Math.max(A.left, B.left), iy = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
          if (ix > 0 && iy > 0 && ix * iy > 0.4 * Math.min(A.width * A.height, B.width * B.height)) {
            const fa = facts[pills[i][1].id], fb = facts[pills[j][1].id];
            if (fa && fb && fa.midi === fb.midi) R.unisons++; // (two voices on one note: the same name twice)
            else { R.overlaps++; if (R.ovl.length < 4) R.ovl.push(`p${pn} ${pills[i][1].id}/${pills[j][1].id}`); }
          }
        }
        // display per level (the stage's attribute; the button is checked elsewhere)
        const lvl0 = stage.dataset.names;
        for (const lvl of ["all", "some", "off"]) {
          stage.dataset.names = lvl;
          for (const nn of p.querySelectorAll(".nn")) {
            const vis = getComputedStyle(nn).display !== "none";
            const want = lvl === "all" || (lvl === "some" && nn.classList.contains("lv"));
            if (vis !== want) { err(`p${pn} ${lvl}: badge display ${vis} ≠ ${want}`); break; }
          }
          for (const k of p.querySelectorAll(".km")) {
            const vis = getComputedStyle(k).display !== "none";
            if (vis !== (lvl === "some")) { err(`p${pn} ${lvl}: mark display ${vis}`); break; }
          }
        }
        stage.dataset.names = lvl0;
        R.perPage.push(n);
      }
      const before = d.page;
      window.__key("ArrowRight");
      if (window.resonateDebug().play.page === before) break;
    }
    R.staves = [...R.staves];
    R.verseN = [...R.verseN];
    R.per = {};
    for (const t of Object.values(T)) R.per[t.part] = Math.max(R.per[t.part] || 1, t.staff);
    R.debug = { pages: play.pages, pitched: play.counts.pitched, spread: play.spread, sp: play.sp, keep: { ...play.keep, ids: undefined }, keepIds: play.keep.ids.length };
    // the kept set, from the tester's reading and the plan
    const k = play.keep;
    const want = Object.entries(T).filter(([, t]) => t.pitched && k.parts.includes(t.part) && (k.staff == null || t.staff === k.staff) && (k.voice == null || t.voice === k.voice)).map(([i]) => i);
    const got = new Set(R.ids);
    R.dup = R.ids.length - got.size;
    R.want = want.length;
    R.missing = want.filter((i) => !got.has(i)).slice(0, 10);
    const wantSet = new Set(want);
    R.extra = [...got].filter((i) => !wantSet.has(i)).slice(0, 10);
    R.parts = [...new Set(R.ids.map((i) => T[i]?.part))];
    R.staffs = [...new Set(R.ids.map((i) => T[i]?.staff))];
    R.voices = [...new Set(R.ids.map((i) => T[i]?.voice))];
    R.all = play.countAll();
    for (let i = 0; i < 400 && window.resonateDebug().play.page > 1; i++) window.__key("ArrowLeft");
    return R;
  }, { id, sidecar });
}

// ---------------------------------------------------------------------------------------------

async function runSize(browser, w, h, list) {
  const tag0 = `${w}x${h}`;
  console.log(`== ${tag0}`);
  const errors = [];
  const ctx = await newCtx(browser, w, h, errors);
  const page = await ctx.newPage();
  await page.goto(BASE + "play.html");
  await ready(page, "amazing-grace");
  let d = await D(page);
  // the default (v79): a tablet at the printed page's density, 90 staff spaces across the stage
  // (Playwright's screen = the viewport); a phone 9.5 or what fits — no size chosen
  const wantBase = w >= 700 && h >= 700 ? Math.max(5, d.W / 90) : Math.min(9.5, d.cap);
  ok(d.size === null && d.sizeAuto && Math.abs(d.base - wantBase) < 0.02, `${tag0}: default size ${d.size}, base ${d.base} ≠ ${wantBase.toFixed(2)}`);
  ok(d.names === "all", `${tag0}: first level ${d.names}`);
  const ids = await seed(page, list);
  await page.reload();
  await ready(page, "amazing-grace");
  const side = JSON.parse(read(path.join(FIX, "synth-pvg.json")));

  // ---- 1–3, 10: every song, every view, every page
  const meas = {}; // song|view → measure ids present
  const SONGS = [["amazing-grace", "amazing-grace"], ...list.filter((s) => !["synth-pdf"].includes(s.name)).map((s) => [s.name, ids[s.name]])];
  for (const [name, id] of QUICK ? SONGS.slice(0, 3) : SONGS) {
    await openSong(page, id);
    await loadTruth(page, id);
    d = await D(page);
    const views = d.views;
    const handsShown = await page.evaluate(() => { const s = document.getElementById("hands"); return !s.hidden && getComputedStyle(s).display !== "none"; });
    const labels = await page.evaluate(() => [...document.querySelectorAll("#hands option")].map((o) => o.value + "=" + o.textContent));
    for (const v of views) {
      await openView(page, v);
      const R = await traverse(page, id, name === "synth-pvg" ? side : null);
      const tag = `${tag0} ${name}/${v}`;
      meas[`${name}|${v}`] = R.measures;
      ok(!R.errs.length, `${tag}: ${R.errs.slice(0, 6).join(" | ")}${R.errs.length > 6 ? ` (+${R.errs.length - 6})` : ""}`);
      ok(R.ids.length === R.debug.pitched && R.all.rendered === R.all.pitched && R.dup === 0, `${tag}: drawn ${R.ids.length} (dup ${R.dup}), countAll ${R.all.rendered}, pitched ${R.debug.pitched}`);
      ok(!R.missing.length && !R.extra.length && R.want === R.ids.length, `${tag}: kept ${R.want}, drawn ${R.ids.length}; missing ${R.missing} extra ${R.extra}`);
      ok(R.pages === R.debug.pages, `${tag}: visited ${R.pages} of ${R.debug.pages} pages`);
      ok(!R.blank.length, `${tag}: blank pages ${R.blank}`);
      ok(!R.clip.length, `${tag}: systems outside the stage: ${R.clip.slice(0, 4).join(" ")}`);
      ok(!R.overlaps, `${tag}: ${R.overlaps} badges of different notes overlap > 40%: ${R.ovl.join(" ")}`);
      if (R.unisons) info(`${tag}: ${R.unisons} unisons (two voices, one head: the same name twice)`);
      // key marks with no clear side (left out): few
      if (R.kmBlocked) ok(R.kmBlocked <= Math.max(3, 0.2 * (R.km + R.kmBlocked)), `${tag}: ${R.kmBlocked} of ${R.km + R.kmBlocked} key marks left out`);
      // (words that touch: checked at an iPad's sizes; a phone's narrow bars stay cramped)
      if (R.sylPairs && R.debug.sp >= 12) ok(R.crowd <= Math.max(4, 0.03 * R.sylPairs), `${tag}: crowded words ${R.crowd} of ${R.sylPairs}`);
      else if (R.crowd) info(`${tag}: ${R.crowd} of ${R.sylPairs} words close (sp ${R.debug.sp.toFixed(1)})`);
      if (name === "synth-pvg" && v !== "melody") ok(R.side === R.ids.length, `${tag}: sidecar checked ${R.side}/${R.ids.length}`);
      if (name === "synth-pvg" && v === "melody") ok(R.side === side.notes.filter((e) => e.part === "P1").length, `${tag}: sidecar (voice) checked ${R.side}`);
      // check 1: the part and the view
      const k = R.debug.keep;
      if (v === "score") {
        // the full score: the first system shows every staff; later ones may leave out a staff that
        // rests through them (condensed) — never one staff of a grand staff; words only under the
        // tune's staff
        const per = R.per; // part → its staff count (the tester's reading)
        let n0 = 0; const grandN = [], tuneN = [];
        for (const pid of k.parts) {
          const st = per[pid] || 1;
          if (st > 1) grandN.push(Array.from({ length: st }, (_, i) => String(n0 + i + 1)));
          if (pid === k.words.part) tuneN.push(String(n0 + (k.words.staff ?? 1)));
          n0 += st;
        }
        ok(R.sys[0] && R.sys[0].length === n0, `${tag}: first system ${R.sys[0]} (${n0} staves)`);
        ok(R.sys.every((sy) => grandN.every((g) => g.every((x) => sy.includes(x)) || g.every((x) => !sy.includes(x)))), `${tag}: a grand staff split: ${R.sys.join(" ")}`);
        ok(k.condense ? true : R.sys.every((sy) => sy.length === n0), `${tag}: not condensed, yet ${R.sys.join(" ")}`);
        ok(R.verse > 0 && R.verseN.every((n) => tuneN.includes(n)), `${tag}: words under staves ${R.verseN} (tune ${tuneN})`);
      } else {
        const staves = v === "both" ? (k.kind === "piano" ? 2 : k.kind === "hymn" ? 2 : k.parts.length) : 1;
        ok(R.staves.length === 1 && R.staves[0] === staves, `${tag}: staves per system ${R.staves} ≠ ${staves}`);
        const wantLyrics = v === "melody" || (name === "synth-voice");
        ok(wantLyrics ? R.verse > 0 : R.verse === 0, `${tag}: lyrics ${R.verse}`);
      }
      if (name === "amazing-grace") {
        if (v === "both") ok(R.parts.sort().join() === "P1,P2" && R.grp >= R.pages && k.brace, `${tag}: hymn braced (${R.parts}, grpSym ${R.grp})`);
        if (v === "rh") ok(R.parts.join() === "P1", `${tag}: RH = P1 (${R.parts})`);
        if (v === "lh") ok(R.parts.join() === "P2", `${tag}: LH = P2 (${R.parts})`);
        if (v === "melody") ok(R.parts.join() === "P1" && R.voices.join() === "1", `${tag}: Melody = P1 voice 1 (${R.parts} ${R.voices})`);
      }
      if (name === "synth-pvg") {
        if (v === "both") ok(R.parts.join() === "P2", `${tag}: Both = P2 (${R.parts})`);
        if (v === "rh") ok(R.parts.join() === "P2" && R.staffs.join() === "1", `${tag}: RH staff 1 (${R.staffs})`);
        if (v === "lh") ok(R.parts.join() === "P2" && R.staffs.join() === "2", `${tag}: LH staff 2 (${R.staffs})`);
        if (v === "melody") ok(R.parts.join() === "P1", `${tag}: Melody P1 (${R.parts})`);
      }
      if (name === "synth-longest" && v === "melody") ok(R.staffs.join() === "1" && R.voices.join() === "1", `${tag}: Melody staff 1 voice 1 (${R.staffs} / ${R.voices})`);
      if (PIANO_PART[name] && v === "both") ok(k.parts.join() === PIANO_PART[name], `${tag}: piano part ${k.parts} ≠ ${PIANO_PART[name]}`);
      if (name === "longest" && v === "melody") ok(k.parts.join() === "P1" && k.staff === 1 && k.voice === "1", `${tag}: Melody P1 staff ${k.staff} voice ${k.voice}`);
      await layout(page, tag);
      if (SHOT.has(`${name}/${v}`)) {
        await page.screenshot({ path: path.join(SHOTS, `test-${tag0}-${name}-${v}.png`) });
      }
    }
    const want = { "amazing-grace": "score,both,rh,lh,melody", "synth-pvg": "score,both,rh,lh,melody", "synth-longest": "score,both,rh,lh,melody", "synth-voice": "both", "synth-one": "both,rh,lh",
      "score-pvg": "score,both,rh,lh,melody", "score-duet": "score,both,rh,lh,melody", "score-guitar": "score,both,melody", "score-tunein": "score,both,rh,lh,melody",
      killing: "score,both,rh,lh,melody", wichita: "score,both,rh,lh,melody", pianoman: "score,both,rh,lh,melody", songbird: "score,both,rh,lh,melody", longest: "score,both,rh,lh,melody" }[name];
    if (want) ok(views.join() === want, `${tag0} ${name}: views ${views} ≠ ${want}`);
    ok(handsShown === views.length > 1, `${tag0} ${name}: hands menu shown ${handsShown} with ${views.length} views`);
    const L = { score: "Full score", both: "Both hands", rh: "Right hand", lh: "Left hand", melody: "Melody" };
    ok(labels.every((l) => { const [v, t] = l.split("="); return L[v] === t; }), `${tag0} ${name}: hands labels ${labels}`);
    await openView(page, "both");
  }

  // ---- 4 paging (synth-pvg, Both)
  const pvg = ids["synth-pvg"];
  await openSong(page, pvg);
  await openView(page, "both");
  d = await D(page);
  const last = d.spread ? (d.pages % 2 ? d.pages : d.pages - 1) : d.pages, step = d.spread ? 2 : 1;
  info(`${tag0} synth-pvg: ${d.pages} pages, sp ${d.sp.toFixed(2)}, spread ${d.spread}, bar/stage ${d.W}x${d.H}`);
  {
    const key = async (k, want) => { await page.keyboard.press(k); await sleep(30); const p = await pg(page); ok(p === want, `${tag0}: ${k} → page ${p} ≠ ${want}`); };
    await key("ArrowLeft", 1); await key("PageUp", 1); await key("ArrowUp", 1);
    let p = 1;
    for (const k of ["ArrowRight", "PageDown", "Space", "Enter", "ArrowDown"]) { if (p + step <= last) { p += step; await key(k, p); } }
    for (const k of ["ArrowLeft", "PageUp", "ArrowUp", "Backspace"]) { if (p - step >= 1) { p -= step; await key(k, p); } }
    for (let i = 0; i < d.pages + 2; i++) await page.keyboard.press("ArrowRight");
    ok((await pg(page)) === last, `${tag0}: stops at the end (${await pg(page)} ≠ ${last})`);
    const pt = (await page.textContent("#pg")).trim();
    ok(pt === (d.spread && last < d.pages ? `${last}–${last + 1} / ${d.pages}` : `${last} / ${d.pages}`), `${tag0}: pager "${pt}" at the end`);
    for (let i = 0; i < d.pages + 2; i++) await page.keyboard.press("ArrowLeft");
    ok((await pg(page)) === 1, `${tag0}: back to 1, no wrap`);
    // taps at 0.9 / 0.1 / 0.5 W, ≥ 40 px from every head, and swipes: no turn (v79 — a press on the
    // music sounds a note or picks notes; ‹ › and the keys turn)
    const spot = (fx) => page.evaluate((fx) => {
      const st = document.getElementById("stage").getBoundingClientRect();
      const heads = [...document.querySelectorAll("#stage g.note > g.notehead")].map((h) => { const b = h.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
      const x = st.left + st.width * fx;
      for (let y = st.top + 20; y < st.bottom - 20; y += 5) if (heads.every(([hx, hy]) => Math.hypot(hx - x, hy - y) >= 40)) return { x, y };
      return null;
    }, fx);
    const tap = async (fx, want, what) => {
      const s = await spot(fx);
      if (!s) return ok(false, `${tag0}: no off-note spot at ${fx} W`);
      await page.touchscreen.tap(s.x, s.y);
      await sleep(60);
      const p2 = await pg(page);
      ok(p2 === want, `${tag0}: ${what} tap at ${fx} W → ${p2} ≠ ${want}`);
    };
    await tap(0.9, 1, "right"); await tap(0.1, 1, "left"); await tap(0.5, 1, "middle"); await tap(0.1, 1, "left at the start");
    // swipe −120 px (CDP touch)
    const cdp = await ctx.newCDPSession(page);
    const swipe = async (x0, y0, dx, dt = 16) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
      for (let i = 1; i <= 6; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + (dx * i) / 6, y: y0 + i }] }); await sleep(dt); }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await sleep(60);
    };
    await swipe(w * 0.6, h * 0.5, -120);
    ok((await pg(page)) === 1, `${tag0}: swipe −120: no turn (${await pg(page)})`);
    await swipe(w * 0.4, h * 0.5, 120);
    ok((await pg(page)) === 1, `${tag0}: swipe +120: no turn (${await pg(page)})`);
    // ‹ › (at every width, ≥ 44 px on a touch screen)
    const bs = await page.evaluate(() => ["prev", "next"].map((id) => { const b = document.getElementById(id).getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; }));
    ok(bs.every(([bw, bh]) => bw >= 44 && bh >= 44), `${tag0}: ‹ › ${JSON.stringify(bs)} ≥ 44 px`);
    if (d.pages > 1) {
      await page.click("#next"); ok((await pg(page)) === 1 + step, `${tag0}: › → ${await pg(page)}`);
      await page.click("#prev"); ok((await pg(page)) === 1, `${tag0}: ‹ → ${await pg(page)}`);
    }
    ok(await page.isDisabled("#prev"), `${tag0}: ‹ disabled on page 1`);
    ok(await page.evaluate(() => !document.activeElement || !document.activeElement.matches("button, select")), `${tag0}: ‹ › leave no focus`);
    // a pedal key after a choice in a select (names via the hands menu and back)
    await openView(page, "rh");
    await page.keyboard.press("ArrowRight");
    await sleep(30);
    ok((await pg(page)) === Math.min(1 + step, (await D(page)).pages), `${tag0}: pedal after the hands menu → ${await pg(page)}`);
    await openView(page, "both");
    await page.keyboard.press("PageDown");
    await sleep(30);
    const pAfter = await pg(page);
    ok(pAfter > 1, `${tag0}: pedal after the hands menu (back to Both) → ${pAfter}`);
    await page.focus("#song");
    await page.selectOption("#song", "amazing-grace");
    await ready(page, "amazing-grace");
    await page.keyboard.press("ArrowRight");
    await sleep(30);
    ok((await pg(page)) === 1 + step || (await D(page)).pages === 1, `${tag0}: pedal after the song menu → ${await pg(page)}`);
    await openSong(page, pvg);
    // the spread (v79: each page ≥ 110 staff spaces — zoomed well out): − / + steps from the
    // default, as far out as − goes, 4 under, 3 over
    for (const want of [-8, -4, 3]) {
      for (let i = 0; i < 20; i++) {
        d = await D(page);
        if (d.step === want) break;
        const btn = d.step > want ? "#smaller" : "#bigger";
        if (await page.isDisabled(btn)) break;
        await page.click(btn);
        await page.waitForFunction(() => window.resonateDebug().play.ready);
      }
      d = await D(page);
      if (d.step !== want) info(`${tag0}: step ${want} not reachable (step ${d.step}, sp ${d.sp.toFixed(2)})`);
      const spread = d.W > d.H && d.W / 2 / d.sp >= 110 && d.pages > 1;
      ok(d.spread === spread, `${tag0} step ${d.step} (${d.sp.toFixed(2)}): spread ${d.spread} ≠ ${spread} (${d.W}x${d.H})`);
      const nPages = await page.evaluate(() => document.querySelectorAll("#stage .page").length);
      ok(nPages === (spread && d.page < d.pages ? 2 : 1), `${tag0} step ${d.step}: ${nPages} .page`);
      if (spread) {
        ok(d.page % 2 === 1, `${tag0}: spread left page ${d.page} is odd`);
        const p0 = d.page;
        await page.keyboard.press("ArrowRight");
        d = await D(page);
        ok(d.page === Math.min(p0 + 2, d.pages % 2 ? d.pages : d.pages - 1) && d.page % 2 === 1, `${tag0}: spread turns by 2 (${p0} → ${d.page})`);
        await page.screenshot({ path: path.join(SHOTS, `test-${tag0}-spread.png`) });
        await page.keyboard.press("ArrowLeft");
      }
    }
    // back to the default size for the rest
    await page.evaluate(() => localStorage.removeItem("resonate.play.zoom"));
  }

  // ---- 5 anchor: page 3, rotate and back, − / +, a hands switch, a reload
  {
    await page.reload();
    await ready(page, pvg);
    d = await D(page);
    for (let i = 0; i < 10 && (await pg(page)) > 1; i++) await page.keyboard.press("ArrowLeft");
    for (let i = 0; i < 2; i++) await page.keyboard.press("ArrowRight");
    d = await D(page);
    const at = d.at;
    const onScreen = async (what, view = "both") => {
      const present = meas[`synth-pvg|${view}`] || [];
      const m = present.find((x) => x >= at) ?? at;
      const r = await page.evaluate((m) => {
        const g = document.querySelector(`#stage .page g#m${m}`);
        if (!g) return null;
        const b = g.getBoundingClientRect(), s = document.getElementById("stage").getBoundingClientRect();
        return b.left >= s.left - 2 && b.right <= s.right + 2 && b.top >= s.top - 2 && b.bottom <= s.bottom + 2;
      }, m);
      ok(r === true, `${tag0} anchor ${what}: g#m${m} (at ${at}) ${r === null ? "not on the shown pages" : "off screen"}`);
    };
    await onScreen("page " + d.page);
    const resized = async (W, H) => {
      const before = await D(page);
      await page.setViewportSize({ width: W, height: H });
      await page.waitForFunction(([w0, h0]) => { const d = window.resonateDebug().play; return d.ready && (d.W !== w0 || d.H !== h0); }, [before.W, before.H], { timeout: 5000 }).catch(() => {});
      await sleep(250);
    };
    await resized(h, w); await onScreen(`rotated ${h}x${w}`);
    await resized(w, h); await onScreen(`rotated back ${w}x${h}`);
    ok((await D(page)).at === at, `${tag0}: rotations don't move the place (${(await D(page)).at} ≠ ${at})`);
    if (!(await page.isDisabled("#smaller"))) { await page.click("#smaller"); await page.waitForFunction(() => window.resonateDebug().play.ready); await onScreen("−"); }
    if (!(await page.isDisabled("#bigger"))) { await page.click("#bigger"); await page.waitForFunction(() => window.resonateDebug().play.ready); await onScreen("+"); }
    await openView(page, "lh"); await onScreen("LH", "lh");
    await openView(page, "melody"); await onScreen("Melody", "melody");
    await openView(page, "score"); await onScreen("Full score", "score");
    await openView(page, "both"); await onScreen("Both again");
    await sleep(1200);
    await page.reload();
    await ready(page, pvg);
    await onScreen("after a reload");
    ok((await D(page)).at === at, `${tag0}: reload keeps at ${at}`);
    await page.screenshot({ path: path.join(SHOTS, `test-${tag0}-anchor.png`) });
  }

  // ---- 6 size: + up to the cap, − down; kept in resonate.play.zoom
  {
    d = await D(page);
    const sps = [d.sp];
    for (let i = 0; i < 12 && !(await page.isDisabled("#bigger")); i++) {
      await page.click("#bigger");
      await page.waitForFunction(() => window.resonateDebug().play.ready);
      sps.push((await D(page)).sp);
    }
    d = await D(page);
    const cap = d.cap;
    ok(sps.every((s, i) => i === 0 || s > sps[i - 1] + 1e-6), `${tag0}: + raises sp ${sps.map((s) => s.toFixed(2))}`);
    const stepKey = (n) => (n ? (n > 0 ? "+" : "") + n : null);
    ok(d.step === 8 || Math.abs(d.sp - cap) < 0.01, `${tag0}: + stops at the cap (sp ${d.sp.toFixed(2)}, cap ${cap.toFixed(2)}, step ${d.step})`);
    ok((await page.evaluate(() => localStorage.getItem("resonate.play.zoom"))) === stepKey(d.step), `${tag0}: size kept (step ${d.step})`);
    const sp1 = d.sp;
    await page.click("#smaller");
    await page.waitForFunction(() => window.resonateDebug().play.ready);
    d = await D(page);
    ok(d.sp < sp1 - 1e-6, `${tag0}: − lowers sp (${sp1.toFixed(2)} → ${d.sp.toFixed(2)})`);
    ok((await page.evaluate(() => localStorage.getItem("resonate.play.zoom"))) === stepKey(d.step), `${tag0}: size kept after − (step ${d.step})`);
    await page.reload();
    await ready(page, pvg);
    ok((await D(page)).step === d.step, `${tag0}: size after a reload: step ${(await D(page)).step}`);
    await page.evaluate(() => localStorage.removeItem("resonate.play.zoom"));
    await page.reload();
    await ready(page, pvg);
  }

  // ---- 7 peek on the designed chord (E♭4 G4 B♭4), names Off
  {
    const cdp = await ctx.newCDPSession(page);
    await loadTruth(page, pvg);
    for (let i = 0; i < 10 && (await pg(page)) > 1; i++) await page.keyboard.press("ArrowLeft");
    // a tap first (iOS-like: the first touch end unlocks the sound) — a turn and back
    for (let i = 0; i < 3 && (await D(page)).names !== "off"; i++) await page.click("#names");
    ok((await D(page)).names === "off", `${tag0}: names Off`);
    const chord = await page.evaluate(() => {
      const T = window.__T[window.resonateDebug().play.song];
      const ids = Object.entries(T).filter(([, t]) => t.part === "P2" && t.mi === 0 && t.staff === 1 && t.pitched && t.k <= 2).map(([i]) => i);
      const b = document.querySelector(`#stage g.note#${ids[0]} > g.notehead`).getBoundingClientRect();
      return { ids, x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }).catch(() => null);
    if (!chord) ok(false, `${tag0}: the designed chord isn't on page 1`);
    else {
      const log0 = (await D(page)).peekLog.length;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: chord.x, y: chord.y }] });
      await page.waitForFunction(() => { const p = window.resonateDebug().play.peek; return p && p.sounding.length; }, null, { timeout: 4000 }).catch(() => {});
      await sleep(350);
      d = await D(page);
      const pk = d.peek;
      const kb = d.keys; // (v80: the keyboard docked under the music — on by default on a tablet, off on a phone)
      ok(pk && pk.ids.slice().sort().join() === chord.ids.slice().sort().join(), `${tag0} peek ids ${pk?.ids} ≠ ${chord.ids}`);
      ok(pk?.names === "E♭4 G4 B♭4", `${tag0} peek names "${pk?.names}"`);
      ok(pk && JSON.stringify(pk.lit.map((l) => [l.midi, l.hand]).sort()) === (kb.shown ? JSON.stringify([[63, "rh"], [67, "rh"], [70, "rh"]]) : "[]"), `${tag0} peek lit ${JSON.stringify(pk?.lit)} (keyboard ${kb.shown})`);
      ok(kb.shown === (w >= 700 && h >= 700), `${tag0} the keyboard ${kb.shown ? "on" : "off"} by default (${kb.dflt})`);
      ok(pk && pk.sounding.slice().sort().join() === "63,67,70", `${tag0} peek sounding ${pk?.sounding}`);
      const vis = await page.evaluate((ids) => {
        const v = (el) => el && getComputedStyle(el).display !== "none" && el.getClientRects().length > 0;
        const st = document.getElementById("stage");
        const shown = [...st.querySelectorAll(".nn")].filter(v);
        const fill = getComputedStyle(document.querySelector(`#stage g.note#${ids[0]} > g.notehead use`)).fill;
        const bub = document.getElementById("bubble"), strip = document.getElementById("strip");
        const sb = strip.getBoundingClientRect(), stb = st.getBoundingClientRect();
        return {
          badges: shown.map((n) => n.parentNode.id).sort(), fill, bubble: v(bub) ? bub.textContent : null,
          strip: !document.getElementById("dock").hidden, dot: !!strip.querySelector("circle.mc"),
          stripIn: sb.left >= stb.left - 1 && sb.right <= stb.right + 1 && sb.top >= stb.bottom - 1 && sb.bottom <= innerHeight + 1,
          pe: [getComputedStyle(bub).pointerEvents, getComputedStyle(strip).pointerEvents],
          bubIn: (() => { const b = bub.getBoundingClientRect(); return b.left >= stb.left - 1 && b.right <= stb.right + 1 && b.top >= stb.top - 1 && b.bottom <= stb.bottom + 1; })(),
          bubOverStrip: (() => { const b = bub.getBoundingClientRect(); return !(b.bottom <= sb.top || b.top >= sb.bottom); })(),
        };
      }, chord.ids);
      ok(vis.badges.join() === chord.ids.slice().sort().join(), `${tag0} peek: badges shown at Off ${vis.badges} ≠ ${chord.ids}`);
      ok(vis.fill === "rgb(216, 107, 0)", `${tag0} peek: head colour ${vis.fill}`);
      ok(vis.bubble === "E♭4 G4 B♭4" && vis.bubIn && !vis.bubOverStrip, `${tag0} peek: bubble "${vis.bubble}" inside ${vis.bubIn}, over the strip ${vis.bubOverStrip}`);
      if (kb.shown) ok(vis.strip && vis.dot && vis.stripIn, `${tag0} peek: keyboard on ${vis.strip}, middle-C dot ${vis.dot}, under the music ${vis.stripIn}`);
      else ok(!vis.strip, `${tag0} peek: no keyboard (off on a phone)`);
      ok(vis.pe.join() === "none,auto", `${tag0} peek: the bubble takes no touches, the keyboard does — v86: its keys can be played (${vis.pe})`);
      ok(d.audio?.session === "playback", `${tag0} peek: session ${d.audio?.session}`);
      await page.screenshot({ path: path.join(SHOTS, `test-${tag0}-peek.png`) });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await sleep(200);
      ok((await pg(page)) === 1, `${tag0} peek: the lift doesn't turn`);
      await sleep(2400);
      const gone = await page.evaluate(() => ({
        peek: window.resonateDebug().play.peek, cls: document.querySelectorAll("#stage .peek").length,
        bubble: document.getElementById("bubble").classList.contains("on"), strip: document.querySelectorAll("#strip rect.lit").length,
        shown: [...document.querySelectorAll("#stage .nn")].filter((n) => getComputedStyle(n).display !== "none").length,
        dock: !document.getElementById("dock").hidden,
      }));
      ok(!gone.peek && !gone.cls && !gone.bubble && !gone.strip && !gone.shown, `${tag0} peek: hidden 2.5 s after the lift ${JSON.stringify(gone)}`);
      ok(gone.dock === kb.shown, `${tag0} peek: the keyboard stays (${gone.dock})`);
      const log = (await D(page)).peekLog.slice(log0);
      ok(log.length === 1 && log[0].how === "hold", `${tag0} peek: sounded while held ${JSON.stringify(log)}`);
      // a drag that starts on a note: the sound cut, no turn (v79)
      const h2 = await page.evaluate(() => { const b = document.querySelector("#stage g.note > g.notehead").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
      const n0 = (await D(page)).peekLog.length;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: h2.x, y: h2.y }] });
      await sleep(60);
      for (let i = 1; i <= 6; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: h2.x - 22 * i, y: h2.y + 1 }] }); await sleep(12); }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await sleep(150);
      d = await D(page);
      ok(d.page === 1, `${tag0} a drag from a note doesn't turn (${d.page})`);
      ok(!d.peek, `${tag0} drag: no peek left`);
      const l2 = d.peekLog.slice(n0);
      ok(l2.every((x) => x.cut), `${tag0} drag: sound cut ${JSON.stringify(l2)}`);
      await page.keyboard.press("ArrowLeft");
    }
  }

  // ---- 8 fading: seed days, the chip, [Some], ✕, reload, a new song's level
  {
    const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
    const seedDays = (names, n, ask) => page.evaluate(([id, names, n, ask, today]) => {
      const all = JSON.parse(localStorage.getItem("resonate.play") || "{}");
      all[id] = { ...(all[id] || {}), names, days: { n, ask, d: today, ms: 0, act: false, done: false } };
      localStorage.setItem("resonate.play", JSON.stringify(all));
    }, [pvg, names, n, ask, today]);
    const stored = () => page.evaluate((id) => JSON.parse(localStorage.getItem("resonate.play") || "{}")[id], pvg);
    // (from another page: play.html's pagehide writes its own record back)
    const away = async (f) => { await page.goto(BASE + "tools.html"); await f(); await page.goto(BASE + "play.html"); await ready(page, pvg); };
    await away(() => seedDays("all", 3, 3));
    let o = (await D(page)).offer;
    const chip = await page.evaluate(() => document.getElementById("offer").textContent);
    ok(o.shown && o.to === "some" && /Fewer names\?/.test(chip) && /Some/.test(chip), `${tag0} offer: shown "${chip}" ${JSON.stringify(o)}`);
    await layout(page, `${tag0} with the offer chip`);
    await page.screenshot({ path: path.join(SHOTS, `test-${tag0}-offer.png`) });
    await page.click("#offer-yes");
    d = await D(page);
    let s = await stored();
    ok(d.names === "some" && !d.offer.shown && s.names === "some" && s.days.n === 0, `${tag0} offer [Some]: ${d.names}, shown ${d.offer.shown}, stored ${JSON.stringify(s.days)}`);
    await away(() => seedDays("some", 3, 3));
    o = (await D(page)).offer;
    ok(o.shown && o.to === "off", `${tag0} offer at Some → [Off] ${JSON.stringify(o)}`);
    await page.click("#offer-no");
    s = await stored();
    ok(s.days.ask === s.days.n + 3 && !(await D(page)).offer.shown, `${tag0} offer ✕: ask ${s.days.ask}, n ${s.days.n}`);
    await page.reload();
    await ready(page, pvg);
    d = await D(page);
    ok(!d.offer.shown && d.names === "some", `${tag0} after ✕ and a reload: no chip, level ${d.names}`);
    // a song opened for the first time starts at the level chosen last
    await away(() => page.evaluate(() => { const all = JSON.parse(localStorage.getItem("resonate.play") || "{}"); delete all["amazing-grace"]; localStorage.setItem("resonate.play", JSON.stringify(all)); }));
    await openSong(page, "amazing-grace");
    ok((await D(page)).names === "some", `${tag0}: a new song at the last level (${(await D(page)).names})`);
    await openSong(page, pvg);
  }

  // ---- 9 wake lock
  {
    const n0 = await page.evaluate(() => window.__wake.requests);
    ok(n0 >= 1, `${tag0}: wake lock requested (${n0})`);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await sleep(50);
    const n1 = await page.evaluate(() => window.__wake.requests);
    ok(n1 > n0, `${tag0}: wake lock again on visibilitychange (${n0} → ${n1})`);
  }

  // ---- 11 PDF view
  {
    const id = ids["synth-pdf"];
    await openSong(page, id);
    await page.waitForFunction(() => window.resonateDebug().play.pdf.has, null, { timeout: 5000 }).catch(() => {});
    ok(await page.isVisible("#pdf"), `${tag0}: 📄 shown for a PDF song`);
    await page.keyboard.press("ArrowRight");
    d = await D(page);
    const p0 = d.page, at0 = d.at;
    await page.click("#pdf");
    await page.waitForFunction(() => { const p = window.resonateDebug().play.pdf; return p.on && p.canvas && !p.busy; }, null, { timeout: 15000 }).catch(() => {});
    await sleep(400);
    let r = await page.evaluate(() => {
      const c = document.getElementById("pdfview"), st = document.getElementById("stage").getBoundingClientRect();
      if (!c) return null;
      const b = c.getBoundingClientRect();
      const ctx = c.getContext("2d"), px = ctx.getImageData(0, 0, c.width, c.height).data;
      let ink = 0;
      for (let i = 0; i < px.length; i += 4 * 7) if (px[i] < 128) ink++;
      return { w: c.width, h: c.height, inside: b.left >= st.left - 1 && b.right <= st.right + 1 && b.top >= st.top - 1 && b.bottom <= st.bottom + 1, ink, pg: document.getElementById("pg").textContent, disabled: ["names", "smaller", "bigger", "hands"].map((i) => document.getElementById(i).disabled) };
    });
    d = await D(page);
    ok(r && r.w > 0 && r.h > 0 && r.inside && r.ink > 0, `${tag0} PDF: canvas ${JSON.stringify(r)}`);
    ok(r && r.disabled.every(Boolean), `${tag0} PDF: names/size/hands disabled ${r?.disabled}`);
    await page.screenshot({ path: path.join(SHOTS, `test-${tag0}-pdf.png`) });
    const pp = d.pdf.page;
    await page.keyboard.press("ArrowRight");
    await sleep(300);
    d = await D(page);
    ok(d.pdf.page === pp + (d.pdf.spread ? 2 : 1) || (d.pdf.spread && d.pdf.pages <= 2), `${tag0} PDF: ArrowRight → page ${d.pdf.page} (spread ${d.pdf.spread})`);
    ok(d.page === p0, `${tag0} PDF: the sheet stays at page ${p0} (${d.page})`);
    // quick presses (a pedal tapped twice): the last page asked for is the one drawn
    const hash = () => page.evaluate(() => {
      const c = document.getElementById("pdfview");
      const px = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let h = 0;
      for (let i = 0; i < px.length; i += 4 * 3) h = (h * 31 + px[i] + 7 * px[i + 1]) % 1000000007;
      return [c.width, c.height, h, window.resonateDebug().play.pdf.page];
    });
    for (const k of ["ArrowRight", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowLeft", "ArrowRight"]) { await page.evaluate((k) => window.__key(k), k); await sleep(25 + Math.random() * 40); }
    await page.waitForFunction(() => window.resonateDebug().play.t.pdf != null, null, { timeout: 5000 }).catch(() => {});
    await sleep(1500);
    const h1 = await hash();
    await page.click("#pdf");
    await sleep(150);
    await page.click("#pdf");
    await page.waitForFunction(() => { const p = window.resonateDebug().play.pdf; return p.on && p.canvas && !p.busy; }, null, { timeout: 15000 }).catch(() => {});
    await sleep(1500);
    const h2 = await hash();
    ok(h1.join() === h2.join(), `${tag0} PDF: quick turns end on the page asked for (${h1} vs a fresh draw ${h2})`);
    await page.click("#pdf");
    await sleep(200);
    d = await D(page);
    r = await page.evaluate(() => ({ canvas: !!document.getElementById("pdfview"), shown: [...document.querySelectorAll("#stage .page")].every((p) => getComputedStyle(p).visibility === "visible") }));
    ok(!d.pdf.on && !r.canvas && r.shown && d.page === p0 && d.at === at0, `${tag0} PDF off: back at page ${d.page} (${p0}), canvas gone ${!r.canvas}, sheet shown ${r.shown}`);
  }

  ok(!errors.length, `${tag0}: errors: ${errors.slice(0, 6).join(" | ")}`);
  if (errors.length) console.log(errors.join("\n"));
  await ctx.close();
}

// ---------------------------------------------------------------------------------------------
// Bug hunts beyond the spec's checks.

async function bugs(browser, list) {
  console.log("== bugs");
  const errors = [];
  const ctx = await newCtx(browser, 820, 1180, errors);
  const page = await ctx.newPage();
  await page.goto(BASE + "play.html");
  await ready(page, "amazing-grace");
  const ids = await seed(page, list);
  await page.reload();
  await ready(page, "amazing-grace");
  const cdp = await ctx.newCDPSession(page);
  const pvg = ids["synth-pvg"];
  let d;

  // rotate mid-peek: the peek is cleared, its sound cut, the lift neither turns nor errs
  {
    await openSong(page, pvg);
    await loadTruth(page, pvg);
    await page.touchscreen.tap(410, 300).catch(() => {}); // (a first tap: the sound unlocked)
    for (let i = 0; i < 4 && (await pg(page)) > 1; i++) await page.keyboard.press("ArrowLeft");
    const h = await page.evaluate(() => { const b = document.querySelector("#stage g.note > g.notehead").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: h.x, y: h.y }] });
    await page.waitForFunction(() => window.resonateDebug().play.peek?.sounding.length, null, { timeout: 4000 }).catch(() => {});
    ok((await D(page)).peek, "rotate mid-peek: a peek is up");
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.waitForFunction(() => window.resonateDebug().play.W > 1000, null, { timeout: 4000 }).catch(() => {});
    await sleep(300);
    d = await D(page);
    const st = await page.evaluate(() => ({ cls: document.querySelectorAll("#stage .peek").length, bubble: document.getElementById("bubble").classList.contains("on"), strip: document.querySelectorAll("#strip rect.lit").length }));
    ok(!d.peek && !st.cls && !st.bubble && !st.strip, `rotate mid-peek: cleared ${JSON.stringify(st)} peek ${JSON.stringify(d.peek)}`);
    const p0 = d.page;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(300);
    d = await D(page);
    ok(d.page === p0 && !d.peek, `rotate mid-peek: the lift after it doesn't turn (${p0} → ${d.page})`);
    const sounding = await page.evaluate(() => { const l = window.resonateDebug().play.peekLog; return l[l.length - 1]; });
    info("rotate mid-peek log", JSON.stringify(sounding));
    await page.setViewportSize({ width: 820, height: 1180 });
    await sleep(500);
  }

  // spreads with an odd and an even page count: the end, the pager, a reload on the last page
  {
    await page.setViewportSize({ width: 1366, height: 1024 });
    await page.evaluate(() => localStorage.setItem("resonate.play.zoom", "-8")); // (as far out as − goes: 5 px, a spread)
    await page.reload();
    await ready(page);
    let odd = 0;
    for (const [name, id] of [["amazing-grace", "amazing-grace"], ...list.filter((x) => x.name !== "synth-pdf").map((x) => [x.name, ids[x.name]])]) {
      await openSong(page, id);
      d = await D(page);
      if (!d.spread) { info(`${name}: no spread at 1366x1024 step −8 (${d.sp}, ${d.pages} pages)`); continue; }
      for (let i = 0; i < d.pages + 2; i++) await page.keyboard.press("ArrowRight");
      d = await D(page);
      const last = d.pages % 2 ? d.pages : d.pages - 1;
      const pager = (await page.textContent("#pg")).trim();
      const nP = await page.evaluate(() => document.querySelectorAll("#stage .page").length);
      ok(d.page === last && pager === (d.pages % 2 ? `${d.pages} / ${d.pages}` : `${d.pages - 1}–${d.pages} / ${d.pages}`) && nP === (d.pages % 2 ? 1 : 2), `${name} spread (${d.pages} pages): end at ${d.page}, pager "${pager}", ${nP} .page`);
      ok(await page.isDisabled("#next"), `${name} spread: › disabled at the end`);
      const lp = await page.evaluate(() => { const p = document.querySelector("#stage .page"); const b = p.getBoundingClientRect(); return { left: Math.round(b.left), w: Math.round(b.width), page: Number(p.dataset.page) }; });
      info(`${name} spread end: ${d.pages} pages, left page ${lp.page} at x ${lp.left} w ${lp.w}`);
      if (d.pages > 1) ok(lp.left <= 1, `${name} spread: the last left page stays in the left half (x ${lp.left})`);
      await page.screenshot({ path: path.join(SHOTS, `test-bugs-spread-end-${name}.png`) });
      // reload on the last page
      await sleep(1100);
      await page.reload();
      await ready(page, id);
      d = await D(page);
      ok(d.page === last, `${name} spread: reload on the last page → ${d.page} (want ${last})`);
      if (d.pages % 2 && d.pages > 1) odd++;
    }
    if (!odd) info("spread: no song with an odd page count > 1 at 1366x1024 / step −8");
    await page.evaluate(() => localStorage.removeItem("resonate.play.zoom"));
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.reload();
    await ready(page);
  }

  // reload on the last page (single pages), every view
  {
    await openSong(page, pvg);
    for (const v of ["both", "rh", "melody"]) {
      await openView(page, v);
      d = await D(page);
      for (let i = 0; i < d.pages + 1; i++) await page.keyboard.press("ArrowRight");
      d = await D(page);
      ok(d.page === d.pages, `${v}: at the last page ${d.page}/${d.pages}`);
      await sleep(1100);
      await page.reload();
      await ready(page, pvg, v);
      const d2 = await D(page);
      ok(d2.page === d.pages && d2.view === v, `${v}: reload on the last page → ${d2.page}/${d2.pages} (${d2.view})`);
    }
    await openView(page, "both");
  }

  // a song switch while the next page pre-renders (the idle prefetch), then a fast A→B→A
  {
    await openSong(page, ids["pianoman"] || pvg);
    await page.evaluate(() => { window.__key("ArrowRight"); });
    await page.focus("#song");
    await page.selectOption("#song", pvg); // right after a turn: the prefetch is pending
    await ready(page, pvg);
    await loadTruth(page, pvg);
    const all = await page.evaluate(() => window.resonateDebug().play.countAll());
    ok(all.rendered === all.pitched, `switch during prefetch: synth-pvg drawn ${all.rendered} = ${all.pitched}`);
    const heads = await page.evaluate(() => { const T = window.__T[window.resonateDebug().play.song]; return [...document.querySelectorAll("#stage g.note")].filter((g) => g.querySelector(":scope > g.notehead")).every((g) => T[g.id]?.pitched); });
    ok(heads, "switch during prefetch: the shown page belongs to the new song");
    // fast A → B → A
    const B = ids["synth-longest"];
    await page.evaluate(([a, b]) => {
      const s = document.getElementById("song");
      s.value = b; s.dispatchEvent(new Event("change", { bubbles: true }));
      s.value = a; s.dispatchEvent(new Event("change", { bubbles: true }));
    }, ["amazing-grace", B]);
    await ready(page, "amazing-grace");
    await sleep(800);
    d = await D(page);
    const a2 = await page.evaluate(() => window.resonateDebug().play.countAll());
    ok(d.song === "amazing-grace" && d.title === "Amazing Grace" && a2.rendered === a2.pitched && a2.pitched === 162, `fast switch: ${d.song} ${d.title} ${a2.rendered}/${a2.pitched}`);
    // a hands switch racing a song switch
    await openSong(page, pvg);
    await page.evaluate((id) => {
      const h = document.getElementById("hands"); h.value = "lh"; h.dispatchEvent(new Event("change", { bubbles: true }));
      const s = document.getElementById("song"); s.value = id; s.dispatchEvent(new Event("change", { bubbles: true }));
    }, "amazing-grace");
    await ready(page, "amazing-grace");
    await sleep(800);
    d = await D(page);
    const a3 = await page.evaluate(() => window.resonateDebug().play.countAll());
    ok(d.song === "amazing-grace" && a3.rendered === a3.pitched && d.views.includes(d.view), `hands switch racing a song switch: ${d.song} view ${d.view}, ${a3.rendered}/${a3.pitched}`);
    const sAG = await page.evaluate(() => JSON.parse(localStorage.getItem("resonate.play"))["amazing-grace"]);
    info("AG state after the race", JSON.stringify(sAG));
  }

  // a one-page song
  {
    await openSong(page, ids["synth-one"]);
    d = await D(page);
    ok(d.pages === 1 && (await page.textContent("#pg")).trim() === "1 / 1", `one page: ${d.pages}, "${await page.textContent("#pg")}"`);
    ok(await page.isDisabled("#prev") && await page.isDisabled("#next"), "one page: ‹ › disabled");
    for (const k of ["ArrowRight", "ArrowLeft", "Space"]) await page.keyboard.press(k);
    await page.touchscreen.tap(800, 1100);
    ok((await pg(page)) === 1, "one page: keys and taps do nothing");
    const all = await page.evaluate(() => window.resonateDebug().play.countAll());
    ok(all.rendered === 5 && all.pitched === 5, `one page: 5 notes (${all.rendered}/${all.pitched})`);
    await page.screenshot({ path: path.join(SHOTS, "test-bugs-one-page.png") });
  }

  // the open song deleted: by the sync (resonate:remote), and in another tab
  {
    const gone = ids["synth-voice"];
    await openSong(page, gone);
    await page.evaluate(async (id) => {
      const L = await import("./library.js?v=76");
      await L.removeSong(id, { quiet: true });
      window.dispatchEvent(new CustomEvent("resonate:remote", { detail: { songs: true } }));
    }, gone);
    await ready(page, "amazing-grace");
    d = await D(page);
    const opts = await page.evaluate(() => [...document.querySelectorAll("#song option")].map((o) => o.value));
    ok(d.song === "amazing-grace" && !opts.includes(gone), `remote delete: fell back to ${d.song}; still listed ${opts.includes(gone)}`);
    // another tab deletes the song this tab shows: this tab keeps working; reopening it falls back
    const other = ids["synth-longest"];
    await openSong(page, other);
    // (removed as the owner does it: Sing's ✕ — the song's Play record goes with it)
    const tab2 = await ctx.newPage();
    tab2.on("dialog", (dlg) => dlg.accept());
    await tab2.goto(BASE + "sing.html");
    await tab2.waitForSelector("#remove-song:not([hidden])", { timeout: 30000 });
    await tab2.waitForFunction((id) => document.getElementById("song-select")?.value === id || [...document.querySelectorAll("select")].some((s) => s.value === id), other, { timeout: 30000 });
    await tab2.click("#remove-song");
    await tab2.waitForFunction((id) => !(id in JSON.parse(localStorage.getItem("resonate.play") || "{}")), other, { timeout: 10000 }).catch(() => {});
    await tab2.close();
    await page.keyboard.press("ArrowRight");
    await openView(page, "rh");
    d = await D(page);
    ok(d.ready && d.view === "rh", "deleted in another tab: the shown song still switches hands");
    await page.reload();
    await ready(page);
    d = await D(page);
    ok(d.song === "amazing-grace", `deleted in another tab, then a reload: ${d.song}`);
    const st = await page.evaluate((id) => ({ play: id in JSON.parse(localStorage.getItem("resonate.play") || "{}"), opts: [...document.querySelectorAll("#song option")].map((o) => o.value).includes(id) }), other);
    ok(!st.play && !st.opts, `deleted song (Sing's ✕): gone from resonate.play (${st.play}) and the list (${st.opts})`);
  }

  // the hymn's Melody view: voice 1 of P1 with its words, no alto
  {
    await openSong(page, "amazing-grace");
    await loadTruth(page, "amazing-grace");
    await openView(page, "melody");
    const r = await page.evaluate(() => {
      const T = window.__T["amazing-grace"];
      const ids = [...document.querySelectorAll("#stage g.note")].filter((g) => g.querySelector(":scope > g.notehead")).map((g) => g.id);
      return { n: ids.length, voices: [...new Set(ids.map((i) => T[i].voice))], verses: document.querySelectorAll("#stage g.verse").length, layers: Math.max(...[...document.querySelectorAll("#stage g.staff")].map((s) => s.querySelectorAll(":scope > g.layer").length)) };
    });
    ok(r.voices.join() === "1" && r.verses > 0 && r.layers === 1, `hymn Melody: voices ${r.voices}, verses ${r.verses}, layers ${r.layers}`);
    await page.screenshot({ path: path.join(SHOTS, "test-bugs-hymn-melody.png") });
    // its peek is the right hand, one key
    const h = await page.evaluate(() => { const b = document.querySelector("#stage g.note > g.notehead").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: h.x, y: h.y }] });
    await sleep(300);
    d = await D(page);
    ok(d.peek && d.peek.lit.length === 1 && d.peek.lit[0].hand === "rh", `hymn Melody peek: ${JSON.stringify(d.peek?.lit)}`);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await openView(page, "lh");
    const h2 = await page.evaluate(() => { const b = document.querySelector("#stage g.note > g.notehead").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: h2.x, y: h2.y }] });
    await sleep(300);
    d = await D(page);
    ok(d.peek && d.peek.lit.every((l) => l.hand === "lh"), `hymn LH peek: ${JSON.stringify(d.peek?.lit)}`);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await openView(page, "both");
  }

  // a voice-only song (re-added: it was deleted above)
  {
    const L = list.find((s) => s.name === "synth-voice");
    const id = (await seed(page, [L]))["synth-voice"];
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("resonate:remote", { detail: { songs: true } })));
    await sleep(300);
    await openSong(page, id);
    await loadTruth(page, id);
    d = await D(page);
    const r = await page.evaluate(() => ({ hands: document.getElementById("hands").hidden, verses: document.querySelectorAll("#stage g.verse").length, firstM: document.querySelector("#stage g.measure")?.id }));
    ok(r.hands && d.views.join() === "both" && r.verses > 0, `voice-only: hands hidden ${r.hands}, views ${d.views}, words ${r.verses}`);
    await page.screenshot({ path: path.join(SHOTS, "test-bugs-voice-only.png") });
    const h = await page.evaluate(() => { const b = document.querySelector("#stage g.note > g.notehead").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: h.x, y: h.y }] });
    await sleep(300);
    d = await D(page);
    ok(d.peek && d.peek.lit.length === 1, `voice-only peek: ${JSON.stringify(d.peek?.lit)} "${d.peek?.names}"`);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  // narrow widths: Split View 320 / 375 / 438 (iPad 1/3), phone landscape, iPad mini
  for (const [w, h] of [[320, 568], [375, 667], [438, 1133], [568, 320], [844, 390], [981, 1366], [1133, 744], [810, 1080], [834, 1194], [1194, 834], [1112, 834], [1100, 800], [562, 744], [593, 834], [639, 1024], [640, 1024], [813, 834]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.reload();
    await ready(page);
    await openSong(page, pvg);
    const r = await layout(page, `${w}x${h}`);
    d = await D(page);
    const all = await page.evaluate(() => window.resonateDebug().play.countAll());
    ok(all.rendered === all.pitched, `${w}x${h}: drawn ${all.rendered} = ${all.pitched}`);
    const clip = await page.evaluate(() => {
      const st = document.getElementById("stage").getBoundingClientRect(), out = [];
      for (const s of document.querySelectorAll("#stage g.staff, #stage g.note, #stage g.nn, #stage g.verse")) { const b = s.getBoundingClientRect(); if (b.width && (b.bottom > st.bottom + 2 || b.top < st.top - 2 || b.right > st.right + 2 || b.left < st.left - 2)) out.push([s.getAttribute("class"), Math.round(b.top - st.top), Math.round(b.bottom - st.top), Math.round(st.height)]); }
      return out;
    });
    ok(!clip.length, `${w}x${h}: systems clipped ${JSON.stringify(clip)}`);
    info(`${w}x${h}: bar ${r.bar}px, stage ${r.stage}, ${d.pages} pages, sp ${d.sp.toFixed(2)}, spread ${d.spread}`);
    await page.screenshot({ path: path.join(SHOTS, `test-bugs-${w}x${h}.png`) });
  }
  // the fewer-names chip in the one-row bar (1100–1366) and iPad portrait / mini
  {
    const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
    for (const [w, h] of [[1100, 800], [1133, 744], [1180, 820], [1194, 834], [1366, 1024], [820, 1180], [744, 1133], [507, 1180]]) {
      await page.goto(BASE + "tools.html");
      await page.evaluate(([id, today]) => {
        const all = JSON.parse(localStorage.getItem("resonate.play") || "{}");
        all[id] = { ...(all[id] || {}), names: "all", days: { n: 3, ask: 3, d: today, ms: 0, act: false, done: false } };
        localStorage.setItem("resonate.play", JSON.stringify(all));
        localStorage.setItem("resonate.sing.song", id);
      }, [pvg, today]);
      await page.setViewportSize({ width: w, height: h });
      await page.goto(BASE + "play.html");
      await ready(page, pvg);
      ok((await D(page)).offer.shown, `${w}x${h}: the chip is up`);
      const r = await layout(page, `${w}x${h} with the chip`);
      info(`${w}x${h} with the chip: bar ${r.bar}px`);
      if (w === 1133 || w === 744) await page.screenshot({ path: path.join(SHOTS, `test-bugs-chip-${w}x${h}.png`) });
    }
  }
  await page.setViewportSize({ width: 820, height: 1180 });

  // PDF view while rotating; a PDF song whose sheet is open at page 2 → PDF → reload
  {
    await page.reload();
    await ready(page);
    await openSong(page, ids["synth-pdf"]);
    await page.waitForFunction(() => window.resonateDebug().play.pdf.has, null, { timeout: 5000 }).catch(() => {});
    await page.click("#pdf");
    await page.waitForFunction(() => { const p = window.resonateDebug().play.pdf; return p.on && p.canvas && !p.busy; }, null, { timeout: 15000 }).catch(() => {});
    await page.setViewportSize({ width: 1180, height: 820 });
    await sleep(900);
    const r = await page.evaluate(() => { const c = document.getElementById("pdfview"), st = document.getElementById("stage").getBoundingClientRect(); const b = c.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), sw: Math.round(st.width), sh: Math.round(st.height), inside: b.right <= st.right + 1 && b.bottom <= st.bottom + 1 }; });
    ok(r.inside && r.h > 0.9 * r.sh - 2, `PDF after a rotate fits the stage ${JSON.stringify(r)}`);
    await page.screenshot({ path: path.join(SHOTS, "test-bugs-pdf-rotated.png") });
    await page.setViewportSize({ width: 820, height: 1180 });
    await sleep(600);
    await page.click("#pdf");
    await sleep(200);
    d = await D(page);
    ok(!d.pdf.on && d.ready, "PDF off after rotations");
  }

  ok(!errors.length, `bugs: errors: ${errors.slice(0, 8).join(" | ")}`);
  if (errors.length) console.log(errors.join("\n"));
  await ctx.close();
}

(async () => {
  const t0 = Date.now();
  const browser = await chromium.launch();
  const list = songList();
  console.log(`songs: ${list.map((s) => s.name).join(", ")}${SCORES ? "" : " (PLAY_SCORES unset: the owner's scores skipped)"}`);
  try {
    for (const [w, h] of SIZES) await runSize(browser, w, h, list);
    if (BUGS) await bugs(browser, list);
  } catch (err) {
    ok(false, "crashed: " + (err.stack || err));
  }
  await browser.close();
  console.log(`${passes} passed, ${fails} failed (${Math.round((Date.now() - t0) / 1000)} s)`);
  process.exit(fails ? 1 : 0);
})();
