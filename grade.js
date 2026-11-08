// Grading a take: each score note against the pitch you sang during it.
//
// Every note has a time slot from the score, but nobody sings exactly on the clock: a
// singer who rushes a little sings the right notes early, and grading each slot strictly
// would mark those notes wrong (their pitch lands in the neighbouring slot). So the slots
// may move: each note's start may shift by up to MAX_SHIFT either way, chosen for the
// whole take at once (dynamic programming over the notes, shifts in STEP steps) so that
// the notes stay in order, and so that moving costs a little (MOVE) and changing the
// shift between neighbouring notes costs a little more (DRIFT) — a steady "you're 0.15 s
// early" beats jitter. A note's start shift is how early (−) or late (+) you were. The
// cost is the time sung off the note (each frame counted once), plus singing a note in
// the rest before it (an early entry); ringing a note on into the rest after it is free.
//
// A note is then graded on the frames in its (moved) slot, skipping a short grace at its
// start for scoops: voiced in at least MIN_VOICED of it → its pitch is the median of
// your octave-folded deviation (≤ 25¢ good, ≤ 50¢ close, else off) and `hit` is the
// share of its frames within 50¢; otherwise, if you were singing (loud: `loudGate`, above
// the room's noise) but no clear pitch was found, it's "unclear" — the app couldn't hear
// the pitch, which isn't counted against you — else "missed". Notes the take didn't reach
// are "unsung".
//
// frames: [{ t (song time of the audio, s), midi | null, rms }] in time order.
// notes:  [{ midi, t, d }] (s), in time order.

import { fold, median } from "./music.js?v=73";

export const MAX_SHIFT = 0.24;
const STEP = 0.03;
const SHIFTS = Array.from({ length: Math.round((2 * MAX_SHIFT) / STEP) + 1 }, (_, i) => -MAX_SHIFT + i * STEP);
const MOVE = 0.15;        // cost per second a note's start moves (keep to the score unless it helps)
const DRIFT = 0.1;        // cost per second the shift changes between joined notes
const DRIFT_REST = 0.03;  //   …across a rest (a new entry may be early or late on its own)
const MIN_LEN = 0.4;      // a moved slot keeps at least this share of its length
const GRACE_MAX = 0.12, GRACE_FRAC = 0.25;
const MIN_VOICED = 0.35;
const MIN_HEARD = 0.5;    // voiced + loud-but-unpitched share that counts as singing ("unclear")
export const GOOD_CENTS = 25, OK_CENTS = 50;

