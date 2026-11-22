// A piano keyboard drawn into an element (one SVG, drawn to the element's own size) that can be
// played: every finger its own key, held until it lifts. What it sounds is the host's (onPress →
// a handle, onRelease(handle)); what's lit is the host's too (setLit). Play docks one under the
// music; the one-page shell can show one on its own.
//
//   const kb = mountKeyboard(el, { range: [48, 83], onPress(midi, e) → handle, onRelease(handle, e, cancelled), onResize(w, h) });
//   kb.update({ lit, range, ghost })  // lit: Map(midi → { fill, letter, acc, hand, finger? }); drawn only when something changed
//   kb.setLit(lit); kb.setRange([lo, hi]); kb.forget() (draw again next time); kb.remeasure(); kb.draws; kb.size()
//
// The range is whole keys lo…hi (MIDI); white keys share the width (≤ 48 px each, centred), black
// keys sit on them, middle C has a dot. A lit white key takes its colour with its letter near its
// foot; a lit black key its colour and a tag with its letter just under it.
//
// Fingering (E7, docs/FINGERING.md §5; the shell's Piano only): a lit key's `finger` (1–5) is a
// white disc with the digit in the key's colour — a white key's just under the black keys' ends (its
// letter shrinks to the foot; under LETTER_MIN px a key the digit replaces it), a black key's on its
// lower end (narrower than 10 px: the digit in its tag) — only where a white key is ≥ DIGIT_MIN px.
// The ghost hand, `ghost` = { r | l: { keys: [m1…m5] (the thumb's first), down: [fingers that play],
// color } }: five rings a hand on the frame's keys, each with its digit, a finger that plays filled —
// an HTML layer over the keys (.kb-ghost, pointer-events none: nothing animates inside the SVG, which
// WebKit can't composite), built again only when a hand's frame changes (a 100 ms crossfade), a
// class for the fingers down; only where a white key is ≥ GHOST_MIN px (else the digits). A ringed
// key has no disc and no letter. The SVG is this element's own (:scope > svg), drawn again only
// when its key string changes (the range, the size, the lit keys with their digits and rings).

const NS = "http://www.w3.org/2000/svg";
const WHITE = new Set([0, 2, 4, 5, 7, 9, 11]);
const FONT = "-apple-system, system-ui, 'Segoe UI', 'Apple Symbols', sans-serif";
const f1 = (x) => Math.round(x * 10) / 10;
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const DIGIT_MIN = 12, GHOST_MIN = 14, LETTER_MIN = 16; // px a white key: digits, rings, a letter beside a digit
const R_MIN = 6.5; // px: a white key's digit disc at least, where it gives way to the letter (a short keyboard)
const FADE = 100; // ms: a new frame's crossfade

// The ghost layer's look (once a page).
function ghostCss() {
  if (document.getElementById("kb-style")) return;
  const st = document.createElement("style");
  st.id = "kb-style";
  st.textContent = `.kb-ghost{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.kb-gh{position:absolute;inset:0}
.kb-ring{position:absolute;box-sizing:border-box;border-radius:50%;border:var(--bw,1.5px) solid var(--c60);background:rgba(255,255,255,.2);color:var(--c);display:flex;align-items:center;justify-content:center;font:700 var(--fs,12px) ${FONT};line-height:1}
.kb-ring.down{background:var(--c);border-color:var(--c);color:#fff;box-shadow:0 0 0 1px #fff}`;
  document.head.append(st);
}
const rgba = (hex, a) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};
// The keys' layout for a size and a range.
function geoOf(W, H, lo, hi) {
  const whites = [];
  for (let m = lo; m <= hi; m++) if (WHITE.has(m % 12)) whites.push(m);
  const ww = Math.min(48, W / whites.length), x0 = (W - ww * whites.length) / 2;
  const xOf = new Map(whites.map((m, i) => [m, x0 + i * ww]));
  return { W, H, lo, hi, ww, x0, whites, xOf, bw: ww * 0.58, bh: H * 0.6, r: Math.min(0.36 * ww, 0.13 * H) };
}
// Where a key's digit disc (or ring) goes: { cx, cy, r } — a white key's just under the black keys'
// ends, a black key's on its lower end; null: not a key drawn.
function spotOf(g, m) {
  if (WHITE.has(((m % 12) + 12) % 12)) {
    const x = g.xOf.get(m);
    return x == null ? null : { cx: x + g.ww / 2, cy: g.bh + 2 + g.r, r: g.r };
  }
  const x = g.xOf.get(m + 1);
  if (x == null) return null;
  const r = Math.max(2, Math.min(g.r, g.bw / 2 - 0.5));
  return { cx: x, cy: g.bh - r - 2, r };
}

