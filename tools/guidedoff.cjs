// node -r ./guidedoff.cjs <test>.cjs — runs a v75-era Sing page test with guided practice off
// (the v75 screen and flow), as every page the test opens starts with resonate.sing.guided = "off".
const pw = require('playwright');
const off = () => { try { localStorage.setItem('resonate.sing.guided', 'off'); } catch {} };
const launch = pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch = async (...a) => {
  const b = await launch(...a);
  const np = b.newPage.bind(b), nc = b.newContext.bind(b);
  b.newPage = async (...x) => { const p = await np(...x); await p.addInitScript(off); return p; };
  b.newContext = async (...x) => { const c = await nc(...x); await c.addInitScript(off); return c; };
  return b;
};
