// Page headers: the account link says "Account" when signed in, "Sign in" when not — read
// from the saved session, so the sign-in library isn't loaded on every page.
import { savedUser } from "./auth.js?v=68";

const user = savedUser();
for (const a of document.querySelectorAll("[data-account-link]")) {
  a.textContent = (user ? "Account" : "Sign in") + (a.dataset.accountLink === "chip" ? " ›" : "");
  if (user) a.title = user.email;
}
