// Ablation: which finger.js variant undoes the judged regressions and keeps the judged fixes (tools/fingerjudge/README.md).
// Run from <work>/fsurvey/var: base/finger.js (ALG 2: git show 86d6ec4:public/finger.js) one folder up, cur.js and the
// variants here (sed copies of cur.js), ../judge3.json (a judge run's result), ../confirmed.json, ../keys19/r19-<song>.json.
//   V=Ap2.js,Ap4.js node ablate.mjs
import fs from "node:fs";
const J = JSON.parse(fs.readFileSync("../judge3.json", "utf8"));
const C = JSON.parse(fs.readFileSync("../confirmed.json", "utf8"));
const V = (process.env.V || "Ap.js,ApLb2.js,ApLt6.js,ApLb2Lt6.js,ApL2.js").split(",");
const ALL = ["../base/finger.js", "cur.js", ...V];
const mods = {}; for (const v of ALL) mods[v] = await import(new URL(v, import.meta.url));
const songs = {}, cache = {};
const res = (song, v) => { songs[song] ||= JSON.parse(fs.readFileSync(`../keys19/r19-${song}.json`, "utf8")); return (cache[song + v] ||= mods[v].fingerNotes(songs[song].items, { hand: "sb" })); };
const str = (song, v, bars, hand) => { res(song, v); const it = songs[song].items.filter((i) => bars.includes(i.bar) && !i.tied && (!hand || hand === "both" || (hand === "rh" ? i.hand === "r" : i.hand === "l"))); const r = res(song, v); return it.map((i) => r.notes.get(i.id).f).join(""); };
// regressions (fingers, not labels): restored = the variant's fingers equal the old
const regs = []; for (const s of J) for (const r of s.regressions || []) { const b = (String(r.bar).match(/\d+/g) || [])[0]; const base = str(s.song, ALL[0], [b], r.hand), cur = str(s.song, "cur.js", [b], r.hand); if (base !== cur) regs.push({ song: s.song, b, hand: r.hand, base, cur, sev: r.severity }); }
// findings judged fixed / partly: kept = the variant's fingers in the finding's bars equal cur's
const verdict = {}; for (const s of J) for (const f of s.findings || []) verdict[f.id] = f.verdict;
const barsOf = (x) => { const s = (x.bars || "") + "," + (x.otherBars || ""); const out = new Set(); for (const [, a, b] of s.matchAll(/(\d+)\s*[-–]\s*(\d+)/g)) for (let i = +a; i <= +b && i - a < 12; i++) out.add(String(i)); for (const n of s.replace(/(\d+)\s*[-–]\s*(\d+)/g, "").match(/\d+/g) || []) out.add(n); return [...out]; };
const good = C.filter((x) => ["fixed", "partly"].includes(verdict[x.id]));
for (const v of V) {
  const restored = regs.filter((r) => str(r.song, v, [r.b], r.hand) === r.base).length;
  const kept = good.filter((x) => str(x.song, v, barsOf(x), x.hand) === str(x.song, "cur.js", barsOf(x), x.hand)).length;
  const back = good.filter((x) => str(x.song, v, barsOf(x), x.hand) === str(x.song, ALL[0], barsOf(x), x.hand)).length;
  let changed = 0, total = 0;
  for (const song of Object.keys(songs)) { const a = res(song, ALL[0]), b = res(song, v); for (const it of songs[song].items) { total++; const x = a.notes.get(it.id), y = b.notes.get(it.id); if (x.f !== y.f || x.h !== y.h) changed++; } }
  console.log(`${v.padEnd(14)} regressions (fingers) restored ${restored}/${regs.length} · fixed/partly findings kept as cur ${kept}/${good.length}, back to old ${back} · notes changed vs ALG 2 ${changed}/${total}`);
}
