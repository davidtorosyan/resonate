// Piano fingering (E7, docs/FINGERING.md §3): a hand and a finger for every note of a keyboard part,
// and each hand's positions for the ghost hand. Pure: plain arrays and objects in, plain out; no DOM,
// so it runs in a Worker (finger-worker.js). Deterministic: the same notes give the same fingering, in
// whatever order they come; ties go to the lower state index.
//
//   const res = fingerNotes(items, { hand: "sb" });
//
// INPUT — items, one per note of the keyboard part: playtime.js track(S.T, { bars: written order, keep:
// the keyboard part, base }) items, with staff and hand from the timeline's element (S.Tid), as play.js
// projects them (docs/FINGERING.md §3 "Input"):
//   { id     string    the note's id (ensureIds's n<i>)
//     q      number    written quarters from the start of the score (written order: repeats not taken)
//     t      number    seconds at 100% (track's `sec`)
//     d      number    seconds it sounds: track's `hold` for a struck note (its ties joined); for a key
//                      struck twice at once (a unison's twin, `sound` false) its own `dur`
//     midi   integer   sounding pitch
//     staff  integer   1, 2, … (for the caller; the hand comes in `hand`)
//     hand   "r" | "l" | null   the staff's hand: piano staff 1 "r", the last "l", a middle one by its
//                      clef; a hymn's treble part "r", bass "l"; null — a one-staff piano: every onset open
//     tied   boolean   a tie's continuation (track: sound false — its start's `d` covers it)
//     grace  boolean   a grace note: a hand, no finger (v1)
//     pin    0–5       a printed finger (<technical><fingering>), 0 none
//     arp    boolean   in an <arpeggiate> chord: its hand's span isn't limited }
// Missing fields default (t from q at ♩=90, d 0, hand null); an item without a finite midi or q is left out.
//
// OUTPUT — { notes: Map(id → { h: "r" | "l", f: 1–5 | 0, p, x }), frames: { r: [{ q0, keys: [m1…m5] }], l }, ms }
//   h  the hand that plays it          f  its finger (0: none — a grace note, or `w`)
//   p  index of its hand's frame (frames[h][p]; -1 when that hand has none)
//   x  flags, in this order: "m" moved to the other hand than its staff's, "w" too wide (no finger:
//      the hand can't reach it), "t" a tie's continuation (its start's hand and finger — no finger, f
//      0, when its key was let go early, or ended, at or before it: the pedal holds it), "g" a grace
//      note; "" none. A unison's twin and a tie's continuation carry their key's "m" / "w".
//   frames  per hand, the key each finger rests on (keys[0] = the thumb's midi, … keys[4] = the fifth's)
//      from written quarter q0 on; ms  how long it took.
//
// HOW (docs/FINGERING.md §3): Stage A gives every key a hand (assignHands: the staff's, except at an
// onset its hands can't play — then other splits are tried, an exact Viterbi), Stage B the fingers of
// each hand (fingerHand: a first-order Viterbi over the fingers of the hand's sounding keys, Parncutt et
// al. 1997 / Jacobs 2001 / Balliauw et al. 2017 costs), then the hand positions (framesOf).
// Distances in Balliauw's units: 14 an octave (keyX).

// Bumped with any change in output (as omr/engine.js ENGINE_N): a stored fingering of another ALG is
// worked out again. tools/fingercases.mjs fails when the output changes and this doesn't.
export const ALG = 2;

// Finger spans, the right hand, from Balliauw, Herremans, Palhazi Cuervo & Sörensen 2017, "A variable
// neighbourhood search algorithm to generate piano fingerings for polyphonic sheet music", International
// Transactions in Operational Research 24(3), DOI 10.1111/itor.12211 — preprint
// https://dorienherremans.com/sites/default/files/ITOR_VNS_APF_preprint.pdf (checked 2026-11-22):
// Table 1 (a large hand), Table 9 (small), Table 10 (medium), adapted there from Parncutt et al. 1997 to
// the 14-unit keyboard. Per finger pair a-b (a < b): the distance x(b) − x(a) on the right hand,
//   [MinPrac, MinComf, MinRel, MaxRel, MaxComf, MaxPrac]
// (b − a the other way round: negated and swapped; the left hand: the same on −x).
export const SPANS = Object.freeze({
  l: Object.freeze({ // Table 1, large
    12: [-10, -8, 1, 6, 9, 11], 13: [-8, -6, 3, 9, 13, 15], 14: [-6, -4, 5, 11, 14, 16], 15: [-2, 0, 7, 12, 16, 18],
    23: [1, 1, 1, 2, 5, 7], 24: [1, 1, 3, 4, 6, 8], 25: [2, 2, 5, 6, 10, 12], 34: [1, 1, 1, 2, 2, 4], 35: [1, 1, 3, 4, 6, 8], 45: [1, 1, 1, 2, 4, 6],
  }),
  s: Object.freeze({ // Table 9, small: 1–5 comfortable to a seventh (12), at most an octave (14)
    12: [-7, -5, 1, 3, 8, 10], 13: [-6, -4, 3, 6, 10, 12], 14: [-4, -2, 5, 8, 11, 13], 15: [-2, 0, 7, 10, 12, 14],
    23: [1, 1, 1, 2, 4, 6], 24: [1, 1, 3, 4, 6, 8], 25: [2, 2, 5, 6, 8, 10], 34: [1, 1, 1, 2, 2, 4], 35: [1, 1, 3, 4, 6, 8], 45: [1, 1, 1, 2, 4, 6],
  }),
  m: Object.freeze({ // Table 10, medium: an octave comfortable, a ninth at most
    12: [-8, -6, 1, 5, 8, 10], 13: [-7, -5, 3, 9, 12, 14], 14: [-5, -3, 5, 11, 13, 15], 15: [-2, 0, 7, 12, 14, 16],
    23: [1, 1, 1, 2, 5, 7], 24: [1, 1, 3, 4, 6, 8], 25: [2, 2, 5, 6, 10, 12], 34: [1, 1, 1, 2, 2, 4], 35: [1, 1, 3, 4, 6, 8], 45: [1, 1, 1, 2, 4, 6],
  }),
});

