// Play page modules (public/playprep.js, public/playnames.js) against Verovio, in Chromium:
// for the synthetic fixtures (tools/playfixture.mjs), the bundled Amazing Grace and every
// owner score in PLAY_SCORES (default: the scratchpad's play/scores; skipped when missing),
// every view of planViews → buildView → Verovio → EVERY page rendered → decorate. Asserts no
// dropped notes, labels = facts = the SVG's pitch, the synth-pvg sidecar (ks, ♮, carried ♯,
// tie, Some, .km, ledgers), the view filters, the piano pick and the measure anchors.
// usage: node playunit.cjs   (BASE=http://localhost:8097/resonate/, SHOTS=<dir>)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8097/resonate/";
const SCRATCH = "/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad";
const SCORES = process.env.PLAY_SCORES ?? path.join(SCRATCH, "play/scores");
const SHOTS = process.env.SHOTS || path.join(SCRATCH, "playshots");
const FIX = path.join(__dirname, "fixtures/play");
const VRV_LOCAL = path.join(SCRATCH, "play/node_modules/verovio/dist");
const REPO_VRV = "/home/user/resonate/public/vendor/verovio-6.4.0";

let fails = 0, passes = 0;
// the page's own idea of chord words, re-done here only to report leftovers
const names_chord = (w) => /^[A-G][#b♭]?(m|maj|sus|add)?\d*(\/\s*[A-G][#b♭]?)?$/.test(w.trim()) || /^[xXo0 ]{3,}$/.test(w.trim());
const ok = (c, msg) => { if (c) passes++; else { fails++; console.log("FAIL", msg); } };

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
html,body{margin:0;background:#fdfcf8}
#stage{background:#fdfcf8;color:#111;display:flex;justify-content:center}
#stage .page svg{display:block}
#stage .nn, #stage .km { display:none }
#stage[data-names=all] .nn, #stage[data-names=some] .nn.lv, #stage[data-names=some] .km, #stage .nn.peek { display:inline }
</style></head><body><main id="stage" data-names="all"><div class="page" id="pg"></div></main>
<script type="module">
window.boot = (async () => {
  const V = window.VRV;
  const [{ default: createVerovioModule }, { VerovioToolkit }] = await Promise.all([import(V + "verovio-module.mjs"), import(V + "verovio.mjs")]);
  window.tk = new VerovioToolkit(await createVerovioModule());
  window.prep = await import("/resonate/playprep.js?v=78");
  window.names = await import("/resonate/playnames.js?v=78");
  window.fix = await import("/resonate/omr/fixscore.js?v=78");
  return true;
})();
</script></body></html>`;

// What the page sees for one score: every view, every page (runs in the browser).
async function runScore(page, { url, layout }) {
  return page.evaluate(async ({ url, layout }) => {
    await window.boot;
    const out = { views: {}, errors: [] };
    let xml = await (await fetch(url)).text();
    if (/<software>\s*Audiveris/.test(xml.slice(0, 4000))) { const r = fix.fixOmrScore(xml); xml = r.xml; out.fixChanges = r.changes; }
    const t0 = performance.now();
    const P = prep.prepare(xml);
    out.prepMs = Math.round(performance.now() - t0);
    out.parts = P.parts;
    out.title = P.doc.querySelector("movement-title")?.textContent || "";
    out.software = P.doc.querySelector("identification > encoding > software")?.textContent || "";
    out.credits = [...P.doc.querySelectorAll("credit-words")].map((c) => c.textContent).join(" | ").slice(0, 400);
    out.plans = P.views;
    // doc order of pitched notes per (part, mi, staff), for the sidecar
    out.order = [];
    for (const n of P.doc.getElementsByTagName("note")) if (n.querySelector("pitch")) out.order.push(n.getAttribute("id"));
    out.facts = Object.fromEntries(P.facts);
    const ACC = { "-2": "𝄫", "-1": "♭", "1": "♯", "2": "𝄪" };
    const label = (step, alter, nat) => step + (nat ? "♮" : ACC[String(alter)] || "");
    const ACCID = { s: 1, f: -1, ss: 2, x: 2, ff: -2, n: 0 };
    const stage = document.getElementById("stage"), pg = document.getElementById("pg");
    for (const [key, plan] of Object.entries(P.views)) {
      const t1 = performance.now();
      const v = prep.buildView(P.doc, plan);
      const R = { pitched: v.pitched, buildMs: Math.round(performance.now() - t1), rendered: 0, pages: 0, bad: [], ids: [], measures: [], missingMeasures: [], decorateMs: [], labels: {}, ledgers: {}, cls: {}, disp: { all: 0, some: 0, off: 0, someBad: 0, allBad: 0, offBad: 0, kmShown: 0 }, anchors: new Set(), staffCount: 0, brace: false, lyricsInXml: 0 };
      const vd = new DOMParser().parseFromString(v.xml, "application/xml");
      R.harmony = vd.getElementsByTagName("harmony").length;
      R.credit = vd.getElementsByTagName("credit").length;
      R.lyricsInXml = vd.getElementsByTagName("lyric").length;
      // where the words are (part|staff) and which syllables; the endings per part; the groups
      R.lyricHome = [...new Set([...vd.getElementsByTagName("lyric")].map((l) => l.closest("part").getAttribute("id") + "|" + (l.parentElement.querySelector(":scope > staff")?.textContent || "1")))];
      R.lyricTexts = [...new Set([...vd.querySelectorAll("lyric > text")].map((t) => t.textContent))];
      R.lyricNumbers = [...new Set([...vd.getElementsByTagName("lyric")].map((l) => l.getAttribute("number") || "1"))];
      R.endingsXml = Object.fromEntries([...vd.querySelectorAll("part")].map((pt) => [pt.getAttribute("id"), pt.querySelectorAll("barline > ending").length]));
      R.groupsXml = [...vd.querySelectorAll("part-list > part-group[type=start] > group-symbol")].map((g) => g.textContent);
      R.partsXml = [...vd.querySelectorAll("part")].map((pt) => pt.getAttribute("id"));
      R.keys = [...vd.querySelectorAll("part > measure")].filter((m) => m.querySelector("attributes > key")).map((m) => m.getAttribute("id"));
      R.wedges = [...vd.querySelectorAll("wedge")].map((w) => w.closest("measure").getAttribute("id") + ":" + w.getAttribute("type"));
      R.partNames = [...vd.querySelectorAll("score-part > part-name")].map((n) => n.textContent);
      R.partGroups = vd.querySelectorAll("part-list > part-group").length;
      R.forwards = [...vd.getElementsByTagName("forward")].map((f) => f.querySelector("voice")?.textContent);
      // a forward in a voice with no note of its own in that measure adds a layer of spaces
      R.foreign = [];
      for (const m of vd.querySelectorAll("part > measure")) {
        const vs = new Set([...m.querySelectorAll(":scope > note > voice")].map((x) => x.textContent));
        for (const f of m.querySelectorAll(":scope > forward")) { const fv = f.querySelector("voice")?.textContent; if (!vs.has(fv)) R.foreign.push(m.getAttribute("id") + ":" + fv); }
      }
      R.words = [...vd.querySelectorAll("direction words")].map((w) => w.textContent.trim());
      R.staves = [...vd.getElementsByTagName("staves")].map((s) => s.textContent);
      R.chordBeams = [...vd.getElementsByTagName("note")].filter((n) => n.querySelector(":scope > chord") && (n.querySelector(":scope > beam") || n.querySelector(":scope > notations > tuplet"))).length;
      tk.setOptions({ header: "none", footer: "none", breaks: "auto", mnumInterval: 0, adjustPageHeight: false,
        svgAdditionalAttribute: ["note@pname", "note@oct", "note@oct.ges", "accid@accid", "accid@accid.ges", "note@staff", "chord@staff", "staff@n"],
        pageMarginLeft: 60, pageMarginRight: 60, pageMarginTop: 40, pageMarginBottom: 20, transposeToSoundingPitch: /<transpose\b/.test(v.xml),
        // (play.js CONDENSE: the full score condenses, no system dividers)
        condense: "auto", condenseFirstPage: false, condenseTempoPages: false, systemDivider: plan.kind === "score" ? "none" : "auto" });
      const sp = Math.min(layout.sp, layout.W / 40, layout.H / (plan.kind === "score" ? 38 + 7.5 * (plan.staves - 3) : 12 * plan.staves));
      const scale = Math.round(sp / 0.18);
      tk.setOptions({ scale, pageWidth: Math.round(layout.W * 100 / scale), pageHeight: Math.round(layout.H * 100 / scale) });
      const t2 = performance.now();
      tk.loadData(v.xml);
      R.loadMs = Math.round(performance.now() - t2);
      R.log = (tk.getLog() || "").split("\n").filter((l) => /error|warning/i.test(l)).slice(0, 6);
      R.pages = tk.getPageCount();
      const seenIds = new Set();
      for (let p = 1; p <= R.pages; p++) {
        pg.innerHTML = tk.renderToSVG(p);
        if (p === 1) { R.staffCount = pg.querySelector("g.measure")?.querySelectorAll(":scope > g.staff").length || 0; R.brace = !!pg.querySelector("g.grpSym, g.brace"); R.lyricsRendered = pg.querySelectorAll("g.verse, g.syl").length; }
        R.endingsDrawn = (R.endingsDrawn || 0) + pg.querySelectorAll("g.ending").length;
        R.dividers = (R.dividers || 0) + pg.querySelectorAll("g.systemDivider, g.divLine").length;
        for (const sy of pg.querySelectorAll("g.system")) (R.sysStaves ||= []).push([...sy.querySelector("g.measure").querySelectorAll(":scope > g.staff")].map((st) => st.getAttribute("data-n")).join(""));
        // words drawn: the staves (data-n) that carry a verse
        for (const vv of pg.querySelectorAll("g.verse")) (R.verseStaves ||= new Set()).add(vv.closest("g.staff")?.getAttribute("data-n"));
        for (const m of pg.querySelectorAll("g.measure")) R.measures.push(m.id);
        const d = names.decorate(pg, P.facts, { low: plan.low });
        R.decorateMs.push(d.ms);
        // Some's floor: on a page the rule leaves < 15% named, the first chord of each bar per
        // staff gets one name (top note on a bar's first staff, bass note on the others)
        {
          const rule = (it) => { const f = P.facts.get(it.id); return !!f && (it.ledgers >= 2 || f.acc === "printed" || f.acc === "carried" || f.nat); };
          const live = d.items.filter((it) => it.w);
          if (live.length && live.filter(rule).length < 0.15 * live.length) {
            const by = new Map();
            for (const it of live) (by.get(it.staff) || by.set(it.staff, []).get(it.staff)).push(it);
            for (const [st, list] of by) {
              // (the first chord by the score's time; a unison head named for both voices)
              const timed = list.filter((it) => { const f = P.facts.get(it.id); return f && Number.isFinite(f.onset) && !f.grace; });
              let first;
              if (timed.length) { const t0 = Math.min(...timed.map((it) => P.facts.get(it.id).onset)); first = timed.filter((it) => P.facts.get(it.id).onset < t0 + 1e-6); }
              else { const x0 = Math.min(...list.map((it) => it.cx - it.w / 2)); first = list.filter((it) => it.cx - it.w / 2 <= x0 + 0.5 * it.w); }
              // (the tune's and the right hand's staff: its top note; the left hand's / a bass part's:
              // its bass note — by the score's part and staff, not the system's first staff)
              const own = list.find((it) => it.home === st && P.facts.get(it.id));
              const lowSet = new Set(plan.low || []);
              const top = own ? !lowSet.has(P.facts.get(own.id).part + "|" + P.facts.get(own.id).staff) : st === st.parentNode.querySelector(":scope > g.staff");
              const pick = first.reduce((a, b) => ((top ? b.cy < a.cy : b.cy > a.cy) ? b : a));
              for (const it of list) if (it === pick || (Math.abs(it.cx - pick.cx) < 0.3 * Math.max(it.w, pick.w) && Math.abs(it.cy - pick.cy) < 0.15 * Math.max(it.h, pick.h))) R.anchors.add(it.id);
            }
          }
        }
        const heads = [...pg.querySelectorAll("g.note")].filter((g) => g.querySelector(":scope > g.notehead") && g.getAttribute("visibility") !== "hidden"); // (the full score's invisible place-keepers aside)
        R.rendered += heads.length;
        for (const it of d.items) {
          const g = it.g, id = g.id;
          seenIds.add(id);
          R.ids.push(id);
          const f = P.facts.get(id);
          if (!f) { R.bad.push(id + ": no fact"); continue; }
          // badge text = label from the fact
          const txt = it.badge?.querySelector("text")?.textContent;
          if (txt !== label(f.step, f.alter, f.nat)) R.bad.push(`${id}: badge ${txt} ≠ ${label(f.step, f.alter, f.nat)}`);
          // fact = SVG
          const ac = g.querySelector("g.accid");
          const a = ac ? ac.getAttribute("data-accid") || ac.getAttribute("data-accid.ges") : null;
          const salter = a ? ACCID[a] ?? 99 : 0;
          const soct = Number(g.getAttribute("data-oct.ges") ?? g.getAttribute("data-oct"));
          if ((g.getAttribute("data-pname") || "").toUpperCase() !== f.step || salter !== Math.round(f.alter) || soct !== f.oct)
            R.bad.push(`${id}: svg ${g.getAttribute("data-pname")}${a || ""}${soct} ≠ fact ${f.step}${f.alter}${f.oct} (${f.acc})`);
          R.labels[id] = txt;
          R.ledgers[id] = it.ledgers;
          R.cls[id] = { lv: it.badge.classList.contains("lv"), km: !!g.querySelector(":scope > .km"), blocked: it.badge.getAttribute("data-km") === "blocked", ks: !!it.badge.querySelector(".ks"), h: it.badge.classList.contains("nb-h"), anchor: R.anchors.has(id) };
        }
        // computed display per level
        for (const lvl of ["all", "some", "off"]) {
          stage.dataset.names = lvl;
          for (const it of d.items) {
            const shown = getComputedStyle(it.badge).display !== "none";
            const lv = it.badge.classList.contains("lv");
            const want = lvl === "all" || (lvl === "some" && lv);
            if (shown !== want) R.disp[lvl + "Bad"]++;
            if (shown) R.disp[lvl]++;
            if (it.km && lvl === "some" && getComputedStyle(it.km).display !== "none") R.disp.kmShown++;
            if (it.km && lvl !== "some" && getComputedStyle(it.km).display !== "none") R.disp.someBad++;
          }
        }
        stage.dataset.names = "all";
      }
      R.missing = v.ids.filter((id) => !seenIds.has(id)).slice(0, 10);
      R.missingCount = v.ids.filter((id) => !seenIds.has(id)).length;
      R.extra = [...seenIds].filter((id) => !v.ids.includes(id)).slice(0, 10);
      R.present = v.measures;
      R.missingMeasures = v.measures.filter((mi) => !R.measures.includes("m" + mi)).slice(0, 10);
      R.anchor = v.measures.filter((_, i) => i % 7 === 0).map((mi) => [mi, tk.getPageWithElement("m" + mi)]);
      R.fmaa = [0, 1, 2, 3, 4, 5].map((mi) => v.firstMeasureAtOrAfter(mi));
      R.decorateMs = Math.max(...R.decorateMs);
      delete R.ids; R.idsN = seenIds.size;
      R.renderedIds = [...seenIds];
      R.anchors = R.anchors.size;
      R.verseStaves = [...(R.verseStaves || [])];
      out.views[key] = R;
    }
    return out;
  }, { url, layout });
}

async function shot(page, { url, view = "both", layout, pageNo = 1, measure = null, names = "all", file, clip }) {
  await page.evaluate(async ({ url, view, layout, pageNo, measure, names }) => {
    await window.boot;
    let xml = await (await fetch(url)).text();
    if (/<software>\s*Audiveris/.test(xml.slice(0, 4000))) xml = fix.fixOmrScore(xml).xml;
    const P = prep.prepare(xml);
    const plan = P.views[view];
    const v = prep.buildView(P.doc, plan);
    const sp = Math.min(layout.sp, layout.W / 40, layout.H / (12 * plan.staves));
    const scale = Math.round(sp / 0.18);
    tk.setOptions({ header: "none", footer: "none", breaks: "auto", mnumInterval: 0, adjustPageHeight: false,
      svgAdditionalAttribute: ["note@pname", "note@oct", "note@oct.ges", "accid@accid", "accid@accid.ges", "note@staff", "chord@staff", "staff@n"],
      pageMarginLeft: 60, pageMarginRight: 60, pageMarginTop: 40, pageMarginBottom: 20,
      scale, pageWidth: Math.round(layout.W * 100 / scale), pageHeight: Math.round(layout.H * 100 / scale) });
    tk.loadData(v.xml);
    const pg = document.getElementById("pg");
    if (measure != null) pageNo = tk.getPageWithElement("m" + v.firstMeasureAtOrAfter(measure)) || 1;
    pg.innerHTML = tk.renderToSVG(pageNo);
    const svg = pg.querySelector("svg");
    svg.setAttribute("width", layout.W); svg.setAttribute("height", layout.H);
    names && window.names.decorate(pg, P.facts);
    document.getElementById("stage").dataset.names = names || "off";
  }, { url, view, layout, pageNo, measure, names });
  await page.screenshot({ path: path.join(SHOTS, file), clip });
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const vrvDir = fs.existsSync(path.join(REPO_VRV, "verovio-module.mjs")) ? null : VRV_LOCAL;
  const VRV = vrvDir ? "/__vrv/" : "/resonate/vendor/verovio-6.4.0/";
  console.log("verovio from", vrvDir ? vrvDir : REPO_VRV);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console " + m.text().slice(0, 200)); });
  const origin = new URL(BASE).origin;
  await page.route(origin + "/__playunit.html", (r) => r.fulfill({ contentType: "text/html", body: PAGE.replace("window.boot", `window.VRV = ${JSON.stringify(VRV)}; window.boot`) }));
  await page.route(origin + "/__vrv/*", (r) => r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(VRV_LOCAL, path.basename(new URL(r.request().url()).pathname))) }));
  await page.route(origin + "/__fx/*", (r) => r.fulfill({ contentType: "application/xml", body: fs.readFileSync(path.join(FIX, path.basename(new URL(r.request().url()).pathname))) }));
  await page.route(origin + "/__scores/*", (r) => r.fulfill({ contentType: "application/xml", body: fs.readFileSync(path.join(SCORES, decodeURIComponent(path.basename(new URL(r.request().url()).pathname)))) }));
  await page.goto(origin + "/__playunit.html");
  await page.evaluate(() => window.boot);

  const cw = await page.evaluate(() => {
    const yes = ["Ei7/D", "EL/ G", "El77/ G", "Bi7/D", "G/ B", "C/ G", "F/C C Dm7/C", "F(add9)/A", "D/Fﬂ", "G7sus", "F(add2)", "Bb(add9>/D", "Bb(add9)/D", "F/C C Drn/C", "N.C.", "NC.", "xxoo", "x 000", "xcco", "0000", "X X0", "//", "|——4", "Am", "Bb", "Em7"];
    const no = ["Chorus", "Fine", "Coda", "Verse:", "Verse", "sim,", "in 2 ", "Repeat andfade", "Repeat ad lib. to fade", "Interlude", "cresc.", "To Coda I $", "Freely", "Fast three, in one = 58", "Play Fill 5 (2nd time)", "Moderately ", "EURYDICE:", "HADES:", "D.S. al Coda", "Fill 1", "a tempo", "rit.", "Bright rock and roll, in 2", "Gently", "8va bassa throughout"];
    return { yes: yes.filter((t) => !prep.chordWords(t)), no: no.filter((t) => prep.chordWords(t)) };
  });
  ok(!cw.yes.length && !cw.no.length, `chordWords: missed ${cw.yes} · wrongly ${cw.no}`);
  // pure helpers
  const pure = await page.evaluate(() => {
    const N = names, L = { top: 100, bottom: 140, lines: 5 }; // space 10
    const f = (step, alter, oct, acc = null, nat = false) => ({ step, alter, oct, acc, nat });
    return {
      labels: [N.labelOf(f("E", -1, 4, "key")), N.labelOf(f("B", 0, 4, "printed", true)), N.labelOf(f("F", 1, 4, "carried")), N.labelOf(f("C", 2, 5, "printed")), N.labelOf(f("D", -2, 3, "printed")), N.labelOf(f("G", 0, 4))].map((l) => l.text + (l.ks ? "*" : "")).join(" "),
      full: [N.fullName(f("E", -1, 4)), N.fullName(f("G", 0, 4)), N.fullName(f("B", 0, 4, "printed", true)), N.fullName(f("F", 1, 5))].join(" "),
      ledgers: [80, 85, 90, 95, 100, 120, 140, 145, 150, 155, 160, 170].map((cy) => N.ledgersOf(cy, L)).join(","),
      some: [[f("C", 0, 6), 2], [f("A", 0, 5), 1], [f("B", -1, 4, "key"), 0], [f("B", -1, 4, "key"), 2], [f("B", 0, 4, "carried", true), 0], [f("F", 1, 4, "printed"), 0], [f("G", 0, 4), 0]].map(([x, l]) => N.someLevel(x, l)).join(","),
    };
  });
  ok(pure.labels === "E♭* B♮ F♯ C𝄪 D𝄫 G", `labelOf: ${pure.labels}`);
  ok(pure.full === "E♭4 G4 B4 F♯5", `fullName: ${pure.full}`);
  ok(pure.ledgers === "2,1,1,0,0,0,0,0,1,1,2,3", `ledgersOf: ${pure.ledgers}`);
  ok(pure.some === "name,,mark,name,name,name,", `someLevel: ${pure.some}`);
  const layouts = [{ name: "ipad", W: 820, H: 1080, sp: 16 }, { name: "desk", W: 1280, H: 800, sp: 12.5 }];
  const scores = [
    { name: "synth-pvg", url: "/__fx/synth-pvg.musicxml" },
    { name: "synth-longest", url: "/__fx/synth-longest.musicxml" },
    { name: "synth-voice", url: "/__fx/synth-voice.musicxml" },
    { name: "score-pvg", url: "/__fx/score-pvg.musicxml" },
    { name: "score-duet", url: "/__fx/score-duet.musicxml" },
    { name: "score-guitar", url: "/__fx/score-guitar.musicxml" },
    { name: "score-tunein", url: "/__fx/score-tunein.musicxml" },
    { name: "amazing-grace", url: BASE + "songs/amazing-grace.musicxml" },
  ];
  if (SCORES && fs.existsSync(SCORES)) for (const f of fs.readdirSync(SCORES).filter((f) => f.endsWith(".musicxml") && !/amazing/i.test(f))) scores.push({ name: f.replace(/\.musicxml$/, ""), url: "/__scores/" + encodeURIComponent(f), owner: true });
  const side = JSON.parse(fs.readFileSync(path.join(FIX, "synth-pvg.json"), "utf8"));

  const fb = await page.evaluate(async () => {
    let xml = await (await fetch("/__fx/synth-pvg.musicxml")).text();
    const P = prep.prepare(xml); const v = prep.buildView(P.doc, P.views.both);
    tk.setOptions({ header: "none", footer: "none", breaks: "auto", svgAdditionalAttribute: ["note@pname", "note@oct", "note@oct.ges", "accid@accid", "accid@accid.ges", "note@staff", "chord@staff", "staff@n"], scale: 70, pageWidth: 1500, pageHeight: 2000 });
    tk.loadData(v.xml);
    const pg = document.getElementById("pg"); let diff = [], n = 0, again = 0;
    for (let p = 1; p <= tk.getPageCount(); p++) {
      pg.innerHTML = tk.renderToSVG(p);
      const d = names.decorate(pg, new Map());
      again += names.decorate(pg, P.facts).heads;
      for (const it of d.items) { n++; const want = names.labelOf(P.facts.get(it.id)).text, got = it.badge.querySelector("text").textContent; if (want !== got) diff.push(it.id + ":" + got + "≠" + want); }
    }
    return { n, diff, again };
  });
  ok(fb.n === 250 && !fb.diff.length, `SVG fallback labels: ${fb.diff.length}/${fb.n} differ ${fb.diff.slice(0, 6)}`);
  ok(fb.again === 0, `decorate twice draws ${fb.again} more badges`);
  const summary = [];
  for (const s of scores) {
    for (const layout of layouts) {
      const t0 = Date.now();
      const r = await runScore(page, { url: s.url, layout });
      const tag = `${s.name}@${layout.name}`;
      // ---- general, every view
      for (const [k, R] of Object.entries(r.views)) {
        ok(R.rendered === R.pitched, `${tag} ${k}: rendered ${R.rendered} ≠ pitched ${R.pitched} (missing ${R.missingCount}: ${R.missing.join(",")}; extra ${R.extra.join(",")}) ${R.log.join(" / ")}`);
        ok(R.missingCount === 0 && !R.extra.length, `${tag} ${k}: ids missing ${R.missing} extra ${R.extra}`);
        ok(!R.bad.length, `${tag} ${k}: ${R.bad.length} bad: ${R.bad.slice(0, 5).join(" | ")}`);
        ok(R.disp.allBad === 0 && R.disp.someBad === 0 && R.disp.offBad === 0 && R.disp.off === 0, `${tag} ${k}: display ${JSON.stringify(R.disp)}`);
        ok(R.harmony === 0 && R.credit === 0, `${tag} ${k}: harmony ${R.harmony} credit ${R.credit}`);
        ok(R.chordBeams === 0, `${tag} ${k}: ${R.chordBeams} chord notes keep beam/tuplet`);
        ok(R.partNames.every((n) => n === ""), `${tag} ${k}: part names ${R.partNames}`);
        ok(!R.foreign.length, `${tag} ${k}: forwards in a voice with no notes there: ${R.foreign.slice(0, 5)}`);
        ok(!R.words.some((w) => names_chord(w)), `${tag} ${k}: chord words left ${R.words.filter(names_chord)}`);
        ok(R.missingMeasures.length === 0, `${tag} ${k}: measures without an element ${R.missingMeasures}`);
        ok(R.anchor.every(([, p]) => p >= 1), `${tag} ${k}: getPageWithElement fails ${JSON.stringify(R.anchor.filter(([, p]) => p < 1))}`);
        const plan = r.plans[k];
        ok(R.renderedIds.every((id) => { const f = r.facts[id]; return f && plan.parts.includes(f.part) && (plan.staff == null || f.staff === plan.staff) && (plan.voice == null || f.voice === plan.voice); }), `${tag} ${k}: a note outside the plan's filter`);
        if (plan.staff != null || plan.voice != null) ok(R.staves.length === 0, `${tag} ${k}: <staves> left ${R.staves}`);
        if (!plan.lyrics) ok(R.lyricsInXml === 0, `${tag} ${k}: lyrics left ${R.lyricsInXml}`);
        const starts = R.wedges.filter((w) => !/:stop$/.test(w)).length, stops = R.wedges.length - starts;
        ok(starts === stops, `${tag} ${k}: unpaired wedges ${R.wedges}`);
        if (plan.staff != null) ok(R.staffCount === 1, `${tag} ${k}: ${R.staffCount} staves per system`);
        if (plan.kind === "score") {
          // words only under the tune's staff; the first system shows every staff; the road map
          // is the top part's (only its endings, drawn once); no system dividers; a grand staff
          // never loses one of its staves to the condensing
          // (the tune's staff — every staff of a singer's own part — and another singer's part)
          const w = plan.words, nst = (pid) => r.parts.find((x) => x.id === pid).staves;
          const homes = new Set([...(w.staff != null ? [w.part + "|" + w.staff] : Array.from({ length: nst(w.part) }, (_, i) => w.part + "|" + (i + 1))), ...(w.also || []).flatMap((pid) => Array.from({ length: nst(pid) }, (_, i) => pid + "|" + (i + 1)))]);
          ok(R.lyricHome.every((h) => homes.has(h)), `${tag} ${k}: words on ${R.lyricHome} (want within ${[...homes]})`);
          ok(R.staffCount === plan.staves, `${tag} ${k}: first system ${R.staffCount} staves ≠ ${plan.staves}`);
          ok(R.partsXml.join() === plan.parts.join(), `${tag} ${k}: parts ${R.partsXml} ≠ ${plan.parts}`);
          if (/audiveris/i.test(r.software)) ok(Object.entries(R.endingsXml).every(([pid, n]) => pid === plan.parts[0] || n === 0), `${tag} ${k}: endings in lower parts ${JSON.stringify(R.endingsXml)}`);
          ok(!R.dividers, `${tag} ${k}: ${R.dividers} system dividers`);
          const grand = []; // staff numbers (data-n) of each multi-staff part
          let n0 = 0;
          for (const pid of plan.parts) { const st = r.parts.find((x) => x.id === pid).staves; if (st > 1) grand.push(Array.from({ length: st }, (_, i) => String(n0 + i + 1))); n0 += st; }
          ok(R.sysStaves.every((sy) => grand.every((g) => g.every((x) => sy.includes(x)) || g.every((x) => !sy.includes(x)))), `${tag} ${k}: a grand staff split: ${R.sysStaves.join(" ")}`);
          ok(plan.condense === (plan.staves >= 3), `${tag} ${k}: condense ${plan.condense} with ${plan.staves} staves`);
          ok(plan.condense ? R.groupsXml.filter((g) => g === "none").length >= 1 : !R.groupsXml.includes("none"), `${tag} ${k}: groups ${R.groupsXml}`);
        }
      }
      // ---- per score
      const V = r.views, P = r.plans;
      if (s.name === "synth-pvg") {
        ok(!r.fixChanges.length, `${tag}: fixOmrScore changed: ${r.fixChanges.join(" / ")}`);
        ok(Object.keys(V).join() === "score,both,rh,lh,melody", `${tag}: views ${Object.keys(V)}`);
        ok(P.score.parts.join() === "P1,P2" && P.score.sung.join() === "P1" && V.score.staffCount === 3 && V.score.lyricsInXml === V.melody.lyricsInXml, `${tag}: Full score P1+P2 with the tune's words (${P.score.parts}, ${V.score.lyricsInXml} words)`);
        ok(P.both.parts.join() === "P2" && V.both.staffCount === 2, `${tag}: Both = ${P.both.parts} with ${V.both.staffCount} staves`);
        ok(P.rh.staff === 1 && P.lh.staff === 2, `${tag}: rh/lh staves`);
        ok(P.melody.parts.join() === "P1" && P.melody.lyrics && V.melody.lyricsInXml > 100 && V.melody.lyricsRendered > 0, `${tag}: Melody = P1 with lyrics (${V.melody.lyricsInXml})`);
        ok(V.both.lyricsInXml === 0, `${tag}: Both has no lyrics`);
        // restated keys at m16/m32 gone; m0 keeps its key
        ok(V.both.keys.join() === "m0" && V.rh.keys.join() === "m0", `${tag}: keys left at ${V.both.keys} / ${V.rh.keys}`);
        ok(!V.both.wedges.some((w) => w.startsWith("m20")) && V.both.wedges.includes("m22:diminuendo") && V.both.wedges.includes("m23:stop"), `${tag}: wedges ${V.both.wedges}`);
        ok(V.rh.forwards.every((v) => v === "1" || v === "2") && V.lh.forwards.every((v) => v === "5" || v === "6"), `${tag}: forwards in foreign voices rh ${V.rh.forwards} lh ${V.lh.forwards}`);
        ok(V.both.partGroups === 0, `${tag}: part-groups ${V.both.partGroups}`);
        // sidecar
        const byKey = {};
        for (const id of r.order) { const f = r.facts[id]; const kk = `${f.part}|${f.mi}|${f.staff}`; (byKey[kk] ||= []).push(id); }
        let checked = 0;
        const viewOf = (e) => (e.part === "P1" ? V.melody : V.both);
        for (const e of side.notes) {
          const id = byKey[`${e.part}|${e.mi}|${e.staff}`]?.[e.k];
          if (!id) { ok(false, `${tag}: no note for ${JSON.stringify(e)}`); continue; }
          const R = viewOf(e), c = R.cls[id];
          if (!c) { ok(false, `${tag}: ${id} not rendered`); continue; }
          const f = r.facts[id];
          ok(R.labels[id] === e.label, `${tag}: m${e.mi} s${e.staff} #${e.k} ${e.p || ""} label ${R.labels[id]} ≠ ${e.label}`);
          ok(R.ledgers[id] === e.ledgers, `${tag}: m${e.mi} s${e.staff} #${e.k} ${e.p || ""} ledgers ${R.ledgers[id]} ≠ ${e.ledgers}`);
          ok(c.lv === (e.some || c.anchor), `${tag}: m${e.mi} s${e.staff} #${e.k} ${e.p || ""} Some ${c.lv} ≠ ${e.some} (${f.acc}${f.nat ? " nat" : ""}${c.anchor ? ", bar anchor" : ""})`);
          // (a mark with no clear side is left out, said on its badge)
          ok(c.km === (e.km && !c.anchor && !c.blocked), `${tag}: m${e.mi} s${e.staff} #${e.k} ${e.p || ""} km ${c.km} ≠ ${e.km}`);
          const wantKs = f.acc === "key" && e.label.length > 1 && !e.label.endsWith("♮");
          ok(c.ks === wantKs, `${tag}: m${e.mi} s${e.staff} #${e.k} ks ${c.ks} ≠ ${wantKs}`);
          // the same in the one-hand view
          const H = e.part === "P2" ? (e.staff === 1 ? V.rh : V.lh) : null;
          if (H) ok(H.labels[id] === e.label && H.cls[id]?.lv === (e.some || H.cls[id]?.anchor) && H.cls[id]?.km === (e.km && !H.cls[id]?.anchor && !H.cls[id]?.blocked), `${tag}: ${id} differs in the ${e.staff === 1 ? "RH" : "LH"} view`);
          checked++;
        }
        ok(checked === side.notes.length, `${tag}: sidecar checked ${checked}/${side.notes.length}`);
        const pc = side.peekChord, ids = pc.k.map((k) => byKey[`${pc.part}|${pc.mi}|${pc.staff}`][k]);
        ok(ids.map((id) => r.facts[id].midi).join() === pc.midis.join(), `${tag}: peek chord midis ${ids.map((id) => r.facts[id].midi)}`);
        // RH only staff 1, LH only staff 2 — and together they are Both
        ok(V.rh.renderedIds.every((id) => r.facts[id].staff === 1) && V.lh.renderedIds.every((id) => r.facts[id].staff === 2) && V.rh.idsN + V.lh.idsN === V.both.idsN, `${tag}: RH ${V.rh.idsN} + LH ${V.lh.idsN} ≠ Both ${V.both.idsN}`);
      }
      if (s.name === "synth-longest") {
        ok(Object.keys(V).join() === "score,both,rh,lh,melody", `${tag}: views ${Object.keys(V)}`);
        // the tune inside the piano: the full score is Both with the tune's words (staff 1)
        ok(P.score.parts.join() === "P1" && P.score.words.staff === 1 && !P.score.sung.length && !P.score.condense, `${tag}: full score plan ${JSON.stringify(P.score)}`);
        ok(V.score.lyricHome.join() === "P1|1" && V.score.idsN === V.both.idsN, `${tag}: Full score = Both + words on staff 1 (${V.score.lyricHome}, ${V.score.idsN}/${V.both.idsN})`);
        ok(P.melody.parts.join() === "P1" && P.melody.staff === 1 && P.melody.voice === "1", `${tag}: melody plan ${JSON.stringify(P.melody)}`);
        ok(V.melody.renderedIds.every((id) => r.facts[id].staff === 1 && r.facts[id].voice === "1") && V.melody.idsN === Object.values(r.facts).filter((f) => f.staff === 1 && f.voice === "1").length, `${tag}: melody ids`);
        // every tune note has its syllable (the 4 given to voice 2's chords moved over)
        ok(V.melody.lyricsInXml === Object.values(r.facts).filter((f) => f.staff === 1 && f.voice === "1").length, `${tag}: melody lyrics ${V.melody.lyricsInXml}`);
        ok(V.melody.forwards.every((v) => v === "1"), `${tag}: melody forwards ${V.melody.forwards}`);
      }
      if (s.name === "synth-voice") {
        ok(Object.keys(V).join() === "both", `${tag}: views ${Object.keys(V)} (hands select hidden)`);
        ok(P.both.lyrics && V.both.lyricsInXml > 0, `${tag}: a voice-only song keeps its words`);
        ok(r.views.both.fmaa.join() === "0,4,4,4,4,5", `${tag}: firstMeasureAtOrAfter ${r.views.both.fmaa}`);
        console.log("   synth-voice measures rendered:", V.both.measures.slice(0, 8).join(","), "· present", V.both.present.slice(0, 6).join(","));
      }
      if (s.name === "amazing-grace") {
        ok(Object.keys(V).join() === "score,both,rh,lh,melody", `${tag}: views ${Object.keys(V)}`);
        // the hymn's full score: braced as Both, verse 1's words under the top staff
        ok(P.score.parts.join() === "P1,P2" && P.score.brace && V.score.partGroups === 2 && V.score.brace && V.score.lyricHome.join() === "P1|1" && V.score.lyricNumbers.length === 1 && !P.score.sung.length && !P.score.condense, `${tag}: hymn full score ${JSON.stringify({ parts: P.score.parts, groups: V.score.partGroups, home: V.score.lyricHome, verses: V.score.lyricNumbers })}`);
        ok(P.both.kind === "hymn" && P.both.parts.join() === "P1,P2" && P.both.brace && V.both.brace && V.both.partGroups === 2 && V.both.staffCount === 2, `${tag}: Both braced P1+P2 (${P.both.kind} ${P.both.parts} brace ${V.both.brace} groups ${V.both.partGroups})`);
        ok(P.rh.parts.join() === "P1" && P.lh.parts.join() === "P2", `${tag}: RH/LH parts`);
        ok(P.melody.parts.join() === "P1" && P.melody.voice === "1" && V.melody.renderedIds.every((id) => r.facts[id].part === "P1" && r.facts[id].voice === "1"), `${tag}: Melody = P1 voice 1`);
        ok(V.both.renderedIds.some((id) => r.facts[id].part === "P1") && V.both.renderedIds.some((id) => r.facts[id].part === "P2"), `${tag}: Both has both parts' ids`);
      }
      if (s.name === "score-pvg") {
        // voice + piano + a guitar that plays (30% of bars) — the 2-note "Voice" P4 left out;
        // words only the tune's (no stray xx/yy/zz/oh), both stanzas; endings only the voice's
        ok(Object.keys(V).join() === "score,both,rh,lh,melody", `${tag}: views ${Object.keys(V)}`);
        ok(P.score.parts.join() === "P1,P2,P3" && P.score.sung.join() === "P1" && P.score.condense && P.score.low.join() === "P2|2", `${tag}: score plan ${JSON.stringify(P.score)}`);
        ok(!V.score.lyricTexts.some((t) => ["xx", "yy", "zz", "oh"].includes(t)) && V.score.lyricNumbers.sort().join() === "1,2", `${tag}: words ${V.score.lyricTexts.slice(0, 12)} stanzas ${V.score.lyricNumbers}`);
        ok(V.score.endingsXml.P2 === 0 && V.score.endingsXml.P1 === 4 && V.score.endingsDrawn === 2, `${tag}: endings ${JSON.stringify(V.score.endingsXml)} drawn ${V.score.endingsDrawn}`);
        // the voice rests through the intro: left out of a system there; the guitar out where it rests
        ok(V.score.sysStaves.some((sy) => !sy.includes("1")) && V.score.sysStaves.some((sy) => !sy.includes("4")), `${tag}: condensed systems ${V.score.sysStaves.join(" ")}`);
      }
      if (s.name === "score-duet") {
        // Songbird's shape: a spurious top part with the road map, the duet, the piano
        ok(P.score.parts.join() === "P2,P3" && P.score.sung.join() === "P2", `${tag}: score parts ${P.score.parts}`);
        ok(V.score.endingsXml.P2 === 4 && V.score.endingsXml.P3 === 0 && V.score.endingsDrawn === 2, `${tag}: endings from the top part ${JSON.stringify(V.score.endingsXml)} drawn ${V.score.endingsDrawn}`);
        ok(V.score.lyricHome.join() === "P2|1" && V.score.idsN === Object.values(r.facts).filter((f) => f.part !== "P1").length, `${tag}: both voices of the duet with words (${V.score.idsN})`);
      }
      if (s.name === "score-guitar") {
        // no piano: Both is the two parts without words; the full score adds the words
        ok(Object.keys(V).join() === "score,both,melody" && P.both.kind === "parts" && P.score.parts.join() === "P1,P2" && !P.score.condense, `${tag}: views ${Object.keys(V)} score ${P.score.parts}`);
        ok(V.score.lyricHome.join() === "P1|1" && !V.score.lyricTexts.includes("ww"), `${tag}: words ${V.score.lyricHome} ${V.score.lyricTexts}`);
      }
      if (s.name === "score-tunein") {
        ok(P.score.parts.join() === "P1" && P.score.words.staff === 1 && V.score.lyricHome.join() === "P1|1" && !V.score.lyricTexts.some((t) => t === "stray" || t === "junk"), `${tag}: words staff 1 only (${V.score.lyricHome} ${V.score.lyricTexts})`);
      }
      if (s.name === "synth-voice") ok(!P.score, `${tag}: a voice-only song has no full score`);
      if (s.owner) {
        const text = (r.title + " " + r.credits).toLowerCase();
        // the full score's parts: the tune's, the piano, any other part that plays
        const wantScore = /killing|wichita/.test(s.name) ? "P1,P2" : /pianoman/.test(s.name) ? "P1,P2,P3" : /songbird/.test(s.name) ? "P2,P3" : /longest/.test(s.name) ? "P1" : null;
        ok(P.score && P.score.parts.join() === wantScore, `${tag}: full score parts ${P.score?.parts} (want ${wantScore})`);
        if (P.score) {
          const home = P.score.words.part + "|" + (P.score.words.staff ?? 1);
          ok(V.score.lyricHome.join() === home, `${tag}: full score words on ${V.score.lyricHome}`);
          // the top part's endings only (Audiveris reads a piano's 8va lines as endings)
          ok(P.score.parts.slice(1).every((pid) => V.score.endingsXml[pid] === 0), `${tag}: lower parts' endings ${JSON.stringify(V.score.endingsXml)}`);
          // (the same endings as Both, which copies the top part's onto the piano)
          ok(V.score.endingsXml[P.score.parts[0]] === V.both.endingsXml[P.both.parts[0]], `${tag}: endings ${JSON.stringify(V.score.endingsXml)} (Both ${JSON.stringify(V.both.endingsXml)})`);
        }
        const want = /killing/.test(text) ? "P2" : /wichita/.test(text) ? "P2" : /piano man/.test(text) ? "P2" : /songbird/.test(text) ? "P3" : /longest/.test(text) ? "P1" : null;
        ok(want && P.both.parts.join() === want, `${tag}: piano pick ${P.both.parts} (want ${want}; ${r.title})`);
        ok(V.rh && V.lh, `${tag}: RH/LH offered`);
        if (/longest/.test(text)) ok(P.melody && P.melody.parts.join() === "P1" && P.melody.staff === 1 && P.melody.voice === "1", `${tag}: Longest Time melody ${JSON.stringify(P.melody)}`);
      }
      for (const [k, R] of Object.entries(V)) if (R.log.length && layout.name === "ipad") console.log(`   verovio log ${s.name} ${k}: ${R.log.slice(0, 3).join(" / ").slice(0, 300)}`);
      const line = Object.entries(V).map(([k, R]) => `${k}:${R.rendered}/${R.pitched} ${R.pages}p load${R.loadMs} dec≤${R.decorateMs} some${R.disp.some}`).join("  ");
      summary.push(`${tag.padEnd(26)} prep ${r.prepMs}ms  ${line}  (${Date.now() - t0} ms)`);
      console.log(summary[summary.length - 1]);
      if (s.owner && layout.name === "ipad") {
        // Some-level share of the piano part (Both)
        const R = V.both; console.log(`   Some names ${R.disp.some}/${R.rendered} = ${Math.round(100 * R.disp.some / R.rendered)}% · marks ${R.disp.kmShown}`);
      }
    }
  }
  // ---- screenshots
  const L = { W: 820, H: 1080, sp: 16 };
  await page.setViewportSize({ width: 820, height: 1080 });
  await shot(page, { url: "/__fx/synth-pvg.musicxml", layout: L, file: "unit-pvg-all.png" });
  await shot(page, { url: "/__fx/synth-pvg.musicxml", layout: L, names: "some", file: "unit-pvg-some.png" });
  await shot(page, { url: "/__fx/synth-pvg.musicxml", layout: L, file: "unit-pvg-zoom.png", clip: { x: 0, y: 0, width: 820, height: 420 } });
  await shot(page, { url: "/__fx/synth-pvg.musicxml", view: "rh", layout: L, pageNo: 2, file: "unit-pvg-rh-p2.png" });
  await shot(page, { url: BASE + "songs/amazing-grace.musicxml", layout: L, file: "unit-hymn.png" });
  await shot(page, { url: "/__fx/synth-longest.musicxml", view: "melody", layout: L, file: "unit-longest-melody.png" });
  const own = scores.filter((s) => s.owner);
  for (const s of own) if (/wichita|songbird/.test(s.name)) await shot(page, { url: s.url, layout: L, file: `unit-${s.name}.png` });
  for (const s of own) if (/songbird/.test(s.name)) await shot(page, { url: s.url, layout: L, measure: 15, file: `unit-${s.name}-m15.png` });
  for (const s of own) if (/longest/.test(s.name)) await shot(page, { url: s.url, view: "melody", layout: L, file: `unit-${s.name}-melody.png` });
  for (const s of own) if (/longest/.test(s.name)) await shot(page, { url: s.url, layout: L, pageNo: 3, names: "some", file: `unit-${s.name}-some.png` });
  console.log("screenshots in", SHOTS);
  for (const e of errors) ok(false, e);
  console.log(`${passes} passed, ${fails} failed`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
