// The full tuner (home): the voice profile's range, a ±50¢ arc, the note, cents, level and the
// waveform. Detection is today's Tuner's (app.js): pitch.js's YIN with the same gates, and its
// locked-note logic — a long median for the cents, a short one that re-locks the shown note
// after it stays > 50¢ off for 250 ms. Nothing opens the mic until Start.
import { openMic, createYin, MIN_RMS, MIN_CLARITY, MIN_FREQ, MAX_FREQ, FFT_SIZE } from "../pitch.js?v=83";
import { SHARPS } from "../music.js?v=83";
import { activeProfile } from "../profiles.js?v=83";
import { ic } from "./chrome.js?v=83";

const PITCH_WINDOW_MS = 1500; // long window: the cents number and needle
const SWITCH_WINDOW_MS = 300; // short window: is the singer still on the shown note?
const SWITCH_DELAY_MS = 250;  // off the note this long → re-lock to the new one
const VOL_STEADY_MS = 2000;   // the level number: median loudness over this window
const VOL_FLOOR_DEFAULT = -65, VOL_CEIL_DEFAULT = -5;
const WATCHDOG_MS = 8000;     // the mic never answered: Start can be tapped again
const PEAKS_MAX = 400;

const $ = (sel, el = document) => el.querySelector(sel);
const setSession = (type) => { try { if (navigator.audioSession) navigator.audioSession.type = type; } catch {} };
const nameOf = (m) => ({ letter: SHARPS[((m % 12) + 12) % 12][0], acc: SHARPS[((m % 12) + 12) % 12].slice(1), oct: Math.floor(m / 12) - 1 });

