# Resonate on one page: the final redesign (round 2)

The owner asked for two things. First, the account sits in a corner. Second, **one panel, one page**. The tuner is the home screen. A **Songs** button in the bottom right opens a custom song list with **Add**. An import runs in the background as the Reader animation, which you can dismiss and bring back. Choosing a song brings in **stacked modules** under the tuner (the singing track and the score, with the score's own keyboard), and the tuner gets smaller as they stack. Settings stay hidden until they're needed.

This spec merges three designs (A "The Instrument", B "Studio", C "Next Step") and three judges, then applies two rounds of adversarial critique:
- **Base: Design A.** The shell, the song list, the import capsule and ring, the avatar, the worded add row, bottom sheets on the phone, the single ■ Stop rule, controls that go inert while busy, and the visual system.
- **From B:** the iPad music desk, honest mic words, the import kept inside the dock, the song panel with fit-grouped key chips, and the engineering contract.
- **From C:** the coach line with the step's alternative as a pill, settings suggested in context, the home Next-up card, tap-the-small-tuner-to-grow, a fixed module order, and silent presses during a take.

**What round 2 changed.** §23 has every finding and what was done with it. The main changes:
1. The phone opens a song with **Sing alone**. The lane is 353×310, about today's height; the round-1 default gave it 178. The Score is one tap away (`+ Score`).
2. **The Score follows the song's key.** On paper, under a press and in ▶ it plays what the lane shows. The tune's octave goes into its clef.
3. **The keyboard belongs to the Score.** It is a band at the Score's foot with one 🎹 toggle, display only, and no longer a third module.
4. **The tuner follows a policy table.** It yields per sound and takes one lease per practice block. It knows the audio route, parks after 60 s of silence, and a score press sets its target. The P0 device spike picks the row.
5. **Sign out and Change password stay on `account.html`.**
6. **The build plan ships the shell as a preview** (`shell.html`) while today's pages stay untouched. It switches over in one release (P6) instead of four hybrid releases.
7. **The mockup was redone and every shot is checked.** No horizontal scroll; every control is ≥ 44 × 44; text contrast is ≥ 4.5:1 (`--text-3` went from 3.6:1 to 5.9:1). A fourth viewport, iPhone Safari with its toolbars (393 × 659), is added.

**Mockup:** `final/index.html?state=<name>`. Serve the folder with `cd final && python3 -m http.server 8124`.
- A state switcher sits at the top; `&shot=1` hides it.
- `&safari=1` shows Safari with its toolbars: no safe areas inside the page.
- Every `data-go` control clicks through to the next state.
- **What is real:**
  - The melody is Amazing Grace, from the Sing page's own parse.
  - Every sheet of music is **Play's own Verovio page**, captured at each Score region's exact size (`tools/paper.cjs` against the running site). Its MusicXML is transposed on the way in, the way the shell will do it (§6.2): the Melody view carries a treble-8vb clef, and the Full score shows "sung 8vb" over the tune's staff.
  - The import tray shows **`public/omr/reader.js` itself**, replayed from its Greensleeves fixture (`tools/reader.cjs`).
- **What is fake:** everything else.
- **Safe areas are real:** iPhone 54 px top and 34 px bottom (a Home Screen app on an iPhone 15 Pro), iPad 24 / 20. Every height below includes them unless it says otherwise.

**Screenshots:** `final/shots/<state>-{iphone,ipad-portrait,ipad-landscape}.png`, 20 states × 3 devices. Six more, `<state>-iphone-safari.png`, cover the states a singer meets: home, song-1mod, song-2mod, singing, desk, settings-in-context. Contact sheets are in `final/tools/contact-*.png`.

Tools:
- `tools/shots.cjs`: every state, with checks that fail the run:
  - no horizontal scroll;
  - the avatar and Songs on screen;
  - nothing overflowing the top bar;
  - **every visible, uncovered control ≥ 44 × 44**;
  - **every visible text ≥ 4.5:1** against what is behind it (3:1 from 24 px).

  All 66 shots pass.
- `tools/measure.cjs`: the region sizes quoted here.
- `tools/paper.cjs`, `tools/reader.cjs`.
- `tools/today.cjs`: today's Play stage, the baseline.

---

## 1. The rules, in the owner's words, made testable

| # | Rule | What it means in the build |
|---|---|---|
| R1 | "Account … always visible in the corner … a profile symbol or the first letter" | The **avatar** is top right in every state on every device, above every scrim. It shows the email's initial, or a person glyph when signed out. `shellchrome.cjs` checks it is on screen at 375 / 390 / 744 / 820 / 1180 px, and at 393 × 659 (Safari) |
| R2 | "As a rule, only a single panel, a single page" | One document. Nothing navigates except to `account.html` (sign in, sign out, password, email links), `oauth/consent.html` and `audiotest.html`, which must stay real pages (§19.6). Back closes the topmost sheet, then the song (§19.10) |
| R3 | "The core of the app is the tuner … the starting page" | A fresh launch opens the full tuner. With a song open, the tuner never disappears: docked, a strip, or a mic chip in the Score's bar. Tapping a small tuner (anywhere but its mic button) drops the full tuner over the song. It listens whenever that doesn't cost sound quality (§9.3) |
| R4 | "A button … bottom right … for loading a song … a song list, some nice custom thing … an add button" | **Songs** is always bottom right, including on the desk (at the keyboard's right end). It opens the custom list with **+ Add** |
| R5 | "If you upload something, that will go off in the background … the animation … that you could dismiss and bring back up" | A PDF goes to the **Reader tray**. ⌄ folds it into the dock beside Songs, never over the music; ✕ leaves a ring on Songs; **Stop reading** ends it. It is never lost and never switches the open song by itself |
| R6 | "Modular components … stacked … the tuner would get smaller" | **Sing · Score** stack in a fixed order, and the Score carries its own keyboard (🎹). The tuner's size depends only on which modules are on, so it changes in steps and never while anything plays |
| R7 | "Settings … show them as they're needed … hidden and then open up" | No settings page. Each setting lives on the thing it changes: a chip, a module's ⋯, the song panel, or a one-tap suggestion |
| R8 (standing) | Coach, don't grade; few words; everything works signed out | No percentages, counts or red anywhere, the Tuner included. Short labels. Signed out loses only sync and assistants |

---

## 2. Decisions, with reasons

Where the designs, the judges or the critics disagreed, this is what the final design does and why. Round-2 changes are marked **(r2)**.

| # | Decision | Why |
|---|---|---|
| D1 | **A's shell**: a fixed viewport with four bands (top bar · tuner · stack · dock) and one overlay layer. Nothing scrolls the page | The owner's "single panel". Lists scroll inside their sheets |
| D2 | **(r2) Defaults per device class, remembered as a device pref** (`resonate.shell.modules`): **the iPhone opens a song with Sing alone**; **the iPad opens the desk** (the Score alone, with its keyboard). Sing or the Score is one tap away (`+ Score`, layers). The Next-up card always opens Sing, because it advertises a singing step | Measured: Sing + a Melody score left the phone's lane at 178 px to show two bars of what the lane already draws. Sing alone gives 353×310, close to today's ≈ 340. The iPad lives on the piano |
| D3 | **At most two modules expanded on a phone, and a module that can't reach its minimum opens folded** (lane ≥ 150 px; Score ≥ one system ≈ 130 px). A user who adds the Score next to Sing gets Sing 300 (lane 172) plus one system; the Score folds only under the minimum | Safari's toolbars (393 × 659) fold the Score in `song-2mod-iphone-safari.png`. Keeping a 300 px lane on every phone stack would mean the Score could never sit next to Sing on a phone, against the owner's stacking request |
| D4 | **(r2) Fixed order Sing → Score; the keyboard is the Score's own band** (🎹), not a module | One on/off control (critique: there were three). The keyboard lights what the Score sounds, so it belongs under it |
| D5 | **The Score is full-bleed paper on a tablet, and on a phone when it is alone**, at Play's printed density (90 staff spaces across the region's width) | The width is what sets the density, so full width keeps today's calibration |
| D6 | **(r2) The desk is what Score-only looks like on a tablet, not a mode.** All the chrome folds into one 56 px bar; the keyboard owns the bottom edge with Songs at its right end. Its stage is **not** today's: paper 820×962 with safe areas (today's 820×962 is measured *without* them, ≈ 918 on the device), 1180×634 in landscape (today ≈ 632 with them). The Play suites are **re-baselined on purpose** (§21 P5) | The round-1 spec promised both "bigger than today" and "within 2 px of today". The gain is the point, so the baselines move and the owner checks his five songs' page counts |
| D7 | **Tuner forms are a pure function of (device, which modules are on)**: full · docked · strip · mic chip. Its mic button listens or parks; the rest of a small form drops the full tuner as a sheet over the song (with its own mic button) | Play lays its page out to the region's exact size, so sizes change only at deliberate moments. The drop is an overlay and causes no relayout |
| D8 | **Mic states in words**: "paused while ▶ plays", "parked · tap to listen", "take". The sounding note shows in cream with a speaker glyph | A visible reason makes the yield look intentional, not flaky |
| D9 | **(r2) The tuner's listening policy is a table chosen by the P0 device spike** (§9.3), not "park whenever the Score leads". Default for a built-in speaker: yield per sound and reopen 300 ms after (Sing's 🎤 Pitch rules); park on bursts of presses, while ▶ runs, after 60 s of silence, and on headphones or the car after any sound | The round-1 rule muted the readout for 2 min after one score press and showed nothing on the iPad by default. "Press a note, sing it, see how close" must work from the music |
| D10 | **(r2) Who owns the dock is visible.** Sing owns it whenever Sing is on, expanded or folded: the coach line and its primary. Otherwise the Score owns it (‹ › ▶ Songs on the phone, the desk bar on a tablet). **The Score's head shows ▶ and the pager only while Sing owns the dock**, and on a phone not even then, because a stacked phone Score follows Sing's line. The head ▶ is **named by what it plays** ("▶ Score", "▶ Piano") and becomes ■ while playing; it is left out of the Melody view while Sing is on, because Listen plays the melody | The round-1 screens showed two ▶ and two pagers at once |
| D11 | **The primary always becomes ■ Stop** while anything runs: red for a take or loop round, brand colour for playback. Listen and Songs dim but stay tappable | Recovery is always in one place |
| D12 | **(r2) The coach line** = C's card folded into one fixed **two-line box**: `✓ win · one cue [▶ 44] [alt pill] More ›`. Longer text ends in "…" and opens whole on a tap. Its height never changes | A box that grew with its text would relayout the Score between rounds (and `clearPeek()` held notes) |
| D13 | **Suggestions in context**: when the song sits outside the voice's comfortable range, the idle coach line reads `Sits high · 8vb fits Dave [Try 8vb]`. With Guide me off there is no coach line, so a dot on the Sing head's key chip carries it, and a tap opens the song panel with the suggestion on top | "Show them as they're needed", in both modes |
| D14 | **One song panel** holds this song's settings: key chips grouped by fit; tempo with **Steady \| Tapped** and a stepper, plus Tap… / Type… / Tap along… / Forget; verse; ⤓; PDF; Close song. It opens from the title, the Sing head's chips or a suggestion. A module's ⋯ holds only how that module behaves | Key and tempo belong to the song: every module follows them |
| D15 | **Layers in words.** Phone and iPad portrait: one 44 px button (stack icon, a dot per module, and on the iPad the words "Sing · Score") that opens a popover with two switches plus the keyboard as a sub-row. ≥ 1024 px: two worded toggles. Under a lone Sing: `+ Score` | Discoverable, ≥ 44 px, and fits a 393 px top bar |
| D16 | **(r2) The import never covers content and never sits in the coach line.** Minimized, it is a row on the phone home, a 48 px tile beside Songs in every other phone or iPad-portrait view, and a pill beside Songs in landscape and on the desk. ✕ leaves a ring on Songs | The coach box is fixed (D12) and doesn't exist with Guide me off |
| D17 | **(r2) Sign in, Sign out and Change password stay on `account.html`**, a real page restyled to the tokens that returns to the open song. The shell **loads supabase-js only when signed in**, as `sync.js` and `assist.js` already do today, and never signed out | Sign out's order (sync → warn → stop the sync → `leave(uid)` → `signOut`, under the sync's Web Lock) and the link flows live in account.js. Round 1 said "the shell never loads supabase-js" yet put Sign out inline: both can't be true |
| D18 | **Home = the full tuner + the Next-up card** (the last song, its map, its next step in the coach's words, ▶ straight into Sing) | "What now?" in one tap, without leaving the tuner |
| D19 | **Keep Sing's and Play's own transports in v1**: Listen and the Score's ▶ stay separate but labelled; Play keeps its speed; Sing keeps Voice / Melody / Both and the optional Note keys row | Each merge rewrites tested code and needs the owner's say (§20) |
| D20 | **A take keeps its own context** (`openMic()` per take: mic + clicks + guide on one clock). The tuner only mirrors its frames ("lent") | A long-lived capture context would carry a stale rate after a route change |
| D21 | **During a take nothing else sounds.** Score presses still show the peek but are silent ("Plays after your turn", one hint per take). Listen, ▶ and keys are disabled. pdf.js rendering on the main thread is held; on a phone the OCR engine waits too (§11) | Keeps grading, rhythm and pitch frames clean |
| D22 | **(r2) Perform is a curtain, not a relayout**: an opaque cover over Sing (big lyrics, the count-in number) **and over the Score**, and the tuner shows only "take" and its level line, with no note | Perform's point is singing without watching the pitch. Round 1 left the tuner and the follow band giving live feedback |
| D23 | **Mockups sized with real safe areas, plus Safari's 393 × 659** | Honest heights |
| D24 | **(r2) The Score follows the song's key.** The view's MusicXML is transposed with Sing's own spelling. The tune's octave goes into its clef when it has a staff of its own (a treble-8vb clef, as a tenor line is printed), else into a "sung 8vb" mark over its staff. So the paper, the names, a press, ▶ and the keyboard all match the lane. Score ⋯ → Key: **as sung** (default) / **as written** | Round 1 shipped a score that played an octave, or a different note, away from the lane the moment you pressed it |
| D25 | **(r2) Practice blocks hold one lease**: a loop, a guided block, a run or Hear it keeps the mic lent from its first round to its end; the tuner shows "take" between rounds | No playback ↔ play-and-record flips per round (v56–57 and v62 lived on such flips) |
| D26 | **(r2) Build the shell as a preview** (`shell.html`, linked from Tools) from P3 to P5, then switch over in one release (P6). Today's pages stay untouched until then | No four releases of hybrids; the old suites keep testing the old pages until the switch |
| D27 | **(r2) The 📡 remote handler lives in the shell** (P4): a command that needs Sing opens it when nothing is busy, else answers "busy"; on home with no song only `open_song` works. The Remote switch shows only where commands are answered | Round 1 had no answer for the iPad's desk or home |

---

## 3. The page

One fixed viewport, `100dvh`. Four bands, plus overlays.

| Band | iPhone 393×852 | iPad portrait 820×1180 | iPad landscape 1180×820 | Holds |
|---|---|---|---|---|
| Safe top | 54 | 24 | 24 | status bar |
| **Top bar** | 52 | 68 (56 on the desk) | 64 (56 on the desk) | left: the brand mark (home) + the song pill (title ▾ → song panel), or "Resonate" on home. Middle (tablet): the tuner strip. Right: layers · assistant chip · `v80` · **avatar** |
| **Tuner** | full / strip 52 / docked 120 (a Take) / mic chip in the Score's bar | full / docked 150 / in the bar | same as portrait | §5 |
| **Stack** | the rest | the rest; the Score full-bleed | two columns (Sing 420 · Score) | §6 |
| **Dock** | 188 with the coach line, else 120 | 116 | 116 | §8; the desk has none (the keyboard is the bottom edge) |
| Safe bottom | 34 | 20 | 20 | home indicator |

**Z-scale** (one for everything):
- module overlays (selbar, bubble, follow band): 5
- the keyboard band: 10
- dock: 20
- scrim: 40
- sheets and popovers: 45–50
- top bar and avatar: 46–60, above every scrim
- **get-ready countdown: 65**, above the top bar, so a take is never started under an open menu
- takeovers (range test, calibration): 100

**Region sizes, measured in the mockup** (`tools/measure.cjs`; safe areas included):

| State | iPhone | iPhone Safari 393×659 | iPad portrait | iPad landscape |
|---|---|---|---|---|
| Sing alone (`song-1mod`, the phone default) | strip · lane **353×310** · dock 188 | lane 353×205 | docked 150 · lane 764×609 | docked 150 · lane 1124×258 |
| Sing + Score (`song-2mod`) | Sing 300 (lane 172) · Score 369×140 (one system, Melody) | **Score folded** (one system would get ~109 px) | Sing 360 (lane 219) · Score 820×554 | Sing 420×616 (lane 404×480) · Score 730×566 |
| + 🎹 (`song-3mod`) | Sing folded 63 · Score 369×301 · keys 76 | Score 369×196 · keys 76 | Sing 300 (lane 159) · Score 820×502 · keys 112 | Score 730×454 · keys 112 |
| Score alone (`desk`) | paper **393×578** (Full score, 1/5 pages) · dock 120 | paper 393×473 | paper **820×962** · keys 138 (incl. safe 20) | paper **1180×634** · keys 106 |
| today, for comparison | Sing lane 361×426, Play 393×705 (no safe areas; ≈ 340 / 617 with them) | — | Play 820×962 (no safe areas; ≈ 918 with) | Play 1180×676 (≈ 632 with) |

The honest cost: a phone Score alone is about 39 px shorter than today's Play (the Score's 48 px bar holds the view, names, mic chip and 🎹). In exchange, the phone's Sing is as tall as today's and the iPad desk is taller.

