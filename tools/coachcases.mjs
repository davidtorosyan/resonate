// coach.js guided-practice words (docs/COACHING.md §5): roundResult and runResult.
// Every verdict kind's text; a pass shows only a win; unsure never a fault; a progress win
// exactly when the previous cue is fixed; no %, fail, wrong, score, or digits outside note names.
// usage: node coachcases.mjs   (fixtures: node dumpnotes.cjs)
import { loadSong } from "./fixturelib.mjs";
import { groupPhrases, timeVerdict, tuneVerdict } from "../public/practice.js";
import { roundResult, runResult, securedText, analyzeLines, feedback, rhythmText } from "../public/coach.js";
import { earText, plainOf } from "../public/ear.js";

let pass = 0, fail = 0;
const texts = [];
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
};
const say = (res) => [res.win?.text, res.cue?.text].filter(Boolean).join(" · ");
const keep = (res) => { if (res.win) texts.push(res.win.text); if (res.cue) texts.push(res.cue.text); return res; };

const s = loadSong("amazing-grace");
const AG = groupPhrases(s.notes, s.lines, s.opts);
const N = s.notes, P0 = AG.phrases[0], P1 = AG.phrases[1]; // "Amazing grace…", "That saved a wretch like me!"
const J = (txt, ph = P1) => ph.js.find((j) => N[j].text.replace(/[!,.;]/g, "") === txt);
const That = J("That"), saved = J("saved"), wretch = J("wretch"), me = J("me");
const R = (o = {}) => ({ trust: "ok", calibrated: true, guide: "click", tapped: false, lag: 0.02, beat: 0.75, measuredRt: true, cover: 0.9,
  classified: 5, syllables: 6, obs: [], takeObs: [], leadN: 5, seedAgrees: true, ...o });
const G = (st = "good", o = {}) => { const g = []; for (const j of P1.js) g[j] = { status: st, hit: st === "good" ? 1 : 0, dev: 0, shift: 0, ...o }; return g; };
const time = (r, grades = G()) => timeVerdict({ ph: P1, r, grades, notes: N });
const tune = (grades, r = R()) => tuneVerdict({ ph: P1, r, grades, notes: N });
const T = (v, prev = null) => keep(roundResult("time", v, prev, N, P1));
const U = (v, prev = null) => keep(roundResult("tune", v, prev, N, P1));
const obs = (kind, extra = {}) => ({ kind, tone: "try", scope: "line", ...extra });

