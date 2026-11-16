// Play page: note names drawn on a rendered Verovio page. A badge (pill) on each notehead,
// spelled as written (B♭ in F, A♯ where one is printed, B♮ where a natural cancels), no octave
// numbers on the page. Levels are one CSS attribute on the stage (no re-render):
//   All: every badge; Some: badges with .lv (≥ 2 ledger lines, a printed or carried
//   accidental, a natural) and .km marks (a ♭/♯ from the key signature only); Off: none.
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
    const staff = g.closest("g.staff");
    let lines = staffs.get(staff);
    if (lines === undefined) staffs.set(staff, (lines = staffLines(staff)));
    const use = head.querySelector("use");
    const href = use ? use.getAttribute("xlink:href") || use.getAttribute("href") || "" : "";
    items.push({ id: g.id, g, head, staff, lines, fact: facts.get(g.id) || factFromSvg(g), hollow: /#E0A[0-3]/i.test(href) });
  }
  // Reads.
  for (const it of items) {
    const b = it.head.getBBox();
    it.w = b.width; it.h = b.height; it.cx = b.x + b.width / 2; it.cy = b.y + b.height / 2;
    it.ledgers = ledgersOf(it.cy, it.lines);
    it.some = someLevel(it.fact, it.ledgers);
    it.scale = 1.3;
  }
  // Dense chords: heads a second or a third apart (on one staff, overlapping in x) get smaller pills.
  const byStaff = new Map();
  for (const it of items) if (it.w) (byStaff.get(it.staff) || byStaff.set(it.staff, []).get(it.staff)).push(it);
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
  // Writes.
  let heads = 0;
  for (const it of items) {
    if (!it.w) continue;
    const { letter, acc, ks } = labelOf(it.fact);
    const ph = it.h * it.scale, fs = ph * 0.78, pw = acc ? ph * 1.45 : ph;
    const g = el("g", { class: "nn " + (it.hollow ? "nb-h" : "nb-f") + (it.some === "name" ? " lv" : "") });
    g.appendChild(el("rect", {
      x: f1(it.cx - pw / 2), y: f1(it.cy - ph / 2), width: f1(pw), height: f1(ph), rx: f1(ph / 2),
      fill: it.hollow ? PAPER : INK, stroke: it.hollow ? INK : "none", "stroke-width": f1(ph * 0.1),
    }));
    const t = el("text", {
      x: f1(it.cx), y: f1(it.cy + fs * 0.36), "text-anchor": "middle", "font-size": f1(fs), "font-weight": "700",
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
    it.g.appendChild(g);
    it.badge = g;
    if (it.some === "mark") {
      const ms = it.h * 0.85;
      const k = el("text", {
        class: "km", x: f1(it.cx + it.w * 0.42), y: f1(it.cy - it.h * 0.42), "font-size": f1(ms), "font-weight": "700",
        "font-family": FONT, fill: KS_H, stroke: "none",
      });
      k.textContent = ACC[String(it.fact.alter)];
      it.g.appendChild(k);
      it.km = k;
    }
    heads++;
  }
  return { heads, ms: Math.round(performance.now() - t0), items };
}
