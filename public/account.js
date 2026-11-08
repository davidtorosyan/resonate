// Account page: sign in / create an account with email + password, reset a forgotten
// password, change it, sign out. Email links (confirm the address, reset the password) come
// back here with the session in the URL fragment; supabase-js reads it (auth.js).
//
// What's on the device (space.js): creating an account takes the signed-out data with it
// (adopt); signing in to an existing account shelves it and brings the account's from the cloud
// (enter, then sync.js); signing out removes the account's data from the device and brings the
// shelved data back (leave).
import { supabase, accountUrl, savedUser, STORAGE_KEY } from "./auth.js?v=71";
import { ensureSpace, activeSpace, adopt, enter, leave } from "./space.js?v=71";

const ADOPT = "resonate.adopt"; // the address an account is being made for on this device
const SYNC_OFF = "resonate.sync.off"; // (sync.js OFF_KEY: this device doesn't sync)

const $ = (id) => document.getElementById(id);
const msg = $("msg");
const views = ["out", "sent", "newpw", "in"];
let view = null;
const show = (v) => { view = v; for (const x of views) $(`v-${x}`).hidden = x !== v; };
const say = (text = "", kind = "") => { msg.textContent = text; msg.dataset.kind = kind; };
const MIN_PW = 8;

// What an email link came back with, read before the library takes the fragment away. An
// error is shown as a fixed message by its code — never the link's own text (anyone can make
// a link to this page that says anything).
const hash = new URLSearchParams(location.hash.slice(1));
const linkType = hash.get("type"); // signup | recovery | …
const linkError = hash.get("error_code") || hash.get("error") || (hash.get("error_description") ? "error" : null);
if (linkError) history.replaceState(null, "", location.pathname + location.search);
const LINK_ERRORS = { otp_expired: "That link has expired — ask for a new one." };

// A request that couldn't reach the server (offline, flaky signal): say so plainly instead of
// the browser's own message ("Load failed").
const offline = (e) => !!e && (e.status === 0 || e.name === "AuthRetryableFetchError" || !navigator.onLine
  || (e.name === "TypeError" && /fetch|load failed|network/i.test(e.message || "")));
const sayError = (e) => say(offline(e) ? "No connection." : e?.message || "Something went wrong — try again.", "error");

let session = null;
let sb = null;       // the client, once the library has loaded
let recovering = linkType === "recovery"; // a reset link: set a new password before anything else
let changing = false;                     // "Change password" while signed in
function render() {
  if (session && (recovering || changing)) {
    show("newpw");
    $("newpw-cancel").hidden = recovering;
    $("newpw").focus();
  } else if (session) {
    show("in");
    $("who").textContent = session.user?.email || "";
    showCloud();
  } else if (view !== "sent") {
    show("out");
  }
}

// Invite-only: an account's cloud features stay off until the owner approves it (public.accounts,
// supabase/migrations). Shown under the email; nothing when it can't be read (offline). An
// approved account can turn the sync off on this device.
async function showCloud() {
  const el = $("cloud"), id = session?.user?.id;
  if (el.dataset.uid !== id) { el.hidden = true; $("sync-row").hidden = true; } // (another account's, until read)
  if (!id || !sb) return;
  const { data, error } = await sb.from("accounts").select("approved").maybeSingle();
  if (session?.user?.id !== id) return;
  el.dataset.uid = id;
  el.hidden = !!error || !data;
  $("sync-row").hidden = el.hidden || !data?.approved;
  if (el.hidden) return;
  el.dataset.on = String(data.approved);
  el.textContent = data.approved ? "Cloud: on" : "Cloud: waiting for approval";
  $("sync-on").checked = localStorage.getItem(SYNC_OFF) !== "1";
}

// A session arrived (signed in, an account made, an email link): make the device's data the
// account's, then sync.
async function settle(s) {
  const uid = s?.user?.id;
  if (!uid) return;
  if (activeSpace() !== uid) {
    const pending = localStorage.getItem(ADOPT);
    if (pending && pending === (s.user.email || "").toLowerCase() && activeSpace() === "anon") adopt(uid);
    else await enter(uid);
    localStorage.removeItem(ADOPT);
  }
  startSync();
}
async function startSync() {
  try {
    const m = await import("./sync.js?v=71");
    if (!m.syncOff()) m.start();
    return m;
  } catch (err) { console.warn("sync", err); return null; }
}

// Shown at once from the saved session (a page left for a while first refreshes its token,
// which can take a moment — or fail offline); the library's answer follows.
const saved = savedUser();
ensureSpace(saved?.id);
session = saved && !recovering ? { user: saved } : null;
render();
if (linkError) say(LINK_ERRORS[linkError] || "That link didn't work — try again.", "error");

const ready = supabase(); // (the buttons work while it loads: each request waits for it)

// Each request disables the buttons until it answers.
async function busy(fn) {
  const buttons = [...document.querySelectorAll("button")];
  buttons.forEach((b) => { b.disabled = true; });
  try {
    sb = sb || await ready; // (the page shows before the library has loaded)
    return await fn();
  }
  catch (err) { console.error(err); sayError(err); }
  finally { buttons.forEach((b) => { b.disabled = false; }); }
}
const email = () => $("email").value.trim();
const notConfirmed = (e) => e?.code === "email_not_confirmed" || /not confirmed/i.test(e?.message || "");

