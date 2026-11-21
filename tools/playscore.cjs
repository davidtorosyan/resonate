// Play page: the Full score view (v78) — the tune's staff with its words over the piano, as
// piano/vocal music is printed. Chromium, plus a WebKitGTK check when WebKitWebDriver is up.
//
//   A  prep + Verovio (the site's playprep.js / playnames.js in a page): which songs offer it (a
//      voice-only song doesn't; a hymn, voice + piano, the tune inside the piano, a guitar part
//      that plays do; a tiny spurious part is left out); words only under the tune's staff; the
//      top part's endings and marks, drawn once — also over systems the voice rests through;
//      condensing (the voice out of a piano intro's systems, never one hand of a grand staff);
//      the Some floor's picks (the tune's and the right hand's top note, the left hand's bass
//      note — in the full score and in the LH view)
//   B  play.html: the menu (Full score first; Both stays the default; the choice kept per song),
//      systems per page at the iPad sizes with no size chosen (v79: the printed page's density;
//      in landscape two a page down to 0.9 of the portrait density, else one) and after − / +, the
//      score's own size pref, the place kept across views / rotation / − / + / reload, the voice's
//      strip colour (RH / LH unchanged), the PDF view over it
//   C  WebKitGTK (Safari stand-in): load, Full score, names, a peek on a vocal note
//   D  timings: Full score vs Both on the owner's scores (info)
//   E  the review fixes, prep + Verovio (fixtures/playscore from playscorefixture2.mjs): barlines
//      and repeats from the parts below the top, marks once / headings where printed, a transposing
//      part through the MEI pass, a part missing from the part-list, singers' words on two staves
//      and in two parts, a choir's bracket, syllables split between the tune and its chord
//   F  the review fixes in play.html: spreads after − / +, nothing past the stage (Piano Man), the
//      375-px fallback checked, a page size seen before laid out once, endings once with a
//      transposing part, the place with a part missing from the part-list, a second singer's
//      colour, The Longest Time's hyphens
//
// usage: node playscore.cjs   (BASE=http://localhost:8097/resonate/, PLAY_SCORES=<dir of the
//   owner's converted .musicxml — never copied into the repo>, ONLY=A,B,C,D,E,F, SHOTS=<dir>)
// Fixtures: node playscorefixture.mjs (score-*.musicxml) + playfixture.mjs (synth-*.musicxml) +
//   playscorefixture2.mjs (fixtures/playscore/*.musicxml).
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { pdfmini } = require("./pdfmini.cjs");
const BASE = process.env.BASE || "http://localhost:8097/resonate/";
const SCRATCH = "/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad";
const SCORES = process.env.PLAY_SCORES ?? path.join(SCRATCH, "play/scores");
const FIX = path.join(__dirname, "fixtures/play");
const SHOTS = process.env.SHOTS || path.join(SCRATCH, "playshots");
fs.mkdirSync(SHOTS, { recursive: true });
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const run = (s) => !ONLY || ONLY.has(s);
let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) passes++; else { fails++; console.log("FAIL", msg); } };
const info = (...a) => console.log("  ", ...a);
const sleep = (t) => new Promise((r) => setTimeout(r, t));
const read = (f) => fs.readFileSync(f, "utf8");
const OWNER = SCORES && fs.existsSync(SCORES) ? fs.readdirSync(SCORES).filter((f) => f.endsWith(".musicxml") && !/amazing/i.test(f)).map((f) => f.replace(/\.musicxml$/, "")) : [];
// iPad stages: 11" Air and mini, portrait and landscape
const IPADS = { "air-p": [820, 1180], "air-l": [1180, 820], "mini-p": [744, 1133], "mini-l": [1133, 744] };

