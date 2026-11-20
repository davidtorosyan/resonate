# Cut-over: the one-page shell becomes the site (roadmap B)

Planned 2026-11-20 (a read-only planning pass over the code; recommendations taken). Do it on a clean tree after
the A-work (shell jank) is committed. Line numbers drift — grep.

## Decisions
1. **Root = the shell.** `git mv public/index.html public/tuner.html` (old Tuner, `app.js` stays, linked from Tools
   until cleanup C); `git mv public/shell.html public/index.html` (`<html … data-shell>`, brand `href="./"`); a new
   `public/shell.html` stub: `<script>location.replace("./" + location.search + location.hash)</script>` + a plain
   link, dark background. Same origin → same storage.
2. **Old pages redirect into the shell, still fetchable.** The shell fetches sing / play / record / voice /
   assistants .html and mounts parts of their markup through `fetch` + `DOMParser` (no scripts run; it takes the
   first `<style>`, `<main>`'s children and named ids — never `<head>`). So: a classic `public/away.js` in each of
   those pages' `<head>` (after `<title>`, before the first `<style>` — never a `<style>`: `scopeCss` takes the first
   one), `data-open="sing|score|record|voice|assistants|import"`. It does nothing when: the URL has `?page` (people),
   the hash holds `access_token` / `error_code` / `error_description` (nav.js hands those to account.html), or
   `navigator.webdriver` is true and localStorage `resonate.redirect` isn't "1" (tests). Else it sets
   `data-away` on `<html>` and `location.replace("./?open=<x>" + the page's own params)`. The pages' markup otherwise
   unchanged in this release (long-lived v90 shells fetch the new HTML).
3. **Nothing runs on a page that is leaving.** nav.js (imported by sing / play / pdf-import / the shell): after
   `handing` is computed, `if (handing || document.documentElement.hasAttribute("data-away")) await new Promise(() => {})`
   (top-level await blocks the importing modules: no import resume, no Verovio download, no 📡). Export `handing`.
   nav.js's import-pill check also returns on `<html data-shell>` (keep the `shell\.html` path test: cached v90 shells).
4. **The shell reads URL state** (shell/boot.js, where `?pdf=` is read): `open`, `reprocess`, `pdf` → removed from the
   URL (`history.replaceState`), `tray.resumePending({ minimized: open !== "import" })`, then `reprocess` →
   `tray.reprocess(id)`; `sing` / `score` → the last song (`resonate.sing.song`, `songInfo`) opened with that module for
   that song only (as Next-up), else Songs; `record` / `voice` / `assistants` → `places.open(name)`; `import` with no
   pending job → Songs.
