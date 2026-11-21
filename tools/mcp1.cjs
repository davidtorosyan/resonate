// Assistants end to end (v73–75), live project, the approved test user (TEST_EMAIL / TEST_PW):
//  1 an assistant connects the way ChatGPT/Claude do: dynamic client registration → authorize →
//    the consent page (served from this checkout at the Site URL's address) → sign in → Allow →
//    code → token (PKCE) → the MCP server answers; its token can't write the app's data
//  2 the Sing page shares the song it opens; the AI button on → control_resonate opens a song,
//    sets a key, plays Listen, stops; with it off it's refused (the button shows only once an
//    assistant has connected: this run's own tool calls before part 2 write assistant_activity)
//  3 a take started from the assistant: get_live_lines returns lines while it's sung; at the end
//    get_take has every line final and the page's review
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EMAIL = process.env.TEST_EMAIL, PW = process.env.TEST_PW;
const SB = 'https://ltyadhjhnfxdlgsmrcds.supabase.co', KEY = 'sb_publishable_8FEg0aiW9Ir-RrrND8kfQw_IBirLBai';
const MCP = `${SB}/functions/v1/mcp`;
const MCP_URL_EXPECTED = MCP;
const LOCAL = 'http://localhost:8097/resonate/';
const PUB = '/home/user/resonate/public';
const CB = 'http://localhost:9911/cb';
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const b64url = (b) => Buffer.from(b).toString('base64url');

