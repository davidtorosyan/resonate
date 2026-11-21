// Guided practice simulator (docs/COACHING.md §10 Step 4): four singer profiles on the song
// fixtures, a 30-minute session and the next day's, through the real practice.js plan and
// verdicts and coach.js words. Prints the card step by step and reports the share of rounds
// ending with a win (target ~3 in 4), rounds to each mark, sections touched, and any card shown
// 3 times in a row.
// usage: node practicesim.mjs [--summary] [--song name] [--profile name] [--seed n] [--minutes m]
import { loadSong, fixtureNames } from "./fixturelib.mjs";
import {
  PRACTICE, groupPhrases, newDoc, sessionFor, timeVerdict, tuneVerdict, phraseMarks, applyRound, answerSelfCheck,
  applyRun, markHeard, nextStep, stepLabel,
} from "../public/practice.js";
import { roundResult, runResult, securedText } from "../public/coach.js";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const SUMMARY = args.includes("--summary");
const MINUTES = Number(opt("minutes", 30));
const SEED = Number(opt("seed", 7));

// Singer profiles (§10 Step 4). Probabilities are per round at the song's tempo before any
// practice; practice raises them (each counted round closes 6% of the gap), slower helps
// timing, and overnight keeps 80% of the day's gain.
const PROFILES = {
  "by ear": { time: 0.85, tune: 0.85, credit: 0.75, unsure: 0.05, slip: 0.03 },
  "late entries": { time: 0.85, tune: 0.8, credit: 0.6, unsure: 0.05, slip: 0.5, slipSlower: 0.15 },
  "pitch-weak": { time: 0.85, tune: 0.4, credit: 0.4, unsure: 0.05, slip: 0.03 },
  "engine-unsure legato": { time: 0.8, tune: 0.75, credit: 0.6, unsure: 0.7, slip: 0.03, legato: true },
};
const SONGS = args.includes("--all") ? fixtureNames() : ["amazing-grace", "hey-little-songbird"].filter((n) => fixtureNames().includes(n));

function rng(seed) { let x = seed >>> 0 || 1; return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32); }

