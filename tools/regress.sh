#!/bin/bash
# Sing page regression suite with guided practice off; prints one line per test.
# Then the Play page: play.cjs (spec §8 checks at 8 sizes + bug hunts; the owner's converted scores
# from PLAY_SCORES when that folder exists — never copied into the repo), playheaders.cjs (every
# page's header), playfixes.cjs (the checks added with the adversarial review's fixes),
# playscore.cjs (the Full score view, v78; its WebKit part when WebKitWebDriver is up),
# playpaper.cjs (v79: the printed-density default, − / +, spreads, turns from ‹ › only),
# playback.cjs (v79: ▶ — a dragged stretch once / ⟳, from the page in Sing's order, lit notes, auto
# turns, stops), playbackfixes.cjs (v79: one check per finding of the ▶ / density review round),
# playpeekstaff.cjs (a press sounds every voice struck on that staff then), playpress.cjs (v80: a press
# strikes in its own pointerdown, every finger its own strike, keep-awake, the session set once, an
# iOS-like gate, the lag measured), playkeys.cjs (v80: the keyboard docked under the music — 🎹, its
# defaults, the music never under it, it never moves or hides), playhear.cjs (v80: what ▶ plays —
# the chips per view, muted parts not struck, levels, kept per song / view, a change while playing,
# lit lighter, presses unaffected, the keyboard-off home), playv80fixes.cjs (v80: one check per
# finding of the v80 review round — a key another finger holds, no keyboard without its button, the
# PDF drawn once, the dock through a load, the chips leave the keys room, the view menu with 📄, a
# chip just before a muted note, no page kept by a press), playchords.cjs (v86: chord names under the
# piano, the stretch's controls steady while ▶ plays, muted parts unlit, the keyboard pressable, asleep
# in the background; the bar vs a v85 copy at HEAD_BASE), tiecases.cjs (fixscore's
# restoreTies: ties the engine missed, wrote half or read as slurs)
# and reader.cjs (PDF → Song's Reader: the reducer on every fixture, 10× replays on an iPhone and an
# iPad both ways — minimize/expand, hidden tab, resume, reduced motion, long tasks; no screenshots here)
# and, when WebKitWebDriver is up on :4444 (/home/user/xb), the WebKit smokes (playwebkit.mjs,
# playbackwk.mjs, playpresswk.mjs, playhearwk.mjs).
cd /home/user/tools
for t in loop loopguard review perform playafter lasttake chipkeys taptiming rhythmpage iosgate stuckctx pitchmon ahead countin unlock; do
  out=$(timeout 600 node -r ./guidedoff.cjs $t.cjs 2>&1); code=$?
  fails=$(echo "$out" | grep -c "FAIL\|✗")
  errs=$(echo "$out" | grep -i "errors: \[\]\|no page errors" | head -1)
  echo "$t exit=$code fails=$fails $(echo "$out" | grep -E 'FAIL|✗' | head -2 | tr '\n' ' ')"
done
SCORES=${PLAY_SCORES:-/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad/play/scores}
[ -d "$SCORES" ] || SCORES=""
for t in play playheaders playfixes playscore playpaper playback playbackfixes playpeekstaff playpress playkeys playhear playv80fixes playchords tiecases; do
  out=$(PLAY_SCORES="$SCORES" timeout 1800 node $t.cjs 2>&1); code=$?
  fails=$(echo "$out" | grep -c "^FAIL")
  echo "$t exit=$code fails=$fails $(echo "$out" | grep -E 'passed' | tail -1) $(echo "$out" | grep -E '^FAIL' | head -2 | cut -c1-200 | tr '\n' ' ')"
done
for fx in greensleeves greensleeves3-real; do # (synthetic with clean-ups; the real recorded Chromium run)
  out=$(FX=$fx SHOTS=0 timeout 1200 node reader.cjs 2>&1); code=$?
  echo "reader $fx exit=$code fails=$(echo "$out" | grep -c '^FAIL') $(echo "$out" | grep -E 'passed' | tail -1) $(echo "$out" | grep -E '^FAIL' | head -2 | cut -c1-200 | tr '\n' ' ')"
done
if curl -s -m 2 http://127.0.0.1:4444/status >/dev/null 2>&1; then
  for t in playwebkit playbackwk playpresswk playhearwk; do
    out=$(DISPLAY=:99 timeout 300 node $t.mjs 2>&1); code=$?
    echo "$t exit=$code fails=$(echo "$out" | grep -c '^FAIL') $(echo "$out" | grep -E '^FAIL' | head -2 | tr '\n' ' ')"
  done
  out=$(DISPLAY=:99 timeout 900 node readerwk.mjs 2>&1); code=$? # (the Reader in WebKitGTK: three fixtures to the end)
  echo "readerwk exit=$code fails=$(echo "$out" | grep -c '^FAIL') $(echo "$out" | grep -E '^FAIL' | head -2 | tr '\n' ' ')"
