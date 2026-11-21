// The OMR clean-ups that had no test (public/omr/fixscore.js, docs/CLEANUP.md 1.8), one synthetic score
// each, through fixOmrScore as the import and the song loader call it: the change is made, it is the only
// change, and a second run changes nothing.
//   dropInserts         a boxed fill at a page's foot (no melody, the time restated, narrow) is dropped, its
//                       clef carried to the next measure
//   the stray-8va revert  a treble 8va clef among plain ones (a coda sign read as the 8): its notes go down
//   unifyOctaveClefs    an 8vb bass clef found on some systems spreads to the plain ones
//   foldSparseVerses    a lyric line read low (verse 2, a few syllables) folds into verse 1
//   restoreTempo        a tempo only in the engine's log line; one only in the PDF's text (𝅗𝅥. = 58 → ♩ = 174)
//   markTupletGroups    a triplet with <time-modification> and no <tuplet> marks gets its start / stop
// (unifyKeySignatures: keycases.cjs; restoreTies and markUnmarkedTuplets: tiecases.cjs.)
//   node fixcases.cjs        (BASE=http://localhost:8097/resonate/)
const { chromium } = require('playwright');
const { ok, done, fail } = require('./lib/check.cjs');
const { BASE } = require('./lib/paths.cjs');

// --- a small MusicXML writer ------------------------------------------------------------------------------
const STEP = 'CDEFGAB';
// n('G4', dur, { type, lyric: [[n, text]], tm: [3, 2], dot, rest, staff, voice })
const n = (p, dur, o = {}) => {
  const pitch = o.rest || !p ? '<rest/>' : `<pitch><step>${p[0]}</step><octave>${p.slice(1)}</octave></pitch>`;
  const lyr = (o.lyric || []).map(([k, t]) => `<lyric number="${k}"><syllabic>single</syllabic><text>${t}</text></lyric>`).join('');
  return `<note>${pitch}<duration>${dur}</duration><voice>${o.voice || 1}</voice>${o.type ? `<type>${o.type}</type>` : ''}${o.dot ? '<dot/>' : ''}` +
    `${o.tm ? `<time-modification><actual-notes>${o.tm[0]}</actual-notes><normal-notes>${o.tm[1]}</normal-notes></time-modification>` : ''}${lyr}</note>`;
};
const clef = (sign, line, oct = 0) => `<clef><sign>${sign}</sign><line>${line}</line>${oct ? `<clef-octave-change>${oct}</clef-octave-change>` : ''}</clef>`;
const attrs = (inner) => `<attributes>${inner}</attributes>`;
const head = (div, beats, type, clefs) => attrs(`<divisions>${div}</divisions><key><fifths>0</fifths></key><time><beats>${beats}</beats><beat-type>${type}</beat-type></time>${clefs}`);
const SYS = '<print new-system="yes"/>';
// measure(number, body, { width, system })
const m = (num, body, o = {}) => `<measure number="${num}"${o.width ? ` width="${o.width}"` : ''}>${o.system ? SYS : ''}${body}</measure>`;
const score = (parts) => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1"><identification><encoding><software>Audiveris 5.6</software></encoding></identification>
<part-list>${parts.map((p) => `<score-part id="${p.id}"><part-name>${p.name}</part-name></score-part>`).join('')}</part-list>
${parts.map((p) => `<part id="${p.id}">${p.measures.join('')}</part>`).join('\n')}
</score-partwise>`;
const sung = (k) => [[1, `la${k}`]];

// --- the cases ----------------------------------------------------------------------------------------------
// Each: the score, the engine's log and the PDF's tempo, the change's words, and facts read from the result
// in the page (a function of the parsed document) checked against what the clean-up must do.
const cases = [];

// dropInserts: voice + piano; systems m1–2, m3–4, the box (m5: narrow, 4/4 restated, the voice silent and
// without width — its clef the piano's next system's), then m6–7 where the piano has no clef of its own.
{
  const v = (k, sys) => m(k, (k === 1 ? head(2, 4, 4, clef('G', 2)) : '') + n('C5', 8, { type: 'whole', lyric: sung(k) }), { width: 400, system: sys });
  const pno = (k, sys) => m(k, (k === 1 ? head(2, 4, 4, clef('F', 4)) : '') + n('C3', 8, { type: 'whole' }), { width: 400, system: sys });
  cases.push({
    name: 'dropInserts: a boxed fill at the foot of a page',
    xml: score([
      { id: 'P1', name: 'Voice', measures: [v(1, false), v(2), v(3, true), v(4), m(5, n(null, 8, { rest: true }), { system: true }), v(6, true), v(7)] },
      { id: 'P2', name: 'Piano', measures: [pno(1, false), pno(2), pno(3, true), pno(4), m(5, attrs(`<time><beats>4</beats><beat-type>4</beat-type></time>${clef('G', 2)}`) + n('E4', 2, { type: 'quarter' }) + n('G4', 2, { type: 'quarter' }) + n('C5', 4, { type: 'half' }), { width: 300, system: true }), pno(6, true), pno(7)] },
    ]),
    words: /inserted boxes .*dropped: m5 \(1 measures\)/,
    facts: (doc) => ({
      numbers: [...doc.querySelectorAll('part')].map((p) => [...p.querySelectorAll(':scope > measure')].map((x) => x.getAttribute('number')).join(',')),
      clef6: (() => { const c = doc.querySelector('part#P2 > measure[number="6"] > attributes > clef'); return c ? c.querySelector('sign').textContent + c.querySelector('line').textContent : null; })(),
    }),
    expect: (f) => [
      [f.numbers.every((x) => x === '1,2,3,4,6,7'), `the box's measure gone from both parts (${f.numbers.join(' | ')})`],
      [f.clef6 === 'G2', `the clef written only in the box carried to the next measure (${f.clef6})`],
    ],
  });
}