// ---------------------------------------------------------------------------------------------
// A: prep + Verovio in a page of the site

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fdfcf8}#stage .page svg{display:block}</style></head>
<body><main id="stage" data-names="all"><div class="page" id="pg"></div></main><script type="module">
window.boot = (async () => {
  const V = "/resonate/vendor/verovio-6.4.0/";
  const [{ default: createVerovioModule }, { VerovioToolkit }] = await Promise.all([import(V + "verovio-module.mjs"), import(V + "verovio.mjs")]);
  window.tk = new VerovioToolkit(await createVerovioModule());
  window.prep = await import("/resonate/playprep.js?v=78");
  window.names = await import("/resonate/playnames.js?v=78");
  window.fix = await import("/resonate/omr/fixscore.js?v=78");
  return true;
})();
</script></body></html>`;

async function partA(browser) {
  console.log("== A prep + Verovio");
  const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const origin = new URL(BASE).origin;
  await page.route(origin + "/__score.html", (r) => r.fulfill({ contentType: "text/html", body: PAGE }));
  await page.route(origin + "/__fx/*", (r) => r.fulfill({ contentType: "application/xml", body: read(path.join(FIX, path.basename(new URL(r.request().url()).pathname))) }));
  await page.route(origin + "/__scores/*", (r) => r.fulfill({ contentType: "application/xml", body: read(path.join(SCORES, decodeURIComponent(path.basename(new URL(r.request().url()).pathname)))) }));
  await page.goto(origin + "/__score.html");
  await page.evaluate(() => window.boot);
  const list = [
    ["synth-voice", "/__fx/synth-voice.musicxml"], ["amazing-grace", BASE + "songs/amazing-grace.musicxml"], ["synth-pvg", "/__fx/synth-pvg.musicxml"],
    ["synth-longest", "/__fx/synth-longest.musicxml"], ["score-pvg", "/__fx/score-pvg.musicxml"], ["score-duet", "/__fx/score-duet.musicxml"], ["score-duet-partner", "/__fx/score-duet-partner.musicxml"],
    ["score-guitar", "/__fx/score-guitar.musicxml"], ["score-tunein", "/__fx/score-tunein.musicxml"],
    ["score-duet-spurious", "/__fx/score-duet-spurious.musicxml"], ["score-partner-rit", "/__fx/score-partner-rit.musicxml"], ["score-voice-partner", "/__fx/score-voice-partner.musicxml"],
    ...OWNER.map((n) => [n, "/__scores/" + encodeURIComponent(n + ".musicxml")]),
  ];
  const R = {};
  for (const [name, url] of list) {
    R[name] = await page.evaluate(async (url) => {
      let xml = await (await fetch(url)).text();
      if (/<software>\s*Audiveris/.test(xml.slice(0, 4000))) xml = fix.fixOmrScore(xml).xml;
      const P = prep.prepare(xml);
      const out = { views: Object.keys(P.views), parts: P.parts.map((p) => ({ id: p.id, staves: p.staves, notes: p.notes, lyrics: p.lyrics, live: p.live })) };
      const sc = P.views.score;
      if (!sc) return out;
      out.plan = { ...sc };
      const v = prep.buildView(P.doc, sc);
      const vd = new DOMParser().parseFromString(v.xml, "application/xml");
      out.lyricHome = [...new Set([...vd.getElementsByTagName("lyric")].map((l) => l.closest("part").getAttribute("id") + "|" + (l.parentElement.querySelector(":scope > staff")?.textContent || "1")))];
      out.lyricTexts = [...new Set([...vd.querySelectorAll("lyric > text")].map((t) => t.textContent))];
      out.stanzas = [...new Set([...vd.getElementsByTagName("lyric")].map((l) => l.getAttribute("number") || "1"))];
      // the top part's marks (source: the score's first part, as Audiveris writes them; Songbird's
      // spurious top part included)
      const top = P.doc.querySelector("part");
      out.topEndings = [...top.querySelectorAll("barline > ending")].filter((e) => e.getAttribute("type") === "start").length;
      out.topWords = [...top.querySelectorAll("direction words")].map((w) => w.textContent.trim()).filter((w) => /D\.\s?S\.|D\.\s?C\.|Coda|Fine|Verse|Chorus|Interlude/i.test(w));
      // layout as play.js: the full score's options, a tall page per system pair
      tk.setOptions({ header: "none", footer: "none", breaks: "auto", mnumInterval: 0, adjustPageHeight: false,
        svgAdditionalAttribute: ["note@pname", "note@oct", "note@oct.ges", "accid@accid", "accid@accid.ges", "note@staff", "chord@staff", "staff@n"],
        pageMarginLeft: 60, pageMarginRight: 60, pageMarginTop: 40, pageMarginBottom: 20, spacingStaff: 8, spacingBraceGroup: 8,
        justifyVertically: true, justificationStaff: 0.2, justificationBraceGroup: 0.2, lyricWordSpace: 3,
        transposeToSoundingPitch: /<transpose\b/.test(v.xml), condense: "auto", condenseFirstPage: false, condenseTempoPages: false, systemDivider: "none",
        scale: 55, pageWidth: Math.round(820 * 100 / 55), pageHeight: Math.round(1080 * 100 / 55) });
      tk.loadData(v.xml);
      const pg = document.getElementById("pg");
      const sys = [], marks = [], verseN = new Set();
      let endings = 0, empty = 0, drawn = 0, dividers = 0, keepers = 0, keepBad = 0, noClef = 0;
      const keepIds = [];
      const floor = { top: 0, topBad: [], low: 0, lowBad: [] };
      const lowSet = new Set(sc.low);
      for (let p = 1; p <= tk.getPageCount(); p++) {
        pg.innerHTML = tk.renderToSVG(p);
        drawn += [...pg.querySelectorAll("g.note")].filter((g) => g.querySelector(":scope > g.notehead") && g.getAttribute("visibility") !== "hidden").length;
        for (const s of pg.querySelectorAll("g.system")) {
          sys.push([...s.querySelector("g.measure").querySelectorAll(":scope > g.staff")].map((st) => st.getAttribute("data-n")).join(""));
          for (const st of s.querySelector("g.measure").querySelectorAll(":scope > g.staff")) if (![...st.querySelectorAll(":scope > g.clef")].some((c) => c.getBBox().width > 0)) noClef++;
        }
        for (const d of pg.querySelectorAll("g.dir, g.tempo, g.reh, g.repeatMark")) {
          const t = d.textContent.replace(/\s+/g, " ").trim(), w = d.getBBox().width;
          if (!w) empty++;
          else if (t) marks.push(t);
        }
        endings += new Set([...pg.querySelectorAll("g.ending")].map((e) => e.textContent.replace(/\s+/g, "").replace(/\d+$/, ""))).size && pg.querySelectorAll("g.ending").length;
        dividers += pg.querySelectorAll("g.systemDivider, g.divLine").length;
        for (const vv of pg.querySelectorAll("g.verse")) verseN.add(vv.closest("g.staff")?.getAttribute("data-n"));
        // the Some floor (decorate with the plan's low staves): which head of each bar's first
        // chord got the name
        const dd = names.decorate(pg, P.facts, { low: sc.low });
        // (invisible place-keepers: a resting staff with a mark stays in its system — never named)
        for (const g of pg.querySelectorAll("g.note[visibility=hidden]")) { if (/^keep-/.test(g.id) && !g.querySelector(".nn")) { keepers++; keepIds.push(g.id); } else keepBad++; }
        const live = dd.items.filter((it) => it.w);
        const rule = live.filter((it) => { const f = it.fact; return it.ledgers >= 2 || f.acc === "printed" || f.acc === "carried" || f.nat; });
        if (live.length && rule.length < 0.15 * live.length) {
          // per (drawn staff, bar): the first chord (earliest onset) of the facts; its top / bass
          const groups = new Map();
          for (const it of live) {
            if (!it.fact.part || it.fact.grace || it.g.closest("g.staff") !== it.staff) continue;
            const key = it.staff.getAttribute("data-n") + "|" + it.g.closest("g.measure").id;
            (groups.get(key) || groups.set(key, []).get(key)).push(it);
          }
          for (const [key, list] of groups) {
            const t0 = Math.min(...list.map((it) => it.fact.onset));
            const first = list.filter((it) => it.fact.onset < t0 + 1e-6);
            if (first.length < 2 || new Set(first.map((it) => it.fact.midi)).size < 2) continue; // (a single note: top = bass)
            const low = lowSet.has(first[0].fact.part + "|" + first[0].fact.staff);
            const want = first.reduce((a, b) => ((low ? b.fact.midi < a.fact.midi : b.fact.midi > a.fact.midi) ? b : a));
            // (the floor's pick is named; any other name in the chord is the rule's own)
            const byRule = (it) => it.ledgers >= 2 || it.fact.acc === "printed" || it.fact.acc === "carried" || it.fact.nat;
            const got = first.filter((it) => it.some === "name");
            const good = got.some((it) => it.fact.midi === want.fact.midi) && got.every((it) => it.fact.midi === want.fact.midi || byRule(it) || Math.abs(it.cy - want.cy) < 0.15 * it.h);
            if (low) { floor.low++; if (!good) floor.lowBad.push(key); } else { floor.top++; if (!good) floor.topBad.push(key); }
          }
        }
      }
      // system-start clefs on every staff (a hidden clef as the keeper had blanked them)
      Object.assign(out, { pitched: v.pitched, drawn, sys, marks, empty, endingsDrawn: endings, dividers, verseN: [...verseN], floor, keepers, keepIds, keepBad, noClef });
      // the LH view's floor: the bass note (v78; it was the top note, the LH being the first staff)
      if (P.views.lh) {
        const lv = prep.buildView(P.doc, P.views.lh);
        tk.setOptions({ condense: "auto", systemDivider: "auto", transposeToSoundingPitch: /<transpose\b/.test(lv.xml) });
        tk.loadData(lv.xml);
        let lowN = 0, lowBad = 0, topHit = 0;
        for (let p = 1; p <= Math.min(3, tk.getPageCount()); p++) {
          pg.innerHTML = tk.renderToSVG(p);
          const dd = names.decorate(pg, P.facts, { low: P.views.lh.low });
          const live = dd.items.filter((it) => it.w);
          const rule = live.filter((it) => { const f = it.fact; return it.ledgers >= 2 || f.acc === "printed" || f.acc === "carried" || f.nat; });
          if (!live.length || rule.length >= 0.15 * live.length) continue;
          const groups = new Map();
          for (const it of live) { if (!it.fact.part || it.fact.grace) continue; const key = it.g.closest("g.measure").id; (groups.get(key) || groups.set(key, []).get(key)).push(it); }
          for (const list of groups.values()) {
            const t0 = Math.min(...list.map((it) => it.fact.onset));
            const first = list.filter((it) => it.fact.onset < t0 + 1e-6);
            if (new Set(first.map((it) => it.fact.midi)).size < 2) continue;
            const lo = Math.min(...first.map((it) => it.fact.midi)), hi = Math.max(...first.map((it) => it.fact.midi));
            const byRule = (it) => it.ledgers >= 2 || it.fact.acc === "printed" || it.fact.acc === "carried" || it.fact.nat;
            const got = first.filter((it) => it.some === "name").map((it) => it.fact.midi);
            lowN++;
            if (!got.includes(lo)) lowBad++;
            if (first.some((it) => it.fact.midi === hi && it.some === "name" && !byRule(it))) topHit++;
          }
        }
        out.lhFloor = { n: lowN, bad: lowBad, topHit };
      }
      return out;
    }, url);
  }
  // ---- offered / not, and the parts
  const want = {
    "synth-voice": null, "amazing-grace": "P1,P2", "synth-pvg": "P1,P2", "synth-longest": "P1", "score-pvg": "P1,P2,P3", "score-duet": "P2,P3", "score-duet-partner": "P1,P2,P3", "score-guitar": "P1,P2", "score-tunein": "P1",
    "score-duet-spurious": "P4,P2,P3", "score-partner-rit": "P1,P2,P3", "score-voice-partner": "P1,P2",
    killing: "P1,P2", wichita: "P1,P2", pianoman: "P1,P2,P3", songbird: "P1,P2,P3", longest: "P1",
  };
  for (const [name, r] of Object.entries(R)) {
    const w = want[name];
    if (w === undefined) { info(`${name}: no expectation`); continue; }
    if (w === null) { ok(!r.views.includes("score"), `A ${name}: no Full score (a voice-only song: Both is the tune with words) — views ${r.views}`); continue; }
    ok(r.views[0] === "score", `A ${name}: Full score first in ${r.views}`);
    ok(r.plan && r.plan.parts.join() === w, `A ${name}: parts ${r.plan?.parts} ≠ ${w}`);
    if (!r.plan) continue;
    const tag = `A ${name}`;
    ok(r.drawn === r.pitched, `${tag}: drawn ${r.drawn} of ${r.pitched} notes`);
    // words: only under the tune's staff
    // (the tune's staff — every staff of a singer's own part — and another singer's part)
    const ww = r.plan.words, staves = (pid) => r.parts.find((p) => p.id === pid).staves;
    const homes = new Set([...(ww.staff != null ? [ww.part + "|" + ww.staff] : Array.from({ length: staves(ww.part) }, (_, i) => ww.part + "|" + (i + 1))), ...(ww.also || []).flatMap((pid) => Array.from({ length: staves(pid) }, (_, i) => pid + "|" + (i + 1)))]);
    const home = ww.part + "|" + (ww.staff ?? ww.tune?.staff ?? 1);
    ok(r.lyricHome.includes(home) && r.lyricHome.every((h) => homes.has(h)), `${tag}: words on ${r.lyricHome} (want ${home}, within ${[...homes]})`);
    // the first system shows every staff; a grand staff never loses a hand; condensing from 3 staves,
    // or with a sparse part (a partner's staff shown only where she sings)
    let n0 = 0; const grand = [];
    for (const pid of r.plan.parts) { const st = r.parts.find((p) => p.id === pid).staves; if (st > 1) grand.push(Array.from({ length: st }, (_, i) => String(n0 + i + 1))); n0 += st; }
    ok(r.sys[0].length === n0, `${tag}: first system ${r.sys[0]} of ${n0} staves`);
    ok(r.sys.every((sy) => grand.every((g) => g.every((x) => sy.includes(x)) || g.every((x) => !sy.includes(x)))), `${tag}: a grand staff split: ${r.sys.join(" ")}`);
    ok(r.plan.condense === (n0 >= 3 || !!r.plan.sparse) && (r.plan.condense || r.sys.every((sy) => sy.length === n0)), `${tag}: condense ${r.plan.condense} (${n0} staves${r.plan.sparse ? ", sparse " + r.plan.sparse : ""}) ${r.sys.slice(0, 8).join(" ")}`);
    ok(!r.dividers, `${tag}: ${r.dividers} system dividers`);
    ok(!r.keepBad, `${tag}: ${r.keepBad} hidden notes that aren't place-keepers (or named)`);
    ok(r.noClef === 0, `${tag}: ${r.noClef} system starts without a clef`);
    // the road map: every top-part mark drawn with its ink (none left empty on a staff the system left out)
    ok(r.empty === 0 || name === "synth-pvg", `${tag}: ${r.empty} marks drawn empty`);
    for (const wd of r.topWords) ok(r.marks.some((m) => m.includes(wd.replace(/\s+/g, " ").slice(0, 12))), `${tag}: mark "${wd}" not drawn (${r.marks.slice(0, 12).join(" | ")})`);
    // the floor: the tune's / right hand's top note, the left hand's bass note
    ok(!r.floor.topBad.length && !r.floor.lowBad.length, `${tag}: Some floor picks — top ${r.floor.top} (bad ${r.floor.topBad.slice(0, 4)}), bass ${r.floor.low} (bad ${r.floor.lowBad.slice(0, 4)})`);
    if (r.lhFloor) ok(r.lhFloor.bad === 0 && r.lhFloor.topHit === 0, `${tag}: LH view floor names the bass note, not the top (${JSON.stringify(r.lhFloor)})`);
  }
  // ---- per case
  const s = R["score-pvg"];
  if (s?.plan) {
    ok(s.plan.sung.join() === "P1" && !s.lyricTexts.some((t) => ["xx", "yy", "zz", "oh"].includes(t)) && s.stanzas.sort().join() === "1,2", `A score-pvg: words the tune's, 2 stanzas (${s.lyricTexts.slice(0, 10)}; ${s.stanzas})`);
    ok(s.sys.some((sy) => !sy.includes("1")), `A score-pvg: the voice left out of a piano-intro system (${s.sys.join(" ")})`);
    ok(s.sys.some((sy) => !sy.includes("4")) && s.sys.some((sy) => sy.includes("4")), `A score-pvg: the guitar only where it plays (${s.sys.join(" ")})`);
    // (its left hand rests through bars 20–27: never alone the right hand under the brace)
    ok(s.sys.every((sy) => sy.includes("2") === sy.includes("3")), `A score-pvg: the piano whole (${s.sys.join(" ")})`);
    for (const m of ["D.S. al Coda", "To Coda", "Verse", "B", "96"]) ok(s.marks.some((x) => x.includes(m)), `A score-pvg: "${m}" drawn (${s.marks.join(" | ")})`);
    ok(s.keepers >= 1, `A score-pvg: marked rest bars kept by invisible place-keepers (${s.keepers})`);
    ok(s.endingsDrawn >= 2 && s.floor.top > 0 && s.floor.low > 0, `A score-pvg: endings ${s.endingsDrawn}, floor checked top ${s.floor.top} / bass ${s.floor.low}`);
  }
  const du = R["score-duet"];
  if (du?.plan) ok(du.marks.some((m) => /D\.S\. al Fine/.test(m)) && du.endingsDrawn >= 2 && du.lyricHome.join() === "P2|1", `A score-duet: the spurious top part's road map on the duet (${du.marks.join(" | ")}; endings ${du.endingsDrawn})`);
  // the partner's own staff (all its notes sung) in, its marks handed to the duet: shown only in the
  // first system and where she sings (bars 4 and 19)
  const dp = R["score-duet-partner"];
  if (dp?.plan) {
    const withP1 = dp.sys.filter((sy) => sy.includes("1")).length;
    ok(dp.plan.sparse.join() === "P1" && dp.plan.sung.join() === "P1,P2" && dp.lyricHome.includes("P1|1") && dp.lyricHome.includes("P2|1"), `A score-duet-partner: P1 sung, sparse (${JSON.stringify({ sparse: dp.plan.sparse, sung: dp.plan.sung, home: dp.lyricHome })})`);
    ok(withP1 >= 2 && withP1 <= 3 && withP1 < dp.sys.length, `A score-duet-partner: P1 in ${withP1} of ${dp.sys.length} systems (${dp.sys.join(" ")})`);
    ok(dp.marks.some((m) => /D\.S\. al Fine/.test(m)) && dp.endingsDrawn >= 2, `A score-duet-partner: the road map still drawn (${dp.marks.join(" | ")}; endings ${dp.endingsDrawn})`);
  }
  // (the review of de820b7) F9: the partner's own staff on top of the view, the road map's home
  // dropped above it — its endings still drawn, from the duet that took them
  const sp9 = R["score-duet-spurious"];
  if (sp9?.plan) {
    const withP4 = sp9.sys.filter((sy) => sy.includes("1")).length;
    ok(sp9.plan.sparse?.join() === "P4" && sp9.endingsDrawn >= 2 && sp9.marks.some((m) => /D\.S\. al Fine/.test(m)), `A score-duet-spurious: endings ${sp9.endingsDrawn} (want ≥ 2), marks ${sp9.marks.join(" | ")}`);
    ok(withP4 >= 2 && withP4 <= 3, `A score-duet-spurious: P4 in ${withP4} of ${sp9.sys.length} systems (${sp9.sys.join(" ")})`);
  }
  // F11: no piano, a partner's staff over the voice (2 staves): condensed — she shows in the first
  // system and where she sings, not in every one
  const vp = R["score-voice-partner"];
  if (vp?.plan) {
    const withP1 = vp.sys.filter((sy) => sy.includes("1")).length;
    ok(vp.plan.condense && vp.plan.sparse?.join() === "P1" && withP1 < vp.sys.length && vp.sys.every((sy) => sy.includes("2")), `A score-voice-partner: P1 in ${withP1} of ${vp.sys.length} systems (${vp.sys.join(" ")}; condense ${vp.plan.condense})`);
  }
  // F12: a "rit." on the sparse top part where she rests (an exporter's system text) goes to the
  // tune with the rest of the road map: no place-keeper pins her empty staff in that system
  const pr = R["score-partner-rit"];
  if (pr?.plan) {
    const withP1 = pr.sys.filter((sy) => sy.includes("1")).length;
    ok(!pr.keepIds.some((id) => /^keep-P1-/.test(id)) && pr.marks.some((m) => /rit\./.test(m)) && withP1 <= 3, `A score-partner-rit: keepers ${JSON.stringify(pr.keepIds)}, P1 in ${withP1} of ${pr.sys.length} systems (${pr.sys.join(" ")}), rit. drawn ${pr.marks.some((m) => /rit\./.test(m))}`);
  }
  const ag = R["amazing-grace"];
  if (ag?.plan) ok(ag.plan.brace && ag.plan.braced.join() === "P1,P2" && ag.stanzas.length === 1 && !ag.plan.sung.length, `A amazing-grace: braced as Both, verse 1 only (${ag.stanzas})`);
  const tu = R["score-tunein"];
  if (tu?.plan) ok(!tu.lyricTexts.includes("stray") && !tu.lyricTexts.includes("junk") && tu.plan.words.staff === 1, `A score-tunein: no words on the left hand (${tu.lyricTexts})`);
  const gu = R["score-guitar"];
  if (gu?.plan) ok(!gu.lyricTexts.includes("ww") && gu.views.join() === "score,both,melody", `A score-guitar: no piano — ${gu.views}, words ${gu.lyricTexts.slice(0, 4)}`);
  if (R.pianoman?.plan) {
    // P3 = the printed accordion staff (cue line below the piano, systems from bar 47 of the PDF)
    const p3 = R.pianoman.parts.find((p) => p.id === "P3");
    ok(p3 && p3.live >= 0.1 && R.pianoman.plan.parts.includes("P3") && !R.pianoman.lyricHome.includes("P3|1"), `A pianoman: the accordion staff P3 (${Math.round(100 * p3.live)}% of bars) in, its stray syllables out`);
    ok(R.pianoman.sys.some((sy) => !sy.includes("4")) && R.pianoman.sys.some((sy) => sy.includes("4")), `A pianoman: the accordion only where it plays`);
  }
  // (P1 = Eurydice's own staff where the print gives her one: 4 notes, 3 sung)
  if (R.songbird?.plan) ok(R.songbird.plan.parts.includes("P1") && R.songbird.plan.sung.includes("P1") && R.songbird.sys.filter((sy) => sy.includes("1")).length <= 3, `A songbird: Eurydice's P1 in, only where she sings (${R.songbird.sys.filter((sy) => sy.includes("1")).length} systems)`);
  for (const e of errors) ok(false, "A pageerror " + e);
  await page.close();
}

