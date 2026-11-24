// Ear's judgments (E8; docs/EAR.md; the Ear fix plan's "The judgment"): what one attempt at a line came to —
// the counts, one win, at most one cue — with no DOM, so tools/earcases.mjs runs the page's own code on
// synthetic singers. sing.js "Ear" keeps the sessions and the screen, and hands these the line, the song's
// notes and what the mic heard.
//
// A line: practice.js groupPhrases's { j0, j1, js, wk, mk, … } at Ear's sizes (EAR_PHRASE: the printed line).
// ctx: { notes (the song's, as the page has them: q, dq, t, d in seconds at the tempo now, midi (transposed),
//   text, syllabic, melisma), spq (seconds per quarter at the tempo now), spq0 (… at the song's own tempo, 100 %:
//   the count sets — fixed per line, whatever the speed), name (midi → its name in the song's key),
//   score + qToT (Sing's: the meter — metricOf — on the singer's clock), feat + start (Line: rhythm.js
//   makeFeatures of the attempt's recording and its first sample's time on the attempt's clock — the starts are
//   measured from them; none: ♩ isn't judged), gateUntil (Line: attempt s until which our own ▶'s tail may still
//   be in the mic — frames under MIN_RMS don't count before it), prev (the last whole attempt at this line, mode
//   and speed: { counts, win, cue, whole } — "rose", "fixed now", never the same win twice) }.
//
// A result (sing.js EAR.res; resonateDebug().ear.res is debugRes of it):
//   counts   { notes (♪: counted notes hit; null — not judged: another key), notesAll, beats (♩: starts on time;
//              null: not judged), beatsAll } | null (nothing to count: not heard, couldn't follow)
//   win      { kind, j?, w? (wordOf j), sub?, text } | null — Line kinds: "spot" (twice: sub "again") · "fixed"
//              (the last cue, now right: sub "note" | "start") · "rose" (sub "notes" | "beats" | "both") · "key"
//              (the tune right in another key) · "tune" (right, all a little off) · "high" · "long" · "first".
//              Beats (judgeBeats): "spot" · "fixed" · "rose" · "entry" · "run" · "even".
//   cue      { kind, j?, w?, dir?, size?, s?, from?, range?, at?, sounds, text } | null — dir: what to do
//              ("higher" / "lower" / "sooner" / "later"; key: the song "lower" / "higher"); size: a pitch cue's
//              "touch" | "aim" | "much"; s: a key cue's semitones (−6…+6); from: "short"'s first note not sung
//              (▶ The rest); range: [j0, j1] the stretch a timing cue's ▶ plays; at: [t0, t1] attempt s (▶ You);
//              sounds: the ▶s it offers ("first", "you", "note", "stretch", "rest", "hear", "key").
//              Line kinds, the first that applies: "silent" · "nofit" · "key" · "offset" · "short" · "missed" ·
//              "pitch" · "unclear" · "held" · "timing" · "sag". Beats: "silent" · "slip" · "unheard" · "steady" ·
//              "held" · "drift" · "missed" · "timing" (sounds "hear", "click", "you").
//   text     the words are WP5's (earText); `text` on a win and a cue is their plain form meanwhile.
//   fit      { a, b, off, anchor, g (grades — at the singer's line, written pitches; another key: in theirs),
//              ns (the notes where the singer put them) } — Line
//   key      { c (¢: the attempt's pitch classes against the line's), s, kind: "key" | "offset" | null } — Line
//   starts   { [i in the line]: { r (s off the singer's own steady line), on, measured, kind } } — Line
//   onsets   { measured, of } — starts with a measured onset, of the starts reached
//   notReached  counted notes that start after the singer stopped; whole: a baseline for next time (heard,
//   followed, sung to the end); up { notes, beats }: a count that rose since prev; cover: the share of the
//   singing inside the line found; ms: the judging's time
//   rn       { [i in the line]: { cls, dev, rdev } | null } — Beats: each start against its click (judgeBeats)
import { gradeTake } from "./grade.js?v=102";
import { median, fold } from "./music.js?v=102";
import { findOnsets, tolFlag, tolOn, voiceCover } from "./rhythm.js?v=102";
import { metricOf, meterAt, measureAt, feltBeat } from "./takerhythm.js?v=102";
import { PRACTICE } from "./practice.js?v=102";
import { MIN_RMS } from "./pitch.js?v=102";

// A line for Ear: the printed line (the fix plan's Q-A) — a lyric line, short ones joined to 4+ syllables, a
// long one cut near 8 (Amazing Grace: its four hymn lines, 9–11 s each). sing.js puts these into practice.js's
// PRACTICE.phrase before grouping.
export const EAR_PHRASE = { minSyl: 4, minSec: 0, maxSyl: 8, maxSec: 14 };

// The free attempt's judgment (the fix plan's rules 1–8).
export const EAR_FREE = {
  note: 0.12,          // s at the song's own tempo: a note ♪ counts, a start ♩ counts (shorter ones ride along)
  run: 0.08,           // s of voicing that makes a sound (an anchor), gaps ≤ `bridge` inside it
  bridge: 0.05,
  restart: 0.6,        // s unvoiced before a voicing that may be the line again (a false start; up to 3 anchors)
  hesitate: 0.25,      // …or this long, within `hesitateIn` s of the first sound (a hum, a tried note)
  hesitateIn: 2,
  anchors: 3,
  before: 0.3,         // frames from this long before the chosen anchor count (the room, the scoop)
  bMin: 0.5, bMax: 2.2, bStep: 1.04, // the singer's tempo against the speed heard, log steps
  aSpan: 0.3, aStep: 0.06,           // the start, around the anchor
  fineB: 0.01, fineBn: 4, fineA: 0.02, fineAn: 3,
  tie: 0.25,           // fits whose scores (hits + 0.25 × hit share − moveCost × Σ|shift|) are this close: the
                       //   smaller Σ|shift| wins
  moveCost: 1,         // per second the hit notes' slots moved: a line squeezed so that one more note hits on its
                       //   less-flat start, every slot moved to its cap, doesn't beat the singer's own line
  offCost: 0.5,        // per note placed on singing at another pitch: a singer who stopped early leaves the line's
                       //   rest free — squeezed into what was sung, a note or two more lands on a pitch by chance,
                       //   and the line no longer runs past the singer's end (nothing "not reached")
  gradeShift: 0.1,     // the final ♪ grading: a slot moves ≤ this — it can't borrow its neighbour's pitch
  wideShift: 0.6,      // where a start is looked for: a grading whose slots may move this far (s)
  offsetMin: 40,       // ¢: an attempt this far off as a whole is fitted there too, and that fit kept when it…
  offsetHits: 0.7,     //   …hits this share of the counted notes and…
  offsetGain: 2,       //   …this many times the notes the written key hits
  keyMin: 90,          // ¢: from here (a semitone, give or take the estimate) that's another key (♪ not counted);
                       //   under it, all a little off
  tuneWin: 0.85,       // "The tune was right": its fit hits this share
  nofit: 1 / 3,        // under this share hit (of the notes reached — reachedBase; even after the offset): couldn't
                       //   follow — or under `coverHits` hit
  coverHits: 0.6,      //   with under `cover` of the singing (its voiced frames, from the anchor on) inside the line
  cover: 0.8,          //   found (a tempo beyond the search: the best line covers part of it, hitting little; singing
                       //   on into the next line: all of it hit)
  reach: 0.3,          // s: a note starting this long after the last voiced frame wasn't reached
  lastMin: 0.3, lastPad: 0.1, // the line's last note ends where the singer's voice did (+ lastPad s; at least
                       //   lastMin, never past its written length): in free time nothing comes after it — a long
                       //   last note let go early, or ■ Done tapped while it's still sung, is that note sung
  conf: 0.3,           // a measured start: an onset this sure (rhythm.js conf)
  onsetStep: 0.5,      // findOnsets' prior against a change of timing between joined notes (per s; Sing's 1.5
                       //   smooths a held note's late next start away — here each start is timed on its own)
  clean: 50,           // ¢: a win's note — its voiced pitch's spread (median absolute deviation) under this, and
                       //   within 50¢ where the singer's line puts it too
  touch: 80, much: 250, // ¢: a pitch cue's size — a touch / aim / much
  sag: 25,             // ¢: every note hit, but this far off all the way (median) or by the end (last third vs first)
};
const F = EAR_FREE;

