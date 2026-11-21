// What an assistant can do with Resonate, as of now (docs/CONNECTOR.md).
//
// ChatGPT and Claude keep their own copy of the tool list — names, descriptions, input schemas and
// the server instructions — from when the connector was added (ChatGPT until Refresh, Claude's apps
// until the connector is added again). Tool *answers* always come from the live server. So the
// tool list in index.ts is frozen, and every new ability is an entry here: an action of
// control_resonate or a query of read_resonate, described live by get_capabilities.
//
// Rules: never remove or rename an entry or a parameter (old chats and old snapshots still send
// them); add, then bump VERSION and add a line to CHANGES. No imports: node can test this file.

export const VERSION = "2026-11-21";
export const CHANGES: { version: string; note: string }[] = [
  { version: "2026-11-20", note: "get_capabilities and read_resonate; control_resonate takes any action listed by get_capabilities, its parameters as fields or inside args." },
  { version: "2026-11-21", note: "The device switch is the AI button at the top of Resonate (it was 📡 Remote), shown once an assistant has connected; answers and the playbook name it." },
];

export type Param = {
  type: "string" | "int" | "number" | "boolean" | "bar";
  min?: number;
  max?: number;
  values?: readonly (string | number)[];
  required?: boolean;
  about?: string;
};
// starts = makes sound or starts a take (can't be queued for a page that isn't in front);
// score = the sheet music (its answers carry no coaching reminder).
export type Entry = { about: string; params?: Record<string, Param>; starts?: boolean; score?: boolean; tool?: string };

const song: Param = { type: "string", about: "song title (or part of it) or id" };
const line: Param = { type: "int", min: 1, about: "lyric line, 1 = the first" };
const bar: Param = { type: "bar", about: "measure number as written in the MusicXML" };
const VIEWS = ["score", "both", "rh", "lh", "melody"] as const;

export const ACTIONS = {
  sing: { about: "START A TAKE: the user sings while Resonate records and grades it. Use it whenever the user asks to start, go, sing, perform, record or try. It starts after a 'Get ready' countdown: say a word at most, then stay quiet until it ends.", starts: true,
    params: { to_line: { ...line, about: "a short performance that ends by itself after this line — use it instead of stopping the take yourself" }, view: { type: "string", values: ["perform", "practice"], about: "perform = lyrics only, practice = the lane" } } },
  stop: { about: "End what's going on: a take, loop, playback, countdown, or the Score's ▶." },
  listen: { about: "Play the melody (from line, to the end or only that line).", starts: true, params: { line, only_line: { type: "boolean" } } },
  play_take: { about: "Play the last take back.", starts: true, params: { mode: { type: "string", values: ["voice", "melody", "both"] }, line, only_line: { type: "boolean" } } },
  loop_line: { about: "Practise one line round after round (it plays, then the user sings, a result on screen) until stop.", starts: true, params: { line } },
  go_to_line: { about: "Move Sing to a line.", params: { line } },
  open_song: { about: "Open a song in Resonate with Sing.", params: { song: { ...song, required: true } } },
  set_key: { about: "Change the key: semitones from the written key, or fit: true = Resonate's best fit for the voice profile.", params: { semitones: { type: "int", min: -24, max: 24 }, fit: { type: "boolean" } } },
  set_tempo: { about: "Change the tempo.", params: { percent: { type: "number", values: [50, 60, 70, 80, 90, 100, 110, 125] } } },
  review: { about: "Open the last take's review on screen." },
  score_open: { about: "Open a song on the Score (sheet music) — not for coaching.", score: true, params: { song: { ...song, required: true }, view: { type: "string", values: VIEWS } } },
  score_view: { about: "Change the Score's view.", score: true, params: { view: { type: "string", values: VIEWS } } },
  score_go: { about: "Turn the Score to a measure.", score: true, params: { measure: bar } },
  score_select: { about: "Highlight bars on the Score: get_score_view then has their notes and pictures.", score: true, params: { from_measure: bar, to_measure: bar } },
  score_play: { about: "Play the Score's piano part: the bars given, else the highlight, else from the page shown; loop = round after round.", score: true, starts: true,
    params: { from_measure: bar, to_measure: bar, loop: { type: "boolean" }, speed: { type: "number", min: 50, max: 100, about: "percent" } } },
  score_stop: { about: "Stop the Score's ▶.", score: true },
  score_pdf: { about: "Show (on: true) or hide the original PDF, zoomed onto the bars in focus.", score: true, params: { on: { type: "boolean" } } },
} satisfies Record<string, Entry>;

