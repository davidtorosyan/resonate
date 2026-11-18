// Every page: the account link says "Account" when signed in, "Sign in" when not (read from the
// saved session, so the sign-in library isn't loaded on every page); the space and the cloud
// sync start here (space.js, sync.js).
import { savedUser } from "./auth.js?v=81";
import { ensureSpace, activeSpace, activeDb, park } from "./space.js?v=81";

// An email link (confirm / reset) that landed on another page than the account page — Supabase
// sends it to the project's Site URL (the site's root) when the page that asked isn't on its
// redirect list: hand it to the account page, which reads it.
const handing = !/account\.html$/.test(location.pathname) && /(^|[#&])(access_token|error_code|error_description)=/.test(location.hash);
if (handing) location.replace("account.html" + location.hash);

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
if (!handing && user && activeSpace() === user.id) {
  import("./sync.js?v=81").then((m) => { if (!m.syncOff()) m.start(); }).catch((err) => console.warn("sync", err));
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
// a pill back to it — the import page continues where it was (omr/importer.js). Read from the small
// flag omr/jobs.js keeps (resonate.import), not the jobs database: nothing is opened on other pages.
// Leaving the import page stops its engine, so the pill says paused (⏸) — unless another tab holds
// the engine's lock (⟳: it's reading there) — and counts as the Reader does: the PDF page being read
// (the next one) of the PDF's pages.
const IMPORT_FLAG = "resonate.import";
const ENGINE_LOCK = "resonate-omr-engine";
let pillGen = 0;
async function importPill() {
  const gen = ++pillGen;
  if (/pdf-import\.html$/.test(location.pathname)) return;
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
  a.href = "pdf-import.html";
  const count = f.page && f.pages ? ` ${f.page}/${f.pages}` : "";
  a.textContent = `${running ? "⟳" : "⏸"} PDF → Song${count}`;
  a.setAttribute("aria-label", `PDF → Song${running ? "" : ", paused"}${f.page && f.pages ? `, page ${f.page} of ${f.pages}` : ""}: ${running ? "show" : "continue"}`);
  a.dataset.state = running ? "running" : "paused";
  // (Under the pages' sheets and dialogs — Sing's options, More, review: z-index 40+.)
  a.style.cssText = "position:fixed;left:max(12px,env(safe-area-inset-left));bottom:max(12px,env(safe-area-inset-bottom));" +
    "z-index:30;display:inline-flex;align-items:center;min-height:40px;padding:0 14px;border-radius:999px;" +
    "background:rgba(26,26,62,.92);border:1px solid #a64fff;color:#e8e8f0;font:600 13px/1 system-ui,-apple-system,sans-serif;" +
    "text-decoration:none;box-shadow:0 4px 16px rgba(0,0,0,.4);-webkit-tap-highlight-color:transparent";
  document.body.append(a);
  placePill(a);
  setTimeout(() => placePill(a), 1500); // pages that lay out late (the Tuner's controls)
}
// Bottom-left unless that covers a control (the Tuner's Start, Sing's Listen, Play's keyboard chips):
// then the bottom-right, then a little higher, up to mid-screen.
function placePill(a) {
  if (!a.isConnected) return;
  a.style.left = "max(12px, env(safe-area-inset-left))"; a.style.top = "auto"; a.style.bottom = "max(12px, env(safe-area-inset-bottom))";
  const r0 = a.getBoundingClientRect(), w = r0.width, h = r0.height;
  const W = innerWidth, H = innerHeight, left = r0.left, bottom = H - r0.bottom;
  const ctl = [...document.querySelectorAll("button, a[href], select, input, [role=button]")]
    .filter((el) => el !== a && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden")
    .map((el) => el.getBoundingClientRect()).filter((r) => r.width && r.height);
  const free = (x, y) => !ctl.some((r) => r.left < x + w && r.right > x && r.top < y + h && r.bottom > y);
  for (let y = H - h - bottom; y > H * 0.5; y -= 8) {
    for (const x of [left, W - w - left]) {
      if (free(x, y)) { a.style.left = `${x}px`; a.style.top = `${y}px`; a.style.bottom = "auto"; return; }
    }
  }
}
// Controls that show later (Play's keyboard and its chips once the song is drawn, a page's bar
// changing): placed again when something is shown or hidden — at most every 400 ms.
let placeTimer = null;
const placeSoon = () => {
  if (placeTimer || !document.getElementById("import-pill")) return;
  placeTimer = setTimeout(() => { placeTimer = null; const a = document.getElementById("import-pill"); if (a) placePill(a); }, 400);
};
importPill();
new MutationObserver(placeSoon).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
window.addEventListener("storage", (e) => { if (e.key === IMPORT_FLAG || e.key === null) importPill(); });
window.addEventListener("resize", () => { const a = document.getElementById("import-pill"); if (a) placePill(a); });