export const phraseJs = (ph) => { const out = []; for (let j = ph.j0; j < ph.j1; j++) out.push(j); return out; };
export const hitOf = (g) => !!g && (g.status === "good" || g.status === "ok");
// A note's length at the song's own tempo (the count sets are fixed per line: the speed never changes them).
const lenOf = (n, spq0) => (spq0 && n.dq != null ? n.dq * spq0 : n.d);
// The count sets: ♪ counts the notes ≥ 0.12 s, ♩ the starts — the line's first note and every note that isn't a
// melisma's continuation (its own syllable; every note in a song without words), ≥ 0.12 s.
export function countSets(ph, notes, spq0) {
  const counted = phraseJs(ph).filter((j) => lenOf(notes[j], spq0) >= F.note);
  return { counted, starts: counted.filter((j) => j === ph.j0 || !notes[j].melisma) };
}
export const countedOf = (ph, notes, spq0) => countSets(ph, notes, spq0).counted;
export const startsOf = (ph, notes, spq0) => countSets(ph, notes, spq0).starts;

// A note named for the singer: its whole word, the syllable it sings (at: where in the word), and — a melisma —
// which of the syllable's n notes it is (k, 0-based). null: a note without words (name it by its pitch).
export function wordOf(j, notes) {
  let s = j;
  while (s > 0 && notes[s].melisma && !notes[s].text) s--;
  if (!notes[s]?.text) return null;
  let e = s + 1;
  while (e < notes.length && notes[e].melisma && !notes[e].text) e++;
  const before = (i) => { for (let k = i - 1; k >= 0 && i - k < 64; k--) if (notes[k].text) return k; return -1; };
  const after = (i) => { for (let k = i + 1; k < notes.length && k - i < 64; k++) if (notes[k].text) return k; return -1; };
  let w0 = s, w1 = s;
  while (/^(middle|end)$/.test(notes[w0].syllabic || "")) { const p = before(w0); if (p < 0) break; w0 = p; }
  while (/^(begin|middle)$/.test(notes[w1].syllabic || "")) { const p = after(w1); if (p < 0) break; w1 = p; }
  const clean = (t) => t.replace(/[-‿]/g, "").trim();
  let word = "", at = [0, 0];
  for (let k = w0; k <= w1; k++) {
    if (!notes[k].text) continue;
    const t = clean(notes[k].text);
    if (k === s) at = [word.length, word.length + t.length];
    word += t;
  }
  // (a word's punctuation isn't part of it: “grace”, not “grace!”)
  const bare = word.replace(/[\s,.;:!?"“”«»()]+$/u, "").replace(/^[\s"“«(]+/u, "");
  const lead = word.length - word.replace(/^[\s"“«(]+/u, "").length;
  at = [Math.max(0, Math.min(bare.length, at[0] - lead)), Math.max(0, Math.min(bare.length, at[1] - lead))];
  return { word: bare, syl: bare.slice(at[0], at[1]), at, k: j - s, n: e - s, j0: s };
}
const ORD = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];
const NUM = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
// The plain words for a note (WP5 underlines the syllable): “Amazing”, “Amazing” (second note), or its name.
function named(j, ctx) {
  const w = wordOf(j, ctx.notes);
  if (!w) return ctx.name ? ctx.name(ctx.notes[j].midi) : "this note";
  return w.n > 1 && w.k > 0 ? `“${w.word}” (${ORD[w.k] || `note ${w.k + 1}`} note)` : `“${w.word}”`;
}

// The plain form of a win or a cue (`text`, until WP5's earText words them with the syllable underlined).
function winText(w, ctx) {
  const nm = (j) => named(j, ctx);
  switch (w.kind) {
    case "spot": return `Spot on${ctx.beats ? " with the click" : ""}${w.sub === "again" ? " — twice running" : ""}`;
    case "fixed": return w.sub === "start" ? `In on ${nm(w.j)} now` : `${nm(w.j)} right on it now`;
    case "rose": return w.sub === "both" ? "More of both than last time" : w.sub === "beats" ? `More on the ${ctx.beats ? "click" : "beat"} than last time` : "More in tune than last time";
    case "key": case "tune": return "The tune was right";
    case "high": return `Hit the high note on ${nm(w.j)}`;
    case "long": return `${nm(w.j)} held right on the note`;
    case "first": return "Started on the note";
    case "entry": return "Came in on time";
    case "run": return `Steady from ${nm(w.j)} to ${nm(w.j2)}`;
    case "even": return "Kept a steady beat";
    default: return "";
  }
}
function cueText(c, ctx) {
  const nm = (j) => named(j, ctx);
  switch (c.kind) {
    case "silent": return "Didn't hear you — sing a bit louder";
    case "nofit": return "Couldn't follow that one";
    case "key": return c.dir === "lower" ? "Started lower than the piano" : "Started higher than the piano";
    case "offset": return c.dir === "higher" ? "A little low all the way" : "A little high all the way";
    case "short": return `Keep going to ${nm(c.j)}`;
    case "slip": return c.dir === "sooner" ? `Came in late — start when ${nm(c.j)} lights` : `Came in early — wait for ${nm(c.j)} to light`;
    case "unheard": return "Couldn't hear the starts — sing each word out";
    case "steady": return c.dir === "sooner" ? "Behind the click — sing right on it" : "Ahead of the click — wait for it";
    case "drift": return c.dir === "sooner" ? "Slowing down — stay with the click" : "Speeding up — stay with the click";
    case "missed": {
      if (ctx.beats) return `Sing out on ${nm(c.j)}`; // (Beats: a start not sung — its syllable's other notes aside)
      const w = wordOf(c.j, ctx.notes);
      return w && w.n > 1 ? `“${w.word}” — sing ${w.n === 2 ? "both" : `all ${NUM[w.n - 1] || w.n}`} notes` : `Sing out on ${nm(c.j)}`;
    }
    case "pitch": return `${nm(c.j)} — ${c.size === "touch" ? "a touch" : c.size === "much" ? "much" : "aim"} ${c.dir}`;
    case "unclear": return "Closer to the mic";
    case "held": return c.dir === "sooner" ? `${nm(c.j)} held long — keep the beat` : `${nm(c.j)} cut short — hold it longer`;
    case "timing": return c.dir === "sooner" ? `Come in sooner on ${nm(c.j)}` : `Wait a bit before ${nm(c.j)}`;
    case "sag": return c.end ? `A touch ${c.dir === "higher" ? "low" : "high"} by the end` : `A touch ${c.dir === "higher" ? "low" : "high"} all the way`;
    default: return "";
  }
}

// --- The singer's line ----------------------------------------------------------------------------------

// Our own ▶'s tail (rule 1): before `until` (attempt s) a frame under MIN_RMS doesn't count as sung.
export function gateFrames(frames, until) {
  if (!(until > -Infinity)) return frames;
  return frames.map((f) => (f.t < until && f.midi != null && (f.rms ?? 0) < MIN_RMS ? { ...f, midi: null } : f));
}

// Where a line may start (rule 2): the first sound (a voiced run ≥ `run` s), each voicing after ≥ `restart` s
// unvoiced (a false start: the line again), and one after a shorter pause soon after the first (a hum, a note
// tried) — at most `anchors`, in order.
export function anchorsOf(frames) {
  const runs = [];
  let s = null, e = null;
  for (const f of frames) {
    if (f.midi == null) continue;
    if (s == null || f.t - e > F.bridge + 1e-9) { if (s != null) runs.push([s, e]); s = f.t; }
    e = f.t;
  }
  if (s != null) runs.push([s, e]);
  const out = [];
  let prevEnd = -Infinity, first = null;
  for (const [a, b] of runs) {
    const gap = a - prevEnd;
    prevEnd = Math.max(prevEnd, b);
    if (b - a < F.run - 1e-9) continue;
    if (first == null) { first = a; out.push(a); continue; }
    if (gap >= F.restart || (gap >= F.hesitate && a - first <= F.hesitateIn)) out.push(a);
    if (out.length >= F.anchors) break;
  }
  return out;
}

// The key offset (rule 3): the attempt's pitch classes (a 10¢ histogram of the voiced frames) against the
// line's (its written notes, weighted by length), cross-correlated — order-free: → { c (¢, −600…+600: sung =
// written + c) }.
export function keyOffset(ph, notes, frames) {
  const B = 120, H = new Float64Array(B), W = new Float64Array(B);
  const put = (A, cents, w) => { const x = (((cents / 10) % B) + B) % B, i = Math.floor(x), f = x - i; A[i % B] += w * (1 - f); A[(i + 1) % B] += w * f; };
  let n = 0;
  for (const f of frames) if (f.midi != null) { put(H, f.midi * 100, 1); n++; }
  for (const j of phraseJs(ph)) put(W, notes[j].midi * 100, notes[j].d);
  if (!n) return { c: 0 };
  // (both smoothed a little: a voice isn't a delta, nor are 10¢ bins)
  const smooth = (A) => { const out = new Float64Array(B), k = [0.06, 0.24, 0.4, 0.24, 0.06]; for (let i = 0; i < B; i++) for (let d = -2; d <= 2; d++) out[i] += A[(i + d + B) % B] * k[d + 2]; return out; };
  const Hs = smooth(H), Ws = smooth(W);
  const corr = new Float64Array(B);
  for (let s = 0; s < B; s++) { let c = 0; for (let b = 0; b < B; b++) c += Hs[(b + s) % B] * Ws[b]; corr[s] = c; }
  let best = 0;
  for (let s = 1; s < B; s++) if (corr[s] > corr[best] + 1e-12) best = s;
  // (sub-bin: the parabola through the peak and its neighbours)
  const l = corr[(best + B - 1) % B], m = corr[best], r = corr[(best + 1) % B], den = l - 2 * m + r;
  const x = best + (den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / den)) : 0);
  let c = x * 10;
  if (c > 600) c -= 1200;
  return { c };
}

