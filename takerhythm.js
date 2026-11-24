// A take's rhythm, from Sing (moved out of sing.js in cleanup C 5.1 — the node suites test
// these very functions): where each note sits in the beat (metricOf), and after a take each
// note's onset and what the timing says (rhythmOf), per phrase for guided practice
// (phraseRhythm). No page state: the score, the notes, the take and the session come in as
// arguments. rhythm.js finds the onsets; practice.js's PRACTICE holds the guided thresholds.
import { findOnsets, rhythmStats, rhythmObservations, tolOn, firstSound, voiceCover, noteCover } from "./rhythm.js?v=103";
import { PRACTICE } from "./practice.js?v=103";

// (The meter is the one in effect at a measure — a song may change it, e.g. Piano Man's
// "Freely" intro in 4/4, then 3/4.)
export const meterAt = (score, mi) => score.meters?.[mi] || [score.beats, score.beatType];
export const measureAt = (score, q) => { let m = 0; score.measures.forEach((x, i) => { if (x <= q + 1e-6) m = i; }); return m; };
// The beat you feel (clicked and counted): a dotted quarter in 6/8, 9/8, 12/8 (a dotted
// eighth in 6/16…), else the meter's own unit (a half in 2/2). → { q (quarters), n (per bar) }
export const feltBeat = ([b, t]) => (b > 3 && b % 3 === 0 && t >= 8 ? { q: 12 / t, n: b / 3 } : { q: 4 / t, n: b });

// Per note, where it sits in the beat: { beat (s), u (the beat's division, s), off (not on a
// felt beat), level ("beat" | "div" | "sub"), toBeat (s to the next beat), entry (first note,
// or after a rest ≥ ½ beat), rest (s), lineEnd }. A pickup bar counts back from its barline.
//   score: measures, meters / beats, beatType, length, measureOf; notes: { q, t, d, restBefore };
//   lines: the lyric lines (note indices); qToT: quarters → song seconds.
export function metricOf(score, notes, lines, qToT) {
  const lineEnd = new Set(lines.map((l) => l[l.length - 1]));
  return notes.map((n, j) => {
    const mi = measureAt(score, n.q), meter = meterAt(score, mi), fb = feltBeat(meter);
    const m0 = score.measures[mi], end = score.measures[mi + 1] ?? score.length;
    const pickup = end - m0 < fb.n * fb.q - 1e-6 && (score.measureOf?.[mi] ?? mi) === 0;
    const origin = pickup ? end - fb.n * fb.q : m0;
    const pos = (n.q - origin) / fb.q, frac = pos - Math.floor(pos + 1e-6);
    const div = fb.q === 4 / meter[1] ? 2 : 3; // a compound beat divides in three
    const off = frac > 1e-6;
    const level = !off ? "beat" : Math.abs(frac * div - Math.round(frac * div)) < 1e-6 ? "div" : "sub";
    const beat = qToT(n.q + fb.q) - qToT(n.q);
    const prev = notes[j - 1];
    const rest = prev ? n.t - (prev.t + prev.d) : Infinity;
    return {
      beat, u: beat / div, off, level,
      toBeat: off ? qToT(origin + Math.ceil(pos - 1e-6) * fb.q) - n.t : 0,
      entry: !prev || (n.restBefore && rest >= beat / 2), rest: Math.min(rest, 9), lineEnd: lineEnd.has(j),
    };
  });
}

