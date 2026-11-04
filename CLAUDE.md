# Resonate

A vocal pitch + waveform web app served over LAN so it can be used from a phone. Sing into the mic, see the note name, cents-off, volume, and live waveform.

## Deploy (primary workflow)

Push to `main` → `.github/workflows/deploy.yml` publishes `public/` to the `gh-pages` branch → live on GitHub Pages (HTTPS, so the mic works on a phone with no cert hassle). This is the normal iteration loop: make the change, bump the version badge, push to `main`, tell the user when the deploy finishes. The local server below is only for offline testing.

## Pages

- `index.html` + `app.js` — the tuner (hold a note, see note/cents/volume/waveform). Classic script with its own YIN — deliberately untouched by the other pages. Header links to Record and Sing.
- `record.html` + `record.js` — free singing: live piano roll, transcript of detected notes, playback (voice / notes on piano / both).
- `sing.html` + `sing.js` — karaoke against a MusicXML song: the score sets the clock, you sing along, each note is graded in its own time slot.
- `tools.html` — Tools menu (debug/experimental): links to tools + a device-capability check. Every page's header links here.
- `pdf-import.html` + `pdf-import.js` — **PDF → Song**: runs Audiveris (Java OMR) in the browser via CheerpJ and saves the MusicXML to My songs (see "In-browser OMR" below).
- `omr/` — the in-browser OMR engine (`omr.js` page side, `omr-worker.js` + `ocr-engine.js` in a Web Worker, `pdfprep.js`, jars, WebAssembly Tesseract, pdf.js). Built from `/omr-build` (not published).
- Shared ES modules used by record + sing:
  - `pitch.js` — `openMic()` (mic with processing off, AnalyserNode, `read()` → `{rms, db, midi}`) and the YIN detector. Same algorithm/settings as `app.js`.
  - `music.js` — note names, `fold` (octave-free semitone difference), `median`, `centsLabel`.
  - `piano.js` — sample piano (`loadPiano`/`playPiano`) and a noise-burst metronome `playClick`.
  - `capture.js` + `recorder-worklet.js` — capture a take's raw audio for playback; `playVoice`.
  - `musicxml.js` — MusicXML parser with timing (`.musicxml`/`.xml`, zipped `.mxl` via a tiny zip reader + `DecompressionStream`; UTF-8 or UTF-16).
  - `library.js` — "My songs": imported scores (raw XML) in IndexedDB, in-memory fallback.
- `songs/` — bundled sample scores (see `songs/README.md` for licensing). Add to `SAMPLES` in `sing.js` and an `<option>` in `sing.html`.
- `piano/` — piano samples (see below).

## Run (local, optional)

```
cd C:\Data\Claude\resonate
npm start
```

Server prints both HTTP (port 3000) and HTTPS (port 3443) URLs for localhost and every detected LAN IPv4. **In practice the port that matters is 3443 (HTTPS)** — that's the one used from a phone, because `getUserMedia` is blocked on insecure origins for any non-localhost host. Port 3000 (HTTP) is only useful for localhost testing. There's no auto-reload; restart the node process to pick up `server.js` changes. Frontend changes (`public/`) just need a browser refresh.

**Which Network URL to give a phone:** the banner lists *every* IPv4, including virtual adapters — Hyper-V's "vEthernet (Default Switch)" (`172.x`) and VirtualBox host-only (`192.168.56.x`). A phone can't reach those. Pick the **Wi-Fi adapter's** IP (the one on the same subnet as the phone).

**Restarting:** `server.js` calls `listen()` with no `error` handler, so if an instance is already running, `npm start` prints the banner and *then* crashes hard with `EADDRINUSE` on 3000. A running instance holds both 3000 and 3443 — so this error also means "it's already up." To restart cleanly, kill the existing `node` process first (`Get-Process node | Stop-Process`).

## Version marker

`index.html` shows a `v<N>` badge in the top-right of the header (`#version`, purple). It exists so you can confirm a frontend change actually reached the phone — bump the number, refresh, check the badge. To bump: edit the `<span id="version">` line in **every** page — `index.html`, `record.html`, `sing.html`, `tools.html`, `pdf-import.html` (keep them equal). If the badge doesn't change after a refresh, the phone is serving a cached `index.html` — hard-refresh / pull-to-refresh.

## Stack

- Node 21+, ESM, Express 4, `selfsigned` for cert generation
- Vanilla HTML/CSS/JS frontend, no build step, no framework
- Web Audio API (`AnalyserNode`, fftSize 4096) for capture; YIN for pitch detection; Canvas 2D for the waveform

## HTTPS / self-signed cert

Generated on first run to `certs/cert.pem` and `certs/key.pem`. SAN includes `localhost` and every IPv4 present at generation time.