export const QUERIES = {
  status: { tool: "get_status", about: "What Resonate is doing: devices (whose AI button is on, in front, what each shows), a live take, the start delay." },
  coaching: { tool: "start_vocal_coaching", about: "The coaching playbook and what Resonate shows now." },
  songs: { tool: "list_songs", about: "Every song (My songs and samples), with when each was last sung." },
  song: { tool: "get_song", about: "A song's melody as Resonate reads it: key, tempo, meter, range, every lyric line with its notes.", params: { song: { ...song, required: true } } },
  takes: { tool: "list_takes", about: "Recent takes (newest first), optionally of one song.", params: { song, limit: { type: "int", min: 1, max: 30 } } },
  take: { tool: "get_take", about: "One take line by line with Resonate's next steps and review; take = id or 'latest'.", params: { take: { type: "string" }, song } },
  live_lines: { tool: "get_live_lines", about: "Lines of the take being sung after after_line; waits up to wait_seconds for a new one.", params: { after_line: { type: "int", min: 0 }, wait_seconds: { type: "number", min: 0, max: 20 }, take: { type: "string" } } },
  progress: { tool: "get_progress", about: "A song's takes over time (data only: never read numbers out as grades).", params: { song: { ...song, required: true } } },
  voice_profile: { tool: "get_voice_profile", about: "Voice profiles: lowest and highest notes, comfortable range." },
  score_view: { tool: "get_score_view", score: true, about: "What the Score shows on each device and the user's latest highlight (notes as text, MusicXML, pictures)." },
  score_xml: { tool: "get_score_xml", score: true, about: "The song's stored MusicXML, optionally some measures and one part.", params: { song: { ...song, required: true }, from_measure: bar, to_measure: bar, part: { type: "string" } } },
  score_pdf: { tool: "get_score_pdf", score: true, about: "One page of the song's original PDF.", params: { song: { ...song, required: true }, page: { type: "int", min: 1 } } },
  capabilities: { tool: "get_capabilities", about: "This list." },
} satisfies Record<string, Entry>;

export type ActionName = keyof typeof ACTIONS;
export type QueryName = keyof typeof QUERIES;
const ACTION_BOOK: Record<string, Entry> = ACTIONS;
const QUERY_BOOK: Record<string, Entry> = QUERIES;

export function action(name: unknown): { name: ActionName; entry: Entry } | null {
  const n = String(name ?? "").trim().toLowerCase();
  return Object.hasOwn(ACTION_BOOK, n) ? { name: n as ActionName, entry: ACTION_BOOK[n] } : null;
}
// A query by its name or by the tool that does the same ("get_status", "list_songs"…).
export function query(name: unknown): { name: QueryName; entry: Entry } | null {
  const n = String(name ?? "").trim().toLowerCase();
  if (Object.hasOwn(QUERY_BOOK, n)) return { name: n as QueryName, entry: QUERY_BOOK[n] };
  const hit = Object.entries(QUERY_BOOK).find(([, e]) => e.tool === n);
  return hit ? { name: hit[0] as QueryName, entry: hit[1] } : null;
}

