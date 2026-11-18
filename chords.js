// Chord names for what the hands sound together — "if the thing you play on the piano is a named
// chord, E minor or something, there should be a little notation there underneath it". Pure: no
// DOM, no audio (node-testable).
//
//   nameChord(notes)  → { name, root, suffix, bass } | null   notes: [{ midi, step, alter }]
//   chordMoments(notes) → [{ q, name, ids }]                  notes: [{ q, end, midi, step, alter, id, struck }]
//
// Spelled from the written notes (A♭, not G♯): the root as the score spells it, a slash bass where
// the lowest note isn't the root (C/E). Recognised: major, m, 7, maj7, m7, dim, dim7, m7♭5, aug,
// sus2, sus4, 6, m6, add9, 9 — exactly those pitch classes (≥ 3), and a 7th / 9th with its fifth
// left out (a pianist's root–third–seventh) only over its own root. Anything else: no name.

const ACC = { "-2": "𝄫", "-1": "♭", "0": "", "1": "♯", "2": "𝄪" };
// Each reading: the pitch classes above the root, its suffix, a rank (lower is the likelier reading
// when the same notes read two ways — Am7 rather than C6/E, Gsus4 rather than Csus2/G), and whether
// it needs its root in the bass.
const QUALITIES = [
  { iv: [0, 4, 7], s: "", r: 0 },
  { iv: [0, 3, 7], s: "m", r: 0 },
  { iv: [0, 4, 7, 10], s: "7", r: 1 },
  { iv: [0, 4, 7, 11], s: "maj7", r: 1 },
  { iv: [0, 3, 7, 10], s: "m7", r: 1 },
  { iv: [0, 3, 6], s: "dim", r: 2 },
  { iv: [0, 3, 6, 9], s: "dim7", r: 2 },
  { iv: [0, 3, 6, 10], s: "m7♭5", r: 2 },
  { iv: [0, 4, 8], s: "aug", r: 2 },
  { iv: [0, 5, 7], s: "sus4", r: 3 },
  { iv: [0, 2, 7], s: "sus2", r: 3.1 }, // (sus4 on a tie: Asus4/E rather than Dsus2/E)
  { iv: [0, 4, 7, 9], s: "6", r: 3 },
  { iv: [0, 3, 7, 9], s: "m6", r: 3 },
  { iv: [0, 2, 4, 7], s: "add9", r: 3 },
  { iv: [0, 2, 4, 7, 10], s: "9", r: 3 },
  { iv: [0, 4, 10], s: "7", r: 4, rooted: true },
  { iv: [0, 3, 10], s: "m7", r: 4, rooted: true },
  { iv: [0, 4, 11], s: "maj7", r: 4, rooted: true },
  { iv: [0, 2, 4, 10], s: "9", r: 4, rooted: true },
];
const KEY = (iv) => iv.join(",");
const BY = new Map();
for (const q of QUALITIES) (BY.get(KEY(q.iv)) || BY.set(KEY(q.iv), []).get(KEY(q.iv))).push(q);

const pc = (m) => ((Math.round(m) % 12) + 12) % 12;
export const spell = (n) => String(n.step || "?").toUpperCase() + (ACC[String(n.alter || 0)] ?? "");

// The name of a set of notes sounding together, or null.
export function nameChord(notes) {
  const list = (notes || []).filter((n) => Number.isFinite(n?.midi));
  if (!list.length) return null;
  const pcs = [...new Set(list.map((n) => pc(n.midi)))].sort((a, b) => a - b);
  if (pcs.length < 3) return null;
  const low = list.reduce((a, b) => (b.midi < a.midi ? b : a));
  const bass = pc(low.midi);
  let best = null;
  for (const root of pcs) {
    const iv = pcs.map((p) => (p - root + 12) % 12).sort((a, b) => a - b);
    for (const q of BY.get(KEY(iv)) || []) {
      if (q.rooted && root !== bass) continue;
      const score = (root === bass ? 0 : 10) + q.r;
      if (!best || score < best.score) best = { root, q, score };
    }
  }
  if (!best) return null;
  // (the root as written: the spelling its notes have most, the lowest of them on a tie)
  const spellOf = (p) => {
    const counts = new Map();
    for (const n of list.filter((x) => pc(x.midi) === p).sort((a, b) => a.midi - b.midi)) {
      const s = spell(n);
      counts.set(s, (counts.get(s) || 0) + 1);
    }
    return [...counts].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  };
  const root = spellOf(best.root);
  const slash = best.root === bass ? null : spell(low);
  return { name: root + best.q.s + (slash ? "/" + slash : ""), root, suffix: best.q.s, bass: slash };
}

// Where the harmony is struck: an onset where ≥ 2 keys are struck together, or the lowest key
// sounding is struck there (a new bass) — not a tune moving over a held chord. What sounds there
// counts: the keys struck and the ones still held (ties joined: a tie's continuation is held, not
// struck). → every such moment with a name, in time order: [{ q, name, ids (the keys struck) }].
const EPS = 1e-6;
export function chordMoments(notes) {
  const list = (notes || []).filter((n) => Number.isFinite(n?.midi) && Number.isFinite(n.q) && n.end > n.q + EPS);
  const qs = [...new Set(list.filter((n) => n.struck !== false).map((n) => n.q))].sort((a, b) => a - b);
  const byQ = [...list].sort((a, b) => a.q - b.q);
  const out = [];
  let i = 0;
  const live = [];
  for (const q of qs) {
    while (i < byQ.length && byQ[i].q < q + EPS) live.push(byQ[i++]);
    for (let k = live.length - 1; k >= 0; k--) if (live[k].end <= q + EPS) live.splice(k, 1);
    const struck = live.filter((n) => n.struck !== false && Math.abs(n.q - q) < EPS);
    if (!struck.length) continue;
    const low = live.reduce((a, b) => (b.midi < a.midi ? b : a));
    if (struck.length < 2 && !struck.includes(low)) continue;
    const c = nameChord(live);
    if (c) out.push({ q, name: c.name, ids: struck.map((n) => n.id) });
  }
  return out;
}
