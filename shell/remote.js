// The AI button from home: the Assistants remote (assist.js — on sing.html, the Sing page's own
// button) runs in the shell from the start, so an assistant's commands reach this device with no
// song open. The button shows only for a signed-in, approved account whose data is on this device
// with sync on, once an assistant has connected to the account — or while this device's switch is
// on (assist.js remote.available; remembered per account, so a reload shows it at once). Its AI
// button is in the top bar while Sing isn't shown (with Sing shown, Sing's own is there instead:
// one at a time, the same switch). Sing is mounted — hidden — when the switch is turned on here or
// a command arrives, and its own remote hooks (sing.js runRemote) do the work inside the shell's: a
// command that needs a song opens it in place with Sing shown first (the song open here, else
// Sing's) — a Record / Voice / Assistants sheet gives way
// — and open_song shows the song Sing opened. The Score's commands (score_*, v88) open the song in
// place with the Score shown (score_open's song, else the song open, else the one Sing has) — for
// that song only, the modules pref untouched — and run in play.js (resonatePlay.scoreRun); what the
// Score shows goes with this device's state while it's shown.
// A PDF not converted yet (v90): open_song opens it with the Score on its PDF (Sing can't open it)
// and says pdf_only; Sing's commands on one open here are refused; the Score's wait takes its PDF
// shown for ready (play.js state(): pdfOnly, shown).
import { remote, paintRemote } from "../assist.js?v=105";
import { songChoices } from "../catalog.js?v=105";
import { setOpenSong } from "./songlist.js?v=105";

const $ = (id) => document.getElementById(id);
const HOME = { page: "home", song: null, key: null, tempo: null, doing: "idle", line: null, lines: 0, has_take: false, sound: "none" };

