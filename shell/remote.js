// 📡 from home: the Assistants remote (assist.js — on sing.html, the Sing page's 📡) runs in the
// shell from the start, so an assistant's commands reach this device with no song open. Only for a
// signed-in, approved account whose data is on this device with sync on (assist.js ready(), as
// now); the button stays hidden otherwise. Its 📡 is in the top bar while Sing isn't shown (with
// Sing shown, Sing's own 📡 is there instead: one at a time, the same switch). Sing is mounted —
// hidden — when 📡 is turned on here or a command arrives, and its own remote hooks (sing.js
// runRemote) do the work inside the shell's: a command that needs a song opens it in place with
// Sing shown first (the song open here, else Sing's) — a Record / Voice / Assistants sheet gives way
// — and open_song shows the song Sing opened.
import { remote } from "../assist.js?v=87";

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
  async function run(action, a) {
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
  const hooks = {
    run,
    // What this device shows: Sing's own while it's shown; else home, or the song open without Sing.
    state() {
      let s = HOME;
      try { s = inner?.state?.() || HOME; } catch {}
      if (singShown()) return s;
      const cur = song.isOpen ? song.current : null;
      const same = !!cur && s.song?.id === cur;
      return { ...HOME, page: cur ? "song" : "home", song: cur ? { id: cur, title: song.title || s.song?.title || "" } : null,
        key: same ? s.key : null, tempo: same ? s.tempo : null, has_take: same ? !!s.has_take : false };
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