5. **Pages that stay real:** account.html (email links; its "Tuner" link → "Resonate" `./`; Assistants →
   `./?open=assistants`), oauth/consent.html (Supabase's path; optional wording "control Resonate while 📡 is on"),
   tools.html (header "Resonate" + account link; cards: drop "New Resonate (preview)", add "Tuner (old)" →
   tuner.html, "PDF → Song" → `pdf-import.html?page`, keep Audio test + Device check, and the Audiveris (AGPL) /
   CheerpJ credit + source link moved here from pdf-import.html — licensing), audiotest.html ("Sing" → "Resonate").
6. **MCP wording** with A6's redeploy: "Tap 📡 on Resonate's Sing page" → "Tap 📡 at the top of Resonate"; "Play page"
   → "the Score" (coaching.ts, index.ts, resonate.ts, catalog.ts).
7. No manifest / service worker / sitemap exist; Supabase Site URL (the root) and the OAuth consent path don't change.

## Order
1. Green baseline (regress.sh + shell, shellmods, shellscore, shellsing, shellplaces, songlib).
2. boot.js URL state → nav.js guard + export → away.js + the `<head>` tags → the moves + stub → links (5) → tests
   (below) → docs (CLAUDE.md Pages / Version marker / Account; ROADMAP; REDESIGN §19.6 note) → `node bump.mjs <N>`
   after the moves (`grep -L 'v=<N>' public/*.html` lists only the stub) → one review pass → push when allowed.
3. After the deploy: curl the root (shell/boot.js?v=N), tuner.html, shell.html; live account.cjs (an email link at the
   root) and mcp2; the owner checks the Home Screen app after ~10 min (max-age=600), swiped away and reopened.

## Tests
- Unchanged (automation escape): every suite opening the old pages; tools.html / account.html / audiotest.html users.
- Change in the same commit: `shell.html` → `index.html` in URLs and URL regexes (shell.cjs, shellmods.cjs,
  shellplaces.cjs, shellscore.cjs, shellsing.cjs, songlib.cjs, playpdf.cjs, playpdfonly.cjs, sleep.cjs, mcp2.cjs,
  reprocess.cjs incl. its badge read, the A-work's new jank tests); the Tuner → `tuner.html` (sleep.cjs, tunerfix.cjs,
  tunerprof.cjs, smoke.cjs, playheaders.cjs); account.cjs's root-chip checks → the shell's avatar; regress.sh adds the
  shell suites + cutover.cjs.
- New tools/cutover.cjs: the root is the shell (and no import pill over it); tuner.html; the stub carries search +
  hash without a history entry; each old page lands in the shell with the right module / place / Songs / Reader
  (`resonate.redirect=1`); `?reprocess=` queues; Back / reload; nothing ran on the leaving page (no Verovio, no
  Worker); the fetch path stays inert (no `framenavigated` while the shell mounts pages); the escapes; email links at
  the root and on sing.html reach account.html.

## Risks
The root cached ≤ 10 min (Home Screen app: swipe away, reopen); a cached old Tuner `index.html` loading new modules —
keep `app.js` and nav.js additive this release; long-lived v90 shells fetching new HTML — leave markup alone; the
Home Screen app's storage is separate from Safari's (ask the owner which one holds his songs); iOS standalone +
`location.replace("./")` — check on the device.

## Left for cleanup C
Move the mounted markup into the shell's own fragments, then delete the old pages, away.js, the webdriver escape and
the old suites; tuner.html + app.js; `go("sing.html")`; nav.js's `shell\.html` check; the pill's pdf-import link;
pdf-import once the tray has Copy log and the credit.

## As built (v92, 2026-11-20)
Done as planned (decisions 1–5, 7; order 1–2 up to the bump, which the integrator does with the push):
- **Moves:** `public/index.html` → `tuner.html` (unchanged), `public/shell.html` → `index.html` (`<html lang="en" data-shell>`,
  brand `href="./"`); `public/shell.html` is the stub (`location.replace("./" + location.search + location.hash)`, a plain
  "Resonate ›" link, `#0d0d1c`; no badge, no script src — `grep -L 'v=<N>'` lists only it after a bump).
- **`public/away.js`** (classic; `<script src="away.js?v=N" data-open="…">` right after `<title>` on sing (sing), play
  (score), record, voice, assistants, pdf-import (import) — bump.mjs versions it like any `<script src>`): escapes `?page`,
  the auth hash, `navigator.webdriver` without `resonate.redirect` = "1"; else `window.stop()` (the rest of the page is
  never read: none of its modules start), `location.replace("./?open=<x>" + its own query)`, then `<html data-away>` and
  the page hidden (after 3 s with no shell: shown again with a plain "Resonate ›" link to it).
- **nav.js:** `export const handing`; `if (handing || data-away) await new Promise(() => {})` right after it; the
  import pill returns on `<html data-shell>` (the `shell\.html` path test kept). **WebKit doesn't honour that wait
  across scripts:** in WebKitGTK 2.52 (JSC) a module script whose import was *started by another `<script>`* runs even
  while that import is still awaiting (sing.html: nav.js's own tag, then sing.js importing it — sing.js ran, and threw
  on `spaceChanged` in its TDZ); within one graph it waits. Hence away.js's `window.stop()`, and boot.js checks
  `handing` itself (`if (handing) await …` at its top) for an email link at the root.
- **shell/boot.js:** `open` / `reprocess` / `pdf` read and removed at the top (`history.replaceState`, before any sheet or
  song pushes an entry); `pdf` → `tray.start` as before; else `tray.resumePending({ minimized: open !== "import" })`, then
  `reprocess` → `tray.reprocess(id)`, and `import` with no pending job (the `resonate.import` flag of this space, read
  synchronously — resumePending's promise lasts the whole conversion) → Songs; `sing` / `score` → the last song
  (`songInfo`) with that module for it only, else Songs; `record` / `voice` / `assistants` → `places.open`.
- **Links:** account.html "Tuner" → "Resonate" (`./`), its Assistants link → `./?open=assistants`; tools.html header
  "Resonate" + the account link (Record / Sing / Play gone), cards Tuner (old), PDF → Song (`?page`), Audio test, Device
  check, and the PDF → Song credit; audiotest.html "Sing" → "Resonate" (`./`); oauth/consent.html "control Resonate while
  📡 is on".
- **Tests:** `shell.html` → `index.html` (URLs, regexes, reprocess.cjs's badge read) in shell, shellmods, shellplaces,
  shellscore, shellsing, songlib, jank, jankchrome, playpdf, playpdfonly, sleep, mcp2, reprocess; the Tuner →
  `tuner.html` in sleep, tunerfix, tunerprof, smoke (+ the shell), playheaders (tools now `self`: no Play pill);
  account.cjs's root checks → the shell's avatar (signed out / the email) and "a link at the root"; regress.sh runs
  cutover + the five shell suites. **tools/cutover.cjs** (iPhone 393×852, iPad 820×1180, touch; `PARTS=R,S,L,B,N,F,E`):
  as listed in Tests above, plus nav.js's guard on its own — a page marked `data-away` that never leaves (its HTML
  served with the marker instead of away.js): sing.js / play.js / pdf-import.js never run, no song, Verovio or worker
  fetched in 3 s; and away.js itself with its navigation a no-op (the answer never coming). Chromium stops a page's
  loading as its navigation starts, so the held-answer check (the shell's response held 2.5 s) passes even without the
  guard; the marker-only check fails without it (3 of 3). **tools/cutoverwk.mjs** (WebKitGTK, `webkit2gtk-driver`):
  the root, sing / play / voice.html land in their state, the stub, an email link at the root, and the three pages on
  their way out with the answer never coming run nothing; the marker alone is reported (it doesn't hold them back
  there).

Deviations:
- **The credit is copied, not moved:** pdf-import.html keeps its Audiveris / CheerpJ credit (it still runs the engine,
  behind Tools' `?page`, and its markup stays as it was this release); tools.html has it too. Drop it there with the page
  in cleanup C — the tray still has no credit of its own (the shell reaches it through Tools).
- **Decision 6 (MCP wording) left as it is:** coaching.ts already says "Tap 📡 at the top of Resonate" (A6's redeploy);
  resonate.ts's two "tap 📡 on the Sing (or Play) page" answers remain — deployed code (mcp1 checks the deployed text),
  so they change with the next redeploy of the function, not in this release.
- `?open=import` with `?reprocess=` shows Songs (the song's row "converting", the tray folded) rather than the Reader
  open: it is queued like the Score's ⟳, not an import of its own.
- away.js also hides the leaving page (`visibility: hidden`, the shell's background) so the old page never flashes,
  and stops its loading (`window.stop()`, WebKit above) — not in the plan.

After the deploy (the integrator): curl the root (`shell/boot.js?v=N`), tuner.html, shell.html (the stub); account.cjs
live (it needs `TEST_EMAIL` / `TEST_PW` — not run here) and mcp2; the owner checks the Home Screen app.
