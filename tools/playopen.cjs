// E1 (docs/ROADMAP.md): a song opens in the view chosen for it last, else the Full score when it has
// one, else Both — on play.html and in the shell's Score, an iPad, a phone, a desktop; an assistant's
// score_open follows the same rule. Also: the Full score opened by default is laid out as the one
// switched to from Both (the same size, mode and pages), and one that can't draw gives way to Both.
//   node playopen.cjs            (BASE=http://localhost:8097/resonate/; ONLY=ipad,phone,desktop)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { ok, done, fail } = require('./lib/check.cjs');
const { BASE, FIX } = require('./lib/paths.cjs');

const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const DEVICES = [
  { n: 'ipad', w: 820, h: 1180, dev: 'tablet' },
  { n: 'phone', w: 393, h: 852, dev: 'phone' },
  { n: 'desktop', w: 1440, h: 900, dev: 'desktop', mouse: true },
].filter((d) => !ONLY || ONLY.has(d.n));
const read = (f) => fs.readFileSync(path.join(FIX, 'play', f), 'utf8');
const PVG = read('synth-pvg.musicxml');
// Songs added to the library: name → { xml, rec (its resonate.play record: a view chosen, an older
// record with no view, a view this song doesn't have) }. "plain": the piano/vocal song without words —
// no Full score, but more views than Both (both, rh, lh).
const SONGS = {
  pvg: { xml: PVG },
  pvg2: { xml: PVG.replace(/<movement-title>[^<]*/, '<movement-title>Second') },
  voice: { xml: read('synth-voice.musicxml') },
  plain: { xml: PVG.replace(/<lyric\b[\s\S]*?<\/lyric>/g, '') },
  chosenBoth: { xml: read('synth-longest.musicxml'), rec: { view: 'both' } },
  chosenRh: { xml: read('score-pvg.musicxml'), rec: { view: 'rh' } },
  older: { xml: read('score-duet.musicxml'), rec: { names: 'some', at: 0, speed: 1 } },
  missing: { xml: read('score-tunein.musicxml'), rec: { view: 'chords' } },
};

let browser;
async function context(d, seed = {}) {
  const ctx = await browser.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: 1, ...(d.mouse ? {} : { isMobile: true, hasTouch: true }) });
  await ctx.route('**/*.supabase.co/**', (r) => r.abort());
  await ctx.addInitScript((seed) => {
    try {
      if (location.protocol === 'about:' || sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    } catch {}
  }, seed);
  ctx.errors = [];
  ctx.on('page', (p) => {
    p.on('pageerror', (e) => ctx.errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|supabase|Failed to fetch|sync/i.test(m.text())) ctx.errors.push(m.text()); });
  });
  return ctx;
}
// Play's own debug: play.html's resonateDebug, the shell's resonatePlay.debug.
const play = (p) => p.evaluate(() => {
  const d = (window.resonatePlay?.debug || window.resonateDebug)?.()?.play;
  if (!d) return null;
  const { facts, countAll, ...rest } = d;
  return { ...rest, menu: document.getElementById('hands')?.value ?? null, msg: document.getElementById('msg')?.hidden === false ? document.getElementById('msg').textContent : '' };
}).catch(() => null);
async function until(p, pred, ms = 60000) {
  const end = Date.now() + ms;
  let d = null;
  while (Date.now() < end) { d = await play(p); try { if (d && pred(d)) return d; } catch {} await p.waitForTimeout(100); }
  return d;
}
const drawn = (p, song, view) => until(p, (d) => d.song === song && (d.ready || d.failed) && (!view || d.view === view));
const record = (p, id) => p.evaluate((id) => JSON.parse(localStorage.getItem('resonate.play') || '{}')[id] || null, id);
// Songs into the library through the page's own module (the badge's version), records written.
async function seed(p) {
  return p.evaluate(async (songs) => {
    const v = document.getElementById('version').textContent.trim().replace(/^v/, '');
    const L = await import(`./library.js?v=${v}`);
    const ids = {}, all = JSON.parse(localStorage.getItem('resonate.play') || '{}');
    for (const [name, s] of Object.entries(songs)) {
      ids[name] = await L.addSong(name, s.xml, { source: 'file' });
      if (s.rec) all[ids[name]] = s.rec;
    }
    localStorage.setItem('resonate.play', JSON.stringify(all));
    return ids;
  }, SONGS);
}
// The layout: no sideways scroll, the music inside the stage.
const layout = (p) => p.evaluate(() => {
  const st = document.getElementById('stage').getBoundingClientRect();
  const pages = [...document.querySelectorAll('#stage .page')].map((e) => e.getBoundingClientRect()).filter((b) => b.width);
  return { sw: document.scrollingElement.scrollWidth, iw: innerWidth, pages: pages.length, inside: pages.every((b) => b.left >= st.left - 1 && b.right <= st.right + 1 && b.bottom <= st.bottom + 1) };
});
const shape = (d) => ({ sp: Math.round(d.sp * 100) / 100, mode: d.mode, pages: d.pages, W: d.W, H: d.H });

