// The drawn hand (E7 "hand" mode; docs/FINGERING.md "The drawn hand", the design: HAND.md there):
// where each hand is at any instant — pure, no DOM, so node tests sample it (tools/handcases.mjs).
// hand.js draws it.
//
//   const g = handGeo(kg, band)                  // the keys' layout (keyboard.js geo) + the band under them
//   const P = planHand(notes, "r", g, { start }) // a hand's moves from its notes
//   const p = poseAt(P, t, g, rm)                // its pose at t (closed form in t: no history)
//
// notes: [{ t, d (s, one clock), midi, f (1–5), fid (its five-finger position's id: a new id where
// the hand moves), keys: [m1…m5] (that position: the key each finger rests on, the thumb's first) }],
// in time order. start: { keys, t } — where the hand is now (a hand already showing glides from there).
// Model units: x in white keys across the keyboard; z depth from the keys' front edge (+ into the
// keys, − toward the player); h height. The hand's own size is × g.k.

export const LEAD = 0.08;   // s: the hand lands this long before the note (a pianist moves before it)
export const ARRIVE = 0.04; // s: a finger is on its key this long before it strikes
export const PREP = 0.36;   // s: a free finger travels to its next key at most this long ahead
export const RAISE = 0.24;  // s: a finger lifts, then strikes, in this window before its note
export const REL = 0.09;    // s: a finger let go goes back to its place in the hand
export const GAP = 2.5;     // s: a hand silent this long goes (fades out, comes back before its next note)
export const NEXT = 0.42, NEXT_FAR = 0.7; // s: the next finger's ring (and a far landing's badge) this early
export const LAG_W = 0.11, LAG_E = 0.2;   // s: the wrist, then the forearm, follow the knuckles this late
export const XFADE = 0.15;  // s: reduced motion — a new position fades in
export const HAND_MIN = 20, COMPACT_MIN = 14; // px a white key: the full hand, the compact one (else none)

const WHITE = new Set([0, 2, 4, 5, 7, 9, 11]);
const isWhite = (m) => WHITE.has(((m % 12) + 12) % 12);
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const ease5 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (x * (6 * x - 15) + 10));
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, s) => a + (b - a) * s;

// The band under the keys (px): from the keys' height — never the song's range, so another view's
// range doesn't move the music — 0 where a white key is under COMPACT_MIN px (numbers instead).
export function bandOf(kh, ww, phone) {
  if (!(ww >= COMPACT_MIN) || !(kh > 0)) return 0;
  return Math.round((phone ? 0.6 : 0.8) * kh);
}

// The hand's geometry from the keys' (keyboard.js geo: W, H, lo, hi, ww, x0, whites, bh, bw) and the
// band: its size against a white key (k: the same hand on wider keys splays its fingers to them),
// px a model unit deep below the keys (Sb: knuckles → wrist fill 0.87 of the band, the forearm runs
// on, faded) and over them (S: their own foreshortening), where a fingertip sits on a key.
export function handGeo(kg, band) {
  const u = kg.ww, H = kg.H, bh = kg.bh;
  const idx = new Map(kg.whites.map((m, i) => [m, i]));
  const mode = !band ? "none" : u >= HAND_MIN ? "full" : u >= COMPACT_MIN ? "compact" : "none";
  const k = band ? clamp(band / (3.2 * u), 0.68, 1) : 1;
  return {
    W: kg.W, H, lo: kg.lo, hi: kg.hi, ww: u, x0: kg.x0, whites: kg.whites, idx, bh, bw: kg.bw, band, mode, k,
    Sb: band ? band / (5.35 * k) : 1,
    S: clamp((H - bh) / 2.1, 0.5 * u, 0.95 * u),
    tipW: H - 0.36 * (H - bh), // a fingertip on a white key: 36 % up its front zone
    tipB: bh - 0.13 * bh,      // …on a black key: just behind its front end
    CH: H + band,
    rD: clamp(0.3 * u * Math.max(k, 0.85), 5.5, 11), // a nail's disc (px)
  };
}

