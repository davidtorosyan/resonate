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
      const more = off.length > 1 ? ` +${off.length - 1}` : "";
      reasons.push({ kind: "note", text: `${n.melisma ? "Held note" : n.text ? `“${n.text.replace(/[,.;:!?]+$/, "")}”` : "This note"}: aim for ${n.name} (you sang ${sang})${more}` });
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
  const headline = !tries.length && !tip ? (rows.some((r) => !r.complete) ? "Those lines sat well." : "That one sat really well.")
    : wins.length ? "Nice — a few things to polish." : "Here's what to try next.";
  return { headline, wins: wins.slice(0, 3), tries: tries.slice(0, WORK_ON), tip };
}