// ---------------------------------------------------------------------------------------------
// B: play.html

function INIT() {
  try { if (!navigator.audioSession) Object.defineProperty(navigator, "audioSession", { configurable: true, value: { type: "auto" } }); } catch {}
  window.__key = (key) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}
const D = (page) => page.evaluate(() => { const d = window.resonateDebug?.().play; if (!d) return null; const { facts, countAll, ...rest } = d; return rest; });
const ready = (page, song, view) => page.waitForFunction(([s, v]) => { const d = window.resonateDebug?.().play; return d && d.ready && (!s || d.song === s) && (!v || d.view === v); }, [song, view], { timeout: 120000 });
async function newPage(browser, w, h, errors, touch = true) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror " + e.message));
  page.on("console", (m) => { const t = m.text(); if (m.type() === "error") errors.push("console.error " + t.slice(0, 200)); else if (m.type() === "warning" && /^(song|music engine|loadData|pdf|piano)\b/.test(t)) errors.push("console.warn " + t.slice(0, 200)); });
  await page.goto(BASE + "play.html");
  await ready(page);
  return { ctx, page };
}
async function seed(page, list) {
  const ids = await page.evaluate(async (list) => {
    const L = await import("./library.js?v=78");
    const ids = {};
    for (const s of list) {
      ids[s.name] = await L.addSong(s.name, s.xml, { source: s.pdf ? "pdf" : "file" });
      if (s.pdf) await L.putPdf(ids[s.name], Uint8Array.from(atob(s.pdf), (c) => c.charCodeAt(0)).buffer, s.name + ".pdf");
    }
    return ids;
  }, list);
  await page.reload();
  await ready(page);
  return ids;
}
const songList = (names) => names.map((n) => ({ name: n, xml: read(fs.existsSync(path.join(FIX, n + ".musicxml")) ? path.join(FIX, n + ".musicxml") : path.join(SCORES, n + ".musicxml")) }));
async function openSong(page, id, view) {
  await page.selectOption("#song", id);
  await ready(page, id);
  if (view && (await D(page)).view !== view) { await page.selectOption("#hands", view); await ready(page, id, view); }
}
const setView = async (page, v) => { if ((await D(page)).view !== v) { await page.selectOption("#hands", v); await ready(page, null, v); } };
// Every page from the first: systems, staves, the lowest ink (share of the stage)
async function pagesOf(page) {
  const d = await D(page);
  await page.evaluate(() => { for (let i = 0; i < 400 && window.resonateDebug().play.page > 1; i++) window.__key("ArrowLeft"); });
  const rows = [];
  for (let guard = 0; guard < 400; guard++) {
    rows.push(...(await page.evaluate(() => {
      const st = document.getElementById("stage").getBoundingClientRect();
      return [...document.querySelectorAll("#stage .page")].map((pg) => {
        const sys = [...pg.querySelectorAll("g.system")];
        let bottom = 0;
        for (const s of sys) for (const st2 of s.querySelectorAll("g.staff")) bottom = Math.max(bottom, st2.getBoundingClientRect().bottom);
        return { n: sys.length, fill: (bottom - st.top) / st.height, bars: pg.querySelectorAll("g.measure").length, ends: [...pg.querySelectorAll("g.ending")].map((e) => e.querySelectorAll("text").length) };
      });
    })));
    const before = (await D(page)).page;
    await page.evaluate(() => window.__key("ArrowRight"));
    if ((await D(page)).page === before) break;
  }
  await page.evaluate(() => { for (let i = 0; i < 400 && window.resonateDebug().play.page > 1; i++) window.__key("ArrowLeft"); });
  return { rows, d };
}
const share2 = (rows) => { const j = rows.length > 1 ? rows.slice(0, -1) : rows; return j.filter((r) => r.n >= 2).length / Math.max(1, j.length); };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

