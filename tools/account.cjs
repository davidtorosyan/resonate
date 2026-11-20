// Account page against the live Supabase project (through the sandbox proxy), with a seeded,
// already-confirmed test user (TEST_EMAIL / TEST_PW). Flows that would send email (sign up,
// forgot password, not confirmed) are answered by route interception instead.
const { chromium } = require('playwright');
const crypto = require('crypto');
const EMAIL = process.env.TEST_EMAIL, PW = process.env.TEST_PW;
const URL0 = 'http://localhost:8097/resonate/';
const SB = 'https://ltyadhjhnfxdlgsmrcds.supabase.co', KEY = 'sb_publishable_8FEg0aiW9Ir-RrrND8kfQw_IBirLBai';
(async () => {
  if (!EMAIL || !PW) throw new Error('TEST_EMAIL / TEST_PW');
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
  const fails = [];
  const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const reqs = []; p.on('request', (r) => reqs.push(r.url()));
  const state = () => p.evaluate(() => ({ ...window.resonateDebug(), msg: document.getElementById('msg').textContent, kind: document.getElementById('msg').dataset.kind || '', hash: location.hash, stored: !!localStorage.getItem('resonate.auth') }));
  const waitView = async (v, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { const s = await state().catch(() => null); if (s && s.view === v) return s; await p.waitForTimeout(150); } return state(); };
  const waitMsg = async (ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { const s = await state().catch(() => null); if (s && s.msg) return s; await p.waitForTimeout(150); } return state(); };
  const tokens = async (pw) => (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: pw }) })).json();

  // Signed out: the Tuner doesn't load the library; its chip says Sign in.
  await p.goto(URL0); await p.waitForTimeout(800);
  check((await p.textContent('#account-chip')) === 'Sign in ›', 'Tuner: "Sign in ›" when signed out');
  check(!reqs.some((u) => /vendor\/supabase/.test(u)), 'Tuner: sign-in library not loaded');
  await p.goto(URL0 + 'account.html');
  let s = await waitView('out');
  check(s.view === 'out' && !s.email, 'account page: signed-out form');

  // Wrong password.
  await p.fill('#email', EMAIL); await p.fill('#password', 'not-the-password');
  await p.click('#signin');
  s = await waitMsg();
  check(/invalid login credentials/i.test(s.msg) && s.kind === 'error' && s.view === 'out', `wrong password: "${s.msg}"`);

  // Sign in, survives a reload, headers know.
  await p.fill('#password', PW); await p.click('#signin');
  s = await waitView('in');
  check(s.view === 'in' && s.email === EMAIL && s.stored, 'sign in → signed-in view, session saved');
  check((await p.textContent('#who')) === EMAIL, 'shows the email');
  await p.reload(); s = await waitView('in');
  check(s.view === 'in' && s.email === EMAIL, 'still signed in after a reload');
  await p.goto(URL0); await p.waitForTimeout(600);
  check((await p.textContent('#account-chip')) === 'Account ›', 'Tuner: "Account ›" when signed in');
  await p.goto(URL0 + 'tools.html'); await p.waitForTimeout(600);
  check((await p.textContent('[data-account-link]')) === 'Account', 'Tools header: "Account"');

  // Change password, sign out, sign in with the new one.
  const PW2 = 'Pw2-' + crypto.randomBytes(9).toString('base64url');
  await p.goto(URL0 + 'account.html'); await waitView('in');
  await p.click('#change'); s = await waitView('newpw');
  check(s.view === 'newpw' && await p.isVisible('#newpw-cancel'), 'Change password → new-password form (with Cancel)');
  await p.fill('#curpw', PW); await p.fill('#newpw', PW2); await p.click('#v-newpw button[type=submit]');
  s = await waitMsg();
  check(s.msg === 'Password saved.' && s.view === 'in', `password changed: "${s.msg}"`);
  await p.click('#signout'); s = await waitView('out');
  check(s.view === 'out' && !s.stored, 'sign out → signed-out form, session gone');
  await p.fill('#email', EMAIL); await p.fill('#password', PW2); await p.click('#signin');
  s = await waitView('in');
  check(s.view === 'in', 'signs in with the new password');
  await p.click('#signout'); await waitView('out');

  // A reset link lands here: set a new password first (no Cancel), the fragment is cleared.
  const t = await tokens(PW2);
  check(!!t.access_token, 'REST sign-in for a recovery session');
  const frag = new URLSearchParams({ access_token: t.access_token, expires_at: String(t.expires_at), expires_in: String(t.expires_in), refresh_token: t.refresh_token, token_type: 'bearer', type: 'recovery' });
  await p.goto('about:blank'); await p.goto(URL0 + 'account.html#' + frag); s = await waitView('newpw'); // (a fresh load, as from an email)
  check(s.view === 'newpw' && s.recovering && !(await p.isVisible('#newpw-cancel')), 'reset link → new-password form, no Cancel');
  check(!/access_token/.test(s.hash), 'tokens taken out of the address');
  const PW3 = 'Pw3-' + crypto.randomBytes(9).toString('base64url');
  await p.fill('#newpw', PW3); await p.click('#v-newpw button[type=submit]');
  s = await waitMsg();
  check(s.msg === 'Password saved.' && s.view === 'in' && !s.recovering, 'reset: password saved, signed in');
  check(!!(await tokens(PW3)).access_token && !(await tokens(PW2)).access_token, 'the reset password works, the old one doesn\'t');
  await p.click('#signout'); await waitView('out');

  // An expired / used link.
  await p.goto('about:blank'); await p.goto(URL0 + 'account.html#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  s = await waitMsg();
  check(s.msg === 'That link has expired — ask for a new one.' && s.kind === 'error' && s.view === 'out' && !s.hash, `expired link: "${s.msg}", fragment cleared`);
  // A link's own text is never shown (anyone can make one).
  await p.goto('about:blank'); await p.goto(URL0 + 'account.html#error_description=Your+account+was+locked.+Restore+it+at+evil.example');
  s = await waitMsg();
  check(s.msg === "That link didn't work — try again." && !/evil/.test(s.msg), `forged error text not shown: "${s.msg}"`);
  // A link that landed on the site's root (Supabase's Site URL fallback) is handed to the account page.
  await p.goto('about:blank'); await p.goto(URL0 + '#error=access_denied&error_code=otp_expired&error_description=x');
  await p.waitForURL(/account\.html/, { timeout: 10000 }).catch(() => {});
  s = await waitMsg();
  check(/account\.html$/.test(new URL(p.url()).pathname) && /has expired/.test(s.msg), `link on the Tuner page → account page: "${s.msg}"`);

  // Sign up (answered by interception: no email is sent).
  await p.goto(URL0 + 'account.html'); await waitView('out');
  await p.fill('#email', 'new-person@example.com'); await p.fill('#password', 'short');
  await p.click('#signup'); s = await waitMsg();
  check(/8\+ characters/.test(s.msg), `short password refused before asking: "${s.msg}"`);
  let signupUrl = null;
  await p.route('**/auth/v1/signup**', (r) => { signupUrl = r.request().url(); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: crypto.randomUUID(), aud: 'authenticated', role: '', email: 'new-person@example.com', identities: [{ identity_id: crypto.randomUUID(), provider: 'email' }], confirmation_sent_at: new Date().toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} }) }); });
  await p.fill('#password', 'long-enough-1'); await p.click('#signup');
  s = await waitView('sent');
  check(s.view === 'sent' && (await p.textContent('#sent-to')) === 'new-person@example.com', 'sign up → "Check your email"');
  check(/redirect_to=.*account\.html/.test(decodeURIComponent(signupUrl || '')), `confirmation link comes back to account.html (${(signupUrl || '').replace(/^.*\?/, '?')})`);
  await p.unroute('**/auth/v1/signup**');
  await p.click('#back'); await waitView('out');
  await p.route('**/auth/v1/signup**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: crypto.randomUUID(), aud: 'authenticated', role: '', email: EMAIL, identities: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} }) }));
  await p.fill('#email', EMAIL); await p.click('#signup'); s = await waitMsg();
  check(/has an account/.test(s.msg) && s.view === 'out', `existing address: "${s.msg}"`);
  await p.unroute('**/auth/v1/signup**');

  // Not confirmed yet → "Check your email" with Send again.
  await p.route('**/auth/v1/token**', (r) => r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' }) }));
  await p.fill('#email', 'new-person@example.com'); await p.fill('#password', 'long-enough-1'); await p.click('#signin');
  s = await waitView('sent');
  check(s.view === 'sent' && /confirm your email/i.test(s.msg), `unconfirmed sign-in → "${s.msg}"`);
  let resendBody = null;
  await p.route('**/auth/v1/resend**', (r) => { resendBody = r.request().postData(); r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
  await p.click('#resend'); s = await waitMsg(); await p.waitForTimeout(300); s = await state();
  check(/Sent again/.test(s.msg) && /"type":"signup"/.test(resendBody || ''), `Send again: "${s.msg}"`);
  await p.unroute('**/auth/v1/token**'); await p.unroute('**/auth/v1/resend**');
  await p.click('#back'); await waitView('out');

  // Forgot password.
  let recoverUrl = null;
  await p.route('**/auth/v1/recover**', (r) => { recoverUrl = r.request().url(); r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
  await p.fill('#email', EMAIL); await p.click('#forgot'); s = await waitMsg();
  check(/Reset link sent/.test(s.msg) && /redirect_to=.*account\.html/.test(decodeURIComponent(recoverUrl || '')), `forgot password: "${s.msg}"`);
  await p.unroute('**/auth/v1/recover**');

  let PW4 = PW3;
  // Two tabs: a reset link opened in tab B doesn't trap tab A on "New password"; a sign-out in
  // one tab clears the other's "Change password".
  {
    const pa = await ctx.newPage(), pb = await ctx.newPage();
    const st = (q) => q.evaluate(() => window.resonateDebug());
    const wv = async (q, v) => { const t0 = Date.now(); while (Date.now() - t0 < 15000) { const x = await st(q).catch(() => null); if (x && x.view === v) return x; await q.waitForTimeout(150); } return st(q); };
    await pa.goto(URL0 + 'account.html'); await wv(pa, 'out');
    const t2 = await tokens(PW3);
    const f2 = new URLSearchParams({ access_token: t2.access_token, expires_at: String(t2.expires_at), expires_in: String(t2.expires_in), refresh_token: t2.refresh_token, token_type: 'bearer', type: 'recovery' });
    await pb.goto(URL0 + 'account.html#' + f2);
    const b1 = await wv(pb, 'newpw');
    await pa.waitForTimeout(1500); await pa.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const a1 = await wv(pa, 'in');
    check(b1.view === 'newpw' && a1.view === 'in' && !a1.recovering, `reset link in tab B: B asks for a password (${b1.view}), A just signed in (${a1.view})`);
    check(!(await pb.isVisible('#newpw-cancel')), 'tab B: no Cancel (it must set one)');
    PW4 = 'Pw4-' + crypto.randomBytes(9).toString('base64url');
    await pb.fill('#newpw', PW4); await pb.click('#v-newpw button[type=submit]'); await wv(pb, 'in');
    await pa.click('#change'); const a2 = await wv(pa, 'newpw');
    await pb.click('#signout'); await wv(pb, 'out');
    await pa.waitForTimeout(1500); await pa.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const a3 = await wv(pa, 'out');
    check(a2.view === 'newpw' && a3.view === 'out' && !a3.changing, `sign-out in tab B ends tab A's "Change password" (${a3.view}, changing ${a3.changing})`);
    await pa.close(); await pb.close();
  }

  // No connection: the saved account shows at once; a refresh or sign-in that can't reach the
  // server says "No connection." (not the browser's own text).
  {
    await p.goto(URL0 + 'account.html'); await waitView('out');
    await p.fill('#email', EMAIL); await p.fill('#password', PW4); await p.click('#signin'); await waitView('in');
    await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('resonate.auth')); s.expires_at = Math.floor(Date.now() / 1000) - 60; localStorage.setItem('resonate.auth', JSON.stringify(s)); });
    await p.route('**/auth/v1/**', (r) => r.abort('internetdisconnected'));
    await p.goto('about:blank'); await p.goto(URL0 + 'account.html');
    await p.waitForTimeout(300);
    const first = await state();
    check(first.view === 'in' && first.email === EMAIL, `offline reload: the saved account shows at once (${first.view})`);
    let s2 = first; const t0 = Date.now();
    while (Date.now() - t0 < 45000 && !(s2 = await state()).msg) await p.waitForTimeout(500);
    check(s2.view === 'in' && s2.msg === 'No connection.', `offline refresh: "${s2.msg}", still shown signed in (${s2.view})`);
    await p.click('#signout'); await p.waitForTimeout(800);
    const s4 = await state();
    check(s4.view === 'out' && !s4.stored, `offline sign-out: signed out on this device (${s4.view}, stored ${s4.stored})`);
    await p.unroute('**/auth/v1/**');
    await p.goto(URL0 + 'account.html'); await waitView('out');
    await p.route('**/auth/v1/token**', (r) => r.abort('internetdisconnected'));
    await p.fill('#email', EMAIL); await p.fill('#password', PW4); await p.click('#signin');
    const s3 = await waitMsg(40000);
    check(s3.msg === 'No connection.' && s3.view === 'out', `offline sign-in: "${s3.msg}"`);
    await p.unroute('**/auth/v1/token**');
  }

  check(!errs.length, 'no page errors ' + errs.join('; '));

  // The library can't load (offline): the page says so.
  const ctx2 = await b.newContext(); const p2 = await ctx2.newPage();
  await p2.route('**/vendor/supabase-*.js**', (r) => r.abort());
  await p2.goto(URL0 + 'account.html'); await p2.waitForTimeout(1500);
  const off = await p2.evaluate(() => ({ msg: document.getElementById('msg').textContent, out: !document.getElementById('v-out').hidden }));
  check(/couldn't load/.test(off.msg) && off.out, `offline: "${off.msg}"`);
  await ctx2.close();

  await b.close();
  console.log(fails.length ? `${fails.length} FAILED` : 'all ok');
  console.log('final password:', PW4);
  process.exit(fails.length ? 1 : 0);
})();