// The costs (docs/FINGERING.md §3's tables), one place.
export const COST = Object.freeze({
  // Stage A — hands
  LEAVE: 3,       // a key moved off its staff's hand
  LET: 2,         // a held key let go early (the pedal holds it) — Stage B too
  COMF: 2,        // a unit past comfortable (rule 1); a hand's spread, a finger pair's stretch
  PRAC: 10,       // a unit past practical (rule 13)
  OVER5: 10,      // a key over five in one hand
  MOVE: 0.5,      // a unit a hand's centre moved since it last struck
  // Stage B — fingers
  REL_THUMB: 1, REL: 2, // a unit outside the relaxed span (rule 2): thumb pairs, the others
  FOUR: 1,        // finger 4 (Jacobs 2001: the one weak finger)
  THREE_FOUR: 1,  // 3 and 4 one after the other (rule 6)
  FOUR_BLACK: 1,  // 3 on a white key and 4 on a black one, one after the other (rule 7)
  THUMB_BLACK: 1, // the thumb on a black key (rule 8) — ×BEGIN
  THUMB_SIDE: 1,  // … beside another finger on a white key, before or after
  FIVE_SIDE: 1,   // 5 on a black key beside another finger on a white key (rule 9)
  PASS: 1,        // the thumb passing or crossed on the same level (rule 10)
  PASS_BLACK: 3,  // … onto a black thumb from a white key (rule 11)
  SAME_KEY: 1,    // the same key again with another finger (rule 15)
  JUMP: 10,       // a unit the hand's anchor moves × urgency, where the hand can lift — ×BEGIN
  URGENT: 0.05,   // urgency = max(URGENT, URGENT s / gap)
  LIFT: 0.15,     // s between onsets from which the hand can lift
  BEGIN: 2,       // beginner weights (hand "…b"): the thumb on black and hand jumps ×2
});

const POS = [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12]; // a semitone's place in the 14-unit octave
const SEMI = [0, 1, 2, 3, 4, -1, 5, 6, 7, 8, 9, 10, 11, -1]; // and back (5, 13: E–F, B–C: no key)
// A key's place: 14 units an octave, every semitone 1 but E–F and B–C 2 (Balliauw: an imaginary black
// key where there is none). C4 (60) = 70; odd = a black key.
export const keyX = (midi) => 14 * Math.floor(midi / 12) + POS[((midi % 12) + 12) % 12];
const midiOfX = (x) => { const o = Math.floor(x / 14), s = SEMI[x - 14 * o]; return s < 0 ? null : 12 * o + s; };
const black = (x) => (x & 1) === 1;

const OFF = [0, 0, 2, 4, 6, 8]; // a finger's rest place from the thumb's: a five-finger position
const QEPS = 1e-4; // quarters: notes this close start together
const TOL = 1e-3;  // s: a key that ends this close to an onset isn't held through it
const EPS = 1e-9;  // costs: strictly lower
const MAXA = 256;  // Stage A's states at one onset (a one-staff piano, where every onset is open): the best kept
const NONE = Object.freeze([]);

// hand: "s" | "m" | "l" (small, medium, large), "b" after it = the beginner weights (v1 always: "sb", "mb", "lb").
function handOf(hand) {
  const h = typeof hand === "string" && /^[sml]/.test(hand) ? hand : "sb";
  return { id: h, size: h[0], beg: h.includes("b") ? COST.BEGIN : 1, span: SPANS[h[0]] };
}

// The span bounds of an ordered finger pair a → b, the right hand: [MinPrac, MinComf, MinRel, MaxRel,
// MaxComf, MaxPrac] of x(b) − x(a). The same finger twice: all 0 (Balliauw).
function bounds(span, a, b) {
  if (a === b) return [0, 0, 0, 0, 0, 0];
  if (a < b) return span[10 * a + b];
  const [p0, c0, r0, r1, c1, p1] = span[10 * b + a];
  return [-p1, -c1, -r1, -r0, -c0, -p0];
}
const outside = (d, lo, hi) => (d < lo ? lo - d : d > hi ? d - hi : 0);

// Per hand size, tables of the distance rules by finger pair and distance (d from -DM to DM):
// dist = rules 1 + 2 + 13 between consecutive notes, vert = inside a chord (rule 14: rules 1 and 2
// twice, 13 once), vertArp = vert without rule 13 (an arpeggiated chord's span isn't limited).
const DM = 160;
const TABLES = {};
function tables(size) {
  if (TABLES[size]) return TABLES[size];
  const span = SPANS[size], W = 2 * DM + 1;
  const dist = new Float64Array(25 * W), vert = new Float64Array(25 * W), vertArp = new Float64Array(25 * W);
  for (let a = 1; a <= 5; a++) for (let b = 1; b <= 5; b++) {
    const [p0, c0, r0, r1, c1, p1] = bounds(span, a, b), rel = a === 1 || b === 1 ? COST.REL_THUMB : COST.REL;
    const base = ((a - 1) * 5 + (b - 1)) * W;
    for (let d = -DM; d <= DM; d++) {
      const r1c = COST.COMF * outside(d, c0, c1), r2 = rel * outside(d, r0, r1), r13 = COST.PRAC * outside(d, p0, p1);
      dist[base + d + DM] = r1c + r2 + r13;
      vertArp[base + d + DM] = 2 * (r1c + r2);
      vert[base + d + DM] = 2 * (r1c + r2) + r13;
    }
  }
  return (TABLES[size] = { dist, vert, vertArp, W });
}
const look = (tab, W, a, b, d) => tab[((a - 1) * 5 + (b - 1)) * W + Math.max(-DM, Math.min(DM, d)) + DM];

