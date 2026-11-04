#!/usr/bin/env bash
# Rebuild public/omr/lib/*.jar: Audiveris (upstream + patches/), compiled for Java 17,
# then StripVolatile applied to every jar. Needs git, JDK 25 (JAVA_HOME) and network
# access to Maven Central / Gradle plugin portal.
#
#   JAVA_HOME=/path/to/jdk-25 omr-build/build.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../public/omr/lib"
WORK="${WORK:-$HERE/.work}"
UPSTREAM=https://github.com/Audiveris/audiveris
BASE=7a36078   # upstream master commit the patches apply to (2026-08-13)

: "${JAVA_HOME:?set JAVA_HOME to a JDK 25}"
export PATH="$JAVA_HOME/bin:$PATH"

rm -rf "$WORK" && mkdir -p "$WORK"
git clone --quiet "$UPSTREAM" "$WORK/audiveris"
git -C "$WORK/audiveris" checkout --quiet "$BASE"
git -C "$WORK/audiveris" -c user.name=build -c user.email=build@localhost am --quiet --keep-cr "$HERE"/patches/*.patch   # sources are CRLF

# -PtheMinJavaVersion=17 makes the build compile with --release 17 (see patch 0001).
(cd "$WORK/audiveris" && ./gradlew --no-daemon -q -PtheMinJavaVersion=17 :app:installDist -x test)

mkdir -p "$OUT"
rm -f "$OUT"/*.jar
# Not shipped: native-library jars (no use in a browser) and GUI-only libraries
# (PDF printing, charts, update checker + its JSON lib, Swing look-and-feel, Markdown
# help, JNA). Keep this list in sync with JARS in public/omr/omr.js.
SKIP="itextpdf jfreechart github-api jackson-core jackson-databind jackson-annotations jgoodies-forms jgoodies-looks jgoodies-common commonmark jna"
for jar in "$WORK/audiveris/app/build/install/app/lib/"*.jar; do
  name="$(basename "$jar")"
  case "$name" in *-linux-*|*-macosx-*|*-windows-*) continue ;; esac
  skip=0; for s in $SKIP; do case "$name" in "$s"-[0-9]*) skip=1 ;; esac; done
  [ "$skip" = 1 ] && continue
  java "$HERE/StripVolatile.java" "$jar" "$OUT/$(basename "$jar")" | tail -1
done
echo "jars in $OUT: $(ls "$OUT" | wc -l)"

# The music font, served next to the jars: omr-worker.js hands it to Java in memory
# (audiveris.fonts.dir=/str, patch 0005) instead of a temp copy in IndexedDB.
mkdir -p "$OUT/../fonts"
cp "$WORK/audiveris/app/res/Bravura.otf" "$OUT/../fonts/"
