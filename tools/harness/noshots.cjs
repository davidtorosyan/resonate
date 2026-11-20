// node -r noshots.cjs <suite>.cjs: page.screenshot() takes nothing unless its path matches SHOTS_KEEP (a regex).
const pw = require('/opt/node-tools/node_modules/playwright');
const keep = process.env.SHOTS_KEEP ? new RegExp(process.env.SHOTS_KEEP) : null;
let done = false;
function patch(page) {
  if (done) return;
  done = true;
  const proto = Object.getPrototypeOf(page), real = proto.screenshot;
  proto.screenshot = function (opts = {}) {
    if (keep && opts.path && keep.test(opts.path)) { console.log(`[shot] ${opts.path}`); return real.call(this, opts); }
    return Promise.resolve(Buffer.alloc(0));
  };
}
const launch = pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch = async (...a) => {
  const b = await launch(...a);
  const nc = b.newContext.bind(b), np = b.newPage.bind(b);
  b.newContext = async (...x) => { const c = await nc(...x); c.on('page', patch); const n = c.newPage.bind(c); c.newPage = async (...y) => { const p = await n(...y); patch(p); return p; }; return c; };
  b.newPage = async (...x) => { const p = await np(...x); patch(p); return p; };
  return b;
};
