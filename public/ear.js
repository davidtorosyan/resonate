// Ear's judgments (E8; docs/EAR.md): what one attempt at a phrase came to — the counts, one win, at most
// one cue — with no DOM, so tools/earcases.mjs runs the page's own code on synthetic singers. sing.js
// "Ear" keeps the sessions and the screen, and hands these the phrase, the song's notes and what the mic
// heard.
//
// A phrase: practice.js groupPhrases's { j0, j1, js, wk, mk, … } at Ear's sizes (EAR_PHRASE: the printed
// line). ctx: { notes (the song's, as the page has them: t, d in seconds at the tempo now,
// midi, shift, text, melisma), spq (seconds per quarter at the tempo now), name (midi → its name in the
// song's key) }.
//
// A result (sing.js EAR.res; resonateDebug().ear.res is debugRes of it):
//   counts   { notes (♪: counted notes hit), notesAll, beats (♩: starts on time; null: not judged),
//              beatsAll } | null (nothing to count: not heard)
//   win      { kind, text, j? } | null
//   cue      { kind, text, j?, dir?, at? } | null — dir: what to do, "higher" / "lower" / "sooner" /
//              "later"; at: [t0, t1] the attempt's seconds around the cued note (▶ you)
//            kinds — Line: win "spot" (every note and every start) · "note" (a note right on it);
//            cue "silent" · "offset" (the whole phrase off by one amount) · "pitch" · "unclear" ·
//            "timing". Beats: win "entry" (in on a start); cue "timing" · "silent".
//   fit      { a, b, g (grades), ns (the notes where the singer put them) } — Line: the singer's line
//   rn       { [i in the phrase]: { cls, dev, rdev } | null } — Beats: each note from take.rhythm
//   onsets   { measured, of } | null — starts with a measured onset, of the starts counted (Beats)
// (the fix plan's work packages add kinds and fields — key offset, notes not reached, onsets for Line:
// tools/earcases.mjs names what each one brings)
import { gradeTake } from "./grade.js?v=102";
import { median } from "./music.js?v=102";

// A line for Ear: the printed line (the fix plan's Q-A) — a lyric line, short ones joined to 4+ syllables, a
// long one cut near 8 (Amazing Grace: its four hymn lines, 9–11 s each). sing.js puts these into practice.js's
// PRACTICE.phrase before grouping.
export const EAR_PHRASE = { minSyl: 4, minSec: 0, maxSyl: 8, maxSec: 14 };

export const phraseJs = (ph) => { const out = []; for (let j = ph.j0; j < ph.j1; j++) out.push(j); return out; };
// The starts ♩ counts: the phrase's first note and every new syllable, ≥ 0.12 s.
export const startsOf = (ph, notes) => phraseJs(ph).filter((j) => notes[j].d >= 0.12 && (j === ph.j0 || (!notes[j].melisma && notes[j].text)));
// The notes ♪ counts: ≥ 0.12 s.
export const countedOf = (ph, notes) => phraseJs(ph).filter((j) => notes[j].d >= 0.12);
// A note named for the singer: its syllable, else its name.
export const wordOf = (j, { notes, name }) => { const t = (notes[j].text || "").replace(/[-‿]/g, "").trim(); return t ? `“${t}”` : name(notes[j].midi); };
export const hitOf = (g) => !!g && (g.status === "good" || g.status === "ok");

// The singer's own line: notes at t = a + b·(written t − the phrase's start), a and b searched,
// each candidate graded (gradeTake), the one hitting most notes kept.
export function fitFree(ph, frames, endT, { notes }) {
  const js = phraseJs(ph), T0 = notes[ph.j0].t;
  const voiced = frames.filter((f) => f.midi != null);
  if (voiced.length < 6) return null;
  const a0 = voiced[0].t;
  const tryAB = (a, b) => {
    const ns = js.map((j) => ({ ...notes[j], t: a + b * (notes[j].t - T0), d: b * notes[j].d, midi: notes[j].midi }));
    const g = gradeTake(ns, frames, { endT });
    let s = 0;
    g.forEach((x) => { if (hitOf(x)) s += 1 + 0.25 * (x.hit || 0); });
    return { s, g, ns, a, b };
  };
  let best = null;
  const better = (r) => { if (!best || r.s > best.s + 1e-9) best = r; };
  for (let b = 0.6; b <= 1.5001; b += 0.03) better(tryAB(a0 - 0.04, b));
  const bb = best.b;
  for (let a = a0 - 0.3; a <= a0 + 0.3001; a += 0.06) better(tryAB(a, bb));
  const a1 = best.a, b1 = best.b;
  for (let b = b1 - 0.04; b <= b1 + 0.0401; b += 0.02) for (let a = a1 - 0.06; a <= a1 + 0.0601; a += 0.03) better(tryAB(a, b));
  return best;
}

