// Every page: the account link says "Account" when signed in, "Sign in" when not (read from the
// saved session, so the sign-in library isn't loaded on every page); the space and the cloud
// sync start here (space.js, sync.js).
import { savedUser } from "./auth.js?v=127";
import { ensureSpace, activeSpace, activeDb, park } from "./space.js?v=127";

// An email link (confirm / reset) that landed on another page than the account page — Supabase
// sends it to the project's Site URL (the site's root) when the page that asked isn't on its
// redirect list: hand it to the account page, which reads it.
export const handing = !/account\.html$/.test(location.pathname) && /(^|[#&])(access_token|error_code|error_description)=/.test(location.hash);
if (handing) location.replace("account.html" + location.hash);
// A page on its way out — an email link handed on, or an old page going into the shell (away.js
// marks <html data-away>) — runs nothing more: this module never finishes, so the modules that
// import it (sing.js, play.js, pdf-import.js, the shell) never start — no import resumed, no
// Verovio, no 📡. (WebKit still runs a module script whose import of this one another <script>
// started: away.js stops the old pages' loading before their modules, the shell checks `handing`.)
if (handing || document.documentElement.hasAttribute("data-away")) await new Promise(() => {});

const user = savedUser();
// The session ended without Sign out (expired, signed out in another tab): the account's data is
// put away (space.js) before the page reads anything — this script comes first on the pages
// that read the user's data.
if (!user && activeSpace() !== "anon") park();
ensureSpace(user?.id);
for (const a of document.querySelectorAll("[data-account-link]")) {
  a.textContent = (user ? "Account" : "Sign in") + (a.dataset.accountLink === "chip" ? " ›" : "");
  if (user) a.title = user.email;
}

// Cloud sync, for a signed-in account whose data is the one on this device (the library loads
// only then: signed-out pages stay as light as before).
if (!handing && user && activeSpace() === user.id) {
  import("./sync.js?v=127").then((m) => { if (!m.syncOff()) m.start(); }).catch((err) => console.warn("sync", err));
}

// Another tab switched whose data this device shows (signed in, out, …): this page still shows
// the old space's, and anything it saved would land in the new one — reload, once nothing is
// under way (a page marks a take, a loop or a conversion with window.resonateBusy; meanwhile
// spaceChanged() tells it not to save the user's data).
const activeAtLoad = activeSpace();
let changed = false, reloading = false;
export const spaceChanged = () => changed || activeSpace() !== activeAtLoad;
function followSpace() {
  if (reloading || !changed) return;
  if (window.resonateBusy?.()) { setTimeout(followSpace, 1000); return; }
  reloading = true;
  location.reload();
}
window.addEventListener("storage", (e) => {
  if (e.key !== "resonate.space" && e.key !== null) return;
  if (activeSpace() !== activeAtLoad) { changed = true; followSpace(); }
});
window.addEventListener("pageshow", (e) => { if (e.persisted && activeSpace() !== activeAtLoad) { changed = true; followSpace(); } });

// A PDF → Song import left unfinished on this device (the page was left or reloaded while it read):
// a pill back to it — the shell's tray continues where it was (omr/importer.js). Read from the small
// flag omr/jobs.js keeps (resonate.import), not the jobs database: nothing is opened on other pages.
// (Only Tools shows it to people since cleanup C phase 4: the other pages with nav.js go into the
// shell — away.js —, which draws the import itself.)
// Leaving the import page stops its engine, so the pill says paused (⏸) — unless another tab holds
// the engine's lock (⟳: it's reading there) — and counts as the Reader does: the PDF page being read
// (the next one) of the PDF's pages.
const IMPORT_FLAG = "resonate.import";
const ENGINE_LOCK = "resonate-omr-engine";
let pillGen = 0;
async function importPill() {
  const gen = ++pillGen;
  if (/pdf-import\.html$/.test(location.pathname)) return; // (it draws the import itself)
  let f = null;
  try { f = JSON.parse(localStorage.getItem(IMPORT_FLAG) || "null"); } catch {}
  const here = f && (f.db ? f.db === activeDb() : f.space === activeSpace());
  let running = false;
  if (here) { try { running = !!(await navigator.locks?.query())?.held?.some((l) => l.name === ENGINE_LOCK); } catch {} }
  if (gen !== pillGen) return;
  document.getElementById("import-pill")?.remove();
  if (!here || Date.now() - (f.at || 0) > 14 * 864e5) return;
  const a = document.createElement("a");
  a.id = "import-pill";
  a.href = "./?open=import"; // (the shell: its tray resumes the import, shown)
  const count = f.page && f.pages ? ` ${f.page}/${f.pages}` : "";
  a.textContent = `${running ? "⟳" : "⏸"} PDF → Song${count}`;
  a.setAttribute("aria-label", `PDF → Song${running ? "" : ", paused"}${f.page && f.pages ? `, page ${f.page} of ${f.pages}` : ""}: ${running ? "show" : "continue"}`);
  a.dataset.state = running ? "running" : "paused";
  // (Fixed bottom-left, under the pages' sheets and dialogs — Sing's options, More, review: z-index 40+.)
  a.style.cssText = "position:fixed;left:max(12px,env(safe-area-inset-left));bottom:max(12px,env(safe-area-inset-bottom));" +
    "z-index:30;display:inline-flex;align-items:center;min-height:40px;padding:0 14px;border-radius:999px;" +
    "background:rgba(26,26,62,.92);border:1px solid #a64fff;color:#e8e8f0;font:600 13px/1 system-ui,-apple-system,sans-serif;" +
    "text-decoration:none;box-shadow:0 4px 16px rgba(0,0,0,.4);-webkit-tap-highlight-color:transparent";
  document.body.append(a);
}
// (Not on the shell — the root since v92, <html data-shell>: it draws the import itself, its tray.)
if (!document.documentElement.hasAttribute("data-shell")) {
  importPill();
  window.addEventListener("storage", (e) => { if (e.key === IMPORT_FLAG || e.key === null) importPill(); });
}
