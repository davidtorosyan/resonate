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
// switch (the AI button at the top of Resonate) sets `remote` — one device at a time. The button
// shows only once an assistant has connected to the account (remote.available). Commands arrive over
// Realtime (the account's private topic, "user:<uid>"), are run by the page and answered in
// their `device_commands` row. Only for a signed-in, approved account whose data is on this
// device and whose sync is on (as sync.js); nothing at all otherwise.

import { supabase, savedUser } from "./auth.js?v=117";
import { activeSpace } from "./space.js?v=117";

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

// Has an assistant connected to the account? assistant_activity has a row (the MCP server writes
// one at every tool call: public.assistant_seen) → { yes: true | false | null (couldn't ask),
// latest: the assistant active lately }. Yes is kept for the page load; no is asked again after a
// minute (one may connect meanwhile); a Realtime "assistant" event says yes at once (remote.listen).
// The Score's focus is sent, and the AI button shown (remote.available), only once one has. The
// answer turning yes (asked, or that event) is said once a page load as window "resonate:assistant",
// so what was open before is shared now (play.js: the open song's fingering).
let assistantP = null, assistantAt = 0, assistantSaid = false;
function sawAssistant() {
  if (assistantSaid) return;
  assistantSaid = true;
  try { window.dispatchEvent(new CustomEvent("resonate:assistant")); } catch {}
}
function activity() {
  if (assistantP && assistantP.no && Date.now() - assistantAt > 60000) assistantP = null;
  if (!assistantP) {
    assistantAt = Date.now();
    const p = (async () => {
      const c = await ready();
      if (!c) return { yes: false };
      const { data, error } = await c.sb.from("assistant_activity").select("name,logo,last_at,last_tool").order("last_at", { ascending: false }).limit(1);
      return error ? { yes: null } : { yes: !!data?.length, latest: data?.[0] || null };
    })().catch(() => ({ yes: null }));
    p.then((r) => { p.no = r.yes !== true; if (r.yes === true) sawAssistant(); });
    assistantP = p;
  }
  return assistantP;
}
export const hasAssistant = () => activity().then((r) => r.yes === true);

// The Score's focus (v88): the bars picked on this device's Score — their notes as text, the view's
// MusicXML for them, where they are on the PDF, and two pictures (data URLs) — one row a device,
// replaced by the next. Sent only when an assistant has connected to the account (hasAssistant).
// (not retried: a newer focus replaces it — the latest one sent wins) → true once stored
let focusSeq = 0;
const FOCUS_PIC_MAX = 2000000; // characters: score_focus's limit on a picture (data URL)
export async function shareFocus(songId, data, { score = null, pdf = null } = {}) {
  const n = ++focusSeq;
  if (!songId || !data) return false;
  const c = await ready();
  if (!stillMine(c) || n !== focusSeq) return false;
  // (a picture over the table's limit — 2,000,000 characters — would have the whole row refused)
  const fits = (u) => (typeof u === "string" && u.length <= FOCUS_PIC_MAX ? u : null);
  const row = { device_id: device().id, song_id: songId, data, score_img: fits(score), pdf_img: fits(pdf), updated_at: new Date().toISOString() };
  const left = [score && !row.score_img ? "score" : null, pdf && !row.pdf_img ? "pdf" : null].filter(Boolean);
  if (left.length) row.data = { ...data, pictures_left_out: left };
  const put = (r) => c.sb.from("score_focus").upsert(r, { onConflict: "user_id,device_id" });
  let { error } = await put(row);
  // Refused with its pictures: the notes, the MusicXML and where they are still go, without them.
  if (error && (row.score_img || row.pdf_img) && n === focusSeq && stillMine(c)) {
    console.warn("assist: focus (again without the pictures)", error.message || error);
    ({ error } = await put({ ...row, score_img: null, pdf_img: null, data: { ...data, pictures_left_out: ["score", "pdf"].filter((k) => (k === "score" ? score : pdf)) } }));
  }
  if (error) console.warn("assist: focus", error.message || error);
  return !error;
}

