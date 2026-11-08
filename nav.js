// Page headers: the account link says "Account" when signed in, "Sign in" when not — read
// from the saved session, so the sign-in library isn't loaded on every page.
import { savedUser } from "./auth.js?v=69";

// An email link (confirm / reset) that landed on another page than the account page — Supabase
// sends it to the project's Site URL (the site's root) when the page that asked isn't on its
// redirect list: hand it to the account page, which reads it.
if (!/account\.html$/.test(location.pathname) && /(^|[#&])(access_token|error_code|error_description)=/.test(location.hash)) {
  location.replace("account.html" + location.hash);
}

const user = savedUser();
for (const a of document.querySelectorAll("[data-account-link]")) {
  a.textContent = (user ? "Account" : "Sign in") + (a.dataset.accountLink === "chip" ? " ›" : "");
  if (user) a.title = user.email;
}
