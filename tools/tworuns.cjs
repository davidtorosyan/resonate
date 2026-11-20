// Two conversions in the SAME browser profile (persistent IndexedDB), like a returning user.
// usage: node tworuns.cjs <outdir> <profileDir> [runs=2] [base]
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const [out, prof, runs = 2, base = 'http://localhost:8097/resonate'] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const ctx = await chromium.launchPersistentContext(prof, { proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
  for (let r = 1; r <= +runs; r++) {
    const p = await ctx.newPage();
    const log = fs.createWriteStream(`${out}/run${r}.log`);
    p.on('console', (m) => log.write(m.text() + '\n'));
    await p.goto(`${base}/pdf-import.html?pdf=/killing.pdf`);
    const t0 = Date.now(); let last = '';
    while (Date.now() - t0 < 20 * 60000) {
      const st = await p.evaluate(() => ({ s: (document.getElementById('stage') ? document.getElementById('stage').textContent + ' | ' + document.getElementById('detail').textContent : window.resonateDebug?.().stage || ''),
        done: !document.getElementById('result').hidden, err: !document.getElementById('error').hidden }));
      if (st.s !== last) { console.log(`run${r} ${Math.round((Date.now() - t0) / 1000)}s ${st.s}`); last = st.s; }
      if (st.done || st.err) break;
      await p.waitForTimeout(5000);
    }
    console.log(`run${r} END`, await p.evaluate(() => (document.getElementById('result').hidden ? 'ERROR: ' + document.getElementById('error-msg').textContent : document.getElementById('result-detail').textContent)));
    const fsdump = await p.evaluate(() => new Promise((res) => { const rq = indexedDB.open('cjFS_/files/'); rq.onsuccess = () => { const db = rq.result; try { const tx = db.transaction('files', 'readonly'); const g = tx.objectStore('files').getAllKeys(); g.onsuccess = () => res(g.result); g.onerror = () => res('err'); } catch (e) { res('noStore ' + e.message); } }; rq.onerror = () => res('openerr'); }));
    fs.writeFileSync(`${out}/files-after-run${r}.json`, JSON.stringify(fsdump, null, 1));
    await p.close();
  }
  await ctx.close();
})();
