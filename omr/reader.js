// The Reader: PDF → Song drawn as it happens. The real page (the preview pdfprep keeps), the
// engine's lens moving system by system as Audiveris reports each one, what it found appearing
// on the page as a scan line passes, and the code it becomes beside it — the engine's own sheet
// XML while it reads, MusicXML <note>s once a page's notes are known, then the real file.
// Minimizes to a corner pill (ring = progress). A self-contained component: no page globals,
// its CSS injected once, colours and sizes as custom properties on .rd.
//
//   import { mount } from './omr/reader.js?v=82';
//   const reader = mount(el, { onMinimize, onExpand, onStop, minimized, links: { sing: 'sing.html', play: 'play.html' } });
//     (onStop: a ✕ in the card's top bar; a second tap — "Stop?" — within 3 s calls it; hidden at done
//     and while reader.canStop(false))
//   reader.push(event)    // a live event (the contract in readerstate.js)
//   reader.load(events)   // a stored run, fast-forwarded (resume): drawn at once, no animation
//   reader.hold(true)     // the host isn't running it (stuck, another tab): clocks stop, nothing breathes; an event lets go
//   reader.minimize(); reader.expand(); reader.destroy();
//
// Honest by construction: it draws only what the events carry. Animation paces events that
// already arrived over the gap expected before the next one (it never runs ahead of the data);
// when nothing arrives the lens breathes, and after ~20 s the step's own clock shows. Two
// states: `st` = every event received (facts, ETA, the pill), `vs` = what is drawn (behind by
// at most the queue). Minimized or hidden: events are only reduced, nothing is drawn; on return
// the latest state is drawn at once.

import * as R from './readerstate.js?v=82';

const SVGNS = 'http://www.w3.org/2000/svg';
const FF_BACKLOG = 8;        // heavy events waiting beyond which the Reader jumps to the latest state
const MAX_LINES = 60;        // code lines kept in the DOM
const LINE_RATE = 16;        // code lines a second, at most (fewer when only a few show)
const QUIET_CLOCK = 20;      // seconds without news before the step's clock shows
const THUMB_PX = 96;         // thumbnail backing height (2× a 48 px thumb)

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const r1 = (v) => Math.round(v * 10) / 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Up to n items spread evenly over a list (all of it when short).
function pickEven(list, n) {
  if (list.length <= n) return list.slice();
  const out = [];
  for (let i = 0; i < n; i++) out.push(list[Math.round((i * (list.length - 1)) / Math.max(1, n - 1))]);
  return [...new Set(out)];
}

// Items revealed over d ms grouped into time slices (≤ 14): each slice a <g> hidden until the
// scan line reaches it, then shown in one step (stage() in mount). Not CSS animations: WebKit
// can't composite an SVG child's animation, so each frame of one repainted the whole page — every
// symbol and the preview under it (WebKitGTK at a phone's size: ~40 fps, 75–120 ms p95 frames while
// a page was read); a slice that appears repaints once.
function sliced(items, delayOf, d, render) {
  if (!d) return items.map((x) => render(x)).join('');
  const nb = clamp(Math.round(d / 60), 2, 14);
  const parts = Array.from({ length: nb }, () => '');
  for (const x of items) parts[Math.min(nb - 1, Math.max(0, Math.floor((delayOf(x) / d) * nb)))] += render(x);
  return parts.map((h, i) => (!h ? '' : i ? `<g class="bk" visibility="hidden" data-d="${Math.round((i * d) / nb)}">${h}</g>` : `<g class="bk">${h}</g>`)).join('');
}

