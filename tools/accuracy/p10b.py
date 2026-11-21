# usage: python3 -I p10b.py <audiveris>/app/src/main/java/org/audiveris/omr/sheet/rhythm/MeasureRhythm.java
# Patch 0010 as reviewed (voiceEnd with centered rests only, endFor's confirmation, purgeExtinctVoices),
# applied to the Java source in place (CRLF kept); omr-build/patches/0010 was made from its result.
import sys
p = sys.argv[1]
s = open(p, 'rb').read().decode('utf-8')
assert '\r\n' in s
s = s.replace('\r\n', '\n')
def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, (n, old[:90])
    s = s.replace(old, new)

rep('import org.audiveris.omr.sheet.Sheet;\n', 'import org.audiveris.omr.sheet.Sheet;\nimport org.audiveris.omr.sheet.Staff;\n')
rep('import org.audiveris.omr.sig.inter.AbstractChordInter;\n', 'import org.audiveris.omr.sig.inter.AbstractChordInter;\nimport org.audiveris.omr.sig.inter.AbstractPitchedInter;\n')

# purgeExtinctVoices: a voice resting along with another voice's rest stays active until that rest ends;
# if it doesn't come back right there, it is over.
rep('''                if (lastChord.getTimeOffset() != null) {
                    final Rational end = lastChord.getEndTime();

                    if (end.compareTo(firstTime) < 0) {''', '''                if (lastChord.getTimeOffset() != null) {
                    final Rational own = lastChord.getEndTime();
                    final Rational end = voiceEnd(lastChord, slot, true);

                    // A voice resting along with a rest of another voice must resume right at the
                    // end of that rest, else it is over
                    final boolean shared = (end != null) && !end.equals(own);

                    if ((end != null) && (shared ? (end.compareTo(firstTime) <= 0)
                            : (end.compareTo(firstTime) < 0))) {''')

rep('''    //--------------//
    // removeTuplet //
    //--------------//''', '''    //------------//
    // isCentered //
    //------------//
    /**
     * Report whether the provided rest chord sits in the middle of its staff, where a rest
     * that applies to all the voices of the staff is printed (a rest of one voice among others
     * is moved up or down).
     *
     * @param restChord the rest chord
     * @return true if centered
     */
    private static boolean isCentered (AbstractChordInter restChord)
    {
        final List<? extends Inter> notes = restChord.getNotes();

        if (notes.isEmpty() || !(notes.get(0) instanceof AbstractPitchedInter pitched)) {
            return false;
        }

        final Double pitch = pitched.getPitch();

        return (pitch != null) && (Math.abs(pitch) <= 1.5);
    }

    //----------//
    // voiceEnd //
    //----------//
    /**
     * Report when the voice ending with the provided chord would be free again, as seen
     * from the provided slot, if the rests printed for all the voices of a staff are shared.
     * <p>
     * When two voices of a staff rest together, engravers print just one rest, in the middle of
     * the staff, which this algorithm gives to one voice only: the other voice rests as well,
     * and its next chord comes after that rest.
     * So, when a centered rest of another voice on the same staff, located in a slot before the
     * provided one (or in it, if inclusive), starts exactly where this voice ends, the voice is
     * free at the end of that rest, and so on for consecutive shared rests.
     * Without this, the next chord would get the time of that rest, the time of a slot located
     * before its own, and the voice would end too early in the measure.
     * <p>
     * Not reconciled with implicit tuplets (shrinkVoice re-times chords from raw chord ends).
     *
     * @param chord     the last chord of a voice
     * @param slot      the slot at hand
     * @param inclusive true to consider the rests of the slot itself
     * @return the time the voice would be free, or null if unknown
     */
    private Rational voiceEnd (AbstractChordInter chord,
                               CompoundSlot slot,
                               boolean inclusive)
    {
        Rational end = chord.getEndTime();
        final Staff staff = chord.getStaff(); // Null for a chord on two staves
        final int index = slots.indexOf(slot);

        if ((end == null) || (staff == null) || (index < 0)) {
            return end;
        }

        final List<CompoundSlot> before = slots.subList(0, inclusive ? index + 1 : index);
        final Voice voice = chord.getVoice();

        Search:
        while (true) {
            for (CompoundSlot sl : before) {
                for (AbstractChordInter ch : sl.getChords()) {
                    if ((ch instanceof RestChordInter) && (ch.getVoice() != null)
                            && (ch.getVoice() != voice) && (ch.getStaff() == staff)
                            && end.equals(ch.getTimeOffset()) && isCentered(ch)) {
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

# applyMapping
rep('''                if (act.getTimeOffset() != null) {
                    ch.setAndPushTime(act.getEndTime());
                } else {''', '''                if (act.getTimeOffset() != null) {
                    final Rational end = endFor(ch, act, slot.getNarrowSlot(ch));

                    if (!end.equals(act.getEndTime())) {
                        logger.info("{} {} after a rest shared with another voice", measure, ch);
                    }

                    ch.setAndPushTime(end);
                } else {''')

# endFor, in SlotMapper, before getOrderedSiblings
rep('''        //--------------------//
        // getOrderedSiblings //
        //--------------------//''', '''        //--------//
        // endFor //
        //--------//
        /**
         * Report the time at which the voice of the active chord can take the rookie.
         * <p>
         * This is the active chord end time, or the end of a rest shared with another voice
         * (see {@link MeasureRhythm#voiceEnd}) when the narrow slot confirms that time: the slot
         * time is already known to be that, or another chord of the slot comes there on its own
         * (by the end of its voice's last chord, or by beam or tie).
         *
         * @param rookie the rookie chord
         * @param act    the active chord it is mapped to
         * @param narrow the narrow slot of the rookie
         * @return the time for the rookie, or null if unknown
         */
        private Rational endFor (AbstractChordInter rookie,
                                 AbstractChordInter act,
                                 MeasureSlot narrow)
        {
            final Rational own = act.getEndTime();

            if ((own == null) || (narrow == null)) {
                return own;
            }

            final Rational end = voiceEnd(act, slot, false);

            if ((end == null) || end.equals(own)) {
                return own;
            }

            final Rational slotTime = narrow.getTimeOffset();

            if (slotTime != null) {
                return slotTime.equals(end) ? end : own;
            }

            if (mapping != null) {
                for (ChordPair pair : mapping.pairsOf(narrow.getChords())) {
                    if ((pair.rookie != rookie) && (pair.active.getTimeOffset() != null)
                            && end.equals(pair.active.getEndTime())) {
                        return end;
                    }
                }
            }

            for (AbstractChordInter ch : narrow.getChords()) {
                if ((ch != rookie) && end.equals(ch.getTimeOffset())) {
                    return end;
                }
            }

            return own;
        }

        //--------------------//
        // getOrderedSiblings //
        //--------------------//''')

# inferSlotTimes
rep('''                    if (act.getTimeOffset() != null) {
                        final Rational end = act.getEndTime();
                        List<AbstractChordInter> list = times.get(end);''', '''                    if (act.getTimeOffset() != null) {
                        final Rational end = endFor(chord, act, narrowSlot);
                        List<AbstractChordInter> list = times.get(end);''')

# mapRookies validation
rep('''                            final Rational actEnd = act.getEndTime();

                            if (actEnd == null) {
                                return; // Computing cannot continue
                            }''', '''                            final Rational actEnd = endFor(ch, act, narrow);

                            if (actEnd == null) {
                                return; // Computing cannot continue
                            }''')

open(p, 'wb').write(s.replace('\n', '\r\n').encode('utf-8'))
print('ok')
