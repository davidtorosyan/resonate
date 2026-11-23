// A/B two finger.js versions on the dumped songs (keys/*.json): notes whose hand / finger changed, by bar.
// usage: node ab.mjs <old finger.js> <new finger.js> [song-prefix] [VERBOSE=1]
import fs from "fs"; import path from "path"; import { pathToFileURL } from "url";
const [oldP, newP, pre = ""] = process.argv.slice(2);
const A = await import(pathToFileURL(path.resolve(oldP))), B = await import(pathToFileURL(path.resolve(newP)));
const dir = (process.env.KEYS || new URL("./keys/", import.meta.url).pathname).replace(/\/?$/, "/");
let tot = 0, totN = 0;
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f.startsWith(pre)).sort()) {
  const d = JSON.parse(fs.readFileSync(dir + f, "utf8"));
  const items = d.items; if (!items.length) continue;
  const ra = A.fingerNotes(items, { hand: "sb" }), rb = B.fingerNotes(items, { hand: "sb" });
  const ch = [];
  for (const it of items) {
    const a = ra.notes.get(it.id), b = rb.notes.get(it.id);
    if (a.h !== b.h || a.f !== b.f || a.x !== b.x) ch.push({ it, a, b });
  }
  tot += ch.length; totN += items.length;
  const bars = [...new Set(ch.map((c) => c.it.bar))];
  console.log(`${f.replace(".json", "").padEnd(18)} ${String(ch.length).padStart(4)} / ${String(items.length).padStart(4)} notes changed in ${bars.length} bars${bars.length ? ": " + bars.slice(0, 30).join(" ") + (bars.length > 30 ? " …" : "") : ""}`);
  if (process.env.VERBOSE) for (const { it, a, b } of ch) console.log(`   bar ${it.bar} @${it.beat} midi ${it.midi} staff ${it.staff}: ${a.h}${a.f}${a.x ? "/" + a.x : ""} → ${b.h}${b.f}${b.x ? "/" + b.x : ""}`);
}
console.log(`total ${tot} of ${totN} notes`);
