# Sourced by the native-run scripts (tools/accuracy/*.sh, tools/trace-*.sh): where things are, as environment
# variables (they were one session's scratchpad paths).
#   SP     the work folder: TIFFs, Audiveris installs, outputs — required (a session scratchpad, say)
#   JDK    a JDK 25 (default: the first folder in /home/user/jdk; this container used Zulu 25.0.5)
#   INST   an Audiveris install (./gradlew -PtheMinJavaVersion=17 :app:installDist of omr-build's patched
#          checkout, copied out), default $SP/inst-new
#   TESSDATA_PREFIX  Tesseract's language data, default $SP/audiveris/app/dev/tessdata
: "${SP:?set SP to the work folder (TIFFs, Audiveris installs, outputs)}"
JDK=${JDK:-$(ls -d /home/user/jdk/*/ 2>/dev/null | head -1)}
JDK=${JDK%/}
[ -x "$JDK/bin/java" ] || { echo "no bin/java in JDK=$JDK: set JDK to a JDK 25" >&2; exit 2; }
export JAVA_HOME=$JDK PATH=$JDK/bin:$PATH
export TESSDATA_PREFIX=${TESSDATA_PREFIX:-$SP/audiveris/app/dev/tessdata}
INST=${INST:-$SP/inst-new}
ACC_TOOLS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$ACC_TOOLS/constants.sh"
