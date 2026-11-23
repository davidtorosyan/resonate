export const meta = {
  name: 'fingering-review-owner-songs',
  description: 'Pianist review of the suggested fingering on the owner\'s 9 songs, adversarially verified, grouped into algorithm changes',
  phases: [
    { title: 'Review', detail: 'one piano-teacher reviewer per song' },
    { title: 'Verify', detail: 'two skeptics per song: playability, context' },
    { title: 'Synthesize', detail: 'group confirmed findings into algorithm changes' },
  ],
}

const SP = (args && args.sp) || 'SET-ME: the work folder' // (Workflow args: { sp: '<work folder>' })
const SONGS = [
  { slug: 'killing', title: 'Killing Me Softly With His Song' },
  { slug: 'gybr', title: 'Goodbye Yellow Brick Road' },
  { slug: 'songbird', title: 'Hey, Little Songbird' },
  { slug: 'pianoman', title: 'Piano Man' },
  { slug: 'longesttime', title: 'The Longest Time' },
  { slug: 'stumblin', title: "Stumblin' In" },
  { slug: 'toosweet', title: 'Too Sweet' },
  { slug: 'wichita', title: 'Wichita Lineman' },
  { slug: 'yellowsub', title: 'Yellow Submarine' },
]

const FORMAT = `
THE FILE FORMAT (public/fingertext.js; one line a written bar):
  Bar 12 — RH: @1 [E4 G4 C5] 1 2 5 · @2.5 D5 4 · @3 C5 5 — LH: @1 C3 5 · @1 G3 1 (written on the treble staff) · @3 E3 3 — RH position: thumb on E4 — LH position: thumb on G3
- C4 = middle C. @beat = quarter notes from the bar's start, 1 = the downbeat (@2.5 = the "and" of beat 2 in 4/4).
- [ ] = keys struck together, listed low to high, the fingers in the same order (1 = thumb, 5 = little finger, for either hand).
- A tie's continuation isn't listed (the finger that struck it holds it). "RH: held" = that hand only holds through the bar.
- "– " / no finger = a grace note or a key out of reach.
- "RH positions: thumb on C4 · @4 thumb on B3" = the hand's five-finger position (where the thumb's resting key is) and where it changes (a new position = the hand moves).
- "(written on the treble staff)" = a note the other hand takes than the staff it is written on (the algorithm moves a note only where the staff's hand can't reach).
- The header line gives the tempo (♩=…), the time signature and the key (fifths: 1 = one sharp, -3 = three flats).
- The tail lists the notes moved to the other hand and the keys out of reach.
WHO IT IS FOR: an adult beginner learning to read, playing pop piano/vocal arrangements converted from PDF by OMR. Small hand by design: thumb to little finger comfortable up to a seventh, an octave at the very most; beginner weights (thumb on a black key counts double, hand jumps count double). The fingering is a SUGGESTION shown on an on-screen keyboard (digits on keys, a ghost hand of the five-finger position).
HOW IT IS MADE (docs/FINGERING.md §3, public/finger.js): Stage A assigns hands from the staves (a note moves only where the staff's hand fails); Stage B is a Viterbi over finger states per hand with Parncutt/Jacobs/Balliauw-style costs (stretch, span, finger 4, thumb/5 on black, thumb passing, same-key-other-finger, hand jump weighted by urgency = how little time there is to move).`

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'short id, e.g. "killing-1"' },
          bar: { type: 'string', description: 'bar number as in the file (first bar if a passage)' },
          bars: { type: 'string', description: 'the passage, e.g. "12" or "12-13"' },
          beats: { type: 'string' },
          hand: { type: 'string', enum: ['rh', 'lh', 'both'] },
          notes: { type: 'string', description: 'the notes concerned, as in the file' },
          given: { type: 'string', description: 'the fingering the file gives for them' },
          better: { type: 'string', description: 'the fingering a teacher would write instead' },
          why: { type: 'string', description: 'one or two sentences' },
          severity: { type: 'string', enum: ['wrong', 'awkward', 'style'], description: 'wrong = a beginner can\'t play it or will stumble; awkward = playable but a teacher would change it; style = taste' },
          pattern: { type: 'string', enum: ['thumb-or-5-on-black', 'stretch', 'crossing', 'same-finger-legato', 'repeated-note', 'needless-shift', 'missed-shift', 'chord-fingers', 'inconsistent-repeat', 'hand-split', 'melody-voicing', 'position-text', 'octaves', 'other'] },
          occurrences: { type: 'integer', description: 'how many places in this song show the same problem (1 if only this one)' },
          otherBars: { type: 'string', description: 'other bars with the same problem, comma separated (up to 10)' },
          omr: { type: 'boolean', description: 'true if the notes themselves look misread by the OMR (not a fingering problem)' },
        },
        required: ['id', 'bar', 'bars', 'beats', 'hand', 'notes', 'given', 'better', 'why', 'severity', 'pattern', 'occurrences', 'otherBars', 'omr'],
      },
    },
    good: { type: 'array', items: { type: 'string' }, description: '2-4 things the fingering does well here' },
    overall: { type: 'string', description: 'two or three sentences: how usable this fingering is for the owner, overall' },
  },
  required: ['findings', 'good', 'overall'],
}

