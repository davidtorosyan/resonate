// The shell's Score for browser suites (docs/CLEANUP-PHASE8.md §2's helpers; E7 first used them): a
// song opened on the Score at index.html, the Piano on or off, a key of the Piano's keyboard.
//   const SH = require('./lib/shell.cjs');
//   await SH.seedShell(ctx, { song: 'amazing-grace', mods: SH.MODS })   before the first page load: the song
//                                     open last (resonate.sing.song) and the modules per device class
//                                     (resonate.shell.modules) — each set only where it's unset, so what a
//                                     suite or the page writes later stays across reloads
//   await SH.openScore(page)          index.html?open=score (BASE's), then the Score shown and drawn
//   await SH.reopenScore(page)        the same again (a reload comes home: boot.js drops ?open)
//   await SH.openSong(page, id)       another song on the Score (shell/songlist.js openSong, as a tap on
//                                     its row) — then the Score drawn with it
//   await SH.piano(page, on)          the dock's Piano toggle to on / off, the change settled
//   await SH.kbKey(page, midi)        → { x, y } the centre of that key of the Piano's keyboard (client
//                                     px; a white key low down, below the black keys), or null
//   await SH.idle(page)               the song view settled (no slide, no module change, no closing)
//   SH.debug(page)                    → resonateDebug() parts: { song, piano, play } (play = the Score's)
const { BASE } = require('./paths.cjs');

const SCORE_URL = BASE + 'index.html?open=score';
// The Score with the Piano on every device class (a phone's own default is Sing alone).
const MODS = { phone: ['score', 'piano'], tablet: ['score', 'piano'], desktop: ['score', 'piano'] };

async function seedShell(ctx, { song = 'amazing-grace', mods = MODS } = {}) {
  await ctx.addInitScript(({ song, mods }) => {
    try {
      if (location.protocol === 'about:') return;
      if (song && localStorage.getItem('resonate.sing.song') == null) localStorage.setItem('resonate.sing.song', song);
      if (mods && localStorage.getItem('resonate.shell.modules') == null) localStorage.setItem('resonate.shell.modules', JSON.stringify(mods));
    } catch {}
  }, { song, mods });
}
const debug = (page) => page.evaluate(() => {
  const d = window.resonateDebug?.();
  return d ? { song: d.song, piano: d.piano, play: d.play || null } : null;
}).catch(() => null);
async function idle(page, ms = 30000) {
  await page.waitForFunction(() => { const d = window.resonateDebug?.().song; return !!d && !d.moving && !d.switching && !d.closing; }, null, { timeout: ms, polling: 100 });
}
// The Score shown and drawn (its song, when given).
async function scoreReady(page, id = null, ms = 60000) {
  await page.waitForFunction((id) => {
    const d = window.resonateDebug?.();
    const p = d?.play;
    return !!p && p.ready && (!id || p.song === id) && d.song && d.song.open && !d.song.moving && !d.song.switching;
  }, id, { timeout: ms, polling: 100 });
}
async function openScore(page, { id = null, ms = 60000 } = {}) {
  await page.goto(SCORE_URL);
  await scoreReady(page, id, ms);
}
const reopenScore = (page, o) => openScore(page, o);
async function openSong(page, id, ms = 60000) {
  await page.evaluate(async (id) => {
    const v = document.getElementById('version').textContent.trim().replace(/^v/, '');
    const m = await import(`./shell/songlist.js?v=${v}`);
    await m.openSong(id);
  }, id);
  await scoreReady(page, id, ms);
}
async function piano(page, on) {
  const now = await page.$eval('#mod-piano', (b) => b.getAttribute('aria-pressed') === 'true');
  if (now !== !!on) await page.click('#mod-piano');
  await idle(page);
  await page.waitForFunction((on) => !!window.resonateDebug?.().piano?.shown === on, !!on, { timeout: 10000 });
}
async function kbKey(page, midi) {
  return page.evaluate((m) => {
    const k = document.querySelector(`#piano-region .kb rect.key[data-midi="${m}"]`);
    if (!k) return null;
    const b = k.getBoundingClientRect(), white = [0, 2, 4, 5, 7, 9, 11].includes(m % 12);
    return { x: b.left + b.width / 2, y: b.top + b.height * (white ? 0.85 : 0.5) };
  }, midi);
}

module.exports = { SCORE_URL, MODS, seedShell, openScore, reopenScore, openSong, piano, kbKey, idle, debug, scoreReady };
