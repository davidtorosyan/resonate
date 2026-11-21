// Where things are, for new suites and suites being touched (docs/CLEANUP.md 1.2), not a bulk port.
//   const { ROOT, PUBLIC, FIX, BASE, OUT, SHOTS } = require('./lib/paths.cjs');
// ROOT    the checkout (this file's ../..)
// PUBLIC  ROOT/public — the site
// FIX     ROOT/tools/fixtures — the public-domain fixtures (never the owner's songs)
// BASE    the page server, env BASE, default the harness's http://localhost:8097/resonate/
//         (node tools/harness/xb/collect-serve.mjs /home/user/sitetest 8097 /tmp/xbout)
// OUT     this run's scratch folder, env OUT, default <tmpdir>/resonate-<suite> (made here; never in the repo)
// SHOTS   where screenshots go: env SHOTS ("0" = none → null), default OUT/shots (made here when not null)
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const PUBLIC = path.join(ROOT, 'public');
const FIX = path.join(ROOT, 'tools/fixtures');
const BASE = (process.env.BASE || 'http://localhost:8097/resonate/').replace(/\/?$/, '/');
const suite = path.basename(require.main?.filename || process.argv[1] || 'suite').replace(/\.[cm]?js$/, '');
const OUT = process.env.OUT || path.join(os.tmpdir(), `resonate-${suite}`);
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS === '0' ? null : process.env.SHOTS || path.join(OUT, 'shots');
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
module.exports = { ROOT, PUBLIC, FIX, BASE, OUT, SHOTS };