function simulate(songName, profName, seed) {
  const prof = PROFILES[profName];
  const rnd = rng(seed);
  const { notes, lines, opts, fx } = loadSong(songName);
  const song = groupPhrases(notes, lines, opts);
  const ps = song.phrases;
  const beat = opts.spq * (fx.meters?.[0]?.[1] === 8 ? 1.5 : 1); // felt beat ≈ a quarter (dotted in compound time)
  const out = [];
  const log = (s) => { if (!SUMMARY) out.push(s); };
  // Each phrase's skill, a little harder or easier than the profile.
  const skill = ps.map(() => {
    const d = (rnd() - 0.5) * 0.2;
    return { time: clamp(prof.time + d), tune: clamp(prof.tune + d), slip: prof.slip, gain: { time: 0, tune: 0, slip: 0 } };
  });
  const st = { doc: newDoc(), session: null };
  const stats = { rounds: 0, wins: 0, cueOnly: 0, againOnly: 0, toMark: [], blocks: 0, sections: new Set(), runs: 0, triple: [], tripleRes: [], steps: 0, marks: [],
    cards: [], stops: {}, afterRotate: [], riderCards: 0, winRepeats: 0, betterTold: {} };
  const lyricSyl = (ph) => ph.js.filter((j) => !notes[j].melisma && (notes[j].text || !notes.some((n) => n.text))).length;
  const syl = (ph) => ph.js.filter((j) => !notes[j].melisma);
  const longest = (ph) => ph.js.reduce((a, j) => (notes[j].d > notes[a].d ? j : a), ph.js[0]);
  const longOnes = (ph) => ph.js.filter((j) => notes[j].d >= 2 * beat - 1e-6);

  // One sung attempt of phrase ph: synthetic rhythm facts and pitch grades → the real verdicts.
  function attempt(ph, stage, rate, inRun = false) {
    const sk = skill[ph.i];
    const slower = rate < 1 ? (1 - rate) * 10 : 0; // 1 per 10% slower
    const pTime = clamp(sk.time + 0.06 * slower - (inRun ? 0.05 : 0));
    const pSlip = Math.max(0.01, (rate < 1 && prof.slipSlower !== undefined ? prof.slipSlower : sk.slip) - sk.gain.slip);
    const pTune = clamp(sk.tune - (inRun ? 0.05 : 0) + 0.02 * slower);
    // timing outcome
    const ys = syl(ph), e = ys[0] ?? ph.j0;
    const r = { trust: "ok", calibrated: true, guide: "click", tapped: false, lag: 0.02 + (rnd() - 0.5) * 0.05, beat, measuredRt: true, cover: 0.85,
      classified: ys.length, syllables: ys.length, obs: [], takeObs: [], leadN: 5, seedAgrees: true, notes: [] };
    let tOut;
    if (rnd() < prof.unsure) tOut = "unsure";
    else if (rnd() < pSlip) tOut = "slip";
    else tOut = rnd() < pTime ? "pass" : "try";
    if (tOut === "unsure") { r.classified = 1; r.lag = rnd() < 0.5 ? null : r.lag; }
    if (tOut === "slip") {
      r.lag = (0.65 + rnd() * 0.5) * beat;
      // (the rest of the phrase, on the singer's own clock, may well be fine)
      const L = longOnes(ph).at(-1);
      if (L !== undefined && rnd() < 0.6) r.notes[L] = { cls: "on", rel: -0.03 };
    }
    if (tOut === "pass" || tOut === "unsure") {
      r.notes[e] = { cls: "on" };
      const L = longOnes(ph).at(-1);
      if (L !== undefined) r.notes[L] = { cls: "on", rel: -0.03 };
      if (rnd() < 0.4) r.obs.push({ kind: "steady-line", tone: "good", scope: "line" });
    }
    if (tOut === "try") {
      const L = longOnes(ph).at(-1);
      const kinds = ["late-in", "rushing", ...(L !== undefined ? ["short", "short"] : []), "offbeat-late"];
      const kind = kinds[Math.floor(rnd() * kinds.length)];
      if (kind === "late-in") { r.obs.push({ kind, tone: "try", scope: "line", j: e }); r.lag = 0.15; }
      else if (kind === "short") { r.obs.push({ kind, tone: "try", scope: "line", j: L }); r.notes[L] = { cls: "on", rel: -0.5 }; r.notes[e] = { cls: "on" }; }
      else { r.obs.push({ kind, tone: "try", scope: "line" }); r.notes[e] = { cls: "on" }; }
    }
    // pitch outcome → grades (the legato singer is on time: consistent slot shifts)
    const grades = [];
    const shift = (rnd() - 0.5) * 0.06;
    for (const j of ph.js) grades[j] = { status: "good", hit: 0.95 + rnd() * 0.05, dev: (rnd() - 0.5) * 0.2, shift: shift + (rnd() - 0.5) * 0.04 };
    const uOk = rnd() < pTune;
    if (uOk) {
      if (rnd() > prof.credit) { // a pass under the credit bar: one note leans out
        const j = ph.js[Math.floor(rnd() * ph.js.length)];
        grades[j] = { ...grades[j], status: "ok", hit: 0.55, dev: 0.4 };
      }
    } else {
      const what = rnd();
      if (what < 0.6) { const j = longest(ph); grades[j] = { ...grades[j], status: "off", hit: 0, dev: rnd() < 0.5 ? -1.2 : 1.1 }; }
      else if (what < 0.8) { for (const j of ph.js) grades[j] = { ...grades[j], status: "ok", hit: 0.6, dev: -0.3 }; }
      else { for (const j of ph.js.slice(0, 3)) grades[j] = { status: "missed", hit: 0 }; }
    }
    if (tOut === "slip") for (const j of ph.js) grades[j] = { ...grades[j], shift: 0.24 }; // (late: the slots moved as far as they go)
    if (tOut === "unsure" && !prof.legato) for (const j of ph.js) grades[j] = { ...grades[j], shift: (rnd() - 0.5) * 0.5 };
    const tv = timeVerdict({ ph, r, grades, notes });
    const uv = tuneVerdict({ ph, r, grades, notes });
    return { tv, uv };
  }
  const learn = (ph, stage, v, rate) => {
    const sk = skill[ph.i];
    if (v === "unsure" || v === "unknown") return;
    sk[stage] = clamp(sk[stage] + 0.06 * (1 - sk[stage]));
    sk.gain[stage] += 0.01;
    if (stage === "time" && rate < 1) sk.gain.slip = Math.min(0.45, sk.gain.slip + 0.05);
  };

  function runSession(label, startT, minutes) {
    let t = 0;
    const now = () => startT + t * 1000;
    st.session = sessionFor(st.session, songName, now());
    log(`\n=== ${songName} · ${profName} · ${label} ===`);
    let lastTitle = null, same = 1, lastRes = null, sameRes = 1, blockStart = null, prevCue = null, lastWin = null, lastEvent = null;
    const shown = [];
    while (t < minutes * 60) {
      const step = nextStep(st.doc, song, st.session, now());
      const lab = stepLabel(step, song);
      const clock = `${String(Math.floor(t / 60)).padStart(2)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
      if (!step.cont) {
        stats.steps++;
        stats.cards.push({ day: label, p: step.kind === "stage" || step.kind === "finish" ? step.p : step.kind === "run" || step.kind === "singon" ? step.to : null, kind: step.kind, again: step.extra === "again" || step.extra === "full speed", stop: !!lab.note, title: lab.title });
        if (lab.note) (stats.stops[label] ||= []).push(clock);
        if (lastEvent && step.kind === "stage" && step.p === lastEvent.p) stats.afterRotate.push(`${label} ${clock} ${lab.title}`);
        if (step.kind === "stage" && lyricSyl(ps[step.p]) < 2) stats.riderCards++;
        lastEvent = null;
        if (lab.title === lastTitle) { same++; if (same === 3) stats.triple.push(`${label} ${clock} ${lab.title}`); }
        else { same = 1; lastTitle = lab.title; }
        log(`${clock}  ┌ ${lab.title}${lab.note ? ` · ${lab.note}` : ""}   [${lab.button}]`);
      } else if (step.setup.confirm) log(`${clock}  │ ${lab.title}`);
      if (step.kind === "hear") { t += Math.max(10, (ps[step.to].q1 - ps[step.from].q0) * opts.spq); st.doc = markHeard(st.doc, now()); continue; }
      if (step.kind === "selfcheck") {
        const ph = ps[step.p], yes = skill[ph.i][step.stage] > 0.6;
        log(`         ${yes ? "✓ Yes" : "Again"}`);
        const r = answerSelfCheck(st.doc, st.session, ph, step.stage, yes, now());
        st.doc = r.doc; st.session = r.session; t += 8;
        if (r.event === "secured") { log(`         ${securedText(ph, [step.stage])}`); noteMark(ph, step.stage, "self"); }
        continue;
      }
      if (step.kind === "stage") {
        const ph = ps[step.p];
        if (!step.cont) { blockStart = { p: step.p, stage: step.stage, rounds: 0 }; stats.blocks++; prevCue = null; }
        stats.sections.add(ph.section);
        const { tv, uv } = attempt(ph, step.stage, step.setup.rate);
        const verdict = step.stage === "time" ? { ...tv, tune: uv } : uv;
        const res = applyRound(st.doc, st.session, ph, step.stage, verdict, step.setup, now());
        const words = roundResult(step.stage, { ...verdict, fullSpeed: res.fullSpeed, shown: [...shown] }, prevCue, notes, ph);
        if (words.win) { shown.push(words.win.text); if (shown.length > 6) shown.shift(); if (words.win.text === lastWin) stats.winRepeats++; }
        lastWin = words.win?.text ?? null;
        prevCue = verdict.cue;
        st.doc = res.doc; st.session = res.session;
        stats.rounds++; blockStart.rounds++;
        if (words.win) stats.wins++; else if (words.cue?.kind === "again") stats.againOnly++; else stats.cueOnly++;
        learn(ph, step.stage, verdict.v, step.setup.rate);
        const text = `${words.win ? `✓ ${words.win.text}` : ""}${words.win && words.cue ? " · " : ""}${words.cue ? words.cue.text : ""}`;
        if (text === lastRes) { sameRes++; if (sameRes === 3) stats.tripleRes.push(`${label} ${clock} ${text}`); } else { sameRes = 1; lastRes = text; }
        log(`         ${step.setup.rate < 1 ? `(${Math.round(step.setup.rate * 100)}) ` : ""}${text}   [${verdict.v}${verdict.ev === "shift" ? "·shift" : ""}]`);
        t += 20;
        if (res.event === "secured") {
          const stages = res.alsoTune ? ["time", "tune"] : [step.stage];
          log(`         ${securedText(ph, stages)}`);
          for (const sg of stages) { stats.toMark.push({ stage: sg, rounds: blockStart.rounds }); noteMark(ph, sg, "earned"); }
        } else if (res.event) log(`         (${res.event === "rotate" ? "back to this one later" : res.event === "park" ? "parked for today" : res.event})`);
        if (res.event === "rotate" || res.event === "park") lastEvent = { p: ph.i };
        continue;
      }
      // runs: first, run, singon, finish, through
      const cov = []; for (let k = step.from; k <= step.to; k++) cov.push(k);
      const results = cov.map((p) => { const a = attempt(ps[p], "song", 1, true); return { time: a.tv, tune: a.uv }; });
      for (const p of cov) stats.sections.add(ps[p].section);
      const before = cov.map((p) => phraseMarks(st.doc, ps[p]));
      const r = applyRun(st.doc, st.session, song, cov, results, { rate: 1, guide: "click", first: step.kind === "first", at: now(), kind: step.kind }, now());
      st.doc = r.doc; st.session = r.session;
      stats.runs++;
      cov.forEach((p, k) => { const m = phraseMarks(st.doc, ps[p]); for (const sg of ["time", "tune", "song"]) if (m[sg] && !before[k][sg]) noteMark(ps[p], sg, "run"); });
      const words = runResult(r.moved, r.improved, song);
      for (const i of r.improved) stats.betterTold[i] = (stats.betterTold[i] || 0) + 1;
      log(`         ${words.headline || ""}${words.headline && words.win ? " · " : ""}${words.win ? `${words.win} ▶ Then → Now` : ""}${!words.headline && !words.win ? `(map: ${r.moved.map(([i, m]) => `${i + 1}${{ time: "♩", tune: "♪", song: "✓" }[m]}`).join(" ") || "—"})` : ""}`);
      t += (ps[step.to].q1 - ps[step.from].q0) * opts.spq + 6;
      if (step.kind === "through") break;
    }
    const map = ps.map((ph) => { const m = phraseMarks(st.doc, ph); return m.song ? "✓" : m.tune ? "♪" : m.time ? "♩" : m.reached ? "·" : " "; }).join("");
    log(`  map [${map}]`);
    return map;
  }
  function noteMark(ph, stage, how) { stats.marks.push({ p: ph.i, stage, how }); }
  const t0 = Date.UTC(2026, 10, 12, 17);
  const map1 = runSession("day 1", t0, MINUTES);
  // overnight: keep 80% of the day's gains
  for (const sk of skill) for (const k of ["time", "tune"]) sk[k] = clamp(sk[k] - 0.2 * sk.gain[k] * 6);
  const map2 = runSession("day 2", t0 + 20 * 3600e3, MINUTES);
  return { out, stats, map1, map2, phrases: ps.length, sections: song.sections.length };
}
function clamp(x) { return Math.max(0.02, Math.min(0.98, x)); }

const songs = opt("song") ? [opt("song")] : SONGS;
const profs = opt("profile") ? [opt("profile")] : Object.keys(PROFILES);
const rows = [];
const TOT = { cards: 0, again: 0, stops: 0, sessions: 0, rider: 0, afterRot: 0, winRep: 0, maxPer: 0 };
for (const s of songs) for (const p of profs) {
  const res = simulate(s, p, SEED + s.length * 31 + p.length);
  if (!SUMMARY) console.log(res.out.join("\n"));
  rows.push({ s, p, ...res });
}
console.log("\n=== summary ===");
const med = (xs) => { if (!xs.length) return "–"; const a = [...xs].sort((x, y) => x - y); return a[a.length >> 1]; };
for (const r of rows) {
  const st = r.stats;
  const share = st.rounds ? st.wins / st.rounds : 0;
  const rt = (sg) => st.toMark.filter((x) => x.stage === sg).map((x) => x.rounds);
  const by = (sg, how) => st.marks.filter((m) => m.stage === sg && (!how || m.how === how)).length;
  console.log(`${r.s} · ${r.p}: ${st.rounds} rounds, ${Math.round(share * 100)}% end with a win (cue only ${st.cueOnly}, "Again" ${st.againOnly}); ` +
    `rounds to ♩ med ${med(rt("time"))} max ${Math.max(0, ...rt("time"))}, to ♪ med ${med(rt("tune"))} max ${Math.max(0, ...rt("tune"))}; ` +
    `marks ♩${by("time")} ♪${by("tune")} ✓${by("song")} (self ${st.marks.filter((m) => m.how === "self").length}); runs ${st.runs}; ` +
    `sections ${st.sections.size}/${r.sections}; map ${r.map1} → ${r.map2}` +
    `${st.triple.length ? `; CARD ×3: ${st.triple.join(" | ")}` : ""}${st.tripleRes.length ? `; RESULT ×3: ${st.tripleRes.slice(0, 3).join(" | ")}` : ""}`);
  const days = [...new Set(st.cards.map((c) => c.day))];
  const per = days.map((d) => {
    const cs = st.cards.filter((c) => c.day === d), byP = {};
    for (const c of cs) if (c.p !== null) byP[c.p] = (byP[c.p] || 0) + 1;
    const top = Object.entries(byP).sort((a, b) => b[1] - a[1])[0];
    return `${d}: ${cs.length} cards, again ${cs.filter((c) => c.again).length} (${Math.round((100 * cs.filter((c) => c.again).length) / Math.max(1, cs.length))}%), max/phrase ${top ? `${top[1]} (#${top[0]})` : "–"}, stops ${(st.stops[d] || []).length}${(st.stops[d] || []).length ? ` @${st.stops[d].join(",")}` : ""}`;
  });
  console.log(`    ${per.join(" | ")}; rider cards ${st.riderCards}; same phrase after rotate ${st.afterRotate.length}; win same as last round ${st.winRepeats}/${st.wins}; "better" repeats ${Object.values(st.betterTold).filter((n) => n > 1).length}`);
  for (const d of days) { TOT.cards += st.cards.filter((c) => c.day === d).length; TOT.again += st.cards.filter((c) => c.day === d && c.again).length; TOT.stops += (st.stops[d] || []).length; TOT.sessions++; }
  TOT.maxStage = Math.max(TOT.maxStage || 0, ...days.map((d) => { const byP = {}; for (const c of st.cards) if (c.day === d && c.kind === "stage") byP[c.p] = (byP[c.p] || 0) + 1; return Math.max(0, ...Object.values(byP)); }));
  TOT.rider += st.riderCards; TOT.afterRot += st.afterRotate.length; TOT.winRep += st.winRepeats; TOT.maxPer = Math.max(TOT.maxPer, ...days.map((d) => { const byP = {}; for (const c of st.cards) if (c.day === d && c.p !== null) byP[c.p] = (byP[c.p] || 0) + 1; return Math.max(0, ...Object.values(byP)); }));
}
console.log(`cards ${TOT.cards}, "again"/"full speed" ${Math.round((100 * TOT.again) / Math.max(1, TOT.cards))}%, stop prompts ${(TOT.stops / Math.max(1, TOT.sessions)).toFixed(2)}/session, max cards on one phrase in a session ${TOT.maxPer} (phrase steps alone ${TOT.maxStage}), rider cards ${TOT.rider}, same phrase right after rotate ${TOT.afterRot}, win same as the round before ${TOT.winRep}`);
const all = rows.reduce((a, r) => ({ rounds: a.rounds + r.stats.rounds, wins: a.wins + r.stats.wins }), { rounds: 0, wins: 0 });
console.log(`overall: ${Math.round((100 * all.wins) / all.rounds)}% of ${all.rounds} rounds end with a win (target ~75%)`);