// --- In time: each verdict kind's words
{
  let r = T(time(R({ lag: 0.6 })));
  check("slip late", r.verdict === "slip" && r.cue.kind === "slip" && r.cue.text === "Count in — “That” a beat sooner" && r.cue.play?.j === That, say(r));
  r = T(time(R({ obs: [obs("early-in", { j: That, count: true })] })));
  check("slip early", r.cue.text === "“That” waits a beat", say(r));
  r = T(time(R({ cover: 0.1, lag: null })));
  check("unheard", r.verdict === "unheard" && r.cue.text === "Sing out on “That”" && !r.win, say(r));
  r = T(time(R({ obs: [obs("late-in", { j: That })] })));
  check("late-in", r.cue.text === "Come in on the beat at “That”" && r.cue.play?.j === That, say(r)); // (v76 review: an instruction, not "“That” on the beat")
  r = T(time(R({ obs: [obs("early-in", { j: That })] })));
  check("early-in", r.cue.text === "Let the beat go first, then “That”", say(r));
  check("rushing", T(time(R({ obs: [obs("rushing")] }))).cue.text === "Let the beat lead");
  check("dragging", T(time(R({ obs: [obs("dragging")] }))).cue.text === "Lean toward the next beat");
  check("off-beats late", T(time(R({ obs: [obs("offbeat-late")] }))).cue.text === "Off-beat notes a touch sooner");
  check("off-beats early", T(time(R({ obs: [obs("offbeat-early")] }))).cue.text === "Off-beat notes a touch later");
  r = T(time(R({ obs: [obs("short", { j: me })] })));
  check("short", r.cue.text === "Hold “me” full length" && r.cue.play?.j === me, say(r));
  check("held", T(time(R({ obs: [obs("held", { j: me })] }))).cue.text === "Let go of “me” sooner");
  check("behind", T(time(R({ takeObs: [{ kind: "behind", tone: "try", scope: "take" }] }))).cue.text === "A touch behind the beat");
  check("ahead", T(time(R({ takeObs: [{ kind: "ahead", tone: "try", scope: "take" }] }))).cue.text === "A touch ahead — let the beat lead");
  // wins
  r = T(time(R({ lag: 0.02, obs: [obs("short", { j: me })] })));
  check("win: In on “That” with a cue", r.win?.text === "In on “That”" && r.cue.text === "Hold “me” full length", say(r));
  check("§7.3 round 1", say(r) === "In on “That” · Hold “me” full length", say(r));
  const per = []; per[That] = { cls: "late" }; per[saved] = { cls: "on", rel: 0 }; per[saved].rel = 0.01;
  r = T(time(R({ lag: null, notes: per })));
  check("win: Held “saved” full length (pass)", r.verdict === "pass" && r.win?.text === "Held “saved” full length" && !r.cue, say(r));
  r = T(time(R({ lag: null, obs: [{ kind: "steady-line", tone: "good", scope: "line" }] })));
  check("win: Steady", r.win?.text === "Steady" && !r.cue, say(r));
  r = T(time(R({ lag: null })));
  check("pass with no particular fact: still a true win", r.verdict === "pass" && r.win?.text === "With the beat" && !r.cue, say(r));
  r = T({ ...time(R()), fullSpeed: true });
  check("win: Full speed comes after the timing wins", r.win?.text === "In on “That”", say(r));
  r = T({ ...time(R({ lag: null })), fullSpeed: true });
  check("win: Full speed", r.win?.text === "Full speed", say(r));
}

// --- Unsure / unknown: never a fault
{
  let r = T(time(R({ classified: 1, lag: null }), G("off")));
  check("unsure: Again, no fault", r.verdict === "unsure" && !r.win && r.cue?.kind === "again" && r.cue.text === "Again", say(r));
  r = T(time(R({ classified: 1, lag: 0.02 }), G("off")));
  check("unsure: the win alone", r.verdict === "unsure" && r.win?.text === "In on “That”" && !r.cue, say(r));
  r = T(time(null));
  check("unknown timing: Again", r.verdict === "unknown" && r.cue?.text === "Again" && !r.win, say(r));
  r = T(time(R({ obs: [obs("rushing")] })), null);
  const tapped = T(timeVerdict({ ph: P1, r: R({ obs: [obs("rushing")] }), grades: G(), notes: N, tapped: true }));
  check("tapped map: a try becomes unsure → no fault", tapped.verdict === "unsure" && (!tapped.cue || tapped.cue.kind === "again"), say(tapped));
}

