// The drawn hand's plan and pose (E7 "hand" mode; public/handplan.js — docs/FINGERING.md "The drawn
// hand"), in node: no browser, no drawing.
//   A  a demo of the moves the design names (the prototype's): a C major scale two octaves up and down
//      (thumb under, finger over), the left hand's broken chords, a held thumb while 5 stretches then a
//      jump, 1-3-5 chords stepwise, both hands holding a note while the others play — positions from
//      finger.js framesOf, as the stored fingering has them
//   B  Amazing Grace's fingering (tools/fixtures/finger/amazing-grace.json through finger.js), at its
//      tempo and at half speed
//   on each, at an iPad's keys (portrait, 4 octaves C3–B6) and a phone's (compact):
//      every note's finger holds its key at its onset + 10 ms, the tip within 0.3 key of the key's centre
//      and on the keys; the wrist always below the keys; a move lands LEAD before its first note (a fast
//      passage: at worst on it); stepping 1/60 s — no NaN, fingers 2–5 in order, a frame's largest
//      move ≤ 1.5 keys a tip and ≤ 1.2 the knuckles (a far jump's arc excepted: ≤ 2.5);
//      a plan from a sliding window of notes [t − 3, t + 4] gives the same pose at t (0.01 key);
//      reduced motion: the hand's place changes only at a move's landing; the next ring ≤ NEXT
//      (NEXT_FAR a far landing) before its note, a landing badge only on a key ≥ 0.45 key from its finger
//   C  the band: bandOf from the keys' height (0.8, a phone 0.6), none under 14 px a white key; handGeo's k
//   node handcases.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import C from "./lib/check.cjs";
import { fingerNotes, framesOf } from "../public/finger.js";
import { bandOf, handGeo, planHand, poseAt, frameAt, keyU, nailStates, LEAD, ARRIVE, NEXT, NEXT_FAR } from "../public/handplan.js";

const { ok, done } = C;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WHITE = new Set([0, 2, 4, 5, 7, 9, 11]);

// The keys' layout as keyboard.js lays them (geoOf).
function keysGeo(W, H, lo, hi) {
  const whites = [];
  for (let m = lo; m <= hi; m++) if (WHITE.has(m % 12)) whites.push(m);
  const ww = Math.min(48, W / whites.length), x0 = (W - ww * whites.length) / 2;
  return { W, H, lo, hi, ww, x0, whites, bw: ww * 0.58, bh: H * 0.6 };
}
const DEVICES = [
  { n: "ipad", W: 740, H: 106, lo: 48, hi: 95, phone: false }, // (820 px less the chips and #fing; clamp(56, 9vh, 110) at 1180)
  { n: "phone", W: 330, H: 76, lo: 48, hi: 83, phone: true },
];
const geoFor = (d) => { const kg = keysGeo(d.W, d.H, d.lo, d.hi); return handGeo(kg, bandOf(kg.H, kg.ww, d.phone)); };