// The free attempt (● Sing, on your own time): its counts, its win and one cue.
export function judgeFree(ph, frames, endT, ctx) {
  const { notes } = ctx;
  const word = (j) => wordOf(j, ctx);
  const voiced = frames.filter((f) => f.midi != null).length;
  if (voiced < 6) return { counts: null, win: null, cue: { kind: "silent", text: "Didn't hear you" } };
  const fit = fitFree(ph, frames, endT, ctx);
  const js = phraseJs(ph), gOf = (j) => fit.g[j - ph.j0], nOf = (j) => fit.ns[j - ph.j0];
  const counted = countedOf(ph, notes), starts = startsOf(ph, notes);
  const hits = counted.filter((j) => hitOf(gOf(j)));
  const beat = ctx.spq * fit.b;
  const tol = Math.min(0.16, Math.max(0.08, 0.33 * beat));
  // (where each hit note really started — its moved slot — against a robust line through them: the
  // singer's own steady tempo; a start is on when it sits on that line)
  const T0 = notes[ph.j0].t, pts = js.filter((j) => hitOf(gOf(j))).map((j) => [notes[j].t - T0, nOf(j).t + (gOf(j).shift || 0), j]);
  let slope = fit.b, icpt = fit.a;
  if (pts.length >= 3) {
    const sl = [];
    for (let i = 0; i < pts.length; i++) for (let k = i + 1; k < pts.length; k++) if (pts[k][0] - pts[i][0] > 0.05) sl.push((pts[k][1] - pts[i][1]) / (pts[k][0] - pts[i][0]));
    if (sl.length) slope = median(sl);
    icpt = median(pts.map(([x, y]) => y - slope * x));
  }
  const resid = (j) => nOf(j).t + (gOf(j).shift || 0) - (icpt + slope * (notes[j].t - T0));
  const onStarts = starts.filter((j) => hitOf(gOf(j)) && Math.abs(resid(j)) <= tol);
  const counts = { notes: hits.length, notesAll: hits.length === counted.length, beats: hits.length * 3 >= counted.length ? onStarts.length : null, beatsAll: onStarts.length === starts.length };
  // the cue: the whole phrase off by one amount → the start note; else the note off longest; mostly unclear; a start furthest off
  const judged = js.filter((j) => gOf(j) && gOf(j).dev != null && gOf(j).status !== "unsung" && gOf(j).status !== "missed");
  const devs = judged.map((j) => gOf(j).dev * 100);
  const med = devs.length ? median(devs) : 0, spread = devs.length ? Math.max(...devs) - Math.min(...devs) : 0;
  let cue = null;
  if (devs.length >= 3 && Math.abs(med) >= 60 && spread < 80) { const dir = med > 0 ? "lower" : "higher"; cue = { kind: "offset", dir, text: `Start note · ${dir}`, j: ph.j0 }; }
  if (!cue) {
    const off = js.filter((j) => gOf(j)?.status === "off").sort((x, y) => notes[y].d - notes[x].d)[0];
    if (off != null) { const dir = gOf(off).dev > 0 ? "lower" : "higher"; cue = { kind: "pitch", dir, text: `${word(off)} · ${dir}`, j: off }; }
  }
  if (!cue && js.filter((j) => gOf(j)?.status === "unclear").length * 2 >= js.length) cue = { kind: "unclear", text: "Closer to the mic" };
  if (!cue && counts.beats != null) {
    const late = starts.filter((j) => hitOf(gOf(j)) && Math.abs(resid(j)) > tol).sort((x, y) => Math.abs(resid(y)) - Math.abs(resid(x)))[0];
    if (late != null) { const dir = resid(late) > 0 ? "sooner" : "later"; cue = { kind: "timing", dir, text: `${word(late)} · ${dir}`, j: late }; }
  }
  if (cue?.j != null) { const n = nOf(cue.j); cue.at = [Math.max(0, n.t - 0.4), n.t + n.d + 0.4]; }
  const firstHit = js.find((j) => gOf(j)?.status === "good");
  const win = counts.notesAll && counts.beatsAll ? { kind: "spot", text: "That's it" } : firstHit != null && (!cue || cue.j !== firstHit) ? { kind: "note", text: `${word(firstHit)} on the note`, j: firstHit } : null;
  return { counts, win, cue, fit };
}

// Beats (● Sing with the click): the take's rhythm (takerhythm.js rhythmOf, a guided span) → each start
// on or not, the counts, one win, one cue.
export function judgeBeats(ph, take, ctx) {
  const { notes } = ctx;
  const word = (j) => wordOf(j, ctx);
  const starts = startsOf(ph, notes), rn = take.rhythm?.notes || [];
  const on = starts.filter((j) => { const r = rn[j]; return r && (r.cls === "on" || r.cls === "close"); });
  const measured = starts.filter((j) => rn[j] && rn[j].cls);
  const counts = { beats: measured.length * 2 >= starts.length ? on.length : null, beatsAll: on.length === starts.length };
  const worst = starts.filter((j) => rn[j]?.cls === "early" || rn[j]?.cls === "late").sort((x, y) => Math.abs(rn[y].rdev ?? rn[y].dev ?? 0) - Math.abs(rn[x].rdev ?? rn[x].dev ?? 0))[0];
  const dir = worst != null && rn[worst].cls === "late" ? "sooner" : "later";
  const cue = worst != null ? { kind: "timing", dir, text: `${word(worst)} · ${dir}`, j: worst } : take.frames?.some((f) => f.midi != null) ? null : { kind: "silent", text: "Didn't hear you" };
  const winJ = on[0];
  return {
    rn: Object.fromEntries(phraseJs(ph).map((j) => [j - ph.j0, rn[j] ? { cls: rn[j].cls, dev: rn[j].dev, rdev: rn[j].rdev } : null])),
    counts: cue?.kind === "silent" ? null : counts,
    win: winJ != null && counts.beats != null ? { kind: "entry", text: `In on ${word(winJ)}`, j: winJ } : null,
    cue,
    onsets: { measured: measured.length, of: starts.length },
  };
}

// A result as resonateDebug() shows it: everything but the recording and the fitted notes (the grades,
// per note in the phrase, instead).
export function debugRes(res) {
  if (!res) return null;
  const { voice, fit, songT0, ...rest } = res;
  return { ...rest, fit: fit ? { a: fit.a, b: fit.b } : null, grades: fit?.g?.map((x) => x && { status: x.status, dev: x.dev, shift: x.shift }) };
}