const VERDICTS = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          real: { type: 'boolean', description: 'true only if the problem is real AND the suggested fingering is clearly better' },
          severity: { type: 'string', enum: ['wrong', 'awkward', 'style', 'none'] },
          better: { type: 'string', description: 'the fingering you would write (may differ from the reviewer\'s)' },
          note: { type: 'string', description: 'one or two sentences: why' },
        },
        required: ['id', 'real', 'severity', 'better', 'note'],
      },
    },
  },
  required: ['verdicts'],
}

const reviewPrompt = (s) => `You are an experienced piano teacher who teaches adult beginners. Review the suggested piano fingering of one song.

The song: "${s.title}". Its fingering as text: ${SP}/fsurvey/text/r19-${s.slug}.txt (read ALL of it, in chunks if needed). Its original sheet music, if you need to see a passage: /home/user/sitetest/${s.slug}.pdf (pdftoppm -r 80 -f N -l N -png into ${SP}/fsurvey/look/ — optional; bar-to-page mapping is approximate).
${FORMAT}

YOUR TASK: find the places where a teacher would correct this fingering for this pupil. Look hard at:
- thumb or 5th finger on black keys where a white-key finger was easy;
- stretches too wide for a small hand (a chord or a quick interval);
- crossings that don't work (e.g. RH crossing a finger OVER the thumb while ascending, a finger crossing in a chord, a crossing with no time);
- the same finger on two different consecutive keys in a quick or legato line;
- repeated notes: same finger at speed, or needless finger changes;
- needless hand shifts (a new position when the next notes fit the old one) and missed shifts (staying in a position that forces contortions);
- chord fingerings in an odd order or with weak fingers where strong ones fit;
- a repeated figure fingered differently each time without reason (a beginner learns one fingering for one figure);
- hand-split oddities (a note given to the other hand needlessly, or a hand left with too much);
- octaves and broken octaves (1-5 is standard; anything else needs a reason);
- the melody on top of RH chords (a 4 or 5 for the top voice is usual);
- position lines that don't fit the fingers.
Also notice what it does WELL.

Rules: judge the fingering of the notes AS GIVEN; if notes look misread by the OMR, mark omr=true (not a fingering fault). Only clear corrections — not taste — unless you mark severity "style". Prefer passages that recur (a pattern problem matters more than a one-off); give occurrences and otherBars. Up to 20 findings, most important first. Ids "${s.slug}-1", "${s.slug}-2", … Name bars and pitches only — never quote any lyrics. Edit no file in the repository /home/user/resonate.`

const verifyPrompt = (s, findings, lens) => `You are a skeptical piano teacher checking another reviewer's corrections of a suggested piano fingering. Default to real=false when in doubt.

The song: "${s.title}". Its fingering as text: ${SP}/fsurvey/text/r19-${s.slug}.txt — for each finding below, read the bars it names AND two bars before and after it.
${FORMAT}

YOUR LENS: ${lens === 'play'
  ? 'PLAYABILITY — play the given fingering in your mind at the given tempo with a SMALL hand (an octave at most, a seventh comfortable), as an adult beginner. Is it really a problem (they cannot play it, will stumble, or it hurts), or is it fine? Many "unusual" fingerings are perfectly playable.'
  : 'CONTEXT — does the suggested fingering really fit better with what comes before and after (the notes leading in, the next position, a repeat of the figure)? Often a fingering that looks odd alone is chosen because of the next notes; and a suggestion that fixes one note can break the next. Is this a correction a good teacher would write, or taste?'}

The findings (JSON):
${JSON.stringify(findings, null, 1)}

Return one verdict per finding id. real = true only if the problem is real AND a clearly better fingering exists (give it in "better"). Name bars and pitches only — never quote lyrics. Edit no file in the repository.`

