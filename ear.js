// Ear's judgments (E8; docs/EAR.md; the Ear fix plan's "The judgment"): what one attempt at a line came to —
// the counts, one win, at most one cue — with no DOM, so tools/earcases.mjs runs the page's own code on
// synthetic singers. sing.js "Ear" keeps the sessions and the screen, and hands these the line, the song's
// notes and what the mic heard.
//
// A line: practice.js groupPhrases's { j0, j1, js, wk, mk, … } at Ear's sizes (EAR_PHRASE: the printed line).
// ctx: { notes (the song's, as the page has them: q, dq, t, d in seconds at the tempo now, midi (transposed),
//   text, syllabic, melisma), spq (seconds per quarter at the tempo now), spq0 (… at the song's own tempo, 100 %:
//   the count sets — fixed per line, whatever the speed), name (midi → its name in the song's key),
//   score + qToT (Sing's: the meter — metricOf — on the singer's clock), feat + start (Line: rhythm.js
//   makeFeatures of the attempt's recording and its first sample's time on the attempt's clock — the starts are
//   measured from them; none: ♩ isn't judged), gateUntil (Line: attempt s until which our own ▶'s tail may still
//   be in the mic — frames under MIN_RMS don't count before it), prev (the last whole attempt at this line, mode
//   and speed: { counts, win, cue, whole } — "rose", "fixed now", never the same win twice), oct (the singer's
//   octave, EAR.oct: semitones the piano plays the song in for them — the key's direction is the voice against the
//   piano heard), shiftOk (s → the Key menu can move the song s semitones; none: ±12) }.
//
// A result (sing.js EAR.res; resonateDebug().ear.res is debugRes of it):
//   counts   { notes (♪: counted notes hit; null — not judged: another key), notesAll, beats (♩: starts on time;
//              null: not judged), beatsAll } | null (nothing to count: not heard, couldn't follow)
//   win      { kind, j?, w? (wordOf j), sub?, text } | null — Line kinds: "spot" (twice: sub "again") · "fixed"
//              (the last cue, now right: sub "note" | "start") · "rose" (sub "notes" | "beats" | "both") · "key"
//              (the tune right in another key) · "tune" (right, all a little off) · "every" (♪ all, not "Spot on") ·
//              "high" · "long" · "first".
//              Beats (judgeBeats): "spot" · "fixed" · "rose" · "entry" · "run" · "even".
//   cue      { kind, j?, w?, dir?, size?, s?, from?, range?, at?, sounds, text } | null — dir: what to do
//              ("higher" / "lower" / "sooner" / "later"; key: where the voice was — "lower" / "higher" than the
//              piano); size: a pitch cue's "touch" | "aim" | "much"; s: a key cue's semitones (the Key menu's: ±12;
//              other — the menu's ends left only a shift the other way: "Sang it in another key"); from: "short"'s
//              first note not sung
//              (▶ The rest); range: [j0, j1] the stretch a timing cue's ▶ plays; at: [t0, t1] attempt s (▶ You);
//              sounds: the ▶s it offers ("first", "you", "note", "stretch", "rest", "hear", "key").
//              Line kinds, the first that applies: "silent" · "nofit" · "key" · "offset" · "short" · "missed" ·
//              "pitch" · "unclear" · "held" · "timing" · "sag". Beats: "silent" · "slip" · "unheard" · "steady" ·
//              "held" · "drift" · "missed" · "timing" (sounds "hear", "click", "you").
//   text     a win's and a cue's words, plain (earText gives them with the syllable underlined, and the rest
//            of what the screen says)
//   fit      { a, b, off, anchor, g (grades — on each note's own span: a start measured starts its slot; written
//              pitches; another key: in theirs — a note squeezed by a neighbour's onset and not hit: "unclear",
//              squeezed), ns (the notes where the singer put them), refit (the measured starts' line moved it), look (the
//              second look's line: a step the attacks showed) — b: the singer's tempo (with a step, its own line's) } — Line
//   key      { c (¢: the attempt's pitch classes against the line's — the fit's, of up to three candidates), s, kind:
//              "key" | "offset" | null, d (semitones: the voice against the piano heard), dir, other } — Line
//   starts   { [i in the line]: { r (s off the singer's own steady line), on, measured, kind, rit?, um? (counted
//              on, unmeasured) } } — Line; rit: the first start of a ritardando into the line's end (counted on,
//              never cued), or null; um: a start counted on but not measured; spotOk: "Spot on" allowed (no start
//              unmeasured, no offset / sag cue); anchored: the starts that set their notes' own spans
//   onsets   { measured, of } — starts with a measured onset, of the starts reached
//   notReached  counted notes that start after the singer stopped; whole: a baseline for next time (heard,
//   followed, sung to the end); up { notes, beats }: a count that rose since prev; cover: the share of the
//   singing inside the line found; ms: the judging's time
//   rn       { [i in the line]: { cls, dev, rdev } | null } — Beats: each start against its click (judgeBeats)
//   drill    [i in the line] — Line: the notes reached and sung off or not sung, the cue's first, then the longest
//            (Notes' "Off last time" targets: noteTargets)
import { gradeTake, loudGate } from "./grade.js?v=124";
import { median, fold } from "./music.js?v=124";
import { findOnsets, tolFlag, tolOn, voiceCover, attackTimes } from "./rhythm.js?v=124";
import { metricOf, meterAt, measureAt, feltBeat } from "./takerhythm.js?v=124";
import { PRACTICE } from "./practice.js?v=124";
import { MIN_RMS } from "./pitch.js?v=124";

// A line for Ear: the printed line (the fix plan's Q-A) — a lyric line, short ones joined to 4+ syllables, a
// long one cut near 8 (Amazing Grace: its four hymn lines, 9–11 s each). sing.js puts these into practice.js's
// PRACTICE.phrase before grouping.
export const EAR_PHRASE = { minSyl: 4, minSec: 0, maxSyl: 8, maxSec: 14 };

// The free attempt's judgment (the fix plan's rules 1–8).
export const EAR_FREE = {
  note: 0.12,          // s at the song's own tempo: a note ♪ counts, a start ♩ counts (shorter ones ride along)
  run: 0.08,           // s of voicing that makes a sound (an anchor), gaps ≤ `bridge` inside it
  bridge: 0.05,
  restart: 0.6,        // s unvoiced before a voicing that may be the line again (a false start; up to 3 anchors)
  hesitate: 0.25,      // …or this long, within `hesitateIn` s of the first sound (a hum, a tried note)
  hesitateIn: 2,
  anchors: 3,
  before: 0.3,         // frames from this long before the chosen anchor count (the room, the scoop)
  bMin: 0.5, bMax: 2.2, bStep: 1.04, // the singer's tempo against the speed heard, log steps
  aSpan: 0.3, aStep: 0.06,           // the start, around the anchor
  fineB: 0.01, fineBn: 4, fineA: 0.02, fineAn: 3,
  tie: 0.25,           // fits whose scores (hits + 0.25 × hit share − moveCost × Σ|shift|) are this close: the
                       //   smaller Σ|shift| wins
  moveCost: 1,         // per second the hit notes' slots moved: a line squeezed so that one more note hits on its
                       //   less-flat start, every slot moved to its cap, doesn't beat the singer's own line
  offCost: 0.5,        // per note placed on singing at another pitch: a singer who stopped early leaves the line's
                       //   rest free — squeezed into what was sung, a note or two more lands on a pitch by chance,
                       //   and the line no longer runs past the singer's end (nothing "not reached")
  gradeShift: 0.1,     // the final ♪ grading: a slot moves ≤ this — it can't borrow its neighbour's pitch
  wideShift: 0.6,      // where a start is looked for: a grading whose slots may move this far (s)
  offsetMin: 40,       // ¢: an attempt this far off as a whole is fitted there too, and that fit kept when it…
  offsetHits: 0.7,     //   …hits this share of the counted notes and…
  offsetGain: 2,       //   …this many times the notes the written key hits
  keyMin: 90,          // ¢: from here (a semitone, give or take the estimate) that's another key (♪ not counted);
                       //   under it, all a little off
  tuneWin: 0.85,       // "The tune was right": its fit hits this share
  nofit: 1 / 3,        // under this share hit (of the notes reached — reachedBase; even after the offset): couldn't
                       //   follow — or under `coverHits` hit
  coverHits: 0.6,      //   with under `cover` of the singing (its voiced frames, from the anchor on) inside the line
  cover: 0.8,          //   found (a tempo beyond the search: the best line covers part of it, hitting little; singing
                       //   on into the next line: all of it hit)
  reach: 0.3,          // s: a note starting this long after the last voiced frame wasn't reached
  lastMin: 0.3, lastPad: 0.1, // the line's last note ends where the singer's voice did (+ lastPad s; at least
                       //   lastMin, never past its written length): in free time nothing comes after it — a long
                       //   last note let go early, or ■ Done tapped while it's still sung, is that note sung
  conf: 0.3,           // a measured start: an onset this sure (rhythm.js conf)
  hitMin: 0.15,        // a hit's slot has at least this share of its frames within 50¢ (hitOf)
  shortLine: 4,        // counted notes at most: a short line (Pick words) — its fit's ties go to the tempo nearer the one heard
  fewSlack: 0.05,      // a start judged on the singer's line (fewer than 3 others measured): this × its time from the first more room
  onsetStep: 0.5,      // findOnsets' prior against a change of timing between joined notes (per s; Sing's 1.5
                       //   smooths a held note's late next start away — here each start is timed on its own)
  clean: 50,           // ¢: a win's note — its voiced pitch's spread (median absolute deviation) under this, and
                       //   within 50¢ where the singer's line puts it too
  touch: 80, much: 250, // ¢: a pitch cue's size — a touch / aim / much
  sag: 25,             // ¢: every note hit, but this far off all the way (median) or by the end (last third vs first)
  // Round 2 (the Ear fix plan round 2, WP1):
  attackGain: 0.4,     // the fit: per counted start (past the first) within `attackWin` s of an attack in the recording —
  attackWin: 0.07,     //   repeated pitches are told apart only by their attacks (a syllable left out of a run of one pitch)
  tempoCost: 0.5,      // the fit: per second of the line, × |ln b| — held near the tempo heard (every line; legato: no
                       //   attacks, a line squeezed onto a held voice loses here)
  peaks: 3, peakApart: 150, // the key: up to this many candidates from the pitch-class correlation, ≥ this many ¢ apart
  keyGain: 2,          // …another key's fit kept over the written key's when it hits this many notes more, or the written
  keyBent: 1.1,        //   key's sits on the search's edge or bends the tempo by more than this (×)
  laterAnchor: 2,      // a later anchor (a restart) wins only when the first one's fit misses this many counted notes it hits
  ritFirst: 0.05,      // s: a ritardando into the line's end — its last 2–3 starts late, the first by this, …
  ritMin: 0.03,        //   …each later than the one before by this…
  ritBeat: 0.75,       //   …the last at most this many beats late (on the singer's clock)
  anchorMax: 0.35,     // ♪ on each note's own span: a start re-placed at its measured onset only within this of its fitted time
  anchorGap: 0.04,     //   …no slot past a measured neighbour's onset less this (the plan's 20 ms: a frame's window runs
                       //   ~50 ms past its time — the next note's attack read as this note's pitch)
  anchorKeep: 0.4,     //   …a slot left under this share of its length is squeezed: a note cut short by its neighbour's
                       //   early start (or its own late one) isn't judged on pitch unless it was hit
  spanShift: 0.05,     //   …and the grading's slots move at most this
  onsetSlope: 0.05,    // the measured starts' own line (≥ 4) this far from the pitch fit's tempo: refit near it
  voicedStart: 0.3,    // an unmeasured start is on when its note was voiced this share of its slot (any pitch) and its
                       //   nearest measured starts are on: a pitch miss never costs a ♩
  seedMin: 0.04, seedMax: 0.15, // s: Line's onsets — the first guess at their lead within half the starts' shortest spacing
                       //   (at least seedMin, at most seedMax): further, a run of equal notes lines up a whole note off
  onsetGap: 0.05,      // s: two measured starts at least this far apart (else the one further from its place is unmeasured)
  firstStep: 0.25,     // s: a step after the line's first start alone (its first syllable held long) at least this size
  stepMin: 0.15, stepMax: 1.2, stepCut: 0.6, // s: the steps judgeFree's second look tries (a hold up to stepMax; cut short up to stepCut)
  stepCost: 0.25,      //   …per s of it (in starts on an attack: the smaller step wins a tie)
  stepAttacks: 0.9,    //   …and it looks only when the best step puts one more start on an attack than any straight line (net of its costs)
};
const F = EAR_FREE;

export const phraseJs = (ph) => { const out = []; for (let j = ph.j0; j < ph.j1; j++) out.push(j); return out; };
// A note hit: its slot's median within 50¢ (grade.js good / ok) — and some of its frames really there: a slot over two
// wrong notes either side of the target has its median between them, "on" the note with none of it sung (a short
// line's last note, as long as the singer held it, laid over "the" and a flat "sound": a tempo 26 % off "fitted"
// all three).
export const hitOf = (g) => !!g && (g.status === "good" || g.status === "ok") && !(g.hit < F.hitMin);
// A note's length at the song's own tempo (the count sets are fixed per line: the speed never changes them).
const lenOf = (n, spq0) => (spq0 && n.dq != null ? n.dq * spq0 : n.d);
// The count sets: ♪ counts the notes ≥ 0.12 s, ♩ the starts — the line's first note and every note that isn't a
// melisma's continuation (its own syllable; every note in a song without words), ≥ 0.12 s.
export function countSets(ph, notes, spq0) {
  const counted = phraseJs(ph).filter((j) => lenOf(notes[j], spq0) >= F.note);
  return { counted, starts: counted.filter((j) => j === ph.j0 || !notes[j].melisma) };
}
export const countedOf = (ph, notes, spq0) => countSets(ph, notes, spq0).counted;
export const startsOf = (ph, notes, spq0) => countSets(ph, notes, spq0).starts;

