// Synthetic piano/vocal MusicXML for the fingering suites (E7: playfinger.cjs, playfingerwk.mjs) — made
// here, never the owner's songs.
//   const FX = require('./fingerfixture.cjs');
//   FX.r6({ bpm })     Voice (words) over a two-staff Piano, 6 bars of 4/4, C3–G5 (the keyboard C3–B5):
//                      bar 1 the owner's case — E4, then G3 + B4 on the treble staff over the left hand's
//                      held C3 (ids nE4, nG3, nB4, nC3) — then five-finger runs in two positions, a jump
//                      to C5, back to C4: the right hand changes position a few times, the left little
//   FX.wide()          two bars spanning C1–C7 (a phone's keyboard: ~6 px a white key)
//   FX.big(bars)       a long two-staff piano (eighth-note runs over left-hand chords): `bars` × 16 notes
const STEP = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'];
const ALT = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
const TYPES = { 0.5: 'eighth', 1: 'quarter', 2: 'half', 4: 'whole' };
const M = (name) => { const m = /^([A-G])(#?)(-?\d)$/.exec(name); return 12 * (Number(m[3]) + 1) + [0, 2, 4, 5, 7, 9, 11]['CDEFGAB'.indexOf(m[1])] + (m[2] ? 1 : 0); };

// A note (dur in quarters; divisions 2), chord: a <chord/> member; id: its MusicXML id.
function note({ midi, dur, staff = 1, voice = 1, chord = false, id = null, lyric = null, rest = false }) {
  const d = Math.round(dur * 2);
  const pitch = rest ? '<rest/>' : `<pitch><step>${STEP[midi % 12]}</step>${ALT[midi % 12] ? '<alter>1</alter>' : ''}<octave>${Math.floor(midi / 12) - 1}</octave></pitch>`;
  return `<note${id ? ` id="${id}"` : ''}>${chord ? '<chord/>' : ''}${pitch}<duration>${d}</duration><voice>${voice}</voice><type>${TYPES[dur] || 'quarter'}</type>${staff ? `<staff>${staff}</staff>` : ''}${lyric ? `<lyric number="1"><syllabic>single</syllabic><text>${lyric}</text></lyric>` : ''}</note>`;
}
// One staff's bar from [[names | name | null (rest), quarters, ids?]] events.
function events(list, staff, voice, ids = {}) {
  let out = '';
  for (const [n, dur] of list) {
    if (n == null) { out += note({ dur, staff, voice, rest: true }); continue; }
    [].concat(n).forEach((name, i) => { out += note({ midi: M(name), dur, staff, voice, chord: i > 0, id: ids[name] || null }); });
  }
  return out;
}
function score({ title, bpm, voice = null, rh, lh }) {
  const bars = rh.length;
  const attrs = (staves) => `<attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>${staves === 2 ? '<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>' : '<clef><sign>G</sign><line>2</line></clef>'}</attributes>`;
  const tempo = `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type><sound tempo="${bpm}"/></direction>`;
  let p1 = '', p2 = '';
  for (let b = 0; b < bars; b++) {
    if (voice) p1 += `<measure number="${b + 1}">${b === 0 ? attrs(1) + tempo : ''}${voice[b]}</measure>`;
    p2 += `<measure number="${b + 1}">${b === 0 ? attrs(2) + (voice ? '' : tempo) : ''}${rh[b]}<backup><duration>8</duration></backup>${lh[b]}</measure>`;
  }
  const list = (voice ? '<score-part id="P1"><part-name>Voice</part-name></score-part>' : '') +
    '<score-part id="P2"><part-name>Piano</part-name><score-instrument id="P2-I1"><instrument-name>Piano</instrument-name></score-instrument><midi-instrument id="P2-I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument></score-part>';
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><work><work-title>${title}</work-title></work><movement-title>${title}</movement-title><part-list>${list}</part-list>${voice ? `<part id="P1">${p1}</part>` : ''}<part id="P2">${p2}</part></score-partwise>
`;
}

function r6({ bpm = 160, title = 'Fingering R6' } = {}) {
  const la = (names) => names.map((n) => note({ midi: M(n), dur: 1, staff: 0, lyric: 'la' })).join('');
  const voice = [la(['E4', 'B4', 'C5', 'B4']), la(['C5', 'D5', 'E5', 'F5']), la(['G5', 'F5', 'E5', 'D5']), la(['C5', 'D5', 'E5', 'F5']), la(['G5', 'F5', 'E5', 'D5']), la(['C5', 'C5', 'C5', 'C5'])];
  const ids = { E4: 'nE4', G3: 'nG3', B4: 'nB4' };
  const rh = [
    events([['E4', 1], [['G3', 'B4'], 1], [null, 2]], 1, 1, ids),
    events([['C4', 1], ['D4', 1], ['E4', 1], ['F4', 1]], 1, 1),
    events([['G4', 1], ['F4', 1], ['E4', 1], ['D4', 1]], 1, 1),
    events([['C5', 1], ['D5', 1], ['E5', 1], ['F5', 1]], 1, 1),
    events([['G5', 1], ['F5', 1], ['E5', 1], ['D5', 1]], 1, 1),
    events([['C4', 4]], 1, 1),
  ];
  const lh = [
    events([['C3', 2], [null, 2]], 2, 5, { C3: 'nC3' }),
    events([['C3', 4]], 2, 5), events([['G3', 4]], 2, 5), events([['F3', 4]], 2, 5), events([['C3', 4]], 2, 5), events([['C3', 4]], 2, 5),
  ];
  return score({ title, bpm, voice, rh, lh });
}
function wide({ title = 'Fingering Wide' } = {}) {
  const rh = [events([[['C6', 'E6', 'G6'], 2], [['C7'], 2]], 1, 1), events([[['C5', 'E5', 'G5'], 4]], 1, 1)];
  const lh = [events([[['C1', 'G1'], 2], [['C2'], 2]], 2, 5), events([[['C3', 'G3'], 4]], 2, 5)];
  return score({ title, bpm: 120, rh, lh });
}
function big(bars = 150, { title = 'Fingering Long' } = {}) {
  const run = [['C4', 'D4', 'E4', 'F4', 'G4', 'F4', 'E4', 'D4'], ['E4', 'F4', 'G4', 'A4', 'B4', 'A4', 'G4', 'F4'], ['G4', 'A4', 'B4', 'C5', 'D5', 'C5', 'B4', 'A4'], ['C5', 'B4', 'A4', 'G4', 'F4', 'E4', 'D4', 'C4']];
  const chords = [['C3', 'E3', 'G3'], ['F2', 'A2', 'C3'], ['G2', 'B2', 'D3'], ['C3', 'G3']];
  const rh = [], lh = [];
  for (let b = 0; b < bars; b++) {
    rh.push(events(run[b % 4].map((n) => [n, 0.5]), 1, 1));
    lh.push(events([[chords[b % 4], 1], [chords[(b + 1) % 4], 1], [chords[b % 4], 1], [chords[(b + 2) % 4], 1]], 2, 5));
  }
  return score({ title, bpm: 120, rh, lh });
}
module.exports = { r6, wide, big, M };
