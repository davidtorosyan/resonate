// The MCP server's frozen surface and live catalogue (docs/CONNECTOR.md), without Deno or the network:
// index.ts registers exactly the 15 frozen tools with open schemas for the two routing tools, and
// catalog.ts checks parameters as the server will, highlight.ts tells highlights apart as get_score_view
// will. Run: node --experimental-strip-types mcpcatalog.mjs (Node 22+; catalog.ts and highlight.ts have
// no imports). Live checks of the deployed function: mcp1.cjs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "supabase", "functions", "mcp");
const C = await import(path.join(DIR, "catalog.ts"));
const H = await import(path.join(DIR, "highlight.ts"));
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };

// 1 The frozen tool list: never add, rename or remove one (a new ability is a catalog entry).
const FROZEN = ["start_vocal_coaching", "get_status", "list_songs", "get_song", "list_takes", "get_take", "get_live_lines", "get_progress", "get_voice_profile", "get_score_view", "get_score_xml", "get_score_pdf", "get_capabilities", "read_resonate", "control_resonate"];
const index = fs.readFileSync(path.join(DIR, "index.ts"), "utf8");
const names = [...index.matchAll(/registerTool\("([^"]+)"/g)].map((m) => m[1]);
check(names.join() === FROZEN.join(), `tools registered = the frozen 15, in order (${names.length}: ${names.filter((n) => !FROZEN.includes(n)).join(", ") || "no extras"})`);
const block = (name) => index.slice(index.indexOf(`registerTool("${name}"`), index.indexOf("annotations:", index.indexOf(`registerTool("${name}"`)));
check(["control_resonate", "read_resonate"].every((n) => /z\.looseObject\(/.test(block(n)) && !/z\.enum\(/.test(block(n))), "control_resonate / read_resonate: open schemas (looseObject, no enums)");
check(/version: VERSION/.test(index) && /listChanged: false/.test(index), "serverInfo.version = catalog VERSION; tools.listChanged false");
// The request body is read once and handed on (readOnce + parsedBody): a req.clone() whose body is
// read breaks the original in Supabase's edge runtime — every POST answered 400 (2026-11-20, v91).
const code = index.replace(/\/\/.*$/gm, "");
check(!/\.clone\(\)/.test(code) && /parsedBody: parsed/.test(code), "index.ts never clones the request; the SDK gets the body parsed (parsedBody)");

// 2 The catalogue.
check(C.CHANGES.at(-1).version === C.VERSION, `VERSION ${C.VERSION} has a CHANGES line`);
const all = [...Object.entries(C.ACTIONS), ...Object.entries(C.QUERIES)];
check(all.every(([, e]) => typeof e.about === "string" && e.about.length > 5), `every entry says what it does (${Object.keys(C.ACTIONS).length} actions, ${Object.keys(C.QUERIES).length} reads)`);
const tools = Object.values(C.QUERIES).map((e) => e.tool).filter(Boolean);
check(tools.every((t) => FROZEN.includes(t)) && FROZEN.filter((t) => t !== "control_resonate" && t !== "read_resonate").every((t) => tools.includes(t)), "every read tool has its read_resonate twin");
// Actions the pages handle today (sing.js runRemote, play.js): an entry may be added, never dropped.
const SINCE_V88 = ["open_song", "set_key", "set_tempo", "listen", "play_take", "sing", "loop_line", "go_to_line", "review", "stop", "score_open", "score_view", "score_go", "score_select", "score_play", "score_stop", "score_pdf"];
check(SINCE_V88.every((a) => C.action(a)), "every v88 action is still there");
check(C.action("SING")?.name === "sing" && !C.action("dance") && !C.action("toString") && C.query("get_status")?.name === "status" && C.query("list_songs")?.name === "songs" && !C.query("constructor"), "lookups: case, tool aliases, no prototype names");

const p = (name, given) => C.checkParams(name, C.action(name).entry, C.gather(given, ["action"]));
let r = p("set_key", { action: "set_key", semitones: "2", song: "x" });
check(r.args?.semitones === 2 && r.ignored.join() === "song", `set_key "2" → 2, song ignored (${JSON.stringify(r)})`);
r = p("set_key", { semitones: 25 });
check(/-24…24/.test(r.error || ""), `range refused: ${r.error}`);
r = p("score_play", { args: { from_measure: 3, to_measure: "12a", speed: 70, loop: "true" }, speed: 80 });
check(r.args?.from_measure === 3 && r.args.to_measure === "12a" && r.args.speed === 80 && r.args.loop === true, `args merged, fields win (${JSON.stringify(r.args)})`);
r = p("sing", { view: "PERFORM", to_line: 2.5 });
check(/integer/.test(r.error || ""), `to_line must be whole: ${r.error}`);
r = p("sing", { view: "PERFORM", to_line: 2 });
check(r.args?.view === "perform", "enum values match whatever the case");
r = p("score_open", { view: "both" });
check(/needs song/.test(r.error || ""), `required: ${r.error}`);
r = p("open_song", { song: "  " });
check(/needs song/.test(r.error || ""), "blank text counts as missing");
r = p("score_select", { from_measure: 12, from_beat: "2.5", to_measure: "13", to_beat: 1 });
check(r.args?.from_beat === 2.5 && r.args.to_beat === 1 && r.args.to_measure === "13" && !r.ignored.length, `score_select takes beats (E3): ${JSON.stringify(r.args)}`);
r = p("score_select", { from_measure: 12, from_beat: 0 });
check(/from_beat must be number 1…64/.test(r.error || ""), `a beat before the bar refused: ${r.error}`);
r = p("set_tempo", { percent: 75 });
check(/50 \| 60/.test(r.error || ""), `listed values only: ${r.error}`);
const caps = C.capabilitiesData();
check(caps.version === C.VERSION && caps.control_resonate.score_play.params.speed.startsWith("number 50…100") && caps.read_resonate.status.same_as === "get_status" && JSON.stringify(caps).length < 12000, `get_capabilities answer (${JSON.stringify(caps).length} chars)`);
check(C.capabilitiesBrief().control_resonate.length === Object.keys(C.ACTIONS).length, "the brief in get_status names every action");

// 3 still_highlighted (get_score_view): the stored focus' span vs the device state's selection.
// A double-tap picks one chord; two on two staves at one moment, as long, have the same start / end:
// the staff and part tell them apart (v97 review, E3 findings 4 and 6).
const pl = (bar, beat) => ({ bar, beat });
const rhRow = { kind: "note", start: pl("9", 1), end: pl("9", 2), staff: "Piano, right hand (upper staff)", first: [{ notes: ["E4", "G4"], part: "P2", staff: 1, staff_name: "Piano, right hand (upper staff)" }] };
const state = (o) => ({ from: "9", to: "9", kind: "note", start: pl("9", 1), end: pl("9", 2), ...o });
check(H.sameSpan(state({ staff: rhRow.staff, part: "P2" }), rhRow), "the same chord: still highlighted");
check(!H.sameSpan(state({ staff: "Piano, left hand (lower staff)", part: "P2" }), rhRow), "the left hand's chord at that moment, as long: another highlight");
check(!H.sameSpan(state({ staff: "Voice", part: "P3" }), { ...rhRow, staff: "Voice", first: [{ part: "P1", staff: 1 }] }), "two parts both named Voice: the part tells them apart");
check(H.sameSpan(state({}), rhRow) && H.sameSpan({ from: "9", to: "9" }, rhRow) && H.sameSpan(state({ staff: "x" }), null), "a page or a row that names less: the bars decide");
check(!H.sameSpan(state({ kind: "stretch" }), rhRow) && !H.sameSpan(state({ staff: rhRow.staff, part: "P2", end: pl("9", 3) }), rhRow), "another kind or another end: another highlight");
check(H.sameSpan(state({ kind: "stretch" }), { kind: "stretch", start: pl("9", 1), end: pl("9", 2) }), "a stretch: its start, end and kind");

console.log(fails ? `${fails} FAILED` : "all ok");
process.exit(fails ? 1 : 0);