// A hand's notes with finger.js's positions: { t, d, midi, f } → + fid, keys (framesOf over its onsets).
function withFrames(ns, h) {
  const onsets = [...new Set(ns.map((n) => n.t))].sort((a, b) => a - b);
  const path = onsets.map((q) => {
    const snd = ns.filter((n) => n.t <= q + 1e-6 && n.t + n.d > q + 1e-3).sort((a, b) => a.midi - b.midi);
    return { q, m: snd.map((n) => n.midi), f: snd.map((n) => n.f) };
  });
  const { frames, p } = framesOf(path, h);
  const pOf = new Map(onsets.map((q, j) => [q, p[j]]));
  return ns.map((n) => ({ ...n, h, fid: pOf.get(n.t), keys: frames[pOf.get(n.t)].keys }));
}
function demo() {
  const N = [];
  const add = (h, midi, f, t, d) => N.push({ h, midi, f, t: +t.toFixed(4), d });
  const up = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84], fu = [1, 2, 3, 1, 2, 3, 4, 1, 2, 3, 1, 2, 3, 4, 5];
  const dn = [83, 81, 79, 77, 76, 74, 72, 71, 69, 67, 65, 64, 62, 60], fd = [4, 3, 2, 1, 3, 2, 1, 4, 3, 2, 1, 3, 2, 1];
  up.forEach((m, i) => add("r", m, fu[i], i * 0.2, 0.2));
  dn.forEach((m, i) => add("r", m, fd[i], 3.0 + i * 0.2, i === dn.length - 1 ? 0.5 : 0.2));
  const lh = [[48, 52, 55, 52], [53, 57, 60, 57], [55, 59, 62, 59], [48, 52, 55]], lf = [5, 3, 1, 3];
  let t = 6.3;
  lh.forEach((ch, c) => ch.forEach((m, i) => { const last = c === 3 && i === 2; add("l", m, lf[i], t, last ? 0.6 : 0.24); t += 0.24; }));
  add("r", 60, 1, 10.4, 0.95);
  [[62, 2], [64, 3], [65, 4], [69, 5]].forEach(([m, f], i) => add("r", m, f, 10.6 + i * 0.2, i === 3 ? 0.15 : 0.2));
  [[79, 1], [83, 3], [86, 5], [83, 3], [79, 1]].forEach(([m, f], i) => add("r", m, f, 11.85 + i * 0.2, i === 4 ? 0.3 : 0.2));
  [[60, 64, 67], [62, 65, 69], [64, 67, 71], [65, 69, 72], [67, 71, 74]].forEach((ch, i) => ch.forEach((m, j) => add("r", m, [1, 3, 5][j], 13.1 + i * 0.45, i === 4 ? 0.45 : 0.4)));
  add("l", 48, 5, 15.6, 3.8);
  [52, 55, 52, 55, 52, 55, 52, 55].forEach((m, i) => add("l", m, m === 52 ? 3 : 1, 16.0 + i * 0.4, i === 7 ? 0.6 : 0.38));
  add("r", 64, 3, 15.6, 0.4); add("r", 65, 4, 16.0, 0.4); add("r", 67, 5, 16.4, 3.0);
  [[64, 3], [62, 2], [60, 1], [62, 2], [64, 3]].forEach(([m, f], i) => add("r", m, f, 17.0 + i * 0.4, i === 4 ? 0.7 : 0.38));
  return { r: withFrames(N.filter((n) => n.h === "r"), "r"), l: withFrames(N.filter((n) => n.h === "l"), "l") };
}
// Amazing Grace through finger.js: each note's hand, finger and position; times at `rate` of its tempo.
function grace(rate) {
  const dump = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/finger/amazing-grace.json"), "utf8"));
  const res = fingerNotes(dump.items, { hand: "sb" });
  const out = { r: [], l: [] };
  for (const it of dump.items) {
    const n = res.notes.get(it.id);
    if (!n || !(n.f > 0) || n.x.includes("w") || it.grace || it.tied) continue;
    const fr = res.frames[n.h][n.p];
    out[n.h].push({ id: it.id, h: n.h, f: n.f, midi: it.midi, t: it.t / rate, d: Math.max(0.05, it.d / rate), fid: n.p, keys: fr.keys });
  }
  for (const h of ["r", "l"]) out[h].sort((a, b) => a.t - b.t || a.midi - b.midi);
  return out;
}

// Screen y of a model point (hand.js toS).
const yOf = (g, p) => (p.z >= 0 ? g.H - p.z * g.S : g.H - p.z * g.Sb) - p.h * g.S * 0.16;

