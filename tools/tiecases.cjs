// restoreTies (omr/fixscore.js, through fixOmrScore) on hand-built scores shaped like Audiveris
// output: ties the engine missed, wrote half, linked to the wrong head or read as slurs, accidentals
// a lost tie didn't carry — and the look-alikes left alone; then markUnmarkedTuplets' runs.
// usage: node tiecases.cjs   (BASE defaults to the sitetest server: http://localhost:8097/resonate/)
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8097/resonate/';
const FIX = process.env.FIX || './omr/fixscore.js'; // (a scratch copy to try a change: FIX=/tmp/ties/fixscore.js)

// A part: { id, staves, measures: [[note...]] }; a note: [pitch "F#4" | "r", dur (eighths), opts]
// opts: { v voice, st staff, ch chord, tie 'start'|'stop'|'both', tied (only <tied>), slur [[type, number, default-y, default-x]],
//   lyr text, back eighths, grace (a grace note before the next), art (an articulation), acc (a printed accidental), x (the note's
//   default-x) } — durations in eighths (½ = a 16th; divisions 4); ['key', fifths] in a bar: a key change there (score's own: key).
//   A pitch's ♯/♭ is its <alter>, printed only with acc (as the engine writes a note whose accidental is the key's or carried).
// A tie listed with its note's pitch as it comes out: a continuation that takes the first note's accidental reads with it.
function score(parts, { time = [4, 4], key = 1 } = {}) {
  const pl = parts.map((p) => `<score-part id="${p.id}"><part-name>${p.name || p.id}</part-name></score-part>`).join('');
  const body = parts.map((p) => `<part id="${p.id}">` + p.measures.map((m, i) => {
    let x = `<measure number="${i + 1}">`;
    if (i === 0) x += `<attributes><divisions>4</divisions><key><fifths>${key}</fifths></key><time><beats>${time[0]}</beats><beat-type>${time[1]}</beat-type></time>${(p.staves || 1) > 1 ? `<staves>${p.staves}</staves>` : ''}<clef><sign>G</sign><line>2</line></clef></attributes>`;
    for (const [pitch, dur, o = {}] of m) {
      if (pitch === 'back') { x += `<backup><duration>${dur * 2}</duration></backup>`; continue; }
      if (pitch === 'key') { x += `<attributes><key><fifths>${dur}</fifths></key></attributes>`; continue; }
      if (pitch === 'ending') { x += `<barline location="left"><ending number="${dur}" type="start"/></barline>`; continue; }
      let n = `<note${o.x != null ? ` default-x="${o.x}"` : ''}>` + (o.grace ? '<grace/>' : '') + (o.ch ? '<chord/>' : '');
      if (pitch === 'r') n += '<rest/>';
      else {
        const [, step, acc, oct] = /^([A-G])([#b]?)(\d)$/.exec(pitch);
        n += `<pitch><step>${step}</step>${acc ? `<alter>${acc === '#' ? 1 : -1}</alter>` : ''}<octave>${oct}</octave></pitch>`;
      }
      if (!o.grace) n += `<duration>${dur * 2}</duration>`;
      const ts = o.tie === 'both' ? ['stop', 'start'] : o.tie ? [o.tie] : [];
      if (!o.tied) for (const t of ts) n += `<tie type="${t}"/>`;
      n += `<voice>${o.v || 1}</voice><type>eighth</type>${o.acc ? `<accidental>${o.acc}</accidental>` : ''}<staff>${o.st || 1}</staff>`;
      const no = ts.map((t) => `<tied type="${t}"/>`).join('') + (o.slur ? o.slur.map(([t, k, y, sx]) => `<slur type="${t}" number="${k}"${y != null ? ` default-y="${y}"` : ''}${sx != null ? ` default-x="${sx}"` : ''}/>`).join('') : '') + (o.art ? `<articulations><${o.art}/></articulations>` : '');
      if (no) n += `<notations>${no}</notations>`;
      if (o.lyr) n += `<lyric number="1"><syllabic>single</syllabic><text>${o.lyr}</text></lyric>`;
      x += n + '</note>';
    }
    return x + '</measure>';
  }).join('') + '</part>').join('');
  return `<?xml version="1.0"?><score-partwise version="4.0"><identification><encoding><software>Audiveris 5.11.0</software></encoding></identification><part-list>${pl}</part-list>${body}</score-partwise>`;
}
// eighths filling a 4/4 bar for a sung line: pitches with words, the tie given
const sung = (notes) => notes.map(([p, d, o = {}], i) => [p, d, { lyr: o.lyr ?? (o.tie === 'stop' || o.tie === 'both' ? undefined : 'la'), ...o }]);
const pad = (eighths, o = {}) => (eighths ? [['r', eighths, o]] : []);

// Killing Me Softly bar 3 shape: the voice ties F#4 4th → 5th eighth; the piano's F#4/A4 chord repeats with no tie.
const voice3 = { id: 'P1', name: 'Voice', measures: [sung([['F#4', 1], ['F#4', 1], ['F#4', 1], ['F#4', 1, { tie: 'start' }], ['F#4', 1, { tie: 'stop' }], ['D4', 1], ['A3', 1], ['B3', 1]])] };
const chordRun = (tail) => [['F#4', 1], ['A4', 1, { ch: true }], ['F#4', 1], ['A4', 1, { ch: true }], ['F#4', 1], ['A4', 1, { ch: true }], ['F#4', 1], ['A4', 1, { ch: true }], ...tail];

const cases = [
  {
    name: 'doubling: the piano repeats the tied chord → both notes tied (bar 3, "life")',
    xml: score([voice3, { id: 'P2', name: 'Piano', staves: 2, measures: [chordRun([['F#4', 1], ['A4', 1, { ch: true }], ['D4', 1], ['A4', 1, { ch: true }], ['A3', 1], ['A4', 1, { ch: true }], ['B3', 1], ['G4', 1, { ch: true }]])] }]),
    want: { P2: [['m1', 'F#4', 'start'], ['m1', 'A4', 'start'], ['m1', 'F#4', 'stop'], ['m1', 'A4', 'stop']] }, changed: true,
  },
  {
    name: 'doubling: the piano strikes a different chord where the voice ties → untouched (bar 7)',
    xml: score([voice3, { id: 'P2', name: 'Piano', staves: 2, measures: [chordRun([['F#4', 1], ['A4', 1, { ch: true }], ['B4', 1, { ch: true }], ['D4', 1], ['A4', 1, { ch: true }], ['A3', 1], ['A4', 1, { ch: true }], ['B3', 1], ['G4', 1, { ch: true }]])] }]),
    want: { P2: [] }, changed: false,
  },
  {
    name: 'doubling: the piano note is shorter than the voice\'s → untouched',
    xml: score([
      { id: 'P1', name: 'Voice', measures: [sung([['G4', 2, { tie: 'start' }], ['G4', 2, { tie: 'stop' }], ['r', 4]])] },
      { id: 'P2', name: 'Piano', measures: [[['G4', 1], ['G4', 1], ['G4', 1], ['G4', 1], ['r', 4]]] },
    ]),
    want: { P2: [] }, changed: false,
  },
  {
    name: 'slur from a chord to the same chord over the barline → ties on both notes, slur gone ("words")',
    xml: score([{ id: 'P2', name: 'Piano', measures: [
      [['r', 7], ['B3', 1, { slur: [['start', 1], ['continue', 1]] }], ['G4', 1, { ch: true }]],
      [['B3', 8, { slur: [['continue', 1], ['stop', 1]] }], ['G4', 8, { ch: true }]],
    ] }]),
    want: { P2: [['m1', 'B3', 'start'], ['m1', 'G4', 'start'], ['m2', 'B3', 'stop'], ['m2', 'G4', 'stop']] }, slurs: 0, changed: true,
  },
  {
    name: 'slur between different chords → a slur, untouched',
    xml: score([{ id: 'P2', name: 'Piano', measures: [[['C4', 2, { slur: [['start', 1]] }], ['E4', 2, { ch: true }], ['D4', 2, { slur: [['stop', 1]] }], ['F4', 2, { ch: true }], ['r', 4]]] }]),
    want: { P2: [] }, slurs: 2, changed: false,
  },
  {
    name: 'slur into a note with its own syllable → a slur, untouched',
    xml: score([{ id: 'P1', name: 'Voice', measures: [[['G4', 2, { lyr: 'oh', slur: [['start', 1]] }], ['G4', 2, { lyr: 'my', slur: [['stop', 1]] }], ['r', 4]]] }]),
    want: { P1: [] }, slurs: 2, changed: false,
  },
  {
    name: 'slur between two same notes, no word on the second → tie (a tie over a line break)',
    xml: score([{ id: 'P1', name: 'Voice', measures: [[['r', 6], ['G3', 2, { lyr: 'quell', slur: [['start', 1]] }]], [['G3', 2, { slur: [['stop', 1]] }], ['r', 6]]] }]),
    want: { P1: [['m1', 'G3', 'start'], ['m2', 'G3', 'stop']] }, slurs: 0, changed: true,
  },
  {
    name: 'chord tied on one note into the same chord → all tied',
    xml: score([{ id: 'P2', name: 'Piano', measures: [[['D4', 1], ['F4', 1, { ch: true }], ['A4', 1, { ch: true, tie: 'start' }], ['D4', 1], ['F4', 1, { ch: true }], ['A4', 1, { ch: true, tie: 'stop' }], ['r', 6]]] }]),
    want: { P2: [['m1', 'D4', 'start'], ['m1', 'F4', 'start'], ['m1', 'A4', 'start'], ['m1', 'D4', 'stop'], ['m1', 'F4', 'stop'], ['m1', 'A4', 'stop']] }, changed: true,
  },
  {
    name: 'half a tie (<tied> start only) on one voice, the other voice\'s note bare, next strike one chord → all tied, both forms',
    xml: score([{ id: 'P2', name: 'Piano', measures: [
      [['r', 6], ['G4', 2, { tie: 'start', tied: true }], ['back', 8], ['r', 6, { v: 2 }], ['B3', 2, { v: 2 }]],
      [['B3', 2], ['G4', 2, { ch: true }], ['r', 6]],
    ] }]),
    want: { P2: [['m1', 'G4', 'start'], ['m1', 'B3', 'start'], ['m2', 'B3', 'stop'], ['m2', 'G4', 'stop']] }, forms: true, changed: true,
  },
  {
    name: 'a strike whose notes differ in length → untouched',
    xml: score([{ id: 'P2', name: 'Piano', measures: [[['D4', 2, { tie: 'start' }], ['back', 2], ['F4', 1, { v: 2 }], ['r', 1, { v: 2 }], ['D4', 2], ['F4', 2, { ch: true }], ['r', 4]]] }]),
    want: { P2: [] }, changed: false,
  },
  {
    name: 'stray-syllable staff (1 word in 8 notes) ties G4; the piano repeats G4/B4 there → piano untouched',
    xml: score([
      { id: 'P1', name: 'Voice', measures: [sung([['C5', 4], ['C5', 4]]), sung([['C5', 8]])] },
      { id: 'P2', name: 'Piano', measures: [[['G4', 4], ['B4', 4, { ch: true }], ['G4', 4], ['B4', 4, { ch: true }]], [['G4', 8], ['B4', 8, { ch: true }]]] },
      { id: 'P3', name: 'Voice', measures: [[['G4', 4, { tie: 'start', lyr: 'x' }], ['G4', 4, { tie: 'stop' }]], [['E4', 1], ['E4', 1], ['E4', 1], ['E4', 1], ['E4', 1], ['E4', 1], ['E4', 2]]] },
    ]),
    want: { P2: [] }, changed: false,
  },
  {
    name: 'block chords under a held sung note (accompaniment, not doubling) → untouched',
    xml: score([
      { id: 'P1', name: 'Voice', measures: [sung([['C5', 2], ['D5', 2], ['C5', 2], ['E4', 2, { tie: 'start' }]]), sung([['E4', 2, { tie: 'stop' }], ['D4', 2], ['C4', 4]])] },
      { id: 'P2', name: 'Piano', measures: [
        [['C4', 2], ['E4', 2, { ch: true }], ['G4', 2, { ch: true }], ['C4', 2], ['E4', 2, { ch: true }], ['G4', 2, { ch: true }], ['C4', 2], ['E4', 2, { ch: true }], ['G4', 2, { ch: true }], ['C4', 2], ['E4', 2, { ch: true }], ['G4', 2, { ch: true }]],
        [['C4', 2], ['E4', 2, { ch: true }], ['G4', 2, { ch: true }], ['C4', 2], ['E4', 2, { ch: true }], ['G4', 2, { ch: true }], ['C4', 4], ['E4', 4, { ch: true }], ['G4', 4, { ch: true }]],
      ] },
    ]),
    want: { P2: [] }, changed: false,
  },
  {
    name: 'doubling after a rest: the voice\'s next note doubled too → tied',
    xml: score([
      { id: 'P1', name: 'Voice', measures: [sung([['r', 4], ['E4', 2, { tie: 'start' }], ['E4', 2, { tie: 'stop' }]]), sung([['F4', 8]])] },
      { id: 'P2', name: 'Piano', measures: [[['r', 4], ['E4', 2], ['C4', 2, { ch: true }], ['E4', 2], ['C4', 2, { ch: true }]], [['F4', 8], ['A3', 8, { ch: true }]]] },
    ]),
    want: { P2: [['m1', 'E4', 'start'], ['m1', 'C4', 'start'], ['m1', 'E4', 'stop'], ['m1', 'C4', 'stop']] }, changed: true,
  },
  {
    name: 'portato: a slur over two staccato identical chords → a slur, untouched',
    xml: score([{ id: 'P2', name: 'Piano', measures: [[['C4', 2, { slur: [['start', 1]], art: 'staccato' }], ['E4', 2, { ch: true, art: 'staccato' }], ['C4', 2, { slur: [['stop', 1]], art: 'staccato' }], ['E4', 2, { ch: true, art: 'staccato' }], ['r', 4]]] }]),
    want: { P2: [] }, slurs: 2, changed: false,
  },
  {
    name: 'a grace note before the repeated chord (struck again) → not completed',
    xml: score([{ id: 'P2', name: 'Piano', measures: [[['C4', 2], ['E4', 2, { ch: true, tie: 'start' }], ['B3', 0, { grace: true }], ['C4', 2], ['E4', 2, { ch: true, tie: 'stop' }], ['r', 4]]] }]),
    want: { P2: [['m1', 'E4', 'start'], ['m1', 'E4', 'stop']] }, changed: false,
  },
  {
    name: 'a tie chain the piano doubles: its middle note stop-then-start in both forms',
    xml: score([
      { id: 'P1', name: 'Voice', measures: [sung([['D4', 2], ['G4', 2, { tie: 'start' }], ['G4', 2, { tie: 'both' }], ['G4', 2, { tie: 'stop' }]])] },
      { id: 'P2', name: 'Piano', measures: [[['D4', 2], ['G4', 2], ['G4', 2], ['G4', 2]]] },
    ]),
    want: { P2: [['m1', 'G4', 'start'], ['m1', 'G4', 'start'], ['m1', 'G4', 'stop'], ['m1', 'G4', 'stop']] }, changed: true,
  },
  {
    name: 'a slur from voice 2 (written after <backup>) to voice 1 between identical strikes → ties',
    xml: score([{ id: 'P2', name: 'Piano', measures: [[
      ['r', 3], ['G4', 1], ['G4', 1, { slur: [['stop', 1]] }], ['r', 3], ['back', 8],
      ['r', 3, { v: 2 }], ['B3', 1, { v: 2, slur: [['start', 1]] }], ['B3', 1, { v: 2 }], ['r', 3, { v: 2 }],
    ]] }]),
    want: { P2: [['m1', 'G4', 'start'], ['m1', 'B3', 'start'], ['m1', 'G4', 'stop'], ['m1', 'B3', 'stop']] }, slurs: 0, changed: true,
  },
  {
    name: 'a bar the engine left short (16ths read for a tied eighth chord): slur into the next bar\'s same chord → ties',
    xml: score([{ id: 'P2', name: 'Piano', measures: [
      [['r', 7], ['G4', 0.5, { slur: [['start', 1]] }], ['A4', 0.5, { ch: true, tie: 'start' }], ['back', 7.5], ['D4', 4, { v: 2 }], ['D4', 4, { v: 2 }]],
      [['G4', 1, { slur: [['stop', 1]] }], ['A4', 1, { ch: true, tie: 'stop' }], ['r', 7]],
    ] }]),
    want: { P2: [['m1', 'G4', 'start'], ['m1', 'A4', 'start'], ['m2', 'G4', 'stop'], ['m2', 'A4', 'stop']] }, slurs: 0, changed: true,
  },
  // --- notes paired by staff position (step + octave), not whole strikes by pitch
  {
    name: 'slur from a note into a fuller chord, ending on its continuation in another voice → tie (Songbird bar 37)',
    xml: score([{ id: 'P2', name: 'Piano', measures: [
      [['r', 6], ['G4', 2, { slur: [['start', 1]] }]],
      [['B4', 8], ['back', 8], ['G4', 8, { v: 2, slur: [['stop', 1]] }]],
    ] }]),
    want: { P2: [['m1', 'G4', 'start'], ['m2', 'G4', 'stop']] }, slurs: 0, changed: true,
  },
  {
    name: 'slur from a phantom head a step above the real one into its continuation → the real head tied (Songbird bar 37, left hand)',
    xml: score([{ id: 'P2', name: 'Piano', measures: [
      [['r', 4], ['D4', 4], ['Eb4', 4, { ch: true, slur: [['start', 1]] }]],
      [['D4', 8, { slur: [['stop', 1]] }]],
    ] }]),
    want: { P2: [['m1', 'D4', 'start'], ['m2', 'D4', 'stop']] }, slurs: 0, changed: true,
  },
  {
    name: 'slur linked to the next chord\'s other head, the continuation lost its sharp → tied, sharp carried (Killing bar 68)',
    xml: score([{ id: 'P2', name: 'Piano', measures: [
      [['B4', 3], ['C5', 1], ['B4', 3], ['C5', 1], ['back', 8], ['G#4', 8, { v: 2, slur: [['start', 1]] }]],
      [['B4', 1, { slur: [['stop', 1]] }], ['C5', 1], ['B4', 1], ['C5', 1], ['B4', 4], ['back', 8], ['G4', 8, { v: 2 }]],
    ] }]),
    want: { P2: [['m1', 'G#4', 'start'], ['m2', 'G#4', 'stop']] }, slurs: 0, changed: true,
  },
  {
    name: 'a slur between notes a fourth apart, the continuation in the next chord → a slur, untouched',
    xml: score([{ id: 'P2', name: 'Piano', measures: [
      [['r', 6], ['G4', 2, { slur: [['start', 1]] }]],
      [['C5', 8, { slur: [['stop', 1]] }], ['G4', 8, { ch: true }]],
    ] }]),
    want: { P2: [] }, slurs: 2, changed: false,
  },
  {
    name: 'a sung line\'s slur over the held note to the next one → the tie added, the slur kept (Piano Man bar 161)',
    xml: score([{ id: 'P1', name: 'Voice', measures: [
      [['B4', 8, { lyr: 'da', slur: [['start', 1]] }]],
      [['B4', 2], ['Bb4', 3, { slur: [['stop', 1]] }], ['A4', 1, { lyr: 'la' }], ['r', 2]],
    ] }]),
    want: { P1: [['m1', 'B4', 'start'], ['m2', 'B4', 'stop']] }, slurs: 2, changed: true,
  },
  {
    name: 'the same shape in a piano part (a tie linked to a chord struck twice) → untouched (Yellow Submarine bar 59)',
    xml: score([{ id: 'P2', name: 'Piano', measures: [
      [['r', 2], ['C#4', 1, { slur: [['start', 1]] }], ['C#4', 2], ['C#4', 1, { slur: [['stop', 1]] }], ['r', 2]],
    ] }]),
    want: { P2: [] }, slurs: 2, changed: false,
  },
  {
    name: 'doubling: the piano\'s continuation lost the sharp the voice ties over → tied, sharp carried (Killing bar 24)',
    xml: score([
      { id: 'P1', name: 'Voice', measures: [sung([['r', 6], ['D4', 1], ['D#4', 1, { tie: 'start' }]]), sung([['D#4', 1, { tie: 'stop' }], ['E4', 1], ['r', 6]])] },
      { id: 'P2', name: 'Piano', measures: [[['r', 6], ['D4', 1], ['D#4', 1, { acc: 'sharp' }]], [['D4', 1], ['E4', 1], ['r', 6]]] },
    ]),
    want: { P2: [['m1', 'D#4', 'start'], ['m2', 'D#4', 'stop']] }, changed: true,
  },
  {
    name: 'chord tied on one note, its next strike lost a sharp → all tied, sharp carried (Wichita bar 11)',
    xml: score([{ id: 'P2', name: 'Piano', measures: [
      [['D4', 8, { tie: 'start' }], ['F#4', 8, { ch: true, acc: 'sharp' }], ['A4', 8, { ch: true }]],
      [['D4', 1, { tie: 'stop' }], ['F4', 1, { ch: true }], ['A4', 1, { ch: true }], ['D4', 1], ['F#4', 1, { ch: true, acc: 'sharp' }], ['A4', 1, { ch: true }], ['r', 4]],
    ] }]),
    want: { P2: [['m1', 'D4', 'start'], ['m1', 'F#4', 'start'], ['m1', 'A4', 'start'], ['m2', 'D4', 'stop'], ['m2', 'F#4', 'stop'], ['m2', 'A4', 'stop']] }, changed: true,
  },
  {
    name: 'a printed natural on the next strike is a change → untouched',
    xml: score([{ id: 'P2', name: 'Piano', measures: [
      [['D4', 8, { tie: 'start' }], ['F#4', 8, { ch: true, acc: 'sharp' }]],
      [['D4', 8, { tie: 'stop' }], ['F4', 8, { ch: true, acc: 'natural' }]],
    ] }]),
    want: { P2: [] }, changed: false,
  },
  {
    name: 'a phantom duplicate head in the tied chord → the real heads tied, the phantom left (Piano Man bar 101)',
    xml: score([{ id: 'P3', name: 'Voice', measures: [
      [['E4', 6, { tie: 'start' }], ['G4', 6, { ch: true }], ['C5', 6, { ch: true }], ['C5', 6, { ch: true }], ['E5', 6, { ch: true, tie: 'start' }]],
      [['E4', 6, { tie: 'stop' }], ['G4', 6, { ch: true }], ['C5', 6, { ch: true }], ['E5', 6, { ch: true, tie: 'stop' }]],
    ] }], { time: [3, 4] }),
    want: { P3: [['m1', 'E4', 'start'], ['m1', 'G4', 'start'], ['m1', 'C5', 'start'], ['m1', 'E5', 'start'], ['m2', 'E4', 'stop'], ['m2', 'G4', 'stop'], ['m2', 'C5', 'stop'], ['m2', 'E5', 'stop']] }, changed: true,
  },
  {
    name: 'the tune tied over an inner voice that goes on striking in its own rhythm → the inner voice untouched (Yellow Submarine bar 13)',
    xml: score([{ id: 'P2', name: 'Piano', measures: [
      [['r', 4], ['D5', 4, { tie: 'start' }], ['back', 8], ['r', 4, { v: 2 }], ['F4', 4, { v: 2 }], ['A4', 4, { v: 2, ch: true }]],
      [['D5', 2, { tie: 'stop' }], ['r', 6], ['back', 8], ['F4', 4, { v: 2 }], ['A4', 4, { v: 2, ch: true }], ['r', 4, { v: 2 }]],
    ] }]),
    want: { P2: [] }, changed: false,
  },
  {
    name: 'the tune tied over an inner voice that is held on (an eighth into a half) → the inner voice tied too (Killing bar 62)',
    xml: score([{ id: 'P2', name: 'Piano', measures: [
      [['r', 7], ['D5', 1, { tie: 'start' }], ['back', 8], ['r', 7, { v: 2 }], ['F4', 1, { v: 2 }], ['A4', 1, { v: 2, ch: true }]],
      [['D5', 1, { tie: 'stop' }], ['r', 7], ['back', 8], ['F4', 4, { v: 2 }], ['A4', 4, { v: 2, ch: true }], ['r', 4, { v: 2 }]],
    ] }]),
    want: { P2: [['m1', 'D5', 'start'], ['m1', 'F4', 'start'], ['m1', 'A4', 'start'], ['m2', 'D5', 'stop'], ['m2', 'F4', 'stop'], ['m2', 'A4', 'stop']] }, changed: true,
  },
  {
    name: 'the engine\'s own tie into a continuation that lost its flat (a page turn) → the flat carried along the chain (gybr bars 103–105)',
    xml: score([{ id: 'P2', name: 'Piano', measures: [
      [['Eb3', 8, { tie: 'start', acc: 'flat' }]], [['E3', 8, { tie: 'both' }]], [['E3', 8, { tie: 'stop' }]], [['E3', 8]],
    ] }]),
    want: { P2: [['m1', 'Eb3', 'start'], ['m2', 'Eb3', 'stop'], ['m2', 'Eb3', 'start'], ['m3', 'Eb3', 'stop']] }, changed: false, carried: true,
  },
  // --- the review of the pairing by staff position (F1–F7)
  {
    name: 'F1 a chord tied on its common tone across a key change, the others struck again in the new key → untouched, no accidental carried',
    xml: score([{ id: 'P2', name: 'Piano', measures: [
      [['r', 4], ['D4', 4], ['F#4', 4, { ch: true }], ['A4', 4, { ch: true, tie: 'start' }]],
      [['key', -1], ['D4', 4], ['F4', 4, { ch: true }], ['A4', 4, { ch: true, tie: 'stop' }], ['r', 4]],
    ] }], { key: 2 }),
    want: { P2: [['m1', 'A4', 'start'], ['m2', 'A4', 'stop']] }, changed: false, carried: false,
  },
  {
    name: 'F2 a soprano\'s melisma slur climbing a third, the alto arriving on her note → a slur, untouched (a hymn)',
    xml: score([{ id: 'P1', name: 'Voice', measures: [[
      ['C5', 2, { lyr: 'la' }], ['G4', 2, { lyr: 'ri', slur: [['start', 1, -8]] }], ['B4', 2, { slur: [['stop', 1, 2]] }], ['C5', 2, { lyr: 'la' }], ['back', 8],
      ['E4', 2, { v: 2 }], ['E4', 1, { v: 2 }], ['F4', 1, { v: 2 }], ['G4', 2, { v: 2 }], ['G4', 2, { v: 2 }],
    ]] }], { key: 0 }),
    want: { P1: [] }, slurs: 2, changed: false,
  },
  {
    name: 'F3 a melisma slur over a re-sung repeat in its bar, from the note\'s own head → a slur, untouched',
    xml: score([{ id: 'P1', name: 'Voice', measures: [[
      ['G4', 1, { lyr: 'oh', x: 84, slur: [['start', 1, 4, 10]] }], ['G4', 1, { x: 115 }], ['A4', 2, { x: 148, slur: [['stop', 1, 4, 3]] }], ['B4', 2, { lyr: 'la', x: 210 }], ['r', 2],
    ]] }], { key: 0 }),
    want: { P1: [] }, slurs: 2, changed: false,
  },
  {
    name: 'F3 the same bar, the curve starting past halfway to the repeat (a tie\'s curve linked on) → the tie added (Too Sweet bar 17)',
    xml: score([{ id: 'P1', name: 'Voice', measures: [[
      ['r', 3], ['Bb4', 1, { lyr: 'la', x: 179, slur: [['start', 2, -1, 22]] }], ['Bb4', 1, { x: 212 }], ['D5', 1, { x: 244, slur: [['stop', 2, -1, 5]] }], ['r', 2],
    ]] }], { key: 0 }),
    want: { P1: [['m1', 'Bb4', 'start'], ['m1', 'Bb4', 'stop']] }, slurs: 2, changed: true,
  },
  {
    name: 'F3\'s re-sung bar (the curve from the note\'s own head) inside a longer slur of its voice still open — a tie nests in a slur, a sung line\'s slurs don\'t → the tie added (Too Sweet bar 17)',
    xml: score([{ id: 'P1', name: 'Voice', measures: [[
      ['C5', 1, { lyr: 'ta', x: 40, slur: [['start', 2, 12, 6]] }], ['G4', 1, { lyr: 'oh', x: 84, slur: [['start', 1, 4, 10]] }], ['G4', 1, { x: 115 }],
      ['A4', 2, { x: 148, slur: [['stop', 1, 4, 3]] }], ['B4', 2, { x: 210, slur: [['stop', 2, 10, 4]] }], ['r', 1],
    ]] }], { key: 0 }),
    want: { P1: [['m1', 'G4', 'start'], ['m1', 'G4', 'stop']] }, slurs: 4, changed: true,
  },
  {
    name: 'the same, the longer slur open in another voice → a slur, untouched',
    xml: score([{ id: 'P1', name: 'Voice', measures: [[
      ['C5', 1, { lyr: 'ta', x: 40 }], ['G4', 1, { lyr: 'oh', x: 84, slur: [['start', 1, 4, 10]] }], ['G4', 1, { x: 115 }],
      ['A4', 2, { x: 148, slur: [['stop', 1, 4, 3]] }], ['B4', 2, { x: 210 }], ['r', 1], ['back', 8],
      ['E4', 4, { v: 2, x: 40, slur: [['start', 2, -40, 6]] }], ['F4', 4, { v: 2, x: 148, slur: [['stop', 2, -40, 4]] }],
    ]] }], { key: 0 }),
    want: { P1: [] }, slurs: 4, changed: false,
  },
  {
    name: 'F4 a chord tie completed (its sharp carried) makes the piano double the voice\'s lead note → its tie too, in one pass',
    xml: score([
      { id: 'P1', name: 'Voice', measures: [[['r', 8]], sung([['F#4', 2, { lyr: 'a', acc: 'sharp' }], ['G4', 2, { lyr: 'b', tie: 'start' }], ['G4', 2, { tie: 'stop' }], ['A4', 2, { lyr: 'c' }]])] },
      { id: 'P2', name: 'Piano', measures: [
        [['r', 4], ['D4', 4, { tie: 'start' }], ['F#4', 4, { ch: true, acc: 'sharp' }]],
        [['D4', 2, { tie: 'stop' }], ['F4', 2, { ch: true }], ['G4', 2], ['G4', 2], ['A4', 2]],
      ] },
    ], { key: 0 }),
    want: { P2: [['m1', 'D4', 'start'], ['m1', 'F#4', 'start'], ['m2', 'D4', 'stop'], ['m2', 'F#4', 'stop'], ['m2', 'G4', 'start'], ['m2', 'G4', 'stop']] }, changed: true,
  },
  {
    name: 'F5 a chord tie completed (its sharp carried) turns the next bar\'s slur into a tie → done in one pass',
    xml: score([{ id: 'P2', name: 'Piano', measures: [
      [['F#4', 8, { acc: 'sharp' }], ['A4', 8, { ch: true, tie: 'start' }]],
      [['F4', 8, { slur: [['start', 1]] }], ['A4', 8, { ch: true, tie: 'stop' }]],
      [['F#4', 8, { acc: 'sharp', slur: [['stop', 1]] }], ['A4', 8, { ch: true }]],
    ] }], { key: 0 }),
    want: { P2: [['m1', 'F#4', 'start'], ['m1', 'A4', 'start'], ['m2', 'F#4', 'stop'], ['m2', 'A4', 'stop'], ['m2', 'F#4', 'start'], ['m2', 'A4', 'start'], ['m3', 'F#4', 'stop'], ['m3', 'A4', 'stop']] }, slurs: 0, changed: true,
  },
  {
    name: 'F6 the tune\'s tie read as a slur over an inner voice striking again in its own rhythm → the tune tied, the inner voice untouched (Yellow Submarine bar 13)',
    xml: score([{ id: 'P2', name: 'Piano', measures: [[
      ['G4', 2], ['D#4', 3, { acc: 'sharp', slur: [['start', 1]] }], ['D#4', 3, { slur: [['stop', 1]] }], ['back', 8],
      ['E4', 2, { v: 2 }], ['B3', 3, { v: 2 }], ['B3', 3, { v: 2 }],
    ]] }]),
    want: { P2: [['m1', 'D#4', 'start'], ['m1', 'D#4', 'stop']] }, slurs: 0, changed: true,
  },
  {
    name: 'F7 two voices\' slurs overlapping in time, both numbered 1 (Audiveris numbers them voice by voice), a repeat inside each → untouched',
    xml: score([{ id: 'P2', name: 'Piano', measures: [[
      ['E4', 2, { slur: [['start', 1]] }], ['F4', 2], ['F4', 2, { slur: [['stop', 1]] }], ['G4', 2], ['back', 8],
      ['r', 2, { v: 2 }], ['C4', 2, { v: 2, slur: [['start', 1]] }], ['C4', 2, { v: 2 }], ['D4', 2, { v: 2, slur: [['stop', 1]] }],
    ]] }], { key: 0 }),
    want: { P2: [] }, slurs: 4, changed: false,
  },
  {
    name: 'F7 the same, the lower voice\'s slur from a repeated note, the upper one\'s ending a step from it → untouched',
    xml: score([{ id: 'P2', name: 'Piano', measures: [[
      ['E4', 4, { slur: [['start', 1]] }], ['D4', 2, { slur: [['stop', 1]] }], ['C4', 2], ['back', 8],
      ['r', 2, { v: 2 }], ['B3', 2, { v: 2, slur: [['start', 1]] }], ['B3', 2, { v: 2 }], ['C4', 2, { v: 2, slur: [['stop', 1]] }],
    ]] }], { key: 0 }),
    want: { P2: [] }, slurs: 4, changed: false,
  },
  // Yellow Submarine bars 11, 23, 31, 55 (and 59 over the line break): the right hand doubles the tune's tied
  // dotted half while an inner voice of its staff strikes dotted-quarter chords under it
  {
    name: 'R2 doubling: the tune held over an inner voice striking again → the tune\'s own voice tied, the inner voice untouched (Yellow Submarine bar 23)',
    xml: score([
      { id: 'P1', name: 'Voice', measures: [sung([['E4', 8]]), sung([['G4', 8, { tie: 'start' }]]), sung([['G4', 4, { tie: 'stop' }], ['A4', 4]])] },
      { id: 'P2', name: 'Piano', measures: [
        [['E4', 8], ['back', 8], ['C4', 8, { v: 2 }]],
        [['G4', 8], ['back', 8], ['C4', 4, { v: 2 }], ['C4', 4, { v: 2 }]],
        [['G4', 4], ['A4', 4], ['back', 8], ['C4', 4, { v: 2 }], ['D4', 4, { v: 2 }]],
      ] },
    ], { key: 0 }),
    want: { P2: [['m2', 'G4', 'start'], ['m3', 'G4', 'stop']] }, changed: true,
  },
  {
    name: 'R2 the tune\'s note alone in its strike, another voice coming in with it where the voice\'s tie ends → struck again, untouched (Killing bar 7: F#, then F#/A with the A in another voice)',
    xml: score([
      { id: 'P1', name: 'Voice', measures: [sung([['E4', 8]]), sung([['G4', 8, { tie: 'start' }]]), sung([['G4', 4, { tie: 'stop' }], ['A4', 4]])] },
      { id: 'P2', name: 'Piano', measures: [
        [['E4', 8], ['back', 8], ['C4', 8, { v: 2 }]],
        [['G4', 8]],
        [['G4', 4], ['A4', 4], ['back', 8], ['B4', 4, { v: 2 }], ['D4', 4, { v: 2 }]],
      ] },
    ], { key: 0 }),
    want: { P2: [] }, changed: false,
  },
  {
    name: 'R2 held over an inner voice, its own voice striking a shorter note where the voice\'s tie ends → untouched',
    xml: score([
      { id: 'P1', name: 'Voice', measures: [sung([['E4', 8]]), sung([['G4', 8, { tie: 'start' }]]), sung([['G4', 4, { tie: 'stop' }], ['A4', 4]])] },
      { id: 'P2', name: 'Piano', measures: [
        [['E4', 8], ['back', 8], ['C4', 8, { v: 2 }]],
        [['G4', 8], ['back', 8], ['C4', 4, { v: 2 }], ['C4', 4, { v: 2 }]],
        [['G4', 2], ['A4', 6], ['back', 8], ['C4', 4, { v: 2 }], ['D4', 4, { v: 2 }]],
      ] },
    ], { key: 0 }),
    want: { P2: [] }, changed: false,
  },
  {
    name: 'R2 the same, the tune\'s own voice striking a chord with the tied note where the voice\'s tie ends → struck again, untouched',
    xml: score([
      { id: 'P1', name: 'Voice', measures: [sung([['E4', 8]]), sung([['G4', 8, { tie: 'start' }]]), sung([['G4', 4, { tie: 'stop' }], ['A4', 4]])] },
      { id: 'P2', name: 'Piano', measures: [
        [['E4', 8], ['back', 8], ['C4', 8, { v: 2 }]],
        [['G4', 8], ['back', 8], ['C4', 4, { v: 2 }], ['C4', 4, { v: 2 }]],
        [['G4', 4], ['B4', 4, { ch: true }], ['A4', 4], ['back', 8], ['C4', 4, { v: 2 }], ['D4', 4, { v: 2 }]],
      ] },
    ], { key: 0 }),
    want: { P2: [] }, changed: false,
  },
  // Killing Me Softly bars 37-41: the piano's [G#3 B3] held from bar 37 into the 1st ending (bar 38) and, printed as
  // a tie-in, into the 2nd ending (bar 40), which Audiveris reads as G3; bar 40 is tied on into 41
  {
    name: 'R5 a 2nd ending starting with the notes held into the 1st ending → their accidental carried (Killing Me Softly bar 40)',
    xml: score([
      { id: 'P1', name: 'Voice', measures: [sung([['E4', 8]]), sung([['B3', 8]]), [['ending', '1'], ['r', 8]], [['ending', '2'], ['r', 8]], [['r', 8]]] },
      { id: 'P2', name: 'Piano', measures: [
        [['E4', 8]],
        [['G#3', 8, { tie: 'start', acc: 'sharp' }], ['B3', 8, { ch: true, tie: 'start' }]],
        [['G#3', 8, { tie: 'stop' }], ['B3', 8, { ch: true, tie: 'stop' }]],
        [['G3', 8, { tie: 'start' }], ['B3', 8, { ch: true, tie: 'start' }]],
        [['G3', 8, { tie: 'stop' }], ['B3', 8, { ch: true, tie: 'stop' }]],
      ] },
    ]),
    want: { P2: [['m2', 'G#3', 'start'], ['m2', 'B3', 'start'], ['m3', 'G#3', 'stop'], ['m3', 'B3', 'stop'], ['m4', 'G#3', 'start'], ['m4', 'B3', 'start'], ['m5', 'G#3', 'stop'], ['m5', 'B3', 'stop']] },
    changed: false, carried: true,
  },
  {
    name: 'R5 the same, the chord before the 1st ending not tied into it → the 2nd ending\'s G3 untouched',
    xml: score([
      { id: 'P1', name: 'Voice', measures: [sung([['E4', 8]]), sung([['B3', 8]]), [['ending', '1'], ['r', 8]], [['ending', '2'], ['r', 8]], [['r', 8]]] },
      { id: 'P2', name: 'Piano', measures: [
        [['E4', 8]],
        [['G#3', 8, { acc: 'sharp' }], ['B3', 8, { ch: true }]],
        [['G#3', 8, { acc: 'sharp' }], ['B3', 8, { ch: true }]],
        [['G3', 8, { tie: 'start' }], ['B3', 8, { ch: true, tie: 'start' }]],
        [['G3', 8, { tie: 'stop' }], ['B3', 8, { ch: true, tie: 'stop' }]],
      ] },
    ]),
    want: { P2: [['m4', 'G3', 'start'], ['m4', 'B3', 'start'], ['m5', 'G3', 'stop'], ['m5', 'B3', 'stop']] },
    changed: false, carried: false,
  },
];

// markUnmarkedTuplets (fixOmrScore's own clean-up before restoreTies): bars too long by a run of equal notes
// want: per measure, the time-modification of each note in order ("" = none)
const tuplets = [
  {
    name: 'a note tied in, then an unmarked triplet → 3:2 on the last three, not 4:3 with the held note (Songbird bar 61)',
    xml: score([{ id: 'P1', name: 'Voice', measures: [
      sung([['r', 4], ['Bb4', 2, { tie: 'start' }]]),
      sung([['Bb4', 2, { tie: 'stop' }], ['r', 2], ['Ab4', 2], ['G4', 2]]),
    ] }], { time: [3, 4] }),
    want: { m2: ['', '3:2', '3:2', '3:2'] },
  },
  {
    name: 'an unmarked quadruplet starting with a rest stays 4:3 (Songbird bars 41, 84)',
    xml: score([{ id: 'P1', name: 'Voice', measures: [sung([['r', 2], ['G4', 2], ['G4', 2], ['G4', 2]])] }], { time: [3, 4] }),
    want: { m1: ['4:3', '4:3', '4:3', '4:3'] },
  },
  {
    name: 'a run of exactly three starting on a tied-in note is still the tuplet',
    xml: score([{ id: 'P1', name: 'Voice', measures: [
      sung([['r', 4], ['G4', 2, { tie: 'start' }]]),
      sung([['G4', 2, { tie: 'stop' }], ['A4', 2], ['B4', 2], ['C5', 1], ['r', 1]]),
    ] }], { time: [3, 4] }),
    want: { m2: ['3:2', '3:2', '3:2', '', ''] },
  },
  {
    name: 'F10 a quadruplet tied into the next bar\'s quadruplet → 4:3 in both bars',
    xml: score([{ id: 'P1', name: 'Voice', measures: [
      sung([['C5', 2], ['D5', 2], ['E5', 2], ['F5', 2, { tie: 'start' }]]),
      sung([['F5', 2, { tie: 'stop' }], ['E5', 2], ['D5', 2], ['C5', 2]]),
    ] }], { time: [3, 4] }),
    want: { m1: ['4:3', '4:3', '4:3', '4:3'], m2: ['4:3', '4:3', '4:3', '4:3'] },
  },
];

(async () => {
  const b = await chromium.launch(); const page = await b.newPage();
  await page.goto(BASE + 'tools.html');
  let fails = 0;
  for (const c of cases) {
    if (c.skip) continue;
    const r = await page.evaluate(async ({ xml, fix }) => {
      const { fixOmrScore } = await import(fix);
      const once = fixOmrScore(xml), twice = fixOmrScore(once.xml);
      const doc = new DOMParser().parseFromString(once.xml, 'application/xml');
      const ties = {}, forms = [];
      let slurs = 0;
      for (const p of doc.querySelectorAll('part')) {
        const id = p.getAttribute('id'); ties[id] = [];
        [...p.querySelectorAll(':scope > measure')].forEach((m) => {
          let k = -1;
          for (const n of m.querySelectorAll(':scope > note')) {
            if (!n.querySelector(':scope > chord')) k++;
            if (n.querySelector('rest')) continue;
            const pitch = n.querySelector('step').textContent + (n.querySelector('alter') ? (n.querySelector('alter').textContent === '1' ? '#' : 'b') : '') + n.querySelector('octave').textContent;
            const tie = [...n.querySelectorAll(':scope > tie')].map((t) => t.getAttribute('type'));
            const tied = [...n.querySelectorAll(':scope > notations > tied')].map((t) => t.getAttribute('type'));
            for (const t of new Set([...tie, ...tied])) ties[id].push([`m${m.getAttribute('number')}`, pitch, t]);
            if (tie.join() !== tied.join()) forms.push(`${pitch} tie[${tie}] tied[${tied}]`);
            slurs += n.querySelectorAll(':scope > notations > slur').length;
          }
        });
      }
      const order = [];
      for (const n of doc.querySelectorAll('note')) {
        const tie = [...n.querySelectorAll(':scope > tie')].map((t) => t.getAttribute('type')).join();
        const tied = [...n.querySelectorAll(':scope > notations > tied')].map((t) => t.getAttribute('type')).join();
        if (tie.includes(',') || tied.includes(',')) order.push(`${tie}|${tied}`);
      }
      return { ties, forms, slurs, order, changes: once.changes, again: twice.changes.filter((c) => /ties/.test(c)), same: twice.xml === once.xml };
    }, [c.xml, FIX].reduce((x, y) => ({ xml: x, fix: y })));
    const errs = [];
    // (a tie the input already had counts; compare the full list of ties on the parts named)
    const input = await page.evaluate((xml) => {
      const doc = new DOMParser().parseFromString(xml, 'application/xml'); const out = {};
      for (const p of doc.querySelectorAll('part')) out[p.getAttribute('id')] = new Set([...p.querySelectorAll('tie, tied')].map((t) => t.closest('note')).map((n, i) => i)).size && [...p.querySelectorAll('note')].reduce((a, n) => a + new Set([...n.querySelectorAll(':scope > tie, :scope > notations > tied')].map((t) => t.getAttribute('type'))).size, 0);
      return out;
    }, c.xml);
    for (const [pid, want] of Object.entries(c.want)) {
      const got = r.ties[pid].map((t) => t.join(' ')).sort();
      const exp = want.length ? want.map((t) => t.join(' ')).sort() : null;
      if (exp && got.join('|') !== exp.join('|')) errs.push(`${pid} ties ${JSON.stringify(got)} ≠ ${JSON.stringify(exp)}`);
      if (!exp && got.length !== input[pid]) errs.push(`${pid} ties changed: ${JSON.stringify(got)} (input had ${input[pid]} tie/tied elements)`);
    }
    const restored = r.changes.some((x) => /ties restored/.test(x));
    if (restored !== c.changed) errs.push(`changes ${JSON.stringify(r.changes)}`);
    if (c.slurs != null && r.slurs !== c.slurs) errs.push(`slurs ${r.slurs} ≠ ${c.slurs}`);
    if (c.forms && r.forms.length) errs.push(`<tie>/<tied> differ: ${r.forms}`);
    if (r.again.length || !r.same) errs.push(`not idempotent: ${JSON.stringify(r.again)}`);
    if (r.order.some((o) => o !== 'stop,start|stop,start')) errs.push(`a note tied both ways isn't stop-then-start: ${r.order}`);
    if (c.carried != null && r.changes.some((x) => /accidentals carried/.test(x)) !== c.carried) errs.push(`accidentals carried: ${JSON.stringify(r.changes)}`);
    console.log(`${errs.length ? 'FAIL' : 'ok  '} ${c.name}${errs.length ? '\n     ' + errs.join('\n     ') : ''}`);
    fails += errs.length ? 1 : 0;
  }
  for (const c of tuplets) {
    const r = await page.evaluate(async ({ xml, fix }) => {
      const { fixOmrScore } = await import(fix);
      const once = fixOmrScore(xml), twice = fixOmrScore(once.xml);
      const doc = new DOMParser().parseFromString(once.xml, 'application/xml');
      const out = {};
      for (const m of doc.querySelectorAll('part > measure')) {
        out['m' + m.getAttribute('number')] = [...m.querySelectorAll(':scope > note')].map((n) => {
          const tm = n.querySelector(':scope > time-modification');
          return tm ? `${tm.querySelector('actual-notes').textContent}:${tm.querySelector('normal-notes').textContent}` : '';
        });
      }
      return { out, same: twice.xml === once.xml };
    }, { xml: c.xml, fix: FIX });
    const errs = [];
    for (const [m, want] of Object.entries(c.want)) if ((r.out[m] || []).join() !== want.join()) errs.push(`${m} ${JSON.stringify(r.out[m])} ≠ ${JSON.stringify(want)}`);
    if (!r.same) errs.push('not idempotent');
    console.log(`${errs.length ? 'FAIL' : 'ok  '} ${c.name}${errs.length ? '\n     ' + errs.join('\n     ') : ''}`);
    fails += errs.length ? 1 : 0;
  }
  console.log(fails ? `${fails} failed` : 'all passed');
  await b.close();
  process.exit(fails ? 1 : 0);
})();
