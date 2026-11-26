// Piano fingering off the main thread (E7, docs/FINGERING.md §3): a module Worker around finger.js.
//   const w = new Worker(new URL("./finger-worker.js?v=N", import.meta.url), { type: "module" });
//   w.postMessage({ id, items, hand });   → { id, result: fingerNotes(items, { hand }) } or { id, error }
// items: finger.js's input (plain objects); result: its output (notes a Map, structured-cloned).
import { fingerNotes } from "./finger.js?v=116";

self.onmessage = (e) => {
  const { id, items, hand } = e.data || {};
  try {
    self.postMessage({ id, result: fingerNotes(items, { hand }) });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
