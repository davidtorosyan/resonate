// Resonate's MCP tools: what an assistant may read (songs, takes, coaching, progress, voice
// profile, devices) and the one tool that acts in the open app (control_resonate). Every query
// runs as the signed-in user, so RLS decides (supabase/migrations/…_assistants.sql): an
// assistant reads only its own account's data and can't write anything but commands.
import type { SupabaseClient } from "@supabase/supabase-js";
import { PLAYBOOK, REMINDER } from "./coaching.ts";
import { action as findAction, capabilitiesBrief, capabilitiesData, checkParams, gather, query as findQuery, ACTIONS, QUERIES, type QueryName } from "./catalog.ts";
import { PDFDocument } from "pdf-lib";

type Sb = SupabaseClient;
type Json = Record<string, unknown>;

export const INSTRUCTIONS = `Resonate is the user's singing-practice app (karaoke against sheet music; it grades each note's pitch and timing from the microphone and writes its own coaching).
When the user mentions Resonate, wants to practise singing, or asks for a vocal or singing coach, call start_vocal_coaching first: it gives you the coaching playbook to follow for the rest of the conversation, and what Resonate shows right now.
The core rules, always: Resonate's data is the only judge of the singing — never judge it from what you hear; fetch it (get_take, get_live_lines) before saying anything about a take. Whenever the user wants to sing, call control_resonate with action "sing" — never just say "go ahead". Never read scores, percentages or cents out as grades.
Sheet music (separate from coaching; the singing rules don't apply): Resonate's Score shows a song as sheet music, often read by OCR from the user's PDF. get_score_view = what the Score shows and the bars the user highlighted (their notes as text, a picture of the drawn bars, the same bars on the original PDF with a red border); get_score_xml and get_score_pdf = the song's own files. Use them for questions about the music and its transcription ("is this bar read right?": compare the PDF picture with the notes, bar by bar, and say exactly what differs). control_resonate's score_* actions move, highlight and play the Score.
Resonate gains abilities without new tools: get_capabilities lists every control_resonate action and read_resonate query it has now, with their parameters. Call it when the user asks for something no tool here obviously covers, or when an action is refused as unknown.`;

// How takes an assistant starts go (Assistants page): the "Get ready" countdown before them.
export async function settings(sb: Sb) {
  const { data } = await sb.from("assistant_settings").select("start_delay_s").maybeSingle();
  return { start_delay_s: data?.start_delay_s ?? 4 };
}
// Records the call (Resonate shows which assistant is active) → the assistant's name.
export async function seen(sb: Sb, tool: string): Promise<string> {
  try { const { data } = await sb.rpc("assistant_seen", { tool }); return String((data as Json)?.name || "Assistant"); } catch { return "Assistant"; }
}

const LIB_ID = /^s[0-9a-z]{6,}$/; // songs imported into My songs; anything else is a bundled sample
const ONLINE_MS = 75000;
const LIVE_MS = 120000;

// Every answer ends with the coaching playbook's core rules (in a long voice chat the playbook
// itself, read once at the start, fades).
export const ok = (obj: Json) => ({ content: [{ type: "text" as const, text: JSON.stringify({ ...obj, reminder: REMINDER }) }] });
export const fail = (message: string, extra: Json = {}) => ({ content: [{ type: "text" as const, text: JSON.stringify({ error: message, ...extra, reminder: REMINDER }) }], isError: true });
// The sheet-music tools' answers: no coaching reminder (they're about the music, not the singing).
type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string } | { type: "resource"; resource: { uri: string; mimeType: string; blob: string } };
export const okData = (obj: Json, more: Content[] = []) => ({ content: [{ type: "text" as const, text: JSON.stringify(obj) } as Content, ...more] });
export const failData = (message: string, extra: Json = {}) => ({ content: [{ type: "text" as const, text: JSON.stringify({ error: message, ...extra }) }], isError: true });

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
  // (the take just asked for hasn't begun: this one is the take before it)
  const before = (!take || take === "latest") && !q && await pendingSing(sb, t) ? { previous_take: true, note: "This is the take BEFORE the one you just started, which hasn't begun (or didn't start). Don't give feedback on it as if just sung." } : {};
  const { data: lines } = await sb.from("coach_lines").select("li,final,data").eq("take_id", t.id).order("li");
  return ok({ ...takeHead(t), ...before, review: t.review ?? null, legend: LINE_LEGEND, lines: (lines || []).map((l) => lineOut(l as Json)) });
}

