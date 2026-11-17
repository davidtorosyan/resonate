// Play page: when a song's notes sound, for ▶ — a stretch picked on the page (in written order)
// or from a bar to the end (in Sing's performance order: its repeats, endings, D.S. / To Coda /
// Fine, so Play and Sing agree). Pure: DOM-on-XML, no audio, no drawing.
//
//   const T = timeline(doc, facts);              // every note and rest at its written place
//   const tr = track(T, { bars, keep, base });   // a schedule at 100%, in seconds
//
// Written time: quarters from the start of the score, bars in written order (repeats not taken),
// each bar as long as its longest part (a pickup is short) but never longer than its time
// signature (a voice OMR overfilled is cut at the barline). Tempo: `base` quarter notes a minute
// at the start (the song's own tempo, as Sing plays it at 100%), the score's later tempo marks as
// ratios of its first.

const kids = (el, name) => { const out = []; for (const c of el.children) if (c.nodeName === name) out.push(c); return out; };
const kid = (el, name) => { for (const c of el.children) if (c.nodeName === name) return c; return null; };
const txt = (el) => (el ? el.textContent.trim() : "");
const num = (el, d = 0) => { const s = txt(el); if (s === "") return d; const v = Number(s); return Number.isFinite(v) ? v : d; };
const UNIT_QUARTERS = { whole: 4, half: 2, quarter: 1, eighth: 0.5, "16th": 0.25 };
const EPS = 1e-6;
// A grace note: this long (s at 100%), just before its note.
export const GRACE = 0.07;
// Keys struck within this (s) are struck together: one strike a key, a chord's loudness.
const STRUCK = 0.01;

// A <metronome>'s tempo in quarter notes a minute ("about 76", a dotted half = 58 → 174), or null.
function metronomeBpm(met) {
  const per = Number((/\d+(?:\.\d+)?/.exec(txt(kid(met, "per-minute"))) || [])[0]);
  const unit = UNIT_QUARTERS[txt(kid(met, "beat-unit"))] || 1;
  const dotted = kid(met, "beat-unit-dot") ? 1.5 : 1;
  return per > 0 ? per * unit * dotted : null;
}

// → {
//   bars: [{ q (written start), len }] per written measure index,
//   length (quarters, the whole score),
//   els: [{ id, part, staff, voice, mi, q, o (from the bar's start), d, rest, grace, chord (a
//           <chord/> member), cue, tieStart, tieStop, midi (pitched notes: the facts' sounding
//           pitch) }] in document order,
//   tempos: [{ q, bpm }] (the score's tempo marks, written order),
//   first: the tempo Sing reads (the first <sound tempo>, else the first <metronome>; null: none)
// }
export function timeline(doc, facts = new Map()) {
  const root = doc.documentElement;
  const parts = kids(root, "part");
  const lens = [], nominal = [], raw = [], marks = [];
  let metered = false; // (a score with no time signature: bars as long as their notes)
  parts.forEach((part) => {
    const pid = part.getAttribute("id");
    let div = 1, meter = 4;
    kids(part, "measure").forEach((m, mi) => {
      let pos = 0, max = 0, last = 0;
      for (const el of m.children) {
        const name = el.nodeName;
        if (name === "attributes") {
          const dv = num(kid(el, "divisions"), 0);
          if (dv > 0) div = dv;
          const t = kid(el, "time");
          if (t && kid(t, "beats")) { meter = (num(kid(t, "beats"), 4) || 4) * 4 / (num(kid(t, "beat-type"), 4) || 4); metered = true; }
        } else if (name === "backup") pos -= num(kid(el, "duration"), 0) / div;
        else if (name === "forward") { pos += num(kid(el, "duration"), 0) / div; max = Math.max(max, pos); }
        else if (name === "sound" || name === "direction") {
          const snds = name === "sound" ? [el] : kids(el, "sound");
          const off = name === "direction" ? num(kid(el, "offset"), 0) / div : 0;
          let bpm = null;
          for (const s of snds) { const t = Number(s.getAttribute("tempo")); if (t > 0) bpm = t; }
          if (bpm == null && name === "direction") {
            for (const dt of kids(el, "direction-type")) { const met = kid(dt, "metronome"); if (met) bpm = metronomeBpm(met) ?? bpm; }
          }
          if (bpm != null) marks.push({ mi, o: Math.max(0, pos + off), bpm });
        } else if (name === "note") {
          const chord = !!kid(el, "chord"), grace = !!kid(el, "grace");
          const d = grace ? 0 : num(kid(el, "duration"), 0) / div;
          const o = chord ? last : pos;
          // (a whole-bar rest fills whatever the bar is: OMR writes its length loosely — Piano Man's
          // 4-quarter rests in 3/4 bars, Songbird's 3½ and 4 on its stray top part)
          const mrest = kid(el, "rest")?.getAttribute("measure") === "yes";
          if (!chord) { last = pos; pos += d; if (!mrest) max = Math.max(max, pos); }
          const id = el.getAttribute("id");
          if (!id) continue;
          const ties = [...kids(el, "tie"), ...kids(el, "notations").flatMap((n) => kids(n, "tied"))].map((t) => t.getAttribute("type"));
          raw.push({
            id, part: pid, staff: num(kid(el, "staff"), 1), voice: txt(kid(el, "voice")) || "1", mi, o, d,
            rest: !!kid(el, "rest"), mrest, grace, chord, cue: !!kid(el, "cue"),
            tieStart: ties.includes("start") || ties.includes("continue"), tieStop: ties.includes("stop") || ties.includes("continue"),
            midi: facts.get(id)?.midi,
          });
        }
      }
      lens[mi] = Math.max(lens[mi] ?? 0, max);
      nominal[mi] ??= meter;
    });
  });
  const bars = [];
  let q = 0;
  for (let mi = 0; mi < lens.length; mi++) {
    // As long as its notes (a pickup, a last bar are short), not longer than its time signature: a
    // voice OMR overfilled (a half note where a quarter is printed) is cut at the barline (track)
    // instead of pushing every later bar late, as Verovio would. An empty bar: its time signature.
    const len = lens[mi] > EPS ? (metered && nominal[mi] ? Math.min(lens[mi], nominal[mi]) : lens[mi]) : nominal[mi] || 4;
    bars.push({ q, len });
    q += len;
  }
  for (const e of raw) {
    e.q = bars[e.mi].q + e.o;
    if (e.mrest) e.d = bars[e.mi].len;
  }
  const tempos = marks.map((t) => ({ q: bars[t.mi].q + Math.min(t.o, bars[t.mi].len), bpm: t.bpm })).sort((a, b) => a.q - b.q)
    .filter((t, i, a) => i === 0 || t.q > a[i - 1].q + EPS || t.bpm !== a[i - 1].bpm);
  // (the tempo Sing reads at 100%, as musicxml.js findTempo does: document order)
  let first = Number(root.querySelector("sound[tempo]")?.getAttribute("tempo")) || null;
  if (!(first > 0)) { const met = root.querySelector("metronome"); first = met ? metronomeBpm(met) : null; }
  return { bars, length: q, els: raw, tempos, first };
}