$("v-out").addEventListener("submit", (e) => {
  e.preventDefault();
  busy(async () => {
    say();
    const { error } = await sb.auth.signInWithPassword({ email: email(), password: $("password").value });
    if (!error) return; // onAuthStateChange shows the signed-in view
    if (notConfirmed(error)) {
      $("sent-to").textContent = email();
      show("sent");
      say("Confirm your email first.", "error");
    } else sayError(error);
  });
});

$("signup").addEventListener("click", () => {
  if (!$("v-out").reportValidity()) return;
  if ($("password").value.length < MIN_PW) return say(`Password: ${MIN_PW}+ characters.`, "error");
  busy(async () => {
    say();
    // A new account takes what's on this device (settle, once its session arrives — now, or
    // after the email is confirmed and the account signs in here).
    localStorage.setItem(ADOPT, email().toLowerCase());
    const { data, error } = await sb.auth.signUp({ email: email(), password: $("password").value, options: { emailRedirectTo: accountUrl() } });
    if (error) {
      localStorage.removeItem(ADOPT);
      return error.code === "user_already_exists" ? say("That email has an account — sign in.", "error") : sayError(error);
    }
    if (data.session) return; // no confirmation needed: signed in
    // An address that already has an account comes back with no identities (and no email is sent).
    if (data.user && data.user.identities?.length === 0) return say("That email has an account — sign in.", "error");
    $("sent-to").textContent = email();
    show("sent");
  });
});

$("forgot").addEventListener("click", () => {
  if (!$("email").reportValidity()) return;
  busy(async () => {
    const { error } = await sb.auth.resetPasswordForEmail(email(), { redirectTo: accountUrl() });
    if (error) sayError(error);
    else say(`Reset link sent to ${email()}.`, "ok");
  });
});

$("resend").addEventListener("click", () => busy(async () => {
  const to = $("sent-to").textContent;
  const { error } = await sb.auth.resend({ type: "signup", email: to, options: { emailRedirectTo: accountUrl() } });
  if (error) sayError(error);
  else say(`Sent again to ${to}.`, "ok");
}));
$("back").addEventListener("click", () => { say(); show("out"); });

$("v-newpw").addEventListener("submit", (e) => {
  e.preventDefault();
  busy(async () => {
    const { error } = await sb.auth.updateUser({ password: $("newpw").value });
    if (error) return sayError(error);
    $("newpw").value = "";
    recovering = changing = false;
    say("Password saved.", "ok");
    render();
  });
});
$("newpw-cancel").addEventListener("click", () => { changing = false; say(); render(); });
$("change").addEventListener("click", () => { changing = true; say(); render(); });

$("signout").addEventListener("click", () => busy(async () => {
  // The account's data leaves this device: the last changes go up first, and what can't (songs
  // past the cloud's limit, changes that haven't reached it) is said before it's removed.
  if (activeSpace() === session?.user?.id) {
    const m = await startSync();
    if (m) {
      if (!m.syncOff()) await m.syncNow();
      const u = await m.unsynced();
      const text = u.songs ? `${u.songs} song${u.songs > 1 ? "s" : ""} on this device aren't in the cloud and will be removed from it. Sign out?`
        : u.changes ? "Some changes haven't reached the cloud and will be lost. Sign out?" : null;
      if (text && !confirm(text)) return;
    }
  }
  // No sync from here on (a pass under way could otherwise write into the data coming back).
  if (window.resonateSync) { try { await (await import("./sync.js?v=71")).stop(); } catch {} }
  // This device only — other devices stay signed in.
  const { error } = await sb.auth.signOut({ scope: "local" });
  if (error && !offline(error)) return sayError(error);
  // (Offline the library keeps the session; signing out here only ever concerns this device.)
  if (error) localStorage.removeItem(STORAGE_KEY);
  await leave();
  session = null; say(); render();
}));

$("sync-on").addEventListener("change", () => {
  if ($("sync-on").checked) { localStorage.removeItem(SYNC_OFF); startSync().then((m) => m?.syncNow()); }
  else localStorage.setItem(SYNC_OFF, "1");
});

window.resonateDebug = () => ({ view, email: session?.user?.email || null, recovering, changing, ready: !!sb, cloud: $("cloud").hidden ? null : $("cloud").textContent });

// Then the library: it reads an email link's fragment, refreshes a saved session, and tells
// every tab about changes.
try {
  sb = await ready;
} catch (err) {
  console.error(err);
  say("Sign-in couldn't load — check the connection.", "error");
  throw err;
}
// (Rendered on the next tick: calling auth methods inside this callback can deadlock supabase-js.)
sb.auth.onAuthStateChange((event, s) => {
  // (The starting state comes from getSession below: offline, INITIAL_SESSION carries no session
  // although one is saved and kept.)
  if (event === "INITIAL_SESSION") return;
  // Only the tab the reset link opened asks for a new password (the event reaches every tab).
  if (event === "PASSWORD_RECOVERY" && linkType === "recovery") recovering = true;
  if (event === "USER_UPDATED") recovering = false;
  if (event === "SIGNED_OUT") recovering = changing = false;
  setTimeout(async () => {
    if (event === "SIGNED_IN" && s) await settle(s);
    session = s;
    render();
  }, 0);
});
const { data, error: initError } = await sb.auth.getSession();
if (data.session || !(initError && offline(initError) && saved)) {
  if (data.session) await settle(data.session);
  session = data.session;
  render();
} else say("No connection.", "error"); // (keeps the saved account shown; the library retries)
if (!linkError && linkType === "signup" && session) say("Email confirmed.", "ok");