async function partB(browser) {
  console.log("== B play.html");
  const errors = [];
  const songs = ["score-pvg", "synth-pvg", "score-tunein", ...OWNER];
  // ---- B1 the menu, the default, the choice kept per song
  {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await seed(page, songList(["score-pvg", "synth-voice", "synth-pvg"]));
    // (synth-pvg: Both chosen for it — "another song keeps its own view", below)
    await page.evaluate((id) => { const all = JSON.parse(localStorage.getItem("resonate.play") || "{}"); all[id] = { view: "both" }; localStorage.setItem("resonate.play", JSON.stringify(all)); }, ids["synth-pvg"]);
    await openSong(page, ids["score-pvg"]);
    let d = await D(page);
    const opts = await page.evaluate(() => [...document.querySelectorAll("#hands option")].map((o) => o.value + "=" + o.textContent));
    ok(opts.join("|") === "score=Full score|both=Both hands|rh=Right hand|lh=Left hand|melody=Melody", `B1 menu ${opts.join("|")}`);
    ok(d.view === "score", `B1 a song with no saved view opens in the Full score (E1; ${d.view})`);
    // (chosen: Both, then the Full score again — kept per song, below)
    await setView(page, "both");
    await setView(page, "score");
    d = await D(page);
    ok(d.view === "score" && d.counts.rendered > 0, `B1 Full score shown (${d.counts.rendered} heads)`);
    // the endings once, over the system's top staff (Verovio draws one over every staff group unless
    // the score says ending.rend="top": the page loads a full score with endings through MEI)
    {
      const labels = [];
      await page.evaluate(() => { for (let i = 0; i < 400 && window.resonateDebug().play.page > 1; i++) window.__key("ArrowLeft"); });
      for (let i = 0; i < 40; i++) {
        labels.push(...(await page.evaluate(() => [...document.querySelectorAll("#stage g.ending")].map((e) => {
          const t = [...e.querySelectorAll("text")];
          // (the top line of the system's top staff: a staff's group holds its notes above it too)
          const line = (st) => { const p = st.querySelector(":scope > path"); return p ? p.getBoundingClientRect().top : Infinity; };
          const staffTop = Math.min(...[...e.closest("g.system")?.querySelectorAll("g.measure > g.staff") || []].map(line));
          return { n: t.length, label: t.map((x) => x.textContent.trim()).join("|"), above: t.every((x) => x.getBoundingClientRect().bottom <= staffTop + 2) };
        }))));
        const before = (await D(page)).page;
        await page.evaluate(() => window.__key("ArrowRight"));
        if ((await D(page)).page === before) break;
      }
      await page.evaluate(() => { for (let i = 0; i < 400 && window.resonateDebug().play.page > 1; i++) window.__key("ArrowLeft"); });
      ok(labels.length >= 2 && labels.every((l) => l.n <= 1) && labels.filter((l) => l.n).length === 2 && labels.every((l) => l.above), `B1 endings once, over the top staff: ${JSON.stringify(labels)}`);
    }
    await sleep(1200);
    const st = await page.evaluate((id) => JSON.parse(localStorage.getItem("resonate.play") || "{}")[id]?.view, ids["score-pvg"]);
    ok(st === "score", `B1 kept per song: ${st}`);
    // another song keeps its own (Both)
    await openSong(page, ids["synth-pvg"]);
    ok((await D(page)).view === "both", `B1 another song opens in its own view (${(await D(page)).view})`);
    await openSong(page, ids["synth-voice"]);
    d = await D(page);
    ok(!d.views.includes("score") && (await page.evaluate(() => document.getElementById("hands").hidden)), `B1 a voice-only song: no Full score, no menu (${d.views})`);
    await openSong(page, ids["score-pvg"]);
    ok((await D(page)).view === "score", `B1 back to score-pvg: Full score (${(await D(page)).view})`);
    await page.reload();
    await ready(page, ids["score-pvg"]);
    ok((await D(page)).view === "score", "B1 after a reload: Full score");
    // the voice's strip colour; RH / LH unchanged
    const cdp = await ctx.newCDPSession(page);
    await page.evaluate(() => { for (let i = 0; i < 400 && window.resonateDebug().play.page > 1; i++) window.__key("ArrowLeft"); });
    // (a head of the part / staff wanted — a chord's too: the right / left hand play chords)
    const pick = async (pred) => page.evaluate((src) => {
      const pred = new Function("f", "return " + src);
      const F = window.resonateDebug().play.facts;
      for (const g of document.querySelectorAll("#stage g.note")) {
        const f = F[g.id], h = g.querySelector(":scope > g.notehead");
        if (!f || !h || !pred(f)) continue;
        const b = h.getBoundingClientRect();
        if (b.width) return { id: g.id, x: b.left + b.width / 2, y: b.top + b.height / 2, midi: f.midi };
      }
      return null;
    }, pred);
    for (const [what, pred, hand, fill] of [["voice", "f.part === 'P1'", "voice", "rgb(11, 143, 120)"], ["right hand", "f.part === 'P2' && f.staff === 1", "rh", "rgb(166, 79, 255)"], ["left hand", "f.part === 'P2' && f.staff === 2", "lh", "rgb(79, 124, 255)"]]) {
      let h = await pick(pred);
      // (the voice rests through score-pvg's intro: turn until a page has one)
      for (let i = 0; !h && i < 12; i++) { await page.evaluate(() => window.__key("ArrowRight")); await sleep(80); h = await pick(pred); }
      if (!h) { ok(false, `B1 no ${what} note found`); continue; }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: h.x, y: h.y }] });
      await page.waitForFunction(() => window.resonateDebug().play.peek, null, { timeout: 4000 }).catch(() => {});
      await sleep(250);
      const pk = await page.evaluate(() => {
        const p = window.resonateDebug().play.peek;
        return p && { lit: p.lit, names: p.names, fills: [...document.querySelectorAll("#strip rect.lit")].map((r) => getComputedStyle(r).fill), bubble: document.getElementById("bubble").textContent };
      });
      ok(pk && pk.lit.length && pk.lit.every((l) => l.hand === hand) && pk.fills.every((f) => f === fill), `B1 peek a ${what} note: ${JSON.stringify(pk)} (want ${hand} ${fill})`);
      ok(pk && /\d/.test(pk.bubble), `B1 peek a ${what} note: bubble "${pk?.bubble}"`);
      if (what === "voice") await page.screenshot({ path: path.join(SHOTS, "score-peek-voice.png") });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await sleep(2300);
    }
    ok(new Set(["#0b8f78", "#a64fff", "#4f7cff", "#d86b00"]).size === 4, "B1 the voice's colour is its own");
    await ctx.close();
  }
  // ---- B2 systems per page at the iPad sizes, no size chosen (v79: the printed page's density —
  // 90 staff spaces across the stage — in portrait; in landscape two systems a page, stepping
  // down to 0.9 of the portrait density at most, else one a page at it); − / +
  for (const [dev, [w, h]] of Object.entries(IPADS)) {
    const { ctx, page } = await newPage(browser, w, h, errors);
    const ids = await seed(page, songList(songs));
    for (const name of songs) {
      await openSong(page, ids[name], "both");
      const b = await D(page);
      // (v80: the keyboard docked under the music — the landscape floor × its share of the height;
      // the cap, a whole system a page, can come under the printed density)
      const room = b.keys?.shown ? b.H / (b.H + b.keys.rect[3]) : 1;
      const base = Math.max(5, b.W / 90), floor = room * Math.min(base, (0.9 * Math.min(w, h)) / 90);
      ok(Math.abs(b.base - base) < 0.02 && (h > w ? Math.abs(b.sp - base) < 0.01 : b.sp >= floor - 0.01 && b.sp <= base + 0.01) && !b.spread, `B2 ${dev} ${name}: Both at ${b.sp} (the printed density ${base.toFixed(2)})`);
      await setView(page, "score");
      const { rows, d } = await pagesOf(page);
      const two = share2(rows), fill = median((rows.length > 1 ? rows.slice(0, -1) : rows).map((r) => r.fill));
      const bars = rows.reduce((a, r) => a + r.bars, 0) / rows.length;
      info(`${dev} ${name.padEnd(13)} sp ${d.sp} ${d.pages} pages, two systems on ${Math.round(100 * two)}%, fill ${Math.round(100 * fill)}%, ${bars.toFixed(1)} bars a page${d.mode === "one" ? " (one a page)" : ""}`);
      ok(d.sizeAuto, `B2 ${dev} ${name}: no size chosen`);
      ok(Math.abs(d.base - Math.min(base, d.cap)) < 0.02, `B2 ${dev} ${name}: the score from the printed density (${d.base}, ${base.toFixed(2)}, cap ${d.cap.toFixed(2)})`);
      ok(rows.every((r) => r.ends.every((n) => n <= 1)), `B2 ${dev} ${name}: an ending labelled twice ${JSON.stringify(rows.map((r) => r.ends).filter((e) => e.length))}`);
      if (d.mode !== "one") ok((two >= 0.75 || rows.length < 2) && d.sp >= floor - 0.01 && d.sp <= base + 0.01, `B2 ${dev} ${name}: two systems on ${Math.round(100 * two)}% at ${d.sp}`);
      else {
        // one system a page: two didn't hold down to the floor (0.9 of the device's portrait
        // density; the page's own log: [{ sp, share of pages with two }]); the one at the density,
        // filling most of the page
        const tried = d.fitLog || [];
        ok(Math.abs(d.sp - Math.min(base, d.cap)) < 0.01 && tried.length && tried.every((x) => x.share < 0.75) && tried[tried.length - 1].sp <= floor + 0.01, `B2 ${dev} ${name}: one system a page at ${d.sp} after ${JSON.stringify(tried)}`);
        ok(fill >= 0.6, `B2 ${dev} ${name}: one system a page fills ${Math.round(100 * fill)}%`);
      }
      // the drawing inside the stage, nothing clipped
      const clip = await page.evaluate(() => { const st = document.getElementById("stage").getBoundingClientRect(); return [...document.querySelectorAll("#stage g.staff, #stage g.verse")].filter((e) => { const b = e.getBoundingClientRect(); return b.width && (b.bottom > st.bottom + 2 || b.top < st.top - 2 || b.right > st.right + 2); }).length; });
      ok(clip === 0, `B2 ${dev} ${name}: ${clip} staves / words outside the stage`);
      if (name === "killing" || name === "score-pvg") await page.screenshot({ path: path.join(SHOTS, `score-${dev}-${name}.png`) });
    }
    // − then + on the score (score-pvg): its own pref, Both's untouched
    await openSong(page, ids["score-pvg"], "score");
    let d = await D(page);
    const sp0 = d.sp, two0 = share2((await pagesOf(page)).rows);
    if (!(await page.isDisabled("#smaller"))) {
      await page.click("#smaller"); await ready(page, null, "score");
      d = await D(page);
      const rows = (await pagesOf(page)).rows;
      ok(d.sp < sp0 && !d.sizeAuto && (await page.evaluate(() => localStorage.getItem("resonate.play.zoom.score"))) === "-1", `B2 ${dev}: − in the score → ${d.sp} (from ${sp0}), kept as its own pref`);
      if (two0 >= 0.75) ok(share2(rows) >= 0.75, `B2 ${dev}: smaller still two systems or more (${Math.round(100 * share2(rows))}%)`);
      ok((await page.evaluate(() => localStorage.getItem("resonate.play.zoom"))) === null, `B2 ${dev}: Both's size pref untouched`);
      await page.click("#bigger"); await ready(page, null, "score");
      d = await D(page);
      ok(d.step === 0 && Math.abs(d.sp - sp0) < 0.01 && (await page.evaluate(() => localStorage.getItem("resonate.play.zoom.score"))) === null, `B2 ${dev}: + → the default again (${d.sp})`);
    }
    await page.evaluate(() => localStorage.removeItem("resonate.play.zoom.score"));
    await ctx.close();
  }
  // ---- B3 the size prefs are independent (Air landscape)
  {
    const { ctx, page } = await newPage(browser, 1180, 820, errors);
    const ids = await seed(page, songList(["score-pvg"]));
    await openSong(page, ids["score-pvg"], "score");
    const s0 = await D(page);
    await setView(page, "both");
    const b0 = await D(page);
    await page.click("#bigger"); await ready(page, null, "both");
    const b1 = await D(page);
    ok(b1.sp > b0.sp && (await page.evaluate(() => localStorage.getItem("resonate.play.zoom"))) === "+1", `B3 + in Both: ${b0.sp} → ${b1.sp}`);
    await setView(page, "score");
    let s1 = await D(page);
    ok(s1.sizeAuto && s1.sp === s0.sp, `B3 the score after + in Both: still its own (auto ${s1.sizeAuto}, sp ${s1.sp} = ${s0.sp})`);
    await page.click("#smaller"); await ready(page, null, "score");
    s1 = await D(page);
    ok(!s1.sizeAuto && s1.sp < s0.sp, `B3 − in the score: ${s0.sp} → ${s1.sp}`);
    await setView(page, "both");
    ok((await D(page)).sp === b1.sp, `B3 Both after − in the score: ${(await D(page)).sp} = ${b1.sp}`);
    await page.reload(); await ready(page, ids["score-pvg"], "both");
    ok((await D(page)).sp === b1.sp, "B3 Both's size after a reload");
    await setView(page, "score");
    ok((await D(page)).sp === s1.sp, "B3 the score's size after a reload");
    await ctx.close();
  }
  // ---- B4 the place: Full score ↔ Both / RH / LH / Melody, rotation, − / +, reload
  for (const name of ["score-pvg", ...OWNER.filter((n) => /killing|pianoman/.test(n))]) {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await seed(page, songList([name]));
    await openSong(page, ids[name], "score");
    for (let i = 0; i < 2; i++) await page.evaluate(() => window.__key("ArrowRight"));
    await sleep(100);
    const at = (await D(page)).at;
    const onScreen = async (what) => {
      const r = await page.evaluate((at) => {
        const ids = [...document.querySelectorAll("#stage .page g.measure")].map((g) => Number(/^m(\d+)$/.exec(g.id)?.[1])).filter(Number.isFinite);
        if (!ids.length) return "no measures";
        const m = ids.find((x) => x >= at) ?? null;
        // the anchor bar (or the first bar this view draws at or after it) is on the shown page(s)
        return ids[0] <= at && (m === at || m != null) ? true : `shown ${ids[0]}–${ids[ids.length - 1]}`;
      }, at);
      ok(r === true, `B4 ${name} ${what}: bar ${at} ${r === true ? "" : r}`);
    };
    await onScreen("Full score page 3");
    const views = (await D(page)).views;
    for (const v of ["both", "rh", "lh", "melody", "score"]) if (views.includes(v)) { await setView(page, v); await onScreen("→ " + v); }
    await page.setViewportSize({ width: 1180, height: 820 }); await sleep(600); await ready(page); await onScreen("rotated");
    await page.setViewportSize({ width: 820, height: 1180 }); await sleep(600); await ready(page); await onScreen("rotated back");
    if (!(await page.isDisabled("#smaller"))) { await page.click("#smaller"); await ready(page, null, "score"); await onScreen("−"); }
    if (!(await page.isDisabled("#bigger"))) { await page.click("#bigger"); await ready(page, null, "score"); await onScreen("+"); }
    ok((await D(page)).at === at, `B4 ${name}: the place ${(await D(page)).at} = ${at}`);
    await sleep(1200);
    await page.reload(); await ready(page, ids[name], "score"); await onScreen("reload");
    await ctx.close();
  }
  // ---- B5 the PDF view over the score, and back
  {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await page.evaluate(async (s) => {
      const L = await import("./library.js?v=78");
      const id = await L.addSong("score-pdf", s.xml, { source: "pdf" });
      await L.putPdf(id, Uint8Array.from(atob(s.pdf), (c) => c.charCodeAt(0)).buffer, "x.pdf");
      return { pdf: id };
    }, { xml: read(path.join(FIX, "score-pvg.musicxml")), pdf: pdfmini(2).toString("base64") });
    await page.reload(); await ready(page);
    await openSong(page, ids.pdf, "score");
    await page.waitForFunction(() => !document.getElementById("pdf").hidden, null, { timeout: 10000 }).catch(() => {});
    const p0 = (await D(page)).page;
    await page.click("#pdf");
    await page.waitForFunction(() => { const p = window.resonateDebug().play.pdf; return p.on && !p.busy && p.canvas; }, null, { timeout: 30000 }).catch(() => {});
    const dis = await page.evaluate(() => ["names", "smaller", "bigger", "hands"].map((i) => document.getElementById(i).disabled));
    ok(dis.every(Boolean), `B5 PDF over the score: names/size/menu disabled ${dis}`);
    await page.click("#pdf");
    await sleep(300);
    const d = await D(page);
    ok(!d.pdf.on && d.view === "score" && d.page === p0, `B5 back to the score at page ${d.page}`);
    await ctx.close();
  }
  for (const e of errors) ok(false, "B " + e);
}

