// A piano keyboard drawn into an element (one SVG, drawn to the element's own size) that can be
// played: every finger its own key, held until it lifts. What it sounds is the host's (onPress →
// a handle, onRelease(handle)); what's lit is the host's too (setLit). Play docks one under the
// music; the one-page shell can show one on its own.
//
//   const kb = mountKeyboard(el, { range: [48, 83], onPress(midi, e) → handle, onRelease(handle, e, cancelled), onResize(w, h) });
//   kb.update({ lit, range })  // lit: Map(midi → { fill, letter, acc, hand }); drawn only when something changed
//   kb.setLit(lit); kb.setRange([lo, hi]); kb.forget() (draw again next time); kb.remeasure(); kb.draws; kb.size()
//
// The range is whole keys lo…hi (MIDI); white keys share the width (≤ 48 px each, centred), black
// keys sit on them, middle C has a dot. A lit white key takes its colour with its letter near its
// foot; a lit black key its colour and a tag with its letter just under it.

const NS = "http://www.w3.org/2000/svg";
const WHITE = new Set([0, 2, 4, 5, 7, 9, 11]);
const FONT = "-apple-system, system-ui, 'Segoe UI', 'Apple Symbols', sans-serif";
const f1 = (x) => Math.round(x * 10) / 10;
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");