// A take an assistant started in the last two minutes that hasn't begun yet (countdown, the
// microphone opening, or cancelled): the latest take is still the one from before the sing
// command (its id is kept with the command), so "the latest take" isn't the one just asked for.
// → "waiting" (the device is counting down / opening the mic), "didnt_start" (it's idle again:
// cancelled, or the mic refused) or null (no such take: the latest take is the one to use).
async function pendingSing(sb: Sb, latest: Json | null): Promise<"waiting" | "didnt_start" | null> {
  const { data } = await sb.from("device_commands").select("args,device_id").eq("action", "sing").eq("status", "done").gte("created_at", new Date(Date.now() - 120000).toISOString()).order("created_at", { ascending: false }).limit(1);
  const c = data?.[0], a = (c?.args as Json) || null;
  if (!a || !("prev_take" in a) || (a.prev_take ?? null) !== ((latest?.id as string) ?? null)) return null;
  const { data: dev } = await sb.from("devices").select("state").eq("id", String(c!.device_id)).maybeSingle();
  const doing = String(((dev?.state as Json) || {}).doing ?? "");
  return ["get-ready", "starting", "sing"].includes(doing) ? "waiting" : "didnt_start";
}
const NOT_STARTED = { status: "not_started", take: null, note: "The take you started hasn't begun yet (the countdown, or the microphone opening). Stay silent and call get_live_lines again." };
const DIDNT_START = { status: "didnt_start", take: null, note: "The take you started didn't begin (cancelled on the page, or the microphone didn't open). Call get_status, then offer to start it again." };

