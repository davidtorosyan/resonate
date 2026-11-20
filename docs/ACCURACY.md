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
First 40% of the comparison: 172 findings — ties lost (≈ 40: an eighth on the "and" of 4 tied over the barline,
often a system / page break; one head of a tied chord; a tie read as a slur; a dotted half tied to an eighth inside the
bar), accidentals (≈ 25, many the held note of a lost tie: D♯ → D), missing notes (≈ 23: whole notes on a ledger line,
an octave's upper note, a half-note chord on beat 1, a 16th after a double-dotted quarter), wrong key signatures
(gybr: 1 flat missing for bars 1–10 and 19–26, a spurious change at 15), a spurious flat on a chord's C (gybr bars 35,
50, 108, 112, 123), the voice's duet thirds read as single notes (stumblin), an 8-bar multi-measure rest dropped
(killing, known).
In progress: ties (engine, own clone) and keys + whole notes (+ voice thirds) (engine, own worktree), in parallel.
