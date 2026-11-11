// Guided practice (docs/COACHING.md): a song practised phrase by phrase. Each phrase earns
// ♩ in time, ♪ in tune and ✓ in the song; the site picks one next step at a time.
//
// Pure: no DOM, no storage, no imports. sing.js loads and saves the per-song doc
// (`resonate.sing.practice`) and the device's session (`resonate.sing.session`), measures
// each round and run, and passes the results in; everything here is plain data in, plain
// data out (the doc and session given are never changed — new copies come back).
//
// Every threshold lives in PRACTICE so it can be tuned against real sessions.

export const PRACTICE = {
  phrase:  { minSyl: 6, minSec: 2.5, maxSyl: 16, maxSec: 10, tailMax: 1.5, hardRestBars: 1, dqGrid: 24 },
  section: { stopSec: 75, passMinSec: 30, runMaxSec: 90, fromTopWithinSec: 15 },
  time:    { slipBeats: 0.6, slipSec: 0.25, slipSecUncal: 0.35,
             firstVoicedMs: 80, firstBackMs: 120, firstEnergyDb: 12, firstEnergyMs: 150, firstWin: [-1, 4] /* beats */,
             heard: 0.30, noteHeard: 0.20, heardDb: 10, evidence: 0.40, evidenceMin: 2, shiftShare: 0.80,
             leadN: 4, seedRound: [-0.15, 0.25], glideLooseFrac: 0.5, glideLooseMin: 1 },
  tune:    { pass: 0.80, credit: 0.90, offBeats: 1 },
  secure:  { window: 3, need: 2 },
  // slip: counting slips in a row step the tempo down at once (90%, then 80%), in both stages —
  // the simulator's late-entry singer otherwise heard "Count in — … a beat sooner" twice at full
  // speed before the In time ladder moved, and up to ten times In tune, where slips aren't
  // counted. blockMax: every block ends — after this many rounds of any kind it moves on (a
  // singer who keeps answering "Again" to the self-check).
  ladder:  { time: { 2: 0.9, 3: 0.8 }, tune: { 3: 0.9, 4: 0.8 }, slip: { 1: 0.9, 2: 0.8 }, floor: 0.8,
             rotateAfter: 6, parkAfterRotations: 2, leaveOutSteps: 2, selfCheckAfter: 2, blockMax: 10 },
  // redoAfterSlips: a phrase slips in this many runs (without holding in between) before its
  // next step practises it again ("· again" / "· full speed"); a redo that comes back in the
  // same session counts as a rotation (twice → parked). "Good place to stop": never before
  // stopNotBeforeMin, then once ≥ stopAfterMarks milestones moved (§6: a stage secured — ♩♪ at
  // once is one —, a section in the song; not each phrase's ✓ or credit in a run) or
  // stopAfterMin went by; again only after stopAgainMarks more.
  plan:    { window: 3, runEvery: 4, runAfterTune: 2, runFromTopEvery: 3, otherSectionEvery: 3, redoAfterSlips: 2,
             sessionGapH: 3, stopNotBeforeMin: 10, stopAfterMin: 20, stopAfterMarks: 2, stopAgainMarks: 6 },
  then:    { excerptSec: 30, gapSec: 0.6, pad: 0.5 },
  log: 12,
};

const P = PRACTICE;
const EPS = 1e-6;
const clone = (x) => JSON.parse(JSON.stringify(x));
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
// (rhythm.js's tolerances: within tolOn is with the beat, past tolFlag worth a word)
const tolOn = (u) => Math.min(0.08, Math.max(0.04, 0.2 * u));
const tolFlag = (u) => Math.min(0.16, Math.max(0.08, 0.33 * u));

// FNV-1a, two seeds (≈ 64 bits): phrase keys are compared across sessions and songs' verses.
function fnv(s) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a ^= c; a = Math.imul(a, 0x01000193) >>> 0;
    b ^= c; b = Math.imul(b, 0x01000193) >>> 0; b ^= b >>> 13;
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

// ---------------------------------------------------------------------------
// Phrases and sections (§3.1)

