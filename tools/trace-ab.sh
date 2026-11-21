#!/bin/bash
# usage: SP=<work folder> trace-ab.sh — TIFS="a.tif b.tif" to choose scores; outputs under $SP/trace/ab/{off,on}/<name>, compare with trace-cmp.sh
# A/B patch 0009 (WebTrace): the same build with the trace off vs on (stderr), web-like settings.
source "$(dirname "$0")/accuracy/env.sh" # (SP, JDK, INST, TESSDATA_PREFIX; ACC_CONSTANTS = the web's -constant s)
BIN=${AUDIVERIS:-$INST/bin/Audiveris}   # bin/Audiveris of an installDist of the patched build
OUT=$SP/trace/ab
TIFS="${TIFS:-$SP/thr/amazing-grace-th200.tif $SP/thr/oh-susanna-th200.tif $SP/thr/greensleeves-th200.tif $SP/ab/wl.tif $SP/ab/killing.tif $SP/ab/songbird.tif $SP/pm/pm.tif}"
C=$ACC_CONSTANTS
for t in $TIFS; do n=$(basename $t .tif)
  for v in off on; do
    d=$OUT/$v/$n; rm -rf $d; mkdir -p $d
    if [ $v = on ]; then opts="-Daudiveris.web.trace=stderr"; else opts=""; fi
    s=$(date +%s.%N)
    AUDIVERIS_OPTS="$opts" $BIN -batch -export -output $d $C $t > $d/out.log 2> $d/err.log
    e=$(date +%s.%N)
    echo "$n $v $(echo "$e - $s" | bc) s" | tee -a $OUT/times.txt
  done
done
echo ALLDONE