// ---------------------------------------------------------------------------------------------
// C: WebKitGTK — load, Full score, names, a peek on a vocal note

async function partC() {
  console.log("== C WebKitGTK");
  const W = "http://127.0.0.1:4444";
  try { await fetch(W + "/status"); } catch { console.log("   (no WebKitWebDriver on :4444: skipped)"); return; }
  const ROOT = BASE.replace(/resonate\/$/, "");
  const SRC = "/home/user/resonate/public/play.html", OUT = "/home/user/sitetest/tmp/play-wk-score.html";
  const REC = `<base href="/resonate/"><script>window.__err=[];addEventListener("error",(e)=>__err.push("error "+e.message+" @"+e.filename+":"+e.lineno));addEventListener("unhandledrejection",(e)=>__err.push("rejection "+(e.reason&&(e.reason.stack||e.reason.message)||e.reason)));const __ce=console.error;console.error=(...a)=>{__err.push("console.error "+a.map(String).join(" "));__ce.apply(console,a)};</script>`;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, read(SRC).replace(/<head>/i, "<head>" + REC));
  const j = async (method, p, body) => (await fetch(W + p, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) })).json();
  const s = await j("POST", "/session", { capabilities: { alwaysMatch: { browserName: "MiniBrowser", "webkitgtk:browserOptions": { binary: "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser", args: ["--automation"] } } } });
  const sid = s.value?.sessionId;
  if (!sid) { ok(false, "C no WebDriver session " + JSON.stringify(s).slice(0, 200)); return; }
  const ex = async (script, args = []) => (await j("POST", `/session/${sid}/execute/sync`, { script, args })).value;
  const exa = async (script, args = []) => (await j("POST", `/session/${sid}/execute/async`, { script, args })).value;
  const dbg = () => ex(`const d = window.resonateDebug && window.resonateDebug().play; return d && { ready: d.ready, failed: d.failed, song: d.song, view: d.view, views: d.views, page: d.page, pages: d.pages, rendered: d.counts.rendered, pitched: d.counts.pitched, names: d.names, sp: d.sp, t: d.t, peek: d.peek };`);
  const waitReady = async (song, view) => { let d = null; for (let i = 0; i < 200; i++) { d = await dbg(); if (d && (d.failed || (d.ready && (!song || d.song === song) && (!view || d.view === view)))) break; await sleep(250); } return d; };
  try {
    await j("POST", `/session/${sid}/window/rect`, { width: 1024, height: 1300 }).catch(() => {});
    await j("POST", `/session/${sid}/url`, { url: ROOT + "tmp/play-wk-score.html" });
    await waitReady();
    // (a clean slate: the WebKit profile keeps the last run's songs and records)
    await ex(`localStorage.clear(); return 1`);
    const id = await exa(`const done = arguments[arguments.length - 1];
      (async () => { const L = await import("./library.js?v=78"); const id = await L.addSong("score-pvg", arguments[0], {});
        localStorage.setItem("resonate.sing.song", id); return id; })().then(done, (e) => done("ERR " + e.message));`, [read(path.join(FIX, "score-pvg.musicxml"))]);
    ok(typeof id === "string" && !id.startsWith("ERR"), `C seeded ${id}`);
    await j("POST", `/session/${sid}/refresh`, {});
    let d = await waitReady(id);
    console.log("   UA", await ex("return navigator.userAgent"));
    ok(d && d.ready && d.view === "score" && d.views[0] === "score", `C opens in the Full score (E1), first in the menu (${d?.view}, ${d?.views})`);
    await ex(`const h = document.getElementById("hands"); h.value = "score"; h.dispatchEvent(new Event("change", { bubbles: true })); return 1`);
    d = await waitReady(id, "score");
    ok(d && d.ready && d.view === "score", `C Full score shown (${d?.view})`);
    // (the voice sings from bar 12: turn with the arrow key until its notes show)
    const vocal = `const F = window.resonateDebug().play.facts; for (const g of document.querySelectorAll("#stage g.note")) { const f = F[g.id], hd = g.querySelector(":scope > g.notehead"); if (f && f.part === "P1" && hd) { const b = hd.getBoundingClientRect(); if (b.width) return [b.left + b.width / 2, b.top + b.height / 2]; } } return null;`;
    for (let i = 0; i < 8 && !(await ex(vocal)); i++) { await j("POST", `/session/${sid}/actions`, { actions: [{ type: "key", id: "k", actions: [{ type: "keyDown", value: "\uE014" }, { type: "keyUp", value: "\uE014" }] }] }); await sleep(400); }
    d = await dbg();
    const all = await ex(`return window.resonateDebug().play.countAll()`);
    ok(all.rendered === all.pitched && all.pitched > 0, `C every page drawn: ${all.rendered} = ${all.pitched}`);
    const badges = await ex(`return [document.querySelectorAll("#stage .nn").length, [...document.querySelectorAll("#stage .nn")].filter((n) => getComputedStyle(n).display !== "none").length, [...document.querySelectorAll("#stage g.note:not([visibility=hidden]) > g.notehead")].length]`);
    ok(badges[0] > 0 && badges[0] === badges[1] && badges[0] === badges[2], `C names at All: ${badges[1]} shown of ${badges[0]} badges, ${badges[2]} heads`);
    await ex(`document.getElementById("names").click(); return 1`);
    const some = await ex(`return [document.getElementById("stage").dataset.names, [...document.querySelectorAll("#stage .nn")].filter((n) => getComputedStyle(n).display !== "none").length]`);
    ok(some[0] === "some" && some[1] < badges[0] && some[1] > 0, `C names Some: ${some}`);
    await ex(`document.getElementById("names").click(); document.getElementById("names").click(); return 1`);
    // a vocal note (P1): press, hold — the bubble, the strip in the voice's colour
    const h = await ex(vocal);
    if (!h) ok(false, "C no vocal note on the page");
    else {
      await j("POST", `/session/${sid}/actions`, { actions: [{ type: "pointer", id: "m", parameters: { pointerType: "mouse" }, actions: [{ type: "pointerMove", x: Math.round(h[0]), y: Math.round(h[1]), duration: 0 }, { type: "pointerDown", button: 0 }, { type: "pause", duration: 900 }] }] });
      const pk = await ex(`const d = window.resonateDebug().play; return { peek: d.peek, bubble: document.getElementById("bubble").classList.contains("on") && document.getElementById("bubble").textContent, strip: !document.getElementById("dock").hidden && document.querySelectorAll("#strip rect.lit").length > 0, fills: [...document.querySelectorAll("#strip rect.lit")].map((r) => r.getAttribute("fill")) }`);
      await j("POST", `/session/${sid}/actions`, { actions: [{ type: "pointer", id: "m", parameters: { pointerType: "mouse" }, actions: [{ type: "pointerUp", button: 0 }] }] });
      ok(pk.peek && pk.bubble && /\d/.test(pk.bubble) && pk.strip && pk.peek.lit.every((l) => l.hand === "voice") && pk.fills.every((f) => f === "#0b8f78"), `C peek a vocal note: "${pk.bubble}", lit ${JSON.stringify(pk.peek?.lit)} ${pk.fills}`);
    }
    const p0 = d.page;
    await sleep(500);
    d = await dbg();
    ok(d.page === p0, `C the voice's page (${p0}, turned to with the arrow key if needed); the peek's lift doesn't turn (${d.page})`);
    const err = await ex("return window.__err");
    ok(Array.isArray(err) && !err.length, `C no errors: ${JSON.stringify(err)}`);
  } finally {
    await j("DELETE", `/session/${sid}`);
  }
}

// ---------------------------------------------------------------------------------------------
// D: timings (desktop Chromium, an 11" iPad Air's stage in portrait): Full score vs Both

async function partD(browser) {
  console.log("== D timings (ms; desktop Chromium, 820x1180)");
  const errors = [];
  const { ctx, page } = await newPage(browser, 820, 1180, errors);
  const names = OWNER.length ? OWNER : ["score-pvg"];
  const ids = await seed(page, songList(names));
  console.log("   song          view   loadData  fit  layout(rotate)  fit(landscape)  render  badges  pages  sp");
  for (const name of names) {
    for (const v of ["both", "score"]) {
      await openSong(page, ids[name], v === "both" ? "both" : undefined);
      if (v === "score") await setView(page, "score");
      const t0 = { ...(await D(page)).t };
      await page.setViewportSize({ width: 1180, height: 820 }); await sleep(500); await ready(page);
      const t1 = { ...(await D(page)).t }, fitL = v === "score" ? (await D(page)).fitLog.length : 0;
      await page.setViewportSize({ width: 820, height: 1180 }); await sleep(500); await ready(page);
      await page.evaluate(() => window.__key("ArrowRight")); await sleep(100);
      const t2 = { ...(await D(page)).t };
      const d = await D(page);
      // (fit(landscape): the extra layouts' time and how many sizes were tried, on the first landscape layout)
      console.log(`   ${name.padEnd(13)} ${v.padEnd(6)} ${String(t0.data).padStart(8)} ${String(v === "score" ? t0.fit ?? "" : "").padStart(4)} ${String(t1.layout).padStart(15)} ${String(v === "score" && fitL ? `${t1.fit} (${fitL})` : "").padStart(15)} ${String(t2.render).padStart(7)} ${String(t2.badges).padStart(7)} ${String(d.pages).padStart(6)}  ${d.sp}`);
      ok(t0.data < 5000 && t1.layout < 5000, `D ${name} ${v}: loadData ${t0.data} / layout ${t1.layout} ms`);
    }
  }
  await ctx.close();
  for (const e of errors) ok(false, "D " + e);
}

