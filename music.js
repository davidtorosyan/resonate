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
