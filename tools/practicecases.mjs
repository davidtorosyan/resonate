// practice.js (guided practice, docs/COACHING.md §10 Steps 2 and 4, minus joins and
// adoption): grouping, keys, sections, verdicts, securing, the ladder, rotation, parking,
// self-checks, credit, runs, the next step, and a fuzz over random verdict streams.
// usage: node practicecases.mjs   (fixtures: node dumpnotes.cjs)
import { loadSong, fixtureNames } from "./fixturelib.mjs";
import {
  PRACTICE, groupPhrases, phraseKeys, newDoc, newSession, sessionFor, timeVerdict, tuneVerdict, phraseMarks,
  applyRound, answerSelfCheck, overrule, applyRun, markHeard, nextStep, pickPhrase, singFromHere, stepLabel,
} from "../resonate/public/practice.js";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
};
const letters = (s) => s.toLowerCase().replace(/[^\p{L}]+/gu, "");
const has = (n) => fixtureNames().includes(n);
const song = (name, o) => { const s = loadSong(name, o); return { ...s, ...groupPhrases(s.notes, s.lines, s.opts) }; };
const sig = (g) => g.phrases.map((p) => p.js.join(",")).join("|");

// ---------------------------------------------------------------------------
// Step 2: grouping, keys, sections

const AG = song("amazing-grace");
{
  const want = ["amazinggracehowsweetthesound", "thatsavedawretchlikeme", "ioncewaslostbutnowimfound", "wasblindbutnowisee"];
  check("AG: exactly 4 phrases", AG.phrases.length === 4, AG.phrases.map((p) => p.words).join(" / "));
  check("AG: the phrases of §3.1", AG.phrases.map((p) => letters(p.words)).join("|") === want.join("|"), AG.phrases.map((p) => p.words).join(" / "));
  check("AG: names", AG.phrases.map((p) => p.name).join("|") === "Amazing grace…|That saved a wretch…|I once was lost…|Was blind…", AG.phrases.map((p) => p.name).join("|"));
  check("AG: labels", AG.phrases.map((p) => p.label).join("|") === "Amazing grace|That saved a wretch…|I once was lost|Was blind", AG.phrases.map((p) => p.label).join("|"));
  check("AG: one section", AG.sections.length === 1 && AG.sections[0].p0 === 0 && AG.sections[0].p1 === 4);
  check("AG: phrase fields", AG.phrases.every((p, i) => p.i === i && p.j1 === p.js[p.js.length - 1] + 1 && p.j0 === p.js[0] && p.t1 > p.t0 && p.q1 > p.q0 && typeof p.mk === "string" && p.wk.startsWith(p.mk)));
  check("AG: covers every note once", AG.phrases.flatMap((p) => p.js).join(",") === AG.notes.map((_, j) => j).join(","));
}

// No phrase under the minimum except before a hard boundary; none over 1.5× the maximum.
const PH = PRACTICE.phrase;
for (const name of ["hey-little-songbird", "piano-man"].filter(has)) {
  const g = song(name);
  const short = g.phrases.filter((p, k) => (p.syl < PH.minSyl || p.sec < PH.minSec) && !(k + 1 === g.phrases.length || g.phrases[k + 1].hardBefore));
  check(`${name}: no short phrase except before a hard boundary`, !short.length, short.map((p) => `${p.i} "${p.words}" ${p.syl} syl ${p.sec.toFixed(1)} s`).join("; "));
  const long = g.phrases.filter((p) => p.syl > PH.tailMax * PH.maxSyl || p.sec > PH.tailMax * PH.maxSec + 1e-6);
  check(`${name}: none over 1.5× the maximum`, !long.length, long.map((p) => `${p.i} ${p.syl} syl ${p.sec.toFixed(1)} s`).join("; "));
  check(`${name}: covers every note once`, g.phrases.flatMap((p) => p.js).join(",") === g.notes.map((_, j) => j).join(","));
}

// The song's own tempo groups, never the % rate.
for (const name of ["amazing-grace", "piano-man", "hey-little-songbird"].filter(has)) {
  const a = song(name), b = song(name, { rate: 0.7 });
  check(`${name}: rate 0.7 groups the same`, sig(a) === sig(b) && a.phrases.every((p, k) => p.mk === b.phrases[k].mk && p.wk === b.phrases[k].wk && p.section === b.phrases[k].section));
  check(`${name}: rate 0.7 moves the times`, Math.abs(b.phrases[1].t0 - a.phrases[1].t0 / 0.7) < 1e-6);
}
if (has("piano-man")) {
  // Piano Man came in as ♩=58 (𝅗𝅥. = 58) and is really ♩=174: a typed bpm 174 groups by 174.
  const real = song("piano-man", { bpm: 174 });
  const at58 = loadSong("piano-man", { rate: 174 / 58 }); // the page's times at the score's 58
  const typed = groupPhrases(at58.notes, at58.lines, { ...at58.opts, spq: 60 / 174 });
  const by58 = groupPhrases(at58.notes, at58.lines, { ...at58.opts, spq: 60 / 58 });
  check("Piano Man: bpm 174 groups by 174, not by the score's 58", sig(typed) === sig(real) && sig(by58) !== sig(real), `${typed.phrases.length} vs ${by58.phrases.length} phrases`);
}

// Keys: transpose-invariant; an octave move of one phrase keeps its mk; verses share mk, not wk.
{
  const s = loadSong("amazing-grace");
  const up5 = s.notes.map((n) => ({ ...n, midi: n.midi + 5, name: "X" }));
  const g5 = groupPhrases(up5, s.lines, s.opts);
  check("transpose +5: same mk/wk", g5.phrases.every((p, k) => p.mk === AG.phrases[k].mk && p.wk === AG.phrases[k].wk));
  const written5 = s.notes.map((n) => ({ ...n, wmidi: n.wmidi + 5 }));
  const gw = groupPhrases(written5, s.lines, s.opts);
  check("written in another key: same mk/wk", gw.phrases.every((p, k) => p.mk === AG.phrases[k].mk && p.wk === AG.phrases[k].wk));
  const p2 = AG.phrases[2];
  const oct = s.notes.map((n, j) => (j >= p2.j0 && j < p2.j1 ? { ...n, wmidi: n.wmidi - 12 } : n));
  const go = groupPhrases(oct, s.lines, s.opts);
  check("one phrase an octave down keeps its mk", go.phrases[2].mk === p2.mk && go.phrases[2].wk === p2.wk && go.phrases[1].mk === AG.phrases[1].mk);
  const dq = s.notes.map((n, j) => (j === p2.j0 + 1 ? { ...n, dq: n.dq + 0.5 } : n));
  check("a changed note length changes the mk", groupPhrases(dq, s.lines, s.opts).phrases[2].mk !== p2.mk);
  const k = phraseKeys(s.notes, p2.js, p2.words);
  check("phraseKeys matches the phrase", k.mk === p2.mk && k.wk === p2.wk);
}
{
  const v2 = song("amazing-grace", { verse: "2" });
  check("AG verse 2: first phrase spans the same notes", v2.phrases[0].js.join() === AG.phrases[0].js.join());
  check("AG verse 2: same tune → same mk", v2.phrases[0].mk === AG.phrases[0].mk && v2.phrases[1].mk === AG.phrases[1].mk);
  check("AG verse 2: new words → different wk", v2.phrases[0].wk !== AG.phrases[0].wk && v2.phrases[1].wk !== AG.phrases[1].wk);
}

// Repeats and verse passes are hard boundaries — except for a tail with no words (a held note
// running on into a 2nd ending, a melisma over a pass change): that stays with its phrase (D1).
for (const name of ["wichita-lineman", "killing-me-softly-with-his-song", "the-longest-time"].filter(has)) {
  const g = song(name);
  const mo = g.fx.measureOf;
  const wordless = (js) => js.every((j) => g.notes[j].melisma || !g.notes[j].text);
  const crosses = (p) => p.js.map((j, k) => {
    if (!k) return false;
    const a = g.notes[p.js[k - 1]], b = g.notes[j];
    if (a.pass !== b.pass) return true;
    for (let m = a.mi + 1; m <= b.mi; m++) if (mo[m] !== mo[m - 1] + 1) return true;
    return false;
  });
  const cross = g.phrases.filter((p) => crosses(p).some((x, k) => x && !wordless(p.js.slice(k))));
  check(`${name}: no phrase crosses a pass change or a repeat jump (but for a tail with no words)`, !cross.length, cross.map((p) => `${p.i} "${p.words}"`).join("; "));
  const tails = g.phrases.filter((p) => crosses(p).some(Boolean));
  if (name !== "the-longest-time") check(`${name}: a word-less tail after a jump / pass change joins its phrase`, tails.length === 1, tails.map((p) => `${p.i} "${p.words}"`).join("; "));
  check(`${name}: no phrase without words`, g.phrases.every((p) => p.words), g.phrases.filter((p) => !p.words).map((p) => p.name).join("; "));
  const passes = new Set(g.notes.map((n) => n.pass));
  check(`${name}: has repeats to test`, passes.size > 1);
}

// Sections: the first ends at the first phrase that ends ≥ 75 s after the entry.
for (const name of ["hey-little-songbird", "piano-man", "killing-me-softly-with-his-song", "the-longest-time"].filter(has)) {
  const g = song(name), spq = g.opts.spq;
  const s0 = g.sections[0];
  const endAt = (k) => (g.phrases[k].q1 - g.phrases[0].q0) * spq;
  const first = g.phrases.findIndex((p, k) => endAt(k) >= PRACTICE.section.stopSec);
  const passCut = g.phrases.findIndex((p, k) => k > 0 && p.pass !== g.phrases[k - 1].pass && endAt(k - 1) >= PRACTICE.section.passMinSec);
  const want = passCut > 0 && passCut <= first ? passCut : first + 1;
  check(`${name}: first section ends where §3.1 says`, s0.p1 === want, `p1 ${s0.p1}, want ${want}`);
  check(`${name}: sections tile the phrases`, g.sections.every((s, i) => s.p0 === (i ? g.sections[i - 1].p1 : 0)) && g.sections.at(-1).p1 === g.phrases.length && g.phrases.every((p) => g.sections[p.section].p0 <= p.i && p.i < g.sections[p.section].p1));
}

