// Account page: sign in / create an account with email + password, reset a forgotten
// password, change it, sign out. Email links (confirm the address, reset the password) come
// back here with the session in the URL fragment; supabase-js reads it (auth.js).
import { supabase, accountUrl } from "./auth.js?v=68";

const $ = (id) => document.getElementById(id);
const msg = $("msg");
const views = ["out", "sent", "newpw", "in"];
let view = null;
const show = (v) => { view = v; for (const x of views) $(`v-${x}`).hidden = x !== v; };
const say = (text = "", kind = "") => { msg.textContent = text; msg.dataset.kind = kind; };
const MIN_PW = 8;

// What an email link came back with, read before the library takes the fragment away.
const hash = new URLSearchParams(location.hash.slice(1));
const linkType = hash.get("type"); // signup | recovery | …
const linkError = hash.get("error_description");
if (linkError) history.replaceState(null, "", location.pathname + location.search);

let sb;
try {
  sb = await supabase();
} catch (err) {
  console.error(err);
  show("out");
  say("Sign-in couldn't load — check the connection.", "error");
  throw err;
}

let session = null;
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
  } else if (view !== "sent") {
    show("out");
  }
}
// (Rendered on the next tick: calling auth methods inside this callback can deadlock supabase-js.)
sb.auth.onAuthStateChange((event, s) => {
  if (event === "PASSWORD_RECOVERY") recovering = true;
  setTimeout(() => { session = s; render(); }, 0);
});
({ data: { session } } = await sb.auth.getSession());
render();
if (linkError) say(linkError, "error");
else if (linkType === "signup" && session) say("Email confirmed.", "ok");

// Each request disables the buttons until it answers.
async function busy(fn) {
  const buttons = [...document.querySelectorAll("button")];
  buttons.forEach((b) => { b.disabled = true; });
  try { return await fn(); }
  catch (err) { console.error(err); say(err.message || "Something went wrong — try again.", "error"); }
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
    } else say(error.message, "error");
  });
});

$("signup").addEventListener("click", () => {
  if (!$("v-out").reportValidity()) return;
  if ($("password").value.length < MIN_PW) return say(`Password: ${MIN_PW}+ characters.`, "error");
  busy(async () => {
    say();
    const { data, error } = await sb.auth.signUp({ email: email(), password: $("password").value, options: { emailRedirectTo: accountUrl() } });
    if (error) return say(error.message, "error");
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
    if (error) say(error.message, "error");
    else say(`Reset link sent to ${email()}.`, "ok");
  });
});

$("resend").addEventListener("click", () => busy(async () => {
  const to = $("sent-to").textContent;
  const { error } = await sb.auth.resend({ type: "signup", email: to, options: { emailRedirectTo: accountUrl() } });
  if (error) say(error.message, "error");
  else say(`Sent again to ${to}.`, "ok");
}));
$("back").addEventListener("click", () => { say(); show("out"); });

$("v-newpw").addEventListener("submit", (e) => {
  e.preventDefault();
  busy(async () => {
    const { error } = await sb.auth.updateUser({ password: $("newpw").value });
    if (error) return say(error.message, "error");
    $("newpw").value = "";
    recovering = changing = false;
    say("Password saved.", "ok");
    render();
  });
});
$("newpw-cancel").addEventListener("click", () => { changing = false; say(); render(); });
$("change").addEventListener("click", () => { changing = true; say(); render(); });

$("signout").addEventListener("click", () => busy(async () => {
  // This device only — other devices stay signed in.
  const { error } = await sb.auth.signOut({ scope: "local" });
  if (error) say(error.message, "error");
  else { session = null; say(); render(); }
}));

window.resonateDebug = () => ({ view, email: session?.user?.email || null, recovering, changing });