// A note named for the singer: its whole word, the syllable it sings (at: where in the word), and — a melisma —
// which of the syllable's n notes it is (k, 0-based). null: a note without words (name it by its pitch).
export function wordOf(j, notes) {
  let s = j;
  while (s > 0 && notes[s].melisma && !notes[s].text) s--;
  if (!notes[s]?.text) return null;
  let e = s + 1;
  while (e < notes.length && notes[e].melisma && !notes[e].text) e++;
  const before = (i) => { for (let k = i - 1; k >= 0 && i - k < 64; k--) if (notes[k].text) return k; return -1; };
  const after = (i) => { for (let k = i + 1; k < notes.length && k - i < 64; k++) if (notes[k].text) return k; return -1; };
  let w0 = s, w1 = s;
  while (/^(middle|end)$/.test(notes[w0].syllabic || "")) { const p = before(w0); if (p < 0) break; w0 = p; }
  while (/^(begin|middle)$/.test(notes[w1].syllabic || "")) { const p = after(w1); if (p < 0) break; w1 = p; }
  const clean = (t) => t.replace(/[-‿]/g, "").trim();
  let word = "", at = [0, 0];
  for (let k = w0; k <= w1; k++) {
    if (!notes[k].text) continue;
    const t = clean(notes[k].text);
    if (k === s) at = [word.length, word.length + t.length];
    word += t;
  }
  // (a word's punctuation isn't part of it: “grace”, not “grace!”)
  const bare = word.replace(/[\s,.;:!?"“”«»()]+$/u, "").replace(/^[\s"“«(]+/u, "");
  const lead = word.length - word.replace(/^[\s"“«(]+/u, "").length;
  at = [Math.max(0, Math.min(bare.length, at[0] - lead)), Math.max(0, Math.min(bare.length, at[1] - lead))];
  return { word: bare, syl: bare.slice(at[0], at[1]), at, k: j - s, n: e - s, j0: s, w0, w1 };
}
const ORD = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];
const NUM = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

// --- The words (the fix plan's WP5: the words tables) -------------------------------------------------
// A line of words is a list of parts: a string, or { u } — the syllable a note is sung on, underlined inside its
// word ("“A·ma·zing”" with ma underlined). plainOf(parts): the words alone (res.win.text / res.cue.text, aria).
export const plainOf = (parts) => (parts || []).map((x) => (typeof x === "string" ? x : x.u)).join("");
// A note named for the singer: its whole word in quotes, the syllable underlined when the word has more than one
// (one syllable: the word is the note), a melisma's later notes "(second note)"; a note without words: its name.
// plain: a word, not a note (a run's ends, the word the count-in row lights, where to keep going to).
function namedParts(j, ctx, { plain = false } = {}) {
  const w = wordOf(j, ctx.notes);
  if (!w) return [ctx.name ? ctx.name(ctx.notes[j].midi) : "this note"];
  const word = plain || w.syl === w.word || !w.syl ? ["“", w.word, "”"] : ["“", w.word.slice(0, w.at[0]), { u: w.syl }, w.word.slice(w.at[1]), "”"].filter((x) => x !== "");
  return !plain && w.n > 1 && w.k > 0 ? [...word, ` (${ORD[w.k] || `note ${w.k + 1}`} note)`] : word;
}
// (a word as the count-in row shows it: whole, no quotes inside a sentence that names it as a sign)
const wordParts = (j, ctx) => namedParts(j, ctx, { plain: true });

// A win's words (without its ✓): Line kinds, and Beats' (ctx.beats).
function winParts(w, ctx) {
  const nm = (j) => namedParts(j, ctx);
  switch (w.kind) {
    case "spot": return [`Spot on${ctx.beats ? " with the click" : ""}${w.sub === "again" ? " — twice running" : ""}`];
    case "fixed": return w.sub === "start" ? ["In on ", ...nm(w.j), " now"] : [...nm(w.j), " right on it now"];
    case "rose": return [w.sub === "both" ? "More of both than last time" : w.sub === "beats" ? `More on the ${ctx.beats ? "click" : "beat"} than last time` : "More in tune than last time"];
    case "key": case "tune": return ["The tune was right"];
    case "every": return ["Every note in tune"];
    case "high": return ["Hit the high note on ", ...nm(w.j)];
    case "long": return [...nm(w.j), " held right on the note"];
    case "first": return ["Started on the note"];
    case "entry": return ["Came in on time"];
    case "run": return ["Steady from ", ...wordParts(w.j, ctx), " to ", ...wordParts(w.j2, ctx)];
    case "even": return ["Kept a steady beat"];
    default: return [];
  }
}
// A cue's words: the first that applies (Line, Beats), each an action.
function cueParts(c, ctx) {
  const nm = (j) => namedParts(j, ctx);
  switch (c.kind) {
    case "silent": return ["Didn't hear you — sing a bit louder"];
    case "nofit": return ["Couldn't follow that one"];
    case "key": return [c.other ? "Sang it in another key" : c.dir === "lower" ? "Started lower than the piano" : "Started higher than the piano"];
    case "offset": return [c.dir === "higher" ? "A little low all the way" : "A little high all the way"];
    case "short": return ["Keep going to ", ...wordParts(c.j, ctx)];
    case "slip": return c.dir === "sooner" ? ["Came in late — start when ", ...wordParts(c.j, ctx), " lights"] : ["Came in early — wait for ", ...wordParts(c.j, ctx), " to light"];
    case "unheard": return ["Couldn't hear the starts — sing each word out"];
    case "steady": return [c.dir === "sooner" ? "Behind the click — sing right on it" : "Ahead of the click — wait for it"];
    case "drift": return [c.dir === "sooner" ? "Slowing down — stay with the click" : "Speeding up — stay with the click"];
    case "missed": {
      if (ctx.beats) return ["Sing out on ", ...nm(c.j)]; // (Beats: a start not sung — its syllable's other notes aside)
      const w = wordOf(c.j, ctx.notes);
      // (a melisma: the word, its syllable underlined — every note of it)
      if (w && w.n > 1) return [...namedParts(w.j0, ctx), ` — sing ${w.n === 2 ? "both" : `all ${NUM[w.n - 1] || "the"}`} notes`];
      return ["Sing out on ", ...nm(c.j)];
    }
    case "pitch": return [...nm(c.j), ` — ${c.size === "touch" ? "a touch" : c.size === "much" ? "much" : "aim"} ${c.dir}`];
    case "unclear": return ["Closer to the mic"];
    case "held": return [...nm(c.j), c.dir === "sooner" ? " held long — keep the beat" : " cut short — hold it longer"];
    case "timing": return c.dir === "sooner" ? ["Come in sooner on ", ...nm(c.j)] : ["Wait a bit before ", ...nm(c.j)];
    case "sag": return [`A touch ${c.dir === "higher" ? "low" : "high"} ${c.end ? "by the end" : "all the way"}`];
    default: return [];
  }
}
const winText = (w, ctx) => plainOf(winParts(w, ctx));
const cueText = (c, ctx) => plainOf(cueParts(c, ctx));

// What a result says on screen, in order (the fix plan's "Line, after an attempt": win, counts, cue, next):
// res — judgeFree's / judgeBeats's (res.kind "line" | "beats"); ctx — { notes, name, lastLine (no line after this
// one), bpm (♩ a minute the line was heard at: "You sang it at ♩=62"), voice (the attempt's recording is here:
// ▶ You), shift(s) (the Key menu can move the song s semitones: Lower / Raise the song), keyName(s) (the key that
// lands it in: "Lower the song to F"; "Move the song to you" when the menu's end left only the other way), old (a result from before:
// "Last time" — nothing drawn as risen) }.
// → { win: parts | null (with its ✓), counts: [{ icon: "beat" | "note", text, all, up }] (a count not judged, or 0,
// left out; never "—", "0", "↑" or a fraction), tempo: { bpm, text } | null, cue: parts | null, sounds: [{ act,
// label, s? }] (its ▶s: the cue's, or ▶ You after an attempt with every note), next: { act, label } | null (one chip:
// it switches, nothing starts by itself) }.
// The acts: cue-note (▶ Piano: the note), cue-stretch (▶ Piano: from two starts before through the cue's note, at the
// attempt's tempo), cue-rest (▶ The rest: the piano from the first note not sung), cue-hear (▶ Hear), cue-click (▶
// Click: the melody and the click over the stretch), cue-you (▶ You: the attempt there), you (▶ You: the attempt),
// cue-key (Lower / Raise the song, s semitones); next: practise (Notes, on the cue's note), beats (Beats), line (Line),
// nextline (the next line). ▶ First note is the action row's, never a cue's (it's right above).
export function earText(res, ctx = {}) {
  const beats = res?.kind === "beats";
  const c = { ...ctx, beats };
  const out = { win: null, counts: [], tempo: null, cue: null, sounds: [], next: null };
  if (!res) return out;
  if (res.win) out.win = ["✓ ", ...winParts(res.win, c)];
  const n = res.counts, up = ctx.old ? {} : res.up || {};
  if (n) {
    if (n.beatsAll || n.beats > 0) out.counts.push({ icon: "beat", all: !!n.beatsAll, up: !!up.beats, text: `${n.beatsAll ? "all" : n.beats} on the ${beats ? "click" : "beat"}` });
    if (!beats && (n.notesAll || n.notes > 0)) out.counts.push({ icon: "note", all: !!n.notesAll, up: !!up.notes, text: `${n.notesAll ? "all" : n.notes} in tune` });
  }
  // the singer's own tempo, when it was well off the speed heard (Line: the fit's b — the singer's seconds per the
  // line's seconds)
  if (!beats && n && res.fit?.b > 0 && ctx.bpm > 0) {
    const bpm = Math.round(ctx.bpm / res.fit.b);
    if (Math.abs(1 / res.fit.b - 1) > 0.1) out.tempo = { bpm, text: `You sang it at ♩=${bpm}` };
  }
  const q = res.cue;
  if (q) {
    out.cue = cueParts(q, c);
    const sd = q.sounds || [];
    const add = (act, label, more) => out.sounds.push({ act, label, ...more });
    for (const s of sd) {
      if (s === "note" && q.j != null) add("cue-note", "▶ Piano");
      else if (s === "stretch" && q.range) add(beats ? "cue-click" : "cue-stretch", beats ? "▶ Click" : "▶ Piano");
      else if (s === "click" && q.range) add("cue-click", "▶ Click");
      else if (s === "rest" && q.from != null) add("cue-rest", "▶ The rest");
      else if (s === "hear") add("cue-hear", "▶ Hear");
      else if (s === "you" && ctx.voice && (q.at || beats)) add("cue-you", "▶ You");
      else if (s === "key" && q.s && ctx.shift?.(q.s)) { const kn = ctx.keyName?.(q.s); add("cue-key", q.other ? "Move the song to you" : `${q.s < 0 ? "Lower" : "Raise"} the song${kn ? ` to ${kn}` : ""}`, { s: q.s }); }
    }
  } else if (ctx.voice && n && (beats ? n.beatsAll : n.notesAll)) out.sounds.push({ act: "you", label: "▶ You" });
  // the next exercise (D9: the singer picks, the next is suggested) — one chip
  if (!beats) {
    if (q && (q.kind === "pitch" || q.kind === "missed") && q.j != null) out.next = { act: "practise", label: "Practise that note ›" };
    else if (q && (q.kind === "timing" || q.kind === "held")) out.next = { act: "beats", label: "Try it with the clicks ›" };
    else if (!q && n && n.notesAll && n.beatsAll) out.next = ctx.lastLine ? null : { act: "nextline", label: "Next line ›" };
    else if (!q && n && !n.beatsAll) out.next = { act: "beats", label: "Try it with the clicks ›" };
  } else if (n?.beatsAll) out.next = { act: "line", label: "Now on your own ›" };
  return out;
}

// --- The singer's line ----------------------------------------------------------------------------------

// Our own ▶'s tail (rule 1): before `until` (attempt s) a frame under MIN_RMS doesn't count as sung.
export function gateFrames(frames, until) {
  if (!(until > -Infinity)) return frames;
  return frames.map((f) => (f.t < until && f.midi != null && (f.rms ?? 0) < MIN_RMS ? { ...f, midi: null } : f));
}

// Where a line may start (rule 2): the first sound (a voiced run ≥ `run` s), each voicing after ≥ `restart` s
// unvoiced (a false start: the line again), and one after a shorter pause soon after the first (a hum, a note
// tried) — at most `anchors`, in order.
export function anchorsOf(frames) {
  const runs = [];
  let s = null, e = null;
  for (const f of frames) {
    if (f.midi == null) continue;
    if (s == null || f.t - e > F.bridge + 1e-9) { if (s != null) runs.push([s, e]); s = f.t; }
    e = f.t;
  }
  if (s != null) runs.push([s, e]);
  const out = [];
  let prevEnd = -Infinity, first = null;
  for (const [a, b] of runs) {
    const gap = a - prevEnd;
    prevEnd = Math.max(prevEnd, b);
    if (b - a < F.run - 1e-9) continue;
    if (first == null) { first = a; out.push(a); continue; }
    if (gap >= F.restart || (gap >= F.hesitate && a - first <= F.hesitateIn)) out.push(a);
    if (out.length >= F.anchors) break;
  }
  return out;
}

// The key offset (rule 3): the attempt's pitch classes (a 10¢ histogram of the voiced frames) against the
// line's (its written notes, weighted by length), cross-correlated — order-free: → { c (¢, −600…+600: sung =
// written + c — the strongest), peaks: [{ c, w (its strength, the strongest 1) }] (round 2's WP1.3: up to `peaks`
// of the correlation's peaks, ≥ `peakApart` ¢ apart, strongest first — a few wrong notes can put a fifth-related
// offset on top: each is fitted, the fit decides) }.
export function keyOffset(ph, notes, frames) {
  const B = 120, H = new Float64Array(B), W = new Float64Array(B);
  const put = (A, cents, w) => { const x = (((cents / 10) % B) + B) % B, i = Math.floor(x), f = x - i; A[i % B] += w * (1 - f); A[(i + 1) % B] += w * f; };
  let n = 0;
  for (const f of frames) if (f.midi != null) { put(H, f.midi * 100, 1); n++; }
  for (const j of phraseJs(ph)) put(W, notes[j].midi * 100, notes[j].d);
  if (!n) return { c: 0, peaks: [] };
  // (both smoothed a little: a voice isn't a delta, nor are 10¢ bins)
  const smooth = (A) => { const out = new Float64Array(B), k = [0.06, 0.24, 0.4, 0.24, 0.06]; for (let i = 0; i < B; i++) for (let d = -2; d <= 2; d++) out[i] += A[(i + d + B) % B] * k[d + 2]; return out; };
  const Hs = smooth(H), Ws = smooth(W);
  const corr = new Float64Array(B);
  for (let s = 0; s < B; s++) { let c = 0; for (let b = 0; b < B; b++) c += Hs[(b + s) % B] * Ws[b]; corr[s] = c; }
  // (sub-bin: the parabola through a peak and its neighbours)
  const cOf = (best) => {
    const l = corr[(best + B - 1) % B], m = corr[best], r = corr[(best + 1) % B], den = l - 2 * m + r;
    const x = best + (den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / den)) : 0);
    let c = x * 10;
    if (c > 600) c -= 1200;
    return c;
  };
  // the local maxima, strongest first; each ≥ peakApart from every one taken before it
  const tops = [];
  for (let s = 0; s < B; s++) if (corr[s] >= corr[(s + B - 1) % B] && corr[s] > corr[(s + 1) % B]) tops.push(s);
  tops.sort((a, b) => corr[b] - corr[a] || a - b);
  const apart = Math.round(F.peakApart / 10), taken = [];
  for (const s of tops) {
    if (taken.length >= F.peaks) break;
    if (taken.some((t) => { const d = Math.abs(s - t) % B; return Math.min(d, B - d) < apart; })) continue;
    taken.push(s);
  }
  if (!taken.length) taken.push(0);
  const top = corr[taken[0]] || 1;
  const peaks = taken.map((s) => ({ c: cOf(s), w: +(corr[s] / top).toFixed(3) }));
  return { c: peaks[0].c, peaks };
}