// No lyrics: notes count as syllables, "Bars …" names.
{
  const s = loadSong("amazing-grace");
  const bare = s.notes.map((n) => ({ ...n, text: "", syllabic: null, melisma: false }));
  const g = groupPhrases(bare, s.lines, s.opts);
  check("no lyrics: Bars names", g.phrases.length >= 2 && g.phrases.every((p) => /^Bars? \d+(–\d+)?$/.test(p.name)), g.phrases.map((p) => p.name).join("|"));
  check("no lyrics: every note a syllable", g.phrases.every((p) => p.syl === p.js.length));
}

// ---------------------------------------------------------------------------
// Verdicts (§3.3)

const N = AG.notes, P1 = AG.phrases[1]; // "That saved a wretch like me!"
const beat = 0.75;
const R = (o = {}) => ({ trust: "ok", calibrated: true, guide: "click", tapped: false, lag: 0.02, beat, measuredRt: true, cover: 0.9,
  classified: 5, syllables: 6, obs: [], takeObs: [], leadN: 5, seedAgrees: true, ...o });
const G = (st = "good", o = {}) => { const g = []; for (const j of P1.js) g[j] = { status: st, hit: st === "good" ? 1 : st === "ok" ? 0.9 : 0, dev: 0, shift: 0, ...o }; return g; };
const tv = (r, grades = G(), tapped = false) => timeVerdict({ ph: P1, r, grades, notes: N, tapped });
const e = P1.js.find((j) => !N[j].melisma);
{
  check("time: no recording → unknown", tv(null).v === "unknown" && tv(null).cue === null);
  check("time: clicks not trusted → unknown", tv(R({ trust: "speaker-guide" })).v === "unknown");
  check("time: melody guide → unknown", tv(R({ guide: "melody" })).v === "unknown");
  check("time: a beat late with a measured trip → slip", (() => { const v = tv(R({ lag: 0.6 * beat })); return v.v === "slip" && v.cue.kind === "slip" && v.cue.j === e && v.cue.dir === "late"; })());
  check("time: 0.3 s late at a fast tempo, measured → slip", tv(R({ lag: 0.3, beat: 0.35 })).v === "slip");
  check("time: 0.3 s late at a fast tempo, unmeasured → not a slip", tv(R({ lag: 0.3, beat: 0.35, calibrated: false, measuredRt: false })).v !== "slip");
  check("time: 0.4 s late at a fast tempo, unmeasured → slip", tv(R({ lag: 0.4, beat: 0.35, calibrated: false, measuredRt: false })).v === "slip");
  // (a long round trip measured from the clicks — Bluetooth — still places the first sound right)
  check("time: 0.3 s late at a fast tempo, measured long trip → slip", tv(R({ lag: 0.3, beat: 0.35, calibrated: true, measuredRt: false })).v === "slip");
  check("time: early lag is never a slip by itself", tv(R({ lag: -0.8 })).v !== "slip");
  check("time: early-in counting a beat → slip, early", (() => { const v = tv(R({ obs: [{ kind: "early-in", tone: "try", scope: "line", j: e, count: true }] })); return v.v === "slip" && v.cue.dir === "early"; })());
  check("time: unheard", (() => { const v = tv(R({ cover: 0.1, lag: null })); return v.v === "unheard" && v.cue.kind === "unheard"; })());
  check("time: silent singer is unheard, not a slip", tv(R({ cover: 0, lag: null })).v === "unheard");
  const pri = tv(R({ obs: [{ kind: "short", tone: "try", scope: "line", j: P1.js[3] }, { kind: "late-in", tone: "try", scope: "line", j: e }, { kind: "rushing", tone: "try", scope: "line" }] }));
  check("time: cue priority entry > rushing > short", pri.v === "try" && pri.cue.kind === "late-in" && pri.facts.nCues === 3, JSON.stringify(pri.cue));
  check("time: rushing > short", tv(R({ obs: [{ kind: "short", tone: "try", scope: "line", j: P1.js[3] }, { kind: "dragging", tone: "try", scope: "line" }] })).cue.kind === "dragging");
  const ahead = [{ kind: "behind", tone: "try", scope: "take" }];
  check("time: behind counts with everything measured", tv(R({ takeObs: ahead })).cue?.kind === "behind");
  check("time: behind needs ≥ 4 on-beat attacks", tv(R({ takeObs: ahead, leadN: 3 })).v === "pass");
  check("time: behind needs a measured trip", tv(R({ takeObs: ahead, measuredRt: false })).v === "pass");
  check("time: behind needs the click guide", tv(R({ takeObs: ahead, guide: "none" })).v === "pass");
  check("time: behind needs the seed to agree", tv(R({ takeObs: ahead, seedAgrees: false })).v === "pass");
  check("time: behind not with a tapped map", tv(R({ takeObs: ahead }), G(), true).v !== "try");
  check("time: tapped map — a try becomes unsure", tv(R({ obs: [{ kind: "rushing", tone: "try", scope: "line" }] }), G(), true).v === "unsure");
  check("time: tapped map — a slip still counts", tv(R({ lag: 0.7 }), G(), true).v === "slip");
  check("time: little evidence → unsure", tv(R({ classified: 1 }), G("off")).v === "unsure");
  const sh = tv(R({ classified: 1 }), G("good", { shift: 0.05 }));
  check("time: shifts stand in as evidence", sh.v === "pass" && sh.ev === "shift");
  const gs = G("good"); gs[P1.js[2]].shift = 0.3;
  check("time: a stray shift is no evidence", tv(R({ classified: 1 }), gs).v === "unsure");
  check("time: a laid-back style lag is a pass", tv(R({ obs: [{ kind: "laid-back", tone: "style", scope: "take" }] })).v === "pass");
  const ok = tv(R({ obs: [{ kind: "steady-line", tone: "good", scope: "line" }], notes: Object.assign([], { [e]: { cls: "on" }, [P1.js.at(-1)]: { cls: "on", rel: 0.02 } }) }));
  check("time: pass with facts for wins", ok.v === "pass" && ok.ev === "onsets" && ok.facts.entryOk && ok.facts.steady && ok.facts.heldOkJ === P1.js.at(-1), JSON.stringify(ok.facts));
  check("time: entry ok from the lag when no per-note data", tv(R({ lag: 0.03 })).facts.entryOk === true && tv(R({ lag: 0.3 })).facts.entryOk === false);
}
const uv = (grades, r = R()) => tuneVerdict({ ph: P1, r, grades, notes: N });
{
  check("tune: all good → pass with credit", (() => { const v = uv(G()); return v.v === "pass" && v.facts.credit && v.facts.allFound; })());
  check("tune: slip in the same round → slip (the cue)", uv(G(), R({ lag: 0.7 })).v === "slip");
  check("tune: no recording, still judged by pitch", uv(G(), null).v === "pass");
  check("tune: mostly unclear → unknown, mic", (() => { const v = uv(G("unclear")); return v.v === "unknown" && v.cue.kind === "mic"; })());
  const g1 = G(); g1[P1.js[6]] = { status: "off", hit: 0, dev: -1.2 }; // "wretch" (2 quarters) sung low
  const v1 = uv(g1);
  check("tune: an off note a beat long → try, up to", v1.v === "try" && v1.cue.kind === "note" && v1.cue.j === P1.js[6] && v1.cue.dir === "up", JSON.stringify(v1));
  const g2 = G(); g2[P1.js[0]] = { status: "missed", hit: 0 }; g2[P1.js[1]] = { status: "missed", hit: 0 }; g2[P1.js[6]] = { status: "off", hit: 0, dev: 1 };
  check("tune: missed > off", uv(g2).cue.kind === "missed");
  const g3 = G("ok", { dev: -0.3, hit: 0.7 });
  check("tune: lean → flat", uv(g3).cue.kind === "flat");
  const g4 = G(); g4[P1.js[3]] = { status: "off", hit: 0, dev: 0.8 }; // a short off note (⅓ quarter)
  const v4 = uv(g4);
  check("tune: a short off note can still pass, without credit", v4.v === "pass" && !v4.facts.credit, JSON.stringify(v4.facts));
  check("tune: nothing sung → unknown, no cue", uv(G("unsung")).v === "unknown" && uv(G("unsung")).cue === null);
}

// ---------------------------------------------------------------------------
// Securing, the ladder, rotation, self-checks, credit (§3.4)

