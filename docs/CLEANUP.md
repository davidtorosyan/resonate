# Cleanup C: the plan

This is roadmap item C (docs/ROADMAP.md). It was written on 2026-11-21 at 25af8e8 (v93), from four read-only passes over the repo:
- dead code;
- the old pages and how the shell mounts them;
- duplication;
- tests and docs.

**Phases 1–6 are C.** Each one is small and can ship on its own: either one release (bump, push, deploy, a device check) or a change to tools/ and docs/ only. Each gets one review pass and its fixes.

**Phases 7–9 wait.** Each waits for the work that needs it, named in the phase. Anything that only tidies is dropped; the list is at the end. "We're not building a rocket ship."

**Rules for every phase:**
- `tools/regress.sh` is green before and after. After Phase 1 it gives its own verdict.
- Run `tools/regress.sh fast` before every push.
- A phase that ships: `node bump.mjs <N>`, push to `main`, wait for the deploy, then do the phase's device check (the owner's iPhone or iPad, or tell the owner what to look at).
- Nothing the owner sees changes unless the phase says so.
- **No markup that a v93 shell's code reads is removed before Phase 9.** An old shell tab fetches the new HTML: GitHub Pages ignores `?v=`.

| # | Phase | Ships | Size | What the owner sees |
|---|---|---|---|---|
| 1 | Honest checks and the sync-limit foot-gun | no (tools/, docs/, supabase/) | M · ~1 session | nothing |
| 2 | Dead code and leftovers | yes | S · ~½ session | nothing |
| 3 | Links name places; a stale shell reloads | yes | S · ~½ session | nothing (a long-pressed link opens the shell) |
| 4 | The old Tuner goes | yes | S · ~½ session | Tools has no "Tuner (old)" |
| 5 | Copies that drifted | yes | M · ~1 session | Tap the beat follows the count-in in 3/8 and x/16; the Piano recovers when the sound gets stuck |
| 6 | Docs restructure | no | M · 1–2 sessions | nothing |
| 7 | *Waits for E8:* Sing and the places tested in the shell; Sing's hidden Open / Link / ✕ go | yes | M | a file dropped on the desktop shell goes to Songs |
| 8 | *Waits for E7, or the next keyboard change:* Play tested in the shell; Play's page-only code goes | yes | L | nothing |
| 9 | *Optional:* the old pages become fragments; away.js and the webdriver escape go | yes | M | nothing |

Phases 2–4 can go out as one release if that's easier. Phase 3 must be live for a week and at least one release before Phase 9.

## Phase 1 — Honest checks and the sync-limit foot-gun (no release)

**Why first:**
- regress.sh prints green for suites that crash or can't fail.
- The guided-practice unit tests haven't run since tools/ moved into the repo.
- An old migration would cut the cloud back to 10 songs if anyone followed the docs and applied it.

Every later phase depends on these checks. Nothing in public/ changes. Do 1.1–1.5 first, then 1.6–1.10 in a second commit.

**1.1 The sync-limit foot-gun**

Delete `supabase/migrations/20261108200000_sync_fixes.sql`.
- `20261120010000_sync_limits_20.sql` already contains its fix, with the limit at 20.
- CLAUDE.md "Cloud sync" and docs/ROADMAP.md (line 61, Known gaps) still call the old file "optional, not applied". Applied today, its `private.sync_items_write()` (lines 31–32) would put the limit back to 10, and songs 11–20 would be held, silently, on every pass.
- Fix those two docs lines.
- Leave sync.js's retry-as-update (sync.js:619–630) alone: it is harmless.
- Check: synclib.mjs. Nothing is deployed.

**1.2 regress.sh gives a verdict** (tools/regress.sh:26–120)
- Use `cd "$(dirname "$0")"`, not `/home/user/tools`.
- Add one `run <name> <timeout> <cmd>` helper. It reports PASS or FAIL from the exit code, SKIP when the suite printed `SKIP …`, and the time taken. At the end it prints a table and exits 1 if anything failed. Today the script greps for "FAIL": `countin` exits 1 with ENOENT and is reported as `fails=0`, and the Sing loop's `errs` (:30) is never read.
- Preflight: if BASE doesn't answer, stop with "start tools/harness/xb/collect-serve.mjs".
- Make `PLAY_SCORES` default to empty. Today (:33) it points at a dead session's scratchpad.
- Add tools/lib/check.cjs (ok / skip / done → counts + exit code) and tools/lib/paths.cjs (ROOT, PUBLIC, FIX, BASE, OUT, SHOTS). They are for new suites and suites being touched, not a bulk port.

**1.3 A fast tier: `tools/regress.sh fast`** (~2 min, no server)
- Suites: gradecases, timingcases, tempomark, coachcases, practicecases, guidedverdicts, rhythmcases, tracecheck ×3, tracejs, importcontract, synclib, mcpcatalog, plus a new `vcheck.mjs`.
- Fix the imports first:
  - practicecases.mjs:9, coachcases.mjs:6–7 and practicesim.mjs:11–12 import `../resonate/public/…`. That resolves to /home/user/resonate/resonate/public, so all three fail today with `ERR_MODULE_NOT_FOUND`.
  - gradecases.mjs:2, rhythmcases.mjs:6–10, guidedverdicts.mjs:8–14, timingcases.mjs:2/36, tempomark.mjs:2, rhythmharness.mjs:4–5 and rhythmsynth.mjs:13 import `/home/user/resonate/public` by absolute path.
  - Make them all relative to the file.
- `vcheck.mjs` checks two things:
  - every local import and `<script src>` under public/ (not vendor/ or omr/pdfjs/) carries `?v=<badge>`;
  - every page except shell.html carries the badge.
  This guards against the v54 failure, where cached modules of different versions mixed.
- Add tools/package.json with `npm test` → the fast tier. Pin the installed playwright there: 130 suites require it and nothing declares it (harness/noshots.cjs:2 loads it from /opt/node-tools).
- The first run of practicecases and coachcases will likely find stale assertions. Fix the test, or fix the code if the test is right, and say which in the commit.

**1.4 Suites that can't fail**
- **countin.cjs:5** reads two scores from a scratchpad that's gone. Rebuild them as `tools/fixtures/sing/pickup8.musicxml` (an eighth-note pickup in 4/4) and `six8.musicxml` (a 6/8 pickup).
- **stuckctx.cjs:27–29**: exit with its result.
- **unlock, chipkeys, playafter, titlecases and keycases** print but never fail. Add the asserts their output already implies:
  - playafter: each of the 12 paths sounded;
  - keycases: no "NOT IDEMPOTENT";
  - titlecases: the expected title for each case.
  Until then, report them as INFO, not PASS.