// --- play.html ---------------------------------------------------------------------------------------
async function playPage(dv) {
  console.log(`\n=== play.html, ${dv.n} ${dv.w}×${dv.h}`);
  const ctx = await context(dv);
  const p = await ctx.newPage();
  await p.goto(BASE + 'play.html');
  let d = await drawn(p, 'amazing-grace');
  ok(d?.ready && d.view === 'score' && d.menu === 'score', `${dv.n}: a song never opened (Amazing Grace) opens in the Full score (${d?.view}, menu ${d?.menu}, views ${d?.views})`);
  ok(d?.keep?.kind === 'score' && d.counts.rendered > 0 && !d.failed && !d.msg, `${dv.n}: the Full score drawn (${d?.counts?.rendered} heads, ${d?.pages} pages, ${d?.mode} at ${d?.sp?.toFixed(2)} px)`);
  ok(d?.device === dv.dev, `${dv.n}: laid out as a ${dv.dev} (${d?.device})`);
  if (dv.dev === 'phone') ok(['two', 'one', 'fitted'].includes(d?.mode), `${dv.n}: the phone's Full score rules (${d?.mode})`);
  const lay = await layout(p);
  ok(lay.sw <= lay.iw && lay.pages > 0 && lay.inside, `${dv.n}: no sideways scroll, the music inside the stage (${JSON.stringify(lay)})`);
  ok(!(await record(p, 'amazing-grace'))?.view, `${dv.n}: the default isn't saved as the song's view (${JSON.stringify(await record(p, 'amazing-grace'))})`);
  const byDefault = shape(d);

  // the songs, each opened from the menu
  const ids = await seed(p);
  await p.evaluate((id) => localStorage.setItem('resonate.sing.song', id), ids.pvg);
  await p.reload();
  d = await drawn(p, ids.pvg);
  ok(d?.ready && d.view === 'score', `${dv.n}: a new song with a Full score opens in it (${d?.view})`);
  const want = { pvg2: 'score', voice: 'both', plain: 'both', chosenBoth: 'both', chosenRh: 'rh', older: 'score', missing: 'score' };
  const what = { pvg2: 'another new song', voice: 'a voice-only song (Both alone)', plain: 'a song with no Full score (both, rh, lh)', chosenBoth: 'Both chosen for it', chosenRh: 'Right hand chosen for it', older: 'an older record with no view', missing: 'a saved view the song doesn\'t have' };
  for (const [name, v] of Object.entries(want)) {
    await p.selectOption('#song', ids[name]);
    d = await drawn(p, ids[name]);
    ok(d?.ready && d.view === v && d.menu === v, `${dv.n}: ${what[name]} → ${v} (${d?.view}, views ${d?.views})`);
  }
  ok(!(await record(p, ids.plain))?.view && (await record(p, ids.chosenRh))?.view === 'rh', `${dv.n}: opening saves no view; a chosen one stays (${JSON.stringify(await record(p, ids.chosenRh))})`);

  // a choice from the menu, kept across a song switch and a reload
  await p.selectOption('#song', ids.pvg);
  await drawn(p, ids.pvg, 'score');
  for (const v of ['lh', 'both', 'score']) {
    await p.selectOption('#hands', v);
    await drawn(p, ids.pvg, v);
    await p.selectOption('#song', ids.pvg2);
    await drawn(p, ids.pvg2);
    await p.selectOption('#song', ids.pvg);
    d = await drawn(p, ids.pvg);
    ok(d?.view === v, `${dv.n}: ${v} chosen, another song, back → ${d?.view}`);
    await p.reload();
    d = await drawn(p, ids.pvg);
    ok(d?.view === v && (await record(p, ids.pvg))?.view === v, `${dv.n}: ${v} chosen → after a reload ${d?.view} (saved ${(await record(p, ids.pvg))?.view})`);
  }

  // an assistant's score_open (no view): the same rule; with a view: that view, kept
  const run = (a, args) => p.evaluate(([a, args]) => window.resonatePlay.scoreRun(a, args), [a, args]);
  const fresh = await p.evaluate(async (xml) => {
    const v = document.getElementById('version').textContent.trim().replace(/^v/, '');
    const L = await import(`./library.js?v=${v}`);
    const id = await L.addSong('Third', xml, { source: 'file' });
    window.dispatchEvent(new CustomEvent('resonate:remote', { detail: { songs: true } })); // (the song menu lists it)
    return id;
  }, PVG);
  await p.waitForFunction((id) => !!document.querySelector(`#song option[value="${id}"]`), fresh, { timeout: 10000 }).catch(() => {});
  let r = await run('score_open', { song: fresh });
  ok(r?.ok && r.score?.view === 'score', `${dv.n}: score_open, a new song → the Full score (${r?.score?.view}${r?.error ? ', ' + r.error : ''})`);
  r = await run('score_open', { song: ids.chosenRh });
  ok(r?.ok && r.score?.view === 'rh', `${dv.n}: score_open, Right hand chosen for it → rh (${r?.score?.view})`);
  r = await run('score_open', { song: ids.plain });
  ok(r?.ok && r.score?.view === 'both', `${dv.n}: score_open, no Full score → both (${r?.score?.view})`);
  r = await run('score_open', { song: fresh, view: 'both' });
  ok(r?.ok && r.score?.view === 'both' && (await record(p, fresh))?.view === 'both', `${dv.n}: score_open with a view → that view, kept (${r?.score?.view}, saved ${(await record(p, fresh))?.view})`);
  ok(!ctx.errors.length, `${dv.n}: no page errors (${ctx.errors.slice(0, 3).join(' | ')})`);
  await ctx.close();

  // the Full score opened by default = the one switched to from Both (the same stage, a fresh page)
  const ctx2 = await context(dv, { 'resonate.play': JSON.stringify({ 'amazing-grace': { view: 'both' } }) });
  const p2 = await ctx2.newPage();
  await p2.goto(BASE + 'play.html');
  d = await drawn(p2, 'amazing-grace');
  ok(d?.view === 'both', `${dv.n}: Both chosen for Amazing Grace → both (${d?.view})`);
  await p2.selectOption('#hands', 'score');
  d = await drawn(p2, 'amazing-grace', 'score');
  ok(JSON.stringify(shape(d)) === JSON.stringify(byDefault), `${dv.n}: the Full score by default is laid out as the one switched to (${JSON.stringify(byDefault)} vs ${JSON.stringify(shape(d))})`);
  await ctx2.close();

  // a Full score that can't draw (buildView throws for it): the song opens in Both all the same
  const ctx3 = await context(dv);
  await ctx3.route(/\/playprep\.js/, async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace(/export function buildView\(([^)]*)\) \{/, (m, a) => `${m} if (${a.split(',')[1]}?.kind === "score") throw new Error("test: no Full score");`);
    await route.fulfill({ response: res, body });
  });
  const p3 = await ctx3.newPage();
  await p3.goto(BASE + 'play.html');
  d = await drawn(p3, 'amazing-grace');
  ok(d?.ready && d.view === 'both' && d.menu === 'both' && !d.failed && !d.msg, `${dv.n}: the Full score fails to build → opens in Both (${d?.view}, failed ${d?.failed}, "${d?.msg}")`);
  await p3.selectOption('#hands', 'score');
  d = await until(p3, (x) => x.failed || (x.ready && x.view === 'score'), 20000);
  ok(d?.failed === 'song' && !(await record(p3, 'amazing-grace'))?.view, `${dv.n}: chosen from the menu it still says so, and isn't kept (${d?.failed})`);
  await ctx3.close();
}

