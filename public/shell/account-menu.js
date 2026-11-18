// The account corner: the avatar (top right, always — the email's initial, or a person glyph signed
// out; read from the saved session, the sign-in library is never loaded here) and its menu: a sheet
// on a phone, a popover under the avatar on a tablet. Sign in, password and sign out stay on
// account.html (its Sign out order: sync, warn, stop the sync, leave, sign out).
import { savedUser } from "../auth.js?v=85";
import { activeSpace } from "../space.js?v=85";
import { activeProfile } from "../profiles.js?v=85";
import { SHARPS } from "../music.js?v=85";
import { ic, esc, openOverlay, closeOverlay, overlayOpen, go } from "./chrome.js?v=85";

const SYNC_OFF = "resonate.sync.off"; // (sync.js OFF_KEY, as account.js: this device doesn't sync)
const $ = (id) => document.getElementById(id);
const nm = (m) => `${SHARPS[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;

export function mountAccount({ version }) {
  const btn = $("avatar"), menu = $("acct");
  const user = savedUser();

  btn.innerHTML = user
    ? `<span class="face">${esc((user.email[0] || "?").toUpperCase())}</span>`
    : `<span class="face">${ic("person")}</span>`;
  btn.toggleAttribute("data-out", !user);
  btn.setAttribute("aria-label", user ? `Account: ${user.email}` : "Not signed in — account menu");

  const syncOff = () => { try { return localStorage.getItem(SYNC_OFF) === "1"; } catch { return false; } };
  function render() {
    const prof = activeProfile();
    const r = prof?.range;
    const voice = prof
      ? `<span class="pl">Voice<small>${esc(prof.name)}</small></span>${r ? `<span class="pv mono">${nm(r.comfortLow ?? r.low)}–${nm(r.comfortHigh ?? r.high)}</span>` : ""}`
      : `<span class="pl">Voice<small>Find your range</small></span>`;
    const row = (href, lead, inner, tail = ic("chevr", "chev")) => `<a class="prow" href="${href}" data-nav>${lead}${inner}${tail}</a>`;
    const lead = (icon, cls) => `<span class="lead ${cls}">${ic(icon)}</span>`;
    // Sync this device: only when this account's data is the one on the device (as nav.js starts it).
    const synced = user && activeSpace() === user.id;
    menu.innerHTML = `<div class="grab"></div>
      <div class="acct-head"><span class="face ${user ? "" : "out"}">${user ? esc((user.email[0] || "?").toUpperCase()) : ic("person")}</span>
        <div class="who-w"><div class="who">${user ? esc(user.email) : "Not signed in"}</div>${user ? "" : `<div class="cl">Everything works signed out</div>`}</div></div>
      ${user ? "" : `<div class="signin"><a class="primary" href="account.html" data-nav>Sign in</a></div>`}
      <div class="group">${row("voice.html", lead("voice", "l-voice"), voice)}</div>
      ${user ? `<div class="group">
        ${synced ? `<button class="prow" type="button" id="sync-row" role="switch" aria-checked="${!syncOff()}">${lead("cloud", "l-cloud")}<span class="pl">Sync this device</span><span class="switch"></span></button>` : ""}
        ${row("assistants.html", lead("spark", "l-spark"), `<span class="pl">Assistants</span>`)}
      </div>` : ""}
      <div class="group">
        ${row("tools.html", lead("tools", "l-plain"), `<span class="pl">Tools</span>`)}
        ${user ? row("account.html", lead("lock", "l-plain"), `<span class="pl">Account<small>password · sign out</small></span>`, ic("out", "chev")) : ""}
      </div>
      <div class="foot">Resonate <b>${esc(version)}</b></div>`;
  }
  menu.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-nav]");
    if (a) { e.preventDefault(); go(a.getAttribute("href")); return; }
    const sw = e.target.closest("#sync-row");
    if (sw) {
      const on = sw.getAttribute("aria-checked") !== "true";
      try { on ? localStorage.removeItem(SYNC_OFF) : localStorage.setItem(SYNC_OFF, "1"); } catch {}
      sw.setAttribute("aria-checked", String(on));
      if (on) import("../sync.js?v=85").then((m) => { if (!m.syncOff()) { m.start(); m.syncNow(); } }).catch((err) => console.warn("sync", err));
    }
  });

  function open() {
    render();
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    openOverlay("account", () => { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); }, { light: true });
  }
  btn.addEventListener("click", () => (overlayOpen("account") ? closeOverlay() : open()));
  return { open, user };
}
