# Engine accuracy loop (roadmap D)

The owner (2026-11-20): compare every converted song with its PDF, look for discrepancies, reproduce them natively,
patch the engine, bump the engine version — repeat until there are none.

## The pipeline (all owner material stays outside the repo)
1. **PDFs:** the Resonate connector's `get_score_pdf`, page by page, joined with `pdfunite` →
   `/home/user/sitetest/<slug>.pdf` (killing, stumblin, gybr, songbird, pianoman, longesttime, toosweet, wichita,
   yellowsub — 73 pages).
2. **Native conversion** with the site's engine: the browser's TIFF (`tools/mktiff.cjs`) → native Audiveris built from
   omr-build (JDK 25 at /home/user/jdk, `build.sh` steps; the clone + install dirs in the session scratchpad), the web's
   constants (`indentations=false`, `useParallelism=false`: `tools/accuracy/constants.sh`, checked against the worker by
   the fast tier). Script: `tools/accuracy/acc-native.sh` (SP=, JDK=, INST=, OUT=; `acc-trace.sh` the same with the
   0009 trace; `ab.sh` an install against another; `env.sh` says where things are).
3. **Pairs:** `tools/accuracy/pairs.cjs <slug>` — the song stored in a fresh local profile with its PDF and pages, Play
   opened (Full score, names off), and per PDF system: Resonate's drawing (`scoreCrop`), the same bars on the PDF
   (`pdfCrop`) and the notes as text (`focusData`). 246 systems over the 9 songs; Piano Man's 5 boxed fills have no
   score picture (the clean-ups drop them on purpose).
4. **Comparison:** a workflow, one vision agent per 4 systems, structured findings (bar, staff, kind, PDF vs Resonate,
   plays wrong?, confidence; never lyric text) → a triage agent groups them into patterns (`triage.md` in the
   scratchpad's `acc/`).
5. **Fix:** per pattern, root-cause natively (trace / .omr / logs), patch (omr-build/patches/00NN) or a clean-up
   (public/omr/fixscore.js), A/B on all 9 songs (every changed bar checked against the PDF; rerun the base when a
   difference looks random — the engine varies a dot between runs), then build the jars, bump `ENGINE` and `ENGINE_N`,
   ship, and the owner reconverts ("Reconvert all").

## Round 1 (2026-11-20, engine v10)
The comparison is done: 489 findings (365 play wrong) in 35 patterns. Triage with every finding's list:
scratchpad `acc/triage.md` (tools: `tools/accuracy/triage/`; the bar tools `cmp.py`, `bar.py`, `short.py`,
`voicecheck.py` beside them). It is not in the repo: it names bars of the owner's songs.
Its P1 patterns and where each stands:
- 1 + 4, phantom / merged hollow heads (HEADS, `evalBlackAsVoid`?), 146 findings: an engine agent, own worktree
  `audiveris-heads` (branch heads-void, from keys-heads-ledgers).
- 2 + 3, ties lost across breaks and barlines, 70 findings: an engine agent, `audiveris` (branch tie-0014).
- 5 + 6 + 16 + 17, restoreTies / markUnmarkedTuplets / playprep, 30 findings: a web agent, in the repo.
- 7 + 9 (+ 10), whole notes, half-note chords on ledgers, gybr / Wichita keys: patches 0011–0013 (committed,
  not built). The Stumblin' In duet (cue-size second voice) is not fixable without cue heads.
Next, once those land: one engine release. Renumber the patches, run a combined A/B on all 9 songs, build.sh, bump `ENGINE` +
`ENGINE_N`, run the browser e2e, one review, deploy. Then the owner runs Reconvert all, and round 2 (the triage's P2
patterns: 8 small notes, 11 navigation marks, 12 dots, 13 flags, 14 melisma syllables) runs on the new conversions.

### Round 1 as built (2026-11-21)
- Engine 15 = patches 0011–0015 (keys, whole notes, ledgers, ties, phantom heads), built by build.sh
  (ENGINE 816cc6c-ffd097d7-cj4.2, ENGINE_N 15). The combined native run (scratchpad `acc/r15/`) equals the sum of the
  patches' own runs: n14→r15 matches b13→heads3, and heads3→r15 matches b13→n14 (bar counts, a dot of noise).
- Clean-ups (de820b7): restoreTies pairs notes and carries accidentals, the tuplet run skips a tied-in note, a duet
  partner's own staff in the Full score.
- Left for round 2: pattern 4 (cue-size second voices: Stumblin' In's duet, Too Sweet's thirds — needs cue-head
  detection), the P2/P3 patterns. Round 2 starts from the owner's songs reconverted with engine 15.

## Round 2 (2026-11-21, engine 15)
- Pairs: scratchpad `acc/pairs15/` (from the native engine-15 exports `acc/r15/`; script `pairs15.sh`, now `tools/accuracy/pairs-run.sh <slug>…` with RUN=r15 PAIRS=pairs15; 246 systems; the
  clean-ups as of de820b7).
- Comparison + triage against round 1: workflow script `accuracy-review-r2.js` (session workflows folder;
  a copy in the repo, `tools/accuracy/review-workflow.js`, takes the pairs folder as `args.dir`), run wf_a9cfed85-67b. Resume it with `resumeFromRunId` and the same args if it's stopped. The triage goes to `acc/triage15.md`.

### Round 2 results (2026-11-21)
- **Counts:** 328 findings (211 play wrong), against round 1's 489 (365). 193 of round 1's are fixed: every phantom head, key miss and tie-as-slur, most whole notes and page-turn ties. The patches caused no regression.
- **Flaky dots:** 5 bars that got worse are chord dots the engine assigns differently from run to run (9 bars flip across 14 builds).
- **Triage:** scratchpad `acc/triage15.md` (with `triage15/` tools).
- **Round 2's P1 patterns, in progress:**
  - 1. stacked chord dots lost, nondeterministically (20 findings): **done** — patches 0016 (a chord's dots checked top down; the engine's exports are now the same run to run) and 0018 (a chord dotted on half its heads is dotted), committed (d91b1df), not built. 20 → 1 left (Songbird 121) + 1 new (Songbird 43's G2). Branch `r2-dots-half` in `aud-dots`, install `inst-dots-half`, run `acc/h1` = the base for what follows.
  - 2. ties still lost, mostly within a system (56): engine agent, worktree `aud-ties` (branch r2-ties), patch 0017, plus any restoreTies case.
  - 3. cue-size heads (66) + 8 grace notes: engine agent, worktree `aud-cue` (branch r2-cue from r2-dots-half): the `smallHeads` switch A/B first, then a patch 0019 if merges persist.
- **Later:** the P2s (flags, Piano Man's LH octaves, navigation marks, melisma syllables, grace notes).
