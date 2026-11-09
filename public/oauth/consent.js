// OAuth consent (v73): an assistant (ChatGPT, Claude…) asks to use the account through
// Supabase Auth's OAuth 2.1 server, which sends the browser here with ?authorization_id=…
// (Site URL + the project's authorization path /oauth/consent). Signed in → Allow / Deny; not
// signed in (the assistant's own sign-in window has no Resonate session) → sign in first, and
// that sign-in is only for this: it's removed again once the answer is given.
import { supabase, SUPABASE_URL, SUPABASE_KEY } from "../auth.js?v=75";

const $ = (id) => document.getElementById(id);
const msg = $("msg");
const say = (text = "", kind = "") => { msg.textContent = text; msg.dataset.kind = kind; };
const show = (v) => { for (const x of ["signin", "ask"]) $(`v-${x}`).hidden = x !== v; };
const offline = (e) => !!e && (e.status === 0 || e.name === "AuthRetryableFetchError" || !navigator.onLine || /fetch|load failed|network/i.test(e.message || ""));
const sayError = (e) => say(offline(e) ? "No connection." : e?.message || "Something went wrong — try again.", "error");

const id = new URLSearchParams(location.search).get("authorization_id");
let sb = null, signedInHere = false;

async function ask() {
  say();
  const { data, error } = await sb.auth.oauth.getAuthorizationDetails(id);
  if (error) {
    if (error.status === 404 || /not.?found|expired/i.test(error.message || "")) return say("This request has expired — start again from the assistant.", "error");
    return sayError(error);
  }
  // Already allowed before: straight back to the assistant.
  if (data?.redirect_url && !data.client) return finish(data.redirect_url);
  const name = data?.client?.name || data?.client?.client_name || "An assistant";
  $("client").textContent = name;
  const { data: { session } } = await sb.auth.getSession();
  $("who").textContent = session?.user?.email || data?.user?.email || "";
  let host = "";
  try { const u = new URL(data?.redirect_uri || ""); host = u.protocol === "https:" ? u.host : `${u.protocol}//${u.host}`; } catch {}
  $("to").textContent = host ? `Then back to ${host}` : "";
  show("ask");
}

async function finish(url) {
  // (A sign-in made only to answer this lived in memory only: this browser stays as it was.)
  if (signedInHere) { try { await sb.auth.signOut({ scope: "local" }); } catch {} }
  location.assign(url);
}

async function answer(allow) {
  for (const b of document.querySelectorAll("button")) b.disabled = true;
  try {
    const call = allow ? sb.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true }) : sb.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true });
    const { data, error } = await call;
    if (error) throw error;
    if (data?.redirect_url) return finish(data.redirect_url);
    say(allow ? "Allowed — go back to the assistant." : "Denied.", "ok");
  } catch (err) { sayError(err); }
  finally { for (const b of document.querySelectorAll("button")) b.disabled = false; }
}

$("allow").addEventListener("click", () => answer(true));
$("deny").addEventListener("click", () => answer(false));
$("v-signin").addEventListener("submit", async (e) => {
  e.preventDefault();
  for (const b of document.querySelectorAll("button")) b.disabled = true;
  try {
    // A client of its own, its session in memory only: the app's saved session, other tabs and
    // whose data this device shows are left alone.
    const { createClient } = await import("../vendor/supabase-2.118.0.js?v=75");
    const mem = new Map();
    const temp = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "resonate.consent",
      storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => { mem.set(k, v); }, removeItem: (k) => { mem.delete(k); } } } });
    const { error } = await temp.auth.signInWithPassword({ email: $("email").value.trim(), password: $("password").value });
    if (error) return sayError(error);
    sb = temp;
    signedInHere = true;
    await ask();
  } finally { for (const b of document.querySelectorAll("button")) b.disabled = false; }
});

window.resonateDebug = () => ({ view: !$("v-ask").hidden ? "ask" : !$("v-signin").hidden ? "signin" : null, msg: msg.textContent, client: $("client").textContent, signedInHere });

if (!id) say("Nothing to answer here.", "error");
else {
  try {
    sb = await supabase();
    const { data: { session } } = await sb.auth.getSession();
    if (session) await ask();
    else show("signin");
  } catch (err) { sayError(err); }
}