// ---------------------------------------------------------------------------------------------
// E: the review fixes (v78 round 1), prep + Verovio — fixtures from playscorefixture2.mjs
//   E1 barlines (style, repeats, endings) the parts below the top wrote: the full score's measures
//      have Both's left/right barlines (Piano Man's final bar and double bars, Songbird's)
//   E2 marks written in every part drawn once; an Audiveris heading below a lower staff moved to the
//      top part where it was printed (Piano Man's second "Chorus", Wichita's "Verse:")
//   E3 a transposing part: the MEI pass at sounding pitch, pitches and positions unchanged
//   E4 a part missing from the part-list: in its place, measure ids kept (a hymn's Both too)
//   E5 a singer's part on two staves keeps both staves' words
//   E6 a choir's bracket kept (barlines through it), condensing still works with a piano
//   E7 syllables split between the tune and the chord under it: joined on the tune, no hyphen
//      through another syllable (The Longest Time)
//   E8 a second singer's part: its words, sung (the voice's colour), its staff read from the top
const FIX2 = path.join(__dirname, "fixtures/playscore");
const meiBars = (mei) => { const out = {}; for (const m of mei.matchAll(/<measure\b([^>]*)>/g)) { const id = /xml:id="([^"]+)"/.exec(m[1])?.[1]; if (id) out[id] = (/\bleft="([^"]+)"/.exec(m[1])?.[1] || "") + "|" + (/\bright="([^"]+)"/.exec(m[1])?.[1] || ""); } return out; };

