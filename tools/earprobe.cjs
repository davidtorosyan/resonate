// Ear probe: run attempts with a simulated singer and print what Ear made of each — for checking its
// judgments (sing.js "Ear", public/ear.js; docs/EAR.md). Not a pass/fail suite (tools/earcases.mjs judges
// the same plans in node).
//   PLANS='[{"name":"late 3rd","mode":"free","f":1.1,"starts":{"2":0.3}}]' node earprobe.cjs
//   PLANS=@file.json node earprobe.cjs            SONG=amazing-grace (default)   SHOTS=<dir> (a screenshot each)
// A plan: { name, phrase (0-based, default 0), mode: "free" | "beats" | "hold" | "talk", ... } and the singer's
//   fields (tools/lib/earsinger.cjs: every note index is the note's index in the phrase, 0-based) —
//   free:  f (tempo factor: 1.2 = 20 % slower), wait (ms after ■ Done shows, default 1000), cents {i: ¢},
//          all (¢ every note), wrong {i: semitones}, oct, drift (¢ by the end), vib (¢), scoop (¢),
//          jit {i: s late, the whole note}, starts {i: s, only its start} (+ gap: true), drop [i], stop: i,
//          held (s: the last note held at most this), false {n, gap}, extra: n, hum {m, d}, vol, silent: true.
//          ■ Done is tapped `done` s after the singer's last note (default 0.7; negative: while still singing).
//   beats: late (s every note), f, cents, all, oct, drift, vib, jit, starts, drop, vol; slow (0.9 / 0.8 / 0.7:
//          the ♩ menu set to that % of the song's tempo first; none: 100 %)
//   hold:  by (semitones off the target), cents, vib; target (index in Notes' targets, default the current)
// Prints one JSON line per plan: the plan, the result on screen, the counts, the win and the cue (text, kind,
// dir, note), the fitted tempo (b) and start (a), the onsets measured (of the starts), the key offset found
// (c, ¢) and the notes not reached — each null where this build's judgment doesn't give it — and per note:
// its text, the target, where the singer started it (sung: s after the phrase's start, moved: s off its
// written place × f — a false start's restart counted from the restart), the grade's status and its
// deviation (¢), Beats' class.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { BASE } = require('./lib/paths.cjs');
const { SINGER } = require('./lib/earsinger.cjs');
const sleep = (t) => new Promise((r) => setTimeout(r, t));
const SONG = process.env.SONG || 'amazing-grace';
let PLANS = process.env.PLANS || '[{"name":"all right","mode":"free","f":1}]';
if (PLANS.startsWith('@')) PLANS = fs.readFileSync(PLANS.slice(1), 'utf8');
PLANS = JSON.parse(PLANS);
const SHOTS = process.env.SHOTS || '';

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: SHOTS ? 2 : 1 });
  await ctx.addInitScript((song) => { try { localStorage.setItem('resonate.sing.song', song); } catch {} }, SONG);
  await ctx.addInitScript(SINGER);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  await page.goto(BASE + 'sing.html');
  await page.waitForFunction(() => window.resonateDebug?.().ear?.on && document.getElementById('ear-words').textContent, null, { timeout: 30000 });
  const S = (fn, arg) => page.evaluate(fn, arg);
  const until = (fn, ms = 20000, arg) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
  let k = 0;
  for (const plan of PLANS) {
    k++;
    // the phrase and the mode
    const want = plan.phrase || 0;
    for (let i = 0; i < 20; i++) {
      const p = await S(() => window.resonateDebug().ear.p);
      if (p === want) break;
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
        const rn = r?.kind === 'beats' ? (r.rn?.[i] || null) : null;
        const su = u ? sungOf(i) : undefined;
        return { i, text: n.text || '', t: +n.t.toFixed(3), mel: !!n.melisma, d: +n.d.toFixed(2), target: n.midi + (n.shift || 0), sung: su, status: g?.status ?? null, dev: g?.dev != null ? Math.round(g.dev * 100) : null, shift: g?.shift != null ? +g.shift.toFixed(3) : null, beat: rn ? { cls: rn.cls, dev: rn.dev != null ? +rn.dev.toFixed(3) : null, rdev: rn.rdev != null ? +rn.rdev.toFixed(3) : null } : undefined };
      }) : [];
      const { win, cue } = r || {};
      return { phrase: e.p, words: document.getElementById('ear-words').textContent, ui, notesUi, counts: r?.counts || null,
        win: win?.text || null, winKind: win?.kind ?? null, cue: cue?.text || null, cueKind: cue?.kind ?? null, cueDir: cue?.dir ?? null, cueAt: cue?.j != null && ph ? cue.j - ph.j0 : null,
        fit: fit ? { a: +fit.a.toFixed(3), b: +fit.b.toFixed(3) } : null, onsets: r?.onsets ?? null, offset: r?.key?.c ?? null, key: r?.key ?? null, notReached: r?.notReached ?? null,
        notes: e.notes ? { msg: e.notes.msg, done: e.notes.done, targets: e.notes.targets } : null, perNote };
    }));
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); const f = path.join(SHOTS, `probe-${String(k).padStart(2, '0')}.png`); await page.screenshot({ path: f }); out.shot = f; }
    console.log(JSON.stringify(out));
  }
  if (errs.length) console.log(JSON.stringify({ pageErrors: errs.slice(0, 5) }));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
