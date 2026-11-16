# Play (sheet music for the piano): design

The Play page (`play.html`, v77): the piano part of a song as sheet music on an iPad, with note names that fade as you learn. This is the design spec the page was built from; where the build differs, the "As built" notes at the end win. CLAUDE.md "Play (sheet music)" has the short version.

Verovio facts the design relies on (checked with 6.4.0):
- **Ids:** Verovio keeps MusicXML `id`s on notes, rests **and measures** (`<measure id="m2">` becomes `g#m2`).
- **Spaces:** `<forward>` becomes an invisible `g.space`.
- **Pitch in the SVG:** `data-oct` is the written octave, and `data-oct.ges` is the sounding one under an 8va. MusicXML `<pitch>` is the sounding pitch. A key-only flat comes out as `g.accid[data-accid.ges="f"]` and a printed natural as `data-accid="n"`.
- **Staff lines:** each `g.staff` has its 5 lines as its first 5 `<path d="M0 y L x y">` children, in the same user space as the noteheads.


## 1. What the owner gets

A **Play** tab. Pick a song (the same list as Sing) and see the piano part as real sheet music, one screen at a time, sized for an iPad on the music desk. Every note carries its letter at first. Then fewer letters, then none, and tapping any note shows its name, sounds it and lights its key. Turn pages with a tap, a swipe, the arrow keys or a Bluetooth pedal. You can switch between both hands, one hand, or just the tune you already sing. The 📄 button shows the original PDF to check a doubtful bar.

## 2. Renderer: Verovio 6.4.0, vendored unmodified

**Why Verovio and not OSMD**

Both render all six test scores correctly (5227 notes, 0 wrong names after prep). Verovio:
- lays out and draws **one page at a time** to an exact page size, so a rotate or zoom only re-paginates;
- makes 7–12× less DOM;
- puts each note's pitch in the SVG (`svgAdditionalAttribute`);
- keeps the MusicXML ids, so page anchors and pitch facts map back to the score.

It also gives play-along later (`renderToTimemap`, `getElementsAtTime`) and transposition later. Costs:
- a 2.36 MB gzipped first download;
- 128 MB of WASM memory reserved;
- LGPL-3.0;
- a stricter importer. The Audiveris chord-beam bug is fixed in prep, and a count check guards against others (§8).

OSMD 2.2.1 stays the documented fallback and is not shipped in v1.

**Files** (copied byte for byte from npm `verovio@6.4.0`, released 2026-10-30, 17 days old):

```
public/vendor/verovio-6.4.0/verovio-module.mjs   7,400,681 B  (WASM + music fonts embedded; no other assets)
public/vendor/verovio-6.4.0/verovio.mjs              25,815 B  (toolkit wrapper; has no imports)
public/vendor/verovio-6.4.0/COPYING.LESSER   (LGPL-3.0 text, gnu.org/licenses/lgpl-3.0.txt)
public/vendor/verovio-6.4.0/COPYING          (GPL-3.0 text it builds on, gnu.org/licenses/gpl-3.0.txt)
public/vendor/verovio-6.4.0/OFL.txt          (SIL OFL 1.1 — the embedded SMuFL fonts)
```

**Why `.mjs` and a versioned folder:** `bump.mjs` only rewrites addresses that end in `.js`. So these files are never re-downloaded on an app bump; GitHub Pages revalidates them with a 304. The `.mjs` MIME type is already proven on Pages by `omr/pdfjs/pdf.min.mjs`.

**Load it only on Play**, with a dynamic import, so the song list appears first:

```js
const [{ default: createVerovioModule }, { VerovioToolkit }] = await Promise.all([
  import("./vendor/verovio-6.4.0/verovio-module.mjs"), import("./vendor/verovio-6.4.0/verovio.mjs")]);
const tk = new VerovioToolkit(await createVerovioModule());   // once per page load, never two
```