// --- In tune
{
  let r = U(tune(G()));
  check("tune pass: only a win", r.verdict === "pass" && r.win && !r.cue, say(r));
  check("tune pass: the longest good note", r.win.text === "“me” right on E♭5", say(r));
  const g1 = G(); g1[me] = { status: "ok", hit: 0.9, dev: 0.3 };
  r = U(tune(g1));
  check("tune win: Every note found", r.win.text === "Every note found", say(r));
  const g2 = G(); g2[wretch] = { status: "off", hit: 0, dev: -1.3 };
  r = U(tune(g2));
  check("note: up to", r.verdict === "try" && r.cue.text === "“wretch” — up to C5" && r.cue.play?.j === wretch, say(r));
  check("note: win first", r.win?.text === "“me” right on E♭5", say(r));
  const g3 = G(); g3[wretch] = { status: "off", hit: 0, dev: 1.1 };
  check("note: down to", U(tune(g3)).cue.text === "“wretch” — down to C5");
  const g4 = G(); g4[That] = { status: "missed", hit: 0 }; g4[That + 1] = { status: "missed", hit: 0 };
  r = U(tune(g4));
  check("missed", r.cue.text === "Sing out on “That”", say(r));
  r = U(tune(G("ok", { dev: -0.3, hit: 0.7 })));
  check("flat", r.cue.text === "A touch flat — lift it", say(r));
  r = U(tune(G("ok", { dev: 0.3, hit: 0.7 })));
  check("sharp", r.cue.text === "A touch sharp — ease it", say(r));
  r = U(tune(G("unclear")));
  check("unknown: Closer to the mic, no win", r.verdict === "unknown" && r.cue.text === "Closer to the mic" && !r.win, say(r));
  r = U(tune(G(), R({ lag: 0.6 })));
  check("tune: a counting slip is the cue", r.verdict === "slip" && r.cue.text === "Count in — “That” a beat sooner", say(r));
  check("tune: no pitch words In time", !/right on|found|up to|down to|flat|sharp/.test(say(T(time(R(), g2)))), say(T(time(R(), g2))));
}

// --- Progress wins exactly when the previous cue is fixed
{
  const prevShort = { kind: "short", j: me };
  const perOk = []; perOk[me] = { cls: "on", rel: -0.05 };
  let r = T(time(R({ notes: perOk })), prevShort);
  check("progress: “me” full length now", r.win?.kind === "progress" && r.win.text === "“me” full length now", say(r));
  r = T(time(R({ notes: perOk, obs: [obs("short", { j: me })] })), prevShort);
  check("progress: not when it's still short", r.win?.kind !== "progress" && r.cue.text === "Hold “me” full length", say(r));
  r = T(time(R({ lag: 0.02 })), { kind: "slip", j: That, dir: "late" });
  check("progress: “That” on the beat now", r.win?.text === "“That” on the beat now", say(r));
  r = T(time(R({ lag: 0.6 })), { kind: "slip", j: That, dir: "late" });
  check("progress: not while it still slips", r.win?.kind !== "progress", say(r));
  r = T(time(R({ classified: 1, lag: null }), G("off")), prevShort);
  check("progress: never from an unsure round", r.win?.kind !== "progress", say(r));
  r = T(time(R({ lag: 0.03 })), { kind: "late-in", j: That });
  check("progress: entry fixed", r.win?.text === "“That” on the beat now", say(r));
  r = T(time(R()), { kind: "rushing" });
  check("progress: With the beat now", r.win?.text === "With the beat now", say(r));
  r = T(time(R({ obs: [obs("rushing")] })), { kind: "rushing" });
  check("progress: not while still rushing", r.win?.kind !== "progress", say(r));
  const g = G();
  r = U(tune(g), { kind: "note", j: wretch, dir: "up", note: "C5" });
  check("progress: “wretch” on C5 now", r.win?.text === "“wretch” on C5 now" && !r.cue, say(r));
  const gOff = G(); gOff[wretch] = { status: "off", hit: 0, dev: -1 };
  r = U(tune(gOff), { kind: "note", j: wretch, dir: "up", note: "C5" });
  check("progress: not while still off", r.win?.kind !== "progress" && r.cue.kind === "note", say(r));
  r = U(tune(G()), { kind: "flat" });
  check("progress: Right on pitch now", r.win?.text === "Right on pitch now", say(r));
  r = U(tune(G()), { kind: "mic" });
  check("progress: Heard clearly now", r.win?.text === "Heard clearly now", say(r));
  r = U(tune(G("unclear")), { kind: "mic" });
  check("progress: not while unclear", !r.win, say(r));
  r = U(tune(G()), { kind: "missed", j: That });
  check("progress: rings out now", r.win?.text === "“That” rings out now", say(r));
  r = U(tune(G()), { kind: "slip", j: That, dir: "late" });
  check("progress: a slip fixed In tune", r.win?.text === "“That” on the beat now", say(r));
  r = U(tune(G(), null), { kind: "slip", j: That, dir: "late" });
  check("progress: not when the entry wasn't measured", r.win?.kind !== "progress", say(r));
  // No win that says the opposite of the cue: a held word's other note off ("like" B♭4 ‿C5),
  // or every note close but the phrase still under the bar (the cue names a note to aim for).
  const like = J("like"), likeHeld = like + 1;
  const gLike = G("ok", { hit: 0.6, dev: 0 }); gLike[like] = { status: "good", hit: 1, dev: 0 }; gLike[likeHeld] = { status: "off", hit: 0, dev: -1.1 };
  r = U(tune(gLike), { kind: "note", j: like, dir: "up", note: N[like].name });
  check("no progress win on the word the cue names", r.cue?.kind === "note" && r.cue.play?.j === likeHeld && !/“like”.*now/.test(say(r)), say(r));
  r = U(tune(G("ok", { hit: 0.6, dev: 0.1 })));
  check("no Every note found beside a note to aim for", r.verdict === "try" && r.cue?.kind === "note" && !/Every note found/.test(say(r)), say(r));
}