export function mountKeyboard(el, { range = [48, 83], onPress = null, onRelease = null, onResize = null } = {}) {
  const K = { lo: range[0], hi: range[1], lit: new Map(), w: 0, h: 0, drawn: "", draws: 0, geo: null };
  const held = new Map(); // pointerId → { midi, handle }

  const measure = () => {
    if (K.w) return;
    const r = el.getBoundingClientRect();
    K.w = Math.round(r.width);
    K.h = Math.round(r.height);
  };
  const litKey = () => [...K.lit].map(([m, L]) => m + (L.hand || L.fill) + L.letter + (L.acc || "")).join(",");

  function draw() {
    let svg = el.firstElementChild;
    if (!svg) { svg = document.createElementNS(NS, "svg"); el.appendChild(svg); }
    const W = Math.max(60, K.w), H = Math.max(30, K.h), lo = K.lo, hi = K.hi, lit = K.lit;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const whites = [];
    for (let m = lo; m <= hi; m++) if (WHITE.has(m % 12)) whites.push(m);
    const ww = Math.min(48, W / whites.length), x0 = (W - ww * whites.length) / 2;
    const xOf = new Map(whites.map((m, i) => [m, x0 + i * ww]));
    const label = (L, cx, y, fs) => `<text x="${f1(cx)}" y="${f1(y)}" font-size="${f1(fs)}" text-anchor="middle" font-weight="700" fill="#fff" font-family="${FONT}">${esc(L.letter)}${L.acc ? `<tspan font-size="${f1(fs * 0.8)}">${esc(L.acc)}</tspan>` : ""}</text>`;
    const r0 = Math.max(2, Math.min(ww * 0.11, 4)), dotY = H - r0 - 3;
    let s = "", tops = "";
    for (const m of whites) {
      const x = xOf.get(m), L = lit.get(m);
      s += `<rect class="key${L ? " lit" : ""}" data-midi="${m}"${L ? ` data-hand="${L.hand}"` : ""} x="${f1(x + 0.5)}" y="0" width="${f1(ww - 1)}" height="${H}" rx="${f1(Math.min(3, ww * 0.12))}" fill="${L ? L.fill : "#f3f0e8"}"/>`;
      if (L) s += label(L, x + ww / 2, dotY - r0 - 3, Math.min(ww * 0.58, H * 0.22));
      if (m === 60) s += `<circle class="mc" cx="${f1(x + ww / 2)}" cy="${f1(dotY)}" r="${f1(r0)}" fill="${L ? "#e8e4ff" : "#9b9aa6"}"/>`;
    }
    const bw = ww * 0.58, bh = H * 0.6;
    for (let m = lo; m <= hi; m++) {
      if (WHITE.has(m % 12) || !xOf.has(m + 1)) continue;
      const x = xOf.get(m + 1) - bw / 2, L = lit.get(m);
      tops += `<rect class="key${L ? " lit" : ""}" data-midi="${m}"${L ? ` data-hand="${L.hand}"` : ""} x="${f1(x)}" y="0" width="${f1(bw)}" height="${f1(bh)}" rx="${f1(Math.min(2, bw * 0.15))}" fill="${L ? L.fill : "#101018"}" stroke="#14142c" stroke-width="1"/>`;
      if (L) {
        // (a black key is too narrow for its name: a tag in its colour just under it)
        const fs = Math.min(ww * 0.6, H * 0.2), tw = fs * (L.acc ? 1.35 : 0.85) + 4, th = fs * 1.25;
        tops += `<rect class="tag" x="${f1(x + bw / 2 - tw / 2)}" y="${f1(bh + 2)}" width="${f1(tw)}" height="${f1(th)}" rx="${f1(th / 3)}" fill="${L.fill}" stroke="#14142c" stroke-width="1"/>`;
        tops += label(L, x + bw / 2, bh + 2 + th * 0.78, fs);
      }
    }
    svg.innerHTML = s + tops;
    K.geo = { W, H, lo, hi, ww, x0, whites, xOf, bw, bh };
  }

  // Draw when what it shows changed: the range, the size or the keys lit. → drawn
  function update({ lit = K.lit, range: rg = [K.lo, K.hi] } = {}) {
    measure();
    K.lit = lit;
    K.lo = Math.max(0, rg[0]);
    K.hi = Math.min(127, rg[1]);
    const key = `${K.lo}-${K.hi} ${K.w}x${K.h} ${litKey()}`;
    if (key === K.drawn) return false;
    K.drawn = key;
    K.draws++;
    draw();
    return true;
  }

  // The key under a point (client px): a black key over the white ones. → midi | null
  function keyAt(cx, cy) {
    const g = K.geo, svg = el.firstElementChild;
    if (!g || !svg) return null;
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const x = ((cx - r.left) * g.W) / r.width, y = ((cy - r.top) * g.H) / r.height;
    if (y < 0 || y > g.H) return null;
    if (y <= g.bh) {
      for (let m = g.lo; m <= g.hi; m++) {
        if (WHITE.has(m % 12) || !g.xOf.has(m + 1)) continue;
        const l = g.xOf.get(m + 1) - g.bw / 2;
        if (x >= l && x <= l + g.bw) return m;
      }
    }
    const i = Math.floor((x - g.x0) / g.ww);
    return i >= 0 && i < g.whites.length ? g.whites[i] : null;
  }

  // Playing it: a finger down on a key strikes it (in its own pointerdown: the host sounds it at
  // once), up or cancelled lets it go. Each pointer its own key.
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const midi = keyAt(e.clientX, e.clientY);
    if (midi == null) return;
    e.preventDefault(); // (no text selection, no focus moves, no emulated mouse events)
    const old = held.get(e.pointerId);
    if (old) { held.delete(e.pointerId); onRelease?.(old.handle, e, true); }
    const handle = onPress ? onPress(midi, e) : null;
    held.set(e.pointerId, { midi, handle });
    try { el.setPointerCapture(e.pointerId); } catch {}
  });
  const up = (cancelled) => (e) => {
    const h = held.get(e.pointerId);
    if (!h) return;
    held.delete(e.pointerId);
    onRelease?.(h.handle, e, cancelled);
  };
  el.addEventListener("pointerup", up(false));
  el.addEventListener("pointercancel", up(true));
  el.addEventListener("contextmenu", (e) => e.preventDefault());

  // Its size: drawn again to it (the host may lay out around it first).
  const ro = new ResizeObserver((es) => {
    const r = es[es.length - 1].contentRect;
    K.w = Math.round(r.width);
    K.h = Math.round(r.height);
    if (onResize) onResize(K.w, K.h);
    else update();
  });
  ro.observe(el);

  return {
    el,
    update,
    setLit: (lit) => update({ lit }),
    setRange: (rg) => update({ range: rg }),
    forget: () => { K.drawn = ""; },
    remeasure: () => { K.w = K.h = 0; },
    keyAt,
    size: () => (measure(), { w: K.w, h: K.h }),
    held: () => [...held.values()].map((h) => h.midi),
    get draws() { return K.draws; },
    get range() { return [K.lo, K.hi]; },
    destroy: () => { ro.disconnect(); for (const [, h] of held) onRelease?.(h.handle, null, true); held.clear(); el.replaceChildren(); },
  };
}
