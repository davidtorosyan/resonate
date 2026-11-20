// Resonate's MCP server (v73–75, v88: the sheet-music tools): https://<project>.supabase.co/functions/v1/mcp
// Assistants (ChatGPT, Claude…) connect with OAuth through Supabase Auth's OAuth 2.1 server
// (dynamic client registration; consent page public/oauth/consent.html). Stateless Streamable
// HTTP (MCP SDK v2): a fresh server per request; tools in resonate.ts run as the user under RLS.
// Deployed with verify_jwt = false (withSupabase verifies the token; the OAuth discovery must
// get through without one).
//
// THE TOOL LIST IS FROZEN (docs/CONNECTOR.md): ChatGPT and Claude keep a copy of the tools (names,
// descriptions, input schemas) and of the instructions from when the connector was added, and a
// new tool reached ChatGPT only by deleting and re-adding the connector (v88). Never add, rename or
// remove a tool here, nor change an input schema: a new ability is an entry in catalog.ts (an
// action of control_resonate or a query of read_resonate), which get_capabilities lists live.
import { pipeline } from "@supabase/middleware";
import { withOAuthProtectedResource, withSupabase } from "@supabase/server";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import * as R from "./resonate.ts";
import { VERSION } from "./catalog.ts";

const READ = { readOnlyHint: true, openWorldHint: false } as const;

