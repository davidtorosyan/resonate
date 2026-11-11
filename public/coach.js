// After a take: what went well, and the few things worth trying next — in plain, short words.
//
// This is coaching, not grading (CLAUDE.md "UI principles"): every number stays in the data
// (a line's `score`, the take's history, rhythm amounts), but what the singer reads is a
// strength or a next step, never a percentage. Observations carry a tone: "good" (say it),
// "try" (a next step), "style" (kept as data, not coached).
//
// Per line (analyzeLines): its pitch facts from grade.js, and its timing from rhythm.js when
// the take has it (take.rhythm; else the pitch grading's moved slots, as before):
//   missed  — notes not heard (too quiet or not sung): ≥ 0.5 s or ≥ 15% of the line
//   unclear — sung, but the pitch couldn't be heard for ≥ 30% of the line
//   note    — the longest note that came out on another pitch: what to aim for
//   flat / sharp — the line's in-tune notes lean ≥ 20¢ one way
//   rhythm  — late/early entries, rushing/dragging, off-beat notes, held notes cut short/over
// A line goes well (good) when ≥ 90% of its judged singing was on pitch and nothing needs
// trying; it's worth working on (weak) when < 85% or it has a reason. feedback() picks at most
// three of each and a headline.

export const WORK_ON = 3;
const WEAK = 0.85, GOOD = 0.9;

// Short words for a rhythm observation (rhythm.js). w(j) → the syllable's word(s) in quotes.
export function rhythmText(o, w) {
  switch (o.kind) {
    case "late-in": return o.count ? `Count the rest — ${w(o.j)} came a beat late` : `Come in on time at ${w(o.j)}`;
    case "early-in": return o.count ? `Count the rest — ${w(o.j)} came a beat early` : `Wait a moment before ${w(o.j)}`;
    case "rushing": return o.scope === "take" ? "You sped up over the song — keep the pulse" : "Hold back — this line sped up";
    case "dragging": return o.scope === "take" ? "You slowed down over the song — keep it moving" : "Keep it moving — this line slowed";
    case "offbeat-late": return o.scope === "take" ? "Off-beat notes tend to land late — feel the “and”" : "Off-beat notes a bit sooner";
    case "offbeat-early": return o.scope === "take" ? "Off-beat notes tend to come early — let them wait" : "Let the off-beat notes wait a little";
    case "short": return `Hold ${w(o.j)} its full length`;
    case "held": return `Let go of ${w(o.j)} in time`;
    case "behind": return "A little behind the click — come in with it";
    case "ahead": return "Ahead of the click — let it lead";
    case "headphones": return "🎧 Headphones with the piano guide, so timing can be checked";
    default: return null;
  }
}

