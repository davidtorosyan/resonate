# Resonate

A vocal pitch + waveform web app served over LAN so it can be used from a phone. Sing into the mic, see the note name, cents-off, volume, and live waveform.

## Run

```
cd C:\Data\Claude\resonate
npm start
```

Server prints both HTTP (port 3000) and HTTPS (port 3443) URLs for localhost and every detected LAN IPv4. **In practice the port that matters is 3443 (HTTPS)** — that's the one used from a phone, because `getUserMedia` is blocked on insecure origins for any non-localhost host. Port 3000 (HTTP) is only useful for localhost testing. There's no auto-reload; restart the node process to pick up `server.js` changes. Frontend changes (`public/`) just need a browser refresh.

**Which Network URL to give a phone:** the banner lists *every* IPv4, including virtual adapters — Hyper-V's "vEthernet (Default Switch)" (`172.x`) and VirtualBox host-only (`192.168.56.x`). A phone can't reach those. Pick the **Wi-Fi adapter's** IP (the one on the same subnet as the phone).

**Restarting:** `server.js` calls `listen()` with no `error` handler, so if an instance is already running, `npm start` prints the banner and *then* crashes hard with `EADDRINUSE` on 3000. A running instance holds both 3000 and 3443 — so this error also means "it's already up." To restart cleanly, kill the existing `node` process first (`Get-Process node | Stop-Process`).

## Version marker

`index.html` shows a `v<N>` badge in the top-right of the header (`#version`, purple). It exists so you can confirm a frontend change actually reached the phone — bump the number, refresh, check the badge. To bump: edit the single `<span id="version">` line. If the badge doesn't change after a refresh, the phone is serving a cached `index.html` — hard-refresh / pull-to-refresh.

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
