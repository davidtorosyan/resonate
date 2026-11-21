const { chromium } = require('playwright');
(async () => {
  const base = process.argv[2] || 'http://localhost:8097/resonate';
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  for (const page of ['index.html', 'record.html', 'sing.html', 'tools.html', 'pdf-import.html']) {
    const p = await b.newPage({ viewport: { width: 390, height: 844 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errs.push(m.text()));
    const r = await p.goto(`${base}/${page}`); await p.waitForTimeout(1500);
    const v = await p.textContent('#version').catch(() => '?');
    const tools = await p.$('a[href="tools.html"]') || (page === 'index.html' && await p.$('#avatar')); // (the shell: Tools in the account menu)
    console.log(page.padEnd(16), r.status(), v, tools || page === 'tools.html' ? 'tools-link ok' : 'NO TOOLS LINK', errs.length ? 'ERRORS: ' + errs.join(' | ') : 'no errors');
    if (page === 'tools.html') console.log('   checks:', (await p.textContent('#checks')).replace(/\s+/g, ' ').slice(0, 300));
    await p.close();
  }
  await b.close();
})();
