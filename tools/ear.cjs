// Ear (E8 prototype, sing.js "Ear", ear.js; docs/EAR.md) with a simulated singer (a sawtooth through a fake
// getUserMedia: tools/lib/earsinger.cjs, the probes' singer), on Amazing Grace, indices in the line.
// sing.html (the shell mounts the same page):
//   0 the lines are the printed lines (the fix plan's WP1.12, Q-A): Amazing Grace's four hymn lines; ▶ pulses
//   1 the free attempt — on its own time, 15 % slower, its 3rd note 2 semitones flat: the tempo found
//     (within 6 %), ♪ one short with the cue on that note ("· higher"), ♩ 7 or more, an answer in < 1.5 s
//   1b the tune right 3 semitones down (WP2): "The tune was right", "Started lower than the piano", no ♪, key −3;
//     ♩ from the starts; judged in ≤ 400 ms
//   1c line 3 (a same-pitch repeat: “once was” on E♭5s), 20 % slower, every note right: all of them, no cue
//   1d line 4, its last note (“see.”, 6 s) let go after 1.5 s, ■ Done tapped while it still sounds: all of them
//   2 again, 10 % faster, every note right: "♩ all of them · ♪ all of them" — ● Sing tapped as ▶ First note ends:
//     the attempt keeps the note's tail out (gated at MIN_RMS until it's gone: the fix plan's rule 1)
//   2b Line → Notes → Line: that result again, dimmed under "Last time" (WP1.9)
//   2c ▶ First note, then the dock's ▶, in the middle of an attempt (the song, key, tempo and ⚙ locked): it
//     ends, uncounted — "Stopped — not counted", nothing stored, the note / the line plays (WP1.6), the mic's
//     tracks stopped and the session "playback" before the piano starts (iOS: quiet under a live capture)
//   3 Beats (WP3) — ▶ First note there too; ▶ Hear counts in as ● Sing does (a bar, the pickup's missing beats),
//     its count-in row lit as it plays; ● Sing with the click: the row lit from the take's clock (each dot on its
//     click, the word at the entry), then the level ring moving (neutral, not green), 🎧 the first time (a touch
//     device); on the click: "all of them", "Spot on with the click", ▶ You; 0.3 s late every note: "Behind the
//     click — sing right on it" with ▶ Click and ▶ You, which play — ▶ You with the take's own clicks after the ♩
//     menu changed; ■ Stop in the count-in: the row gone at once, a double tap doesn't sing again; no count-in or dB
//     in #status (WP1.3–4)
//   4 Notes (WP4) — a Line attempt with “sweet” a tone sharp, its "Practise that note ›" (tapped while ▶ Hear plays: it
//     stops): Notes on A♭4, "Off last time", the row low → high with the syllable under each and “sweet” marked;
//     ● Match: "■ Stop" on both buttons
//     while the note plays (WP1.7), "Now sing it — keep it going" and the ring's arc emptying (neutral); a tone sharp:
//     "Not yet" with a real ▶ Try again, then "Lower", then ▶ Sing along (4 s, no live mic) · Next note ›; E♭4 an
//     octave down: "✓ Same note, in your lower voice" (green), EAR.oct −12, the note again and Line's ▶ Hear an
//     octave down, "Octave down" pressed; C5 a tone flat ×3: "Too high for now?" [Lower the song] → the key −2, "Key
//     A♭ → G♭"; every target held: stays in Notes, "✓ Those notes — now the whole line", ● Sing → Line with the mic
//     open; the octave chip toggles back; “sweet” off again in the line: Notes on it again ("Off last time", not held),
//     and still after an attempt Ear couldn't follow
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
      if (window.__watch) window.__atStart.push({ live: window.__tracks.filter((t) => t.readyState === 'live').length, session: navigator.audioSession?.type, when: a[0] ?? 0, rate: this.playbackRate?.value });
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
  // (WP5: the hint under the tabs — shown, its words, its line kept while quiet; ▶ First note's top; the result's
  // words as ear.js earText gives them, and the syllables underlined on screen)
  const hintOf = () => page.evaluate(() => { const h = document.getElementById('ear-hint'); return { on: !h.hidden, text: h.hidden || h.hasAttribute('data-quiet') ? '' : h.textContent, h: h.getBoundingClientRect().height }; });
  const firstTop = () => page.evaluate(() => document.querySelector('#ear-acts button[data-act="first"]')?.getBoundingClientRect().top ?? null);
  const shownU = () => page.$$eval('#ear-res u', (xs) => xs.map((x) => x.textContent));
  const idle = () => page.waitForFunction(() => { const d = window.resonateDebug(); return d.ear.run === null && !d.session; }, null, { timeout: 20000 });
  // 0. the lines
  let e = await ear();
  const lines = e.lines.map((l) => [l.j0, l.j1, l.words]);
  ok(JSON.stringify(lines) === JSON.stringify(LINES), `0: the printed lines — ${lines.map((l) => `${l[0]}–${l[1] - 1} “${l[2]}”`).join(' / ')}`);
  ok(e.p === 0 && e.mode === 'line' && (await page.textContent('.ear-modes button[aria-pressed="true"]')) === 'Line', `0: line 1 open, the Line tab (${e.mode}; the tabs “${(await page.textContent('.ear-modes')).trim().split(/\s+/).join(' · ')}”)`);
  let b = await btns();
  ok(b.pulse && b.caption === 'Hear' && b.listen === '▶ Hear' && b.sing === '● Sing', `0: ▶ pulses (hear it first), the dock “${b.listen}” (${b.caption}) · “${b.sing}”`);
  let hint = await hintOf();
  ok(hint.on && hint.text === '▶ Hear it first' && e.hint === '▶ Hear it first', `0: the hint — “${hint.text}”`);
  const top0 = await firstTop();
  // (the speed: Normal pressed — the ♩ menu at the song's own tempo)
  const speedRow = () => page.$$eval('#ear-acts .ear-speed button', (xs) => xs.map((x) => `${x.textContent}${x.getAttribute('aria-pressed') === 'true' ? '*' : ''}`).join(' '));
  ok((await speedRow()) === 'Normal* Slow Slower' && e.speed === 1, `0: the action row's speed — ${await speedRow()}`);
  await page.click('#listen');
  await page.waitForFunction(() => window.resonateDebug().ear.run === 'play', null, { timeout: 5000 });
  hint = await hintOf();
  ok(hint.text === 'Now ● Sing — at your own speed' && !(await btns()).pulse, `0: ▶ Hear — the hint “${hint.text}”, ▶ no longer pulses`);
  await page.click('#listen'); // (■ Stop)
  await page.waitForFunction(() => window.resonateDebug().ear.run === null, null, { timeout: 5000 });
  // 1. the free attempt: 1.5 s after the tap, 15% slower, the 3rd note flat
  await page.click('#sing');
  await page.waitForFunction(() => document.getElementById('sing').textContent === '■ Done', null, { timeout: 10000 });
  await page.evaluate(() => { window.__sing = { mode: 'free', at: performance.now() + 1500, f: 1.15, cents: { 2: -200 } }; });
  const dur = await page.evaluate(() => { const d = window.resonateDebug(); const a = d.ear.ph.j0, z = d.ear.ph.j1; return d.notes[z - 1].t + d.notes[z - 1].d - d.notes[a].t; });
  b = await btns();
  ok(!b.pulse && !b.listenOff && b.caption === 'Hear', `1: listening — ▶ not pulsing, enabled (it ends the attempt, uncounted): “${b.listen}”, the primary “${b.sing}”`);
  await sleep(300);
  const ring = await page.evaluate(() => ({ t: document.querySelector('#ear-ring .ear-ring-t')?.textContent, h: document.querySelector('#ear-ring .ear-ring-hint')?.textContent, shown: !document.getElementById('ear-ring').hidden }));
  hint = await hintOf();
  const top1 = await firstTop();
  ok(ring.shown && ring.t === 'Sing' && ring.h === 'Tap ■ Done at the end', `1: ready — “${ring.t}” in the ring, “${ring.h}” under it`);
  ok(hint.on && !hint.text && hint.h > 10 && Math.abs(top1 - top0) <= 2, `1: the hint quiet, its line kept (${hint.h.toFixed(0)} px); ▶ First note where it was (${top0.toFixed(1)} → ${top1.toFixed(1)})`);
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
  // (WP5: the words — the cue naming the whole word with its syllable underlined, ▶ Piano · ▶ You, Practise that note ›,
  // the counts with their units, the singer's tempo; nothing a grade)
  let w = (await ear()).words;
  const top2 = await firstTop();
  ok(w.cue === '“Amazing” — aim higher' && JSON.stringify(await shownU()) === '["ma"]' && JSON.stringify(w.u) === '["ma"]', `1: the cue — “${w.cue}”, underlined ${JSON.stringify(await shownU())}`);
  ok(w.sounds.join(' · ') === '▶ Piano · ▶ You' && w.next === 'Practise that note ›', `1: its ▶s ${w.sounds.join(' · ')}, next “${w.next}”`);
  ok(w.counts.every((c) => /^[♩♪] (all|[1-9]\d*) (on the beat|in tune)$/.test(c)) && w.counts.length === 2 && /^You sang it at ♩=(6[6-9]|7[0-3])$/.test(w.tempo || ''), `1: the counts ${JSON.stringify(w.counts)}, “${w.tempo}” (sung ×1.15 of ♩=80)`);
  ok(Math.abs(top2 - top0) <= 2, `1: ▶ First note where it was with the result (${top0.toFixed(1)} → ${top2.toFixed(1)})`);
  const grade = (await ear()).ui;
  ok(!/—\s*(·|$)|(^|\s)0(\s|$)|↑|%|\//.test(grade), `1: nothing grade-like on screen (“${grade}”)`);
  ok(ms < 1500, `1: the answer in ${ms} ms`);
  ok(!(await page.evaluate(() => getComputedStyle(document.getElementById('lane')).display !== 'none')), '1: no lane shown');
  ok(!(await btns()).pulse && (await ear()).hints.line === 1, `1: sung — ▶ no longer pulses; the device's Line attempts: ${(await ear()).hints.line}`);
  // 1b. the tune right, 3 semitones down (another key — WP2 rule 3): its own words, no ♪, the key it was in
  // (■ Done 0.8 s after the line's written end at the plan's speed — or `doneIn` s after its last note starts)
  const attempt = async (plan, lead = 900, doneIn = null) => {
    await page.click('#sing');
    await page.waitForFunction(() => document.getElementById('sing').textContent === '■ Done', null, { timeout: 10000 });
    await page.evaluate(([p, w]) => { window.__sing = { ...p, mode: 'free', at: performance.now() + w }; }, [plan, lead]);
    const [d, dl] = await page.evaluate(() => { const x = window.resonateDebug(); const a = x.ear.ph.j0, z = x.ear.ph.j1; return [x.notes[z - 1].t + x.notes[z - 1].d - x.notes[a].t, x.notes[z - 1].t - x.notes[a].t]; });
    await sleep(lead + (doneIn != null ? (dl * (plan.f || 1) + doneIn) * 1000 : d * (plan.f || 1) * 1000 + 800));
    await page.click('#sing');
    await page.waitForFunction(() => { const x = window.resonateDebug().ear; return x.res && x.run === null; }, null, { timeout: 15000 });
    await page.evaluate(() => { window.__sing = null; });
    return ear();
  };
  e = await attempt({ all: -300 });
  r = e.res;
  ok(r.key?.kind === 'key' && r.key.s === -3 && r.counts?.notes === null && r.win?.kind === 'key' && r.cue?.kind === 'key' && r.cue.dir === 'lower', `1b: 3 semitones down — key ${JSON.stringify(r.key)}, ♪ ${r.counts?.notes}, win ${r.win?.kind}, cue ${r.cue?.kind} ${r.cue?.dir}`);
  ok(/The tune was right/.test(e.ui) && /lower than the piano/.test(e.ui) && !/in tune/.test(e.ui) && e.words.sounds.join(' · ') === '▶ You · Lower the song' && !e.words.next, `1b: on screen — “${e.ui}”, ${JSON.stringify(e.words.sounds)}`);
  ok(r.counts?.beatsAll && r.onsets?.measured >= 4, `1b: ♩ judged from the starts all the same (${JSON.stringify(r.onsets)}, ♩ ${r.counts?.beatsAll ? 'all' : r.counts?.beats})`);
  ok(typeof r.ms === 'number' && r.ms <= 400, `1b: judged in ${r.ms} ms (two fits: at 0 and at the offset)`);
  // (Lower the song: the Key menu −3 — "Key A♭ → F" in the result's place, that result gone with the old key, ▶ Hear it
  // first again; back in the written key, the result there again — dimmed)
  await page.click('#ear-res button[data-act="cue-key"]');
  await sleep(300);
  e = await ear();
  hint = await hintOf();
  const keyNow = await page.evaluate(() => document.getElementById('key-select').value);
  ok(keyNow === '-3' && e.fact === 'Key A♭ → F' && e.ui === 'Key A♭ → F' && !e.shown && hint.text === '▶ Hear it first' && (await btns()).pulse, `1b: Lower the song — Key ${keyNow}, “${e.ui}”, the hint “${hint.text}” and ▶ pulsing again`);
  await page.evaluate(() => { const x = document.getElementById('key-select'); x.value = '0'; x.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(300);
  e = await ear();
  ok(e.shown?.old && e.shown.res.key?.s === -3 && /The tune was right/.test(e.ui), `1b: the written key again — that attempt's result, dimmed (“${e.ui}”)`);
  // 1c. line 3 (“I once was lost…”: three E♭5s running — a same-pitch repeat), 20 % slower, every note right
  await page.click('#ear-next'); await page.click('#ear-next');
  hint = await hintOf();
  ok(hint.on && hint.text === '▶ Hear it first' && (await ear()).hints.line === 2, `1c: another line, not heard yet — “${hint.text}” again (2 Line attempts on this device)`);
  const topL3 = await firstTop();
  e = await attempt({ f: 1.2 });
  r = e.res;
  ok(e.p === 2 && r.counts?.notesAll && r.counts?.beatsAll && r.win?.kind === 'spot' && !r.cue, `1c: line 3 at its own speed, all right — “${e.ui}” (b ${r.fit?.b?.toFixed(2)}, onsets ${JSON.stringify(r.onsets)})`);
  // (the 3rd Line attempt retires Line's hint: its line stays, quiet — the result doesn't come with a jump)
  hint = await hintOf();
  const top3 = await firstTop();
  ok(hint.on && !hint.text && Math.abs(top3 - topL3) <= 2, `1c: the hint retired with this result — its line kept, quiet; ▶ First note where it was (${topL3.toFixed(1)} → ${top3.toFixed(1)})`);
  // 1d. line 4: “see.” (6 s written) let go after 1.5 s, ■ Done while it still sounds — in free time the singer ends
  // the line: that note is sung, not missed (it read ♩ 5 · ♪ 8 with nothing to fix)
  await page.click('#ear-next');
  hint = await hintOf();
  ok(hint.on && !hint.text && (await ear()).hints.line === 3 && !(await btns()).pulse, `1d: after 3 Line attempts the hint says nothing on a line not heard, ▶ doesn't pulse; its line kept this visit (${JSON.stringify(hint)})`);
  e = await attempt({ held: 1.5 }, 900, 1.4);
  r = e.res;
  ok(e.p === 3 && r.counts?.notesAll && r.counts?.beatsAll && r.win?.kind === 'spot' && !r.cue && Math.abs(r.fit?.b - 1) < 0.04, `1d: line 4, its long last note let go early and ■ Done while it sounds — “${e.ui}” (b ${r.fit?.b?.toFixed(2)})`);
  await page.click('#ear-prev'); await page.click('#ear-prev'); await page.click('#ear-prev');
  // 2. again, all right → all of them; ● Sing tapped the moment ▶ First note has played: its tail kept out
  await page.evaluate(() => { window.__sing = null; });
  await page.click('#ear-acts button[data-act="first"]');
  await page.waitForFunction(() => document.getElementById('listen').textContent === '■ Stop', null, { timeout: 5000 });
  await page.waitForFunction(() => document.getElementById('listen').textContent === '▶ Hear', null, { timeout: 5000, polling: 10 });
  await page.click('#sing');
  await page.waitForFunction(() => document.getElementById('sing').textContent === '■ Done', null, { timeout: 10000 });
  const gate = (await ear()).gate;
  ok(gate > 0.2 && gate < 2, `2: ● Sing right after ▶ First note — its tail kept out of the attempt until ${gate?.toFixed(2)} s`);
  await page.evaluate(() => { window.__sing = { mode: 'free', at: performance.now() + 900, f: 0.9 }; });
  await sleep(900 + dur * 0.9 * 1000 + 800);
  await page.click('#sing');
  await page.waitForFunction(() => { const x = window.resonateDebug().ear; return x.res && x.run === null; }, null, { timeout: 15000 });
  e = await ear();
  r = e.res;
  ok(r.counts?.notesAll && r.counts?.beatsAll && /all on the beat.*all in tune/.test(e.ui) && !e.old, `2: every note right — “${e.ui}”`);
  ok(e.words.win === '✓ Spot on' || e.words.win === '✓ Spot on — twice running', `2: “${e.words.win}”, ${JSON.stringify(e.words.sounds)}, next “${e.words.next}”`);
  ok(e.words.sounds.join() === '▶ You' && e.words.next === 'Next line ›', `2: ▶ You in the result, “Next line ›”`);
  await page.click('#ear-res button[data-act="nextline"]');
  e = await ear();
  ok(e.p === 1 && e.run === null && e.mode === 'line', `2: “Next line ›” — line ${e.p + 1}, nothing started`);
  await page.click('#ear-prev');
  const nLine = e.hints.line;
  // 2b. Line → Notes → Line: the result kept, dimmed under "Last time"
  await page.click('.ear-modes button[data-ear="notes"]');
  await page.click('.ear-modes button[data-ear="line"]');
  e = await ear();
  ok(e.shown?.old && e.old && /^Last time \| .*all on the beat.*all in tune/.test(e.ui) && e.shown.res.counts?.notesAll && !(await page.$('#ear-res button')), `2b: Line → Notes → Line: the last result, dimmed, no chips — “${e.ui}”`);
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
    ok(e.hints.line === nLine && JSON.stringify(e.shown?.res ?? null) === kept && !(await page.evaluate(() => window.resonateDebug().session)), `2c: ${what}: nothing judged or stored (the device's attempts ${e.hints.line}, the result kept)`);
    await page.evaluate(() => { window.__sing = null; });
    await idle();
  }
  e = await ear();
  ok(e.flash && /Stopped/.test(e.ui), `2c: after it played: “${e.ui}”`);
  // 3. Beats: ▶ First note there too; ▶ Hear counts in as ● Sing does, its row lit as it plays (WP3.3–4, 6)
  await page.evaluate(() => { window.__sing = null; });
  await page.click('.ear-modes button[data-ear="beats"]');
  e = await ear();
  b = await btns();
  const acts = await page.$$eval('#ear-acts button', (xs) => xs.map((x) => x.textContent));
  ok(!e.flash && !e.shown && b.sing === '● Sing' && b.caption === 'Hear' && JSON.stringify(acts) === '["▶ First note","Normal","Slow","Slower"]', `3: Beats — “${b.listen}” (${b.caption}) · “${b.sing}”, no result yet, the action row ${JSON.stringify(acts)}`);
  ok(e.hint === 'Sing along with the clicks', `3: the hint — “${e.hint}”`);
  // (the count-in row, sampled every 20 ms: its state, the clock it's lit from, the ring's level)
  const watch = () => page.evaluate(() => { window.__rows = []; window.__poll = setInterval(() => { const d = window.resonateDebug(), c = d.ear.count, ring = document.querySelector('#ear-ring'); window.__rows.push({ nowT: d.nowT, c: c && { lit: c.lit, wordOn: c.wordOn, gone: c.gone, shown: c.shown, play: c.play }, ring: !!ring && !ring.hidden, lv: Number(document.querySelector('.ear-ring')?.style.getPropertyValue('--lv') || 0), status: document.getElementById('status').textContent }); }, 20); });
  const unwatch = () => page.evaluate(() => { clearInterval(window.__poll); return window.__rows; });
  // the row's clicks against the clock: each dot lit on its click (not before it, at most 0.25 s after), in order;
  // the word lit at the entry, not before
  const rowOk = (rows, cl, entry, clock) => {
    const at = (i) => rows.find((r) => r.c && r.c.lit >= i);
    const lits = cl.map((_, i) => at(i)), w = rows.find((r) => r.c?.wordOn);
    const order = rows.filter((r) => r.c).every((r, i, xs) => !i || r.c.lit >= xs[i - 1].c.lit);
    const timely = lits.every((r, i) => r && clock(r) - cl[i].t >= -0.02 && clock(r) - cl[i].t <= 0.25);
    return { ok: order && timely && !!w && clock(w) >= entry - 0.02 && clock(w) - entry <= 0.25 && lits.every((r) => !r.c.wordOn), got: lits.map((r, i) => r ? +(clock(r) - cl[i].t).toFixed(3) : null), word: w ? +(clock(w) - entry).toFixed(3) : null };
  };
  let cnt = (await ear()).count;
  ok(!cnt, '3: no row before a take or ▶ Hear');
  await watch();
  await page.click('#listen');
  await page.waitForFunction(() => window.resonateDebug().ear.count?.wordOn, null, { timeout: 15000 });
  await sleep(300);
  let rows = await unwatch();
  cnt = (await ear()).count;
  const bars = await page.$$eval('#ear-count .ec-bar', (xs) => xs.map((x) => [...x.children].map((c) => (c.classList.contains('ec-word') ? c.textContent : c.hasAttribute('data-big') ? 'B' : 'b')).join(' ')));
  ok(cnt?.play && cnt.shown && cnt.clicks.length === 5 && JSON.stringify(bars) === JSON.stringify(['B b b', 'B b Amazing']), `3: ▶ Hear in Beats — the count-in row: ${JSON.stringify(bars)} (a bar, then the pickup's missing beats, as ● Sing counts in), shown while it plays`);
  const hearLits = rows.filter((r) => r.c).map((r) => r.c.lit);
  ok(hearLits.length && hearLits.every((x, i) => !i || x >= hearLits[i - 1]) && hearLits[hearLits.length - 1] === 4 && rows.some((r) => r.c?.wordOn), `3: ▶ Hear — the dots lit in order (${[...new Set(hearLits)].join(',')}), then the word`);
  await page.click('#listen'); // (■ Stop)
  await idle();
  ok(!(await ear()).count && (await page.$eval('#ear-count', (x) => x.hidden)), '3: ▶ Hear stopped — the row goes');
  // ● Sing on the click: the row lit from the take's clock until its word has been sung, then the level ring; the
  // first time on a touch device, 🎧
  await page.evaluate(() => { window.__sing = { mode: 'beats' }; });
  await page.evaluate(() => { window.__status = []; window.__spoll = setInterval(() => { const s = document.getElementById('status').textContent; if (s) window.__status.push(s); }, 50); });
  await watch();
  await page.click('#sing');
  await page.waitForFunction(() => window.resonateDebug().session?.kind === 'sing', null, { timeout: 10000 });
  b = await btns();
  e = await ear();
  ok(b.sing === '■ Stop' && (await page.evaluate(() => window.resonateSing.state().take)), `3: the take — the primary “${b.sing}”, a take for the shell`);
  ok(e.tip && (await page.$eval('#ear-tip', (x) => !x.hidden && /headphones/.test(x.textContent))) && e.hints.phones === 1, `3: 🎧 on the first Beats take (a touch device): “${await page.textContent('#ear-tip')}”`);
  const cl = e.count.clicks, entry = e.count.entry;
  await page.waitForFunction(() => { const x = window.resonateDebug().ear; return x.res?.kind === 'beats'; }, null, { timeout: 40000 });
  rows = await unwatch();
  const status = await page.evaluate(() => { clearInterval(window.__spoll); return window.__status; });
  ok(!status.some((x) => /count-in|dB|requesting/.test(x)), `3: no count-in, dB or "requesting mic" in #status (${JSON.stringify([...new Set(status)].slice(0, 4))})`);
  // (the take's clock: nowT, the song as scheduled — the row reads it less the output's latency)
  const ro = rowOk(rows, cl, entry, (r) => r.nowT);
  ok(ro.ok && rows.some((r) => r.c?.shown), `3: the row lit in order from the take's clock — each dot ${JSON.stringify(ro.got)} s after its click, the word ${ro.word} s after the entry`);
  const singing = rows.filter((r) => r.nowT > entry + 1.5 && r.nowT < entry + 6);
  const lvs = singing.map((r) => r.lv);
  ok(singing.length && singing.every((r) => r.ring && !r.c?.shown) && Math.max(...lvs) > 0.3 && Math.min(...lvs) < Math.max(...lvs) - 0.05, `3: then the level ring, moving with the singing (--lv ${Math.min(...lvs).toFixed(2)}…${Math.max(...lvs).toFixed(2)})`);
  ok(!rows.some((r) => r.c?.shown && r.ring), '3: the row and the ring never both');
  const ringColor = await page.evaluate(() => { const d = document.createElement('div'); d.className = 'ear-ring'; d.style.setProperty('--lv', '1'); document.getElementById('ear-ring').append(d); const c = getComputedStyle(d).boxShadow; d.remove(); return c; });
  ok(/rgba\(255, 255, 255, 0\.25\)/.test(ringColor), `3: the ring is neutral, not the win's green (${ringColor})`);
  e = await ear();
  r = e.res;
  ok(r.counts?.beatsAll && r.win?.kind === 'spot' && /all on the click/.test(e.ui) && /✓ Spot on with the click/.test(e.ui) && !r.cue, `3: on the click — “${e.ui}”`);
  ok(r.onsets?.of === 8 && r.onsets.measured === 8 && Object.values(r.starts).every((x) => x.on && Math.abs(x.dev) < 0.08), `3: every start measured, each on its click (${JSON.stringify(r.onsets)}; dev ${Object.values(r.starts).map((x) => x.dev).join(' ')})`);
  ok(e.tip && !e.count, '3: 🎧 stays with its result; the row is gone');
  const actsAll = await page.$$eval('#ear-res .ear-chips button, #ear-res .ear-next button', (xs) => xs.map((x) => x.textContent));
  ok(JSON.stringify(actsAll) === '["▶ You","Now on your own ›"]', `3: all on the click — ▶ You, then “Now on your own ›” (${JSON.stringify(actsAll)})`);
  // behind the click (0.3 s late every note): said, with ▶ Click and ▶ You; 🎧 once only
  await page.evaluate(() => { window.__sing = { mode: 'beats', late: 0.3 }; });
  await page.click('#sing');
  await page.waitForFunction(() => window.resonateDebug().session?.kind === 'sing', null, { timeout: 10000 });
  e = await ear();
  ok(!e.tip && (await page.$eval('#ear-tip', (x) => x.hidden)), '3: 🎧 not again');
  await page.waitForFunction(() => { const x = window.resonateDebug().ear; return x.res?.kind === 'beats' && !window.resonateDebug().session; }, null, { timeout: 40000 });
  await page.evaluate(() => { window.__sing = null; });
  e = await ear();
  r = e.res;
  const chips = await page.$$eval('#ear-res .ear-chips button', (xs) => xs.map((x) => x.textContent));
  ok(r.cue?.kind === 'steady' && r.cue.dir === 'sooner' && !r.counts?.beatsAll && /Behind the click — sing right on it/.test(e.ui) && JSON.stringify(chips) === '["▶ Click","▶ You"]', `3: 0.3 s late on every note — “${e.ui}” ${JSON.stringify(chips)} (dev ${Object.values(r.starts).map((x) => x.dev).join(' ')})`);
  ok(!/all on the click/.test(e.ui) && !/Spot on|Came in on time/.test(e.ui) && !(await page.$('#ear-res .ear-next')), '3: no “all on the click”, no win for the timing, no next chip');
  // ▶ Click: the melody and the click over the cue's stretch; ▶ You: the take there with the click
  for (const [chip, act] of [['▶ Click', 'cue-click'], ['▶ You', 'cue-you']]) {
    await page.evaluate(() => { window.__atStart = []; window.__watch = true; });
    await page.click(`#ear-res button[data-act="${act}"]`);
    await page.waitForFunction(() => window.resonateDebug().ear.run === 'play', null, { timeout: 5000 });
    await sleep(700);
    const n = await page.evaluate(() => window.__atStart.length);
    await idle();
    await page.evaluate(() => { window.__watch = false; });
    e = await ear();
    ok(n >= 2 && !e.flash && e.res?.cue?.kind === 'steady', `3: ${chip} plays (${n} sources started in 0.7 s) and stops by itself, the result kept`);
  }
  // ▶ You plays the take with the clicks it was sung to: the ♩ menu changed since doesn't move them
  const takeClicks = e.res.clicks.map((c) => c.t);
  const setRate = (v) => page.evaluate((x) => { const sel = document.getElementById('tempo-select'); sel.value = x; sel.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  await setRate('r:0.8');
  await sleep(300);
  await page.click('#ear-res button[data-act="cue-you"]');
  await page.waitForFunction(() => window.resonateDebug().ear.run === 'play', null, { timeout: 5000 });
  const you = (await ear()).you || [];
  await page.click('#listen'); // (■ Stop)
  await idle();
  await setRate('r:1');
  await sleep(300);
  const gaps = you.slice(1).map((t, i) => +(t - you[i]).toFixed(3));
  ok(you.length >= 3 && you.every((t) => takeClicks.some((c) => Math.abs(c - t) < 1e-6)) && gaps.every((g) => Math.abs(g - 0.75) < 0.01), `3: ▶ You after the ♩ menu went to 80 % — the take's own clicks ${JSON.stringify(you)} (a beat apart at the take's ♩=80: ${JSON.stringify(gaps)})`);
  // ■ Stop in the count-in: the take ends, not judged, and its row goes with it at once; a second tap right after
  // it doesn't sing again
  await page.evaluate(() => { window.__sing = null; });
  await page.click('#sing');
  await page.waitForFunction(() => window.resonateDebug().session?.kind === 'sing' && window.resonateDebug().ear.count?.lit >= 0, null, { timeout: 10000 });
  await page.click('#sing'); // (■ Stop)
  await sleep(100);
  const rowGone = await page.evaluate(() => ({ hidden: document.getElementById('ear-count').hidden, count: window.resonateDebug().ear.count }));
  await page.click('#sing'); // (a double tap)
  await sleep(600);
  const again = await page.evaluate(() => ({ session: !!window.resonateDebug().session, take: window.resonateSing.state().take }));
  await idle();
  e = await ear();
  ok(rowGone.hidden && !rowGone.count && !again.session && !again.take && e.res?.cue?.kind === 'steady' && (await page.$eval('#ear-count', (x) => x.hidden)), `3: ■ Stop in the count-in — the row gone at once (${JSON.stringify(rowGone)}), a double tap doesn't sing again (${JSON.stringify(again)}), the last result kept`);
  // line 2 comes in on beat 3: the count-in bar, then its own bar's two beats, then “That”
  await page.click('#ear-next');
  await page.click('#listen');
  await page.waitForFunction(() => window.resonateDebug().ear.count?.play && document.querySelector('#ear-count .ec-word'), null, { timeout: 5000 });
  const bars2 = await page.$$eval('#ear-count .ec-bar', (xs) => xs.map((x) => [...x.children].map((c) => (c.classList.contains('ec-word') ? c.textContent : c.hasAttribute('data-big') ? 'B' : 'b')).join(' ')));
  cnt = (await ear()).count;
  ok(JSON.stringify(bars2) === JSON.stringify(['B b b', 'B b That']) && Math.abs(cnt.entry - 9) < 1e-6 && cnt.clicks.slice(-2).map((c) => c.t).join() === '7.5,8.25', `3: line 2's row — ${JSON.stringify(bars2)}, its own bar's beats at ${cnt.clicks.slice(-2).map((c) => c.t)} s, the entry at ${cnt.entry} s`);
  await page.click('#listen');
  await idle();
  await page.click('#ear-prev');
  // 4. Notes (WP4). A Line attempt with “sweet” a tone sharp first: its cue's "Practise that note ›" → Notes on it
  await page.evaluate(() => { window.__sing = null; });
  await page.click('.ear-modes button[data-ear="line"]');
  await page.click('#sing');
  await page.waitForFunction(() => document.getElementById('sing').textContent === '■ Done', null, { timeout: 10000 });
  await page.evaluate(() => { window.__sing = { mode: 'free', at: performance.now() + 700, f: 1, cents: { 8: 200 } }; });
  await sleep(700 + dur * 1000 + 800);
  await page.click('#sing');
  await page.waitForFunction(() => { const x = window.resonateDebug().ear; return x.res && x.run === null; }, null, { timeout: 15000 });
  e = await ear();
  ok(e.res?.cue?.kind === 'pitch' && e.res.cue.j === 8 && (await page.$('#ear-res button[data-act="practise"]')), `4: “sweet” a tone sharp — “${e.ui}”, with “Practise that note ›”`);
  // (tapped while ▶ Hear plays the line: it stops — nothing goes on sounding into Notes)
  await page.click('#listen');
  await page.waitForFunction(() => window.resonateDebug().ear.run === 'play', null, { timeout: 5000 });
  await page.click('#ear-res button[data-act="practise"]');
  e = await ear();
  const row = () => page.$$eval('#ear-notes .ear-names button', (xs) => xs.map((x) => ({ name: x.querySelector('b')?.textContent, syl: x.querySelector('small')?.textContent || '', state: x.dataset.state, off: x.hasAttribute('data-off'), cur: x.getAttribute('aria-current') === 'true', j: +x.dataset.j })));
  let names = await row();
  const tone = () => page.$$eval('#ear-notes .ear-msg', (xs) => xs.map((x) => `${x.dataset.tone || ''}:${x.textContent}`));
  ok(e.mode === 'notes' && e.notes.cur === 8 && e.notes.targets[0] === 8 && e.notes.off.includes(8) && e.notes.msg === 'Off last time' && !(await ear()).run, `4: Notes on “sweet” — current ${e.notes.cur}, targets ${JSON.stringify(e.notes.targets)}, “${e.notes.msg}”, nothing playing`);
  ok(names.map((x) => x.name).join(' ') === 'E♭4 F4 A♭4 B♭4 C5' && names.find((x) => x.name === 'A♭4')?.syl === 'sweet' && names.find((x) => x.name === 'A♭4').off && names.find((x) => x.name === 'A♭4').cur && names.find((x) => x.name === 'E♭4').state === 'todo' && names.find((x) => x.name === 'F4').state === '',
    `4: the row low → high, the word under each, “sweet” marked off last time — ${names.map((x) => `${x.name}/${x.syl}${x.cur ? '*' : ''}${x.off ? '!' : ''}(${x.state})`).join(' ')}`);
  b = await btns();
  ok(b.sing === '● Match' && b.caption === 'Hear', `4: Notes — “${b.listen}” (${b.caption}) · “${b.sing}”`);
  // ● Match: the note (both buttons ■ Stop), then the hold — a tone sharp: not yet, no direction; the ring's arc emptying
  await page.evaluate(() => { window.__sing = { mode: 'hold', by: 2 }; });
  await page.click('#sing');
  e = await ear();
  b = await btns();
  ok(e.run === 'notePlay' && b.sing === '■ Stop' && b.listen === '■ Stop' && b.caption === 'Stop' && /Listen…/.test(e.notesUi), `4: the note plays — “${b.listen}” (${b.caption}) · “${b.sing}”, “${e.notesUi}”`);
  ok(await page.evaluate(() => window.resonateSing.state().busy && !window.resonateSing.state().take), '4: the note: busy, not a take');
  await page.waitForFunction(() => window.resonateDebug().ear.run === 'hold', null, { timeout: 10000 });
  ok(await page.evaluate(() => window.resonateSing.state().take), '4: the hold: a take for the shell');
  await sleep(500);
  const arc1 = await page.evaluate(() => ({ on: !!document.querySelector('#ear-ring .ear-ring[data-arc]'), off: +document.querySelector('#ear-ring .ear-arc circle')?.style.strokeDashoffset, msg: window.resonateDebug().ear.notes.msg, color: getComputedStyle(document.querySelector('#ear-ring .ear-ring')).boxShadow }));
  await sleep(700);
  const arc2 = await page.evaluate(() => +document.querySelector('#ear-ring .ear-arc circle')?.style.strokeDashoffset);
  ok(arc1.on && arc2 > arc1.off + 5 && arc1.msg === 'Now sing it — keep it going' && !/74, 222, 128/.test(arc1.color), `4: holding — “${arc1.msg}”, the arc emptying (${arc1.off} → ${arc2}), the ring neutral`);
  await page.waitForFunction(() => window.resonateDebug().ear.run === null, null, { timeout: 10000 });
  e = await ear();
  ok(e.notes.v?.kind === 'notyet' && e.notes.msg === 'Not yet' && e.notes.hold === null && (await page.$('#ear-notes button[data-act="try"]')) && !(await page.$('#ear-notes button[data-act="along"]')), `4: a tone sharp, 1st — “${e.notes.msg}” with ▶ Try again (no direction yet)`);
  // ▶ Try again (a real button): 2nd — which way; 3rd — ▶ Sing along, Next note ›
  await page.click('#ear-notes button[data-act="try"]');
  await page.waitForFunction(() => window.resonateDebug().ear.run === 'hold', null, { timeout: 10000 });
  await page.waitForFunction(() => window.resonateDebug().ear.run === null, null, { timeout: 10000 });
  e = await ear();
  ok(e.notes.msg === 'Lower' && (await tone()).join() === 'cue:Lower', `4: 2nd — “${e.notes.msg}” (${await tone()})`);
  await page.click('#ear-notes button[data-act="try"]');
  await page.waitForFunction(() => window.resonateDebug().ear.run === 'hold', null, { timeout: 10000 });
  await page.waitForFunction(() => window.resonateDebug().ear.run === null, null, { timeout: 10000 });
  e = await ear();
  const nchips = await page.$$eval('#ear-notes .ear-chips button', (xs) => xs.map((x) => x.textContent));
  ok(e.notes.msg === 'Lower' && nchips.join(' | ') === '▶ Try again | ▶ Sing along | Next note ›' && !(await page.$('#ear-notes .ear-keyoffer')), `4: 3rd — “${e.notes.msg}” ${nchips.join(' · ')} (no key offer: not the top note)`);
  // ▶ Sing along: the note 4 s, the mic closed; ■ Stop on the dock
  await page.evaluate(() => { window.__sing = null; window.__atStart = []; window.__watch = true; });
  await page.click('#ear-notes button[data-act="along"]');
  await page.waitForFunction(() => window.resonateDebug().ear.run === 'play', null, { timeout: 5000 });
  await sleep(400);
  e = await ear();
  const along = await page.evaluate(() => window.__atStart.slice());
  ok(e.tag === 'along' && e.notes.msg === 'Sing along with it' && JSON.stringify(e.playing) === '[68]' && along.length && along.every((x) => x.live === 0), `4: ▶ Sing along — “${e.notes.msg}”, A♭4 (${JSON.stringify(e.playing)}), no live mic track (${JSON.stringify(along)})`);
  await page.click('#listen');
  await idle();
  await page.evaluate(() => { window.__watch = false; });
  // Next note ›: on to the next target (E♭4, the lowest)
  await page.click('#ear-notes button[data-act="nextnote"]');
  e = await ear();
  ok(e.notes.cur === 0 && e.notes.msg === '' && !e.notes.done.length, `4: Next note › — current ${e.notes.cur} (E♭4), the message cleared`);
  // an octave down: matched — green, the song's octave follows (the chip “Octave down”, pressed; Ear's ▶ an octave down)
  await page.evaluate(() => { window.__sing = { mode: 'hold', by: -12 }; });
  await page.click('#sing');
  await page.waitForFunction(() => (window.resonateDebug().ear.notes?.done || []).length >= 1, null, { timeout: 15000 });
  await page.waitForFunction(() => window.resonateDebug().ear.run === 'play' && (window.resonateDebug().ear.playing || []).length, null, { timeout: 3000 }).catch(() => {});
  e = await ear();
  const conf = e.playing;
  ok(e.notes.done.includes(0) && e.notes.msg === '✓ Same note, in your lower voice' && (await tone()).join() === 'win:✓ Same note, in your lower voice' && e.oct === -12 && JSON.stringify(conf) === '[51]', `4: an octave down — “${e.notes.msg}” (${await tone()}), oct ${e.oct}, the note again at ${JSON.stringify(conf)}`);
  await idle();
  const octChip = await page.$eval('#ear-acts button[data-act="oct"]', (x) => ({ text: x.textContent, pressed: x.getAttribute('aria-pressed') })).catch(() => null);
  names = await row();
  const kept8 = await page.evaluate(() => JSON.parse(localStorage.getItem('resonate.sing.eardata') || '{}')['amazing-grace']?.oct);
  ok(octChip?.text === 'Octave down' && octChip.pressed === 'true' && kept8 === -12 && names[0].name === 'E♭3' && e.notes.cur === 3, `4: “${octChip?.text}” pressed (${octChip?.pressed}), kept for the song (${kept8}); the names in your octave (${names.map((x) => x.name).join(' ')}); next C5, “sweet” skipped for now (${e.notes.cur})`);
  await page.click('.ear-modes button[data-ear="line"]');
  await page.click('#listen');
  await page.waitForFunction(() => window.resonateDebug().ear.run === 'play' && (window.resonateDebug().ear.playing || []).length > 3, null, { timeout: 5000 });
  const heard = (await ear()).playing;
  await page.click('#listen');
  await idle();
  ok(heard.slice(0, 3).join() === '51,53,56', `4: Line's ▶ Hear in your octave — ${heard.slice(0, 5).join(' ')}`);
  await page.click('.ear-modes button[data-ear="notes"]');
  // the highest, a tone flat three times: Higher, then “Too high for now?” [Lower the song] → the key 2 down
  await page.evaluate(() => { window.__sing = { mode: 'hold', by: -2 }; });
  for (let i = 0; i < 3; i++) {
    await page.click(i ? '#ear-notes button[data-act="try"]' : '#sing');
    await page.waitForFunction(() => window.resonateDebug().ear.run === 'hold', null, { timeout: 10000 });
    await page.waitForFunction(() => window.resonateDebug().ear.run === null, null, { timeout: 10000 });
  }
  e = await ear();
  const offer = await page.$eval('#ear-notes .ear-keyoffer', (x) => x.textContent).catch(() => null);
  ok(e.notes.cur === 3 && e.notes.msg === 'Higher' && offer === 'Too high for now?Lower the song', `4: the highest a tone flat, 3rd — “${e.notes.msg}”, “${offer}”`);
  await page.click('#ear-notes .ear-keyoffer button');
  await page.waitForFunction(() => window.resonateDebug().ear.on && /Key/.test(window.resonateDebug().ear.notes?.msg || ''), null, { timeout: 5000 });
  e = await ear();
  const key = await page.$eval('#key-select', (x) => x.value);
  ok(key === '-2' && /^Key A♭ → (G♭|F♯)$/.test(e.notes.msg) && e.notes.cur === 3 && e.mode === 'notes' && JSON.stringify(e.notes.targets) === '[8,0,3]', `4: Lower the song — the key ${key}, “${e.notes.msg}”, still on C5 (${e.notes.cur})`);
  // the rest held — C5 in your octave (said once: its name), then “sweet” in the written octave (an octave apart
  // again: said, the song's octave back) → every target held: stays in Notes, “now the whole line”, ● Sing
  for (const [want, by] of [[3, -12], [8, 0]]) {
    await page.evaluate((x) => { window.__sing = { mode: 'hold', by: x }; }, by);
    await page.click('#sing');
    await page.waitForFunction((k) => (window.resonateDebug().ear.notes?.done || []).includes(k), want, { timeout: 15000 });
    if (want === 3) { e = await ear(); ok(e.notes.v?.kind === 'match' && /^✓ B♭3$/.test(e.notes.v.text) && e.oct === -12, `4: C5 (now B♭4) held in your octave — “${e.notes.v?.text}”`); }
    await idle();
  }
  e = await ear();
  b = await btns();
  const msgs = await tone();
  ok(e.mode === 'notes' && e.notes.complete && msgs.join(' | ') === 'win:✓ Same note, in your higher voice | win:✓ Those notes — now the whole line' && b.sing === '● Sing' && !/All the notes/.test(e.notesUi) && e.oct === 0, `4: every target held — stays in Notes: ${msgs.join(' | ')}, the dock “${b.sing}”, the octave back (${e.oct})`);
  // ● Sing: on to the line, the mic open in that tap
  await page.click('#sing');
  await page.waitForFunction(() => window.resonateDebug().ear.run === 'free', null, { timeout: 5000 });
  e = await ear();
  ok(e.mode === 'line', `4: ● Sing — Line, the mic open (${e.run})`);
  await page.click('#ear-acts button[data-act="first"]');
  await idle();
  await page.evaluate(() => { window.__sing = null; });
  // (the octave chip toggles: down again, then the written octave; the key back)
  const pressed = () => page.$eval('#ear-acts button[data-act="oct"]', (x) => x.getAttribute('aria-pressed'));
  const p0 = await pressed();
  await page.click('#ear-acts button[data-act="oct"]');
  const p1 = await pressed(), o1 = (await ear()).oct;
  await page.click('#ear-acts button[data-act="oct"]');
  e = await ear();
  ok(p0 === 'false' && p1 === 'true' && o1 === -12 && e.oct === 0 && (await pressed()) === 'false', `4: “Octave down” — unpressed (${p0}), a tap: down again (${o1}, ${p1}), another: the written octave (${e.oct})`);
  await page.selectOption('#key-select', '0');
  await sleep(300);
  // (“sweet” off again in the line after it was held: Notes has it to hold again — “Off last time”, not held, not
  // “now the whole line”; the lowest and highest, held and not off this time, stay held)
  await page.click('#sing');
  await page.waitForFunction(() => document.getElementById('sing').textContent === '■ Done', null, { timeout: 10000 });
  await page.evaluate(() => { window.__sing = { mode: 'free', at: performance.now() + 700, f: 1, cents: { 8: 200 } }; });
  await sleep(700 + dur * 1000 + 800);
  await page.click('#sing');
  await page.waitForFunction(() => { const x = window.resonateDebug().ear; return x.res && x.run === null; }, null, { timeout: 15000 });
  await page.evaluate(() => { window.__sing = null; });
  e = await ear();
  const again8 = e.res?.cue?.kind === 'pitch' && e.res.cue.j === 8;
  await page.click('.ear-modes button[data-ear="notes"]');
  e = await ear();
  b = await btns();
  ok(again8 && !e.notes.complete && e.notes.cur === 8 && !e.notes.done.includes(8) && e.notes.done.includes(0) && e.notes.done.includes(3) && e.notes.msg === 'Off last time' && b.sing === '● Match',
    `4: “sweet” off again in the line — Notes on it again (current ${e.notes.cur}, held ${JSON.stringify(e.notes.done)}, “${e.notes.msg}”, “${b.sing}”)`);
  await page.click('.ear-modes button[data-ear="line"]');
  // (an attempt Ear couldn't follow says nothing about the notes: Notes keeps “sweet”)
  await page.click('#sing');
  await page.waitForFunction(() => document.getElementById('sing').textContent === '■ Done', null, { timeout: 10000 });
  await page.evaluate(() => { window.__sing = { mode: 'free', at: performance.now() + 700, f: 1, wrong: { 0: 5, 1: -5, 2: 6, 3: -6, 4: 5, 5: -5, 6: 6, 7: -6, 8: 5, 9: -5, 10: 6 } }; });
  await sleep(700 + dur * 1000 + 800);
  await page.click('#sing');
  await page.waitForFunction(() => { const x = window.resonateDebug().ear; return x.res && x.run === null; }, null, { timeout: 15000 });
  await page.evaluate(() => { window.__sing = null; });
  const nofit = (await ear()).res?.cue?.kind;
  await page.click('.ear-modes button[data-ear="notes"]');
  e = await ear();
  ok(nofit === 'nofit' && e.notes.cur === 8 && e.notes.off.includes(8) && e.notes.msg === 'Off last time', `4: then one Ear couldn't follow (${nofit}) — Notes still on “sweet” (current ${e.notes.cur}, off ${JSON.stringify(e.notes.off)})`);
  await page.click('.ear-modes button[data-ear="line"]');
  // 7. (WP5) a start late: its cue, ▶ Piano over the stretch at the attempt's own tempo, "Try it with the clicks ›" →
  // Beats (nothing starts); Normal · Slow · Slower — the ♩ menu's own setting, never compounded; a song with its own
  // tempo slowed as a share of it
  e = await attempt({ starts: { 6: 0.4 } });
  w = e.words;
  const rg = e.res?.cue?.range;
  ok(e.res?.cue?.kind === 'timing' && w.cue === 'Come in sooner on “grace”' && w.sounds.join(' · ') === '▶ Piano · ▶ You' && w.next === 'Try it with the clicks ›', `7: “grace” 0.4 s late — “${w.cue}” ${w.sounds.join(' · ')}, next “${w.next}”`);
  await page.evaluate(() => { window.__atStart = []; window.__watch = true; });
  await page.click('#ear-res button[data-act="cue-stretch"]');
  await page.waitForFunction(() => window.resonateDebug().ear.run === 'play', null, { timeout: 5000 });
  const stretch = (await ear()).playing;
  await idle();
  const whens = await page.evaluate(() => { window.__watch = false; return window.__atStart.map((x) => x.when).filter((x) => x > 0); });
  const writ = await page.evaluate(([a, z]) => window.resonateDebug().notes.slice(a, z + 1).map((n) => n.t), rg || [0, 0]);
  const ratio = whens.length >= 2 ? (whens[whens.length - 1] - whens[0]) / (writ[writ.length - 1] - writ[0]) : null;
  ok(rg && stretch?.length === rg[1] - rg[0] + 1 && whens.length === stretch.length && Math.abs(ratio / e.res.fit.b - 1) < 0.02, `7: ▶ Piano — the stretch ${rg?.join('…')} (${stretch?.length} notes), at the attempt's tempo (×${ratio?.toFixed(3)}, b ${e.res?.fit?.b?.toFixed(3)})`);
  // (Slow tapped after the attempt: the result stays, and its ▶ Piano still plays the singer's tempo — the same seconds as
  // before, not the attempt's ratio applied to the slower notes)
  await page.click('#ear-acts .ear-speed button[data-f="0.8"]');
  await page.evaluate(() => { window.__atStart = []; window.__watch = true; });
  await page.click('#ear-res button[data-act="cue-stretch"]');
  await page.waitForFunction(() => window.resonateDebug().ear.run === 'play', null, { timeout: 5000 });
  await idle();
  const whens2 = await page.evaluate(() => { window.__watch = false; return window.__atStart.map((x) => x.when).filter((x) => x > 0); });
  const span = (xs) => (xs.length >= 2 ? xs[xs.length - 1] - xs[0] : null);
  ok(whens2.length === whens.length && Math.abs(span(whens2) / span(whens) - 1) < 0.02, `7: ▶ Piano at Slow since — the stretch still at the singer's tempo (${span(whens2)?.toFixed(3)} s, was ${span(whens)?.toFixed(3)} s)`);
  await page.click('#ear-acts .ear-speed button[data-f="1"]');
  // (▶ The rest: a singer who stopped after “grace” — the piano from the first note not sung to the line's end)
  e = await attempt({ stop: 6 });
  w = e.words;
  const from = e.res?.cue?.from;
  ok(e.res?.cue?.kind === 'short' && w.cue === 'Keep going to “sound”' && w.sounds.join() === '▶ The rest' && !w.next, `7: stopped after “grace” — “${w.cue}” ${w.sounds.join(' · ')}`);
  await page.click('#ear-res button[data-act="cue-rest"]');
  await page.waitForFunction(() => window.resonateDebug().ear.run === 'play', null, { timeout: 5000 });
  const rest = (await ear()).playing, j1 = (await ear()).ph.j1;
  await page.click('#listen'); // (■ Stop)
  await idle();
  ok(from != null && rest?.length === j1 - from, `7: ▶ The rest — ${rest?.length} notes, from note ${from} to the line's end`);
  e = await attempt({ starts: { 6: 0.4 } });
  await page.click('#ear-res button[data-act="beats"]');
  e = await ear();
  ok(e.mode === 'beats' && e.run === null && !(await page.evaluate(() => window.resonateDebug().session)), `7: “Try it with the clicks ›” → Beats, nothing started (${e.mode}, ${e.run})`);
  const tsel = () => page.evaluate(() => { const x = document.getElementById('tempo-select'); return { v: x.value, t: x.selectedOptions[0]?.textContent, rate: window.resonateDebug().rate }; });
  await page.click('#ear-acts .ear-speed button[data-f="0.7"]');
  let ts = await tsel();
  ok(ts.v === 'r:0.7' && ts.t === '♩=56 (70%)' && (await speedRow()) === 'Normal Slow Slower*' && (await ear()).speed === 0.7, `7: Slower — the ♩ menu “${ts.t}” (${ts.v}), ${await speedRow()}`);
  await page.click('#listen');
  await page.waitForFunction(() => window.resonateDebug().ear.count?.play, null, { timeout: 5000 });
  const ccl = (await ear()).count.clicks.map((c) => c.t);
  await page.click('#listen'); // (■ Stop)
  await idle();
  const cgaps = ccl.slice(1, 3).map((t, i) => t - ccl[i]);
  ok(cgaps.length === 2 && cgaps.every((g) => Math.abs(g - 60 / 56) < 0.003), `7: Beats at Slower — ▶ Hear's count-in a beat of ♩=56 apart (${cgaps.map((g) => g.toFixed(3))}), not 70 % of 70 %`);
  await page.click('.ear-modes button[data-ear="line"]');
  await page.click('#ear-acts .ear-speed button[data-f="0.8"]');
  ts = await tsel();
  ok(ts.v === 'r:0.8' && ts.t === '♩=64 (80%)' && (await speedRow()) === 'Normal Slow* Slower', `7: Slow — “${ts.t}”, ${await speedRow()}`);
  await page.evaluate(() => { window.__atStart = []; window.__watch = true; });
  await page.click('#listen');
  await page.waitForFunction(() => window.resonateDebug().ear.run === 'play', null, { timeout: 5000 });
  await sleep(2500);
  await page.click('#listen');
  await idle();
  const hw = await page.evaluate(() => { window.__watch = false; return window.__atStart.map((x) => x.when).filter((x) => x > 0); });
  const q3 = await page.evaluate(() => { const d = window.resonateDebug(), a = d.ear.ph.j0; return [d.notes[a].q, d.notes[a + 3].q]; });
  const want3 = (q3[1] - q3[0]) * 60 / 64;
  ok(hw.length >= 4 && Math.abs(hw[3] - hw[0] - want3) < 0.01, `7: ▶ Hear at Slow — its 4th note ${(hw[3] - hw[0]).toFixed(3)} s after the 1st (♩=64: ${want3.toFixed(3)})`);
  // (a song with its own tempo — typed: ♩=100 — slowed: 80 % of it, the menu says so; the menu's own choice clears it)
  page.once('dialog', (d) => d.accept('100'));
  await page.evaluate(() => { const x = document.getElementById('tempo-select'); x.value = 'type'; x.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(300);
  ts = await tsel();
  ok(Math.abs(ts.rate - 1.25) < 1e-9 && (await speedRow()) === 'Normal* Slow Slower', `7: ♩=100 typed — the song's own tempo (${ts.t}), Normal`);
  await page.click('#ear-acts .ear-speed button[data-f="0.8"]');
  ts = await tsel();
  const sp = await page.evaluate(() => JSON.parse(localStorage.getItem('resonate.sing.eardata') || '{}')['amazing-grace']?.sp);
  ok(ts.v === 'o:0.8' && ts.t === '♩=80 (yours · 80%)' && Math.abs(ts.rate - 1) < 1e-9 && sp === 0.8 && (await speedRow()) === 'Normal Slow* Slower', `7: Slow on it — “${ts.t}” (${ts.v}, rate ${ts.rate}, kept ${sp})`);
  await page.evaluate(() => { const x = document.getElementById('tempo-select'); x.value = 'o:1'; x.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(200);
  ts = await tsel();
  ok(Math.abs(ts.rate - 1.25) < 1e-9 && (await speedRow()) === 'Normal* Slow Slower', `7: the menu's “(yours)” — back to ♩=100, Normal (${ts.t})`);
  await page.evaluate(() => { const x = document.getElementById('tempo-select'); x.value = 'r:1'; x.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(200);
  ts = await tsel();
  const left = await page.evaluate(() => ({ t: JSON.parse(localStorage.getItem('resonate.sing.timing') || '{}')['amazing-grace'] || null, sp: JSON.parse(localStorage.getItem('resonate.sing.eardata') || '{}')['amazing-grace']?.sp ?? null }));
  ok(ts.v === 'r:1' && ts.rate === 1 && !left.t && left.sp === null && (await speedRow()) === 'Normal* Slow Slower', `7: ♩=80 from the menu — the score's tempo again, nothing left (${JSON.stringify(left)})`);
  // 8. (WP6) the lines: ‹ the dots › → the Lines sheet → a line opens, kept across a reload; Pick words → a line of the
  // singer's own (a diamond, ★ in the sheet), judged as any; ♩ ♪ secured after 2 of 3 “all” — the dot fills (and
  // pulses twice), the sheet's marks green, “Spot on — twice running”; a mark stays after a bad attempt; “Last time”
  // from the store after a reload; ✕ (two taps) takes the own line away
  const nav = () => page.evaluate(() => ({ dots: [...document.querySelectorAll('#ear-name .eld')].map((d) => `${d.hasAttribute('data-own') ? '◆' : '●'}${d.dataset.sec || ''}${d.hasAttribute('data-cur') ? '*' : ''}${d.hasAttribute('data-new') ? '!' : ''}`).join(' '), label: document.getElementById('ear-lines').getAttribute('aria-label'), off: document.getElementById('ear-lines').disabled }));
  const sheetRows = () => page.$$eval('#el-list .el-row', (xs) => xs.map((x) => ({ text: x.querySelector('.el-go').textContent, cur: x.hasAttribute('data-cur'), marks: [...x.querySelectorAll('.el-marks .ear-ic')].map((i) => i.hasAttribute('data-on')), x: x.querySelector('.el-x')?.textContent || null })));
  let n8 = await nav();
  e = await ear();
  ok(n8.dots.split(' ').length === 4 && n8.dots.split(' ')[e.p].replace('!', '').endsWith('*') && n8.label === `Lines: ${e.p + 1} of 4`, `8: the dots — ${n8.dots} (“${n8.label}”)`);
  await page.click('#ear-lines');
  await page.waitForFunction(() => window.resonateDebug().ear.linesOpen, null, { timeout: 3000 });
  let elRows = await sheetRows();
  ok(elRows.length === 4 && elRows.map((r) => r.text).join(' | ') === LINES.map((l) => l[2]).join(' | ') && elRows.filter((r) => r.cur).length === 1 && elRows.every((r) => r.marks.length === 2), `8: the Lines sheet — ${elRows.map((r) => `${r.cur ? '*' : ''}${r.text}`).join(' | ')}`);
  await page.click('#el-list .el-row:nth-child(3) .el-go');
  await sleep(200);
  e = await ear();
  ok(!e.linesOpen && e.p === 2 && e.ph.words === LINES[2][2] && (await nav()).dots.split(' ')[2].endsWith('*'), `8: a row tapped — the sheet closes, line ${e.p + 1} (“${e.ph.words}”)`);
  await page.reload();
  await ready();
  e = await ear();
  ok(e.p === 2, `8: a reload — line ${e.p + 1} again`);
  // Pick words: “sweet” … “sound!” → its own line
  await page.click('#ear-lines');
  await page.click('#earlines button[data-act="pick"]');
  const words = await page.$$eval('#el-pick .el-words button', (xs) => xs.map((x) => [x.dataset.t, x.textContent]));
  const wt = (w) => words.find((x) => x[1] === w)[0];
  ok(words.length === 26 && (await page.textContent('#el-pick .el-hint')) === 'Tap the first word, then the last', `8: Pick words — ${words.length} words, “${await page.textContent('#el-pick .el-hint')}”`);
  await page.click(`#el-pick button[data-t="${wt('sweet')}"]`);
  const far = await page.$$eval('#el-pick .el-words button[data-far]', (xs) => xs.map((x) => x.textContent));
  ok((await page.textContent('#el-pick .el-hint')) === '…then the last' && far.includes('Amazing') && far.includes('found;') && !far.includes('sound!') && !far.includes('me!'), `8: the first word picked — the words it can't end on dimmed (${far.join(' ')})`);
  await page.click(`#el-pick button[data-t="${wt('sound!')}"]`);
  await sleep(200);
  e = await ear();
  n8 = await nav();
  const dot = (n, i) => n.dots.split(' ')[i];
  ok(!e.linesOpen && e.ph.j0 === 8 && e.ph.j1 === 11 && e.ph.words === 'sweet the sound!' && e.lines.length === 5 && e.lines[1].own && e.p === 1 && dot(n8, 1) === '◆*' && n8.dots.split(' ').length === 5 && (await page.textContent('#ear-words')) === 'sweet the sound!', `8: “sweet the sound!” — its own line, after the line it's in (${n8.dots}; “${e.ph.words}”, notes ${e.ph.j0}–${e.ph.j1 - 1})`);
  const own0 = await page.evaluate(() => JSON.parse(localStorage.getItem('resonate.sing.eardata') || '{}')['amazing-grace']?.own);
  ok(own0?.length === 1 && own0[0].j0 === 8 && own0[0].j1 === 11 && own0[0].wk === e.ph.wk, `8: kept for the song (${JSON.stringify(own0)})`);
  // (another verse: its words aren't the own line's — the printed line at its place opens, not whatever line has its
  // index there; back in verse 1 from verse 2's 2nd line, that line's place again — not the own line at that index)
  const verse8 = async (v) => { await page.evaluate((v) => { const s = document.getElementById('verse-select'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, v); await sleep(400); return ear(); };
  const v2 = await verse8('2');
  await page.click('#ear-next');
  await sleep(150);
  const v2b = await ear();
  const v1 = await verse8('1');
  ok(v2.p === 0 && !v2.ph.own && v2.ph.j0 <= 8 && v2.ph.j1 > 8 && v2b.p === 1 && v1.ph.j0 === v2b.ph.j0 && !v1.lines[v1.p].own && v1.ph.words === LINES[1][2], `8: verse 2 from the own line — “${v2.ph.words}”; back in verse 1 from verse 2's 2nd line — “${v1.ph.words}”`);
  await page.click('#ear-prev');
  await sleep(150);
  e = await ear();
  ok(e.p === 1 && e.ph.words === 'sweet the sound!', `8: ‹ — the own line again (“${e.ph.words}”)`);
  // secured: two attempts with every note and start right — the 2nd “Spot on — twice running”, the dot full and pulsing (twice)
  e = await attempt({});
  const r1 = e.res;
  n8 = await nav();
  ok(r1.counts?.notesAll && r1.counts?.beatsAll && r1.win?.kind === 'spot' && dot(n8, 1) === '◆*', `8: its first attempt — “${e.ui}”, not secured yet (${n8.dots})`);
  e = await attempt({});
  n8 = await nav();
  ok(e.res.win?.kind === 'spot' && e.res.win.sub === 'again' && /Spot on — twice running/.test(e.ui) && dot(n8, 1) === '◆bn*!' && e.lines[1].sec === 'bn', `8: the second — “${e.ui}”; secured: ${n8.dots}`);
  await page.click('#ear-lines');
  elRows = await sheetRows();
  ok(elRows.length === 5 && elRows[1].text === '★ sweet the sound!' && elRows[1].cur && elRows[1].marks.every(Boolean) && elRows[1].x === '✕' && elRows.filter((r) => r.x).length === 1, `8: the sheet — ${elRows.map((r) => `${r.text}${r.marks.map((m, i) => (m ? '♩♪'[i] : '')).join('')}`).join(' | ')}`);
  await page.click('#el-close');
  // a bad attempt: the marks stay
  e = await attempt({ cents: { 1: 200 } });
  n8 = await nav();
  ok(e.res.cue?.kind === 'pitch' && dot(n8, 1).replace('!', '') === '◆bn*', `8: then “the” sung high — “${e.res.cue?.text}”; the marks stay (${n8.dots})`);
  // after a reload: the own line open, “Last time” from the store (its cue), and what judges compares with it
  await page.reload();
  await ready();
  e = await ear();
  ok(e.p === 1 && e.ph.words === 'sweet the sound!' && e.shown?.old && e.old && /^Last time/.test(e.ui) && /“the” — aim lower/.test(e.ui) && !(await page.$('#ear-res .ear-chips')), `8: a reload — its own line open, “${e.ui}”`);
  e = await attempt({ cents: { 2: -150 } });
  ok(e.res.win?.kind === 'fixed' && /“the” right on it now/.test(e.ui) && e.res.cue?.j === 10, `8: then “the” right (“sound” low) — compared with the stored attempt: “${e.ui}”`);
  // ✕: two taps — "Remove?" first (it lapses after 3 s), then gone: the line it was in open
  await page.click('#ear-lines');
  await page.click('#el-list .el-x');
  const arm = await page.textContent('#el-list .el-x');
  await sleep(3300);
  const lapsed = await page.textContent('#el-list .el-x');
  await page.click('#el-list .el-x');
  await page.click('#el-list .el-x');
  await sleep(200);
  e = await ear();
  elRows = await sheetRows();
  const own1 = await page.evaluate(() => JSON.parse(localStorage.getItem('resonate.sing.eardata') || '{}')['amazing-grace']?.own);
  ok(arm === 'Remove?' && lapsed === '✕' && elRows.length === 4 && e.lines.length === 4 && e.p === 0 && !own1?.length, `8: ✕ — “${arm}”, lapsed “${lapsed}”, then removed: line ${e.p + 1} open, ${elRows.length} elRows`);
  await page.click('#el-close');
  // more than 10 lines (seven of the singer's own here): the open line's first words ▾ — with its dot when it has a mark
  const v8 = await page.evaluate(() => document.getElementById('version').textContent.trim().replace(/^v/, ''));
  const setOwn = (spans) => page.evaluate(async ([v, spans]) => {
    const P = await import(`./practice.js?v=${v}`), notes = window.resonateDebug().notes, all = JSON.parse(localStorage.getItem('resonate.sing.eardata') || '{}');
    all['amazing-grace'] = { ...all['amazing-grace'], own: spans.map(([a, b]) => ({ j0: a, j1: b, wk: P.phraseKeys(notes, Array.from({ length: b - a }, (_, k) => a + k)).wk })), p: null, pi: 0 };
    localStorage.setItem('resonate.sing.eardata', JSON.stringify(all));
  }, [v8, spans]);
  await setOwn([[0, 6], [6, 8], [8, 11], [11, 14], [13, 17], [17, 21], [21, 24]]);
  await page.reload();
  await ready();
  e = await ear();
  const many = await page.evaluate(() => ({ w: document.querySelector('#ear-name .elw')?.textContent, v: document.querySelector('#ear-name .elv')?.textContent, sec: document.querySelector('#ear-name .eld')?.dataset.sec || null, label: document.getElementById('ear-lines').getAttribute('aria-label') }));
  ok(e.lines.length === 11 && e.p === 0 && many.w === '“Amazing grace…”' && many.v === '▾' && many.sec === e.lines[0].sec && many.label === 'Lines: 1 of 11', `8: 11 lines — the first words ▾ (${JSON.stringify(many)})`);
  // (‹ › stay where they are whatever the words: tapped again and again, they're under the thumb)
  const arrows = () => page.evaluate(() => ['ear-prev', 'ear-next'].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return `${Math.round(r.left)},${Math.round(r.top)}`; }).join(' '));
  const at0 = [];
  for (let i = 0; i < 4; i++) { at0.push(await arrows()); await page.click('#ear-next'); await sleep(60); }
  for (let i = 0; i < 3; i++) { await page.click('#ear-prev'); await sleep(60); }
  ok(new Set(at0).size === 1, `8: ‹ › don't move from line to line (${[...new Set(at0)].join(' / ')})`);
  const many2 = await page.evaluate(() => document.querySelector('#ear-name .elw')?.textContent);
  ok(/^★ “Amazing/.test(many2 || ''), `8: › — the next, one of the singer's own: “${many2}”`);
  await setOwn([]);
  await page.reload();
  await ready();
  ok((await ear()).lines.length === 4, '8: the own lines gone again — 4 lines');
  // (a record with no line open yet — a first ▶ Hear or attempt writes the line's record before ‹ › ever saves one: Ear
  // opens on the first line, not on nothing)
  await page.evaluate(() => { const all = JSON.parse(localStorage.getItem('resonate.sing.eardata') || '{}'); const { p, pi, oct, ...rest } = all['amazing-grace'] || {}; all['amazing-grace'] = rest; localStorage.setItem('resonate.sing.eardata', JSON.stringify(all)); });
  await page.reload();
  await ready();
  e = await ear();
  ok(e.p === 0 && (await page.textContent('#ear-words')) === LINES[0][2], `8: a record with no line open yet — line ${e.p + 1} (“${await page.textContent('#ear-words')}”)`);
  // the store goes with the song (forget.js; sync.js's tombstones: synclib.mjs)
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem('resonate.sing.eardata') || '{}')['amazing-grace']?.ph != null), '8: attempts kept per line');
  // (Lower the song in section 6 checks ▶ Hear and the next attempt in the new key)
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
  // (Lower the song here — "Key A♭ → F" —, then a song whose own key is −3 too: that fact was the last song's)
  e = await attempt({ all: -300 });
  await page.click('#ear-res button[data-act="cue-key"]');
  await sleep(300);
  const factA = (await ear()).fact;
  // (WP6.4: Lower the song after an attempt 3 semitones down — the Key menu −3, ▶ Hear plays the line 3 semitones lower,
  // and the same singing again — now in the song's key — is in tune: ♪ all)
  await page.click('#listen');
  await page.waitForFunction(() => window.resonateDebug().ear.run === 'play' && window.resonateDebug().ear.playing?.length, null, { timeout: 5000 });
  const lowPlay = await page.evaluate(() => { const d = window.resonateDebug(); return { got: d.ear.playing.slice(0, 3), want: d.notes.slice(d.ear.ph.j0, d.ear.ph.j0 + 3).map((n) => n.wmidi - 3 + d.ear.oct) }; });
  await page.click('#listen');
  await idle();
  e = await attempt({ all: -300 - 100 * (await page.evaluate(() => Number(document.getElementById('key-select').value))) });
  ok(factA === 'Key A♭ → F' && JSON.stringify(lowPlay.got) === JSON.stringify(lowPlay.want) && e.res.counts?.notesAll && !e.res.key?.kind && e.res.win?.kind === 'spot', `6: Lower the song — ▶ Hear 3 semitones lower (${lowPlay.got} — written ${lowPlay.want.map((m) => m + 3)}); the same singing again: “${e.ui}”`);
  await page.evaluate((id) => { const k = JSON.parse(localStorage.getItem('resonate.sing.keys') || '{}'); k[id] = -3; localStorage.setItem('resonate.sing.keys', JSON.stringify(k)); }, id2);
  await page.click('#ear-next'); await page.click('#ear-next');
  ok((await ear()).p === 2, '6: line 3 open on Amazing Grace');
  await page.evaluate((id) => window.resonateSing.open(id), id2);
  await page.waitForFunction((id) => window.resonateSing.state().song === id && window.resonateDebug().ear.on, id2, { timeout: 15000 });
  e = await ear();
  ok(e.p === 0 && !e.res && !e.shown && !e.flash && e.mode === 'line' && e.ui === '', `6: another song opens on line 1 with nothing of the last one's (p ${e.p}, “${e.ui}”)`);
  ok(factA === 'Key A♭ → F' && !e.fact && e.hint !== '▶ Hear it first' && (await page.evaluate(() => document.getElementById('key-select').value)) === '-3', `6: …not the last song's “${factA}” either, at the same Key menu value (fact ${e.fact}, hint ${e.hint})`);
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
  const firstTop = () => page.evaluate(() => document.querySelector('#ear-acts button[data-act="first"]')?.getBoundingClientRect().top ?? null);
  const top0 = await firstTop();
  ok(L.caption === 'Hear' && L.pulse && L.sing === '● Sing' && L.whole, `${dev}: the dock — ▶ “${L.caption}” (pulsing), “${L.sing}” whole`);
  // the labels, every mode (idle)
  const labels = [];
  const tabsAt = [];
  for (const m of ['beats', 'notes', 'line']) { await modeTo(m); await sleep(100); L = await look(); labels.push([m, L.caption, L.sing, L.whole]); tabsAt.push(await page.evaluate(() => document.querySelector('.ear-modes').getBoundingClientRect().top)); }
  ok(tabsAt.every((t) => Math.abs(t - tabsAt[0]) <= 2), `${dev}: the tabs stay put from mode to mode (${tabsAt.map((t) => t.toFixed(1)).join(', ')})`);
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
  const top1 = await firstTop();
  const dur = await page.evaluate(() => { const d = window.resonateSing.debug(); const a = d.ear.ph.j0, z = d.ear.ph.j1; return d.notes[z - 1].t + d.notes[z - 1].d - d.notes[a].t; });
  await sleep(dur * 1000 + 300);
  await page.click('.dock #sing');
  await page.waitForFunction(() => { const x = window.resonateSing.debug().ear; return x.res && x.run === null; }, null, { timeout: 15000 });
  await page.evaluate(() => { window.__sing = null; });
  await sleep(300);
  L = await look();
  const res = await page.evaluate(() => window.resonateSing.debug().ear.res);
  ok(res?.counts?.notesAll && !L.state.take && !L.state.busy && !L.hold && !L.tuner, `${dev}: judged (♪ ${res?.counts?.notesAll ? 'all' : res?.counts?.notes}) — no take any more, the tuner still hidden`);
  const top2 = await firstTop();
  ok([top1, top2].every((t) => Math.abs(t - top0) <= 2), `${dev}: ▶ First note stays put — empty ${top0?.toFixed(1)}, listening ${top1?.toFixed(1)}, a result ${top2?.toFixed(1)}`);
  // (the iPad: read from a music stand — the words 2.4rem, the counts 1.6rem, every button ≥ 48 px; the column centred)
  const size = await page.evaluate(() => {
    const px = (el) => parseFloat(getComputedStyle(el).fontSize), rem = px(document.documentElement);
    const bs = [...document.querySelectorAll('#ear button')].filter((b) => b.getClientRects().length);
    const el = document.getElementById('ear'), ear = el.getBoundingClientRect(), main = el.parentElement.getBoundingClientRect();
    // (the space it's centred in: from what shows above it — the controls row — to the region's end)
    const over = Math.max(main.top, ...[...el.parentElement.children].filter((x) => x !== el && x.getClientRects().length && x.getBoundingClientRect().bottom <= ear.top + 1).map((x) => x.getBoundingClientRect().bottom));
    return { words: px(document.getElementById('ear-words')) / rem, counts: px(document.querySelector('#ear-res .ear-counts')) / rem, small: bs.filter((b) => b.getBoundingClientRect().height < 47.5).map((b) => b.textContent), cut: bs.filter((b) => b.scrollWidth > b.clientWidth + 0.5).map((b) => b.textContent), above: ear.top - over, below: main.bottom - ear.bottom, n: bs.length };
  });
  if (dev === 'ipad') ok(size.words >= 2.4 && size.counts >= 1.6 && !size.small.length && !size.cut.length && Math.abs(size.above - size.below) < 40, `${dev}: words ${size.words}rem, counts ${size.counts}rem, ${size.n} buttons ≥ 48 px${size.small.length ? ` (not: ${size.small})` : ''}, centred (${size.above.toFixed(0)} above, ${size.below.toFixed(0)} below)`);
  else ok(!size.cut.length, `${dev}: no Ear button cut short (${size.n})${size.cut.length ? ` — ${size.cut}` : ''}`);
  // (the tabs where they were in every mode with a result there too — and Beats' / Notes' hints still to come)
  const tabsR = [];
  for (const m of ['beats', 'notes', 'line']) { await modeTo(m); await sleep(100); tabsR.push(await page.evaluate(() => document.querySelector('.ear-modes').getBoundingClientRect().top)); }
  ok(tabsR.every((t) => Math.abs(t - tabsAt[0]) <= 2), `${dev}: with Line's result — the tabs stay put from mode to mode (${tabsR.map((t) => t.toFixed(1)).join(', ')}; idle ${tabsAt[0].toFixed(1)})`);
  if (dev === 'ipad') {
    // (the Score stacked under Sing: Ear's region ~340 px tall — a phone's sizes, and an attempt's result scrolled into view)
    await page.click('#mod-score');
    await page.waitForFunction(() => window.resonatePlay?.state?.().ready && !window.resonateDebug().song.moving, null, { timeout: 30000 });
    await sleep(400);
    const room = await page.evaluate(() => ({ big: document.getElementById('ear').hasAttribute('data-big'), words: parseFloat(getComputedStyle(document.getElementById('ear-words')).fontSize) / parseFloat(getComputedStyle(document.documentElement).fontSize), h: document.getElementById('ear').clientHeight }));
    ok(!room.big && room.words < 2, `${dev} + Score: Ear in ${room.h} px — a phone's sizes (words ${room.words}rem)`);
    await page.click('.dock #sing');
    await page.waitForFunction(() => document.querySelector('.dock #sing').textContent === '■ Done', null, { timeout: 10000 });
    await page.evaluate(() => { window.__sing = { mode: 'free', at: performance.now() + 500, f: 1, cents: { 2: -200 } }; });
    await sleep(500 + dur * 1000 + 800);
    await page.click('.dock #sing');
    await page.waitForFunction(() => { const x = window.resonateSing.debug().ear; return x.res && x.run === null; }, null, { timeout: 15000 });
    await page.evaluate(() => { window.__sing = null; });
    await sleep(400);
    const seen = await page.evaluate(() => { const a = document.getElementById('ear').getBoundingClientRect(), r = document.getElementById('ear-res').getBoundingClientRect(), nx = document.querySelector('#ear-res .ear-next, #ear-res .ear-chips:last-child')?.getBoundingClientRect(); return { top: r.top - a.top, bottom: (nx || r).bottom - a.bottom, text: document.getElementById('ear-res').innerText.replace(/\n/g, ' | ') }; });
    ok(seen.top >= -1 && seen.bottom <= 1, `${dev} + Score: the result in view after ■ Done (top ${seen.top.toFixed(0)}, its last chip ${seen.bottom.toFixed(0)} from Ear's bottom) — “${seen.text}”`);
    await page.click('#mod-score');
    await page.waitForFunction(() => !window.resonateDebug().song.moving && document.getElementById('ear').hasAttribute('data-big'), null, { timeout: 20000 });
    ok(true, `${dev}: the Score off — the big sizes back`);
  }
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
    // (WP6) the Lines sheet in the shell: in Sing's layer, over the dock; a row opens its line; Back closes the sheet,
    // not the song; a tap on the nav doesn't stop the Score's ▶ (a silent control)
    await page.click('#ear-lines');
    await page.waitForFunction(() => window.resonateSing.debug().ear.linesOpen, null, { timeout: 3000 });
    const sh = await page.evaluate(() => { const el = document.getElementById('earlines'), r = el.querySelector('.sheet').getBoundingClientRect(), dock = document.querySelector('.dock').getBoundingClientRect(); return { inLayer: !!el.closest('#sing-layer'), rows: el.querySelectorAll('.el-row').length, over: r.bottom >= dock.top, topEl: document.elementFromPoint(dock.left + 10, dock.top + 10)?.closest('#earlines') != null }; });
    ok(sh.inLayer && sh.rows === 4 && sh.topEl, `${dev}: the Lines sheet in Sing's layer, over the dock (${sh.rows} rows)`);
    await page.click('#el-list .el-row:nth-child(2) .el-go');
    await sleep(200);
    let le = await page.evaluate(() => window.resonateSing.debug().ear);
    ok(!le.linesOpen && le.p === 1, `${dev}: a row — line ${le.p + 1} open, the sheet closed`);
    await page.click('#ear-lines');
    await page.waitForFunction(() => window.resonateSing.debug().ear.linesOpen, null, { timeout: 3000 });
    await page.goBack();
    await sleep(400);
    le = await page.evaluate(() => window.resonateSing.debug().ear);
    ok(!le.linesOpen && (await page.evaluate(() => window.resonateDebug().song.open)), `${dev}: Back — the sheet closes, the song stays open`);
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