// Seconds at 100% from the start of the score (written order) to q: `base` quarter notes a
// minute until the first tempo mark, then each mark's tempo × base / first.
export function clock(T, base) {
  const first = T.first || T.tempos[0]?.bpm || base;
  const segs = [{ q: 0, spq: 60 / base, s: 0 }];
  for (const t of T.tempos) {
    const last = segs[segs.length - 1];
    const spq = 60 / (base * (t.bpm / first));
    if (t.q <= last.q + EPS) { last.spq = spq; continue; }
    segs.push({ q: t.q, spq, s: last.s + (t.q - last.q) * last.spq });
  }
  return (q) => {
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (segs[mid].q <= q + EPS) lo = mid; else hi = mid - 1; }
    const s = segs[lo];
    return s.s + (q - s.q) * s.spq;
  };
}

// The view's onsets (written q, ascending): where its notes and rests start — the columns a
// stretch is picked by. keep(el) → the view draws it.
export function onsets(T, keep) {
  const qs = [];
  for (const e of T.els) if (!e.grace && keep(e)) qs.push(e.q);
  qs.sort((a, b) => a - b);
  return qs.filter((x, i) => i === 0 || x > qs[i - 1] + EPS);
}
// The first onset after q (else the end of the score): where a stretch ending at q stops.
export function nextOnset(qs, q, end) {
  let lo = 0, hi = qs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (qs[mid] > q + EPS) hi = mid; else lo = mid + 1; }
  return lo < qs.length ? qs[lo] : end;
}
// The written bar holding q.
export function barAt(T, q) {
  let lo = 0, hi = T.bars.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (T.bars[mid].q <= q + EPS) lo = mid; else hi = mid - 1; }
  return lo;
}