// Long-poll: the lines of the live (else latest) take after `after`, waiting up to `wait` s for one.
// Without a take id, a take just asked for is waited for (not the previous one returned).
export async function getLiveLines(sb: Sb, after: number, wait: number, take?: string) {
  const deadline = Date.now() + Math.min(Math.max(wait || 0, 0), 20) * 1000;
  let t: Json | null = null;
  for (;;) {
    if (!t || take) t = await resolveTake(sb, take, undefined);
    else { const id = String(t.id); const res: { data: unknown } = await sb.from("coach_takes").select("id,song_id,status,started_at,updated_at,meta,review").eq("id", id).maybeSingle(); t = (res.data as Json) || t; }
    const pend = take ? null : await pendingSing(sb, t);
    if (pend === "didnt_start") return ok(DIDNT_START);
    if (pend === "waiting") {
      if (Date.now() >= deadline) return ok(NOT_STARTED);
      t = null;
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
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

async function profilesData(sb: Sb) {
  const { data } = await sb.from("sync_items").select("kind,id,data").in("kind", ["profile", "prefs"]).eq("deleted", false);
  const prefs = (data || []).find((r) => r.kind === "prefs")?.data as Json | undefined;
  const midi = (m: unknown) => { if (typeof m !== "number") return null; const n = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"][((m % 12) + 12) % 12]; return `${n}${Math.floor(m / 12) - 1}`; };
  return (data || []).filter((r) => r.kind === "profile").map((r) => {
    const d = (r.data as Json) || {}, rg = (d.range as Json) || null;
    return { id: r.id, name: d.name, active: prefs?.activeProfile === r.id,
      range: rg ? { lowest: midi(rg.low), highest: midi(rg.high), comfortable: `${midi(rg.comfortLow)}–${midi(rg.comfortHigh)}`, measured: rg.at ? ago(Number(rg.at)) : "preset" } : null };
  });
}
export async function getVoiceProfile(sb: Sb) {
  return ok({ profiles: await profilesData(sb) });
}

const online = (d: Json) => Date.now() - new Date(String(d.seen_at)).getTime() < ONLINE_MS && (d.state as Json)?.visible !== false && !(d.state as Json)?.left;
async function statusData(sb: Sb) {
  const [dev, live, st] = await Promise.all([
    sb.from("devices").select("id,name,remote,seen_at,state").order("seen_at", { ascending: false }),
    sb.from("coach_takes").select("id,song_id,status,started_at,updated_at,meta").eq("status", "live").order("started_at", { ascending: false }).limit(1),
    settings(sb),
  ]);
  const devices = (dev.data || []).map((d) => ({ device: d.id, name: d.name, remote_on: d.remote, online: online(d as Json), seen: ago(d.seen_at), showing: d.state }));
  const remote = devices.find((d) => d.remote_on);
  const lt = live.data?.[0] as Json | undefined;
  return {
    devices,
    remote_device: remote ? remote.name : null,
    hint: remote ? (remote.online ? null : `${remote.name} has its AI button on but isn't in front right now (closed, in the background or asleep) — commands wait until it is.`)
      : "No device has its AI button on — ask the user to tap the AI button at the top of Resonate on the device they're using.",
    live_take: lt && takeStatus(lt) === "live" ? takeHead(lt) : null,
    ...st,
    capabilities: capabilitiesBrief(),
  };
}
export async function getStatus(sb: Sb) {
  return ok(await statusData(sb));
}

// The coach: the playbook and everything it starts from — what the page shows, the voice
// profile, the last few takes.
export async function startCoaching(sb: Sb) {
  const [st, profiles, takes] = await Promise.all([
    statusData(sb),
    profilesData(sb),
    sb.from("coach_takes").select("id,song_id,status,started_at,updated_at,meta,headline:review->>headline").order("started_at", { ascending: false }).limit(3),
  ]);
  const sid = ((st.devices.find((d) => d.remote_on)?.showing as Json)?.song as Json)?.id;
  let song: Json | null = null;
  if (sid) {
    const { data } = await sb.from("song_scores").select("data").eq("song_id", String(sid)).maybeSingle();
    const d = (data?.data as Json) || null;
    if (d) song = { song: sid, title: d.title, key: d.key, tempo: d.tempo, meter: d.meter, range: d.range, lines: ((d.lines as Json[]) || []).length };
  }
  return ok({ playbook: PLAYBOOK, now: { ...st, song, voice_profiles: profiles, recent_takes: (takes.data || []).map((t) => ({ ...takeHead(t as Json), headline: (t as Json).headline ?? null })) } });
}

// An action of the catalogue (catalog.ts), sent to the device whose AI button is on. The input is
// the tool call's fields plus its args object; only the parameters the action takes go to the page.
export async function control(sb: Sb, input: Json, by = "Assistant") {
  const found = findAction(input.action);
  const scoreAct = found ? !!found.entry.score : String(input.action ?? "").startsWith("score_");
  const no = scoreAct ? failData : fail, yes = scoreAct ? okData : ok;
  if (!found) {
    return no(`No action “${String(input.action ?? "")}”.`, { actions: Object.keys(ACTIONS), details: "get_capabilities describes each action and its parameters." });
  }
  const { name: action, entry } = found;
  const checked = checkParams(action, entry, gather(input, ["action"]));
  if ("error" in checked) return no(checked.error, { details: "get_capabilities lists each action's parameters." });
  const ignored = checked.ignored.length ? { ignored_params: checked.ignored } : {};
  const { data: devs } = await sb.from("devices").select("id,name,remote,seen_at,state").eq("remote", true).limit(1);
  const d = devs?.[0] as Json | undefined;
  if (!d) return no("No device has its AI button on. Ask the user to tap the AI button at the top of Resonate on the device they're using.");
  const clean: Json = { ...checked.args, by };
  const st = await settings(sb);
  if (action === "sing") {
    clean.delay = st.start_delay_s;
    // (which take was the latest when this was sent: get_live_lines waits for a newer one)
    const { data: lt } = await sb.from("coach_takes").select("id").order("started_at", { ascending: false }).limit(1);
    clean.prev_take = (lt?.[0]?.id as string) ?? null;
  }
  // The song resolved here, so the page gets an exact id (not its own guess at the title).
  if ((action === "open_song" || action === "score_open") && clean.song) {
    const s = await findSong(sb, String(clean.song));
    if (!s) return no(`No song like “${clean.song}”.`, { songs: (await songs(sb)).map((x) => x.title) });
    clean.song = s.id;
  }
  const { data: cmd, error } = await sb.from("device_commands").insert({ device_id: d.id, action, args: clean }).select("id").single();
  if (error || !cmd) return no(`Couldn't send it: ${error?.message ?? "no answer"}`);
  const until = Date.now() + 12000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 400));
    const { data: row } = await sb.from("device_commands").select("status,result").eq("id", cmd.id).maybeSingle();
    if (row && row.status !== "sent") {
      const r = (row.result as Json) || {};
      const say = action === "sing" ? { now: `${st.start_delay_s ? `Starts in ${st.start_delay_s} s (a "Get ready" countdown, then the count-in)` : "Starts now with the count-in"}. Say a word at most — then stay quiet until the take ends.` } : {};
      return row.status === "done" ? yes({ done: action, on: d.name, ...r, ...say, ...ignored }) : no(String(r.error ?? row.status), { on: d.name, ...r, ...ignored });
    }
  }
  return yes({ sent: action, on: d.name, ...ignored, note: online(d) ? "No answer yet — it may still be loading."
    : entry.starts ? `${d.name} isn't in front right now — this won't start later; ask again once it is.` : `${d.name} isn't in front right now; it will do this when it is (within a minute).` });
}

// What get_capabilities answers: every action and query, live (the tool list itself never changes).
export function capabilities() {
  return okData(capabilitiesData());
}

// read_resonate: a query of the catalogue, by name ("status") or by its tool's name ("get_status").
const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
const READERS = {
  status: (sb) => getStatus(sb),
  coaching: (sb) => startCoaching(sb),
  songs: (sb) => listSongs(sb),
  song: (sb, a) => getSong(sb, String(a.song)),
  takes: (sb, a) => listTakes(sb, str(a.song), Number(a.limit ?? 10)),
  take: (sb, a) => getTake(sb, str(a.take), str(a.song)),
  live_lines: (sb, a) => getLiveLines(sb, Number(a.after_line ?? 0), Number(a.wait_seconds ?? 15), str(a.take)),
  progress: (sb, a) => getProgress(sb, String(a.song)),
  voice_profile: (sb) => getVoiceProfile(sb),
  score_view: (sb) => getScoreView(sb),
  score_xml: (sb, a) => getScoreXml(sb, String(a.song), a.from_measure as number | string | undefined, a.to_measure as number | string | undefined, str(a.part)),
  score_pdf: (sb, a) => getScorePdf(sb, String(a.song), a.page as number | undefined),
  capabilities: () => Promise.resolve(capabilities()),
} satisfies Record<QueryName, (sb: Sb, a: Json) => Promise<unknown>>;
export function queryName(what: unknown): string {
  return findQuery(what)?.name ?? String(what ?? "");
}
export async function read(sb: Sb, input: Json) {
  const found = findQuery(input.what);
  if (!found) return failData(`Nothing called “${String(input.what ?? "")}” to read.`, { what: Object.keys(QUERIES), details: "get_capabilities describes each and its parameters." });
  const checked = checkParams(`read_resonate “${found.name}”`, found.entry, gather(input, ["what"]));
  if ("error" in checked) return (found.entry.score ? failData : fail)(checked.error, { details: "get_capabilities lists each query's parameters." });
  return await READERS[found.name](sb, checked.args);
}

// --- Sheet music: the Score on the user's devices, what they highlighted, the song's own files ------

const XML_CAP = 60000; // chars of measures in one get_score_xml answer
const PDF_CAP = 8 * 1024 * 1024;

// The song's row in the synced library (its files' paths), or why there's none.
async function songFiles(sb: Sb, q: string): Promise<{ s: SongRef; data: Json } | { error: string; extra?: Json }> {
  const s = await findSong(sb, q);
  if (!s) return { error: `No song like “${q}”.`, extra: { songs: (await songs(sb)).map((x) => x.title) } };
  const { data } = await sb.from("sync_items").select("data").eq("kind", "song").eq("id", s.id).eq("deleted", false).maybeSingle();
  if (!data?.data) {
    return { error: LIB_ID.test(s.id)
      ? `“${s.title}” isn't in the user's cloud (sync off on its device, the cloud full, or not uploaded yet) — its files can't be read from here.`
      : `“${s.title}” is one of Resonate's bundled samples: it has no files in the user's cloud (get_song has its melody).` };
  }
  return { s, data: data.data as Json };
}
async function download(sb: Sb, path: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const { data, error } = await sb.storage.from("songs").download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}
async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
}
function b64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const PART_RE = /<part(?=[\s>])[^>]*>[\s\S]*?<\/part>/g;
const MEASURE_RE = /<measure(?=[\s>])[^>]*>[\s\S]*?<\/measure>/g;
// The divisions, key, time and clefs in effect after these measures (raw elements, one line).
function inEffect(measures: string[]): string {
  const last: Record<string, string> = {};
  for (const ms of measures) {
    for (const a of ms.match(/<attributes>[\s\S]*?<\/attributes>/g) || []) {
      for (const tag of ["divisions", "key", "time", "transpose"]) {
        const x = a.match(new RegExp(`<${tag}(?=[\\s>])[^>]*>[\\s\\S]*?</${tag}>`));
        if (x) last[tag] = x[0];
      }
      for (const c of a.match(/<clef(?=[\s>])[^>]*>[\s\S]*?<\/clef>/g) || []) last["clef" + (/number="(\d+)"/.exec(c)?.[1] || "1")] = c;
    }
  }
  return Object.values(last).join(" ").replace(/\s*\n\s*/g, " ").replace(/--/g, "- -");
}

