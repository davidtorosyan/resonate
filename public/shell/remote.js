// 📡 from home: the Assistants remote (assist.js — on sing.html, the Sing page's 📡) runs in the
// shell from the start, so an assistant's commands reach this device with no song open. Only for a
// signed-in, approved account whose data is on this device with sync on (assist.js ready(), as
// now); the button stays hidden otherwise. Its 📡 is in the top bar while Sing isn't shown (with
// Sing shown, Sing's own 📡 is there instead: one at a time, the same switch). Sing is mounted —
// hidden — when 📡 is turned on here or a command arrives, and its own remote hooks (sing.js
// runRemote) do the work inside the shell's: a command that needs a song opens it in place with
// Sing shown first (the song open here, else Sing's) — a Record / Voice / Assistants sheet gives way
// — and open_song shows the song Sing opened. The Score's commands (score_*, v88) open the song in
// place with the Score shown (score_open's song, else the song open, else the one Sing has) — for
// that song only, the modules pref untouched — and run in play.js (resonatePlay.scoreRun); what the
// Score shows goes with this device's state while it's shown.
import { remote } from "../assist.js?v=88";
import { songChoices } from "../catalog.js?v=88";

const $ = (id) => document.getElementById(id);
const HOME = { page: "home", song: null, key: null, tempo: null, doing: "idle", line: null, lines: 0, has_take: false, sound: "none" };

// sing: singview's mount (load(), state()); song: songview's (open(), isOpen, current, title, mods);
// places: places.js (close()).
export function mountRemote({ sing, song, places }) {
  const btn = $("home-remote");
  let inner = null; // Sing's own hooks, once sing.js has started them
  const singShown = () => song.isOpen && song.mods.sing;

  function show(on) {
    btn.hidden = !remote.available;
    btn.dataset.on = String(!!on);
    btn.textContent = on ? "📡 Remote on" : "📡";
    btn.title = on ? "An assistant can control this device — tap to stop" : "Let an assistant control this device";
    btn.setAttribute("aria-pressed", String(!!on));
  }
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
  async function showSing(id) {
    id ||= sing.state()?.song;
    if (id) await song.open(id, { sing: true });
    else places.close();
  }
  // The Score on a song (opened in place with it shown), then play.js runs the command.
  const P = () => window.resonatePlay;
  async function runScore(action, a) {
    let id = action === "score_open" ? String(a.song ?? "") : song.isOpen ? song.current : sing.state()?.song || null;
    if (!id) return { ok: false, error: "No song is open — use score_open {song} first." };
    if (action === "score_open") {
      let all = null;
      try { const c = await songChoices(); all = [...c.samples, ...c.mine]; } catch {}
      if (all && !all.some((x) => x.id === id)) return { ok: false, error: "That song isn't on this device.", songs: all.map((x) => x.title) };
    }
    if (!(song.isOpen && song.current === id && song.mods.score)) await song.open(id, { score: true });
    else places.close(); // (a Record / Voice / Assistants sheet over it gives way)
    for (let t = 0; t < 30000 && !(P()?.scoreRun && P().state?.().song === id && P().state().ready); t += 100) await new Promise((r) => setTimeout(r, 100));
    if (!P()?.scoreRun) return { ok: false, error: "The Score didn't load on this device." };
    return P().scoreRun(action, a);
  }
  async function run(action, a) {
    if (String(action).startsWith("score_")) return runScore(action, a);
    if (action === "stop") { try { await P()?.scoreRun?.("score_stop", {}); } catch {} } // (the Score's ▶ too)
    await loadSing();
    if (!inner?.run) return { ok: false, error: "Sing didn't load on this device." };
    if (action === "stop") return inner.run(action, a);
    if (action === "open_song") {
      const r = await inner.run(action, a);
      if (r?.ok !== false) { await showSing(sing.state()?.song); return { ...r, ...hooks.state() }; }
      return r;
    }
    await showSing(song.isOpen ? song.current : null);
    return inner.run(action, a);
  }
  // The Score's state while it's shown (play.js scoreState), else none.
  const scoreNow = () => { try { return song.isOpen && song.mods.score ? P()?.scoreState?.() || null : null; } catch { return null; } };
  const hooks = {
    run,
    // What this device shows: Sing's own while it's shown; else home, or the song open without Sing
    // — and the Score's, while it's shown.
    state() {
      let s = HOME;
      try { s = inner?.state?.() || HOME; } catch {}
      const score = scoreNow();
      if (singShown()) return score ? { ...s, score } : s;
      const cur = song.isOpen ? song.current : null;
      const same = !!cur && s.song?.id === cur;
      return { ...HOME, page: cur ? "song" : "home", song: cur ? { id: cur, title: song.title || s.song?.title || "" } : null,
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
    debug: () => ({ available: remote.available, on: remote.on, shown: !!btn.getClientRects().length, wrapped: remote.hooks === hooks, inner: !!inner, state: hooks.state() }),
  };
}