async function partE(browser) {
  console.log("== E review fixes: prep + Verovio");
  const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const origin = new URL(BASE).origin;
  await page.route(origin + "/__score.html", (r) => r.fulfill({ contentType: "text/html", body: PAGE }));
  await page.route(origin + "/__fx2/*", (r) => r.fulfill({ contentType: "application/xml", body: read(path.join(FIX2, path.basename(new URL(r.request().url()).pathname))) }));
  await page.route(origin + "/__scores/*", (r) => r.fulfill({ contentType: "application/xml", body: read(path.join(SCORES, decodeURIComponent(path.basename(new URL(r.request().url()).pathname)))) }));
  await page.goto(origin + "/__score.html");
  await page.evaluate(() => window.boot);
  // in the page: load a song, its views' XML, Verovio as play.js sets it per view
  await page.evaluate(() => {
    window.OPTS = { header: "none", footer: "none", breaks: "auto", mnumInterval: 0, adjustPageHeight: false,
      svgAdditionalAttribute: ["note@pname", "note@oct", "note@oct.ges", "accid@accid", "accid@accid.ges", "note@staff", "chord@staff", "staff@n"],
      pageMarginLeft: 60, pageMarginRight: 60, pageMarginTop: 40, pageMarginBottom: 20, spacingStaff: 8, spacingBraceGroup: 8,
      justifyVertically: true, justificationStaff: 0.2, justificationBraceGroup: 0.2, lyricWordSpace: 3,
      scale: 55, pageWidth: Math.round(820 * 100 / 55), pageHeight: Math.round(1080 * 100 / 55) };
    window.song = async (url) => {
      let xml = await (await fetch(url)).text();
      if (/<software>\s*Audiveris/.test(xml.slice(0, 4000))) xml = fix.fixOmrScore(xml).xml;
      return prep.prepare(xml);
    };
    // load a view as play.js does (the full score with endings through MEI) → its MEI
    window.loadView = (v, kind) => {
      const score = kind === "score", tr = /<transpose\b/.test(v.xml);
      tk.setOptions({ ...OPTS, transposeToSoundingPitch: tr, condense: "auto", condenseFirstPage: false, condenseTempoPages: false, systemDivider: score ? "none" : "auto" });
      tk.loadData(v.xml);
      if (score && /<ending\b/.test(v.xml)) {
        const mei = tk.getMEI().replace(/<scoreDef\b/, '<scoreDef ending.rend="top"');
        tk.setOptions({ transposeToSoundingPitch: false });
        tk.loadData(mei);
      }
      return tk.getMEI();
    };
    // every page: marks drawn, endings, syllables per staff, hyphens through another syllable, systems' staves
    window.drawn = () => {
      const pg = document.getElementById("pg");
      const out = { marks: [], repeatMarks: 0, endings: [], syl: {}, dashHits: [], sys: [], ids: [], firstId: null };
      for (let p = 1; p <= tk.getPageCount(); p++) {
        pg.innerHTML = tk.renderToSVG(p);
        if (p === 1) out.firstId = pg.querySelector("g.measure")?.id;
        for (const d of pg.querySelectorAll("g.dir, g.tempo, g.reh")) { const t = d.textContent.replace(/\s+/g, " ").trim(); if (t) out.marks.push(t); }
        out.repeatMarks += pg.querySelectorAll("g.repeatMark").length;
        for (const e of pg.querySelectorAll("g.ending")) out.endings.push([...e.querySelectorAll("text")].map((t) => t.textContent.trim()).join("|"));
        for (const s of pg.querySelectorAll("g.system")) out.sys.push([...s.querySelector("g.measure").querySelectorAll(":scope > g.staff")].map((st) => st.getAttribute("data-n")).join(""));
        const syls = [], dashes = [];
        for (const g of pg.querySelectorAll("g.syl")) {
          const t = g.querySelector("text"), n = g.closest("g.staff")?.getAttribute("data-n");
          if (t && t.textContent.trim()) { const b = t.getBoundingClientRect(); syls.push({ txt: t.textContent.trim(), x0: b.left, x1: b.right, y0: b.top, y1: b.bottom }); out.syl[n] = (out.syl[n] || 0) + 1; }
          for (const r of g.querySelectorAll(":scope > rect")) { const b = r.getBoundingClientRect(); dashes.push({ owner: t?.textContent.trim() || "", x0: b.left, x1: b.right, y: (b.top + b.bottom) / 2 }); }
        }
        for (const d of dashes) for (const s of syls) if (d.y >= s.y0 && d.y <= s.y1 && Math.min(d.x1, s.x1) - Math.max(d.x0, s.x0) > 0.5) out.dashHits.push(d.owner + "→" + s.txt);
      }
      return out;
    };
  });
  const fx = (n) => "/__fx2/" + n + ".musicxml", owner = (n) => (OWNER.includes(n) ? "/__scores/" + n + ".musicxml" : null);

  // ---- E1 barlines from the parts below
  for (const [name, url] of [["pv-lowbars", fx("pv-lowbars")], ["pv-lowbars-omr", fx("pv-lowbars-omr")], ...["pianoman", "songbird", "killing", "wichita", "longest"].map((n) => [n, owner(n)])]) {
    if (!url) continue;
    const r = await page.evaluate(async (url) => {
      const P = await song(url);
      const out = {};
      for (const k of ["both", "score"]) { if (!P.views[k]) continue; const v = prep.buildView(P.doc, P.views[k]); out[k] = { mei: loadView(v, k), endings: drawn().endings }; }
      return out;
    }, url);
    if (!r.score) { ok(false, `E1 ${name}: no Full score`); continue; }
    const b = meiBars(r.both.mei), s = meiBars(r.score.mei);
    // (Both's "single" barlines draw as the default)
    const differ = Object.entries(b).filter(([id, lr]) => { const n = (x) => x.replace(/single/g, ""); return n(lr) !== "|" && n(lr) !== n(s[id] ?? "|"); });
    ok(!differ.length, `E1 ${name}: Full score barlines differ from Both's: ${differ.slice(0, 6).map(([id, lr]) => `${id} both ${lr} score ${s[id]}`).join(", ")}`);
    if (name === "pv-lowbars") {
      ok(/rptstart/.test(Object.values(s).join()) && /rptend/.test(Object.values(s).join()) && /dbl/.test(Object.values(s).join()) && /end/.test(Object.values(s).join()), `E1 pv-lowbars: repeats, double bar, final bar in the score ${JSON.stringify(s).slice(0, 300)}`);
      ok(r.score.endings.length === 2 && r.both.endings.length === 2, `E1 pv-lowbars: the piano's 1./2. endings drawn once each (score ${JSON.stringify(r.score.endings)}, Both ${JSON.stringify(r.both.endings)})`);
    }
    if (name === "pv-lowbars-omr") ok(!r.score.endings.length && /dbl/.test(Object.values(s).join()) && /end/.test(Object.values(s).join()), `E1 pv-lowbars-omr: bar styles in, the 8va "endings" out (${JSON.stringify(r.score.endings)})`);
    if (name === "pianoman") ok(s.m234 && /end$/.test(s.m234) && /dbl/.test(s.m171) && /dbl/.test(s.m219), `E1 pianoman: final barline ${s.m234}, double bars m171 ${s.m171} m219 ${s.m219}`);
    if (name === "songbird") ok(/dbl/.test(s.m16 || ""), `E1 songbird: double bar m16 ${s.m16}`);
  }

  // ---- E2 marks
  {
    const r = await page.evaluate(async (url) => {
      const P = await song(url), out = {};
      for (const k of ["both", "score"]) { const v = prep.buildView(P.doc, P.views[k]); loadView(v, k); const d = drawn(); out[k] = { marks: d.marks, repeatMarks: d.repeatMarks }; }
      return out;
    }, fx("pv-dupmarks"));
    const count = (list) => list.reduce((m, t) => ((m[t] = (m[t] || 0) + 1), m), {});
    const cs = count(r.score.marks), cb = count(r.both.marks);
    ok(JSON.stringify(cs) === JSON.stringify(cb) && r.score.repeatMarks === r.both.repeatMarks && Object.values(cs).every((n) => n === 1), `E2 pv-dupmarks: each mark once (score ${JSON.stringify(cs)} ${r.score.repeatMarks} signs; Both ${JSON.stringify(cb)} ${r.both.repeatMarks})`);
  }
  {
    const r = await page.evaluate(async (url) => {
      const P = await song(url);
      const v = prep.buildView(P.doc, P.views.score);
      const d = new DOMParser().parseFromString(v.xml, "application/xml");
      const mi = (m) => [...m.parentElement.children].filter((c) => c.nodeName === "measure").indexOf(m);
      const where = (re) => [...d.querySelectorAll("direction")].filter((x) => re.test(x.textContent)).map((x) => x.closest("part").getAttribute("id") + ":m" + mi(x.closest("measure")) + ":" + x.getAttribute("placement"));
      loadView(v, "score");
      return { chorus: where(/Chorus/), verse: where(/Verse/), interlude: where(/Interlude/), marks: drawn().marks };
    }, fx("pv-heading-omr"));
    ok(r.chorus.join() === "P1:m6:above" && !r.verse.length && r.interlude.join() === "P2:m10:above" && r.marks.filter((m) => m === "Chorus").length === 1, `E2 pv-heading-omr: "Chorus" over the next system's section bar (${r.chorus}), "Verse" with no next system gone (${r.verse}), "Interlude" above the piano stays (${r.interlude})`);
  }
  for (const [name, re, want] of [["pianoman", /^\s*Chorus\s*$/, "P1:m78,P1:m204"], ["wichita", /^\s*Verse:?\s*$/, "P1:m5"]]) {
    const url = owner(name);
    if (!url) continue;
    const r = await page.evaluate(async ({ url, src }) => {
      const P = await song(url);
      const v = prep.buildView(P.doc, P.views.score);
      const d = new DOMParser().parseFromString(v.xml, "application/xml");
      const re = new RegExp(src);
      const mi = (m) => [...m.parentElement.children].filter((c) => c.nodeName === "measure").indexOf(m);
      return [...d.querySelectorAll("direction")].filter((x) => [...x.querySelectorAll("words")].some((w) => re.test(w.textContent))).map((x) => x.closest("part").getAttribute("id") + ":m" + mi(x.closest("measure")));
    }, { url, src: re.source });
    ok(r.join() === want, `E2 ${name}: the heading where printed — ${r} (want ${want})`);
  }

  // ---- E3 a transposing part through the MEI pass: same pitches and places, endings once
  {
    const r = await page.evaluate(async (url) => {
      const P = await song(url);
      const v = prep.buildView(P.doc, P.views.score);
      const notes = () => { const out = {}; const pg = document.getElementById("pg"); for (let p = 1; p <= tk.getPageCount(); p++) { pg.innerHTML = tk.renderToSVG(p); for (const g of pg.querySelectorAll("g.note")) { const a = g.querySelector("g.accid"); out[g.id] = [g.getAttribute("data-pname"), g.getAttribute("data-oct"), a?.getAttribute("data-accid") || a?.getAttribute("data-accid.ges") || ""].join(","); } } return out; };
      tk.setOptions({ ...OPTS, transposeToSoundingPitch: true, condense: "auto", condenseFirstPage: false, condenseTempoPages: false, systemDivider: "none" });
      tk.loadData(v.xml);
      const a = notes();
      const mei = tk.getMEI();
      tk.setOptions({ transposeToSoundingPitch: false });
      tk.loadData(mei.replace(/<scoreDef\b/, '<scoreDef ending.rend="top"'));
      const b = notes(), d = drawn();
      const ids = Object.keys(a);
      return { n: ids.length, diff: ids.filter((id) => a[id] !== b[id]).slice(0, 5).map((id) => id + " " + a[id] + " / " + b[id]), trans: /trans\.(semi|diat)/.test(mei), endings: d.endings, cl: [...P.facts.values()].filter((f) => f.part === "P3" && f.tr).length };
    }, fx("pvc-transpose"));
    ok(r.n > 0 && !r.diff.length && !r.trans && r.cl > 0, `E3 pvc-transpose: the MEI at sounding pitch loads the same (${r.n} notes, diffs ${r.diff}, trans.* left ${r.trans}, ${r.cl} transposed facts)`);
    ok(r.endings.length === 2, `E3 pvc-transpose: endings once each (${JSON.stringify(r.endings)})`);
  }

  // ---- E4 a part missing from the part-list
  {
    const r = await page.evaluate(async (urls) => {
      const out = {};
      for (const [name, url, k] of urls) {
        const P = await song(url);
        const v = prep.buildView(P.doc, P.views[k]);
        const d = new DOMParser().parseFromString(v.xml, "application/xml");
        loadView(v, k);
        const dr = drawn();
        const mei = tk.getMEI();
        out[name] = { list: [...d.querySelectorAll("part-list > score-part")].map((x) => x.getAttribute("id")).join(), firstId: dr.firstId, page: tk.getPageWithElement("m10"), verseStaff: Object.keys(dr.syl).join(), firstStaff: /<staffDef\b[^>]*\bn="1"[^>]*>/.exec(mei)?.[0] };
      }
      return out;
    }, [["pv-unlisted", fx("pv-unlisted"), "score"], ["hymn-unlisted", fx("hymn-unlisted"), "both"], ["hymn-unlisted-score", fx("hymn-unlisted"), "score"]]);
    // (a hymn's Both has no words)
    for (const [name, x] of Object.entries(r)) ok(x.list === "P1,P2" && x.firstId === "m0" && x.page >= 1 && x.verseStaff === (name === "hymn-unlisted" ? "" : "1"), `E4 ${name}: part-list ${x.list}, first bar id ${x.firstId}, m10 on page ${x.page}, words on staff ${x.verseStaff}`);
  }

  // ---- E5 / E8 singers' words; E6 choirs; E7 split syllables
  {
    const r = await page.evaluate(async (urls) => {
      const out = {};
      for (const [name, url] of urls) {
        const P = await song(url);
        const sc = P.views.score;
        if (!sc) { out[name] = { views: Object.keys(P.views) }; continue; }
        const v = prep.buildView(P.doc, sc);
        const mei = loadView(v, "score");
        const d = drawn();
        const bv = P.views.both && prep.buildView(P.doc, P.views.both);
        const bmei = bv ? loadView(bv, "both") : "";
        // (each staffGrp: its grpSym's symbol, bar.thru)
        const grp = (m) => [...m.matchAll(/<staffGrp\b([^>]*)>\s*(?:<grpSym\b[^>]*\bsymbol="(\w+)")?/g)].map((g) => (g[2] || "-") + (/bar\.thru="true"/.test(g[1]) ? "+thru" : ""));
        const xd = new DOMParser().parseFromString(v.xml, "application/xml");
        const lyrOn = {};
        for (const l of xd.querySelectorAll("lyric")) { const n = l.parentElement; const k = n.closest("part").getAttribute("id") + "|s" + (n.querySelector(":scope > staff")?.textContent || "1") + "|v" + (n.querySelector(":scope > voice")?.textContent || "1"); lyrOn[k] = (lyrOn[k] || 0) + 1; }
        out[name] = { plan: { sung: sc.sung, words: sc.words, low: sc.low, parts: sc.parts }, syl: d.syl, dashHits: d.dashHits, sys: d.sys, grp: grp(mei), bgrp: grp(bmei), lyrOn,
          syll: [...xd.querySelectorAll("lyric")].map((l) => l.querySelector("text").textContent + ":" + l.querySelector("syllabic").textContent + ":v" + (l.parentElement.querySelector(":scope > voice")?.textContent || "1")).slice(0, 4).concat([...xd.querySelectorAll("measure")].slice(6, 7).flatMap((m) => [...m.querySelectorAll("lyric")].map((l) => l.querySelector("text").textContent + ":" + l.querySelector("syllabic").textContent + ":v" + (l.parentElement.querySelector(":scope > voice")?.textContent || "1")))) };
      }
      return out;
    }, [["duet-2staves", fx("duet-2staves")], ["duet-parts", fx("duet-parts")], ["satb-open", fx("satb-open")], ["satbp", fx("satbp")], ["split-syll", fx("split-syll")], ["hymn-copy", fx("hymn-copy")], ...(owner("longest") ? [["longest", owner("longest")]] : [])]);
    const d2 = r["duet-2staves"];
    ok(d2.plan.words && d2.plan.words.staff === null && d2.syl["1"] > 0 && d2.syl["2"] > 0 && [].concat(d2.plan.sung || []).join() === "P1", `E5 duet-2staves: both vocal staves keep their words (${JSON.stringify(d2.syl)}; words ${JSON.stringify(d2.plan.words)})`);
    const dp = r["duet-parts"];
    ok([].concat(dp.plan.sung || []).join() === "P1,P2" && (dp.plan.words.also || []).join() === "P2" && !dp.plan.low.includes("P2|1") && dp.syl["1"] > 0 && dp.syl["2"] > 0 && !dp.syl["3"] && !dp.syl["4"], `E8 duet-parts: both singers sung, with words; the baritone read from the top (${JSON.stringify(dp.plan)}; ${JSON.stringify(dp.syl)})`);
    const so = r["satb-open"];
    ok(so.grp.includes("bracket+thru") && JSON.stringify(so.grp) === JSON.stringify(so.bgrp), `E6 satb-open: the choir's bracket and barlines kept as Both (${so.grp} vs ${so.bgrp})`);
    const sp = r.satbp;
    ok(sp.grp.includes("bracket+thru") && sp.grp.includes("brace+thru") && sp.sys.some((s) => !s.includes("2")) && sp.sys.every((s) => s.includes("5") === s.includes("6")), `E6 satbp: bracket kept, piano braced, the resting alto left out of a system (${sp.grp}; ${sp.sys.join(" ")})`);
    const ss = r["split-syll"];
    ok(ss.lyrOn["P1|s1|v2"] === 1 && !ss.dashHits.length, `E7 split-syll: the chord's syllables on the tune, one left (${JSON.stringify(ss.lyrOn)}), no hyphen through a syllable (${ss.dashHits})`);
    ok(ss.syll.slice(0, 4).join() === "For:single:v1,the:single:v1,long:begin:v1,est:end:v1" && ss.syll.slice(4).join() === "won:single:v1,ful:end:v1,so:single:v1,der:end:v2", `E7 split-syll: words joined on the tune, hyphens either side of the one left go (${ss.syll})`);
    const hc = r["hymn-copy"];
    ok(hc.lyrOn["P1|s1|v1"] === 36 && hc.lyrOn["P1|s1|v2"] === 48 && hc.syll.slice(0, 4).join() === "Glo:begin:v1,to:single:v1,God:single:v1,Glo:begin:v2", `E7 hymn-copy: the alto's copy of the words left alone (${JSON.stringify(hc.lyrOn)}; ${hc.syll.slice(0, 4)})`);
    if (r.longest) ok(!r.longest.dashHits.length && (r.longest.lyrOn["P1|s1|v2"] || 0) <= 2, `E7 longest: no hyphen through a syllable (${r.longest.dashHits.slice(0, 6)}), ${JSON.stringify(r.longest.lyrOn)}`);
  }
  for (const e of errors) ok(false, "E pageerror " + e);
  await page.close();
}