else
  echo "playwebkit skipped (no WebKitWebDriver on :4444)"
fi
# PDF → Song engine trace (patch 0009): the saved native traces of the public-domain test scores parse,
# and their notes after PAGE match the export (tracecheck.mjs; fixtures/trace/*.trace from
# -Daudiveris.web.trace=stderr runs).
for f in fixtures/trace/*.trace; do
  out=$(timeout 60 node tracecheck.mjs "$f" "${f%.trace}.mxl" --quiet 2>&1); code=$?
  echo "tracecheck $(basename $f .trace) exit=$code $(echo "$out" | tail -1)"
done
# PDF → Song as a resumable job (v81): the trace → events parser (tracejs.mjs, against tracecheck's
# mapping on the saved traces), the job store + ENGINE id + crash-loop guard (jobstore.cjs), the title
# rules (titlecases.cjs, now in omr/importer.js); with IMPORT_E2E=1 the real conversions on pdf-import.html
# (importresume.cjs: full first — it writes the reference MusicXML and fixtures/import/greensleeves3.events.json —
# then stub1, prep, engine, crash, discard, tabs, again; ~4–8 min each), the Reader watching a real conversion with a
# reload in the middle on an iPhone and an iPad (importreader.cjs: contract, stages shot, restored at once, minimized
# kept) and the WebKitGTK smoke (importwk.mjs).
out=$(timeout 120 node tracejs.mjs 2>&1); echo "tracejs exit=$? fails=$(echo "$out" | grep -c '^FAIL') $(echo "$out" | tail -1)"
out=$(timeout 300 node jobstore.cjs 2>&1); echo "jobstore exit=$? fails=$(echo "$out" | grep -c '^FAIL') $(echo "$out" | grep '^FAIL' | head -2 | tr '\n' ' ')"
out=$(timeout 300 node titlecases.cjs 2>&1); echo "titlecases exit=$? $(echo "$out" | grep -c '"') results $(echo "$out" | grep -i 'err' | head -1)"
# The event contract (readerstate.js's header) on every recorded real run (importcontract.mjs; the Reader's
# own replay of the real run is in reader.cjs: fixtures/reader/greensleeves3-real, from importfixture.mjs).
out=$(timeout 60 node importcontract.mjs 2>&1); echo "importcontract exit=$? fails=$(echo "$out" | grep -c '^FAIL') $(echo "$out" | grep '^FAIL' | head -2 | cut -c1-200 | tr '\n' ' ')"
# The v81 import review round (importfixes.cjs: one check per finding — the failed sheet, the export's lost bars,
# the all-done resume's export, measure numbers, cut excerpts, reduceAll, the crash-loop guard per stage, files that
# fail the same way again, a hidden tab, a parked space, Sign out / sign-up / parked flags, another engine's job,
# the paused pill and its count, the facts row on an iPhone, reveals without SVG animations, the wake lock, the pill
# under sheets, a PDF kept unstored, ✕ racing a book; no engine — a scripted worker; ~2 min).
out=$(timeout 900 node importfixes.cjs 2>&1); echo "importfixes exit=$? $(echo "$out" | grep -E '^FAIL' | head -2 | cut -c1-200 | tr '\n' ' ') $(echo "$out" | tail -1)"
if [ -n "$IMPORT_E2E" ]; then
  for sc in full stub1 prep engine crash discard tabs again engineid; do
    out=$(timeout 3000 node importresume.cjs $sc 2>&1); code=$?
    echo "importresume $sc exit=$code $(echo "$out" | grep -E '^FAIL' | head -2 | cut -c1-200 | tr '\n' ' ') $(echo "$out" | tail -1)"
  done
  out=$(timeout 3600 node importreader.cjs 2>&1); code=$?
  echo "importreader exit=$code $(echo "$out" | grep -E '^FAIL' | head -2 | cut -c1-200 | tr '\n' ' ') $(echo "$out" | tail -1)"
  if curl -s -m 2 http://127.0.0.1:4444/status >/dev/null 2>&1; then
    out=$(DISPLAY=:99 timeout 2400 node importwk.mjs 2>&1); echo "importwk exit=$? $(echo "$out" | grep -E '^FAIL' | head -2 | tr '\n' ' ') $(echo "$out" | tail -1)"
  fi
fi
