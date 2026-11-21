export const meta = {
  name: 'accuracy-review',
  description: 'An accuracy round: compare every system the engine converted with the PDF (vision), then triage against the round before',
  phases: [{ title: 'Compare' }, { title: 'Triage' }],
}

// The accuracy loop's comparison + triage (docs/ACCURACY.md; round 2 ran it as wf_a9cfed85-67b). Run it with
// Workflow({ scriptPath: 'tools/accuracy/review-workflow.js', args }). args: dir = the pairs folder (pairs-run.sh's
// $ACC/$PAIRS: <slug>/sNN-{pdf,score}.png, sNN-notes.txt, legend.txt); counts { slug: systems }; noScore { slug: [systems] };
// round (e.g. 3); engine (what the conversions are, for the triage: "engine 19 (patches 0011–0019: …)"); prev = the
// round before's triage file in dir's parent (e.g. triage15.md); out = this round's (e.g. triage19.md).
if (!args.dir) throw new Error('args.dir: the pairs folder (e.g. <scratchpad>/acc/pairs19)')
const P = args.dir
const ROUND = args.round || 2, PREV = args.prev || 'triage.md', OUT = args.out || 'triage15.md'
const ENGINE = args.engine || 'engine 15 (patches 0011–0015: one-flat keys, stem-less whole-note heads, ledgers by small beams, ties over page turns / to the right head, phantom void heads) plus the clean-ups as of now (restoreTies pairing notes and carrying accidentals)'
const FIND = { type: 'object', properties: { systems_checked: { type: 'array', items: { type: 'integer' } }, findings: { type: 'array', items: { type: 'object', properties: {
  sys: { type: 'integer' }, bar: { type: 'string', description: 'bar number as in the notes text' }, where: { type: 'string', description: 'part / staff / voice, beat' },
  kind: { type: 'string', enum: ['pitch', 'octave', 'accidental', 'duration', 'rest', 'missing-note', 'extra-note', 'tie', 'voice', 'tuplet', 'grace', 'key', 'clef', 'time', 'barline-repeat-ending', 'navigation', 'octave-line', 'lyric-missing', 'lyric-extra', 'lyric-misplaced', 'measure-missing', 'measure-extra', 'other'] },
  pdf: { type: 'string', description: 'what the PDF prints (musical terms only — never quote lyric text)' },
  got: { type: 'string', description: 'what Resonate has (from the picture and the notes text)' },
  plays_wrong: { type: 'boolean', description: 'would a singer/player hear or sing it wrong (pitch, rhythm, missing notes) vs only look different' },
  confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
}, required: ['sys', 'bar', 'where', 'kind', 'pdf', 'got', 'plays_wrong', 'confidence'] } }, notes: { type: 'string' } }, required: ['systems_checked', 'findings'] }

// args: { dir, counts: { slug: number of systems }, noScore: { slug: [systems with no score picture] } } → batches of 4
const batches = []
for (const [slug, n] of Object.entries(args.counts)) {
  for (let i = 1; i <= n; i += 4) {
    const systems = []
    for (let k = i; k < Math.min(n + 1, i + 4); k++) systems.push({ sys: k, from: '?', to: '?', score: !((args.noScore || {})[slug] || []).includes(k) })
    batches.push({ slug, systems })
  }
}
phase('Compare')
const results = await parallel(batches.map((b, i) => () => agent(`You check an optical-music-recognition result against the printed score, system by system.
Song "${b.slug}". For each system below there are, in ${P}/${b.slug}/: sNN-pdf.png (the system on the original PDF — the truth), sNN-score.png (the same bars as Resonate draws its MusicXML; may be missing for a system the site drops on purpose — then just say so in notes) and sNN-notes.txt (Resonate's notes as text: per bar, part/staff/voice, beat, pitch with octave, value, ties ← →, rests; read ${P}/${b.slug}/legend.txt once for the format). NN is the two-digit system number. Systems: ${b.systems.map((s) => `s${String(s.sys).padStart(2, '0')} (${s.score ? 'its bars: see its notes text' : 'no score picture'})`).join(', ')}.
View both pictures of each system with the Read tool (zoom into parts by reading again if needed) and compare bar by bar, staff by staff: every note's pitch (incl. accidentals carried in the bar and the key signature) and octave, durations and dots, rests, ties, voices, tuplets, grace notes, clef/key/time changes, repeats, endings, D.S./coda/fine, 8va/8vb lines (they change sounding pitch), lyrics present / missing / under the wrong note, missing or extra notes or bars. Use the notes text to read Resonate's side exactly (the picture is the same data drawn).
NOT differences (ignore): line/system breaks and spacing, Resonate hiding a staff that rests for a whole system, chord symbols, dynamics, slurs, articulations, fingering, text directions that don't change what sounds, beam grouping and stem direction, a missing courtesy accidental when the pitch is the same, the selection's light blue band, a crop clipping a tie or word at its edge, clefs/keys missing at the start of a cut piece.
NEVER quote or paraphrase lyric text in your answer — describe lyric problems by position only (e.g. "the syllable under beat 3 of the voice is missing"). Be precise and conservative: only report what you can see; give confidence. If a system matches, report no findings for it. Final answer via the schema.`, { label: `cmp:${b.slug}:${b.systems[0].sys}-${b.systems.at(-1).sys}`, phase: 'Compare', schema: FIND })
  .then((r) => r && ({ slug: b.slug, ...r }))))

const all = results.filter(Boolean)
const findings = all.flatMap((r) => r.findings.map((f) => ({ slug: r.slug, ...f })))
log(`${findings.length} findings from ${all.length} of ${batches.length} batches`)

phase('Triage')
const triage = await agent(`You triage the differences an optical-music-recognition engine (Audiveris 5.11 + Resonate's patches, run on the owner's printed scores) produced against the printed PDFs. Here are all findings from a per-system visual comparison (JSON): ${JSON.stringify(findings)}

Pictures and notes text are in ${P}/<slug>/sNN-{pdf,score}.png / sNN-notes.txt if you need to look (NN = two-digit system). This is ROUND ${ROUND}: the conversions come from ${ENGINE}. The round before's triage is ${P}/../${PREV} — read it, and for every pattern there say fixed / partly / still there (with counts), then list NEW patterns (possible regressions: say so loudly). Context: Resonate's side = the engine's MusicXML + the site's clean-ups (public/omr/fixscore.js: ties restored, keys unified, tuplets, boxed fills dropped, octave clefs…) + Play's drawing (Verovio; Full score view). Repo /home/user/resonate (CLAUDE.md "In-browser OMR" describes every patch and clean-up).
Group the findings into PATTERNS (same root cause), e.g. "a rest shared by two voices", "a dotted note read undotted", "an accidental carried across a tie dropped", "lyric line read under the wrong staff", etc. For each pattern: a name; the kind; how many findings and songs; which findings (slug/sys/bar); whether it plays wrong; the likely layer — engine recognition (Audiveris step: HEADS, BEAMS, RHYTHMS, LINKS, TEXTS…), a Resonate clean-up, Play's drawing/prep, or uncertain; the most promising place to fix it; and a priority (impact on singing/playing × frequency × likely fixable). Drop findings you judge to be false positives (say why). Never quote lyrics. Output: a ranked markdown report (patterns first, then dropped findings), and write it also to ${P}/../${OUT}.`, { label: 'triage', phase: 'Triage' })

return { batches: batches.length, done: all.length, findings: findings.length, triage }