// Grade the line placed at t = a + b·(written t − its start), pitches + off (¢): → the candidate.
function placer(ph, notes, frames, endT, counted) {
  const js = phraseJs(ph), T0 = notes[ph.j0].t, cset = new Set(counted), last = js.length - 1;
  // (the line's last note: as long as the singer held it — F.lastMin)
  const lastV = frames.reduce((m, f) => (f.midi != null ? f.t : m), -Infinity);
  return (a, b, off) => {
    const ns = js.map((j, k) => {
      const n = notes[j], t = a + b * (n.t - T0), d = b * n.d;
      return { midi: n.midi + off / 100, t, d: k === last ? Math.min(d, Math.max(F.lastMin, lastV + F.lastPad - t)) : d };
    });
    const g = gradeTake(ns, frames, { endT });
    let s = 0, sh = 0, hits = 0, offs = 0;
    g.forEach((x, k) => { if (hitOf(x)) { s += 1 + 0.25 * (x.hit || 0); sh += Math.abs(x.shift || 0); if (cset.has(js[k])) hits++; } else if (x?.status === "off") offs++; });
    return { s: s - F.moveCost * sh - F.offCost * offs, sh, hits, g, ns, a, b, off };
  };
}
// The best of some candidates: the best score; among those within `tie` of it, the one sitting closest to the
// voice (the smallest Σ|shift| of the notes it hits) — the earliest a used to win a tie, every slot at its cap.
function pick(cs) {
  let top = -Infinity;
  for (const c of cs) if (c && c.s > top) top = c.s;
  let best = null;
  for (const c of cs) if (c && c.s >= top - F.tie - 1e-9 && (!best || c.sh < best.sh - 1e-9 || (Math.abs(c.sh - best.sh) <= 1e-9 && c.s > best.s))) best = c;
  return best;
}
// The coarse search from an anchor (rule 4): the tempo over bMin…bMax in log steps, the start just before
// the first sound.
function coarse(place, anchor, off) {
  const cs = [];
  for (let b = F.bMin; b <= F.bMax * 1.0001; b *= F.bStep) cs.push(place(anchor - 0.04, b, off));
  return pick(cs);
}
// …then the start over ±aSpan, then a fine pass (b in 1 % steps, a in 20 ms, b again).
function refine(place, best, anchor, off) {
  const cs = [best];
  for (let a = anchor - F.aSpan; a <= anchor + F.aSpan + 1e-9; a += F.aStep) cs.push(place(a, best.b, off));
  best = pick(cs);
  const fineB = (b0) => { const c = [best]; for (let k = -F.fineBn; k <= F.fineBn; k++) if (k) c.push(place(best.a, b0 * (1 + k * F.fineB), off)); return pick(c); };
  best = fineB(best.b);
  const c2 = [best];
  for (let k = -F.fineAn; k <= F.fineAn; k++) if (k) c2.push(place(best.a + k * F.fineA, best.b, off));
  best = pick(c2);
  return fineB(best.b);
}
// The singer's line at one pitch offset: from each anchor (its own frames, from anchor − before) the coarse
// search, the best of them refined.
function fitAt(ph, notes, frames, endT, counted, anchors, off) {
  const cs = anchors.map((an) => {
    const place = placer(ph, notes, frames.filter((f) => f.t >= an - F.before), endT, counted);
    return { ...coarse(place, an, off), anchor: an, place };
  });
  const c = pick(cs);
  const r = refine(c.place, c, c.anchor, off);
  return { ...r, anchor: c.anchor, edge: r.b <= F.bMin * 1.02 || r.b >= F.bMax / 1.02 };
}
// What a share of the counted notes is taken of (rule 7): those the line puts before the singer stopped (the last
// voiced frame + reach) — at least a third of them, so a few notes sung don't make a whole line.
function reachedBase(ph, ns, counted, lastV) {
  return Math.max(counted.filter((j) => ns[j - ph.j0].t <= lastV + F.reach).length, Math.ceil(counted.length / 3), 1);
}
// The singer's line (rules 2–4): the anchors, the key offset, the fit at 0 and — the whole attempt off by
// ≥ offsetMin — at that offset; the offset kept when it hits ≥ offsetHits of the counted notes and ≥ offsetGain×
// what the written key does.
export function fitLine(ph, frames, endT, ctx) {
  const { notes } = ctx;
  const { counted } = countSets(ph, notes, ctx.spq0);
  const anchors = anchorsOf(frames);
  if (!anchors.length) return null;
  const key = keyOffset(ph, notes, frames.filter((f) => f.t >= anchors[0] - F.before));
  const f0 = fitAt(ph, notes, frames, endT, counted, anchors, 0);
  let fit = f0, kind = null;
  if (Math.abs(key.c) >= F.offsetMin) {
    const fc = fitAt(ph, notes, frames, endT, counted, anchors, key.c);
    // (of the counted notes the singer reached: one who stopped early, in another key, is still in that key)
    const lastV = frames.reduce((m, f) => (f.midi != null ? f.t : m), -Infinity);
    if (fc.hits >= F.offsetHits * reachedBase(ph, fc.ns, counted, lastV) && fc.hits >= F.offsetGain * f0.hits) { fit = fc; kind = Math.abs(key.c) >= F.keyMin ? "key" : "offset"; }
  }
  return { ...fit, key: { c: key.c, s: kind === "key" ? Math.max(-6, Math.min(6, Math.round(key.c / 100))) : 0, kind }, f0 };
}

// --- ♩: the starts -----------------------------------------------------------------------------------------