// Rising finger sets of m keys (C(5, m)), in lexicographic order: Stage B's states for m sounding keys.
const COMBOS = [[[]]];
for (let m = 1; m <= 5; m++) {
  const out = [];
  const rec = (from, acc) => { if (acc.length === m) { out.push(acc.slice()); return; } for (let f = from; f <= 5; f++) { acc.push(f); rec(f + 1, acc); acc.pop(); } };
  rec(1, []);
  COMBOS.push(out);
}

const POW6 = Array.from({ length: 20 }, (_, i) => 6 ** i); // (a state's code: a finger a base-6 digit per key)
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Items → keys and onsets. A key is one struck key: a unison's twins are one key (home: both staves'
// hands), a tie's continuation is its start's key. → { keys, slices, graces, link: item → key }.
function prepare(items) {
  const list = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || it.id == null) continue;
    const midi = Math.round(Number(it.midi)), q = Number(it.q);
    if (!Number.isFinite(midi) || !Number.isFinite(q)) continue;
    const t = Number.isFinite(Number(it.t)) ? Number(it.t) : (q * 60) / 90;
    const d = Number(it.d) > 0 ? Number(it.d) : 0;
    const pin = Number.isInteger(it.pin) && it.pin >= 1 && it.pin <= 5 ? it.pin : 0;
    list.push({ id: String(it.id), q, t, d, midi, staff: Number(it.staff) || 0, home: it.hand === "r" ? 1 : it.hand === "l" ? 2 : 0,
      tied: !!it.tied, grace: !!it.grace, pin, arp: !!it.arp });
  }
  // (a total order: the same result whatever order the items come in)
  list.sort((a, b) => a.q - b.q || a.midi - b.midi || a.grace - b.grace || a.tied - b.tied || a.staff - b.staff || byId(a, b));
  const keys = [], slices = [], graces = [], link = new Map();
  const last = new Map(); // midi → the latest key struck on it
  let sl = null;
  for (const e of list) {
    if (e.grace) { graces.push(e); continue; }
    if (e.tied) {
      const k = last.get(e.midi);
      if (k != null && keys[k].q < e.q - QEPS && keys[k].end > e.t - TOL) { link.set(e, k); continue; }
      // (a continuation whose start isn't here — a stretch starting mid-tie: struck)
    }
    if (!sl || e.q > sl.q + QEPS) { sl = { q: e.q, t: e.t, keys: [] }; slices.push(sl); }
    let k = sl.keys.find((i) => keys[i].midi === e.midi);
    if (k === undefined) {
      k = keys.length;
      keys.push({ midi: e.midi, x: keyX(e.midi), q: sl.q, t: sl.t, end: e.t + e.d, home: 0, arp: false, pin: 0, s: slices.length - 1, items: [] });
      sl.keys.push(k);
    }
    const K = keys[k];
    K.items.push(e);
    K.home |= e.home;
    K.end = Math.max(K.end, e.t + e.d);
    K.arp ||= e.arp;
    if (e.pin && !K.pin) K.pin = e.pin;
    last.set(e.midi, k);
    link.set(e, k);
  }
  for (const s of slices) s.keys.sort((a, b) => keys[a].x - keys[b].x);
  return { keys, slices, graces, list, link };
}

