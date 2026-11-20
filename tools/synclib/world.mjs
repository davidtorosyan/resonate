// synclib.mjs's world (tools/synclib.mjs: public/sync.js against a fake cloud, offline).
// The shared world: the cloud (rows, files) and the devices (localStorage, library).
export const UID = '11111111-1111-1111-1111-111111111111';
export const W = { cloud: { rows: new Map(), files: new Map(), t: 0, log: [] }, dev: null, devices: {} };
export function device(name) {
  const d = W.devices[name] ||= { name, ls: new Map(), songs: new Map(), pdfs: new Map(), takes: new Map(), gen: 'g1', queue: [], jobs: [] };
  W.dev = d;
  return d;
}
globalThis.localStorage = {
  getItem: (k) => (W.dev.ls.has(k) ? W.dev.ls.get(k) : null),
  setItem: (k, v) => W.dev.ls.set(k, String(v)),
  removeItem: (k) => W.dev.ls.delete(k),
};
globalThis.window = globalThis.window || new EventTarget();
globalThis.CustomEvent = globalThis.CustomEvent || class extends Event { constructor(t, o) { super(t); this.detail = o?.detail; } };
Object.defineProperty(globalThis, "navigator", { value: { locks: null, storage: {} }, configurable: true });
globalThis.document = { hidden: false, addEventListener() {} };
