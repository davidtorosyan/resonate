// The Piano module: keyboard.js's keyboard docked above the dock, to be played — each finger its own
// key, held until it lifts. One keyboard, wherever the Score is: it stays where it is when the Score
// comes or goes (the Score is laid out above it, as Sing's region is — v87 handed the Piano over to
// the Score's own docked keyboard, which came in with the Score: "the Score arrives with its own
// piano"). On its own the range is the open song's melody in whole octaves (C3–B5 at least), else
// C3–B5, and it sounds through its own path (below). Linked to the Score while the Score shows
// (link): the Score's keyboard in all but place — its range is the Score's view, it lights what the
// Score's presses and ▶ sound (play.js draws it: forScore), a key pressed sounds through the Score's
// own path (resonatePlay.press / lift — Play's levels, bus and restrike, lit there too), and what ▶
// plays has its chips at its left end, as on play.html's dock.
// Sound as Play's presses (play.js): a context of the shell's own (ownContext: asleep when the page
// is hidden), the piano decoded on it once the keyboard first shows (warm), the first tap anywhere
// resumes it (the session left alone), a press sets "playback" and strikes in its own pointerdown
// when the context runs and the piano is in — else as soon as it can (iOS: at the lift, which
// resumes it; a context replaced after an interruption, or a tap's resume that hung, re-arms the first-tap resume), for
// LIFT_PLAY, or not at all LATE ms after the lift. Before anything sounds the tuner parks (iOS plays
// quietly while a page has the mic open) and Sing stops — its 🎤 Pitch mic closed until the keys
// are quiet (one sound at a time); a tuner that was
// listening listens again REOPEN ms after the last key lifts, at MIN_RMS until the keys' sound is gone
// (tuner.settle). Silent during a Sing take (quiet()).
// Hidden (the module, the page): every note cut, the context asleep.
// Fingering (E7, docs/FINGERING.md §5): #fing at the row's right end — shown while the keyboard is
// the Score's and the Score says its view has a fingering (fingering(true)); a tap cycles off →
// numbers → hand (this device's pref, resonate.play.fingers; none: numbers) and tells the Score
// (score.fingers()), which draws the digits through forScore().draw and moves the drawn hand
// (hand.js, forScore().hands()). In hand mode the row grows a band under the keys (handplan.js
// bandOf: from the keys' height; 0 where a white key is too narrow for a hand — numbers then) for the
// palm, the wrist and the forearm; it comes or goes with the Score laid out once (resized: keep).
import { mountKeyboard } from "../keyboard.js?v=106";
import { mountHands } from "../hand.js?v=106";
import { bandOf } from "../handplan.js?v=106";
import { loadPiano, pianoNow, holdPiano, primeHold, pianoBus, keepAlive, ownContext, sleepAudio } from "../piano.js?v=106";
import { soundGone } from "../pitch.js?v=106";
import { SHARPS } from "../music.js?v=106";