// ---------------------------------------------------------------------------------------------------
// Stage A — hands. At each onset the staff's hands play their staves' keys (a key both staves strike:
// either hand), unless they can't — a hand would span past its practical limit or take more than 5 keys
// with every held key let go (D2): only there are other splits tried (the k lowest struck keys to the
// left hand, the rest to the right), so moves stay rare. A held key keeps its hand (crossing allowed for
// it) or is let go early. Costs: LEAVE a key moved off its staff's hand, LET a held key let go, a hand's
// spread over its struck and kept keys (COMF a unit past the comfortable 1–5 span, PRAC past the
// practical one, OVER5 a key over 5), MOVE a unit its centre (the middle of its struck keys) moved since
// it last struck. A state = the hand of every sounding key + each hand's last centre: an exact Viterbi
// over those moves (up to MAXA states at once). Let-go options per striking hand: its lowest i and
// highest j held keys, those that lower its spread only (a key kept now can be let go at its next strike
// for the same LET). Then a key still past a practical span or over 5 is flagged `w`: the inner keys
// (the right hand's lowest, the left hand's highest) — so the bass and the melody keep theirs.
// → { keys, slices, graces, link, hand: Int8Array (0 right, 1 left), moved, wide (Uint8Array),
//     let: Int32Array (the onset a key was let go early at, -1), cost, states (most at one onset), size }
export function assignHands(items, opts = {}) {
  const H = handOf(opts.hand);
  const P = prepare(items);
  const { keys, slices } = P;
  const comf = H.span[15][4], prac = H.span[15][5];
  const X = (k) => keys[k].x;

  const spread = (struck, kept, arp) => {
    const lo = Math.min(X(struck[0]), kept.length ? X(kept[0]) : Infinity);
    const hi = Math.max(X(struck[struck.length - 1]), kept.length ? X(kept[kept.length - 1]) : -Infinity);
    const n = struck.length + kept.length, sp = hi - lo;
    return (arp ? 0 : COST.COMF * Math.max(0, sp - comf) + COST.PRAC * Math.max(0, sp - prac)) + COST.OVER5 * Math.max(0, n - 5);
  };
  const breaks = (list, arp) => list.length > 5 || (!arp && list.length > 1 && X(list[list.length - 1]) - X(list[0]) > prac);

  // A hand's options at an onset: [{ cost, kept, let, c }] (struck and carried ascending by x).
  const handOpts = (struck, carried, lastC) => {
    if (!struck.length) return [{ cost: 0, kept: carried, let: [], c: lastC }];
    const arp = struck.some((k) => keys[k].arp);
    const c = (X(struck[0]) + X(struck[struck.length - 1])) / 2;
    const move = Number.isNaN(lastC) ? 0 : COST.MOVE * Math.abs(c - lastC);
    const h = carried.length, out = [];
    for (let tot = 0; tot <= h; tot++) for (let i = 0; i <= tot; i++) {
      const j = tot - i, kept = carried.slice(i, h - j), sp = spread(struck, kept, arp);
      if (out.some((o) => o.i <= i && o.j <= j && o.sp <= sp + EPS)) continue; // (dominated: let go later for the same)
      out.push({ i, j, sp, cost: COST.LET * tot + sp + move, kept, let: [...carried.slice(0, i), ...carried.slice(h - j)], c });
    }
    return out;
  };

  // An onset's splits of its struck keys: [{ hands: [0|1 per key], r, l, leave }].
  const splitsOf = (st) => {
    const mk = (hands) => {
      const r = [], l = [];
      let leave = 0;
      hands.forEach((h, i) => { (h ? l : r).push(st[i]); const home = keys[st[i]].home; if (home && !(home & (h ? 2 : 1))) leave += COST.LEAVE; });
      return { hands, r, l, leave };
    };
    // the staff split: every key on its staff's hand — a key both staves strike (home 3) on either, so
    // two splits when there is one: those that don't break the hands, else every other split too
    const out = [];
    if (st.every((k) => keys[k].home)) {
      out.push(mk(st.map((k) => (keys[k].home === 2 ? 1 : 0))));
      if (st.some((k) => keys[k].home === 3)) out.push(mk(st.map((k) => (keys[k].home === 1 ? 0 : 1))));
      const fine = out.filter((sp) => !breaks(sp.r, sp.r.some((k) => keys[k].arp)) && !breaks(sp.l, sp.l.some((k) => keys[k].arp)));
      if (fine.length) return fine;
    }
    for (let k = 0; k <= st.length; k++) {
      const hands = st.map((_, i) => (i < k ? 1 : 0));
      if (!out.some((o) => o.hands.every((h, i) => h === hands[i]))) out.push(mk(hands));
    }
    return out;
  };

  // A state: pk = its sounding keys as 2·key + hand (ascending), cR / cL = each hand's last centre.
  const stateOf = (S, sp, a, b, cost) => {
    const pk = new Int32Array(a.kept.length + sp.r.length + b.kept.length + sp.l.length);
    let n = 0;
    for (const k of a.kept) pk[n++] = 2 * k;
    for (const k of sp.r) pk[n++] = 2 * k;
    for (const k of b.kept) pk[n++] = 2 * k + 1;
    for (const k of sp.l) pk[n++] = 2 * k + 1;
    pk.sort();
    return { pk, cR: a.c, cL: b.c, cost, back: { S, sp, let: a.let.length || b.let.length ? [...a.let, ...b.let] : NONE } };
  };
  let cur = [{ pk: new Int32Array(0), cR: NaN, cL: NaN, cost: 0, back: null }];
  let most = 1;
  const cands = [];
  for (let s = 0; s < slices.length; s++) {
    const sl = slices[s], st = sl.keys;
    const splits = splitsOf(st);
    cands.length = 0;
    for (const S of cur) {
      const carR = [], carL = [];
      for (let i = 0; i < S.pk.length; i++) {
        const k = S.pk[i] >> 1, K = keys[k];
        // (still sounding, and not struck again now: a restrike ends it)
        if (!(K.end > sl.t + TOL)) continue;
        let again = false;
        for (const k2 of st) if (keys[k2].midi === K.midi) { again = true; break; }
        if (!again) (S.pk[i] & 1 ? carL : carR).push(k);
      }
      if (carR.length > 1) carR.sort((a, b) => X(a) - X(b));
      if (carL.length > 1) carL.sort((a, b) => X(a) - X(b));
      for (const sp of splits) {
        const oR = handOpts(sp.r, carR, S.cR), oL = handOpts(sp.l, carL, S.cL);
        for (const a of oR) for (const b of oL) cands.push(S, sp, a, b, S.cost + sp.leave + a.cost + b.cost);
      }
    }
    let next;
    if (cands.length === 5) next = [stateOf(cands[0], cands[1], cands[2], cands[3], cands[4])]; // (most onsets: one way on)
    else {
      next = [];
      const at = new Map();
      for (let c = 0; c < cands.length; c += 5) {
        const [S, sp, a, b, cost] = cands.slice(c, c + 5);
        const state = stateOf(S, sp, a, b, cost);
        const key = state.pk.join(",") + "|" + a.c + "|" + b.c;
        const ex = at.get(key);
        if (ex === undefined) { at.set(key, next.length); next.push(state); } else if (cost < next[ex].cost - EPS) next[ex] = state;
      }
    }
    most = Math.max(most, next.length);
    if (next.length > MAXA) {
      const idx = next.map((_, i) => i).sort((u, v) => next[u].cost - next[v].cost || u - v).slice(0, MAXA).sort((u, v) => u - v);
      cur = idx.map((i) => next[i]);
    } else cur = next;
  }

  const hand = new Int8Array(keys.length), moved = new Uint8Array(keys.length), wide = new Uint8Array(keys.length);
  const let_ = new Int32Array(keys.length).fill(-1);
  const heldAt = new Array(slices.length); // per onset: the kept held keys by hand, after it
  let best = cur[0];
  for (const S of cur) if (S.cost < best.cost - EPS) best = S;
  const cost = slices.length ? best.cost : 0;
  for (let s = slices.length - 1, S = best; s >= 0; s--, S = S.back.S) {
    const { sp } = S.back;
    sp.hands.forEach((h, i) => { hand[slices[s].keys[i]] = h; });
    for (const k of S.back.let) let_[k] = s;
    heldAt[s] = S;
  }
  for (let k = 0; k < keys.length; k++) { const home = keys[k].home; moved[k] = home && !(home & (hand[k] ? 2 : 1)) ? 1 : 0; }

  // `w`: what a hand still can't reach.
  for (let s = 0; s < slices.length; s++) {
    const st = slices[s].keys, S = heldAt[s], struckSet = new Set(st);
    for (const h of [0, 1]) {
      const struck = st.filter((k) => hand[k] === h);
      if (!struck.length) continue;
      const arp = struck.some((k) => keys[k].arp);
      let kept = [];
      for (const u of S.pk) { const k = u >> 1; if ((u & 1) === h && !struckSet.has(k) && (let_[k] < 0 || let_[k] > s)) kept.push(k); }
      kept.sort((a, b) => X(a) - X(b));
      const all = (u, v) => [...u, ...v].sort((a, b) => X(a) - X(b));
      if (!breaks(all(kept, struck), arp)) continue;
      const rem = struck.slice();
      while (breaks(rem, arp)) wide[h ? rem.pop() : rem.shift()] = 1;
      // (held keys still in the way: let go, the farthest from the struck keys first)
      const c = (X(rem[0]) + X(rem[rem.length - 1])) / 2;
      while (kept.length && breaks(all(kept, rem), arp)) {
        let far = 0;
        for (let i = 1; i < kept.length; i++) if (Math.abs(X(kept[i]) - c) > Math.abs(X(kept[far]) - c)) far = i;
        let_[kept[far]] = s;
        kept = kept.filter((_, i) => i !== far);
      }
    }
  }
  return { ...P, hand, moved, wide, let: let_, cost, states: most, size: H.id };
}

