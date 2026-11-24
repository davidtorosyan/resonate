// Ear (E8 prototype, sing.js "Ear", ear.js; docs/EAR.md) with a simulated singer (a sawtooth through a fake
// getUserMedia: tools/lib/earsinger.cjs, the probes' singer), on Amazing Grace, indices in the line.
// sing.html (the shell mounts the same page):
//   0 the lines are the printed lines (the fix plan's WP1.12, Q-A): Amazing Grace's four hymn lines; ▶ pulses
//   1 the free attempt — on its own time, 15 % slower, its 3rd note 2 semitones flat: the tempo found
//     (within 6 %), ♪ one short with the cue on that note ("· higher"), ♩ 7 or more, an answer in < 1.5 s
//   2 again, 10 % faster, every note right: "♩ all of them · ♪ all of them"
//   2b Line → Notes → Line: that result again, dimmed under "Last time" (WP1.9)
//   2c ▶ First note, then the dock's ▶, in the middle of an attempt (the song, key, tempo and ⚙ locked): it
//     ends, uncounted — "Stopped — not counted", nothing stored, the note / the line plays (WP1.6), the mic's
//     tracks stopped and the session "playback" before the piano starts (iOS: quiet under a live capture)
//   3 Beats — sing with the click (the guided take path): ♩ all of them, "In on …"; the dock "● Sing" →
//     "■ Stop", no count-in or dB in #status (WP1.3–4)
//   4 Notes — "■ Stop" on both buttons while the note plays (WP1.7); the first target held an octave down
//     (matched, "an octave down — fine"), the next on pitch: every target done → back to the line
//   5 ⚙ — while Ear shows only its switch, "Phrase by phrase" (WP1.10); turned off while ▶ Hear plays, it stops
//   6 another song opens on its own line, nothing of the last one's; back, and after a reload, the line kept (WP1.8)
// The shell (index.html, Sing alone), a phone 390×844 and an iPad 820×1180 (WP1.1–4):
//   the tuner hidden while Ear shows, back with ⚙ off or the song closed; during a free attempt state().take,
//   the tuner holds "take" and its mic is off; the dock's captions Hear / Stop and every primary label whole in
//   every mode; ▶ in a Beats take ends it, uncounted
//   no lane shown, no page errors
//   node ear.cjs   (BASE: the harness, http://localhost:8097/resonate/; ONLY=page|phone|ipad)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { ok, done } = require('./lib/check.cjs');
const { BASE } = require('./lib/paths.cjs');
const { SINGER } = require('./lib/earsinger.cjs');
const sleep = (t) => new Promise((r) => setTimeout(r, t));
const ONLY = process.env.ONLY || '';
const AG_XML = fs.readFileSync(path.join(__dirname, '../public/songs/amazing-grace.musicxml'), 'utf8');
const LINES = [[0, 11, 'Amazing grace! how sweet the sound!'], [11, 21, 'That saved a wretch like me!'], [21, 32, 'I once was lost, but now I\'m found;'], [32, 41, 'Was blind, but now I see.']];
const ARGS = ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'];