const MIN_PRESS = 0.25; // s: a quick tap still sounds this long
const LIFT_PLAY = 0.8; // s: a press that could only sound at the lift
const LATE = 1500;     // ms
const MAX_HOLD = 60000;
const REOPEN = 300;    // ms after the last lift: the tuner listens again (if it was)
const AWAKE = 120000;  // ms: the output kept awake after the last key (as Play: WebKit's flips)
const BUS = 0.8, LEVEL = 1.4 / BUS;
const RESTRIKE = 0.015, SLEEP_TC = 0.002;
const HAND = { rh: "#a64fff", lh: "#4f7cff" };
const FINGERS = "resonate.play.fingers"; // "off" | "num" | "hand" (none: "num") — this device's, not shelved
const MODES = ["off", "num", "hand"];
const MODE_LABEL = { off: "off", num: "numbers", hand: "hand" };
// (#fing's face: a hand's outline — off; "123" — numbers; the hand filled — the drawn hand)
const HAND_PATH = "M8.2 12.6V5.4a1.3 1.3 0 0 1 2.6 0v5.8V3.9a1.3 1.3 0 0 1 2.6 0v7.3V4.9a1.3 1.3 0 0 1 2.6 0v6.6V7.6a1.3 1.3 0 0 1 2.6 0v7.1c0 3.8-2.6 6.4-6.3 6.4-2.4 0-3.9-1.1-5.1-2.8l-2.9-4.1a1.35 1.35 0 0 1 2.1-1.7z";
const FACE = {
  off: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="${HAND_PATH}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  num: '<span class="n" aria-hidden="true">123</span>',
  hand: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="${HAND_PATH}" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>`,
};
const sleep = (t) => new Promise((r) => setTimeout(r, t));
const setSession = (type) => { try { if (navigator.audioSession) navigator.audioSession.type = type; } catch {} };

// tuner: { state, park(), start(), settle(until) }; beforeSound(): Sing stops (the tuner is parked here);
// quiet(): true while Sing records; busy(): a module sounds (the tuner isn't reopened then);
// score: { press(midi, e) → a strike | null (Sing records) | undefined (play.js not loaded yet: this
// keyboard's own path), lift(strike), changed() (its keys and chips drawn again), fingers() (#fing's
// mode changed) } — the Score's.
// resized(): the row's height changed (the hand's band came or went) — the Score laid out again, its bars kept.
export function mountPiano(el, { tuner, beforeSound = () => {}, quiet = () => false, busy = () => false, score = null, resized = () => {} }) {
  const kbEl = el.querySelector(".kb");
  // (what ▶ plays, beside the keys while linked: play.js puts its chips here — inside .play-scope, so
  // the Score's own CSS draws them; display: contents, so they're the row's own flex item, as in
  // play.html's dock, with its 8 px gap)
  const hearBox = document.createElement("span");
  hearBox.className = "play-scope";
  hearBox.style.display = "none";
  el.insertBefore(hearBox, kbEl);
  el.style.columnGap = "8px";
  let ac = null, stuck = false, gate = null, shown = false, range = [48, 83];
  let linked = false, scoreLit = new Map(), scoreRange = null, scoreHand = false, ownLit = new Map(); // (linked: the Score's keys; own: its own presses)
  let hands = null, band = 0; // (the drawn hand: hand.js, mounted in hand mode; the band under the keys, px)
  // (fingering: the mode, #fing at the row's right end — after the keys)
  let fmode = "num";
  try { const v = localStorage.getItem(FINGERS); if (MODES.includes(v)) fmode = v; } catch {}
  const fingBtn = document.createElement("button");
  fingBtn.type = "button";
  fingBtn.id = "fing";
  fingBtn.className = "fing";
  fingBtn.hidden = true;
  el.append(fingBtn);
  const face = () => {
    fingBtn.dataset.mode = fmode;
    fingBtn.innerHTML = FACE[fmode];
    fingBtn.setAttribute("aria-label", `Fingering: ${MODE_LABEL[fmode]}`);
    fingBtn.title = `Fingering: ${MODE_LABEL[fmode]}`;
  };
  face();
  fingBtn.addEventListener("click", () => {
    fmode = MODES[(MODES.indexOf(fmode) + 1) % MODES.length];
    try { localStorage.setItem(FINGERS, fmode); } catch {}
    face();
    fingBtn.blur(); // (the pedal's Space / Enter turn pages, not this again)
    if (linked) score?.fingers?.();
  });
  const fingShown = (on) => { on = !!on && linked && shown; if (fingBtn.hidden === !on) return; fingBtn.hidden = !on; syncHands(); };
  const held = new Set(); // the keys down: { midi, h (holdPiano), a, t0, end, lift, dead, cap, ts }
  const sounding = new Set(); // every press whose note may still sound or start (a lifted one waiting for the context too)
  const log = [];
  let reopenAt = 0, reopenT = 0, resume = false;
  const awake = { a: null, src: null, timer: 0 }; // (a: the context its source is on — a replaced one gets its own, as play.js)

  const kb = mountKeyboard(kbEl, {
    range,
    // (linked: the Score's path — a key pressed before play.js has loaded sounds through this one's)
    onPress: (midi, e) => {
      const pk = linked ? score?.press(midi, e) : undefined;
      return pk !== undefined ? { score: pk } : press(midi, e);
    },
    onRelease: (k, e, cancelled) => (k && "score" in k ? score?.lift(k.score) : lift(k, !!e && !cancelled)),
    // (its size: drawn to it — and, linked, the chips beside it placed again: still room for both?)
    onResize: () => { draw(); if (linked && shown) score?.changed(); },
  });
  // What it shows: the Score's keys and range while linked (once play.js has drawn them), else its own.
  function draw() {
    if (!shown) return;
    if (linked && scoreRange) kb.update({ lit: scoreLit, range: scoreRange, hand: scoreHand });
    else kb.update({ lit: ownLit, range, hand: false });
    syncHands();
  }
  // The drawn hand: wanted while the keyboard is the Score's, #fing shows and says hand — and fits
  // (a white key ≥ 14 px). The band under the keys from their height (a phone's shorter); its change
  // lays the Score out again (resized), once.
  const handFits = () => { const g = kb.geo(); return !g || g.hand; };
  function syncHands() {
    const want = shown && linked && !!scoreRange && !fingBtn.hidden && fmode === "hand";
    const g = want ? kb.geo() : null;
    const b = g ? bandOf(g.H, g.ww, innerWidth < 600) : 0;
    if (b && !hands) hands = mountHands(kbEl);
    if (hands) hands.layout(b ? g : null, b);
    if (!b && hands) { hands.destroy(); hands = null; }
    if (b === band) return;
    band = b;
    el.style.setProperty("--kb-band", b + "px");
    if (b) el.dataset.hand = ""; else delete el.dataset.hand;
    resized();
  }

  // --- the context ----------------------------------------------------------------------------
  // (closed, interrupted, or stuck — a tap's resume that never settled, iOS: replaced, as Play's)
  function fresh() {
    if (ac?.state === "running") stuck = false;
    if (!ac || ac.state === "closed" || ac.state === "interrupted" || stuck) {
      if (ac && ac.state !== "closed") ac.close().catch(() => {});
      ac = ownContext(new (window.AudioContext || window.webkitAudioContext)());
      stuck = false;
      gate = null;
      try { pianoBus(ac, BUS); primeHold(ac); } catch {}
      arm(); // (a new context: the next tap anywhere resumes it too)
    }
    return ac;
  }
  // how: "press" (a touch-down: iOS starts audio only at the lift, so a long hold isn't stuck) or
  // "tap" (a lift: a resume still pending after 1.5 s marks the context stuck — the next touch
  // starts over with a new one). As play.js getCtx.
  function wake(a, how) {
    if (a.state === "running") return;
    Promise.race([a.resume().catch(() => {}), sleep(1500)]).then(() => {
      if (a === ac) stuck = how !== "press" && a.state !== "running";
    });
  }
  function warm() { // (the session untouched: making a context and decoding on it changes nothing)
    try { loadPiano(fresh()).catch(() => {}); } catch (err) { console.info("piano: audio", err?.message); }
  }
  const UNLOCK = ["pointerup", "click", "keydown"];
  function unlock(e) {
    if (!e.isTrusted || document.visibilityState === "hidden" || (!ac && (!shown || linked))) return; // (never shown, or the Score's: no context made for it)
    for (const t of UNLOCK) document.removeEventListener(t, unlock, true);
    const a = fresh();
    if (a.state !== "running") a.resume().catch(() => {});
    loadPiano(a).catch(() => {});
  }
  function arm() { for (const t of UNLOCK) document.addEventListener(t, unlock, true); }
  arm();
  // (strikes reach the bus through a gate, cut off at sleep: a damping tail mustn't ring on at the resume)
  function gateOf(a) {
    if (gate?.context !== a) { gate = a.createGain(); gate.connect(pianoBus(a, BUS)); }
    return gate;
  }
  function keepAwake(a) {
    if (awake.a !== a || !awake.src) {
      try { awake.src?.stop(); } catch {}
      const nodes = []; try { keepAlive(a, nodes); } catch {}
      awake.a = a; awake.src = nodes[0] || null;
    }
    clearTimeout(awake.timer);
    awake.timer = setTimeout(quietDown, AWAKE);
  }
  function quietDown() {
    if (held.size) { awake.timer = setTimeout(quietDown, AWAKE); return; }
    try { awake.src?.stop(); } catch {}
    awake.src = null;
  }

  // --- keys --------------------------------------------------------------------------------------
  function press(midi, e) {
    if (quiet()) return null; // (Sing records: silent, not lit)
    if (!held.size && !reopenT) resume = tuner.state === "listening" || tuner.state === "starting";
    clearTimeout(reopenT); reopenT = 0;
    tuner.park(); // (synchronously, before anything sounds: no live mic track)
    beforeSound();
    try { if (navigator.audioSession && navigator.audioSession.type !== "playback") setSession("playback"); } catch {}
    const a = fresh();
    wake(a, "press");
    const k = { midi, h: null, a: null, t0: 0, end: Infinity, lift: 0, dead: false, cap: 0, ts: e.timeStamp };
    const piano = a.state === "running" ? pianoNow(a) : null;
    if (piano) strike(k, a, piano);
    else { loadPiano(a).catch(() => {}); later(k); }
    held.add(k);
    sounding.add(k);
    k.cap = setTimeout(() => lift(k), MAX_HOLD);
    lightSoon();
    return k;
  }
  function strike(k, a, piano) {
    k.a = a;
    k.t0 = a.currentTime;
    for (const o of sounding) if (o !== k && o.midi === k.midi && o.h && o.a === a && o.end > k.t0) { o.h.release(k.t0, RESTRIKE); o.end = k.t0; } // (struck again)
    k.h = holdPiano(a, piano, k.t0, k.midi, LEVEL, { sustain: !k.lift, dest: gateOf(a) });
    log.push({ midi: k.midi, how: k.lift ? "lift" : "hold", lag: Math.round((performance.now() - k.ts) * 10) / 10 });
    if (log.length > 40) log.shift();
    keepAwake(a);
    if (k.lift) { k.h.release(k.t0 + LIFT_PLAY); k.end = k.t0 + LIFT_PLAY; heard(k); setTimeout(() => sounding.delete(k), (LIFT_PLAY + 1) * 1000); }
  }
  // (released: the tuner hears its tail until it's gone — at MIN_RMS, not this device's lower gate)
  function heard(k) { try { tuner.settle?.(soundGone(k.a, k.h.stopsAt())); } catch {} }
  // (couldn't sound at the press: as soon as the context runs with the piano in)
  async function later(k) {
    const late = () => k.lift && performance.now() - k.lift > LATE;
    for (;;) {
      if (k.dead || late()) { sounding.delete(k); return; }
      const a = ac;
      if (a && a.state === "running") {
        let piano = pianoNow(a);
        if (!piano) {
          try { piano = await loadPiano(a); } catch (err) { console.warn("piano", err); sounding.delete(k); return; }
          if (k.dead || late()) { sounding.delete(k); return; }
          if (a !== ac || a.state !== "running") continue;
        }
        strike(k, a, piano);
        return;
      }
      await sleep(30);
    }
  }
  // (tap: a finger's or the mouse's own up — iOS starts audio only there, so a context a press
  // couldn't start, a new one after an interruption, is resumed now and the press sounds at the lift)
  function lift(k, tap = false) {
    if (!k || k.dead || k.lift) return;
    if (tap && (!ac || ac.state !== "running")) wake(fresh(), "tap");
    clearTimeout(k.cap);
    k.lift = performance.now();
    if (k.h) { const at = Math.max(k.a.currentTime, k.t0 + MIN_PRESS); k.h.release(at); k.end = at; k.dead = true; heard(k); setTimeout(() => sounding.delete(k), 1500); }
    held.delete(k);
    lightSoon();
    if (held.size) return;
    if (resume) {
      reopenT = setTimeout(() => {
        reopenT = 0;
        const go = resume;
        resume = false;
        if (go && !held.size && !document.hidden && shown && !busy() && !quiet() && tuner.state === "off") { reopenAt = performance.now(); tuner.start(); }
      }, REOPEN);
    }
  }
  // Every note cut now (hidden, stopped): τ tc.
  function cutAll(tc = 0.04) {
    for (const k of sounding) {
      clearTimeout(k.cap);
      k.dead = true;
      if (k.h && k.end > k.a.currentTime - 0.5) { try { k.h.release(k.a.currentTime, tc); heard(k); } catch {} }
    }
    held.clear();
    sounding.clear();
    clearTimeout(reopenT); reopenT = 0; resume = false;
    light();
  }
  let litKeys = [], lightRaf = 0;
  // (drawn on the next frame: the sound first, and the key under the finger isn't replaced mid-press)
  function lightSoon() { if (!lightRaf) lightRaf = requestAnimationFrame(() => { lightRaf = 0; light(); }); }
  function light() {
    const lit = new Map();
    for (const k of held) {
      const n = SHARPS[((k.midi % 12) + 12) % 12], hand = k.midi >= 60 ? "rh" : "lh";
      lit.set(k.midi, { hand, fill: HAND[hand], letter: n[0], acc: n.slice(1) });
    }
    ownLit = lit;
    litKeys = [...lit.keys()];
    if (!linked || !scoreRange) draw();
  }

  // --- asleep: the page hidden or left ------------------------------------------------------------
  function sleepNow() {
    cutAll(SLEEP_TC);
    if (gate) { try { gate.gain.setValueAtTime(0, gate.context.currentTime); gate.disconnect(); } catch {} gate = null; }
    clearTimeout(awake.timer);
    try { awake.src?.stop(); } catch {}
    awake.src = null;
    sleepAudio(); // (every context the page owns suspended, the session "auto")
    arm();        // (back: the first tap resumes)
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") sleepNow(); });
  addEventListener("pagehide", () => {
    sleepNow();
    if (ac) ac.close().catch(() => {});
    ac = null;
  });

  return {
    el,
    show(on) {
      if (on === shown) return;
      shown = on;
      el.hidden = !on;
      if (on) { kb.remeasure(); kb.forget(); draw(); if (!linked) warm(); }
      else { cutAll(); fingShown(false); syncHands(); }
    },
    get shown() { return shown; },
    // The Score shown (on) or not: the Score's keyboard, or its own again (its own presses' notes cut
    // — the Score's ring on through the Score). → changed
    link(on) {
      on = !!on;
      if (on === linked) return false;
      linked = on;
      hearBox.style.display = on ? "contents" : "none"; // (unlinked: play.js moves the chips back to the stretch's controls)
      if (on) cutAll();
      else { scoreLit = new Map(); scoreRange = null; scoreHand = false; fingShown(false); if (shown) warm(); arm(); }
      kb.forget();
      draw();
      return true;
    },
    get linked() { return linked; },
    // For play.js (resonatePlay.shellKeys), while linked and shown: draw the Score's keys (with their
    // digits, or their letters moved up for the drawn hand), where its chips go (and #fing, which they
    // leave room for), how tall the keyboard is with its band (the two-systems fit leaves it its
    // share), whether the view has a fingering (#fing shown), the mode in effect (hand only where a
    // hand fits: else numbers), the drawn hand (hand.js, in hand mode). → null otherwise
    forScore: () => (linked && shown ? {
      draw: (lit, rg, hand = false) => { scoreLit = lit; scoreRange = rg; scoreHand = !!hand; draw(); },
      host: () => ({ row: el, box: hearBox, strip: kbEl, fing: fingBtn }),
      height: () => el.offsetHeight,
      fingering: (on) => fingShown(on),
      fingers: () => (fmode === "hand" && !handFits() ? "num" : fmode),
      hands: () => (hands?.on ? hands : null),
    } : null),
    setRange(rg) { range = rg; if (!linked || !scoreRange) draw(); },
    stopAll: () => cutAll(),
    held: () => held.size,
    debug: () => ({ shown, linked, range: linked && scoreRange ? [...scoreRange] : [...range], own: [...range], held: [...held].map((k) => k.midi), lit: linked && scoreRange ? [...scoreLit.keys()] : litKeys.slice(),
      litHands: linked && scoreRange ? [...scoreLit].map(([m, L]) => [m, L.hand]) : litKeys.map((m) => [m, m >= 60 ? "rh" : "lh"]), chips: hearBox.querySelectorAll("button[data-key]").length,
      fingers: kb.held(), log: log.slice(), ctx: ac?.state || null, stuck,
      awake: !!awake.src, awakeHere: !!awake.src && awake.a === ac, reopenAt, draws: kb.draws, rect: shown ? (({ left, top, width, height }) => ({ left, top, width, height }))(el.getBoundingClientRect()) : null,
      // fingering: #fing shown, its mode and rect; the digits drawn ([midi, digit]); the keys' layout; the drawn hand and its band
      fing: { shown: !fingBtn.hidden, mode: fmode, rect: fingBtn.hidden ? null : (({ left, top, width, height }) => ({ left, top, width, height }))(fingBtn.getBoundingClientRect()),
        digits: [...kbEl.querySelectorAll(":scope > svg text.fd")].map((t) => [Number(t.dataset.midi), Number(t.textContent)]), geo: (({ whites, ...g }) => g)(kb.geo() || { whites: null }),
        band, hand: hands ? hands.debug() : null } }),
  };
}

// The keyboard's range for a song's notes (midis): whole octaves C…B, C3–B5 at least.
export function rangeOf(midis) {
  let lo = Infinity, hi = -Infinity;
  for (const m of midis) if (Number.isFinite(m)) { lo = Math.min(lo, m); hi = Math.max(hi, m); }
  lo = Math.min(48, Number.isFinite(lo) ? 12 * Math.floor(lo / 12) : 48);
  hi = Math.max(83, Number.isFinite(hi) ? 12 * Math.floor(hi / 12) + 11 : 83);
  return [Math.max(0, lo), Math.min(127, hi)];
}