export function mountKeyboard(el, { range = [48, 83], onPress = null, onRelease = null, onResize = null } = {}) {
  const K = { lo: range[0], hi: range[1], lit: new Map(), ghost: null, w: 0, h: 0, drawn: "", draws: 0, geo: null,
    layer: null, gh: { r: null, l: null }, frames: 0, builds: 0, downs: 0 }; // (the ghost layer: each hand's rings, frame changes, rebuilds, fingers-down changes)
  const svgEl = () => el.querySelector(":scope > svg");
  const held = new Map(); // pointerId → { midi, handle }

  const measure = () => {
    if (K.w) return;
    const r = el.getBoundingClientRect();
    K.w = Math.round(r.width);
    K.h = Math.round(r.height);
  };
  // (a lit key's digit only where digits are drawn; "o": ringed — no disc, no letter)
  const litKey = (dig, ringed) => [...K.lit].map(([m, L]) => m + (L.hand || L.fill) + L.letter + (L.acc || "") + (dig && L.finger ? "f" + L.finger : "") + (ringed.has(m) ? "o" : "")).join(",");

  function draw(dig = false, ringed = new Set()) {
    let svg = svgEl();
    if (!svg) { svg = document.createElementNS(NS, "svg"); el.prepend(svg); }
    const W = Math.max(60, K.w), H = Math.max(30, K.h), lo = K.lo, hi = K.hi, lit = K.lit;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const g = geoOf(W, H, lo, hi), { whites, ww, x0, xOf } = g;
    const label = (L, cx, y, fs) => `<text x="${f1(cx)}" y="${f1(y)}" font-size="${f1(fs)}" text-anchor="middle" font-weight="700" fill="#fff" font-family="${FONT}">${esc(L.letter)}${L.acc ? `<tspan font-size="${f1(fs * 0.8)}">${esc(L.acc)}</tspan>` : ""}</text>`;
    // (a finger's digit: a white disc, the digit in the key's colour)
    const disc = (m, sp, L) => `<circle class="fd" data-midi="${m}" cx="${f1(sp.cx)}" cy="${f1(sp.cy)}" r="${f1(sp.r)}" fill="#fff"/><text class="fd" data-midi="${m}" x="${f1(sp.cx)}" y="${f1(sp.cy + sp.r * 0.45)}" font-size="${f1(sp.r * 1.3)}" text-anchor="middle" font-weight="800" fill="${L.fill}" font-family="${FONT}">${L.finger}</text>`;
    const fdOf = (m, L) => (dig && L && L.finger >= 1 && L.finger <= 5 && !ringed.has(m) ? L.finger : 0);
    const r0 = Math.max(2, Math.min(ww * 0.11, 4)), dotY = H - r0 - 3;
    let s = "", tops = "";
    for (const m of whites) {
      const x = xOf.get(m), L = lit.get(m), fd = fdOf(m, L);
      s += `<rect class="key${L ? " lit" : ""}" data-midi="${m}"${L ? ` data-hand="${L.hand}"` : ""} x="${f1(x + 0.5)}" y="0" width="${f1(ww - 1)}" height="${H}" rx="${f1(Math.min(3, ww * 0.12))}" fill="${L ? L.fill : "#f3f0e8"}"/>`;
      let dot = m === 60;
      if (L && ringed.has(m)) { /* (the ring holds its digit: no letter) */ }
      else if (fd) {
        // (the letter at the foot at 0.85 — on a short keyboard the disc gives way to it down to R_MIN,
        // then the letter to what's left; under LETTER_MIN px a key, or under 7 px a letter, the digit
        // replaces it)
        const sp = spotOf(g, m), room = H - g.bh - 4;
        let r = sp.r, fs = ww >= LETTER_MIN ? Math.min(ww * 0.58, H * 0.22) * 0.85 : 0;
        if (fs) {
          if (2 * r + 0.74 * fs + 1 > room) r = Math.max(R_MIN, (room - 0.74 * fs - 1) / 2);
          if (2 * r + 0.74 * fs + 1 > room) fs = (room - 2 * r - 1) / 0.74;
          if (fs < 7) { fs = 0; r = sp.r; }
        }
        s += disc(m, { cx: sp.cx, cy: g.bh + 2 + r, r }, L);
        if (fs) { s += label(L, x + ww / 2, H - 2, fs); dot = false; }
      } else if (L) s += label(L, x + ww / 2, dotY - r0 - 3, Math.min(ww * 0.58, H * 0.22));
      if (dot) s += `<circle class="mc" cx="${f1(x + ww / 2)}" cy="${f1(dotY)}" r="${f1(r0)}" fill="${L ? "#e8e4ff" : "#9b9aa6"}"/>`;
    }
    const { bw, bh } = g;
    for (let m = lo; m <= hi; m++) {
      if (WHITE.has(m % 12) || !xOf.has(m + 1)) continue;
      const x = xOf.get(m + 1) - bw / 2, L = lit.get(m), fd = fdOf(m, L);
      tops += `<rect class="key${L ? " lit" : ""}" data-midi="${m}"${L ? ` data-hand="${L.hand}"` : ""} x="${f1(x)}" y="0" width="${f1(bw)}" height="${f1(bh)}" rx="${f1(Math.min(2, bw * 0.15))}" fill="${L ? L.fill : "#101018"}" stroke="#14142c" stroke-width="1"/>`;
      if (L && !ringed.has(m)) {
        // (a black key is too narrow for its name: a tag in its colour just under it — its digit on
        // the key's lower end, or in the tag where the key is narrower than 10 px)
        const inTag = fd && bw < 10;
        if (fd && !inTag) tops += disc(m, spotOf(g, m), L);
        const T = inTag ? { letter: String(fd), acc: "" } : L;
        const fs = Math.min(ww * 0.6, H * 0.2), tw = fs * (T.acc ? 1.35 : 0.85) + 4, th = fs * 1.25;
        tops += `<rect class="tag" x="${f1(x + bw / 2 - tw / 2)}" y="${f1(bh + 2)}" width="${f1(tw)}" height="${f1(th)}" rx="${f1(th / 3)}" fill="${L.fill}" stroke="#14142c" stroke-width="1"/>`;
        tops += inTag ? label(T, x + bw / 2, bh + 2 + th * 0.78, fs).replace("<text ", `<text class="fd" data-midi="${m}" `) : label(T, x + bw / 2, bh + 2 + th * 0.78, fs);
      }
    }
    svg.innerHTML = s + tops;
    K.geo = g;
  }

  // The ghost hand's rings (an HTML layer over the keys): a hand's group built again only when its
  // frame changes — or the keys' layout does — the new one faded in over FADE ms as the old one fades
  // out; the fingers that play a class.
  function rings(ghost, g) {
    if (!ghost && !K.layer) return;
    if (!K.layer) {
      ghostCss();
      if (getComputedStyle(el).position === "static") el.style.position = "relative";
      K.layer = document.createElement("div");
      K.layer.className = "kb-ghost";
      K.layer.setAttribute("aria-hidden", "true");
      el.append(K.layer);
    }
    for (const side of ["r", "l"]) {
      const want = ghost?.[side]?.keys?.some((m) => m != null) ? ghost[side] : null;
      const frame = want ? want.keys.join(",") + "|" + (want.color || "") : "";
      const id = want ? `${frame}|${g.W}x${g.H}|${g.lo}-${g.hi}` : "";
      const cur = K.gh[side];
      if ((cur?.id || "") !== id) {
        const newFrame = (cur?.frame || "") !== frame;
        if (newFrame && want) K.frames++;
        if (cur) {
          const old = cur.el;
          old.dataset.out = ""; // (going)
          if (newFrame) {
            try { old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE, fill: "forwards" }).onfinish = () => old.remove(); } catch { old.remove(); }
            setTimeout(() => old.remove(), FADE + 200); // (a hidden page runs no animation)
          } else old.remove();
        }
        let grp = null;
        if (want) {
          grp = document.createElement("div");
          grp.className = "kb-gh";
          grp.dataset.h = side;
          const c = want.color || "#a64fff";
          grp.style.setProperty("--c", c);
          grp.style.setProperty("--c60", rgba(c, 0.6));
          want.keys.forEach((m, i) => {
            const sp = m == null ? null : spotOf(g, m);
            if (!sp) return;
            const d = document.createElement("div");
            d.className = "kb-ring";
            d.dataset.f = String(i + 1);
            d.dataset.midi = String(m);
            d.textContent = String(i + 1);
            d.style.cssText = `left:${f1(sp.cx - sp.r)}px;top:${f1(sp.cy - sp.r)}px;width:${f1(2 * sp.r)}px;height:${f1(2 * sp.r)}px;--fs:${f1(sp.r * 1.25)}px;--bw:${sp.r > 10 ? 2 : 1.5}px`;
            grp.append(d);
          });
          K.layer.append(grp);
          K.builds++;
          if (newFrame && cur) { try { grp.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE }); } catch {} }
        }
        K.gh[side] = want ? { id, frame, el: grp, down: "", keys: want.keys.slice() } : null;
      }
      const h = K.gh[side];
      if (!h) continue;
      const down = [...new Set(want.down || [])].sort().join("");
      if (down !== h.down) {
        h.down = down;
        K.downs++;
        for (const d of h.el.children) d.classList.toggle("down", down.includes(d.dataset.f));
      }
    }
  }

  // Draw when what it shows changed: the range, the size, the keys lit (their digits, the rings over
  // them). The ghost's rings follow on their own layer. → drawn
  function update({ lit = K.lit, range: rg = [K.lo, K.hi], ghost = K.ghost } = {}) {
    measure();
    K.lit = lit;
    K.ghost = ghost || null;
    K.lo = Math.max(0, rg[0]);
    K.hi = Math.min(127, rg[1]);
    const g = geoOf(Math.max(60, K.w), Math.max(30, K.h), K.lo, K.hi);
    const dig = g.ww >= DIGIT_MIN, gh = K.ghost && g.ww >= GHOST_MIN ? K.ghost : null;
    const ringed = new Set();
    if (gh) for (const side of ["r", "l"]) for (const m of gh[side]?.keys || []) if (m != null) ringed.add(m);
    const key = `${K.lo}-${K.hi} ${K.w}x${K.h} ${litKey(dig, ringed)}`;
    let drawn = false;
    if (key !== K.drawn) {
      K.drawn = key;
      K.draws++;
      draw(dig, ringed);
      drawn = true;
    }
    rings(gh, g);
    return drawn;
  }

  // The key under a point (client px): a black key over the white ones. → midi | null
  function keyAt(cx, cy) {
    const g = K.geo, svg = svgEl();
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
    // (tests: the keys' layout — a white key's width, each key's digit spot — and the ghost layer)
    geo: () => (K.geo ? { ww: K.geo.ww, bw: K.geo.bw, bh: K.geo.bh, W: K.geo.W, H: K.geo.H, lo: K.geo.lo, hi: K.geo.hi, digits: K.geo.ww >= DIGIT_MIN, rings: K.geo.ww >= GHOST_MIN } : null),
    spot: (m) => (K.geo ? spotOf(K.geo, m) : null),
    ghost: () => ({ frames: K.frames, builds: K.builds, downs: K.downs, r: K.gh.r && { keys: K.gh.r.keys.slice(), down: K.gh.r.down }, l: K.gh.l && { keys: K.gh.l.keys.slice(), down: K.gh.l.down } }),
    destroy: () => { ro.disconnect(); for (const [, h] of held) onRelease?.(h.handle, null, true); held.clear(); el.replaceChildren(); },
  };
}