// Grade the line placed at t = a + b·(written t − its start), pitches + off (¢): → the candidate.
// att: the recording's attacks (rhythm.js attackTimes, sorted; null — no recording): a counted start past the first
// that lands on one scores attackGain (round 2's WP1.2). Every candidate pays tempoCost × |ln b| × the line's seconds:
// the singer's tempo is held near the one heard unless the notes say otherwise.
function placer(ph, notes, frames, endT, counted, att = null) {
  const js = phraseJs(ph), T0 = notes[ph.j0].t, cset = new Set(counted), last = js.length - 1;
  const loud = loudGate(frames, 0.012); // (the same frames for every candidate: found once — gradeTake's own default gate)
  // (a short line — a few notes of the singer's own — fits as well at a tempo far from the one heard, one note off:
  // there a tie goes to the tempo nearer the speed heard too — |ln b| × the line's seconds, as a slot's move would)
  const lineSec = notes[js[last]].t - T0, short = counted.length <= F.shortLine;
  // (the line's last note: as long as the singer held it — F.lastMin)
  const lastV = frames.reduce((m, f) => (f.midi != null ? f.t : m), -Infinity);
  // (the counted starts past the first, as offsets in the line; the attacks' times)
  const sk = counted.filter((j) => j !== ph.j0 && !notes[j].melisma).map((j) => j - ph.j0);
  const at = att?.length ? att.map((x) => x.t) : null;
  const onAttack = (t) => {
    let lo = 0, hi = at.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (at[mid] < t) lo = mid + 1; else hi = mid; }
    return (lo < at.length && at[lo] - t <= F.attackWin) || (lo > 0 && t - at[lo - 1] <= F.attackWin);
  };
  return (a, b, off) => {
    const ns = js.map((j, k) => {
      const n = notes[j], t = a + b * (n.t - T0), d = b * n.d;
      return { midi: n.midi + off / 100, t, d: k === last ? Math.min(d, Math.max(F.lastMin, lastV + F.lastPad - t)) : d };
    });
    const g = gradeTake(ns, frames, { endT, loud });
    let s = 0, sh = 0, hits = 0, offs = 0, ah = 0;
    g.forEach((x, k) => { if (hitOf(x)) { s += 1 + 0.25 * (x.hit || 0); sh += Math.abs(x.shift || 0); if (cset.has(js[k])) hits++; } else if (x?.status === "off" || x?.status === "good" || x?.status === "ok") offs++; });
    if (at) for (const k of sk) if (onAttack(ns[k].t)) ah++;
    const tempo = F.tempoCost * Math.abs(Math.log(b)) * lineSec;
    return { s: s - F.moveCost * sh - F.offCost * offs + F.attackGain * ah - tempo, sh, k: sh + (short ? Math.abs(Math.log(b)) * lineSec : 0), hits, ah, g, ns, a, b, off };
  };
}
// The best of some candidates: the best score; among those within `tie` of it, the one sitting closest to the
// voice (the smallest Σ|shift| of the notes it hits) — the earliest a used to win a tie, every slot at its cap.
function pick(cs) {
  let top = -Infinity;
  for (const c of cs) if (c && c.s > top) top = c.s;
  let best = null;
  for (const c of cs) if (c && c.s >= top - F.tie - 1e-9 && (!best || c.k < best.k - 1e-9 || (Math.abs(c.k - best.k) <= 1e-9 && c.s > best.s))) best = c;
  return best;
}
// The coarse search from an anchor (rule 4): the tempo over bMin…bMax in log steps, the start just before
// the first sound.
function coarse(place, anchor, off) {
  const cs = [];
  for (let b = F.bMin; b <= F.bMax * 1.0001; b *= F.bStep) cs.push(place(anchor - 0.04, b, off));
  return pick(cs);
}
// …then the start over ±aSpan, then a fine pass (b in 1 % steps, a in 20 ms, b again).
function refine(place, best, anchor, off) {
  const cs = [best];
  for (let a = anchor - F.aSpan; a <= anchor + F.aSpan + 1e-9; a += F.aStep) cs.push(place(a, best.b, off));
  best = pick(cs);
  const fineB = (b0) => { const c = [best]; for (let k = -F.fineBn; k <= F.fineBn; k++) if (k) c.push(place(best.a, b0 * (1 + k * F.fineB), off)); return pick(c); };
  best = fineB(best.b);
  const c2 = [best];
  for (let k = -F.fineAn; k <= F.fineAn; k++) if (k) c2.push(place(best.a + k * F.fineA, best.b, off));
  best = pick(c2);
  return fineB(best.b);
}
// The singer's line at one pitch offset: from each anchor (its own frames, from anchor − before) the coarse
// search; the first anchor's kept unless a later one's hits `laterAnchor` counted notes more that it misses (round 2:
// a breath inside the line isn't a restart — on a line of one repeated pitch every placement hits, the first is kept);
// then refined.
function fitAt(ph, notes, frames, endT, counted, anchors, off, att = null) {
  const cs = anchors.map((an) => {
    const place = placer(ph, notes, frames.filter((f) => f.t >= an - F.before), endT, counted, att);
    return { ...coarse(place, an, off), anchor: an, place };
  });
  let c = cs[0];
  const one = counted.every((j) => Math.abs(notes[j].midi - notes[counted[0]].midi) < 0.5);
  if (!one) for (const x of cs.slice(1)) {
    const gain = counted.filter((j) => hitOf(x.g[j - ph.j0]) && !hitOf(c.g[j - ph.j0])).length;
    if (gain >= F.laterAnchor && x.s > c.s) c = x;
  }
  const r = refine(c.place, c, c.anchor, off);
  return { ...r, anchor: c.anchor, edge: r.b <= F.bMin * 1.02 || r.b >= F.bMax / 1.02 };
}
// The singer's line again, near a = a0, b = b0 (the measured onsets' line: judgeFree's fallback) — ±3 % and ±60 ms.
function refitNear(ph, notes, frames, endT, counted, fit, a0, b0) {
  if (!(b0 > 0) || fit.anchor == null) return null;
  const place = placer(ph, notes, frames.filter((f) => f.t >= fit.anchor - F.before), endT, counted, fit.att);
  const cs = [];
  for (let i = -3; i <= 3; i++) for (let k = -3; k <= 3; k++) cs.push(place(a0 + k * 0.02, b0 * (1 + i * 0.01), fit.off ?? 0));
  return pick(cs);
}
// What a share of the counted notes is taken of (rule 7): those the line puts before the singer stopped (the last
// voiced frame + reach) — at least a third of them, so a few notes sung don't make a whole line.
function reachedBase(ph, ns, counted, lastV) {
  return Math.max(counted.filter((j) => ns[j - ph.j0].t <= lastV + F.reach).length, Math.ceil(counted.length / 3), 1);
}
// The singer's line (rules 2–4): the anchors, the key offset, the fit at 0 and — the whole attempt off by
// ≥ offsetMin — at each of the key's candidates (keyOffset's peaks; the best by hits). Another key's fit is kept on
// quality (round 2's WP1.3): it hits ≥ offsetHits of the counted notes reached, and it hits keyGain notes more than the
// written key's, or the written key's sits on the search's edge or bends the tempo (> keyBent× from it), or round 1's
// rule (offsetGain× its hits). The key's direction is the register's (WP1.4): d — where the voice was against the
// piano heard (the median over the counted notes hit of the sung pitch, unfolded, less the written one and the
// singer's octave ctx.oct) —, s the shift of round(c) ± an octave nearest d that the Key menu allows (ctx.shiftOk;
// none: ±12), dir d's sign; other: the menu's ends left only an s the other way ("Sang it in another key").
// ctx.att: the recording's attacks (else from ctx.feat / ctx.start).
export function fitLine(ph, frames, endT, ctx) {
  const { notes } = ctx;
  const { counted } = countSets(ph, notes, ctx.spq0);
  const anchors = anchorsOf(frames);
  if (!anchors.length) return null;
  const att = ctx.att !== undefined ? ctx.att : ctx.feat && ctx.start != null ? attackTimes(ctx.feat, ctx.start) : null;
  const key = keyOffset(ph, notes, frames.filter((f) => f.t >= anchors[0] - F.before));
  const f0 = fitAt(ph, notes, frames, endT, counted, anchors, 0, att);
  // (of the counted notes the singer reached: one who stopped early, in another key, is still in that key)
  const lastV = frames.reduce((m, f) => (f.midi != null ? f.t : m), -Infinity);
  let fit = f0, kind = null, c = key.c;
  // (the written key hitting every note reached: no other key can do better)
  const all0 = !f0.edge && f0.hits >= reachedBase(ph, f0.ns, counted, lastV);
  let fc = null;
  if (!all0) for (const p of key.peaks || [{ c: key.c }]) {
    if (Math.abs(p.c) < F.offsetMin) continue;
    const x = fitAt(ph, notes, frames, endT, counted, anchors, p.c, att);
    if (!fc || x.hits > fc.hits || (x.hits === fc.hits && x.s > fc.s)) fc = { ...x, c: p.c };
  }
  if (fc) {
    const bent = Math.abs(Math.log(f0.b / fc.b)) > Math.log(F.keyBent);
    const better = fc.hits >= f0.hits + F.keyGain || f0.edge || bent || fc.hits >= F.offsetGain * f0.hits;
    if (fc.hits >= F.offsetHits * reachedBase(ph, fc.ns, counted, lastV) && better) { fit = fc; c = fc.c; kind = Math.abs(c) >= F.keyMin ? "key" : "offset"; }
  }
  const k = { c, s: 0, kind };
  if (kind === "key") {
    const oct = ctx.oct || 0, ok = ctx.shiftOk || ((s) => Math.abs(s) <= 12);
    const ds = counted.filter((j) => hitOf(fit.g[j - ph.j0]) && fit.g[j - ph.j0].sungMidi != null).map((j) => fit.g[j - ph.j0].sungMidi - notes[j].midi - oct);
    const d = ds.length ? median(ds) : c / 100, base = Math.round(c / 100);
    const cands = [base, base - 12, base + 12].filter((s) => s && ok(s)).sort((x, y) => Math.abs(x - d) - Math.abs(y - d));
    k.d = +d.toFixed(2);
    k.dir = d < 0 ? "lower" : "higher";
    k.s = cands[0] ?? 0;
    if (k.s && Math.sign(k.s) !== Math.sign(d)) k.other = true;
  }
  return { ...fit, key: k, f0, att };
}

// --- ♩: the starts -----------------------------------------------------------------------------------------

// A robust line through points [x, y] (Theil–Sen: the median of the pairwise slopes, then of the intercepts).
function theilSen(pts) {
  const sl = [];
  for (let i = 0; i < pts.length; i++) for (let k = i + 1; k < pts.length; k++) if (Math.abs(pts[k][0] - pts[i][0]) > 0.05) sl.push((pts[k][1] - pts[i][1]) / (pts[k][0] - pts[i][0]));
  if (!sl.length) return null;
  const b = median(sl);
  return { a: median(pts.map(([x, y]) => y - b * x)), b };
}
// A step in the starts (the held-long rule): starts on, then ≥ 2 in a row off the same way — one note held long
// or cut short, the beat kept after it. pts: [x, y, k, tol] in order. → { k (the first start after the step, in
// the line), d (s: + = late), a, b (the line before it) } | null
// (round 2's WP1.1 / WP1.8: ≥ minPre starts on before the step — Beats: 2, one start sets no beat; Line: 1 when it is
// the line's first, sung on its note — and the starts after it flat about the step, within the step's start's
// tolerance: a tempo curving away isn't a note held)
function stepIn(pts, { minPre = 2, firstMin = 0 } = {}) {
  if (pts.length < 4) return null; // (three starts: a step and a tempo can't be told apart — one start before it sets no beat)
  const one = theilSen(pts);
  if (!one) return null;
  const sum1 = pts.reduce((s, [x, y]) => s + Math.abs(y - one.a - one.b * x), 0);
  let best = null;
  for (let i = minPre; i + 2 <= pts.length; i++) {
    const pre = pts.slice(0, i), post = pts.slice(i), sl = [];
    for (const g of [pre, post]) for (let p = 0; p < g.length; p++) for (let q = p + 1; q < g.length; q++) if (g[q][0] - g[p][0] > 0.05) sl.push((g[q][1] - g[p][1]) / (g[q][0] - g[p][0]));
    if (!sl.length) continue;
    const b = median(sl), a = median(pre.map(([x, y]) => y - b * x)), d = median(post.map(([x, y]) => y - b * x - a));
    const tol = pts[i][3];
    if (Math.abs(d) <= tol || (i < 2 && Math.abs(d) < firstMin)) continue;
    if (!pre.every(([x, y, , t]) => Math.abs(y - a - b * x) <= t)) continue; // (on before it)
    if (!post.slice(0, 2).every(([x, y, , t]) => Math.sign(y - a - b * x) === Math.sign(d) && Math.abs(y - a - b * x) > t)) continue; // (≥ 2 off, the same way)
    const rp = post.map(([x, y]) => y - a - b * x);
    if (Math.max(...rp) - Math.min(...rp) > tol) continue; // (flat after it: the beat kept)
    const sum = pts.reduce((s, [x, y], k) => s + Math.abs(y - a - b * x - (k >= i ? d : 0)), 0);
    if (sum > 0.5 * sum1) continue;
    if (!best || sum < best.sum) best = { k: pts[i][2], d, a, b, sum };
  }
  return best;
}