// A key's place in white keys from the first white key: its centre, and whether it's black.
export function keyU(g, m) {
  if (m == null) return null;
  m = clamp(m, g.lo, g.hi);
  if (isWhite(m)) return { x: g.idx.get(m) + 0.5, black: false, m };
  const i = g.idx.get(m + 1);
  return { x: i == null ? g.idx.get(m - 1) + 1 : i, black: true, m };
}
// (a position's keys, every one a key: a missing one takes its neighbour's place a step over)
function frameKeys(g, keys) {
  const out = keys.map((m) => keyU(g, m));
  for (let i = 0; i < 5; i++) {
    if (out[i]) continue;
    const j = out.findIndex(Boolean);
    out[i] = j < 0 ? keyU(g, 60) : { ...out[j], x: out[j].x + (i - j) };
  }
  return out;
}

// A hand's plan: its positions (frames — a new one wherever the notes' fid changes, so a repeat or a
// loop's next round is an ordinary move), the moves between them (t0 → t1, landing LEAD before the new
// position's first note), each note's release (ev: let go early to move on, or as the hand flies),
// what each finger plays (byF), when the hand shows (vis), where each position lands (land).
// opts: start { keys, t } (a hand already showing: frame 0, the glide from there), anchor (s: it
// shows no earlier — ▶'s start), until (s: it stays shown at least this long — stopped).
export function planHand(notes, h, g, { start = null, anchor = -Infinity, until = -Infinity } = {}) {
  const side = h === "r" ? 1 : -1;
  const ns = [], frames = [], F = [];
  if (start) { frames.push(frameKeys(g, start.keys)); F.push({ first: start.t + 0.03, last: start.t - 0.03 }); }
  let fid;
  for (const n0 of notes) {
    if (!(n0.f >= 1 && n0.f <= 5)) continue;
    if (!frames.length || n0.fid !== fid) { fid = n0.fid; frames.push(frameKeys(g, n0.keys)); F.push({ first: Infinity, last: -Infinity }); }
    const n = { t: n0.t, d: Math.max(0.03, n0.d), midi: n0.midi, f: n0.f, id: n0.id, p: frames.length - 1, k: keyU(g, n0.midi) };
    const G = F[n.p];
    G.first = Math.min(G.first, n.t); G.last = Math.max(G.last, n.t);
    ns.push(n);
  }
  const centre = (k) => (k[1].x + k[2].x + k[3].x + k[4].x) / 4;
  const trans = [];
  let upTo = start ? start.t : -Infinity; // (when the notes before let go: a hand gone meanwhile comes back in its new place)
  let j = 0;
  for (let k = 1; k < frames.length; k++) {
    const a = F[k - 1], b = F[k];
    for (; j < ns.length && ns[j].p < k; j++) upTo = Math.max(upTo, ns[j].t + ns[j].d);
    if (!Number.isFinite(b.first) || !Number.isFinite(a.last)) continue;
    if (b.first - upTo >= GAP) { const at = b.first - 0.8; trans.push({ k, t0: at, t1: at, dist: 0, lift: 0, far: false, gone: true }); continue; }
    const dist = Math.abs(centre(frames[k]) - centre(frames[k - 1]));
    let t1 = b.first - LEAD;
    let t0 = Math.max(t1 - clamp(0.14 + 0.035 * dist, 0.14, 0.5), a.last + 0.03);
    // (fast: as quick as it can, never before the last note it leaves — at worst landing on the note)
    if (t1 - t0 < 0.07) { t0 = Math.max(a.last + 0.005, t1 - 0.07); t1 = Math.max(t1, t0 + 0.05); }
    // a long way: the hand lifts off and flies (an arc), a held note let go as it leaves
    trans.push({ k, t0, t1, dist, lift: dist > 4.5 ? Math.min(1.6, 0.16 * dist) : 0, far: dist > 4.5 });
  }
  // A new position's first notes: can their fingers go there on their own? A key another finger holds
  // between where a finger was and where it goes blocks it (the thumb passes under 2–4, 2–4 over the
  // thumb). Blocked until just before it must land: it waits; through its landing: the hand moves as
  // one, its held notes let go as it leaves.
  for (const tr of trans) {
    if (tr.gone) continue;
    if (tr.far) { tr.unit = true; continue; }
    const old = frames[tr.k - 1], hx = (k) => side * k.x;
    for (const n of ns) {
      if (n.p !== tr.k || Math.abs(n.t - F[tr.k].first) > 1e-6) continue;
      const arrive = n.t - ARRIVE, from = arrive - PREP;
      const a = hx(old[n.f - 1]), b = hx(n.k), lo = Math.min(a, b) + 0.3, hi = Math.max(a, b) - 0.3;
      let block = -Infinity;
      for (const m of ns) {
        if (m.t > arrive + 1) break;
        if (m === n || m.f === n.f || m.t >= arrive || m.t + m.d <= from) continue;
        const ok = (n.f === 1 && m.f <= 4) || (m.f === 1 && n.f <= 4), x = hx(m.k);
        if (!ok && x > lo && x < hi) block = Math.max(block, m.t + m.d);
      }
      if (block > arrive - 0.08) tr.unit = true;
      else if (block > -Infinity) n.after = block;
    }
  }
  const byF = [[], [], [], [], [], []];
  for (const n of ns) {
    n.ev = n.t + n.d;
    for (const tr of trans) if (tr.unit && tr.t0 > n.t && tr.t0 < n.ev && n.p < tr.k) n.ev = Math.max(n.t + 0.06, tr.t0);
    byF[n.f].push(n);
  }
  // a finger that moves on to another key leaves this one a little early (the key's light is the sound's)
  for (const list of byF) for (let i = 0; i + 1 < list.length; i++) {
    const n = list[i], m = list[i + 1], d = Math.abs(m.k.x - n.k.x) + (m.k.black !== n.k.black ? 0.4 : 0);
    if (d < 0.01) continue;
    n.ev = Math.min(n.ev, Math.max(n.t + 0.06, m.t - ARRIVE - clamp(0.07 + 0.04 * d, 0.08, 0.2)));
  }
  // a finger still holding a note of the old position when the hand would land (the thumb passed
  // under while 3 holds E): the hand follows once it's let go, in time for the next note
  for (const tr of trans) {
    if (tr.unit || tr.gone) continue;
    let held = -Infinity, nextNon = Infinity;
    for (const n of ns) {
      if (n.p < tr.k && n.t < tr.t1 && n.ev > tr.t1) held = Math.max(held, n.ev);
      if (n.p === tr.k && n.t > F[tr.k].first + 1e-6) nextNon = Math.min(nextNon, n.t);
    }
    if (held === -Infinity) continue;
    const a = Math.max(tr.t0, held - 0.04);
    tr.t0 = a; tr.wait = true; // (legato: the new note's finger went ahead alone; the palm follows the release)
    tr.t1 = Math.max(a + 0.06, Math.min(nextNon - LEAD, a + clamp(0.14 + 0.035 * tr.dist, 0.14, 0.4)));
  }
  // one move at a time, in order: a palm still on its way when the next move must start lands then
  // (a held note's finger stays on its key, the hand stretched after it)
  for (let i = trans.length - 2; i >= 0; i--) {
    const tr = trans[i], nx = trans[i + 1];
    if (tr.t1 <= nx.t0) continue;
    tr.t1 = nx.t0;
    tr.t0 = Math.min(tr.t0, tr.t1 - 0.03);
  }
  // a position squeezed to a moment between two moves isn't stopped at: the hand goes on from the one before
  for (let i = trans.length - 2; i >= 0; i--) {
    const tr = trans[i], nx = trans[i + 1];
    if (tr.gone || nx.gone || tr.t1 - tr.t0 >= 0.06 || nx.t0 - tr.t1 > 1e-6) continue;
    nx.from = tr.from ?? tr.k - 1;
    nx.t0 = tr.t0;
    nx.dist = Math.max(nx.dist, tr.dist);
    trans.splice(i, 1);
  }
  const land = frames.map(() => -Infinity), unit = frames.map(() => false), far = frames.map(() => false);
  for (const tr of trans) { land[tr.k] = tr.t1; unit[tr.k] = !!tr.unit; far[tr.k] = tr.far; }
  for (const n of ns) {
    const first = Math.abs(n.t - F[n.p].first) < 1e-6;
    n.lead = first && !unit[n.p];
    n.far = first && far[n.p];
  }
  const vis = [];
  if (start) vis.push({ a: start.t - 1, b: start.t });
  for (const n of ns) {
    const last = vis[vis.length - 1];
    if (last && n.t - last.b < GAP) last.b = Math.max(last.b, n.ev);
    else vis.push({ a: n.t, b: n.ev });
  }
  // (anchor: a hand not showing yet rises in from there — not one already showing, whose segment began before)
  for (const v of vis) { v.a = v.a >= anchor ? Math.max(v.a - 0.75, anchor) : v.a - 0.75; v.b += 0.55; }
  if (vis.length && until > vis[vis.length - 1].b) vis[vis.length - 1].b = until;
  return { h, notes: ns, frames, trans, byF, vis, land, side, F };
}