export async function getScoreXml(sb: Sb, q: string, from?: number | string, to?: number | string, part?: string) {
  const f = await songFiles(sb, q);
  if ("error" in f) return failData(f.error, f.extra);
  const path = (f.data.xml as Json)?.path;
  const gz = typeof path === "string" ? await download(sb, path) : null;
  if (!gz) return failData(`“${f.s.title}”'s MusicXML file isn't in the cloud.`);
  const xml = await gunzip(gz);
  const head = xml.slice(0, xml.search(/<part(?=[\s>])/));
  const names = new Map<string, string>();
  for (const m of head.matchAll(/<score-part[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/score-part>/g)) names.set(m[1], (/<part-name[^>]*>([^<]*)<\/part-name>/.exec(m[2])?.[1] || "").trim());
  const parts = [...xml.matchAll(PART_RE)].map((m) => {
    const open = /^<part(?=[\s>])[^>]*>/.exec(m[0])![0];
    const id = /\bid="([^"]*)"/.exec(open)?.[1] || "";
    return { id, name: names.get(id) || id, open, ms: m[0].match(MEASURE_RE) || [] };
  });
  if (!parts.length) return failData("That file has no parts (not MusicXML partwise?).");
  const numbers = parts[0].ms.map((m, i) => /\bnumber="([^"]*)"/.exec(m)?.[1] ?? String(i + 1));
  const find = (x: number | string | undefined, start = 0) => {
    if (x === undefined || x === null || x === "") return null;
    const s = String(x).trim();
    let i = numbers.indexOf(s, start);
    if (i < 0) i = numbers.indexOf(s);
    return i >= 0 ? i : -1;
  };
  let a = find(from), b = find(to, Math.max(0, a ?? 0));
  const range = `bars ${numbers[0]}–${numbers[numbers.length - 1]}`;
  if (a === -1) return failData(`No measure numbered “${from}” (${range}).`);
  if (b === -1) return failData(`No measure numbered “${to}” (${range}).`);
  a ??= 0;
  b ??= numbers.length - 1; // (from alone: to the end, cut at the cap)
  if (b < a) [a, b] = [b, a];
  let keep = parts;
  if (part) {
    const w = part.trim().toLowerCase();
    keep = parts.filter((p) => p.id.toLowerCase() === w || p.name.toLowerCase().includes(w));
    if (!keep.length) return failData(`No part like “${part}”.`, { parts: parts.map((p) => ({ id: p.id, name: p.name })) });
  }
  // measures until the cap (every part kept has the same bars)
  let end = a, size = 0;
  while (end <= b) {
    const add = keep.reduce((n, p) => n + (p.ms[end]?.length || 0), 0);
    if (end > a && size + add > XML_CAP) break;
    size += add;
    end++;
  }
  const cut = end <= b;
  let body = "";
  for (const p of keep) {
    const carry = a > 0 ? inEffect(p.ms.slice(0, a)) : "";
    body += `${p.open}\n${carry ? `<!-- in effect from earlier bars: ${carry} -->\n` : ""}${p.ms.slice(a, end).join("\n")}\n</part>\n`;
  }
  const tail = xml.slice(xml.lastIndexOf("</part>") + "</part>".length);
  const out = head + body + tail.trimStart();
  return okData({
    song: f.s.id, title: f.s.title,
    file: "The song's MusicXML as stored in Resonate (for a PDF import: Audiveris's reading of the PDF after Resonate's import clean-ups). The XML follows as the next content item.",
    parts: parts.map((p) => ({ id: p.id, name: p.name, measures: p.ms.length })),
    measures_in_file: `${numbers.length} (${range}; numbers as written in the file)`,
    shown: { from: numbers[a], to: numbers[end - 1], part: part ? keep.map((p) => p.id) : "all" },
    ...(cut ? { more: `Cut at ${XML_CAP} characters: ask again with from_measure ${numbers[end]} for the rest (or fewer bars, or one part).`, next_from_measure: numbers[end] } : {}),
  }, [{ type: "text", text: out }]);
}

