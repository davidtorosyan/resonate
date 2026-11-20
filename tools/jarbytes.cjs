// Which jars does CheerpJ actually fetch, and how much of each?
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
  const ctx = await b.newContext(); const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p); await cdp.send('Network.enable');
  const info = new Map(); const per = {};
  cdp.on('Network.responseReceived', (e) => info.set(e.requestId, { url: e.response.url, status: e.response.status }));
  cdp.on('Network.loadingFinished', (e) => { const i = info.get(e.requestId); if (!i) return; const k = i.url.replace(/^.*\/(lib\/)?/, ''); per[k] = per[k] || { bytes: 0, n: 0, statuses: new Set() }; per[k].bytes += e.encodedDataLength; per[k].n++; per[k].statuses.add(i.status); });
  await p.goto('http://localhost:8098/aud/index.html?' + process.argv[2]);
  await p.waitForFunction(() => window.__done, null, { timeout: 1800000, polling: 2000 });
  const rows = Object.entries(per).sort((a, b) => b[1].bytes - a[1].bytes);
  for (const [k, v] of rows.slice(0, 40)) console.log((v.bytes / 1e6).toFixed(2).padStart(7), 'MB', String(v.n).padStart(4), 'req', [...v.statuses].join('/'), k.slice(0, 80));
  console.log('TOTAL', (rows.reduce((a, [, v]) => a + v.bytes, 0) / 1e6).toFixed(1), 'MB');
  await b.close();
})();
