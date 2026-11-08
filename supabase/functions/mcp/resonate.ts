// Resonate's MCP tools: what an assistant may read (songs, takes, coaching, progress, voice
// profile, devices) and the one tool that acts in the open app (control_resonate). Every query
// runs as the signed-in user, so RLS decides (supabase/migrations/…_assistants.sql): an
// assistant reads only its own account's data and can't write anything but commands.
import type { SupabaseClient } from "@supabase/supabase-js";

type Sb = SupabaseClient;
type Json = Record<string, unknown>;

export const INSTRUCTIONS = `Resonate is the user's singing-practice app (karaoke against sheet music; it grades each note's pitch and timing and gives its own coaching).
You are a singing coach working from Resonate's data:
- Lead with what went well, then one or two concrete things to try, each with a way to hear or practise it (e.g. "listen to line 3", "loop line 3").
- Never read scores, percentages or cents out as grades. The numbers are for your reasoning only; speak in musical terms (a touch flat, came in late, held it short).
- Lines are numbered from 1, as the user sees them. Notes are written in the key the user sang (target) with the note actually sung.
- During a take, call get_live_lines repeatedly (after_line = the last line you've seen) to follow along line by line.
- control_resonate acts in the app on the device whose 📡 Remote switch is on (Sing page). If nothing has it on, ask the user to tap 📡 on the device they're using. Starting sound or the microphone may need one tap on that device first (browsers require it).`;

const LIB_ID = /^s[0-9a-z]{6,}$/; // songs imported into My songs; anything else is a bundled sample
const ONLINE_MS = 75000;
const LIVE_MS = 120000;

export const ok = (obj: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(obj) }] });
export const fail = (message: string, extra: Json = {}) => ({ content: [{ type: "text" as const, text: JSON.stringify({ error: message, ...extra }) }], isError: true });