// A robust line through points [x, y] (Theil–Sen: the median of the pairwise slopes, then of the intercepts).
function theilSen(pts) {
  const sl = [];
  for (let i = 0; i < pts.length; i++) for (let k = i + 1; k < pts.length; k++) if (Math.abs(pts[k][0] - pts[i][0]) > 0.05) sl.push((pts[k][1] - pts[i][1]) / (pts[k][0] - pts[i][0]));
  if (!sl.length) return null;
  const b = median(sl);
  return { a: median(pts.map(([x, y]) => y - b * x)), b };
}
// A step in the starts (the held-long rule): starts on, then ≥ 2 in a row off the same way — one note held long
// or cut short, the beat kept after it. pts: [x, y, k, tol] in order. → { k (the first start after the step, in
// the line), d (s: + = late), a, b (the line before it) } | null
function stepIn(pts) {
  if (pts.length < 3) return null;
  const one = theilSen(pts);
  if (!one) return null;
  const sum1 = pts.reduce((s, [x, y]) => s + Math.abs(y - one.a - one.b * x), 0);
  let best = null;
  for (let i = 1; i + 2 <= pts.length; i++) {
    const pre = pts.slice(0, i), post = pts.slice(i), sl = [];
    for (const g of [pre, post]) for (let p = 0; p < g.length; p++) for (let q = p + 1; q < g.length; q++) if (g[q][0] - g[p][0] > 0.05) sl.push((g[q][1] - g[p][1]) / (g[q][0] - g[p][0]));
    if (!sl.length) continue;
    const b = median(sl), a = median(pre.map(([x, y]) => y - b * x)), d = median(post.map(([x, y]) => y - b * x - a));
    const tol = pts[i][3];
    if (Math.abs(d) <= tol) continue;
    if (!pre.every(([x, y, , t]) => Math.abs(y - a - b * x) <= t)) continue; // (on before it)
    if (!post.slice(0, 2).every(([x, y, , t]) => Math.sign(y - a - b * x) === Math.sign(d) && Math.abs(y - a - b * x) > t)) continue; // (≥ 2 off, the same way)
    const sum = pts.reduce((s, [x, y], k) => s + Math.abs(y - a - b * x - (k >= i ? d : 0)), 0);
    if (sum > 0.5 * sum1) continue;
    if (!best || sum < best.sum) best = { k: pts[i][2], d, a, b, sum };
  }
  return best;
}

// Each start's onset where the singer's line puts its note (rhythm.js findOnsets on the line, the start searched
// ±0.3 s): Line's ♩ and Beats' both. fit: the singer's line { a, b, ns } (Beats: against the click); grades: at that
// line (Line: unsung — not reached, or missed with no voice near — isn't searched); unsung (Beats): instead, the
// starts not searched. → { out: { [k]: { measured, kind, dev, u, tol, first, y (s: the onset, on the frames'
// clock) } }, pts: [[line t, y, k, tol]] (the measured ones), lead, ne (where the pitch put each note) } | null
function measureStarts(ph, fit, grades, frames, endT, ctx, starts, reached, unsungOf = null) {
  const { notes } = ctx;
  if (!ctx.feat || ctx.start == null || !ctx.score || !ctx.qToT) return null;
  const js = phraseJs(ph), T0 = notes[ph.j0].t;
  const ns = fit.ns.map((n, k) => ({ ...n, q: notes[js[k]].q, melisma: !!notes[js[k]].melisma, restBefore: k > 0 && n.t - (fit.ns[k - 1].t + fit.ns[k - 1].d) >= 0.02 }));
  // (the meter on the singer's clock: a beat's division in their seconds)
  // (in free time a start may come in late after a note held on — the window an entry gets, up to a beat)
  const sset = new Set(starts.map((j) => j - ph.j0));
  const met = metricOf(ctx.score, ns, [js.map((_, k) => k)], (q) => fit.a + fit.b * (ctx.qToT(q) - T0)).map((m, k) => (k > 0 && sset.has(k) && !m.entry ? { ...m, entry: true } : m));
  // Each start is searched where the pitch says the note was sung (a grading whose slots may move `wideShift`:
  // a note held on, the next one late, isn't looked for on the straight line, where its neighbour's attack is),
  // and judged against the straight line through the others.
  const wide = gradeTake(fit.ns.map((n) => ({ midi: n.midi, t: n.t, d: n.d })), frames, { endT, maxShift: F.wideShift });
  const at = ns.map((n, k) => n.t + (["good", "ok", "off"].includes(wide[k]?.status) ? wide[k].shift || 0 : 0));
  const ne = ns.map((n, k) => ({ ...n, t: at[k], d: k + 1 < ns.length && !ns[k + 1].restBefore ? Math.max(0.05, at[k + 1] - at[k]) : n.d }));
  const voicedNear = (n) => frames.some((f) => f.midi != null && f.t >= n.t - 0.1 && f.t <= n.t + n.d + 0.25);
  const unsung = unsungOf || js.map((j, k) => !reached.has(j) || grades[k]?.status === "unsung" || (grades[k]?.status === "missed" && !voicedNear(ns[k]) && !voicedNear(ne[k])));
  // (an attack followed by the note before's pitch, not this one's, is the note before re-sung — a melisma's note
  // after a breath — not this start: the singer's own pitch says so when they sang this note right)
  const pitchAfter = (t) => { const v = frames.filter((f) => f.midi != null && f.t >= t + 0.03 && f.t < t + 0.18).map((f) => f.midi); return v.length >= 3 ? median(v) : null; };
  const keep = (k, t) => {
    if (k === 0) return true;
    const m = pitchAfter(t), mine = ne[k].midi, before = ne[k - 1].midi;
    if (m == null || Math.abs(fold(m - mine)) <= 0.6 || Math.abs(fold(before - mine)) < 1) return true;
    return Math.abs(fold(m - before)) > 0.6;
  };
  let on;
  try { on = findOnsets(ne, ctx.feat, ctx.start, frames, met, { songT0: 0, rt: null, latency: 0, endT, unsung, seedRange: [-0.3, 0.3], costs: { step: F.onsetStep, stepRest: F.onsetStep }, keep }); } catch (err) { console.warn("ear: onsets", err); return null; }
  const out = {};
  const pts = [];
  const live = starts.filter((j) => reached.has(j));
  for (const j of live) {
    const k = j - ph.j0, o = on.notes[k], prev = notes[j - 1];
    const repeat = k > 0 && prev && Math.abs(prev.midi - notes[j].midi) < 0.5 && ns[k].t - (ns[k - 1].t + ns[k - 1].d) < 0.02;
    const measured = o && o.dev != null && o.conf >= F.conf && (!repeat || o.kind === "attack");
    out[k] = { measured: !!measured, kind: o?.kind ?? null, dev: o?.dev ?? null, u: met[k]?.u ?? null, tol: tolFlag(met[k]?.u ?? 0.3), first: j === ph.j0 };
    if (measured) { out[k].y = ne[k].t + o.dev; pts.push([ns[k].t, out[k].y, k, out[k].tol]); }
  }
  return { out, pts, lead: on.lead, ne, live };
}

// The starts on the singer's own line (rule 6): each start's onset (measureStarts), judged against a Theil–Sen
// line through the other measured starts (leave-one-out: one late start doesn't tilt its own reference) — on
// within tolFlag(u) of the beat's division on the singer's clock. A start sung but not measured (legato, a
// same-pitch repeat, a glide) is on when its note was hit and at least half the starts reached were measured; it
// is never cued. The line's first start is on when sung: in free time nothing comes before it.
function judgeStarts(ph, fit, grades, frames, endT, ctx, starts, reached) {
  const m = measureStarts(ph, fit, grades, frames, endT, ctx, starts, reached);
  if (!m) return null;
  const { out, pts, live } = m;
  const nMeasured = pts.length;
  for (const [x, y, k] of pts) {
    const others = pts.filter((p) => p[2] !== k);
    const line = others.length >= 3 ? theilSen(others) : null;
    out[k].r = line ? y - line.a - line.b * x : y - x - (m.lead ?? 0);
  }
  // (a step — one note held long or cut short, the beat kept after it — is one start off: the first after it;
  // the rest are judged on the beat as it went on)
  const step = stepIn(pts);
  if (step) for (const [x, y, k] of pts) out[k].r = y - step.a - step.b * x - (k > step.k ? step.d : 0);
  const judged = nMeasured * 2 >= live.length && live.length > 0;
  for (const j of starts) {
    const k = j - ph.j0, s = out[k];
    if (!s) { out[k] = { on: false, measured: false, reached: false }; continue; }
    s.reached = true;
    if (s.first) s.on = s.measured || hitOf(grades[k]) || grades[k]?.status === "off";
    else if (s.measured) s.on = Math.abs(s.r) <= s.tol;
    else s.on = judged && hitOf(grades[k]);
  }
  return { starts: out, measured: nMeasured, of: live.length, judged, step, lead: m.lead };
}