// --- D6: the win rotates among the true ones (verdict.shown: the wins shown lately, newest last)
{
  const sh = (v, shown) => ({ ...v, shown });
  const pass = time(R({ lag: 0.02, obs: [{ kind: "steady-line", tone: "good", scope: "line" }] }));
  check("rotate: no history → the first true win", T(pass).win.text === "In on “That”", say(T(pass)));
  let r = T(sh(pass, ["In on “That”"]));
  check("rotate: the same win last round → another true one", r.win.text === "Steady" && !r.cue, say(r));
  r = T(sh(pass, ["In on “That”", "Steady"]));
  check("rotate: … then the plain one (true of every pass)", r.win.text === "With the beat", say(r));
  r = T(sh(pass, ["With the beat", "In on “That”", "Steady"]));
  check("rotate: all shown → the one shown longest ago", r.win.text === "With the beat", say(r));
  r = T(sh(pass, ["Steady", "With the beat", "In on “That”"]));
  check("rotate: … whichever that is", r.win.text === "Steady", say(r));
  const only = time(R({ lag: 0.02 }));
  r = T(sh(only, ["In on “That”"]));
  check("rotate: a pass whose only fact was just shown → With the beat", r.win.text === "With the beat", say(r));
  // (a pass always shows a win, whatever was shown)
  const hist = [[], ["In on “That”"], ["With the beat"], ["In on “That”", "With the beat"], ["With the beat", "In on “That”"], ["x", "y", "z"]];
  check("rotate: a pass always has a win", hist.every((h) => T(sh(only, h)).win && !T(sh(only, h)).cue) && hist.every((h) => U(sh(tune(G()), h)).win));
  // progress first, unless that very win was the last one shown
  const perOk = []; perOk[me] = { cls: "on", rel: -0.05 };
  const fixed = time(R({ notes: perOk }));
  r = T(sh(fixed, ["“me” full length now", "In on “That”"]), { kind: "short", j: me });
  check("rotate: progress comes first when it's news", r.win.text === "“me” full length now", say(r));
  r = T(sh(fixed, ["In on “That”", "“me” full length now"]), { kind: "short", j: me });
  check("rotate: … not twice running", r.win.text !== "“me” full length now" && r.win.text === "Held “me” full length", say(r));
  // In tune: the longest good note, every note found, In tune
  const g1 = G(); g1[me] = { status: "good", hit: 1, dev: 0 };
  const tp = tune(g1);
  check("rotate (tune): no history", U(tp).win.text === "“me” right on E♭5", say(U(tp)));
  r = U(sh(tp, ["“me” right on E♭5"]));
  check("rotate (tune): another true win", r.win.text === "Every note found", say(r));
  r = U(sh(tp, ["“me” right on E♭5", "Every note found"]));
  check("rotate (tune): … then In tune", r.win.text === "In tune", say(r));
  // a try keeps its cue; its win rotates too, and never says the opposite of the cue
  const tr = time(R({ lag: 0.02, obs: [obs("short", { j: me }), { kind: "steady-line", tone: "good", scope: "line" }] }));
  r = T(sh(tr, ["In on “That”"]));
  check("rotate: a try's win rotates, the cue stays", r.win?.text === "Steady" && r.cue.text === "Hold “me” full length", say(r));
  r = T(sh(tr, ["Steady", "In on “That”"]));
  check("rotate: a try never gets the plain pass win", r.win?.text !== "With the beat" && r.cue, say(r));
  const tr1 = time(R({ lag: 0.02, obs: [obs("rushing")] }));
  r = T(sh(tr1, ["In on “That”"]));
  check("rotate: a try whose only win was just shown still leads with it (a true win is never dropped)", r.win?.text === "In on “That”" && r.cue.text === "Let the beat lead", say(r));
  // a block of passes with the page's history: no win twice in a row while another is true
  const seq = [];
  const shown = [];
  for (let k = 0; k < 6; k++) { const w = T(sh(pass, [...shown])).win.text; seq.push(w); shown.push(w); }
  check("rotate: six passes in a row never repeat the last win", seq.every((w, k) => !k || w !== seq[k - 1]), seq.join(" / "));
}