// lines: [[note index]]; grades: per note (grade.js); text(li) → the line's words; name(midi) →
// a note name; syl(j) → note j's syllable as the lyrics show it (joined to the next within a
// word, a space after a word's end). rhythm: take.rhythm (rhythm.js observations) or null;
// lineIndex[k]: the take's line number of lines[k] (a loop round passes one line). lead: the
// pitch grading's steady lead, for the old timing reasons when there's no rhythm.
export function analyzeLines(notes, lines, grades, { text, name, syl = null, rhythm = null, lineIndex = null, lead = 0 }) {
  const out = [];
  const useRhythm = rhythm && rhythm.trust === "ok";
  lines.forEach((idx, k) => {
    const li = lineIndex ? lineIndex[k] : k;
    const sung = idx.filter((j) => grades[j] && grades[j].status !== "unsung");
    if (!sung.length) return;
    const dur = (js) => js.reduce((a, j) => a + notes[j].d, 0);
    const all = dur(sung);
    const judged = sung.filter((j) => grades[j].status !== "unclear");
    const missed = sung.filter((j) => grades[j].status === "missed");
    const unclear = sung.filter((j) => grades[j].status === "unclear");
    const pitched = sung.filter((j) => ["good", "ok", "off"].includes(grades[j].status));
    const score = judged.length ? judged.reduce((a, j) => a + (grades[j].hit || 0) * notes[j].d, 0) / dur(judged) : null;
    const reasons = [];
    const words = (js) => {
      const own = js.filter((j) => !notes[j].melisma);
      if (!own.length) return "the held note";
      if (!own.some((j) => notes[j].text)) return own.slice(0, 4).map((j) => notes[j].name).join(" ") + (own.length > 4 ? "…" : "");
      // Syllables joined into words (only syllables next to each other in the line).
      const nextSyl = (j) => { let i = j + 1; while (i < notes.length && notes[i].melisma) i++; return i; };
      let s = "";
      own.forEach((j, n) => {
        const t = syl ? syl(j) : `${notes[j].text} `;
        s += n + 1 < own.length && own[n + 1] !== nextSyl(j) && !/\s$/.test(t) ? `${t} ` : t;
      });
      const w = s.trim().replace(/[,.;:!?]+(?=\s|$)/g, "").split(/\s+/).filter(Boolean);
      return `“${w.slice(0, 4).join(" ")}${w.length > 4 ? "…" : ""}”`;
    };
    // the word a note belongs to (its syllable, or the syllable it's held from)
    const wordOf = (j) => { let i = j; while (i > 0 && notes[i].melisma) i--; return words([i]); };
    if (dur(missed) >= Math.min(0.5, all) || dur(missed) / all >= 0.15) reasons.push({ kind: "missed", text: `Sing out on ${words(missed)}` });
    if (dur(unclear) / all >= 0.3) reasons.push({ kind: "unclear", text: "Closer to the mic here" });
    const off = pitched.filter((j) => grades[j].status === "off").sort((a, b) => notes[b].d - notes[a].d);
    if (off.length) {
      const j = off[0], n = notes[j], g = grades[j];
      const sang = name(Math.round(n.midi + g.dev));
      reasons.push({ kind: "note", extra: off.length - 1, text: `${n.melisma ? "Held note" : n.text ? `“${n.text.replace(/[,.;:!?]+$/, "")}”` : "This note"}: aim for ${n.name} (you sang ${sang})` });
    }
    const inTune = pitched.filter((j) => grades[j].status !== "off");
    if (inTune.length >= 2) {
      const lean = inTune.reduce((a, j) => a + grades[j].dev * notes[j].d, 0) / dur(inTune);
      if (Math.abs(lean) >= 0.2) reasons.push({ kind: lean < 0 ? "flat" : "sharp", text: lean < 0 ? "A touch flat — lift it" : "A touch sharp — ease it down" });
    }
    if (useRhythm) {
      for (const o of rhythm.obs) {
        if (o.scope !== "line" || o.li !== li || o.tone !== "try") continue;
        const t = rhythmText(o, wordOf);
        if (t) reasons.push({ kind: o.kind, text: t, rhythm: true });
      }
    } else if (!rhythm) {
      // No recording to time from: the pitch grading's moved slots (relative to the take's lead).
      const first = pitched.find((j) => grades[j].status !== "off" && grades[j].shift !== undefined);
      if (first !== undefined && first === idx.find((j) => !notes[j].melisma)) {
        const e = grades[first].shift;
        if (Math.abs(e - lead) >= 0.12 && Math.abs(e) >= 0.08 && (Math.sign(e) !== Math.sign(lead) || Math.abs(e) > Math.abs(lead))) {
          reasons.push({ kind: e < lead ? "early" : "late", text: e < lead ? `Wait a moment before ${wordOf(first)}` : `Come in on time at ${wordOf(first)}`, rhythm: true });
        }
      }
    }
    const from = notes[idx[0]].t, last = notes[idx[idx.length - 1]];
    // (rank: unclear time counts as half right — it couldn't be judged)
    const rank = ((score ?? 0) * dur(judged) + 0.5 * dur(unclear)) / all;
    const lineScore = dur(unclear) / all > 0.5 ? null : score; // mostly unclear: too little to say
    out.push({
      li, from, to: last.t + last.d, text: text(li), score: lineScore, rank, reasons,
      good: lineScore !== null && lineScore >= GOOD && !reasons.length,
      weak: (score !== null && score < WEAK) || reasons.length > 0,
      complete: sung.length === idx.length,
    });
  });
  return out;
}

// The lines to work on: the weak ones, weakest first.
export function workOn(rows, n = WORK_ON) {
  return rows.filter((r) => r.weak).sort((a, b) => a.rank - b.rank).slice(0, n);
}

// Progress: the same line in an earlier take (data: its score change), if any.
export function lineDelta(prev, row) {
  const p = prev?.lines?.[row.li];
  return p === null || p === undefined || row.score === null ? null : row.score - p;
}

