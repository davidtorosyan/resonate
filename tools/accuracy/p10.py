# usage: python3 -I p10.py <audiveris>/app/src/main/java/org/audiveris/omr/sheet/rhythm/MeasureRhythm.java
# Patch 0010's first draft (a rest shared by two voices), applied to the Java source in place (CRLF kept).
# Kept for the record: omr-build/patches/0010 is the patch as built (p10b.py's version, after review).
import sys
p = sys.argv[1]
s = open(p, 'rb').read().decode('utf-8')
assert '\r\n' in s
s = s.replace('\r\n', '\n')
def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, (n, old[:80])
    s = s.replace(old, new)

# 1. import Staff
rep('import org.audiveris.omr.sheet.Sheet;\n', 'import org.audiveris.omr.sheet.Sheet;\nimport org.audiveris.omr.sheet.Staff;\n')

# 2. purgeExtinctVoices: a voice resting along with another voice's rest is not extinct
rep('''                if (lastChord.getTimeOffset() != null) {
                    final Rational end = lastChord.getEndTime();

                    if (end.compareTo(firstTime) < 0) {''', '''                if (lastChord.getTimeOffset() != null) {
                    final Rational end = voiceEnd(lastChord, slot, true);

                    if ((end != null) && (end.compareTo(firstTime) < 0)) {''')

# 3. the helper, before removeTuplet
rep('''    //--------------//
    // removeTuplet //
    //--------------//''', '''    //----------//
    // voiceEnd //
    //----------//
    /**
     * Report when the voice ending with the provided chord is free again, as seen from the
     * provided slot.
     * <p>
     * This is normally the chord end time.
     * But when two voices of a staff rest together, engravers print just one rest, which this
     * algorithm gives to one voice only: the other voice rests as well, and its next chord comes
     * after that rest.
     * So, when a rest of another voice on the same staff, located in a slot before the provided
     * one (or in it, if inclusive), starts exactly where this voice ends, the voice is free at the
     * end of that rest, and so on for consecutive shared rests.
     * Without this, the next chord would get the time of that rest, i.e. the time of a slot
     * located before its own, and the voice would end too early in the measure.
     *
     * @param chord     the last chord of a voice
     * @param slot      the slot at hand
     * @param inclusive true to consider the rests of the slot itself
     * @return the time the voice is free, or null if unknown
     */
    private Rational voiceEnd (AbstractChordInter chord,
                               CompoundSlot slot,
                               boolean inclusive)
    {
        Rational end = chord.getEndTime();

        if (end == null) {
            return null;
        }

        final int index = slots.indexOf(slot);

        if (index < 0) {
            return end;
        }

        final List<CompoundSlot> before = slots.subList(0, inclusive ? index + 1 : index);
        final Voice voice = chord.getVoice();
        final Staff staff = chord.getTopStaff();

        Search:
        while (true) {
            for (CompoundSlot sl : before) {
                for (AbstractChordInter ch : sl.getChords()) {
                    if ((ch instanceof RestChordInter) && (ch.getVoice() != null)
                            && (ch.getVoice() != voice) && (ch.getTopStaff() == staff)
                            && end.equals(ch.getTimeOffset())) {
                        final Rational restEnd = ch.getEndTime();

                        if ((restEnd != null) && (restEnd.compareTo(end) > 0)) {
                            end = restEnd;

                            continue Search;
                        }
                    }
                }
            }

            return end;
        }
    }

    //--------------//
    // removeTuplet //
    //--------------//''')

# 4. applyMapping: the rookie starts when its voice is free
rep('''                if (act.getTimeOffset() != null) {
                    ch.setAndPushTime(act.getEndTime());
                } else {''', '''                if (act.getTimeOffset() != null) {
                    final Rational end = voiceEnd(act, slot, false);

                    if (!end.equals(act.getEndTime())) {
                        logger.info("{} {} after a rest shared with another voice", measure, ch);
                    }

                    ch.setAndPushTime(end);
                } else {''')

# 5. inferSlotTimes
rep('''                    if (act.getTimeOffset() != null) {
                        final Rational end = act.getEndTime();
                        List<AbstractChordInter> list = times.get(end);''', '''                    if (act.getTimeOffset() != null) {
                        final Rational end = voiceEnd(act, slot, false);
                        List<AbstractChordInter> list = times.get(end);''')

# 6. mapRookies validation
rep('''                            final Rational actEnd = act.getEndTime();

                            if (actEnd == null) {
                                return; // Computing cannot continue
                            }''', '''                            final Rational actEnd = voiceEnd(act, slot, false);

                            if (actEnd == null) {
                                return; // Computing cannot continue
                            }''')

open(p, 'wb').write(s.replace('\n', '\r\n').encode('utf-8'))
print('ok')
