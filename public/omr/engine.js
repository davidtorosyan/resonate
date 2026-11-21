// The engine's number, as a person reads it: the newest Audiveris patch in omr-build/patches/00NN
// (0010 → 10). A song converted from a PDF records it (library.js `engine.n`), so the song list can
// say which engine read it and offer to read again the ones an older engine read (docs/LIBRARY.md).
// Bump it with every engine patch, together with omr.js ENGINE (tools/jobstore.cjs checks both).
// Its own module, apart from omr.js: the song list reads it without loading the engine's page side.
export const ENGINE_N = 19;
