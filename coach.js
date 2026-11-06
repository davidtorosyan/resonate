// After a take: how each lyric line went, and the few worth working on, in plain words.
//
// A line's score is the duration-weighted `hit` of its judged notes (grade.js; unclear
// notes aren't judged). Reasons, most useful first:
//   missed   — notes not sung (or too quiet to hear): ≥ 0.5 s or ≥ 15% of the line
//   unclear  — sung, but the pitch couldn't be heard for ≥ 30% of the line
//   note     — the longest note that came out wrong: what you sang instead
//   flat / sharp — the line's in-key notes lean ≥ 20¢ one way on average
//   early / late — you came in (its first note) or sang the line ≥ 0.12 s earlier or
//              later than you usually did in this take (`lead`, grade.js timingTendency;
//              a steady lead is said once for the whole take, not on every line)
// A line is worth working on when it scores < 85% or has a missed / unclear / timing
// reason; the weakest WORK_ON of those are suggested (`rank`: unclear time counts as
// half right, since it couldn't be judged).

export const WORK_ON = 3;
const WEAK = 0.85;

// lines: [[note index]]; grades: per note (grade.js); text(li) → the line's words;
// name(midi) → a note name.
// syl(j) → note j's syllable as the lyrics show it (joined to the next within a word, a
// space after a word's end); notes without words are named by their pitch.
export function analyzeLines(notes, lines, grades, { text, name, lead = 0, syl = null }) {
  const out = [];
  lines.forEach((idx, li) => {
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
      if (!own.length) return "a held note";
      if (!own.some((j) => notes[j].text)) return own.slice(0, 4).map((j) => notes[j].name).join(" ") + (own.length > 4 ? "…" : "");
      // Syllables joined into words (only syllables next to each other in the line).
      const nextSyl = (j) => { let i = j + 1; while (i < notes.length && notes[i].melisma) i++; return i; };
      let s = "";
      own.forEach((j, k) => {
        const t = syl ? syl(j) : `${notes[j].text} `;
        s += k + 1 < own.length && own[k + 1] !== nextSyl(j) && !/\s$/.test(t) ? `${t} ` : t;
      });
      const w = s.trim().replace(/[,.;:!?]+(?=\s|$)/g, "").split(/\s+/).filter(Boolean);
      return `“${w.slice(0, 4).join(" ")}${w.length > 4 ? "…" : ""}”`;
    };
    if (dur(missed) >= Math.min(0.5, all) || dur(missed) / all >= 0.15) reasons.push({ kind: "missed", text: `didn't hear you on ${words(missed)} — too quiet, or not sung` });
    if (dur(unclear) / all >= 0.3) reasons.push({ kind: "unclear", text: "couldn't make out the pitch — sing out a little, closer to the mic" });
    const off = pitched.filter((j) => grades[j].status === "off").sort((a, b) => notes[b].d - notes[a].d);
    if (off.length) {
      const j = off[0], n = notes[j], g = grades[j];
      const sang = name(Math.round(n.midi + g.dev));
      const more = off.length > 1 ? ` (+${off.length - 1} more)` : "";
      reasons.push({ kind: "note", text: n.melisma ? `a held note should be ${n.name} — you sang ${sang}${more}`
        : n.text ? `“${n.text.replace(/[,.;:!?]+$/, "")}” should be ${n.name} — you sang ${sang}${more}`
        : `${n.name} came out as ${sang}${more}` });
    }
    const inTune = pitched.filter((j) => grades[j].status !== "off");
    if (inTune.length >= 2) {
      const lean = inTune.reduce((a, j) => a + grades[j].dev * notes[j].d, 0) / dur(inTune);
      if (Math.abs(lean) >= 0.2) reasons.push({ kind: lean < 0 ? "flat" : "sharp", text: `a bit ${lean < 0 ? "flat" : "sharp"} overall (${lean < 0 ? "−" : "+"}${Math.round(Math.abs(lean) * 100)}¢)` });
    }
    const first = pitched.find((j) => grades[j].status !== "off" && grades[j].shift !== undefined);
    const shifts = inTune.map((j) => grades[j].shift).filter((s) => s !== undefined).sort((a, b) => a - b);
    const typical = shifts.length ? shifts[shifts.length >> 1] : 0;
    const entry = first !== undefined && first === idx.find((j) => !notes[j].melisma) ? grades[first].shift : lead;
    const off2 = Math.abs(entry - lead) >= 0.12 ? entry : Math.abs(typical - lead) >= 0.12 ? typical : null;
    // Only worth fixing when it's further off the beat than the rest of the take (a line
    // sung on time in a late take is the good one).
    const worse = off2 !== null && Math.abs(off2) >= 0.08 && (Math.sign(off2) !== Math.sign(lead) || Math.abs(off2) > Math.abs(lead));
    if (worse) {
      const early = off2 < lead;
      const how = Math.abs(off2) < 0.05 ? "on time" : `~${Math.abs(off2).toFixed(2)} s ${off2 < 0 ? "early" : "late"}`;
      reasons.push({ kind: early ? "early" : "late", text: `${off2 === entry ? "came in" : "sang it"} ${how}${lead ? ` (you were ~${Math.abs(lead).toFixed(2)} s ${lead < 0 ? "early" : "late"} elsewhere)` : ""}` });
    }
    const from = notes[idx[0]].t, last = notes[idx[idx.length - 1]];
    const rank = ((score ?? 0) * dur(judged) + 0.5 * dur(unclear)) / all;
    out.push({
      // (a line mostly unclear shows no score: what was judged is too little to say)
      li, from, to: last.t + last.d, text: text(li), score: dur(unclear) / all > 0.5 ? null : score, rank, reasons,
      weak: (score !== null && score < WEAK) || reasons.some((r) => ["missed", "unclear", "early", "late"].includes(r.kind)),
      complete: sung.length === idx.length,
    });
  });
  return out;
}

// The lines to work on: the weak ones, weakest first.
export function workOn(rows, n = WORK_ON) {
  return rows.filter((r) => r.weak).sort((a, b) => a.rank - b.rank).slice(0, n);
}

// Progress: the same line in an earlier take (its score), if any.
export function lineDelta(prev, row) {
  const p = prev?.lines?.[row.li];
  return p === null || p === undefined || row.score === null ? null : row.score - p;
}