// ---------------------------------------------------------------------------------------------------
// Stage B — the fingers of one hand ("r", or "l": mirrored, −x, so finger 1 is on its highest key).
// A state = the fingers of the hand's sounding keys, rising with pitch (C(5, K) ≤ 10). Held keys keep
// their finger; when that leaves no state one is let go early (LET), and one more may be where keeping
// it costs more. A printed finger is forced (unless it leaves no state). The transition between two
// onsets of the hand: the pair costs from each key struck at the one before to each struck now, averaged
// (Al Kasimi et al. 2007), + inside the sounding keys (rule 14) + per key struck (finger 4, the thumb on
// black). Pair costs (docs/FINGERING.md §3's table): rules 1, 2, 13 by distance — where the hand can lift
// (onsets ≥ LIFT apart) the cheaper of those and the hand jump (JUMP a unit its anchor — a key's x less
// its finger's rest offset OFF — moves × urgency) —, three-to-four, four on black, the thumb and the
// fifth on black beside a white key, thumb passing, the same key with another finger. First-order;
// ties to the lower state index.
// → { f: Int8Array (a finger per key of this hand, 0 elsewhere), path: [{ s, q, k: [keys], m: [midis], f: [fingers] }]
//     (the hand's sounding fingered keys after each of its onsets, rising on its x), let: [[key, q]]
//     (keys let go early here, at the onset q), cost }
export function fingerHand(A, side, opts = {}) {
  const H = handOf(opts.hand ?? A.size);
  const hb = side === "l" ? 1 : 0, sg = hb ? -1 : 1;
  const { keys, slices } = A;
  const T = tables(H.size), vtab = T.vert, W = T.W;
  const nk = keys.length;
  const xp = new Int32Array(nk), pin = new Int8Array(nk);
  for (let k = 0; k < nk; k++) { xp[k] = sg * keys[k].x; pin[k] = keys[k].pin && !A.moved[k] ? keys[k].pin : 0; }

  const steps = [];
  for (let s = 0; s < slices.length; s++) {
    const b = slices[s].keys.filter((k) => A.hand[k] === hb && !A.wide[k]);
    if (!b.length) continue;
    if (hb) b.reverse(); // (rising on −x)
    steps.push({ s, q: slices[s].q, t: slices[s].t, b, arp: b.some((k) => keys[k].arp) });
  }
  // a key still held at step j: sounding through its onset, not let go by Stage A by then, not struck again there
  const alive = (k, j) => {
    const st = steps[j];
    if (!(keys[k].end > st.t + TOL)) return false;
    if (A.let[k] >= 0 && A.let[k] <= st.s) return false;
    const m = keys[k].midi;
    for (const k2 of slices[st.s].keys) if (keys[k2].midi === m) return false;
    return true;
  };

  const pairCost = (xa, fa, xb, fb, lift, urg) => {
    const d = xb - xa;
    // (where the hand can lift, the jump instead of the distance rules when it's cheaper: 5–5 on an
    // octave bass is a lift, a thumb under in a scale a stretch)
    let c = look(T.dist, W, fa, fb, d);
    if (lift) { const jump = COST.JUMP * urg * H.beg * Math.abs(xb - OFF[fb] - (xa - OFF[fa])); if (jump < c) c = jump; }
    const ba = black(xa), bb = black(xb);
    if ((fa === 3 && fb === 4) || (fa === 4 && fb === 3)) c += COST.THREE_FOUR;
    if ((fa === 3 && !ba && fb === 4 && bb) || (fa === 4 && ba && fb === 3 && !bb)) c += COST.FOUR_BLACK;
    if (fb === 1 && bb && fa !== 1 && !ba) c += COST.THUMB_SIDE;
    if (fa === 1 && ba && fb !== 1 && !bb) c += COST.THUMB_SIDE;
    if (fb === 5 && bb && fa !== 5 && !ba) c += COST.FIVE_SIDE;
    if (fa === 5 && ba && fb !== 5 && !bb) c += COST.FIVE_SIDE;
    if ((fa === 1 && fb !== 1 && d < 0) || (fa !== 1 && fb === 1 && d > 0)) { // (the thumb passes under / is crossed)
      const thumb = fa === 1 ? ba : bb, other = fa === 1 ? bb : ba;
      if (thumb === other) c += COST.PASS; else if (thumb) c += COST.PASS_BLACK;
    }
    if (d === 0 && fa !== fb) c += COST.SAME_KEY;
    return c;
  };

  const f = new Int8Array(nk);
  let cur = [{ k: NONE, f: NONE, cost: 0, back: null }];
  // per step (reused): the keys a state may hold, numbered (U: a state is a number, a finger a base-6
  // digit a key); which are still held; the layouts of the sounding keys per kept set; the costs inside
  // a sounding set; the next states by code; the pair costs from the onset before (M); one state's row.
  const U = new Map(), held = new Map(), layouts = new Map(), within = new Map(), at = new Map();
  const M = new Float64Array(625), row = new Float64Array(25);
  let fixedAt = new Int8Array(32);
  let j = 0, B = null, nb = 0, last = false, numeric = true, A_ = null, na = 0, vt = vtab, cars = null;

  // the sounding keys for a kept set: kept + struck, rising on x — one layout per kept set, for every state
  const layout = (ck, mask) => {
    let bits = numeric ? 0 : "";
    for (let i = 0; i < ck.length; i++) if (!(mask & (1 << i))) { if (numeric) bits += 2 ** U.get(ck[i]); else bits += U.get(ck[i]) + ","; }
    let L = layouts.get(bits);
    if (L) return L;
    const m = ck.length - popcount(mask) + nb;
    L = { m, K: new Array(m), isB: new Array(m), bi: new Array(m), up: new Array(m), rel: new Array(m) }; // (small plain arrays: cheaper than typed ones to make)
    const kept = [];
    for (let x = 0; x < ck.length; x++) if (!(mask & (1 << x))) kept.push(ck[x]);
    for (let u = 0, i = 0, b = 0; u < m; u++) {
      const takeB = b < nb && (i >= kept.length || xp[B[b]] < xp[kept[i]]);
      const k = takeB ? B[b] : kept[i];
      L.K[u] = k; L.isB[u] = takeB ? 1 : 0; L.bi[u] = takeB ? b : -1; L.up[u] = U.get(k);
      L.rel[u] = last ? 0 : takeB || alive(k, j + 1) ? 1 : 0; // (what the next step can see: an exact merge)
      if (takeB) b++; else i++;
    }
    layouts.set(bits, L);
    return L;
  };
  const inside = (L, combo) => {
    let c = 0;
    for (let u = 0; u < L.m; u++) {
      if (L.isB[u]) {
        if (combo[u] === 4) c += COST.FOUR;
        if (combo[u] === 1 && black(xp[L.K[u]])) c += COST.THUMB_BLACK * H.beg;
      }
      for (let v = u + 1; v < L.m; v++) if (L.isB[u] || L.isB[v]) c += look(vt, W, combo[u], combo[v], xp[L.K[v]] - xp[L.K[u]]);
    }
    return c;
  };
  const run = (pins) => {
    const next = [];
    at.clear();
    for (let pi = 0; pi < cur.length; pi++) {
      const P = cur[pi], { ck, cf } = cars[pi], c = ck.length;
      row.fill(0, 0, nb * 5);
      for (let ai = 0; ai < na; ai++) {
        const fa = P.f[P.k.indexOf(A_[ai])];
        const base = (ai * 5 + fa - 1) * nb * 5;
        for (let x = 0; x < nb * 5; x++) row[x] += M[base + x];
      }
      fixedAt.fill(0, 0, U.size);
      for (let i = 0; i < c; i++) fixedAt[U.get(ck[i])] = cf[i];
      let found = -1; // the fewest let go that leaves a state, and one more
      for (let lv = 0; lv <= c && (found < 0 || lv <= found + 1); lv++) {
        for (const mask of MASKS[c][lv]) {
          const L = layout(ck, mask);
          if (L.m > 5) continue;
          let any = false;
          for (const combo of COMBOS[L.m]) {
            let okc = true;
            for (let u = 0; u < L.m; u++) {
              if (L.isB[u]) { if (pins && pin[L.K[u]] && combo[u] !== pin[L.K[u]]) { okc = false; break; } }
              else if (combo[u] !== fixedAt[L.up[u]]) { okc = false; break; }
            }
            if (!okc) continue;
            any = true;
            let full, cd, pc = 0;
            if (numeric) {
              full = 0; cd = 0;
              for (let u = 0; u < L.m; u++) { const v = combo[u] * POW6[L.up[u]]; full += v; if (L.rel[u]) cd += v; }
            } else {
              full = ""; cd = "";
              for (let u = 0; u < L.m; u++) { const v = L.up[u] + ":" + combo[u] + ","; full += v; if (L.rel[u]) cd += v; }
            }
            let w = within.get(full);
            if (w === undefined) within.set(full, (w = inside(L, combo)));
            if (na) { for (let u = 0; u < L.m; u++) if (L.isB[u]) pc += row[L.bi[u] * 5 + combo[u] - 1]; pc /= na * nb; }
            const cost = P.cost + pc + w + COST.LET * lv;
            const ex = at.get(cd);
            if (ex !== undefined && !(cost < next[ex].cost - EPS)) continue;
            const state = { k: L.K, f: combo, cost, back: P };
            if (ex === undefined) { at.set(cd, next.length); next.push(state); } else next[ex] = state;
          }
          if (any && found < 0) found = lv;
        }
      }
    }
    return next;
  };

  for (j = 0; j < steps.length; j++) {
    const st = steps[j], prev = j ? steps[j - 1] : null;
    B = st.b; nb = B.length; last = j === steps.length - 1;
    U.clear(); held.clear(); layouts.clear(); within.clear();
    for (let i = 0; i < nb; i++) U.set(B[i], i);
    cars = cur.map((P) => {
      const ck = [], cf = [];
      for (let i = 0; i < P.k.length; i++) {
        const k = P.k[i];
        let a = held.get(k);
        if (a === undefined) { a = alive(k, j); held.set(k, a); }
        if (!a) continue;
        ck.push(k); cf.push(P.f[i]);
        if (!U.has(k)) U.set(k, U.size);
      }
      return { ck, cf };
    });
    numeric = U.size < POW6.length;
    if (fixedAt.length < U.size) fixedAt = new Int8Array(2 * U.size);
    A_ = prev ? prev.b : null; na = A_ ? A_.length : 0;
    let lift = false, urg = 0;
    if (prev) { const gap = st.t - prev.t; lift = gap >= COST.LIFT; urg = lift ? Math.max(COST.URGENT, COST.URGENT / gap) : 0; }
    for (let ai = 0; ai < na; ai++) for (let fa = 1; fa <= 5; fa++) for (let bi = 0; bi < nb; bi++) for (let fb = 1; fb <= 5; fb++)
      M[((ai * 5 + fa - 1) * nb + bi) * 5 + fb - 1] = pairCost(xp[A_[ai]], fa, xp[B[bi]], fb, lift, urg);
    vt = st.arp ? T.vertArp : vtab;
    let next = run(true);
    if (!next.length) next = run(false); // (printed fingers that leave no state: not forced here)
    cur = next;
  }

  let best = cur[0];
  for (const S of cur) if (S.cost < best.cost - EPS) best = S;
  const path = new Array(steps.length), let_ = [];
  for (let j = steps.length - 1, S = best; j >= 0; j--, S = S.back) {
    const st = steps[j], ks = Array.from(S.k), fs = Array.from(S.f);
    path[j] = { s: st.s, q: st.q, k: ks, m: ks.map((k) => keys[k].midi), f: fs };
    const struck = new Set(st.b);
    ks.forEach((k, i) => { if (struck.has(k)) f[k] = fs[i]; });
    // (held from before and not kept: let go early here)
    const kept = new Set(ks);
    for (const k of S.back.k) if (!kept.has(k) && alive(k, j)) let_.push([k, st.q]);
  }
  return { f, path, let: let_, cost: steps.length ? best.cost : 0 };
}
function popcount(m) { let n = 0; while (m) { n += m & 1; m >>= 1; } return n; }
// Let-go masks of c held keys by how many they let go: MASKS[c][n] (c ≤ 5: a state holds at most 5).
const MASKS = Array.from({ length: 6 }, (_, c) => {
  const by = Array.from({ length: c + 1 }, () => []);
  for (let m = 0; m < 1 << c; m++) by[popcount(m)].push(m);
  return by;
});

