// Assistants (MCP, v73): what this device shares with an AI assistant connected to the account
// (ChatGPT, Claude… through the Resonate MCP server, supabase/functions/mcp), and the remote
// control that lets the assistant act in the open Sing page.
//
// Shared (written straight to Postgres under RLS — supabase/migrations/…_assistants.sql):
//   song_scores  the open song as the page reads it: lines, notes, syllables, key, tempo
//   coach_takes  each whole take: when, which song, key, tempo… and the page's own coaching at the end
//   coach_lines  each take's lines — written line by line while the take runs, so an assistant
//                can follow it live (`final` once the take is graded as a whole)
// Remote control: this device is a row in `devices` (its id and name are device settings); its
// switch (the Sing page's 📡) sets `remote` — one device at a time. Commands arrive over
// Realtime (the account's private topic, "user:<uid>"), are run by the page and answered in
// their `device_commands` row. Only for a signed-in, approved account whose data is on this
// device and whose sync is on (as sync.js); nothing at all otherwise.

import { supabase, savedUser } from "./auth.js?v=76";
import { activeSpace } from "./space.js?v=76";

const SYNC_OFF = "resonate.sync.off";
const DEVICE_KEY = "resonate.device"; // { id, name }
const KEEP_TAKES = 30; // takes kept for assistants (the oldest go)

// --- Who and whether ----------------------------------------------------------------------
let readyP = null;
// → { sb, uid } when this device shares and can be controlled; null otherwise.
export function ready() {
  readyP ||= (async () => {
    const user = savedUser();
    if (!user || activeSpace() !== user.id) return null;
    try { if (localStorage.getItem(SYNC_OFF) === "1") return null; } catch {}
    const sb = await supabase();
    const { data: { session } } = await sb.auth.getSession();
    if (!session || session.user.id !== user.id) return null;
    const { data, error } = await sb.from("accounts").select("approved").maybeSingle();
    return !error && data?.approved ? { sb, uid: user.id } : null;
  })().catch((err) => { console.warn("assist:", err); return null; });
  return readyP;
}
const stillMine = (c) => !!c && savedUser()?.id === c.uid && activeSpace() === c.uid;

// Writes in order (a line never goes before its take), retried once a little later when they
// fail (no connection…).
let chain = Promise.resolve();
const later = [];
function write(fn) {
  chain = chain.then(async () => {
    const c = await ready();
    if (!stillMine(c)) return;
    const { error } = await fn(c);
    if (error) { console.warn("assist: write", error.message || error); later.push(fn); }
  }).catch((err) => { console.warn("assist:", err); later.push(fn); });
  return chain;
}
setInterval(() => { if (later.length && !document.hidden) { const fns = later.splice(0); for (const fn of fns) write(fn); } }, 15000);

// --- What's shared ----------------------------------------------------------------------
let songTimer = null, songPending = null;
// The open song (re-sent when its key, tempo or verse changes), a second after it settles.
export function shareSong(songId, data) {
  if (!songId || !data) return;
  songPending = { songId, data };
  clearTimeout(songTimer);
  songTimer = setTimeout(() => {
    const { songId: id, data: d } = songPending;
    write(({ sb }) => sb.from("song_scores").upsert({ song_id: id, data: d, updated_at: new Date().toISOString() }, { onConflict: "user_id,song_id" }));
  }, 1000);
}