// Each start's onset where the singer's line puts its note (rhythm.js findOnsets on the line, its lead's first guess
// within ±0.3 s — Line: within half the starts' shortest spacing, ≤ 0.15 s): Line's ♩ and Beats' both. fit: the singer's line { a, b, ns } (Beats: against the click); grades: at that
// line (Line: unsung — not reached, or missed with no voice near — isn't searched); unsung (Beats): instead, the
// starts not searched. → { out: { [k]: { measured, kind, dev, u, tol, first, y (s: the onset, on the frames'
// clock) } }, pts: [[line t, y, k, tol]] (the measured ones), lead, ne (where the pitch put each note) } | null
function measureStarts(ph, fit, grades, frames, endT, ctx, starts, reached, unsungOf = null, { line = false, step = null } = {}) {
  const { notes } = ctx;
  if (!ctx.feat || ctx.start == null || !ctx.score || !ctx.qToT) return null;
  const js = phraseJs(ph), T0 = notes[ph.j0].t;
  // (step { k, d }: Line's second look — fit.ns, where the notes are looked for, puts the notes from start k on d s
  // later than the singer's straight line, a note held long before them: the starts are judged on that line — ns —, so
  // the step shows in them as it was sung; pl — where they're looked for)
  const pl = fit.ns;
  const joinedAt = (k) => k > 0 && pl[k].t - (pl[k - 1].t + pl[k - 1].d) < 0.02;
  const base = step ? pl.map((n, k) => (k >= step.k ? { ...n, t: n.t - step.d } : k === step.k - 1 && joinedAt(step.k) ? { ...n, d: Math.max(0.05, n.d - step.d) } : n)) : pl;
  const ns = base.map((n, k) => ({ ...n, q: notes[js[k]].q, melisma: !!notes[js[k]].melisma, restBefore: k > 0 && n.t - (base[k - 1].t + base[k - 1].d) >= 0.02 }));
  // (the meter on the singer's clock: a beat's division in their seconds)
  // (in free time a start may come in late after a note held on — the window an entry gets, up to a beat)
  const sset = new Set(starts.map((j) => j - ph.j0));
  const met = metricOf(ctx.score, ns, [js.map((_, k) => k)], (q) => fit.a + fit.b * (ctx.qToT(q) - T0)).map((m, k) => (k > 0 && sset.has(k) && !m.entry ? { ...m, entry: true } : m));
  // Each start is searched where the pitch says the note was sung (a grading whose slots may move `wideShift`:
  // a note held on, the next one late, isn't looked for on the straight line, where its neighbour's attack is),
  // and judged against the straight line through the others.
  // (round 2's WP1.1: only where that grading found the note — good / ok: a note sung off has no place of its own
  // there, and its slot moved onto the neighbour that has the pitch it took — B2's first note sung 300¢ low was
  // looked for on the next note, 0.37 s late. The line's first start is looked for at the singer's first sound.)
  const wide = gradeTake(pl.map((n) => ({ midi: n.midi, t: n.t, d: n.d })), frames, { endT, maxShift: F.wideShift });
  // (Line: nor a note inside a run of one pitch, both its neighbours on it — the pitch can't place it: the wide grading
  // slides the run a whole note along, and its start was looked for on the neighbour's attack. Only inside one: with
  // either neighbour on its pitch, the run's first and last notes — the one place the pitch does say — were looked for
  // on the fit's line too: the pickup left out, “once” — on the pitch of the melisma note before it — was looked for on
  // the line the fit had squeezed, and “was” graded on its neighbour's pitch)
  const same = (k) => k > 0 && k + 1 < ns.length && [k - 1, k + 1].every((i) => Math.abs(ns[i].midi - ns[k].midi) < 0.5);
  const at = ns.map((n, k) => (k === 0 && fit.anchor != null ? fit.anchor : pl[k].t + (["good", "ok"].includes(wide[k]?.status) && !(line && same(k)) ? wide[k].shift || 0 : 0)));
  const ne = ns.map((n, k) => ({ ...n, t: at[k], d: k + 1 < ns.length && !ns[k + 1].restBefore ? Math.max(0.05, at[k + 1] - at[k]) : n.d }));
  const voicedNear = (n) => frames.some((f) => f.midi != null && f.t >= n.t - 0.1 && f.t <= n.t + n.d + 0.25);
  const unsung = unsungOf || js.map((j, k) => !reached.has(j) || grades[k]?.status === "unsung" || (grades[k]?.status === "missed" && !voicedNear(pl[k]) && !voicedNear(ne[k])));
  // (an attack followed by the note before's pitch, not this one's, is the note before re-sung — a melisma's note
  // after a breath — not this start: the singer's own pitch says so when they sang this note right. Round 2's WP1.5:
  // only after a melisma's note — a syllable sung on the pitch of the syllable before it is a wrong note, but a start)
  const pitchAfter = (t) => { const v = frames.filter((f) => f.midi != null && f.t >= t + 0.03 && f.t < t + 0.18).map((f) => f.midi); return v.length >= 3 ? median(v) : null; };
  // (…the note before as it was sung, where the grading heard it: a syllable sung on the written pitch of a melisma's
  // note sung wrong is no re-sung note — it follows another pitch)
  const keep = (k, t) => {
    if (k === 0 || !ne[k - 1].melisma) return true;
    const m = pitchAfter(t), mine = ne[k].midi, gb = grades?.[k - 1];
    const before = gb && ["good", "ok", "off"].includes(gb.status) && gb.sungMidi != null ? gb.sungMidi : ne[k - 1].midi;
    if (m == null || Math.abs(fold(m - mine)) <= 0.6 || Math.abs(fold(before - mine)) < 1) return true;
    return Math.abs(fold(m - before)) > 0.6;
  };
  const live = starts.filter((j) => reached.has(j));
  // (Line: the singer's line is where the pitch put the notes — the onsets' first guess at a lead stays within half the
  // shortest spacing of the starts, at most 0.15 s: a run of equal notes lined up one note off took every start's
  // neighbour's attack, and ♪ on those spans heard each note's neighbour)
  let seedRange = [-0.3, 0.3];
  if (line) {
    let gap = Infinity;
    for (let i = 1; i < live.length; i++) gap = Math.min(gap, ns[live[i] - ph.j0].t - ns[live[i - 1] - ph.j0].t);
    const r = Math.max(F.seedMin, Math.min(F.seedMax, gap / 2));
    seedRange = [-r, r];
  }
  let on;
  try { on = findOnsets(ne, ctx.feat, ctx.start, frames, met, { songT0: 0, rt: null, latency: 0, endT, unsung, seedRange, costs: { step: F.onsetStep, stepRest: F.onsetStep }, keep }); } catch (err) { console.warn("ear: onsets", err); return null; }
  const out = {};
  const pts = [];
  for (const j of live) {
    const k = j - ph.j0, o = on.notes[k], prev = notes[j - 1];
    const repeat = k > 0 && prev && Math.abs(prev.midi - notes[j].midi) < 0.5 && ns[k].t - (ns[k - 1].t + ns[k - 1].d) < 0.02;
    const measured = o && o.dev != null && o.conf >= F.conf && (!repeat || o.kind === "attack");
    out[k] = { measured: !!measured, kind: o?.kind ?? null, dev: o?.dev ?? null, u: met[k]?.u ?? null, tol: tolFlag(met[k]?.u ?? 0.3), beat: met[k]?.beat ?? null, first: j === ph.j0 };
    if (measured) out[k].y = ne[k].t + o.dev;
  }
  // (two starts on one onset, or out of order — rhythm.js align keeps neighbouring notes apart, not two starts with an
  // unsung or a melisma's note between them: the one further from where it was looked for gives it up)
  let pk = null;
  for (const j of live) {
    const k = j - ph.j0;
    if (!out[k].measured) continue;
    if (pk != null && out[k].y < out[pk].y + F.onsetGap) {
      // (…the one whose note doesn't follow it — the pitch after the onset is the other's —, else the one not sung
      // where it was looked for — a first word left out: the line's first start is looked for at the singer's first
      // sound, which is the next start's —, else the one further from its place)
      const pitchOk = (q) => { const m = pitchAfter(out[q].y); return m == null ? null : Math.abs(fold(m - ne[q].midi)) <= 0.6; };
      const sung = (q) => !!grades?.[q] && ["good", "ok", "off", "unclear"].includes(grades[q].status);
      const pa = pitchOk(pk), pb = pitchOk(k), sa = sung(pk), sb = sung(k);
      const lose = pa !== pb && pa != null && pb != null ? (pa ? k : pk) : sa !== sb ? (sa ? k : pk) : Math.abs(out[k].y - ne[k].t) > Math.abs(out[pk].y - ne[pk].t) ? k : pk;
      Object.assign(out[lose], { measured: false, y: undefined, dev: null, kind: null });
      if (lose === k) continue;
    }
    pk = k;
  }
  // (an onset nearer the next start's place than its own, that next start measured nothing: the next one's — a
  // syllable left out of a run of one pitch took its neighbour's attack, and the neighbour was left unmeasured)
  // (from the end: a chain — each onset taken one start early — moves back one at a time)
  for (let i = live.length - 2; i >= 0; i--) {
    const k = live[i] - ph.j0, k2 = live[i + 1] - ph.j0, a = out[k], b = out[k2];
    if (!a.measured || a.first || b.measured || !(a.y - pl[k].t > (pl[k2].t - pl[k].t) / 2)) continue;
    Object.assign(b, { measured: true, kind: a.kind, y: a.y, dev: a.y - ne[k2].t });
    Object.assign(a, { measured: false, y: undefined, dev: null, kind: null });
  }
  for (const j of live) { const k = j - ph.j0; if (out[k].measured) pts.push([ns[k].t, out[k].y, k, out[k].tol]); }
  return { out, pts, lead: on.lead, ne, live, base };
}

// The starts on the singer's own line (rule 6): each start's onset (measureStarts), judged against a Theil–Sen
// line through the other measured starts (leave-one-out: one late start doesn't tilt its own reference) — on
// within tolFlag(u) of the beat's division on the singer's clock. The line's first start is on when sung: in free
// time nothing comes before it. Round 2 (the fix plan's WP1.5, 1.7, 1.8):
// - a start is off only when it's off against both the leave-one-out line and the singer's tempo (the slope through all
//   the starts) through the median of the others: with four starts, one late start tilted every neighbour's line;
// - a ritardando into the line's end (ritIn) — and a written fermata's note with the start after it — are counted on,
//   never cued, and left out of the others' lines; the rit out of the held-long step too, the fermata's starts not: a
//   fermata held as written is a step the singer's to take (step.free), and the notes after it are graded past it;
// - a start sung but not measured (legato, a same-pitch repeat, a glide) is on when its note was voiced (any pitch:
//   a pitch miss never costs a ♩) and its nearest measured starts are on; it is never cued.
function judgeStarts(ph, fit, grades, frames, endT, ctx, starts, reached, look = null) {
  const { notes } = ctx;
  const m = measureStarts(ph, fit, grades, frames, endT, ctx, starts, reached, null, { line: true, step: look });
  if (!m) return null;
  const { out, pts, live } = m;
  const nMeasured = pts.length;
  // (a written fermata: its note held as long as the singer likes — it and the start after it aren't judged)
  const exempt = new Set();
  for (let j = ph.j0; j < ph.j1; j++) if (notes[j].fermata) { exempt.add(j - ph.j0); const nx = starts.find((x) => x > j); if (nx != null) exempt.add(nx - ph.j0); }
  const rit = ritIn(pts.filter((p) => !exempt.has(p[2])), out);
  const free = new Set([...exempt, ...(rit?.ks || [])]);
  const ref = pts.filter((p) => !free.has(p[2]));
  // (a short line — the singer's own two or three words — has too few others for leave-one-out: the singer's line,
  // whose tempo is loose there — the pitch fit of a 3-note line is good to ~5 % —, with that much more room the
  // further a start is from the first: a start well off still is, the fit's own slack never reads as one)
  const x0 = pts.length ? Math.min(...pts.map((p) => p[0])) : 0;
  // (the second line: the slope of all the starts — the singer's tempo, one start off can't tilt it much — through
  // the median of the others; the fix plan's slope 1 on the fitted line was the pitch fit's tempo, 1.3 % off over a
  // line: a start 0.15 s early read 0.12)
  const all = ref.length >= 3 ? theilSen(ref) : null, slope = all?.b ?? 1;
  for (const [x, y, k] of pts) {
    const others = ref.filter((p) => p[2] !== k);
    const line = others.length >= 3 ? theilSen(others) : null;
    if (line) {
      const r1 = y - line.a - line.b * x, r2 = y - slope * x - median(others.map((p) => p[1] - slope * p[0]));
      out[k].r = Math.abs(r1) <= Math.abs(r2) ? r1 : r2; // (off only when off against both)
    } else {
      out[k].r = y - x - (m.lead ?? 0);
      out[k].tol += F.fewSlack * Math.abs(x - x0);
    }
  }
  // (a step — one note held long or cut short, the beat kept after it — is one start off: the first after it;
  // the rest are judged on the beat as it went on)
  // (Line: the line's first start may be the only one before the step — in free time nothing comes before it, so the
  // first syllable held long is a step after one start —, when it was sung on its note: looked for at the singer's
  // first sound, which is then that note's; a first note sung off, or left out — the first sound a later note's —, sets
  // no beat. A step that size only from firstStep: one onset is all the line before it has — a first note without an
  // attack, its onset 0.13 s off, made a "cut short" step past two starts not measured, and moved their notes onto
  // their neighbours' pitches. A fermata's starts are in it too: a fermata held as written moves the rest of the line, and the
  // notes after it are graded where they were sung — the step is the singer's to take there, never cued: free)
  const sp = pts.filter((p) => !rit?.ks.has(p[2]));
  const step = stepIn(sp, { minPre: sp[0]?.[2] === 0 && hitOf(grades[0]) ? 1 : 2, firstMin: F.firstStep });
  if (step) {
    const kPrev = starts.filter((j) => j - ph.j0 < step.k).pop() ?? ph.j0;
    for (let j = kPrev; j < ph.j0 + step.k; j++) if (notes[j].fermata) step.free = true;
    for (const [x, y, k] of ref) out[k].r = y - step.a - step.b * x - (k > step.k ? step.d : 0);
    // (a step not a fermata's: its start is the one off — the fermata's note's own start too, when the note held is
    // another: the pickup before it)
    if (!step.free && free.has(step.k)) { const p = pts.find((q) => q[2] === step.k); out[step.k].r = p[1] - step.a - step.b * p[0]; free.delete(step.k); }
  }
  const judged = nMeasured * 2 >= live.length && live.length > 0;
  for (const j of starts) {
    const k = j - ph.j0, s = out[k];
    if (!s) { out[k] = { on: false, measured: false, reached: false }; continue; }
    s.reached = true;
    if (s.first) s.on = s.measured || hitOf(grades[k]) || grades[k]?.status === "off";
    else if (s.measured) { s.on = free.has(k) || Math.abs(s.r) <= s.tol; if (rit?.ks.has(k)) s.rit = true; }
  }
  // (the unmeasured ones: voiced, between measured starts on)
  const meas = starts.filter((j) => out[j - ph.j0].reached && out[j - ph.j0].measured);
  for (const j of starts) {
    const k = j - ph.j0, s = out[k];
    if (!s.reached || s.measured || s.first) continue;
    const n = fit.ns[k], w = frames.filter((f) => f.t >= n.t && f.t < n.t + n.d);
    const voiced = w.length >= 2 && w.filter((f) => f.midi != null).length >= F.voicedStart * w.length;
    const nb = [meas.filter((x) => x < j).pop(), meas.find((x) => x > j)].filter((x) => x != null);
    s.on = judged && voiced && nb.length > 0 && nb.every((x) => out[x - ph.j0].on);
    s.um = true;
  }
  return { starts: out, measured: nMeasured, of: live.length, judged, step, lead: m.lead, rit: rit ? rit.k0 : null, pts, base: m.base };
}
// A ritardando into the line's end (round 2's WP1.8; known gap 2): the last 2–3 measured starts each later than the one
// before — the first ≥ ritFirst, each then ≥ ritMin more — against a line through the starts before them, which are
// on; the last off its tolerance, and at most ritBeat beats late. A lone late last start (the one before it on time)
// isn't one: that's still cued. pts: [x, y, k, tol] (in order); out: measureStarts's (first, beat). → { k0, ks } | null
function ritIn(pts, out) {
  for (const n of [3, 2]) {
    if (pts.length < n + 2) continue;
    const pre = pts.slice(0, -n), tail = pts.slice(-n);
    const line = pre.length >= 3 ? theilSen(pre) : null;
    const L = line || { a: median(pre.map((p) => p[1] - p[0])), b: 1 };
    const r = ([x, y]) => y - L.a - L.b * x;
    if (!pre.every((p) => out[p[2]].first || Math.abs(r(p)) <= p[3])) continue;
    let prev = null, ok = true;
    for (const p of tail) {
      const x = r(p);
      if (!(prev == null ? x >= F.ritFirst : x >= prev + F.ritMin)) { ok = false; break; }
      prev = x;
    }
    const last = tail[tail.length - 1];
    if (!ok || !(prev > last[3]) || prev > F.ritBeat * (out[last[2]].beat ?? 0.6)) continue;
    return { k0: tail[0][2], ks: new Set(tail.map((p) => p[2])) };
  }
  return null;
}

