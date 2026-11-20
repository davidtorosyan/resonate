// pdfprep tempoMark on text rows: music-font glyphs, Unicode, letters of a music text font.
import { tempoMark } from '/home/user/resonate/public/omr/pdfprep.js';
const row = (...strs) => ({ items: strs.map((str, i) => ({ str, transform: [1, 0, 0, 1, i * 10, 500] })) });
const cases = [
  [row('Fast three, in one', 'h.', '=', '58'), { bpm: 58, unit: 'half', dotted: true }],
  [row('Moderately', 'q', ' = 104'), { bpm: 104, unit: 'quarter', dotted: false }],
  [row('Swing', 'e', '= 160'), { bpm: 160, unit: 'eighth', dotted: false }],
  [row('Moderately ♩ = 92-96'), { bpm: 92, unit: 'quarter', dotted: false }],
  [row('Slowly = 66'), { bpm: 66, unit: null, dotted: false }],
  [row(' = 58'), { bpm: 58, unit: 'half', dotted: true }],
  // The Longest Time: the half note is a picture; "in 2" says where the beat is.
  [row('in 2 (', ' = about 76)'), { bpm: 76, unit: null, dotted: false, felt: 2 }],
  [{ items: [{ str: 'Bright rock and roll, in one', transform: [1, 0, 0, 1, 0, 520] }, { str: '( = about 76)', transform: [1, 0, 0, 1, 0, 508] }] }, { bpm: 76, unit: null, dotted: false, felt: 1 }],
  [row('Moderately (', '≈ 120)'), { bpm: 120, unit: null, dotted: false }],
  [row('Slow ballad', '= ca. 66'), { bpm: 66, unit: null, dotted: false }],
  [row('Waltz', 'q', '= approx. 140'), { bpm: 140, unit: 'quarter', dotted: false }],
];
let fails = 0;
for (const [c, want] of cases) {
  const got = tempoMark(c);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c.items.map((i) => i.str).join(' ')} → ${JSON.stringify(got)}`);
}
process.exitCode = fails ? 1 : 0;