const takes = new Map(); // take id → { songId, started }
// A whole take starts (not a loop round): assistants see it as live from now.
export function takeStarted(id, songId, meta) {
  if (!id) return;
  takes.set(id, { songId });
  const now = new Date().toISOString();
  write(({ sb }) => sb.from("coach_takes").upsert({ id, song_id: songId, status: "live", started_at: now, updated_at: now, device_id: device().id, meta }, { onConflict: "user_id,id" }));
}
// One line of a live take, as soon as its notes are graded.
export function lineDone(takeId, li, data) {
  if (!takes.has(takeId)) return;
  const now = new Date().toISOString();
  write(({ sb }) => sb.from("coach_lines").upsert({ take_id: takeId, li, final: false, data, updated_at: now }, { onConflict: "user_id,take_id,li" }));
  write(({ sb }) => sb.from("coach_takes").update({ updated_at: now }).eq("id", takeId));
}
// The take ended: every line as graded at the end, the review, the take's status. The oldest
// takes beyond KEEP_TAKES go.
export function takeEnded(takeId, { status, meta, review, lines }) {
  if (!takes.has(takeId)) return;
  takes.delete(takeId);
  const now = new Date().toISOString();
  if (lines?.length) write(({ sb }) => sb.from("coach_lines").upsert(lines.map((l) => ({ take_id: takeId, li: l.li, final: true, data: l.data, updated_at: now })), { onConflict: "user_id,take_id,li" }));
  write(({ sb }) => sb.from("coach_takes").update({ status, meta, review, updated_at: now }).eq("id", takeId));
  write(async ({ sb }) => {
    const { data, error } = await sb.from("coach_takes").select("id").order("started_at", { ascending: false }).range(KEEP_TAKES, KEEP_TAKES + 50);
    if (error || !data?.length) return { error };
    return sb.from("coach_takes").delete().in("id", data.map((x) => x.id));
  });
}