// The review's words: { headline, wins: [{ text, li? }], tries: [{ text, li?, row? }], tip }.
// rows: analyzeLines(); rhythm: take.rhythm; prev: { pct, lines } of the last comparable take
// (or null); pct: this take's score (data); whole: the take covered the song.
export function feedback(rows, { rhythm = null, prev = null, pct = null, whole = true, w = (j) => "" } = {}) {
  const wins = [], tries = [];
  // Progress first — only ever said when it's up.
  if (prev && whole && pct !== null && prev.pct !== null && pct - prev.pct >= 0.05) wins.push({ text: "Better than last time" });
  const better = rows.filter((r) => { const d = lineDelta(prev, r); return d !== null && d >= 0.1 && r.score >= WEAK; }).sort((a, b) => lineDelta(prev, b) - lineDelta(prev, a));
  for (const r of better.slice(0, 1)) wins.push({ text: `${r.text} — closer than last time`, li: r.li });
  const good = rows.filter((r) => r.good).sort((a, b) => b.score - a.score);
  for (const r of good.slice(0, 2)) if (!wins.some((x) => x.li === r.li)) wins.push({ text: `${r.text}`, li: r.li, check: true });
  const rhythmTries = rhythm && rhythm.trust === "ok" ? rhythm.obs.filter((o) => o.tone === "try") : [];
  if (rhythm && rhythm.trust === "ok" && !rhythmTries.length && rhythm.obs.some((o) => o.kind === "steady-line")) wins.push({ text: "Steady timing" });
  // Next steps: the weakest lines' first reason, then the take as a whole.
  for (const r of workOn(rows)) tries.push({ text: r.reasons[0]?.text || "Again, a little closer", li: r.li, row: r });
  const takeObs = rhythm ? rhythm.obs.filter((o) => o.scope === "take" && o.tone === "try") : [];
  const tip = takeObs.length ? rhythmText(takeObs[0], w) : null;
  const singTip = takeObs.some((o) => o.kind !== "headphones"); // (the 🎧 hint is about the setup, not the singing)
  const headline = !tries.length && !singTip ? (rows.some((r) => !r.complete) ? "Those lines sat well." : "That one sat really well.")
    : wins.length ? "Nice — a few things to polish." : "Here's what to try next.";
  return { headline, wins: wins.slice(0, 3), tries: tries.slice(0, WORK_ON), tip };
}

// ---------------------------------------------------------------------------
// Guided practice (docs/COACHING.md §5): after a round, one win and at most one cue —
// `✓ <win> · <cue>`. The verdicts come from practice.js (timeVerdict / tuneVerdict); these are
// only their words. A cue names a word, a beat or a note, never the body or the person; no
// numbers but note names. A pass shows only a win; an unsure round never a fault.

// The word note j belongs to (its syllable, or the one it's held from), syllables joined; ""
// when it has none (no lyrics there).
function wordAt(notes, j) {
  let i = j;
  while (i > 0 && notes[i].melisma) i--;
  if (!notes[i] || !notes[i].text) return "";
  const sylIdx = (from, dir) => { for (let k = from + dir; k >= 0 && k < notes.length; k += dir) if (!notes[k].melisma && notes[k].text) return k; return -1; };
  const joins = (k) => { // (as sing.js joinsNext: both ends must agree, OCR tags whole words "begin")
    if (notes[k].syllabic !== "begin" && notes[k].syllabic !== "middle") return false;
    const n = sylIdx(k, 1);
    return n >= 0 && (notes[n].syllabic === "middle" || notes[n].syllabic === "end");
  };
  let a = i;
  for (let p = sylIdx(a, -1); p >= 0 && joins(p); p = sylIdx(a, -1)) a = p;
  let s = notes[a].text, k = a;
  while (joins(k)) { k = sylIdx(k, 1); s += notes[k].text; }
  return s.replace(/^[“”"'‘’(\[¿¡]+|[“”"’)\].,;:!?…]+$/g, "");
}

const TIME_CUES = {
  slip: (o, w) => (o.dir === "early" ? `${w(o.j)} waits a beat` : `Count in — ${w(o.j)} a beat sooner`),
  unheard: (o, w) => `Sing out on ${w(o.j)}`,
  "late-in": (o, w) => `Come in on the beat at ${w(o.j)}`, // (an instruction: "“Its” on the beat" read like praise)
  "early-in": (o, w) => `Let the beat go first, then ${w(o.j)}`,
  rushing: () => "Let the beat lead",
  dragging: () => "Lean toward the next beat",
  "offbeat-late": () => "Off-beat notes a touch sooner",
  "offbeat-early": () => "Off-beat notes a touch later",
  short: (o, w) => `Hold ${w(o.j)} full length`,
  held: (o, w) => `Let go of ${w(o.j)} sooner`,
  behind: () => "A touch behind the beat",
  ahead: () => "A touch ahead — let the beat lead",
};
const TUNE_CUES = {
  slip: TIME_CUES.slip,
  note: (o, w, notes) => (w.word(o.j) ? `${w(o.j)} — ${o.dir === "down" ? "down" : "up"} to ` : o.dir === "down" ? "Down to " : "Up to ") + (notes[o.j]?.name || o.note || ""),
  missed: (o, w) => `Sing out on ${w(o.j)}`,
  flat: () => "A touch flat — lift it",
  sharp: () => "A touch sharp — ease it",
  mic: () => "Closer to the mic",
  unclear: () => "Closer to the mic",
};
// Cues whose ▶ plays something: the note (In tune), the phrase from a beat before it (timing).
const PLAYS = new Set(["note", "slip", "late-in", "early-in", "short", "held"]);