// ---------------------------------------------------------------------------------------------------
// Positions for the ghost hand: a hand's path cut into frames — the key each finger rests on: the played
// fingers (struck and held) on their keys, the others at their rest offsets between them, snapped to the
// nearest key, a white one first. An onset keeps the frame while every played finger is within 1 unit
// of its rest key; else a new frame. path: fingerHand's ([{ q, m: [midis], f: [fingers] }], rising on the
// hand's x). → { frames: [{ q0, keys: [m1…m5] }], p: Int32Array (the frame of each path step) }
export function framesOf(path, side) {
  const sg = side === "l" ? -1 : 1;
  const frames = [], p = new Int32Array(path.length);
  let rest = null; // x (the hand's own: −x for the left) per finger 1–5
  for (let j = 0; j < path.length; j++) {
    const fs = path[j].f, xs = path[j].m.map((m) => sg * keyX(m));
    if (rest && fs.every((fg, i) => Math.abs(xs[i] - rest[fg]) <= 1)) { p[j] = frames.length - 1; continue; }
    rest = restOf(xs, fs, sg);
    frames.push({ q0: path[j].q, keys: rest.slice(1).map((x) => midiOfX(sg * x)) });
    p[j] = frames.length - 1;
  }
  return { frames, p };
}

// The rest key of every finger (index 1–5, the hand's own x) from the played ones.
function restOf(xs, fs, sg) {
  const at = [null, null, null, null, null, null];
  fs.forEach((fg, i) => { at[fg] = xs[i]; });
  const real = (x) => midiOfX(sg * x) != null;
  for (let fg = 1; fg <= 5; fg++) {
    if (at[fg] != null) continue;
    let lo = -1, hi = -1;
    for (let g = fg - 1; g >= 1; g--) if (at[g] != null) { lo = g; break; }
    for (let g = fg + 1; g <= 5; g++) if (fs.includes(g)) { hi = g; break; }
    let target;
    if (lo > 0 && hi > 0) target = at[lo] + ((OFF[fg] - OFF[lo]) * (at[hi] - at[lo])) / (OFF[hi] - OFF[lo]);
    else if (lo > 0) target = at[lo] + OFF[fg] - OFF[lo];
    else target = at[hi] - (OFF[hi] - OFF[fg]);
    // between its neighbours: the nearest white key, else the nearest black one, else its lower neighbour's;
    // as near either way: above the played fingers the higher (an open hand: 3 on E♭ → 4 F, 5 G), the
    // thumb the higher too (tucked under: 2 on D♭ → the thumb on C), else the lower
    const floor = lo > 0 ? at[lo] : -Infinity, ceil = hi > 0 ? at[hi] : Infinity, up = hi < 0 || lo < 0;
    const from = Math.floor(Math.max(floor + 1, target - 8)), to = Math.ceil(Math.min(ceil - 1, target + 8));
    const better = (x, b) => { if (b == null) return true; const d = Math.abs(x - target), e = Math.abs(b - target); return d < e - EPS || (d <= e + EPS && up && x > b); };
    let pick = null, pickW = null;
    for (let x = from; x <= to; x++) {
      if (!real(x)) continue;
      if (!black(x)) { if (better(x, pickW)) pickW = x; } else if (better(x, pick)) pick = x;
    }
    at[fg] = pickW ?? pick ?? (lo > 0 ? at[lo] : at[hi]);
  }
  return at;
}

