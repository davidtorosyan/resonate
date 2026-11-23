// Guided practice end to end (v76): a simulated singer (sawtooth through a fake getUserMedia,
// as review.cjs) follows the plan on Amazing Grace from a clean slate: Hear it → first run
// (one phrase with wrong notes, one sung a beat late) → the plan's blocks (in time / in tune)
// → runs → ✓, Then → Now. Checks the card's words, the lane modes, slower rounds, the
// self-check, persistence, and Guide me off. node guided.cjs  (server: serve.mjs on 8097)
const { chromium } = require('playwright');
const SP = '/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/g/';
const BLEED = !!process.env.BLEED; // BLEED=1: the page's own sound reaches the mic (a phone speaker — the count-in clicks are found)
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => (m.type() === 'error' || (m.type() === 'warning' && /^(rhythm|practice:)/.test(m.text()))) && errs.push(m.text()));
  await p.addInitScript((BLEED) => {
    if (BLEED) { // (from the v76 review's probes: everything played into a context's destination also reaches its mic, 60 ms later)
      const oc = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (t, ...a) {
        const r = oc.call(this, t, ...a);
        try {
          const ctx = this.context;
          if (t === ctx.destination && !(this instanceof GainNode && this.gain.value === 0) && !(this instanceof ConstantSourceNode)) {
            if (!ctx.__bleed) { ctx.__bleed = ctx.createGain(); ctx.__bleed.gain.value = 0.3; }
            oc.call(this, ctx.__bleed);
          }
        } catch {}
        return r;
      };
      const oms = AudioContext.prototype.createMediaStreamSource;
      AudioContext.prototype.createMediaStreamSource = function (stream) {
        const src = oms.call(this, stream);
        if (!this.__bleed) { this.__bleed = this.createGain(); this.__bleed.gain.value = 0.3; }
        const mix = this.createGain();
        oc.call(src, mix);
        const dl = this.createDelay(1); dl.delayTime.value = 0.06;
        oc.call(this.__bleed, dl); oc.call(dl, mix);
        return mix;
      };
    }
    // wrong: note indices sung 2 semitones flat; silent: note indices not sung; shift: [{ from, to, by }] — at
    // song time t in [from, to) the singer is `by` s behind; quiet: sing at a whisper (unclear).
    window.__plan = { wrong: [], silent: [], shift: [], quiet: false };
    let shared = null;
    navigator.mediaDevices.getUserMedia = async () => {
      if (!shared) {
        const ac = new AudioContext();
        const osc = ac.createOscillator(); osc.type = 'sawtooth';
        const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2500;
        const g = ac.createGain(); g.gain.value = 0;
        const dest = ac.createMediaStreamDestination();
        osc.connect(lp); lp.connect(g); g.connect(dest); osc.start();
        setInterval(() => {
          const dbg = window.resonateDebug?.(); let m = null; const P = window.__plan;
          if (dbg?.session?.kind === 'sing') {
            let t = dbg.nowT;
            for (const s of P.shift) if (t >= s.from && t < s.to) t -= s.by;
            const [a, z] = dbg.take?.range || [0, dbg.notes.length]; // (only the take's own notes: nobody sings the count-in)
            const i = dbg.notes.findIndex((n, k) => k >= a && k < z && n.t <= t && t < n.t + n.d - 0.04);
            if (i >= 0 && !P.silent.includes(i)) m = dbg.notes[i].midi + (P.wrong.includes(i) ? -2 : 0);
          }
          if (m === null) g.gain.setTargetAtTime(0, ac.currentTime, 0.005);
          else { osc.frequency.setValueAtTime(440 * 2 ** ((m - 69) / 12), ac.currentTime); g.gain.setTargetAtTime(P.quiet ? 0.004 : 0.25, ac.currentTime, 0.005); }
        }, 5);
        shared = dest.stream;
      }
      return shared.clone();
    };
  }, BLEED);
  await p.goto('http://localhost:8097/resonate/sing.html'); await p.waitForTimeout(1500);
  await p.evaluate(() => { for (const k of ['resonate.sing.history', 'resonate.sing.practice', 'resonate.sing.session', 'resonate.sing.ear']) localStorage.removeItem(k); });
  await p.reload(); await p.waitForTimeout(2000);
  const dbg = () => p.evaluate(() => { const d = window.resonateDebug(); return { pr: d.practice, session: d.session, rate: d.rate, laneMode: d.laneMode, nowT: d.nowT, btn: document.getElementById('sing').textContent, review: !document.getElementById('review').hidden }; });
  const card = async () => (await dbg()).pr.card;
  const ph = (await dbg()).pr.phrases;
  console.log('phrases:', ph.map((x) => x.name).join(' | '));
  ok(ph.length === 4, 'Amazing Grace groups into 4 phrases');
  const texts = []; // every card text seen (for the no-score check)
  const note = (c) => texts.push([c.title, c.win, c.cue].join(' · '));

  // 1. Hear it first: stop once the first phrase has played.
  let c = await card(); note(c);
  ok(c.title === 'Hear it first' && (await dbg()).btn === '▶ Hear it', `a new song starts with Hear it (“${c.title}”, ${(await dbg()).btn})`);
  await p.click('#sing');
  for (let i = 0; i < 80 && (await dbg()).nowT < ph[0].t1 + 0.3; i++) await p.waitForTimeout(250);
  await p.click('#sing'); await p.waitForTimeout(800);
  let d = await dbg();
  ok(!!d.pr.doc.heard && d.pr.step.kind === 'first', `stopping after a phrase counts as heard; next: ${d.pr.step.kind} (“${d.pr.card.title}”)`);

  // Runs a step to its end; per round, the singer plan from planFor(step, round). Returns the cards seen.
  const runStep = async (planFor = () => ({}), max = 180) => {
    const seen = [];
    const step0 = (await dbg()).pr.step;
    await p.evaluate((x) => { window.__plan = { wrong: [], silent: [], shift: [], quiet: false, ...x }; }, planFor(step0, 1));
    await p.click('#sing');
    let lastRound = 1, lastPhase = '';
    for (let i = 0; i < max * 4; i++) {
      await p.waitForTimeout(250);
      d = await dbg();
      const bl = d.pr.block;
      if (bl && bl.round !== lastRound) { lastRound = bl.round; await p.evaluate((x) => { window.__plan = { wrong: [], silent: [], shift: [], quiet: false, ...x }; }, planFor(bl.step, bl.round)); }
      if (bl && bl.phase !== lastPhase) {
        lastPhase = bl.phase;
        if (bl.phase === 'result' || bl.phase === 'wait') { seen.push({ ...d.pr.card, round: bl.round, rate: d.rate, setup: bl.setup }); note(d.pr.card); }
        if (bl.phase === 'sing') seen.push({ lane: d.laneMode, round: bl.round, rate: d.rate, setup: bl.setup, sing: true });
        if (bl.phase === 'wait') return { seen, wait: true };
      }
      if (!bl && !d.session) { await p.waitForTimeout(600); d = await dbg(); seen.push({ ...d.pr.card, end: true }); note(d.pr.card); return { seen }; }
    }
    return { seen, timeout: true };
  };
  const beat = 60 / 80; // Amazing Grace's tempo (quarter = beat)

  // 2. The first run: phrase 1 ("Amazing grace…") a beat late after the count-in, phrase 2 ("That
  // saved…") two wrong notes. (A phrase sung a beat late in the middle of a run, with no rest
  // before it, still reads as on time in v1: each note lands on the one before — docs/COACHING.md.)
  const p0 = ph[0], p1 = ph[1];
  let r = await runStep(() => ({ wrong: [p1.j0 + 2, p1.j0 + 3], shift: [{ from: p0.t0 - 3, to: p0.t1 - 0.02, by: beat }] }));
  d = await dbg();
  const marks = d.pr.phrases.map((x) => `${x.marks.time ? '♩' : '·'}${x.marks.tune ? '♪' : '·'}${x.marks.song ? '✓' : '·'}`);
  console.log('after the first run:', marks.join(' '), '| card:', JSON.stringify(d.pr.card));
  ok(!d.review, 'no review sheet opens after a guided run');
  ok(d.pr.phrases[3].marks.time && d.pr.phrases[3].marks.tune && !d.pr.phrases[3].marks.song, 'the first run credits a clean phrase with ♩♪ (no ✓ from a first run)');
  ok(!d.pr.phrases[1].marks.tune, 'wrong notes: no ♪ for “That saved…”');
  ok(!d.pr.phrases[0].marks.time, 'a beat late after the count-in: no ♩ for “Amazing grace…”');
  ok(d.pr.step && d.pr.card.title && d.btn !== '■ Stop', `one next step on the card (“${d.pr.card.title}” · ${d.btn})`);

  // 3. Follow the plan; the singer is right except where a scenario says.
  const log = [];
  let slipDone = false, slowDone = false, selfDone = false, tuneCue = false, thenNowSeen = false;
  for (let k = 0; k < 18; k++) {
    d = await dbg();
    const st = d.pr.step;
    if (!st) break;
    const label = `${st.kind}${st.stage ? ':' + st.stage : ''}${st.p !== undefined ? ':p' + st.p : ''}`;
    let planFor = () => ({});
    let scenario = '';
    if (st.kind === 'stage' && st.stage === 'time' && !slipDone) {
      // Round 1 a beat late (a counting slip), then on time.
      scenario = 'slip';
      planFor = (s, round) => (round === 1 ? { shift: [{ from: d.pr.phrases[s.p].t0 - 0.2, to: d.pr.phrases[s.p].t1 + 3, by: beat }] } : {});
    } else if (st.kind === 'stage' && st.stage === 'time' && !slowDone) {
      scenario = 'slow';
      planFor = (s, round) => (round <= 2 ? { shift: [{ from: d.pr.phrases[s.p].t0 - 0.2, to: d.pr.phrases[s.p].t1 + 3, by: beat }] } : {});
    } else if (st.kind === 'stage' && st.stage === 'tune' && !tuneCue) {
      scenario = 'tune';
      planFor = (s, round) => (round === 1 ? { wrong: [d.pr.phrases[s.p].j0 + 2] } : {});
    } else if (st.kind === 'stage' && !selfDone && slipDone && tuneCue) {
      scenario = 'self';
      planFor = () => ({ quiet: true });
    }
    r = await runStep(planFor);
    const lanes = [...new Set(r.seen.filter((x) => x.sing).map((x) => x.lane))];
    log.push(`${label} [${scenario}] ${r.seen.filter((x) => !x.sing).map((x) => `${x.round ? 'r' + x.round + (x.rate !== 1 ? '@' + x.rate.toFixed(2) : '') + ' ' : ''}${[x.title, x.win, x.cue].filter(Boolean).join(' · ')}`).join(' | ')} lanes:${lanes.join(',')}`);
    if (scenario === 'slip') {
      const r1 = r.seen.find((x) => x.round === 1 && !x.sing);
      ok(r1 && /beat sooner|waits a beat/.test(r1.cue) && !/Sing out/.test(r1.cue + r1.win), `a beat late → a counting cue, not “Sing out” (“${r1?.cue}”)`);
      const r2 = r.seen.find((x) => x.round === 2 && !x.sing);
      ok(r2 && /on the beat now|In on/.test(r2.win), `then on time → a progress win (“${r2?.win}”)`);
      ok(lanes.includes('neutral') || lanes.includes('off'), `in-time rounds show no pitch colours (lane ${lanes.join(',')})`);
      slipDone = true;
    }
    if (scenario === 'slow') {
      const slow = r.seen.filter((x) => x.sing && x.rate < 0.99);
      ok(slow.length > 0, `after slips a round runs slower (rates ${r.seen.filter((x) => x.sing).map((x) => x.rate.toFixed(2)).join(',')})`);
      ok(Math.abs((await dbg()).rate - 1) < 1e-9, 'the song\'s tempo is back after the block');
      slowDone = true;
    }
    if (scenario === 'tune') {
      const r1 = r.seen.find((x) => x.round === 1 && !x.sing);
      ok(r1 && /up to|down to/.test(r1.cue), `a wrong note → “up to / down to” its note (“${r1?.cue}”)`);
      tuneCue = true;
    }
    if (r.wait) {
      c = await card();
      ok(c.title && c.buttons.some((x) => /Yes/.test(x)), `two unclear rounds → the self-check (“${c.title}” ${c.buttons.join(' / ')})`);
      await p.evaluate(() => [...document.querySelectorAll('#co-btns button')].find((x) => /Yes/.test(x.textContent)).click());
      await p.waitForTimeout(800);
      d = await dbg();
      ok(!d.pr.block, 'Yes ends the block');
      selfDone = true;
    }
    d = await dbg();
    if (d.pr.thenNow) thenNowSeen = true;
    if (st.kind === 'through' || d.pr.phrases.every((x) => x.marks.song)) break;
  }
  console.log(log.join('\n'));
  d = await dbg();
  console.log('map now:', d.pr.phrases.map((x) => `${x.marks.time ? '♩' : '·'}${x.marks.tune ? '♪' : '·'}${x.marks.song ? '✓' : '·'}`).join(' '));
  ok(d.pr.phrases.filter((x) => x.marks.song).length >= 2, 'runs gave ✓ to phrases in the song');
  ok(thenNowSeen, 'a phrase that went better than its first try offers ▶ Then → Now');
  ok(slipDone && tuneCue, 'the plan reached both an in-time and an in-tune block');
  ok(!texts.some((t) => /\d+\s*%|score|fail|wrong/i.test(t)), 'no %, score, fail or wrong in any card text');
  await p.screenshot({ path: SP + 'guided-end.png' });

  // 4. Then → Now plays two voice excerpts back to back.
  if (d.pr.thenNow) {
    await p.evaluate(() => [...document.querySelectorAll('#co-btns button')].find((x) => /Then/.test(x.textContent))?.click());
    await p.waitForTimeout(500);
    ok((await dbg()).session?.kind === 'thennow', 'Then → Now plays');
    await p.evaluate(() => [...document.querySelectorAll('#co-btns button')].find((x) => /Stop/.test(x.textContent))?.click());
  }

  // 5. More: the lines with their marks; ▶ from here makes a run the step.
  await p.click('#co-more'); await p.waitForTimeout(300);
  const rows = await p.evaluate(() => [...document.querySelectorAll('#mo-lines .mo-row')].map((x) => x.innerText.replace(/\n+/g, ' ')));
  ok(rows.length === 4, `More lists the lines (${rows.join(' | ')})`);
  await p.evaluate(() => document.querySelectorAll('#mo-lines .mo-from')[2].click()); await p.waitForTimeout(300);
  d = await dbg();
  ok(d.pr.step.kind === 'run' && d.pr.step.from === 2 && /Sing to/.test(d.pr.card.title), `▶ from here → a run from that line (“${d.pr.card.title}”)`);

  // 6. Persistence: a reload keeps the marks.
  const before = JSON.stringify(d.pr.phrases.map((x) => x.marks));
  await p.reload(); await p.waitForTimeout(2000);
  d = await dbg();
  const after = JSON.stringify(d.pr.phrases.map((x) => x.marks));
  ok(after === before, 'the marks survive a reload' + (after === before ? '' : `\n  before ${before}\n  after  ${after}`));

  // 7. Guide me off: the v75 screen.
  await p.click('#options-btn'); await p.click('#guided-on'); await p.click('#op-close'); await p.waitForTimeout(300);
  d = await dbg();
  const v75 = await p.evaluate(() => ({ coach: document.getElementById('coach').hidden, map: document.getElementById('map').hidden, guided: document.body.dataset.guided, btn: document.getElementById('sing').textContent }));
  ok(v75.coach && v75.map && v75.guided === 'false' && /Sing/.test(v75.btn), `Guide me off restores the v75 screen (${JSON.stringify(v75)})`);
  await p.click('#options-btn'); await p.click('#guided-on'); await p.click('#op-close');
  ok(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close();
})().catch((e) => { console.error(e); process.exit(2); });
