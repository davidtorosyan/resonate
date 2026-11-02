// Rhythm-agnostic alignment of sung notes to a score melody.
//
// Dynamic programming over (sung note i, score note j), like an edit distance:
//   match   – sung i sings score j
//   split   – sung i continues score j (singer broke one note in two)
//   merge   – sung i also covers score j (repeated notes / melisma sung legato)
//   miss    – score j wasn't sung
//   extra   – sung i isn't in the score (scoop, noise, ad-lib)
// Pitch is compared modulo the octave, so singing up/down an octave is fine.
// The singer may cover any contiguous stretch of the score (free start/end).
// With anyKey, a single transposition for the whole take is also searched.

const MISS = 1.0;
const SPLIT_PEN = 0.15;
const MERGE_PEN = 0.3;

// MATCH/SPLIT/MERGE (≤ MERGE) all mean "sung i is on score j" at that cell.
const MATCH = 0, SPLIT = 1, MERGE = 2, SKIP = 3, EXTRA = 4, START = 5;

export function fold(semis) {
  return semis - 12 * Math.round(semis / 12);
}

function pitchCost(diff) {
  const d = Math.abs(fold(diff));
  return d <= 0.5 ? d * 0.4 : Math.min(1.6, 0.2 + (d - 0.5) * 0.8);
}

function extraCost(dur) {
  return 0.25 + 0.75 * Math.min(1, dur / 0.5);
}

// sung: [{ midi (float), dur (s) }], target: [{ midi }]
export function alignTake(sung, target, { anyKey = false } = {}) {
  const n = sung.length, m = target.length;
  if (!n || !m) return null;
  let best = null;
  for (let t = 0; t < (anyKey ? 12 : 1); t++) {
    const r = runDp(sung, target, t);
    if (!best || r.cost < best.cost - 1e-9) best = r;
  }
  return traceback(best, sung, target);
}

function runDp(sung, target, t) {
  const n = sung.length, m = target.length, W = m + 1;
  const dp = new Float64Array((n + 1) * W);
  const mv = new Uint8Array((n + 1) * W);
  for (let j = 0; j <= m; j++) { dp[j] = 0; mv[j] = START; }
  for (let i = 1; i <= n; i++) {
    const ex = extraCost(sung[i - 1].dur);
    dp[i * W] = dp[(i - 1) * W] + ex;
    mv[i * W] = EXTRA;
    for (let j = 1; j <= m; j++) {
      const c = pitchCost(sung[i - 1].midi - target[j - 1].midi - t);
      let b = dp[(i - 1) * W + j - 1] + c, k = MATCH;
      let v = dp[(i - 1) * W + j] + c + SPLIT_PEN;
      if (v < b && mv[(i - 1) * W + j] <= MERGE) { b = v; k = SPLIT; }
      v = dp[i * W + j - 1] + c + MERGE_PEN;
      if (v < b && j > 1 && mv[i * W + j - 1] <= MERGE) { b = v; k = MERGE; }
      v = dp[i * W + j - 1] + MISS;
      if (v < b) { b = v; k = SKIP; }
      v = dp[(i - 1) * W + j] + ex;
      if (v < b) { b = v; k = EXTRA; }
      dp[i * W + j] = b;
      mv[i * W + j] = k;
    }
  }
  let endJ = 0;
  for (let j = 1; j <= m; j++) if (dp[n * W + j] < dp[n * W + endJ]) endJ = j;
  return { t, cost: dp[n * W + endJ], mv, W, endJ };
}

function traceback({ t, cost, mv, W, endJ }, sung, target) {
  const segTo = new Array(sung.length).fill(-1);
  const noteSegs = target.map(() => []);
  let i = sung.length, j = endJ;
  while (i > 0) {
    const k = mv[i * W + j];
    if (k === START) break;
    if (k === MATCH || k === SPLIT || k === MERGE) {
      noteSegs[j - 1].push(i - 1);
      if (segTo[i - 1] === -1) segTo[i - 1] = j - 1;
    }
    if (k === MATCH) { i--; j--; }
    else if (k === SPLIT || k === EXTRA) i--;
    else j--; // MERGE, SKIP
  }

  let start = -1, end = -1;
  noteSegs.forEach((s, idx) => { if (s.length) { if (start < 0) start = idx; end = idx; } });

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