**If the LAN IP changes** (router lease, network switch), the cert won't cover the new IP — delete `certs/` and restart to regenerate.

Browsers warn ("not private") because the cert isn't CA-signed. On iOS Safari: "Show Details" → "visit this website".

## Windows firewall

If the phone can't reach the server, this is the most likely cause. Allow inbound on 3000 and 3443.

## Pitch detection (`public/app.js`)

YIN algorithm (de Cheveigné & Kawahara, 2002). Chosen over FFT peak-picking because YIN avoids the octave errors that vocals trigger. Inner loop is bounded to `tau ∈ [minTau, maxTau]` covering only the vocal range (~50–1100 Hz) — keeps it cheap enough for phones.

`detectPitch` sets `halfN = buf.length - maxTau` so the autocorrelation uses every sample the largest lag will allow, instead of the standard `buf.length / 2`. This is what makes low-pitch detection viable at fftSize 4096; reverting halfN to `buf.length >> 1` halves the cycles available for sub-100 Hz pitches and the dip stops triggering. The threshold for accepting a YIN dip is 0.2 (paper suggests 0.1–0.15; relaxed because low-fundamental vocals often don't dip below 0.15).

Mic constraints disable `echoCancellation`, `noiseSuppression`, and `autoGainControl`. Browser defaults distort pitch and amplitude in ways that break detection and meter scaling.

## Locked-note display logic

The shown note isn't `round(current pitch)` — that flickers when vibrato lands near a semitone boundary and lags badly when the user intentionally jumps to a new note. Instead:

- `lockedNote` is a single integer MIDI we currently display.
- Cents number + needle = long-window median (1.5 s) compared to `lockedNote`.
- Each frame, the **short-window median** (300 ms) is compared to `lockedNote`. If it's >50¢ off, an off-note timer starts and the note dims (`data-onnote="false"`).
- If the short median stays >50¢ off for **250 ms**, we re-lock to `round(short median)` and trim history older than the short window so the long median resnaps.

Net feel: holding a note is rock-stable; intentional jumps cause a brief dim then a clean snap.

## Tunable constants (top of `public/app.js`)

| const | default | effect |
|---|---|---|
| `PITCH_WINDOW_MS` | 1500 | long smoothing — bigger = more stable cents number, slower settle |
| `SWITCH_WINDOW_MS` | 300 | live-pitch window — smaller = more reactive but jitterier |
| `SWITCH_DELAY_MS` | 250 | grace period before snapping to a new note |
| `MIN_RMS` | 0.012 | loudness gate — raise if room noise produces false readings |
| `MIN_CLARITY` | 0.80 | YIN clarity threshold — raise for stricter readings |
| `MIN_FREQ` / `MAX_FREQ` | 50 / 1100 Hz | vocal range bound for YIN; sets `minTau`/`maxTau` |

## Volume meter

Maps RMS → bar width via `(dB + 55) * 2`, clamped 0–100%. Roughly −55 dB empty, 0 dB full. If the bar sits too full or too empty for your mic gain, adjust the `+55` constant in `updateVolumeMeter()`.

## Record page note segmentation (`public/record.js`)

Per frame: YIN pitch (`pitch.js`, same settings as the tuner) → median over `SMOOTH_MS` (100 ms). A note continues while the smoothed pitch stays within 50¢ of the note's median; it splits when the pitch sits >50¢ away for `SPLIT_MS` (80 ms), and ends on an unvoiced gap ≥ `GAP_MS` (70 ms). Notes shorter than `MIN_NOTE_MS` (60 ms) are dropped. Voicing also requires the RMS of the newest `TAIL_SAMPLES` (1024, ~21 ms) to pass `MIN_RMS` — the full 4096-sample window smears short gaps, which otherwise merges repeated same-pitch notes. No beat grid yet; times are seconds.

## Sing mode (karaoke, `sing.js`)

The **score is the clock** (an earlier version aligned sung notes to the score ignoring rhythm — dropped: wrong notes leave nothing reliable to align on).

**Parsing (`musicxml.js`):** picks the part+voice with the most lyric syllables (the melody — e.g. soprano of an SATB hymn). Tracks position across all voices (`backup`/`forward`) so each note gets an `onset` and `dur` in quarter notes; measure starts in `measures` (a short first measure = pickup). Keeps the highest note of chords, skips grace/cue notes, merges ties; rests become gaps (and `restBefore`). Tempo = first `<sound tempo>` or `<metronome>` (default 90 if none), time signature from the first `<time>`. Lyrics per verse; a note with no syllable after a sung one is a melisma continuation (`‿`). Lyric text cleanup: verse numbers stripped, `I 'm` (often with a non-breaking space) → `I'm`. `lyricLines()` splits a verse into display lines at rests and line-ending punctuation. Title falls back to the largest-font `<credit-words>`.

**Session:** one AudioContext for mic + guide so clocks match. Count-in = one bar (+ the missing beats of a pickup bar) of clicks; `songT0` = song time 0 on the audio clock. Guide while singing: **click** (default — a noise burst, so speaker bleed into the mic isn't read as pitch), **melody** (piano; use headphones or the mic grades the piano), **none**. Settings: verse, key (±6 semitones, transposes targets + guide), tempo (50–125% of the score's), all persisted in `localStorage` (`resonate.sing.*`).

**Loading songs:** **Open** button (a direct tap → `fileInput.click()`; iOS blocks file pickers opened from a `<select>` change, which is why there's no "Load…" menu item) with **no `accept` filter** — iOS greys out `.musicxml`/`.mxl` since it has no file type for them; files are validated after picking, with specific hints for `.mscz`/`.mid`/`.pdf`/`.sib`. **Link** (prompt; GitHub `blob` URLs → raw, Dropbox → `dl=1`; CORS failures explained). Drag-and-drop on desktop. Imported songs go to **My songs** (`library.js`, IndexedDB, stored as raw XML and re-parsed on load); ✕ removes. The old single `resonate.sing.customXml` localStorage song is migrated once.

**Entry bar:** the count-in, clicks, lane and Listen start at the bar containing the first sung note (`entryIdx`/`entryT`), so songs with an instrumental intro (e.g. art songs) don't make you wait through it. `songT0` is offset so song time stays absolute.

**Frame timing:** `frameT = songT − ANALYSIS_LAG − latency`, where `latency = outputLatency (or baseLatency) + INPUT_LATENCY (20 ms)` — the singer follows what they hear late, the mic hears them late, and a pitch frame lags its audio.

**Grading (`gradeNote`):** frames inside the note's slot, skipping the first `min(GRACE_MAX 120 ms, 25%)` for scoops/late entries. Voiced < `MIN_VOICED` (35%) → *missed*. Else median octave-folded deviation: ≤25¢ good, ≤50¢ close (ok), else off (shows the note you sang). `hit` = share of the slot's frames voiced and within 50¢; the take's % = duration-weighted mean `hit`. Notes after Stop are *unsung* (not counted). Octave sung is reported (8vb/8va). Graded live as each slot passes.

**Display:** lane with the "now" line at 30%; score notes as bars with lyrics; your pitch drawn octave-shifted next to the current target (green within 50¢, red outside). Karaoke lyric line above (current syllable yellow, graded syllables coloured). Chips per score note. After a take: % + counts, drag the lane to review, tap a chip to seek; Play modes Voice / Melody / Both (voice is shifted by the recording latency so it lines up with the score). **Listen** plays the melody with the lane + lyrics, no mic.

Tested scores: the bundled Amazing Grace (SATB hymn), Schumann *Dichterliebe* No. 1 (voice + piano, German, long intro — from the OpenSheetMusicDisplay test data), Saltarello `.mxl` (instrumental, no lyrics → note names in the lyric line).

**Future:** a start-point selector (sing from a later line), latency calibration (Bluetooth headphones add 150–250 ms the browser may not report), rhythm/timing scoring.

## Take playback (record page)

The take clock is `mic.ac.currentTime - ctxT0` (not `performance.now()`), so pitch frames and captured audio share one timebase. `recorder-worklet.js` posts the audio-clock time of its first sample plus `Float32Array` chunks; on stop they're stitched into `voice` (peak-normalised gain). Modes: **Voice** (recording), **Notes** (a piano note per detected note), **Both**. Piano notes are shifted earlier by `ANALYSIS_LAG` (50 ms) because a pitch frame describes the trailing 85 ms window — measured lag is ~47 ms. Tap the roll or a chip to move the play cursor. iOS: `navigator.audioSession.type` is set to `playback` for playback (speaker, ignores silent switch) and `play-and-record` before the mic opens. `window.resonateDebug()` (record and sing pages) exposes state for automated tests. Record takes auto-stop at `MAX_TAKE_SEC` (300 s).

Piano: `public/piano/` holds Salamander Grand Piano samples (CC-BY 3.0, attribution in `piano/README.md`), one every minor third A1–C7, trimmed to 3 s mono 64 kbps (~530 KB total). Lazy-loaded and decoded once per AudioContext (`piano.js`); each note uses the nearest sample pitch-shifted via `playbackRate`, starts `ONSET` (12 ms) into the file, and is damped with `RELEASE` when the note ends. Pitch of every sample verified against its name (all within normal piano stretch tuning).

## In-browser OMR (PDF → Song)

Audiveris (Java 25 upstream) runs unmodified-in-spirit inside **CheerpJ 4.2** (WebAssembly JVM, loaded from Leaning Technologies' CDN, Community Edition = personal use). Details in `public/omr/README.md` and `omr-build/README.md`; the short version:

- **Build** (`omr-build/build.sh`): upstream commit `7a36078` + `omr-build/patches/` → compiled with `--release 17` (CheerpJ 4.2 runs ≤ Java 17) → every jar through `StripVolatile.java` → `public/omr/lib/`. Patch 0001 = Java 17 port (pattern switches etc.), 0002 = browser runtime (WebOCR, HOME fallback, web-safe thread pool), 0003 = no AWT in batch (EDT checks only with a GUI), 0004 = lyrics fix (an extender line `pain____` read as a huge-font word made Audiveris drop the whole OCR line — half the syllables; not browser-specific).
- **Runs in a Web Worker** (`omr-worker.js` hosts CheerpJ + Audiveris + the OCR engine): on the main thread CheerpJ froze the page for up to 11 s at a time. The page side (`omr.js`) renders the PDF and transfers the TIFF.
- **CheerpJ gaps worked around:** no env vars (`user.home=/files`), no GTK/JNA (`sun.java2d.uiScale=1`), no AWT display in a worker (patch 0003), `SynchronousQueue` (VarHandle natives) → `LinkedBlockingQueue` pool under `audiveris.web=true`, reflective access to volatile/final boolean/byte/short/char/float fields (Unsafe natives) → StripVolatile. Java 21 was not available in 4.2; CheerpJ 5.0 (Oct 2026) adds 21/25 — worth trying later.
- **OCR:** `WebOCR.recognizeGray` is a Java `native` implemented in JS (`omr-worker.js` passes it to `cheerpjInit({natives})`); it calls `ocr-engine.js` in the same worker, which drives tesseract.js-core's WebAssembly Tesseract exactly like Audiveris's `TesseractOrder` (legacy engine — needed for word font attributes — PSM 3/6, `SetSourceResolution(70)`, baselines, symbol boxes). Returns URI-encoded tab-separated records.
- **Input:** `pdfprep.js` renders pages with pdf.js at 300 dpi, keeps pages with ≥1 five-line staff (a staff-less page makes Audiveris fail the whole book), packs them into one gray multi-page TIFF → `/str/score.tif`.
- **Title:** Audiveris's `movement-title` is often OCR noise; `pdf-import.js` uses the largest-font page-1 `<credit-words>` (else the file name) and rewrites `movement-title` before saving.
- **Jars:** GUI-only libraries are not shipped (itext, jfreechart, github-api, jackson, jgoodies, commonmark, jna — `SKIP` in build.sh / `JARS` in omr.js): CheerpJ reads each classpath jar's index (~0.4 MB) up front. Verified identical output without them.
- **Rendering:** pages are binarized, counting pixels darker than ~80% white as ink (`< 200000` in `pdfprep.js`). pdf.js anti-aliasing left gray glyph edges that cut lyric recognition from ~44% to ~15%; the dark-leaning cut (slightly bold glyphs) beat a 50% cut on all four test scores (Killing Me Softly 87% → 98% of syllables) with identical notes.
- **Exit:** `omr.js` reads the `.mxl` as soon as Audiveris logs "exported to …" (CheerpJ threads parked in a queue don't wake on interrupt, so executor shutdown would sit out its grace delay; `graceDelay=1` too).
- **Accuracy on the test score** (vs a 3-way reconciled hand transcription, 311 sung notes): notes 100% found, pitch 99.7%, rhythm 100%, lyric syllables 95% in the browser (98% native Audiveris; was 37% before patch 0004 + the darker binarization — the rest are one-letter OCR slips like `ly`→`y`). Synthetic scores (Amazing Grace, Oh Susanna, Greensleeves, rendered with Verovio) are 93–100% lyrics, 100% notes. Audiveris also drops "rhythm-slash" multi-bar rests, and repeats aren't expanded by the Sing page.
- **First-run download** ≈ 60 MB (CheerpJ runtime ~24 MB from its CDN, jars ~18 MB, OCR ~16 MB); ~6 min for 6 pages in desktop Chromium.
- **One conversion per page load** (Audiveris global state); "Convert another" reloads.
- **Speed:** ~1 min/page in desktop Chromium once warm; phones slower. Step timeout raised to 2 h.
- **Never commit test scores** (e.g. the user's licensed Musicnotes PDF) — test from outside the repo (`/home/user/sitetest` symlinks `public/` as `/resonate/`).