// Where the recording's attacks put a step in the line (judgeFree's second look): the singer's line moved a little —
// a ±0.08 s, b × 0.74…1.06 (the fit spread a hold over the line: its tempo too slow) — and from one start on, d s later
// (or earlier: a note cut short), scored as the fit scores attacks: the counted starts (the first too: a line begun later
// isn't a step after it) within attackWin of one, less the tempo's cost in those units; → { a, b, k, d, ns (the notes placed so: the note before the step to it),
// ah, ah0 } when the best step puts stepAttacks more starts on attacks than the best straight line, else null.
function stepLook(ph, notes, fit, counted, lastV) {
  const at = fit.att?.length ? fit.att.map((x) => x.t) : null;
  if (!at || !fit.ns) return null;
  const js = phraseJs(ph), T0 = notes[ph.j0].t, last = js.length - 1;
  // (the counted starts, the first among them: where it sits tells a step after it from a line started later)
  const sk = counted.filter((j) => j === ph.j0 || !notes[j].melisma).map((j) => j - ph.j0);
  if (sk.length < 4) return null;
  const w = sk.map((k) => notes[js[k]].t - T0), lineSec = notes[js[last]].t - T0;
  const on = (t) => {
    let lo = 0, hi = at.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (at[mid] < t) lo = mid + 1; else hi = mid; }
    return (lo < at.length && at[lo] - t <= F.attackWin) || (lo > 0 && t - at[lo - 1] <= F.attackWin);
  };
  const cost = (b) => (F.tempoCost / F.attackGain) * Math.abs(Math.log(b)) * lineSec;
  const D = [];
  for (let d = F.stepMin; d <= F.stepMax + 1e-9; d += 0.03) { D.push(d); if (d <= F.stepCut) D.push(-d); }
  let best = null, plain = -Infinity;
  // (around the fit's start, and the singer's first sound's: a run of one pitch fitted a note late lines its attacks up
  // with the next notes')
  const A = [fit.a];
  if (fit.anchor != null && Math.abs(fit.anchor - 0.04 - fit.a) > 0.05) A.push(fit.anchor - 0.04);
  for (const a0 of A) for (let da = -0.08; da <= 0.08 + 1e-9; da += 0.02) for (let u = Math.log(0.74); u <= Math.log(1.06) + 1e-9; u += 0.015) {
    const a = a0 + da, b = fit.b * Math.exp(u), c = cost(b);
    const x = w.map((t) => a + b * t);
    const pre = [0];
    for (let i = 0; i < x.length; i++) pre.push(pre[i] + (on(x[i]) ? 1 : 0));
    plain = Math.max(plain, pre[x.length] - c);
    for (let i = 1; i < x.length; i++) for (const d of D) {
      let h = pre[i];
      for (let q = i; q < x.length; q++) if (on(x[q] + d)) h++;
      const sc = h - c - F.stepCost * Math.abs(d);
      if (!best || sc > best.sc + 1e-9) best = { a, b, i, d, h, sc };
    }
  }
  if (!best || best.sc < plain + F.stepAttacks) return null;
  const k = sk[best.i], { a, b, d } = best;
  const ns = fit.ns.map((n, q) => {
    const t = a + b * (notes[js[q]].t - T0) + (q >= k ? d : 0);
    let len = b * notes[js[q]].d;
    if (q === k - 1 && notes[js[k]].t - (notes[js[q]].t + notes[js[q]].d) < 0.02) len = Math.max(0.05, len + d);
    if (q === last) len = Math.min(len, Math.max(F.lastMin, lastV + F.lastPad - t));
    return { ...n, t, d: len };
  });
  return { a, b, k, d, ns, ah: best.h, ah0: +plain.toFixed(2) };
}

// Each note's own span (round 2's WP1.6): base — the notes where the singer's line puts them ([{ t, d, midi }] in the
// line); starts — judgeStarts's (y: a measured onset). A start whose onset is within anchorMax of its place starts
// there; a melisma's notes keep their places inside their syllable; a note joined to the next runs to where the next
// starts; no slot starts before or runs past a measured neighbour's onset (less anchorGap). A slot left under
// anchorKeep of its length is squeezed ("own": by its own late onset; "by": by a neighbour's early one) — judgeFree
// doesn't judge a squeezed note's pitch unless it was hit: a few frames, half of them looking into the next note (the
// pitch reader's window runs ~50 ms past a frame's time), and the timing cue says what happened. (The fix plan had it
// fall back to the fit's slot: that is where the neighbour's pitch is — a short note sung late, the note before held
// into it, came out "much higher".)
// → { ns, anchored (starts re-placed), squeezed: [false | "own" | "by"], bound: [the slot ends at a measured onset —
// nothing sung in it then is a note left out: a note sung late would have that onset] }
function ownSpans(base, starts) {
  const n = base.length, G = F.anchorGap;
  const y = base.map((x, k) => { const s = starts?.[k]; return s?.measured && s.y != null && Math.abs(s.y - x.t) <= F.anchorMax ? s.y : null; });
  const P = base.map((x, k) => (y[k] != null ? y[k] : x.t)), E = base.map((x) => x.t + x.d);
  const nextY = (k) => { for (let i = k + 1; i < n; i++) if (y[i] != null) return y[i]; return Infinity; };
  const prevY = (k) => { for (let i = k - 1; i >= 0; i--) if (y[i] != null) return y[i]; return -Infinity; };
  for (let k = 0; k < n; k++) if (y[k] == null) P[k] = Math.max(P[k], prevY(k) + G);
  const bound = new Array(n).fill(false);
  for (let k = 0; k < n; k++) {
    const joined = k + 1 < n && base[k + 1].t - (base[k].t + base[k].d) < 0.02;
    const own = joined ? P[k + 1] - (y[k + 1] != null ? G : 0) : base[k].t + base[k].d, ny = nextY(k) - G;
    E[k] = Math.min(own, ny);
    bound[k] = (joined && y[k + 1] != null) || ny <= own;
  }
  const squeezed = base.map((x, k) => (E[k] - P[k] < F.anchorKeep * x.d ? (y[k] != null ? "own" : "by") : false));
  return { ns: base.map((x, k) => ({ ...x, t: P[k], d: Math.max(0.02, E[k] - P[k]) })), anchored: y.filter((v) => v != null).length, squeezed, bound };
}

// --- The judgment ------------------------------------------------------------------------------------------