// Code-line highlighting: an XML-ish line → spans (tags, attribute names, values, text, comments).
export function highlight(line) {
  let out = '';
  for (const tok of String(line).match(/<!--[\s\S]*?(?:-->|$)|<[^>]*>?|[^<]+/g) || []) {
    if (tok.startsWith('<!--')) { out += `<span class="c">${esc(tok)}</span>`; continue; }
    if (tok[0] !== '<') { out += `<span class="x">${esc(tok)}</span>`; continue; }
    const m = /^(<[/?]?)([\w:.-]*)([\s\S]*?)([/?]?>)?$/.exec(tok);
    out += `<span class="p">${esc(m[1])}</span><span class="t">${esc(m[2])}</span>`;
    const re = /(\s+)|([\w:.-]+)(=)("[^"]*"|'[^']*')|(\S+)/g;
    let a;
    while ((a = re.exec(m[3]))) {
      if (a[1]) out += a[1];
      else if (a[2]) out += `<span class="a">${esc(a[2])}</span><span class="p">=</span><span class="v">${esc(a[4])}</span>`;
      else out += esc(a[5]);
    }
    if (m[4]) out += `<span class="p">${esc(m[4])}</span>`;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
const STYLE = `
.rd{--rd-text:#e8e8f0;--rd-dim:rgba(232,232,240,.62);--rd-card:rgba(255,255,255,.04);--rd-line:rgba(255,255,255,.1);
--rd-accent:#a64fff;--rd-accent-hi:#c69bff;--rd-blue:#4f7cff;--rd-pink:#ff4f9f;--rd-yellow:#ffe6a0;--rd-green:#4ade80;
--rd-amber:#ffd58a;--rd-cyan:#5fd4ff;--rd-teal:#46e0c0;--rd-plate:#1b1b48;--rd-paper:#fdfcf8;--rd-note:#5e2fb8;
--rd-radius:1rem;--rd-mono:ui-monospace,"Cascadia Code","SF Mono",Menlo,monospace;
--rd-page-max-h:max(300px,calc(100svh - 330px));--rd-page-max-h-side:max(340px,calc(100svh - 250px));--rd-code-lines:4;--rd-thumb-h:46px;--rd-pill-inset:14px;--rd-z:40;
container-type:inline-size;color:var(--rd-text);font:14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-tap-highlight-color:transparent}
.rd *{box-sizing:border-box}
.rd [hidden]{display:none!important}
.rd-card{position:relative;display:flex;flex-direction:column;gap:10px;padding:8px 12px 12px;background:var(--rd-card);border:1px solid var(--rd-line);border-radius:var(--rd-radius);overflow:hidden}
.rd-top{display:flex;align-items:center;gap:10px;min-height:44px}
.rd-head{flex:1;min-width:0}
.rd-title{font-weight:650;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.01em}
.rd-facts{display:flex;align-items:baseline;gap:.5em;margin-top:2px;font:12px/1.3 var(--rd-mono);color:var(--rd-dim);white-space:nowrap;overflow:hidden;font-variant-numeric:tabular-nums}
.rd-facts>span{flex:none}
.rd-facts>span:not([hidden])~span:not([hidden])::before{content:"·";opacity:.45;margin-right:.5em}
.rd-facts .rd-step{color:var(--rd-text)}
.rd-facts.tight .rd-step{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
.rd-facts .rd-g{display:inline-block;min-width:1.1em;text-align:center;color:var(--rd-accent-hi)}
.rd-facts .rd-ms{letter-spacing:.12em}
.rd-facts .rd-ms b{font-weight:400;color:var(--rd-accent-hi)}
.rd-facts .rd-q{color:var(--rd-amber)}
.rd-min{flex:none;width:44px;height:44px;display:grid;place-items:center;border-radius:22px;border:1px solid var(--rd-line);background:transparent;color:var(--rd-text);cursor:pointer;padding:0}
.rd-min svg{width:18px;height:18px}
.rd-stop{flex:none;min-width:44px;height:44px;padding:0 14px;border-radius:22px;border:1px solid var(--rd-line);background:transparent;color:var(--rd-dim);font:600 15px/1 system-ui,-apple-system,sans-serif;cursor:pointer;transition:background .2s,color .2s,border-color .2s}
.rd-stop[data-arm]{color:#ffd0d6;border-color:rgba(255,111,111,.55);background:rgba(255,111,111,.14)}
.rd[data-phase=done] .rd-stop{display:none}
.rd-bar{height:3px;margin-top:-4px;border-radius:2px;background:rgba(255,255,255,.07);overflow:hidden}
.rd-bar>i{display:block;height:100%;transform-origin:left;transform:scaleX(0);background:linear-gradient(90deg,var(--rd-blue),var(--rd-accent) 70%,var(--rd-pink));transition:transform .6s ease}
.rd-body{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}
.rd-stage{display:flex;justify-content:center;min-width:0}
.rd-page{position:relative;flex:none;aspect-ratio:var(--rd-ar,.7727);width:min(100%,calc(var(--rd-page-max-h) * var(--rd-ar,.7727)));border-radius:6px;overflow:hidden;background:var(--rd-plate);
box-shadow:0 14px 40px -14px rgba(0,0,0,.8),0 0 0 1px rgba(255,255,255,.08);isolation:isolate;transform-style:flat;pointer-events:none;contain:layout paint}
.rd-page>img{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;user-select:none;-webkit-user-select:none;transition:opacity .6s ease}
.rd-page .rd-paper{opacity:1}
.rd-page .rd-eng{opacity:0;filter:invert(1)}
.rd-page[data-look=engine] .rd-paper{opacity:0}
.rd-page[data-look=engine] .rd-eng{opacity:.6}
.rd-page .rd-tint{position:absolute;inset:0;background:var(--rd-paper);mix-blend-mode:multiply;opacity:0;transition:opacity .6s;pointer-events:none}
.rd-page[data-look=done] .rd-tint{opacity:1}
.rd-page[data-noimg] .rd-paper,.rd-page[data-noimg] .rd-eng{display:none}
.rd-page[data-noimg][data-look=paper],.rd-page[data-noimg][data-look=done]{background:#f4f4f8}
.rd-svg{position:absolute;inset:0;width:100%;height:100%;overflow:hidden;pointer-events:none}
.rd-svg .stf{fill:none;stroke:var(--rd-accent);stroke-width:1;vector-effect:non-scaling-stroke;opacity:.85}
.rd-page[data-look=engine] .rd-svg .stf{stroke:var(--rd-accent-hi);opacity:.55}
.rd-svg .stfb{fill:rgba(166,79,255,.16);stroke:rgba(166,79,255,.55);stroke-width:1;vector-effect:non-scaling-stroke}
.rd-page[data-look=engine] .rd-svg .stfb{fill:rgba(198,155,255,.08);stroke:rgba(198,155,255,.3)}
.rd-svg .sysb{fill:var(--rd-accent)}
.rd-svg .k-head{fill:var(--rd-accent-hi);opacity:.95}
.rd-svg .k-stem,.rd-svg .k-ledger{stroke:var(--rd-blue);stroke-width:1.4;vector-effect:non-scaling-stroke;stroke-linecap:round;opacity:.85}
.rd-svg .k-ledger{stroke:#8fb3ff}
.rd-svg .k-beam{fill:var(--rd-blue);opacity:.9}
.rd-svg .k-bar{stroke:var(--rd-cyan);stroke-width:1.3;vector-effect:non-scaling-stroke;opacity:.75}
.rd-svg .k-meas{stroke:var(--rd-cyan);stroke-width:2;vector-effect:non-scaling-stroke;stroke-linecap:round}
.rd-svg .k-slur,.rd-svg .k-tie{fill:none;stroke:var(--rd-pink);stroke-width:1.6;vector-effect:non-scaling-stroke;stroke-linecap:round}
.rd-svg .k-tie{stroke-dasharray:none}
.rd-svg .k-acc,.rd-svg .k-flag,.rd-svg .k-dot{fill:var(--rd-pink);opacity:.9}
.rd-svg .k-acc{fill:none;stroke:var(--rd-pink);stroke-width:1.2;vector-effect:non-scaling-stroke}
.rd-svg .k-rest{fill:rgba(70,224,192,.22);stroke:rgba(70,224,192,.8);stroke-width:1;vector-effect:non-scaling-stroke}
.rd-svg .k-clef,.rd-svg .k-key,.rd-svg .k-time{fill:rgba(255,213,138,.16);stroke:rgba(255,213,138,.75);stroke-width:1;vector-effect:non-scaling-stroke}
.rd-svg .k-lyric{fill:var(--rd-yellow);opacity:.36}
.rd-svg .k-word{fill:#9fb0ff;opacity:.22}
.rd-svg .k-other{fill:none;stroke:rgba(232,232,240,.55);stroke-width:1;stroke-dasharray:3 2;vector-effect:non-scaling-stroke}
.rd-svg .ocr{fill:rgba(255,230,160,.12);stroke:var(--rd-yellow);stroke-width:1;stroke-dasharray:4 3;vector-effect:non-scaling-stroke}
.rd-svg .nt{fill:#c69bff}
.rd-svg .nt.syl{fill:#ff8fd0}
.rd-page[data-notes] .rd-svg .l-sym{opacity:.3}
.rd-page[data-look=done] .rd-svg .nt{fill:var(--rd-note);stroke:none}
.rd-svg .ocrs.settled{opacity:.28}
.rd-svg .gone{opacity:.3}
.rd-svg .k-head.void{fill:rgba(198,155,255,.18);stroke:var(--rd-accent-hi);stroke-width:1.4;vector-effect:non-scaling-stroke}
.rd-veil{position:absolute;left:0;right:0;height:100%;background:rgba(3,3,12,.6);pointer-events:none;opacity:0;transition:transform .5s cubic-bezier(.3,.7,.2,1),opacity .4s;will-change:transform}
.rd-vt{top:-100%}
.rd-vb{top:0}
.rd-veil::after{content:"";position:absolute;left:0;right:0;height:1px;background:var(--rd-accent-hi);box-shadow:0 0 12px 2px rgba(166,79,255,.75);opacity:.8}
.rd-vt::after{bottom:-1px}
.rd-vb::after{top:-1px}
.rd-page[data-look=engine][data-lens=sys] .rd-veil{opacity:1}
.rd-glow{position:absolute;inset:0;border-radius:6px;box-shadow:inset 0 0 0 1px rgba(198,155,255,.7),inset 0 0 28px rgba(166,79,255,.35);opacity:0;transition:opacity .5s;pointer-events:none}
.rd-page[data-lens=page] .rd-glow{opacity:.75}
.rd-page[data-look=engine][data-lens=page] .rd-glow{opacity:.6}
.rd-page[data-look=paper][data-lens=page] .rd-glow{opacity:.45}
.rd[data-wait] .rd-page[data-lens=page] .rd-glow,.rd[data-wait] .rd-page[data-lens=sys] .rd-veil::after{animation:rd-breathe 2.4s ease-in-out infinite}
@keyframes rd-breathe{0%,100%{opacity:.85}50%{opacity:.3}}
.rd-sweep{position:absolute;overflow:hidden;pointer-events:none;opacity:0;transition:opacity .25s}
.rd-sweep.on{opacity:1}
.rd-sweep>i{position:absolute;inset:0;will-change:transform}
.rd-sweep>i::after{content:"";position:absolute;left:-1px;top:0;bottom:0;width:2px;background:linear-gradient(var(--rd-cyan),#fff 50%,var(--rd-accent-hi));box-shadow:0 0 14px 3px rgba(166,79,255,.75)}
.rd-sweep>i::before{content:"";position:absolute;right:100%;top:0;bottom:0;width:34%;background:linear-gradient(90deg,rgba(166,79,255,0),rgba(166,79,255,.10) 60%,rgba(95,212,255,.26))}
.rd-sweep.v>i::after{left:0;right:0;top:-1px;bottom:auto;width:auto;height:2px;background:linear-gradient(90deg,var(--rd-cyan),#fff 50%,var(--rd-accent-hi))}
.rd-sweep.v>i::before{right:0;left:0;bottom:100%;top:auto;width:auto;height:24%;background:linear-gradient(180deg,rgba(166,79,255,0),rgba(95,212,255,.24))}
.rd-mark{position:absolute;right:8px;top:8px;width:30px;height:30px;border-radius:15px;display:grid;place-items:center;font:700 16px/1 system-ui;color:#0b2e17;background:var(--rd-green);opacity:0;transform:scale(.4);pointer-events:none}
.rd-mark.fail{background:var(--rd-amber);color:#3a2600}
.rd-mark.on{animation:rd-mark 1.1s ease both}
@keyframes rd-mark{0%{opacity:0;transform:scale(.4)}25%{opacity:1;transform:scale(1.1)}40%{transform:none}80%{opacity:1}100%{opacity:0;transform:none}}
.rd-empty{position:absolute;inset:0;display:grid;place-items:center;color:var(--rd-dim);font:28px/1 system-ui}
.rd-code{position:relative;min-width:0;pointer-events:none;display:flex;flex-direction:column;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.07);border-radius:10px;overflow:hidden;font:10.5px/1.55 var(--rd-mono)}
.rd-code-h{display:flex;align-items:center;gap:6px;padding:4px 10px;border-bottom:1px solid rgba(255,255,255,.06);color:var(--rd-dim);font-size:10.5px;white-space:nowrap}
.rd-code-h i{width:6px;height:6px;border-radius:3px;background:var(--rd-accent);opacity:.8}
.rd-lines{display:flex;flex-direction:column;justify-content:flex-end;padding:3px 10px 6px;overflow:hidden;height:calc(var(--rd-code-lines) * 1.55em + 9px)}
.rd-ln{white-space:pre;overflow:hidden;text-overflow:ellipsis;flex:none}
.rd-ln .t{color:#c9a2ff}.rd-ln .a{color:#8fb3ff}.rd-ln .v{color:var(--rd-yellow)}.rd-ln .x{color:#f2f2f8}.rd-ln .p{color:rgba(232,232,240,.42)}
.rd-ln .c{color:rgba(232,232,240,.5);font-style:italic}
.rd-ln.fix .c{color:var(--rd-green);font-style:normal}
.rd-ln.err .c{color:var(--rd-amber);font-style:normal}
.rd-rail{display:flex;gap:6px;overflow-x:auto;overflow-y:hidden;padding:3px 2px 2px;scrollbar-width:none}
.rd-rail::-webkit-scrollbar{display:none}
.rd-th{position:relative;flex:none;height:var(--rd-thumb-h);aspect-ratio:var(--ar,.7727);border-radius:3px;background:#fff;opacity:.45;outline:1px solid rgba(255,255,255,.14);transition:opacity .4s,outline-color .4s}
.rd-th canvas{display:block;width:100%;height:100%;border-radius:3px}
.rd-th.new{animation:rd-land .42s cubic-bezier(.2,.85,.3,1.2) both}
@keyframes rd-land{from{opacity:0;transform:translateY(10px) scale(.7)}}
.rd-th[data-state=skip]{opacity:.28;outline-style:dashed}
.rd-th[data-state=read]{opacity:1;outline:2px solid var(--rd-accent)}
.rd-th[data-state=done]{opacity:.92}
.rd-th[data-state=failed]{opacity:.9;outline:2px solid var(--rd-amber)}
.rd-th b{position:absolute;right:-3px;bottom:-3px;width:16px;height:16px;border-radius:8px;display:none;place-items:center;font:800 10px/1 system-ui;color:#0b2e17;background:var(--rd-green);box-shadow:0 0 0 2px #14142c}
.rd-th[data-state=done] b{display:grid}
.rd-th[data-state=failed] b{display:grid;background:var(--rd-amber);color:#3a2600}
.rd-th .rd-tp{position:absolute;left:0;right:0;bottom:0;height:3px;background:var(--rd-accent);transform-origin:left;transform:scaleX(var(--f,0));transition:transform .6s ease;display:none}
.rd-th[data-state=read] .rd-tp{display:block}
.rd-th.cur{outline-offset:2px}
.rd-done{display:none;flex-direction:column;gap:10px}
.rd[data-phase=done] .rd-done{display:flex}
.rd-done-t{display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px;line-height:1.25}
.rd-done-t i{flex:none;width:30px;height:30px;border-radius:15px;display:grid;place-items:center;font:800 16px/1 system-ui;font-style:normal;color:#0b2e17;background:var(--rd-green)}
.rd-done-t span{min-width:0;overflow:hidden;text-overflow:ellipsis}
.rd-done-b{display:flex;gap:8px}
.rd-btn{flex:1;text-align:center;padding:.85rem 1rem;border-radius:999px;color:#fff;font-weight:650;font-size:1rem;text-decoration:none;background:linear-gradient(135deg,var(--rd-blue),var(--rd-accent));box-shadow:0 8px 24px -8px rgba(79,124,255,.5)}
.rd[data-phase=done] .rd-code{display:none}
.rd[data-phase=error] .rd-page{box-shadow:0 0 0 2px var(--rd-amber),0 14px 40px -14px rgba(0,0,0,.8)}
.rd-sr{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;padding:0}
.rd-pill{position:fixed;right:calc(env(safe-area-inset-right) + var(--rd-pill-inset));bottom:calc(env(safe-area-inset-bottom) + var(--rd-pill-inset));z-index:var(--rd-z);
display:flex;align-items:center;gap:8px;height:48px;padding:0 15px 0 5px;border-radius:24px;border:1px solid rgba(255,255,255,.16);background:rgba(22,22,50,.95);color:var(--rd-text);
font:600 14px/1 var(--rd-mono);font-variant-numeric:tabular-nums;box-shadow:0 12px 32px -8px rgba(0,0,0,.65);cursor:pointer;max-width:calc(100vw - 2 * var(--rd-pill-inset))}
.rd-pill.pop{animation:rd-land .32s cubic-bezier(.2,.85,.3,1.2) both}
.rd-ring{position:relative;flex:none;width:38px;height:38px}
.rd-ring svg{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg)}
.rd-ring circle{fill:none;stroke-width:3.5}
.rd-ring .tr{stroke:rgba(255,255,255,.12)}
.rd-ring .arc{stroke:url(#rd-ring-g);stroke-linecap:round;transition:stroke-dashoffset .6s ease}
.rd-ring .spin{transform-origin:50% 50%;animation:rd-spin 1.6s linear infinite}
@keyframes rd-spin{to{transform:rotate(360deg)}}
.rd-ring b{position:absolute;inset:0;display:grid;place-items:center;font:600 15px/1 system-ui;color:var(--rd-accent-hi)}
.rd-pill[data-phase=done] .rd-ring b{color:var(--rd-green)}
.rd-pill[data-phase=error] .rd-ring b{color:var(--rd-amber)}
.rd-pill span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rd-probe{height:0;overflow:hidden;visibility:hidden;pointer-events:none}
.rd-probe>i{display:block;width:var(--rd-page-max-h);height:var(--rd-page-max-h-side)}
.rd[data-side] .rd-body{grid-template-columns:auto minmax(250px,1fr);grid-template-rows:minmax(0,1fr) auto;row-gap:0}
.rd[data-side] .rd-stage{justify-content:flex-start}
.rd[data-side] .rd-page{width:min(calc(var(--rd-page-max-h-side) * var(--rd-ar,.7727)),calc(100cqw - 290px))}
.rd[data-side] .rd-code{contain:size;align-self:stretch}
.rd[data-side] .rd-lines{flex:1;height:auto}
.rd[data-side][data-phase=done] .rd-code{display:flex}
.rd[data-side] .rd-stage{grid-row:1 / span 2}
.rd[data-side] .rd-done{grid-column:2;grid-row:2;align-self:end;margin-top:10px}
.rd[data-side] .rd-done-b{max-width:520px}
@media (prefers-reduced-motion:reduce){
.rd *,.rd *::before,.rd *::after{animation:none!important;transition-duration:.01ms!important}
.rd-page>img,.rd-page .rd-tint{transition-duration:.15s!important}
.rd-svg .ocrs{opacity:.28}
}`;

function injectCss() {
  if (document.getElementById('rd-style')) return;
  const s = document.createElement('style');
  s.id = 'rd-style';
  s.textContent = STYLE;
  document.head.append(s);
}

const MIN_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 8l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ---------------------------------------------------------------------------------------------
export function mount(host, opts = {}) {
  injectCss();
  const links = { sing: 'sing.html', play: 'play.html', ...(opts.links || {}) };
  const root = document.createElement('div');
  root.className = 'rd';
  root.dataset.phase = 'idle';
  root.innerHTML = `
<section class="rd-card" aria-label="Reading the PDF">
  <div class="rd-top">
    <div class="rd-head"><div class="rd-title"></div><div class="rd-facts"></div></div>
    <button class="rd-stop" type="button" hidden aria-label="Stop">✕</button>
    <button class="rd-min" type="button" aria-label="Minimize" aria-expanded="true">${MIN_ICON}</button>
  </div>
  <div class="rd-bar" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
  <div class="rd-body">
    <div class="rd-stage">
      <div class="rd-page" data-look="paper" data-lens="none" data-noimg aria-hidden="true">
        <img class="rd-paper" alt="" decoding="async"><img class="rd-eng" alt="" decoding="async"><div class="rd-tint"></div>
        <svg class="rd-svg" xmlns="${SVGNS}" viewBox="0 0 2550 3300" preserveAspectRatio="none">
          <g class="l-staff"></g><g class="l-ocr"></g><g class="l-sym"></g><g class="l-meas"></g><g class="l-notes"></g>
        </svg>
        <div class="rd-veil rd-vt"></div><div class="rd-veil rd-vb"></div><div class="rd-glow"></div>
        <div class="rd-sweep"><i></i></div>
        <div class="rd-mark">✓</div>
        <div class="rd-empty">▤</div>
      </div>
    </div>
    <div class="rd-code" aria-hidden="true"><div class="rd-code-h"><i></i><span class="rd-file">score.musicxml</span></div><div class="rd-lines"></div></div>
    <div class="rd-done">
      <div class="rd-done-t"><i>✓</i><span></span></div>
      <div class="rd-done-b"><a class="rd-btn rd-sing" href="${esc(links.sing)}">Sing it</a><a class="rd-btn rd-play" href="${esc(links.play)}">Play it</a></div>
    </div>
  </div>
  <div class="rd-rail" aria-hidden="true"></div>
  <div class="rd-sr" role="status" aria-live="polite"></div>
</section>
<div class="rd-probe" aria-hidden="true"><i></i></div>
<button class="rd-pill" type="button" hidden aria-label="Expand">
  <span class="rd-ring"><svg viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="rd-ring-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f7cff"/><stop offset=".7" stop-color="#a64fff"/><stop offset="1" stop-color="#ff4f9f"/></linearGradient></defs>
  <circle class="tr" cx="20" cy="20" r="16.5"/><circle class="arc" cx="20" cy="20" r="16.5" stroke-dasharray="103.67" stroke-dashoffset="103.67"/></svg><b>·</b></span>
  <span class="rd-pill-t">…</span>
</button>`;
  host.append(root);

  const $ = (sel) => root.querySelector(sel);
  const card = $('.rd-card'), titleEl = $('.rd-title'), factsEl = $('.rd-facts'), minBtn = $('.rd-min');
  // Stop (opts.onStop): a second tap within 3 s confirms — a stray tap never throws an import away.
  const stopBtn = $('.rd-stop');
  let stopArm = null;
  if (opts.onStop) {
    stopBtn.hidden = false;
    stopBtn.addEventListener('click', () => {
      if (stopArm) { clearTimeout(stopArm); stopArm = null; disarm(); opts.onStop(); return; }
      stopBtn.dataset.arm = ''; stopBtn.textContent = 'Stop?'; stopBtn.setAttribute('aria-label', 'Tap again to stop');
      stopArm = setTimeout(() => { stopArm = null; disarm(); }, 3000);
    });
  }
  function disarm() { delete stopBtn.dataset.arm; stopBtn.textContent = '✕'; stopBtn.setAttribute('aria-label', 'Stop'); }
  // The host can take the ✕ away for a while (e.g. while another tab runs the import).
  function canStop(on) { stopBtn.hidden = !opts.onStop || !on; if (!on && stopArm) { clearTimeout(stopArm); stopArm = null; disarm(); } }
  const barEl = $('.rd-bar'), barFill = $('.rd-bar > i');
  const pageEl = $('.rd-page'), paperImg = $('.rd-paper'), engImg = $('.rd-eng'), svg = $('.rd-svg');
  const L = { staff: $('.l-staff'), ocr: $('.l-ocr'), sym: $('.l-sym'), meas: $('.l-meas'), notes: $('.l-notes') };
  const vt = $('.rd-vt'), vb = $('.rd-vb'), sweepEl = $('.rd-sweep'), sweepI = $('.rd-sweep > i'), markEl = $('.rd-mark');
  const emptyEl = $('.rd-empty'), fileEl = $('.rd-file'), linesEl = $('.rd-lines'), railEl = $('.rd-rail'), liveEl = $('.rd-sr');
  const doneTitle = $('.rd-done-t span'), pill = $('.rd-pill'), pillArc = $('.rd-ring .arc'), pillGlyph = $('.rd-ring b'), pillText = $('.rd-pill-t');
  const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const motion = () => !mq?.matches;

  let st = R.initial();          // every event received
  let vs = R.initial();          // what is drawn
  let queue = [];                // events received, not drawn yet
  let mode = 'open';
  let held = false;              // the host holds the run (hold): clocks stopped, nothing breathing
  let stale = false;             // st moved on while nothing was drawn
  let timer = null, beatEnd = 0, ticker = null, lineTimer = null;
  let pendingLines = [];         // [{ due, line, cls }]
  let gapEma = 700, lastBeat = 0;
  let sweepAnim = null, lastGroup = null, lastPhase = 'idle', lastMeasure = null;
  let announced = '';
  const H = { page: null, s: null, w: 2550, h: 3300, il: 18, look: 'paper', lens: 'none' };
  const urls = new Map();        // page → object URL of its preview
  const thumbs = new Map();      // page → thumb element
  const T = { beats: 0, ff: 0, statics: 0, lines: 0, maxBacklog: 0, slow: [0, ''], staticMs: 0 };

  // --- scheduling -------------------------------------------------------------------------
  const drawing = () => mode === 'open' && !document.hidden;
  // Events that take a beat on screen; the rest (phases, steps, an empty system, measures…)
  // are drawn the moment they come up, without a wait.
  const heavy = (ev) => (ev.t === 'sym' && ((ev.add?.length || 0) + (ev.del?.length || 0)) > 0) || ev.t === 'notes'
    || ev.t === 'words' || ev.t === 'grid' || ev.t === 'xml' || ev.t === 'done' || ev.t === 'page' || ev.t === 'export'
    || (ev.t === 'sheet' && ev.state === 'start') || (ev.t === 'step' && ev.step === 'BINARY');
  let heavyQ = 0;            // heavy events waiting

  function push(ev) {
    if (!ev || typeof ev !== 'object' || !ev.t) return;
    if (!Number.isFinite(ev.at)) ev = { ...ev, at: Date.now() };
    if (held) hold(false); // (news: it's going again)
    const prevPhase = st.phase;
    st = R.reduce(st, ev);
    if (ev.t === 'sym' || ev.t === 'notes') {
      const now = performance.now();
      if (lastBeat) { const g = now - lastBeat; if (g < 30000) gapEma = gapEma * 0.7 + g * 0.3; }
      lastBeat = now;
    }
    announce(ev, prevPhase);
    updateChrome();
    if (!drawing()) { stale = true; return; }
    queue.push(ev);
    if (heavy(ev)) heavyQ++;
    T.maxBacklog = Math.max(T.maxBacklog, heavyQ);
    if (!timer) beat();
    else if (heavyQ >= 3 && beatEnd - performance.now() > 160) {
      // Falling behind: this beat ends sooner (its last symbols appear at once).
      clearTimeout(timer);
      timer = setTimeout(beat, 120);
      beatEnd = performance.now() + 120;
    }
  }

  function load(events) {
    stopDrawing();
    st = R.pause(R.reduceAll(events || [])); // (clocks stopped until the run goes on: R.pause)
    queue = []; heavyQ = 0;
    vs = st;
    stale = false;
    clearLines();
    updateChrome();
    if (drawing()) renderStatic(); else stale = true;
  }

  function take() {
    const ev = queue.shift();
    if (heavy(ev)) heavyQ--;
    const prev = vs;
    vs = R.reduce(vs, ev);
    return [ev, prev];
  }

  // One heavy event drawn per beat (the cheap ones before it at once); the next waits for it.
  function beat() {
    timer = null;
    if (!drawing()) return;
    if (heavyQ > FF_BACKLOG) { catchUp(); return; }
    root.removeAttribute('data-wait');
    let ms = 0;
    while (queue.length && !ms) {
      const [ev, prev] = take();
      T.beats++;
      const t0 = performance.now();
      try { ms = draw(ev, prev) || 0; } catch (e) { console.warn('[reader]', e); }
      const dt = performance.now() - t0;
      if (dt > T.slow[0]) T.slow = [Math.round(dt), ev.t + (ev.step ? ':' + ev.step : '')];
    }
    updateFacts();
    if (!ms && !queue.length) { idle(); return; }
    beatEnd = performance.now() + ms;
    timer = setTimeout(beat, ms);
  }

  // The latest state drawn at once (too far behind, back from minimized/hidden, a resume).
  function catchUp() {
    clearTimeout(timer); timer = null;
    queue.length = 0; heavyQ = 0;
    vs = st;
    stale = false;
    T.ff++;
    renderStatic();
    idle();
  }

  // Nothing queued: the lens goes where the engine is now and breathes.
  function idle() {
    timer = null;
    setLens(vs);
    if (!held && ['pages', 'engine', 'read', 'export', 'clean', 'save'].includes(vs.phase)) root.dataset.wait = '';
    updateFacts();
  }

  function stopDrawing() {
    clearTimeout(timer); timer = null;
    clearInterval(lineTimer); lineTimer = null;
    flushLines();
    finishSweep();
    settle();
  }

  // How long a reveal takes: most of the gap expected before the next event (never ahead of
  // the data: it only spreads what already arrived), shorter while others wait. A page's notes
  // come in one burst at its end: each system still gets ~0.7 s unless far behind.
  function revealMs(floor = 160) {
    if (!motion()) return 0;
    const d = clamp(Math.max(floor, gapEma * 0.85), 160, 1700) / (1 + 0.5 * Math.max(0, heavyQ - 2));
    return d < 70 ? 0 : d;
  }
  const short = (ms) => (!motion() ? 0 : ms / (1 + 0.6 * heavyQ));
  // Lines a second the code column can show readably: ~2 a second per visible line, ≤ LINE_RATE.
  let visLines = 4;
  const lineRate = () => clamp(visLines * 2, 6, LINE_RATE);

  // --- drawing one event ------------------------------------------------------------------
  function draw(ev, prev) {
    settle();
    flushLines();
    finishSweep();
    switch (ev.t) {
      case 'job': return 0;
      case 'phase': {
        root.dataset.phase = vs.phase;
        if (vs.phase === 'export') setFile('score.musicxml');
        if (vs.phase === 'error') return 0;
        return 0;
      }
      case 'page': {
        railUpdate(true);
        if (vs.phase === 'pages' || vs.phase === 'idle') {
          showPage(ev.page, 'paper', true);
          drawPrepStaves(vs.pages[ev.page], motion());
          return short(380);
        }
        return 0;
      }
      case 'meta': {
        updateTitle();
        setFile('score.musicxml');
        lines(R.metaLines({ title: ev.title, tempo: ev.tempo }), 0, 'meta');
        return 0;
      }
      case 'engine': {
        const first = R.firstMusicPage(vs);
        if (first && H.page !== first && !vs.cur.s) { showPage(first, 'paper', true); drawPrepStaves(vs.pages[first], false); }
        return 0;
      }
      case 'sheet': {
        railUpdate();
        const page = R.pageOfSheet(vs, ev.s);
        if (ev.state === 'start') {
          if (page) { showPage(page, 'paper', true); drawPrepStaves(vs.pages[page], false, true); }
          setFile(`sheet#${ev.s}.xml`);
          if (page) lines([`<!-- page ${page} -->`], 0, '');
          lastMeasure = null;
          return short(450);
        }
        if (page === H.page) flash(ev.state === 'failed');
        if (ev.state === 'failed') lines([`<!-- sheet#${ev.s}: ${ev.reason || 'failed'} -->`], 0, 'err');
        // The page read, a moment to see it whole before the next one turns in.
        return short(ev.state === 'done' ? 900 : 400);
      }
      case 'step': {
        const page = R.pageOfSheet(vs, ev.s);
        if (page && page !== H.page) showPage(page, 'paper', true);
        if (ev.step === 'BINARY' || (ev.step !== 'LOAD' && H.look === 'paper' && vs.phase === 'read')) {
          setLook('engine');
          setLens(vs);
          return ev.step === 'BINARY' ? short(600) : 0;
        }
        setLens(vs);
        return 0;
      }
      case 'grid': {
        if (R.pageOfSheet(vs, ev.s) !== H.page) return 0;
        setLook('engine');
        drawGrid(ev.systems, motion());
        setFile(`sheet#${ev.s}.xml`);
        const out = [];
        for (const y of ev.systems || []) {
          out.push(`<system id="${y.id}">`);
          for (const f of y.staves || []) out.push(`<staff id="${f.id}" part="${f.part ?? ''}"/>`);
        }
        const d = short(750);
        lines(out.slice(0, 14), d, '');
        setLensBox(null, 'page');
        return d;
      }
      case 'sym': return drawSym(ev, prev);
      case 'measures': {
        if (R.pageOfSheet(vs, ev.s) !== H.page) return 0;
        drawMeasures(ev.s, ev.sys, ev.xs, null);
        return 0;
      }
      case 'words': {
        if (R.pageOfSheet(vs, ev.s) !== H.page) return 0;
        const words = (ev.words || []).filter((w) => w && Number.isFinite(+w.x));
        const d = short(Math.min(1200, 25 * words.length));
        const per = words.length ? d / words.length : 0;
        const idx = new Map(words.map((w, i) => [w, i]));
        const html = sliced(words, (w) => idx.get(w) * per, d, (w) => rectSvg('ocr', +w.x - 3, +w.y - 3, num(w.w) + 6, num(w.h) + 6, 4, null));
        group(L.ocr, html, d ? 'ocrs' : 'ocrs settled');
        setFile(`sheet#${ev.s}.xml`);
        setLensBox(null, 'page');
        const picked = pickEven(words, Math.max(2, Math.round((d / 1000) * lineRate())));
        lines(picked.map(R.wordLine), d, '', picked.map((w) => (words.indexOf(w) * per)));
        return d;
      }
      case 'notes': {
        // During the export: a system's notes again, without the measures the export couldn't
        // write — the page redrawn as it now is (no reveal: nothing new was found).
        if (['export', 'clean', 'save'].includes(vs.phase)) {
          if (R.pageOfSheet(vs, ev.s) === H.page) drawStatic();
          return 0;
        }
        return drawNotes(ev);
      }
      case 'export': {
        // The export reads each sheet back from the book: its page, with the notes found on it.
        const page = R.pageOfSheet(vs, ev.s);
        if (!page) return 0;
        setFile('score.musicxml');
        if (page !== H.page) { showPage(page, 'engine', true); drawStatic(); }
        setLens(vs);
        railUpdate();
        return short(500);
      }
      case 'xml': {
        setFile('score.musicxml');
        const ls = String(ev.text).split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());
        const shown = ls.slice(0, 48);
        const d = short(Math.min(1600, shown.length * 32));
        lines(shown, d, 'xml');
        return d;
      }
      case 'fix': {
        lines([`<!-- ${ev.msg} -->`], 0, 'fix');
        return short(160);
      }
      case 'done': {
        root.dataset.phase = 'done';
        lines(['</score-partwise>'], 0, '');
        showDone(motion());
        return short(900);
      }
      case 'error': {
        root.dataset.phase = 'error';
        lines([`<!-- ${ev.message || 'stopped'} -->`], 0, 'err');
        return 0;
      }
      default: return 0;
    }
  }

  function drawSym(ev) {
    const page = R.pageOfSheet(vs, ev.s);
    if (page !== H.page) return 0;
    if (H.look !== 'engine') setLook('engine');
    // Removed (a step dropping candidates — REDUCTION throws out most of HEADS'): they fade
    // together in one group, then go.
    const gone = [];
    for (const id of ev.del || []) { const el = symEls.get(String(id)); if (el) { gone.push(el); symEls.delete(String(id)); } }
    if (gone.length) {
      // (Dimmed together, then gone: two repaints, no fade — see sliced().)
      const g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('class', 'gone');
      L.sym.append(g);
      for (const el of gone) g.append(el);
      if (motion()) setTimeout(() => g.remove(), 380); else g.remove();
    }
    const adds = (ev.add || []).filter((a) => a && Number.isFinite(+a.x) && Number.isFinite(+a.y));
    for (const a of adds) { const el = symEls.get(String(a.id)); if (el) { el.remove(); symEls.delete(String(a.id)); } } // a '+' for a known id replaces it
    const sh = vs.sheets[ev.s];
    const sys = sh?.systems?.find((y) => y.id === ev.sys);
    const box = sys?.box || null;
    setFile(`sheet#${ev.s}.xml`);
    if (box) setLensBox(box, 'sys'); else setLensBox(null, 'page');
    if (!adds.length) return 0;
    const d = revealMs();
    // Reveal in reading order: along the system by x, or down the page by y for a sheet-wide step.
    const vertical = !box;
    const [l, t, r, b] = box || [0, 0, H.w, H.h];
    const span = vertical ? Math.max(1, b - t) : Math.max(1, r - l);
    const delayOf = (a) => (d ? clamp(((vertical ? num(a.y) + num(a.h) / 2 - t : num(a.x) + num(a.w) / 2 - l) / span) * d - 30, 0, d) : null);
    indexSyms(group(L.sym, sliced(adds, delayOf, d, (a) => symSvg(a, null)), d ? null : 'settled'));
    if (d) sweep(box, vertical, d);
    const sorted = adds.slice().sort((p, q) => (vertical ? num(p.y) - num(q.y) : num(p.x) - num(q.x)));
    const picked = pickEven(sorted, Math.max(2, Math.round((d / 1000) * lineRate())));
    lines(picked.map(R.symLine), d, '', picked.map((a) => delayOf(a) ?? 0));
    return d;
  }

  function drawNotes(ev) {
    const page = R.pageOfSheet(vs, ev.s);
    if (page !== H.page) return 0;
    if (H.look !== 'engine') setLook('engine');
    const sh = vs.sheets[ev.s];
    const sys = sh?.systems?.find((y) => y.id === ev.sys);
    const box = sys?.box || null;
    const notes = (ev.notes || []).filter((n) => n && Number.isFinite(+n.x) && Number.isFinite(+n.y));
    setFile('score.musicxml');
    if (box) setLensBox(box, 'sys'); else setLensBox(null, 'page');
    pageEl.dataset.notes = '';
    if (!notes.length) return 0;
    const d = revealMs(700);
    const [l, , r] = box || [0, 0, H.w, H.h];
    const xs = notes.map((n) => +n.x);
    const lo = box ? l : Math.min(...xs), hi = box ? r : Math.max(...xs);
    const delayOf = (n) => (d ? clamp(((+n.x - lo) / Math.max(1, hi - lo)) * d - 30, 0, d) : null);
    group(L.notes, sliced(notes, delayOf, d, (n) => pillSvg(n, null)), d ? null : 'settled');
    if (d) sweep(box, false, d);
    // The MusicXML these notes become: syllables first when there's no room for every note.
    const cap = Math.max(3, Math.round((d / 1000) * lineRate() * 1.3));
    let pick = notes;
    if (notes.length > cap) {
      const syl = notes.filter((n) => n.syl);
      pick = syl.length >= cap ? pickEven(syl, cap) : [...syl, ...pickEven(notes.filter((n) => !n.syl), cap - syl.length)];
    }
    const pretty = visLines >= 14;
    if (pretty && pick.length > Math.ceil(cap / 4)) pick = pickEven(pick.slice().sort((a, b) => (b.syl ? 1 : 0) - (a.syl ? 1 : 0)).slice(0, Math.ceil(cap / 4)), Math.ceil(cap / 4));
    const ls = R.noteLines(pick, lastMeasure, { pretty, offset: R.measureOffset(vs, ev.s) });
    for (const x of ls) if (x.m != null) lastMeasure = x.m;
    // A <measure> line comes with the note after it.
    const dl = ls.map((x) => (x.note ? delayOf(x.note) ?? 0 : null));
    for (let i = dl.length - 2; i >= 0; i--) if (dl[i] == null) dl[i] = dl[i + 1];
    lines(ls.map((x) => x.xml), d, '', dl);
    return d;
  }

  // --- the page --------------------------------------------------------------------------
  function urlOf(p) {
    if (!p?.preview) return null;
    if (typeof p.preview === 'string') return p.preview;
    if (!urls.has(p.page)) { try { urls.set(p.page, URL.createObjectURL(p.preview)); } catch { return null; } }
    return urls.get(p.page);
  }

  function showPage(pageNo, look, turn) {
    const p = vs.pages[pageNo];
    if (!p) return;
    if (H.page !== pageNo) {
      H.page = pageNo; H.s = p.s;
      H.w = num(p.w, 2550) || 2550; H.h = num(p.h, 3300) || 3300;
      H.il = R.interlineOf(vs, p.s, pageNo) || Math.round(H.h / 180);
      pageEl.style.setProperty('--rd-ar', (H.w / H.h).toFixed(4));
      svg.setAttribute('viewBox', `0 0 ${H.w} ${H.h}`);
      const url = urlOf(p);
      for (const im of [paperImg, engImg]) { if (url) im.src = url; else im.removeAttribute('src'); }
      pageEl.toggleAttribute('data-noimg', !url);
      emptyEl.textContent = url ? '' : String(pageNo);
      emptyEl.hidden = !!url;
      clearSvg();
      markEl.classList.remove('on');
      pageEl.removeAttribute('data-notes');
      H.lens = 'none';
      pageEl.dataset.lens = 'none';
      if (turn && motion()) {
        // The new page slides in once its image is decoded (≤ 400 ms), not as an empty plate.
        const enter = () => {
          pageEl.style.opacity = '';
          pageEl.animate([{ opacity: 0, transform: 'translateX(4%) scale(.985)' }, { opacity: 1, transform: 'none' }],
            { duration: 340, easing: 'cubic-bezier(.2,.8,.3,1)' });
        };
        if (url && paperImg.decode) {
          pageEl.style.opacity = '0';
          let done = false;
          const go = () => { if (!done) { done = true; enter(); } };
          paperImg.decode().then(go, go);
          setTimeout(go, 400);
        } else enter();
      }
      railCurrent();
    }
    if (look) setLook(look);
  }

  function setLook(look) {
    if (H.look === look) return;
    H.look = look;
    pageEl.dataset.look = look;
  }

  // The lens: 'sys' (veils above and below a system's box), 'page' (the whole page, glowing
  // edge), 'none'. Veils only translate (transform), so the move is the compositor's.
  function setLensBox(box, kind) {
    H.lens = kind;
    pageEl.dataset.lens = kind;
    if (kind === 'sys' && box) {
      const [, t, , b] = box;
      vt.style.transform = `translateY(${r1((t / H.h) * 100)}%)`;
      vb.style.transform = `translateY(${r1((b / H.h) * 100)}%)`;
    } else {
      vt.style.transform = 'translateY(0%)';
      vb.style.transform = 'translateY(100%)';
    }
  }
  function setLens(state) {
    // The engine starting, the export, the clean-up and the save work on the whole page (the glow
    // breathes while nothing new comes).
    if (['engine', 'export', 'clean', 'save'].includes(state.phase)) { setLensBox(null, H.page ? 'page' : 'none'); return; }
    if (!H.s || state.phase !== 'read') { setLensBox(null, H.look === 'engine' && state.phase === 'read' ? 'page' : 'none'); return; }
    const l = R.lensOf(state, H.s);
    if (l.kind === 'sys') setLensBox(l.box, 'sys');
    else setLensBox(null, l.kind === 'page' ? 'page' : 'none');
  }

  // The scan line: across a system's box (left → right) or down the page (top → bottom).
  function sweep(box, vertical, d) {
    if (!motion() || !d) return;
    const [l, t, r, b] = box || [0, 0, H.w, H.h];
    const s = sweepEl.style;
    s.left = `${(l / H.w) * 100}%`; s.top = `${(t / H.h) * 100}%`;
    s.width = `${((r - l) / H.w) * 100}%`; s.height = `${((b - t) / H.h) * 100}%`;
    sweepEl.classList.toggle('v', vertical);
    sweepEl.classList.add('on');
    const to = vertical ? 'translateY(100%)' : 'translateX(100%)';
    sweepAnim = sweepI.animate([{ transform: 'translate(0,0)' }, { transform: to }], { duration: d, easing: 'linear', fill: 'forwards' });
    sweepAnim.onfinish = () => { sweepEl.classList.remove('on'); };
  }
  function finishSweep() {
    if (sweepAnim) { try { sweepAnim.finish(); } catch {} sweepAnim = null; }
    sweepEl.classList.remove('on');
  }

  function flash(failed) {
    if (!motion()) return;
    markEl.textContent = failed ? '!' : '✓';
    markEl.classList.toggle('fail', !!failed);
    markEl.classList.remove('on');
    void markEl.offsetWidth; // restart the animation (one small element)
    markEl.classList.add('on');
  }

  // --- SVG pieces (sheet pixels) -------------------------------------------------------------
  function clearSvg() {
    revealAll();
    for (const g of Object.values(L)) g.textContent = '';
    symEls.clear();
    lastGroup = null;
  }
  // The hidden slices of the reveals under way (sliced()), each shown when its time comes.
  let reveals = [];
  function stage(g) {
    for (const el of g.querySelectorAll('[data-d]')) {
      const t = setTimeout(() => { el.removeAttribute('visibility'); reveals = reveals.filter((r) => r.el !== el); }, +el.getAttribute('data-d'));
      reveals.push({ el, t });
    }
  }
  function revealAll() {
    for (const r of reveals) { clearTimeout(r.t); r.el.removeAttribute('visibility'); }
    reveals = [];
  }
  // id → element of the symbols drawn, for the engine's removals.
  const symEls = new Map();
  function indexSyms(g) { for (const el of g.querySelectorAll('[data-id]')) symEls.set(el.getAttribute('data-id'), el); }
  function group(layer, html, cls) {
    const g = document.createElementNS(SVGNS, 'g');
    if (cls) g.setAttribute('class', cls);
    g.innerHTML = html;
    layer.append(g);
    stage(g);
    if (!cls || !/settled/.test(cls)) lastGroup = g;
    return g;
  }
  // The last reveal is over (the next event draws): what it hadn't shown yet shows now, and the
  // OCR's words dim.
  function settle() {
    revealAll();
    if (lastGroup) { lastGroup.classList.add('settled'); lastGroup = null; }
  }
  // A slice shown at d ms (a hidden <g>, see stage()); d null/0: at once.
  const later = (html, d) => (d ? `<g visibility="hidden" data-d="${Math.round(d)}">${html}</g>` : html);

  const dly = () => '';
  const cl = (k) => k;
  function rectSvg(k, x, y, w, h, rx, d) {
    return `<rect class="${cl(k, d)}"${dly(d)} x="${r1(x)}" y="${r1(y)}" width="${r1(Math.max(1, w))}" height="${r1(Math.max(1, h))}" rx="${r1(rx)}"/>`;
  }
  function lineSvg(k, x1, y1, x2, y2, d, id) {
    return `<line class="${cl(k, d)}"${id}${dly(d)} x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}"/>`;
  }
  const nums = (v) => {
    if (Array.isArray(v)) return v.map(Number).filter(Number.isFinite);
    if (typeof v !== 'string') return null;
    const n = v.trim().split(/[\s,]+/).map(Number);
    return n.every(Number.isFinite) ? n : null;
  };
  function symSvg(a, d) {
    const x = num(a.x), y = num(a.y), w = Math.max(1, num(a.w, 1)), h = Math.max(1, num(a.h, 1));
    const id = ` data-id="${esc(a.id)}"`;
    const k = `k-${/^[a-z]+$/.test(a.k) ? a.k : 'other'}`;
    const il = H.il;
    switch (a.k) {
      case 'head': // hollow for a half/whole head (shape NOTEHEAD_VOID, WHOLE_NOTE…), else filled
        return `<ellipse class="${cl(/VOID|WHOLE|BREVE/.test(String(a.v ?? '')) ? k + ' void' : k, d)}"${id}${dly(d)} cx="${r1(x + w / 2)}" cy="${r1(y + h / 2)}" rx="${r1(w / 2 + 1)}" ry="${r1(h / 2 + 1)}"/>`;
      case 'stem': case 'bar':
        return lineSvg(k, x + w / 2, y, x + w / 2, y + h, d, id);
      case 'ledger':
        return lineSvg(k, x, y + h / 2, x + w, y + h / 2, d, id);
      case 'beam': {
        const n = nums(a.v);
        if (n && n.length >= 4) {
          const th = (n[4] || il * 0.5) / 2;
          return `<polygon class="${cl(k, d)}"${id}${dly(d)} points="${r1(n[0])},${r1(n[1] - th)} ${r1(n[2])},${r1(n[3] - th)} ${r1(n[2])},${r1(n[3] + th)} ${r1(n[0])},${r1(n[1] + th)}"/>`;
        }
        return `<rect class="${cl(k, d)}"${id}${dly(d)} x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}"/>`;
      }
      case 'slur': case 'tie': {
        const n = nums(a.v);
        let p;
        if (n && n.length >= 8) p = `M${r1(n[0])} ${r1(n[1])}C${r1(n[2])} ${r1(n[3])} ${r1(n[4])} ${r1(n[5])} ${r1(n[6])} ${r1(n[7])}`;
        else if (a.v === 'below') p = `M${r1(x)} ${r1(y)}C${r1(x + w * 0.25)} ${r1(y + h * 1.3)} ${r1(x + w * 0.75)} ${r1(y + h * 1.3)} ${r1(x + w)} ${r1(y)}`;
        else p = `M${r1(x)} ${r1(y + h)}C${r1(x + w * 0.25)} ${r1(y - h * 0.3)} ${r1(x + w * 0.75)} ${r1(y - h * 0.3)} ${r1(x + w)} ${r1(y + h)}`;
        return `<path class="${cl(k, d)}"${id}${dly(d)} d="${p}"/>`;
      }
      case 'dot':
        return `<circle class="${cl(k, d)}"${id}${dly(d)} cx="${r1(x + w / 2)}" cy="${r1(y + h / 2)}" r="${r1(Math.max(w, h) / 2 + 1.5)}"/>`;
      case 'lyric': case 'word':
        return `<rect class="${cl(k, d)}"${id}${dly(d)} x="${r1(x - 4)}" y="${r1(y - 3)}" width="${r1(w + 8)}" height="${r1(h + 6)}" rx="${r1(Math.min(8, h / 3))}"/>`;
      default:
        return `<rect class="${cl(k, d)}"${id}${dly(d)} x="${r1(x - 2)}" y="${r1(y - 2)}" width="${r1(w + 4)}" height="${r1(h + 4)}" rx="${r1(Math.min(6, il / 3))}"/>`;
    }
  }
  function pillSvg(n, d) {
    const il = H.il, ph = il * 1.08, pw = il * 1.5;
    return `<rect class="${cl(n.syl ? 'nt syl' : 'nt', d)}"${dly(d)} x="${r1(+n.x - pw / 2)}" y="${r1(+n.y - ph / 2)}" width="${r1(pw)}" height="${r1(ph)}" rx="${r1(ph / 2)}"/>`;
  }
  function staffPath(lines) {
    let p = '';
    for (const ln of lines) p += `M${r1(ln[0])} ${r1(ln[1])}L${r1(ln[2])} ${r1(ln[3])}`;
    return p;
  }
  // The staves pdfprep found before the engine ran: a soft band over each one, drawn left to
  // right as the page lands (real positions: countStaves' five lines).
  function drawPrepStaves(p, animate, faint) {
    if (!p || !p.staves?.length || p.page !== H.page) return;
    let html = '';
    p.staves.forEach((f, i) => {
      const ys = Array.isArray(f.y) ? f.y.map(Number).filter(Number.isFinite) : [];
      if (ys.length < 2) return;
      const gap = (ys.at(-1) - ys[0]) / (ys.length - 1);
      html += later(`<rect class="stfb" x="${r1(f.x0)}" y="${r1(ys[0] - gap * 0.5)}" width="${r1(f.x1 - f.x0)}" height="${r1(ys.at(-1) - ys[0] + gap)}" rx="${r1(gap * 0.5)}"/>`, animate && motion() ? i * 60 : 0);
    });
    L.staff.textContent = '';
    const g = group(L.staff, html, animate ? null : 'settled');
    if (faint) g.setAttribute('opacity', '.4');
  }
  // The engine's staves, a system at a time down the page behind a scan line when animated.
  function drawGrid(systems, animate) {
    L.staff.textContent = '';
    let html = '';
    const il = H.il;
    const list = systems || [];
    const step = animate && motion() ? Math.min(140, 700 / Math.max(1, list.length)) : 0;
    list.forEach((sys, si) => {
      let top = Infinity, bot = -Infinity, left = Infinity, one = '';
      (sys.staves || []).forEach((f) => {
        const ls = (f.lines || []).map((ln) => (Array.isArray(ln) ? [num(f.x0), num(ln[0]), num(f.x1), num(ln[1] ?? ln[0])] : [num(f.x0), num(ln), num(f.x1), num(ln)]));
        if (!ls.length) return;
        top = Math.min(top, ls[0][1]); bot = Math.max(bot, ls.at(-1)[1]); left = Math.min(left, num(f.x0));
        one += `<path class="stf" d="${staffPath(ls)}"/>`;
      });
      if (Number.isFinite(top) && Number.isFinite(left)) one += rectSvg('sysb', left - il * 1.5, top, il * 0.4, bot - top, il * 0.2, null);
      html += later(one, si * step);
    });
    group(L.staff, html, animate ? null : 'settled');
    if (step) sweep(null, true, Math.max(300, list.length * step));
  }
  function drawMeasures(s, sysId, xs, d) {
    const sys = vs.sheets[s]?.systems?.find((y) => y.id === sysId);
    if (!sys || !Array.isArray(xs)) return;
    const f = sys.staves?.[0];
    const y0 = f?.lines?.[0] ? (Array.isArray(f.lines[0]) ? f.lines[0][0] : f.lines[0]) : sys.box?.[1];
    if (!Number.isFinite(+y0)) return;
    const il = H.il;
    let html = '';
    for (const x of xs) if (Number.isFinite(+x)) html += lineSvg('k-meas', +x, y0 - il * 1.9, +x, y0 - il * 0.9, d, '');
    group(L.meas, html, 'settled');
  }

  // Everything known about the shown page, drawn at once (resume, return, fast-forward).
  function drawStatic() {
    clearSvg();
    const p = vs.pages[H.page];
    if (!p) return;
    const sh = p.s ? vs.sheets[p.s] : null;
    if (H.look === 'done') {
      if (sh) {
        let html = '';
        for (const list of Object.values(sh.notes || {})) for (const n of list) if (Number.isFinite(+n.x) && Number.isFinite(+n.y)) html += pillSvg(n, null);
        group(L.notes, html, 'settled');
      }
      return;
    }
    if (sh?.systems?.length && H.look === 'engine') drawGrid(sh.systems, false);
    else drawPrepStaves(p, false, H.look === 'engine' || vs.phase === 'read');
    if (!sh || H.look !== 'engine') return;
    pageEl.toggleAttribute('data-notes', sh.noteN > 0); // (the symbols dim under the page's notes, as live)
    let html = '';
    for (const a of Object.values(sh.syms || {})) if (Number.isFinite(+a.x) && Number.isFinite(+a.y)) html += symSvg(a, null);
    indexSyms(group(L.sym, html, 'settled'));
    for (const [sysId, xs] of Object.entries(sh.measures || {})) drawMeasures(p.s, Number(sysId), xs, null);
    html = '';
    for (const list of Object.values(sh.notes || {})) for (const n of list) if (Number.isFinite(+n.x) && Number.isFinite(+n.y)) html += pillSvg(n, null);
    group(L.notes, html, 'settled');
  }

  function showDone(animate) {
    const first = R.firstMusicPage(vs);
    const go = () => {
      if (first) showPage(first, null, false);
      setLook('done');
      setLensBox(null, 'none');
      // Page 1's notes as Play shows them: purple on the paper.
      clearSvg();
      const p = vs.pages[H.page];
      const sh = p?.s ? vs.sheets[p.s] : null;
      if (sh) {
        const all = [];
        for (const list of Object.values(sh.notes || {})) for (const n of list) if (Number.isFinite(+n.x) && Number.isFinite(+n.y)) all.push(n);
        const dOf = (n) => clamp((+n.y / H.h) * 700 + (+n.x / H.w) * 200, 0, 900);
        group(L.notes, sliced(all, dOf, animate ? 900 : 0, (n) => pillSvg(n, null)), animate ? null : 'settled');
      }
      updateTitle();
    };
    if (animate && motion()) {
      const a = pageEl.animate([{ transform: 'perspective(1400px) rotateY(0deg)' }, { transform: 'perspective(1400px) rotateY(90deg)' }], { duration: 260, easing: 'ease-in', fill: 'forwards' });
      a.onfinish = () => {
        go();
        pageEl.animate([{ transform: 'perspective(1400px) rotateY(-90deg)' }, { transform: 'none' }], { duration: 340, easing: 'cubic-bezier(.2,.8,.3,1)' });
        a.cancel();
      };
    } else go();
  }

  function renderStatic() {
    T.statics++;
    const t0 = performance.now();
    try { renderStatic1(); } finally { T.staticMs = Math.max(T.staticMs, Math.round(performance.now() - t0)); }
  }
  function renderStatic1() {
    settle(); finishSweep(); clearInterval(lineTimer); lineTimer = null; pendingLines = [];
    root.dataset.phase = vs.phase;
    root.removeAttribute('data-wait');
    const hero = R.heroOf(vs);
    if (!hero) { emptyEl.hidden = false; updateFacts(); railUpdate(); return; }
    showPage(hero.page, hero.look, false);
    drawStatic();
    setLens(vs);
    railUpdate();
    rebuildCode();
    updateTitle();
    updateFacts();
  }

  // --- code column -----------------------------------------------------------------------
  function setFile(name) { if (fileEl.textContent !== name) fileEl.textContent = name; }
  // Lines appear spread over d ms (at the given delays, else evenly), at most LINE_RATE a second.
  function lines(list, d, cls, delays) {
    if (!list?.length) return;
    const t0 = performance.now();
    if (!d || !motion()) { for (const l of list.slice(-MAX_LINES)) addLine(l, cls, motion()); return; }
    list.forEach((l, i) => {
      const at = delays?.[i] != null ? delays[i] : (i * d) / list.length;
      pendingLines.push({ due: t0 + at, line: l, cls });
    });
    pendingLines.sort((a, b) => a.due - b.due);
    if (!lineTimer) lineTimer = setInterval(drainLines, 50);
  }
  function drainLines() {
    const now = performance.now();
    while (pendingLines.length && pendingLines[0].due <= now) { const p = pendingLines.shift(); addLine(p.line, p.cls, true); }
    if (!pendingLines.length) { clearInterval(lineTimer); lineTimer = null; }
  }
  function flushLines() {
    if (!pendingLines.length) return;
    for (const p of pendingLines) addLine(p.line, p.cls, false);
    pendingLines = [];
    clearInterval(lineTimer); lineTimer = null;
  }
  function addLine(line, cls) {
    const div = document.createElement('div');
    div.className = `rd-ln${cls ? ' ' + cls : ''}`; // (no per-line animation: lines appear as they come)
    div.innerHTML = highlight(line);
    linesEl.append(div);
    T.lines++;
    while (linesEl.childElementCount > MAX_LINES) linesEl.firstElementChild.remove();
  }
  function clearLines() { linesEl.textContent = ''; pendingLines = []; }
  function rebuildCode() {
    clearLines();
    const out = [...R.metaLines(vs.meta).map((l) => [l, 'meta'])];
    let file = 'score.musicxml';
    const ph = vs.phase;
    if (['export', 'clean', 'save', 'done'].includes(ph) && vs.xml.length) {
      const tail = vs.xml.at(-1).split('\n').filter((l) => l.trim()).slice(-Math.max(18, visLines));
      for (const l of tail) out.push([l.replace(/\s+$/, ''), 'xml']);
    } else {
      const sh = R.currentSheet(vs);
      if (sh) {
        const sysIds = Object.keys(sh.notes || {});
        if (sysIds.length) {
          const ls = R.noteLines(sh.notes[sysIds.at(-1)], null, { pretty: visLines >= 14, offset: R.measureOffset(vs, sh.s) });
          for (const x of ls.slice(-Math.max(14, visLines))) out.push([x.xml, '']);
          lastMeasure = ls.filter((x) => x.m != null).at(-1)?.m ?? null;
        } else if (sh.symN) {
          file = `sheet#${sh.s}.xml`;
          for (const a of Object.values(sh.syms).slice(-12)) out.push([R.symLine(a), '']);
        }
      }
    }
    for (const f of vs.fixes) out.push([`<!-- ${f} -->`, 'fix']);
    if (ph === 'done') out.push(['</score-partwise>', '']);
    if (ph === 'error' && vs.error) out.push([`<!-- ${vs.error.message || 'stopped'} -->`, 'err']);
    setFile(file);
    for (const [l, c] of out.slice(-MAX_LINES)) addLine(l, c, false);
  }

  // --- rail ------------------------------------------------------------------------------
  function railUpdate(landing) {
    for (const p of R.pageList(vs)) {
      let th = thumbs.get(p.page);
      if (!th) {
        th = document.createElement('div');
        th.className = 'rd-th' + (landing && motion() ? ' new' : '');
        // (Once: an animation on an element shown again after display:none starts over — every
        // expand would make all the thumbnails land again.)
        th.addEventListener('animationend', () => th.classList.remove('new'), { once: true });
        th.dataset.page = p.page;
        th.style.setProperty('--ar', ((num(p.w, 2550) || 2550) / (num(p.h, 3300) || 3300)).toFixed(4));
        th.innerHTML = '<canvas></canvas><i class="rd-tp"></i><b></b>';
        th.title = `${p.page}`;
        const after = [...thumbs.keys()].filter((k) => k > p.page).sort((a, b) => a - b)[0];
        if (after != null) railEl.insertBefore(th, thumbs.get(after)); else railEl.append(th);
        thumbs.set(p.page, th);
        paintThumb(p, th.firstElementChild);
      }
      const pp = R.pageProgress(vs, p.page);
      if (th.dataset.state !== pp.state) th.dataset.state = pp.state;
      th.style.setProperty('--f', pp.fraction.toFixed(3));
      th.querySelector('b').textContent = pp.state === 'failed' ? '!' : '✓';
    }
    railCurrent();
  }
  function railCurrent() {
    for (const [page, th] of thumbs) th.classList.toggle('cur', page === H.page);
    const cur = thumbs.get(H.page);
    if (cur && railEl.scrollWidth > railEl.clientWidth) {
      const x = cur.offsetLeft - railEl.clientWidth / 2 + cur.offsetWidth / 2;
      railEl.scrollLeft = Math.max(0, x);
    }
  }
  async function paintThumb(p, canvas) {
    const blob = typeof p.preview === 'string' ? null : p.preview;
    const src = blob || (typeof p.preview === 'string' ? p.preview : null);
    if (!src) return;
    const ar = (num(p.w, 2550) || 2550) / (num(p.h, 3300) || 3300);
    canvas.height = THUMB_PX; canvas.width = Math.round(THUMB_PX * ar);
    try {
      let bmp;
      if (blob && 'createImageBitmap' in window) bmp = await createImageBitmap(blob);
      else {
        const im = new Image(); im.src = src; await im.decode(); bmp = im;
      }
      if (!root.isConnected) { bmp.close?.(); return; }
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      bmp.close?.();
    } catch {}
  }

  // --- chrome: title, facts, bar, pill, aria ----------------------------------------------
  function titleText() {
    return st.done?.title || st.meta.title || R.nameTitle(st.job?.name) || 'PDF';
  }
  function updateTitle() {
    const t = titleText();
    if (titleEl.textContent !== t) titleEl.textContent = t;
    doneTitle.textContent = `“${t}”`;
  }
  // The facts row: page · step (· its own clock after QUIET_CLOCK s without news) · reading time ·
  // time left · ⟳. On a narrow card what matters most stays whole (fitFacts): the step's name and its
  // clock first, then the time left; the reading time, the page and ⟳ give way.
  function updateFacts() {
    const now = Date.now();
    const ph = vs.phase;
    const parts = [];
    const cur = R.currentSheet(vs);
    const page = ph === 'pages' ? H.page : ph === 'read' ? cur?.page ?? null : null;
    if (page && st.of) parts.push(`<span class="rd-pg">${page}/${st.of}</span>`);
    if (ph === 'read' && vs.cur.step) {
      parts.push(`<span class="rd-step"><span class="rd-g">${esc(R.stepGlyph(vs.cur.step))}</span> ${esc(R.stepLabel(vs.cur.step))}</span>`);
      const quiet = st.paused == null && st.cur.stepAt != null && st.phase === 'read' && st.cur.step === vs.cur.step ? (now - (st.at ?? now)) / 1000 : 0;
      if (quiet >= QUIET_CLOCK) parts.push(`<span class="rd-q" title="this step">${R.clock(R.stepElapsed(st, now))}</span>`);
    } else if (ph === 'engine') {
      const got = new Set(st.engine.map((m) => m.milestone));
      const dots = R.MILESTONES.map((m) => (got.has(m) ? '<b>●</b>' : '○')).join('');
      const last = st.engine.at(-1);
      const label = last ? R.MILESTONE_INFO[last.milestone] || last.milestone : '';
      const detail = (typeof last?.detail === 'string' || typeof last?.detail === 'number') && String(last.detail).length <= 18 ? ` ${esc(last.detail)}` : '';
      parts.push(`<span class="rd-step"><span class="rd-g">⚙</span> <span class="rd-ms">${dots}</span> ${esc(label)}${detail}</span>`);
    } else if (ph !== 'idle') {
      const [label, glyph] = R.PHASE_INFO[ph] || ['', '·'];
      const n = ph === 'export' && vs.exported.length && st.nSheets ? ` ${vs.exported.length}/${st.nSheets}` : '';
      parts.push(`<span class="rd-step"><span class="rd-g">${esc(glyph)}</span> ${esc(label)}${n}</span>`);
    }
    if (st.at0 != null && !['done', 'error'].includes(st.phase)) parts.push(`<span class="rd-el">${R.clock(R.elapsed(st, now))}</span>`);
    const e = held ? null : R.eta(st, now); // (nothing runs while held: no estimate)
    if (e != null) parts.push(`<span class="rd-eta">${R.etaText(e)}</span>`);
    if (st.job?.resumed && ph !== 'done') parts.push('<span class="rd-re" title="resumed">⟳</span>');
    const html = parts.join('');
    if (factsEl.dataset.html !== html) { factsEl.dataset.html = html; factsEl.innerHTML = html; fitFacts(); }
  }
  function fitFacts() {
    factsEl.classList.remove('tight');
    if (!factsEl.clientWidth || factsEl.scrollWidth <= factsEl.clientWidth) return;
    for (const cls of ['rd-re', 'rd-el', 'rd-pg', 'rd-eta']) {
      const el = factsEl.querySelector(`.${cls}`);
      if (el) el.hidden = true;
      if (factsEl.scrollWidth <= factsEl.clientWidth) return;
    }
    factsEl.classList.add('tight'); // (still too narrow: the step's name is cut short)
  }
  function updateChrome() {
    const f = R.progress(st);
    barFill.style.transform = `scaleX(${f.toFixed(4)})`;
    barEl.setAttribute('aria-valuenow', String(Math.round(f * 100)));
    const s = R.status(st, Date.now());
    pill.dataset.phase = st.phase;
    pillArc.setAttribute('stroke-dashoffset', (103.67 * (1 - f)).toFixed(2));
    pillArc.classList.toggle('spin', !held && (st.phase === 'engine' || (st.phase === 'pages' && !st.of)));
    pillGlyph.textContent = st.phase === 'read' ? s.glyph : R.PHASE_INFO[st.phase]?.[1] ?? '·';
    const t = st.phase === 'done' ? titleText()
      : st.phase === 'error' ? 'stopped'
        : s.page && st.of && (st.phase === 'pages' || st.phase === 'read') ? `${s.page}/${st.of}` : R.PHASE_INFO[st.phase]?.[0] || '…';
    pillText.textContent = t;
    pill.setAttribute('aria-label', `${st.phase === 'done' ? 'Done' : st.phase === 'error' ? 'Stopped' : s.page ? `Page ${s.page} of ${st.of}` : R.PHASE_INFO[st.phase]?.[0] || 'Starting'} · expand`);
    if (st.phase !== lastPhase) { lastPhase = st.phase; root.dataset.phase = drawing() ? vs.phase : st.phase; }
    updateTitle();
    if (mode === 'min') updateFacts();
  }
  // Sparse, polite: a phase, a page, the end.
  function announce(ev, prevPhase) {
    let msg = '';
    if (ev.t === 'phase' && st.phase !== prevPhase) {
      msg = { pages: 'Finding the music pages', engine: 'Starting the engine', export: 'Writing MusicXML', save: 'Saving' }[st.phase] || '';
    } else if (ev.t === 'sheet' && ev.state === 'start') {
      const page = R.pageOfSheet(st, ev.s);
      msg = page ? `Page ${page} of ${st.of}` : '';
    } else if (ev.t === 'done') msg = `Done: ${titleText()}`;
    else if (ev.t === 'error') msg = `Stopped: ${ev.message || ''}`;
    if (msg && msg !== announced) { announced = msg; liveEl.textContent = msg; }
  }

  // The host holds the run (stuck on a page, another tab reading, stopped): clocks stop, nothing
  // breathes or spins; the next event lets go.
  function hold(on) {
    on = !!on;
    if (on === held) return;
    held = on;
    if (held) { st = R.pause(st, Date.now()); vs = { ...vs, paused: st.paused }; root.removeAttribute('data-wait'); }
    root.toggleAttribute('data-held', held);
    updateChrome(); updateFacts();
    if (!held && !timer && !queue.length && drawing()) idle();
  }

  // --- modes -----------------------------------------------------------------------------
  function minimize() {
    if (mode === 'min') return;
    stopDrawing();
    queue.length = 0; heavyQ = 0; stale = true;
    mode = 'min';
    const done = () => { card.hidden = true; pill.hidden = false; if (motion()) pill.classList.add('pop'); };
    minBtn.setAttribute('aria-expanded', 'false');
    if (motion() && card.animate) {
      const a = card.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translate(8%, 12%) scale(.9)' }], { duration: 200, easing: 'ease-in' });
      a.onfinish = done;
    } else done();
    stopTicker();
    updateChrome(); updateFacts();
    opts.onMinimize?.();
  }
  function expand() {
    if (mode === 'open') return;
    mode = 'open';
    pill.hidden = true; pill.classList.remove('pop');
    card.hidden = false;
    minBtn.setAttribute('aria-expanded', 'true');
    if (motion() && card.animate) card.animate([{ opacity: 0, transform: 'translate(6%, 10%) scale(.92)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.3,1)' });
    catchUp();
    startTicker();
    opts.onExpand?.();
  }
  function startTicker() { if (!ticker) ticker = setInterval(() => { if (drawing()) updateFacts(); }, 1000); }
  function stopTicker() { clearInterval(ticker); ticker = null; }
  function onVisibility() {
    if (document.hidden) { stopDrawing(); queue.length = 0; heavyQ = 0; stale = true; stopTicker(); }
    else if (mode === 'open') { catchUp(); startTicker(); }
  }
  // Code beside the page or under it: whichever shows the page larger. Stacked, the page may be
  // --rd-page-max-h tall and the card's width wide; beside, --rd-page-max-h-side tall and the
  // width less the code column (290 px). (An iPad in portrait stacks — the page 37% wider than
  // beside it; landscape and desktops put the code beside; a phone stacks.)
  const probe = root.querySelector('.rd-probe > i');
  function layout() {
    const w = root.clientWidth;
    const r = probe.getBoundingClientRect();
    if (!w || !r.height) return;
    const ar = (H.w || 2550) / (H.h || 3300);
    const beside = Math.min(r.height * ar, w - 290);
    const under = Math.min(r.width * ar, w);
    root.toggleAttribute('data-side', w >= 560 && beside >= under * 0.97);
  }
  const ro = window.ResizeObserver ? new ResizeObserver(() => {
    layout();
    if (factsEl.dataset.html) { factsEl.innerHTML = factsEl.dataset.html; fitFacts(); }
    const lh = parseFloat(getComputedStyle(linesEl).lineHeight) || 16;
    if (linesEl.clientHeight) visLines = Math.max(1, Math.floor(linesEl.clientHeight / lh));
  }) : null;
  ro?.observe(linesEl);
  ro?.observe(root);
  ro?.observe(probe);
  layout();
  minBtn.addEventListener('click', minimize);
  pill.addEventListener('click', expand);
  card.addEventListener('keydown', (e) => { if (e.key === 'Escape') minimize(); });
  document.addEventListener('visibilitychange', onVisibility);
  startTicker();
  if (opts.minimized) { mode = 'min'; card.hidden = true; pill.hidden = false; minBtn.setAttribute('aria-expanded', 'false'); stale = true; }
  updateChrome(); updateFacts(); updateTitle();

  function destroy() {
    stopDrawing(); stopTicker(); clearTimeout(stopArm);
    ro?.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    for (const u of urls.values()) { try { URL.revokeObjectURL(u); } catch {} }
    urls.clear(); thumbs.clear();
    root.remove();
  }

  return {
    push, load, hold, canStop, minimize, expand, destroy,
    get held() { return held; },
    get state() { return st; },
    get mode() { return mode; },
    status: () => R.status(st, Date.now()),
    debug: () => ({
      mode, held, queue: queue.length, timer: !!timer, beatIn: Math.round(beatEnd - performance.now()), drawnN: vs.n, gotN: st.n, stale, gapEma: Math.round(gapEma),
      hero: { page: H.page, s: H.s, look: H.look, lens: H.lens }, phase: vs.phase,
      svgNodes: svg.querySelectorAll('*').length, codeLines: linesEl.childElementCount, thumbs: thumbs.size,
      pendingLines: pendingLines.length, ...T,
    }),
  };
}

export default mount;