// A previous cue that this round shows fixed → the progress win's words (or null).
function progress(prev, v, f, w, notes) {
  if (!prev || !(v === "pass" || v === "try" || v === "slip")) return null;
  switch (prev.kind) {
    case "slip": return v !== "slip" && (f.entryOk || (f.entryOk === undefined && f.timed)) ? `${w(prev.j)} on the beat now` : null;
    case "late-in": case "early-in": return f.entryOk ? `${w(prev.j)} on the beat now` : null;
    case "short": return f.released?.[prev.j] === "ok" ? `${w(prev.j)} full length now` : null;
    case "held": return f.released?.[prev.j] === "ok" ? `${w(prev.j)} let go in time now` : null;
    case "rushing": case "dragging": case "behind": case "ahead": return v === "pass" && f.kinds && !f.kinds.includes(prev.kind) ? "With the beat now" : null;
    case "offbeat-late": case "offbeat-early": return v === "pass" && f.kinds && !f.kinds.includes(prev.kind) ? "Off-beats in place now" : null;
    case "unheard": return f.cover !== undefined && f.cover !== null ? `${w(prev.j)} rings out now` : null;
    case "note": return f.goodJ?.includes(prev.j) ? (w.word(prev.j) ? `${w(prev.j)} on ${notes[prev.j]?.name || prev.note} now` : `On ${notes[prev.j]?.name || prev.note} now`) : null;
    case "missed": return f.missedJ && !f.missedJ.length ? `${w(prev.j)} rings out now` : null;
    case "flat": case "sharp": return f.goodJ && f.goodJ.length >= 2 && Math.abs(f.lean || 0) < 0.2 ? "Right on pitch now" : null;
    case "mic": case "unclear": return f.score !== null && f.score !== undefined ? "Heard clearly now" : null;
    default: return null;
  }
}

