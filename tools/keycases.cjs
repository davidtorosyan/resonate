// unifyKeySignatures on hand-built scores shaped like Audiveris output.
const { chromium } = require('playwright');
// part: { id, staves=1, measures: [{ sys: 'page'|'system'|null, keys: [fifths|null, ...per staff] or fifths|null, notes: [...] }] }
// note: [step, alter, octave, dur, { acc, voice, staff, tie, chord, backup }]
function score(parts) {
  const pl = parts.map((p) => `<score-part id="${p.id}"><part-name>${p.id}</part-name></score-part>`).join('');
  const body = parts.map((p) => `<part id="${p.id}">` + p.measures.map((m, i) => {
    let x = `<measure number="${i + 1}">`;
    if (m.sys === 'page') x += '<print new-page="yes"/>'; else if (m.sys === 'system') x += '<print new-system="yes"/>'; else if (i === 0) x += '<print/>';
    let at = i === 0 ? '<divisions>1</divisions>' : '';
    const ks = Array.isArray(m.keys) ? m.keys : [m.keys];
    if (ks.length > 1 && ks.some((k) => k !== ks[0])) ks.forEach((k, s) => { if (k !== null && k !== undefined) at += `<key number="${s + 1}"><fifths>${k}</fifths></key>`; });
    else if (ks[0] !== null && ks[0] !== undefined) at += `<key><fifths>${ks[0]}</fifths></key>`;
    if (i === 0 && (p.staves || 1) > 1) at += `<staves>${p.staves}</staves>`;
    if (i === 0) at += '<clef><sign>G</sign><line>2</line></clef>';
    if (at) x += `<attributes>${at}</attributes>`;
    for (const [step, alter, oct, dur, o = {}] of m.notes) {
      if (o.backup) { x += `<backup><duration>${o.backup}</duration></backup>`; continue; }
      x += `<note>${o.chord ? '<chord/>' : ''}<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${oct}</octave></pitch><duration>${dur}</duration>${o.tie ? `<tie type="${o.tie}"/>` : ''}<voice>${o.voice || 1}</voice>${o.acc ? `<accidental>${o.acc}</accidental>` : ''}${o.staff ? `<staff>${o.staff}</staff>` : ''}</note>`;
    }
    return x + '</measure>';
  }).join('') + '</part>').join('');
  return `<?xml version="1.0"?><score-partwise version="4.0"><identification><encoding><software>Audiveris 5.11.0</software></encoding></identification><part-list>${pl}</part-list>${body}</score-partwise>`;
}
const B = (alter = 0, o = {}) => ['B', alter, 4, 1, o];
const E = (alter = 0, o = {}) => ['E', alter, 4, 1, o];
const meas = (sys, keys, notes) => ({ sys, keys, notes });
const cases = {
  'Wichita-like: misses, parts disagree → F everywhere': score([
    { id: 'P1', measures: [meas(null, null, [B(), B()]), meas('system', null, [B()]), meas('system', -1, [B(-1)]), meas('system', 0, [B()])] },
    { id: 'P2', measures: [meas(null, null, [B()]), meas('system', -1, [B(-1)]), meas('system', null, [B(-1)]), meas('system', null, [B(-1)])] },
  ]),
  'L: song in C, real change to Db (all parts), piano misses once later → C kept, miss fixed': score([
    { id: 'P1', measures: [meas(null, null, [B()]), meas('system', null, [B()]), meas('system', -5, [B(-1), E(-1)]), meas('system', null, [B(-1)])] },
    { id: 'P2', measures: [meas(null, null, [B()]), meas('system', null, [B()]), meas('system', -5, [B(-1)]), meas('system', 0, [B(), E()])] },
  ]),
  'F: B♭ clarinet in G + voice in F, all read right → untouched': score([
    { id: 'P1', measures: [meas(null, 1, [['F', 1, 4, 1], B()]), meas('system', null, [['F', 1, 4, 1]]), meas('system', null, [['F', 1, 4, 1]])] },
    { id: 'P2', measures: [meas(null, -1, [B(-1)]), meas('system', null, [B(-1)]), meas('system', null, [B(-1)])] },
  ]),
  'F-miss: clarinet in G + voice in F, voice misses one system → voice fixed, clarinet untouched': score([
    { id: 'P1', measures: [meas(null, 1, [['F', 1, 4, 1]]), meas('system', null, [['F', 1, 4, 1]]), meas('system', null, [['F', 1, 4, 1]]), meas('system', null, [['F', 1, 4, 1]])] },
    { id: 'P2', measures: [meas(null, -1, [B(-1)]), meas('system', null, [B(-1)]), meas('system', 0, [B()]), meas('system', -1, [B(-1)])] },
  ]),
  'Lead sheet: F, miss, F → filled': score([{ id: 'P1', measures: [meas(null, -1, [B(-1)]), meas('system', 0, [B()]), meas('system', -1, [B(-1)])] }]),
  'Lead sheet: starts C then F (no evidence) → untouched': score([{ id: 'P1', measures: [meas(null, null, [B()]), meas('system', -1, [B(-1)]), meas('system', null, [B(-1)])] }]),
  'Mid-system key change in all parts (C→D) + a miss elsewhere → change kept': score([
    { id: 'P1', measures: [meas(null, null, [['F', 0, 4, 1]]), meas(null, 2, [['F', 1, 4, 1]]), meas('system', null, [['F', 1, 4, 1]]), meas('system', 0, [['F', 0, 4, 1]])] },
    { id: 'P2', measures: [meas(null, null, [['F', 0, 4, 1]]), meas(null, 2, [['F', 1, 4, 1]]), meas('system', null, [['F', 1, 4, 1]]), meas('system', null, [['F', 1, 4, 1]])] },
  ]),
  'Mid-system change to D read by the voice only (piano keeps C) → D for both': score([
    { id: 'P1', measures: [meas(null, null, [['F', 0, 4, 1]]), meas(null, 2, [['F', 1, 4, 1]]), meas('system', null, [['F', 1, 4, 1]])] },
    { id: 'P2', measures: [meas(null, null, [['F', 0, 4, 1]]), meas(null, null, [['F', 0, 4, 1], ['C', 0, 4, 1]]), meas('system', 2, [['F', 1, 4, 1]])] },
  ]),
  'Mid-system change to A, correctly read, lead sheet in G → untouched': score([{ id: 'P1', measures: [meas(null, 1, [['F', 1, 4, 1], ['C', 0, 5, 1]]), meas(null, 3, [['C', 1, 5, 1], ['G', 1, 4, 1]]), meas('system', null, [['C', 1, 5, 1]])] }]),
  'Lead sheet in B♭ modulating to C for the last two systems → untouched': score([{ id: 'P1', measures: [meas(null, -2, [B(-1), E(-1)]), meas('system', null, [B(-1)]), meas('system', 0, [B(), E()]), meas('system', null, [B()])] }]),
  'SATB staff, key missed: alto B♮ (printed) at beat 2 carries to soprano B at beat 3': score([
    { id: 'P1', measures: [meas(null, -1, [B(-1)]), meas('system', 0, [['A', 0, 4, 2, { voice: 1 }], B(0, { voice: 1 }), ['A', 0, 4, 1, { voice: 1 }], [0, 0, 0, 0, { backup: 4 }], ['G', 0, 4, 1, { voice: 2 }], B(0, { voice: 2, acc: 'natural' }), ['G', 0, 4, 2, { voice: 2 }]]), meas('system', -1, [B(-1)])] },
    { id: 'P2', measures: [meas(null, -1, [B(-1)]), meas('system', -1, [B(-1)]), meas('system', -1, [B(-1)])] },
  ]),
  'Page start: voice misses the key on a new page (writes nothing) → B fixed': score([
    { id: 'P1', measures: [meas(null, -1, [B(-1)]), meas('page', null, [B()]), meas('system', -1, [B(-1)])] },
    { id: 'P2', measures: [meas(null, -1, [B(-1)]), meas('page', -1, [B(-1)]), meas('system', -1, [B(-1)])] },
  ]),
  'Tie across a missed barline: B♭ tied into missed system stays B♭': score([
    { id: 'P1', measures: [meas(null, -1, [['B', -1, 4, 1, { tie: 'start' }]]), meas('system', 0, [['B', 0, 4, 1, { tie: 'stop' }], B()])] },
    { id: 'P2', measures: [meas(null, -1, [B(-1)]), meas('system', -1, [B(-1)])] },
  ]),
  'Two staves, per-staff key (staff 2 read F, staff 1 missed) → staff 1 fixed': score([
    { id: 'P1', staves: 2, measures: [meas(null, -1, [B(-1, { staff: 1 }), [0, 0, 0, 0, { backup: 1 }], ['B', -1, 3, 1, { staff: 2 }]]), meas('system', [0, -1], [B(0, { staff: 1 }), [0, 0, 0, 0, { backup: 1 }], ['B', -1, 3, 1, { staff: 2 }]])] },
  ]),
};
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  let fails = 0;
  p.on('pageerror', (e) => { fails++; console.log('FAIL page error', e.message); });
  await p.goto('http://localhost:8097/resonate/tools.html'); await p.waitForTimeout(300);
  for (const [name, xml] of Object.entries(cases)) {
    const r = await p.evaluate(async (xml) => {
      const { fixOmrScore } = await import('/resonate/omr/fixscore.js?' + Math.random());
      const a = fixOmrScore(xml);
      const again = fixOmrScore(a.xml);
      const d = new DOMParser().parseFromString(a.xml, 'application/xml');
      const out = [...d.querySelectorAll('part')].map((pt) => pt.id + ': ' + [...pt.querySelectorAll('measure')].map((m) => {
        const k = [...m.querySelectorAll('key')].map((x) => (x.getAttribute('number') ? 's' + x.getAttribute('number') + '=' : '') + x.querySelector('fifths').textContent).join(',');
        const ns = [...m.querySelectorAll('note')].map((n) => n.querySelector('step').textContent + ({ '-1': '♭', 1: '♯' }[n.querySelector('alter')?.textContent] || '') + n.querySelector('octave').textContent).join(' ');
        return `[${k ? 'k' + k + ' ' : ''}${ns}]`;
      }).join(' ')).join('\n      ');
      return { changes: a.changes.join(' | ') || '(none)', again: again.changes.filter((c) => /key/.test(c)).join(' | '), out };
    }, xml);
    console.log(`${name}\n   → ${r.changes}${r.again ? '   NOT IDEMPOTENT: ' + r.again : ''}\n      ${r.out}`);
    if (r.again) { fails++; console.log(`FAIL ${name}: a second run changes keys again`); }
  }
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'all ok (every case idempotent)');
  process.exit(fails ? 1 : 0);
})();
