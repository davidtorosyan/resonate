// E1 (2026-11-21): a song with no view chosen for it opens in its Full score (when it has one), no
// longer in Both. Suites written while Both was the opening view choose Both, as a person would once
// on this device — a resonate.play record with view "both" — rather than expecting the Full score:
//   const { AG_BOTH, chooseBoth } = require('./lib/both.cjs');
//   await ctx.addInitScript(AG_BOTH)   Amazing Grace (the first song) in Both: its record gets view
//                                      "both" before every page load where it has no view (a view a
//                                      suite picks, or seeds, stays) — added after a suite's own init
//                                      scripts that write resonate.play
//   await chooseBoth(page, ids)        the same for songs a suite adds (their ids known once added),
//                                      written now: read by the next open of each song
// tools/playopen.cjs checks the default itself.
const AG_BOTH = () => {
  try {
    if (location.protocol === 'about:') return;
    const all = JSON.parse(localStorage.getItem('resonate.play') || '{}');
    const ag = all['amazing-grace'];
    if (ag && typeof ag === 'object' && ag.view) return;
    all['amazing-grace'] = { ...(ag && typeof ag === 'object' ? ag : {}), view: 'both' };
    localStorage.setItem('resonate.play', JSON.stringify(all));
  } catch {}
};
function chooseBoth(page, ids) {
  return page.evaluate((ids) => {
    const all = JSON.parse(localStorage.getItem('resonate.play') || '{}');
    for (const id of ids) if (!all[id]?.view) all[id] = { ...(all[id] || {}), view: 'both' };
    localStorage.setItem('resonate.play', JSON.stringify(all));
  }, [].concat(ids));
}
module.exports = { AG_BOTH, chooseBoth };
