// Account page, invite-only cloud: the signed-in card says "Cloud: on" / "Cloud: waiting for
// approval" from public.accounts (live project; EXPECT=on|waiting is what the test user's row
// says). Sign-up with email confirmation off (answered by interception): signed in at once;
// an address that has an account → "That email has an account — sign in."
const { chromium } = require('playwright');
const crypto = require('crypto');
const EMAIL = process.env.TEST_EMAIL, PW = process.env.TEST_PW, EXPECT = process.env.EXPECT;
const URL0 = 'http://localhost:8097/resonate/';
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
  const fails = [];
  const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const st = () => p.evaluate(() => ({ ...window.resonateDebug(), msg: document.getElementById('msg').textContent }));
  const until = async (f, ms = 15000) => { const t = Date.now(); let s; while (Date.now() - t < ms) { s = await st().catch(() => null); if (s && f(s)) return s; await p.waitForTimeout(150); } return s || st(); };

  await p.goto(URL0 + 'account.html'); await until((s) => s.view === 'out');
  await p.fill('#email', EMAIL); await p.fill('#password', PW); await p.click('#signin');
  let s = await until((s) => s.view === 'in' && s.cloud);
  const want = EXPECT === 'on' ? 'Cloud: on' : 'Cloud: waiting for approval';
  check(s.view === 'in' && s.cloud === want, `signed in: "${s.cloud}" (expected "${want}")`);
  await p.reload(); s = await until((s) => s.view === 'in' && s.cloud);
  check(s.cloud === want, `after a reload: "${s.cloud}"`);
  await p.click('#signout'); await until((s) => s.view === 'out');

  // Sign-up with confirmation off: the answer carries a session → signed in straight away.
  const fakeUser = { id: crypto.randomUUID(), aud: 'authenticated', role: 'authenticated', email: 'new@example.com', identities: [{ identity_id: crypto.randomUUID(), provider: 'email' }], created_at: new Date().toISOString(), updated_at: new Date().toISOString(), app_metadata: { provider: 'email' }, user_metadata: {} };
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: fakeUser.id, email: fakeUser.email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  await p.route('**/auth/v1/signup**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: `${header}.${payload}.sig`, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'fake-refresh', user: fakeUser }) }));
  await p.route('**/rest/v1/accounts**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ approved: false }) }));
  await p.fill('#email', 'new@example.com'); await p.fill('#password', 'long-enough-1'); await p.click('#signup');
  s = await until((s) => s.view === 'in' && s.cloud);
  check(s.view === 'in' && s.email === 'new@example.com' && s.cloud === 'Cloud: waiting for approval', `sign up → signed in at once, "${s.cloud}"`);
  await p.unroute('**/auth/v1/signup**'); await p.unroute('**/rest/v1/accounts**');
  await p.evaluate(() => localStorage.removeItem('resonate.auth'));
  await p.goto(URL0 + 'account.html'); await until((s) => s.view === 'out');

  // An address that already has an account (confirmation off: an error, not a fake user).
  await p.route('**/auth/v1/signup**', (r) => r.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ code: 422, error_code: 'user_already_exists', msg: 'User already registered' }) }));
  await p.fill('#email', EMAIL); await p.fill('#password', 'long-enough-1'); await p.click('#signup');
  s = await until((s) => !!s.msg);
  check(s.msg === 'That email has an account — sign in.' && s.view === 'out', `existing address: "${s.msg}"`);

  check(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close();
  console.log(fails.length ? `${fails.length} FAILED` : 'all ok');
  process.exit(fails.length ? 1 : 0);
})();
