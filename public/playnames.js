// Play page: note names drawn on a rendered Verovio page. A badge (pill) on each notehead,
// spelled as written (B♭ in F, A♯ where one is printed, B♮ where a natural cancels), no octave
// numbers on the page. Levels are one CSS attribute on the stage (no re-render):
//   All: every badge; Some: badges with .lv (≥ 2 ledger lines, a printed or carried
//   accidental, a natural — and on a page that rule leaves nearly bare, one note a bar per
//   staff) and .km marks (a ♭/♯ from the key signature only); Off: none.
export const ACC = { "-2": "𝄫", "-1": "♭", "0": "", "1": "♯", "2": "𝄪" };
const NS = "http://www.w3.org/2000/svg";
const FONT = '-apple-system, system-ui, "Segoe UI", "Apple Symbols", "Segoe UI Symbol", sans-serif';
const INK = "#5e2fb8", PAPER = "#fff", KS_F = "#ffd27a", KS_H = "#b45309";

// → { letter, acc ("♭", "♯", "♮", "𝄪", "𝄫" or ""), text, ks (the accidental is the key's alone) }
export function labelOf(f) {
  const letter = f.step.toUpperCase();
  const acc = f.nat ? "♮" : ACC[String(f.alter)] ?? "";
  return { letter, acc, text: letter + acc, ks: f.acc === "key" && !!acc };
}

// "E♭4": with the octave (the MusicXML sounding octave), for the peek bubble.
export const fullName = (f) => f.step.toUpperCase() + (ACC[String(f.alter)] ?? "") + f.oct;

// A g.staff's lines: its leading horizontal <path d="M0 y L x y"> children → { top, bottom, lines }.
export function staffLines(staff) {
  if (!staff) return null;
  const ys = [];
  for (const c of staff.children) {
    if (c.nodeName.toLowerCase() !== "path") break;
    const m = /^\s*M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*L\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/.exec(c.getAttribute("d") || "");
    if (!m || m[2] !== m[4]) break;
    ys.push(Number(m[2]));
  }
  if (ys.length < 2) return null;
  return { top: Math.min(...ys), bottom: Math.max(...ys), lines: ys.length };
}

// Ledger lines between a head (centre y) and its staff, measured from the drawing — so it
// follows the clef in force, clef changes and an 8va's written position. C6 / A3 in treble = 2.
export function ledgersOf(cy, lines) {
  if (!lines) return 0;
  const { top, bottom } = lines;
  const space = (bottom - top) / ((lines.lines || 5) - 1);
  if (!(space > 0)) return 0;
  return cy < top ? Math.floor((top - cy) / space + 0.05) : cy > bottom ? Math.floor((cy - bottom) / space + 0.05) : 0;
}

// The Some level: "name" (a badge), "mark" (a small key-signature ♭/♯) or null.
export function someLevel(f, ledgers) {
  if (ledgers >= 2 || f.acc === "printed" || f.acc === "carried" || f.nat) return "name";
  if (f.acc === "key" && ACC[String(f.alter)]) return "mark";
  return null;
}

// A fact from the SVG's own attributes (svgAdditionalAttribute note@pname, note@oct(.ges),
// accid@accid(.ges)) for a note the facts map doesn't know.
const ACCID = { s: 1, f: -1, ss: 2, x: 2, ff: -2, n: 0 };
export function factFromSvg(g) {
  const ac = g.querySelector("g.accid");
  const wr = ac?.getAttribute("data-accid") || null, ges = ac?.getAttribute("data-accid.ges") || null;
  const alter = ACCID[wr || ges] ?? 0;
  const step = (g.getAttribute("data-pname") || "c").toUpperCase();
  const oct = Number(g.getAttribute("data-oct.ges") ?? g.getAttribute("data-oct") ?? 4);
  // accid.ges is the key's or an earlier accidental's (the SVG can't tell which); "n" = a natural.
  const code = wr || ges;
  return {
    step, alter, oct, midi: (oct + 1) * 12 + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[step] + alter,
    acc: wr ? "printed" : code === "n" ? "carried" : ges && alter ? "key" : null, nat: code === "n", svg: true,
  };
}

