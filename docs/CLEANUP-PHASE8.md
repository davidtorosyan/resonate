# Cleanup Phase 8 — mapped against the code (2026-11-22, at 75ab952)

A read-only plan for docs/CLEANUP.md Phase 8, made after E3 and E6. Deferred (35–40 h, ~5 sessions); E7 takes only the slice it needs (tools/lib/shell.cjs helpers, boot.js's `play` debug alias). Line numbers are as of 75ab952.

Phase 8 build plan (Resonate @ 75ab952). Read-only: nothing was run or written.

The phase text needs ten corrections; they shape the rest of the plan.

1. Every play.js anchor has moved. The current anchors are in section 1.
2. "The standalone bar's CSS (play.html:94–200)" cannot go as one block. scopeCss keeps play.html's media queries (shell/scopecss.js:37), and they test the window, so about half of play.html:29–249 and most of the E6 block (398–421) style the shell's Score today. Deletion is rule by rule (1g), gated on a before/after rect snapshot.
3. playhear's "keyboard-off home" (G, playhear.cjs:446–491) is not dead. In the shell it is the Score without the Piano, which is the phone's default. When the Piano is off, play.js keysRow() returns null and placeHear puts the chips in the stretch's controls. Port G; don't retire it.
4. The same goes for playv80fixes K (:339): the KEY_MIN chips rule is live code for the Piano host. Only N (:240) and B (:377) are truly dead. L (:318) and K are owner-score-only, so retiring them costs nothing in regress, but their concerns hold in the shell.
5. The keep-anchors are wrong. "#dock/#hear/#strip … pianoview.js:46–49, scoreview.js:71" is now:
   - scoreview.js:79 mounts #dock (which holds #hear), and :81 sets el.dock.
   - pianoview.js:44–51: the hearBox has class `play-scope`, so play.html's `#hear` CSS (346–364) draws the chips.
   - New code no longer reads #strip. It stays only so a cached old play.js under a v93 shell finds it (the Phase 9 rule).
6. `resonate.play.keys` is also read by shell/songview.js:49, the v86→v87 modules migration that Phase 2 keeps until about v100. Leave that read alone.
7. Importing device() from chrome.js makes play.js shell-only: chrome.js:124 `scrim.addEventListener` throws on play.html. So does deleting `|| $("play")`. play.html?page (the away.js:17 escape) becomes a dead page. Nothing links to it (only pdf-import.html?page is linked, tools.html:59), and Phase 9 adds the redirect.
8. The phase's suite list is incomplete. These also open play.html or check its paths:
   - tools/accuracy/pairs.cjs:84/:102 (D's review tool; FINGERING.md §8 relies on it)
   - playpdfwk.mjs, scorefocuswk.mjs, playextraswk.mjs, playcore.cjs, playextras.cjs
   - reprocess.cjs `back`, shellplaces.cjs `pages`
   - mcp2 parts 3–4 (play.html's 📡 and #song)
   - the reprocess-fallback checks in playpdf R and playpdfonly
   - playopen's play.html host
9. The shell has no ROOM rule (play.js:1723: ≥360 px wide and ≥500 px tall). The Piano shows in a Slide Over or on a phone in landscape. Retiring playv80fixes N therefore leaves nothing to test. This is a finding for the owner / ROADMAP, not Phase 8 work.
10. E7 comes before E8 on the roadmap, so Phase 8 will probably run before Phase 7 and has to build tools/harness/inshell.cjs itself. Give it a per-page table that Phase 7 extends with the sing / record / voice / assistants rows.

## 1. The deletions (current lines, references, what stays, risk)

Every deletion below is behaviour-neutral inside the shell: each removed path is unreachable there today (keysOn is false, #dock stays hidden, `region` is set, the hooks are set). The real risks are the CSS cut and play.html no longer working on its own.

### 1a. The docked keyboard

play.js:
- :27 `import { mountKeyboard }`: only used for the dock.
- :36 drop `stripEl`, `keysBtn`, `dockEl` from the const line.
- :431 `dock()` in openPdf: delete. Keep :432 `drawKeys()`.
- :630 becomes `const kb = shellKeys()?.height?.() || 0`.
- :728 `kb.remeasure()`: delete.
- :1109 `keysBtn.disabled = …`: delete.
- :1158 the loop becomes `[bar, selbar]`. The chips blur through hearEl's own listener (:1936).
- :1680–1749 delete:
  - the header comment (rewrite as two lines: "the Score's keys, drawn on the shell's Piano")
  - `KB.on` (:1701); keep `KB.play` and `KB.range`
  - kb (:1705–1715), keysDefault (:1716), the ROOM comment and ROOM/keysRoom (:1717–1724)
  - setKeys (:1725–1730), the keysBtn listener (:1731), the ROOM listener (:1732–1735), dock() (:1736–1749)
- Keep keysLit (:1751–1755), shellKeys (:1777; drop "(play.html keeps it)" from :1775), loading (:1779), stripRange (:1783).
- drawKeys (:1760–1770) becomes: `const out = shellKeys(); if (!out) return;` then the same lit/range code and `out.draw(keys, [lo, hi])`.
- placeHear's dock branch (old ~1860–1875):
  - keysRow :1914–1917 becomes `return shellKeys()?.host?.() || null`
  - :1922 `keysH = () => kr.strip.getBoundingClientRect().height`
  - :1929 drop the `"dock"/"shell"` token
  - comments :1880–1882 and :1906–1913
- :3393 `dock()` in pdfControls: delete.
- :4282 the boot setKeys line: delete.
- :4664–4666 `resonatePlay.keys(on)`: delete. Its only caller is shellmods.cjs:134.
- Header comments :15 and :420–422: "the keyboard stays under it" now means the Piano's keyboard.

Debug, re-pointed at the keyboard play.js draws on, so the suites keep their meaning (do this first, in step 2):
- :4723 litKeys reads `shellKeys()?.host?.().strip` `rect.lit`. It feeds `peek.lit` (:4789) and `playback.strip`.
- :4751 `hear.home` becomes "selbar" | "keys".
- :4791–4797 `keys` becomes `{ shown: !!shellKeys(), view: KB.range, h: shellKeys()?.height?.() || 0, rect` (the host row's rect, so `d.keys.rect[3]` equals what fit() subtracts)`, range` (from the strip's rect.key)`, lit: litKeys(), held` (from `peeks` with pk.kb && pk.held)`}`. `on`, `pref`, `dflt` and `draws` go; draws is in `resonateDebug().piano.draws`.

Risk: low in the shell, and it ends play.html as a host. Nothing in keyboard.js or pianoview.js changes. Don't touch them, so E7's surface stays clean.

### 1b. The `resonate.play.keys` pref

- play.js :49 (K.keys), :1728, :4282, :4793 go.
- Keep songview.js:49.
- Test references: shellmods.cjs:134, playhear.cjs:448, playv80fixes :244/:262/:289/:350, playkeys, playwebkit.mjs:53/:57, playhearwk.mjs:94/:106, accuracy/pairs.cjs:84.
- scoreview.js:89 `keysOn = false` can go too. A new scoreview always imports the new play.js (a new ?v= URL).

### 1c. #song's handler

- play.js:1128–1132.
- With it go the menu writes: :286–289 and :291 in fillSongs, :373 `songSel.value = id`, and :34's songSel/samplesEl/mineEl. Keep fillSongs's `S.mine` set (used by known() at :279), renamed, still called at :4271 and :4284.
- score_open's list at :4573 becomes `songChoices()` titles, the same shape shell/remote.js:94–95 already returns (the shell answers an unknown song first).
- Markup #song/#samples/#mine stays until Phase 9: a v93 play.js reads it. scoreview OVERRIDES :22 keeps hiding it.

### 1d. play.html's AI button and remote wiring

- play.js:4688–4705, plus `playState` :4648–4649 (only used there). Comments :4297–4298 and :4651–4654.
- Keep the `remote` import (changedSoon at :828 and others), hasAssistant, shareFocus, SCORE_ACTIONS (:4564) and scoreRun. shell/remote.js:55 calls scoreRun.
- CSS goes: 95–116 and every `:has(#remote-btn…)` rule.
- Keep the button's markup (play.html:505) until Phase 9. It is harmless while hidden, and a v93 scoreview's querySelectorAll(:78) removes it anyway.
- Update assist.js:397's comment and drop play.html from shellplaces.cjs:523.

### 1e. The `pdf-import.html?reprocess=` fallback

- play.js:3944–3946 becomes `window.resonatePlay.reprocess(id)`. The shell always sets it (songview.js:85, boot.js:76; since v88).
- Comments :3339 and :3937–3939.
- pdf-import.js and boot.js `?reprocess=` stay ("Later, not C").
- Tests to retire: playpdf.cjs:357–360, playpdfonly.cjs:211–216, and reprocess.cjs `back`'s bfcache step (:296–308).

### 1f. `|| $("play")`

- play.js:38 becomes `window.resonatePlay.playBtn`. Every shell since the preview sets it (b27d6f7).
- Optional: throw a clear "play.js runs in the shell" error there.

### 1g. The bar's CSS, rule by rule

Specificity, in the shell:
- OVERRIDES are `.score-root #bar …` (1,1,0) / `.score-root #bar .ctl > *` (1,2,0).
- Scoped rules are `.play-scope <orig>`.
- `:has(#x:not([hidden]))` adds (1,1,0).

GO (no element in the shell, or hidden there):
- 40–50 (.nav, h1, .nav-link), 67 (#song), 94 (#version), 95–116 (#remote-btn), 117 (.brk), 121
- 129–135 and 139–142, 146, 151–153, 156–158, 162–164 (#song), 167, 181, 184, 193–194, 196, 201, 207
- 213 (#keys), 222, 225, 232–233, 236
- the dock: 301–306, 307–308 (#strip), the `#keys` halves of 309 and 312, 391–393 (body[data-keys])
- E6: 406, 412–415, 416–418, 420, 421
- `#bar #keys` out of 84

KEEP (the shell's Score uses them):
- 31–39: #bar's left/right padding (OVERRIDES :21 sets only top/bottom)
- 51: .ctl align-items
- 52–66, 71 (#hands), 73–93, 119–120
- 171–175: ‹ › 56 px on an iPad; (2,1,0) beats OVERRIDES' 44
- 179 (#pg <480), 192's padding, 208–209
- 214, 220–221 (#offer order 3 and its span: (2,2,0) applies in the shell), 226
- 235 (#chords order 3 <480)
- 240–245 (📄 on 670–1099), 248–249
- 251–397: paper, bubble, selbar, the #hear chips, PDF, data-pdfonly
- E6 402–405, 407–411 (the shell's "bar keeps its rows with marks"), 423–470 (marks, tabs, list)

Delete only if the snapshot is identical (the shell's OVERRIDES out-specify them, so they look like dead weight):
- the order / flex-basis / display / gap lines in the ≤1099 block (136–137)
- ≤669 (144–148)
- 166 (`.pager` order 1 with the chip: (2,3,0) applies but is a no-op, because .pager follows .ctl)
- 180, 185–186, 189, 195, 199

Also tidy: index.html:460 `.score-root #dock` and the scoreview OVERRIDES comment :41–42. Keep :39 (`#keys` hidden: the markup stays) and :22.

Risk: medium. This is the one deletion that can change what the owner sees. Gate it on the snapshot in section 4.

### 1h. device() from shell/chrome.js

- Delete play.js:135–139 and import `device` from `./shell/chrome.js?v=97`. It resolves to the same URL boot.js and songview.js load, so the same module instance runs and has no new side effects.
- bump.mjs and vcheck already handle the path.
- Uses at :559, :631, :4780; update the chrome.js:36 comment.

### 1i. Optional extra cuts found (not on the phase's list, zero user effect)

- play.js:562 `region ? clientWidth : W`: always the window now.
- The :4239 pageshow handler: boot.js already reloads on bfcache restore (:132). Its ":4246 Back from PDF→Song's ⟳" comment is stale; keep freshen().

## 2. Porting the suites to the shell

### Shim: tools/harness/inshell.cjs (`node -r`, like guidedoff.cjs; temporary)

Init scripts, added first in every context, so a suite's own scripts can override them:
- If unset, set `resonate.sing.song` = "amazing-grace". play.html opened FIRST; `?open=score` with no song opens Songs instead (boot.js:120–124).
- If unset, set `resonate.shell.modules` = `{phone:["score"], tablet:["score","piano"], desktop:["score","piano"]}`. This reproduces play.html's keysDefault (on for tablet and desktop, off for phone).
- Wrap Storage.setItem so a suite writing `resonate.play.keys` "on"/"off" sets the Piano in that modules pref instead.

Page patches (once on the prototype, as harness/noshots.cjs does):
- goto: a URL under BASE (never HEAD_BASE: v79 servers have no shell) ending in `/play.html` becomes `index.html?open=score` (extra query appended); remember it.
- reload: re-goto that URL. boot.js:35–39 strips `?open`, so a reload would come home.
- `selectOption("#song", id)` becomes `evaluate(async id => (await import("./shell/songlist.js?v="+badge)).openSong(id))`. That is the same module instance boot.js uses and it writes `resonate.sing.song`. Then wait for `resonateDebug().song` to be idle (!moving, !switching) and the Score ready.
- `focus`/`tap`/`click("#song")`: no-op, logged.
- `click`/`tap("#keys")` becomes `#mod-piano` plus the same idle wait.
- Optional: `reducedMotion: "reduce"`, so the shell's slide-in doesn't move rects mid-measure.
- Never use it for cutover, cutoverwk, shellplaces, shell or jank.

One public change makes `resonateDebug().play` work unchanged in Chromium and WebKit with no accessor magic: in shell/boot.js:80, `const sc = song.scoreDebug(); … score: sc, play: sc?.play`. It collides with nothing; I grepped the shell suites. Ship it in step 2.

Permanent helpers: tools/lib/shell.cjs
- SCORE_URL, MODS, `seedShell(ctx, {song, mods})`, `openScore(page)`, `reopenScore(page)`, `openSong(page, id)`, `piano(page, on)`, `kbKey(page, midi)` (the centre of `#piano-region .kb rect.key[data-midi]`), `idle(page)`.
- A WebKit twin, tools/lib/wkshell.cjs: copies public/index.html with the suite's REC script plus `<base href="/resonate/">` into /home/user/sitetest/tmp/<x>.html, returns `tmp/<x>.html?open=score`, and gives the tools.html pre-step script for `resonate.sing.song` and modules (WebKit is a desktop; set modules explicitly because the profile persists).
- Once green, write these into the suites and delete the -r shim.

How the shell differs:
- The stage is shorter: the 52 px top bar, a Score bar with no nav row, the Piano (6 + clamp(56, 9vh, 110) + 6) and the shell's dock (about 86 px).
- TABLET_W tests the window (play.js:562). It equals play.html's stage width while the Score is alone (the region is full-bleed).
- keysOn is false. The keys are the Piano's `#piano-region .kb`, not `#strip`, and the row is `#piano-region`, not `#dock`.
- `#keys` and `#song` are hidden.
- With the Score alone, its ▶ moves to the dock (songview.js:116–123) and the tuner chip sits inside .ctl (:108).
- The Piano never hides over the PDF.
- A module change stops what sounds, unlike 🎹.
- The shell's own audio (the Piano warming its context, primeHold sources) and beforeSound (tuner.park) now run. Watch the source and context counters in playpress G/H/I, playback's gate case and playmarks' "no strike".
- Page loads are slower, so check the 1800 s timeouts.

### Per suite

Unaffected (own pages or tools.html): playunit, playxmlsame, tiecases. Also cutover / cutoverwk (play.html markup or redirect only), shell.cjs (:70–71 `page:` is unused), jank.cjs (already shell: A3/A5).

**play.cjs** (8 sizes :26; goto :462/:942/:1203; #song :239–240, :630, :1037). Edits:
- check 7 :763–805: `#strip` → `.kb`, `#dock` → `#piano-region`
- :1048/:1061: the menu set directly → openSong
- :1097/:1119: the song list → songChoices or `#songs-body .song`
- check 10 :252–282: maxBar re-baselined for the shell bar

**playheaders** → keep tools, account and audiotest, and add pdf-import (users reach it through `?page`). Drop record / sing / sing+📡 / voice / play / assistants and the Play-pill check.

**playfixes**:
- P1: drop the #song pedal checks (:603–613); keep #hands and Tab.
- #song selects → openSong.
- P3 :754–770 (landscape: two systems on page 1, floor without the keyboard): add room from keys.h. It may fail in the shorter stage; that would be a finding.
- P4 (one row with the chip) ports as-is.

**playscore**: A/E unchanged; B port (room :464 works through keys.rect; :442 / :1024 `#strip rect.lit` → `.kb`); C WebKit :596–599 → wkshell; F port.

**playopen**: port playPage (:89–184) to the shell; it carries E1's main checks. :144's `#song option` wait → the resonate:remote event or songChoices. Add a score_open unknown-song check (the `songs` list); it replaces the menu. shellScore (:186–) unchanged.

**playpaper**: see section 3.

**playback**: #song :105/:602; the strip comparison :512–524 works through the re-pointed litKeys.

**playbackfixes**:
- M/T/A/U/Z/E/B/O as-is.
- K :270 and R :314: `#dock`/`#strip` (:142–152, :281) → `#piano-region`.
- C/V as-is (V's screen-emulated Split View equals TABLET_W on the window).
- F :529 (Piano Man landscape, two systems): likely the shell finding.
- H :620–634: retire (v78 heights of play.html's bar).

**playpeekstaff, playfocus**: as-is.

**playpress**: :228 `#strip` → `.kb`. A now runs after the shell's beforeSound (expected to pass with the tuner off). K's HEAD_BASE stays unmapped.

**playkeys**: retire. Coverage moves:
- U (music never under the keyboard on every device × song × view) → a `stage.bottom ≤ #piano-region.top` check in playpaper S.
- L (a press lights its chord with hand colours and letters, gone 2.4 s after the lift, ▶ lit = sounding, a press during ▶, ■ none, range = view) → shellmods `linked` (:380–420 already has range, held-lit, ▶ lit, ■ none; add the press-on-the-music and the sampled ▶ equality).
- S (one rect across presses / ▶ / turns / loop / − +) → extend linked's frame sampler.
- D/T/P/B are 🎹, its pref, ROOM and hidden-in-the-PDF: nothing left to test.

**playhear**:
- A :145 (fixtures, runs in regress): `#dock`/`#strip` :177–185 → `#piano-region` / `.kb` (height = keys + 12 still holds); home "dock" → "keys".
- B–F owner-only, via the shim.
- G: port (Piano off = modules {score}; 🎹 → `#mod-piano`; :485 strip width → `.kb`).

**playv80fixes**:
- P / R / H / M port (R: "keyboard off" = Piano off).
- Retire N and B. Add "📄 leaves the shell bar's height unchanged" to playmarks W.
- L: port its frame sampler onto `#piano-region`, or retire knowingly.
- K: port (home "keys", `.kb`).

**playchords**: #song :130; S :385 `#keys` → `#mod-piano`; K :449–503 presses `#strip rect.key` → `kbKey`; `d.keys.held` comes from peeks; `#strip text` → `.kb text`; HEAD_BASE :292 unmapped.

**playpdf**: #song :95; R: keep the hook checks :351–356 (the URL test: shell, not play.html), drop :357–360.

**playmarks**: M/P/V/K/R/E/X via the shim (newPage default url :55); H unchanged; W :784: drop the "play" host and add the 📄 comparison.

**playpdfonly**:
- goto :40/:219/:266 and many #song selects.
- :63 `#mine option "Mini · PDF"` → the Songs row.
- :64 → `#mod-piano` pressed and keys.shown.
- :73 `.kb`.
- :95–104 🎹 off → Piano off (the PDF gets taller).
- :211–216: retire.

**reprocess**: `back`: retire the bfcache step; port the sync-replacement step (:309–313) to `?open=score`; the Sing tab half is Phase 7's.

**shellmods**: :134 drop scoreKb and playKeys; :204 drop; :392 becomes `x.piano.linked && !s.scoreKeys && x.play.keys.shown`; add L/S from playkeys.

**shellscore**: :84 becomes `… && pl.keys.shown`.

**shellplaces**: :523 drop play.html.

**mcp2** (live, not in regress):
- 3 (:167–219) → the shell's Score (openSong; no `#remote-btn`).
- 4 (:221–296) → `#home-remote` (Sing mounts hidden, shell/remote.js routes score_*); drop :224 (📡 bar height) and the Sing+Play two-tab check :270–293.
- Run once if the owner OKs the test-user step, else report "not run".

**WebKit** (every copy moves to wkshell; seed song and modules in the tools.html pre-step):
- playwebkit :10–13, :37–40; the 🎹 block :49–58 → `#mod-piano`; H grows by the Piano's height after the change settles.
- playbackwk :12–15.
- playhearwk :14–18; :44–45 `.kb` / `#piano-region`, "keys"; :93/:105 → `#mod-piano`.
- playpresswk :32.
- playmarkswk :11–14.
- playscore C.

Outside regress:
- Port: playpdfwk (:33/:42), scorefocuswk (:16).
- Retire (superseded by play.cjs §8, playpdf, playfixes, playpress I, playwebkit / playpdfwk): playextraswk, playcore, playextras. git keeps them.

**accuracy/pairs.cjs**: `?open=score`, modules {desktop:["score"]} (no Piano: "the page's height for it"), drop :84's keys pref. Smoke it on a fixture; the owner's songs need ACC/SP.

## 3. playpaper's recalibration

What it measures, per device (10, :39–43) × song (Amazing Grace, synth-pvg, the owner's) × view, with no size chosen:
- the staff space vs the printed density (W/90)
- the landscape two-systems fit and its floor (`room × min(base, 0.9 × short side / 90)`, room = H/(H + keyboard), :147–151)
- nothing past the stage, no spread
- K: Killing on the Air portrait, 3–4 systems a page, 3 bars a system
- Z (− / +), T (turns), N (small sizes)

"Recalibrate" concretely means:
1. Run it on the region's stage (`?open=score`, the per-device modules).
2. The floor formula is unchanged, because `keys.rect` now names the Piano row fit() subtracts. Prefer `d.keys.h`, so the test reads exactly what the code uses.
3. Add U: stage bottom ≤ Piano top, every pages-of row.
4. Re-measure K on the shell's Air portrait stage, which is about 90 px shorter: expect 3 systems.
5. Regenerate the SURVEY=1 table in the shell. Replace the play.html "Cost" figures (CLAUDE.md:179, PLAY.md:714–) with it, and save it as the baseline for layout changes.
6. Expect a finding: the shell's landscape stage is about 130 px shorter than play.html's (top bar, the shell dock). Below the floor, Full scores fall to one system a page (the assertions hold either way: :150). Report it; don't fix it in Phase 8.
7. T: tap / swipe points from the stage rect, not `h*0.6` / `w*0.7` (:324/:327); the screenshot clip from #bar.
8. Z's phone: `min(9.5, d.cap)`.

playscore B, playbackfixes C/F and playfixes P3 share the floor and get the same treatment.

## 4. Order of work, checks, hours, E7

**0.** Baseline at HEAD (1 h):
- regress green, with each Play suite's check count recorded
- playpaper SURVEY=1 on play.html
- serve HEAD's public with `git archive HEAD public | tar -x` into /tmp, collect-serve on 8098 (no repo writes)
- the shell-bar snapshot: every rect under `#score-region #bar`, #stage, and the open #marklist, over 300–1440 / 20 × none / chip / 📄 / marks × touch / mouse

**1.** tools/lib/shell.cjs, wkshell.cjs and the inshell.cjs shim (3 h).
**2.** The play.js debug re-pointing (1a) and boot.js's `play` alias; fast tier (1 h).
**3.** Inventory: the Play block and the WebKit suites under the shim; sort failures into selector, layout or real shell finding (3 h, mostly wall clock).
**4.** Suite edits (section 2) (14–18 h).
**5.** playpaper and the shared floors (2–3 h).
**6.** Write the URLs and helpers into the files; delete the shim; regress main green with public/ still at step 2 (2 h).
**7.** One commit of public/ deletions:
- play.js (1a–1f, 1h)
- play.html CSS (1g)
- scoreview.js:89 and its comments
- index.html:460
- the chrome.js and assist.js comments
- (3 h)
**8.** Rerun fast, main and WebKit. The bar snapshot must equal step 0's. The shell SURVEY table must equal step 6's (3 h wall clock).
**9.** Docs (1.5 h):
- CLAUDE.md:179 Keyboard (→ the Score's keys on the Piano), :184, :185 (marks' play.html rows), :187 (test list), :35 (resonatePlay `keys(on)`, keysOn, "on play.html none are set")
- PLAY.md:487, :491, :714–752 (superseded)
- regress.sh:108–114 (drop playkeys; playheaders → page headers)
- CLEANUP "Phase 8 — as built"
**10.** One review pass and its fixes (2–3 h).
**11.** bump, push, deploy, device check (1 h):
- iPad: Score + Piano: a press and ▶ light the Piano; toggling the Piano keeps the bars; 📄 with the Piano under it; ⟳ through the tray; the bar unchanged at its widths.
- iPhone: Score alone, chips in the stretch's controls.
- The AI button from home runs score_*.

Total about 35–40 h, roughly 5 sessions (L). Retiring playcore, playextras and playextraswk is already counted. Skipping the L/K ports saves about 2 h.

What must pass:
- the fast tier, including vcheck (the chrome.js import has ?v=)
- regress main: every ported Play suite, playpdfonly, reprocess, shellscore, shellmods, jank A3/A5, shellplaces, cutover G/L, shell, songlib
- the 5 WebKit suites and playscore C; cutoverwk unchanged
- each suite's check count = its play.html count − the listed retirements + the additions
- `grep play.html tools` leaves only cutover / cutoverwk / shellplaces' stale-shell routes
- no dockEl / stripEl / keysBtn / K.keys / setKeys / keysRoom / songSel / `pdf-import.html?reprocess` in play.js
- the snapshot identical
- `git status` clean after regress
- mcp2 live: run, or reported as not run

**E7:** FINGERING.md:150 already makes Phase 8 its step 0. What Phase 8 leaves for E7:
- One keyboard. play.js draws only through `shellKeys().draw(lit, range)` (E7's ghost argument goes there), and keyboard.js has one mount (pianoview), so `:scope > svg` and `.kb-ghost` need no #strip CSS or kb.size / remeasure callers kept in step.
- placeHear's KEY_MIN fit has one host, so the `#fing` button's width at the keyboard's right end is subtracted in one place (keysRow).
- `keys.lit` reads the real Piano DOM, a hook for playfinger's digits.
- The tools/lib shell helpers and the index.html WebKit copy are ready for playfinger.cjs and playfingerwk.mjs.
- mcp2 already runs in the shell.

Conflicts:
- Do not start E7 until step 7 lands: both edit drawKeys, placeHear, keysRow, the debug block, playhear and playchords.
- Phase 8 must not touch keyboard.js or pianoview.js.
- E7 should know about the missing ROOM rule (digits on a phone-landscape or Slide Over keyboard).

### Critical files for implementation
- /home/user/resonate/public/play.js
- /home/user/resonate/public/play.html
- /home/user/resonate/public/shell/scoreview.js (and /home/user/resonate/public/shell/boot.js:80 for the debug alias)
- /home/user/resonate/tools/playpaper.cjs
- /home/user/resonate/tools/regress.sh (plus new /home/user/resonate/tools/harness/inshell.cjs and /home/user/resonate/tools/lib/shell.cjs)