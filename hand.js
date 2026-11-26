// The drawn hand (E7 "hand" mode; docs/FINGERING.md "The drawn hand"): two hands seen from the
// player's eyes — the fingertips on the keys, the knuckles just in front of them, the palm, the wrist
// and a bit of forearm in a band under the keyboard — moving to each new position just before its
// notes as ▶ plays, the finger that plays pressing, the thumb passing under. handplan.js says where
// they are; this draws them.
//
//   const H = mountHands(kbEl);        // inside the keyboard's element (keyboard.js finds its SVG by :scope > svg)
//   H.layout(kg, band)                 // the keys' layout (keyboard.js geo) and the band under them (0: none)
//   H.notes(list, tv) / H.cut(at, tv) / H.clear(tv) / H.tick(tv)   // ▶: its notes as it schedules them, a
//                                      // reschedule, a stop, every frame (tv: ▶'s clock, smoothed)
//   H.show(pose, tv)                   // idle: { r?, l?: { keys: [m1…m5], down: [{ f, midi }], strike, up } } | null —
//                                      // a press's chord (strike: pressed; up: let go) or a selection's first onset (shown just before)
//   H.debug(); H.destroy()
//
// WebKit can't composite an animation inside an SVG (every frame of one repainted the page): each hand
// is its own <canvas>, moved by a transform and faded by its opacity, and drawn again only when its
// shape changed; the landing badges are HTML (transform / opacity). Nothing here animates by CSS or
// WAAPI. A budget watchdog lowers the detail when frames come late.
import { handGeo, planHand, poseAt, frameAt, yieldHands, nailStates, keyU, clamp, lerp, MOFF, MARCH, MH, WID, LEAD, XFADE } from "./handplan.js?v=126";

const COL = { r: "#a64fff", l: "#4f7cff" };
const INK = { r: "#6f25d6", l: "#2652d6" }; // (a digit on a white nail: the hand's colour, darker)
const FONT = "-apple-system, system-ui, 'Segoe UI', sans-serif";
const KH = 0.16;          // how much a height shows on screen (× S)
const HIDE_AFTER = 2;     // s: after ▶ stops, the hands rest where they are this long, then fade
const WINDOW = 3;         // s: notes over this long ago are dropped
const STILL = 20;         // frames with nothing changing: the hands' own loop stops
const TAPER = [null, [1.2, 1.08, 0.95, 0.86], [1.0, 0.95, 0.88, 0.8], [1.0, 0.95, 0.88, 0.8], [1.0, 0.95, 0.88, 0.8], [1.0, 0.95, 0.88, 0.8]];

const mix = (a, b, s) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (sh) => Math.round(lerp((pa >> sh) & 255, (pb >> sh) & 255, s));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
};
const SKIN = { r: mix("#efc6a8", COL.r, 0.27), l: mix("#efc6a8", COL.l, 0.27) };
const SKIN_UNDER = { r: mix("#c99c88", COL.r, 0.32), l: mix("#c99c88", COL.l, 0.32) };
const SKIN_DK = { r: mix("#d9a88f", COL.r, 0.34), l: mix("#d9a88f", COL.l, 0.34) };
const SKIN_HI = { r: mix("#fbe8dc", COL.r, 0.12), l: mix("#fbe8dc", COL.l, 0.12) };
const SKIN_LO = { r: mix("#a87a68", COL.r, 0.4), l: mix("#a87a68", COL.l, 0.4) };
const EDGE = { r: mix("#4a2c48", COL.r, 0.55), l: mix("#2e3050", COL.l, 0.55) };

function css() {
  if (document.getElementById("kb-hand-style")) return;
  const st = document.createElement("style");
  st.id = "kb-hand-style";
  st.textContent = `.kb-hands{position:absolute;left:0;right:0;top:0;overflow:hidden;pointer-events:none}
.kb-hands[hidden]{display:none}
.kb-slip{position:absolute;left:0;right:0;height:12px;background:linear-gradient(rgba(0,0,0,.5),rgba(0,0,0,0))}
canvas.kb-hand{position:absolute;left:0;top:0;opacity:0;will-change:transform,opacity}
.kb-marks{position:absolute;inset:0;z-index:3}
.kb-land{position:absolute;left:0;top:0;box-sizing:border-box;border-radius:50%;border:2px dashed var(--c);background:rgba(255,255,255,.88);color:var(--ink);display:flex;align-items:center;justify-content:center;font:800 var(--fs) ${FONT};line-height:1;opacity:0;will-change:transform,opacity}
.kb-fade{position:absolute;left:0;right:0;bottom:0;z-index:4;background:linear-gradient(rgba(20,20,44,0),#14142c 88%)}`;
  document.head.append(st);
}

