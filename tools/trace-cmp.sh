#!/bin/bash
# cmp.sh DIR1 DIR2 : compare the MusicXML (encoding-date stripped) and the .omr entries of two runs
a=$1; b=$2
x() { local m=$(ls $1/*.mxl 2>/dev/null | head -1); [ -z "$m" ] && { echo NOMXL; return; }
  unzip -p "$m" $(unzip -Z1 "$m" | grep -v META-INF | head -1) | sed 's#<encoding-date>[^<]*</encoding-date>##'; }
ma=$(x $a | sha256sum | cut -c1-16); mb=$(x $b | sha256sum | cut -c1-16)
[ "$ma" = "$mb" ] && mx="mxl SAME ($ma, $(x $a | wc -c) B)" || mx="mxl DIFF ($ma vs $mb)"
oa=$(ls $a/*.omr | head -1); ob=$(ls $b/*.omr | head -1); od=0; on=0
for e in $(unzip -Z1 $oa); do on=$((on+1))
  if ! cmp -s <(unzip -p $oa "$e") <(unzip -p $ob "$e"); then od=$((od+1)); echo "   omr entry differs: $e"; fi
done
[ "$(unzip -Z1 $oa | sort)" = "$(unzip -Z1 $ob | sort)" ] || echo "   omr entry lists differ"
echo "$mx; omr $((on-od))/$on entries same"