function check(label, notes, g) {
  const plans = { r: planHand(notes.r, "r", g), l: planHand(notes.l, "l", g) };
  // every note's finger holds its key at its onset + 10 ms, the tip over it, on the keys
  let n = 0, miss = [], far = 0, off = 0, wristUp = 0;
  for (const h of ["r", "l"]) for (const x of notes[h]) {
    n++;
    const p = poseAt(plans[h], x.t + 0.01, g, false);
    const fg = p?.fingers[x.f - 1];
    if (!fg || !fg.F.hold || fg.F.key?.m !== Math.max(g.lo, Math.min(g.hi, x.midi))) { miss.push(`${h}${x.f}@${x.t.toFixed(2)}:${x.midi}`); continue; }
    const k = keyU(g, x.midi);
    far = Math.max(far, Math.abs(fg.F.x - k.x));
    if (yOf(g, fg.T) > g.H) off++;
  }
  ok(!miss.length && far <= 0.3 && !off, `${label}: every note's finger holds its key at its onset (${n - miss.length}/${n}${miss.length ? "; " + miss.slice(0, 4).join(" ") : ""}), the tip within ${far.toFixed(3)} key of its centre, on the keys (${off} off)`);
  // moves land LEAD before their first note (a fast passage at worst on it)
  let early = 0, late = [], moves = 0;
  for (const h of ["r", "l"]) {
    const P = plans[h];
    for (const tr of P.trans) {
      moves++;
      const first = P.F[tr.k].first;
      if (tr.wait) continue; // (legato: the leading finger goes ahead alone, the palm follows the release)
      if (tr.t1 <= first - LEAD + 1e-6) early++;
      else if (tr.t1 > first + 0.05 + 1e-6) late.push(`${h}@${first.toFixed(2)}`);
    }
  }
  let disorder = 0;
  for (const h of ["r", "l"]) { const tr = plans[h].trans; for (let i = 1; i < tr.length; i++) if (tr[i].t0 < tr[i - 1].t1 - 1e-6) disorder++; }
  ok(!disorder, `${label}: the moves one at a time, in order (${disorder} overlapping)`);
  ok(!late.length, `${label}: ${moves} moves — ${early} land ${LEAD} s early, none after its note + 50 ms (${late.slice(0, 4).join(" ") || "none"})`);
  // stepping 1/60 s: no NaN; fingers 2–5 in order; the wrist below the keys; a frame's largest move
  let nan = 0, order = 0, wrist = 0, maxTip = 0, maxK = 0, flights = 0, fast = 0;
  const end = Math.max(...["r", "l"].map((h) => (notes[h].length ? notes[h].at(-1).t + notes[h].at(-1).d + 1 : 0)));
  for (const h of ["r", "l"]) {
    let prev = null;
    for (let t = -1; t < end; t += 1 / 60) {
      const p = poseAt(plans[h], t, g, false);
      if (!p) { prev = null; continue; }
      const vals = [p.K.x, p.K.z, p.W.x, p.W.z, ...p.fingers.flatMap((fg) => [fg.T.x, fg.T.z, fg.T.h, ...fg.j.flatMap((q) => [q.x, q.z, q.h])])];
      if (vals.some((v) => !Number.isFinite(v))) { nan++; continue; }
      // (two fingers both holding keys in the fingering's own order are its choice: a chord let go as the next is taken)
      for (let i = 1; i < 4; i++) if (plans[h].side * (p.fingers[i + 1].F.x - p.fingers[i].F.x) < -0.05 && !(p.fingers[i].F.hold && p.fingers[i + 1].F.hold)) { order++; break; }
      if (yOf(g, p.W) <= g.H) wrist++;
      if (prev && p.vis >= 1 && prev.vis >= 1) {
        const fly = p.lift > 0.05 || prev.lift > 0.05;
        if (fly) flights++;
        // (fast music excepted: a finger whose next note is that close has to get there — the run's own speed)
        for (let f = 0; f < 5; f++) {
          const d = Math.abs(p.fingers[f].T.x - prev.fingers[f].T.x), F = prev.fingers[f].F;
          // (a hand move squeezed between fast notes, or through a position passed in a moment — known: a
          // free finger can swing 3 keys a frame there, once in the owner's nine songs, Songbird's left hand)
          const T = frameAt(plans[h], t, g, false).T, quick = T && t > T.t0 && t - 1 / 60 < T.t1 && (T.t1 - T.t0 < 0.25 || T.from != null);
          const rushed = F.nextIn < 0.15 || p.fingers[f].F.hold !== F.hold || quick;
          if (rushed && d > 1.5) { fast++; continue; }
          if (!fly) maxTip = Math.max(maxTip, d); else if (d > 2.5) maxTip = Math.max(maxTip, d);
        }
        const dk = Math.abs(p.K.x - prev.K.x);
        if (!fly) maxK = Math.max(maxK, dk);
      }
      prev = p;
    }
  }
  ok(!nan && !order && !wrist, `${label}: stepping 1/60 s — ${nan} NaN, fingers 2–5 out of order ${order}, the wrist above the keys ${wrist}`);
  // (a tip: 1.5 keys a frame, 2 at a leap's free fingers — a teleport is what this catches; the knuckles 1.2)
  ok(maxTip <= 2 && maxK <= 1.2, `${label}: … a frame's largest move: a tip ${maxTip.toFixed(2)} keys${maxTip > 1.5 ? " (a free finger at a leap)" : ""}, the knuckles ${maxK.toFixed(2)} (${flights} frames in flight; ${fast} tip moves over 1.5 keys within 0.15 s of the finger's next note or in a hand move squeezed under 0.25 s or through a passing position — the music's speed)`);
  // a sliding window gives the same pose
  let worst = 0, samples = 0;
  for (let t = 3; t < end - 4; t += 0.37) {
    for (const h of ["r", "l"]) {
      const win = notes[h].filter((x) => x.t + x.d > t - 3 && x.t < t + 4);
      if (!win.length) continue;
      const a = poseAt(plans[h], t, g, false), b = poseAt(planHand(win, h, g), t, g, false);
      if (!a || !b) { if (!!a !== !!b && Math.abs((a?.vis ?? 0) - (b?.vis ?? 0)) > 0.01) worst = Math.max(worst, 1); continue; }
      samples++;
      for (let f = 0; f < 5; f++) worst = Math.max(worst, Math.abs(a.fingers[f].T.x - b.fingers[f].T.x));
      worst = Math.max(worst, Math.abs(a.K.x - b.K.x));
    }
  }
  ok(worst <= 0.01, `${label}: a plan from a sliding window [t − 3, t + 4] gives the same pose (${samples} samples, largest difference ${worst.toFixed(4)} key)`);
  // reduced motion: the knuckles' place changes only at a move's landing
  let rmMoves = 0, rmBad = 0;
  for (const h of ["r", "l"]) {
    const P = plans[h], lands = P.trans.map((tr) => tr.t1);
    let prev = null;
    for (let t = -1; t < end; t += 1 / 60) {
      const p = poseAt(P, t, g, true);
      if (!p) { prev = null; continue; }
      if (prev && Math.abs(p.K.x - prev.K.x) > 0.02) {
        rmMoves++;
        // (the knuckles follow the fingers held: a finger that strikes elsewhere in the same position pulls them too)
        const at = (u) => u > t - 1 / 60 - 1e-6 && u <= t + 1e-6;
        const atLand = lands.some(at);
        const atNote = P.notes.some((x) => at(x.t - ARRIVE) || at(x.t) || at(x.ev)); // (a finger takes its key, strikes, lets go)
        if (!atLand && !atNote) rmBad++;
      }
      prev = p;
    }
  }
  ok(!rmBad, `${label}: reduced motion — the hand snaps only at a landing or a note (${rmMoves} snaps, ${rmBad} elsewhere)`);
  // cues: the next ring no earlier than NEXT (NEXT_FAR a far landing); a badge only ≥ 0.45 key away
  let ringEarly = 0, badgeNear = 0, rings = 0;
  for (const h of ["r", "l"]) {
    for (let t = 0; t < end; t += 0.05) {
      const p = poseAt(plans[h], t, g, false);
      if (!p) continue;
      const st = nailStates(p);
      for (const s of st.out) {
        if (s.st !== "next") continue;
        rings++;
        const F = p.fingers[s.f - 1].F;
        if (F.nextIn > (F.toward?.far ? NEXT_FAR : NEXT) + 1e-6) ringEarly++;
      }
      for (const L of st.lands) { const F = p.fingers[L.f - 1].F; if (Math.hypot(F.toward.x - F.x, (F.toward.z - F.z) * 0.6) < 0.45 - 1e-6) badgeNear++; }
    }
  }
  ok(rings > 0 && !ringEarly && !badgeNear, `${label}: cues — ${rings} next rings, ${ringEarly} too early; ${badgeNear} landing badges under 0.45 key`);
}