// A transposing part's note as Verovio drew it: Verovio respells a remote sounding key (G♭ major
// → F♯, C♭ → B, an A clarinet's 6♯ → 6♭), so the name follows the drawing. The pitch (MIDI) is
// the fact's; a drawing that disagrees on it isn't used.
export function drawnFact(f, g) {
  const s = factFromSvg(g);
  if (s.midi !== f.midi || (s.step === f.step && s.alter === f.alter && s.oct === f.oct)) return f;
  const code = g.querySelector(":scope > g.accid")?.getAttribute("data-accid") || null;
  return {
    ...f, step: s.step, alter: s.alter, oct: s.oct,
    acc: code ? "printed" : f.acc === "printed" || f.acc === "carried" ? "carried" : s.alter ? "key" : null,
    nat: code ? code === "n" : f.nat && s.step === f.step && s.alter === 0,
  };
}

const el = (name, attrs) => {
  const e = document.createElementNS(NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
};
const f1 = (x) => (Math.round(x * 10) / 10).toString();

// Badges for every notehead of a rendered page (an element holding Verovio's SVG). All boxes
// are read first, then everything is written (one layout pass). Idempotent per page.
// → { heads (badges drawn), ms, items: [{ id, g, fact, cx, cy, h, w, ledgers, some, badge }] }
export function decorate(pageEl, facts = new Map()) {
  const t0 = performance.now();
  const items = [];
  const staffs = new Map();
  for (const g of pageEl.querySelectorAll("g.note")) {
    const head = g.querySelector(":scope > g.notehead");
    if (!head || g.querySelector(":scope > .nn")) continue;
    // A cross-staff note (Verovio's note@staff / chord@staff → data-staff) is drawn on that staff,
    // though it sits in its own staff's group (Killing Me Softly bar 31, Songbird bar 149).
    const home = g.closest("g.staff");
    const xs = g.getAttribute("data-staff") || g.closest("g.chord")?.getAttribute("data-staff");
    const staff = (xs && home && home.getAttribute("data-n") !== xs && home.parentNode.querySelector(`:scope > g.staff[data-n="${xs}"]`)) || home;
    let lines = staffs.get(staff);
    if (lines === undefined) staffs.set(staff, (lines = staffLines(staff)));
    const use = head.querySelector("use");
    const href = use ? use.getAttribute("xlink:href") || use.getAttribute("href") || "" : "";
    const f = facts.get(g.id);
    items.push({ id: g.id, g, head, staff, lines, fact: f ? (f.tr ? drawnFact(f, g) : f) : factFromSvg(g), hollow: /#E0A[0-3]/i.test(href) });
  }
  // Reads.
  for (const it of items) {
    const b = it.head.getBBox();
    it.w = b.width; it.h = b.height; it.cx = b.x + b.width / 2; it.cy = b.y + b.height / 2;
    it.ledgers = ledgersOf(it.cy, it.lines);
    it.some = someLevel(it.fact, it.ledgers);
    it.scale = 1.3;
    // a printed accidental left of the head: the pill stops short of it (the sign it names stays whole)
    const ac = it.w ? it.g.querySelector(":scope > g.accid") : null;
    if (ac && ac.getAttribute("data-accid")) { const a = ac.getBBox(); if (a.width && a.x + a.width < it.cx) it.accR = a.x + a.width; }
  }
  const live = items.filter((it) => it.w);
  const byStaff = new Map();
  for (const it of live) (byStaff.get(it.staff) || byStaff.set(it.staff, []).get(it.staff)).push(it);
  // Some on a page the rule leaves nearly bare (a hymn in a flat key: no ledger notes, no
  // accidentals): one name a bar per staff — the first chord's top note on a bar's first staff,
  // its bass note on the others — so fewer names is still some names. The first chord: the notes
  // at the bar-staff's earliest moment (grace notes aside; a second's head on the far side of the
  // stem and another voice's offset head included), by x only for notes the facts don't know.
  if (live.length && live.filter((it) => it.some === "name").length < 0.15 * live.length) {
    for (const [staff, list] of byStaff) {
      if (!staff) continue;
      const timed = list.filter((it) => Number.isFinite(it.fact.onset) && !it.fact.grace);
      let first;
      if (timed.length) {
        const t0 = Math.min(...timed.map((it) => it.fact.onset));
        first = timed.filter((it) => it.fact.onset < t0 + 1e-6);
      } else {
        const x0 = Math.min(...list.map((it) => it.cx - it.w / 2));
        first = list.filter((it) => it.cx - it.w / 2 <= x0 + 0.5 * it.w);
      }
      const top = staff === staff.parentNode?.querySelector(":scope > g.staff");
      const pick = first.reduce((a, b) => ((top ? b.cy < a.cy : b.cy > a.cy) ? b : a));
      // (a head two voices share: each named — otherwise the later voice's head covers the pill)
      for (const o of list) if (o === pick || (Math.abs(o.cx - pick.cx) < 0.3 * Math.max(o.w, pick.w) && Math.abs(o.cy - pick.cy) < 0.15 * Math.max(o.h, pick.h))) o.some = "name";
    }
  }
  // Dense chords: heads a second or a third apart (on one staff, overlapping in x) get smaller pills.
  for (const list of byStaff.values()) {
    list.sort((a, b) => a.cx - b.cx);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.cx - a.cx >= 1.2 * Math.max(a.w, b.w)) break;
        if (Math.abs(a.cy - b.cy) < 1.3 * Math.max(a.h, b.h)) a.scale = b.scale = 1.05;
      }
    }
  }
  // Heads a second apart stacked at one x (an engraving collision, e.g. C+C♯+D): their pills move
  // apart vertically so both letters show (each still over its own head).
  for (const list of byStaff.values()) {
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.cx - a.cx >= 0.5 * Math.max(a.w, b.w)) break;
        const h = Math.max(a.h, b.h), d = Math.abs(a.cy - b.cy);
        if (d < 0.15 * h || d >= 1.05 * h) continue; // (one head shared by two voices — the same name — or already clear)
        const push = (1.05 * h - d) / 2, [up, lo] = a.cy < b.cy ? [a, b] : [b, a];
        up.dy = Math.min(up.dy || 0, -push);
        lo.dy = Math.max(lo.dy || 0, push);
      }
    }
  }
  placeMarks(live);
  // Writes.
  let heads = 0;
  for (const it of live) {
    const { letter, acc, ks } = labelOf(it.fact);
    const ph = it.h * it.scale, fs = ph * 0.78, pw = acc ? ph * 1.45 : ph;
    const cy = it.cy + (it.dy || 0);
    let L = it.cx - pw / 2;
    const R = it.cx + pw / 2;
    if (it.accR != null) L = Math.min(Math.max(L, it.accR + 0.08 * it.h), R - 1.15 * ph);
    const g = el("g", { class: "nn " + (it.hollow ? "nb-h" : "nb-f") + (it.some === "name" ? " lv" : "") });
    g.appendChild(el("rect", {
      x: f1(L), y: f1(cy - ph / 2), width: f1(R - L), height: f1(ph), rx: f1(ph / 2),
      fill: it.hollow ? PAPER : INK, stroke: it.hollow ? INK : "none", "stroke-width": f1(ph * 0.1),
    }));
    const t = el("text", {
      x: f1((L + R) / 2), y: f1(cy + fs * 0.36), "text-anchor": "middle", "font-size": f1(fs), "font-weight": "700",
      "font-family": FONT, fill: it.hollow ? INK : PAPER, stroke: "none",
    });
    t.textContent = letter;
    if (acc) {
      const s = el("tspan", { "font-size": f1(fs * 0.8) });
      if (ks) { s.setAttribute("class", "ks"); s.setAttribute("fill", it.hollow ? KS_H : KS_F); }
      s.textContent = acc;
      t.appendChild(s);
    }
    g.appendChild(t);
    if (it.some === "mark" && !it.km) g.setAttribute("data-km", "blocked");
    it.g.appendChild(g);
    it.badge = g;
    if (it.some === "mark" && it.km) {
      const k = el("text", {
        class: "km", x: f1(it.km.x), y: f1(it.km.y), "font-size": f1(it.km.size), "font-weight": "700",
        "font-family": FONT, fill: KS_H, stroke: "none", ...(it.km.left ? { "text-anchor": "end" } : {}),
      });
      k.textContent = ACC[String(it.fact.alter)];
      it.g.appendChild(k);
      it.km = k;
    } else it.km = null;
    heads++;
  }
  return { heads, ms: Math.round(performance.now() - t0), items };
}