// Does note j's syllable run on into the next sung syllable? (as sing.js joinsNext: an OCR'd
// score sometimes tags a whole word "begin", which mustn't glue it to the next word)
function joinsNext(notes, j) {
  const s = notes[j].syllabic;
  if (s !== "begin" && s !== "middle") return false;
  for (let i = j + 1; i < notes.length; i++) {
    if (notes[i].melisma || !notes[i].text) continue;
    return notes[i].syllabic === "middle" || notes[i].syllabic === "end";
  }
  return false;
}
function wordsOf(notes, js) {
  let s = "";
  for (const j of js) {
    const n = notes[j];
    if (n.melisma || !n.text) continue;
    s += n.text + (joinsNext(notes, j) ? "" : " ");
  }
  return s.replace(/\s+/g, " ").trim();
}
const bare = (w) => w.replace(/^[“”"'‘’(\[]+|[“”"’)\].,;:!?…]+$/g, "");
// A phrase as the card names it: the words of its first lyric line (`head`; never across
// lines — "to quell…", not "to quell And they're…") up to the first punctuation, at most
// `max` words, "…" when the phrase goes on (dots: "more" — any cut; "cut" — only a cut at
// `max` or at a line end without punctuation).
export function phraseName(ph, max = 4, dots = "more") {
  if (!ph.words) return ph.bars || "";
  const w = (ph.head || ph.words).split(" ");
  const out = [];
  let stop = false;
  for (const x of w) {
    if (out.length >= max) break;
    out.push(bare(x));
    if (/[,.;:!?]["'”’)]*$/.test(x)) { stop = true; break; }
  }
  const more = out.length < w.length || (!!ph.head && !!ph.headCut);
  const s = out.filter(Boolean).join(" ");
  return s + (more && (dots === "more" || !stop) ? "…" : "");
}
// The previous syllable note before j (not a held note, has words), or -1.
function prevSyl(notes, j) {
  for (let k = j - 1; k >= 0; k--) if (!notes[k].melisma && notes[k].text) return k;
  return -1;
}
// The words a phrase is named by: its first lyric line's notes only, starting on a whole word.
// A phrase that starts inside a word — the syllable before it left open, and either this one
// continues it or a jump / new pass falls between two "begin"s (Wichita's "va" | "ca-tion": OCR
// tags whole words "begin" too) — is named from its next word: "but it don't…", never
// "cation…". (Joining the earlier syllables back on isn't safe with OCR'd lyrics: Piano Man's
// "car" + "and" would read "carand".) "" when the line has no other word.
function headWords(notes, js, hard) {
  const s = wordsOf(notes, js);
  const first = js.find((j) => !notes[j].melisma && notes[j].text);
  if (first === undefined) return s;
  const prev = prevSyl(notes, first);
  const open = prev >= 0 && (notes[prev].syllabic === "begin" || notes[prev].syllabic === "middle") && !/[,.;:!?]["'”’)]*$/.test(notes[prev].text);
  const syl = notes[first].syllabic;
  const mid = open && (syl === "middle" || syl === "end" || (syl === "begin" && (hard === "jump" || hard === "pass")));
  return mid ? s.split(" ").slice(1).join(" ") : s;
}

// notes: the Sing page's notes, each { wmidi, midi, q, dq, t, d, text, syllabic, melisma,
//   restBefore, pass, measure, mi } (t/d song seconds at the current rate; q/dq quarters).
// lines: lyricLines() — arrays of note indices.
// opts: { spq: the song's own seconds per quarter (never the % rate: it mustn't regroup),
//   barQAt(q) → quarters in the bar at q, measureOf: score.measureOf or null }.
// → { phrases: [{ i, js, lines, j0, j1, q0, q1, t0, t1, sec, syl, name, label, words, mk, wk,
//     hardBefore, hard, pass, bars, section }], sections: [{ i, p0, p1, q0, q1, sec }] }
//   name: the first words up to the first punctuation, ≤ 4, "…" when the phrase goes on
//   ("Amazing grace…", "That saved a wretch…"); label: the same without "…" after a whole
//   clause ("Was blind"); "Bars 12–14" without lyrics. hard: the hard boundary before it
//   ("start" | "rest" | "jump" | "pass") or null.
export function groupPhrases(notes, lines, opts = {}) {
  const spq = opts.spq || 0.75;
  const barQAt = opts.barQAt || (() => 4);
  const measureOf = opts.measureOf || null;
  const ph = P.phrase;
  if (!notes.length) return { phrases: [], sections: [] };
  const lyrics = notes.some((n) => n.text);
  // A hard boundary between notes a = j−1 and b = j (always closes a phrase, even inside a
  // lyric line: a repeat jump or a new verse pass may come mid-line, e.g. Wichita's "va-|cation").
  const hardAt = (j) => {
    const a = notes[j - 1], b = notes[j];
    if ((a.pass ?? 1) !== (b.pass ?? 1)) return "pass";
    if (measureOf && a.mi !== undefined && b.mi !== undefined) {
      for (let k = a.mi + 1; k <= b.mi; k++) if (measureOf[k] !== measureOf[k - 1] + 1) return "jump";
    } else if (a.measure !== undefined && Number(b.measure) < Number(a.measure)) return "jump";
    const end = a.q + a.dq;
    if (b.q - end >= P.phrase.hardRestBars * barQAt(end) - EPS) return "rest";
    return null;
  };
  // Pieces: lyric lines, split where a hard boundary falls inside one.
  const pieces = [];
  lines.forEach((l, li) => {
    let cur = null;
    for (const j of l) {
      const h = j > 0 ? hardAt(j) : "start";
      if (!cur || (h && cur.js.length)) {
        if (cur) pieces.push(cur);
        const before = !cur && pieces.length === 0 ? "start" : h || (notes[j].restBefore ? "breath" : "punct");
        cur = { js: [], li, before, hard: h };
      }
      cur.js.push(j);
    }
    if (cur) pieces.push(cur);
  });
  pieces[0].before = "start";
  const syl = (js) => js.filter((j) => !notes[j].melisma).length;
  // syllables that carry words (every note when the song has no lyrics): a phrase with fewer
  // than 2 can't be practised on its own (ride)
  const lsyl = (js) => js.filter((j) => !notes[j].melisma && (!lyrics || notes[j].text)).length;
  const qEnd = (js) => Math.max(...js.map((j) => notes[j].q + notes[j].dq));
  const secOf = (js) => (qEnd(js) - notes[js[0]].q) * spq;
  const isHard = (b) => b !== "breath" && b !== "punct";
  const hasMin = (js) => syl(js) >= ph.minSyl && secOf(js) >= ph.minSec - EPS;
  const overMax = (js, k = 1) => syl(js) > k * ph.maxSyl || secOf(js) > k * ph.maxSec + EPS;
  // Grow phrases piece by piece (§3.1): hard boundaries always close; a breath closes once
  // the minimum is there; punctuation only when the next line would pass the maximum. (And
  // nothing grows past 1.5× the maximum — a run of held "oh"s before a long line made a 22 s
  // phrase in The Longest Time.)
  const groups = [];
  let g = null;
  for (const pc of pieces) {
    if (!g) { g = { js: [...pc.js], lines: [pc.li], before: pc.before }; continue; }
    // A piece with no words cut off by a jump or a new verse pass — a held note running on
    // into a 2nd ending (Killing Me Softly's "song"), a melisma over a pass change (Wichita's
    // "line…") — belongs to the phrase before it in performance order: alone it has nothing to
    // sing. (Not across a rest of a bar or more: that's a phrase of its own, which only rides
    // along in runs.)
    if ((pc.hard === "jump" || pc.hard === "pass") && lsyl(pc.js) === 0) {
      const end = qEnd(g.js);
      if (notes[pc.js[0]].q - end < P.phrase.hardRestBars * barQAt(end) - EPS) {
        g.js.push(...pc.js);
        if (!g.lines.includes(pc.li)) g.lines.push(pc.li);
        continue;
      }
    }
    const both = [...g.js, ...pc.js];
    const close = isHard(pc.before) || overMax(both, ph.tailMax) || (hasMin(g.js) && (pc.before === "breath" || overMax(both)));
    if (close) { groups.push(g); g = { js: [...pc.js], lines: [pc.li], before: pc.before }; }
    else { g.js.push(...pc.js); if (!g.lines.includes(pc.li)) g.lines.push(pc.li); }
  }
  groups.push(g);
  // A short tail (closed by a hard boundary or the song's end) joins the phrase before it when
  // nothing hard separates them and the result stays within 1.5× the maximum.
  for (let k = groups.length - 1; k > 0; k--) {
    const t = groups[k];
    if (hasMin(t.js) || isHard(t.before)) continue;
    const both = [...groups[k - 1].js, ...t.js];
    if (overMax(both, ph.tailMax)) continue;
    groups[k - 1].js = both;
    for (const li of t.lines) if (!groups[k - 1].lines.includes(li)) groups[k - 1].lines.push(li);
    groups.splice(k, 1);
  }
  const phrases = groups.map((gr, i) => {
    const js = gr.js, j0 = js[0], j1 = js[js.length - 1] + 1, last = notes[j1 - 1];
    const q0 = notes[j0].q, q1 = qEnd(js);
    const words = lyrics ? wordsOf(notes, js) : "";
    const m0 = notes[j0].measure, m1 = last.measure;
    const bars = m0 === undefined ? "" : String(m0) === String(m1) ? `Bar ${m0}` : `Bars ${m0}–${m1}`;
    const keys = phraseKeys(notes, js, words);
    // (the name's words: the first lyric line only — or the next one when the first holds
    // nothing but the end of a word cut by a jump)
    const inLine = (k) => { const set = new Set(lines[gr.lines[k]] || []); return js.filter((j) => set.has(j)); };
    let head = "", named = new Set(js);
    if (words) {
      const hjs = inLine(0);
      head = hjs.some((j) => notes[j].text) ? headWords(notes, hjs, isHard(gr.before) ? gr.before : null) : "";
      named = new Set(hjs);
      if (!head && gr.lines.length > 1) { const next = inLine(1); head = wordsOf(notes, next); named = new Set([...hjs, ...next]); }
    }
    const out = {
      i, js, lines: gr.lines, j0, j1, q0, q1, t0: notes[j0].t, t1: Math.max(...js.map((j) => notes[j].t + notes[j].d)),
      sec: (q1 - q0) * spq, syl: syl(js), words, bars, mk: keys.mk, wk: keys.wk,
      hardBefore: isHard(gr.before), hard: isHard(gr.before) ? gr.before : null, pass: notes[j0].pass ?? 1, section: 0,
      // ride: fewer than 2 syllables with words — never practised alone, it rides along in runs
      ride: lsyl(js) < 2, head: head || words, headCut: !!head && js.some((j) => !named.has(j) && notes[j].text && !notes[j].melisma),
    };
    out.name = words ? phraseName(out) : bars || notes.slice(j0, Math.min(j1, j0 + 4)).map((n) => n.name).join(" ");
    out.label = words ? phraseName(out, 4, "cut") : out.name; // "Sing to “Was blind”": no "…" after a full clause
    return out;
  });
  // Sections (§3.1): from the entry, close at the first phrase that ends ≥ 75 s after the
  // section's start, before a verse-pass change once ≥ 30 s long, or at the song's end.
  const sections = [];
  let s0 = 0;
  for (let k = 0; k < phrases.length; k++) {
    const startQ = phrases[s0].q0;
    if (k > s0 && phrases[k].pass !== phrases[k - 1].pass && (phrases[k - 1].q1 - startQ) * spq >= P.section.passMinSec) {
      sections.push([s0, k]); s0 = k;
    }
    if ((phrases[k].q1 - phrases[s0].q0) * spq >= P.section.stopSec) { sections.push([s0, k + 1]); s0 = k + 1; }
  }
  if (s0 < phrases.length) sections.push([s0, phrases.length]);
  const secs = sections.map(([p0, p1], i) => {
    for (let k = p0; k < p1; k++) phrases[k].section = i;
    return { i, p0, p1, q0: phrases[p0].q0, q1: phrases[p1 - 1].q1, sec: (phrases[p1 - 1].q1 - phrases[p0].q0) * spq };
  });
  return { phrases, sections: secs };
}

// Keys (§3.1): mk (music) hashes each note's interval to the phrase's first note in written
// semitones, its length on a 1/24-quarter grid, a rest before it and whether it starts a
// syllable — so transposing, a tempo change, or an OMR fix that moves a whole phrase an
// octave or respells it keeps the marks, and repeats and verses with the same tune share
// them. (The first note's own rest-before is left out: it says where the phrase sits, not
// what it is — a repeat after a jump may lack the rest the first time had.)
// wk (music + words) adds the words, lowercase letters only.
export function phraseKeys(notes, js, words = null) {
  const w0 = notes[js[0]].wmidi ?? notes[js[0]].midi;
  const parts = js.map((j, k) => {
    const n = notes[j];
    return [(n.wmidi ?? n.midi) - w0, Math.round(n.dq * P.phrase.dqGrid), k > 0 && n.restBefore ? 1 : 0, n.melisma ? 0 : 1].join(",");
  });
  const mk = fnv(parts.join(";"));
  const letters = (words ?? wordsOf(notes, js)).toLowerCase().replace(/[^\p{L}]+/gu, "");
  return { mk, wk: `${mk}.${fnv(letters)}` };
}

// ---------------------------------------------------------------------------
// State (§8.1)

// doc.sec (an addition to §8.1): the section where the plan last reached new music — the
// "current section" (a repeated chorus shares its words' state, so where the singer is
// can't be read back from the reached marks).
export function newDoc() {
  return { v: 1, heard: 0, firstRun: 0, lastAt: 0, runs: 0, runsSinceTop: 0, stepsSinceRun: 0, tuneSinceRun: 0, sec: 0, m: {}, w: {} };
}

// The session (device only). Beyond §8.1's fields: picks (blocks started, for "every third
// pick from another section"), gain (marks moved since the first run, for "Good place to
// stop"), stopAt (the step count when it was due), parked, cur (the block running: rounds go
// on by themselves), just (♩ just secured: in tune next), check (a self-check waiting),
// finish (a park asks for "Finish with"), redos (run redos set this session, per music key).
export function newSession(now, songId = null) {
  return { songId, start: now, lastAt: now, steps: 0, picks: 0, moved: [], gain: 0, stopShown: null, stopAt: -1,
    left: {}, rotations: {}, parked: {}, redos: {}, last: null, cur: null, just: null, check: null, finish: false };
}
// The session to use now: a new one after 3 h without practice, or for another song.
export function sessionFor(session, songId, now) {
  if (!session || session.songId !== songId || now - (session.lastAt || 0) > P.plan.sessionGapH * 3600e3) return newSession(now, songId);
  return session;
}

const newM = () => ({ time: null, tune: null, thin: false, step: null, a: [] });
const newW = (ph) => ({ q0: ph.q0, words: ph.words, reached: 0, song: null, then: null });
const newStep = (stage, rate = 1) => ({ stage, recent: [], miss: 0, rounds: 0, rate, rotated: 0, at: 0, unc: 0, total: 0, tr: [], slowed: rate < 1 });

export function phraseMarks(doc, ph) {
  const m = doc.m[ph.mk] || {}, w = doc.w[ph.wk] || {};
  return {
    time: !!m.time, tune: !!m.tune, song: !!w.song, reached: !!w.reached,
    slower: !!((m.time && m.time.rate < 1) || (m.tune && m.tune.rate < 1)) && !m.full,
    thin: !!m.thin, due: m.redo || null, ride: !!ph.ride,
  };
}

function log(m, entry) {
  m.a.push(entry);
  if (m.a.length > P.log) m.a.splice(0, m.a.length - P.log);
}

// ---------------------------------------------------------------------------
// Verdicts (§3.3)

const SYL = (notes, ph) => ph.js.filter((j) => !notes[j].melisma);
const entryOf = (notes, ph) => SYL(notes, ph)[0] ?? ph.j0;

// The counting slip (§3.3 rule 2): the first sound after a silent count-in, a beat or more
// late — or an entry observation that counts a beat. (r.calibrated: the round trip was measured
// from the count-in clicks, any length — the first sound is then placed right, Bluetooth too;
// r.measuredRt: measured and ≤ 0.1 s, which only behind/ahead needs.)
function slipOf(ph, r, notes) {
  if (!r || r.trust !== "ok" || r.guide === "melody") return null;
  const beat = r.beat || 0.6;
  const need = Math.max(P.time.slipBeats * beat, (r.calibrated ?? r.measuredRt) ? P.time.slipSec : P.time.slipSecUncal);
  const e = entryOf(notes, ph);
  if (r.lag !== null && r.lag !== undefined && r.lag >= need) return { kind: "slip", j: e, dir: "late" };
  const o = (r.obs || []).find((x) => (x.kind === "late-in" || x.kind === "early-in") && x.count && x.tone === "try" && x.scope !== "take");
  if (o) return { kind: "slip", j: o.j ?? e, dir: o.kind === "late-in" ? "late" : "early" };
  return null;
}

const TIME_ORDER = ["late-in", "early-in", "rushing", "dragging", "offbeat-late", "offbeat-early", "short", "held", "behind", "ahead"];

// { ph, r: PhraseRhythm (or null: no recording), grades, notes, tapped } → verdict.
// r.obs are this phrase's observations (li = this phrase; j indexed like notes); r.takeObs the
// span's behind/ahead — rounds only (a run passes []); r.notes (optional) the take's per-note
// rhythm (take.rhythm.notes, indexed like notes) and r.u (s, the beat's division) for the wins'
// facts. tools/guidedverdicts.mjs phraseRhythms() builds r from rhythm.js the way rhythmOf should.
export function timeVerdict({ ph, r, grades = [], notes, tapped = false }) {
  const e = entryOf(notes, ph);
  const facts = { entryJ: e, entryOk: false, lag: r?.lag ?? null, cover: r?.cover ?? null, classified: r?.classified ?? 0,
    syllables: r?.syllables ?? SYL(notes, ph).length, steady: false, released: {}, heldOkJ: null, kinds: [], nCues: 0 };
  // 1. Unknown: nothing to time from (no recording, clicks not trusted, the melody guide).
  if (!r || r.trust !== "ok" || r.guide === "melody") return { v: "unknown", cue: null, facts, ev: null };
  tapped = tapped || !!r.tapped;
  const beat = r.beat || 0.6, u = r.u || beat / 2;
  const obs = (r.obs || []).filter((o) => o.scope !== "take");
  // facts for the wins
  const per = r.notes || null;
  const onEntry = obs.some((o) => (o.kind === "late-in" || o.kind === "early-in") && (o.j === undefined || o.j === e));
  if (!onEntry) {
    if (per && per[e] && per[e].cls) facts.entryOk = per[e].cls === "on" || per[e].cls === "close";
    else if (r.lag !== null && r.lag !== undefined) facts.entryOk = Math.abs(r.lag) <= tolFlag(u);
  }
  if (per) {
    for (const j of ph.js) {
      const x = per[j];
      if (!x || x.rel === undefined || x.rel === null) continue;
      facts.released[j] = obs.some((o) => o.kind === "short" && o.j === j) ? "short" : obs.some((o) => o.kind === "held" && o.j === j) ? "held" : "ok";
    }
    const ok = Object.keys(facts.released).map(Number).filter((j) => facts.released[j] === "ok" && notes[j].d >= 2 * beat - EPS);
    if (ok.length) facts.heldOkJ = ok.sort((a, b) => notes[b].d - notes[a].d)[0];
  }
  facts.steady = obs.some((o) => o.kind === "steady-line");
  // 2. Counting slip (counted).
  const slip = slipOf(ph, r, notes);
  if (slip) { facts.kinds = ["slip"]; facts.nCues = 1; facts.entryOk = false; return { v: "slip", cue: slip, facts, ev: "onsets" }; }
  // 3. Unheard (uncounted): too little voice over the phrase's notes.
  if (r.cover !== null && r.cover !== undefined && r.cover < P.time.heard) {
    return { v: "unheard", cue: { kind: "unheard", j: e }, facts, ev: null };
  }
  // 4. Try: the phrase's own observations, and in a round behind/ahead with enough to stand on.
  const tries = obs.filter((o) => o.tone === "try" && TIME_ORDER.includes(o.kind));
  const take = (r.takeObs || []).filter((o) => (o.kind === "behind" || o.kind === "ahead") && o.tone === "try");
  if (take.length && (r.leadN ?? 0) >= P.time.leadN && r.measuredRt && r.calibrated && r.guide === "click" && !tapped && r.seedAgrees) tries.push(take[0]);
  const enough = (r.classified ?? 0) >= Math.max(P.time.evidenceMin, P.time.evidence * (r.syllables ?? SYL(notes, ph).length));
  if (tries.length) {
    facts.kinds = [...new Set(tries.map((o) => o.kind))];
    facts.nCues = facts.kinds.length;
    // (a tapped timing map carries its own error: only slips are tries)
    if (!tapped) {
      const o = tries.sort((a, b) => TIME_ORDER.indexOf(a.kind) - TIME_ORDER.indexOf(b.kind))[0];
      return { v: "try", cue: { kind: o.kind, j: o.j ?? (o.kind === "late-in" || o.kind === "early-in" ? e : undefined) }, facts, ev: "onsets" };
    }
    return { v: "unsure", cue: null, facts, ev: null };
  }
  // 5. Unsure — unless the pitch grading's moved slots stand in as evidence.
  if (!enough) {
    const js = ph.js.filter((j) => grades[j]);
    const fine = js.filter((j) => grades[j].status === "good" || grades[j].status === "ok");
    const all = grades.filter((g) => g && (g.status === "good" || g.status === "ok") && typeof g.shift === "number").map((g) => g.shift);
    const med = median(all);
    if (js.length && med !== null && fine.length >= P.time.shiftShare * ph.js.length - EPS
      && fine.every((j) => typeof grades[j].shift === "number" && Math.abs(grades[j].shift - med) <= tolFlag(u) + EPS)) {
      return { v: "pass", cue: null, facts, ev: "shift" };
    }
    return { v: "unsure", cue: null, facts, ev: null };
  }
  // 6. Pass (a steady laid-back lag is style, inside the band).
  return { v: "pass", cue: null, facts, ev: "onsets" };
}

// { ph, r, grades, notes } → verdict for In tune (§3.3): a counting slip in the same round
// (uncounted; the slip is the cue) > unknown (mostly unclear: "Closer to the mic") > pass
// (≥ 0.80, nothing missed, no off note a beat long) > try with one cue.
// facts.credit: the pitch credit bar (≥ 0.90 and no pitch reasons) — In time rounds and runs
// give ♪ with it.
export function tuneVerdict({ ph, r, grades = [], notes }) {
  const facts = { score: null, credit: false, missedJ: [], offJ: [], goodJ: [], lean: 0, unclear: 0, goodLongJ: null, allFound: false, nCues: 0,
    timed: !!(r && r.trust === "ok" && r.guide !== "melody") }; // (the entry was measured: a slip would show)
  const beat = r?.beat || (notes[ph.j0].dq > 0 ? notes[ph.j0].d / notes[ph.j0].dq : 0.6);
  const slip = slipOf(ph, r, notes);
  const sung = ph.js.filter((j) => grades[j] && grades[j].status !== "unsung");
  if (!sung.length) return { v: "unknown", cue: null, facts, ev: null };
  const dur = (js) => js.reduce((a, j) => a + notes[j].d, 0);
  const all = dur(sung);
  const st = (j) => grades[j].status;
  const judged = sung.filter((j) => st(j) !== "unclear");
  const missed = sung.filter((j) => st(j) === "missed");
  const unclear = sung.filter((j) => st(j) === "unclear");
  const pitched = sung.filter((j) => ["good", "ok", "off"].includes(st(j)));
  const off = pitched.filter((j) => st(j) === "off").sort((a, b) => notes[b].d - notes[a].d);
  const inTune = pitched.filter((j) => st(j) !== "off");
  const score = judged.length ? judged.reduce((a, j) => a + (grades[j].hit || 0) * notes[j].d, 0) / dur(judged) : null;
  facts.unclear = all ? dur(unclear) / all : 0;
  facts.score = facts.unclear > 0.5 ? null : score;
  facts.missedJ = missed; facts.offJ = off; facts.goodJ = inTune;
  if (inTune.length >= 2) facts.lean = inTune.reduce((a, j) => a + (grades[j].dev || 0) * notes[j].d, 0) / dur(inTune);
  const good = sung.filter((j) => st(j) === "good").sort((a, b) => notes[b].d - notes[a].d);
  const longest = Math.max(...ph.js.map((j) => notes[j].d));
  if (good.length && notes[good[0]].d >= 0.5 * longest - EPS) facts.goodLongJ = good[0];
  facts.allFound = !missed.length && !off.length && !unclear.length;
  const missedReason = missed.length > 0 && (dur(missed) >= Math.min(0.5, all) - EPS || dur(missed) / all >= 0.15);
  const unclearReason = facts.unclear >= 0.3;
  const leanReason = Math.abs(facts.lean) >= 0.2;
  const reasons = [missedReason && "missed", off.length && "note", leanReason && (facts.lean < 0 ? "flat" : "sharp"), unclearReason && "unclear"].filter(Boolean);
  facts.nCues = reasons.length;
  if (slip) return { v: "slip", cue: slip, facts, ev: null };
  if (facts.score === null) return { v: "unknown", cue: { kind: "mic" }, facts, ev: null };
  facts.credit = facts.score >= P.tune.credit && !reasons.length;
  const longOff = off.some((j) => notes[j].d >= P.tune.offBeats * beat - EPS);
  if (facts.score >= P.tune.pass && !missedReason && !longOff) return { v: "pass", cue: null, facts, ev: null };
  // One cue: missed > the longest off note > lean > unclear (> the note sung furthest off).
  const noteCue = (j) => ({ kind: "note", j, dir: (grades[j].dev || 0) < 0 ? "up" : "down", note: notes[j].name });
  let cue;
  if (missedReason) cue = { kind: "missed", j: missed[0] };
  else if (off.length) cue = noteCue(off[0]);
  else if (leanReason) cue = { kind: facts.lean < 0 ? "flat" : "sharp" };
  else if (unclearReason) cue = { kind: "mic" };
  else {
    const worst = pitched.filter((j) => typeof grades[j].dev === "number").sort((a, b) => (grades[a].hit ?? 1) - (grades[b].hit ?? 1))[0];
    cue = worst !== undefined ? noteCue(worst) : { kind: "again" };
  }
  if (!facts.nCues) facts.nCues = 1;
  return { v: "try", cue, facts, ev: null };
}

// ---------------------------------------------------------------------------
// Rounds, securing and the ladder (§3.4)

// Counted rounds are passes and tries (a counting slip is a try In time; In tune it's only
// the cue). Unsure, unknown and unheard rounds don't count and don't break anything.
const counted = (stage, v) => v === "pass" || v === "try" || (v === "slip" && stage === "time");
const unsureish = (v) => v === "unsure" || v === "unknown" || v === "unheard";

function ladderRate(stage, miss, prev = 1) {
  const t = P.ladder[stage] || {};
  let r = 1;
  for (const k of Object.keys(t).map(Number).sort((a, b) => a - b)) if (miss >= k) r = t[k];
  return Math.max(P.ladder.floor, Math.min(prev ?? 1, r));
}
// The next round of a block: a confirm round if one of the last 2 counted rounds passed (at
// that pass's tempo), else a learning round down the ladder. Counting slips in a row step the
// tempo down at once, in either stage (In tune they aren't counted, so the ladder wouldn't move).

// A "· full speed" block (st.full) confirms at the song's tempo whatever tempo the pass was at:
// only a pass there clears it.
function blockSetup(st) {
  const last2 = st.recent.slice(-2);
  const pass = [...last2].reverse().find((x) => x[0] === "pass");
  const slip = st.slips ? ladderRate("slip", st.slips) : 1;
  if (pass) return { rate: st.full ? 1 : Math.min(pass[1], slip), confirm: true };
  return { rate: Math.min(ladderRate(st.stage, st.miss, st.rate), slip), confirm: false };
}

function endStep(doc, session, ph, stage, kind = "stage") {
  session.steps++;
  doc.stepsSinceRun++;
  session.last = { mk: ph.mk, p: ph.i, stage, kind };
  session.cur = null;
  session.finish = false;
}

// (session.gain — milestones for "Good place to stop" — is counted by the callers: one per
// secured event, so ♩♪ secured together count once)
const fullRedo = (m) => !!(m && m.redo === "time" && m.time && m.time.rate < 1 && !m.full);
function secure(doc, session, ph, stage, by, rate, now) {
  const m = doc.m[ph.mk];
  const fresh = !m[stage];
  if (fresh) m[stage] = { at: now, by, rate };
  if (stage === "time") {
    // ("· full speed" clears only at the song's tempo)
    if (m.redo === "time" && (rate >= 1 - EPS || !fullRedo(m))) delete m.redo;
    if (rate >= 1 && ((m.time && m.time.rate < 1) || (m.tune && m.tune.rate < 1))) m.full = now;
    session.just = { mk: ph.mk, p: ph.i };
  } else if (stage === "tune") {
    if (m.redo === "tune") delete m.redo;
    if (fresh) doc.tuneSinceRun++;
  }
  if (fresh) session.moved.push([ph.mk, stage, now]);
  return fresh;
}

// After a round on ph at `stage` (verdict from timeVerdict/tuneVerdict — In time, pass the
// same round's tuneVerdict as verdict.tune: a pass that meets the pitch credit bar counts as
// an In tune pass too). setup: the round's { rate, confirm }.
// → { doc, session, event: null | "secured" | "rotate" | "park" | "self-check", alsoTune,
//     fullSpeed (the first pass at the song's tempo after slower — a "Full speed" win) }
export function applyRound(doc0, session0, ph, stage, verdict, setup = {}, now = Date.now()) {
  const doc = clone(doc0), session = clone(session0);
  const m = (doc.m[ph.mk] ||= newM());
  if (!doc.w[ph.wk]) doc.w[ph.wk] = newW(ph);
  const rate = setup.rate ?? 1, confirm = !!setup.confirm;
  // A new block (or the singer moved to another phrase or stage): the step's state carries
  // over when it's the same stage (a rotated phrase comes back with its tempo and recent).
  const sameBlock = session.cur && session.cur.mk === ph.mk && session.cur.stage === stage;
  // (a run slip still waiting for its second, practised now — the plan offers it when nothing
  // else is left — is that redo: it counts like one)
  if (!sameBlock && pendingOf(m) === stage) setRedo(doc, session, ph.mk, now, false);
  if (!m.step || m.step.stage !== stage) m.step = newStep(stage, rate);
  const st = m.step;
  if (!sameBlock) { st.rounds = 0; st.unc = 0; st.total = 0; session.picks = (session.picks || 0) + 1; }
  if (stage === "time") st.full = fullRedo(m); // ("· full speed": confirms, and clears, at the song's tempo)
  // (singing on past a waiting self-check is "Again"; another phrase leaves it behind)
  if (session.check) { if (sameBlock) st.unc = 0; session.check = null; }
  session.just = null; // (♩ just secured: only for the step right after; a secure below sets it again)
  session.finish = false;
  session.stopAt = -1; // ("Good place to stop" shows until the next step starts)
  session.lastAt = now;
  doc.lastAt = now;
  st.at = now;
  st.total++;
  const v = verdict.v;
  log(m, [now, stage, v, verdict.cue?.kind ?? null, rate, verdict.facts?.score ?? verdict.tune?.facts?.score ?? null, verdict.ev ?? null, { n: verdict.facts?.nCues ?? 0, confirm }]);
  let event = null, alsoTune = false, fullSpeed = false;
  if (rate < 1) st.slowed = true;
  st.slips = v === "slip" ? (st.slips || 0) + 1 : v === "pass" || v === "try" ? 0 : st.slips || 0;
  if (counted(stage, v)) {
    const pass = v === "pass";
    st.rounds++;
    st.unc = 0;
    st.recent.push([pass ? "pass" : "try", rate, confirm]);
    if (st.recent.length > P.secure.window) st.recent.shift();
    st.miss = pass ? 0 : st.miss + 1;
    st.rate = Math.min(st.rate ?? 1, rate);
    if (stage === "time") {
      const credit = pass && !!verdict.tune?.facts?.credit;
      st.tr.push([credit ? "pass" : "try", rate, confirm]);
      if (st.tr.length > P.secure.window) st.tr.shift();
    }
    if (pass && rate >= 1 && (st.slowed || (m.redo === "time" && m.time && m.time.rate < 1))) { fullSpeed = true; st.slowed = false; }
    const passes = st.recent.filter((x) => x[0] === "pass").length;
    if (pass && confirm && passes >= P.secure.need && !(st.full && rate < 1 - EPS)) {
      const fresh = secure(doc, session, ph, stage, "earned", rate, now);
      event = "secured";
      const tr = st.tr;
      if (stage === "time" && !m.tune) {
        const trLast = tr[tr.length - 1];
        if (trLast && trLast[0] === "pass" && tr.filter((x) => x[0] === "pass").length >= P.secure.need) {
          secure(doc, session, ph, "tune", "credit", rate, now);
          alsoTune = true;
        }
      }
      if ((fresh || alsoTune) && doc.runs) session.gain = (session.gain || 0) + 1; // (one milestone, ♩♪ together too)
      // ♩ without ♪: the In tune block starts with the credit passes already sung.
      m.step = stage === "time" && !m.tune ? { ...newStep("tune", m.time.rate), recent: tr.filter((x) => x[0] === "pass").slice(-1) } : null;
      if (alsoTune) session.just = null;
      endStep(doc, session, ph, stage);
    } else if (st.rounds >= P.ladder.rotateAfter) {
      event = moveOn(doc, session, ph, stage, now);
    }
  } else if (unsureish(v)) {
    st.unc++;
    if (st.unc >= (m.thin ? 1 : P.ladder.selfCheckAfter)) {
      event = "self-check";
      session.check = { mk: ph.mk, p: ph.i, stage };
    }
  }
  if (!event && st.total >= P.ladder.blockMax) event = moveOn(doc, session, ph, stage, now);
  if (!event || event === "self-check") session.cur = { mk: ph.mk, p: ph.i, stage };
  return { doc, session, event, alsoTune, fullSpeed };
}

// Rotate (back to this one later), or park it after two rotations this session.
function moveOn(doc, session, ph, stage, now) {
  const m = doc.m[ph.mk];
  m.step.rounds = 0; m.step.unc = 0; m.step.total = 0; m.step.rotated = (m.step.rotated || 0) + 1;
  session.rotations[ph.mk] = (session.rotations[ph.mk] || 0) + 1;
  endStep(doc, session, ph, stage);
  if (session.rotations[ph.mk] >= P.ladder.parkAfterRotations) {
    session.parked[ph.mk] = now;
    session.finish = true;
    return "park";
  }
  session.left[ph.mk] = session.steps + P.ladder.leaveOutSteps;
  return "rotate";
}

// The self-check ("Sounded right?"): Yes secures the stage (by: "self") and marks the phrase
// thin (from then on its first uncounted round goes straight here); Again goes on.
export function answerSelfCheck(doc0, session0, ph, stage, yes, now = Date.now()) {
  const doc = clone(doc0), session = clone(session0);
  const m = (doc.m[ph.mk] ||= newM());
  session.check = null;
  session.lastAt = now;
  doc.lastAt = now;
  if (!yes) {
    if (m.step) m.step.unc = 0;
    session.cur = { mk: ph.mk, p: ph.i, stage };
    return { doc, session, event: null };
  }
  const rate = m.step?.rate ?? 1;
  if (secure(doc, session, ph, stage, "self", rate, now) && doc.runs) session.gain = (session.gain || 0) + 1;
  m.thin = true;
  m.step = null;
  if (stage === "tune") session.just = null;
  endStep(doc, session, ph, stage);
  return { doc, session, event: "secured" };
}

// More → "Timing's fine → in tune": ♩ by override.
export function overrule(doc0, session0, ph, now = Date.now()) {
  const doc = clone(doc0), session = clone(session0);
  const m = (doc.m[ph.mk] ||= newM());
  if (!doc.w[ph.wk]) doc.w[ph.wk] = newW(ph);
  session.lastAt = now;
  doc.lastAt = now;
  if (secure(doc, session, ph, "time", "override", 1, now) && doc.runs) session.gain = (session.gain || 0) + 1;
  if (m.step?.stage === "time") m.step = null;
  session.check = null;
  endStep(doc, session, ph, "time");
  return { doc, session, event: "secured" };
}

export function markHeard(doc0, now = Date.now()) {
  const doc = clone(doc0);
  if (!doc.heard) doc.heard = now;
  doc.lastAt = now;
  return doc;
}

// ---------------------------------------------------------------------------
// Runs (§3.3 credit, §3.5, §4.4)

const isTry = (v) => v === "try" || v === "slip";
const worse = (v) => isTry(v) || v === "unsure";

// A phrase's run slips become its "· again" / "· full speed" step (m.redo). A redo back again
// this session counts as a rotation: left out for a while (`leave`: set from a run — a block
// already under way just goes on), parked the second time.
function setRedo(doc, session, mk, now, leave) {
  const m = doc.m[mk];
  m.redo = m.rsk || "tune";
  m.rs = 0;
  delete m.rsk;
  session.redos ||= {}; session.rotations ||= {}; session.left ||= {}; session.parked ||= {};
  session.redos[mk] = (session.redos[mk] || 0) + 1;
  if (session.redos[mk] < 2) return;
  session.rotations[mk] = (session.rotations[mk] || 0) + 1;
  if (session.rotations[mk] >= P.ladder.parkAfterRotations) session.parked[mk] = now; // (quietly: no "Finish with" after a run)
  else if (leave) session.left[mk] = session.steps + P.ladder.leaveOutSteps;
}
// One run slip waiting for a second (or for a run that holds): the step it would get.
const pendingOf = (m) => (m && !m.redo && (m.rs || 0) >= 1 && m.rsk && m[m.rsk] ? m.rsk : null);

// covered: phrase indices sung in the run (in order); results[k] = { time, tune } verdicts for
// covered[k]; run: { rate (× the song's tempo), guide, first, at, kind? (the step's kind) }.
// → { doc, session, moved: [[i, mark]], improved: [i] }
//   improved: phrases whose first run ("then") went worse and that passed now — each only the
//   first time (w.then.told), so "Better than your first try" and ▶ Then → Now are news.
// A phrase that rides along (ph.ride: fewer than 2 syllables) gets its marks only here: ♩♪ when
// it went fine (no try, a pass in time or tune; never from the melody guide), ✓ like any
// phrase, and never a "· again" step.
// Run slips (doc.m[mk].rs): a phrase with ♩ (♪) that slips in time (tune) at the song's tempo
// in 2 runs without holding in between gets "· again" / "· full speed"; a redo that comes back
// in the same session counts as a rotation (session.rotations), so a second one parks it.
export function applyRun(doc0, session0, song, covered, results, run = {}, now = Date.now()) {
  const doc = clone(doc0), session = clone(session0);
  const at = run.at ?? now, rate = run.rate ?? 1, full = rate >= 1 - EPS;
  const moved = [], improved = [];
  const firstRun = !!run.first || !doc.runs;
  let newest = -1;
  // Repeats share their keys: any occurrence passing counts.
  const byKey = new Map();
  covered.forEach((i, k) => {
    const ph = song.phrases[i], res = results[k] || {};
    const tv = res.time?.v ?? "unknown", uv = res.tune?.v ?? "unknown";
    const songOk = !isTry(tv) && !isTry(uv);
    const g = byKey.get(ph.mk) || { ph, i, tPass: false, tTry: false, credit: false, uTry: false, songOk: false, rideOk: false };
    if (songOk) g.songOk = true;
    // ♩ credit: a timing pass (onsets or shifts) with the click guide or none — never the melody guide.
    if (tv === "pass" && run.guide !== "melody") g.tPass = true;
    if (isTry(tv)) g.tTry = true;
    if (res.tune?.facts?.credit && !isTry(tv)) g.credit = true;
    if (isTry(uv)) g.uTry = true;
    if (ph.ride && songOk && run.guide !== "melody" && (tv === "pass" || uv === "pass")) g.rideOk = true;
    byKey.set(ph.mk, g);
    const m = (doc.m[ph.mk] ||= newM());
    const w = (doc.w[ph.wk] ||= newW(ph));
    const hadTune = !!(doc0.m[ph.mk] && doc0.m[ph.mk].tune);
    log(m, [at, "run", `${tv}/${uv}`, res.time?.cue?.kind ?? res.tune?.cue?.kind ?? null, rate, res.tune?.facts?.score ?? null, res.time?.ev ?? null, { n: (res.time?.facts?.nCues ?? 0) + (res.tune?.facts?.nCues ?? 0), run: true }]);
    if (!w.reached) {
      w.reached = at;
      w.then = { rec: at, v: { time: tv, tune: uv } };
      newest = i;
    } else if (full && !ph.ride && w.then && !w.then.told && w.then.rec !== at && (worse(w.then.v.time) || worse(w.then.v.tune)) && songOk && (tv === "pass" || uv === "pass")) {
      if (!improved.includes(i)) improved.push(i);
      w.then.told = at;
    }
    // ✓ only for a phrase that already had ♪ before this run, at the song's tempo.
    if (hadTune && full && songOk && !w.song) {
      w.song = { at, rate };
      moved.push([i, "song"]);
      session.moved.push([ph.wk, "song", at]);
    }
  });
  const comeback = [];
  for (const g of byKey.values()) {
    const { ph, i } = g, m = doc.m[ph.mk];
    if ((g.tPass || g.rideOk) && !m.time) { m.time = { at, by: "credit", rate }; moved.push([i, "time"]); session.moved.push([ph.mk, "time", at]); }
    if (g.tPass && m.time && m.step?.stage === "time") m.step = null;
    // ♪ credit when ♩ holds (now or from before) and the pitch meets the credit bar.
    if ((g.credit || g.rideOk) && m.time && !g.uTry && !m.tune) {
      m.tune = { at, by: "credit", rate };
      moved.push([i, "tune"]); session.moved.push([ph.mk, "tune", at]);
      if (m.step?.stage === "tune") m.step = null;
    }
    // Held at the song's tempo: a mark earned slower is a full-speed mark now.
    if (full && g.tPass && !g.tTry && ((m.time && m.time.rate < 1) || (m.tune && m.tune.rate < 1))) m.full = at;
    // Slipped here (no ✓ yet), twice: its next step practises that again — "· full speed" when
    // the mark was earned slower, else "· again". (A ✓ phrase is done; marks are never lost.)
    const w = doc.w[ph.wk];
    if (full && g.songOk && (m.redo !== "time" || g.tPass)) { delete m.redo; m.rs = 0; delete m.rsk; } // (held in the song: done again)
    else if (!w.song && !firstRun && !ph.ride) {
      const slipT = full && g.tTry && !g.tPass && !!m.time;
      const slipU = g.uTry && !!m.tune && !g.credit;
      if (slipT || slipU) {
        if (m.redo) { if (slipT) m.redo = "time"; } // (already due)
        else {
          m.rs = (m.rs || 0) + 1;
          m.rsk = slipT ? "time" : m.rsk === "time" ? "time" : "tune";
          if (m.rs >= P.plan.redoAfterSlips) comeback.push(ph.mk);
        }
      }
    }
  }
  // A section now all in the song is a milestone (§6: "✓ … in the song"); a phrase's own ✓ or
  // credit isn't one — a good run moves a dozen marks at once.
  if (!firstRun) {
    const inSong = (d, ph) => ph.ride || !!d.w[ph.wk]?.song;
    for (const sc of song.sections) {
      const sp = song.phrases.slice(sc.p0, sc.p1);
      if (sp.some((ph) => !ph.ride) && sp.every((ph) => inSong(doc, ph)) && !sp.every((ph) => inSong(doc0, ph))) session.gain = (session.gain || 0) + 1;
    }
  }
  doc.runs++;
  if (firstRun && !doc.firstRun) doc.firstRun = at;
  doc.stepsSinceRun = 0;
  doc.tuneSinceRun = 0;
  doc.lastAt = now;
  const sec = covered.length ? song.sections[song.phrases[covered[0]].section] : null;
  const fromTop = sec && covered[0] === sec.p0;
  doc.runsSinceTop = fromTop ? 0 : (doc.runsSinceTop || 0) + 1;
  if (newest >= 0) doc.sec = song.phrases[newest].section;
  session.steps++;
  session.lastAt = now;
  session.last = { kind: run.kind || "run", from: covered[0], to: covered[covered.length - 1], at };
  session.cur = null;
  session.just = null;
  session.check = null;
  session.finish = false;
  for (const mk of comeback) setRedo(doc, session, mk, now, true);
  // "Good place to stop": after a run, not in the first 10 minutes; once ≥ 2 milestones moved
  // this session or 20 minutes went by; again only after 6 more.
  const g = session.gain || 0, mins = (now - (session.start ?? now)) / 60e3;
  if (!firstRun && mins >= P.plan.stopNotBeforeMin - EPS && (g >= P.plan.stopAfterMarks || mins >= P.plan.stopAfterMin - EPS)
    && (session.stopShown === null || session.stopShown === undefined || g >= session.stopShown + P.plan.stopAgainMarks)) {
    session.stopShown = g;
    session.stopAt = session.steps;
  }
  return { doc, session, moved, improved };
}

// ---------------------------------------------------------------------------
// The one next step (§4.1)

const RUN_SETUP = () => ({ rate: 1, confirm: false, lane: "off", trail: false, view: "perform", listen: false });

// lane: "neutral" (In time: bars and trail with no pitch colours), "off" (no bars or trail),
// "on". trail: the live pitch line — off in confirm rounds (In tune keeps the note bars: they're
// the target).
function stageSetup(stage, rate, confirm) {
  const lane = stage === "time" ? (confirm ? "off" : "neutral") : "on";
  return { rate, confirm, lane, trail: lane !== "off" && !confirm, view: "practice", listen: true };
}

// The context nextStep and pickPhrase work in.
function ctx(doc, song, session) {
  const ps = song.phrases;
  const mOf = (ph) => doc.m[ph.mk] || null;
  const reached = (ph) => !!doc.w[ph.wk]?.reached;
  const done = (ph) => { const m = mOf(ph); return !!(m && m.time && m.tune && !m.redo); };
  // (a phrase that rides along never waits for a run: runs pick it up on the way)
  const checked = (ph) => { const m = mOf(ph); return !ph.ride && !!(m && m.tune && !m.redo && !doc.w[ph.wk]?.song); };
  const parked = (ph) => !!session.parked?.[ph.mk];
  const left = (ph) => (session.left?.[ph.mk] ?? -1) > session.steps;
  const cur = Math.min(Math.max(0, doc.sec || 0), Math.max(0, song.sections.length - 1));
  return { ps, mOf, reached, done, checked, parked, left, cur };
}

// The stage a phrase is due for: ♩ → ♪, or "again" / "full speed" after a run slipped.
function stageFor(doc, ph) {
  const m = doc.m[ph.mk];
  if (m?.redo === "time") return { stage: "time", extra: m.time && m.time.rate < 1 && !m.full ? "full speed" : "again" };
  if (m?.redo === "tune") return { stage: "tune", extra: "again" };
  if (!m?.time) return { stage: "time", extra: null };
  if (!m.tune) return { stage: "tune", extra: null };
  return { stage: "tune", extra: "again" }; // practised by choice
}

function stageStep(doc, ph, stage, extra) {
  const m = doc.m[ph.mk];
  const st = m?.step && m.step.stage === stage ? m.step : null;
  const s = st ? blockSetup(st) : { rate: extra === "full speed" ? 1 : (stage === "tune" && m?.time ? Math.max(P.ladder.floor, m.time.rate ?? 1) : 1), confirm: false };
  const setup = stageSetup(stage, s.rate, s.confirm);
  // (the card shows the setup: a "full speed" block the ladder slowed says "slower")
  const ex = s.rate < 1 && (!extra || extra === "full speed") ? "slower" : extra || null;
  return { kind: "stage", stage, p: ph.i, from: ph.i, to: ph.i, setup, extra: ex, alt: [] };
}

// Seconds of the song (at its own tempo) from phrase a's start to phrase b's end.
const spqOf = (ps) => { for (const ph of ps) if (ph.q1 > ph.q0) return ph.sec / (ph.q1 - ph.q0); return 0.75; };
const spanSec = (ps, a, b) => (ps[b].q1 - ps[a].q0) * spqOf(ps);

// A run over [from, to] (inclusive), capped at 90 s of the song.
function runStep(song, from, to, kind = "run") {
  const ps = song.phrases;
  while (to > from && spanSec(ps, from, to) > P.section.runMaxSec) to--;
  return { kind, from, to, setup: RUN_SETUP(), extra: null, alt: [] };
}

// A phrase that rides along and comes right after the run's last phrase (no rest of a bar or
// more between): the run takes it along.
const tagAlong = (doc, ph) => !!ph && ph.ride && ph.hard !== "rest" && !doc.w[ph.wk]?.song;

// "Sing to X" (§3.5) in section s: X = the last checked phrase (♪, no ✓), else the first
// unreached one; from the section's start when that's ≤ 15 s before the first checked phrase
// (and every third run anyway), else one phrase before it; ≤ 90 s.
function runFor(doc, song, c, s) {
  const sec = song.sections[s];
  if (!sec) return null;
  const idx = [];
  for (let k = sec.p0; k < sec.p1; k++) idx.push(k);
  const chk = idx.filter((k) => c.reached(c.ps[k]) && c.checked(c.ps[k]));
  const unreached = idx.filter((k) => !c.reached(c.ps[k]));
  if (!chk.length && !unreached.length) return null;
  const first = chk.length ? chk[0] : unreached[0];
  let X = chk.length ? chk[chk.length - 1] : unreached[0];
  const top = (doc.runsSinceTop || 0) + 1 >= P.plan.runFromTopEvery
    || (c.ps[first].q0 - c.ps[sec.p0].q0) * spqOf(c.ps) <= P.section.fromTopWithinSec + EPS;
  let from = top ? sec.p0 : Math.max(sec.p0, first - 1);
  if (spanSec(c.ps, from, X) > P.section.runMaxSec) from = Math.max(sec.p0, first - 1);
  while (X > first && spanSec(c.ps, from, X) > P.section.runMaxSec) X--;
  // (phrases that ride along right after X come too, while they still lack ✓ — not across a
  // rest of a bar or more: Piano Man's lone note 16 bars on isn't worth the wait)
  while (X + 1 < sec.p1 && tagAlong(doc, c.ps[X + 1]) && spanSec(c.ps, from, X + 1) <= P.section.runMaxSec + EPS) X++;
  return runStep(song, from, X, "run");
}

// "Sing on" (§3.5): from one phrase before the first unreached phrase (in or after the current
// section, else anywhere) to the end of its section, ≤ 90 s.
function singOnStep(song, c) {
  const after = c.ps.find((ph) => !c.reached(ph) && ph.section >= c.cur) || c.ps.find((ph) => !c.reached(ph));
  if (!after) return null;
  const sec = song.sections[after.section];
  return runStep(song, Math.max(0, after.i - 1), sec.p1 - 1, "singon");
}

// The focus window of section s: its first 3 reached, unfinished phrases that aren't left
// out (one per music key: a repeat shares its marks).
function windowOf(doc, c, s, { ignoreLeft = false, ignoreParked = false } = {}) {
  const out = [], keys = new Set();
  for (const ph of c.ps) {
    if (ph.section !== s || ph.ride || !c.reached(ph) || c.done(ph) || keys.has(ph.mk)) continue;
    if (!ignoreParked && c.parked(ph)) continue;
    if (!ignoreLeft && c.left(ph)) continue;
    keys.add(ph.mk);
    out.push(ph);
    if (out.length >= P.plan.window) break;
  }
  return out;
}

// Rank (§4.1 rule 7): one fix away (a pass in recent, or a single cue last time); a different
// stage from the last step; lower stage; earlier in the song.
function rankPick(doc, session, cands) {
  const lastStage = session.last?.stage;
  const scored = cands.map((ph) => {
    const { stage, extra } = stageFor(doc, ph);
    const m = doc.m[ph.mk];
    const st = m?.step && m.step.stage === stage ? m.step : null;
    const lastLog = m?.a ? [...m.a].reverse().find((x) => x[1] === stage || x[1] === "run") : null;
    const near = !!(st && st.recent.some((x) => x[0] === "pass")) || !!(lastLog && lastLog[2] !== "pass" && lastLog[7]?.n === 1);
    return { ph, stage, extra, key: [near ? 1 : 0, stage !== lastStage ? 1 : 0, stage === "time" ? 1 : 0, -ph.i] };
  });
  scored.sort((a, b) => { for (let k = 0; k < 4; k++) if (a.key[k] !== b.key[k]) return b.key[k] - a.key[k]; return 0; });
  return scored;
}

function pick(doc, song, session, c, opts = {}) {
  const lastMk = session.last?.mk;
  const reachedSecs = [...new Set(c.ps.filter((ph) => c.reached(ph)).map((ph) => ph.section))];
  let win = windowOf(doc, c, c.cur, opts);
  const others = reachedSecs.filter((s) => s !== c.cur).map((s) => windowOf(doc, c, s, opts)).filter((w) => w.length);
  // Every third pick comes from another reached section that still has unfinished phrases.
  if (others.length && reachedSecs.length >= 2 && ((session.picks || 0) % P.plan.otherSectionEvery) === P.plan.otherSectionEvery - 1) win = others[0];
  if (!win.length && others.length) win = others[0];
  if (!win.length) return [];
  const cands = win.length > 1 ? win.filter((ph) => ph.mk !== lastMk) : win;
  return rankPick(doc, session, cands.length ? cands : win);
}

// → { kind: "hear"|"first"|"stage"|"run"|"singon"|"through"|"finish"|"selfcheck", stage?, p?,
//     from, to (phrase indices, inclusive), setup: { rate (× the song's tempo), confirm,
//     lane: "on"|"neutral"|"off", trail (the live pitch line), view, listen (the melody first) },
//     extra: null|"slower"|"full speed"|"again"|"stop", stop ("Good place to stop" goes with it),
//     cont (the next round of a block already running), alt: [step] (next best, for More) }
// A block's rounds come back as the same step with cont until it ends (secured, rotated,
// parked or a self-check); the caller runs them on by themselves.
export function nextStep(doc, song, session, now = Date.now()) {
  const step = baseStep(doc, song, session, now);
  const stopNow = session && session.stopAt === session.steps && session.stopAt >= 0;
  step.stop = !!stopNow;
  if (stopNow && !step.extra) step.extra = "stop";
  return step;
}

function baseStep(doc, song, session, now) {
  session = session || newSession(now);
  const ps = song.phrases;
  if (!ps.length) return { kind: "through", from: 0, to: -1, setup: RUN_SETUP(), extra: null, alt: [] };
  const c = ctx(doc, song, session);
  const s0 = song.sections[0];
  // A self-check waiting, or a block still running: rounds go on by themselves.
  if (session.check && ps[session.check.p]?.mk === session.check.mk) {
    const ph = ps[session.check.p];
    return { ...stageStep(doc, ph, session.check.stage, null), kind: "selfcheck" };
  }
  if (session.cur && ps[session.cur.p]?.mk === session.cur.mk) {
    const ph = ps[session.cur.p], m = doc.m[ph.mk];
    if (m?.step && m.step.stage === session.cur.stage) {
      const { extra } = stageFor(doc, ph);
      const step = stageStep(doc, ph, session.cur.stage, extra === "again" || extra === "full speed" ? extra : null);
      step.cont = true; // between rounds of a running block
      return withAlt(doc, song, session, c, step);
    }
  }
  // 1. Hear it; 2. the first run.
  if (!doc.heard && !doc.runs && !doc.firstRun) return { kind: "hear", from: s0.p0, to: s0.p1 - 1, setup: { rate: 1, confirm: false, lane: "on", trail: false, view: "practice", listen: true }, extra: null, alt: [] };
  if (!doc.runs) return { ...runStep(song, s0.p0, s0.p1 - 1, "first"), alt: [] };
  // After a park: finish on something the singer can do.
  const finishOn = () => ps.find((ph) => !ph.ride && doc.w[ph.wk]?.song) || ps.find((ph) => !ph.ride && doc.m[ph.mk]?.tune);
  if (session.finish) {
    const f = finishOn();
    if (f) return withAlt(doc, song, session, c, { ...runStep(song, f.i, f.i, "finish"), p: f.i });
  }
  // 3. ♩ just secured on P: P · in tune.
  if (session.just && session.last?.mk === session.just.mk) {
    const ph = ps[session.just.p];
    if (ph && ph.mk === session.just.mk && !doc.m[ph.mk]?.tune) return withAlt(doc, song, session, c, stageStep(doc, ph, "tune", null));
  }
  // 5. A run when one is due — or when the window is empty and phrases wait for one. (Runs
  // stay in the current section; when it has nothing for a run, the first section that does:
  // a phrase that got ♪ after the plan moved on still needs its ✓.)
  // (a run-like step over the span the last one sang — applyRun may not know the step's kind —
  // unless that run gave ♪ to a phrase in it: ✓ needs ♪ from before the run, so singing the same
  // span again is the step that can give it. Without this a first run that went well, or a Sing
  // on into a short last section, fell through to "Finish with" the song's first phrase.)
  // (a run to the same phrase as the last one, from wherever, is the same card: "Sing to X".
  // `strict`: even when that run gave ♪ — then the run that can give ✓ waits for its turn, or
  // for nothing else being left)
  const RUNS = ["run", "first", "singon"];
  const sameRun = (r, strict = false) => !!session.last && session.last.kind !== "stage"
    && ((session.last.from === r.from && session.last.to === r.to) || (RUNS.includes(session.last.kind) && RUNS.includes(r.kind) && session.last.to === r.to))
    && (strict || !ps.slice(r.from, r.to + 1).some((ph) => c.checked(ph) && (doc.m[ph.mk]?.tune?.at ?? -Infinity) >= (session.last.at ?? Infinity)));
  // (… and, while other work is left, so is a run to a phrase the last run just sang, or any
  // run right after one that moved nothing — a phrase that slipped there gets its "· again"
  // first, not run after fruitless run)
  const fruitless = !!session.last && RUNS.includes(session.last.kind) && !(session.moved || []).some((x) => x[2] === session.last.at);
  const again = (r) => sameRun(r, true) || fruitless || (!!session.last && RUNS.includes(session.last.kind) && session.last.from <= r.to && r.to <= session.last.to);
  const winNow = windowOf(doc, c, c.cur);
  const due = (doc.stepsSinceRun || 0) >= P.plan.runEvery || (doc.tuneSinceRun || 0) >= P.plan.runAfterTune;
  const secCur = song.sections[c.cur];
  const checkedIn = (s) => ps.slice(song.sections[s].p0, song.sections[s].p1).some((ph) => c.reached(ph) && c.checked(ph));
  const waitSec = checkedIn(c.cur) ? c.cur : song.sections.findIndex((x, s) => checkedIn(s));
  if (due || (!winNow.length && waitSec >= 0)) {
    const r = runFor(doc, song, c, waitSec >= 0 && !checkedIn(c.cur) && !winNow.length ? waitSec : c.cur) || (waitSec >= 0 ? runFor(doc, song, c, waitSec) : null);
    if (r && (due || !again(r))) return withAlt(doc, song, session, c, r);
  }
  // 6. Sing on: the current section's window is empty, nothing waits for a run there, and
  // unreached phrases remain.
  if (!winNow.length && !checkedIn(c.cur)) {
    const s = singOnStep(song, c);
    if (s && !again(s)) return withAlt(doc, song, session, c, s);
  }
  // 7. Pick a phrase (never the same step twice in a row unless nothing else is left).
  const sameAsLast = (x) => session.last?.kind === "stage" && session.last.mk === x.ph.mk && session.last.stage === x.stage;
  const ranked = pick(doc, song, session, c);
  const choice = ranked.find((x) => !sameAsLast(x));
  if (choice) return withAlt(doc, song, session, c, stageStep(doc, choice.ph, choice.stage, choice.extra), ranked.filter((x) => x !== choice));
  // 8. Sing it through, once every phrase has ✓ (those that ride along get theirs on the way).
  if (ps.every((ph) => ph.ride || doc.w[ph.wk]?.song)) return { kind: "through", from: 0, to: ps.length - 1, setup: RUN_SETUP(), extra: null, alt: [] };
  // What's left: a run that isn't the last one again (any section), Sing on, a phrase that's
  // left out for now, the same phrase again (the only one), and when all that's left is
  // parked — finish, or work on a parked one anyway.
  // (another section's run, Sing on, or a slipped phrase's "· again" before the same run again
  // for the ✓ its ♪ now allows)
  const secs = [c.cur, ...song.sections.map((x) => x.i).filter((s) => s !== c.cur)];
  for (const s of secs) {
    const r = runFor(doc, song, c, s);
    if (r && !again(r)) return withAlt(doc, song, session, c, r);
  }
  const on = singOnStep(song, c);
  if (on && !sameRun(on)) return withAlt(doc, song, session, c, on);
  // A phrase whose run slipped once, with nothing else left to do: its "· again" now (rather
  // than the same run straight back, or "Finish with" in the middle of a session). It counts as
  // a redo (applyRound): back again this session, it's a rotation.
  const pend = ps.filter((ph) => !ph.ride && c.reached(ph) && pendingOf(doc.m[ph.mk]) && !c.left(ph) && !c.parked(ph))
    .sort((a, b) => (a.section === c.cur ? 0 : 1) - (b.section === c.cur ? 0 : 1) || a.i - b.i)
    .map((ph) => { const m = doc.m[ph.mk], stage = pendingOf(m); return { ph, stage, extra: stage === "time" && m.time.rate < 1 && !m.full ? "full speed" : "again" }; })
    .filter((x) => !sameAsLast(x));
  if (pend.length) return withAlt(doc, song, session, c, stageStep(doc, pend[0].ph, pend[0].stage, pend[0].extra));
  for (const s of secs) {
    const r = runFor(doc, song, c, s);
    if (r && !sameRun(r)) return withAlt(doc, song, session, c, r);
  }
  // A phrase that's left out (just rotated away) or parked doesn't come straight back: first a
  // run over it in its section — it may well hold there — unless the last step was that run.
  const ranLast = (ph) => !!session.last && session.last.kind !== "stage" && session.last.from <= ph.i && ph.i <= session.last.to;
  const around = (ph) => {
    if (ranLast(ph)) return null;
    const sec = song.sections[ph.section];
    const near = (ph.q0 - sec.q0) * spqOf(ps) <= P.section.fromTopWithinSec + EPS;
    // (a section of one phrase: from the phrase before it, in the section before)
    for (const [a, b] of [[near ? sec.p0 : Math.max(sec.p0, ph.i - 1), ph.i], [Math.max(sec.p0, ph.i - 2), Math.min(sec.p1 - 1, ph.i + 1)], [Math.max(0, ph.i - 1), ph.i]]) {
      const r = runStep(song, a, b, "run");
      while (r.to + 1 < sec.p1 && tagAlong(doc, ps[r.to + 1]) && spanSec(ps, r.from, r.to + 1) <= P.section.runMaxSec + EPS) r.to++;
      if (r.from <= ph.i && ph.i <= r.to && r.to > r.from && !sameRun(r)) return r;
    }
    return null;
  };
  const leftOut = pick(doc, song, session, c, { ignoreLeft: true });
  const other = leftOut.find((x) => !sameAsLast(x)) || ranked[0] || leftOut[0];
  if (other) {
    const r = c.left(other.ph) || sameAsLast(other) ? around(other.ph) : null;
    return withAlt(doc, song, session, c, r || stageStep(doc, other.ph, other.stage, other.extra));
  }
  // All that's left is parked: "Finish with" came right after the park (session.finish); if
  // the singer goes on, a parked one anyway.
  const f = finishOn();
  const fin = f && { ...runStep(song, f.i, f.i, "finish"), p: f.i, alt: [] };
  const parkedOnes = pick(doc, song, session, c, { ignoreLeft: true, ignoreParked: true }).filter((x) => !sameAsLast(x));
  if (parkedOnes.length) return stageStep(doc, parkedOnes[0].ph, parkedOnes[0].stage, parkedOnes[0].extra);
  const whole = runStep(song, secCur.p0, secCur.p1 - 1, "run");
  return sameRun(whole) && fin ? fin : whole;
}

// Next-best steps, for More → Other.
function withAlt(doc, song, session, c, step, ranked = null) {
  const alt = [];
  const r = ranked || pick(doc, song, session, c).filter((x) => !(x.ph.i === step.p && x.stage === step.stage));
  if (r[0]) alt.push(stageStep(doc, r[0].ph, r[0].stage, r[0].extra));
  if (step.kind !== "run" && step.kind !== "singon") {
    const run = runFor(doc, song, c, c.cur);
    if (run) alt.push(run);
  }
  step.alt = alt;
  return step;
}

// The singer chose a phrase (More → Lines): its step.
// (a phrase that rides along is never practised alone: a run from the phrase before it)
export function pickPhrase(doc, song, session, p, now = Date.now()) {
  const ph = song.phrases[p];
  if (!ph) return nextStep(doc, song, session, now);
  if (ph.ride) {
    const sec = song.sections[ph.section];
    const a = Math.max(sec.p0, p - 1), b = a < p ? p : Math.min(sec.p1 - 1, p + 1);
    return { ...runStep(song, a, b, "run"), p };
  }
  const { stage, extra } = stageFor(doc, ph);
  return stageStep(doc, ph, stage, extra);
}

// "Sing from here" (More → Lines, ▶ from here): a run from p to the end of its section.
export function singFromHere(doc, song, p) {
  const ph = song.phrases[p];
  if (!ph) return null;
  return runStep(song, p, song.sections[ph.section].p1 - 1, "run");
}

// The card's words for a step (§4.2): { title, button, note? }. Few words.
export function stepLabel(step, song) {
  const ps = song.phrases;
  // (words in quotes; "Bars 12–14" as it is)
  const q = (i, max = 4, dots = "more") => (ps[i]?.words ? `“${phraseName(ps[i], max, dots)}”` : phraseName(ps[i] || {}, max, dots));
  const note = step.stop ? "Good place to stop" : undefined;
  const out = (title, button) => (note ? { title, button, note } : { title, button });
  switch (step.kind) {
    case "hear": return out("Hear it first", "▶ Hear it");
    case "first":
    case "run": return out(`Sing to ${q(step.to, 4, "cut")}`, "● Sing");
    case "singon": return out(`Sing on to ${q(step.to, 4, "cut")}`, "● Sing");
    case "finish": return out(`Finish with ${q(step.p ?? step.from, 4, "cut")}`, "● Go");
    case "through": return out("Sing it through", "● Sing");
    case "selfcheck": return out("Sounded right?", "✓ Yes · Again · ▶ You");
    case "stage": {
      if (step.cont && step.setup?.confirm) return out(step.stage === "time" ? "Once more, lane off" : "Once more", "■ Stop");
      const what = step.stage === "time" ? "in time" : "in tune";
      if (step.extra === "full speed") return out(`${q(step.p, 2)} · full speed`, "● Go");
      if (step.extra === "again") return out(`${q(step.p, 2)} · ${what} again`, "● Go");
      if (step.extra === "slower") return out(`${q(step.p, 2)} · ${what} · slower`, "● Go");
      return out(`${q(step.p)} · ${what}`, "● Go");
    }
    default: return out("", "● Go");
  }
}
