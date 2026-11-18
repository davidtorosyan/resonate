// The shell's chrome: icons, the device class, and the one overlay layer (a sheet or popover at a
// time: Songs, the account menu, the Reader tray). Escape, a tap on the scrim and Back close the
// one on top; a page left from a sheet replaces the sheet's history entry, so Back comes home.

const ICONS = {
  mic: '<rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
  micoff: '<rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7M4 3l16 18"/>',
  songs: '<path d="M4 6h9M4 11h9M4 16h5"/><path d="M18 4.5v11"/><circle cx="15.6" cy="16.2" r="2.4"/><path d="M18 4.5c1.2.4 2.3 1.1 2.6 2.6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  play: '<path d="M7.5 5.2v13.6c0 .6.7 1 1.2.7l11-6.8c.5-.3.5-1.1 0-1.4l-11-6.8c-.5-.3-1.2.1-1.2.7z"/>',
  person: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  score: '<path d="M3 7h18M3 11h18M3 15h18"/><ellipse cx="9" cy="15.2" rx="2.7" ry="2" transform="rotate(-22 9 15.2)" fill="currentColor"/><path d="M11.4 14.2V3.8l4 1.4"/>',
  doc: '<path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 3v5h5"/>',
  xml: '<path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 3v5h5M10 12.5l-2 2.2 2 2.2M14 12.5l2 2.2-2 2.2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  cloud: '<path d="M7 18.5h10a4.2 4.2 0 0 0 .6-8.4A6 6 0 0 0 6 9.8a4.4 4.4 0 0 0 1 8.7z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  tools: '<path d="M14.5 6.2a4 4 0 0 0-5.2 5.3L4 16.8V20h3.2l5.3-5.3a4 4 0 0 0 5.3-5.2l-2.6 2.6-2.4-.4-.4-2.4z"/>',
  spark: '<path d="M12 3.5l1.7 5L18.5 10l-4.8 1.6L12 16.5l-1.7-4.9L5.5 10l4.8-1.5z"/><path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  level: '<path d="M5 18v-3M9 18v-6M13 18V9M17 18V6"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  rec: '<circle cx="12" cy="12" r="7"/>',
  expand: '<path d="M6 14l6-6 6 6"/>',
  chevr: '<path d="M9 6l6 6-6 6"/>',
  out: '<path d="M14 5h5v5M19 5l-8 8"/><path d="M17 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7H10"/>',
  voice: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M18 8.5c1 .9 1 3.1 0 4M20.5 6.5c2 2 2 6 0 8"/>',
};
export const ic = (n, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;
export const fic = (n, cls = "") => `<svg class="i fill ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// "tablet" (a coarse pointer, the screen's short side ≥ 700 — play.js device()), "phone" (coarse,
// smaller), "desktop". Which page a chosen song opens on: the iPad on the piano gets Play.
export function device() {
  if (!matchMedia("(any-pointer: coarse)").matches) return "desktop";
  return Math.min(screen.width, screen.height) >= 700 ? "tablet" : "phone";
}
export const songPage = () => (device() === "tablet" ? "play.html" : "sing.html");

// --- the overlay layer -------------------------------------------------------------------------
const scrim = document.getElementById("scrim");
let top = null; // { name, close(fromPop) }
let pushed = false;
let expectPop = 0; // our own history.back()s: their popstate isn't the singer's Back

// Show an overlay (closing another first). `close` hides it; `light`: a scrim that keeps context.
export function openOverlay(name, close, { light = false } = {}) {
  if (top && top.name !== name) closeOverlay({ keepHistory: true });
  top = { name, close };
  scrim.hidden = false;
  scrim.toggleAttribute("data-light", light);
  if (!pushed) { history.pushState({ shellSheet: 1 }, ""); pushed = true; }
}
export function closeOverlay({ keepHistory = false, fromPop = false } = {}) {
  const t = top;
  top = null;
  scrim.hidden = true;
  t?.close();
  if (keepHistory) return;
  if (pushed && !fromPop) { pushed = false; expectPop++; history.back(); }
  else pushed = false;
}
export const overlayOpen = (name) => (name ? top?.name === name : !!top);
// Leave for another page: from a sheet, in place of its history entry (Back comes home).
export function go(url) {
  if (pushed) location.replace(url);
  else location.assign(url);
}

scrim.addEventListener("click", () => closeOverlay());
addEventListener("popstate", () => {
  if (expectPop) { expectPop--; return; }
  if (top || pushed) closeOverlay({ fromPop: true });
});
addEventListener("keydown", (e) => { if (e.key === "Escape" && top && !e.defaultPrevented) closeOverlay(); });
// A reload with a sheet's entry current: that entry is the page now.
if (history.state?.shellSheet) history.replaceState(null, "");
