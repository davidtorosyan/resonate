#!/bin/bash
# CPU share of WebTrace in a native traced run: JFR execution samples whose stack has a WebTrace frame.
# usage: SP=<work folder> trace-jfr.sh NAME TIF
source "$(dirname "$0")/accuracy/env.sh" # (SP, JDK, INST, TESSDATA_PREFIX; ACC_CONSTANTS = the web's -constant s)
n=$1; t=$2; d=$SP/trace/jfr/$n; rm -rf $d; mkdir -p $d
C=$ACC_CONSTANTS
AUDIVERIS_OPTS="-Daudiveris.web.trace=stderr -XX:StartFlightRecording=filename=$d/rec.jfr,settings=profile" \
  ${AUDIVERIS:-$INST/bin/Audiveris} -batch -export -output $d $C $t > $d/out.log 2> $d/err.log
jfr print --events jdk.ExecutionSample --stack-depth 64 $d/rec.jfr > $d/samples.txt
python3 - $d/samples.txt <<'PY'
import sys,re
s=open(sys.argv[1]).read().split('jdk.ExecutionSample')
tot=0; wt=0; emitp=0
for e in s[1:]:
    tot+=1
    if 'org.audiveris.omr.text.web.WebTrace' in e:
        wt+=1
        if 'PrintStream' in e or 'FileOutputStream' in e: emitp+=1
print(f"samples {tot}, in WebTrace {wt} ({100*wt/max(tot,1):.2f}%), of which printing {emitp}")
PY