const T0 = Date.UTC(2026, 10, 11, 18);
let clock = T0;
const tick = (s = 20) => (clock += s * 1000);
const V = (v, cue = null, facts = {}) => ({ v, cue, facts: { nCues: cue ? 1 : 0, ...facts }, ev: v === "pass" ? "onsets" : null });
const PASS = () => V("pass"), TRY = () => V("try", { kind: "short", j: e }), UNS = () => V("unsure");
const CREDIT = () => ({ ...V("pass"), tune: { v: "pass", facts: { credit: true, score: 0.95 } } });
// A doc after the first run (everything reached, nothing marked) + a session.
function started(g = AG) {
  let doc = markHeard(newDoc(), clock), session = newSession(clock, "s");
  const covered = g.phrases.map((p) => p.i);
  ({ doc, session } = applyRun(doc, session, g, covered, covered.map(() => ({ time: V("unsure"), tune: V("try", { kind: "note", j: 0 }) })), { rate: 1, guide: "click", first: true, at: clock }, clock));
  return { doc, session };
}
// Run rounds on phrase p at `stage` with the setups nextStep gives.
function rounds(st, g, p, stage, verdicts) {
  const out = [];
  for (const mkv of verdicts) {
    const step = pickPhrase(st.doc, g, st.session, p);
    const next = nextStep(st.doc, g, st.session, clock);
    const setup = next.kind === "stage" && next.p === p && next.stage === stage ? next.setup : step.setup;
    const r = applyRound(st.doc, st.session, g.phrases[p], stage, mkv(), setup, tick());
    st.doc = r.doc; st.session = r.session;
    out.push({ setup, event: r.event, alsoTune: r.alsoTune, fullSpeed: r.fullSpeed });
  }
  return out;
}
const mOf = (st, p, g = AG) => st.doc.m[g.phrases[p].mk];
{
  let st = started();
  let r = rounds(st, AG, 1, "time", [PASS, PASS]);
  check("secure: pass → confirm pass → secured", !r[0].setup.confirm && r[1].setup.confirm && r[1].event === "secured" && mOf(st, 1).time?.by === "earned", JSON.stringify(r));
  check("secure: the confirm round has the lane off, In time neutral before", r[0].setup.lane === "neutral" && r[1].setup.lane === "off");
  st = started();
  r = rounds(st, AG, 1, "time", [PASS, TRY, PASS]);
  check("secure: pass → confirm try → confirm pass → secured", r[1].setup.confirm && r[2].setup.confirm && r[1].event === null && r[2].event === "secured", JSON.stringify(r.map((x) => [x.setup.confirm, x.event])));
  st = started();
  r = rounds(st, AG, 1, "time", [PASS, TRY, TRY, PASS]);
  check("secure: pass → try → try → a learning round", r[1].setup.confirm && r[2].setup.confirm && !r[3].setup.confirm && r[3].event === null, JSON.stringify(r.map((x) => x.setup)));
  const next = nextStep(st.doc, AG, st.session, clock);
  check("secure: … then a confirm again", next.kind === "stage" && next.p === 1 && next.setup.confirm && next.cont);
  // (at rest — e.g. after ■ Stop mid-block — the confirm step names its phrase and goes on with ● Go; v76 review)
  check("label: between rounds before a confirm", /^“That saved…” · once more$/.test(stepLabel(next, AG).title) && stepLabel(next, AG).button === "● Go", JSON.stringify(stepLabel(next, AG)));

  // Ladder: In time tries 1/2/3 → same / 0.9 / 0.8 (the floor), a pass at 0.9 confirmed at 0.9.
  st = started();
  r = rounds(st, AG, 1, "time", [TRY, TRY, TRY, TRY]);
  check("ladder (time): same / same / 0.9 / 0.8", r.map((x) => x.setup.rate).join() === "1,1,0.9,0.8", r.map((x) => x.setup.rate).join());
  check("ladder (time): stays at the floor", nextStep(st.doc, AG, st.session, clock).setup.rate === 0.8);
  check("label: slower", stepLabel(nextStep(st.doc, AG, st.session, clock), AG).title === "“That saved…” · in time · slower", stepLabel(nextStep(st.doc, AG, st.session, clock), AG).title);
  st = started();
  r = rounds(st, AG, 1, "time", [TRY, TRY, PASS, PASS]);
  check("ladder: a pass at 0.9 → confirm at 0.9 → secured at 0.9", r[2].setup.rate === 0.9 && r[3].setup.rate === 0.9 && r[3].setup.confirm && r[3].event === "secured" && mOf(st, 1).time.rate === 0.9, JSON.stringify(r.map((x) => x.setup.rate)));
  check("marks: earned slower is flagged", phraseMarks(st.doc, AG.phrases[1]).slower === true);
  // In tune: same, same, 0.9, 0.8
  st = started();
  ({ doc: st.doc, session: st.session } = overrule(st.doc, st.session, AG.phrases[1], tick()));
  r = rounds(st, AG, 1, "tune", [TRY, TRY, TRY, TRY, TRY]);
  check("ladder (tune): same / same / same / 0.9 / 0.8", r.map((x) => x.setup.rate).join() === "1,1,1,0.9,0.8", r.map((x) => x.setup.rate).join());

  // Rotate after 6 counted rounds; left out for 2 steps; back with its rate.
  st = started();
  r = rounds(st, AG, 1, "time", [TRY, TRY, TRY, TRY, TRY, TRY]);
  check("rotate: after 6 counted rounds", r[5].event === "rotate" && r.slice(0, 5).every((x) => x.event === null), r.map((x) => x.event).join());
  const steps = [];
  for (let k = 0; k < 2; k++) {
    const s = nextStep(st.doc, AG, st.session, clock);
    steps.push(s);
    if (s.kind === "stage") {
      const res = rounds(st, AG, s.p, s.stage, [PASS, PASS]);
      if (res[1].event !== "secured") break;
    }
  }
  check("rotate: left out for the next 2 steps", steps.every((s) => s.p !== 1), steps.map((s) => `${s.kind}:${s.p}`).join());
  const back = pickPhrase(st.doc, AG, st.session, 1);
  check("rotate: comes back with its rate", back.setup.rate === 0.8 && mOf(st, 1).step.recent.length === 3, JSON.stringify(back.setup));
  // Park after 2 rotations in one session; then "Finish with".
  r = rounds(st, AG, 1, "time", [TRY, TRY, TRY, TRY, TRY, TRY]);
  check("park: the second rotation parks", r[5].event === "park" && st.session.parked[AG.phrases[1].mk], r.map((x) => x.event).join());
  const fin = nextStep(st.doc, AG, st.session, clock);
  check("park: then Finish with a phrase that has ♪", fin.kind === "finish" && st.doc.m[AG.phrases[fin.p].mk]?.tune, JSON.stringify(fin));
  check("label: finish", /^Finish with “.+”$/.test(stepLabel(fin, AG).title), stepLabel(fin, AG).title);
  const after = applyRun(st.doc, st.session, AG, [fin.p], [{ time: V("pass"), tune: V("pass", null, { credit: true }) }], { rate: 1, guide: "click", at: tick() }, clock);
  let s2 = after.session, d2 = after.doc;
  for (let k = 0; k < 8; k++) {
    const s = nextStep(d2, AG, s2, clock);
    check(`park: parked phrase left out this session (${k})`, s.p !== 1 || s.kind === "finish");
    if (s.kind !== "stage") { const rr = applyRun(d2, s2, AG, rangeOf(s), rangeOf(s).map(() => ({ time: V("pass"), tune: V("pass", null, { credit: true }) })), { rate: 1, guide: "click", at: tick() }, clock); d2 = rr.doc; s2 = rr.session; continue; }
    let x = { doc: d2, session: s2 };
    rounds(x, AG, s.p, s.stage, [PASS, PASS]);
    d2 = x.doc; s2 = x.session;
  }
  const tomorrow = sessionFor(s2, "s", clock + 20 * 3600e3);
  check("park: a new session after 3 h", tomorrow !== s2 && !tomorrow.parked[AG.phrases[1].mk] && sessionFor(s2, "s", clock + 3600e3) === s2);
  // (runs here hear nothing, so the parked phrase gets no credit from them)
  const again = nextStepUntil(st.doc, sessionFor(st.session, "s", clock + 20 * 3600e3), (s) => s.kind === "stage" && s.p === 1, 12, () => ({ time: V("unsure"), tune: V("unknown") }));
  check("park: the next session brings it back", again && again.stage === "time" && again.setup.rate === 0.8, JSON.stringify(again));

  // Self-check after 2 uncounted rounds; Yes secures (self) and marks thin; thin → after 1.
  st = started();
  r = rounds(st, AG, 2, "time", [UNS, UNS]);
  check("self-check: after 2 uncounted rounds", r[0].event === null && r[1].event === "self-check" && nextStep(st.doc, AG, st.session, clock).kind === "selfcheck");
  check("label: self-check", stepLabel(nextStep(st.doc, AG, st.session, clock), AG).title === "Sounded right?");
  let y = answerSelfCheck(st.doc, st.session, AG.phrases[2], "time", true, tick());
  check("self-check: Yes secures by self, thin", y.event === "secured" && y.doc.m[AG.phrases[2].mk].time.by === "self" && y.doc.m[AG.phrases[2].mk].thin);
  const nx = nextStep(y.doc, AG, y.session, clock);
  check("after ♩: the same phrase in tune", nx.kind === "stage" && nx.p === 2 && nx.stage === "tune", JSON.stringify(nx));
  check("label: in tune", stepLabel(nx, AG).title === "“I once was lost…” · in tune", stepLabel(nx, AG).title);
  st = { doc: y.doc, session: y.session };
  r = rounds(st, AG, 2, "tune", [() => V("unknown", { kind: "mic" })]);
  check("self-check: a thin phrase goes after 1 uncounted round", r[0].event === "self-check");
  y = answerSelfCheck(st.doc, st.session, AG.phrases[2], "tune", false, tick());
  check("self-check: Again goes on", y.event === null && nextStep(y.doc, AG, y.session, clock).kind === "stage" && nextStep(y.doc, AG, y.session, clock).cont);
  st = started();
  r = rounds(st, AG, 2, "time", [UNS, PASS, UNS]);
  check("self-check: an uncounted round between counted ones doesn't add up", r.every((x) => x.event !== "self-check"));
  st = started();
  r = rounds(st, AG, 2, "time", [PASS, UNS, PASS]);
  check("uncounted rounds break nothing", r[1].setup.confirm && r[2].setup.confirm && r[2].event === "secured");

  // Slips count In time; In tune they're only the cue. Either way a counting slip steps the
  // tempo down at once (90%, then 80%) — the ladder's slip row.
  const SLIP = () => V("slip", { kind: "slip", j: e, dir: "late" });
  st = started();
  r = rounds(st, AG, 1, "time", [SLIP, SLIP, SLIP]);
  check("slip: counted In time, slower at once", r.map((x) => x.setup.rate).join() === "1,0.9,0.8" && mOf(st, 1).step.miss === 3, r.map((x) => x.setup.rate).join());
  st = started();
  r = rounds(st, AG, 1, "time", [PASS, SLIP, PASS]);
  check("slip: a slipped confirm is tried again, slower", r[1].setup.confirm && r[1].setup.rate === 1 && r[2].setup.confirm && r[2].setup.rate === 0.9 && r[2].event === "secured" && mOf(st, 1).time.rate === 0.9, JSON.stringify(r.map((x) => x.setup)));
  st = started();
  ({ doc: st.doc, session: st.session } = overrule(st.doc, st.session, AG.phrases[1], tick()));
  r = rounds(st, AG, 1, "tune", [SLIP, SLIP, SLIP]);
  check("slip: uncounted In tune, no self-check", r.every((x) => x.event === null) && mOf(st, 1).step.rounds === 0 && mOf(st, 1).step.miss === 0);
  check("slip: In tune too, the tempo steps down", r.map((x) => x.setup.rate).join() === "1,0.9,0.8", r.map((x) => x.setup.rate).join());
  r = rounds(st, AG, 1, "tune", [PASS]);
  check("slip: a counted round ends the slip run (rate stays down)", nextStep(st.doc, AG, st.session, clock).setup.rate === 0.8 && mOf(st, 1).step.slips === 0);

  // Credit for both: In time passes at the pitch credit bar secure ♪ too.
  st = started();
  r = rounds(st, AG, 1, "time", [CREDIT, CREDIT]);
  check("credit: an In time pass at the credit bar secures ♪ too", r[1].event === "secured" && r[1].alsoTune && mOf(st, 1).tune?.by === "credit");
  check("credit: then not in tune again", !(nextStep(st.doc, AG, st.session, clock).p === 1 && nextStep(st.doc, AG, st.session, clock).stage === "tune"));
  st = started();
  r = rounds(st, AG, 1, "time", [TRY, CREDIT, PASS]);
  check("credit: one credit pass carries into In tune", r[2].event === "secured" && !r[2].alsoTune && !mOf(st, 1).tune);
  const tn = nextStep(st.doc, AG, st.session, clock);
  check("credit: … whose first round is a confirm", tn.kind === "stage" && tn.stage === "tune" && tn.p === 1 && tn.setup.confirm && !tn.cont && stepLabel(tn, AG).title === "“That saved a wretch…” · in tune", JSON.stringify([tn.setup, stepLabel(tn, AG)]));
  check("in tune: confirm keeps the bars, hides the trail", tn.setup.lane === "on" && tn.setup.trail === false);
  r = rounds(st, AG, 1, "tune", [PASS]);
  check("credit: … and one more pass secures ♪", r[0].event === "secured" && mOf(st, 1).tune?.by === "earned");

  // Overrule
  st = started();
  const o = overrule(st.doc, st.session, AG.phrases[3], tick());
  check("overrule: ♩ by override, then in tune", o.doc.m[AG.phrases[3].mk].time.by === "override" && nextStep(o.doc, AG, o.session, clock).p === 3 && nextStep(o.doc, AG, o.session, clock).stage === "tune");

  // Full speed: a mark earned slower slips in a run at the song's tempo → "· full speed".
  st = started();
  rounds(st, AG, 1, "time", [TRY, TRY, PASS, PASS]);
  // (D2: a redo needs 2 run slips — the first leaves the phrase as it was, waiting for a run)
  const slipRun = (x) => applyRun(x.doc, x.session, AG, [0, 1, 2], [0, 1, 2].map((k) => ({ time: k === 1 ? V("try", { kind: "late-in", j: e }) : V("pass"), tune: V("pass") })), { rate: 1, guide: "click", at: tick() }, clock);
  const rr1 = slipRun(st);
  check("full speed: one slip in a run → not due yet", !rr1.doc.m[AG.phrases[1].mk].redo && rr1.doc.m[AG.phrases[1].mk].rs === 1, JSON.stringify(rr1.doc.m[AG.phrases[1].mk].redo));
  const rr = slipRun(rr1);
  check("full speed: a second slip in a run on a slower mark → due", rr.doc.m[AG.phrases[1].mk].redo === "time");
  const fs = pickPhrase(rr.doc, AG, rr.session, 1);
  check("full speed: the step", fs.stage === "time" && fs.extra === "full speed" && fs.setup.rate === 1 && stepLabel(fs, AG).title === "“That saved…” · full speed", JSON.stringify([fs.extra, stepLabel(fs, AG)]));
  st = { doc: rr.doc, session: rr.session };
  r = rounds(st, AG, 1, "time", [PASS, PASS]);
  check("full speed: first pass at the song's tempo after slower", r[0].fullSpeed && r[1].event === "secured" && !mOf(st, 1).redo && !phraseMarks(st.doc, AG.phrases[1]).slower);
  // … and a full-speed block the ladder slowed (a counting slip → 90%) says so on the card.
  st = { doc: rr.doc, session: rr.session };
  rounds(st, AG, 1, "time", [() => V("slip", { kind: "slip", j: e, dir: "late" })]);
  const fs2 = nextStep(st.doc, AG, st.session, clock);
  check("full speed: slowed by a slip → the card says slower", fs2.cont && fs2.setup.rate === 0.9 && stepLabel(fs2, AG).title === "“That saved…” · in time · slower", JSON.stringify([fs2.setup.rate, stepLabel(fs2, AG)]));
}

