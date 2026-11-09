// Resonate's MCP server (v73–75): https://<project>.supabase.co/functions/v1/mcp
// Assistants (ChatGPT, Claude…) connect with OAuth through Supabase Auth's OAuth 2.1 server
// (dynamic client registration; consent page public/oauth/consent.html). Stateless Streamable
// HTTP (MCP SDK v2): a fresh server per request; tools in resonate.ts run as the user under RLS.
// Deployed with verify_jwt = false (withSupabase verifies the token; the OAuth discovery must
// get through without one).
import { pipeline } from "@supabase/middleware";
import { withOAuthProtectedResource, withSupabase } from "@supabase/server";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import * as R from "./resonate.ts";

const READ = { readOnlyHint: true, openWorldHint: false } as const;

function build(sb: Parameters<typeof R.listSongs>[0]) {
  const server = new McpServer({ name: "resonate", title: "Resonate", version: "1.0.0" }, { instructions: R.INSTRUCTIONS });
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

  server.registerTool("control_resonate", {
    title: "Control Resonate",
    description: "Act in Resonate's Sing page on the device whose 📡 Remote is on. action: sing = START A TAKE — the user sings while Resonate records and grades it; use it whenever the user asks to start, go, sing, perform, record or try (to_line N: a short performance that ends by itself after line N — use this instead of stopping it yourself; view: perform = lyrics only, practice = the lane). It starts after a 'Get ready' countdown, so say a word at most and then stay quiet until it ends. stop = end what's going on (take, loop, playback). listen {line?, only_line?} = play the melody. play_take {mode?: voice|melody|both, line?, only_line?} = play the last take back. loop_line {line} = practise one line round after round. open_song {song}, set_key {semitones -24…24 from the written key, or fit: true = Resonate's best fit for the voice profile}, set_tempo {percent: 50,60,70,80,90,100,110,125}, go_to_line {line}, review = open the take's review on screen. Returns what the page now shows, or why it couldn't.",
    inputSchema: z.object({
      action: z.enum(R.ACTIONS),
      song: z.string().optional(),
      semitones: z.number().int().min(-24).max(24).optional(),
      fit: z.boolean().optional(),
      percent: z.number().optional(),
      line: z.number().int().min(1).optional(),
      only_line: z.boolean().optional(),
      to_line: z.number().int().min(1).optional(),
      view: z.enum(["perform", "practice"]).optional(),
      mode: z.enum(["voice", "melody", "both"]).optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, (args) => gate(() => R.control(sb, args, who), `control:${args.action}`));

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

const handler = pipeline(
  [withOAuthProtectedResource(), withSupabase({ auth: "user" })],
  async (req, ctx) => {
    // Assistants only: their tokens carry the OAuth client's id (the app's own sessions don't).
    if (!ctx.jwtClaims?.client_id) return Response.json({ error: "This endpoint is for assistants connected with OAuth." }, { status: 403 });
    // A connection removed in Resonate (Assistants → Remove) ends its session at once — its
    // token's signature alone would still pass until it expires.
    if (!(await sessionAlive(req))) return Response.json({ error: "This connection was removed — connect again." }, { status: 401 });
    const mcp = createMcpHandler(() => build(ctx.supabase), { onerror: (e) => console.error("MCP request failed", e) });
    return mcp.fetch(req);
  },
);

Deno.serve((req) => handler(req));