// --- This device --------------------------------------------------------------------------
function guessName() {
  const ua = navigator.userAgent || "";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/Macintosh/.test(ua)) return "Mac";
  return "This device";
}
export function device() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(DEVICE_KEY)); } catch {}
  if (!d?.id) {
    d = { id: `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, name: guessName() };
    try { localStorage.setItem(DEVICE_KEY, JSON.stringify(d)); } catch {}
  }
  return d;
}
export function renameDevice(name) {
  const d = { ...device(), name: String(name || "").trim().slice(0, 60) || guessName() };
  try { localStorage.setItem(DEVICE_KEY, JSON.stringify(d)); } catch {}
  return d;
}

// --- Remote control -----------------------------------------------------------------------
// remote.start({ run(action, args) → { ok, … }, state() → {…}, changed(on) }) on the Sing page.
export const remote = {
  available: false, // signed in, approved, sync on
  settings: { start_delay_s: 4, review_after_remote: false }, // the Assistants page's (assistant_settings)
  on: false,        // this device takes commands
  async start(hooks) {
    this.hooks = hooks;
    const c = await ready();
    if (!c) return false;
    this.ctx = c;
    this.available = true;
    const me = device();
    const { data } = await c.sb.from("devices").select("remote").eq("id", me.id).maybeSingle();
    this.on = !!data?.remote;
    // The assistant active lately (the page shows it by 📡).
    c.sb.from("assistant_activity").select("name,logo,last_at,last_tool").order("last_at", { ascending: false }).limit(1)
      .then(({ data: a }) => { if (a?.[0]) hooks.assistant?.({ name: a[0].name, logo: a[0].logo, tool: a[0].last_tool, at: a[0].last_at }); }, () => {});
    await this.beat();
    await this.listen();
    // (old commands go: an hour is plenty to look back on)
    c.sb.from("device_commands").delete().lt("created_at", new Date(Date.now() - 3600000).toISOString()).then(() => {}, () => {});
    setInterval(() => { if (!document.hidden) this.beat(); }, 30000);
    document.addEventListener("visibilitychange", () => { this.beat(); if (!document.hidden) this.catchUp(); });
    window.addEventListener("pagehide", () => this.beat(true));
    hooks.changed?.(this.on);
    return true;
  },
  // Switch it on here (and so off everywhere else), or off.
  async set(on) {
    const c = this.ctx;
    if (!stillMine(c)) return false;
    const me = device();
    const { error } = await c.sb.from("devices").upsert({ id: me.id, name: me.name, remote: !!on, seen_at: new Date().toISOString(), state: this.state() }, { onConflict: "user_id,id" });
    if (error) { console.warn("assist: remote", error.message); return this.on; }
    this.on = !!on;
    this.hooks?.changed?.(this.on);
    return this.on;
  },
  state() {
    let s = {};
    try { s = this.hooks?.state?.() || {}; } catch {}
    return { ...s, visible: !document.hidden, at: Date.now() };
  },
  // The device is here (and what it shows), every 30 s while visible and when its state changes.
  async beat(leaving = false) {
    const c = this.ctx;
    if (!stillMine(c)) return;
    const me = device();
    const state = { ...this.state(), ...(leaving ? { visible: false, left: true } : {}) };
    if (!leaving) c.sb.from("assistant_settings").select("start_delay_s,review_after_remote").maybeSingle().then(({ data: st }) => { if (st) this.settings = st; }, () => {});
    const { data, error } = await c.sb.from("devices").upsert({ id: me.id, name: me.name, seen_at: new Date().toISOString(), state }, { onConflict: "user_id,id" }).select("remote").maybeSingle();
    if (!error && data && !!data.remote !== this.on) { this.on = !!data.remote; this.hooks?.changed?.(this.on); } // (switched on elsewhere)
  },
  changedSoon() { clearTimeout(this.t); this.t = setTimeout(() => this.beat(), 800); },
  seen: new Set(),
  async listen() {
    const c = this.ctx;
    try { await c.sb.realtime.setAuth(); } catch {}
    const since = Date.now() - 60000;
    this.channel = c.sb.channel(`user:${c.uid}`, { config: { private: true, broadcast: { replay: { since, limit: 25 } } } })
      .on("broadcast", { event: "command" }, (m) => this.handle(m.payload))
      .on("broadcast", { event: "assistant" }, (m) => this.hooks?.assistant?.({ ...m.payload, received: Date.now() }))
      .subscribe((status) => { if (status === "SUBSCRIBED") this.catchUp(); });
  },
  // Commands that came while the page couldn't hear them (hidden, reconnecting).
  async catchUp() {
    const c = this.ctx;
    if (!stillMine(c) || !this.on) return;
    const { data } = await c.sb.from("device_commands").select("id,device_id,action,args,created_at")
      .eq("device_id", device().id).eq("status", "sent").gte("created_at", new Date(Date.now() - 60000).toISOString()).order("created_at");
    for (const r of data || []) this.handle({ id: r.id, device: r.device_id, action: r.action, args: r.args, at: r.created_at });
  },
  // One command at a time, in the order they came; each once — a command replayed after a
  // reload (Realtime keeps the last minute) is run only if its row still says "sent".
  queue: Promise.resolve(),
  tab: Math.random().toString(36).slice(2, 10),
  handle(cmd) {
    if (!cmd?.id || this.seen.has(cmd.id) || cmd.device !== device().id) return;
    this.seen.add(cmd.id);
    this.queue = this.queue.then(() => this.run1(cmd)).catch((err) => console.warn("assist: command", err));
  },
  async run1(cmd) {
    const c = this.ctx;
    if (!stillMine(c)) return;
    // Claimed by one page (another Sing tab of this device may have it too): the row's result is
    // set only where it's still empty.
    const { data: claimed } = await c.sb.from("device_commands").update({ result: { claimed: this.tab } }).eq("id", cmd.id).eq("status", "sent").is("result", null).select("id");
    if (!claimed?.length) return;
    const answer = (status, result) => c.sb.from("device_commands").update({ status, result, updated_at: new Date().toISOString() }).eq("id", cmd.id);
    if (!this.on) return answer("failed", { error: "Remote control is off on this device." });
    // Something that starts sound or the mic is only done right away, never long after it was asked.
    const starts = ["listen", "play_take", "sing", "loop_line"].includes(cmd.action);
    if (Date.now() - Date.parse(cmd.at) > (starts ? 15000 : 60000)) return answer("expired", { error: "It came too late — ask again." });
    if (document.hidden && ["sing", "loop_line"].includes(cmd.action)) return answer("failed", { error: "The page isn't in front on this device — bring it up and ask again." });
    let r;
    try { r = (await this.hooks.run(cmd.action, cmd.args || {})) || { ok: true }; }
    catch (err) { r = { ok: false, error: err.message || String(err) }; }
    await answer(r.ok === false ? "failed" : "done", r);
    this.changedSoon();
  },
};

window.resonateAssist = () => ({ device: device(), remote: { available: remote.available, on: remote.on }, queued: later.length });
