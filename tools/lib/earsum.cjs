// One line for an Ear result (public/ear.js judgeFree / judgeBeats), the same in earcases.mjs (node) and earprobe.cjs
// (the browser): a node row and a probe row of one plan compare at a glance. Round 2's fields print where the build
// gives them (key.dir, rit, anchored, spotOk, u0 …), and why a result isn't "Spot on".
//   summary(r, ph) — r: the result (or the probe's slim copy of it), ph: { j0 } (a cue's note as its index in the line)
//   spotWhy(r, beats) — "spot", or "not: …" (notes / beats not all, another key, an offset, a start counted on but not
//     measured — "unmeasured" —, a sag / hair / octave cue, the build's own spotOk false)

function spotWhy(r, beats = r?.kind === 'beats') {
  if (!r) return null;
  if (r.win?.kind === 'spot') return 'spot';
  if (!r.counts) return 'not: no counts';
  const why = [];
  if (!beats && !r.counts.notesAll) why.push(r.key?.kind || 'notes');
  if (!r.counts.beatsAll) why.push('beats');
  if (Object.values(r.starts || {}).some((s) => s && s.on && !s.measured)) why.push('unmeasured');
  if (['sag', 'hair', 'octave', 'offset', 'steady'].includes(r.cue?.kind) && !why.includes(r.cue.kind)) why.push(r.cue.kind);
  if (r.hair && !why.includes('hair')) why.push('hair');
  if (r.spotOk === false && !why.length) why.push('spotOk false');
  return `not: ${why.join(', ') || '?'}`;
}

function summary(r, ph) {
  const at = r.cue?.j != null && ph ? r.cue.j - ph.j0 : null;
  const key = r.key ? `key c ${Math.round(r.key.c)}¢ s ${r.key.s}${r.key.dir ? ` ${r.key.dir}` : ''}` : null;
  return [
    r.counts ? `♩ ${r.counts.beats == null ? '–' : r.counts.beatsAll ? 'all' : r.counts.beats} · ♪ ${r.counts.notes == null ? '–' : r.counts.notesAll ? 'all' : r.counts.notes}` : 'no counts',
    `win ${r.win ? `${r.win.kind} “${r.win.text}”` : '–'}`,
    `cue ${r.cue ? `${r.cue.kind}${at != null ? `@${at}` : ''}${r.cue.dir ? ` ${r.cue.dir}` : ''}${r.cue.size ? `/${r.cue.size}` : ''} “${r.cue.text}”` : '–'}`,
    r.fit ? `b ${r.fit.b.toFixed(2)} a ${r.fit.a.toFixed(2)}` : null,
    r.onsets ? `onsets ${r.onsets.measured}/${r.onsets.of}` : null,
    key,
    r.notReached != null ? `not reached ${r.notReached}` : null,
    r.rit != null ? `rit ${r.rit}` : null,
    r.anchored != null ? `anchored ${Array.isArray(r.anchored) ? r.anchored.length : r.anchored}` : null,
    r.u0 != null ? `u0 ${r.u0}` : null,
  ].filter(Boolean).join(' | ');
}

module.exports = { summary, spotWhy };
