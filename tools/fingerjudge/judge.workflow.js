export const meta = {
  name: 'fingering-ab-judge-round2',
  description: 'Round 2: judge the revised ALG 3 fingering against ALG 2 on the owner songs: each confirmed finding, regressions in changed bars',
  phases: [{ title: 'Judge', detail: 'one pianist-judge per song' }],
}
const SP = (args && args.sp) || 'SET-ME: the work folder/fsurvey' // (Workflow args: { sp: '<work folder>/fsurvey' })
const SONGS = ['killing', 'gybr', 'songbird', 'pianoman', 'longesttime', 'stumblin', 'toosweet', 'wichita', 'yellowsub']
const SCHEMA = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' },
      verdict: { type: 'string', enum: ['fixed', 'partly', 'unchanged', 'worse'] },
      note: { type: 'string' },
    }, required: ['id', 'verdict', 'note'] } },
    regressions: { type: 'array', items: { type: 'object', properties: {
      bar: { type: 'string' }, hand: { type: 'string', enum: ['rh', 'lh'] },
      severity: { type: 'string', enum: ['wrong', 'awkward'] },
      old: { type: 'string' }, new: { type: 'string' }, why: { type: 'string' },
    }, required: ['bar', 'hand', 'severity', 'old', 'new', 'why'] } },
    improvements: { type: 'integer', description: 'changed bars (outside the findings) where the new is clearly better' },
    neutral: { type: 'integer', description: 'changed bars that are about as good either way (position-label-only changes count here unless the label became wrong or right)' },
    summary: { type: 'string' },
  },
  required: ['findings', 'regressions', 'improvements', 'neutral', 'summary'],
}
const results = await parallel(SONGS.map((song) => () => agent(
`(Round 2 — a revised version.) You are an experienced piano teacher judging a fingering algorithm's output for an adult beginner with a small hand (a seventh comfortable, an octave at most). The algorithm was changed (version 3); judge OLD vs NEW on one song.

Files (read them with the Read tool; never quote lyrics):
- ${SP}/cmp/${song}.md — the confirmed problems a review found in the OLD fingering (GIVEN = old, BETTER = what a pianist suggested, WHY), each followed by its bars as text: "old"/"new" lines where the bar changed, "same" where it didn't.
- ${SP}/cmp/${song}-changed.md — every bar whose text changed (old line, then new line).
Format of a bar line: "Bar N — RH: @beat NOTE finger · @beat [CHORD] fingers ... — LH: ... — RH positions: thumb on X ..." (fingers 1 = thumb … 5 = little finger; chords listed low to high; positions are the five-finger hand position shown, a new one wherever it changes; "held" = a tie's continuation).

Tasks:
1. For EACH finding (### id), verdict: fixed (the new fingering does what BETTER asks or something equally good), partly, unchanged, worse. One short note.
2. Go through ${song}-changed.md. For each changed bar decide: better, neutral, or worse. List every WORSE bar as a regression (only real problems a teacher would correct: a finger crossing the wrong way, the same finger sliding in a legato line, an impossible stretch, a held note cut, needless crossings or position jumps, a wrong position label). Count improvements and neutral ones.
Be strict and concrete; judge playability, not taste. Return the structured result.`,
  { label: `judge4:${song}`, phase: 'Judge', schema: SCHEMA })))
return SONGS.map((s, i) => ({ song: s, ...(results[i] || { failed: true }) }))
