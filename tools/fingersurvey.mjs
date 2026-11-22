// The fingering on real songs (E7, docs/FINGERING.md §8 "Node"): public/finger.js on tools/dumpkeys.cjs's
// output — the keyboard part as the Score gives it — every invariant (lib/fingerinv.mjs) for every hand
// size, the same result twice and with the notes shuffled, and per song what it did: notes, moved to the
// other hand (m), held keys let go early, too wide (w), frames, ms. Each m and w is listed with its bar
// and beat, to check against the PDF (a hand-over, or an OMR error?).
//   node fingersurvey.mjs        the bundled sample (tools/fixtures/finger/amazing-grace.json, in the repo)
//   PLAY_SCORES=<dir> node fingersurvey.mjs
//                                also the owner's songs, dumped first with PLAY_SCORES=<dir> node dumpkeys.cjs
//                                into KEYS (default <tmpdir>/resonate-dumpkeys) — never in the repo
//   VERBOSE=1                    every m and w
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import C from "./lib/check.cjs";
import { invariants } from "./lib/fingerinv.mjs";
import { ALG, fingerNotes } from "../public/finger.js";

const { ok, skip, done, fail } = C;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERBOSE = !!process.env.VERBOSE;
const KEYS = process.env.KEYS || path.join(os.tmpdir(), "resonate-dumpkeys");
const files = [path.join(HERE, "fixtures/finger/amazing-grace.json")];
if (process.env.PLAY_SCORES) {
  if (fs.existsSync(KEYS)) for (const f of fs.readdirSync(KEYS).filter((f) => f.endsWith(".json")).sort()) files.push(path.join(KEYS, f));
  if (files.length === 1) skip(`the owner's songs: no dumps in ${KEYS} (PLAY_SCORES=… node dumpkeys.cjs first)`);
}
const serial = (res) => [...res.notes].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([id, n]) => `${id}:${n.h}${n.f}.${n.p}.${n.x}`).join(" ") + "|" + JSON.stringify(res.frames);
const shuffled = (a, seed = 7) => { const b = a.slice(); let s = seed; for (let i = b.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [b[i], b[j]] = [b[j], b[i]]; } return b; };

try {
  console.log(`ALG ${ALG}`);
  console.log("song                          hand  notes  moved  let  wide  frames r/l   ms");
  for (const f of files) {
    const dump = JSON.parse(fs.readFileSync(f, "utf8"));
    const items = dump.items;
    const name = (dump.title || dump.song).slice(0, 28);
    if (!items.length) { console.log(`${name.padEnd(29)} —  no keyboard part (${dump.kind})`); continue; }
    ok(dump.alg === ALG || f !== files[0], `${dump.song}: dumped under this ALG (${dump.alg}) — else node dumpkeys.cjs again`);
    for (const hand of ["sb", "mb", "lb"]) {
      const t0 = performance.now();
      const res = fingerNotes(items, { hand, debug: true });
      const ms = performance.now() - t0;
      const bad = invariants(items, res, hand);
      ok(!bad.length, `${dump.song} ${hand}: the invariants hold on ${items.length} notes${bad.length ? ` — ${bad.slice(0, 4).join("; ")}${bad.length > 4 ? ` (+${bad.length - 4})` : ""}` : ""}`);
      const notes = [...res.notes.values()];
      const moved = notes.filter((n) => n.x.includes("m")).length, wide = notes.filter((n) => n.x.includes("w")).length;
      const let_ = [...res.debug.A.let].filter((x) => x >= 0).length;
      console.log(`${name.padEnd(29)} ${hand}  ${String(items.length).padStart(5)}  ${String(moved).padStart(5)}  ${String(let_).padStart(3)}  ${String(wide).padStart(4)}  ${String(res.frames.r.length).padStart(5)}/${String(res.frames.l.length).padEnd(5)} ${ms.toFixed(1).padStart(6)}`);
      if (hand === "sb") {
        ok(serial(fingerNotes(items, { hand })) === serial(res) && serial(fingerNotes(shuffled(items), { hand })) === serial(res), `${dump.song}: the same fingering again, and with the notes shuffled`);
        // (where to look on the PDF: each moved and each too-wide note, by bar and beat)
        const list = items.filter((it) => /[mw]/.test(res.notes.get(it.id)?.x || ""));
        if (list.length) console.log(`  ${list.length} m / w${VERBOSE ? ":" : " (VERBOSE=1: each)"}`);
        if (VERBOSE) for (const it of list) { const n = res.notes.get(it.id); console.log(`    bar ${it.bar ?? "?"} @${it.beat ?? "?"}  midi ${it.midi} staff ${it.staff} (${it.hand ?? "—"}) → ${n.h}${n.f || ""} ${n.x}`); }
      }
    }
  }
  done();
} catch (err) { fail(err); }