// After a take: each note's onset and what the timing says, from the recording (cal: the
// count-in clicks found in it, or null). → take.rhythm = { calibrated, rt, trust, lead, steady,
// drift, notes: [{ dev, rdev, cls, rel, kind, conf, u } | null], obs: [observation], diag }.
//   s: the session (latency, ac, songT0, count, beatSec, features, part); v: its recording
//   ({ start }, ctx s) or null; stopAt: ctx s; settings: the mic track's; take: range, grades,
//   frames, latency, guide; score / notes / lines / qToT as metricOf; tapped: a tapped timing map
//   plays; songPhrases: () => the song's phrases (note indices) while guiding, else null — asked
//   only for a free take (no s.part).
export function rhythmOf({ s, v, cal, stopAt, settings, take, score, notes, lines, qToT, tapped, songPhrases }) {
  if (!v) return null;
  const [j0, j1] = take.range;
  const diag = { coupling: cal ? cal.coupling : null, clicks: cal ? cal.n : 0, est: s.latency, out: s.ac.outputLatency ?? null, base: s.ac.baseLatency ?? null, settings };
  // The melody guide from a speaker the mic can hear (the count-in clicks were found): its
  // piano lands right on time in the recording, so the timing can't be judged. Headphones fix it.
  if (take.guide === "melody" && cal) {
    return { calibrated: true, rt: cal.rt, trust: "speaker-guide", lead: null, notes: notes.map(() => null), obs: [{ kind: "headphones", tone: "try", scope: "take" }], diag,
      ...(s.part?.phrases ? { phrases: s.part.phrases.map(() => ({ trust: "speaker-guide", guide: "melody", obs: [], takeObs: [] })) } : {}) };
  }
  const trip = cal ? cal.rt : s.latency;
  const ns = notes.slice(j0, j1);
  const met = metricOf(score, notes, lines, qToT).slice(j0, j1);
  const ls = lines.map((l) => l.filter((j) => j >= j0 && j < j1).map((j) => j - j0));
  const feat = s.features.result();
  const guided = !!s.part?.guided;
  // A guided span starts after its own count-in: its first note is an entry, after that rest.
  if (guided && met.length) met[0] = { ...met[0], entry: true, rest: Math.min(9, s.count * s.beatSec) };
  // Notes the pitch grading found nothing for aren't searched — but in a guided span a "missed"
  // note the singer clearly voiced (sung a beat late, out of its slot) still is: timing mustn't
  // rest on the pitch grade (a late entry used to come out as "Sing out").
  let unsung = ns.map((_, k) => ["unsung", "missed"].includes(take.grades[j0 + k]?.status));
  if (guided) {
    const quiet = [-Infinity, ns[0].t - (met[0]?.beat ?? s.beatSec)]; // the count-in: nobody sang there
    const cov = noteCover(feat, v.start, { songT0: s.songT0, trip, quiet }, ns, met.map((m) => m.beat));
    unsung = ns.map((_, k) => { const st = take.grades[j0 + k]?.status; return st === "unsung" || (st === "missed" && !(cov[k] >= PRACTICE.time.noteHeard)); });
  }
  const on = findOnsets(ns, feat, v.start, take.frames, met, { songT0: s.songT0, rt: cal ? cal.rt : null, latency: take.latency, endT: stopAt - s.songT0 - trip, unsung,
    ...(guided ? { loose: s.part.stage === "time", ...(cal ? { seedRange: PRACTICE.time.seedRound } : {}) } : {}) });
  // Saying the whole take was behind/ahead needs a measured round trip that's short (with a
  // long one — Bluetooth — the singer may be following the screen, which runs ahead of the
  // sound), the click guide, and no tapped timing map (the taps carry their own error).
  const st = rhythmStats(ns, on, met, ls, { calibrated: !!cal && cal.rt <= 0.1 && take.guide === "click" && !tapped });
  const obs = rhythmObservations(st, ls).map((o) => (o.j !== undefined ? { ...o, j: o.j + j0 } : o));
  const per = notes.map((_, j) => {
    if (j < j0 || j >= j1) return null;
    const x = st.notes[j - j0], o = on.notes[j - j0];
    return x.dev === null ? null : { dev: x.dev, rdev: x.rdev, cls: x.cls, rel: x.rel, kind: o.kind, conf: o.conf, u: met[j - j0].u };
  });
  const strict = !!cal && cal.rt <= 0.1 && take.guide === "click" && !tapped;
  const out = { calibrated: !!cal, calLead: strict, rt: cal ? cal.rt : null, trust: "ok", lead: on.lead, leadN: on.leadN ?? null, steady: st.steady, drift: st.drift, notes: per, obs, diag };
  // Per phrase, for guided practice: a guided span's phrases, or — a free take while guiding —
  // the song's (credit for what was sung; the whole-take path above is unchanged).
  const phr = s.part?.phrases ?? (!s.part ? songPhrases?.() ?? null : null);
  if (phr) try { out.phrases = phraseRhythm({ s, v, cal, ns, met, on, j0, feat, trip, phr, take, tapped }); } catch (err) { console.warn("practice: phrase rhythm", err); }
  return out;
}

