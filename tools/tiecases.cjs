// restoreTies (omr/fixscore.js, through fixOmrScore) on hand-built scores shaped like Audiveris
// output: ties the engine missed, wrote half, or read as slurs — and the look-alikes left alone.
// usage: node tiecases.cjs   (BASE defaults to the sitetest server: http://localhost:8097/resonate/)
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8097/resonate/';
const FIX = process.env.FIX || './omr/fixscore.js'; // (a scratch copy to try a change: FIX=/tmp/ties/fixscore.js)

// A part: { id, staves, measures: [[note...]] }; a note: [pitch "F#4" | "r", dur (eighths), opts]
// opts: { v voice, st staff, ch chord, tie 'start'|'stop'|'both', tied (only <tied>), slur [type, number], lyr text, back eighths,
//   grace (a grace note before the next), art (an articulation) } — durations in eighths (½ = a 16th; divisions 4)
function score(parts, { time = [4, 4] } = {}) {
  const pl = parts.map((p) => `<score-part id="${p.id}"><part-name>${p.name || p.id}</part-name></score-part>`).join('');
  const body = parts.map((p) => `<part id="${p.id}">` + p.measures.map((m, i) => {
    let x = `<measure number="${i + 1}">`;
    if (i === 0) x += `<attributes><divisions>4</divisions><key><fifths>1</fifths></key><time><beats>${time[0]}</beats><beat-type>${time[1]}</beat-type></time>${(p.staves || 1) > 1 ? `<staves>${p.staves}</staves>` : ''}<clef><sign>G</sign><line>2</line></clef></attributes>`;
    for (const [pitch, dur, o = {}] of m) {
      if (pitch === 'back') { x += `<backup><duration>${dur * 2}</duration></backup>`; continue; }
      let n = '<note>' + (o.grace ? '<grace/>' : '') + (o.ch ? '<chord/>' : '');
      if (pitch === 'r') n += '<rest/>';
      else {
        const [, step, acc, oct] = /^([A-G])([#b]?)(\d)$/.exec(pitch);
        n += `<pitch><step>${step}</step>${acc ? `<alter>${acc === '#' ? 1 : -1}</alter>` : ''}<octave>${oct}</octave></pitch>`;
      }
      if (!o.grace) n += `<duration>${dur * 2}</duration>`;
      const ts = o.tie === 'both' ? ['stop', 'start'] : o.tie ? [o.tie] : [];
      if (!o.tied) for (const t of ts) n += `<tie type="${t}"/>`;
      n += `<voice>${o.v || 1}</voice><type>eighth</type><staff>${o.st || 1}</staff>`;
      const no = ts.map((t) => `<tied type="${t}"/>`).join('') + (o.slur ? o.slur.map(([t, k]) => `<slur type="${t}" number="${k}"/>`).join('') : '') + (o.art ? `<articulations><${o.art}/></articulations>` : '');
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
    console.log(`${errs.length ? 'FAIL' : 'ok  '} ${c.name}${errs.length ? '\n     ' + errs.join('\n     ') : ''}`);
    fails += errs.length ? 1 : 0;
  }
  console.log(fails ? `${fails} failed` : 'all passed');
  await b.close();
  process.exit(fails ? 1 : 0);
})();