// The key's ♭/♯ mark (Some): at its own head's height, just right of the head (past its dots and a
// ledger dash), else just left of it — on the side where nothing else is drawn: another head (or
// its name at Some), a printed accidental, a stem or flag, a dot, a rest, a clef, a barline, a
// ledger dash, a tie or a slur, another mark. Neither side clear: no mark (the name is a tap
// away). Above the head it read as the accidental of the note a third up (an E♭–G–B♭ chord's ♭
// by the G), and sat on the note's own stem. → it.km = { x, y, size, left } | null.
const OBSTACLES = "g.accid, g.stem > path, g.flag, g.rest, g.mRest, g.artic, g.clef, g.keySig, g.meterSig, g.dots > *, g.barLine > path, g.ledgerLines > path";
function placeMarks(live) {
  const marked = live.filter((it) => it.some === "mark");
  if (!marked.length) return;
  const areas = new Map(); // g.measure → { boxes, curves }
  const areaOf = (m) => {
    let a = areas.get(m);
    if (a) return a;
    a = { boxes: [], curves: [] };
    if (m) {
      for (const e of m.querySelectorAll(OBSTACLES)) {
        // (a line's box has no width for its stroke: a barline, a stem, a ledger dash; a barline
        // or a stem is kept clear of, not just not crossed)
        const b = e.getBBox(), pad = (Number(e.getAttribute("stroke-width")) || 0) / 2;
        if (b.width > 0 || b.height > 0) a.boxes.push({ x0: b.x - pad, y0: b.y - pad, x1: b.x + b.width + pad, y1: b.y + b.height + pad, e, gap: e.parentNode.matches("g.barLine, g.stem") });
      }
      for (const p of m.querySelectorAll("g.tie > path, g.slur > path")) {
        const b = p.getBBox();
        a.curves.push({ x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height, p });
      }
    }
    areas.set(m, a);
    return a;
  };
  // other heads (an oval in its box: the box's corners are paper), and the name drawn over a head
  // at Some (a pill: rounded ends)
  const heads = live.map((o) => {
    const ph = o.h * o.scale, pw = labelOf(o.fact).acc ? ph * 1.45 : ph;
    return { o, cx: o.cx, cy: o.cy, rx: 0.55 * o.w, ry: 0.55 * o.h, pill: o.some === "name" ? { L: o.cx - pw / 2, R: o.cx + pw / 2, cy: o.cy + (o.dy || 0), r: ph / 2 } : null };
  });
  const placed = [];
  const bars = new Map(); // svg → its g.measure in drawing order
  const measuresOf = (g) => {
    const svg = g.closest("svg");
    let l = bars.get(svg);
    if (!l) bars.set(svg, (l = svg ? [...svg.querySelectorAll("g.measure")] : []));
    return l;
  };
  const ledgerBoxes = new Map();
  const dashes = (staff) => {
    let l = ledgerBoxes.get(staff);
    if (!l) ledgerBoxes.set(staff, (l = staff ? [...staff.querySelectorAll("g.ledgerLines path")].map((p) => p.getBBox()) : []));
    return l;
  };
  for (const it of marked) {
    const ms = it.h, tol = 0.04 * ms;
    const through = dashes(it.staff).filter((b) => b.x < it.cx && b.x + b.width > it.cx && Math.abs(b.y + b.height / 2 - it.cy) < 0.6 * it.h);
    // right: past the head, its dots, a ledger dash through it
    let xr = it.cx + it.w / 2 + 0.12 * it.h;
    const chord = it.g.closest("g.chord");
    for (const dd of [it.g.querySelector(":scope > g.dots"), chord?.querySelector(":scope > g.dots")]) {
      if (dd) for (const e of dd.children) {
        const b = e.getBBox();
        if (b.x > it.cx && Math.abs(b.y + b.height / 2 - it.cy) < 0.75 * it.h) xr = Math.max(xr, b.x + b.width + 0.12 * it.h);
      }
    }
    // (a dash running on past a head of its chord on that side: the mark past it would sit by that
    // head — that side is out)
    const over = (side) => Math.max(0, ...through.map((b) => (side > 0 ? b.x + b.width - (it.cx + it.w / 2) : it.cx - it.w / 2 - b.x)));
    for (const b of through) xr = Math.max(xr, b.x + b.width + 0.08 * it.h);
    let xl = it.cx - it.w / 2 - 0.12 * it.h;
    for (const b of through) xl = Math.min(xl, b.x - 0.08 * it.h);
    const rightOk = over(1) < 0.6 * it.h, leftOk = over(-1) < 0.6 * it.h;
    // the glyph's ink (measured in the page's font), its baseline below the head's centre
    const flat = it.fact.alter < 0, gb = glyphBox(ACC[String(it.fact.alter)]), base = it.cy + (flat ? 0.18 : 0.33) * ms;
    const y0 = base - gb.a * ms, y1 = base + gb.d * ms;
    // (its bar and the bars before and after it in the drawing — a page break's placeholder or a
    // new <g class="system"> can sit between two bars on one line)
    const m = it.g.closest("g.measure"), list = measuresOf(it.g), k = list.indexOf(m);
    const near = [areaOf(m), areaOf(list[k - 1] || null), areaOf(k >= 0 ? list[k + 1] || null : null)];
    // (its own stem and flag: the mark sits clear of them, right of a stem-up head's stem)
    const stem = it.g.querySelector(":scope > g.stem") || chord?.querySelector(":scope > g.stem") || null;
    const clear = (x0, x1) => {
      const hit = (b) => Math.min(x1, b.x1) - Math.max(x0, b.x0) > (b.gap ? -tol : tol) && Math.min(y1, b.y1) - Math.max(y0, b.y0) > tol;
      for (const h of heads) if (h.o !== it && (ovalHit(h, x0 + tol, x1 - tol, y0 + tol, y1 - tol) || (h.pill && pillHit(h.pill, x0 + tol, x1 - tol, y0 + tol, y1 - tol)))) return false;
      for (const b of placed) if (hit(b)) return false;
      for (const a of near) {
        for (const b of a.boxes) if (!(stem && stem.contains(b.e)) && hit(b)) return false; // (its own ledger dash is passed already)
        for (const c of a.curves) if (hit(c) && inkIn(c.p, x0, x1, y0, y1)) return false;
      }
      return true;
    };
    // (right: the text starts at xr; left: it ends at xl — text-anchor end)
    const R = [xr - gb.l * ms, xr + gb.r * ms], L = [xl - (gb.w + gb.l) * ms, xl - (gb.w - gb.r) * ms];
    let km = null;
    if (rightOk && clear(...R)) km = { x: xr, left: false, box: R };
    else if (leftOk && clear(...L)) km = { x: xl, left: true, box: L };
    if (km) {
      placed.push({ x0: km.box[0], y0, x1: km.box[1], y1 });
      it.km = { x: km.x, y: base, size: ms, left: km.left };
    } else it.km = null;
  }
}
// A box against an axis-aligned oval { cx, cy, rx, ry } (the box's point nearest the centre inside it).
function ovalHit(o, x0, x1, y0, y1) {
  if (x0 >= x1 || y0 >= y1) return false;
  const dx = (Math.min(Math.max(o.cx, x0), x1) - o.cx) / o.rx, dy = (Math.min(Math.max(o.cy, y0), y1) - o.cy) / o.ry;
  return dx * dx + dy * dy < 1;
}
// A box against a pill (from L to R, its ends half circles of radius r round the line at cy): the
// box's distance to the pill's spine (L + r … R − r at cy) under r.
function pillHit(p, x0, x1, y0, y1) {
  if (x0 >= x1 || y0 >= y1) return false;
  const a = p.L + p.r, b = Math.max(a, p.R - p.r);
  const gx = Math.max(0, a - x1, x0 - b), gy = Math.max(0, y0 - p.cy, p.cy - y1);
  return Math.hypot(gx, gy) < p.r;
}
// Does a tie's / slur's ink (a filled curve) cross the box? (sampled on a 10 × 10 grid, edges in)
function inkIn(path, x0, x1, y0, y1) {
  const svg = path.ownerSVGElement;
  if (!svg || !path.isPointInFill) return false;
  const pt = svg.createSVGPoint();
  try {
    for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) {
      pt.x = x0 + (i / 9) * (x1 - x0);
      pt.y = y0 + (j / 9) * (y1 - y0);
      if (path.isPointInFill(pt) || path.isPointInStroke(pt)) return true;
    }
  } catch { return false; }
  return false;
}
// A mark glyph's ink in ems of its font size, from the baseline and the text's start: { l (left of
// the start), r, a (above the baseline), d (below), w (advance) } — measured once in the page's
// font (canvas), else typical values.
const glyphs = new Map();
function glyphBox(ch) {
  let g = glyphs.get(ch);
  if (g) return g;
  g = ch === "♭" ? { l: 0, r: 0.45, a: 0.78, d: 0.1, w: 0.5 } : { l: 0, r: 0.55, a: 0.78, d: 0.15, w: 0.6 };
  try {
    const cx = document.createElement("canvas").getContext("2d");
    cx.font = `700 100px ${FONT}`;
    const m = cx.measureText(ch);
    if (Number.isFinite(m.actualBoundingBoxAscent) && m.width > 0) g = { l: m.actualBoundingBoxLeft / 100, r: m.actualBoundingBoxRight / 100, a: m.actualBoundingBoxAscent / 100, d: m.actualBoundingBoxDescent / 100, w: m.width / 100 };
  } catch {}
  glyphs.set(ch, g);
  return g;
}
