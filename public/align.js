// Rhythm-agnostic alignment of sung notes to a score melody.
//
// Dynamic programming over (sung note i, score note j), like an edit distance:
//   match   – sung i sings score j
//   split   – sung i continues score j (singer broke one note in two)
//   merge   – sung i also covers score j (repeated notes / melisma sung legato)
//   miss    – score j wasn't sung
//   extra   – sung i isn't in the score (scoop, noise, ad-lib)
// Pitch is compared modulo the octave, so singing up/down an octave is fine.
// The take is anchored at score note `startAt` (default: the first note) —
// skipping notes from there costs MISS each — but may stop anywhere (free end).
// With anyKey, a single transposition for the whole take is also searched.

// A missed score note is cheap-ish (fast melisma ornaments often aren't
// segmented at all); discarding a sustained sung note as "extra" is
// expensive — otherwise the aligner prefers to throw away a clearly sung
// note rather than pay for one missed ornament.
const MISS = 0.5;
const MISS_MELISMA = 0.3;
const LEAD_MISS = 1.5; // skipping score notes before anything was matched
// Splitting one score note across two sung notes: cheap for a short
// fragment (scoop, breath), costly for a second sustained note — that's
// more likely a wrong note than a broken one.
const splitPen = (dur) => 0.15 + 0.5 * Math.min(1, dur / 0.4);
const MERGE_PEN = 0.3;

// MATCH/SPLIT/MERGE/FIRST (≤ FIRST) all mean "sung i is on score j" at that
// cell; FIRST is the match that leaves layer A (see runDp).
const MATCH = 0, SPLIT = 1, MERGE = 2, FIRST = 3, SKIP = 4, EXTRA = 5, START = 6;

export function fold(semis) {
  return semis - 12 * Math.round(semis / 12);
}

function pitchCost(diff) {
  const d = Math.abs(fold(diff));
  return d <= 0.5 ? d * 0.4 : Math.min(1.0, 0.2 + (d - 0.5) * 0.8);
}

function extraCost(dur) {
  return 0.3 + 1.2 * Math.min(1, dur / 0.5);
}

// sung: [{ midi (float), dur (s) }], target: [{ midi, melisma? }]
export function alignTake(sung, target, { anyKey = false, startAt = 0 } = {}) {
  const n = sung.length, m = target.length;
  if (!n || !m) return null;
  startAt = Math.max(0, Math.min(startAt, m - 1));
  let best = null;
  for (let t = 0; t < (anyKey ? 12 : 1); t++) {
    const r = runDp(sung, target, t, startAt);
    if (!best || r.cost < best.cost - 1e-9) best = r;
  }
  return traceback(best, sung, target, startAt);
}

function missCost(tn) {
  return tn.melisma ? MISS_MELISMA : MISS;
}

// Two layers: A = nothing matched yet, B = at least one sung note matched.
// Skipping score notes in A (before the first match) costs LEAD_MISS, so the
// first sung note pairs with the start of the song even when it's way off,
// instead of being explained as a near-miss of some later note.
function runDp(sung, target, t, startAt) {
  const n = sung.length, m = target.length, W = m + 1, size = (n + 1) * W;
  const A = new Float64Array(size), mvA = new Uint8Array(size);
  const B = new Float64Array(size).fill(Infinity), mvB = new Uint8Array(size);
  const leadSkip = (j) => (j <= startAt ? 0 : LEAD_MISS);
  for (let j = 0; j <= m; j++) {
    A[j] = j === 0 ? 0 : A[j - 1] + leadSkip(j);
    mvA[j] = j <= startAt ? START : SKIP;
  }
  for (let i = 1; i <= n; i++) {
    const ex = extraCost(sung[i - 1].dur);
    const row = i * W, up = (i - 1) * W;
    A[row] = A[up] + ex;
    mvA[row] = EXTRA;
    for (let j = 1; j <= m; j++) {
      // Layer A
      let a = A[up + j] + ex, ka = EXTRA;
      const v0 = A[row + j - 1] + leadSkip(j);
      if (v0 < a) { a = v0; ka = SKIP; }
      A[row + j] = a;
      mvA[row + j] = ka;
      // Layer B (score notes before the anchor can't be matched)
      if (j <= startAt) continue;
      const c = pitchCost(sung[i - 1].midi - target[j - 1].midi - t);
      let b = A[up + j - 1] + c, k = FIRST;
      let v = B[up + j - 1] + c;
      if (v < b) { b = v; k = MATCH; }
      v = B[up + j] + c + splitPen(sung[i - 1].dur);
      if (v < b && mvB[up + j] <= FIRST) { b = v; k = SPLIT; }
      v = B[row + j - 1] + c + MERGE_PEN;
      if (v < b && j - 1 > startAt && mvB[row + j - 1] <= FIRST) { b = v; k = MERGE; }
      v = B[row + j - 1] + missCost(target[j - 1]);
      if (v < b) { b = v; k = SKIP; }
      v = B[up + j] + ex;
      if (v < b) { b = v; k = EXTRA; }
      B[row + j] = b;
      mvB[row + j] = k;
    }
  }
  let endJ = -1;
  for (let j = startAt + 1; j <= m; j++) if (endJ < 0 || B[n * W + j] < B[n * W + endJ]) endJ = j;
  return { t, cost: B[n * W + endJ], mvA, mvB, W, endJ };
}

function traceback({ t, cost, mvA, mvB, W, endJ }, sung, target, startAt) {
  const segTo = new Array(sung.length).fill(-1);
  const noteSegs = target.map(() => []);
  let i = sung.length, j = endJ, layerB = true;
  while (i > 0 || j > 0) {
    if (!layerB) {
      const k = mvA[i * W + j];
      if (k === START) break;
      if (k === EXTRA) i--;
      else j--;
      continue;
    }
    const k = mvB[i * W + j];
    if (k <= FIRST) {
      noteSegs[j - 1].push(i - 1);
      if (segTo[i - 1] === -1) segTo[i - 1] = j - 1;
    }
    if (k === MATCH) { i--; j--; }
    else if (k === FIRST) { i--; j--; layerB = false; }
    else if (k === SPLIT || k === EXTRA) i--;
    else j--; // MERGE, SKIP
  }

  // Graded stretch: from the anchor to the last note that got sung.
  let end = -1;
  noteSegs.forEach((s, idx) => { if (s.length) end = idx; });
  const start = end >= 0 ? startAt : -1;

  const notes = target.map((tn, idx) => {
    const segs = noteSegs[idx].sort((a, b) => a - b);
    if (start < 0 || idx < start || idx > end) return { status: "unsung", segs };
    if (!segs.length) return { status: "missed", segs };
    // Judge by the longest sung segment on this note.
    const main = segs.reduce((a, b) => (sung[b].dur > sung[a].dur ? b : a));
    const raw = sung[main].midi - tn.midi - t;
    const dev = fold(raw);
    const octave = Math.round((raw - dev) / 12);
    const a = Math.abs(dev);
    const status = a <= 0.25 ? "good" : a <= 0.5 ? "ok" : "off";
    return { status, segs, main, dev, octave, sungMidi: sung[main].midi };
  });

  const counted = notes.filter((n) => n.status !== "unsung");
  const summary = {
    total: counted.length,
    good: counted.filter((n) => n.status === "good").length,
    ok: counted.filter((n) => n.status === "ok").length,
    off: counted.filter((n) => n.status === "off").length,
    missed: counted.filter((n) => n.status === "missed").length,
    extra: segTo.filter((x) => x === -1).length,
  };
  return { transpose: t, cost, start, end, notes, segTo, summary };
}