- **ahead.cjs:45 and :129** seed `resonate.sing.rate` 1.25, which Sing has deleted since v71, so its "125%" runs at 100%. Seed `resonate.sing.rates` = {"amazing-grace": 1.25} together with `resonate.sing.song`.
- **synclib.mjs:182–188** (case 11) reads v89's sync.js from commit 4b0ec14. A shallow session clone will soon not have that commit. Vendor the file as `tools/fixtures/sync/v89-sync.js`.

**1.5 Tests stop writing into the repo**
- With SHOTS=0, jank.cjs:21–24, shellmods.cjs:24–27, shellplaces.cjs:13–16, shellscore.cjs:11–13, shellsing.cjs:12–15 and sleep.cjs:17–18 create a `tools/0/` directory (it's there now, untracked). Use shell.cjs's rule: SHOTS "0" means no screenshots.
- importresume.cjs:127 (scenario `full`) rewrites the tracked `fixtures/import/greensleeves3.events.json`. Make it do so only with `RECORD=1`.
- Add `tools/0/` to .gitignore.
- regress ends with `git status --porcelain`; anything listed is a FAIL.

**1.6 Run what ships by default**

Add to regress main:
- `guided.cjs` and `BLEED=1 guided.cjs`. Guide me is on by default, yet every Sing suite runs with it off.
- reprocess.cjs. CLAUDE.md and LIBRARY.md say it's in regress; it isn't.
- sleep.cjs, voicetest.cjs, playunit.cjs, playxmlsame.cjs.
- playpdf.cjs, after guarding its unconditional read of the old scratchpad's `v88/ids.json` at :230.

**1.7 The known flake**

shellsing.cjs:254–258 reads the state, then waits (with a swallowed `.catch`), then asserts the old state. Read the state after the wait, once `!moving` and `laidOut()` hold.

**1.8 Tests for the clean-ups that have none**

Do this before D round 2 touches fixscore.js. New `tools/fixcases.cjs`, with one synthetic MusicXML each for:
- `dropInserts` (a boxed fill at the foot of a page);
- the stray-8va revert (a coda sign read as an 8);
- `unifyOctaveClefs` (an 8vb clef found on some systems);
- `foldSparseVerses` (a lyric line read low);
- `restoreTempo` (a tempo only in the log line);
- `markTupletGroups` (unmarked triplets).

Each asserts the change, and that a second run changes nothing. Their old cases were in a scratchpad that's gone. Add it to regress main.

**1.9 Save what only a scratchpad holds**

The accuracy loop's scripts are in this session's scratchpad, `bin/`: acc-native.sh, ab.sh, acc-trace.sh, cmp.py, bar.py, short.py, voicecheck.py, p10.py, p10b.py, triage/*.py. Its workflow script is named in docs/ACCURACY.md. D round 2 can't resume without them.
- Move them to tools/accuracy/ with SP, JDK and INST as environment variables. trace-ab.sh, trace-jfr.sh and trace-resume.sh get the same treatment (the SP and JDK paths are hard-coded).
- Add tools/accuracy/constants.sh, the web `-constant`s every native run uses. The fast tier checks it against omr.js.
- Fix omr-build/README.md:115, which says the trace scripts are "outside the repo".
- Scripts only. The PDFs, conversions and triage text name the owner's bars and stay outside the repo.

**1.10 Delete what can't run** (git keeps it)
- The probes that need an old session's files or the CheerpJ probe servers: chiptap, fitmenu, singfit, fixcheck, jointitle, savetest, singsmoke, transpose, wlend, wlsing, library.cjs, cjaud, cjpage, cjprobe, jamarun, jarbytes, slurrun, symrun, ocr-node-test.
- The superseded ones:
  - playwk.mjs → playwebkit.mjs;
  - e2e-import, tworuns, twotabs-lock → importresume `again` / `tabs`;
  - hdrwidths, singfit390 → they test old page headers.
- **Keep fittest.cjs.** It is fit.js's only test. Drop its missing inputs; it still runs on Amazing Grace.
- Update CLAUDE.md's "tools/library.cjs" to libcore.cjs.
- In titlecases.cjs:9 and the cases after it, replace the buyer's name in the "Authorized for use by …" stamp with a placeholder. The rule only needs the prefix.

**Checks:**
- `regress.sh fast` and main both end with a table.
- countin passes.
- The three guided-practice suites run.
- `git status` is clean after a run.

**Must stay identical:** every suite that passed before still passes. public/ is untouched.

### Phase 1 — as built (2026-11-21; 7d8e62f for 1.1–1.5, the commit after it for 1.6–1.10; public/ untouched)

- **Verdicts:** `regress.sh fast` (17 rows, ~2 min, `npm test` in tools/) and main (the fast tier, then the browser suites) end with a table and exit 1 on a FAIL. A FAIL line under exit 0 is a FAIL too. "Checkout untouched" compares git status, and the content of what was already uncommitted, before and after the run, so it also works in a dirty checkout. Logs go to `REGRESS_OUT`. The fast tier also runs `accuracy/constcheck.mjs` (1.9).
- **Stale tests the honest checks found, fixed in the tests:**
  - practicecases (182) and coachcases (90) had none.
  - playafter: while a review line plays, Play reads ■ Stop.
  - play.cjs, since de820b7: a duet partner's own staff keeps its words (`words.also`), and score-voice-partner's Both carries the words.
  - playpaper Z: without the owner's Piano Man the spread check used synth-pvg, one page at 5 px; it now uses synth-pvg three times over.
  - shellsing's two home checks read the state before their wait (1.7).
- **Real, reported, not fixed (public/):** synclib 9b fails in most runs, at HEAD too. sync.js's next pass notes a song deleted during a space change with a stamp newer than the pulled tombstone (take1: `modified_at <= ours`). So the queue entry and stored jobs left behind are cleared only when both land in the same millisecond.
- **Beyond the letter of the plan:**
  - keycases is in main.
  - The Sing suites that printed `errors:` now check for no page errors; so do stuckctx, unlock and voicetest.
  - titlecases skips the owner's PDFs that sitetest doesn't have (`/wl.pdf` is `wichita.pdf` now).
  - tracejs and importcontract use relative paths.
- **1.9:** acc-native, acc-trace and ab.sh, plus pairs-run.sh (round 1's pairs15.sh, its songs as arguments), share `env.sh` (SP required; JDK and INST defaulted). The trace-*.sh scripts stay in tools/ and use the same `env.sh`. The workflow script is copied as `review-workflow.js` (the pairs folder as `args.dir`). The bar and triage tools moved as they were, except that fmt.py takes its data file as an argument. pairs.cjs keeps its scratchpad default, because the running accuracy work calls it.
- **Not run here:** `IMPORT_E2E=1` (the real conversions) and the live suites (account, sync2–4, mcp1/2).

## Phase 2 — Dead code and leftovers (one release; nothing visible)

**2.1 Functions nothing calls.** grep finds only their definitions:
- music.js:12–14 `midiToFreq`;
- omr/readerstate.js:248–249 `currentStep` / `currentSystem`, :252 `isPerSystem`, :444–448 `pitchText`;
- space.js:76 `isFresh`;
- play.js:3871–3875 `pdfAgain` (the button calls `reprocess()`, :3292).

**2.2 Leftovers that are always empty**
- Sing's `#score-pct`: remove the JS (sing.js:43, :3105, :3113) and the CSS (sing.html:219–220). It was left over from the graded % that v58 removed.
- The `<span>` at sing.html:470 stays until Phase 9: a v93 shell's sing.js writes to it.
- Play's debug fields `hushed` / `hushEls` (play.js:4056). Nothing has added `.hush` since v86.
- Tests to update:
  - loop.cjs:53, pitchmon.cjs:156, review.cjs:54, gradeearly.cjs:38;
  - playhear.cjs:397–419, playchords.cjs:412–427, playhearwk.mjs:58–74. Keep their "muted is never lit" check, through `litEls`.

**2.3 nav.js's import pill on the shell**
- Return before wiring the MutationObserver and the storage / resize listeners when `<html data-shell>`. Today nav.js:114–120 installs them on every page; on the shell every `hidden` change anywhere in the body runs `placeSoon`.
- Drop the `shell\.html` half of the path test (:68). The stub never loads nav.js.
- The placement logic stays while tuner.html and tools.html still show the pill (Phase 4).

**2.4 Migrations for versions long gone**

Remove:
- sing.js:3842–3856: the global transpose (before v31) and the global tempo % (before v71), each moved to the open song.
- sing.js:461–470: v32's single "fit".
- play.js:57 and :149: `OLD_SIZE_KEYS`, removed again on every Score load since v79.
- Their `K` entries (sing.js:66–72).
- `"resonate.sing.rate"` and `"resonate.sing.transpose"` in DATA_KEYS (space.js:33, :43). Only these two names; nothing else in space.js.

These are preferences only: a device that skipped those versions falls back to the defaults.

Keep:
- **The custom-song move** (sing.js:3831–3840, `K.legacyXml` / `legacyName`). It is the only one whose removal could lose a song (a Home Screen app not opened in months), and it is 10 lines.
- songview.js:41–52 (v86's module names) until about v100.
- `resonate.volCal` (app.js writes it; profiles.js and shell/tuner.js read it).

Tests: taptiming.cjs and typetempo.cjs set `resonate.sing.rate`; drop those lines.

**2.5 Small things**
- In play.js, rename the local `sleepAudio` (:1346, called at :1331, :1344, :3566) to `stopAwake`. It means "stop the keep-awake source"; piano.js's export of the same name means "suspend every context".
- `git rm public/load.png`: an old screenshot, unreferenced, published on every deploy.
- Delete server.js:60–62 `/api/hello`.

**Checks:**
- regress main and fast.
- playxmlsame (every view's XML byte-identical).
- importfixes M/O/X, cutover (no pill at the root), shell.cjs:396.
- Device: a Sing take and its review, a press on the Score. Nothing should look different.

**Size:** about −250 lines.

### Phase 2 — as built (2026-11-21, with Phase 3 in one release; not bumped or deployed yet)

- **2.1:** all six went: `midiToFreq`, readerstate's `currentStep` / `currentSystem` / `isPerSystem` / `pitchText`, `isFresh`, `pdfAgain`.
- **2.2:**
  - `#score-pct`'s JS and CSS are gone.
  - The `<span>` stays, now `hidden`. Without its `:empty` rule, an empty flex item would add the row's gap before the summary.
  - Play's `hushed` / `hushEls` are gone. playhear E, playchords M and playhearwk still check "muted is never lit", through `litEls` (and the keyboard's keys).
- **2.3:** On `<html data-shell>`, nav.js wires nothing for the pill. Its path test is `pdf-import.html` alone.
- **2.4:**
  - Removed: the global transpose and tempo moves, `OLD_SIZE_KEYS`, their `K` entries and the two DATA_KEYS names.
  - taptiming and typetempo no longer set `resonate.sing.rate`.
  - playbackfixes Z8 and playpaper Z expected v78's size prefs to be removed. Now they only check that the prefs are ignored.
  - **Kept: sing.js's "fit" conversion (the plan's 461–470).** It isn't only v32's. "Fit my range…" (value `"fit"`) is still what Sing stores when it is chosen without a voice range, and this code turns it into the best fit once a range exists. Checked: keys `{song: "fit"}` + a profile range → −13 on load. Without it the menu would stay on "Fit my range…" after the range test. Its comment says so now.
- **2.5:** play.js's local `sleepAudio` is `stopAwake` now; load.png and `/api/hello` are gone.
- **Checks:** playxmlsame PASS, importfixes M/O/X PASS (O updated for 3.1), cutover R (no pill at the root) PASS, shell.cjs PASS.

## Phase 3 — Links name places; a stale shell reloads instead of mixing versions (one release)

**3.1 Links point at `./?open=<place>`**

Today every in-shell link to Record, Voice or Assistants works only because a capture handler (places.js:176–186) or away.js catches it. A long-press "Open in new tab" on the iPad lands on the old page and bounces. Change:
- index.html:525 (`#rec-btn` → record.html);
- shell/account-menu.js:40, :43;
- shell/tuner.js:339, :346 (→ voice.html);
- sing.js:350 ("Set your range");
- the default "Sing it" / "Play it" links in omr/reader.js:256 and shell/tray.js:89 (the tray intercepts them at :165–172);
- nav.js:79 (the pill → `./?open=import`).

`placeOf` (places.js:30) also reads `?open=`, and accepts the old file names for one more release. boot.js:29–41 already maps every `?open=`.

Delete the `go("sing.html")` fallback at songlist.js:31–36. boot.js:77 sets the opener before any UI exists, so it can't run.

ROADMAP lists a known gap, "Fit my range… goes to voice.html". If it still happens, this fixes it; check on the iPad.

**3.2 The stale-shell guard** (REDESIGN §19.8 planned it; it was never built)

The problem:
- GitHub Pages ignores `?v=`.
- A shell tab opened before a deploy (the iPad on the music desk, a suspended Home Screen app) can mount Sing, the Score or a place for the first time after the deploy. It then gets the new markup and the new modules under the old shell.
- Today that is a silent version mix. Once markup changes (Phase 9) it is a crash.

The fix, in shell/singview.js:65, scoreview.js:62 and places.js:62, right after DOMParser and before the import:
- Compare `doc.getElementById("version")?.textContent` with the shell's badge.
- If they differ and `!resonateBusy()`: `location.replace("./?open=sing|score|<place>")`. boot.js reopens the same state.
- Do this at most once per 10 min (sessionStorage), so a cached index.html can't loop. Otherwise mount as today.
- About 20 lines: one helper, used three times.

**3.3 Scripts that only import modules stop loading sing.html**

titlecases.cjs:5 (in regress), keycases.cjs:75, repeatcases.cjs:55, flow.cjs:6 and harness/xb/libcheck.mjs:9 load the whole Sing page only to `import()` modules. Use tools.html instead, as jobstore.cjs:14 and libcore.cjs:19 do.

**Tests:**
- These select `a[href="voice.html"]`: shellplaces.cjs:252–253, :288–289; shell.cjs:165, :244, :252. Update the selectors.
- reader.cjs:157 expects `links[0][1] === 'sing.html'`.
- cutover L; songlib.
- A new check in cutover.cjs: serve sing.html / play.html / voice.html with badge v0. The shell should land on `./?open=…` without mounting; a second try within 10 min mounts; a matching badge mounts as now.

**Device check** (iPhone and iPad):
- Record, Voice and Assistants from the menu and the dock.
- The tuner's range ribbon → Voice in place.
- A converted song's "Sing it" / "Play it".
- A tab left open across the deploy reloads into Sing when Sing is opened.

### Phase 3 — as built (2026-11-21)

- **3.1:**
  - Every link in the plan's list names its place: `./?open=record|voice|assistants`, `./?open=sing|score` for the Reader's and the tray's defaults, `./?open=import` for nav.js's pill.
  - `placeOf` reads `?open=` (own keys of PLACES only), and the old file names for one more release.
  - songlist's fallback is gone (and its `go` import).
  - Tests: shell.cjs and shellplaces select `#acct a[href="./?open=voice|assistants"]`; reader.cjs expects the two new defaults.
  - importfixes O: the pill now opens the shell's tray, shown. pdf-import.html, reached from a link, still keeps the minimized pref for a reload.
  - importresume `tabs` (IMPORT_E2E only): the pill's href.
  - cutover L and songlib passed unchanged.
  - **"Fit my range… goes to voice.html":** not reproduced at v93's code in Chromium (iPad and iPhone sizes) or in WebKitGTK. The capture handler already opened `voice.html` in place. With the link named `./?open=voice`, even an uncaught tap lands on Voice in the shell. ROADMAP keeps it as a device check.
- **3.2:**
  - `staleShell(doc, open)` in shell/chrome.js is called right after DOMParser in singview, scoreview and places. It compares `#version`, checks what's under way, and keeps a sessionStorage `resonate.shell.stale` stamp for 10 min.
  - Under way is boot.js's `setUnderWay`: the tray busy, Sing or the Score sounding (songview `soundBusy`), an assistant's command running (remote.js `busy`). It was `resonateBusy` at first, whose `switching` / `closing` made the shell's own module change count as busy (v94 review, below). `resonateBusy` stays as it was for nav.js's reload.
  - Sing loaded hidden for 📡 at home (no song page open) reloads to `./`.
  - cutover G (iPhone and iPad, 16 checks each):
    - sing.html (Next-up), play.html (`?open=score`) and voice.html (a link) are each served with badge v0;
    - each gives one reload into `./?open=…`, with no sing.js / play.js / voice.js asked for before it and nothing mounted as the page left;
    - each lands there, mounted on the second try;
    - another badge while busy: no reload; a matching badge: no reload.
  - **v94 review (2 verifiers each; the fixes):**
    - The guard never fired when Sing or the Score was first mounted by the shell's own module change: a toggle (the iPad's Score + Piano, then Sing; the phone's Sing, then the Score), the Reader's Sing it / Play it on the song open, a song switch whose modules differ. `songview.busy()` counted the `switching` doing the mount. Now the narrower predicate above; setMods has stopped the sounds by then.
    - A 📡 command that mounted Sing or the Score on a stale shell was claimed, then the page reloaded: never run or answered (the claim blocks the reloaded page), and score_open reopened the previous song. Now a running command counts as under way (the mount happens in place, as before), and remote.js writes the open song (`setOpenSong`) for the song showSing / score_open / a PDF only opens, so a later reload reopens that one.
    - A place's reload over an open song closed the song (`./?open=voice` lands at home). Now a place with a song open (`pageOpen()`) mounts in place without the guard: the simplest; the address can't carry both.
    - Not fixed (low): after the reload, Back takes an extra step through a second home entry (ROADMAP known gaps).
    - cutover G is now 30 checks on the iPhone and 28 on the iPad: the toggles, Sing it / Play it, a switch to a PDF only from Sing (each: one reload, nothing mounted before it, lands there), an import under way for a place and for the iPad's toggle, a place over an open song. 17 of the new checks fail on the build before the fixes (the others: no page errors, and the import under way, which held before too). shellplaces desktop: open_song and score_open on a stale shell run in place and are answered; score_open's song is the open song, and the Sing toggle afterwards reloads into it (8 checks, 6 failing before).
- **3.3:** titlecases, keycases, repeatcases and flow load tools.html. So does libcheck.mjs, which drops its `#my-songs` read and checks `listSongs` alone.
- **synclib 9b (sync.js):**
  - The cause: a pulled delete applied while the space changed under it removed the song, but left its queue entry and jobs, which belonged to the other space by then. It also wasn't recorded, because `saveMeta` never writes into another space. On the next pass in that space, `noteChanges` took the song's absence for a delete of its own and stamped it with now. take1's "ours is newer" then passed the cloud's tombstone over for good. (It passed only when the push's dropped-write path happened to refetch it.)
  - The fix, in take1: a song's tombstone met by a delete of ours that hasn't gone up is applied anyway. Both are the same change, so nothing is sent. apply's delete is idempotent: no song to remove, the queue and jobs cleared, `gone` said.
  - `node synclib.mjs`: 12 of 12 runs PASS (the old sync.js: 5 of 10 FAIL).
  - v94 review: applying the cloud's tombstone in place of our delete moved ours back in time when ours was the later one. A change another device made between the two (stamped after the cloud's delete, not sent yet) then won, and the song came back everywhere. Now our pending entry is put back after the apply when it's later, so it still goes up; equal stamps send nothing. synclib 13 (three devices) checks it, failing on the build before. 10 of 10 runs PASS.

## Phase 4 — The old Tuner goes (one release)

This was planned in docs/CUTOVER.md. shell/tuner.js is the port, and it is the home screen. **Before starting, send the owner one line:** "Tools → Tuner (old) goes — OK?"

**Remove:**
- public/app.js (672 lines).
- tuner.html's page (548 lines). tuner.html becomes a 3-line stub to `./`, like shell.html, with no badge, so a bookmark still works. Update CLAUDE.md's "`grep -L` lists only shell.html" note.
- The Tools card (tools.html:59–62).
- nav.js:23's `app.js` reload clause.

**Keep** the volCal reads (profiles.js:39–44, shell/tuner.js:40).

**nav.js's pill** now shows only on tools.html. Reduce `placePill` (nav.js:92–109, which steers around Sing's Listen, Play's keyboard chips and the Tuner's controls) to a fixed bottom-left link. Move importfixes M/X to tools.html.

**Tests:**
- Delete tunerfix.cjs and tunerprof.cjs. They test tuner.html only; shell.cjs:267–278 covers play-and-record before getUserMedia and the 8 s watchdog.
- Drop tuner.html from sleep.cjs:165–197, smoke.cjs:5 and playheaders.cjs:11.
- cutover R: tuner.html → the stub.

**Must stay identical:** the shell's tuner (shell.cjs, shellmods, sleep.cjs's shell part).

**Device check:**
- The home tuner listens.
- Tools has no Tuner card.
- An old tuner.html link lands on home.

**Size:** about −1,250 lines.

### Phase 4 — as built (2026-11-21, the owner's OK relayed; in the same release as Phases 2–3)

- **Removed:**
  - public/app.js.
  - tuner.html's page. It is now a stub, like shell.html: `location.replace("./")` and a "Resonate ›" link, no badge. vcheck's STUBS has both stubs.
  - The Tools card.
  - nav.js's app.js reload clause. A session that ended still parks the account's data (`park()`); only the reload went.
- **nav.js's pill** is a fixed bottom-left link. `placePill`, its 1.5 s re-place, the MutationObserver and the resize listener are gone; the storage listener stays.
- **Kept:**
  - The volCal reads (profiles.js `LEGACY_VOL`, shell/tuner.js).
  - pitch.js, which the shell's tuner, Sing, Record and Voice use.
- **Comments** that named app.js as live now name shell/tuner.js (profiles.js, pitch.js, voice.js, shell/tuner.js).
- **CLAUDE.md:**
  - The Pages entry is the stub's. Its iOS audio-session, watchdog and sleep notes stay, as the shell tuner's.
  - "Pitch detection", "Locked-note display logic" and "Tunable constants" point at pitch.js and shell/tuner.js, with the two volume defaults and the watchdog added.
  - "Volume meter" is the shell's `showLevel`. The old `(dB + 55) * 2` text was already wrong: app.js had used the calibrated floor and ceiling, −65 / −5 dB by default.
  - The `grep -L` note names both stubs.
- **Tests:**
  - tunerfix.cjs and tunerprof.cjs are deleted.
  - tuner.html is out of sleep.cjs, smoke.cjs and playheaders.cjs.
  - cutover R: tuner.html lands on home, with no history entry of its own and no badge or app.js in the stub.
  - importfixes M (the pill's text) and X move to tools.html. X now checks the link: fixed at the bottom left, in view, z-index 30 (under the sheets' 40+), and it stays put when a control shows up where it is. importfixes O still starts from the pill.
- **Checks:** sleep 108/108 (the shell's part unchanged), smoke, playheaders, cutover R/S, importfixes M/O/X, vcheck. The full regress covers Phases 2–4 together (Phase 3's report).

## Phase 5 — Copies that drifted (one release)

Each item fixes a copy that has already drifted. Each is small and has a test.

**5.1 Sing's take-rhythm code in a module of its own**

Today the node suites can't import it, so they test hand-kept copies:
- the code: sing.js:1013–1135 (`metricOf`, `rhythmOf`, `phraseRhythm`), plus `feltBeat` / `meterAt` / `measureAt` (:175–181);
- the copies: guidedverdicts.mjs:19–70 and rhythmharness.mjs:31–47.

The change:
- Move the code to `public/takerhythm.js`. It imports rhythm.js and `PRACTICE`, and takes explicit arguments.
- sing.js keeps one-line wrappers.
- The two test files import the real functions, and their copies go.
- A pure move. E8 builds on it.

Check: rhythmcases.mjs (39 cases), guidedverdicts.mjs, practicesim.mjs, guided.cjs with BLEED=1 (it fails on any rhythm or practice warning), rhythmpage, review. Compare the printed numbers before and after. If guidedverdicts' numbers change, the copy had drifted: that is the finding; report it.

**5.2 Tap the beat taps the felt beat**

sing.js:3481 `tapQ` (`t === 8 && b % 3 === 0 ? 1.5 : 4 / t`) disagrees with `feltBeat` (:179):
- in 3/8 it expects one tap a bar while the count-in clicks eighths;
- in 12/16 it expects sixteenths against dotted eighths.

Set `tapQ = feltBeat(meterAt(entryIdx)).q`. Only 3/8 and x/16 meters change.

Check: taptiming.cjs plus a 3/8 case, countin, timingcases. 4/4, 3/4 and 6/8 stay identical.

**5.3 Audiveris's step list, once**

The same list is in omr/omr.js:46–47, omr/readerstate.js:29–30 and omr/trace.js:18–19. Keep trace.js's copy (a leaf module). readerstate imports it, and omr.js re-exports it. If D round 2 adds a step, three copies would disagree: trace.js rejects unknown steps.

Check: tracejs, tracecheck, reader.cjs (unit part), importcontract.

**5.4 The shell Piano recovers from a stuck context**

shell/pianoview.js:78–87 `fresh()` replaces only closed or interrupted contexts. A resume that never settles (iOS, the v56–57 case) leaves the Piano silent until a reload. play.js:1274–1297 already has the fix (`acStuck`): if a tap's resume is still pending after 1.5 s, the next touch makes a new context; a press never marks it stuck.

Copy those ~8 lines into the Piano. Nothing else in its sound path changes.

Check:
- A new shell-Piano case in stuckctx.cjs: a resume that hangs, then the next tap sounds.
- shellmods (press, tuner, take, hidden).
- jank A3/A5.
- Device: the Piano at home on the iPad.

### Phase 5 — as built (2026-11-21; shipped in v95)

- **5.1 `public/takerhythm.js`:** `metricOf`, `rhythmOf`, `phraseRhythm`, `feltBeat`, `meterAt`, `measureAt`, moved out of sing.js unchanged but for their inputs. They take explicit arguments: `metricOf(score, notes, lines, qToT)`; `rhythmOf({ s, v, cal, stopAt, settings, take, score, notes, lines, qToT, tapped, songPhrases })`, where `tapped` is `useMap && tmap` and `songPhrases()` is the song's phrases while guiding, asked only for a free take, as before. It imports rhythm.js and `PRACTICE`. sing.js keeps wrappers: `meterAt`, `measureAt`, `feltBeat`, `metricOf()` and `rhythmOf(s, v, cal, stopAt, settings)`. Its rhythm.js import is down to `makeFeatures`, `findClicks`, `tolOn`. Checked: a diff of the moved block against HEAD's shows only the arguments (and `P.PRACTICE` → `PRACTICE`; `phraseRhythm`'s unused `per` dropped).
  - The copies went. rhythmharness.mjs `metricFor` builds a one-meter score (4/4, or 6/8 for `div: 3`) and calls the real `metricOf`. guidedverdicts.mjs's `phraseRhythms` (its "reference for the integrator") is gone: `round()` builds the session and the take as `startSing(part)` / `finishSing` would and calls the real `rhythmOf`, then prOf's `{ ...phrase, notes }`.
  - **Numbers.** rhythmcases.mjs: every printed line identical (42 PASS). practicesim.mjs: identical. guidedverdicts.mjs: **the copy had drifted**, in three ways:
    1. `cover`: the real code takes one span (first note → last note's end, lead-shifted); the copy took the notes' covers weighted by length. 99 → 100% (on time, breathy first syllable), 98 → 99% (a run's 2nd phrase). No verdict changed.
    2. A phrase's `obs[].li` is its index in the span (0, 1) in the real code, the song's phrase index (1, 2) in the copy. Nothing reads it (timeVerdict filters by scope, coach by `j`).
    3. **The counting slip after a quiet rest inside a run** (v76's review, in sing.js since): the copy never had it. A run's 2nd phrase now has a lag: 0.00 beats on time, 1.00 a beat late. "run: 2nd phrase a beat late" was `try` "Let the beat lead" (rushing) on the copy and is now `slip` "Count in — “as” a beat sooner": the documented rule (CLAUDE.md, Guided practice → Verdicts). The check "lag only on the span's first phrase" encoded the copy's rule. It is now "an entry lag on the first phrase and after the rest, both on time", plus one new check that the late 2nd phrase is a slip with "a beat sooner". 26 + 1 checks pass where 27 did (28 in all).
- **5.2:** `tapQ = () => feltBeat(meterAt(entryIdx)).q`. `unitGlyph` gained 𝅘𝅥𝅯 (0.25) and ♪. (0.75), so 12/16 reads "♪. = 120" rather than falling back to ♩. taptiming.cjs (now on lib/check.cjs and lib/paths.cjs; its screenshot goes to SHOTS) taps every 0.5 s, timed in the page, on four fixtures. Two of them are new in tools/fixtures/sing/: three8 (3/8) and twelve16 (12/16).
  - pickup8 (4/4): ♩ = 120, ♩=120. six8 (6/8): ♩. = 120, ♩=180. Both are the same before and after, as is the default song (3/4).
  - three8: ♪ = 120, ♩=60. On HEAD's build it read ♩. = 120, ♩=180.
  - twelve16: ♪. = 120, ♩=90. HEAD: ♩ = 120, ♩=30.
  - On HEAD's build the four new 3/8 and 12/16 checks fail (15 of 19 pass); here all 19 pass.
- **5.3:** trace.js keeps `STEPS`. readerstate.js imports it and exports it again; omr.js imports it with `createTrace` and re-exports it (importer.js still takes it from omr.js). The tools' own lists stay: tracecheck.mjs is the trace grammar's independent check, importcontract.mjs the contract's.
- **5.4:** shell/pianoview.js copies play.js's `acStuck`. A `stuck` flag: `fresh()` replaces a stuck context too. A new `wake(a, how)` races the resume against 1.5 s; a "tap" (a key's lift) still pending then marks the context stuck, a "press" never. The press and the lift's resume go through it; the first-tap unlock is unchanged, as Play's `unlockPlay`. `resonateDebug().piano.stuck`. Nothing else in the sound path changed.
  - stuckctx.cjs (now on lib/check.cjs) has a Piano case: the shell at home on an iPad, its Piano on its own. A tap sounds. Then the context is suspended and its resume never settles from then on (a context whose resume once hung stays dead, as on iOS; Sing's case behaves the same with it). The next tap is silent and the context is marked stuck. The tap after that sounds on a new context.
  - On HEAD's build that last tap is silent on the same dead context (2 of 5 Piano checks fail). Here all 10 pass, Sing's included.
- **Checks:** fast tier 17 PASS. rhythmcases, guidedverdicts, practicesim compared above. taptiming 19/19, stuckctx 10/10. tracejs, tracecheck ×3, importcontract PASS; reader.cjs greensleeves and greensleeves3-real 97/97 each. The full main run (79 rows: 78 PASS, 0 FAIL, chipkeys INFO; guided, rhythmpage, review, countin, shellmods, jank in it).
- **The review (v95, wf_b382398f-200; 6 findings, 3 confirmed, fixed):** guidedverdicts' "phrase observations carry the phrase index" read the take's observations (keyed by lyric line) and passed by the fixture's coincidence — now each phrase's own, keyed by its place in the span; the shell Piano's keep-awake source stayed on a replaced context (play.js tracks `awake.a`; now this copy too — stuckctx.cjs checks it follows, failing without the fix); Tap the beat in a pickup bar that carries the old meter took the entry bar's meter while the count-in takes the next bar's (`tapQ` now `feltBeat(countInMeter(entryIdx))`). Refuted: a press's timer clearing a tap's stuck mark (as play.js), the press half untested, the pickup claim's severity.

## Phase 6 — Docs restructure (no release)

See "Docs restructure" below. Do it after Phases 1–5, so the docs describe the code as it ends up.

Fold in these stale references:
- CLAUDE.md:18 (/home/user/tools);
- CLAUDE.md:48 (SAMPLES is in catalog.js:7);
- CLAUDE.md:148 ("Future: … rhythm/timing scoring", built in v58);
- tests named but never built: today.cjs, layoutcases.mjs, ui.cjs, measure.cjs, paper.cjs and shots.cjs (REDESIGN), spans.cjs and phraseverdicts.mjs (COACHING), min.mjs (PLAY), acc-native.sh and pairs15.sh (ACCURACY) → "planned, not built", unless 1.9 committed them;
- PLAY.md:491's list of what regress runs.

Add `tools/harness/setup.sh`: CLAUDE.md:19's fresh-container paragraph as an idempotent script, with `--check` listing what's missing.

Check:
- `tools/doccheck.mjs` (fast tier):
  - every `tools/…` and `public/…` name in the docs exists;
  - every doc in CLAUDE.md's map exists;
  - CLAUDE.md stays under 25 KB;
  - every file name the old CLAUDE.md mentioned appears somewhere in the new docs.
- The one review pass: a fresh agent does three tasks from the new CLAUDE.md plus the area docs: bump and deploy, a change to Sing's timing, an engine patch.

**C can stop here.**

## Deferred phases (do each as the first step of the work that needs it)

### Phase 7 — Sing and the places tested in the shell (before E8 starts)

**Why:** 15 Sing suites in regress open sing.html through away.js's webdriver escape. Users run Sing only inside the shell: CSS scoped, Listen / Sing in the dock, sheets in `#sing-layer`, the tuner parked. E8 reworks Sing, so its tests should run in the shell from the start.

**The shim:** `tools/harness/inshell.cjs`, loaded with `node -r`, like guidedoff.cjs.
- It maps `…/sing.html` → `index.html?open=sing`, seeds `resonate.sing.song` when it is unset, and waits for `resonateSing.state().song`.
- It maps record / voice / assistants.html → `?open=…`.
- `resonateDebug()` becomes `(window.resonateSing?.debug ?? resonateDebug)()`.
- It also rewrites the suites' stale `?v=71–80` module imports to the page's own version.

**Fixes in the suites:**
- `#song-select` is hidden in the shell, so use `resonateSing.open(id)` in loopguard, singpdf and catalog.
- Coordinate touches in chipkeys, iosgate and pitchmon.

Once green, write the new URLs into the files and delete the shim.

**Then, in the same phase:** remove Sing's own Open / Link / ✕ / file-input JS. That is sing.js:595–668 (`formatHint` — its PDF hint still says "Tools → PDF → Song" —, `importFile`, `normalizeLink`, `importLink`) and :3610–3632. songlist.js:316–389 has copies of these.
- Move desktop drag-and-drop (sing.js:3711–3728) into songlist.js: a PDF → `addPdfs`, anything else → `importFile`.
- Keep `#song-select` (sing.js reads it as state) and the row's markup until Phase 9.
- countin.cjs loads through `#file-input`: switch it to seeding the library.
- singpdf.cjs:62, catalog.cjs:76, play.cjs:1103–1105 and sync2.cjs:126 use `#remove-song`: switch them to forget.js.
- Add a drop check to songlib.cjs.

**Check:** regress opens no sing / record / voice / assistants.html. The suite counts equal the page-target counts before the switch. shellsing and shellplaces stay as they are.

### Phase 8 — Play tested in the shell; Play's page-only paths go (before E7, or the next keyboard change)

**Deferred (2026-11-22):** mapped against the code at 75ab952 — docs/CLEANUP-PHASE8.md (ten corrections to the text below, the deletions rule by rule, every suite, 35–40 h). E7 takes only the slice it needs.

**Why:** the shell sets `keysOn = false` (scoreview.js:81) and hides `#keys`, so no user sees Play's docked keyboard, 🎹, the song menu, play.html's 📡, or the standalone bar. Yet on play.html the tablet default docks that keyboard (play.js:1657), so most Play suites measure a stage and a bar that no user has. The result is two keyboard paths to keep in step.

**Port the suites:**
- Use the same shim → `?open=score`, seeding `resonate.shell.modules` per device ({score} or {score, piano}).
- The WebKit copies of play.html (playwebkit.mjs:10, playbackwk.mjs:12, playhearwk.mjs:14, playpresswk.mjs:32, playscore.cjs:592) copy index.html instead.
- Recalibrate playpaper to the region's stage.
- Retire playkeys.cjs (476 lines), playheaders.cjs (keep its tools / account / audiotest rows), playv80fixes N/L/K/B and playhear's keyboard-off home.

**Then delete:**
- the docked keyboard (play.js:1640–1716, and placeHear's dock branch at ~1860–1875);
- the `resonate.play.keys` pref (:3633);
- `#song`'s handler (:1101–1110). `score_open`'s song list comes from catalog.js `songChoices`;
- play.html's 📡 (:3998–4014);
- the `pdf-import.html?reprocess=` fallback (:3315–3318);
- `|| $("play")` (:38);
- the standalone bar's CSS (play.html:94–200);
- play.js imports `device()` from shell/chrome.js.

Keep `#dock` with `#hear` and `#strip` in the markup: pianoview.js:46–49 and scoreview.js:71 use them.

**Check:** the ported Play suites and the WebKit suites; shellscore, shellmods (drop its "play.html 🎹 untouched" clause, :204), jank, mcp2's `score_open`.

### Phase 9 — The old pages become the shell's fragments (optional; only when Phase 3 has been live a week and Phases 7–8 are done)

**Per page:**
- Remove the module `<script>` tags, the away.js tag and the header. The header nodes the shell takes — Sing's `#status`, `#assistant-chip` and `#remote-btn` — move into a plain div.
- Keep the filenames and every id a v92+ shell takes. v92–v93 shells keep fetching these files.
- Keep a hidden `#version` (bump.mjs stamps it; 3.2 reads it).
- Add an inline head redirect for people: `location.replace("./?open=<x>" + search + hash)`, the page hidden, and a plain link after 3 s, as in shell.html.
- Move each module's JS `OVERRIDES` (singview.js:18–40, scoreview.js:18–48, places.js:33–50) into a second `<style data-shell>` in its fragment. `scopeCss` reads only the first `<style>`, so old shells are unaffected; the JS copies go a release later.
- Drop the page-chrome CSS that is dead in the shell (e.g. sing.html:26–43, :377–396).
- Remove Sing's hidden first row (sing.html:430–442; singview.js:23, :78–79), the `#score-pct` span, and the place scripts' `document` fallbacks for `$` (record.js:12, voice.js:15, assistants.js:9).

**Then delete:** away.js, nav.js's `data-away` wait (keep `handing`, for email links), and the `navigator.webdriver` / `resonate.redirect` escape.

**Shared ids** (`#play`, `#status`, `#msg`, `#strip`, `#copy`) stay. Add a shell.cjs check that `#play` and `#status` resolve inside `#sing-region` while Sing is mounted.

**Check:**
- cutover / cutoverwk, trimmed: no module script in any fragment.
- An email hash on sing.html reaches account.html.
- curl each old URL.
- On the device: a sing.html bookmark and the Home Screen app, swiped away and reopened.

### Later, not C

pdf-import.html / .js and nav.js's import pill go once the tray has **Copy log** (tray.js already collects the log, :55–60) and the Audiveris / CheerpJ credit, and importfixes / importresume / importreader run on `index.html?pdf=`. Until then the page stays behind Tools' `?page`: it is where the engine log comes from for a phone-only failure.

## Do not touch

- **The analysis modules:** pitch.js (YIN), grade.js, rhythm.js, coach.js, practice.js, timing.js, fit.js. They are pure and node-tested. 5.1 only moves sing.js's glue next to them.
- **omr/fixscore.js until D round 2 settles.** 1.8 only adds tests.
- **playprep.js's `buildView` and the measure walkers.** Views must stay byte-identical (playxmlsame).
- **piano.js:** `scheduleAhead`, `holdPiano`, `pianoBus`, `keepAlive` (tuned for WebKit).
- **library.js and omr/jobs.js.** The two IndexedDB wrappers differ on purpose.
- **sync.js and space.js** (data safety): 2.4 removes two names from DATA_KEYS, nothing else. Keep the v89 compatibility: the "null" text, an index without `k`, meta `v: 2`.
- **The Reader** (omr/reader.js, readerstate.js; tuned for speed). 5.3 only imports STEPS.
- **shell/songview.js's sound arbitration** and **shell/scopecss.js** (it keeps Safari's `-webkit-` properties).
- **The old pages' filenames and every id a v92+ shell's mount code takes.** Until Phase 9, nothing a v93 shell binds leaves their markup.
- **Plumbing:** the shell.html stub, bump.mjs and `?v=`, away.js (until Phase 9), nav.js's `handing` wait.
- **Data the app still reads:** the `resonate.volCal` reads, the custom-song migration.
- **The MCP tool list** (frozen, catalog.ts) and the deployed function. The 📡 wording waits for E2.
- **Engine and vendored code:** omr-build/, public/omr/lib, public/vendor/, omr/pdfjs/.

## Dropped (not worth it now)

- **Merging the five playback-context getters and nine `setSession` copies.** Each is tuned to its page's iOS rule. Merging touches every sound path on the iPhone for no reported bug; 5.4 takes the one real gap.
- **A shared strike engine for Play and the shell Piano.** It is the latency-measured press path. Revisit only if E7 reworks the keyboard.
- **store.js (one key table, one guarded writer).** It is data-safety code and every call site is guarded today. Do it when Play's record starts syncing.
- **xml.js (kids / txt / num, STEP_PC…) and note-name helpers in music.js.** One-liners; cosmetic.
- **One pdf.js loader.** Both copies work, and touching pdfprep costs an IMPORT_E2E run.
- **One wake-lock helper.** No reported failure. Fold it in when one of the four is touched.
- **A debug / busy registry.** It only matters once the old pages are gone.
- **Splitting playpdf.js out of play.js.** Only as E3's first commit, if E3 needs it.
- **Splitting sing.js's core.** About 40 shared `let`s, and E8 will reshape Sing anyway.
- **A bulk port of every suite to a shared harness.** 1.2 adds the helpers for new and touched suites only.
- **Rewriting 56 suites' old-scratchpad output defaults.** Harmless: they create a folder under /tmp. Only inputs read from dead paths are fixed.
- **Replacing the 660 fixed sleeps.** Only the known flake is fixed (1.7).
- **Moving the remaining probes into tools/probes/.** TESTING.md's suite list says which files are suites.
- **A `regress.sh live` tier.** The test user's password is set by SQL each time, a connector prompt the owner prefers to avoid. TESTING.md documents the steps instead.
- **CI on GitHub Actions.** The fast tier before each push is enough.
- **Git LFS for the jars and tessdata.** Pages must serve them, and ~5.5 MB per engine release is fine.
- **Removing the custom-song migration.** It could lose a song; it is 10 lines.
- **package.json's `"version": "0.1.0"`.** Meaningless, but harmless.

## Docs restructure (Phase 6)

**The problem:**
- CLAUDE.md is 230 KB in 258 lines (about 57k tokens), loaded into every session. Single lines run up to 17.6 KB.
- Most of it is as-built detail for one area. It restates, in other words, what docs/PLAY.md, COACHING.md, LIBRARY.md and omr-build/README.md say, and the two versions drift.
- Sing, sync and account, assistants, the import Reader, the shell as built and iOS audio have no doc of their own.
- The few rules that break the iPhone if missed are buried in 10 KB paragraphs.

**New CLAUDE.md** (≤ 20 KB):

1. **Deploy, UI principles, the owner's working preferences:** as they are now.
2. **A map** (about 14 rows: area → key files → doc → suites). For example:

   | Area | Files | Doc | Suites |
   |---|---|---|---|
   | Shell | index.html, shell/*.js | SHELL.md (as built), REDESIGN.md (design) | shell, shellmods, shellscore, shellsing, shellplaces, cutover, jank* |
   | Sing | sing.js, musicxml.js, grade.js, rhythm.js, timing.js, fit.js, capture.js | SING.md | the Sing loop, gradecases, rhythmcases, timingcases |
   | Guided practice | practice.js, coach.js, takerhythm.js | COACHING.md | practicecases, coachcases, guidedverdicts, guided |
   | Play | play.js, playprep / playtime / playnames, chords.js, keyboard.js, pdfmap.js, scoretext.js | PLAY.md | play* |
   | Import (page side) | omr/omr.js, importer.js, jobs.js, trace.js, reader*.js, pdfprep.js, fixscore.js | IMPORT.md | reader, tracejs, jobstore, importcontract, importfixes, tiecases, fixcases |
   | OMR engine | omr-build/, omr/lib | omr-build/README.md, ACCURACY.md | tracecheck, tools/accuracy |
   | Library | library.js, catalog.js, forget.js, omr/queue.js | LIBRARY.md | libcore, songlib |
   | Account + sync | auth.js, account.js, space.js, sync.js, nav.js | SYNC.md | synclib, syncapi, account, sync2–4 |
   | Assistants | assist.js, assistants.js, supabase/functions/mcp | ASSISTANTS.md (+ CONNECTOR.md) | mcpcatalog, mcp1, mcp2 |
   | Tuner, Voice, Record | pitch.js, shell/tuner.js, profiles.js, voice.js, record.js | TUNER.md | shell, voicetest, recahead |
   | Sound on iOS | piano.js, pitch.js, every page's sleep | AUDIO.md | sleep, iosgate, stuckctx, playpress, audiotest |

3. **At most 25 one-line invariants**, each with a pointer:
   - `node bump.mjs <N>` and `?v=` on every local import;
   - away.js right after `<title>`, never inside a `<style>`; scopeCss takes the first `<style>`;
   - mounted pages look in `resonateX.root` first;
   - iOS: play-and-record before getUserMedia, `auto` on pagehide, the mic closed before sound, sleep when hidden, the first-tap unlock;
   - DATA_KEYS writes guarded by `spaceChanged`;
   - never commit owner material;
   - the MCP tool list is frozen;
   - `ENGINE` and `ENGINE_N` bumped with lib/;
   - repeat every `-constant` on a resume;
   - the Supabase dashboard settings;
   - and the like.
4. **Tests:** `tools/harness/setup.sh`, `regress.sh fast | main`, `IMPORT_E2E=1`, and docs/TESTING.md (env vars, what skips without the owner's material, the live-test steps).
5. **Status:** docs/ROADMAP.md.

**Where the rest moves.** A mechanical move, section by section, deduplicated against the target doc, with no rewording beyond that:

| From CLAUDE.md | To |
|---|---|
| Sing | new docs/SING.md |
| Guided practice | COACHING.md "As built" |
| Play | PLAY.md |
| Song library | LIBRARY.md |
| The shell bullet | new docs/SHELL.md |
| Account and Cloud sync | new docs/SYNC.md |
| Assistants | new docs/ASSISTANTS.md (CONNECTOR.md stays) |
| The OMR build, patches and CheerpJ | omr-build/README.md |
| The page side (clean-ups, ties, title / tempo, the Reader, resumable import, failures, reprocess) | new docs/IMPORT.md |
| Pitch detection, locked note, constants, volume, Record | new docs/TUNER.md |
| Local run, HTTPS, Windows firewall | new docs/LOCAL.md |
| The iOS audio facts spread over the Tuner, Voice, Sing and Play | new docs/AUDIO.md |
| The test notes | docs/TESTING.md, plus a "Tests" list in each area doc |

**Checks:** `tools/doccheck.mjs` (in 6), and the one review pass with three tasks.
