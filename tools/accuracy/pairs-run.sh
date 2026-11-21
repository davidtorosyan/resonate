#!/bin/bash
# pairs-run.sh slug… — pairs.cjs for each song on a native run's export: $ACC/$RUN/<slug>/*.mxl → $ACC/$PAIRS/<slug>/
# (round 1's pairs15.sh, its songs and folders as arguments). Needs the test server. The outputs hold the score's
# text: keep them outside the repo. Env: ACC (default $SP/acc), RUN (r15), PAIRS (pairs15).
ACC=${ACC:-${SP:?set ACC, the accuracy folder, or SP}/acc}
RUN=${RUN:-r15}; PAIRS=${PAIRS:-pairs15}
cd "$(dirname "$0")" || exit 2
for s in "$@"; do
  m=$(ls "$ACC/$RUN/$s"/*.mxl 2>/dev/null | head -1)
  [ -n "$m" ] || { echo "$s: no .mxl in $ACC/$RUN/$s"; continue; }
  ACC=$ACC timeout 1800 node pairs.cjs "$s" "$m" "$ACC/$PAIRS/$s" > "$ACC/$PAIRS-$s.log" 2>&1
  echo "$s exit $? $(ls "$ACC/$PAIRS/$s"/*-pdf.png 2>/dev/null | wc -l) systems"
done
echo ALLDONE