// Guided practice: the timing facts practice.js judges each phrase of a span on (PhraseRhythm,
// docs/COACHING.md) — its observations, how much of it was voiced, how many of its syllables
// got an onset, and for the span's first phrase how late the first sound came after the count-in.
export function phraseRhythm({ s, v, cal, ns, met, on, j0, feat, trip, phr, take, tapped }) {
  const groups = phr.map((js) => js.filter((j) => j - j0 >= 0 && j - j0 < ns.length).map((j) => j - j0));
  const measured = !!cal && cal.rt <= 0.1;
  const strict = measured && take.guide === "click" && !tapped;
  const pst = rhythmStats(ns, on, met, groups, { calibrated: strict });
  const pobs = rhythmObservations(pst, groups);
  // (behind/ahead of the click: a round's own claim — a run's phrases don't each carry it)
  const takeObs = s.part && s.part.stage !== "song" ? pobs.filter((o) => o.scope === "take") : [];
  const quiet = [-Infinity, ns[0].t - (met[0]?.beat ?? s.beatSec)];
  const shiftT = take.latency - trip;
  return groups.map((g, pi) => {
    if (!g.length) return null;
    const first = ns[g[0]], last = ns[g[g.length - 1]];
    const syl = g.filter((k) => !ns[k].melisma);
    const classified = syl.filter((k) => (on.notes[k]?.conf ?? 0) >= 0.3 && on.notes[k]?.dev !== null && on.notes[k]?.dev !== undefined).length;
    const lead = on.lead ?? 0;
    const cover = voiceCover(feat, v.start, { songT0: s.songT0, trip, quiet }, [[first.t + lead, last.t + last.d + lead]])[0] ?? null;
    const beat = met[g[0]]?.beat ?? s.beatSec, u = met[g[0]]?.u ?? 0.3;
    let lag = null;
    if (pi === 0 && (s.part || g[0] === 0)) { // after the silent count-in
      const fs = firstSound(feat, v.start, take.frames, { songT0: s.songT0, trip, shiftT, from: first.t - beat, to: first.t + 4 * beat });
      lag = fs === null ? null : fs - first.t;
    } else if (g[0] > 0) {
      // A phrase after a real rest, inside a run: its first sound too — only when that rest
      // was really quiet (a singer holding the last note through it: no claim either way).
      const prev = ns[g[0] - 1], restS = first.t - (prev.t + prev.d);
      const q = [prev.t + prev.d + 0.15 + lead, first.t - 0.05 + lead];
      if (restS >= Math.max(0.5 * beat, 0.35) && q[1] - q[0] >= 0.15 && voiceCover(feat, v.start, { songT0: s.songT0, trip }, [q])[0] < 0.3) {
        const fs = firstSound(feat, v.start, take.frames, { songT0: s.songT0, trip, shiftT, from: Math.max(q[0], first.t - Math.min(beat, restS)), to: first.t + 4 * beat, quiet: q });
        lag = fs === null ? null : fs - first.t;
      }
    }
    return {
      trust: "ok", calibrated: !!cal, guide: take.guide, tapped, measuredRt: measured,
      lag, beat, u, cover, classified, syllables: syl.length, // (+ notes: take.rhythm.notes where judged — prOf)
      obs: pobs.filter((o) => o.scope !== "take" && o.li === pi).map((o) => (o.j !== undefined ? { ...o, j: o.j + j0 } : o)),
      takeObs, leadN: on.leadN ?? 0, seedAgrees: on.seed !== null && on.seed !== undefined && on.lead !== null && Math.abs(on.seed - on.lead) <= tolOn(u),
    };
  });
}
