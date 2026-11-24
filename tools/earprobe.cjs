// Ear probe: run attempts with a simulated singer and print what Ear made of each — for checking its
// judgments (sing.js "Ear", public/ear.js; docs/EAR.md). Not a pass/fail suite (tools/earcases.mjs judges
// the same plans in node).
//   PLANS='[{"name":"late 3rd","mode":"free","f":1.1,"starts":{"2":0.3}}]' node earprobe.cjs
//   PLANS=@file.json node earprobe.cjs            SONG=amazing-grace (default)   SHOTS=<dir> (a screenshot each)
//   OWN='[[8,11]]'                                 (lines of the singer's own first — Pick words: notes [j0, j1); `phrase` counts them in)
//   XML=<file.musicxml> [TITLE=…]                  (a song of one's own instead of a sample — added to My songs in this run's browser
//                                                   profile; the owner's songs stay outside the repo)
// A plan: { name, phrase (0-based, default 0), mode: "free" | "beats" | "hold" | "talk", ... } and the singer's
//   fields (tools/lib/earsinger.cjs: every note index is the note's index in the phrase, 0-based) —
//   free:  f (tempo factor: 1.2 = 20 % slower), curve (the tempo easing from 1 to 1 + curve across the line: a
//          ritardando; − an accelerando), wait (ms after ■ Done shows, default 1000), cents {i: ¢},
//          all (¢ every note), wrong {i: semitones}, oct, drift (¢ by the end), vib (¢), scoop (¢),
//          jit {i: s late, the whole note}, starts {i: s, only its start} (+ gap: true), drop [i], stop: i,
//          held (s: the last note held at most this), false {n, gap}, extra: n, hum {m, d}, vol, silent: true.
//          ■ Done is tapped `done` s after the singer's last note (default 0.7; negative: while still singing).
//   talk:  noise bursts instead of singing (wait, f, done as free)
//   beats: late (s every note), f, curve, cents, all, oct, drift, vib, jit, starts, drop, vol; slow (0.9 / 0.8 / 0.7:
//          the ♩ menu set to that % of the song's tempo first; none: 100 %); label (the mic track's: "AirPods")
//   hold:  by (semitones off the target), cents, vib; target (index in Notes' targets, default the current) — each
//          hold plan is one more try at the note (the misses add up: Not yet → which way → ▶ Sing along …)
// Prints one JSON line per plan: the plan, `sum` (tools/lib/earsum.cjs — the line earcases.mjs prints for the same
// plan in node), `spot` ("spot", or why not: notes / beats not all, another key, unmeasured, sag, hair …), the result
// on screen, the counts, the win and the cue (text, kind, dir, size, note), the fitted tempo (b) and start (a), the
// onsets measured (of the starts), the key offset found (c, ¢), its s and direction (keyS, keyDir — the build's
// key.dir — and keyWord: the key / offset cue's lower / higher), rit, anchored, spotOk, Beats' tolerance (tol, u0)
// and the notes not reached — each null where this build's judgment doesn't give it — and per note:
// its text, the target, where the singer started it (sung: s after the phrase's start, moved: s off its
// written place × f — a false start's restart counted from the restart), the grade's status and its
// deviation (¢), Beats' class.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { BASE } = require('./lib/paths.cjs');
const { SINGER } = require('./lib/earsinger.cjs');
const { summary, spotWhy } = require('./lib/earsum.cjs');
const sleep = (t) => new Promise((r) => setTimeout(r, t));
const SONG = process.env.SONG || 'amazing-grace';
let PLANS = process.env.PLANS || '[{"name":"all right","mode":"free","f":1}]';
if (PLANS.startsWith('@')) PLANS = fs.readFileSync(PLANS.slice(1), 'utf8');
PLANS = JSON.parse(PLANS);
const SHOTS = process.env.SHOTS || '';

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: SHOTS ? 2 : 1 });
  await ctx.addInitScript((song) => { try { if (!localStorage.getItem('probe.xml')) localStorage.setItem('resonate.sing.song', song); } catch {} }, SONG);
  await ctx.addInitScript(SINGER);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  await page.goto(BASE + 'sing.html');
  await page.waitForFunction(() => window.resonateDebug?.().ear?.on && document.getElementById('ear-words').textContent, null, { timeout: 30000 });
  if (process.env.XML) {
    const xml = fs.readFileSync(process.env.XML, 'utf8');
    const title = process.env.TITLE || path.basename(process.env.XML).replace(/\.[^.]+$/, '');
    await page.evaluate(async ([x, t]) => {
      const v = document.getElementById('version').textContent.trim().replace(/^v/, '');
      const id = await (await import(`./library.js?v=${v}`)).addSong(t, x);
      localStorage.setItem('probe.xml', '1');
      localStorage.setItem('resonate.sing.song', id);
    }, [xml, title]);
    await page.reload();
    await page.waitForFunction(() => window.resonateDebug?.().ear?.on && document.getElementById('ear-words').textContent, null, { timeout: 90000 });
  }
  // OWN='[[8,11]]': lines of the singer's own first (Pick words: notes [j0, j1) of the song) — a plan's `phrase` then
  // counts them in, in song order (resonateDebug().ear.lines)
  if (process.env.OWN) {
    await page.evaluate(async (spans) => {
      const v = document.getElementById('version').textContent.trim().replace(/^v/, '');
      const P = await import(`./practice.js?v=${v}`), notes = window.resonateDebug().notes, song = window.resonateDebug().songId || localStorage.getItem('resonate.sing.song');
      const all = JSON.parse(localStorage.getItem('resonate.sing.eardata') || '{}');
      all[song] = { ...(all[song] || {}), own: spans.map(([a, b]) => ({ j0: a, j1: b, wk: P.phraseKeys(notes, Array.from({ length: b - a }, (_, k) => a + k)).wk })) };
      localStorage.setItem('resonate.sing.eardata', JSON.stringify(all));
    }, JSON.parse(process.env.OWN));
    await page.reload();
    await page.waitForFunction(() => window.resonateDebug?.().ear?.on && document.getElementById('ear-words').textContent, null, { timeout: 30000 });
  }
  const S = (fn, arg) => page.evaluate(fn, arg);
  const until = (fn, ms = 20000, arg) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
  let k = 0;
  for (const plan of PLANS) {
    k++;
    // the phrase and the mode
    const want = plan.phrase || 0;
    // (‹ › one line at a time — an owner's song has 40-odd lines; stops where a tap moves nothing)
    for (let i = 0, last = null; i < 400; i++) {
      const p = await S(() => window.resonateDebug().ear.p);
      if (p === want || p === last) break;
      last = p;
      await page.click(p < want ? '#ear-next' : '#ear-prev');
      await sleep(80);
    }
    const mode = plan.mode === 'beats' ? 'beats' : plan.mode === 'hold' ? 'notes' : 'line';
    await page.click(`.ear-modes button[data-ear="${mode}"]`);
    await sleep(150);
    const out = { name: plan.name || `plan ${k}`, plan };
    await S(() => { window.__sung = null; }); // (the singer's record of this plan only: a hold or talk sings none)
    try {
      if (mode === 'line') {
        await page.click('#sing');
        await until(() => document.getElementById('sing').textContent.includes('Done'), 10000);
        const wait = plan.wait ?? 1000;
        const sung = plan.mode === 'talk' ? { mode: 'talk' } : plan.silent ? null : { ...plan, mode: 'free' };
        await S(([p, w]) => { window.__sing = p && { ...p, at: performance.now() + w }; }, [sung, wait]);
        const dur = await S(() => { const d = window.resonateDebug(); const a = d.ear.ph.j0, z = d.ear.ph.j1; return d.notes[z - 1].t + d.notes[z - 1].d - d.notes[a].t; });
        // (the singer's own last note: a false start, `extra`, `stop` move it)
        await sleep(100);
        const last = sung && sung.mode === 'free' ? await S(() => { const u = window.__sung; return u && u.segs.length ? Math.max(...u.segs.map((o) => o.e)) : null; }) : null;
        await sleep(Math.max(0, wait - 100 + (last ?? dur * (plan.f || 1)) * 1000 + 1000 * (plan.done ?? 0.7)));
        await page.click('#sing');
        await until(() => { const e = window.resonateDebug().ear; return e.res && e.run === null; }, 15000);
      } else if (mode === 'beats') {
        // (the ♩ menu — Beats sings at its tempo — to the plan's speed, 100 % without one: a plan doesn't inherit the last one's)
        const want = plan.slow || 1;
        const set = await S((w) => { const sel = document.getElementById('tempo-select'), o = [...sel.options].find((x) => x.value === `r:${w}`); if (!o) return false; if (sel.value !== o.value) { sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })); } return true; }, want);
        await sleep(150);
        out.slow = await S(() => window.resonateDebug().rate);
        if (!set || Math.abs(out.slow - want) > 1e-6) throw new Error(`the tempo is ${out.slow}, not ${want} (no ♩ menu option r:${want}?)`);
        await S((p) => { window.__sing = { ...p, mode: 'beats' }; }, plan);
        await page.click('#sing');
        await until(() => !!window.resonateDebug().session, 10000);
        await until(() => !window.resonateDebug().session && window.resonateDebug().ear.run === null, 60000);
      } else {
        if (plan.target != null) {
          const ok = await S((t) => { const N = window.resonateDebug().ear.notes; return !!N && t < N.targets.length; }, plan.target);
          if (ok) await S((t) => { /* tap the target's name */ const d = window.resonateDebug(); const j = d.ear.notes.js[t]; const b = document.querySelector(`#ear-notes button[data-j="${j}"]`) || [...document.querySelectorAll('#ear-notes button')].find((x) => x.textContent); b?.click(); }, plan.target);
        }
        await S((p) => { window.__sing = { ...p, mode: 'hold' }; }, plan);
        await page.click('#sing');
        await until(() => window.resonateDebug().ear.run === 'hold', 10000);
        await until(() => window.resonateDebug().ear.run === null, 15000);
        await sleep(900);
      }
    } catch (e) { out.error = String(e.message || e).slice(0, 200); }
    await S(() => { window.__sing = null; });
    await sleep(150);
    Object.assign(out, await S(() => {
      const d = window.resonateDebug(), e = d.ear, r = e.res;
      const ui = document.getElementById('ear-res').innerText.replace(/\s*\n\s*/g, ' | ').trim();
      const notesUi = document.getElementById('ear-notes').hidden ? '' : document.getElementById('ear-notes').innerText.replace(/\s*\n\s*/g, ' ').trim();
      const ph = e.ph;
      const fit = r?.fit;
      const u = window.__sung; // the singer's plan as sung (its last time through a note: a false start's restart)
      const sungOf = (i) => { const o = u?.segs ? [...u.segs].reverse().find((x) => x.i === i) : null; return o ? { s: +o.s.toFixed(3), moved: +(o.s - o.w).toFixed(3) } : null; };
      const perNote = ph ? Array.from({ length: ph.j1 - ph.j0 }, (_, i) => {
        const j = ph.j0 + i, n = d.notes[j];
        const g = r?.grades?.[i] || null;
        const rn = r?.kind === 'beats' ? (r.rn?.[i] || null) : null, st = r?.starts?.[i] || null;
        const su = u ? sungOf(i) : undefined;
        return { i, text: n.text || '', t: +n.t.toFixed(3), mel: !!n.melisma, d: +n.d.toFixed(2), target: n.midi + (n.shift || 0), sung: su, status: g?.status ?? null, dev: g?.dev != null ? Math.round(g.dev * 100) : null, shift: g?.shift != null ? +g.shift.toFixed(3) : null, beat: rn ? { cls: rn.cls, dev: rn.dev != null ? +rn.dev.toFixed(3) : null, rdev: rn.rdev != null ? +rn.rdev.toFixed(3) : null, tol: st?.tol ?? null, u0: st?.u0 ?? null } : undefined, start: st && r?.kind !== 'beats' ? { on: st.on, measured: st.measured, r: st.r ?? null } : undefined };
      }) : [];
      const { win, cue } = r || {};
      // (the result as earsum.cjs reads it — summary and spotWhy, in node)
      const slim = r ? { kind: r.kind, counts: r.counts || null, win: win ? { kind: win.kind, text: win.text, j: win.j ?? null } : null, cue: cue ? { kind: cue.kind, text: cue.text, j: cue.j ?? null, dir: cue.dir ?? null, size: cue.size ?? null } : null,
        fit: fit ? { a: fit.a, b: fit.b } : null, onsets: r.onsets ?? null, key: r.key ?? null, notReached: r.notReached ?? null, rit: r.rit ?? null, anchored: r.anchored ?? null, spotOk: r.spotOk ?? null,
        hair: r.hair ?? null, u0: r.u0 ?? null, starts: r.starts ? Object.fromEntries(Object.entries(r.starts).map(([k, x]) => [k, { on: !!x?.on, measured: !!x?.measured }])) : null } : null;
      return { slim, ph: ph ? { j0: ph.j0, j1: ph.j1 } : null, phrase: e.p, words: document.getElementById('ear-words').textContent, ui, notesUi, counts: r?.counts || null,
        win: win?.text || null, winKind: win?.kind ?? null, cue: cue?.text || null, cueKind: cue?.kind ?? null, cueDir: cue?.dir ?? null, cueSize: cue?.size ?? null, cueAt: cue?.j != null && ph ? cue.j - ph.j0 : null,
        fit: fit ? { a: +fit.a.toFixed(3), b: +fit.b.toFixed(3) } : null, b: fit ? +fit.b.toFixed(3) : null, onsets: r?.onsets ?? null, offset: r?.key?.c ?? null, key: r?.key ?? null,
        keyS: r?.key?.s ?? null, keyDir: r?.key?.dir ?? null, keyWord: cue && ['key', 'offset'].includes(cue.kind) ? (cue.text.match(/\b(lower|higher)\b/) || [])[1] ?? null : null,
        rit: r?.rit ?? null, anchored: r?.anchored ?? null, spotOk: r?.spotOk ?? null, tol: r?.tol ?? null, u0: r?.u0 ?? null, notReached: r?.notReached ?? null,
        say: e.words ?? null, hint: e.hint ?? null, speed: e.speed ?? null, // (WP5: what the screen says — ear.js earText's words, the hint, Normal / Slow / Slower)
        notes: e.notes ? { msg: e.notes.msg, done: e.notes.done, targets: e.notes.targets, cur: e.notes.cur ?? null, off: e.notes.off ?? null, tries: e.notes.tries ?? null, v: e.notes.v ?? null, complete: e.notes.complete ?? null } : null, oct: e.oct ?? null, perNote };
    }));
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); const f = path.join(SHOTS, `probe-${String(k).padStart(2, '0')}.png`); await page.screenshot({ path: f }); out.shot = f; }
    // (the line earcases.mjs prints for this plan in node, and why it isn't "Spot on" — first, for a glance)
    const { slim, ph: lph } = out;
    delete out.slim; delete out.ph;
    console.log(JSON.stringify({ name: out.name, sum: slim ? summary(slim, lph) : null, spot: slim ? spotWhy(slim, mode === 'beats') : null, ...out }));
  }
  if (errs.length) console.log(JSON.stringify({ pageErrors: errs.slice(0, 5) }));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
