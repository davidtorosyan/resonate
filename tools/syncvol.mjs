// E5: a voice profile's volume calibration is per device (it's the mic's — E4's room and gate too), its name
// and range one per profile. The real public/sync.js against synclib's fake cloud, two devices: the iPhone's
// calibration never goes up; the profile reaches the iPad uncalibrated there (it shows "not calibrated",
// its gate today's); the iPad's own calibration stays when the iPhone renames the profile or moves its
// range, and the iPhone's when the iPad's changes come back; a profile deleted elsewhere goes with its vol.
// (What was already true before E4/E5 — a guard for the shape: vol gained room and gate.)
//   node syncvol.mjs
import { register } from 'node:module';
import C from './lib/check.cjs';
register('./synclib/hooks.mjs', import.meta.url);
const { W, device } = await import('./synclib/world.mjs');
const S = await import(new URL('../public/sync.js', import.meta.url).href);
const { micGate, MIN_RMS } = await import(new URL('../public/pitch.js', import.meta.url).href);
W.limit = S.SONG_LIMIT;
const { ok, done, fail } = C;
const pass = async () => { const r = await S.syncNow(); if (r?.error) console.log('  pass error', r.error); return r; };
const profs = () => JSON.parse(localStorage.getItem('resonate.profiles') || 'null');
const put = (p) => localStorage.setItem('resonate.profiles', JSON.stringify(p));
const rowsOf = (kind) => [...W.cloud.rows.values()].filter((r) => r.kind === kind && !r.deleted);

try {
  const phoneVol = { floor: -42, ceiling: -14, room: -70, gate: -48 };
  device('iPhone');
  put({ active: 'p1', list: [{ id: 'p1', name: 'Dave', vol: phoneVol, range: { low: 43, high: 64, comfortLow: 46, comfortHigh: 61, at: 1 } }] });
  await pass();
  const up = rowsOf('profile');
  ok(up.length === 1 && up[0].data.name === 'Dave' && up[0].data.range?.low === 43 && !('vol' in up[0].data) && !JSON.stringify(up[0].data).includes('-48'), `the profile goes up without its calibration (${JSON.stringify(up[0]?.data)})`);

  device('iPad');
  await pass();
  let p = profs()?.list?.find((x) => x.id === 'p1');
  ok(p && p.name === 'Dave' && p.range?.low === 43 && p.vol === null, `it reaches the iPad uncalibrated there (vol ${JSON.stringify(p?.vol)})`);
  ok(micGate(p?.vol) === MIN_RMS, `the iPad's gate is today's until it calibrates (${micGate(p?.vol)})`);

  const padVol = { floor: -65, ceiling: -37, room: -72, gate: -66 };
  put({ ...profs(), list: profs().list.map((x) => (x.id === 'p1' ? { ...x, vol: padVol } : x)) });
  await pass();
  ok(!JSON.stringify(rowsOf('profile')).includes('-66') && !JSON.stringify(W.cloud.log).includes('-66'), 'the iPad\'s calibration never goes up');
  ok(Math.abs(micGate(padVol) - 10 ** (-66 / 20)) < 1e-9, `the iPad's gate is its own (${(20 * Math.log10(micGate(padVol))).toFixed(1)} dB)`);

  device('iPhone');
  put({ ...profs(), list: profs().list.map((x) => (x.id === 'p1' ? { ...x, name: 'Dave R', range: { ...x.range, comfortLow: 47 } } : x)) });
  await pass();
  device('iPad');
  await pass();
  p = profs().list.find((x) => x.id === 'p1');
  ok(p.name === 'Dave R' && p.range.comfortLow === 47 && JSON.stringify(p.vol) === JSON.stringify(padVol), `the iPhone renames it and moves its range: the iPad keeps its own calibration (${p.name}, ${JSON.stringify(p.vol)})`);

  put({ ...profs(), list: profs().list.map((x) => (x.id === 'p1' ? { ...x, range: { ...x.range, comfortHigh: 60 } } : x)) });
  await pass();
  device('iPhone');
  await pass();
  p = profs().list.find((x) => x.id === 'p1');
  ok(p.range.comfortHigh === 60 && JSON.stringify(p.vol) === JSON.stringify(phoneVol), `the iPad's change comes back: the iPhone keeps its own (${JSON.stringify(p.vol)})`);

  put({ active: null, list: [] });
  await pass();
  device('iPad');
  await pass();
  ok(!profs().list.some((x) => x.id === 'p1'), 'a profile deleted on the iPhone goes from the iPad, its calibration with it');
  done();
} catch (err) { fail(err); }
