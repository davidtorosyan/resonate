// Small music helpers shared by the record and sing pages.

export const SHARPS = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export const FLATS = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
export const BLACK = new Set([1, 3, 6, 8, 10]);

export function noteName(midi, flats = false) {
  const names = flats ? FLATS : SHARPS;
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export function midiToFreq(m) {
  return 440 * 2 ** ((m - 69) / 12);
}

export function freqToMidi(f) {
  return 69 + 12 * Math.log2(f / 440);
}

// Wrap a semitone difference into [-6, 6] — "same note, any octave".
export function fold(semis) {
  return semis - 12 * Math.round(semis / 12);
}

export function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export function centsLabel(c) {
  return `${c > 0 ? "+" : c < 0 ? "" : "±"}${c}¢`;
}

// --- Transposition -------------------------------------------------------------
// Moving a melody by some semitones is exact for pitch, but notation needs more: the
// new key (fewest accidentals) and every note spelled by the *interval* (C minor up a
// whole tone is D minor, so its A♭ becomes B♭ and its leading-tone B♮ becomes C♯ —
// not "A♯" and "C"), the way a transposing editor does it.

const LETTER_PC = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
const MAJOR_KEYS = ["C♭", "G♭", "D♭", "A♭", "E♭", "B♭", "F", "C", "G", "D", "A", "E", "B", "F♯", "C♯"];
const MINOR_KEYS = ["A♭", "E♭", "B♭", "F", "C", "G", "D", "A", "E", "B", "F♯", "C♯", "G♯", "D♯", "A♯"];
const ACC = { "-2": "𝄫", "-1": "♭", 0: "", 1: "♯", 2: "𝄪" };

// The key `semis` semitones from `fifths` (-7..7 on the circle of fifths) with the
// fewest accidentals (6 flats rather than 6 sharps), and the interval's size in
// letter names (`steps`: C→D is 1, C→F♯ is 3, an octave down is -7).
export function transposeKey(fifths, semis) {
  let f = (((fifths + 7 * semis) % 12) + 12) % 12; // 0..11
  if (f >= 6) f -= 12;                              // -6..5: 6 flats rather than 6 sharps
  const steps7 = (((4 * (f - fifths)) % 7) + 7) % 7; // each fifth up moves the tonic 4 letters
  const steps = steps7 + 7 * Math.round((semis * 7 / 12 - steps7) / 7);
  return { fifths: f, steps };
}

export function keyName(fifths, minor) {
  return minor ? `${MINOR_KEYS[fifths + 7]}m` : MAJOR_KEYS[fifths + 7];
}

// Spell a written note ({ midi, letter 0-6, alter }) moved by `semis` semitones and
// `steps` letters. Double sharps/flats are respelled (a singer reads G, not F𝄪) with
// `flats` deciding the black keys. Returns { name: "B♭4", midi }.
export function spellTransposed(n, semis, steps, flats = false) {
  const midi = n.midi + semis;
  if (n.letter === undefined || n.letter < 0) return { name: noteName(midi, flats), midi };
  const natural = n.midi - (n.alter || 0);                  // the letter's own key
  const idx = 7 * Math.floor((natural - LETTER_PC[n.letter]) / 12) + n.letter + steps;
  const oct = Math.floor(idx / 7), letter = idx - 7 * oct;
  const alter = midi - (12 * oct + LETTER_PC[letter]);
  if (Math.abs(alter) > 1) return { name: noteName(midi, flats), midi };
  // oct counts from MIDI 0 (C-1): scientific octave = oct - 1.
  return { name: `${"CDEFGAB"[letter]}${ACC[alter]}${oct - 1}`, midi };
}
