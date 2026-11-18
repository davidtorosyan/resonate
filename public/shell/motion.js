// The shell's motion: a song's modules slide up from the bottom (behind the dock) and back down,
// the tuner shrinks into its small form and grows back, what goes fades out where it was. Nothing
// here moves the chrome (the avatar, Songs, the module toggles): those never change place.
// Everything is a Web Animation on transform / opacity (composited); a region that leaves is held
// where it was (fixed, out of the flow) while it slides out, so the layout under it is already
// the new one. prefers-reduced-motion: a short crossfade instead of every slide and morph.
// settle() ends whatever still runs (a new change, a fast second tap): no half-done states.

const DUR = 300, OUT = 240, FADE = 150;
const EASE = "cubic-bezier(.22,.8,.24,1)", EASE_IN = "cubic-bezier(.5,0,.75,.4)";
const live = new Set(); // { anim, fin }
export const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function track(anim, end) {
  const t = { anim, done: false };
  t.fin = () => { if (t.done) return; t.done = true; live.delete(t); try { end?.(); } catch (err) { console.warn("motion", err); } };
  anim.finished.then(t.fin, t.fin);
  live.add(t);
  return anim;
}
// End every running transition now (their end states applied).
export function settle() {
  for (const t of [...live]) { try { t.anim.cancel(); } catch {} t.fin(); }
}
export const running = () => live.size;
const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";

// In its place already: come up from the bottom of the window (or fade in).
export function slideIn(el, { delay = 0 } = {}) {
  const r = el.getBoundingClientRect();
  if (!r.height || document.hidden) return;
  const kf = reduced() ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: `translateY(${Math.max(48, innerHeight - r.top)}px)` }, { transform: "none" }];
  track(el.animate(kf, { duration: reduced() ? FADE : DUR, easing: EASE, delay, fill: "backwards" }));
}
// Leaving: held where it is, out of the flow, slid down (or faded); done() hides it.
export function slideOut(el, done) {
  const r = el.getBoundingClientRect();
  if (!r.height || document.hidden) { done(); return; }
  const prev = el.getAttribute("style");
  Object.assign(el.style, { position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
    margin: "0", zIndex: "0", pointerEvents: "none", boxSizing: "border-box" }); // (under the dock and the Piano: it slides out behind them)
  el.dataset.leaving = "";
  const kf = reduced() ? [{ opacity: 1 }, { opacity: 0 }] : [{ transform: "none" }, { transform: `translateY(${Math.max(48, innerHeight - r.top)}px)` }];
  const anim = el.animate(kf, { duration: reduced() ? FADE : OUT, easing: EASE_IN, fill: "forwards" });
  track(anim, () => {
    done(); // (hidden first, then the held place and the slid-out look go: no frame of it back in place)
    if (prev === null) el.removeAttribute("style"); else el.setAttribute("style", prev);
    delete el.dataset.leaving;
    anim.cancel();
  });
}
export function fadeIn(el, { delay = 0, dur = FADE, from = null } = {}) {
  if (!visible(el) || document.hidden) return;
  const kf = from && !reduced() ? [{ opacity: 0, transform: from }, { opacity: 1, transform: "none" }] : [{ opacity: 0 }, { opacity: 1 }];
  track(el.animate(kf, { duration: dur, easing: EASE, delay, fill: "backwards" }));
}
// A still copy of el where it is now, in `host` (default: its own parent — the same styles), fixed;
// → { el, r } or null (not shown). Canvases are copied (a clone's are blank).
export function ghost(el, host = el.parentNode) {
  if (!visible(el) || document.hidden) return null;
  const r = el.getBoundingClientRect();
  const g = el.cloneNode(true);
  g.removeAttribute("id");
  for (const n of g.querySelectorAll("[id]")) n.removeAttribute("id");
  g.removeAttribute("hidden");
  g.setAttribute("aria-hidden", "true");
  g.inert = true;
  const from = el.querySelectorAll("canvas"), to = g.querySelectorAll("canvas");
  from.forEach((c, i) => { try { to[i].width = c.width; to[i].height = c.height; to[i].getContext("2d").drawImage(c, 0, 0); } catch {} });
  Object.assign(g.style, { position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
    margin: "0", zIndex: "19", pointerEvents: "none", boxSizing: "border-box", transformOrigin: "50% 50%" });
  g.classList.add("ghost");
  host.append(g);
  return { el: g, r };
}
// A ghost made before a change fades out where it was.
export function fadeOut(gh, { dur = FADE } = {}) {
  if (!gh) return;
  track(gh.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, easing: "ease-out", fill: "forwards" }), () => gh.el.remove());
}
export const drop = (gh) => gh?.el.remove();

// The same element in another form or place (the tuner: full ⇄ strip / docked / chip): the old
// look (a ghost made before the change) shrinks or grows toward the new box and fades, the new one
// fades in just after, from a little way toward where the old one was.
export function morph(gh, el) {
  if (!gh) { fadeIn(el, { dur: DUR }); return; }
  if (!visible(el) || document.hidden) { drop(gh); return; }
  const a = gh.r, b = el.getBoundingClientRect();
  if (reduced()) {
    fadeOut(gh);
    fadeIn(el);
    return;
  }
  const s = Math.max(0.1, Math.min(1.6, Math.min(b.width / a.width, b.height / a.height)));
  const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
  track(gh.el.animate([{ transform: "none", opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0 }],
    { duration: DUR, easing: EASE, fill: "forwards" }), () => gh.el.remove());
  const back = (v) => Math.max(-60, Math.min(60, -v * 0.25));
  track(el.animate([{ opacity: 0, transform: `translate(${back(dx)}px, ${back(dy)}px) scale(.94)` }, { opacity: 1, transform: "none" }],
    { duration: DUR, easing: EASE, delay: 70, fill: "backwards" }));
}
// Moved in place (same form and parent): from where it was to where it is (FLIP).
export function glide(el, a) {
  if (!a || !visible(el) || document.hidden || reduced()) return;
  const b = el.getBoundingClientRect();
  const dx = a.left - b.left, dy = a.top - b.top;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
  track(el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: DUR, easing: EASE }));
}