// --- sing.html ---------------------------------------------------------------------------------------
async function singPage(browser) {
  console.log('\n=== sing.html (phone)');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => {
    if (location.protocol === 'about:') return;
    try { if (!sessionStorage.getItem('ear')) { sessionStorage.setItem('ear', '1'); localStorage.setItem('resonate.sing.song', 'amazing-grace'); } } catch {}
  });
  await ctx.addInitScript(SINGER); // (window.__sing: the plan sung; indices in the line)
  // (the mic's tracks handed out, and — once __watch is set — how many were live when a piano note was started)
  await ctx.addInitScript(() => {
    if (location.protocol === 'about:') return;
    const g = navigator.mediaDevices.getUserMedia;
    window.__tracks = [];
    window.__atStart = [];
    navigator.mediaDevices.getUserMedia = async (...a) => { const s = await g.apply(navigator.mediaDevices, a); window.__tracks.push(...s.getTracks()); return s; };
    const st = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...a) {
      if (window.__watch) window.__atStart.push({ live: window.__tracks.filter((t) => t.readyState === 'live').length, session: navigator.audioSession?.type });
      return st.apply(this, a);
    };
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console ' + m.text().slice(0, 200)); });
  await page.goto(BASE + 'sing.html');
  const ready = () => page.waitForFunction(() => window.resonateDebug?.().ear?.on && document.getElementById('ear-words').textContent, null, { timeout: 30000 });
  await ready();
  const ear = () => page.evaluate(() => ({ ...window.resonateDebug().ear, ui: document.getElementById('ear-res').innerText.replace(/\n/g, ' | '), notesUi: document.getElementById('ear-notes').innerText.replace(/\n/g, ' '), old: document.getElementById('ear-res').hasAttribute('data-old') }));
  const btns = () => page.evaluate(() => { const l = document.getElementById('listen'), s = document.getElementById('sing'); return { listen: l.textContent, caption: l.dataset.caption || null, listenOff: l.disabled, sing: s.textContent, singOff: s.disabled, pulse: l.hasAttribute('data-pulse') }; });
  const idle = () => page.waitForFunction(() => { const d = window.resonateDebug(); return d.ear.run === null && !d.session; }, null, { timeout: 20000 });
  // 0. the lines
  let e = await ear();
  const lines = e.lines.map((l) => [l.j0, l.j1, l.words]);
  ok(JSON.stringify(lines) === JSON.stringify(LINES), `0: the printed lines — ${lines.map((l) => `${l[0]}–${l[1] - 1} “${l[2]}”`).join(' / ')}`);
  ok(e.p === 0 && e.mode === 'line' && (await page.textContent('.ear-modes button[aria-pressed="true"]')) === 'Line', `0: line 1 open, the Line tab (${e.mode}; the tabs “${(await page.textContent('.ear-modes')).trim().split(/\s+/).join(' · ')}”)`);
  let b = await btns();
  ok(b.pulse && b.caption === 'Hear' && b.listen === '▶ Hear' && b.sing === '● Sing', `0: ▶ pulses (hear it first), the dock “${b.listen}” (${b.caption}) · “${b.sing}”`);
  // 1. the free attempt: 1.5 s after the tap, 15% slower, the 3rd note flat
  await page.click('#sing');
  await page.waitForFunction(() => document.getElementById('sing').textContent === '■ Done', null, { timeout: 10000 });
  await page.evaluate(() => { window.__sing = { mode: 'free', at: performance.now() + 1500, f: 1.15, cents: { 2: -200 } }; });
  const dur = await page.evaluate(() => { const d = window.resonateDebug(); const a = d.ear.ph.j0, z = d.ear.ph.j1; return d.notes[z - 1].t + d.notes[z - 1].d - d.notes[a].t; });
  b = await btns();
  ok(!b.pulse && !b.listenOff && b.caption === 'Hear', `1: listening — ▶ not pulsing, enabled (it ends the attempt, uncounted): “${b.listen}”, the primary “${b.sing}”`);
  await sleep(1500 + dur * 1.15 * 1000 + 800);
  const t0 = Date.now();
  await page.click('#sing');
  await page.waitForFunction(() => { const x = window.resonateDebug().ear; return x.res && x.run === null; }, null, { timeout: 15000 });
  const ms = Date.now() - t0;
  let r = (await ear()).res;
  const flat = await page.evaluate(() => window.resonateDebug().ear.ph.j0 + 2);
  ok(r.fit && Math.abs(r.fit.b - 1.15) <= 0.07, `1: the singer's own tempo found (×${r.fit?.b.toFixed(2)}, sung ×1.15)`);
  ok(r.counts && !r.counts.notesAll && r.cue?.j === flat && /higher/.test(r.cue.text), `1: ♪ ${r.counts?.notes}, the cue on the flat note: “${r.cue?.text}”`);
  ok(r.cue?.kind === 'pitch' && r.cue.dir === 'higher' && r.grades?.length === 11 && r.kind === 'line', `1: the result as debug shows it — ${r.kind}, cue ${r.cue?.kind} ${r.cue?.dir}, ${r.grades?.length} grades`);
  // (the singer's plan, indices in the line: only its note 2 sung low, every start where it's written)
  const sung = await page.evaluate(() => { const u = window.__sung, d = window.resonateDebug(), a = d.ear.ph.j0; return u && u.segs.map((o) => ({ i: o.i, moved: o.s - o.w, off: Math.round((o.m - d.notes[a + o.i].midi) * 100) })); });
  ok(sung && sung.length === 11 && sung.every((o) => Math.abs(o.moved) < 1e-9 && o.off === (o.i === 2 ? -200 : 0)), `1: the singer sang the plan (${JSON.stringify(sung?.filter((o) => o.off || o.moved))})`);
  ok(r.counts?.beats >= 7, `1: ♩ ${r.counts?.beats} (a steady singer, one note flat)`);
  ok(ms < 1500, `1: the answer in ${ms} ms`);
  ok(!(await page.evaluate(() => getComputedStyle(document.getElementById('lane')).display !== 'none')), '1: no lane shown');
  ok(!(await btns()).pulse && (await ear()).hints.line === 1, `1: sung — ▶ no longer pulses; the device's Line attempts: ${(await ear()).hints.line}`);
  // 2. again, all right → all of them
  await page.evaluate(() => { window.__sing = null; });
  await page.click('#sing');
  await page.waitForFunction(() => document.getElementById('sing').textContent === '■ Done', null, { timeout: 10000 });
  await page.evaluate(() => { window.__sing = { mode: 'free', at: performance.now() + 900, f: 0.9 }; });
  await sleep(900 + dur * 0.9 * 1000 + 800);
  await page.click('#sing');
  await page.waitForFunction(() => { const x = window.resonateDebug().ear; return x.res && x.run === null; }, null, { timeout: 15000 });
  e = await ear();
  r = e.res;
  ok(r.counts?.notesAll && r.counts?.beatsAll && /all of them.*all of them/.test(e.ui) && !e.old, `2: every note right — “${e.ui}”`);
  // 2b. Line → Notes → Line: the result kept, dimmed under "Last time"
  await page.click('.ear-modes button[data-ear="notes"]');
  await page.click('.ear-modes button[data-ear="line"]');
  e = await ear();
  ok(e.shown?.old && e.old && /^Last time \| .*all of them.*all of them/.test(e.ui) && e.shown.res.counts?.notesAll, `2b: Line → Notes → Line: the last result, dimmed — “${e.ui}”`);
  const kept = JSON.stringify(e.shown.res);
  await page.click('#ear-next'); await page.click('#ear-prev');
  e = await ear();
  ok(e.shown?.old && JSON.stringify(e.shown.res) === kept, '2b: › then ‹: still there');
  // 2c. ▶ First note mid-attempt, then the dock's ▶: ended, uncounted
  for (const [what, sel, play] of [['▶ First note', '#ear-acts button[data-act="first"]', 'the first note'], ['the dock’s ▶', '#listen', 'the line']]) {
    await page.click('#sing');
    await page.waitForFunction(() => document.getElementById('sing').textContent === '■ Done', null, { timeout: 10000 });
    await page.evaluate(() => { window.__sing = { mode: 'free', at: performance.now() + 200, f: 1 }; });
    await sleep(700);
    const firstOff = await page.$eval('#ear-acts button[data-act="first"]', (x) => x.disabled);
    const locked = await page.evaluate(() => ['song-select', 'key-select', 'tempo-select', 'options-btn'].filter((id) => !document.getElementById(id)?.disabled));
    ok(!locked.length, `2c: during the attempt the song, key, tempo and ⚙ are locked${locked.length ? ` (not: ${locked})` : ''}`);
    await page.evaluate(() => { window.__atStart = []; window.__watch = true; });
    await page.click(sel);
    await sleep(150);
    e = await ear();
    ok(!firstOff && e.run === 'play' && e.flash === 'Stopped — not counted' && /^Stopped — not counted$/.test(e.ui), `2c: ${what} mid-attempt → “${e.ui}”, ${play} plays (run ${e.run})`);
    // (iOS plays quietly while a capture is live, and needs "playback" — an "auto" after it went to the silent switch)
    await sleep(400);
    const snd = await page.evaluate(() => { window.__watch = false; return { starts: window.__atStart, live: window.__tracks.filter((t) => t.readyState === 'live').length, session: navigator.audioSession.type }; });
    ok(snd.starts.length && snd.starts.every((s) => !s.live && s.session === 'playback') && !snd.live && snd.session === 'playback', `2c: ${what}: the mic stopped and the session “playback” before the piano (${JSON.stringify(snd.starts.slice(0, 2))}; now ${snd.session}, ${snd.live} live)`);
    ok(e.hints.line === 2 && JSON.stringify(e.shown?.res ?? null) === kept && !(await page.evaluate(() => window.resonateDebug().session)), `2c: ${what}: nothing judged or stored (the device's attempts ${e.hints.line}, the result kept)`);
    await page.evaluate(() => { window.__sing = null; });
    await idle();
  }
  e = await ear();
  ok(e.flash && /Stopped/.test(e.ui), `2c: after it played: “${e.ui}”`);
  // 3. Beats: the click take
  await page.evaluate(() => { window.__sing = { mode: 'beats' }; });
  await page.click('.ear-modes button[data-ear="beats"]');
  e = await ear();
  b = await btns();
  ok(!e.flash && !e.shown && b.sing === '● Sing' && b.caption === 'Hear' && !(await page.$('#ear-acts button')), `3: Beats — “${b.listen}” (${b.caption}) · “${b.sing}”, no result yet, no Slower`);
  await page.evaluate(() => { window.__status = []; window.__poll = setInterval(() => { const s = document.getElementById('status').textContent; if (s) window.__status.push(s); }, 50); });
  await page.click('#sing');
  await page.waitForFunction(() => window.resonateDebug().session?.kind === 'sing', null, { timeout: 10000 });
  b = await btns();
  ok(b.sing === '■ Stop' && (await page.evaluate(() => window.resonateSing.state().take)), `3: the take — the primary “${b.sing}”, a take for the shell`);
  await page.waitForFunction(() => { const x = window.resonateDebug().ear; return x.res?.kind === 'beats'; }, null, { timeout: 40000 });
  const status = await page.evaluate(() => { clearInterval(window.__poll); return window.__status; });
  ok(!status.some((s) => /count-in|dB|requesting/.test(s)), `3: no count-in, dB or "requesting mic" in #status (${JSON.stringify([...new Set(status)].slice(0, 4))})`);
  e = await ear();
  r = e.res;
  ok(r.counts?.beatsAll && /^In on/.test(r.win?.text || ''), `3: Beats with the click — “${e.ui}”`);
  ok(r.win?.kind === 'entry' && r.onsets?.of === 8 && r.onsets.measured === 8, `3: every start measured (${JSON.stringify(r.onsets)})`);
  // 4. Notes: ■ Stop while the note plays; hold the first target an octave down, the second on pitch
  await page.click('.ear-modes button[data-ear="notes"]');
  b = await btns();
  ok(b.sing === '● Match' && b.caption === 'Hear', `4: Notes — “${b.listen}” (${b.caption}) · “${b.sing}”`);
  await page.evaluate(() => { window.__sing = { mode: 'hold', by: -12 }; });
  await page.click('#sing');
  e = await ear();
  b = await btns();
  ok(e.run === 'notePlay' && b.sing === '■ Stop' && b.listen === '■ Stop' && b.caption === 'Stop' && /Listen…/.test(e.notesUi), `4: the note plays — “${b.listen}” (${b.caption}) · “${b.sing}”, “${e.notesUi}”`);
  ok(await page.evaluate(() => window.resonateSing.state().busy && !window.resonateSing.state().take), '4: the note: busy, not a take');
  await page.waitForFunction(() => window.resonateDebug().ear.run === 'hold', null, { timeout: 10000 });
  ok(await page.evaluate(() => window.resonateSing.state().take), '4: the hold: a take for the shell');
  await page.waitForFunction(() => (window.resonateDebug().ear.notes?.done || []).length >= 1, null, { timeout: 15000 });
  await sleep(900);
  e = await ear();
  ok(/octave down — fine/.test(e.notes?.msg || '') && e.notes.targets.every((k) => k >= 0 && k < 11) && e.notes.js.every((j, i) => j === e.ph.j0 + e.notes.targets[i]), `4: the first target matched an octave down — “${e.notes?.msg}” (targets in the line ${JSON.stringify(e.notes?.targets)})`);
  await page.evaluate(() => { window.__sing = { mode: 'hold', by: 0 }; });
  await page.click('#sing');
  await page.waitForFunction(() => { const x = window.resonateDebug().ear; return (x.notes?.done || []).length >= 2 || x.mode === 'line'; }, null, { timeout: 15000 });
  await sleep(1200);
  e = await ear();
  ok(e.mode === 'line' && /now the phrase/.test(e.res?.win?.text || ''), `4: every target matched → back to the line (“${e.res?.win?.text}”)`);
  await page.evaluate(() => { window.__sing = null; });
  // 5. ⚙: only Ear's switch while it shows
  await page.click('#options-btn');
  const sheet = () => page.evaluate(() => ({ whole: getComputedStyle(document.getElementById('op-whole')).display !== 'none', label: document.querySelector('#guided-on').closest('label').textContent.trim(), on: document.getElementById('guided-on').checked }));
  let o = await sheet();
  ok(o.on && !o.whole && /^Phrase by phrase — by ear$/.test(o.label), `5: ⚙ while Ear shows — “${o.label}” only (the whole song's options hidden: ${!o.whole})`);
  // (turned off while Ear's ▶ Hear plays: it stops — it would play on under the whole song's Listen)
  await page.click('#op-close');
  await page.click('#listen');
  await page.waitForFunction(() => window.resonateDebug().ear.run === 'play', null, { timeout: 5000 });
  await page.click('#options-btn');
  await page.click('#guided-on');
  o = await sheet();
  const after = await page.evaluate(() => ({ run: window.resonateDebug().ear.run, busy: window.resonateSing.state().busy, listen: document.getElementById('listen').textContent }));
  ok(!o.on && o.whole && !(await page.evaluate(() => window.resonateDebug().ear.on)), '5: off — While you sing and Guide back, Ear gone');
  ok(after.run === null && !after.busy && !/■/.test(after.listen), `5: off while ▶ Hear played — it stopped (run ${after.run}, busy ${after.busy}, “${after.listen}”)`);
  await page.click('#guided-on');
  o = await sheet();
  ok(o.on && !o.whole && (await page.evaluate(() => window.resonateDebug().ear.on)), '5: on again — Ear back, the switch alone');
  await page.click('#op-close');
  // 6. another song: its own line, nothing of the last one's; back: the line kept; a reload: the same
  const v = await page.evaluate(() => document.getElementById('version').textContent.trim().replace(/^v/, ''));
  const id2 = await page.evaluate(async ([xml, v]) => (await import(`./library.js?v=${v}`)).addSong('Grace Again', xml), [AG_XML, v]);
  await page.click('#ear-next'); await page.click('#ear-next');
  ok((await ear()).p === 2, '6: line 3 open on Amazing Grace');
  await page.evaluate((id) => window.resonateSing.open(id), id2);
  await page.waitForFunction((id) => window.resonateSing.state().song === id && window.resonateDebug().ear.on, id2, { timeout: 15000 });
  e = await ear();
  ok(e.p === 0 && !e.res && !e.shown && !e.flash && e.mode === 'line' && e.ui === '', `6: another song opens on line 1 with nothing of the last one's (p ${e.p}, “${e.ui}”)`);
  await page.click('.ear-modes button[data-ear="notes"]');
  e = await ear();
  ok(e.notes && e.notes.js.every((j) => j >= e.ph.j0 && j < e.ph.j1) && !e.notes.done.length, `6: its Notes start afresh (${JSON.stringify(e.notes?.targets)})`);
  await page.click('.ear-modes button[data-ear="line"]');
  await page.click('#ear-next');
  await page.evaluate(() => window.resonateSing.open('amazing-grace'));
  await page.waitForFunction(() => window.resonateSing.state().song === 'amazing-grace' && window.resonateDebug().ear.on, null, { timeout: 15000 });
  e = await ear();
  ok(e.p === 2 && e.ph.words === LINES[2][2], `6: back to Amazing Grace: line ${e.p + 1} again (“${e.ph?.words}”)`);
  await page.reload();
  await ready();
  e = await ear();
  ok(e.p === 2, `6: after a reload: line ${e.p + 1}`);
  await page.evaluate((id) => window.resonateSing.open(id), id2);
  await page.waitForFunction((id) => window.resonateSing.state().song === id && window.resonateDebug().ear.on, id2, { timeout: 15000 });
  ok((await ear()).p === 1, `6: and Grace Again's: line ${(await ear()).p + 1}`);
  const stored = await page.evaluate((id) => JSON.parse(localStorage.getItem('resonate.sing.eardata') || '{}')[id], id2);
  const gone = await page.evaluate(async ([id, v]) => { await (await import(`./forget.js?v=${v}`)).forgetSong(id); return !(id in JSON.parse(localStorage.getItem('resonate.sing.eardata') || '{}')); }, [id2, v]);
  ok(stored?.p && gone, `6: kept per song (${JSON.stringify(stored)}), gone with the song`);
  ok(!errs.length, `sing.html: no page errors ${JSON.stringify(errs.slice(0, 3))}`);
  await ctx.close();
}