// The pose at time t — closed form in t (a freeze, a seek, a loop or a speed change needs no history).
const TIPOFF = [0, -2.05, -1.0, 0, 1.0, 2.0];      // a tip's place in a five-finger position (keys; RH, LH mirrored)
export const MOFF = [0, -1.3, -1.2, -0.4, 0.38, 1.12];    // the knuckles across the hand (the thumb: its root)
export const MARCH = [0, -2.05, 0.02, 0.14, 0.08, -0.1];  // …and forward (the knuckle line's arch)
export const MH = [0, 0.72, 1.25, 1.3, 1.25, 1.12];       // …and up
const LEN = [null, [1.75, 1.3, 1.05], [1.62, 1.0, 0.82], [1.8, 1.12, 0.88], [1.7, 1.06, 0.85], [1.32, 0.8, 0.72]]; // phalanges
export const WID = [0, 0.76, 0.6, 0.63, 0.58, 0.5]; // finger widths
const PALM = 3.05; // knuckles → wrist

const zOf = (g, k) => (k.black ? (g.H - g.tipB) / g.S : (g.H - g.tipW) / g.S);
// A finger's anchor (where it rests or holds: the hand follows these) and its tip.
function fingerAt(P, f, t, fr, g, rm) {
  const k = g.k, rk0 = P.frames[fr.k0][f - 1], rk1 = P.frames[fr.k1][f - 1];
  const rx = lerp(rk0.x, rk1.x, fr.s), rz0 = lerp(zOf(g, rk0), zOf(g, rk1), fr.s), rhk = lerp(rk0.black ? 0.5 : 0, rk1.black ? 0.5 : 0, fr.s);
  const rz = f === 1 ? rz0 - 0.25 : rz0;
  const list = P.byF[f];
  let lo = 0, hi = list.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].t - ARRIVE <= t) lo = m + 1; else hi = m; }
  const cur = list[lo - 1] || null, nxt = list[lo] || null;
  let x = rx, z = rz, hk = rhk, press = 0, hold = false, w = f === 1 ? 0.45 : 1, h = 0, travel = 0, free = 1;
  let ax = rx, az = rz;
  const at = (kk) => [kk.x, zOf(g, kk) - (f === 1 ? 0.25 : 0), kk.black ? 0.5 : 0];
  if (cur && t <= cur.ev) {
    [x, z, hk] = at(cur.k); ax = x; az = z; hold = true; w = 8; free = 0;
    press = rm ? (t >= cur.t ? 1 : 0) : ease((t - (cur.t - 0.02)) / 0.045) * (1 - ease((t - (cur.ev - 0.035)) / 0.07));
  } else if (cur && t < cur.ev + REL && !rm) {
    const s = ease((t - cur.ev) / REL), [kx, kz, kk] = at(cur.k);
    x = lerp(kx, rx, s); z = lerp(kz, rz, s); hk = lerp(kk, rhk, s);
    ax = x; az = z; w = lerp(8, w, s); free = Math.max(0.1, s); // (a finger let go yields at once)
  }
  let nextIn = Infinity, toward = null;
  if (nxt) {
    nextIn = nxt.t - t;
    const arrive = nxt.t - ARRIVE, [kx, kz, kk] = at(nxt.k);
    toward = { x: kx, z: kz, hk: kk, far: nxt.far, m: nxt.k.m };
    if (!hold && !rm) {
      // (it waits for the hand to land in the note's position — or, a lead, for a finger in its way —
      // unless that comes too late to travel: then it goes on its own, the hand stretched after it)
      const gate = nxt.lead ? nxt.after ?? -Infinity : P.land[nxt.p];
      const start = Math.max(cur ? cur.ev : -Infinity, arrive - PREP, gate < arrive - 0.06 ? gate : -Infinity);
      if (t >= start && arrive > start) {
        const s = ease5((t - start) / (arrive - start)), d = Math.abs(kx - x);
        x = lerp(x, kx, s); z = lerp(z, kz, s); hk = lerp(hk, kk, s); free *= 1 - s;
        // travelling: over the others (a finger) or under the hand (the thumb)
        if (d > 0.6) { travel = Math.sin(Math.PI * s) * Math.min(1, d / 2); h += (f === 1 ? 0.12 : 0.75) * k * travel; }
        const s3 = s * s * s; // (the hand feels a finger on its way only as it arrives)
        w = lerp(w, 8, s3); ax = lerp(ax, kx, s3); az = lerp(az, kz, s3);
      }
      // lift, then strike, in the RAISE window before the note (shorter after a note just let go)
      const win = Math.min(RAISE, nxt.t - (cur ? cur.ev : -Infinity));
      if (nextIn < win && win > 0.05) h += 0.5 * k * (win / RAISE) * Math.sin(Math.PI * (1 - nextIn / win));
    }
  }
  // (pressing lowers the tip a key's dip: the finger curls — none with reduced motion)
  return { f, x, z, h: hk + h - (rm ? 0 : 0.42 * press), hk, press, hold, key: hold ? cur.k : null, w, ax, az, rx, free, nextIn, toward, travel, lift: Math.max(0, h) };
}
export function frameAt(P, t, g, rm) {
  const tr = P.trans;
  let lo = 0, hi = tr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (tr[m].t0 <= t) lo = m + 1; else hi = m; }
  const T = tr[lo - 1];
  if (!T) return { k0: 0, k1: 0, s: 0, lift: 0, T: null };
  if (t >= T.t1 || T.t1 <= T.t0) return { k0: T.k, k1: T.k, s: 0, lift: 0, T };
  const raw = (t - T.t0) / (T.t1 - T.t0), k0 = T.from ?? T.k - 1;
  if (rm) return { k0, k1: k0, s: 0, lift: 0, T }; // (reduced motion: the old place until it lands)
  return { k0, k1: T.k, s: ease5(raw), lift: g.k * T.lift * Math.sin(Math.PI * raw), T };
}
export function visAt(P, t) {
  for (const v of P.vis) if (t >= v.a && t <= v.b) return Math.min(ease((t - v.a) / 0.35), ease((v.b - t) / 0.45));
  return 0;
}
// The knuckles' centre from the fingers' anchors (held keys pull hardest; the thumb least).
function baseAt(P, t, g, rm) {
  const fr = frameAt(P, t, g, rm), fs = [], k = g.k;
  let sx = 0, sw = 0, blk = 0, pr = 0, fx = 0, fw = 0;
  for (let f = 1; f <= 5; f++) {
    const F = fingerAt(P, f, t, fr, g, rm);
    fs.push(F);
    sx += F.w * (F.ax - P.side * TIPOFF[f]);
    sw += F.w;
    blk += F.w * (F.hk > 0.25 ? 1 : 0);
    pr = Math.max(pr, F.press);
    const rw = f === 1 ? 0.45 : 1;
    fx += rw * (F.rx - P.side * TIPOFF[f]); fw += rw;
  }
  const x = sx / sw, dx = x - fx / fw;
  for (const F of fs) F.x += F.free * dx; // (free fingers keep their place in the hand)
  // fingers 2–5 keep their order, at least 0.8 of a key apart: where two meet, the freer one gives way
  const sd = P.side;
  for (let pass = 0; pass < 3; pass++) for (let i = 1; i < 4; i++) {
    const a = fs[i], b = fs[i + 1], gap = sd * (b.x - a.x);
    if (gap >= 0.8) continue;
    const need = 0.8 - gap, fa = a.free, fb = b.free;
    if (fa + fb < 1e-6) continue;
    a.x -= sd * need * (fa / (fa + fb)); b.x += sd * need * (fb / (fa + fb));
  }
  // …and never cross: where there isn't room for that (1 and 5 a third apart), the free ones bunch up
  for (let pass = 0; pass < 4; pass++) for (let i = 1; i < 4; i++) {
    const a = fs[i], b = fs[i + 1], gap = sd * (b.x - a.x), fa = a.free, fb = b.free;
    if (gap >= 0 || fa + fb < 1e-6) continue;
    a.x += sd * gap * (fa / (fa + fb)); b.x -= sd * gap * (fb / (fa + fb));
  }
  return { x, z: k * (-1.6 + 0.55 * (blk / sw) - 0.1 * pr), h: k + fr.lift, lift: fr.lift, fs, fr };
}
// The whole pose: the knuckles, the wrist (LAG_W late) and the elbow (LAG_E late) — the same function
// evaluated earlier, so the forearm swings after the knuckles with no state —, the hand's axis from the
// wrist to the knuckles, each finger's joints (inverse kinematics in its own plane). null: not shown.
// visT: when its visibility is read (a hand held still before its notes — a selection — still rises in).
export function poseAt(P, t, g, rm = false, visT = t) {
  if (!P || !P.frames.length) return null;
  const vis = visAt(P, visT);
  if (vis <= 0) return null;
  const k = g.k, K = baseAt(P, t, g, rm), nW = g.whites.length, centreX = nW / 2;
  const elbowAt = (bx) => ({ x: centreX + P.side * 0.16 * nW + (bx - centreX) * 0.5, z: -13 * k });
  const KW = rm ? K : baseAt(P, t - LAG_W, g, rm), KE = rm ? K : baseAt(P, t - LAG_E, g, rm);
  const E = elbowAt(KE.x), EW = elbowAt(KW.x);
  let dx = KW.x - EW.x, dz = KW.z - EW.z, dl = Math.hypot(dx, dz) || 1;
  dx = 0.25 * dx / dl; dz = 0.75 + 0.25 * dz / dl; dl = Math.hypot(dx, dz);
  const Wr = { x: KW.x - (dx / dl) * PALM * k, z: KW.z - (dz / dl) * PALM * k, h: 0.95 * k + KW.lift };
  let bx = K.x - Wr.x, bz = K.z - Wr.z;
  const bl = Math.hypot(bx, bz) || 1; bx /= bl; bz /= bl;
  { const a = clamp(Math.atan2(bx, bz), -0.4, 0.4); bx = Math.sin(a); bz = Math.cos(a); }
  Wr.x = K.x - bx * PALM * k; Wr.z = K.z - bz * PALM * k;
  // the thumb tucked under turns the hand a little (the elbow goes out)
  const th = K.fs[0], under = clamp((P.side * (th.x - K.x) + 1.0) / 1.4, 0, 1);
  const rot = -P.side * 0.12 * under, c = Math.cos(rot), s = Math.sin(rot);
  [bx, bz] = [bx * c - bz * s, bx * s + bz * c];
  const ax = P.side * bz, az = -P.side * bx;
  const span = Math.abs(K.fs[4].x - K.fs[1].x);
  const spread = clamp(span / 3.0, 0.88, 1.12);
  const enter = 1.3 * k * (1 - vis); // (comes in from below)
  const kz = K.z - enter, wz = Wr.z - enter;
  const fingers = [];
  for (let f = 1; f <= 5; f++) {
    const F = K.fs[f - 1];
    const ma = MOFF[f] * k * (f === 1 ? 1 : spread), mb = MARCH[f] * k;
    const M = { x: K.x + ax * ma + bx * mb, z: kz + az * ma + bz * mb, h: MH[f] * k + K.lift - (f > 1 ? 0.06 * k * F.press : 0) };
    const T = { x: F.x, z: F.z - enter, h: F.h + K.lift * (F.hold ? 0 : 1) };
    fingers.push({ f, M, T, F, j: joints(f, M, T, k) });
  }
  const p = { P, vis, K: { x: K.x, z: kz, h: K.h }, W: { x: Wr.x, z: wz, h: Wr.h }, E: { x: E.x, z: E.z - enter }, ax, az, bx, bz, lift: K.lift, under, fingers, spread, dim: 1 };
  // the thumb bowed out to its side
  const j = fingers[0].j;
  j[1] = { ...j[1], x: j[1].x - ax * 0.28 * k, z: j[1].z - az * 0.28 * k };
  j[2] = { ...j[2], x: j[2].x - ax * 0.2 * k, z: j[2].z - az * 0.2 * k };
  return p;
}
// A finger's joints: three segments in the vertical plane through its knuckle and tip, the end joint
// bending with the middle one (fingers curl together), solved for the middle joint's bend.
function joints(f, M, T, k) {
  const L1 = LEN[f][0] * k, L2 = LEN[f][1] * k, L3 = LEN[f][2] * k, ck = f === 1 ? 0.45 : 0.72;
  let dx = T.x - M.x, dz = T.z - M.z;
  const D = Math.max(0.01, Math.hypot(dx, dz)), V = M.h - T.h, R = Math.hypot(D, V), Lm = L1 + L2 + L3;
  dx /= D; dz /= D;
  const end = (b) => [L1 + L2 * Math.cos(-b) + L3 * Math.cos(-b - ck * b), L2 * Math.sin(-b) + L3 * Math.sin(-b - ck * b)];
  let b = 0, sc = 1;
  if (R >= Lm) sc = R / Lm;
  else {
    let lo = 0, hi = 2.1;
    for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2, e = end(m); if (e[0] * e[0] + e[1] * e[1] > R * R) lo = m; else hi = m; }
    b = (lo + hi) / 2;
  }
  const e = end(b), a = Math.atan2(-V, D) - Math.atan2(e[1], e[0]);
  const out = [{ x: M.x, z: M.z, h: M.h }];
  let s = 0, v = 0;
  const angs = [a, a - b, a - b - ck * b], Ls = [L1, L2, L3];
  for (let i = 0; i < 3; i++) {
    s += sc * Ls[i] * Math.cos(angs[i]); v += sc * Ls[i] * Math.sin(angs[i]);
    out.push({ x: M.x + s * dx, z: M.z + s * dz, h: M.h + v });
  }
  return out;
}
// Two hands near each other: a hand at rest makes way for the one at work — slides out of its span
// (and dims a little); both at work stay as they are (the one in the air drawn on top).
function busyOf(p) {
  let b = 0;
  for (const fg of p.fingers) b += Math.max(0, fg.F.w - (fg.f === 1 ? 0.45 : 1)) / 7 + (fg.F.nextIn < 0.8 ? 1 - fg.F.nextIn / 0.8 : 0);
  return clamp(b, 0, 2) / 2;
}
function shiftPose(p, dx) {
  p.K.x += dx; p.W.x += dx; p.E.x += dx;
  for (const fg of p.fingers) { fg.M.x += dx; fg.T.x += dx; fg.F.x += dx; for (const q of fg.j) q.x += dx; }
}
export function yieldHands(L, R, g) {
  if (!L || !R) return;
  let lb = -Infinity, ra = Infinity;
  for (const fg of L.fingers) for (const q of fg.j) lb = Math.max(lb, q.x);
  for (const fg of R.fingers) for (const q of fg.j) ra = Math.min(ra, q.x);
  const over = lb + 0.5 * g.k - ra;
  if (over <= 0) return;
  const il = 1 - busyOf(L), ir = 1 - busyOf(R), sum = il + ir;
  if (sum < 1e-3) return;
  const dl = Math.min(3, over * il * (il / sum)), dr = Math.min(3, over * ir * (ir / sum));
  if (dl > 0.01) { shiftPose(L, -dl); L.dim = 1 - 0.3 * Math.min(1, dl / 2); }
  if (dr > 0.01) { shiftPose(R, dr); R.dim = 1 - 0.3 * Math.min(1, dr / 2); }
}