// stage: "time" | "tune"; verdict: practice.js timeVerdict/tuneVerdict (fullSpeed: applyRound's
// flag for the first pass at the song's tempo after slower; shown (optional): the win texts the
// card showed in the last few rounds, newest last — the win then rotates among the true ones);
// prevCue: the previous round's verdict.cue; notes: the page's notes (name = the note as sung,
// text = the syllable); ph: the phrase.
// → { verdict, win: { kind, text } | null, cue: { kind, text, play: { j } | null } | null }
// Which win: a progress win unless the last round showed that very one; else the first true
// win (§5 order) not among `shown`; else the one shown longest ago. A pass always has one
// ("With the beat" / "In tune" is true of every pass, so it takes its turn too). A true win is
// never dropped for having been shown: a try whose only win is last round's shows it again.
export function roundResult(stage, verdict, prevCue = null, notes = [], ph = null) {
  const v = verdict?.v ?? "unknown", f = verdict?.facts || {};
  // A word in quotes; a note without lyrics by its name (“That”, G4).
  const word = (j) => wordAt(notes, j ?? ph?.j0 ?? 0);
  const w = (j) => { const t = word(j); return t ? `“${t}”` : notes[j ?? ph?.j0 ?? 0]?.name || ""; };
  w.word = word;
  const wins = []; // { kind, text, j? (the note it's about) }
  // (a pitch verdict never stands on top of a counting slip: no pitch words then)
  const pitchOk = stage !== "tune" || v !== "slip";
  const p = pitchOk || ["slip", "late-in", "early-in"].includes(prevCue?.kind) ? progress(prevCue, v, f, w, notes) : null;
  if (p) wins.push({ kind: "progress", text: p, j: prevCue.j });
  const judged = v === "pass" || v === "try" || v === "slip" || v === "unsure";
  if (judged && stage === "time") {
    if (f.entryOk && f.entryJ !== undefined) wins.push({ kind: "timing", text: `In on ${w(f.entryJ)}`, j: f.entryJ });
    if (f.heldOkJ !== null && f.heldOkJ !== undefined) wins.push({ kind: "timing", text: `Held ${w(f.heldOkJ)} full length`, j: f.heldOkJ });
    if (f.steady) wins.push({ kind: "timing", text: "Steady" });
  }
  if ((v === "pass" || v === "try") && stage === "tune") {
    if (f.goodLongJ !== null && f.goodLongJ !== undefined) {
      const n = notes[f.goodLongJ]?.name || "";
      wins.push({ kind: "tune", text: word(f.goodLongJ) ? `${w(f.goodLongJ)} right on ${n}` : `Right on ${n}`, j: f.goodLongJ });
    }
    if (f.allFound) wins.push({ kind: "tune", text: "Every note found", all: true });
  }
  if ((verdict?.fullSpeed || f.fullSpeed) && v === "pass") wins.push({ kind: "tempo", text: "Full speed" });
  if (v === "pass") wins.push({ kind: stage === "time" ? "timing" : "tune", text: stage === "time" ? "With the beat" : "In tune", plain: true });
  const shown = Array.isArray(verdict?.shown) ? verdict.shown.filter((t) => typeof t === "string") : [];
  const first = (ws) => {
    // (without a history: the first true win, the plain one only when there's no other)
    const real = shown.length ? ws : ws.filter((x, k) => !x.plain || k === 0);
    if (!real.length) return null;
    let x = real[0];
    if (shown.length) {
      const lastShown = (t) => shown.lastIndexOf(t);
      const prog = real.find((y) => y.kind === "progress");
      x = prog && shown[shown.length - 1] !== prog.text ? prog
        : real.find((y) => lastShown(y.text) < 0) || real.reduce((a, b) => (lastShown(b.text) < lastShown(a.text) ? b : a));
    }
    return { kind: x.kind, text: x.text };
  };
  const win = first(wins);
  if (v === "pass") return { verdict: v, win, cue: null };
  // Unsure (and timing unknown): the win, or "Again" — never a fault.
  if (v === "unsure" || (v === "unknown" && stage === "time")) return { verdict: v, win, cue: win ? null : { kind: "again", text: "Again", play: null } };
  const c = verdict?.cue;
  if (!c) return { verdict: v, win, cue: win ? null : { kind: "again", text: "Again", play: null } };
  const table = stage === "time" ? TIME_CUES : TUNE_CUES;
  const say = table[c.kind] || TIME_CUES[c.kind];
  const text = say ? say(c, w, notes) : "Again";
  const cue = { kind: c.kind, text, play: PLAYS.has(c.kind) && c.j !== undefined ? { j: c.j } : null };
  // (no win when the round was barely heard or couldn't be pitched; none that says the
  // opposite of the cue — "“song” on B3 now · “song” — down to B3", where a held word has two
  // notes, or "Every note found" beside a note to aim for)
  const about = (j) => (j === undefined || j === null ? null : word(j) || notes[j]?.name || null);
  const subj = about(c.j);
  const fit = wins.filter((x) => !(subj && about(x.j) === subj) && !(x.all && c.kind === "note"));
  return { verdict: v, win: v === "unheard" || v === "unknown" ? null : first(fit), cue };
}

// After a run (§5): a headline only when a fact backs it ("In the song ✓ …"), then the first
// true win ("Better than your first try: …" — ▶ Then → Now goes with it). Nothing otherwise:
// the map animates the new marks. moved/improved: practice.js applyRun; song: { phrases }.
export function runResult(moved = [], improved = [], song = { phrases: [] }) {
  const name = (i) => { const ph = song.phrases[i] || {}, t = ph.label || ph.name || ""; return ph.words === "" ? t : `“${t}”`; };
  // (a phrase that only rides along — a lone note, "Bar 185" — isn't news on its own)
  const inSong = [...new Set(moved.filter(([i, mark]) => mark === "song" && !song.phrases[i]?.ride).map(([i]) => i))];
  const headline = inSong.length ? `In the song ✓ ${inSong.slice(0, 3).map(name).join(", ")}${inSong.length > 3 ? " …" : ""}` : null;
  const win = improved.length ? `Better than your first try: ${name(improved[0])}` : null;
  return { headline, win };
}

// The secured glow's line: "✓ “Was blind…” in time · in tune".
export function securedText(ph, stages) {
  const say = { time: "in time", tune: "in tune", song: "in the song" };
  const name = ph?.words === "" ? ph.name : `“${ph?.name || ""}”`;
  return `✓ ${name} ${stages.map((s) => say[s] || s).join(" · ")}`;
}