// ---------------------------------------------------------------------------------------------
// F: the review fixes in play.html
//   F1 a size chosen with − / + in landscape: a spread only when each page holds ≥ 110 staff spaces (v79)
//   F2 Piano Man's 4-staff systems never run past the stage (largest size + allows; a phone)
//   F3 a 375-px stage: the two-system fallback is checked (Piano Man)
//   F4 a rotation back to a page size seen before lays the score out once (Piano Man)
//   F5 a transposing part: endings once
//   F6 a part missing from the part-list: the place kept across views
//   F7 a second singer (own part, or the second staff of a singers' part): the voice's colour
//   F8 The Longest Time: no hyphen through a syllable on the iPad sizes
async function stageInk(page) {
  return page.evaluate(() => {
    const st = document.getElementById("stage").getBoundingClientRect();
    return [...document.querySelectorAll("#stage g.staff, #stage g.note, #stage g.dynam, #stage g.verse, #stage g.hairpin, #stage g.dir")].filter((e) => { const b = e.getBoundingClientRect(); return b.width && b.bottom > st.bottom + 1; }).map((e) => e.getAttribute("class") + " +" + Math.round(e.getBoundingClientRect().bottom - st.bottom)).slice(0, 4);
  });
}
async function everyPage(page, fn) {
  await page.evaluate(() => { for (let i = 0; i < 400 && window.resonateDebug().play.page > 1; i++) window.__key("ArrowLeft"); });
  const out = [];
  for (let guard = 0; guard < 400; guard++) {
    out.push(await fn());
    const before = (await D(page)).page;
    await page.evaluate(() => window.__key("ArrowRight"));
    if ((await D(page)).page === before) break;
  }
  await page.evaluate(() => { for (let i = 0; i < 400 && window.resonateDebug().play.page > 1; i++) window.__key("ArrowLeft"); });
  return out;
}
async function partF(browser) {
  console.log("== F review fixes: play.html");
  const errors = [];
  const fx2 = (names) => names.map((n) => ({ name: n, xml: read(path.join(FIX2, n + ".musicxml")) }));
  // ---- F1 spreads after − / +
  for (const [dev, w, h, btn] of [["mini-l", 1133, 744, "#bigger"], ["air-l", 1180, 820, "#smaller"], ["pro-l", 1376, 1032, "#smaller"]]) {
    const { ctx, page } = await newPage(browser, w, h, errors);
    const names = ["score-pvg", ...OWNER.filter((n) => /wichita|killing/.test(n))];
    const ids = await seed(page, songList(names));
    for (const name of names) {
      await page.evaluate(() => localStorage.removeItem("resonate.play.zoom.score"));
      await openSong(page, ids[name], "score");
      await page.reload(); await ready(page, ids[name], "score");
      if (await page.isDisabled(btn)) { info(`F1 ${dev} ${name}: ${btn} disabled`); continue; }
      const d0 = await D(page);
      await page.click(btn); await ready(page, null, "score");
      const d = await D(page);
      const across = (d.spread ? d.W / 2 : d.W) / d.sp;
      ok(!d.spread || across >= 110 - 0.5, `F1 ${dev} ${name}: ${btn} → ${d.sp} px, ${d.spread ? "spread" : "one page"} ${Math.round(across)} staff spaces a page (from ${d0.sp}, ${d0.spread ? "spread" : "one page"})`);
    }
    await page.evaluate(() => localStorage.removeItem("resonate.play.zoom.score"));
    await ctx.close();
  }
  if (OWNER.includes("pianoman")) {
    // ---- F2 nothing past the stage: + up to the largest size it allows (Air landscape), a phone
    // (mini: − then + up to the largest: v78's first build reached 15.08 px that way, + disabled at 14)
    for (const [dev, w, h, plus] of [["air-l", 1180, 820, "+"], ["mini-l", 1133, 744, "-+"], ["phone-l", 844, 390, ""]]) {
      const { ctx, page } = await newPage(browser, w, h, errors);
      const ids = await seed(page, songList(["pianoman"]));
      await openSong(page, ids.pianoman, "score");
      if (plus.includes("-") && !(await page.isDisabled("#smaller"))) { await page.click("#smaller"); await ready(page, null, "score"); }
      if (plus.includes("+")) for (let i = 0; i < 6 && !(await page.isDisabled("#bigger")); i++) { await page.click("#bigger"); await ready(page, null, "score"); }
      const d = await D(page);
      const bad = (await everyPage(page, () => stageInk(page))).map((x, i) => x.length ? `p${i + 1}: ${x.join(" ")}` : "").filter(Boolean);
      ok(!bad.length, `F2 pianoman ${dev} at ${d.sp} px (${d.pages} pages): ink past the stage ${bad.slice(0, 4).join(" | ")}`);
      await ctx.close();
    }
    // ---- F3 375 px wide
    {
      const { ctx, page } = await newPage(browser, 375, 812, errors);
      const ids = await seed(page, songList(["pianoman"]));
      await openSong(page, ids.pianoman, "score");
      const { rows, d } = await pagesOf(page);
      const one = (rows.length > 1 ? rows.slice(0, -1) : rows).filter((r) => r.n < 2).length / Math.max(1, rows.length - 1);
      ok(d.fitLog.length >= 1 && one < 0.25, `F3 pianoman 375x812: ${d.sp} px, ${d.pages} pages, ${Math.round(100 * one)}% with one system (tried ${JSON.stringify(d.fitLog)})`);
      await ctx.close();
    }
    // ---- F4 a page size seen before: laid out once
    {
      const { ctx, page } = await newPage(browser, 820, 1180, errors);
      const ids = await seed(page, songList(["pianoman"]));
      await openSong(page, ids.pianoman, "score");
      const turn = async (w, h) => { await page.setViewportSize({ width: w, height: h }); await sleep(600); await ready(page); return D(page); };
      const l1 = await turn(1180, 820);
      await turn(820, 1180);
      const l2 = await turn(1180, 820);
      ok(l1.fitLog.length >= 1 && l2.fitLog.length <= 1 && l2.sp === l1.sp && l2.pages === l1.pages, `F4 pianoman: landscape again lays out once (first ${JSON.stringify(l1.fitLog)} → ${l1.sp} px ${l1.pages} pages; again ${JSON.stringify(l2.fitLog)} → ${l2.sp} px ${l2.pages} pages)`);
      await ctx.close();
    }
  }
  // ---- F5 transposed: endings once (as B1)
  {
    const { ctx, page } = await newPage(browser, 820, 1180, errors);
    const ids = await seed(page, fx2(["pvc-transpose", "pv-unlisted", "duet-parts", "duet-2staves"]));
    await openSong(page, ids["pvc-transpose"], "score");
    const labels = (await everyPage(page, () => page.evaluate(() => [...document.querySelectorAll("#stage g.ending")].map((e) => [...e.querySelectorAll("text")].map((t) => t.textContent.trim()).join("|"))))).flat();
    ok(labels.length === 2 && labels.every((l) => !l.includes("|")), `F5 pvc-transpose: endings once each ${JSON.stringify(labels)}`);
    const all = await page.evaluate(() => window.resonateDebug().play.countAll());
    ok(all.rendered === all.pitched, `F5 pvc-transpose: every note drawn ${all.rendered}/${all.pitched}`);
    // ---- F6 the place, a part missing from the part-list
    await openSong(page, ids["pv-unlisted"], "score");
    for (let i = 0; i < 2; i++) await page.evaluate(() => window.__key("ArrowRight"));
    await sleep(150);
    const s0 = await D(page);
    await setView(page, "both");
    const b = await D(page);
    const onScreen = await page.evaluate((at) => [...document.querySelectorAll("#stage .page g.measure")].some((g) => g.id === "m" + at), s0.at);
    await setView(page, "score");
    const s1 = await D(page);
    ok(s0.at > 0 && onScreen && s1.page === s0.page && b.at === s0.at, `F6 pv-unlisted: the place ${s0.at} (page ${s0.page}) → Both page ${b.page} shows it ${onScreen} → back on page ${s1.page}`);
    // ---- F7 the second singer's strip colour
    const cdp = await ctx.newCDPSession(page);
    for (const [name, pred] of [["duet-parts", "f.part === 'P2'"], ["duet-2staves", "f.part === 'P1' && f.staff === 2"]]) {
      await openSong(page, ids[name], "score");
      const h = await page.evaluate((src) => {
        const pred = new Function("f", "return " + src), F = window.resonateDebug().play.facts;
        for (const g of document.querySelectorAll("#stage g.note")) { const f = F[g.id], hd = g.querySelector(":scope > g.notehead"); if (f && hd && pred(f)) { const r = hd.getBoundingClientRect(); if (r.width) return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; } }
        return null;
      }, pred);
      if (!h) { ok(false, `F7 ${name}: no note`); continue; }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: h.x, y: h.y }] });
      await page.waitForFunction(() => window.resonateDebug().play.peek, null, { timeout: 4000 }).catch(() => {});
      await sleep(250);
      const pk = await page.evaluate(() => { const p = window.resonateDebug().play.peek; return p && { lit: p.lit, fills: [...document.querySelectorAll("#strip rect.lit")].map((r) => getComputedStyle(r).fill) }; });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await sleep(2300);
      ok(pk && pk.lit.length && pk.lit.every((l) => l.hand === "voice") && pk.fills.every((f) => f === "rgb(11, 143, 120)"), `F7 ${name}: the second singer lit as the voice ${JSON.stringify(pk)}`);
    }
    await ctx.close();
  }
  // ---- F8 The Longest Time: hyphens
  if (OWNER.includes("longest")) {
    for (const [dev, w, h] of [["mini-p", 744, 1133], ["air-l", 1180, 820]]) {
      const { ctx, page } = await newPage(browser, w, h, errors);
      const ids = await seed(page, songList(["longest"]));
      await openSong(page, ids.longest, "score");
      const hits = (await everyPage(page, () => page.evaluate(() => {
        const out = [];
        for (const svg of document.querySelectorAll("#stage .page > svg")) {
          const syls = [], dashes = [];
          for (const g of svg.querySelectorAll("g.syl")) {
            const t = g.querySelector("text");
            if (t && t.textContent.trim()) { const b = t.getBoundingClientRect(); syls.push({ t: t.textContent.trim(), x0: b.left, x1: b.right, y0: b.top, y1: b.bottom }); }
            for (const r of g.querySelectorAll(":scope > rect")) { const b = r.getBoundingClientRect(); dashes.push({ o: t?.textContent.trim() || "", x0: b.left, x1: b.right, y: (b.top + b.bottom) / 2 }); }
          }
          for (const d of dashes) for (const s of syls) if (d.y >= s.y0 && d.y <= s.y1 && Math.min(d.x1, s.x1) - Math.max(d.x0, s.x0) > 0.5) out.push(d.o + "→" + s.t);
        }
        return out;
      }))).flat();
      ok(!hits.length, `F8 longest ${dev}: ${hits.length} hyphens through a syllable ${hits.slice(0, 6).join(", ")}`);
      await ctx.close();
    }
  }
  // ---- F9 (the review of de820b7) a sparse partner's staff shows in a few systems: the two-a-page
  // fit starts from two systems of the staves most show (3), not of every staff (4) — Songbird's
  // Full score came out ~11% smaller in landscape
  {
    const { ctx, page } = await newPage(browser, 1180, 820, errors);
    const ids = await seed(page, songList(["score-duet-partner"]));
    await openSong(page, ids["score-duet-partner"], "score");
    const d = await D(page);
    const first = d.fitLog?.[0]?.sp, want = Math.min(d.base, d.H / 70);
    ok(first != null && first >= want - 0.02, `F9 score-duet-partner air-l: the fit's first size ${first} (two systems of 3 staves: ≥ ${want.toFixed(2)}; of 4: ${(d.H / 85).toFixed(2)}) → ${d.sp} ${d.mode}`);
    await ctx.close();
  }
  for (const e of errors) ok(false, "F " + e);
}

(async () => {
  const browser = await chromium.launch();
  if (run("A")) await partA(browser);
  if (run("B")) await partB(browser);
  if (run("C")) await partC().catch((e) => ok(false, "C " + e.message));
  if (run("D")) await partD(browser);
  if (run("E")) await partE(browser);
  if (run("F")) await partF(browser);
  await browser.close();
  console.log(`${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