// ---------------------------------------------------------------------------------------------------
// The whole: hands, each hand's fingers and positions, every item's entry. opts.hand: "sb" (default).
// opts.debug: also { debug: { A, r, l } } (the stages' own results, for tests).
export function fingerNotes(items, opts = {}) {
  const t0 = now();
  const A = assignHands(items, opts);
  const { keys, slices } = A;
  const out = new Map(), frames = { r: [], l: [] }, stage = {};
  const frameAt = {}; // hand → (q) → its frame index
  const letQ = new Float64Array(keys.length).fill(Infinity); // the onset a key was let go early at (Stage A or B)
  for (let k = 0; k < keys.length; k++) if (A.let[k] >= 0) letQ[k] = slices[A.let[k]].q;
  for (const side of ["r", "l"]) {
    const R = fingerHand(A, side, opts);
    const F = framesOf(R.path, side);
    frames[side] = F.frames;
    for (let j = 0; j < R.path.length; j++) R.path[j].p = F.p[j];
    stage[side] = { ...R, frames: F };
    for (let k = 0; k < keys.length; k++) if (A.hand[k] === (side === "l" ? 1 : 0)) keys[k].f = R.f[k];
    for (const [k, q] of R.let) if (q < letQ[k]) letQ[k] = q;
    const fr = F.frames;
    frameAt[side] = (q) => {
      if (!fr.length) return -1;
      let lo = 0, hi = fr.length - 1;
      if (fr[0].q0 > q + QEPS) return 0;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (fr[mid].q0 <= q + QEPS) lo = mid; else hi = mid - 1; }
      return lo;
    };
  }
  const flags = (k) => (A.moved[k] ? "m" : "") + (A.wide[k] ? "w" : "");
  const H = (k) => (A.hand[k] ? "l" : "r");
  for (const e of A.list) {
    if (e.grace) {
      // the staff's hand, else the hand of the nearest key struck with it (or next)
      let h = e.home === 1 ? "r" : e.home === 2 ? "l" : null;
      if (!h) {
        const sl = slices.find((s) => s.q >= e.q - QEPS) || slices[slices.length - 1];
        let best = null;
        if (sl) for (const k of sl.keys) if (best == null || Math.abs(keys[k].x - keyX(e.midi)) < Math.abs(keys[best].x - keyX(e.midi))) best = k;
        h = best == null ? "r" : H(best);
      }
      out.set(e.id, { h, f: 0, p: frameAt[h](e.q), x: "g" });
      continue;
    }
    const k = A.link.get(e);
    if (k == null) continue;
    const h = H(k);
    const own = !e.tied || keys[k].items.includes(e);
    // (a continuation after its key was let go early, or ended — struck again by another voice and let
    // go there: no finger, the pedal holds it; its finger plays on)
    const f = A.wide[k] || (!own && (letQ[k] <= e.q + QEPS || !(keys[k].end > e.t + TOL))) ? 0 : keys[k].f || 0;
    out.set(e.id, { h, f, p: frameAt[h](own ? keys[k].q : e.q), x: flags(k) + (own ? "" : "t") });
  }
  const res = { notes: out, frames, ms: now() - t0 };
  if (opts.debug) res.debug = { A, r: stage.r, l: stage.l };
  return res;
}
const now = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());