// --- Words: syllables joined, punctuation off, no lyrics → note names
{
  const ama = P0.js.find((j) => N[j].text === "ma");
  const r = keep(roundResult("time", { v: "try", cue: { kind: "short", j: ama }, facts: {} }, null, N, P0));
  check("words: syllables joined", r.cue.text === "Hold “Amazing” full length", r.cue.text);
  const held = P0.js.find((j, k) => N[j].melisma && k > 0 && N[P0.js[k - 1]].text === "zing");
  const r2 = keep(roundResult("tune", { v: "try", cue: { kind: "note", j: held, dir: "up" }, facts: {} }, null, N, P0));
  check("words: a held note is its syllable's word", r2.cue.text === `“Amazing” — up to ${N[held].name}`, r2.cue.text);
  const bare = N.map((n) => ({ ...n, text: "", syllabic: null, melisma: false }));
  const r3 = keep(roundResult("time", { v: "try", cue: { kind: "short", j: wretch }, facts: {} }, null, bare, P1));
  check("words: no lyrics → the note, unquoted", r3.cue.text === "Hold C5 full length", r3.cue.text);
  const g = []; for (const j of P1.js) g[j] = { status: "good", hit: 1, dev: 0 };
  g[wretch] = { status: "off", hit: 0, dev: -1.2 };
  const v = tuneVerdict({ ph: P1, r: null, grades: g, notes: bare });
  const r4 = keep(roundResult("tune", v, null, bare, P1));
  check("words: no lyrics → Up to C5, Right on E♭5", r4.cue.text === "Up to C5" && r4.win?.text === "Right on E♭5", say(r4));
  const r5 = keep(roundResult("tune", tuneVerdict({ ph: P1, r: null, grades: g.map((x) => x && { ...x, status: "good", hit: 1 }), notes: bare }), { kind: "note", j: wretch, dir: "up" }, bare, P1));
  check("words: no lyrics → On C5 now", r5.win?.text === "On C5 now", say(r5));
}