function build(sb: Parameters<typeof R.listSongs>[0]) {
  // listChanged false: a stateless server (a fresh one per request) has no stream to send
  // notifications/tools/list_changed on — and neither ChatGPT nor Claude acts on it (CONNECTOR.md).
  const server = new McpServer({ name: "resonate", title: "Resonate", version: VERSION }, {
    instructions: R.INSTRUCTIONS,
    capabilities: { tools: { listChanged: false } },
  });
  let who = "Assistant";
  const gate = async <T>(fn: () => Promise<T>, tool = "") => {
    if (!(await R.approved(sb))) return R.fail("This Resonate account isn't approved for the cloud yet.");
    who = await R.seen(sb, tool);
    return fn();
  };
  const song = z.string().describe("Song id or (part of) its title");

  server.registerTool("start_vocal_coaching", {
    title: "Become the user's vocal coach",
    description: "Call this FIRST whenever the user mentions Resonate, wants to practise singing, or asks you to be their vocal or singing coach (e.g. \"I'm using Resonate, be my vocal coach\"). Returns the coaching playbook you must follow for the rest of the conversation — how to run takes in Resonate with these tools and coach from Resonate's data (never from what you hear) — and what Resonate shows right now.",
    annotations: READ,
  }, () => gate(() => R.startCoaching(sb), "start_vocal_coaching"));

  server.registerTool("get_status", {
    title: "What Resonate is doing",
    description: "What Resonate is doing right now: the user's devices (which one has 📡 Remote on, whether it's in front, what it shows: song, key, tempo, line, what's going on) and any take being sung, and the start delay.",
    annotations: READ,
  }, () => gate(() => R.getStatus(sb), "get_status"));

  server.registerTool("list_songs", {
    title: "Songs",
    description: "Every song the user has in Resonate (My songs and samples), with when each was last sung.",
    annotations: READ,
  }, () => gate(() => R.listSongs(sb), "list_songs"));

  server.registerTool("get_song", {
    title: "A song's music",
    description: "The melody as Resonate reads the sheet music: key, tempo, meter, range and every lyric line with its notes (pitch, length, syllable).",
    inputSchema: z.object({ song }),
    annotations: READ,
  }, ({ song }) => gate(() => R.getSong(sb, song), "get_song"));

  server.registerTool("list_takes", {
    title: "Recent takes",
    description: "The user's recent takes (newest first), optionally for one song: when, key, tempo, and Resonate's one-line verdict.",
    inputSchema: z.object({ song: song.optional(), limit: z.number().int().min(1).max(30).optional() }),
    annotations: READ,
  }, ({ song, limit }) => gate(() => R.listTakes(sb, song, limit ?? 10), "list_takes"));

  server.registerTool("get_take", {
    title: "One take, line by line",
    description: "A take in full: per line, each note's target vs what was sung (pitch, cents, grade, timing) and Resonate's next steps, plus its review (what went well, what to try). take = a take id or 'latest' (optionally of one song).",
    inputSchema: z.object({ take: z.string().optional(), song: song.optional() }),
    annotations: READ,
  }, ({ take, song }) => gate(() => R.getTake(sb, take, song), "get_take"));

  server.registerTool("get_live_lines", {
    title: "Follow the take being sung",
    description: "Lines of the take being sung right now (else the latest) after after_line, as soon as each line is sung. Waits up to wait_seconds (≤ 20) for a new line. Call again with after_line = next_after_line to keep following; when status isn't 'live' the take has ended and its review is included. Without take, a take you just started is waited for: status not_started = still counting down / opening the mic, didnt_start = it didn't begin.",
    inputSchema: z.object({ after_line: z.number().int().min(0).optional(), wait_seconds: z.number().min(0).max(20).optional(), take: z.string().optional() }),
    annotations: READ,
  }, ({ after_line, wait_seconds, take }) => gate(() => R.getLiveLines(sb, after_line ?? 0, wait_seconds ?? 15, take), "get_live_lines"));

  server.registerTool("get_progress", {
    title: "Progress on a song",
    description: "The user's takes of a song over time (score per take and per line, 0–1) — for spotting progress. Never read the numbers out as grades.",
    inputSchema: z.object({ song }),
    annotations: READ,
  }, ({ song }) => gate(() => R.getProgress(sb, song), "get_progress"));

  server.registerTool("get_voice_profile", {
    title: "Voice profile",
    description: "The user's voice profiles: lowest and highest notes and comfortable range.",
    annotations: READ,
  }, () => gate(() => R.getVoiceProfile(sb), "get_voice_profile"));

  // --- sheet music (v88): the Score, the user's highlight, the song's files ----------------------
  const bar = z.union([z.number().int(), z.string()]);
  server.registerTool("get_score_view", {
    title: "The Score and the user's highlight",
    description: "What Resonate's Score (sheet music) shows on each device — song, view, page, bars on screen, the stretch picked, ▶, the PDF — and the bars the user highlighted last: their notes as text, the view's MusicXML for them, a picture of the drawn bars and one of the same bars on the original PDF (red border). Use it when the user asks about what they're looking at or highlighted, e.g. whether a bar was transcribed right: compare the PDF picture with the notes.",
    annotations: READ,
  }, () => gate(() => R.getScoreView(sb), "get_score_view"));

  server.registerTool("get_score_xml", {
    title: "A song's MusicXML",
    description: "The song's MusicXML file as stored (for a PDF import: the OCR's reading of the PDF), optionally only measures from_measure–to_measure (numbers as written in the file) and one part (id or name). Long answers are cut; ask again from next_from_measure.",
    inputSchema: z.object({ song, from_measure: bar.optional(), to_measure: bar.optional(), part: z.string().optional() }),
    annotations: READ,
  }, ({ song, from_measure, to_measure, part }) => gate(() => R.getScoreXml(sb, song, from_measure, to_measure, part), "get_score_xml"));

  server.registerTool("get_score_pdf", {
    title: "A page of the song's PDF",
    description: "One page of the song's original PDF (songs read with PDF → Song) as a one-page PDF, with the page count. Without page: the page of the user's latest highlight, else page 1.",
    inputSchema: z.object({ song, page: z.number().int().min(1).optional() }),
    annotations: READ,
  }, ({ song, page }) => gate(() => R.getScorePdf(sb, song, page), "get_score_pdf"));

  // --- what Resonate can do now, and any read by name (2026-11-20; the last tools ever added) -----
  server.registerTool("get_capabilities", {
    title: "What Resonate can do now",
    description: "Every action control_resonate takes and everything read_resonate reads, with their parameters, as of now. Resonate adds abilities over time WITHOUT adding tools, so this list is newer than the tool descriptions you were given: call it when the user asks for something your other tools don't obviously cover, or when an action is refused as unknown.",
    annotations: READ,
  }, () => gate(async () => R.capabilities(), "get_capabilities"));

  server.registerTool("read_resonate", {
    title: "Read from Resonate",
    description: "Read anything get_capabilities lists under read_resonate, by name (what), with its parameters as fields or inside args — including reads added after these tools were described to you. The tools named get_* / list_* do the same for their own reads.",
    inputSchema: z.looseObject({
      what: z.string().describe("What to read: a name get_capabilities lists under read_resonate (e.g. status, songs, take, score_view)"),
      song: z.string().optional().describe("Song id or (part of) its title, for reads that take a song"),
      args: z.record(z.string(), z.unknown()).optional().describe("Any other parameters of the read, e.g. {\"take\": \"latest\"}"),
    }),
    annotations: READ,
  }, (input) => gate(() => R.read(sb, input), `read:${R.queryName(input.what)}`));

  // The one tool that acts. Its input schema is open on purpose (an action is any name in
  // catalog.ts, checked there; extra fields and args pass through) so a new action never needs a
  // new schema in the assistants' copies.
  server.registerTool("control_resonate", {
    title: "Control Resonate",
    description: "Act in Resonate on the device whose 📡 Remote is on. action: sing = START A TAKE — the user sings while Resonate records and grades it; use it whenever the user asks to start, go, sing, perform, record or try (to_line N: a short performance that ends by itself after line N — use this instead of stopping it yourself; view: perform = lyrics only, practice = the lane). It starts after a 'Get ready' countdown, so say a word at most and then stay quiet until it ends. stop = end what's going on (take, loop, playback). listen {line?, only_line?} = play the melody. play_take {mode?: voice|melody|both, line?, only_line?} = play the last take back. loop_line {line} = practise one line round after round. open_song {song}, set_key {semitones -24…24 from the written key, or fit: true = Resonate's best fit for the voice profile}, set_tempo {percent: 50,60,70,80,90,100,110,125}, go_to_line {line}, review = open the take's review on screen. The Score (sheet music — not for coaching): score_open {song, view?}, score_view {view: score|both|rh|lh|melody}, score_go {measure}, score_select {from_measure, to_measure} (highlights those bars: get_score_view then has their notes and pictures), score_play {from_measure?, to_measure?, loop?, speed: 50–100}, score_stop, score_pdf {on} (the original PDF, zoomed onto the bars in focus); measures are numbers as in the MusicXML. More actions are added over time: get_capabilities lists every one with its parameters (give a parameter as a field here or inside args). Returns what the page now shows, or why it couldn't.",
    inputSchema: z.looseObject({
      action: z.string().describe("sing, stop, listen, play_take, loop_line, go_to_line, open_song, set_key, set_tempo, review, score_open, score_view, score_go, score_select, score_play, score_stop, score_pdf — or any other action get_capabilities lists"),
      song: z.string().optional(),
      semitones: z.number().optional(),
      fit: z.boolean().optional(),
      percent: z.number().optional(),
      line: z.number().optional(),
      only_line: z.boolean().optional(),
      to_line: z.number().optional(),
      view: z.string().optional().describe("sing: perform | practice; the Score: score | both | rh | lh | melody"),
      mode: z.string().optional().describe("play_take: voice | melody | both"),
      measure: bar.optional(),
      from_measure: bar.optional(),
      to_measure: bar.optional(),
      loop: z.boolean().optional(),
      speed: z.number().optional(),
      on: z.boolean().optional(),
      args: z.record(z.string(), z.unknown()).optional().describe("Parameters of an action that has no field of its own here (get_capabilities lists them)"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, (input) => gate(() => R.control(sb, input, who), `control:${String(input.action ?? "")}`));

  return server;
}

const PUBLISHABLE = (() => {
  try { return JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}").default || ""; } catch { return ""; }
})() || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
async function sessionAlive(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization") || "";
  // Either answers only for a live session (a removed connection: 403 session_not_found). /user
  // may refuse OAuth tokens in a later Auth release; userinfo may want the openid scope.
  const ask = async (path: string) => {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/${path}`, { headers: { Authorization: auth, apikey: PUBLISHABLE } });
    await r.body?.cancel();
    return r.ok;
  };
  return (await ask("user")) || (await ask("oauth/userinfo"));
}

// One log line per JSON-RPC message (the function's logs): which assistant asked for what, so a
// re-fetch of the tool list (initialize / server/discover / tools/list) can be seen. Of a tool
// call only the tool and its action / what — never the arguments. Best effort, never throws.
type Rec = Record<string, unknown>;
function logRpc(method: string, body: unknown, client: string) {
  try {
    if (method !== "POST") return void console.log(`mcp ${method} client=${client}`);
    for (const m of Array.isArray(body) ? body : [body]) {
      if (!m || typeof m !== "object" || typeof (m as Rec).method !== "string") continue;
      const p = ((m as Rec).params || {}) as Rec, meta = (p._meta || {}) as Rec, a = (p.arguments || {}) as Rec;
      const info = (p.clientInfo || meta["io.modelcontextprotocol/clientInfo"]) as { name?: string; version?: string } | undefined;
      const proto = p.protocolVersion || meta["io.modelcontextprotocol/protocolVersion"];
      const extra = (m as Rec).method === "tools/call" ? ` ${String(p.name)}${a.action || a.what ? `:${String(a.action || a.what).slice(0, 40)}` : ""}`
        : `${info ? ` ${info.name ?? "?"}/${info.version ?? "?"}` : ""}${proto ? ` ${String(proto)}` : ""}`;
      console.log(`mcp ${(m as Rec).method}${extra} client=${client} v=${VERSION}`);
    }
  } catch { /* logging only */ }
}

// The request body is read ONCE, here, and the SDK gets a fresh Request made from it plus the
// parsed JSON (parsedBody: it then reads no body itself). Never req.clone() a request's body in
// the Supabase edge runtime: v91 logged from a clone, and the original's body could no longer be
// read — the SDK answered every POST 400 "Parse error: the request body could not be read" (and
// reports that one without onerror), so every assistant failed from 2026-11-20 17:23 until v92.
async function readOnce(req: Request): Promise<{ fwd: Request; parsed?: unknown }> {
  if (req.method.toUpperCase() !== "POST") return { fwd: req };
  const text = await req.text();
  let parsed: unknown;
  try { parsed = text ? JSON.parse(text) : undefined; } catch { parsed = undefined; }
  const fwd = new Request(req.url, { method: req.method, headers: req.headers, body: text, signal: req.signal });
  return { fwd, parsed };
}

// An error the SDK answers a POST with (4xx / 5xx, JSON; a GET's 405 is how a stateless server
// says "no stream here" and is left out) goes to the logs too — its JSON-RPC error code
// and message only (no arguments) — so a failure no tool sees is never silent again.
async function logFailure(res: Response, method: string, client: string): Promise<Response> {
  if (method !== "POST" || res.status < 400 || !(res.headers.get("content-type") || "").includes("application/json")) return res;
  const text = await res.text();
  let msg = text.slice(0, 300);
  try { const j = JSON.parse(text); if (j?.error) msg = `${j.error.code} ${String(j.error.message).slice(0, 300)}`; } catch { /* as text */ }
  console.warn(`mcp answered ${res.status}: ${msg} client=${client} v=${VERSION}`);
  return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
}

const handler = pipeline(
  [withOAuthProtectedResource(), withSupabase({ auth: "user" })],
  async (req, ctx) => {
    // Assistants only: their tokens carry the OAuth client's id (the app's own sessions don't).
    if (!ctx.jwtClaims?.client_id) return Response.json({ error: "This endpoint is for assistants connected with OAuth." }, { status: 403 });
    // A connection removed in Resonate (Assistants → Remove) ends its session at once — its
    // token's signature alone would still pass until it expires.
    if (!(await sessionAlive(req))) return Response.json({ error: "This connection was removed — connect again." }, { status: 401 });
    const client = String(ctx.jwtClaims?.client_id);
    const { fwd, parsed } = await readOnce(req);
    logRpc(req.method.toUpperCase(), parsed, client);
    const mcp = createMcpHandler(() => build(ctx.supabase), { onerror: (e) => console.error("MCP request failed", e) });
    return logFailure(await mcp.fetch(fwd, parsed === undefined ? undefined : { parsedBody: parsed }), req.method.toUpperCase(), client);
  },
);

Deno.serve((req) => handler(req));