// --- the shell ----------------------------------------------------------------------------------------
async function shell(browser, dev) {
  const vp = dev === 'phone' ? { width: 390, height: 844 } : { width: 820, height: 1180 };
  console.log(`\n=== the shell: ${dev} ${vp.width}×${vp.height}`);
  const ctx = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => {
    if (location.protocol === 'about:') return;
    try { if (!sessionStorage.getItem('ear')) { sessionStorage.setItem('ear', '1'); localStorage.setItem('resonate.sing.song', 'amazing-grace'); localStorage.setItem('resonate.shell.modules', JSON.stringify({ phone: ['sing'], tablet: ['sing'], desktop: ['sing'] })); } } catch {}
  });
  await ctx.addInitScript(SINGER);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console ' + m.text().slice(0, 200)); });
  await page.goto(BASE + '?open=sing');
  await page.waitForFunction(() => window.resonateSing?.debug?.()?.ear?.on && document.getElementById('ear-words')?.textContent && !window.resonateDebug().song.moving, null, { timeout: 40000 });
  await sleep(600);
  const look = () => page.evaluate(() => {
    const shown = (s) => { const el = document.querySelector(s); return !!el && el.getClientRects().length > 0; };
    const d = window.resonateDebug(), sing = document.querySelector('.dock #sing');
    return { ear: d.song.ear, tuner: shown('#tuner'), home: shown('.home'), hold: d.tuner.hold, live: d.tuner.live, state: window.resonateSing.state(),
      caption: document.querySelector('#listen-w .l').textContent, stop: document.getElementById('listen').hasAttribute('data-stop'), pulse: document.getElementById('listen').hasAttribute('data-pulse'),
      sing: sing.textContent, whole: sing.scrollWidth <= sing.clientWidth + 0.5, words: document.getElementById('ear-words').getBoundingClientRect().top };
  });
  const modeTo = (m) => page.click(`.ear-modes button[data-ear="${m}"]`);
  let L = await look();
  ok(L.ear && !L.tuner && !L.home && L.state.ear, `${dev}: Ear shows — the tuner hidden, its slot too (ear ${L.ear}, tuner ${L.tuner}, slot ${L.home})`);
  ok(L.caption === 'Hear' && L.pulse && L.sing === '● Sing' && L.whole, `${dev}: the dock — ▶ “${L.caption}” (pulsing), “${L.sing}” whole`);
  // the labels, every mode (idle)
  const labels = [];
  for (const m of ['beats', 'notes', 'line']) { await modeTo(m); await sleep(100); L = await look(); labels.push([m, L.caption, L.sing, L.whole]); }
  ok(labels.every(([m, c, s, w]) => c === 'Hear' && w && s === { line: '● Sing', beats: '● Sing', notes: '● Match' }[m]), `${dev}: idle in each mode — ${labels.map(([m, c, s, w]) => `${m}: ${c} · “${s}”${w ? '' : ' (cut)'}`).join(', ')}`);
  // ▶ Hear: Stop while it plays; no pulse after
  await page.click('#listen');
  await sleep(300);
  L = await look();
  ok(L.caption === 'Stop' && L.stop && L.state.busy && !L.state.take && L.hold === 'paused', `${dev}: ▶ Hear plays — “${L.caption}”, busy (the tuner ${L.hold}), not a take`);
  await page.click('#listen');
  await page.waitForFunction(() => window.resonateSing.debug().ear.run === null, null, { timeout: 5000 });
  await sleep(200);
  L = await look();
  ok(L.caption === 'Hear' && !L.pulse && !L.state.busy, `${dev}: stopped — “${L.caption}”, heard: no pulse`);
  // a free attempt: a take — the tuner holds "take", its mic off, still hidden
  await page.click('#sing');
  await page.waitForFunction(() => window.resonateSing.debug().ear.run === 'free', null, { timeout: 5000 });
  L = await look();
  const opening = L;
  await page.waitForFunction(() => document.querySelector('.dock #sing').textContent === '■ Done', null, { timeout: 10000 });
  await page.evaluate(() => { window.__sing = { mode: 'free', at: performance.now() + 500, f: 1 }; });
  await sleep(1500);
  L = await look();
  ok(L.state.take && L.state.busy && L.hold === 'take' && !L.live && !L.tuner && !L.home, `${dev}: during a free attempt — state().take ${L.state.take}, the tuner holds “${L.hold}”, its mic ${L.live ? 'live' : 'off'}, hidden`);
  ok(opening.whole && L.whole && L.caption === 'Hear' && ['Mic…', '■ Done'].includes(opening.sing) && L.sing === '■ Done', `${dev}: the attempt's labels whole — “${opening.sing}” → “${L.sing}”, ▶ “${L.caption}”`);
  const dur = await page.evaluate(() => { const d = window.resonateSing.debug(); const a = d.ear.ph.j0, z = d.ear.ph.j1; return d.notes[z - 1].t + d.notes[z - 1].d - d.notes[a].t; });
  await sleep(dur * 1000 + 300);
  await page.click('.dock #sing');
  await page.waitForFunction(() => { const x = window.resonateSing.debug().ear; return x.res && x.run === null; }, null, { timeout: 15000 });
  await page.evaluate(() => { window.__sing = null; });
  await sleep(300);
  L = await look();
  const res = await page.evaluate(() => window.resonateSing.debug().ear.res);
  ok(res?.counts?.notesAll && !L.state.take && !L.state.busy && !L.hold && !L.tuner, `${dev}: judged (♪ ${res?.counts?.notesAll ? 'all' : res?.counts?.notes}) — no take any more, the tuner still hidden`);
  if (dev === 'phone') {
    // Beats: ● Sing → ■ Stop (cut short here), Notes: ● Match → ■ Stop while the note plays
    await modeTo('beats');
    await page.click('.dock #sing');
    await page.waitForFunction(() => window.resonateSing.debug().session?.kind === 'sing', null, { timeout: 10000 });
    await page.waitForFunction(() => window.resonateDebug().tuner.hold === 'take', null, { timeout: 2000 }).catch(() => {}); // (songview follows every 100 ms)
    L = await look();
    ok(L.sing === '■ Stop' && L.whole && L.state.take && L.hold === 'take', `${dev}: a Beats take — “${L.sing}”, the tuner holds “${L.hold}”`);
    // (the round ▶ in the middle of it: the take ends, uncounted, and the line plays with the click)
    await sleep(600);
    await page.click('#listen');
    await page.waitForFunction(() => { const d = window.resonateSing.debug(); return d.ear.run === 'play' && !d.session; }, null, { timeout: 8000 }).catch(() => {});
    const bt = await page.evaluate(() => { const d = window.resonateSing.debug(); return { run: d.ear.run, flash: d.ear.flash, res: d.ear.res, ui: document.getElementById('ear-res').innerText.trim(), hints: d.ear.hints }; });
    L = await look();
    ok(bt.run === 'play' && bt.flash === 'Stopped — not counted' && bt.ui === 'Stopped — not counted' && !bt.res && !bt.hints.beats && !L.state.take && L.caption === 'Stop', `${dev}: ▶ in a Beats take — “${bt.ui}”, the line plays with the click (run ${bt.run}), nothing judged`);
    await page.click('#listen');
    await page.waitForFunction(() => !window.resonateSing.debug().session && !window.resonateSing.state().busy, null, { timeout: 10000 });
    await modeTo('notes');
    await page.click('.dock #sing');
    L = await look();
    ok(L.sing === '■ Stop' && L.caption === 'Stop' && L.whole, `${dev}: Notes, the note playing — “${L.caption}” · “${L.sing}”`);
    await page.click('#listen');
    await page.waitForFunction(() => window.resonateSing.debug().ear.run === null, null, { timeout: 5000 });
    L = await look();
    ok(L.sing === '● Match' && L.caption === 'Hear', `${dev}: the round ■ stops it — “${L.caption}” · “${L.sing}”`);
    await modeTo('line');
    // ⚙ off: the tuner back; on: hidden again
    await page.click('#options-btn');
    await page.click('#guided-on');
    await page.click('#op-close');
    await sleep(400);
    L = await look();
    ok(!L.ear && L.tuner && !L.state.ear && L.caption === 'Listen', `${dev}: ⚙ Phrase by phrase off — the tuner back (${L.tuner}), the caption “${L.caption}”`);
    await page.click('#options-btn');
    await page.click('#guided-on');
    await page.click('#op-close');
    await sleep(400);
    L = await look();
    ok(L.ear && !L.tuner && L.caption === 'Hear', `${dev}: on again — the tuner hidden, “${L.caption}”`);
    // the song closed: the tuner back, full
    await page.click('#song-close');
    await page.waitForFunction(() => { const s = window.resonateDebug().song; return !s.open && !s.moving && !s.closing; }, null, { timeout: 10000 });
    L = await look();
    ok(!L.ear && L.tuner, `${dev}: the song closed — the full tuner back`);
  }
  ok(!errs.length, `${dev}: no page errors ${JSON.stringify(errs.slice(0, 3))}`);
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  if (!ONLY || ONLY === 'page') await singPage(browser);
  if (!ONLY || ONLY === 'phone') await shell(browser, 'phone');
  if (!ONLY || ONLY === 'ipad') await shell(browser, 'ipad');
  await browser.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
