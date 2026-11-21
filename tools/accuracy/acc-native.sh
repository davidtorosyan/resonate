#!/bin/bash
# acc-native.sh slug… — a PDF → the site's TIFF (tools/mktiff.cjs, from the test server: /home/user/sitetest/<slug>.pdf
# as /<slug>.pdf) → native Audiveris ($INST) with the web's constants → $SP/acc/$OUT/<slug>/ (the .mxl, out.log,
# err.log). The TIFF is made once, $SP/acc/tif/<slug>.tif (+ .pages.txt for pairs.cjs). Env: env.sh's, OUT (v10).
source "$(dirname "$0")/env.sh"
OUT=${OUT:-v10}
mkdir -p "$SP/acc/tif"
for n in "$@"; do
  t=$SP/acc/tif/$n.tif
  if [ ! -s "$t" ]; then (cd "$ACC_TOOLS/.." && timeout 900 node mktiff.cjs "/$n.pdf" "$t" > "$SP/acc/tif/$n.pages.txt" 2>&1); fi
  d=$SP/acc/$OUT/$n; rm -rf "$d"; mkdir -p "$d"; s=$(date +%s)
  "$INST/bin/Audiveris" -batch -export -output "$d" $ACC_CONSTANTS "$t" > "$d/out.log" 2> "$d/err.log"
  echo "$n $OUT exit $? $(( $(date +%s) - s ))s $(ls "$d"/*.mxl 2>/dev/null | wc -l) mxl"
done