// sing: singview's mount (load(), state()); song: songview's (open(), isOpen, current, title, mods,
// pdfOnly); places: places.js (close()).
export function mountRemote({ sing, song, places }) {
  const btn = $("home-remote");
  let inner = null; // Sing's own hooks, once sing.js has started them
  let running = 0;  // commands under way (a stale shell doesn't reload under one: chrome.js staleShell)
  const singShown = () => song.isOpen && song.mods.sing;

  const show = (on) => paintRemote(btn, on);
  // Sing's hooks, wrapped in the shell's (sing.js starts the remote with its own as it loads).
  function adopt() {
    const h = remote.hooks;
    if (!h || h === hooks) return;
    inner = h;
    remote.hooks = hooks;
  }
  async function loadSing() {
    await sing.load();
    adopt();
  }
  // The song in place with Sing shown: the song open here, else the one Sing has open. (Through
  // songview's open even when it shows already: a Record / Voice / Assistants sheet open now gives
  // way there — what it does stops — and its history entry goes to the song, not back after it.)
  // The song open is written first, as Songs does (here and for the Score's): a reload reopens it.
  async function showSing(id) {
    id ||= sing.state()?.song;
    if (id) { setOpenSong(id); await song.open(id, { sing: true }); }
    else places.close();
  }
  // The Score on a song (opened in place with it shown), then play.js runs the command.
  const P = () => window.resonatePlay;
  // Ready for a command: the song's notes laid out — or, a PDF only, its PDF shown.
  const scoreReady = (id) => { const st = P()?.state?.(); return !!st && st.song === id && (st.ready || (st.pdfOnly && st.shown)); };
  async function waitScore(id, ms = 30000) {
    // (a song Play couldn't open — no PDF here, a PDF that won't draw — won't become ready: stop waiting)
    for (let t = 0; t < ms && !(P()?.scoreRun && scoreReady(id)) && !(P()?.state?.()?.song === id && P().state().failed); t += 100) await new Promise((r) => setTimeout(r, 100));
    return !!P()?.scoreRun && scoreReady(id);
  }
  // The song an open_song means, as Sing finds it (its id, then its title, then a title holding the
  // words; the samples first, then My songs) — when that's a PDF only, Sing can't open it.
  async function pdfSongFor(want, onlyPdf = false) {
    const w = String(want ?? "").trim().toLowerCase();
    if (!w) return null;
    let all = [];
    try { const c = await songChoices(); all = [...c.samples, ...c.mine]; } catch { return null; }
    if (onlyPdf) all = all.filter((x) => x.k === "pdf");
    const hit = all.find((x) => x.id.toLowerCase() === w) || all.find((x) => (x.title || "").toLowerCase() === w) || all.find((x) => (x.title || "").toLowerCase().includes(w));
    return hit?.k === "pdf" ? hit : null;
  }
  // Opened in the Score; answered once Play has its PDF shown — or with Play's own words when it
  // doesn't (its PDF isn't on this device, or didn't open): an assistant mustn't say it's showing.
  async function openPdfOnly(hit) {
    setOpenSong(hit.id);
    await song.open(hit.id, { score: true });
    const has = () => !!P()?.scoreRun && P().state?.()?.song === hit.id; // (Play loaded, on this song)
    for (let t = 0; t < 15000 && !has(); t += 100) await new Promise((r) => setTimeout(r, 100));
    let r = null;
    try { if (has()) r = await P().scoreRun("score_state", {}); } // (Play's own wait: its PDF shown — or failed, and why)
    catch (err) { r = { ok: false, error: err?.message || String(err) }; }
    if (!r?.ok || !scoreReady(hit.id)) {
      return { ok: false, pdf_only: true, error: r?.error || "Its PDF didn't open on this device.", ...hooks.state() };
    }
    return { ok: true, pdf_only: true, note: "Only its PDF so far: shown in the Score. Convert it (Songs → ⋯ → Convert) to sing it.", ...hooks.state() };
  }
  async function runScore(action, a) {
    let id = action === "score_open" ? String(a.song ?? "") : song.isOpen ? song.current : sing.state()?.song || null;
    if (!id) return { ok: false, error: "No song is open — use score_open {song} first." };
    if (action === "score_open") {
      let all = null;
      try { const c = await songChoices(); all = [...c.samples, ...c.mine]; } catch {}
      if (all && !all.some((x) => x.id === id)) return { ok: false, error: "That song isn't on this device.", songs: all.map((x) => x.title) };
    }
    if (!(song.isOpen && song.current === id && song.mods.score)) { setOpenSong(id); await song.open(id, { score: true }); }
    else places.close(); // (a Record / Voice / Assistants sheet over it gives way)
    await waitScore(id);
    if (!P()?.scoreRun) return { ok: false, error: "The Score didn't load on this device." };
    return P().scoreRun(action, a);
  }
  async function run(action, a) {
    if (String(action).startsWith("score_")) return runScore(action, a);
    if (action === "stop") { try { await P()?.scoreRun?.("score_stop", {}); } catch {} } // (the Score's ▶ too)
    if (action === "open_song") { const hit = await pdfSongFor(a.song); if (hit) return openPdfOnly(hit); }
    else if (action !== "stop" && song.isOpen && song.pdfOnly) {
      return { ok: false, pdf_only: true, error: `“${song.title || "This song"}” is only a PDF so far — convert it first (Songs → ⋯ → Convert).`, ...hooks.state() };
    }
    await loadSing();
    if (!inner?.run) return { ok: false, error: "Sing didn't load on this device." };
    if (action === "stop") return inner.run(action, a);
    if (action === "open_song") {
      const r = await inner.run(action, a);
      if (r?.pdf_only) { // (Sing found a PDF only another way: the Score shows it)
        const hit = (r.song?.id && { id: r.song.id }) || (r.id && { id: r.id }) || (await pdfSongFor(a.song, true));
        if (hit) return openPdfOnly(hit);
        return r;
      }
      if (r?.ok !== false) { await showSing(sing.state()?.song); return { ...r, ...hooks.state() }; }
      return r;
    }
    await showSing(song.isOpen ? song.current : null);
    return inner.run(action, a);
  }
  // The Score's state while it's shown (play.js scoreState), else none.
  const scoreNow = () => { try { return song.isOpen && song.mods.score ? P()?.scoreState?.() || null : null; } catch { return null; } };
  const hooks = {
    async run(action, a) {
      running++;
      try { return await run(action, a); } finally { running--; }
    },
    // What this device shows: Sing's own while it's shown; else home, or the song open without Sing
    // — and the Score's, while it's shown.
    state() {
      let s = HOME;
      try { s = inner?.state?.() || HOME; } catch {}
      const score = scoreNow();
      if (singShown()) return score ? { ...s, score } : s;
      const cur = song.isOpen ? song.current : null;
      const same = !!cur && s.song?.id === cur;
      return { ...HOME, page: cur ? "song" : "home", song: cur ? { id: cur, title: song.title || s.song?.title || "", ...(song.pdfOnly ? { pdf_only: true } : {}) } : null,
        key: same ? s.key : null, tempo: same ? s.tempo : null, has_take: same ? !!s.has_take : false,
        ...(score ? { score, doing: score.playing ? "score-play" : "idle" } : {}) };
    },
    changed(on) { inner?.changed?.(on); show(on); },
    assistant(info) { inner?.assistant?.(info); },
  };

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      const on = !remote.on;
      if (on) loadSing().catch((err) => console.warn("remote: Sing", err)); // (ready for the first command)
      await remote.set(on);
    } finally { btn.disabled = false; }
  });
  remote.start(hooks).catch((err) => console.warn("remote", err));

  return {
    adopt,
    busy: () => running > 0,
    debug: () => ({ available: remote.available, cloud: remote.cloud, assistant: remote.assistant, on: remote.on, shown: !!btn.getClientRects().length, wrapped: remote.hooks === hooks, inner: !!inner, state: hooks.state() }),
  };
}
