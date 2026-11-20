# Song library: a PDF first, converted later (v90)

The owner (2026-11-20), after engine patch 0010 meant reprocessing songs by hand: "Add … maybe it doesn't
convert right away … just adds it as a PDF that I can use … a button for convert to XML … it would keep an
engine version … you have this song from this version … a button which is like reconvert, and it would go
through and reconvert everything … in the background on my iPad … I need to be able to delete the songs …
the initial upload shouldn't block you for 5 minutes." Plus: raise the cloud limit to 20 songs.

This file is the implementation contract (the parts are built in parallel); keep it as the as-built notes.

## 1. Data

**Song record** (library.js, IndexedDB `songs`):
`{ id, title, xml: string | null, added, source?, clean?, pages?, rev?, engine?, titleAuto?, conv? }`
- `xml === null` ⇔ **PDF only** (not converted). Its PDF is in the `pdfs` store under the same id.
- `engine` = `{ n, id, at }` — the engine that converted it: `n` the human engine number (`ENGINE_N`, below),
  `id` omr.js `ENGINE`, `at` ms. Set by the importer on every conversion (new import or reprocess). Missing on
  songs converted before v90 ("older engine") and on MusicXML / link / sample songs.
- `titleAuto: true` — the title came from the file name when the PDF was added; the first conversion may
  replace it with the importer's chosen title (`chooseTitle`). Cleared by `replaceSong`.
- `conv` = `{ kind, message, at }` — the last conversion failed for a reason that would fail again
  (`pdf`, `nomusic`, `blank`, `unread`, `missing`, `nopdf`). Cleared by `replaceSong`. Device only.

**Index entry** (`resonate.songs.index`, an array as before):
`{ id, title, added, rev?, k, eng?, fail? }`
- `k`: `"pdf"` (xml null), `"conv"` (has xml and `source === "pdf"`: converted from a PDF), `"xml"` (anything else).
- `eng`: for `k === "conv"` only: `engine?.n || 0` (0 = before v90, shown "engine ≤9").
- `fail: 1`: `k === "pdf"` and `conv` is set.
- `listSongs()` rebuilds the index when its ids differ from the store's keys **or any entry lacks `k`** (an index
  from v89, or written by a v89 tab), reading records with a cursor (one at a time, not `getAll`).

**Engine number**: `public/omr/engine.js` — `export const ENGINE_N = 10;` = the number of the newest
`omr-build/patches/00NN` patch. Bump it with every engine patch, together with omr.js `ENGINE`
(tools/jobstore.cjs checks it against the patch files).

