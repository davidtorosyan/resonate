#!/usr/bin/env bash
# usage: run-with-rss.sh <rsslog> <cmd...>   — samples Chromium RSS every 5 s while cmd runs
log=$1; shift
( while true; do ps -eo rss,args --sort=-rss | grep -iE "chrom|headless_shell" | grep -v grep | head -4 | awk '{s=s sprintf("%d ", $1/1024)} END {print strftime("%H:%M:%S"), s}' >> "$log"; sleep 5; done ) &
mon=$!
"$@"
rc=$?
kill $mon
exit $rc