let rpcId = 0;
async function mcp(token, method, params = {}) {
  const r = await fetch(MCP, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
  const text = await r.text();
  let msg = null;
  if ((r.headers.get('content-type') || '').includes('text/event-stream')) {
    for (const line of text.split('\n')) if (line.startsWith('data:')) { try { const m = JSON.parse(line.slice(5)); if (m.id === rpcId) msg = m; } catch {} }
  } else { try { msg = JSON.parse(text); } catch {} }
  return { status: r.status, msg, text };
}
async function tool(token, name, args = {}) {
  const { status, msg, text } = await mcp(token, 'tools/call', { name, arguments: args });
  const t = msg?.result?.content?.[0]?.text;
  let data = null; try { data = JSON.parse(t); } catch {}
  return { status, error: msg?.result?.isError || !!msg?.error, data, raw: t || text };
}

(async () => {
  const src = fs.readFileSync('/home/user/tools/review.cjs', 'utf8');
  const singer = eval(src.slice(src.indexOf('await p.addInitScript(() => {') + 'await p.addInitScript('.length, src.indexOf('  });\n  await p.goto') + 3));
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' }, args: ['--autoplay-policy=no-user-gesture-required'] });

  // --- 1: connect like an assistant ---
  const reg = await (await fetch(`${SB}/auth/v1/oauth/clients/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Resonate test assistant', redirect_uris: [CB], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) })).json();
  check(!!reg.client_id, `dynamic registration (${reg.client_id || JSON.stringify(reg)})`);
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const authz = `${SB}/auth/v1/oauth/authorize?` + new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: CB, code_challenge: challenge, code_challenge_method: 'S256', state: 'st8', scope: 'openid offline_access', resource: MCP });

  const A = await b.newContext({ viewport: { width: 390, height: 844 } });
  const ap = await A.newPage();
  const errs = []; ap.on('pageerror', (e) => errs.push(e.message));
  // The Site URL's pages come from this checkout (what will be deployed).
  await A.route('https://www.jimbo84.com/resonate/**', (r) => {
    let p = new URL(r.request().url()).pathname.replace(/^\/resonate\//, '');
    if (p === 'oauth/consent') p = 'oauth/consent.html';
    const f = path.join(PUB, p);
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: 'not found' });
    const type = f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
    r.fulfill({ status: 200, contentType: type, body: fs.readFileSync(f) });
  });
  let codeUrl = null;
  await A.route('http://localhost:9911/**', (r) => { codeUrl = r.request().url(); r.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' }); });
  // (The browser can't intercept a redirect's target: follow authorize here, open where it points.)
  const az = await fetch(authz, { redirect: 'manual' });
  const consentAt = az.headers.get('location') || '';
  check(az.status === 302 && /^https:\/\/www\.jimbo84\.com\/resonate\/oauth\/consent\?authorization_id=/.test(consentAt), `authorize → the consent page (${az.status} ${consentAt.replace(/authorization_id=.*/, 'authorization_id=…')})`);
  await ap.goto(consentAt);
  await ap.waitForFunction(() => window.resonateDebug?.().view === 'signin', null, { timeout: 20000 });
  await ap.fill('#email', EMAIL); await ap.fill('#password', PW); await ap.click('#v-signin button[type=submit]');
  await ap.waitForFunction(() => window.resonateDebug?.().view === 'ask', null, { timeout: 20000 });
  const asked = await ap.evaluate(() => ({ client: document.getElementById('client').textContent, who: document.getElementById('who').textContent, to: document.getElementById('to').textContent }));
  check(asked.client === 'Resonate test assistant' && asked.who === EMAIL.toLowerCase() && /localhost:9911/.test(asked.to), `consent asks: ${JSON.stringify(asked)}`);
  await ap.click('#allow');
  for (let i = 0; i < 50 && !codeUrl; i++) await ap.waitForTimeout(200);
  const cu = codeUrl ? new URL(codeUrl) : null;
  check(!!cu?.searchParams.get('code') && cu.searchParams.get('state') === 'st8', `Allow → back with a code (${codeUrl ? 'yes' : 'none'})`);
  check(await ap.evaluate(() => !localStorage.getItem('resonate.auth')).catch(() => true), 'the sign-in made only to consent is gone again');
  const tok = await (await fetch(`${SB}/auth/v1/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: cu?.searchParams.get('code') || '', redirect_uri: CB, client_id: reg.client_id, code_verifier: verifier, resource: MCP }) })).json();
  check(!!tok.access_token && !!tok.refresh_token, `token (${tok.access_token ? 'access + refresh' : JSON.stringify(tok).slice(0, 200)})`);
  const claims = JSON.parse(Buffer.from((tok.access_token || '..').split('.')[1] || '', 'base64url').toString() || '{}');
  check(claims.client_id === reg.client_id, `the token names the assistant (client_id ${claims.client_id})`);
  const T = tok.access_token;

  const init = await mcp(T, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  check(init.status === 200 && init.msg?.result?.serverInfo?.name === 'resonate' && /singing coach/i.test(init.msg?.result?.instructions || ''), `initialize (${init.status} ${init.msg?.result?.serverInfo?.name})`);
  const tl = await mcp(T, 'tools/list');
  const names = (tl.msg?.result?.tools || []).map((t) => t.name).sort();
  // The frozen tool list (docs/CONNECTOR.md): these 15 names, forever — a new ability is a catalog.ts entry.
  check(names.join(',') === 'control_resonate,get_capabilities,get_live_lines,get_progress,get_score_pdf,get_score_view,get_score_xml,get_song,get_status,get_take,get_voice_profile,list_songs,list_takes,read_resonate,start_vocal_coaching', `tools: ${names.join(', ')}`); // (v88: + the score tools, mcp2.cjs; 2026-11-20: + get_capabilities, read_resonate)
  const ctl = (tl.msg?.result?.tools || []).find((t) => t.name === 'control_resonate');
  check(ctl?.annotations?.readOnlyHint === false && (tl.msg?.result?.tools || []).filter((t) => t.name !== 'control_resonate').every((t) => t.annotations?.readOnlyHint === true), 'only control_resonate is marked as acting; the rest read-only');
  // The live catalogue: the deployed version is the repo's, actions take any name it lists.
  const catVer = fs.readFileSync('/home/user/resonate/supabase/functions/mcp/catalog.ts', 'utf8').match(/export const VERSION = "([^"]+)"/)[1];
  const caps = await tool(T, 'get_capabilities');
  check(init.msg?.result?.serverInfo?.version === catVer && init.msg?.result?.capabilities?.tools?.listChanged === false && caps.data?.version === catVer && !!caps.data?.control_resonate?.score_play && !!caps.data?.read_resonate?.score_xml && !ctl?.inputSchema?.properties?.action?.enum,
    `capabilities ${caps.data?.version} = catalog.ts ${catVer} (serverInfo ${init.msg?.result?.serverInfo?.version}, listChanged ${init.msg?.result?.capabilities?.tools?.listChanged}; ${Object.keys(caps.data?.control_resonate || {}).length} actions, ${Object.keys(caps.data?.read_resonate || {}).length} reads)`);
  const rd = await tool(T, 'read_resonate', { what: 'get_capabilities' }), bad = await tool(T, 'control_resonate', { action: 'no_such_action' });
  check(rd.data?.version === catVer && bad.error && (bad.data?.actions || []).includes('sing'), `read_resonate by a tool's name; an unknown action names the list (${bad.data?.error})`);

  // The assistant's token can't write the app's data.
  const H = { apikey: KEY, Authorization: `Bearer ${T}`, 'content-type': 'application/json' };
  let r = await fetch(`${SB}/rest/v1/sync_items`, { method: 'POST', headers: H, body: JSON.stringify({ user_id: claims.sub, kind: 'prefs', id: 'mcp-test', data: {}, modified_at: new Date().toISOString() }) });
  check(r.status >= 400, `no writes to the synced data (${r.status})`);
  r = await fetch(`${SB}/rest/v1/coach_takes`, { method: 'POST', headers: H, body: JSON.stringify({ id: 'x', song_id: 'y', status: 'done', started_at: new Date().toISOString() }) });
  check(r.status >= 400, `no writes to takes (${r.status})`);
  r = await fetch(`${SB}/rest/v1/devices`, { method: 'POST', headers: H, body: JSON.stringify({ id: 'evil', remote: true }) });
  check(r.status >= 400, `can't switch the AI button on itself (${r.status})`);
  const noRemote = await tool(T, 'control_resonate', { action: 'stop' });
  check(noRemote.error && /AI button on/.test(noRemote.raw), `control with no AI-button device: refused (${noRemote.raw.slice(0, 90)})`);
  const app = await fetch(MCP, { method: 'POST', headers: { Authorization: `Bearer ${(await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PW }) })).json()).access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
  check(app.status === 403, `an app session (no client_id) is refused (${app.status})`);

  // --- 2: the Sing page, the AI button, control ---
  const D = await b.newContext({ viewport: { width: 390, height: 844 } });
  await D.addInitScript(singer);
  const dp = await D.newPage();
  dp.on('pageerror', (e) => errs.push(e.message));
  dp.on('console', (m) => { if (/assist|remote/i.test(m.text())) console.log('  [page]', m.text().slice(0, 200)); });
  await dp.goto(LOCAL + 'account.html'); await dp.waitForFunction(() => window.resonateDebug?.().view === 'out', null, { timeout: 15000 });
  await dp.fill('#email', EMAIL); await dp.fill('#password', PW); await dp.click('#signin');
  await dp.waitForFunction(() => window.resonateDebug?.().view === 'in', null, { timeout: 20000 });
  await dp.goto(LOCAL + 'sing.html');
  await dp.waitForFunction(() => !document.getElementById('remote-btn').hidden, null, { timeout: 20000 });
  await dp.waitForTimeout(2500);
  const song = await tool(T, 'get_song', { song: 'amazing grace' });
  check(!song.error && song.data?.lines?.length >= 4 && song.data.lines[0].notes.length > 3, `get_song: the page shared the song (${song.data?.lines?.length} lines; line 1 “${song.data?.lines?.[0]?.text}”)`);
  await dp.click('#remote-btn');
  await dp.waitForFunction(() => document.getElementById('remote-btn').dataset.on === 'true', null, { timeout: 10000 });
  const st = await tool(T, 'get_status');
  check(st.data?.remote_device && st.data.devices.some((d) => d.remote_on && d.online), `get_status: the AI button on, online (${st.data?.remote_device})`);
  check(st.data?.start_delay_s === 4 && !('standing_instructions' in (st.data || {})) && /judge/i.test(st.data?.reminder || ''), `get_status: start delay ${st.data?.start_delay_s}, the coaching reminder, no standing instructions`);
  const coach = await tool(T, 'start_vocal_coaching');
  const csrc = fs.readFileSync('/home/user/resonate/supabase/functions/mcp/coaching.ts', 'utf8');
  const lit = (name) => csrc.match(new RegExp('export const ' + name + ' = `([\\s\\S]*?)`;\\n'))[1].replace(/\\([`\\$])/g, '$1');
  check(coach.data?.playbook === lit('PLAYBOOK') && coach.data?.reminder === lit('REMINDER'), `the deployed playbook and reminder are the repo's, exactly (${(coach.data?.playbook || '').length} / ${lit('PLAYBOOK').length} chars)`);
  check(!coach.error && (coach.data?.playbook || '').length > 3000 && /control_resonate/.test(coach.data.playbook) && /get_take/.test(coach.data.playbook) && coach.data.now?.remote_device === st.data.remote_device && coach.data.now?.devices?.length && Array.isArray(coach.data.now?.voice_profiles) && Array.isArray(coach.data.now?.recent_takes) && coach.data.reminder,
    `start_vocal_coaching: the playbook (${(coach.data?.playbook || '').length} chars) and now (${JSON.stringify({ remote: coach.data?.now?.remote_device, showing: coach.data?.now?.devices?.[0]?.showing?.song?.title, takes: coach.data?.now?.recent_takes?.length })})`);
  // The assistant's chip by the AI button (its registered name; the dot lit just after a call)
  await dp.waitForFunction(() => !document.getElementById('assistant-chip').hidden, null, { timeout: 10000 }).catch(() => {});
  const chip = await dp.evaluate(() => { const c = document.getElementById('assistant-chip'); return { hidden: c.hidden, text: c.textContent, active: c.dataset.active }; });
  check(!chip.hidden && /Resonate test assistant/.test(chip.text) && chip.active === 'true', `the assistant's chip by the AI button (${JSON.stringify(chip)})`);
  let c = await tool(T, 'control_resonate', { action: 'set_key', semitones: 2 });
  check(!c.error && await dp.evaluate(() => document.getElementById('key-select').value) === '2', `set_key +2 (${c.raw.slice(0, 120)})`);
  c = await tool(T, 'control_resonate', { action: 'listen', line: 2 });
  check(!c.error && c.data?.doing === 'listen' && await dp.evaluate(() => window.resonateDebug().session?.kind) === 'listen', `listen from line 2 (${c.raw.slice(0, 120)})`);
  c = await tool(T, 'control_resonate', { action: 'stop' });
  check(!c.error && !(await dp.evaluate(() => window.resonateDebug().session)), 'stop');
  const stopMsg = await dp.evaluate(() => document.body.innerText.match(/Stopped by [^\n]*/)?.[0] || '');
  check(/Stopped by Resonate test assistant/.test(stopMsg), `the page says who stopped it (“${stopMsg}”)`);
  c = await tool(T, 'control_resonate', { action: 'set_key', semitones: 0 });
  c = await tool(T, 'control_resonate', { action: 'open_song', song: 'no such song at all' });
  check(c.error && Array.isArray(c.data?.songs), 'open_song with a wrong title: refused with the list');

  // --- 3: a take from the assistant, followed live ---
  c = await tool(T, 'control_resonate', { action: 'set_key', fit: true });
  const vp0 = await tool(T, 'get_voice_profile');
  const hasRange = (vp0.data?.profiles || []).some((p) => p.active && p.range);
  check(hasRange ? (!c.error && /Fits|Close/.test(await dp.evaluate(() => document.getElementById('key-select').selectedOptions[0]?.parentElement?.label || ''))) : (c.error && /No voice range/.test(c.raw)), `set_key fit: ${hasRange ? 'the best fit' : 'refused without a voice range'} (${c.raw.slice(0, 90)})`);
  c = await tool(T, 'control_resonate', { action: 'set_key', semitones: 0 });
  c = await tool(T, 'control_resonate', { action: 'sing' });
  await dp.waitForFunction(() => !document.getElementById('getready').hidden, null, { timeout: 5000 }).catch(() => {});
  await dp.click('#getready');
  await dp.waitForTimeout(1500);
  const dn = await tool(T, 'get_live_lines', { after_line: 99, wait_seconds: 5 });
  check(dn.data?.status === 'didnt_start' && !(await dp.evaluate(() => window.resonateDebug().session)), `a countdown cancelled on the page → get_live_lines: ${dn.data?.status}`);
  c = await tool(T, 'control_resonate', { action: 'sing', to_line: 2 });
  const gr = await dp.evaluate(() => { const g = document.getElementById('getready'); return { hidden: g.hidden, by: g.querySelector('.by').textContent, n: g.querySelector('.n').textContent, doing: window.resonateDebug().session?.kind || null }; });
  check(!c.error && c.data?.starts_in_s === 4 && c.data?.to_line === 2 && /stay quiet/.test(c.data?.now || '') && !!c.data?.reminder, `sing: answered at once, starts in ${c.data?.starts_in_s} s, to line ${c.data?.to_line}`);
  check(!gr.hidden && /Resonate test assistant — get ready/.test(gr.by) && Number(gr.n) >= 2 && gr.doing !== 'sing', `“Get ready” countdown on the page (${JSON.stringify(gr)})`);
  await dp.waitForTimeout(1200); // (the device's row follows 0.8 s after a change)
  const ns = await tool(T, 'get_live_lines', { after_line: 99, wait_seconds: 1 });
  check(ns.data?.status === 'not_started', `during the countdown get_live_lines waits for the new take: ${ns.data?.status}`);
  const st2 = await tool(T, 'get_status');
  check(st2.data?.devices?.find((d) => d.remote_on)?.showing?.doing === 'get-ready', `get_status during the countdown: ${st2.data?.devices?.find((d) => d.remote_on)?.showing?.doing}`);
  await dp.waitForFunction(() => window.resonateDebug().session?.kind === 'sing', null, { timeout: 10000 }).catch(() => {});
  const te = await dp.evaluate(() => { const g = document.getElementById('getready'), e = document.getElementById('take-end'); return { gr: g.hidden, kind: window.resonateDebug().session?.kind, end: e.hidden ? null : e.textContent }; });
  check(te.gr && te.kind === 'sing' && te.end === 'to line 2', `then the take starts, the header says where it ends (${JSON.stringify(te)})`);
  let live = await tool(T, 'get_live_lines', { after_line: 0, wait_seconds: 20 });
  if (!live.data?.lines?.length) live = await tool(T, 'get_live_lines', { after_line: 0, wait_seconds: 20 });
  check(live.data?.status === 'live' && live.data.lines.length >= 1 && live.data.lines[0].notes.length > 0 && live.data.lines[0].final === false, `get_live_lines: line ${live.data?.lines?.[0]?.line} while singing (${live.data?.lines?.length} lines, status ${live.data?.status})`);
  const next = await tool(T, 'get_live_lines', { after_line: live.data?.next_after_line || 1, wait_seconds: 20 });
  check(next.data?.lines?.length >= 1 && next.data.lines[0].line > (live.data?.next_after_line || 1) - 1, `…and the next (line ${next.data?.lines?.[0]?.line})`);
  await dp.waitForFunction(() => !window.resonateDebug().session, null, { timeout: 30000 }).catch(() => {});
  await dp.waitForTimeout(3000);
  const endState = await dp.evaluate(() => ({ session: window.resonateDebug().session?.kind || null, review: !document.getElementById('review').hidden, end: !document.getElementById('take-end').hidden }));
  check(!endState.session && !endState.review && !endState.end, `the take ended by itself after line 2; no review sheet over the assistant's feedback (${JSON.stringify(endState)})`);
  const tk = await tool(T, 'get_take', { take: 'latest' });
  check(['done', 'stopped'].includes(tk.data?.status) && tk.data.lines.length === 2 && tk.data.lines.every((l) => l.final) && tk.data.review?.headline, `get_take: ${tk.data?.status}, ${tk.data?.lines?.length} lines final, review “${tk.data?.review?.headline}”`);
  const st5 = await tool(T, 'get_status');
  check(st5.data?.devices?.find((d) => d.remote_on)?.showing?.has_take === true, 'get_status: the page has a take (has_take)');
  const lt = await tool(T, 'list_takes', { song: 'amazing' });
  check(lt.data?.takes?.[0]?.take === tk.data?.take, 'list_takes has it first');
  const ls = await tool(T, 'list_songs');
  check(ls.data?.songs?.some((s) => /Amazing Grace/.test(s.title) && s.recent_takes >= 1), 'list_songs');
  const vp = await tool(T, 'get_voice_profile');
  check(!vp.error && Array.isArray(vp.data?.profiles), 'get_voice_profile');
  const pg = await tool(T, 'get_progress', { song: 'amazing' });
  check(!pg.error && Array.isArray(pg.data?.takes), `get_progress (${pg.data?.takes?.length} takes)`);

  // The AI button off: refused again
  await dp.click('#remote-btn');
  await dp.waitForFunction(() => document.getElementById('remote-btn').dataset.on === 'false', null, { timeout: 10000 });
  c = await tool(T, 'control_resonate', { action: 'stop' });
  check(c.error, 'the AI button off → control refused');

  // --- the Assistants page: URL, the connected assistant, devices; Remove ends the connection ---
  await dp.goto(LOCAL + 'assistants.html');
  await dp.waitForFunction(() => window.resonateDebug?.().ready && /Resonate test assistant/.test(window.resonateDebug().grants) && window.resonateDebug().devices, null, { timeout: 20000 }).catch(() => {});
  const ap2 = await dp.evaluate(() => ({ ...window.resonateDebug(), url: document.getElementById('url').value }));
  check(ap2.url === MCP_URL_EXPECTED && /Resonate test assistant/.test(ap2.grants) && /This device/.test(ap2.devices), `Assistants page: URL, the assistant, this device (${JSON.stringify({ url: ap2.url, grants: ap2.grants.slice(0, 60), devices: ap2.devices.slice(0, 60) })})`);
  await dp.waitForFunction(() => !document.getElementById('v-rules').hidden && document.getElementById('delay').value, null, { timeout: 10000 }).catch(() => {});
  check(await dp.evaluate(() => !document.getElementById('standing') && document.getElementById('delay').value === '4'), 'Assistants page: no instructions box; the countdown at 4 s');
  await dp.selectOption('#delay', '6');
  await dp.waitForFunction(() => /Saved/.test(document.getElementById('rules-msg').textContent), null, { timeout: 10000 }).catch(() => {});
  const st3 = await tool(T, 'get_status');
  check(st3.data?.start_delay_s === 6, `changed → saved at once → get_status: ${st3.data?.start_delay_s} s`);
  await dp.reload();
  await dp.waitForFunction(() => !document.getElementById('v-rules').hidden && document.getElementById('delay').value === '6', null, { timeout: 10000 }).catch(() => {});
  check(await dp.inputValue('#delay') === '6', 'the page shows it after a reload');
  await dp.selectOption('#delay', '4');
  await dp.waitForFunction(() => /Saved/.test(document.getElementById('rules-msg').textContent), null, { timeout: 10000 }).catch(() => {});
  const st4 = await tool(T, 'get_status');
  check(st4.data?.start_delay_s === 4, 'back to 4 s');
  const removed = await dp.evaluate(async () => {
    const rows = () => [...document.querySelectorAll('#grants .item')].filter((x) => /Resonate test assistant/.test(x.textContent));
    const before = rows().length;
    rows()[0]?.querySelector('button')?.click();
    for (let i = 0; i < 50; i++) { await new Promise((r) => setTimeout(r, 200)); if (rows().length === before - 1) return true; }
    return false;
  });
  check(removed, 'Remove takes it off the list');

  // tidy: the grant, this test's device and takes
  const ut = (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PW }) })).json()).access_token;
  const UH = { apikey: KEY, Authorization: `Bearer ${ut}` };
  await fetch(`${SB}/auth/v1/user/oauth/grants?client_id=${reg.client_id}`, { method: 'DELETE', headers: UH });
  const u = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: KEY, Authorization: `Bearer ${T}` } });
  console.log('     /auth/v1/user after revoke:', u.status, (await u.text()).slice(0, 160));
  const after = await mcp(T, 'tools/list');
  check(after.status === 401 || after.status === 403 || !!after.msg?.error, `grant removed → the token stops working (${after.status})`);
  await fetch(`${SB}/rest/v1/coach_takes?id=neq.__`, { method: 'DELETE', headers: UH });
  await fetch(`${SB}/rest/v1/devices?id=neq.__`, { method: 'DELETE', headers: UH });
  check(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'all ok');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