export async function getScorePdf(sb: Sb, q: string, page?: number) {
  const f = await songFiles(sb, q);
  if ("error" in f) return failData(f.error, f.extra);
  const path = (f.data.pdf as Json)?.path;
  if (typeof path !== "string") return failData(`“${f.s.title}” has no PDF in the cloud (only songs read from a PDF with PDF → Song keep one; a PDF that didn't go up stays on its device).`);
  const bytes = await download(sb, path);
  if (!bytes) return failData(`“${f.s.title}”'s PDF isn't in the cloud.`);
  let src: PDFDocument;
  try { src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }); } catch (err) { return failData(`The PDF couldn't be read: ${(err as Error).message}`); }
  const pages = src.getPageCount();
  // (no page asked: the one the user's highlight is on, else the first)
  let p = page, why = "asked";
  if (!p) {
    const { data: fc } = await sb.from("score_focus").select("data").eq("song_id", f.s.id).order("updated_at", { ascending: false }).limit(1);
    const fp = Number(((fc?.[0]?.data as Json)?.pdf as Json)?.page);
    p = fp >= 1 && fp <= pages ? fp : 1;
    why = fp >= 1 && fp <= pages ? "the page of the user's highlight" : "the first page";
  }
  if (!(p >= 1 && p <= pages)) return failData(`No page ${page}: the PDF has ${pages} page${pages > 1 ? "s" : ""}.`, { pages });
  const out = await PDFDocument.create();
  const [pg] = await out.copyPages(src, [p - 1]);
  out.addPage(pg);
  const one = await out.save({ useObjectStreams: false }); // (plain objects: any PDF reader takes it)
  if (one.length > PDF_CAP) return failData(`Page ${p} alone is ${Math.round(one.length / 1e6)} MB — too large to send.`);
  return okData({ song: f.s.id, title: f.s.title, pages, page: p, page_chosen: why, bytes: one.length,
    note: `Page ${p} of ${pages} of the song's original PDF, as a one-page PDF (the next content item). Ask with page N for another.` },
  [{ type: "resource", resource: { uri: `resonate://songs/${encodeURIComponent(f.s.id)}/pdf/page-${p}.pdf`, mimeType: "application/pdf", blob: b64(one) } }]);
}