// --- the shell's Score -------------------------------------------------------------------------------
async function shellScore(dv) {
  console.log(`\n=== the shell's Score, ${dv.n} ${dv.w}×${dv.h}`);
  // (a phone opens Sing alone by default: the Score alone here)
  const ctx = await context(dv, dv.dev === 'phone' ? { 'resonate.shell.modules': JSON.stringify({ phone: ['score'] }) } : {});
  const p = await ctx.newPage();
  await p.goto(BASE + 'index.html');
  await p.waitForFunction(() => window.resonateDebug?.().tuner, null, { timeout: 20000 });
  const ids = await seed(p);
  await p.reload();
  await p.waitForFunction(() => window.resonateDebug?.().tuner, null, { timeout: 20000 });
  const openFromList = async (id) => {
    await p.click('#songs-btn');
    await p.waitForSelector(`#songs-body .song[data-id="${id}"]`, { timeout: 8000 });
    await p.click(`#songs-body .song[data-id="${id}"]`);
  };
  await openFromList('amazing-grace');
  let d = await drawn(p, 'amazing-grace');
  ok(d?.ready && d.view === 'score' && d.menu === 'score' && d.keep?.kind === 'score', `${dv.n}: Amazing Grace from Songs → the Full score (${d?.view}, ${d?.pages} pages, ${d?.mode} at ${d?.sp?.toFixed(2)} px)`);
  if (dv.dev === 'phone') ok(['two', 'one', 'fitted'].includes(d?.mode), `${dv.n}: the phone's Full score rules (${d?.mode})`);
  const lay = await layout(p);
  ok(lay.sw <= lay.iw && lay.pages > 0 && lay.inside, `${dv.n}: no sideways scroll, the music inside the stage (${JSON.stringify(lay)})`);
  for (const [name, v] of [['pvg', 'score'], ['chosenRh', 'rh'], ['plain', 'both'], ['chosenBoth', 'both']]) {
    await openFromList(ids[name]);
    d = await drawn(p, ids[name]);
    ok(d?.ready && d.view === v, `${dv.n}: ${name} from Songs → ${v} (${d?.view})`);
  }
  // a choice in the shell's Score, kept through a reload (?open=score reopens the song)
  await openFromList(ids.pvg);
  await drawn(p, ids.pvg, 'score');
  await p.selectOption('#score-region #hands', 'lh');
  await drawn(p, ids.pvg, 'lh');
  await p.goto(BASE + '?open=score');
  d = await drawn(p, ids.pvg);
  ok(d?.view === 'lh' && (await record(p, ids.pvg))?.view === 'lh', `${dv.n}: Left hand chosen in the shell → reopened in lh (${d?.view})`);
  ok(!ctx.errors.length, `${dv.n}: no page errors (${ctx.errors.slice(0, 3).join(' | ')})`);
  await ctx.close();
}

(async () => {
  browser = await chromium.launch();
  for (const dv of DEVICES) await playPage(dv);
  for (const dv of DEVICES) await shellScore(dv);
  await browser.close();
  done();
})().catch(fail);
