#!/bin/bash
# Native proof of resume: snapshot the .omr after sheet K is stored (A runs on to the end),
# then run Audiveris on the snapshot (B) — and on it with finished pages as 1x1 placeholders (P),
# and in place after a kill -9 mid-sheet (C).
# usage: SP=<work folder> trace-resume.sh NAME TIF K
source "$(dirname "$0")/accuracy/env.sh" # (SP, JDK, INST, TESSDATA_PREFIX; ACC_CONSTANTS = the web's -constant s)
BIN=${AUDIVERIS:-$INST/bin/Audiveris}   # bin/Audiveris of an installDist of the patched build
N=$1; T=$2; K=$3
R=$SP/trace/resume/$N; rm -rf $R; mkdir -p $R/A $R/B $R/P $R/C $R/N
C=$ACC_CONSTANTS
export AUDIVERIS_OPTS="-Daudiveris.web.trace=stderr"
cp $T $R/score.tif
# A: full run; copy the .omr as soon as "S K" is traced
( $BIN -batch -export -output $R/A $C $R/score.tif > $R/A/out.log 2> $R/A/err.log ) &
APID=$!
until grep -q "^S $K " $R/A/err.log 2>/dev/null; do sleep 0.05; kill -0 $APID 2>/dev/null || break; done
cp $R/A/score.omr $R/snap.omr && echo "snapshot after S $K: $(stat -c %s $R/snap.omr) bytes"
wait $APID
# B: resume from the snapshot (same TIFF, same constants)
cp $R/snap.omr $R/B/score.omr
$BIN -batch -export -output $R/B $C $R/B/score.omr > $R/B/out.log 2> $R/B/err.log
# N: resume without repeating -constant ...indentations=false
cp $R/snap.omr $R/N/score.omr
$BIN -batch -export -output $R/N -constant org.audiveris.omr.util.OmrExecutors.useParallelism=false $R/N/score.omr > $R/N/out.log 2> $R/N/err.log
# P: resume with the finished pages replaced by 1x1 placeholders (the TIFF at the book's path)
cp $R/snap.omr $R/P/score.omr
mv $R/score.tif $R/score-full.tif
python3 -I "$(dirname "$0")/trace-placeholder.py" $R/score-full.tif $R/score.tif $(seq -s, 1 $K) > $R/P/ph.log
$BIN -batch -export -output $R/P $C $R/P/score.omr > $R/P/out.log 2> $R/P/err.log
mv -f $R/score-full.tif $R/score.tif
# C: kill -9 while the sheet after K+1 is being read, then resume in place
( $BIN -batch -export -output $R/C $C $R/score.tif > $R/C/out1.log 2> $R/C/err1.log ) &
CPID=$!
until grep -q "^B $((K+2)) HEADS" $R/C/err1.log 2>/dev/null; do sleep 0.05; kill -0 $CPID 2>/dev/null || break; done
pkill -9 -f "output $R/C " ; wait $CPID 2>/dev/null
echo "killed C at: $(grep '^[BS] ' $R/C/err1.log | tail -2 | tr '\n' ' ')"
ls -la $R/C
$BIN -batch -export -output $R/C $C $R/C/score.omr > $R/C/out2.log 2> $R/C/err2.log
echo DONE $N
