# Engine accuracy loop (roadmap D)

The owner (2026-11-20): compare every converted song with its PDF, look for discrepancies, reproduce them natively,
patch the engine, bump the engine version — repeat until there are none.

## The pipeline (all owner material stays outside the repo)
1. **PDFs:** the Resonate connector's `get_score_pdf`, page by page, joined with `pdfunite` →
   `/home/user/sitetest/<slug>.pdf` (killing, stumblin, gybr, songbird, pianoman, longesttime, toosweet, wichita,
   yellowsub — 73 pages).
2. **Native conversion** with the site's engine: the browser's TIFF (`tools/mktiff.cjs`) → native Audiveris built from
   omr-build (JDK 25 at /home/user/jdk, `build.sh` steps; the clone + install dirs in the session scratchpad), the web's
   constants (`indentations=false`, `useParallelism=false`). Script: scratchpad `bin/acc-native.sh` (INST=, OUT=).
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
scratchpad `acc/triage.md` (tools in scratchpad `triage/`). It is not in the repo: it names bars of the owner's songs.
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