// The free attempt (● Sing, on your own time; rules 1–8): its counts, one win and one cue.
export function judgeFree(ph, frames0, endT, ctx) {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const { notes } = ctx;
  const done = (r) => { r.ms = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0); if (r.win) r.win.text = winText(r.win, ctx); if (r.cue) r.cue.text = cueText(r.cue, ctx); return r; };
  const frames = gateFrames(frames0, ctx.gateUntil);
  const voiced = frames.filter((f) => f.midi != null);
  const { counted, starts } = countSets(ph, notes, ctx.spq0);
  const nothing = { counts: null, win: null, fit: null, key: null, starts: null, onsets: null, notReached: null, whole: false, up: null };
  if (voiced.length < 6) return done({ ...nothing, cue: { kind: "silent", sounds: ["first"] } });
  let fit = fitLine(ph, frames, endT, ctx);
  if (!fit) return done({ ...nothing, cue: { kind: "silent", sounds: ["first"] } });
  const js = phraseJs(ph);
  const fr = frames.filter((f) => f.t >= fit.anchor - F.before);
  const isKey = fit.key.kind === "key";
  // ♪ (rule 5): the written notes (another key: the singer's) at the singer's line, a slot moving ≤ 0.1 s
  const loudFr = loudGate(fr, 0.012);
  const regrade = (ns, off, maxShift = F.gradeShift) => gradeTake(ns.map((n, k) => ({ midi: notes[js[k]].midi + off / 100, t: n.t, d: n.d })), fr, { endT, maxShift, loud: loudFr });
  let g = regrade(fit.ns, isKey ? fit.key.c : 0);
  // not reached (rule 7): starting after the last voiced frame
  const lastV = fr.reduce((m, f) => (f.midi != null ? f.t : m), -Infinity);
  let notReached = counted.filter((j) => !(fit.ns[j - ph.j0].t <= lastV + F.reach)).length;
  const hitsW = counted.filter((j) => hitOf(g[j - ph.j0])).length;
  const share = Math.max(hitsW, fit.hits) / reachedBase(ph, fit.ns, counted, lastV);
  const res = { fit: { a: fit.a, b: fit.b, off: fit.key.kind ? fit.key.c : 0, anchor: fit.anchor, g, ns: fit.ns }, key: fit.key, notReached, up: null };
  // couldn't follow: the tempo on the search's edge, too little hit even after the offset, or the line found
  // covering too little of the singing
  const lineEnd = Math.max(...fit.ns.map((n) => n.t + n.d)), sungFr = fr.filter((f) => f.midi != null);
  const cover = sungFr.filter((f) => f.t >= fit.a - 0.15 && f.t <= lineEnd + 0.15).length / Math.max(1, sungFr.length);
  res.cover = +cover.toFixed(2);
  if (fit.edge || share < F.nofit || (cover < F.cover && share < F.coverHits)) return done({ ...res, counts: null, win: null, cue: { kind: "nofit", sounds: ["hear"] }, starts: null, onsets: null, whole: false });
  // ♩ (rule 6), then ♪ where the starts put the notes — at one placement of the line (the fit's, or the fallback's
  // refit below): → { g, graded, st, reachedSet, bound, anchored }
  const off = isKey ? fit.key.c : 0;
  const judgeAt = (fit, g, look = null) => {
    const reachedSet = new Set(js.filter((j, k) => fit.ns[k].t <= lastV + F.reach));
    const st = judgeStarts(ph, fit, g, fr, endT, ctx, starts, reachedSet, look);
    // a held / cut note (a step in the starts): the notes after it graded where they were sung — every note where the
    // step's model puts it (its own line, not the pitch fit's, which stretched to take the step in), the notes from the
    // step on moved by it. (The fix plan's WP1.1 kept the notes before it at the fit's places: B2's first note sung off
    // made a step out of one start before it, measured 0.37 s late — its line moved them onto their neighbours. The
    // first start is now looked for at the singer's first sound; the step's line is the better one: the fit stretched
    // over a pause put a melisma's notes on the next ones.)
    let graded = fit.ns;
    if (st?.step) {
      const { a, b, d, k: ks } = st.step;
      // (on the line the starts were judged on: a second look's is the straight one, its notes looked for past the step)
      graded = (look ? st.base : fit.ns).map((n, k) => ({ ...n, t: a + b * n.t + (k >= ks ? d : 0), d: b * n.d }));
      g = regrade(graded, off);
    }
    // ♪ on each note's own span (round 2's WP1.6): a start measured is re-placed at its onset, its slot to the next
    // note's place — never past a measured neighbour's onset —, graded with slots moving ≤ spanShift: a neighbour can't
    // lend its pitch (a flat note between equal pitches), and a note cut short by its neighbour's early start isn't
    // graded on that neighbour (squeezed: not judged on pitch)
    let bound = null, anchored;
    if (st) {
      const sp = ownSpans(graded, st.starts);
      bound = sp.bound;
      if (sp.anchored) {
        graded = sp.ns;
        g = regrade(graded, off, F.spanShift);
        sp.squeezed.forEach((q, k) => { if (q && g[k] && !hitOf(g[k])) g[k] = { ...g[k], status: "unclear", squeezed: q }; });
      }
      anchored = sp.anchored;
    }
    return { g, graded, st, reachedSet, bound, anchored };
  };
  const hitsIn = (g) => counted.filter((j) => hitOf(g[j - ph.j0])).length;
  const offsIn = (g) => counted.filter((j) => g[j - ph.j0]?.status === "off").length;
  let J = judgeAt(fit, g);
  // (a note held long — or cut short — mid-line, no step found: the pitch fit, held near the tempo heard, spread the hold
  // over the line, and the notes after it — a run of one pitch, told apart only by their attacks — were looked for a note
  // early, each on its neighbour's attack: one start off, the rest "on", and the note after the hold graded on the held
  // note's pitch. A second look where the recording's attacks put a step (stepLook): the notes looked for there, judged
  // on the straight line; kept when its starts show the step and it blames no note more)
  // (a step found that the attacks put elsewhere — another start, or another size: a run of one pitch looked for a
  // note off its place makes a small step of its own — looked at again, and kept only when it blames fewer notes, or as
  // many and finds more of the starts)
  if (J.st) {
    const s0 = J.st.step;
    let sl = stepLook(ph, notes, fit, counted, lastV);
    if (sl && s0 && sl.k === s0.k && Math.abs(sl.d - s0.d) < 0.15) sl = null;
    if (sl) {
      const lf = { ...fit, a: sl.a, b: sl.b, ns: sl.ns };
      const J1 = judgeAt(lf, regrade(lf.ns, off), { k: sl.k, d: sl.d });
      const o1 = offsIn(J1.g), o0 = offsIn(J.g), h1 = hitsIn(J1.g), h0 = hitsIn(J.g), m1 = J1.st?.measured ?? 0, m0 = J.st.measured;
      if (J1.st?.step && (s0 ? o1 < o0 || (o1 === o0 && h1 >= h0 && (h1 > h0 || m1 > m0)) : o1 <= o0 && h1 >= h0)) {
        J = J1;
        fit = { ...lf, look: true };
        Object.assign(res.fit, { a: fit.a, b: fit.b, ns: fit.ns, look: true });
      }
    }
  }
  // (round 2's WP1.2, the fallback: the measured starts say another tempo than the pitch fit's — a short line's fit is
  // loose: a late start bent it 15 % — refit near the onsets' line, measure and grade again. Not when a step explains
  // them — a note held long mid-line bends the fit, and the step's own line already puts every note where it was sung:
  // the refit lined up with the starts after the hold and put the first notes on their neighbours' pitches ("“with” —
  // much lower" on a note sung right) — and kept only when, graded as the counts and the cues are (on each note's own
  // span), it blames no note more and hits at most one fewer: a first word left out, the fit squeezed its notes onto
  // the next ones' pitches — one of them "hit")
  if (!J.st?.step && J.st?.pts?.length >= 4) {
    const ts = theilSen(J.st.pts.map((p) => [p[0], p[1]]));
    if (ts && Math.abs(ts.b - 1) > F.onsetSlope) {
      const nf = refitNear(ph, notes, frames, endT, counted, fit, ts.a + ts.b * fit.a, ts.b * fit.b);
      if (nf && nf.hits >= fit.hits - 1) {
        const f1 = { ...fit, a: nf.a, b: nf.b, ns: nf.ns, g: nf.g, hits: nf.hits, refit: true };
        const J1 = judgeAt(f1, regrade(f1.ns, off));
        if (offsIn(J1.g) <= offsIn(J.g) && hitsIn(J1.g) >= hitsIn(J.g) - 1) {
          fit = f1; J = J1;
          Object.assign(res.fit, { a: fit.a, b: fit.b, ns: fit.ns, refit: true });
        }
      }
    }
  }
  const { st, graded, reachedSet, bound } = J;
  g = J.g;
  notReached = res.notReached = counted.filter((j) => !reachedSet.has(j)).length;
  if (st) res.anchored = J.anchored;
  // (the singer's tempo: a step's own line on the fit's — the fit spread a held note over the line: "You sang it at ♩=…"
  // read a fermata held as written as a slower tempo)
  if (st?.step?.b > 0) res.fit.b = fit.b * st.step.b;
  res.fit.g = g;
  const gOf = (j) => g[j - ph.j0];
  const hit = (j) => hitOf(gOf(j));
  // the counts
  const unclear = counted.filter((j) => gOf(j)?.status === "unclear").length;
  const hits = counted.filter(hit).length;
  const judgedN = counted.length - unclear;
  const notesAll = hits > 0 && judgedN * 2 >= counted.length && counted.every((j) => hit(j) || gOf(j)?.status === "unclear");
  const onN = st ? starts.filter((j) => st.starts[j - ph.j0]?.on).length : 0;
  const counts = {
    notes: isKey ? null : hits, notesAll: !isKey && notesAll,
    beats: st?.judged ? onN : null, beatsAll: !!st?.judged && onN === starts.length,
  };
  res.counts = counts;
  res.starts = st ? Object.fromEntries(Object.entries(st.starts).map(([k, s]) => [k, { r: s.r != null ? +s.r.toFixed(3) : null, on: !!s.on, measured: !!s.measured, kind: s.kind ?? null, ...(s.rit ? { rit: true } : {}), ...(s.um && s.on ? { um: true } : {}) }])) : null;
  res.onsets = st ? { measured: st.measured, of: st.of } : null;
  res.rit = st?.rit ?? null;
  // (a start counted on but not measured — Q2-2: still counted, but no "Spot on")
  res.um = !!st && starts.some((j) => { const s = st.starts[j - ph.j0]; return s?.reached && s.on && !s.measured; });
  res.whole = notReached === 0;
  // a count that rose since the last whole attempt here (same line, mode and speed)
  const prev = ctx.prev?.whole ? ctx.prev : null;
  res.up = prev && res.whole ? { notes: counts.notes != null && prev.counts?.notes != null && counts.notes > prev.counts.notes, beats: counts.beats != null && prev.counts?.beats != null && counts.beats > prev.counts.beats } : { notes: false, beats: false };

  // --- the cue: the first that applies (reached notes only)
  const reachedCounted = counted.filter((j) => reachedSet.has(j));
  const T = (j) => graded[j - ph.j0];
  const around = (j0, j1) => [Math.max(0, T(j0).t - 0.4), T(j1).t + T(j1).d + 0.4];
  const whole = [Math.max(0, fit.a - 0.3), Math.max(...fit.ns.map((n) => n.t + n.d)) + 0.4];
  const startBefore = (j, n) => { const ss = starts.filter((x) => x < j); return ss.length >= n ? ss[ss.length - n] : ph.j0; };
  let cue = null;
  if (fit.key.kind === "key") cue = { kind: "key", dir: fit.key.dir, s: fit.key.s, ...(fit.key.other ? { other: true } : {}), at: whole, sounds: ["first", "you", "key"] };
  else if (fit.key.kind === "offset") cue = { kind: "offset", dir: fit.key.c < 0 ? "higher" : "lower", at: whole, sounds: ["first", "you"] };
  if (!cue && notReached >= 2) {
    // (▶ The rest: from the first note of the stretch nothing was sung in)
    let from = ph.j1 - 1;
    while (from > ph.j0 && !hit(from - 1) && gOf(from - 1)?.status !== "off" && gOf(from - 1)?.status !== "unclear") from--;
    cue = { kind: "short", j: ph.j1 - 1, from, sounds: ["rest"] };
  }
  // (missed: hardly a voice around it at all — a note sung late and short is a timing matter, not "sing out")
  const silentAt = (j) => { const n = graded[j - ph.j0], w = fr.filter((f) => f.t >= n.t - 0.05 && f.t < n.t + n.d + 0.05); return w.length >= 2 && w.filter((f) => f.midi != null).length < 0.25 * w.length; };
  // (…or its pitch not heard in it nor just after it — a short note left out between two sung ones: their edges fill
  // a quarter of its window, but nothing there was this note; a late one is heard on its pitch, after its start)
  const unheardAt = (j) => {
    const n = graded[j - ph.j0], target = notes[j].midi + (isKey ? fit.key.c / 100 : 0);
    return fr.filter((f) => f.midi != null && f.t >= n.t && f.t < n.t + n.d + 0.3 && Math.abs(fold(f.midi - target)) <= 0.5).length < 3;
  };
  // (…or its own slot, ended by the next start's measured onset, holds nothing of it — a syllable left out of a run of
  // one pitch: its neighbours' edges fill a third of it, all on its pitch)
  const gone = (j) => gOf(j)?.status === "missed" && (silentAt(j) || unheardAt(j) || !!bound?.[j - ph.j0]);
  if (!cue) {
    const missed = reachedCounted.filter(gone).sort((x, y) => notes[y].d - notes[x].d || x - y)[0];
    if (missed != null) cue = { kind: "missed", j: missed, at: around(missed, missed), sounds: ["note", "you"] };
  }
  if (!cue) {
    const off = reachedCounted.filter((j) => gOf(j)?.status === "off").sort((x, y) => notes[y].d - notes[x].d || Math.abs(gOf(y).dev) - Math.abs(gOf(x).dev))[0];
    if (off != null) {
      const c = Math.abs(gOf(off).dev) * 100;
      cue = { kind: "pitch", j: off, dir: gOf(off).dev > 0 ? "lower" : "higher", size: c < F.touch ? "touch" : c > F.much ? "much" : "aim", at: around(off, off), sounds: ["note", "you"] };
    }
  }
  if (!cue && unclear * 2 >= counted.length && unclear > 0) cue = { kind: "unclear", sounds: [] };
  if (!cue && st?.step && !st.step.free) {
    // (late after the note before held on: "held long"; late after a pause: that start came in late; early: the
    // note before cut short)
    const jStart = ph.j0 + st.step.k, held = jStart - 1, y = st.starts[st.step.k]?.y;
    const gap = [T(held).t + T(held).d, (y ?? T(jStart).t) - 0.05];
    const inGap = fr.filter((f) => f.t >= gap[0] && f.t < gap[1]), voicedGap = inGap.filter((f) => f.midi != null).length;
    const paused = st.step.d > 0 && inGap.length >= 3 && voicedGap < 0.6 * inGap.length;
    if (paused) cue = { kind: "timing", j: jStart, dir: "sooner", range: [startBefore(jStart, 2), jStart], at: around(startBefore(jStart, 2), jStart), sounds: ["stretch", "you"] };
    else if (held >= ph.j0) cue = { kind: "held", j: held, dir: st.step.d > 0 ? "sooner" : "later", range: [startBefore(held, 2), jStart], at: around(startBefore(held, 1), jStart), sounds: ["stretch", "you"] };
  }
  if (!cue && st?.judged) {
    // (the start furthest off for its tolerance — round 2's WP1.7: not the first)
    const off = (j) => { const s = st.starts[j - ph.j0]; return Math.abs(s.r) / s.tol; };
    const late = starts.filter((j) => { const s = st.starts[j - ph.j0]; return s?.reached && s.measured && !s.first && !s.on; }).sort((x, y) => off(y) - off(x) || x - y)[0];
    if (late != null) { const s = st.starts[late - ph.j0]; cue = { kind: "timing", j: late, dir: s.r > 0 ? "sooner" : "later", range: [startBefore(late, 2), late], at: around(startBefore(late, 2), late), sounds: ["stretch", "you"] }; }
  }
  if (!cue && !isKey && reachedCounted.every(hit) && reachedCounted.length >= 3) {
    const dev = (j) => gOf(j).dev * 100, ds = reachedCounted.map(dev), med = median(ds), n3 = Math.max(1, Math.floor(ds.length / 3));
    const drift = median(ds.slice(-n3)) - median(ds.slice(0, n3));
    if (Math.abs(med) >= F.sag) cue = { kind: "sag", dir: med > 0 ? "lower" : "higher", end: false, at: whole, sounds: ["first", "you"] };
    else if (Math.abs(drift) >= F.sag) cue = { kind: "sag", dir: drift > 0 ? "lower" : "higher", end: true, at: whole, sounds: ["first", "you"] };
  }
  res.cue = cue;
  // Notes' targets from this attempt (the fix plan's WP4.1; noteTargets): the counted notes reached and sung off or
  // not sung (as the cue judges "not sung"; not the stretch a singer who stopped left out: "Keep going to …") — the
  // cue's note first, then the longest
  const offOf = (j) => gOf(j)?.status === "off" || gone(j);
  const left = cue?.kind === "short" ? cue.from : Infinity;
  res.drill = reachedCounted.filter((j) => j < left && offOf(j))
    .sort((x, y) => (y === cue?.j) - (x === cue?.j) || notes[y].d - notes[x].d || Math.abs(gOf(y)?.dev ?? 0) - Math.abs(gOf(x)?.dev ?? 0) || x - y)
    .map((j) => j - ph.j0);

  // --- the win: the first that applies, not the cue's note, not last time's again when another applies
  // (cleanly: hit, its voiced pitch steady in its slot, and hit where the singer's line puts it too — not only
  // in a slot the grading moved onto a neighbour's pitch)
  const clean = (j) => {
    const x = gOf(j);
    if (!hitOf(x) || !reachedSet.has(j) || cue?.j === j) return false;
    const target = notes[j].midi + (isKey ? fit.key.c / 100 : 0);
    const devs = (t0, t1) => fr.filter((f) => f.midi != null && f.t >= t0 && f.t < t1).map((f) => fold(f.midi - target) * 100);
    const moved = devs(x.from, x.to);
    if (moved.length < 3) return false;
    const m = median(moved);
    if (median(moved.map((d) => Math.abs(d - m))) >= F.clean) return false;
    const n = graded[j - ph.j0], s0 = n.t + Math.min(0.12, 0.25 * n.d), here = devs(s0, n.t + n.d), all = fr.filter((f) => f.t >= s0 && f.t < n.t + n.d).length;
    return here.length >= 3 && here.length >= 0.35 * all && Math.abs(median(here)) <= 50;
  };
  const wins = [];
  // ("Spot on": both all, every counted start measured, no offset or sag cue — round 2's WP1.14, its part the starts
  // need: a late legato start the recording couldn't hear was "Spot on — twice running")
  res.spotOk = !res.um && !(cue && ["sag", "offset"].includes(cue.kind));
  if (counts.notesAll && counts.beatsAll && res.spotOk) wins.push({ kind: "spot", ...(ctx.prev?.win?.kind === "spot" ? { sub: "again" } : {}) });
  const pc = prev?.cue;
  if (pc?.j != null && pc.j >= ph.j0 && pc.j < ph.j1) {
    if ((pc.kind === "pitch" || pc.kind === "missed") && !fit.key.kind && clean(pc.j)) wins.push({ kind: "fixed", sub: "note", j: pc.j }); // (in the written key)
    if (pc.kind === "timing" && st?.starts[pc.j - ph.j0]?.measured && st.starts[pc.j - ph.j0].on) wins.push({ kind: "fixed", sub: "start", j: pc.j });
  }
  if (res.up.notes || res.up.beats) wins.push({ kind: "rose", sub: res.up.notes && res.up.beats ? "both" : res.up.beats ? "beats" : "notes" });
  if (fit.key.kind && fit.hits >= F.tuneWin * counted.length) wins.push({ kind: fit.key.kind === "key" ? "key" : "tune" });
  if (counts.notesAll && !wins.some((w) => w.kind === "spot")) wins.push({ kind: "every" }); // (♪ all, not "Spot on")
  if (!fit.key.kind) {
    const byLen = (a, b) => notes[b].d - notes[a].d || b - a; // (of equal ones, the later: a line's last long note)
    const top = Math.max(...counted.map((j) => notes[j].midi));
    const high = counted.filter((j) => notes[j].midi === top).sort(byLen).find(clean);
    if (high != null) wins.push({ kind: "high", j: high });
    const longest = Math.max(...counted.map((j) => notes[j].d));
    const long = counted.filter((j) => notes[j].d >= longest - 1e-6).sort(byLen).find(clean);
    if (long != null && long !== high) wins.push({ kind: "long", j: long });
    if (clean(ph.j0)) wins.push({ kind: "first", j: ph.j0 });
  }
  const same = (w, p) => !!p && w.kind === p.kind && (w.j ?? null) === (p.j ?? null) && (w.sub ?? null) === (p.sub ?? null);
  res.win = wins.find((w) => w.kind === "spot" || !same(w, ctx.prev?.win)) || wins[0] || null;
  for (const x of [res.win, res.cue]) if (x?.j != null) x.w = wordOf(x.j, notes);
  return done(res);
}

// Beats (● Sing with the click; the fix plan's "Beats (judgeBeats)"): each start against its click — the beat
// grid less the measured trip (the count-in's clicks found in the recording), else less the browser's estimate
// with a wider band. Not rhythmOf's classes: those are against the take's own steady lead (a singer steadily
// behind the click came out "all of them"), and its onset search, centred on that lead, can't follow half a
// beat late or a tempo pulled away from the click (attacks taken from the neighbours: cues the wrong way). So
// the starts are found here where the singer's line (fitLine on the frames as heard) puts each note, and each is
// judged on its own distance from its click.
export const EAR_BEATS = {
  uncal: 0.04,     // s more tolerance when the trip wasn't measured (headphones: the browser's estimate)
  missing: 0.2,    // a start whose own note's span is voiced under this share (and not hit) wasn't sung:
                   //   "Sing out on …", never early or late (an onset borrowed from the next note)
  iqr: 2,          // × tolOn(u): starts this close together keep one lag — steady behind / ahead
  driftBeat: 0.25, // a drift over the line ≥ max(tolFlag, this × the beat): slowing down / speeding up
  driftMin: 4,     //   …from this many measured starts
  keep: 0.75,      // × the beat: a late entry every start keeps, under this, is behind the click — not a count off
                   //   (a whole beat late is: the count-in row's word, "start when it lights")
  run: 3,          // starts on the click in a row: "Steady from … to …"
  fitB: 0.3, fitA: 1.2, // the singer's line kept when its tempo is within this of the click's and it starts within
                   //   this many beats of the written start (else the written line: onsets near the clicks)
};
const BT = EAR_BEATS;
const quantile = (xs, p) => { const s = [...xs].sort((a, b) => a - b), x = p * (s.length - 1), i = Math.floor(x); return i + 1 < s.length ? s[i] + (x - i) * (s[i + 1] - s[i]) : s[i]; };

