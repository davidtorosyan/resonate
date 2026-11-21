#!/bin/bash
# acc-trace.sh slug… — as acc-native.sh (its TIFF must be there), with patch 0009's trace on stderr ($d/err.log;
# node tools/tracecheck.mjs reads it). Env: env.sh's, OUT (tr10), EXTRA (more -constant s).
source "$(dirname "$0")/env.sh"
export AUDIVERIS_OPTS="-Daudiveris.web.trace=stderr"
OUT=${OUT:-tr10}
for n in "$@"; do
  t=$SP/acc/tif/$n.tif
  d=$SP/acc/$OUT/$n; rm -rf "$d"; mkdir -p "$d"; s=$(date +%s)
  "$INST/bin/Audiveris" -batch -export -output "$d" $ACC_CONSTANTS $EXTRA "$t" > "$d/out.log" 2> "$d/err.log"
  echo "$n $OUT exit $? $(( $(date +%s) - s ))s $(ls "$d"/*.mxl 2>/dev/null | wc -l) mxl"
done