// A first run that went well everywhere (♩♪ by credit, never ✓ on a first run): the next step
// sings it again for ✓ — not "Finish with" (that's for after a park).
{
  let doc = markHeard(newDoc(), clock), session = newSession(clock, "s");
  const cov = AG.phrases.map((p) => p.i);
  ({ doc, session } = applyRun(doc, session, AG, cov, cov.map(() => ({ time: V("pass"), tune: V("pass", null, { credit: true }) })), { rate: 1, guide: "click", first: true, at: tick(), kind: "first" }, clock));
  const s1 = nextStep(doc, AG, session, clock);
  check("first run all ♩♪ → a run over it, not Finish with", s1.kind === "run" && s1.from === 0 && s1.to === 3 && stepLabel(s1, AG).title === "Sing to “Was blind”", JSON.stringify([s1.kind, s1.from, s1.to, stepLabel(s1, AG)]));
  ({ doc, session } = applyRun(doc, session, AG, cov, cov.map(() => ({ time: V("pass"), tune: V("pass", null, { credit: true }) })), { rate: 1, guide: "click", at: tick(), kind: "run" }, clock));
  check("… which gives ✓ everywhere, then Sing it through", AG.phrases.every((p) => phraseMarks(doc, p).song) && nextStep(doc, AG, session, clock).kind === "through");
  // a run that moved nothing is not asked for again at once
  let d2 = markHeard(newDoc(), clock), s2 = newSession(clock, "s");
  ({ doc: d2, session: s2 } = applyRun(d2, s2, AG, cov, cov.map(() => ({ time: V("pass"), tune: V("pass", null, { credit: true }) })), { rate: 1, guide: "click", first: true, at: tick() }, clock));
  ({ doc: d2, session: s2 } = applyRun(d2, s2, AG, cov, cov.map(() => ({ time: V("unsure"), tune: V("try", { kind: "note", j: 0 }) })), { rate: 1, guide: "click", at: tick() }, clock));
  const s3 = nextStep(d2, AG, s2, clock);
  check("a run with nothing new → not the same run again", !(s3.kind === "run" && s3.from === 0 && s3.to === 3), JSON.stringify([s3.kind, s3.from, s3.to]));
}
// Sing on into a short last section that went well: a run there next, not "Finish with".
if (has("wichita-lineman")) {
  const W = song("wichita-lineman");
  let doc = markHeard(newDoc(), clock), session = newSession(clock, "w");
  const last = W.sections.at(-1);
  const upTo = W.phrases.map((p) => p.i).filter((i) => i < last.p0);
  ({ doc, session } = applyRun(doc, session, W, upTo, upTo.map(() => ({ time: V("pass"), tune: V("pass", null, { credit: true }) })), { rate: 1, guide: "click", first: true, at: tick() }, clock));
  ({ doc, session } = applyRun(doc, session, W, upTo, upTo.map(() => ({ time: V("pass"), tune: V("pass") })), { rate: 1, guide: "click", at: tick() }, clock));
  const on = nextStep(doc, W, session, clock);
  const span = rangeOf(on);
  ({ doc, session } = applyRun(doc, session, W, span, span.map(() => ({ time: V("pass"), tune: V("pass", null, { credit: true }) })), { rate: 1, guide: "click", at: tick(), kind: on.kind }, clock));
  const nx = nextStep(doc, W, session, clock);
  check("wichita: Sing on into the last section, then a run there (not Finish with)", on.kind === "singon" && nx.kind === "run" && nx.to === last.p1 - 1, JSON.stringify([on.kind, on.from, on.to, nx.kind, nx.from, nx.to, stepLabel(nx, W).title]));
}

