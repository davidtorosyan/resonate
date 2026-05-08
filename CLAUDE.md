# Resonate

A vocal pitch + waveform web app served over LAN so it can be used from a phone. Sing into the mic, see the note name, cents-off, volume, and live waveform.

## Run

```
cd C:\Data\Claude\resonate
npm start
```

Server prints both HTTP (port 3000) and HTTPS (port 3443) URLs for localhost and every detected LAN IPv4. **Use HTTPS on a phone** — `getUserMedia` is blocked on insecure origins for any non-localhost host. There's no auto-reload; restart the node process to pick up `server.js` changes. Frontend changes (`public/`) just need a browser refresh.

## Stack

- Node 21+, ESM, Express 4, `selfsigned` for cert generation
- Vanilla HTML/CSS/JS frontend, no build step, no framework
- Web Audio API (`AnalyserNode`, fftSize 2048) for capture; YIN for pitch detection; Canvas 2D for the waveform

## HTTPS / self-signed cert

Generated on first run to `certs/cert.pem` and `certs/key.pem`. SAN includes `localhost` and every IPv4 present at generation time.

**If the LAN IP changes** (router lease, network switch), the cert won't cover the new IP — delete `certs/` and restart to regenerate.

Browsers warn ("not private") because the cert isn't CA-signed. On iOS Safari: "Show Details" → "visit this website".

## Windows firewall

If the phone can't reach the server, this is the most likely cause. Allow inbound on 3000 and 3443.

## Pitch detection (`public/app.js`)

YIN algorithm (de Cheveigné & Kawahara, 2002). Chosen over FFT peak-picking because YIN avoids the octave errors that vocals trigger. Inner loop is bounded to `tau ∈ [minTau, maxTau]` covering only the vocal range (~70–1100 Hz) — keeps it cheap enough for phones.

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
| `MIN_CLARITY` | 0.85 | YIN clarity threshold — raise for stricter readings |
| `MIN_FREQ` / `MAX_FREQ` | 70 / 1100 Hz | vocal range bound for YIN; sets `minTau`/`maxTau` |

## Volume meter

Maps RMS → bar width via `(dB + 55) * 2`, clamped 0–100%. Roughly −55 dB empty, 0 dB full. If the bar sits too full or too empty for your mic gain, adjust the `+55` constant in `updateVolumeMeter()`.
