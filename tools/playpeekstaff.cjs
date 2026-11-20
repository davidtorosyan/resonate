// Play's peek sounds everything struck on the pressed staff at that moment — every voice's notes
// starting there, not only the pressed note's chord (converted scores split a chord's notes into
// voices). Not the other staff's, not a note still held from before, not a grace note's neighbours.
// usage: node playpeekstaff.cjs   (BASE defaults to http://localhost:8097/resonate/)
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8097/resonate/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Piano, 4/4, divisions 2. Staff 1: voice 1 = A4 half (beat 1) then C5 half; voice 2 = F4 quarter,
// E4 quarter (beat 2: while A4 still sounds), D4 half. Staff 2: C3 whole. A grace B4 before C5.
const note = (p, dur, o = {}) => {
  const [, s, oct] = /^([A-G])(\d)$/.exec(p);
  return `<note>${o.grace ? '<grace/>' : ''}${o.ch ? '<chord/>' : ''}<pitch><step>${s}</step><octave>${oct}</octave></pitch>${o.grace ? '' : `<duration>${dur}</duration>`}<voice>${o.v || 1}</voice><type>${o.type || 'quarter'}</type><staff>${o.st || 1}</staff></note>`;
};
const XML = `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">
<measure number="1"><attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
${note('A4', 4, { type: 'half' })}${note('B4', 0, { grace: true, type: 'eighth' })}${note('C5', 4, { type: 'half' })}<backup><duration>8</duration></backup>
${note('F4', 2, { v: 2 })}${note('E4', 2, { v: 2 })}${note('D4', 4, { v: 2, type: 'half' })}<backup><duration>8</duration></backup>
${note('C3', 8, { v: 5, st: 2, type: 'whole' })}</measure>
<measure number="2">${note('G4', 8, { type: 'whole' })}<backup><duration>8</duration></backup>${note('C3', 8, { v: 5, st: 2, type: 'whole' })}</measure>
</part></score-partwise>`;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + 'tools.html');
  const id = await page.evaluate(async (xml) => {
    const v = document.getElementById('version')?.textContent.trim().slice(1) || '';
    const L = await import(`./library.js?v=${v}`);
    return L.addSong('Peek staff', xml, { source: 'file' });
  }, XML);
  await page.evaluate((id) => localStorage.setItem('resonate.sing.song', id), id);
  await page.goto(BASE + 'play.html');
  await page.waitForFunction(() => window.resonateDebug?.().play?.ready, null, { timeout: 90000 });
  const cdp = await ctx.newCDPSession(page);
  const heads = await page.evaluate(() => {
    const F = window.resonateDebug().play.facts, get = (i) => (F.get ? F.get(i) : F[i]);
    const out = {};
    for (const g of document.querySelectorAll('#stage g.note')) {
      const f = get(g.id); if (!f) continue;
      const r = g.querySelector(':scope > g.notehead').getBoundingClientRect();
      out[`${f.step}${f.oct}${f.grace ? 'g' : ''}@${f.mi}`] = { id: g.id, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return out;
  });
  let fails = 0;
  const press = async (key, want) => {
    const h = heads[key];
    if (!h) { console.log(`FAIL no head ${key} (${Object.keys(heads)})`); fails++; return; }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: h.x, y: h.y }] });
    await sleep(300);
    const pk = await page.evaluate(() => { const p = window.resonateDebug().play.peek; return p && p.names; });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(2700);
    const ok = pk === want;
    if (!ok) fails++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} press ${key} → "${pk}"${ok ? '' : ` ≠ "${want}"`}`);
  };
  await press('A4@0', 'F4 A4');   // voice 1's head: voice 2's F4 starts with it
  await press('F4@0', 'F4 A4');   // voice 2's head: voice 1's A4 too
  await press('E4@0', 'E4');      // beat 2: A4 still sounds from beat 1 — not re-struck
  await press('C5@0', 'D4 C5');   // beat 3: both voices; not the grace B4 before it, not the bass
  await press('B4g@0', 'B4');     // a grace note alone
  await press('C3@0', 'C3');      // the other staff alone
  await press('G4@1', 'G4');
  if (errs.length) { console.log('FAIL page errors', errs); fails++; }
  console.log(fails ? `${fails} failed` : 'all passed');
  await b.close();
  process.exit(fails ? 1 : 0);
})();