const lowerBound = (frames, t, lo = 0, hi = frames.length) => {
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

const joined = (notes, j) => j + 1 < notes.length && notes[j + 1].t - (notes[j].t + notes[j].d) < 0.02;

// Note j's slot with its start moved by a and its end by b (clipped at endT): the whole
// slot (for finding where you sang it) or without the grace at its start (for judging).
function span(n, a, b, endT) {
  return [n.t + a, Math.min(n.t + n.d + b, endT)];
}
function slot(n, a, b, endT) {
  const s0 = n.t + a, e = Math.min(n.t + n.d + b, endT);
  return [s0 + Math.min(GRACE_MAX, GRACE_FRAC * (n.t + n.d + b - s0)), e];
}

// Per note, prefix sums of matched (within 50¢) frames over the region any slot can reach.
function prep(notes, frames) {
  const dt = frames.length > 1 ? (frames[frames.length - 1].t - frames[0].t) / (frames.length - 1) : 0;
  return notes.map((n) => {
    const lo = lowerBound(frames, n.t - 2 * MAX_SHIFT - 0.01); // (a moved slot + the rest before it)
    const hi = lowerBound(frames, n.t + n.d + 2 * MAX_SHIFT + 0.01, lo);
    const match = new Int32Array(hi - lo + 1);
    for (let i = lo; i < hi; i++) {
      const m = frames[i].midi;
      const d = m === null ? null : fold(m - n.midi);
      // (A note after a rest is often scooped into from below: for finding where it was
      // sung, up to 2 semitones flat counts too — silence still doesn't, so a late entry is
      // still found.)
      const hit = d !== null && (Math.abs(d) * 100 <= OK_CENTS || (n.restBefore && d >= -2 && d < 0));
      match[i - lo + 1] = match[i - lo] + (hit ? 1 : 0);
    }
    return { lo, hi, match, dt };
  });
}

// Cost of note j sung in [s, e): the time in it that doesn't match the note (additive, so
// each frame is charged once whichever slot it falls in — moving a boundary only pays
// when frames really match the note they move into, not by spreading a scoop or a
// silence over a longer slot) — plus, after a rest, the time the note was sung in that
// rest just before its slot (an early entry, which no slot would notice otherwise). A note
// held on into the rest after it is just phrasing, not lateness: not charged.
function slotCost(n, p, frames, s, e) {
  const at = (t) => lowerBound(frames, t, p.lo, p.hi);
  const matched = (i0, i1) => p.match[i1 - p.lo] - p.match[i0 - p.lo];
  const i0 = at(s), i1 = at(e);
  const count = i1 - i0;
  let c = count < 2 ? Math.max(0, e - s) : (count - matched(i0, i1)) * p.dt;
  if (n.restBefore) c += matched(at(s - Math.min(MAX_SHIFT, n.restBefore)), i0) * p.dt;
  return c;
}

// The statistics of one slot → a grade.
function judge(n, frames, s, e, gate, extra) {
  const win = frames.slice(lowerBound(frames, s), lowerBound(frames, e));
  if (win.length < 2) return { status: "unsung", ...extra };
  const voiced = win.filter((f) => f.midi !== null);
  const loud = win.filter((f) => f.midi === null && (f.rms ?? 0) >= gate).length;
  if (voiced.length / win.length < MIN_VOICED) {
    const status = (voiced.length + loud) / win.length >= MIN_HEARD ? "unclear" : "missed";
    return { status, hit: 0, ...extra };
  }
  const diffs = voiced.map((f) => f.midi - n.midi);
  const dev = median(diffs.map(fold));
  const raw = median(diffs);
  const octave = Math.round((raw - fold(raw)) / 12);
  const hit = voiced.filter((f) => Math.abs(fold(f.midi - n.midi)) * 100 <= OK_CENTS).length / win.length;
  const a = Math.abs(dev) * 100;
  const status = a <= GOOD_CENTS ? "good" : a <= OK_CENTS ? "ok" : "off";
  return { status, hit, dev, octave, sungMidi: n.midi + raw, ...extra };
}

// The silence before / after each note (s; 0 when joined to its neighbour, the first and
// last notes count as after / before a long rest).
function withRests(notes) {
  return notes.map((n, j) => {
    const before = j ? n.t - (notes[j - 1].t + notes[j - 1].d) : MAX_SHIFT;
    const after = j + 1 < notes.length ? notes[j + 1].t - (n.t + n.d) : MAX_SHIFT;
    return { ...n, restBefore: before >= 0.02 ? before : 0, restAfter: after >= 0.02 ? after : 0 };
  });
}

// What counts as "loud" (singing, even without a clear pitch): above the pitch detector's
// gate and well above the room's noise — ×2.5 (≈ 8 dB) the quietest quarter second of the
// take (median rms; a breath or the count-in is the room) — else a fan or traffic would
// turn every skipped note "unclear", which isn't counted against you.
export function loudGate(frames, base) {
  if (frames.length < 10) return base;
  const span = frames[frames.length - 1].t - frames[0].t;
  const per = Math.max(3, Math.round((0.25 * (frames.length - 1)) / Math.max(span, 1e-3))); // frames in 0.25 s
  let floor = Infinity;
  for (let i = 0; i + per <= frames.length; i += Math.max(1, per >> 2)) {
    const w = [];
    for (let k = i; k < i + per; k++) w.push(frames[k].rms ?? 0);
    w.sort((a, b) => a - b);
    floor = Math.min(floor, w[w.length >> 1]);
  }
  return Number.isFinite(floor) ? Math.max(base, 2.5 * floor) : base;
}

// Notes the take reached: those whose first half it covered.
const reached = (notes, endT) => {
  let k = 0;
  while (k < notes.length && notes[k].t + 0.5 * notes[k].d <= endT) k++;
  return k;
};

// Grade a whole take (after it ends): the best moved slots for all notes together.
// Returns one grade per note: { status, hit, dev, octave, sungMidi, shift, from, to }.
export function gradeTake(notes, frames, { endT = Infinity, gate = 0.012 } = {}) {
  notes = withRests(notes);
  gate = loudGate(frames, gate);
  const N = reached(notes, endT);
  const grades = notes.map(() => ({ status: "unsung" }));
  if (!N) return grades;
  const p = prep(notes.slice(0, N), frames);
  const K = SHIFTS.length;
  let cost = Float64Array.from(SHIFTS, (a) => MOVE * Math.abs(a));
  const back = [];
  for (let j = 0; j < N - 1; j++) {
    const n = notes[j], m = notes[j + 1];
    const join = joined(notes, j);
    const next = new Float64Array(K).fill(Infinity);
    const from = new Int16Array(K);
    for (let k = 0; k < K; k++) {
      if (!Number.isFinite(cost[k])) continue;
      const a = SHIFTS[k];
      const own = join ? 0 : slotCost(n, p[j], frames, ...span(n, a, a, endT));
      for (let k2 = 0; k2 < K; k2++) {
        const b = SHIFTS[k2];
        if (m.t + b < n.t + a + MIN_LEN * n.d) continue; // stays in order
        const c = cost[k] + (join ? slotCost(n, p[j], frames, ...span(n, a, b, endT)) : own) +
          (join ? DRIFT : DRIFT_REST) * Math.abs(b - a) + MOVE * Math.abs(b);
        if (c < next[k2]) { next[k2] = c; from[k2] = k; }
      }
    }
    back.push(from);
    cost = next;
  }
  // The last reached note keeps its length.
  const last = notes[N - 1];
  let best = 0, bestC = Infinity;
  for (let k = 0; k < K; k++) {
    const c = cost[k] + slotCost(last, p[N - 1], frames, ...span(last, SHIFTS[k], SHIFTS[k], endT));
    if (c < bestC) { bestC = c; best = k; }
  }
  const ks = new Array(N);
  ks[N - 1] = best;
  for (let j = N - 2; j >= 0; j--) ks[j] = back[j][ks[j + 1]];
  for (let j = 0; j < N; j++) {
    const a = SHIFTS[ks[j]];
    const b = joined(notes, j) && j + 1 < N ? SHIFTS[ks[j + 1]] : a;
    // (A slot squeezed short may hold < 2 frames once its grace is cut: judge its whole
    // span, else its written slot — a note the take reached is never "unsung".)
    let [s, e] = slot(notes[j], a, b, endT);
    const few = (s, e) => lowerBound(frames, e) - lowerBound(frames, s) < 2;
    if (few(s, e)) [s, e] = span(notes[j], a, b, endT);
    if (few(s, e)) [s, e] = span(notes[j], 0, 0, endT);
    grades[j] = judge(notes[j], frames, s, e, gate, { shift: +a.toFixed(2), from: notes[j].t + a, to: e });
  }
  return grades;
}

// Grade one note while the take is still going, once frames reach past its latest
// possible end: the best shift for this note alone (the take is regraded as a whole at
// the end).
export function gradeLive(notes, frames, j, { endT = Infinity, gate = 0.012 } = {}) {
  const n = withRests(notes)[j];
  gate = loudGate(frames, gate);
  const [p] = prep([n], frames);
  let best = 0, bestC = Infinity;
  for (const a of SHIFTS) {
    const c = slotCost(n, p, frames, ...span(n, a, a, endT)) + MOVE * Math.abs(a);
    if (c < bestC) { bestC = c; best = a; }
  }
  const [s, e] = slot(n, best, best, endT);
  return judge(n, frames, s, e, gate, { shift: +best.toFixed(2), from: n.t + best, to: e });
}

// The take's score: duration-weighted mean `hit` over the notes it judged (not unsung,
// not unclear). Null when there are none.
export function takeScore(notes, grades) {
  let w = 0, s = 0;
  grades.forEach((g, j) => {
    if (!g || g.status === "unsung" || g.status === "unclear") return;
    w += notes[j].d;
    s += (g.hit || 0) * notes[j].d;
  });
  return w ? s / w : null;
}

// Typical timing: the median start shift of the notes sung in tune (s; − = early).
export function timingTendency(grades) {
  const sh = grades.filter((g) => g && (g.status === "good" || g.status === "ok") && g.shift !== undefined).map((g) => g.shift);
  return sh.length >= 4 ? median(sh) : 0;
}
