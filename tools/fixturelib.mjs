// Fixtures for practice.js tests (tools/dumpnotes.cjs writes them): load a song's notes and
// lines, and build the groupPhrases options the Sing page would pass.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

export const fixtureNames = () => fs.readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));

// → { fx, notes, lines, opts } for one verse. rate: the tempo % (t/d scale; never the grouping).
export function loadSong(name, { verse = null, rate = 1, bpm = null } = {}) {
  const fx = JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), "utf8"));
  const v = verse ?? fx.verses[0];
  const { notes: raw, lines } = fx.byVerse[v];
  const notes = raw.map((n) => ({ ...n, t: n.t / rate, d: n.d / rate }));
  const measures = fx.measures;
  const barQAt = (q) => { let m = 0; measures.forEach((x, i) => { if (x <= q + 1e-6) m = i; }); return fx.barQ[m]; };
  const spq = bpm ? 60 / bpm : fx.spq;
  return { fx, notes, lines, opts: { spq, barQAt, measureOf: fx.measureOf } };
}