export function mountTuner(root, { onState = () => {} } = {}) {
  const el = {
    ribbon: $(".ribbon-wrap", root), gauge: $(".gauge", root), note: $(".note-text", root), cents: $(".cents", root),
    msg: $(".tmsg", root), level: $(".level", root), levelFill: $(".level .bar i", root), levelN: $(".level .n", root),
    scope: $(".scope canvas", root),
  };
  const ctx2d = el.scope.getContext("2d");

  // --- the voice profile: range ribbon and volume calibration -------------------------------
  let floor = VOL_FLOOR_DEFAULT, ceil = VOL_CEIL_DEFAULT, calibrated = false, range = null;
  function readProfile() {
    const prof = activeProfile();
    let cal = prof ? prof.vol : null;
    if (!prof) { try { cal = JSON.parse(localStorage.getItem("resonate.volCal")); } catch {} } // (the Tuner's, before profiles)
    calibrated = !!(cal && typeof cal.floor === "number" && typeof cal.ceiling === "number" && cal.ceiling > cal.floor);
    floor = calibrated ? cal.floor : VOL_FLOOR_DEFAULT;
    ceil = calibrated ? cal.ceiling : VOL_CEIL_DEFAULT;
    el.levelN.hidden = !calibrated;
    range = prof?.range && Number.isFinite(prof.range.low) && Number.isFinite(prof.range.high) ? { ...prof.range, name: prof.name } : null;
    drawRibbon();
  }
  let ribLo = 36, ribHi = 84;
  function drawRibbon() {
    el.ribbon.hidden = !range;
    if (!range) return;
    ribLo = Math.min(36, Math.floor(range.low / 12) * 12);
    ribHi = Math.max(84, Math.ceil(range.high / 12) * 12);
    const x = (m) => (((m - ribLo) / (ribHi - ribLo)) * 100).toFixed(2);
    const n = (m) => { const q = nameOf(m); return `${q.letter}${q.acc}${q.oct}`; };
    const cLo = range.comfortLow ?? range.low, cHi = range.comfortHigh ?? range.high;
    let oct = "";
    for (let m = ribLo; m <= ribHi; m += 12) oct += `<i class="tk" style="left:${x(m)}%"></i><span class="ol" style="left:${x(m)}%">C${m / 12 - 1}</span>`;
    el.ribbon.innerHTML = `<div class="lbl"><b></b><span class="mono">${n(cLo)}–${n(cHi)}</span></div>
      <div class="rb"><i class="trk"></i><i class="lim" style="left:${x(range.low)}%;width:${x(range.high) - x(range.low)}%"></i>
      <i class="cmf" style="left:${x(cLo)}%;width:${x(cHi) - x(cLo)}%"></i>${oct}<i class="mk" hidden></i></div>`;
    $(".lbl b", el.ribbon).textContent = range.name || "";
    el.ribbon.setAttribute("aria-label", `${range.name || "Voice"}: ${n(cLo)}–${n(cHi)} — voice profile`);
  }
  readProfile();
  addEventListener("storage", (e) => { if (e.key === "resonate.profiles" || e.key === null) readProfile(); });

  // --- the arc: ticks once, the needle per frame ---------------------------------------------
  const CX = 170, CY = 236, R = 206, SPAN = 38;
  const pt = (c, rr) => { const a = (c / 50) * SPAN * Math.PI / 180; return [CX + rr * Math.sin(a), CY - rr * Math.cos(a)]; };
  const arc = (c0, c1, rr) => { const [x0, y0] = pt(c0, rr), [x1, y1] = pt(c1, rr); return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${rr} ${rr} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
  let ticks = "";
  for (let c = -50; c <= 50; c += 5) {
    const major = c % 25 === 0, big = c === 0;
    const [x0, y0] = pt(c, R - (big ? 16 : major ? 12 : 7)), [x1, y1] = pt(c, R);
    ticks += `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="rgba(236,235,244,${big ? 0.6 : major ? 0.35 : 0.16})" stroke-width="${big ? 2.2 : 1.6}" stroke-linecap="round"/>`;
  }
  const [ax, ay] = pt(-50, R + 22), [bx, by] = pt(50, R + 22);
  el.gauge.innerHTML = `<svg viewBox="0 0 340 74" aria-hidden="true">
    <defs><filter id="tg-gl" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter>
    <linearGradient id="tg-trk" x1="0" x2="1"><stop offset="0" stop-color="#f5a85a" stop-opacity="0"/><stop offset=".3" stop-color="#c49bff" stop-opacity=".25"/><stop offset=".5" stop-color="#4ade80" stop-opacity=".55"/><stop offset=".7" stop-color="#c49bff" stop-opacity=".25"/><stop offset="1" stop-color="#f5a85a" stop-opacity="0"/></linearGradient></defs>
    <path d="${arc(-50, 50, R + 4)}" fill="none" stroke="url(#tg-trk)" stroke-width="3" stroke-linecap="round"/>
    <path d="${arc(-5, 5, R - 4)}" fill="none" stroke="rgba(74,222,128,.28)" stroke-width="14" stroke-linecap="round"/>
    ${ticks}
    <g class="needle" visibility="hidden"><line stroke-width="3" stroke-linecap="round" opacity=".9"/><circle r="9" filter="url(#tg-gl)" opacity=".9"/><circle r="5.5"/></g>
    <text x="${ax.toFixed(1)}" y="${(ay + 4).toFixed(1)}" fill="rgba(236,235,244,.38)" font-size="17" text-anchor="middle">♭</text>
    <text x="${bx.toFixed(1)}" y="${(by + 4).toFixed(1)}" fill="rgba(236,235,244,.38)" font-size="17" text-anchor="middle">♯</text>
  </svg>`;
  const needle = $(".needle", el.gauge), nLine = $("line", needle), [nGlow, nDot] = needle.querySelectorAll("circle");
  const COL = { good: "#4ade80", close: "#c49bff", aim: "#f5a85a" };
  const tuneOf = (c) => (Math.abs(c) <= 5 ? "good" : Math.abs(c) <= 20 ? "close" : "aim"); // (no red: Coach, don't grade)

  // --- state ------------------------------------------------------------------------------
  let mic = null, yin = null, buf = null, raf = 0, gen = 0, watchdog = 0;
  let state = "off"; // off | starting | listening | blocked | noanswer | error
  const hist = [], vols = [], peaks = [];
  let locked = null, offSince = 0, shown = { key: "", cents: null };

  function setState(s, msg = "") {
    state = s;
    root.dataset.mic = s;
    el.msg.textContent = msg;
    el.msg.hidden = !msg;
    onState(s);
  }

  // --- the locked note (app.js updatePitchDisplay) -------------------------------------------
  const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; };
  const longMidi = () => (hist.length < 5 ? null : median(hist.map((p) => p.midi)));
  function shortMidi(now) {
    const r = [];
    for (let i = hist.length - 1; i >= 0 && hist[i].time >= now - SWITCH_WINDOW_MS; i--) r.push(hist[i].midi);
    return r.length < 3 ? null : median(r);
  }
  function showPitch(now) {
    const lm = longMidi();
    if (lm === null) { locked = null; offSince = 0; return render(null); }
    if (locked === null) locked = Math.round(lm);
    const sm = shortMidi(now);
    if (sm !== null) {
      if (Math.abs((sm - locked) * 100) > 50) {
        if (!offSince) offSince = now;
        if (now - offSince > SWITCH_DELAY_MS) {
          locked = Math.round(sm);
          let drop = 0;
          while (drop < hist.length && hist[drop].time < now - SWITCH_WINDOW_MS) drop++;
          hist.splice(0, drop);
          offSince = 0;
        }
      } else offSince = 0;
    }
    const cents = Math.round(((longMidi() ?? lm) - locked) * 100);
    const onNote = sm === null || Math.abs((sm - locked) * 100) <= 50;
    render({ midi: locked, cents, onNote });
  }
  function render(p) {
    const key = p ? `${p.midi}|${p.cents}|${p.onNote}` : "";
    if (key === shown.key) return;
    shown = { key, ...(p || {}) };
    if (!p) {
      el.note.innerHTML = "—";
      el.note.removeAttribute("data-onnote");
      el.cents.textContent = "";
      el.cents.removeAttribute("data-tune");
      needle.setAttribute("visibility", "hidden");
      const mk = $(".mk", el.ribbon); if (mk) mk.hidden = true;
      return;
    }
    const n = nameOf(p.midi);
    el.note.innerHTML = `${n.letter}${n.acc ? `<span class="acc">${n.acc}</span>` : ""}<span class="oct">${n.oct}</span>`;
    el.note.dataset.onnote = String(p.onNote);
    const tune = tuneOf(p.cents);
    el.cents.textContent = `${p.cents > 0 ? "+" : p.cents < 0 ? "−" : "±"}${Math.abs(p.cents)}¢`;
    el.cents.dataset.tune = tune;
    const c = Math.max(-50, Math.min(50, p.cents)), col = COL[tune];
    const [nx, ny] = pt(c, R + 9), [x0, y0] = pt(c, R - 30), [x1, y1] = pt(c, R + 2);
    nLine.setAttribute("x1", x0.toFixed(1)); nLine.setAttribute("y1", y0.toFixed(1));
    nLine.setAttribute("x2", x1.toFixed(1)); nLine.setAttribute("y2", y1.toFixed(1));
    nLine.setAttribute("stroke", col);
    for (const d of [nGlow, nDot]) { d.setAttribute("cx", nx.toFixed(1)); d.setAttribute("cy", ny.toFixed(1)); d.setAttribute("fill", col); }
    needle.setAttribute("visibility", "visible");
    const mk = $(".mk", el.ribbon);
    if (mk && range) { mk.hidden = false; mk.style.left = `${(((p.midi + p.cents / 100 - ribLo) / (ribHi - ribLo)) * 100).toFixed(2)}%`; }
  }

  // --- level (dB → 1–10 between the calibrated floor and ceiling) ------------------------------
  function showLevel(db, now) {
    const t = Math.max(0, Math.min(1, (db - floor) / (ceil - floor)));
    el.levelFill.style.width = `${(t * 100).toFixed(1)}%`;
    if (!calibrated) return;
    while (vols.length && vols[0].time < now - VOL_STEADY_MS) vols.shift();
    el.levelN.textContent = vols.length < 8 ? "—" : String(Math.round(1 + Math.max(0, Math.min(1, (median(vols.map((v) => v.db)) - floor) / (ceil - floor))) * 9));
  }

  // --- the waveform: one bar per frame's peak, newest at the right ---------------------------
  let sw = 0, sh = 0;
  const sizeScope = () => {
    const r = el.scope.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    sw = r.width; sh = r.height;
    el.scope.width = Math.round(sw * dpr); el.scope.height = Math.round(sh * dpr);
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScope();
  };
  new ResizeObserver(sizeScope).observe(el.scope);
  function drawScope() {
    if (!sw || !sh) return;
    ctx2d.clearRect(0, 0, sw, sh);
    const stride = 6, n = Math.max(1, Math.floor(sw / stride)), mid = sh / 2;
    const g = ctx2d.createLinearGradient(0, 0, sw, 0);
    g.addColorStop(0, "rgba(111,141,255,.08)"); g.addColorStop(0.55, "rgba(166,79,255,.6)"); g.addColorStop(1, "rgba(255,208,234,.95)");
    ctx2d.fillStyle = g;
    const start = Math.max(0, peaks.length - n), off = sw - (peaks.length - start) * stride;
    for (let i = start; i < peaks.length; i++) {
      const h = Math.max(2, Math.tanh(peaks[i] * 5.5) * mid * 0.94 * 2);
      const x = off + (i - start) * stride;
      ctx2d.beginPath();
      ctx2d.roundRect ? ctx2d.roundRect(x, mid - h / 2, 3, h, 1.5) : ctx2d.rect(x, mid - h / 2, 3, h);
      ctx2d.fill();
    }
    if (peaks.length < n) { // the rest: a quiet line
      ctx2d.fillStyle = "rgba(255,255,255,.08)";
      ctx2d.fillRect(0, mid - 0.5, off, 1);
    }
  }

  // --- the frame loop ---------------------------------------------------------------------
  function frame() {
    raf = requestAnimationFrame(frame);
    if (!mic) return;
    mic.analyser.getFloatTimeDomainData(buf);
    let sum = 0, peak = 0;
    for (let i = 0; i < buf.length; i++) { const v = buf[i]; sum += v * v; const a = v < 0 ? -v : v; if (a > peak) peak = a; }
    const rms = Math.sqrt(sum / buf.length), db = 20 * Math.log10(rms || 1e-6), now = performance.now();
    if (rms > MIN_RMS) {
      vols.push({ time: now, db });
      const r = yin(buf);
      if (r && r.clarity > MIN_CLARITY && r.freq >= MIN_FREQ && r.freq <= MAX_FREQ) {
        hist.push({ time: now, midi: 69 + 12 * Math.log2(r.freq / 440) });
        while (hist.length && hist[0].time < now - PITCH_WINDOW_MS) hist.shift();
      }
    } else {
      while (hist.length && hist[0].time < now - PITCH_WINDOW_MS) hist.shift();
    }
    showPitch(now);
    showLevel(db, now);
    peaks.push(peak);
    if (peaks.length > PEAKS_MAX) peaks.shift();
    drawScope();
  }

  // --- Start / Stop (app.js start/stop: iOS's audio session, the watchdog, startGen) ---------------
  async function start() {
    if (state === "listening" || state === "starting") return;
    const g = ++gen;
    setState("starting");
    setSession("play-and-record"); // (iOS keeps a page's session type for the whole tab)
    clearTimeout(watchdog);
    watchdog = setTimeout(() => { if (g === gen && state === "starting") setState("noanswer", "Mic not answering — tap again"); }, WATCHDOG_MS);
    try {
      const m = await openMic();
      if (g !== gen) { m.close(); return; } // (a newer Start or a Stop)
      mic = m;
      yin = createYin(m.ac.sampleRate, FFT_SIZE);
      buf = new Float32Array(m.analyser.fftSize);
      hist.length = 0; vols.length = 0; peaks.length = 0; locked = null; offSince = 0;
      clearTimeout(watchdog);
      setState("listening");
      if (!raf) frame();
    } catch (err) {
      if (g !== gen) return;
      clearTimeout(watchdog);
      console.warn("mic", err);
      await stop();
      if (err?.name === "NotAllowedError" || err?.name === "SecurityError") setState("blocked", "Allow the mic: aA → Website Settings → Microphone");
      else setState("error", "Mic didn't start — tap again");
    }
  }
  async function stop() {
    gen++;
    clearTimeout(watchdog);
    cancelAnimationFrame(raf); raf = 0;
    const m = mic;
    mic = null;
    if (m) await m.close();
    setSession("auto");
    hist.length = 0; vols.length = 0; peaks.length = 0; locked = null; offSince = 0;
    render(null);
    drawScope();
    el.levelFill.style.width = "0%";
    el.levelN.textContent = "—";
    setState("off");
  }
  const toggle = () => (state === "listening" || state === "starting" ? stop() : start());

  document.addEventListener("visibilitychange", () => { if (document.hidden && mic) stop(); });
  addEventListener("pagehide", () => { if (mic || state === "starting") stop(); setSession("auto"); });
  if (!navigator.mediaDevices?.getUserMedia) setState("error", "No mic here — open over HTTPS");
  else setState("off");
  render(null);

  return {
    start, stop, toggle,
    get state() { return state; },
    debug: () => ({ state, note: shown.midi ?? null, cents: shown.cents ?? null, frames: peaks.length, calibrated, range: !!range }),
  };
}

export const tunerHtml = () => `
  <a class="ribbon-wrap" href="voice.html" hidden></a>
  <div class="gauge"></div>
  <div class="note-text" aria-live="off">—</div>
  <div class="cents"></div>
  <div class="tmsg" role="status" hidden></div>
  <div class="level">${ic("level")}<div class="bar"><i></i><div class="ticks">${"<b></b>".repeat(9)}</div></div><span class="n mono" hidden>—</span><a class="cal" href="voice.html" aria-label="Mic level (voice profile)">${ic("sliders")}</a></div>
  <div class="scope"><canvas></canvas></div>`;
