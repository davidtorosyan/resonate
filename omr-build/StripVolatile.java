// Web build step for Audiveris under CheerpJ (Java 25+, java.lang.classfile API).
// Two class-file rewrites, both invisible to Java semantics, applied to every shipped jar:
//
// 1. Volatile/final flags. CheerpJ's Java 17 runtime lacks the Unsafe natives behind
//    *reflective* access to volatile boolean/byte/short/char/float fields
//    (jdk.internal.misc.Unsafe.getBooleanVolatile, putByteVolatile, get/putShortVolatile,
//    get/putCharVolatile, getFloatVolatile), so JAXB (book storage, MusicXML export) fails on
//    such fields. Plain bytecode access works. CheerpJ runs every Java thread on the single
//    JavaScript thread, so 'volatile' has no observable effect there: ACC_VOLATILE is cleared
//    on fields of those five types. Reflection also uses those "qualified" (volatile) accessors
//    for FINAL fields made accessible (JAXB does that), so ACC_FINAL is cleared too on
//    *instance* fields of those types. The JVM does not rely on 'final' for instance fields;
//    static fields are untouched.
//
// 2. Two-dimensional primitive arrays. CheerpJ 4.2's JIT miscompiles hot code that allocates a
//    2-D primitive array in one shot (multianewarray, e.g. "new double[m][n]") and then copies
//    into it element by element: after ~70 calls the result is wrong. Jama's Matrix.getArrayCopy
//    is exactly that, so every circle fit Audiveris makes for slurs and ties failed ("Matrix is
//    singular") once warm, and pages 2+ lost all their slurs and ties. Allocating the rows one
//    by one avoids it. So every "multianewarray [[X 2" with a primitive X becomes a call to a
//    generated helper, cheerpjfix/Arrays2D.x(int, int), which does exactly that (same
//    NegativeArraySizeException behavior); the helper class is added to each rewritten jar.
//    Fixed in CheerpJ 5.0 (but 5.0 ran beams detection ~5x slower).
//
// usage: java StripVolatile.java in.jar out.jar
//        (the jars next to in.jar resolve class hierarchies when stack maps are regenerated)
import java.lang.classfile.*;
import java.lang.classfile.instruction.NewMultiArrayInstruction;
import java.lang.constant.ClassDesc;
import java.lang.constant.ConstantDescs;
import java.lang.constant.MethodTypeDesc;
import java.lang.reflect.AccessFlag;
import java.io.*;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;

public class StripVolatile {
    private static final Set<String> TYPES = Set.of("Z", "B", "S", "C", "F");

    /** Primitive element descriptor -> helper method name and newarray kind. */
    private static final Map<String, TypeKind> PRIMS = Map.of(
            "Z", TypeKind.BOOLEAN, "B", TypeKind.BYTE, "S", TypeKind.SHORT, "C", TypeKind.CHAR,
            "I", TypeKind.INT, "J", TypeKind.LONG, "F", TypeKind.FLOAT, "D", TypeKind.DOUBLE);

    private static final ClassDesc HELPER = ClassDesc.ofInternalName("cheerpjfix/Arrays2D");

    static boolean needsStrip(FieldModel f) {
        if (!TYPES.contains(f.fieldType().stringValue())) {
            return false;
        }
        return f.flags().has(AccessFlag.VOLATILE)
                || (f.flags().has(AccessFlag.FINAL) && !f.flags().has(AccessFlag.STATIC));
    }

    /** Element descriptor if this is "multianewarray [[X 2" with a primitive X, else null. */
    static String splittable(NewMultiArrayInstruction ni) {
        final String desc = ni.arrayType().asSymbol().descriptorString();
        if (ni.dimensions() == 2 && desc.length() == 3 && desc.startsWith("[[")
                && PRIMS.containsKey(desc.substring(2))) {
            return desc.substring(2);
        }
        return null;
    }