// The stray 8va: a voice in treble clef, read 8va on one system of four (a coda sign above the clef).
{
  const sys = (k, c) => m(k, (k === 1 ? head(2, 4, 4, c) : attrs(c)) + n('E5', 4, { type: 'half', lyric: sung(k) }) + n('G5', 4, { type: 'half', lyric: sung(k + 10) }), { system: k > 1 });
  cases.push({
    name: 'stray 8va: a coda sign read as the 8',
    xml: score([{ id: 'P1', name: 'Voice', measures: [sys(1, clef('G', 2)), sys(2, clef('G', 2)), sys(3, clef('G', 2, 1)), sys(4, clef('G', 2))] }]),
    words: /P1: 1 G2 8va clef \(m3\) among plain ones: 2 notes moved down an octave/,
    facts: (doc) => [...doc.querySelectorAll('measure')].map((x) => ({ oct: x.querySelector('clef clef-octave-change')?.textContent ?? '0', notes: [...x.querySelectorAll('note pitch')].map((p) => p.textContent).join(' ') })),
    expect: (f) => [
      [f[2].oct === '0' && f[2].notes === 'E4 G4', `m3: the 8 gone, its notes down an octave (${JSON.stringify(f[2])})`],
      [[0, 1, 3].every((i) => f[i].notes === 'E5 G5' && f[i].oct === '0'), 'the plain systems untouched'],
    ],
  });
}

