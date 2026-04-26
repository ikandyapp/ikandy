# IKANDY — Music Visualizer

A dark, cinematic music visualizer for Windows built on MilkDrop/Butterchurn. Works with Spotify, VLC, or any system audio.

![IKANDY Screenshot](https://via.placeholder.com/900x500/0a0a0f/d4a843?text=IKANDY)

---

## Features

- **500+ MilkDrop presets** — auto-cycle per track or navigate manually
- **Spotify + VLC support** — real-time track info, album art, lyrics, and playback controls
- **Local audio mode** — reacts to any system audio without a music service
- **Synced lyrics** — fetched automatically via LRCLIB, Classic or Physics display mode
- **12 GLSL image FX** — Rain, VHS, Ink, Fog, Paint, Film, Metal, Shatter, Corrupt, Plasma, Holo, Heat
- **6 UI themes** — Gold, Neon, Forest, Dusk, Ice, White
- **BYOK** — Bring Your Own Spotify Client ID. Your credentials never leave your machine.

---

## Requirements

- Windows 10/11 x64
- Spotify account (Premium required for playback controls) **or** VLC media player
- Your own free Spotify Developer App (takes ~2 minutes to set up)

---

## Installation

1. Download `IKANDY Setup x.x.x.exe` from [Releases](../../releases)
2. Run the installer — Windows SmartScreen may warn you, click **More info → Run anyway** (the app is not code-signed)
3. On first launch, enter your Spotify Client ID

---

## Getting a Spotify Client ID

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and log in
2. Click **Create app**
3. Fill in any name/description, then under **Redirect URIs** add:
   ```
   http://127.0.0.1:8888/callback
   ```
4. Copy the **Client ID** and paste it into IKANDY on first launch

This uses your own Spotify API credentials — IKANDY never sees your Spotify password.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `H` | Hide / show UI |
| `F` | Fullscreen |
| `?` | Restart tooltip tour |

---

## VLC Setup

To use VLC as an audio source:

1. In VLC: **Tools → Preferences → All → Interface → Main interfaces** → check **Web**
2. Set a password, restart VLC
3. In IKANDY sidebar → Source → VLC, enter port (default `8080`) and password

---

## Built With

- [Electron](https://www.electronjs.org/)
- [Butterchurn](https://github.com/jberg/butterchurn) (MilkDrop WebGL)
- [LRCLIB](https://lrclib.net/) for synced lyrics
- Spotify Web API

---

## Support

If you find IKANDY useful, consider supporting development:

☕ [buymeacoffee.com/ikandy](https://buymeacoffee.com/ikandy)

---

## License

MIT