function ago(ts: string | number | null | undefined): string | null {
  if (!ts) return null;
  const s = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export async function approved(sb: Sb): Promise<boolean> {
  const { data } = await sb.from("accounts").select("approved").maybeSingle();
  return !!data?.approved;
}

interface SongRef { id: string; title: string; library: boolean }
// Every song the account knows: My songs (synced) and any song or sample the app has shared.
async function songs(sb: Sb): Promise<SongRef[]> {
  const [lib, scores] = await Promise.all([
    sb.from("sync_items").select("id,data,deleted").eq("kind", "song"),
    sb.from("song_scores").select("song_id,title:data->>title"),
  ]);
  const out = new Map<string, SongRef>(), gone = new Set<string>();
  for (const r of lib.data || []) { if (r.deleted) gone.add(r.id); else out.set(r.id, { id: r.id, title: String((r.data as Json)?.title ?? r.id), library: true }); }
  for (const r of scores.data || []) if (!out.has(r.song_id) && !gone.has(r.song_id)) out.set(r.song_id, { id: r.song_id, title: String(r.title ?? r.song_id), library: LIB_ID.test(r.song_id) });
  return [...out.values()];
}
async function findSong(sb: Sb, q: string): Promise<SongRef | null> {
  const want = q.trim().toLowerCase();
  if (!want) return null;
  const all = await songs(sb);
  return all.find((s) => s.id.toLowerCase() === want) || all.find((s) => s.title.toLowerCase() === want) || all.find((s) => s.title.toLowerCase().includes(want)) || null;
}

export async function listSongs(sb: Sb) {
  const [all, takes] = await Promise.all([songs(sb), sb.from("coach_takes").select("song_id,started_at").order("started_at", { ascending: false }).limit(200)]);
  const last = new Map<string, string>(), count = new Map<string, number>();
  for (const t of takes.data || []) { if (!last.has(t.song_id)) last.set(t.song_id, t.started_at); count.set(t.song_id, (count.get(t.song_id) || 0) + 1); }
  return ok({ songs: all.map((s) => ({ song: s.id, title: s.title, mine: s.library, last_sung: ago(last.get(s.id)), recent_takes: count.get(s.id) || 0 }))
    .sort((a, b) => (b.recent_takes - a.recent_takes) || a.title.localeCompare(b.title)) });
}

export async function getSong(sb: Sb, q: string) {
  const s = await findSong(sb, q);
  if (!s) return fail(`No song like “${q}”.`, { songs: (await songs(sb)).map((x) => x.title) });
  const { data } = await sb.from("song_scores").select("data,updated_at").eq("song_id", s.id).maybeSingle();
  if (!data) return fail(`“${s.title}” hasn't been opened in Resonate since assistants were connected — open it once (any device) and ask again.`);
  const d = data.data as Json;
  return ok({
    song: s.id, title: d.title, key: d.key, tempo: d.tempo, bpm: d.bpm, meter: d.meter, range: d.range, verse: d.verse, verses: d.verses,
    legend: "notes: [note (in the key shown), length in quarter notes, syllable (_ = held from the previous note)]",
    lines: ((d.lines as Json[]) || []).map((l) => ({ line: Number(l.li) + 1, text: l.text, at_s: l.at, notes: l.notes })),
    read: ago(data.updated_at),
  });
}

const takeStatus = (t: Json) => (t.status === "live" && Date.now() - new Date(String(t.updated_at)).getTime() > LIVE_MS ? "unfinished" : t.status);
function takeHead(t: Json, title?: string) {
  const m = (t.meta as Json) || {};
  return { take: t.id, song: t.song_id, title: title ?? m.title, when: ago(String(t.started_at)), at: t.started_at, status: takeStatus(t), key: m.key, tempo: m.tempo, verse: m.verse, guide: m.guide };
}

export async function listTakes(sb: Sb, q: string | undefined, limit: number) {
  let song: SongRef | null = null;
  if (q) { song = await findSong(sb, q); if (!song) return fail(`No song like “${q}”.`); }
  let req = sb.from("coach_takes").select("id,song_id,status,started_at,updated_at,meta,headline:review->>headline").order("started_at", { ascending: false }).limit(Math.min(Math.max(limit || 10, 1), 30));
  if (song) req = req.eq("song_id", song.id);
  const { data, error } = await req;
  if (error) return fail(error.message);
  return ok({ takes: (data || []).map((t) => ({ ...takeHead(t as Json), headline: (t as Json).headline ?? null })) });
}

const LINE_LEGEND = "notes: [target note, note sung (null = not heard), cents off the target (+ sharp), grade (good|ok|off|missed|unclear|unsung), timing in ms (+ late), syllable (_ = held)]; steps: Resonate's own next steps for the line";
const lineOut = (l: Json) => {
  const d = (l.data as Json) || {};
  return { line: Number(l.li) + 1, text: d.text, final: l.final, steps: d.steps || [], went_well: !!d.ok, notes: d.notes || [], octave: d.octave || 0 };
};

async function resolveTake(sb: Sb, take: string | undefined, q: string | undefined): Promise<Json | null> {
  let req = sb.from("coach_takes").select("id,song_id,status,started_at,updated_at,meta,review").order("started_at", { ascending: false }).limit(1);
  if (take && take !== "latest") req = sb.from("coach_takes").select("id,song_id,status,started_at,updated_at,meta,review").eq("id", take).limit(1);
  else if (q) { const s = await findSong(sb, q); if (!s) return null; req = req.eq("song_id", s.id); }
  const { data } = await req;
  return (data?.[0] as Json) || null;
}

export async function getTake(sb: Sb, take: string | undefined, q: string | undefined) {
  const t = await resolveTake(sb, take, q);
  if (!t) return fail("No take found.");
  const { data: lines } = await sb.from("coach_lines").select("li,final,data").eq("take_id", t.id).order("li");
  return ok({ ...takeHead(t), review: t.review ?? null, legend: LINE_LEGEND, lines: (lines || []).map((l) => lineOut(l as Json)) });
}

// Long-poll: the lines of the live (else latest) take after `after`, waiting up to `wait` s for one.
export async function getLiveLines(sb: Sb, after: number, wait: number, take?: string) {
  const deadline = Date.now() + Math.min(Math.max(wait || 0, 0), 20) * 1000;
  let t: Json | null = null;
  for (;;) {
    if (!t || take) t = await resolveTake(sb, take, undefined);
    else { const id = String(t.id); const res: { data: unknown } = await sb.from("coach_takes").select("id,song_id,status,started_at,updated_at,meta,review").eq("id", id).maybeSingle(); t = (res.data as Json) || t; }
    if (!t) return fail("No take yet.");
    const { data: lines } = await sb.from("coach_lines").select("li,final,data").eq("take_id", t.id).gte("li", Math.max(0, Math.floor(after || 0))).order("li");
    const status = takeStatus(t);
    if ((lines && lines.length) || status !== "live" || Date.now() >= deadline) {
      const out = (lines || []).map((l) => lineOut(l as Json));
      return ok({ ...takeHead(t), review: status === "live" ? null : t.review ?? null, legend: LINE_LEGEND, lines: out,
        next_after_line: out.length ? Math.max(...out.map((l) => l.line)) : Math.floor(after || 0), lines_in_song: (t.meta as Json)?.lines ?? null });
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export async function getProgress(sb: Sb, q: string) {
  const s = await findSong(sb, q);
  if (!s) return fail(`No song like “${q}”.`);
  const { data } = await sb.from("sync_items").select("data").eq("kind", "song_state").eq("id", `${s.id}|history`).eq("deleted", false).maybeSingle();
  const list = ((data?.data as Json)?.list as Json[]) || [];
  return ok({ song: s.id, title: s.title, note: "Scores are 0–1, for your reasoning only — never say them as grades.",
    takes: list.slice(-20).map((h) => {
      const rh = (h.rhythm as Json) || null;
      return { when: ago(Number(h.at)), at: new Date(Number(h.at)).toISOString(), score: h.pct, whole_song: h.whole !== false,
        line_scores: ((h.lines as unknown[]) || []).map((score, i) => ({ line: i + 1, score })),
        rhythm: rh ? { ...rh, obs: ((rh.obs as Json[]) || []).map(({ li, ...o }) => ({ ...o, ...(typeof li === "number" ? { line: li + 1 } : {}) })) } : null };
    }) });
}

export async function getVoiceProfile(sb: Sb) {
  const { data } = await sb.from("sync_items").select("kind,id,data").in("kind", ["profile", "prefs"]).eq("deleted", false);
  const prefs = (data || []).find((r) => r.kind === "prefs")?.data as Json | undefined;
  const midi = (m: unknown) => { if (typeof m !== "number") return null; const n = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"][((m % 12) + 12) % 12]; return `${n}${Math.floor(m / 12) - 1}`; };
  return ok({ profiles: (data || []).filter((r) => r.kind === "profile").map((r) => {
    const d = (r.data as Json) || {}, rg = (d.range as Json) || null;
    return { id: r.id, name: d.name, active: prefs?.activeProfile === r.id,
      range: rg ? { lowest: midi(rg.low), highest: midi(rg.high), comfortable: `${midi(rg.comfortLow)}–${midi(rg.comfortHigh)}`, measured: rg.at ? ago(Number(rg.at)) : "preset" } : null };
  }) });
}

const online = (d: Json) => Date.now() - new Date(String(d.seen_at)).getTime() < ONLINE_MS && (d.state as Json)?.visible !== false && !(d.state as Json)?.left;
export async function getStatus(sb: Sb) {
  const [dev, live] = await Promise.all([
    sb.from("devices").select("id,name,remote,seen_at,state").order("seen_at", { ascending: false }),
    sb.from("coach_takes").select("id,song_id,status,started_at,updated_at,meta").eq("status", "live").order("started_at", { ascending: false }).limit(1),
  ]);
  const devices = (dev.data || []).map((d) => ({ device: d.id, name: d.name, remote_on: d.remote, online: online(d as Json), seen: ago(d.seen_at), showing: d.state }));
  const remote = devices.find((d) => d.remote_on);
  const lt = live.data?.[0] as Json | undefined;
  return ok({
    devices,
    remote_device: remote ? remote.name : null,
    hint: remote ? (remote.online ? null : `${remote.name} has 📡 Remote on but isn't in front right now (closed, in the background or asleep) — commands wait until it is.`)
      : "No device has 📡 Remote on — ask the user to tap 📡 on the Sing page of the device they're using.",
    live_take: lt && takeStatus(lt) === "live" ? takeHead(lt) : null,
  });
}

export const ACTIONS = ["open_song", "set_key", "set_tempo", "listen", "play_take", "sing", "loop_line", "go_to_line", "review", "stop"] as const;
export async function control(sb: Sb, args: Json) {
  const { data: devs } = await sb.from("devices").select("id,name,remote,seen_at,state").eq("remote", true).limit(1);
  const d = devs?.[0] as Json | undefined;
  if (!d) return fail("No device has 📡 Remote on. Ask the user to tap 📡 on the Sing page of the device they're using.");
  const { action, ...rest } = args;
  const clean: Json = {};
  for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== null) clean[k] = v;
  // The song resolved here, so the page gets an exact id (not its own guess at the title).
  if (action === "open_song" && clean.song) {
    const s = await findSong(sb, String(clean.song));
    if (!s) return fail(`No song like “${clean.song}”.`, { songs: (await songs(sb)).map((x) => x.title) });
    clean.song = s.id;
  }
  const { data: cmd, error } = await sb.from("device_commands").insert({ device_id: d.id, action, args: clean }).select("id").single();
  if (error || !cmd) return fail(`Couldn't send it: ${error?.message ?? "no answer"}`);
  const until = Date.now() + 12000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 400));
    const { data: row } = await sb.from("device_commands").select("status,result").eq("id", cmd.id).maybeSingle();
    if (row && row.status !== "sent") {
      const r = (row.result as Json) || {};
      return row.status === "done" ? ok({ done: action, on: d.name, ...r }) : fail(String(r.error ?? row.status), { on: d.name, ...r });
    }
  }
  const starts = ["listen", "play_take", "sing", "loop_line"].includes(String(action));
  return ok({ sent: action, on: d.name, note: online(d) ? "No answer yet — it may still be loading."
    : starts ? `${d.name} isn't in front right now — this won't start later; ask again once it is.` : `${d.name} isn't in front right now; it will do this when it is (within a minute).` });
}
