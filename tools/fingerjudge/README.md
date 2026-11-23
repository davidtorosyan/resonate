# Fingering judged on the owner's songs (E7a) — tools to resume

Paused 2026-11-23 (the owner: ship and come back later). State, numbers and the next steps:
docs/FINGERING.md "Review of the owner's songs (ALG 3) — paused". These are the tools; the owner's
songs and everything made from them (dumps, text, judgements) stay outside the repo (CLAUDE.md).

**The work folder** (outside the repo, e.g. the session's scratchpad), `fsurvey/`:
- `xml/r19-<song>.musicxml` — the engine-19 native exports of the owner's nine songs (the Resonate
  connector: `get_score_pdf` page by page → `pdfunite` → `tools/accuracy/` native run; or
  `get_score_xml` for the stored file).
- `keys/`, `keys19/` — `PLAY_SCORES=<xml dir> OUT=<dir> node tools/dumpkeys.cjs`.
- `text/` (ALG 2) and `text3/` (the current) — `node tools/fingerjudge/text.cjs <xml dir> <out dir> r19-`
  (the harness server running; it fingers with the site's own finger.js).
- `confirmed.json` — the pianist review's confirmed findings (`review.workflow.js`'s result, flattened).

**Steps:**
1. `review.workflow.js` — a pianist reviewer per song, two skeptics per finding (Workflow `args: { sp }`).
2. Change `public/finger.js`; `KEYS=<keys19> node tools/fingerjudge/ab.mjs <old finger.js> public/finger.js r19-` —
   notes changed per song.
3. `SP=<work folder> tools/fingerjudge/mkcmp.sh` — old/new text per finding and per changed bar (`cmp/`).
4. `judge.workflow.js` (`args: { sp: '<work>/fsurvey' }`) — a judge per song: each finding fixed / partly /
   unchanged / worse, every changed bar better / neutral / worse.
5. `ablate.mjs` — which change caused which regression (variants of finger.js made with sed).
6. The checks: `node tools/fingercases.mjs` (patterns as synthetic cases), `PLAY_SCORES=x KEYS=<keys>
   node tools/fingersurvey.mjs` (invariants), `KEYS=<keys19> node tools/handcases.mjs` (the drawn hand).

`codereview.workflow.js` — the v100 code review (hand.js, handplan.js, the hooks, finger.js), stopped
part-way: its findings are listed in docs/FINGERING.md.
