// Web build step for Audiveris under CheerpJ (Java 25+, java.lang.classfile API).
//
// CheerpJ's Java 17 runtime lacks the Unsafe natives behind *reflective* access to
// volatile boolean/byte/short/char/float fields (jdk.internal.misc.Unsafe.getBooleanVolatile,
// putByteVolatile, get/putShortVolatile, get/putCharVolatile, getFloatVolatile), so JAXB
// (book storage, MusicXML export) fails on such fields. Plain bytecode access works.
// CheerpJ runs every Java thread on the single JavaScript thread, so 'volatile' has no
// observable effect there: this tool clears ACC_VOLATILE on fields of those five types,
// leaving everything else in the class files untouched.
// Reflection also uses those "qualified" (volatile) accessors for FINAL fields made
// accessible (JAXB does that), so ACC_FINAL is cleared too on *instance* fields of those
// types. The JVM does not rely on 'final' for instance fields; static fields are untouched.
//
// usage: java StripVolatile.java in.jar out.jar
import java.lang.classfile.ClassFile;
import java.lang.classfile.ClassModel;
import java.lang.classfile.ClassTransform;
import java.lang.classfile.FieldModel;
import java.lang.classfile.FieldElement;
import java.lang.classfile.AccessFlags;
import java.lang.reflect.AccessFlag;
import java.io.*;
import java.util.*;
import java.util.zip.*;

public class StripVolatile {
    private static final Set<String> TYPES = Set.of("Z", "B", "S", "C", "F");

    static boolean needsStrip(FieldModel f) {
        if (!TYPES.contains(f.fieldType().stringValue())) {
            return false;
        }
        return f.flags().has(AccessFlag.VOLATILE)
                || (f.flags().has(AccessFlag.FINAL) && !f.flags().has(AccessFlag.STATIC));
    }

    public static void main(String[] args) throws IOException {
        int classes = 0, fields = 0;
        try (ZipInputStream in = new ZipInputStream(new FileInputStream(args[0]));
             ZipOutputStream out = new ZipOutputStream(new FileOutputStream(args[1]))) {
            ZipEntry e;
            while ((e = in.getNextEntry()) != null) {
                byte[] data = in.readAllBytes();
                if (e.getName().endsWith(".class")) {
                    ClassModel cm = ClassFile.of().parse(data);
                    List<String> hits = new ArrayList<>();
                    for (FieldModel f : cm.fields()) {
                        if (needsStrip(f)) {
                            hits.add(f.fieldName().stringValue());
                        }
                    }
                    if (!hits.isEmpty()) {
                        classes++;
                        fields += hits.size();
                        System.out.println(cm.thisClass().asInternalName() + " " + hits);
                        ClassTransform ct = (cb, ce) -> {
                            if (ce instanceof FieldModel fm && needsStrip(fm)) {
                                cb.withField(fm.fieldName(), fm.fieldType(), fb -> {
                                    for (FieldElement fe : fm) {
                                        if (fe instanceof AccessFlags af) {
                                            int mask = af.flagsMask() & ~ClassFile.ACC_VOLATILE;
                                            if ((mask & ClassFile.ACC_STATIC) == 0) {
                                                mask &= ~ClassFile.ACC_FINAL;
                                            }
                                            fb.withFlags(mask);
                                        } else {
                                            fb.with(fe);
                                        }
                                    }
                                });
                            } else {
                                cb.with(ce);
                            }
                        };
                        data = ClassFile.of().transformClass(cm, ct);
                    }
                }
                ZipEntry ne = new ZipEntry(e.getName());
                ne.setTime(e.getTime());
                out.putNextEntry(ne);
                out.write(data);
                out.closeEntry();
            }
        }
        System.out.println("StripVolatile: " + fields + " fields in " + classes + " classes");
    }
}