phase('Review')
const reviewed = await pipeline(
  SONGS,
  (s) => agent(reviewPrompt(s), { label: `review:${s.slug}`, phase: 'Review', schema: FINDINGS }),
  async (rev, s) => {
    if (!rev) return null
    const fs = rev.findings.filter((f) => !f.omr)
    if (!fs.length) return { song: s.slug, title: s.title, review: rev, confirmed: [], plausible: [], refuted: [] }
    const [a, b] = await parallel([
      () => agent(verifyPrompt(s, fs, 'play'), { label: `verify-play:${s.slug}`, phase: 'Verify', schema: VERDICTS }),
      () => agent(verifyPrompt(s, fs, 'context'), { label: `verify-context:${s.slug}`, phase: 'Verify', schema: VERDICTS }),
    ])
    const va = new Map((a?.verdicts || []).map((v) => [v.id, v]))
    const vb = new Map((b?.verdicts || []).map((v) => [v.id, v]))
    const out = { song: s.slug, title: s.title, review: rev, confirmed: [], plausible: [], refuted: [] }
    for (const f of fs) {
      const x = va.get(f.id), y = vb.get(f.id)
      const votes = [x, y].filter((v) => v && v.real).length
      const item = { ...f, play: x || null, context: y || null }
      if (votes === 2) out.confirmed.push(item)
      else if (votes === 1) out.plausible.push(item)
      else out.refuted.push(item)
    }
    log(`${s.slug}: ${fs.length} findings → ${out.confirmed.length} confirmed, ${out.plausible.length} plausible, ${out.refuted.length} refuted (${rev.findings.length - fs.length} OMR)`)
    return out
  },
)
const songs = reviewed.filter(Boolean)
log(`reviewed ${songs.length} of ${SONGS.length} songs`)

phase('Synthesize')
const compact = songs.map((r) => ({
  song: r.song, overall: r.review.overall, good: r.review.good,
  confirmed: r.confirmed.map((f) => ({ id: f.id, bars: f.bars, beats: f.beats, hand: f.hand, notes: f.notes, given: f.given, better: f.context?.better || f.better, why: f.why, severity: f.severity, pattern: f.pattern, occurrences: f.occurrences, otherBars: f.otherBars })),
  plausible: r.plausible.map((f) => ({ id: f.id, bars: f.bars, hand: f.hand, notes: f.notes, given: f.given, better: f.better, why: f.why, pattern: f.pattern, occurrences: f.occurrences, votedReal: f.play?.real ? 'play' : 'context', dissent: (f.play?.real ? f.context?.note : f.play?.note) || '' })),
  omr: r.review.findings.filter((f) => f.omr).map((f) => ({ id: f.id, bars: f.bars, notes: f.notes, why: f.why })),
}))
const synthesis = await agent(`You are improving a piano-fingering algorithm. Pianist reviewers checked its output on 9 real songs; each correction was then checked by two independent skeptics. Below: per song, the corrections both skeptics confirmed, those only one confirmed ("plausible"), and notes that looked misread by the OMR.

Read the algorithm and its design first: /home/user/resonate/public/finger.js (all of it) and /home/user/resonate/docs/FINGERING.md §3 and "Fingering algorithm (E7 stage 1) — as built". The songs' fingering text is in ${SP}/fsurvey/text/r19-<song>.txt if you need context. The cost model and its constants (COST, SPANS) are in finger.js.

THE FINDINGS (JSON):
${JSON.stringify(compact, null, 1)}

YOUR TASK: group the confirmed (and the strongest plausible) corrections by their CAUSE in the algorithm — which cost, rule, missing rule or Stage A/B behaviour produces them — and propose concrete changes to finger.js for each group, ranked by how many confirmed findings (and occurrences) they would fix. For each change: what to change (constants, a new cost term with its formula, a rule), why it fixes the group, which findings it covers (ids), the risk (what it could make worse, which other passages to watch), and a small synthetic test case that reproduces the problem without copying the songs' music (a few notes, hand, tempo, and the expected fingering), suitable for tools/fingercases.mjs. Also list findings no algorithm change should chase (taste, OMR, one-offs that would cost more elsewhere). Do not edit any file. Name bars and pitches only, never lyrics.

Return markdown: 1) a summary table (group, cause, change, findings fixed, risk), 2) each change in detail with its test case, 3) what not to chase, 4) an overall verdict on how usable the fingering is for the owner today.`, { label: 'synthesize', phase: 'Synthesize' })

return { songs: songs.map((r) => ({ song: r.song, overall: r.review.overall, good: r.review.good, nFindings: r.review.findings.length, confirmed: r.confirmed, plausible: r.plausible, refuted: r.refuted.map((f) => ({ id: f.id, bars: f.bars, pattern: f.pattern, play: f.play?.note, context: f.context?.note })), omr: r.review.findings.filter((f) => f.omr) })), synthesis }