// --- After a run
{
  const song = { phrases: AG.phrases };
  let r = runResult([[0, "song"], [1, "song"], [2, "time"]], [3], song);
  check("run: headline names what's in the song", r.headline === "In the song ✓ “Amazing grace”, “That saved a wretch…”", r.headline);
  check("run: Better than your first try", r.win === "Better than your first try: “Was blind”", r.win);
  texts.push(r.headline, r.win);
  r = runResult([[0, "time"], [3, "tune"]], [], song);
  check("run: nothing to say → no words (the map animates)", r.headline === null && r.win === null);
  r = runResult([], [], song);
  check("run: the first run says nothing", r.headline === null && r.win === null);
  r = runResult([[0, "song"], [1, "song"], [2, "song"], [3, "song"]], [], song);
  check("run: at most three names", (r.headline.match(/“/g) || []).length === 3 && r.headline.endsWith("…"), r.headline);
  texts.push(r.headline);
  const rideSong = { phrases: AG.phrases.map((p, i) => (i === 3 ? { ...p, ride: true } : p)) };
  r = runResult([[3, "song"]], [], rideSong);
  check("run: a phrase that only rides along isn't a headline", r.headline === null, r.headline);
  r = runResult([[0, "song"], [3, "song"]], [], rideSong);
  check("run: … nor named beside others", r.headline === "In the song ✓ “Amazing grace”", r.headline);
  const g = securedText(AG.phrases[3], ["time", "tune"]);
  check("secured: glow line", g === "✓ “Was blind…” in time · in tune", g);
  texts.push(g);
}

// --- A pass never carries a cue; nothing graded is ever said
{
  const all = [];
  for (const v of ["pass", "try", "slip", "unsure", "unknown", "unheard"]) for (const stage of ["time", "tune"]) {
    const res = keep(roundResult(stage, { v, cue: v === "pass" || v === "unsure" || v === "unknown" ? null : { kind: v === "slip" ? "slip" : stage === "time" ? "short" : "note", j: wretch, dir: "up" }, facts: {} }, null, N, P1));
    all.push([v, stage, res]);
  }
  check("pass: only a win", all.filter(([v]) => v === "pass").every(([, , r]) => r.win && !r.cue));
  check("unsure/unknown time: no fault", all.filter(([v, st]) => v === "unsure" || (v === "unknown" && st === "time")).every(([, , r]) => !r.cue || r.cue.kind === "again"));
  check("every result has something to show", all.every(([, , r]) => r.win || r.cue));
}