const BAD = Symbol("bad");
function coerce(p: Param, v: unknown): unknown {
  let out: unknown = BAD;
  if (p.type === "string" && (typeof v === "string" || typeof v === "number")) out = String(v).trim();
  else if (p.type === "boolean") out = typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : BAD;
  else if (p.type === "bar") out = typeof v === "number" && Number.isInteger(v) ? v : typeof v === "string" && v.trim() ? v.trim() : BAD;
  else if (p.type === "int" || p.type === "number") {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
    if (Number.isFinite(n) && (p.type === "number" || Number.isInteger(n)) && (p.min === undefined || n >= p.min) && (p.max === undefined || n <= p.max)) out = n;
  }
  if (out === BAD) return BAD;
  if (p.values) {
    const hit = p.values.find((x) => String(x).toLowerCase() === String(out).toLowerCase());
    return hit === undefined ? BAD : hit;
  }
  return out;
}
export function describeParam(p: Param): string {
  const kind = p.values ? p.values.join(" | ")
    : p.type === "int" || p.type === "number" ? `${p.type === "int" ? "integer" : "number"}${p.min !== undefined && p.max !== undefined ? ` ${p.min}…${p.max}` : p.min !== undefined ? ` ≥ ${p.min}` : p.max !== undefined ? ` ≤ ${p.max}` : ""}`
    : p.type === "boolean" ? "true | false" : p.type === "bar" ? "measure number" : "text";
  return `${kind}${p.required ? " (required)" : ""}${p.about ? ` — ${p.about}` : ""}`;
}

// The parameters an entry takes, from what was given (fields and/or an args object); anything the
// entry doesn't take is left out and named.
export function checkParams(label: string, entry: Entry, given: Record<string, unknown>): { args: Record<string, unknown>; ignored: string[] } | { error: string } {
  const ps = entry.params || {};
  const args: Record<string, unknown> = {}, ignored: string[] = [];
  for (const [k, v] of Object.entries(given)) {
    if (v === undefined || v === null || (typeof v === "string" && !v.trim())) continue;
    const p = (ps as Record<string, Param>)[k];
    if (!p) { ignored.push(k); continue; }
    const c = coerce(p, v);
    if (c === BAD) return { error: `${label}: ${k} must be ${describeParam({ ...p, required: false, about: undefined })} (got ${JSON.stringify(v)}).` };
    args[k] = c;
  }
  for (const [k, p] of Object.entries(ps as Record<string, Param>)) if (p.required && !(k in args)) return { error: `${label} needs ${k}.` };
  return { args, ignored };
}
// Fields of a tool call plus its args object (fields win), without the routing keys.
export function gather(input: Record<string, unknown>, routing: string[]): Record<string, unknown> {
  const extra = input.args && typeof input.args === "object" && !Array.isArray(input.args) ? input.args as Record<string, unknown> : {};
  const out: Record<string, unknown> = { ...extra };
  for (const [k, v] of Object.entries(input)) if (k !== "args" && !routing.includes(k) && v !== undefined && v !== null) out[k] = v;
  return out;
}

const render = (book: Record<string, Entry>) => Object.fromEntries(Object.entries(book).map(([name, e]) => [name, {
  does: e.about,
  ...(e.params && Object.keys(e.params).length ? { params: Object.fromEntries(Object.entries(e.params).map(([k, p]) => [k, describeParam(p)])) } : {}),
  ...(e.tool ? { same_as: e.tool } : {}),
}]));
export function capabilitiesData() {
  return {
    version: VERSION,
    how: "control_resonate {action, …params} acts on the device whose AI button is on; read_resonate {what, …params} reads. Give parameters as fields or inside args. This list grows over time without the tools changing: when the user wants something your other tools don't cover, look here.",
    control_resonate: render(ACTION_BOOK),
    read_resonate: render(QUERY_BOOK),
    changes: CHANGES.slice(-5),
  };
}
// The short form in get_status / start_vocal_coaching answers.
export function capabilitiesBrief() {
  return { version: VERSION, control_resonate: Object.keys(ACTION_BOOK), read_resonate: Object.keys(QUERY_BOOK), details: "get_capabilities" };
}