// A tapered capsule (x1, y1, r1) → (x2, y2, r2) into a path — every one wound the same way, so a path
// of many fills as their union (nonzero).
function capsule(p, x1, y1, r1, x2, y2, r2) {
  const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy) || 1e-3, nx = -dy / d, ny = dx / d, a = Math.atan2(ny, nx);
  p.moveTo(x1 + nx * r1, y1 + ny * r1);
  p.lineTo(x2 + nx * r2, y2 + ny * r2);
  p.arc(x2, y2, r2, a, a - Math.PI, true);
  p.lineTo(x1 - nx * r1, y1 - ny * r1);
  p.arc(x1, y1, r1, a - Math.PI, a - 2 * Math.PI, true);
  p.closePath();
}
// A smooth closed shape through points (quadratic curves between midpoints), wound as the capsules.
function blob(p, pts) {
  let A = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; A += a[0] * b[1] - b[0] * a[1]; }
  if (A > 0) pts = pts.slice().reverse();
  const n = pts.length, mid = (i) => [(pts[i][0] + pts[(i + 1) % n][0]) / 2, (pts[i][1] + pts[(i + 1) % n][1]) / 2];
  let m = mid(n - 1); p.moveTo(m[0], m[1]);
  for (let i = 0; i < n; i++) { m = mid(i); p.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]); }
  p.closePath();
}
const sameSig = (a, b) => { if (!b || a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

export function mountHands(host) {
  css();
  if (getComputedStyle(host).position === "static") host.style.position = "relative";
  const layer = document.createElement("div");
  layer.className = "kb-hands";
  layer.setAttribute("aria-hidden", "true");
  layer.hidden = true;
  const slip = document.createElement("div");
  slip.className = "kb-slip";
  const marksEl = document.createElement("div");
  marksEl.className = "kb-marks";
  const fade = document.createElement("div");
  fade.className = "kb-fade";
  const HS = {};
  layer.append(slip);
  for (const h of ["l", "r"]) {
    const el = document.createElement("canvas");
    el.className = "kb-hand";
    el.dataset.h = h;
    el.width = el.height = 0;
    layer.append(el);
    HS[h] = { el, c: el.getContext("2d"), W: 0, tx: null, at: null, sig: null, op: -1, z: null, draws: 0, box: null, press: "" };
  }
  layer.append(marksEl, fade);
  host.append(layer);
  const mq = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

  let G = null, geoKey = "", SPR = null, LOD = 0, FRAME = 0, gone = false;
  const lists = { r: [], l: [] }, opt = { r: {}, l: {} }, freeze = { r: null, l: null };
  let plans = { r: null, l: null }, dirty = true, driven = false, off = 0, raf = 0, still = 0, seq = 0;
  const showKey = { r: "", l: "" }, showUp = { r: false, l: false };
  let lastPoses = {};
  const LAND = { r: [], l: [] };
  const WD = { gaps: [], last: 0, steps: [] };
  const STAT = { draws: 0, skips: 0, frames: 0, ticks: 0 };
  const clock = () => performance.now() / 1000 + off;
  const setClock = (tv) => { if (Number.isFinite(tv)) off = tv - performance.now() / 1000; };

  // --- layout -------------------------------------------------------------------------------------
  function layout(kg, band) {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const key = kg ? `${kg.W}x${kg.H} ${kg.lo}-${kg.hi} ${band} ${dpr}` : "";
    if (key === geoKey) return false;
    geoKey = key;
    G = kg && band ? { ...handGeo(kg, band), dpr } : null;
    if (G && G.mode === "none") G = null;
    layer.hidden = !G;
    for (const H of Object.values(HS)) {
      H.W = G ? Math.min(Math.ceil(11 * G.ww), G.W + 2 * G.ww) : 0;
      H.el.width = G ? Math.round(H.W * dpr) : 0;
      H.el.height = G ? Math.round(G.CH * dpr) : 0;
      H.el.style.width = H.W + "px";
      H.el.style.height = (G ? G.CH : 0) + "px";
      Object.assign(H, { tx: null, at: null, sig: null, op: -1, box: null });
      H.el.style.opacity = "0";
      if (G) {
        const gd = H.c.createLinearGradient(0, G.bh * 0.7, 0, G.H);
        gd.addColorStop(0, "rgba(20,10,40,0)"); gd.addColorStop(1, "rgba(20,10,40,.5)");
        H.down = gd;
      }
    }
    if (G) {
      layer.style.height = G.CH + "px";
      slip.style.top = G.H + "px";
      fade.style.height = Math.round(0.3 * G.band) + "px";
    }
    LOD = 0; WD.gaps = []; WD.last = 0;
    sprites();
    marks();
    dirty = true;
    kick();
    return true;
  }

  // Nail sprites (per hand × digit × state, at the canvases' pixel ratio): rest — a white disc, the digit
  // in the hand's ink; next — with a ring in the hand's colour; on — filled with the hand's colour, a
  // white digit and rim; plain — a small nail, no digit.
  function sprites() {
    if (!G) { SPR = null; return; }
    const r = G.rD, d = G.dpr, pad = 4, sz = Math.ceil((2 * r + 2 * pad) * d), c0 = sz / d / 2;
    const make = (h, f, st) => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = sz;
      const x = cv.getContext("2d");
      x.scale(d, d);
      if (st === "plain") {
        x.beginPath(); x.ellipse(c0, c0, r * 0.5, r * 0.62, 0, 0, Math.PI * 2);
        x.fillStyle = "rgba(255,246,240,.9)"; x.fill(); x.lineWidth = 0.8; x.strokeStyle = SKIN_LO[h]; x.stroke();
        return cv;
      }
      x.beginPath(); x.arc(c0, c0, r, 0, Math.PI * 2);
      x.fillStyle = st === "on" ? COL[h] : "rgba(255,255,255,.95)"; x.fill();
      if (st === "on") { x.lineWidth = 1.5; x.strokeStyle = "#fff"; x.stroke(); }
      else if (st === "next") { x.beginPath(); x.arc(c0, c0, r + 1.2, 0, Math.PI * 2); x.lineWidth = 2.4; x.strokeStyle = COL[h]; x.stroke(); }
      else { x.lineWidth = 1; x.strokeStyle = "rgba(40,20,60,.35)"; x.stroke(); }
      x.fillStyle = st === "on" ? "#fff" : INK[h];
      x.font = `800 ${Math.max(9, r * 1.3).toFixed(1)}px ${FONT}`;
      x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText(String(f), c0, c0 + 0.5);
      return cv;
    };
    SPR = { sz: sz / d };
    for (const h of ["r", "l"]) { SPR[h] = {}; for (const st of ["rest", "next", "on", "plain"]) SPR[h][st] = [null, 1, 2, 3, 4, 5].map((f) => (f ? make(h, f, st) : null)); }
  }
  // The landing badges: a pool of five a hand.
  function marks() {
    marksEl.replaceChildren();
    LAND.r = []; LAND.l = [];
    if (!G) return;
    const r = G.rD + 1.5;
    for (const h of ["r", "l"]) for (let i = 0; i < 5; i++) {
      const d = document.createElement("div");
      d.className = "kb-land";
      d.style.cssText = `width:${2 * r}px;height:${2 * r}px;--c:${COL[h]};--ink:${INK[h]};--fs:${Math.max(9, G.rD * 1.25).toFixed(1)}px`;
      marksEl.append(d);
      LAND[h].push({ el: d, x: null, y: null, a: -1, f: 0 });
    }
  }
  function setLands(h, lands, vis) {
    const r = G.rD + 1.5;
    let changed = false;
    LAND[h].forEach((L, i) => {
      const g = lands[i];
      const a = g ? Math.round(g.a * vis * 20) / 20 : 0;
      if (g) {
        const x = G.x0 + g.x * G.ww, y = g.hk > 0.25 ? G.bh - Math.min(r, G.bw / 2) - 2 : G.bh + 2 + r;
        const X = Math.round((x - r) * 2) / 2, Y = Math.round((y - r) * 2) / 2;
        if (X !== L.x || Y !== L.y) { L.x = X; L.y = Y; L.el.style.transform = `translate3d(${X}px,${Y}px,0)`; changed = true; }
        if (g.f !== L.f) { L.f = g.f; L.el.textContent = String(g.f); L.m = g.m; }
      }
      if (a !== L.a) { L.a = a; L.el.style.opacity = String(a); changed = true; }
    });
    return changed;
  }

  // --- drawing --------------------------------------------------------------------------------------
  const toS = (p) => [G.x0 + p.x * G.ww, (p.z >= 0 ? G.H - p.z * G.S : G.H - p.z * G.Sb) - p.h * G.S * KH];
  // The hand's shapes in keyboard px (a pose → points): the finger chains with their radii, the palm's
  // outline (the back of the hand, the wrist, into the forearm), the nails.
  function shapeOf(p, h) {
    const k = G.k, u = G.ww, sc = 1 + 0.05 * p.lift / Math.max(k, 0.01);
    const { ax, az, bx, bz } = p;
    const at = (o, a, b, hh = 0) => toS({ x: o.x + (ax * a + bx * b) * k, z: o.z + (az * a + bz * b) * k, h: (o.h || 0) + hh * k });
    const W = p.W, E = p.E;
    let fx = E.x - W.x, fz = E.z - W.z; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    const pax = -fz * p.P.side, paz = fx * p.P.side;
    const wa = (d, a) => toS({ x: W.x + (fx * d + pax * a) * k, z: W.z + (fz * d + paz * a) * k, h: W.h - 0.05 * d * k });
    const wh = (d, a) => { const m = clamp(d / 2.4, 0, 1), xa = lerp(ax, pax, m), za = lerp(az, paz, m); return toS({ x: W.x + (fx * d + xa * a) * k, z: W.z + (fz * d + za * a) * k, h: W.h - 0.05 * d * k }); };
    const fingers = p.fingers.map((fg) => {
      const pts = fg.j.map(toS), r0 = 0.5 * WID[fg.f] * k * u * sc * (1 + 0.1 * fg.F.lift);
      const tail = pts[3], prev = pts[2];
      return { f: fg.f, pts, rr: TAPER[fg.f].map((x) => x * r0), nail: [lerp(prev[0], tail[0], 0.62), lerp(prev[1], tail[1], 0.62)] };
    });
    const K = p.K, sp = p.spread;
    const kn = [2, 3, 4, 5].map((f) => at(K, MOFF[f] * sp, MARCH[f] + 0.12, MH[f] - 1 - 0.05));
    const palm = [
      at(K, -1.52 * sp, -0.15, 0.15),
      kn[0], kn[1], kn[2], kn[3],
      at(K, 1.42 * sp, -0.3, 0.05),
      at(K, 1.52, -1.5, -0.1),
      wh(-0.05, 1.02), wh(0.4, 1.0), wa(2.4, 1.2), wa(5.5, 1.42),
      wa(5.5, -1.38), wa(2.4, -1.15), wh(0.4, -0.98), wh(-0.05, -1.0),
      at(K, -1.78, -1.85, -0.25),
      at(K, -1.62, -0.95, -0.05),
    ];
    const wc = toS({ x: W.x, z: W.z, h: W.h });
    const mid = at(K, 0.05, -1.1, 0);
    let bx0 = Infinity, bx1 = -Infinity;
    for (const fg of fingers) for (const q of fg.pts) { bx0 = Math.min(bx0, q[0]); bx1 = Math.max(bx1, q[0]); }
    for (const q of palm) { if (q[1] < G.CH + 4) { bx0 = Math.min(bx0, q[0]); bx1 = Math.max(bx1, q[0]); } }
    const pad = Math.max(G.rD + 4, 0.5 * u) + 2;
    return { h, fingers, palm, kn, wc, mid, box: [Math.floor(bx0 - pad), Math.ceil(bx1 + pad)], under: p.under > 0.55, kAt: (a, b) => at(K, a, b, 0), p };
  }
  // Its signature: every point the drawing uses, relative to the canvas (¼ px), and the states.
  function sigOf(sh, tx) {
    const a = [LOD, sh.under ? 1 : 0];
    const q = (v) => Math.round(v * 4);
    for (const fg of sh.fingers) { for (const pt of fg.pts) a.push(q(pt[0] - tx), q(pt[1])); a.push(q(fg.rr[0])); }
    for (const pt of sh.palm) a.push(q(pt[0] - tx), q(pt[1]));
    for (const n of sh.nails) a.push(n.f * 1000 + n.st.length * 10 + n.pr + (n.hidden ? 100 : 0), q(n.x - tx), q(n.y));
    for (const fg of sh.p.fingers) a.push(Math.round(fg.F.press * 20));
    return a;
  }
  // The nails' places and looks: a resting finger's digit gives way where its disc would touch a playing
  // or next finger's (the thumb passing under 2–3); on a compact hand only the playing and next keep one.
  function placeNails(sh, st) {
    const rD = G.rD, compact = G.mode === "compact";
    const list = st.out.map((s, i) => ({ ...s, x: sh.fingers[i].nail[0], y: sh.fingers[i].nail[1] }));
    const order = list.slice().sort((a, b) => b.pr - a.pr);
    const kept = [];
    for (const n of order) {
      const busy = kept.some((m) => Math.hypot(m.x - n.x, m.y - n.y) < 1.75 * rD);
      if (n.st === "rest" && (busy || compact)) n.st = "plain";
      if (n.st !== "plain") kept.push(n);
    }
    return order.reverse(); // (drawn lowest first: a playing or next finger's disc on top)
  }
  // One pass each: the thumb (under the palm), the outline (the shapes grown, one union fill), the skin
  // (one union fill), the details (one stroke path a kind), the see-through over the keys
  // (destination-out), what lies under the hand — the keys going down, the shadows — (destination-over),
  // then the nails (sprites, at full strength).
  function drawHand(H, sh, tx) {
    const c = H.c, h = sh.h, d = G.dpr, compact = G.mode === "compact";
    H.tx = tx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = "source-over";
    c.globalAlpha = 1;
    if (H.box == null || H.boxTx == null) c.clearRect(0, 0, H.el.width, H.el.height);
    else for (const [[a, b], o] of [[H.box, H.boxTx], [sh.box, tx]]) { const x0 = Math.max(0, Math.floor((a - o) * d) - 2), x1 = Math.min(H.el.width, Math.ceil((b - o) * d) + 2); if (x1 > x0) c.clearRect(x0, 0, x1 - x0, H.el.height); } // (the old drawing where it was on the canvas, the new one's place)
    H.box = sh.box; H.boxTx = tx;
    c.setTransform(d, 0, 0, d, -tx * d, 0);
    const ow = G.ww * G.k >= 20 ? 1.3 : 1.0; // (the outline: the shapes grown by this, filled dark)
    const chain = (path, fg, grow) => { const P = fg.pts, R = fg.rr; for (let i = 0; i < 3; i++) capsule(path, P[i][0], P[i][1], R[i] + grow, P[i + 1][0], P[i + 1][1], R[i + 1] + grow); };
    // the thumb: first — the palm covers its root, and the hand covers it when it passes under
    const th = sh.fingers[0];
    { const o = new Path2D(), s = new Path2D(); chain(o, th, ow); chain(s, th, 0);
      c.fillStyle = EDGE[h]; c.fill(o); c.fillStyle = sh.under ? SKIN_UNDER[h] : SKIN[h]; c.fill(s); }
    // the palm and fingers 2–5: one union for the outline (grown), one for the skin
    const cx = sh.palm.reduce((s, q) => s + q[0], 0) / sh.palm.length, cy = sh.palm.reduce((s, q) => s + q[1], 0) / sh.palm.length;
    const grown = sh.palm.map(([x, y]) => { const dx = x - cx, dy = y - cy, l = Math.hypot(dx, dy) || 1; return [x + (dx / l) * ow, y + (dy / l) * ow]; });
    const body = new Path2D(), line = new Path2D();
    blob(line, grown); blob(body, sh.palm);
    for (let i = 1; i < 5; i++) { chain(line, sh.fingers[i], ow); chain(body, sh.fingers[i], 0); }
    c.fillStyle = EDGE[h]; c.fill(line);
    if (!compact && LOD < 1) {
      const r = 2.6 * G.ww * G.k, gr = c.createRadialGradient(sh.mid[0], sh.mid[1] - 0.3 * r, 0.05 * r, sh.mid[0], sh.mid[1], r);
      gr.addColorStop(0, SKIN_HI[h]); gr.addColorStop(0.5, SKIN[h]); gr.addColorStop(1, SKIN_DK[h]);
      c.fillStyle = gr;
    } else c.fillStyle = SKIN[h];
    c.fill(body);
    if (!compact && LOD < 1) {
      // tendons, the knuckles' light, the light along each finger, the joints' creases
      const u = G.ww * G.k;
      const ten = new Path2D(), cre = new Path2D(), knb = new Path2D(), hi = new Path2D();
      for (let i = 0; i < 4; i++) {
        const kq = sh.kn[i], m = sh.kAt(MOFF[i + 2] * sh.p.spread * 0.55, -1.6);
        ten.moveTo(lerp(sh.wc[0], kq[0], 0.18), lerp(sh.wc[1], kq[1], 0.18)); ten.quadraticCurveTo(m[0], m[1], lerp(sh.wc[0], kq[0], 0.9), lerp(sh.wc[1], kq[1], 0.9));
        knb.moveTo(kq[0] + u * 0.2, kq[1] + 1); knb.ellipse(kq[0], kq[1] + 1, u * 0.2, u * 0.13, 0, 0, Math.PI * 2);
      }
      for (const fg of sh.fingers) {
        const P = fg.pts;
        hi.moveTo(P[0][0] - 1, P[0][1]); hi.lineTo(P[1][0] - 1, P[1][1]); hi.lineTo(P[2][0] - 1, P[2][1]);
        for (const i of [1, 2]) {
          const [x0, y0] = P[i - 1], [x1, y1] = P[i + 1];
          let nx = y1 - y0, ny = -(x1 - x0); const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
          const rr = fg.rr[i] * 0.85;
          cre.moveTo(P[i][0] - nx * rr, P[i][1] - ny * rr); cre.quadraticCurveTo(P[i][0] + (x1 - x0) * 0.04, P[i][1] + (y1 - y0) * 0.04, P[i][0] + nx * rr, P[i][1] + ny * rr);
        }
      }
      c.lineCap = "round"; c.lineJoin = "round";
      c.globalAlpha = 0.45; c.strokeStyle = SKIN_HI[h];
      c.lineWidth = Math.max(1, u * 0.07); c.stroke(ten);
      c.lineWidth = Math.max(1, u * 0.12); c.stroke(hi);
      c.globalAlpha = 0.65; c.fillStyle = SKIN_HI[h]; c.fill(knb);
      c.globalAlpha = 1; c.strokeStyle = SKIN_LO[h]; c.lineWidth = Math.max(0.8, u * 0.035); c.stroke(cre);
    }
    // see-through over the keys (the lit keys and their letters show): 58 %, 3 px to full at the front edge
    c.globalCompositeOperation = "destination-out";
    c.fillStyle = "rgba(0,0,0,.42)"; c.fillRect(sh.box[0], 0, sh.box[1] - sh.box[0], G.H - 2);
    c.fillStyle = "rgba(0,0,0,.2)"; c.fillRect(sh.box[0], G.H - 2, sh.box[1] - sh.box[0], 3);
    // under the hand (destination-over: behind what's drawn): the keys going down, then the shadows
    c.globalCompositeOperation = "destination-over";
    const u = G.ww;
    for (const fg of sh.p.fingers) {
      const F = fg.F, kq = F.key;
      if (!(F.press > 0.02 && F.hold && kq)) continue;
      const dp = F.press;
      c.globalAlpha = dp;
      if (!kq.black) {
        // a white key going down: its front darker toward the edge, slivers open at its sides, its lip lower
        const x = G.x0 + (kq.x - 0.5) * u;
        c.fillStyle = H.down; c.fillRect(x + 0.5, G.bh * 0.7, u - 1, G.H - G.bh * 0.7);
        c.fillStyle = "rgba(10,10,25,.85)";
        c.fillRect(x + 0.5, G.H * 0.62, 1.3, G.H * 0.38); c.fillRect(x + u - 1.8, G.H * 0.62, 1.3, G.H * 0.38); c.fillRect(x + 0.5, G.H - 2.5 * dp, u - 1, 2.5 * dp);
      } else {
        const x = G.x0 + kq.x * u - G.bw / 2;
        c.fillStyle = "rgba(0,0,0,.6)"; c.fillRect(x, G.bh * 0.75, G.bw, G.bh * 0.25);
      }
      c.globalAlpha = 1;
    }
    if (LOD < 2) {
      // the fingertips' contact shadows (a lifted finger's parts from it — the next one's cue): one union
      const sp = new Path2D(), hu = u * G.k;
      for (const fg of sh.p.fingers) {
        const F = fg.F, lift = Math.max(0, F.h - F.hk) / G.k + sh.p.lift / G.k;
        const [x, y] = toS({ x: F.x, z: F.z, h: F.hk });
        const r = WID[F.f] * hu * (0.42 + 0.18 * lift), ex = x + lift * hu * 0.22, ey = y + 1 + lift * G.S * 0.35;
        sp.moveTo(ex + r, ey); sp.ellipse(ex, ey, r, r * 0.55, 0, 0, Math.PI * 2);
      }
      c.fillStyle = `rgba(10,5,30,${(0.3 * (1 - Math.min(0.6, 0.5 * sh.p.lift / G.k))).toFixed(3)})`; c.fill(sp);
    }
    // the nails: sprites, at full strength — the thumb under the hand seen through it
    c.globalCompositeOperation = "source-over";
    const r = SPR.sz / 2;
    for (const n of sh.nails) {
      c.globalAlpha = n.hidden ? 0.6 : 1;
      c.drawImage(SPR[h][n.st][n.f], n.x - r, n.y - r, 2 * r, 2 * r);
    }
    c.globalAlpha = 1;
  }

  // --- the plan ---------------------------------------------------------------------------------------
  function replan() {
    if (!dirty || !G) return;
    dirty = false;
    for (const h of ["r", "l"]) {
      const L = lists[h];
      L.sort((a, b) => a.t - b.t || a.midi - b.midi);
      const o = opt[h];
      plans[h] = L.length || o.start ? planHand(L, h, G, { start: o.start || null, anchor: o.anchor ?? -Infinity, until: o.until ?? -Infinity }) : null;
    }
  }
  // The keys the hand rests on now (its position), if it shows: a hand that goes on glides from there.
  function keysNow(h, t) {
    const P = plans[h];
    if (!P || !lastPoses[h]) return null;
    const fr = frameAt(P, t, G, false);
    return P.frames[fr.k1].map((k) => k.m);
  }

  // --- a frame --------------------------------------------------------------------------------------
  // The watchdog: more than 10 % of 120 frames late (> 20 ms) — a level of detail less (1 no details,
  // 2 no shadows, 3 the shapes at most every other frame; the place every frame). No recovery until
  // the next layout.
  function watchdog(now) {
    if (WD.last) WD.gaps.push(now - WD.last);
    WD.last = now;
    if (WD.gaps.length < 120) return;
    const late = WD.gaps.filter((g) => g > 20).length / WD.gaps.length;
    WD.gaps = [];
    if (late > 0.1 && LOD < 3) { LOD++; WD.steps.push({ at: Math.round(now), lod: LOD, late: +late.toFixed(2) }); for (const H of Object.values(HS)) H.sig = null; }
  }
  function render(t) {
    if (!G) return false;
    replan();
    FRAME++;
    STAT.frames++;
    const rm = !!mq?.matches;
    const poses = {};
    for (const h of ["l", "r"]) {
      const tt = freeze[h] != null ? Math.min(t, freeze[h]) : t;
      poses[h] = plans[h] ? poseAt(plans[h], tt, G, rm, t) : null;
      if (poses[h]) poses[h].t = tt;
    }
    yieldHands(poses.l, poses.r, G);
    lastPoses = poses;
    let changed = false;
    // the hand in the air on top; else the right — unless the left crossed over it
    const top = poses.l && poses.r && (poses.l.lift > poses.r.lift + 0.01 || poses.l.K.x > poses.r.K.x - 1) ? "l" : "r";
    for (const h of ["l", "r"]) {
      const H = HS[h], p = poses[h];
      const z = h === top ? "2" : "1";
      if (H.z !== z) { H.z = z; H.el.style.zIndex = z; }
      let op = 0;
      if (p) {
        const st = nailStates(p, rm), sh = shapeOf(p, h);
        sh.nails = placeNails(sh, st);
        // the canvas's place: centred on the knuckles, on the device-pixel grid (moved every frame); its
        // drawing, relative to it, only when that changed — at LOD 3 at most every other frame unless a
        // finger went down or up (the old drawing moves with the hand meanwhile)
        const tx = Math.round((G.x0 + p.K.x * G.ww - H.W / 2) * G.dpr) / G.dpr;
        const sig = sigOf(sh, tx);
        const pressNow = sh.nails.map((n) => (n.st === "on" ? 1 : 0)).join("");
        const skip = sameSig(sig, H.sig) || (LOD >= 3 && (FRAME & 1) === 1 && pressNow === H.press && H.sig != null);
        if (!skip) { drawHand(H, sh, tx); H.sig = sig; H.press = pressNow; H.draws++; STAT.draws++; changed = true; }
        else STAT.skips++;
        if (tx !== H.at) { H.at = tx; H.el.style.transform = `translate3d(${tx}px,0,0)`; changed = true; }
        op = p.vis * (p.dim ?? 1);
        if (rm) { const T = frameAt(p.P, p.t, G, true).T; if (T && p.t >= T.t1 && p.t - T.t1 < XFADE) op *= 0.35 + 0.65 * ((p.t - T.t1) / XFADE); }
        if (setLands(h, st.lands, p.vis)) changed = true;
      } else if (setLands(h, [], 0)) changed = true;
      op = Math.round(op * 100) / 100;
      if (op !== H.op) { H.op = op; H.el.style.opacity = String(op); changed = true; }
    }
    return changed;
  }
  // The hands' own loop (idle — a press's chord, a selection, the fade after ▶ stops): until nothing
  // has changed for STILL frames. ▶ drives them itself (tick).
  // (until when something is still to change: a fade, a finger let go, a move — a frozen hand: never)
  function quietAt() {
    let q = -Infinity;
    for (const h of ["r", "l"]) {
      const P = plans[h];
      if (!P) continue;
      if (freeze[h] != null) { q = Math.max(q, freeze[h]); continue; }
      const v = P.vis[P.vis.length - 1], tr = P.trans[P.trans.length - 1];
      let ev = -Infinity;
      for (const n of P.notes) ev = Math.max(ev, n.ev);
      q = Math.max(q, v ? v.b : -Infinity, ev + 0.15, tr ? tr.t1 : -Infinity);
    }
    return q;
  }
  function loop() {
    raf = 0;
    if (gone || driven || !G) return;
    watchdog(performance.now());
    const t = clock();
    if (render(t)) still = 0;
    else if (++still >= STILL && t > quietAt()) return;
    raf = requestAnimationFrame(loop);
  }
  function kick() {
    still = 0;
    if (!raf && !driven && G && !gone) raf = requestAnimationFrame(loop);
  }
  // (a hand stopped: its held notes let go at t, nothing after; it stays shown until `until`)
  function stopAt(h, t, until) {
    const L = lists[h];
    const now = keysNow(h, t);
    lists[h] = L.filter((n) => n.t <= t);
    for (const n of lists[h]) if (n.t + n.d > t) n.d = Math.max(0.03, t - n.t);
    opt[h] = { start: lists[h].length ? null : now ? { keys: now, t } : null, anchor: null, until };
    freeze[h] = null;
  }

  const api = {
    layer,
    layout,
    get on() { return !!G; },
    // ▶'s notes as it schedules them: [{ id, h, f, midi, keys, fid, t, d }] (its clock)
    notes(list, tv) {
      setClock(tv);
      const now = clock();
      for (const n of list) {
        const h = n.h === "l" ? "l" : "r";
        if (opt[h].anchor == null) opt[h].anchor = now; // (a hand not showing rises in from now — ▶'s start)
        lists[h].push(n);
      }
      for (const h of ["r", "l"]) if (lists[h].length > 64) lists[h] = lists[h].filter((n) => n.t + n.d > now - WINDOW);
      showKey.r = showKey.l = "";
      dirty = true;
    },
    // ▶ rescheduled from `at` (a speed change, a chip): what starts later is dropped (fed again)
    cut(at, tv) {
      setClock(tv);
      for (const h of ["r", "l"]) lists[h] = lists[h].filter((n) => n.t <= at + 1e-6);
      dirty = true;
    },
    // ▶ stopped (or about to start again): the hands rest where they are, then fade
    clear(tv) {
      setClock(tv);
      const t = clock();
      for (const h of ["r", "l"]) stopAt(h, t, t + HIDE_AFTER);
      driven = false;
      showKey.r = showKey.l = "";
      dirty = true;
      kick();
    },
    tick(tv) {
      setClock(tv);
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      driven = true;
      STAT.ticks++;
      watchdog(performance.now());
      render(tv);
    },
    // Idle: a press's chord or a selection's first onset — the hand glides there (or rises in), presses
    // (strike) or waits just before its notes; null: what showed lets go and fades.
    show(pose, tv) {
      if (driven) return;
      setClock(tv);
      const t = clock();
      let any = false;
      for (const h of ["r", "l"]) {
        const want = pose?.[h]?.keys?.length ? pose[h] : null;
        const key = want ? JSON.stringify([want.keys, want.down, !!want.strike]) : "";
        if (key === showKey[h]) {
          // (the same chord let go: its fingers come up, the hand stays while it's shown)
          if (want?.up && !showUp[h]) {
            showUp[h] = true;
            any = true;
            for (const n of lists[h]) if (n.t + n.d > t) n.d = Math.max(0.12, t - n.t); // (a quick tap: pressed briefly once there)
            opt[h].until = t + HIDE_AFTER + 0.5;
          }
          continue;
        }
        showKey[h] = key;
        showUp[h] = false;
        any = true;
        seq++;
        if (!want) { stopAt(h, t, t + 0.5); continue; } // (what showed fades from now)
        const from = keysNow(h, t);
        let dist = 0;
        if (from) {
          const c = (ks) => ks.slice(1).reduce((s, m) => s + (keyU(G, m)?.x ?? 0), 0) / 4;
          dist = Math.abs(c(from) - c(want.keys));
        }
        const at = t + (from ? clamp(0.12 + 0.035 * dist, 0.15, 0.3) : 0.2) + LEAD;
        lists[h] = (want.down || []).map((d) => ({ h, f: d.f, midi: d.midi, keys: want.keys, fid: "s" + seq, t: at, d: want.strike ? 3600 : 0.05 }));
        opt[h] = { start: from ? { keys: from, t } : null, anchor: t, until: want.strike ? -Infinity : Infinity }; // (a selection's hand stays shown)
        freeze[h] = want.strike ? null : at - 0.2;
      }
      if (!any) return;
      dirty = true;
      kick();
    },
    debug() {
      const pose = (p) => p && {
        vis: +p.vis.toFixed(3), lift: +p.lift.toFixed(3),
        wrist: +toS(p.W)[1].toFixed(1), knuckles: +toS(p.K)[1].toFixed(1),
        tips: p.fingers.map((fg) => { const [x, y] = toS(fg.T); return { f: fg.f, x: +x.toFixed(1), y: +y.toFixed(1), u: +fg.F.x.toFixed(3), key: fg.F.key?.m ?? null, hold: fg.F.hold, press: +fg.F.press.toFixed(2) }; }),
      };
      return {
        on: !!G, mode: G?.mode ?? "none", band: G?.band ?? 0, k: G ? +G.k.toFixed(3) : null, u: G ? +G.ww.toFixed(2) : null, lod: LOD, steps: WD.steps.slice(),
        driven, looping: !!raf, draws: STAT.draws, skips: STAT.skips, frames: STAT.frames, ticks: STAT.ticks,
        notes: { r: lists.r.length, l: lists.l.length },
        plan: Object.fromEntries(["r", "l"].map((h) => [h, plans[h] ? { notes: plans[h].notes.length, frames: plans[h].frames.length, moves: plans[h].trans.length } : null])),
        poses: { r: pose(lastPoses.r), l: pose(lastPoses.l) },
        canvases: Object.values(HS).map((H) => ({ h: H.el.dataset.h, w: H.el.width, h2: H.el.height, tx: H.at, op: H.op, draws: H.draws })),
        lands: [...LAND.r, ...LAND.l].filter((L) => L.a > 0).map((L) => ({ f: L.f, m: L.m ?? null, a: L.a })),
        clock: +clock().toFixed(3),
      };
    },
    destroy() {
      gone = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      for (const H of Object.values(HS)) { H.el.width = H.el.height = 0; }
      layer.remove();
    },
  };
  layer.__hand = api; // (tests: the layer's own instance)
  return api;
}