    static boolean hasSplittable(ClassModel cm) {
        for (MethodModel mm : cm.methods()) {
            Optional<CodeModel> code = mm.code();
            if (code.isPresent()) {
                for (CodeElement ce : code.get()) {
                    if (ce instanceof NewMultiArrayInstruction ni && splittable(ni) != null) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    static MethodTypeDesc helperType(String elem) {
        return MethodTypeDesc.of(ClassDesc.ofDescriptor("[[" + elem), ConstantDescs.CD_int, ConstantDescs.CD_int);
    }

    /** cheerpjfix/Arrays2D: one static method per primitive type, rows allocated one by one. */
    static byte[] helperClass() {
        final ClassDesc nase = ClassDesc.of("java.lang.NegativeArraySizeException");
        return ClassFile.of().build(HELPER, clb -> {
            clb.withVersion(ClassFile.JAVA_8_VERSION, 0); // loadable by every jar's runtime
            clb.withFlags(ClassFile.ACC_PUBLIC | ClassFile.ACC_FINAL | ClassFile.ACC_SUPER);
            for (Map.Entry<String, TypeKind> p : new TreeMap<>(PRIMS).entrySet()) {
                final String elem = p.getKey();
                final ClassDesc row = ClassDesc.ofDescriptor("[" + elem);
                clb.withMethodBody(elem.toLowerCase(), helperType(elem),
                        ClassFile.ACC_PUBLIC | ClassFile.ACC_STATIC, cb -> {
                    // if (a < 0 || b < 0) throw new NegativeArraySizeException();
                    for (int slot = 0; slot < 2; slot++) {
                        final int s = slot;
                        cb.iload(s).ifThen(Opcode.IFLT, t -> t.new_(nase).dup()
                                .invokespecial(nase, "<init>", MethodTypeDesc.of(ConstantDescs.CD_void))
                                .athrow());
                    }
                    // r = new X[a][]; for (i = 0; i < a; i++) r[i] = new X[b]; return r;
                    cb.iload(0).anewarray(row).astore(2);
                    cb.iconst_0().istore(3);
                    final Label loop = cb.newLabel(), end = cb.newLabel();
                    cb.labelBinding(loop);
                    cb.iload(3).iload(0).if_icmpge(end);
                    cb.aload(2).iload(3).iload(1).newarray(p.getValue()).aastore();
                    cb.iinc(3, 1).goto_(loop);
                    cb.labelBinding(end);
                    cb.aload(2).areturn();
                });
            }
        });
    }

    public static void main(String[] args) throws IOException {
        int classes = 0, fields = 0, splitClasses = 0, splitSites = 0;
        final List<String> skipped = new ArrayList<>();

        // Class hierarchy for stack map regeneration: the JDK, then every jar next to the input.
        final List<URL> urls = new ArrayList<>();
        try (DirectoryStream<Path> ds = Files.newDirectoryStream(
                Paths.get(args[0]).toAbsolutePath().getParent(), "*.jar")) {
            for (Path p : ds) {
                urls.add(p.toUri().toURL());
            }
        }
        final ClassFile cf = ClassFile.of(ClassFile.ClassHierarchyResolverOption.of(
                ClassHierarchyResolver.defaultResolver().orElse(ClassHierarchyResolver.ofResourceParsing(
                        new URLClassLoader(urls.toArray(URL[]::new), null)))));

        try (ZipInputStream in = new ZipInputStream(new FileInputStream(args[0]));
             ZipOutputStream out = new ZipOutputStream(new FileOutputStream(args[1]))) {
            ZipEntry e;
            long time = 0;
            while ((e = in.getNextEntry()) != null) {
                byte[] data = in.readAllBytes();
                time = Math.max(time, e.getTime());
                if (e.getName().endsWith(".class")) {
                    ClassModel cm = cf.parse(data);

                    // 1. Volatile/final flags
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
                        data = cf.transformClass(cm, ct);
                        cm = cf.parse(data);
                    }

                    // 2. Two-dimensional primitive arrays
                    if (hasSplittable(cm)) {
                        final int[] sites = { 0 };
                        CodeTransform split = (cob, coe) -> {
                            if (coe instanceof NewMultiArrayInstruction ni && splittable(ni) != null) {
                                final String elem = splittable(ni);
                                cob.invokestatic(HELPER, elem.toLowerCase(), helperType(elem));
                                sites[0]++;
                            } else {
                                cob.with(coe);
                            }
                        };
                        try {
                            data = cf.transformClass(cm, ClassTransform.transformingMethodBodies(split));
                            splitClasses++;
                            splitSites += sites[0];
                        } catch (RuntimeException ex) {
                            // Unresolvable types for stack maps (e.g. optional dependencies not shipped)
                            skipped.add(cm.thisClass().asInternalName() + " (" + ex.getMessage() + ")");
                        }
                    }
                }
                ZipEntry ne = new ZipEntry(e.getName());
                ne.setTime(e.getTime());
                out.putNextEntry(ne);
                out.write(data);
                out.closeEntry();
            }
            if (splitClasses > 0) {
                ZipEntry ne = new ZipEntry("cheerpjfix/Arrays2D.class");
                ne.setTime(time);
                out.putNextEntry(ne);
                out.write(helperClass());
                out.closeEntry();
            }
        }
        for (String s : skipped) {
            System.out.println("left as is: " + s);
        }
        System.out.println("StripVolatile: " + fields + " fields in " + classes + " classes, "
                + splitSites + " 2-D array allocations in " + splitClasses + " classes"
                + (skipped.isEmpty() ? "" : ", " + skipped.size() + " classes left as is"));
    }
}
