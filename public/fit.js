// Fit a melody into a singer's range, best effort.
//
// One key for the whole song: every phrase moves by the same interval s (−6…+5
// semitones, so the song stays in one key). On top of that a phrase may move by whole
// octaves, which keeps it in that key: a song that alternates a low and a high singer
// (Hades and Eurydice in "Hey, Little Songbird") can have the low phrases sung an
// octave up and the high ones an octave down. Phrases are runs of notes between rests,
// also split at a leap of more than an octave (singers handing over without a rest).
//
// Cost, in beat·semitones: each note pays its length × how far it lies outside the
// comfortable range (5× more beyond the limits; a little within EDGE semitones of the
// comfortable edges, so a song that can sit inside doesn't hug them); changing octave between neighbouring
// phrases costs SWITCH; moving music at all costs a little (MOVE per beat per
// semitone), so a song that already fits stays as written, and the octave a phrase
// is sung in only changes when that clearly pays off. Searched exactly (dynamic
// programming over phrases for each key shift).

const SWITCH = 24;        // ≈ a 4-beat phrase sung 6 semitones out of comfort
const MOVE = 0.02;
const BEYOND = 4;         // extra weight per semitone beyond the limits
const EDGE = 2, EDGE_COST = 0.25;
const LEAP = 12;          // a jump of more than this starts a new phrase
const OCTAVES = [-3, -2, -1, 0, 1, 2, 3];

// notes: [{ midi, dur (beats), restBefore }]; range: { low, high, comfortLow, comfortHigh } (MIDI).
// Returns { key, shifts: [semitones per note], phrases, moves, outside, beyond } —
// key: the shift most of the song gets (every shift is key ± whole octaves); moves:
// [{ shift, phrases, beats }] most-sung first; outside/beyond: share of the sung beats
// still outside the comfortable range / beyond the limits. A song that already sits
// inside the comfortable range is left as written.
export function fitToRange(notes, range) {
  if (!notes.length) return null;
  const cLo = range.comfortLow ?? range.low, cHi = range.comfortHigh ?? range.high;
  const lo = range.low ?? cLo, hi = range.high ?? cHi;
  const phrases = [];
  notes.forEach((n, i) => {
    if (!i || n.restBefore || Math.abs(n.midi - notes[i - 1].midi) > LEAP) phrases.push([]);
    phrases[phrases.length - 1].push(i);
  });
  const edge = Math.min(EDGE, (cHi - cLo) / 4);
  const miss = (m) =>
    Math.max(0, cLo - m) + Math.max(0, m - cHi) + BEYOND * (Math.max(0, lo - m) + Math.max(0, m - hi)) +
    EDGE_COST * (Math.max(0, Math.min(edge, cLo + edge - m)) + Math.max(0, Math.min(edge, m - (cHi - edge))));
  const beats = phrases.map((p) => p.reduce((a, i) => a + notes[i].dur, 0));
  const allBeats = beats.reduce((a, b) => a + b, 0);
  const report = (s, octs) => {
    const shifts = new Array(notes.length);
    const moves = new Map();
    let outBeats = 0, beyondBeats = 0;
    phrases.forEach((p, k) => {
      const t = s + 12 * octs[k];
      const mv = moves.get(t) || { shift: t, phrases: 0, beats: 0 };
      mv.phrases++;
      mv.beats += beats[k];
      moves.set(t, mv);
      for (const i of p) {
        shifts[i] = t;
        const m = notes[i].midi + t;
        if (m < cLo || m > cHi) outBeats += notes[i].dur;
        if (m < lo || m > hi) beyondBeats += notes[i].dur;
      }
    });
    const list = [...moves.values()].sort((a, b) => b.beats - a.beats);
    return {
      key: list[0].shift,
      shifts,
      phrases: phrases.length,
      moves: list,
      outside: allBeats ? outBeats / allBeats : 0,
      beyond: allBeats ? beyondBeats / allBeats : 0,
    };
  };
  if (notes.every((n) => n.midi >= cLo && n.midi <= cHi)) return report(0, phrases.map(() => 0));

  const cost = (k, t) => phrases[k].reduce((a, i) => a + notes[i].dur * miss(notes[i].midi + t), 0) + MOVE * beats[k] * Math.abs(t);

  let best = null;
  for (let s = -6; s <= 5; s++) {
    // dp[o]: cheapest way to sing phrases 0..k with phrase k shifted by s + 12·o.
    let dp = OCTAVES.map((o) => cost(0, s + 12 * o));
    const from = [];
    for (let k = 1; k < phrases.length; k++) {
      const prev = dp;
      const back = [];
      dp = OCTAVES.map((o, oi) => {
        let bi = 0, bv = Infinity;
        prev.forEach((v, pi) => {
          const c = v + (pi === oi ? 0 : SWITCH);
          if (c < bv) { bv = c; bi = pi; }
        });
        back.push(bi);
        return bv + cost(k, s + 12 * o);
      });
      from.push(back);
    }
    let oi = dp.indexOf(Math.min(...dp));
    const total = dp[oi];
    if (best && total >= best.total) continue;
    const octs = new Array(phrases.length);
    for (let k = phrases.length - 1; k >= 0; k--) {
      octs[k] = OCTAVES[oi];
      if (k) oi = from[k - 1][oi];
    }
    best = { total, s, octs };
  }

  return report(best.s, best.octs);
}