// Ear's words (ear.js earText, the fix plan's words tables): every win and cue kind, Line and Beats, each direction and
// size, the next chips and the ▶s — into the same bans below. Its counts are counts with their units (never "—", "0",
// "↑"; a count is all or a number) and the tempo line a tempo: those two may hold digits, nothing else.
{
  const L0 = AG.phrases[0], grace = L0.js.find((j) => N[j].text.replace(/[!,.;]/g, "") === "grace"), zing2 = L0.j0 + 4, how = J("how", L0);
  const ctx = (o = {}) => ({ notes: N, name: (m) => `m${m}`, bpm: 80, voice: true, shift: () => true, lastLine: false, ...o });
  const all = [];
  const run = (kind, res, c) => { const T = earText({ kind, ...res }, ctx(c)); all.push([kind, res, T]); return T; };
  const counts = { notes: 9, notesAll: false, beats: 7, beatsAll: false };
  const wins = [["spot"], ["spot", { sub: "again" }], ["fixed", { sub: "note", j: zing2 }], ["fixed", { sub: "start", j: how }], ["rose", { sub: "notes" }], ["rose", { sub: "beats" }], ["rose", { sub: "both" }],
    ["key"], ["tune"], ["high", { j: grace }], ["long", { j: grace }], ["first", { j: L0.j0 }], ["entry", { j: L0.j0 }], ["run", { j: L0.j0, j2: grace }], ["even"]];
  const cues = [["silent", { sounds: ["first"] }], ["nofit", { sounds: ["hear"] }], ["key", { dir: "lower", s: -3, sounds: ["first", "you", "key"], at: [0, 1] }], ["key", { dir: "higher", s: 2, sounds: ["first", "you", "key"], at: [0, 1] }],
    ["offset", { dir: "higher", sounds: ["first", "you"], at: [0, 1] }], ["offset", { dir: "lower", sounds: ["first", "you"], at: [0, 1] }], ["short", { j: L0.j1 - 1, from: grace, sounds: ["rest"] }],
    ["missed", { j: zing2, sounds: ["note", "you"], at: [0, 1] }], ["missed", { j: grace, sounds: ["note", "you"], at: [0, 1] }],
    ...["touch", "aim", "much"].flatMap((size) => ["higher", "lower"].map((dir) => ["pitch", { j: zing2, dir, size, sounds: ["note", "you"], at: [0, 1] }])),
    ["unclear", { sounds: [] }], ["held", { j: grace, dir: "sooner", range: [L0.j0, grace + 1], sounds: ["stretch", "you"], at: [0, 1] }], ["held", { j: grace, dir: "later", range: [L0.j0, grace + 1], sounds: ["stretch", "you"], at: [0, 1] }],
    ["timing", { j: how, dir: "sooner", range: [L0.j0 + 2, how], sounds: ["stretch", "you"], at: [0, 1] }], ["timing", { j: how, dir: "later", range: [L0.j0 + 2, how], sounds: ["stretch", "you"], at: [0, 1] }],
    ["sag", { dir: "higher", end: false, sounds: ["first", "you"], at: [0, 1] }], ["sag", { dir: "lower", end: true, sounds: ["first", "you"], at: [0, 1] }]];
  const bcues = [["silent", { sounds: [] }], ["slip", { j: L0.j0, dir: "sooner", sounds: ["hear"] }], ["slip", { j: L0.j0, dir: "later", sounds: ["hear"] }], ["unheard", { sounds: [] }],
    ["steady", { dir: "sooner", range: [L0.j0, grace], sounds: ["click", "you"], at: [0, 1] }], ["steady", { dir: "later", range: [L0.j0, grace], sounds: ["click", "you"], at: [0, 1] }],
    ["held", { j: grace, dir: "sooner", range: [L0.j0, grace + 1], sounds: ["click", "you"], at: [0, 1] }], ["drift", { dir: "sooner", range: [L0.j0, L0.j1 - 1], sounds: ["click", "you"], at: [0, 1] }],
    ["drift", { dir: "later", range: [L0.j0, L0.j1 - 1], sounds: ["click", "you"], at: [0, 1] }], ["missed", { j: grace, range: [L0.j0, grace], sounds: ["click"], at: [0, 1] }],
    ["timing", { j: how, dir: "sooner", range: [L0.j0 + 2, how], sounds: ["click", "you"], at: [0, 1] }]];
  for (const [kind, w = {}] of wins) for (const m of ["line", "beats"]) run(m, { counts, win: { kind, ...w }, cue: null, up: { notes: true, beats: false } });
  for (const [kind, c] of cues) run("line", { counts, win: null, cue: { kind, ...c }, fit: { b: 1.3 } });
  for (const [kind, c] of bcues) run("beats", { counts: { beats: 5, beatsAll: false, notes: null }, win: null, cue: { kind, ...c } });
  for (const k of [0, 1]) run("line", { counts: { notes: 11, notesAll: true, beats: 8, beatsAll: true }, win: { kind: "spot" }, cue: null }, { lastLine: !!k });
  run("beats", { counts: { beats: 8, beatsAll: true, notes: null }, win: { kind: "spot" }, cue: null });
  run("line", { counts: { notes: 0, notesAll: false, beats: null, beatsAll: false }, win: null, cue: { kind: "pitch", j: zing2, dir: "higher", size: "aim", sounds: ["note"] } });
  for (const [, , T] of all) {
    for (const p of [T.win, T.cue]) if (p) texts.push(plainOf(p));
    for (const x of [...T.sounds, ...(T.next ? [T.next] : [])]) texts.push(x.label);
  }
  const cs = all.flatMap(([, , T]) => T.counts.map((c) => c.text));
  check(`ear: counts are counts with units (${cs.length})`, cs.every((c) => /^(all|[1-9]\d*) (on the beat|in tune|on the click)$/.test(c)), [...new Set(cs)].join(" | "));
  check("ear: a count at 0 or not judged is left out", all.every(([m, res, T]) => T.counts.length === [res.counts?.beatsAll || res.counts?.beats > 0, m !== "beats" && (res.counts?.notesAll || res.counts?.notes > 0)].filter(Boolean).length));
  const tempos = all.map(([, , T]) => T.tempo?.text).filter(Boolean);
  check("ear: the tempo line (the singer's own, well off the speed heard)", tempos.length > 0 && tempos.every((t) => t === "You sang it at ♩=62"), tempos.join(" | "));
  const named = all.find(([m, res]) => m === "line" && res.cue?.kind === "pitch" && res.cue.size === "aim" && res.cue.dir === "higher")[2];
  check("ear: a note named by its word, its syllable underlined — a melisma's later note says which", plainOf(named.cue) === "“Amazing” (second note) — aim higher" && named.cue.some((x) => x.u === "zing"), JSON.stringify(named.cue));
  const nexts = all.map(([m, res, T]) => `${m}:${res.win?.kind || ""}/${res.cue?.kind || ""}→${T.next?.label || "–"}`);
  check("ear: one next chip, by the cue", all.every(([m, res, T]) => {
    const q = res.cue?.kind, nx = T.next?.label || null;
    if (m === "beats") return nx === (res.counts?.beatsAll ? "Now on your own ›" : null);
    if (q === "pitch" || q === "missed") return nx === "Practise that note ›";
    if (q === "timing" || q === "held") return nx === "Try it with the clicks ›";
    if (!q) return res.counts?.notesAll && res.counts?.beatsAll ? [null, "Next line ›"].includes(nx) : nx === "Try it with the clicks ›";
    return nx === null;
  }), nexts.join(" "));
  const spots = all.filter(([m, res]) => m === "line" && !res.cue && res.counts?.notesAll && res.counts?.beatsAll).map(([, , T]) => T.next?.label || null);
  check("ear: spot on → Next line ›, none on the last line", JSON.stringify(spots) === JSON.stringify(["Next line ›", null]), JSON.stringify(spots));
  const firsts = all.filter(([, , T]) => T.sounds.some((x) => x.label === "▶ First note"));
  check("ear: ▶ First note never a cue's (the action row has it)", !firsts.length);
  check("ear: no ↑, no “—” count, no fraction", all.every(([, , T]) => T.counts.every((c) => !/↑|—|\//.test(c.text))));
}

// Banned words and digits (outside note names) in everything said above.
{
  const NOTE = /[A-G](?:♭|♯|𝄫|𝄪)?-?\d/g;
  const bad = texts.filter((t) => /%|fail|wrong|score|\bround\b/i.test(t) || /\d/.test(t.replace(NOTE, "")));
  check(`banned words / digits (${texts.length} texts)`, !bad.length, bad.join(" | "));
  // (no praise of the person, no body cues; "your first try" is the singer's own past — §5)
  const PERSON = /\byou(?:'re| are)\b|\bgood job\b|\bgreat\b|\btalent|breath|throat|jaw|posture|\bbelly\b/i;
  check("no person or body words", !texts.some((t) => PERSON.test(t)), texts.filter((t) => PERSON.test(t)).join(" | "));
}

// The existing review words still work.
{
  const grades = N.map(() => ({ status: "good", hit: 1, dev: 0 }));
  const rows = analyzeLines(N, s.lines, grades, { text: (li) => `line ${li}`, name: (m) => `m${m}` });
  const fb = feedback(rows, {});
  check("analyzeLines/feedback unchanged", rows.length === s.lines.length && fb.headline === "That one sat really well.");
  check("rhythmText unchanged", rhythmText({ kind: "short", j: 0 }, () => "“x”") === "Hold “x” its full length");
}

console.log(texts.length ? `said: ${[...new Set(texts)].slice(0, 60).join(" | ")}` : "");
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