// What each finger shows: on (it plays: the disc filled), next (the hand's next onset within NEXT —
// a far landing's NEXT_FAR — ringed), rest (its digit); hidden: the thumb under the hand (its disc
// seen through). And the landing badges: a next finger still more than half a key from its key.
export function nailStates(p, rm = false) {
  let soon = Infinity;
  for (const fg of p.fingers) if (!fg.F.hold) soon = Math.min(soon, fg.F.nextIn);
  const out = [], lands = [];
  for (const fg of p.fingers) {
    const F = fg.F, win = F.toward?.far ? NEXT_FAR : NEXT;
    const next = !F.hold && soon < win && F.nextIn <= soon + 0.02;
    const on = F.hold && F.press > 0.5;
    const hidden = F.f === 1 && p.under > 0.55;
    out.push({ f: F.f, st: on ? "on" : next ? "next" : "rest", pr: on ? 3 : next ? 2 : hidden ? 0 : 1, hidden });
    const far = F.toward ? Math.hypot(F.toward.x - F.x, (F.toward.z - F.z) * 0.6) : 0;
    if (next && F.toward && far > 0.45) lands.push({ f: F.f, x: F.toward.x, z: F.toward.z, hk: F.toward.hk, m: F.toward.m, a: (rm ? 1 : ease(1 - F.nextIn / win)) * clamp((far - 0.45) / 0.5, 0, 1) });
  }
  return { out, lands };
}