// --- The judgment ------------------------------------------------------------------------------------------

// The free attempt (● Sing, on your own time; rules 1–8): its counts, one win and one cue.
export function judgeFree(ph, frames0, endT, ctx) {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const { notes } = ctx;
  const done = (r) => { r.ms = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0); if (r.win) r.win.text = winText(r.win, ctx); if (r.cue) r.cue.text = cueText(r.cue, ctx); return r; };
  const frames = gateFrames(frames0, ctx.gateUntil);
  const voiced = frames.filter((f) => f.midi != null);
  const { counted, starts } = countSets(ph, notes, ctx.spq0);
  const nothing = { counts: null, win: null, fit: null, key: null, starts: null, onsets: null, notReached: null, whole: false, up: null };
  if (voiced.length < 6) return done({ ...nothing, cue: { kind: "silent", sounds: ["first"] } });
  const fit = fitLine(ph, frames, endT, ctx);
  if (!fit) return done({ ...nothing, cue: { kind: "silent", sounds: ["first"] } });
  const js = phraseJs(ph);
  const fr = frames.filter((f) => f.t >= fit.anchor - F.before);
  const isKey = fit.key.kind === "key";
  // ♪ (rule 5): the written notes (another key: the singer's) at the singer's line, a slot moving ≤ 0.1 s
  const regrade = (ns, off) => gradeTake(ns.map((n, k) => ({ midi: notes[js[k]].midi + off / 100, t: n.t, d: n.d })), fr, { endT, maxShift: F.gradeShift });
  let g = regrade(fit.ns, isKey ? fit.key.c : 0);
  // not reached (rule 7): starting after the last voiced frame
  const lastV = fr.reduce((m, f) => (f.midi != null ? f.t : m), -Infinity);
  const reachedSet = new Set(js.filter((j, k) => fit.ns[k].t <= lastV + F.reach));
  const notReached = counted.filter((j) => !reachedSet.has(j)).length;
  const hitsW = counted.filter((j) => hitOf(g[j - ph.j0])).length;
  const share = Math.max(hitsW, fit.hits) / reachedBase(ph, fit.ns, counted, lastV);
  const res = { fit: { a: fit.a, b: fit.b, off: fit.key.kind ? fit.key.c : 0, anchor: fit.anchor, g, ns: fit.ns }, key: fit.key, notReached, up: null };
  // couldn't follow: the tempo on the search's edge, too little hit even after the offset, or the line found
  // covering too little of the singing
  const lineEnd = Math.max(...fit.ns.map((n) => n.t + n.d)), sungFr = fr.filter((f) => f.midi != null);
  const cover = sungFr.filter((f) => f.t >= fit.a - 0.15 && f.t <= lineEnd + 0.15).length / Math.max(1, sungFr.length);
  res.cover = +cover.toFixed(2);
  if (fit.edge || share < F.nofit || (cover < F.cover && share < F.coverHits)) return done({ ...res, counts: null, win: null, cue: { kind: "nofit", sounds: ["hear"] }, starts: null, onsets: null, whole: false });
  // ♩ (rule 6)
  const st = judgeStarts(ph, fit, g, fr, endT, ctx, starts, reachedSet);
  // a held / cut note (a step in the starts): the notes after it graded where they were sung
  // (every note where the step's model puts it — its own line, not the pitch fit's, which stretched to take the
  // step in — the notes from the step on moved by it)
  let graded = fit.ns;
  if (st?.step) {
    const { a, b, d, k: ks } = st.step;
    graded = fit.ns.map((n, k) => ({ ...n, t: a + b * n.t + (k >= ks ? d : 0), d: b * n.d }));
    g = regrade(graded, isKey ? fit.key.c : 0);
    res.fit.g = g;
  }
  const gOf = (j) => g[j - ph.j0];
  const hit = (j) => hitOf(gOf(j));
  // the counts
  const unclear = counted.filter((j) => gOf(j)?.status === "unclear").length;
  const hits = counted.filter(hit).length;
  const judgedN = counted.length - unclear;
  const notesAll = hits > 0 && judgedN * 2 >= counted.length && counted.every((j) => hit(j) || gOf(j)?.status === "unclear");
  const onN = st ? starts.filter((j) => st.starts[j - ph.j0]?.on).length : 0;
  const counts = {
    notes: isKey ? null : hits, notesAll: !isKey && notesAll,
    beats: st?.judged ? onN : null, beatsAll: !!st?.judged && onN === starts.length,
  };
  res.counts = counts;
  res.starts = st ? Object.fromEntries(Object.entries(st.starts).map(([k, s]) => [k, { r: s.r != null ? +s.r.toFixed(3) : null, on: !!s.on, measured: !!s.measured, kind: s.kind ?? null }])) : null;
  res.onsets = st ? { measured: st.measured, of: st.of } : null;
  res.whole = notReached === 0;
  // a count that rose since the last whole attempt here (same line, mode and speed)
  const prev = ctx.prev?.whole ? ctx.prev : null;
  res.up = prev && res.whole ? { notes: counts.notes != null && prev.counts?.notes != null && counts.notes > prev.counts.notes, beats: counts.beats != null && prev.counts?.beats != null && counts.beats > prev.counts.beats } : { notes: false, beats: false };

  // --- the cue: the first that applies (reached notes only)
  const reachedCounted = counted.filter((j) => reachedSet.has(j));
  const T = (j) => graded[j - ph.j0];
  const around = (j0, j1) => [Math.max(0, T(j0).t - 0.4), T(j1).t + T(j1).d + 0.4];
  const whole = [Math.max(0, fit.a - 0.3), Math.max(...fit.ns.map((n) => n.t + n.d)) + 0.4];
  const startBefore = (j, n) => { const ss = starts.filter((x) => x < j); return ss.length >= n ? ss[ss.length - n] : ph.j0; };
  let cue = null;
  if (fit.key.kind === "key") cue = { kind: "key", dir: fit.key.c < 0 ? "lower" : "higher", s: fit.key.s, at: whole, sounds: ["first", "you", "key"] };
  else if (fit.key.kind === "offset") cue = { kind: "offset", dir: fit.key.c < 0 ? "higher" : "lower", at: whole, sounds: ["first", "you"] };
  if (!cue && notReached >= 2) {
    // (▶ The rest: from the first note of the stretch nothing was sung in)
    let from = ph.j1 - 1;
    while (from > ph.j0 && !hit(from - 1) && gOf(from - 1)?.status !== "off" && gOf(from - 1)?.status !== "unclear") from--;
    cue = { kind: "short", j: ph.j1 - 1, from, sounds: ["rest"] };
  }
  // (missed: hardly a voice around it at all — a note sung late and short is a timing matter, not "sing out")
  const silentAt = (j) => { const n = graded[j - ph.j0], w = fr.filter((f) => f.t >= n.t - 0.05 && f.t < n.t + n.d + 0.05); return w.length >= 2 && w.filter((f) => f.midi != null).length < 0.25 * w.length; };
  // (…or its pitch not heard in it nor just after it — a short note left out between two sung ones: their edges fill
  // a quarter of its window, but nothing there was this note; a late one is heard on its pitch, after its start)
  const unheardAt = (j) => {
    const n = graded[j - ph.j0], target = notes[j].midi + (isKey ? fit.key.c / 100 : 0);
    return fr.filter((f) => f.midi != null && f.t >= n.t && f.t < n.t + n.d + 0.3 && Math.abs(fold(f.midi - target)) <= 0.5).length < 3;
  };
  if (!cue) {
    const missed = reachedCounted.filter((j) => gOf(j)?.status === "missed" && (silentAt(j) || unheardAt(j))).sort((x, y) => notes[y].d - notes[x].d || x - y)[0];
    if (missed != null) cue = { kind: "missed", j: missed, at: around(missed, missed), sounds: ["note", "you"] };
  }
  if (!cue) {
    const off = reachedCounted.filter((j) => gOf(j)?.status === "off").sort((x, y) => notes[y].d - notes[x].d || Math.abs(gOf(y).dev) - Math.abs(gOf(x).dev))[0];
    if (off != null) {
      const c = Math.abs(gOf(off).dev) * 100;
      cue = { kind: "pitch", j: off, dir: gOf(off).dev > 0 ? "lower" : "higher", size: c < F.touch ? "touch" : c > F.much ? "much" : "aim", at: around(off, off), sounds: ["note", "you"] };
    }
  }
  if (!cue && unclear * 2 >= counted.length && unclear > 0) cue = { kind: "unclear", sounds: [] };
  if (!cue && st?.step) {
    // (late after the note before held on: "held long"; late after a pause: that start came in late; early: the
    // note before cut short)
    const jStart = ph.j0 + st.step.k, held = jStart - 1, y = st.starts[st.step.k]?.y;
    const gap = [T(held).t + T(held).d, (y ?? T(jStart).t) - 0.05];
    const inGap = fr.filter((f) => f.t >= gap[0] && f.t < gap[1]), voicedGap = inGap.filter((f) => f.midi != null).length;
    const paused = st.step.d > 0 && inGap.length >= 3 && voicedGap < 0.6 * inGap.length;
    if (paused) cue = { kind: "timing", j: jStart, dir: "sooner", range: [startBefore(jStart, 2), jStart], at: around(startBefore(jStart, 2), jStart), sounds: ["stretch", "you"] };
    else if (held >= ph.j0) cue = { kind: "held", j: held, dir: st.step.d > 0 ? "sooner" : "later", range: [startBefore(held, 2), jStart], at: around(startBefore(held, 1), jStart), sounds: ["stretch", "you"] };
  }
  if (!cue && st?.judged) {
    const late = starts.find((j) => { const s = st.starts[j - ph.j0]; return s?.reached && s.measured && !s.first && !s.on; });
    if (late != null) { const s = st.starts[late - ph.j0]; cue = { kind: "timing", j: late, dir: s.r > 0 ? "sooner" : "later", range: [startBefore(late, 2), late], at: around(startBefore(late, 2), late), sounds: ["stretch", "you"] }; }
  }
  if (!cue && !isKey && reachedCounted.every(hit) && reachedCounted.length >= 3) {
    const dev = (j) => gOf(j).dev * 100, ds = reachedCounted.map(dev), med = median(ds), n3 = Math.max(1, Math.floor(ds.length / 3));
    const drift = median(ds.slice(-n3)) - median(ds.slice(0, n3));
    if (Math.abs(med) >= F.sag) cue = { kind: "sag", dir: med > 0 ? "lower" : "higher", end: false, at: whole, sounds: ["first", "you"] };
    else if (Math.abs(drift) >= F.sag) cue = { kind: "sag", dir: drift > 0 ? "lower" : "higher", end: true, at: whole, sounds: ["first", "you"] };
  }
  res.cue = cue;

  // --- the win: the first that applies, not the cue's note, not last time's again when another applies
  // (cleanly: hit, its voiced pitch steady in its slot, and hit where the singer's line puts it too — not only
  // in a slot the grading moved onto a neighbour's pitch)
  const clean = (j) => {
    const x = gOf(j);
    if (!hitOf(x) || !reachedSet.has(j) || cue?.j === j) return false;
    const target = notes[j].midi + (isKey ? fit.key.c / 100 : 0);
    const devs = (t0, t1) => fr.filter((f) => f.midi != null && f.t >= t0 && f.t < t1).map((f) => fold(f.midi - target) * 100);
    const moved = devs(x.from, x.to);
    if (moved.length < 3) return false;
    const m = median(moved);
    if (median(moved.map((d) => Math.abs(d - m))) >= F.clean) return false;
    const n = graded[j - ph.j0], s0 = n.t + Math.min(0.12, 0.25 * n.d), here = devs(s0, n.t + n.d), all = fr.filter((f) => f.t >= s0 && f.t < n.t + n.d).length;
    return here.length >= 3 && here.length >= 0.35 * all && Math.abs(median(here)) <= 50;
  };
  const wins = [];
  if (counts.notesAll && counts.beatsAll) wins.push({ kind: "spot", ...(ctx.prev?.win?.kind === "spot" ? { sub: "again" } : {}) });
  const pc = prev?.cue;
  if (pc?.j != null && pc.j >= ph.j0 && pc.j < ph.j1) {
    if ((pc.kind === "pitch" || pc.kind === "missed") && !fit.key.kind && clean(pc.j)) wins.push({ kind: "fixed", sub: "note", j: pc.j }); // (in the written key)
    if (pc.kind === "timing" && st?.starts[pc.j - ph.j0]?.measured && st.starts[pc.j - ph.j0].on) wins.push({ kind: "fixed", sub: "start", j: pc.j });
  }
  if (res.up.notes || res.up.beats) wins.push({ kind: "rose", sub: res.up.notes && res.up.beats ? "both" : res.up.beats ? "beats" : "notes" });
  if (fit.key.kind && fit.hits >= F.tuneWin * counted.length) wins.push({ kind: fit.key.kind === "key" ? "key" : "tune" });
  if (!fit.key.kind) {
    const byLen = (a, b) => notes[b].d - notes[a].d || b - a; // (of equal ones, the later: a line's last long note)
    const top = Math.max(...counted.map((j) => notes[j].midi));
    const high = counted.filter((j) => notes[j].midi === top).sort(byLen).find(clean);
    if (high != null) wins.push({ kind: "high", j: high });
    const longest = Math.max(...counted.map((j) => notes[j].d));
    const long = counted.filter((j) => notes[j].d >= longest - 1e-6).sort(byLen).find(clean);
    if (long != null && long !== high) wins.push({ kind: "long", j: long });
    if (clean(ph.j0)) wins.push({ kind: "first", j: ph.j0 });
  }
  const same = (w, p) => !!p && w.kind === p.kind && (w.j ?? null) === (p.j ?? null) && (w.sub ?? null) === (p.sub ?? null);
  res.win = wins.find((w) => w.kind === "spot" || !same(w, ctx.prev?.win)) || wins[0] || null;
  for (const x of [res.win, res.cue]) if (x?.j != null) x.w = wordOf(x.j, notes);
  return done(res);
}