const dataUrl = (u: unknown): { data: string; mimeType: string } | null => {
  const m = typeof u === "string" ? /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s.exec(u) : null;
  return m ? { mimeType: m[1], data: m[2] } : null;
};
const HOW_TO_HIGHLIGHT = "To highlight bars the user drags across the notes on the Score; or call control_resonate score_select {from_measure, to_measure}.";
export async function getScoreView(sb: Sb) {
  const [dev, fc] = await Promise.all([
    sb.from("devices").select("id,name,remote,seen_at,state").order("seen_at", { ascending: false }),
    sb.from("score_focus").select("device_id,song_id,data,score_img,pdf_img,updated_at").order("updated_at", { ascending: false }).limit(1),
  ]);
  const devices = (dev.data || []).map((d) => ({ device: d.id, name: d.name, remote_on: d.remote, online: online(d as Json), seen: ago(d.seen_at), page: (d.state as Json)?.page ?? null, score: (d.state as Json)?.score ?? null }));
  const shown = devices.filter((d) => d.online && d.score);
  const f = fc.data?.[0] as Json | undefined;
  const head: Json = {
    devices,
    score_open_on: shown.map((d) => d.name),
    hint: shown.length ? null : "No device shows the Score right now (Resonate's Score). control_resonate score_open {song} opens it on the device whose AI button is on.",
  };
  if (!f) return okData({ ...head, highlight: null, how: HOW_TO_HIGHLIGHT });
  const d = (f.data as Json) || {};
  const on = devices.find((x) => x.device === f.device_id);
  const sel = (on?.score as Json)?.selection as Json | undefined;
  const ms = (d.measures as string[]) || [];
  const still = !!(sel && (on?.score as Json)?.song && ((on!.score as Json).song as Json).id === f.song_id && sel.from === ms[0] && sel.to === ms[ms.length - 1]);
  const imgs: Content[] = [];
  const si = dataUrl(f.score_img), pi = dataUrl(f.pdf_img);
  head.highlight = {
    device: on?.name ?? f.device_id, song: f.song_id, title: d.title, view: d.view_name ?? d.view, measures: ms.length > 1 ? `${ms[0]}–${ms[ms.length - 1]}` : ms[0],
    when: ago(String(f.updated_at)), still_highlighted: still,
    pdf: d.pdf ?? null,
    pictures: [si ? "1: the bars as Resonate draws them (note names on the heads as the user sees them; the highlight band in blue)" : null, pi ? `${si ? 2 : 1}: the same bars on the original PDF (page ${(d.pdf as Json)?.page ?? "?"}), red border` : null].filter(Boolean),
    ...(d.xml_note ? { xml_note: d.xml_note } : {}),
  };
  head.how = still ? null : HOW_TO_HIGHLIGHT;
  const more: Content[] = [{ type: "text", text: `The highlighted bars' notes (${String(d.legend ?? "")})\n\n${String(d.text ?? "")}` }];
  if (typeof d.xml === "string" && d.xml) more.push({ type: "text", text: `The view's MusicXML for those bars (as Resonate drew them):\n${d.xml}` });
  if (si) imgs.push({ type: "image", ...si });
  if (pi) imgs.push({ type: "image", ...pi });
  return okData(head, [...more, ...imgs]);
}