// The take (Sing's guided take on the line's span, as finishSing leaves it): frames on the song clock as heard
// (moved by the measured trip), grades, endT, rhythm (rhythmOf: calibrated, phrases[0].lag — the first sound
// after the count-in, takerhythm.js phraseRhythm —, notes for comparison). ctx: as judgeFree's — notes (at the
// tempo sung), spq0, name, score + qToT, feat + start (the recording's features, its first sample on the frames'
// clock: none — rhythmOf's onsets, judged on the grid all the same), prev (the last whole Beats attempt at this
// line and speed). → a result as judgeFree's: counts { beats, beatsAll } (notes null), win, cue, starts { [k]: {
// dev (s off its click, + late), on, measured, missing, kind } }, onsets, lag, steady / drift (s), calibrated,
// whole, up, rn (per note: cls on / early / late / missing, dev, rdev — dev less the median).
// Beats kinds — wins: "spot" (again) · "fixed" (sub start) · "rose" (sub beats) · "entry" (the first start on) ·
// "run" (j…j2, ≥ 3 on in a row) · "even" (a steady lag kept). Cues, the first that applies: "silent" · "slip"
// (dir: sooner / later) · "unheard" · "steady" · "held" (a step) · "drift" · "missed" · "timing"; sounds "hear" (▶ Hear with the
// click), "click" (▶ Click: the melody and the click over `range`), "you" (▶ You: the take over `at`, song s as
// heard, the click with it).
export function judgeBeats(ph, take, ctx) {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const { notes } = ctx;
  const bctx = { ...ctx, beats: true, ph };
  const done = (r) => { r.ms = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0); if (r.win) r.win.text = winText(r.win, bctx); if (r.cue) r.cue.text = cueText(r.cue, bctx); for (const x of [r.win, r.cue]) if (x?.j != null) x.w = wordOf(x.j, notes); return r; };
  const rh = take.rhythm || null, pr = rh?.phrases?.[0] || null;
  const js = phraseJs(ph), T0 = notes[ph.j0].t;
  const { counted, starts } = countSets(ph, notes, ctx.spq0);
  const cal = !!rh?.calibrated;
  // the meter on the click (each start's division u, the beat), the bar the line starts in
  const met = ctx.score && ctx.qToT ? metricOf(ctx.score, js.map((j) => notes[j]), [js.map((_, k) => k)], ctx.qToT) : null;
  const uOf = (k) => met?.[k]?.u ?? rh?.notes?.[js[k]]?.u ?? 0.3;
  const beat = (met ? median(starts.map((j) => met[j - ph.j0].beat)) : null) ?? pr?.beat ?? 0.6;
  const extra = cal ? 0 : BT.uncal;
  const tolOf = (k) => tolFlag(uOf(k)) + extra;
  const uMed = median(starts.map((j) => uOf(j - ph.j0)));
  const tolM = tolFlag(uMed) + extra;
  const endT = take.endT ?? Infinity;
  const frames = (take.frames || []).filter((f) => f.t >= T0 - beat - 0.3);
  const rn0 = (j) => rh?.notes?.[j] || null;
  const nothing = { counts: null, win: null, starts: null, onsets: null, whole: false, up: { notes: false, beats: false }, calibrated: cal, lag: pr?.lag ?? null, steady: null, drift: null };
  if (frames.filter((f) => f.midi != null).length < 6) return done({ ...nothing, rn: rnOf(ph, js, {}, rn0), cue: { kind: "silent", sounds: [] } });
  // the take ran past where each start could be
  const reached = new Set(js.filter((j) => notes[j].t + Math.min(0.35, notes[j].d) < endT));
  // where the singer's line puts each note (their pitch: a steady lag, a tempo pulled from the click)
  const written = { a: T0, b: 1, ns: js.map((j) => ({ midi: notes[j].midi, t: notes[j].t, d: notes[j].d })) };
  let fit = null;
  try { fit = fitLine(ph, frames, endT, ctx); } catch (err) { console.warn("ear: beats line", err); }
  const line = fit && !fit.edge && Math.abs(fit.b - 1) <= BT.fitB && Math.abs(fit.a - T0) <= BT.fitA * beat && fit.hits >= Math.ceil(counted.length / 3) ? fit : written;
  const g = gradeTake(line.ns.map((n) => ({ midi: n.midi, t: n.t, d: n.d })), frames, { endT, maxShift: F.gradeShift });
  // a start not sung: its own note's span hardly voiced (the vowel band; no recording: the pitch frames), not hit
  const spans = js.map((_, k) => [line.ns[k].t, line.ns[k].t + line.ns[k].d]);
  const cover = ctx.feat && ctx.start != null ? voiceCover(ctx.feat, ctx.start, { songT0: 0, trip: 0, quiet: [-Infinity, T0 - beat] }, spans)
    : spans.map(([a, b]) => { const w = frames.filter((f) => f.t >= a && f.t < b); return w.length ? w.filter((f) => f.midi != null).length / w.length : 0; });
  const missing = new Set(starts.filter((j) => reached.has(j) && cover[j - ph.j0] < BT.missing && !hitOf(g[j - ph.j0])));
  const m = measureStarts(ph, line, g, frames, endT, ctx, starts, reached, js.map((j) => !reached.has(j) || missing.has(j)));
  const S = {};
  for (const j of starts) {
    const k = j - ph.j0;
    if (!reached.has(j)) { S[k] = { reached: false, on: false, measured: false, dev: null }; continue; }
    if (missing.has(j)) { S[k] = { reached: true, missing: true, on: false, measured: false, dev: null }; continue; }
    let dev = null, kind = null;
    if (m) { const o = m.out[k]; if (o?.measured) { dev = o.y - notes[j].t; kind = o.kind; } }
    else { const r = rn0(j); if (r?.cls) { dev = r.dev; kind = r.kind; } }
    S[k] = { reached: true, measured: dev != null, dev, kind, tol: tolOf(k) };
  }
  const live = starts.filter((j) => S[j - ph.j0].reached && !S[j - ph.j0].missing);
  const meas = live.filter((j) => S[j - ph.j0].measured);
  const judged = live.length > 0 && meas.length * 2 >= live.length;
  const devs = meas.map((j) => S[j - ph.j0].dev);
  const med = devs.length ? median(devs) : null;
  // steady: every start about the same distance off its click, one way
  const iqr = devs.length >= 3 ? quantile(devs, 0.75) - quantile(devs, 0.25) : Infinity;
  const steady = judged && devs.length >= 3 && Math.abs(med) > tolM && iqr <= BT.iqr * tolOn(uMed);
  // drift: the distance from the click growing (slowing down) or shrinking (speeding up) over the line
  const pts = meas.map((j) => [notes[j].t, S[j - ph.j0].dev]);
  const ts = pts.length >= BT.driftMin ? theilSen(pts) : null;
  const drift = ts ? ts.b * (pts[pts.length - 1][0] - pts[0][0]) : null;
  // (…or a step: on the click, then from one start on all off the same way — the note before it held long or cut
  // short, the click's beat kept after it: that note, not "slowing down")
  // (at least two starts before it, on their clicks: a late entry alone, the rest on the click, is the entry's)
  const step0 = judged && !steady ? stepIn(meas.map((j) => [notes[j].t, S[j - ph.j0].dev, j - ph.j0, S[j - ph.j0].tol])) : null;
  const onClick = (j) => Math.abs(S[j - ph.j0].dev) <= S[j - ph.j0].tol;
  const pre = step0 ? meas.filter((j) => j - ph.j0 < step0.k) : [], post = step0 ? meas.filter((j) => j - ph.j0 >= step0.k) : [];
  const step = step0 && pre.length >= 2 && pre.every(onClick) ? step0 : null;
  // (…the other way round — off, then from one start on all on the click: in late (early) and caught up. Those
  // starts are what to fix — the first of them — not "speeding up": the singer kept the click's tempo after it)
  const caught = !step && !!step0 && post.length >= 2 && post.every(onClick) && pre.some((j) => !onClick(j));
  const drifting = judged && !steady && !step && !caught && drift != null && Math.abs(drift) >= Math.max(tolM, BT.driftBeat * beat);
  // a counting slip: the first sound after the count-in ≥ max(0.6 beat, 0.25 s) off — unless every start kept
  // that lag and it's under ¾ of a beat (behind the click, not a count off); a lag every start keeps of ¾ beat
  // or more is a count off too
  const lag = pr?.lag ?? null;
  const need = Math.max(PRACTICE.time.slipBeats * beat, cal ? PRACTICE.time.slipSec : PRACTICE.time.slipSecUncal);
  const kept = steady && lag != null && Math.abs(med - lag) <= tolM && Math.abs(lag) < BT.keep * beat;
  const slip = lag != null && Math.abs(lag) >= need && !kept ? (lag > 0 ? "sooner" : "later") : steady && Math.abs(med) >= BT.keep * beat ? (med > 0 ? "sooner" : "later") : null;
  // each start: measured — within its tolerance of its click; sung but not measured (legato, a repeat) — on
  // when its note was hit and the measured ones were on the click
  for (const j of live) {
    const s = S[j - ph.j0];
    s.on = s.measured ? Math.abs(s.dev) <= s.tol : judged && !steady && !drifting && med != null && Math.abs(med) <= tolM && hitOf(g[j - ph.j0]);
  }
  const onN = starts.filter((j) => S[j - ph.j0].on).length;
  const counts = slip || !judged ? null : { beats: onN, beatsAll: onN === starts.length, notes: null, notesAll: false };
  const res = { counts, calibrated: cal, lag, steady: steady ? +med.toFixed(3) : null, drift: drift != null ? +drift.toFixed(3) : null, step: step ? { k: step.k, d: +step.d.toFixed(3) } : null, tol: +tolM.toFixed(3),
    line: { a: +line.a.toFixed(3), b: +line.b.toFixed(3), fit: line === fit },
    starts: Object.fromEntries(Object.entries(S).map(([k, s]) => [k, { dev: s.dev != null ? +s.dev.toFixed(3) : null, on: !!s.on, measured: !!s.measured, missing: !!s.missing, reached: !!s.reached, kind: s.kind ?? null }])),
    onsets: { measured: meas.length, of: live.length }, rn: rnOf(ph, js, S, rn0, med) };
  res.whole = !!counts && starts.every((j) => S[j - ph.j0].reached);
  const prev = ctx.prev?.whole ? ctx.prev : null;
  res.up = { notes: false, beats: !!prev && res.whole && prev.counts?.beats != null && counts.beats > prev.counts.beats };

  // --- the cue: the first that applies
  const startBefore = (j, n) => { const ss = starts.filter((x) => x < j); return ss.length >= n ? ss[ss.length - n] : ph.j0; };
  // (▶ You: the take from a beat before the stretch to past its end — and past where the singer put it)
  const at = (ja, jb) => [Math.max(notes[ja].t - beat + Math.min(0, med ?? 0), (take.voice?.start ?? -Infinity)), notes[jb].t + notes[jb].d + 0.4 + Math.max(0, med ?? 0)];
  // (a take-wide cue's stretch: the first bar from the entry, at least three starts)
  const bar = () => {
    const fb = feltBeat(meterAt(ctx.score || {}, measureAt(ctx.score || { measures: [0] }, notes[ph.j0].q)));
    const within = starts.filter((j) => notes[j].t < T0 + fb.n * beat - 1e-6);
    return Math.max(within[within.length - 1] ?? ph.j0, starts[Math.min(2, starts.length - 1)]);
  };
  let cue = null;
  if (slip) cue = { kind: "slip", j: ph.j0, dir: slip, sounds: ["hear"] };
  else if (!judged) cue = { kind: "unheard", sounds: [] };
  else if (steady) { const jb = bar(); cue = { kind: "steady", dir: med > 0 ? "sooner" : "later", range: [ph.j0, jb], at: at(ph.j0, jb), sounds: ["click", "you"] }; }
  else if (step && ph.j0 + step.k - 1 >= ph.j0) {
    const jStart = ph.j0 + step.k, held = jStart - 1;
    cue = { kind: "held", j: held, dir: step.d > 0 ? "sooner" : "later", range: [startBefore(held, 1), jStart], at: at(startBefore(held, 1), jStart), sounds: ["click", "you"] };
  } else if (drifting) cue = { kind: "drift", dir: drift > 0 ? "sooner" : "later", range: [ph.j0, ph.j1 - 1], at: at(ph.j0, ph.j1 - 1), sounds: ["click", "you"] };
  else if (missing.size) { const j = Math.min(...missing); cue = { kind: "missed", j, range: [startBefore(j, 2), j], at: at(startBefore(j, 2), j), sounds: ["click"] }; }
  else {
    const off = live.find((j) => S[j - ph.j0].measured && !S[j - ph.j0].on);
    if (off != null) cue = { kind: "timing", j: off, dir: S[off - ph.j0].dev > 0 ? "sooner" : "later", range: [startBefore(off, 2), off], at: at(startBefore(off, 2), off), sounds: ["click", "you"] };
  }
  res.cue = cue;

  // --- the win: the first that applies, not last time's again when another applies
  const wins = [];
  if (counts?.beatsAll) wins.push({ kind: "spot", ...(ctx.prev?.win?.kind === "spot" ? { sub: "again" } : {}) });
  const pc = prev?.cue;
  if (counts && pc?.j != null && pc.j >= ph.j0 && pc.j < ph.j1 && (pc.kind === "timing" || pc.kind === "missed") && S[pc.j - ph.j0]?.measured && S[pc.j - ph.j0].on) wins.push({ kind: "fixed", sub: "start", j: pc.j });
  if (res.up.beats) wins.push({ kind: "rose", sub: "beats" });
  if (counts && S[0]?.measured && S[0].on) wins.push({ kind: "entry", j: ph.j0 });
  if (counts) {
    // (whole words: a run from “ma” isn't “Steady from “Amazing”” when its “A” came in late)
    const wd = (j) => wordOf(j, notes), first = (j) => { const w = wd(j); return !w || w.w0 === w.j0; }, last = (j) => { const w = wd(j); return !w || w.w1 === w.j0; };
    let best = null, run = [];
    const close = () => { const a = run.findIndex(first); let z = run.length - 1; while (z >= 0 && !last(run[z])) z--; const r = a >= 0 && z >= a ? run.slice(a, z + 1) : []; if (r.length >= BT.run && (!best || r.length > best.length)) best = r; };
    for (const j of starts) {
      if (S[j - ph.j0].measured && S[j - ph.j0].on) run.push(j); else { close(); run = []; }
    }
    close();
    if (best) wins.push({ kind: "run", j: best[0], j2: best[best.length - 1] });
  }
  if (steady) wins.push({ kind: "even" });
  const same = (w, p) => !!p && w.kind === p.kind && (w.j ?? null) === (p.j ?? null) && (w.sub ?? null) === (p.sub ?? null);
  // (never a win that names the word the cue is about: “Steady from “Amazing”…” over “Come in sooner on “Amazing””)
  const wordKey = (j) => { const w = wordOf(j, notes); return w ? w.w0 : j; };
  const clash = (w) => cue?.j != null && [w.j, w.j2].some((j) => j != null && wordKey(j) === wordKey(cue.j));
  const ok = wins.filter((w) => !clash(w));
  res.win = ok.find((w) => w.kind === "spot" || !same(w, ctx.prev?.win)) || ok[0] || null;
  return done(res);
}
// Per note of the line, for the probes: Beats' class against the click (on / early / late / missing / null),
// dev, rdev (dev less the median of the measured starts); rhythmOf's own where Beats has none.
function rnOf(ph, js, S, rn0, med = null) {
  return Object.fromEntries(js.map((j) => {
    const k = j - ph.j0, s = S[k];
    if (s) return [k, { cls: s.missing ? "missing" : !s.measured ? null : s.on ? "on" : s.dev > 0 ? "late" : "early", dev: s.dev, rdev: s.dev != null && med != null ? +(s.dev - med).toFixed(3) : null }];
    const r = rn0(j);
    return [k, r ? { cls: null, dev: r.dev, rdev: r.rdev } : null];
  }));
}