// Beats (● Sing with the click; the fix plan's "Beats (judgeBeats)"): each start against its click — the beat
// grid less the measured trip (the count-in's clicks found in the recording), else less the browser's estimate
// with a wider band. Not rhythmOf's classes: those are against the take's own steady lead (a singer steadily
// behind the click came out "all of them"), and its onset search, centred on that lead, can't follow half a
// beat late or a tempo pulled away from the click (attacks taken from the neighbours: cues the wrong way). So
// the starts are found here where the singer's line (fitLine on the frames as heard) puts each note, and each is
// judged on its own distance from its click.
export const EAR_BEATS = {
  uncal: 0.04,     // s more tolerance when the trip wasn't measured (headphones: the browser's estimate)
  missing: 0.2,    // a start whose own note's span is voiced under this share (and not hit) wasn't sung:
                   //   "Sing out on …", never early or late (an onset borrowed from the next note)
  iqr: 2,          // × tolOn(u): starts this close together keep one lag — steady behind / ahead
  driftBeat: 0.25, // a drift over the line ≥ max(tolFlag, this × the beat): slowing down / speeding up
  driftMin: 4,     //   …from this many measured starts
  keep: 0.75,      // × the beat: a late entry every start keeps, under this, is behind the click — not a count off
                   //   (a whole beat late is: the count-in row's word, "start when it lights")
  run: 3,          // starts on the click in a row: "Steady from … to …"
  fitB: 0.3, fitA: 1.2, // the singer's line kept when its tempo is within this of the click's and it starts within
                   //   this many beats of the written start (else the written line: onsets near the clicks)
};
const BT = EAR_BEATS;
const quantile = (xs, p) => { const s = [...xs].sort((a, b) => a - b), x = p * (s.length - 1), i = Math.floor(x); return i + 1 < s.length ? s[i] + (x - i) * (s[i + 1] - s[i]) : s[i]; };