// unifyOctaveClefs: a low voice in bass clef 8vb, the 8 found on two systems of four.
{
  const sys = (k, c) => m(k, (k === 1 ? head(2, 4, 4, c) : attrs(c)) + n('C4', 4, { type: 'half', lyric: sung(k) }) + n('G3', 4, { type: 'half', lyric: sung(k + 10) }), { system: k > 1 });
  cases.push({
    name: 'unifyOctaveClefs: an 8vb clef found on some systems',
    xml: score([{ id: 'P1', name: 'Hades', measures: [sys(1, clef('F', 4, -1)), sys(2, clef('F', 4)), sys(3, clef('F', 4, -1)), sys(4, clef('F', 4))] }]),
    words: /P1: 2 F4 clefs without the 8 \(2 have it\): 4 notes moved down an octave/,
    facts: (doc) => [...doc.querySelectorAll('measure')].map((x) => ({ oct: x.querySelector('clef clef-octave-change')?.textContent ?? '0', notes: [...x.querySelectorAll('note pitch')].map((p) => p.textContent).join(' ') })),
    expect: (f) => [
      [f.every((x) => x.oct === '-1'), `every bass clef 8vb (${f.map((x) => x.oct).join(',')})`],
      [f[1].notes === 'C3 G2' && f[3].notes === 'C3 G2', `the plain systems' notes down an octave (${f[1].notes} / ${f[3].notes})`],
      [f[0].notes === 'C4 G3' && f[2].notes === 'C4 G3', 'the systems that had the 8 untouched'],
    ],
  });
}

// foldSparseVerses: 20 syllables of verse 1; a lyric line read a bit low came out as verse 2 on two notes —
// one with no verse-1 syllable (moved into verse 1), one under a verse-1 syllable (dropped).
{
  const notes = [];
  for (let k = 0; k < 20; k++) notes.push(n('A4', 2, { type: 'quarter', lyric: k === 7 ? [[1, 'gen'], [2, 'tly']] : [[1, `w${k}`]] }));
  notes.splice(12, 0, n('B4', 2, { type: 'quarter', lyric: [[2, 'See']] }));
  notes.push(n('A4', 2, { type: 'quarter' }), n('A4', 2, { type: 'quarter' }), n('A4', 2, { type: 'quarter' })); // (whole bars)
  const bars = [];
  for (let i = 0; i < notes.length; i += 4) bars.push(m(i / 4 + 1, (i ? '' : head(2, 4, 4, clef('G', 2))) + notes.slice(i, i + 4).join(''), { system: i > 0 && i % 8 === 0 }));
  cases.push({
    name: 'foldSparseVerses: a lyric line read low',
    xml: score([{ id: 'P1', name: 'Voice', measures: bars }]),
    words: /lyric lines 2 \(2 syllables\): 1 moved into verse 1, 1 dropped/,
    facts: (doc) => ({
      v2: doc.querySelectorAll('lyric[number="2"]').length,
      see: [...doc.querySelectorAll('note')].find((x) => x.querySelector('pitch step')?.textContent === 'B')?.querySelector('lyric')?.getAttribute('number'),
      gen: [...doc.querySelectorAll('lyric')].filter((l) => /gen|tly/.test(l.textContent)).map((l) => l.querySelector('text').textContent).join(','),
    }),
    expect: (f) => [
      [f.v2 === 0, `no verse 2 left (${f.v2})`],
      [f.see === '1', `the syllable with no verse-1 one moved into verse 1 (${f.see})`],
      [f.gen === 'gen', `the one under a verse-1 syllable dropped (${f.gen})`],
    ],
  });
}

