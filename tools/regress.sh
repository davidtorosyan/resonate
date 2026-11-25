#!/bin/bash
# Resonate's regression run: one verdict per suite, a table at the end, exit 1 if anything failed.
#
#   tools/regress.sh fast    node only, no server (~7 min; npm test in tools/): the analysis modules (grading,
#                            tapped timing, tempo marks, coaching words, guided practice, rhythm, Ear), the engine
#                            trace, the import event contract, the sync engine against a fake cloud, the MCP
#                            catalogue, the ?v= stamps (vcheck). Run it before every push.
#   tools/regress.sh [main]  the fast tier, then the browser suites against the test server (BASE), the
#                            WebKitGTK smokes when WebKitWebDriver answers on :4444, and with IMPORT_E2E=1 the
#                            real conversions (~4–8 min each).
#
# A suite is PASS / FAIL by its exit code (a timeout, or a line starting "FAIL" under exit 0, is a FAIL too),
# SKIP when it exits 0 with "SKIP …" as its last line (lib/check.cjs done() when nothing could run), INFO when
# it only prints what it saw (chipkeys: read, not judged; a crash still fails it). Last, the checkout: a file
# a suite changed or left in it is a FAIL (compared with how it was before the run).
#
# Env: BASE (default http://localhost:8097/resonate/; most suites have it built in), PLAY_SCORES (a folder of
# the owner's converted scores — never in the repo; empty = those checks skipped), IMPORT_E2E=1, REGRESS_OUT
# (where each suite's log goes; default a new /tmp/regress-* folder).
cd "$(dirname "$0")" && cd -P . || exit 2
TIER=${1:-main}
case "$TIER" in fast | main) ;; *) echo "usage: tools/regress.sh [fast|main]"; exit 2 ;; esac
BASE=${BASE:-http://localhost:8097/resonate/}
export PLAY_SCORES=${PLAY_SCORES:-}
OUT=${REGRESS_OUT:-$(mktemp -d /tmp/regress-XXXXXX)}
mkdir -p "$OUT"
ROWS=() FAILED=0 START=$SECONDS

row() { # row <name> <verdict> <seconds> <note>
  local note=${4//$'\n'/ }; note=${note:0:160}
  ROWS+=("$1"$'\t'"$2"$'\t'"$3"$'\t'"$note")
  [ "$2" = FAIL ] && FAILED=$((FAILED + 1))
  printf '%-30s %-4s %5ss  %s\n' "$1" "$2" "$3" "$note"
}

run() { # run [--info] <name> <timeout s> <command …>
  local info=; [ "$1" = --info ] && { info=1; shift; }
  local name=$1 limit=$2; shift 2
  local log="$OUT/${name//[^A-Za-z0-9._-]/_}.log" t0=$SECONDS
  timeout "$limit" "$@" > "$log" 2>&1
  local code=$? secs=$((SECONDS - t0)) verdict note
  local last; last=$(grep -v '^[[:space:]]*$' "$log" | tail -1)
  local firstfail; firstfail=$(grep -m1 -E '^[[:space:]]*(FAIL|✗)' "$log")
  if [ $code -eq 124 ]; then verdict=FAIL note="timed out after ${limit} s"
  elif [ $code -ne 0 ]; then verdict=FAIL note="exit $code: ${firstfail:-$(grep -m1 -E 'Error|error:|Exception' "$log" || echo "$last")}"
  elif [ -n "$firstfail" ]; then verdict=FAIL note="exit 0, but: $firstfail"
  elif [[ $last == SKIP* ]]; then verdict=SKIP note=$last
  elif [ -n "$info" ]; then verdict=INFO note="printed, not judged ($log)"
  else verdict=PASS note=$last
  fi
  row "$name" "$verdict" "$secs" "$note"
}

# The checkout before the run: what's uncommitted already (and its content) is compared after.
snapshot() {
  (cd .. && git status --porcelain --untracked-files=all | while IFS= read -r l; do
    f=${l:3}; f=${f#*-> }; f=${f#\"}; f=${f%\"}
    printf '%s %s\n' "$l" "$([ -f "$f" ] && md5sum < "$f" | cut -c1-12)"
  done)
}
BEFORE=$(snapshot)

if [ "$TIER" = main ]; then
  code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$BASE")
  if [ "$code" != 200 ]; then
    echo "$BASE doesn't answer (${code:-no answer}): start tools/harness/xb/collect-serve.mjs —"
    echo "  node tools/harness/xb/collect-serve.mjs /home/user/sitetest 8097 /tmp/xbout   (CLAUDE.md: a fresh container)"
    exit 2
  fi
fi
echo "regress $TIER — logs in $OUT${PLAY_SCORES:+, PLAY_SCORES=$PLAY_SCORES}"

# ---- fast: node only -------------------------------------------------------------------------------------
run gradecases 120 node gradecases.mjs          # grade.js: in time, early, late, drifting, silent, unclear…
run timingcases 60 node timingcases.mjs         # timing.js: taps → knots → the song's map
run tempomark 60 node tempomark.mjs             # pdfprep.js tempoMark: "= 104", "in 2", music-text fonts
run coachcases 60 node coachcases.mjs           # coach.js: every verdict's words; no digits, %, fail, score
run practicecases 120 node practicecases.mjs    # practice.js: phrases, verdicts, the ladder, a 500-step fuzz
run guidedverdicts 300 node guidedverdicts.mjs  # synthetic rounds through features → grades → verdicts → words
run earcases 900 node earcases.mjs              # Ear (E8): synthetic singers → ear.js judgeFree / judgeBeats / holds; the store, Pick words (~5 min; PLAY_SCORES: the owner's songs' lines)
run rhythmcases 600 node rhythmcases.mjs        # rhythm.js on a synthetic singer (+ the guided cases)
run fingercases 120 node fingercases.mjs        # finger.js (E7): hands + fingers, R6, invariants, 3000 notes, golden
run fingersurvey 120 node fingersurvey.mjs      # finger.js on dumpkeys.cjs's Amazing Grace (+ PLAY_SCORES's dumps): invariants, every hand
run fingertextcases 60 node fingertextcases.mjs # fingertext.js / scoretext.js (E7): fingering as text for assistants; no fingering = the old text
run handcases 120 node handcases.mjs              # handplan.js (E7+): the drawn hand's plan and pose — fingers on their keys, moves in order, smooth, a window = the whole
# The engine trace (patch 0009): the saved native traces parse, their notes after PAGE match the export.
for f in fixtures/trace/*.trace; do
  run "tracecheck:$(basename "$f" .trace)" 60 node tracecheck.mjs "$f" "${f%.trace}.mxl" --quiet
done
run tracejs 120 node tracejs.mjs                # omr/trace.js = tracecheck's mapping; OCR word placement
run importcontract 60 node importcontract.mjs   # every recorded real import run against readerstate's contract
run synclib 120 node synclib.mjs                # the real sync.js against a fake cloud (offline)
run syncvol 60 node syncvol.mjs                 # a profile's volume calibration stays per device (E5), its name / range synced
run mcpcatalog 60 node --experimental-strip-types --no-warnings mcpcatalog.mjs # the frozen MCP tool list
run vcheck 60 node vcheck.mjs                   # ?v=<badge> on every local module address; every page's badge
run accuracy-constants 30 node accuracy/constcheck.mjs # the native runs' -constant s = the web worker's

if [ "$TIER" = main ]; then
  # ---- Sing (with guided practice off: the v75-era screen these suites were written for) ------------------
  for t in loop loopguard review perform playafter lasttake taptiming rhythmpage iosgate stuckctx pitchmon ahead countin unlock; do
    run "$t" 600 node -r ./guidedoff.cjs "$t.cjs"
  done
  run --info chipkeys 600 node -r ./guidedoff.cjs chipkeys.cjs # (note chips as piano keys: printed, read by eye)
  # Guide me — on by default — from a clean slate on Amazing Grace, a simulated singer; BLEED=1 puts the page's
  # sound into the fake mic (a phone speaker's click bleed) and fails on any rhythm / practice warning.
  # (v101: Ear — the E8 prototype — replaced the guided card; guided.cjs tested the card, kept for its history)
  run ear 1200 node ear.cjs                       # Ear (E8): Line, Beats, Notes with a simulated singer; the lines, own lines, secured marks; the shell around it
  run voicetest 600 node voicetest.cjs            # Voice: the range test with a simulated singer, no note over a live mic
  run quietvoice 600 env SHOTS=0 node quietvoice.cjs # a distant singer (−25 dB, room noise) calibrates and is heard; noise alone never (E4)
  run sleep 900 env SHOTS=0 node sleep.cjs        # every page asleep when hidden: contexts, sources, tracks, the session

  # ---- Play (the owner's converted scores only with PLAY_SCORES) ------------------------------------------
  # play (8 sizes), playheaders, playfixes, playscore (the Full score), playopen (the view a song opens in: E1),
  # playpaper (the printed density),
  # playback (▶), playbackfixes, playpeekstaff, playpress (a press sounds at once), playkeys (the docked
  # keyboard), playhear (what ▶ plays), playv80fixes, playchords, tiecases (fixscore's restoreTies).
  run playunit 600 node playunit.cjs              # playprep / the note facts on every fixture
  run playxmlsame 600 node playxmlsame.cjs        # every view's MusicXML byte-identical to HEAD's playprep
  for t in play playheaders playfixes playscore playopen playpaper playback playbackfixes playpeekstaff playpress playkeys playhear playv80fixes playchords tiecases; do
    run "$t" 1800 node "$t.cjs"
  done
  run playpdf 1200 env SHOTS=0 node playpdf.cjs   # 📄: the bars on the PDF, zoom and pan, the focus border
  run playfocus 900 env SHOTS=0 node playfocus.cjs # E3: a highlight's exact span for assistants, a double-tap picks one chord
  run playmarks 900 env SHOTS=0 node playmarks.cjs # E6: bookmarks — made, tabs on the music, the list, per song, the shell's Score
  run playbar 300 env SHOTS=0 node playbar.cjs # one bar at a time: a held ‹ › / Shift + ← → starts the page a bar on
  run playfinger 1800 env SHOTS=0 node playfinger.cjs # E7: fingering on the shell's Piano — #fing, digits, the drawn hand, the hands' rules, the cache, off = today

  # ---- PDF → Song: the Reader (a synthetic fixture with clean-ups; the real recorded Chromium run) --------
  for fx in greensleeves greensleeves3-real; do
    run "reader:$fx" 1200 env FX=$fx SHOTS=0 node reader.cjs
  done
  run jobstore 300 node jobstore.cjs              # the job store, ENGINE vs lib/, the crash-loop guard
  run titlecases 300 node titlecases.cjs          # pdfTitle / chooseTitle (the owner's PDFs when sitetest has them)
  run keycases 300 node keycases.cjs              # fixscore's unifyKeySignatures, each case idempotent
  run fixcases 300 node fixcases.cjs              # the other clean-ups: boxed fills, stray 8va, 8vb clefs, verses, tempo, tuplet marks
  run importfixes 900 node importfixes.cjs        # the v81 review round, a scripted worker (~2 min)

  # ---- The song library (v90), the shell -----------------------------------------------------------------
  run libcore 300 node libcore.cjs
  run songlib 1200 env SHOTS=0 node songlib.cjs
  run reprocess 900 node reprocess.cjs            # Reconvert: the same song id, settings kept, a reload mid-run, the shell
  run jankchrome 1500 env SHOTS=0 node jankchrome.cjs
  run jank 1500 env SHOTS=0 node -r ./harness/noshots.cjs jank.cjs
  for t in cutover shell shellmods shellscore shellplaces; do
    run "$t" 1500 env SHOTS=0 node -r ./harness/noshots.cjs "$t.cjs"
  done
  # (v101: Ear replaced the guided card this suite checks — the card, its Hear it, the lane under it: reported, not
  # judged, until it's rewritten for Ear; tools/ear.cjs covers Ear itself)
  run --info shellsing 1500 env SHOTS=0 node -r ./harness/noshots.cjs shellsing.cjs
  for t in playpdfonly singpdf; do run "$t" 600 node "$t.cjs"; done

  # ---- WebKitGTK (Xvfb :99 + WebKitWebDriver on :4444, CLAUDE.md "a fresh container") ----------------------
  WK=(playwebkit playbackwk playpresswk playhearwk playmarkswk playfingerwk cutoverwk readerwk)
  if curl -s -m 2 http://127.0.0.1:4444/status > /dev/null 2>&1; then
    for t in "${WK[@]}"; do run "$t" 900 env DISPLAY=:99 node "$t.mjs"; done
  else
    for t in "${WK[@]}"; do row "$t" SKIP 0 "no WebKitWebDriver on :4444"; done
  fi

  # ---- The real conversions (IMPORT_E2E=1): importresume's scenarios (full first: the reference MusicXML),
  # importreader (the Reader on a real conversion with a reload, iPhone + iPad), importwk (WebKitGTK).
  if [ -n "$IMPORT_E2E" ]; then
    for sc in full stub1 prep engine crash discard tabs again engineid; do
      run "importresume:$sc" 3000 node importresume.cjs $sc
    done
    run importreader 3600 node importreader.cjs
    if curl -s -m 2 http://127.0.0.1:4444/status > /dev/null 2>&1; then
      run importwk 2400 env DISPLAY=:99 node importwk.mjs
    fi
  fi
fi

# ---- Nothing a suite writes lands in the checkout ------------------------------------------------------------
AFTER=$(snapshot)
if [ "$BEFORE" = "$AFTER" ]; then
  row "checkout untouched" PASS 0 "git status as before the run$([ -n "$BEFORE" ] && echo " ($(echo "$BEFORE" | wc -l) uncommitted entries already)")"
else
  row "checkout untouched" FAIL 0 "changed by the run: $(diff <(echo "$BEFORE") <(echo "$AFTER") | grep '^[<>]' | cut -c3- | cut -d' ' -f1-2 | sort -u | head -5 | tr '\n' ';')"
fi

# ---- The table -----------------------------------------------------------------------------------------------
count() { local n=0 r; for r in "${ROWS[@]}"; do [ "$(cut -f2 <<< "$r")" = "$1" ] && n=$((n + 1)); done; echo $n; }
T=$((SECONDS - START))
echo
echo "regress $TIER: ${#ROWS[@]} rows — $(count PASS) PASS, $(count FAIL) FAIL, $(count SKIP) SKIP, $(count INFO) INFO — $((T / 60))m$((T % 60))s (logs: $OUT)"
printf '| %-28s | %-7s | %6s | %s\n' suite verdict time note
printf '|%s|%s|%s|%s\n' "------------------------------" "---------" "--------" "------"
for r in "${ROWS[@]}"; do
  IFS=$'\t' read -r n v s note <<< "$r"
  printf '| %-28s | %-7s | %5ss | %s\n' "$n" "$v" "$s" "$note"
done
[ $FAILED -eq 0 ]