// A schedule at 100% (seconds from its start).
//   bars: the written measures to play, in order (Sing's measureOf from a bar, or written order);
//   span: { q0, q1 } — only what starts in [q0, q1), cut at q1 (a stretch picked on the page;
//     bars then are the written ones it covers);
//   keep(el): the view plays it; base: quarter notes a minute at 100%.
// Ties join (a tied note sounds once, for its tied length); a jump in the bars (a repeat, an
// ending, D.S., To Coda) cuts what's held over it — the note after the jump is struck again. A
// note an overfilled voice runs past its bar's end is cut at the barline. Grace notes come GRACE
// apart just before their note (a grace chord's notes together); those of the first notes come
// before 0 — `pre` s of them, which a player starts that much earlier (a loop's next round: at the
// end of the round before). A key struck twice at once (the voice and the piano's tune in the full
// score, two voices on a unison) is struck once, for the longer of the two; both are lit.
// → { items: [{ id, midi, sec, dur (its own head's time), sound (false: a tie's continuation or a
//     unison's second note — lit, not struck), hold (sounding length), n (keys struck with it),
//     k (index in bars), q, grace }], bars: [{ k, mi, sec }], len, pre }
export function track(T, { bars, span = null, keep, base }) {
  const W = clock(T, base);
  const byBar = new Map();
  for (const e of T.els) {
    if (e.rest || e.cue || e.midi == null || !keep(e)) continue;
    if (span && (e.q < span.q0 - EPS || e.q >= span.q1 - EPS)) continue;
    (byBar.get(e.mi) || byBar.set(e.mi, []).get(e.mi)).push(e);
  }
  const items = [], marks = [];
  const open = new Map(); // part|midi → the sounding item a tie may extend
  let sec = 0; // the start of bar k on the schedule
  const origin = span ? W(span.q0) : 0;
  bars.forEach((mi, k) => {
    const bar = T.bars[mi];
    if (!bar) return;
    const b0 = W(bar.q);
    // (a stretch ending at a barline plays nothing of the next bar: no mark — the page would turn)
    if (span && k > 0 && W(span.q1) <= b0 + 1e-9) return;
    let start = sec;
    if (k === 0 && span) start = b0 - origin; // (the stretch may start mid-bar: its first bar starts before 0)
    if (k > 0 && mi !== bars[k - 1] + 1) open.clear(); // (a jump: nothing held over it)
    marks.push({ k, mi, sec: Math.max(0, start) });
    const end = span ? Math.min(W(bar.q + bar.len), W(span.q1)) - b0 : W(bar.q + bar.len) - b0;
    const list = (byBar.get(mi) || []).slice().sort((a, b) => a.q - b.q || (a.grace === b.grace ? 0 : a.grace ? -1 : 1));
    // (grace notes: a run of them just before their note, the last one nearest it; a grace chord's
    // notes — <chord/> after the first — share their place)
    const graceRank = graceRanks(list);
    for (const e of list) {
      const at = start + (W(e.q) - b0);
      if (e.grace) {
        items.push({ id: e.id, midi: e.midi, sec: at - GRACE * graceRank.get(e), dur: GRACE, sound: true, hold: GRACE, k, q: e.q, grace: true });
        continue;
      }
      if (W(e.q) - b0 >= end - 1e-9) continue; // (an overfilled voice's note starting past the barline)
      const stop = Math.min(start + (W(e.q + e.d) - b0), start + end);
      const dur = Math.max(0.01, stop - at);
      const key = e.part + "|" + e.midi;
      const prev = e.tieStop ? open.get(key) : null;
      if (prev && Math.abs(prev.sec + prev.hold - at) < 0.002) {
        prev.hold = stop - prev.sec;
        items.push({ id: e.id, midi: e.midi, sec: at, dur, sound: false, hold: 0, k, q: e.q });
        if (!e.tieStart) open.delete(key);
        continue;
      }
      const it = { id: e.id, midi: e.midi, sec: at, dur, sound: true, hold: dur, k, q: e.q };
      items.push(it);
      if (e.tieStart) open.set(key, it); else open.delete(key);
    }
    sec = start + end;
  });
  items.sort((a, b) => a.sec - b.sec);
  // (a key struck twice at once: one strike, the longer — two copies of one sample at one instant
  // add up in phase, +6 dB, and the full score's tune went past full scale; then how many keys
  // are struck together: a big chord is played softer)
  for (let i = 0; i < items.length;) {
    let j = i;
    while (j < items.length && items[j].sec < items[i].sec + STRUCK) j++;
    const keys = new Map();
    for (let x = i; x < j; x++) {
      const it = items[x];
      if (!it.sound) continue;
      const kept = keys.get(it.midi);
      if (!kept) { keys.set(it.midi, it); continue; }
      const [win, lose] = it.hold > kept.hold ? [it, kept] : [kept, it];
      lose.sound = false;
      lose.hold = 0;
      keys.set(it.midi, win);
    }
    for (let x = i; x < j; x++) items[x].n = keys.size;
    i = j;
  }
  const pre = items.length ? Math.max(0, -items[0].sec) : 0;
  return { items, bars: marks, len: Math.max(0, sec), pre };
}

// Grace notes' places before their note: 1 = nearest it. A run is one voice's graces at one onset
// (list sorted by onset, graces first, document order kept); a chord member shares the place of
// the grace before it.
function graceRanks(list) {
  const rank = new Map(), runs = new Map(); // run key → [[els of a place], …]
  for (const e of list) {
    if (!e.grace) continue;
    const key = e.q + "|" + e.part + "|" + e.staff + "|" + e.voice;
    let run = runs.get(key);
    if (!run) runs.set(key, (run = []));
    if (e.chord && run.length) run[run.length - 1].push(e);
    else run.push([e]);
  }
  for (const run of runs.values()) run.forEach((place, i) => { for (const e of place) rank.set(e, run.length - i); });
  return rank;
}