// The take (Sing's guided take on the line's span, as finishSing leaves it): frames on the song clock as heard
// (moved by the measured trip), grades, endT, rhythm (rhythmOf: calibrated, phrases[0].lag — the first sound
// after the count-in, takerhythm.js phraseRhythm —, notes for comparison). ctx: as judgeFree's — notes (at the
// tempo sung), spq0, name, score + qToT, feat + start (the recording's features, its first sample on the frames'
// clock: none — rhythmOf's onsets, judged on the grid all the same), prev (the last whole Beats attempt at this
// line and speed). → a result as judgeFree's: counts { beats, beatsAll } (notes null), win, cue, starts { [k]: {
// dev (s off its click, + late), on, measured, missing, kind } }, onsets, lag, steady / drift (s), calibrated,
// whole, up, rn (per note: cls on / early / late / missing, dev, rdev — dev less the median).
// Beats kinds — wins: "spot" (again) · "fixed" (sub start) · "rose" (sub beats) · "entry" (the first start on) ·
// "run" (j…j2, ≥ 3 on in a row) · "even" (a steady lag kept). Cues, the first that applies: "silent" · "slip"
// (dir: sooner / later) · "unheard" · "steady" · "held" (a step) · "drift" · "missed" · "timing"; sounds "hear" (▶ Hear with the
// click), "click" (▶ Click: the melody and the click over `range`), "you" (▶ You: the take over `at`, song s as
// heard, the click with it).
export function judgeBeats(ph, take, ctx) {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const { notes } = ctx;
  const bctx = { ...ctx, beats: true, ph };
  const done = (r) => { r.ms = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0); if (r.win) r.win.text = winText(r.win, bctx); if (r.cue) r.cue.text = cueText(r.cue, bctx); for (const x of [r.win, r.cue]) if (x?.j != null) x.w = wordOf(x.j, notes); return r; };
  const rh = take.rhythm || null, pr = rh?.phrases?.[0] || null;
  const js = phraseJs(ph), T0 = notes[ph.j0].t;
  const { counted, starts } = countSets(ph, notes, ctx.spq0);
  const cal = !!rh?.calibrated;
  // the meter on the click (each start's division u, the beat), the bar the line starts in
  const met = ctx.score && ctx.qToT ? metricOf(ctx.score, js.map((j) => notes[j]), [js.map((_, k) => k)], ctx.qToT) : null;
  const uOf = (k) => met?.[k]?.u ?? rh?.notes?.[js[k]]?.u ?? 0.3;
  const beat = (met ? median(starts.map((j) => met[j - ph.j0].beat)) : null) ?? pr?.beat ?? 0.6;
  const extra = cal ? 0 : BT.uncal;
  const tolOf = (k) => tolFlag(uOf(k)) + extra;
  const uMed = median(starts.map((j) => uOf(j - ph.j0)));
  const tolM = tolFlag(uMed) + extra;
  const endT = take.endT ?? Infinity;
  const frames = (take.frames || []).filter((f) => f.t >= T0 - beat - 0.3);
  const rn0 = (j) => rh?.notes?.[j] || null;
  const nothing = { counts: null, win: null, starts: null, onsets: null, whole: false, up: { notes: false, beats: false }, calibrated: cal, lag: pr?.lag ?? null, steady: null, drift: null };
  if (frames.filter((f) => f.midi != null).length < 6) return done({ ...nothing, rn: rnOf(ph, js, {}, rn0), cue: { kind: "silent", sounds: [] } });
  // the take ran past where each start could be
  const reached = new Set(js.filter((j) => notes[j].t + Math.min(0.35, notes[j].d) < endT));
  // where the singer's line puts each note (their pitch: a steady lag, a tempo pulled from the click)
  const written = { a: T0, b: 1, ns: js.map((j) => ({ midi: notes[j].midi, t: notes[j].t, d: notes[j].d })) };
  let fit = null;
  try { fit = fitLine(ph, frames, endT, ctx); } catch (err) { console.warn("ear: beats line", err); }
  const line = fit && !fit.edge && Math.abs(fit.b - 1) <= BT.fitB && Math.abs(fit.a - T0) <= BT.fitA * beat && fit.hits >= Math.ceil(counted.length / 3) ? fit : written;
  const g = gradeTake(line.ns.map((n) => ({ midi: n.midi, t: n.t, d: n.d })), frames, { endT, maxShift: F.gradeShift });
  // a start not sung: its own note's span hardly voiced (the vowel band; no recording: the pitch frames), not hit
  const spans = js.map((_, k) => [line.ns[k].t, line.ns[k].t + line.ns[k].d]);
  const cover = ctx.feat && ctx.start != null ? voiceCover(ctx.feat, ctx.start, { songT0: 0, trip: 0, quiet: [-Infinity, T0 - beat] }, spans)
    : spans.map(([a, b]) => { const w = frames.filter((f) => f.t >= a && f.t < b); return w.length ? w.filter((f) => f.midi != null).length / w.length : 0; });
  const missing = new Set(starts.filter((j) => reached.has(j) && cover[j - ph.j0] < BT.missing && !hitOf(g[j - ph.j0])));
  const m = measureStarts(ph, line, g, frames, endT, ctx, starts, reached, js.map((j) => !reached.has(j) || missing.has(j)));
  const S = {};
  for (const j of starts) {
    const k = j - ph.j0;
    if (!reached.has(j)) { S[k] = { reached: false, on: false, measured: false, dev: null }; continue; }
    if (missing.has(j)) { S[k] = { reached: true, missing: true, on: false, measured: false, dev: null }; continue; }
    let dev = null, kind = null;
    if (m) { const o = m.out[k]; if (o?.measured) { dev = o.y - notes[j].t; kind = o.kind; } }
    else { const r = rn0(j); if (r?.cls) { dev = r.dev; kind = r.kind; } }
    S[k] = { reached: true, measured: dev != null, dev, kind, tol: tolOf(k) };
  }
  const live = starts.filter((j) => S[j - ph.j0].reached && !S[j - ph.j0].missing);
  const meas = live.filter((j) => S[j - ph.j0].measured);
  const judged = live.length > 0 && meas.length * 2 >= live.length;
  const devs = meas.map((j) => S[j - ph.j0].dev);
  const med = devs.length ? median(devs) : null;
  // steady: every start about the same distance off its click, one way
  const iqr = devs.length >= 3 ? quantile(devs, 0.75) - quantile(devs, 0.25) : Infinity;
  const steady = judged && devs.length >= 3 && Math.abs(med) > tolM && iqr <= BT.iqr * tolOn(uMed);
  // drift: the distance from the click growing (slowing down) or shrinking (speeding up) over the line
  const pts = meas.map((j) => [notes[j].t, S[j - ph.j0].dev]);
  const ts = pts.length >= BT.driftMin ? theilSen(pts) : null;
  const drift = ts ? ts.b * (pts[pts.length - 1][0] - pts[0][0]) : null;
  // (…or a step: on the click, then from one start on all off the same way — the note before it held long or cut
  // short, the click's beat kept after it: that note, not "slowing down")
  // (at least two starts before it, on their clicks: a late entry alone, the rest on the click, is the entry's)
  const step0 = judged && !steady ? stepIn(meas.map((j) => [notes[j].t, S[j - ph.j0].dev, j - ph.j0, S[j - ph.j0].tol])) : null;
  const pre = step0 ? meas.filter((j) => j - ph.j0 < step0.k) : [];
  const step = step0 && pre.length >= 2 && pre.every((j) => Math.abs(S[j - ph.j0].dev) <= S[j - ph.j0].tol) ? step0 : null;
  const drifting = judged && !steady && !step && drift != null && Math.abs(drift) >= Math.max(tolM, BT.driftBeat * beat);
  // a counting slip: the first sound after the count-in ≥ max(0.6 beat, 0.25 s) off — unless every start kept
  // that lag and it's under ¾ of a beat (behind the click, not a count off); a lag every start keeps of ¾ beat
  // or more is a count off too
  const lag = pr?.lag ?? null;
  const need = Math.max(PRACTICE.time.slipBeats * beat, cal ? PRACTICE.time.slipSec : PRACTICE.time.slipSecUncal);
  const kept = steady && lag != null && Math.abs(med - lag) <= tolM && Math.abs(lag) < BT.keep * beat;
  const slip = lag != null && Math.abs(lag) >= need && !kept ? (lag > 0 ? "sooner" : "later") : steady && Math.abs(med) >= BT.keep * beat ? (med > 0 ? "sooner" : "later") : null;
  // each start: measured — within its tolerance of its click; sung but not measured (legato, a repeat) — on
  // when its note was hit and the measured ones were on the click
  for (const j of live) {
    const s = S[j - ph.j0];
    s.on = s.measured ? Math.abs(s.dev) <= s.tol : judged && !steady && !drifting && med != null && Math.abs(med) <= tolM && hitOf(g[j - ph.j0]);
  }
  const onN = starts.filter((j) => S[j - ph.j0].on).length;
  const counts = slip || !judged ? null : { beats: onN, beatsAll: onN === starts.length, notes: null, notesAll: false };
  const res = { counts, calibrated: cal, lag, steady: steady ? +med.toFixed(3) : null, drift: drift != null ? +drift.toFixed(3) : null, step: step ? { k: step.k, d: +step.d.toFixed(3) } : null, tol: +tolM.toFixed(3),
    line: { a: +line.a.toFixed(3), b: +line.b.toFixed(3), fit: line === fit },
    starts: Object.fromEntries(Object.entries(S).map(([k, s]) => [k, { dev: s.dev != null ? +s.dev.toFixed(3) : null, on: !!s.on, measured: !!s.measured, missing: !!s.missing, reached: !!s.reached, kind: s.kind ?? null }])),
    onsets: { measured: meas.length, of: live.length }, rn: rnOf(ph, js, S, rn0, med) };
  res.whole = !!counts && starts.every((j) => S[j - ph.j0].reached);
  const prev = ctx.prev?.whole ? ctx.prev : null;
  res.up = { notes: false, beats: !!prev && res.whole && prev.counts?.beats != null && counts.beats > prev.counts.beats };

  // --- the cue: the first that applies
  const startBefore = (j, n) => { const ss = starts.filter((x) => x < j); return ss.length >= n ? ss[ss.length - n] : ph.j0; };
  // (▶ You: the take from a beat before the stretch to past its end — and past where the singer put it)
  const at = (ja, jb) => [Math.max(notes[ja].t - beat + Math.min(0, med ?? 0), (take.voice?.start ?? -Infinity)), notes[jb].t + notes[jb].d + 0.4 + Math.max(0, med ?? 0)];
  // (a take-wide cue's stretch: the first bar from the entry, at least three starts)
  const bar = () => {
    const fb = feltBeat(meterAt(ctx.score || {}, measureAt(ctx.score || { measures: [0] }, notes[ph.j0].q)));
    const within = starts.filter((j) => notes[j].t < T0 + fb.n * beat - 1e-6);
    return Math.max(within[within.length - 1] ?? ph.j0, starts[Math.min(2, starts.length - 1)]);
  };
  let cue = null;
  if (slip) cue = { kind: "slip", j: ph.j0, dir: slip, sounds: ["hear"] };
  else if (!judged) cue = { kind: "unheard", sounds: [] };
  else if (steady) { const jb = bar(); cue = { kind: "steady", dir: med > 0 ? "sooner" : "later", range: [ph.j0, jb], at: at(ph.j0, jb), sounds: ["click", "you"] }; }
  else if (step && ph.j0 + step.k - 1 >= ph.j0) {
    const jStart = ph.j0 + step.k, held = jStart - 1;
    cue = { kind: "held", j: held, dir: step.d > 0 ? "sooner" : "later", range: [startBefore(held, 1), jStart], at: at(startBefore(held, 1), jStart), sounds: ["click", "you"] };
  } else if (drifting) cue = { kind: "drift", dir: drift > 0 ? "sooner" : "later", range: [ph.j0, ph.j1 - 1], at: at(ph.j0, ph.j1 - 1), sounds: ["click", "you"] };
  else if (missing.size) { const j = Math.min(...missing); cue = { kind: "missed", j, range: [startBefore(j, 2), j], at: at(startBefore(j, 2), j), sounds: ["click"] }; }
  else {
    const off = live.find((j) => S[j - ph.j0].measured && !S[j - ph.j0].on);
    if (off != null) cue = { kind: "timing", j: off, dir: S[off - ph.j0].dev > 0 ? "sooner" : "later", range: [startBefore(off, 2), off], at: at(startBefore(off, 2), off), sounds: ["click", "you"] };
  }
  res.cue = cue;

  // --- the win: the first that applies, not last time's again when another applies
  const wins = [];
  if (counts?.beatsAll) wins.push({ kind: "spot", ...(ctx.prev?.win?.kind === "spot" ? { sub: "again" } : {}) });
  const pc = prev?.cue;
  if (counts && pc?.j != null && pc.j >= ph.j0 && pc.j < ph.j1 && (pc.kind === "timing" || pc.kind === "missed") && S[pc.j - ph.j0]?.measured && S[pc.j - ph.j0].on) wins.push({ kind: "fixed", sub: "start", j: pc.j });
  if (res.up.beats) wins.push({ kind: "rose", sub: "beats" });
  if (counts && S[0]?.measured && S[0].on) wins.push({ kind: "entry", j: ph.j0 });
  if (counts) {
    let best = null, run = [];
    for (const j of starts) {
      if (S[j - ph.j0].measured && S[j - ph.j0].on) run.push(j); else run = [];
      if (run.length >= BT.run && (!best || run.length > best.length)) best = [...run];
    }
    if (best) wins.push({ kind: "run", j: best[0], j2: best[best.length - 1] });
  }
  if (steady) wins.push({ kind: "even" });
  const same = (w, p) => !!p && w.kind === p.kind && (w.j ?? null) === (p.j ?? null) && (w.sub ?? null) === (p.sub ?? null);
  res.win = wins.find((w) => w.kind === "spot" || !same(w, ctx.prev?.win)) || wins[0] || null;
  return done(res);
}
// Per note of the line, for the probes: Beats' class against the click (on / early / late / missing / null),
// dev, rdev (dev less the median of the measured starts); rhythmOf's own where Beats has none.
function rnOf(ph, js, S, rn0, med = null) {
  return Object.fromEntries(js.map((j) => {
    const k = j - ph.j0, s = S[k];
    if (s) return [k, { cls: s.missing ? "missing" : !s.measured ? null : s.on ? "on" : s.dev > 0 ? "late" : "early", dev: s.dev, rdev: s.dev != null && med != null ? +(s.dev - med).toFixed(3) : null }];
    const r = rn0(j);
    return [k, r ? { cls: null, dev: r.dev, rdev: r.rdev } : null];
  }));
}

// A result as resonateDebug() shows it: everything but the recording and the fitted notes (the grades,
// per note in the line, instead).
export function debugRes(res) {
  if (!res) return null;
  const { voice, fit, songT0, ...rest } = res;
  return { ...rest, fit: fit ? { a: fit.a, b: fit.b, off: fit.off, anchor: fit.anchor } : null, grades: fit?.g?.map((x) => x && { status: x.status, dev: x.dev, shift: x.shift }) };
}