// --- Notes (D10; the fix plan's "Notes (holdVerdict)") ------------------------------------------------------
// ▶ the note (mic closed), then hold it: matched = `need` s within `tol` of it, any octave, within `window` s of the
// mic opening (the range test's rule) — the mic gated at MIN_RMS until the note's sound is gone (sing.js). A miss
// says which way only from the 2nd (Q-C: the ear tries first), and how far; far from every octave of it, "another
// note"; with nothing near it at all, the hold ends early.
export const EAR_HOLD = {
  need: 0.8,        // s within `tol` (any octave), added up: matched
  window: 6,        // s from the mic opening: not matched
  tol: 50,          // ¢
  near: 100,        // ¢: a hold with (next to) none of its voiced frames this near the note, in any octave, …
  giveUp: 2.5,      //   …ends after this long voiced (a miss: no point waiting out the 6 s)
  nearShare: 0.03,  //   (this share near is "none": a stray reading)
  recent: 2,        // s: a miss is judged on the voiced frames of its last this long (where the singer settled)
  heard: 0.3,       // s voiced: under it, not heard
  another: 4,       // semitones: further than this from every octave of the note — another note, not a direction
  touch: 70, much: 250, // ¢: a miss's size — a touch / (plain) / much
  close: 50,        // ¢: the miss's centre this near, yet not held long enough on it — "keep it going"
  along: 3,         // misses: then ▶ Sing along and Next note ›, and on the line's top / bottom note the key offer
};
const H = EAR_HOLD;

// Notes' targets for a line (offsets in it, in the order they're drilled): the notes the last Line attempt sang
// off or didn't sing (its `drill`: the cue's first, then the longest — ≤ 3), then the lowest and the highest — one
// per pitch. off: the targets that came from that attempt ("Off last time"); lo / hi: the line's lowest and highest
// pitch (the first note on each). midiOf(j): the note as it sounds (transposed).
export function noteTargets(ph, notes, last = null, midiOf = (j) => notes[j].midi) {
  const ks = phraseJs(ph).map((j) => j - ph.j0), m = (k) => midiOf(ph.j0 + k);
  const lo = ks.reduce((a, k) => (m(k) < m(a) ? k : a), ks[0]);
  const hi = ks.reduce((a, k) => (m(k) > m(a) ? k : a), ks[0]);
  const targets = [], off = [];
  const add = (k, isOff) => { if (k == null || k < 0 || k >= ks.length || targets.some((x) => m(x) === m(k))) return false; targets.push(k); if (isOff) off.push(k); return true; };
  for (const k of last?.drill || []) if (off.length < 3) add(k, true);
  add(lo, false);
  add(hi, false);
  return { targets, off, lo, hi };
}

// A hold, frame by frame: holdStep(h, dt (s since the last frame), dev (sung − the note's written pitch, semitones;
// null: no pitch)) → h.end: null (go on) | "match" | "miss".
export function holdStart() { return { t: 0, good: 0, voiced: 0, nv: 0, near: 0, fr: [], end: null }; }
const foldS = (x) => x - 12 * Math.round(x / 12); // (−6…6 semitones: the nearest octave of the note)
export function holdStep(h, dt, dev) {
  if (h.end) return h;
  h.t += Math.max(0, dt || 0);
  if (dev != null && Number.isFinite(dev)) {
    const c = Math.abs(foldS(dev)) * 100;
    h.voiced += dt || 0;
    h.nv++;
    h.fr.push({ t: h.t, dev, in: c <= H.tol });
    if (c <= H.tol) h.good += dt || 0;
    if (c <= H.near) h.near++;
  }
  if (h.good >= H.need - 1e-9) h.end = "match";
  else if (h.voiced >= H.giveUp && h.near <= H.nearShare * h.nv) h.end = "miss";
  else if (h.t >= H.window) h.end = "miss";
  return h;
}

// Where a hold sat against the note (its last `recent` s voiced): r — semitones from the note's nearest octave (a
// circular centre, then the median around it: an octave jump of the pitch reading doesn't move it), k — that
// octave (… −1: an octave down).
function holdCentre(fr) {
  if (!fr.length) return null;
  const end = fr[fr.length - 1].t, xs = fr.filter((f) => f.t >= end - H.recent);
  let sx = 0, sy = 0;
  for (const f of xs) { const a = (foldS(f.dev) / 12) * 2 * Math.PI; sx += Math.cos(a); sy += Math.sin(a); }
  const c = (Math.atan2(sy, sx) / (2 * Math.PI)) * 12;
  const r = c + median(xs.map((f) => foldS(f.dev - c)));
  return { r, k: Math.round(median(xs.map((f) => f.dev - r)) / 12) };
}

// What a hold came to (h.end set): { kind, text, … } — kind "match" (oct: the octave it was matched in, semitones
// from the written note — 0, −12 …; said: "lower" | "higher" when that isn't the octave the note was played in,
// refOct) · "silent" · "close" (its centre on the note, not held long enough: "keep it going", any try) · "notyet"
// (the 1st miss: no direction yet) · "dir" (dir "higher" | "lower", size "touch" | "plain" | "much") · "another" (further than `another`
// from every octave of it). tries: the misses at this note, this one included. From the `along`-th: along (▶ Sing
// along), next (Next note ›), and — sung low on the line's top note (top), high on its bottom one — key { dir:
// "lower" | "higher" (the song), s (semitones) }: "Too high for now?" / "Too low for now?".
export function holdVerdict(h, { tries = 1, top = false, bottom = false, refOct = 0, name = null } = {}) {
  if (h.end === "match") {
    const ins = h.fr.filter((f) => f.in), k = ins.length ? Math.round(median(ins.map((f) => f.dev)) / 12) : 0, oct = 12 * k;
    const said = oct < refOct ? "lower" : oct > refOct ? "higher" : null;
    return { kind: "match", oct, said, text: said ? `✓ Same note, in your ${said} voice` : `✓ ${name ? name(oct) : "That's it"}` };
  }
  const v = { tries, along: tries >= H.along, next: tries >= H.along, key: null };
  const at = h.voiced >= H.heard ? holdCentre(h.fr) : null;
  if (!at) return { ...v, kind: "silent", text: "Didn't hear you — sing a bit louder" };
  const r = +at.r.toFixed(2), c = Math.abs(r) * 100;
  // (on the note, not long enough: no direction to give — any try)
  if (c < H.close) return { ...v, kind: "close", r, text: "Close — keep it going" };
  if (tries < 2) return { ...v, kind: "notyet", r, text: "Not yet" };
  if (Math.abs(r) > H.another) return { ...v, kind: "another", r, text: "That's another note" };
  const dir = r > 0 ? "lower" : "higher", size = c < H.touch ? "touch" : c > H.much ? "much" : "plain";
  const text = `${size === "touch" ? "A touch " : size === "much" ? "Much " : ""}${size === "plain" ? dir[0].toUpperCase() + dir.slice(1) : dir}`;
  if (v.along && ((top && dir === "higher") || (bottom && dir === "lower"))) v.key = { dir: dir === "higher" ? "lower" : "higher", s: Math.max(1, Math.min(6, Math.round(Math.abs(r)))), text: dir === "higher" ? "Too high for now?" : "Too low for now?" };
  return { ...v, kind: "dir", r, dir, size, text };
}

// --- The store (the fix plan's Data: sing.js resonate.sing.eardata, device-only) -------------------------
// Per song: { v: 1, p (the line open: its wk), pi, oct, sp, own: [{ j0, j1, wk }] (Pick words: the singer's own
// lines), ph: { [wk]: { h (▶ Hear played it: at), hk (in that key), a: [attempts], sec: { b, n } (secure) } } } — a line's record by its wk
// (music + words: a repeat shares it, a transpose keeps it). An attempt is a whole one Ear could count (heard,
// followed, sung to the end — a silent one, one it couldn't follow or one stopped early isn't "last time"):
// { at, k: "line" | "beats", sp (the ♩ menu's rate), tr (the key), b / n (♩ / ♪ counts; absent: not judged),
// ab / an (all of them), w (the win: { kind, k (its note's offset in the line), k2, sub }), c (the cue: { kind, k,
// dir, size, s, end, other }) } — the last `keep` of each kind.
export const EAR_STORE = {
  keep: 6,           // attempts kept per line and kind
  secure: 2, of: 3,  // secured (D6): "all" in `secure` of the line's last `of` counting attempts (♪: Line; ♩: Line and Beats)
  heard: 3 * 3600e3, // ms: a line heard (▶ Hear) this long ago still counts as heard — "Now ● Sing" (a session, as practice's)
  own: 20,           // own lines kept per song
  ownMax: 16,        // syllables at most in an own line (two printed lines' worth: Ear's lines are ≤ 8)
};
const ST = EAR_STORE;
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== false));
// An attempt for the store (res: judgeFree's / judgeBeats's; ph: its line), or null (not one to keep).
export function attemptOf(res, ph, { at = Date.now(), kind = res?.kind, rate = 1, tr = 0 } = {}) {
  if (!res?.whole || !res.counts || !ph) return null;
  const off = (j) => (j == null ? null : j - ph.j0), c = res.counts, w = res.win, q = res.cue;
  return compact({
    at, k: kind, sp: rate, tr,
    b: c.beats ?? null, ab: !!c.beatsAll, n: kind === "line" ? c.notes ?? null : null, an: kind === "line" && !!c.notesAll,
    w: w ? compact({ kind: w.kind, k: off(w.j), k2: off(w.j2), sub: w.sub ?? null }) : null,
    c: q ? compact({ kind: q.kind, k: off(q.j), dir: q.dir ?? null, size: q.size ?? null, s: q.s ?? null, end: q.end ?? null, other: q.other ?? null }) : null,
  });
}
// The line's record with this attempt added (the last `keep` of its kind kept).
export function addAttempt(rec, e) {
  const a = [...(rec?.a || []), e], keep = [], n = {};
  for (let i = a.length - 1; i >= 0; i--) if ((n[a[i].k] = (n[a[i].k] || 0) + 1) <= ST.keep) keep.unshift(a[i]);
  return { ...(rec || {}), a: keep };
}
// Secured (D6): { beats, notes } — "all" in 2 of the last 3 attempts that counted it.
export function securedOf(rec) {
  const a = rec?.a || [];
  const of = (judged, all) => { const xs = a.filter(judged).slice(-ST.of); return xs.filter(all).length >= ST.secure; };
  return { beats: of((x) => x.b != null, (x) => !!x.ab), notes: of((x) => x.k === "line" && x.n != null, (x) => !!x.an) };
}
// The record with its marks: sec { b (♩), n (♪): when it was first secured } — a mark once earned stays (v76's
// rule: what the singer has done isn't taken back by a bad day).
export function secure(rec, at = Date.now()) {
  const s = securedOf(rec), sec = { ...(rec?.sec || {}) };
  if (s.beats && !sec.b) sec.b = at;
  if (s.notes && !sec.n) sec.n = at;
  return Object.keys(sec).length ? { ...rec, sec } : rec;
}
// An attempt back as a result (the counts, the win, the cue — the notes where they are now in line ph) …
function resOf(e, ph) {
  const j = (k) => (k == null ? null : ph.j0 + k), inLine = (k) => k == null || (k >= 0 && ph.j0 + k < ph.j1);
  const w = e.w && inLine(e.w.k) && inLine(e.w.k2) ? compact({ kind: e.w.kind, j: j(e.w.k), j2: j(e.w.k2), sub: e.w.sub }) : null;
  const c = e.c && inLine(e.c.k) ? compact({ kind: e.c.kind, j: j(e.c.k), dir: e.c.dir, size: e.c.size, s: e.c.s, end: e.c.end, other: e.c.other }) : null;
  return { counts: { beats: e.b ?? null, beatsAll: !!e.ab, notes: e.n ?? null, notesAll: !!e.an }, win: w, cue: c, whole: true };
}
// … as judgeFree's / judgeBeats's ctx.prev: the last whole attempt here of that kind at that speed (rate), or null.
export function prevFrom(rec, kind, rate, ph) {
  const e = (rec?.a || []).filter((x) => x.k === kind && Math.abs((x.sp ?? 1) - rate) < 1e-9).pop();
  if (!e) return null;
  const r = resOf(e, ph);
  return { counts: r.counts, whole: true, win: r.win && { kind: r.win.kind, j: r.win.j ?? null, sub: r.win.sub ?? null }, cue: r.cue && { kind: r.cue.kind, j: r.cue.j ?? null } };
}
// … as "Last time" (earText old): the latest attempt here of that kind sung in this key, or null.
export function lastFrom(rec, kind, tr, ph) {
  const e = (rec?.a || []).filter((x) => x.k === kind && (x.tr ?? 0) === tr).pop();
  return e ? { ...resOf(e, ph), kind, tr, rate: e.sp ?? 1, at: e.at, stored: true } : null;
}

// Pick words (D2 "your own"): the words of notes [j0, j1) — [{ j0, j1 (through the note before the next word's:
// its syllables and their held notes), text }]; a song without words: a note each, named by `name(j)`.
export function wordTokens(notes, j0, j1, name = (j) => String(j)) {
  const words = notes.some((n) => n.text), out = [];
  let cur = null;
  for (let j = j0; j < j1; j++) {
    const n = notes[j];
    const cont = cur && (words ? !n.text || n.melisma || (cur.open && /^(middle|end)$/.test(n.syllabic || "")) : false);
    if (!cont) {
      if (cur) out.push(cur);
      cur = { j0: j, j1: j + 1, text: words ? (n.text || "").replace(/[-‿]/g, "").trim() : name(j), open: false };
    } else {
      cur.j1 = j + 1;
      if (n.text && !n.melisma) cur.text += n.text.replace(/[-‿]/g, "").trim();
    }
    if (words && n.text && !n.melisma) cur.open = /^(begin|middle)$/.test(n.syllabic || "");
  }
  if (cur) out.push(cur);
  return out.filter((t) => !words || t.text).map(({ open, ...t }) => t); // (a held note before the first word: not a word)
}
// An own line from word a to word b of `tokens` (a ≤ b): its notes [j0, j1), or null — ≥ 2 words, at most
// `ownMax` syllables (a note that isn't a held one).
export function ownSpan(notes, tokens, a, b) {
  if (a == null || b == null || b <= a || !tokens[a] || !tokens[b]) return null;
  const j0 = tokens[a].j0, j1 = tokens[b].j1;
  let syl = 0;
  for (let j = j0; j < j1; j++) if (!notes[j].melisma) syl++;
  return syl > ST.ownMax ? null : { j0, j1, syl };
}

// A result as resonateDebug() shows it: everything but the recording and the fitted notes (the grades,
// per note in the line, instead).
export function debugRes(res) {
  if (!res) return null;
  const { voice, fit, songT0, ...rest } = res;
  return { ...rest, fit: fit ? { a: fit.a, b: fit.b, off: fit.off, anchor: fit.anchor, ...(fit.refit ? { refit: true } : {}), ...(fit.look ? { look: true } : {}) } : null, grades: fit?.g?.map((x) => x && { status: x.status, dev: x.dev, shift: x.shift }) };
}
