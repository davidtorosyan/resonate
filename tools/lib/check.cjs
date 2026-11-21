// How a suite counts its checks and ends, so tools/regress.sh can read its verdict from the exit code.
// For new suites and suites being touched (docs/CLEANUP.md 1.2), not a bulk port.
//   const { ok, skip, done, fail } = require('./lib/check.cjs');      (from an .mjs: import C from './lib/check.cjs')
//   ok(cond, what)   prints "PASS what" or "FAIL what" and counts it; returns cond
//   skip(what)       prints "skip what": one check not run (its input isn't here: the owner's songs, a server…)
//   done()           prints the counts and exits: 1 if anything failed; a suite that ran nothing but skipped
//                    prints "SKIP …" last and exits 0 (regress.sh reports SKIP); else 0
//   fail(err)        a crash: prints it and exits 2 — e.g. main().catch(fail)
const n = { pass: 0, fail: 0, skip: 0, firstSkip: '' };
function ok(cond, what) {
  if (cond) n.pass++; else n.fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`);
  return !!cond;
}
function skip(what) {
  n.skip++;
  if (!n.firstSkip) n.firstSkip = what;
  console.log(`skip ${what}`);
}
function done() {
  if (n.fail) { console.log(`${n.fail} failed, ${n.pass} passed${n.skip ? `, ${n.skip} skipped` : ''}`); process.exit(1); }
  if (!n.pass && n.skip) { console.log(`SKIP ${n.firstSkip}${n.skip > 1 ? ` (and ${n.skip - 1} more)` : ''}`); process.exit(0); }
  console.log(`all ${n.pass} passed${n.skip ? `, ${n.skip} skipped` : ''}`);
  process.exit(0);
}
function fail(err) {
  console.log(`FAIL crashed: ${err?.stack || err}`);
  process.exit(2);
}
module.exports = { ok, skip, done, fail, counts: n };
