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
