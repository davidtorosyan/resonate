const { chromium } = require('playwright');
(async () => {
  const ctx = await chromium.launchPersistentContext(process.argv[2]);
  const p = await ctx.newPage();
  await p.goto((process.argv[3] || 'http://localhost:8097') + '/resonate/tools.html');
  console.log(await p.evaluate(() => new Promise((res) => {
    const rq = indexedDB.open('cjFS_/files/');
    rq.onsuccess = () => { const st = rq.result.transaction('files', 'readonly').objectStore('files'); const out = [];
      st.openCursor().onsuccess = (e) => { const c = e.target.result; if (!c) return res(out.join('\n'));
        const v = c.value; let n = 0; const walk = (x, d) => { if (!x || d > 4) return; if (x.byteLength !== undefined) n += x.byteLength; else if (typeof x === 'object') for (const k in x) walk(x[k], d + 1); }; walk(v, 0);
        out.push(`${String(n).padStart(10)}  ${c.key}  ${Object.keys(v || {}).join(',')}`); c.continue(); }; };
  })));
  console.log(JSON.stringify(await p.evaluate(() => navigator.storage.estimate())));
  await ctx.close();
})();
