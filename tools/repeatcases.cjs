const { chromium } = require('playwright');
// measures: [{ fwd, bwd, times, end: [nums,'start'|'stop'|'startstop'|'discontinue'...], words, segno, coda, verses: n }]
function score(ms) {
  const body = ms.map((m, i) => {
    let x = `<measure number="${i + 1}">`;
    if (i === 0) x += `<attributes><divisions>1</divisions><time><beats>${ms.beats || 1}</beats><beat-type>4</beat-type></time></attributes>`;
    const left = [], right = [];
    if (m.fwd) left.push('<repeat direction="forward"/>');
    for (const e of m.ends || []) {
      if (e[1] === 'start' || e[1] === 'startstop' || e[1] === 'startdisc') left.push(`<ending number="${e[0]}" type="start"/>`);
      if (e[1] === 'stop' || e[1] === 'startstop') right.push(`<ending number="${e[0]}" type="stop"/>`);
      if (e[1] === 'discontinue' || e[1] === 'startdisc') right.push(`<ending number="${e[0]}" type="discontinue"/>`);
    }
    if (m.bwd) right.push(`<repeat direction="backward"${m.times ? ` times="${m.times}"` : ''}/>`);
    if (left.length) x += `<barline location="left">${left.join('')}</barline>`;
    if (m.segno) x += '<direction><direction-type><segno/></direction-type></direction>';
    if (m.coda) x += '<direction><direction-type><coda/></direction-type></direction>';
    if (m.words) x += `<direction><direction-type><words>${m.words}</words></direction-type></direction>`;
    const noteList = m.notes || [{ lyr: Array.from({ length: m.verses || 1 }, (_, v) => [v + 1, `${i + 1}${'abcdefg'[v]}`]) }];
    for (const nt of noteList) {
      if (nt.rest) { x += `<note><rest/><duration>${nt.dur || 1}</duration><voice>1</voice></note>`; continue; }
      const lyr = (nt.lyr || []).map(([v, t]) => `<lyric number="${v}"><syllabic>single</syllabic><text>${t}</text></lyric>`).join('');
      x += `<note><pitch><step>${nt.step || 'C'}</step><octave>4</octave></pitch><duration>${nt.dur || 1}</duration>${nt.tie ? `<tie type="${nt.tie}"/>` : ''}<voice>1</voice>${lyr}</note>`;
    }
    if (right.length) x += `<barline location="right">${right.join('')}</barline>`;
    return x + '</measure>';
  }).join('');
  return `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>V</part-name></score-part></part-list><part id="P1">${body}</part></score-partwise>`;
}
const cases = {
  'simple repeat 2-4 → 1 2 3 4 2 3 4 5': [{}, { fwd: 1 }, {}, { bwd: 1 }, {}],
  'repeat, no start sign → 1 2 3 1 2 3 4': [{}, {}, { bwd: 1 }, {}],
  '1st/2nd endings → 1 2 3 1 2 4 5': [{ fwd: 1 }, {}, { ends: [['1', 'startstop']], bwd: 1 }, { ends: [['2', 'startdisc']] }, {}],
  'Wichita: 1st ending read on m3 only, repeat at m4 → 1 2 3 4 1 2 5': [{ fwd: 1 }, {}, { ends: [['1', 'startdisc']] }, { bwd: 1 }, {}],
  'times=3 → 1 2 1 2 1 2 3': [{ fwd: 1 }, { bwd: 1, times: 3 }, {}],
  '"1, 2, 3" ending + 4th → 1 2 3 1 2 3 1 2 3 1 2 4': [{ fwd: 1 }, {}, { ends: [['1, 2, 3', 'startstop']], bwd: 1 }, { ends: [['4', 'startdisc']] }],
  '3 verses, plain repeat → 3 passes with verses a b c': [{ fwd: 1, verses: 3 }, { bwd: 1, verses: 3 }, {}],
  'D.S. al Coda → 1 2 3 4 5 2 3 6 7': [{}, { segno: 1 }, { words: 'To Coda', coda: 1 }, {}, { words: 'D.S. al Coda' }, { coda: 1 }, {}],
  'D.C. al Fine → 1 2 3 4 1 2': [{}, { words: 'Fine' }, {}, { words: 'D.C. al Fine' }],
  'D.S. without a segno found → as written 1 2 3': [{}, { words: 'D.S. al Coda' }, {}],
  'repeat then D.S. (repeats not retaken) → 1 2 1 2 3 1 2 3?': [{ segno: 1, fwd: 1 }, { bwd: 1 }, { words: 'D.S.' }],
  'intro vamp :||: verse(2) [1. :|| [2. → 1a 2a 1a 2a 3a 4a 3b 5 6': [{ fwd: 1 }, { bwd: 1 }, { fwd: 1, verses: 2 }, { ends: [['1', 'startstop']], bwd: 1, verses: 2 }, { ends: [['2', 'startdisc']] }, {}],
  'A :|| B [1. C :|| [2. D (no 2nd forward) → 1 2 1 2 3 4 3 5': [{}, { bwd: 1 }, {}, { ends: [['1', 'startstop']], bwd: 1 }, { ends: [['2', 'startdisc']] }],
  'AABB, 2 verses each → 1a 2a 1b 2b 3a 4a 3b 4b': [{ fwd: 1, verses: 2 }, { bwd: 1, verses: 2 }, { fwd: 1, verses: 2 }, { bwd: 1, verses: 2 }],
  'ending "1,,3" (Audiveris for 1.-3.) + 4 → 4 passes': [{ fwd: 1 }, { ends: [['1,,3', 'startstop']], bwd: 1 }, { ends: [['4', 'startdisc']] }],
  'hymn: 4 stacked verses, refrain repeat → written order kept (verse menu)': [{ verses: 4 }, { verses: 4 }, { fwd: 1 }, { bwd: 1 }],
  'verse lines 1/2/3 with D.S. → repeat twice, verse 3 on the D.S. pass': [{ segno: 1, fwd: 1, verses: 3 }, { bwd: 1, verses: 3 }, { words: 'D.S.' }],
  'refrain pickup mid-measure on pass 2 → "x2" then refrain words': Object.assign([{ fwd: 1, notes: [{ lyr: [[1, 'v1'], [2, 'v2']] }, { lyr: [[1, 'And']] }] }, { bwd: 1, notes: [{ lyr: [[1, 'REF']] }, { lyr: [[1, 'RAIN']] }] }, {}], { beats: 2 }),
  'pickup into verse 2 on line 2 in the 1st ending → "And then" sung on pass 1': Object.assign([{ fwd: 1, notes: [{ lyr: [[1, 'one'], [2, 'two']] }, { lyr: [[1, 'more'], [2, 'times']] }] }, { ends: [['1', 'startstop']], bwd: 1, notes: [{ lyr: [[1, 'road.']] }, { lyr: [[2, 'And']] }] }, { ends: [['2', 'startdisc']], notes: [{ lyr: [[1, 'end']] }, { rest: 1 }] }], { beats: 2 }),
  'tie into the 1st ending: cut at the jump (onsets/durs)': Object.assign([{ fwd: 1, notes: [{ lyr: [[1, 'song']], dur: 2, tie: 'start' }] }, { ends: [['1', 'startstop']], bwd: 1, notes: [{ dur: 2, tie: 'stop' }] }, { ends: [['2', 'startdisc']], notes: [{ lyr: [[1, 'go']], dur: 2 }] }], { beats: 2 }),
};
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('pageerror', (e) => console.log('ERR', e.message));
  await p.goto('http://localhost:8097/resonate/tools.html'); await p.waitForTimeout(300);
  for (const [name, ms] of Object.entries(cases)) {
    const r = await p.evaluate(async (xml) => {
      const { parseMusicXml } = await import('/resonate/musicxml.js?' + Math.random());
      const sc = parseMusicXml(xml);
      return sc.notes.map((n) => n.verses['1']?.text ?? (sc.verses.length > 1 ? '[' + Object.values(n.verses).map((x) => x.text).join('/') + ']' : '·')).join(' ') + `   (onsets ${sc.notes.map((n) => n.onset).join(',')}; durs ${sc.notes.map((n) => n.dur).join(',')}; verses ${sc.verses.join(',')}${sc.notes.some((n) => n.restBefore) ? '; breaks at ' + sc.notes.map((n, i) => (n.restBefore ? i : -1)).filter((i) => i >= 0).join(',') : ''})`;
    }, score(ms));
    console.log(`${name}\n    ${r}`);
  }
  await b.close();
})();
