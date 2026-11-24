// Ear walkthrough: every state of Sing's Ear (sing.js "Ear"; docs/EAR.md) in the shell, on a phone and an
// iPad, with a simulated singer (a sawtooth through a fake getUserMedia) — screenshots + the text on screen
// at each step, for reviews (people and personas). Not a pass/fail suite.
//   SHOTS=<dir> node earwalk.cjs          (default: the scratchpad's ear/ folder; BASE: the harness)
//   ONLY=phone|ipad                        (one device)
// Writes <SHOTS>/<device>/<nn>-<name>.png and <SHOTS>/walk.md (each step: what was done, what shows).
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const { BASE } = require('./lib/paths.cjs');
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user-resonate/ff8222dc-0c50-507b-b424-c024937f0d1b/scratchpad/ear';
const ONLY = process.env.ONLY || '';
const SONG = process.env.SONG || 'amazing-grace';
const sleep = (t) => new Promise((r) => setTimeout(r, t));
const md = [];

const { SINGER } = require('./lib/earsinger.cjs');

async function walk(dev, ctxOpts, modules) {
  const dir = path.join(SHOTS, dev);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript((m) => {
    try {
      if (!sessionStorage.getItem('walk')) {
        sessionStorage.setItem('walk', '1');
        localStorage.setItem('resonate.sing.song', m.song);
        localStorage.setItem('resonate.shell.modules', JSON.stringify(m.modules));
      }
    } catch {}
  }, { song: SONG, modules });
  await ctx.addInitScript(SINGER);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console ' + m.text().slice(0, 200)); });
  let n = 0;
  md.push(`\n## ${dev} (${ctxOpts.viewport.width}×${ctxOpts.viewport.height})\n`);
  const S = (fn, arg) => page.evaluate(fn, arg);
  const dbg = () => S(() => { const d = window.resonateSing.debug(); return { ear: d.ear, session: d.session && d.session.kind }; });
  const screen = () => S(() => {
    const vis = (el) => el && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden';
    const t = (id) => { const el = document.getElementById(id); return vis(el) ? el.innerText.replace(/\s*\n\s*/g, ' ⏎ ').trim() : '(hidden)'; };
    const btn = (id) => { const el = document.getElementById(id); return el ? `${el.textContent.trim()}${el.disabled ? ' (disabled)' : ''}` : '-'; };
    return { ear: t('ear'), listen: btn('listen'), sing: btn('sing'), status: t('status'), msg: t('msg') };
  });
  const shot = async (name, did) => {
    n++;
    const f = `${String(n).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: path.join(dir, f) });
    const s = await screen();
    md.push(`### ${dev} ${String(n).padStart(2, '0')} ${name}\n- did: ${did}\n- shot: ${dev}/${f}\n- Ear: ${s.ear}\n- dock: Listen = "${s.listen}", primary = "${s.sing}"\n- status line: ${s.status}${s.msg && s.msg !== '(hidden)' ? `\n- message: ${s.msg}` : ''}\n`);
    console.log(`${dev} ${f}: ${s.ear.slice(0, 120)} | ${s.listen} | ${s.sing}`);
  };
  const until = (fn, ms = 20000, arg) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
  const idle = () => until(() => { const e = window.resonateSing.debug().ear; return e.run === null && !window.resonateSing.debug().session; }, 40000);
  const phDur = () => S(() => { const d = window.resonateSing.debug(); const a = d.ear.ph.j0, z = d.ear.ph.j1; return d.notes[z - 1].t + d.notes[z - 1].d - d.notes[a].t; });
  const free = async (plan, name, did, { wait = 1200, shotMid = false } = {}) => {
    await page.click('#sing');
    await until(() => document.getElementById('sing').textContent.includes('Done'), 10000);
    if (plan) await S((p) => { window.__sing = { ...p, mode: 'free', at: performance.now() + p.wait }; }, { ...plan, wait });
    const dur = await phDur();
    const f = plan?.f || 1;
    if (shotMid) { await sleep(wait + dur * f * 500); await shot(`${name}-singing`, `${did} — mid-attempt`); await sleep(dur * f * 500 + 700); }
    else await sleep(wait + dur * f * 1000 + 700);
    await page.click('#sing');
    await until(() => { const e = window.resonateSing.debug().ear; return e.res && e.run === null; }, 15000);
    await S(() => { window.__sing = null; });
    await sleep(150);
    await shot(name, did);
  };

  await page.goto(BASE + '?open=sing');
  await until(() => window.resonateSing?.debug?.()?.ear?.on && document.getElementById('ear-words')?.textContent, 40000);
  await sleep(1500);
  await shot('open', 'opened Amazing Grace in the shell (Sing alone); Ear is the Sing screen');
  if (dev === 'ipad') {
    await free({ f: 1.15, cents: { 2: -200 } }, 'result-mixed', 'sang 15 % slower, the 3rd note 2 semitones flat, then ■ Done', { shotMid: true });
    await free({ f: 1.0 }, 'result-all-right', 'sang every note right, at the written tempo');
    await page.click('.ear-modes button[data-ear="beats"]'); await sleep(300);
    await shot('beats', 'tapped Beats');
    await page.click('.ear-modes button[data-ear="notes"]'); await sleep(300);
    await shot('notes', 'tapped Notes');
    await browser.close();
    return errs;
  }
  // Sing: hear, first note
  await page.click('#listen'); await sleep(700);
  await shot('hear-playing', 'tapped ▶ Hear (the dock’s left button): the phrase plays on the piano');
  await idle();
  await page.click('#ear-acts button[data-act="first"]'); await sleep(400);
  await shot('first-note', 'tapped ▶ First note');
  await idle();
  // ● Sing: waiting, ready, mid-attempt
  await page.click('#sing');
  await shot('sing-tapped', 'tapped ● Sing (the dock’s main button), before the mic answered');
  await until(() => document.getElementById('sing').textContent.includes('Done'), 10000);
  await sleep(200);
  await shot('sing-ready', 'the mic is open: ■ Done shows; the singer hasn’t started yet');
  await S(() => { window.__sing = { mode: 'free', at: performance.now() + 300, f: 1.2, cents: { 2: -200, 4: 150 } }; });
  const dur0 = await phDur();
  await sleep(300 + dur0 * 1.2 * 500);
  await shot('sing-singing', 'singing (20 % slower than written; 3rd note 2 semitones flat, 5th 1.5 semitones sharp)');
  await sleep(dur0 * 1.2 * 500 + 700);
  await page.click('#sing');
  await shot('done-thinking', 'tapped ■ Done: the analysis (under a second)');
  await until(() => { const e = window.resonateSing.debug().ear; return e.res && e.run === null; }, 15000);
  await S(() => { window.__sing = null; });
  await sleep(150);
  await shot('result-two-wrong', 'the result of that attempt');
  const cueNote = await page.$('#ear-res button[data-act="cue-note"]');
  if (cueNote) { await cueNote.click(); await sleep(300); await shot('cue-note-playing', 'tapped the cue’s ▶ note'); await idle(); }
  const cueYou = await page.$('#ear-res button[data-act="cue-you"]');
  if (cueYou) { await cueYou.click(); await sleep(300); await shot('cue-you-playing', 'tapped the cue’s ▶ you (the attempt’s recording there)'); await idle(); }
  await free({ f: 1.0 }, 'result-all-right', 'sang every note right, at the written tempo');
  const you = await page.$('#ear-res button[data-act="you"]');
  if (you) { await you.click(); await sleep(300); await shot('you-playing', 'tapped ▶ You'); await idle(); }
  await free({ f: 1.05, cents: { 1: 30, 3: -35 } }, 'result-again-close', 'again, slightly sharp / flat inside 50¢ on two notes');
  await free(null, 'result-silent', 'tapped ● Sing, sang nothing, tapped ■ Done', { wait: 1500 });
  await free({ f: 1.1, all: -300 }, 'result-whole-flat', 'a beginner: every note 3 semitones flat (started too low)');
  await free({ f: 1.3, cents: { 1: 250, 2: -180, 3: 220, 5: -260 }, jit: { 2: 0.35, 4: -0.3 } }, 'result-beginner-wild', 'a beginner: four notes way off, two starts early / late');
  await free({ f: 1.0, oct: -12 }, 'result-octave-down', 'a low voice: every note right an octave down');
  await free({ f: 1.0 }, 'result-late-start', 'waited 4 s after ■ Done showed, then sang it right', { wait: 4000 });
  await S(() => { window.__sing = { mode: 'talk' }; });
  await free(null, 'result-talking', 'talked (unpitched noise) instead of singing', { wait: 300 });
  await free({ f: 1.0, starts: { 6: 0.4 } }, 'result-late-word', 'sang it right, but came in 0.4 s late on “grace”');
  const stretch = await page.$('#ear-res button[data-act="cue-stretch"]');
  if (stretch) { await stretch.click(); await sleep(400); await shot('cue-stretch-playing', 'tapped the cue’s ▶ Piano (the stretch up to “grace”, at the attempt’s tempo)'); await idle(); }
  // Beats (by the result's next chip when it offers it)
  const toBeats = await page.$('#ear-res button[data-act="beats"]');
  if (toBeats) await toBeats.click(); else await page.click('.ear-modes button[data-ear="beats"]');
  await sleep(300);
  await shot('beats', toBeats ? 'tapped “Try it with the clicks ›”' : 'tapped Beats');
  await page.click('#listen'); await sleep(1200);
  await shot('beats-hear', 'tapped ▶ Hear in Beats: count-in clicks, then the line with the click');
  await idle();
  await S(() => { window.__sing = { mode: 'beats', late: 0.25 }; });
  await page.click('#sing'); await sleep(900);
  await shot('beats-countin', 'tapped ● Sing in Beats: the count-in');
  await until(() => window.resonateSing.debug().nowT > window.resonateSing.debug().notes[window.resonateSing.debug().ear.ph.j0].t + 1, 20000);
  await shot('beats-singing', 'singing with the click (every note 250 ms late)');
  await until(() => window.resonateSing.debug().ear.res?.kind === 'beats', 40000);
  await S(() => { window.__sing = null; }); await sleep(200);
  await shot('beats-result-late', 'the Beats result (every note 250 ms late)');
  await S(() => { window.__sing = { mode: 'beats', late: 0 }; });
  await page.click('#sing');
  await until(() => !!window.resonateSing.debug().session, 10000).catch(() => {});
  await until(() => !window.resonateSing.debug().session && window.resonateSing.debug().ear.run === null, 40000);
  await S(() => { window.__sing = null; }); await sleep(300);
  await shot('beats-result-on', 'the Beats result (on the click)');
  await page.click('#ear-acts .ear-speed button[data-f="0.7"]'); await sleep(300);
  await shot('beats-slower', 'tapped Slower (the ♩ menu goes to 70 %: Beats, ▶ Hear and ▶ First note at it)');
  await page.click('#ear-acts .ear-speed button[data-f="1"]'); await sleep(200);
  // Notes
  await page.click('.ear-modes button[data-ear="notes"]'); await sleep(300);
  await shot('notes', 'tapped Notes');
  await S(() => { window.__sing = { mode: 'hold', by: 2 }; });
  await page.click('#sing'); await sleep(500);
  await shot('notes-playing', 'tapped the main button: the target note plays');
  await until(() => window.resonateSing.debug().ear.run === 'hold', 10000); await sleep(400);
  await shot('notes-holding', 'holding (2 semitones sharp)');
  await until(() => window.resonateSing.debug().ear.run === null, 10000); await sleep(200);
  await shot('notes-miss1', 'the hold ended (nothing near the note for 2.5 s): the 1st miss');
  await page.click('#sing');
  await until(() => window.resonateSing.debug().ear.run === 'hold', 10000);
  await until(() => window.resonateSing.debug().ear.run === null, 10000); await sleep(200);
  await shot('notes-miss2', 'missed again (still 2 semitones sharp)');
  await page.click('#ear-notes button[data-act="try"]');
  await until(() => window.resonateSing.debug().ear.run === 'hold', 10000);
  await until(() => window.resonateSing.debug().ear.run === null, 10000); await sleep(200);
  await shot('notes-miss3', 'tapped ▶ Try again, missed a 3rd time (still 2 semitones sharp)');
  await S(() => { window.__sing = { mode: 'hold', by: -12, cents: 10 }; });
  await page.click('#sing');
  await until(() => (window.resonateSing.debug().ear.notes?.done || []).length >= 1, 15000); await sleep(1000);
  await shot('notes-match-octave', 'held it an octave down');
  for (let k = 0; k < 6; k++) {
    const e = (await dbg()).ear;
    if (e.mode !== 'notes' || e.notes?.complete) break;
    await page.click('#sing');
    await until(() => window.resonateSing.debug().ear.run === 'hold' || window.resonateSing.debug().ear.mode !== 'notes', 10000);
    await until(() => window.resonateSing.debug().ear.run === null, 15000); await sleep(900);
    await shot(`notes-match-${k + 2}`, 'held the next target (in that octave)');
  }
  await page.click('#ear-acts button[data-act="oct"]').catch(() => {}); await sleep(200); // (the written octave again)
  await S(() => { window.__sing = null; });
  // phrases
  await page.click('#ear-next'); await sleep(400);
  await shot('phrase-2', 'tapped › (next line)');
  for (let k = 0; k < 6; k++) { const b = await page.$('#ear-next:not([disabled])'); if (!b) break; await b.click(); await sleep(200); }
  await shot('phrase-last', 'the last line');
  // ⚙
  const gear = await page.$('#options-btn, #opts, button[aria-label*="ptions"], button[title*="ptions"]');
  if (gear) { await gear.click(); await sleep(500); await shot('options', 'opened ⚙'); }
  await browser.close();
  return errs;
}

(async () => {
  const all = [];
  if (ONLY !== 'ipad') all.push(...await walk('phone', { ...devices['iPhone 13'], deviceScaleFactor: 2 }, { phone: ['sing'], tablet: ['sing'], desktop: ['sing'] }));
  if (ONLY !== 'phone') all.push(...await walk('ipad', { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: devices['iPad (gen 7)'].userAgent }, { phone: ['sing'], tablet: ['sing'], desktop: ['sing'] }));
  md.unshift(`# Ear walkthrough (${new Date().toISOString().slice(0, 16)}, ${BASE})\n\nSong: ${SONG}. The singer is simulated (a sawtooth at the planned pitches). Page errors: ${all.length ? all.join('; ') : 'none'}\n`);
  fs.writeFileSync(path.join(SHOTS, 'walk.md'), md.join('\n'));
  console.log(`\n${path.join(SHOTS, 'walk.md')}; errors: ${all.length}`);
})().catch((e) => { console.error(e); process.exit(1); });
