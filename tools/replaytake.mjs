// Replay a take saved with the review's ⤓ (WAV + JSON) through rhythm.js: node replaytake.mjs take.json [take.wav]
import fs from 'node:fs';
import { makeFeatures, findClicks, findOnsets, rhythmStats, rhythmObservations } from '/home/user/resonate/public/rhythm.js';
import { clickWave, CLICK_GAIN } from '/home/user/resonate/public/piano.js';
const jp = process.argv[2], wp = process.argv[3] || jp.replace(/\.json$/, '.wav');
const m = JSON.parse(fs.readFileSync(jp, 'utf8'));
const w = fs.readFileSync(wp);
const sr = w.readUInt32LE(24), n = w.readUInt32LE(40) / 2;
const pcm = new Float32Array(n);
for (let i = 0; i < n; i++) pcm[i] = w.readInt16LE(44 + i * 2) / 32767;
const feat = makeFeatures(sr); feat.push(pcm);
const c = m.clock;
const cal = findClicks(pcm, sr, c.ctxStart, c.countClicks, c.beatSec, (a) => clickWave(sr, a), (a) => CLICK_GAIN[a ? 'accent' : 'plain']);
const frames = m.frames.map(([t, midi, rms]) => ({ t: t - (c.frameShift || 0), midi, rms })); // back on the estimate's clock
const [j0, j1] = m.range;
const ns = m.notes.slice(j0, j1);
// (the page's own metric facts; older files: a plain stand-in from beatSec)
const metric = m.metric ? m.metric.slice(j0, j1) : ns.map((x, k) => { const prev = ns[k - 1]; const rest = prev ? x.t - (prev.t + prev.d) : 9; return { beat: c.beatSec, u: c.beatSec / 2, off: false, level: 'beat', entry: !prev || (x.restBefore && rest >= c.beatSec / 2), rest, lineEnd: false }; });
const unsung = ns.map((_, k) => ['unsung', 'missed'].includes(m.grades[j0 + k]?.status));
const on = findOnsets(ns, feat.result(), c.ctxStart, frames, metric, { songT0: c.songT0, rt: cal ? cal.rt : null, latency: c.est, endT: Infinity, unsung });
const ls = m.lines.map((l) => l.filter((j) => j >= j0 && j < j1).map((j) => j - j0));
const st = rhythmStats(ns, on, metric, ls, { calibrated: !!cal });
console.log('calibration', cal, '(page said', m.rhythm?.rt, ') lead', on.lead?.toFixed(3));
console.log(ns.map((x, k) => `${x.text || '‿'}${on.notes[k].dev === null ? ' —' : ` ${Math.round(on.notes[k].dev * 1000)}${on.notes[k].kind[0]}`}`).join('  '));
console.log(rhythmObservations(st, ls).filter((o) => o.tone !== 'good').map((o) => `${o.kind}${o.j !== undefined ? '@' + (ns[o.j].text || o.j) : ''}`).join(' '));