**Conversion queue** (`public/omr/queue.js`; localStorage `resonate.convert`, in space.js `DATA_KEYS`):
`{ db, ids: [songId…], total, done, ok, force, at }` — `db` = space.js `activeDb()` when written; read only when it matches
(else empty). `ids[0]` is next; the song being converted is the importer's running job (`job.replace`), not in
`ids`. `total` / `done` count the batch for "2/5", `ok` the songs that converted (the done row's "N converted", kept across a reload), `force` the ids an explicit Convert / Reconvert asked for (never passed by as "already current"); reset when the queue empties.
API: `readQueue()`, `writeQueue(q)`, `enqueue(ids)` (append, unique, keeps order), `dropFromQueue(id)`, `clearQueue()`.

## 2. Library API (library.js) — changes

- `addPdfSong(pdf: ArrayBuffer, { name = "", title })` → id. `putPdf` first, then the record
  `{ id, title, xml: null, added: Date.now(), source: "pdf", titleAuto: true }`, then one `resonate:data` song
  event. If the record write fails, the PDF is removed. No dedupe.
- `addSong(title, xml, opts)`: `opts.engine` stored as `engine`; the dedupe applies only when `xml` is a string.
- `replaceSong(id, xml, { pages, title, engine, quiet })`: drops `clean`, `pages`, `engine`, `titleAuto`, `conv`
  from the old record; sets `engine` when given. (Unchanged otherwise: keeps id, added, source, PDF; new `rev`.)
- `markConvFailed(id, { kind, message })` — sets `conv`, fires `resonate:data`.
- `removeSong` unchanged.

**catalog.js**: `cleanXml` returns a non-string as is; `songXml(song)` → `null` when `song.xml` isn't a string;
`loadSong` → `{ id, title, xml, source, rev, pdfOnly: xml == null, engine: song.engine?.n ?? null }`;
`songChoices().mine` entries carry `k` / `eng`; new `songInfo(id)` → the index entry (`{ k: "sample" }` for a
sample, `null` if unknown) — no XML read.

**forget.js** (new, `public/forget.js`): `forgetSong(id)` — everything a delete must do, in one place:
`removeSong(id)`; per-song entries of `resonate.sing.keys`, `.rates`, `.timing`, `.history`, `.practice`,
`resonate.play`; `resonate.sing.session` when its `songId === id`; `resonate.sing.song` when `=== id`;
`dropFromQueue(id)`; jobs.js `deleteJobsFor(id)` (stored reprocess jobs for it); then `resonate:data`
{ what: "settings" } and `resonate:remote` { songs: true, gone: [id] }. localStorage writes only when
`!spaceChanged()` (nav.js). Samples refused. It does not stop a conversion running in this page — the shell's
tray does that first (`tray.forget(id)`).

**jobs.js**: `deleteJobsFor(songId)` — deletes stored jobs with `replace === songId` (and their flag).

## 3. Importer (omr/importer.js)

- Every save stamps `engine: { n: ENGINE_N, id: job.engine || ENGINE, at: Date.now() }` (addSong / replaceSong).
- A replace keeps the old title unless the song's `titleAuto` is set; then the chosen title is used and passed
  to `replaceSong({ title })`.
- A replace (reprocess / convert) never writes `resonate.sing.song` (the open song stays the singer's).
- `export function titleFromFileName(name)` — the file-name title (`cleanFileName(name without .pdf).title`).
- Wake lock for a batch: `holdWake(on)` on the importer API — on: ask now (call it in the tap) and keep it between
  jobs (finish / ended don't release it while held); off: release unless a job runs.

## 4. The shell

**Songs list** (shell/songlist.js, shell.html):
- My songs rows: `<div class="songrow" data-id>` = the existing `<button class="song" data-id>` (tests click it)
  + a `⋯` button (`data-act="menu"`, aria-label "Song options"). Samples: no ⋯.
- Fact line (mono, few words): PDF only → `PDF only · 2d`, queued → `PDF only · queued`, being converted →
  `converting 3/7` (the PDF page being read, from the tray), can't be converted → `PDF only · couldn't read`;
  converted with the current engine → `engine 10 · 2d`; an older one → `engine ≤9 · 2d` / `engine 9 · 2d`
  (`data-old`, a quiet amber dot); MusicXML / link → `MusicXML · 2d`. Tile: PDF only = the doc icon, else score.
- ⋯ menu (a sheet-level `.pop` like `#add-menu`, placed at the row; closed on outside tap / Escape / re-render):
  **Convert** (PDF only) or **Reconvert** (converted from a PDF, its PDF on this device), **Delete** (two taps:
  `Delete` → `Delete?` for 3 s, as the Reader's ✕). Delete: `tray.forget(id)` (stops / forgets its conversion),
  closes the song if it's the one open (then reopens Songs), `forgetSong(id)`, re-render.
- My songs header (`.sec`, right side): `Convert all · N` (PDF-only songs not queued, not `fail`) and
  `Reconvert all · N` (k "conv", eng < ENGINE_N, PDF here); while a batch runs: `Converting 2/5` + `Stop`.
- + Add → PDF: `multiple` files; each stored at once with `addPdfSong` (title = `titleFromFileName`), no
  conversion. One file → it opens in place with the Score (its PDF). Menu copy: "PDF" (no "read in the background").
- Re-render on `resonate:data`, `resonate:remote` (songs / replaced) and the tray's queue changes; the running
  row's fact text refreshed every second (targeted, not innerHTML).

**Tray queue** (shell/tray.js): `convert(ids)` (tap handler: `imp.holdWake(true)` first; enqueue; pump),
`cancelQueue()`, `queueInfo()` → `{ ids, running, total, done }`, `forget(id)` (dequeue; discard the running or
pending job if it's this song's), `reprocess(id)` → `convert([id])` (Play's ⟳ / Convert).
- Pump (after every run ends, after dismiss / ✕ / Skip / Retry, and after `resumePending` at boot): when nothing
  runs, no bar is shown and `imp.pending()` is empty: take `ids[0]`; skip it if the song is gone or has no PDF
  here, or (for a Reconvert) already has the current engine; else `imp.reprocess(id)` minimized.
- Outcomes: done → `done++`, next. Same-again error kinds → `markConvFailed`, toast "“Title” couldn't be read",
  next. A kept (resumable) error, stuck ("stopped twice"), or waiting (another tab) → paused with the bar as
  today; Try again / Retry / Skip continue; Close → that song is dropped, next. The Reader's ✕ → stops this song
  and clears the queue.
- Per song: no done row while the batch continues; at the end one done row: a single song → as today
  ("✓ Title · updated" + Open); a batch → "✓ N converted". `holdWake(false)` when the queue ends or stops.
- The folded tile's line: `song 2/5 · 3/7 · note heads` during a batch.
- A converted song that's open reloads (`onReplaced` → songview.reload, as v88).

**Opening a PDF-only song** (shell/songview.js): `songInfo(id).k === "pdf"` → the Score only (never Sing,
on every device; unsaved), the Sing toggle hidden, the Score's ▶ not moved into the dock, the Piano as saved
(Play's own keyboard under the PDF). Next-up, the Reader's links and the remote never open Sing for one.
`reload(id)` re-checks: once converted the saved modules apply again (Sing included).
**Sing's ✕** isn't shown in the shell (the list deletes).
**Remote** (shell/remote.js): open_song for a PDF-only song opens it with the Score and answers ok with
`pdf_only: true`; runScore's wait accepts a PDF-only Score once its PDF shows.

## 5. Play (play.js, play.html)

A PDF-only song opens straight into the PDF view (no Verovio): `S.pdfOnly`, `#bar[data-pdfonly]` hides
`#hands`, `#play`, `#names`, `#chords`, `.size`, `#offer`, `#pdf`; the keyboard stays (dock rule
`!pdf.on || S.pdfOnly`; `#keys` enabled); ‹ › and pedals turn PDF pages; `#pdf-again` reads **Convert** (no
confirm) → `resonatePlay.reprocess(id)` (the shell: queued) else `pdf-import.html?reprocess=id`. No PDF on this
device → "This song's PDF isn't on this device." A failed PDF load stays failed (no empty stage). `open()` resets
`S.page` / `S.pages`. Guards that wanted `S.ready` also take `S.pdfOnly` (freshen, holdWake, warmAudio, untilReady).
`state()` adds `pdfOnly`, `shown`; `scoreState()` adds `pdf_only: true` (page / pages = the PDF's, views [],
bars null); `scoreRun`: score_state / score_open / score_pdf on work, the rest answer at once "Only its PDF so
far — convert it first". `resonatePlay.forget(id)`: drop the song's in-memory record so it isn't saved back.
play.html's song menu lists PDF-only songs as "Title · PDF" (they open in this mode).

## 6. Sing (sing.js)

`selectSong(id)` checks `songInfo(id)` first: PDF only → nothing changes, `showMsg("“Title” is a PDF — convert
it in Songs.")`, returns false (true when it opened; other failures roll back to the previous song). Boot with a
PDF-only saved song → Amazing Grace without overwriting `resonate.sing.song`. The menu lists PDF-only songs
disabled as "Title · PDF". `runRemote` open_song → `{ ok: false, pdf_only: true, error }` for one. ✕ uses
`forgetSong`. `resonateSing.open(id)` resolves true / false.

## 7. Sync (sync.js) and the cloud limit

- A PDF-only song's row: `sha: null`, `xml: null`, `pdf: {path, bytes, name}`; no xml.gz upload; the PDF is
  required (a failed upload throws / holds — never `pdf: null`; over 10 MB → held `pdf-large`, cleared when the
  song gets a rev). `sha` from `typeof xml === "string"` only.
- `engine` travels in the row data (`{ n, id }`, added in wireData from the stored record) but **not** in the
  fingerprinted form — a v89 tab sharing the meta builds the same one (with it in, they re-uploaded every converted
  song on each pass); pull stores it without hashing. An engine change without a new sha (an identical reconversion)
  doesn't propagate — harmless.
- Pull, new song with no xml path but a PDF path → download the PDF (required: an error retries), `putPdf`, then
  `putSong({ …, xml: null })`. A downloaded xml.gz that isn't MusicXML (`"null"` from a v89 tab) is refused (the
  song stays as it is / PDF only). A cloud PDF-only row meeting a local conversion → ours is kept and pushed.
- One-time cursor rewind (meta `v: 2`) so rows a v89 device passed by ("no file") are read again.
- `SONG_LIMIT = 20`; server: migration `supabase/migrations/20261120010000_sync_limits_20.sql` — 20 songs (the
  4-arg `sync_count` that leaves out the row being re-pushed, folding in the never-applied sync_fixes), 60 files.
  Applied before the client ships.

## 8. As built (v90) / tests

Built in four parallel parts against this contract, then one review pass (three lenses — data, the queue, the pages —
each important finding verified) and its fixes:
- **A deleted song never comes back:** a replace job whose song is gone (deleted here, in another tab, or on another
  device and pulled by the sync) ends without saving; the sync's tombstone also drops the song's queue entry and stored
  jobs and sends `resonate:remote { gone }`, which the tray turns into `forget(id)` (a running conversion discarded).
- **Old tabs:** `engine` is out of the sync fingerprint (above); a stored text that isn't MusicXML (a v89 tab's `"null"`)
  counts as PDF only everywhere (library.js `isMusicXml`, catalog, sync) and is never pushed.
- **The queue:** a job kept by another tab or a reload is continued here (folded; "Running in another tab" while that
  tab still has the engine) instead of stalling; Stop / the Reader's ✕ stop a song that is still starting; `ok` / `force`
  persisted; the wake lock only while something can run (not while paused on the bar); an error that can't be tried
  again passes the song by during a batch ("“Title” didn't convert"); the done row forgets a deleted song.
- **The list:** a tap outside the ⋯ menu only closes it; a re-render waits while the menu is open (an armed Delete stays).
- **Pages:** a PDF-only song converted on another device leaves the shell's PDF-only mode (`resonate:remote replaced` →
  `songview.reload`); remote open_song answers `ok: false` with Play's message when the PDF didn't open; a PDF page that
  fails to draw goes back to the last page that drew (not saved); pdf.js gets the `?r=` retry; the shell's Score reopens
  a song Play holds as failed; deleting the song Sing holds no longer moves `resonate.sing.song` to Amazing Grace.
- **Known limits:** songs converted before v90 show "engine ≤9" even when v89's engine 10 made them (no stamp then) —
  Reconvert all offers them again; an identical reconversion's new engine stamp doesn't sync; a conversion only runs
  while the page is visible (iOS suspends a hidden tab — the screen wake lock keeps it on); the MCP server's answers
  don't know about PDF-only songs yet (`get_song` says "open it once"; `get_score_pdf` works).

Tests (all in tools/regress.sh): libcore.cjs (45), songlib.cjs (209: the shell flows on the scripted worker, incl. the
review's F1–F10), playpdfonly.cjs (121), singpdf.cjs (13), synclib.mjs (the real sync.js against a fake cloud, incl. v89's
sync.js from git as a second tab), plus shell.cjs (324), reprocess.cjs (46), jobstore.cjs (ENGINE_N = the newest patch).