---

## 4. States in the mockup

| State | iPhone | iPad portrait | iPad landscape |
|---|---|---|---|
| **home** | Full tuner: range ribbon (Dave C3–E4, a marker at the sung note), arc gauge ±50¢ with no red, a 124 px gradient note (96 in Safari), cents, level 1–10 with ⚙, waveform. Then the **Next-up** card. Dock: ● Record · 🎤 Listening (the main button; Start when off) · Songs | Same, with a 190 px note and the card centred | Same, 156 px note |
| **song-list** | A bottom sheet at 90% height: Songs + Add, search, Recent cards (melody-contour art), My songs (the reading row first, with ⌃ and ⋯ → Stop reading), Samples | A 440 px popover above Songs | Same |
| **song-add** | Add menu: PDF "read in the background" · MusicXML · Link | Same | Same |
| **song-1mod** (Sing alone; the phone's default) | ◎ brand + song pill · strip (practice note A♭3) · Sing (lane 353×310) · `+ Score` · coach "Hear it first [I know it] More" · ▶ Hear it | Docked tuner 150 · Sing | Same |
| **song-2mod** (Sing + Score) | Strip · Sing 300 · Score (Melody with a treble-8vb clef, one system, following Sing's line; no ▶ or pager in its head) · coach `✓ "grace" right on C4 · hold "sound" full length [▶]` · ● Again | Strip in the bar · Sing 360 · full-bleed Full score with "sung 8vb" · head: Full score ▾ · ABC Some · **▶ Score** · ‹ 1/2 › · ⤢ · 🎹 · ⋯ · ⌃ | Two columns |
| **song-3mod** (+ 🎹) | Sing **folded** (head + map) · Score (Melody) with the keyboard band (C3–B4, the practice note E♭4 outlined, the sung note's dot) · secured coach line · ● Sing on | Sing 300 · Score · keyboard band | Sing left · Score + keyboard right |
| **singing** | Sing alone during a take: the strip turns red ("take"), the lane draws your pitch, coach `● Your turn · round 2`, ■ Stop (red); Listen and Songs dimmed | Sing + Score: the Score follows (a yellow band on the bar being sung) and shows "Plays after your turn" | Same |
| **playing** | The phone desk playing: Full score ▶ looping a dragged stretch; its controls carry what ▶ plays (Voice struck through, Piano), because the keyboard is off on a phone; the mic chip shows E♭4 in cream; dock ‹ 1/5 › · ■ Stop · Songs | **The desk playing**: bar ‹ › ■ 🎹, the mic chip with the cream note, paper, keys lit by hand with Voice / Piano at the left and Songs at the right | Same, with − / + in the bar |
| **desk** | The phone desk: Score alone, full-bleed; its bar: Full score ▾ · A·C · mic chip (parked) · 🎹 · ⋯; dock ‹ › · ▶ Play · Songs | One bar: ◎ · song · Full score ▾ · **A·C fewer?** (the fewer-names offer, due) · mic chip · ‹ 1/1 › · ▶ · 🎹 · ⋯ · layers · v80 · avatar; the paper; the keyboard; Songs | Same + **− / +**, and the offer inline: "Fewer names? Some · Off ✕" |
| **importing-expanded** | The real Reader as a bottom sheet over home | A panel above the dock, with **Stop reading** under it | The Reader's two-column layout, 1040 wide, Stop reading under it |
| **importing-mini** | Over Sing: a 48 px tile (page thumbnail, ring, `2/3`) **beside Songs** | Tile beside Songs | Pill beside Songs: "Greensleeves · 2/3 · bars · ~1 min ⌃ ✕" |
| **import-done** | A dock row "✓ Greensleeves · ready · 3 pages [Open] ✕"; a green ring on Songs | Pill | Pill |
| **account-menu** | Sheet: the avatar, email, "Cloud on · synced"; Voice · Find my range · Mic level; Remote · Sync this device · Assistants; Tools · **Account ↗** (password · sign out, on its page); "Resonate v80". The avatar's ring carries the 📡 glyph; the bar keeps the assistant's name ("ChatGPT", truncated on a phone) | A 380 px popover under the avatar | Same |
| **signed-out** | Person glyph; "Not signed in · Everything works signed out" · Sign in · Voice · Find my range · Mic level · Tools | Popover | Popover |
| **settings-in-context** | The coach suggests `Sits high · 8vb fits Dave [Try 8vb]`, and the **song panel** is open: fact line, Key (Fits Dave / Close / All keys ›), Tempo (**Steady \| Tapped ♩≈76** · − ♩80 + · Tap… · Type… · Tap along… · Forget), MusicXML · PDF · Close song | Hangs from the title; the coach line stays visible | Same |
| **sing-options** | Sing ⋯: While you sing Practice / Perform · Guide me · Guide Click / Melody / Off · Note keys | Same | Same |
| **layers** | Popover "Show": Sing / Score switches, and the Keyboard as a sub-row (disabled on a phone while Sing is expanded: "under the Score, with Sing folded") · "Kept for this iPhone" | Same · "Kept for this iPad" | Same |
| **tuner-drop** | The full tuner dropped under the top bar over the song, with **its own mic button** ("Listening") | A 640 px drop | Same |
| **take** | ● Record from home: docked tuner (red, lent) · Take module (live roll; transcript chips with note, **length and cents**, `E♭3 0.41s +3¢`) · ■ Stop | Same | Same |
| **review** | After a free take (Guide me off): the after-take row in Sing and the Review sheet (headline, ✓ wins, Try next, Every line). **"▶ plays: You \| Melody \| Both"** once in the head, one ▶ and ⟳ per line, and a mark only for a win (✓ or ↑) | A 520 px panel at the right | Same |

---

## 5. The tuner

One component (`tuner.js`) with four forms. **Its form is recomputed only when a song opens or closes, a module is turned on, off or folded, the window's size class changes, or the device rotates.** It never changes because something plays, records, or the mic changes state.

| Modules on | Phone | iPad portrait | iPad landscape / desktop |
|---|---|---|---|
| none (home) | **Full** | **Full** | **Full** |
| Sing alone | **Strip** 52 | **Docked** 150 | **Docked** 150 |
| Sing (expanded or folded) + Score | **Strip** 52 | **Strip in the top bar** | **Strip in the bar** |
| A Take (Record) | **Docked** 120 | **Docked** 150 | **Docked** 150 |
| Score alone | **Mic chip in the Score's bar** | **Mic chip in the desk bar** | same |

- **Full:** range ribbon (the active profile's limits and comfortable band, a marker at the sung note; tap → Voice) · arc gauge ±50¢ (green zone ±5¢; needle dot green ≤ 5¢, purple ≤ 20¢, amber beyond; **no red**) · the note in the brand gradient · cents · level 1–10 when calibrated, with its ⚙ (the one calibration) · waveform · the Next-up card on home. In a short window (≤ 720 px tall on a phone) the note is 96 px and the waveform 52 px.
- **Docked:** the note (62 / 88 px) · "◎ Practice note A♭3" when a module sets a target · a ±50¢ bar (green zone ±25¢ against a target, else ±5¢) · cents plus a 4 px level line · the round mic button · a faint waveform edge.
- **Strip:** mic button (a fixed 44 px; the cents bar gives way first) · note · cents bar · cents · target chip `◎ C4` · the state word.
- **Mic chip:** the 44 px mic button, plus the note it last heard (dim), or the sounding note in cream while ▶ plays.
- **Two gestures, split:**
  - **the mic button listens or parks;**
  - the rest of a small form drops the full tuner as a sheet under the top bar (gauge, level, waveform, and its own mic button). Tap or swipe up to close. It is an overlay, so nothing relayouts.
- **Target:** a press on the Score or the keyboard, a Sing note key, or Sing's due note sets ◎ (a chord: its top note). Colours against a target (Sing's thresholds): ≤ 25¢ green, ≤ 50¢ purple, beyond amber with ↑/↓. Without a target: green ≤ 5¢, purple ≤ 20¢, amber beyond.
- **Perform takes:** the tuner shows only "take" and its level line; no note, no cents (D22).
- **Mic states** (when each applies: §9.3):

| State | Button | Words / note |
|---|---|---|
| off | grey mic | `—`; home's main button reads **Start**. Nothing opens the mic at load (iOS asks once per page load) |
| listening | gradient + ring | live note |
| **paused** | 🔈 in a cream outline | the **sounding** note in cream · "paused while ▶ plays" |
| **parked** | ‖ grey | "parked · tap to listen" (strip) / ‖ and the last heard note, dim (chip) |
| **lent** | red mic | "take", the take's frames (between a block's rounds: the last round's) |
| quiet | mic off | "off for tap-along" (no sound, no mic: other apps' music keeps playing) |
| blocked | slashed mic | "Allow the mic: aA → Website Settings → Microphone" (shown after the reset, as tunerfix.cjs expects) |
| no answer | grey, Start re-enabled | "Mic not answering — tap again" (the 8 s watchdog, `startGen`) |

---

## 6. Modules

Each module is a card with a **48 px head (50 on a tablet)**. Every chip in it has a 44 px box: the pill is drawn 34 px tall inside a transparent border, so it looks light and still takes a finger.

`[icon] Name  [contextual chips…]  ·····  [⋯] [⌃ fold]`

### 6.1 Sing (today's Sing page)

- **Body:** phrase map (outline → ♩ → ♪ → ✓, no numbers) · lyrics (current line, current syllable yellow, sung syllables coloured, next line dim) · **lane** (semitone rows, bars with syllables, now line at 30%, your pitch, practice-note row) · an optional Note keys row (Sing's chips as piano keys; Sing ⋯) · after a free take, the after-take row (▶ Play · Voice / Melody / Both · Review · ⟳ Loop line), all 44 px.
- **Head:** key chip `A♭ 8vb ▾` and tempo chip `♩80 ▾` (both open the song panel; the key chip carries the suggestion dot of D13 with Guide me off) · ⋯ · ⌃.
- **Folded:** the head with a mono summary (`A♭ 8vb · ♩80 · line 3`, and `· sung 8vb` when the last take was sung in another octave), plus the map. It keeps owning the dock.
- **Heights:** alone it grows. With the Score: phone 300, iPad portrait 360 (300 with 🎹), landscape the left column (420). **Minimum: lane 150.**

### 6.2 Score (today's Play)

- **Body:** Play's paper, laid out to the region's exact size: name pills, presses (sound before sight), a drag picks a stretch → ▶ ⟳ speed ✕ (with what ▶ plays when the keyboard is off), bubble, auto-turn, and a follow band while Sing plays or records.
- **Head** (D10):
  - tablet, Sing on: view chip · `ABC Some` · **▶ named by what it plays** · ‹ 1/2 › · ⤢ (Score only) · 🎹 · ⋯ · ⌃;
  - phone, Sing on: view chip · (▶ named, except in the Melody view) · 🎹 · ⋯ · ⌃. No pager: it **follows Sing's line** (the line the lyrics show, which a lane drag, a line tap or a take moves);
  - Score alone, on a phone: view chip · A·C · the mic chip · 🎹 · ⋯ (no fold, no ▶; the dock has ‹ › ▶);
  - the desk: §7.
- **The song's key (D24):**
  - `buildView` transposes the view's MusicXML with Sing's own `transposeKey` / `spellTransposed`: the key's interval and the letter count Sing uses. So C minor +2 is D minor, and the paper spells notes as Sing's chips do. `playnames`' facts, the peek, `playtime` and the keyboard all read that XML, so they agree with no extra plumbing. The mockup's paper was made this way.
  - **The octave** goes into the tune's clef when the tune has a staff of its own: a treble-8vb clef, as a tenor line is printed, with its pitches an octave down; the piano stays where it is written. When the tune shares a staff (a hymn's S/A, the tune inside the piano), a "sung 8vb" direction is added over that staff and the tune's own notes sound an octave down.
  - A split fit (phrases in other octaves) draws at the key's shift; each moved phrase gets an `8vb` / `8va` mark over its first bar and sounds where the lane is.
  - Verovio's own `transpose` option is the fallback if a case can't be respelled.
  - **Score ⋯ → Key: as sung / as written**, per song, default as sung. "As written" reads the printed page in its key: a press then sounds the written note, and a small tag `written key` sits in the head.
- **Heights:** grows; full-bleed on a tablet and when alone on a phone. **Minimum: one system** (about 130 px for the Melody view on a phone).

### 6.3 The keyboard (🎹: Play's v80 dock, now the Score's band)

- A band at the Score's foot: the view's range in whole octaves, the middle-C dot, lit by presses and ▶ (hand colours), Sing's practice / due note (yellow outline), the sung note (a dot in the tuner's colour), and Listen.
- It takes **no touch**: `#strip` stays `pointer-events: none`, as in v80. Pressable keys are §20.
- **What ▶ plays** chips sit at its left end. On the desk, Songs (and a minimized import) sit at its right end.
- **One control:** 🎹 in the Score's head or the desk bar (`aria-pressed`), mirrored as the Keyboard sub-row of the layers popover. Device pref `resonate.play.keys`, as v80: on for a tablet or desktop, off on a phone.
- **On a phone with Sing expanded, 🎹 is refused** with a one-line hint ("Fold Sing for the keys"). It never folds anything by itself. With Sing folded or off it shows (`song-3mod-iphone.png`).
- Height `clamp(56px, 9vh, 110px)` on the desk (v80's rule); 112 / 76 px in a stack.

### 6.4 Take (today's Record page)

- **Body:** live piano roll (cents colours, no red) · transcript chips (note, length and cents, as today) · after Stop: ▶ Voice / Notes / Both.
- **Head:** timer · ⋯ (♯/♭, Copy) · ✕. It grows; it opens from ● Record on home.

### 6.5 Shared rules

- **Layers:** one control (D15) turns Sing and the Score on and off. Under a lone Sing: `+ Score`.
- **Fold ⌃:** the card folds to its head with a mono summary. A tap on the head expands it.
- **Phone:** two expanded at most (D3); the minimum rule folds a module that can't get its minimum.
- **Inert while busy:** during a take, a loop, a guided block or ▶, the layer switches, ⌃, ⤢ and 🎹 are dimmed and inert. Nothing relayouts the Score mid-take, by construction.
- **Pedal keys** (arrows, PgUp / PgDn, Space / Enter, Shift+Space, Backspace) turn the Score's pages **whenever the Score is expanded** and no field, menu or sheet has focus. After a sheet or popover closes from a **tap**, focus goes to the Score's root, not back to the opener: Play's handler leaves Space / Enter to a focused button (play.js:848–861), so returning focus there would make the next pedal press reopen the menu. After a **keyboard** close (the last input was a key), focus returns to the opener. On a desktop, Space is the primary only when no Score is shown.

---

## 7. The desk (iPad on the piano)

When the Score is the only module on a tablet or desktop:

- **One 56 px bar:** ◎ (home) · song pill · view ▾ · names `A·C` · mic chip · ‹ page › · ▶/■ · **🎹** · ⋯ · layers · `v80` · avatar. At ≥ 1024 px it also holds **− / +** (size steps from the printed default).
  - Measured to fit at 820 and 1180 px with the offer showing (the mockup's overflow and 44 px checks pass).
  - Under 820 (an iPad mini at 744) the song pill gives way first (it ellipsizes to a 60 px minimum), then `A·C` moves into ⋯ (never the offer).
- **The fewer-names offer** (Play's fading: three practice days at a level) **is on the bar, never inside ⋯**. Under 1024 px it is a chip in A·C's slot, `A·C fewer?` with a dot, which opens "Fewer names? Some · Off · Later". At ≥ 1024 it shows inline: "Fewer names? [Some] [Off] ✕". `playfixes` gains a check that it is visible on the desk at 744, 820 and 1180.
- **Score ⋯:** Names All / Some / Off · Size (under 1024 px it turns the bar's middle into an inline stepper "− default + Done", so the paper stays in view while sizing) · Key as sung / as written · 📄 Original PDF.
- **The paper** at the region's exact size. **The keyboard** (never moving or hiding) has the what-▶-plays chips at its left end and **Songs** (plus a minimized import) at its right end, so Songs stays bottom right. Songs costs the keyboard about 70 px of width (about 10% narrower white keys on an Air in portrait), well above `KEY_MIN` 8 px. `placeHear` / `playv80fixes K` run again with Songs in place.
- **The tuner:** the mic chip, parked by default (§9.3). One tap starts a listening session that survives single presses (yield and reopen, as Sing's 🎤 Pitch), parks again on a burst of playing, and ends after 60 s of silence.
- **No coach here;** the coach lives with Sing. To sing from the desk, turn Sing on (layers), or use the Next-up card on home, which always opens Sing.

---

## 8. The dock and the transport

| Who owns it | Dock |
|---|---|
| Home | ● Record · **🎤 Listening / Start** · Songs |
| Sing on (guided, the default) | the coach line, then ▶ Listen · **the step's primary** (▶ Hear it / ● Go / ● Again / ● Sing on / ✓ Yes) · [import tile] · Songs |
| Sing on, Guide me off | ▶ Listen · **● Sing** (or ● Perform) · [import tile] · Songs; after a take, the after-take row inside Sing |
| Score alone on a phone | ‹ 1/5 › · **▶ Play** · [tile] · Songs |
| Desk (tablet) | no dock: the bar has ‹ › ▶, the keyboard's right end has Songs |
| Take | ▶ Play (after Stop) · **■ Stop / ● Record again** · Songs |

**The coach line** (`role=status`, updated once per round; a fixed two-line box, D12):
- **Idle:** the step or phrase · the alternative pill (`I know it`, `Try 8vb`, `Got it ✓`) · More ›.
- **After a round:** `✓ "grace" right on C4` (green) · at most one cue, `hold "sound" full length` (cream), with its ▶ (44 px; it plays the note or the phrase).
- **Secured:** a green glow, `✓ "Amazing grace…" in time · in tune`, and the map segment pulses once.
- **Running:** `● Your turn · round 2` (red-tinted, no More).
- Text that doesn't fit ends in "…" and opens whole on a tap. `stack.cjs` checks that no coach text changes any module's box.

There is no score, no %, no red, and no fault on unsure data (coach.js rules, unchanged). **More ›** opens the More sheet: Other steps, Lines (♩ ♪ ✓, ▶ from here), Tools (Sing it through, Loop line, Last take, ⤓ Last round, Then → Now, Guide me off).

**Two transports, named:** Listen (the melody, with the lane and lyrics) and the Score's ▶ ("▶ Score" / "▶ Piano": what its hear chips leave on). The Score's ▶ is hidden in the Melody view while Sing is on.

**One sound at a time:** starting Listen, ● Sing, ▶, a loop or a guided step stops any other playback first (the shell transport, built from `playGen` / `stopSession`). Presses may sound over ▶, as Play allows today. A take disables everything that sounds except its own guide (D21).

---

## 9. Audio and the mic: how "always on the tuner" works on an iPhone

On iOS, while any mic track is open all output is quiet (earpiece or ducked; WebKit 196539, 218012, 230902). So "always on" means **the tuner listens when that costs nothing, and visibly yields when something sounds**. This is Sing's 🎤 Pitch monitor, generalised, under a policy the device spike chooses.

### 9.1 `audio.js`: the arbiter

- **It is the only setter of `navigator.audioSession.type`**: `play-and-record` before every `getUserMedia`; `playback` (through `auto` after a mic was open) before loud output; `auto` when idle and on `pagehide`.
- **OUT (the playback context) is never created while a capture track is live** (r2).
  - Created at song open when the tuner is off or parked (v80's `warmAudio`, the desk's case). Otherwise it is created in the first tap whose action makes sound (a press, Listen, ▶, Hear it), **after** the yield (tracks stopped → `auto` → `playback`).
  - The piano is decoded early on an `OfflineAudioContext` at 48 kHz, which opens no output path; `AudioBufferSourceNode` resamples those buffers on OUT at whatever rate OUT gets. The held tone's wave is primed when OUT is made (`primeHold`).
  - Why: WebKit fixes an output path's rate at creation, and an OUT born under play-and-record with AirPods would be a 16 / 24 kHz call-quality path for the life of a days-long document.
  - The first-tap unlock (session untouched) is skipped on the Sing button, the tap pads, a live take, **the tuner's Start and its mic button**.
- `getOut(how)` keeps v56–57's tap / press / auto semantics: a closed, interrupted or stuck context is replaced only in a touch.
- Also kept: `scheduleAhead` ≤ 5 s, one keep-awake source, the piano bus and limiter.
- **bfcache:** on `pageshow` with `persisted`, OUT is marked for re-creation in the next sound-making tap (it was closed on `pagehide`), the unlock is re-armed, and a paused import resumes.

### 9.2 `mic.js`: the listening stream and the leases

- The tuner's own `getUserMedia` stream (processing off, AnalyserNode fftSize 4096, `createReader`), the **frame bus** (one YIN per frame, ≤ 60 Hz), the 8 s watchdog and `startGen`.
- **Leases.** Capture leases: a take, a **practice block** (a loop, a guided block, a run, Hear it: one lease for the whole block, D25), Record, the range test, calibration. Output leases: ▶, Listen, line playback, reference notes. Then keys and presses, then tuner listening.
  - **A capture lease is refused while another capture is live**; only Stop ends one. In the account menu, Find my range and Mic level are disabled during a take ("after your take"), and a 📡 `sing` command answers "busy".
  - A capture lease lends the mic: the take keeps **its own `openMic()` context** (D20) and publishes its frames, which the tuner mirrors. Between a block's rounds the tuner shows "take" with the last round's frames and nothing flips.
- **The rule is "nothing starts on OUT while a capture track is live".** A take's own clicks and guide play on its own context, not OUT, so they're exempt by construction.

### 9.3 The listening policy (D9): a table the P0 spike picks a row from

**The default** (built-in speaker on iOS, P0 confirming that the mic reopens without a gesture and the speaker is back at full volume within ~100 ms):

| Situation | The tuner |
|---|---|
| A sound starts (a press, Listen, ▶, a reference note) | **yields**: tracks stop, `auto` → `playback`, then the sound; "paused while ▶ plays" with the cream note. It reopens 300 ms after the last sound ends and ignores the first 150 ms (Sing's monitor rules, generation tokens) |
| A **burst** of presses (≥ 3 strikes within 4 s) | **parks** until 3 s after the last lift, so there are no flips per press while playing |
| ▶ runs | paused for its whole length |
| A practice block runs | lent for its whole length (D25) |
| The Score leads (the desk, a phone Score alone) | **parked at open**, so the first touch sounds within v80's ~2.5 ms. One tap on the mic chip starts a session with the yield rules above |
| 60 s with no voiced frame | parked ("tap to listen"); this saves battery and heat and turns off the orange mic indicator |
| **Not the built-in speaker** (the input isn't the built-in mic by its label after permission, or OUT's `outputLatency` > 60 ms: AirPods, the car) | after any sound: **parked, never reopening by itself**. Each reopen would switch A2DP to HFP and lose the next sound's first second |
| A desktop (no `audioSession`, no touch) | yields too (echo cancellation is off, so the mic would read the speakers), but without session flips; it reopens at 300 ms |

**If P0 finds otherwise:**

| P0 finding | Policy | What the user sees |
|---|---|---|
| `getUserMedia` needs a gesture to reopen | park after every sound | "parked · tap to listen" after any sound; Sing still draws your pitch from takes |
| OUT goes `interrupted` after a playback ↔ play-and-record flip | park after the first sound in a session | presses stay instant; one tap to listen again |
| The speaker takes > 150 ms to reach full volume | as above while a module is on; the full tuner on home still yields per sound | the first note of a burst sounds full |
| A press while listening is > 10 ms slower than parked | the Score parks the tuner whenever it is expanded (round 1's D9) | the strip says "parked" with the Score open |
| `play-and-record` stops other apps' music (Safari or Home Screen) | unchanged (nothing listens at load; parked after 60 s), plus a one-time line on the first listen: "Music pauses while the mic listens" | — |

P2 ships the row the P0 numbers pick. Without a car or AirPods result yet, it ships "park after the first sound" on iOS. A Tools switch ("Tuner listens between sounds: on / off") is the kill switch the owner can reach on an iPhone.

- **Tap-along:** puts the arbiter in **quiet**.
- **📡 remote commands:** go through the same leases ("someone needs to tap the page once" still applies). §12.
- **Headphones:** later, a Tuner ⋯ option, "keep listening while it plays (headphones)", off by default.

---

## 10. Songs: the list, Add, the song panel

**The list** (Songs, bottom right): a bottom sheet (90% of the height) on a phone, a 440 px popover above the button on a tablet.
- **Head:** `Songs` + **+ Add**. Search filters titles, composers and file names.
- **Recent:** three cards, each with the song's own **melody contour** drawn like a tiny lane on a gradient seeded by the song id, the title, the key it's sung in, and its phrase map.
- **My songs:** rows with a source tile (PDF pink, MusicXML blue, sample purple), title, mono facts (`E♭ · ♩100 · fits ✓ · 2d`, `Fm · duet`), a mini map, and ⋯ (44 px).
  - The song being read is **first**, with its ring, `reading 2/3 · bars · ~1 min`, ⌃ (open the Reader) and ⋯ (Show · **Stop reading**).
  - A held song (the cloud is full) shows a cloud-off glyph. This is the only place, besides the Sign out warning, that held songs are mentioned (§12).
- **Samples:** the bundled songs. With a song open, it is pinned at the top with **Close song**.
- **A row's ⋯:** Open · ⤓ MusicXML (share sheet on touch devices) · 📄 Original PDF · Remove.
  - Remove asks inline ("Remove from this device? Remove · Keep"), never with `confirm()`.
  - It clears exactly what today's ✕ clears, plus the practice records (`resonate.sing.practice[id]`) and Play's (`resonate.play[id]`). The add / remove code moves out of sing.js into `song.js` (P4) with a test that the cleared keys are the same set.
- **+ Add**, one direct tap per row (iOS opens file pickers only from a direct tap):
  - **PDF** "read in the background": the picker, then the conversion goes to the tray and the sheet closes.
  - **MusicXML** ".musicxml · .mxl": no `accept` filter, today's format hints (.mscz / .mid / .sib → "use PDF"), then the song opens.
  - **Link:** a URL field at the **top** of the sheet (no `prompt()`); GitHub blob → raw, Dropbox → dl=1.
  - **Drag-and-drop** on a desktop: drop anywhere, and the sheet opens with its zone lit.

**Opening a song:** the device's modules (D2) at the song's last place. A song with no words leaves Sing off; Sing stays available with note names.

**The song panel** (the title pill, the Sing head's chips, More › Key, a suggestion): a bottom sheet on a phone, hanging from the title on a tablet.
- **Fact line:** `E♭4–E♭5 → E♭3–E♭4 · Dave C3–E4 ✓`.
- **Key:** chips grouped **Fits Dave** (green outline) · **Close** (purple) · **All keys ›**. All keys ›, i.e. `#key-select`, is today's full grouped `<select>`, splits included, kept visible in the panel because iOS's picker suits a long grouped list. Each chip shows the key and its sung range, and marks `same key` / `own · high`. Without a voice range: "Set your range ›" (→ the Voice panel). A suggestion's "Try 8vb" applies the first option of the menu's "Fits …" group (as `set_key {fit:true}` does).
- **Tempo:**
  - when the song has a tapped map, **Steady | Tapped** comes first: today's `r:` vs `m:` menu values. The stepper changes the % of whichever is chosen, and the label reads `♩80` or `♩≈58 tapped`;
  - − ♩80 + (Sing's 50–125% in steps; the score's tempo under it) · Tap… · Type… · Tap along… · Forget (when tapped);
  - **Type…** opens a small top-anchored field sheet, never a field near the keyboard (§19.3).
- **Verse:** only with ≥ 2 verses after unfolding.
- **Foot:** ⤓ MusicXML · 📄 PDF · Close song.

---

## 11. The background import (the Reader tray)

The shell mounts `omr/reader.js` (`mount(el, { minimized, onMinimize, onExpand }) → { push, load, minimize, expand, destroy, mode }`) into one **tray host**, and moves that host between two places: the tray (expanded) and the dock slot (minimized, D16). The importer (`omr/importer.js`, with its job store `omr/jobs.js`) drives it and resumes after a reload.

- **Expanded:** a phone bottom sheet (the Reader's own card, 393×732); a 760 px panel above the dock on an iPad in portrait; a 1040 px panel with the Reader's two-column layout in landscape. The Reader's own ⌄ minimizes it. Under it on a tablet: **Stop reading**.
- **Minimized:** the row, tile or pill of D16: page thumbnail, ring, `2/3 · bars · ~1 min`, ⌃, ✕.
- **✕ (hide):** a ring around Songs until it is done. The song list shows the reading row first.
- **Stop reading** (r2): in the Reader's Details (a reader.js addition), under the tablet panel, and in the reading row's ⋯.
  - It asks inline: "Stop reading Greensleeves? Stop · Keep reading".
  - It terminates the worker, drops the job from `omr/jobs.js` (a reload offers no Resume), and releases the wake lock and the `resonate-omr-engine` lock.
  - Today, leaving pdf-import.html was the only way out; a never-navigating shell needs a real one.
- **States** (the capsule and ring follow the Reader's own phases):
  - starting / downloading (~60 MB the first time): an indeterminate ring;
  - reading: fraction, page, step, ETA;
  - paused after a reload: ⏸ **Resume** (one tap; CheerpJ restarts and reads the current page again);
  - a page left out: an amber `!` (Details lists it);
  - failed: "couldn't read" + Copy log;
  - **done:** a green ✓ ring, `Greensleeves · ready · 3 pages [Open]`. Open opens it with the device's default modules. **The import never switches the open song by itself** (today's pdf-import silently sets `resonate.sing.song`).
- **Rules:**
  - one conversion at a time; a second PDF waits ("next");
  - the wake lock is held while reading;
  - `resonateBusy()` includes the conversion;
  - **during a take or a block, main-thread pdf.js rendering and binarization are held.** On a phone the OCR native (`WebOCR.recognizeGray`, async in JS) also holds its answer, so Java waits at its next text line and the CPU goes to YIN and the audio thread;
  - **on a phone, starting a conversion folds the Score and releases Verovio**: the toolkit *and* its Module are dropped so the WebAssembly heap can be collected (`tk.destroy()` alone frees C++ objects but never shrinks `WebAssembly.Memory`), with a one-line hint "Score folded while the PDF is read". Unfolding compiles it again;
  - **each conversion gets a fresh Worker**, `/files` is cleared between runs and the Web Lock is still held (proved in P0);
  - `?pdf=URL` still starts one (test hook).
- **Before P6** the tray exists only inside the shell preview. Today's pages keep nav.js's pill and pdf-import.html, and nothing auto-resumes a job on Sing or Play (§21).

---

## 12. The account corner

- **Avatar:** 34 px in a 44 px hit area, top right, above every scrim.
  - Signed in: the email's initial on the brand gradient. Signed out: a person glyph; supabase-js is never loaded (`savedUser()` only; account.cjs asserts it).
  - **Dot (r2):** green = cloud on and synced; **amber only for "waiting for approval" or a sync error that has lasted over a minute**; none = sync off or signed out. It is never amber for the debounce after an edit, and never for held songs, which show only in the song list and the Sign out warning.
  - **📡 Remote on:** a purple ring with the 📡 glyph on it, pulsing while an assistant acts (reduced motion respected).
- **Assistant chip:** for 2 min after an assistant's call, its logo and name sit left of `v80` (on a phone the name is truncated, never dropped), with a green dot pulsing for 15 s after each call.
- **Menu:** a sheet on a phone, a 380 px popover under the avatar on a tablet. Sub-panels push inside it (‹ back), never a new page. Rows:
  - head (avatar, email, `● Cloud on · synced` / `Waiting for approval`);
  - **Voice** (profiles: switch / new / rename / delete inline, the name field at the top of the panel; the range strip with − / + steppers, tap a note to hear it; presets Bass…Soprano; ♯/♭);
  - **Find my range** (today's full-screen test, a capture lease; disabled during a take);
  - **Mic level** (the one calibration, also on the tuner's ⚙; disabled during a take);
  - **Remote** (switch; shown only where commands are answered, §21);
  - **Sync this device** (switch, only when approved);
  - **Assistants ›** (the MCP URL + Copy, "Takes an assistant starts", connected assistants, devices). Signed in only, so it may use supabase-js like `sync.js` / `assist.js` (D17);
  - **Tools ›** (Audio test → `audiotest.html`, Device check inline, the tuner policy switch, PDF engine credits and licences);
  - **Account ↗** (password · sign out): opens `account.html`, which returns to the open song (§19.10);
  - foot `Resonate v80`.
- **Signed out:** "Not signed in · Everything works signed out" · **Sign in** (→ `account.html`, returning to the open song) · Voice · Find my range · Mic level · Tools.
- **📡 remote commands (D27):** the handler is the shell's (P4). Today's `runRemote` moves from sing.js into a shell router.
  - Sing commands (`sing`, `listen`, `loop_line`, `go_to_line`, `play_take`, `review`) open Sing when nothing is busy (a layout step; never during ▶ or a take, which answer "busy").
  - On home with no song only `open_song` works; the rest answer "open a song on the device".
  - The device state keeps `page: "sing"` while a song is open, until the MCP texts change (P6).
  - mcp1.cjs gains desk and home cases.
- **The version badge** stays one literal `<span id="version">v80</span>` in the top bar, the markup bump.mjs rewrites and catalog.js reads.

---

## 13. Every setting, and where it appears

| Setting | Where | When it shows |
|---|---|---|
| Key / transpose (fit groups, splits) | song panel; the Sing key chip; the coach's `Try 8vb` (Guide me off: a dot on the key chip) | the suggestion appears when > 2% of the sung beats fall outside the comfortable range |
| Tempo %, Steady / Tapped, Type, Tap the beat, Tap along, Forget | song panel; the Sing tempo chip | Steady / Tapped when a map exists (the coach's 90 / 80% ladder stays round-only, never stored) |
| Verse | song panel | ≥ 2 verses after unfolding |
| Practice / Perform, Guide me, guide sound, Note keys | Sing ⋯ | Sing expanded |
| Score view, names (All / Some / Off) | Score head (tablet), Score ⋯ (phone in a stack); the desk bar | — |
| The fewer-names offer | the desk bar (A·C's slot / inline), the Score head | after 3 practice days (unchanged) |
| Size − / + | the desk bar at ≥ 1024; Score ⋯ → an inline stepper in the bar | — |
| Key as sung / as written, 📄 original PDF | Score ⋯ | — |
| Keyboard 🎹 | Score head / desk bar; mirrored in layers | a Score shown (phone: Sing folded or off) |
| ▶ speed (50–100%), loop | the stretch's controls | a stretch picked or ▶ playing |
| What ▶ plays | the keyboard's left end; else the stretch's controls | a view with more than one part |
| Which modules show | layers; `+ Score` | a song open |
| Mic level (calibration) | tuner ⚙; account → Mic level | — |
| Voice profiles, range | account → Voice; the tuner ribbon (tap) | "Set your range ›" from the key menu when there is none |
| Sync, Remote, Assistants | account menu | signed in and approved |
| Tuner listens between sounds | account → Tools | the kill switch (§9.3) |
| ♯/♭, Copy, take playback | Take ⋯, Take dock | after a take |

Popovers are 300–440 px, anchored with an arrow, and closed by a light scrim (22%). Rows are ≥ 48 px; segmented controls are 44 px. Segmented controls replace `<select>` wherever there are ≤ 3 options.

---

## 14. Devices

| | iPhone portrait (≤ 699) | iPad portrait (700–1023) | iPad landscape / desktop (≥ 1024) |
|---|---|---|---|
| Gutter | 12 | 20 | 20 (desktop max 1440) |
| Top bar | 52; ◎ · song pill · layers (icon + dots) · v80 · avatar | 68; ◎ · title · **tuner strip** · layers "Sing · Score ▾" | 64; the strip; two worded toggles |
| Default modules | **Sing alone** | the desk | the desk |
| Stack | one column; ≤ 2 expanded; the minimum rule | one column; the Score full-bleed | **two columns**: Sing 420 · Score |
| Score density | Play's phone rules (9.5 px or what fits); full-bleed when alone | 90 staff spaces across the region's width | the same; two systems a page where the region allows |
| Sheets | bottom sheets (Songs, account, song panel, More, review, Reader) | popovers / panels | same |
| Import minimized | dock row (home) / tile beside Songs | tile beside Songs | pill beside Songs |
| Page turns | ‹ › in the dock when the Score is alone; following Sing's line in a stack | ‹ › in the head / desk bar; pedals | same; Space = primary only with no Score shown |

- **Short phones** (Safari with its toolbars, 393 × 659; an SE at 375 × 667), designed and shot at 393 × 659:
  - the full tuner tightens (a 96 px note, a 52 px waveform) and centres safely, without spilling under the bar;
  - Sing alone keeps a 205 px lane;
  - the Score next to Sing opens folded (the minimum rule);
  - a Score alone gets 393×473.
- **iPad Split View / Slide Over** under 700 px window width: phone rules (Play's `TABLET_W`, tested against the **window**, with hysteresis: phone rules below 640, tablet rules again from 700).
- **Phone landscape** (height < 500): the tuner strip goes into the top bar, modules sit side by side, the keyboard is unavailable (v80's `ROOM`), and the dock becomes a right rail (primary, Listen, Songs).
- **Desktop:** hover states, drag-and-drop, shortcuts (Space = primary only with no Score shown; `L` = Listen); the tuner yields without session flips (§9.3).

---

## 15. Visual system

A's system, kept, plus four new tokens. The dark chrome is the identity, and the paper stays paper. Tokens sit on `:root`, inlined in the shell entry, and are mirrored for canvas code in a tiny `tokens.js`.

| Token | Value | Use |
|---|---|---|
| `--bg` | #0d0d1c + a radial glow #1c1a44 from the top | page |
| `--sheet` / `--sheet-2` | #1a1a38 → #121228 | sheets |
| `--card` / `--card-2` / `--control` / `--control-hi` / `--well` | white at .035 / .055 / .07 / .12; rgba(4,4,14,.42) | modules, rows, chips, lane |
| `--text` / `-2` / `-3` | #ecebf4 at 100 / 68 / **58**% | 17.4 / 7.8 / **5.9** :1 on `--bg` (r2: `-3` was 42%, 3.6:1) |
| `--accent` / `--accent-hi` | #a64fff (4.75:1) / #c48bff (7.8:1) | brand; text in the brand colour uses `-hi` (the `v80` badge) |
| `--grad-primary` / `--grad-note` / `--grad-live` | #4f7cff→#a64fff · #6f8dff→#a64fff→#ff5fa8 · #ff4f6f→#ff8a4f | primary / the tuner note / **recording only** (the only red: recording, never judging) |
| coaching | good #4ade80 · close #c49bff · aim #f5a85a · now #ffe6a0 · unclear #aab4ff | lane, lyrics, tuner, chips, keys |
| system | ok #8ee6a8 · warn #ffd58a · error #ffb38a | messages, never singing |
| music | paper #fdfcf8 · ink #111 · name-ink #5e2fb8 · peek #d86b00 · sel #d4e2ff · RH #a64fff · LH #4f7cff · voice #0b8f78 · part #d6336c | Score, keyboard |
| **new** `--sat` / `--sab` | `env(safe-area-inset-*)` | every band |
| **new** `--bleed` | #15152c | the full-bleed Score head and keyboard band |
| **new** `--scrim-light` | rgba(5,5,14,.22) | popovers that keep context visible |

**Type:** system UI (SF; Inter as the stand-in), display weights for the note and titles, `ui-monospace` for numbers, facts, cents and the ticker. Steps: 11 · 12.5 (mono facts) · 14 · 15 · 17 · 21–30 (lyrics) · 62–190 (the tuner note).

**Shape:**
- radii: 10 controls, 14 pills and segments, 18 cards, 22–24 sheets, 0 full-bleed paper;
- 4-point spacing;
- **touch targets ≥ 44 × 44, checked on every shot**: a small-looking chip or segment draws its pill inside a transparent border, so its box is 44 px. Heads are 48 / 50 px; the strip's mic button is a fixed 44 px.

**Icons:** one inline SVG set (24-grid, 2 px round strokes), with new glyphs: layers, full (⤢), ear, back, out (↗, a page elsewhere), keys. No emoji in the chrome; ♩ ♪ ✓ ♯ ♭ stay because they are content.

---

## 16. Motion

Only state changes move. Nothing animates continuously except the needle, the waveform, the lane and the Reader, which redraw from data.

| Change | Motion |
|---|---|
| tuner form step | 180 ms crossfade of the tuner; the stack jumps to its new place at once; **one** Score relayout, one rAF after the swap |
| module on / off / fold | the card fades and scales 0.98 → 1 in 200 ms; the others jump (no height tween) |
| fold | instant + a 120 ms chevron turn |
| sheet / popover / drop tuner | 260 ms slide / 160 ms scale-fade / 220 ms drop, `cubic-bezier(.2,.8,.2,1)` |
| Reader ⌄ to the dock slot | FLIP 280 ms; ✕ to the ring: 200 ms shrink |
| secured phrase | one 600 ms green glow pulse (caption + map segment) |
| 📡 ring, assistant dot, "take" dot, the offer's dot | 2 s pulse |

`prefers-reduced-motion`: crossfades only, no pulses, no Reader sweeps (the Reader's own reduced-motion rules).

## 17. Accessibility

- Every control is ≥ 44 × 44 and labelled (`shots.cjs` and `shellchrome.cjs` fail otherwise). Layer switches, 🎹, hear chips and switches carry `aria-pressed`.
- Sheets and popovers are `role=dialog` with a focus trap. Escape closes the topmost. **Focus return:** to the opener after a keyboard close; to the Score's root (or the shell's main region) after a tap close (§6.5).
- The tuner is **not** a live region. Its accessible action "Note" reads note + cents once.
- The coach line is `role=status`, updated once per round; its full text is its accessible name even when the box shows "…".
- The Reader's ring is a `progressbar` with `aria-valuetext` ("Page 2 of 3, bars, about a minute left").
- Colour never carries meaning alone:
  - missed and unclear lane bars are dashed / dotted;
  - the tuner shows ↑/↓;
  - muted hear chips are struck through;
  - the take state has a word;
  - review lines carry ✓ / ↑ glyphs.
- Keyboard: Tab order top bar → tuner → modules (heads, then bodies) → dock. Pedal keys reach the Score only with no field focused.
- **Contrast**, checked by `shots.cjs` on every shot: body text ≥ 4.5:1 against what is actually behind it (`--text-3` 5.9:1, `--text-2` 7.8:1), large text ≥ 3:1. Name-ink only on paper.

---

## 18. Where every current feature lives now

### Tuner (index.html + app.js)
| Feature | New home |
|---|---|
| Locked-note logic, YIN settings, tunable constants | `tuner.js`, the same constants and code. Frames from the mic bus; ♯/♭ from music.js |
| Cents needle, thresholds 5/20¢ (red) | gauge / bars, **no red** (green / purple / amber) |
| Volume meter, VOL gear + calibration modal | level row + ⚙; merged with Voice's volume test into one calibration |
| Waveform | full and docked only; sizes from a ResizeObserver (not read every frame) |
| Start / Stop, `startGen`, 8 s watchdog, hidden → stop, pagehide → `auto`, `play-and-record` before getUserMedia | the mic button (listen / park) + home's main button; `mic.js` / `audio.js` |
| Status line, errors | mic state words + a one-line toast above the dock |
| Profile chip, account chip, header links | ribbon (tap → Voice); avatar; dropped (one page) |

### Record
| Feature | New home |
|---|---|
| Live roll, segmentation constants, take clock, 300 s cap, wake lock | Take module (same code); gains the watchdog Record lacked |
| Transcript chips (note · length · cents), playback Voice / Notes / Both, ♯/♭, Copy | Take module (chips unchanged in content) / Take dock / Take ⋯ |
| `resonateDebug` | `resonateDebug().record` (top-level under the record entry, §19.7) |

### Voice
| Feature | New home |
|---|---|
| Profiles, range card (steppers, presets, tap to hear) | account → Voice panel (inline fields at the top of the panel instead of `prompt()` / `confirm()`) |
| Range test (mic only while singing, reference notes at level 2.0) | **Find my range**: today's overlay, as a capture lease. voicetest.cjs's rule becomes the arbiter's rule |
| Volume test | merged calibration |

### Sing
| Feature | New home |
|---|---|
| Song menu, Open, Link, drag-drop, ✕, ⤓ | song list; Add; a row's ⋯ |
| Verse, key / transpose with fit groups, tempo (+ Steady / Tapped, Type / Tap / Tap along / Forget), `#song-msg` | **song panel** + Sing head chips; the fact line; messages → toast |
| Options sheet (view, Guide me, guide) | Sing ⋯ |
| Song map, lyrics, count-in, take-end pill, lane | Sing module |
| Guided coach card, More | **dock coach line** (a fixed two-line box) + More › |
| Phrase loop + lockouts | after-take row / More; the lockouts also cover layers, 🎹 and the song list |
| 🎤 Pitch monitor + `#you` | **the tuner** (target-aware, same yield rules; a block holds its lease) |
| After-take play bar (▶ Play, Review, Voice / Melody / Both) | after-take row inside Sing |
| Review sheet | sheet / panel; content unchanged, **"▶ plays: You \| Melody \| Both" in its head**, one ▶ + ⟳ per line, ✓ / ↑ marks only |
| "SUNG 8VB / 8VA" after a take | the folded Sing summary and the song panel's fact line |
| Note chips (piano keys) | Sing ⋯ → Note keys (an optional row); the keyboard band lights the practice note |
| Listen / Sing footer | the dock |
| Perform view | a curtain over Sing **and the Score**; the tuner shows "take" only (D22) |
| Get-ready countdown, Tap pads | full-screen overlays (the countdown at z 65, above the top bar) |
| 📡 Remote, assistant chip, `runRemote` | account menu switch, the avatar's ring + glyph, top-bar chip; the shell's remote router (D27) |
| Then → Now, Last take, ⤓ Last round | coach line after an improved run / More (unchanged) |
| `#score-pct` | dropped (it was dead UI) |
| `resonateDebug()` (flat), `resonateBusy` | registries (§19.5); Sing's fields kept flat |

### Play
| Feature | New home |
|---|---|
| Song menu | song list |
| View, ABC, ▶ / ■, pager, − / +, 📄, fewer-names offer | Score head; desk bar (the offer on the bar, − / + at ≥ 1024); Score ⋯ |
| 🎹 docked keyboard + what-▶-plays chips | **the Score's keyboard band**, one 🎹 toggle |
| Paper, badges, key marks, presses, drag-a-stretch, selbar, bubble, auto-turn, playback engine, lit notes | Score module, unchanged code; sized from its box (P0); Verovio's `<style>` scoped (§19.3); **the view's XML in the song's key** (D24) |
| Pedal turns | the key router: whenever the Score is expanded and nothing is focused; focus to the Score after a tap close |
| Context, unlock, keep-awake, wake lock | `audio.js` (one keep-awake). Wake lock: on a tablet while the Score shows (as Play today); on a phone only during takes, ▶ and imports |
| `resonateDebug().play` | kept as `.play` |

### Shell pages
| Feature | New home |
|---|---|
| account.html (sign in / up / forgot, recovery, check email, **change password, sign out**) | **stays a real page** (restyled), from the account menu's Account ↗ and Sign in; returns to the open song |
| Assistants page | account → Assistants panel (signed in only); `assistants.html` becomes an entry |
| OAuth consent | unchanged standalone page (restyled) |
| Tools menu, device check | account → Tools ›; `tools.html` stays as a plain harness page (30 tests use it) |
| PDF → Song page | Add → PDF + the Reader tray; `pdf-import.html` becomes an entry (keeps `?pdf=`) |
| Audio test | `audiotest.html`, a real page (it needs every context closed) |
| nav.js (space, park, sync, cross-tab reload, import pill) | the shell's first module, before anything reads storage. The import pill becomes the dock slot. A sign-in / out elsewhere → a one-line "Signed in elsewhere · Refresh" banner, reloading by itself when nothing is busy |

**Dropped:** the header nav links; `#score-pct`; `#status` lines; the two song selects; Sing's Open / Link / ✕ / ⤓ buttons (moved); `prompt()` / `confirm()` (inline fields); the waveform in the strip; red in the Tuner, Record and the range test; `public/load.png` (unused).

**Merged:** the monitor into the tuner; two calibrations into one; four play-context copies into `audio.js`; Play's keyboard into the Score; the guided card into the coach line.

---

## 19. Architecture: the shell, modules and shared services

No build step and no framework: vanilla ES modules, as today.

### 19.1 Files

```
public/
  index.html          today's Tuner until P6; then the shell entry (tokens inlined, <span id="version">)
  shell.html          P3–P5: the shell as a preview (Tools → "New Resonate (preview)"); ?entry=sing|play|record|voice|…
  sing.html play.html record.html voice.html assistants.html pdf-import.html
                      today's pages until P6; then ~15-line entries: tokens + <script type="module" src="shell/boot.js?v=N" data-entry="sing">
  account.html  oauth/consent.html  audiotest.html  tools.html      real pages (unchanged role)
  shell/
    boot.js           reads the entry + URL, runs nav.js's space work FIRST, makes the services, mounts
    layout.js         plan(): pure function (device, box, modules, folded, open sheets) → forms and regions
    chrome.js         top bar, avatar, layers, dock, coach line, toast, sheets/popovers host
    songlist.js       the list, Add, row actions, the song panel
    tray.js           hosts omr/reader.js; dock slot / ring; drives omr/importer.js
    account-menu.js   the account sheet + panels (Voice → voice.js, Assistants → assistants.js, Tools)
    remote.js         the 📡 command router (from sing.js runRemote) + assist.js wiring
    keys-router.js    pedal / keyboard routing, Escape, focus return
    registry.js       resonateDebug() / resonateBusy() composition
  services/
    audio.js          the arbiter (OUT, session, leases, keep-awake, unlock)  ← sing/play/voice/record copies
    mic.js            listening stream, frame bus, states, lend/yield, the policy table  ← Sing's monitor + app.js
    song.js           the open song + its settings + add/remove + remote merges  ← sing.js selectSong/applySong state
    prefs.js          device prefs vs DATA_KEYS (spaceChanged-guarded store())
  modules/
    tuner.js  sing.js (today's, mounted)  score.js (play.js, mounted)  take.js (record.js)
```

Today's `public/*.js` files stay where they are during the migration. Modules are thin adapters that call their existing `init` code with a root element (§21 P3–P5).

**Every file under `public/` is versioned (r2).**
- `bump.mjs` walks `public/**` recursively, skipping `vendor/`, `omr/pdfjs/` and `*.mjs`. It puts `?v=N` on every local import, and writes `export const VERSION = N` into each lazily loaded module.
- A node check in `regress.sh` fails if any local import specifier lacks the badge's `?v=`.
- Module CSS lives in the module's JS (a `<style>` it adds once) or in the versioned HTML, never in an unversioned `.css`.

Today bump.mjs only reads `public/*.{html,js}`, `public/omr/*.js` and `public/oauth/*`. After one bump, `services/mic.js` would still import `./audio.js?v=old`, giving two arbiters in one document: v54's failure, silent and long-lived.

### 19.2 The module API

```js
/**
 * Every module exports mount(). The shell calls it once per module per song (Sing, Score) or once
 * per page load (Tuner, Take); it never mounts two of the same kind.
 *
 * @param {HTMLElement} root   the module's card body; everything it renders goes inside (ids kept)
 * @param {ShellCtx} ctx       the ONLY way a module reaches a service (never its own import of one)
 * @param {object} [opts]      e.g. { song, view: 'melody', entry: 'play' }
 * @returns {ModuleHandle | Promise<ModuleHandle>}
 */
export function mount(root, ctx, opts) {}
export const VERSION = 81;    // written by bump.mjs; the shell compares it after a lazy import (§19.8)

/** @typedef {object} ShellCtx
 * @property {{kind:'phone'|'tablet'|'desktop', portraitSp:number}} device
 *           kind from the window's short side + pointer (Split View → phone); portraitSp = the
 *           device's portrait density, min(screen.width, screen.height) / PAPER — today's floor input
 * @property {Audio}  audio   getOut(how: 'tap'|'press'|'auto') → AudioContext; lease(kind, owner) → {release}
 *                            (a capture lease while another is live → null); session() is private; on('state', fn)
 * @property {Mic}    mic     state ('off'|'listening'|'paused'|'parked'|'lent'|'quiet'|'blocked'|'noanswer');
 *                            on('frame', fn) ({t, midi, rms, db}); listen(); park(); setTarget(midi|null);
 *                            lend(owner, {onFrame}) → {push(frame), release()}   (a take or block mirrors its frames)
 * @property {Song}   song    current {id, title, xml, score, settings:{key, rate, timing, verse}};
 *                            on('song'|'settings'|'remote', fn); open(id); close(); setKey(v); setRate(v)…;
 *                            viewXml(xml) → the XML in the sung key (D24)
 * @property {Prefs}  prefs   device(key[, value]) — device prefs; store(key, value) — DATA_KEYS, refused
 *                            after spaceChanged()
 * @property {Chrome} chrome  sheet(id, {anchor}) / closeSheet(); toast(text); dock({left, primary, caption}) —
 *                            honoured only from the dock's owner (D10); hint(text) on the paper
 * @property {Keys}   keys    claim('pages', handler) → {release} (the Score while expanded)
 * @property {Busy}   busy    set(name, bool) → resonateBusy() ORs every module
 * @property {Debug}  debug   register(name, fn) → resonateDebug() composes them (§19.5)
 * @property {AbortSignal} signal  aborted on destroy: listeners, timers and observers hang off it
 */

/** @typedef {object} ModuleHandle
 * @property {string} name                        'tuner'|'sing'|'score'|'take'
 * @property {{h: number}} min                    the height under which it opens folded (D3)
 * @property {(box: Box) => void} resize          called ONLY on a layout step, one rAF after the swap:
 *                                                {w, h, form, desk}. Never reads innerHeight/screen.
 * @property {(on: boolean) => void} setExpanded  folded → keep state, stop drawing
 * @property {() => string} summary               the folded head's mono line
 * @property {() => (false|string)} busy          'take'|'loop'|'guided'|'play'|'listen'|false
 * @property {() => void} stopSound               the one-sound rule: the transport calls it on the others
 * @property {() => object} debug
 * @property {() => Promise<void>} destroy        stops sound, releases leases, frees buffers (the Verovio
 *                                                Module on a phone, take audio), aborts ctx.signal
 */
```

**Services are guarded singletons.** Each registers itself on `window.__resonate` and throws loudly if evaluated twice (a second module graph). Lazy modules get them only through `ctx`, so a stray copy can never start a second arbiter.

**Size changes** come only from the shell: `layout.plan()` changes → the shell swaps the bands (the crossfade) → one rAF → `resize(box)` on each module whose box changed. A module never measures the window.
- Play's `measure()` reads `box`.
- Its `device()` reads `ctx.device.kind`.
- Its landscape floor keeps **today's calibration**: `FIT_FLOOR × ctx.device.portraitSp`, the screen-derived portrait density, so a region box never changes it.
- `TABLET_W` keeps testing the **window** (Split View), not the region. An iPad's 730 px landscape column keeps tablet rules (8.1 px a staff space on an Air), and so does a mini's ~650 px column. playpaper gains cases for 650 and 730 px regions.
- `resize` is deferred while `busy()` is truthy; the shell never changes the plan then anyway, since layer controls are inert.

### 19.3 Layout engine, the viewport and the Score region

- `layout.plan({ device, w, h, modules, folded, song, take })` → `{ tuner: 'full'|'docked'|'strip'|'chip', inBar, desk, regions: { sing: {h}|null, score: {h}|'fill', keys: {h}|null }, dock: 'home'|'sing'|'score'|'take'|null, folded: [...] }`.
  - It is a pure function, unit-tested in node (`tools/layoutcases.mjs`): each device × set × the minimum rule × the phone cap × 393 × 659.
  - The shell applies it with CSS custom properties (`--sing-h`, …), not inline layouts per module.
- **The viewport (r2):**
  - sizes come from a ResizeObserver on the shell root, not `innerHeight`;
  - **a height change under 80 px is clipped, not laid out again** (Safari's toolbar showing and hiding, the keyboard);
  - on `visualViewport` resize and on `focusout` the shell calls `scrollTo(0, 0)`, so iOS's pan to a field never leaves the fixed bars offset;
  - text fields sit at the **top** of their sheet, or in a small top-anchored field sheet (Type a tempo, Link, a profile's name);
  - `overscroll-behavior: none` on `html` and `body` and `touch-action: none` on sheet handles keep a downward drag from pulling to refresh, which would end a take, stop ▶ and ask for the mic again.
- **Verovio's SVG `<style>`:** stripped from each page and its rules re-added once, scoped under `.score-paper svg`. **No Shadow DOM for the Score**: Play's `setLit` uses `document.getElementById`, and about 245 lookups in the play*.cjs tests go through `document`.
- **Follow-the-take renders nothing during the take (r2).** Before the count-in, the pages the take will reach are rendered and badged; during the count-in the clicks run on the audio clock, so a main-thread pause costs nothing. The take then turns between cached SVGs: a turn is a DOM swap, never `renderToSVG` or a `getBBox` pass. The keyboard's sung-note dot redraws on note change, ≤ 10 Hz. `stack.cjs` asserts the longest main-thread task during a followed take stays under 50 ms at ×4 CPU, because a stall over ~85 ms loses analyser frames.
- **CSS:** `@layer tokens, shell, modules`. Each module's rules sit under its root class, with no element-level selectors (today's pages style `body`, `header` and `button` directly; those rules move under the module roots). **P1's chrome on today's pages mounts in a Shadow DOM** (open, so Playwright's selectors still pierce it), so the old pages' element rules and the chrome don't bleed into each other.

### 19.4 Shared services

- **`audio.js`, the arbiter:** §9.1. OUT is never made while a capture track is live; leases; a capture lease is refused while another is live; the session setter; the piano bus and limiter; one keep-awake; `scheduleAhead`; the first-tap unlock; bfcache re-arming. It never owns a take's context in v1 (D20). Events let the tuner say *why* it isn't listening.
- **`mic.js`:** §9.2–9.3. The tuner's own stream; the watchdog and generation tokens; the policy table, with the route detection (input label, `outputLatency`), bursts, the 60 s silence park and block leases; `lend(owner)` closes the tuner's own tracks first (one mic at a time on iOS), then mirrors the frames the lender pushes; `setTarget` from presses.
- **`song.js`:** the one owner of the open song:
  - `resonate.sing.song`, library.js / catalog.js loading, the clean-up cache;
  - the per-song settings maps (`keys`, `rates`, `timing`, `verse`) and the `songGen` guard;
  - add / remove (moved out of sing.js, clearing the same keys plus the practice and Play records);
  - `resonate:remote` merges (pending while busy, flushed after);
  - `fitOptions` for the song panel;
  - `viewXml()`, the sung-key transposition for the Score (D24).

  Sing and the Score both follow it.
- **`prefs.js`:** device prefs (`resonate.shell.*`, `resonate.play.zoom*`, `resonate.play.keys`, `resonate.sing.guided`, `resonate.sing.view`, …; not shelved) vs `DATA_KEYS` (shelved and parked with the account, written only through the `spaceChanged()`-guarded `store`).
  - New device keys: `resonate.shell.modules` = `{ phone: ['sing'], tablet: ['score'], desktop: ['score'] }` plus each device's folded set; `resonate.shell.import` (minimized / hidden); `resonate.shell.listen` (the policy kill switch).
  - The Score's key choice (as sung / as written) joins `resonate.play[id]`.

### 19.5 Registries (tests keep reading what they read today)

- `window.resonateDebug()` returns `{ ...singFlat, play, tuner, record, voice, audio, shell }`. Sing's fields stay at the top level and Play's under `.play`, as the ~130 test scripts read them. **Under an entry, that entry's module is also flattened to the top level**: `voice.html` exposes `.profiles` and `.run` as voicetest.cjs reads them, and the record entry Record's fields. `shell` adds `{ plan, forms, modules, sheets, tray, policy }`.
- `window.resonateBusy()` ORs every module's `busy()` and the tray, so nav.js's cross-tab reload still waits for a take, a loop, ▶ or a conversion. Today's Record page has no `resonateBusy`; it gets one before it gets any chrome (P1).

### 19.6 Entries and URLs

| URL | Until P6 | From P6 (no redirects, so the tests' `goto` works) |
|---|---|---|
| `index.html` | today's Tuner | the shell, home. A launch never reopens a song by itself (R3); a reload, Back, and a return from account.html do (§19.10) |
| `shell.html` | the preview (P3–P5), `?entry=…` as below | kept as an alias of `index.html` |
| `sing.html` | today's Sing | the shell, the last song, Sing on; Sing's ids as today |
| `play.html` | today's Play | the shell, the last song, **the desk**; Play's ids as today |
| `record.html` | today's Record | the shell + the Take module |
| `voice.html` | today's Voice | the shell + the account sheet's Voice panel |
| `assistants.html` | today's page | the shell + the Assistants panel |
| `pdf-import.html` | today's page | the shell + Add → PDF; `?pdf=URL` starts a conversion |
| `account.html`, `oauth/consent.html`, `audiotest.html` | real pages | real pages (supabase-js, OAuth frame-busting, every context closed) |
| `tools.html` | today's | a neutral harness page for tests; the user-facing Tools is a panel |

### 19.7 Ids, tests and what keeps them meaningful (r2: an honest port)

- **Until P6 the old suites test the old pages, unchanged**: today's pages aren't touched (D26). The shell's tests run against `shell.html?entry=…`.
- **Ids are kept inside module roots.** The real clashes once pages share a document get module prefixes: `#play` (Sing, Play, Record), `#status` (Tuner, Sing, Record, Voice), `#msg` (Play, Voice, Assistants), `#strip` (Play, Voice), `#copy` (Record, Assistants), `#playbar` and `#play-modes` (Sing, Record). `#version` stays single.
- **The test port is real work, budgeted in P3–P5.** `tools/ui.cjs` holds the helpers the ported scripts call, replacing raw selectors for things the redesign moves:
  - `pickSong(id)`, `openSongPanel()`, `setKey(v)` (the visible `#key-select` in the panel), `setTempo(v)` (sets the panel's state, which no hidden `<select>` can: Playwright's `selectOption` waits for visibility), `openScoreMenu()`, `sizeStep(±)`, `pdfView()`;
  - `showModules(set)`: sets `resonate.shell.modules` (e.g. Sing only, Note keys on), so a Sing test at a phone viewport doesn't load Verovio.

  Counted in `/home/user/tools`: Play's `#song` select 32 references in 11 files (selectOption 27), `#pdf` 48 in 9, `#bigger` / `#smaller` 70 in 8; Sing's `#key-select` / `#tempo-select` / `#song-select` / `#verse-select` 30.
- **Scripts that need rewriting, named:**
  - pitchmon → the tuner readout;
  - chipkeys, chiptap and iosgate's chip path → the Note keys row;
  - transpose, singfit, singfit390 → the song panel;
  - taptiming → `ui.setTempo` and the tap screens;
  - review → the review's segmented control;
  - wlend / wlsing → `#chips` / `#you` moved;
  - playheaders and smoke → `shellchrome.cjs`.
- **Re-baselined on purpose (P5):** playpaper, playkeys, playhear and playv80fixes K. The desk's stage is bigger than today's (D6) and Songs narrows the keyboard. Before / after is recorded per device × song × view, and the owner checks page counts on his five songs on the iPad. In Chromium (no safe areas) the desk paper is ≈ 820×1006 against today's 962 in portrait, ≈ 1180×678 against 676 in landscape.
- **New tests:**
  - `layoutcases.mjs` (node: the plan function);
  - `arbiter.cjs` (a fake `navigator.audioSession` logs every type change):
    - the order rules of §9 on every entry and flow;
    - the session is `playback` whenever OUT is created;
    - no flips between a block's rounds;
    - a second capture lease is refused;
    - Tuner → Sing → Play → Tuner;
  - `stack.cjs`:
    - exactly one Score relayout per layer change, none during a take / ▶ / loop;
    - coach text never changes a box;
    - the follow band, with no long task during a followed take;
    - pedals after each tap-closed popover;
    - the phone cap, and the minimum rule at 393 × 659;
    - a press on a transposed song sounds the lane's target midi;
  - `tray.cjs`:
    - an import continues while a song plays;
    - a take holds pdf.js rendering (and on a phone the OCR native);
    - done → Open, never switching the song;
    - a second PDF waits;
    - a fresh Worker per run;
    - **Stop reading leaves no Resume after a reload**;
  - `songpanel.cjs` (the fit groups equal `fitOptions`; Try 8vb applies the first "Fits" option; Steady / Tapped round-trips `r:` / `m:`);
  - `shellchrome.cjs`:
    - avatar and Songs on screen at 375 / 390 / 744 / 820 / 1180 and 393 × 659;
    - no horizontal scroll;
    - sheets open / close / Escape;
    - the tray minimize / hide → ring / back;
    - the top bar never taller than its token;
    - **every target ≥ 44 × 44 and text ≥ 4.5:1** (the checks `tools/shots.cjs` runs on the mockup).

### 19.8 A long-lived page

The iPad can stay open on the music desk for days.
- **After** each lazy import (Verovio, the Reader, the account panels), the shell compares the module's `VERSION` with its own. On a mismatch it doesn't mount the module; it shows "Updating…" and reloads when idle (`resonateBusy()` false), returning to the open song (§19.10).
- A pre-fetch of the badge is only a hint, because it races the deploy and the 10-minute cache.
- Because services come through `ctx`, a stray newer graph can't create a second arbiter.

### 19.9 Memory (an iPhone with Sing, a Score and an import)

- A folded Score stops drawing.
- **On a phone during a conversion the Score folds and the Verovio toolkit and its Module are dropped** (only then can the WebAssembly heap be collected), keeping only `S.at`.
- The Take frees its buffers (~57 MB for 5 min) on ✕.
- The Reader keeps one decoded page.
- Closing a song destroys its modules.
- A test asserts heap growth stays bounded over 10 song switches with a take each (Chromium `performance.memory` as a proxy; WebKitGTK as the iOS stand-in). Neither has iOS's jetsam, so **P5's Verify includes converting a PDF while singing a take on the iPhone, watched in Safari Web Inspector's memory timeline**.

### 19.10 History, Back and returning to the song (r2)

- Opening a song and opening a sheet each `pushState`. `popstate` closes the topmost sheet, then the song (back to the tuner), so iOS's edge swipe does what it did on the multi-page site.
- **The brand mark (◎) left of the song pill closes the song** (it stays as Next-up); so does Close song in the panel and the list.
- **Returning to the open song** after a reload, a version-skew reload, an iOS tab discard, Back from account.html or a sign-in: the shell keeps `?song=<id>` in the URL for history entries. On a **fresh launch** (`navigation.type === "navigate"` with no return marker) it drops it with `replaceState` and opens the tuner. A Home Screen icon or bookmark saved with `?song=` therefore still starts on the tuner (R3).
- account.html writes the return marker in `sessionStorage` (`resonate.shell.return = id`) before it leaves for the shell.

---

## 20. Deferred (optional later steps, each needs the owner's say)

- **One ▶ for the song:** Listen and the Score's ▶ from a shared cursor; a song clock linking the lane and the score cursors.
- **Pressable keys** in the keyboard band, striking through Play's peek engine at the song's key, which could replace the Note keys row. Today's keyboard takes no touch.
- **Lane bars as keys.** The Note keys row stays as the dependable press-and-hold strip and for assistive tech.
- **Play's ▶ speed merged into the song's tempo.** Today a pianist slows a stretch without slowing the song.
- **A "You" hear chip** after a take, replacing Voice / Melody / Both.
- **Step-driven scenes** (the coach choosing modules) and C's **Play it** step. The coach may *suggest* a module in v1, never move one.
- **Inline sign-in, sign-out and password** in the avatar popover, once account.js runs as a lazily mounted panel with its exact lock order and account.cjs, sync3 and sync4 run against it.
- **One long-lived capture context for takes**, if the P0 spike shows route and latency changes are handled.
- **A PWA manifest / Home Screen icon.** iOS splits storage between Safari and a Home Screen app, so the owner's songs would not follow; that needs a decision first.
- **Headphones mode** (keep listening while sound plays).

---

## 21. The phased build plan

Every phase ships on its own: a version bump, a push to `main`, and the owner tries it on the iPhone and the iPad. **From P3 to P5 the shell ships as a preview (`shell.html`, reached from Tools → "New Resonate (preview)") while today's pages stay exactly as they are**, so the owner's daily tools never become hybrids. P6 switches over in one release. Each phase keeps the full suite meaningful: the old suites keep testing the untouched old pages until P6, and the shell's ported suites grow alongside them. The arbiter ships **before** any two audio features share a document (P2 before P3).

### P0: Spikes and preparations in today's code (v81)

- **What:**
  1. **Device spike** on `audiotest.html` (new rows, Copy results). Each row maps to a row of §9.3's table:
     - (a) is OUT interrupted when the session flips playback → play-and-record → playback;
     - (b) time to full speaker volume after the tracks stop;
     - (c) does `getUserMedia` reopen **without a gesture** after the first grant in a page load;
     - (d) a press while the mic is open vs parked: `pointerdown` → sound;
     - (e) AirPods and CarPlay: what the input's label and `outputLatency` say (route detection); A2DP → HFP → A2DP switch time; is the first second of a note after the switch heard;
     - (f) OUT's `sampleRate` and quality when created under play-and-record vs playback, on the speaker and with AirPods, after the mic closes;
     - (g) does `play-and-record` stop Music / Spotify, in Safari and in the Home Screen app;
     - (h) an `OfflineAudioContext` decode opens no output path, and its buffers play cleanly on a context at another rate.
  2. **Two OMR conversions in one document** (terminate, a fresh Worker, `/files` deleted, the Web Lock held), and **Stop reading** on today's pdf-import.html (terminate, drop the job, release the locks). Useful today, and the shell's tray needs both.
  3. **Play sizes from a box** (preparation, not a bug fix: today's `device()` and floor read `screen` on purpose, for the calibrated landscape floor). `measure()` takes `{w, h}`; `device()` and the floor take a device hint carrying the screen-derived portrait density, so today's numbers are unchanged; `TABLET_W` keeps testing the window, now with hysteresis.
  4. **bump.mjs walks `public/**`** and writes `VERSION` exports; `regress.sh` gets the import-specifier check.
- **Tests:**
  - playpaper / playkeys / playhear / playback pass **unchanged** (the box equals the stage), plus region cases at 650 and 730 px wide;
  - `audiotest.cjs` covers the new rows;
  - `e2e-import.cjs` runs two conversions in one tab and a Stop;
  - the bump check on a scratch copy.
- **Risks:** none for users (new audio-test rows; a Stop button; refactors with identical output).
- **Verify:** the owner runs Audio test on the iPhone (speaker, AirPods, the car) and the iPad and sends **Copy results**. Those numbers choose §9.3's row before P2.

### P1: The account corner on today's pages

- **What:**
  - The tokens, and the **avatar + account menu** on every page but account.html (which gets the restyle only) and consent. It is mounted in an **open Shadow DOM** so the old pages' element styles and the chrome don't mix.
  - Rows link to today's pages: Voice → voice.html, Assistants → assistants.html, Tools → tools.html, Account ↗ / Sign in → account.html.
  - Remote and Sync switches work inline; **Remote shows only on sing.html** (where `assist.js` answers).
  - The Tuner's account chip (`#account-chip`, "Sign in ›" / "Account ›") becomes the avatar. On Play, which has no account chip, the avatar sits beside `#version` at the bar's right end, and the bar's give-way order (the view menu first) keeps it no taller at 300–1440 px (playheaders' rule).
  - Record gets `resonateBusy` (a take in progress) **before** it loads the chrome; it doesn't load nav.js's cross-tab reload at all.
  - `overscroll-behavior: none`, and `touch-action: none` on the sheet's handle.
  - **No Songs button and no tray on the old pages**: the song list needs `song.js` (P4), and an import inside Sing or Play would put CheerpJ next to a take or Verovio.
- **Tests:** everything keeps passing; playheaders updated for the avatar (bar height unchanged); account.cjs unchanged; new `shellchrome.cjs` (the avatar part) on every old page.
- **Risks:** z-order against Sing's review sheet, get-ready and 📡 (one z-scale now); Play's bar width at 744 px with the avatar beside `#version`.
- **Verify:** on the iPhone and iPad, the avatar on every page, the menu, Remote on Sing only, and no pull-to-refresh from the sheet.

### P2: The audio arbiter and the mic service, inside today's pages

- **What:**
  - `services/audio.js` replaces the four play-context copies (sing.js, play.js, voice.js, record.js) and the `audioSession.type` setters (11 across 7 files; audiotest.js keeps its own, it tests the paths). One session setter, the OUT creation rule, leases (blocks hold one), one keep-awake.
  - `services/mic.js` replaces Sing's monitor plumbing, the Tuner's stream (app.js becomes a module or gets a classic-script shim; its locked-note code moves verbatim) and Voice / Record's `openMic` use. Takes keep their own `openMic()` context and lend frames.
  - **The §9.3 row P0 picked**, or "park after the first sound" on iOS if a route result is still missing. The **Tools switch** is the kill switch.
  - The UI is unchanged except the honest words (paused / parked / take) on Sing's 🎤 readout and the Tuner's status.
- **Tests:**
  - the whole regress.sh plus pitchmon, playafter (12 paths), stuckctx, iosgate, unlock, ahead, voicetest, tunerfix;
  - playpress (press latency ≤ v80: Chromium median ≤ 3 ms, WebKitGTK ≤ 1–2 ms);
  - new **`arbiter.cjs`** (§19.7);
  - a golden test: the tuner's notes / cents for a recorded oscillator sweep, identical before and after.
- **Risks:** this is where iOS audio breaks (v56–57 stuck contexts, v62 the Tuner's Start, v66–67 CarPlay). Mitigations: the policy row from real numbers, and the kill switch.
- **Verify:** the playafter matrix by hand on the iPhone (a take → Play loud; Listen after Stop; Tuner Start after Sing); AirPods; the car (no worse than v80); iPad presses instant after ▶ and after a take.

### P3: The shell preview, with the tuner, Take, Voice and the song list

- **What:**
  - `shell.html` (Tools → "New Resonate (preview)"): top bar with ◎ / avatar, the **tuner module** (all four forms, the split gestures, tap-to-drop), dock, sheets layer, **Next-up**.
  - `layout.js`, the module API, the registries, the services as guarded singletons through `ctx`, the `VERSION` check, history and Back (§19.10), the viewport rules (§19.3).
  - **Take module** (record.js mounted); **Voice panel** in the account menu; the merged Mic level.
  - **The song list** (choosing a song opens today's sing.html / play.html in P3) with Add → MusicXML / Link. Add → PDF opens today's pdf-import.html.
- **Tests:**
  - tunerfix, voicetest and the Record tests ported to `shell.html?entry=…` through `tools/ui.cjs` (the originals keep running on the old pages);
  - new `layoutcases.mjs`, `tunersizes.cjs` (the form changes only on module / song / rotation changes, never during a take or ▶; the drop is an overlay; the mic words) and `shellchrome.cjs` on the shell.
- **Risks:** the tuner's behaviour now rests on the mic service (P2's golden test covers it); Record's ~57 MB in a long-lived document (freed on ✕, memory test).
- **Verify:** on the iPhone, the preview's tuner Start / Stop, Record, Find my range, calibration, and Back from a sheet.

### P4: Sing in the shell (still the preview)

- **What:**
  - `services/song.js` extracted from sing.js (open song, settings, add / remove, remote merges, fit options).
  - **The Sing module** mounted: lyrics, lane, map, Note keys, after-take row, review (segmented head), loop, guided practice, Perform as a curtain (the tuner shows "take" only), get-ready (z 65), tap pads.
  - **The coach line** (fixed box) + More in the dock; **the song panel** (fit chips over the visible `#key-select`; Steady | Tapped); **the suggestions** (coach line, or the key chip's dot with Guide me off).
  - **Songs open in place with Sing on every device** (the Score toggle opens today's play.html until P5, with a warning when a PDF is being read).
  - **The Reader tray**: a background import is real now, because nothing navigates. Stop reading; on a phone the OCR native waits during a take.
  - **The remote router** (D27) and `assist.js`.
- **Tests:**
  - the Sing suites ported with `tools/ui.cjs`, including the rewrites named in §19.7: guided.cjs with `BLEED=1`, guidedoff, loop, loopguard, review, perform, chipkeys → Note keys, taptiming, lasttake, countin, rhythmpage, playafter. The node suites (practicecases, coachcases, guidedverdicts, rhythmcases) are unchanged;
  - sync2/3/4 and mcp1 against the preview, with mcp1's new home case;
  - new `songpanel.cjs`, `tray.cjs`, and the add / remove key-set test.
- **Risks:**
  - sing.js's 3.8k lines of page-global state: a song switch is a destroy + mount with every token reset (`songGen`, `playGen`, the loop token, `finishing`, `pendingRemote`), tested over 10 switches with a take each for leaked listeners and contexts;
  - the review's tap pass-through;
  - 📡 `doing` states over the shell;
  - cross-tab sign-in / out (one reload, held while busy).
- **Verify:** on the iPhone preview: Next-up → Hear it → rounds → secured → a run; Guide me off → a take → review; Loop line; a remote take from ChatGPT (countdown, to_line, no review sheet); an import running throughout. On the iPad: Sing alone.

### P5: The Score and its keyboard in the shell; stacking; the desk (still the preview)

- **What:**
  - **The Score follows the song's key first** (D24: `song.viewXml`, the octave clef or mark, Key as sung / as written). Stacking ships only with it.
  - **Score module** (play.js mounted; box-sized from P0; Verovio's `<style>` scoped; its ids inside the root, `#play` / `#msg` / `#strip` prefixed) with **its keyboard band** (🎹).
  - **Stacking** with Sing (the phone cap, the minimum rule, folded heads, the Score following Sing's line on a phone).
  - **The desk** on tablets (one bar with 🎹, − / + at ≥ 1024, the offer on the bar; keyboard bottom; Songs at its right end).
  - **Follow-the-take** with pre-rendered pages (no rendering during a take).
  - **Silent presses during a take** ("Plays after your turn"); presses set the tuner's target; the policy's burst / desk rules; pedal routing and the focus rule; the phone memory rule during a conversion.
- **Tests:**
  - the 20 play*.cjs ported to the desk entry and **re-baselined on purpose** (before / after per device × song × view, D6);
  - the WebKit smokes (playwebkit, playbackwk, playpresswk, playhearwk);
  - playpress is the gate (a press in a stack and on the desk keeps v80's latency);
  - playv80fixes K with Songs at the keyboard's end;
  - playfixes' offer-on-the-desk check;
  - new `stack.cjs` (§19.7).
- **Risks:** iPhone memory with Verovio + Sing + an import (§19.9); relayout on rotation with two modules (one per step, measured); the keyboard's width with chips + Songs.
- **Verify:**
  - iPad at the piano: pedals (and after closing a popover by tap), presses instant from the first touch, ▶ loop, rotation keeps the place, 🎹, the offer, page counts on his five songs against today's;
  - iPad portrait Sing + Score: the follow band, a press then singing it;
  - iPhone: Sing + a Melody score following, Score alone with ‹ ▶ › in the dock, and **a PDF converted while singing a take**, in Web Inspector's memory timeline.

### P6: Switch over (one release)

- **What:**
  - `index.html` becomes the shell; sing.html, play.html, record.html, voice.html, assistants.html and pdf-import.html become entries (§19.6); `shell.html` stays as an alias.
  - Assistants and Tools become panels (`tools.html` kept as the harness, unlinked). `account.html` and `consent.html` are restyled to the tokens.
  - The **MCP texts** (coaching.ts / resonate.ts: "the Sing page", "📡 on the Sing page" → "Resonate", "📡 in the account menu") are redeployed (`import_map_path: "deno.json"`), mcp1.cjs is updated, and `page: "sing"` is retired after the redeploy.
  - CLAUDE.md's Pages section is rewritten around the shell.
- **Tests:**
  - the ported suites become the suites; the old-page originals retire in this same release;
  - account.cjs (unchanged: a real page), cloudstatus, mcp1, and e2e-import through the entry;
  - `shellchrome.cjs` on every entry.
- **Risks:** assistants rely on texts the server repeats every call (the reminder); bookmarks and Home Screen icons pointing at sing.html / play.html keep working (entries).
- **Verify:** ChatGPT and Claude connectors (start_vocal_coaching → sing → get_live_lines); the consent flow; sign in → back to the same song; a fresh launch opens the tuner.

### P7: Review rounds and polish

- **Adversarial review rounds**, as for v76 / v79 / v80, each confirmed finding with one check.
- **A11y:** VoiceOver on iPhone and iPad; focus return; reduced motion.
- **Sizes:**
  - SE 375 × 667, Safari with toolbars;
  - iPad mini 744 (the desk bar's give-way order);
  - Split View ⅓ / ½, Slide Over;
  - phone landscape;
  - a desktop at 1440.
- **Visual pass** on the real devices: the cream note, the paper's white against the dark chrome at night.

### Order and dependencies

```
P0 ─┬─ P1 (the account corner on today's pages)
    └─ P2 (arbiter in today's pages) ─ P3 (preview: tuner, Take, Voice, list) ─ P4 (preview: Sing, tray) ─ P5 (preview: Score, desk) ─ P6 (switch) ─ P7
```

P1 and P2 are independent. P2 waits for P0's numbers. P3 needs P2, because the shell holds the tuner's mic next to playback. P5 needs P4's song store.

---

## 22. Open questions for the owner

1. **iPad default:** the desk (Score + keyboard), with Sing one tap away? Or Sing first, like the phone? (The design takes the desk: the iPad lives on the piano.)
2. **Phone default:** Sing alone, with the lane as tall as today and the Score one tap away (the design's choice now)? Or Sing + a one-system Melody score as round 1 had it? Either sticks once changed.
3. **The score in your key:** the paper, the presses and ▶ follow the key you sing in, and the tune's octave shows as a tenor-style clef. "As written" is in Score ⋯. OK as the default?
4. **Signing in and out:** a separate page for now (the safest path for email links and the account switch). OK?
5. **The preview:** the new app lives at Tools → "New Resonate (preview)" for three releases while today's pages stay as they are. OK, or would you rather it replace the pages sooner?
6. **Later merges (§20):** one ▶ for Listen and the score; Play's speed becoming the song's tempo; pressable keyboard keys. Wanted, or keep them separate?
7. **Home Screen app:** iOS would keep its songs apart from Safari's. Stay in Safari, or move to the Home Screen and accept that?

---

## 23. Round-2 critique ledger

Each finding from the two critiques is listed in order, with what was done. "Accepted" means applied as the critic proposed; "Changed" means applied differently, for the stated reason; "Rejected" says why.

**Critique 1 (owner-fit and UX):**

| # | Finding | Outcome |
|---|---|---|
| 1 | The Score and keyboard play written pitch while everything else plays the sung key | **Accepted, done differently:** the view's XML is transposed with Sing's spelling (one point that the names, peek, ▶ and keys all read), with the octave in the clef or a mark, shipped before stacking (D24, §6.2, P5). The mockup's paper is made that way. A check is added to stack.cjs |
| 2 | A score press parked the tuner for 2 min; the iPad showed no reading | **Accepted:** Sing's yield rules for presses, parking only on bursts or ▶, a press sets ◎, and the desk gets a one-tap session that survives single presses. The policy is a table P0 picks from (D9, §9.3) |
| 3 | The phone default halved the lane for a redundant Melody score | **Accepted:** Sing alone by default with the strip (lane 353×310). **Rejected in part:** "lane ≥ 300 or the Score opens folded" once the user adds the Score. A user who asks for both gets them; the minimum rule (lane 150 / one system) still folds |
| 4 | The keyboard looked playable; three keyboard toggles | **Accepted (option b):** the keyboard is the Score's display band with one 🎹, refused on a phone with Sing expanded (with a hint, never folding the Score). Pressable keys are deferred (§20) |
| 5 | The tuner reopened between rounds of a block | **Accepted:** one lease per block (D25); arbiter.cjs asserts no flips between rounds |
| 6 | Inline Sign out contradicted "no supabase-js" | **Accepted (option a):** Sign out and password on account.html; the shell loads supabase-js only signed in (as today's sync.js / assist.js do), never signed out (D17) |
| 7 | 📡 commands with Sing unmounted | **Accepted:** a shell router; open Sing when idle, else "busy"; home → "open a song"; Remote only where answered; the glyph on the ring and the name kept on phones; mcp1 desk / home cases (D27, §12) |
| 8 | A running conversion couldn't be cancelled | **Accepted:** Stop reading in Details, the tablet panel and the row's ⋯, with no Resume after a reload (§11); in P0 for today's page too |
| 9 | Two ▶ and two pagers; the head ▶ didn't become ■ | **Accepted:** D10 applied literally, ▶ named by what it plays, ■ while playing, and no ▶ in the Melody view next to Listen |
| 10 | Touch targets under 44 px | **Accepted:** every shot is now checked and passes (heads 48 / 50, chips in 44 px boxes, the strip's mic fixed at 44, no pager in a phone head) |
| 11 | The desk hid the offer, − / + and 🎹 in ⋯ | **Accepted:** the offer is on the bar, 🎹 is in the bar, − / + is in the bar at ≥ 1024 and an inline bar stepper below that. **Changed:** the offer takes A·C's slot, not the mic chip's, because the mic chip now carries the last heard note |
| 12 | The tempo panel lost Tapped vs Steady | **Accepted** (Steady \| Tapped). **Rejected in part:** a hidden `#tempo-select` doesn't keep taptiming.cjs working, because `selectOption` needs a visible element; `ui.setTempo()` does (§19.7) |
| 13 | The coach line's height followed its text; the import and suggestions had no home with Guide me off | **Accepted:** a fixed two-line box, the import beside Songs, and the key chip's dot with Guide me off (D12, D13, D16) |
| 14 | Perform still showed live feedback in the tuner and the Score | **Accepted:** a curtain over the Score too; the tuner shows "take" only (D22) |
| 15 | The phone review hid ▶ Melody, had no ▶ Both, and showed empty rings | **Accepted:** "▶ plays: You \| Melody \| Both" in the head, one ▶ per line, ✓ / ↑ marks only |
| 16 | The desk's size claims contradicted the test plan | **Accepted:** re-baseline on purpose and say so (D6); the keyboard narrows ~70 px with Songs, and playv80fixes K is rerun |
| 17 | P1–P4 shipped hybrids | **Accepted:** the shell is a preview (P3–P5) with one switch-over (P6), and P1 is the avatar only, with no Songs on the old pages |
| 18 | Verovio + Sing + CheerpJ on a phone | **Accepted:** a conversion folds the Score and drops the Verovio Module on a phone, and the OCR native waits during a take (§11, §19.9) |
| 19 | Back gesture and the way home | **Accepted:** pushState / popstate, and the brand mark closes the song (§19.10). **Rejected:** a long-press on the strip, a hidden gesture that duplicates the mark |
| 20 | The avatar dot would sit amber | **Accepted:** amber only for approval or a lasting sync error (§12) |
| 21 | `--text-3` at 3.6:1 | **Accepted:** 58% (5.9:1), with a contrast check on every shot |
| 22 | Smaller losses | **Accepted:** Record chips keep length and cents; the octave report goes to the folded summary and the fact line; desktop yields without flips; the tuner's gestures are split, with a mic button in the drop; Next-up always opens Sing |

**Critique 2 (engineering):**

| # | Finding | Outcome |
|---|---|---|
| 1 | bump.mjs doesn't version subfolders, so two arbiters | **Accepted:** recursive bump with `VERSION` exports, a specifier check in regress.sh, guarded singletons through `ctx`, and CSS in versioned JS / HTML (§19.1–19.2) |
| 2 | OUT created under play-and-record | **Accepted:** OUT is never made while a capture is live; the piano is decoded on an `OfflineAudioContext`; Start and the mic chip are added to the unlock exclusions; P0 row (f); arbiter.cjs checks the session at OUT's creation (§9.1) |
| 3 | Reopening flips AirPods / CarPlay routes | **Accepted:** route-aware parking, never auto-reopening off the built-in speaker; P0 row (e) (§9.3) |
| 4 | Test continuity for P4 / P5 | **Accepted:** `tools/ui.cjs`, named rewrites, counted references, re-baselines, and the correct ids (`#key-select`, not `#transpose`) (§19.7) |
| 5 | The CheerpJ memory risk shipped in P1; `tk.destroy()` doesn't free | **Accepted:** no tray on the old pages; Module references are dropped; on-device memory verification in P5 |
| 6 | Safari hides the default Score | **Accepted:** designed and shot at 393 × 659, where the minimum rule folds the Score. **Rejected:** a ~100 px one-system strip, which can't show a system with its words legibly |
| 7 | The import isn't background until P5 | **Accepted:** the tray ships in the preview when songs open in place (P4), and nothing auto-resumes on old pages |
| 8 | P1 isn't additive (Play, Record, 📡, add / remove, CSS) | **Accepted:** the avatar replaces the Tuner's account chip and sits beside `#version` on Play (bar no taller), `resonateBusy` on Record first, Remote on Sing only, add / remove moved in P4 with a key-set test, and a Shadow DOM for P1's chrome |
| 9 | Focus return breaks pedal turns | **Accepted:** the Score root after a tap close; stack.cjs checks pedals after every popover (§6.5) |
| 10 | Follow-the-take renders during a take | **Accepted:** pre-render before the count-in, swap cached pages, the keyboard dot ≤ 10 Hz, and a long-task check (§19.3) |
| 11 | The iOS keyboard, the toolbar, pull-to-refresh | **Accepted:** §19.3's viewport rules, with on-device checks in P1 (sheets) and P3 (the shell) |
| 12 | An always-on mic: battery, heat, other apps | **Accepted:** park after 60 s of silence, the phone's wake lock only for takes / ▶ / imports, P0 row (g) |
| 13 | P3 / P4 hide what Sing / Voice / Record tests drive | **Accepted:** `ui.showModules`, entry modules flattened into `resonateDebug()`, named rewrites |
| 14 | P0 had one fallback | **Accepted:** the decision table (§9.3), the reachable kill switch, and a conservative row if numbers are missing |
| 15 | The version guard races deploys | **Accepted:** `VERSION` compared after import, services through `ctx` (§19.8) |
| 16 | Layering and lease pre-emption during a take | **Accepted:** the countdown at z 65; capture leases refused while one is live; capture rows disabled during a take; the rule reworded ("nothing starts on OUT…") |
| 17 | Inline Sign out (repeat of critique 1, #6) | **Accepted** as there |
| 18 | bfcache restore; `?song=` in bookmarks | **Accepted:** OUT re-armed and the import resumed on `pageshow`; a fresh launch drops `?song=`, and account.html leaves a return marker (§9.1, §19.10) |
| 19 | P0's region sizing would change the calibrated floor | **Accepted, and the round-1 "real bug" claim withdrawn:** the floor keeps the screen-derived portrait density through `ctx`, `TABLET_W` tests the window, and there are playpaper cases at 650 / 730 px (§19.2, P0) |
