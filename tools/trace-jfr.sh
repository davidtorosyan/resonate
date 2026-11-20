#!/bin/bash
# CPU share of WebTrace in a native traced run: JFR execution samples whose stack has a WebTrace frame.
SP=/tmp/claude-0/-home-user-resonate/6042bc19-5f16-52ea-a295-8ea17a932323/scratchpad
J=/home/user/jdk/zulu25.38.109-ca-jdk25.0.5.0.3-linux_x64
export JAVA_HOME=$J PATH=$J/bin:$PATH TESSDATA_PREFIX=$SP/tupwt/app/dev/tessdata
n=$1; t=$2; d=$SP/trace/jfr/$n; rm -rf $d; mkdir -p $d
C="-constant org.audiveris.omr.sheet.ProcessingSwitches.indentations=false -constant org.audiveris.omr.util.OmrExecutors.useParallelism=false"
AUDIVERIS_OPTS="-Daudiveris.web.trace=stderr -XX:StartFlightRecording=filename=$d/rec.jfr,settings=profile" \
  ${AUDIVERIS:-$SP/trace/inst/bin/Audiveris} -batch -export -output $d $C $t > $d/out.log 2> $d/err.log
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
