// Every page: the account link says "Account" when signed in, "Sign in" when not (read from the
// saved session, so the sign-in library isn't loaded on every page); the space and the cloud
// sync start here (space.js, sync.js).
import { savedUser } from "./auth.js?v=71";
import { ensureSpace, activeSpace, park } from "./space.js?v=71";

// An email link (confirm / reset) that landed on another page than the account page — Supabase
// sends it to the project's Site URL (the site's root) when the page that asked isn't on its
// redirect list: hand it to the account page, which reads it.
if (!/account\.html$/.test(location.pathname) && /(^|[#&])(access_token|error_code|error_description)=/.test(location.hash)) {
  location.replace("account.html" + location.hash);
}

const user = savedUser();
// The session ended without Sign out (expired, signed out in another tab): the account's data is
// put away (space.js) before the page reads anything — this script comes first on the pages
// that read the user's data, except the Tuner, whose classic script already has: it reloads.
if (!user && activeSpace() !== "anon" && park() && activeSpace() === "anon" && document.querySelector('script[src^="app.js"]')) location.reload();
ensureSpace(user?.id);
for (const a of document.querySelectorAll("[data-account-link]")) {
  a.textContent = (user ? "Account" : "Sign in") + (a.dataset.accountLink === "chip" ? " ›" : "");
  if (user) a.title = user.email;
}

// Cloud sync, for a signed-in account whose data is the one on this device (the library loads
// only then: signed-out pages stay as light as before).
if (user && activeSpace() === user.id) {
  import("./sync.js?v=71").then((m) => { if (!m.syncOff()) m.start(); }).catch((err) => console.warn("sync", err));
}
