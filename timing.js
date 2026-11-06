// A song's timing tapped along with a recording: where its notes fall in seconds.
//
// The score says *when* in beats (quarter notes, in performance order); a recording takes
// its own time — slower verses, a held note, a push into the chorus. Tapping along (each
// word, or each line's first word) gives knots [q, t]: note onset in quarters, tap time in
// seconds. Between two knots the beats are spread evenly, so a segment is just a pace
// (seconds per quarter). A map is a list of segments [q, spq] (each runs to the next; spq
// null = not tapped there: the map's average pace), sorted by q. Tapping again over part
// of the song replaces that part only.

const MIN_GAP = 0.06; // s: taps closer than this are a bounce, not a word

export { MIN_GAP };

// Split knots where the tapping paused (a gap far slower than the rest: > 4× the median
// pace and > 3 s — leaving to restart the music, say): each run is merged on its own, so
// the pause doesn't become a crawl. Returns { runs: [[knot]], pauses: [{ q, s }] }.
export function splitPauses(knots) {
  const paces = [];
  for (let k = 0; k + 1 < knots.length; k++) paces.push((knots[k + 1].t - knots[k].t) / (knots[k + 1].q - knots[k].q));
  const sorted = [...paces].sort((a, b) => a - b);
  const med = sorted.length ? sorted[sorted.length >> 1] : 0;
  const runs = [[]], pauses = [];
  knots.forEach((kn, k) => {
    runs[runs.length - 1].push(kn);
    const gap = k + 1 < knots.length ? knots[k + 1].t - kn.t : 0;
    if (k < paces.length && paces[k] > 4 * med && gap > 3) {
      pauses.push({ q: knots[k + 1].q, s: gap });
      runs.push([]);
    }
  });
  return { runs: runs.filter((r) => r.length >= 2), pauses };
}

// Knots from taps [{ q, t }] (in tap order): bounces dropped, kept in order of q.
export function knotsFromTaps(taps) {
  const out = [];
  for (const k of taps) {
    const last = out[out.length - 1];
    if (last && (k.q <= last.q || k.t - last.t < MIN_GAP)) continue;
    out.push({ q: k.q, t: k.t });
  }
  return out;
}

// The pace of a map at quarter q (null: untapped there).
function paceAt(segs, q) {
  let p = null;
  for (const [sq, spq] of segs) {
    if (sq > q + 1e-9) break;
    p = spq;
  }
  return p;
}

// Merge knots (≥ 2) into a map's segments: the span they cover is replaced.
export function mergeKnots(segs, knots) {
  if (knots.length < 2) return segs;
  const qa = knots[0].q, qb = knots[knots.length - 1].q;
  const after = paceAt(segs, qb);
  const out = segs.filter(([q]) => q < qa - 1e-9);
  for (let k = 0; k + 1 < knots.length; k++) {
    const a = knots[k], b = knots[k + 1];
    out.push([a.q, Math.round(((b.t - a.t) / (b.q - a.q)) * 1e4) / 1e4]); // (0.1 ms per quarter)
  }
  out.push([qb, after]);
  for (const s of segs) if (s[0] > qb + 1e-9) out.push(s);
  // Neighbours with the same pace are one segment.
  return out.filter((s, i) => i === 0 || s[1] !== out[i - 1][1]);
}

// Seconds at quarter q, as a function (rate 1; time 0 at q = 0), and the average pace.
export function makeTiming(segs) {
  let len = 0, sum = 0;
  segs.forEach(([q, spq], i) => {
    const next = segs[i + 1];
    if (spq === null || !next) return;
    len += next[0] - q;
    sum += (next[0] - q) * spq;
  });
  const avg = len ? sum / len : null;
  if (avg === null) return null;
  const pts = segs.map(([q, spq]) => ({ q, spq: spq ?? avg }));
  // Cumulative time at each segment start (from the first one); before it: the average.
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + (pts[i].q - pts[i - 1].q) * pts[i - 1].spq);
  const raw = (q) => {
    if (!pts.length || q <= pts[0].q) return (q - (pts[0]?.q ?? 0)) * avg;
    let i = pts.length - 1;
    while (i > 0 && pts[i].q > q) i--;
    return cum[i] + (q - pts[i].q) * pts[i].spq;
  };
  const zero = raw(0);
  return { qToT: (q) => raw(q) - zero, avg, tapped: len };
}
