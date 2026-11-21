#!/bin/bash
# ab.sh name… — an engine A/B: the base install and the patched one on $SP/ab/<name>.tif, side by side, into
# $SP/ab/{base,new}/<name>/ (then python3 -I cmp.py …/base/<name>/*.mxl …/new/<name>/*.mxl).
# Env: env.sh's; BASE_INST (default $SP/inst-base) and INST (the new one, default $SP/inst-new).
source "$(dirname "$0")/env.sh"
BASE_INST=${BASE_INST:-$SP/inst-base}
for n in "$@"; do
  for v in base new; do
    i=$INST; [ $v = base ] && i=$BASE_INST
    ( d=$SP/ab/$v/$n; rm -rf "$d"; mkdir -p "$d"; s=$(date +%s)
      "$i/bin/Audiveris" -batch -export -output "$d" $ACC_CONSTANTS "$SP/ab/$n.tif" > "$d/out.log" 2> "$d/err.log"
      echo "$n $v exit $? $(( $(date +%s) - s )) s" ) &
  done
  wait
done
echo ALLDONE