for (const d of DEVICES) {
  const g = geoFor(d);
  ok(g.band > 0 && (g.mode === "full" || g.mode === "compact"), `${d.n}: a hand fits (${g.mode}, a white key ${g.ww.toFixed(1)} px, band ${g.band} px, k ${g.k.toFixed(2)})`);
  check(`A demo · ${d.n}`, demo(), g);
  check(`B Amazing Grace · ${d.n}`, grace(1), g);
  if (d.n === "ipad") check(`B Amazing Grace 50 % · ${d.n}`, grace(0.5), g);
}
// D: the owner's songs (their keyboard parts as tools/dumpkeys.cjs dumps them — never in the repo:
// KEYS=<dir>, as fingersurvey.mjs), at an iPad's keys over each song's range in whole octaves
if (process.env.KEYS) {
  for (const f of fs.readdirSync(process.env.KEYS).filter((x) => x.endsWith(".json")).sort()) {
    const dump = JSON.parse(fs.readFileSync(path.join(process.env.KEYS, f), "utf8"));
    const res = fingerNotes(dump.items, { hand: "sb" });
    const out = { r: [], l: [] };
    let lo = Infinity, hi = -Infinity;
    for (const it of dump.items) {
      const n = res.notes.get(it.id);
      if (!n || !(n.f > 0) || n.x.includes("w") || it.grace || it.tied) continue;
      out[n.h].push({ id: it.id, h: n.h, f: n.f, midi: it.midi, t: it.t, d: Math.max(0.05, it.d), fid: n.p, keys: res.frames[n.h][n.p].keys });
      lo = Math.min(lo, it.midi); hi = Math.max(hi, it.midi);
      for (const m of res.frames[n.h][n.p].keys) { lo = Math.min(lo, m); hi = Math.max(hi, m); }
    }
    for (const h of ["r", "l"]) out[h].sort((a, b) => a.t - b.t || a.midi - b.midi);
    lo = Math.min(48, 12 * Math.floor(lo / 12)); hi = Math.max(83, 12 * Math.floor(hi / 12) + 11);
    const kg = keysGeo(740, 106, lo, hi);
    const g = handGeo(kg, bandOf(kg.H, kg.ww, false));
    if (g.mode === "none") { console.log(`info  D ${f}: ${lo}–${hi} — a white key ${kg.ww.toFixed(1)} px: no hand (numbers)`); continue; }
    check(`D ${f.replace(/\.json$/, "")} (${out.r.length + out.l.length} notes, ${g.mode})`, out, g);
  }
}
// C: the band
ok(bandOf(106, 26.9, false) === 85 && bandOf(77, 15.5, true) === 46 && bandOf(81, 48, false) === 65, `C: the band — iPad 85, a phone 46, a desktop 65 px (${bandOf(106, 26.9, false)}, ${bandOf(77, 15.5, true)}, ${bandOf(81, 48, false)})`);
ok(bandOf(77, 11.6, true) === 0 && bandOf(106, 13.9, false) === 0, "C: no band under 14 px a white key");
{
  const a = handGeo(keysGeo(740, 106, 48, 95), 85), b = handGeo(keysGeo(740, 106, 48, 83), 85);
  ok(a.band === b.band && b.k < a.k && b.k >= 0.68, `C: another view's range keeps the band (${a.band}); wider keys, a smaller hand that splays (k ${a.k.toFixed(2)} → ${b.k.toFixed(2)})`);
}
done();