// The phrases a run step covers.
function rangeOf(s) { const out = []; for (let k = s.from; k <= s.to; k++) out.push(k); return out; }
function nextStepUntil(doc, session, pred, n = 12, runRes = () => ({ time: V("pass"), tune: V("pass", null, { credit: true }) })) {
  let st = { doc, session };
  for (let k = 0; k < n; k++) {
    const s = nextStep(st.doc, AG, st.session, clock);
    if (pred(s)) return s;
    if (s.kind === "stage") rounds(st, AG, s.p, s.stage, [PASS, PASS]);
    else if (s.kind === "selfcheck") Object.assign(st, answerSelfCheck(st.doc, st.session, AG.phrases[s.p], s.stage, true, tick()));
    else Object.assign(st, applyRun(st.doc, st.session, AG, rangeOf(s), rangeOf(s).map(runRes), { rate: 1, guide: "click", at: tick() }, clock));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Runs and credit (§3.3, §4.4)
{
  const all = AG.phrases.map((p) => p.i);
  let doc = markHeard(newDoc(), clock), session = newSession(clock, "s");
  const res = [
    { time: V("pass"), tune: V("pass", null, { credit: true }) },
    { time: V("try", { kind: "short", j: e }), tune: V("pass", null, { credit: true }) },
    { time: V("pass"), tune: V("try", { kind: "note", j: 0 }) },
    { time: V("unsure"), tune: V("pass", null, { credit: true }) },
  ];
  let r = applyRun(doc, session, AG, all, res, { rate: 1, guide: "click", first: true, at: tick() }, clock);
  const mk = (p) => phraseMarks(r.doc, AG.phrases[p]);
  check("first run: ♩♪ credit for a pass at the credit bar", mk(0).time && mk(0).tune && !mk(0).song);
  check("first run: a timing try gets nothing", !mk(1).time && !mk(1).tune);
  check("first run: ♩ only when the pitch misses the bar", mk(2).time && !mk(2).tune);
  check("first run: no ♩ (so no ♪) when timing is unsure", !mk(3).time && !mk(3).tune);
  check("first run: everything reached, then kept", all.every((p) => mk(p).reached && r.doc.w[AG.phrases[p].wk].then.rec));
  check("first run: ✓ never from a phrase's first run", all.every((p) => !mk(p).song));
  check("first run: moved lists the credit", JSON.stringify(r.moved.sort()) === JSON.stringify([[0, "time"], [0, "tune"], [2, "time"]].sort()), JSON.stringify(r.moved));
  check("first run: doc counters", r.doc.runs === 1 && r.doc.firstRun && r.doc.stepsSinceRun === 0);
  const mel = applyRun(doc, session, AG, all, res, { rate: 1, guide: "melody", first: true, at: clock }, clock);
  check("first run: no credit from a melody-guide take", all.every((p) => !phraseMarks(mel.doc, AG.phrases[p]).time && !phraseMarks(mel.doc, AG.phrases[p]).tune));
  // A later run: ✓ for phrases that had ♪, improved where the first try was worse.
  const res2 = all.map(() => ({ time: V("pass"), tune: V("pass", null, { credit: true }) }));
  const r2 = applyRun(r.doc, r.session, AG, all, res2, { rate: 1, guide: "click", at: tick() }, clock);
  check("run: ✓ for a phrase that had ♪ before", phraseMarks(r2.doc, AG.phrases[0]).song && r2.moved.some(([i, m]) => i === 0 && m === "song"));
  check("run: ♪ now but not before → no ✓ yet", !phraseMarks(r2.doc, AG.phrases[1]).song && phraseMarks(r2.doc, AG.phrases[1]).tune);
  check("run: improved = worse then, passed now", r2.improved.sort().join() === "1,2,3", r2.improved.join());
  const slow = applyRun(r.doc, r.session, AG, all, res2, { rate: 0.9, guide: "click", at: tick() }, clock);
  check("run: no ✓ below the song's tempo", !phraseMarks(slow.doc, AG.phrases[0]).song && !slow.improved.length);
  const tuneTry1 = applyRun(r.doc, r.session, AG, [0], [{ time: V("pass"), tune: V("try", { kind: "note", j: 0 }) }], { rate: 1, guide: "click", at: tick() }, clock);
  check("run: one tune try on a ♪ phrase → nothing due yet", !tuneTry1.doc.m[AG.phrases[0].mk].redo && phraseMarks(tuneTry1.doc, AG.phrases[0]).due === null && tuneTry1.doc.m[AG.phrases[0].mk].rs === 1);
  const tuneTry = applyRun(tuneTry1.doc, tuneTry1.session, AG, [0], [{ time: V("pass"), tune: V("try", { kind: "note", j: 0 }) }], { rate: 1, guide: "click", at: tick() }, clock);
  check("run: a second tune try on a ♪ phrase → in tune again", tuneTry.doc.m[AG.phrases[0].mk].redo === "tune" && pickPhrase(tuneTry.doc, AG, tuneTry.session, 0).extra === "again" && stepLabel(pickPhrase(tuneTry.doc, AG, tuneTry.session, 0), AG).title === "“Amazing grace…” · in tune again");
  const held = applyRun(tuneTry.doc, tuneTry.session, AG, [0], [{ time: V("pass"), tune: V("pass") }], { rate: 1, guide: "click", at: tick() }, clock);
  check("run: held in the song clears “again”", !held.doc.m[AG.phrases[0].mk].redo && phraseMarks(held.doc, AG.phrases[0]).song);
  check("run: unsure gets the benefit of the doubt", phraseMarks(applyRun(r.doc, r.session, AG, [0], [{ time: V("unsure"), tune: V("unknown") }], { rate: 1, guide: "click", at: tick() }, clock).doc, AG.phrases[0]).song);
}

// ---------------------------------------------------------------------------
// The next step (§4.1): hear → first run → stage → run → sing on → through

{
  let doc = newDoc(), session = newSession(clock, "s");
  let s = nextStep(doc, AG, session, clock);
  check("next: hear first", s.kind === "hear" && s.from === 0 && s.to === 3 && s.setup.listen && stepLabel(s, AG).title === "Hear it first" && stepLabel(s, AG).button === "▶ Hear it");
  doc = markHeard(doc, tick());
  s = nextStep(doc, AG, session, clock);
  check("next: then the first run", s.kind === "first" && s.from === 0 && s.to === 3 && s.setup.view === "perform" && stepLabel(s, AG).title === "Sing to “Was blind”" && stepLabel(s, AG).button === "● Sing", JSON.stringify([s, stepLabel(s, AG)]));
  // §7.3: the first run gives P1 and P3 ♩, P4 ♩♪.
  const res = [{ time: V("pass"), tune: V("try", { kind: "note", j: 0 }) }, { time: V("try", { kind: "short", j: e }), tune: V("pass") }, { time: V("pass"), tune: V("try", { kind: "note", j: 0 }) }, { time: V("pass"), tune: V("pass", null, { credit: true }) }];
  ({ doc, session } = applyRun(doc, session, AG, [0, 1, 2, 3], res, { rate: 1, guide: "click", first: true, at: tick() }, clock));
  s = nextStep(doc, AG, session, clock);
  check("next: a phrase step after the first run", s.kind === "stage", JSON.stringify(s));
  check("next: lower stage first — “That saved…” in time", s.p === 1 && s.stage === "time" && stepLabel(s, AG).title === "“That saved a wretch…” · in time" && stepLabel(s, AG).button === "● Go", JSON.stringify([s.p, s.stage, stepLabel(s, AG)]));
  check("next: More has a next-best step", s.alt.length >= 1 && s.alt[0].kind === "stage" && s.alt[0].p !== 1);
  // Walk the plan with a singer who passes everything at the credit bar: steps, runs, through.
  const st = { doc, session };
  const kinds = [];
  for (let k = 0; k < 30; k++) {
    const x = nextStep(st.doc, AG, st.session, clock);
    kinds.push(x.kind === "stage" ? `${x.stage}:${x.p}` : `${x.kind}:${x.from}-${x.to}`);
    if (x.kind === "through") break;
    if (x.kind === "stage") rounds(st, AG, x.p, x.stage, [CREDIT, CREDIT]);
    else Object.assign(st, applyRun(st.doc, st.session, AG, rangeOf(x), rangeOf(x).map(() => ({ time: V("pass"), tune: V("pass", null, { credit: true }) })), { rate: 1, guide: "click", at: tick() }, clock));
  }
  check("next: a good singer reaches Sing it through", kinds.at(-1).startsWith("through"), kinds.join(" "));
  check("next: a run comes between phrase steps", kinds.some((k) => k.startsWith("run")), kinds.join(" "));
  check("next: no step twice in a row", kinds.every((k, i) => !i || k !== kinds[i - 1]), kinds.join(" "));
  check("label: through", stepLabel(nextStep(st.doc, AG, st.session, clock), AG).title === "Sing it through");
}

// Runs: due after 4 steps or after 2 new ♪; start rules; Sing on; every third pick elsewhere.
if (has("hey-little-songbird")) {
  const SB = song("hey-little-songbird");
  const s0 = SB.sections[0], s1 = SB.sections[1];
  let doc = markHeard(newDoc(), clock), session = newSession(clock, "sb");
  const cov0 = rangeOf({ from: s0.p0, to: s0.p1 - 1 });
  const first = nextStep(doc, SB, session, clock);
  check("SB: the first run is the first section", first.kind === "first" && first.from === s0.p0 && first.to === s0.p1 - 1, `${first.from}–${first.to} vs ${s0.p0}–${s0.p1 - 1}`);
  ({ doc, session } = applyRun(doc, session, SB, cov0, cov0.map(() => ({ time: V("try", { kind: "short", j: 0 }), tune: V("try", { kind: "note", j: 0 }) })), { rate: 1, guide: "click", first: true, at: tick() }, clock));
  const st = { doc, session };
  const seq = [];
  // 4 phrase steps (each secured in 2 rounds, ♩ only — no credit) → a run is due.
  for (let k = 0; k < 4; k++) {
    const x = nextStep(st.doc, SB, st.session, clock);
    seq.push(x);
    if (x.kind !== "stage") break;
    rounds(st, SB, x.p, x.stage, [PASS, PASS]);
  }
  const due = nextStep(st.doc, SB, st.session, clock);
  check("run: due after 4 steps", seq.every((x) => x.kind === "stage") && due.kind === "run", `${seq.map((x) => x.kind + x.p).join()} → ${due.kind}`);
  check("run: within the current section", due.from >= s0.p0 && due.to < s0.p1);
  check("run: X is the last checked phrase (♪, no ✓)", (() => { const ck = rangeOf({ from: s0.p0, to: s0.p1 - 1 }).filter((p) => phraseMarks(st.doc, SB.phrases[p]).tune && !phraseMarks(st.doc, SB.phrases[p]).song); return ck.length ? due.to === ck.at(-1) : true; })());
  // after 2 new ♪
  const st2 = { doc, session };
  const a = nextStep(st2.doc, SB, st2.session, clock);
  rounds(st2, SB, a.p, a.stage, [CREDIT, CREDIT]);
  const b = nextStep(st2.doc, SB, st2.session, clock);
  rounds(st2, SB, b.p, b.stage, [CREDIT, CREDIT]);
  const c = nextStep(st2.doc, SB, st2.session, clock);
  check("run: due after 2 new ♪", st2.doc.tuneSinceRun === 2 && c.kind === "run", `${st2.doc.tuneSinceRun} ${c.kind}`);
  // Start: from the top when the first checked phrase is ≤ 15 s in, else one phrase before it.
  const spq = SB.opts.spq, startOf = (p) => (SB.phrases[p].q0 - SB.phrases[s0.p0].q0) * spq;
  const mark = (d, ps) => { d = JSON.parse(JSON.stringify(d)); for (const p of ps) { const m = (d.m[SB.phrases[p].mk] ||= { a: [] }); m.time = { at: 1, by: "self", rate: 1 }; m.tune = { at: 1, by: "self", rate: 1 }; } d.stepsSinceRun = 4; return d; };
  // (phrases whose tune appears once — a repeat shares its marks)
  const once = (p) => SB.phrases.filter((x) => x.mk === SB.phrases[p].mk).length === 1;
  const late = rangeOf({ from: s0.p0, to: s0.p1 - 2 }).find((p) => startOf(p) > 20 && once(p) && once(p + 1));
  const early = rangeOf({ from: s0.p0, to: s0.p1 - 1 }).find((p) => startOf(p) > 0 && startOf(p) <= 15 && once(p));
  const ra = nextStep(mark(doc, [late, late + 1]), SB, session, clock);
  check("run: one phrase before the first checked phrase", ra.kind === "run" && ra.from === late - 1 && ra.to === late + 1, `${ra.kind} ${ra.from}–${ra.to}, checked ${late}`);
  const rb = nextStep(mark(doc, [early]), SB, session, clock);
  check("run: from the section's start when ≤ 15 s before", rb.kind === "run" && rb.from === s0.p0 && rb.to === early, `${rb.from}–${rb.to}`);
  const top = mark(doc, [late, late + 1]); top.runsSinceTop = 2;
  const rc = nextStep(top, SB, session, clock);
  check("run: every third run from the top", rc.from === s0.p0, `${rc.from}`);
  check("run: ≤ 90 s", (SB.phrases[ra.to].q1 - SB.phrases[ra.from].q0) * spq <= PRACTICE.section.runMaxSec + 1e-6);
  check("label: run", stepLabel(ra, SB).title.startsWith("Sing to “"));
  // Sing on: the section's reached phrases all done → the next section's first run.
  const done = JSON.parse(JSON.stringify(doc));
  for (let p = s0.p0; p < s0.p1; p++) { const ph = SB.phrases[p]; const m = (done.m[ph.mk] ||= { a: [] }); m.time = m.tune = { at: 1, by: "self", rate: 1 }; done.w[ph.wk].song = { at: 1, rate: 1 }; }
  const on = nextStep(done, SB, newSession(clock, "sb"), clock);
  check("sing on: the next section, from one phrase before", on.kind === "singon" && on.from === s1.p0 - 1 && on.to <= s1.p1 - 1 && on.to > s1.p0, `${on.kind} ${on.from}–${on.to} (section ${s1.p0}–${s1.p1 - 1})`);
  check("label: sing on", stepLabel(on, SB).title.startsWith("Sing on to “"), stepLabel(on, SB).title);
  const afterOn = applyRun(done, newSession(clock, "sb"), SB, rangeOf(on), rangeOf(on).map(() => ({ time: V("try", { kind: "short", j: 0 }), tune: V("try", { kind: "note", j: 0 }) })), { rate: 1, guide: "click", at: tick() }, clock);
  check("sing on: the current section moves", afterOn.doc.sec === 1);
  // Every third pick from another reached section with unfinished phrases.
  const mixed = JSON.parse(JSON.stringify(afterOn.doc));
  const back = SB.phrases.find((p) => p.section === 0 && !phraseMarks(doc, p).time);
  delete mixed.m[back.mk].time; delete mixed.m[back.mk].tune; delete mixed.w[back.wk].song;
  const st3 = { doc: mixed, session: afterOn.session };
  const picks = [];
  for (let k = 0; k < 6; k++) {
    const x = nextStep(st3.doc, SB, st3.session, clock);
    if (x.kind !== "stage") { Object.assign(st3, applyRun(st3.doc, st3.session, SB, rangeOf(x), rangeOf(x).map(() => ({ time: V("unsure"), tune: V("unknown") })), { rate: 1, guide: "click", at: tick() }, clock)); continue; }
    picks.push(SB.phrases[x.p].section);
    rounds(st3, SB, x.p, x.stage, [TRY, PASS, PASS]);
  }
  check("variety: every third pick from another section", picks.includes(0) && picks.filter((s) => s === 1).length >= 2 && picks.indexOf(0) % 3 === 2, picks.join());
  // Sing from here
  const fh = singFromHere(doc, SB, s1.p0 + 2);
  check("sing from here: to the end of its section", fh.kind === "run" && fh.from === s1.p0 + 2 && fh.to === s1.p1 - 1);
}

// ---------------------------------------------------------------------------
// "Good place to stop" (D3): after a run, never in the first 10 minutes; then once ≥ 2
// milestones moved or 20 min went by; again only after 6 more. Milestones as §6: a stage
// secured (♩♪ together are one), a section in the song — not a run's credit or each ✓.
{
  const allUns = (n) => rangeOf({ from: 0, to: n }).map(() => ({ time: V("unsure"), tune: V("unknown") }));
  const runAt = (x, mins) => { const t = x.session.start + mins * 60e3; clock = Math.max(clock, t); return applyRun(x.doc, x.session, AG, [0, 1, 2, 3], allUns(3), { rate: 1, guide: "click", at: t }, t); };
  let st = started();
  rounds(st, AG, 1, "time", [CREDIT, CREDIT]);
  check("stop: ♩♪ secured together are one milestone", st.session.gain === 1, `gain ${st.session.gain}`);
  rounds(st, AG, 2, "time", [PASS, PASS]);
  check("stop: … a second secure is the second", st.session.gain === 2, `gain ${st.session.gain}`);
  const early = runAt(st, 3);
  check("stop: never in the first 10 minutes", nextStep(early.doc, AG, early.session, clock).stop === false);
  const r = runAt(st, 11);
  const s = nextStep(r.doc, AG, r.session, clock);
  check("stop: after a run with ≥ 2 milestones, 10 minutes in", s.stop === true && stepLabel(s, AG).note === "Good place to stop", JSON.stringify([r.session.gain, s.stop]));
  const after = applyRound(r.doc, r.session, AG.phrases[2], "tune", PASS(), { rate: 1 }, tick());
  check("stop: shown once", nextStep(after.doc, AG, after.session, clock).stop === false);
  st = { doc: r.doc, session: r.session };
  rounds(st, AG, 2, "tune", [PASS, PASS]);
  rounds(st, AG, 0, "time", [PASS, PASS]);
  const r3 = runAt(st, 14);
  check("stop: not again after 2 more milestones", nextStep(r3.doc, AG, r3.session, clock).stop === false, `gain ${r3.session.gain} shown at ${r3.session.stopShown}`);
  st = { doc: r3.doc, session: r3.session };
  rounds(st, AG, 0, "tune", [PASS, PASS]);
  rounds(st, AG, 3, "time", [PASS, PASS]);
  rounds(st, AG, 3, "tune", [PASS, PASS]);
  rounds(st, AG, 1, "tune", [PASS, PASS]);
  const r4 = runAt(st, 22);
  check("stop: again after 6 more", nextStep(r4.doc, AG, r4.session, clock).stop === true, `gain ${r4.session.gain} shown at ${r3.session.stopShown}`);
  const st2 = started();
  const r2 = runAt(st2, 21);
  check("stop: after 20 minutes", nextStep(r2.doc, AG, r2.session, clock).stop === true);
  const st3 = started();
  check("stop: not after the first run", nextStep(st3.doc, AG, st3.session, clock).stop === false);
  // run credit and each phrase's ✓ aren't milestones; a section all in the song is one
  const st4 = started();
  const good = (n) => rangeOf({ from: 0, to: n }).map(() => ({ time: V("pass"), tune: V("pass", null, { credit: true }) }));
  const cr = applyRun(st4.doc, st4.session, AG, [0, 1, 2, 3], good(3), { rate: 1, guide: "click", at: tick() }, clock);
  check("stop: run credit isn't a milestone", cr.moved.length === 8 && cr.session.gain === 0, `${cr.moved.length} moved, gain ${cr.session.gain}`);
  const part = applyRun(cr.doc, cr.session, AG, [0, 1, 2], good(2), { rate: 1, guide: "click", at: tick() }, clock);
  check("stop: … nor a phrase's ✓", part.moved.filter(([, m]) => m === "song").length === 3 && part.session.gain === 0, `gain ${part.session.gain}`);
  const sec = applyRun(part.doc, part.session, AG, [2, 3], good(1), { rate: 1, guide: "click", at: tick() }, clock);
  check("stop: a section in the song is one", sec.session.gain === 1, `gain ${sec.session.gain}`);
}

// ---------------------------------------------------------------------------
// D1: phrases that ride along (fewer than 2 syllables with words) are never practised alone,
// get their marks in runs, and nothing waits for them.
if (has("piano-man")) {
  const PM = song("piano-man");
  const riders = PM.phrases.filter((p) => p.ride);
  check("ride: Piano Man's lone note (Bar 185) and “lone.” ride along", riders.map((p) => p.name).join("|") === "lone|Bar 185", riders.map((p) => `${p.i} ${p.name}`).join("|"));
  check("ride: phrases with ≥ 2 syllables with words don't", PM.phrases.filter((p) => !p.ride).every((p) => p.js.filter((j) => !PM.notes[j].melisma && PM.notes[j].text).length >= 2));
  const R1 = riders[1], R0 = riders[0];
  // pickPhrase on one: a run from the phrase before it
  const pk = pickPhrase(newDoc(), PM, newSession(clock, "pm"), R1.i);
  check("ride: choosing it gives a run over it, from the phrase before", pk.kind === "run" && pk.from === R1.i - 1 && pk.to === R1.i, JSON.stringify([pk.kind, pk.from, pk.to]));
  // everything ✓ but the riders → Sing it through (nothing waits for them)
  const all = JSON.parse(JSON.stringify(markHeard(newDoc(), clock)));
  all.runs = 3;
  for (const p of PM.phrases) {
    all.w[p.wk] = { q0: p.q0, words: p.words, reached: 1, song: p.ride ? null : { at: 1, rate: 1 }, then: null };
    if (!p.ride) all.m[p.mk] = { time: { at: 1, by: "earned", rate: 1 }, tune: { at: 1, by: "earned", rate: 1 }, thin: false, step: null, a: [] };
  }
  check("ride: Sing it through doesn't wait for them", nextStep(all, PM, newSession(clock, "pm"), clock).kind === "through");
  // a section whose only unfinished phrases ride along: Sing on, not a block on them
  const sec = PM.sections[R1.section];
  const part = JSON.parse(JSON.stringify(all));
  for (const p of PM.phrases) if (p.section > R1.section) delete part.w[p.wk];
  part.sec = R1.section;
  const on = nextStep(part, PM, newSession(clock, "pm"), clock);
  check("ride: an unfinished rider doesn't hold up Sing on", on.kind === "singon" && on.from === sec.p1 - 1, JSON.stringify([on.kind, on.from, on.to]));
  // marks from runs: ♩♪ from a run that went fine (a pass in tune; timing unsure), ✓ the next time
  const cov = [R1.i - 1, R1.i, R1.i + 1];
  const ok = () => ({ time: V("unsure"), tune: V("pass") });
  let d = markHeard(newDoc(), clock), ss = newSession(clock, "pm");
  ({ doc: d, session: ss } = applyRun(d, ss, PM, cov, cov.map(() => ({ time: V("unsure"), tune: V("try", { kind: "note", j: 0 }) })), { rate: 1, guide: "click", first: true, at: tick() }, clock));
  let r = applyRun(d, ss, PM, cov, cov.map(ok), { rate: 1, guide: "click", at: tick() }, clock);
  const mk1 = () => phraseMarks(r.doc, R1);
  check("ride: a run that went fine gives ♩♪", mk1().time && mk1().tune && !mk1().song && r.moved.some(([i, m]) => i === R1.i && m === "tune"), JSON.stringify(mk1()));
  check("ride: … the others need more than that", !phraseMarks(r.doc, PM.phrases[R1.i + 1]).time);
  r = applyRun(r.doc, r.session, PM, cov, cov.map(ok), { rate: 1, guide: "click", at: tick() }, clock);
  check("ride: … and ✓ the next time", mk1().song);
  const mel = applyRun(d, ss, PM, cov, cov.map(ok), { rate: 1, guide: "melody", at: tick() }, clock);
  check("ride: never from the melody guide", !phraseMarks(mel.doc, R1).time);
  const bad = applyRun(d, ss, PM, cov, cov.map(() => ({ time: V("unsure"), tune: V("try", { kind: "note", j: R1.j0 }) })), { rate: 1, guide: "click", at: tick() }, clock);
  check("ride: a try gives nothing", !phraseMarks(bad.doc, R1).time);
  // never "· again": slips in runs don't count for it
  let x = { doc: r.doc, session: r.session };
  const R0d = JSON.parse(JSON.stringify(x.doc)); R0d.m[R0.mk] = { ...(R0d.m[R0.mk] || { a: [] }), time: { at: 1, by: "credit", rate: 1 }, tune: { at: 1, by: "credit", rate: 1 } };
  x.doc = R0d;
  for (let k = 0; k < 3; k++) x = applyRun(x.doc, x.session, PM, [R0.i], [{ time: V("try", { kind: "short", j: R0.j0 }), tune: V("try", { kind: "note", j: R0.j0 }) }], { rate: 1, guide: "click", at: tick() }, clock);
  check("ride: never “· again”", !x.doc.m[R0.mk].redo);
  // a run aimed at the phrase before one takes it along
  const aim = JSON.parse(JSON.stringify(part));
  const before = PM.phrases.filter((p) => p.i < R0.i && !p.ride).at(-1);
  delete aim.w[before.wk].song; aim.stepsSinceRun = 4;
  const run = nextStep(aim, PM, newSession(clock, "pm"), clock);
  check("ride: a run doesn't wait through a rest of a bar or more for one", run.kind === "run" && run.to === before.i, JSON.stringify([run.kind, run.from, run.to, before.i]));
  const told = applyRun(r.doc, r.session, PM, cov, cov.map(() => ({ time: V("pass"), tune: V("pass", null, { credit: true }) })), { rate: 1, guide: "click", at: tick() }, clock);
  check("ride: never “Better than your first try”", !told.improved.includes(R1.i));
}
// … a rider with no rest before it comes along with the run to the phrase before it
{
  const s = loadSong("amazing-grace");
  const p3 = AG.phrases[3];
  const firstSyl = p3.js.find((j) => s.notes[j].text);
  const lone = s.notes.map((n, j) => (p3.js.includes(j) && j !== firstSyl ? { ...n, text: "", syllabic: null, melisma: !!n.melisma } : j === firstSyl ? { ...n, syllabic: "single" } : n));
  const g = groupPhrases(lone, s.lines, s.opts);
  const rd = g.phrases.at(-1);
  check("ride (AG, one word left in the last line): it rides along", rd.ride && !rd.hard && g.phrases.length === 4, JSON.stringify([rd.name, rd.ride, rd.hard, g.phrases.length]));
  let d = markHeard(newDoc(), clock), ss = newSession(clock, "agr");
  const all = g.phrases.map((p) => p.i);
  ({ doc: d, session: ss } = applyRun(d, ss, g, all, all.map(() => ({ time: V("unsure"), tune: V("try", { kind: "note", j: 0 }) })), { rate: 1, guide: "click", first: true, at: tick() }, clock));
  const p2 = g.phrases[2];
  d.m[p2.mk] = { ...d.m[p2.mk], time: { at: 1, by: "earned", rate: 1 }, tune: { at: 1, by: "earned", rate: 1 } };
  d.stepsSinceRun = 4;
  const run = nextStep(d, g, ss, clock);
  check("ride: a run to the phrase before takes it along", run.kind === "run" && run.to === rd.i && run.from <= 2, JSON.stringify([run.kind, run.from, run.to]));
  const pk = pickPhrase(d, g, ss, rd.i);
  check("ride: choosing it → a run over it", pk.kind === "run" && pk.from === 2 && pk.to === rd.i);
  const nx = [];
  let st = { doc: d, session: ss };
  for (let k = 0; k < 20; k++) {
    const x = nextStep(st.doc, g, st.session, clock);
    nx.push(x.kind === "stage" ? `${x.stage}:${x.p}` : `${x.kind}:${x.from}-${x.to}`);
    if (x.kind === "through") break;
    if (x.kind === "stage") rounds(st, g, x.p, x.stage, [CREDIT, CREDIT]);
    else if (x.kind === "selfcheck") Object.assign(st, answerSelfCheck(st.doc, st.session, g.phrases[x.p], x.stage, true, tick()));
    else Object.assign(st, applyRun(st.doc, st.session, g, rangeOf(x), rangeOf(x).map(() => ({ time: V("unsure"), tune: V("pass") })), { rate: 1, guide: "click", at: tick() }, clock));
  }
  check("ride: a whole plan never practises it alone and gets to Sing it through", nx.at(-1).startsWith("through") && !nx.some((k) => k === `time:${rd.i}` || k === `tune:${rd.i}`), nx.join(" "));
}
for (const name of ["killing-me-softly-with-his-song", "wichita-lineman"].filter(has)) {
  const g = song(name);
  check(`${name}: the held tail after the jump is in its phrase (no “Bar…” phrase without words)`, !g.phrases.some((p) => !p.words || /^Bars? \d/.test(p.name)) && !g.phrases.some((p) => p.ride), g.phrases.filter((p) => p.ride || !p.words).map((p) => p.name).join("|"));
}

// D2: "· again" needs 2 run slips; a redo back in the same session counts as a rotation.
{
  let st = started();
  rounds(st, AG, 2, "time", [CREDIT, CREDIT]); // ♩♪
  const slip = (x) => applyRun(x.doc, x.session, AG, [1, 2, 3], [1, 2, 3].map((p) => ({ time: p === 2 ? V("try", { kind: "rushing" }) : V("unsure"), tune: V("unknown") })), { rate: 1, guide: "click", at: tick() }, clock);
  let x = slip(st);
  check("again: one run slip → not yet", !x.doc.m[AG.phrases[2].mk].redo);
  x = slip(x);
  check("again: two → “· again”", x.doc.m[AG.phrases[2].mk].redo === "time" && pickPhrase(x.doc, AG, x.session, 2).extra === "again" && !x.session.rotations[AG.phrases[2].mk]);
  const held = applyRun(slip(st).doc, slip(st).session, AG, [1, 2, 3], [1, 2, 3].map(() => ({ time: V("pass"), tune: V("pass") })), { rate: 1, guide: "click", at: tick() }, clock);
  check("again: a run that holds in between starts the count over", held.doc.m[AG.phrases[2].mk].rs === 0 && !held.doc.m[AG.phrases[2].mk].redo);
  // practise it (secured again), then two more slips: back the same session → like a rotation
  x = { doc: x.doc, session: x.session };
  rounds(x, AG, 2, "time", [PASS, PASS]);
  check("again: practised → cleared", !x.doc.m[AG.phrases[2].mk].redo);
  x = slip(slip(x));
  const mk = AG.phrases[2].mk;
  check("again: back the same session → counts as a rotation, left out for a while", x.doc.m[mk].redo === "time" && x.session.rotations[mk] === 1 && (x.session.left[mk] ?? -1) > x.session.steps, JSON.stringify([x.session.rotations[mk], x.session.left[mk], x.session.steps]));
  check("again: … so it isn't the next step", nextStep(x.doc, AG, x.session, clock).p !== 2);
  rounds(x, AG, 2, "time", [PASS, PASS]);
  x = slip(slip(x));
  check("again: the next time it's parked for the session", !!x.session.parked[mk]);
  const tomorrow = sessionFor(x.session, "s", clock + 20 * 3600e3);
  check("again: … and back the next session", !tomorrow.parked[mk] && pickPhrase(x.doc, AG, tomorrow, 2).extra === "again");
}

// D4: rotated away as the only unfinished phrase → a run over it first, then the phrase.
{
  let st = started();
  for (const p of [0, 2, 3]) { const ph = AG.phrases[p]; st.doc.m[ph.mk] = { time: { at: 1, by: "earned", rate: 1 }, tune: { at: 1, by: "earned", rate: 1 }, thin: false, step: null, a: [] }; st.doc.w[ph.wk].song = { at: 1, rate: 1 }; }
  const r = rounds(st, AG, 1, "time", [TRY, TRY, TRY, TRY, TRY, TRY]);
  check("rotate alone: rotated", r[5].event === "rotate");
  const n1 = nextStep(st.doc, AG, st.session, clock);
  check("rotate alone: not the same phrase straight away — a run over it", n1.kind === "run" && n1.from <= 1 && n1.to >= 1, JSON.stringify([n1.kind, n1.p, n1.from, n1.to]));
  const x = applyRun(st.doc, st.session, AG, rangeOf(n1), rangeOf(n1).map(() => ({ time: V("try", { kind: "short", j: e }), tune: V("unknown") })), { rate: 1, guide: "click", at: tick() }, clock);
  const n2 = nextStep(x.doc, AG, x.session, clock);
  check("rotate alone: … then the phrase", n2.kind === "stage" && n2.p === 1, JSON.stringify([n2.kind, n2.p, n2.from, n2.to]));
}

// D5: a "· full speed" block clears only with a pass at the song's tempo.
{
  let st = started();
  rounds(st, AG, 1, "time", [TRY, TRY, PASS, PASS]); // ♩ at 90%
  const slipRun = (x) => applyRun(x.doc, x.session, AG, [0, 1, 2], [0, 1, 2].map((k) => ({ time: k === 1 ? V("try", { kind: "late-in", j: e }) : V("pass"), tune: V("pass") })), { rate: 1, guide: "click", at: tick() }, clock);
  const y = slipRun(slipRun(st));
  st = { doc: y.doc, session: y.session };
  check("full speed: due", pickPhrase(st.doc, AG, st.session, 1).extra === "full speed");
  const SLIP = () => V("slip", { kind: "slip", j: e, dir: "late" });
  const r = rounds(st, AG, 1, "time", [SLIP, PASS, PASS]);
  check("full speed: a slip slows it, the pass at 90% is confirmed at full speed", r[1].setup.rate === 0.9 && r[2].setup.rate === 1 && r[2].setup.confirm && r[2].event === "secured" && !mOf(st, 1).redo && r[2].fullSpeed, JSON.stringify(r.map((q) => [q.setup.rate, q.setup.confirm, q.event])));
  st = { doc: y.doc, session: y.session };
  const r2 = rounds(st, AG, 1, "time", [SLIP, PASS]);
  const forced = applyRound(st.doc, st.session, AG.phrases[1], "time", PASS(), { rate: 0.9, confirm: true }, tick());
  check("full speed: a confirm pass at 90% doesn't clear it", forced.event !== "secured" && forced.doc.m[AG.phrases[1].mk].redo === "time" && phraseMarks(forced.doc, AG.phrases[1]).slower, JSON.stringify([forced.event, r2.map((q) => q.setup.rate)]));
  const nx = nextStep(forced.doc, AG, forced.session, clock);
  check("full speed: … the next round is at full speed", nx.cont && nx.setup.rate === 1 && nx.setup.confirm, JSON.stringify(nx.setup));
}

// D6: "Better than your first try" / Then → Now only the first time a phrase improves.
{
  const all = AG.phrases.map((p) => p.i);
  let doc = markHeard(newDoc(), clock), session = newSession(clock, "s");
  ({ doc, session } = applyRun(doc, session, AG, all, all.map(() => ({ time: V("try", { kind: "short", j: e }), tune: V("pass", null, { credit: true }) })), { rate: 1, guide: "click", first: true, at: tick() }, clock));
  const good = all.map(() => ({ time: V("pass"), tune: V("pass", null, { credit: true }) }));
  const r1 = applyRun(doc, session, AG, all, good, { rate: 1, guide: "click", at: tick() }, clock);
  const r2 = applyRun(r1.doc, r1.session, AG, all, good, { rate: 1, guide: "click", at: tick() }, clock);
  check("improved: reported the first time", r1.improved.join() === "0,1,2,3", r1.improved.join());
  check("improved: not again on the next run", r2.improved.length === 0, r2.improved.join());
}

// D7: names from the first lyric line, never from the middle of a word.
{
  const nameOf = (name, words) => { const g = song(name); return g.phrases.find((p) => p.words.startsWith(words))?.name; };
  if (has("hey-little-songbird")) check("name: first line only — “to quell…”", nameOf("hey-little-songbird", "to quell") === "to quell…", nameOf("hey-little-songbird", "to quell"));
  if (has("wichita-lineman")) check("name: not from a cut word — “but it don’t look…”", nameOf("wichita-lineman", "cation") === "but it don’t look…", nameOf("wichita-lineman", "cation"));
  if (has("piano-man")) check("name: OCR's “car|and” — from the next word", nameOf("piano-man", "and the microphone") === "the microphone smells like…", nameOf("piano-man", "and the microphone"));
  if (has("wichita-lineman")) check("name: a mistagged whole word stays", nameOf("wichita-lineman", "is still on") === "is still on the…", nameOf("wichita-lineman", "is still on"));
  // every name is the start of its phrase's first line (minus a cut word), across the fixtures
  const badNames = [];
  for (const name of fixtureNames()) {
    const g = song(name);
    for (const p of g.phrases) {
      if (!p.words) continue;
      const lineWords = (li) => { const set = new Set(g.lines[li]); return p.js.filter((j) => set.has(j)); };
      const l0 = lineWords(p.lines[0]).filter((j) => g.notes[j].text && !g.notes[j].melisma).map((j) => g.notes[j].text.replace(/[^\p{L}']/gu, "").toLowerCase()).join("");
      const l1 = p.lines.length > 1 ? lineWords(p.lines[1]).filter((j) => g.notes[j].text && !g.notes[j].melisma).map((j) => g.notes[j].text.replace(/[^\p{L}']/gu, "").toLowerCase()).join("") : "";
      const n = p.name.replace(/…$/, "").replace(/[^\p{L}']/gu, "").toLowerCase();
      if (!(l0.includes(n) || (l1 && l1.startsWith(n)))) badNames.push(`${name} ${p.i} “${p.name}” / ${p.words.slice(0, 40)}`);
    }
  }
  check("name: always within the first line (or the next, after a cut word)", !badNames.length, badNames.slice(0, 5).join(" | "));
}

// ---------------------------------------------------------------------------
// Fuzz: random verdict streams never block a phrase for more than 6 counted rounds, never
// give the same step twice in a row (unless it's the only phrase), and always give a step.
function fuzz(name, seed, n = 500) {
  const g = name === "amazing-grace" ? AG : song(name);
  let x = seed >>> 0;
  const rnd = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const vs = ["pass", "pass", "try", "try", "slip", "unsure", "unknown", "unheard"];
  let doc = newDoc(), session = newSession(clock, name);
  let counted = 0, blockKey = null, lastStep = null, worst = 0, repeats = 0, none = 0, through = 0, kinds = {}, prevEvent = null, rerun = false, reruns = 0, riderSteps = 0;
  for (let k = 0; k < n; k++) {
    const now = tick(15 + rnd() * 20);
    if (rnd() < 0.01) { session = sessionFor(session, name, now + 4 * 3600e3); lastStep = null; } // next day now and then
    let s;
    try { s = nextStep(doc, g, session, now); } catch (err) { none++; console.log(err); break; }
    if (!s || !s.kind) { none++; break; }
    kinds[s.kind] = (kinds[s.kind] || 0) + 1;
    if (s.kind === "through") { through++; doc = newDoc(); session = newSession(now, name); continue; }
    const key = s.kind === "stage" ? `${s.p}:${s.stage}` : `${s.kind}:${s.from}-${s.to}`;
    if (s.kind === "stage" || s.kind === "selfcheck") {
      const ph = g.phrases[s.p];
      if (s.kind === "selfcheck") {
        const yes = rnd() < 0.5;
        ({ doc, session } = answerSelfCheck(doc, session, ph, s.stage, yes, now));
        if (yes) { lastStep = `${ph.mk}:${s.stage}`; blockKey = null; counted = 0; }
        continue;
      }
      const stepKey = `${ph.mk}:${s.stage}`;
      if (ph.ride) riderSteps++;
      if (!s.cont) {
        if (lastStep === stepKey && g.phrases.length > 1) { repeats++; if (process.env.DBG) console.log("repeat", name, k, stepKey, JSON.stringify(session.last), JSON.stringify(s).slice(0, 200), "\n   ", g.phrases.map((ph) => { const m = phraseMarks(doc, ph); return `${ph.i}:s${ph.section}${m.reached ? "r" : ""}${m.time ? "♩" : ""}${m.tune ? "♪" : ""}${m.song ? "✓" : ""}${m.due ? "!" + m.due : ""}${session.parked[ph.mk] ? "P" : ""}${(session.left[ph.mk] ?? -1) > session.steps ? "L" : ""}`; }).join(" "), JSON.stringify({ prevEvent, steps: session.steps, sSR: doc.stepsSinceRun })); }
        blockKey = stepKey; counted = 0;
      }
      const v = vs[Math.floor(rnd() * vs.length)];
      const verdict = { ...V(v, v === "pass" ? null : { kind: v === "slip" ? "slip" : "short", j: ph.j0 }), tune: { v: "pass", facts: { credit: rnd() < 0.3 } } };
      const r = applyRound(doc, session, ph, s.stage, verdict, s.setup, now);
      if (v === "pass" || v === "try" || (v === "slip" && s.stage === "time")) counted++;
      worst = Math.max(worst, counted);
      ({ doc, session } = r);
      // (a self-check pauses the block: Again goes on with it, Yes secures it)
      if (r.event === "self-check") prevEvent = r.event;
      else if (r.event) { lastStep = blockKey; blockKey = null; counted = 0; prevEvent = r.event; }
    } else {
      // (the same span again is a new step when the last run gave ♪ in it: ✓ needs ♪ from before)
      if (lastStep === key && g.phrases.length > 1 && s.kind !== "hear") { if (rerun) reruns++; else { repeats++; if (process.env.DBG) console.log("repeat", name, k, key); } }
      if (s.kind === "hear") { doc = markHeard(doc, now); lastStep = key; continue; }
      const cov = rangeOf(s);
      const res = cov.map(() => { const a = vs[Math.floor(rnd() * vs.length)], b = vs[Math.floor(rnd() * vs.length)]; return { time: V(a), tune: { ...V(b), facts: { credit: b === "pass" && rnd() < 0.5 } } }; });
      let moved;
      ({ doc, session, moved } = applyRun(doc, session, g, cov, res, { rate: 1, guide: "click", first: s.kind === "first", at: now }, now));
      rerun = moved.some(([, m]) => m === "tune");
      lastStep = key;
    }
  }
  check(`fuzz ${name}/${seed}: a step every time`, none === 0);
  check(`fuzz ${name}/${seed}: no block over 6 counted rounds`, worst <= PRACTICE.ladder.rotateAfter, `worst ${worst}`);
  check(`fuzz ${name}/${seed}: never the same step twice in a row`, repeats === 0, `${repeats} repeats`);
  check(`fuzz ${name}/${seed}: never a block on a phrase that rides along`, riderSteps === 0, `${riderSteps}`);
  return { worst, kinds, through };
}
for (const [name, seed] of [["amazing-grace", 1], ["amazing-grace", 2], ["hey-little-songbird", 3], ["piano-man", 4], ["wichita-lineman", 5], ["killing-me-softly-with-his-song", 6], ["the-longest-time", 7]]) {
  if (name === "amazing-grace" || has(name)) fuzz(name, seed);
}
// A one-phrase song: the same phrase is allowed to come back.
{
  const s = loadSong("amazing-grace");
  const js = AG.phrases[1].js;
  const one = groupPhrases(js.map((j) => s.notes[j]), [js.map((_, k) => k)], s.opts);
  let doc = markHeard(newDoc(), clock), session = newSession(clock, "one");
  ({ doc, session } = applyRun(doc, session, one, [0], [{ time: V("unsure"), tune: V("unknown") }], { rate: 1, guide: "click", first: true, at: tick() }, clock));
  let ok = true;
  for (let k = 0; k < 40; k++) {
    const st = nextStep(doc, one, session, clock);
    if (!st || !st.kind) { ok = false; break; }
    if (st.kind === "stage") ({ doc, session } = applyRound(doc, session, one.phrases[0], st.stage, TRY(), st.setup, tick()));
    else if (st.kind === "selfcheck") ({ doc, session } = answerSelfCheck(doc, session, one.phrases[0], st.stage, false, tick()));
    else ({ doc, session } = applyRun(doc, session, one, [0], [{ time: V("try", { kind: "short", j: 0 }), tune: V("try", { kind: "note", j: 0 }) }], { rate: 1, guide: "click", at: tick() }, clock));
  }
  check("one phrase: always a step", ok);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