// restoreTempo: no tempo in the score; the engine's log line for a mark whose note symbol OCR missed.
{
  const bars = [m(1, head(2, 4, 4, clef('G', 2)) + n('G4', 8, { type: 'whole', lyric: sung(1) })), m(2, n('C5', 8, { type: 'whole', lyric: sung(2) }))];
  const facts = (doc) => {
    const d = doc.querySelector('measure[number="1"] > direction');
    return { n: doc.querySelectorAll('sound[tempo]').length, tempo: d?.querySelector('sound')?.getAttribute('tempo'), unit: d?.querySelector('beat-unit')?.textContent, dot: !!d?.querySelector('beat-unit-dot'), per: d?.querySelector('per-minute')?.textContent, beforeNote: !!d && d.nextElementSibling?.nodeName === 'note' };
  };
  cases.push({
    name: 'restoreTempo: a tempo only in the log line',
    xml: score([{ id: 'P1', name: 'Voice', measures: bars }]),
    log: ['WARN  [song] MetronomeInter | No beat unit in metronome line "With seductive menace, = 133"'],
    words: /tempo ♩ = 133 restored from the engine log/,
    facts,
    expect: (f) => [[f.n === 1 && f.tempo === '133' && f.unit === 'quarter' && !f.dot && f.per === '133' && f.beforeNote, `♩ = 133 in the first measure, before its note (${JSON.stringify(f)})`]],
  });
  // The PDF's own text: Piano Man's "𝅗𝅥. = 58" in 3/4 → ♩ = 174.
  const bars34 = [m(1, head(2, 3, 4, clef('G', 2)) + n('G4', 6, { type: 'half', dot: true, lyric: sung(1) })), m(2, n('C5', 6, { type: 'half', dot: true, lyric: sung(2) }))];
  cases.push({
    name: "restoreTempo: a tempo only in the PDF's text",
    xml: score([{ id: 'P1', name: 'Voice', measures: bars34 }]),
    tempo: { bpm: 58, unit: 'half', dotted: true },
    words: /tempo 𝅗𝅥\. = 58 restored from the PDF's text/,
    facts,
    expect: (f) => [[f.n === 1 && f.tempo === '174' && f.unit === 'half' && f.dot && f.per === '58', `𝅗𝅥. = 58 → <sound tempo="174"> (${JSON.stringify(f)})`]],
  });
}

// markTupletGroups: an eighth-note triplet the engine timed (3:2) but left without <tuplet> marks.
{
  const tri = (p, k) => n(p, 2, { type: 'eighth', tm: [3, 2], lyric: sung(k) });
  const bars = [
    m(1, head(6, 2, 4, clef('G', 2)) + tri('C5', 1) + tri('D5', 2) + tri('E5', 3) + n('F5', 6, { type: 'quarter', lyric: sung(4) })),
    m(2, n('G5', 12, { type: 'half', lyric: sung(5) })),
  ];
  cases.push({
    name: 'markTupletGroups: unmarked triplets',
    xml: score([{ id: 'P1', name: 'Voice', measures: bars }]),
    words: /P1: tuplet marks added \(m1\)/,
    facts: (doc) => [...doc.querySelectorAll('measure[number="1"] > note')].map((x) => [...x.querySelectorAll('notations > tuplet')].map((t) => t.getAttribute('type')).join('') || '-'),
    expect: (f) => [[f.join(' ') === 'start - stop -', `the triplet's first and last note marked (${f.join(' ')})`]],
  });
}

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + 'tools.html');
  for (const c of cases) {
    const r = await p.evaluate(async ({ xml, log, tempo, facts }) => {
      const { fixOmrScore } = await import(new URL('omr/fixscore.js?fixcases', location.href).href);
      const a = fixOmrScore(xml, log, { tempo });
      const again = fixOmrScore(a.xml, log, { tempo });
      const doc = new DOMParser().parseFromString(a.xml, 'application/xml');
      return { changes: a.changes, again: again.changes, same: again.xml === a.xml, facts: new Function('doc', `return (${facts})(doc)`)(doc), parsed: !doc.querySelector('parsererror') };
    }, { xml: c.xml, log: c.log || [], tempo: c.tempo || null, facts: c.facts.toString() });
    ok(r.parsed && r.changes.length === 1 && c.words.test(r.changes[0]), `${c.name}: the one change — ${JSON.stringify(r.changes)}`);
    for (const [cond, what] of c.expect(r.facts)) ok(cond, `${c.name}: ${what}`);
    ok(!r.again.length && r.same, `${c.name}: a second run changes nothing${r.again.length ? ` (${JSON.stringify(r.again)})` : ''}`);
  }
  ok(!errs.length, `no page errors ${errs.join(' | ')}`);
  await b.close();
  done();
})().catch(fail);