// Piano fingering (E7, docs/FINGERING.md §4): a song's suggested fingering as text (fingertext.js
// fingerText's data), one row a song in score_fingering, for read_resonate fingering. Sent only once
// an assistant has connected to the account (hasAssistant), and only when it changed since this
// device last sent it for this account: resonate.play.fingUp = { uid: { songId: "alg|hand|bpm|sig|v" } }
// (device-only; sig falls back to a hash of the bars' text). Best effort: never throws, not retried (the
// next time the song shows on the Score sends it again) → true once stored (or already there).
const FING_UP = "resonate.play.fingUp";
const fingUpAll = () => { try { const v = JSON.parse(localStorage.getItem(FING_UP) || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; } };
function setFingUp(uid, songId, key) {
  try {
    const all = fingUpAll(), mine = all[uid] && typeof all[uid] === "object" ? all[uid] : {};
    if (key) mine[songId] = key; else delete mine[songId];
    if (Object.keys(mine).length) all[uid] = mine; else delete all[uid];
    if (Object.keys(all).length) localStorage.setItem(FING_UP, JSON.stringify(all)); else localStorage.removeItem(FING_UP);
  } catch {}
}
function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
}
export const fingKey = (data) => [data.alg, data.hand, data.bpm ?? "", data.sig ?? `t${fnv(JSON.stringify(data.bars || []))}`, data.v ?? ""].join("|");
// (one at a time, in the order asked: a song's newer fingering, or its delete, always lands last)
let fingChain = Promise.resolve();
const fingNext = (fn) => {
  const run = fingChain.then(fn).catch((err) => { console.warn("assist: fingering", err); return false; });
  fingChain = run;
  return run;
};
export function shareFingering(songId, data) {
  return fingNext(async () => {
    if (!songId || !data || !Array.isArray(data.bars) || !Number.isInteger(data.alg)) return false;
    if (!(await hasAssistant())) return false;
    const c = await ready();
    if (!stillMine(c)) return false;
    const key = fingKey(data);
    if (fingUpAll()[c.uid]?.[songId] === key) return true;
    const { error } = await c.sb.from("score_fingering").upsert({ song_id: songId, alg: data.alg, data, updated_at: new Date().toISOString() }, { onConflict: "user_id,song_id" });
    if (error) { console.warn("assist: fingering", error.message || error); return false; }
    setFingUp(c.uid, songId, key);
    return true;
  });
}
// The song is gone (forget.js): its row goes too, and this device's marker for it. Best effort,
// signed in only (as the rest of this module: an approved account with sync on); a delete that fails
// is retried with the other writes while the page lives.
export function dropFingering(songId) {
  return fingNext(async () => {
    if (!songId) return false;
    const c = await ready();
    if (!stillMine(c)) return false;
    setFingUp(c.uid, songId, null);
    await write(({ sb }) => sb.from("score_fingering").delete().eq("song_id", songId));
    return true;
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
// remote.start({ run(action, args) → { ok, … }, state() → {…}, changed(on), handles(action) → bool })
// on the Sing page, Play and the one-page shell. Every tab of a browser is the same device (one id):
// the page in front — the last one shown, focused or touched — is first to take a command and is
// the one that says what the device shows; a page that can't run a command (`handles` false: Play
// and Sing's actions, sing.html and the Score's) or is hidden lets another tab of this device take
// it first, and answers it itself only when none has (v88).
const FRONT_KEY = "resonate.remote.front"; // { tab, at } — the page in front (device-only)
const FRONT_MS = 75000; // a front record older than this is a page gone (it beats every 30 s)
// The AI button seen on this device, per account: { [uid]: { a: an assistant has connected, on:
// this device's switch } } (device-only; kept while either is true) — so the next load shows the
// button at once, before the cloud answers (which then decides).
const SEEN_KEY = "resonate.remote.seen";
const seenAll = () => { try { const v = JSON.parse(localStorage.getItem(SEEN_KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; } };
function saveSeen(uid, rec) {
  try {
    const all = seenAll();
    if (rec.a || rec.on) all[uid] = { a: !!rec.a, on: !!rec.on }; else delete all[uid];
    if (Object.keys(all).length) localStorage.setItem(SEEN_KEY, JSON.stringify(all)); else localStorage.removeItem(SEEN_KEY);
  } catch {}
}
// (no network: the saved session, this device showing its data, sync not off — as ready() asks)
function remembered() {
  const user = savedUser();
  if (!user || activeSpace() !== user.id) return null;
  try { if (localStorage.getItem(SYNC_OFF) === "1") return null; } catch {}
  const r = seenAll()[user.id];
  return r && (r.a || r.on) ? r : null;
}
export const remote = {
  cloud: false,     // signed in, approved, sync on (ready())
  checked: false,   // ready() has answered
  assistant: false, // an assistant has connected to the account (activity())
  early: null,      // the remembered record (SEEN_KEY), until ready() answers
  // The AI button is offered: for a signed-in, approved account with sync on, once an assistant has
  // connected — or while this device's switch is on (so it can be turned off), whatever the check
  // says or if it can't be made. Before the cloud answers: as remembered.
  get available() { return this.checked ? this.cloud && (this.assistant || this.on) : !!this.early; },
  settings: { start_delay_s: 4, review_after_remote: false }, // the Assistants page's (assistant_settings)
  on: false,        // this device takes commands
  // (Started once per page: a second start — the one-page shell starts it at home, then Sing's own
  // inside the shell — gives its hooks to the remote already running.)
  start(hooks) {
    this.hooks = hooks;
    if (this.starting) {
      if (this.available) hooks.changed?.(this.on); // (this page's button too, at once)
      return this.starting.then((ok) => { hooks.changed?.(this.on); return ok; });
    }
    const r = remembered();
    if (r) { this.early = r; this.assistant = !!r.a; this.on = !!r.on; hooks.changed?.(this.on); }
    return (this.starting = this.begin());
  },
  async begin() {
    const c = await ready();
    this.checked = true;
    this.early = null;
    if (!c) { if (this.on || this.assistant) this.hooks?.changed?.(this.on); return false; } // (shown as remembered: hidden now)
    this.ctx = c;
    this.cloud = true;
    const me = device();
    const { data, error } = await c.sb.from("devices").select("remote").eq("id", me.id).maybeSingle();
    if (!error) this.on = !!data?.remote; // (unread: as remembered)
    this.remember();
    // Has an assistant connected (the button), and the one active lately (the page shows it by the button).
    this.askAssistant(true);
    this.takeFront();
    await this.beat();
    await this.listen();
    // (old commands go: an hour is plenty to look back on)
    c.sb.from("device_commands").delete().lt("created_at", new Date(Date.now() - 3600000).toISOString()).then(() => {}, () => {});
    setInterval(() => {
      if (document.hidden) return;
      if (!this.assistant) this.askAssistant(); // (asked again a minute after a no)
      if (this.inFront()) { this.takeFront(); this.beat(); }
    }, 30000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) { this.takeFront(); this.beat(); this.catchUp(); if (!this.assistant) this.askAssistant(); }
      else if (this.inFront(true)) { this.beat(); this.dropFront(); } // (another tab shown takes over)
    });
    window.addEventListener("focus", () => this.takeFront());
    window.addEventListener("pointerdown", () => this.takeFront(), { capture: true, passive: true });
    // the page in front went away: a page still shown takes over (and says what the device shows)
    window.addEventListener("storage", (e) => { if (e.key === FRONT_KEY && !e.newValue && !document.hidden) { this.takeFront(); this.beat(); } });
    window.addEventListener("pagehide", () => { if (this.inFront(true)) { this.beat(true); this.dropFront(); } });
    this.hooks?.changed?.(this.on);
    return true;
  },
  // What this device remembers for the account (SEEN_KEY).
  remember() { if (stillMine(this.ctx)) saveSeen(this.ctx.uid, { a: this.assistant, on: this.on }); },
  // Has an assistant connected? (yes: the button shows — at once, wherever this page is; a check
  // that couldn't be made changes nothing) — with `chip`, also the one active lately.
  askAssistant(chip = false) {
    return activity().then((r) => {
      if (chip && r.latest) this.hooks?.assistant?.({ name: r.latest.name, logo: r.latest.logo, tool: r.latest.last_tool, at: r.latest.last_at });
      this.noteAssistant(r.yes);
    }, () => {});
  },
  noteAssistant(yes) {
    if (yes !== true && yes !== false) return;
    const was = this.available;
    this.assistant = yes;
    this.remember();
    if (this.available !== was) this.hooks?.changed?.(this.on);
  },
  // Which of this device's pages is in front (tabs, Split View): its record in localStorage.
  frontTab() {
    try { const f = JSON.parse(localStorage.getItem(FRONT_KEY) || "null"); return f && Date.now() - f.at < FRONT_MS ? f.tab : null; } catch { return null; }
  },
  // this page is the one in front, or none is (hidden pages too with `any`)
  inFront(any = false) { const f = this.frontTab(); return (any || !document.hidden) && (!f || f === this.tab); },
  takeFront() {
    if (document.hidden) return;
    const was = this.frontTab();
    try { localStorage.setItem(FRONT_KEY, JSON.stringify({ tab: this.tab, at: Date.now() })); } catch {}
    // (in front now after another page: the device shows this one — said soon)
    if (was && was !== this.tab && this.ctx) { clearTimeout(this.t); this.t = setTimeout(() => this.beat(), 800); }
  },
  dropFront() { try { if (this.frontTab() === this.tab) localStorage.removeItem(FRONT_KEY); } catch {} },
  // Switch it on here (and so off everywhere else), or off. (A tap on the remembered button before
  // the cloud answered waits for it.)
  async set(on) {
    if (!this.ctx && this.starting) await this.starting;
    const c = this.ctx;
    if (!stillMine(c)) return false;
    const me = device();
    const { error } = await c.sb.from("devices").upsert({ id: me.id, name: me.name, remote: !!on, seen_at: new Date().toISOString(), state: this.state() }, { onConflict: "user_id,id" });
    if (error) { console.warn("assist: remote", error.message); return this.on; }
    this.on = !!on;
    this.remember();
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
    if (!error && data && !!data.remote !== this.on) { this.on = !!data.remote; this.remember(); this.hooks?.changed?.(this.on); } // (switched on elsewhere)
  },
  // (a page not in front says what it shows only right after it ran a command: `ran`)
  changedSoon(ran = false) { if (!ran && !this.inFront(true)) return; clearTimeout(this.t); this.t = setTimeout(() => this.beat(), 800); },
  seen: new Set(),
  async listen() {
    const c = this.ctx;
    try { await c.sb.realtime.setAuth(); } catch {}
    const since = Date.now() - 60000;
    this.channel = c.sb.channel(`user:${c.uid}`, { config: { private: true, broadcast: { replay: { since, limit: 25 } } } })
      .on("broadcast", { event: "command" }, (m) => this.handle(m.payload))
      .on("broadcast", { event: "assistant" }, (m) => { assistantP = Promise.resolve({ yes: true }); sawAssistant(); this.noteAssistant(true); this.hooks?.assistant?.({ ...m.payload, received: Date.now() }); })
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
    // (claimed on its own clock — not behind the commands before it here, which another page of
    // this device may be the one running — then run in order)
    const claimed = this.claim(cmd).catch((err) => { console.warn("assist: claim", err); return false; });
    this.queue = this.queue.then(async () => { if (await claimed) await this.run1(cmd); }).catch((err) => console.warn("assist: command", err));
  },
  // Claimed by one page (another tab of this device may have it too): the row's result is set only
  // where it's still empty. Another page of this device first when this one can't run it (3 s) or
  // isn't in front (shown: 0.7 s, hidden: 1.5 s) — the assistant waits 12 s for an answer.
  async claim(cmd) {
    const c = this.ctx;
    if (!stillMine(c)) return false;
    const can = this.hooks?.handles?.(cmd.action) !== false;
    const lag = (can ? 0 : 3000) + (this.inFront() ? 0 : document.hidden ? 1500 : 700);
    if (lag) await new Promise((r) => setTimeout(r, lag));
    if (!stillMine(c)) return false;
    const { data: claimed } = await c.sb.from("device_commands").update({ result: { claimed: this.tab } }).eq("id", cmd.id).eq("status", "sent").is("result", null).select("id");
    return !!claimed?.length;
  },
  async run1(cmd) {
    const c = this.ctx;
    if (!stillMine(c)) return;
    const answer = (status, result) => c.sb.from("device_commands").update({ status, result, updated_at: new Date().toISOString() }).eq("id", cmd.id);
    if (!this.on) return answer("failed", { error: "Remote control is off on this device." });
    // Something that starts sound or the mic is only done right away, never long after it was asked.
    const starts = ["listen", "play_take", "sing", "loop_line", "score_play"].includes(cmd.action);
    if (Date.now() - Date.parse(cmd.at) > (starts ? 15000 : 60000)) return answer("expired", { error: "It came too late — ask again." });
    if (document.hidden && ["sing", "loop_line"].includes(cmd.action)) return answer("failed", { error: "The page isn't in front on this device — bring it up and ask again." });
    this.takeFront(); // (the page that ran it says what the device shows now)
    let r;
    try { r = (await this.hooks.run(cmd.action, cmd.args || {})) || { ok: true }; }
    catch (err) { r = { ok: false, error: err.message || String(err) }; }
    await answer(r.ok === false ? "failed" : "done", r);
    this.changedSoon(true);
  },
};

// The switch's button (the shell's top bar, Sing's): the AI mark is in the page's markup (AI_MARK);
// lit while on, hidden unless offered (remote.available).
export const REMOTE_LABEL = "Let an assistant control this device";
export function paintRemote(btn, on) {
  if (!btn) return;
  btn.hidden = !remote.available;
  btn.dataset.on = String(!!on);
  btn.title = on ? "An assistant can control this device — tap to stop" : REMOTE_LABEL;
  btn.setAttribute("aria-label", REMOTE_LABEL);
  btn.setAttribute("aria-pressed", String(!!on));
}
// The AI button's mark: the letters A and I (a serifed I: never read "Al"), drawn in currentColor.
// The same markup is in index.html, sing.html and play.html (tools/shellplaces.cjs checks it).
export const AI_MARK = '<svg class="ai-mark" viewBox="0 0 20 16" aria-hidden="true" focusable="false"><path d="M1.5 14.5 6.5 1.5l5 13M3.25 10h6.5M13.5 1.5h5M16 1.5v13M13.5 14.5h5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

window.resonateAssist = () => ({ device: device(), remote: { available: remote.available, cloud: remote.cloud, checked: remote.checked, assistant: remote.assistant, on: remote.on, seen: seenAll() }, queued: later.length });
