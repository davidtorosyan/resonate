// Fit a melody into a singer's range, best effort.
//
// Transposing the whole song by t semitones is the simple case. A song that alternates
// a low and a high singer on one staff (Hades and Eurydice in "Hey, Little Songbird")
// may fit no single t, so a key can also be sung "split": every phrase moves by the same
// interval s (−6…+5, so the song stays in one key) plus whole octaves of its own — the
// low phrases an octave up, the high ones an octave down. Phrases are runs of notes
// between rests, also split at a leap of more than an octave (singers handing over
// without a rest).
//
// Cost, in beat·semitones: each note pays its length × how far it lies outside the
// comfortable range (5× more beyond the limits; a little within EDGE semitones of the
// comfortable edges, so an option that can sit inside doesn't hug them); changing octave
// between neighbouring phrases costs SWITCH; moving music at all costs a little (MOVE per
// beat per semitone). A split is searched exactly (dynamic programming over phrases for
// each key s).
//
// fitOptions lists the choices (every whole-song shift −24…+24, plus each key's best
// split where that beats singing the key whole); fitKey re-solves one key's split;
// fitToRange picks the single best option.

const SWITCH = 24;        // ≈ a 4-beat phrase sung 6 semitones out of comfort
const MOVE = 0.02;
const BEYOND = 4;         // extra weight per semitone beyond the limits
const EDGE = 2, EDGE_COST = 0.25;
const LEAP = 12;          // a jump of more than this starts a new phrase
const OCTAVES = [-3, -2, -1, 0, 1, 2, 3];
const WHOLE = 24;         // whole-song shifts listed: −24…+24

// notes: [{ midi, dur (beats), restBefore }]; range: { low, high, comfortLow, comfortHigh } (MIDI).
function prepare(notes, range) {
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
  const cost = (k, t) => phrases[k].reduce((a, i) => a + notes[i].dur * miss(notes[i].midi + t), 0) + MOVE * beats[k] * Math.abs(t);

  // An option: phrase k sung shifted by s + 12·octs[k].
  //   { s (−6…+5: the key), key: the shift most of the song gets, shifts: [per note],
  //     moves: [{ shift, phrases, beats }] most-sung first, split: moves.length > 1,
  //     outside / beyond: share of the sung beats outside the comfortable range / the limits,
  //     total: cost (lower is better) }
  const option = (s, octs, total) => {
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
      s: (((s % 12) + 18) % 12) - 6,
      key: list[0].shift,
      shifts,
      phrases: phrases.length,
      moves: list,
      split: list.length > 1,
      outside: allBeats ? outBeats / allBeats : 0,
      beyond: allBeats ? beyondBeats / allBeats : 0,
      total,
    };
  };

  const whole = (t) => option(t, phrases.map(() => 0), phrases.reduce((a, _, k) => a + cost(k, t), 0));

  // The best split in key s: dp[o] = cheapest way to sing phrases 0..k, phrase k at s + 12·o.
  const solveKey = (s) => {
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
    const octs = new Array(phrases.length);
    for (let k = phrases.length - 1; k >= 0; k--) {
      octs[k] = OCTAVES[oi];
      if (k) oi = from[k - 1][oi];
    }
    return option(s, octs, total);
  };

  return { whole, solveKey, fitsAsWritten: notes.every((n) => n.midi >= cLo && n.midi <= cHi) };
}

// Every choice: the whole-song shifts −24…+24, and for each key the best split when it's
// actually split and cheaper than singing that key whole in any octave.
export function fitOptions(notes, range) {
  if (!notes.length) return [];
  const f = prepare(notes, range);
  const out = [];
  const bestWhole = new Map(); // key s → cheapest whole-song option in it
  for (let t = -WHOLE; t <= WHOLE; t++) {
    const o = f.whole(t);
    out.push(o);
    if (!bestWhole.has(o.s) || o.total < bestWhole.get(o.s).total) bestWhole.set(o.s, o);
  }
  for (let s = -6; s <= 5; s++) {
    const o = f.solveKey(s);
    if (o.split && o.total < (bestWhole.get(o.s)?.total ?? Infinity)) out.push(o);
  }
  return out;
}

// Key s's best split (see fitOptions), for a song saved as "fit:s".
export function fitKey(notes, range, s) {
  return notes.length ? prepare(notes, range).solveKey(s) : null;
}

// The single best option; a song already inside the comfortable range stays as written.
export function fitToRange(notes, range) {
  if (!notes.length) return null;
  if (prepare(notes, range).fitsAsWritten) return prepare(notes, range).whole(0);
  return fitOptions(notes, range).reduce((a, b) => (b.total < a.total ? b : a));
}
