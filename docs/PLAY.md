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
- Device pref `resonate.play.size`. Defaults (v77–78; v79 replaced them with the printed page's density — see "As built (v79)"):
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
- **Tap:** an off-note tap (moved < 10 px, < 500 ms) in the **outer 25%** of the stage turns: left goes back, right goes forward. A tap in the middle does nothing in v1. *(Removed in v79: see "As built (v79)".)*
- **Swipe:** |dx| > 50 px and |dx| > 1.5·|dy| turns. Avoid relying on the left screen edge (Safari's back swipe). *(Removed in v79.)*
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
- **Starting it:** `pointerdown` within `max(16px, 1.2 × head height)` of a head centre (the nearest wins) picks that head's **chord**: its `g.chord`, or the note alone — and (v79, the owner: "when I click a note for the piano section, everything on that staff gets played") every other head on the same drawn staff of that measure whose written onset is the same (`fact.mi`, `fact.onset`; any voice). A converted score splits a chord's notes into voices loosely (Killing Me Softly: 107 onsets where one staff starts notes in two voices), and a press sounded only the pressed note's voice — "sometimes it plays both, sometimes only one". A tied-over head drawn at that onset sounds with it (Killing bar 44: G3 B3 and the held E4); a note started earlier and still held (drawn elsewhere) doesn't, nor grace notes (a grace press keeps its own chord), nor the other staff; on a staff that holds the tune with other voices (a hymn, The Longest Time's right hand) the tune's note sounds with them. tools/playpeekstaff.cjs.
- **What it shows:**
  - its badges get `.peek` (shown even at Off) and its heads turn `#d86b00`;
  - `#bubble` shows the full names **with octave**, low to high: "E♭4 G4 B♭4", same as the Sing page. Octave = the MusicXML sounding octave.
  - `#strip` slides up.
- **Sound:** the notes play through `holdPiano(ac, piano, now, midi, 1)` until the finger lifts (at least 0.25 s; auto-release after 60 s).
- **Cancelling:** if the pointer moves > 12 px within 200 ms, the peek is cancelled (`release(now, 0.01)`) and the gesture becomes a swipe (v79: a drag, which turns nothing). A peek gesture never turns the page.
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
| `resonate.play.zoom` (v79; `resonate.play.size` before, removed on load) | staff-space px chosen with − / + (none: the printed-density default); `.zoom.score` for the Full score | device pref, not in DATA_KEYS |
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
- ~~**Listen** to the piano part (or one hand, slower) with a moving highlight and automatic page turns~~ — built in v79 as ▶ (see "As built (v79): ▶").
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

## As built (v79): the printed page's density; turns from ‹ › only

The owner sent a photo of a printed piano/vocal page (Killing Me Softly, page 1: bars 1–3, 4–6, 7–9, three systems) — "Can we adjust the default iPad zoom to match this?" — and asked that a press on the music stop turning pages: notes sound there, and a drag picks a stretch of notes to play (below).

**The default size (`measure`, `fit`; play.js).** Until a size is chosen on this device for the view's kind:
- **A tablet** (coarse pointer, the screen's short side ≥ 700) whose stage is ≥ 700 px wide (`TABLET_W`): `PAPER` = 90 staff spaces across the stage's width (page margins in) — 9.11 px on an 11" iPad Air in portrait, 8.27 on a mini, 11.38 on a 13". It's the same density at every width, so a system holds about the printed page's bars on any iPad.
- **Calibrated on the prints, song by song.** Audiveris keeps the printed system breaks (`<print new-system|new-page>`), so each owner song's printed bars a system are known: Killing Me Softly 3.14 (mean; median 3), The Longest Time 3.71 (4), Piano Man 5.26 (6, 3/4 time), Songbird 4.41 (4), Wichita Lineman 3.09 (3). Verovio's own breaks over each whole song's Full score on an Air in portrait, for staff spaces across (tools/playbackfixes.cjs C, and a sweep with `PAPER` overridden):

  | across | Killing | Longest | Piano Man | Songbird | Wichita | overall (geometric mean of the ratios) |
  |---|---|---|---|---|---|---|
  | 84 | 2.88 | 3.87 | 4.61 | 4.05 | 2.13 | ×0.88 |
  | 87 | 3.00 | 3.87 | 4.80 | 4.17 | 2.27 | ×0.91 |
  | **90** | **3.14** | **4.05** | **4.90** | **4.41** | **2.43** | **×0.96** |
  | 93 | 3.45 | 4.45 | 5.22 | 4.69 | 2.62 | ×1.03 |
  | 96 | 3.45 | 4.68 | 5.34 | 4.84 | 2.83 | ×1.07 |
  | 100 (the first build) | 3.63 | 4.68 | 5.47 | 5.00 | 3.09 | ×1.11 |

  At 90 Killing's bars a system equal the print's, Songbird's too, the median is the print's on four of five songs (Piano Man 5 vs 6), and 9.11 px on the Air is ~1.74 mm a staff space — the printed size (a Musicnotes staff is ~7 mm). The breaks jump at single scale percents (the mini's and 13"'s 90 across land on the Air's 91.5: Killing 3.29 there), so the choice is made on whole songs, not one page. Page 1 of Killing's Full score at 90 is bars 1–2, 3–5, 6–8 — three systems, like the photo; Verovio's first system (clef, key, time, tempo) is a bar shorter than the engraver's, so no density gives exactly 1–3, 4–6, 7–9 (8.6 px gave four systems, 1–2, 3–5, 6–8, 9–13 — the first build's notes said otherwise). Systems a page come out at 3 where the print has 4 (Verovio spaces the staves and words more loosely than the engraving), ~9.4 bars a page against the print's ~12. The first build's 100 across (8.2 px), chosen on Killing's first page alone, put ×1.11 the print's bars in a system and a third of Killing's systems at 4–5 bars; the engraver's own ~144 across (6.4 px, the photo measured) put 4–6.
- **Landscape:** the same density across the full width (13.11 px on an Air, 12.59 mini, 15.18 13" — one page across, no spread), then two systems a page where the stage allows: the estimate (`twoNeed`: two systems' height, ~3rd quartile — voice + piano 70 staff spaces, +15 a staff beyond three, a grand staff 50, one staff 36) and a check on the layout (Verovio's page-based MEI: ≥ 3 pages in 4, the last aside, hold two), stepping down ×0.93, not under `FIT_FLOOR` = 0.9 of the device's portrait density on a tablet (8.2 Air, 7.44 mini, 10.24 13"; 0.75 of the default on a desktop); if two still don't hold, one system a page at the density. Why 0.9: two systems of voice + piano + one more staff need ~85 staff spaces of the short side less the bar — about 0.9 of the portrait density. The first build's floor, 0.75 of the landscape size, stopped at 8.5 on a mini: Piano Man's 4-staff Full score went to one system a page, 36 pages of ~6.5 bars, a turn every ~7 s at ♩=174; now it's two a page at 7.51 on a mini (12 of 14 pages), 8.34 on an Air (14 of 14). No check where two fit with room to spare (≥ 1.3 × `twoNeed`: every portrait iPad). The size found is kept on the built view per page size (`v.fit`): a rotation back lays out once.
- **A desktop:** the same density clamped to 9.5–12.5 (`DESK`): most windows are ≥ 1125 px wide and get 12.5 as before; narrower ones get the printed page's bars instead of fewer. The landscape fit applies (desktop windows are landscape).
- **A phone, and a tablet window narrower than 700 px** (Split View, Slide Over — `device()` reads the screen, which is the whole iPad there): v78's rules, unchanged (`phoneSize`, `phoneFit`): 9.5 or what fits; the full score's two-systems-at-≥-9.5 / one-as-large-as-fits / the 375-px fallback. The first build gave those iPad windows the paper rule: 5.07 px at 507 wide, 5 at 320 (chord letters 4.4 px, 1–2 bars a system on the Full score) — smaller than v78 (8–12.7) and half a phone's size at the same width.
- **Whole systems:** Verovio never splits a system; `S.cap` (= min(page width / 40, H / the tallest system: 12 staff spaces a staff, a full score's `tallest`)) keeps one on the page at any size.

**− / +.** Steps from the default (`STEP` ×1.15 — about the old size list's spacing —, up to `STEPS` = 8 either way, never under `MIN_SP` = 5 px nor over `S.cap`; a step that wouldn't visibly change the size, at the cap or the floor, is skipped). The default is step 0: + then − is the default again, exactly, and its pref is removed. 9.11 → 7.92 / 10.48 on an Air in portrait; a step from a landscape default that was fitted (Piano Man's 8.34) is a step from that. The step is the same in either orientation and on any iPad — one step bigger than the default in portrait is one step bigger in landscape. The first build kept one absolute size (`SIZES` = 5…23) for both orientations: + then − on an Air landed on 8, not 8.2, and stuck; − in landscape (11.8 → 11) made portrait 11, bigger than its 8.2 default (Piano Man 7 → 13 pages); nothing ever came back to the default. The step is this device's pref for the view's kind: `resonate.play.zoom` (the piano views) and `resonate.play.zoom.score` (the Full score), "+1" … "+8" / "-1" … "-8" (anything else is ignored: the first build's absolute sizes never reached a device); v77–78's `resonate.play.size` / `.size.score` are removed on every load: a tablet that had v78's 16 (or a size picked from it) would otherwise never see the new default.

**Spreads.** Two pages side by side only with a step where each half holds ≥ 110 staff spaces (`SPREAD`, more than a printed-density system) — zoomed well out in landscape (7 steps down: 5 px on an Air and a mini, 5.71 on a 13"); never at the default. v78's 48 (piano views) and 72 (Full score) gave halves of one or two bars a system. A view that fits on one page is laid out at the full width, as before. The PDF view's own spread rule (≥ 75% of print size, or ≥ 97% of a single page) doesn't depend on it and is unchanged.

**Names at small sizes (playnames `growPills`).** A pill is 1.3 × its head; at the printed density a head is ~9.6 px on an Air, ~8.7 on a mini — letters ≥ 8 px with no growth. `MIN_LETTER` = 8: a pill whose letter would be under 8 px on screen (zoomed out to 6 or 5 px) grows to hold an 8-px letter, as far as it touches no other pill — grown pills that would overlap another give back 15% a round (four rounds) and stop at 1.3; a chord's seconds and thirds keep v77's 1.05. Px per SVG unit from the page's screen matrix, read before any write. Key marks (`placeMarks`) and the Some floor use the grown pills; both still come out at 5 px (tools/playpaper.cjs N).

**Peek at small sizes.** `nearHead` takes the nearest head within 22 px of a finger's point (16 px for a mouse or pen — v78 used 16 for all) or 1.2 × the head's height when that's larger: a fingertip is ~40 px, a head at 6 px ~6. Checked: a press 16–17 px off a lone head at the defaults and at 6 and 5 px peeks it.

**Turns.** The ‹ › buttons and the keys (arrows, PageUp/PageDown, Space/Enter — Shift+Space back —, Backspace; Bluetooth page turners), with v77's select-focus handling. The tap on the outer quarters and the swipe are gone, on the sheet and on the PDF (a tap there does nothing). A press on the music peeks (on a note) or, moved > 12 px at any time in the press, drags a stretch — see "As built (v79): ▶" for the gestures.
- **The buttons:** 56 × 44 px on an iPad (coarse pointer, ≥ 740 px wide: the 11" Air and mini in portrait keep two bar rows); 44 × 44 elsewhere, and while the fewer-names chip shows (the bar stays one row from 1100 px: an iPad 10.5" in landscape went to two rows at 56). On a phone (< 480 px) they're no longer hidden: `.ctl` is `display: contents` there and the pager shares the song menu's row (the song's basis leaves just its room), so the bar keeps three rows and v78's exact height (146.55 px at 390 wide). With the fewer-names chip: at 421–479 px it joins the song's row without its question (its button labelled "Fewer names: Some"); from 480 to 1099 px the song menu's base is 0 (min 4rem) and the controls' gap 0.3rem — the bar is no taller than v78's at any width from 300 to 1440 px, with or without the chip (measured every 2–4 px against HEAD; it's shorter at 300–311 px and at 480 px without the chip, 612–624 px with it).

**Survey** (tools/playpaper.cjs S, no size chosen; staff space px, `*` one system a page):

| device | Both / RH / LH / Melody | Full score: amazing-grace · killing · longest · pianoman · songbird · wichita |
|---|---|---|
| 11" Air 820×1180 | 9.11 | 9.11 · 9.11 · 9.11 · 9.11 · 9.11 · 9.11 |
| 11" Air 1180×820 | 13.11 | 12.29 · 10.89 · 12.29 · 8.34 · 10.12 · 10.89 |
| mini 744×1133 | 8.27 | 8.27 · 8.27 · 8.27 · 8.27 · 8.27 · 8.27 |
| mini 1133×744 | 12.59 | 11.06 · 9.8 · 11.06 · 7.51 · 9.11 · 9.8 |
| 13" 1024×1366 | 11.38 | 11.38 · 11.38 · 11.38 · 11.38 · 11.38 · 11.38 |
| 13" 1366×1024 | 15.18 | 15.18 · 13.8 · 15.18 · 10.57 · 12.83 · 13.8 |
| phone 390×844 | 9.5 | 9.5 · 9.5 · 9.5 · 8* · 9.5 · 9.5 |
| phone 844×390 | 9.5 | 9.5* · 7* · 9.5* · 5.49* · 7* · 7* |
| desktop 1440×900 | 12.5 | 12.5 · 12.09 · 12.5 · 9.38 · 11.24 · 12.09 |
| desktop 1100×760 | 12.22 | 11.39 · 10.09 · 11.39 · 12.22* · 9.38 · 10.09 |

Systems a page and bars a system at the default (median over a song's pages): an 11" Air in portrait — Full score 3–4 systems, 3–5 bars (Killing 3 · 3, Wichita 3 · 3, Piano Man 3 · 5 in 3/4); Both 4–6 systems, 3–6 bars; one-staff views 7–11 systems. Landscape: two systems a page in the Full score and Both on every iPad (one hand 3–5), Piano Man's Full score two at 8.34 on an Air and 7.51 on a mini (the first build: one a page there, 36 pages). The mini and the 13" in portrait as the Air, a little larger or smaller. The phones are v78's (`*`: v78's one-system-a-page score), and so are iPad windows under 700 px wide. Nothing past the stage and no spread at the default anywhere (tools/playpaper.cjs S; the full device × song × view table is its `survey.json`). Spreads by zooming out, in landscape: at 5 px on an Air and a mini (7 steps down), 5.71 on a 13" (7 steps).

**Timings** (desktop Chromium). The landscape fit costs one MEI export with the layout it checks (27–41 ms for a voice + piano score) when the estimate holds; Songbird's and Piano Man's Full scores try two sizes (0.2–0.35 s), once per page size: a rotation back is laid out once (`v.fit`). A step from a default still to be fitted lays out once more after the fit; portrait never checks.

**Tests:** tools/playpaper.cjs (S the survey on 10 device sizes × the owner's songs and fixtures × every view, K Killing's first page on the Air, Z − / + steps from the default and back, the old prefs removed, spreads only ≥ 110 a page, a phone, desktops, T turns — taps, swipes and a drag from a note never turn; ‹ › ≥ 44 px on every width, the keys; the PDF view the same, N small sizes — letters, overlapping pills, a press 16–17 px off a head, Some and key marks at the defaults and at 6 and 5 px), tools/playbackfixes.cjs (C the density against print, F the landscape floor, V Split View, Z steps across a rotation, H the bar vs v78's). Updated for v79: play.cjs, playcore.cjs, playextras.cjs, playfixes.cjs (P3), playscore.cjs (B2, B3, C, F1), playwebkit.mjs; their paging checks seed `resonate.play.zoom` = "+4" (~16 px) where they need pages to turn.

## As built (v79): ▶ — a stretch dragged on the page, played once or looped

The owner (same message as the density): "I want to be able to press play somewhere here and actually hear it back as well, and ideally a section … when I click on any part of the staff, it would be like kind of a click and drag, and I could drag over a series of notes, and then there'd be a play button somewhere that I could either play or loop that section so I could practice it."

**Gestures** (play.js `pointerdown/move/up`, not in the PDF view):
- Press a note and hold still: the peek, as before.
- Press anywhere on the music (a note or blank staff) and move > 12 px — at any time in the press (v78's "within 200 ms" is gone): a stretch. A peek the press started is cut at once (`CUT`, τ 10 ms) and its colours dropped. The stretch follows the finger (one update a frame) and stays after the lift.
- A tap with no drag on paper (no head within reach) lets go of the stretch, unless something is playing; a tap on a note peeks and keeps it. Nothing happens on the PDF view (📄): a tap there does nothing (the first build let it drop the stretch, which was gone when the sheet came back). Non-primary pointers are ignored; `#stage` keeps `touch-action: none` (no scroll or zoom during a drag).

**The stretch** (`S.sel` = { q0, q1, end } in written quarters):
- Columns: the onsets of the view's notes and rests — `playtime.onsets` over the timeline, filtered by the view (`playprep.keeps`). On a drawn page, `pageGeo` reads each column's x from its heads (accidentals and the grace notes before them in) and rests, system by system, with the system's staff extent (top line of its first staff to the bottom line of its last; ~2–3 ms a page, ~90 columns; cached per drawing). A whole-bar rest is drawn in the middle of its bar but starts it: it makes a column only where nothing else in its system starts with the bar (a bar every staff rests), kept between its neighbours. (The first build merged it into the bar's first column: in Killing's intro, the left hand resting under the tune's eighths, bar 1's first column ran from x 105 to 248, over the 2nd and 3rd eighths — the 2nd couldn't be picked at all, a press on it started the stretch an eighth early, and a band from it started at the 3rd.)
- A point picks the page under it (the nearer of a spread's two), the system nearest it, and the column whose share of the line holds it (`colAt`): halfway to its neighbours within a bar, at the barline between two bars (`edge`: the bar's staff lines' end) — a finger lifted a few px short of a barline (Verovio leaves room after a bar's last note, so halfway fell before the barline) ends the stretch in that bar instead of taking the next bar's first beat. The press's column and the finger's: q0 = the earlier, q1 = the later (a backward drag works, so does one across systems and across a spread's pages); `end` = the view's next onset after q1, or the end of the score — so the rhythm, a rest at the end too, is kept.
- Drawn like a text selection: a band a system (`.sel`, `#d4e2ff` with `mix-blend-mode: multiply`, so the ink stays black and the names readable), from where its first column's share of the line starts (the system's start when the stretch began on an earlier system) to where its last one's ends (the system's end when it goes on) — the barline between bars —, over all the system's staves ± 1.2 staff spaces.
- Redrawn from the written times after every drawing: −/+, a rotation, a turn and back, the names level (CSS only), another view (that view's onsets in [q0, end) — Right hand shows its own columns of the same stretch). Another song lets go; it isn't saved.
- **v1 limit:** a new drag picks only on the page(s) shown (turn first to reach further; the stretch then spans pages and is drawn where it is).

**Controls**
- **▶ in the bar** (■ while playing, orange): with a stretch it plays the stretch once; without one, from the shown page's first bar (the left page of a spread) to the end.
- **`#selbar`** over the music while a stretch exists (and ■ + speed while the page plays): ▶/■ (once), ⟳ (loop; pressed while looping), speed (a `<select>`: 100%, 90% … 50% — a short % label; the menu is native, one tap), ✕ (let go; stops a stretch playing). Targets 44 × 44 px; a dark pill like the strip. Placed (`placeSelbar`) where it covers none of the stretch's bands, the peeked chord, its names and the peek's strip (placed again when a peek shows and hides — the first build left the controls over the middle of the peek's keyboard, often the very key peeked), nor, while playing, the ink of the line playing, the line after it and a stretch's lines (each bar's staves with their notes and words, and its marks: the paper above a line's last bar, or between two lines, is free): the stage's foot (above the strip when it's there), else its head, else a corner, else the middle of the free paper between two lines in the right, middle or left column; where nothing is clear, the place covering least. The buttons blur after a tap and the menu gives the pedal's keys back, as the bar's.
- Speed is per song (`resonate.play[id].speed`, written through the `spaceChanged()`-guarded save). A change while playing re-times from the moment it's picked: what hasn't started is taken back (silenced at its start) and scheduled again at the new speed; what sounds rings on.

**What plays**
- Every note of the shown view: the Full score's voice and piano (the voice on the piano too), Both hands, one hand, Melody.
- A stretch: the notes whose written onset is in [q0, end), in written order (a repeat sign inside a stretch isn't taken), durations cut at `end`. ⟳: round after round, each round starting exactly one stretch-length after the last began (the rounds are one clock: audio time = t0 + (round × length + offset − s0) / speed).
- From the page: Sing's performance order — `parseMusicXml(xml).measureOf` on the song's XML as catalog.js gives it (Sing's own parse, imported, run once a song while the page is idle: 11–122 ms on the owner's songs, Piano Man the longest) — from the first played bar whose written bar is the page's first bar (else the next written bar it plays). A song Sing reads in written order (no repeats, or a hymn whose stacked verses keep the written order) plays the written order; one Sing can't parse plays the written order too.
- **Verovio's own expansion vs Sing's order** (`expandNever: false` timemap, measureOn order, vs `measureOf`), every owner score: Amazing Grace 18 = 18, Piano Man 235 = 235 and Songbird 150 = 150 (no repeats followed by either); Killing Me Softly 107 = 107 (identical); **The Longest Time** 137 vs 141 — from played bar 110 Verovio plays bars 61–64 (the 1st ending) again on the second pass, Sing goes 60 → 65; **Wichita Lineman** 52 vs 54 — after the D.S. Verovio plays the 1st ending (bars 20–21) again, Sing goes 19 → 22 ("first endings are skipped" after a D.S./D.C.). The rule is Play and Sing agree, so Play uses Sing's.

**Timing: from the MusicXML, not Verovio's timemap** (`playtime.js`). `timeline(doc, facts)` walks every part once (2–36 ms on the owner's songs): each note's and rest's written place (quarters from the start, and from its bar), length, ties (`<tie>`/`<tied>`), grace, cue; each bar's start and length; the tempo marks. `track(T, { bars, span, keep, base })` lays the bars to play end to end (≤ 2 ms). Checked against Verovio's own written-order timemap (`renderToTimemap` with `expandNever`) of every view of every owner score and fixture (tools/playback.cjs P uses it as the reference):
- The same note on/off times and bar starts on the Full score of Amazing Grace, The Longest Time and every fixture; on Killing Me Softly's, Wichita Lineman's and Piano Man's all but one bar each, Songbird's all but three (the overfilled bars below).
- Where they differ, Verovio is worse for this:
  - It times each view by that view's own content: a bar the right hand alone underfills (OMR) is shorter in the Right hand view — Killing Me Softly RH: 62 of 69 bars start earlier than in the full score, 472 of 537 notes at other times, so switching views would move the music in time and a stretch picked in one view wouldn't mean the same in another. The timeline's bars are the whole score's, for every view.
  - It lengthens a bar a voice OMR overfilled (Killing bar 61 +¼, Wichita bar 32 +½, Piano Man bar 190 +1, Songbird bars 42 +1, 75/89 +½): the beat would stumble there. The timeline's bar is as long as its longest part but never longer than its time signature — the overfilled note is cut at the barline (Killing bar 62's 2 quarters → 1.75, Piano Man bar 43, Songbird bars 76 and 90; a note starting past the barline would be left out: none in the owner's songs). A score with no time signature keeps its bars' own lengths.
  - Whole-bar rests (`measure="yes"`) don't set a bar's length (OMR writes them loosely — Piano Man's 4-quarter rests in 3/4 bars, Songbird's 3½ and 4 on its stray top part; Verovio draws them as mRests and ignores their length too).
  - Its timemap lists each tied head on its own; joining ties needs the MusicXML's tie marks anyway. It defaults to ♩=120 where the score has no tempo (Piano Man); Sing uses 90.
  - Its timemap costs 2–35 ms a view (written order) and needs the view loaded; the timeline is built once a song for every view.
- Tuplets: in the durations (Amazing Grace's, Songbird's, Wichita's and Piano Man's triplets agree with Verovio's). None of the owner scores has a grace note or a tempo change; the timing fixture in tools/playback.cjs has both.

**Tempo and the rest:**
- 100% = the song's tempo as Sing plays it at 100%: the song's own (typed or tapped on the Sing page, `resonate.sing.timing[id].bpm`, read regardless of the tap map's note-count signature) — Piano Man at ♩=174 —, else the score's (Sing's `score.tempo`: the first `<sound tempo>`, else the first `<metronome>`), else 90. The score's later tempo marks (`<sound tempo>`, or a `<metronome>` without one) are ratios of its first: ♩=120 → 60 at bar 3 plays bar 3 at half speed. Sing's tempo % and tapped maps aren't used.
- Ties: a tied note sounds once for its tied length (part + pitch, the continuation starting where the sounding note ends); the continuation's head is lit in its turn. A jump in the bars (a repeat, an ending, D.S., To Coda) joins nothing over it: a note tied into a jump's target is struck again.
- Grace notes: 70 ms apart just before their note (`GRACE`), the last one nearest it, a grace chord's notes (`<grace/><chord/>`) together; their note keeps its time. Those before the first notes of a schedule come before 0: `track` returns `pre` (the earliest), ▶ starts that much earlier, and a loop's next round has them at the end of the round before (each round still one stretch-length after the last). The first build clamped them to 0 — a stretch or a page starting on a note with a grace struck the two together, every round — and ranked a grace chord's notes as a run (an arpeggio, 70 ms apart). Cue notes (`<cue/>`) are drawn, not played.
- Loudness: a key struck twice at once — notes of one MIDI within 10 ms: the Full score's voice and the piano doubling the tune (Killing Me Softly: 404 of 1308 struck notes), two voices on a unison — is struck once, for the longer of the two; both heads are lit. Then playPiano at `min(1.2, 4/(n + 1))` a note, n = keys struck within 10 ms (1 → 1.2, 3 → 1.0, 6 → 0.57), into a bus (piano.js `pianoBus`: gain 0.8, then a soft limiter — a WaveShaper, straight through up to 0.8, above it bent by tanh towards full scale and never past it, for inputs to ±2). A DynamicsCompressor (−1 dBFS, ratio 20, attack 2 ms) was tried first: it isn't a hard limit — a burst 1.15 × full scale came out at 1.02 in Chromium and 1.06 in WebKitGTK — and its automatic make-up gain (+0.56 dB) lifted everything else. The first build sent every note to the output at those levels and claimed "the samples peak at ≤ 0.35, so even six together stay under clipping": they peak at up to 0.39 (D♯4), two copies of one sample at one instant add in phase (+6 dB), and the tails of the notes before still ring — Killing's Full score peaked at 1.28 with 116 clips, Wichita's Both 1.12. Rendered offline (the page's own schedule from page 1, playPiano, the bus): every view of every owner song peaks ≤ 0.90 after the bus's gain (Wichita's Full score and Both, Piano Man's Full score the loudest) and ≤ 0.89 out of the limiter, which bends only the few moments over 0.8 and leaves everything under it untouched; 0 samples over full scale (tools/playbackfixes.cjs U renders Killing's Full score and Wichita's Both; tools/playbackwk.mjs checks the limiter in WebKitGTK: a burst 1.66 × full scale → 0.998).

**Sound and clock**
- The peek's context: `getCtx("tap")` in the ▶ tap (`playback` session before a context is made; a closed, interrupted or stuck one replaced in the tap; the first tap anywhere unlocks as before). The schedule starts once the context runs and the piano is in (`LEAD` 0.12 s after); a context that doesn't start within 3 s is given up (the next tap starts over).
- `playPiano` ≤ 4 s ahead, topped up every 0.4 s (piano.js `scheduleAhead`'s reasons: WebKit's cost per render quantum grows with the sources waiting to start); a start missed by > 50 ms (the page held up) is skipped. `keepAlive` while playing. Each note's source and gain are kept, so a stop can reach it.
- **Stops:** ■ (bar or controls), ⟳ again, ✕ (a stretch playing), another ▶, another song, another view, 📄 (▶ disabled and the controls hidden while the PDF shows), the page hidden, `pagehide` (which then closes the context and sets the session to `auto`). What hasn't started is silenced at its start (gain 0, `stop(when)` — as `holdPiano`'s release before the start); what sounds is damped (τ 40 ms); a stretch played once ends by itself and its last notes ring out. A peek works while playing (the strip is the peek's until it hides); −/+, a rotation and a names change keep playing.

**Lit, the strip, auto turn** (every animation frame, from `ac.currentTime − outputLatency`; ids looked up again after every drawing):
- The heads and names of what sounds now: the peek's orange (`.play`: head fill `#d86b00`, a filled pill `#c45f00`, a hollow pill outlined and tinted `#ffe3c7` so a half note's name still reads). One "now" colour rather than hand colours on the page: the right hand's purple is the names' own `#5e2fb8` family and wouldn't stand out. A short note stays lit ≥ 90 ms.
- The strip shows the sounding keys by hand (RH `#a64fff`, LH `#4f7cff`, voice `#0b8f78`), from the first note to the stop, at the stage's foot or head where it covers (the systems' boxes) neither the line playing, the line after it on the page(s) shown nor, playing a stretch, its lines — a loop comes back to them; it keeps its side while that side stays clear, else takes the other. Where neither side is clear — two systems a page in landscape (the next line fills the foot, the line playing the head), one system on a phone — there's no strip on that page at all (`stripOff` for that drawing), not one that slides in and out with the lines. The side is worked out again on every drawing (a turn, a new layout: the line playing found from its notes, else its bar — a held chord across a turn used to keep the strip over the new page's first line until a new key sounded). The first build put the strip on the half the line playing wasn't on and ignored the next line: in landscape it hid the next line's left hand for the whole of the line before, and a loop over a system break moved it twice a round. (The peek keeps its own rule: the foot unless the chord sits there.)
- Auto turn: each bar is a mark in the schedule; when the music moves into a bar whose page (`getPageWithElement`, cached per layout) differs from the last page the music was on, and that page isn't shown, the page turns there — forward, or back on a repeat — and the place (`S.at`) follows. Not under a finger: while a press is on the music (a peek held, a stretch being dragged) the turn waits (`PB.defer`) and is taken at the lift — unless the press picked a stretch: it's on the page shown, which stays as after a turn by hand. (The first build turned under the finger: a drag in progress jumped onto the new page and the stretch grew by a page with no finger movement; a held peek was cut.) A turn by hand while playing isn't fought: the next page change of the music is followed. After a re-layout the music's page is found again at the next bar. A stretch ending at a barline has no mark for the next bar (`track`; the bars from `barAt(end − 0.001)`): a stretch to a page's last bar, played once, turned to the next page at its end and saved that place.

**Bar.** ▶ sits after the view menu. The song menu's base under 1100 px is 7.5rem (the chip already did this), so ▶ fits the controls' row: the bar's height at 390–1440 px wide, with and without the "Fewer names?" chip, is exactly the same as without ▶ (measured at 13 widths). Two edges the suites caught: with the chip and 📄 the one-row bar was full at 1112–1140 px (the links' side padding 0.45rem, the page number's minimum 3.6rem and the controls' gaps 0.3rem while the chip shows from 1100 px give it back), and at 320 px − / + took a row of their own (under 360 px the view menu gives way, its name clipped: "Both …").

**Timings** (desktop Chromium, the Full score on an 11" Air portrait): timeline 2–36 ms (Piano Man the longest), Sing's parse 11–122 ms (both once a song, while idle after it opens), a schedule ≤ 2 ms (Killing 1567 notes over 107 bars, Piano Man 2690 over 235), a page's columns 2–3 ms. A frame's work: a scan of ≤ ~200 scheduled entries.

**Not done / limits:** a new drag only on the page(s) shown; a stretch plays written order (a repeat inside it isn't taken; play from the page for the road map); the stretch isn't saved; no count-in or click; while playing, the strip covers a band of the page (lines already played, or after the next) and the controls the page's free paper or, where there's none, the least of it; the voice in the Full score is played on the piano.

**Tests:** tools/playback.cjs (G gestures — press-hold peeks, press + drag cuts the peek and picks, blank staff, backwards, across systems, a tap on paper, kept and redrawn after −/+ / names / rotation / a turn / another view, let go on another song, the controls ≥ 44 px and clear of the bands; P the schedule — a stretch = Verovio's written-order timemap of the view (ids, MIDI, times within 2 ms, ties joined, cut at its end) on Amazing Grace's Both and Killing's Full score, played once then idle, 50% doubles every gap, ⟳ rounds exactly one stretch apart (≥ 3), a speed change while looping, the tempo-change / grace / tie / triplet fixture; O Sing's order from page 1 and page 3 on Killing (107 played) and Wichita, Piano Man at 90 and at its own ♩=174; L the lit heads and strip keys = what's scheduled at sampled times, auto turn forward and back on Killing's repeat, a turn by hand not fought; S stops — ■, the controls' ■, ⟳, another view, song, the page hidden, 📄 — with no source starting later and none made later, a peek while playing, − while playing; I an iOS-like gate: ▶ tapped first plays), tools/playbackwk.mjs (WebKitGTK: ▶ on a running context with heads and keys lit, ■, a mouse drag → a stretch, its ▶ once, ⟳ rounds, ✕), tools/playbackfixes.cjs (the review round below). regress.sh runs all three.

**Review round (v79, before release).** An adversarial review (gestures, audio, layout, the owner's use, regressions against v78) confirmed 21 findings; all are fixed as described above, each with a check in tools/playbackfixes.cjs:
- Gestures: a whole-bar rest stretched its column (M); an auto turn under a finger (T); the controls over the peek's strip (K); a tap on the PDF dropped the stretch — three reviewers (D); the strip left over the line playing after a turn (R3); a stretch starting on a note with a grace (A); a finger lifted just short of a barline took the next bar's first beat (B).
- Audio: the Full score's unisons and thick moments clipped — two reviewers (U); grace notes at a stretch's start and grace chords (A).
- Layout: − / + one absolute size for both orientations, never back to the default (Z); the 8.2-px calibration didn't reproduce the print and its evidence was wrong (C — now measured on all five songs' printed system breaks); the landscape floor left Piano Man one system a page on a mini (F); Split View / Slide Over got 5 px — three reviewers (V); the strip and the controls over the next line in landscape and in loops — two reviewers (R).
- Owner: a stretch to a page's last bar turned the page at its end (E).
- Regressions: the bar a row taller with the fewer-names chip at 422–442 and 626–674 px (H: now no taller than v78's anywhere from 300 to 1440 px — at 421–479 px the chip joins the song's row without its question, its button labelled "Fewer names: Some"; from 480 px the song menu gives way further); docs out of step with the code (the Turns paragraph, "rings over the barline" — O).

## As built (v80): a press sounds at once

The owner, after v79: "there's quite a long delay between pressing a note in a score and hearing it play … I want it to be very responsive, almost so I could play it on the screen."

**What v79 did between the touch and the sound.** `pointerdown` → `nearHead` → `peekStart` → `drawPeek` first: `.peek` on the chord's heads and badges, `getBoundingClientRect` of the stage and of every head, `drawStrip` (the strip's SVG measured, its `innerHTML` written), the bubble's `offsetWidth/offsetHeight`, `placeSelbar` (more rects) — forced style and layout on a page-sized SVG — and only then `sound()`, which awaited `loadPiano` (a microtask even when loaded) and started `holdPiano` 10 ms after `currentTime`. Between presses the output went digitally silent (`keepAlive` ran only under ▶), so WebKit flipped the page in and out of "playing audio" at every press; `getCtx` set `navigator.audioSession.type = "playback"` on every press; and only the primary pointer was handled — a second finger landing while the first was down was ignored (no trill, no quick next note before the last finger was up).

**Sound before sight.** `peekStart` finds the chord (the same rule as v79: everything struck on that staff then) and, when the context runs and the piano is decoded for it — `pianoNow(ac)` (piano.js, synchronous) — strikes inside the pointerdown itself (`strike`): `holdPiano` at `ac.currentTime` (start as soon as the audio can), before anything on screen changes. The colours, the names and the strip follow on the next frame (`drawSoon` → `drawPeeks`): no class written, no rect or offset read between the press and the source's start (checked in Chromium and WebKitGTK with every write and read instrumented). The strike goes into ▶'s bus (`pianoBus`, one soft limiter for every finger and ▶) at the level it had going straight out divided by the bus's gain — as loud as v79's alone, and two hands' chords together are rounded off instead of clipping. A press that can't sound at once (iOS before the first touch end, a replaced context) takes the old path — `sound()` — now waiting on the context's `statechange` instead of a 30 ms poll; it plays at the lift for 0.8 s, and is dropped 1.5 s after the lift (`LATE`).

**Every finger its own strike.** Gestures are kept per pointer (`gests`), strikes in a list (`peeks`): two fingers = two strikes, both held until their own lifts; a new press doesn't cut one still held; the same key struck again while its note still sounds (held, or a quick tap's 0.25 s) damps the old note as the new one starts (`voices`, τ 15 ms `RESTRIKE`) — no doubled sample, no phasing; strikes already let go give way on screen to a new press (their sound rings on). Only the first finger (the primary pointer) can become a drag: past 12 px its own strike is cut (τ 10 ms) and a stretch is picked; another finger moving keeps its note and picks nothing, and another finger on paper does nothing. On screen: every strike's heads lit, the strip lights the keys of all of them (`peekKeys()` — the hook a docked keyboard can light from), the bubble names the newest only (few words; the strip carries the rest). ▶'s page turn waits for the last finger's lift.

**The context early, the piano decoded once.** The context is made, and the piano decoded on it, as soon as the first song is shown (`warmAudio`, in idle time; the session left alone — making a context starts nothing, and `decodeAudioData` works on a suspended one), so the first press after the first tap has it ready. `loadPiano` now decodes once per sample rate and shares the buffers with any later context at that rate (an `AudioBuffer` isn't tied to its context: decoded on a context since closed, it plays in another — checked in WebKitGTK). That matters because a context made outside a gesture can come back "interrupted" (WebKitGTK reports exactly that), and `freshCtx` replaces such a context in the first touch: the replacement has the piano at once instead of decoding 22 files again. The session is set to `playback` in a press only when it says something else (once a page, normally).

**Keep-awake.** One inaudible source (`keepAwake`: piano.js `keepAlive`, 1e-7) on the context in use, from the first strike or ▶ until `AWAKE` = 2 minutes after the last press, lift or ▶ with nothing held or playing; ▶ uses the same source (v79's own `keepAlive` under ▶ is gone — one source, never two); stopped at once when the page is hidden or left. Why 2 minutes: long enough to play a passage on the real keys between two looks at a note; past it the next press pays the wake-up once. The cost is the audio route staying on — small beside the screen, which the wake lock keeps on anyway.

**Measured** (event `timeStamp` → the piano source's `start()`, from outside the page, so v79 is measured the same way; 20 presses spread over page 1, 820×1180, the Full score; two runs each, ranges):

| | Chromium ×1 med / p90 | Chromium ×4 CPU med / p90 | WebKitGTK med / p90 | start − currentTime | screen touched before the sound |
|---|---|---|---|---|---|
| Killing Me Softly, v79 | 4.2–4.7 / 5.9–6.8 ms | 14.8–16 / 18.5–25.8 ms | 4–5 / 20 ms | +10 ms | every press |
| Killing Me Softly, v80 | 2.4–2.6 / 3.5–6.3 ms | 8.1–9.5 / 11.8–13.2 ms | 1 / 3–4 ms | 0 | none |
| Piano Man, v79 | 4.0 / 5.4–5.8 ms | 15.9–16.5 / 21.3–28.8 ms | 5–6 / 10 ms | +10 ms | every press |
| Piano Man, v80 | 2.3–2.6 / 2.9–3.6 ms | 8.0–8.5 / 13.2–15.6 ms | 1 / 2–4 ms | 0 | none |

Adding the 10 ms v79 started ahead, a press now reaches the audio graph ~12 ms sooner on a desktop and ~17–18 ms sooner at ×4 (the closest stand-in for an older iPad here). The handler itself (pointerdown capture → its end on window) went from 2.1–2.6 ms to 0.5–0.7 (×4: 8.5–10.3 → 2.1–2.5; WebKitGTK 4–5 → 1); the rest of the lag is the browser's dispatch. `nearHead` costs 0.1–0.2 ms a press (×4: 0.5–0.9, at most 3.9; WebKitGTK ≤ 1 ms) — no cache needed. Quick taps 90 ms apart, one finger: 3.8–4.6 ms median (v79 4.1–15.9 + 10). A press while ▶ plays the page: ~11–12 ms (v79 ~12–14 + 10) — the event waits behind ▶'s frame work in the browser, the handler itself takes 0.4 ms (v79 ~2). Rapid two-finger alternation ~9 ms after the first two taps (behind the previous press's drawing). The peek's drawing, now after the sound, 2–3 ms a frame in WebKitGTK. In WebKitGTK the held tone's PeriodicWave costs ~3.6 ms the first time on a context: it is made with the context (`primeHold`), not in the first press. Not measurable here: the iPad's own output latency and what the silent-gap flips cost on iOS — the keep-awake removes the flips; Bluetooth output adds 150–250 ms nothing on the page can take back.

**Debug:** `resonateDebug().play.peekLog` per strike (`midis`, `how` hold/lift, `cut`, `pid`, `lag` ms from the event's timeStamp to the `holdPiano` call, `ahead` s = start − currentTime, `hit` ms = nearHead, `again` = keys restruck, `at`), `peeks` (every strike shown: ids, names, held, pid, sounding), `peek` (the newest, with the strip's lit keys and side), `awake` (on, same context, idle ms, `AWAKE`), `audio` (state, stuck, session, rate, base/output latency, piano decoded), `t.peek` (the drawing's ms).

**Tests:** tools/playpress.cjs (Chromium, CDP multi-touch: A sound before sight — the strike inside the pointerdown's dispatch, nothing written or measured on screen before it, start = currentTime, then lit / named / on the strip; B two fingers at once, then one lifted; C a second finger doesn't cut the first; D 12 rapid alternate overlapping taps all strike at their presses; E the same key again: the old note damped at the new start, τ 15 ms; F only the first finger drags, another finger moving or on paper does nothing; G one keep-awake source shared with ▶, on after ■, off when hidden, back at the next press, and the 2-minute timeout under Playwright's clock; H the session set once; I an iOS-like gate — the context made at load with the session untouched, the piano decoded before any touch, a first press held is silent and sounds at the lift, then presses sound at the press, two fingers before the unlock both sound, a lift that never starts is dropped; J the stage's touch-action is none; K the table above, ×1 and ×4, presses while ▶ plays, `HEAD_BASE=` measures another version from outside), tools/playpresswk.mjs (WebKitGTK: the same footprints with mouse presses on both Full scores; `SITE=/ROOT=` + `CHECK=0` measures another version). Updated: playextras.cjs C (the context is made at load: one context, the press sets `playback`; a press sounds every voice on the staff, so the second press sounds ≥ 1 key — it expected exactly 1 and failed on v79 too).

**Not done / limits:** the bubble names only the newest strike; a second finger that slides never becomes a drag or moves its note; the iPad's own numbers are still to be felt — if a press still feels late on the iPad with the output awake, the next suspects are the route (Bluetooth) and WebKit's 128-frame IO with no prefill (see CLAUDE.md, Sing → "Over CarPlay").

## As built (v80): the keyboard docked (🎹)

The owner, same message: "the piano guide pop-up, it's very flaky, like it'll show up and disappear at random times … maybe it needs to be a toggleable thing that, you know, is there and just stays there, or as opposed to something that like pops in and out."

**What v79 did.** `#strip` was an overlay inside the stage: it slid up (0.16 s) on a press, at the stage's foot — or its head when the chord sat low — and slid away 2 s after the lift; while ▶ played it took the foot or the head, whichever covered neither the line playing, the next line nor a stretch's lines, switched sides when that changed, and on a page where neither side was clear (two systems a page in landscape, one on a phone) it wasn't there at all. Three reasons to appear, disappear or move, none of them the owner's.

**Docked.** `#dock` is a block of its own in the page's column, under `#stage` (`play.html`): the stage ends where the dock starts, so Verovio lays the music out for the height above it (the stage's size is what `measure()` reads) and nothing is ever drawn under it. Nothing moves it: no slide, no sides, no hiding with a press, a lift, ▶, ■ or a turn (`placeSelbar`'s strip rules, `stripSideNow`, `PB.stripOff`, `PB.busyRects` and the transition are gone; `busyNow` keeps the ink the controls avoid). It's a flex row: `#strip` (the keys) takes the width, so what ▶ plays can be chosen at its left end (next step) and the keys draw to what's left. Keys `clamp(56px, 9vh, 110px)` high plus 6 px padding above and below (Air portrait 106 + 12, landscape 74 + 12; mini 102 / 67; 13" 110 / 92; a 900-px desktop 81), and the bottom safe area is the dock's (`body[data-keys="on"]` drops the stage's own padding there). `pointer-events: none` on the keys: a press on the keyboard does nothing (it isn't an instrument yet).

**The toggle.** 🎹 in the bar after ABC — an SVG keyboard (the bar's other icons are monochrome SVGs; an emoji 🎹 renders as a small coloured picture at the bar's font size), `aria-pressed`, the label "Keyboard" (a toggle's name doesn't change with its state), 44 × 44 on a touch screen, filled purple when on like 📄. Device pref `resonate.play.keys` = "on" | "off" (not shelved — a device's layout, like the zoom); none: on for a tablet and a desktop, off on a phone (`device()`: coarse pointer, short side < 700 — a phone's height is the music's; an iPad window in Split View is a tablet, on). A tap lays the page out again at once at the new height (`dock(true)` → `relayout()`, as a rotation: the place `S.at` kept, ▶ plays on, a held peek let go) — not 150 ms later through the resize observer, which then finds the size unchanged.

**PDF view (📄): hidden.** Nothing there lights it (presses and ▶ are off on the PDF), and a PDF page in portrait is fitted by its height — on an Air, 950 px of stage for a letter page (×1.20) becomes 1068 (×1.34, then width-limited): the page is 12% larger. 🎹 is disabled there, like ABC and − / +. The sheet stays laid out under the PDF for the stage it had: `sized()` (the resize observer's work) skips it while the PDF shows, so back on the sheet — the dock back, the stage its old size — nothing is laid out again and the place is where it was; after a rotation in the PDF view the 📄 tap lays it out at once for the new stage.

**What it shows.** The view's range in whole octaves, C3–B5 at least (`stripRange`, as v79), the dot on middle C; lit in the hand's colour with a letter on each (RH `#a64fff`, LH `#4f7cff`, the Full score's voice `#0b8f78`): every strike on screen — held, and 2 s after its lift (`HIDE_AFTER`, as v79) — and what ▶ sounds now (`KB.play`, from `setLit` → `playKeys`); both at once when a press comes during ▶ (`keysLit()`: ▶'s keys, then the strikes', the strike's hand on a shared key — v79 gave the strip to the peek and took ▶'s keys off it). Idle: no key lit. `drawKeys` draws only when the range, the size or the lit keys change (its size from a ResizeObserver on `#strip`, so a rotation redraws it; under ▶ one drawing per change of what sounds, as v79's strip). The names bubble stays on the music by the chord (it's in the stage; the keyboard is under it), `#selbar` at the stage's foot is just above the keyboard.

**Layout: what it costs, and the landscape floor.** The default size is the width's (`PAPER`): portrait sizes don't change; what the keyboard takes is height — a system a page fewer where a page was full. In landscape the Full score's "two systems a page" fit had to step lower, and Piano Man's 4-staff Full score went to one system a page on every iPad (41–42 pages, 5–6 bars each: a turn every ~5 s at ♩=174) — the floor, 0.9 of the device's portrait density, was measured against the stage without a keyboard ("two systems of voice + piano + one more staff need ~85 staff spaces of the short side less the bar"). The floor now shrinks with the stage: × stage / (stage + keyboard) (`fit`, `room`) — with the keyboard on, the music gives up a little size rather than the second system; with it off, v79's floor exactly. Survey (tools/playpaper.cjs S, the default, staff space px — before (v79) → after (v80, keyboard on where it's on by default); `*` one system a page; the last two columns: median systems a page and pages over the six songs, Full score / Both):

| device | Both / RH / LH / Melody | Full score: amazing-grace · killing · longest · pianoman · songbird · wichita | systems a page | pages |
|---|---|---|---|---|
| 11" Air 820×1180 | 9.11 | 9.11 (all) | 3→3 / 5→4 | 49→54 / 28→30 |
| 11" Air 1180×820 | 13.11 | 12.29→10.9 · 10.89→9.66 · 12.29→10.9 · 8.34→7.4 · 10.12→8.98 · 10.89→9.66 | 2→2 / 2→2 | 54→49 / 61→64 |
| mini 744×1133 | 8.27 | 8.27 (all) | 4→3 / 5→5 | 43→50 / 26→29 |
| mini 1133×744 | 12.59→12.14 | 11.06→9.79 · 9.8→8.67 · 11.06→9.79 · 7.51→6.64 · 9.11→7.5 · 9.8→8.67 | 2→2 / 2→2 | 50→45 / 63→63 |
| 13" 1024×1366 | 11.38 | 11.38 (all) | 3→3 / 5→4 | 50→55 / 28→32 |
| 13" 1366×1024 | 15.18 | 15.18→13.89 · 13.8→12.3 · 15.18→13.89 · 10.57→9.42 · 12.83→11.44 · 13.8→12.3 | 2→2 / 2→2 | 59→52 / 54→62 |
| phone 390×844 | 9.5 | unchanged (off by default) | 2 / 3 | 183 / 117 |
| phone 844×390 | 9.5 | unchanged (off by default) | 1 / 1 | 101 / 126 |
| desktop 1440×900 | 12.5 | 12.5→12.15 · 12.09→10.76 · 12.5→12.15 · 9.38→8.34 · 11.24→9.3 · 12.09→10.76 | 2→2 / 3→2 | 49→43 / 38→45 |
| desktop 1100×760 | 12.22 | 11.39→10.08 · 10.09→8.93 · 11.39→10.08 · 12.22*→11.79* · 9.38→8.3 · 10.09→8.93 | 2→2 / 2→2 | 82→78 / 62→64 |

In landscape the Full scores are ~11% smaller (Killing 10.89 → 9.66 on an Air) with more bars a system, so they keep two systems a page and take fewer pages; Piano Man stays two a page (7.4 Air, 6.64 mini, 9.42 13"; with the floor kept it was one a page at 12.75 / 11.45 / 15.18). One-hand views in landscape and every portrait view keep their size and lose a system a page where the page was full (the Air's Both 5 → 4 systems, 28 → 30 pages over the six songs). The phones are unchanged (keyboard off). The rest of the survey's rules hold with the keyboard on: whole systems on a page, nothing past the stage, no spread at the default, two systems on ≥ 75% of a landscape page where the mode is two (all 1775 checks). The 1100×760 desktop's Piano Man was one a page in v79 too (its 4-staff system's cap).

**The bar.** No taller than v79's — measured at 55 widths from 300 to 1440 px × with/without the fewer-names chip × 📄 shown or not × touch/mouse (440 settings; v79 itself is no taller than v78's) — so the music's height isn't paid twice. What gives way: the view menu first (`#bar #hands { flex: 1000 1 0; min-width: 4.5rem; max-width: max-content }` — it takes the row's room before the song menu, up to its whole name, so it's full wherever there's room: every iPad in portrait and landscape, phones from 390 px; clipped — "Both…", "Full…" — where the row is tight: 360–375, 480–507 and 670–700 px), then the gaps (the controls' row a little closer under 670 px: 0.3rem, the phone rows' 0.5 / 0.4rem); ▶ and 🎹 are 44 px (a `#bar button` padding beat `#play { padding: 0 }`: ▶ was 45). Under 360 px (an iPhone SE of 2016, a few Androids) there's no room on the controls' row and the keyboard is off there by default: 🎹 is hidden (a keyboard turned on at another width stays on).

**Debug:** `resonateDebug().play.keys` = { on, pref, dflt (the device's default), shown, rect (client px), range, lit [{ midi, hand }], draws }; `peek.lit` and `playback.strip` are the keyboard's lit keys (none while it's hidden); `playback.busy` the number of ink rects the controls avoid; `peek.side`, `playback.stripSide` / `stripOff` are gone.

**Tests:** tools/playkeys.cjs (D the defaults on the ten playpaper devices and a Split View window, the dock's height, 🎹 ≥ 44 px, idle nothing lit; U every page of Amazing Grace (Both), Killing Me Softly (Full score, Both) and Piano Man (Full score) on every device with the keyboard on and off — the music inside the stage, the stage ending where the dock starts; T the toggle — pref, aria-pressed, laid out again in the tap at the stage's new height, the place kept, reloads, a phone turned on and off, a toggle while ▶ plays; S sampled every animation frame at 820×1180 and 1180×820 through a press and its lift, two fingers, ▶ with auto turns, ■, ‹ ›, a stretch looped, − / +: one rect, never hidden, never over the music; L the range per view, a press lit in its hand's colour with letters and gone 2.4 s after the lift, the bubble on the music, ▶'s keys = the midis sounding (sampled), a press during ▶ lit with ▶'s, ■ → none; P the PDF view — hidden, 🎹 disabled, the PDF's page taller, the sheet not laid out again, back at once, a rotation in the PDF view laid out on the way back; B the bar vs v78's heights (playbackfixes H's table) with and without the chip, 🎹 from 360 px, and with `HEAD_BASE=` every width × chip × 📄 × pointer against v79). Updated for the docked keyboard: play.cjs (the peek: lit keys where the keyboard is on by default, none on a phone; the keyboard under the music and still there after the lift), playextras.cjs (A: a low chord leaves the keyboard where it is; B: the phone turns it on to check the hands' colours), playbackfixes.cjs (R: the keyboard there in every sample, one rect, never over the music, across auto turns and a loop — replaces the strip's sides; F: the floor × the keyboard's share), playpaper.cjs (S: the landscape floor × the keyboard's share), playscore.cjs (B2: the same floor, and a full score's default may be its cap — a whole 4-staff system a page — under the printed density: score-pvg at 12.75 on an Air in landscape), playfixes.cjs (P3: Piano Man's Both in landscape with the keyboard — the fit's own rule, two systems on ≥ 3 pages in 4: 20 of 21; v79 had all), playwebkit.mjs (WebKitGTK: the keyboard docked under the music, 🎹 off and on laying out at once), playpress.cjs, playscore.cjs C, playextraswk.mjs (the lit keys instead of the strip's "on"). Not changed, still passing: playback.cjs (its `strip` is now the keyboard's lit keys), playbackwk.mjs, playcore.cjs.

**Not done / limits:** the keyboard takes no touch (playing on it is a later step); its height is fixed by the window (no handle to resize it); on a phone it's off by default and its button gone under 360 px.

## As built (v80): what ▶ plays (the chips)

The owner, same message: "when I play or loop with full score, I'd like it so I could choose what to hear … I want to see the full score so I can see the lyrics and I can see the vocal melody, but I only wanted to play the piano part."

**The chips** (`hearGroups` in play.js, from the view's plan — `plan.sung`, `views.both` — and the parts): in a view with more than one thing to hear, a chip each, in score order, coloured as the keys it lights. The chips are the labels (few words):

| view | chips |
|---|---|
| Full score, voice + piano (Killing, Wichita, Songbird) | Voice (green) · Piano (half purple, half blue) |
| Full score with another part (Piano Man) | Voice · Piano · Part 3 (pink) |
| Full score with a named instrument (score-pvg) | Voice · Piano · Guitar |
| Full score that is the piano alone, the tune inside it (The Longest Time, score-tunein) | RH · LH |
| Full score / Both of a hymn (Amazing Grace) | RH · LH (the treble part, the bass part — as the keyboard colours them) |
| Both (a 2-staff piano) | RH · LH (by staff: staff 1, staves 2+) |
| Both with no piano and no hymn (score-guitar) | Voice · Guitar |
| Right hand, Left hand, Melody, a voice-only song | none |

- **Voice:** the sung parts (`plan.sung`). Several singers: their part names when each has its own, else Voice 1, Voice 2.
- **Piano:** one chip for the whole keyboard part in the Full score (both hands' colours); split into RH / LH only where the Full score has nothing else to hear.
- **Another part:** by its part name — unless it's generic (empty, "Voice", "Vocals", "Piano", "Part 2", "P3"…) or another chip has it, then by its place in the view: "Part 3". Piano Man's P3 is the printed accordion cue staff, which the converter names "Voice" (it has 13 stray syllables in 401 notes, so it isn't sung): "Part 3", not a second "Voice". Its own colour (`HAND.part`, #d6336c — clear of the voice's green, both hands and the page's orange), on its keys too: v79 lit it as the right hand (purple), which would have read as the piano still playing with the piano muted. `handOf` now asks the view's chips first, so a chip and its keys always agree; every other view's colours are as before.
- **A tap** mutes / unmutes for ▶ and ⟳ (`aria-pressed` = heard; muted: transparent, outlined in its colour, the label struck through — as ABC's Off). At least one stays on: a tap on the last one heard shakes it (0.28 s, none with reduced motion) and changes nothing.

**Where** (`renderHear`): one `#hear` element, moved —
- **The keyboard on (🎹; the iPad's default): at its left end**, in the dock beside the keys they colour — always there, so the choice is made before ▶, with or without a stretch. Rows of 44 px as the keys' height holds (`hearRows`: two in portrait — Voice over Piano —, one in landscape and on a phone), then columns. The dock's height doesn't change (the music isn't laid out again); the keys draw to the width left: Piano Man's three chips take 141 px of an Air's 820 in portrait, 213 of 1180 in landscape.
- **The keyboard off (a phone's default): in the stretch's controls** (`#selbar`, after the speed): they show with a stretch and while ▶ plays (■ and the speed are there then too), so a change can be made as it plays. The controls wrap to two rows where they'd run off the stage (a phone with a stretch: ▶ ⟳ 100% · Voice Piano Part 3 ✕), radius 26 px. With no stretch and nothing playing the chips aren't on screen: ▶ plays what was chosen last, and they appear as it plays. (Not in the bar: the bar's height is the music's, measured against v78's and v79's at 55 widths, and it has no room on a phone.)
- 🎹 moves them at once; hidden in the PDF view and while a song loads.

**Kept** in the song's record, per view kind: `resonate.play[id].hear` = { score: ["P1"], both: ["P2|2"] } — keys are part ids, or `part|staff` for a hand; a view's entry goes when everything's heard, `hear` when no view has one. Written through `saveState` (the `spaceChanged()` guard; DATA_KEYS: shelved / parked with the account). A record that mutes every chip of a view, or names none of them (another version's, a hand edit), hears everything. Default: everything heard.

**Playback** (`playtime.track(T, { …, hear })`, `hearOf()` in play.js): `hear(el)` false for a muted part's note. The note stays on the schedule — `muted: true`, `sound: false`, its ties joined as a heard note's (its continuation muted with it) — so it's lit as the music passes; but it's left out before the unison dedupe and the chord count:
- **Unisons:** a key struck twice at once is struck once, the longer, among the heard notes only. Killing Me Softly's Full score from page 1 (1567 notes in Sing's order; everything heard: 878 struck, the voice 373, the piano 505), voice muted: the voice's 496 notes on the schedule, none struck; the piano struck 866 times — its own 505 + 361 where the voice used to take the unison with it (it was the longer). Piano muted: exactly what the Melody view strikes (ids, levels and lengths) — the voice's own unisons with the piano struck again.
- **Levels:** n (keys struck together within 10 ms) counts the heard keys struck: Killing, voice muted — at 12 moments (the piano doubles the tune almost everywhere) a chord is a key thinner and its notes a little louder (`min(1.2, 4/(n+1))`), as if that chord had been written so.
- **Nothing muted:** `hear` is null and the schedule is v79's exactly (checked: ids, struck, n, hold).
- Piano Man: Part 3 muted → voice and piano; Voice + Part 3 → the piano alone. Killing's Both, LH muted → the right hand alone.

**A change while playing** (`rehear`): the same music — `PB.args` (the bars, the stretch, the tempo), kept from ▶ — scheduled again with the new hear (`trackOf`), from 50 ms on (`reschedule`, now shared with the speed change: what was scheduled to start later is silenced at its start and laid again; the clock continuous). What a newly muted part sounds is damped at once (τ 40 ms, as ■; its log entry gets `cut`), and lit lighter from then; a note it had scheduled within the 50 ms is silenced before it starts. A key nothing heard sounds any more — a unison whose struck twin was the muted part's (the piano's copy wasn't struck: the voice's was) — is lit lighter too, so the keyboard never lights a silent key. A part unmuted comes in at its next note (a note half over isn't struck late). In a loop the next rounds follow, still one stretch-length apart. During ▶'s start (the context waking) the schedule is rebuilt before anything is scheduled. 1–3.3 ms on Killing (1567 items) and Piano Man (2690) — the schedule alone ≤ 4 ms. Checked against the Web Audio graph: the audible sources started after a change are the log's (playhear D).

**Lit** (`setLit`, `.play` / `.hush`; `PB.lit` now id → the class it has, since a mute changes an entry's flag under it — the first build left stale orange heads lit):
- What sounds: the peek's orange (as v79), and now the **syllable under it** orange too (`g.note.play > g.verse text`) — the words followed as they come.
- A muted part's notes as they pass, lighter: the head `#f0a560`; a filled pill pale (`#ffd8b3`) with an orange letter (`#a84f00`), a hollow one outlined `#f0a560` on `#fff3e6`; the syllable orange (`#d27a2c`). So with the voice muted the tune and its words still move along the voice's staff while the piano is heard.
- The keyboard: only what's heard (`playKeys` skips muted entries) — the voice's keys stay dark when it's muted.
- A press (peek) always sounds what's pressed, muted part or not.

**Debug:** `resonateDebug().play.playback.hear` = { groups [{ key, label, hand, heard }], muted, saved (the record's), home ("dock" | "selbar" | null), shown, rect, chips [{ key, label, hand, pressed, rect }] }; `items[].muted`; `scheduled[]` only the notes struck (with `n`, and `cut` when a mute damped it); `hushed` / `hushEls`; `t.rehear` (ms).

**Tests:** tools/playhear.cjs (Chromium, 211 checks — A 159, B 14, C 11, D 8, E 3, F 1, G 14, no page errors: A the chips of every view of the five owner scores, Amazing Grace and five fixtures — labels, keys, colours (computed), all pressed, in the dock left of the keys, ≥ 44 px, the dock's height unchanged — and Piano Man's Part 3 keys lit pink from its page; B the schedules: voice muted, the piano's tune struck where the voice was, only the piano, every chord's n = its heard keys, 12 thinner chords; piano muted = the Melody view's; everything heard again = v79's; Both with LH muted; Piano Man Part 3, then Voice + Part 3; the last one heard stays on; C the record per view across a reload and a song switch, removed when all heard, a record muting everything or naming nothing heard as all; D voice muted 2 s into ▶ — only the piano struck after, the voice's sounding note damped, the piano's tune coming in, unmuted — struck again, the audible sources after the change = the log; a stretch looped, the piano muted in round 1 — the later rounds the voice alone, one stretch-length apart; E sampled every ~120 ms for 6 s, voice muted: the keyboard = the heard lit notes' keys, never a voice key, `.play` = heard and `.hush` = muted on the shown page, nothing lit after ■; F voice muted, a press on a voice note strikes it; G the keyboard off at 820 × 1180 and 390 × 844: hidden idle, in the controls with ▶ (inside the stage), a tap there mutes while playing, gone with ■, with a stretch (⟳ ✕ and the chips, wrapped on the phone, inside the stage), 🎹 on → in the dock, off → back), tools/playhearwk.mjs (WebKitGTK: Amazing Grace's Both RH / LH in the dock, LH muted and saved, the last one stays on, ▶ — only the right hand struck, the left lit lighter and never on the keyboard, LH unmuted while playing — struck again, ■; score-pvg's Full score Voice / Piano / Guitar, Voice + Guitar muted — only the piano; 🎹 off — the chips in the controls while ▶ plays, a click there unmutes; no errors). regress.sh runs both.

**Not done / limits:** with the keyboard off the chips can't be set before ▶ without a stretch (they show as soon as it plays, and the choice is kept); the voice is still played on the piano (no voice-like sound); a part unmuted mid-note waits for its next note; the Full score's piano is one chip (its hands: in Both); the chips' state isn't synced (as the rest of `resonate.play`).