**vendor/README.md** gets a `verovio-6.4.0/` section in the style of the supabase one:
- the source (https://github.com/rism-digital/verovio, tag `version-6.4.0`; npm `verovio@6.4.0`, `dist/` copied unmodified);
- sha256 of both files;
- "LGPL-3.0-only: shipped as separate, unmodified files; you may replace them with another build of the same version";
- fonts under OFL. Check the font list against the 6.4.0 `fonts/` folder: Leipzig, Bravura, Leland, Gootville, Petaluma.
- To upgrade: pick a release at least two weeks old, copy the files into a new folder and change the two import addresses.

Do not esbuild-bundle it: that version is 8.3 MB, and modifying the files complicates the LGPL.

**Toolkit options** (once, after `loadData`):

```js
{ header: "none", footer: "none", breaks: "auto", mnumInterval: 0, adjustPageHeight: false,
  svgAdditionalAttribute: ["note@pname","note@oct","note@oct.ges","accid@accid","accid@accid.ges"],
  pageMarginLeft: 60, pageMarginRight: 60, pageMarginTop: 40, pageMarginBottom: 20 }
```

- `header:"none"` matters: `auto` prints every OCR credit, including the "Authorized for use by" line with the buyer's name.
- `breaks:"auto"` reflows and ignores Audiveris's system and page breaks.
- Optional, untested: `justifyVertically: true` to spread the systems down the page. Keep it only if short last pages look right.

## 3. The screen

**Structure** (play.html; dark app chrome on top, a paper panel below):

```
<header id="bar">   one flex row that wraps
  [Play] [Tuner] [Sing] [Tools] | [song ▾] [hands ▾] [ABC] [−] [+] [📄] [offer chip] … [‹ 3 / 11 ›] [v77]
<main id="stage" data-names="all|some|off">   paper (#fdfcf8, ink #111), full width, flex:1, touch-action:none
  <div class="page"><svg…></div> (+ a second .page in a spread)
<div id="strip">  keyboard strip, slides up over the stage bottom while peeking
<div id="bubble"> full names while peeking
```

**Page shell**
- `html,body{height:100%;overflow:hidden}`; the body is a flex column with height `100dvh`.
- `padding-top: env(safe-area-inset-top)`. The stage gets `padding-left/right: env(safe-area-inset-left/right)` for iPhone landscape.
- No horizontal page overflow at any width.

**Header (`#bar`)**
- A single flex container with `flex-wrap:wrap; row-gap:.4rem`. It is one row (about 52 px) at ≥ 1100 px wide (iPad landscape, desktop), two rows on iPad portrait (820–1032) and Split View, and up to three on a phone.
- Controls are at least 40 px tall (44 px under `(any-pointer: coarse)`) with `touch-action:manipulation`.
- Copy the CSS conventions from sing.html, including the v72 `option, optgroup { background:#1a1a30; color:#e8e8f0 }` rule.

**Controls** (only these):
- **Song** `<select>`: optgroups Samples / My songs, same as Sing.
- **Hands** `<select>`: `Both` · `RH` · `LH` · `Melody`. It lists only the views that exist (§5) and is hidden when there's only one.
- **Names** button: cycles All → Some → Off. The label is always `ABC`:
  - All: a filled purple pill.
  - Some: outlined, with "A·C".
  - Off: outlined grey, struck through.
  - `aria-label`/`title` "Note names: all|some|off".
- **− / +**: the staff size (below). No text.
- **📄**: only when the song has its original PDF (§5); it toggles the PDF view.
- **‹ 3 / 11 ›**: buttons plus the page text ("3–4 / 11" in a spread). On widths < 480 the ‹ › buttons hide and only the text stays.
- **Offer chip**: "Fewer names? [Some] ✕", shown inline in the bar when due (§4).
- Every `<select>` blurs after `change`, and every button blurs after `click`, so pedal keys never land on a control.

**Staff size**
- Sizes are a list of staff-space values in CSS px: `SIZES=[7,8,9.5,11,12.5,14,16,18,20,23]`. − and + step through them.
- Device pref `resonate.play.size`. Defaults:
  - **16** on a tablet: `(any-pointer: coarse)` and `min(screen.width, screen.height) ≥ 700`. That is about 3 mm per staff space at 70 cm; the in-head letters are about 2.2 mm. To be checked at the piano.
  - **12.5** on desktop.
  - **9.5** on a phone.
- Verovio scale = staff-space px / 0.18 (measured: scale 66 gives 11.9 px).
- Pinch is off on the stage (`touch-action:none` blocks it there), so −/+ is the zoom.

**Layout** (from the prototype's `layout()`, changed to absolute sizes):

```js
const W = stage.clientWidth, H = stage.clientHeight, staves = view.staves;   // 2 for Both, 1 for RH/LH/Melody
const want = S.size;
const spread = W > H && (W / 2) / want >= 48;                 // two pages side by side only if each still holds ≥ 48 staff spaces
const pw = spread ? Math.floor(W / 2) : W;
const sp = Math.min(want, pw / 40, H / (12 * staves));          // ≥ 40 staff spaces per system; ≥ 1 system per page
const scale = Math.round(sp / 0.18);
tk.setOptions({ scale, pageWidth: Math.round(pw * 100 / scale), pageHeight: Math.round(H * 100 / scale) });
tk.redoLayout();
S.pages = tk.getPageCount();
S.page = tk.getPageWithElement("m" + firstMeasureAtOrAfter(S.at)) || 1; if (spread && S.page % 2 === 0) S.page--;
```

What each screen shows (from the research shots, at the old width-based scale; the new defaults are larger):

| Screen | Pages | What you see |
|---|---|---|
| iPad portrait 820–1032 | one page | 3–4 grand-staff systems |
| iPad 13" landscape, size ≤ 14 | two-page spread | turns by 2 |
| iPad landscape at 16 | one wide page | about 2½ systems of ~5 bars |
| Split View 507 / 678 | one page | narrower systems |
| Phone portrait | one page | 2–3 systems (works, cramped) |
| Phone landscape | one page | 1 system |

**Page flipping**
- **Keys:** at `window` level. Forward: ArrowRight, ArrowDown, PageDown, Space, Enter. Back: ArrowLeft, ArrowUp, PageUp, Backspace. Call `preventDefault`; ignore the keys when the target is a select or input. AirTurn and PageFlip pedals send these keys.
- **Tap:** an off-note tap (moved < 10 px, < 500 ms) in the **outer 25%** of the stage turns: left goes back, right goes forward. A tap in the middle does nothing in v1.
- **Swipe:** |dx| > 50 px and |dx| > 1.5·|dy| turns. Avoid relying on the left screen edge (Safari's back swipe).
- **‹ ›** buttons.
- **Ends:** page turns stop at the first and last page with no wrap and no animation.
- **Spread:** turns by 2 and keeps odd pages on the left.
- Any page turn clears a peek.

**Keeping the place**
- `S.at` is the **written measure index** of the first `g.measure` on the shown page.
- Prep gives the first kept part's measures `id="m<mi>"` (§5); read it back from the first `g.measure` id on the page.
- It is updated on every turn and saved per song (debounced 1 s).
- Rotation, resize (a `ResizeObserver` on the stage, debounced 150 ms, skipped if the size changed by < 2 px), −/+, a hands switch and reopening the song all re-open at `getPageWithElement("m"+mi)`.
- In a view where that measure has no element, use the next measure that has one: `firstMeasureAtOrAfter`, computed per view in prep.

**Wake lock**
- `navigator.wakeLock?.request("screen")` once a song is shown and the page is visible, and again on `visibilitychange` to visible. Release it on `pagehide`. Wrap every call in try/catch; it needs iOS ≥ 16.4, or ≥ 18.4 in a Home Screen app.

**States**
- While the engine or the song loads, the stage shows "…" in the pager.
- If the engine fails: "Couldn't load the music — check the connection."
- If the song fails: "Couldn't open this song."
- No other text on the page.

## 4. Note names

**Drawing**
- A **badge on each notehead**, from names.js `style:"badge"`: a pill 1.3× the head's height centred on the head, the letter at 0.78 of the pill height in bold system UI, the accidental in a 0.8× tspan, and the pill 1.45× wider when there's an accidental.
  - **Filled heads** (quarter and shorter): a filled pill `#5e2fb8` with a white letter (contrast about 8:1).
  - **Hollow heads** (half, whole; glyph `E0A2`/`E0A3`): a white pill with a 0.1-thick `#5e2fb8` outline and a purple letter, so note values still read.
- Plain in-head text was tested and was unreadable on half notes, so the pill is the in-head letter of the pedagogy, done legibly.
- **Dense chords:** sort a chord's heads by y. Where two neighbours are < 1.3 head heights apart (a second or a third), both pills shrink to 1.05× (research: they overlapped by about 0.3 staff space).
- **Chords:** a letter on every head of the stack. No computed chord names. `<harmony>` symbols are stripped in v1.
- **Spelling:**
  - Exactly as written: MusicXML `<step>` plus `<alter>` gives ♯ ♭ 𝄪 𝄫, so it's B♭ in F major and A♯ where one is printed.
  - **♮** in the label when a natural cancels the key or an earlier accidental (e.g. "B♮" in F).
  - The ♯/♭ of a note altered **only by the key signature** gets class `ks`, tinted `#ffd27a` in a filled pill and `#b45309` in a hollow one.
  - **No octave numbers on the page.**
- **Where badges go:** into the note's own `g.note`, appended after the head (same user space, drawn on top). Read every `getBBox()` first, then write (one layout pass; 3–28 ms a page). Fonts: `-apple-system, system-ui, "Segoe UI", "Apple Symbols", "Segoe UI Symbol", sans-serif`.

**Pitch facts come from the XML, not the SVG.** Prep walks the full cleaned score once and builds `facts: Map<noteId, {step, alter, oct, midi, part, staff, voice, mi, acc, nat}>`. Per measure and per staff it tracks the key (`<key number>` aware) and a state map from `step+octave` to `alter` of printed accidentals, reset at each barline. `acc` is set like this:
- `"printed"`: the note has `<accidental>`; record it in the state.
- `"carried"`: no accidental, but the state has this staff, step and octave, or it's a tie-stop from the previous bar whose alter differs from the key; or OMR left an alter that differs from the key with nothing printed.
- `"key"`: `alter ≠ 0` and alter equals the key's alteration for that step.
- `null`: everything else.
- `nat` = true when `alter === 0` but the key's alteration for that step ≠ 0, or the carried state was ≠ 0. Then the label shows ♮.

The SVG's `data-pname`, `data-accid`/`data-accid.ges` and `data-oct` are only cross-checked by the tests. If an id is missing from `facts`, fall back to those attributes.

**Levels** (one CSS attribute on `#stage`; no re-render):
- **All** (the default the first time): every head has a badge.
- **Some:** a badge only on notes that are
  - (a) **≥ 2 ledger lines** from their staff,
  - (b) `acc` printed or carried, or
  - (c) `nat`.

  A key-only note (not in a–c) gets a small tinted **♭/♯ mark** (`.km`, 0.6 head height) at the head's upper right, with no letter. On the owner's four piano parts this names 5–32% of notes.
- **Off:** clean score.

**Ledger lines** are measured from the drawing, so they follow the clef in force, clef changes and 8va written positions:
- `top` and `bottom` = the y of the first and fifth path of the note's `g.staff`; `space = (bottom - top) / 4`.
- `cy` = the centre of the head's bbox.
- `ledgers = cy < top ? floor((top - cy)/space + .05) : cy > bottom ? floor((cy - bottom)/space + .05) : 0`. This gives 2 for C6 and for A3 in treble, and for E4 in bass.
- Cross-staff notes (Audiveris does write them: Killing Me Softly bar 31, Songbird bars 51, 90, 149) are measured against the staff they're drawn on (Verovio's `note@staff`/`chord@staff` → `data-staff`; see As built).

```css
#stage .nn, #stage .km { display:none }
#stage[data-names=all] .nn, #stage[data-names=some] .nn.lv, #stage[data-names=some] .km, #stage .nn.peek { display:inline }
#stage g.note.peek .notehead use { fill:#d86b00 }
```

**Peek** (the core of "gradually learn"; it works at every level)
- **Starting it:** `pointerdown` within `max(16px, 1.2 × head height)` of a head centre (the nearest wins) picks that head's **chord**: its `g.chord`, or the note alone.
- **What it shows:**
  - its badges get `.peek` (shown even at Off) and its heads turn `#d86b00`;
  - `#bubble` shows the full names **with octave**, low to high: "E♭4 G4 B♭4", same as the Sing page. Octave = the MusicXML sounding octave.
  - `#strip` slides up.
- **Sound:** the notes play through `holdPiano(ac, piano, now, midi, 1)` until the finger lifts (at least 0.25 s; auto-release after 60 s).
- **Cancelling:** if the pointer moves > 12 px within 200 ms, the peek is cancelled (`release(now, 0.01)`) and the gesture becomes a swipe. A peek gesture never turns the page.
- **Hiding:** everything hides 2 s after release.
- **Keyboard strip:**
  - an inline SVG over the stage bottom, `#14142c`, height `clamp(56px, 9vh, 110px)`;
  - the range is the view's lowest to highest sounding note, widened to whole octaves C…B, at least C3–B5;
  - lit keys are **RH `#a64fff`, LH `#4f7cff`** (staff 1/2; for a hymn, part 1/2; Melody = RH) and show their letter;
  - **middle C** has a small grey dot;
  - `pointer-events:none` in v1.
- **Audio:**
  - Set `navigator.audioSession.type = "playback"` in the gesture before making the AudioContext. Replace a context that is `closed` or `interrupted`.
  - The first `pointerup` or `click` anywhere resumes the context and starts `loadPiano(ac)`, like Sing's `unlockPlay`.
  - If the context wasn't running at the press (iOS starts audio only at touch end), the chord plays for 0.8 s at the lift instead.
  - On `pagehide`: close the context and set `"auto"`, as voice.js and sing.js do, or the Tuner's mic breaks on iOS.

**Fading** (offered, never automatic, never scored)
- **A practice day:** a calendar day on which this song was shown while the page was visible for ≥ 5 minutes, with ≥ 1 page turn or peek. A 15 s tick adds the visible time, capped at 15 s per tick.
- **The offer:** at ≥ 3 practice days at the current level (not Off), the bar shows "Fewer names? [Some]" (or [Off] when at Some) and ✕.
  - Tapping the level sets it and resets the day count.
  - ✕ asks again after 3 more practice days.
  - The chip appears when the song opens and stays until it's used or the song changes.
- Changing the level by hand also resets the count. A new song starts at the level chosen last (device pref `resonate.play.names`, default `all`).

## 5. Songs and parts

**Picking**
- The song list is shared with Sing: Samples (from `SAMPLES`) plus My songs from `listSongs()`.
- The song open is the **same key Sing uses**, `resonate.sing.song`: the song you're working on follows you between tabs. Write it only `if (!spaceChanged())`.
- A missing id falls back to the first sample.
- On `window` "resonate:remote" with `detail.songs`, refresh the list. If the open song is gone, fall back.
- Titles come from the library's `song.title`, never from the XML (OCR junk).
- No Open/Link/import on Play.
- pdf-import.html gets a "Play it" link next to "Sing it" (pdf-import.js already sets `resonate.sing.song`).

**Cleaned XML: new `catalog.js`.** Move these from sing.js **unchanged**, and have sing.js import them instead of defining them:
- `SAMPLES`;
- `cleanXml(xml)`;
- `songXml(song)`, reading `APP_VERSION` from `#version` at call time. play.html carries the same badge, so the clean-up cache (`song.clean`, `saveClean`) is shared.

Then add:
- `loadSong(id)` returns `{ id, title, xml, source }`: a sample is fetched; a library song goes through `getSong` then `songXml`. It returns null when missing.
- `songChoices()` returns `{ samples:[{id,title}], mine: await listSongs() }`.

sing.html keeps its hard-coded Samples optgroup.

**Parts (`playprep.js`)**
- Parse the cleaned XML once with DOMParser.
- Give every `<note>` without an id `id="n<i>"` in document order over the whole score, so ids are the same in every view.
- Build `facts`.
- Pick the part: from `partsOf(doc)`, which gives id, name, max `attributes>staves`, pitched notes, lyrics, clef of each staff, and the share of measures with pitched notes.

  1. **Piano:** parts with `staves ≥ 2`, or a name or instrument-name matching `/piano|pno|keyboard|klavier|clavier|organ/i`, or a midi-program 1–8. Take the one with the **most pitched notes**. Audiveris names every 2-staff part "Piano", so this picks Killing P2, Wichita P2, Songbird P3, Piano Man P2, Longest Time P1 and Dichterliebe's piano.
  2. **No piano (hymn):** keep the parts with pitched notes in ≥ 10% of measures. If exactly two remain and they are a treble (G) part then a bass (F) part, they are the keyboard score: brace them (`part-group` brace, as `keepParts` does). Amazing Grace is this case.
  3. **Otherwise:** all live parts with no brace; RH/LH not offered. A voice-only song therefore shows its one staff.
- **Melody:** export `pickMelody(root)` from musicxml.js by moving the existing "most lyric syllables, higher voice at ≥ 70%" loop and the `melodyStaff` computation into a function. `parseMusicXml` calls it, with identical results. It returns `{partId, voice, staff}`.

**Views** (each built once per song and cached as an XML string):

| view | keeps | lyrics |
|---|---|---|
| Both (default) | the piano part, or the braced hymn pair / live parts | off |
| RH | piano staff 1, or the hymn's treble part | off |
| LH | piano staff 2, or the hymn's bass part | off |
| Melody | `pickMelody`'s part, staff and voice (Longest Time: piano staff 1 voice 1; hymn: P1 voice 1) | on |

Melody is hidden when it would equal Both. The default per song is Both.

**`buildView(doc, plan)`** works on `doc.cloneNode(true)` and returns serialized XML:
- Remove the other `score-part`s and `part`s. Drop `part-group`s when one part remains; add the brace for the hymn pair.
- **Staff or voice filter with a timeline rewrite.** Do not emit forwards in foreign voices: an extra layer of spaces would flip Verovio's stems. For each measure:

  ```
  pos = 0 (original cursor), cur = 0 (new cursor)
  for each child: <backup> pos -= d, drop | <forward> pos += d, drop
    <note>: onset = chord ? last : pos; if !chord && !grace: pos += d
      kept (staff/voice match) → before it, if !chord: emit <forward><duration>onset-cur</duration><voice>its voice</voice></forward> or <backup>cur-onset</backup> as needed; cur = onset + d (if !chord && !grace); set <staff> to 1
      not kept → drop
    <direction>/<attributes>/<harmony> for another staff → drop; for the kept staff → move cur to pos first, staff/number → 1
  ```

  Also: in `<attributes>` drop `<staves>`, other-staff `clef`/`key`/`staff-details` (`number≠s`) and set `number` to 1 on the kept ones; drop `print > staff-layout[number≠s]`.
- **Verovio fixes** (from prep.js, all verified):
  - remove `<beam>` and `notations > tuplet` from `<chord/>` notes. Without this Wichita lost 496 of 820 notes;
  - set `print > measure-numbering` to `system`;
  - remove a `<key>` that restates the key in force when the measure has no clef or time change (stops mid-score courtesy keys);
  - blank `part-name` and `part-abbreviation`;
  - remove `measure > harmony`;
  - remove `note > lyric` unless Melody;
  - remove every `<credit>`;
  - drop a `wedge` start with no matching stop (same number) before that number's next start or the part's end, together with its `<direction>` if that is all it holds. Check that Songbird bars 15–19 lose the long line.
- Give the first kept part's measures `id="m<mi>"` (mi = 0-based written index) and record `firstMeasureAtOrAfter`.
- Repeats and endings stay as written (no unfolding). Hymn verses: lyrics stay off for piano (8 stacked verses make a huge gap).

**PDF view (📄)**
- Shown when the library song has `source:"pdf"` and `getPdf(id)` returns a record.
- Load pdf.js from `omr/pdfjs/pdf.min.mjs` with `wasmUrl`, `standardFontDataUrl` and `iccUrl` pointing at `omr/pdfjs/…`, as pdfprep.js does. The owner's Musicnotes PDFs are JBIG2 scans and render blank without `wasmUrl`.
- Render **one page at a time** into one reused `<canvas>` at devicePixelRatio, fitted to the stage. Use the spread rule when the PDF page at that width is still ≥ 75% of print size.
- The same keys, taps, swipe and ‹ › turn PDF pages. The PDF page is remembered per song (`pdfPage`).
- Toggling back returns to the sheet at its anchor. Names, size and hands are disabled while the PDF shows.
- Leaving the view shrinks the canvas to 0×0 (iOS canvas memory).
- There is no mapping between sheet pages and PDF pages.

## 6. State

| key | contents | where |
|---|---|---|
| `resonate.sing.song` | the song open (shared with Sing) | already in DATA_KEYS |
| `resonate.play` | `{ [songId]: { names: "all"\|"some"\|"off", view: "both"\|"rh"\|"lh"\|"melody", at: mi, pdfPage, days: { n, ask, d: "YYYY-MM-DD", ms, act, done } } }` | **add to `DATA_KEYS`** in space.js (shelved and parked with the account) |
| `resonate.play.size` | staff-space px | device pref, not in DATA_KEYS |
| `resonate.play.names` | level for a song opened the first time | device pref |

- Every write to a DATA_KEYS entry is guarded with `if (spaceChanged()) return`, as sing.js `store()` does.
- `days` is written at most every 30 s and on `pagehide`.
- On load, prune `resonate.play` entries whose song no longer exists (not a sample and not in `listSongs()`). (As built: a song's record goes with the song, and the load-time prune is guarded — see As built.)
- **Not synced in v1:** no sync.js changes. Later: a `song_state` row `"<song>|play"`.
- Fires no "resonate:data".
- play.html loads `nav.js?v=N` as the **first** module, then `play.js?v=N`. nav.js handles space parking, account links and starting sync.
- Play has nothing to hold the other-tab reload for (no `resonateBusy`).

## 7. Performance

**Measured** (desktop Chromium / 4× CPU slowdown / WebKitGTK):

| Step | Desktop | 4× CPU | WebKitGTK | Notes |
|---|---|---|---|---|
| Engine start (cached) | 124–140 ms | ~550 ms | 151 ms | |
| `loadData`, Piano Man | 302 ms | 1.1 s | | Songbird 246 ms in WebKitGTK |
| First page render | 35–85 ms | 100–210 ms | 58 ms | |
| Other pages | 6–18 ms | | | |
| Badges per page | 3–28 ms | | 24 ms | |
| Re-layout after rotate | 78–135 ms | 395–460 ms | | |
| fixOmrScore + prep | 40–490 ms | | | the clean-up is cached per app version via `song.clean` |

**Expected on the iPad:** opening a song 0.3–1 s, a turn ≤ 100 ms (≤ 30 ms when pre-rendered), a rotate ≤ 0.6 s.

**Rules**
- Start the engine import and the song load in parallel; the song list shows immediately.
- `renderToSVG(p)` only for the pages shown. Cache at most the shown page(s) plus the next and previous as SVG strings, and clear the cache on every `redoLayout`. Pre-render the next page with `const idle = f => window.requestIdleCallback ? requestIdleCallback(f, {timeout: 500}) : setTimeout(f, 50)`. Safari has no `requestIdleCallback`, and `requestIdleCallback?.()` throws there.
- Draw badges after insertion: all bboxes first, then the writes.
- Changing hands means a new `loadData` from the cached view XML (0.3–1 s; "…" in the pager meanwhile).
- −/+ and rotation only `setOptions` and `redoLayout`.
- Only SVG, about 1.4–2k nodes a page, and no canvas except the PDF view.
- One toolkit per page load.
- Timings go to `resonateDebug().play.t`.
- If the iPad stutters on open, the next step is moving the toolkit into a Worker that returns SVG strings (later, not v1).


## 9. Scope

**v1** (this build):
- the Play tab and header pills;
- Verovio page-at-a-time rendering of the piano part, with the hymn and voice-only fallbacks;
- views Both / RH / LH / Melody;
- name badges with All / Some / Off;
- peek with sound, the bubble and the keyboard strip;
- the per-song fading offer;
- −/+ staff size;
- paging by keys, pedals, taps, swipe and ‹ ›;
- the landscape spread;
- keeping the place by measure across rotation, zoom, views and reloads;
- the wake lock;
- the 📄 original PDF view;
- shared song choice and cleaned XML;
- local state only.

**Later:**
- **Listen** to the piano part (or one hand, slower) with a moving highlight and automatic page turns (`renderToTimemap`, `getElementsAtTime`, `scheduleAhead`).
- Transpose (follow Sing's key; Verovio `transpose`).
- Toggles for chord symbols and lyrics.
- Tapping strip keys to hear them.
- A single-note mic check, "✓ that's it" (YIN).
- "Simplify": RH top note, LH bass note.
- Half-page turns.
- A centre tap to hide the chrome.
- A dark paper theme.
- Syncing `resonate.play` (`song_state "<song>|play"`).
- An OSMD fallback if a real score shows rendered ≠ pitched.
- A Worker toolkit if the iPad stutters.
- Web MIDI note checking in desktop Chrome.

Not planned:
- **Never:** octave numbers on the page, a separate row of names, colours by pitch, generated fingering, scrolling or falling-note views, grades or streaks.


## As built (v77)

Where this differs from the sections above, this wins.

**Toolkit options** (`VRV` in play.js):
- The §2 set, plus:
  - `spacingStaff: 8`, `spacingBraceGroup: 8`;
  - `justifyVertically: true`, `justificationStaff: 0.2`, `justificationBraceGroup: 0.2`;
  - `lyricWordSpace: 3` (eight stacked verses ran words together: "taughtmy");
  - `svgAdditionalAttribute` also has `note@staff`, `chord@staff` and `staff@n`.
- `transposeToSoundingPitch` puts a transposing part (B♭ clarinet, horn, guitar 8vb) at the pitch a pianist plays. It is set per view (`loadView`), only when the view's XML has a `<transpose>`: on for every score it moved positioned rests too, so Songbird's and Killing Me Softly's bass-staff rests were drawn far above their staff and Songbird's systems stretched to one a page (second check). `noteFacts` shifts each note's step/alter/octave and the key by the same interval before classifying accidentals. Verovio respells a remote sounding key (G♭ → F♯, C♭ → B): such facts carry `tr`, and `drawnFact` (playnames.js) takes the spelling Verovio drew when its MIDI agrees, so badges, the peek and the strip name what is drawn.

**Layout** (`measure()`):
- **Spread:** two pages when `W > H` and each half holds ≥ 48 staff spaces.
- **Staff space:**
  - `sp = min(size, pageWidth / 40, H / (12 · staves))`.
  - **Until a size is chosen on this device** (`sizeAuto`), a grand staff in landscape gets the size step at or below `max(11, H / (27 · staves))` (a grand-staff system with its margins takes ~27 staff spaces): 14 on an 11" iPad Air, 12.5 on a mini, two systems a page. At 16, they held one system and about a third of blank paper. (The first fix, `H / 24` unrounded, gave 15.9 on the Air: nearly no change, and + from it was a 1% step that re-paginated.)
  - + from there goes to the next size and saves it.
- **Short songs:** a view that fits on one page is laid out at the stage's full width, not as half of a spread. A lone last page of a spread stays in its half.

**Views**
- Melody is offered only when the melody part has words. It is hidden when it is the same notes as Both (a voice-only song); Both then shows the words.
- A hymn's two parts (treble over bass, no piano) are braced as a grand staff.
- When three or more stanzas stack, Melody shows only the first (`firstStanzaOnly`). Amazing Grace's eight verses made the page 70% text.
- **Piano views keep the song's road map.** Audiveris writes endings, D.S./To Coda, tempo and section marks on the top (vocal) part only, and reads a piano's 8va lines as endings. `copyMarks` copies the top part's endings and repeats into the kept part's barlines, and its words, tempo and navigation marks onto staff 1 at the same beat. The kept part's own endings are dropped when the score is from Audiveris or the top part has endings, as Sing's `readStructure` does.
- `isMark` keeps tempo, navigation and section marks from a hidden staff, once.
- **Prep repairs** for what Verovio draws wrong or not at all:
  - ties written stop-after-start are put in order (`tiesInOrder`);
  - a one-hand view pairs its slurs and re-ends the beam groups the hidden staff cut (`slurPairs`; `beamGroups` read before the filter as Verovio reads them — a grace note doesn't break a group, a "begin" inside an open group continues it — then `rebeam` touches only the cut groups: rewriting every group split Wichita's Melody bar 9 and runs with grace notes);
  - a multi-measure rest over bars that have notes is dropped (`dropCoveringRests`);
  - a part missing from the part-list is added;
  - `dropRestatedKeys` uses the first key of each bar only, as Verovio draws it (a dropped restatement isn't the bar's first: the next key in the bar is);
  - `placed()` reports "couldn't draw" when no staff comes out, not blank paper.
- **Tuplets:** OMR tuplets without a tuplet mark (four quarters in a 3/4 bar, from fixscore's unmarked-tuplet fix or a "3" Audiveris read without its bracket) get `<tuplet>` start/stop. This is `markTupletGroups` in omr/fixscore.js. A group closes at `actual` × its own smallest value, so quarter triplets next to eighth triplets are separate groups. It runs on every load of an Audiveris song and is idempotent. Sing's parse is unchanged; it only adds marks (fixOmrScore's output on the owner's six scores is byte-identical before and after the second check's fix).

**Names**
- **Key-signature mark** (`placeMarks`): the ♭/♯ `.km` mark of a key-only note sits at its own head's height, right of the head after its dots and any ledger dash, else left of it — on the side where its ink (measured on a canvas in the page font) touches nothing: another head (an oval) or a name pill, a printed accidental, a stem or flag, a dot, a rest, a clef, a key or time signature, a barline or stem (kept clear of), a ledger dash, a tie or slur (its ink, sampled), another mark; its bar and the bars either side in drawing order are checked. Neither side clear: no mark (`data-km="blocked"`; 14 of 581 in the tests) — the name is a tap away. Its size is 1.0 × the head height. At first it sat at the upper right, beside the note a third above, which then read as F♭; the first placement fix still hit the next note's accidental, barlines and ties (pixel check on the owner's songs: 11–33 collisions, now 0). Cost: ~1 ms a page.
- **Some floor:** on a page where the rules name fewer than 15% of heads, each bar's first chord gets one name per staff: the top note on staff 1, the bass note on the others. The first chord is the notes at the bar-staff's earliest onset (facts carry `onset` in quarters and `grace`; by x only for notes the facts don't know — a second's head on the far side of the stem had won by x), and every head sharing the picked one (another voice's unison) is named too, so no pill is covered. Amazing Grace's first page had 0 of 56 names at Some, so the first fade would have taken away nearly all of them.
- **Placement fixes:**
  - Cross-staff notes are measured against the staff they're drawn on.
  - Pills stacked by a unison plus a second are pushed apart vertically.
  - A pill's left end is trimmed past a printed accidental.
  - Verovio's own `<style>` draws a `currentColor` stroke on every rect; play.html removes it.
- **Per-song level:** a song's level is pinned when it is first opened, so changing the level on one song never changes another's.

**Input**
- **Pedals and menus:** a `<select>` focused by a tap gives the page-turn keys back (blur, then turn), including Space and Enter. A tap on the music also blurs a menu that still has focus. A select reached with Tab keeps its keys.
  - Known limit: on an iPad, UIKit catches Space on a focused menu and reopens it before the page sees the key.
- **Wake lock:** Safari grants the wake lock only from a user gesture. Every trusted pointerup, click or keydown asks for it until it is held.

**PDF view (📄)**
- The hidden sheet's descendants are hidden too: Verovio writes `visibility="visible"` on some staves.
- In landscape it shows two pages when each is ≥ 75% of print size, or ≥ 97% of the size a single page would get.
- Each open has its own token. A page that can't be read shows a message, and documents are freed with `loadingTask.destroy()`.

**Builder fixes:** found while building, before the review:
- the PDF render race;
- the Split View pager row;
- the offer chip wrapping the bar (at 1100–1140 px too, after the review);
- the pager width on phones;
- −/+ became one segmented control with magnifier icons. A bare − / + next to ABC read as fewer / more names.

**State**
- **Records go with their songs:** a song's `resonate.play` record is removed with the song, both by Sing's ✕ and by a sync tombstone.
- **The load-time prune is guarded.** It runs only when storage is persistent and the songs' database generation equals the one seen last visit. That is the device key `resonate.play.gen`, deliberately not in DATA_KEYS. A library that failed to open lists no songs, which once wiped every record.
- After a view fails, the next view that draws clears the failure. The hands menu retries the engine, and saves the view only once it has drawn.

**Fonts:** the Verovio module also embeds Liberation Serif 1.04 (GPL-2.0 with the font exception). It is used only under the option `fontTextLiberation`, which Play never sets; its license ships in `vendor/verovio-6.4.0/` anyway.

**Review (v77, adversarial, five lenses):** names, iPad/Safari, state, real scores, UX.
- 27 findings were confirmed. 25 are fixed, plus the −/+ labels in part.
- **Not fixed:** a later key change written for one staff only (`<key number>`) is drawn on both staves. It needs an MEI round trip, rewriting each staff's keySig and reloading, about 70 ms. None of the owner's scores, and no Audiveris export, has one.
- **Second check** of the fix commit (four lenses — prep, state, names, cross-page — each finding re-proved from scratch by a skeptic): 10 confirmed, all fixed. One was serious: `transposeToSoundingPitch` on for every score moved Songbird's and Killing Me Softly's bass rests out of their staff. The rest: `rebeam` rewriting uncut groups, remote transposed keys respelled, a restated key's removal hiding the bar's next key, a failed engine download never retried (the browser keeps a failed module import: the retry asks for `?r=N`), the landscape soft size, key marks on accidentals/barlines/ties, the Some floor's unison and second-across-the-stem picks, mixed-value tuplet groups.

**Tests** (in tools/, outside the repo):
- `playunit.cjs`: prep and facts on every fixture, with sidecar checks.
- `play.cjs`: spec §8 at 8 sizes, plus the owner's scores from `PLAY_SCORES`.
- `playcore.cjs` and `playextras.cjs`: peek, sound, strip, fading, PDF, spaces.
- `playheaders.cjs`: every page's header.
- `playfixes.cjs`: a check per review fix, each failing on the pre-fix code.
- `playwebkit.mjs` and `playextraswk.mjs`: WebKitGTK, including the wake lock after a pedal key.
- `catalog.cjs`: Sing and Play share the song list and the clean-ups.
- `regress.sh` runs the Sing suites, then play, playheaders, playfixes and playwebkit.

## As built (v78): Full score

The owner asked for "the vocal melody along with both hands on the same view — basically like the original sheet music". The **Full score** view is the tune's staff with its words over the piano's grand staff, first in the view menu (fullest to smallest: Full score, Both hands, Right hand, Left hand, Melody). A song with no saved view still opens in Both; the choice is kept per song in `resonate.play[id].view`.

**Which songs, which parts** (`planViews`)
- Offered when the tune (`pickMelody`) has words and the view shows more than Both: more parts, or the words Both leaves out (the tune inside the piano; a hymn). Never for a voice-only song (Both is already the tune with its words).
- Parts: the tune's, the piano, and any other part that plays (pitched notes in ≥ 10% of bars, as for the no-piano case), in score order. With no piano: Both's parts plus the tune's. A hymn pair stays braced as in Both.
- The owner's songs: Killing Me Softly and Wichita Lineman P1+P2; Songbird P2+P3 (its 4-note P1 is out); The Longest Time P1 (the piano, words on its right hand only); Amazing Grace P1+P2 braced, verse 1; Piano Man P1+P2+P3.
- **Piano Man's P3** ("Voice" to Audiveris, 401 notes, 13 syllables, notes in 44% of bars) is the printed **accordion** cue staff: on the PDF it is a fourth staff below the piano, labelled "Accordion", in the systems where it plays (from page 4: "Add cues 2nd time"); Audiveris marked it `staff-details print-object="yes"` exactly there. Its arpeggios are not the piano's. It is in the score, its stray syllables are not.

**Words.** Only where they're sung (`plan.words` = { part, staff, also, tune }): the tune's part — every staff of a singer's own part (a duet on two staves), only the tune's staff when the tune is inside the keyboard part (The Longest Time) — and any other kept part whose notes mostly carry words (lyrics on ≥ 25% of its pitched notes: a second singer's part, `also`). Stray OCR syllables on the piano (Piano Man P2's 6 in 2019 notes) or a cue staff (P3's 13 in 401) are dropped. Stacked stanzas: `firstStanzaOnly`, as Melody. On the tune's staff, syllables the recognition gave to another voice (the chord under the tune: "For" on the tune, "the" on the chord, "long" on the tune, "est" on the chord) move onto the tune's note at the same moment when it has none for that verse (`gatherSyllables`, Melody's rule without dropping the voices), so a word's hyphens join within one voice — Verovio joins a syllable to the next one of its own voice, and they ran through the other voice's syllables (33 hyphens through a syllable on The Longest Time's pages). Only verses the tune's voice sings move (a duet's second singer on one staff, with his own verse, keeps his). A syllable with no tune note at its moment (sung on a beat the tune holds through: "wo-man" over a half note — two in The Longest Time) stays, and the hyphens either side of it go.

**Sung parts.** `plan.sung` lists the parts that sing (the tune's, a second singer's; not the keyboard's or a hymn's braced pair): their notes light the strip in the voice's colour, and their staves are read from the top at Some (a baritone's bass-clef line isn't a left hand).

**Road map.** Verovio's MusicXML import takes a measure's barlines — bar style, repeats, endings — from the first part only (checked: Wichita with P1+P2 draws P1's three endings and none of P2's misread 8va "endings"; a light-heavy written only on P2 is drawn single). Audiveris writes a barline only on the staves printed in that system, so where the voice rests through a system its part has none: Piano Man's two section double bars and its final barline and Songbird's double bar were drawn single.
- `scoreBarlines`: the heaviest bar style of the parts (light-heavy > heavy-light / heavy-heavy > light-light) and any repeat go into the top part, location by location.
- `scoreEndings`: the lower parts' endings go when the score is from Audiveris (a piano's 8va lines) or the top part has its own; a file from another exporter with endings only below the top part has the first such part's moved up.
- `scoreMarks`: a mark a lower part repeats from the top part's same bar goes (an exporter that writes system text into every part drew it over every staff). From Audiveris, a section heading (verse, chorus, bridge, interlude…) placed **below** a lower part's staff was printed between two systems, over the next one, and attached to the staff above it: Piano Man's second "Chorus" came under the accordion 7 bars early, Wichita's "Verse:" under the left hand 3 bars early. It moves to the top part, to the bar at the same place across the next system (Audiveris's measure widths and the mark's place in its bar) — onto a section barline (double, heavy or repeat) when one is within a bar's width of there, as headings are printed — and goes when there's no next system. Piano Man: "Chorus" over bar 204 ("Sing us a song", after the double bar), as printed; Wichita: "Verse:" over bar 5, with the segno. Both keeps v77's.
- Songbird's marks live on its spurious top part: `copyMarks` puts them on the vocal staff as it does for Both.

**Condensing (Verovio 6.4.0, read in its source and measured).**
- `condense: "auto"` (the default) optimises only when the score definition has more than one group symbol (`ScoreOrPartElement::ScoreDefNeedsOptimization`): a voice + piano score has one (the piano's brace), so nothing was condensed. Each single-staff part gets its own unmarked `part-group` (`group-symbol none`), which draws nothing.
- A staff is shown in a system when it has a note or a clef there (`ScoreDefOptimizeFunctor::VisitStaff`); rests and directions don't count.
- A staff group holding an instrument definition keeps all its staves if one shows (`VisitStaffGrpEnd`); without one each staff is condensed alone. Audiveris writes a `<midi-instrument>` per part (Verovio's `instrDef`); a hand-made piano part without one lost its resting left hand under a lone right hand. `wholeInstrument` adds one to every multi-staff part that lacks it.
- `condenseFirstPage` is about the first **system** only. Left off: the first system shows every staff, so a tempo or title mark over a piano intro (the voice's, in most files) is drawn.
- `condenseTempoPages: true` shows every staff of a system that has a tempo or a fermata (the opposite of what its name suggests). Left off.
- A direction is drawn only on its own staff: a D.S., To Coda or section word over a piano interlude vanished with the voice's staff (an empty `g.dir`). `keepMarks` gives each resting bar that carries a mark an invisible, unpitched grace note (`print-object="no"`, id `keep-<part>-<bar>`), so the staff stays in that system. It has no fact, gets no name and isn't counted (decorate and `countAll` skip a `g.note` Verovio draws `visibility="hidden"`), and it widens that bar by about 1.5 staff spaces at its start.
  - The first try, a hidden restated clef, kept the staff too, but Verovio then drew that staff's clef invisible at every later system start. A visible restated clef is drawn mid-line. A clef at a bar's start is also filed under the previous bar (the system before, at a line break).
- **Endings once.** Verovio draws an ending over the first staff of every staff group (`@ending.rend` "grouped", its default): over the voice, again over the piano's right hand and over an accordion staff. Only `scoreDef@ending.rend="top"` draws it once, and MusicXML can't say that. So a full score with endings is loaded, exported with `tk.getMEI()` (5–20 ms), given `ending.rend="top"` and loaded again as MEI (13–140 ms, faster than the MusicXML import). The MEI is cached on the built view (`v.mei`). Note and measure ids, pages and systems were checked to be the same. With a transposing part (a B♭ clarinet, a MuseScore guitar's octave) the MEI is already at sounding pitch — Verovio drops `trans.*` once it has transposed — so it's loaded with `transposeToSoundingPitch` off: the same pitches, spellings and places as the MusicXML load (checked), endings once.
- `systemDivider: "none"`: "auto" drew a heavy "//" between systems of more than one group.
- The other views keep Verovio's defaults (set explicitly per view in `CONDENSE`; Both and the others have one group symbol or none, so nothing changes for them).
- A source part-group all of whose parts the score keeps (a choir's bracket, its barlines through the staves) is kept, as Both keeps it (`wholeGroups`); the unmarked groups go only around the parts outside it. With a piano's brace too, condensing still runs (two group symbols): an alto resting through a system is left out of it inside the bracket.
- A part the part-list doesn't name gets its entry where its `<part>` stands (it was appended: Verovio orders staves by the part-list, so an unlisted voice was drawn under the piano), and the measure ids go on the part the part-list names first (Verovio takes a measure's id from that part: with the voice unlisted the ids were random and the place stuck at bar 0). This is in `buildView` for every view: a hymn's Both with its top part unlisted had the same fault in v77.

**Size** (`scoreSize`, `fitScore`; its own device pref `resonate.play.size.score`).
- Spreads: the score is laid out as two pages only when each holds ≥ 72 staff spaces (`SCORE_WIDE`, the piano views' rule is 48): with a size chosen by − / +, landscape iPads got halves of 51–62 staff spaces with one bar a system and less music on screen than one page.
- The height budget: a system of 3 staves 38 staff spaces (`SCORE_SYS`), 7.5 less for a staff less, and 15 (`SCORE_EXTRA`) for each staff beyond three — the accordion system's measured worst, 53. At 7.5 a 4-staff system was budgeted 45.5 and Piano Man's ran off the foot of the page at the largest size + allowed (an "mf" cut by 23 px on an Air in landscape) and on a phone in landscape (a whole staff). Whether one system a page leaves a third of it blank is judged on the 3-staff height (`typ`): the 4th staff is left out of most systems.
- Measured on the owner's songs (systems laid out unjustified, page margins in, staff spaces): two voice + piano systems need 62–74 a page (median 66, 3rd quartile 69, the most 81 — Songbird's dynamics and hairpins); one 33–46. With the accordion too, two need 79–94 (one 42–53). A grand staff with words inside it, two 48–61.
- Words spread the bars: at 14 px an 11" iPad in portrait (58 staff spaces across) held 1–2 bars a system (Wichita Lineman 13 pages, 2.6 bars a page); at 11 (74 across) 2–4 bars; at 9.5, 2–5. So until a size is chosen, the score is at least 72 staff spaces wide (never under 9.5).
- Then two systems a page where that leaves ≥ 9.5 px a staff space: the size is guessed (34 staff spaces a system; extra staves such as the accordion's ignored, since condensing often leaves them out) and checked on the layout just made: `tk.getMEI({ scoreBased: false })` lists each page's systems (6–19 ms). It steps down while fewer than 3 pages in 4 (the last aside) hold two. Below 9.5 it falls back to one system a page, as large as fits. On a phone, where one system would leave a third of the page blank, it uses two smaller instead — checked on the layout too, and a step smaller once if fewer than 3 pages in 4 hold two (a 375-px stage took Piano Man's 9.375 px unchecked: 99 pages, 59 with one system and a third blank; now 8 px, 56 pages).
- The size fitted for a page size is remembered on the built view for the page's life (`v.fit`, keyed by page width × height × the size wanted, only while no size is chosen): a rotation back to a size seen before lays out once (Piano Man's landscape tried 11 and 9.5 before one system at 14 — 3 layouts and 2 MEI exports, ~0.4 s on every rotation; now ~0.15 s after the first).
- Results with no size chosen (staff space, share of pages holding two systems): 11" Air portrait 11 px on every owner song (100%, 5.7–9.9 bars a page); mini portrait 9.5 (100%); Air landscape Killing and Wichita 11, Songbird 9.5, The Longest Time 14 (91%); mini landscape 9.5 (Songbird 77%), The Longest Time 12.5. Piano Man in landscape: its 4-staff systems don't fit two a page at 9.5 (tried: 27–36% of pages) → one system at 14 (Air) / 12.5 (mini), ~4 bars a page.
- − and + in the score change only its pref; a size chosen in Both doesn't touch the score. Both's sizes are unchanged (checked on every owner song at the four iPad sizes, a phone and a desktop: same staff space, pages and systems as v77).

**Names, peek.**
- The Some floor names a bar's top note on the tune's and the right hand's staves, and its bass note on the left hand's and a hymn's or other bass part's (`plan.low`, from the part and staff of a note drawn on that staff). It used to be "the system's first staff", which is the voice in the full score.
- The LH view now names the left hand's bass note (it was its top note, the LH being the only staff).
- The strip lights the sung parts (`plan.sung`: the tune's, a second singer's) in `#0b8f78` (`HAND.voice`), clear of RH purple, LH blue and the orange of the pressed note. The piano's staves keep RH/LH; other staves go by `plan.low` (a singer's staff is never in it).

**Unchanged.** Every other view's MusicXML is byte-identical to v77 on every fixture and owner score (tools/playxmlsame.cjs), and so are the facts. Their plans differ only by the new `low`. Sing is untouched. The one intended difference: a file with a part missing from its part-list (none of the fixtures or owner scores) — a hymn's Both with its top part unlisted now has its staves in score order and its measure ids (v77 lost the place there).

**Timings** (desktop Chromium, 820×1180, ms; Full score vs Both; loadData includes the MEI pass for the songs with endings in the score's top part — Killing, Wichita, The Longest Time; fit(landscape): the extra layouts and MEI exports of the first landscape layout and the sizes tried — later rotations to a page size seen before lay out once):

| song | loadData | fit | re-layout (rotate) | fit(landscape) | page render | badges |
|---|---|---|---|---|---|---|
| Killing Me Softly | 221 vs 98 | 7 | 63 vs 61 | 5 (1) | 16 vs 4 | 9 vs 5 |
| The Longest Time | 211 vs 72 | 6 | 40 vs 34 | 4 (1) | 10 vs 8 | 7 vs 7 |
| Piano Man | 265 vs 136 | 13 | 151 vs 85 | 300 (2) | 13 vs 6 | 10 vs 3 |
| Songbird | 157 vs 100 | 7 | 143 vs 46 | 163 (2) | 13 vs 7 | 9 vs 5 |
| Wichita Lineman | 116 vs 60 | 3 | 27 vs 26 | 3 (1) | 43 vs 16 | 12 vs 8 |

**Seen while building, not changed:** Piano Man bars 39–48 show an empty left-hand staff in every view (the PDF has left-hand notes there): the converted MusicXML has none (2 misread notes under a treble-8va clef in bar 43), an OMR loss present in v77.

**Tests:** tools/playscore.cjs (A prep + Verovio: offered or not, parts, words, road map, condensing, floor picks; B play.html: menu, systems a page at the iPad sizes, size prefs, place, strip colours, PDF; C WebKitGTK; D timings; E/F the adversarial review's fixes, prep and page: barlines from the parts below, marks once and headings where printed, a transposing part's MEI pass, an unlisted part, singers' words on two staves and in two parts, a choir's bracket, split syllables, spreads after − / +, nothing past the stage, the 375-px fallback, the fitted size remembered, a second singer's colour, The Longest Time's hyphens), tools/playscorefixture.mjs (score-pvg, score-duet, score-guitar, score-tunein), tools/playscorefixture2.mjs (fixtures/playscore: pv-lowbars(-omr), pv-dupmarks, pv-heading-omr, pvc-transpose, pv-unlisted, hymn-unlisted, duet-2staves, duet-parts, satb-open, satbp, split-syll), tools/playxmlsame.cjs; playunit.cjs and play.cjs cover the view on every fixture.
